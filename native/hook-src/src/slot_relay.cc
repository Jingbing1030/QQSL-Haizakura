#include "slot_relay.h"

#include <fcntl.h>
#include <unistd.h>
#include <cstdio>

#include <cstring>
#include <vector>
#include <sys/mman.h>

#include "common.h"

namespace hz {
namespace {

// ---------------------------------------------------------------------------
// Shape of the relay
// ---------------------------------------------------------------------------
// Per hooked slot: a 24-byte (x86) / 32-byte (aarch64) *trampoline* that loads the
// slot's state pointer into a scratch register and jumps to one shared entry stub.
// Shared: the entry stub, which saves every register a call can carry arguments in,
// calls the observer, restores, and tail-jumps to the original.
//
// Generating a trampoline per slot rather than patching an immediate inside a copy of
// the whole stub is deliberate: the trampoline is pure data, so it can be emitted as
// bytes with no assembler, and the register-save sequence exists exactly once.
//
// The trampoline's jump is absolute-indirect so it is position independent and safe
// regardless of where mmap put it relative to the payload's own text.

struct RelayState {
  uint32_t slot;
  uint32_t pad;
  uint64_t original;
  uint64_t observer;
  // Incremented on every entry, before the observer runs, and never reset.
  //
  // This exists because "the hook is installed" and "the hook fires" are different facts and
  // were indistinguishable during the first live experiments: a slot rewritten to a valid
  // relay that is never called looks exactly like one whose observer is failing. With a
  // counter, a zero says the target never reached this slot -- which is a finding about the
  // siting, not about the relay. It sits after the fields the assembly reads so their
  // offsets are unchanged.
  uint64_t hits;
  // Called after the target returns, with the return value and the address of the frame that held
  // the arguments.
  //
  // Needed because the `out` block a send writes its reply into is only populated once the call
  // has finished, and an observer that runs before it therefore cannot see the response. The
  // struct is ordered so that hits keeps its offset and this is appended after it.
  uint64_t after;
};

// The stub assembly reads these offsets as literals, so they are asserted rather than assumed.
//
// They were wrong once: `hits` was hardcoded as +32 while the struct places it at +24, and the
// counter then incremented past the end of the state block, corrupting the trampoline that lives
// in the same page. The symptom was a segfault in every test that installed a relay, with no
// output at all -- easy to read as a broken test harness.
static_assert(offsetof(RelayState, slot) == 0, "relay stub reads slot at offset 0");
static_assert(offsetof(RelayState, original) == 8, "relay stub reads original at offset 8");
static_assert(offsetof(RelayState, observer) == 16, "relay stub reads observer at offset 16");
static_assert(offsetof(RelayState, hits) == 24, "relay stub increments hits at offset 24");
static_assert(offsetof(RelayState, after) == 32, "relay stub reads after at offset 32");

// The shared entry.  Reached only through a trampoline, which leaves the state pointer
// in the architecture's scratch register: r11 on x86-64, x9 on aarch64.  Both are
// caller-saved and carry no arguments, which is why they are the ones chosen.
extern "C" void hz_slot_relay_entry();

#if defined(__x86_64__)
// r11 holds the state pointer on entry.  Saves rdi/rsi/rdx/rcx/r8/r9 (the integer
// argument registers) plus rax (the vector count for a variadic call), the flags, and
// xmm0..xmm15.  Nothing about the callee's prototype is assumed -- the registers are
// restored verbatim, so a call the payload knows nothing about passes through intact.
//
// Stack: on entry rsp % 16 == 8 (as after any call).  Sixteen pushes -- pushfq plus the
// fifteen integer registers -- bring it back to 8, then a 264-byte sub (256 for the
// vector save area plus 8 for alignment) makes it 0, which is what the ABI requires
// immediately before a call.
asm(R"(
  .text
  .p2align 4
  .globl hz_slot_relay_entry
  .type  hz_slot_relay_entry, @function
hz_slot_relay_entry:
  pushfq
  push %rax
  push %rbx
  push %rcx
  push %rdx
  push %rsi
  push %rdi
  push %rbp
  push %r8
  push %r9
  push %r10
  push %r12
  push %r13
  push %r14
  push %r15
  sub  $264, %rsp

  movdqu %xmm0,   0(%rsp)
  movdqu %xmm1,  16(%rsp)
  movdqu %xmm2,  32(%rsp)
  movdqu %xmm3,  48(%rsp)
  movdqu %xmm4,  64(%rsp)
  movdqu %xmm5,  80(%rsp)
  movdqu %xmm6,  96(%rsp)
  movdqu %xmm7, 112(%rsp)
  movdqu %xmm8, 128(%rsp)
  movdqu %xmm9, 144(%rsp)
  movdqu %xmm10, 160(%rsp)
  movdqu %xmm11, 176(%rsp)
  movdqu %xmm12, 192(%rsp)
  movdqu %xmm13, 208(%rsp)
  movdqu %xmm14, 224(%rsp)
  movdqu %xmm15, 240(%rsp)

  # Count the entry, before the observer runs, through r11 which still holds the state
  # pointer. `hits` is at offset 32 -- past the fields the rest of the stub reads.
  incq 24(%r11)

  # r11 is *caller-saved*, so the observer is free to clobber it -- and a compiled C
  # function will.  Reading the original through r11 after the call therefore jumps to
  # whatever the observer left in the register, which is a segfault inside the target
  # and looks like a bug in QQ.  Park the state pointer in the scratch slot at
  # 256(%rsp) and reload it afterwards.
  mov  %r11, 256(%rsp)

  # SysV passes the first integer argument in rdi and the second in rsi, so the callee
  # pointer must NOT go in rdi: doing that hands the observer the low 32 bits of its own
  # address as `slot` and the real slot as `original`.  r10 is caller-saved and is not an
  # argument register, which makes it the right place for the target.
  mov  16(%r11), %r10
  test %r10, %r10
  je   1f
  mov   0(%r11), %edi          # slot
  mov   8(%r11), %rsi          # original
  call *%r10
1:
  mov  256(%rsp), %r11
  movdqu   0(%rsp), %xmm0
  movdqu  16(%rsp), %xmm1
  movdqu  32(%rsp), %xmm2
  movdqu  48(%rsp), %xmm3
  movdqu  64(%rsp), %xmm4
  movdqu  80(%rsp), %xmm5
  movdqu  96(%rsp), %xmm6
  movdqu 112(%rsp), %xmm7
  movdqu 128(%rsp), %xmm8
  movdqu 144(%rsp), %xmm9
  movdqu 160(%rsp), %xmm10
  movdqu 176(%rsp), %xmm11
  movdqu 192(%rsp), %xmm12
  movdqu 208(%rsp), %xmm13
  movdqu 224(%rsp), %xmm14
  movdqu 240(%rsp), %xmm15
  add  $264, %rsp

  pop %r15
  pop %r14
  pop %r13
  pop %r12
  pop %r10
  pop %r9
  pop %r8
  pop %rbp
  pop %rdi
  pop %rsi
  pop %rdx
  pop %rcx
  pop %rbx
  pop %rax
  popfq

  # r11 is free again after the pops.  Tail-jump, so the original returns straight to
  # the caller and the relay needs no frame of its own.
  mov 8(%r11), %r11
  jmp *%r11
  .size hz_slot_relay_entry, .-hz_slot_relay_entry
)");

constexpr size_t kTrampolineSize = 24;

// 49 BB <imm64>        movabs $state, %r11
// FF 25 00 00 00 00    jmp qword ptr [rip+0]
// <imm64>              -> hz_slot_relay_entry
//
// The rip-relative displacement is measured from the END of the jmp instruction, which is
// offset 16 -- and the entry address literal is also at 16, so the displacement is 0.  The
// instruction runs from offset 10 to 15, six bytes, which is easy to miscount as ending at
// 12 (the offset of its own displacement field) and then "fix" it to 4, sending the jump
// into the middle of the literal.
void emit_trampoline(uint8_t* p, const RelayState* state, uint64_t entry) {
  p[0] = 0x49;
  p[1] = 0xBB;
  std::memcpy(p + 2, &state, sizeof(state));
  p[10] = 0xFF;
  p[11] = 0x25;
  p[12] = 0x00; p[13] = 0x00; p[14] = 0x00; p[15] = 0x00;
  std::memcpy(p + 16, &entry, sizeof(entry));
}

#elif defined(__aarch64__)
// x9 holds the state pointer on entry.  aarch64 passes integer arguments in x0..x7 and
// returns the struct-pointer in x8, so all eight are saved.  q0..q7 carry float and SIMD
// arguments -- all EIGHT of them, not six.
//
// Saving only q0..q5 was a real corruption bug, and it stayed hidden because of how it was
// reached: the vtable slots hooked first happen to take at most six floating-point arguments, so
// the relay never had anything in q6/q7 to destroy. The export probe then hooked two hundred
// functions at once, any one of which may pass its seventh or eighth double in q6/q7, and the
// observer call -- an ordinary C function -- is free to clobber both. The client died during
// installation with no diagnostics, which reads as "the probe is broken" rather than "the relay
// keeps six of the eight registers it promised".
//
// SP must stay 16-byte aligned at every instruction boundary -- the trap the detached-call path
// hit -- so the save area is a multiple of 16.
//
// Layout of the 240-byte frame: x0..x7 at 0..64, x8 at 64, the state pointer at 72, q0..q7 at
// 80..208, x29/x30 at 208, and the parked return value in x0/x1 at 224/232.  240 % 16 == 0,
// which aarch64 requires at every instruction.
asm(R"(
  .text
  .p2align 4
  .globl hz_slot_relay_entry
  .type  hz_slot_relay_entry, %function
hz_slot_relay_entry:
  sub  sp, sp, #240
  stp  x29, x30, [sp, #208]
  stp  x0, x1, [sp, #0]
  stp  x2, x3, [sp, #16]
  stp  x4, x5, [sp, #32]
  stp  x6, x7, [sp, #48]
  # x8 is the struct-return pointer and has no partner, so it cannot go in an stp pair --
  # `stp x8,x8` is architecturally UNPREDICTABLE and the two halves may not both land.
  str  x8, [sp, #64]
  stp  q0, q1, [sp, #80]
  stp  q2, q3, [sp, #112]
  stp  q4, q5, [sp, #144]
  stp  q6, q7, [sp, #176]

  # Count the entry before anything can fault, so a broken observer still leaves a trace of
  # having been reached.
  ldr  x10, [x9, #24]
  add  x10, x10, #1
  str  x10, [x9, #24]

  # Park the state pointer: it lives in x9, which is caller-saved, so the observer call below
  # would clobber it.
  str  x9, [sp, #72]

  # The entry observer takes (slot, original, x0..x3, frame). Arguments are read from the save
  # area rather than the live registers, because the observer call itself overwrites them.
  # `frame` is the save area itself, and whatever the observer writes back into it is what the
  # target receives below -- that is how the send injector substitutes a payload.
  ldr  w0, [x9, #0]
  ldr  x1, [x9, #8]
  ldr  x2, [sp, #0]
  ldr  x3, [sp, #8]
  ldr  x4, [sp, #16]
  ldr  x5, [sp, #24]
  mov  x6, sp
  ldr  x10, [x9, #16]
  cbz  x10, 1f
  blr  x10
1:
  # Restore the arguments and call the original. Do NOT release the frame first.
  #
  # The old shape restored everything, released the frame and tail-branched, which was right while
  # this stub only observed on entry and is wrong once the result must be observed: the frame has
  # to outlive the call both to park the result and because the after hook reads the arguments back
  # out of it. Releasing it early stored the result into the caller's live stack, which killed the
  # client on the first send.
  ldr  x9, [sp, #72]
  ldp  x0, x1, [sp, #0]
  ldp  x2, x3, [sp, #16]
  ldp  x4, x5, [sp, #32]
  ldp  x6, x7, [sp, #48]
  ldr  x8, [sp, #64]
  ldp  q0, q1, [sp, #80]
  ldp  q2, q3, [sp, #112]
  ldp  q4, q5, [sp, #144]
  ldp  q6, q7, [sp, #176]
  ldr  x10, [x9, #8]
  blr  x10

  # Park both halves of the result across the after hook, which is an ordinary C function and may
  # clobber every caller-saved register. Two words because a struct return uses x0 and x1, and
  # because the argument registers must NOT be put back afterwards -- doing that would overwrite
  # the result of anything returning 16 bytes in x0/x1 or a float in d0-d3.
  stp  x0, x1, [sp, #224]
  ldr  x9, [sp, #72]
  ldr  x11, [x9, #32]
  cbz  x11, 2f
  # The callback takes (result, frame), so the result goes in x0 and the frame in x1.
  #
  # An earlier version passed the frame in x0 and nothing in x1, which ran without faulting and
  # reported a plausible-looking result of zero -- a callback that "works" but is handed the wrong
  # argument is harder to notice than one that crashes.
  ldr  x0, [sp, #224]
  mov  x1, sp
  blr  x11
  ldp  x0, x1, [sp, #224]
2:
  ldp  x29, x30, [sp, #208]
  add  sp, sp, #240
  ret
  .size hz_slot_relay_entry, .-hz_slot_relay_entry
)");

constexpr size_t kTrampolineSize = 32;

// 0:  ldr x9, [pc, #16]    -> literal at 16 (state)
// 4:  ldr x10, [pc, #20]   -> literal at 24 (entry)
// 8:  br  x10
// 12: nop
// 16: .quad state
// 24: .quad entry
void emit_trampoline(uint8_t* p, const RelayState* state, uint64_t entry) {
  const uint32_t ldr_x9  = 0x58000000u | (4u << 5) | 9u;   // pc=0, target 16 -> imm19=4
  const uint32_t ldr_x10 = 0x58000000u | (5u << 5) | 10u;  // pc=4, target 24 -> imm19=5
  const uint32_t br_x10  = 0xD61F0140u;
  const uint32_t nop     = 0xD503201Fu;
  std::memcpy(p + 0, &ldr_x9, 4);
  std::memcpy(p + 4, &ldr_x10, 4);
  std::memcpy(p + 8, &br_x10, 4);
  std::memcpy(p + 12, &nop, 4);
  std::memcpy(p + 16, &state, 8);
  std::memcpy(p + 24, &entry, 8);
}

#else
#error "slot relay supports x86_64 and aarch64 only"
#endif

// Every live relay, so they can be walked for the leak check and released on reload.
struct Relay {
  uint64_t trampoline = 0;
  RelayState* state = nullptr;
  size_t mapping_size = 0;
};
std::vector<Relay> g_relays;

}  // namespace

uint64_t slot_relay_install(uint32_t slot, uint64_t original, SlotObserver observer) {
  // One page holds the state block plus the trampoline.  A single mapping keeps the
  // lifetime simple: freeing the relay is one munmap, and there is no window where the
  // trampoline points into freed memory.
  const size_t kPageSize = 4096;
  void* mem = ::mmap(nullptr, kPageSize, PROT_READ | PROT_WRITE,
                     MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if (mem == MAP_FAILED) return 0;

  auto* state = static_cast<RelayState*>(mem);
  state->slot = slot;
  state->pad = 0;
  state->original = original;
  state->observer = reinterpret_cast<uint64_t>(observer);
  state->hits = 0;

  auto* tramp = static_cast<uint8_t*>(mem) + sizeof(RelayState);
  emit_trampoline(tramp, state, reinterpret_cast<uint64_t>(&hz_slot_relay_entry));

  // The page has to be executable before the vtable is pointed at it, and it has to stay
  // writable because the entry counter lives in it.
  //
  // This was PROT_READ | PROT_EXEC at first, which the counter turned into an immediate
  // segfault: the first instruction of the stub increments a field in this same page, so a
  // read-only mapping faults on every single call. Every relay test died before printing
  // anything, which reads as a broken harness rather than as a permission bug.
  //
  // W^X is still respected in the sense that matters here -- the code is written before the
  // mapping becomes executable, so no page is ever both writable and executing at the moment
  // instructions are placed in it. Keeping it writable afterwards is what lets a diagnostic
  // counter exist at all; the alternative is a separate read-only data page and an extra
  // indirection on the hot path.
  if (::mprotect(mem, kPageSize, PROT_READ | PROT_WRITE | PROT_EXEC) != 0) {
    ::munmap(mem, kPageSize);
    return 0;
  }

  Relay r;
  r.trampoline = reinterpret_cast<uint64_t>(tramp);
  r.state = state;
  r.mapping_size = kPageSize;
  g_relays.push_back(r);
  return r.trampoline;
}

bool slot_relay_set_after(uint64_t relay, SlotAfter after) {
  // Found by address rather than by a pointer field, because the caller holds the trampoline
  // address -- that is what gets installed in the vtable -- and nothing else.
  if (relay == 0) return false;
  bool found = false;
#if !defined(__aarch64__)
  // Only the AArch64 stub calls the target and can therefore run code afterwards. The x64 stub
  // tail-jumps, so the target returns straight to the original caller and there is no point at
  // which a post-call callback could run.
  //
  // Refused explicitly rather than stored and silently ignored: a callback that is registered and
  // never fires looks like "the function was never called", which is the exact confusion that
  // has cost the most time in this project. The local test suite runs on x64, so this is also why
  // the post-call path can only be exercised on the target.
  (void)after;
  return false;
#endif
  for (const Relay& r : g_relays) {
    if (r.trampoline != relay) continue;
    r.state->after = reinterpret_cast<uint64_t>(after);
    // Record which state block received the callback, and confirm it reads back. A registration
    // that lands on a different block than the one the stub uses looks identical to a callback
    // that is never invoked, which is the state this has been stuck in.
    {
      const int lf = ::open("/tmp/hz-relay.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
      if (lf >= 0) {
        char lb[192];
        const int ln = std::snprintf(
            lb, sizeof(lb), "set_after tramp=0x%llx state=0x%llx after_written=0x%llx readback=0x%llx\n",
            static_cast<unsigned long long>(relay),
            static_cast<unsigned long long>(reinterpret_cast<uint64_t>(r.state)),
            static_cast<unsigned long long>(reinterpret_cast<uint64_t>(after)),
            static_cast<unsigned long long>(r.state->after));
        if (ln > 0) (void)::write(lf, lb, static_cast<std::size_t>(ln));
        ::close(lf);
      }
    }
    found = true;
    break;
  }
  // The relay address matched nothing. Returning quietly here is what made a registered callback
  // that never fires look identical to a function that was never called: the send hook fired
  // twice on a real message while this stored the callback nowhere at all.
  //
  // Nothing is aborted -- this runs inside the host process, and a diagnostic refusing to attach
  // is not a reason to take QQ down. It is reported instead, which is enough: the caller records
  // the return value, and an absent log line then means "not installed" rather than "not called".
  return found;
}

uint64_t slot_relay_hits(uint64_t relay) {
  if (relay == 0) return 0;
  for (const Relay& r : g_relays) {
    if (r.trampoline == relay) return r.state->hits;
  }
  return 0;
}

uint64_t slot_relay_install_function(uint64_t target, const uint8_t* saved, uint32_t saved_len,
                                     SlotObserver observer, uint32_t id) {
  const size_t kPageSize = 4096;
  void* mem = ::mmap(nullptr, kPageSize, PROT_READ | PROT_WRITE,
                     MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if (mem == MAP_FAILED) return 0;

  auto* state = static_cast<RelayState*>(mem);
  state->slot = id;
  state->pad = 0;
  state->observer = reinterpret_cast<uint64_t>(observer);
  state->hits = 0;

  auto* tramp = static_cast<uint8_t*>(mem) + sizeof(RelayState);
  emit_trampoline(tramp, state, reinterpret_cast<uint64_t>(&hz_slot_relay_entry));

  // The replay stub. This is the part that was missing, and its absence was not cosmetic: the
  // entry now jumps to the relay, so forwarding to `target` would jump straight back into that
  // jump. That is an infinite loop, and it took QQ down within seconds -- the first sign was the
  // client dying shortly after each injection that also installed a function hook, which read
  // like an unstable container until a run without any hook stayed up.
  //
  // The stub executes the instructions the patch displaced and then continues at
  // target + saved_len, so the function sees exactly the prologue it would have had.
  //
  // Placement: after the trampoline, 16-byte aligned so the literal loads in the replay code
  // and in the added jump are naturally aligned. `emit_trampoline` occupies 32 bytes.
  auto* stub = static_cast<uint8_t*>(mem) + sizeof(RelayState) + 64;
  uint32_t off = 0;
  if (saved_len != 0) {
    std::memcpy(stub, saved, saved_len);
    off = saved_len;
  }
  // Then an absolute jump to target + saved_len, same two-instruction form used to patch the
  // entry, because b/bl cannot reach beyond +/-128 MB and wrapper.node is 144 MB.
  const uint32_t kLdrX16 = 0x58000050u;  // ldr x16, [pc, #8]
  const uint32_t kBrX16 = 0xD61F0200u;   // br x16
  std::memcpy(stub + off + 0, &kLdrX16, 4);
  std::memcpy(stub + off + 4, &kBrX16, 4);
  const uint64_t resume = target + saved_len;
  std::memcpy(stub + off + 8, &resume, 8);
  off += 16;

  // The relay's tail branch goes to the stub, not to the function.
  //
  // This is also what makes a hook capable of *forwarding*: the stub replays the displaced
  // prologue and then continues into the function body, so calling it reaches the original code
  // without re-entering the relay. Calling `target` instead would land on the two-word jump that
  // was just written there, re-enter the observer, and recurse -- which is exactly what killed QQ
  // on the first forwarding attempt ("reentry blocked" then a dead client).
  state->original = reinterpret_cast<uint64_t>(stub);
  (void)off;

  // Publish the generated code before anything can execute it.
  //
  // The page is mapped writable at this point, so writing instructions is fine -- but on AArch64
  // the instruction cache is not coherent with the data cache, and nothing here has told the core
  // that these addresses now hold code. Without this the first execution can run whatever stale
  // lines the I-cache already had for these addresses, which for a page being filled for the first
  // time is usually harmless and occasionally is not. `__builtin___clear_cache` compiles to
  // `bl __clear_cache`, which issues the required DC/IC maintenance.
  //
  // Done before mprotect so the bytes are in place while the page is still known-writable, and
  // before the relay is returned to the caller -- after that a target thread may enter it at any
  // moment.
  __builtin___clear_cache(reinterpret_cast<char*>(mem),
                          reinterpret_cast<char*>(reinterpret_cast<uint8_t*>(mem) + kPageSize));

  if (::mprotect(mem, kPageSize, PROT_READ | PROT_WRITE | PROT_EXEC) != 0) {
    ::munmap(mem, kPageSize);
    return 0;
  }

  Relay r;
  r.trampoline = reinterpret_cast<uint64_t>(tramp);
  r.state = state;
  r.mapping_size = kPageSize;
  g_relays.push_back(r);
  return r.trampoline;
}

void slot_relay_remove(uint64_t relay) {
  if (relay == 0) return;
  // Drop the record first: the code is about to disappear and a re-entrant call would
  // otherwise walk a freed vector entry.
  RelayState* state = nullptr;
  size_t size = 0;
  for (size_t i = 0; i < g_relays.size(); ++i) {
    if (g_relays[i].trampoline != relay) continue;
    state = g_relays[i].state;
    size = g_relays[i].mapping_size;
    g_relays.erase(g_relays.begin() + static_cast<long>(i));
    break;
  }
  if (state == nullptr) return;
  // The page must be writable again before it is unmapped, because munmap itself is
  // fine either way -- this is only to make the state's teardown explicit.
  ::mprotect(state, size, PROT_READ | PROT_WRITE);
  ::munmap(state, size);
}

uint32_t slot_relay_count() { return static_cast<uint32_t>(g_relays.size()); }

}  // namespace hz
