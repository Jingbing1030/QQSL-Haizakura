// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/event-pipeline.ts"
// original bundle lines 39098-39316  (217 lines) of dist/index.mjs
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
init_log_summary();
var moduleLog$8 = createLogger("Event");
function registerEventPipeline(ctx) {
	const uinNum = Number.parseInt(ctx.uin, 10);
	const log = Number.isFinite(uinNum) && uinNum > 0 ? moduleLog$8.child({ uin: uinNum }) : moduleLog$8;
	const disposers = [];
	const inFlight = /* @__PURE__ */ new Set();
	let accepting = true;
	const track = (event, start) => {
		if (!accepting) return Promise.resolve();
		return runWithTraceRequest(() => {
			const state = {
				startedAt: Date.now(),
				handedOff: false,
				terminalEmitted: false
			};
			log.trace(() => [
				"event_input kind=%s event=%s",
				event.kind,
				renderParamsVerbose(event)
			]);
			let operation;
			try {
				operation = Promise.resolve(start(state));
			} catch (error) {
				operation = Promise.reject(error);
			}
			const tracked = operation.then(() => void 0, (error) => {
				if (!state.handedOff && !state.terminalEmitted) traceEventTerminal(log, event.kind, state, "failed", "pipeline_threw", error);
				log.error("event pipeline handler failed kind=%s: %s", event.kind, error instanceof Error ? error.stack ?? error.message : String(error));
			});
			inFlight.add(tracked);
			tracked.then(() => {
				inFlight.delete(tracked);
			});
			return tracked;
		});
	};
	for (const kind of Object.keys(EVENT_PIPELINE)) {
		const entry = EVENT_PIPELINE[kind];
		if ("drop" in entry) continue;
		const handle = entry.handle;
		disposers.push(ctx.bridge.events.on(kind, (event) => track(event, (state) => handle(ctx, log, event, state))));
	}
	const stop = () => {
		if (!accepting) return;
		accepting = false;
		for (const dispose of disposers) try {
			dispose();
		} catch (error) {
			log.error("event pipeline unsubscribe failed: %s", error instanceof Error ? error.stack ?? error.message : String(error));
		}
	};
	return {
		stop,
		async drain() {
			if (accepting) throw new Error("event pipeline must be stopped before it can be drained");
			await Promise.allSettled([...inFlight]);
		}
	};
}
async function convertAndDispatch(ctx, log, event, state, messageIdOverride) {
	let preparedEvent = event;
	if (event.kind === "friend_message" && await isFriendMessageRecalled(ctx, log, event)) {
		traceEventTerminal(log, event.kind, state, "dropped", "recalled_before_backfill");
		return;
	}
	try {
		preparedEvent = await backfillReplyTarget(ctx, event);
	} catch (error) {
		log.warn("reply backfill failed kind=%s: %s", event.kind, error instanceof Error ? error.stack ?? error.message : String(error));
		log.trace(() => [
			"event_branch kind=%s reason=reply_backfill_failed error=%s",
			event.kind,
			error instanceof Error ? error.stack ?? error.message : String(error)
		]);
	}
	let converted;
	try {
		converted = await convertEvent(ctx.converterCtx, preparedEvent);
	} catch (error) {
		traceEventTerminal(log, event.kind, state, "failed", "converter_threw", error);
		throw error;
	}
	if (!converted) {
		traceEventTerminal(log, event.kind, state, "dropped", "converter_returned_null");
		return;
	}
	if (messageIdOverride !== void 0 && event.kind === "friend_recall") converted.message_id = messageIdOverride;
	log.trace(() => [
		"event_converted kind=%s event=%s",
		event.kind,
		renderParamsVerbose(converted)
	]);
	if (event.kind === "friend_message" && await isFriendMessageRecalled(ctx, log, event)) {
		traceEventTerminal(log, event.kind, state, "dropped", "recalled_after_backfill");
		return;
	}
	await ctx.dispatchEvent(converted, "bridge", state.startedAt);
	state.handedOff = true;
}
function traceEventTerminal(log, kind, state, outcome, reason, error) {
	if (state.terminalEmitted) return;
	state.terminalEmitted = true;
	log.trace(() => [
		"event_terminal kind=%s outcome=%s reason=%s ms=%d%s",
		kind,
		outcome,
		reason,
		Date.now() - state.startedAt,
		error === void 0 ? "" : ` error=${error instanceof Error ? error.stack ?? error.message : String(error)}`
	]);
}
async function cacheGroupMessageMeta(ctx, event) {
	const messageId = hashMessageIdInt32(event.msgSeq, event.groupId, GROUP_MESSAGE_EVENT);
	await ctx.cacheMessageMeta(messageId, {
		isGroup: true,
		targetId: event.groupId,
		sequence: event.msgSeq,
		sequenceAuthoritative: true,
		eventName: GROUP_MESSAGE_EVENT,
		clientSequence: 0,
		random: event.msgId,
		timestamp: event.time
	});
}
async function cachePrivateMessageMeta(ctx, sessionId, messageSequence, serverSequence, clientSequence, timestamp, random, sequenceAuthoritative, privateDirection) {
	const isFriendMessage = privateDirection !== void 0;
	const hasNtSequence = isFriendMessage && sequenceAuthoritative && serverSequence > 0;
	const eventName = isFriendMessage ? privateMessageEventName(privateDirection === "outgoing", hasNtSequence) : PRIVATE_MESSAGE_EVENT;
	const messageId = hashMessageIdInt32(hasNtSequence ? serverSequence : messageSequence, sessionId, eventName);
	await ctx.cacheMessageMeta(messageId, {
		isGroup: false,
		targetId: sessionId,
		sequence: serverSequence,
		sequenceAuthoritative: sequenceAuthoritative && serverSequence > 0,
		eventName,
		clientSequence,
		privateDirection,
		random,
		timestamp
	});
}
async function isFriendMessageRecalled(ctx, log, event) {
	const peerUin = event.peerUin ?? event.senderUin;
	const clientSequence = event.clientSeq ?? event.msgSeq;
	const sentBySelf = event.senderUin === ctx.selfId;
	const recalled = await ctx.messageStore.isPrivateMessageRecalled(peerUin, clientSequence, sentBySelf, event.time);
	if (recalled) log.debug("friend message suppressed by recall tombstone peer=%d clientSeq=%d self=%s", peerUin, clientSequence, String(sentBySelf));
	return recalled;
}
async function cacheReaction(ctx, event) {
	if (!event.groupId || !event.msgSeq || !event.emojiId || !event.operatorUin) return;
	if (event.isAdd) await ctx.reactionStore.recordAdd(event.groupId, event.msgSeq, event.emojiId, 1, event.operatorUin, event.operatorUid, event.time);
	else await ctx.reactionStore.recordRemove(event.groupId, event.msgSeq, event.emojiId, event.operatorUin);
}
async function handleGroupMessage(ctx, log, event, state) {
	await cacheGroupMessageMeta(ctx, event);
	return convertAndDispatch(ctx, log, event, state);
}
async function handleFriendMessage(ctx, log, event, state) {
	await cachePrivateMessageMeta(ctx, event.peerUin ?? event.senderUin, event.msgSeq, event.ntMsgSeq ?? 0, event.clientSeq ?? event.msgSeq, event.time, event.msgId, event.sequenceAuthoritative !== false, event.senderUin === ctx.selfId ? "outgoing" : "incoming");
	return convertAndDispatch(ctx, log, event, state);
}
async function handleTempMessage(ctx, log, event, state) {
	await cachePrivateMessageMeta(ctx, event.senderUin, event.msgSeq, event.ntMsgSeq ?? 0, event.clientSeq ?? 0, event.time, 0, event.sequenceAuthoritative !== false, void 0);
	ctx.tempSessions.record(event.senderUin, event.groupId);
	return convertAndDispatch(ctx, log, event, state);
}
async function handleFriendRecall(ctx, log, event, state) {
	const clientSequence = event.clientSeq ?? event.msgSeq;
	const recalled = await ctx.messageStore.recordPrivateRecall(event.userUin, clientSequence, event.recalledBySelf === true, event.time);
	let messageIdOverride;
	if (recalled !== null) messageIdOverride = recalled;
	else log.debug("friend recall cache miss peer=%d clientSeq=%d", event.userUin, clientSequence);
	return convertAndDispatch(ctx, log, event, state, messageIdOverride);
}
async function handleGroupMsgEmojiLike(ctx, log, event, state) {
	await cacheReaction(ctx, event);
	return convertAndDispatch(ctx, log, event, state);
}
function handlePttTransResult(_ctx, log, event, state) {
	const notified = deliverPttTransText(pttTransKey(event.selfUin, event.msgId), event.text);
	traceEventTerminal(log, event.kind, state, "internal", notified ? "waiter_notified" : "waiter_not_found");
}
function convertOnly(ctx, log, event, state) {
	return convertAndDispatch(ctx, log, event, state);
}
var EVENT_PIPELINE = {
	friend_message: { handle: handleFriendMessage },
	group_message: { handle: handleGroupMessage },
	temp_message: { handle: handleTempMessage },
	group_member_join: { handle: convertOnly },
	group_member_leave: { handle: convertOnly },
	group_mute: { handle: convertOnly },
	group_admin: { handle: convertOnly },
	friend_recall: { handle: handleFriendRecall },
	group_recall: { handle: convertOnly },
	friend_request: { handle: convertOnly },
	group_invite: { handle: convertOnly },
	friend_poke: { handle: convertOnly },
	group_poke: { handle: convertOnly },
	group_essence: { handle: convertOnly },
	group_file_upload: { handle: convertOnly },
	friend_add: { handle: convertOnly },
	friend_input_status: { handle: convertOnly },
	friend_profile_like: { handle: convertOnly },
	bot_offline: { handle: convertOnly },
	group_name_change: { handle: convertOnly },
	group_title_change: { handle: convertOnly },
	group_card_change: { handle: convertOnly },
	group_msg_emoji_like: { handle: handleGroupMsgEmojiLike },
	ptt_trans_result: { handle: handlePttTransResult },
	online_devices_changed: { drop: true },
	friend_remark_changed: { drop: true }
};
export {};
