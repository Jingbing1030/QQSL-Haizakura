// Vtable interception: find a class's vtable in a live process by its RTTI type
// name, then replace individual slots.
//
// ---------------------------------------------------------------------------
// Why this is not "write a pointer to a hardcoded offset"
// ---------------------------------------------------------------------------
// A QQ update relinks wrapper.node: the same class keeps its name and its
// semantics, but every address moves, and a class with an inheritance chain has
// several vtables whose slot counts differ.  Anything derived from a raw offset
// breaks on the next release, silently, in the middle of a session.
//
// So a caller names what it wants -- the class, and the slot's meaning -- and the
// engine finds the address.  The slot's meaning has to survive a relink too, and
// the only stable handle is what the slot does at runtime, not where it sits.
//
// Layering, from most to least stable:
//   1. type_info name            (a string in .rodata; stable across relinks)
//   2. which vtable of that class (by slot count, then by a slot's behaviour)
//   3. which slot                 (by the function it points at)
//
// This header implements 1 and 2 plus the mechanics of 3; identifying *which*
// slot is a semantic question the caller answers (see docs/vtable-slots.md).
#ifndef HZ_VTABLE_HOOK_H
#define HZ_VTABLE_HOOK_H

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "elf_image.h"
#include "remote.h"
#include "slot_relay.h"

namespace hz {

// One vtable as it exists in the file, before the target's mapping is consulted.
struct VtableInfo {
  uint64_t address = 0;       // image-relative address of slot 0
  uint64_t typeinfo = 0;      // image-relative address of the type_info
  std::string class_name;     // demangled, "nt::MSFService"
  uint32_t slots = 0;
};

// Walks .data.rel.ro for vtable-shaped runs: [-1] pointing at a type_info whose
// name resolves to a class name.  Returns them sorted by address so two runs over
// the same file compare equal.
std::vector<VtableInfo> list_vtables(const ElfImage& image);

// Every vtable whose class name matches exactly.  A class with an inheritance
// chain has one per base subobject, and their slot counts differ, so the caller
// almost always wants all of them and then narrows.
std::vector<VtableInfo> find_vtables_by_class(const std::vector<VtableInfo>& all,
                                              std::string_view class_name);

// Reads the pointer currently in `slot` of the vtable at `vtable_addr` (a live
// address, i.e. mapping base + image-relative address).
uint64_t read_vtable_slot(RemoteProcess& remote, uint64_t vtable_addr, uint32_t slot);

// Points `slot` at `new_target` and returns the previous value, so a caller can
// restore it.  Writing a vtable slot changes the file-backed .data.rel.ro page,
// which is mapped read-only; this therefore writes through ptrace, which ignores
// page protection because it goes through the kernel's own mapping.
//
// The previous value is returned rather than discarded: a hook that cannot be
// undone cannot be reloaded, and QQ reloads wrapper.node on some updates.
uint64_t hook_vtable_slot(RemoteProcess& remote, uint64_t vtable_addr, uint32_t slot,
                          uint64_t new_target);

// Restores a slot that hook_vtable_slot replaced.
void restore_vtable_slot(RemoteProcess& remote, uint64_t vtable_addr, uint32_t slot,
                         uint64_t original);

// A slot replaced by the engine, as a pair of addresses plus the relay that forwards to
// the original.  Held by the caller so the hook can be undone in any order.
struct HookedSlot {
  uint64_t vtable = 0;      // live address of the vtable
  uint32_t slot = 0;
  uint64_t original = 0;    // what the slot held
  uint64_t relay = 0;       // the trampoline now in the slot
};

// Replaces `slot` with a relay that reports each call to `observer` and then forwards it
// to the function the slot held, unchanged -- registers, flags and vector state all
// preserved.  Returns the record needed to undo it.
//
// This is the only correct way to hook a vtable slot: a direct replacement cannot call
// the original, because it does not know the signature, and hardcoding a prototype
// corrupts every call it guessed wrong about.  See slot_relay.h.
HookedSlot hook_vtable_slot_relayed(RemoteProcess& remote, uint64_t vtable_addr,
                                    uint32_t slot, SlotObserver observer);

// Undoes hook_vtable_slot_relayed: writes the original back and releases the relay.
void unhook_vtable_slot_relayed(RemoteProcess& remote, const HookedSlot& hooked);

// ---------------------------------------------------------------------------
// The in-process variants
// ---------------------------------------------------------------------------
// A vtable can be patched from two places, and they need different mechanics:
//
//   * from OUTSIDE the target, over ptrace (RemoteProcess) -- used by the injector and by
//     tests that drive a separate process.  Writes go through process_vm_writev, and a RELRO
//     page has to be mprotected first.
//   * from INSIDE the target, by the payload itself.  The payload is already in the address
//     space: it can write the slot with a plain store and mprotect with a direct call.  Going
//     through ptrace there is impossible -- a process cannot ptrace itself -- and the payload
//     is exactly where T9/T10 hooks have to be installed.
//
// The second pair exists because conflating the two is a design error that only shows up at
// integration time: a hook that works perfectly in a test driver cannot be called by the code
// it is meant to run in.
uint64_t hook_vtable_slot_in_process(uint64_t vtable_addr, uint32_t slot, uint64_t new_target);
void restore_vtable_slot_in_process(uint64_t vtable_addr, uint32_t slot, uint64_t original);

// In-process relayed hook: same forwarding semantics as the ptrace version, installed from
// inside the target.  Returns the record needed to undo it.
HookedSlot hook_vtable_slot_relayed_in_process(uint64_t vtable_addr, uint32_t slot,
                                               SlotObserver observer);
void unhook_vtable_slot_relayed_in_process(const HookedSlot& hooked);

// Finds the slots whose function contains a call to `callee`, searching every slot of
// `vtables`.  This is how a slot is located by what it *does* rather than by its index:
// a relink moves every address and can reorder slots, but "the slot that sends an SSO
// request" keeps calling the same leaf, so the call graph is the stable handle.
//
// Returns them in vtable order.  More than one hit is normal and meaningful -- QQ has a
// main entry and an adjustor-thunk sibling that both send -- so the caller decides which
// to hook (usually all of them).
//
// `text_lo`/`text_hi` bound which slot targets are treated as code; pass the image's
// executable range.
// `vtable_addrs` must be paired with their slot counts: without the count the scan reads
// past the end of a table into whatever data follows, and those words look like function
// pointers -- so a search for "the slot that sends" returns a dozen slots that do not
// exist, which is worse than returning none.
struct VtableRef {
  uint64_t address = 0;  // image-relative or live, matching `image`
  uint32_t slots = 0;    // how many slots the table actually has
};

std::vector<uint32_t> find_slots_calling(const ElfImage& image,
                                         const std::vector<VtableRef>& vtables,
                                         uint64_t callee, uint64_t text_lo, uint64_t text_hi);

// Picks the vtable of `class_name` that actually implements the class.
//
// A class with an inheritance chain has several vtables, and the one with the most slots is
// usually NOT the implementation.  nt::MSFService has a 61-slot table and a 44-slot one; the
// 61-slot table is 57 one-instruction ret stubs, because the linker emits full-width tables
// for secondary bases whose overrides all resolve to the same no-op.  Choosing by slot count
// -- the obvious rule -- selects the empty one, and every hook installed through it does
// nothing while appearing to succeed.
//
// The rule used here is how many slots point at something longer than a bare return, which
// is a direct measurement of "this table holds code" rather than a proxy for it.
std::optional<VtableInfo> primary_vtable(const ElfImage& image, const std::vector<VtableInfo>& all,
                                         std::string_view class_name);

// Finds the slot whose current target equals `function`, searching the given
// vtables.  This is how a caller locates a slot by *behaviour* when the index is
// not known: point at the function you already identified, and ask which slot
// holds it.  Returns the slot index, or nullopt.
//
// `vtable_addrs` are live addresses.  When several vtables contain the function
// the first match in address order wins; disambiguate by passing one vtable.
std::optional<uint32_t> find_slot_by_target(RemoteProcess& remote,
                                            const std::vector<uint64_t>& vtable_addrs,
                                            uint64_t function);

}  // namespace hz

#endif  // HZ_VTABLE_HOOK_H
