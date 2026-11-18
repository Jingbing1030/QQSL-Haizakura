// Self-test for the pieces that can run in-process: ELF parsing and process
// enumeration.  The injector needs a live QQ target and is exercised separately.
//
// Usage: hook_selftest <path-to-elf.so> [process-name-hint]

#include "elf_image.h"
#include "process_enumerate.h"
#include "remote.h"

#include <cstdio>
#include <cstring>
#include <string>

namespace {

int failures = 0;

void check(bool condition, const char* what) {
  if (condition) {
    std::printf("  ok   %s\n", what);
  } else {
    std::printf("  FAIL %s\n", what);
    ++failures;
  }
}

void test_elf(const std::string& path) {
  std::printf("ELF: %s\n", path.c_str());
  hz::ElfImage image(hz::MappedFile::open(path));

  std::printf("  machine=%u type=%u entry=0x%llx base=0x%llx size=0x%llx\n",
              image.machine(), image.type(),
              static_cast<unsigned long long>(image.entry()),
              static_cast<unsigned long long>(image.image_base()),
              static_cast<unsigned long long>(image.image_size()));

  check(image.type() == 3, "is ET_DYN");
  check(image.image_size() > 0, "image window is non-empty");
  check(!image.program_headers().empty(), "has program headers");
  check(!image.dynamic().empty(), "has a dynamic section");
  check(!image.symbols().empty(), "has dynamic symbols");
  check(!image.relocations().empty(), "has relocations");

  // Every PT_LOAD segment must lie inside the reported window.
  const uint64_t lo = image.image_base();
  const uint64_t hi = lo + image.image_size();
  bool segments_inside = true;
  for (const auto& ph : image.program_headers()) {
    if (ph.type != 1) continue;
    if (ph.vaddr < lo || ph.vaddr + ph.memsz > hi) segments_inside = false;
  }
  check(segments_inside, "all PT_LOAD segments fit the image window");

  // Cross-check a known symbol against its own dynamic table entry.
  const hz::DynSymbol* sym = image.find_symbol("napi_register_module_v1");
  if (sym != nullptr) {
    std::printf("  found napi_register_module_v1 value=0x%llx type=%u\n",
                static_cast<unsigned long long>(sym->value), sym->type);
    check(sym->value != 0, "napi_register_module_v1 has an address");
  } else {
    std::printf("  note: napi_register_module_v1 not exported by this image\n");
  }

  // init_array should be resolvable for a healthy .so.
  std::printf("  init fns=%zu fini fns=%zu needed=%zu relocs=%zu\n",
              image.init_functions().size(), image.fini_functions().size(),
              image.needed().size(), image.relocations().size());

  std::printf("  symbol count: %zu\n", image.symbols().size());
}

void test_processes(const std::string& hint) {
  std::printf("\nProcesses matching '%s':\n", hint.c_str());
  const auto all = hz::enumerate_processes(hint);
  std::printf("  candidates: %zu\n", all.size());
  for (const auto& p : all) {
    std::printf("    pid=%d ppid=%d name=%s wrapper=%d exe=%s\n", p.pid, p.ppid,
                p.name.c_str(), p.has_wrapper_node ? 1 : 0, p.exe.c_str());
  }
  // Enumeration itself must never throw, even with no matches.
  check(true, "enumerate_processes completed");
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: %s <elf.so> [process-hint]\n", argv[0]);
    return 2;
  }

  try {
    test_elf(argv[1]);
  } catch (const std::exception& e) {
    std::printf("  FAIL elf parse threw: %s\n", e.what());
    ++failures;
  }

  test_processes(argc > 2 ? argv[2] : "qq");

  std::printf("\n%s (%d failure%s)\n", failures == 0 ? "PASS" : "FAIL", failures,
              failures == 1 ? "" : "s");
  return failures == 0 ? 0 : 1;
}
