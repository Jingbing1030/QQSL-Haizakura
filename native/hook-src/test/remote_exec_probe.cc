// Isolates the remote-execution path from the ELF loader.
//
// mmap a page in the target, write a hand-assembled `mov eax,42; ret`, and call
// it.  If this works the ptrace machinery is sound and any failure afterwards
// belongs to the ELF image; if it fails, the bug is in RemoteProcess itself.
//
// Usage: remote_exec_probe <pid>

#include "remote.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: %s <pid>\n", argv[0]);
    return 2;
  }
  const int pid = std::atoi(argv[1]);

  try {
    hz::RemoteProcess remote(pid);
    remote.attach();
    std::printf("attached, registers saved\n");

    // One page, read+write+exec.
    const uint64_t page = remote.remote_mmap(4096, 0x1 | 0x2 | 0x4, 0x02 | 0x20);
    std::printf("probe page = 0x%llx\n", static_cast<unsigned long long>(page));
    if (page == 0) {
      std::fprintf(stderr, "remote mmap failed\n");
      return 1;
    }

    // mov eax, 42 ; ret
    const uint8_t code[] = {0xb8, 0x2a, 0x00, 0x00, 0x00, 0xc3};
    remote.write_exact(page, code, sizeof(code));

    uint8_t verify[sizeof(code)] = {0};
    remote.read_exact(page, verify, sizeof(verify));
    const bool same = std::memcmp(code, verify, sizeof(code)) == 0;
    std::printf("wrote %zu bytes, read back match=%d:", sizeof(code), same ? 1 : 0);
    for (unsigned char c : verify) std::printf(" %02x", c);
    std::printf("\n");
    if (!same) {
      std::fprintf(stderr, "write did not land\n");
      return 1;
    }

    // Show how the kernel actually describes that page: if the mapping is not
    // executable, executing it faults and rip gets reported oddly.
    {
      std::string maps;
      try { maps = hz::read_file_text(hz::format("/proc/%d/maps", pid), 32u << 20); } catch (...) {}
      const std::string needle = hz::format("%llx", static_cast<unsigned long long>(page));
      const size_t pos = maps.find(needle);
      if (pos != std::string::npos) {
        const size_t sol = maps.rfind('\n', pos);
        const size_t eol = maps.find('\n', pos);
        std::printf("maps: %s\n",
                    maps.substr(sol == std::string::npos ? 0 : sol + 1,
                                eol - (sol == std::string::npos ? 0 : sol + 1)).c_str());
      } else {
        std::printf("maps: page 0x%llx NOT FOUND\n",
                    static_cast<unsigned long long>(page));
      }
    }

    const uint64_t result = remote.remote_call(page, {}, 0);
    std::printf("remote_call returned 0x%llx (%llu)\n",
                static_cast<unsigned long long>(result),
                static_cast<unsigned long long>(result));
    std::printf("%s\n", result == 42 ? "PASS: bare code stub executed"
                                     : "FAIL: unexpected return value");

    remote.detach();
    return result == 42 ? 0 : 1;
  } catch (const std::exception& e) {
    std::printf("FAIL: %s\n", e.what());
    return 1;
  }
}
