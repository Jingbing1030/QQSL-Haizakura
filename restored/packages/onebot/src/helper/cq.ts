// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/helper/cq.ts"
// original bundle lines 22571-22626  (54 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function segmentToCQ(seg) {
	const type = String(seg.type ?? "");
	const data = seg.data ?? {};
	switch (type) {
		case "text": return cqEscape(String(data.text ?? ""));
		case "face": return `[CQ:face,id=${data.id ?? 0}${data.resultId !== void 0 ? `,resultId=${cqEscape(String(data.resultId))}` : ""}]`;
		case "image": return `[CQ:image,file=${cqEscape(String(data.file ?? ""))},url=${cqEscape(String(data.url ?? ""))}]`;
		case "at": return `[CQ:at,qq=${data.qq ?? ""}]`;
		case "reply": return `[CQ:reply,id=${data.id ?? 0}]`;
		case "record": return `[CQ:record,file=${cqEscape(String(data.file ?? ""))},url=${cqEscape(String(data.url ?? ""))}]`;
		case "video": return `[CQ:video,file=${cqEscape(String(data.file ?? ""))},url=${cqEscape(String(data.url ?? ""))}]`;
		case "json": return `[CQ:json,data=${cqEscape(String(data.data ?? ""))}]`;
		case "xml": return `[CQ:xml,data=${cqEscape(String(data.data ?? ""))}]`;
		case "forward": return `[CQ:forward,id=${cqEscape(String(data.id ?? ""))}]`;
		case "mface": return `[CQ:mface,name=${cqEscape(String(data.name ?? ""))}]`;
		case "poke": return `[CQ:poke,type=${data.type ?? 0}]`;
		case "file": return `[CQ:file,name=${cqEscape(String(data.name ?? ""))},size=${data.size ?? 0},id=${cqEscape(String(data.id ?? ""))},url=${cqEscape(String(data.url ?? ""))}]`;
		default: return `[CQ:${type}]`;
	}
}
function segmentsToRawMessage(segments) {
	return segments.map((seg) => segmentToCQ(seg)).join("");
}
function cqEscape(text) {
	return text.replace(/&/g, "&amp;").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;").replace(/,/g, "&#44;");
}
function cqUnescape(text) {
	return text.replace(/&#91;/g, "[").replace(/&#93;/g, "]").replace(/&#44;/g, ",").replace(/&amp;/g, "&");
}
async function parseFromCQString(message, options) {
	const elements = [];
	let lastIndex = 0;
	for (const match of message.matchAll(CQ_REGEX)) {
		if (match.index > lastIndex) {
			const text = cqUnescape(message.substring(lastIndex, match.index));
			if (text) elements.push({
				type: "text",
				text
			});
		}
		lastIndex = match.index + match[0].length;
		const cqType = match[1];
		const elem = await segmentToElement(cqType, parseCQParams(match[2] || ""), options);
		if (elem) elements.push(elem);
	}
	if (lastIndex < message.length) {
		const text = cqUnescape(message.substring(lastIndex));
		if (text) elements.push({
			type: "text",
			text
		});
	}
	return elements;
}
export {};
