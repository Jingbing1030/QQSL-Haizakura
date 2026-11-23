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

  // Function-entry hooks need the displaced prologue bytes to be undoable.
  //
  // These were missing, which made every function hook permanent and made removal fatal: the
  // undo path assumed a vtable slot, so it fed vtable == 0 to a check that threw, inside an
  // extern "C" with no handler -- std::terminate, host process gone. Installing the PROBE sweep
  // and then stopping was enough to kill the client.
  bool is_function = false;
  std::uint32_t saved_len = 0;
  std::uint8_t saved[20] = {0};
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
extern "C" void hz_sweep_observer(std::uint32_t, std::uint64_t, std::uint64_t, std::uint64_t,
                                  std::uint64_t, std::uint64_t, std::uint64_t*);
extern "C" void hz_probe_observer(std::uint32_t, std::uint64_t, std::uint64_t, std::uint64_t,
                                  std::uint64_t, std::uint64_t, std::uint64_t*);
// Forwards to the observer in the payload module, passing the frame through so an observer on the
// send path can still rewrite arguments. Dropping it here would silently reintroduce the old
// read-only behaviour for every export-sweep hook.
void g_sweep_observer(std::uint32_t slot, std::uint64_t original, std::uint64_t a0,
                      std::uint64_t a1, std::uint64_t a2, std::uint64_t a3, std::uint64_t* frame) {
  hz_sweep_observer(slot, original, a0, a1, a2, a3, frame);
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
// Finds the load base of any mapped module whose path contains `needle`.
//
// Pure C on purpose. The first version used std::string_view and a static 4 MB buffer and faulted
// before writing a single log line, with the failure inside a call that had no C++ state to
// speak of -- the module is mapped by hand, and every C++ facility it uses has to already exist
// by the time this runs. open/read/malloc/memcmp have no such requirement.
constexpr std::size_t kMaxPathLen = 512;

std::uint64_t find_module_base(const char* needle) {
  if (needle == nullptr || needle[0] == '\0') return 0;
  const int fd = ::open("/proc/self/maps", O_RDONLY | O_CLOEXEC);
  if (fd < 0) return 0;
  char* buf = static_cast<char*>(::malloc(kMapsBufferSize));
  if (buf == nullptr) { ::close(fd); return 0; }
  std::size_t size = 0;
  while (size < kMapsBufferSize - 1) {
    const ssize_t n = ::read(fd, buf + size, kMapsBufferSize - 1 - size);
    if (n < 0) {
      if (errno == EINTR) continue;
      break;
    }
    if (n == 0) break;
    size += static_cast<std::size_t>(n);
  }
  ::close(fd);
  buf[size] = '\0';

  const std::size_t needle_len = std::strlen(needle);
  std::uint64_t best = 0;
  char* line = buf;
  while (line < buf + size) {
    char* eol = line;
    while (eol < buf + size && *eol != '\n') ++eol;
    *eol = '\0';
    // Substring search by hand: std::string_view is what faulted.
    bool has = false;
    {
      const std::size_t line_len = static_cast<std::size_t>(eol - line);
      if (line_len >= needle_len) {
        for (std::size_t i = 0; i + needle_len <= line_len; ++i) {
          if (std::memcmp(line + i, needle, needle_len) == 0) { has = true; break; }
        }
      }
    }
    if (has) {
      char* dash = nullptr;
      for (char* q = line; *q != '\0'; ++q) {
        if (*q == '/') { dash = nullptr; break; }
        if (*q == '-') { dash = q; break; }
      }
      if (dash != nullptr) {
        std::uint64_t lo = 0;
        bool ok = true;
        for (char* q = line; q < dash; ++q) {
          const char c = *q;
          lo <<= 4;
          if (c >= '0' && c <= '9') lo |= static_cast<std::uint64_t>(c - '0');
          else if (c >= 'a' && c <= 'f') lo |= static_cast<std::uint64_t>(c - 'a' + 10);
          else if (c >= 'A' && c <= 'F') lo |= static_cast<std::uint64_t>(c - 'A' + 10);
          else { ok = false; break; }
        }
        if (ok && lo != 0 && (best == 0 || lo < best)) best = lo;
      }
    }
    line = eol + 1;
  }
  ::free(buf);
  return best;
}

// Recovers the on-disk path of the mapping that starts at `base`.
//
// Pure C for the same reason find_module_base is: this runs inside a hand-mapped module before
// any C++ runtime guarantee holds.
bool path_for_base(std::uint64_t base, char* out, std::size_t cap) {
  if (out == nullptr || cap == 0) return false;
  out[0] = '\0';
  // Stage logging: this function has failed silently once already, and the reason matters --
  // a null buffer, a short read and a genuine mismatch all look identical from the caller.
  {
    const int lfd = ::open("/tmp/hz-path.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (lfd >= 0) {
      char lb[128];
      const int ln = std::snprintf(lb, sizeof(lb), "enter base=0x%llx cap=%zu\n",
                                   (unsigned long long)base, cap);
      if (ln > 0) (void)::write(lfd, lb, (size_t)ln);
      ::close(lfd);
    }
  }
  const int fd = ::open("/proc/self/maps", O_RDONLY | O_CLOEXEC);
  if (fd < 0) return false;
  char* buf = static_cast<char*>(::malloc(kMapsBufferSize));
  if (buf == nullptr) { ::close(fd); return false; }
  std::size_t size = 0;
  while (size < kMapsBufferSize - 1) {
    const ssize_t n = ::read(fd, buf + size, kMapsBufferSize - 1 - size);
    if (n < 0) {
      if (errno == EINTR) continue;
      break;
    }
    if (n == 0) break;
    size += static_cast<std::size_t>(n);
  }
  ::close(fd);
  buf[size] = '\0';

  bool found = false;
  int lines_seen = 0;
  int lines_with_both = 0;
  std::uint64_t first_lo = 0;
  int first_ok = 0;
  char* line = buf;
  while (line < buf + size && !found) {
    ++lines_seen;
    char* eol = line;
    while (eol < buf + size && *eol != '\n') ++eol;
    *eol = '\0';
    char* dash = nullptr;
    char* slash = nullptr;
    // Deliberately not a single break-on-either loop.
    //
    // The dash separates the start and end addresses and always comes before the path, so a loop
    // that breaks on the first of the two characters can only ever find the dash: slash stays
    // null and every line is rejected. Measured before the fix -- 980 lines read, 0 with both
    // fields, so this function had never resolved a path at all. Every caller saw only
    // "return -4", which reads like a missing module rather than a parser that cannot match.
    for (char* q = line; *q != '\0'; ++q) {
      if (*q == '/') { slash = q; break; }
      if (*q == '-' && dash == nullptr) dash = q;
    }
    if (dash != nullptr && slash != nullptr) {
      std::uint64_t lo = 0;
      bool ok = true;
      for (char* q = line; q < dash; ++q) {
        const char c = *q;
        lo <<= 4;
        if (c >= '0' && c <= '9') lo |= static_cast<std::uint64_t>(c - '0');
        else if (c >= 'a' && c <= 'f') lo |= static_cast<std::uint64_t>(c - 'a' + 10);
        else if (c >= 'A' && c <= 'F') lo |= static_cast<std::uint64_t>(c - 'A' + 10);
        else { ok = false; break; }
      }
      if (lines_with_both == 0) { first_lo = lo; first_ok = ok ? 1 : 0; }
      ++lines_with_both;
      if (ok && lo == base) {
        std::size_t n = std::strlen(slash);
        if (n < cap) {
          std::memcpy(out, slash, n + 1);
          found = true;
        }
      }
    }
    line = eol + 1;
  }
  ::free(buf);
  {
    const int lfd = ::open("/tmp/hz-path.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (lfd >= 0) {
      char lb[320];
      const int ln = std::snprintf(lb, sizeof(lb),
                                   "done found=%d path=%s size=%zu lines=%d withboth=%d firstLo=0x%llx firstOk=%d\n",
                                   found ? 1 : 0, out, size, lines_seen, lines_with_both,
                                   (unsigned long long)first_lo, first_ok);
      if (ln > 0) (void)::write(lfd, lb, (size_t)ln);
      ::close(lfd);
    }
  }
  return found;
}

// Patches one exactly-named symbol inside a module given by its load base.
int hook_symbol_in_base(std::uint64_t base, const char* symbol, hz_hook_observer observer) {
  char path[kMaxPathLen];
  if (!path_for_base(base, path, sizeof(path))) {
    set_error("cannot resolve module path for base");
    return -4;
  }
  {
    const int lfd = ::open("/tmp/hz-libhook.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (lfd >= 0) {
      char lb[256];
      const int ln = std::snprintf(lb, sizeof(lb), "stage=path-resolved path=%s\n", path);
      if (ln > 0) (void)::write(lfd, lb, (size_t)ln);
      ::close(lfd);
    }
  }
  hz::ElfImage image(hz::MappedFile::open(path));
  const hz::DynSymbol* sym = nullptr;
  const std::size_t n = std::strlen(symbol);
  for (const hz::DynSymbol& sref : image.symbols()) {
    if (!sref.defined || sref.value == 0) continue;
    if (sref.name.size() != n) continue;
    if (std::strncmp(sref.name.data(), symbol, n) != 0) continue;
    sym = &sref;
    break;
  }
  if (sym == nullptr) { set_error("symbol not found in module"); return -5; }
  const std::uint64_t addr = base + (sym->value - image.image_base());
  {
    // Log the resolved address before installing. The previous attempt stopped after
    // "stage=path-resolved" and returned without another line, which is indistinguishable
    // between three failures: symbol missing, address computed wrong, or the patch itself
    // refusing. One line here separates the first two from the third.
    const int afd = ::open("/tmp/hz-libhook.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (afd >= 0) {
      char ab[256];
      const int an = std::snprintf(ab, sizeof(ab),
                                   "stage=resolved symbol=%s value=0x%llx image_base=0x%llx "
                                   "module_base=0x%llx addr=0x%llx\n",
                                   symbol, (unsigned long long)sym->value,
                                   (unsigned long long)image.image_base(),
                                   (unsigned long long)base, (unsigned long long)addr);
      if (an > 0) (void)::write(afd, ab, (size_t)an);
      ::close(afd);
    }
  }

  std::size_t index = kMaxHooks;
  for (std::size_t i = 0; i < kMaxHooks; ++i) {
    if (!g_hooks[i].used) { index = i; break; }
  }
  if (index >= kMaxHooks) {
    set_error("no free hook slot");
    return -6;
  }
  try {
    const hz::HookedFunction hooked = hz::hook_function_relayed_in_process(
        addr, reinterpret_cast<hz::SlotObserver>(observer), static_cast<std::uint32_t>(index));
    g_hooks[index].used = true;
    g_hooks[index].vtable = 0;
    g_hooks[index].slot = 0;
    g_hooks[index].original = addr;
    g_hooks[index].relay = hooked.relay;
    g_hooks[index].is_function = true;
    g_hooks[index].saved_len = hooked.saved_len;
    for (std::uint32_t b = 0; b < hooked.saved_len && b < sizeof(g_hooks[index].saved); ++b) {
      g_hooks[index].saved[b] = hooked.saved[b];
    }
    std::size_t k = 0;
    while (symbol[k] != '\0' && k + 1 < sizeof(g_hooks[index].class_name)) {
      g_hooks[index].class_name[k] = symbol[k];
      ++k;
    }
    g_hooks[index].class_name[k] = '\0';
    // Print target and saved_len alongside relay. relay printed as 0x0 while the throw above it
    // did not fire, which is self-contradictory unless the struct came back garbled -- so log all
    // the fields that would reveal a misaligned return rather than just the suspicious one.
    note("lib hook installed on %s target=0x%llx relay=0x%llx saved_len=%u\n", symbol,
         static_cast<unsigned long long>(hooked.target),
         static_cast<unsigned long long>(hooked.relay),
         static_cast<unsigned>(hooked.saved_len));
  } catch (const std::exception& e) {
    note("lib hook failed: %s\n", e.what());
    set_error("library hook installation failed");
    return -7;
  } catch (...) {
    note("lib hook failed with a non-std exception\n");
    set_error("library hook installation failed");
    return -7;
  }
  return 0;
}

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

    // Idempotence: a second install must not stack a relay on top of our own relay.
    //
    // Installing twice used to succeed and produce a chain, and the log made the damage
    // visible in the one field nobody would look at twice: the second call reported
    // original=0xf9673ce2a020, an address inside our own mapping, where the first had reported
    // the real wrapper.node function. That chain still forwards correctly as long as every
    // relay preserves the original it captured, but it turns one hook into N and makes the
    // recorded `original` useless for reasoning about what QQ's function actually was.
    for (std::size_t i = 0; i < kMaxHooks; ++i) {
      if (!g_hooks[i].used) continue;
      if (g_hooks[i].vtable == vt_live && g_hooks[i].slot == kTrunkSlot) {
        note("trunk: slot %u already relayed (hook %zu), not stacking another\n", kTrunkSlot, i);
        return 0;
      }
    }

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
  //
  // The try is not defensive decoration. hook_vtable_slot_relayed_in_process throws when a slot
  // address fails its mapping check, and this function is extern "C" with no handler above it,
  // so an unguarded throw becomes std::terminate and takes the client with it. The trunk branch
  // above has always had this guard; this one did not, which made the comment directly above
  // false -- the very case it promised to survive would have killed the process.
  try {
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
  } catch (const std::exception& e) {
    note("qr hook failed, login signal disabled: %s\n", e.what());
  } catch (...) {
    note("qr hook failed, login signal disabled\n");
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

    // Only real functions. An ELF symbol table mixes code with data, and patching data breaks
    // whatever owns it in a way that has nothing to do with hooks.
    //
    // This is what the sweep hit next after the size check went in: `_ZTINSt2Cr10__function...`,
    // a typeinfo object, which is a *data* symbol of exactly 16 bytes -- so it passed the
    // "large enough to patch" test and its 16 bytes of RTTI were overwritten with a jump. Every
    // subsequent dynamic_cast in the client reads that object.
    // STT_FUNC (2) is the only thing that can be entry-patched; STT_GNU_IFUNC (10) resolves to a
    // function too and is accepted.
    if (sym.type != 2 && sym.type != 10) { ++skipped_short; continue; }

    // size == 0 must be refused, not allowed through.
    //
    // The condition used to be `size != 0 && size < 16`, which let unknown-size symbols past the
    // guard -- and size 0 is exactly what a stripped or section-less entry looks like. Patching 16
    // bytes there overwrites whatever follows in .text, which is how the client died mid-sweep
    // with the log ending on `probe: try  at 0x... size=0`: an empty name, an unknown size, and
    // then nothing.
    //
    // An empty name is refused for the same reason: it means the symbol table has no name to
    // report, so a hit on it could never be acted on even if the hook were safe.
    if (sym.name.empty()) { ++skipped_short; continue; }
    if (sym.size < 16) { ++skipped_short; continue; }

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

    // Every attempt is logged before it happens, because a fault inside the patch takes the
    // process down with no chance to write anything afterwards -- the last line in the log is the
    // only record of which function was being patched.
    note("probe: try %s at 0x%llx size=%llu\n", sym.name.c_str(),
         static_cast<unsigned long long>(target),
         static_cast<unsigned long long>(sym.size));
    try {
      const hz::HookedFunction hooked = hz::hook_function_relayed_in_process(
          target, reinterpret_cast<hz::SlotObserver>(hz_probe_observer),
          static_cast<std::uint32_t>(index));
      if (hooked.relay == 0) {
        // Refused, not failed: the prologue could not be relocated safely. Reported through the
        // prologue/refusal log rather than an exception, because raising one from this module
        // crashes the client (see hook_function_relayed_in_process).
        ++refused;
        continue;
      }
      g_hooks[index].used = true;
      g_hooks[index].vtable = 0;
      g_hooks[index].slot = 0;
      g_hooks[index].original = target;
      g_hooks[index].relay = hooked.relay;
      g_hooks[index].is_function = true;
      g_hooks[index].saved_len = hooked.saved_len;
      for (std::uint32_t b = 0; b < hooked.saved_len && b < sizeof(g_hooks[index].saved); ++b) {
        g_hooks[index].saved[b] = hooked.saved[b];
      }
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
      note("probe: OK %s relay=0x%llx\n", sym.name.c_str(),
           static_cast<unsigned long long>(hooked.relay));
    } catch (const std::exception& e) {
      ++refused;
      note("probe: refused %s: %s\n", sym.name.c_str(), e.what());
    } catch (...) {
      ++refused;
      note("probe: refused %s: unknown\n", sym.name.c_str());
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
// The observer a named-export hook reports to. Set by the variant below so the SPY command can
// see what a call carried while PROBE keeps its counter-only observer.
static hz_hook_observer g_exports_observer = nullptr;

extern "C" int hz_hook_exports_matching_with(const char* needle, int max_hooks,
                                             hz_hook_observer observer) {
  g_exports_observer = observer;
  return hz_hook_exports_matching(needle, max_hooks);
}

// Hooks a named export inside an arbitrary module already mapped in the process.
//
// The reason this exists: every export of wrapper.node was instrumented and a real send still
// resolved to nothing, so the boundary is elsewhere -- either libc's send/write or a surface we
// cannot see. Patching the module that actually owns the syscall is the only remaining way to
// learn which code emits the bytes, and it needs a base address that find_wrapper_base() cannot
// give because libc is not wrapper.node.
//
// module  : substring of the path in /proc/self/maps, e.g. "libc.so.6" or "qq"
// symbol  : exact undefined/defined symbol name to patch, e.g. "send" or "write"
// observer: called on every entry with the raw argument registers
//
// Returns 0 on success, negative on failure. Deliberately exact-name rather than substring:
// "send" as a substring also matches sendto/sendmsg/sendmmsg, and patching all four at once
// during a live send is a reliable way to hang the client.
// Exposes find_module_base to the payload's other translation units.
//
// observer-only mode installs no hook, so nothing has populated g_module_base yet; the probe
// needs the base before installing anything.
extern "C" std::uint64_t hz_hook_find_module_base(const char* module) {
  return find_module_base(module);
}

// Attaches a post-call callback to a hook, addressed by the index hz_hook_function_offset
// returned. Exposed as a C entry point so the payload can use it without including the relay
// header, which is C++ and declares the observer types it would then have to match.
extern "C" int hz_hook_set_after(unsigned idx, hz_hook_after after) {
  if (idx >= kMaxHooks) return -1;
  if (!g_hooks[idx].used) return -2;
  if (g_hooks[idx].relay == 0) return -3;
  if (!hz::slot_relay_set_after(g_hooks[idx].relay, reinterpret_cast<hz::SlotAfter>(after))) {
    // The trampoline address was not in the relay table, so nothing was stored. Reporting 0 here
    // is what let a post-call callback look installed while it never ran.
    set_error("relay not found for post-call registration");
    return -4;
  }
  return 0;
}

extern "C" std::uint64_t hz_hook_relay_of_return(unsigned idx) {
  if (idx >= kMaxHooks) return 0;
  if (!g_hooks[idx].used) return 0;
  return g_hooks[idx].relay;
}

extern "C" int hz_hook_function_offset(std::uint64_t offset, hz_hook_observer observer) {
  if (observer == nullptr) {
    set_error("observer is null");
    return -1;
  }
  const std::uint64_t base = find_module_base("wrapper.node");
  if (base == 0) {
    set_error("wrapper.node is not mapped in this process");
    return -2;
  }
  const std::uint64_t target = base + offset;
  std::size_t index = kMaxHooks;
  for (std::size_t i = 0; i < kMaxHooks; ++i) {
    if (!g_hooks[i].used) { index = i; break; }
  }
  if (index == kMaxHooks) {
    set_error("no free hook slot");
    return -3;
  }
  {
    const int lfd = ::open("/tmp/hz-fn.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (lfd >= 0) {
      char lb[160];
      const int ln = std::snprintf(lb, sizeof(lb), "hook offset=0x%llx addr=0x%llx\n",
                                   (unsigned long long)offset, (unsigned long long)target);
      if (ln > 0) (void)::write(lfd, lb, (size_t)ln);
      ::close(lfd);
    }
  }
  try {
    const hz::HookedFunction hooked = hz::hook_function_relayed_in_process(
        target, reinterpret_cast<hz::SlotObserver>(observer), 0);
    g_hooks[index].used = true;
    g_hooks[index].vtable = 0;
    g_hooks[index].slot = 0;
    g_hooks[index].original = target;
    g_hooks[index].relay = hooked.relay;
    g_hooks[index].is_function = true;
    g_hooks[index].saved_len = hooked.saved_len;
    note("fn: hooked offset=0x%llx relay=0x%llx saved=%u\n",
         (unsigned long long)offset, (unsigned long long)hooked.relay,
         static_cast<unsigned>(hooked.saved_len));
    // relay == 0 means the target was already relayed by this process, so nothing new was
    // installed. Reporting success here is how a second install silently replaced the first
    // observer with nothing: the caller saw rc >= 0, the original observer kept running, and the
    // log of the one that was "installed" stayed empty forever. Say so instead.
    if (hooked.relay == 0) {
      g_hooks[index].used = false;
      set_error("already relayed by this process; uninstall first");
      return -7;
    }
  } catch (const std::exception& e) {
    set_error(e.what());
    return -5;
  } catch (...) {
    set_error("unknown failure");
    return -6;
  }
  return static_cast<int>(index);
}

extern "C" int hz_hook_library_symbol(const char* module, const char* symbol,
                                      hz_hook_observer observer) {
  if (module == nullptr || symbol == nullptr) {
    set_error("module or symbol is null");
    return -1;
  }
  const std::uint64_t base = find_module_base(module);
  {
    // Both halves of the lookup, because "return -4" from path resolution and "return -2" from
    // the base search are the same symptom from outside -- no hook -- and the two have entirely
    // different causes. Cheap to log, expensive to guess.
    const int lfd = ::open("/tmp/hz-libhook.log", O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (lfd >= 0) {
      char lb[256];
      const int ln = std::snprintf(lb, sizeof(lb), "lookup module=%s base=0x%llx symbol=%s\n",
                                   module, (unsigned long long)base, symbol);
      if (ln > 0) (void)::write(lfd, lb, (size_t)ln);
      ::close(lfd);
    }
  }
  if (base == 0) {
    set_error("module is not mapped in this process");
    return -2;
  }
  char note_buf[192];
  std::snprintf(note_buf, sizeof(note_buf), "lib hook: module=%s base=0x%llx symbol=%s\n",
                module, static_cast<unsigned long long>(base), symbol);
  note(note_buf);
  return hook_symbol_in_base(base, symbol, observer);
}

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
    // Only functions: see the note in hz_hook_all_exports about typeinfo objects being data.
    if (sym.type != 2 && sym.type != 10) { ++refused; continue; }
    // Skip functions shorter than the patch, and those whose size is unknown.
    // Patching 16 bytes into an 8-byte getter overwrites the start of the next function in
    // .text, which crashes the client in code that has nothing to do with the hook -- and did,
    // before this check existed. Many MSFSDK accessors (currentConnSeq, isConnected, ...) are
    // exactly this shape.
    //
    // A size of 0 is not "no constraint", it is "unknown", and an unknown extent cannot be
    // checked against a 16-byte overwrite. The guard previously tested `size != 0 && size < 16`,
    // which let every unknown-size symbol through -- the one case that cannot be verified at all.
    if (sym.size < 16) {
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
      // Default to the counter-only sweep observer; SPY overrides it through the wrapper above.
      hz_hook_observer chosen = g_exports_observer;
      if (chosen == nullptr) chosen = hz_sweep_observer;
      const hz::HookedFunction hooked = hz::hook_function_relayed_in_process(
          target, reinterpret_cast<hz::SlotObserver>(chosen),
          static_cast<std::uint32_t>(index));
      g_hooks[index].used = true;
      g_hooks[index].vtable = 0;
      g_hooks[index].slot = 0;
      g_hooks[index].original = target;
      g_hooks[index].relay = hooked.relay;
      g_hooks[index].is_function = true;
      g_hooks[index].saved_len = hooked.saved_len;
      for (std::uint32_t b = 0; b < hooked.saved_len && b < sizeof(g_hooks[index].saved); ++b) {
        g_hooks[index].saved[b] = hooked.saved[b];
      }
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
    g_hooks[index].is_function = true;
    g_hooks[index].saved_len = hooked.saved_len;
    for (std::uint32_t b = 0; b < hooked.saved_len && b < sizeof(g_hooks[index].saved); ++b) {
      g_hooks[index].saved[b] = hooked.saved[b];
    }
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
  // Dispatch on how the hook was installed, and let one failure not abort the rest.
  //
  // Two bugs met here. Every hook was undone as a vtable slot, so a function-entry hook carried
  // vtable == 0 into a check that throws; and this function is extern "C", so that exception had
  // no handler and became std::terminate. Net effect: install the export probe, then stop the
  // payload, and the client died. A stale hook is worth a diagnostic, not the host process.
  for (std::size_t i = 0; i < kMaxHooks; ++i) {
    if (!g_hooks[i].used) continue;
    try {
      if (g_hooks[i].is_function) {
        hz::HookedFunction hooked;
        hooked.target = g_hooks[i].original;
        hooked.relay = g_hooks[i].relay;
        hooked.saved_len = g_hooks[i].saved_len;
        for (std::uint32_t b = 0; b < g_hooks[i].saved_len && b < sizeof(hooked.saved); ++b) {
          hooked.saved[b] = g_hooks[i].saved[b];
        }
        hz::unhook_function_in_process(hooked);
      } else {
        hz::HookedSlot hooked;
        hooked.vtable = g_hooks[i].vtable;
        hooked.slot = g_hooks[i].slot;
        hooked.original = g_hooks[i].original;
        hooked.relay = g_hooks[i].relay;
        hz::unhook_vtable_slot_relayed_in_process(hooked);
      }
    } catch (const std::exception& e) {
      note("remove_all: hook %zu could not be undone: %s\n", i, e.what());
    } catch (...) {
      note("remove_all: hook %zu could not be undone\n", i);
    }
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

// Hooks a vtable slot addressed as (absolute vtable address, slot index).
//
// The existing installers find vtables by class name through RTTI, which is what the login and
// trunk hooks need because those classes are named in the binary. This one takes the address
// directly, because the send entry the reference payload uses has no name at all: it is slot 36
// of nt::MSFService, and neither the class nor its virtuals appear in .dynsym. The reference
// finds it the same way -- its own log prints "primary vtable off=0x87173e8 slots=44, slot 36".
//
// Returns the hook index, or a negative value on failure.
extern "C" int hz_hook_vtable_slot(std::uint64_t vtable_addr, std::uint32_t slot,
                                   hz_hook_observer observer) {
  if (vtable_addr == 0) {
    set_error("vtable address is null");
    return -1;
  }
  if (observer == nullptr) {
    set_error("observer is null");
    return -2;
  }
  std::size_t index = kMaxHooks;
  for (std::size_t i = 0; i < kMaxHooks; ++i) {
    if (!g_hooks[i].used) { index = i; break; }
  }
  if (index == kMaxHooks) {
    set_error("no free hook slot");
    return -3;
  }
  // Reading the slot first makes a wrong address fail here, with a message, instead of
  // installing a relay over whatever happened to be mapped there.
  const std::uint64_t original = hz::read_vtable_slot_live(vtable_addr, slot);
  if (original == 0) {
    set_error("slot is empty");
    return -4;
  }
  try {
    const hz::HookedSlot hooked = hz::hook_vtable_slot_relayed_in_process(
        vtable_addr, slot, reinterpret_cast<hz::SlotObserver>(observer));
    g_hooks[index].used = true;
    g_hooks[index].vtable = vtable_addr;
    g_hooks[index].slot = slot;
    g_hooks[index].original = original;
    g_hooks[index].relay = hooked.relay;
    g_hooks[index].is_function = false;
    g_hooks[index].saved_len = 0;
    note("slot: hooked vtable=0x%llx slot=%u original=0x%llx\n",
         (unsigned long long)vtable_addr, slot, (unsigned long long)original);
  } catch (const std::exception& e) {
    set_error(e.what());
    return -5;
  } catch (...) {
    set_error("unknown failure");
    return -6;
  }
  return static_cast<int>(index);
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
// Finds the hook whose entry patch is at `offset` inside wrapper.node, by resolving the module
// base the same way the installer does. Returns kMaxHooks when there is no such hook.
//
// Offsets rather than absolute addresses because the caller reasons in module terms --
// 0x137cf84 means the same thing in every process, while the live address changes per run.
std::size_t hook_index_of_offset(std::uint64_t offset) {
  std::uint64_t base = 0;
  {
    std::string ignored;
    base = find_wrapper_base(&ignored);
  }
  if (base == 0) return kMaxHooks;
  const std::uint64_t target = base + offset;
  for (std::size_t i = 0; i < kMaxHooks; ++i) {
    if (g_hooks[i].used && g_hooks[i].is_function && g_hooks[i].original == target) return i;
  }
  return kMaxHooks;
}

// The replay stub of an installed function hook: the address that runs the displaced prologue and
// then continues into the function, bypassing the entry jump.
//
// Read out of the relay state rather than recomputed, because the relay's own tail branch uses
// exactly this value -- so a caller forwarding through it and the hook's normal pass-through take
// the identical path. slot_relay.cc asserts that `original` sits at offset 8 of RelayState.
std::uint64_t hook_replay_stub(std::size_t index) {
  if (index >= kMaxHooks || !g_hooks[index].used || g_hooks[index].relay == 0) return 0;

  // The stub sits 64 bytes past the trampoline, not behind a pointer in the relay state.
  //
  // I first read `relay + 8`, on the assumption that the relay state lived there and that its
  // `original` field held the stub. It does not: slot_relay_install_function lays the page out as
  //   [ RelayState | trampoline (32 bytes) | 32 bytes padding | replay stub ]
  // and returns the trampoline's address. So `relay + 8` is inside the trampoline's own
  // instructions, and forwarding through it jumped to 0xd503201fd61f0140 -- the nop and br of the
  // trampoline read as a pointer. QQ died immediately; the log line before it looked plausible,
  // which is what made this worth spelling out.
  //
  // The layout is computed in slot_relay.cc as sizeof(RelayState) + 64 from the page base, and the
  // trampoline begins at sizeof(RelayState), so the offset between them is exactly 64.
  return g_hooks[index].relay + 64;
}

// Resolves `nt::wrapper::INTSessionShell::CreateNTSessionShell` and reports what it can without
// calling it.
//
// Kept in this translation unit because the ELF reader lives here; test/payload.cc has no access
// to hz::ElfImage. The address is the deliverable: whether [obj+0x30] is a send exit point can
// only be settled by constructing the shell, and that needs a live session, so calling blind
// would fault inside the client and destroy the very session being examined.
extern "C" int hz_find_create_session_shell(std::uint64_t* out_addr, std::uint64_t* out_base,
                                            std::uint32_t* out_words) {
  if (out_addr == nullptr || out_base == nullptr || out_words == nullptr) return -1;
  *out_addr = 0;
  *out_base = 0;
  std::string path;
  const std::uint64_t base = find_wrapper_base(&path);
  if (base == 0) return -2;
  *out_base = base;
  hz::ElfImage image(hz::MappedFile::open(path));
  const std::vector<hz::DynSymbol>& syms = image.symbols();
  const char* want =
      "_ZN2nt7wrapper15INTSessionShell20CreateNTSessionShellERKNSt2Cr12basic_stringIcNS2_"
      "11char_traitsIcEENS2_9allocatorIcEEEE";
  for (const hz::DynSymbol& sym : syms) {
    if (sym.name != want) continue;
    {
      const std::uint64_t at = base + sym.value;
      *out_addr = at;
      const std::uint32_t* w = reinterpret_cast<const std::uint32_t*>(at);
      out_words[0] = w[0];
      out_words[1] = w[1];
      out_words[2] = w[2];
      out_words[3] = w[3];
      return 0;
    }
  }
  return -3;
}
