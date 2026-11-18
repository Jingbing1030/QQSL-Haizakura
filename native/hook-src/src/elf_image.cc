#include "elf_image.h"

#include <algorithm>
#include <cstring>
#include <set>

namespace hz {
namespace {

// Every offset read from the file goes through this.  A shared object that lies
// about its own layout would otherwise make us read out of bounds and hand a
// garbage pointer to the target.
void require(bool condition, const char* message) {
  if (!condition) fail(message);
}

}  // namespace

ElfImage::ElfImage(MappedFile file) : file_(std::move(file)) {
  parse_headers();
  parse_dynamic();
  parse_symbols();
  parse_relocations();
  parse_init_fini();
  parse_needed();
}

void ElfImage::parse_headers() {
  require(file_.size() >= sizeof(Elf64Ehdr), "ELF file is too small for a header");
  const uint8_t* p = file_.data();

  require(p[0] == elf::kMagic[0] && p[1] == elf::kMagic[1] && p[2] == elf::kMagic[2] &&
              p[3] == elf::kMagic[3],
          "bad ELF magic");
  require(p[4] == elf::kClass64, "manual ELF loader supports only ELF64 images");
  require(p[5] == elf::kDataLsb,
          "manual ELF loader supports only little-endian images");

  ehdr_.type = rd16(p + 16);
  ehdr_.machine = rd16(p + 18);
  ehdr_.version = rd32(p + 20);
  ehdr_.entry = rd64(p + 24);
  ehdr_.phoff = rd64(p + 32);
  ehdr_.shoff = rd64(p + 40);
  ehdr_.phentsize = rd16(p + 54);
  ehdr_.phnum = rd16(p + 56);

  require(ehdr_.type == elf::kTypeShared || ehdr_.type == 1 /* ET_REL not supported */,
          "manual ELF loader supports only ET_DYN images");
  require(ehdr_.machine == elf::kMachineX86_64 || ehdr_.machine == elf::kMachineAarch64,
          "manual ELF loader supports only x86_64 and aarch64 images");
  require(ehdr_.phentsize >= sizeof(Elf64Phdr), "ELF program header entry size is unsupported");
  require(ehdr_.phnum > 0, "ELF program header table is invalid");
  require(ehdr_.phoff + static_cast<uint64_t>(ehdr_.phentsize) * ehdr_.phnum <= file_.size(),
          "ELF program header table is outside the file");

  phdrs_.reserve(ehdr_.phnum);
  uint64_t min_vaddr = UINT64_MAX;
  uint64_t max_vaddr = 0;
  for (uint16_t i = 0; i < ehdr_.phnum; ++i) {
    const uint8_t* ph = file_.data() + ehdr_.phoff + static_cast<uint64_t>(i) * ehdr_.phentsize;
    Elf64Phdr h{};
    h.type = rd32(ph + 0);
    h.flags = rd32(ph + 4);
    h.offset = rd64(ph + 8);
    h.vaddr = rd64(ph + 16);
    h.paddr = rd64(ph + 24);
    h.filesz = rd64(ph + 32);
    h.memsz = rd64(ph + 40);
    h.align = rd64(ph + 48);

    if (h.type == elf::kPtLoad) {
      require(h.offset + h.filesz <= file_.size(),
              "ELF loadable segment is outside the file");
      require(h.filesz <= h.memsz, "ELF loadable segment file size exceeds memory size");
      min_vaddr = std::min(min_vaddr, h.vaddr);
      max_vaddr = std::max(max_vaddr, h.vaddr + h.memsz);
    }
    phdrs_.push_back(h);
  }

  require(min_vaddr != UINT64_MAX, "ELF image has no PT_LOAD segment");

  // Round down/up to a page so the reserved window covers whole pages; the
  // kernel maps page granularity and a partial page would alias.
  const uint64_t page = 4096;
  image_base_ = min_vaddr & ~(page - 1);
  const uint64_t end = (max_vaddr + page - 1) & ~(page - 1);
  image_size_ = end - image_base_;
  require(image_size_ > 0 && image_size_ < (1ull << 32),
          "ELF image size is invalid or too large");
}

void ElfImage::parse_dynamic() {
  const Elf64Phdr* dyn = nullptr;
  for (const auto& h : phdrs_) {
    if (h.type == elf::kPtDynamic) {
      dyn = &h;
      break;
    }
  }
  require(dyn != nullptr, "ELF image has no PT_DYNAMIC segment");
  require(dyn->filesz % sizeof(Elf64Dyn) == 0,
          "PT_DYNAMIC size is not aligned to Elf64_Dyn");

  const size_t count = static_cast<size_t>(dyn->filesz / sizeof(Elf64Dyn));
  const uint8_t* p = at(dyn->vaddr, static_cast<size_t>(dyn->filesz));
  dyn_.reserve(count);
  for (size_t i = 0; i < count; ++i) {
    Elf64Dyn d{};
    d.tag = static_cast<int64_t>(rd64(p + i * 16));
    d.val = rd64(p + i * 16 + 8);
    if (d.tag == elf::kDtNull) break;
    dyn_index_[d.tag] = d.val;
    dyn_.push_back(d);
  }
  require(!dyn_.empty(), "ELF dynamic section is empty");
}

std::optional<uint64_t> ElfImage::dynamic_value(int64_t tag) const {
  const auto it = dyn_index_.find(tag);
  if (it == dyn_index_.end()) return std::nullopt;
  return it->second;
}

const uint8_t* ElfImage::at(uint64_t vaddr, size_t len) const {
  require(vaddr >= image_base_, "virtual address is below the image base");

  // Find the PT_LOAD segment that owns this address and translate through its
  // p_offset.  Linkers are free to place p_vaddr != p_offset, so the identity
  // mapping is only correct for the common case and must not be assumed.
  for (const auto& h : phdrs_) {
    if (h.type != elf::kPtLoad) continue;
    if (vaddr < h.vaddr) continue;
    if (vaddr + len > h.vaddr + h.filesz) continue;

    const uint64_t off = h.offset + (vaddr - h.vaddr);
    require(off + len <= file_.size(), "segment data is outside the file");
    return file_.data() + off;
  }

  // Addresses inside a segment's zero-fill tail (memsz > filesz) have no file
  // backing. Callers must not ask for them; report precisely which case it was.
  for (const auto& h : phdrs_) {
    if (h.type != elf::kPtLoad) continue;
    if (vaddr >= h.vaddr && vaddr < h.vaddr + h.memsz) {
      fail(format("virtual address 0x%llx is in the zero-fill tail of a segment",
                  static_cast<unsigned long long>(vaddr)));
    }
  }

  fail(format("virtual address 0x%llx is outside the mapped image",
              static_cast<unsigned long long>(vaddr)));
}

void ElfImage::parse_symbols() {
  const auto strtab_opt = dynamic_value(elf::kDtStrtab);
  const auto symtab_opt = dynamic_value(elf::kDtSymtab);
  const auto strsz_opt = dynamic_value(elf::kDtStrsz);

  if (!strtab_opt || !symtab_opt) return;  // stripped of dynamic symtab

  const uint64_t strtab = *strtab_opt;
  const uint64_t symtab = *symtab_opt;
  const uint64_t strsz = strsz_opt.value_or(0);
  uint64_t syment = dynamic_value(elf::kDtSyment).value_or(sizeof(Elf64Sym));
  if (syment == 0) syment = sizeof(Elf64Sym);
  require(syment >= sizeof(Elf64Sym), "ELF dynamic symbol entry size is unsupported");

  // The symbol count is not in the dynamic section; derive it from the GNU hash
  // table when present, otherwise scan until the string table ends.
  uint64_t symcount = 0;
  if (const auto hash = dynamic_value(elf::kDtGnuHash)) {
    // Layout: nbuckets, symoffset, bloom_size, bloom_shift, bloom[...], buckets[], chain[]
    const uint8_t* h = at(*hash, 16);
    gnu_nbuckets_ = rd32(h + 0);
    gnu_symoffset_ = rd32(h + 4);
    gnu_bloom_size_ = rd32(h + 8);
    gnu_bloom_shift_ = rd32(h + 12);

    const size_t bloom_bytes = static_cast<size_t>(gnu_bloom_size_) * 8;
    const uint8_t* buckets = at(*hash + 16 + bloom_bytes,
                                static_cast<size_t>(gnu_nbuckets_) * 4);
    uint32_t max_bucket = 0;
    for (uint32_t i = 0; i < gnu_nbuckets_; ++i) {
      max_bucket = std::max(max_bucket, rd32(buckets + i * 4));
    }
    if (max_bucket >= gnu_symoffset_) {
      // Walk the chain of the bucket that reaches furthest to find the end.
      const uint8_t* chains = buckets + static_cast<size_t>(gnu_nbuckets_) * 4;
      uint32_t idx = max_bucket;
      for (;;) {
        const uint32_t value = rd32(chains + static_cast<size_t>(idx - gnu_symoffset_) * 4);
        if (value & 1u) {  // end of chain
          ++idx;
          break;
        }
        ++idx;
      }
      symcount = idx;
    } else {
      symcount = gnu_symoffset_;
    }
    has_gnu_hash_ = true;
  }

  if (symcount == 0) {
    // No hash table: bound the scan by the string table, which sits after the
    // symbol table in every layout produced by a normal linker.
    if (strtab > symtab) {
      symcount = (strtab - symtab) / syment;
    } else {
      fail("failed to determine dynamic symbol count");
    }
  }

  symbols_.reserve(symcount);
  for (uint64_t i = 0; i < symcount; ++i) {
    const uint8_t* s = at(symtab + i * syment, sizeof(Elf64Sym));
    DynSymbol sym{};
    sym.name = "";
    const uint32_t name_off = rd32(s + 0);
    sym.name = std::string(reinterpret_cast<const char*>(at(strtab + name_off, 1)));
    sym.value = rd64(s + 8);
    sym.size = rd64(s + 16);
    sym.bind = s[4] >> 4;
    sym.type = s[4] & 0xf;
    sym.shndx = rd16(s + 6);
    sym.defined = sym.shndx != elf::kShnUndef && sym.value != 0;
    sym.is_ifunc = sym.type == 10;  // STT_GNU_IFUNC
    symbol_index_.emplace(sym.name, symbols_.size());
    symbols_.push_back(std::move(sym));
  }
}

const DynSymbol* ElfImage::find_symbol(std::string_view name) const {
  if (const DynSymbol* s = lookup_gnu_hash(name)) return s;
  return nullptr;
}

const DynSymbol* ElfImage::lookup_gnu_hash(std::string_view name) const {
  const auto it = symbol_index_.find(std::string(name));
  if (it == symbol_index_.end()) return nullptr;
  return &symbols_[it->second];
}

void ElfImage::parse_relocations() {
  const auto rela = dynamic_value(elf::kDtRela);
  const auto relasz = dynamic_value(elf::kDtRelaSz);
  if (!rela || !relasz) return;

  uint64_t relaent = dynamic_value(elf::kDtRelaEnt).value_or(sizeof(Elf64Rela));
  if (relaent == 0) relaent = sizeof(Elf64Rela);
  require(relaent >= sizeof(Elf64Rela), "ELF RELA table entry size is unsupported");
  require(*relasz % relaent == 0, "ELF RELA table size is not aligned");

  const size_t count = static_cast<size_t>(*relasz / relaent);
  const uint8_t* p = at(*rela, static_cast<size_t>(*relasz));
  relas_.reserve(count);
  for (size_t i = 0; i < count; ++i) {
    Elf64Rela r{};
    r.offset = rd64(p + i * relaent + 0);
    r.info = rd64(p + i * relaent + 8);
    r.addend = static_cast<int64_t>(rd64(p + i * relaent + 16));
    relas_.push_back(r);
  }

  // .rela.plt holds the JUMP_SLOT entries.  A normal DSO resolves these lazily
  // through its PLT; a manually mapped image has no resolver, so they must be
  // applied up front.  Skipping this leaves every imported function's GOT slot
  // pointing at a PLT stub whose own GOT entry is still zero.
  const auto jmprel = dynamic_value(elf::kDtJmprel);
  const auto pltsz = dynamic_value(elf::kDtPltRelSz);
  if (jmprel && pltsz && *pltsz > 0) {
    require(*pltsz % relaent == 0, "ELF PLT relocation table size is not aligned");
    const size_t plt_count = static_cast<size_t>(*pltsz / relaent);
    const uint8_t* q = at(*jmprel, static_cast<size_t>(*pltsz));
    relas_.reserve(relas_.size() + plt_count);
    for (size_t i = 0; i < plt_count; ++i) {
      Elf64Rela r{};
      r.offset = rd64(q + i * relaent + 0);
      r.info = rd64(q + i * relaent + 8);
      r.addend = static_cast<int64_t>(rd64(q + i * relaent + 16));
      relas_.push_back(r);
    }
  }
}

void ElfImage::parse_needed() {
  // DT_NEEDED holds offsets into DT_STRTAB.  The loader uses these to know which
  // libraries must already be mapped in the target before relocation can resolve
  // their symbols.
  const auto strtab = dynamic_value(elf::kDtStrtab);
  if (!strtab) return;

  for (const auto& d : dyn_) {
    if (d.tag != elf::kDtNeeded) continue;
    const uint8_t* p = at(*strtab + d.val, 1);
    const std::string name(reinterpret_cast<const char*>(p));
    if (!name.empty()) needed_.push_back(name);
  }
}

void ElfImage::parse_init_fini() {
  // DT_INIT is deliberately kept apart from DT_INIT_ARRAY.  The `_init` stub that
  // DT_INIT points at assumes it is running inside ld.so's bootstrap: it reads
  // __gmon_start__ and calls it if non-null, then falls through into
  // frame_dummy/register_tm_clones, which touch __TMC_END__ and other symbols the
  // real loader would have fixed up.  Calling it from a manually mapped image
  // faults.  The constructors a payload actually needs live in .init_array.
  if (const auto init = dynamic_value(elf::kDtInit)) legacy_init_ = *init;

  if (const auto arr = dynamic_value(elf::kDtInitArray)) {
    const uint64_t sz = dynamic_value(elf::kDtInitArraySz).value_or(0);
    require(sz % 8 == 0, "DT_INIT_ARRAY size is not pointer-aligned");
    const uint8_t* p = at(*arr, static_cast<size_t>(sz));
    for (uint64_t i = 0; i < sz / 8; ++i) {
      const uint64_t fn = rd64(p + i * 8);
      if (fn != 0xffffffffffffffffull && fn != 0) init_fns_.push_back(fn);
    }
  }

  if (const auto arr = dynamic_value(elf::kDtFiniArray)) {
    const uint64_t sz = dynamic_value(elf::kDtFiniArraySz).value_or(0);
    const uint8_t* p = at(*arr, static_cast<size_t>(sz));
    for (uint64_t i = 0; i < sz / 8; ++i) {
      const uint64_t fn = rd64(p + i * 8);
      if (fn != 0xffffffffffffffffull && fn != 0) fini_fns_.push_back(fn);
    }
  }
  if (const auto fini = dynamic_value(elf::kDtFini)) fini_fns_.push_back(*fini);
}

}  // namespace hz
