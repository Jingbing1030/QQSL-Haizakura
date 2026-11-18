// The library the target loads at startup.  It stands in for wrapper.node and
// provides the symbols the injected payload resolves against.

#include <cstdint>
#include <cstdio>

extern "C" volatile std::uint64_t hz_payload_marker = 0;
extern "C" volatile std::uint64_t g_target_counter = 0;

extern "C" std::uint64_t hz_target_side_effect(std::uint64_t delta) {
  g_target_counter += delta;
  std::printf("[target] side effect called, counter=%llu\n",
              static_cast<unsigned long long>(g_target_counter));
  std::fflush(stdout);
  return g_target_counter;
}

// Exported so the test harness can read the counter back out of the target.
extern "C" std::uint64_t hz_read_counter() { return g_target_counter; }
extern "C" std::uint64_t hz_read_marker() { return hz_payload_marker; }