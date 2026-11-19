// T11: the login state must reach BOTH channels as an op 7 frame, unprompted.
//
// The property under test is not "a frame was written" but "a client that connected before login
// still learns the state changed".  That is the case a request/response-only implementation
// misses: op 7 is a push, and the Node side gates its packets on being logged in, so a missed
// push means the client silently never receives anything.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <string>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include "common.h"
#include "elf_image.h"
#include "manual_loader.h"
#include "remote.h"

static int fails = 0;
static void check(bool ok, const std::string& w) {
  std::printf("  %s %s\n", ok ? "ok  " : "FAIL", w.c_str());
  if (!ok) ++fails;
}
static bool exists(const char* p){ struct stat st; return ::stat(p,&st)==0; }

struct Frame {
  uint32_t magic; uint16_t version, op; uint32_t request_id; int32_t status;
  uint32_t flags, cmd_len, msg_len, body_len; uint64_t value0;
};
static Frame decode(const uint8_t* b) {
  Frame f{};
  std::memcpy(&f.magic, b+0, 4);  std::memcpy(&f.version, b+4, 2);
  std::memcpy(&f.op, b+6, 2);     std::memcpy(&f.request_id, b+8, 4);
  std::memcpy(&f.status, b+12, 4);std::memcpy(&f.flags, b+16, 4);
  std::memcpy(&f.cmd_len, b+20, 4);std::memcpy(&f.msg_len, b+24, 4);
  std::memcpy(&f.body_len, b+28, 4);std::memcpy(&f.value0, b+32, 8);
  return f;
}
static bool read_exact(int fd, void* buf, size_t n) {
  size_t got = 0;
  while (got < n) {
    const ssize_t r = ::read(fd, static_cast<char*>(buf)+got, n-got);
    if (r <= 0) return false;
    got += static_cast<size_t>(r);
  }
  return true;
}
static int connect_to(const char* path) {
  const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
  struct sockaddr_un a; std::memset(&a, 0, sizeof(a));
  a.sun_family = AF_UNIX;
  std::strncpy(a.sun_path, path, sizeof(a.sun_path)-1);
  if (::connect(fd, reinterpret_cast<struct sockaddr*>(&a), sizeof(a)) != 0) { ::close(fd); return -1; }
  return fd;
}

// Reads one frame, skipping any op that is not the one wanted.
static bool read_op(int fd, uint16_t want, Frame* out, std::string* msg) {
  for (int tries = 0; tries < 8; ++tries) {
    uint8_t raw[40];
    if (!read_exact(fd, raw, sizeof(raw))) return false;
    const Frame f = decode(raw);
    std::string m;
    if (f.cmd_len) { m.resize(f.cmd_len); if (!read_exact(fd, &m[0], f.cmd_len)) return false; }
    std::string text;
    if (f.msg_len) { text.resize(f.msg_len); if (!read_exact(fd, &text[0], f.msg_len)) return false; }
    if (f.body_len) { std::string b(f.body_len, '\0'); if (!read_exact(fd, &b[0], f.body_len)) return false; }
    if (f.op == want) { *out = f; if (msg) *msg = text; return true; }
  }
  return false;
}

int main(int argc, char** argv) {
  if (argc < 3) { std::printf("usage: %s <pid> <payload.so>\n", argv[0]); return 2; }
  const int pid = std::atoi(argv[1]);
  const char* control = "/tmp/hz-control.sock";
  const char* recv_path = "/tmp/hz-control.recv.sock";

  hz::RemoteProcess remote(pid);
  hz::ElfImage image(hz::MappedFile::open(argv[2]));
  hz::ManualLoader loader(remote, image);
  remote.attach();
  auto h = loader.load();
  const auto announce = loader.symbol(h, "hz_test_announce_login");
  const auto logged_in = loader.symbol(h, "hz_test_logged_in");
  check(announce.has_value(), "resolved the login announce entry");
  check(logged_in.has_value(), "resolved the login state probe");

  const uint64_t r = remote.remote_call(h.entry, {}, 0);
  check(r == 1, "start_dynamic reports success");
  for (int i = 0; i < 80 && !exists(control); ++i) ::usleep(50000);
  check(exists(control), "control socket exists");

  // Connect BOTH channels BEFORE announcing login: this is the ordering that matters.
  const int cfd = connect_to(control);
  check(cfd >= 0, "connected to control");
  for (int i = 0; i < 80 && !exists(recv_path); ++i) ::usleep(50000);
  const int rfd = connect_to(recv_path);
  check(rfd >= 0, "connected to recv");
  ::usleep(300000);

  check(static_cast<int32_t>(remote.remote_call(*logged_in, {}, 0)) == 0,
        "not logged in before the announcement");

  // Announce a login, as the hooked slot would.
  const long long uin = 1000000002LL;
  remote.remote_call(*announce, {static_cast<uint64_t>(uin)}, 1);
  check(static_cast<int32_t>(remote.remote_call(*logged_in, {}, 0)) == 1,
        "logged in after the announcement");

  // Both channels must carry op 7, unprompted.
  Frame cf{};
  std::string cmsg;
  const bool got_c = read_op(cfd, 7, &cf, &cmsg);
  check(got_c, "control channel pushed op 7 without being asked");
  if (got_c) {
    std::printf("  control: status=%d flags=0x%x value0=%llu msg=%s\n",
                cf.status, cf.flags, (unsigned long long)cf.value0, cmsg.c_str());
    const bool logged = ((cf.flags & 0x4) != 0) || (cf.status != 0);
    check(logged, "control frame says logged in (flags bit 2 or status)");
    check(cf.value0 == static_cast<uint64_t>(uin), "control frame carries the uin in value0");
    check(cmsg == std::to_string(uin), "control frame carries the uin as text in msg");
  }

  Frame rf{};
  std::string rmsg;
  const bool got_r = read_op(rfd, 7, &rf, &rmsg);
  check(got_r, "recv channel pushed op 7 too");
  if (got_r) {
    std::printf("  recv: status=%d flags=0x%x value0=%llu msg=%s\n",
                rf.status, rf.flags, (unsigned long long)rf.value0, rmsg.c_str());
    const bool logged = ((rf.flags & 0x4) != 0) || (rf.status != 0);
    check(logged, "recv frame says logged in");
    check(rf.value0 == static_cast<uint64_t>(uin), "recv frame carries the same uin");
  }

  // A second announcement must be harmless: the state is unchanged, so a well-behaved client
  // sees another op 7 but does not re-fire its waiters.
  remote.remote_call(*announce, {static_cast<uint64_t>(uin)}, 1);
  ::usleep(200000);
  Frame again{};
  std::string amsg;
  const bool got_again = read_op(cfd, 7, &again, &amsg);
  check(got_again, "a repeat announcement is still delivered (idempotent, not suppressed)");

  ::close(cfd); ::close(rfd);
  remote.detach();
  std::printf(fails ? "FAIL (%d failures)\n" : "PASS\n", fails);
  return fails ? 1 : 0;
}
