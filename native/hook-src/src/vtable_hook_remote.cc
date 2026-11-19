// The ptrace-side vtable hooking, split out of vtable_hook.cc.
//
// ---------------------------------------------------------------------------
// Why these live in their own translation unit
// ---------------------------------------------------------------------------
// There are two callers of the engine and they are in different address spaces:
//
//   * the injector (a .node module in Node's process) hooks a *separate* target over
//     ptrace, so every access goes through RemoteProcess;
//   * the payload hooks the process it is already inside, so it writes directly and
//     cannot construct a RemoteProcess for itself.
//
// Keeping both in one file made the payload link against hz::RemoteProcess -- four
// undefined symbols that nothing in the payload's address space defines -- and the failure
// appeared only at injection time, as "failed to resolve remote symbol
// _ZN2hz13RemoteProcess11remote_callE...".  The engine itself was fine; the file boundary
// was wrong.
//
// So: everything that names RemoteProcess is here.  vtable_hook.cc keeps the parts that
// only need the file image (vtables, slots, primary_vtable) plus the in-process hooks, and
// the payload links only that.
#include "vtable_hook.h"

#include <cstring>

#include "common.h"
#include "remote.h"

#include <sys/mman.h>

namespace hz {

namespace {

// Page size for the RELRO mprotect window.  4 KB is the minimum on both architectures this
// supports (x86-64 and aarch64), and mprotect rounds up to the real page size anyway, so a
// larger constant would only widen the window that is momentarily writable.
constexpr uint64_t kPageSize = 4096;

}  // namespace

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
