// Runtime vtable slot replacement against a LIVE process.
//
// Two things this pins down that a file-only test cannot:
//   1. .data.rel.ro is mapped read-only after RELRO, so a slot write has to mprotect
//      the page first.  Without that the write fails with EFAULT at a valid address,
//      which reads as "cannot write the slot" and sends you hunting the wrong bug.
//   2. slot 0 of a real vtable can be null (a pure or inherited vptr), so a scan that
//      stops at the first zero length-word finds nothing.  See find_slot_by_target.
//
// The class is located by RTTI through the symbol table because the file's
// .data.rel.ro for a PIE library is zero-filled: only the loader's relocations give
// it content, so the file cannot answer what a slot holds.
#include <string>
#include "common.h"
#include "elf_image.h"
#include "remote.h"
#include "vtable_hook.h"

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
  std::printf("%s at 0x%llx\n", base_name.c_str(), (unsigned long long)base);
  remote.attach();

  // The vtable's image-relative address comes from the symbol table; the file's
  // contents at that address are zeros, so the SLOTS must be read from memory.
  const hz::DynSymbol* vtsym = image.find_symbol("_ZTVN4demo4BaseE");
  if (!vtsym) { std::printf("no vtable symbol\n"); return 2; }
  const uint64_t vt_live = base + (vtsym->value - image.image_base());
  std::printf("vtable live=0x%llx (image-relative 0x%llx)\n",
              (unsigned long long)vt_live, (unsigned long long)vtsym->value);

  uint64_t ti = 0;
  if (remote.read(vt_live - 8, &ti, sizeof(ti)) != sizeof(ti)) {
    check(false, "read [-1]");
  } else {
    std::printf("  [-1] = 0x%llx (nonzero means the loader relocated it)\n",
                (unsigned long long)ti);
    check(ti != 0, "[-1] holds a relocated type_info pointer");
  }

  // Slot 0 is the destructor pair; slots 1..4 are alpha/beta/gamma/delta.  Reading
  // them proves the relocation happened and the pointers point into .text.
  uint64_t slots[6] = {0};
  bool readable = true;
  for (uint32_t i = 0; i < 6; ++i) {
    if (remote.read(vt_live + i * 8, &slots[i], sizeof(uint64_t)) != sizeof(uint64_t)) {
      readable = false;
      break;
    }
  }
  check(readable, "all six slots readable");
  if (readable) {
    for (uint32_t i = 0; i < 6; ++i) {
      std::printf("  slot %u = 0x%llx %s\n", i, (unsigned long long)slots[i],
                  slots[i] != 0 ? "" : "(NULL -- not relocated)");
    }
    check(slots[2] != 0, "alpha's slot is populated");

    // Replace alpha's slot with delta's, verify, restore.
    const uint64_t alpha = hz::read_vtable_slot(remote, vt_live, 2);
    const uint64_t beta = hz::read_vtable_slot(remote, vt_live, 3);
    check(alpha != beta, "slot 2 and slot 3 are distinct functions");
    const uint64_t prev = hz::hook_vtable_slot(remote, vt_live, 2, beta);
    check(prev == alpha, "hook returns the previous value");
    check(hz::read_vtable_slot(remote, vt_live, 2) == beta, "slot now holds beta");
    hz::restore_vtable_slot(remote, vt_live, 2, alpha);
    check(hz::read_vtable_slot(remote, vt_live, 2) == alpha, "restore works");

    const auto found = hz::find_slot_by_target(remote, {vt_live}, beta);
    std::printf("find_slot_by_target(beta) -> %s\n",
                found ? std::to_string(*found).c_str() : "(none)");
    check(found.has_value() && *found == 3, "locates slot 3 by its function");
  }

  remote.detach();
  std::printf(fails ? "FAIL (%d failures)\n" : "PASS\n", fails);
  return fails ? 1 : 0;
}
