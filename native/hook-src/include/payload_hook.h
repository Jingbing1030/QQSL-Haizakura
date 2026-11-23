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
// Called on every entry to a hooked slot, before the original runs.
//
// The four register arguments are what the call carried in x0..x3 (aArch64) or rdi/rsi/rdx/rcx
// on x64. They exist so a probe can report *what* a call was, not just that it happened: the
// MSF send path hands its request object in x0, and a slot counter alone cannot say which
// service command was being sent. Reading a pointer argument is safe; dereferencing one is the
// observer's responsibility and may fault if the call has not finished constructing it.
//
// Return value must stay void: the relay restores the integer and vector registers itself, so an
// observer influences the call only by writing through `frame`, never by returning.
//
// `frame` points at the relay's save area and was added for the send injector. It is the only way
// to change what the target receives, which is the whole mechanism: QQ's own send function is in
// continuous use as the heartbeat channel, so it cannot be called from outside (that re-enters it
// and kills the client) and instead has its arguments rewritten while QQ is already inside it.
// `frame[1]` is x1's slot and `frame[3]` is x3's. An observer that does not need this ignores a
// seventh argument, which costs nothing in the C ABI.
// Post-call callback: receives the return value's first word and the argument frame, after the
// hooked function has returned. Used to observe what a callee produced -- a reply written into an
// `out` argument, for instance -- which does not exist at entry time.
typedef void (*hz_hook_after)(uint64_t result, uint64_t* frame);

// Registers (or with 0 removes) a post-call callback on an installed hook, by the index
// hz_hook_function_offset returned.
int hz_hook_set_after(unsigned idx, hz_hook_after after);

// The relay address behind a hook index, for diagnostics. 0 when absent.
uint64_t hz_hook_relay_of_return(unsigned idx);

typedef void (*hz_hook_observer)(uint32_t slot, uint64_t original, uint64_t a0, uint64_t a1,
                                 uint64_t a2, uint64_t a3, uint64_t* frame);

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

// Same, with an explicit observer so the caller can see what each call carried.
int hz_hook_exports_matching_with(const char* needle, int max_hooks, hz_hook_observer observer);

// Hooks one exactly-named symbol inside any module already mapped in the process.
//
// Needed because the send boundary is not inside wrapper.node: instrumenting every export there
// produced zero entries during a real send. libc owns write() and send(), and QQ's own binary is
// a separate mapping, so the module has to be selectable.
//
// Exact name, not prefix: "send" also matches sendto/sendmsg/sendmmsg, and patching all of them
// during a live send is a reliable way to hang the client. Returns 0 on success, negative on
// failure; the reason is available from hz_hook_last_error().
int hz_hook_library_symbol(const char* module, const char* symbol, hz_hook_observer observer);

// Load base of the first mapping whose path contains `module`, or 0.
std::uint64_t hz_hook_find_module_base(const char* module);

// Hooks a function by its offset inside wrapper.node.
//
// The fallback that still works when vtable patching does not. A vtable is an object the client
// duplicates at construction, so patching the template changes nothing that actually runs -- the
// copies on the heap are what get called. A function is a fixed address in .text that every
// caller reaches the same way, copies included.
int hz_hook_function_offset(std::uint64_t offset, hz_hook_observer observer);

// Hooks a vtable slot addressed directly, for classes whose virtuals have no dynamic symbol.
// Returns the hook index, or negative on failure.
int hz_hook_vtable_slot(uint64_t vtable_addr, uint32_t slot, hz_hook_observer observer);

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

// See payload_hook.cc: resolves CreateNTSessionShell without calling it.
#ifdef __cplusplus
extern "C" {
#endif
int hz_find_create_session_shell(std::uint64_t* out_addr, std::uint64_t* out_base,
                                 std::uint32_t* out_words);
#ifdef __cplusplus
}
#endif
