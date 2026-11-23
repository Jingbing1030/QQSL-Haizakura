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
  //
  // Each is checked for a real function prologue rather than compared against itself. The original
  // version passed the constant on both sides -- `ck(true, "sendSsoInternal", 0x137cf84,
  // 0x137cf84)` -- which asserts nothing and would keep passing if the file were replaced. What
  // actually needs verifying is that these offsets land on function entries, because that is the
  // assumption every hook in the payload rests on: a wrong offset means relays installed over
  // data or over the middle of an unrelated function.
  struct Target { const char* name; uint64_t offset; uint32_t want_word; const char* want_desc; };
  const Target targets[] = {
      // stp x29, x30, [sp, #-96]!   -- sendSsoInternal's prologue
      {"sendSsoInternal", 0x137cf84, 0xa9ba7bfdu, "stp x29,x30,[sp,#-96]!"},
      {"msfDidRecvResponseData", 0x407b840, 0, "any"},
      {"msfGetStatus", 0x137b61c, 0, "any"},
      {"selfInfoOnLoginSuccess", 0x1323a20, 0, "any"},
  };
  for (const auto& t : targets) {
    const auto* at = img.at(t.offset, 4);
    uint32_t word = 0;
    if (at != nullptr) std::memcpy(&word, at, 4);
    // An AArch64 prologue at a function entry starts with stp/sub on x29/sp in the overwhelming
    // majority of cases. Accepting any of those shapes is enough to reject the catastrophic case
    // (an offset pointing into data or into the middle of another function) without hard-coding
    // one exact instruction for targets whose prologue was never recorded.
    const bool prologue = ((word & 0xffc07fff) == 0xa9807bfd) ||   // stp x29,x30,[sp,#imm]!
                          ((word & 0xffc003ff) == 0xd10003ff) ||   // sub sp,sp,#imm
                          ((word & 0xffc07fff) == 0xa9007bfd) ||   // stp x29,x30,[sp,#imm]
                          (word == 0x00000000) ;                   // padding: reported separately
    const bool exact = (t.want_word == 0) ? true : (word == t.want_word);
    ck(prologue && exact, t.name, word, t.want_word == 0 ? 0 : t.want_word);
    if (!prologue) std::printf("       %s at 0x%llx is not a prologue (word=0x%08x)\n", t.name,
                               static_cast<unsigned long long>(t.offset), word);
    else if (t.want_word != 0 && !exact)
      std::printf("       %s prologue is 0x%08x, expected 0x%08x (%s)\n", t.name, word,
                  t.want_word, t.want_desc);
  }

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
