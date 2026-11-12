// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/event-converter/to-message.ts"
// original bundle lines 23050-23128  (77 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function toSegments(ctx, elements, isGroup, sessionId) {
	return elementsToOneBotSegments(ctx, elements, isGroup, sessionId);
}
/**
* friend_message and temp_message differ only in `sub_type` ('friend' vs
* 'group'). Friend messages use their conversation peer as the session key,
* which differs from senderUin on a self-sent echo.
*/
async function convertPrivateMessage(ctx, event, subType) {
	const isSelf = event.senderUin === ctx.selfId;
	const postType = isSelf ? "message_sent" : "message";
	const sessionId = event.kind === "friend_message" && event.peerUin && event.peerUin > 0 ? event.peerUin : event.senderUin;
	const ntSequence = event.kind === "friend_message" ? event.ntMsgSeq ?? 0 : 0;
	const hasCanonicalNtSequence = ntSequence > 0 && event.sequenceAuthoritative !== false;
	const messageIdSequence = hasCanonicalNtSequence ? ntSequence : event.msgSeq;
	const eventName = event.kind === "friend_message" ? privateMessageEventName(isSelf, hasCanonicalNtSequence) : PRIVATE_MESSAGE_EVENT;
	const messageId = await applyMessageIdResolver(ctx.messageIdResolver, false, sessionId, messageIdSequence, eventName);
	const segments = await elementsToOneBotSegments(ctx, event.elements, false, sessionId, { currentMessage: {
		id: messageId,
		sequence: hasCanonicalNtSequence ? ntSequence : 0,
		clientSequence: event.kind === "friend_message" ? event.clientSeq ?? event.msgSeq : event.msgSeq,
		timestamp: event.time,
		sentBySelf: isSelf
	} });
	const sender = {
		user_id: event.senderUin,
		nickname: event.senderNick,
		sex: "unknown",
		age: 0
	};
	if (subType === "group" && "groupId" in event && event.groupId > 0) sender.group_id = event.groupId;
	const fields = {
		message_type: "private",
		sub_type: subType,
		message_id: messageId,
		message_seq: event.msgSeq,
		user_id: event.senderUin,
		message: segments,
		raw_message: segmentsToRawMessage(segments),
		font: 0,
		sender
	};
	if (isSelf && sessionId > 0 && sessionId !== ctx.selfId) fields.target_id = sessionId;
	return message(ctx, event, postType, fields);
}
function convertFriendMessage(ctx, event) {
	return convertPrivateMessage(ctx, event, "friend");
}
function convertTempMessage(ctx, event) {
	return convertPrivateMessage(ctx, event, "group");
}
async function convertGroupMessage(ctx, event) {
	const postType = event.senderUin === ctx.selfId ? "message_sent" : "message";
	const messageId = await applyMessageIdResolver(ctx.messageIdResolver, true, event.groupId, event.msgSeq, GROUP_MESSAGE_EVENT);
	const segments = await toSegments(ctx, event.elements, true, event.groupId);
	return message(ctx, event, postType, {
		message_type: "group",
		sub_type: "normal",
		message_id: messageId,
		message_seq: event.msgSeq,
		group_id: event.groupId,
		group_name: event.groupName,
		user_id: event.senderUin,
		message: segments,
		raw_message: segmentsToRawMessage(segments),
		font: 0,
		sender: {
			user_id: event.senderUin,
			nickname: event.senderNick,
			card: event.senderCard,
			role: event.senderRole || "member",
			sex: "unknown",
			age: 0
		},
		anonymous: null
	});
}
export {};
