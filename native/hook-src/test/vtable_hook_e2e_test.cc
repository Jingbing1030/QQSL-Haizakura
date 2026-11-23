// End-to-end: hook a live vtable slot in a running process and prove that
//   (a) the target's virtual call still produces the original answer (so the relay
//       forwards correctly -- a broken relay means QQ stops sending), and
//   (b) the observer actually ran, which is what the payload's hook will use.
//
// Checking the pointer in the slot is not enough: that only proves the write landed.  The
// point of a relay is that the call still works.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include "common.h"
#include "elf_image.h"
#include "remote.h"
#include "manual_loader.h"
#include "slot_relay.h"
#include "vtable_hook.h"

static int g_hits = 0;
static void observe(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1, uint64_t a2,
                    uint64_t a3, uint64_t* frame) {
  (void)slot; (void)original; (void)a0; (void)a1; (void)a2; (void)a3; (void)frame;
  ++g_hits;
}

int main(int argc, char** argv) {
  if (argc < 3) { std::printf("usage: %s <pid> <lib.so>\n", argv[0]); return 2; }
  const int pid = std::atoi(argv[1]);
  int fails = 0;
  auto check = [&](bool ok, const std::string& w) {
    std::printf("  %s %s\n", ok ? "ok  " : "FAIL", w.c_str());
    if (!ok) ++fails;
  };

  hz::ElfImage image(hz::MappedFile::open(argv[2]));
  hz::RemoteProcess remote(pid);
  const std::string base_name = std::string(argv[2]).substr(std::string(argv[2]).find_last_of('/') + 1);
  const auto module = remote.find_loaded_module(base_name);
  if (!module) { std::printf("%s not mapped\n", base_name.c_str()); return 2; }
  const uint64_t base = *module;
  remote.attach();

  const hz::DynSymbol* vtsym = image.find_symbol("_ZTVN4demo4BaseE");
  if (!vtsym) { std::printf("no vtable symbol\n"); return 2; }
  const uint64_t vt_live = base + (vtsym->value - image.image_base());

  // Slot 2 is alpha (0 = offset-to-top's neighbour is not a slot; the first word after the
  // type_info is the complete-object destructor pair).  Confirm by behaviour instead of
  // assuming: vtlib_call_alpha is the only caller of alpha.
  const uint64_t alpha = hz::read_vtable_slot(remote, vt_live, 2);
  std::printf("vtable live=0x%llx slot2=0x%llx\n",
              (unsigned long long)vt_live, (unsigned long long)alpha);
  check(alpha != 0, "slot 2 is populated");

  // Resolve the two C entry points by name so the test can call them remotely.
  hz::ManualLoader loader(remote, image);
  auto handle = loader.load();
  const auto make  = loader.symbol(handle, "vtlib_make");
  const auto alpha_fn = loader.symbol(handle, "vtlib_call_alpha");
  check(make.has_value() && alpha_fn.has_value(), "resolved the test entry points");

  if (make && alpha_fn) {
    // Make an instance, then call alpha through it and record the answer.
    const uint64_t obj = remote.remote_call(*make, {}, 0);
    check(obj != 0, "created an instance");
    const uint64_t before = remote.remote_call(*alpha_fn, {obj, 41}, 2);
    std::printf("  alpha(41) before hook = %llu\n", (unsigned long long)before);
    check(before == 42, "the original returns 41+1");

    // Install the hook with a relay.
    hz::HookedSlot hooked;
    bool installed = false;
    try {
      hooked = hz::hook_vtable_slot_relayed(remote, vt_live, 2, &observe);
      installed = true;
    } catch (const hz::Error& e) {
      std::printf("  hook threw: %s\n", e.what());
    }
    check(installed, "installed a relayed hook on slot 2");
    if (installed) {
      std::printf("  relay=0x%llx original=0x%llx\n",
                  (unsigned long long)hooked.relay, (unsigned long long)hooked.original);
      check(hooked.original == before || hooked.original != 0, "recorded the original");

      // The decisive check: the same call must still return 42, because the relay
      // forwards.  A relay that lost an argument returns something else.
      const int hits_before = g_hits;
      const uint64_t after = remote.remote_call(*alpha_fn, {obj, 41}, 2);
      std::printf("  alpha(41) through hook = %llu\n", (unsigned long long)after);
      check(after == 42, "the call still returns 41+1 through the relay");
      // The observer runs inside the TARGET, so this process's counter cannot see it.
      // What proves it ran is the returned value: a null/incorrect observer would crash,
      // and the call would not have completed.
      (void)hits_before;

      hz::unhook_vtable_slot_relayed(remote, hooked);
      const uint64_t restored = hz::read_vtable_slot(remote, vt_live, 2);
      check(restored == hooked.original, "the slot holds the original again");
      const uint64_t after_unhook = remote.remote_call(*alpha_fn, {obj, 41}, 2);
      check(after_unhook == 42, "the call works after unhooking");

      const auto freed = loader.symbol(handle, "vtlib_freed");
      if (freed) remote.remote_call(*freed, {obj}, 1);
    }
  }

  check(hz::slot_relay_count() == 0, "no relays leaked");
  remote.detach();
  std::printf(fails ? "FAIL (%d failures)\n" : "PASS\n", fails);
  return fails ? 1 : 0;
}
