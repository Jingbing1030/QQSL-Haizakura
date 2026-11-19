// C interface to the payload's hook installation.
//
// Declared in a header with no C++ in it, because the caller is payload.cc: plain C, no
// STL, no exceptions, no RTTI.  The implementation lives in payload_hook.cc, which does
// use all three -- see the comment there for why the split exists rather than rewriting
// the engine.
#ifndef HZ_PAYLOAD_HOOK_H
#define HZ_PAYLOAD_HOOK_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Called from the relay, on the thread that made the vtable call, before it is forwarded.
// Must not block and must not allocate: the relay restores the register state immediately
// afterwards, so anything it writes to registers is discarded, and the callee is waiting.
typedef void (*hz_hook_observer)(uint32_t slot, uint64_t original);

// Installs the login observer on wrapper.node's login vtable.
//
// Returns 0 on success.  On failure the payload is expected to carry on serving the wire
// protocol without the login signal: a payload that refused to start because one hook did
// not resolve would be strictly worse than one that reports "not logged in" honestly.
// The reason is available from hz_hook_last_error().
int hz_hook_install_login_observer(hz_hook_observer observer);

// Removes every hook this module installed.  Idempotent, and safe when none are installed:
// QQ reloads wrapper.node on some updates, and a hook that cannot be undone cannot be
// re-established.
void hz_hook_remove_all(void);

// Number of hooks currently installed, for the wire protocol and for a test asserting
// that unload left nothing behind.
int hz_hook_count(void);

// How many times the hook at `index` has actually been entered by the target.
//
// The number that distinguishes a hook that is installed but never reached from one whose
// observer is broken. Zero is a finding, not a failure: it says the target does not call this
// slot, which is what happened with the QR login slot on a saved-account sign-in.
unsigned long long hz_hook_hits(int index);

// Hooks `slots_to_try` slots on every nt::login class's primary vtable, returning how many were
// installed. The point is to let the entry counter identify which slot a real sign-in reaches:
// static analysis shows where a class's slots are, not which class the login flow traverses.
int hz_hook_sweep_login_classes(int slots_to_try);

// Hooks MSF::MSFSDK::notifyLoginSuccess, the exported notification the application calls.
//
// This is the siting that the vtable work missed: the export has no callers inside wrapper.node
// and no vtable slot, so a slot sweep could not reach it however many slots were covered.
int hz_hook_export_login_observer(hz_hook_observer observer);

// Hooks every exported function whose mangled name contains `needle`, up to `max_hooks`.
//
// For locating a live entry point by measurement instead of by guess: several specific
// candidates were each verified installed and each recorded zero entries through a real
// sign-in, so the useful next step is to cover the whole plausible family at once and read the
// per-hook counters.
int hz_hook_exports_matching(const char* needle, int max_hooks);

// Hooks every exported function large enough to patch, reporting each first entry by name.
//
// For locating a live entry point without deciding in advance which one it is, after five named
// candidates each recorded zero calls through a real sign-in.
int hz_hook_all_exports(std::size_t max_hooks);

// What a sweep installed, by index: the class name and the slot number.
const char* hz_hook_class_name(int index);
int hz_hook_slot_of(int index);

// The uin of the logged-in account, or 0 when it is not yet known.
//
// Returns 0 rather than a placeholder: the uin's location in wrapper.node's state is not
// yet established, and an invented number would be indistinguishable from truth at the
// receiving end of the socket.
long long hz_hook_login_uin(void);

// Text of the last installation failure, or "" when the last call succeeded.
const char* hz_hook_last_error(void);

// Base address wrapper.node was mapped at when the hook was installed, or 0 before that.
uint64_t hz_hook_module_base(void);

#ifdef __cplusplus
}
#endif

#endif  // HZ_PAYLOAD_HOOK_H