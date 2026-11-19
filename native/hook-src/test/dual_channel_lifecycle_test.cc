// T7+T10: the lifecycle must bring up BOTH channels, and stop must remove both.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <string>
#include <unistd.h>
#include <sys/stat.h>
#include "common.h"
#include "elf_image.h"
#include "manual_loader.h"
#include "remote.h"

static bool exists(const char* p){ struct stat st; return ::stat(p,&st)==0; }
static bool alive(int pid){ return ::access(("/proc/"+std::to_string(pid)).c_str(), F_OK)==0; }

int main(int argc, char** argv) {
  if (argc < 3) { std::printf("usage: %s <pid> <payload.so>\n", argv[0]); return 2; }
  const int pid = std::atoi(argv[1]);
  const char* control = "/tmp/hz-control.sock";
  // The payload derives the recv path from the control path: strip ".sock", add ".recv.sock".
  const char* recv_path = "/tmp/hz-control.recv.sock";
  int fails = 0;
  auto check = [&](bool ok, const std::string& w) {
    std::printf("  %s %s\n", ok ? "ok  " : "FAIL", w.c_str());
    if (!ok) ++fails;
  };

  hz::RemoteProcess remote(pid);
  hz::ElfImage image(hz::MappedFile::open(argv[2]));
  hz::ManualLoader loader(remote, image);
  remote.attach();
  auto h = loader.load();
  const auto start = h.entry;
  const auto stop = loader.symbol(h, "snowluma_linux_hook_stop_dynamic");
  const auto isld = loader.symbol(h, "snowluma_linux_hook_is_loaded");
  const auto recv_sock = loader.symbol(h, "snowluma_linux_hook_recv_socket");
  const auto ctrl_sock = loader.symbol(h, "snowluma_linux_hook_control_socket");

  auto wait_for = [&](const char* p, bool want) {
    for (int i = 0; i < 80; ++i) {
      if (exists(p) == want) return true;
      ::usleep(50000);
    }
    return false;
  };

  check(start != 0, "resolved start_dynamic");
  check(stop.has_value(), "resolved stop_dynamic");
  check(recv_sock.has_value(), "resolved recv_socket");
  check(ctrl_sock.has_value(), "resolved control_socket");

  for (int round = 1; round <= 2; ++round) {
    const uint64_t r = remote.remote_call(start, {}, 0);
    std::printf("round %d: start -> %llu\n", round, (unsigned long long)r);
    check(r == 1, "start_dynamic reports success");
    check(wait_for(control, true), "control socket appeared");
    check(wait_for(recv_path, true), "recv socket appeared");
    if (isld) check(remote.remote_call(*isld, {}, 0) == 1, "is_loaded is 1");
    if (ctrl_sock) {
      const int32_t fd = static_cast<int32_t>(remote.remote_call(*ctrl_sock, {}, 0));
      std::printf("  control fd = %d\n", fd);
      check(fd >= 0, "control fd is valid");
    }
    if (recv_sock) {
      const int32_t fd = static_cast<int32_t>(remote.remote_call(*recv_sock, {}, 0));
      std::printf("  recv fd = %d\n", fd);
      check(fd >= 0, "recv fd is valid");
    }
    if (stop) {
      remote.remote_call(*stop, {}, 0);
      check(wait_for(control, false), "control socket removed on stop");
      check(wait_for(recv_path, false), "recv socket removed on stop");
      if (recv_sock) {
        const int32_t fd = static_cast<int32_t>(remote.remote_call(*recv_sock, {}, 0));
        std::printf("  recv fd after stop = %d\n", fd);
        check(fd == -1, "recv fd is -1 after stop");
      }
    }
    if (!alive(pid)) { std::printf("  FAIL target died\n"); return 1; }
  }
  remote.detach();
  std::printf(fails ? "FAIL (%d failures)\n" : "PASS\n", fails);
  return fails ? 1 : 0;
}
