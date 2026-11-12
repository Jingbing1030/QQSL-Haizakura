// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/types.ts"
// original bundle lines 6905-6931  (25 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** True only when a stored sequence can safely be sent back to QQ. */
function hasAuthoritativeSequence(meta) {
	return meta?.sequenceAuthoritative === true && Number.isInteger(meta.sequence) && meta.sequence > 0;
}
var RETCODE = {
	ACTION_FAILED: 100,
	INTERNAL_ERROR: 1200,
	BAD_REQUEST: 1400,
	UNKNOWN_ACTION: 1404
};
function okResponse(data = null) {
	return {
		status: "ok",
		retcode: 0,
		data
	};
}
function failedResponse(retcode, wording) {
	return {
		status: "failed",
		retcode,
		data: null,
		wording
	};
}
export {};
