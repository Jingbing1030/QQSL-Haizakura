// Decoding QQ's own `std::Cr` string, and the guarded read it needs.
//
// Split out of test/payload.cc so the layout rules live in exactly one place and can be
// unit-tested on the build host without mapping the payload into a target process.
//
// ---------------------------------------------------------------------------
// Why a second string layout exists at all
// ---------------------------------------------------------------------------
// `std::Cr` is Chromium's libc++, not libstdc++. Its long form is
// {cap @ +0, size @ +8, ptr @ +16} and its small-string boundary is 22 (0x16), not 15.
// Reading it with the libstdc++ convention -- ptr at +0, length at +8 -- dereferences the
// capacity word as a pointer. That mistake has killed the client twice, and on the receive
// path `emit_packet` would then run strlen() over arbitrary memory inside QQ's own thread.
//
// The authority is the binary's own copy constructor at 0x13efc7c (arm64 wrapper.node):
//
//   13efc90  ldrb  w8, [x1]           ; byte 0; LSB is the long/short flag
//   13efc98  tbnz  w8, #0, long       ; LSB set -> long form
//   short:   ldr q0, [x1]             ; 3 words inline; len = byte0 >> 1, chars from +1
//   13efcc0  ldp   x22, x20, [x1,#8]  ; long: x22 = size @ +8, x20 = DATA PTR @ +16
//   13efcc4  cmp   x22, #0x16         ; SSO boundary 22
//
// ---------------------------------------------------------------------------
// Why every read is guarded
// ---------------------------------------------------------------------------
// These run inside the target process on QQ's own threads, with pointers taken out of
// registers and out of objects whose layout is recovering. A layout guess that is off by
// one field is a SIGSEGV in the client, not an exception: there is nothing to catch.
// hz_safe_read() consults /proc/self/maps first, so a bad guess costs a dropped log line.
#ifndef HZ_CR_STRING_H
#define HZ_CR_STRING_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Longest string hz_cr_decode will copy. A service command or a uin is not megabytes, and
// the receive-side body is carried separately, so anything larger is a misread layout and
// clamping is the difference between a dropped line and a wild copy.
#define HZ_CR_MAX_LEN 512u

// Copies `len` bytes from `addr` into `out`, but only after proving the whole range is in a
// readable mapping. Returns non-zero on success.
int hz_safe_read(uint64_t addr, void* out, size_t len);

// Decodes the std::Cr string at `base + off` into `out` as a NUL-terminated C string.
//
// Returns 1 on success and 0 when the object could not be read at all (unmapped, or a null
// base). `*out_len` receives the string's declared length, which may exceed the bytes copied
// when the declared length is over HZ_CR_MAX_LEN -- the caller can then tell truncation from
// a genuinely short string. `out` is always NUL-terminated on success.
int hz_cr_decode(uint64_t base, unsigned off, char* out, size_t cap, size_t* out_len);

#ifdef __cplusplus
}
#endif

#endif  // HZ_CR_STRING_H
