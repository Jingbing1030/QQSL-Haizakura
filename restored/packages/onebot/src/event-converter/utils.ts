// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/event-converter/utils.ts"
// original bundle lines 21674-21697  (22 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function isSameActor(leftUin, leftUid, rightUin, rightUid) {
	if (leftUin > 0 && rightUin > 0) return leftUin === rightUin;
	return Boolean(leftUid) && leftUid === rightUid;
}
async function applyMessageIdResolver(resolver, isGroup, sessionId, sequence, eventName, timestamp) {
	if (resolver) {
		const resolved = await resolver(isGroup, sessionId, sequence, eventName, timestamp);
		if (Number.isInteger(resolved) && resolved !== 0) return resolved;
	}
	const seq = Math.trunc(sequence);
	return seq === 0 ? 0 : seq;
}
async function resolveReplyId(isGroup, sessionId, sequence, resolver, eventName = isGroup ? GROUP_MESSAGE_EVENT : PRIVATE_MESSAGE_EVENT, timestamp, replyElements, excludedMessage) {
	const seq = Math.trunc(sequence);
	if (seq === 0) return 0;
	if (resolver) {
		const resolved = await resolver(isGroup, sessionId, seq, eventName, timestamp, replyElements, excludedMessage);
		if (Number.isInteger(resolved)) return resolved;
		throw new Error("reply resolver returned an invalid message id");
	}
	return seq;
}
export {};
