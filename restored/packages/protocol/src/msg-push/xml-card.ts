// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/msg-push/xml-card.ts"
// original bundle lines 122166-122223  (56 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var NAME_START = ":A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}";
var ATTRIBUTE = new RegExp(`([${NAME_START}][\\u0300-\\u036F${NAME_START}\\-.0-9\\u00B7\\u203F-\\u2040]*)[\\t\\r\\n ]*=[\\t\\r\\n ]*(?:"([^"<]*)"|'([^'<]*)')`, "uy");
var SPACE = /[\t\r\n ]*/y;
var ENTITIES = /* @__PURE__ */ new Map([
	["amp", "&"],
	["lt", "<"],
	["gt", ">"],
	["quot", "\""],
	["apos", "'"]
]);
function decodeAttribute(value) {
	let valid = true;
	const decoded = value.replace(/\r\n|[\t\r\n]/g, " ").replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);|&/g, (_match, entity) => {
		const named = entity === void 0 ? void 0 : ENTITIES.get(entity);
		if (named !== void 0) return named;
		if (entity?.startsWith("#")) {
			const code = entity.startsWith("#x") ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
			if (code === 9 || code === 10 || code === 13 || code >= 32 && code <= 55295 || code >= 57344 && code <= 65533 || code >= 65536 && code <= 1114111) return String.fromCodePoint(code);
		}
		valid = false;
		return "";
	});
	return valid ? decoded : void 0;
}
/** Read the first element's attributes without searching comments, values or descendants. */
function readXmlMsgAttributes(content) {
	let cursor = content.startsWith("﻿") ? 1 : 0;
	for (;;) {
		SPACE.lastIndex = cursor;
		SPACE.exec(content);
		cursor = SPACE.lastIndex;
		const closing = content.startsWith("<!--", cursor) ? "-->" : content.startsWith("<?", cursor) ? "?>" : void 0;
		if (!closing) break;
		const end = content.indexOf(closing, cursor + (closing === "-->" ? 4 : 2));
		if (end < 0) return;
		cursor = end + closing.length;
	}
	if (!content.startsWith("<msg", cursor)) return;
	cursor += 4;
	const attributes = /* @__PURE__ */ new Map();
	for (;;) {
		const beforeSpace = cursor;
		SPACE.lastIndex = cursor;
		SPACE.exec(content);
		cursor = SPACE.lastIndex;
		if (content[cursor] === ">" || content.startsWith("/>", cursor)) return attributes;
		if (cursor === beforeSpace) return;
		ATTRIBUTE.lastIndex = cursor;
		const match = ATTRIBUTE.exec(content);
		if (!match || attributes.has(match[1])) return;
		const value = decodeAttribute(match[2] ?? match[3]);
		if (value === void 0) return;
		attributes.set(match[1], value);
		cursor = ATTRIBUTE.lastIndex;
	}
}
export {};
