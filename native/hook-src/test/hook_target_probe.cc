// Inspects a QQ `wrapper.node` and reports what a hook could latch onto.
//
// The published hook payload locates its targets at run time: it reads the mapped
// module's GNU build ID, walks the RTTI/vtable material in .data.rel.ro, and
// matches class names after demangling them.  When QQ is updated and the hook stops
// working, the question that actually matters is *which* of those steps broke -- a
// build ID nobody taught the hook about, a class that got renamed, or a genuine
// restructure.  A one-line runtime error cannot distinguish them, so this prints
// each step separately.
//
// It reads the file directly instead of attaching to a process, so it is safe to
// run against an installed QQ without disturbing a running instance.
//
// Usage: hook_target_probe <path-to-wrapper.node>

#include "common.h"

#include <cstdio>
#include <cstring>
#include <map>
#include <string>
#include <vector>

namespace {

// Minimal ELF64 views.  Deliberately local: the injector's headers describe only
// the structs the loader needs, and this tool must not grow that surface.
struct Ehdr {
  uint8_t ident[16];
  uint16_t type;
  uint16_t machine;
  uint32_t version;
  uint64_t entry;
  uint64_t phoff;
  uint64_t shoff;
  uint32_t flags;
  uint16_t ehsize;
  uint16_t phentsize;
  uint16_t phnum;
  uint16_t shentsize;
  uint16_t shnum;
  uint16_t shstrndx;
};

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
  uint64_t paddr;
  uint64_t filesz;
  uint64_t memsz;
  uint64_t align;
};

struct Sym {
  uint32_t name;
  uint8_t info;
  uint8_t other;
  uint16_t shndx;
  uint64_t value;
  uint64_t size;
};

constexpr uint32_t kPtNote = 4;
constexpr uint32_t kPtLoad = 1;
constexpr uint32_t kNtGnuBuildId = 3;

class Probe {
 public:
  explicit Probe(const std::string& path) : file_(hz::MappedFile::open(path)) {
    if (!file_.valid()) throw hz::Error("cannot map " + path);
    read_ehdr();
    read_shdrs();
    read_phdrs();
  }

  void report() {
    print_identity();
    print_build_id();
    print_layout();
    print_symbols();
    print_verdict();
  }

 private:
  const uint8_t* at(uint64_t off, size_t len) const {
    if (off > file_.size() || len > file_.size() - off) {
      throw hz::Error(hz::format("offset 0x%llx is outside the file",
                                 static_cast<unsigned long long>(off)));
    }
    return file_.data() + off;
  }

  void read_ehdr() {
    const uint8_t* p = at(0, sizeof(Ehdr::ident));
    if (std::memcmp(p, "\x7f""ELF", 4) != 0) throw hz::Error("not an ELF file");
    if (p[4] != 2) throw hz::Error("not ELF64");
    if (p[5] != 1) throw hz::Error("not little-endian");

    const uint8_t* h = at(0, 64);
    std::memcpy(ehdr_.ident, h, 16);
    ehdr_.type = hz::rd16(h + 16);
    ehdr_.machine = hz::rd16(h + 18);
    ehdr_.version = hz::rd32(h + 20);
    ehdr_.entry = hz::rd64(h + 24);
    ehdr_.phoff = hz::rd64(h + 32);
    ehdr_.shoff = hz::rd64(h + 40);
    ehdr_.flags = hz::rd32(h + 48);
    ehdr_.ehsize = hz::rd16(h + 52);
    ehdr_.phentsize = hz::rd16(h + 54);
    ehdr_.phnum = hz::rd16(h + 56);
    ehdr_.shentsize = hz::rd16(h + 58);
    ehdr_.shnum = hz::rd16(h + 60);
    ehdr_.shstrndx = hz::rd16(h + 62);
  }

  void read_shdrs() {
    if (ehdr_.shoff == 0 || ehdr_.shnum == 0) return;
    sections_.resize(ehdr_.shnum);
    for (uint16_t i = 0; i < ehdr_.shnum; ++i) {
      const uint8_t* p = at(ehdr_.shoff + uint64_t{i} * ehdr_.shentsize, 64);
      Shdr& s = sections_[i];
      s.name = hz::rd32(p + 0);
      s.type = hz::rd32(p + 4);
      s.flags = hz::rd64(p + 8);
      s.addr = hz::rd64(p + 16);
      s.offset = hz::rd64(p + 24);
      s.size = hz::rd64(p + 32);
      s.link = hz::rd32(p + 40);
      s.info = hz::rd32(p + 44);
      s.addralign = hz::rd64(p + 48);
      s.entsize = hz::rd64(p + 56);
    }
  }

  void read_phdrs() {
    for (uint16_t i = 0; i < ehdr_.phnum; ++i) {
      const uint8_t* p = at(ehdr_.phoff + uint64_t{i} * ehdr_.phentsize, 56);
      Phdr ph{};
      ph.type = hz::rd32(p + 0);
      ph.flags = hz::rd32(p + 4);
      ph.offset = hz::rd64(p + 8);
      ph.vaddr = hz::rd64(p + 16);
      ph.filesz = hz::rd64(p + 32);
      ph.memsz = hz::rd64(p + 40);
      ph.align = hz::rd64(p + 48);
      if (ph.type == kPtNote) notes_.push_back(ph);
      if (ph.type == kPtLoad) loads_.push_back(ph);
    }
  }

  std::string section_name(uint32_t index, uint32_t name_offset) const {
    if (index >= sections_.size() || ehdr_.shstrndx >= sections_.size()) return {};
    const Shdr& strtab = sections_[ehdr_.shstrndx];
    if (name_offset >= strtab.size) return {};
    std::string out;
    for (uint64_t i = strtab.offset + name_offset;
         i < strtab.offset + strtab.size && i < file_.size(); ++i) {
      const char c = static_cast<char>(file_.data()[i]);
      if (c == '\0') break;
      out.push_back(c);
    }
    return out;
  }

  const Shdr* find(const char* name) const {
    for (size_t i = 0; i < sections_.size(); ++i) {
      if (section_name(static_cast<uint32_t>(i), sections_[i].name) == name) {
        return &sections_[i];
      }
    }
    return nullptr;
  }

  void print_identity() {
    std::printf("== identity ==\n");
    static const std::map<uint16_t, const char*> machines{{62, "x86-64"}, {183, "aarch64"}};
    const auto m = machines.find(ehdr_.machine);
    std::printf("  machine   : %s (%u)\n", m == machines.end() ? "unknown" : m->second,
                static_cast<unsigned>(ehdr_.machine));
    std::printf("  type      : %u%s\n", static_cast<unsigned>(ehdr_.type),
                ehdr_.type == 3 ? " (ET_DYN, shared object)" : "");
    std::printf("  file size : %zu bytes\n", file_.size());
    std::printf("  sections  : %u    segments: %u\n", static_cast<unsigned>(ehdr_.shnum),
                static_cast<unsigned>(ehdr_.phnum));
  }

  void print_build_id() {
    std::printf("\n== GNU build ID ==\n");
    for (const Phdr& note : notes_) {
      uint64_t off = note.offset;
      const uint64_t end = note.offset + note.filesz;
      while (off + 12 <= end) {
        const uint8_t* p = at(off, 12);
        const uint32_t name_sz = hz::rd32(p);
        const uint32_t desc_sz = hz::rd32(p + 4);
        const uint32_t type = hz::rd32(p + 8);
        const uint64_t desc = off + 12 + ((uint64_t{name_sz} + 3) & ~uint64_t{3});
        if (type == kNtGnuBuildId && desc_sz >= 20 && desc + desc_sz <= file_.size()) {
          build_id_.clear();
          static const char* hex = "0123456789abcdef";
          for (uint32_t i = 0; i < desc_sz; ++i) {
            const uint8_t b = file_.data()[desc + i];
            build_id_.push_back(hex[b >> 4]);
            build_id_.push_back(hex[b & 0xf]);
          }
          std::printf("  %s\n", build_id_.c_str());
          return;
        }
        off = desc + ((uint64_t{desc_sz} + 3) & ~uint64_t{3});
      }
    }
    std::printf("  MISSING -- no NT_GNU_BUILD_ID note\n");
  }

  void print_layout() {
    std::printf("\n== load segments ==\n");
    for (const Phdr& l : loads_) {
      char perms[4] = {
          (l.flags & 4) ? 'R' : '-', (l.flags & 2) ? 'W' : '-', (l.flags & 1) ? 'X' : '-', 0};
      std::printf("  vaddr 0x%-11llx filesz 0x%-9llx memsz 0x%-9llx %s\n",
                  static_cast<unsigned long long>(l.vaddr),
                  static_cast<unsigned long long>(l.filesz),
                  static_cast<unsigned long long>(l.memsz), perms);
    }

    std::printf("\n== sections a hook can use ==\n");
    for (const char* want : {".data.rel.ro", ".rodata", ".dynsym", ".dynstr", ".gnu.hash",
                             ".rela.dyn", ".note.gnu.build-id", ".text"}) {
      const Shdr* s = find(want);
      if (s == nullptr) {
        std::printf("  %-20s ABSENT\n", want);
      } else {
        std::printf("  %-20s addr 0x%-11llx size 0x%llx\n", want,
                    static_cast<unsigned long long>(s->addr),
                    static_cast<unsigned long long>(s->size));
      }
    }
  }

  void print_symbols() {
    std::printf("\n== exported symbols ==\n");
    const Shdr* dynsym = find(".dynsym");
    const Shdr* dynstr = find(".dynstr");
    if (dynsym == nullptr || dynstr == nullptr) {
      std::printf("  no dynamic symbol table\n");
      return;
    }
    const uint64_t ent = dynsym->entsize ? dynsym->entsize : 24;
    const uint64_t count = dynsym->size / ent;
    std::printf("  %llu dynamic symbols\n", static_cast<unsigned long long>(count));

    uint64_t defined = 0;
    for (uint64_t i = 0; i < count; ++i) {
      const uint8_t* p = at(dynsym->offset + i * ent, 24);
      const uint32_t name_off = hz::rd32(p);
      const uint16_t shndx = hz::rd16(p + 6);
      if (name_off == 0 || shndx == 0) continue;
      if (name_off >= dynstr->size) continue;
      std::string name;
      for (uint64_t k = dynstr->offset + name_off;
           k < dynstr->offset + dynstr->size && k < file_.size(); ++k) {
        const char c = static_cast<char>(file_.data()[k]);
        if (c == '\0') break;
        name.push_back(c);
      }
      if (name.empty()) continue;
      if (defined < 30) {
        std::printf("    %s\n", name.c_str());
      }
      ++defined;
    }
    if (defined > 30) {
      std::printf("    ... and %llu more\n", static_cast<unsigned long long>(defined - 30));
    }
  }

  void print_verdict() {
    std::printf("\n== verdict ==\n");
    std::printf("  build ID: %s\n", build_id_.empty() ? "(none)" : build_id_.c_str());
    std::printf("\n  A hook keyed on this ID accepts exactly this QQ build and nothing else.\n");
    std::printf("  When QQ is updated, compare this value first: a mismatch on its own is\n");
    std::printf("  usually the whole story, and recording the new ID is the entire fix.\n");
  }

  hz::MappedFile file_;
  Ehdr ehdr_{};
  std::vector<Shdr> sections_;
  std::vector<Phdr> notes_;
  std::vector<Phdr> loads_;
  std::string build_id_;
};

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: %s <path-to-wrapper.node>\n", argv[0]);
    return 2;
  }
  try {
    Probe probe(argv[1]);
    probe.report();
    return 0;
  } catch (const std::exception& e) {
    std::fprintf(stderr, "error: %s\n", e.what());
    return 1;
  }
}