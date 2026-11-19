// Relaying a hooked vtable slot to the function it replaced.
//
// ---------------------------------------------------------------------------
// The problem
// ---------------------------------------------------------------------------
// A vtable slot holds a bare function pointer and is called with the class's own
// signature, which the payload does not know.  Replacing the slot with a C function
// is therefore not enough: the replacement has to (a) observe the call, (b) hand the
// call through to the original with every register exactly as it arrived, and
// (c) return whatever the original returned.  Get (b) wrong and QQ stops sending --
// the hook "works" while the client silently loses every packet.
//
// ---------------------------------------------------------------------------
// Why not a C function
// ---------------------------------------------------------------------------
// A C replacement has a fixed prototype.  The real callee may take six integer
// arguments or none, may pass floats in vector registers, may be variadic.  Saving
// "the arguments we think it takes" and calling through a matching pointer corrupts
// the ones we guessed wrong about, and the corruption is in the callee, so it looks
// like a bug in QQ.
//
// A naked relay preserves *all* of them unconditionally.  It saves the registers a
// call can carry arguments in, the flags, and (on aarch64) the vector registers,
// observes the call, restores everything, and tail-jumps to the original.  Nothing is
// interpreted, so nothing can be misread.
//
// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
// One relay instance per hooked slot.  `slot_relay_install` builds it and returns the
// address to write into the vtable; `slot_relay_remove` restores and releases it.
#ifndef HZ_SLOT_RELAY_H
#define HZ_SLOT_RELAY_H

#include <cstdint>

namespace hz {

// Called from the relay with the slot index and the original target, before the call
// is forwarded.  It must not throw and must not modify the machine state: the relay
// restores registers immediately afterwards, so anything it changes is discarded --
// which is the point, because the callee must see what the caller passed.
using SlotObserver = void (*)(uint32_t slot, uint64_t original);

// Builds a relay for `slot` that forwards to `original` and reports each call to
// `observer`.  Returns the address to install in the vtable, or 0 on failure.
//
// The returned code lives in freshly allocated executable memory owned by the
// payload, so it stays valid after the ptrace session ends -- the target calls it on
// its own threads.
uint64_t slot_relay_install(uint32_t slot, uint64_t original, SlotObserver observer);

// Frees a relay built by slot_relay_install.  Safe to call with 0.
void slot_relay_remove(uint64_t relay);

// Number of live relays, for a leak check in tests and in the reload path.
uint32_t slot_relay_count();

}  // namespace hz

#endif  // HZ_SLOT_RELAY_H
