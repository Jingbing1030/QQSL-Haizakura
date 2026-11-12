// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/msg-push/blank-filter.ts"
// original bundle lines 135711-135786  (74 lines) of dist/index.mjs
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
var log$41 = createLogger("MsgPush");
var C2C_CONTROL_TYPES = /* @__PURE__ */ new Set([
	141,
	166,
	167
]);
var C2C_CONTROL_CMDS = /* @__PURE__ */ new Set([
	1,
	73,
	75,
	129,
	131,
	133,
	135,
	192
]);
/**
* Whether a push is a C2C control/system signal that QQ NT never renders as a
* chat message (it dispatches it through `OnRecvSysMsg` instead). Matched by
* `(msgType, c2cCmd)` exactly as the official client's header codec does, so it
* catches these even on the rare occasion they carry junk content that would
* otherwise decode to a stray element. History may skip these before decode;
* the post-decode filter still returns `drop-control` for the same decision.
*/
function isC2cControlPush(head) {
	return C2C_CONTROL_TYPES.has(head.msgType) && C2C_CONTROL_CMDS.has(head.c2cCmd);
}
/**
* Decoder-after bubble decision for friend / group / temp messages.
* Control drops even when a body decoded to elements. Blank drops only when
* there is nothing to decode. A body that had content but decoded to zero
* elements is keep-undecoded, not blank.
*/
function classifyMessageSurvival(head, elements, body) {
	if (isC2cControlPush(head)) return "drop-control";
	if (isOfflineFileReceipt(body)) return "drop-receipt";
	if (elements.length !== 0) return "keep";
	if (hasDecodableContent(body)) return "keep-undecoded";
	return "drop-blank";
}
/** Summarise a body that decoded to zero elements despite carrying content. */
function describeUndecodedBody(body) {
	const parts = (body?.richText?.elems ?? []).map((e) => {
		if (e.commonElem) {
			const ce = e.commonElem;
			const pb = ce.pbElem && ce.pbElem.length > 0 ? ` pbElem=${hexPreview(ce.pbElem, 256)}` : "";
			return `commonElem(svc=${ce.serviceType ?? 0},biz=${ce.businessType ?? 0})${pb}`;
		}
		return Object.keys(e).filter((k) => e[k] != null).join("+") || "(empty)";
	});
	const extras = [];
	if (body?.richText?.ptt) extras.push("ptt");
	if (body?.richText?.notOnlineFile) extras.push("notOnlineFile");
	if (body?.msgContent && body.msgContent.length > 0) extras.push(`msgContent=${hexPreview(body.msgContent, 256)}`);
	return `elems=[${parts.join("; ")}]${extras.length ? ` ${extras.join(" ")}` : ""}`;
}
/** Keep when the message should appear as a bubble. Warns on keep-undecoded. */
function keepDecodedMessage(head, elements, body, kind, fromUin) {
	const survival = classifyMessageSurvival(head, elements, body);
	if (survival === "drop-control" || survival === "drop-receipt" || survival === "drop-blank") return false;
	if (survival === "keep-undecoded") warnUndecodedMessage({
		kind,
		sequence: head.sequence,
		fromUin,
		msgType: head.msgType,
		subType: head.subType,
		body
	});
	return true;
}
function warnUndecodedMessage(info) {
	log$41.warn("message had content but decoded to 0 elements — missing decoder? (kind=%s seq=%d from=%d msgType=%d/%d): %s", info.kind, info.sequence, info.fromUin, info.msgType, info.subType, describeUndecodedBody(info.body));
}
export {};
