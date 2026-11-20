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

// The payload's hook installation, via a C interface.  Kept as a separate translation unit
// because the engine is C++ with STL and this file must not be: see payload_hook.cc.
#include "payload_hook.h"

// Defined below, with the rest of the login state.  Declared here because start_dynamic
// installs it and appears earlier in the file; the alternative -- moving start_dynamic down
// -- would separate the exported entry points from each other.
extern "C" void hz_login_observer(uint32_t slot, uint64_t original);

#include <dirent.h>
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
// Inbound only. The client tells the payload who it is; see the handler for the value0 shape.
constexpr std::uint16_t kOpLoginIdentityHint = 17;
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

// Writes a socket frame without either blocking the caller or signalling the process.
//
// Two failure modes matter here more than anywhere else in the payload, because this runs on
// QQ's own threads:
//
//   * SIGPIPE. A peer that closes before we finish writing makes plain write() raise SIGPIPE,
//     whose default action is to terminate the process. That is the whole client gone because a
//     diagnostic client went away -- and it is reachable from the login path, where op 7 is
//     pushed to every connected peer.
//   * Blocking. A peer that stops reading fills the socket buffer and write() then blocks the
//     QQ thread it was called on, which for op 7 is the thread signing in.
//
// MSG_NOSIGNAL covers the first and MSG_DONTWAIT the second. A partial or refused write is
// reported as failure rather than retried: dropping a frame to a peer that is not reading is
// better than stalling a login.
bool write_exact(int fd, const void* buf, std::size_t len) {
  const auto* p = static_cast<const std::uint8_t*>(buf);
  std::size_t put = 0;
  while (put < len) {
    const ssize_t n = ::send(fd, p + put, len - put, MSG_NOSIGNAL | MSG_DONTWAIT);
    if (n > 0) {
      put += static_cast<std::size_t>(n);
      continue;
    }
    if (n < 0 && (errno == EINTR)) continue;
    // EAGAIN means the peer is not draining; the frame is abandoned rather than blocking.
    return false;
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
// Every live control connection, not just the last one.
//
// A single stored fd was wrong: the second client to connect overwrote the first, and the first
// then sat on an open socket that would never receive another frame. Ten concurrent clients
// produced one delivery and nine nulls. The Node side is not guaranteed to be the only client --
// a second window, a retry after a dropped connection, a diagnostic probe alongside the real
// one -- so pushing a state change has to reach all of them.
constexpr int kMaxClients = 16;
int g_control_peers[kMaxClients] = {-1, -1, -1, -1, -1, -1, -1, -1,
                                    -1, -1, -1, -1, -1, -1, -1, -1};
volatile int g_control_peer_count = 0;

// Registers a control fd, returning false when the table is full.
static bool control_peer_add(int fd) {
  for (int i = 0; i < kMaxClients; ++i) {
    int expected = -1;
    if (__atomic_compare_exchange_n(&g_control_peers[i], &expected, fd, false,
                                    __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) {
      __atomic_add_fetch(&g_control_peer_count, 1, __ATOMIC_ACQ_REL);
      return true;
    }
  }
  return false;
}

static void control_peer_remove(int fd) {
  for (int i = 0; i < kMaxClients; ++i) {
    if (__atomic_load_n(&g_control_peers[i], __ATOMIC_ACQUIRE) == fd) {
      __atomic_store_n(&g_control_peers[i], -1, __ATOMIC_RELEASE);
      __atomic_sub_fetch(&g_control_peer_count, 1, __ATOMIC_ACQ_REL);
      return;
    }
  }
}

// Sends a frame to every live control connection.
//
// Body length lives in the header, so there is no separate length argument to get wrong.
static void broadcast_to_peers(const FrameHeader& h, const char* msg, const void* body) {
  for (int i = 0; i < kMaxClients; ++i) {
    const int fd = __atomic_load_n(&g_control_peers[i], __ATOMIC_ACQUIRE);
    if (fd >= 0) send_frame(fd, h, nullptr, msg, body);
  }
}
int g_login_hits = 0;
// A placeholder account, not a real one. Any nine-digit value works: the tests exercise the
// framing and the state machine, not a particular account.
constexpr long long kTestUin = 3000000000LL;

// The account the hook itself observed, as opposed to any constant compiled in.
//
// This exists because the test payload used to answer every connection with a hard-coded uin
// and an unconditional "logged in". That made op 7 unfalsifiable -- a hook that never fired
// and one that fired correctly produced identical frames -- so no reading of it could count as
// evidence that the observer ran. Only this value, written by the observer, can.
volatile long long g_observed_uin = 0;

// Decimal, without snprintf: this runs on QQ's own thread and the loader relocates no TLS, so
// a libc formatting call is more machinery than the job needs.
void unsigned_to_dec(long long value, char* out, std::size_t cap) {
  if (cap == 0) return;
  unsigned long long v = static_cast<unsigned long long>(value);
  char tmp[24];
  int len = 0;
  if (v == 0) tmp[len++] = '0';
  while (v != 0) { tmp[len++] = static_cast<char>('0' + (v % 10)); v /= 10; }
  std::size_t n = 0;
  for (int i = len - 1; i >= 0 && n + 1 < cap; --i) out[n++] = tmp[i];
  out[n] = '\0';
}

// Login state, declared with the rest of the state because the control thread reads it to greet
// a new connection, and that thread is defined before the announce helper.
// 64-bit, not int: real QQ numbers exceed 2^31 -- 3XXXXXXXXX wraps to -1211510953 as a signed
// 32-bit value, which then went out on the wire as 18446744072498040663. The number looked like a
// garbage uin rather than a truncation, which cost a round of hunting for the wrong bug.
long long g_login_uin = 0;
volatile int g_logged_in = 0;

// Signed in as `uin`: record it and tell both channels.
//
// Idempotent by design.  QQ can re-announce a login (a reconnect, or the callback firing again),
// and re-sending op 7 with unchanged state is harmless because the Node side only wakes its
// waiters when the values actually change.
// The last accepted login identity hint, and the deadline it opened.
//
// A deadline rather than a flag: the question anyone asks is "is this still valid now", and a
// flag plus a timestamp invites the two to drift apart. Written only from the connection thread
// that accepted the hint, read only by diagnostics, so no lock is needed.
static volatile std::uint64_t g_login_hint = 0;
static volatile std::uint64_t g_keepalive_deadline_ms = 0;

// Milliseconds from an arbitrary origin -- only differences are used, so CLOCK_MONOTONIC is
// right and CLOCK_REALTIME would be wrong: a wall-clock jump must not open or close the window.
static std::uint64_t monotonic_ms() {
  struct timespec ts;
  if (::clock_gettime(CLOCK_MONOTONIC, &ts) != 0) return 0;
  return static_cast<std::uint64_t>(ts.tv_sec) * 1000ull +
         static_cast<std::uint64_t>(ts.tv_nsec) / 1000000ull;
}

// The four commands the reference accepts on op 2.
//
// Copied as strings rather than derived, because in the reference they are not strings at all:
// the .rodata bytes at 0x580e3 and its neighbours are obfuscated, and the plaintext is produced
// by per-string decryptors during static initialisation. `strings` over the shipped library finds
// none of these names, which is why they had to be recovered by emulating the decryptors.
//
// Lengths are 10, 14, 22, 22 -- matching the four `mov esi,<len>` sites in the whitelist function.
static const char* const kReferenceWhitelist[] = {
    "hb_pc_grab",
    "hb_pc_pre_pack",
    "OidbSvcTrpcTcp.0x7c2_5",
    "OidbSvcTrpcTcp.0x8a1_7",
};

// True when `cmd` is one of the reference's accepted commands.
//
// Compares the whole span and the length, so a command that merely starts with one of these --
// "hb_pc_grab_extra" -- is not accepted. The reference does the same: its whitelist function
// compares length first and then calls bcmp over the full length.
static bool is_reference_whitelisted_cmd(const char* cmd, std::uint32_t len) {
  for (const char* const allowed : kReferenceWhitelist) {
    const std::size_t n = std::strlen(allowed);
    if (n != static_cast<std::size_t>(len)) continue;
    if (std::memcmp(cmd, allowed, n) == 0) return true;
  }
  return false;
}

static void do_announce_login(long long uin) {
  g_login_uin = uin;
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
  if (g_listen_fd >= 0) broadcast_to_peers(logged, uin_text, nullptr);
  if (g_recv_peer >= 0) {
    send_frame(g_recv_peer, logged, nullptr, uin_text, nullptr);
  }

  // op 22: the account report, which the reference sends alongside every login-state change.
  //
  // It carries the session id in value0 and nothing else -- no cmd, no msg, no body. Its purpose
  // is not to say *what* happened (op 7 already did) but to say *whose* stream this is, for
  // consumers that attach to the recv channel and get payloads which say nothing about the
  // account. The reference's requestId here is its inverted presence flag, (id == 0) ? 1 : 0,
  // copied rather than tidied because a consumer written against it may read the field.
  const FrameHeader account_report = make_header(
      kOpPrivateMsgReporting, uin == 0 ? 1 : 0, 0, 0, 0, 0, 0,
      static_cast<std::uint64_t>(uin));
  if (g_listen_fd >= 0) broadcast_to_peers(account_report, nullptr, nullptr);
  if (g_recv_peer >= 0) {
    send_frame(g_recv_peer, account_report, nullptr, nullptr, nullptr);
  }

  std::printf("[payload] login announced: uin=%s (clients=%d recv=%d)\n", uin_text,
              g_control_peer_count, g_recv_peer);
  std::fflush(stdout);
}

// Announces a login whose account number is not known yet.
//
// Separate from do_announce_login rather than passing a sentinel through it: 0 is a legal
// value to format and would go out as "0", which the Node side would read as an account
// called zero.  Here the uin fields are left empty and only the logged-in indicators are
// set, so the receiver learns the state and nothing it has to disbelieve.
static void do_announce_login_unknown() {
  g_logged_in = 1;

  const FrameHeader logged =
      make_header(kOpLoginState, 0, 1, kFlagLoggedIn, 0, 0, 0, 0);
  if (g_listen_fd >= 0) broadcast_to_peers(logged, nullptr, nullptr);
  if (g_recv_peer >= 0) {
    send_frame(g_recv_peer, logged, nullptr, nullptr, nullptr);
  }
  std::printf("[payload] login announced: uin unknown (control=%d recv=%d)\n",
              g_control_peer_count, g_recv_peer);
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
      // Replay whatever the hook has actually reported, never a fixed account.
      //
      // This used to send a hard-coded uin and an unconditional "logged in". That made every
      // observation of op 7 meaningless: a hook that never fired and a hook that fired
      // correctly produced the same frame, so the frame could not be evidence of anything.
      // Gating on g_logged_in means the frame now says only what was really seen, and reading
      // "logged in" here proves the observer ran.
      if (!g_logged_in) {
        const FrameHeader waiting =
            make_header(kOpLoginState, 0, 0, 0, 0, 0, 0, 0);
        if (!send_frame(fd, waiting, nullptr, nullptr, nullptr)) return;
        continue;
      }
      char uin_text[24];
      unsigned_to_dec(g_observed_uin, uin_text, sizeof(uin_text));
      const FrameHeader logged = make_header(
          kOpLoginState, 0, 1, kFlagLoggedIn, 0,
          static_cast<std::uint32_t>(std::strlen(uin_text)), 0,
          static_cast<std::uint64_t>(g_observed_uin));
      if (!send_frame(fd, logged, nullptr, uin_text, nullptr)) return;
      continue;
    }

    // Hook a family of exports, or the single login notification when no needle is given.
    //
    // The needle travels in `msg`, not the body: the body is drained before this point without
    // being echoed, so it is not available here.
    //
    // Commands are matched against literal bytes. The first attempt at this spelled "EXPORT"
    // with cmd[0] == 'X' -- off by one -- so the branch was unreachable and every probe fell
    // through to the generic op-2 refusal, which still answers ACK with value0 == 0. That reads
    // exactly like a successful install, and it cost several rounds.
    if (h.op == kOpRequest && h.cmd_len == 6 && cmd[0] == 'E' && cmd[1] == 'X' &&
        cmd[2] == 'P' && cmd[3] == 'O' && cmd[4] == 'R' && cmd[5] == 'T') {
      const int rc = (h.msg_len > 0) ? hz_hook_exports_matching(msg, 40)
                                     : hz_hook_export_login_observer(hz_login_observer);
      const FrameHeader ack =
          make_header(kOpAck, 0, 0, 0, h.request_id, 0, 0, static_cast<std::uint64_t>(rc));
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      continue;
    }

    // Hook every export large enough to patch. The next login then names its own entry points.
    // Removes every hook without stopping the payload.
    //
    // This exists because the remove path is reachable from stop_dynamic, which is what runs when
    // the client shuts down or the hook is toggled -- so a fault in it takes the process down at
    // the moment nobody is watching for it. It used to do exactly that: every hook was undone as
    // a vtable slot, function-entry hooks carried vtable == 0 into a throwing check, and the
    // exception escaped an extern "C" into std::terminate. Install the export probe, then stop,
    // and the client died. Exposing removal over the wire makes that testable without stopping
    // anything.
    if (h.op == kOpRequest && h.cmd_len == 6 && cmd[0] == 'U' && cmd[1] == 'N' &&
        cmd[2] == 'H' && cmd[3] == 'O' && cmd[4] == 'O' && cmd[5] == 'K') {
      const int before = hz_hook_count();
      hz_hook_remove_all();
      const int after = hz_hook_count();
      const FrameHeader ack = make_header(kOpAck, 0, 0, 0, h.request_id, 0, 0,
                                          static_cast<std::uint64_t>(before - after));
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      continue;
    }

    if (h.op == kOpRequest && h.cmd_len == 5 && cmd[0] == 'P' && cmd[1] == 'R' &&
        cmd[2] == 'O' && cmd[3] == 'B' && cmd[4] == 'E') {
      const int got = hz_hook_all_exports(200);
      const FrameHeader ack =
          make_header(kOpAck, 0, 0, 0, h.request_id, 0, 0, static_cast<std::uint64_t>(got));
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      continue;
    }

    // Hook a few slots on every nt::login class so the entry counter can say which one a real
    // sign-in reaches. Driven over the socket because the payload reads QQ's environment, not
    // the injector's, and an already-running process cannot have that changed.
    if (h.op == kOpRequest && h.cmd_len >= 5 && cmd[0] == 'S' && cmd[1] == 'W' &&
        cmd[2] == 'E' && cmd[3] == 'E' && cmd[4] == 'P') {
      const int got = hz_hook_sweep_login_classes(3);
      const FrameHeader ack =
          make_header(kOpAck, 0, 0, 0, h.request_id, 0, 0, static_cast<std::uint64_t>(got));
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      continue;
    }

    // op 17: the login identity hint, inbound only.
    //
    // The reference accepts this frame, validates the shape of value0, records it, opens a
    // 60-second keepalive window and answers op 3; a value that does not fit is answered with
    // op 5 and -EINVAL. It is *not* sent by the payload -- that direction belongs to the client,
    // which is the opposite of how an earlier revision of the Node side had it.
    //
    // value0 is a packed pair, high word == 1 and low word < 10000, not an account number. A
    // uin has a high word of 0, so a payload that sent one would be refused on every frame while
    // looking like it worked, and the keepalive window it was meant to open would never start.
    if (h.op == kOpLoginIdentityHint) {
      const std::uint64_t base = 0x100000000ull;
      const bool in_range = h.value0 >= base && (h.value0 - base) < 10000ull;
      if (!in_range) {
        const FrameHeader bad = make_header(kOpError, h.request_id, -22, 0, 0, 0, 0, 0);
        static const char kWhy[] = "invalid login identity hint";
        if (!send_frame(fd, bad, kWhy, nullptr, nullptr)) return;
        continue;
      }
      g_login_hint = h.value0;
      g_keepalive_deadline_ms = monotonic_ms() + 60000ull;
      const FrameHeader ack = make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, 0);
      if (!send_frame(fd, ack, nullptr, nullptr, nullptr)) return;
      std::printf("[payload] login hint accepted: 0x%llx, keepalive %llums\n",
                  static_cast<unsigned long long>(h.value0), 60000ull);
      std::fflush(stdout);
      continue;
    }

    // op 2, commands on the reference's whitelist: accept with an empty ACK and, if the peer
    // asked for a reply, an empty reply.
    //
    // These four are the *whole* of the reference's acceptance path. Disassembly settles what
    // they do: nothing. The accept branch contains exactly two calls (0x1212f answers op 3 and
    // 0x121a6 answers op 4), both to the payload's own frame writer, and both with a zeroed
    // 24-byte body. `send@plt` has two call sites in the entire library -- the payload's own
    // socket and that same frame writer. The one path that can reach QQ's real send entry
    // ([dispatch+0x30] at 0x12c0f) is the *non*-whitelisted branch, which hands the request to
    // the client's own dispatch table.
    //
    // So the honest implementation matches the reference by acknowledging and doing nothing.
    // The alternative -- treating these names as a cue to send messages -- would invent a
    // capability the original never had, and an invented send path is a risk surface, not
    // progress. See docs/parity-table.md, including its note on why this was first mis-graded
    // P0.
    if (h.op == kOpRequest && is_reference_whitelisted_cmd(cmd, h.cmd_len)) {
      const FrameHeader accepted = make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, 0);
      if (!send_frame(fd, accepted, nullptr, nullptr, nullptr)) return;
      // The reference masks the inbound flags down to bit 0 before deciding, and only then
      // sends op 4.
      if ((h.flags & kFlagWantReply) != 0) {
        const FrameHeader replied = make_header(kOpReply, h.request_id, 0, 0, 0, 0, 0, 0);
        if (!send_frame(fd, replied, nullptr, nullptr, nullptr)) return;
      }
      std::printf("[payload] op2 accepted (whitelisted): cmd=\"%s\"\n", cmd);
      std::fflush(stdout);
      continue;
    }

    if (h.op == kOpRequest) {
      // ACK, then an error naming the reason.
      //
      // The closed-source payload does exactly this and nothing else: its op 2 branch has a
      // single exit that answers ACK + one fixed message ("Linux runtime targets are not
      // resolved yet"), and no success path exists in that binary. The actual send is not in
      // the payload at all.
      //
      // So this does not pretend to satisfy the request. What it does instead is answer in
      // the form the Node side already handles -- op 5 with a user-facing message and the
      // documented status codes -- so a caller sees the same class of error a real client
      // would, rather than an empty reply it has no case for.
      //
      // Sending an empty reply (what this used to do) was worse than useless: the absence of
      // a message reads as "the payload accepted the request and had nothing to say", which
      // is the opposite of the truth.
      const FrameHeader ack = make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, 0);
      if (!send_frame(fd, ack, nullptr, nullptr, nullptr)) return;

      // Status 3 == "could not prepare the request" is the honest code here: the payload is
      // not resolving runtime targets, so it cannot prepare anything.
      //
      // The messages are the reference implementation's own strings, copied so the caller's
      // wording matches what users of the real product see. See
      // docs/reverse-socket-protocol.md for the address each came from.
      constexpr std::int32_t kStatusPrepareFailed = 3;
      const char* const detail =
          "SnowLuma could not prepare the request. Please restart SnowLuma and try again.";
      const FrameHeader failed =
          make_header(kOpError, h.request_id, kStatusPrepareFailed, 0, 0,
                      static_cast<std::uint32_t>(std::strlen(detail)), 0, 0);
      if (!send_frame(fd, failed, nullptr, detail, nullptr)) return;
      continue;
    }
    // Anything else is ignored; the connection stays usable, which is what the
    // real payload does for op codes it does not know.
  }
}

struct ConnArgs {
  int fd;
  char control[108];
};

static void* conn_thread_main(void* raw) {
  ConnArgs* conn = static_cast<ConnArgs*>(raw);
  const int fd = conn->fd;
  serve_connection(fd, conn->control, static_cast<int>(::getpid()));
  control_peer_remove(fd);
  ::close(fd);
  ::free(conn);
  return nullptr;
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
    if (!control_peer_add(fd)) {
      // Table full: accepting and immediately closing is honest, and the client sees a reset
      // rather than a connection that silently never answers.
      ::close(fd);
      continue;
    }
    // If a login already happened before this connection arrived, tell it now: the Node side
    // treats a fresh connection as unknown state, not as "still logged out".
    if (g_logged_in != 0) {
      do_announce_login(g_login_uin);
    }

    // One thread per connection, because serving inline meant the listener was blocked for the
    // life of the first client -- so a second connect() sat in the backlog and was answered only
    // after the first disconnected. With one client that is invisible; with two it looks like the
    // hook stopped reporting.
    ConnArgs* conn = static_cast<ConnArgs*>(::malloc(sizeof(ConnArgs)));
    if (conn == nullptr) {
      control_peer_remove(fd);
      ::close(fd);
      continue;
    }
    conn->fd = fd;
    int cn = 0;
    while (cn + 1 < 108 && a->control[cn] != '\0') {
      conn->control[cn] = a->control[cn];
      ++cn;
    }
    conn->control[cn] = '\0';
    pthread_t th = 0;
    if (::pthread_create(&th, nullptr, conn_thread_main, conn) == 0) {
      ::pthread_detach(th);
    } else {
      control_peer_remove(fd);
      ::close(fd);
      ::free(conn);
    }
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

  // The receipt goes first, matching the reference's order in the same loop: it emits op 21 and
  // then op 6 for each live endpoint.
  //
  // It carries the sequence in value0 and has no payload, so a consumer that missed a packet can
  // still see the sequence advance instead of waiting forever for something already sent. Sent
  // unconditionally, not only on success: the point is to record that a publish was attempted
  // for this sequence, and ret_code already says how it went.
  const FrameHeader receipt =
      make_header(kOpClientMessageReceipt, 0, 0, 0, 0, 0, 0, seq);
  const bool receipt_ok = send_frame(g_recv_peer, receipt, nullptr, nullptr, nullptr);

  const FrameHeader h = make_header(kOpPacket, 0, ret_code, 0,
                                    static_cast<std::uint32_t>(std::strlen(service_cmd)),
                                    static_cast<std::uint32_t>(std::strlen(uin)),
                                    body_len, seq);
  // send_frame takes the body length from h.body_len, so the header has to carry it.
  const bool packet_ok = send_frame(g_recv_peer, h, service_cmd, uin, body);
  return receipt_ok && packet_ok;
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
// Returns true when something is already listening on `path`.
//
// Used to avoid stealing a socket that belongs to a live peer. Connecting is the only reliable
// test: a socket file left behind by a dead process refuses the connection with ECONNREFUSED,
// while a live listener accepts it, so the two cases are distinguishable without guessing from
// the file's existence.
//
// The probe is not free, and the cost is worth stating rather than discovering later: the connect
// succeeds, the connection sits in the other process's accept queue, and closing it here leaves a
// dead entry behind. Against our own payload that is harmless -- the accept loop takes it and
// read() returns 0, which it already handles as a disconnect. Against the reference implementation
// the entry stays queued until it accepts, and a queue filled by repeated probes would eventually
// make it drop new connections. That is why this runs once per bind rather than per call, and why
// it is not used as a general liveness check.
static bool socket_is_live(const char* path) {
  struct stat st;
  if (::stat(path, &st) != 0) return false;
  if (::lstat(path, &st) != 0 || (st.st_mode & S_IFMT) != S_IFSOCK) return false;

  const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) return false;
  struct sockaddr_un addr;
  std::memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  std::strncpy(addr.sun_path, path, sizeof(addr.sun_path) - 1);
  const bool live =
      ::connect(fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) == 0;
  ::close(fd);
  return live;
}

static int listen_unix(const char* path, int backlog) {
  // Refuse to take a socket another instance is serving, instead of unlinking it.
  //
  // unlink-then-bind is right for cleaning up after a crash, and wrong when the previous owner is
  // still running: it silently deletes a live control channel and the peer that owned it keeps
  // waiting on a socket nobody can reach. The reference implementation has this same hazard, so
  // this is deliberately stricter rather than byte-for-byte identical -- a stolen channel on a
  // signed-in account is not a failure worth reproducing.
  //
  // The one case that must still work is re-entry after our own crash, where the file is left
  // behind but nothing listens; socket_is_live() distinguishes that by connecting.
  if (socket_is_live(path)) {
    std::printf("[payload] refusing to steal live socket %s\n", path);
    return -6;
  }
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

  // Owner-only, matching the reference implementation's srw------- .
  //
  // bind() creates the socket with the process umask applied, which is not something this code
  // controls -- the payload inherits QQ's umask, and QQ does not set one. The result was
  // srwxr-xr-x: any local user could connect and drive the control protocol, which means sending
  // op 2 as the logged-in account. The directory is 0700 so that is not reachable in a correctly
  // configured install, but the socket should not depend on the directory to be safe.
  //
  // fchmod rather than chmod on the path, and it is done after bind because the file does not
  // exist before then: a chmod beforehand would create a plain file that bind then refuses with
  // EADDRINUSE. A failure here is fatal -- a control channel readable by other users is worse
  // than no control channel.
  if (::fchmod(fd, 0600) != 0) {
    std::printf("[payload] fchmod(%s, 0600) failed\n", path);
    ::close(fd);
    return -5;
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
// Unbuffered marker, written with write(2) instead of printf.
//
// printf goes through stdio's buffer, and when the process that injected us exits, stdout
// becomes a closed pipe: every later printf fails silently and returns -1. During injection
// debugging that makes a payload that ran perfectly look like one that never started, which
// is a genuinely misleading failure. write(2) to fd 2 either lands or returns an error we can
// ignore, and it does not depend on TLS (which the manual loader does not relocate).
static void trace(const char* text) {
  const char* p = text;
  std::size_t n = 0;
  while (p[n] != '\0') ++n;
  const ssize_t ignored = ::write(2, p, n);
  (void)ignored;
}

// Reads QQ's own login state off the filesystem and announces it.
//
// This replaces hooking anything inside QQ. Five separate hook sites were each verified
// installed and each recorded zero calls through a real sign-in -- the QR vtable slot, the
// MSFService send slot, a 62-slot sweep of nt::login, the notifyLoginSuccess export, and the
// whole export surface -- so the observation point, not the mechanism, was the problem.
//
// QQ writes its account into a directory name in the clear:
//
//   <home>/.config/QQ/Partitions/qqnt_<uin>/
//   <home>/.config/QQ/Partitions/qq-browser-<uin>/
//
// Measured in the container: clicking login at 01:32 stamped qqnt_3XXXXXXXXX at 01:32, and
// auth/login.enc was rewritten at 01:43. So the signal is real, current, and needs nothing from
// the client's internals: no vtable layout, no exported symbol, no patched code. It also cannot
// crash QQ, which the function-entry patching did.
//
// Polling rather than inotify: one directory listing every five seconds is cheaper to get right
// than a watch that has to survive account switches and directory replacement, and a five-second
// delay on a login notification is not observable to the caller.
// mtime of auth/login.enc, in ms, as of the last sign-in this payload saw.
static volatile long long g_login_stamp = 0;

static void* login_dir_main(void*) {
  for (;;) {
    // The home directory of this process -- QQ's, since this code runs inside it.
    const char* home = ::getenv("HOME");
    if (home == nullptr || home[0] == '\0') home = "/app";

    char dir[512];
    int n = 0;
    const char* parts[3] = {home, "/.config/QQ/Partitions", nullptr};
    for (int k = 0; k < 2; ++k) {
      for (const char* q = parts[k]; *q != '\0' && n < 500; ++q) dir[n++] = *q;
    }
    dir[n] = '\0';

    DIR* d = ::opendir(dir);
    long long found = 0;
    long long best_when = -1;
    if (d != nullptr) {
      struct dirent* e;
      while ((e = ::readdir(d)) != nullptr) {
        // Only the qqnt_ prefix: qq-browser_<uin> appears alongside it for the same account, and
        // qq-browser-tab / qqnt_<nonce> are not accounts at all. Taking the first numeric suffix
        // under qqnt_ is the account directory QQ actually creates for a sign-in.
        const char* nm = e->d_name;
        if (nm[0] != 'q' || nm[1] != 'q' || nm[2] != 'n' || nm[3] != 't' || nm[4] != '_') continue;
        const char* p = nm + 5;
        if (*p < '0' || *p > '9') continue;
        long long v = 0;
        while (*p >= '0' && *p <= '9') v = v * 10 + (*p++ - '0');
        if (*p != '\0') continue;
        // QQ's uin fits in 32 bits; anything longer is not one, and a 64-bit accumulate would
        // overflow before the check.
        if (v <= 0 || v >= 4000000000LL) continue;

        // Pick the most recently touched account directory, not the first one listed.
        //
        // readdir order is arbitrary, and this container has qqnt_9210 and qqnt_9211 sitting
        // beside the real account -- leftovers from other tests. Taking the first match reported
        // uin 9211 for an account that is 3XXXXXXXXX, which is the sort of wrong answer that
        // looks entirely plausible in a log.
        char full[512];
        int fn = 0;
        for (const char* q = dir; *q != '\0' && fn < 500; ++q) full[fn++] = *q;
        if (fn < 500) full[fn++] = '/';
        for (const char* q = nm; *q != '\0' && fn < 500; ++q) full[fn++] = *q;
        full[fn] = '\0';

        struct stat dst;
        long long when = 0;
        if (::stat(full, &dst) == 0) {
          when = static_cast<long long>(dst.st_mtime) * 1000LL + dst.st_mtim.tv_nsec / 1000000LL;
        }
        if (when >= best_when) { best_when = when; found = v; }
      }
      ::closedir(d);
    }

    // The uin comes from the directory name, but the *event* comes from auth/login.enc.
    //
    // The account directory is persistent: qqnt_3XXXXXXXXX existed before the sign-in and its
    // mtime did not change when one happened. Using the directory as the trigger therefore
    // announced a login that had not occurred, which is exactly the class of mistake this whole
    // exercise exists to stop making.
    //
    // login.enc is rewritten on every sign-in. Measured twice in this container: 01:43:18 from
    // the first click and 01:57:21 from the second, each within a second of the button. So its
    // mtime is the event, and the directory name is the identity.
    char auth[512];
    int an = 0;
    const char* ap[3] = {home, "/.config/QQ/auth/login.enc", nullptr};
    for (int k = 0; k < 2; ++k) {
      for (const char* q = ap[k]; *q != '\0' && an < 500; ++q) auth[an++] = *q;
    }
    auth[an] = '\0';

    struct stat st;
    long long stamp = 0;
    if (::stat(auth, &st) == 0) {
      stamp = static_cast<long long>(st.st_mtime) * 1000LL + st.st_mtim.tv_nsec / 1000000LL;
    }

    // The stamp is a trigger, never a state. This is the correction that mattered: login.enc
    // persists across restarts, so treating "the file exists" or "the file is newer than
    // anything" as "signed in" reported an account while QQ sat on the login page. What actually
    // indicates a sign-in is the file being written *after* we started watching.
    //
    // The first observation only records the baseline. Every later change means a sign-in just
    // happened, and only then is a login announced.
    if (stamp != 0) {
      if (g_login_stamp == 0) {
        g_login_stamp = stamp;
      } else if (stamp != g_login_stamp) {
        g_login_stamp = stamp;
        if (found != 0) {
          g_observed_uin = found;
          do_announce_login(found);
        }
      }
    }
    ::sleep(2);
  }
  return nullptr;
}

// Writes the hook entry counts to /tmp/hz-hits.log once a second, forever.
//
// Deliberately not joined or checked on: it exists only to be read, and a payload that
// guarded its own diagnostic thread would risk failing to start over a debugging aid.
static void* hits_main(void*) {
  for (;;) {
    const int count = hz_hook_count();
    char line[256];
    int n = 0;
    // The keepalive state rides along with the hit counts: both are diagnostics that only make
    // sense read over time, and a second file would be a second thing to remember to look at.
    {
      const std::uint64_t now = monotonic_ms();
      const std::uint64_t dl = g_keepalive_deadline_ms;
      const char* state = dl == 0 ? "keepalive=none" : (now < dl ? "keepalive=live" : "keepalive=expired");
      for (const char* q = state; *q; ++q) line[n++] = *q;
      line[n++] = ' ';
      const char* pre = "hint=0x";
      for (const char* q = pre; *q; ++q) line[n++] = *q;
      const char* hex = "0123456789abcdef";
      for (int sh = 60; sh >= 0; sh -= 4) {
        line[n++] = hex[(g_login_hint >> sh) & 0xf];
      }
      line[n++] = ' ';
    }
    const char* pre = "hits";
    for (int i = 0; pre[i] != '\0'; ++i) line[n++] = pre[i];
    for (int i = 0; i < count; ++i) {
      line[n++] = ' ';
      unsigned long long v = hz_hook_hits(i);
      char num[24];
      unsigned_to_dec(static_cast<long long>(v), num, sizeof(num));
      for (int j = 0; num[j] != '\0'; ++j) line[n++] = num[j];
    }
    line[n++] = '\n';
    const int fd = ::open("/tmp/hz-hits.log", O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
    if (fd >= 0) {
      const ssize_t ignored = ::write(fd, line, static_cast<std::size_t>(n));
      (void)ignored;
      ::close(fd);
    }
    ::sleep(1);
  }
  return nullptr;
}

extern "C" int snowluma_linux_hook_start_dynamic() {
  trace("[payload] enter start_dynamic\n");
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
  trace("[payload] about to bind control\n");
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

  // Install the login hook now that the channels are up.
  //
  // Order matters: the observer writes an op-7 frame to both sockets, so a call that
  // arrived before the listeners existed would report a login nobody could hear.  It is
  // also installed after the thread starts rather than before, because a hook whose
  // observer runs on QQ's own thread must never be able to block this one.
  //
  // Failure is reported and survived.  The alternative -- refusing to start -- would
  // mean a QQ build whose login class moved takes the whole hook down, when the only
  // thing actually missing is the login signal.
  {
    const int hook_rc = hz_hook_install_login_observer(hz_login_observer);
    if (hook_rc != 0) {
      std::printf("[payload] login hook unavailable (%d): %s\n", hook_rc, hz_hook_last_error());
    } else {
      std::printf("[payload] login hook installed, module base 0x%llx\n",
                  static_cast<unsigned long long>(hz_hook_module_base()));
    }
    std::fflush(stdout);
  }

  // Heartbeat: dump the per-hook entry counts to a file once a second.
  //
  // This runs in the payload rather than in the injector because the injector cannot read
  // another process's counters. It answers the one question that mattered during the live
  // experiments and could not be answered by inspecting memory: did QQ ever reach these
  // slots? A zero here means the siting is wrong, which is a different problem from a relay
  // that was entered and did nothing.
  {
    pthread_t beat = 0;
    if (::pthread_create(&beat, nullptr, hits_main, nullptr) == 0) {
      ::pthread_detach(beat);
    }
  }

  // Watch QQ's own account directory so login state is known without hooking anything.
  {
    pthread_t watch = 0;
    if (::pthread_create(&watch, nullptr, login_dir_main, nullptr) == 0) {
      ::pthread_detach(watch);
    }
  }

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
  // Hooks come out first.  They run on QQ's own threads, so removing them while the
  // listeners are still up is safe -- an observer that fires mid-removal is already
  // re-reading state that does not change here.  The reverse order would let a frame be
  // written to a socket that has been shutdown, which drops it silently.
  hz_hook_remove_all();

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
// The observer installed on the login slot.
//
// The signature is (slot, original) only: the slot's real prototype is unknown, so this
// cannot read the uin out of an argument -- which register holds it differs per call and
// guessing corrupts the frame rather than the call.  What it can rely on is that the login
// has *completed* by the time this runs, so the uin exists in the module's own state.
//
// So it asks hz_hook_login_uin(), which reads the account out of wrapper.node; when that
// fails it announces "logged in, uin unknown" rather than a made-up number.  An invented
// uin is the one value that cannot be caught downstream: the Node side would attribute the
// session to an account that does not exist.
// Sweep observer: records that a swept slot was entered, with its slot number.
//
// Separate from the probe observer because a sweep hooks vtable slots of classes that may or may
// not be on the login path, whereas the probe hooks exports. Mixing them would make a hit
// ambiguous between the two kinds of target.
static volatile unsigned char g_sweep_seen[256];

extern "C" void hz_sweep_observer(uint32_t slot, uint64_t original) {
  (void)original;
  if (slot < 256) {
    if (g_sweep_seen[slot] != 0) return;
    g_sweep_seen[slot] = 1;
  }
  const int fd = ::open("/tmp/hz-sweep.log", O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
  if (fd < 0) return;
  char line[64];
  std::size_t n = 0;
  for (const char* q = "SWEEP HIT slot="; *q != '\0'; ++q) line[n++] = *q;
  char num[8];
  unsigned_to_dec(static_cast<long long>(slot), num, sizeof(num));
  for (int k = 0; num[k] != '\0' && n < 60; ++k) line[n++] = num[k];
  line[n++] = '\n';
  const ssize_t ig = ::write(fd, line, n);
  (void)ig;
  ::close(fd);
}

// Probe observer: records the *name* of each hooked export the first time it is entered.
//
// `hook` is the hook index, carried through the relay in its slot field. Writing the name rather
// than a count is what makes the output usable: after a login, the file lists which of the
// exported functions QQ actually called, which is the measurement that replaces guessing.
//
// Append-only and unthrottled on the first hit; a repeat hit still appends so a burst can be
// told from a single call. Never allocates -- it runs on QQ's thread inside the function it is
// observing.
// One byte per hook: has it been reported yet. Written on the first entry only.
//
// The reason is not tidiness. Some exported functions are called thousands of times a second, and
// an observer that opens, writes and closes a file on every entry turns each of those calls into
// three syscalls plus a lock -- the client stops responding and then dies. Reporting only the
// first entry gives the same answer (which exports were reached) at a cost paid once.
static volatile unsigned char g_probe_seen[256];

// Logs the four prologue words of a function about to be patched.
//
// Exists purely to make a crash during the sweep diagnosable: without it the log stops at "about
// to try <name>", and the only way to learn what was in those bytes is to reproduce the address
// offline. With it the log shows the exact instruction words, so a decision about whether the
// prologue was safe can be made from the log alone.
extern "C" void hz_note_prologue(uint64_t target, uint32_t w0, uint32_t w1, uint32_t w2,
                                 uint32_t w3) {
  const int fd = ::open("/tmp/hz-prologue.log", O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
  if (fd < 0) return;
  char line[128];
  std::size_t n = 0;
  const char* hex = "0123456789abcdef";
  auto put_hex8 = [&](uint32_t v) {
    line[n++] = '0'; line[n++] = 'x';
    for (int sh = 28; sh >= 0; sh -= 4) line[n++] = hex[(v >> sh) & 0xf];
  };
  const char* pfx = "prologue ";
  for (const char* q = pfx; *q; ++q) line[n++] = *q;
  put_hex8(static_cast<uint32_t>(target & 0xffffffffu));
  line[n++] = ':';
  const uint32_t words[4] = {w0, w1, w2, w3};
  for (int k = 0; k < 4; ++k) { line[n++] = ' '; put_hex8(words[k]); }
  line[n++] = '\n';
  const ssize_t ig = ::write(fd, line, n);
  (void)ig;
  ::close(fd);
}

// Records why a function entry was refused. Separate from the prologue log because a refusal is a
// decision, and the decision needs to be readable without the bytes.
extern "C" void hz_note_refusal(uint64_t target, int reason, uint32_t ins) {
  const int fd =
      ::open("/tmp/hz-refuse.log", O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
  if (fd < 0) return;
  char line[128];
  std::size_t n = 0;
  const char* tag = reason == 1 ? "pc-relative" : reason == 2 ? "literal-load" : "branch";
  const char* pfx = "refuse ";
  for (const char* q = pfx; *q; ++q) line[n++] = *q;
  for (const char* q = tag; *q; ++q) line[n++] = *q;
  line[n++] = ' ';
  const char* hex = "0123456789abcdef";
  line[n++] = '0'; line[n++] = 'x';
  for (int sh = 28; sh >= 0; sh -= 4) line[n++] = hex[(ins >> sh) & 0xf];
  line[n++] = '\n';
  const ssize_t ig = ::write(fd, line, n);
  (void)ig;
  ::close(fd);
}

extern "C" void hz_probe_observer(uint32_t hook, uint64_t original) {
  (void)original;
  if (hook < 256) {
    if (g_probe_seen[hook] != 0) return;
    g_probe_seen[hook] = 1;
  }
  const char* name = hz_hook_class_name(static_cast<int>(hook));
  if (name == nullptr || name[0] == '\0') return;
  const int fd =
      ::open("/tmp/hz-hit-names.log", O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
  if (fd < 0) return;
  char line[160];
  std::size_t n = 0;
  for (const char* q = "HIT "; *q != '\0'; ++q) line[n++] = *q;
  for (std::size_t k = 0; name[k] != '\0' && n < 150; ++k) line[n++] = name[k];
  line[n++] = '\n';
  const ssize_t ig = ::write(fd, line, n);
  (void)ig;
  ::close(fd);
}

extern "C" void hz_login_observer(uint32_t slot, uint64_t original) {
  (void)original;
  ++g_login_hits;
  const long long uin = hz_hook_login_uin();
  g_observed_uin = uin;
  // Record the hit in a file, not on stdout or stderr.
  //
  // The payload runs inside QQ, so fd 1 and fd 2 belong to QQ, not to whoever injected us:
  // writing there goes to QQ's own stdio, which is redirected to /dev/null or a client log.
  // An earlier version used write(2) for exactly this reason and still showed nothing, which
  // is what a working hook looks like when its diagnostics are sent to the wrong process.
  // A file is the only channel the injector can read back afterwards.
  {
    const int fd = ::open("/tmp/hz-observer.log", O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
    if (fd >= 0) {
      char line[96];
      std::size_t n = 0;
      const char* pre = "OBSERVER FIRED slot=";
      while (pre[n] != '\0') { line[n] = pre[n]; ++n; }
      line[n++] = static_cast<char>('0' + (slot / 10) % 10);
      line[n++] = static_cast<char>('0' + slot % 10);
      const char* mid = " uin=";
      for (int i = 0; mid[i] != '\0'; ++i) line[n++] = mid[i];
      char num[24];
      unsigned_to_dec(uin, num, sizeof(num));
      for (int i = 0; num[i] != '\0'; ++i) line[n++] = num[i];
      line[n++] = '\n';
      const ssize_t ignored = ::write(fd, line, n);
      (void)ignored;
      ::close(fd);
    }
  }
  if (uin > 0) {
    do_announce_login(uin);
  } else {
    // The state is real even when the number is not known yet: report the login so the
    // Node side stops waiting, and let a later re-announce (QQ does re-fire on reconnect)
    // supply the number.
    do_announce_login_unknown();
  }
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