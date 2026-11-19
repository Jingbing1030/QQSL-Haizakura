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
#include <cerrno>
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
constexpr const char* kDefaultRecv = "/tmp/hz-control.recv.sock";

const char* env_or(const char* name, const char* fallback) {
  const char* v = ::getenv(name);
  return (v != nullptr && v[0] != '\0') ? v : fallback;
}

// The Node side does not connect to a fixed path.  It builds <runtimeDir>/mojo.<pid>.control.sock
// and <runtimeDir>/mojo.<pid>.recv.sock, where runtimeDir comes from the QQ process's own
// SNOWLUMA_HOOK_RUNTIME_DIR, then its XDG_RUNTIME_DIR, then "/tmp/snowluma-<uid>".  These
// functions reproduce that rule.
//
// They have to run inside the target: the whole point is to read the *target's* environment,
// which the injected payload can do with getenv and the injector cannot see at all.  Getting this
// wrong is not a subtle bug -- the payload listens happily on a path nobody dials, the Node side
// times out, and the only symptom is that "pipe connected" never appears.
//
// Plain C on purpose: this file is manually mapped and the loader cannot relocate libstdc++, so
// std::string is not available here.
const char* resolve_runtime_dir() {
  const char* explicit_dir = env_or("SNOWLUMA_HOOK_RUNTIME_DIR", nullptr);
  if (explicit_dir != nullptr) return explicit_dir;
  return env_or("XDG_RUNTIME_DIR", nullptr);
}

// Writes mojo.<pid>.<suffix>.sock into out.  False when it would not fit, so a caller cannot
// silently truncate into a path that binds somewhere unintended.
bool mojo_socket_path(char* out, std::size_t cap, const char* suffix) {
  const char* dir = resolve_runtime_dir();
  int n;
  if (dir != nullptr) {
    n = std::snprintf(out, cap, "%s/mojo.%d.%s.sock", dir, static_cast<int>(::getpid()), suffix);
  } else {
    n = std::snprintf(out, cap, "/tmp/snowluma-%u/mojo.%d.%s.sock",
                      static_cast<unsigned>(::geteuid()), static_cast<int>(::getpid()), suffix);
  }
  return n > 0 && static_cast<std::size_t>(n) < cap;
}

// Creates the runtime directory when the derivation pointed at one that does not exist yet.  The
// Node side only reads, so the payload is the side that has to make it.
bool ensure_parent_dir(const char* path) {
  const char* slash = std::strrchr(path, '/');
  if (slash == nullptr || slash == path) return true;
  char dir[sizeof(sockaddr_un::sun_path)];
  const std::size_t len = static_cast<std::size_t>(slash - path);
  if (len >= sizeof(dir)) return false;
  std::memcpy(dir, path, len);
  dir[len] = '\0';
  if (::mkdir(dir, 0700) == 0) return true;
  return errno == EEXIST;
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
// recv channel only: QQ data packets and the client-message receipt probe.  These never
// appear on control, and control's ops never appear here -- the two channels carry disjoint
// halves of the same op space.
constexpr std::uint16_t kOpPacket = 6;
constexpr std::uint16_t kOpClientMessageReceipt = 21;
constexpr std::uint16_t kOpPrivateMsgReporting = 22;
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

// ---------------------------------------------------------------------------
// Lifecycle state
// ---------------------------------------------------------------------------
// start_dynamic/stop_dynamic must be repeatable: the Node side restarts the hook
// when QQ restarts or when the user toggles it, and a second start on an already
// started payload has to be a no-op rather than a second bind on the same path
// (which fails with EADDRINUSE) or a second listener thread.
//
// All of this is plain memory on purpose.  A std::mutex would pull in the C++
// threading runtime, and this loader relocates no TLS; a pthread mutex is fine but
// the state transitions here are single-word swaps that a __sync builtin handles
// without touching thread-local storage.
enum class HookState : int {
  kStopped = 0,
  kStarting = 1,
  kRunning = 2,
};

HookState g_state = HookState::kStopped;
int g_listen_fd = -1;
pthread_t g_thread;
bool g_thread_live = false;
pthread_t g_recv_thread;
bool g_recv_thread_live = false;
int recv_listen_fd_storage = -1;
// The recv thread needs the pipe name as well as the fd: its hello must report the path it was
// reached at, which is the only thing resolveHello() reads out of it besides the pid.
struct RecvArgs {
  int listen_fd;
  char path[sizeof(sockaddr_un::sun_path)];
};
RecvArgs recv_args_storage = {-1, {0}};
volatile int g_stop_listener = 0;   // set by stop_dynamic; read by the listener
char g_control_path[108] = {0};
// The recv channel is a second listening socket, not a second connection on the first: the
// Node side opens both and expects them to be independent.  Traffic on it is one-way
// (payload -> Node), which is what the hooked recv slot needs -- a callback inside QQ cannot
// wait for a reply without stalling the client.
int g_recv_fd = -1;      // the listening socket
int g_recv_peer = -1;    // the accepted Node-side connection
int g_control_peer = -1;  // the accepted control connection, for pushing op 7 unprompted
int g_login_hits = 0;
constexpr long long kTestUin = 1000000002LL;

// Login state, declared with the rest of the state because the control thread reads it to greet
// a new connection, and that thread is defined before the announce helper.
int g_login_uin = 0;
volatile int g_logged_in = 0;

// Signed in as `uin`: record it and tell both channels.
//
// Idempotent by design.  QQ can re-announce a login (a reconnect, or the callback firing again),
// and re-sending op 7 with unchanged state is harmless because the Node side only wakes its
// waiters when the values actually change.
static void do_announce_login(long long uin) {
  g_login_uin = static_cast<int>(uin);
  g_logged_in = 1;

  char uin_text[32];
  int n = 0;
  {
    // Decimal without snprintf: this runs on QQ's thread and the loader relocates no TLS, so a
    // libc formatting call is more machinery than the job needs.
    unsigned long long v = static_cast<unsigned long long>(uin);
    char tmp[32];
    int len = 0;
    if (v == 0) tmp[len++] = '0';
    while (v != 0) { tmp[len++] = static_cast<char>('0' + (v % 10)); v /= 10; }
    for (int i = len - 1; i >= 0 && n < static_cast<int>(sizeof(uin_text)) - 1; --i) {
      uin_text[n++] = tmp[i];
    }
    uin_text[n] = '\0';
  }

  // op 7: logged_in rides in flags (bit 2) and status; the uin is in msg, with value0 as the
  // numeric form.  The Node side ORs the two indicators, so setting both is the compatible
  // choice.
  const FrameHeader logged = make_header(
      kOpLoginState, 0, 1, kFlagLoggedIn, 0,
      static_cast<std::uint32_t>(n), 0, static_cast<std::uint64_t>(uin));
  if (g_listen_fd >= 0 && g_control_peer >= 0) {
    send_frame(g_control_peer, logged, nullptr, uin_text, nullptr);
  }
  if (g_recv_peer >= 0) {
    send_frame(g_recv_peer, logged, nullptr, uin_text, nullptr);
  }
  std::printf("[payload] login announced: uin=%s (control=%d recv=%d)\n", uin_text,
              g_control_peer, g_recv_peer);
  std::fflush(stdout);
}


char g_recv_path[256] = {0};

// Compares and swaps the state word, returning the previous value.  Keeps a
// concurrent start/stop from interleaving halfway through a transition.
HookState cas_state(HookState expected, HookState desired) {
  return static_cast<HookState>(
      __sync_val_compare_and_swap(reinterpret_cast<int*>(&g_state),
                                  static_cast<int>(expected),
                                  static_cast<int>(desired)));
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
      const char* uin = "1000000002";
      const FrameHeader logged = make_header(
          kOpLoginState, 0, 1, kFlagLoggedIn, 0,
          static_cast<std::uint32_t>(std::strlen(uin)), 0, 1000000002ull);
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
    // Bounded accept, so stop_dynamic can be honoured without leaving a thread
    // blocked in a syscall that a DETACH would then have to interrupt.  Accept
    // returns EINTR on the signal-delivery-stop the injector drives, and a real
    // payload needs to keep serving through it; this stub only needs to notice a
    // stop request.
    if (g_stop_listener != 0) break;
    const int fd = ::accept(a->listen_fd, nullptr, nullptr);
    if (fd < 0) {
      // accept() is the only blocking call here; a failure is transient.
      ::usleep(10000);
      continue;
    }
    // One connection at a time: the Node side opens control and recv separately
    // and a stub does not need concurrency to prove the protocol.
    //
    // Publishing the fd matters for login: op 7 has to be pushed unprompted when QQ logs in, and
    // that moment has nothing to do with a request arriving.  Without this the frame can only be
    // sent as a reply, so a client that connected before login would wait forever for a state
    // change it never hears about.
    g_control_peer = fd;
    // If a login already happened before this connection arrived, tell it now: the Node side
    // treats a fresh connection as unknown state, not as "still logged out".
    if (g_logged_in != 0) {
      do_announce_login(g_login_uin);
    }
    serve_connection(fd, a->control, static_cast<int>(::getpid()));
    if (g_control_peer == fd) g_control_peer = -1;
    ::close(fd);
  }
  return nullptr;
}

}  // namespace

// Accepts the Node side's connection on the recv channel and keeps it.
//
// The recv channel is one-way and long-lived: the Node side connects once and then only
// reads.  So this thread does not serve requests -- it accepts a peer and publishes that
// connected fd as the emitter's destination.  Using the LISTEN socket as the destination
// instead is the mistake to avoid: write() to a listening socket fails with ENOTCONN, and
// because the emitter drops frames rather than blocking, the symptom is "no packets arrive"
// with nothing in the log.
static void* recv_accept_main(void* arg) {
  const RecvArgs* ra = static_cast<const RecvArgs*>(arg);
  const int listen_fd = ra->listen_fd;
  const char* recv_path_for_hello = ra->path;
  for (;;) {
    if (g_stop_listener != 0) break;
    const int peer = ::accept(listen_fd, nullptr, nullptr);
    if (peer < 0) {
      ::usleep(10000);
      continue;
    }
    // Replace any previous peer: a Node-side reconnection must not leave the emitter writing
    // to a closed socket.
    if (g_recv_peer >= 0) ::close(g_recv_peer);
    g_recv_peer = peer;

    // Answer with a hello before treating the peer as a reader.
    //
    // The recv channel is one-way in its DATA, but not in its handshake: connectPipe() calls
    // connectSocket() and then waitForHello(true) on both kinds, and only a hello frame resolves
    // that promise.  Accepting the connection and going quiet leaves the Node side stuck in
    // phase=hello until its timeout, so "the recv pipe never connected" is what you see -- the
    // pipe did connect, the handshake did not.
    //
    // msg carries the pipe name and value0 the pid, because resolveHello() builds its result
    // from those two fields and nothing else.
    {
      const std::size_t len = std::strlen(recv_path_for_hello);
      const FrameHeader hello = make_header(
          kOpHello, 0, 0, 0, 0, static_cast<std::uint32_t>(len), 0,
          static_cast<std::uint64_t>(::getpid()));
      send_frame(peer, hello, nullptr, recv_path_for_hello, nullptr);
    }

    std::printf("[payload] recv peer connected (fd=%d)\n", peer);
    std::fflush(stdout);
    // Keep the listen socket open for a reconnect, but stop accepting until this peer goes
    // away: the protocol has one consumer, and two writers on one stream would interleave
    // half-frames.
    for (;;) {
      if (g_stop_listener != 0) break;
      // A stop request must break this inner loop too, or join would wait out the peer.
      if (g_stop_listener != 0) { ::close(peer); g_recv_peer = -1; break; }
      // Detect peer close without consuming data (the channel is one-way).
      char probe;
      const ssize_t n = ::recv(peer, &probe, 1, MSG_PEEK | MSG_DONTWAIT);
      if (n == 0) {  // orderly shutdown by the peer
        std::printf("[payload] recv peer disconnected\n");
        std::fflush(stdout);
        ::close(peer);
        g_recv_peer = -1;
        break;
      }
      // n < 0 with EAGAIN is the normal case: nothing to read, peer still alive.
      ::usleep(50000);
    }
  }
  return nullptr;
}

// Writes one op=6 (packet) frame to the recv channel.
//
// This is the function the hooked recv slot calls.  It must be safe to call from inside QQ's
// own thread, in the middle of its receive path, so it does no allocation, takes no lock that
// another thread could hold, and never blocks: a full socket buffer drops the frame instead
// of stalling the client.  Losing one frame is recoverable; freezing QQ is not.
static bool emit_packet(const char* service_cmd, const char* uin, int32_t ret_code,
                        uint64_t seq, const void* body, std::uint32_t body_len) {
  if (g_recv_peer < 0) return false;
  if (service_cmd == nullptr) service_cmd = "";
  if (uin == nullptr) uin = "";

  const FrameHeader h = make_header(kOpPacket, 0, ret_code, 0,
                                    static_cast<std::uint32_t>(std::strlen(service_cmd)),
                                    static_cast<std::uint32_t>(std::strlen(uin)),
                                    body_len, seq);
  // send_frame takes the body length from h.body_len, so the header has to carry it.
  return send_frame(g_recv_peer, h, service_cmd, uin, body);
}

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

// Binds and listens on one path, returning the fd or a negative payload error code.
//
// Factored out because the payload now owns two channels and they must be set up identically:
// a recv channel that skipped the unlink step would fail to rebind after a restart with
// EADDRINUSE, and the symptom ("works once") is a long way from the cause.
static int listen_unix(const char* path, int backlog) {
  ::unlink(path);
  if (std::strlen(path) >= sizeof(sockaddr_un::sun_path)) {
    std::printf("[payload] socket path too long: %s\n", path);
    return -1;
  }
  const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) return -2;
  struct sockaddr_un addr;
  std::memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  std::strncpy(addr.sun_path, path, sizeof(addr.sun_path) - 1);
  if (::bind(fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) != 0) {
    std::printf("[payload] bind(%s) failed\n", path);
    ::close(fd);
    return -3;
  }
  if (::listen(fd, backlog) != 0) {
    ::close(fd);
    return -4;
  }
  return fd;
}

// start_dynamic runs the module's dynamic startup: it binds the control socket,
// spawns the listener that serves the wire protocol, and returns.
//
// Returning is the point.  The caller must cope with a callee that finishes while
// its threads do not -- and the threads it spawned live on the stack the injector
// mapped, so they keep running after the ptrace session ends.
//
// Repeatable: starting an already-running hook is a no-op that reports success,
// which is what the Node side needs when it reconnects after a QQ restart.
extern "C" int snowluma_linux_hook_start_dynamic() {
  // Prefer the Node side's derivation.  HZ_CONTROL_SOCK stays as an override for the tests, which
  // want a path of their own and must not collide with a real SnowLuma instance on the box.
  char derived_control[sizeof(sockaddr_un::sun_path)] = {0};
  const char* override_path = env_or("HZ_CONTROL_SOCK", nullptr);
  const bool using_override = override_path != nullptr;
  if (using_override) {
    std::strncpy(derived_control, override_path, sizeof(derived_control) - 1);
  } else if (!mojo_socket_path(derived_control, sizeof(derived_control), "control")) {
    std::printf("[payload] derived control path too long\n");
    return -1;
  }
  const char* control = derived_control;
  const char* started = env_or("HZ_CONTROL_STARTED", kDefaultStarted);
  ensure_parent_dir(control);
  std::printf("[payload] control socket path: %s\n", control);
  std::fflush(stdout);

  if (std::strlen(control) >= sizeof(sockaddr_un::sun_path)) {
    std::printf("[payload] control path too long: %s\n", control);
    return -1;
  }

  if (g_state == HookState::kRunning) {
    // Already up.  Report success rather than racing a second bind on a path the
    // first listener owns: that would fail with EADDRINUSE and make a reconnect
    // look like a hook that refuses to start.
    std::printf("[payload] start_dynamic: already running, no-op\n");
    std::fflush(stdout);
    return 1;
  }

  // Take the kStopping -> kStarting -> kRunning transition.  A concurrent
  // stop_dynamic that wins the compare-and-swap gets told we yielded, and we
  // bail out rather than carrying on with a state we no longer own.
  if (cas_state(HookState::kStopped, HookState::kStarting) != HookState::kStopped) {
    return 0;
  }
  // A stale file from a previous run makes "the socket appeared" meaningless.
  ::unlink(control);
  ::unlink(started);

  const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) {
    std::printf("[payload] socket() failed\n");
    g_state = HookState::kStopped;
    return -2;
  }

  struct sockaddr_un addr;
  std::memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  std::strncpy(addr.sun_path, control, sizeof(addr.sun_path) - 1);

  if (::bind(fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) != 0) {
    std::printf("[payload] bind(%s) failed\n", control);
    ::close(fd);
    g_state = HookState::kStopped;
    return -3;
  }
  if (::listen(fd, 8) != 0) {
    std::printf("[payload] listen(%s) failed\n", control);
    ::close(fd);
    g_state = HookState::kStopped;
    return -4;
  }

  // The recv channel.  It is a separate listen socket because the Node side connects the two
  // independently and treats them as distinct streams; multiplexing them onto one socket
  // would require a discriminator the protocol does not have.
  //
  // Its path is derived from the control path so a caller that relocated the pair with
  // HZ_CONTROL_SOCK gets both moved together, instead of a recv socket left at the default
  // and silently unnoticed by whoever is watching.
  {
    // The Node side builds the recv name independently as mojo.<pid>.recv.sock -- it is NOT the
    // control name with a suffix appended.  Deriving it from the control path produced
    // mojo.<pid>.control.recv.sock, which nothing ever dials.
    const char* env_recv = env_or("HZ_RECV_SOCK", nullptr);
    if (env_recv != nullptr && std::strlen(env_recv) < sizeof(g_recv_path)) {
      std::strncpy(g_recv_path, env_recv, sizeof(g_recv_path) - 1);
    } else if (!using_override &&
               mojo_socket_path(g_recv_path, sizeof(g_recv_path), "recv")) {
      // derived directly, matching mojoPipeName(pid, "recv")
    } else if (std::strlen(control) + 5 < sizeof(g_recv_path) &&
               std::strlen(control) > 5 &&
               std::strcmp(control + std::strlen(control) - 5, ".sock") == 0) {
      // Replace the ".sock" tail with ".recv.sock": mojo.<pid>.control.sock becomes
      // mojo.<pid>.control.recv.sock.  Keeping the prefix means both sockets sit beside each
      // other, which is what the Node side expects.
      const std::size_t keep = std::strlen(control) - 5;
      std::memcpy(g_recv_path, control, keep);
      std::strcpy(g_recv_path + keep, ".recv.sock");
    } else {
      std::strncpy(g_recv_path, kDefaultRecv, sizeof(g_recv_path) - 1);
    }
    const int rfd = listen_unix(g_recv_path, 8);
    if (rfd < 0) {
      std::printf("[payload] recv channel failed (%d), continuing with control only\n", rfd);
      g_recv_path[0] = '\0';
    } else {
      g_recv_fd = rfd;
      std::printf("[payload] recv listening on %s (fd=%d)\n", g_recv_path, rfd);
      // A dedicated thread accepts the Node side's connection and keeps it.  The control
      // listener cannot do this itself: it is busy serving request/ack/reply pairs, and a
      // recv connect would queue behind them.
      // Joinable, and the handle is kept: stop_dynamic has to wait for this thread to actually
      // leave its loop before the caller unmaps the image.  A detached thread here means the
      // unmap can pull the code out from under a running loop, which faults in the host process.
      recv_listen_fd_storage = rfd;
      recv_args_storage.listen_fd = rfd;
      std::strncpy(recv_args_storage.path, g_recv_path, sizeof(recv_args_storage.path) - 1);
      if (::pthread_create(&g_recv_thread, nullptr, recv_accept_main, &recv_args_storage) == 0) {
        g_recv_thread_live = true;
        std::printf("[payload] recv accept thread started\n");
      } else {
        std::printf("[payload] recv accept thread failed to start\n");
      }
    }
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

  g_listen_fd = fd;
  g_stop_listener = 0;
  std::memset(g_control_path, 0, sizeof(g_control_path));
  std::strncpy(g_control_path, control, sizeof(g_control_path) - 1);

  pthread_t thread;
  // Raw pthread_create on purpose: std::thread drags in the C++ runtime's
  // thread-local bookkeeping, which this loader cannot relocate.
  const int rc = ::pthread_create(&thread, nullptr, listener_main, &args);
  if (rc != 0) {
    std::printf("[payload] pthread_create failed (%d)\n", rc);
    ::close(fd);
    g_listen_fd = -1;
    g_state = HookState::kStopped;
    return -5;
  }
  // Joined by stop_dynamic, not detached.  The earlier version detached and left stop_dynamic
  // returning immediately, which meant the caller unmapped this image while the thread was still
  // in its accept loop -- the thread then resumed into unmapped memory and killed the host
  // process.  Joining cannot hang the ptrace call because stop_dynamic has already shutdown() the
  // listening socket, so the blocked accept returns and the loop sees g_stop_listener.
  g_thread = thread;
  g_thread_live = true;
  cas_state(HookState::kStarting, HookState::kRunning);

  std::printf("[payload] start_dynamic returning, listener thread=%lu\n",
              static_cast<unsigned long>(thread));
  std::fflush(stdout);

  // Non-zero: "started".
  return 1;
}

// stop_dynamic tears the listener down: it asks the thread to stop, drops the
// listening socket and removes the socket file, and leaves the state back at
// kStopped so a later start works.
//
// It never joins the thread.  Joining from inside the hook runs on the ptrace
// call path, and waiting for a thread that is blocked in accept() would hang the
// caller.  The thread notices the stop flag within a bounded accept and exits on
// its own; the socket it held is closed here so the path is free to rebind.
extern "C" int snowluma_linux_hook_stop_dynamic() {
  if (g_state == HookState::kStopped) {
    std::printf("[payload] stop_dynamic: already stopped, no-op\n");
    std::fflush(stdout);
    return 0;
  }

  // Ask the listener to leave its accept loop.
  g_stop_listener = 1;
  if (g_listen_fd >= 0) {
    // Interrupting the blocking accept lets the thread notice the flag promptly
    // instead of waiting out its own accept timeout.
    ::shutdown(g_listen_fd, SHUT_RDWR);
  }
  if (g_control_path[0] != '\0') {
    // Remove the socket file so a re-start sees a clean path.  Leaving a stale
    // file behind would make "the socket appeared" ambiguous on the next run.
    ::unlink(g_control_path);
  }
  if (g_listen_fd >= 0) {
    ::close(g_listen_fd);
    g_listen_fd = -1;
  }
  // The recv channel goes with the control channel: leaving it bound would let the Node side
  // reconnect to a hooked process that has already been told to stop.
  if (g_recv_fd >= 0) {
    ::shutdown(g_recv_fd, SHUT_RDWR);
    ::close(g_recv_fd);
    g_recv_fd = -1;
  }
  if (g_recv_path[0] != '\0') {
    ::unlink(g_recv_path);
    g_recv_path[0] = '\0';
  }
  // Wait for both threads to leave their loops before returning.
  //
  // This is the difference between a clean stop and a crash one call later.  The caller unmaps
  // this image as soon as stop returns; a thread still inside accept(), usleep() or the loop
  // body would resume into unmapped memory and fault -- killing the HOST process, not just the
  // hook.  The symptom is "the second injection kills QQ", which looks like an injector bug.
  //
  // Joining is safe here because both loops already observe g_stop_listener and the shutdown()
  // above wakes the blocking accept.
  if (g_thread_live) {
    ::pthread_join(g_thread, nullptr);
    g_thread_live = false;
  }
  if (g_recv_thread_live) {
    ::pthread_join(g_recv_thread, nullptr);
    g_recv_thread_live = false;
  }
  g_state = HookState::kStopped;

  std::printf("[payload] stop_dynamic done\n");
  std::fflush(stdout);
  return 0;
}

// Reports whether the dynamic hook is currently running.  The Node side polls this
// to tell "the payload loaded" from "the payload loaded and is serving".
extern "C" int snowluma_linux_hook_is_loaded() {
  return g_state == HookState::kRunning ? 1 : 0;
}

// Backend version, so a caller can tell a stale payload from a current one.
extern "C" std::uint64_t snowluma_linux_hook_backend_version() {
  return 3;
}

// Handle for the control socket, for callers that want to poke it directly
// rather than going through the protocol.  Returned as a descriptor, or -1.
extern "C" int snowluma_linux_hook_control_socket() {
  return g_listen_fd;
}

// Handle for the recv channel.  Separate from the control handle because the two carry
// disjoint halves of the op space; a caller that confused them would write packet frames at
// the control channel and see them parsed as requests.
extern "C" int snowluma_linux_hook_recv_socket() {
  return g_recv_fd;
}

// ---------------------------------------------------------------------------
// Login state
// ---------------------------------------------------------------------------
// The login signal is a vtable slot, not a callback: selfInfoOnLoginSuccess has no direct
// callers anywhere in wrapper.node, it is slot 11 of nt::login::QRCodeLoginRequestImpl.  The
// hooked slot runs on QQ's own thread, so this only records the state and writes the frame --
// no locks, no allocation, no waiting.
//
// Both channels get the frame.  The Node side handles op 7 on each of them, and the control
// channel needs it because a session that connects after login would otherwise never learn the
// state; the recv channel needs it because its own handler gates packets on being logged in.
// The observer installed on the login slot.  The signature is (slot, original); the uin is not
// available as an argument because the slot's real prototype is unknown, so the payload reads it
// from the module's own state once the login has completed -- which is what a real implementation
// does.  Here it records a fixed test uin so the frame can be checked.
extern "C" void hz_login_observer(uint32_t slot, uint64_t original) {
  (void)slot;
  (void)original;
  ++g_login_hits;
  do_announce_login(kTestUin);
}

// Test-only entry: forces a login announcement, so the frame path can be verified without QQ.
extern "C" void hz_test_announce_login(long long uin) { do_announce_login(uin); }
extern "C" int hz_test_logged_in() { return g_logged_in; }
extern "C" int hz_test_login_hits() { return g_login_hits; }

// Test-only entry: emits one op=6 packet frame on the recv channel, as the hooked recv slot
// would.  Exposed so the recv path can be exercised end to end without a real QQ: the point
// being to prove the frame the Node side reads is byte-identical to what it expects, and that
// a missing peer drops the frame instead of blocking.
extern "C" int hz_test_emit_packet(const char* service_cmd, const char* uin,
                                   int ret_code, std::uint64_t seq,
                                   const void* body, std::uint32_t body_len) {
  return emit_packet(service_cmd, uin, ret_code, seq, body, body_len) ? 1 : 0;
}

// Test-only entry: reports whether a peer is currently attached to the recv channel.
extern "C" int hz_test_recv_peer() { return g_recv_peer; }

extern "C" std::uint64_t hz_payload_version() { return 3; }