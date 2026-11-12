// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/modules/contact-actions.ts"
// original bundle lines 39317-39759  (441 lines) of dist/index.mjs
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
var REQUESTER_PROFILE_CONCURRENCY = 4;
var log$52 = createLogger("OneBot.Contacts");
function getLoginInfo(ref) {
	return {
		userId: parseInt(ref.uin, 10) || 0,
		nickname: ref.bridge.identity.nickname || ref.uin
	};
}
async function fetchSingleGroupMembers(bridge, groupId, force = false) {
	try {
		return await bridge.apis.contacts.fetchGroupMemberList(groupId, { force });
	} catch (err) {
		log$52.warn("group member refresh failed: uin=%s group=%d err=%s", bridge.identity.uin, groupId, err instanceof Error ? err.stack ?? err.message : String(err));
		throw err;
	}
}
async function getFriendList(bridge, withProfile = false) {
	let rows;
	try {
		rows = (await bridge.apis.contacts.fetchFriendList({ withProfile })).map((friend) => formatFriend(friend));
	} catch (error) {
		log$52.warn("friend list refresh failed: withProfile=%s error=%s", withProfile, error instanceof Error ? error.message : String(error));
		if (withProfile) throw error;
		rows = bridge.identity.friends.map((friend) => formatFriend(friend));
	}
	const occupied = new Set(rows.map((row) => Number(row.user_id)));
	for (const extra of datalineFriendListEntries()) {
		if (occupied.has(extra.user_id)) continue;
		rows.push({
			user_id: extra.user_id,
			nickname: extra.nickname,
			remark: extra.remark
		});
	}
	return rows;
}
async function getGroupList(bridge, noCache) {
	try {
		if (noCache || bridge.identity.groups.length === 0) await bridge.apis.contacts.fetchGroupList();
	} catch (err) {
		if (noCache) throw err;
		log$52.warn("group list refresh failed, using cached roster: uin=%s err=%s", bridge.identity.uin, err instanceof Error ? err.stack ?? err.message : String(err));
	}
	return bridge.identity.groups.map((g) => ({
		group_id: g.groupId,
		group_name: g.groupName,
		group_remark: g.remark,
		member_count: g.memberCount,
		max_member_count: g.memberMax,
		group_create_time: g.createTime ?? 0,
		group_level: g.level ?? 0,
		group_memo: g.memo ?? "",
		group_description: g.description ?? "",
		group_all_shut: g.allMuted ? -1 : 0
	}));
}
var GROUP_LEVEL_TTL_MS = 300 * 1e3;
var groupLevelCache = /* @__PURE__ */ new Map();
async function getGroupLevel(bridge, groupId, noCache) {
	if (!noCache) {
		const cached = groupLevelCache.get(groupId);
		if (cached && Date.now() - cached.at < GROUP_LEVEL_TTL_MS) return cached.level;
	}
	try {
		const level = (await bridge.apis.contacts.fetchGroupDetail(groupId))?.level ?? 0;
		groupLevelCache.set(groupId, {
			level,
			at: Date.now()
		});
		return level;
	} catch (err) {
		if (noCache) throw err;
		log$52.warn("group detail refresh failed, using roster metadata: uin=%s group=%d err=%s", bridge.identity.uin, groupId, err instanceof Error ? err.stack ?? err.message : String(err));
		return 0;
	}
}
var NON_MEMBER_GROUP_TTL_MS = 300 * 1e3;
var nonMemberGroupCache = /* @__PURE__ */ new Map();
function nonMemberGroupCacheKey(bridge, groupId) {
	return `${bridge.identity.uin}:${groupId}`;
}
async function getGroupInfo(bridge, groupId, noCache) {
	if (noCache || !bridge.identity.findGroup(groupId)) try {
		await bridge.apis.contacts.fetchGroupList();
	} catch (err) {
		if (noCache) throw err;
		log$52.warn("group list refresh failed, using cached roster: uin=%s group=%d err=%s", bridge.identity.uin, groupId, err instanceof Error ? err.stack ?? err.message : String(err));
	}
	const g = bridge.identity.findGroup(groupId);
	if (g) return {
		group_id: g.groupId,
		group_name: g.groupName,
		group_remark: g.remark,
		member_count: g.memberCount,
		max_member_count: g.memberMax,
		group_create_time: g.createTime ?? 0,
		group_level: await getGroupLevel(bridge, groupId, noCache),
		group_memo: g.memo ?? "",
		group_description: g.description ?? "",
		group_all_shut: g.allMuted ? -1 : 0
	};
	const cacheKey = nonMemberGroupCacheKey(bridge, groupId);
	if (!noCache) {
		const cached = nonMemberGroupCache.get(cacheKey);
		if (cached && Date.now() - cached.at < NON_MEMBER_GROUP_TTL_MS) return { ...cached.info };
	}
	try {
		const detail = await bridge.apis.contacts.fetchGroupDetail(groupId);
		if (detail) {
			const info = {
				group_id: detail.groupId,
				group_name: detail.groupName,
				group_remark: detail.remark,
				member_count: detail.memberCount,
				max_member_count: detail.memberMax,
				group_create_time: detail.createTime ?? 0,
				group_level: detail.level ?? 0,
				group_memo: detail.memo ?? "",
				group_description: detail.description ?? "",
				group_all_shut: detail.allMuted ? -1 : 0
			};
			nonMemberGroupCache.set(cacheKey, {
				info,
				at: Date.now()
			});
			return { ...info };
		}
	} catch (err) {
		if (noCache) throw err;
		log$52.warn("non-member group lookup failed: uin=%s group=%d err=%s", bridge.identity.uin, groupId, err instanceof Error ? err.stack ?? err.message : String(err));
	}
	return null;
}
async function getGroupMemberList(bridge, groupId, noCache) {
	if (noCache) return (await fetchSingleGroupMembers(bridge, groupId, true)).map((m) => formatGroupMember(groupId, m, cachedQidianProfile(bridge, m.uin)));
	try {
		return (await bridge.apis.contacts.fetchGroupMemberList(groupId)).map((m) => formatGroupMember(groupId, m, cachedQidianProfile(bridge, m.uin)));
	} catch (err) {
		log$52.warn("group member fetch failed, using classified cache: uin=%s group=%d err=%s", bridge.identity.uin, groupId, err instanceof Error ? err.stack ?? err.message : String(err));
		const cached = getCachedGroupMembers(bridge, groupId);
		if (cached.length === 0) throw err;
		return cached;
	}
}
async function getGroupMemberInfo(bridge, groupId, userId, noCache) {
	const cached = bridge.identity.findGroupMember(groupId, userId);
	if (noCache || !cached || cached.isRobot === void 0) await fetchSingleGroupMembers(bridge, groupId, noCache === true);
	const m = bridge.identity.findGroupMember(groupId, userId);
	if (!m) return null;
	let profile = cachedQidianProfile(bridge, userId);
	if (noCache || !profile) try {
		profile = await bridge.apis.contacts.fetchUserProfile(userId);
	} catch (error) {
		log$52.warn("group member profile unavailable: group=%d member=%d error=%s", groupId, userId, error instanceof Error ? error.message : String(error));
	}
	return formatGroupMember(groupId, m, profile ?? void 0);
}
async function getGroupFiles(bridge, groupId, folderId) {
	const result = await bridge.apis.groupFile.list(groupId, folderId ?? "/");
	return {
		files: result.files.map((file) => ({
			group_id: groupId,
			file_id: file.fileId,
			file_name: file.fileName,
			busid: file.busId,
			file_size: file.fileSize,
			upload_time: file.uploadTime,
			dead_time: file.deadTime,
			modify_time: file.modifyTime,
			download_times: file.downloadTimes,
			uploader: file.uploader,
			uploader_name: file.uploaderName
		})),
		folders: result.folders.map((folder) => ({
			group_id: groupId,
			folder_id: folder.folderId,
			folder_name: folder.folderName,
			create_time: folder.createTime,
			creator: folder.creator,
			create_name: folder.creatorName,
			total_file_count: folder.totalFileCount,
			last_upload_time: folder.lastUploadTime,
			last_uploader: folder.lastUploader,
			last_uploader_name: folder.lastUploaderName
		}))
	};
}
function formatStrangerInfo(p, corp) {
	return {
		user_id: p.uin,
		uid: p.uid,
		qid: p.qid,
		nickname: p.nickname,
		remark: p.remark,
		sex: p.sex,
		age: p.age,
		long_nick: p.sign,
		qq_level: p.level,
		qqLevel: p.level,
		level: p.level,
		...p.regTime !== void 0 ? { reg_time: p.regTime } : {},
		...p.birthdayYear !== void 0 ? { birthday_year: p.birthdayYear } : {},
		...p.birthdayMonth !== void 0 ? { birthday_month: p.birthdayMonth } : {},
		...p.birthdayDay !== void 0 ? { birthday_day: p.birthdayDay } : {},
		...p.svipFlag !== void 0 ? { is_vip: p.svipFlag } : {},
		...p.yearVipFlag !== void 0 ? { is_years_vip: p.yearVipFlag } : {},
		...p.vipLevel !== void 0 ? { vip_level: p.vipLevel } : {},
		...p.vipFlag !== void 0 ? { is_qq_vip: p.vipFlag } : {},
		...formatPublicProfile(p.profile),
		status: p.status ?? 0,
		extStatus: p.extStatus ?? 0,
		ext_status: p.extStatus ?? 0,
		batteryStatus: p.batteryStatus ?? 0,
		customStatus: p.customStatus ?? null,
		customStatusDescInfo: p.customStatusDesc ?? "",
		qidian_master_flag: p.qidianMasterFlag ?? 0,
		qidian_crew_flag: p.qidianCrewFlag ?? 0,
		qidian_crew_flag_2: p.qidianCrewFlag2 ?? 0,
		qidian_enterprise_name: corp?.name ?? ""
	};
}
/** 命中的是企点账号时才去拉一次企业资料卡（best-effort，失败返回 null）。 */
async function strangerCorpInfo(bridge, p) {
	if (p.qidianMasterFlag === 0 && p.qidianCrewFlag === 0) return null;
	try {
		return await bridge.apis.contacts.fetchQidianCorpInfo(p.uin);
	} catch {
		return null;
	}
}
async function getStrangerInfo(bridge, userId) {
	const device = findDatalineDeviceByUin(userId);
	if (device) return {
		user_id: device.uin,
		nickname: device.name,
		remark: device.name,
		sex: "unknown",
		age: 0,
		long_nick: ""
	};
	try {
		const p = await bridge.apis.contacts.fetchUserProfile(userId);
		return formatStrangerInfo(p, await strangerCorpInfo(bridge, p));
	} catch (error) {
		log$52.warn("user profile refresh failed, checking cached profile: user=%d error=%s", userId, error instanceof Error ? error.message : String(error));
		const p = bridge.identity.findUserProfile(userId);
		if (p) {
			const profile = {
				...p,
				remark: p.remark || bridge.identity.findFriend(userId)?.remark || ""
			};
			return formatStrangerInfo(profile, await strangerCorpInfo(bridge, profile));
		}
		const friend = bridge.identity.findFriend(userId);
		if (!friend) return null;
		return {
			user_id: friend.uin,
			nickname: friend.nickname,
			remark: friend.remark,
			sex: "unknown",
			age: 0,
			long_nick: ""
		};
	}
}
async function resolveRequesterUins(bridge, requests) {
	const resolved = /* @__PURE__ */ new Map();
	const unresolved = /* @__PURE__ */ new Set();
	const names = /* @__PURE__ */ new Map();
	const unresolvedUins = /* @__PURE__ */ new Set();
	for (const request of requests) {
		const actor = groupRequestActor(request);
		const uid = actor.uid;
		if (actor.name) names.set(uid || `uin:${actor.uin}`, actor.name);
		if (uid && actor.uin > 0 && actor.name) {
			resolved.set(uid, {
				uin: actor.uin,
				name: actor.name
			});
			unresolved.delete(uid);
			continue;
		}
		if (uid) {
			if (resolved.has(uid) || unresolved.has(uid)) continue;
			const cached = bridge.identity.findUinByUid(uid, request.groupId) ?? bridge.identity.findUinByUid(uid);
			if (cached && cached > 0 && actor.name) resolved.set(uid, {
				uin: cached,
				name: actor.name
			});
			else unresolved.add(uid);
			continue;
		}
		if (actor.uin > 0 && !actor.name) unresolvedUins.add(actor.uin);
	}
	const profiles = await mapWithConcurrency([...unresolved], REQUESTER_PROFILE_CONCURRENCY, async (uid) => {
		let profile;
		try {
			profile = await bridge.apis.contacts.fetchUserProfileByUid(uid);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`failed to resolve requester UIN for UID ${uid}: ${message}`, { cause: error });
		}
		if (!Number.isSafeInteger(profile.uin) || profile.uin <= 0) throw new Error(`failed to resolve requester UIN for UID ${uid}`);
		return [uid, profile];
	});
	for (const [uid, profile] of profiles) resolved.set(uid, {
		uin: profile.uin,
		name: names.get(uid) || profile.nickname || ""
	});
	const uinProfiles = await mapWithConcurrency([...unresolvedUins], REQUESTER_PROFILE_CONCURRENCY, async (uin) => {
		try {
			return [uin, await bridge.apis.contacts.fetchUserProfile(uin)];
		} catch {
			return [uin, void 0];
		}
	});
	for (const [uin, profile] of uinProfiles) {
		if (!profile) continue;
		resolved.set(`uin:${uin}`, {
			uin: profile.uin,
			name: profile.nickname || ""
		});
	}
	return resolved;
}
/** Join requests, self invitations, and invitations awaiting administrator approval. */
function isJoinOrInviteNotify(notifyType) {
	return notifyType === void 0 || notifyType === 1 || notifyType === 2 || notifyType === 5 || notifyType === 7 || notifyType === 22;
}
function groupRequestActor(request) {
	if (isSelfGroupInvitation(request)) return {
		uid: request.invitorUid,
		uin: request.invitorUin,
		name: request.invitorName
	};
	return {
		uid: request.targetUid,
		uin: request.targetUin,
		name: request.targetName
	};
}
async function getGroupSystemMessages(bridge, query = {}) {
	const count = query.count ?? 50;
	if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error(`invalid group-system-message count: ${count}`);
	const [main, filtered] = await Promise.all([bridge.apis.contacts.fetchGroupRequests(false, count), bridge.apis.contacts.fetchGroupRequests(true, count)]);
	const unique = /* @__PURE__ */ new Map();
	for (const request of [...main, ...filtered]) {
		if (!isJoinOrInviteNotify(request.notifyType)) continue;
		if (request.eventType <= 0) continue;
		const flag = formatGroupRequestFlag(request);
		if (!unique.has(flag)) unique.set(flag, request);
	}
	const requests = [...unique.values()].filter((request) => {
		if (query.groupId !== void 0 && request.groupId !== query.groupId) return false;
		if (query.onlyPending && request.state !== 1) return false;
		return true;
	});
	const requesterUins = await resolveRequesterUins(bridge, requests);
	return requests.map((request) => {
		const actor = groupRequestActor(request);
		const resolved = (actor.uid ? requesterUins.get(actor.uid) : void 0) ?? (actor.uin > 0 ? requesterUins.get(`uin:${actor.uin}`) : void 0);
		return {
			group_id: request.groupId,
			group_name: request.groupName,
			request_id: request.sequence,
			requester_uin: resolved?.uin ?? actor.uin,
			requester_nick: resolved?.name || actor.name,
			invitor_uin: request.invitorUin,
			invitor_nick: request.invitorName,
			message: request.comment,
			checked: request.state !== 1,
			flag: formatGroupRequestFlag(request)
		};
	});
}
async function getDownloadRKeys(bridge) {
	try {
		return (await bridge.apis.contacts.fetchDownloadRKeys()).map((r) => ({
			rkey: r.rkey,
			type: r.type,
			ttl: r.ttlSeconds,
			create_time: r.createTime
		}));
	} catch {
		return [];
	}
}
function getCachedGroupMembers(bridge, groupId) {
	const g = bridge.identity.findGroup(groupId);
	if (!g) return [];
	const result = [];
	for (const [, member] of g.members) result.push(formatGroupMember(groupId, member, cachedQidianProfile(bridge, member.uin)));
	return result;
}
function formatGroupMember(groupId, member, profile) {
	if (member.isRobot === void 0) throw new Error(`group member robot classification unavailable: group=${groupId} member=${member.uin}`);
	const qage = accountAge(profile?.regTime);
	return {
		group_id: groupId,
		user_id: member.uin,
		nickname: member.nickname,
		card: member.card,
		is_robot: member.isRobot,
		sex: "unknown",
		age: 0,
		join_time: member.joinTime,
		last_sent_time: member.lastSentTime,
		shut_up_timestamp: member.shutUpTime,
		level: String(member.level),
		...profile ? { qq_level: profile.level } : {},
		...qage !== void 0 ? { qage } : {},
		role: member.role,
		title: member.title,
		area: "",
		unfriendly: false,
		title_expire_time: 0,
		card_changeable: true,
		qidian_master_flag: profile?.qidianMasterFlag ?? 0,
		qidian_crew_flag: profile?.qidianCrewFlag ?? 0,
		qidian_crew_flag_2: profile?.qidianCrewFlag2 ?? 0
	};
}
/** Completed UTC calendar years since registration; unavailable dates stay absent. */
function accountAge(regTime) {
	if (regTime === void 0 || !Number.isSafeInteger(regTime) || regTime <= 0) return;
	const now = /* @__PURE__ */ new Date();
	const registered = /* @__PURE__ */ new Date(regTime * 1e3);
	if (!Number.isFinite(registered.getTime()) || registered > now) return;
	const years = now.getUTCFullYear() - registered.getUTCFullYear();
	registered.setUTCFullYear(now.getUTCFullYear());
	return years - (registered > now ? 1 : 0);
}
/** Best-effort read of a cached user profile's qidian flags. Triggers no
*  network call — only the identity cache (populated by fetchUserProfile /
*  fetchUserProfileByUid). */
function cachedQidianProfile(bridge, uin) {
	try {
		if ("findUserProfile" in bridge.identity) return bridge.identity.findUserProfile(uin) ?? void 0;
	} catch {}
}
export {};
