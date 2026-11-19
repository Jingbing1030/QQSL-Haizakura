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
};

constexpr std::size_t kMaxHooks = 8;
InstalledHook g_hooks[kMaxHooks];
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
  std::printf("[payload] hook: %zu vtables in wrapper.node, looking for %s\n", all.size(),
              kLoginClass);
  std::fflush(stdout);
  const std::optional<hz::VtableInfo> target = hz::primary_vtable(image, all, kLoginClass);
  if (!target.has_value()) {
    set_error("login class not found by RTTI name");
    return -5;
  }
  if (target->slots <= kLoginSlot) {
    set_error("login vtable is too short for the expected slot");
    return -6;
  }

  const std::uint64_t vtable_live = base + target->address;
  const std::uint64_t current = hz::read_vtable_slot_live(vtable_live, kLoginSlot);
  if (current == 0) {
    set_error("login slot is empty");
    return -7;
  }

  for (std::size_t i = 0; i < kMaxHooks; ++i) {
    if (g_hooks[i].used) continue;
    // The two typedefs describe the same signature, so this conversion is a no-op at
    // runtime; it exists because the C header cannot name a type inside `hz`.
    const hz::SlotObserver relay_observer = reinterpret_cast<hz::SlotObserver>(observer);
    const hz::HookedSlot hooked =
        hz::hook_vtable_slot_relayed_in_process(vtable_live, kLoginSlot, relay_observer);
    if (hooked.relay == 0) {
      set_error("relay installation failed");
      return -8;
    }
    g_hooks[i].used = true;
    g_hooks[i].vtable = hooked.vtable;
    g_hooks[i].slot = hooked.slot;
    g_hooks[i].original = hooked.original;
    g_hooks[i].relay = hooked.relay;
    std::printf("[payload] hook: login observer installed vtable=0x%llx slot=%u original=0x%llx\n",
                static_cast<unsigned long long>(hooked.vtable), hooked.slot,
                static_cast<unsigned long long>(hooked.original));
    std::fflush(stdout);
    return 0;
  }
  set_error("no free hook slot");
  return -9;
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