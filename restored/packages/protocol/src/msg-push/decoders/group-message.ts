// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/msg-push/decoders/group-message.ts"
// original bundle lines 153789-153820  (30 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var decodeGroupMessage = (ctx) => {
	const ev = {
		kind: "group_message",
		time: ctx.head.timestamp,
		selfUin: ctx.selfUin,
		senderUin: ctx.fromUin,
		msgSeq: ctx.head.sequence,
		msgId: ctx.head.msgId & 2147483647,
		elements: decodeRichBody(ctx.body, true),
		groupId: 0,
		groupName: "",
		senderNick: "",
		senderCard: "",
		senderRole: ""
	};
	const grp = ctx.responseHead?.grp;
	if (grp) {
		ev.groupId = grp.groupUin ?? 0;
		ev.senderNick = grp.memberName ?? "";
	}
	const member = ctx.identity.findGroupMember(ev.groupId, ctx.fromUin);
	if (member) {
		if (!ev.senderNick) ev.senderNick = member.nickname;
		ev.senderCard = member.card;
		ev.senderRole = member.role;
		if (grp?.memberCard && grp.memberCard !== ev.senderNick) ev.senderCard = grp.memberCard;
	} else if (!ev.senderNick && grp?.memberCard) ev.senderNick = grp.memberCard;
	ev.groupName = grp?.groupName || ctx.identity.findGroup?.(ev.groupId)?.groupName || "";
	return [ev];
};
export {};
