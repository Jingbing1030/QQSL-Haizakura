// Unit test for the std::Cr decoder in src/cr_string.cc.
//
// Why this is a test of its own: the decoder is the one piece of the receive path whose
// layout cannot be checked by comparing against a reference encoder on this host -- QQ's own
// libc++ is the only authority, and it is not available here. What CAN be pinned down is the
// rule itself, taken from the binary's copy constructor at 0x13efc7c:
//
//   byte0 LSB == 0  -> short (inline) form: len = byte0 >> 1, chars at +1
//   byte0 LSB == 1  -> long form: {cap @ +0, size @ +8, ptr @ +16}
//   SSO boundary 22 (0x16), not libstdc++'s 15
//
// The two failures this catches, both of which have already cost a client:
//
//   * reading the long form as {ptr @ +0, len @ +8} (the libstdc++ convention) -- which on
//     this object dereferences the capacity word as a pointer;
//   * assuming the SSO boundary is 15, so a 20-byte string is decoded as "long" from an
//     object that is actually inline.
//
// Run with: ./cr_string_test   (registered with ctest as `cr_string`)
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>

#include "cr_string.h"

static int fails = 0;
static void check(bool ok, const std::string& what) {
  std::printf("  %s %s\n", ok ? "ok  " : "FAIL", what.c_str());
  if (!ok) ++fails;
}

// An object of the exact shape Chromium libc++ lays out, built by hand.
//
// All three forms are modelled so a test can say "this is what a 22-byte string looks like"
// rather than "this is what my decoder thinks a 22-byte string looks like" -- the whole point
// is that the rule and the test are written from the disassembly independently.
struct CrObject {
  // 32 bytes is enough: short form uses [0,24) inline, long form uses [0,24) as
  // {cap, size, ptr}.
  unsigned char bytes[32];
  // Backing store for the long form's pointer, so it is a real mapped address.
  std::string backing;

  void make_short(const std::string& s) {
    std::memset(bytes, 0, sizeof(bytes));
    // byte0 = (len << 1) | 0 -- LSB clear means short. Characters from +1.
    bytes[0] = static_cast<unsigned char>(s.size() << 1);
    std::memcpy(bytes + 1, s.data(), s.size());
  }

  void make_long(const std::string& s) {
    std::memset(bytes, 0, sizeof(bytes));
    backing = s;
    // {cap @ +0, size @ +8, ptr @ +16}, with the flag bit set in the capacity word.
    const uint64_t cap = (s.size() + 1) | 1u;
    const uint64_t size = s.size();
    const uint64_t ptr = reinterpret_cast<uint64_t>(backing.data());
    std::memcpy(bytes + 0, &cap, 8);
    std::memcpy(bytes + 8, &size, 8);
    std::memcpy(bytes + 16, &ptr, 8);
  }

  uint64_t addr() const { return reinterpret_cast<uint64_t>(bytes); }
};

static std::string decode(const CrObject& o, size_t* declared = nullptr) {
  char out[HZ_CR_MAX_LEN + 1];
  size_t len = 0;
  const int rc = hz_cr_decode(o.addr(), 0, out, sizeof(out), &len);
  if (declared != nullptr) *declared = len;
  return rc == 1 ? std::string(out) : std::string("<failed>");
}

int main() {
  std::printf("cr_string: std::Cr decoding (SSO boundary 22)\n");

  // --- short (inline) form -------------------------------------------------
  // The 22-byte case is the one the boundary is named for: it is the LONGEST string libc++
  // stores inline. A decoder that uses libstdc++'s 15 would take these for long form and
  // read the length word as a pointer.
  {
    CrObject o;
    o.make_short("MessageSvc.PbSendMsg");  // 20 bytes, inline under SSO=22
    check(decode(o) == "MessageSvc.PbSendMsg",
          "short form, 20 bytes (would be long under libstdc++'s SSO=15)");
  }
  {
    CrObject o;
    o.make_short("0123456789012345678901");  // exactly 22
    check(decode(o) == "0123456789012345678901", "short form, exactly 22 bytes (SSO boundary)");
  }
  {
    CrObject o;
    o.make_short("");
    check(decode(o).empty(), "short form, empty string");
  }
  {
    CrObject o;
    o.make_short("1234567890");
    size_t declared = 0;
    const std::string got = decode(o, &declared);
    check(got == "1234567890" && declared == 10, "short form reports the declared length");
  }
  {
    // A uin is all digits and 10 chars wide; check it round-trips as an exact string, since
    // emit_packet runs strlen() on it and a stray NUL would truncate the frame field.
    CrObject o;
    o.make_short("10001");
    const std::string got = decode(o);
    check(got == "10001" && got.size() == 10, "short form, uin 10001");
  }

  // --- long (heap) form ---------------------------------------------------
  // 23 bytes is the shortest string libc++ stores on the heap: one past the boundary.
  {
    CrObject o;
    o.make_long("01234567890123456789012");  // 23
    check(decode(o) == "01234567890123456789012", "long form, 23 bytes (first heap length)");
  }
  {
    // The regression that matters: if the decoder read {ptr @ +0, len @ +8} it would take
    // this capacity word as a pointer and the length as garbage.
    CrObject o;
    const std::string s(64, 'A');
    o.make_long(s);
    check(decode(o) == s, "long form, 64 bytes (pointer must come from +16)");
  }
  {
    CrObject o;
    const std::string s = "MessageSvc.PbSendMsg.0123456789";
    o.make_long(s);
    check(decode(o) == s, "long form, command name over the boundary");
  }
  {
    CrObject o;
    const std::string s(500, 'x');
    o.make_long(s);
    check(decode(o) == s, "long form, 500 bytes (just under the clamp)");
  }

  // --- the clamp ---------------------------------------------------------
  // A misread layout produces a huge length. It must be clamped, not copied: this is the
  // difference between a dropped diagnostic and a wild read on QQ's thread.
  {
    // A misread layout produces a huge declared length. It must be clamped, not copied: this
    // is the difference between a dropped diagnostic and a wild read on QQ's thread.
    //
    // The backing store is padded past the clamp and filled with a non-NUL byte so the clamp
    // is actually observable -- with a short buffer the copy would happen to stop at a NUL
    // and the assertion could pass for the wrong reason.
    CrObject o;
    o.make_long(std::string(HZ_CR_MAX_LEN + 128, 'q'));
    const uint64_t huge = 1ull << 40;
    std::memcpy(o.bytes + 8, &huge, 8);
    char out[HZ_CR_MAX_LEN + 1];
    size_t len = 0;
    const int rc = hz_cr_decode(o.addr(), 0, out, sizeof(out), &len);
    check(rc == 1 && len == huge && std::strlen(out) == HZ_CR_MAX_LEN,
          "over-long length is clamped to HZ_CR_MAX_LEN, declared length preserved");
  }

  // --- refusals ---------------------------------------------------------
  {
    char out[64];
    size_t len = 0;
    check(hz_cr_decode(0, 0, out, sizeof(out), &len) == 0, "null base is refused");
  }
  {
    char out[64];
    size_t len = 0;
    // An address with no mapping behind it: the guard must report failure rather than fault.
    check(hz_cr_decode(0x1ull, 0, out, sizeof(out), &len) == 0, "unmapped address is refused");
  }
  {
    // A long form whose pointer is wild. Where libstdc++'s convention would have produced a
    // plausible-looking string here, this must refuse.
    CrObject o;
    o.make_long("x");
    const uint64_t wild = 0x1ull;
    std::memcpy(o.bytes + 16, &wild, 8);
    char out[64];
    size_t len = 0;
    check(hz_cr_decode(o.addr(), 0, out, sizeof(out), &len) == 0,
          "long form with an unmapped pointer is refused");
  }

  // --- the offset reaches the object -------------------------------------
  // The receive path decodes at resp+0x00 and resp+0x20, so the offset arithmetic is part
  // of the contract.
  {
    unsigned char blob[64];
    std::memset(blob, 0, sizeof(blob));
    const std::string cmd = "MessageSvc.PbSendMsg";
    blob[0x20] = static_cast<unsigned char>(cmd.size() << 1);
    std::memcpy(blob + 0x21, cmd.data(), cmd.size());
    char out[64];
    size_t len = 0;
    const int rc = hz_cr_decode(reinterpret_cast<uint64_t>(blob), 0x20, out, sizeof(out), &len);
    check(rc == 1 && std::string(out) == cmd, "decodes at a non-zero offset (resp+0x20)");
  }

  std::printf(fails == 0 ? "cr_string: all checks passed\n" : "cr_string: %d FAILED\n", fails);
  return fails == 0 ? 0 : 1;
}
