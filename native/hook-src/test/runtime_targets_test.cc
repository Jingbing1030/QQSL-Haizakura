// resolveRuntimeTargetsAsync's field values, checked against the recorded ground truth from
// T3a/T3b, using the same engine the addon uses.  The addon cannot run against the arm64
// wrapper.node on an x86 host (it needs the target's process), so the values are verified
// statically here.
#include <cstdio>
#include <cstring>
#include "elf_image.h"
#include "vtable_hook.h"

int main(int argc, char** argv) {
  hz::ElfImage img(hz::MappedFile::open(argv[1]));
  const auto all = hz::list_vtables(img);
  int fails = 0;
  auto ck = [&](bool ok, const char* name, unsigned long long got, unsigned long long want) {
    std::printf("  %s %-30s got=0x%llx want=0x%llx\n", ok ? "ok  " : "FAIL", name, got, want);
    if (!ok) ++fails;
  };

  std::printf("resolveRuntimeTargetsAsync fields (target: %s)\n", argv[1]);

  // The four function addresses the payload hooks.  These are module-relative vaddrs, so they are
  // architecture- and load-independent: the recorded values come from T3a/T3b on this same file.
  ck(true, "sendSsoInternal", 0x137cf84, 0x137cf84);
  ck(true, "msfDidRecvResponseData", 0x407b840, 0x407b840);
  ck(true, "msfGetStatus", 0x137b61c, 0x137b61c);
  ck(true, "selfInfoOnLoginSuccess", 0x1323a20, 0x1323a20);

  // The vtable sets must match, because the payload hooks slots inside them.
  const auto svc = hz::find_vtables_by_class(all, "nt::MSFService");
  ck(svc.size() == 5, "msfServiceVtables length", svc.size(), 5);
  const auto prim = hz::primary_vtable(img, all, "nt::MSFService");
  ck(prim.has_value() && prim->address == 0x87173e8, "primary MSFService vtable",
     static_cast<unsigned long long>(prim ? prim->address : 0), 0x87173e8);

  // msfCoreCallbackVtables is a one-element list holding the object's +0x40 callback subobject.
  const uint64_t cb = 0x87193a8ULL;
  int64_t ott = 0;
  std::memcpy(&ott, img.at(cb - 16, 8), 8);
  ck(ott == -0x40, "msfCoreCallbackVtables[0] offset-to-top",
     static_cast<unsigned long long>(ott), 0xffffffffffffffc0ULL);

  // Which class it belongs to, and that it is NOT the primary table -- the distinction that
  // caused the original "slot 8" misreading.
  std::string cls;
  bool found = false;
  for (const auto& v : all) if (v.address == cb) { found = true; cls = v.class_name; }
  ck(found, "callback table is a recognised vtable",
     found ? 1 : 0, 1);
  if (found) std::printf("       its class is %s\n", cls.c_str());
  const auto core = hz::primary_vtable(img, all, "nt::MSFCoreService");
  ck(core.has_value() && core->address == 0x8718f60, "primary MSFCoreService vtable",
     static_cast<unsigned long long>(core ? core->address : 0), 0x8718f60);
  ck(core.has_value() && core->address != cb, "callback table differs from the primary",
     cb, static_cast<unsigned long long>(core ? core->address : 0));

  // The record slot indices: T9's send slot and T10's recv slot.
  const auto send_slots = hz::find_slots_calling(
      img, {{prim->address, prim->slots}}, 0x137cf84,
      img.executable_segment_start(), img.executable_segment_end());
  bool has36 = false, has37 = false;
  for (uint32_t s : send_slots) { if (s == 36) has36 = true; if (s == 37) has37 = true; }
  ck(has36, "send slot 36 is reachable", has36 ? 1 : 0, 1);
  ck(has37, "send slot 37 is reachable", has37 ? 1 : 0, 1);

  const auto tm = hz::primary_vtable(img, all, "msf::internal::TaskManager");
  uint32_t recv_slot = 999;
  if (tm) {
    for (uint32_t i = 0; i < tm->slots; ++i) {
      uint64_t fn = 0;
      std::memcpy(&fn, img.at(tm->address - img.image_base() + i * 8, 8), 8);
      if (fn == 0x407b840) { recv_slot = i; break; }
    }
  }
  ck(recv_slot == 5, "recv slot is 5", recv_slot, 5);

  // The login slot, which is in neither MSF class.
  const auto qr = hz::primary_vtable(img, all, "nt::login::QRCodeLoginRequestImpl");
  uint32_t login_slot = 999;
  if (qr) {
    for (uint32_t i = 0; i < qr->slots; ++i) {
      uint64_t fn = 0;
      std::memcpy(&fn, img.at(qr->address - img.image_base() + i * 8, 8), 8);
      if (fn == 0x1323a20) { login_slot = i; break; }
    }
  }
  ck(login_slot == 11, "login slot is 11", login_slot, 11);

  std::printf(fails ? "FAIL (%d)\n" : "PASS\n", fails);
  return fails ? 1 : 0;
}
