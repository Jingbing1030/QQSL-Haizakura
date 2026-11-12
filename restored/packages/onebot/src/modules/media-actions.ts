// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/modules/media-actions.ts"
// original bundle lines 39795-39913  (117 lines) of dist/index.mjs
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
var log$50 = createLogger("OneBot");
function isStoredMediaSegment(segment) {
	return segment !== null && typeof segment === "object" && !Array.isArray(segment) && (segment.type === "image" || segment.type === "record" || segment.type === "video") && segment.data !== null && typeof segment.data === "object" && !Array.isArray(segment.data);
}
async function refreshMessageMedia(ref, messageId, event) {
	if (!Array.isArray(event.message)) return;
	const segments = event.message.filter(isStoredMediaSegment);
	const voiceVideoSegments = segments.filter((segment) => segment.type !== "image");
	const media = voiceVideoSegments.length > 0 ? (await ref.messageStore.findMedia(messageId))?.filter((element) => element.type !== "image") : null;
	const meta = voiceVideoSegments.length > 0 ? await ref.messageStore.findMeta(messageId) : null;
	const voiceVideo = meta && media && media.length === voiceVideoSegments.length && media.every((element, index) => element.type === voiceVideoSegments[index].type) ? {
		media,
		meta
	} : null;
	if (voiceVideoSegments.length > 0 && !voiceVideo) log$50.warn("[get_msg] media metadata missing or inconsistent message_id=%d", messageId);
	let voiceVideoIndex = 0;
	let changed = false;
	for (const [index, segment] of segments.entries()) try {
		let url;
		if (segment.type === "image") {
			const file = typeof segment.data.file === "string" ? segment.data.file : segment.data.file_id;
			if (typeof file !== "string" || !file) continue;
			url = await resolveImageUrl(await ref.mediaStore.findImage(file), ref.converterCtx.imageUrlResolver);
		} else {
			if (!voiceVideo) continue;
			const element = voiceVideo.media[voiceVideoIndex++];
			url = await resolveRemoteMediaUrl(ref.bridge, element.type, element.mediaNode, voiceVideo.meta.isGroup, voiceVideo.meta.targetId);
		}
		if (url && url !== segment.data.url) {
			segment.data.url = url;
			changed = true;
		}
	} catch (err) {
		log$50.warn("[get_msg] media URL refresh failed message_id=%d type=%s media_index=%d: %s", messageId, segment.type, index, err instanceof Error ? err.message : String(err));
	}
	if (changed) event.raw_message = segmentsToRawMessage(event.message);
}
async function resolveImageUrl(cached, resolver) {
	if (!cached?.imageUrl || !resolver) return null;
	return resolver({
		type: "image",
		imageUrl: cached.imageUrl,
		subType: cached.subType
	}, cached.isGroup);
}
/**
* Voice-to-text for a received ptt (issue #79 / NapCat `fetch_ptt_text`).
* Resolves the message's `record` segment to its cached fingerprint
* (uuid + md5 + duration/size/format), then drives QQ's native
* `pttTrans.Trans{C2C,Group}PttReq` via the bridge and returns the text.
*/
async function fetchPttText(messageStore, mediaStore, bridge, selfId, messageId) {
	const event = await messageStore.findEvent(messageId);
	if (!event) throw new Error("消息不存在或已被撤回");
	const segments = Array.isArray(event.message) ? event.message : [];
	let file = "";
	for (const seg of segments) {
		if (typeof seg !== "object" || seg === null || Array.isArray(seg)) continue;
		const so = seg;
		if (so.type !== "record") continue;
		const data = typeof so.data === "object" && so.data !== null && !Array.isArray(so.data) ? so.data : {};
		file = String(data.file ?? data.url ?? "");
		break;
	}
	if (!file) throw new Error("消息中不包含语音");
	const snapshot = (await messageStore.findMedia(messageId))?.find((element) => element.type === "record");
	const cached = snapshot ? {
		...snapshot,
		isGroup: event.message_type === "group",
		sessionId: Number(event.group_id) || selfId
	} : await mediaStore.findRecord(file, "legacy");
	if (!cached) throw new Error("语音不在缓存中，无法转写");
	const isGroup = event.message_type === "group" || cached.isGroup;
	const senderUin = Number(event.user_id) || 0;
	const peerUin = isGroup ? Number(event.group_id) || cached.sessionId : selfId;
	return { text: await requestPttTransText(pttTransKey(selfId, messageId), 2e4, () => bridge.apis.extras.translatePttToText({
		isGroup,
		msgId: messageId,
		senderUin,
		peerUin,
		uuid: cached.fileId || "",
		md5Hex: cached.md5Hex ?? "",
		duration: cached.duration ?? 0,
		size: cached.fileSize ?? 0,
		format: cached.voiceFormat ?? 0
	})) };
}
async function getImageInfo(mediaStore, file, imageUrlResolver) {
	const cached = await mediaStore.findImage(file);
	if (!cached) return null;
	let url = cached.url || cached.imageUrl || "";
	try {
		const fresh = await resolveImageUrl(cached, imageUrlResolver);
		if (fresh) url = fresh;
	} catch (err) {
		log$50.warn("get_image URL refresh failed: %s", err instanceof Error ? err.message : String(err));
	}
	return {
		file: url || cached.file,
		url,
		file_size: String(cached.fileSize ?? 0),
		file_name: cached.fileName || cached.file
	};
}
async function getRecordInfo(bridge, mediaStore, file) {
	const cached = await mediaStore.findRecord(file);
	if (!cached) return null;
	const url = await resolveRemoteMediaUrl(bridge, "record", cached.mediaNode, cached.isGroup, cached.sessionId);
	await mediaStore.updateRecordUrl(file, url);
	return {
		file: url,
		url,
		file_size: String(cached.fileSize ?? 0),
		file_name: cached.fileName || cached.file
	};
}
export {};
