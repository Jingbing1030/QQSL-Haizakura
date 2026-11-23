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
#include <cstdarg>
#include <cstdlib>
#include <cerrno>
#include <cstring>

// The payload's hook installation, via a C interface.  Kept as a separate translation unit
// because the engine is C++ with STL and this file must not be: see payload_hook.cc.
#include "payload_hook.h"

// std::Cr decoding and the guarded read it needs.  Its own translation unit because the
// receive-slot observer and the send-path diagnostic both have to apply the identical rule,
// and the layout is the one thing in this payload that has already killed the client twice.
#include "cr_string.h"

// Defined below, with the rest of the login state.  Declared here because start_dynamic
// installs it and appears earlier in the file; the alternative -- moving start_dynamic down
// -- would separate the exported entry points from each other.
extern "C" void hz_login_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                  uint64_t a2, uint64_t a3, uint64_t* frame);
extern "C" void hz_req_observer(uint32_t hook, uint64_t original, uint64_t a0, uint64_t a1,
                                  uint64_t a2, uint64_t a3, uint64_t* frame);
extern "C" void hz_spy_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                uint64_t a2, uint64_t a3, uint64_t* frame);
extern "C" void hz_sys_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                uint64_t a2, uint64_t a3, uint64_t* frame);
extern "C" void hz_capture_instance_observer(uint32_t slot, uint64_t original, uint64_t a0,
                                             uint64_t a1, uint64_t a2, uint64_t a3, uint64_t* frame);
extern "C" void hz_forward_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                   uint64_t a2, uint64_t a3, uint64_t* frame);
extern "C" void hz_capture_for_replay_observer(uint32_t slot, uint64_t original, uint64_t a0,
                                               uint64_t a1, uint64_t a2, uint64_t a3, uint64_t* frame);
extern "C" int hz_replay_captured_send();
extern "C" void hz_hot_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                uint64_t a2, uint64_t a3, uint64_t* frame);
extern "C" int hz_dump_hot_ring();
extern "C" void hz_cmd_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                uint64_t a2, uint64_t a3, uint64_t* frame);
extern "C" int hz_dump_cmd_ring();
extern "C" unsigned hz_cmd_detail(unsigned int* lens, unsigned char* heads);
extern "C" void hz_args_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                 uint64_t a2, uint64_t a3, uint64_t* frame);
extern "C" unsigned hz_args_dump(uint64_t* out, unsigned capacity);
extern "C" int hz_call_send_with_valid_body();
extern "C" int hz_direct_send_state();
extern "C" void hz_nested_probe_observer(uint32_t slot, uint64_t original, uint64_t a0,
                                         uint64_t a1, uint64_t a2, uint64_t a3, uint64_t* frame);
extern "C" int hz_nested_state();
extern "C" void* hz_direct_send_thread(void*);
extern "C" void hz_direct_probe_observer(uint32_t slot, uint64_t original, uint64_t a0,
                                         uint64_t a1, uint64_t a2, uint64_t a3,
                                         uint64_t* frame);
extern "C" void hz_resp_capture(std::uint64_t out_ptr);
extern "C" int hz_resp_is_ready();
extern "C" void hz_send_after(uint64_t result, uint64_t* frame);
typedef void (*hz_hook_after)(uint64_t result, uint64_t* frame);
extern "C" unsigned long long hz_after_call_count();
// The relay address for a hook installed by hz_hook_function_offset, given that call's return
// value. Needed to attach a post-call callback, because the return is an index rather than the
// trampoline address and the callback has to be registered against the relay itself.
extern "C" int hz_hook_set_after(unsigned idx, hz_hook_after after);
extern "C" std::uint64_t hz_after_out_addr();
extern "C" std::uint64_t hz_after_result();
extern "C" unsigned long long hz_resp_seq_no();
extern "C" std::size_t hz_resp_length();
extern "C" const unsigned char* hz_resp_body();
extern "C" int hz_arm_send_inject(const unsigned char* cmd, std::size_t cmd_len,
                                  const unsigned char* body, std::size_t body_len);
// The request id of the currently armed injected send, 0 when none is outstanding.
//
// Defined far below, next to the injector state, but `emit_packet` (near the top) needs it to
// stamp the recv frame with the correlation id. Declaring it here is the honest alternative to
// moving either block: the injector's state belongs with the injector, and the recv emitter
// belongs with the recv channel.
extern std::uint32_t g_inject_request_id;
// The service command the outstanding injected request was armed with, or "" when none is.
//
// The recv emitter needs this to decide whether an arriving packet answers the armed request.
// Comparing against a hard-coded "MessageSvc.PbSendMsg" was correct while that was the only
// command the payload could originate. Now that any SSO command can be forwarded on op 2, a
// literal comparison leaves every OIDB response uncorrelated (corr=0) and the Node side times
// out with no indication that the reply had in fact arrived.
extern char g_inject_request_cmd[64];
// Reply bookkeeping, defined with the injector state. The DSND branch clears these before a
// direct call so a reply captured for a previous send cannot be handed to this one.
extern std::size_t g_reply_len;
extern std::int64_t g_reply_status;
// Arms the injector and records which request id the eventual reply settles. The INJ0
// handler uses this; the diagnostic paths use the plain form because they have no waiter.
extern "C" int hz_arm_send_inject_for_request(const unsigned char* cmd, std::size_t cmd_len,
                                               const unsigned char* body, std::size_t body_len,
                                               std::uint32_t request_id);
extern "C" void hz_inject_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                   uint64_t a2, uint64_t a3, uint64_t* frame);
extern "C" unsigned long long hz_inject_fired_count();
extern "C" unsigned long long hz_inject_skipped_count();
extern "C" int hz_inject_done_flag();
// The receive slot (msf::internal::TaskManager primary vtable slot 5 = 0x407b840).
//
// Declared here because the `which` dispatch in haizakura_linux_hook_install_observer_only
// installs it and appears earlier in the file than its definition.
extern "C" void hz_recv_response_observer(uint32_t slot, uint64_t original, uint64_t a0,
                                          uint64_t a1, uint64_t a2, uint64_t a3,
                                          uint64_t* frame);
void* replay_thread_body(void*);
extern "C" int hz_send_sso(std::uint64_t instance, const char* cmd, const unsigned char* body,
                           std::size_t body_len);
// Originate a send with no trigger: calls the real send entry through the replay stub, reusing
// QQ's own instance and ctx. Declared here because the DSND op-2 branch is compiled before it.
extern "C" int hz_direct_send(const unsigned char* cmd, std::size_t cmd_len,
                              const unsigned char* body, std::size_t body_len);
std::size_t hook_index_of_offset(std::uint64_t offset);
std::uint64_t hook_replay_stub(std::size_t index);
extern "C" int haizakura_linux_hook_install_observer_only(int which);

#include <dirent.h>
#include <fcntl.h>
#include <pthread.h>
#include <poll.h>
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
extern "C" uint64_t g_msf_instance = 0;
extern "C" uint64_t g_msf_cmd_obj = 0;
extern "C" uint64_t g_msf_body_obj = 0;
extern "C" uint64_t g_msf_flag = 0;
// The x4 argument of a real send: `sendSsoInternal(this, cmd, buf, flag, ctx)`.
//
// This is the object slot 36 dereferences at `ldr x8, [x3, #0x10]` to find the response
// callback. A direct call MUST pass a live one: passing a zeroed scratch buffer made the callee
// load a null vtable and jump to it, which is what killed the client on every direct-send
// attempt. The earlier conclusion "another thread cannot call sendSsoInternal" was wrong --
// the thread was never the problem, the fabricated ctx was.
extern "C" uint64_t g_msf_ctx = 0;

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
// Second line of the marker: the paths this payload ACTUALLY bound.
//
// The Node side cannot derive them. When the derived control path is already owned by another
// live listener -- the reference implementation's own payload, which is exactly the situation
// during a side-by-side run -- this payload binds `<base>.hz.control.sock` instead, and the
// derived name then belongs to somebody else. A client that guessed would connect to the other
// payload, get plausible ACKs from it, and watch every command it sent do nothing. That failure
// looks exactly like a broken command, which is why it deserves a line in a file.
//
// Published rather than assumed: the payload is the only party that knows what it bound.
bool write_started(const char* path, long tid, const char* control, const char* recv) {
  const int fd = ::open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) return false;
  char buf[2 * sizeof(sockaddr_un::sun_path) + 128];
  const int n = ::snprintf(buf, sizeof(buf),
                           "ok pid=%d tid=%ld\ncontrol=%s\nrecv=%s\n",
                           static_cast<int>(::getpid()), tid,
                           (control != nullptr) ? control : "",
                           (recv != nullptr) ? recv : "");
  const bool good = n > 0 && ::write(fd, buf, static_cast<size_t>(n)) == n;
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
// The accepted Node-side recv connection. Declared here because write_exact (below) clears it
// when a write proves the peer is gone; defined with the rest of the recv state.
extern int g_recv_peer;

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
    //
    // Record WHY, because a dropped frame and a frame never emitted are identical from the
    // client side -- both are silence -- and they have completely different fixes. Seen in
    // practice: EPIPE/EBADF on a peer that had already disconnected, which looks exactly like
    // "the payload is not emitting anything".
    {
      const int wf = ::open("/tmp/hz-emit.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
      if (wf >= 0) {
        char wb[96];
        const int wn = std::snprintf(wb, sizeof(wb), "  write failed fd=%d errno=%d put=%llu/%llu\n",
                                     fd, errno, static_cast<unsigned long long>(put),
                                     static_cast<unsigned long long>(len));
        if (wn > 0) (void)::write(wf, wb, static_cast<std::size_t>(wn));
        ::close(wf);
      }
    }
    // A write failure is the authoritative signal that this peer is gone. Clearing it here means
    // the NEXT frame has a chance of reaching a freshly accepted connection instead of failing
    // forever against a closed descriptor -- which is what the logs showed: every op6 attempted on
    // fd 68 with errno=32 (EPIPE) while a brand-new client sat connected on another fd.
    if (n < 0 && (errno == EPIPE || errno == ECONNRESET || errno == ENOTCONN || errno == EBADF)) {
      if (g_recv_peer == fd) g_recv_peer = -1;
    }
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

// Set while the load-time constructor is starting the channels.
//
// The selector file exists to choose a diagnostic hook set for the observer-only entry. The
// constructor must not read it: the constructor's job is to bind the channels and install nothing,
// so letting it see a selector turns every load into an observer-only load that binds no sockets
// while still returning a hook error code.
static int g_ctor_binding = 0;

// The recv channel is a second listening socket, not a second connection on the first: the
// Node side opens both and expects them to be independent.  Traffic on it is one-way
// (payload -> Node), which is what the hooked recv slot needs -- a callback inside QQ cannot
// wait for a reply without stalling the client.
int g_recv_fd = -1;      // the listening socket
int g_recv_peer = -1;    // the accepted Node-side connection (declared above write_exact)
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

// One spinlock per control peer.
//
// Frames are written in up to four separate write() calls (header, cmd, msg, body), and two
// threads can reach the same fd at once: the connection's own thread answering a request, and
// broadcast_to_peers pushing a login state from QQ's thread the moment the observer fires.
// Interleaved writes from those two produce a frame whose header belongs to one message and
// whose body belongs to another -- the client then fails to parse and reports nothing, which is
// indistinguishable from a command that was never answered.
//
// A per-peer lock rather than a global one: the broadcaster must not block on a peer that is
// mid-write, and the connection thread must not wait behind a broadcast to a different peer.
static volatile int g_peer_lock[kMaxClients];

static void peer_lock(int i) {
  while (__atomic_exchange_n(&g_peer_lock[i], 1, __ATOMIC_ACQ_REL) != 0) {
    // Pause rather than spin flat out: the critical section is a few writes, and both threads
    // run on the same core often enough that a bare spin starves the holder.
#if defined(__aarch64__)
    __asm__ __volatile__("yield" ::: "memory");
#elif defined(__x86_64__)
    __asm__ __volatile__("pause" ::: "memory");
#else
    __asm__ __volatile__("" ::: "memory");
#endif
  }
}

static void peer_unlock(int i) { __atomic_store_n(&g_peer_lock[i], 0, __ATOMIC_RELEASE); }

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
// Sends one frame on a control fd, holding that peer's lock if the fd is registered.
//
// The connection thread uses this instead of calling send_frame directly. Without it the
// thread's reply and a concurrent broadcast to the same peer interleave inside one frame,
// because each frame is up to four separate write() calls (header, cmd, msg, body). The client
// then sees a header from one message and a body from another, fails to parse, and reports
// nothing -- indistinguishable from a command that was never answered.
static bool send_frame_locked(int fd, const FrameHeader& h, const char* msg, const void* body) {
  int slot = -1;
  for (int i = 0; i < kMaxClients; ++i) {
    if (__atomic_load_n(&g_control_peers[i], __ATOMIC_ACQUIRE) == fd) { slot = i; break; }
  }
  if (slot < 0) {
    // Not a registered control peer (the recv channel, or a connection being torn down).
    // Nobody else writes to those, so an unlocked write is correct rather than a compromise.
    return send_frame(fd, h, nullptr, msg, body);
  }
  peer_lock(slot);
  const bool ok = send_frame(fd, h, nullptr, msg, body);
  peer_unlock(slot);
  return ok;
}

static void broadcast_to_peers(const FrameHeader& h, const char* msg, const void* body) {
  for (int i = 0; i < kMaxClients; ++i) {
    const int fd = __atomic_load_n(&g_control_peers[i], __ATOMIC_ACQUIRE);
    if (fd < 0) continue;
    peer_lock(i);
    // Re-read under the lock: the connection may have closed between the load above and here,
    // and the fd number could since have been reused for an unrelated socket.
    if (__atomic_load_n(&g_control_peers[i], __ATOMIC_ACQUIRE) == fd) {
      send_frame(fd, h, nullptr, msg, body);
    }
    peer_unlock(i);
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

// Reports the on-disk login state on a specific fd, for a peer that just connected.
//
// Reads the same two facts as the mtime watcher: an account directory under QQ's data dir (the
// identity) and a completed auth/login.enc (the event). The difference is that this answers
// "is QQ signed in right now" rather than "did a sign-in just happen", because a peer attaching
// to an already-running client has missed every transition.
//
// Declared before its use in serve_connection and defined here next to the other login helpers so
// the three of them read as one story.
static void hz_announce_login_if_signed_in(int fd);

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

// The definition. Deliberately narrow: it looks at the same paths the watcher looks at, and it
// sends op 7 only when both an account directory and login.enc are present.
static void hz_announce_login_if_signed_in(int fd) {
  (void)fd;
  // Already announced to some earlier peer? Then there is nothing new to say, and re-sending
  // would be a second login event for one sign-in.
  if (g_logged_in != 0 && g_login_uin != 0) return;

  // The event: QQ rewrites auth/login.enc on every sign-in, so its presence means a sign-in
  // completed at some point and no later sign-out removed the credential.
  const char* home = env_or("HOME", "/app");
  char auth[512];
  int an = 0;
  for (const char* q = home; *q != '\0' && an < 500; ++q) auth[an++] = *q;
  const char* suffix = "/.config/QQ/auth/login.enc";
  for (const char* q = suffix; *q != '\0' && an < 500; ++q) auth[an++] = *q;
  auth[an] = '\0';
  struct stat st;
  {
    // Both the path and the answer, because "no login reported" has two very different causes
    // here and the reference only says "awaiting login".
    const int lfd = ::open("/tmp/hz-login-scan.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (lfd >= 0) {
      char lb[640];
      const int ln = std::snprintf(lb, sizeof(lb), "scan auth=%s stat=%d\n", auth,
                                   (::stat(auth, &st) == 0) ? 1 : 0);
      if (ln > 0) (void)::write(lfd, lb, (size_t)ln);
      ::close(lfd);
    }
  }
  if (::stat(auth, &st) != 0) return;

  // The identity: the newest qqnt_<uin> directory under QQ's data root. Same rule the watcher
  // uses -- most recently touched wins -- because readdir order is arbitrary and this container
  // has leftover qqnt_9210/9211 directories that would otherwise be reported as the account.
  char dir[512];
  an = 0;
  // The account directories live under Partitions/, not at the data root.
  //
  // Measured: /app/.config/QQ/Partitions/qqnt_10001 is the real account, with qqnt_9210
  // and qqnt_9211 left beside it from other runs. The first version looked in /.config/QQ and
  // reported nothing while QQ was fully signed in, which is the same class of error as the
  // mtime-trigger bug above: right signal, wrong path.
  const char* datas[] = {"/.config/QQ/Partitions", "/.config/QQ", "/.config/QQ/Data"};
  for (int di = 0; di < 3; ++di) {
    an = 0;
    for (const char* q = home; *q != '\0' && an < 500; ++q) dir[an++] = *q;
    for (const char* q = datas[di]; *q != '\0' && an < 500; ++q) dir[an++] = *q;
    dir[an] = '\0';
    DIR* d = ::opendir(dir);
    if (d == nullptr) continue;
    long long found = 0;
    long long best_when = -1;
    struct dirent* e;
    while ((e = ::readdir(d)) != nullptr) {
      const char* nm = e->d_name;
      if (nm[0] != 'q' || nm[1] != 'q' || nm[2] != 'n' || nm[3] != 't' || nm[4] != '_') continue;
      const char* p = nm + 5;
      if (*p < '0' || *p > '9') continue;
      long long v = 0;
      while (*p >= '0' && *p <= '9') v = v * 10 + (*p++ - '0');
      if (*p != '\0') continue;
      if (v <= 0 || v >= 4000000000LL) continue;
      char full[640];
      int fn = 0;
      for (const char* q = dir; *q != '\0' && fn < 600; ++q) full[fn++] = *q;
      if (fn < 600) full[fn++] = '/';
      for (const char* q = nm; *q != '\0' && fn < 630; ++q) full[fn++] = *q;
      full[fn] = '\0';
      struct stat es;
      if (::stat(full, &es) != 0) continue;

      // Rank by how much QQ has written into the directory, not by its mtime.
      //
      // Measured in this container: qqnt_10001 holds 114 files, the leftover test accounts
      // qqnt_9210 and qqnt_9211 hold 20 and 18 -- and 9210's mtime is *newer* than the real
      // account's, because a background process touched it after the sign-in. Ordering by mtime
      // therefore reported uin 9210 for an account that is 10001, which is the kind of
      // wrong answer that looks entirely plausible in a log line.
      //
      // File count is a property of how much QQ actually stored, so the stale directories cannot
      // outrank a real one by being touched.
      long long weight = 0;
      {
        DIR* sub = ::opendir(full);
        if (sub != nullptr) {
          struct dirent* se;
          while ((se = ::readdir(sub)) != nullptr) {
            if (se->d_name[0] == '.') continue;
            ++weight;
          }
          ::closedir(sub);
        }
      }
      if (weight > best_when) { best_when = weight; found = v; }
    }
    ::closedir(d);
    {
      const int lfd = ::open("/tmp/hz-login-scan.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
      if (lfd >= 0) {
        char lb[640];
        const int ln = std::snprintf(lb, sizeof(lb), "scan dir=%s found=%lld\n", dir,
                                     (long long)found);
        if (ln > 0) (void)::write(lfd, lb, (size_t)ln);
        ::close(lfd);
      }
    }
    if (found != 0) {
      g_observed_uin = found;
      do_announce_login(found);
      return;
    }
  }
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
  // Announce ourselves immediately, before waiting to be asked.
  //
  // This is the difference that made the reference unable to connect at all, and it took several
  // rounds to see because every hand-written client masked it: our own test clients send a hello
  // first, so a payload that only answers looked correct. The reference never sends one -- it
  // connects, then awaits our hello, and only then starts talking. Against a payload that waits
  // for a request, both sides wait forever and the reference reports phase=handshake after 60 s.
  //
  // Measured: 3633 accepts and 3633 connection threads, zero frames parsed. Nothing was broken
  // in accept, threading, or the peer table -- nobody had said hello.
  //
  // The delay is deliberate; see the note on the recv channel.
  ::usleep(50000);
  {
    const std::size_t len = std::strlen(pipe_path);
    const FrameHeader hello = make_header(
        kOpHello, 0, 0, 0, 0, static_cast<std::uint32_t>(len), 0,
        static_cast<std::uint64_t>(pid));
    if (!send_frame_locked(fd, hello, pipe_path, nullptr)) return;
    {
      const int lfd = ::open("/tmp/hz-hello.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
      if (lfd >= 0) {
        char lb[128];
        const int ln = std::snprintf(lb, sizeof(lb), "sent hello fd=%d msgLen=%zu\n", fd, len);
        if (ln > 0) (void)::write(lfd, lb, (size_t)ln);
        ::close(lfd);
      }
    }
  }
  // Then report the current login state, if QQ is already signed in.
  //
  // The mtime trigger below is right for a sign-in that happens while we watch, and useless for
  // one that happened before we attached -- which is the normal case, because the payload is
  // injected into a client the user has already logged into by hand. Without this the reference
  // sat at "awaiting login" indefinitely while QQ was fully signed in: the observer never fired,
  // the stamp never changed, and no op 7 was ever written.
  //
  // The state is read from the same two facts as the trigger -- an account directory to be
  // signed into and auth/login.enc to prove a sign-in completed -- so this reports only what is
  // actually on disk, never a guess.
  hz_announce_login_if_signed_in(fd);

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
    // Read the body rather than skipping it.
    //
    // It used to be drained through a 512-byte sink because nothing consumed it. SEND does: its
    // body is the SSO packet to hand to QQ, so skipping it made the command structurally unable
    // to work. The bound is the frame limit the header check already enforces.
    char* body = nullptr;
    if (h.body_len != 0) {
      body = static_cast<char*>(std::malloc(h.body_len));
      if (body == nullptr) return;
      if (!read_exact(fd, body, h.body_len)) { std::free(body); return; }
    }

    std::printf("[payload] frame op=%u request_id=%u status=%d flags=0x%x "
                "cmd=\"%s\" msg=\"%s\" value0=%llu\n",
                h.op, h.request_id, h.status, h.flags, cmd, msg,
                static_cast<unsigned long long>(h.value0));
    {
      // Every inbound frame, to a file. stdout belongs to QQ, so a frame that was parsed but
      // answered on a broken path leaves no trace there -- which is exactly the state this
      // payload was in for several rounds: hello and op 7 arrived, and a request with a cmd
      // produced nothing at all.
      const int dfd = ::open("/tmp/hz-frames.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
      if (dfd >= 0) {
        char dl[160];
        const int dn = snprintf(dl, sizeof(dl), "in op=%u req=%u cmdlen=%u cmd=%s msg=%s\n",
                                h.op, h.request_id, h.cmd_len, cmd, msg);
        if (dn > 0) (void)::write(dfd, dl, (size_t)((dn < (int)sizeof(dl)) ? dn : (int)sizeof(dl)));
        ::close(dfd);
      }
    }
    std::fflush(stdout);

    if (h.op == kOpHello) {
      // Answer with our own hello.  The Node side resolves its connect promise on
      // this frame and reports the pipe connected; without it the connection
      // times out in phase=waiting_channel.
      //
      // The same 50 ms delay as the recv channel, for the same reason: the reference installs
      // its resolver after the connect settles, and a hello that arrives before that is read and
      // thrown away. Here it matters less because we only answer after being asked -- but the
      // ask can come from a client that registers late as well.
      ::usleep(50000);
      const std::size_t len = std::strlen(pipe_path);
      const FrameHeader reply = make_header(
          kOpHello, 0, 0, 0, 0, static_cast<std::uint32_t>(len), 0,
          static_cast<std::uint64_t>(pid));
      if (!send_frame_locked(fd, reply, pipe_path, nullptr)) return;

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
        if (!send_frame_locked(fd, waiting, nullptr, nullptr)) return;
        continue;
      }
      char uin_text[24];
      unsigned_to_dec(g_observed_uin, uin_text, sizeof(uin_text));
      const FrameHeader logged = make_header(
          kOpLoginState, 0, 1, kFlagLoggedIn, 0,
          static_cast<std::uint32_t>(std::strlen(uin_text)), 0,
          static_cast<std::uint64_t>(g_observed_uin));
      if (!send_frame_locked(fd, logged, uin_text, nullptr)) return;
      continue;
    }

    // op 2 with a service command name: a real send over QQ's own connection.
    //
    // This is the shape the reference implementation uses and the one the goal asked about. The
    // command is a service name such as "MessageSvc.PbSendMsg", not an action name -- translating
    // send_group_msg into a service command and a protobuf body happens on the Node side. The body
    // is a bare protobuf message, and the reply is that command's response body.
    //
    // It works by substitution rather than by calling sendSsoInternal ourselves (MEMORY 2.3ah):
    // that function is entered whenever QQ sends, so the injector arms with this body and QQ's own
    // next send carries it, on QQ's thread, with the connection state touched once.
    //
    // Only commands the injector can actually carry are accepted. A body that is not a valid
    // MessageSvc.PbSendMsg makes the callee parse garbage and kills the client -- that is measured,
    // not feared -- so the command is checked rather than trusted.
    if (h.op == kOpRequest && h.cmd_len == 20 &&
        std::memcmp(cmd, "MessageSvc.PbSendMsg", 20) == 0 && h.body_len > 0) {
      static const unsigned char kNoCmd[1] = {0};
      const int rc = hz_arm_send_inject_for_request(
          kNoCmd, 0, reinterpret_cast<const unsigned char*>(body),
          static_cast<std::size_t>(h.body_len), h.request_id);
      // The reply is the send's own result. It cannot be produced here, because the body has not
      // been transmitted yet -- it will leave on QQ's next send. Reporting success at this point
      // would be reporting something that has not happened, so this answers with a distinct code
      // meaning "armed, outcome unknown" and the response body arrives when the injector fires.
      const FrameHeader ack =
          make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, static_cast<std::uint64_t>(rc));
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      if (body != nullptr) std::free(body);
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
          make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, static_cast<std::uint64_t>(rc));
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
      const FrameHeader ack = make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0,
                                          static_cast<std::uint64_t>(before - after));
      // Diagnostic: the reply is suppressed when the peer table looks empty, which is
      // indistinguishable on the wire from a command that was never dispatched.
      {
        const int dfd = ::open("/tmp/hz-peer.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
        if (dfd >= 0) {
          char dl[96];
          const int dn = snprintf(dl, sizeof(dl), "unhook: peers=%d before=%d after=%d\n",
                                  (int)g_control_peer_count, before, after);
          if (dn > 0) (void)::write(dfd, dl, (size_t)dn);
          ::close(dfd);
        }
      }
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      continue;
    }

    // Read -- never write -- the object a packet send carries, so its layout can be learned from
    // a real call instead of guessed from a disassembly of a 144 MB binary.
    //
    // `MSG*` matched to the same place as PROBE, so this is the same dispatch with a different
    // needle. The addresses that matter on the reference's side are exported:
    //   MSFSDK::sendPacket(Cr::unique_ptr<MSFRequest>)  0x412b328  size 400
    //   MSFSDK::pack      (Cr::unique_ptr<MSFRequest>)  0x412b7f8  size 548
    //   MSFSDK::unpack    (unique_ptr<Cr::string>, ...)  0x412ba58  size 112
    // all comfortably past the 16-byte patch floor.
    //
    // The callback receives whatever the send path holds, and the payload's job here is only to
    // record it. Constructing an MSFRequest is a separate problem: the type's constructor is not
    // exported, and the pointer types are QQ's own std::Cr, not std::, so the layout cannot be
    // assumed. Observation is safe; fabrication is not.
    if (h.op == kOpRequest && h.cmd_len == 3 && cmd[0] == 'S' && cmd[1] == 'P' &&
        cmd[2] == 'Y') {
      const int rc = hz_hook_exports_matching_with(
          (h.msg_len > 0) ? msg : "sendPacket", 4, hz_spy_observer);
      const FrameHeader ack =
          make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, static_cast<std::uint64_t>(rc));
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      continue;
    }

    // Total hits across every installed hook, plus the busiest single hook.
    //
    // Without this the only way to tell "installed but never called" from "called" is to read a
    // log file from outside, and the two states produce identical wire traffic. That ambiguity
    // has already cost a round: a probe that installed cleanly and never fired looks exactly
    // like one that is working.
    // Hook a vtable slot named by (module offset, slot index) instead of by symbol.
    //
    // This exists because the entry that actually matters has no dynamic symbol. The reference
    // payload's own diagnostics print the coordinates it uses:
    //
    //   trunk: nt::MSFService primary vtable off=0x87173e8 slots=44
    //   trunk: slot 36 currently 0x...ceb8 (offset 0x137ceb8)
    //
    // Neither `nt::MSFService` nor its virtual functions appear in .dynsym -- only the 79
    // MSF::MSFSDK members do -- so dlsym cannot reach them and hooking by name is not an option.
    // The offset is the only handle available, and it is what the reference itself relies on.
    //
    // Calls sendSsoInternal directly, using the instance captured from a real send.
    //
    // Wire format: cmd is "SEND", `value0` carries the instance pointer, msg is the SSO command
    // name, and body is the packet to send. This exists so the send path can be exercised from the
    // Node side with an arbitrary command, which is the whole point: once this works, the payload
    // can service MessageSvc.PbSendMsg itself instead of answering with an error.
    if (h.op == kOpRequest && h.cmd_len == 4 && cmd[0] == 'S' && cmd[1] == 'E' &&
        cmd[2] == 'N' && cmd[3] == 'D') {
      const int rc = hz_send_sso(h.value0, (h.msg_len > 0) ? msg : "",
                                 reinterpret_cast<const unsigned char*>(body),
                                 static_cast<std::size_t>(h.body_len));
      const FrameHeader ack =
          make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, static_cast<std::uint64_t>(rc));
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      if (body != nullptr) std::free(body);
      continue;
    }

    // Dumps the hot-path ring. Wire format: cmd "DUMP", no arguments.
    //
    // The ring is filled by hz_hot_observer, which may only do register-level work, so reading it
    // has to happen somewhere else. This command is that somewhere else: it runs on the control
    // channel, where a file write costs nothing that matters.
    if (h.op == kOpRequest && h.cmd_len == 4 && cmd[0] == 'D' && cmd[1] == 'U' &&
        cmd[2] == 'M' && cmd[3] == 'P') {
      const int rc = hz_dump_hot_ring();
      const FrameHeader ack =
          make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, static_cast<std::uint64_t>(rc));
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      if (body != nullptr) std::free(body);
      continue;
    }

    // Direct send: originate `MessageSvc.PbSendMsg` ourselves. Wire format: cmd "DSND", body is
    // the raw request encoding. No trigger, no substitution -- this is the production path.
    //
    // Requires that one real send has been seen since the payload was installed, so that a
    // genuine instance pointer and ctx are in hand. That is not a workaround: both are QQ-allocated
    // objects whose layout this payload must not invent, and the two crashes that used to make
    // "direct send is impossible" look true were both caused by inventing them.
    //
    // The reply comes back on the recv channel as an ordinary op 6 packet, correlated by
    // `emit_packet` using the request id armed here -- so this arms the correlation before
    // calling, exactly like INJ0 does.
    if (h.op == kOpRequest && h.cmd_len == 4 && cmd[0] == 'D' && cmd[1] == 'S' &&
        cmd[2] == 'N' && cmd[3] == 'D') {
      static const char kDirectCmd[] = "MessageSvc.PbSendMsg";
      std::memset(g_inject_request_cmd, 0, sizeof(g_inject_request_cmd));
      std::memcpy(g_inject_request_cmd, kDirectCmd, sizeof(kDirectCmd) - 1);
      g_inject_request_id = h.request_id;
      g_reply_len = 0;
      g_reply_status = 0;
      const int rc = hz_direct_send(
          reinterpret_cast<const unsigned char*>(kDirectCmd),
          sizeof(kDirectCmd) - 1, reinterpret_cast<const unsigned char*>(body),
          static_cast<std::size_t>(h.body_len));
      // A non-zero rc means the call never happened, so nobody will ever answer this request id.
      // Clear it rather than leave a stale correlation that would mis-stamp an unrelated packet.
      if (rc != 0) g_inject_request_id = 0;
      const FrameHeader ack =
          make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, static_cast<std::uint64_t>(rc));
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      if (body != nullptr) std::free(body);
      continue;
    }

    // Arms the send injector with an encoded request. Wire format: cmd "INJ0", body is the raw
    // MessageSvc.PbSendMsg encoding from ts/src/send-message-request.ts.
    //
    // The command name and its inline SSO header are constructed here rather than sent from
    // Node, because they are a property of the encoding the payload uses, not of the message:
    // inline libc++ string, flag byte (len<<1) with LSB CLEAR, characters at +1. Keeping that in
    // one place means the Node side cannot disagree with the payload about it.
    //
    // The `| 1u` that used to be here selected libc++'s LONG form instead, which made the
    // cmd_len==20 branch read a bogus pointer out of the object. See hz_send_sso for the full
    // explanation; this is the same bit.
    if (h.op == kOpRequest && h.cmd_len == 4 && cmd[0] == 'I' && cmd[1] == 'N' &&
        cmd[2] == 'J' && cmd[3] == '0') {
      static const char kCmd[] = "MessageSvc.PbSendMsg";
      unsigned char cmd_obj[32];
      std::memset(cmd_obj, 0, sizeof(cmd_obj));
      const std::size_t kLen = sizeof(kCmd) - 1;  // 20
      cmd_obj[0] = static_cast<unsigned char>(kLen << 1);
      std::memcpy(cmd_obj + 1, kCmd, kLen);
      const int rc = hz_arm_send_inject_for_request(
          cmd_obj, kLen + 1, reinterpret_cast<const unsigned char*>(body),
          static_cast<std::size_t>(h.body_len), h.request_id);
      const FrameHeader ack =
          make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, static_cast<std::uint64_t>(rc));
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      if (body != nullptr) std::free(body);
      continue;
    }

    // The `[obj+0x30]` six-slot-table probe. Wire format: cmd "NTS", no arguments.
    //
    // This answers a question the goal has carried unanswered: `nt::wrapper::INTSessionShell::
    // CreateNTSessionShell` is a real export that returns a 0x38 struct via the sret convention
    // (x8 hidden pointer; internal builder 0x8ff298 allocates 0xa00 bytes with a sub-object at
    // +0x20). The claim to test is that the table at [obj+0x30] holds a genuine send entry point,
    // which would be a way to send without hijacking anything.
    //
    // Probing it requires actually constructing the shell, which needs a live session, so this
    // reports what it can and says so plainly when it cannot proceed. A probe that called the
    // constructor without a session would fault inside QQ and take the client down, which is the
    // opposite of useful.
    if (h.op == kOpRequest && h.cmd_len == 3 && cmd[0] == 'N' && cmd[1] == 'T' && cmd[2] == 'S') {
      char text[512];
      int n = 0;
      std::uint64_t addr = 0, base = 0;
      std::uint32_t words[4] = {0, 0, 0, 0};
      const int rc = hz_find_create_session_shell(&addr, &base, words);
      if (rc == -2) {
        n = ::snprintf(text, sizeof(text), "wrapper.node not mapped");
      } else if (rc == -3) {
        n = ::snprintf(text, sizeof(text), "CreateNTSessionShell not in .dynsym (base=0x%llx)",
                       static_cast<unsigned long long>(base));
      } else if (rc != 0) {
        n = ::snprintf(text, sizeof(text), "probe failed rc=%d", rc);
      } else {
        n = ::snprintf(text, sizeof(text),
                       "CreateNTSessionShell=0x%llx (base+0x%llx) words=%08x %08x %08x %08x "
                       "CALLED=no",
                       static_cast<unsigned long long>(addr),
                       static_cast<unsigned long long>(addr - base), words[0], words[1],
                       words[2], words[3]);
      }
      if (n > 0) {
        const FrameHeader rep = make_header(kOpReply, h.request_id, 0, 0, 0, 0,
                                            static_cast<std::uint64_t>(n),
                                            static_cast<std::uint64_t>(n));
        if (g_control_peer_count > 0) broadcast_to_peers(rep, text, text);
      }
      if (body != nullptr) std::free(body);
      continue;
    }

    // Identity probe. Wire format: cmd "HZID", no arguments.
    //
    // This exists because a path can be rebound underneath an already-established connection, so
    // "something answered on control.sock" proves nothing about *which* instance answered. The
    // reply carries a literal that only this build contains, which makes the question decidable:
    // if the text is not this string, the peer is not this payload.
    //
    // A payload that cannot answer this unambiguously is worse than one that does not listen at
    // all, because every later measurement silently describes someone else's channel.
    if (h.op == kOpRequest && h.cmd_len == 4 && cmd[0] == 'H' && cmd[1] == 'Z' &&
        cmd[2] == 'I' && cmd[3] == 'D') {
      const char* id = "haizakura-sendpath-c36";
      const int n = static_cast<int>(std::strlen(id));
      const FrameHeader rep =
          make_header(kOpReply, h.request_id, 0, 0, 0, 0, static_cast<std::uint64_t>(n),
                      static_cast<std::uint64_t>(n));
      if (g_control_peer_count > 0) broadcast_to_peers(rep, id, id);
      static_cast<void>(id);
      if (body != nullptr) std::free(body);
      continue;
    }

    // Reports the injector's counters. Wire format: cmd "INJS", no arguments.
    if (h.op == kOpRequest && h.cmd_len == 4 && cmd[0] == 'I' && cmd[1] == 'N' &&
        cmd[2] == 'J' && cmd[3] == 'S') {
      const std::uint64_t fired = static_cast<std::uint64_t>(hz_inject_fired_count());
      const std::uint64_t skipped = static_cast<std::uint64_t>(hz_inject_skipped_count());
      const std::uint64_t done = static_cast<std::uint64_t>(hz_inject_done_flag());
      const FrameHeader ack = make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, fired);
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      // The other two travel as a reply so a single call reports all three counters.
      // The after-callback counters are reported alongside the injector's, because they answer the
      // question the injector's do not: whether the reply was ever observed. A successful
      // substitution with after_calls == 0 means the post-call path is not wired up, which looks
      // identical to "the server never replied" if only the injector counters are visible.
      char text[224];
      const int n = ::snprintf(text, sizeof(text),
                               "fired=%llu skipped=%llu done=%llu after=%llu resp_len=%llu "
                               "resp_ready=%llu",
                               static_cast<unsigned long long>(fired),
                               static_cast<unsigned long long>(skipped),
                               static_cast<unsigned long long>(done),
                               static_cast<unsigned long long>(hz_after_call_count()),
                               static_cast<unsigned long long>(hz_resp_length()),
                               static_cast<unsigned long long>(hz_resp_is_ready()));
      if (n > 0 && g_control_peer_count > 0) {
        const FrameHeader rep =
            make_header(kOpReply, h.request_id, 0, 0, 0, 0, static_cast<std::uint64_t>(n),
                        static_cast<std::uint64_t>(n));
        broadcast_to_peers(rep, text, text);
      }
      if (body != nullptr) std::free(body);
      continue;
    }

    // Wire format: msg is 8 ASCII hex digits of the module offset, then a space, then the
    // decimal slot index. Example: "087173e8 36". Params travel in msg rather than body because
    // body is drained before dispatch.
    if (h.op == kOpRequest && h.cmd_len == 4 && cmd[0] == 'S' && cmd[1] == 'L' &&
        cmd[2] == 'O' && cmd[3] == 'T' && h.msg_len >= 10) {
      const char* p = msg;
      std::uint64_t off = 0;
      bool ok = true;
      for (int i = 0; i < 8; ++i) {
        const char c = p[i];
        std::uint64_t d = 0;
        if (c >= '0' && c <= '9') d = static_cast<std::uint64_t>(c - '0');
        else if (c >= 'a' && c <= 'f') d = static_cast<std::uint64_t>(c - 'a' + 10);
        else if (c >= 'A' && c <= 'F') d = static_cast<std::uint64_t>(c - 'A' + 10);
        else { ok = false; break; }
        off = (off << 4) | d;
      }
      std::uint32_t slot = 0;
      if (ok && p[8] == ' ') {
        for (int i = 9; i < h.msg_len && p[i] >= '0' && p[i] <= '9'; ++i) {
          slot = slot * 10u + static_cast<std::uint32_t>(p[i] - '0');
        }
      } else {
        ok = false;
      }
      std::int64_t result = -1;
      if (ok) {
        // Parse /proc/self/maps here rather than calling into payload_hook.
  //
  // That path has faulted twice inside a hand-mapped module, and this diagnostic is the one
  // place where a failure would be silent and expensive: it decides whether the send surface is
  // even reachable. Self-contained code makes the answer trustworthy.
  std::uint64_t base = 0;
  {
    const int mfd = ::open("/proc/self/maps", O_RDONLY | O_CLOEXEC);
    if (mfd >= 0) {
      char* mbuf = static_cast<char*>(::malloc(1u << 20));
      if (mbuf != nullptr) {
        std::size_t msize = 0;
        for (;;) {
          if (msize >= (1u << 20) - 1) break;
          const ssize_t mn = ::read(mfd, mbuf + msize, (1u << 20) - 1 - msize);
          if (mn <= 0) break;
          msize += static_cast<std::size_t>(mn);
        }
        mbuf[msize] = '\0';
        const char* needle = "wrapper.node";
        char* line = mbuf;
        while (line < mbuf + msize) {
          char* eol = line;
          while (eol < mbuf + msize && *eol != '\n') ++eol;
          *eol = '\0';
          bool has = false;
          for (char* q = line; *q != '\0'; ++q) {
            if (q[0] == 'w' && q[1] == 'r' && q[2] == 'a' && q[3] == 'p' && q[4] == 'p' &&
                q[5] == 'e' && q[6] == 'r' && q[7] == '.') { has = true; break; }
          }
          if (has) {
            std::uint64_t lo = 0;
            bool ok = false;
            for (char* q = line; *q != '\0'; ++q) {
              if (*q == '-') { ok = true; break; }
              lo <<= 4;
              if (*q >= '0' && *q <= '9') lo |= static_cast<std::uint64_t>(*q - '0');
              else if (*q >= 'a' && *q <= 'f') lo |= static_cast<std::uint64_t>(*q - 'a' + 10);
              else { ok = false; break; }
            }
            if (ok && lo != 0 && (base == 0 || lo < base)) base = lo;
          }
          line = eol + 1;
        }
        ::free(mbuf);
      }
      ::close(mfd);
    }
  }
  (void)0;
  {
    // Two-step diagnostic: distinguish "the lookup is broken" from "the module name is wrong".
    const int dfd = ::open("/tmp/hz-msf.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (dfd >= 0) {
      char db[128];
      const int dn = std::snprintf(db, sizeof(db), "probe: base=0x%llx\n",
                                   (unsigned long long)base);
      if (dn > 0) (void)::write(dfd, db, (size_t)dn);
      ::close(dfd);
    }
  }
        if (base == 0) {
          result = -2;
        } else {
          // The caller passes a file offset; the vtable lives at base + offset because the
          // first PT_LOAD has vaddr == offset.
          const std::uint64_t vt = base + off;
          const int idx = hz_hook_vtable_slot(vt, slot, hz_spy_observer);
          result = static_cast<std::int64_t>(idx);
        }
      }
      const FrameHeader ack =
          make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, static_cast<std::uint64_t>(result));
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      continue;
    }

    if (h.op == kOpRequest && h.cmd_len == 3 && cmd[0] == 'H' && cmd[1] == 'D' &&
        cmd[2] == 'L') {
      unsigned long long total = 0;
      unsigned long long busiest = 0;
      const int count = hz_hook_count();
      for (int i = 0; i < count; ++i) {
        const unsigned long long n = hz_hook_hits(i);
        total += n;
        if (n > busiest) busiest = n;
      }
      const FrameHeader ack = make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, total);
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      // The busiest count rides in `status`, which the ACK path otherwise leaves zero, so one
      // round trip answers both questions.
      const FrameHeader detail = make_header(kOpReply, h.request_id, (std::int32_t)busiest, 0,
                                             0, 0, 0, (std::uint64_t)count);
      if (g_control_peer_count > 0) broadcast_to_peers(detail, nullptr, nullptr);
      continue;
    }

    if (h.op == kOpRequest && h.cmd_len == 5 && cmd[0] == 'P' && cmd[1] == 'R' &&
        cmd[2] == 'O' && cmd[3] == 'B' && cmd[4] == 'E') {
      const int got = hz_hook_all_exports(200);
      const FrameHeader ack =
          make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, static_cast<std::uint64_t>(got));
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      continue;
    }

    // Hook a few slots on every nt::login class so the entry counter can say which one a real
    // sign-in reaches. Driven over the socket because the payload reads QQ's environment, not
    // the injector's, and an already-running process cannot have that changed.
    // Hook MSFSDK::pack and dump each request it is handed.
    //
    // This is the cheapest way to learn what a real send carries: the reference has already
    // filled every field by the time pack sees the object, so no construction is needed and no
    // layout has to be guessed blind.
    if (h.op == kOpRequest && h.cmd_len == 3 && cmd[0] == 'R' && cmd[1] == 'E' &&
        cmd[2] == 'Q') {
      const int got = hz_hook_exports_matching_with("MSFSDK4pack", 2, hz_req_observer);
      const FrameHeader ack =
          make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, static_cast<std::uint64_t>(got));
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      continue;
    }

    if (h.op == kOpRequest && h.cmd_len >= 5 && cmd[0] == 'S' && cmd[1] == 'W' &&
        cmd[2] == 'E' && cmd[3] == 'E' && cmd[4] == 'P') {
      const int got = hz_hook_sweep_login_classes(3);
      const FrameHeader ack =
          make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, static_cast<std::uint64_t>(got));
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
        if (!send_frame_locked(fd, bad, nullptr, nullptr)) return;
        continue;
      }
      g_login_hint = h.value0;
      g_keepalive_deadline_ms = monotonic_ms() + 60000ull;
      const FrameHeader ack = make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, 0);
      if (!send_frame_locked(fd, ack, nullptr, nullptr)) return;
      std::printf("[payload] login hint accepted: 0x%llx, keepalive %llums\n",
                  static_cast<unsigned long long>(h.value0), 60000ull);
      std::fflush(stdout);
      continue;
    }

    // op 2, the send channel: hand the command and body to QQ, then answer.
    //
    // This is the one place the rewrite has to do something the reference did not. Measured
    // facts behind that claim (see docs and MEMORY 2.3b/2.3c):
    //
    //   * send@plt has exactly two call sites in the reference library (0xf7c8, 0x12b64) and
    //     both write to the Node-side descriptor. It contains no path to QQ's servers.
    //   * The function those wrap (0x12be8) takes four stack buffers and is called only from
    //     the 0xfd4c request handler.
    //   * MessageSvc.PbSendMsg appears once (0x1e44c) and that site is a string::compare that
    //     stores a pointer -- a lookup, not a send.
    //
    // So "does the reference send?" is settled: it forwards. Which means a rewrite that wants
    // to send has to acquire the capability, not reproduce it. Until that path exists, telling
    // the caller the truth is strictly better than an empty ACK that reads as success.
    //
    // Commands on the reference's whitelist: accept with an empty ACK and, if the peer
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
      if (!send_frame_locked(fd, accepted, nullptr, nullptr)) return;
      // The reference masks the inbound flags down to bit 0 before deciding, and only then
      // sends op 4.
      if ((h.flags & kFlagWantReply) != 0) {
        const FrameHeader replied = make_header(kOpReply, h.request_id, 0, 0, 0, 0, 0, 0);
        if (!send_frame_locked(fd, replied, nullptr, nullptr)) return;
      }
      std::printf("[payload] op2 accepted (whitelisted): cmd=\"%s\"\n", cmd);
      std::fflush(stdout);
      continue;
    }

    // Generic SSO forwarding: any `OidbSvcTrpcTcp.*` / `<Service>.<Method>` command.
    //
    // This is the branch that makes the 222 OneBot actions usable. Everything above it is
    // special-cased (DSND, INJ0, NTS) because it needed to be; this one is the general case.
    //
    // Wire format: the command name is the frame's `cmd`, and the body is the request protobuf
    // exactly as the caller encoded it. The reply arrives on the recv channel as an ordinary op 6
    // packet, correlated by the request id armed here -- the same mechanism DSND and INJ0 use.
    //
    // Why this was previously refused: op 2 used to fall through to a single exit that answered
    // status 3 ("could not prepare the request"), because the reference payload has no success
    // path and no send capability. That is a fact about the REFERENCE binary, not about what is
    // possible: `hz_direct_send` below calls QQ's own send entry through the replay stub and has
    // been doing so since the DSND path landed. The refusal outlived its reason.
    //
    // The two guards that remain are not policy:
    //   * the captured instance/ctx must exist, because a fabricated ctx is a null jump on QQ's
    //     thread (measured, twice). `hz_direct_send` refuses without them.
    //   * the command must fit the inline libc++ string (<= 31 bytes after the flag byte),
    //     which is a hard ABI limit, not a choice.
    if (h.op == kOpRequest && !is_reference_whitelisted_cmd(cmd, h.cmd_len) && h.cmd_len > 0 &&
        h.body_len > 0) {
      // A NUL-terminated copy: hz_direct_send takes `const unsigned char*` and calls strlen.
      // The frame's cmd is length-delimited and not guaranteed terminated.
      char service_cmd[64];
      const std::size_t copy_len = (h.cmd_len < sizeof(service_cmd) - 1) ? h.cmd_len
                                                                        : sizeof(service_cmd) - 1;
      std::memcpy(service_cmd, cmd, copy_len);
      service_cmd[copy_len] = '\0';

      std::memset(g_inject_request_cmd, 0, sizeof(g_inject_request_cmd));
      std::memcpy(g_inject_request_cmd, service_cmd, copy_len);
      g_inject_request_id = h.request_id;
      g_reply_len = 0;
      g_reply_status = 0;
      const int rc = hz_direct_send(reinterpret_cast<const unsigned char*>(service_cmd),
                                   copy_len, reinterpret_cast<const unsigned char*>(body),
                                   static_cast<std::size_t>(h.body_len));
      // A non-zero rc means the call never happened, so nobody will answer this request id.
      // Clearing it stops a stale correlation from mis-stamping an unrelated recv packet.
      if (rc != 0) {
        g_inject_request_id = 0;
        g_inject_request_cmd[0] = '\0';
      }
      const FrameHeader ack =
          make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, static_cast<std::uint64_t>(rc));
      if (g_control_peer_count > 0) broadcast_to_peers(ack, nullptr, nullptr);
      if (body != nullptr) std::free(body);
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
      if (!send_frame_locked(fd, ack, nullptr, nullptr)) return;

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
      if (!send_frame_locked(fd, failed, detail, nullptr)) return;
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
  {
    // First line of the connection thread. If /tmp/hz-accept.log shows a create but this file
    // stays empty, the thread never got scheduled; if it shows up but the client still sees
    // nothing, the read loop is exiting before it answers.
    const int dfd = ::open("/tmp/hz-conn.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (dfd >= 0) {
      const char* m = "conn thread entered\n";
      std::size_t mn = 0;
      while (m[mn] != '\0') ++mn;
      (void)::write(dfd, m, mn);
      ::close(dfd);
    }
  }
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
  write_started(a->started, static_cast<long>(::syscall(SYS_gettid)), a->control,
                (g_recv_path[0] != '\0') ? g_recv_path : nullptr);

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
      //
      // Logged because this is silent otherwise, and it is the one failure here that looks
      // exactly like "the reference never connects": its connect() succeeds (the kernel accepts
      // into the backlog), the fd is closed microseconds later, and the client sees a reset
      // rather than a hang. Sixteen un-reaped peers is enough to put it in that state.
      {
        const int lfd = ::open("/tmp/hz-full.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
        if (lfd >= 0) {
          char lb[64];
          const int ln = std::snprintf(lb, sizeof(lb), "table full, closing fd=%d\n", fd);
          if (ln > 0) (void)::write(lfd, lb, (size_t)ln);
          ::close(lfd);
        }
      }
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
    const int crc = ::pthread_create(&th, nullptr, conn_thread_main, conn);
    {
      // Diagnostic for "the socket accepts but answers nothing": without it an accept that
      // succeeds and a thread that never starts look identical from the client, and the failure
      // happens inside the target where stdout goes to QQ.
      const int dfd = ::open("/tmp/hz-accept.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
      if (dfd >= 0) {
        char dl[96];
        const int dn = snprintf(dl, sizeof(dl), "accept fd=%d pthread_create rc=%d\n", fd, crc);
        if (dn > 0) (void)::write(dfd, dl, (size_t)dn);
        ::close(dfd);
      }
    }
    if (crc == 0) {
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

    // Log every recv accept. The reference's connectAll awaits control before it even starts
    // the recv connection, and its handshake kept expiring with zero recv connections
    // established -- which is either "we never accepted it" or "it never dialled". From inside
    // QQ those look identical, and only the accept side can tell them apart.
    {
      const int dfd = ::open("/tmp/hz-recv.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
      if (dfd >= 0) {
        char dl[80];
        const int dn = snprintf(dl, sizeof(dl), "recv accept peer=%d\n", peer);
        if (dn > 0) (void)::write(dfd, dl, (size_t)dn);
        ::close(dfd);
      }
    }

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
    // Delay the hello, and delay it for the *control* channel too.
    //
    // The reference registers its hello resolver one await after the connect resolves:
    //
    //     const socket = await this.connectSocket(...);   // connect settles here
    //     const hello  = await this.waitForHello(kind);   // resolver only exists now
    //
    // Anything arriving in between is dropped -- resolveHello() finds a null resolver and
    // returns. A payload that answers in microseconds lands inside that window every time, so
    // the hello is sent, received by the kernel, read by FrameReader, and silently discarded.
    // The reference then waits out its full 60 s and reports phase=handshake, which reads as
    // "the payload never answered" even though it did.
    //
    // 50 ms is far longer than the gap and far shorter than any timeout.
    ::usleep(50000);
    {
      const std::size_t len = std::strlen(recv_path_for_hello);
      const FrameHeader hello = make_header(
          kOpHello, 0, 0, 0, 0, static_cast<std::uint32_t>(len), 0,
          static_cast<std::uint64_t>(::getpid()));
      // send_frame is (fd, header, cmd, msg, body) -- five parameters, and the frame header's
      // lengths must match what is actually written in that order. This call used to pass four
      // (nullptr, recv_path_for_hello, nullptr), which shifted everything by one position: cmd
      // came out null while msg_len was non-zero, so the write of len bytes pulled from msg==null
      // and was refused, and the peer got the 40-byte header of a frame whose body never arrived.
      //
      // The reference then sat in phase=hello until its 60 s timeout. From its side that is
      // indistinguishable from "the payload never answered" -- which is exactly how it was read
      // for several rounds, and why the recv channel was twice declared broken when it was not.
      send_frame(peer, hello, nullptr, recv_path_for_hello, nullptr);
    }

    std::printf("[payload] recv peer connected (fd=%d)\n", peer);
    std::fflush(stdout);
    // Keep the listen socket open for a reconnect, but stop accepting until this peer goes
    // away: the protocol has one consumer, and two writers on one stream would interleave
    // half-frames.
    for (;;) {
      if (g_stop_listener != 0) { ::close(peer); if (g_recv_peer == peer) g_recv_peer = -1; break; }

      // Wait for readability or hangup, with a bounded timeout so a stop request is noticed.
      //
      // This MUST NOT use MSG_PEEK. The Node side sends a hello frame on connect, and peeking
      // leaves those bytes in the buffer forever, so every later peek returns "data available"
      // and the loop can never observe the peer closing. The accept loop then never runs again
      // and every subsequent connection sits unaccepted until its handshake times out -- which
      // looks like "the payload answers the first client and then goes deaf".
      struct pollfd pfd{};
      pfd.fd = peer;
      pfd.events = POLLIN;
      const int pr = ::poll(&pfd, 1, 200);
      if (pr < 0) {
        if (errno == EINTR) continue;
        ::close(peer);
        if (g_recv_peer == peer) g_recv_peer = -1;
        break;
      }
      if (pr == 0) continue;  // timeout: idle, peer still alive

      // Readable: drain whatever is there. The recv channel is one-way in its DATA (frames only
      // travel payload -> client), so anything inbound is handshake noise and discarding it is
      // correct. A 0-byte read means orderly shutdown.
      char drain[512];
      const ssize_t n = ::recv(peer, drain, sizeof(drain), MSG_DONTWAIT);
      if (n == 0) {
        std::printf("[payload] recv peer disconnected\n");
        std::fflush(stdout);
        ::close(peer);
        if (g_recv_peer == peer) g_recv_peer = -1;
        break;
      }
      if (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
        ::close(peer);
        if (g_recv_peer == peer) g_recv_peer = -1;
        break;
      }
      if (n > 0) {
        // Record the drain once per connection: a client whose handshake talk is being thrown
        // away is worth being able to see.
        static int drained_logged = 0;
        if (drained_logged < 4) {
          drained_logged++;
          const int df = ::open("/tmp/hz-emit.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
          if (df >= 0) {
            char db[80];
            const int dn = std::snprintf(db, sizeof(db), "  drained %zd inbound bytes on fd %d\n",
                                         n, peer);
            if (dn > 0) (void)::write(df, db, static_cast<std::size_t>(dn));
            ::close(df);
          }
        }
      }
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
// True when two service commands name the same family, i.e. they agree up to the last '_'.
//
// `OidbSvcTrpcTcp.0x11c4_100` and `OidbSvcTrpcTcp.0x11c4_1` are the same family. A command with
// no '_' compares in full, which is what the non-OIDB services want
// ("MessageSvc.PbSendMsg" has no suffix).
static bool cmd_family_matches(const char* a, const char* b) {
  if (a == nullptr || b == nullptr || a[0] == '\0' || b[0] == '\0') return false;
  const char* ua = std::strrchr(a, '_');
  const char* ub = std::strrchr(b, '_');
  const std::size_t la = (ua != nullptr) ? static_cast<std::size_t>(ua - a) : std::strlen(a);
  const std::size_t lb = (ub != nullptr) ? static_cast<std::size_t>(ub - b) : std::strlen(b);
  if (la == 0 || la != lb) return false;
  return std::memcmp(a, b, la) == 0;
}

static bool emit_packet(const char* service_cmd, const char* uin, int32_t ret_code,
                        uint64_t seq, const void* body, std::uint32_t body_len) {
  // Record the attempt before the peer check. "No frame was emitted" has two very different
  // causes -- nobody is subscribed, or the write failed -- and from the client side they are
  // indistinguishable: both are silence. One line settles which, so the next reader does not
  // have to guess (this cost several rounds: the hook was firing correctly and emitting nothing).
  {
    const int ef = ::open("/tmp/hz-emit.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (ef >= 0) {
      char eb[160];
      const int en = std::snprintf(eb, sizeof(eb), "emit peer=%d cmd=%s len=%u\n",
                                   g_recv_peer, (service_cmd != nullptr) ? service_cmd : "?",
                                   static_cast<unsigned>(body_len));
      if (en > 0) (void)::write(ef, eb, static_cast<std::size_t>(en));
      ::close(ef);
    }
  }
  // The only gate: is anybody subscribed? Peer liveness is NOT probed here.
  //
  // A peek-based probe was tried and removed: `recv(fd, buf, 0, MSG_PEEK)` returns 0 regardless of
  // peer state, so it declared every live peer dead; peeking one byte fixed that but then raced the
  // serve loop's own peek. The authoritative signal is a failing write, which `write_exact` already
  // uses to clear `g_recv_peer`, so this function stays a single cheap comparison.
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

  // Correlation: if an injected send is outstanding and THIS packet is its reply, stamp the
  // op 6 frame with the request id the Node side is waiting on.
  //
  // Measured 2026-11-24 01:10: the response to `MessageSvc.PbSendMsg` comes back through this
  // function like any other SSO command, so this is the one place where the real reply body and
  // the waiting request can be brought together. Without the stamp the Node side has a body but
  // no way to tell which caller it belongs to.
  //
  // The request id lives in `request_id`, which was always 0 on this channel (nothing read it:
  // `RecvClient` keys off `value0`, the sequence). Reusing an unused field is deliberate --
  // adding a new field would change the frame the reference also speaks.
  //
  // LIMITATION, stated rather than implied: the injector holds exactly ONE armed request at a
  // time (`g_inject_request_id`), so at most one injected send can be in flight. A second
  // concurrent send must wait for the first to be answered. That is a real constraint of the
  // substitution design -- QQ's own task manager has a table, we have a slot -- and the Node
  // side has to serialise rather than pretend otherwise.
  // Correlation by command FAMILY, not by exact string.
  //
  // The response's command name is decoded from QQ's own response object and its TAIL IS NOT
  // RELIABLE: a live `OidbSvcTrpcTcp.0x11c4_100` request comes back with a cmd that decodes as
  // `OidbSvcTrpcTcp.0x11c4_1` followed by two non-printable bytes -- same declared length on
  // some replies, one byte short on others (measured, /tmp/hz-recv-capture.log). Exact string
  // equality therefore never matches an OIDB response, and every caller times out with no
  // indication that the reply had in fact arrived.
  //
  // Matching up to the last `_` is enough to identify the family (`OidbSvcTrpcTcp.0x11c4`),
  // and it cannot over-match: the injector holds exactly ONE armed request
  // (`g_inject_request_id`), so there is at most one thing this packet can be answering. The
  // Node side serialises sends for the same reason.
  //
  // Heartbeats are excluded explicitly: they are unsolicited, they arrive several times a
  // minute, and correlating one would settle a waiter with a body that belongs to nothing.
  std::uint32_t correlation = 0;
  if (g_inject_request_id != 0 && service_cmd != nullptr &&
      std::strcmp(service_cmd, "Heartbeat.Alive") != 0 &&
      cmd_family_matches(service_cmd, g_inject_request_cmd)) {
    correlation = g_inject_request_id;
  }

  const FrameHeader h = make_header(kOpPacket, correlation, ret_code, 0,
                                    static_cast<std::uint32_t>(std::strlen(service_cmd)),
                                    static_cast<std::uint32_t>(std::strlen(uin)),
                                    body_len, seq);
  // send_frame takes the body length from h.body_len, so the header has to carry it.
  const bool packet_ok = send_frame(g_recv_peer, h, service_cmd, uin, body);
  {
    // Report the op 6 outcome separately from the receipt. Both frames go to the same peer, so a
    // receipt that arrives while the packet does not means the packet write itself failed -- and
    // without this line that reads as "the payload never got the response", which is false.
    const int pf = ::open("/tmp/hz-emit.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (pf >= 0) {
      char pb[192];
      const int pn = std::snprintf(pb, sizeof(pb),
                                   "  op6 corr=%u ok=%d receipt=%d cmd=%s\n", correlation,
                                   packet_ok ? 1 : 0, receipt_ok ? 1 : 0, service_cmd);
      if (pn > 0) (void)::write(pf, pb, static_cast<std::size_t>(pn));
      ::close(pf);
    }
  }
  return receipt_ok && packet_ok;
}

// ---------------------------------------------------------------------------
// The receive slot: msf::internal::TaskManager primary vtable slot 5
// ---------------------------------------------------------------------------
// Slot 5 is 0x407b840 = msfDidRecvResponseData, the point at which a server response is handed
// back to the task that asked for it. Everything downstream of it -- the TS decoder, the Bridge,
// the event bus -- is already proven against real captured bytes, so this is the last missing
// link: until an observer here produces op6 frames on recv.sock, no real QQ packet ever reaches
// the TS side.
//
// Layout, from docs/vtable-slots.md 7.3.1 and re-verified against the binary before writing
// this (see the report in MEMORY):
//
//   x0        this (TaskManager)
//   w2        retcode
//   x1        pointer-to-pointer; *x1 is the response object
//   resp+0x00 uin   std::Cr string
//   resp+0x18 seq   8-byte scalar
//   resp+0x20 cmd   std::Cr string
//   resp+0x38 -> {begin, end}  body, length = end - begin
//   resp+0x40 written to task+224; semantics UNPROVEN, and NOT retcode
//   x3..x7    dead at entry
//
// Four constraints shape every line below.
//
//   1. *x1 is nulled at 407ba94 (str xzr,[x20]) before the function returns. The object is
//      therefore only valid DURING the call, which is why the body is copied here and not left
//      for a SlotAfter hook -- by then it is a dangling pointer into a freed task.
//   2. Strictly read-only. Not one byte of the response object may be written: it is QQ's, it
//      is mid-flight, and the receive path is not ours to perturb.
//   3. emit_packet runs std::strlen on cmd and uin inside QQ's receive thread. Decoding into
//      our own NUL-terminated buffers is what keeps an off-by-16 layout mistake from becoming
//      a strlen over arbitrary memory.
//   4. The observer must return into the original. The relay does that for us: an observer is
//      called before the target and the target is then tail-called with the register state
//      restored, so nothing here is allowed to depend on the return value. That is also why
//      the prelude at 0x407af08 (which reads resp+0xA8 for timeout judgement) still runs:
//      we observe, we do not replace.
//
// The capture below is deliberately NOT the emit on the first run. Wire the emit first and a
// wrong layout produces a plausible-looking frame carrying garbage uin/cmd, which the Node side
// then attributes to a real account -- the one class of error that cannot be caught downstream.
// So the first version only records hex, and the offsets are confirmed from that before
// anything is published.
//
// That capture has now been taken (hz-test, real QQ, 13 entries in one run) and it confirms
// the table above in the two ways that matter:
//
//   * SHORT form, byte0 LSB clear. uin decoded as "10001" with byte0 = 0x14 = 10 << 1,
//     and cmd as "OidbSvcTrpcTcp.0xfd4_1" with byte0 = 0x2c = 22 << 1 -- so the length really
//     is byte0 >> 1 and the characters really start at +1. 22 characters is the boundary
//     itself, which a libstdc++-shaped decoder (SSO 15) would have taken for long form.
//   * LONG form, byte0 LSB set, {cap@+0, size@+8, ptr@+16}. A 33-byte cmd gave
//     cap = 0x31, size = 0x21 = 33, ptr = a heap address that decoded to
//     "ConfigurationService.ReqGetConfig". Under the libstdc++ convention the pointer would
//     have come from +0, i.e. 0x31 -- a guaranteed fault.
//
// The uin and cmd both decoded to real, correctly-routed QQ service commands, including
// "trpc.msg.olpush.OlPushService.MsgPush", which is the message-push command the whole receive
// path exists to carry. Zero calls were refused by any guard.
//
// Emit is therefore on.
#define HZ_RECV_EMIT 1

namespace {
// Counts entries so "installed but never called" and "called and failed" stay distinguishable.
volatile unsigned long long g_recv_slot_hits = 0;
volatile unsigned long long g_recv_slot_emitted = 0;

// Records which guard an entry went out on, instrumented per call.
//
// Exists because a bare `return` in this observer is otherwise invisible: the hex capture runs
// first, so a later guard that refuses looks identical to a run that simply had no more
// packets. That ambiguity has cost this project real time before (a hook that fired but logged
// nothing was read as "the slot is never called"), so each early exit names itself.
void recv_stage(const char* why) {
  const int fd = ::open("/tmp/hz-recv-capture.log", O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC,
                        0644);
  if (fd < 0) return;
  char line[96];
  const int n = snprintf(line, sizeof(line), "  stage: %s (stopped)\n", why);
  if (n > 0) {
    const ssize_t ig = ::write(fd, line, (size_t)n);
    (void)ig;
  }
  ::close(fd);
}
}  // namespace

// Dumps 32 bytes at `resp+0x00` and `resp+0x20` as hex, plus the decoded candidate fields.
//
// Hex only, on purpose. The question this answers is not "does the code run" but "which of the
// two candidate layouts is the real object": whether byte0's LSB is set (long form) and whether
// the pointer lives at +8 or +16. Printing the decoded strings instead would answer it only
// after assuming an answer.
static void capture_recv_object(uint64_t resp, int32_t retcode) {
  const int fd = ::open("/tmp/hz-recv-capture.log", O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC,
                        0644);
  if (fd < 0) return;
  char line[512];
  const char* hex = "0123456789abcdef";
  auto put_hex_byte = [&](char*& p, unsigned char v) {
    *p++ = hex[(v >> 4) & 0xf];
    *p++ = hex[v & 0xf];
  };
  char* p = line;
  const char* pfx = "recv resp=0x";
  for (const char* q = pfx; *q != '\0'; ++q) *p++ = *q;
  for (int sh = 60; sh >= 0; sh -= 4) *p++ = hex[(resp >> sh) & 0xf];
  const char* mid = " retcode=";
  for (const char* q = mid; *q != '\0'; ++q) *p++ = *q;
  // Decimal, signed: retcode is an error code and reads better as one.
  char num[16];
  std::size_t nn = 0;
  long long v = retcode;
  if (v < 0) { *p++ = '-'; v = -v; }
  if (v == 0) num[nn++] = '0';
  while (v > 0) { num[nn++] = static_cast<char>('0' + (v % 10)); v /= 10; }
  while (nn > 0) *p++ = num[--nn];
  *p++ = '\n';

  // The two 32-byte dumps the task calls for. Read through the guard: at entry the object is
  // supposed to be valid, but "supposed to be" is exactly what this run is testing.
  const unsigned kOffs[2] = {0x00, 0x20};
  const char* kTags[2] = {"uin@+00", "cmd@+20"};
  for (int k = 0; k < 2; ++k) {
    const char* tag = kTags[k];
    for (const char* q = tag; *q != '\0'; ++q) *p++ = *q;
    *p++ = ':';
    *p++ = ' ';
    unsigned char bytes[32];
    if (hz_safe_read(resp + kOffs[k], bytes, sizeof(bytes)) == 0) {
      const char* bad = "(unreadable)\n";
      for (const char* q = bad; *q != '\0'; ++q) *p++ = *q;
      const ssize_t ig = ::write(fd, line, static_cast<size_t>(p - line));
      (void)ig;
      p = line;
      continue;
    }
    for (unsigned i = 0; i < sizeof(bytes); ++i) {
      if (i != 0) *p++ = ' ';
      put_hex_byte(p, bytes[i]);
    }
    *p++ = '\n';
    // Which layout the bytes imply, stated explicitly so the log answers the question without
    // needing the reader to re-derive it: LSB of byte 0 selects short/long, and under the
    // long form +8 is the size and +16 the pointer.
    *p++ = ' ';
    *p++ = ' ';
    const char* verdict_short = "-> byte0 LSB=0: SHORT form, len=byte0>>1, chars at +1\n";
    const char* verdict_long = "-> byte0 LSB=1: LONG form, size@+8, ptr@+16\n";
    const char* verdict = ((bytes[0] & 1u) == 0) ? verdict_short : verdict_long;
    for (const char* q = verdict; *q != '\0'; ++q) *p++ = *q;
    const ssize_t ig = ::write(fd, line, static_cast<size_t>(p - line));
    (void)ig;
    p = line;
  }

  // The remaining fields, so a single capture run also confirms seq/body/retcode.
  const ssize_t ig = ::write(fd, line, static_cast<size_t>(p - line));
  (void)ig;
  ::close(fd);
}

// The observer installed on slot 5.
//
// Read-only, non-blocking, allocation-free, and it returns into the original. The signature is
// the relay's, not the slot's: (slot, original, x0..x3, frame).
extern "C" void hz_recv_response_observer(uint32_t slot, uint64_t original, uint64_t a0,
                                          uint64_t a1, uint64_t a2, uint64_t a3,
                                          uint64_t* frame) {
  (void)slot;
  (void)original;
  (void)a0;  // this -- the TaskManager. Not needed: every field comes from the response object.
  (void)a3;  // dead at entry, per the layout table.
  (void)frame;  // nothing is written back; this observer must not influence the call.
  g_recv_slot_hits = g_recv_slot_hits + 1;

  // The retcode is w2, i.e. the third integer argument. It is NOT resp+0x40: that field is
  // written to task+224 and its semantics are unproven, and an early revision mistook it for
  // the retcode.
  const int32_t retcode = static_cast<int32_t>(static_cast<uint32_t>(a2));

  // x1 is a pointer-to-pointer. *x1 is null on the early-error path (407b864 cbz x8), which is
  // a legitimate call carrying no response at all -- not a fault.
  uint64_t resp = 0;
  if (a1 == 0 || hz_safe_read(a1, &resp, sizeof(resp)) == 0 || resp == 0) {
    const int fd = ::open("/tmp/hz-recv-capture.log", O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC,
                          0644);
    if (fd >= 0) {
      const char* m = "recv null response (early-error path) retcode=";
      const ssize_t ig = ::write(fd, m, std::strlen(m));
      (void)ig;
      char nb[16];
      std::size_t nn = 0;
      long long v = retcode;
      if (v < 0) { nb[nn++] = '-'; v = -v; }
      if (v == 0) nb[nn++] = '0';
      while (v > 0) { nb[nn++] = static_cast<char>('0' + (v % 10)); v /= 10; }
      while (nn > 0) (void)::write(fd, &nb[--nn], 1);
      (void)::write(fd, "\n", 1);
      ::close(fd);
    }
    return;
  }

  // Hex capture first. See capture_recv_object: the layout must be confirmed from bytes, not
  // assumed from a table that was itself recovered from a disassembly.
  capture_recv_object(resp, retcode);

  // ---- offsets, as bytes (the shape this code has to satisfy) ----
  //   resp+0x00  uin  std::Cr   {cap@+0, size@+8, ptr@+16}, SSO 22, LSB=1 long
  //   resp+0x18  seq  8-byte scalar, loaded directly (407b880 ldr x23,[x24,#24])
  //   resp+0x20  cmd  std::Cr   same rules
  //   resp+0x38  body POINTER to a {begin, end} pair -- NOT the pair itself
  uint64_t seq = 0;
  if (hz_safe_read(resp + 0x18, &seq, sizeof(seq)) == 0) {
    recv_stage("seq");
    return;
  }

  // resp+0x38 holds a POINTER to the range, and the range is {begin, end}:
  //
  //   407b890  ldr x8, [x8, #56]   ; x8 = *(resp + 0x38)  <- pointer, not a bound
  //   407b894  ldp x8, x9, [x8]    ; begin = *x8, end = *(x8 + 8)
  //   407b898  sub x8, x9, x8      ; len = end - begin
  //
  // Reading *[resp+0x38] as `begin` makes the length `resp+0x40 - pointer`, which is a wild
  // number: resp+0x40 is the field written to task+224, not the end of the range. That bug
  // compiled, installed and captured bytes, and then silently returned before ever emitting --
  // which is exactly the failure shape this project has paid for before, so it is spelled out
  // here rather than left to the reader.
  uint64_t range_ptr = 0;
  if (hz_safe_read(resp + 0x38, &range_ptr, sizeof(range_ptr)) == 0 || range_ptr == 0) {
    recv_stage("range-ptr");
    return;
  }

  uint64_t begin = 0;
  uint64_t end = 0;
  if (hz_safe_read(range_ptr, &begin, sizeof(begin)) == 0) {
    recv_stage("begin");
    return;
  }
  if (hz_safe_read(range_ptr + 8, &end, sizeof(end)) == 0) {
    recv_stage("end");
    return;
  }
  // end < begin is a wild read, not an empty body: refuse rather than underflow into a huge
  // length that emits a frame claiming gigabytes.
  if (end < begin) {
    recv_stage("range-order");
    return;
  }
  const uint64_t body_len64 = end - begin;

  // Decode into our own buffers. These are the only strings emit_packet is ever allowed to see:
  // it runs strlen on them inside QQ's thread, so a pointer taken straight out of the object
  // would be a strlen over whatever the object's layout actually is.
  char uin[HZ_CR_MAX_LEN + 1];
  char cmd[HZ_CR_MAX_LEN + 1];
  size_t uin_len = 0;
  size_t cmd_len = 0;
  if (hz_cr_decode(resp, 0x00, uin, sizeof(uin), &uin_len) == 0) uin[0] = '\0';
  if (hz_cr_decode(resp, 0x20, cmd, sizeof(cmd), &cmd_len) == 0) cmd[0] = '\0';

  // Log what the decoder produced, not just the bytes it read.
  //
  // This is the decisive line: a service command is printable ASCII with a known shape
  // ("MessageSvc.PbSendMsg", ".status_svc.StatusService.SsoHeartBeat"), so decoding the object
  // with the WRONG layout produces visible garbage here rather than a plausible number. It also
  // cannot be checked after the fact -- *x1 is nulled on return and the task frees the buffer,
  // so a post-hoc peek at the pointer reads freed memory (observed: the same address decoded to
  // a completely different string one second later).
  {
    const int fd =
        ::open("/tmp/hz-recv-capture.log", O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
    if (fd >= 0) {
      char line[1600];
      char uin_p[HZ_CR_MAX_LEN + 1];
      char cmd_p[HZ_CR_MAX_LEN + 1];
      for (size_t i = 0; i < uin_len && i < HZ_CR_MAX_LEN; ++i) {
        const unsigned char c = static_cast<unsigned char>(uin[i]);
        uin_p[i] = (c >= 0x20 && c < 0x7f) ? static_cast<char>(c) : '.';
        uin_p[i + 1] = '\0';
      }
      if (uin_len == 0) uin_p[0] = '\0';
      for (size_t i = 0; i < cmd_len && i < HZ_CR_MAX_LEN; ++i) {
        const unsigned char c = static_cast<unsigned char>(cmd[i]);
        cmd_p[i] = (c >= 0x20 && c < 0x7f) ? static_cast<char>(c) : '.';
        cmd_p[i + 1] = '\0';
      }
      if (cmd_len == 0) cmd_p[0] = '\0';
      const int n = snprintf(line, sizeof(line),
                             "  decoded uin(%llu)=\"%s\" cmd(%llu)=\"%s\"\n",
                             static_cast<unsigned long long>(uin_len), uin_p,
                             static_cast<unsigned long long>(cmd_len), cmd_p);
      if (n > 0) {
        const size_t wn = static_cast<size_t>(n) < sizeof(line) ? static_cast<size_t>(n)
                                                               : sizeof(line) - 1;
        const ssize_t ig = ::write(fd, line, wn);
        (void)ig;
      }
      ::close(fd);
    }
  }

  // An empty command cannot be routed by the Node side, and a body longer than the frame
  // protocol's own limit would be truncated mid-message. Record and drop instead of emitting
  // something the decoder would have to guess at.
  if (cmd_len == 0) {
    const int fd = ::open("/tmp/hz-recv-capture.log", O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC,
                          0644);
    if (fd >= 0) {
      const char* m = "recv empty cmd, dropped\n";
      const ssize_t ig = ::write(fd, m, std::strlen(m));
      (void)ig;
      ::close(fd);
    }
    return;
  }
  if (body_len64 > kMaxMsg) {
    const int fd = ::open("/tmp/hz-recv-capture.log", O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC,
                          0644);
    if (fd >= 0) {
      const char* m = "recv body too large, dropped\n";
      const ssize_t ig = ::write(fd, m, std::strlen(m));
      (void)ig;
      ::close(fd);
    }
    return;
  }

#if HZ_RECV_EMIT
  // The body is copied out before returning, which is the whole reason this cannot be a
  // SlotAfter: *x1 is nulled at 407ba94 and the task frees the buffer, so by the time an after
  // hook ran this pointer would be dangling. emit_packet writes synchronously from here.
  //
  // No copy buffer is needed at all: emit_packet hands the pointer to send_frame, which writes
  // it out with send(MSG_DONTWAIT) before returning, all inside this call. What matters is that
  // it happens now rather than later.
  const bool ok = emit_packet(cmd, uin, retcode, seq,
                              reinterpret_cast<const void*>(begin),
                              static_cast<std::uint32_t>(body_len64));
  if (ok) g_recv_slot_emitted = g_recv_slot_emitted + 1;
#endif
  // No return value, no write-back: the relay restores the register state and tail-calls the
  // original, so the response is delivered exactly as QQ would have delivered it.
}

// Defined with the rest of the listener below; declared here so the constructor can bind at load.
extern "C" int snowluma_linux_hook_start_dynamic();

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

  // Bind the control channel at load time.
  //
  // Waiting for a later event made the socket appear only on a signed-in client, so a probe could
  // not report that it had run at all while signed out. Loading the module is the one moment that
  // always happens.
  g_ctor_binding = 1;
  const int started = snowluma_linux_hook_start_dynamic();
  g_ctor_binding = 0;
  {
    const int lf = ::open("/tmp/hz-payload.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (lf >= 0) {
      char lb[160];
      const int ln = std::snprintf(lb, sizeof(lb), "ctor: start_dynamic rc=%d path=%s\n", started,
                                   g_control_path[0] ? g_control_path : "(none)");
      if (ln > 0) (void)::write(lf, lb, static_cast<std::size_t>(ln));
      ::close(lf);
    }
  }
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

// Installs the diagnostic hooks without starting the socket service.
//
// This exists for the case that took several rounds to see: a process already served by another
// payload cannot be taken over for observation, because start_dynamic unlinks the bound socket
// path and the working channel dies with it. Mapping the module with skipEntry keeps that channel
// alive, but then nothing ever installs a hook -- so this entry does exactly the hook work and
// nothing else.
//
// Argument: 0 = install the pack hook (MSFSDK::pack), 1 = install the send hook family.
// Returns the number of hooks installed, or a negative error code.
// Reports whether QQ's MSF layer looks ready, by reading the flag MSFSDK::sendPacket gates on.
//
// Read-only on purpose. Calling sendPacket to find out would send something, and the first
// question is whether the surface exists -- not whether a guess at MSFRequest is correct. A
// wrong guess at this layer puts bytes on the wire toward QQ's servers.
//
// Every offset here comes from the disassembly of MSF::MSFSDK::sendPacket at 0x412b328:
//   412b340  adrp x8, 0x8a03000
//   412b344  ldrb w8, [x8, #2818]     -> byte at 0x8a03b02
//   412b348  cmp  w8, #1
//   412b34c  b.ne 0x412b408          -> the -1 return
extern "C" int hz_probe_msf_state() {
  const int fd = ::open("/tmp/hz-msf.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
  const std::uint64_t base = hz_hook_module_base();
  if (fd < 0) return -1;
  char line[256];
  if (base == 0) {
    const int n = std::snprintf(line, sizeof(line), "msf: module base unknown\n");
    if (n > 0) (void)::write(fd, line, (size_t)n);
    ::close(fd);
    return -2;
  }
  // The adrp page is 0x8a03000 in the file's own address space; add the load bias.
  const std::uint64_t flag_addr = base + (0x8a03b02ull - 0x0ull);
  unsigned char flag = 0;
  bool ok = false;
  {
    // Guard the read: 0x8a03b02 is far outside the image's .data if the bias is wrong, and a
    // fault here would take QQ down for a diagnostic.
    const int mfd = ::open("/proc/self/maps", O_RDONLY | O_CLOEXEC);
    if (mfd >= 0) {
      char mbuf[8192];
      const ssize_t mn = ::read(mfd, mbuf, sizeof(mbuf) - 1);
      ::close(mfd);
      if (mn > 0) {
        mbuf[mn] = '\0';
        // Coarse check only: the address must fall inside some readable mapping.
        std::uint64_t lo = 0;
        for (ssize_t i = 0; i < mn; ++i) {
          if (mbuf[i] == '-') {
            std::uint64_t hi = 0;
            ssize_t j = i + 1;
            while (j < mn && mbuf[j] != ' ') { hi = hi * 16 + (mbuf[j] <= '9' ? mbuf[j] - '0' : (mbuf[j] | 32) - 'a' + 10); ++j; }
            if (flag_addr >= lo && flag_addr < hi) { ok = true; }
            break;
          }
          lo = lo * 16 + (mbuf[i] <= '9' ? mbuf[i] - '0' : (mbuf[i] | 32) - 'a' + 10);
        }
      }
    }
  }
  if (ok) flag = *reinterpret_cast<const unsigned char*>(flag_addr);
  const int n = std::snprintf(line, sizeof(line),
                              "msf: base=0x%llx flagAddr=0x%llx mapped=%d flag=%u ready=%s\n",
                              (unsigned long long)base, (unsigned long long)flag_addr, ok ? 1 : 0,
                              (unsigned)flag, (ok && flag == 1) ? "yes" : "no");
  if (n > 0) (void)::write(fd, line, (size_t)n);
  ::close(fd);
  return (ok && flag == 1) ? 1 : 0;
}

// Hooks every slot of nt::MSFCoreService's primary vtable.
//
// The coordinates come from docs/msf-core-service.md, which recovered them three independent
// ways: a reverse-index over R_AARCH64_RELATIVE addends pointing at the typeinfo, the
// constructor's six vptr stores, and string xrefs into slots 17 and 18. vaddr 0x8718f60, 52
// slots. Slots 26/48/49 are bare `ret` stubs and are skipped.
// Reads the vtable that a live MSFService instance actually points at, and dumps it.
//
// The static template at file offset 0x8718f60 is not what runs. QQ copies it to the heap at
// construction, and the copy is what the virtual calls dispatch through -- so sweeping the
// template (which hz_sweep_msf_core does) can install forty-nine perfectly good relays that
// nothing ever enters. That is exactly what happened: slot 36 was hooked, the patch was verified
// present in memory, a real message went out carrying a message_id, and the observer never fired.
//
// This walks the instance instead: `[instance]` is the vptr, and dumping its first N slots shows
// where the real functions are. Comparing against the template says whether they differ at all
// and, if they do, by how much -- which is the difference between "we hooked the wrong address"
// and "this object is not the thing that sends".
extern "C" int hz_dump_live_vtable(std::uint64_t instance, int slots) {
  const int fd = ::open("/tmp/hz-live-vt.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
  if (fd < 0) return -1;
  char b[224];
  auto emit = [&](const char* fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    const int n = std::vsnprintf(b, sizeof(b), fmt, ap);
    va_end(ap);
    if (n > 0) (void)::write(fd, b, (size_t)((n < (int)sizeof(b)) ? n : (int)sizeof(b)));
  };

  const std::uint64_t base = hz_hook_find_module_base("wrapper.node");
  emit("live instance=0x%llx module_base=0x%llx\n", (unsigned long long)instance,
       (unsigned long long)base);
  if (instance == 0) { emit("instance is null\n"); ::close(fd); return -2; }

  // Read the vptr. A null or obviously bogus vptr means this is not a polymorphic object at all,
  // which on its own would explain everything and is worth stating rather than crashing on.
  const std::uint64_t vt = *reinterpret_cast<const std::uint64_t*>(instance);
  emit("vptr=0x%llx in_module=%d\n", (unsigned long long)vt,
       (vt >= base && base != 0 && vt < base + 0x89d540ull) ? 1 : 0);
  if (vt == 0) { emit("vptr is null -- object has no vtable\n"); ::close(fd); return -3; }

  const int limit = (slots > 0 && slots <= 64) ? slots : 44;
  for (int i = 0; i < limit; ++i) {
    const std::uint64_t entry = *reinterpret_cast<const std::uint64_t*>(vt + 8ull * (std::uint64_t)i);
    // The template's value at the same index, for comparison. Both are printed even when the
    // template address is itself wrong, because a mismatch is the interesting case.
    const std::uint64_t tmpl =
        base != 0 ? *reinterpret_cast<const std::uint64_t*>(base + 0x87173e8ull +
                                                           8ull * (std::uint64_t)i)
                  : 0;
    const char* same = (entry == tmpl) ? "same" : "DIFF";
    emit("  [%2d] live=0x%llx tmpl=0x%llx %s\n", i, (unsigned long long)entry,
         (unsigned long long)tmpl, same);
  }
  ::close(fd);
  return 0;
}

extern "C" int hz_sweep_msf_core() {
  const std::uint64_t base = hz_hook_find_module_base("wrapper.node");
  {
    const int fd = ::open("/tmp/hz-core.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (fd >= 0) {
      char b[128];
      const int n = std::snprintf(b, sizeof(b), "sweep base=0x%llx\n",
                                  (unsigned long long)base);
      if (n > 0) (void)::write(fd, b, (size_t)n);
      ::close(fd);
    }
  }
  if (base == 0) return -1;
  const std::uint64_t vt = base + 0x8718f60ull;
  // Sanity-check the table before patching 49 slots: the first entry must be a pointer into this
  // module's own text. If it is not, either the address is wrong or the object has been rebuilt
  // under us, and in both cases installing relays would replace whatever is really there.
  {
    const std::uint64_t first = *reinterpret_cast<const std::uint64_t*>(vt);
    const int fd = ::open("/tmp/hz-core.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (fd >= 0) {
      char b[192];
      const int n = std::snprintf(b, sizeof(b),
                                  "vt=0x%llx slot0=0x%llx in_module=%d\n",
                                  (unsigned long long)vt, (unsigned long long)first,
                                  (first >= base && first < base + 0x89d540ull) ? 1 : 0);
      if (n > 0) (void)::write(fd, b, (size_t)n);
      ::close(fd);
    }
  }
  int installed = 0;
  for (std::uint32_t i = 0; i < 52; ++i) {
    if (i == 26 || i == 48 || i == 49) continue;
    const int rc = hz_hook_vtable_slot(vt, i, hz_spy_observer);
    if (rc >= 0) ++installed;
  }
  {
    const int fd = ::open("/tmp/hz-core.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (fd >= 0) {
      char b[96];
      const int n = std::snprintf(b, sizeof(b), "installed=%d\n", installed);
      if (n > 0) (void)::write(fd, b, (size_t)n);
      ::close(fd);
    }
  }
  return installed;
}

// A working send, built from the disassembly of sendSsoInternal.
//
// Signature, read off the call site at 0x137cf20 rather than guessed from a register dump:
//
//   void sendSsoInternal(void* self, const SsoStr* cmd, const Range* body, uint32_t flag,
//                        void* out);
//
//   self   at +0x60 must be non-null or it throws (0x137cfa8 -> 0x137d208)
//   cmd    an SSO string: flag byte at +0, characters at +1 when bit0 is set
//   body   {begin, end} -- two pointers, not a capacity triple
//   flag   only bit 0 matters (and w26, w23, #1)
//   out    whatever the caller had on the stack; passing a zeroed block is the safe guess
//
// The reason this is written as a raw call rather than through any exported symbol: there is no
// export. This is the callee behind four BL sites in the whole module, reached through heap copies
// of a vtable we cannot patch.
struct HzSsoStr {
  // The target reads the flag byte at +0 and, when bit 0 is set, treats the rest as inline
  // characters with the length in the upper bits. Keeping it as a byte array avoids asserting a
  // layout we only partially understand.
  unsigned char raw[32];
};
struct HzRange {
  const unsigned char* begin;
  const unsigned char* end;
};

extern "C" int hz_send_sso(std::uint64_t instance, const char* cmd, const unsigned char* body,
                           std::size_t body_len) {
  {
    // Unconditional entry log, before any early return. The previous version logged after the
    // guards and produced nothing, which could mean "not called" or "called with a bad argument"
    // -- two very different diagnoses that looked identical.
    const int fd = ::open("/tmp/hz-send.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (fd >= 0) {
      char b[192];
      const int m = std::snprintf(b, sizeof(b),
                                  "enter instance=0x%llx cmd=%s body_len=%llu\n",
                                  (unsigned long long)instance, (cmd != nullptr) ? cmd : "(null)",
                                  (unsigned long long)body_len);
      if (m > 0) (void)::write(fd, b, (size_t)m);
      ::close(fd);
    }
  }
  if (instance == 0 || cmd == 0) return -1;
  const std::uint64_t base = hz_hook_find_module_base("wrapper.node");
  if (base == 0) return -2;
  typedef void (*SendFn)(void*, const void*, const void*, std::uint32_t, void*);
  SendFn fn = reinterpret_cast<SendFn>(base + 0x137cf84ull);

  HzSsoStr name;
  for (unsigned i = 0; i < sizeof(name.raw); ++i) name.raw[i] = 0;
  const std::size_t n = ::strlen(cmd);
  // The bound was 15, on the assumption that only short names fit the inline form and that
  // "MessageSvc.PbSendMsg" -- twenty characters -- would need the heap form. That assumption was
  // wrong and it made this function silently return -3 without ever calling out, while still
  // having written its entry log, so it looked like the call had happened and been rejected
  // downstream. The buffer above holds 31 characters after the flag byte, which is enough for the
  // longest command in use; anything longer is a name this cannot build and is refused explicitly.
  if (n == 0 || n > sizeof(name.raw) - 1) return -3;
  // 🔴 THE FLAG BIT IS 0 FOR INLINE, NOT 1. libc++ (`std::Cr`), not libstdc++.
  //
  // This line used to be `(n << 1) | 1u`, and that single bit is what made every direct
  // `sendSsoInternal` call die. The layout rule (verified from the decoder at 0x13efc7c and
  // written down in docs/vtable-slots.md:645-651) is:
  //
  //     byte0 LSB = 1  ->  LONG form: {cap@+0, size@+8, ptr@+16}, characters at *ptr
  //     byte0 LSB = 0  ->  INLINE:    len = byte0>>1, characters at +1
  //
  // Setting LSB told QQ the object was a heap string, so it loaded a "pointer" out of bytes
  // 16..23 -- which in this struct are zeros followed by whatever happens to be next in
  // memory -- and dereferenced it. That is a wild read on the send thread.
  //
  // It also retroactively explains a wrong conclusion in MEMORY: "another thread cannot call
  // sendSsoInternal, the client dies even with a valid body" (2.3ai). The body was valid. The
  // COMMAND OBJECT was built in the wrong string form, so the crash was ours, not the callee's,
  // and thread affinity was never the problem.
  //
  // The same bit was copied into the INJ0 handler at cmd_obj[0]; both are fixed together.
  name.raw[0] = static_cast<unsigned char>(n << 1);
  for (std::size_t i = 0; i < n; ++i) name.raw[1 + i] = static_cast<unsigned char>(cmd[i]);

  HzRange range;
  range.begin = body;
  range.end = body + body_len;
  unsigned char out[128];
  for (unsigned i = 0; i < sizeof(out); ++i) out[i] = 0;

  {
    const int fd = ::open("/tmp/hz-send.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (fd >= 0) {
      char b[192];
      const int m = std::snprintf(b, sizeof(b),
                                  "send instance=0x%llx cmd=%s len=%llu\n",
                                  (unsigned long long)instance, cmd,
                                  (unsigned long long)body_len);
      if (m > 0) (void)::write(fd, b, (size_t)m);
      ::close(fd);
    }
  }
  fn(reinterpret_cast<void*>(instance), &name, &range, 1u, out);
  return 0;
}

extern "C" int haizakura_linux_hook_install_observer_only(int which) {
  {
    // First line the observer entry runs. It exists because the libc path faulted with no log at
    // all -- not even the stage line that sits after path resolution -- which leaves two very
    // different possibilities open: the branch never ran, or it ran and died before logging.
    const int fd0 = ::open("/tmp/hz-obsonly.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (fd0 >= 0) {
      char b0[64];
      const int n0 = std::snprintf(b0, sizeof(b0), "enter which=%d\n", which);
      if (n0 > 0) (void)::write(fd0, b0, (size_t)n0);
      ::close(fd0);
    }
  }
  if (which == 0) return hz_hook_exports_matching_with("MSFSDK4pack", 2, hz_req_observer);
  if (which == 1) return hz_hook_exports_matching_with("sendPacket", 4, hz_spy_observer);
  // which == 2: the whole MSFSDK surface, so one send reveals which member is actually used.
  // Hooking pack alone answered that question negatively, and a negative result only means
  // something when the alternative was also instrumented.
  if (which == 2) return hz_hook_exports_matching_with("MSFSDK", 40, hz_spy_observer);
  // which == 3: the session-shell factories, the other candidate surface.
  if (which == 3) return hz_hook_exports_matching_with("SessionShell", 8, hz_spy_observer);
  // which == 4/5: the syscall boundary. Every export of wrapper.node was instrumented and a real
  // send produced nothing, so the byte-emitting code is either libc or a module we never looked
  // at. Patching write()/send() inside the process that owns them answers "which code actually
  // emits the bytes" without needing to guess any structure at all.
  if (which == 4) return hz_hook_library_symbol("libc.so.6", "write", hz_sys_observer);
  if (which == 5) return hz_hook_library_symbol("libc.so.6", "send", hz_sys_observer);
  if (which == 6) return hz_hook_library_symbol("libc.so.6", "sendto", hz_sys_observer);
  // which == 8..11: the remaining syscall-shaped paths.
  //
  // send() and sendto() both installed cleanly and both recorded zero hits while a real message
  // reached the group, so the bytes are not leaving through either. These four cover the rest of
  // the plausible surface; sendmsg is the strongest candidate because it takes a msghdr rather
  // than a flat buffer, which is what a framework building scattered headers would use.
  if (which == 8) return hz_hook_library_symbol("libc.so.6", "sendmsg", hz_sys_observer);
  if (which == 9) return hz_hook_library_symbol("libc.so.6", "writev", hz_sys_observer);
  if (which == 10) return hz_hook_library_symbol("libc.so.6", "write", hz_sys_observer);
  if (which == 11) return hz_hook_library_symbol("libc.so.6", "sendmmsg", hz_sys_observer);
  // which == 20: all slots of nt::MSFCoreService (52), installed from the payload entry.
  //
  // Delivery model matters more than offsets here. When our payload is installed first the
  // reference is not in the process at all, so a send fails outright (retcode 100) and every
  // hook reports zero -- which reads as "this layer is not on the send path" when in fact no
  // send happened. Installing from the entry, into a process the reference is already serving,
  // removes both that and the reverse race where an observer arrives after the calls.
  if (which == 20) return hz_sweep_msf_core();
  // which == 21: hook the concrete send implementation by module offset.
  //
  // The vtable sweeps all came back empty and the reason took a while to see: the table at
  // base+0x8718f60 is a template. QQ copies vtables at construction, and the copies live on the
  // heap, so patching the template changes nothing that runs. The functions themselves are still
  // ordinary code at fixed offsets, which is what this targets.
  //
  // 0x137cf84 is `sendSsoInternal`. Across all of .text there are exactly four BLs to it --
  // 0x137cf30, 0x137db84, 0x137dc24, 0x137dca8 -- and those are nt::MSFService slots 36/37 plus
  // their -0x10 adjustor views. Hooking the callee catches every one of them without caring
  // which vtable or copy the caller went through.
  if (which == 21) return hz_hook_function_offset(0x137cf84ull, hz_spy_observer);
  if (which == 22) return hz_hook_function_offset(0x137cf30ull, hz_spy_observer);
  if (which == 23) return hz_hook_function_offset(0x137db84ull, hz_spy_observer);
  // which == 24: install the capture observer, which records the MSFService instance the first
  // time a real send passes one in a0.
  if (which == 24) return hz_hook_function_offset(0x137cf84ull, hz_capture_instance_observer);
  // which == 25: hook 0x137ceb8, the value actually stored in MSFService slot 36. Slot 36 holds
  // 0x137ceb8, not 0x137cf84: the latter is a *callee* reached from 0x137cf30 inside it. Both are
  // real function entries (each has its own prologue), so which one runs is an empirical
  // question -- and if 0x137cf84 never fires while slot 36 is populated, then the slot's value is
  // being reached by something other than the bl at 0x137cf30.
  if (which == 25) return hz_hook_function_offset(0x137ceb8ull, hz_capture_instance_observer);
  if (which == 26) return hz_hook_function_offset(0x137ceb8ull, hz_spy_observer);
  // which == 27: read the live vtable through a previously captured instance pointer, instead of
  // sweeping the static template. See hz_dump_live_vtable for why the distinction matters.
  if (which == 27) return hz_dump_live_vtable(g_msf_instance, 44);
  // which == 28: rewrite the body and forward, from inside the live call. This is the capability
  // the architecture needs -- a payload that can originate a send, not just observe one.
  if (which == 28) return hz_hook_function_offset(0x137cf84ull, hz_forward_observer);
  // which == 29: capture a live send into a private copy, to be replayed from another thread.
  // This is the alternative to forwarding from inside the observer, which cannot work because the
  // callee is not re-entrant.
  if (which == 29) return hz_hook_function_offset(0x137cf84ull, hz_capture_for_replay_observer);
  // which == 30: hook MSF::MSFSDK::sendPacket(std::Cr::unique_ptr<MSF::MSFRequest>).
  //
  // This is the first target found today whose prologue can actually be patched. sendPacket is a
  // real exported symbol -- it appears in .dynsym as _ZN3MSF6MSFSDK10sendPacketENSt2Cr10unique_ptrINS_10MSFRequestENS1_14deleteIS3_EEEE
  // at 0x412b328 -- and it opens with sub sp,sp,#0x80 / stp x29,x30. Every libc function tried
  // earlier was refused for containing adrp or a literal load in its first sixteen bytes, which is
  // why those hooks never installed and why 'libc is not on the send path' was the wrong reading.
  //
  // Its signature is also the one the architecture needs: it takes an already-constructed request
  // object, so a payload could hand it a request of its own rather than intercepting QQ's.
  if (which == 30) return hz_hook_function_offset(0x412b328ull, hz_hot_observer);
  // which == 31: the pack step, immediately related and also exported at 0x412b7f8.
  if (which == 31) return hz_hook_function_offset(0x412b7f8ull, hz_hot_observer);
  // which == 32: the trpc/OIDB send entry, at the function that formats
  // "OidbSvcTrpcTcp.0x%x_%d" into its command name.
  //
  // Located by searching for adrp+add pairs that materialise the address of that format string:
  // six sites do, and all six sit in 0x137be94..0x13a156c, the same neighbourhood as
  // sendSsoInternal. The enclosing function starts at 0x137bd6c with a relocatable prologue.
  //
  // This is a different route than MSF::MSFSDK::sendPacket, which installed cleanly, survived a
  // real send, and recorded zero hits -- so the group-message path is evidently the trpc/OIDB
  // one rather than MSF's packet queue.
  if (which == 32) return hz_hook_function_offset(0x137bd6cull, hz_hot_observer);
  // which == 41 (next free after 33/40): the receive slot, msf::internal::TaskManager primary
  // vtable slot 5 = 0x407b840 = msfDidRecvResponseData.
  //
  // This is the last missing link on the receive path: everything downstream (the TS decoder,
  // the Bridge, the event bus) is already proven against real captured bytes, but until an
  // observer here produces op6 frames on recv.sock, no real QQ packet ever reaches the TS side.
  //
  // Installed by module offset rather than through the vtable because the vtable at 0x88b4aa0
  // is a template that QQ copies at construction -- the copies live on the heap, so patching
  // the template changes nothing that runs. The function itself is at a fixed offset in .text
  // and has NO static BL callers anywhere (verified by scanning all 24M instructions of .text:
  // zero), which confirms it is only ever reached through that vtable, and that hooking the
  // function entry catches every call regardless of which copy's table was used.
  //
  // Argument layout and the six hard constraints (std::Cr with SSO=22, strictly read-only,
  // *x1 nulled on return so the body is copied during the call, resp+0xA8 timeout prelude left
  // intact, no raw object field ever reaching strlen, observer forwards to the original) are
  // documented in docs/vtable-slots.md 7.3.1 and restated at hz_recv_response_observer.
  if (which == 41) return hz_hook_function_offset(0x407b840ull, hz_recv_response_observer);
  // which == 42: the whole working send path, in one call.
  //
  // Three hooks are needed together and installing them separately is how this went wrong:
  //
  //   * the send entry (0x137cf84) -- capture QQ's instance and ctx on a real send, and provide
  //     the replay stub that a direct call enters through;
  //   * the receive slot (0x407b840) -- turn QQ's response into an op 6 frame on recv.sock.
  //
  // Installed one at a time, each looked like it did nothing: a direct send succeeded (the group
  // received the text) while its reply was never emitted, because the receive hook was simply
  // absent. The client then timed out with a message about the recv channel, which is accurate
  // but points at the wrong half. One entry point for the working configuration removes that
  // class of mistake.
  if (which == 42) {
    // 0x137ceb8 (MSFService slot 36) rather than 0x137cf84 (its callee) for the CAPTURE hook.
    //
    // Measured 2026-11-24 03:00: a live send fires 0x137ceb8 but NOT 0x137cf84, even though
    // 0x137ceb8 clearly contains `bl 0x137cf84` at 0x137cf30. Whatever reaches the send entry,
    // it is not that call -- so hooking the callee alone leaves the instance/ctx permanently
    // uncaptured and every DSND refuses with "no captured instance/ctx".
    //
    // 0x137ceb8 has what the capture needs and is reachable: x0 is the MSFService instance and
    // x3 the ctx it dereferences at +0x10.
    const int send_rc = hz_hook_function_offset(0x137ceb8ull, hz_capture_instance_observer);
    if (send_rc < 0) return send_rc;
    // ALSO hook the callee, purely so a replay stub exists for the direct call.
    //
    // `hz_direct_send` enters the real send body through `hook_replay_stub(idx)`, and that stub
    // is generated by the installer for the exact address that was hooked. Hooking only
    // 0x137ceb8 would leave no stub for 0x137cf84 and the direct call would refuse with "no
    // replay stub". Two hooks, two purposes: 0x137ceb8 captures, 0x137cf84 provides the entry
    // that a direct call can safely use.
    const int entry_rc = hz_hook_function_offset(0x137cf84ull, hz_capture_instance_observer);
    if (entry_rc < 0) return entry_rc;
    const int recv_rc = hz_hook_function_offset(0x407b840ull, hz_recv_response_observer);
    if (recv_rc < 0) return recv_rc;
    // Positive return: the index of the LAST hook installed, which is what the caller logs. It is
    // not an error code -- `rc=2` in every log line is a hook index, and reading it as failure
    // caused a long detour.
    return recv_rc;
  }
  // which == 33: classify every call by its command header, to separate heartbeats from sends.
  // This answers the one question the whole architecture depends on.
  if (which == 33) return hz_hook_function_offset(0x137cf84ull, hz_cmd_observer);
  // which == 34: the send injector. Waits for QQ's own heartbeat entry and substitutes a
  // MessageSvc.PbSendMsg in flight, instead of calling the function from outside.
  if (which == 34) return hz_hook_function_offset(0x137cf84ull, hz_inject_observer);
  // which == 35: arm first, then hook, so the injector needs no control channel at all.
  //
  // The control-channel path was tried and silently did nothing: the socket carried the INJ0
  // frame to the reference payload rather than to this one, so g_inject_armed stayed zero and the
  // observer never acted. Arming from inside the payload removes that dependency, and a
  // compile-time body is truthful here because this is a single-shaped probe -- one text element
  // to one group -- not a general-purpose send.
  // which == 36: record what x1 carries, and do not touch anything.
  //
  // which 35 rewrote the command and the client died, which proves the write reaches the target
  // but says nothing about whether the value written was right. This variant answers the
  // question underneath: what command does the send path actually carry, and at what length?
  // Without that number the rewrite is guesswork -- the first version assumed 40 characters
  // (a heartbeat that turned out not to exist) and skipped every real call.
  if (which == 36) return hz_hook_function_offset(0x137cf84ull, hz_cmd_observer);
  // which == 37: record all five arguments of the send entry, and change nothing.
  //
  // Two rewrites have now been tried and both killed the client: writing x3 (which is the flag,
  // not the body) and writing x2 (the body, correctly this time). Neither crash says the approach
  // is wrong, only that some other argument is now inconsistent with the body -- most likely the
  // `out` result object at x4, which QQ allocates to match the request it was going to send.
  // Reading all five together is what distinguishes those cases; guessing has cost several
  // restarts already.
  if (which == 37) return hz_hook_function_offset(0x137cf84ull, hz_args_observer);
  // which == 38: call sendSsoInternal from another thread with a VALID body, and see whether it
  // survives.
  //
  // This experiment was already run once and the client died, and the conclusion drawn was that
  // the call itself was unsafe -- that it collided with a heartbeat (since disproved) or broke
  // thread affinity. But that run passed a plain-text marker where a protobuf message belongs,
  // so the crash is equally explained by the callee parsing garbage. Two causes were conflated
  // and only one was addressed.
  //
  // The body here is the encoder's real output, verified byte-identical to the reference. If the
  // call survives, op 2 can be served synchronously -- with the response in hand to return --
  // rather than by substitution, which cannot report a result the caller has to wait for.
  if (which == 38) return hz_hook_function_offset(0x137cf84ull, hz_direct_probe_observer);
  // which == 39: call sendSsoInternal from inside the observer -- same thread, valid body, with a
  // re-entry guard.
  //
  // The earlier direct-call experiment (2.3ai) proved that ANOTHER thread cannot call this: the
  // client dies even with a valid body. But that says nothing about this thread. Entering
  // re-entrantly was also tried once and died, except that attempt passed an invalid marker where
  // a protobuf belongs, so nesting and payload validity were conflated a second time.
  //
  // If a nested call survives, it is strictly better than substitution: the original call proceeds
  // untouched, so nobody's message is lost, and the reply is in hand when the call returns rather
  // than arriving on somebody else's send.
  if (which == 39) return hz_hook_function_offset(0x137cf84ull, hz_nested_probe_observer);
  // which == 40: substitute the body AND capture the reply, by attaching a post-call callback.
  //
  // The substitution path is the only one that survives (MEMORY 2.3aj), but on its own it is
  // fire-and-forget: the caller is told the request was armed, not what the server answered. The
  // reply is written into the `out` block after the callee returns, so the relay has to be able
  // to run code there too.
  if (which == 40) {
    static const unsigned char kBody[] = {
        0x0a, 0x08, 0x12, 0x06, 0x08, 0xea, 0x98, 0xc0, 0xba, 0x01,
        0x12, 0x02, 0x08, 0x01,
        0x1a, 0x11, 0x0a, 0x0f, 0x12, 0x0d, 0x0a, 0x0b, 0x0a, 0x09,
        0x68, 0x61, 0x69, 0x7a, 0x61, 0x6b, 0x75, 0x72, 0x61,
        0x28, 0xb2, 0xff, 0xd5, 0xc8, 0x07,
    };
    static const unsigned char kNoCmd[1] = {0};
    (void)hz_arm_send_inject(kNoCmd, 0, kBody, sizeof(kBody));
    const int idx = hz_hook_function_offset(0x137cf84ull, hz_inject_observer);
    if (idx < 0) return idx;
    // Record the result instead of discarding it.
    //
    // The void cast this replaces made a refused registration look identical to a successful one:
    // the send hook fired while the post-call callback never ran, and nothing said which had
    // happened.
    const int after_rc = hz_hook_set_after(static_cast<unsigned>(idx), hz_send_after);
    {
      const int lf = ::open("/tmp/hz-payload.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
      if (lf >= 0) {
        char lb[160];
        const int ln = std::snprintf(
            lb, sizeof(lb), "which40: set_after idx=%d rc=%d relay=0x%llx after=0x%llx\n",
            idx, after_rc,
            static_cast<unsigned long long>(hz_hook_relay_of_return(static_cast<unsigned>(idx))),
            static_cast<unsigned long long>(
                reinterpret_cast<std::uint64_t>(&hz_send_after)));
        if (ln > 0) (void)::write(lf, lb, static_cast<std::size_t>(ln));
        ::close(lf);
      }
    }
    return idx;
  }
  if (which == 35) {
    // The command argument is deliberately left alone now, so no command object is prepared:
    // QQ already passes MessageSvc.PbSendMsg and rewriting it corrupts it.
    static const unsigned char kNoCmd[1] = {0};
    // A minimal but valid MessageSvc.PbSendMsg for group 123456 carrying one text element.
    // Bytes checked against the reference encoder: routingHead.grp at field 2, contentHead.type
    // as a varint, richText at field 1 of the body and elems at field 2 of it.
    static const unsigned char kBody[] = {
        0x0a, 0x08, 0x12, 0x06, 0x08, 0xea, 0x98, 0xc0, 0xba, 0x01,  // routingHead.grp.groupCode
        0x12, 0x02, 0x08, 0x01,                                      // contentHead.type = 1
        0x1a, 0x11, 0x0a, 0x0f, 0x12, 0x0d, 0x0a, 0x0b, 0x0a, 0x09,  // messageBody.richText.elems
        0x68, 0x61, 0x69, 0x7a, 0x61, 0x6b, 0x75, 0x72, 0x61,        // "haizakura"
        0x28, 0xb2, 0xff, 0xd5, 0xc8, 0x07,                          // random
    };
    (void)hz_arm_send_inject(kNoCmd, 0, kBody, sizeof(kBody));
    return hz_hook_function_offset(0x137cf84ull, hz_inject_observer);
  }
  // which == 7: probe the MSF send surface without sending anything.
  //
  // This answers the one question that decides whether a send is reachable at all: is QQ's MSF
  // layer initialised in this process? MSFSDK::sendPacket returns -1 immediately unless the byte
  // at 0x8a03b02 is 1, and sendPacket@plt has exactly two call sites in the reference, both aimed
  // at the Node descriptor -- so no existing code path demonstrates what a ready MSF looks like
  // from outside.
  if (which == 7) return hz_probe_msf_state();
  return -99;
}

extern "C" int snowluma_linux_hook_start_dynamic() {
  trace("[payload] enter start_dynamic\n");

  // Observation-only mode: install the diagnostic hooks, bind nothing.
  //
  // This is the entry version of haizakura_linux_hook_install_observer_only. It exists because
  // calling an arbitrary export through the injector's remote thread did not survive: the remote
  // call faulted inside the target and took the injector down with it, while the entry -- which
  // runs on QQ's own thread with its own stack -- is the path that has always worked.
  //
  // HZ_OBSERVER_ONLY=0..6 selects the hook set; see the installer for what each one means.
  if (!g_ctor_binding) {
    // A file, not only an environment variable: the entry runs inside QQ, and QQ's environment
    // was fixed at container start -- there is no way to add a variable to a live process. A file
    // in /tmp is writable from outside and readable from inside, which is the whole requirement.
    char only_buf[32] = {0};
    const char* only = env_or("HZ_OBSERVER_ONLY", nullptr);
    if (only == nullptr) {
      const int mfd = ::open("/tmp/hz-observer-only", O_RDONLY | O_CLOEXEC);
      if (mfd >= 0) {
        const ssize_t got = ::read(mfd, only_buf, sizeof(only_buf) - 1);
        ::close(mfd);
        if (got > 0) {
          only_buf[got] = '\0';
          for (int i = 0; i < got; ++i) {
            if (only_buf[i] == '\n') { only_buf[i] = '\0'; break; }
          }
          only = only_buf;
        }
      }
    }
    if (only != nullptr) {
      // Hand-rolled parse, not strtol.
      //
      // glibc 2.38 turned strtol into __isoc23_strtol, and QQ's container ships an older glibc,
      // so referencing it fails the whole injection with "failed to resolve remote symbol
      // __isoc23_strtol" -- the same trap as std::string's _M_replace_cold. A one-digit switch
      // does not need a libc call.
      int which = -1;
      // Multi-digit, because the selector has outgrown the switch cases that fit in one digit
      // and a single-digit parse silently ran the wrong installer -- which/vau 20 arrived as 2.
      if (only[0] >= '0' && only[0] <= '9') {
        which = 0;
        for (int i = 0; only[i] >= '0' && only[i] <= '9'; ++i) which = which * 10 + (only[i] - '0');
      }
      const int rc = haizakura_linux_hook_install_observer_only(which);
      {
        const int rfd = ::open("/tmp/hz-obsonly-result.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
        if (rfd >= 0) {
          char rb[96];
          const int rn = std::snprintf(rb, sizeof(rb), "observer-only which=%d rc=%d\n", which, rc);
          if (rn > 0) (void)::write(rfd, rb, (size_t)rn);
          ::close(rfd);
        }
      }
      return rc;
    }
  }
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
  // Fall back to a path of our own when the derived one is already taken.
  //
  // Two live sockets can share one path name: unlinking and rebinding moves the name to a new
  // inode but cannot touch an established connection, so a peer that connected earlier keeps
  // talking to whoever it connected to (MEMORY §2.3ap, proven with inodes). The result was a
  // control channel that answered nothing we sent, because the answers came from the other
  // instance.
  //
  // A distinct name removes the ambiguity instead of trying to win a race: whoever dials
  // `...hz.control.sock` is definitely talking to this build. The derived name stays the first
  // choice so the normal Node side keeps working.
  char hz_control[sizeof(sockaddr_un::sun_path)] = {0};
  // Whether the control socket had to be renamed to avoid a live name clash. The recv socket
  // has to follow the same decision, so the flag is kept rather than re-derived.
  bool disambiguated = false;
  // Rename ALWAYS, not only when the derived name looks taken.
  //
  // The old test was `socket_is_live(control)`, which is a race with the reference payload: if
  // our constructor runs before theirs, the name is free, we take it, and then THEY bind over it
  // (unlink+rebind moves the name without disturbing our accepted connections). From then on the
  // Node side's connect lands on whichever payload bound last, and every symptom is ambiguous --
  // measured 2026-11-24: our ACKs came back from their payload, so a command we had not even
  // implemented looked like it succeeded.
  //
  // A name that is ours by construction cannot be raced. The derived name stays in use only when
  // explicitly forced with HZ_CONTROL_SOCK, which is the case tests and probes rely on.
  if (!using_override) {
    const std::size_t n = std::strlen(derived_control);
    const char* suffix = ".hz.control.sock";
    const std::size_t keep = n >= 13 ? n - 13 : n;  // strip ".control.sock"
    if (keep + std::strlen(suffix) + 1 < sizeof(hz_control)) {
      std::memcpy(hz_control, derived_control, keep);
      std::strcpy(hz_control + keep, suffix);
      std::printf("[payload] %s is live; using %s instead\n", control, hz_control);
      control = hz_control;
      disambiguated = true;
    }
  }
  // The readiness marker lives NEXT TO the socket, not at a fixed /tmp path.
  //
  // It publishes the bound paths (see write_started), and its whole purpose is to let the Node
  // side discover a socket whose name it cannot derive. A client resolves `<runtimeDir>` for
  // itself, so a marker at a hard-coded /tmp path is invisible to it -- which is exactly the bug
  // this replaces: the file held the right answer and nobody read it, so the client dialled the
  // reference implementation's socket instead and received plausible ACKs from the wrong peer.
  char started_buf[sizeof(sockaddr_un::sun_path) + 32] = {0};
  const char* started_env = env_or("HZ_CONTROL_STARTED", nullptr);
  const char* started = started_env;
  if (started == nullptr) {
    const std::size_t clen = std::strlen(control);
    const std::size_t keep = clen >= 13 ? clen - 13 : clen;  // strip ".control.sock"
    if (keep + 19 < sizeof(started_buf)) {
      std::memcpy(started_buf, control, keep);
      std::strcpy(started_buf + keep, "-control.started");
      started = started_buf;
    } else {
      started = kDefaultStarted;
    }
  }
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
    } else if (disambiguated && std::strlen(control) + 5 < sizeof(g_recv_path) &&
               std::strlen(control) > 16 &&
               std::strcmp(control + std::strlen(control) - 16, ".hz.control.sock") == 0) {
      // The control socket was renamed to escape a name clash, so the recv socket MUST be
      // renamed the same way. Both listeners belong to one payload; splitting them across two
      // names means the client talks to this build on control and to the OTHER payload on recv,
      // which produces ACKs from one side and silence from the other. Measured 2026-11-24: the
      // derived recv name was the reference implementation's, so a direct send succeeded (the
      // message really did reach the group) while its reply went to a socket we never owned.
      // mojo.<pid>.hz.control.sock  ->  mojo.<pid>.hz.recv.sock
      const std::size_t keep = std::strlen(control) - 16;  // strip ".hz.control.sock" (16 chars)
      std::memcpy(g_recv_path, control, keep);
      std::strcpy(g_recv_path + keep, ".hz.recv.sock");
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
    // Say what was chosen. Without this the recv channel can fail (or pick another payload's
    // name) and the only symptom is that a direct send's reply never arrives -- which looks like
    // the send failed, when in fact it succeeded and its answer went elsewhere.
    std::printf("[payload] recv path chosen: %s\n", g_recv_path);
    std::fflush(stdout);
    {
      const int rf = ::open("/tmp/hz-recvpath.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
      if (rf >= 0) {
        (void)::write(rf, g_recv_path, std::strlen(g_recv_path));
        (void)::write(rf, "\n", 1);
        ::close(rf);
      }
    }
    const int rfd = listen_unix(g_recv_path, 8);
    if (rfd < 0) {
      std::printf("[payload] recv channel failed (%d), continuing with control only\n", rfd);
      g_recv_path[0] = '\0';
    } else {
      g_recv_fd = rfd;
      std::printf("[payload] recv listening on %s (fd=%d)\n", g_recv_path, rfd);
      // Rewrite the readiness marker now that the recv path is known.
      //
      // The listener thread writes it too, and it wins the race whenever it gets scheduled
      // during this function -- which it does, because pthread_create above happens before this
      // point on the control side. That first write therefore records `recv=` as empty, and a
      // client polling the file would conclude there is no recv channel and never subscribe to
      // send replies. Idempotent rewrite is cheaper than an ordering guarantee between two
      // threads that both need the same file.
      write_started(started, static_cast<long>(::syscall(SYS_gettid)), control, g_recv_path);
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

extern "C" void hz_sweep_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                  uint64_t a2, uint64_t a3, uint64_t* frame) {
  (void)a0; (void)a1; (void)a2; (void)a3;
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

// Logs the std::Cr string at `base + off`.
//
// Decoding itself now lives in src/cr_string.cc, because the same rule has to be applied by
// the receive-slot observer and by this diagnostic, and a second copy is how the two of them
// drift apart. The layout, and why it is Chromium libc++ rather than libstdc++, is documented
// there; the short version is {cap @ +0, size @ +8, ptr @ +16} with SSO 22 (0x16).
//
// Note the send path is a DIFFERENT object whose observed long-form flag 0x33 with a 25-byte
// payload fits the (len<<1)|1 convention; the two layouts must not be assumed identical. The
// decoder here is the receive-side one.
//
// Only printable bytes are logged: a protobuf body would otherwise carry control bytes into a
// text file and make it unreadable. A failed or implausible decode costs a log line rather
// than a crash, which is the whole reason hz_cr_decode guards every read.
static void dump_cr_string(int fd, const char* tag, uint64_t base, unsigned off) {
  if (fd < 0) return;
  char text[HZ_CR_MAX_LEN + 1];
  size_t declared = 0;
  if (hz_cr_decode(base, off, text, sizeof(text), &declared) == 0) {
    char line[96];
    const int n = snprintf(line, sizeof(line), "  %s off=0x%x (unreadable)\n", tag, off);
    if (n > 0) (void)::write(fd, line, (size_t)n);
    return;
  }
  if (declared == 0 || declared > HZ_CR_MAX_LEN) {
    char line[96];
    const int n =
        snprintf(line, sizeof(line), "  %s off=0x%x len=%llu (skipped)\n", tag, off,
                 (unsigned long long)declared);
    if (n > 0) (void)::write(fd, line, (size_t)n);
    return;
  }
  const size_t take = static_cast<size_t>(declared);
  char out[HZ_CR_MAX_LEN + 1];
  for (size_t i = 0; i < take; ++i) {
    const unsigned char c = static_cast<unsigned char>(text[i]);
    out[i] = (c >= 0x20 && c < 0x7f) ? static_cast<char>(c) : '.';
  }
  out[take] = '\0';
  char line[1200];
  const int n = snprintf(line, sizeof(line), "  %s off=0x%x len=%llu \"%s\"\n", tag, off,
                         (unsigned long long)declared, out);
  if (n > 0) (void)::write(fd, line, (size_t)((n < (int)sizeof(line)) ? n : (int)sizeof(line)));
}

// Dumps a MSFRequest using the layout recovered from MSFSDK::pack.
//
// The point is not that this observer does anything; it is that one run of a real
// send turns the layout table from a reading of the disassembly into an observed
// fact, and answers what the three required strings actually contain.
extern "C" void hz_req_observer(uint32_t hook, uint64_t original, uint64_t a0, uint64_t a1,
                                uint64_t a2, uint64_t a3, uint64_t* frame) {
  (void)hook; (void)original; (void)a2; (void)a3;
  const int fd = ::open("/tmp/hz-req.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
  if (fd < 0) return;
  // pack takes unique_ptr<MSFRequest> by reference, so the object is at [a1].
  unsigned long long req = 0;
  if (!hz_safe_read(a1, &req, sizeof(req)) || req == 0) {
    const char* m = "pack: could not read unique_ptr\n";
    std::size_t mn = 0;
    while (m[mn] != '\0') ++mn;
    (void)::write(fd, m, mn);
    ::close(fd);
    return;
  }
  int32_t kind = 0;
  int32_t f10 = 0;
  (void)hz_safe_read(req + 0, &kind, sizeof(kind));
  (void)hz_safe_read(req + 0x10, &f10, sizeof(f10));
  char line[128];
  const int n = snprintf(line, sizeof(line), "pack req=0x%llx kind=%d f10=%d\n",
                         req, kind, f10);
  if (n > 0) (void)::write(fd, line, (size_t)n);
  dump_cr_string(fd, "s20", req, 0x20);
  dump_cr_string(fd, "s38", req, 0x38);
  dump_cr_string(fd, "s50", req, 0x50);
  dump_cr_string(fd, "s80", req, 0x80);
  dump_cr_string(fd, "s98", req, 0x98);
  ::close(fd);
}

extern "C" void hz_probe_observer(uint32_t hook, uint64_t original, uint64_t a0, uint64_t a1,
                                  uint64_t a2, uint64_t a3, uint64_t* frame) {
  (void)a0; (void)a1; (void)a2; (void)a3;
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

// Records what a hooked send-path call carried, without dereferencing anything.
//
// Deliberately does not follow a0: on the MSF send path a0 is a `Cr::unique_ptr<MSFRequest>`
// passed by value, so whether the pointer sits at a0 or at [a0] depends on an ABI this payload
// has not verified for QQ's own std::Cr. Reading the register is free and always safe; reading
// through it is the part that needs evidence first. So this logs the raw registers, and the
// object's layout can then be inferred from calls whose command name is already known.
//
// Writes with write(2) rather than printf: this runs on QQ's thread, and stdout is the client's.
// A register-only observer for functions on a hot path.
//
// hz_spy_observer opens, writes and closes a file per call. That is fine on sendSsoInternal,
// which runs only when a user sends a message, and fatal on MSF::MSFSDK::sendPacket, which
// carries every outbound packet including heartbeats and ACKs -- the file IO pushed the
// heartbeat past its timeout, the pipe was torn down, and QQ reported the client as closed
// while itself staying alive.
//
// So this one does nothing that can block: a few integer stores into a preallocated ring, and
// one counter bump. No allocation, no syscall, no formatting. The ring is fixed size and wraps,
// so a long session keeps the most recent calls rather than growing without bound.
namespace {
struct HotCall {
  std::uint64_t target;
  std::uint64_t a0;
  std::uint64_t a1;
  std::uint64_t a2;
};
constexpr unsigned kHotRing = 64;
HotCall g_hot_ring[kHotRing];
unsigned g_hot_index = 0;
}

// Not in the anonymous namespace: the capture observer above needs to bump it, and an internal
// symbol could not be referenced from a declaration that appears earlier in the file.
unsigned long long g_hot_total = 0;

extern "C" void hz_hot_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                uint64_t a2, uint64_t a3, uint64_t* frame) {
  (void)slot;
  (void)a3;
  const unsigned i = g_hot_index;
  g_hot_ring[i & (kHotRing - 1)] =
      HotCall{original, a0, a1, a2};
  g_hot_index = i + 1;
  ++g_hot_total;
}

// Dumps the hot ring to a file. Called from the control channel, never from a hooked function,
// which is the point: the write happens once on demand rather than once per packet.
extern "C" int hz_dump_hot_ring() {
  const int fd = ::open("/tmp/hz-hot.log", O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) return -1;
  char b[192];
  const int hdr = ::snprintf(b, sizeof(b), "hot total=%llu ring=%u\n",
                             g_hot_total, g_hot_index);
  if (hdr > 0) (void)::write(fd, b, (size_t)hdr);
  const unsigned n = (g_hot_index < kHotRing) ? g_hot_index : kHotRing;
  const unsigned start = (g_hot_index < kHotRing) ? 0u : (g_hot_index & (kHotRing - 1));
  for (unsigned k = 0; k < n; ++k) {
    const HotCall& c = g_hot_ring[(start + k) & (kHotRing - 1)];
    const int m = ::snprintf(b, sizeof(b), "  t=0x%llx a0=0x%llx a1=0x%llx a2=0x%llx\n",
                             (unsigned long long)c.target, (unsigned long long)c.a0,
                             (unsigned long long)c.a1, (unsigned long long)c.a2);
    if (m > 0) (void)::write(fd, b, (size_t)m);
  }
  ::close(fd);
  return 0;
}

extern "C" void hz_spy_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                uint64_t a2, uint64_t a3, uint64_t* frame) {
  // Open and close per call rather than caching a static descriptor.
  //
  // The cached version never produced a single line across several experiments, including one
  // where 49 slots installed cleanly and a real message reached the group. Two candidate causes
  // were a static in a hand-mapped image (already known to be unreliable here) and the descriptor
  // being opened on whichever thread happened to arrive first. Neither is worth carrying: this is
  // a diagnostic on a path that runs a few dozen times, not a hot loop.
  const int fd = ::open("/tmp/hz-spy.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
  if (fd < 0) return;
  char line[192];
  const int n = snprintf(line, sizeof(line),
                         "spy slot=%u orig=0x%llx a0=0x%llx a1=0x%llx a2=0x%llx a3=0x%llx\n",
                         slot, (unsigned long long)original, (unsigned long long)a0,
                         (unsigned long long)a1, (unsigned long long)a2,
                         (unsigned long long)a3);
  if (n > 0) (void)::write(fd, line, (size_t)((n < (int)sizeof(line)) ? n : (int)sizeof(line)));
  ::close(fd);
}

// Records write(2)/send(2) entries together with a short prefix of the buffer.
//
// The registers are the whole point: for write they are (fd, buf, count), so a0 names the
// descriptor and a1/a2 give the bytes. Logging only the numbers already told us nothing; logging
// the first bytes is what lets a frame header or a protobuf tag be recognised in the output.
//
// Printable-only, and truncated hard, because this runs inside the send path of a live client:
// a slow or allocating observer here would change the timing of the very thing being measured.
// Captures the MSFService instance from a live sendSsoInternal call.
//
// The instance is not something we can construct -- its layout is large and its constructor
// takes arguments we do not have. But every real send passes one in a0, so the first send after
// installation hands it to us for free. Once stored, we can call sendSsoInternal ourselves.
// Forwards a send with a rewritten body, using the arguments QQ already supplied.
//
// Why this and not a fabricated call: sendSsoInternal's cmd argument is a C++ object whose first
// word is a vtable pointer, and building one from outside crashes the client. But when the call is
// already in flight those objects exist and are valid -- they were constructed by QQ moments ago.
// So the rewrite reuses them verbatim and replaces only the payload span, which is a plain
// {begin, end, cap} triple that this payload can build.
//
// The re-entrancy guard is essential and not defensive coding. Calling the same function from its
// own hook recurses immediately and forever: the relay fires again, forwards again, and QQ dies
// with a stack overflow that looks like a wild pointer. A per-thread flag turns that into a single
// clean nested call.
extern "C" void hz_forward_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                   uint64_t a2, uint64_t a3, uint64_t* frame);

// A plain global, NOT thread_local.
//
// thread_local here broke the manual loader: a hand-mapped image has no TLS block, so the loader
// rejected the whole payload with "payload uses thread-local storage (TLS relocation), which the
// manual loader does not implement". That surfaced as thread_inject failing with "injection raised
// no error" -- the payload was simply refused, which is a much worse failure mode than recursion,
// because nothing in the send path is exercised at all.
//
// The re-entrancy guard does not actually need per-thread scope: sendSsoInternal is called from
// whatever thread QQ uses to dispatch a message, and a nested call on the same thread is the case
// being guarded. Two threads sending simultaneously would serialise on this flag, which costs a
// little concurrency and cannot corrupt anything -- but to keep that from being a correctness
// question at all, it is only set around the immediate forward call.
namespace {
int g_in_forward = 0;
}

// A send request captured from a live call, deep-copied so it can be replayed from another thread.
//
// The point of copying is to stop being nested inside QQ's own call. Attempting the replay from
// the observer itself killed the client three times (see MEMORY 2.3t) for reasons that have nothing
// to do with the arguments: the callee is not re-entrant, the observer runs inside the relay's
// frame, and x16 is undefined there. A copy taken now and used later on a fresh thread inherits
// none of that.
struct CapturedSend {
  volatile int ready;                 // 0 = empty, 1 = captured, 2 = claimed
  std::uint64_t instance;
  unsigned char cmd[32];              // the SSO header word plus up to 31 characters
  unsigned char body[4096];
  std::size_t body_len;
  std::uint32_t flag;
  // x4 of the captured call: the ctx whose `+0x10` slot the callee jumps to for the reply
  // callback. Replaying without it is what killed the client every previous time -- the replay
  // passed a zeroed 128-byte scratch buffer, the callee loaded a null vtable out of it, and
  // jumped there. QQ's own ctx has to be reused; it cannot be fabricated.
  std::uint64_t ctx;
};

// One slot is enough: two simultaneous sends would race, and the value of this structure is a
// single successful replay, not throughput. A second capture while one is pending is dropped.
CapturedSend g_captured_send;
// Declared before the capture observer uses it; defined with the hot ring further down.
extern unsigned long long g_hot_total;

// Records the command header byte of every call, so heartbeat and message can be told apart.
//
// This is the question that decides the architecture: sendSsoInternal runs on a timer, so an
// observer that only says "it fired" cannot distinguish a heartbeat from a real send -- and for
// six hours today those two were treated as the same event, which made every result ambiguous.
//
// The header word encodes both the length and the inline-form bit, so one byte is enough: 0x51
// is a 40-character command with a six-byte body, which is a heartbeat, and 0x28 is
// MessageSvc.PbSendMsg with a real protobuf behind it. Counting each separately turns "did it
// fire" into "which one fired", and the second is the only answer that matters.
//
// Register-only, because this may be on a periodic path.
namespace {
constexpr unsigned kCmdRing = 128;
unsigned char g_cmd_ring[kCmdRing];
unsigned g_cmd_index = 0;
unsigned long long g_cmd_msg = 0;   // calls whose command begins with 0x28 (MessageSvc.PbSendMsg)
unsigned long long g_cmd_other = 0; // everything else, which includes heartbeats
unsigned long long g_cmd_total = 0;
unsigned int g_cmd_len[kCmdRing];
unsigned char g_cmd_head[kCmdRing * 4];
unsigned g_cmd_detail_count = 0;
}

// ── The send injector ────────────────────────────────────────────────────────────────────────
//
// This is the mechanism the whole project was aimed at: make QQ transmit a payload of ours over
// its own authenticated connection, without opening a second connection and without calling the
// send function ourselves.
//
// Why it has to be done this way is recorded in MEMORY §2.3aa. sendSsoInternal carries the
// heartbeat as well as real messages, so it is in continuous use; a call of our own from another
// thread collides with a heartbeat and kills the client, and every attempt to enter it
// recursively did the same. But it is entered constantly by QQ itself -- which means a moment
// always exists when QQ is already inside it, on its own thread, with its own valid state.
//
// So instead of calling it, we wait for QQ to enter it and change the arguments in flight. That
// is a substitution, not a call: the function runs once, on its own stack, with the connection
// state only ever touched by one thread.
//
// What gets substituted is the fix that took longest to reach: `MessageSvc.PbSendMsg` is exactly
// 20 characters, so it fits the 23-byte inline SSO buffer the heartbeat uses and can be written
// over the existing command in place, without moving the object the client allocated. The body is
// swapped for a real encoded request from ts/src/send-message-request.ts, verified byte-identical
// to the reference. Feeding it a plain-text marker, as earlier attempts did, crashed the parser.
namespace {
constexpr std::size_t kMaxInjectBody = 4096;
unsigned char g_inject_cmd[32];   // "MessageSvc.PbSendMsg" in inline SSO form
unsigned char g_inject_body[kMaxInjectBody];
std::size_t g_inject_body_len = 0;
volatile int g_inject_armed = 0;  // set once the command and body are in place
volatile int g_inject_done = 0;   // one-shot: fire at most once, so a mistake cannot spam a group
unsigned long long g_inject_fired = 0;
unsigned long long g_inject_skipped = 0;
// What the injector actually saw at x1, so a refusal can be read rather than guessed.
constexpr unsigned kSeenRing = 8;
unsigned int g_seen_len[kSeenRing];
unsigned char g_seen_flag[kSeenRing];
unsigned g_seen_count = 0;

// A struct matching the three-pointer range sendSsoInternal expects for the body.
struct BodyRange {
  const unsigned char* begin;
  const unsigned char* end;
  const unsigned char* cap;
};
BodyRange g_inject_range;

// P0-c: the reply, captured for the Node side.
//
// The substituted `sendSsoInternal` writes its response into a block that lives in the
// relay's frame, so the post-call callback is the only place it can be read. This buffer
// is where it is copied before the frame dies; `g_reply_len == 0` means "the callee
// produced nothing", which is a legitimate outcome (the early-error path) and not an
// error to be dressed up.
//
// Sized to `kMaxInjectBody`: a reply is a protobuf envelope around a
// `PbSendMsgResponse`, and every one observed so far is far smaller (39–41 bytes). The
// limit exists so a wild `end` pointer cannot make us copy megabytes onto the send
// thread; the guard below refuses rather than truncates.
constexpr std::size_t kMaxReplyBytes = kMaxInjectBody;
unsigned char g_reply_body[kMaxReplyBytes];
}  // namespace

// Which INJ0 armed the send whose reply this is. Zero means "no reply is owed".
//
// Defined at file scope rather than inside the anonymous namespace above because `emit_packet`
// (near the top of this file) stamps the recv frame with it, and that function is compiled
// before this block is reached.
std::uint32_t g_inject_request_id = 0;
char g_inject_request_cmd[64] = {0};

// Defined at file scope for the same reason as g_inject_request_id: the DSND branch near the top
// of the file clears them before a direct call.
std::size_t g_reply_len = 0;
std::int64_t g_reply_status = 0;

// Arms the injector. `cmd` is the raw inline SSO string bytes (flag byte first), `body` the
// encoded request. Returns 0 on success.
// Read-only accessors, so the control channel can report the counters without the counters
// themselves being exported and writable from outside this module.
extern "C" unsigned g_seen_dump(unsigned char* lens, unsigned char* flags) {
  const unsigned n = g_seen_count < kSeenRing ? g_seen_count : kSeenRing;
  for (unsigned i = 0; i < n; ++i) {
    lens[i] = static_cast<unsigned char>(g_seen_len[i]);
    flags[i] = g_seen_flag[i];
  }
  return n;
}

extern "C" unsigned long long hz_inject_fired_count() { return g_inject_fired; }
extern "C" unsigned long long hz_inject_skipped_count() { return g_inject_skipped; }
extern "C" int hz_inject_done_flag() { return g_inject_done; }

extern "C" int hz_arm_send_inject(const unsigned char* cmd, std::size_t cmd_len,
                                  const unsigned char* body, std::size_t body_len) {
  // A zero-length command is meaningful now: it means "substitute only the body". The command
  // QQ passes is already MessageSvc.PbSendMsg and must not be touched, so the injector is
  // routinely armed with no command at all.
  if (cmd == nullptr || body == nullptr) return -1;
  if (cmd_len > sizeof(g_inject_cmd) || body_len > kMaxInjectBody) return -2;
  if (cmd_len > 0) std::memcpy(g_inject_cmd, cmd, cmd_len);
  std::memset(g_inject_cmd + cmd_len, 0, sizeof(g_inject_cmd) - cmd_len);
  std::memcpy(g_inject_body, body, body_len);
  g_inject_body_len = body_len;
  g_inject_range.begin = g_inject_body;
  g_inject_range.end = g_inject_body + body_len;
  g_inject_range.cap = g_inject_body + body_len;
  g_inject_done = 0;
  g_inject_armed = 1;
  return 0;
}

// Arms the injector and records which request the eventual reply belongs to.
//
// Separate entry point rather than a changed signature, because `hz_arm_send_inject` is
// called from three places that do not have a request id (the diagnostic paths at
// `which == 34/35` and the op-2 send-command branch). Giving those a fake id would make
// the Node side settle an unrelated waiter, so they keep arming with "no reply owed".
extern "C" int hz_arm_send_inject_for_request(const unsigned char* cmd, std::size_t cmd_len,
                                              const unsigned char* body, std::size_t body_len,
                                              std::uint32_t request_id) {
  const int rc = hz_arm_send_inject(cmd, cmd_len, body, body_len);
  if (rc != 0) return rc;
  // Record which command this request is for, so the recv emitter can decide whether an arriving
  // packet answers it. `cmd` is the inline libc++ string object: flag byte, then characters.
  std::memset(g_inject_request_cmd, 0, sizeof(g_inject_request_cmd));
  if (cmd != nullptr && cmd_len > 1) {
    const std::size_t n = (cmd_len - 1 < sizeof(g_inject_request_cmd) - 1)
                              ? cmd_len - 1
                              : sizeof(g_inject_request_cmd) - 1;
    std::memcpy(g_inject_request_cmd, cmd + 1, n);
  } else {
    static const char kSendCmd[] = "MessageSvc.PbSendMsg";
    std::memcpy(g_inject_request_cmd, kSendCmd, sizeof(kSendCmd) - 1);
  }
  g_inject_request_id = request_id;
  // A fresh arm invalidates any reply captured for a previous one. Without this, a send
  // that produced no response would leave the PREVIOUS reply in the buffer, and the next
  // caller would be handed a body belonging to a different message -- a wrong answer that
  // looks exactly like a right one.
  g_reply_len = 0;
  g_reply_status = 0;
  return 0;
}

// The observer that performs the substitution.
//
// It leaves the heartbeat path completely untouched unless it is armed, and then fires once: the
// conditions are checked, the two pointers are rewritten through `frame`, and it disarms itself.
// Everything it does is register-level plus a memcpy from a buffer prepared ahead of time, so it
// is safe on a path that runs several times a second.

// ---------------------------------------------------------------------------
// Direct send: originate a message with no help from QQ's own send path
// ---------------------------------------------------------------------------
// The injector above substitutes into a send QQ was already making. That works, and it is how the
// first real delivery was proven -- but it needs somebody to type. A production OneBot has nobody
// typing, so substitution alone cannot serve `send_group_msg`.
//
// This is the missing half: call the function body ourselves, through the relay's replay stub, on
// our own thread.
//
// It only became possible once two fabricated arguments were replaced with real ones, and both
// previous "cannot be done" conclusions were wrong for the same reason -- a wrong argument was
// read as a fact about the callee:
//
//   1. the command object must be an INLINE libc++ string (`byte0 = len<<1`, LSB clear). The old
//      code set `| 1`, which selects the LONG form `{cap,size,ptr}` and made the callee dereference
//      bytes 16..23 as a pointer. (see hz_send_sso)
//   2. x4 must be QQ's own ctx, the object whose `+0x10` slot holds the reply callback. A zeroed
//      scratch buffer gives a null vtable and the first `blr` goes to address 0.
//      (see hz_replay_captured_send)
//
// With both fixed, `replay returned` appeared in /tmp/hz-replay.log and QQ stayed up -- the first
// time a direct call ever survived.
//
// What is still REQUIRED before this may run: a captured ctx. `hz_capture_instance_observer` must
// have seen one real send since the payload was installed. Without it this refuses rather than
// guess, because guessing here is a null jump on QQ's thread.
extern "C" int hz_direct_send(const unsigned char* cmd, std::size_t cmd_len,
                              const unsigned char* body, std::size_t body_len) {
  const int fd = ::open("/tmp/hz-direct.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
  auto log = [&](const char* text) { if (fd >= 0) (void)::write(fd, text, ::strlen(text)); };

  if (g_msf_instance == 0 || g_msf_ctx == 0) {
    log("no captured instance/ctx; refusing (a fabricated ctx jumps to null)\n");
    if (fd >= 0) ::close(fd);
    return -1;
  }
  if (cmd == nullptr || body == nullptr || body_len == 0) {
    log("bad arguments\n");
    if (fd >= 0) ::close(fd);
    return -2;
  }
  const std::size_t idx = hook_index_of_offset(0x137cf84ull);
  if (idx >= 256) { log("send entry is not hooked\n"); if (fd >= 0) ::close(fd); return -3; }
  const std::uint64_t stub = hook_replay_stub(idx);
  if (stub == 0) { log("no replay stub\n"); if (fd >= 0) ::close(fd); return -4; }

  // Build the command object here rather than accepting one from the caller: the inline-form
  // rule is a property of this ABI, and letting a caller supply the bytes would let it get the
  // flag wrong and crash QQ from outside this file.
  HzSsoStr name;
  for (unsigned i = 0; i < sizeof(name.raw); ++i) name.raw[i] = 0;
  const std::size_t n = ::strlen(reinterpret_cast<const char*>(cmd));
  if (n == 0 || n > sizeof(name.raw) - 1) { log("bad cmd length\n"); if (fd >= 0) ::close(fd); return -5; }
  name.raw[0] = static_cast<unsigned char>(n << 1);  // INLINE: LSB clear
  for (std::size_t i = 0; i < n; ++i) name.raw[1 + i] = cmd[i];

  HzRange range;
  range.begin = body;
  range.end = body + body_len;

  typedef void (*SendFn)(void*, const void*, const void*, std::uint32_t, void*);
  SendFn fn = reinterpret_cast<SendFn>(stub);

  {
    char b[192];
    const int m = ::snprintf(b, sizeof(b),
                             "direct cmd=%s len=%llu instance=0x%llx ctx=0x%llx\n",
                             reinterpret_cast<const char*>(cmd),
                             static_cast<unsigned long long>(body_len),
                             static_cast<unsigned long long>(g_msf_instance),
                             static_cast<unsigned long long>(g_msf_ctx));
    if (m > 0) (void)::write(fd, b, static_cast<std::size_t>(m));
  }
  fn(reinterpret_cast<void*>(g_msf_instance), &name, &range, 1u,
     reinterpret_cast<void*>(g_msf_ctx));
  log("direct returned\n");
  if (fd >= 0) ::close(fd);
  return 0;
}

// Records all five arguments of the send entry. Observe-only.
namespace {
constexpr unsigned kArgsRing = 8;
uint64_t g_args[kArgsRing * 5];
unsigned g_args_count = 0;
}

extern "C" void hz_args_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                 uint64_t a2, uint64_t a3, uint64_t* frame) {
  (void)slot;
  (void)original;
  // Write to a file rather than to BSS, and this is safe here for a reason worth stating:
  // sendSsoInternal is NOT a hot path. It is entered when a user sends a message and at no other
  // time -- twelve seconds of silence gave zero hits, one message gave one. The earlier rule
  // against file IO from an observer applies to functions like MSFSDK::sendPacket that carry
  // heartbeats; applying it here was over-cautious and cost several restarts.
  //
  // The file is also less error-prone than reading BSS: the payload is manually mapped, so a
  // symbol's link-time offset does not reliably locate it at runtime, and every attempt to read
  // these counters through /proc/pid/mem returned plausible garbage.
  const int fd = ::open("/tmp/hz-args.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
  if (fd < 0) return;
  char b[256];
  const int m = ::snprintf(
      b, sizeof(b),
      "args self=0x%llx cmd=0x%llx body=0x%llx flag=0x%llx out=0x%llx frame3=0x%llx frame4=0x%llx\n",
      (unsigned long long)a0, (unsigned long long)a1, (unsigned long long)a2,
      (unsigned long long)a3,
      (unsigned long long)((frame != nullptr) ? frame[4] : 0),
      (unsigned long long)((frame != nullptr) ? frame[3] : 0),
      (unsigned long long)((frame != nullptr) ? frame[2] : 0));
  if (m > 0) (void)::write(fd, b, (size_t)m);
  ::close(fd);
  ++g_args_count;
}

// Reads the recorded arguments back. Without a reader the stores above are dead and the compiler
// removes them, which silently produced an empty record on an earlier attempt.
// Calls sendSsoInternal directly, from a detached thread, with a valid body.
//
// The body is the same 39 bytes the working injector uses: a real MessageSvc.PbSendMsg for group
// 123456 carrying one text element. Its validity is the variable that changes here.
namespace {
unsigned char g_valid_body[64];
std::size_t g_valid_body_len = 0;
std::uint64_t g_direct_instance = 0;
volatile int g_direct_field_id = -1;   // -1 running, 0 "field log has a sender", 1 "print only"
char g_direct_out[512];
volatile int g_direct_rc = -999;
volatile int g_direct_done = 0;
}

// Reused by the reply path: hands back the last response body received from a direct call.
extern "C" int hz_valid_body_ready() { return g_valid_body_len > 0 ? 1 : 0; }
extern "C" const unsigned char* hz_valid_body_ptr() { return g_valid_body; }
extern "C" std::size_t hz_valid_body_len() { return g_valid_body_len; }

extern "C" void* hz_direct_send_thread(void*) {
  struct Range { const unsigned char* begin; const unsigned char* end; const unsigned char* cap; };
  Range range{g_valid_body, g_valid_body + g_valid_body_len, g_valid_body + g_valid_body_len};
  char out[512];
  std::memset(out, 0, sizeof(out));
  const int rc = hz_send_sso(g_direct_instance, "MessageSvc.PbSendMsg", g_valid_body,
                             g_valid_body_len);
  g_direct_rc = rc;
  g_direct_done = 1;
  (void)range;
  (void)out;
  return nullptr;
}

// Captures the instance from QQ's own call, then calls the function with a valid body from a
// separate thread.
//
// The instance cannot be known until QQ sends at least once, so this cannot simply fire at load
// time: it has to wait for the first real call to learn the pointer, then make its own. That
// ordering is the whole reason this is an observer rather than a start-up action.
extern "C" void hz_direct_probe_observer(uint32_t slot, uint64_t original, uint64_t a0,
                                         uint64_t a1, uint64_t a2, uint64_t a3,
                                         uint64_t* frame) {
  (void)slot;
  (void)original;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)frame;
  if (a0 != 0) g_msf_instance = a0;
  // Run the direct call exactly once, after the instance is known.
  static int started = 0;
  if (started) return;
  started = 1;
  (void)hz_call_send_with_valid_body();
}

extern "C" int hz_call_send_with_valid_body() {
  // Seed the body with the known-good encoding, so this runs without any control channel.
  static const unsigned char kBody[] = {
      0x0a, 0x08, 0x12, 0x06, 0x08, 0xea, 0x98, 0xc0, 0xba, 0x01,
      0x12, 0x02, 0x08, 0x01,
      0x1a, 0x11, 0x0a, 0x0f, 0x12, 0x0d, 0x0a, 0x0b, 0x0a, 0x09,
      0x68, 0x61, 0x69, 0x7a, 0x61, 0x6b, 0x75, 0x72, 0x61,
      0x28, 0xb2, 0xff, 0xd5, 0xc8, 0x07,
  };
  std::memcpy(g_valid_body, kBody, sizeof(kBody));
  g_valid_body_len = sizeof(kBody);
  g_direct_instance = g_msf_instance;
  if (g_direct_instance == 0) return -1;

  pthread_t tid;
  if (::pthread_create(&tid, nullptr, hz_direct_send_thread, nullptr) != 0) return -2;
  ::pthread_detach(tid);
  return 0;
}

extern "C" int hz_direct_send_state() {
  return (g_direct_rc << 8) | (g_direct_done & 1);
}

extern "C" unsigned hz_args_dump(uint64_t* out, unsigned capacity) {
  const unsigned n = g_args_count < capacity ? g_args_count : capacity;
  for (unsigned i = 0; i < n * 5; ++i) out[i] = g_args[i];
  return n;
}

// Captures the response after the substituted send completes.
//
// sendSsoInternal is synchronous from QQ's side: by the time it returns, the reply has been
// written into the `out` block at x4. But the observer runs BEFORE the call, so the reply does not
// exist yet there. Two hooks are therefore needed to close the loop -- one before the call to
// substitute the body, and one after the call to read the result.
//
// The second hook is what makes op 2 async rather than fire-and-forget: the Node side is waiting
// on a request id, and only the reply body can answer it.
namespace {
unsigned char g_resp[512];
unsigned long long g_after_calls = 0;
std::uint64_t g_after_out_addr = 0;
std::uint64_t g_after_result = 0;
std::size_t g_resp_len = 0;
unsigned long long g_resp_seq = 0;
volatile int g_resp_ready = 0;
}  // namespace

// Called after the substituted send returns, to harvest whatever the callee produced.
//
// `out` is a stack block the caller allocated. Its layout is not asserted here: the code reads the
// first two pointers and treats them as a begin/end range only when begin < end and the span is
// small and readable, because guessing wrong would mean copying from an arbitrary address. A
// zeroed or unrecognised block is reported as "no response" rather than as a decode failure.
// Whether [addr, addr+len) lies inside a readable mapping of this process.
//
// Needed because the value harvested after a send is a pair of pointers taken from an object whose
// layout is not fully known. Copying through a wrong guess would fault on QQ's send thread, and a
// diagnostic that can kill the client is worse than no diagnostic. Reading /proc/self/maps is the
// only way to answer this without a signal handler.
static int hz_range_readable(std::uint64_t addr, std::uint64_t len) {
  if (len == 0) return 0;
  const int fd = ::open("/proc/self/maps", O_RDONLY);
  if (fd < 0) return 0;
  char buf[4096];
  int found = 0;
  std::size_t used = 0;
  const std::uint64_t end = addr + len;
  while (used < sizeof(buf) - 1) {
    const ssize_t n = ::read(fd, buf + used, sizeof(buf) - 1 - used);
    if (n <= 0) break;
    used += static_cast<std::size_t>(n);
    buf[used] = '\0';
    const char* p = buf;
    while (*p != '\0') {
      const char* nl = p;
      while (*nl != '\0' && *nl != '\n') ++nl;
      std::uint64_t lo = 0, hi = 0;
      unsigned digits = 0;
      for (const char* q = p; q < nl; ++q) {
        const char c = *q;
        if (c == '-') { digits = 1; continue; }
        if (c == ' ') break;
        unsigned d;
        if (c >= '0' && c <= '9') d = static_cast<unsigned>(c - '0');
        else if (c >= 'a' && c <= 'f') d = static_cast<unsigned>(c - 'a' + 10);
        else break;
        if (digits == 0) lo = (lo << 4) | d; else hi = (hi << 4) | d;
      }
      // Fourth field carries the permission bits; require an r.
      const char* sp = nl;
      unsigned fields = 0;
      while (*sp != '\0' && *sp != '\n' && fields < 2) { if (*sp == ' ') ++fields; ++sp; }
      const int readable = (sp[0] == 'r');
      if (readable && lo <= addr && end <= hi) { found = 1; break; }
      if (*nl == '\0') break;
      p = nl + 1;
    }
    if (found) break;
    // Keep the last partial line so a boundary split does not lose an entry.
    if (used >= sizeof(buf) - 1) break;
  }
  ::close(fd);
  return found;
}

// Calls the send from inside the hook, on QQ's own thread, then lets the original call proceed.
//
// The guard matters: the address is patched, so the nested call re-enters this same observer. One
// level of recursion is the intent; a second would be a loop. The flag makes that explicit rather
// than relying on the body being different.
namespace {
volatile int g_nested_in_progress = 0;
volatile int g_nested_done = 0;
volatile int g_nested_rc = -999;
}

extern "C" void hz_nested_probe_observer(uint32_t slot, uint64_t original, uint64_t a0,
                                         uint64_t a1, uint64_t a2, uint64_t a3,
                                         uint64_t* frame) {
  (void)slot;
  (void)original;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)frame;
  // Never touch frame: the original send must go out unchanged. That is the point of this variant.
  if (g_nested_in_progress) return;
  if (g_nested_done) return;
  g_nested_in_progress = 1;
  if (a0 != 0) g_msf_instance = a0;

  static const unsigned char kBody[] = {
      0x0a, 0x08, 0x12, 0x06, 0x08, 0xea, 0x98, 0xc0, 0xba, 0x01,
      0x12, 0x02, 0x08, 0x01,
      0x1a, 0x11, 0x0a, 0x0f, 0x12, 0x0d, 0x0a, 0x0b, 0x0a, 0x09,
      0x68, 0x61, 0x69, 0x7a, 0x61, 0x6b, 0x75, 0x72, 0x61,
      0x28, 0xb2, 0xff, 0xd5, 0xc8, 0x07,
  };
  g_nested_rc = hz_send_sso(g_msf_instance, "MessageSvc.PbSendMsg", kBody, sizeof(kBody));
  g_nested_in_progress = 0;
  g_nested_done = 1;
}

extern "C" int hz_nested_state() { return g_nested_rc; }

extern "C" void hz_resp_capture(std::uint64_t out_ptr) {
  if (out_ptr == 0) return;
  const std::uint64_t* p = reinterpret_cast<const std::uint64_t*>(out_ptr);
  const std::uint64_t begin = p[0];
  const std::uint64_t end = p[1];
  if (begin == 0 || end <= begin) return;
  const std::uint64_t len = end - begin;
  if (len > sizeof(g_resp)) return;
  // Only copy when both ends fall inside a readable mapping; an unreadable address here would
  // fault on QQ's send thread and take the client down for a diagnostic.
  if (!hz_range_readable(begin, len)) return;
  std::memcpy(g_resp, reinterpret_cast<const void*>(begin), static_cast<std::size_t>(len));
  g_resp_len = static_cast<std::size_t>(len);
  g_resp_ready = 1;
  ++g_resp_seq;
}

// Post-call callback for the send relay.
//
// Runs after the substituted send returns, on QQ's own thread, with the result in `result` and
// the argument frame still intact. This is the only place the response exists: the callee writes
// it into the `out` block at x4, which is a stack address belonging to this frame, so it is gone
// once the frame is torn down.
//
// Everything here is done on cloned bytes and written to a preallocated buffer: this runs on the
// send path, and the rule from an earlier failure still holds -- an observer that does blocking
// work on a hot path takes the connection down.
extern "C" void hz_send_after(uint64_t result, uint64_t* frame) {
  (void)frame;
  ++g_after_calls;
  g_after_out_addr = result;
  g_after_result = result;

  // Record the return value and the 64 bytes around it, and nothing else.
  //
  // Three structural theories have now been tested and all three were wrong: x4 as an out-block, x0
  // as an object with a flag at +80, and a {begin,end,cap} triple at obj+0x50 whose "span" turned
  // out to be the distance between two function pointers. Each theory produced a plausible number
  // and each was disproved by looking at bytes.
  //
  // So this version does not interpret. It writes the return value, the first 64 bytes it points
  // at, and whether that address sits in an executable mapping. Whatever the reply turns out to be,
  // the evidence for it should be recorded before any theory is formed about it.
  {
    const int lf = ::open("/tmp/hz-after.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (lf >= 0) {
      char lb[512];
      int n = std::snprintf(lb, sizeof(lb), "call=%llu x0=0x%llx x0mod8=%llu",
                            static_cast<unsigned long long>(g_after_calls),
                            static_cast<unsigned long long>(result),
                            static_cast<unsigned long long>(result & 7u));
      // 64 bytes only if the pointer is plausibly readable: aligned, non-null, and inside the user
      // address range. A bad guess here faults inside QQ, so the guard matters more than the data.
      if (result != 0 && (result & 7u) == 0 && result > 0x1000ull && result < 0x0000ffffffffffffull) {
        const unsigned char* b = reinterpret_cast<const unsigned char*>(result);
        for (int i = 0; i < 64 && n < 460; ++i) {
          n += std::snprintf(lb + n, sizeof(lb) - static_cast<std::size_t>(n), " %02x",
                             static_cast<unsigned>(b[i]));
        }
      } else {
        n += std::snprintf(lb + n, sizeof(lb) - static_cast<std::size_t>(n), " (not dereferenced)");
      }
      if (n > 0 && n < 500) {
        lb[n++] = '\n';
        (void)::write(lf, lb, static_cast<std::size_t>(n));
      }
      ::close(lf);
    }
  }

  // -------------------------------------------------------------------------
  // Capture the reply bytes out of the argument frame.
  // -------------------------------------------------------------------------
  //
  // `frame` is the callee's argument snapshot: `frame[n] == x_n` at entry (the relay
  // stores x0..x5 at sp+0..sp+40 and passes `sp` as this second parameter, see the
  // comment at the `blr x11` in slot_relay.cc). So this needs no new ABI knowledge
  // beyond what the pre-call observer already uses when it writes `frame[2]`.
  //
  // The reply is NOT in x0/x1 (MEMORY 2.3ax, corrected): x0 is the callee's own stack
  // address. What the callee does is hand the response back through the object in x4 --
  // `137d490: mov x4, x22` feeds the same `{begin, end}` pair the pre-call side wrote --
  // and a response object reachable from there is what carries the body.
  //
  // Three candidate layouts, tried in order of how much they are trusted, each guarded so
  // a wrong guess reads nothing rather than faulting on QQ's send thread:
  //
  //   1. `x4` is itself a `{begin, end}` range (the same shape as x2). This is the shape
  //      the relay's own body substitution assumes, so it is the first one to test.
  //   2. `x4` points at a response object whose `+0x38` is a POINTER to `{begin, end}`.
  //      This is the layout proven for the receive path (`hz_recv_response_observer`).
  //   3. Nothing readable -- report `g_reply_len == 0` rather than inventing bytes.
  //
  // Whichever fires first wins; the choice is recorded in the diagnostic log so a later
  // reader can tell which one produced the bytes instead of having to re-derive it.
  g_reply_len = 0;
  g_reply_status = 0;
  if (frame != nullptr && g_inject_request_id != 0) {
    const std::uint64_t x4 = frame[4];
    auto copy_range = [](std::uint64_t begin, std::uint64_t end) -> bool {
      if (begin == 0 || end <= begin) return false;
      const std::uint64_t len = end - begin;
      // Refuse rather than truncate: a length over the cap means the "range" is not one,
      // and emitting the first 4 KiB of a wild span would hand the decoder a body that is
      // wrong in a way it cannot detect.
      if (len > kMaxReplyBytes) return false;
      if (!hz_range_readable(begin, len)) return false;
      std::memcpy(g_reply_body, reinterpret_cast<const void*>(begin), static_cast<std::size_t>(len));
      g_reply_len = static_cast<std::size_t>(len);
      return true;
    };

    const char* how = "none";
    bool got = false;
    if (x4 != 0) {
      // (1) x4 as a {begin, end} range.
      std::uint64_t b = 0, e = 0;
      if (hz_range_readable(x4, 16)) {
        std::memcpy(&b, reinterpret_cast<const void*>(x4), sizeof(b));
        std::memcpy(&e, reinterpret_cast<const void*>(x4 + 8), sizeof(e));
        if (copy_range(b, e)) { how = "x4-as-range"; got = true; }
      }
      // (2) x4 -> object whose +0x38 is a POINTER to {begin, end}.
      if (!got) {
        std::uint64_t range_ptr = 0;
        if (hz_range_readable(x4 + 0x38, 8)) {
          std::memcpy(&range_ptr, reinterpret_cast<const void*>(x4 + 0x38), sizeof(range_ptr));
          if (range_ptr != 0 && hz_range_readable(range_ptr, 16)) {
            if (hz_range_readable(range_ptr, 16)) {
              std::memcpy(&b, reinterpret_cast<const void*>(range_ptr), sizeof(b));
              std::memcpy(&e, reinterpret_cast<const void*>(range_ptr + 8), sizeof(e));
              if (copy_range(b, e)) { how = "x4->obj+0x38->range"; got = true; }
            }
          }
        }
      }
    }
    g_reply_status = static_cast<std::int64_t>(result);

    // Dump the neighbourhood of x4 so the next attempt can read bytes instead of guessing.
    //
    // Two candidate layouts were tried and both missed (`layout=none`), which is exactly the
    // situation where another guess costs another client restart. What is needed is the raw
    // memory: if x4 is an object, its first 16 bytes are a vptr and the reply is at some offset
    // that will show up as a pair of near-equal pointers into the heap; if x4 is a range, the
    // first 16 bytes are that pair. One dump distinguishes them without touching anything.
    {
      const int lf3 = ::open("/tmp/hz-x4.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
      if (lf3 >= 0) {
        char lb3[512];
        int n3 = std::snprintf(lb3, sizeof(lb3), "call=%llu x4=0x%llx got=%d layout=%s",
                               static_cast<unsigned long long>(g_after_calls),
                               static_cast<unsigned long long>(x4),
                               got ? 1 : 0, how);
        if (x4 != 0 && hz_range_readable(x4, 0x60)) {
          const unsigned char* p = reinterpret_cast<const unsigned char*>(x4);
          for (int i = 0; i < 0x60 && n3 < 470; ++i) {
            if ((i % 16) == 0) {
              n3 += std::snprintf(lb3 + n3, sizeof(lb3) - static_cast<std::size_t>(n3), "\n  +%03x:", i);
            }
            n3 += std::snprintf(lb3 + n3, sizeof(lb3) - static_cast<std::size_t>(n3), " %02x",
                                static_cast<unsigned>(p[i]));
          }
        } else {
          n3 += std::snprintf(lb3 + n3, sizeof(lb3) - static_cast<std::size_t>(n3),
                              " (x4 unreadable)");
        }
        if (n3 > 0 && n3 < 510) {
          lb3[n3++] = '\n';
          (void)::write(lf3, lb3, static_cast<std::size_t>(n3));
        }
        ::close(lf3);
      }
    }

    // Record which layout produced the bytes. This is the line that makes the next session
    // cheap: without it, "no reply" and "wrong layout" look identical.
    const int lf2 = ::open("/tmp/hz-reply.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (lf2 >= 0) {
      char lb2[256];
      const int n2 = std::snprintf(lb2, sizeof(lb2),
                                   "call=%llu reqId=%u x4=0x%llx layout=%s len=%llu\n",
                                   static_cast<unsigned long long>(g_after_calls),
                                   static_cast<unsigned>(g_inject_request_id),
                                   static_cast<unsigned long long>(x4), how,
                                   static_cast<unsigned long long>(g_reply_len));
      if (n2 > 0) (void)::write(lf2, lb2, static_cast<std::size_t>(n2));
      ::close(lf2);
    }
  }

  // -------------------------------------------------------------------------
  // The reply is NOT synthesised here. Measured, 2026-11-24 01:10.
  // -------------------------------------------------------------------------
  //
  // An earlier revision of this callback broadcast an op 4 frame carrying whatever it managed
  // to copy out of the argument frame. That was wrong, and worse than wrong: it was a SECOND
  // reply source competing with the real one.
  //
  // What the live experiment showed is that the response to `MessageSvc.PbSendMsg` arrives on
  // the **recv channel as an ordinary op 6 packet**, exactly like every other SSO command
  // (`recv-watch` logged `RECV op6 cmd=MessageSvc.PbSendMsg len=41 body=0800...` with
  // `field 1 = 0`, i.e. success, moments after the injected send went out). The recv slot
  // observer already forwards it. So the payload does not need to produce a reply at all --
  // and if it does, a caller waiting on that request id would be settled by the fake frame
  // (with `g_reply_len == 0` in every observed case) instead of by the real body.
  //
  // That is precisely the failure mode this project keeps having to undo: a plausible answer
  // that arrives faster than the true one.
  //
  // The two layout guesses that preceded this were both wrong, and the diagnostic is kept
  // (`/tmp/hz-x4.log`) because it records WHY: `x4` is the callee's `ctx` argument, not a
  // response out-block. `sendSsoInternal(this, cmd, buf, flag, ctx)` -- `docs/vtable-slots.md`
  // line 166 spells out the signature, and the live dump confirmed `x4` is not even readable
  // as a range. There is nothing to read back there.
  //
  // What this callback still does, and must: clear the correlation id so the next INJ0 is not
  // attributed to this send. See the recv-side correlation in `emit_packet`.
  g_inject_request_id = 0;
  g_reply_len = 0;
  g_reply_status = 0;
}

extern "C" unsigned long long hz_after_call_count() { return g_after_calls; }
extern "C" std::uint64_t hz_after_out_addr() { return g_after_out_addr; }
extern "C" std::uint64_t hz_after_result() { return g_after_result; }

extern "C" int hz_resp_is_ready() { return g_resp_ready; }
extern "C" unsigned long long hz_resp_seq_no() { return g_resp_seq; }
extern "C" std::size_t hz_resp_length() { return g_resp_len; }
extern "C" const unsigned char* hz_resp_body() { return g_resp; }

extern "C" void hz_inject_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                   uint64_t a2, uint64_t a3, uint64_t* frame) {
  (void)slot;
  (void)original;
  (void)a0;
  (void)a2;
  (void)a3;
  // Log which service command this call is for, read out of x1.
  //
  // Three calls happened while sending one message, and the return value was identical for two of
  // them -- which cannot be three sends. Rather than theorise about what the return value is, the
  // cheap discriminating question is which command each call carries: if none of them is
  // MessageSvc.PbSendMsg, then this hook is not on the send path at all and every byte collected so
  // far came from something else.
  //
  // cmd is a Chromium libc++ std::string, which the project rule says must never be rewritten.
  // Reading it is fine: long form has LSB 1 in byte 0 with {ptr,size,cap}, short form has LSB 0 and
  // the characters inline from byte 1.
  {
    const int cf = ::open("/tmp/hz-cmd.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (cf >= 0) {
      char lb[320];
      char name[160];
      name[0] = '\0';
      if (a1 != 0) {
        const unsigned char* sp = reinterpret_cast<const unsigned char*>(a1);
        if ((sp[0] & 1u) != 0) {
          const unsigned long long ptr = *reinterpret_cast<const unsigned long long*>(sp);
          const unsigned long long len = *reinterpret_cast<const unsigned long long*>(sp + 8);
          if (ptr != 0 && len > 0 && len < 150) {
            for (unsigned long long i = 0; i < len; ++i) {
              const unsigned char ch = reinterpret_cast<const unsigned char*>(ptr)[i];
              name[i] = (ch >= 32 && ch < 127) ? static_cast<char>(ch) : '?';
            }
            name[len] = '\0';
          }
        } else {
          const unsigned long long len = sp[0] >> 1;
          for (unsigned long long i = 0; i < len && i < 150; ++i) {
            const unsigned char ch = sp[1 + i];
            name[i] = (ch >= 32 && ch < 127) ? static_cast<char>(ch) : '?';
          }
          if (len < 150) name[len] = '\0';
        }
      }
      const int ln = std::snprintf(lb, sizeof(lb), "call=%llu cmd=[%s] firstbyte=0x%02x\n",
                                   static_cast<unsigned long long>(g_after_calls),
                                   name[0] ? name : "?", a1 ? reinterpret_cast<const unsigned char*>(a1)[0] : 0);
      if (ln > 0) (void)::write(cf, lb, static_cast<std::size_t>(ln));
      ::close(cf);
    }
  }
  // Only `g_inject_armed` gates this. `g_inject_done` used to, which made the injector a
  // single-shot: the second INJ0 re-armed the body but the observer returned immediately, so
  // every send after the first silently did nothing while reporting "armed". The observer now
  // clears `g_inject_armed` when it fires, so one arm still means one message and the
  // one-shot safety property is preserved by construction rather than by a second flag.
  if (frame == nullptr || !g_inject_armed) return;

  // a1 is the command object. Only substitute into a heartbeat-shaped call, so an ordinary
  // message send is never disturbed: the heartbeat's command length is 40 and its body 6 bytes,
  // while a real send is longer. Requiring the body range to be small keeps this to control
  // packets.
  if (a1 == 0) { ++g_inject_skipped; return; }

  // Substitute the body and nothing else.
  //
  // Every earlier attempt also rewrote the command object at x1, on the assumption that it is a
  // libstdc++ std::string in inline form where flag=(len<<1)|1 and the characters follow at +1.
  // Reading it during a live send shows otherwise: flag 0x33, length 25, and seven zero bytes
  // where the text should be. The mangled symbols explain why -- std::Cr is Chromium's libc++,
  // whose string layout is unrelated to libstdc++'s. So those writes were corrupting a command
  // QQ had already built correctly, which is the most likely reason two attempts killed the
  // client while the message itself was never at fault.
  //
  // The body needs no such knowledge. It is `{begin, end, capacity}`: three pointers, passed as
  // one argument in x2, which is frame[2]. Replacing that pointer with the address of our own
  // range substitutes the payload while leaving every other argument exactly as QQ set it.
  frame[2] = reinterpret_cast<uint64_t>(&g_inject_range);

  g_inject_done = 1;
  ++g_inject_fired;

  // P0-b: consume the arm rather than burn the capability.
  //
  // The original design fired at most once, because an injector that keeps firing is an
  // injector that can spam a group if a caller arms it and walks away. That risk was real
  // while the control channel was shared with the reference payload -- an INJ0 frame could be
  // collected by the wrong peer and nobody would know who armed it. The channel is now
  // exclusively ours (`mojo.<pid>.control.sock`, proven by an op 4 status 0 whose body was a
  // literal only this payload writes), so the property we actually need is different: each
  // arm sends exactly one message, and a second message must require a second arm.
  //
  // `g_inject_armed = 0` expresses exactly that. `g_inject_done` stays 1 as a sticky "has
  // ever fired" record for diagnostics; the gate at the top of this function is
  // `g_inject_armed`, so clearing it here re-arms the injector for the next INJ0.
  g_inject_armed = 0;
}

extern "C" void hz_cmd_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                uint64_t a2, uint64_t a3, uint64_t* frame) {
  (void)slot;
  (void)original;
  (void)a0;
  (void)a2;
  (void)a3;
  unsigned char first = 0;
  if (a1 != 0) first = *reinterpret_cast<const unsigned char*>(a1);
  g_cmd_ring[g_cmd_index & (kCmdRing - 1)] = first;
  g_cmd_index = g_cmd_index + 1;
  ++g_cmd_total;
  if (first == 0x28) ++g_cmd_msg; else ++g_cmd_other;
  // Also record the parsed length and the first few characters, because a header byte alone
  // says what command was sent but not how long it is -- and the length is what decides whether
  // a 20-character MessageSvc.PbSendMsg can be written in place without reallocating.
  if (g_cmd_detail_count < kCmdRing) {
    const unsigned k = g_cmd_detail_count;
    g_cmd_len[k] = static_cast<unsigned int>(first >> 1);
    if (a1 != 0) {
      // Characters start one byte past the flag for the inline form; copying four is enough to
      // tell message commands apart without guessing at length.
      const unsigned char* ch = reinterpret_cast<const unsigned char*>(a1) + 1;
      for (unsigned j = 0; j < 4; ++j) g_cmd_head[k * 4 + j] = ch[j];
    }
    ++g_cmd_detail_count;
  }
}

// Exposes the recorded command lengths and leading characters. Exists so the data cannot be
// optimised away: without a read, the compiler is free to drop the stores in hz_cmd_observer, and
// that is exactly what happened to the previous attempt at this.
extern "C" unsigned hz_cmd_detail(unsigned int* lens, unsigned char* heads) {
  const unsigned n = g_cmd_detail_count < kCmdRing ? g_cmd_detail_count : kCmdRing;
  for (unsigned i = 0; i < n; ++i) {
    lens[i] = g_cmd_len[i];
    for (unsigned j = 0; j < 4; ++j) heads[i * 4 + j] = g_cmd_head[i * 4 + j];
  }
  return n;
}

extern "C" int hz_dump_cmd_ring() {
  const int fd = ::open("/tmp/hz-cmd.log", O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) return -1;
  char b[192];
  const int h = ::snprintf(b, sizeof(b),
                           "cmd total=%llu msgsend=%llu other=%llu\n",
                           g_cmd_total, g_cmd_msg, g_cmd_other);
  if (h > 0) (void)::write(fd, b, (size_t)h);
  const unsigned n = (g_cmd_index < kCmdRing) ? g_cmd_index : kCmdRing;
  const unsigned start = (g_cmd_index < kCmdRing) ? 0u : (g_cmd_index & (kCmdRing - 1));
  std::size_t pos = 0;
  for (unsigned k = 0; k < n && pos + 8 < sizeof(b); ++k) {
    const unsigned char c = g_cmd_ring[(start + k) & (kCmdRing - 1)];
    const int m = ::snprintf(b + pos, sizeof(b) - pos, "%02x ", c);
    if (m > 0) pos += static_cast<std::size_t>(m);
  }
  if (pos > 0) { b[pos++] = '\n'; (void)::write(fd, b, pos); }
  ::close(fd);
  return 0;
}

extern "C" void hz_capture_for_replay_observer(uint32_t slot, uint64_t original, uint64_t a0,
                                               uint64_t a1, uint64_t a2, uint64_t a3, uint64_t* frame) {
  const int fd = ::open("/tmp/hz-replay.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
  auto log = [&](const char* text) {
    if (fd >= 0) (void)::write(fd, text, ::strlen(text));
  };

  if (g_captured_send.ready != 0) { log("capture slot busy, dropped\n"); if (fd>=0) ::close(fd); return; }
  if (a0 == 0 || a1 == 0 || a2 == 0) { log("null argument\n"); if (fd>=0) ::close(fd); return; }

  // Copy the command string object verbatim: 32 bytes covers the inline form, and the caller's
  // copy at a1 is exactly that size for every command name QQ sends (the header word encodes
  // the length, and inline form tops out at 15 characters in this ABI's variant).
  std::memcpy(g_captured_send.cmd, reinterpret_cast<const void*>(a1), sizeof(g_captured_send.cmd));

  const std::uint64_t begin = *reinterpret_cast<const std::uint64_t*>(a2);
  const std::uint64_t end = *reinterpret_cast<const std::uint64_t*>(a2 + 8);
  if (end <= begin) { log("empty span\n"); if (fd>=0) ::close(fd); return; }
  std::size_t len = static_cast<std::size_t>(end - begin);
  if (len > sizeof(g_captured_send.body)) len = sizeof(g_captured_send.body);
  std::memcpy(g_captured_send.body, reinterpret_cast<const void*>(begin), len);

  g_captured_send.body_len = len;
  g_captured_send.instance = a0;
  g_captured_send.flag = static_cast<std::uint32_t>(a3);
  // x4, the ctx whose `+0x10` slot holds the reply callback. Captured HERE because it is the
  // only place a genuine one is visible; a replay that invents one gets a null vtable jump.
  g_captured_send.ctx = (frame != nullptr) ? frame[4] : 0;
  g_captured_send.ready = 1;

  // Mark that a send is happening, so the replay thread can tell when QQ has gone quiet.
  //
  // The quiet-window logic needs a signal that moves while sends are in flight, and this is the
  // one place that knows. Without it the counter never changes on the realm/29 path and the
  // waiting loop would conclude 'quiet' immediately, which is the same as the fixed delay it is
  // meant to replace.
  ++g_hot_total;

  char b[192];
  const int n = ::snprintf(b, sizeof(b), "captured instance=0x%llx len=%llu flag=%u\n",
                           (unsigned long long)a0, (unsigned long long)len,
                           static_cast<unsigned>(a3));
  if (fd >= 0 && n > 0) (void)::write(fd, b, (size_t)n);
  if (fd >= 0) ::close(fd);

  // Hand the replay to a thread of our own and return immediately.
  //
  // Returning immediately is the whole point. The send that triggered this capture is still in
  // progress on the calling thread; if the replay ran here it would nest inside that call, which
  // is what killed QQ three times. Starting a thread and letting the observer return means the
  // replay begins only after the original send has unwound -- and the replay itself runs on a
  // fresh stack with no inherited state.
  if (::getenv("HZ_NO_REPLAY") == nullptr) {
    pthread_t t;
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
    if (::pthread_create(&t, &attr, replay_thread_body, nullptr) != 0) {
      const int efd = ::open("/tmp/hz-replay.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
      if (efd >= 0) {
        const char* m = "could not start replay thread\n";
        (void)::write(efd, m, ::strlen(m));
        ::close(efd);
      }
    }
    pthread_attr_destroy(&attr);
  }
}

// Replays the captured send from a thread of our own.
//
// Runs on a plain detached thread, so there is no nesting inside QQ's call, the stack is a normal
// thread stack, and the callee is entered exactly as it would be from QQ itself. The command
// object and the body are our own copies, so nothing points back into a frame that has returned.
// Delays slightly before replaying.
//
// The observer returned, so the original send is unwinding -- but not necessarily finished. A short
// sleep lets it complete before a second call enters the same object. Racing the tail of one send
// with the head of another is the same re-entrancy problem in a subtler form, and the failure mode
// would be intermittent rather than immediate, which is much harder to diagnose.
void* replay_thread_body(void*) {
  // Wait for a quiet window before replaying, instead of a fixed delay.
  //
  // A fixed 800 ms was tried and QQ died: one replay produced six nested entries into
  // sendSsoInternal, so the function was evidently still working when the replay arrived. The
  // ambiguity a fixed delay cannot resolve is whether the original call has finished -- wall
  // time is a poor proxy for that.
  //
  // What can resolve it is the function's own entry counter. It stays still while nothing is
  // sending and moves the moment a send starts, so "unchanged for a while" is a real signal that
  // QQ is idle rather than a guess. This watches hz_hot_total, which hz_hot_observer bumps from
  // inside every hooked send, and only proceeds after it has been still for a full second.
  unsigned long long last = g_hot_total;
  int quiet = 0;
  for (int i = 0; i < 200; ++i) {  // up to 20 s
    ::usleep(100000);              // 100 ms
    const unsigned long long now = g_hot_total;
    if (now == last) {
      if (++quiet >= 10) break;  // 10 x 100 ms unchanged
    } else {
      quiet = 0;
      last = now;
    }
  }
  (void)hz_replay_captured_send();
  return nullptr;
}

extern "C" int hz_replay_captured_send() {
  const int fd = ::open("/tmp/hz-replay.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
  auto log = [&](const char* text) { if (fd >= 0) (void)::write(fd, text, ::strlen(text)); };

  if (g_captured_send.ready != 1) { log("nothing captured\n"); if (fd>=0) ::close(fd); return -1; }
  g_captured_send.ready = 2;

  const std::uint64_t base = hz_hook_find_module_base("wrapper.node");
  if (base == 0) { log("no module base\n"); if (fd>=0) ::close(fd); return -2; }

  // Replay the captured body verbatim, byte for byte.
  //
  // The earlier attempts substituted a plain-text marker so the result would be unmistakable in
  // the group. That is almost certainly why they crashed: MessageSvc.PbSendMsg carries a protobuf
  // message, so arbitrary bytes make the callee parse garbage. Replaying the captured 44 bytes
  // changes nothing about the message -- it sends the same text again -- but it is the one test
  // that separates 'my bytes are invalid' from 'the call itself cannot be made'.
  //
  // If this succeeds, the fault is my payload encoding and the fix is the PbSendMsg encoder. If it
  // still crashes, the call genuinely cannot be replayed and the approach has to change again.
  unsigned char body_copy[4096];
  const std::size_t body_len = g_captured_send.body_len;
  std::memcpy(body_copy, g_captured_send.body, body_len);

  unsigned char cmd_copy[32];
  std::memcpy(cmd_copy, g_captured_send.cmd, sizeof(cmd_copy));

  struct Range { const unsigned char* begin; const unsigned char* end; const unsigned char* cap; };
  Range range{reinterpret_cast<const unsigned char*>(body_copy),
              reinterpret_cast<const unsigned char*>(body_copy) + body_len,
              reinterpret_cast<const unsigned char*>(body_copy) + body_len};

  char b[192];
  const int n = ::snprintf(b, sizeof(b), "replay instance=0x%llx cmd0=%02x body_len=%llu\n",
                           (unsigned long long)g_captured_send.instance, cmd_copy[0],
                           (unsigned long long)g_captured_send.body_len);
  if (fd >= 0 && n > 0) (void)::write(fd, b, (size_t)n);

  // Call the function body directly, bypassing the hook.
  //
  // The entry holds the jump into the relay, so entering at base+0x137cf84 would come straight
  // back here. The replay stub is not usable either -- it exists to replay a specific displaced
  // prologue and then continue, and it is reached through the relay's own state. So this reuses
  // the fact that 0x137cf84 is a real function with a stable entry: the patch is two words plus a
  // literal, and the displaced 16 bytes are already saved by the installer.
  typedef void (*SendFn)(void*, const void*, const void*, std::uint32_t, void*);
  const std::size_t idx = hook_index_of_offset(0x137cf84ull);
  if (idx >= 256) { log("hook index not found\n"); if (fd>=0) ::close(fd); return -3; }

  // The hook's saved prologue is what the stub would have replayed. Executing it here is not
  // possible without generating code, so instead the function is called through the stub -- which
  // is safe from *this* thread even though it was not safe from the observer: nothing above it on
  // this stack belongs to QQ's send path.
  const std::uint64_t stub = hook_replay_stub(idx);
  if (stub == 0) { log("no stub\n"); if (fd>=0) ::close(fd); return -4; }

  SendFn fn = reinterpret_cast<SendFn>(stub);

  // 🔴 x4 must be QQ's OWN captured ctx, not a local zero buffer.
  //
  // This is the reason every previous replay and every direct `sendSsoInternal` call killed the
  // client. Slot 36's body does `ldr x8, [x3, #0x10]` on this argument and jumps through it to
  // reach the response callback. A zeroed 128-byte scratch buffer therefore supplies a null
  // vtable, and the first `blr` goes to address 0.
  //
  // The captured ctx is live (QQ allocated it for the send we captured) and it belongs to this
  // same instance, so reusing it is exactly what the real call does.
  if (g_captured_send.ctx == 0) {
    log("no captured ctx; refusing to call (a fabricated one would jump to null)\n");
    if (fd >= 0) ::close(fd);
    return -5;
  }

  // Log immediately before the call, and flush.
  //
  // The previous run logged "replay instance=..." and then QQ died with no further line, so the
  // crash is inside the call rather than before it -- but that inference needs the next line to
  // exist to be checkable, and fb::write to a file is the only channel available here.
  {
    char cb[160];
    const int cn = ::snprintf(cb, sizeof(cb), "ctx=0x%llx\n",
                              (unsigned long long)g_captured_send.ctx);
    if (fd >= 0 && cn > 0) (void)::write(fd, cb, (size_t)cn);
  }
  log("about to call\n");
  fn(reinterpret_cast<void*>(g_captured_send.instance), cmd_copy, &range, 1u,
     reinterpret_cast<void*>(g_captured_send.ctx));
  log("replay returned\n");
  if (fd >= 0) ::close(fd);
  return 0;
}

extern "C" void hz_forward_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                   uint64_t a2, uint64_t a3, uint64_t* frame) {
  const int fd = ::open("/tmp/hz-fwd.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
  auto log = [&](const char* text) {
    if (fd < 0) return;
    (void)::write(fd, text, ::strlen(text));
  };

  if (g_in_forward != 0) {
    log("reentry blocked\n");
    return;
  }
  if (a0 == 0 || a1 == 0 || a2 == 0) { log("null argument, not forwarded\n"); return; }

  // Read the original span. a2 points at {begin, end, cap}; the length is end - begin and the
  // captured example was 33 bytes, so anything wildly larger means the layout assumption is wrong
  // and forwarding would send garbage.
  const std::uint64_t begin = *reinterpret_cast<const std::uint64_t*>(a2);
  const std::uint64_t end = *reinterpret_cast<const std::uint64_t*>(a2 + 8);
  if (end <= begin || (end - begin) > (1u << 20)) { log("implausible span, not forwarded\n"); return; }
  const std::size_t len = static_cast<std::size_t>(end - begin);

  // The replacement body. A pure marker makes the result unambiguous in a group: if this text
  // appears, the forwarded call really did go out over the original channel.
  static const char kMarker[] = "haizakura forward probe";
  const std::size_t marker_len = sizeof(kMarker) - 1;

  char line[192];
  const int n = ::snprintf(line, sizeof(line), "forward slot=%u instance=0x%llx orig_len=%llu\n",
                           slot, (unsigned long long)a0, (unsigned long long)len);
  if (fd >= 0 && n > 0) (void)::write(fd, line, (size_t)n);

  // A three-pointer range over the marker. Written as a local because the callee copies from it
  // synchronously; nothing outlives this frame.
  struct Range { const unsigned char* begin; const unsigned char* end; const unsigned char* cap; };
  Range range{reinterpret_cast<const unsigned char*>(kMarker),
              reinterpret_cast<const unsigned char*>(kMarker) + marker_len,
              reinterpret_cast<const unsigned char*>(kMarker) + marker_len};

  // Call the relay's replay stub, never the function entry.
  //
  // The entry now holds a two-word jump into this very observer. Calling it -- even from here,
  // even with a fresh module base -- jumps straight back in. The first attempt did exactly that
  // and QQ died; the log showed "forward" followed immediately by "reentry blocked", and the
  // guard then returned without forwarding, leaving the client in a patched state mid-send.
  //
  // The stub is the piece that makes this possible: it replays the sixteen displaced prologue
  // bytes and then continues at target+16, so it enters the function body exactly once and is
  // never routed through the relay. slot_relay_install_function stores it in the relay state at
  // offset 8, which is what state->original points at.
  const std::uint64_t stub = hook_replay_stub(hook_index_of_offset(0x137cf84ull));
  if (stub == 0) {
    log("no replay stub for the hooked function, not forwarded\n");
    if (fd >= 0) ::close(fd);
    return;
  }
  {
    char b[160];
    const int m = ::snprintf(b, sizeof(b), "calling stub=0x%llx\n", (unsigned long long)stub);
    if (fd >= 0 && m > 0) (void)::write(fd, b, (size_t)m);
  }

  g_in_forward = 1;
  typedef void (*SendFn)(void*, const void*, const void*, std::uint32_t, void*);
  SendFn fn = reinterpret_cast<SendFn>(stub);
  // x4 = the caller's own ctx, taken from the live frame. Do not zero a scratch buffer here:
  // the callee loads `[x4, #0x10]` and jumps through it (see hz_replay_captured_send).
  const std::uint64_t ctx = (frame != nullptr) ? frame[4] : 0;
  fn(reinterpret_cast<void*>(a0), reinterpret_cast<const void*>(a1), &range, 1u,
     reinterpret_cast<void*>(ctx));
  g_in_forward = 0;
  log("forwarded via stub\n");
  if (fd >= 0) ::close(fd);
}

extern "C" void hz_capture_instance_observer(uint32_t slot, uint64_t original, uint64_t a0,
                                             uint64_t a1, uint64_t a2, uint64_t a3, uint64_t* frame) {
  (void)slot; (void)original;
  // Record the pointers themselves, not just their contents. A later send reuses these objects
  // rather than fabricating equivalents, because the cmd argument carries a vtable and inventing
  // one in C has already crashed the client once.
  g_msf_instance = a0;
  g_msf_cmd_obj = a1;
  g_msf_body_obj = a2;
  g_msf_flag = a3;
  // x4 is the ctx -- the object whose `+0x10` slot the callee jumps to for the reply callback.
  // It is only reachable through the relay's argument frame (`frame[n] == x_n`), because the
  // observer signature carries just four arguments. Capture it so a direct send can REUSE QQ's
  // own ctx instead of fabricating a zero buffer, which is what crashed the client.
  if (frame != nullptr) g_msf_ctx = frame[4];

  const int fd = ::open("/tmp/hz-inst.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
  if (fd < 0) return;
  char b[192];
  const int n = ::snprintf(b, sizeof(b),
                           "instance=0x%llx cmd=0x%llx body=0x%llx flag=%llu ctx=0x%llx\n",
                           (unsigned long long)a0, (unsigned long long)a1,
                           (unsigned long long)a2, (unsigned long long)a3,
                           (unsigned long long)((frame != nullptr) ? frame[4] : 0));
  if (n > 0) (void)::write(fd, b, (size_t)n);
  ::close(fd);

  // Dump what those two objects actually look like, so the reuse can be reasoned about instead
  // of assumed. Read through the live mapping; a fault here would take the client down, so the
  // range is deliberately small and the pointers are checked first.
  {
    const int dfd = ::open("/tmp/hz-obj.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (dfd >= 0) {
      for (int which = 0; which < 2; ++which) {
        const std::uint64_t p = (which == 0) ? a1 : a2;
        if (p == 0) continue;
        const unsigned char* m = reinterpret_cast<const unsigned char*>(p);
        char row[256];
        int rn = ::snprintf(row, sizeof(row), "%s 0x%llx:",
                            (which == 0) ? "cmd " : "body", (unsigned long long)p);
        if (rn < 0) continue;
        for (int i = 0; i < 32 && rn + 3 < (int)sizeof(row); ++i) {
          const int w = ::snprintf(row + rn, sizeof(row) - (size_t)rn, " %02x", m[i]);
          if (w <= 0) break;
          rn += w;
        }
        if (rn + 1 < (int)sizeof(row)) { row[rn++] = '\n'; row[rn] = '\0'; }
        if (rn > 0) (void)::write(dfd, row, (size_t)rn);
      }
      ::close(dfd);
    }
  }
}

extern "C" void hz_sys_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                uint64_t a2, uint64_t a3, uint64_t* frame) {
  (void)original; (void)a3;
  const int fd = ::open("/tmp/hz-sys.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
  if (fd < 0) return;
  char hexbuf[64];
  std::size_t hn = 0;
  const unsigned long long cnt = (a2 > 32) ? 32 : a2;
  const char* src = reinterpret_cast<const char*>(a1);
  for (unsigned long long i = 0; i < cnt && hn + 2 < sizeof(hexbuf); ++i) {
    unsigned char c = 0;
    if (!hz_safe_read(reinterpret_cast<uint64_t>(src + i), &c, 1)) break;
    const char* hx = "0123456789abcdef";
    hexbuf[hn++] = hx[(c >> 4) & 0xf];
    hexbuf[hn++] = hx[c & 0xf];
  }
  hexbuf[hn] = '\0';
  char line[192];
  const int n = snprintf(line, sizeof(line), "sys hook=%u fd=%lld cnt=%llu bytes=%s\n", slot,
                         (long long)a0, cnt, hexbuf);
  if (n > 0) (void)::write(fd, line, (size_t)((n < (int)sizeof(line)) ? n : (int)sizeof(line)));
  ::close(fd);
}

extern "C" void hz_login_observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                  uint64_t a2, uint64_t a3, uint64_t* frame) {
  (void)original;
  ++g_login_hits;

  // Record the arguments of every entry to the hooked slot.
  //
  // The login observer is the only observer the payload installs besides the trunk slot, so
  // this log answers the one question static analysis could not: what does a real call to the
  // MSFService send slot actually carry? Slots 36 and 11 are the cases that matter, and the
  // registers are logged raw because nothing here has verified the ABI of QQ's own std::Cr --
  // reading x0 is free, following it needs evidence.
  //
  // One line per entry, unthrottled, because a burst is itself the finding: if the send slot
  // fires once per message the count tells us that, and if it fires per packet it tells us
  // something different about where the boundary is.
  {
    const int fd = ::open("/tmp/hz-slot-args.log", O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC,
                          0644);
    if (fd >= 0) {
      char line[176];
      const int n = snprintf(line, sizeof(line),
                             "slot=%u orig=0x%llx x0=0x%llx x1=0x%llx x2=0x%llx x3=0x%llx\n",
                             slot, (unsigned long long)original, (unsigned long long)a0,
                             (unsigned long long)a1, (unsigned long long)a2,
                             (unsigned long long)a3);
      if (n > 0) (void)::write(fd, line, (size_t)((n < (int)sizeof(line)) ? n : (int)sizeof(line)));
      ::close(fd);
    }
  }
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