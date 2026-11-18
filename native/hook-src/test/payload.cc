// The payload that the manual loader maps into the target.
//
// Everything here runs inside the target process after relocation.  The only
// interesting work happens in a DT_INIT_ARRAY constructor: it writes a marker and
// bumps a counter that lives in the target's already-loaded library.
//
// That single write proves the whole chain worked: the segment was copied, the
// relocation referencing `hz_target_side_effect` was resolved against a module the
// target already had mapped, and the constructor ran.

#include <cstdint>
#include <cstdio>

// Provided by fake-wrapper.so, which the target loads at startup.  The manual
// loader must resolve this against the target's own mapping of that library.
extern "C" std::uint64_t hz_target_side_effect(std::uint64_t delta);
extern "C" volatile std::uint64_t hz_payload_marker;

// Local data with a variable initial value, which forces a RELATIVE relocation.
std::uint64_t g_local_state = 0x1122334455667788ull;

extern "C" void hz_payload_constructor() {
  g_local_state += 1;
  const std::uint64_t observed = hz_target_side_effect(1);
  hz_payload_marker = 0x48415a41ull;  // "HAZA"
  // The payload has no access to the target's stdout in general, but when it does
  // (same terminal) this line is the clearest possible proof of execution.
  std::printf("[payload] constructor ran: target counter now %llu, local=%llx\n",
              static_cast<unsigned long long>(observed),
              static_cast<unsigned long long>(g_local_state));
  std::fflush(stdout);
}

// `__attribute__((constructor))` is the standard way to get a pointer into
// .init_array; the section attribute alone does not survive linking.
__attribute__((constructor)) static void hz_register_constructor() {
  hz_payload_constructor();
}

extern "C" std::uint64_t hz_payload_version() { return 1; }