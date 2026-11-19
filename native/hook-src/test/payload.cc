// The payload that the manual loader maps into the target.
//
// Everything here runs inside the target process after relocation.  Two things
// are observable from the outside, and together they are the acceptance test for
// the whole injection path:
//
//   * a DT_INIT_ARRAY constructor writes a marker and bumps a counter that lives
//     in the target's already-loaded library -- proving the segment was copied
//     and a relocation against a target-side symbol was resolved;
//   * snowluma_linux_hook_start_dynamic() spawns a listener thread and binds a
//     unix domain socket -- proving the remote call survived a callee that
//     creates threads, and that the thread it created keeps running after the
//     ptrace session is over.
//
// ---------------------------------------------------------------------------
// Why this payload is written the way it is
// ---------------------------------------------------------------------------
// The manual loader implements no TLS relocations (see manual_loader.cc), so a
// payload that touches `errno`, a thread-local, or the stack protector's canary
// fails to relocate with "manual ELF loader does not implement TLS relocations".
// Everything below therefore sticks to plain libc calls: raw pthread_create, raw
// socket calls.  The payload is built with -fno-stack-protector so the canary is
// not referenced at all.
//
// The second reason is the one that matters for this test: start_dynamic must
// *return* while its work continues on a thread.  That is the shape that broke
// the injector -- a returning callee leaves a landing pad behind, and the thread
// it spawned lives on the stack the injector mapped.

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include <fcntl.h>
#include <pthread.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/un.h>
#include <unistd.h>

// Provided by fake-wrapper.so, which the target loads at startup.  The manual
// loader must resolve this against the target's own mapping of that library.
extern "C" std::uint64_t hz_target_side_effect(std::uint64_t delta);
extern "C" volatile std::uint64_t hz_payload_marker;

// Local data with a variable initial value, which forces a RELATIVE relocation.
std::uint64_t g_local_state = 0x1122334455667788ull;

namespace {

constexpr const char* kDefaultSocket = "/tmp/hz-control.sock";
constexpr const char* kDefaultStarted = "/tmp/hz-control.started";

const char* env_or(const char* name, const char* fallback) {
  const char* v = ::getenv(name);
  return (v != nullptr && v[0] != '\0') ? v : fallback;
}

// Announces readiness the way a real hook does: a file next to the socket, so a
// supervisor that only sees the filesystem can tell "the module loaded" from "the
// module loaded and its listener is up".
bool write_started(const char* path, long tid) {
  const int fd = ::open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) return false;
  char buf[96];
  const int n = std::snprintf(buf, sizeof(buf), "ok pid=%d tid=%ld\n",
                             static_cast<int>(::getpid()), tid);
  const bool good = ::write(fd, buf, static_cast<size_t>(n)) == n;
  ::close(fd);
  return good;
}

struct ListenerArgs {
  int listen_fd;
  char control[108];  // sizeof(sockaddr_un::sun_path)
  char started[256];
};

void* listener_main(void* raw) {
  const ListenerArgs* a = static_cast<const ListenerArgs*>(raw);
  std::printf("[payload] listener thread up, socket %s\n", a->control);
  std::fflush(stdout);

  // The socket file already exists (bind() created it); the marker is what the
  // driver polls.  Written from the *thread*, not from start_dynamic, so the
  // marker proves the thread actually got scheduled inside the target.
  write_started(a->started, static_cast<long>(::syscall(SYS_gettid)));

  for (;;) {
    const int fd = ::accept(a->listen_fd, nullptr, nullptr);
    if (fd < 0) {
      // accept() is the only blocking call here; a failure is transient.
      ::usleep(10000);
      continue;
    }
    const char greeting[] = "hz\n";
    if (::write(fd, greeting, sizeof(greeting) - 1) < 0) {
      // peer went away before reading; nothing to do
    }
    ::close(fd);
  }
  return nullptr;
}

}  // namespace

extern "C" void hz_payload_constructor() {
  g_local_state += 1;
  const std::uint64_t observed = hz_target_side_effect(1);
  hz_payload_marker = 0x48415a41ull;  // "HAZA"
  std::printf("[payload] constructor ran: target counter now %llu, local=%llx\n",
              static_cast<unsigned long long>(observed),
              static_cast<unsigned long long>(g_local_state));
  std::fflush(stdout);
}

// `__attribute__((constructor))` is the standard way to get a pointer into
// .init_array; the section attribute alone does not survive linking.
__attribute__((constructor)) static void hz_register_constructor() {
  hz_payload_constructor();
}

// The entry point the loader looks up when the image has no e_entry, which is the
// normal case for a .so.  Returning non-zero is the payload ABI: zero means "I
// did not start", and a caller that ignores the value waits forever for a socket
// that will never appear.
extern "C" int snowluma_linux_hook_start_dynamic() {
  const char* control = env_or("HZ_CONTROL_SOCK", kDefaultSocket);
  const char* started = env_or("HZ_CONTROL_STARTED", kDefaultStarted);

  // A stale file from a previous run makes "the socket appeared" meaningless.
  ::unlink(control);
  ::unlink(started);

  if (std::strlen(control) >= sizeof(sockaddr_un::sun_path)) {
    std::printf("[payload] control path too long: %s\n", control);
    return -1;
  }

  const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) {
    std::printf("[payload] socket() failed\n");
    return -2;
  }

  struct sockaddr_un addr;
  std::memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  std::strncpy(addr.sun_path, control, sizeof(addr.sun_path) - 1);

  if (::bind(fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) != 0) {
    std::printf("[payload] bind(%s) failed\n", control);
    ::close(fd);
    return -3;
  }
  if (::listen(fd, 8) != 0) {
    std::printf("[payload] listen(%s) failed\n", control);
    ::close(fd);
    return -4;
  }

  // The arg block has to outlive this function: the thread reads it after we
  // return, and leaving it on our stack would be the same class of bug the
  // injector itself had.  A static is the honest lifetime here.
  static ListenerArgs args;
  args.listen_fd = fd;
  std::memset(args.control, 0, sizeof(args.control));
  std::strncpy(args.control, control, sizeof(args.control) - 1);
  std::memset(args.started, 0, sizeof(args.started));
  std::strncpy(args.started, started, sizeof(args.started) - 1);

  pthread_t thread;
  // Raw pthread_create on purpose: std::thread drags in the C++ runtime's
  // thread-local bookkeeping, which this loader cannot relocate.
  const int rc = ::pthread_create(&thread, nullptr, listener_main, &args);
  if (rc != 0) {
    std::printf("[payload] pthread_create failed (%d)\n", rc);
    ::close(fd);
    return -5;
  }
  ::pthread_detach(thread);

  std::printf("[payload] start_dynamic returning, listener thread=%lu\n",
              static_cast<unsigned long>(thread));
  std::fflush(stdout);

  // Non-zero: "started".  Returning here is the whole point -- the caller must
  // cope with a callee that finishes while its threads do not.
  return 1;
}

extern "C" std::uint64_t hz_payload_version() { return 2; }