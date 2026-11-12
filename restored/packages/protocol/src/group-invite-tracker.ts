// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/group-invite-tracker.ts"
// original bundle lines 46852-46920  (67 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var PAIR_WINDOW_MS = 3e3;
var MAX_INVITES = 1024;
function remember(entries, key, value) {
	entries.delete(key);
	if (entries.size >= MAX_INVITES) {
		const oldest = entries.keys().next();
		if (!oldest.done) entries.delete(oldest.value);
	}
	entries.set(key, value);
}
/** Account-local state shared by incoming invitations and their approval actions. */
var GroupInviteTracker = class {
	cards = /* @__PURE__ */ new Map();
	notices = /* @__PURE__ */ new Map();
	unpaired = [];
	receiveNotice(groupId, uid) {
		const key = `${groupId}:${uid}`;
		const notice = {};
		if (this.pair(key, "notice", notice)) return false;
		remember(this.notices, key, notice);
		return true;
	}
	receiveCard(groupId, sequence, uid) {
		const key = `${groupId}:${sequence}`;
		if (this.cards.has(key)) return false;
		const paired = uid ? this.pair(`${groupId}:${uid}`, "card") : void 0;
		if (paired?.notice) paired.notice.cardSequence = sequence;
		remember(this.cards, key, {
			groupId,
			sequence
		});
		return !paired;
	}
	pair(key, source, notice) {
		const now = Date.now();
		this.unpaired = this.unpaired.filter((entry) => entry.expiresAt > now);
		const match = this.unpaired.findIndex((entry) => entry.key === key && entry.source !== source);
		if (match !== -1) return this.unpaired.splice(match, 1)[0];
		if (this.unpaired.length >= MAX_INVITES) this.unpaired.shift();
		if (notice && this.unpaired.some((entry) => entry.key === key && entry.source === "notice")) notice.ambiguous = true;
		this.unpaired.push({
			key,
			source,
			notice,
			expiresAt: now + PAIR_WINDOW_MS
		});
	}
	getSelfInviteNotice(groupId, uid) {
		const notice = this.notices.get(`${groupId}:${uid}`);
		if (notice?.ambiguous) throw new Error("multiple pending self invitations share this flag");
		return notice;
	}
	getCardSequence(groupId) {
		let sequence;
		for (const card of this.cards.values()) if (card.groupId === groupId) sequence = card.sequence;
		return sequence;
	}
	findCardGroup(sequence, groupId) {
		if (groupId !== void 0) return this.cards.get(`${groupId}:${sequence}`)?.groupId;
		let match;
		for (const card of this.cards.values()) if (card.sequence === sequence) {
			if (match !== void 0) throw new Error("multiple groups match this invitation card sequence");
			match = card.groupId;
		}
		return match;
	}
};
export {};
