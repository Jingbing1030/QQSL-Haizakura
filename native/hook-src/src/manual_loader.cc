#include "manual_loader.h"

#include <algorithm>
#include <cstdio>
#include <cstring>

namespace hz {
namespace {

// PROT_* / MAP_* values are passed straight to the target's mmap, so they must be
// the kernel ABI constants rather than whatever the host headers define.  On
// Linux these are stable and identical across architectures.
constexpr int kProtRead = 1;
constexpr int kProtWrite = 2;
constexpr int kProtExec = 4;
constexpr int kMapPrivate = 0x02;
constexpr int kMapAnonymous = 0x20;

int prot_for(uint32_t flags) {
  int prot = 0;
  if (flags & elf::kPfR) prot |= kProtRead;
  if (flags & elf::kPfW) prot |= kProtWrite;
  if (flags & elf::kPfX) prot |= kProtExec;
  return prot;
}

// All supported Linux targets use 4 KiB pages.
constexpr uint64_t kPageSize = 4096;
constexpr uint64_t align_down(uint64_t v) { return v & ~(kPageSize - 1); }
constexpr uint64_t align_up(uint64_t v) { return align_down(v + kPageSize - 1); }

}  // namespace

ManualLoader::ManualLoader(RemoteProcess& remote, const ElfImage& image)
    : remote_(remote), image_(image) {}

std::string ManualLoader::resolve_module_path(std::string_view soname) {
  std::string maps;
  try {
    maps = read_file_text(format("/proc/%d/maps", remote_.pid()), 32u << 20);
  } catch (const Error&) {
    return {};
  }

  // A library appears once per mapping (several lines).  Prefer the shortest
  // matching path: it is the one without a " (deleted)" suffix.
  std::string best;
  size_t pos = 0;
  while (pos < maps.size()) {
    const size_t eol = maps.find('\n', pos);
    const std::string line =
        maps.substr(pos, eol == std::string::npos ? std::string::npos : eol - pos);
    pos = (eol == std::string::npos) ? maps.size() : eol + 1;

    const size_t slash = line.find('/');
    if (slash == std::string::npos) continue;
    const std::string path = line.substr(slash);
    if (path.find(soname) == std::string::npos) continue;
    if (best.empty() || path.size() < best.size()) best = path;
  }
  return best;
}

std::optional<uint64_t> ManualLoader::find_loaded_module(std::string_view soname) {
  const auto key = std::string(soname);
  if (const auto it = module_bases_.find(key); it != module_bases_.end()) {
    return it->second;
  }
  const auto base = remote_.find_loaded_module(soname);
  if (base) module_bases_[key] = *base;
  return base;
}

std::optional<uint64_t> ManualLoader::resolve_remote_symbol(std::string_view name) {
  // Search the libraries named in DT_NEEDED first, then the ones a payload
  // reliably links against.  wrapper.node is included because the injected
  // payload calls back into QQ's own code.
  static constexpr const char* kWellKnown[] = {
      "libc", "libm", "libdl", "libpthread", "libstdc++", "libgcc_s", "wrapper.node"};

  std::vector<std::string> order;
  for (const auto& n : image_.needed()) order.push_back(n);
  for (const char* n : kWellKnown) {
    if (std::find(order.begin(), order.end(), n) == order.end()) order.emplace_back(n);
  }

  for (const auto& soname : order) {
    const auto base = find_loaded_module(soname);
    if (!base) continue;

    // Parse the library from disk rather than walking its remote dynamic section:
    // the file is already in the page cache in practice, and reading a hash table
    // element by element over ptrace would be orders of magnitude slower.
    const std::string path = resolve_module_path(soname);
    if (path.empty()) continue;

    try {
      ElfImage lib(MappedFile::open(path));
      if (const DynSymbol* sym = lib.find_symbol(name)) {
        if (!sym->defined) continue;
        const uint64_t addr = *base + (sym->value - lib.image_base());

        // STT_GNU_IFUNC is not a function, it is a *function that returns the
        // function*.  glibc implements strlen, memcpy, memset, strcmp and friends
        // as IFUNCs so the dynamic loader can pick an AVX-512 or SSE4 variant at
        // first use; their st_value is the resolver's address.
        //
        // Returning st_value verbatim hands the payload a pointer to the address
        // of the implementation.  Every call then produces garbage that looks
        // plausible: a payload's strlen(control) returned 0x750aed59a940, so its
        // "path too long" check fired, start_dynamic returned -1, no socket was
        // ever created, and the caller reported "the hook did not start".  A
        // memcpy resolved this way writes wherever the pointer says.  This is by
        // far the most common way a hand-written ELF loader breaks on glibc and
        // it fails in the payload, not in the loader, which is why it is fixed
        // here rather than worked around per payload.
        //
        // Calling the resolver from the tracee is the only correct answer:
        // IFUNC resolvers may read CPU features (via getauxval/IFUNC-only
        // relocation) and are not guaranteed to be pure address arithmetic.
        //
        // The guard matters: without it every symbol -- including plain data
        // objects like `stdout` -- would be "called" as a resolver.  Executing a
        // data page produces garbage return values that look plausible, and the
        // corruption only shows up much later, in the payload.
        if (!sym->is_ifunc) return addr;
        return remote_.call_ifunc_resolver(addr);
      }
    } catch (const Error&) {
      continue;
    }
  }
  return std::nullopt;
}

uint64_t ManualLoader::reserve_image() {
  // One mmap for the whole window keeps the segments contiguous, which all
  // relative addressing inside the payload depends on.  Protection is granted
  // up front rather than per-segment because relocation writes into the image.
  const uint64_t addr = remote_.remote_mmap(image_.image_size(),
                                            kProtRead | kProtWrite | kProtExec,
                                            kMapPrivate | kMapAnonymous);
  if (addr == 0) {
    fail(format("remote mmap failed reserving 0x%llx bytes for the payload",
                static_cast<unsigned long long>(image_.image_size())));
  }
  return addr;
}

void ManualLoader::copy_segments(uint64_t base) {
  for (const auto& h : image_.program_headers()) {
    if (h.type != elf::kPtLoad) continue;
    if (h.filesz == 0) continue;

    // The target window starts at `base` and corresponds to image_base() in the
    // file's address space, so the destination shifts by that difference.
    const uint64_t dest = base + (h.vaddr - image_.image_base());
    const uint8_t* src = image_.at(h.vaddr, static_cast<size_t>(h.filesz));
    remote_.write_exact(dest, src, static_cast<size_t>(h.filesz));
    // The zero-fill tail needs no work: the anonymous mapping starts zeroed and
    // only filesz bytes were written.
  }
}

void ManualLoader::apply_relocations(uint64_t base) {
  const auto& symbols = image_.symbols();
  const uint64_t image_lo = base;
  const uint64_t image_hi = base + image_.image_size();

  auto define_value = [&](const DynSymbol& sym) -> uint64_t {
    return base + (sym.value - image_.image_base());
  };

  auto need_external = [&](const DynSymbol& sym) -> uint64_t {
    const auto resolved = resolve_remote_symbol(sym.name);
    if (resolved) return *resolved;

    // A weak undefined symbol is allowed to resolve to zero: that is how
    // _ITM_deregisterTMCloneTable, __gmon_start__ and __cxa_finalize appear in
    // every normal DSO.  Treating them as fatal would reject valid payloads.
    if (sym.bind == 2 /* STB_WEAK */) return 0;

    throw UnresolvedSymbol(
        sym.name, format("failed to resolve remote symbol %s", sym.name.c_str()));
  };

  for (const auto& rel : image_.relocations()) {
    const uint32_t sym_index = static_cast<uint32_t>(rel.info >> 32);
    const uint32_t type = static_cast<uint32_t>(rel.info & 0xffffffffu);

    if (rel.offset < image_.image_base() ||
        rel.offset + sizeof(uint64_t) > image_.image_base() + image_.image_size()) {
      fail(format("relocation offset 0x%llx is outside mapped image",
                  static_cast<unsigned long long>(rel.offset)));
    }
    const uint64_t where = base + (rel.offset - image_.image_base());

    const DynSymbol* sym = nullptr;
    if (sym_index != 0) {
      if (sym_index >= symbols.size()) {
        fail(format("relocation references symbol index %u out of range (%zu symbols)",
                    sym_index, symbols.size()));
      }
      sym = &symbols[sym_index];
    }

    uint64_t value = 0;
    bool writes = true;

    if (image_.is_x86_64()) {
      switch (type) {
        case elf::kRx86_64None:
          writes = false;
          break;
        case elf::kRx86_64Relative:
          value = base + static_cast<uint64_t>(rel.addend);
          break;
        case elf::kRx86_64Irelative:
          value = where + static_cast<uint64_t>(rel.addend);
          break;
        case elf::kRx86_64_64:
        case elf::kRx86_64GlobDat:
        case elf::kRx86_64JumpSlot: {
          if (sym == nullptr) fail("undefined relocation has no symbol name");
          const uint64_t target = sym->defined ? define_value(*sym) : need_external(*sym);
          value = target + static_cast<uint64_t>(rel.addend);
          break;
        }
        case elf::kRx86_64Pc32: {
          if (sym == nullptr) fail("undefined relocation has no symbol name");
          const uint64_t target = sym->defined ? define_value(*sym) : need_external(*sym);
          const int64_t delta = static_cast<int64_t>(target) +
                                static_cast<int64_t>(rel.addend) -
                                static_cast<int64_t>(where);
          value = static_cast<uint64_t>(static_cast<uint32_t>(delta));
          break;
        }
        case elf::kRx86_64Copy:
          // COPY relocations only appear in executables, never in a DSO, so
          // reaching this means the caller handed us the wrong kind of file.
          fail("COPY relocations are not valid in a shared object payload");
        case elf::kRx86_64Tpoff64:
        case elf::kRx86_64DtpMod64:
        case elf::kRx86_64DtpOff64:
        case elf::kRx86_64TlsGotpcrel:
        case elf::kRx86_64Tprel64:
        case elf::kRx86_64TprelDyn:
          fail(
              "payload uses thread-local storage (TLS relocation), which the manual loader does "
              "not implement: a manually mapped image has no TLS block, so there is nowhere for "
              "these relocations to point.  Removing the thread_local from the payload is the "
              "fix; scaling the loader's TLS support up would mean allocating and registering a "
              "TLS block, which no QQ hook needs yet");
        default:
          fail(format("unsupported x86_64 ELF relocation type %u", type));
      }
    } else if (image_.is_aarch64()) {
      switch (type) {
        case elf::kRaarch64None:
          writes = false;
          break;
        case elf::kRaarch64Relative:
          value = base + static_cast<uint64_t>(rel.addend);
          break;
        case elf::kRaarch64Abs64:
        case elf::kRaarch64GlobDat:
        case elf::kRaarch64JumpSlot: {
          if (sym == nullptr) fail("undefined relocation has no symbol name");
          const uint64_t target = sym->defined ? define_value(*sym) : need_external(*sym);
          value = target + static_cast<uint64_t>(rel.addend);
          break;
        }
        case elf::kRaarch64Copy:
          fail("COPY relocations are not valid in a shared object payload");
        case elf::kRaarch64TlsDtpMod64:
        case elf::kRaarch64TlsDtpOff64:
        case elf::kRaarch64Tprel64:
        case elf::kRaarch64TlsDesc:
          fail(
              "payload uses thread-local storage (TLS relocation), which the manual loader does "
              "not implement: a manually mapped image has no TLS block, so there is nowhere for "
              "these relocations to point.  Removing the thread_local from the payload is the "
              "fix.  Note that wrapper.node itself contains TLS relocations (27 of them) -- that "
              "is fine, because QQ's own loader maps it; only the injected payload has to avoid "
              "them");
        default:
          fail(format("unsupported aarch64 ELF relocation type %u", type));
      }
    } else {
      fail("unsupported ELF machine");
    }

    if (!writes) continue;
    if (where < image_lo || where + sizeof(uint64_t) > image_hi) {
      fail("relocation destination is outside the mapped image");
    }
    remote_.write_value<uint64_t>(where, value);
    ++relocations_applied_;
  }
}

void ManualLoader::run_init(uint64_t base) {
  // DT_INIT_ARRAY is what registers a payload's static constructors.  Each entry
  // is a virtual address relative to image_base().
  for (const uint64_t fn : image_.init_functions()) {
    if (fn == 0) continue;
    const uint64_t target = base + (fn - image_.image_base());
    remote_.remote_call(target, {}, 0);
  }
}

std::optional<uint64_t> ManualLoader::symbol(const ManualMapHandle& handle,
                                             std::string_view name) {
  // Look the name up in the image we just mapped, by base -- not through the
  // target's dynamic loader.  The payload is not in the target's link map, so
  // dlsym-style resolution cannot see it, and a name that also exists in a real
  // module would resolve to that module instead.
  const DynSymbol* sym = image_.find_symbol(name);
  if (sym == nullptr || !sym->defined || sym->value == 0) return std::nullopt;
  // st_value is image-relative in the file; subtract the image's own base to get
  // an offset, then add where the loader actually put it.  Adding st_value to the
  // mapping base directly would be wrong whenever image_base() is non-zero.
  const uint64_t addr = handle.base + (sym->value - image_.image_base());
  // Same IFUNC rule as relocation: st_value is the resolver for those.
  if (!sym->is_ifunc) return addr;
  return remote_.call_ifunc_resolver(addr);
}

uint64_t ManualLoader::resolve_start_symbol(uint64_t base) const {
  // Ordered by preference: the dynamic hook is what actually starts the payload,
  // the version symbol is only useful as a last resort for identification.
  for (const char* name : {"snowluma_linux_hook_start_dynamic",
                           "haizakura_linux_hook_start_dynamic"}) {
    const DynSymbol* sym = image_.find_symbol(name);
    if (sym == nullptr || !sym->defined || sym->value == 0) continue;
    return base + (sym->value - image_.image_base());
  }
  return 0;
}

uint64_t ManualLoader::locate_eh_frame_hdr(uint64_t base) const {
  for (const SectionInfo& sec : image_.sections()) {
    if (sec.name != ".eh_frame_hdr" || sec.size == 0) continue;
    return base + (sec.addr - image_.image_base());
  }
  return 0;
}

ManualMapHandle ManualLoader::load() {
  ManualMapHandle handle;
  handle.base = reserve_image();
  handle.size = image_.image_size();
  // Linux shared objects normally carry no e_entry -- the field is optional for
  // ET_DYN and this payload leaves it zero.  Returning 0 there was wrong in a way
  // that looked harmless: the caller uses `entry` to locate the code that starts
  // the hook, and got a null address, so nothing ran and nothing errored.
  //
  // Payloads of this shape expose a known start function instead, so fall back to
  // it.  The name is part of the payload ABI, not a guess.
  handle.entry =
      image_.entry() != 0 ? handle.base + (image_.entry() - image_.image_base())
                          : resolve_start_symbol(handle.base);

  // The unwinder needs the module's .eh_frame_hdr to walk stack frames that pass
  // through hook code; without it a single exception unwinds the process.
  handle.exception_table = locate_eh_frame_hdr(handle.base);

  try {
    copy_segments(handle.base);
    apply_relocations(handle.base);



    run_init(handle.base);

    // A shared object's constructors only wire up static state; they do not
    // start the hook.  The payload exposes snowluma_linux_hook_start_dynamic for
    // that, and it is what creates the control and receive sockets the Node side
    // connects to.  Without this call the module maps successfully, entry points
    // at valid code, and nothing observable happens -- the caller then waits on a
    // channel that will never appear.
    // start_dynamic returns after creating the control and receive sockets; the
    // threads that serve them outlive it.  Waiting for the return matters because
    // the call needs a landing pad, and detaching before the callee returns would
    // leave that landing pad trapping with nobody to catch it -- which kills the
    // host process instead of starting the hook.
    if (handle.entry != 0) remote_.remote_call(handle.entry, {}, 0);
  } catch (const UnresolvedSymbol&) {
    // A missing symbol is fatal but recoverable-by-the-caller: release the window
    // so the target does not carry an unreachable executable region.
    remote_.remote_munmap(handle.base, handle.size);
    throw;
  } catch (...) {
    remote_.remote_munmap(handle.base, handle.size);
    throw;
  }

  return handle;
}

void ManualLoader::unload(const ManualMapHandle& handle) {
  if (handle.base == 0) fail("ManualMapHandle::base is 0");

  // Stop the module before tearing it down.
  //
  // Calling the stop entry is not optional politeness: the payload owns listening sockets, and
  // unmapping the image while they are still bound leaves them bound forever -- the file is
  // gone, so nothing can close them, and the next start fails with EADDRINUSE.  The symptom is
  // "the second injection broken", which sends you looking at the injector.
  //
  // Done before DT_FINI_ARRAY because the stop entry is what the payload understands as its own
  // lifecycle end; running destructors first would tear down the state it reads.
  {
    // Both spellings are accepted, matching resolve_start_symbol: a payload may be built under
    // either name and an unload that only knows one of them silently skips the stop.
    uint64_t stop = 0;
    for (const char* name : {"snowluma_linux_hook_stop_dynamic",
                             "haizakura_linux_hook_stop_dynamic"}) {
      const DynSymbol* sym = image_.find_symbol(name);
      if (sym == nullptr || !sym->defined || sym->value == 0) continue;
      stop = handle.base + (sym->value - image_.image_base());
      break;
    }
    if (stop != 0) {
      try {
        remote_.remote_call(stop, {}, 0);
      } catch (const Error&) {
        // A stop entry that faults must not prevent the unmap: the alternative is leaking the
        // whole mapping, which is worse than leaking a socket.
      }
    }
  }

  // Destructors run in reverse order, matching ld.so.
  const auto& fini = image_.fini_functions();
  for (auto it = fini.rbegin(); it != fini.rend(); ++it) {
    if (*it == 0) continue;
    const uint64_t target = handle.base + (*it - image_.image_base());
    try {
      remote_.remote_call(target, {}, 0);
    } catch (const Error&) {
      // A destructor that fails must not prevent the unmap below.
    }
  }

  if (!remote_.remote_munmap(handle.base, handle.size)) {
    fail(format("remote munmap failed for manual ELF image at 0x%llx",
                static_cast<unsigned long long>(handle.base)));
  }
}

}  // namespace hz
