// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/reply-preview.ts"
// original bundle lines 22156-22204  (47 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var labels$1 = {
	image: "[图片]",
	record: "[语音]",
	video: "[视频]",
	file: "[文件]",
	face: "[表情]",
	mface: "[表情]",
	forward: "[聊天记录]",
	json: "[卡片]",
	xml: "[卡片]",
	markdown: "[Markdown]"
};
function previewLabel(type) {
	if (!Object.hasOwn(labels$1, type)) throw new MessageElementValidationError("UNSENDABLE_TYPE", `message segment "${type}" is not supported in a reply preview`, type);
	return labels$1[type];
}
function assertReplyPreviewType(type) {
	if (type !== "text" && type !== "at") previewLabel(type);
}
/** Quotes carry display text; media must not be uploaded again for a preview. */
function elementsToReplyPreview(elements) {
	return [{
		type: "text",
		text: elements.map((element) => {
			if (element.type === "text") return element.text;
			if (element.type === "at") return element.targetUin === 0 ? "@全体成员" : `@${element.targetUin}`;
			return previewLabel(element.type);
		}).join("")
	}];
}
function replyPreviewElements(message) {
	if (!Array.isArray(message)) return [];
	const parts = [];
	for (const segment of message) {
		if (!segment || typeof segment !== "object") continue;
		const data = segment.data;
		if (!data || typeof data !== "object") continue;
		if (segment.type === "text" && typeof data.text === "string") parts.push(data.text);
		else if (segment.type === "at") parts.push(data.qq === "all" ? "@全体成员" : `@${data.qq ?? ""}`);
		else if (typeof segment.type === "string" && Object.hasOwn(labels$1, segment.type)) parts.push(labels$1[segment.type]);
	}
	const text = parts.join("");
	return text ? [{
		type: "text",
		text
	}] : [];
}
export {};
