// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/msg-push/index.ts"
// original bundle lines 177027-177139  (111 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
init_logger();
var MSG_PUSH_CMD = "trpc.msg.olpush.OlPushService.MsgPush";
var registry = new MsgPushRegistry();
registry.register(PkgType.GroupMemberIncreaseNotice, decodeGroupMemberJoin);
registry.register(PkgType.GroupMemberDecreaseNotice, decodeGroupMemberLeave);
registry.register(PkgType.GroupSelfJoinedNotice, decodeGroupSelfJoined);
registry.register(PkgType.GroupAdminChangedNotice, decodeGroupAdmin);
registry.register(PkgType.GroupRequestJoinNotice, decodeGroupJoinRequest);
registry.register(PkgType.GroupRequestInvitationNotice, decodeGroupInvitation);
registry.register(PkgType.GroupInviteNotice, decodeGroupInvite);
registry.register(PkgType.Event0x210, decodeEvent0x210);
registry.register(PkgType.Event0x2DC, decodeEvent0x2DC);
registry.register(PkgType.GroupMessage, decodeGroupMessage);
registry.register(PkgType.TempMessage, decodeTempMessage);
registry.register([
	PkgType.PrivateMessage,
	PkgType.ForwardFakePrivateMessage,
	PkgType.PrivateRecordMessage,
	PkgType.PrivateFileMessage
], decodeFriendMessage);
var log$36 = createLogger("MsgPush");
function messageElements(ev) {
	if (ev.kind === "friend_message" || ev.kind === "group_message" || ev.kind === "temp_message") return ev.elements;
}
function warnMissingC2cSequence(ev, fromUin) {
	if ((ev.kind === "friend_message" || ev.kind === "temp_message") && ev.sequenceAuthoritative === false) log$36.warn("c2c message omitted NT sequence; keeping non-authoritative client sequence (kind=%s from=%d clientSeq=%d time=%d)", ev.kind, fromUin, ev.clientSeq ?? ev.msgSeq, ev.time);
}
function parseMsgPush(pkt, identity, dedup) {
	return parseMsgPushInternal(pkt, identity, dedup, false);
}
function parseMsgPushOrThrow(pkt, identity, dedup) {
	return parseMsgPushInternal(pkt, identity, dedup, true);
}
function parseMsgPushInternal(pkt, identity, dedup, throwDecoderErrors) {
	const ctx = buildContext(pkt, identity);
	if (!ctx) {
		log$36.trace(() => [
			"packet_branch serviceCmd=%j seqId=%d branch=push_context_invalid",
			pkt.serviceCmd,
			pkt.seqId
		]);
		return [];
	}
	if (dedup) {
		const dedupIdentity = deriveSysMsgDedupIdentity(ctx);
		if (dedupIdentity && dedup.seenDuplicate(dedupIdentity)) {
			log$36.trace(() => [
				"packet_branch serviceCmd=%j seqId=%d branch=duplicate_system_push peer=%j chatType=%d messageSeq=%d messageRandom=%d",
				pkt.serviceCmd,
				pkt.seqId,
				dedupIdentity.peerUid,
				dedupIdentity.chatType,
				dedupIdentity.sequence,
				dedupIdentity.random
			]);
			log$36.debug("dropped duplicate system push (peer=%s chatType=%d seq=%d msgType=%d/%d msgId=%d)", dedupIdentity.peerUid, dedupIdentity.chatType, ctx.head.sequence, ctx.head.msgType, ctx.head.subType, ctx.head.msgId);
			return [];
		}
	}
	return (throwDecoderErrors ? registry.decodeOrThrow(ctx) : registry.decode(ctx)).filter((ev) => {
		const elements = messageElements(ev);
		if (elements === void 0) return true;
		const survival = classifyMessageSurvival(ctx.head, elements, ctx.body);
		if (survival === "drop-control") {
			log$36.trace(() => [
				"packet_branch serviceCmd=%j seqId=%d branch=c2c_control_push msgType=%d subType=%d c2cCmd=%d messageSeq=%d",
				pkt.serviceCmd,
				pkt.seqId,
				ctx.head.msgType,
				ctx.head.subType,
				ctx.head.c2cCmd,
				ctx.head.sequence
			]);
			if (elements.length > 0) log$36.debug("dropped c2c control push that carried %d element(s) (kind=%s seq=%d from=%d msgType=%d cmd=%d)", elements.length, ev.kind, ctx.head.sequence, ctx.fromUin, ctx.head.msgType, ctx.head.c2cCmd);
			return false;
		}
		if (survival === "drop-receipt") {
			log$36.trace(() => [
				"packet_branch serviceCmd=%j seqId=%d branch=offline_file_receipt msgType=%d subType=%d messageSeq=%d",
				pkt.serviceCmd,
				pkt.seqId,
				ctx.head.msgType,
				ctx.head.subType,
				ctx.head.sequence
			]);
			log$36.debug("dropped offline file receipt (kind=%s seq=%d from=%d msgType=%d)", ev.kind, ctx.head.sequence, ctx.fromUin, ctx.head.msgType);
			return false;
		}
		if (survival === "drop-blank") {
			log$36.trace(() => [
				"packet_branch serviceCmd=%j seqId=%d branch=empty_message msgType=%d subType=%d messageSeq=%d",
				pkt.serviceCmd,
				pkt.seqId,
				ctx.head.msgType,
				ctx.head.subType,
				ctx.head.sequence
			]);
			return false;
		}
		if (survival === "keep-undecoded") warnUndecodedMessage({
			kind: ev.kind,
			sequence: ctx.head.sequence,
			fromUin: ctx.fromUin,
			msgType: ctx.head.msgType,
			subType: ctx.head.subType,
			body: ctx.body
		});
		warnMissingC2cSequence(ev, ctx.fromUin);
		return true;
	});
}
export {};
