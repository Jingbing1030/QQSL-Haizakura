// Pre-flight: does the manual loader support every relocation in this payload?
//
// The loader implements a fixed set of relocation types and fails on anything else.  A payload
// that picks up a TLS or COPY relocation -- from a toolchain change, a sanitizer build, or a
// library that uses thread-locals -- would map successfully and then die partway through
// relocation, on the target machine, at injection time.
//
// This check answers the same question statically: no ptrace, no target architecture needed, so
// it runs in CI on any host and on payloads for either architecture.
//
// Usage: reloc_check <payload.so|payload.node> [...]
#include <cstdio>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "elf_image.h"

namespace {

struct Machine {
  const char* name;
  // Types the loader implements.  Kept explicit rather than derived from the loader's switch so
  // that adding support there without adding it here shows up as a false failure -- the safer
  // direction of drift.
  std::set<uint32_t> supported;
  std::map<uint32_t, const char*> names;
};

Machine machine_info(const hz::ElfImage& image) {
  if (image.is_aarch64()) {
    return {"aarch64",
            {1024 /*NONE*/, 1025 /*GLOB_DAT*/, 1026 /*JUMP_SLOT*/, 1027 /*RELATIVE*/,
             257 /*ABS64*/},
            {{1024, "R_AARCH64_NONE"}, {1025, "R_AARCH64_GLOB_DAT"},
             {1026, "R_AARCH64_JUMP_SLOT"}, {1027, "R_AARCH64_RELATIVE"},
             {257, "R_AARCH64_ABS64"}, {1028, "R_AARCH64_TLS_DTPMOD64 (unsupported)"},
             {1029, "R_AARCH64_TLS_DTPREL64 (unsupported)"},
             {1031, "R_AARCH64_TLS_TPREL64 (unsupported)"},
             {1032, "R_AARCH64_TLSDESC (unsupported)"}}};
  }
  return {"x86_64",
          {0 /*NONE*/, 1 /*64*/, 6 /*GLOB_DAT*/, 7 /*JUMP_SLOT*/, 8 /*RELATIVE*/},
          {{0, "R_X86_64_NONE"}, {1, "R_X86_64_64"}, {6, "R_X86_64_GLOB_DAT"},
           {7, "R_X86_64_JUMP_SLOT"}, {8, "R_X86_64_RELATIVE"},
           {16, "R_X86_64_DTPMOD64 (unsupported)"}, {17, "R_X86_64_DTPOFF64 (unsupported)"},
           {18, "R_X86_64_TPOFF64 (unsupported)"}, {19, "R_X86_64_TLSGD (unsupported)"}}};
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: %s <payload> [payload...]\n", argv[0]);
    return 2;
  }
  int failures = 0;
  for (int i = 1; i < argc; ++i) {
    try {
      hz::ElfImage image(hz::MappedFile::open(argv[i]));
      const Machine m = machine_info(image);

      std::map<uint32_t, int> counts;
      for (const auto& rel : image.relocations()) {
        counts[static_cast<uint32_t>(rel.info & 0xffffffffu)]++;
      }

      std::printf("%s (%s, %zu relocations)\n", argv[i], m.name, image.relocations().size());
      int unsupported = 0;
      for (const auto& [type, count] : counts) {
        const bool ok = m.supported.count(type) != 0;
        const auto it = m.names.find(type);
        const char* name = it != m.names.end() ? it->second : "(unknown type)";
        std::printf("  %s %-6u x %-4d %s\n", ok ? "ok  " : "FAIL", type, count, name);
        if (!ok) {
          ++unsupported;
        }
      }
      if (counts.empty()) std::printf("  (no relocations)\n");

      // Walk the relocation table the way the loader does, at a representative base, and check
      // the two things the loader itself asserts: the destination is inside the image, and every
      // symbol index the relocation names actually exists.  Undefined symbols are counted
      // separately -- the loader resolves those against the target's libraries, so they are not
      // a failure of this check.
      const uint64_t base = 0x7f0000000000ULL;
      const uint64_t lo = base;
      const uint64_t hi = base + image.image_size();
      int out_of_range = 0, bad_symbol = 0, external = 0, applied = 0;
      const auto& syms = image.symbols();
      for (const auto& rel : image.relocations()) {
        const uint32_t type = static_cast<uint32_t>(rel.info & 0xffffffffu);
        const uint32_t symidx = static_cast<uint32_t>(rel.info >> 32);
        const uint64_t where = base + (rel.offset - image.image_base());
        if (where < lo || where + 8 > hi) {
          std::printf("  FAIL destination 0x%llx is outside the image (type %u)\n",
                      static_cast<unsigned long long>(where), type);
          ++out_of_range;
          continue;
        }
        const bool needs_sym = image.is_aarch64()
                                   ? (type == 1025 || type == 1026 || type == 257)
                                   : (type == 1 || type == 6 || type == 7);
        if (!needs_sym) { ++applied; continue; }
        if (symidx == 0 || symidx >= syms.size()) {
          std::printf("  FAIL relocation names symbol %u, out of range\n", symidx);
          ++bad_symbol;
          continue;
        }
        if (!syms[symidx].defined) { ++external; continue; }
        ++applied;
      }
      std::printf("  relocation pass at base 0x%llx: applied=%d external=%d\n",
                  static_cast<unsigned long long>(base), applied, external);
      const int structural = out_of_range + bad_symbol;
      if (unsupported == 0 && structural == 0) {
        std::printf("  -> every type is implemented, every destination is inside the image\n");
      } else {
        if (unsupported != 0) {
          std::printf("  -> %d unsupported type(s): this payload would fail to inject\n",
                      unsupported);
        }
        if (structural != 0) {
          std::printf("  -> %d structural defect(s) in the relocation table\n", structural);
        }
      }
      unsupported += structural;
      // Report into the exit status.  A pre-flight that prints FAIL and exits 0 is worse than no
      // pre-flight: CI treats it as passing, which is how a payload with an unsupported TLS
      // relocation reaches a target and dies there.
      failures += unsupported;
    } catch (const std::exception& e) {
      std::fprintf(stderr, "error: %s: %s\n", argv[i], e.what());
      failures++;
    }
  }
  std::printf(failures ? "FAIL (%d)\n" : "PASS\n", failures);
  return failures ? 1 : 0;
}
