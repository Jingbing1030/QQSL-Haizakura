#include "remote.h"

#include <cstdarg>
#include <cstdio>
#include <cstring>

#include <csignal>
#include <sys/ptrace.h>
#if defined(__aarch64__)
// <elf.h> gives NT_PRSTATUS its numeric value; PTRACE_GETREGSET/SETREGSET use it
// as the "addr" argument to select the general purpose register set.
#include <elf.h>
#endif
#include <sys/uio.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>

namespace hz {
namespace {

// Set HZ_DEBUG=1 to trace the ptrace state machine on stderr.  Injection bugs are
// almost always stop-state bugs, and the only practical way to see them is to log
// every stop with its signal and event.
bool debug_enabled() {
  static const bool on = ::getenv("HZ_DEBUG") != nullptr;
  return on;
}

void dbg(const char* fmt, ...) __attribute__((format(printf, 1, 2)));
void dbg(const char* fmt, ...) {
  if (!debug_enabled()) return;
  va_list ap;
  va_start(ap, fmt);
  std::vfprintf(stderr, fmt, ap);
  va_end(ap);
  std::fflush(stderr);
}

// ---------------------------------------------------------------------------
// Architecture-agnostic register access
//
// x86-64 exposes its whole register file through PTRACE_GETREGS/SETREGS and
// <sys/user.h>.  aarch64 has neither that struct nor those requests: registers
// travel as a `struct user_pt_regs` through PTRACE_GETREGSET/SETREGSET with
// NT_PRSTATUS.  Both are wrapped here so the rest of the file does not care which
// one it is compiled for.
// ---------------------------------------------------------------------------

#if defined(__x86_64__)

using Regs = user_regs_struct;

inline void regs_get(pid_t pid, Regs& out) {
  if (::ptrace(PTRACE_GETREGS, pid, nullptr, &out) != 0) {
    fail(format("PTRACE_GETREGS failed for pid %d: %s", pid, std::strerror(errno)));
  }
}

inline void regs_set(pid_t pid, const Regs& in) {
  if (::ptrace(PTRACE_SETREGS, pid, nullptr, const_cast<Regs*>(&in)) != 0) {
    fail(format("PTRACE_SETREGS failed for pid %d: %s", pid, std::strerror(errno)));
  }
}

#elif defined(__aarch64__)

// Mirrors the kernel's `struct user_pt_regs` byte for byte.  The x0..x30 members
// are an overlay on regs[] so individual registers can be named; `rip`/`rsp` are
// aliases for pc/sp so shared code reads naturally.
struct Aarch64Regs {
  union {
    uint64_t regs[31];
    struct {
      uint64_t x0, x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12, x13, x14,
          x15, x16, x17, x18, x19, x20, x21, x22, x23, x24, x25, x26, x27, x28,
          x29, x30;
    };
  };
  union {
    uint64_t sp;
    uint64_t rsp;
  };
  union {
    uint64_t pc;
    uint64_t rip;
  };
  uint64_t pstate;
};

using Regs = Aarch64Regs;

inline void regs_get(pid_t pid, Regs& out) {
  struct iovec io {
    &out, sizeof(out)
  };
  if (::ptrace(PTRACE_GETREGSET, pid, reinterpret_cast<void*>(NT_PRSTATUS), &io) != 0) {
    fail(format("PTRACE_GETREGSET failed for pid %d: %s", pid, std::strerror(errno)));
  }
}

inline void regs_set(pid_t pid, const Regs& in) {
  struct iovec io {
    const_cast<Regs*>(&in), sizeof(in)
  };
  if (::ptrace(PTRACE_SETREGSET, pid, reinterpret_cast<void*>(NT_PRSTATUS), &io) != 0) {
    fail(format("PTRACE_SETREGSET failed for pid %d: %s", pid, std::strerror(errno)));
  }
}

#else
#error "haizakura-hook supports x86_64 and aarch64 only"
#endif

}  // namespace

// Registers saved on attach so the target is resumed exactly as we found it.
// The concrete type is architecture specific; see the adapters above.
struct RemoteProcess::SavedRegs {
  Regs regs{};
  bool valid = false;
};

RemoteProcess::RemoteProcess(int pid) : pid_(pid) {
  if (pid <= 0) fail("invalid pid");
  // Refuse early when the target is gone: every later call would fail with a
  // less helpful message.
  if (::kill(pid, 0) != 0 && errno != EPERM) {
    fail(format("target process %d does not exist", pid));
  }
}

RemoteProcess::~RemoteProcess() {
  try {
    release_scratch();
  } catch (...) {
  }
  try {
    if (attached_) detach();
  } catch (...) {
  }
  delete saved_;
}

void RemoteProcess::attach() {
  if (attached_) return;
  saved_ = new SavedRegs();
  seize();
  attached_ = true;
}

void RemoteProcess::seize() {
  // PTRACE_ATTACH is used rather than PTRACE_SEIZE on purpose.  SEIZE leaves the
  // tracee running, so every register access first needs a group-stop via
  // INTERRUPT; while that stop can be read and written, resuming from it with
  // SINGLESTEP does not establish a single-step context on all kernels and the
  // tracee dies with SIGILL before executing the instruction.  ATTACH delivers a
  // signal-delivery-stop, from which SINGLESTEP is reliable.
  if (::ptrace(PTRACE_ATTACH, pid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_ATTACH failed for pid %d: %s", pid_, std::strerror(errno)));
  }
  int status = 0;
  if (::waitpid(pid_, &status, __WALL) < 0) {
    fail(format("target wait failed for pid %d: %s", pid_, std::strerror(errno)));
  }
  if (!WIFSTOPPED(status)) {
    fail(format("target process %d did not stop after PTRACE_ATTACH", pid_));
  }
  // Record the initial stop so stop_target() does not interrupt again.
  if (saved_ == nullptr) saved_ = new SavedRegs();
  regs_get(pid_, saved_->regs);
  saved_->valid = true;
}

void RemoteProcess::interrupt() {
  if (::ptrace(PTRACE_INTERRUPT, pid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_INTERRUPT failed for pid %d: %s", pid_, std::strerror(errno)));
  }
  wait_for_stop();
}

void RemoteProcess::wait_for_stop() {
  int status = 0;
  for (;;) {
    const pid_t w = ::waitpid(pid_, &status, __WALL);
    if (w < 0) {
      if (errno == EINTR) continue;
      fail(format("target wait failed for pid %d: %s", pid_, std::strerror(errno)));
    }
    if (WIFSTOPPED(status)) {
      const int sig = WSTOPSIG(status);
      const int event = static_cast<int>(status >> 16);
      dbg("[hz] stopped pid=%d sig=%d (%s) event=%d\n", pid_, sig, ::strsignal(sig), event);
      return;
    }
    if (WIFEXITED(status)) {
      fail(format("target process %d exited during injection (code %d)", pid_,
                  WEXITSTATUS(status)));
    }
    if (WIFSIGNALED(status)) {
      fail(format("target process %d was killed by signal %d during injection", pid_,
                  WTERMSIG(status)));
    }
  }
}

size_t RemoteProcess::read(uint64_t addr, void* out, size_t len) {
  if (len == 0) return 0;
  // process_vm_readv transfers the whole range in one syscall and fails cleanly
  // when part of it is unmapped, so use it first.
  struct iovec local{out, len};
  struct iovec remote{reinterpret_cast<void*>(addr), len};
  const ssize_t n = ::process_vm_readv(pid_, &local, 1, &remote, 1, 0);
  if (n >= 0) return static_cast<size_t>(n);

  if (errno != EPERM && errno != ENOSYS) {
    // EFAULT is expected when the range crosses into unmapped memory; report a
    // partial result rather than failing so callers can walk maps.
    if (errno == EFAULT) return 0;
  }

  // Fall back to word-at-a-time PEEKDATA.  This works wherever ptrace does, at
  // the cost of one syscall per word.
  if (!attached_) {
    fail(format("process_vm_readv unavailable (%s) and target is not attached",
                std::strerror(errno)));
  }

  size_t copied = 0;
  uint8_t* dst = static_cast<uint8_t*>(out);
  while (copied < len) {
    const uint64_t word_addr = (addr + copied) & ~static_cast<uint64_t>(sizeof(long) - 1);
    errno = 0;
    const long word = ::ptrace(PTRACE_PEEKDATA, pid_, reinterpret_cast<void*>(word_addr),
                               nullptr);
    if (word == -1 && errno != 0) break;
    const size_t offset = static_cast<size_t>((addr + copied) - word_addr);
    const size_t take = std::min(sizeof(long) - offset, len - copied);
    std::memcpy(dst + copied, reinterpret_cast<const uint8_t*>(&word) + offset, take);
    copied += take;
  }
  return copied;
}

size_t RemoteProcess::write(uint64_t addr, const void* in, size_t len) {
  if (len == 0) return 0;
  struct iovec local{const_cast<void*>(in), len};
  struct iovec remote{reinterpret_cast<void*>(addr), len};
  const ssize_t n = ::process_vm_writev(pid_, &local, 1, &remote, 1, 0);
  if (n >= 0) return static_cast<size_t>(n);

  if (!attached_) {
    fail(format("process_vm_writev failed for pid %d: %s", pid_, std::strerror(errno)));
  }

  size_t copied = 0;
  const uint8_t* src = static_cast<const uint8_t*>(in);
  while (copied < len) {
    const uint64_t word_addr = (addr + copied) & ~static_cast<uint64_t>(sizeof(long) - 1);
    const size_t offset = static_cast<size_t>((addr + copied) - word_addr);

    // POKEDATA replaces a whole word, so read it first to preserve neighbours.
    long word = 0;
    if (offset != 0 || len - copied < sizeof(long)) {
      errno = 0;
      word = ::ptrace(PTRACE_PEEKDATA, pid_, reinterpret_cast<void*>(word_addr), nullptr);
      if (word == -1 && errno != 0) break;
    }
    const size_t take = std::min(sizeof(long) - offset, len - copied);
    std::memcpy(reinterpret_cast<uint8_t*>(&word) + offset, src + copied, take);

    if (::ptrace(PTRACE_POKEDATA, pid_, reinterpret_cast<void*>(word_addr),
                 reinterpret_cast<void*>(word)) != 0) {
      break;
    }
    copied += take;
  }
  return copied;
}

void RemoteProcess::read_exact(uint64_t addr, void* out, size_t len) {
  const size_t n = read(addr, out, len);
  if (n != len) {
    fail(format("failed to read %zu bytes at 0x%llx in pid %d (short read: %zu)",
                len, static_cast<unsigned long long>(addr), pid_, n));
  }
}

void RemoteProcess::write_exact(uint64_t addr, const void* in, size_t len) {
  const size_t n = write(addr, in, len);
  if (n != len) {
    fail(format("failed to write %zu bytes at 0x%llx in pid %d (short write: %zu)",
                len, static_cast<unsigned long long>(addr), pid_, n));
  }
}

std::string RemoteProcess::read_cstring(uint64_t addr, size_t max_len) {
  std::string out;
  uint8_t buf[256];
  while (out.size() < max_len) {
    const size_t want = std::min(sizeof(buf), max_len - out.size());
    const size_t n = read(addr + out.size(), buf, want);
    if (n == 0) break;
    for (size_t i = 0; i < n; ++i) {
      if (buf[i] == '\0') {
        out.append(reinterpret_cast<char*>(buf), i);
        return out;
      }
    }
    out.append(reinterpret_cast<char*>(buf), n);
  }
  return out;
}

uint64_t RemoteProcess::scratch_buffer(size_t size) {
  if (scratch_addr_ != 0 && scratch_size_ >= size) return scratch_addr_;
  release_scratch();
  // Map writable+readable scratch space in the target.  PROT flags are the raw
  // kernel values, which match the common headers numerically.
  constexpr int kProtRead = 1;
  constexpr int kProtWrite = 2;
  // PROT_EXEC is required, not optional: this region doubles as the return
  // trampoline for remote_call(), whose first bytes are the int3 sled a callee
  // returns into.  Mapping it read/write only makes every call fault exactly at
  // the sled address once the callee executes `ret`.
  constexpr int kProtExec = 4;
  const uint64_t addr =
      remote_mmap(size, kProtRead | kProtWrite | kProtExec, 0x22 /* MAP_PRIVATE|ANON */);
  if (addr == 0) fail("failed to map scratch buffer in target");
  scratch_addr_ = addr;
  scratch_size_ = size;
  return scratch_addr_;
}

void RemoteProcess::release_scratch() {
  if (scratch_addr_ != 0) {
    remote_munmap(scratch_addr_, scratch_size_);
    scratch_addr_ = 0;
    scratch_size_ = 0;
  }
}

void RemoteProcess::detach() {
  if (!attached_) return;
  release_scratch();
  try {
    restore_and_continue();
  } catch (...) {
    attached_ = false;
    throw;
  }
  attached_ = false;
}

void RemoteProcess::restore_and_continue() {
  if (saved_ != nullptr && saved_->valid) {
    // Put the original registers back so the target never observes our state.
    regs_set(pid_, saved_->regs);
    saved_->valid = false;
  }
  if (::ptrace(PTRACE_DETACH, pid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_DETACH failed for pid %d: %s", pid_, std::strerror(errno)));
  }
}

// ---------------------------------------------------------------------------
// Remote syscall execution
//
// The injector cannot allocate memory in the target without calling mmap there.
// To do that we stop the target at an instruction boundary, plant the syscall
// number and arguments in its registers, let it execute a single `syscall`, and
// read the result back out of RAX.  The original instruction pointer and all
// argument registers are restored before the target resumes.
// ---------------------------------------------------------------------------

void RemoteProcess::stop_target() {
  if (!attached_) attach();

  if (saved_ == nullptr) saved_ = new SavedRegs();
  if (saved_->valid) return;  // already stopped by us

  // PTRACE_SEIZE does not stop the tracee, and a group-stop obtained via
  // INTERRUPT is not a signal-delivery-stop: modifying registers from it works,
  // but resuming with SINGLESTEP is unreliable.  Delivering SIGSTOP and waiting
  // for the resulting signal-delivery-stop gives a stop state that every ptrace
  // operation behaves predictably from.
  if (::ptrace(PTRACE_INTERRUPT, pid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_INTERRUPT failed for pid %d: %s", pid_, std::strerror(errno)));
  }
  wait_for_stop();

  regs_get(pid_, saved_->regs);
  saved_->valid = true;
}

void RemoteProcess::resume_target() {
  if (saved_ != nullptr && saved_->valid) {
    regs_set(pid_, saved_->regs);
    saved_->valid = false;
  }
  if (::ptrace(PTRACE_CONT, pid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_CONT failed for pid %d: %s", pid_, std::strerror(errno)));
  }
}

#if defined(__x86_64__)
// x86_64: syscall number in RAX, args in RDI/RSI/RDX/R10/R8/R9, result in RAX,
// instruction at RIP is `syscall` (0F 05).
static constexpr uint8_t kSyscallOpcode[2] = {0x0f, 0x05};

void RemoteProcess::ensure_syscall_site() {
  if (syscall_site_valid_) return;

  // The trampoline must live in a mapping that is actually executable, otherwise
  // the target faults the moment we redirect its instruction pointer there.  Walk
  // /proc/<pid>/maps and scan only executable file-backed regions containing libc.
  const auto regions = executable_regions_of("libc");
  if (regions.empty()) fail("cannot locate an executable libc mapping in the target");

  uint8_t buf[4096];
  for (const auto& [start, end] : regions) {
    for (uint64_t addr = start; addr + sizeof(buf) <= end; addr += sizeof(buf) - 1) {
      const size_t n = read(addr, buf, std::min<size_t>(sizeof(buf), end - addr));
      if (n < 2) break;
      for (size_t i = 0; i + 1 < n; ++i) {
        if (buf[i] == kSyscallOpcode[0] && buf[i + 1] == kSyscallOpcode[1]) {
          syscall_site_ = addr + i;
          syscall_site_valid_ = true;
          dbg("[hz] syscall gadget at 0x%llx\n",
              static_cast<unsigned long long>(syscall_site_));
          return;
        }
      }
      if (n < sizeof(buf)) break;
    }
  }
  fail("failed to locate a syscall instruction in the target's libc");
}

uint64_t RemoteProcess::remote_syscall6(uint64_t number, uint64_t a1, uint64_t a2,
                                        uint64_t a3, uint64_t a4, uint64_t a5,
                                        uint64_t a6) {
  ensure_syscall_site();
  stop_target();

  // Snapshot the live registers rather than the attach-time record: consecutive
  // operations each move rip, and restoring the original record would rewind the
  // target to wherever it was when we attached.
  Regs baseline{};
  regs_get(pid_, baseline);

  Regs regs = baseline;
  regs.rax = number;
  regs.rdi = a1;
  regs.rsi = a2;
  regs.rdx = a3;
  regs.r10 = a4;
  regs.r8 = a5;
  regs.r9 = a6;
  regs.rip = syscall_site_;
  // Resume on the instruction after `syscall` so we stop again right away.
  regs.orig_rax = static_cast<uint64_t>(-1);

  regs_set(pid_, regs);

  dbg("[hz] syscall nr=%llu site=0x%llx orig_rip=0x%llx\n",
      static_cast<unsigned long long>(number),
      static_cast<unsigned long long>(syscall_site_),
      static_cast<unsigned long long>(regs.rip));

  if (::ptrace(PTRACE_SINGLESTEP, pid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_SINGLESTEP failed for pid %d: %s", pid_, std::strerror(errno)));
  }
  wait_for_stop();

  Regs after{};
  regs_get(pid_, after);
  dbg("[hz] after syscall rax=0x%llx rip=0x%llx (expected rip 0x%llx)\n",
      static_cast<unsigned long long>(after.rax),
      static_cast<unsigned long long>(after.rip),
      static_cast<unsigned long long>(syscall_site_ + 2));

  // Restore the pre-syscall register state; the tracee stays stopped.
  regs_set(pid_, saved_->regs);

  dbg("[hz] call returned rax=0x%llx\n", static_cast<unsigned long long>(after.rax));
  return after.rax;
}
#endif  // __x86_64__

#if defined(__aarch64__)
// aarch64: syscall number in x8, arguments in x0..x5, result in x0, and the
// instruction is `svc #0`, encoding as 0xd4000001 (little-endian 01 00 00 d4).
static constexpr uint32_t kSvcZero = 0xd4000001;

void RemoteProcess::ensure_syscall_site() {
  if (syscall_site_valid_) return;

  // Same reasoning as x86-64: the trampoline has to land in a page the kernel
  // marked executable, so scan only executable libc mappings.
  const auto regions = executable_regions_of("libc");
  if (regions.empty()) fail("cannot locate an executable libc mapping in the target");

  uint8_t buf[4096];
  for (const auto& [start, end] : regions) {
    for (uint64_t addr = start; addr + sizeof(buf) <= end; addr += sizeof(buf) - 1) {
      const size_t n = read(addr, buf, std::min<size_t>(sizeof(buf), end - addr));
      if (n < 4) break;
      // aarch64 instructions are fixed width; scanning on 4-byte boundaries avoids
      // matching an `svc` immediate that happens to appear inside a literal pool.
      for (size_t i = 0; i + 4 <= n; i += 4) {
        uint32_t word = 0;
        std::memcpy(&word, buf + i, sizeof(word));
        if (word == kSvcZero) {
          syscall_site_ = addr + i;
          syscall_site_valid_ = true;
          dbg("[hz] syscall gadget at 0x%llx\n",
              static_cast<unsigned long long>(syscall_site_));
          return;
        }
      }
      if (n < sizeof(buf)) break;
    }
  }
  fail("failed to locate an `svc #0` instruction in the target's libc");
}

uint64_t RemoteProcess::remote_syscall6(uint64_t number, uint64_t a1, uint64_t a2,
                                        uint64_t a3, uint64_t a4, uint64_t a5,
                                        uint64_t a6) {
  ensure_syscall_site();
  stop_target();

  Regs baseline{};
  regs_get(pid_, baseline);

  Regs regs = baseline;
  regs.x8 = number;
  regs.x0 = a1;
  regs.x1 = a2;
  regs.x2 = a3;
  regs.x3 = a4;
  regs.x4 = a5;
  regs.x5 = a6;
  regs.pc = syscall_site_;

  regs_set(pid_, regs);

  dbg("[hz] syscall nr=%llu site=0x%llx\n", static_cast<unsigned long long>(number),
      static_cast<unsigned long long>(syscall_site_));

  if (::ptrace(PTRACE_SINGLESTEP, pid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_SINGLESTEP failed for pid %d: %s", pid_, std::strerror(errno)));
  }
  wait_for_stop();

  Regs after{};
  regs_get(pid_, after);
  dbg("[hz] after syscall x0=0x%llx pc=0x%llx (expected pc 0x%llx)\n",
      static_cast<unsigned long long>(after.x0),
      static_cast<unsigned long long>(after.pc),
      static_cast<unsigned long long>(syscall_site_ + 4));

  // Restore what we found; the tracee stays stopped for the caller.
  regs_set(pid_, baseline);
  return after.x0;
}
#endif  // __aarch64__
// ---------------------------------------------------------------------------
// Remote function invocation
//
// Calling into the target requires a stack frame that returns somewhere we
// control.  We map a tiny page, write a breakpoint instruction into it, and use
// that address as the return address.  The target runs the function, returns to
// the breakpoint, and stops with a SIGTRAP we can distinguish from its own.
// ---------------------------------------------------------------------------

#if defined(__x86_64__)
uint64_t RemoteProcess::remote_call(uint64_t fn, const std::vector<uint64_t>& args,
                                    size_t argc) {
  // Prepare every memory resource BEFORE touching registers.  scratch_buffer() and
  // write_value() can issue syscalls through the trampoline, which itself stops and
  // resumes the tracee; doing that after we have built a call frame would discard
  // it.  region layout:
  //   +0        trap sled the callee returns into
  //   +64       private stack, growing down
  constexpr size_t kTrampSize = 64;
  constexpr size_t kStackSize = 128 * 1024;
  const uint64_t region = scratch_buffer(kTrampSize + kStackSize);

  // A run of int3 so any return address inside the sled traps rather than decodes.
  std::vector<uint8_t> sled(kTrampSize, 0xcc);
  write_exact(region, sled.data(), sled.size());

  const uint64_t stack_top = (region + kTrampSize + kStackSize) & ~static_cast<uint64_t>(0xf);
  const uint64_t new_rsp = stack_top - 8;
  write_value<uint64_t>(new_rsp, region);

  stop_target();

  // Snapshot the live registers: earlier trampolines have moved rip, so the
  // attach-time record is not a valid baseline.
  Regs baseline{};
  regs_get(pid_, baseline);

  Regs regs = baseline;
  regs.rip = fn;
  regs.rsp = new_rsp;
  // Clearing orig_rax marks the tracee as "not inside a syscall".  Without it the
  // kernel still believes a system call is in flight and, on resume, rewinds rip by
  // the length of the `syscall` instruction (2 bytes on x86-64) to restart it --
  // which lands in the middle of the previous instruction and dies with SIGSEGV.
  // This is the single reason every injected call faulted at fn - 2.
  regs.orig_rax = static_cast<uint64_t>(-1);
  regs.rdi = argc > 0 ? args[0] : 0;
  regs.rsi = argc > 1 ? args[1] : 0;
  regs.rdx = argc > 2 ? args[2] : 0;
  regs.rcx = argc > 3 ? args[3] : 0;
  regs.r8 = argc > 4 ? args[4] : 0;
  regs.r9 = argc > 5 ? args[5] : 0;

  dbg("[hz] remote_call fn=0x%llx rsp=0x%llx (baseline rip=0x%llx)\n",
      static_cast<unsigned long long>(fn), static_cast<unsigned long long>(new_rsp),
      static_cast<unsigned long long>(baseline.rip));

  regs_set(pid_, regs);

  // Read back: this is the single most useful diagnostic when a step misbehaves,
  // because it distinguishes "the kernel did not accept rip" from "the instruction
  // faulted".
  Regs applied{};
  regs_get(pid_, applied);
  dbg("[hz] applied rip=0x%llx rsp=0x%llx (wanted 0x%llx/0x%llx)\n",
      static_cast<unsigned long long>(applied.rip),
      static_cast<unsigned long long>(applied.rsp),
      static_cast<unsigned long long>(fn), static_cast<unsigned long long>(new_rsp));

  // Run the function to completion.  The `data` argument is the signal to inject;
  // passing 0 resumes without delivering anything, which is what we want since the
  // SIGSTOP from PTRACE_ATTACH has already been consumed by waitpid.
  if (::ptrace(PTRACE_CONT, pid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_CONT failed for pid %d: %s", pid_, std::strerror(errno)));
  }

  int status = 0;
  for (;;) {
    const pid_t w = ::waitpid(pid_, &status, __WALL);
    if (w < 0) {
      if (errno == EINTR) continue;
      fail(format("target wait failed for pid %d: %s", pid_, std::strerror(errno)));
    }
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      fail(format("target process %d died inside 0x%llx", pid_,
                  static_cast<unsigned long long>(fn)));
    }
    if (!WIFSTOPPED(status)) continue;

    const int sig = WSTOPSIG(status);
    Regs now{};
    regs_get(pid_, now);
    dbg("[hz] stop sig=%d rip=0x%llx (sled 0x%llx..0x%llx)\n", sig,
        static_cast<unsigned long long>(now.rip),
        static_cast<unsigned long long>(region),
        static_cast<unsigned long long>(region + kTrampSize));

    // Returning into the sled is the success case.
    if (sig == SIGTRAP && now.rip >= region && now.rip < region + kTrampSize) {
      const uint64_t result = now.rax;
      // Restore the target to how we found it.
      regs_set(pid_, baseline);
      dbg("[hz] call returned rax=0x%llx\n", static_cast<unsigned long long>(result));
      return result;
    }


    // Any other trap or fault is a real failure inside the callee.
    fail(format("call to 0x%llx raised signal %d at rip 0x%llx", 
                static_cast<unsigned long long>(fn), sig,
                static_cast<unsigned long long>(now.rip)));
  }
}
#endif  // __x86_64__

#if defined(__aarch64__)
uint64_t RemoteProcess::remote_call(uint64_t fn, const std::vector<uint64_t>& args,
                                    size_t argc) {
  // Same strategy as x86-64 with the aarch64 instruction substituted:
  //   +0     a run of `brk #0` the callee returns into
  //   +64    private stack, growing down
  // `brk` raises SIGTRAP through the kernel's debug-exception path, so the stop is
  // indistinguishable from a breakpoint and needs no patched instruction.
  constexpr size_t kTrampSize = 64;
  constexpr size_t kStackSize = 128 * 1024;
  constexpr uint32_t kBrkZero = 0xd4200000;  // brk #0

  const uint64_t region = scratch_buffer(kTrampSize + kStackSize);

  std::vector<uint8_t> sled(kTrampSize, 0);
  for (size_t i = 0; i + 4 <= sled.size(); i += 4) {
    std::memcpy(sled.data() + i, &kBrkZero, sizeof(kBrkZero));
  }
  write_exact(region, sled.data(), sled.size());

  // x30 is the link register, so that is what carries the return address.  Keep
  // the stack 16-byte aligned as AAPCS64 requires.
  const uint64_t stack_top =
      (region + kTrampSize + kStackSize) & ~static_cast<uint64_t>(0xf);

  stop_target();

  Regs baseline{};
  regs_get(pid_, baseline);

  Regs regs = baseline;
  regs.pc = fn;
  regs.rsp = stack_top;
  regs.x30 = region;  // return address: the first brk in the sled
  regs.x0 = argc > 0 ? args[0] : 0;
  regs.x1 = argc > 1 ? args[1] : 0;
  regs.x2 = argc > 2 ? args[2] : 0;
  regs.x3 = argc > 3 ? args[3] : 0;
  regs.x4 = argc > 4 ? args[4] : 0;
  regs.x5 = argc > 5 ? args[5] : 0;

  dbg("[hz] remote_call fn=0x%llx sp=0x%llx lr=0x%llx (baseline pc=0x%llx)\n",
      static_cast<unsigned long long>(fn), static_cast<unsigned long long>(stack_top),
      static_cast<unsigned long long>(region),
      static_cast<unsigned long long>(baseline.pc));

  regs_set(pid_, regs);

  Regs applied{};
  regs_get(pid_, applied);
  dbg("[hz] applied pc=0x%llx sp=0x%llx (wanted 0x%llx/0x%llx)\n",
      static_cast<unsigned long long>(applied.pc),
      static_cast<unsigned long long>(applied.rsp),
      static_cast<unsigned long long>(fn),
      static_cast<unsigned long long>(stack_top));

  if (::ptrace(PTRACE_CONT, pid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_CONT failed for pid %d: %s", pid_, std::strerror(errno)));
  }

  int status = 0;
  for (;;) {
    const pid_t w = ::waitpid(pid_, &status, __WALL);
    if (w < 0) {
      if (errno == EINTR) continue;
      fail(format("target wait failed for pid %d: %s", pid_, std::strerror(errno)));
    }
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      fail(format("target process %d died inside 0x%llx", pid_,
                  static_cast<unsigned long long>(fn)));
    }
    if (!WIFSTOPPED(status)) continue;

    const int sig = WSTOPSIG(status);
    Regs now{};
    regs_get(pid_, now);
    dbg("[hz] stop sig=%d pc=0x%llx (sled 0x%llx..0x%llx)\n", sig,
        static_cast<unsigned long long>(now.pc),
        static_cast<unsigned long long>(region),
        static_cast<unsigned long long>(region + kTrampSize));

    if (sig == SIGTRAP && now.pc >= region && now.pc < region + kTrampSize) {
      const uint64_t result = now.x0;
      regs_set(pid_, baseline);
      dbg("[hz] call returned x0=0x%llx\n", static_cast<unsigned long long>(result));
      return result;
    }

    regs_set(pid_, baseline);
    fail(format("call to 0x%llx raised signal %d at pc 0x%llx",
                static_cast<unsigned long long>(fn), sig,
                static_cast<unsigned long long>(now.pc)));
  }
}
#endif  // __aarch64__

std::vector<std::pair<uint64_t, uint64_t>> RemoteProcess::executable_regions_of(
    std::string_view soname) {
  std::vector<std::pair<uint64_t, uint64_t>> out;

  std::string maps;
  try {
    maps = read_file_text(format("/proc/%d/maps", pid_), 32u << 20);
  } catch (const Error&) {
    return out;
  }

  size_t pos = 0;
  while (pos < maps.size()) {
    const size_t eol = maps.find('\n', pos);
    const std::string line =
        maps.substr(pos, eol == std::string::npos ? std::string::npos : eol - pos);
    pos = (eol == std::string::npos) ? maps.size() : eol + 1;

    // start-end perms offset dev inode path
    const size_t dash = line.find('-');
    const size_t space = line.find(' ');
    if (dash == std::string::npos || space == std::string::npos || space < dash) continue;

    const std::string perms = line.substr(space + 1, 4);
    if (perms.size() < 3 || perms[2] != 'x') continue;  // need --x

    const size_t slash = line.find('/');
    if (slash == std::string::npos) continue;
    if (line.find(soname, slash) == std::string::npos) continue;

    uint64_t start = 0;
    uint64_t end = 0;
    if (std::sscanf(line.c_str(), "%llx-%llx",
                    reinterpret_cast<unsigned long long*>(&start),
                    reinterpret_cast<unsigned long long*>(&end)) != 2) {
      continue;
    }
    if (end > start) out.emplace_back(start, end);
  }
  return out;
}

std::optional<uint64_t> RemoteProcess::find_loaded_module(std::string_view soname) {
  std::string maps;
  try {
    maps = read_file_text(format("/proc/%d/maps", pid_), 32u << 20);
  } catch (const Error&) {
    return std::nullopt;
  }

  uint64_t best = 0;
  size_t pos = 0;
  while (pos < maps.size()) {
    const size_t eol = maps.find('\n', pos);
    const std::string_view line =
        std::string_view(maps).substr(pos, eol == std::string::npos ? std::string::npos
                                                                   : eol - pos);
    pos = (eol == std::string::npos) ? maps.size() : eol + 1;

    // Format: start-end perms offset dev inode pathname
    const size_t dash = line.find('-');
    const size_t slash = line.find('/');
    if (dash == std::string_view::npos || slash == std::string_view::npos) continue;

    const std::string_view path = line.substr(slash);
    const size_t base_name = path.find_last_of('/');
    const std::string_view file =
        base_name == std::string_view::npos ? path : path.substr(base_name + 1);
    if (file.find(soname) == std::string_view::npos) continue;

    uint64_t start = 0;
    if (std::sscanf(line.substr(0, dash).data(), "%llx",
                    reinterpret_cast<unsigned long long*>(&start)) != 1) {
      continue;
    }
    if (best == 0 || start < best) best = start;
  }

  if (best == 0) return std::nullopt;
  return best;
}

uint64_t RemoteProcess::remote_mmap(uint64_t len, int prot, int flags) {
  // Syscall numbers are per-architecture and share nothing: mmap is 9 on x86-64
  // and 222 on aarch64.  Using the wrong one does not fail cleanly -- the kernel
  // dispatches whatever lives at that slot with our argument list, which is how
  // this first showed up as a puzzling EFAULT from an unrelated syscall.
#if defined(__aarch64__)
  constexpr uint64_t kSysMmap = 222;
#else
  constexpr uint64_t kSysMmap = 9;
#endif
  const uint64_t result = remote_syscall6(kSysMmap, 0, len, static_cast<uint64_t>(prot),
                                          static_cast<uint64_t>(flags), ~0ull, 0);
  // mmap returns a negative errno on failure, encoded as a large unsigned value.
  if (static_cast<int64_t>(result) < 0 && static_cast<int64_t>(result) > -4096) {
    return 0;
  }
  return result;
}

bool RemoteProcess::remote_munmap(uint64_t addr, uint64_t len) {
#if defined(__aarch64__)
  constexpr uint64_t kSysMunmap = 215;
#else
  constexpr uint64_t kSysMunmap = 11;
#endif
  const uint64_t result = remote_syscall6(kSysMunmap, addr, len, 0, 0, 0, 0);
  return static_cast<int64_t>(result) == 0;
}

}  // namespace hz
