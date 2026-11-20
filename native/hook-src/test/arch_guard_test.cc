// Verifies that function-entry hooking refuses to run on architectures where the
// patch encoding does not apply.
//
// The patch is AArch64-only: it writes a fixed 16 bytes holding `ldr x16, #8` and
// `br x16`.  On x86_64 that is not a missing branch but a wrong mechanism --
// instructions are variable length, so a fixed-width overwrite lands mid-instruction,
// and the prologue scan that guards relocated instructions compares x86 bytes against
// AArch64 masks.  The reference implementation never patches entries at all; it only
// rewrites vtable slots, which works on both architectures.
//
// This test asserts the refusal rather than the absence of a crash, because a silent
// 16-byte overwrite of a live function is exactly the failure that motivated it.

#include <cstdio>
#include <cstring>

#include "vtable_hook.h"

namespace {

int failures = 0;

void check(bool cond, const char* what) {
  if (cond) {
    std::printf("  ok   %s\n", what);
  } else {
    std::printf("  FAIL %s\n", what);
    ++failures;
  }
}

}  // namespace

int main() {
  std::printf("function-entry hooking on this architecture\n");

#if defined(__aarch64__)
  // On AArch64 the mechanism is supported, so the guard must NOT fire.  A null
  // target is still refused, which proves the checks run in the right order.
  bool refused_null = false;
  try {
    hz::hook_function_relayed_in_process(0, nullptr, 0);
  } catch (const std::exception&) {
    refused_null = true;
  }
  check(refused_null, "a null target is refused");

  bool refused_observer = false;
  try {
    hz::hook_function_relayed_in_process(0x1000, nullptr, 0);
  } catch (const std::exception&) {
    refused_observer = true;
  }
  check(refused_observer, "a null observer is refused");
  std::printf("  (entry hooking is supported on aarch64)\n");
#else
  // On x86_64 the refusal must be explicit and must state why, so a caller sees a
  // diagnosis instead of a crash much later inside the target.
  bool refused = false;
  std::string message;
  try {
    hz::hook_function_relayed_in_process(0x1000, reinterpret_cast<hz::SlotObserver>(0x2000), 0);
  } catch (const std::exception& e) {
    refused = true;
    message = e.what();
  }
  check(refused, "entry hooking is refused on this architecture");
  check(message.find("AArch64") != std::string::npos ||
            message.find("aarch64") != std::string::npos,
        "the refusal names the architecture it is limited to");
  check(message.find("vtable") != std::string::npos,
        "the refusal names the mechanism that does work here");
#endif

  if (failures == 0) {
    std::printf("PASS\n");
    return 0;
  }
  std::printf("FAIL (%d failures)\n", failures);
  return 1;
}
