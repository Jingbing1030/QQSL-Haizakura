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
//
// Both are WEAK with definitions of our own, so the payload also loads into a
// target that has no wrapper at all: a relocation against an undefined symbol is
// fatal to the loader, and the protocol stub needs to be injectable into plain
// processes (a bare QQ has no fake-wrapper either).  When the wrapper IS present,
// the loader's link order prefers its strong definition, which is what the
// cross-module relocation test wants.
// Declared weak and left UNDEFINED.  Defining a fallback here would change the
// symbol to weak-defined, and the loader would then bind our own copy instead of
// the wrapper's -- quietly turning the cross-module relocation test into a
// no-op.  A weak undefined symbol resolving to zero is the correct shape, and the
// loader already allows it (see the weak branch in manual_loader.cc).
extern "C" std::uint64_t hz_target_side_effect(std::uint64_t delta) __attribute__((weak));
extern "C" volatile std::uint64_t hz_payload_marker __attribute__((weak));

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

// ---------------------------------------------------------------------------
// Wire protocol (see docs/payload-protocol.md)
// ---------------------------------------------------------------------------
// A frame is a fixed 40-byte header followed by three tightly packed spans.
// Everything is little-endian.  This stub implements just enough of it to prove
// the layout is right: it answers the Node side's hello with a hello of its own,
// which is what makes `[Hook] pipe connected` appear.
constexpr std::uint32_t kPipeMagic = 827344977u;   // 0x31504851
constexpr std::uint16_t kPipeVersion = 1;
constexpr std::uint16_t kOpHello = 1;
constexpr std::uint16_t kOpRequest = 2;
constexpr std::uint16_t kOpAck = 3;
constexpr std::uint16_t kOpReply = 4;
constexpr std::uint16_t kOpError = 5;
constexpr std::uint16_t kOpLoginState = 7;
constexpr std::uint32_t kFlagWantReply = 1;
constexpr std::uint32_t kFlagLoggedIn = 4;
constexpr std::uint32_t kMaxCmd = 4096;
constexpr std::uint32_t kMaxMsg = 65536;

struct FrameHeader {
  std::uint32_t magic;
  std::uint16_t version;
  std::uint16_t op;
  std::uint32_t request_id;
  std::int32_t status;
  std::uint32_t flags;
  std::uint32_t cmd_len;
  std::uint32_t msg_len;
  std::uint32_t body_len;
  std::uint64_t value0;
};
static_assert(sizeof(FrameHeader) == 40, "frame header is 40 bytes on the wire");

// read_exact: a stream socket gives no message boundaries, so a header can arrive
// in any number of reads.  Returns false if the peer closed or errored.
bool read_exact(int fd, void* buf, std::size_t len) {
  auto* p = static_cast<std::uint8_t*>(buf);
  std::size_t got = 0;
  while (got < len) {
    const ssize_t n = ::read(fd, p + got, len - got);
    // No errno here on purpose: it is thread-local, and this loader relocates no
    // TLS.  A short read is retried by the loop; a real error returns <= 0 again
    // and ends the connection.
    if (n <= 0) return false;
    got += static_cast<std::size_t>(n);
  }
  return true;
}

bool write_exact(int fd, const void* buf, std::size_t len) {
  const auto* p = static_cast<const std::uint8_t*>(buf);
  std::size_t put = 0;
  while (put < len) {
    const ssize_t n = ::write(fd, p + put, len - put);
    if (n <= 0) return false;
    put += static_cast<std::size_t>(n);
  }
  return true;
}

// Sends one frame.  cmd/msg are UTF-8, body is opaque bytes.
bool send_frame(int fd, const FrameHeader& h, const char* cmd, const char* msg,
                const void* body) {
  if (!write_exact(fd, &h, sizeof(h))) return false;
  if (h.cmd_len != 0 && !write_exact(fd, cmd, h.cmd_len)) return false;
  if (h.msg_len != 0 && !write_exact(fd, msg, h.msg_len)) return false;
  if (h.body_len != 0 && !write_exact(fd, body, h.body_len)) return false;
  return true;
}

FrameHeader make_header(std::uint16_t op, std::uint32_t request_id,
                        std::int32_t status, std::uint32_t flags,
                        std::uint32_t cmd_len, std::uint32_t msg_len,
                        std::uint32_t body_len, std::uint64_t value0) {
  FrameHeader h{};
  h.magic = kPipeMagic;
  h.version = kPipeVersion;
  h.op = op;
  h.request_id = request_id;
  h.status = status;
  h.flags = flags;
  h.cmd_len = cmd_len;
  h.msg_len = msg_len;
  h.body_len = body_len;
  h.value0 = value0;
  return h;
}

struct ListenerArgs {
  int listen_fd;
  char control[108];  // sizeof(sockaddr_un::sun_path)
  char started[256];
};

// Serves one accepted connection until the peer disconnects.  This is the part
// that makes the stub a protocol peer rather than a socket that merely accepts:
// it parses real frames and answers them.
void serve_connection(int fd, const char* pipe_path, int pid) {
  for (;;) {
    FrameHeader h{};
    if (!read_exact(fd, &h, sizeof(h))) return;
    if (h.magic != kPipeMagic || h.version != kPipeVersion) {
      std::printf("[payload] bad frame magic=0x%x version=%u\n", h.magic, h.version);
      return;
    }
    if (h.cmd_len > kMaxCmd || h.msg_len > kMaxMsg) {
      std::printf("[payload] frame too large cmd=%u msg=%u\n", h.cmd_len, h.msg_len);
      return;
    }

    // Drain the payload spans so the next header is aligned.  This stub only
    // needs cmd and msg; the body is discarded.
    char cmd[kMaxCmd + 1];
    char msg[kMaxMsg + 1];
    cmd[0] = '\0';
    msg[0] = '\0';
    if (h.cmd_len != 0 && !read_exact(fd, cmd, h.cmd_len)) return;
    if (h.msg_len != 0 && !read_exact(fd, msg, h.msg_len)) return;
    cmd[h.cmd_len] = '\0';
    msg[h.msg_len] = '\0';
    // Skip the body without buffering it: 16 MB is allowed and we do not use it.
    std::uint32_t left = h.body_len;
    char sink[512];
    while (left != 0) {
      const std::size_t take = left < sizeof(sink) ? left : sizeof(sink);
      if (!read_exact(fd, sink, take)) return;
      left -= static_cast<std::uint32_t>(take);
    }

    std::printf("[payload] frame op=%u request_id=%u status=%d flags=0x%x "
                "cmd=\"%s\" msg=\"%s\" value0=%llu\n",
                h.op, h.request_id, h.status, h.flags, cmd, msg,
                static_cast<unsigned long long>(h.value0));
    std::fflush(stdout);

    if (h.op == kOpHello) {
      // Answer with our own hello.  The Node side resolves its connect promise on
      // this frame and reports the pipe connected; without it the connection
      // times out in phase=waiting_channel.
      const std::size_t len = std::strlen(pipe_path);
      const FrameHeader reply = make_header(
          kOpHello, 0, 0, 0, 0, static_cast<std::uint32_t>(len), 0,
          static_cast<std::uint64_t>(pid));
      if (!send_frame(fd, reply, nullptr, pipe_path, nullptr)) return;

      // Then announce the login state, which is what the real payload does once
      // it sees QQ log in.  Both channels carry it; the login flag and status are
      // the authoritative signal (see docs/payload-protocol.md).
      const char* uin = "3083456343";
      const FrameHeader logged = make_header(
          kOpLoginState, 0, 1, kFlagLoggedIn, 0,
          static_cast<std::uint32_t>(std::strlen(uin)), 0, 3083456343ull);
      if (!send_frame(fd, logged, nullptr, uin, nullptr)) return;
      continue;
    }

    if (h.op == kOpRequest) {
      // ACK first, then reply: a real payload does this so a slow request cannot
      // trip the caller's ack timeout.
      const FrameHeader ack = make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, 0);
      if (!send_frame(fd, ack, nullptr, nullptr, nullptr)) return;
      const FrameHeader done = make_header(kOpReply, h.request_id, 0, 0, 0, 0, 0, 0);
      if (!send_frame(fd, done, nullptr, nullptr, nullptr)) return;
      continue;
    }
    // Anything else is ignored; the connection stays usable, which is what the
    // real payload does for op codes it does not know.
  }
}

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
    // One connection at a time: the Node side opens control and recv separately
    // and a stub does not need concurrency to prove the protocol.
    serve_connection(fd, a->control, static_cast<int>(::getpid()));
    ::close(fd);
  }
  return nullptr;
}

}  // namespace

extern "C" void hz_payload_constructor() {
  g_local_state += 1;
  // Resolved to zero when the target has no wrapper: nothing to call or write.
  const std::uint64_t observed =
      (hz_target_side_effect != nullptr) ? hz_target_side_effect(1) : 0;
  if (&hz_payload_marker != nullptr) hz_payload_marker = 0x48415a41ull;  // "HAZA"
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