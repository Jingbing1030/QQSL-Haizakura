// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/request-context.ts"
// original bundle lines 1390-1424  (33 lines) of dist/index.mjs
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
* Allocate the next per-process request id (monotonic). Wraps via uint32 so
* it never overflows to a non-integer; `0` is skipped so "no id" stays
* unambiguous.
*/
function nextRequestId() {
	counter = counter + 1 >>> 0;
	if (counter === 0) counter = 1;
	return counter;
}
/**
* Run `fn` with `id` bound as the ambient request id for the entire async
* chain it spawns. Any logger call anywhere in that chain — across packages,
* across awaits — picks it up via {@link currentRequestId} with no signature
* threading. Used by the OneBot action handler to correlate a request's whole
* journey (entry → outbound packets → exit) under one `[req#N]` tag.
*/
function runWithRequestId(id, fn) {
	return storage.run({ id }, fn);
}
/** Run `fn` without inheriting an ambient request id. */
function runWithoutRequestContext(fn) {
	return storage.run(void 0, fn);
}
/** The request id bound to the current async context, or undefined outside one. */
function currentRequestId() {
	return storage.getStore()?.id;
}
var storage, counter;
var init_request_context = __esmMin((() => {
	storage = new AsyncLocalStorage();
	counter = 0;
}));
export {};
