// A stand-in for the QQ browser process.
//
// It maps a file named wrapper.node so the addon's process picker recognises it,
// then sleeps. The injector is run against this instead of live QQ: a crash here
// costs nothing, and the payload counter proves the injected code actually ran.
//
// Two payloads work together:
//   fake-wrapper.so  loaded by the target at startup, provides lookup symbols and
//                    a settable counter
//   payload.so       injected by the addon; its DT_INIT_ARRAY increments that
//                    counter through a symbol resolved from the target, and its
//                    start_dynamic entry point creates a listener thread
//
// A successful run therefore proves: ELF parsing, remote mmap, segment copy,
// RELA relocation against a symbol the target already had, DT_INIT_ARRAY
// execution, and that a payload which spawns threads does not take the host down.
//
// ---------------------------------------------------------------------------
// Why this program is multithreaded
// ---------------------------------------------------------------------------
// Live QQ runs with dozens of threads.  Two injector bugs only exist in that
// shape and are invisible against a single-threaded target:
//
//   1. a ptrace tracer that waits with waitpid() sees stops belonging to *other*
//      threads of the same thread group, and a naive "any stop means the callee
//      crashed" loop mistakes a payload's freshly cloned listener thread for a
//      fault;
//   2. a payload thread that outlives the ptrace session keeps running on memory
//      the injector may be about to unmap.
//
// So the default is "main thread + 4 background threads", with one of them
// churning short-lived threads the way a real event loop does.
//
// Usage:
//   fake_target [wrapper.node] [seconds]            run in the foreground
//   fake_target --orphan <pidfile> [...]            fork a detached target, exit
//   fake_target --allow-any [...]                   prctl(PR_SET_PTRACER, ANY)
//   fake_target --allow <pid> [...]                 prctl(PR_SET_PTRACER, pid)
//   fake_target --threads <n> [...]                 background thread count
//   fake_target --heartbeat <file> [...]            write a liveness counter
//   fake_target --no-dlopen [...]                   only mmap wrapper.node
//   fake_target --big-module <mb> [...]             extra anonymous mapping of
//                                                   <mb> MiB, mimicking a target
//                                                   whose module is ~130 MB
//   fake_target --map-count <n> [...]                n extra small anonymous
//                                                   mappings, so /proc/<pid>/maps
//                                                   is long and fragmented
//
// --orphan is what makes the yama test meaningful: the driver forks this
// program, this program forks the *real* target and exits, so the driver and the
// target are not parent and child and yama ptrace_scope=1 applies in full.

#include <atomic>
#include <cerrno>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <thread>
#include <vector>

#include <dlfcn.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace {

std::atomic<bool> g_stop{false};
std::atomic<uint64_t> g_ticks{0};

void write_pidfile(const char* path) {
  if (path == nullptr) return;
  const int fd = ::open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) return;
  char buf[32];
  const int n = std::snprintf(buf, sizeof(buf), "%d\n", static_cast<int>(::getpid()));
  if (::write(fd, buf, static_cast<size_t>(n)) != n) {
    // nothing useful to do; the driver times out and reports it
  }
  ::close(fd);
}

// Thread 1: plain sleep loop.  A tracer that waits with waitpid() should never
// see anything from this thread at all.
void sleeper_thread() {
  while (!g_stop.load()) {
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
    g_ticks.fetch_add(1);
  }
}

// Thread 2: condition-variable wait, the shape of an event loop that only wakes
// on work.  Exercises futex waits, which is where a stray SIGSTOP/SIGCONT shows
// up as a lost wakeup.
void condvar_thread() {
  std::mutex m;
  std::condition_variable cv;
  while (!g_stop.load()) {
    std::unique_lock<std::mutex> lock(m);
    cv.wait_for(lock, std::chrono::milliseconds(50));
    g_ticks.fetch_add(1);
  }
}

// Thread 3: blocked in read() on a pipe that never gets data.  A signal delivered
// to this thread by a confused tracer interrupts the read; that is exactly the
// kind of collateral damage a bad wait loop causes in a real host.
void blocking_read_thread(int read_fd) {
  char buf[64];
  while (!g_stop.load()) {
    const ssize_t n = ::read(read_fd, buf, sizeof(buf));
    if (n <= 0) {
      if (n < 0 && errno == EINTR) continue;
      if (g_stop.load()) return;
      std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
  }
}

// Thread 4: churn.  Creates and joins short-lived threads continuously, so the
// thread group's task list is never stable.  This is what makes a tracer's
// waitpid() loop see stops it did not ask for (or, worse, a tid that vanishes
// between the wait and the PTRACE_CONT).
void churn_thread() {
  while (!g_stop.load()) {
    std::thread t([] {
      volatile uint64_t x = 0;
      for (int i = 0; i < 1000; ++i) x += static_cast<uint64_t>(i);
    });
    t.join();
    g_ticks.fetch_add(1);
    std::this_thread::sleep_for(std::chrono::milliseconds(30));
  }
}

// Heartbeat: one line per 100 ms into a file the driver can read.  Proves the
// target is still *scheduling*, not merely still existing -- a process whose
// payload thread is spinning on an unmapped stack still has a live pid.
void heartbeat_thread(const char* path) {
  if (path == nullptr) return;
  const int fd = ::open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) return;
  uint64_t seq = 0;
  while (!g_stop.load()) {
    char buf[64];
    const int n = std::snprintf(buf, sizeof(buf), "%llu %llu\n",
                                static_cast<unsigned long long>(++seq),
                                static_cast<unsigned long long>(g_ticks.load()));
    if (::pwrite(fd, buf, static_cast<size_t>(n), 0) != n) {
      // keep going; a missing heartbeat is reported by the driver
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }
  ::close(fd);
}

}  // namespace

int main(int argc, char** argv) {
  const char* wrapper = "/tmp/fake-wrapper.node";
  const char* pidfile = nullptr;
  const char* heartbeat = nullptr;
  int seconds = 120;
  int bg_threads = 4;
  int big_module_mb = 0;
  int extra_maps = 0;
  bool orphan = false;
  bool dlopen_it = true;
  long allow_pid = 0;      // 0 = not requested, -1 = PR_SET_PTRACER_ANY
  bool positional_wrapper = false;

  for (int i = 1; i < argc; ++i) {
    const char* a = argv[i];
    if (std::strcmp(a, "--orphan") == 0 && i + 1 < argc) {
      orphan = true;
      pidfile = argv[++i];
    } else if (std::strcmp(a, "--heartbeat") == 0 && i + 1 < argc) {
      heartbeat = argv[++i];
    } else if (std::strcmp(a, "--allow-any") == 0) {
      allow_pid = -1;
    } else if (std::strcmp(a, "--allow") == 0 && i + 1 < argc) {
      allow_pid = std::atol(argv[++i]);
    } else if (std::strcmp(a, "--threads") == 0 && i + 1 < argc) {
      bg_threads = std::atoi(argv[++i]);
    } else if (std::strcmp(a, "--no-dlopen") == 0) {
      dlopen_it = false;
    } else if (std::strcmp(a, "--big-module") == 0 && i + 1 < argc) {
      big_module_mb = std::atoi(argv[++i]);
    } else if (std::strcmp(a, "--map-count") == 0 && i + 1 < argc) {
      extra_maps = std::atoi(argv[++i]);
    } else if (a[0] == '-' && a[1] == '-') {
      std::fprintf(stderr, "unknown option %s\n", a);
      return 2;
    } else if (!positional_wrapper) {
      wrapper = a;
      positional_wrapper = true;
    } else {
      seconds = std::atoi(a);
    }
  }

  // --orphan: fork the real target and exit, so the process that started us is
  // not the target's parent.  Without this there is no way to reproduce yama
  // ptrace_scope=1: a child is always attachable by its parent.
  if (orphan) {
    const pid_t child = ::fork();
    if (child < 0) {
      std::perror("fork");
      return 1;
    }
    if (child > 0) {
      // Parent exits immediately.  The child is reparented to init (or to the
      // nearest subreaper), which is precisely what breaks the parent/child
      // exemption in yama.
      std::printf("orphan target pid=%d\n", static_cast<int>(child));
      std::fflush(stdout);
      return 0;
    }
    // Child: detach from the caller's session and terminal so a signal sent to
    // the driver's process group cannot take the target down with it.
    ::setsid();
    write_pidfile(pidfile);
  }

  if (allow_pid == -1) {
    // The one *cooperative* way out of yama: the target itself declares who may
    // trace it.  PR_SET_PTRACER_ANY waives the check entirely.
    if (::prctl(PR_SET_PTRACER, PR_SET_PTRACER_ANY, 0, 0, 0) != 0) {
      std::fprintf(stderr, "prctl(PR_SET_PTRACER, ANY) failed: %s\n", std::strerror(errno));
      return 1;
    }
  } else if (allow_pid > 0) {
    // PR_SET_PTRACER names a single tracer pid.  This is what a "grant" looks
    // like in practice, and it is per-process, not per-thread.
    if (::prctl(PR_SET_PTRACER, static_cast<unsigned long>(allow_pid), 0, 0, 0) != 0) {
      std::fprintf(stderr, "prctl(PR_SET_PTRACER, %ld) failed: %s\n", allow_pid,
                   std::strerror(errno));
      return 1;
    }
  }

  // Map the file so /proc/<pid>/maps contains "wrapper.node", which is how the
  // addon identifies the QQ browser process.
  char wrapper_resolved[PATH_MAX];
  const char* resolved = ::realpath(wrapper, wrapper_resolved) != nullptr ? wrapper_resolved
                                                                         : wrapper;

  int fd = ::open(resolved, O_RDONLY);
  if (fd < 0) {
    std::fprintf(stderr, "cannot open %s: %s\n", wrapper, std::strerror(errno));
    return 1;
  }
  struct stat st{};
  ::fstat(fd, &st);
  void* map = ::mmap(nullptr, static_cast<size_t>(st.st_size), PROT_READ, MAP_PRIVATE, fd, 0);
  ::close(fd);
  if (map == MAP_FAILED) {
    std::fprintf(stderr, "mmap failed: %s\n", std::strerror(errno));
    return 1;
  }

  // Also load it for real: the injector resolves the payload's undefined symbols
  // against this process's dynamic symbol table, and only a dlopen'd library
  // appears there.
  if (dlopen_it) {
    void* handle = ::dlopen(wrapper_resolved, RTLD_NOW | RTLD_GLOBAL);
    if (handle == nullptr) {
      const char* err = ::dlerror();
      std::fprintf(stderr, "dlopen failed: %s\n", err != nullptr ? err : "unknown");
      return 1;
    }
  }

  // Background threads, started before the pid is announced so a driver that
  // attaches immediately already sees a multi-threaded target.
  std::vector<std::thread> workers;
  workers.emplace_back(sleeper_thread);
  workers.emplace_back(condvar_thread);
  int pipefd[2] = {-1, -1};
  if (::pipe(pipefd) == 0) {
    workers.emplace_back(blocking_read_thread, pipefd[0]);
  }
  workers.emplace_back(churn_thread);
  for (int i = static_cast<int>(workers.size()); i < bg_threads; ++i) {
    workers.emplace_back(sleeper_thread);
  }
  workers.emplace_back(heartbeat_thread, heartbeat);

  // A target with a large module is the case that made the injector slow enough
  // to look hung: every relocation is a ptrace round-trip, and the manual loader
  // reads the target's maps repeatedly.  A big mapping here reproduces the
  // *shape* (a long maps file, a large address space) without needing a real
  // 130 MB QQ module.  It is touched so it cannot be a lazy reservation.
  std::vector<void*> big;
  if (big_module_mb > 0) {
    const size_t bytes = static_cast<size_t>(big_module_mb) << 20;
    void* p = ::mmap(nullptr, bytes, PROT_READ | PROT_WRITE,
                     MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (p != MAP_FAILED) {
      // Touch one byte per page so the kernel has to account for the whole thing.
      volatile char* q = static_cast<volatile char*>(p);
      for (size_t off = 0; off < bytes; off += 4096) q[off] = 1;
      big.push_back(p);
    }
  }
  // Small mappings fragment /proc/<pid>/maps the way a real browser leaves it
  // after mapping and unmapping shared objects for a while.
  std::vector<void*> small;
  for (int i = 0; i < extra_maps; ++i) {
    void* p = ::mmap(nullptr, 8192, PROT_READ | PROT_WRITE,
                     MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (p != MAP_FAILED) small.push_back(p);
  }

  std::printf("pid=%d wrapper mapped at %p and dlopen'd, threads=%zu sleeping %d s\n",
              static_cast<int>(::getpid()), map, workers.size(), seconds);
  std::fflush(stdout);
  // Rewrite the pidfile now that the process is fully set up: the driver treats a
  // pidfile as "target is ready", not merely "target exists".
  if (pidfile != nullptr) write_pidfile(pidfile);

  std::this_thread::sleep_for(std::chrono::seconds(seconds));
  g_stop = true;
  for (auto& t : workers) {
    if (t.joinable()) t.join();
  }
  std::printf("exiting after sleep\n");
  return 0;
}