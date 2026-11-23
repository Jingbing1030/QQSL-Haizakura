#include "cr_string.h"

#include <cstring>
#include <fcntl.h>
#include <unistd.h>

// No <cstring>/<string> on purpose: this file is linked into the payload, which the manual
// loader maps into the target. The loader implements no TLS relocations, so nothing here may
// pull in a thread-local -- a plain byte loop does the copy and is also the only version that
// is safe to inline into a function running on QQ's receive thread.
namespace {

// Copies `len` bytes without assuming src is valid beyond what hz_safe_read checked.
void byte_copy(void* dst, const void* src, size_t len) {
  const unsigned char* s = static_cast<const unsigned char*>(src);
  unsigned char* d = static_cast<unsigned char*>(dst);
  for (size_t i = 0; i < len; ++i) d[i] = s[i];
}

// Reads `len` bytes at `addr` into `out`, but only if [addr, addr+len) is inside a mapping
// whose permission field starts with 'r'. Returns non-zero on success.
//
// /proc/self/maps is the only portable answer inside a process with no libstdc++ and no TLS,
// and it is why this is a parse rather than a signal handler: a faulting read cannot be
// recovered from here.
//
// The parse is deliberately boring -- `lo-hi perms ...` on each line, hex, separated by '-'
// and ' '. An earlier version interleaved the two hex numbers in one state machine and set
// its "finished the low half" flag on the '-' separator, then immediately took the first hex
// digit of the high half as an unknown character and broke out of the line. The effect was
// that no address ever matched: every guarded read in the payload returned false, so every
// diagnostic logged nothing, and the failure looked like "the observer was never called"
// rather than "the bounds check is broken". Two small helpers are harder to get wrong than
// one clever loop.

// Reads a hex number at *p, advancing *p. Returns non-zero and sets *out when at least one
// digit was consumed.
int parse_hex(const char** p, uint64_t* out) {
  const char* q = *p;
  uint64_t v = 0;
  int digits = 0;
  for (;;) {
    const char c = *q;
    int d;
    if (c >= '0' && c <= '9') d = c - '0';
    else if (c >= 'a' && c <= 'f') d = c - 'a' + 10;
    else if (c >= 'A' && c <= 'F') d = c - 'A' + 10;
    else break;
    v = (v << 4) | static_cast<uint64_t>(d);
    ++q;
    ++digits;
  }
  *p = q;
  if (digits == 0) return 0;
  *out = v;
  return 1;
}

// Matches one whole line of /proc/self/maps against [addr, end). Non-zero when the range is
// covered by a readable mapping.
int line_covers(const char* line, uint64_t addr, uint64_t end) {
  const char* p = line;
  uint64_t lo = 0;
  uint64_t hi = 0;
  if (!parse_hex(&p, &lo)) return 0;
  if (*p != '-') return 0;
  ++p;
  if (!parse_hex(&p, &hi)) return 0;
  // The permission field follows a single space: "rwxp" or "r--p" and so on.
  if (*p != ' ') return 0;
  ++p;
  const int readable = (p[0] == 'r');
  if (!readable) return 0;
  return addr >= lo && end <= hi;
}

int safe_read_impl(uint64_t addr, void* out, size_t len) {
  if (addr == 0 || len == 0) return 0;
  const uint64_t end = addr + len;
  if (end < addr) return 0;  // wrapped
  const int fd = ::open("/proc/self/maps", O_RDONLY | O_CLOEXEC);
  if (fd < 0) return 0;
  // Line-oriented rather than block-oriented: /proc/self/maps is generated a line at a time
  // and a line is never longer than PATH_MAX + 60, so a buffer large enough for the longest
  // possible line means a partial line is never a case that has to be handled.
  char buf[8192];
  int ok = 0;
  size_t have = 0;
  for (;;) {
    const ssize_t n = ::read(fd, buf + have, sizeof(buf) - 1 - have);
    if (n <= 0) break;
    have += static_cast<size_t>(n);
    buf[have] = '\0';
    // Consume every complete line in the buffer.
    size_t start = 0;
    for (;;) {
      char* nl = static_cast<char*>(std::memchr(buf + start, '\n', have - start));
      if (nl == nullptr) break;
      *nl = '\0';
      if (line_covers(buf + start, addr, end)) {
        ok = 1;
        break;
      }
      start = static_cast<size_t>(nl - buf) + 1;
    }
    if (ok) break;
    // Keep the unterminated tail for the next read.
    have -= start;
    if (have >= sizeof(buf) - 1) break;  // a single line larger than the buffer
    for (size_t k = 0; k < have; ++k) buf[k] = buf[start + k];
  }
  ::close(fd);
  if (!ok) return 0;
  byte_copy(out, reinterpret_cast<const void*>(addr), len);
  return 1;
}

}  // namespace

extern "C" int hz_safe_read(uint64_t addr, void* out, size_t len) {
  return safe_read_impl(addr, out, len);
}

extern "C" int hz_cr_decode(uint64_t base, unsigned off, char* out, size_t cap, size_t* out_len) {
  if (out == 0 || cap == 0) return 0;
  out[0] = '\0';
  if (out_len != 0) *out_len = 0;
  if (base == 0) return 0;

  const uint64_t obj = base + off;

  // The first word carries the flag and, in the short form, the length. Read it as a whole
  // word: the flag is byte 0 and the short-form copy uses all 24 bytes inline, so this is
  // also the read that proves the object itself is mapped before any field is trusted.
  unsigned char head[24];
  if (!safe_read_impl(obj, head, sizeof(head))) return 0;

  const unsigned char flag = head[0];
  uint64_t len = 0;
  const unsigned char* data = 0;

  if ((flag & 1u) == 0) {
    // Short form: len in the top bits of byte 0, characters start at +1.
    len = static_cast<uint64_t>(flag) >> 1;
    data = head + 1;
    // 24 bytes were read, so the inline payload is present; guard the arithmetic anyway.
    if (len > sizeof(head) - 1) return 0;
  } else {
    // Long form {cap @ +0, size @ +8, ptr @ +16}: size first, then the pointer.
    uint64_t stored = 0;
    if (!safe_read_impl(obj + 8, &stored, sizeof(stored))) return 0;
    uint64_t ptr = 0;
    if (!safe_read_impl(obj + 16, &ptr, sizeof(ptr))) return 0;
    len = stored;
    data = reinterpret_cast<const unsigned char*>(ptr);
    if (data == 0) return 0;
  }

  if (out_len != 0) *out_len = static_cast<size_t>(len);
  if (len == 0) return 1;  // a legitimately empty string
  if (len > HZ_CR_MAX_LEN) len = HZ_CR_MAX_LEN;
  if (len > cap - 1) len = cap - 1;

  // A long form's pointer is the one that can be wild; the short form's bytes were already
  // proven readable by the head read. Both go through the guard so there is one path.
  if (!safe_read_impl(reinterpret_cast<uint64_t>(data), out, static_cast<size_t>(len))) {
    out[0] = '\0';
    return 0;
  }
  out[len] = '\0';
  return 1;
}
