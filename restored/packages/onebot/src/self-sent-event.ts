// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/self-sent-event.ts"
// original bundle lines 37783-37904  (120 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var SELF_SENT_ECHO_WINDOW_MS = 12e4;
/**
* Match a reported self send with a later QQ echo, including repeated
* pushes. The message hash alone is insufficient because it is a signed 32-bit
* value and can collide; sequence, conversation and a bounded time window are
* part of the identity as well.
*/
function sameSelfSentMessage(left, right) {
	const leftKey = selfSentEventKey(left);
	const rightKey = selfSentEventKey(right);
	if (leftKey === null || leftKey !== rightKey) return false;
	const leftTime = toInt$3(left.time);
	const rightTime = toInt$3(right.time);
	return leftTime > 0 && rightTime > 0 && Math.abs(leftTime - rightTime) * 1e3 <= 12e4;
}
/** Stable identity for a self-sent event, excluding its bounded timestamp. */
function selfSentEventKey(event) {
	if (event.post_type !== "message_sent") return null;
	if (event.message_type !== "private" && event.message_type !== "group") return null;
	const messageId = toInt$3(event.message_id);
	const sequence = toInt$3(event.message_seq);
	const session = event.message_type === "group" ? toInt$3(event.group_id) : toInt$3(event.target_id) || toInt$3(event.user_id);
	if (messageId === 0 || sequence <= 0 || session <= 0) return null;
	return `${event.message_type}:${session}:${sequence}:${messageId}`;
}
function toInt$3(value) {
	if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return Math.trunc(parsed);
	}
	return 0;
}
var TIME_WINDOWS = [
	0,
	5,
	30
];
function isUsableQuoteTime(timestamp) {
	return timestamp !== void 0 && Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp < Number.MAX_SAFE_INTEGER;
}
/** Sequence namespaces may overlap. Only a unique, consistent candidate wins. */
function selectPrivateQuote(candidates, quote) {
	const time = isUsableQuoteTime(quote.timestamp) ? quote.timestamp : null;
	const text = quote.elements?.length && quote.elements.every((element) => element.type === "text") ? quote.elements.map((element) => element.text ?? "").join("") : "";
	const nearby = candidates.filter((candidate) => {
		const source = quote.exclude;
		if (source && (candidate.id === source.id || source.sentBySelf === quote.sentBySelf && (source.sequence > 0 && candidate.sequence === source.sequence || source.clientSequence > 0 && candidate.clientSequence === source.clientSequence && candidate.timestamp === source.timestamp))) return false;
		return time === null || Math.abs(candidate.timestamp - time) <= 30;
	});
	const compatible = nearby.filter((candidate) => !text || !candidate.preview || candidate.preview.text.startsWith(text));
	const bySequence = compatible.filter((candidate) => quote.sequence > 0 && (candidate.clientSequence === quote.sequence || candidate.sequence === quote.sequence));
	if (bySequence.length > 0) return {
		candidate: bySequence.length === 1 ? bySequence[0] : null,
		reason: bySequence.length === 1 ? "sequence" : "ambiguous"
	};
	if (quote.sentBySelf && time !== null) for (const window of TIME_WINDOWS) {
		const matches = compatible.filter((candidate) => Math.abs(candidate.timestamp - time) <= window);
		if (matches.length > 0) {
			const match = matches.length === 1 ? matches[0] : null;
			const windowCount = nearby.filter((candidate) => Math.abs(candidate.timestamp - time) <= window).length;
			const confirmed = match && (!text || match.preview && (windowCount === 1 || match.preview.plain && match.preview.text === text));
			return {
				candidate: confirmed ? match : null,
				reason: confirmed ? "time" : "ambiguous"
			};
		}
	}
	return {
		candidate: null,
		reason: "missing"
	};
}
var labels = {
	image: "[图片]",
	record: "[语音]",
	video: "[视频]",
	file: "[文件]",
	face: "[表情]",
	mface: "[表情]",
	forward: "[聊天记录]",
	json: "[卡片]",
	xml: "[卡片]"
};
function cachedQuotePreview(data) {
	if (!data) return null;
	const event = JSON.parse(data);
	if (typeof event.message === "string") return event.message.includes("[CQ:") ? null : {
		text: cqUnescape(event.message),
		plain: true
	};
	if (!Array.isArray(event.message) || event.message.length === 0) return null;
	const parts = [];
	let plain = true;
	for (const segment of event.message) {
		const body = segment?.data;
		if (segment?.type === "text" && typeof body?.text === "string") parts.push(body.text);
		else if (typeof segment?.type === "string" && Object.hasOwn(labels, segment.type)) {
			parts.push(typeof body?.summary === "string" ? body.summary : labels[segment.type]);
			plain = false;
		} else return null;
	}
	return {
		text: parts.join(""),
		plain
	};
}
function messageQuotePreview(elements) {
	const parts = [];
	let plain = true;
	for (const element of elements) if (element.type === "text") parts.push(element.text ?? "");
	else if (Object.hasOwn(labels, element.type)) {
		parts.push("summary" in element && typeof element.summary === "string" ? element.summary : labels[element.type]);
		plain = false;
	} else return null;
	return parts.length > 0 ? {
		text: parts.join(""),
		plain
	} : null;
}
export {};
