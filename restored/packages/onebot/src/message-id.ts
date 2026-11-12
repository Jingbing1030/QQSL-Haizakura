// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/message-id.ts"
// original bundle lines 11245-11262  (16 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var GROUP_MESSAGE_EVENT = "group_message";
var PRIVATE_MESSAGE_EVENT = "private_message";
/** Legacy/fallback namespace for private messages sent by the current account. */
var PRIVATE_SENT_MESSAGE_EVENT = "private_message_sent";
/** Namespace for private messages keyed by QQ's conversation-wide NT sequence. */
var PRIVATE_NT_MESSAGE_EVENT = "private_message_nt";
function privateMessageEventName(sentBySelf, hasNtSequence) {
	if (hasNtSequence) return PRIVATE_NT_MESSAGE_EVENT;
	return sentBySelf ? PRIVATE_SENT_MESSAGE_EVENT : PRIVATE_MESSAGE_EVENT;
}
function hashMessageIdInt32(sequence, sessionId, eventName) {
	const key = `${Number.isFinite(sequence) ? Math.trunc(sequence) : 0}:${Number.isFinite(sessionId) ? Math.trunc(sessionId) : 0}:${eventName}`;
	let id = createHash("sha1").update(key).digest().readInt32BE(0);
	if (id === 0) id = 1;
	return id;
}
export {};
