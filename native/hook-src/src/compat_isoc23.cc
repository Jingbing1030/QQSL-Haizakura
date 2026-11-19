// Fills in the one glibc 2.38 symbol our toolchain emits but the target does not have.
//
// ---------------------------------------------------------------------------
// Why this file exists
// ---------------------------------------------------------------------------
// gcc 15's static libstdc++ is built against a C23 glibc and references
// __isoc23_strtoul from eh_alloc.o (the emergency exception pool) and debug.o. Linking it in
// marks the module as needing GLIBC_2.38, and the QQ containers run Debian 12 at 2.36, so the
// dynamic loader refuses the module outright:
//
//   /lib/aarch64-linux-gnu/libc.so.6: version `GLIBC_2.38' not found
//
// Our own code no longer routes through these symbols (every strtol/stoul/sscanf call site was
// rewritten to use std::from_chars, for the same reason), but the static library's internal
// references remain and they are exported as versioned undefined symbols.
//
// ---------------------------------------------------------------------------
// Why defining it here is safe
// ---------------------------------------------------------------------------
// __isoc23_strtoul differs from strtoul only in accepting a "0b" binary prefix. The two call
// sites are in libstdc++'s internals, which parse decimal sizes and pointers, and neither
// feeds input that could begin with 0b. So forwarding to strtoul is behaviourally identical
// for every input this module will ever see.
//
// The alternative -- dropping -static-libstdc++ -- would reintroduce a dependency on the
// target's GLIBCXX version, which is the problem that flag was added to avoid.
#include <cerrno>
#include <cstdlib>

extern "C" unsigned long int __isoc23_strtoul(const char* __restrict nptr,
                                               char** __restrict endptr,
                                               int base) {
  return ::strtoul(nptr, endptr, base);
}
