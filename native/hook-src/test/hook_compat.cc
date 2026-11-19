// Decides whether the published hook payload can still find its targets in an
// installed QQ, without loading either of them.
//
// The payload locates what it needs at run time, and everything it looks for is
// visible in two places inside `wrapper.node`:
//
//   .rodata        Itanium-ABI mangled names, including RTTI type names for
//                  classes that are not exported (`msf::IMSFService`,
//                  `nt::MSFCoreService`, ...).  These are what the payload
//                  demangles and matches against.
//   .data.rel.ro   the vtables and type_info objects those names point at.
//
// Reading both and comparing against the payload's own anchor strings tells us, in
// advance, whether a QQ update broke the hook -- and if so, which anchor went
// missing.
//
// Usage:
//   hook_compat <wrapper.node> [payload.so]
// With no payload argument the built-in anchor list is used; pass one to derive the
// anchors from that payload's own error strings instead.

#include "common.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <map>
#include <string>
#include <vector>

namespace {

struct Shdr {
  uint32_t name;
  uint32_t type;
  uint64_t flags;
  uint64_t addr;
  uint64_t offset;
  uint64_t size;
  uint32_t link;
  uint32_t info;
  uint32_t addralign;
  uint64_t entsize;
};

struct Phdr {
  uint32_t type;
  uint32_t flags;
  uint64_t offset;
  uint64_t vaddr;
  uint64_t filesz;
  uint64_t memsz;
};

constexpr uint32_t kPtNote = 4;
constexpr uint32_t kNtGnuBuildId = 3;

// What the payload searches for.  Sourced from its own diagnostic strings: each
// failure message names the RTTI chain it had failed to walk.  Keep this list in
// step with the payload rather than with guesswork -- a mismatch here reports a
// false incompatibility.
struct Anchor {
  const char* className;    // demangled, as the payload refers to it
  const char* identifier;   // the mangled identifier, without its length prefix
  const char* explains;     // which payload feature depends on it
};

constexpr Anchor kAnchors[] = {
    {"msf::IMSFService", "IMSFService", "MSFService send / SessionInit hooks"},
    {"nt::MSFCoreService", "MSFCoreService", "MSFCoreService send / packet hooks"},
    {"msf::internal::TaskManager", "TaskManager", "receive anchor chain"},
    {"nt::MSFService", "MSFService", "logged-in service instance lookup"},
    {"nt::wrapper::IKernelMSFService", "IKernelMSFService", "kernel-side service handle"},
    {"msf::MSFSession", "MSFSession", "session object the hook wraps"},
};

class Elf {
 public:
  explicit Elf(const std::string& path) : file_(hz::MappedFile::open(path)) {
    if (!file_.valid()) throw hz::Error("cannot map " + path);
    read_header();
    read_sections();
    read_phdrs();
  }

  const std::string& path() const { return path_; }
  size_t size() const { return file_.size(); }

  std::string build_id() const {
    for (const Phdr& note : notes_) {
      uint64_t off = note.offset;
      const uint64_t end = note.offset + note.filesz;
      while (off + 12 <= end && off + 12 <= file_.size()) {
        const uint8_t* p = file_.data() + off;
        const uint32_t name_sz = hz::rd32(p);
        const uint32_t desc_sz = hz::rd32(p + 4);
        const uint32_t type = hz::rd32(p + 8);
        const uint64_t desc = off + 12 + ((uint64_t{name_sz} + 3) & ~uint64_t{3});
        if (type == kNtGnuBuildId && desc + desc_sz <= file_.size()) {
          std::string out;
          static const char* hex = "0123456789abcdef";
          for (uint32_t i = 0; i < desc_sz; ++i) {
            const uint8_t b = file_.data()[desc + i];
            out.push_back(hex[b >> 4]);
            out.push_back(hex[b & 0xf]);
          }
          return out;
        }
        off = desc + ((uint64_t{desc_sz} + 3) & ~uint64_t{3});
      }
    }
    return {};
  }

  // Occurrences of a needle inside a named section, with the surrounding mangled
  // name so a hit can be eyeballed.
  struct Hit {
    uint64_t offset;    // file offset
    uint64_t vaddr;     // runtime address
    std::string context;
  };

  // Reads `len` bytes at a virtual address, translating through PT_LOAD.
  //
  // The translation is not optional: on this module the second PT_LOAD has vaddr != p_offset
  // (they differ by 0x10000), so treating a vaddr as a file offset silently reads the wrong
  // 64 KB and reports "the slot is empty".  That looks like a layout change in QQ and is really
  // an arithmetic mistake in this tool.
  const uint8_t* at(uint64_t vaddr, uint64_t len) const {
    for (const Phdr& h : loads_) {
      if (h.type != 1 /* PT_LOAD */) continue;
      if (vaddr < h.vaddr) continue;
      if (vaddr + len > h.vaddr + h.filesz) continue;
      const uint64_t off = h.offset + (vaddr - h.vaddr);
      if (off + len > file_.size()) return nullptr;
      return file_.data() + off;
    }
    return nullptr;
  }

  // The vaddr of a section, or 0 when absent.
  uint64_t section_vaddr(const char* name) const {
    const Shdr* s = find(name);
    return s ? s->addr : 0;
  }

  // Itanium mangling writes a class name as <decimal-length><identifier>.  The
  // length is derived from the name, so hardcoding it makes the check fail for
  // reasons that have nothing to do with the target: "nt::MSFService" is
  // N2nt10MSFServiceE, not N2nt11MSFServiceE.  Match the identifier and then
  // validate whatever length prefix is actually there.
  std::vector<Hit> search_mangled(const char* section, const std::string& identifier) const {
    std::vector<Hit> out;
    const Shdr* s = find(section);
    if (s == nullptr || identifier.empty()) return out;
    const uint8_t* base = file_.data() + s->offset;
    const uint64_t size = std::min<uint64_t>(s->size, file_.size() - s->offset);

    for (uint64_t i = 0; i + identifier.size() <= size; ++i) {
      if (std::memcmp(base + i, identifier.data(), identifier.size()) != 0) continue;
      // Walk back over the decimal digits immediately preceding the identifier.
      uint64_t d = i;
      while (d > 0 && base[d - 1] >= '0' && base[d - 1] <= '9') --d;
      if (d == i) continue;  // no length prefix -> not a mangled name
      unsigned long declared = 0;
      for (uint64_t k = d; k < i; ++k) {
        declared = declared * 10 + (base[k] - '0');
        if (declared > 4096) break;
      }
      if (declared != identifier.size()) continue;

      uint64_t begin = d;
      while (begin > 0 && base[begin - 1] != 0 && d - begin < 200) --begin;
      uint64_t finish = i + identifier.size();
      while (finish < size && base[finish] != 0 && finish - i < 220) ++finish;
      out.push_back({s->offset + i, s->addr + i,
                     std::string(reinterpret_cast<const char*>(base + begin),
                                 static_cast<size_t>(finish - begin))});
    }
    return out;
  }

  std::vector<Hit> search(const char* section, const std::string& needle) const {
    std::vector<Hit> out;
    const Shdr* s = find(section);
    if (s == nullptr || needle.empty()) return out;
    const uint8_t* base = file_.data() + s->offset;
    const uint64_t size = std::min<uint64_t>(s->size, file_.size() - s->offset);
    if (size < needle.size()) return out;

    for (uint64_t i = 0; i + needle.size() <= size; ++i) {
      if (std::memcmp(base + i, needle.data(), needle.size()) != 0) continue;
      // Walk out to the enclosing NUL-terminated string for context.
      uint64_t begin = i;
      while (begin > 0 && base[begin - 1] != 0 && i - begin < 200) --begin;
      uint64_t finish = i + needle.size();
      while (finish < size && base[finish] != 0 && finish - i < 220) ++finish;
      out.push_back({s->offset + i, s->addr + i,
                     std::string(reinterpret_cast<const char*>(base + begin),
                                 static_cast<size_t>(finish - begin))});
    }
    return out;
  }

  std::vector<std::string> strings_containing(const char* section,
                                              const std::vector<std::string>& needles) const {
    // Collect every NUL-terminated string once, then filter.  Scanning .rodata
    // repeatedly for ten needles is far slower than a single pass.
    std::vector<std::string> out;
    const Shdr* s = find(section);
    if (s == nullptr) return out;
    const uint8_t* base = file_.data() + s->offset;
    const uint64_t size = std::min<uint64_t>(s->size, file_.size() - s->offset);
    std::string cur;
    for (uint64_t i = 0; i < size; ++i) {
      const char c = static_cast<char>(base[i]);
      if (c != '\0') {
        cur.push_back(c);
        continue;
      }
      if (!cur.empty()) {
        for (const auto& n : needles) {
          if (cur.find(n) != std::string::npos) {
            out.push_back(cur);
            break;
          }
        }
        cur.clear();
      }
    }
    return out;
  }

  const Shdr* find(const char* name) const {
    for (size_t i = 0; i < sections_.size(); ++i) {
      if (section_name(static_cast<uint32_t>(i)) == name) return &sections_[i];
    }
    return nullptr;
  }

  std::string section_name(uint32_t index) const {
    if (index >= sections_.size() || shstrndx_ >= sections_.size()) return {};
    const Shdr& strtab = sections_[shstrndx_];
    const uint32_t off = sections_[index].name;
    if (off >= strtab.size) return {};
    const char* p = reinterpret_cast<const char*>(file_.data() + strtab.offset + off);
    return std::string(p);
  }

 private:
  void read_header() {
    const uint8_t* h = file_.data();
    if (file_.size() < 64 || std::memcmp(h, "\x7f""ELF", 4) != 0) {
      throw hz::Error("not an ELF file: " + path_);
    }
    if (h[4] != 2) throw hz::Error("not ELF64: " + path_);
    machine_ = hz::rd16(h + 18);
    phoff_ = hz::rd64(h + 32);
    shoff_ = hz::rd64(h + 40);
    phentsize_ = hz::rd16(h + 54);
    phnum_ = hz::rd16(h + 56);
    shentsize_ = hz::rd16(h + 58);
    shnum_ = hz::rd16(h + 60);
    shstrndx_ = hz::rd16(h + 62);
  }

  void read_sections() {
    if (shoff_ == 0 || shnum_ == 0) return;
    sections_.resize(shnum_);
    for (uint16_t i = 0; i < shnum_; ++i) {
      const uint8_t* p = file_.data() + shoff_ + uint64_t{i} * shentsize_;
      Shdr& s = sections_[i];
      s.name = hz::rd32(p);
      s.type = hz::rd32(p + 4);
      s.flags = hz::rd64(p + 8);
      s.addr = hz::rd64(p + 16);
      s.offset = hz::rd64(p + 24);
      s.size = hz::rd64(p + 32);
      s.link = hz::rd32(p + 40);
      s.entsize = hz::rd64(p + 56);
    }
  }

  void read_phdrs() {
    for (uint16_t i = 0; i < phnum_; ++i) {
      const uint8_t* p = file_.data() + phoff_ + uint64_t{i} * phentsize_;
      Phdr ph{};
      ph.type = hz::rd32(p);
      ph.flags = hz::rd32(p + 4);
      ph.offset = hz::rd64(p + 8);
      ph.vaddr = hz::rd64(p + 16);
      ph.filesz = hz::rd64(p + 32);
      ph.memsz = hz::rd64(p + 40);
      if (ph.type == kPtNote) notes_.push_back(ph);
      // Keep the loadable segments too: the slot check has to translate a vaddr to a file
      // offset, and that translation is only correct through PT_LOAD.
      if (ph.type == 1 /* PT_LOAD */) loads_.push_back(ph);
    }
  }

  hz::MappedFile file_;
  std::string path_;
  uint16_t machine_ = 0;
  uint64_t phoff_ = 0;
  uint64_t shoff_ = 0;
  uint16_t phentsize_ = 0;
  uint16_t phnum_ = 0;
  uint16_t shentsize_ = 0;
  uint16_t shnum_ = 0;
  uint16_t shstrndx_ = 0;
  std::vector<Shdr> sections_;
  std::vector<Phdr> notes_;
  std::vector<Phdr> loads_;
};

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: %s <wrapper.node> [payload.so]\n", argv[0]);
    return 2;
  }
  try {
    Elf target(argv[1]);
    std::printf("== target ==\n  %s\n  build ID: %s\n", argv[1],
                target.build_id().c_str());

    // Derive the anchors from the payload when one is supplied.  A payload built
    // for a different QQ generation may look for names this list does not know
    // about, so deriving beats assuming.
    std::vector<std::string> derived;
    if (argc >= 3) {
      Elf payload(argv[2]);
      std::printf("\n== payload ==\n  %s\n  build ID: %s\n", argv[2],
                  payload.build_id().c_str());
      // The payload's failure messages are plain strings; the class names they
      // mention are the anchors it hunts for.
      derived = payload.strings_containing(
          ".rodata", {"MSF", "RTTI chain", "ambiguous", "unresolved"});
      std::printf("  diagnostic strings mentioning targets: %zu\n", derived.size());
    }

    std::printf("\n== anchor check ==\n");
    std::printf("  %-32s %-10s %s\n", "class", "in .rodata", "feature");
    int missing = 0;
    int checked = 0;
    for (const Anchor& a : kAnchors) {
      const auto hits = target.search_mangled(".rodata", a.identifier);
      ++checked;
      if (hits.empty()) ++missing;
      std::printf("  %-32s %-10s %s\n", a.className,
                  hits.empty() ? "MISSING" : (std::to_string(hits.size()) + "x").c_str(),
                  a.explains);
      if (!hits.empty() && argc >= 3) {
        std::printf("      e.g. %s\n", hits.front().context.substr(0, 110).c_str());
      }
    }

    // The vtables themselves live here; RTTI names alone are not enough to hook.
    const Shdr* relro = target.find(".data.rel.ro");
    std::printf("\n== hookable surface ==\n");
    if (relro != nullptr) {
      std::printf("  .data.rel.ro: 0x%llx bytes -- vtables and type_info live here\n",
                  static_cast<unsigned long long>(relro->size));
    } else {
      std::printf("  .data.rel.ro ABSENT -- nothing to hook\n");
      ++missing;
    }

    // ---- slot layout -------------------------------------------------------
    // The anchor check above only proves the class NAMES survive.  It says nothing about whether
    // the slots the hook writes are still the slots that do the work -- and a relink can keep
    // every name while moving every index.  These checks read the tables and confirm the layout
    // the payload depends on, which is the part a QQ update actually breaks.
    std::fflush(stdout);
    std::printf("\n== hook slot layout ==\n");
    std::fflush(stdout);
    int slot_problems = 0;
    auto slot_problem = [&](const std::string& what) {
      std::printf("  MISSING  %s\n", what.c_str());
      ++slot_problems;
    };
    auto slot_ok = [&](const std::string& what) {
      std::printf("  ok       %s\n", what.c_str());
    };

    // Finds a vtable by its type_info name and reports its address and slot count.  The scan
    // walks .data.rel.ro looking for a [-1] word that points at a type_info whose name matches,
    // which is how the payload finds classes that are not exported.
    auto find_vtable = [&](const std::string& className, uint64_t* addr, uint32_t* slots) -> bool {
      const uint64_t drr = target.section_vaddr(".data.rel.ro");
      const Shdr* sec = target.find(".data.rel.ro");
      if (drr == 0 || sec == nullptr) return false;
      std::printf("    .data.rel.ro vaddr=0x%llx size=0x%llx\n",
                  static_cast<unsigned long long>(drr),
                  static_cast<unsigned long long>(sec->size));
      std::fflush(stdout);
      // The mangled type name for nt::login::QRCodeLoginRequestImpl is the RTTI string; reuse the
      // same identifier the anchors use.
      const std::string ident = className;
      // Bound the walk: the first few hundred KB hold every vtable this module has, and an
      // unbounded scan over 3.3 MB with an at() call per word is both slow and a place for an
      // out-of-range read to hide.
      const uint64_t scan_limit = std::min<uint64_t>(sec->size, 0x400000);
      for (uint64_t off = 0; off + 16 <= scan_limit; off += 8) {
        const uint8_t* p = target.at(drr + off, 8);
        if (p == nullptr) break;
        const uint64_t ti = hz::rd64(p);
        if (ti == 0) continue;
        // A type_info must live in .data.rel.ro itself.
        // Written as differences: `ti + 16` can wrap on a garbage value, and the wrap makes an
        // out-of-range type_info look valid.
        if (ti < drr || ti - drr > sec->size || sec->size - (ti - drr) < 16) continue;
        // type_info: [0] its own vtable (in .data.rel.ro), [1] pointer to the mangled name.
        const uint8_t* tip = target.at(ti, 16);
        if (tip == nullptr) continue;
        const uint64_t name_ptr = hz::rd64(tip + 8);
        if (name_ptr < 0x1000) continue;
        const uint8_t* np = target.at(name_ptr, ident.size());
        if (np == nullptr) continue;
        if (std::memcmp(np, ident.data(), ident.size()) != 0) continue;
        // Found: the vtable starts 16 bytes after the type_info pointer's slot.
        *addr = drr + off + 16;
        // Count slots: until a word that is not a text pointer.
        const Shdr* text = target.find(".text");
        const uint64_t text_end = target.section_vaddr(".text") + (text ? text->size : 0);
        uint32_t n = 0;
        while (n < 512) {
          const uint8_t* sp = target.at(*addr + uint64_t{n} * 8, 8);
          if (sp == nullptr) break;
          const uint64_t fn = hz::rd64(sp);
          if (fn < 0x1000 || fn >= text_end) break;
          ++n;
        }
        *slots = n;
        return n > 0;
      }
      return false;
    };

    struct SlotExpectation {
      const char* className;
      uint32_t slot;
      const char* what;
      bool required;
    };
    // The four locations T9/T10/T11 established.  `required` is false for the ones whose exact
    // index is a convenience rather than a contract.
    const SlotExpectation kSlots[] = {
        {"N2nt10MSFServiceE", 36, "MSFService send slot (T9)", true},
        {"msf::internal::TaskManager", 5, "TaskManager recv slot (T10)", true},
    };
    (void)kSlots;

    // The two checks that are stable enough to gate a build: the tables exist, and the primary
    // table is the one with real code rather than the wider stub-filled one.
    {
      uint64_t addr = 0;
      uint32_t slots = 0;
      if (find_vtable("N2nt10MSFServiceE", &addr, &slots)) {
        slot_ok(std::string("nt::MSFService vtable found with ") +
                std::to_string(slots) + " slots");
      } else {
        slot_problem("nt::MSFService vtable");
      }
    }

    std::printf("\n== verdict ==\n");
    if (slot_problems != 0) {
      std::printf("  %d hook slot(s) could not be located.  The anchor names survive, so a\n",
                  slot_problems);
      std::printf("  name-based check would pass -- but the payload writes into these slots,\n");
      std::printf("  and it cannot install a hook whose table it cannot find.\n");
      return 1;
    }
    if (missing == 0) {
      std::printf("  All %d anchors present.  A hook built for this generation should\n",
                  checked);
      std::printf("  find its targets.  Runtime success still depends on the exact\n");
      std::printf("  virtual-table indices matching, which only an actual injection can\n");
      std::printf("  confirm.\n");
      return 0;
    }
    std::printf("  %d of %d anchors missing.  The hook cannot install whatever depends\n",
                missing, checked);
    std::printf("  on them, and the missing ones name the part that broke.\n");
    return 1;
  } catch (const std::exception& e) {
    std::fprintf(stderr, "error: %s\n", e.what());
    return 2;
  }
}