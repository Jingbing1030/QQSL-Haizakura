// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/identity-service.ts"
// original bundle lines 343657-344730  (1072 lines) of dist/index.mjs
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
var moduleLogger = createLogger("Identity");
var PERSISTENCE_QUEUE_CAPACITY = 256;
var PERSISTENCE_RETRY_DELAYS_MS = [
	100,
	500,
	2e3,
	1e4,
	3e4
];
/** After persistence is suspended, do not warn on every skipped write. */
var SKIPPED_WRITE_LOG_INTERVAL_MS = 6e4;
/**
* Authoritative store for everything we know about QQ actors observed
* during this session: the bot's own identity, friends, groups, group
* members, user profiles, plus the bidirectional UID↔UIN index that
* powers all OIDB-bound translation.
*
* Two layers internally:
*   - In-memory state (this file) — O(1) for find* on the hot path.
*   - SQLite (optional, opened by openForUin) — survives restarts.
*
* Memory is authoritative for the current process. SQLite is a rebuildable,
* best-effort snapshot: failures degrade into a bounded retry queue and are
* exposed through persistenceStatus instead of rolling back observations.
*/
var IdentityService = class IdentityService {
	uin_;
	nickname_ = "";
	selfProfile_ = null;
	userProfiles_ = /* @__PURE__ */ new Map();
	friends_ = [];
	groups_ = /* @__PURE__ */ new Map();
	uinByUid = /* @__PURE__ */ new Map();
	uidByUin = /* @__PURE__ */ new Map();
	db;
	inTransaction = false;
	fetcher = null;
	log;
	pendingWrites_ = [];
	retryTimer_ = null;
	retryAttempt_ = 0;
	nextRetryAt_ = null;
	lastFailedLabel_ = "";
	lastError_ = "";
	lastFailureAt_ = null;
	abandonedWrites_ = 0;
	skippedWrites_ = 0;
	skippedWritesSinceLog_ = 0;
	lastSkippedWriteLogAt_ = 0;
	persistenceSuspended_ = false;
	closed_ = false;
	closing_ = null;
	flushing_ = null;
	loaded_ = false;
	replaying_ = false;
	initialObservations_ = [];
	persistedUinByUid = /* @__PURE__ */ new Map();
	persistedUidByUin = /* @__PURE__ */ new Map();
	persistedMembersByUid = /* @__PURE__ */ new Map();
	persistedMembersByUin = /* @__PURE__ */ new Map();
	initialization;
	constructor(uin, dbPath, beforeOpen) {
		this.uin_ = uin;
		const uinNum = Number.parseInt(uin, 10);
		this.log = Number.isFinite(uinNum) && uinNum > 0 ? moduleLogger.child({ uin: uinNum }) : moduleLogger;
		if (!dbPath) {
			this.db = null;
			this.loaded_ = true;
			this.initialization = Promise.resolve();
			return;
		}
		this.db = new SqliteDatabase(dbPath, {
			busyTimeout: 0,
			beforeOpen
		});
		this.initialization = this.db.serial(async () => {
			await this.initSchema();
			await this.migrateSchema();
			await this.loadSnapshot();
			this.loaded_ = true;
			this.replaying_ = true;
			try {
				while (this.initialObservations_.length) this.initialObservations_.shift()();
			} finally {
				this.replaying_ = false;
			}
		});
		this.initialization.then(() => this.flushPendingWrites()).catch((error) => {
			this.recordPersistenceFailure("initialization", error);
		});
	}
	static openForUin(uin, dataRoot = "data", beforeOpen) {
		return new IdentityService(uin, path$1.join(dataRoot, uin, "snowluma_identity.db"), beforeOpen);
	}
	static memory(uin) {
		return new IdentityService(uin, null);
	}
	close() {
		if (this.closed_) return Promise.resolve();
		const closing = this.closing_ ??= {
			drained: this.prepareClose(),
			task: null
		};
		if (closing.task) return closing.task;
		closing.task = this.closePersistence(closing.drained);
		closing.task.catch(() => {
			closing.task = null;
		});
		return closing.task;
	}
	async prepareClose() {
		if (this.retryTimer_) clearTimeout(this.retryTimer_);
		this.retryTimer_ = null;
		this.nextRetryAt_ = null;
		await this.initialization;
		await this.flushPendingWrites(false);
	}
	async closePersistence(drained) {
		try {
			try {
				await drained;
			} catch (error) {
				await this.db?.close();
				this.closed_ = true;
				throw error;
			}
			const pending = this.pendingWrites_.length;
			if (pending) this.log.warn("identity persistence close with pending writes: uin=%s label=%s pending=%d retry=%d err=%s", this.uin_, this.lastFailedLabel_, pending, this.retryAttempt_, this.lastError_);
			await this.db?.close();
			this.abandonedWrites_ += pending;
			this.pendingWrites_.length = 0;
			this.closed_ = true;
		} catch (error) {
			this.lastError_ = error instanceof Error ? error.stack ?? error.message : String(error);
			this.lastFailureAt_ = Date.now();
			this.log.error("identity persistence close failed: uin=%s label=%s pending=%d retry=%d err=%s", this.uin_, this.lastFailedLabel_, this.pendingWrites_.length, this.retryAttempt_, this.lastError_);
			throw error;
		}
	}
	get persistent() {
		return this.db !== null;
	}
	get persistenceStatus() {
		let state;
		if (this.closed_) state = "closed";
		else if (!this.db) state = "memory-only";
		else if (this.persistenceSuspended_ || this.pendingWrites_.length > 0) state = "degraded";
		else state = "healthy";
		return {
			state,
			suspended: this.persistenceSuspended_,
			pendingWrites: this.pendingWrites_.length,
			queueCapacity: PERSISTENCE_QUEUE_CAPACITY,
			lastFailedLabel: this.lastFailedLabel_,
			lastError: this.lastError_,
			lastFailureAt: this.lastFailureAt_,
			retryAttempt: this.retryAttempt_,
			nextRetryAt: this.nextRetryAt_,
			abandonedWrites: this.abandonedWrites_,
			skippedWrites: this.skippedWrites_
		};
	}
	setFetcher(fetcher) {
		this.fetcher = fetcher;
	}
	get uin() {
		return this.uin_;
	}
	get nickname() {
		return this.nickname_;
	}
	set nickname(v) {
		this.assertOpen("nickname");
		this.nickname_ = v;
	}
	get selfProfile() {
		return this.selfProfile_;
	}
	get selfUid() {
		return this.selfProfile_?.uid ?? null;
	}
	setSelfProfile(info) {
		this.assertOpen("self profile");
		this.selfProfile_ = { ...info };
	}
	findUserProfile(uin) {
		return this.userProfiles_.get(uin) ?? null;
	}
	get friends() {
		return this.friends_;
	}
	findFriend(uin) {
		return this.friends_.find((f) => f.uin === uin) ?? null;
	}
	get groups() {
		return [...this.groups_.values()];
	}
	findGroup(groupId) {
		return this.groups_.get(groupId) ?? null;
	}
	findGroupMember(groupId, uin) {
		return this.groups_.get(groupId)?.members.get(uin) ?? null;
	}
	updateGroupMember(groupId, member) {
		this.assertOpen("group member update");
		const g = this.groups_.get(groupId);
		if (!g) return;
		this.assertPersistenceCapacity("group member update");
		const observed = { ...member };
		const persisted = {
			groupId,
			...observed,
			active: true
		};
		g.members.set(observed.uin, observed);
		this.rememberUidUin(observed.uid, observed.uin);
		this.runWrite("group member update", async () => await this.transaction(async () => await this.upsertGroupMember(persisted)));
	}
	/** Apply a server-confirmed update to the bot's local label for one group. */
	updateGroupRemark(groupId, remark) {
		this.beginObservation("group remark update");
		if (!this.loaded_) {
			const snapshot = structuredClone([groupId, remark]);
			this.initialObservations_.push(() => {
				this.updateGroupRemark(...snapshot);
			});
		}
		if (!Number.isSafeInteger(groupId) || groupId <= 0) throw new Error(`group remark update has invalid group id: ${groupId}`);
		if (typeof remark !== "string") throw new Error("group remark update must be a string");
		const group = this.groups_.get(groupId);
		if (!group) return false;
		const observed = {
			...group,
			remark
		};
		const persisted = {
			groupId,
			groupName: observed.groupName,
			remark: observed.remark,
			memberCount: observed.memberCount,
			memberMax: observed.memberMax
		};
		this.groups_.set(groupId, observed);
		this.runWrite("group remark update", async () => await this.transaction(async () => await this.upsertGroup(persisted)));
		return true;
	}
	/** Apply the server-authoritative friend/stranger remark synchronization push. */
	updateFriendRemark(uid, uin, remark) {
		this.beginObservation("friend remark update");
		if (!this.loaded_) {
			const snapshot = structuredClone([
				uid,
				uin,
				remark
			]);
			this.initialObservations_.push(() => {
				this.updateFriendRemark(...snapshot);
			});
		}
		const normalizedUid = normalizeUid(uid);
		const normalizedUin = normalizeUin(uin);
		if (!normalizedUid && normalizedUin === null) throw new Error("friend remark update is missing both UID and UIN");
		const byUid = normalizedUid ? this.friends_.find((friend) => friend.uid === normalizedUid) ?? null : null;
		const byUin = normalizedUin !== null ? this.friends_.find((friend) => friend.uin === normalizedUin) ?? null : null;
		if (byUid && byUin && byUid !== byUin) throw new Error(`friend remark update identity mismatch: uid=${normalizedUid} uin=${normalizedUin}`);
		const friend = byUid ?? byUin;
		if (friend && normalizedUid && friend.uid && friend.uid !== normalizedUid) throw new Error(`friend remark update UID mismatch for uin=${friend.uin}`);
		if (friend && normalizedUin !== null && friend.uin !== normalizedUin) throw new Error(`friend remark update UIN mismatch for uid=${friend.uid}`);
		const observedUid = normalizedUid || friend?.uid || "";
		const observedUin = normalizedUin ?? friend?.uin ?? 0;
		if (friend) {
			const index = this.friends_.indexOf(friend);
			this.friends_[index] = {
				...friend,
				remark
			};
		}
		const profile = observedUin > 0 ? this.userProfiles_.get(observedUin) : void 0;
		if (profile) this.userProfiles_.set(observedUin, {
			...profile,
			remark
		});
		this.rememberUidUin(observedUid, observedUin);
		const persisted = {
			uid: observedUid || void 0,
			uin: observedUin > 0 ? observedUin : void 0,
			remark,
			isFriend: friend ? true : void 0
		};
		this.runWrite("friend remark update", async () => await this.transaction(async () => await this.upsertUser(persisted)));
		return friend !== null;
	}
	/**
	* UIN → UID with network fallback. Returns cached value on hit; otherwise
	* invokes the registered fetcher (typically `bridge.fetchUserProfile`),
	* which is expected to write the result back through `rememberUserProfile`
	* before this method re-queries the cache. Throws if no UID can be
	* obtained from any layer.
	*/
	async resolveUid(uin, groupId) {
		await this.initialization;
		const normalized = normalizeUin(uin);
		if (normalized === null) throw new Error(`invalid uin: ${uin}`);
		const cached = this.findUidByUin(normalized, groupId);
		if (cached) return cached;
		if (groupId !== void 0 && this.fetcher?.fetchGroupMemberList) {
			try {
				await this.fetcher.fetchGroupMemberList(groupId);
			} catch {}
			const afterMembers = this.findUidByUin(normalized, groupId);
			if (afterMembers) return afterMembers;
		}
		if (!this.fetcher) throw new Error(`failed to resolve UID for UIN ${normalized}: no fetcher`);
		const profile = await this.fetcher.fetchProfile(normalized);
		if (profile.uid) return profile.uid;
		throw new Error(`failed to resolve UID for UIN ${normalized}`);
	}
	/**
	* Inbound UID→UIN. Sync cache/DB (including a numeric UID) first; on miss,
	* `fetchProfileByUid`. Returns null when still unknown. Never throws for a
	* miss, a fetcher error, or a missing fetcher — inbound events still emit.
	* Does not pull a group member list; that remains a roster side-effect.
	*/
	async resolveUin(uid, groupId) {
		await this.initialization;
		const cached = this.findUinByUid(uid, groupId);
		if (cached !== null) return cached;
		const normalized = normalizeUid(uid);
		if (!normalized || !this.fetcher?.fetchProfileByUid) return null;
		try {
			const uin = normalizeUin((await this.fetcher.fetchProfileByUid(normalized)).uin);
			if (uin !== null) return uin;
		} catch {}
		return this.findUinByUid(normalized, groupId);
	}
	findUinByUid(uid, groupId) {
		const normalized = normalizeUid(uid);
		if (!normalized) return null;
		const numeric = numericUidAsUin(normalized);
		if (numeric !== null) return numeric;
		if (groupId !== void 0) {
			const member = this.findGroupMemberByUid(groupId, normalized);
			if (member) return member.uin;
		}
		const mapped = this.uinByUid.get(normalized);
		if (mapped !== void 0) return mapped;
		const member = groupId === void 0 ? void 0 : this.persistedMembersByUid.get(`${groupId}:${normalized}`);
		if (member !== void 0 && this.isDatabaseMappingCurrent(normalized, member)) return member;
		const persisted = this.persistedUinByUid.get(normalized);
		return persisted !== void 0 && this.isDatabaseMappingCurrent(normalized, persisted) ? persisted : null;
	}
	findUidByUin(uin, groupId) {
		const normalized = normalizeUin(uin);
		if (normalized === null) return null;
		if (groupId !== void 0) {
			const member = this.groups_.get(groupId)?.members.get(normalized);
			if (member?.uid) return member.uid;
		}
		const mapped = this.uidByUin.get(normalized);
		if (mapped) return mapped;
		const member = groupId === void 0 ? void 0 : this.persistedMembersByUin.get(`${groupId}:${normalized}`);
		if (member && this.isDatabaseMappingCurrent(member, normalized)) return member;
		const persisted = this.persistedUidByUin.get(normalized);
		return persisted && this.isDatabaseMappingCurrent(persisted, normalized) ? persisted : null;
	}
	rememberFriends(friends) {
		this.beginObservation("friends");
		if (!this.loaded_) {
			const snapshot = structuredClone([friends]);
			this.initialObservations_.push(() => {
				this.rememberFriends(...snapshot);
			});
		}
		const observed = friends.map((friend) => ({ ...friend }));
		const persisted = observed.map((friend) => ({
			uid: friend.uid,
			uin: friend.uin,
			nickname: friend.nickname,
			remark: friend.remark,
			isFriend: true,
			source: "friend"
		}));
		this.friends_ = observed;
		for (const friend of observed) this.rememberUidUin(friend.uid, friend.uin);
		this.runWrite("friends", async () => await this.transaction(async () => {
			await this.db.prepare("UPDATE users SET is_friend = 0, updated_at = ? WHERE is_friend = 1").run(nowSeconds());
			for (const friend of persisted) await this.upsertUser(friend);
		}));
	}
	rememberGroups(groups) {
		this.beginObservation("groups");
		if (!this.loaded_) {
			const snapshot = structuredClone([groups]);
			this.initialObservations_.push(() => {
				this.rememberGroups(...snapshot);
			});
		}
		const observed = groups.map((group) => ({
			...group,
			members: new Map([...group.members ?? /* @__PURE__ */ new Map()].map(([uin, member]) => [uin, { ...member }]))
		}));
		const persisted = observed.map((group) => ({
			groupId: group.groupId,
			groupName: group.groupName,
			remark: group.remark,
			memberCount: group.memberCount,
			memberMax: group.memberMax
		}));
		this.setGroupsInMemory(observed);
		this.runWrite("groups", async () => await this.transaction(async () => {
			await this.db.prepare("UPDATE groups SET active = 0, updated_at = ? WHERE active = 1").run(nowSeconds());
			for (const group of persisted) await this.upsertGroup(group);
		}));
	}
	/**
	* Drop a single group from the roster after the bot leaves/is removed, so
	* `get_group_list` and member lookups stop returning a group we're no longer
	* in (#133). Removes the in-memory entry and marks the DB row inactive so it
	* doesn't resurrect on the next load (the server refetch won't include it).
	*/
	forgetGroup(groupId) {
		this.beginObservation("forget group");
		if (!this.loaded_) {
			const snapshot = structuredClone([groupId]);
			this.initialObservations_.push(() => {
				this.forgetGroup(...snapshot);
			});
		}
		this.groups_.delete(groupId);
		this.runWrite("forget group", async () => {
			await this.db.prepare("UPDATE groups SET active = 0, updated_at = ? WHERE group_id = ?").run(nowSeconds(), groupId);
		});
	}
	rememberGroupMembers(groupId, members) {
		this.beginObservation("group members");
		if (!this.loaded_) {
			const snapshot = structuredClone([groupId, members]);
			this.initialObservations_.push(() => {
				this.rememberGroupMembers(...snapshot);
			});
		}
		const observed = members.map((member) => ({ ...member }));
		const persisted = observed.map((member) => ({
			groupId,
			...member,
			active: true
		}));
		this.setGroupMembersInMemory(groupId, observed);
		for (const member of observed) this.rememberUidUin(member.uid, member.uin);
		this.runWrite("group members", async () => await this.transaction(async () => {
			await this.upsertGroup({
				groupId,
				memberCount: persisted.length
			});
			await this.db.prepare("UPDATE group_members SET active = 0, updated_at = ? WHERE group_id = ?").run(nowSeconds(), groupId);
			for (const member of persisted) await this.upsertGroupMember(member);
		}));
	}
	rememberUserProfile(info) {
		this.beginObservation("user profile");
		if (!this.loaded_) {
			const snapshot = structuredClone([info]);
			this.initialObservations_.push(() => {
				this.rememberUserProfile(...snapshot);
			});
		}
		const observed = { ...info };
		const persisted = {
			uid: observed.uid,
			uin: observed.uin,
			nickname: observed.nickname,
			remark: observed.remark,
			source: "profile"
		};
		this.userProfiles_.set(observed.uin, observed);
		const selfUin = parseInt(this.uin_, 10) || 0;
		if (observed.uin === selfUin) this.selfProfile_ = { ...observed };
		this.rememberUidUin(observed.uid, observed.uin);
		this.runWrite("user profile", async () => await this.transaction(async () => await this.upsertUser(persisted)));
	}
	rememberGroupRequests(requests) {
		this.beginObservation("group requests");
		if (!this.loaded_) {
			const snapshot = structuredClone([requests]);
			this.initialObservations_.push(() => {
				this.rememberGroupRequests(...snapshot);
			});
		}
		const observed = requests.map((request) => ({ ...request }));
		for (const request of observed) {
			this.rememberUidUin(request.targetUid, request.targetUin);
			this.rememberUidUin(request.invitorUid, request.invitorUin);
			this.rememberUidUin(request.operatorUid, request.operatorUin);
		}
		this.runWrite("group requests", async () => await this.transaction(async () => {
			for (const request of observed) {
				await this.upsertUser({
					uid: request.targetUid,
					uin: request.targetUin,
					nickname: request.targetName,
					source: "group_request"
				});
				await this.upsertUser({
					uid: request.invitorUid,
					uin: request.invitorUin,
					nickname: request.invitorName,
					source: "group_request"
				});
				await this.upsertUser({
					uid: request.operatorUid,
					uin: request.operatorUin,
					nickname: request.operatorName,
					source: "group_request"
				});
			}
		}));
	}
	rememberRequestIdentity(identity) {
		this.beginObservation("request identity");
		if (!this.loaded_) {
			const snapshot = structuredClone([identity]);
			this.initialObservations_.push(() => {
				this.rememberRequestIdentity(...snapshot);
			});
		}
		const observed = { ...identity };
		this.rememberUidUin(observed.uid, observed.uin);
		this.runWrite("request identity", async () => await this.transaction(async () => {
			await this.upsertUser({
				uid: observed.uid,
				uin: observed.uin,
				nickname: observed.nickname,
				source: observed.source || "request"
			});
		}));
	}
	rememberGroupMemberIdentity(_groupId, identity) {
		this.beginObservation("group member identity");
		if (!this.loaded_) {
			const snapshot = structuredClone([_groupId, identity]);
			this.initialObservations_.push(() => {
				this.rememberGroupMemberIdentity(...snapshot);
			});
		}
		const observed = { ...identity };
		this.rememberUidUin(observed.uid, observed.uin);
		this.runWrite("group member identity", async () => await this.transaction(async () => await this.upsertUser({
			uid: observed.uid,
			uin: observed.uin,
			nickname: observed.nickname,
			source: "group_member"
		})));
	}
	/** Live 花名册: the joiner is in this group now. Does not invent card/role/isRobot.
	*  No-op when the UIN is missing, the group is unknown, or the member is already present. */
	rememberGroupMemberJoined(groupId, identity) {
		this.beginObservation("group member joined");
		if (!this.loaded_) {
			const snapshot = structuredClone([groupId, identity]);
			this.initialObservations_.push(() => {
				this.rememberGroupMemberJoined(...snapshot);
			});
		}
		const uin = normalizeUin(identity.uin);
		if (uin === null) return;
		const g = this.groups_.get(groupId);
		if (!g || g.members.has(uin)) return;
		const uid = normalizeUid(identity.uid) ?? "";
		this.rememberUidUin(uid, uin);
		const joined = {
			uin,
			uid,
			nickname: "",
			card: "",
			role: "member",
			level: 0,
			title: "",
			joinTime: 0,
			lastSentTime: 0,
			shutUpTime: 0
		};
		g.members.set(uin, joined);
		this.runWrite("group member joined", async () => await this.transaction(async () => await this.upsertGroupMember({
			groupId,
			...joined,
			active: true
		})));
	}
	markGroupMemberInactive(groupId, identity) {
		this.beginObservation("group member inactive");
		if (!this.loaded_) {
			const snapshot = structuredClone([groupId, identity]);
			this.initialObservations_.push(() => {
				this.markGroupMemberInactive(...snapshot);
			});
		}
		const observed = { ...identity };
		const uid = normalizeUid(observed.uid);
		const uin = normalizeUin(observed.uin);
		const g = this.groups_.get(groupId);
		if (g) {
			if (uin !== null) g.members.delete(uin);
			else if (uid) {
				const member = this.findGroupMemberByUid(groupId, uid);
				if (member) g.members.delete(member.uin);
			}
		}
		this.runWrite("group member inactive", async () => {
			if (!uid && uin === null) return;
			const rows = await this.findMemberRows(groupId, uid, uin);
			const updatedAt = nowSeconds();
			await this.transaction(async () => {
				for (const row of rows) await this.db.prepare("UPDATE group_members SET active = 0, updated_at = ? WHERE id = ?").run(updatedAt, row.id);
			});
		});
	}
	rememberUidUin(uid, uin) {
		const normalizedUid = normalizeUid(uid);
		const normalizedUin = normalizeUin(uin);
		if (!normalizedUid || normalizedUin === null) return;
		const oldUid = this.uidByUin.get(normalizedUin);
		if (oldUid && oldUid !== normalizedUid) this.uinByUid.delete(oldUid);
		const oldUin = this.uinByUid.get(normalizedUid);
		if (oldUin !== void 0 && oldUin !== normalizedUin) this.uidByUin.delete(oldUin);
		this.uinByUid.set(normalizedUid, normalizedUin);
		this.uidByUin.set(normalizedUin, normalizedUid);
	}
	isDatabaseMappingCurrent(uid, uin) {
		const currentUin = this.uinByUid.get(uid);
		const currentUid = this.uidByUin.get(uin);
		const current = (currentUin === void 0 || currentUin === uin) && (currentUid === void 0 || currentUid === uid);
		if (!current) this.log.warn("identity stale database mapping rejected: uin=%s candidateUid=%s candidateUin=%d currentUid=%s currentUin=%s", this.uin_, uid, uin, currentUid ?? "", currentUin ?? "");
		return current;
	}
	setGroupsInMemory(groups) {
		const previous = new Map(this.groups_);
		this.groups_.clear();
		for (const g of groups) {
			const existing = previous.get(g.groupId);
			this.groups_.set(g.groupId, {
				...g,
				members: existing?.members ?? g.members ?? /* @__PURE__ */ new Map()
			});
		}
	}
	setGroupMembersInMemory(groupId, members) {
		const g = this.groups_.get(groupId);
		if (!g) return;
		g.members.clear();
		for (const m of members) g.members.set(m.uin, m);
	}
	findGroupMemberByUid(groupId, uid) {
		const g = this.groups_.get(groupId);
		if (!g) return null;
		for (const [, m] of g.members) if (m.uid === uid) return m;
		return null;
	}
	async initSchema() {
		await this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        uid        TEXT UNIQUE,
        uin        INTEGER UNIQUE,
        nickname   TEXT NOT NULL DEFAULT '',
        remark     TEXT NOT NULL DEFAULT '',
        is_friend  INTEGER NOT NULL DEFAULT 0,
        source     TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_identity_users_uid ON users(uid);
      CREATE INDEX IF NOT EXISTS idx_identity_users_uin ON users(uin);

      CREATE TABLE IF NOT EXISTS groups (
        group_id     INTEGER PRIMARY KEY,
        group_name   TEXT NOT NULL DEFAULT '',
        remark       TEXT NOT NULL DEFAULT '',
        member_count INTEGER NOT NULL DEFAULT 0,
        member_max   INTEGER NOT NULL DEFAULT 0,
        active       INTEGER NOT NULL DEFAULT 1,
        updated_at   INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS group_members (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id       INTEGER NOT NULL,
        uid            TEXT,
        uin            INTEGER,
        nickname       TEXT NOT NULL DEFAULT '',
        card           TEXT NOT NULL DEFAULT '',
        role           TEXT NOT NULL DEFAULT 'member',
        level          INTEGER NOT NULL DEFAULT 0,
        title          TEXT NOT NULL DEFAULT '',
        join_time      INTEGER NOT NULL DEFAULT 0,
        last_sent_time INTEGER NOT NULL DEFAULT 0,
        shut_up_time   INTEGER NOT NULL DEFAULT 0,
        is_robot       INTEGER,
        active         INTEGER NOT NULL DEFAULT 1,
        updated_at     INTEGER NOT NULL,
        UNIQUE(group_id, uid),
        UNIQUE(group_id, uin)
      );
      CREATE INDEX IF NOT EXISTS idx_identity_group_members_group_active
        ON group_members(group_id, active);
      CREATE INDEX IF NOT EXISTS idx_identity_group_members_group_uid
        ON group_members(group_id, uid);
      CREATE INDEX IF NOT EXISTS idx_identity_group_members_group_uin
        ON group_members(group_id, uin);
    `);
	}
	async migrateSchema() {
		if ((await this.db.prepare("PRAGMA table_info(group_members)").all()).some((column) => column.name === "is_robot")) return;
		await this.db.exec("ALTER TABLE group_members ADD COLUMN is_robot INTEGER");
		this.log.info("identity schema migrated: added group_members.is_robot");
	}
	async loadSnapshot() {
		const users = await this.db.prepare("SELECT uid, uin FROM users WHERE uid IS NOT NULL AND uin IS NOT NULL").all();
		for (const row of users) {
			const uid = normalizeUid(row.uid), uin = normalizeUin(row.uin);
			if (!uid || uin === null) continue;
			this.persistedUinByUid.set(uid, uin);
			this.persistedUidByUin.set(uin, uid);
		}
		const members = await this.db.prepare("SELECT group_id, uid, uin FROM group_members WHERE uid IS NOT NULL AND uin IS NOT NULL ORDER BY active DESC, updated_at DESC").all();
		for (const row of members) {
			const uid = normalizeUid(row.uid), uin = normalizeUin(row.uin);
			if (!uid || uin === null) continue;
			const uidKey = `${row.group_id}:${uid}`, uinKey = `${row.group_id}:${uin}`;
			if (!this.persistedMembersByUid.has(uidKey)) this.persistedMembersByUid.set(uidKey, uin);
			if (!this.persistedMembersByUin.has(uinKey)) this.persistedMembersByUin.set(uinKey, uid);
		}
		const friendRows = await this.db.prepare(`SELECT uid, uin, nickname, remark
       FROM users
       WHERE is_friend = 1 AND uin IS NOT NULL`).all();
		this.friends_ = friendRows.map((row) => ({
			uid: row.uid ?? "",
			uin: row.uin ?? 0,
			nickname: row.nickname,
			remark: row.remark
		}));
		for (const friend of this.friends_) this.rememberUidUin(friend.uid, friend.uin);
		const groups = await this.db.prepare(`SELECT group_id, group_name, remark, member_count, member_max
       FROM groups
       WHERE active = 1`).all();
		this.setGroupsInMemory(groups.map((row) => ({
			groupId: row.group_id,
			groupName: row.group_name,
			remark: row.remark,
			memberCount: row.member_count,
			memberMax: row.member_max,
			members: /* @__PURE__ */ new Map()
		})));
		await this.hydrateActiveMembersForGroups(groups.map((row) => row.group_id));
	}
	async hydrateActiveMembersForGroups(groupIds) {
		if (!this.db || groupIds.length === 0) return;
		const select = this.db.prepare(`SELECT group_id, uid, uin, nickname, card, role, level, title,
              join_time, last_sent_time, shut_up_time, is_robot
       FROM group_members
       WHERE group_id = ? AND active = 1`);
		for (const groupId of groupIds) {
			const members = (await select.all(groupId)).map(rowToMemberInfo);
			this.setGroupMembersInMemory(groupId, members);
			for (const m of members) this.rememberUidUin(m.uid, m.uin);
		}
	}
	async upsertUser(input) {
		if (!this.db) return;
		const uid = normalizeUid(input.uid);
		const uin = normalizeUin(input.uin);
		if (!uid && uin === null) return;
		const rows = await this.findUserRows(uid, uin);
		const primary = rows[0];
		const merged = {
			uid: uid || primary?.uid || null,
			uin: uin ?? primary?.uin ?? null,
			nickname: mergeOptionalText(input.nickname, primary?.nickname ?? ""),
			remark: mergeOptionalExactText(input.remark, primary?.remark ?? ""),
			isFriend: input.isFriend === true ? 1 : primary?.is_friend ?? 0,
			source: mergeOptionalText(input.source, primary?.source ?? ""),
			updatedAt: nowSeconds()
		};
		if (primary) {
			for (const duplicate of rows.slice(1)) await this.db.prepare("DELETE FROM users WHERE id = ?").run(duplicate.id);
			await this.db.prepare(`UPDATE users
         SET uid = ?, uin = ?, nickname = ?, remark = ?, is_friend = ?, source = ?, updated_at = ?
         WHERE id = ?`).run(merged.uid, merged.uin, merged.nickname, merged.remark, merged.isFriend, merged.source, merged.updatedAt, primary.id);
			return;
		}
		await this.db.prepare(`INSERT INTO users (uid, uin, nickname, remark, is_friend, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`).run(merged.uid, merged.uin, merged.nickname, merged.remark, merged.isFriend, merged.source, merged.updatedAt);
	}
	async upsertGroup(input) {
		if (!this.db || !Number.isInteger(input.groupId) || input.groupId <= 0) return;
		const existing = await this.db.prepare("SELECT group_name, remark, member_count, member_max FROM groups WHERE group_id = ?").get(input.groupId);
		await this.db.prepare(`INSERT INTO groups (group_id, group_name, remark, member_count, member_max, active, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(group_id) DO UPDATE SET
         group_name = excluded.group_name,
         remark = excluded.remark,
         member_count = excluded.member_count,
         member_max = excluded.member_max,
         active = 1,
         updated_at = excluded.updated_at`).run(input.groupId, mergeOptionalText(input.groupName, existing?.group_name ?? ""), mergeOptionalExactText(input.remark, existing?.remark ?? ""), normalizeNonNegative(input.memberCount, existing?.member_count ?? 0), normalizeNonNegative(input.memberMax, existing?.member_max ?? 0), nowSeconds());
	}
	async upsertGroupMember(input) {
		if (!this.db || !Number.isInteger(input.groupId) || input.groupId <= 0) return;
		const uid = normalizeUid(input.uid);
		const uin = normalizeUin(input.uin);
		if (!uid && uin === null) return;
		await this.upsertGroup({ groupId: input.groupId });
		await this.upsertUser({
			uid,
			uin: uin ?? void 0,
			nickname: input.nickname,
			source: "group_member"
		});
		const rows = await this.findMemberRows(input.groupId, uid, uin);
		const primary = rows[0];
		const merged = {
			uid: uid || primary?.uid || null,
			uin: uin ?? primary?.uin ?? null,
			nickname: mergeOptionalText(input.nickname, primary?.nickname ?? ""),
			card: mergeOptionalText(input.card, primary?.card ?? ""),
			role: mergeOptionalText(input.role, primary?.role ?? "member"),
			level: normalizeNonNegative(input.level, primary?.level ?? 0),
			title: mergeOptionalText(input.title, primary?.title ?? ""),
			joinTime: normalizeNonNegative(input.joinTime, primary?.join_time ?? 0),
			lastSentTime: normalizeNonNegative(input.lastSentTime, primary?.last_sent_time ?? 0),
			shutUpTime: normalizeNonNegative(input.shutUpTime, primary?.shut_up_time ?? 0),
			isRobot: input.isRobot === void 0 ? primary?.is_robot ?? null : input.isRobot ? 1 : 0,
			active: input.active === false ? 0 : input.active === true ? 1 : primary?.active ?? 1,
			updatedAt: nowSeconds()
		};
		if (primary) {
			for (const duplicate of rows.slice(1)) await this.db.prepare("DELETE FROM group_members WHERE id = ?").run(duplicate.id);
			await this.db.prepare(`UPDATE group_members
         SET uid = ?, uin = ?, nickname = ?, card = ?, role = ?, level = ?, title = ?,
             join_time = ?, last_sent_time = ?, shut_up_time = ?, is_robot = ?, active = ?, updated_at = ?
         WHERE id = ?`).run(merged.uid, merged.uin, merged.nickname, merged.card, merged.role, merged.level, merged.title, merged.joinTime, merged.lastSentTime, merged.shutUpTime, merged.isRobot, merged.active, merged.updatedAt, primary.id);
			return;
		}
		await this.db.prepare(`INSERT INTO group_members
       (group_id, uid, uin, nickname, card, role, level, title,
        join_time, last_sent_time, shut_up_time, is_robot, active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.groupId, merged.uid, merged.uin, merged.nickname, merged.card, merged.role, merged.level, merged.title, merged.joinTime, merged.lastSentTime, merged.shutUpTime, merged.isRobot, merged.active, merged.updatedAt);
	}
	async findUserRows(uid, uin) {
		if (!this.db) return [];
		if (uid && uin !== null) return await this.db.prepare("SELECT id, uid, uin, nickname, remark, is_friend, source FROM users WHERE uid = ? OR uin = ? ORDER BY id").all(uid, uin);
		if (uid) return await this.db.prepare("SELECT id, uid, uin, nickname, remark, is_friend, source FROM users WHERE uid = ? ORDER BY id").all(uid);
		if (uin !== null) return await this.db.prepare("SELECT id, uid, uin, nickname, remark, is_friend, source FROM users WHERE uin = ? ORDER BY id").all(uin);
		return [];
	}
	async findMemberRows(groupId, uid, uin) {
		if (!this.db) return [];
		if (uid && uin !== null) return await this.db.prepare(`SELECT id, group_id, uid, uin, nickname, card, role, level, title,
                join_time, last_sent_time, shut_up_time, is_robot, active
         FROM group_members
         WHERE group_id = ? AND (uid = ? OR uin = ?)
         ORDER BY id`).all(groupId, uid, uin);
		if (uid) return await this.db.prepare(`SELECT id, group_id, uid, uin, nickname, card, role, level, title,
                join_time, last_sent_time, shut_up_time, is_robot, active
         FROM group_members
         WHERE group_id = ? AND uid = ?
         ORDER BY id`).all(groupId, uid);
		if (uin !== null) return await this.db.prepare(`SELECT id, group_id, uid, uin, nickname, card, role, level, title,
                join_time, last_sent_time, shut_up_time, is_robot, active
         FROM group_members
         WHERE group_id = ? AND uin = ?
         ORDER BY id`).all(groupId, uin);
		return [];
	}
	async transaction(fn) {
		if (!this.db || this.inTransaction) return await fn();
		this.inTransaction = true;
		try {
			await this.db.exec("BEGIN");
			const result = await fn();
			await this.db.exec("COMMIT");
			return result;
		} catch (err) {
			try {
				await this.db.exec("ROLLBACK");
			} catch (rollbackErr) {
				const transactionMessage = err instanceof Error ? err.message : String(err);
				const rollbackMessage = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
				throw new AggregateError([err, rollbackErr], `identity transaction failed: ${transactionMessage}; rollback failed: ${rollbackMessage}`);
			}
			throw err;
		} finally {
			this.inTransaction = false;
		}
	}
	runWrite(label, fn) {
		if (!this.db || !this.loaded_) return;
		if (this.persistenceSuspended_) {
			this.recordSkippedWrite(label);
			return;
		}
		this.assertPersistenceCapacity(label);
		this.pendingWrites_.push({
			label,
			write: fn
		});
		if (!this.retryTimer_) this.flushPendingWrites().catch((error) => {
			this.recordPersistenceFailure(label, error);
		});
	}
	/** Wait for accepted observations to reach disk (also used by shutdown). */
	async flush() {
		this.assertOpen("flush");
		await this.initialization;
		await this.flushPendingWrites(false);
		if (this.pendingWrites_.length) throw new Error(this.lastError_ || "Identity persistence has pending writes");
	}
	assertOpen(label) {
		if (this.replaying_ || !this.closed_ && !this.closing_) return;
		throw new Error(`IdentityService is closed; cannot observe ${label}`);
	}
	beginObservation(label) {
		this.assertOpen(label);
		this.assertPersistenceCapacity(label);
	}
	assertPersistenceCapacity(label) {
		if (!this.db || this.persistenceSuspended_ || this.pendingWrites_.length + this.initialObservations_.length < PERSISTENCE_QUEUE_CAPACITY) return;
		const message = `identity persistence retry queue full: ${this.pendingWrites_.length}/${PERSISTENCE_QUEUE_CAPACITY}`;
		this.lastFailedLabel_ = label;
		this.lastError_ = message;
		this.lastFailureAt_ = Date.now();
		this.log.error("identity persistence queue full: uin=%s label=%s pending=%d retry=%d capacity=%d", this.uin_, label, this.pendingWrites_.length, this.retryAttempt_, PERSISTENCE_QUEUE_CAPACITY);
		throw new Error(message);
	}
	recordPersistenceFailure(label, err) {
		this.lastFailedLabel_ = label;
		this.lastError_ = err instanceof Error ? err.stack ?? err.message : String(err);
		this.lastFailureAt_ = Date.now();
		this.retryAttempt_ += 1;
		this.log.error("identity persistence write failed: uin=%s label=%s pending=%d retry=%d err=%s", this.uin_, label, this.pendingWrites_.length, this.retryAttempt_, this.lastError_);
	}
	schedulePersistenceRetry() {
		if (this.closed_ || this.closing_ !== null || this.persistenceSuspended_ || !this.db || this.pendingWrites_.length === 0 || this.retryTimer_) return;
		if (this.retryAttempt_ > PERSISTENCE_RETRY_DELAYS_MS.length) {
			this.suspendPersistence();
			return;
		}
		const delay = PERSISTENCE_RETRY_DELAYS_MS[Math.min(Math.max(this.retryAttempt_ - 1, 0), PERSISTENCE_RETRY_DELAYS_MS.length - 1)];
		this.nextRetryAt_ = Date.now() + delay;
		this.log.warn("identity persistence degraded: uin=%s label=%s pending=%d retry=%d nextRetryMs=%d", this.uin_, this.lastFailedLabel_, this.pendingWrites_.length, this.retryAttempt_, delay);
		this.retryTimer_ = setTimeout(() => {
			this.retryTimer_ = null;
			this.nextRetryAt_ = null;
			this.flushPendingWrites().catch((error) => this.recordPersistenceFailure("retry", error));
		}, delay);
		this.retryTimer_.unref();
	}
	flushPendingWrites(scheduleRetry = true) {
		if (this.flushing_) return this.flushing_;
		const work = (async () => {
			await this.initialization;
			await this.db?.serial(async () => await this.drainPendingWrites(scheduleRetry));
		})();
		this.flushing_ = work.finally(() => {
			this.flushing_ = null;
		});
		return this.flushing_;
	}
	async drainPendingWrites(scheduleRetry = true) {
		if (this.closed_ || this.persistenceSuspended_ || !this.db || this.pendingWrites_.length === 0) return;
		const pendingAtStart = this.pendingWrites_.length;
		while (this.pendingWrites_.length > 0) {
			const next = this.pendingWrites_[0];
			try {
				await next.write();
				this.pendingWrites_.shift();
			} catch (err) {
				this.recordPersistenceFailure(next.label, err);
				if (scheduleRetry) this.schedulePersistenceRetry();
				return;
			}
		}
		const attempts = this.retryAttempt_;
		this.retryAttempt_ = 0;
		this.nextRetryAt_ = null;
		this.skippedWritesSinceLog_ = 0;
		this.lastSkippedWriteLogAt_ = 0;
		if (attempts > 0) this.log.info("identity persistence recovered: uin=%s flushed=%d pending=0 retries=%d", this.uin_, pendingAtStart, attempts);
	}
	suspendPersistence() {
		if (this.persistenceSuspended_) return;
		if (this.retryTimer_) {
			clearTimeout(this.retryTimer_);
			this.retryTimer_ = null;
		}
		this.nextRetryAt_ = null;
		const abandoned = this.pendingWrites_.length;
		this.persistenceSuspended_ = true;
		this.abandonedWrites_ += abandoned;
		this.log.error("identity persistence suspended: uin=%s label=%s pending=%d retry=%d abandoned=%d err=%s", this.uin_, this.lastFailedLabel_, abandoned, this.retryAttempt_, abandoned, this.lastError_);
		this.pendingWrites_.length = 0;
	}
	recordSkippedWrite(label) {
		this.skippedWrites_ += 1;
		this.abandonedWrites_ += 1;
		const now = Date.now();
		if (this.lastSkippedWriteLogAt_ !== 0 && now - this.lastSkippedWriteLogAt_ < SKIPPED_WRITE_LOG_INTERVAL_MS) {
			this.skippedWritesSinceLog_ += 1;
			return;
		}
		const suppressed = this.skippedWritesSinceLog_;
		this.skippedWritesSinceLog_ = 0;
		this.lastSkippedWriteLogAt_ = now;
		if (suppressed > 0) {
			this.log.warn("identity persistence write skipped: uin=%s label=%s skipped=%d abandoned=%d suppressed=%d", this.uin_, label, this.skippedWrites_, this.abandonedWrites_, suppressed);
			return;
		}
		this.log.warn("identity persistence write skipped: uin=%s label=%s skipped=%d abandoned=%d", this.uin_, label, this.skippedWrites_, this.abandonedWrites_);
	}
};
function rowToMemberInfo(row) {
	return {
		uid: row.uid ?? "",
		uin: row.uin ?? 0,
		nickname: row.nickname,
		card: row.card,
		role: row.role || "member",
		level: row.level,
		title: row.title,
		joinTime: row.join_time,
		lastSentTime: row.last_sent_time,
		shutUpTime: row.shut_up_time,
		isRobot: row.is_robot === null ? void 0 : row.is_robot !== 0
	};
}
function normalizeUid(uid) {
	return typeof uid === "string" ? uid.trim() : "";
}
/** A UID that is itself a decimal UIN. Protocol fact, not a packet-header guess. */
function numericUidAsUin(uid) {
	if (!/^\d+$/.test(uid)) return null;
	return normalizeUin(uid);
}
function normalizeUin(uin) {
	if (typeof uin === "number" && Number.isFinite(uin)) {
		const n = Math.trunc(uin);
		return n > 0 ? n : null;
	}
	if (typeof uin === "string" && uin.trim()) {
		const parsed = Number(uin);
		if (Number.isFinite(parsed)) {
			const n = Math.trunc(parsed);
			return n > 0 ? n : null;
		}
	}
	return null;
}
function normalizeText(value) {
	return typeof value === "string" ? value.trim() : "";
}
function mergeOptionalText(value, fallback) {
	return value === void 0 ? fallback : normalizeText(value);
}
function mergeOptionalExactText(value, fallback) {
	return value === void 0 ? fallback : typeof value === "string" ? value : "";
}
function normalizeNonNegative(value, fallback) {
	if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
	return fallback;
}
function nowSeconds() {
	return Math.floor(Date.now() / 1e3);
}
export {};
