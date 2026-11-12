// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/hook-status.ts"
// original bundle lines 3704-3719  (14 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/**
* Single source of truth for the five *settled* HookProcessStatus values
* — `available` / `connecting` / `loaded` / `online` / `disconnected`.
*
* Pure: status is a function of the flags alone. The two *out-of-band*
* states `loading` (injection in flight) and `error` (carries a message)
* are set explicitly by HookSession and are deliberately NOT derivable
* here.
*/
function statusFor(flags) {
	if (!flags.injected) return "available";
	if (flags.connected) return flags.loggedIn ? "online" : "loaded";
	return flags.wasLoggedIn ? "disconnected" : "connecting";
}
export {};
