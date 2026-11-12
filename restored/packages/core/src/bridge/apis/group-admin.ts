init_logger();
var log$30 = createLogger("Bridge.GroupAdmin");
/** QQ only accepts this write from the group owner (#411). */
var MEMBER_PERMISSIONS_OWNER_ONLY = "only the group owner can change group member permissions";
var GroupAdminApi = class {
	ctx;
	constructor(ctx) {
		this.ctx = ctx;
	}
	/** Set the group's robot-add option (switch / examine) via group ext-info. */
	setRobotAddOption(groupId, robotMemberSwitch, robotMemberExamine) {
		return ModifyGroupExtInfo.invoke(this.ctx, {
			groupId,
			robotMemberSwitch,
			robotMemberExamine
		});
	}
	async getAdminSettings(groupId) {
		const [detail, robot] = await Promise.all([FetchGroupDetail.invoke(this.ctx, { groupUin: groupId }), FetchGroupExtInfo.invoke(this.ctx, { groupId })]);
		const results = detail.groupInfo?.results;
		if (!results) throw new Error(`unable to read group admin settings for group ${groupId}`);
		const privilegeFlag = results.privilegeFlag ?? 0;
		const permissions = decodeGroupMemberPermissions(privilegeFlag);
		return {
			add_type: results.addType ?? 0,
			group_question: results.question ?? "",
			group_answer: results.answer ?? "",
			robot_member_switch: robot.robotMemberSwitch,
			robot_member_examine: robot.robotMemberExamine,
			member_invite_policy: decodeMemberInvitePolicy(privilegeFlag),
			allow_member_upload_album: permissions.allowMemberUploadAlbum,
			allow_member_temporary_session: permissions.allowMemberTemporarySession,
			allow_member_create_group: permissions.allowMemberCreateGroup,
			new_member_history_visible: decodeGroupHistoryVisibility(results.groupFlagExt4 ?? 0),
			no_finger_open: results.noFingerOpen ?? 0,
			no_code_finger_open: results.noCodeFingerOpen ?? 0
		};
	}
	muteMember(groupId, userId, duration) {
		return MuteMember.invoke(this.ctx, {
			groupId,
			userId,
			duration
		});
	}
	muteAll(groupId, enable) {
		return MuteAll.invoke(this.ctx, {
			groupId,
			enable
		});
	}
	setAddOption(groupId, addType, groupQuestion, groupAnswer) {
		return SetAddOption.invoke(this.ctx, {
			groupId,
			addType,
			groupQuestion,
			groupAnswer
		});
	}
	setSearch(groupId, noFingerOpen, noCodeFingerOpen) {
		return SetSearch.invoke(this.ctx, {
			groupId,
			noFingerOpen,
			noCodeFingerOpen
		});
	}
	listCategoryTags(groupClass) {
		return GetGroupCategoryTags.invoke(this.ctx, { groupClass });
	}
	addCategoryTag(groupClass, name) {
		return AddGroupCategoryTag.invoke(this.ctx, {
			groupClass,
			name
		});
	}
	removeCategoryTag(groupClass, name) {
		return DeleteGroupCategoryTag.invoke(this.ctx, {
			groupClass,
			name
		});
	}
	async setMemberInvitePolicy(groupId, policy) {
		const currentPrivilegeFlag = await this.fetchGroupPrivilegeFlag(groupId, "group member invite policy", "before update");
		const expectedPrivilegeFlag = mergeMemberInvitePrivilegeFlag(currentPrivilegeFlag, policy);
		await SetMemberInvitePolicy.invoke(this.ctx, {
			groupId,
			currentPrivilegeFlag,
			policy
		});
		const actualPrivilegeFlag = await this.fetchGroupPrivilegeFlag(groupId, "group member invite policy", "after update");
		const mask = BigInt(MEMBER_INVITE_PRIVILEGE_MASK);
		if ((BigInt(actualPrivilegeFlag) & mask) !== (BigInt(expectedPrivilegeFlag) & mask)) throw new Error(`group member invite policy was not applied for group ${groupId}`);
	}
	async fetchGroupPrivilegeFlag(groupId, setting, phase) {
		return (await this.fetchGroupPrivilegeState(groupId, setting, phase)).privilegeFlag;
	}
	async fetchGroupPrivilegeState(groupId, setting, phase) {
		const results = (await FetchGroupDetail.invoke(this.ctx, { groupUin: groupId })).groupInfo?.results;
		if (!results) throw new Error(`unable to read ${setting} ${phase} for group ${groupId}`);
		return {
			privilegeFlag: results.privilegeFlag ?? 0,
			ownerUid: results.ownerUid
		};
	}
	async setMemberPermissions(groupId, permissions) {
		const updates = [
			["upload_album", permissions.allowMemberUploadAlbum],
			["temporary_session", permissions.allowMemberTemporarySession],
			["create_group", permissions.allowMemberCreateGroup]
		];
		if (!updates.some(([, allow]) => allow !== void 0)) throw new Error("at least one member permission must be specified");
		const before = await this.fetchGroupPrivilegeState(groupId, "group member permissions", "before update");
		const selfUid = this.ctx.identity.selfUid;
		if (selfUid && before.ownerUid && selfUid !== before.ownerUid) throw new Error(MEMBER_PERMISSIONS_OWNER_ONLY);
		let expectedPrivilegeFlag = before.privilegeFlag;
		let combinedMask = 0n;
		for (const [permission, allow] of updates) {
			if (allow === void 0) continue;
			try {
				await SetMemberPermission.invoke(this.ctx, {
					groupId,
					currentPrivilegeFlag: expectedPrivilegeFlag,
					permission,
					allow
				});
			} catch (error) {
				if (error instanceof OidbError && error.code === 1287) throw new Error(MEMBER_PERMISSIONS_OWNER_ONLY);
				throw error;
			}
			expectedPrivilegeFlag = mergeGroupMemberPermission(expectedPrivilegeFlag, permission, allow);
			combinedMask |= BigInt(GROUP_MEMBER_PERMISSION_MASKS[permission]);
		}
		const actualPrivilegeFlag = await this.fetchGroupPrivilegeFlag(groupId, "group member permissions", "after update");
		if ((BigInt(actualPrivilegeFlag) & combinedMask) !== (BigInt(expectedPrivilegeFlag) & combinedMask)) throw new Error(`group member permissions were not applied for group ${groupId}`);
	}
	async setNewMemberHistoryVisibility(groupId, visible) {
		await SetNewMemberHistoryVisibility.invoke(this.ctx, {
			groupId,
			visible
		});
		if (decodeGroupHistoryVisibility(await this.fetchGroupFlagExt4(groupId, "after update")) !== visible) throw new Error(`new-member history visibility was not applied for group ${groupId}`);
	}
	async fetchGroupFlagExt4(groupId, phase) {
		const results = (await FetchGroupDetail.invoke(this.ctx, { groupUin: groupId })).groupInfo?.results;
		if (!results) throw new Error(`unable to read new-member history visibility ${phase} for group ${groupId}`);
		return results.groupFlagExt4 ?? 0;
	}
	setAddRequest(groupId, sequence, eventType, approve, reason = "", filtered = false, operateTransInfo) {
		return SetAddRequest.invoke(this.ctx, {
			groupId,
			sequence,
			eventType,
			approve,
			reason,
			filtered,
			operateTransInfo
		});
	}
	kickMember(groupId, userId, reject, reason = "") {
		return KickMember.invoke(this.ctx, {
			groupId,
			userId,
			reject,
			reason
		});
	}
	kickMembers(groupId, userIds, reject) {
		return KickMembers.invoke(this.ctx, {
			groupId,
			userIds,
			reject
		});
	}
	async leave(groupId) {
		await LeaveGroup.invoke(this.ctx, { groupId });
		const selfUin = Number(this.ctx.identity.uin) || 0;
		const selfUid = this.ctx.identity.selfUid ?? "";
		await this.ctx.events.emit({
			kind: "group_member_leave",
			time: Math.floor(Date.now() / 1e3),
			selfUin,
			groupId,
			userUin: selfUin,
			operatorUin: selfUin,
			userUid: selfUid,
			operatorUid: selfUid,
			leaveType: "leave"
		});
		this.ctx.identity.forgetGroup(groupId);
	}
	setAdmin(groupId, userId, enable) {
		return SetAdmin.invoke(this.ctx, {
			groupId,
			userId,
			enable
		});
	}
	async getAdminPermissions(groupId, userId) {
		const logger = log$30.child({ uin: Number(this.ctx.identity.uin) });
		logger.debug("Reading administrator permissions group=%s user=%s", groupId, userId);
		const [snapshot, receiveVerify] = await Promise.all([GetAdminPermissions.invoke(this.ctx, {
			groupId,
			userId
		}), GetAdminReceiveVerify.invoke(this.ctx, {
			groupId,
			userId
		})]);
		logger.debug("Administrator permissions received group=%s user=%s recall=%s kick=%s limit=%s receiveVerify=%s", groupId, userId, snapshot.recallMemberMessage, snapshot.kickMember, snapshot.kickMemberPerDay, receiveVerify);
		return {
			group_id: groupId,
			user_id: userId,
			recall_member_message: snapshot.recallMemberMessage,
			kick_member: snapshot.kickMember,
			kick_member_per_day: snapshot.kickMemberPerDay,
			receive_verify: receiveVerify
		};
	}
	async setAdminPermissions(groupId, userId, patch) {
		const logger = log$30.child({ uin: Number(this.ctx.identity.uin) });
		logger.debug("Setting administrator permissions group=%s user=%s recall=%s kick=%s limit=%s", groupId, userId, patch.recallMemberMessage, patch.kickMember, patch.kickMemberPerDay);
		await SetAdminPermissions.invoke(this.ctx, {
			groupId,
			userId,
			...patch
		});
		logger.debug("Administrator permissions acknowledged group=%s user=%s", groupId, userId);
	}
	async setAdminReceiveVerify(groupId, userId, enable) {
		const logger = log$30.child({ uin: Number(this.ctx.identity.uin) });
		logger.debug("Setting administrator receive-verify group=%s user=%s enable=%s", groupId, userId, enable);
		await SetAdminReceiveVerify.invoke(this.ctx, {
			groupId,
			userId,
			enable
		});
		logger.debug("Administrator receive-verify confirmed group=%s user=%s", groupId, userId);
	}
	setCard(groupId, userId, card) {
		return SetMemberCard.invoke(this.ctx, {
			groupId,
			userId,
			card
		});
	}
	setName(groupId, name) {
		return SetGroupName.invoke(this.ctx, {
			groupId,
			name
		});
	}
	setSpecialTitle(groupId, userId, title) {
		return SetSpecialTitle.invoke(this.ctx, {
			groupId,
			userId,
			title
		});
	}
	/**
	* The bot's local-only label for a group. Lives here rather than
	* `FriendApi` because the semantic is "operate on a group" rather
	* than "operate on a contact list".
	*/
	setRemark(groupId, remark) {
		return SetGroupRemark.invoke(this.ctx, {
			groupId,
			remark
		});
	}
	getAtAllRemain(groupId) {
		return GetAtAllRemain.invoke(this.ctx, { groupId });
	}
};
