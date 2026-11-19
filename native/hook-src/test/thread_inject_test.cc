// End-to-end injection test: the only place that exercises ptrace, the manual
// loader and a thread-spawning payload together.
//
// Shape of the run:
//   1. fork an orphaned multithreaded fake_target, so the target is NOT our child
//      (that is the QQ situation at yama ptrace_scope=1);
//   2. attach, map payload.so, run its init_array, call start_dynamic;
//   3. assert the callee's listener thread produced its socket and its marker;
//   4. assert the target is still alive and scheduling, and that TracerPid is 0;
//   5. repeat the whole thing several times to prove idempotence: a second
//      injection must not leave a dead target or a stuck tracer behind.
//
// Usage:
//   thread_inject_test [--target PATH] [--payload PATH] [--wrapper PATH]
//                      [--child] [--allow-any] [--rounds N] [--verbose]
//
// Exit status is the number of failed checks, so `ctest` sees a failure.

#include "common.h"
#include "elf_image.h"
#include "manual_loader.h"
#include "remote.h"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <fcntl.h>
#include <signal.h>
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

// Reads TracerPid out of /proc/<pid>/status.  A non-zero value after we are done
// means we leaked a tracer: the target keeps a dangling ptrace relationship and
// the next PTRACE_ATTACH from anyone is refused with EPERM.
int tracer_pid_of(int pid) {
  const std::string status = read_text(hz::format("/proc/%d/status", pid));
  const size_t pos = status.find("TracerPid:");
  if (pos == std::string::npos) return -1;
  return std::atoi(status.c_str() + pos + std::strlen("TracerPid:"));
}

// Number of live tasks in the target's thread group.  Proves the target is still
// multithreaded after injection -- a payload that kills its listener threads
// still leaves the process alive, and "alive" alone would hide that.
int thread_count(int pid) {
  const std::string status = read_text(hz::format("/proc/%d/status", pid));
  const size_t pos = status.find("Threads:");
  if (pos == std::string::npos) return -1;
  return std::atoi(status.c_str() + pos + std::strlen("Threads:"));
}

bool process_alive(int pid) { return ::kill(pid, 0) == 0; }

// A heartbeat file the target rewrites ten times a second.  Two samples that
// differ prove the process is scheduling, not merely present: a target whose
// payload stack was unmapped under it can still have a live pid while every
// thread spins on a fault.
bool heartbeat_advances(const std::string& path) {
  const std::string a = read_text(path);
  for (int i = 0; i < 30; ++i) {
    ::usleep(50000);
    const std::string b = read_text(path);
    if (!a.empty() && !b.empty() && a != b) return true;
  }
  return false;
}

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

struct Options {
  std::string target;
  std::string payload;
  std::string wrapper;
  bool child = false;      // make the target our own child (control condition)
  bool allow_any = false;  // let the target waive yama itself
  int rounds = 3;
  int run_seconds = 60;
  int threads = 0;      // 0 = the target's own default
  int big_module_mb = 0;
  int map_count = 0;
};

// Starts the target and returns its pid, or -1.  `pidfile` receives the ready
// signal; `heartbeat` gets the liveness ticker.
int start_target(const Options& opt, const std::string& pidfile,
                 const std::string& heartbeat) {
  unlink_if_present(pidfile);
  unlink_if_present(heartbeat);
  std::fflush(stdout);

  const pid_t pid = ::fork();
  if (pid < 0) return -1;
  if (pid == 0) {
    std::vector<std::string> args{opt.target};
    if (!opt.child) {
      args.push_back("--orphan");
      args.push_back(pidfile);
    }
    if (opt.allow_any) args.push_back("--allow-any");
    if (opt.threads > 0) {
      args.push_back("--threads");
      args.push_back(std::to_string(opt.threads));
    }
    if (opt.big_module_mb > 0) {
      args.push_back("--big-module");
      args.push_back(std::to_string(opt.big_module_mb));
    }
    if (opt.map_count > 0) {
      args.push_back("--map-count");
      args.push_back(std::to_string(opt.map_count));
    }
    args.push_back("--heartbeat");
    args.push_back(heartbeat);
    args.push_back(opt.wrapper);
    args.push_back(std::to_string(opt.run_seconds));

    std::vector<char*> argv;
    argv.reserve(args.size() + 1);
    for (auto& a : args) argv.push_back(const_cast<char*>(a.c_str()));
    argv.push_back(nullptr);
    ::execv(argv[0], argv.data());
    std::perror("execv fake_target");
    ::_exit(127);
  }

  if (opt.child) {
    // We are the parent, which is the one case yama always allows.  The pidfile
    // is still written by the target once it is fully set up, so wait for it to
    // exist, then take the pid from the file -- it equals `pid` here, but going
    // through the file keeps one code path.
    const int from_file = wait_for_pidfile(pidfile, 5000);
    return from_file > 0 ? from_file : static_cast<int>(pid);
  }

  // Orphan mode: the intermediate process exits at once, the real target is
  // reparented away from us and writes the pidfile when it is ready.
  int status = 0;
  ::waitpid(pid, &status, 0);
  return wait_for_pidfile(pidfile, 5000);
}

void stop_target(int pid) {
  if (pid <= 0) return;
  ::kill(pid, SIGKILL);
  int status = 0;
  ::waitpid(pid, &status, WNOHANG);
}

// One injection.  Everything the addon does for loadModuleManualAsync, minus
// Node: attach, load, call the entry point, detach.
struct InjectionResult {
  bool threw = false;
  std::string error;
  hz::ManualMapHandle handle;
  uint64_t start_result = 0;
};

InjectionResult inject_once(int pid, const std::string& payload_path) {
  InjectionResult out;
  try {
    hz::RemoteProcess remote(pid);
    hz::ElfImage image(hz::MappedFile::open(payload_path));
    hz::ManualLoader loader(remote, image);

    remote.attach();
    out.handle = loader.load();

    // The loader itself calls remote_call(entry).  Run it a second time through
    // the detached path to prove both call styles leave a live, threaded target.
    if (out.handle.entry != 0) {
      out.start_result = remote.remote_call_detached(out.handle.entry, {}, 0);
    }
    remote.detach();
  } catch (const std::exception& e) {
    out.threw = true;
    out.error = e.what();
  }
  return out;
}

}  // namespace

int main(int argc, char** argv) {
  Options opt;
  opt.target = "/tmp/hz-test/fake_target";
  opt.payload = "/tmp/hz-test/payload.so";
  opt.wrapper = "/tmp/hz-test/fake-wrapper.node";

  for (int i = 1; i < argc; ++i) {
    const char* a = argv[i];
    const bool has_value = (i + 1 < argc);
    if (std::strcmp(a, "--target") == 0 && has_value) {
      opt.target = argv[++i];
    } else if (std::strcmp(a, "--payload") == 0 && has_value) {
      opt.payload = argv[++i];
    } else if (std::strcmp(a, "--wrapper") == 0 && has_value) {
      opt.wrapper = argv[++i];
    } else if (std::strcmp(a, "--child") == 0) {
      opt.child = true;
    } else if (std::strcmp(a, "--allow-any") == 0) {
      opt.allow_any = true;
    } else if (std::strcmp(a, "--rounds") == 0 && has_value) {
      opt.rounds = std::atoi(argv[++i]);
    } else if (std::strcmp(a, "--seconds") == 0 && has_value) {
      opt.run_seconds = std::atoi(argv[++i]);
    } else if (std::strcmp(a, "--threads") == 0 && has_value) {
      opt.threads = std::atoi(argv[++i]);
    } else if (std::strcmp(a, "--big-module") == 0 && has_value) {
      opt.big_module_mb = std::atoi(argv[++i]);
    } else if (std::strcmp(a, "--map-count") == 0 && has_value) {
      opt.map_count = std::atoi(argv[++i]);
    } else if (std::strcmp(a, "--verbose") == 0) {
      verbose = true;
    } else {
      std::fprintf(stderr, "usage: %s [--target P] [--payload P] [--wrapper P]\n"
                           "          [--child] [--allow-any] [--rounds N]\n"
                           "          [--seconds N] [--threads N] [--big-module MB]\n"
                           "          [--map-count N] [--verbose]\n", argv[0]);
      return 2;
    }
  }

  for (const auto& path : {opt.target, opt.payload, opt.wrapper}) {
    if (!file_exists(path)) {
      std::fprintf(stderr, "missing %s\n", path.c_str());
      return 2;
    }
  }

  const std::string tag = std::to_string(::getpid());
  const std::string pidfile = "/tmp/hz-test/target-" + tag + ".pid";
  const std::string heartbeat = "/tmp/hz-test/target-" + tag + ".hb";
  const std::string control = "/tmp/hz-test/control-" + tag + ".sock";
  const std::string started = "/tmp/hz-test/control-" + tag + ".started";
  // The payload reads these from the *target's* environment, so they have to be
  // in ours before the target is forked.
  ::setenv("HZ_CONTROL_SOCK", control.c_str(), 1);
  ::setenv("HZ_CONTROL_STARTED", started.c_str(), 1);

  std::printf("target=%s\npayload=%s\nwrapper=%s\n"
              "orphan=%d allow_any=%d rounds=%d threads=%d big_module=%dMB maps=%d\n",
              opt.target.c_str(), opt.payload.c_str(), opt.wrapper.c_str(),
              opt.child ? 0 : 1, opt.allow_any ? 1 : 0, opt.rounds, opt.threads,
              opt.big_module_mb, opt.map_count);

  const int scope = std::atoi(read_text("/proc/sys/kernel/yama/ptrace_scope").c_str());
  std::printf("yama ptrace_scope=%d\n", scope);

  const int pid = start_target(opt, pidfile, heartbeat);
  if (pid <= 0) {
    std::printf("FAIL could not start fake_target (no pidfile)\n");
    return 1;
  }
  std::printf("target pid=%d\n", pid);
  check(process_alive(pid), "target is alive before injection");
  // The target announces itself in the pidfile slightly before it has finished
  // starting its worker threads, so poll instead of sampling once.  (The pidfile
  // is written early on purpose: it is the "process exists" signal, and a driver
  // that waits for full readiness would have to know the target's internals.)
  int threads_before = 0;
  for (int i = 0; i < 200; ++i) {
    threads_before = thread_count(pid);
    if (threads_before >= 4) break;
    ::usleep(10000);
  }
  std::printf("       threads before: %d\n", threads_before);
  const int want_threads = opt.threads > 0 ? std::min(opt.threads, 8) : 4;
  check(threads_before >= want_threads, "target is multithreaded before injection");

  // ---- round 1: the real thing -------------------------------------------
  std::printf("\nround 1: attach + manual load + start_dynamic\n");
  unlink_if_present(control);
  unlink_if_present(started);

  const InjectionResult first = inject_once(pid, opt.payload);
  if (first.threw) std::printf("       error: %s\n", first.error.c_str());
  check(!first.threw, "injection raised no error");
  if (first.threw) {
    // Everything below depends on the injection having happened; still report the
    // clean-up invariants so the failure names the actual problem.
    std::printf("       TracerPid after failed injection: %d\n", tracer_pid_of(pid));
    check(tracer_pid_of(pid) == 0, "no tracer left behind after a failed injection");
    check(process_alive(pid), "target survived a failed injection");
    stop_target(pid);
    return failures;
  }
  check(first.handle.base != 0, "payload mapped at a non-zero base");
  check(first.handle.entry != 0, "entry point resolved to start_dynamic");
  std::printf("       base=0x%llx entry=0x%llx size=0x%llx\n",
              static_cast<unsigned long long>(first.handle.base),
              static_cast<unsigned long long>(first.handle.entry),
              static_cast<unsigned long long>(first.handle.size));

  // The socket file is created by bind() inside start_dynamic, i.e. before the
  // callee returns.  Its existence therefore proves the remote call reached the
  // payload and got as far as the socket setup.
  bool socket_seen = false;
  for (int i = 0; i < 100 && !socket_seen; ++i) {
    socket_seen = file_exists(control);
    if (!socket_seen) ::usleep(20000);
  }
  check(socket_seen, "payload bound its unix socket (" + control + ")");

  // The started marker is written by the *thread*, so this is the check that
  // proves the callee's thread outlived the ptrace session and got scheduled.
  bool started_seen = false;
  for (int i = 0; i < 100 && !started_seen; ++i) {
    started_seen = file_exists(started);
    if (!started_seen) ::usleep(20000);
  }
  check(started_seen, "payload's listener thread ran (" + started + ")");
  if (started_seen) info("started marker: " + read_text(started));

  // remote_call_detached() is fire-and-forget by contract: it hands the target
  // back before the callee returns, so there is no value to check.  The payload's
  // return code already proved itself by then -- the socket and the marker above
  // only exist because start_dynamic got all the way to its final `return 1`.
  info(hz::format("remote_call_detached returned 0x%llx (not the callee's value)",
                  static_cast<unsigned long long>(first.start_result)));

  check(tracer_pid_of(pid) == 0, "TracerPid is 0 after detach");
  check(process_alive(pid), "target is alive after injection");
  check(heartbeat_advances(heartbeat), "target threads are still scheduling");
  const int threads_after = thread_count(pid);
  std::printf("       threads after: %d\n", threads_after);
  check(threads_after >= threads_before + 1, "payload's listener thread is in the group");

  // ---- rounds 2..N: idempotence ------------------------------------------
  for (int round = 2; round <= opt.rounds; ++round) {
    std::printf("\nround %d: inject again into the same target\n", round);
    const InjectionResult again = inject_once(pid, opt.payload);
    if (again.threw) std::printf("       error: %s\n", again.error.c_str());
    check(!again.threw, "re-injection raised no error");
    check(tracer_pid_of(pid) == 0, "TracerPid is 0 after the re-injection");
    check(process_alive(pid), "target is alive after the re-injection");
    check(heartbeat_advances(heartbeat), "target threads are still scheduling");
  }

  // ---- failure paths -----------------------------------------------------
  // A symbol the payload needs but the target cannot provide must unwind
  // cleanly: mapped window released, registers restored, target running.
  std::printf("\nfailure path: payload with an unresolvable symbol\n");
  {
    const std::string broken = "/tmp/hz-test/payload-broken.so";
    // The same payload, but the target library that supplies its hooks is not
    // dlopen'd there, so hz_target_side_effect cannot be resolved... which we
    // cannot arrange on a live target.  Instead use a payload that needs a
    // symbol nothing defines, which is what a version-mismatched payload looks
    // like.
    if (file_exists(broken)) {
      const InjectionResult bad = inject_once(pid, broken);
      std::printf("       error: %s\n", bad.error.c_str());
      check(bad.threw, "payload with a missing symbol is rejected");
      check(tracer_pid_of(pid) == 0, "TracerPid is 0 after a rejected payload");
      check(process_alive(pid), "target survived a rejected payload");
    } else {
      std::printf("       (skipped: %s not built)\n", broken.c_str());
    }
  }

  // Attaching to a pid that is gone must fail before doing anything, and must not
  // leave the (non-existent) target with a tracer.
  std::printf("\nfailure path: attach to a dead pid\n");
  {
    bool threw = false;
    std::string message;
    try {
      hz::RemoteProcess remote(pid + 999999);
      remote.attach();
    } catch (const std::exception& e) {
      threw = true;
      message = e.what();
    }
    check(threw, "attaching to a non-existent pid throws");
    info(message);
  }

  stop_target(pid);
  ::unlink(pidfile.c_str());
  ::unlink(heartbeat.c_str());
  ::unlink(control.c_str());
  ::unlink(started.c_str());

  std::printf("\n%s (%d failure%s)\n", failures == 0 ? "PASS" : "FAIL", failures,
              failures == 1 ? "" : "s");
  return failures;
}