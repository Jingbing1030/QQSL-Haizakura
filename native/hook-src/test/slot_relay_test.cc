// The relay's only real requirement: a call it knows nothing about must arrive at the
// original with every argument intact, and the original's return value must reach the
// caller unchanged.
//
// What would go wrong without this test: a relay that saves "the six integer argument
// registers" looks right and passes a naive smoke test, then corrupts a call passing
// a double in xmm0 or a variadic's vector count in rax.  On x86 that shows up as a
// wrong float in a packet, on aarch64 as a crash.  So the cases below deliberately
// cover the shapes a vtable slot can actually have.
#include <cstdio>
#include <cstring>
#include <cmath>
#include <string>
#include <vector>

#include "slot_relay.h"

namespace {

int g_observed = 0;
uint32_t g_last_slot = 0;
uint64_t g_last_original = 0;

void observer(uint32_t slot, uint64_t original) {
  ++g_observed;
  g_last_slot = slot;
  g_last_original = original;
}

int failures = 0;
void check(bool ok, const std::string& what) {
  std::printf("  %s %s\n", ok ? "ok  " : "FAIL", what.c_str());
  if (!ok) ++failures;
}

// --- the functions the relay fronts, one per calling shape -----------------

int add6(int a, int b, int c, int d, int e, int f) {
  return a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f;
}

double sum_doubles(double a, double b, double c, double d, double e, double f,
                   double g, double h) {
  return a + b + c + d + e + f + g + h;
}

// Mixed: integers in registers and a double in an xmm register, which is where a
// "save only the obvious registers" relay breaks.
double mixed(int a, double b, int c, double d) {
  return a * 1000.0 + b * 100.0 + c * 10.0 + d;
}

long many_mixed(long a, double b, long c, double d, long e, double f) {
  return a + static_cast<long>(b) + c + static_cast<long>(d) + e + static_cast<long>(f);
}

// A variadic call puts the number of vector arguments in rax on x86-64 SysV.  A relay
// that clobbers rax makes the callee read garbage for its floats.
int variadic(int count, ...) {
  __builtin_va_list ap;
  __builtin_va_start(ap, count);
  int total = 0;
  for (int i = 0; i < count; ++i) total += __builtin_va_arg(ap, int);
  __builtin_va_end(ap);
  return total;
}

double variadic_double(int count, ...) {
  __builtin_va_list ap;
  __builtin_va_start(ap, count);
  double total = 0;
  for (int i = 0; i < count; ++i) total += __builtin_va_arg(ap, double);
  __builtin_va_end(ap);
  return total;
}

struct Big {
  long a, b, c;
};

Big by_value(Big in) { return Big{in.a * 2, in.b * 3, in.c * 4}; }

}  // namespace

int main() {
  std::printf("relays live at start: %u\n", hz::slot_relay_count());

  // Each case: install a relay in front of the function, call through the relay with
  // the function's own prototype, and require the answer to match a direct call.
  {
    const uint64_t relay = hz::slot_relay_install(3, reinterpret_cast<uint64_t>(&add6), &observer);
    check(relay != 0, "install returns an address");
    auto fn = reinterpret_cast<int (*)(int, int, int, int, int, int)>(relay);
    const int direct = add6(1, 2, 3, 4, 5, 6);
    const int relayed = fn(1, 2, 3, 4, 5, 6);
    std::printf("  6 ints: direct=%d relayed=%d\n", direct, relayed);
    check(direct == relayed, "six integer arguments arrive intact");
    check(g_observed == 1, "observer ran once");
    check(g_last_slot == 3, "observer saw the slot index");
    check(g_last_original == reinterpret_cast<uint64_t>(&add6), "observer saw the original");
    hz::slot_relay_remove(relay);
    check(hz::slot_relay_count() == 0, "removal drops the relay");
  }

  {
    const uint64_t relay = hz::slot_relay_install(
        0, reinterpret_cast<uint64_t>(&sum_doubles), &observer);
    auto fn = reinterpret_cast<double (*)(double, double, double, double, double, double,
                                          double, double)>(relay);
    const double direct = sum_doubles(1.5, 2.25, 3.125, 4.0625, 5.5, 6.5, 7.5, 8.5);
    const double relayed = fn(1.5, 2.25, 3.125, 4.0625, 5.5, 6.5, 7.5, 8.5);
    std::printf("  doubles: direct=%.6f relayed=%.6f\n", direct, relayed);
    check(std::fabs(direct - relayed) < 1e-12, "eight double arguments arrive intact");
    hz::slot_relay_remove(relay);
  }

  {
    const uint64_t relay = hz::slot_relay_install(
        1, reinterpret_cast<uint64_t>(&mixed), &observer);
    auto fn = reinterpret_cast<double (*)(int, double, int, double)>(relay);
    const double direct = mixed(7, 2.5, 9, 0.75);
    const double relayed = fn(7, 2.5, 9, 0.75);
    std::printf("  mixed int/double: direct=%.4f relayed=%.4f\n", direct, relayed);
    check(std::fabs(direct - relayed) < 1e-9,
          "integers and doubles interleaved arrive intact");
    hz::slot_relay_remove(relay);
  }

  {
    const uint64_t relay = hz::slot_relay_install(
        2, reinterpret_cast<uint64_t>(&many_mixed), &observer);
    auto fn = reinterpret_cast<long (*)(long, double, long, double, long, double)>(relay);
    const long direct = many_mixed(1, 2.0, 3, 4.0, 5, 6.0);
    const long relayed = fn(1, 2.0, 3, 4.0, 5, 6.0);
    std::printf("  six mixed: direct=%ld relayed=%ld\n", direct, relayed);
    check(direct == relayed, "six mixed args arrive intact");
    hz::slot_relay_remove(relay);
  }

  {
    const uint64_t relay = hz::slot_relay_install(
        4, reinterpret_cast<uint64_t>(&variadic), &observer);
    auto fn = reinterpret_cast<int (*)(int, ...)>(relay);
    const int direct = variadic(5, 10, 20, 30, 40, 50);
    const int relayed = fn(5, 10, 20, 30, 40, 50);
    std::printf("  variadic ints: direct=%d relayed=%d\n", direct, relayed);
    check(direct == relayed, "a variadic integer call arrives intact");
    hz::slot_relay_remove(relay);
  }

  {
    const uint64_t relay = hz::slot_relay_install(
        5, reinterpret_cast<uint64_t>(&variadic_double), &observer);
    auto fn = reinterpret_cast<double (*)(int, ...)>(relay);
    const double direct = variadic_double(4, 1.5, 2.5, 3.5, 4.5);
    const double relayed = fn(4, 1.5, 2.5, 3.5, 4.5);
    std::printf("  variadic doubles: direct=%.4f relayed=%.4f\n", direct, relayed);
    check(std::fabs(direct - relayed) < 1e-9,
          "a variadic double call arrives intact (this is the rax case)");
    hz::slot_relay_remove(relay);
  }

  {
    const uint64_t relay = hz::slot_relay_install(
        6, reinterpret_cast<uint64_t>(&by_value), &observer);
    auto fn = reinterpret_cast<Big (*)(Big)>(relay);
    const Big direct = by_value(Big{2, 3, 4});
    const Big relayed = fn(Big{2, 3, 4});
    std::printf("  struct by value: direct={%ld,%ld,%ld} relayed={%ld,%ld,%ld}\n",
                direct.a, direct.b, direct.c, relayed.a, relayed.b, relayed.c);
    check(direct.a == relayed.a && direct.b == relayed.b && direct.c == relayed.c,
          "a by-value struct arrives intact");
    hz::slot_relay_remove(relay);
  }

  // Two relays at once: the state blocks must not be shared, or concurrent calls would
  // each forward the other's arguments.
  {
    const uint64_t r1 = hz::slot_relay_install(7, reinterpret_cast<uint64_t>(&add6), &observer);
    const uint64_t r2 = hz::slot_relay_install(8, reinterpret_cast<uint64_t>(&mixed), &observer);
    check(r1 != r2, "two relays get distinct trampolines");
    auto f1 = reinterpret_cast<int (*)(int, int, int, int, int, int)>(r1);
    auto f2 = reinterpret_cast<double (*)(int, double, int, double)>(r2);
    const int a1 = f1(1, 1, 1, 1, 1, 1);
    const double a2 = f2(1, 1.0, 1, 1.0);
    std::printf("  two relays: %d and %.4f\n", a1, a2);
    check(a1 == add6(1, 1, 1, 1, 1, 1), "first relay still correct beside a second");
    check(std::fabs(a2 - mixed(1, 1.0, 1, 1.0)) < 1e-9, "second relay correct");
    check(g_last_slot == 8, "the second relay's slot was reported last");
    hz::slot_relay_remove(r1);
    hz::slot_relay_remove(r2);
    check(hz::slot_relay_count() == 0, "both relays released");
  }

  // An observer that does nothing must not change behaviour: a real payload may only
  // want to count calls on some slots.
  {
    const uint64_t relay = hz::slot_relay_install(
        9, reinterpret_cast<uint64_t>(&add6), nullptr);
    auto fn = reinterpret_cast<int (*)(int, int, int, int, int, int)>(relay);
    const int relayed = fn(9, 8, 7, 6, 5, 4);
    std::printf("  null observer: relayed=%d\n", relayed);
    check(relayed == add6(9, 8, 7, 6, 5, 4), "a null observer forwards unchanged");
    hz::slot_relay_remove(relay);
  }

  std::printf(failures ? "FAIL (%d failures)\n" : "PASS\n", failures);
  return failures ? 1 : 0;
}
