#include "slot_relay.h"

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
};

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
// returns the struct-pointer in x8, so all eight are saved; q0..q7 carry float and
// SIMD arguments and are saved too.  SP must stay 16-byte aligned at every instruction
// boundary -- the trap the detached-call path hit -- so the save area is a multiple of
// 16.
//
// Layout of the 192-byte frame: x0..x7 at 0..64, the state pointer at 72, q0..q5 at
// 80..175, x29/x30 at 176.  192 % 16 == 0, which aarch64 requires at every instruction
// boundary.
asm(R"(
  .text
  .p2align 4
  .globl hz_slot_relay_entry
  .type  hz_slot_relay_entry, %function
hz_slot_relay_entry:
  sub  sp, sp, #192
  stp  x29, x30, [sp, #176]
  stp  x0, x1, [sp, #0]
  stp  x2, x3, [sp, #16]
  stp  x4, x5, [sp, #32]
  stp  x6, x7, [sp, #48]
  # x8 is the struct-return pointer and has no partner, so it cannot go in an stp pair --
  # `stp x8,x8` is architecturally UNPREDICTABLE (the assembler warns about it) and on real
  # hardware the two halves of the store may not both land.  str is the correct form.
  str  x8, [sp, #64]
  stp  q0, q1, [sp, #80]
  stp  q2, q3, [sp, #112]
  stp  q4, q5, [sp, #144]

  # x9 is caller-saved, so the observer may and will clobber it.  Park the state
  # pointer in the spare slot at 72(sp) and reload it after the call: without that the
  # tail branch reads the original through a register the observer has overwritten.
  str  x9, [sp, #72]

  # The observer takes (slot, original).  `observer` is at offset 16, not 24.
  ldr  w0, [x9, #0]
  ldr  x1, [x9, #8]
  ldr  x10, [x9, #16]
  cbz  x10, 1f
  blr  x10
1:
  ldr  x9, [sp, #72]
  ldp  x0, x1, [sp, #0]
  ldp  x2, x3, [sp, #16]
  ldp  x4, x5, [sp, #32]
  ldp  x6, x7, [sp, #48]
  ldr  x8, [sp, #64]
  ldp  q0, q1, [sp, #80]
  ldp  q2, q3, [sp, #112]
  ldp  q4, q5, [sp, #144]
  ldp  x29, x30, [sp, #176]
  add  sp, sp, #192

  # Tail-branch to the original through x9, which is free again.
  ldr  x9, [x9, #8]
  br   x9
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

  auto* tramp = static_cast<uint8_t*>(mem) + sizeof(RelayState);
  emit_trampoline(tramp, state, reinterpret_cast<uint64_t>(&hz_slot_relay_entry));

  // The page has to be executable before the vtable is pointed at it.  W^X is kept by
  // making it readable and executable *after* everything has been written, rather than
  // leaving it writable-and-executable.
  if (::mprotect(mem, kPageSize, PROT_READ | PROT_EXEC) != 0) {
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
