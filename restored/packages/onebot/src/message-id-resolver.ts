// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/message-id-resolver.ts"
// original bundle lines 41253-41261  (7 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function createMessageIdResolver(store) {
	return async (isGroup, sessionId, sequence, eventName, timestamp, replyElements, excludedMessage) => {
		const resolvedEventName = eventName || (isGroup ? "group_message" : "private_message");
		if (!isGroup && timestamp !== void 0 && (resolvedEventName === "private_message" || resolvedEventName === "private_message_sent")) return await store.resolvePrivateReplyMessageId(sessionId, sequence, resolvedEventName === "private_message_sent", timestamp, replyElements, excludedMessage) ?? 0;
		return hashMessageIdInt32(sequence, sessionId, resolvedEventName === "private_message_sent" ? PRIVATE_NT_MESSAGE_EVENT : resolvedEventName);
	};
}
export {};
