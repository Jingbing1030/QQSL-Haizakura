#include "vtable_hook.h"

#include <algorithm>
#include <cstring>

#include "common.h"

#include <sys/mman.h>

namespace hz {
namespace {

// A vtable's layout is fixed by the Itanium ABI:
//   [-2] offset-to-top      (ptrdiff_t, usually 0 or negative)
//   [-1] type_info pointer
//   [0]  first virtual function
// So slot 0 is preceded by exactly one pointer, and that pointer must land on a
// type_info whose first word is itself a vtable pointer.  Checking that the
// type_info's vptr looks like a vtable (rather than merely being non-zero) is
// what keeps random data from being read as a class.
constexpr uint32_t kTypeinfoVptrSlots = 3;  // __class_type_info's own vtable

// Page size for the mprotect calls.  Hardcoded rather than queried: the loader runs
// on exactly the two architectures QQ ships for, both of which use 4 KiB pages, and
// a sysconf() call would be one more thing to relocate.
constexpr uint64_t kPageSize = 4096;

// Demangles the subset of Itanium names a class hierarchy uses: N...E with
// length-prefixed components, and a leading digit for a nested name.  This is not
// a general demangler -- it exists so the class comparison is a string compare
// rather than a mangled-name compare, and it deliberately declines anything it
// does not understand instead of guessing.
std::string demangle_class(std::string_view mangled) {
  if (mangled.size() < 3 || mangled[0] != 'N') return {};
  // "St" is std::, which QQ's RTTI uses for its own std:: namespaces.
  std::vector<std::string> parts;
  size_t i = 1;
  while (i < mangled.size() && mangled[i] != 'E') {
    if (mangled.compare(i, 2, "St") == 0) {
      parts.emplace_back("std");
      i += 2;
      continue;
    }
    // A length prefix can be multi-digit (e.g. "10MSFService").
    size_t j = i;
    while (j < mangled.size() && mangled[j] >= '0' && mangled[j] <= '9') ++j;
    if (j == i) return {};  // an operator code or template -- decline
    const size_t len = static_cast<size_t>(std::stoul(std::string(mangled.substr(i, j - i))));
    if (j + len > mangled.size()) return {};
    parts.emplace_back(mangled.substr(j, len));
    i = j + len;
  }
  if (parts.empty()) return {};
  std::string out;
  for (size_t k = 0; k < parts.size(); ++k) {
    if (k != 0) out += "::";
    out += parts[k];
  }
  return out;
}

// Upper bound on how far into a slot's function the call scan looks.  A slot's function
// is normally a few hundred bytes; the cap only stops a pathological case (a slot whose
// next sibling is megabytes away) from turning discovery into a full-text scan.
constexpr uint64_t kMaxFunctionScan = 0x2000;

// Decodes a direct call at `vaddr`, reporting its target.
//
// The decoder is chosen by the IMAGE's machine type, not by the host's: a hook developer
// routinely analyses an aarch64 wrapper.node on an x86-64 workstation, and picking the
// host's decoder there silently finds zero call sites -- which reads as "this slot does
// not send" and sends you looking for the wrong slot.  Only *direct* calls are considered;
// an indirect call cannot be attributed to a specific callee, and QQ's send path uses
// direct branches.
bool decode_call_to(const ElfImage& image, uint64_t vaddr, uint64_t* out) {
  if (image.is_aarch64()) {
    uint32_t ins = 0;
    try {
      std::memcpy(&ins, image.at(vaddr, sizeof(ins)), sizeof(ins));
    } catch (const Error&) {
      return false;
    }
    // bl: 100101 imm26, offset = sign_extend(imm26) * 4
    if ((ins & 0xFC000000u) != 0x94000000u) return false;
    int32_t imm26 = static_cast<int32_t>(ins & 0x03FFFFFFu);
    if (imm26 & 0x02000000) imm26 -= 0x04000000;
    *out = vaddr + static_cast<int64_t>(imm26) * 4;
    return true;
  }
  uint8_t buf[5];
  try {
    std::memcpy(buf, image.at(vaddr, sizeof(buf)), sizeof(buf));
  } catch (const Error&) {
    return false;
  }
  if (buf[0] != 0xE8) return false;
  int32_t rel = 0;
  std::memcpy(&rel, buf + 1, 4);
  // The displacement is relative to the end of the instruction.
  *out = vaddr + 5 + static_cast<int64_t>(rel);
  return true;
}

}  // namespace

// ---------------------------------------------------------------------------
// Caveat: this reads the FILE, not the target's memory.
// ---------------------------------------------------------------------------
// A module built with -z relro keeps its vtables in .data.rel.ro and describes
// them with relative relocations, so the words in the file are already the final
// link-time values (image-relative).  wrapper.node is built that way, and this scan
// works on it.
//
// A position-independent .so can instead leave .data.rel.ro zero-filled and
// describe every pointer with an R_*_RELATIVE entry applied at load time.  On such
// a file this scan finds nothing -- not because the vtables are missing, but
// because their contents only exist in the loaded process.  Callers that need to
// support both shapes must take the vtable addresses from the live process (see
// find_vtables_in_process in a future revision) rather than from the file.
//
// This is recorded here rather than worked around because guessing which shape a
// file is would be worse than saying so: the failure is silent otherwise.
std::vector<VtableInfo> list_vtables(const ElfImage& image) {
  std::vector<VtableInfo> out;
  // Only .data.rel.ro can hold vtables: it is the writable-then-relro section the
  // linker puts vtable and RTTI data in.  .rodata is read-only and holds the
  // type_info names, not the vtables themselves.
  const SectionInfo* drr = nullptr;
  for (const auto& sec : image.sections()) {
    if (sec.name == ".data.rel.ro") { drr = &sec; break; }
  }
  if (drr == nullptr || drr->size < 3 * sizeof(uint64_t)) return out;

  // The class name lives in .rodata, so a name pointer outside it is not a
  // type_info.  Requiring that is most of what makes the scan cheap: without it
  // every word pair in .data.rel.ro looks like a candidate.
  const SectionInfo* rodata = nullptr;
  for (const auto& sec : image.sections()) {
    if (sec.name == ".rodata") { rodata = &sec; break; }
  }
  if (rodata == nullptr) return out;
  const uint64_t rodata_addr = rodata->addr;
  const uint64_t rodata_size = rodata->size;

  const uint64_t base = image.image_base();
  const uint64_t text_lo = image.executable_segment_start();
  const uint64_t text_hi = image.executable_segment_end();

  // Helper: read a u64 from the file image at an image-relative address.  `at()`
  // bounds-checks and throws, so every read is guarded.
  auto read_u64 = [&](uint64_t vaddr, uint64_t* out_val) -> bool {
    try {
      std::memcpy(out_val, image.at(vaddr, sizeof(uint64_t)), sizeof(uint64_t));
      return true;
    } catch (const Error&) {
      return false;
    }
  };

  // A vtable is recognised by its [-1] entry: slot 0 is preceded by exactly one
  // pointer, and that pointer must land on a type_info whose own first word is a
  // vtable pointer.  Requiring the type_info's vptr to look like a text pointer --
  // rather than merely being non-zero -- is what keeps random data from being read
  // as a class.
  for (uint64_t off = drr->addr + 2 * sizeof(uint64_t);
       off + sizeof(uint64_t) <= drr->addr + drr->size; off += sizeof(uint64_t)) {
    uint64_t ti_addr = 0;
    if (!read_u64(off - sizeof(uint64_t), &ti_addr)) continue;
    if (ti_addr < base || ti_addr >= base + image.image_size()) continue;

    // A type_info is two words: [0] is its OWN vtable pointer, which lives in
    // .data.rel.ro alongside the vtables -- not in the text segment.  Requiring it
    // to look like a code address is the mistake that makes this scan find
    // nothing at all, because no type_info in a real module satisfies it.
    uint64_t ti_vptr = 0;
    if (!read_u64(ti_addr, &ti_vptr)) continue;
    if (ti_vptr < drr->addr || ti_vptr >= drr->addr + drr->size) continue;
    if ((ti_vptr % 8) != 0) continue;

    // [1] points at the mangled name in .rodata.
    uint64_t name_ptr = 0;
    if (!read_u64(ti_addr + 8, &name_ptr)) continue;
    if (name_ptr == 0 || name_ptr < rodata_addr || name_ptr >= rodata_addr + rodata_size) {
      continue;
    }

    std::string name;
    {
      char buf[512];
      size_t n = 0;
      try {
        const uint8_t* p = image.at(name_ptr, sizeof(buf) - 1);
        // Copy only up to the NUL; at() guarantees the span is readable, not that
        // the string terminates inside it.
        while (n < sizeof(buf) - 1 && p[n] != 0) ++n;
        std::memcpy(buf, p, n);
      } catch (const Error&) {
        continue;
      }
      buf[n] = '\0';
      if (n < 2) continue;
      // The string a type_info points at is the _ZTS content: the mangled name
      // itself, with NO length prefix.  (The length prefix belongs to the vtable
      // *symbol* name in .symtab, e.g. "_ZTVN2nt10MSFServiceE", which is a
      // different string in a different section.)  Stripping leading digits here
      // rejects every real name, because they all start with 'N'.
      name = demangle_class(std::string_view(buf, n));
    }
    if (name.empty()) continue;

    VtableInfo info;
    info.address = off;
    info.typeinfo = ti_addr - base;
    info.class_name = std::move(name);
    // Count slots until the run stops looking like function pointers.  The count
    // is approximate by construction -- the next vtable's header is what really
    // ends it -- so stop at the first non-text pointer.
    uint32_t slots = 0;
    for (; slots < 4096; ++slots) {
      const uint64_t at_addr = off + slots * sizeof(uint64_t);
      if (at_addr + sizeof(uint64_t) > drr->addr + drr->size) break;
      uint64_t fn = 0;
      if (!read_u64(at_addr, &fn)) break;
      if (fn < text_lo || fn >= text_hi) break;
    }
    // A vtable can legitimately hold a single slot: a class whose only virtual is
    // the destructor still has a vtable, and the reference implementation reports
    // several of them.  Requiring three slots dropped nt::MSFService's
    // one-slot vtable and with it any class that inherits without adding virtuals.
    if (slots < 1) continue;
    info.slots = slots;
    out.push_back(std::move(info));
  }

  std::sort(out.begin(), out.end(),
            [](const VtableInfo& a, const VtableInfo& b) { return a.address < b.address; });
  return out;
}

std::vector<VtableInfo> find_vtables_by_class(const std::vector<VtableInfo>& all,
                                              std::string_view class_name) {
  std::vector<VtableInfo> out;
  for (const auto& v : all) {
    if (v.class_name == class_name) out.push_back(v);
  }
  return out;
}

uint64_t read_vtable_slot(RemoteProcess& remote, uint64_t vtable_addr, uint32_t slot) {
  uint64_t value = 0;
  const uint64_t at = vtable_addr + static_cast<uint64_t>(slot) * sizeof(uint64_t);
  if (remote.read(at, &value, sizeof(value)) != sizeof(value)) {
    throw Error(format("cannot read vtable slot %u at 0x%llx", slot,
                       static_cast<unsigned long long>(at)));
  }
  return value;
}

namespace {

// Resolves a symbol in the target's libc, for the few calls this file has to make
// inside the target (mprotect).  This deliberately does not go through
// ManualLoader: the vtable engine is used by callers that have not mapped anything,
// and a module-wide symbol resolver would drag the whole loader in.
//
// It reads the library from disk and subtracts its own image base, the same way
// ManualLoader::resolve_remote_symbol does -- but scoped to libc, which is the only
// module whose symbols this file needs.
uint64_t resolve_libc_symbol(RemoteProcess& remote, std::string_view name) {
  const auto base = remote.find_loaded_module("libc");
  if (!base) return 0;
  // Find the on-disk path backing that mapping.
  std::string path;
  {
    const std::string maps_path = "/proc/" + std::to_string(remote.pid()) + "/maps";
    std::FILE* f = std::fopen(maps_path.c_str(), "r");
    if (f == nullptr) return 0;
    char line[4096];
    while (std::fgets(line, sizeof(line), f) != nullptr) {
      if (std::strstr(line, "libc") == nullptr) continue;
      // Trim to the path column.
      char* slash = std::strchr(line, '/');
      if (slash == nullptr) continue;
      std::string candidate(slash);
      while (!candidate.empty() &&
             (candidate.back() == '\n' || candidate.back() == ' ')) {
        candidate.pop_back();
      }
      path = std::move(candidate);
      break;
    }
    std::fclose(f);
  }
  if (path.empty()) return 0;
  try {
    ElfImage lib(MappedFile::open(path));
    const DynSymbol* sym = lib.find_symbol(name);
    if (sym == nullptr || !sym->defined || sym->value == 0) return 0;
    return *base + (sym->value - lib.image_base());
  } catch (const Error&) {
    return 0;
  }
}

}  // namespace

uint64_t hook_vtable_slot(RemoteProcess& remote, uint64_t vtable_addr, uint32_t slot,
                          uint64_t new_target) {
  const uint64_t at = vtable_addr + static_cast<uint64_t>(slot) * sizeof(uint64_t);
  const uint64_t previous = read_vtable_slot(remote, vtable_addr, slot);

  // The write has to cope with page protection.  .data.rel.ro is mapped PROT_READ
  // once the loader has applied relocations, so process_vm_writev and POKEDATA both
  // fail with EFAULT -- which is what a naive implementation reports as "cannot
  // write the slot" while the address is perfectly valid.
  //
  // Making the page writable first is the only correct order: the alternative,
  // /proc/pid/mem, is refused for exactly the same reason.  Protection is restored
  // afterwards so the target's own RELRO invariant is not left broken, which would
  // hide a genuine relocation bug behind our patch.
  const uint64_t page = at & ~static_cast<uint64_t>(kPageSize - 1);
  const uint64_t mprotect_addr = resolve_libc_symbol(remote, "mprotect");
  bool unprotected = false;
  if (mprotect_addr != 0) {
    // PROT_READ|PROT_WRITE = 1|2 = 3
    const std::uint64_t rc = remote.remote_call(
        mprotect_addr, {page, kPageSize, 3}, 3);
    unprotected = (rc == 0);
  }
  const size_t written = remote.write(at, &new_target, sizeof(new_target));
  if (unprotected && mprotect_addr != 0) {
    // PROT_READ = 1.  Restoring unconditionally is deliberate: leaving the page
    // writable would make a later relocation silently succeed where it should have
    // faulted.
    remote.remote_call(mprotect_addr, {page, kPageSize, 1}, 3);
  }
  if (written != sizeof(new_target)) {
    throw Error(format("cannot write vtable slot %u at 0x%llx", slot,
                       static_cast<unsigned long long>(at)));
  }
  return previous;
}

void restore_vtable_slot(RemoteProcess& remote, uint64_t vtable_addr, uint32_t slot,
                         uint64_t original) {
  const uint64_t at = vtable_addr + static_cast<uint64_t>(slot) * sizeof(uint64_t);
  // Same RELRO problem as hook_vtable_slot, and it is easy to miss here: a hook that
  // works but whose restore fails leaves the target patched forever, which only
  // shows up on the next reload attempt.
  const uint64_t page = at & ~static_cast<uint64_t>(kPageSize - 1);
  const uint64_t mprotect_addr = resolve_libc_symbol(remote, "mprotect");
  bool unprotected = false;
  if (mprotect_addr != 0) {
    unprotected = remote.remote_call(mprotect_addr, {page, kPageSize, 3}, 3) == 0;
  }
  const size_t written = remote.write(at, &original, sizeof(original));
  if (unprotected) {
    remote.remote_call(mprotect_addr, {page, kPageSize, 1}, 3);
  }
  if (written != sizeof(original)) {
    throw Error(format("cannot restore vtable slot %u at 0x%llx", slot,
                       static_cast<unsigned long long>(at)));
  }
}

HookedSlot hook_vtable_slot_relayed(RemoteProcess& remote, uint64_t vtable_addr,
                                    uint32_t slot, SlotObserver observer) {
  HookedSlot out;
  out.vtable = vtable_addr;
  out.slot = slot;
  out.original = read_vtable_slot(remote, vtable_addr, slot);
  if (out.original == 0) {
    throw Error(format("vtable slot %u at 0x%llx is empty; nothing to forward to", slot,
                       static_cast<unsigned long long>(vtable_addr)));
  }

  // Build the relay before touching the vtable: if allocation fails the vtable is still
  // untouched, and a half-applied hook that forwards nowhere stops QQ from sending.
  out.relay = slot_relay_install(slot, out.original, observer);
  if (out.relay == 0) {
    throw Error(format("cannot allocate a relay for slot %u", slot));
  }

  try {
    // hook_vtable_slot handles the RELRO page, so the relay address goes in as an
    // ordinary replacement.
    const uint64_t previous = hook_vtable_slot(remote, vtable_addr, slot, out.relay);
    if (previous != out.original) {
      // Someone changed the slot between the read and the write.  Put it back rather than
      // leaving a relay in front of a target we never recorded.
      restore_vtable_slot(remote, vtable_addr, slot, previous);
      slot_relay_remove(out.relay);
      throw Error(format("vtable slot %u changed while hooking", slot));
    }
  } catch (...) {
    slot_relay_remove(out.relay);
    throw;
  }
  return out;
}

void unhook_vtable_slot_relayed(RemoteProcess& remote, const HookedSlot& hooked) {
  // Restore the vtable first: once the slot holds the original again, no new call can
  // enter the relay, so releasing its code cannot race a call in flight.  (A call that
  // is already inside the relay has saved its own return path and is unaffected.)
  restore_vtable_slot(remote, hooked.vtable, hooked.slot, hooked.original);
  slot_relay_remove(hooked.relay);
}

uint64_t hook_vtable_slot_in_process(uint64_t vtable_addr, uint32_t slot,
                                      uint64_t new_target) {
  const uint64_t at = vtable_addr + static_cast<uint64_t>(slot) * sizeof(uint64_t);
  uint64_t previous = 0;
  std::memcpy(&previous, reinterpret_cast<const void*>(at), sizeof(previous));
  if (previous == new_target) return previous;  // already hooked; do not re-mprotect

  // Same RELRO constraint as the ptrace path, but the call is a direct one: we are in the
  // process whose page we are changing.
  const uint64_t page = at & ~static_cast<uint64_t>(kPageSize - 1);
  const bool unprotected = (::mprotect(reinterpret_cast<void*>(page), kPageSize,
                                       PROT_READ | PROT_WRITE) == 0);
  std::memcpy(reinterpret_cast<void*>(at), &new_target, sizeof(new_target));
  if (unprotected) {
    ::mprotect(reinterpret_cast<void*>(page), kPageSize, PROT_READ);
  }
  return previous;
}

void restore_vtable_slot_in_process(uint64_t vtable_addr, uint32_t slot, uint64_t original) {
  hook_vtable_slot_in_process(vtable_addr, slot, original);
}

HookedSlot hook_vtable_slot_relayed_in_process(uint64_t vtable_addr, uint32_t slot,
                                               SlotObserver observer) {
  HookedSlot out;
  out.vtable = vtable_addr;
  out.slot = slot;
  std::memcpy(&out.original, reinterpret_cast<const void*>(vtable_addr + slot * 8), 8);
  if (out.original == 0) {
    throw Error(format("vtable slot %u at 0x%llx is empty; nothing to forward to", slot,
                       static_cast<unsigned long long>(vtable_addr)));
  }
  out.relay = slot_relay_install(slot, out.original, observer);
  if (out.relay == 0) throw Error(format("cannot allocate a relay for slot %u", slot));
  const uint64_t previous = hook_vtable_slot_in_process(vtable_addr, slot, out.relay);
  if (previous != out.original) {
    hook_vtable_slot_in_process(vtable_addr, slot, previous);
    slot_relay_remove(out.relay);
    throw Error(format("vtable slot %u changed while hooking", slot));
  }
  return out;
}

void unhook_vtable_slot_relayed_in_process(const HookedSlot& hooked) {
  restore_vtable_slot_in_process(hooked.vtable, hooked.slot, hooked.original);
  slot_relay_remove(hooked.relay);
}

std::optional<VtableInfo> primary_vtable(const ElfImage& image,
                                         const std::vector<VtableInfo>& all,
                                         std::string_view class_name) {
  const auto candidates = find_vtables_by_class(all, class_name);
  if (candidates.empty()) return std::nullopt;

  std::optional<VtableInfo> best;
  size_t best_real = 0;
  for (const auto& v : candidates) {
    size_t real = 0;
    for (uint32_t i = 0; i < v.slots; ++i) {
      uint64_t fn = 0;
      try {
        std::memcpy(&fn, image.at(v.address - image.image_base() + i * sizeof(uint64_t),
                                  sizeof(uint64_t)),
                    sizeof(uint64_t));
      } catch (const Error&) {
        break;
      }
      if (fn == 0) continue;

      // A filler slot is a single return instruction.  Judging by that rather than by slot
      // count is what keeps a 61-slot table of 57 ret stubs from winning over the 44-slot
      // table that holds the class's real methods.
      uint8_t buf[4] = {0, 0, 0, 0};
      try {
        std::memcpy(buf, image.at(fn - image.image_base(), sizeof(buf)), sizeof(buf));
      } catch (const Error&) {
        continue;
      }
      const bool is_stub =
          image.is_aarch64()
              ? (buf[0] == 0xC0 && buf[1] == 0x03 && buf[2] == 0x5F && buf[3] == 0xD6)
              : (buf[0] == 0xC3);
      if (!is_stub) ++real;
    }
    if (real > best_real) {
      best_real = real;
      best = v;
    }
  }
  return best;
}

std::vector<uint32_t> find_slots_calling(const ElfImage& image,
                                         const std::vector<VtableRef>& vtables,
                                         uint64_t callee, uint64_t text_lo, uint64_t text_hi) {
  std::vector<uint32_t> out;
  for (const VtableRef& ref : vtables) {
    // Collect this table's slot targets once: both the scan and the function bounds need
    // them, and reading them per slot would be quadratic.
    std::vector<uint64_t> targets;
    targets.reserve(ref.slots);
    for (uint32_t slot = 0; slot < ref.slots; ++slot) {
      uint64_t fn = 0;
      try {
        std::memcpy(&fn,
                    image.at(ref.address - image.image_base() + slot * sizeof(uint64_t),
                             sizeof(uint64_t)),
                    sizeof(uint64_t));
      } catch (const Error&) {
        break;
      }
      targets.push_back(fn);
    }

    const uint64_t step = image.is_aarch64() ? 4 : 1;
    for (uint32_t slot = 0; slot < targets.size(); ++slot) {
      const uint64_t fn = targets[slot];
      if (fn == 0) continue;                        // an empty slot is not the end
      if (fn < text_lo || fn >= text_hi) continue;  // a data word, not a function

      // Bound the scan by the next higher slot target from the SAME table, so one slot's
      // function is not read through its neighbour's code.  Without that bound every slot
      // appears to call whatever the function after it calls, and "which slot sends"
      // becomes unanswerable.
      uint64_t hi = fn + kMaxFunctionScan;
      for (uint64_t probe : targets) {
        if (probe > fn && probe < hi) hi = probe;
      }

      for (uint64_t at = fn; at + 4 <= hi; at += step) {
        uint64_t target = 0;
        if (!decode_call_to(image, at, &target)) continue;
        if (target != callee) continue;
        out.push_back(slot);
        break;  // one call is enough to identify the slot
      }
    }
  }
  return out;
}

std::optional<uint32_t> find_slot_by_target(RemoteProcess& remote,
                                            const std::vector<uint64_t>& vtable_addrs,
                                            uint64_t function) {
  for (const uint64_t vt : vtable_addrs) {
    // A vtable has no length in the object file; probe until the slot no longer
    // looks like a text pointer.  That is what a real payload has to do too,
    // because the Node side does not pass slot counts.
    for (uint32_t slot = 0; slot < 4096; ++slot) {
      uint64_t value = 0;
      const uint64_t at = vt + static_cast<uint64_t>(slot) * sizeof(uint64_t);
      if (remote.read(at, &value, sizeof(value)) != sizeof(value)) break;
      // A zero slot is NOT the end of the vtable: slot 0 is legitimately null for a
      // class whose first virtual is pure or for one that inherits its vptr from a
      // base with no overrides.  Stopping there makes the search answer "none" for
      // every real vtable that begins that way, which is exactly the ones a hook
      // wants.  Only an unreadable page ends the walk.
      if (value == function) return slot;
    }
  }
  return std::nullopt;
}

}  // namespace hz
