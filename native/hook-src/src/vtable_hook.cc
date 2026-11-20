#include "vtable_hook.h"

#include <algorithm>
#include <cstdio>
#include <charconv>
#include <cstring>

#include "common.h"

#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

namespace hz {
namespace {

// A vtable's layout is fixed by the Itanium ABI:
//   [-2] offset-to-top      (ptrdiff_t, usually 0 or negative)
//   [-1] type_info pointer
//   [0]  first virtual function
// So slot 0 is preceded by exactly one pointer, and that pointer must land on a
// type_info whose first word is itself a vtable pointer.  Checking that the
// type_info's vptr looks like a vtable (rather than merely being non-zero) is
// what keeps random data from being read as a class.
constexpr uint32_t kTypeinfoVptrSlots = 3;  // __class_type_info's own vtable

// Page size for the mprotect calls.  Hardcoded rather than queried: the loader runs
// on exactly the two architectures QQ ships for, both of which use 4 KiB pages, and
// a sysconf() call would be one more thing to relocate.
constexpr uint64_t kPageSize = 4096;

// Demangles the subset of Itanium names a class hierarchy uses: N...E with
// length-prefixed components, and a leading digit for a nested name.  This is not
// a general demangler -- it exists so the class comparison is a string compare
// rather than a mangled-name compare, and it deliberately declines anything it
// does not understand instead of guessing.
std::string demangle_class(std::string_view mangled) {
  if (mangled.size() < 3 || mangled[0] != 'N') return {};
  // "St" is std::, which QQ's RTTI uses for its own std:: namespaces.
  std::vector<std::string> parts;
  size_t i = 1;
  while (i < mangled.size() && mangled[i] != 'E') {
    if (mangled.compare(i, 2, "St") == 0) {
      parts.emplace_back("std");
      i += 2;
      continue;
    }
    // A length prefix can be multi-digit (e.g. "10MSFService").
    size_t j = i;
    while (j < mangled.size() && mangled[j] >= '0' && mangled[j] <= '9') ++j;
    if (j == i) return {};  // an operator code or template -- decline
    // from_chars rather than stoul for the same GLIBC_2.38 reason as parse_maps_line below.
    std::size_t len = 0;
    if (std::from_chars(mangled.data() + i, mangled.data() + j, len, 10).ec != std::errc()) {
      break;
    }
    if (j + len > mangled.size()) return {};
    parts.emplace_back(mangled.substr(j, len));
    i = j + len;
  }
  if (parts.empty()) return {};
  std::string out;
  for (size_t k = 0; k < parts.size(); ++k) {
    if (k != 0) out += "::";
    out += parts[k];
  }
  return out;
}

// Upper bound on how far into a slot's function the call scan looks.  A slot's function
// is normally a few hundred bytes; the cap only stops a pathological case (a slot whose
// next sibling is megabytes away) from turning discovery into a full-text scan.
constexpr uint64_t kMaxFunctionScan = 0x2000;

// Decodes a direct call at `vaddr`, reporting its target.
//
// The decoder is chosen by the IMAGE's machine type, not by the host's: a hook developer
// routinely analyses an aarch64 wrapper.node on an x86-64 workstation, and picking the
// host's decoder there silently finds zero call sites -- which reads as "this slot does
// not send" and sends you looking for the wrong slot.  Only *direct* calls are considered;
// an indirect call cannot be attributed to a specific callee, and QQ's send path uses
// direct branches.
bool decode_call_to(const ElfImage& image, uint64_t vaddr, uint64_t* out) {
  if (image.is_aarch64()) {
    uint32_t ins = 0;
    try {
      std::memcpy(&ins, image.at(vaddr, sizeof(ins)), sizeof(ins));
    } catch (const Error&) {
      return false;
    }
    // bl: 100101 imm26, offset = sign_extend(imm26) * 4
    if ((ins & 0xFC000000u) != 0x94000000u) return false;
    int32_t imm26 = static_cast<int32_t>(ins & 0x03FFFFFFu);
    if (imm26 & 0x02000000) imm26 -= 0x04000000;
    *out = vaddr + static_cast<int64_t>(imm26) * 4;
    return true;
  }
  uint8_t buf[5];
  try {
    std::memcpy(buf, image.at(vaddr, sizeof(buf)), sizeof(buf));
  } catch (const Error&) {
    return false;
  }
  if (buf[0] != 0xE8) return false;
  int32_t rel = 0;
  std::memcpy(&rel, buf + 1, 4);
  // The displacement is relative to the end of the instruction.
  *out = vaddr + 5 + static_cast<int64_t>(rel);
  return true;
}

}  // namespace

// ---------------------------------------------------------------------------
// Caveat: this reads the FILE, not the target's memory.
// ---------------------------------------------------------------------------
// A module built with -z relro keeps its vtables in .data.rel.ro and describes
// them with relative relocations, so the words in the file are already the final
// link-time values (image-relative).  wrapper.node is built that way, and this scan
// works on it.
//
// A position-independent .so can instead leave .data.rel.ro zero-filled and
// describe every pointer with an R_*_RELATIVE entry applied at load time.  On such
// a file this scan finds nothing -- not because the vtables are missing, but
// because their contents only exist in the loaded process.  Callers that need to
// support both shapes must take the vtable addresses from the live process (see
// find_vtables_in_process in a future revision) rather than from the file.
//
// This is recorded here rather than worked around because guessing which shape a
// file is would be worse than saying so: the failure is silent otherwise.
std::vector<VtableInfo> list_vtables(const ElfImage& image) {
  std::vector<VtableInfo> out;
  // Only .data.rel.ro can hold vtables: it is the writable-then-relro section the
  // linker puts vtable and RTTI data in.  .rodata is read-only and holds the
  // type_info names, not the vtables themselves.
  const SectionInfo* drr = nullptr;
  for (const auto& sec : image.sections()) {
    if (sec.name == ".data.rel.ro") { drr = &sec; break; }
  }
  if (drr == nullptr || drr->size < 3 * sizeof(uint64_t)) return out;

  // The class name lives in .rodata, so a name pointer outside it is not a
  // type_info.  Requiring that is most of what makes the scan cheap: without it
  // every word pair in .data.rel.ro looks like a candidate.
  const SectionInfo* rodata = nullptr;
  for (const auto& sec : image.sections()) {
    if (sec.name == ".rodata") { rodata = &sec; break; }
  }
  if (rodata == nullptr) return out;
  const uint64_t rodata_addr = rodata->addr;
  const uint64_t rodata_size = rodata->size;

  const uint64_t base = image.image_base();
  const uint64_t text_lo = image.executable_segment_start();
  const uint64_t text_hi = image.executable_segment_end();

  // Helper: read a u64 from the file image at an image-relative address.  `at()`
  // bounds-checks and throws, so every read is guarded.
  auto read_u64 = [&](uint64_t vaddr, uint64_t* out_val) -> bool {
    try {
      std::memcpy(out_val, image.at(vaddr, sizeof(uint64_t)), sizeof(uint64_t));
      return true;
    } catch (const Error&) {
      return false;
    }
  };

  // A vtable is recognised by its [-1] entry: slot 0 is preceded by exactly one
  // pointer, and that pointer must land on a type_info whose own first word is a
  // vtable pointer.  Requiring the type_info's vptr to look like a text pointer --
  // rather than merely being non-zero -- is what keeps random data from being read
  // as a class.
  for (uint64_t off = drr->addr + 2 * sizeof(uint64_t);
       off + sizeof(uint64_t) <= drr->addr + drr->size; off += sizeof(uint64_t)) {
    uint64_t ti_addr = 0;
    if (!read_u64(off - sizeof(uint64_t), &ti_addr)) continue;
    if (ti_addr < base || ti_addr >= base + image.image_size()) continue;

    // A type_info is two words: [0] is its OWN vtable pointer, which lives in
    // .data.rel.ro alongside the vtables -- not in the text segment.  Requiring it
    // to look like a code address is the mistake that makes this scan find
    // nothing at all, because no type_info in a real module satisfies it.
    uint64_t ti_vptr = 0;
    if (!read_u64(ti_addr, &ti_vptr)) continue;
    if (ti_vptr < drr->addr || ti_vptr >= drr->addr + drr->size) continue;
    if ((ti_vptr % 8) != 0) continue;

    // [1] points at the mangled name in .rodata.
    uint64_t name_ptr = 0;
    if (!read_u64(ti_addr + 8, &name_ptr)) continue;
    if (name_ptr == 0 || name_ptr < rodata_addr || name_ptr >= rodata_addr + rodata_size) {
      continue;
    }

    std::string name;
    {
      char buf[512];
      size_t n = 0;
      try {
        const uint8_t* p = image.at(name_ptr, sizeof(buf) - 1);
        // Copy only up to the NUL; at() guarantees the span is readable, not that
        // the string terminates inside it.
        while (n < sizeof(buf) - 1 && p[n] != 0) ++n;
        std::memcpy(buf, p, n);
      } catch (const Error&) {
        continue;
      }
      buf[n] = '\0';
      if (n < 2) continue;
      // The string a type_info points at is the _ZTS content: the mangled name
      // itself, with NO length prefix.  (The length prefix belongs to the vtable
      // *symbol* name in .symtab, e.g. "_ZTVN2nt10MSFServiceE", which is a
      // different string in a different section.)  Stripping leading digits here
      // rejects every real name, because they all start with 'N'.
      name = demangle_class(std::string_view(buf, n));
    }
    if (name.empty()) continue;

    VtableInfo info;
    info.address = off;
    info.typeinfo = ti_addr - base;
    info.class_name = std::move(name);
    // Count slots until the run stops looking like function pointers.  The count
    // is approximate by construction -- the next vtable's header is what really
    // ends it -- so stop at the first non-text pointer.
    uint32_t slots = 0;
    for (; slots < 4096; ++slots) {
      const uint64_t at_addr = off + slots * sizeof(uint64_t);
      if (at_addr + sizeof(uint64_t) > drr->addr + drr->size) break;
      uint64_t fn = 0;
      if (!read_u64(at_addr, &fn)) break;
      if (fn < text_lo || fn >= text_hi) break;
    }
    // A vtable can legitimately hold a single slot: a class whose only virtual is
    // the destructor still has a vtable, and the reference implementation reports
    // several of them.  Requiring three slots dropped nt::MSFService's
    // one-slot vtable and with it any class that inherits without adding virtuals.
    if (slots < 1) continue;
    info.slots = slots;
    out.push_back(std::move(info));
  }

  std::sort(out.begin(), out.end(),
            [](const VtableInfo& a, const VtableInfo& b) { return a.address < b.address; });
  return out;
}

std::vector<VtableInfo> find_vtables_by_class(const std::vector<VtableInfo>& all,
                                              std::string_view class_name) {
  std::vector<VtableInfo> out;
  for (const auto& v : all) {
    if (v.class_name == class_name) out.push_back(v);
  }
  return out;
}


// Reads a slot from inside the target.
//
// The ptrace variant needs a RemoteProcess and therefore cannot be called by the payload,
// which is already in the address space and has no handle to itself.  The distinction
// matters at integration time: the mechanism that works perfectly in a test driver is
// unusable by the code the hook is meant to run in.
uint64_t read_vtable_slot_live(uint64_t vtable_addr, uint32_t slot) {
  const uint64_t at = vtable_addr + static_cast<uint64_t>(slot) * sizeof(uint64_t);
  uint64_t value = 0;
  std::memcpy(&value, reinterpret_cast<const void*>(at), sizeof(value));
  return value;
}


namespace {

// Reads "start-end perms" out of a /proc/self/maps line.
//
// from_chars rather than sscanf because a C23 glibc routes sscanf to __isoc23_sscanf, which
// pins the module to GLIBC_2.38; the QQ containers run Debian 12 at 2.36, and the addon then
// fails to load with a version error that looks like a build mistake rather than a
// toolchain-target mismatch.
bool parse_maps_line(const char* line, uint64_t& start, uint64_t& end, char (&perms)[5]) {
  const char* p = line;
  const char* dash = std::strchr(p, '-');
  if (dash == nullptr) return false;
  if (std::from_chars(p, dash, start, 16).ec != std::errc()) return false;

  p = dash + 1;
  const char* space = std::strchr(p, ' ');
  if (space == nullptr) return false;
  if (std::from_chars(p, space, end, 16).ec != std::errc()) return false;

  // Permissions are exactly four characters, then a space.
  p = space + 1;
  for (int i = 0; i < 4; ++i) {
    if (p[i] == '\0' || p[i] == ' ') return false;
    perms[i] = p[i];
  }
  perms[4] = '\0';
  return true;
}

}  // namespace

// Confirms that `at` is a slot we are allowed to write, before mprotecting anything.
//
// Three checks, each of which corresponds to a way this goes wrong in practice:
//
//   * 8-byte alignment.  A misaligned slot means the vtable base or the index was computed
//     wrong, and cmpxchg on a misaligned address faults on some architectures rather than
//     failing cleanly.
//   * the slot must end inside the mapping.  A vtable address near the end of a section plus
//     a large index lands in the next mapping or in nothing, and mprotect would then either
//     fail or succeed on a range we did not mean to touch.
//   * the mapping must be RELRO ("r--p").  A vtable that is not in a read-only page is
//     already writable, which means either it is not a vtable (we computed the address
//     wrong) or something else has already changed the page; both are reasons to stop rather
//     than to write.
//
// The closed-source payload does exactly these three checks, which is where they come from --
// see docs/reverse-hook-mechanism.md.
struct SlotCheck {
  bool ok = false;
  int prot = PROT_READ;
  const char* reason = "";
};

SlotCheck check_slot_address(uint64_t at) {
  SlotCheck out;
  if ((at & 7) != 0) {
    out.reason = "slot is not 8-byte aligned";
    return out;
  }

  const int fd = ::open("/proc/self/maps", O_RDONLY | O_CLOEXEC);
  if (fd < 0) {
    out.reason = "cannot read /proc/self/maps";
    return out;
  }

  char buf[8192];
  ssize_t n;
  bool found = false;
  while (!found && (n = ::read(fd, buf, sizeof(buf) - 1)) > 0) {
    buf[n] = '\0';
    for (char* line = buf; line != nullptr && *line != '\0';) {
      char* eol = std::strchr(line, '\n');
      uint64_t start = 0;
      uint64_t end = 0;
      char perms[5] = {0};
      // Parsed with from_chars rather than sscanf: a C23 glibc routes sscanf through
      // __isoc23_sscanf, which pins the addon to GLIBC_2.38 -- not available on the Debian 12
      // containers, where the module then fails to load with a version error.
      if (parse_maps_line(line, start, end, perms)) {
        if (at >= start && at + 8 <= end) {
          found = true;
          out.prot = 0;
          if (perms[0] == 'r') out.prot |= PROT_READ;
          if (perms[1] == 'w') out.prot |= PROT_WRITE;
          if (perms[2] == 'x') out.prot |= PROT_EXEC;
          // RELRO pages report "r--p": readable, not writable, not executable, private.
          out.ok = (perms[0] == 'r' && perms[1] == '-' && perms[3] == 'p');
          if (!out.ok) out.reason = "slot is not in a RELRO page";
          break;
        }
      }
      line = (eol == nullptr) ? nullptr : eol + 1;
    }
  }
  ::close(fd);
  if (!found) out.reason = "slot is outside every mapping";
  return out;
}

uint64_t hook_vtable_slot_in_process(uint64_t vtable_addr, uint32_t slot,
                                      uint64_t new_target) {
  const uint64_t at = vtable_addr + static_cast<uint64_t>(slot) * sizeof(uint64_t);
  const SlotCheck check = check_slot_address(at);
  if (!check.ok) throw Error(format("refusing to hook slot %u: %s", slot, check.reason));

  const uint64_t page = at & ~static_cast<uint64_t>(kPageSize - 1);
  const int original_prot = check.prot;
  const bool unprotected =
      (::mprotect(reinterpret_cast<void*>(page), kPageSize, original_prot | PROT_WRITE) == 0);

  // Compare-and-swap, not memcpy.
  //
  // A plain store would silently overwrite a hook installed by anything else between the
  // read and the write -- and the one moment that actually happens is a wrapper.node reload,
  // when two installers can race the same slot.  cmpxchg reports the race instead: it stores
  // only if the slot still holds what we read, and we can then put the page back and fail
  // loudly rather than clobbering a live trampoline.
  uint64_t previous = 0;
  std::memcpy(&previous, reinterpret_cast<const void*>(at), sizeof(previous));
  if (previous == new_target) {
    if (unprotected) ::mprotect(reinterpret_cast<void*>(page), kPageSize, original_prot);
    return previous;  // already hooked
  }

  __atomic_compare_exchange_n(reinterpret_cast<uint64_t*>(at), &previous, new_target, false,
                              __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE);

  if (unprotected) ::mprotect(reinterpret_cast<void*>(page), kPageSize, original_prot);
  // `previous` now holds whatever was there: the value we replaced on success, or the
  // interfering value on failure.  Callers compare it against what they expected.
  return previous;
}

void restore_vtable_slot_in_process(uint64_t vtable_addr, uint32_t slot, uint64_t original) {
  hook_vtable_slot_in_process(vtable_addr, slot, original);
}

HookedSlot hook_vtable_slot_relayed_in_process(uint64_t vtable_addr, uint32_t slot,
                                               SlotObserver observer) {
  HookedSlot out;
  out.vtable = vtable_addr;
  out.slot = slot;
  std::memcpy(&out.original, reinterpret_cast<const void*>(vtable_addr + slot * 8), 8);
  if (out.original == 0) {
    throw Error(format("vtable slot %u at 0x%llx is empty; nothing to forward to", slot,
                       static_cast<unsigned long long>(vtable_addr)));
  }
  out.relay = slot_relay_install(slot, out.original, observer);
  if (out.relay == 0) throw Error(format("cannot allocate a relay for slot %u", slot));
  const uint64_t previous = hook_vtable_slot_in_process(vtable_addr, slot, out.relay);
  if (previous != out.original) {
    hook_vtable_slot_in_process(vtable_addr, slot, previous);
    slot_relay_remove(out.relay);
    throw Error(format("vtable slot %u changed while hooking", slot));
  }
  return out;
}

void unhook_vtable_slot_relayed_in_process(const HookedSlot& hooked) {
  restore_vtable_slot_in_process(hooked.vtable, hooked.slot, hooked.original);
  slot_relay_remove(hooked.relay);
}

// Checks that `at` is inside an executable mapping we may patch.
//
// Separate from check_slot_address, which requires a RELRO page because a vtable lives in
// .data.rel.ro. A function entry lives in .text and is r-xp; applying the RELRO rule to it
// rejects every real function, which is what happened first: the export hook reported success
// while patching nothing, because the check was never wired to it.
SlotCheck check_code_address(uint64_t at) {
  SlotCheck out;
  if ((at & 3) != 0) {
    out.reason = "code address is not 4-byte aligned";
    return out;
  }
  const int fd = ::open("/proc/self/maps", O_RDONLY | O_CLOEXEC);
  if (fd < 0) {
    out.reason = "cannot read /proc/self/maps";
    return out;
  }
  char buf[8192];
  ssize_t n;
  bool found = false;
  while (!found && (n = ::read(fd, buf, sizeof(buf) - 1)) > 0) {
    buf[n] = '\0';
    for (char* line = buf; line != nullptr && *line != '\0';) {
      char* eol = std::strchr(line, '\n');
      uint64_t start = 0;
      uint64_t end = 0;
      char perms[5] = {0};
      if (parse_maps_line(line, start, end, perms)) {
        if (at >= start && at + 16 <= end) {
          found = true;
          out.prot = 0;
          if (perms[0] == 'r') out.prot |= PROT_READ;
          if (perms[1] == 'w') out.prot |= PROT_WRITE;
          if (perms[2] == 'x') out.prot |= PROT_EXEC;
          // Executable and private is what a patched .text page looks like.
          out.ok = (perms[2] == 'x' && perms[3] == 'p');
          if (!out.ok) out.reason = "code is not in an executable private mapping";
          break;
        }
      }
      line = (eol == nullptr) ? nullptr : eol + 1;
    }
  }
  ::close(fd);
  if (!found) out.reason = "code address is outside every mapping";
  return out;
}

// Declared weak so the core library does not depend on the payload's logger.
extern "C" void hz_note_prologue(uint64_t target, uint32_t w0, uint32_t w1, uint32_t w2,
                                uint32_t w3) __attribute__((weak));
extern "C" void hz_note_refusal(uint64_t target, int reason, uint32_t ins)
    __attribute__((weak));

HookedFunction hook_function_relayed_in_process(uint64_t target, SlotObserver observer,
                                                uint32_t id) {
  if (target == 0) throw Error("cannot hook a null function");
  if (observer == nullptr) throw Error("observer is null");
  if ((target & 3) != 0) throw Error("function entry is not 4-byte aligned");

#if !defined(__aarch64__)
  // Entry patching is AArch64-only, and refusing is the honest behaviour.
  //
  // Everything below -- the patch encoding, the fixed 16-byte width, the replay stub, and even
  // the prologue scan that decides whether displaced instructions can be relocated -- is written
  // against AArch64's fixed 4-byte instruction length. x86 has none of that: instructions are
  // variable length, so a fixed 16-byte overwrite lands mid-instruction as a rule rather than by
  // bad luck, and the prologue scan below would read arbitrary x86 bytes and compare them against
  // AArch64 masks (adrp, ldr-literal), rejecting valid functions and accepting dangerous ones.
  //
  // This is not a missing branch. The reference implementation on x86_64 patches nothing but
  // vtable slots -- verified: its only writes are `lock cmpxchg` to slot addresses, with no
  // function-entry patching anywhere in the binary. So vtable hooking is the whole mechanism that
  // was ever required, and it works on both architectures.
  //
  // Making this work on x86_64 would mean a length disassembler plus a different patch shape
  // (`jmp [rip+0]` with a 14-byte form), and the reference implementation demonstrates it is not
  // needed for parity.
  throw Error("function-entry hooking is AArch64-only; on x86_64 only vtable slots can be hooked");
#endif

  HookedFunction out;
  out.target = target;

  // The patch: two instruction words followed by the relay address.
  //
  //   ldr x16, #8    ; x16 = *(pc + 8), i.e. the literal below
  //   br  x16        ; jump to the relay
  //   .quad relay
  //
  // Sixteen bytes covers four aarch64 instructions. That is the smallest patch that can branch
  // anywhere in the 64-bit address space: b/ bl reach +/-128 MB, and wrapper.node is 144 MB, so
  // an offset branch can miss. x16 is IP0, the scratch register the AArch64 ABI reserves for
  // exactly this linker use -- it may be clobbered by a veneer, so a function cannot rely on it
  // arriving with a value.
  constexpr uint32_t kLdrX16 = 0x58000050u;  // ldr x16, [pc, #8]
  constexpr uint32_t kBrX16 = 0xD61F0200u;   // br x16
  constexpr uint32_t kPatchLen = 16;

  uint8_t original[kPatchLen];
  std::memcpy(original, reinterpret_cast<const void*>(target), kPatchLen);

  // Record the four prologue words before deciding anything, so a crash during the sweep names
  // the exact bytes being patched rather than leaving the last log line at "about to try".
  {
    uint32_t w0 = 0, w1 = 0, w2 = 0, w3 = 0;
    std::memcpy(&w0, original + 0, 4);
    std::memcpy(&w1, original + 4, 4);
    std::memcpy(&w2, original + 8, 4);
    std::memcpy(&w3, original + 12, 4);
    if (hz_note_prologue != nullptr) hz_note_prologue(target, w0, w1, w2, w3);
  }
  out.saved_len = kPatchLen;
  std::memcpy(out.saved, original, kPatchLen);

  // Refuse if the prologue contains a PC-relative instruction that would break when moved:
  // adrp/adr/add-immediate-from-pc, or a literal load. Replaying them at a different address
  // computes a different target, and the symptom would be a crash inside QQ far from here.
  for (uint32_t i = 0; i < kPatchLen; i += 4) {
    uint32_t ins = 0;
    std::memcpy(&ins, original + i, 4);
    // adrp / adr
    if ((ins & 0x1F000000u) == 0x10000000u || (ins & 0x9F000000u) == 0x90000000u) {
      // Refuse without throwing across the C boundary.
      //
      // This used to `throw Error(format(...))`, and the throw itself crashed the host: the
      // payload is linked with --unresolved-symbols=ignore-all and does not carry libstdc++'s
      // exception machinery as its own, so constructing and raising a std::runtime_error from a
      // manually-loaded module reached through a NULL a GCC-generated reference. The refusal path
      // was therefore more dangerous than the thing it was refusing.
      //
      // An error code is dumber and cannot fail. The message is reported through the payload's
      // logger instead of an exception object.
      hz_note_refusal(target, 1, ins);
      out.relay = 0;
      out.saved_len = 0;
      return out;
    }
    // ldr/ldrsw literal
    if ((ins & 0x3B000000u) == 0x18000000u) {
      hz_note_refusal(target, 2, ins);
      out.relay = 0;
      out.saved_len = 0;
      return out;
    }
    // b/bl/b.cond/cbz/tbz inside the patch window: the branch would be relocated.
    if ((ins & 0x7C000000u) == 0x14000000u || (ins & 0xFF000010u) == 0x54000000u) {
      hz_note_refusal(target, 3, ins);
      out.relay = 0;
      out.saved_len = 0;
      return out;
    }
  }

  // `id` rides through to the observer as its `slot` argument. For a vtable hook that number is
  // the real slot index; for a function hook there is no slot, so the caller's hook index goes
  // there instead and the observer looks the identity up. That is what lets one observer serve
  // hundreds of hooks and still name which one was entered.
  out.relay = slot_relay_install_function(target, out.saved, out.saved_len, observer, id);
  if (out.relay == 0) throw Error("cannot allocate a function relay");

  const uint64_t page = target & ~static_cast<uint64_t>(kPageSize - 1);
  const SlotCheck check = check_code_address(target);
  if (!check.ok) {
    slot_relay_remove(out.relay);
    throw Error(format("refusing to patch function at 0x%llx: %s",
                       static_cast<unsigned long long>(target), check.reason));
  }
  if (::mprotect(reinterpret_cast<void*>(page), kPageSize, check.prot | PROT_WRITE) != 0) {
    slot_relay_remove(out.relay);
    throw Error(format("mprotect failed at 0x%llx: %s",
                       static_cast<unsigned long long>(page), std::strerror(errno)));
  }

  uint8_t patch[kPatchLen];
  std::memcpy(patch + 0, &kLdrX16, 4);
  std::memcpy(patch + 4, &kBrX16, 4);
  std::memcpy(patch + 8, &out.relay, 8);
  std::memcpy(reinterpret_cast<void*>(target), patch, kPatchLen);
  __builtin___clear_cache(reinterpret_cast<char*>(target),
                          reinterpret_cast<char*>(target + kPatchLen));

  if (::mprotect(reinterpret_cast<void*>(page), kPageSize, check.prot) != 0) {
    std::memcpy(reinterpret_cast<void*>(target), original, kPatchLen);
    __builtin___clear_cache(reinterpret_cast<char*>(target),
                            reinterpret_cast<char*>(target + kPatchLen));
    slot_relay_remove(out.relay);
    throw Error("mprotect restore failed; the patch could not be undone cleanly");
  }
  return out;
}

void unhook_function_in_process(const HookedFunction& hooked) {
  if (hooked.target == 0 || hooked.saved_len == 0) return;
  const uint64_t page = hooked.target & ~static_cast<uint64_t>(kPageSize - 1);
  const SlotCheck check = check_code_address(hooked.target);
  if (!check.ok) throw Error(format("cannot unhook: %s", check.reason));
  if (::mprotect(reinterpret_cast<void*>(page), kPageSize, check.prot | PROT_WRITE) != 0) {
    throw Error("mprotect failed while unhooking");
  }
  std::memcpy(reinterpret_cast<void*>(hooked.target), hooked.saved, hooked.saved_len);
  __builtin___clear_cache(reinterpret_cast<char*>(hooked.target),
                          reinterpret_cast<char*>(hooked.target + hooked.saved_len));
  ::mprotect(reinterpret_cast<void*>(page), kPageSize, check.prot);
  slot_relay_remove(hooked.relay);
}

std::optional<VtableInfo> primary_vtable(const ElfImage& image,
                                         const std::vector<VtableInfo>& all,
                                         std::string_view class_name) {
  const auto candidates = find_vtables_by_class(all, class_name);
  if (candidates.empty()) return std::nullopt;

  std::optional<VtableInfo> best;
  size_t best_real = 0;
  for (const auto& v : candidates) {
    size_t real = 0;
    for (uint32_t i = 0; i < v.slots; ++i) {
      uint64_t fn = 0;
      try {
        std::memcpy(&fn, image.at(v.address - image.image_base() + i * sizeof(uint64_t),
                                  sizeof(uint64_t)),
                    sizeof(uint64_t));
      } catch (const Error&) {
        break;
      }
      if (fn == 0) continue;

      // A filler slot is a single return instruction.  Judging by that rather than by slot
      // count is what keeps a 61-slot table of 57 ret stubs from winning over the 44-slot
      // table that holds the class's real methods.
      uint8_t buf[4] = {0, 0, 0, 0};
      try {
        std::memcpy(buf, image.at(fn - image.image_base(), sizeof(buf)), sizeof(buf));
      } catch (const Error&) {
        continue;
      }
      const bool is_stub =
          image.is_aarch64()
              ? (buf[0] == 0xC0 && buf[1] == 0x03 && buf[2] == 0x5F && buf[3] == 0xD6)
              : (buf[0] == 0xC3);
      if (!is_stub) ++real;
    }
    if (real > best_real) {
      best_real = real;
      best = v;
    }
  }
  return best;
}

std::vector<uint32_t> find_slots_calling(const ElfImage& image,
                                         const std::vector<VtableRef>& vtables,
                                         uint64_t callee, uint64_t text_lo, uint64_t text_hi) {
  std::vector<uint32_t> out;
  for (const VtableRef& ref : vtables) {
    // Collect this table's slot targets once: both the scan and the function bounds need
    // them, and reading them per slot would be quadratic.
    std::vector<uint64_t> targets;
    targets.reserve(ref.slots);
    for (uint32_t slot = 0; slot < ref.slots; ++slot) {
      uint64_t fn = 0;
      try {
        std::memcpy(&fn,
                    image.at(ref.address - image.image_base() + slot * sizeof(uint64_t),
                             sizeof(uint64_t)),
                    sizeof(uint64_t));
      } catch (const Error&) {
        break;
      }
      targets.push_back(fn);
    }

    const uint64_t step = image.is_aarch64() ? 4 : 1;
    for (uint32_t slot = 0; slot < targets.size(); ++slot) {
      const uint64_t fn = targets[slot];
      if (fn == 0) continue;                        // an empty slot is not the end
      if (fn < text_lo || fn >= text_hi) continue;  // a data word, not a function

      // Bound the scan by the next higher slot target from the SAME table, so one slot's
      // function is not read through its neighbour's code.  Without that bound every slot
      // appears to call whatever the function after it calls, and "which slot sends"
      // becomes unanswerable.
      uint64_t hi = fn + kMaxFunctionScan;
      for (uint64_t probe : targets) {
        if (probe > fn && probe < hi) hi = probe;
      }

      for (uint64_t at = fn; at + 4 <= hi; at += step) {
        uint64_t target = 0;
        if (!decode_call_to(image, at, &target)) continue;
        if (target != callee) continue;
        out.push_back(slot);
        break;  // one call is enough to identify the slot
      }
    }
  }
  return out;
}

}  // namespace hz
