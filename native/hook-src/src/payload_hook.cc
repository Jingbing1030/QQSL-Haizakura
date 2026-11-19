// The payload's hook installation, with a C interface.
//
// ---------------------------------------------------------------------------
// Why this file exists as a separate translation unit
// ---------------------------------------------------------------------------
// The engine (vtable_hook.cc, elf_image.cc, slot_relay.cc) is C++ with STL: it uses
// std::vector, std::string and std::optional because the work it does -- parsing an ELF,
// demangling type names, scanning a call graph -- is bookkeeping over variable-size data,
// and doing that in C would be a large amount of hand-rolled allocator code with worse
// failure modes.
//
// The payload (payload.cc) is deliberately plain C: it is manually mapped, the loader
// implements no TLS relocations, and it must not carry state that needs a runtime to
// tear down.  Rewriting the engine in C to match would throw away the parts that are
// actually verified.
//
// So the two live in different translation units and meet here.  This file is the only
// place that touches the engine, and it exposes nothing but C: no std:: types cross the
// boundary, no exceptions escape (every engine call that can throw is wrapped), and the
// returned state is a plain array of addresses the payload can hold.
//
// ---------------------------------------------------------------------------
// What the payload asks for, and what it must not ask for
// ---------------------------------------------------------------------------
// The payload wants to know when the user logs in.  That signal is a vtable slot on a
// class, so installation needs three things resolved at runtime:
//
//   * which module is QQ's (wrapper.node) and where the kernel mapped it;
//   * which vtable of the class is the one with code in it;
//   * which slot on it is the login callback.
//
// All three are address-dependent and every QQ release moves them, so none of them is
// stored here.  The payload reports failure and carries on without the hook rather than
// installing on a guess: a hook on the wrong function is worse than no hook, because it
// corrupts a call that was previously working.
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include <fcntl.h>
#include <unistd.h>

#include "common.h"
#include "elf_image.h"
#include "slot_relay.h"
#include "vtable_hook.h"
#include "payload_hook.h"

#include <string_view>

namespace {

// One installed hook, in a form the payload can hold: plain integers, no STL.
//
// Kept as a fixed array rather than a vector so the payload side never has to free
// anything: it asks for a slot and gets an index back.
struct InstalledHook {
  bool used = false;
  std::uint64_t vtable = 0;      // live address
  std::uint32_t slot = 0;
  std::uint64_t original = 0;
  std::uint64_t relay = 0;
  char class_name[80] = {0};
};

// 64 rather than 8: the sweep that locates the live login slot needs to hook several slots
// across many classes at once and let the entry counter say which one is reached. Eight was
// enough for a single known slot and made the sweep impossible.
constexpr std::size_t kMaxHooks = 256;
InstalledHook g_hooks[kMaxHooks];

// The observer a sweep installs. It does nothing on purpose: the sweep's whole output is the
// entry counter, and a callback that also tried to report would make a hit ambiguous between
// "the slot is live" and "the reporting path works". Declared here because the sweep function
// references it before the C interface below defines the real observer.
extern "C" void hz_sweep_observer(std::uint32_t, std::uint64_t);
extern "C" void hz_probe_observer(std::uint32_t, std::uint64_t);
void g_sweep_observer(std::uint32_t slot, std::uint64_t original) {
  hz_sweep_observer(slot, original);
}
// 4 MB: a maps file larger than this is not a real process map.
constexpr std::size_t kMapsBufferSize = 4u << 20;

constexpr std::size_t kErrorMessageCapacity = 512;

// Recorded so a reload can find the module it hooked before.
std::uint64_t g_module_base = 0;

// A fixed buffer rather than a std::string assignment.
//
// g_last_error = text looked harmless and pulled in std::string::_M_replace_cold, which is
// GLIBCXX_3.4.31 -- a version the QQ process does not have, so the whole payload failed to
// inject with an unresolved-symbol error that named neither this function nor the reason.
// Copying into a char array references no libstdc++ symbol at all.
char g_last_error[kErrorMessageCapacity] = {0};

// Diagnostics go to a file, not to stdout.
//
// The payload runs inside QQ, so its fd 1 is QQ's stdout -- a client log or /dev/null, never
// the injector's terminal. printf therefore succeeds and leaves no trace anywhere the injector
// can read, which makes a working hook look identical to one that never installed. Everything
// that matters is appended to /tmp/hz-payload.log instead.
void note(const char* format, ...) __attribute__((format(printf, 1, 2)));

void note(const char* format, ...) {
  const int fd = ::open("/tmp/hz-payload.log", O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
  if (fd < 0) return;
  char buf[512];
  va_list args;
  va_start(args, format);
  const int n = std::vsnprintf(buf, sizeof(buf), format, args);
  va_end(args);
  if (n > 0) {
    const std::size_t len = (static_cast<std::size_t>(n) < sizeof(buf))
                                ? static_cast<std::size_t>(n)
                                : sizeof(buf) - 1;
    const ssize_t ignored = ::write(fd, buf, len);
    (void)ignored;
  }
  ::close(fd);
}

void set_error(const char* text) {
  const char* src = (text == nullptr) ? "" : text;
  std::size_t n = 0;
  while (src[n] != '\0' && n + 1 < sizeof(g_last_error)) ++n;
  for (std::size_t i = 0; i < n; ++i) g_last_error[i] = src[i];
  g_last_error[n] = '\0';
  if (n > 0) {
    std::printf("[payload] hook: %s\n", g_last_error);
    std::fflush(stdout);
  }
}

// The class whose slot carries the login signal.
//
// selfInfoOnLoginSuccess is slot 11 of this vtable and has no direct callers anywhere in
// wrapper.node -- it is only ever reached through the vtable, which is why locating it by
// the call graph fails and locating it by class + slot succeeds.  The name is the stable
// handle: a relink moves the address and can renumber slots, but the mangled type name in
// .rodata survives, because it is what RTTI and the exception tables refer to.
constexpr const char* kLoginClass = "nt::login::QRCodeLoginRequestImpl";
constexpr std::uint32_t kLoginSlot = 11;

// The slot that sees every outbound SSO request, and therefore every login.
//
// Hooking only the QR class above was a mistake, and a live client proved it: that slot is
// reached only from the QR-code login flow, while QQ signing in with a saved account never
// goes near it. The hook installed, the relay was resident, the neighbouring slots were
// untouched -- and the observer never fired, because the function simply was not called.
// docs/observer-not-firing.md has the measurements.
//
// nt::MSFService slot 36 is where the reference payload hooks (docs/reverse-hook-mechanism.md),
// and the siting is the point: MSFService is the message service, so logins, outgoing messages
// and responses all pass through it. Hooking a trunk catches every branch; hooking the end of
// one branch catches that branch.
constexpr const char* kTrunkClass = "nt::MSFService";
constexpr std::uint32_t kTrunkSlot = 36;

// Finds wrapper.node's mapped base by walking /proc/self/maps.
//
// Reads our own maps rather than asking a parent: the payload is already inside the
// target, and the target is the only process whose mapping matters.  An earlier version
// looked for the file by name in the working directory, which finds the file on disk and
// not the mapping the running code uses -- two different addresses when QQ has been
// updated or when a second copy exists.
std::uint64_t find_wrapper_base(std::string* out_path) {
  // read(), not MappedFile.
  //
  // MappedFile mmaps the file, and a procfs file has st_size == 0: mmap(len=0) fails, the
  // failure is an exception, and an exception escaping a hook-installation function calls
  // std::terminate.  The symptom was a SIGABRT with a stack that pointed at glibc and no
  // payload frame at all, which reads like "C++ does not work here" rather than "this file
  // cannot be mmapped".
  const int fd = ::open("/proc/self/maps", O_RDONLY | O_CLOEXEC);
  if (fd < 0) return 0;

  // Read the whole file, then scan it in place.
  //
  // The buffer is a local array rather than a std::string, and the scan uses string_view
  // rather than substring copies. That is partly speed -- this runs over thousands of lines
  // per hook install -- but mainly it keeps the module free of std::string's cold grow path.
  //
  // std::string::_M_replace_cold is GLIBCXX_3.4.31. The payload does not link libstdc++ (it
  // has to use the target's), QQ ships 6.0.30, and so the symbol does not exist: injection
  // fails with "failed to resolve remote symbol ..._M_replace_cold..." reported by the
  // injector, with nothing pointing at the string append that caused it. Keeping the parsing
  // allocation-free means the engine references no libstdc++ symbol newer than C++11.
  static char buffer[kMapsBufferSize];
  std::size_t size = 0;
  for (;;) {
    if (size >= sizeof(buffer) - 1) break;
    const ssize_t n = ::read(fd, buffer + size, sizeof(buffer) - 1 - size);
    if (n < 0) {
      if (errno == EINTR) continue;
      ::close(fd);
      return 0;
    }
    if (n == 0) break;
    size += static_cast<std::size_t>(n);
  }
  ::close(fd);
  buffer[size] = '\0';

  const char* data = buffer;
  std::size_t pos = 0;
  while (pos < size) {
    std::size_t end = pos;
    while (end < size && data[end] != '\n') ++end;
    const std::string_view line(data + pos, end - pos);
    pos = end + 1;

    // "start-end perms offset dev inode path"
    const std::size_t slash = line.find('/');
    if (slash == std::string_view::npos) continue;
    if (line.find("wrapper.node") == std::string_view::npos) continue;
    const std::size_t dash = line.find('-');
    if (dash == std::string_view::npos) continue;

    std::uint64_t base = 0;
    for (std::size_t i = 0; i < dash; ++i) {
      const char c = line[i];
      base <<= 4;
      if (c >= '0' && c <= '9') base |= static_cast<std::uint64_t>(c - '0');
      else if (c >= 'a' && c <= 'f') base |= static_cast<std::uint64_t>(c - 'a' + 10);
      else if (c >= 'A' && c <= 'F') base |= static_cast<std::uint64_t>(c - 'A' + 10);
      else return 0;
    }
    if (out_path != nullptr) *out_path = std::string(line.substr(slash));
    return base;
  }
  return 0;
}

}  // namespace

// ---------------------------------------------------------------------------
// C interface used by payload.cc
// ---------------------------------------------------------------------------

// Installs the login observer.  Returns 0 on success, negative on failure, and the
// reason is available from hz_hook_last_error().
//
// Failure is not fatal and the caller is expected to continue: a payload that refuses to
// serve the wire protocol because one hook did not resolve would be strictly worse than
// one that serves it without the login signal.
extern "C" int hz_hook_install_login_observer(hz_hook_observer observer) {
  if (observer == nullptr) {
    set_error("login observer is null");
    return -1;
  }
  std::string path;
  const std::uint64_t base = find_wrapper_base(&path);
  if (base == 0) {
    set_error("wrapper.node is not mapped in this process");
    return -2;
  }
  g_module_base = base;

  std::printf("[payload] hook: wrapper.node at 0x%llx (%s)\n",
              static_cast<unsigned long long>(base), path.c_str());
  std::fflush(stdout);

  // Parse the mapped file, not the file on disk: the section table of the mapped copy is
  // what the running code's addresses refer to, and a QQ update between map and read would
  // make the two disagree in exactly the way that produces a plausible wrong address.
  hz::ElfImage image(hz::MappedFile::open(path));
  if (!image.is_x86_64() && !image.is_aarch64()) {
    set_error("wrapper.node is not a supported ELF machine");
    return -3;
  }

  const std::vector<hz::VtableInfo> all = hz::list_vtables(image);
  if (all.empty()) {
    set_error("no vtables found in wrapper.node");
    return -4;
  }
  std::printf("[payload] hook: %zu vtables in wrapper.node\n", all.size());
  std::fflush(stdout);

  // Install the trunk hook first, and let it decide success.
  //
  // Order is a priority, not a preference: the trunk is the one that actually observes a
  // login with a saved account. If it cannot be installed there is no login signal worth
  // having, so it reports failure. The QR hook is then added as a bonus and its failure is
  // only logged -- it catches the QR flow, which the trunk may or may not summarise.
  const hz::SlotObserver relay_observer = reinterpret_cast<hz::SlotObserver>(observer);
  int trunk_rc = 0;
  {
    const std::optional<hz::VtableInfo> trunk = hz::primary_vtable(image, all, kTrunkClass);
    if (!trunk.has_value()) {
      note("trunk: %s not found by RTTI name (%zu vtables scanned)\n", kTrunkClass, all.size());
      set_error("MSFService not found by RTTI name");
      return -10;
    }
    note("trunk: %s primary vtable off=0x%llx slots=%u\n", kTrunkClass,
         static_cast<unsigned long long>(trunk->address), trunk->slots);
    if (trunk->slots <= kTrunkSlot) {
      note("trunk: vtable has %u slots, send slot %u does not fit\n", trunk->slots, kTrunkSlot);
      set_error("MSFService vtable is too short for the send slot");
      return -11;
    }
    const std::uint64_t vt_live = base + trunk->address;
    const std::uint64_t trunk_cur = hz::read_vtable_slot_live(vt_live, kTrunkSlot);
    if (trunk_cur == 0) {
      note("trunk: slot %u is empty at 0x%llx\n", kTrunkSlot,
           static_cast<unsigned long long>(vt_live));
      set_error("MSFService send slot is empty");
      return -12;
    }
    note("trunk: slot %u currently 0x%llx (offset 0x%llx)\n", kTrunkSlot,
         static_cast<unsigned long long>(trunk_cur),
         static_cast<unsigned long long>(trunk_cur - base));
    bool placed = false;
    for (std::size_t i = 0; i < kMaxHooks; ++i) {
      if (g_hooks[i].used) continue;
      // The helper throws rather than returning a null relay, so the failure has to be caught
      // to be reported. Without this the throw unwound past the logging and the only symptom
      // was an install that left no trace at all.
      hz::HookedSlot hooked;
      try {
        hooked = hz::hook_vtable_slot_relayed_in_process(vt_live, kTrunkSlot, relay_observer);
      } catch (const std::exception& e) {
        note("trunk: relay failed for slot %u: %s\n", kTrunkSlot, e.what());
        break;
      } catch (...) {
        note("trunk: relay failed for slot %u: unknown error\n", kTrunkSlot);
        break;
      }
      g_hooks[i].used = true;
      g_hooks[i].vtable = hooked.vtable;
      g_hooks[i].slot = hooked.slot;
      g_hooks[i].original = hooked.original;
      g_hooks[i].relay = hooked.relay;
      note("trunk hook on %s slot %u vtable=0x%llx original=0x%llx\n", kTrunkClass, hooked.slot,
           static_cast<unsigned long long>(hooked.vtable),
           static_cast<unsigned long long>(hooked.original));
      placed = true;
      break;
    }
    if (!placed) {
      note("trunk: no relay placed, all %d hook slots used\n", static_cast<int>(kMaxHooks));
      set_error("trunk relay installation failed");
      return -13;
    }
    trunk_rc = 0;
  }
  (void)trunk_rc;

  // Then the QR slot, as a secondary signal.  Failure here is reported and survived: a QQ
  // build whose QR class moved should cost the QR signal, not the whole hook.
  {
    const std::optional<hz::VtableInfo> target = hz::primary_vtable(image, all, kLoginClass);
    if (target.has_value() && target->slots > kLoginSlot) {
      const std::uint64_t vt_live = base + target->address;
      if (hz::read_vtable_slot_live(vt_live, kLoginSlot) != 0) {
        for (std::size_t i = 0; i < kMaxHooks; ++i) {
          if (g_hooks[i].used) continue;
          const hz::HookedSlot hooked =
              hz::hook_vtable_slot_relayed_in_process(vt_live, kLoginSlot, relay_observer);
          if (hooked.relay == 0) break;
          g_hooks[i].used = true;
          g_hooks[i].vtable = hooked.vtable;
          g_hooks[i].slot = hooked.slot;
          g_hooks[i].original = hooked.original;
          g_hooks[i].relay = hooked.relay;
          note("qr hook on %s slot %u vtable=0x%llx\n", kLoginClass, hooked.slot,
               static_cast<unsigned long long>(hooked.vtable));
          break;
        }
      }
    } else {
      note("%s unavailable, QR signal disabled\n", kLoginClass);
    }
  }
  return 0;
}

// Hooks every exported function, so that a login can be observed without deciding in advance
// which entry point it uses.
//
// Five named candidates were each verified installed and each recorded zero entries through a
// real sign-in (the QR vtable slot, the MSFService send slot, a 62-slot sweep of nt::login, and
// the notifyLoginSuccess export). That pattern does not indicate a broken relay -- the same
// relay reports hits correctly -- it indicates that the guess about the path is wrong. Rather
// than guess again, cover the whole export surface and let the counters name the entry point.
//
// The observer receives this hook's index in its `slot` argument and writes the name on first
// entry, so the result is a short list of what QQ actually calls, not a wall of counts.
//
// Functions smaller than the patch are skipped: patching 16 bytes over an 8-byte getter
// overwrites whatever follows it in .text, and QQ then dies in unrelated code. That failure is
// recorded in the docs and is the reason this filter is not optional.
extern "C" int hz_hook_all_exports(std::size_t max_hooks) {
  std::string path;
  const std::uint64_t base = find_wrapper_base(&path);
  if (base == 0) {
    set_error("wrapper.node is not mapped in this process");
    return -2;
  }
  g_module_base = base;
  hz::ElfImage image(hz::MappedFile::open(path));
  const std::vector<hz::DynSymbol>& syms = image.symbols();

  int installed = 0;
  int skipped_short = 0;
  int refused = 0;
  for (const hz::DynSymbol& sym : syms) {
    if (static_cast<std::size_t>(installed) >= max_hooks) break;
    if (!sym.defined || sym.value == 0) continue;
    if (sym.size != 0 && sym.size < 16) { ++skipped_short; continue; }

    std::size_t index = kMaxHooks;
    for (std::size_t i = 0; i < kMaxHooks; ++i) {
      if (!g_hooks[i].used) { index = i; break; }
    }
    if (index == kMaxHooks) break;

    const std::uint64_t target = base + (sym.value - image.image_base());

    // One patch per address. Wrapper symbols (a weak alias, a thunk, a versioned name) can share
    // an entry, and patching the same address twice would have the second install see our own
    // jump as the "original" prologue -- saving those bytes and replaying them, which is an
    // infinite loop of the kind that already took the client down once.
    bool already = false;
    for (std::size_t i = 0; i < kMaxHooks; ++i) {
      if (g_hooks[i].used && g_hooks[i].original == target) { already = true; break; }
    }
    if (already) continue;

    try {
      const hz::HookedFunction hooked = hz::hook_function_relayed_in_process(
          target, reinterpret_cast<hz::SlotObserver>(hz_probe_observer),
          static_cast<std::uint32_t>(index));
      g_hooks[index].used = true;
      g_hooks[index].vtable = 0;
      g_hooks[index].slot = 0;
      g_hooks[index].original = target;
      g_hooks[index].relay = hooked.relay;
      std::size_t k = 0;
      while (k < sym.name.size() && k + 1 < sizeof(g_hooks[index].class_name)) {
        g_hooks[index].class_name[k] = sym.name[k];
        ++k;
      }
      g_hooks[index].class_name[k] = '\0';
      ++installed;
      // Logged per hook, before moving on: if the client dies partway through the sweep this
      // line is the only record of how far it got.
      if ((installed % 16) == 0) {
        note("probe: %d installed so far, at %s\n", installed, sym.name.c_str());
      }
    } catch (const std::exception& e) {
      ++refused;
    } catch (...) {
      ++refused;
    }
  }
  note("probe: installed %d export hooks (%d too short, %d refused)\n", installed,
       skipped_short, refused);
  return installed;
}

// Hooks every exported symbol whose name contains `needle`, counting entries per hook.
//
// This replaces the guess-a-function approach with a measurement. Four targets were each
// verified installed and each recorded zero entries through a complete sign-in -- the QR
// class, the MSFService send slot, and the notifyLoginSuccess export -- which is a strong hint
// that the guess about which entry point the login path uses is wrong rather than that the
// mechanism is broken. Rather than test a fifth guess, hook the whole plausible family and let
// the counters say which one QQ actually calls.
//
// Deliberately skips any target whose prologue cannot be relocated safely: hook_function
// rejects pc-relative forms, and one refusal must not abort the sweep.
extern "C" int hz_hook_exports_matching(const char* needle, int max_hooks) {
  if (needle == nullptr || needle[0] == '\0') {
    set_error("needle is empty");
    return -1;
  }
  std::string path;
  const std::uint64_t base = find_wrapper_base(&path);
  if (base == 0) {
    set_error("wrapper.node is not mapped in this process");
    return -2;
  }
  g_module_base = base;
  hz::ElfImage image(hz::MappedFile::open(path));

  // The dynamic symbol table, filtered by substring. Collected before patching so a failure
  // partway through leaves the earlier hooks installed rather than half-rolled-back.
  const std::vector<hz::DynSymbol>& syms = image.symbols();
  int installed = 0;
  int refused = 0;
  const std::size_t needle_len = std::strlen(needle);
  for (const hz::DynSymbol& sym : syms) {
    if (installed >= max_hooks) break;
    if (!sym.defined || sym.value == 0) continue;
    // Skip functions shorter than the patch. Patching 16 bytes into an 8-byte getter
    // overwrites the start of the next function in .text, which crashes the client in code that
    // has nothing to do with the hook -- and did, before this check existed. Many MSFSDK
    // accessors (currentConnSeq, isConnected, ...) are exactly this shape.
    if (sym.size != 0 && sym.size < 16) {
      ++refused;
      continue;
    }
    const std::string& nm = sym.name;
    if (nm.size() < needle_len) continue;
    if (nm.find(needle) == std::string::npos) continue;

    std::size_t index = kMaxHooks;
    for (std::size_t i = 0; i < kMaxHooks; ++i) {
      if (!g_hooks[i].used) { index = i; break; }
    }
    if (index == kMaxHooks) break;

    const std::uint64_t target = base + (sym.value - image.image_base());
    try {
      const hz::HookedFunction hooked = hz::hook_function_relayed_in_process(
          target, reinterpret_cast<hz::SlotObserver>(hz_sweep_observer),
          static_cast<std::uint32_t>(index));
      g_hooks[index].used = true;
      g_hooks[index].vtable = 0;
      g_hooks[index].slot = 0;
      g_hooks[index].original = target;
      g_hooks[index].relay = hooked.relay;
      std::size_t k = 0;
      while (k < nm.size() && k + 1 < sizeof(g_hooks[index].class_name)) {
        g_hooks[index].class_name[k] = nm[k];
        ++k;
      }
      g_hooks[index].class_name[k] = '\0';
      ++installed;
    } catch (const std::exception& e) {
      ++refused;
      note("exports: refused %s: %s\n", nm.c_str(), e.what());
    } catch (...) {
      ++refused;
    }
  }
  note("exports: installed %d hooks matching %s (%d refused)\n", installed, needle, refused);
  return installed;
}

// Hooks an exported function by name -- the entry point the application actually calls.
//
// This is the siting that the vtable approach missed. wrapper.node exports 385 symbols,
// including MSF::MSFSDK::notifyLoginSuccess at 0x412bac8, and QQ's login path reaches it as a
// plain export rather than through a virtual dispatch. Hooking vtable slots therefore produced
// the most misleading result available: hooks installed correctly, relays resident, two live
// MSFService instances pointing at the table we modified, and zero entries through a complete
// sign-in.
//
// An exported function has no vtable to write, so this patches the function itself: the first
// instructions are replaced with a jump to a relay, and the relay replays them before jumping
// back. hook_function_relayed_in_process owns that, including the instruction relocations.
extern "C" int hz_hook_export_login_observer(hz_hook_observer observer) {
  if (observer == nullptr) {
    set_error("login observer is null");
    return -1;
  }
  std::string path;
  const std::uint64_t base = find_wrapper_base(&path);
  if (base == 0) {
    set_error("wrapper.node is not mapped in this process");
    return -2;
  }
  g_module_base = base;

  hz::ElfImage image(hz::MappedFile::open(path));
  // The mangled name of MSF::MSFSDK::notifyLoginSuccess(string const&, _EMSFUinType, string,
  // string, string, string).  Spelled out because it is the ABI: the symbol is what the caller
  // resolves, and a renamed export means the hook cannot work anyway.
  const char* kNotify = "_ZN3MSF6MSFSDK18notifyLoginSuccessERKNSt2Cr12basic_stringIcNS1_11char"
                        "_traitsIcEENS1_9allocatorIcEEEE12_EMSFUinTypeS9_S9_S9_S9_";
  const hz::DynSymbol* sym = image.find_symbol(kNotify);
  if (sym == nullptr || !sym->defined || sym->value == 0) {
    note("export: notifyLoginSuccess not found\n");
    set_error("notifyLoginSuccess is not exported");
    return -3;
  }
  if (sym->size != 0 && sym->size < 16) {
    note("export: notifyLoginSuccess is %llu bytes, too short to patch safely\n",
         static_cast<unsigned long long>(sym->size));
    set_error("notifyLoginSuccess is too short to patch");
    return -6;
  }
  const std::uint64_t target = base + (sym->value - image.image_base());
  note("export: notifyLoginSuccess at 0x%llx (offset 0x%llx)\n",
       static_cast<unsigned long long>(target),
       static_cast<unsigned long long>(sym->value - image.image_base()));

  std::size_t index = kMaxHooks;
  for (std::size_t i = 0; i < kMaxHooks; ++i) {
    if (!g_hooks[i].used) { index = i; break; }
  }
  if (index == kMaxHooks) {
    set_error("no free hook slot");
    return -4;
  }
  try {
    const hz::HookedFunction hooked = hz::hook_function_relayed_in_process(
        target, reinterpret_cast<hz::SlotObserver>(observer),
        static_cast<std::uint32_t>(index));
    g_hooks[index].used = true;
    g_hooks[index].vtable = 0;
    g_hooks[index].slot = 0;
    g_hooks[index].original = target;
    g_hooks[index].relay = hooked.relay;
    const char* nm = "export:notifyLoginSuccess";
    std::size_t k = 0;
    while (nm[k] != '\0' && k + 1 < sizeof(g_hooks[index].class_name)) {
      g_hooks[index].class_name[k] = nm[k];
      ++k;
    }
    g_hooks[index].class_name[k] = '\0';
    note("export hook installed on notifyLoginSuccess, relay=0x%llx\n",
         static_cast<unsigned long long>(hooked.relay));
  } catch (const std::exception& e) {
    note("export: hook failed: %s\n", e.what());
    set_error("export hook installation failed");
    return -5;
  } catch (...) {
    note("export: hook failed with a non-std exception\n");
    set_error("export hook installation failed");
    return -5;
  }
  return 0;
}

// Hooks a few slots on every nt::login class, so the entry counter can say which one QQ
// actually calls during a sign-in.
//
// This exists because static analysis settled which slot a class holds but not which class the
// login flow traverses: the QR class's slot stayed at zero entries through a complete
// saved-account sign-in, which is a fact about siting and cannot be derived from the ELF. The
// alternative to sweeping is guessing one class at a time, which is what had already been done
// and had already failed.
//
// Slots 0..slots_to_try-1 of each primary vtable, skipping empty ones and ones that are already
// ours. Returns the number installed; the per-hook table, with class name and slot, is what the
// caller reads back.
extern "C" int hz_hook_sweep_login_classes(int slots_to_try) {
  char path_buffer[512] = {0};
  std::string path;
  const std::uint64_t base = find_wrapper_base(&path);
  if (base == 0) {
    set_error("wrapper.node is not mapped in this process");
    return 0;
  }
  g_module_base = base;
  hz::ElfImage image(hz::MappedFile::open(path));
  const std::vector<hz::VtableInfo> all = hz::list_vtables(image);
  if (all.empty()) return 0;

  // Group the candidates by class name, keeping only login classes.
  // Collected first so the primary per class is decided before any slot is written: writing
  // into a table we later decide is not the primary would leave a hook behind on a table the
  // class does not use.
  std::vector<std::string> classes;
  for (const hz::VtableInfo& v : all) {
    if (v.class_name.rfind("nt::login::", 0) != 0) continue;
    bool seen = false;
    for (const std::string& c : classes) {
      if (c == v.class_name) { seen = true; break; }
    }
    if (!seen) classes.push_back(v.class_name);
  }

  const hz::SlotObserver relay_observer = reinterpret_cast<hz::SlotObserver>(g_sweep_observer);
  int installed = 0;
  for (const std::string& name : classes) {
    const std::optional<hz::VtableInfo> prim = hz::primary_vtable(image, all, name);
    if (!prim.has_value()) continue;
    const std::uint64_t vt_live = base + prim->address;
    const int limit = (static_cast<std::uint32_t>(slots_to_try) < prim->slots)
                          ? slots_to_try
                          : static_cast<int>(prim->slots);
    for (int slot = 0; slot < limit; ++slot) {
      if (hz::read_vtable_slot_live(vt_live, static_cast<std::uint32_t>(slot)) == 0) continue;
      std::size_t free_index = kMaxHooks;
      for (std::size_t i = 0; i < kMaxHooks; ++i) {
        if (!g_hooks[i].used) { free_index = i; break; }
      }
      if (free_index == kMaxHooks) return installed;
      try {
        const hz::HookedSlot hooked = hz::hook_vtable_slot_relayed_in_process(
            vt_live, static_cast<std::uint32_t>(slot), relay_observer);
        g_hooks[free_index].used = true;
        g_hooks[free_index].vtable = hooked.vtable;
        g_hooks[free_index].slot = hooked.slot;
        g_hooks[free_index].original = hooked.original;
        g_hooks[free_index].relay = hooked.relay;
        // The name is what makes a non-zero counter useful: a bare slot number says nothing
        // without the class it belongs to.
        const std::size_t cap = sizeof(g_hooks[free_index].class_name) - 1;
        const std::size_t len = name.size() < cap ? name.size() : cap;
        for (std::size_t k = 0; k < len; ++k) g_hooks[free_index].class_name[k] = name[k];
        g_hooks[free_index].class_name[len] = '\0';
        ++installed;
        note("sweep: %s slot %d vtable=0x%llx\n", name.c_str(), slot,
             static_cast<unsigned long long>(hooked.vtable));
      } catch (const std::exception& e) {
        note("sweep: %s slot %d failed: %s\n", name.c_str(), slot, e.what());
      } catch (...) {
        note("sweep: %s slot %d failed: unknown\n", name.c_str(), slot);
      }
    }
  }
  (void)path_buffer;
  note("sweep: %d hooks across %zu login classes\n", installed, classes.size());
  return installed;
}

// Reads back what a sweep installed: the class name and slot for one hook index.
extern "C" const char* hz_hook_class_name(int index) {
  if (index < 0 || static_cast<std::size_t>(index) >= kMaxHooks) return "";
  if (!g_hooks[index].used) return "";
  return g_hooks[index].class_name;
}

extern "C" int hz_hook_slot_of(int index) {
  if (index < 0 || static_cast<std::size_t>(index) >= kMaxHooks) return -1;
  if (!g_hooks[index].used) return -1;
  return static_cast<int>(g_hooks[index].slot);
}

// Removes every hook this payload installed.  Safe to call when none are installed, and
// safe to call twice: a hook that cannot be undone cannot be reloaded, and QQ reloads
// wrapper.node on some updates.
extern "C" void hz_hook_remove_all() {
  for (std::size_t i = 0; i < kMaxHooks; ++i) {
    if (!g_hooks[i].used) continue;
    hz::HookedSlot hooked;
    hooked.vtable = g_hooks[i].vtable;
    hooked.slot = g_hooks[i].slot;
    hooked.original = g_hooks[i].original;
    hooked.relay = g_hooks[i].relay;
    hz::unhook_vtable_slot_relayed_in_process(hooked);
    g_hooks[i] = InstalledHook{};
  }
}

// Number of live hooks, so the payload can report it on the wire and a test can assert
// that unload left nothing behind.
extern "C" unsigned long long hz_hook_hits(int index) {
  if (index < 0 || static_cast<std::size_t>(index) >= kMaxHooks) return 0;
  if (!g_hooks[index].used) return 0;
  return hz::slot_relay_hits(g_hooks[index].relay);
}

extern "C" int hz_hook_count() {
  int n = 0;
  for (const auto& h : g_hooks) if (h.used) ++n;
  return n;
}

// The uin of the logged-in account, read from wrapper.node, or 0 when it is not known.
//
// This returns 0 rather than a placeholder on purpose.  The login observer fires when QQ
// announces a login, and the account number lives in the module's state at that point --
// but *where* in that state is not yet established (see docs/vtable-slots.md: SetDefaultUin
// is slot 22 and takes the uin as an argument, which makes it the most direct source, but
// the calling convention and the object layout still need confirming against a live
// client).  Until that is settled this reports "unknown", and the wire protocol says
// logged-in with no uin.
//
// Why unknown rather than a guess: the Node side already knows the account. It is the
// `uin` constructor argument of Instance, read from SnowLuma's own login config, and every
// status line about the account comes from there -- the payload is never the source. So the
// only thing this value is good for is *cross-checking* that the hook attached to the QQ the
// config names. A wrong number would not be "slightly off"; it would make that check report
// "the session account changed" when it did not, which is the kind of false positive that
// costs an afternoon. Missing the check entirely is the cheaper error. See
// docs/uin-is-redundant.md.
extern "C" long long hz_hook_login_uin() { return 0; }

extern "C" const char* hz_hook_last_error() { return g_last_error; }

extern "C" std::uint64_t hz_hook_module_base() { return g_module_base; }