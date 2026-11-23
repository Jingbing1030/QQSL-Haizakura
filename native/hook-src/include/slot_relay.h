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
// The second half of the signature is the call's own first four integer arguments (x0..x3 on
// aArch64, rdi/rsi/rdx/rcx on x64). Without them a probe can say a slot was entered but not what
// it was entered with, and the send path is exactly the case where the argument is the finding:
// MSFSDK::sendPacket carries the request object in x0.
//
// The seventh argument, `frame`, points at the relay's save area: x0..x7 at offsets 0..56 and x8
// at 64, one 8-byte slot each. Writing through it changes what the target receives.
//
// This was deliberately withheld at first, so that an observer could not corrupt the frame the
// relay is about to restore. That is the right default for a probe, and it is the wrong one for
// the send path: the only way to get QQ to transmit a payload of ours is to hand it that payload
// while it is already inside the function, since calling the function ourselves re-enters it and
// kills the client. Writing x1's slot at offset 8 replaces the command pointer; writing offset 16
// replaces the body range. An observer that ignores `frame` behaves exactly as before, which is
// every observer except the send injector.
using SlotObserver = void (*)(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                              uint64_t a2, uint64_t a3, uint64_t* frame);

// Called after the target returns. Receives the return value's first word and, when `callee`
// is false, nothing else -- the point is the side effect the callee produced (a reply written
// into an `out` argument), not the return value itself.
//
// This exists because a relay that only sees the entry cannot observe anything the callee
// produces. A send writes its response into a caller-supplied block at x4, so the response does
// not exist at entry time and cannot be captured there.
using SlotAfter = void (*)(uint64_t result, uint64_t* frame);

// Registers a post-call callback on an existing relay. Passing 0 removes it.
//
// Separate from slot_relay_install so that the common case -- observe the arguments, change
// nothing -- keeps working unchanged, and the more invasive one is opt-in per relay.
bool slot_relay_set_after(uint64_t relay, SlotAfter after);

// Builds a relay for `slot` that forwards to `original` and reports each call to
// `observer`.  Returns the address to install in the vtable, or 0 on failure.
//
// The returned code lives in freshly allocated executable memory owned by the
// payload, so it stays valid after the ptrace session ends -- the target calls it on
// its own threads.
uint64_t slot_relay_install(uint32_t slot, uint64_t original, SlotObserver observer);

// A relay for a patched function entry: replays `saved` (the instructions the patch replaced)
// and then continues in the function, past them.
//
// Different from the vtable relay, which forwards to a function another pointer still
// references. Here the original bytes are gone from the entry, so they have to be executed
// from somewhere else before control returns -- and their PC-relative forms are rejected at
// install time, because a relocated adrp would silently address the wrong page.
uint64_t slot_relay_install_function(uint64_t target, const uint8_t* saved, uint32_t saved_len,
                                     SlotObserver observer, uint32_t id);

// Frees a relay built by slot_relay_install.  Safe to call with 0.
void slot_relay_remove(uint64_t relay);

// How many times the relay at `relay` has been entered, or 0 if it is not installed.
//
// Separates "the slot was never called" from "the observer failed", which look identical from
// the outside and cost real time to tell apart during the first live runs.
uint64_t slot_relay_hits(uint64_t relay);

// Number of live relays, for a leak check in tests and in the reload path.
uint32_t slot_relay_count();

}  // namespace hz

#endif  // HZ_SLOT_RELAY_H
