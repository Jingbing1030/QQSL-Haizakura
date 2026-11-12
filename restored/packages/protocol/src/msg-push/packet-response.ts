// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/msg-push/packet-response.ts"
// original bundle lines 153968-153974  (5 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function requirePacketResponse(result, command) {
	if (!result.success) throw new Error(`${command} transport failed: ${result.errorMessage || "unknown transport error"}`);
	if (!result.gotResponse || !result.responseData || result.responseData.length === 0) throw new Error(`${command} response is empty`);
	return result.responseData;
}
export {};
