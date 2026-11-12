// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/modules/message-actions.ts"
// original bundle lines 37905-39059  (1153 lines) of dist/index.mjs
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
init_utils();
var log$53 = createLogger("OneBot");
/** Whether a Highway upload error message looks size-related. */
function isHighwaySizeError(err) {
	return err instanceof Error && /size limit|too large|413|too big|exceed/i.test(err.message);
}
/**
* A video element should fall back to file upload when its source size is
* known to exceed the limit, or — when the size can't be inferred (remote
* URL) — when the upload error itself looks size-related.
*/
function videoNeedsFileFallback(element, isSizeErr) {
	if (element.type !== "video") return false;
	const sz = getVideoSourceSize(element);
	return sz !== null ? sz > MAX_VIDEO_SIZE : isSizeErr;
}
/**
* Partition elements after a failed Highway send: oversized videos become
* `file` elements (re-routed through the file-upload pipeline), everything
* else is returned for a normal re-send.
*/
function splitVideoFileFallback(elements, isSizeErr) {
	const fileEls = [];
	const remaining = [];
	for (const e of elements) if (videoNeedsFileFallback(e, isSizeErr)) {
		const fileElement = {
			type: "file",
			url: e.url,
			fileId: e.fileId,
			fileName: e.fileName || "video.mp4",
			fileSize: e.fileSize,
			fileHash: e.fileHash,
			md5Hex: e.md5Hex,
			sha1Hex: e.sha1Hex
		};
		if (!fileElement.url && !fileElement.fileId) throw new MessageElementValidationError("MISSING_FIELD", "oversized video fallback requires a file/url source; a fingerprint alone cannot enter the file upload pipeline", "video", "url");
		fileEls.push(fileElement);
	} else remaining.push(e);
	return {
		fileEls,
		remaining
	};
}
async function getGroupMsgHistory(messageStore, groupId, messageId, count, reverseOrder = true) {
	if (!Number.isInteger(groupId) || groupId <= 0) return [];
	const limit = normalizeHistoryCount(count);
	const hasAnchor = Number.isInteger(messageId) && messageId !== 0;
	let anchorSequence;
	if (hasAnchor) {
		const meta = await messageStore.findMeta(messageId);
		if (!hasAuthoritativeSequence(meta) || !meta.isGroup || meta.targetId !== groupId) return [];
		anchorSequence = meta.sequence;
	}
	return (await messageStore.listSessionEvents(true, groupId, limit, anchorSequence, reverseOrder)).filter((event) => {
		if (event.message_type !== "group") return false;
		const gid = Number(event.group_id ?? 0);
		return Number.isFinite(gid) && Math.trunc(gid) === groupId;
	}).map(sanitizeMessageEventForApi);
}
async function getFriendMsgHistory(messageStore, userId, messageId, count, reverseOrder = true) {
	if (!Number.isInteger(userId) || userId <= 0) return [];
	const limit = normalizeHistoryCount(count);
	const hasAnchor = Number.isInteger(messageId) && messageId !== 0;
	let anchorSequence;
	if (hasAnchor) {
		const meta = await messageStore.findMeta(messageId);
		if (!hasAuthoritativeSequence(meta) || meta.isGroup || meta.targetId !== userId) return [];
		anchorSequence = meta.sequence;
	}
	return (await messageStore.listSessionEvents(false, userId, limit, anchorSequence, reverseOrder)).filter((event) => event.message_type === "private").map(sanitizeMessageEventForApi);
}
/**
* Group history, fetched from the server (`SsoGetGroupMsg`) instead of only the
* local observed-message store — so it can return messages SnowLuma never saw
* live, and (because each fetched message is persisted) reply / get_msg on old
* messages start working too. Resolves the anchor sequence from the requested
* message_id (or the latest observed message), then asks the bridge for the
* requested number of older or newer messages including that anchor. Falls
* back to the local store if the server fetch is unavailable or empty.
*/
async function getGroupHistory(ref, groupId, messageId, count, reverseOrder = true) {
	if (!Number.isInteger(groupId) || groupId <= 0) return [];
	const want = normalizeHistoryCount(count);
	const hasAnchor = Number.isInteger(messageId) && messageId !== 0;
	const effectiveReverseOrder = hasAnchor ? reverseOrder : true;
	let anchorSeq = 0;
	if (hasAnchor) {
		const meta = await ref.messageStore.findMeta(messageId);
		if (!hasAuthoritativeSequence(meta) || !meta.isGroup || meta.targetId !== groupId) return getGroupMsgHistory(ref.messageStore, groupId, messageId, count, reverseOrder);
		anchorSeq = meta.sequence;
	} else anchorSeq = await ref.messageStore.findLatestAuthoritativeSequence(true, groupId) ?? 0;
	log$53.debug("group history anchor selected: group=%d source=%s anchorSeq=%d", groupId, hasAnchor ? "message_id" : "latest_authoritative", anchorSeq);
	if (anchorSeq > 0) try {
		const events = await ref.bridge.apis.message.getGroupHistory(groupId, anchorSeq, want, ref.selfId, effectiveReverseOrder);
		const out = [];
		for (const ev of events) {
			const json = await convertEvent(ref.converterCtx, ev);
			if (!json || json.message_type !== "group") continue;
			await persistHistoryEvent(ref.messageStore, json);
			out.push(sanitizeMessageEventForApi(json));
		}
		if (out.length > 0) return out;
		log$53.debug("group history server fetch returned no usable messages: group=%d anchorSeq=%d count=%d; using local store", groupId, anchorSeq, want);
	} catch (err) {
		log$53.warn("group history server fetch failed: group=%d anchorSeq=%d count=%d reverseOrder=%s error=%s; using local store", groupId, anchorSeq, want, String(effectiveReverseOrder), err instanceof Error ? err.message : String(err));
	}
	return getGroupMsgHistory(ref.messageStore, groupId, messageId, count, reverseOrder);
}
/**
* Private (c2c) history — the same server-fetch + persist pattern as
* {@link getGroupHistory}. Explicit anchors use `SsoGetC2cMsg`; unanchored
* latest-page requests use `SsoGetRoamMsg`, because C2C field-5 sequences are
* sender-local and cannot safely bootstrap a conversation. Falls back to the
* local store only when an explicit message id cannot supply a safe server
* anchor. Server and UID failures are surfaced instead of returning a partial
* local conversation as a successful response.
*/
async function getFriendHistory(ref, userId, messageId, count, reverseOrder = true) {
	if (!Number.isInteger(userId) || userId <= 0) return [];
	const want = normalizeHistoryCount(count);
	const hasAnchor = Number.isInteger(messageId) && messageId !== 0;
	const effectiveReverseOrder = hasAnchor ? reverseOrder : true;
	let anchorSeq = 0;
	if (hasAnchor) {
		const meta = await ref.messageStore.findMeta(messageId);
		const storedEvent = meta?.targetId === ref.selfId ? await ref.messageStore.findEvent(messageId) : null;
		const belongsToPeer = meta?.targetId === userId || meta?.targetId === ref.selfId && toHistoryInt(storedEvent?.target_id) === userId;
		if (!hasAuthoritativeSequence(meta) || meta.isGroup || !belongsToPeer) return getFriendMsgHistory(ref.messageStore, userId, messageId, count, reverseOrder);
		anchorSeq = meta.sequence;
	}
	log$53.debug("friend history source selected: user=%d source=%s anchorSeq=%d", userId, hasAnchor ? "message_id" : "roam", anchorSeq);
	const friendUid = await ref.bridge.resolveUserUid(userId);
	if (!friendUid) throw new Error(`friend history cannot resolve uid for user ${userId}`);
	const events = hasAnchor ? await ref.bridge.apis.message.getC2cHistory(friendUid, anchorSeq, want, ref.selfId, effectiveReverseOrder) : await ref.bridge.apis.message.getC2cLatestHistory(friendUid, want, ref.selfId);
	const out = [];
	for (const ev of events) {
		if (!ev.peerUin || ev.peerUin <= 0) ev.peerUin = userId;
		const clientSequence = ev.clientSeq ?? ev.msgSeq;
		const sentBySelf = ev.senderUin === ref.selfId;
		const json = await convertEvent(ref.converterCtx, ev);
		if (!json || json.message_type !== "private") continue;
		if (await ref.messageStore.isPrivateMessageRecalled(userId, clientSequence, sentBySelf, ev.time)) {
			log$53.debug("friend history omitted recalled message: user=%d clientSeq=%d self=%s", userId, clientSequence, String(sentBySelf));
			continue;
		}
		if (json.post_type === "message_sent" && toHistoryInt(json.target_id) === 0) json.target_id = userId;
		if (await persistHistoryEvent(ref.messageStore, json, userId, ev)) out.push(sanitizeMessageEventForApi(json));
	}
	log$53.debug("friend history server fetch complete: user=%d source=%s anchorSeq=%d requested=%d returned=%d", userId, hasAnchor ? "message_id" : "roam", anchorSeq, want, out.length);
	return out;
}
/** Resolve and prepare quotes before conversion, without changing the protocol event. */
async function backfillReplyTarget(ref, event) {
	if (event.kind !== "group_message" && event.kind !== "friend_message") return event;
	const session = event.kind === "group_message" ? event.groupId : event.peerUin ?? event.senderUin;
	if (!Number.isInteger(session) || session <= 0) return event;
	const elements = [];
	let changed = false;
	for (const element of event.elements) {
		if (element.type !== "reply" || !Number.isSafeInteger(element.replySeq) || element.replySeq <= 0) {
			elements.push(element);
			continue;
		}
		const messageId = event.kind === "group_message" ? await backfillGroupReply(ref, session, element) : await backfillPrivateReply(ref, session, event, element);
		elements.push({
			...element,
			replyMessageId: messageId
		});
		changed = true;
	}
	return changed ? {
		...event,
		elements
	} : event;
}
async function backfillPrivateReply(ref, session, event, reply) {
	const sender = reply.replySenderUin ?? session;
	const sentBySelf = sender === ref.selfId;
	const hasNtSequence = (event.ntMsgSeq ?? 0) > 0 && event.sequenceAuthoritative !== false;
	const exclude = {
		id: await applyMessageIdResolver(ref.converterCtx.messageIdResolver, false, session, hasNtSequence ? event.ntMsgSeq : event.msgSeq, privateMessageEventName(event.senderUin === ref.selfId, hasNtSequence)),
		sequence: hasNtSequence ? event.ntMsgSeq : 0,
		clientSequence: event.clientSeq ?? event.msgSeq,
		timestamp: event.time,
		sentBySelf: event.senderUin === ref.selfId
	};
	const storedId = await ref.messageStore.resolvePrivateReplyMessageId(session, reply.replySeq, sentBySelf, reply.replyTime, reply.replyElements, exclude);
	if (storedId !== null && await ref.messageStore.findEvent(storedId)) return storedId;
	let history = [];
	try {
		const uid = await ref.bridge.resolveUserUid(session);
		if (uid) {
			const time = isUsableQuoteTime(reply.replyTime) ? reply.replyTime : event.time;
			history = await ref.bridge.apis.message.getC2cLatestHistory(uid, 20, ref.selfId, Math.min(4294967295, Math.max(1, time + 1)));
		}
	} catch (error) {
		log$53.warn("private quote history failed: peer=%d seq=%d error=%s", session, reply.replySeq, error instanceof Error ? error.message : String(error));
	}
	const selection = selectPrivateQuote(history.filter((candidate) => candidate.senderUin === sender && candidate.selfUin === ref.selfId && (candidate.peerUin ?? (candidate.senderUin === ref.selfId ? session : candidate.senderUin)) === session).map((source) => ({
		source: {
			...source,
			peerUin: session
		},
		sequence: source.sequenceAuthoritative !== false ? source.ntMsgSeq ?? 0 : 0,
		clientSequence: source.clientSeq ?? source.msgSeq,
		timestamp: source.time,
		preview: messageQuotePreview(source.elements)
	})), {
		sequence: reply.replySeq,
		sentBySelf,
		timestamp: reply.replyTime,
		elements: reply.replyElements,
		exclude
	});
	const fetched = selection.candidate?.source;
	const knownMeta = storedId !== null ? await ref.messageStore.findMeta(storedId) : null;
	if (fetched) {
		const json = await convertEvent(ref.converterCtx, fetched);
		if (!json) throw new Error("private quote history could not be converted");
		if (storedId !== null && knownMeta && Math.abs(knownMeta.timestamp - fetched.time) <= 30 && (knownMeta.sequenceAuthoritative !== false && knownMeta.sequence > 0 && fetched.sequenceAuthoritative !== false && (fetched.ntMsgSeq ?? 0) > 0 ? knownMeta.sequence === fetched.ntMsgSeq : knownMeta.clientSequence > 0 && knownMeta.clientSequence === (fetched.clientSeq ?? fetched.msgSeq))) json.message_id = storedId;
		const persisted = await persistHistoryEvent(ref.messageStore, json, session, fetched);
		const id = persisted ? toHistoryInt(json.message_id) : 0;
		log$53.trace("private quote history resolved: peer=%d seq=%d result=%s messageId=%d", session, reply.replySeq, persisted ? selection.reason : "recalled", id);
		return id;
	}
	if (storedId !== null && knownMeta && reply.replyElements?.length) {
		const segments = await elementsToOneBotSegments(ref.converterCtx, reply.replyElements.filter((element) => element.type !== "reply"), false, session);
		const json = buildBackfillEvent(storedId, knownMeta.clientSequence || knownMeta.sequence, sender, knownMeta.timestamp, segments, ref.selfId, false, session);
		return await ref.messageStore.storeHistoryEvent(storedId, false, session, knownMeta.sequence, knownMeta.eventName, json, {
			sequenceAuthoritative: knownMeta.sequenceAuthoritative,
			meta: knownMeta
		}) ? storedId : 0;
	}
	log$53.trace("private quote unresolved: peer=%d seq=%d time=%s result=%s knownId=%s", session, reply.replySeq, reply.replyTime, selection.reason, storedId ?? "unknown");
	return storedId ?? 0;
}
async function backfillGroupReply(ref, session, reply) {
	const resolvedId = await ref.converterCtx.messageIdResolver?.(true, session, reply.replySeq, GROUP_MESSAGE_EVENT, reply.replyTime && reply.replyTime > 0 ? reply.replyTime : Number.MAX_SAFE_INTEGER, reply.replyElements);
	const targetId = Number.isInteger(resolvedId) && resolvedId !== 0 ? resolvedId : hashMessageIdInt32(reply.replySeq, session, GROUP_MESSAGE_EVENT);
	if (await ref.messageStore.findEvent(targetId)) return targetId;
	let fetched = null;
	try {
		fetched = await ref.bridge.apis.message.getGroupMessageBySeq(session, reply.replySeq, ref.selfId);
	} catch (error) {
		log$53.warn("reply-target backfill tier-1 failed (%s)", error instanceof Error ? error.message : String(error));
	}
	if (fetched) {
		const json = await convertEvent(ref.converterCtx, fetched);
		if (json) {
			json.message_id = targetId;
			await ref.messageStore.storeEvent(targetId, true, session, reply.replySeq, GROUP_MESSAGE_EVENT, json);
			return targetId;
		}
	}
	let segments = [{
		type: "text",
		data: { text: "[引用消息]" }
	}];
	if (reply.replyElements?.length) segments = await elementsToOneBotSegments(ref.converterCtx, reply.replyElements, true, session);
	const fallback = buildBackfillEvent(targetId, reply.replySeq, reply.replySenderUin ?? 0, reply.replyTime ?? 0, segments, ref.selfId, true, session);
	await ref.messageStore.storeEvent(targetId, true, session, reply.replySeq, GROUP_MESSAGE_EVENT, fallback, { sequenceAuthoritative: false });
	return targetId;
}
function buildBackfillEvent(messageId, msgSeq, senderUin, timestamp, segments, selfId, isGroup, sessionId) {
	const sentBySelf = senderUin === selfId;
	const common = {
		time: timestamp || Math.floor(Date.now() / 1e3),
		self_id: selfId,
		post_type: sentBySelf ? "message_sent" : "message",
		message_id: messageId,
		message_seq: msgSeq,
		message: segments,
		raw_message: segmentsToRawMessage(segments),
		font: 0
	};
	if (isGroup) return {
		...common,
		message_type: "group",
		sub_type: "normal",
		group_id: sessionId,
		user_id: senderUin,
		sender: {
			user_id: senderUin,
			nickname: "",
			card: "",
			role: "member",
			sex: "unknown",
			age: 0
		},
		anonymous: null
	};
	const privateEvent = {
		...common,
		message_type: "private",
		sub_type: "friend",
		user_id: senderUin,
		sender: {
			user_id: senderUin,
			nickname: "",
			sex: "unknown",
			age: 0
		}
	};
	if (sentBySelf) privateEvent.target_id = sessionId;
	return privateEvent;
}
async function deleteMessage(bridge, meta) {
	if (!hasAuthoritativeSequence(meta)) throw new Error("message has no authoritative QQ sequence and cannot be recalled");
	if (meta.isGroup) await bridge.apis.message.recallGroup(meta.targetId, meta.sequence);
	else await bridge.apis.message.recallPrivate(meta.targetId, meta.clientSequence, meta.sequence, meta.random, meta.timestamp);
}
async function setEssenceMessage(bridge, messageStore, messageId, enable) {
	const meta = await messageStore.findMeta(messageId);
	if (!meta || !meta.isGroup) throw new Error("message not found or not a group message");
	if (!hasAuthoritativeSequence(meta)) throw new Error("message has no authoritative QQ sequence and cannot be marked as essence");
	await bridge.apis.interaction.setEssence(meta.targetId, meta.sequence, meta.random, enable);
}
/**
* Derive the same message id for send/receive paths and persist the sent
* message for get_msg, since QQ does not always echo it. Eligible C2C sends
* also return a message_sent event when no canonical echo has arrived.
*/
async function finalizeSend(ref, isGroup, targetId, receipt, elements, reportEcho = false) {
	const sequenceAuthoritative = Number.isInteger(receipt.sequence) && receipt.sequence > 0;
	const eventName = isGroup ? GROUP_MESSAGE_EVENT : privateMessageEventName(true, sequenceAuthoritative);
	const opaqueMessageId = receipt.messageId ?? 0;
	const messageId = sequenceAuthoritative ? hashMessageIdInt32(receipt.sequence, targetId, eventName) : Number.isInteger(opaqueMessageId) && opaqueMessageId !== 0 ? opaqueMessageId : hashMessageIdInt32(isGroup ? 0 : receipt.clientSequence, targetId, eventName);
	await ref.cacheMessageMeta(messageId, {
		isGroup,
		targetId,
		sequence: receipt.sequence,
		sequenceAuthoritative,
		eventName,
		clientSequence: receipt.clientSequence,
		...isGroup ? {} : { privateDirection: "outgoing" },
		random: receipt.random,
		timestamp: receipt.timestamp
	});
	const echoEvent = await cacheSelfSentMessage(ref, {
		isGroup,
		sessionId: targetId,
		messageId,
		sequence: receipt.sequence,
		messageSequence: isGroup ? receipt.sequence : receipt.clientSequence,
		sequenceAuthoritative,
		eventName,
		timestamp: receipt.timestamp,
		elements
	});
	return reportEcho && echoEvent && sequenceAuthoritative && receipt.timestamp > 0 ? {
		messageId,
		echoEvent
	} : { messageId };
}
async function cacheSelfSentMessage(ref, options) {
	const { isGroup, sessionId, messageId, sequence, messageSequence, sequenceAuthoritative, eventName, timestamp, elements } = options;
	try {
		const segments = await elementsToOneBotSegments({
			selfId: ref.selfId,
			imageUrlResolver: null,
			mediaUrlResolver: null,
			messageIdResolver: null,
			mediaSegmentSink: ref.converterCtx.mediaSegmentSink
		}, elements, isGroup, sessionId);
		const raw = segmentsToRawMessage(segments);
		const selfId = ref.selfId;
		const event = {
			time: timestamp,
			self_id: selfId,
			post_type: "message_sent",
			message_type: isGroup ? "group" : "private",
			sub_type: isGroup ? "normal" : "friend",
			message_id: messageId,
			message_seq: messageSequence,
			user_id: selfId,
			message: segments,
			raw_message: raw,
			font: 0,
			sender: {
				user_id: selfId,
				nickname: ref.bridge.identity.nickname || "",
				sex: "unknown",
				age: 0
			}
		};
		if (isGroup) event.group_id = sessionId;
		else event.target_id = sessionId;
		const existing = await ref.messageStore.findEvent(messageId);
		if (existing && sameSelfSentMessage(existing, event)) return null;
		await ref.messageStore.storeEvent(messageId, isGroup, sessionId, sequence, eventName, event, { sequenceAuthoritative });
		return event;
	} catch (err) {
		log$53.warn("[OneBot] failed to cache self-sent message %d: %s", messageId, err instanceof Error ? err.message : String(err));
		return null;
	}
}
function resolveContactArk(ref, contactType, contactId) {
	const normalized = contactType.trim().toLowerCase();
	if (normalized === "qq") return ref.bridge.apis.contacts.getBuddyRecommendArk(contactId, "");
	if (normalized === "group") return ref.bridge.apis.contacts.getGroupRecommendArk(contactId);
	return null;
}
async function sendPrivateMessage(ref, userId, message, autoEscape, tempGroupId, onSelfSent) {
	const isTempReply = tempGroupId !== void 0 && ref.tempSessions.has(userId, tempGroupId);
	if (tempGroupId !== void 0 && !isTempReply) throw new Error(`cannot send to user ${userId} in group ${tempGroupId}: no such temp session`);
	assertOutboundMessageInput(message, autoEscape, tempGroupId === void 0 ? "direct-private" : "group-temp");
	const privateForwardNodes = exclusiveForwardNodeList(message, autoEscape);
	if (privateForwardNodes) {
		if (tempGroupId !== void 0) throw new MessageElementValidationError("UNSENDABLE_TYPE", "message segment \"node\" cannot be sent in a temp session", "node");
		return sendPrivateForwardMessage(ref, userId, privateForwardNodes, void 0, onSelfSent);
	}
	const elements = await parseMessage(message, autoEscape, {
		resolveReplySequence: async (replyMessageId) => {
			return await ref.messageStore.resolveReplySequence(false, userId, replyMessageId);
		},
		resolveReplyMeta: async (replyMessageId) => {
			const event = await ref.messageStore.findEvent(replyMessageId);
			if (event) {
				const senderUin = typeof event.user_id === "number" ? event.user_id : parseInt(String(event.user_id || "0"), 10);
				const time = typeof event.time === "number" ? event.time : parseInt(String(event.time || "0"), 10);
				const meta = await ref.messageStore.findMeta(replyMessageId);
				return {
					senderUin,
					time,
					random: meta?.random ?? 0,
					elements: replyPreviewElements(event.message),
					sequenceAuthoritative: meta?.sequenceAuthoritative
				};
			}
			const meta = await ref.messageStore.findMeta(replyMessageId);
			if (meta) return {
				senderUin: ref.selfId,
				time: meta.timestamp,
				random: meta.random,
				sequenceAuthoritative: meta.sequenceAuthoritative
			};
			return null;
		},
		resolveMentionUid: (targetUin) => ref.bridge.resolveUserUid(targetUin),
		resolveContactArk: (contactType, contactId) => resolveContactArk(ref, contactType, contactId),
		musicSignUrl: ref.musicSignUrl
	});
	if (elements.length === 0) throw new Error("message is empty");
	if (elements.some((e) => e.type === "at")) throw new MessageElementValidationError("UNSENDABLE_TYPE", "message element \"at\" cannot be sent in a private chat", "at");
	if (findDatalineDeviceByUin(userId)) {
		const unsupported = elements.find((element) => element.type !== "text");
		if (unsupported) throw new MessageElementValidationError("UNSENDABLE_TYPE", `message element "${unsupported.type}" cannot be sent to this contact`, unsupported.type);
	}
	if (tempGroupId !== void 0) {
		const unsupported = elements.find((element) => element.type === "file" || videoNeedsFileFallback(element, false));
		if (unsupported) throw new MessageElementValidationError("UNSENDABLE_TYPE", `message element "${unsupported.type}" cannot be sent in a temp session`, unsupported.type);
	}
	let allFileElements = elements.filter((e) => e.type === "file");
	let nonFileElements = elements.filter((e) => e.type !== "file");
	let fileTargetUid = null;
	const ensureFileTargetUid = async () => {
		if (fileTargetUid) return fileTargetUid;
		const resolved = await ref.bridge.resolveUserUid(userId);
		if (!resolved) throw new Error(`c2c file send: could not resolve uid for user ${userId}`);
		fileTargetUid = resolved;
		return resolved;
	};
	{
		const pre = splitVideoFileFallback(nonFileElements, false);
		if (pre.fileEls.length > 0) {
			allFileElements = [...allFileElements, ...pre.fileEls];
			nonFileElements = pre.remaining;
		}
	}
	if (allFileElements.length > 0) await ensureFileTargetUid();
	const sendText = (elems) => isTempReply && tempGroupId !== void 0 ? ref.bridge.apis.message.sendGroupTempMessage(userId, tempGroupId, elems) : ref.bridge.apis.message.sendPrivate(userId, elems);
	let lastResult;
	const finalizeBatch = async (receipt, batchElements) => {
		const result = await finalizeSend(ref, false, userId, receipt, batchElements, tempGroupId === void 0 && onSelfSent !== void 0);
		lastResult = result;
		if (result.echoEvent) await onSelfSent?.(result.echoEvent);
	};
	if (nonFileElements.length > 0) try {
		const receipt = await sendText(nonFileElements);
		logSentMessage(false, userId, nonFileElements);
		await finalizeBatch(receipt, nonFileElements);
	} catch (err) {
		if (tempGroupId !== void 0) throw err;
		const isSizeErr = isHighwaySizeError(err);
		if (!nonFileElements.some((e) => videoNeedsFileFallback(e, isSizeErr))) throw err;
		log$53.warn("[OneBot] private video upload failed, falling back to file upload: %s", err instanceof Error ? err.message : String(err));
		const { fileEls, remaining } = splitVideoFileFallback(nonFileElements, isSizeErr);
		allFileElements = [...allFileElements, ...fileEls];
		nonFileElements = remaining;
		if (fileEls.length > 0) await ensureFileTargetUid();
		if (nonFileElements.length > 0) {
			const receipt = await ref.bridge.apis.message.sendPrivate(userId, nonFileElements);
			logSentMessage(false, userId, nonFileElements);
			await finalizeBatch(receipt, nonFileElements);
		}
	}
	if (allFileElements.length > 0) {
		if (tempGroupId !== void 0) throw new Error("temp-session file preflight invariant failed");
		const userUid = await ensureFileTargetUid();
		for (const fileEl of allFileElements) if (fileEl.url && !fileEl.fileId) {
			const name = fileEl.fileName || guessFileNameFromUrl(fileEl.url) || "file";
			const uploaded = await ref.bridge.apis.groupFile.uploadPrivate(userId, fileEl.url, name, true, false);
			if (!uploaded.fileId) throw new Error("private file upload returned no file_id");
			const cached = ref.bridge.recallUploadedFile(uploaded.fileId);
			if (!cached || cached.scope !== "private" || cached.userId !== userId) throw new Error(`private file upload metadata missing for file_id ${uploaded.fileId}`);
			const receipt = await ref.bridge.apis.message.sendC2cFile(userId, userUid, {
				fileId: uploaded.fileId,
				fileName: cached.fileName,
				fileSize: cached.fileSize,
				fileMd5: cached.fileMd5,
				fileHash: uploaded.fileHash ?? cached.fileHash
			});
			logSentMessage(false, userId, [fileEl]);
			await finalizeBatch(receipt, [fileEl]);
		} else if (fileEl.fileId) {
			const cached = ref.bridge.recallUploadedFile(fileEl.fileId);
			const fileMd5 = fileEl.md5Hex ? Buffer.from(fileEl.md5Hex, "hex") : cached?.fileMd5 ?? /* @__PURE__ */ new Uint8Array(0);
			const fileSize = fileEl.fileSize ?? cached?.fileSize ?? 0;
			const fileName = fileEl.fileName ?? cached?.fileName ?? "file";
			const fileHash = fileEl.fileHash ?? cached?.fileHash;
			const receipt = await ref.bridge.apis.message.sendC2cFile(userId, userUid, {
				fileId: fileEl.fileId,
				fileName,
				fileSize,
				fileMd5,
				fileHash
			});
			logSentMessage(false, userId, [fileEl]);
			await finalizeBatch(receipt, [fileEl]);
		} else throw new MessageElementValidationError("MISSING_FIELD", "private file segment requires file_id or url", "file");
	}
	if (!lastResult) throw new Error("message is empty");
	return { messageId: lastResult.messageId };
}
async function sendGroupMessage(ref, groupId, message, autoEscape) {
	assertOutboundMessageInput(message, autoEscape, "group");
	const groupForwardNodes = exclusiveForwardNodeList(message, autoEscape);
	if (groupForwardNodes) return { messageId: (await sendGroupForwardMessage(ref, groupId, groupForwardNodes)).messageId };
	const elements = await parseMessage(message, autoEscape, {
		resolveReplySequence: async (replyMessageId) => {
			return await ref.messageStore.resolveReplySequence(true, groupId, replyMessageId);
		},
		resolveReplyMeta: async (replyMessageId) => {
			const meta = await ref.messageStore.findMeta(replyMessageId);
			if (!meta || !meta.isGroup || meta.targetId !== groupId) return null;
			const event = await ref.messageStore.findEvent(replyMessageId);
			if (event) return {
				senderUin: typeof event.user_id === "number" ? event.user_id : parseInt(String(event.user_id || "0"), 10),
				time: typeof event.time === "number" ? event.time : parseInt(String(event.time || "0"), 10),
				random: meta?.random ?? 0,
				elements: replyPreviewElements(event.message),
				sequenceAuthoritative: meta?.sequenceAuthoritative
			};
			return {
				senderUin: ref.selfId,
				time: meta.timestamp,
				random: meta.random,
				sequenceAuthoritative: meta.sequenceAuthoritative
			};
		},
		resolveMentionUid: (targetUin) => ref.bridge.resolveUserUid(targetUin, groupId),
		resolveContactArk: (contactType, contactId) => resolveContactArk(ref, contactType, contactId),
		musicSignUrl: ref.musicSignUrl
	});
	if (elements.length === 0) throw new Error("message is empty");
	let allFileElements = elements.filter((e) => e.type === "file");
	let nonFileElements = elements.filter((e) => e.type !== "file");
	{
		const pre = splitVideoFileFallback(nonFileElements, false);
		if (pre.fileEls.length > 0) {
			allFileElements = [...allFileElements, ...pre.fileEls];
			nonFileElements = pre.remaining;
		}
	}
	let lastReceipt;
	if (nonFileElements.length > 0) try {
		lastReceipt = await ref.bridge.apis.message.sendGroup(groupId, nonFileElements);
		logSentMessage(true, groupId, nonFileElements);
	} catch (err) {
		const isSizeErr = isHighwaySizeError(err);
		if (!nonFileElements.some((e) => videoNeedsFileFallback(e, isSizeErr))) throw err;
		log$53.warn("[OneBot] group video upload failed, falling back to file upload: %s", err instanceof Error ? err.message : String(err));
		const { fileEls, remaining } = splitVideoFileFallback(nonFileElements, isSizeErr);
		allFileElements = [...allFileElements, ...fileEls];
		nonFileElements = remaining;
		if (nonFileElements.length > 0) {
			lastReceipt = await ref.bridge.apis.message.sendGroup(groupId, nonFileElements);
			logSentMessage(true, groupId, nonFileElements);
		}
	}
	for (const fileEl of allFileElements) {
		let fileId;
		if (fileEl.url && !fileEl.fileId) {
			const name = fileEl.fileName || guessFileNameFromUrl(fileEl.url) || "file";
			fileId = (await ref.bridge.apis.groupFile.upload(groupId, fileEl.url, name, "/", true)).fileId ?? "";
			if (!fileId) throw new Error("group file auto-upload returned no file_id");
		} else if (fileEl.fileId) {
			fileId = fileEl.fileId;
			await ref.bridge.apis.groupFile.publish(groupId, fileId);
		} else throw new MessageElementValidationError("MISSING_FIELD", "group file segment requires file_id or url", "file");
		logSentMessage(true, groupId, [fileEl]);
		if (!lastReceipt) {
			let h = 0;
			for (let i = 0; i < fileId.length; i++) h = (h << 5) - h + fileId.charCodeAt(i) | 0;
			const localSeed = h & 2147483647;
			lastReceipt = {
				messageId: hashMessageIdInt32(localSeed, groupId, GROUP_MESSAGE_EVENT),
				sequence: 0,
				clientSequence: 0,
				random: localSeed,
				timestamp: Math.floor(Date.now() / 1e3)
			};
		}
	}
	if (!lastReceipt) throw new Error("message is empty");
	return finalizeSend(ref, true, groupId, lastReceipt, elements);
}
async function sendGroupForwardMessage(ref, groupId, messages, meta) {
	const nodes = await parseForwardNodes(ref, messages, { groupId });
	const forwardId = await ref.bridge.apis.forward.upload(nodes, groupId);
	const previewElement = buildForwardPreviewElement(forwardId, nodes, true, meta);
	const { messageId } = await finalizeSend(ref, true, groupId, await ref.bridge.apis.message.sendGroup(groupId, [previewElement]), [previewElement]);
	return {
		messageId,
		forwardId
	};
}
async function sendPrivateForwardMessage(ref, userId, messages, meta, onSelfSent) {
	const nodes = await parseForwardNodes(ref, messages, { userId });
	const forwardId = await ref.bridge.apis.forward.upload(nodes, void 0, userId);
	const previewElement = buildForwardPreviewElement(forwardId, nodes, false, meta);
	const result = await finalizeSend(ref, false, userId, await ref.bridge.apis.message.sendPrivate(userId, [previewElement]), [previewElement], onSelfSent !== void 0);
	if (result.echoEvent) await onSelfSent?.(result.echoEvent);
	return {
		messageId: result.messageId,
		forwardId
	};
}
async function uploadForwardMessage(ref, messages, groupId) {
	const nodes = await parseForwardNodes(ref, messages, { groupId });
	return { forwardId: await ref.bridge.apis.forward.upload(nodes, groupId) };
}
/**
* Forward a previously-received message to another peer.
*
* Plain text/image/record/video reuse the cached fingerprints and the
* normal send pipeline. A merged-forward card cannot be resent as-is:
* long-msg resid is scoped to the source chat, so the inner tree is
* fetched and uploaded again for the target. Fail the Action rather
* than leave an unopenable bubble.
*/
async function forwardSingleMessage(ref, messageId, target, onSelfSent) {
	if (!target.groupId && !target.userId) throw new Error("forward target group_id or user_id is required");
	const event = await ref.messageStore.findEvent(messageId);
	if (!event) throw new Error(`message not found: ${messageId}`);
	const content = event.message ?? event.raw_message ?? "";
	assertOutboundMessageInput(content, false, "forward");
	const parsed = await parseMessage(content, false);
	if (parsed.length === 0) throw new Error("message has no content");
	const elements = await prepareSingleForwardElements(ref, await restoreHistoricalMedia(ref, parsed, messageId), target);
	let receipt;
	let messageIdOut;
	if (target.groupId) {
		receipt = await ref.bridge.apis.message.sendGroup(target.groupId, elements);
		({messageId: messageIdOut} = await finalizeSend(ref, true, target.groupId, receipt, elements));
	} else {
		receipt = await ref.bridge.apis.message.sendPrivate(target.userId, elements);
		const result = await finalizeSend(ref, false, target.userId, receipt, elements, onSelfSent !== void 0);
		messageIdOut = result.messageId;
		if (result.echoEvent) await onSelfSent?.(result.echoEvent);
	}
	return { messageId: messageIdOut };
}
async function prepareSingleForwardElements(ref, elements, target) {
	const out = [];
	for (const element of elements) {
		if (element.type !== "forward") {
			out.push(isMessageMedia(element) ? element : await enrichForForward(ref, element));
			continue;
		}
		const resId = element.resId.trim();
		if (!resId) throw new Error("forward id is missing");
		const nodes = await expandForwardTreeForTarget(ref, resId, target, 0);
		if (nodes.length === 0) throw new Error("forward content is empty");
		const newResId = await ref.bridge.apis.forward.upload(nodes, target.groupId, target.userId);
		if (!newResId) throw new Error("forward regenerate failed");
		out.push(buildForwardPreviewElement(newResId, nodes, target.groupId !== void 0, void 0));
	}
	return out;
}
async function expandForwardTreeForTarget(ref, resId, target, depth) {
	if (depth >= MAX_FORWARD_DEPTH) throw new MessageElementValidationError("INVALID_FIELD", `forward nesting depth exceeds ${MAX_FORWARD_DEPTH}`, "forward", "id");
	const nodes = await ref.bridge.apis.forward.fetch(resId);
	if (!Array.isArray(nodes) || nodes.length === 0) throw new Error("forward content is empty");
	const expanded = [];
	for (const node of nodes) expanded.push(await expandForwardNodeForTarget(ref, node, target, depth));
	return expanded;
}
async function expandForwardNodeForTarget(ref, node, target, depth) {
	const preparedElements = await mapWithConcurrency(node.elements, 8, async (element) => {
		if (!isMessageMedia(element) || !element.md5Hex || !element.sha1Hex) return element;
		if (element.type === "image" && (!element.width || !element.height || !element.picFormat)) return element;
		return await enrichForForward(ref, element, element);
	});
	const forwards = preparedElements.filter((element) => element.type === "forward");
	if (forwards.length === 0) return {
		...node,
		elements: preparedElements
	};
	if (forwards.length === preparedElements.length && forwards.length === 1) {
		const innerId = forwards[0].resId.trim();
		if (!innerId) throw new Error("nested forward id is missing");
		return {
			...node,
			elements: [],
			innerForward: await expandForwardTreeForTarget(ref, innerId, target, depth + 1)
		};
	}
	const elements = [];
	for (const element of preparedElements) {
		if (element.type !== "forward") {
			elements.push(element);
			continue;
		}
		const innerId = element.resId.trim();
		if (!innerId) throw new Error("nested forward id is missing");
		const inner = await expandForwardTreeForTarget(ref, innerId, target, depth + 1);
		const newResId = await ref.bridge.apis.forward.upload(inner, target.groupId, target.userId);
		if (!newResId) throw new Error("forward regenerate failed");
		elements.push(buildForwardPreviewElement(newResId, inner, target.groupId !== void 0, void 0));
	}
	return {
		...node,
		elements
	};
}
async function restoreHistoricalMedia(ref, elements, messageId) {
	if (!elements.some(isMessageMedia)) return elements;
	const snapshots = await ref.messageStore.findMedia(messageId);
	let index = 0;
	const restored = await mapWithConcurrency(elements, 8, async (element) => {
		if (!isMessageMedia(element)) return element;
		const snapshot = snapshots?.[index++];
		if (snapshots && (!snapshot || snapshot.type !== element.type)) throw new Error(`historical media metadata does not match message ${messageId}`);
		return await enrichForForward(ref, element, snapshot);
	});
	if (snapshots && index !== snapshots.length) throw new Error(`historical media metadata does not match message ${messageId}`);
	return restored;
}
async function enrichForForward(ref, element, snapshot) {
	if (element.type === "forward") throw new Error("merged forward must be regenerated for the target chat");
	if (element.type === "text" || element.type === "face" || element.type === "at" || element.type === "reply" || element.type === "json" || element.type === "xml" || element.type === "poke" || element.type === "mface") return element;
	if (element.type === "file") throw new Error("forward of file segment is not supported");
	const lookupKey = element.url || element.fileName || element.fileId || "";
	if (!lookupKey && !snapshot) throw new Error(`forward ${element.type} missing cache key`);
	if (element.type === "image") {
		const cached = snapshot?.type === "image" ? snapshot : await ref.mediaStore.findImage(lookupKey, "legacy");
		if (!cached || !cached.md5Hex || !cached.sha1Hex || !cached.width || !cached.height || !cached.picFormat) throw new Error("historical image metadata is incomplete; fetch the original message again");
		return {
			...element,
			type: "image",
			noByteFallback: true,
			md5Hex: cached.md5Hex,
			sha1Hex: cached.sha1Hex,
			fileSize: cached.fileSize,
			fileName: cached.fileName,
			subType: cached.subType,
			summary: cached.summary,
			width: cached.width,
			height: cached.height,
			picFormat: cached.picFormat
		};
	}
	if (element.type === "record") {
		const cached = snapshot?.type === "record" ? snapshot : await ref.mediaStore.findRecord(lookupKey, "legacy");
		if (!cached || !cached.md5Hex || !cached.sha1Hex) throw new Error("historical voice metadata is incomplete; fetch the original message again");
		return {
			...element,
			type: "record",
			noByteFallback: true,
			md5Hex: cached.md5Hex,
			sha1Hex: cached.sha1Hex,
			fileSize: cached.fileSize,
			fileName: cached.fileName,
			fileId: cached.fileId,
			duration: cached.duration,
			voiceFormat: cached.voiceFormat ?? 1
		};
	}
	if (element.type === "video") {
		const cached = snapshot?.type === "video" ? snapshot : await ref.mediaStore.findVideo(lookupKey, "legacy");
		if (!cached || !cached.md5Hex || !cached.sha1Hex) throw new Error("historical video metadata is incomplete; fetch the original message again");
		log$53.warn("video forward uses a fallback thumbnail (original thumb not cached)");
		return {
			...element,
			type: "video",
			noByteFallback: true,
			md5Hex: cached.md5Hex,
			sha1Hex: cached.sha1Hex,
			fileSize: cached.fileSize,
			fileName: cached.fileName,
			fileId: cached.fileId,
			duration: cached.duration,
			width: cached.width ?? 0,
			height: cached.height ?? 0,
			videoFormat: cached.videoFormat ?? 0
		};
	}
	return element;
}
async function getForwardMessage(ref, resId) {
	const nodes = await ref.bridge.apis.forward.fetch(resId);
	const results = [];
	for (const node of nodes) {
		const isGroup = node.messageType === "group" || node.groupId !== void 0 && node.groupId > 0;
		const sessionId = isGroup ? node.groupId ?? 0 : node.userUin;
		const segments = await elementsToOneBotSegments(ref.converterCtx, node.elements, isGroup, sessionId, { includeReplyContent: true });
		const sender = {
			user_id: node.userUin,
			nickname: node.nickname
		};
		if (isGroup) sender.card = node.senderCard ?? "";
		if (node.title !== void 0 && node.title.length > 0) sender.title = node.title;
		const message = {
			self_id: ref.selfId,
			user_id: node.userUin,
			time: node.time ?? Math.floor(Date.now() / 1e3),
			message_id: node.msgId ?? 0,
			message_seq: node.msgSeq ?? node.msgId ?? 0,
			real_id: node.msgId ?? 0,
			message_type: isGroup ? "group" : "private",
			sender,
			raw_message: "",
			font: 14,
			sub_type: isGroup ? "normal" : "friend",
			message: segments,
			message_format: "array",
			post_type: "message"
		};
		if (isGroup && node.groupId !== void 0 && node.groupId > 0) message.group_id = node.groupId;
		results.push(message);
	}
	return results;
}
function normalizeHistoryCount(count) {
	if (!Number.isFinite(count)) return 20;
	const n = Math.trunc(count);
	if (n <= 0) return 20;
	if (n > 200) return 200;
	return n;
}
function sanitizeMessageEventForApi(event) {
	const result = { ...event };
	delete result.post_type;
	delete result.self_id;
	result.real_id = result.message_id ?? 0;
	return result;
}
function logSentMessage(isGroup, targetId, elements) {
	const type = isGroup ? "群聊" : "私聊";
	const parts = [];
	const replyElem = elements.find((e) => e.type === "reply");
	if (replyElem?.replyMessageId) parts.push(`[回复:${replyElem.replyMessageId}]`);
	for (const elem of elements) {
		if (elem.type === "reply") continue;
		switch (elem.type) {
			case "text":
				if (elem.text) {
					const preview = elem.text.length > 50 ? `${elem.text.substring(0, 50)}...` : elem.text;
					parts.push(preview);
				}
				break;
			case "image":
				parts.push("[图片]");
				break;
			case "face":
				parts.push("[表情]");
				break;
			case "at":
				if (elem.text) parts.push(elem.text.trim());
				break;
			case "record":
				parts.push("[语音]");
				break;
			case "video":
				parts.push("[视频]");
				break;
			case "json":
				parts.push("[JSON消息]");
				break;
			case "xml":
				parts.push("[XML消息]");
				break;
			case "markdown":
				parts.push("[Markdown]");
				break;
			case "forward":
				parts.push("[转发消息]");
				break;
			case "poke":
				parts.push("[窗口抖动]");
				break;
			case "file":
				parts.push(`[文件:${elem.fileName || elem.fileId || ""}]`);
				break;
			default: break;
		}
	}
	const content = parts.join(" ").trim() || "[空消息]";
	log$53.info(`${type} ${targetId} | 发送：${content}`);
}
var MAX_FORWARD_DEPTH = 3;
/**
* Are all entries of this array `{type:'node'}` segments? Then `content`
* itself is a nested forward chain (vs a regular flat segment list).
* Mixed content (some nodes + some text/image) returns false: that's not a
* meaningful nested-forward shape, so the regular strict parser rejects the
* embedded node before any upload starts.
*/
function isNestedNodeArray(value) {
	if (!Array.isArray(value) || value.length === 0) return false;
	for (const item of value) {
		const seg = asJsonObject(item);
		if (!seg || seg.type !== "node") return false;
	}
	return true;
}
function assertForwardNodeMetadata(nodeData, index) {
	for (const [field, value] of Object.entries(nodeData)) {
		if (field === "content" || field === "message") continue;
		if (value === void 0) continue;
		if (field === "news") {
			if (isForwardNewsArray(value)) continue;
			throw new MessageElementValidationError("INVALID_FIELD", `forward messages[${index}].news must be an array of objects with string text`, "node", field);
		}
		if (field === "title" || field === "source" || field === "summary" || field === "prompt") {
			if (typeof value === "string") continue;
			throw new MessageElementValidationError("INVALID_FIELD", `forward messages[${index}].${field} must be a string`, "node", field);
		}
		if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") continue;
		throw new MessageElementValidationError("INVALID_FIELD", `forward messages[${index}].${field} must be a scalar value`, "node", field);
	}
}
/** Whether a value looks like OneBot preview news: `Array<{ text: string }>`. */
function isForwardNewsArray(value) {
	if (!Array.isArray(value)) return false;
	for (const item of value) {
		const obj = asJsonObject(item);
		if (!obj || typeof obj.text !== "string") return false;
	}
	return true;
}
async function assertForwardMessageInputPolicies(ref, messages, depth = 0) {
	if (!Array.isArray(messages) || depth >= MAX_FORWARD_DEPTH) return;
	for (const [index, item] of messages.entries()) {
		const segment = asJsonObject(item);
		if (!segment) continue;
		const nodeData = segment.type === "node" ? asJsonObject(segment.data) : segment;
		if (!nodeData) continue;
		assertForwardNodeMetadata(nodeData, index);
		const messageId = parseForwardMessageId(nodeData.id ?? nodeData.message_id);
		if (messageId !== 0) {
			const event = await ref.messageStore.findEvent(messageId);
			if (event) assertOutboundMessageInput(event.message ?? event.raw_message ?? "", false, "forward");
			continue;
		}
		const content = nodeData.content ?? nodeData.message ?? "";
		if (isNestedNodeArray(content)) await assertForwardMessageInputPolicies(ref, content, depth + 1);
		else assertOutboundMessageInput(content, false, "forward");
	}
}
async function parseForwardNodes(ref, messages, options = {}) {
	const depth = options.depth ?? 0;
	if (depth >= MAX_FORWARD_DEPTH) throw new MessageElementValidationError("INVALID_FIELD", `forward nesting depth exceeds ${MAX_FORWARD_DEPTH}`, "node", "content");
	if (!Array.isArray(messages)) throw new MessageElementValidationError("INVALID_FIELD", "forward messages must be an array of node segments", "node", "messages");
	if (messages.length === 0) throw new MessageElementValidationError("MISSING_FIELD", "forward messages must contain at least one node", "node", "messages");
	const prepared = messages.map((item, index) => {
		const segment = asJsonObject(item);
		if (!segment) throw new MessageElementValidationError("INVALID_FIELD", `forward messages[${index}] must be an object`, "node", `messages[${index}]`);
		const rawType = segment.type;
		if (rawType !== void 0 && typeof rawType !== "string") throw new MessageElementValidationError("INVALID_FIELD", `forward messages[${index}].type must be "node"`, "node", "type");
		if (typeof rawType === "string" && rawType !== "node") throw new MessageElementValidationError("UNKNOWN_TYPE", `unknown forward message segment type: ${rawType}`, rawType, "type");
		if (rawType === "node") {
			const nodeData = asJsonObject(segment.data);
			if (!nodeData) throw new MessageElementValidationError("INVALID_FIELD", `forward messages[${index}].data must be an object`, "node", "data");
			assertForwardNodeMetadata(nodeData, index);
			return nodeData;
		}
		if (segment.content === void 0 && segment.message === void 0) throw new MessageElementValidationError("MISSING_FIELD", `forward messages[${index}] requires type:"node" data or bare content/message`, "node", "content");
		assertForwardNodeMetadata(segment, index);
		return segment;
	});
	await assertForwardMessageInputPolicies(ref, messages, depth);
	const nodes = [];
	for (const nodeData of prepared) {
		const messageId = parseForwardMessageId(nodeData.id ?? nodeData.message_id);
		if (messageId !== 0) {
			const event = await ref.messageStore.findEvent(messageId);
			if (!event) throw new MessageElementValidationError("INVALID_FIELD", `forward node message_id not found: ${String(messageId)}`, "node", "message_id");
			const eventSender = asJsonObject(event.sender) ?? {};
			const senderCard = eventSender.card !== void 0 ? String(eventSender.card) : void 0;
			const nickname = String(eventSender.card || eventSender.nickname || nodeData.nickname || nodeData.name || "");
			const userUin = toPositiveInt(event.user_id);
			if (userUin <= 0) throw new MessageElementValidationError("INVALID_FIELD", `forward node message_id ${String(messageId)} has no valid sender user_id`, "node", "user_id");
			const elements = await restoreHistoricalMedia(ref, await parseMessage(event.message ?? event.raw_message ?? "", false, { forwardReply: {
				senderUin: userUin,
				time: toPositiveInt(event.time) || void 0
			} }), messageId);
			if (elements.length > 0) {
				const messageType = event.message_type === "group" ? "group" : "private";
				const groupIdValue = toPositiveInt(event.group_id);
				nodes.push({
					userUin,
					nickname: nickname || String(userUin),
					elements,
					time: typeof event.time === "number" ? event.time : toPositiveInt(event.time),
					msgId: toSafeSignedInteger(event.message_id),
					msgSeq: toPositiveInt(event.message_seq),
					groupId: groupIdValue > 0 ? groupIdValue : void 0,
					senderCard,
					messageType
				});
			}
			continue;
		}
		const userUin = toPositiveInt(nodeData.user_id ?? nodeData.uin) || ref.selfId;
		if (userUin <= 0) throw new Error("forward node user_id/uin is required");
		const nickname = String(nodeData.nickname ?? nodeData.name ?? userUin);
		const content = nodeData.content ?? nodeData.message ?? "";
		const nodeTime = toPositiveInt(nodeData.time);
		const time = nodeTime > 0 && nodeTime < 4294967295 ? nodeTime : void 0;
		let elements;
		let innerForward;
		if (isNestedNodeArray(content)) {
			innerForward = await parseForwardNodes(ref, content, {
				groupId: options.groupId,
				userId: options.userId,
				depth: depth + 1
			});
			elements = [];
		} else elements = await parseMessage(content, false, { forwardReply: {
			senderUin: userUin,
			time
		} });
		if (!innerForward && elements.length === 0) throw new Error(`forward node content is empty: ${userUin}`);
		const node = {
			userUin,
			nickname,
			elements
		};
		if (nodeData.news !== void 0) node.news = nodeData.news.map((item) => ({ text: item.text }));
		for (const field of [
			"title",
			"source",
			"summary",
			"prompt"
		]) if (nodeData[field] !== void 0) node[field] = nodeData[field];
		if (time !== void 0) node.time = time;
		if (innerForward) node.innerForward = innerForward;
		nodes.push(node);
	}
	if (nodes.length === 0) throw new Error("forward node list is empty");
	return nodes;
}
function elementPreview(element) {
	switch (element.type) {
		case "text": {
			const t = element.text ?? "";
			return t.length > 40 ? `${t.slice(0, 40)}…` : t;
		}
		case "at": return element.text?.trim() || "@";
		case "face": return "[表情]";
		case "mface": return element.text ? `[${element.text}]` : "[表情]";
		case "image": return "[图片]";
		case "record": return "[语音]";
		case "video": return "[视频]";
		case "file": return element.fileName ? `[文件:${element.fileName}]` : "[文件]";
		case "reply": return "";
		case "json": return "[JSON消息]";
		case "xml": return "[XML消息]";
		case "markdown": return "[Markdown]";
		case "inline_keyboard": return "[交互按钮]";
		case "forward": return "[聊天记录]";
		case "poke": return "[窗口抖动]";
		default: return "";
	}
}
function buildNewsFromNodes(nodes) {
	const lines = [];
	for (const node of nodes) {
		const preview = node.elements.map(elementPreview).filter(Boolean).join(" ").trim();
		const nickname = node.nickname || String(node.userUin);
		lines.push({ text: `${nickname}: ${preview || "[消息]"}` });
		if (lines.length >= 4) break;
	}
	return lines;
}
function deriveForwardSource(nodes, isGroup) {
	if (nodes.length === 0) return "聊天记录";
	if (isGroup) return "群聊的聊天记录";
	const seen = /* @__PURE__ */ new Set();
	const nicks = [];
	for (const node of nodes) {
		const nick = (node.nickname || String(node.userUin)).trim();
		if (!nick || seen.has(nick)) continue;
		seen.add(nick);
		nicks.push(nick);
		if (nicks.length >= 4) break;
	}
	return nicks.length > 0 ? `${nicks.join("和")}的聊天记录` : "聊天记录";
}
function buildForwardPreviewElement(resId, nodes, isGroup, meta) {
	const news = meta?.news && meta.news.length > 0 ? meta.news : buildNewsFromNodes(nodes);
	return {
		type: "forward",
		resId,
		forwardSource: meta?.source && meta.source.length > 0 ? meta.source : deriveForwardSource(nodes, isGroup),
		forwardSummary: meta?.summary && meta.summary.length > 0 ? meta.summary : `查看${nodes.length}条转发消息`,
		forwardPrompt: meta?.prompt && meta.prompt.length > 0 ? meta.prompt : "[聊天记录]",
		forwardNews: news,
		forwardTSum: nodes.length
	};
}
function asJsonObject(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value;
}
function toPositiveInt(value) {
	if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
	}
	return 0;
}
function toSafeSignedInteger(value) {
	if (typeof value === "number" && Number.isSafeInteger(value)) return value;
	if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
		const parsed = Number(value.trim());
		if (Number.isSafeInteger(parsed)) return parsed;
	}
	return 0;
}
function parseForwardMessageId(value) {
	if (value === void 0 || value === null || value === "") return 0;
	if (typeof value === "number" && Number.isSafeInteger(value)) return value;
	if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
		const parsed = Number(value.trim());
		if (Number.isSafeInteger(parsed)) return parsed;
	}
	throw new MessageElementValidationError("INVALID_FIELD", "forward node id/message_id must be a non-zero safe integer", "node", "message_id");
}
export {};
