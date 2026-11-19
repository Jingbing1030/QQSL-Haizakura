#include "remote.h"

#include <algorithm>
#include <chrono>
#include <climits>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <charconv>
#include <cstring>
#include <dirent.h>

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

// Reads "hex-hex" out of a /proc/self/maps line.
//
// from_chars rather than sscanf because sscanf is routed to __isoc23_sscanf by a C23 glibc,
// which pins the whole module to GLIBC_2.38; the QQ containers run Debian 12 at 2.36 and the
// addon then fails to load at all.
bool parse_hex_pair(std::string_view line, uint64_t& lo, uint64_t& hi) {
  const char* first = line.data();
  const char* last = first + line.size();
  const char* dash = static_cast<const char*>(std::memchr(first, '-', line.size()));
  if (dash == nullptr) return false;
  if (std::from_chars(first, dash, lo, 16).ec != std::errc()) return false;
  const char* p = dash + 1;
  const char* stop = p;
  while (stop < last && *stop != ' ') ++stop;
  if (std::from_chars(p, stop, hi, 16).ec != std::errc()) return false;
  return true;
}

}  // namespace

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
    // Argument-register aliases, so call setup code can be written once for both
    // architectures.  aarch64 takes arguments in x0..x5; x86-64 uses the same
    // positional order through rdi, rsi, rdx, rcx, r8, r9.
    struct {
      uint64_t rdi, rsi, rdx, rcx, r8, r9;
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
  // Order matters, and getting it wrong leaks the tracer: release_scratch() ends
  // in remote_munmap -> remote_syscall6 -> stop_target -> attach(), so calling it
  // AFTER detach() re-attaches the target and leaves it traced forever.  Release
  // while still attached, then detach.  (release_scratch() is a no-op for a window
  // that was handed to a detached callee, see leak_scratch().)
  try {
    if (attached_) release_scratch();
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

// A leak of the tracer relationship is not a cosmetic bug, it is the failure the
// live-QQ runs kept hitting: a process is only allowed one tracer at a time, so a
// tracer that dies or unwinds without detaching leaves the target permanently
// un-attachable -- for us and for the reference implementation -- until the target
// is restarted.  Two different hazards, two different mechanisms:
//
//   * an exception or an early return between SEIZE and DETACH  -> ~RemoteProcess
//   * the injector process itself being killed (SIGSEGV in native code, SIGKILL
//     from the OOM killer, the Node runtime aborting on exit 255)
//
// The kernel handles the second case by itself: when a tracer dies without
// detaching, it detaches every tracee automatically.  Measured on this kernel at
// yama ptrace_scope=1, after SIGKILLing the tracer of a stopped target:
// TracerPid returned to 0, the target went back to S and a fresh SEIZE *and*
// ATTACH both succeeded.  So no signal handler is needed to avoid the stuck
// state -- and that matters, because PTRACE_DETACH from a signal handler is
// async-signal-unsafe and would be unsafe precisely when the process is already
// in a bad state.  What the kernel does NOT clean up is the *saved registers*:
// the target is left stopped with our rewritten rip/rsp, so on detach it resumes
// wherever we last pointed it.  That is why the destructor path below (which
// restores registers before DETACH) is the one that must be airtight.

int RemoteProcess::thread_score(pid_t pid, pid_t tid) {
  // Preference order for "which thread should we steal".  A thread parked in a
  // syscall is not holding up anyone else and is not mid-computation, so seizing
  // it costs the target the least; a thread that is actively running is the worst
  // choice, both because we freeze real work and because it is likelier to be the
  // thread a lock or a JIT depends on.
  //
  // The table below is the reference implementation's, recovered from its binary.
  // Kernel wording drifts across versions -- this kernel reports `futex_do_wait`
  // where the table says `futex_wait`, and `hrtimer_nanosleep` where it says
  // `nanosleep` -- so matching is bidirectional: a table entry counts when either
  // string contains the other.  Without that, most entries would silently score 0
  // on a modern kernel and the ordering would degrade to plain tid order.
  static const struct {
    const char* name;
    int score;
  } kScores[] = {
      {"syscall", 100},
      {"ep_poll", 90},
      {"do_epoll", 90},
      {"poll_schedule", 90},
      {"do_sys_poll", 90},
      {"do_select", 90},
      {"hrtimer_nanosleep", 80},
      {"nanosleep", 80},
      {"futex_wait", 70},
      {"futex_do_wait", 70},
      {"schedule_timeout", 60},
      // Not in the reference table, but these are the other shapes a parked
      // worker takes, and all of them beat "actively running".
      {"epoll_wait", 50},
      {"pipe_read", 50},
      {"anon_pipe_read", 50},
      {"do_wait", 40},
  };

  const std::string wchan = [&] {
    try {
      std::string text = read_file_text(format("/proc/%d/task/%d/wchan", pid, tid), 4096);
      while (!text.empty() && (text.back() == '\n' || text.back() == '\0')) text.pop_back();
      return text;
    } catch (const Error&) {
      return std::string();
    }
  }();
  if (wchan.empty()) return 0;

  int best = 0;
  for (const auto& entry : kScores) {
    const std::string needle = entry.name;
    if (wchan.find(needle) != std::string::npos ||
        needle.find(wchan) != std::string::npos) {
      best = std::max(best, entry.score);
    }
  }
  return best;
}

std::vector<pid_t> RemoteProcess::enumerate_threads(pid_t pid) {
  // ptrace attaches one task, not a thread group (measured: SEIZE(leader) marks
  // exactly one tid traced).  So the group has to be enumerated and each tid
  // tried on its own -- that is what makes a thread wedged under a dead tracer a
  // local problem instead of a fatal one.
  std::vector<pid_t> tids;
  const std::string dir = format("/proc/%d/task", pid);
  DIR* d = ::opendir(dir.c_str());
  if (d == nullptr) {
    fail(format("cannot enumerate threads of pid %d (%s): %s", pid, dir.c_str(),
                std::strerror(errno)));
  }
  while (dirent* entry = ::readdir(d)) {
    // Only plain numeric names: "." and ".." are not tids, and neither is
    // anything else the kernel might grow here.
    const char* name = entry->d_name;
    bool numeric = *name != '\0';
    for (const char* p = name; numeric && *p != '\0'; ++p) {
      if (*p < '0' || *p > '9') numeric = false;
    }
    if (!numeric) continue;
    // Parsed rather than strtol: gcc 15 routes strtol to __isoc23_strtol, pinning the module
    // to GLIBC_2.38, which the Debian 12 containers do not have. The digits-only check above
    // makes the conversion exact and overflow-checkable.
    long value = 0;
    bool overflow = false;
    for (const char* p = name; *p != '\0'; ++p) {
      if (value > (INT_MAX - (*p - '0')) / 10) { overflow = true; break; }
      value = value * 10 + (*p - '0');
    }
    if (overflow || value <= 0 || value > INT_MAX) continue;
    const auto tid = static_cast<pid_t>(value);
    // Skip the group leader.  It is the busiest thread in a real target, it is
    // the one a previous tracer is most likely to be holding, and its stop has
    // group-wide effects; the reference implementation skips it too.
    if (tid == pid) continue;
    tids.push_back(tid);
  }
  ::closedir(d);

  // Best-first by wchan score, ties broken by tid so a run is reproducible.
  std::sort(tids.begin(), tids.end(), [pid](pid_t a, pid_t b) {
    const int sa = thread_score(pid, a);
    const int sb = thread_score(pid, b);
    if (sa != sb) return sa > sb;
    return a < b;
  });
  return tids;
}

void RemoteProcess::seize() {
  // PTRACE_SEIZE, not PTRACE_ATTACH.  ATTACH is subject to yama's
  // ptrace_scope: outside a parent/child relationship it fails with EPERM, and a
  // QQ session is not our child.  SEIZE carries no such restriction, which is why
  // the reference implementation uses it: it can attach a live process that is not
  // our child, where ATTACH is refused.
  //
  // The attachment is per THREAD, and that is the whole point of this function.
  // Measured on this kernel against a live 7-thread target:
  //
  //   SEIZE(tid, non-leader)   -> 0      only that tid's TracerPid changes
  //   SEIZE(same tid) again    -> EPERM  "already traced"
  //   SEIZE(a sibling tid)     -> 0      unaffected by the first
  //   SEIZE(leader)            -> 0      also only that one tid
  //
  // So a thread left under a tracer that never detached -- the failure the live
  // runs kept hitting, where TracerPid points at a dead process and every fresh
  // attach gets EPERM -- spoils that thread only.  Enumerating the group and
  // taking the first tid that accepts us makes the injector immune to it, which
  // is exactly how the reference implementation survives the same situation.
  //
  // Note what a tid-based attach does NOT do: /proc/<pid>/status keeps reporting
  // TracerPid 0, because the kernel reports the group leader's tracer there.
  // Every leak check must read /proc/<pid>/task/<tid>/status instead.
  std::vector<pid_t> tids = enumerate_threads(pid_);
  if (tids.empty()) {
    fail(format("target process %d has no attachable thread besides the group leader",
                pid_));
  }

  // Collect failures instead of throwing on the first: after a crashed injector
  // the interesting fact is *which* threads are stuck, and that is the only
  // diagnostic that distinguishes "someone else holds a thread" from a genuine
  // permission problem.
  std::string tried;
  for (const pid_t tid : tids) {
    errno = 0;
    // addr and data are both null: no options requested.  A non-zero PTRACE_O_*
    // set here would change the stop semantics the rest of this file depends on
    // (in particular it would replace the INTERRUPT stop's event code).
    if (::ptrace(PTRACE_SEIZE, tid, nullptr, nullptr) == 0) {
      tracer_tid_ = tid;
      break;
    }
    const int saved_errno = errno;
    if (!tried.empty()) tried += ", ";
    tried += format("tid %d: %s", tid, std::strerror(saved_errno));
  }

  if (tracer_tid_ == 0) {
    fail(format("no thread of pid %d could be seized (%s)", pid_, tried.c_str()));
  }

  dbg("[hz] seized tid %d of pid %d\n", tracer_tid_, pid_);

  // SEIZE leaves the tracee running, so a stop has to be requested explicitly.
  // INTERRUPT gives a group-stop, and PTRACE_GETREGSET/SETREGSET work from it.
  //
  // From here on any failure has to give the tracee back, or we become the zombie
  // tracers this rewrite exists to survive: PTRACE_DETACH on a thread that is
  // still RUNNING fails with ESRCH (measured), so simply returning would leak the
  // attachment with no way for anyone to clear it.
  try {
    if (::ptrace(PTRACE_INTERRUPT, tracer_tid_, nullptr, nullptr) != 0) {
      fail(format("PTRACE_INTERRUPT failed for tid %d: %s", tracer_tid_,
                  std::strerror(errno)));
    }

    int status = 0;
    for (;;) {
      // __WALL is required and sufficient for a non-leader tracee.  Measured:
      // with __WALL, 0, __WCLONE, and __WALL|__WCLONE the stop is reported
      // identically, so there is no non-leader-specific masking rule to get
      // wrong here -- and __WALL keeps working if we ever trace the leader.
      const pid_t w = ::waitpid(tracer_tid_, &status, __WALL);
      if (w < 0) {
        if (errno == EINTR) continue;
        fail(format("target wait failed for tid %d: %s", tracer_tid_,
                    std::strerror(errno)));
      }
      if (WIFSTOPPED(status)) break;
      if (WIFEXITED(status) || WIFSIGNALED(status)) {
        fail(format("target thread %d exited while attaching", tracer_tid_));
      }
    }

    // Record the initial stop so stop_target() does not interrupt again.
    if (saved_ == nullptr) saved_ = new SavedRegs();
    regs_get(tracer_tid_, saved_->regs);
    saved_->valid = true;
  } catch (...) {
    // Best effort, and deliberately swallowing: the original exception says more
    // than anything a cleanup failure could add.  After a successful stop a
    // DETACH is valid; while still running it fails harmlessly with ESRCH.
    ::ptrace(PTRACE_DETACH, tracer_tid_, nullptr, nullptr);
    tracer_tid_ = 0;
    throw;
  }
}

void RemoteProcess::interrupt() {
  if (::ptrace(PTRACE_INTERRUPT, tracer_tid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_INTERRUPT failed for tid %d: %s", tracer_tid_, std::strerror(errno)));
  }
  wait_for_stop();
}

int RemoteProcess::wait_for_stop_until(std::chrono::steady_clock::time_point deadline) {
  // Polls instead of blocking.  WNOHANG is the whole point: a blocking waitpid()
  // cannot respect a deadline, and an unbounded wait is exactly the failure mode
  // that froze the target under a live tracer with the injector inside do_wait.
  // The tick is short enough to keep the timeout honest and long enough that the
  // syscall rate stays negligible (100 Hz).
  constexpr int kTickMicros = 10000;
  for (;;) {
    int status = 0;
    const pid_t w = ::waitpid(tracer_tid_, &status, __WALL | WNOHANG);
    if (w == tracer_tid_) {
      last_wait_status_ = status;
      if (WIFEXITED(status)) {
        fail(format("target process %d exited during injection (code %d)", pid_,
                    WEXITSTATUS(status)));
      }
      if (WIFSIGNALED(status)) {
        fail(format("target process %d was killed by signal %d during injection", pid_,
                    WTERMSIG(status)));
      }
      return tracer_tid_;
    }
    if (w < 0) {
      if (errno == EINTR) continue;
      fail(format("target wait failed for tid %d: %s", tracer_tid_, std::strerror(errno)));
    }
    // w == 0: nothing to report yet.
    if (std::chrono::steady_clock::now() > deadline) return -1;
    ::usleep(kTickMicros);
  }
}

void RemoteProcess::recover_after_failed_call() {
  // Any throw out of remote_call() happens with the tracee RUNNING (we resumed it
  // to let the callee execute) but with saved_->valid still set, because
  // stop_target() recorded a stop on entry.  That inconsistency is what turns a
  // failed call into a leaked tracer: the next operation believes the target is
  // stopped, issues PTRACE_GETREGS against a running task, gets ESRCH, and the
  // detach in the destructor fails -- leaving TracerPid pointing at us with the
  // tracee resumed on registers we rewrote.
  //
  // Restore the invariant instead of papering over it: get the tracee stopped
  // again, put its original registers back, and mark it stopped.  Then unwinding
  // into ~RemoteProcess() -> detach() -> restore_and_continue() finds a target it
  // can actually detach from.
  dbg("[hz] recovery: entered, saved_valid=%d\n",
      (saved_ != nullptr && saved_->valid) ? 1 : 0);
  if (::ptrace(PTRACE_INTERRUPT, tracer_tid_, nullptr, nullptr) != 0) {
    // Already stopped (EIO/ESRCH happen when there is nothing to interrupt), or
    // gone.  Either way there is nothing further we can do here.
    dbg("[hz] recovery: PTRACE_INTERRUPT failed: %s\n", std::strerror(errno));
  } else {
    dbg("[hz] recovery: PTRACE_INTERRUPT ok\n");
  }
  // Bounded wait: a thread wedged in a stop we cannot clear must not block the
  // unwinding path, which is the whole reason we are here.
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
  for (;;) {
    int status = 0;
    const pid_t w = ::waitpid(tracer_tid_, &status, __WALL | WNOHANG);
    if (w == tracer_tid_ && WIFSTOPPED(status)) break;
    if (w < 0 && errno != EINTR) break;
    if (std::chrono::steady_clock::now() > deadline) break;
    ::usleep(10000);
  }
  dbg("[hz] recovery: wait loop done\n");
  try {
    if (saved_ != nullptr && saved_->valid) {
      regs_set(tracer_tid_, saved_->regs);
      // saved_->valid deliberately STAYS true.  It means "the tracee is stopped
      // and saved_->regs is its pre-call register state", and both are still true
      // here.  Clearing it would make the next stop_target() believe the tracee is
      // running and issue an INTERRUPT it does not need; since the tracee is
      // already stopped, no new stop ever arrives and that wait times out -- which
      // is precisely how the first version of this recovery leaked a tracer.
      // Restoring twice is harmless: regs_set is idempotent.
      dbg("[hz] recovery: registers restored\n");
    }
  } catch (const Error& e) {
    // Leave the flag alone: detach() will still try, and a detach that only gets
    // as far as PTRACE_DETACH is better than none.
    dbg("[hz] recovery: could not restore registers: %s\n", e.what());
  }
}

void RemoteProcess::wait_for_stop() {
  int status = 0;
  for (;;) {
    const pid_t w = ::waitpid(tracer_tid_, &status, __WALL);
    if (w < 0) {
      if (errno == EINTR) continue;
      fail(format("target wait failed for tid %d: %s", tracer_tid_, std::strerror(errno)));
    }
    if (WIFSTOPPED(status)) {
      const int sig = WSTOPSIG(status);
      const int event = static_cast<int>(status >> 16);
      dbg("[hz] stopped tid=%d sig=%d (%s) event=%d\n", tracer_tid_, sig,
          ::strsignal(sig), event);
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
  // If a detached callee is living on the current window, that window is
  // untouchable: neither reusable (its stack is in use) nor unmappable (the
  // callee would fault).  Map a fresh one instead and let the old one live out
  // the target's lifetime.  This is the whole scratch lifetime rule in one place:
  // leak_scratch() sets the flag, everything else here respects it.
  if (scratch_leaked_) {
    scratch_addr_ = 0;
    scratch_size_ = 0;
    scratch_leaked_ = false;
  }
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
  // Never unmap a window a detached callee is running on, even if some future
  // caller asks for it explicitly.  The check is here as well as in the
  // destructor because this is the function that would do the damage.
  if (scratch_leaked_) {
    scratch_addr_ = 0;
    scratch_size_ = 0;
    scratch_leaked_ = false;
    return;
  }
  if (scratch_addr_ != 0) {
    remote_munmap(scratch_addr_, scratch_size_);
    scratch_addr_ = 0;
    scratch_size_ = 0;
  }
}

uint64_t RemoteProcess::call_ifunc_resolver(uint64_t resolver) {
  // STT_GNU_IFUNC symbols carry the address of a resolver, not of the function.
  // Calling the resolver with no arguments yields the implementation address.
  //
  // This has to happen *inside the tracee*, not in the injector, for two reasons:
  // IFUNC resolvers are allowed to read CPU capabilities from the target's own
  // auxiliary vector, and the implementation they return is an address in the
  // target's address space -- computing it here would produce an address that
  // only means something in our own process.
  //
  // A resolver never spawns threads, so the plain (waiting) call is correct here.
  try {
    return remote_call(resolver, {}, 0);
  } catch (const Error&) {
    // A resolver that cannot be called leaves us no better answer than the raw
    // symbol value.  That is still wrong for an IFUNC, but it is the historical
    // behaviour, and failing the whole load would reject payloads that merely
    // reference a symbol they never call.
    return resolver;
  }
}

uint64_t RemoteProcess::remote_call_detached(uint64_t fn, const std::vector<uint64_t>& args,
                                            size_t argc) {
  // For callees that spawn threads and keep running -- a hook payload's
  // start_dynamic takes that shape.  Waiting for it to return is wrong twice
  // over: the value never comes, and every thread it creates traps under our
  // ptrace session, where a non-main-thread stop is indistinguishable from a
  // crash in the callee.  Set up the call, let the target run, and let go.
  // The callee returns into `region`, so the first bytes there must not be int3.
  // `remote_call` uses an int3 sled because it stays attached and *catches* the
  // trap; here we have deliberately let go, and an uncaught SIGTRAP from
  // returning into the sled has SIGTRAP's default action: the kernel kills the
  // whole thread group.  That is exactly the failure this test first showed --
  // socket created, marker written, target dead a moment later.
  //
  // Instead park on a `jmp $` (EB FE): returning from the callee spins one
  // thread forever inside an executable, permanently mapped page.  A spinning
  // thread is a leak of one thread's worth of CPU, but it cannot corrupt memory
  // and it cannot kill the host, which makes it the correct failure mode for a
  // call we are not going to supervise.  A `ret`-to-`hlt` is not an option:
  // hlt outside ring 0 is SIGSEGV.
  constexpr size_t kTrampSize = 64;
  constexpr size_t kStackSize = 128 * 1024;
  const uint64_t region = scratch_buffer(kTrampSize + kStackSize);

  // Park the returning thread in a blocking syscall, not a userspace spin.
  //
  // A spin -- `jmp $` (EB FE), or even a yielding `pause`/`wfe` loop -- keeps the
  // thread runnable, so it holds a full core forever and every injection leaks
  // one.  On a two-core box two injections starved every other thread and the
  // target's heartbeat froze.  A payload lives as long as the session, so that is
  // not an acceptable failure mode.
  //
  // A blocking syscall is what we want, and one that ends only the thread would be
  // wrong: exit_group would kill the whole target.  pause(2) blocks the calling
  // thread indefinitely and never returns on Linux:
  //   x86-64 : mov eax, 34 ; syscall        (B8 22 00 00 00 0F 05)
  //   aarch64: mov x8, #101 ; svc #0        (movz x8,#101 : D2800CA8, svc : D4000001)
  // pause(2) blocks indefinitely and, being interruptible only by a fatal signal,
  // costs no CPU.  If it ever returns, fall through into a spin so the thread
  // cannot run off the end of the mapped page into arbitrary code.
#if defined(__aarch64__)
  const uint8_t park[12] = {0xa8, 0x0c, 0x80, 0xd2, 0x01, 0x00, 0x00, 0xd4,
                            0x00, 0x00, 0x00, 0x14};  // movz x8,#101; svc #0; b .
#else
  const uint8_t park[12] = {0xb8, 0x22, 0x00, 0x00, 0x00, 0x0f, 0x05,
                            0xeb, 0xfe, 0x90, 0x90, 0x90};  // mov eax,34; syscall; jmp $
#endif
  write_exact(region, park, sizeof(park));

  const uint64_t stack_top = (region + kTrampSize + kStackSize) & ~static_cast<uint64_t>(0xf);
#if defined(__aarch64__)
  // AArch64 returns through x30, not through a stack slot, and the ABI requires SP
  // to be 16-byte aligned at every instruction boundary.  The x86 shape -- push the
  // return address and leave SP at top-8 -- is 8-byte aligned, so the first SIMD
  // spill in the callee (stp q0,q1,[sp] in glibc's memcpy/memset) takes an alignment
  // fault.  The kernel reports that as SIGBUS, and because this call deliberately
  // detaches first there is nobody to catch it: the handler-less default kills the
  // whole thread group a moment after the seemingly successful injection.
  const uint64_t new_rsp = stack_top;
#else
  const uint64_t new_rsp = stack_top - 8;
  write_value<uint64_t>(new_rsp, region);
#endif

  stop_target();
  Regs baseline{};
  regs_get(tracer_tid_, baseline);

  Regs regs = baseline;
  regs.rip = fn;
  regs.rsp = new_rsp;
#if defined(__x86_64__)
  // Mark the tracee as not inside a syscall.  Without this the kernel believes a
  // system call is still in flight and rewinds rip by the length of the `syscall`
  // instruction on resume, landing in the middle of the previous instruction.
  // aarch64 has no orig_rax: pstate carries that state instead, so nothing to do.
  regs.orig_rax = static_cast<uint64_t>(-1);
#endif
  regs.rdi = argc > 0 ? args[0] : 0;
  regs.rsi = argc > 1 ? args[1] : 0;
  regs.rdx = argc > 2 ? args[2] : 0;
  regs.rcx = argc > 3 ? args[3] : 0;
  regs.r8 = argc > 4 ? args[4] : 0;
  regs.r9 = argc > 5 ? args[5] : 0;
#if defined(__aarch64__)
  // Return address register.  remote_call() sets this on its own path; without it
  // here the callee's `ret` jumps to whatever x30 happened to hold, which for a
  // freshly attached thread is the interrupted libc address.
  regs.x30 = region;
#endif
  regs_set(tracer_tid_, regs);

  dbg("[hz] remote_call_detached fn=0x%llx rsp=0x%llx\n",
      static_cast<unsigned long long>(fn), static_cast<unsigned long long>(new_rsp));

  // Hand the target back to itself and let the call run on its own threads.
  // Nothing below waits: the scratch window is left mapped on purpose, because
  // unmapping it would pull the callee's stack out from under it.
  if (::ptrace(PTRACE_DETACH, tracer_tid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_DETACH failed for tid %d: %s", tracer_tid_, std::strerror(errno)));
  }
  attached_ = false;

  leak_scratch();
  return 0;
}

void RemoteProcess::leak_scratch() {
  // Deliberately forget the window without unmapping it.  It holds the callee's
  // live stack, and the callee is still running on it -- releasing it pulls the
  // ground out from under the hook the moment it starts, which looks exactly like
  // the hook failing to start: the module maps, the entry point is valid, and no
  // socket ever appears.  The window is a few pages and lives until the target
  // exits, which is the correct lifetime for a payload's own stack.
  //
  // The flag is what makes this safe rather than merely lucky: without it the
  // next scratch_buffer() call would happily reuse or unmap the leaked window,
  // which is the same crash one call later.
  if (scratch_addr_ == 0) return;
  dbg("[hz] leaking scratch window 0x%llx (%zu bytes) for a detached callee\n",
      static_cast<unsigned long long>(scratch_addr_), scratch_size_);
  scratch_addr_ = 0;
  scratch_size_ = 0;
  scratch_leaked_ = true;
}

void RemoteProcess::detach() {
  dbg("[hz] detach: entered attached_=%d saved_valid=%d\n", attached_ ? 1 : 0,
      (saved_ != nullptr && saved_->valid) ? 1 : 0);
  if (!attached_) return;
  // The scratch window is NOT released here any more.  It may be holding a live
  // callee stack (see remote_call_detached), and we cannot tell from here whether
  // it is.  A window a few pages in size is not worth crashing the target over;
  // release_scratch() is called explicitly by callers that own the decision.
  try {
    restore_and_continue();
  } catch (...) {
    dbg("[hz] detach: restore_and_continue threw\n");
    attached_ = false;
    throw;
  }
  dbg("[hz] detach: done\n");
  attached_ = false;
}

void RemoteProcess::restore_and_continue() {
  if (saved_ != nullptr && saved_->valid) {
    // Put the original registers back so the target never observes our state.
    regs_set(tracer_tid_, saved_->regs);
    saved_->valid = false;
  }
  if (::ptrace(PTRACE_DETACH, tracer_tid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_DETACH failed for tid %d: %s", tracer_tid_, std::strerror(errno)));
  }
  dbg("[hz] restore_and_continue: PTRACE_DETACH ok\n");
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
  // but resuming with SINGLESTEP does not.
  //
  // That difference is not cosmetic, it is the hang that made this loader look
  // like it wedged the target.  Measured on this kernel, from a group-stop
  // produced by INTERRUPT:
  //
  //   GETREGS    -> succeeds
  //   SINGLESTEP -> returns 0
  //   waitpid    -> NEVER returns; the step never completes
  //
  // The single-step completion is what the syscall trampoline waits for, so every
  // mmap/munmap in the target stalled forever with the tracee held under our
  // ptrace session -- the target frozen, TracerPid non-zero, and the injector
  // blocked inside the wait.  The same sequence after a real signal-delivery-stop
  // completes immediately.  Reproduced deterministically, single-threaded.
  //
  // So: interrupt to get the tracee stopped, then turn that group-stop into a
  // signal-delivery-stop by resuming it and delivering SIGSTOP.  SIGSTOP is the
  // right signal because it cannot be caught, blocked or ignored, so the stop we
  // get back is guaranteed and carries no handler side effects in the target.
  // If the tracee is already stopped -- which happens when the previous call
  // threw and the recovery path left it stopped -- INTERRUPT is unnecessary and
  // its stop is already pending.  Sending it again makes waitpid() below consume
  // the *old* stop while the new one stays queued, and every subsequent wait is
  // then off by one: the injector blocks forever on a stop that already arrived.
  // That is exactly how the timeout path leaked a tracer.
  const bool was_stopped = (saved_ != nullptr && saved_->valid);
  if (!was_stopped) {
    if (::ptrace(PTRACE_INTERRUPT, tracer_tid_, nullptr, nullptr) != 0) {
      fail(format("PTRACE_INTERRUPT failed for tid %d: %s", tracer_tid_, std::strerror(errno)));
    }
  }
  // Every wait below is deadline-bounded.  These are the waits that can wedge:
  // they are entered with the tracee in a stop state produced by a signal rather
  // than by our own instruction, and if any of them never arrives the injector
  // would sit in do_wait with the target held as a tracee -- the exact freeze the
  // live runs produced.
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);

  // Consume the group-stop.  This one is not used for register writes; it only
  // clears the group-stop state.
  if (!was_stopped) {
    if (wait_for_stop_until(deadline) < 0) {
      fail("timed out waiting for the interrupt stop");
    }
  }
  //
  // Resuming WITH the SIGSTOP as PTRACE_CONT's data does not work: the kernel
  // folds the stop request into the group-stop that is already pending and the
  // tracee simply runs, with no second stop to wait for.  Measured, three times
  // in a row.  The signal has to arrive *after* the tracee is running again, so
  // the target has a genuine signal to deliver and we get a genuine
  // signal-delivery-stop.
  if (::ptrace(PTRACE_CONT, tracer_tid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_CONT failed for tid %d: %s", tracer_tid_, std::strerror(errno)));
  }
  if (::kill(tracer_tid_, SIGSTOP) != 0) {
    fail(format("could not deliver SIGSTOP to tid %d: %s", tracer_tid_, std::strerror(errno)));
  }
  if (wait_for_stop_until(deadline) < 0) {
    fail("timed out waiting for SIGSTOP delivery");
  }

  regs_get(tracer_tid_, saved_->regs);
  saved_->valid = true;
}

void RemoteProcess::resume_target() {
  if (saved_ != nullptr && saved_->valid) {
    regs_set(tracer_tid_, saved_->regs);
    saved_->valid = false;
  }
  if (::ptrace(PTRACE_CONT, tracer_tid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_CONT failed for tid %d: %s", tracer_tid_, std::strerror(errno)));
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
  regs_get(tracer_tid_, baseline);

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

  regs_set(tracer_tid_, regs);

  dbg("[hz] syscall nr=%llu site=0x%llx orig_rip=0x%llx\n",
      static_cast<unsigned long long>(number),
      static_cast<unsigned long long>(syscall_site_),
      static_cast<unsigned long long>(regs.rip));

  if (::ptrace(PTRACE_SINGLESTEP, tracer_tid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_SINGLESTEP failed for tid %d: %s", tracer_tid_, std::strerror(errno)));
  }
  wait_for_stop();

  Regs after{};
  regs_get(tracer_tid_, after);
  dbg("[hz] after syscall rax=0x%llx rip=0x%llx (expected rip 0x%llx)\n",
      static_cast<unsigned long long>(after.rax),
      static_cast<unsigned long long>(after.rip),
      static_cast<unsigned long long>(syscall_site_ + 2));

  // Restore the pre-syscall register state; the tracee stays stopped.
  regs_set(tracer_tid_, saved_->regs);

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
  regs_get(tracer_tid_, baseline);

  Regs regs = baseline;
  regs.x8 = number;
  regs.x0 = a1;
  regs.x1 = a2;
  regs.x2 = a3;
  regs.x3 = a4;
  regs.x4 = a5;
  regs.x5 = a6;
  regs.pc = syscall_site_;

  regs_set(tracer_tid_, regs);

  dbg("[hz] syscall nr=%llu site=0x%llx\n", static_cast<unsigned long long>(number),
      static_cast<unsigned long long>(syscall_site_));

  if (::ptrace(PTRACE_SINGLESTEP, tracer_tid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_SINGLESTEP failed for tid %d: %s", tracer_tid_, std::strerror(errno)));
  }
  wait_for_stop();

  Regs after{};
  regs_get(tracer_tid_, after);
  dbg("[hz] after syscall x0=0x%llx pc=0x%llx (expected pc 0x%llx)\n",
      static_cast<unsigned long long>(after.x0),
      static_cast<unsigned long long>(after.pc),
      static_cast<unsigned long long>(syscall_site_ + 4));

  // Restore what we found; the tracee stays stopped for the caller.
  regs_set(tracer_tid_, baseline);
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
  // Everything below runs with the tracee resumed at some point, so any throw has
  // to put it back into a detachable state before it leaves this function.  See
  // recover_after_failed_call() for what goes wrong when it does not.
  try {
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
#if defined(__aarch64__)
  // Same ABI constraint as in remote_call_detached: SP has to stay 16-byte aligned,
  // and the return address travels in x30 rather than in a stack slot.
  const uint64_t new_rsp = stack_top;
#else
  const uint64_t new_rsp = stack_top - 8;
  write_value<uint64_t>(new_rsp, region);
#endif

  stop_target();

  // Snapshot the live registers: earlier trampolines have moved rip, so the
  // attach-time record is not a valid baseline.
  Regs baseline{};
  regs_get(tracer_tid_, baseline);

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

  regs_set(tracer_tid_, regs);

  // Read back: this is the single most useful diagnostic when a step misbehaves,
  // because it distinguishes "the kernel did not accept rip" from "the instruction
  // faulted".
  Regs applied{};
  regs_get(tracer_tid_, applied);
  dbg("[hz] applied rip=0x%llx rsp=0x%llx (wanted 0x%llx/0x%llx)\n",
      static_cast<unsigned long long>(applied.rip),
      static_cast<unsigned long long>(applied.rsp),
      static_cast<unsigned long long>(fn), static_cast<unsigned long long>(new_rsp));

  // Every tolerated off-sled trap is counted; the limit is what keeps a stuck
  // stop from becoming an infinite resume loop.
  constexpr int kMaxOffSledTraps = 16;
  int offSledTraps = 0;

  // Hard deadline for the whole wait.  Without one, a callee that blocks forever
  // (or a thread that cannot be resumed) hangs the injector's worker thread with
  // the target stopped under our ptrace session -- which is worse than a failed
  // injection, because the target stays frozen until we die.  The caller's own
  // timeout cannot help: it never gets control back.
  const auto deadline = std::chrono::steady_clock::now() +
                        std::chrono::seconds(call_timeout_seconds_);

  // Run the function to completion.  The `data` argument is the signal to inject;
  // passing 0 resumes without delivering anything, which is what we want since the
  // stop from attaching has already been consumed by waitpid.
  if (::ptrace(PTRACE_CONT, tracer_tid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_CONT failed for tid %d: %s", tracer_tid_, std::strerror(errno)));
  }

  for (;;) {
    // wait_for_stop_until() polls with a bounded timeout rather than blocking in
    // waitpid().  A blocking wait cannot be bounded: a callee that never returns
    // would park this thread in do_wait forever, and the deadline above would
    // never be evaluated.  That is not hypothetical -- it is what the hang test
    // did the first time round: the target sat healthy in S with TracerPid still
    // pointing at us, and the injector sat in do_wait.
    //
    // The status of the stop it found comes back through last_wait_status_, not
    // through an out-parameter: leaving a local `status` unassigned here makes
    // WIFEXITED(0) true -- macro-arithmetically "exited with code 0" -- so every
    // single stop was misreported as "target died inside the callee".
    const int w = wait_for_stop_until(deadline);
    if (w < 0) {
      fail(format("call into 0x%llx timed out after %d s; the callee or one of "
                  "its threads never resumed",
                  static_cast<unsigned long long>(fn), call_timeout_seconds_));
    }
    const int status = last_wait_status_;
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      fail(format("target thread %d died inside 0x%llx", tracer_tid_,
                  static_cast<unsigned long long>(fn)));
    }
    if (!WIFSTOPPED(status)) continue;

    const int sig = WSTOPSIG(status);
    Regs now{};
    regs_get(tracer_tid_, now);
    dbg("[hz] stop sig=%d rip=0x%llx (sled 0x%llx..0x%llx)\n", sig,
        static_cast<unsigned long long>(now.rip),
        static_cast<unsigned long long>(region),
        static_cast<unsigned long long>(region + kTrampSize));

    // Returning into the sled is the success case.
    if (sig == SIGTRAP && now.rip >= region && now.rip < region + kTrampSize) {
      const uint64_t result = now.rax;
      // Restore the target to how we found it.
      regs_set(tracer_tid_, baseline);
      dbg("[hz] call returned rax=0x%llx\n", static_cast<unsigned long long>(result));
      return result;
    }


    // A stop that is not ours and not the main thread belongs to a thread the
    // callee just created.  A hook payload spawns its listener threads inside
    // this call, and those threads trap and fault on their own: treating their
    // stops as failures aborted the call with "raised signal 5 at rip 0x..." from
    // an address nowhere near the callee.  Forward the signal and keep waiting
    // for the main thread's return into the sled.
    if (w != tracer_tid_) {
      const int deliver = sig == SIGTRAP ? 0 : sig;
      if (::ptrace(PTRACE_CONT, w, nullptr,
                   reinterpret_cast<void*>(static_cast<intptr_t>(deliver))) != 0) {
        fail(format("cannot resume thread %d: %s", w, std::strerror(errno)));
      }
      continue;
    }

    // Signal 5 delivered to the main thread just after a new thread started is
    // the pthread bookkeeping trap, not a fault in the callee.
    //
    // Both of the tolerated branches below are BOUNDED by offSledTraps, and the
    // bound is the fix for the worst failure this loader has produced: an
    // unbounded "any SIGTRAP is bookkeeping" rule turned a payload that re-tripped
    // the same breakpoint into an infinite resume loop.  On live QQ that showed up
    // in the log as `stop sig=5 rip=0xb6a750b37624` repeated tens of thousands of
    // times, and the node process exited 255 with the target still frozen under
    // our tracer.  A stop we cannot make progress past is a failure, not
    // bookkeeping, so after a bounded number of them the call is aborted -- which
    // unwinds into ~RemoteProcess and detaches.
    if (sig == SIGTRAP && offSledTraps < kMaxOffSledTraps &&
        (now.rip < fn || now.rip > fn + (1u << 20))) {
      ++offSledTraps;
      if (::ptrace(PTRACE_CONT, tracer_tid_, nullptr, nullptr) != 0) {
        fail(format("cannot resume tid %d: %s", tracer_tid_, std::strerror(errno)));
      }
      continue;
    }

    // A trap from somewhere other than the callee is the debug-exception path
    // reporting a thread the callee just started, or the callee's own intentional
    // breakpoint.  Neither is a failure of the call we made, and aborting on them
    // is what turned a working payload into a dead QQ: the first trap from a
    // freshly spawned listener thread looked exactly like a crash.
    if (sig == SIGCHLD || sig == SIGPIPE) {
      if (::ptrace(PTRACE_CONT, tracer_tid_, nullptr, nullptr) != 0) {
        fail(format("cannot resume tid %d inside 0x%llx: %s", tracer_tid_,
                    static_cast<unsigned long long>(fn), std::strerror(errno)));
      }
      continue;
    }
    if (sig == SIGTRAP && offSledTraps < kMaxOffSledTraps) {
      ++offSledTraps;
      if (::ptrace(PTRACE_CONT, tracer_tid_, nullptr, nullptr) != 0) {
        fail(format("cannot resume tid %d inside 0x%llx: %s", tracer_tid_,
                    static_cast<unsigned long long>(fn), std::strerror(errno)));
      }
      continue;
    }

    // Any other signal is a real fault inside the callee.
    fail(format("call to 0x%llx raised signal %d at rip 0x%llx",
                static_cast<unsigned long long>(fn), sig,
                static_cast<unsigned long long>(now.rip)));
  }
  } catch (...) {
    recover_after_failed_call();
    throw;
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

  // Every tolerated off-sled trap is counted; the limit stops a stuck stop from
  // becoming an infinite resume loop.
  constexpr int kMaxOffSledTraps = 16;
  int offSledTraps = 0;

  stop_target();

  Regs baseline{};
  regs_get(tracer_tid_, baseline);

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

  regs_set(tracer_tid_, regs);

  Regs applied{};
  regs_get(tracer_tid_, applied);
  dbg("[hz] applied pc=0x%llx sp=0x%llx (wanted 0x%llx/0x%llx)\n",
      static_cast<unsigned long long>(applied.pc),
      static_cast<unsigned long long>(applied.rsp),
      static_cast<unsigned long long>(fn),
      static_cast<unsigned long long>(stack_top));

  if (::ptrace(PTRACE_CONT, tracer_tid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_CONT failed for tid %d: %s", tracer_tid_, std::strerror(errno)));
  }

  int status = 0;
  for (;;) {
    const pid_t w = ::waitpid(tracer_tid_, &status, __WALL);
    if (w < 0) {
      if (errno == EINTR) continue;
      fail(format("target wait failed for tid %d: %s", tracer_tid_, std::strerror(errno)));
    }
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      fail(format("target thread %d died inside 0x%llx", tracer_tid_,
                  static_cast<unsigned long long>(fn)));
    }
    if (!WIFSTOPPED(status)) continue;

    const int sig = WSTOPSIG(status);
    Regs now{};
    regs_get(tracer_tid_, now);
    dbg("[hz] stop sig=%d pc=0x%llx (sled 0x%llx..0x%llx)\n", sig,
        static_cast<unsigned long long>(now.pc),
        static_cast<unsigned long long>(region),
        static_cast<unsigned long long>(region + kTrampSize));

    if (sig == SIGTRAP && now.pc >= region && now.pc < region + kTrampSize) {
      const uint64_t result = now.x0;
      regs_set(tracer_tid_, baseline);
      dbg("[hz] call returned x0=0x%llx\n", static_cast<unsigned long long>(result));
      return result;
    }

    // A stop that is not ours belongs to a thread the callee just created.  The
    // payload's start_dynamic spawns its listener threads inside this call, and
    // those threads hit the debug-exception path on their own.  Treating their
    // stops as failures aborted the call with "raised signal 5 at pc 0x..." from
    // an address nowhere near the callee, which is exactly what we saw: pc
    // 0xb27e16027624 against a callee at 0xe6f62bfbdf3c.
    if (w != tracer_tid_) {
      const int deliver = sig == SIGTRAP ? 0 : sig;
      if (::ptrace(PTRACE_CONT, w, nullptr,
                   reinterpret_cast<void*>(static_cast<intptr_t>(deliver))) != 0) {
        fail(format("cannot resume thread %d: %s", w, std::strerror(errno)));
      }
      continue;
    }

    // Bounded tolerance for a SIGTRAP that is neither ours nor a fault in the
    // callee.  A freshly cloned thread can report a debug trap before it becomes
    // visible to waitpid, and that is bookkeeping -- but only a finite number of
    // them are bookkeeping.  Resuming every SIGTRAP forever turns a stuck stop
    // into a spin that never returns: the same pc was resumed thousands of times
    // while the caller waited and eventually died, with the target held in a
    // traced state afterwards.  Cap it and fail loudly instead.
    if (sig == SIGTRAP && offSledTraps < kMaxOffSledTraps) {
      ++offSledTraps;
      if (::ptrace(PTRACE_CONT, tracer_tid_, nullptr, nullptr) != 0) {
        fail(format("cannot resume tid %d inside 0x%llx: %s", tracer_tid_,
                    static_cast<unsigned long long>(fn), std::strerror(errno)));
      }
      continue;
    }

    regs_set(tracer_tid_, baseline);
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

    // Hex bounds parsed with from_chars for the same reason as elsewhere in this file: gcc 15
    // with a C23 glibc turns sscanf into __isoc23_sscanf, and a GLIBC_2.38 dependency will not
    // load on the Debian 12 containers.
    uint64_t start = 0;
    uint64_t end = 0;
    if (!parse_hex_pair(line, start, end)) continue;
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
    {
      const char* p = line.data();
      const char* last = p + dash;
      if (std::from_chars(p, last, start, 16).ec != std::errc()) continue;
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
