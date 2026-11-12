// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/temp-session-store.ts"
// original bundle lines 40138-40179  (40 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/**
* Records the group temp sessions the bot has received a message from, so a
* reply can be limited to sessions the peer opened. Written only on the receive
* path, read only on the send path. Keyed by `${userUin}:${groupUin}` — a user
* may hold sessions from several groups. Entries expire after
* {@link TEMP_SESSION_TTL_MS}.
*/
/** Reply window: 7 days after the last inbound temp message. */
var TEMP_SESSION_TTL_MS = 10080 * 60 * 1e3;
var TempSessionStore = class TempSessionStore {
	/** key → expiry epoch ms. */
	sessions = /* @__PURE__ */ new Map();
	static key(userUin, groupUin) {
		return `${userUin}:${groupUin}`;
	}
	/**
	* Record (or refresh) an inbound temp session. Called from the receive path.
	* No-op without a source group (groupUin<=0) — the session stays receive-only.
	*/
	record(userUin, groupUin, now = Date.now()) {
		if (userUin <= 0 || groupUin <= 0) return;
		this.sweep(now);
		this.sessions.set(TempSessionStore.key(userUin, groupUin), now + TEMP_SESSION_TTL_MS);
	}
	/** True iff a reply is allowed for this exact (user, group). Prunes on read. */
	has(userUin, groupUin, now = Date.now()) {
		const key = TempSessionStore.key(userUin, groupUin);
		const expiresAt = this.sessions.get(key);
		if (expiresAt === void 0) return false;
		if (expiresAt <= now) {
			this.sessions.delete(key);
			return false;
		}
		return true;
	}
	/** Drop all expired entries. `has` also prunes lazily. */
	sweep(now = Date.now()) {
		for (const [key, expiresAt] of this.sessions) if (expiresAt <= now) this.sessions.delete(key);
	}
};
export {};
