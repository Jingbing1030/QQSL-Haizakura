// Minimal ELF64 view over an in-memory file image.
//
// Only what the loader needs: program headers, the dynamic section, the string
// and symbol tables, GNU hash lookup, and RELA relocations.  Every accessor
// validates the offset against the mapping and throws hz::Error rather than
// returning garbage — a hand-written loader that trusts offsets corrupts the
// target process instead of failing cleanly.

#pragma once

#include "common.h"

#include <map>

namespace hz {

// ELF constants we depend on.  <elf.h> would work but pulling it in alongside
// the Node headers invites name clashes, so the few values are repeated here.
namespace elf {

constexpr uint8_t kMagic[4] = {0x7f, 'E', 'L', 'F'};
constexpr int kClass64 = 2;
constexpr int kDataLsb = 1;
constexpr uint16_t kTypeShared = 3;   // ET_DYN
constexpr uint16_t kMachineX86_64 = 62;
constexpr uint16_t kMachineAarch64 = 183;

constexpr uint32_t kPtLoad = 1;
constexpr uint32_t kPtDynamic = 2;
constexpr uint32_t kPfX = 1;
constexpr uint32_t kPfW = 2;
constexpr uint32_t kPfR = 4;

constexpr int64_t kDtNull = 0;
constexpr int64_t kDtNeeded = 1;
constexpr int64_t kDtPltRelSz = 2;
// DT_JMPREL points at .rela.plt, which the dynamic linker uses for lazy binding.
// A manually mapped image has no PLT resolver, so these must be applied eagerly:
// leaving them unresolved leaves GOT slots holding link-time PLT stubs that jump
// to address zero.
constexpr int64_t kDtJmprel = 23;
constexpr int64_t kDtPltRel = 20;
constexpr int64_t kDtHash = 4;
constexpr int64_t kDtStrtab = 5;
constexpr int64_t kDtSymtab = 6;
constexpr int64_t kDtRela = 7;
constexpr int64_t kDtRelaSz = 8;
constexpr int64_t kDtRelaEnt = 9;
constexpr int64_t kDtStrsz = 10;
constexpr int64_t kDtSyment = 11;
constexpr int64_t kDtInit = 12;
constexpr int64_t kDtFini = 13;
constexpr int64_t kDtInitArray = 25;
constexpr int64_t kDtInitArraySz = 27;
constexpr int64_t kDtFiniArray = 26;
constexpr int64_t kDtFiniArraySz = 28;
constexpr int64_t kDtGnuHash = 0x6ffffef5;
constexpr int64_t kDtVerdef = 0x6ffffffc;
constexpr int64_t kDtVerdefNum = 0x6ffffffd;
constexpr int64_t kDtVerneed = 0x6ffffffe;
constexpr int64_t kDtVerneedNum = 0x6fffffff;

constexpr uint32_t kShnUndef = 0;

// Relocation types.  x86_64 uses RELA exclusively; aarch64 likewise.  TLS
// relocations are rejected: the injected payload never needs thread-locals and
// implementing them correctly requires touching the target's TLS block.
// Values from the x86-64 psABI (ELF64).  These are easy to get wrong: 6 is
// GLOB_DAT and 9 is TPOFF64, not the other way round.
constexpr uint32_t kRx86_64None = 0;
constexpr uint32_t kRx86_64_64 = 1;
constexpr uint32_t kRx86_64Pc32 = 2;
constexpr uint32_t kRx86_64Copy = 5;
constexpr uint32_t kRx86_64GlobDat = 6;
constexpr uint32_t kRx86_64JumpSlot = 7;
constexpr uint32_t kRx86_64Relative = 8;
constexpr uint32_t kRx86_64Gotpcrel = 19;
constexpr uint32_t kRx86_64TlsGotpcrel = 20;
constexpr uint32_t kRx86_64Tpoff64 = 18;
constexpr uint32_t kRx86_64DtpMod64 = 16;
constexpr uint32_t kRx86_64DtpOff64 = 17;
constexpr uint32_t kRx86_64Tprel64 = 22;
constexpr uint32_t kRx86_64TprelDyn = 23;
constexpr uint32_t kRx86_64Irelative = 37;

constexpr uint32_t kRaarch64None = 0;
constexpr uint32_t kRaarch64Abs64 = 257;
constexpr uint32_t kRaarch64GlobDat = 1025;
constexpr uint32_t kRaarch64JumpSlot = 1026;
constexpr uint32_t kRaarch64Relative = 1027;
constexpr uint32_t kRaarch64TlsDtpMod64 = 1028;
constexpr uint32_t kRaarch64TlsDtpOff64 = 1029;
constexpr uint32_t kRaarch64Tprel64 = 1031;
constexpr uint32_t kRaarch64Copy = 1024;

}  // namespace elf

struct Elf64Ehdr {
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

struct Elf64Phdr {
  uint32_t type;
  uint32_t flags;
  uint64_t offset;
  uint64_t vaddr;
  uint64_t paddr;
  uint64_t filesz;
  uint64_t memsz;
  uint64_t align;
};

struct Elf64Dyn {
  int64_t tag;
  uint64_t val;
};

struct Elf64Sym {
  uint32_t name;
  uint8_t info;
  uint8_t other;
  uint16_t shndx;
  uint64_t value;
  uint64_t size;
};

struct Elf64Rela {
  uint64_t offset;
  uint64_t info;
  int64_t addend;
};

// Dynamic symbol table entry paired with its version indices, which the loader
// needs to look names up in the target's libraries.
struct DynSymbol {
  std::string name;
  uint64_t value = 0;
  uint64_t size = 0;
  uint8_t bind = 0;
  uint8_t type = 0;
  uint16_t shndx = 0;
  bool defined = false;
  bool is_ifunc = false;
};

class ElfImage {
 public:
  // Parses headers and the dynamic section.  Throws on anything malformed.
  explicit ElfImage(MappedFile file);

  const MappedFile& file() const { return file_; }
  uint16_t machine() const { return ehdr_.machine; }
  uint16_t type() const { return ehdr_.type; }
  uint64_t entry() const { return ehdr_.entry; }
  const std::vector<Elf64Phdr>& program_headers() const { return phdrs_; }

  // Virtual address range covering every PT_LOAD segment, page aligned.  The
  // loader maps exactly this window so relative offsets stay valid.
  uint64_t image_base() const { return image_base_; }
  uint64_t image_size() const { return image_size_; }

  // Translate a virtual address to a pointer inside the mapping.  `len` bytes
  // must be readable, otherwise this throws.
  const uint8_t* at(uint64_t vaddr, size_t len) const;

  const std::vector<Elf64Dyn>& dynamic() const { return dyn_; }
  bool has(int64_t tag) const { return dyn_index_.count(tag) != 0; }
  std::optional<uint64_t> dynamic_value(int64_t tag) const;

  const std::vector<DynSymbol>& symbols() const { return symbols_; }
  const DynSymbol* find_symbol(std::string_view name) const;

  const std::vector<Elf64Rela>& relocations() const { return relas_; }
  const std::vector<std::string>& needed() const { return needed_; }

  // DT_INIT_ARRAY / DT_FINI_ARRAY entries, in the order the linker emitted them.
  const std::vector<uint64_t>& init_functions() const { return init_fns_; }

  // DT_INIT, if the image has one.  Exposed for diagnostics only: the loader never
  // calls it, because `_init` depends on ld.so's bootstrap having run.
  uint64_t legacy_init() const { return legacy_init_; }
  const std::vector<uint64_t>& fini_functions() const { return fini_fns_; }

  // Hash-table lookup for a locally defined dynamic symbol.
  const DynSymbol* lookup_gnu_hash(std::string_view name) const;

  bool is_x86_64() const { return ehdr_.machine == elf::kMachineX86_64; }
  bool is_aarch64() const { return ehdr_.machine == elf::kMachineAarch64; }

 private:
  void parse_headers();
  void parse_dynamic();
  void parse_symbols();
  void parse_relocations();
  void parse_init_fini();
  void parse_needed();
  void parse_versions();

  MappedFile file_;
  Elf64Ehdr ehdr_{};
  std::vector<Elf64Phdr> phdrs_;
  std::vector<Elf64Dyn> dyn_;
  std::map<int64_t, uint64_t> dyn_index_;
  std::vector<DynSymbol> symbols_;
  std::map<std::string, size_t> symbol_index_;
  std::vector<Elf64Rela> relas_;
  std::vector<std::string> needed_;
  std::vector<uint64_t> init_fns_;
  uint64_t legacy_init_ = 0;
  std::vector<uint64_t> fini_fns_;
  uint64_t image_base_ = 0;
  uint64_t image_size_ = 0;

  // GNU hash parameters, cached for lookup_gnu_hash().
  bool has_gnu_hash_ = false;
  uint32_t gnu_nbuckets_ = 0;
  uint32_t gnu_symoffset_ = 0;
  uint32_t gnu_bloom_size_ = 0;
  uint32_t gnu_bloom_shift_ = 0;
};

}  // namespace hz
