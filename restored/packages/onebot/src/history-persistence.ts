// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/history-persistence.ts"
// original bundle lines 37738-37782  (43 lines) of dist/index.mjs
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
* Persist a converted server-history event without dispatching it.
*
* Private history needs the conversation peer explicitly because `user_id`
* names the sender and therefore equals the bot account on outgoing messages.
*/
async function persistHistoryEvent(store, event, privatePeerId, source) {
	const messageId = toHistoryInt(event.message_id);
	if (!Number.isSafeInteger(messageId) || messageId === 0) throw new Error(`history event has invalid message_id ${String(event.message_id)}`);
	if (event.message_type !== "group" && event.message_type !== "private") throw new Error(`history event has invalid message_type ${String(event.message_type)}`);
	const isGroup = event.message_type === "group";
	const sessionId = isGroup ? toHistoryInt(event.group_id) : privatePeerId && privatePeerId > 0 ? privatePeerId : toHistoryInt(event.user_id);
	const messageSequence = toHistoryInt(event.message_seq);
	const sequence = source?.ntMsgSeq ?? messageSequence;
	if (!Number.isSafeInteger(sessionId) || sessionId <= 0) throw new Error(`history event has invalid session id ${String(sessionId)}`);
	if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error(`history event has invalid sequence ${String(sequence)}`);
	const sequenceAuthoritative = source?.sequenceAuthoritative !== false && sequence > 0;
	const isOutgoingPrivate = !isGroup && source?.senderUin === source?.selfUin;
	const eventName = isGroup ? GROUP_MESSAGE_EVENT : source ? privateMessageEventName(isOutgoingPrivate, sequenceAuthoritative) : privateMessageEventName(event.post_type === "message_sent", false);
	const meta = !isGroup && source ? {
		isGroup: false,
		targetId: sessionId,
		sequence,
		sequenceAuthoritative,
		eventName,
		clientSequence: source.clientSeq ?? source.msgSeq,
		privateDirection: source.senderUin === source.selfUin ? "outgoing" : "incoming",
		random: source.msgId,
		timestamp: source.time
	} : void 0;
	return store.storeHistoryEvent(messageId, isGroup, sessionId, sequence, eventName, event, {
		sequenceAuthoritative,
		meta
	});
}
function toHistoryInt(value) {
	if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === "string" && value.trim()) {
		const number = Number(value);
		if (Number.isFinite(number)) return Math.trunc(number);
	}
	return 0;
}
export {};
