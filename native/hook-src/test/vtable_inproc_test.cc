// The in-process hook path: patch a vtable from inside the process that owns it.
//
// This is the path the payload actually uses.  The ptrace path cannot be used there -- a
// process cannot ptrace itself -- so an integration that only tested the ptrace variant would
// compile, pass, and then fail the moment the payload tried to install a hook.
//
// The subject is this process's own class, so both directions are observable: the hook is
// installed with a plain store, and the virtual call is made here.
#include <cstdio>
#include <cstring>
#include <string>

#include "elf_image.h"
#include "vtable_hook.h"

namespace demo {
class Subject {
 public:
  virtual ~Subject() {}
  virtual int one(int x) { return x + 1; }
  virtual int two(int x) { return x + 2; }
  virtual int three(int x) { return x + 3; }
};
}  // namespace demo

static int g_hits = 0;
static uint32_t g_last_slot = 0;
static void observer(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1, uint64_t a2,
                     uint64_t a3, uint64_t* frame) {
  (void)frame;
  ++g_hits;
  g_last_slot = slot;
  (void)original; (void)a0; (void)a1; (void)a2; (void)a3;
}

// Returns the pointer unchanged but is opaque to the optimiser: without this the compiler
// devirtualises `one()` into a direct call (verified in the disassembly) and the hook correctly
// never fires.  That failure looks identical to a broken hook, which is why the test forces the
// dispatch rather than trusting the source to be virtual.
#if defined(__GNUC__)
__attribute__((noinline))
#endif
static demo::Subject* opaque_ptr(demo::Subject* p) {
  // A volatile store/load pair defeats value numbering without needing an asm barrier.
  demo::Subject* volatile v = p;
  return v;
}

static int failures = 0;
static void check(bool ok, const std::string& what) {
  std::printf("  %s %s\n", ok ? "ok  " : "FAIL", what.c_str());
  if (!ok) ++failures;
}

int main() {
  // Find this process's own vtable by RTTI through /proc/self/exe is not needed: the object's
  // vptr IS the vtable address, so taking it from a live instance is the most direct route and
  // is what a payload does when it has an object in hand.
  demo::Subject subject;
  demo::Subject* const opaque = opaque_ptr(&subject);
  const uint64_t vtable = *reinterpret_cast<const uint64_t*>(&subject);
  std::printf("vtable of demo::Subject = 0x%llx\n", (unsigned long long)vtable);
  check(vtable != 0, "read the vtable pointer from a live object");

  // Call through a base reference so the compiler cannot devirtualise: a call on a concrete
  // local object of known dynamic type may be statically bound, in which case the vtable is
  // never read and the hook legitimately never fires.
  demo::Subject& via_base = *opaque;

  // Slot 2 is `one`; slots 0 and 1 are the destructor pair (complete and deleting).
  const int before = via_base.one(41);
  std::printf("  one(41) before hook = %d\n", before);
  check(before == 42, "the original returns 41+1");

  // Install the relayed hook in-process.
  hz::HookedSlot hooked;
  bool installed = false;
  try {
    hooked = hz::hook_vtable_slot_relayed_in_process(vtable, 2, &observer);
    installed = true;
  } catch (const hz::Error& e) {
    std::printf("  hook threw: %s\n", e.what());
  }
  check(installed, "installed an in-process relayed hook");
  if (!installed) {
    std::printf("FAIL\n");
    return 1;
  }

  // The decisive checks: the call still works, and the observer saw it.
  const int hits_before = g_hits;
  const int after = via_base.one(41);
  std::printf("  one(41) through hook = %d (observer hits +%d, slot %u)\n",
              after, g_hits - hits_before, g_last_slot);
  check(after == 42, "the call still returns 41+1 through the relay");
  check(g_hits == hits_before + 1, "the observer ran exactly once, in this process");
  check(g_last_slot == 2, "the observer was told which slot fired");

  // A different virtual on the same object must be untouched: hooking one slot must not
  // disturb its neighbours.
  const int two_before = via_base.two(10);
  check(two_before == 12, "a neighbouring virtual is unaffected");

  hz::unhook_vtable_slot_relayed_in_process(hooked);
  const int restored = via_base.one(41);
  std::printf("  one(41) after unhook = %d\n", restored);
  check(restored == 42, "the call works after unhooking");
  check(hz::slot_relay_count() == 0, "no relays leaked");

  std::printf(failures ? "FAIL (%d failures)\n" : "PASS\n", failures);
  return failures ? 1 : 0;
}
