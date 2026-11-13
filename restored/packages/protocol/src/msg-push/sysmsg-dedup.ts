// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/msg-push/sysmsg-dedup.ts"
// original bundle lines 153904-153967  (62 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function getNativeSysMsgChatType(msgType, subType) {
	if (msgType === 528 && subType === 290) return 1;
	if (msgType === 166 && (subType === 75 || subType === 129 || subType === 131 || subType === 133 || subType === 135)) return 1;
	if (msgType === 167 && subType === 133) return 1;
	if (msgType === 732 && (subType === 12 || subType === 16 || subType === 20)) return 2;
	if ((msgType === 33 || msgType === 34 || msgType === 85) && subType === 0) return 2;
	return null;
}
/**
* Derive the identity used by QQ NT's system-message dedup. Only the static
* `(msgType, subType)` routes proven in `sys_msg_mgr.cc` participate; unknown
* routes fail open rather than risking suppression of unrelated events.
*/
function deriveSysMsgDedupIdentity(ctx) {
	const { head } = ctx;
	const chatType = getNativeSysMsgChatType(head.msgType, head.subType);
	if (chatType === null || head.sequence === 0 || head.msgId === 0) return null;
	const peerUid = chatType === 1 ? ctx.fromUid : String(ctx.fromUin);
	if (!peerUid || chatType === 2 && ctx.fromUin === 0) return null;
	return {
		peerUid,
		chatType,
		sequence: head.sequence,
		random: head.msgId
	};
}
/**
* Mirrors QQ NT's system-message dedup so Haizakura stops double-reporting raw
* OlPush system events that the QQ kernel would discard before notifying its
* listeners.
*
* macOS QQ 6.9.98 `sys_msg_mgr.cc::ProcessRecvSysMsg` (`sub_E4B94A`) builds:
*
*     global_key = `{peerUid}_{chatType}_{msg_seq}_{random}`
*
* `sub_E523C8` maps content-head fields 5 and 4 to `msg_seq` and `random`.
* `sub_E4B30D` supplies chatType from a static `(msgType, subType)` table, and
* `sub_E4B62A` selects response-head `fromUid` for C2C or decimal `fromUin` for
* groups. {@link deriveSysMsgDedupIdentity} mirrors those routes exactly.
*/
var SysMsgDedup = class {
	capacity;
	seen = /* @__PURE__ */ new Set();
	ring;
	cursor = 0;
	constructor(capacity = 1024) {
		this.capacity = capacity;
		this.ring = new Array(capacity);
	}
	/** Returns true when this native system-message identity was already seen. */
	seenDuplicate(identity) {
		if (identity.sequence === 0 || identity.random === 0 || !identity.peerUid) return false;
		const key = `${identity.peerUid}_${identity.chatType}_${identity.sequence}_${identity.random}`;
		if (this.seen.has(key)) return true;
		const evicted = this.ring[this.cursor];
		if (evicted !== void 0) this.seen.delete(evicted);
		this.ring[this.cursor] = key;
		this.seen.add(key);
		this.cursor = (this.cursor + 1) % this.capacity;
		return false;
	}
};
export {};
