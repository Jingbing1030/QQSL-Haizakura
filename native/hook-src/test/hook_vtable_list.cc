// Lists every vtable in a QQ `wrapper.node`, with the class it belongs to.
//
// This is the first thing to reach for when QQ is updated and a hook starts
// misbehaving.  The payload finds its targets by matching RTTI names at run time,
// so a comparison of two listings -- one from the build that worked, one from the
// build that does not -- shows exactly which classes appeared, vanished, or moved,
// instead of leaving a single "RTTI chain unresolved" line to interpret.
//
// A vtable symbol is `_ZTV<type>`.  Its body starts with two words of offset-to-top
// and type_info pointer before the function slots, so the slot count is
// (symbol size - 2) once the size is known from .dynsym.  Where the symbol size is
// absent, the next vtable's address bounds it.
//
// Usage:
//   hook_vtable_list <wrapper.node>            table of vtables
//   hook_vtable_list <wrapper.node> --slots    also resolve each slot to a symbol

#include "common.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
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
  uint32_t entsize;
};

struct Sym {
  std::string name;
  uint64_t value;
  uint64_t size;
  uint16_t shndx;
};

class Elf {
 public:
  explicit Elf(const std::string& path) : file_(hz::MappedFile::open(path)) {
    if (!file_.valid()) throw hz::Error("cannot map " + path);
    read_header();
    read_sections();
    read_dynsyms();
  }

  // Mangled names of the form _ZTV<...>, decoded to the class they describe.
  struct VTable {
    std::string className;
    std::string symbolName;
    uint64_t address;
    uint64_t size;
    std::string source;  // "size" or "bounded"
  };

  std::vector<VTable> vtables() const {
    std::vector<VTable> out;
    for (const Sym& s : syms_) {
      if (s.value == 0) continue;
      if (!hz::starts_with(s.name, "_ZTV")) continue;
      out.push_back({demangle_type(std::string_view(s.name).substr(4)),
                     s.name, s.value, s.size, s.size ? "size" : ""});
    }
    std::sort(out.begin(), out.end(),
              [](const VTable& a, const VTable& b) { return a.address < b.address; });

    // Symbols without a recorded size are bounded by whatever comes next in the
    // same section.  Falling back to the section end keeps the last one finite.
    for (size_t i = 0; i < out.size(); ++i) {
      if (out[i].size != 0) continue;
      uint64_t limit = 0;
      for (size_t j = i + 1; j < out.size(); ++j) {
        if (out[j].address > out[i].address) { limit = out[j].address; break; }
      }
      if (limit == 0) limit = section_end_for(out[i].address);
      out[i].size = limit > out[i].address ? limit - out[i].address : 0;
      out[i].source = "bounded";
    }
    return out;
  }

  // Every vtable in the module, not just the exported ones.
  //
  // Only 16 classes have their `_ZTV` in .dynsym, which is nowhere near the real
  // count: QQ exports a fraction of its internal classes.  The rest are still
  // discoverable, because every vtable begins with a pointer to its type_info, and
  // every type_info has a name.  Walking .data.rel.ro and pairing those pointers
  // back to their type_info recovers the internal hierarchies that a hook needs.
  struct InternalVTable {
    std::string className;
    uint64_t vtable;      // first function slot (past type_info)
    uint64_t typeInfo;
    size_t slotCount;     // 0 when unbounded
  };

  std::vector<InternalVTable> internal_vtables() const {
    std::vector<InternalVTable> out;
    const Shdr* relro = find(".data.rel.ro");
    const Shdr* rodata = find(".rodata");
    if (relro == nullptr || rodata == nullptr) {
      return out;
    }

    // Index every type_info by its object address, so a vtable's [-1] word can be
    // recognised.  A type_info is two words: [0] is itself a vtable pointer into
    // .data.rel.ro, [1] is a pointer to the mangled name in .rodata.
    std::map<uint64_t, std::string> type_info_by_blob;
    const uint8_t* rbase = file_.data() + relro->offset;
    const uint64_t rsize = std::min<uint64_t>(relro->size, file_.size() - relro->offset);
    for (uint64_t off = 0; off + 16 <= rsize; off += 8) {
      const uint64_t self_vt = hz::rd64(rbase + off);
      const uint64_t name_ptr = hz::rd64(rbase + off + 8);
      if (name_ptr < rodata->addr || name_ptr >= rodata->addr + rodata->size) continue;
      // [0] must be a plausible vtable: inside this section and 8-byte aligned.
      if (self_vt < relro->addr || self_vt >= relro->addr + relro->size) continue;
      if ((self_vt % 8) != 0) continue;
      const char* name = reinterpret_cast<const char*>(
          file_.data() + rodata->offset + (name_ptr - rodata->addr));
      // RTTI type names are the mangled names themselves (_ZTS contents), so
      // `msf::IMSFService` shows up as `N3msf11IMSFServiceE`.  Type names written
      // directly with a length prefix are rare; accept both, but insist on
      // printable ASCII so a coincidental integer pair cannot pass.
      if (name[0] == '\0') continue;
      bool printable = true;
      for (const char* c = name; *c; ++c) {
        if (static_cast<unsigned char>(*c) < 32 || static_cast<unsigned char>(*c) > 126) {
          printable = false;
          break;
        }
        if (c - name > 512) { printable = false; break; }
      }
      if (!printable) continue;
      type_info_by_blob[relro->addr + off] = name;
    }

    // A vtable is laid out as:
    //   [-2] offset-to-top
    //   [-1] pointer to the type_info of the class
    //   [ 0] first virtual function
    // so scanning for words that equal a known type_info finds the slot *before*
    // the first function -- the vtable starts one word later.
    for (uint64_t off = 0; off + 16 <= rsize; off += 8) {
      const uint64_t candidate_ti = hz::rd64(rbase + off);
      const auto it = type_info_by_blob.find(candidate_ti);
      if (it == type_info_by_blob.end()) continue;

      const uint64_t vtable = relro->addr + off + 8;
      const uint64_t first_slot = hz::rd64(rbase + off + 8);
      if (!inside_executable(first_slot)) continue;

      // The slot count runs to the next vtable in the same section; without the
      // symbol size that is the only bound available.
      uint64_t next = relro->addr + relro->size;
      for (uint64_t probe = off + 16; probe + 8 <= rsize; probe += 8) {
        if (type_info_by_blob.count(hz::rd64(rbase + probe)) != 0) {
          next = relro->addr + probe;
          break;
        }
      }
      const size_t slots = next > vtable ? static_cast<size_t>((next - vtable) / 8) : 0;

      const std::string_view view(it->second);
      const std::string decoded =
          view.empty() ? std::string()
                       : demangle_type(view[0] == 'N' ? view.substr(1) : view);
      out.push_back({decoded, vtable, candidate_ti, slots});
    }
    return out;
  }

  bool inside_executable(uint64_t address) const {
    for (const Shdr& s : sections_) {
      // SHF_EXECINSTR is 0x4.
      if ((s.flags & 0x4) != 0 && address >= s.addr && address < s.addr + s.size) return true;
    }
    return false;
  }

  // Resolve an address to the symbol whose [value, value+size) contains it.  Used
  // to name the function in a vtable slot.
  std::string symbol_at(uint64_t address) const {
    const Sym* best = nullptr;
    for (const Sym& s : syms_) {
      if (s.value == 0 || s.shndx == 0) continue;
      const uint64_t size = s.size ? s.size : 1;
      if (address < s.value || address >= s.value + size) continue;
      if (best == nullptr || s.value > best->value) best = &s;
    }
    if (best == nullptr) return {};
    return demangle_function(best->name);
  }

  const uint8_t* file_base() const { return file_.data(); }

 private:
  // Minimal Itanium demangling: strip the length prefixes so `N2nt10MSFServiceE`
  // becomes `nt::MSFService`.  A full demangler is unnecessary and would pull in
  // <cxxabi.h>, whose availability at run time we do not want to depend on.
  static std::string demangle_type(std::string_view mangled) {
    std::string out;
    size_t i = 0;
    // Drop an optional leading 'N' (nested name) and a trailing 'E'.
    if (i < mangled.size() && mangled[i] == 'N') ++i;
    while (i < mangled.size()) {
      const char c = mangled[i];
      if (c == 'E') break;
      if (c >= '0' && c <= '9') {
        size_t len = 0;
        while (i < mangled.size() && mangled[i] >= '0' && mangled[i] <= '9') {
          len = len * 10 + static_cast<size_t>(mangled[i] - '0');
          ++i;
        }
        if (i + len > mangled.size()) break;
        if (!out.empty()) out += "::";
        out.append(mangled.substr(i, len));
        i += len;
        continue;
      }
      // Unrecognised (template args, qualifiers).  Append verbatim so the reader
      // still sees what was there rather than a silently truncated name.
      out.push_back(c);
      ++i;
    }
    return out;
  }

  static std::string demangle_function(const std::string& mangled) {
    // _ZN2nt10MSFService9sendQueueEv -> nt::MSFService::sendQueue
    if (!hz::starts_with(mangled, "_ZN")) return mangled;
    std::string body = mangled.substr(3);
    return demangle_type(body);
  }

  void read_header() {
    const uint8_t* h = file_.data();
    if (file_.size() < 64 || std::memcmp(h, "\x7f""ELF", 4) != 0) {
      throw hz::Error("not an ELF file");
    }
    if (h[4] != 2) throw hz::Error("not ELF64");
    shoff_ = hz::rd64(h + 40);
    shentsize_ = hz::rd16(h + 58);
    shnum_ = hz::rd16(h + 60);
    shstrndx_ = hz::rd16(h + 62);
  }

  void read_sections() {
    if (shoff_ == 0 || shnum_ == 0) throw hz::Error("no section headers");
    sections_.resize(shnum_);
    for (uint16_t i = 0; i < shnum_; ++i) {
      const uint8_t* p = file_.data() + shoff_ + uint64_t{i} * shentsize_;
      Shdr& s = sections_[i];
      s.name = hz::rd32(p);
      s.flags = hz::rd64(p + 8);   // SHF_EXECINSTR tells us where code lives
      s.addr = hz::rd64(p + 16);
      s.offset = hz::rd64(p + 24);
      s.size = hz::rd64(p + 32);
      s.link = hz::rd32(p + 40);
      s.entsize = hz::rd64(p + 56);
    }
  }

  const Shdr* find(const char* name) const {
    for (size_t i = 0; i < sections_.size(); ++i) {
      const Shdr& s = sections_[i];
      if (shstrndx_ >= sections_.size() || s.name >= sections_[shstrndx_].size) continue;
      const char* p = reinterpret_cast<const char*>(
          file_.data() + sections_[shstrndx_].offset + s.name);
      if (std::strcmp(p, name) == 0) return &s;
    }
    return nullptr;
  }

  void read_dynsyms() {
    const Shdr* dynsym = find(".dynsym");
    const Shdr* dynstr = find(".dynstr");
    if (dynsym == nullptr || dynstr == nullptr) return;
    const uint64_t ent = dynsym->entsize ? dynsym->entsize : 24;
    const uint64_t count = dynsym->size / ent;
    for (uint64_t i = 0; i < count; ++i) {
      const uint8_t* p = file_.data() + dynsym->offset + i * ent;
      const uint32_t name_off = hz::rd32(p);
      if (name_off == 0 || name_off >= dynstr->size) continue;
      const char* name = reinterpret_cast<const char*>(file_.data() + dynstr->offset + name_off);
      Sym s;
      s.name = name;
      s.shndx = hz::rd16(p + 6);
      s.value = hz::rd64(p + 8);
      s.size = hz::rd64(p + 16);
      if (s.shndx != 0 && !s.name.empty()) syms_.push_back(std::move(s));
    }
  }

  uint64_t section_end_for(uint64_t address) const {
    for (const Shdr& s : sections_) {
      if (address >= s.addr && address < s.addr + s.size) return s.addr + s.size;
    }
    return address;
  }

  hz::MappedFile file_;
  uint64_t shoff_ = 0;
  uint16_t shentsize_ = 0;
  uint16_t shnum_ = 0;
  uint16_t shstrndx_ = 0;
  std::vector<Shdr> sections_;
  std::vector<Sym> syms_;
};

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: %s <wrapper.node> [--slots|--internal]\n", argv[0]);
    return 2;
  }
  const bool show_slots = argc >= 3 && std::strcmp(argv[2], "--slots") == 0;
  const bool show_internal = argc >= 3 && std::strcmp(argv[2], "--internal") == 0;

  try {
    Elf elf(argv[1]);
    const auto tables = elf.vtables();

    std::printf("== %zu vtables ==\n", tables.size());
    std::printf("%-46s %-14s %-8s %s\n", "class", "address", "size", "slots");
    for (const auto& t : tables) {
      // Two leading words: offset-to-top, then type_info.
      const uint64_t slots = t.size >= 16 ? (t.size - 16) / 8 : 0;
      std::printf("%-46s 0x%-12llx %-8llu %llu%s\n",
                  t.className.substr(0, 46).c_str(),
                  static_cast<unsigned long long>(t.address),
                  static_cast<unsigned long long>(t.size),
                  static_cast<unsigned long long>(slots),
                  t.source == "bounded" ? " (bounded)" : "");
    }

    if (show_internal) {
      const auto internal = elf.internal_vtables();
      std::printf("\n== %zu internal vtables (recovered from RTTI) ==\n", internal.size());
      std::printf("%-52s %-14s %-14s %s\n", "class", "vtable", "type_info", "slots");
      for (const auto& t : internal) {
        std::printf("%-52s 0x%-12llx 0x%-12llx %zu\n",
                    t.className.substr(0, 52).c_str(),
                    static_cast<unsigned long long>(t.vtable),
                    static_cast<unsigned long long>(t.typeInfo),
                    t.slotCount);
      }
      return 0;
    }

    if (show_slots) {
      std::printf("\n== slots ==\n");
      for (const auto& t : tables) {
        if (t.size < 24) continue;
        std::printf("\n%s  (0x%llx)\n", t.className.c_str(),
                    static_cast<unsigned long long>(t.address));
        const uint64_t slots = (t.size - 16) / 8;
        for (uint64_t i = 0; i < slots; ++i) {
          const uint64_t entry_addr = t.address + 16 + i * 8;
          const uint64_t* entry = reinterpret_cast<const uint64_t*>(
              elf.file_base() + entry_addr);
          const std::string fn = elf.symbol_at(*entry);
          std::printf("  [%2llu] 0x%-12llx %s\n",
                      static_cast<unsigned long long>(i),
                      static_cast<unsigned long long>(*entry),
                      fn.empty() ? "(unknown)" : fn.c_str());
        }
      }
    }
    return 0;
  } catch (const std::exception& e) {
    std::fprintf(stderr, "error: %s\n", e.what());
    return 1;
  }
}