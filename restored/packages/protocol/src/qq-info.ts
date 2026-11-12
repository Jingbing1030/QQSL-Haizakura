// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/qq-info.ts"
// original bundle lines 11177-11194  (16 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** Invitations handled by the invited account, rather than a group administrator.
* Notification types 1 and 2 use different approval discriminators. */
function isSelfGroupInvitation(request) {
	return request.eventType === 2 || request.eventType === 10;
}
/** Canonical SnowLuma group-request flag (version 1). */
function formatGroupRequestFlag(handle) {
	return [
		"slreq",
		"1",
		handle.sequence,
		handle.groupId,
		handle.eventType,
		handle.filtered ? 1 : 0
	].join(":");
}
export {};
