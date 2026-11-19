// Hand-written ELF loader that maps a shared object into another process.
//
// Why not just call dlopen in the target?  dlopen needs the proxy to be callable
// from a thread that can run the target's loader, and it refuses paths outside
// the target's loader search configuration.  Loading manually means we control
// the mapping, which is what lets a payload live in a runtime directory the
// target was never told about.
//
// The steps mirror what ld.so does, minus symbol interposition:
//   1. reserve one window covering all PT_LOAD segments
//   2. copy each segment to base + p_vaddr
//   3. apply RELA relocations, resolving symbols against what the target already
//      has mapped (wrapper.node and libc)
//   4. run DT_INIT / DT_INIT_ARRAY
//   5. return the handle so the caller can later run DT_FINI and unmap

#pragma once

#include "elf_image.h"
#include "remote.h"

#include <functional>

namespace hz {

// Returned to JavaScript and passed back on unload.
struct ManualMapHandle {
  uint64_t base = 0;
  uint64_t entry = 0;
  uint64_t size = 0;
  uint64_t exception_table = 0;  // .eh_frame_hdr address, 0 when absent
};

// Resolves a symbol name against the libraries already mapped in the target.
// Implemented by ManualLoader; exposed so callers can pre-flight a payload.
using SymbolResolver = std::function<std::optional<uint64_t>(std::string_view)>;

class ManualLoader {
 public:
  ManualLoader(RemoteProcess& remote, const ElfImage& image);

  // Maps the image and applies relocations.  Throws hz::Error with a specific
  // message on any inconsistency; on failure every mapping made so far is
  // released before the exception escapes.
  ManualMapHandle load();

 private:
  // Falls back to the payload's well-known start function when the image has no
  // e_entry, and finds .eh_frame_hdr so the unwinder can reach hook frames.
  uint64_t resolve_start_symbol(uint64_t base) const;
  uint64_t locate_eh_frame_hdr(uint64_t base) const;

 public:

  // Runs DT_FINI_ARRAY / DT_FINI and unmaps the image.
  void unload(const ManualMapHandle& handle);

  // Number of relocations applied, for diagnostics.
  size_t relocations_applied() const { return relocations_applied_; }

 private:
  // Reserves a window for the image.  Uses remote_mmap so the target's own VMA
  // accounting stays consistent.
  uint64_t reserve_image();

  void copy_segments(uint64_t base);

  // Walks the target's maps to find where a given soname is loaded, then looks a
  // symbol up in that image's dynamic symbol table.
  std::optional<uint64_t> resolve_remote_symbol(std::string_view name);

  void apply_relocations(uint64_t base);
  void run_init(uint64_t base);

  // Looks up a soname in the target's /proc/<pid>/maps.  Returns its base address.
  std::optional<uint64_t> find_loaded_module(std::string_view soname);

  // Returns the on-disk path backing a soname, taken from the target's maps.
  std::string resolve_module_path(std::string_view soname);

  RemoteProcess& remote_;
  const ElfImage& image_;
  size_t relocations_applied_ = 0;

  // Cache of module base addresses keyed by resolved path.
  std::map<std::string, uint64_t> module_bases_;
};

// Raised when a symbol cannot be found anywhere in the target.  The name is
// carried so the failure names the missing symbol instead of just a code.
class UnresolvedSymbol : public Error {
 public:
  UnresolvedSymbol(std::string symbol, std::string message)
      : Error(std::move(message)), symbol_(std::move(symbol)) {}
  const std::string& symbol() const { return symbol_; }

 private:
  std::string symbol_;
};

}  // namespace hz
