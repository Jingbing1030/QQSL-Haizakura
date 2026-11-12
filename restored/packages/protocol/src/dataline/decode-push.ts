// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/dataline/decode-push.ts"
// original bundle lines 151566-151606  (39 lines) of dist/index.mjs
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
* Incoming my-device chats reuse the private-file push type but carry a
* different body. Rewrite the conversation peer onto the matching device
* contact — both sides of the wire use the logged-in account number.
*/
function tryDecodeDatalineFriendMessage(ctx) {
	if (ctx.head.msgType !== 529 || ctx.head.subType !== 7) return null;
	const raw = ctx.body?.msgContent;
	if (!raw || raw.length === 0) return null;
	const body = decodeDatalineMsgBody(raw);
	if (!body) return null;
	if (body.subCmd == null && !body.header && !body.generic && !(body.ftn && body.ftn.length > 0)) return null;
	const elements = elementsFromDatalineBody(body);
	const srcTer = body.header?.srcTerType ?? 0;
	const dstTer = body.header?.dstTerType ?? 0;
	const sentBySelf = srcTer === 1;
	const peer = findDatalineDeviceByTerType(peerTerType(srcTer, dstTer));
	const sequenceAuthoritative = ctx.head.ntMsgSeq > 0;
	return {
		kind: "friend_message",
		time: ctx.head.timestamp,
		selfUin: ctx.selfUin,
		senderUin: sentBySelf ? ctx.selfUin : peer?.uin ?? ctx.fromUin,
		senderUid: sentBySelf ? ctx.fromUid : peer?.uid ?? ctx.fromUid,
		...peer ? { peerUin: peer.uin } : {},
		msgSeq: ctx.head.sequence,
		ntMsgSeq: ctx.head.ntMsgSeq,
		clientSeq: ctx.head.sequence,
		sequenceAuthoritative,
		msgId: ctx.head.msgId & 2147483647,
		elements,
		senderNick: sentBySelf ? "" : peer?.name ?? ""
	};
}
function peerTerType(srcTer, dstTer) {
	if (srcTer !== 1 && srcTer > 0) return srcTer;
	if (dstTer !== 1 && dstTer > 0) return dstTer;
	return dstTer || srcTer || 1;
}
export {};
