// Exercises the vtable discovery engine against a real wrapper.node.
//
// What this can and cannot prove: locating vtables by RTTI name is a pure
// file-image operation, so it is fully testable here.  Actually replacing a slot
// needs a live target and is covered by the stub payload end to end; what this
// test pins down is that the *addresses* the engine reports match the ones the
// reference implementation resolves at runtime -- if discovery drifts, every hook
// built on it silently points somewhere else.
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "elf_image.h"
#include "common.h"
#include "vtable_hook.h"

#include <set>

int main(int argc, char** argv) {
  if (argc < 2) {
    std::printf("usage: %s <wrapper.node>\n", argv[0]);
    return 2;
  }
  int failures = 0;
  auto check = [&](bool ok, const std::string& what) {
    std::printf("  %s %s\n", ok ? "ok  " : "FAIL", what.c_str());
    if (!ok) ++failures;
  };

  hz::ElfImage image(hz::MappedFile::open(argv[1]));
  const auto all = hz::list_vtables(image);
  std::printf("vtables discovered: %zu\n", all.size());
  check(all.size() > 1000, "found a plausible number of vtables");

  // The four classes the payload hooks, with the slot counts the reference
  // implementation reports.  A mismatch means discovery is reading the wrong
  // thing -- not that the numbers are cosmetically different.
  struct Expect {
    const char* name;
    size_t min_count;
    uint32_t max_slots;
  };
  const Expect expect[] = {
      {"nt::MSFService", 5, 61},
      {"nt::MSFCoreService", 6, 61},
      {"msf::MSFSessionImpl", 2, 30},
      {"msf::internal::TaskManager", 1, 6},
  };
  for (const auto& e : expect) {
    const auto found = hz::find_vtables_by_class(all, e.name);
    std::printf("%s: %zu vtables\n", e.name, found.size());
    check(found.size() >= e.min_count,
          hz::format("%s has at least %zu vtables", e.name, e.min_count));
    uint32_t max_slots = 0;
    for (const auto& v : found) if (v.slots > max_slots) max_slots = v.slots;
    if (!found.empty()) {
      std::printf("  max slots: %u (expected %u)\n", max_slots, e.max_slots);
      check(max_slots == e.max_slots,
            hz::format("%s's largest vtable has %u slots", e.name, e.max_slots));
    }
    // Addresses must be unique: two entries with the same address mean the scan
    // re-reported a vtable it already had.
    for (size_t i = 0; i < found.size(); ++i) {
      for (size_t j = i + 1; j < found.size(); ++j) {
        if (found[i].address == found[j].address) {
          check(false, hz::format("%s has a duplicate vtable at 0x%llx", e.name,
                                  static_cast<unsigned long long>(found[i].address)));
        }
      }
    }
  }

  // The type_info of the class must be the one the runtime resolves, and every
  // vtable of that class must point at that same type_info.
  const auto svc = hz::find_vtables_by_class(all, "nt::MSFService");
  if (!svc.empty()) {
    const uint64_t ti = svc.front().typeinfo;
    std::printf("nt::MSFService typeinfo: 0x%llx\n", static_cast<unsigned long long>(ti));
    bool same = true;
    for (const auto& v : svc) if (v.typeinfo != ti) same = false;
    check(same, "every nt::MSFService vtable shares one type_info");
  }

  // Locate the send slot by what it calls rather than by its index.  sendSsoInternal sits
  // at 0x137cf84 and is reached from exactly four places in the whole module, all of them
  // slots of nt::MSFService -- so "the slot whose function calls it" identifies the send
  // path without hardcoding 36.  This is the property T9 needs: a relink moves the index,
  // it does not change who calls whom.
  {
    const uint64_t send_sso = 0x137cf84ULL;
    std::printf("locating slots that call sendSsoInternal (0x%llx)\n",
                static_cast<unsigned long long>(send_sso));
    // Which table implements the class, decided by the engine rather than by a rule the
    // test invents.  Getting this wrong is the failure mode that matters: the 61-slot table
    // has more slots and 61 distinct pointers, yet 57 of them are one-instruction ret stubs,
    // so hooking through it does nothing while looking successful.
    const auto primary = hz::primary_vtable(image, all, "nt::MSFService");
    check(primary.has_value(), "identified a primary nt::MSFService vtable");
    if (primary) {
      std::printf("  primary: 0x%llx with %u slots\n",
                  static_cast<unsigned long long>(primary->address), primary->slots);
      check(primary->address == 0x87173e8ULL,
            "chose the 44-slot table, not the 61-slot stub filler");
    }
    std::vector<hz::VtableRef> addrs;
    if (primary) addrs.push_back(hz::VtableRef{primary->address, primary->slots});
    const auto slots = hz::find_slots_calling(image, addrs, send_sso,
                                             image.executable_segment_start(),
                                             image.executable_segment_end());
    std::printf("  found in slots:");
    for (uint32_t s2 : slots) std::printf(" %u", s2);
    std::printf("\n");
    check(!slots.empty(), "at least one slot reaches sendSsoInternal");
    // 36 is the main entry and 37 the no-response sibling; both must appear, and nothing
    // else, because that is what the call graph says.
    bool has36 = false, has37 = false;
    for (uint32_t s2 : slots) {
      if (s2 == 36) has36 = true;
      if (s2 == 37) has37 = true;
    }
    check(has36, "slot 36 is among them (the main send entry)");
    check(has37, "slot 37 is among them (the no-response sibling)");
    check(slots.size() == 2, hz::format("exactly two slots, got %zu", slots.size()));
  }

  // The recv side, located the same way.  msfDidRecvResponseData is TaskManager's slot 5 and
  // has zero static callers (T3b), so it can only be reached through the vtable -- which is
  // exactly why the payload has to hook it rather than wrap a function.
  {
    const uint64_t did_recv = 0x407b840ULL;
    std::printf("locating msfDidRecvResponseData (0x%llx)\n",
                static_cast<unsigned long long>(did_recv));
    const auto tm = hz::primary_vtable(image, all, "msf::internal::TaskManager");
    check(tm.has_value(), "found a primary TaskManager vtable");
    if (tm) {
      std::printf("  primary: 0x%llx slots=%u\n",
                  static_cast<unsigned long long>(tm->address), tm->slots);
      check(tm->address == 0x88b4aa0ULL, "the only TaskManager vtable is the right one");
      check(tm->slots == 6, hz::format("it has 6 slots (got %u)", tm->slots));
      // Which slot holds did_recv?  Slots 3 and 4 are the send-side callbacks, so 5 is the
      // recv one; assert the index rather than assume it.
      uint32_t found = 999;
      for (uint32_t i = 0; i < tm->slots; ++i) {
        uint64_t fn = 0;
        try {
          std::memcpy(&fn, image.at(tm->address - image.image_base() + i * 8, 8), 8);
        } catch (const hz::Error&) { break; }
        if (fn == did_recv) { found = i; break; }
      }
      std::printf("  msfDidRecvResponseData is slot %u\n", found);
      check(found == 5, "it is slot 5, as T3b recorded");
    }
  }

  // The login signal, and the finding that it is not where one would look first.
  //
  // selfInfoOnLoginSuccess has ZERO direct bl callers in the whole .text -- a scan of 8.8 MB
  // finds none -- so it cannot be hooked in its body or from a call site.  It appears only as a
  // vtable slot, and not of any MSF class: it is slot 11 of
  // nt::login::QRCodeLoginRequestImpl.  Looking for it among nt::MSFService /
  // nt::MSFCoreService / msf::MSFSessionImpl finds nothing, which is how this was discovered.
  {
    const uint64_t on_login = 0x1323a20ULL;
    std::printf("locating selfInfoOnLoginSuccess (0x%llx)\n",
                static_cast<unsigned long long>(on_login));
    const auto qr = hz::primary_vtable(image, all, "nt::login::QRCodeLoginRequestImpl");
    check(qr.has_value(), "found the login class's vtable");
    if (qr) {
      std::printf("  primary: 0x%llx slots=%u typeinfo 0x%llx\n",
                  static_cast<unsigned long long>(qr->address), qr->slots,
                  static_cast<unsigned long long>(qr->typeinfo));
      check(qr->address == 0x8714228ULL, "it is the 24-slot table at 0x8714228");
      check(qr->slots == 24, hz::format("24 slots (got %u)", qr->slots));
      uint32_t found = 999;
      for (uint32_t i = 0; i < qr->slots; ++i) {
        uint64_t fn = 0;
        try {
          std::memcpy(&fn, image.at(qr->address - image.image_base() + i * 8, 8), 8);
        } catch (const hz::Error&) { break; }
        if (fn == on_login) { found = i; break; }
      }
      std::printf("  selfInfoOnLoginSuccess is slot %u\n", found);
      check(found == 11, "it is slot 11");
    }
    // And confirm it is absent from the MSF classes, so a future reader does not repeat the
    // search that failed.
    for (const char* cls : {"nt::MSFService", "nt::MSFCoreService", "msf::MSFSessionImpl"}) {
      const auto pv = hz::primary_vtable(image, all, cls);
      if (!pv) continue;
      bool present = false;
      for (uint32_t i = 0; i < pv->slots; ++i) {
        uint64_t fn = 0;
        try {
          std::memcpy(&fn, image.at(pv->address - image.image_base() + i * 8, 8), 8);
        } catch (const hz::Error&) { break; }
        if (fn == on_login) present = true;
      }
      check(!present, hz::format("%s does not hold it", cls));
    }
  }

  std::printf(failures ? "FAIL (%d failures)\n" : "PASS\n", failures);
  return failures ? 1 : 0;
}
