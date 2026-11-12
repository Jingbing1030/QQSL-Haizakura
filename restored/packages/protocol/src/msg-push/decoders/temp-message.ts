// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/msg-push/decoders/temp-message.ts"
// original bundle lines 153821-153848  (26 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var decodeTempMessage = (ctx) => {
	const sequenceAuthoritative = ctx.head.ntMsgSeq > 0;
	const ev = {
		kind: "temp_message",
		time: ctx.head.timestamp,
		selfUin: ctx.selfUin,
		senderUin: ctx.fromUin,
		msgSeq: ctx.head.sequence,
		ntMsgSeq: ctx.head.ntMsgSeq,
		clientSeq: ctx.head.sequence,
		sequenceAuthoritative,
		elements: decodeRichBody(ctx.body, false),
		groupId: 0,
		senderNick: ""
	};
	if (ctx.responseHead?.grp) {
		ev.groupId = ctx.responseHead.grp.groupUin ?? 0;
		ev.senderNick = ctx.responseHead.grp.memberName ?? "";
	}
	if (ctx.responseHead?.forward?.tempGroupUin) ev.groupId = ctx.responseHead.forward.tempGroupUin;
	if (!ev.senderNick) {
		const friend = ctx.identity.findFriend(ctx.fromUin);
		if (friend) ev.senderNick = friend.nickname;
	}
	return [ev];
};
export {};
