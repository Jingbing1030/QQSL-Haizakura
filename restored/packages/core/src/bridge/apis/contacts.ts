init_logger();
var log$45 = createLogger("Bridge.Contacts");
function isGroupAllMuted(expireTs, nowSec = Math.floor(Date.now() / 1e3)) {
	return (expireTs ?? 0) > nowSec;
}
function isRobotUin(uin, ranges) {
	return Number.isInteger(uin) && uin > 0 && ranges.some(({ minUin, maxUin }) => uin >= minUin && uin <= maxUin);
}
function normalizeGroupRequestSequence(rawSequence, groupId) {
	const sequence = Number(rawSequence ?? 0);
	if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error(`invalid group-request sequence: group=${groupId} sequence=${String(rawSequence ?? 0)}`);
	return sequence;
}
var MEMBER_LIST_TTL_MS = 6e4;
var FRIEND_PROFILE_TTL_MS = 5 * 6e4;
var FRIEND_PROFILE_CONCURRENCY = 4;
var ContactsApi = class {
	ctx;
	/**
	* Per-group TTL + single-flight cache for `fetchGroupMemberList`, keyed by
	* groupId, living for the lifetime of the Bridge.
	*
	* Without this, a busy OneBot client (e.g. MaiBot calling
	* `get_group_member_info` once per inbound message) triggers one
	* OIDB 0xfe7_3 per chat message — sustained >1k/h, which trips
	* Tencent risk-control and gets the account banned for 7 days.
	*/
	memberListCache = createSingleFlightCache({
		ttlMs: MEMBER_LIST_TTL_MS,
		load: (groupId) => this.fetchGroupMemberListUncached(groupId)
	});
	robotUinRangesPromise_ = null;
	groupInvites = new GroupInviteTracker();
	friendRosterGeneration = 0;
	rememberedFriendRosterGeneration = 0;
	activeProfiles = 0;
	profileWaiters = [];
	friendProfiles = createSingleFlightCache({
		ttlMs: FRIEND_PROFILE_TTL_MS,
		load: (uin) => this.loadFriendProfile(uin)
	});
	constructor(ctx) {
		this.ctx = ctx;
	}
	fetchRobotUinRanges(groupId) {
		if (this.robotUinRangesPromise_) return this.robotUinRangesPromise_;
		const pending = FetchRobotUinRanges.invoke(this.ctx).then((snapshot) => {
			log$45.info("loaded robot UIN ranges uin=%s version=%d count=%d", this.ctx.identity.uin, snapshot.version, snapshot.ranges.length);
			return snapshot;
		});
		this.robotUinRangesPromise_ = pending;
		pending.catch((err) => {
			if (this.robotUinRangesPromise_ === pending) this.robotUinRangesPromise_ = null;
			log$45.error("failed to load robot UIN ranges: uin=%s group=%d err=%s", this.ctx.identity.uin, groupId, err instanceof Error ? err.stack ?? err.message : String(err));
		});
		return pending;
	}
	/** Server-built ARK share card (JSON string) recommending a friend. */
	getBuddyRecommendArk(userId, phoneNumber = "") {
		return GetBuddyRecommendArk.invoke(this.ctx, {
			userId,
			phoneNumber
		});
	}
	/** Server-built ARK share card (JSON string) recommending a group. */
	getGroupRecommendArk(groupId) {
		return GetGroupRecommendArk.invoke(this.ctx, { groupId });
	}
	getGroupShareLink(groupId, needShortUrl = true, srcId = 73, additionalParam = "") {
		return GetGroupShareLink.invoke(this.ctx, {
			groupId,
			needShortUrl,
			srcId,
			additionalParam
		});
	}
	/** Send a custom 图文 ark card to a C2C peer or group (0xdc2_34). */
	sendTuwenArk(params) {
		return SendTuwenArk.invoke(this.ctx, params);
	}
	async loadFriendProfile(uin) {
		if (this.activeProfiles >= FRIEND_PROFILE_CONCURRENCY) await new Promise((resolve) => this.profileWaiters.push(resolve));
		else this.activeProfiles++;
		try {
			return (await this.fetchUserProfile(uin)).profile ?? {};
		} catch (cause) {
			log$45.warn("friend profile query failed: user=%d error=%s", uin, cause instanceof Error ? cause.message : String(cause));
			throw new Error(`friend profile query failed for ${uin}`, { cause });
		} finally {
			const next = this.profileWaiters.shift();
			if (next) next();
			else this.activeProfiles--;
		}
	}
	async enrichFriendProfiles(entries) {
		const started = Date.now();
		for (let offset = 0; offset < entries.length; offset += FRIEND_PROFILE_CONCURRENCY) {
			const batch = entries.slice(offset, offset + FRIEND_PROFILE_CONCURRENCY);
			const errors = (await Promise.allSettled(batch.map(async ({ friend }) => {
				const extra = await this.friendProfiles.get(friend.uin);
				friend.profile = {
					...structuredClone(extra),
					...friend.profile
				};
			}))).filter((result) => result.status === "rejected");
			if (errors.length > 0) {
				log$45.warn("friend profile enrichment failed: batch=%d failures=%d elapsedMs=%d", offset, errors.length, Date.now() - started);
				throw new AggregateError(errors.map((result) => result.reason), "friend profile enrichment failed");
			}
		}
		log$45.debug("friend profiles loaded: friends=%d elapsedMs=%d", entries.length, Date.now() - started);
	}
	async fetchFriendRoster(options = {}) {
		const generation = ++this.friendRosterGeneration;
		const entries = [];
		const categories = /* @__PURE__ */ new Map();
		const seenCookies = /* @__PURE__ */ new Set();
		let cookie;
		for (;;) {
			const page = await FetchFriendListPage.invoke(this.ctx, { cookie });
			entries.push(...page.entries);
			for (const category of page.categories) categories.set(category.categoryId, category);
			const next = page.cookie;
			if (!next?.length) break;
			const key = toHex(next);
			if (seenCookies.has(key)) throw new Error(`repeated friend-list cookie ${key}`);
			seenCookies.add(key);
			cookie = next;
		}
		if (options.withProfile) await this.enrichFriendProfiles(entries);
		if (generation > this.rememberedFriendRosterGeneration) {
			this.ctx.identity.rememberFriends(entries.map((entry) => entry.friend));
			this.rememberedFriendRosterGeneration = generation;
		}
		return {
			entries,
			categories: [...categories.values()]
		};
	}
	async fetchFriendList(options = {}) {
		return (await this.fetchFriendRoster(options)).entries.map((entry) => entry.friend);
	}
	async fetchFriendCategories(options = {}) {
		const roster = await this.fetchFriendRoster(options);
		const buckets = new Map(roster.categories.map((category) => [category.categoryId, []]));
		for (const entry of roster.entries) {
			const bucket = buckets.get(entry.categoryId);
			if (!bucket) throw new Error(`friend roster references missing category ${entry.categoryId} (${roster.entries.length} friends total)`);
			bucket.push(entry.friend);
		}
		return roster.categories.map((category) => {
			const friends = buckets.get(category.categoryId);
			if (friends.length !== category.memberCount) log$45.warn("friend category member count mismatch category=%d server=%d assembled=%d", category.categoryId, category.memberCount, friends.length);
			return {
				...category,
				friends
			};
		});
	}
	async setFriendCategory(params) {
		if (Number(params.categoryId !== void 0) + Number(params.categoryName !== void 0) !== 1) throw new Error("exactly one of categoryId or categoryName is required");
		const categories = await this.fetchFriendCategories();
		const friend = categories.find((category) => category.friends.some((friend) => friend.uin === params.uin))?.friends.find((entry) => entry.uin === params.uin);
		if (!friend) throw new Error(`friend ${params.uin} is not in the live roster`);
		if (!friend.uid) throw new Error(`friend ${params.uin} has no UID in the live roster`);
		let target;
		if (params.categoryId !== void 0) {
			target = categories.find((category) => category.categoryId === params.categoryId);
			if (!target) throw new Error(`friend category ${params.categoryId} does not exist`);
		} else {
			const matches = categories.filter((category) => category.categoryName === params.categoryName);
			if (matches.length === 0) throw new Error(`friend category name "${params.categoryName}" does not exist`);
			if (matches.length > 1) throw new Error(`friend category name "${params.categoryName}" is ambiguous`);
			target = matches[0];
		}
		await SetFriendCategory.invoke(this.ctx, {
			uid: friend.uid,
			categoryId: target.categoryId
		});
		log$45.info("friend category updated: uin=%s friend=%d category=%d", this.ctx.identity.uin, params.uin, target.categoryId);
	}
	async fetchGroupList() {
		const resp = await FetchGroupList.invoke(this.ctx);
		const groups = [];
		for (const raw of resp.groups ?? []) groups.push({
			groupId: raw.groupUin ?? 0,
			groupName: raw.info?.groupName ?? "",
			remark: raw.customInfo?.remark ?? "",
			memberCount: raw.info?.memberCount ?? 0,
			memberMax: raw.info?.memberMax ?? 0,
			members: /* @__PURE__ */ new Map(),
			createTime: raw.info?.createdTime ?? 0,
			memo: raw.info?.announcement || raw.info?.description || "",
			description: raw.info?.description ?? "",
			allMuted: isGroupAllMuted(raw.info?.shutUpAllTimestamp)
		});
		this.ctx.identity.rememberGroups(groups);
		return groups;
	}
	/**
	* Fetch a single group's public detail by id via `0x88D_0` — works even for a
	* group the bot hasn't joined (used to resolve a group-invite's name). Returns
	* null when the server has no such group / denies the lookup. Deliberately
	* does NOT `rememberGroups` it — a non-member group must not pollute the
	* joined-groups roster / get_group_list.
	*/
	async fetchGroupDetail(groupId) {
		if (!(groupId > 0)) return null;
		const r = (await FetchGroupDetail.invoke(this.ctx, { groupUin: groupId })).groupInfo?.results;
		if (!r) return null;
		return {
			groupId,
			groupName: r.name ?? "",
			remark: "",
			memberCount: Number(r.memberCount ?? 0n),
			memberMax: Number(r.maxMemberCount ?? 0n),
			members: /* @__PURE__ */ new Map(),
			createTime: Number(r.createTime ?? 0n),
			level: Number(r.level ?? 0n),
			memo: r.noticePreview ?? "",
			allMuted: isGroupAllMuted(r.shutUpAllTimestamp)
		};
	}
	fetchGroupMemberList(groupId, options = {}) {
		return this.memberListCache.get(groupId, { force: options.force });
	}
	async fetchGroupMemberListUncached(groupId) {
		const robotSnapshotPromise = this.fetchRobotUinRanges(groupId);
		const members = [];
		let token = "";
		do {
			const page = await FetchGroupMemberListPage.invoke(this.ctx, {
				groupId,
				token
			});
			members.push(...page.members);
			token = page.token;
		} while (token);
		const robotSnapshot = await robotSnapshotPromise;
		for (const member of members) member.isRobot = isRobotUin(member.uin, robotSnapshot.ranges);
		this.ctx.identity.rememberGroupMembers(groupId, members);
		return members;
	}
	async fetchUserProfile(uin) {
		const info = await FetchUserProfile.invoke(this.ctx, { uin });
		this.ctx.identity.rememberUserProfile(info);
		return info;
	}
	/** Look up a user profile by UID (string form). Used for strangers
	*  whose UIN we don't have yet — typically the requester on a
	*  group join request push. Mirrors Lagrange's `FetchUserInfoEvent
	*  .Create(targetUid)` path. */
	async fetchUserProfileByUid(uid) {
		const info = await FetchUserProfileByUid.invoke(this.ctx, { uid });
		if (info.uin > 0) this.ctx.identity.rememberUserProfile(info);
		return info;
	}
	/** 企点企业资料卡（#404 后续 PR）。仅在判断命中的是企点账号后再调用。
	*  best-effort：非企点账号或拉取失败返回 null，不影响上层资料读取。 */
	async fetchQidianCorpInfo(uin) {
		return fetchQidianCorpInfo(this.ctx, uin);
	}
	async fetchGroupRequests(filtered = false, count = 50, cursor = 0n) {
		const resp = await FetchGroupRequests.invoke(this.ctx, {
			filtered,
			count,
			cursor
		});
		const requests = [];
		for (const raw of resp.requests ?? []) {
			const groupId = raw.group?.groupUin ?? 0;
			const targetUin = raw.target?.uin ?? 0;
			const invitorUin = raw.invitor?.uin ?? 0;
			const operatorUin = raw.operatorUser?.uin ?? 0;
			const targetUid = raw.target?.uid || this.ctx.identity.findUidByUin(targetUin, groupId) || this.ctx.identity.findUidByUin(targetUin) || "";
			const invitorUid = raw.invitor?.uid || this.ctx.identity.findUidByUin(invitorUin, groupId) || this.ctx.identity.findUidByUin(invitorUin) || "";
			const operatorUid = raw.operatorUser?.uid || this.ctx.identity.findUidByUin(operatorUin, groupId) || this.ctx.identity.findUidByUin(operatorUin) || "";
			const notifyType = raw.eventType ?? 0;
			const operationType = groupRequestOperationType(notifyType);
			const sequence = normalizeGroupRequestSequence(raw.sequence, groupId);
			if (operationType === null) log$45.warn("unsupported group-request notification type: group=%d sequence=%s type=%d", groupId, String(raw.sequence ?? 0n), notifyType);
			requests.push({
				groupId,
				groupName: raw.group?.groupName ?? "",
				targetUid,
				targetUin: targetUin || this.ctx.identity.findUinByUid(targetUid, groupId) || this.ctx.identity.findUinByUid(targetUid) || 0,
				targetName: raw.target?.name ?? "",
				invitorUid,
				invitorUin: invitorUin || this.ctx.identity.findUinByUid(invitorUid, groupId) || this.ctx.identity.findUinByUid(invitorUid) || 0,
				invitorName: raw.invitor?.name ?? "",
				operatorUid,
				operatorUin: operatorUin || this.ctx.identity.findUinByUid(operatorUid, groupId) || this.ctx.identity.findUinByUid(operatorUid) || 0,
				operatorName: raw.operatorUser?.name ?? "",
				sequence,
				state: raw.state ?? 0,
				notifyType,
				eventType: operationType ?? 0,
				comment: raw.comment ?? "",
				filtered,
				operateTransInfo: raw.operateTransInfo && raw.operateTransInfo.length > 0 ? raw.operateTransInfo : void 0
			});
		}
		this.ctx.identity.rememberGroupRequests(requests);
		return requests;
	}
	/** UID-form request list retained for correlating incoming UID-only pushes.
	* Explicit list/actions use fetchGroupRequests(), which matches QQ's native
	* numeric-account path and does not need profile lookups. */
	async fetchGroupRequestsByUid(filtered = false, count = 50, cursor = 0n) {
		const resp = await FetchGroupRequestsByUid.invoke(this.ctx, {
			filtered,
			count,
			cursor
		});
		const requests = [];
		for (const raw of resp.requests ?? []) {
			const groupId = raw.group?.groupUin ?? 0;
			const targetUid = raw.target?.uid ?? "";
			const invitorUid = raw.invitor?.uid ?? "";
			const operatorUid = raw.operatorUser?.uid ?? "";
			const notifyType = raw.eventType ?? 0;
			const operationType = groupRequestOperationType(notifyType);
			const sequence = normalizeGroupRequestSequence(raw.sequence, groupId);
			if (operationType === null) log$45.warn("unsupported group-request notification type: group=%d sequence=%s type=%d", groupId, String(raw.sequence ?? 0n), notifyType);
			requests.push({
				groupId,
				groupName: raw.group?.groupName ?? "",
				targetUid,
				targetUin: this.ctx.identity.findUinByUid(targetUid, groupId) ?? this.ctx.identity.findUinByUid(targetUid) ?? 0,
				targetName: raw.target?.name ?? "",
				invitorUid,
				invitorUin: this.ctx.identity.findUinByUid(invitorUid, groupId) ?? this.ctx.identity.findUinByUid(invitorUid) ?? 0,
				invitorName: raw.invitor?.name ?? "",
				operatorUid,
				operatorUin: this.ctx.identity.findUinByUid(operatorUid, groupId) ?? this.ctx.identity.findUinByUid(operatorUid) ?? 0,
				operatorName: raw.operatorUser?.name ?? "",
				sequence,
				state: raw.state ?? 0,
				notifyType,
				eventType: operationType ?? 0,
				comment: raw.comment ?? "",
				filtered,
				operateTransInfo: raw.operateTransInfo && raw.operateTransInfo.length > 0 ? raw.operateTransInfo : void 0
			});
		}
		this.ctx.identity.rememberGroupRequests(requests);
		return requests;
	}
	async resolveGroupJoinRequest(groupId, uid, subType, invitedUid) {
		const [main, filtered] = await Promise.allSettled([this.fetchGroupRequestsByUid(false), this.fetchGroupRequestsByUid(true)]);
		if (main.status === "rejected") throw main.reason;
		if (filtered.status === "rejected") throw filtered.reason;
		return [...main.value, ...filtered.value].find((request) => {
			if (request.groupId !== groupId || request.state !== 1) return false;
			return subType === "add" ? request.eventType === 1 && request.targetUid === uid : (isSelfGroupInvitation(request) || request.eventType === 22) && request.invitorUid === uid && request.targetUid === invitedUid;
		}) ?? null;
	}
	/** Returns whether this live card introduces a new approval sequence. */
	rememberGroupInviteCardSequence(groupId, sequence) {
		return this.groupInvites.receiveCard(groupId, sequence);
	}
	getGroupInviteCardSequence(groupId) {
		return this.groupInvites.getCardSequence(groupId);
	}
	findGroupInviteCardGroupBySequence(sequence, groupId) {
		return this.groupInvites.findCardGroup(sequence, groupId);
	}
	async fetchDownloadRKeys() {
		const resp = await FetchDownloadRkeys.invoke(this.ctx);
		const result = [];
		for (const entry of resp.downloadRkey?.rkeys ?? []) {
			const rkey = entry.rkey ?? "";
			const type = entry.type ?? 0;
			if (rkey && type) result.push({
				rkey,
				ttlSeconds: Number(entry.rkeyTtlSec ?? 0),
				storeId: entry.storeId ?? 0,
				createTime: entry.rkeyCreateTime ?? 0,
				type
			});
		}
		return result;
	}
};
