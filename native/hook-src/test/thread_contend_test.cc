// The fault that motivated per-thread attachment.
//
// ptrace attachment is per-thread: /proc/<tid>/status.TracerPid is a per-task
// field, a second SEIZE of an already-traced tid fails with EPERM, and SEIZE of a
// *sibling* tid still succeeds.  A thread left under a tracer that never detached
// -- the state a crashed injector produces, and the state the live runs kept
// finding -- therefore spoils that one thread only.
//
// The old implementation called PTRACE_SEIZE(pid), which the kernel resolved to
// the group leader.  If the leader was the stuck thread, every injection failed
// with EPERM until the target was restarted.  RemoteProcess now enumerates the
// group and takes any tid that accepts it, which is what this test verifies:
//
//   1. start a multithreaded target;
//   2. park an independent "squatter" process on ONE thread of it, the way a dead
//      tracer would, and leave it holding that thread;
//   3. attach with RemoteProcess and require success;
//   4. prove the whole injection pipeline still works on the thread we got
//      (remote mmap + a remote call), not merely that attach() returned;
//   5. run the same attach with the squatter holding the *group leader*, which is
//      the exact case the old SEIZE(pid) could not survive.
//
// Exit status is the number of failed checks, so ctest sees a failure.
//
// Usage: thread_contend_test [--target PATH] [--wrapper PATH] [--verbose]

#include "common.h"
#include "remote.h"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

#include <algorithm>
#include <dirent.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/ptrace.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

namespace {

int failures = 0;
bool verbose = false;

void check(bool condition, const std::string& what) {
  std::printf("  %s %s\n", condition ? "ok  " : "FAIL", what.c_str());
  if (!condition) ++failures;
}

void info(const std::string& what) {
  if (verbose) std::printf("       %s\n", what.c_str());
}

std::string read_text(const std::string& path, size_t limit = 1u << 20) {
  const int fd = ::open(path.c_str(), O_RDONLY);
  if (fd < 0) return {};
  std::string out;
  out.resize(limit);
  const ssize_t n = ::read(fd, out.data(), limit);
  ::close(fd);
  if (n <= 0) return {};
  out.resize(static_cast<size_t>(n));
  return out;
}

bool file_exists(const std::string& path) {
  struct stat st{};
  return ::stat(path.c_str(), &st) == 0;
}

void unlink_if_present(const std::string& path) {
  if (!path.empty()) ::unlink(path.c_str());
}

std::vector<int> tids_of(int pid) {
  std::vector<int> tids;
  DIR* dir = ::opendir(hz::format("/proc/%d/task", pid).c_str());
  if (dir == nullptr) return tids;
  while (dirent* entry = ::readdir(dir)) {
    const int tid = std::atoi(entry->d_name);
    if (tid > 0) tids.push_back(tid);
  }
  ::closedir(dir);
  std::sort(tids.begin(), tids.end());
  return tids;
}

// Per-thread TracerPid.  /proc/<pid>/status is useless here: it reports the group
// leader's tracer, so it reads 0 even while a worker thread is held.
int tracer_of(int pid, int tid) {
  const std::string status =
      read_text(hz::format("/proc/%d/task/%d/status", pid, tid));
  const size_t pos = status.find("TracerPid:");
  if (pos == std::string::npos) return -1;
  return std::atoi(status.c_str() + pos + std::strlen("TracerPid:"));
}

// Every tid that currently carries a tracer, excluding `expected_tracer` (the
// squatter).  A clean group returns empty.
std::vector<std::pair<int, int>> tracers_except(int pid, int expected_tracer) {
  std::vector<std::pair<int, int>> out;
  for (const int tid : tids_of(pid)) {
    const int t = tracer_of(pid, tid);
    if (t != 0 && t != expected_tracer) out.emplace_back(tid, t);
  }
  return out;
}

bool process_alive(int pid) { return ::kill(pid, 0) == 0; }

int wait_for_pidfile(const std::string& path, int timeout_ms) {
  for (int waited = 0; waited < timeout_ms; waited += 20) {
    const std::string text = read_text(path);
    if (!text.empty()) {
      const int pid = std::atoi(text.c_str());
      if (pid > 0) return pid;
    }
    ::usleep(20000);
  }
  return -1;
}

int start_target(const std::string& target, const std::string& wrapper,
                 const std::string& pidfile, int run_seconds) {
  unlink_if_present(pidfile);
  std::fflush(stdout);

  const pid_t pid = ::fork();
  if (pid < 0) return -1;
  if (pid == 0) {
    // Non-child target, exactly like the live case: --orphan makes the
    // intermediate process exit so the target is reparented away from us, and
    // --allow-any is how the target cooperatively waives yama.
    ::execl(target.c_str(), target.c_str(), "--orphan", pidfile.c_str(), "--allow-any",
            "--threads", "6", wrapper.c_str(), std::to_string(run_seconds).c_str(),
            static_cast<char*>(nullptr));
    std::perror("execl fake_target");
    ::_exit(127);
  }
  int status = 0;
  ::waitpid(pid, &status, 0);
  return wait_for_pidfile(pidfile, 5000);
}

// Parks on one thread of the target and holds it: the closest reproduction of a
// tracer that died without detaching, with the advantage of being deterministic
// (a live tracer beats a proven-dead one, because EPERM comes from the kernel's
// tracer field, not from the tracer's liveness).
struct Squatter {
  pid_t pid = -1;
  int held_tid = 0;
  int target_pid = 0;
};

Squatter hold_thread(int target_pid, int tid) {
  Squatter out;
  int ready[2] = {-1, -1};
  if (::pipe(ready) != 0) return out;

  const pid_t pid = ::fork();
  if (pid < 0) {
    ::close(ready[0]);
    ::close(ready[1]);
    return out;
  }
  if (pid == 0) {
    ::close(ready[0]);
    if (::ptrace(PTRACE_SEIZE, tid, nullptr, nullptr) != 0) {
      ::_exit(1);
    }
    ::ptrace(PTRACE_INTERRUPT, tid, nullptr, nullptr);
    int status = 0;
    if (::waitpid(tid, &status, __WALL) != tid) ::_exit(1);
    // Signal readiness only after the thread is actually held, so the parent
    // cannot race the attachment.
    const char byte = 'R';
    if (::write(ready[1], &byte, 1) != 1) ::_exit(1);
    ::close(ready[1]);
    // Hold it for as long as the parent needs.  Returning here would release the
    // thread and destroy the very condition under test.
    for (;;) ::pause();
  }

  ::close(ready[1]);
  char byte = 0;
  // Bounded read: a squatter that failed to attach must not hang the test.
  for (int i = 0; i < 200; ++i) {
    const ssize_t n = ::read(ready[0], &byte, 1);
    if (n == 1 && byte == 'R') break;
    if (n == 0) break;  // child exited without signalling
    ::usleep(10000);
  }
  ::close(ready[0]);

  if (byte != 'R') {
    int status = 0;
    ::kill(pid, SIGKILL);
    ::waitpid(pid, &status, 0);
    return out;
  }
  out.pid = pid;
  out.held_tid = tid;
  out.target_pid = target_pid;
  return out;
}

void release_squatter(Squatter& s) {
  if (s.pid <= 0) return;
  ::kill(s.pid, SIGKILL);
  int status = 0;
  ::waitpid(s.pid, &status, 0);
  s.pid = -1;
  // The kernel drops a dead tracer's relationship, but not instantly: poll the
  // per-thread TracerPid rather than guessing a sleep.
  for (int i = 0; i < 200; ++i) {
    if (tracer_of(s.target_pid, s.held_tid) == 0) break;
    ::usleep(10000);
  }
  ::usleep(20000);
}

// One attach against a contended target, using the real RemoteProcess, plus a
// remote mmap and a remote call so the test proves the whole pipeline works on
// whatever thread was won -- not merely that attach() returned.
struct AttachResult {
  bool threw = false;
  std::string error;
  int tracer_tid = 0;
  bool mmap_ok = false;
  uint64_t call_value = 0;
};

AttachResult attach_under_contention(int pid) {
  AttachResult out;
  try {
    hz::RemoteProcess remote(pid);
    remote.attach();
    out.tracer_tid = remote.tracer_tid();

    // A real remote allocation: mmap runs through the syscall trampoline on the
    // thread we attached, which is what exercises stop_target()/SINGLESTEP.
    const uint64_t page = remote.remote_mmap(4096, 0x1 | 0x2 | 0x4, 0x02 | 0x20);
    out.mmap_ok = page != 0;
    if (page != 0) {
      // A callee that returns a known value, which proves registers and stack
      // both work on the thread we attached.  The encoding is per-architecture:
      // x86-64 puts the result in rax via a movabs, aarch64 in x0 via an ldr from
      // a nearby literal.  Using one architecture's bytes on the other does not
      // fail cleanly -- it executes whatever those bytes decode to and dies with
      // SIGILL (signal 4), which is exactly how this first showed up on arm64.
#if defined(__aarch64__)
      // Layout, so the literal sits between two branches and is never executed:
      //   +0   ldr  x0, #8        loads the 64-bit word at +8
      //   +4   b    #12           skips over the literal to +16
      //   +8   .quad 0x1234      the return value
      //   +16  ret                back to the brk sled remote_call planted
      const uint8_t code[] = {
          0x40, 0x00, 0x00, 0x58,                          // ldr x0, #8
          0x03, 0x00, 0x00, 0x14,                          // b   #12
          0x34, 0x12, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // .quad 0x1234
          0xc0, 0x03, 0x5f, 0xd6,                          // ret
      };
#else
      const uint8_t code[] = {0x48, 0xb8, 0x34, 0x12, 0x00, 0x00, 0x00,
                              0x00, 0x00, 0x00, 0xc3};  // movabs rax,0x1234 ; ret
#endif
      remote.write_exact(page, code, sizeof(code));
      out.call_value = remote.remote_call(page, {}, 0);
      remote.remote_munmap(page, 4096);
    }
    remote.detach();
  } catch (const std::exception& e) {
    out.threw = true;
    out.error = e.what();
    // Clear whatever we did manage to hold, so the next phase starts from a
    // clean group.  ~RemoteProcess does the same, but this is the explicit path.
  }
  return out;
}

}  // namespace

int main(int argc, char** argv) {
  std::string target = "/tmp/hz-test/fake_target";
  std::string wrapper = "/tmp/hz-test/fake-wrapper.node";
  int run_seconds = 90;

  for (int i = 1; i < argc; ++i) {
    const char* a = argv[i];
    const bool has_value = (i + 1 < argc);
    if (std::strcmp(a, "--target") == 0 && has_value) {
      target = argv[++i];
    } else if (std::strcmp(a, "--wrapper") == 0 && has_value) {
      wrapper = argv[++i];
    } else if (std::strcmp(a, "--seconds") == 0 && has_value) {
      run_seconds = std::atoi(argv[++i]);
    } else if (std::strcmp(a, "--verbose") == 0) {
      verbose = true;
    } else {
      std::fprintf(stderr, "usage: %s [--target P] [--wrapper P] [--seconds N]"
                           " [--verbose]\n", argv[0]);
      return 2;
    }
  }

  for (const auto& path : {target, wrapper}) {
    if (!file_exists(path)) {
      std::fprintf(stderr, "missing %s\n", path.c_str());
      return 2;
    }
  }

  const std::string tag = std::to_string(::getpid());
  const std::string pidfile = "/tmp/hz-test/contend-" + tag + ".pid";

  std::printf("target=%s\nwrapper=%s\n", target.c_str(), wrapper.c_str());
  const int pid = start_target(target, wrapper, pidfile, run_seconds);
  if (pid <= 0) {
    std::printf("FAIL could not start fake_target (no pidfile)\n");
    return 1;
  }
  std::printf("target pid=%d\n", pid);

  // Wait for the workers to exist: the point of the test is a *multi*-threaded
  // target, and a single-threaded one has no sibling to fall back to.
  for (int i = 0; i < 300; ++i) {
    if (tids_of(pid).size() >= 4) break;
    ::usleep(10000);
  }
  const std::vector<int> tids = tids_of(pid);
  std::printf("       tids: %zu\n", tids.size());
  check(tids.size() >= 4, "target is multithreaded");
  if (tids.size() < 4) {
    ::kill(pid, SIGKILL);
    ::unlink(pidfile.c_str());
    return failures;
  }
  check(tracer_of(pid, tids[0]) == 0, "no thread is traced before we start");

  // ---- case 1: a worker thread is held ------------------------------------
  // Pick a non-leader on purpose: this is the case the old SEIZE(pid) happened to
  // survive, so it establishes that the new path did not regress the easy case.
  std::printf("\ncase 1: squatter holds a WORKER thread (tid %d)\n", tids[1]);
  Squatter squatter = hold_thread(pid, tids[1]);
  check(squatter.pid > 0, "squatter is holding a worker thread");
  if (squatter.pid <= 0) {
    ::kill(pid, SIGKILL);
    ::unlink(pidfile.c_str());
    return failures;
  }
  check(tracer_of(pid, squatter.held_tid) == static_cast<int>(squatter.pid),
        "the held thread really reports the squatter as its tracer");
  info(hz::format("held tid %d TracerPid=%d", squatter.held_tid,
                  tracer_of(pid, squatter.held_tid)));
  // The claim the whole design rests on: the process-level field does NOT show
  // it.  If this ever starts failing, the per-thread scan is unnecessary -- but
  // while it holds, a process-level leak check is worthless.
  const std::string proc_status = read_text(hz::format("/proc/%d/status", pid));
  const size_t tp = proc_status.find("TracerPid:");
  const int process_level = tp == std::string::npos
                                ? -1
                                : std::atoi(proc_status.c_str() + tp +
                                            std::strlen("TracerPid:"));
  std::printf("       /proc/%d/status TracerPid = %d (leader-level view)\n", pid,
              process_level);
  if (squatter.held_tid != tids[0]) {
    check(process_level == 0,
          "a held worker thread is invisible in /proc/<pid>/status (why the "
          "per-thread scan exists)");
  }

  AttachResult first = attach_under_contention(pid);
  if (first.threw) std::printf("       error: %s\n", first.error.c_str());
  check(!first.threw, "attach succeeds although a worker thread is held");
  check(first.tracer_tid > 0 && first.tracer_tid != squatter.held_tid,
        "the thread we attached is not the held one");
  info(hz::format("attached tid=%d (held=%d)", first.tracer_tid, squatter.held_tid));
  check(first.mmap_ok, "remote mmap works on the thread we won");
  check(first.call_value == 0x1234,
        "remote call returns the callee's value on the thread we won");
  check(process_alive(pid), "target survived a contested attach");

  // Only the squatter's thread may still be traced; everything we touched must
  // be released.
  const auto leftovers = tracers_except(pid, static_cast<int>(squatter.pid));
  for (const auto& [tid, tracer] : leftovers) {
    std::printf("       LEAK: tid %d still has TracerPid=%d\n", tid, tracer);
  }
  check(leftovers.empty(), "no thread other than the squatter's keeps a tracer");

  release_squatter(squatter);
  check(tracer_of(pid, tids[1]) == 0, "held thread is released once the squatter dies");

  // ---- case 2: the group leader is held ----------------------------------
  // This is the regression the rewrite exists for.  PTRACE_SEIZE(pid) resolves to
  // the leader, so with the leader held the old code could only ever get EPERM --
  // for every injection, until the target was restarted.
  std::printf("\ncase 2: squatter holds the GROUP LEADER (tid %d)\n", tids[0]);
  squatter = hold_thread(pid, tids[0]);
  check(squatter.pid > 0, "squatter is holding the group leader");
  if (squatter.pid > 0) {
    info(hz::format("leader TracerPid=%d", tracer_of(pid, tids[0])));

    AttachResult second = attach_under_contention(pid);
    if (second.threw) std::printf("       error: %s\n", second.error.c_str());
    check(!second.threw, "attach succeeds although the group leader is held");
    check(second.tracer_tid > 0 && second.tracer_tid != tids[0],
          "a worker thread was chosen instead of the held leader");
    check(second.mmap_ok, "remote mmap works with the leader held");
    check(second.call_value == 0x1234,
          "remote call returns the callee's value with the leader held");
    check(process_alive(pid), "target survived a leader-contended attach");

    const auto leftovers2 = tracers_except(pid, static_cast<int>(squatter.pid));
    for (const auto& [tid, tracer] : leftovers2) {
      std::printf("       LEAK: tid %d still has TracerPid=%d\n", tid, tracer);
    }
    check(leftovers2.empty(), "no thread other than the leader keeps a tracer");

    release_squatter(squatter);
  }

  // ---- case 3: everything held -> a clean, informative failure ------------
  // If no thread is attachable the injector must say so and list the refusals,
  // rather than reporting a bare EPERM on the process.  It must also not leak.
  std::printf("\ncase 3: every thread held -> the failure names each tid\n");
  std::vector<Squatter> all;
  for (const int tid : tids_of(pid)) {
    Squatter s = hold_thread(pid, tid);
    if (s.pid > 0) all.push_back(s);
  }
  std::printf("       holding %zu of %zu threads\n", all.size(), tids.size());
  {
    bool threw = false;
    std::string message;
    try {
      hz::RemoteProcess remote(pid);
      remote.attach();
      remote.detach();
    } catch (const std::exception& e) {
      threw = true;
      message = e.what();
    }
    check(threw, "attaching to a fully-held target fails");
    // The message has to be diagnostic: it must name the tids it tried.
    check(message.find("tid ") != std::string::npos,
          "the failure lists the tids it tried");
    info(message);
  }
  for (auto& s : all) release_squatter(s);
  check(process_alive(pid), "target survived a fully-contended attach attempt");
  {
    const auto leftovers3 = tracers_except(pid, 0);
    for (const auto& [tid, tracer] : leftovers3) {
      std::printf("       LEAK: tid %d still has TracerPid=%d\n", tid, tracer);
    }
    check(leftovers3.empty(), "a failed attach leaves no thread traced");
  }

  // ---- case 4: the group is free again -----------------------------------
  // Proves the contention runs left nothing permanently stuck: a plain attach
  // now has to succeed.
  std::printf("\ncase 4: contention removed -> a plain attach works again\n");
  {
    AttachResult plain = attach_under_contention(pid);
    if (plain.threw) std::printf("       error: %s\n", plain.error.c_str());
    check(!plain.threw, "attach succeeds once no thread is held");
    check(plain.mmap_ok && plain.call_value == 0x1234,
          "remote mmap and remote call both work again");
    const auto leftovers4 = tracers_except(pid, 0);
    check(leftovers4.empty(), "no thread keeps a tracer after the final detach");
  }

  ::kill(pid, SIGKILL);
  int status = 0;
  ::waitpid(pid, &status, WNOHANG);
  ::unlink(pidfile.c_str());

  std::printf("\n%s (%d failure%s)\n", failures == 0 ? "PASS" : "FAIL", failures,
              failures == 1 ? "" : "s");
  return failures;
}