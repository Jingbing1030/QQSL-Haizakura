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
//                    counter through a symbol resolved from the target
//
// A successful run therefore proves: ELF parsing, remote mmap, segment copy,
// RELA relocation against a symbol the target already had, and DT_INIT_ARRAY
// execution.

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <thread>

#include <dlfcn.h>
#include <fcntl.h>
#include <limits.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

int main(int argc, char** argv) {
  const char* wrapper = argc > 1 ? argv[1] : "/tmp/fake-wrapper.node";
  const int seconds = argc > 2 ? std::atoi(argv[2]) : 120;

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
  void* handle = ::dlopen(wrapper_resolved, RTLD_NOW | RTLD_GLOBAL);
  if (handle == nullptr) {
    const char* err = ::dlerror();
    std::fprintf(stderr, "dlopen failed: %s\n", err != nullptr ? err : "unknown");
    return 1;
  }

  std::printf("pid=%d wrapper mapped at %p and dlopen'd, sleeping %d s\n", ::getpid(), map,
              seconds);
  std::fflush(stdout);

  std::this_thread::sleep_for(std::chrono::seconds(seconds));
  std::printf("exiting after sleep\n");
  return 0;
}