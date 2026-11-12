init_logger();
var log$32 = createLogger("Bridge.Friend");
var FriendApi = class {
	ctx;
	constructor(ctx) {
		this.ctx = ctx;
	}
	/**
	* Accept or reject an inbound friend request. `uidOrFlag` is either a
	* pre-resolved UID string or a numeric uin (then resolved on the fly).
	*/
	handleRequest(uidOrFlag, approve) {
		return HandleFriendRequest.invoke(this.ctx, {
			uidOrFlag,
			approve
		});
	}
	async delete(userId, block = false) {
		if (findDatalineDeviceByUin(userId)) throw new Error("this contact cannot be deleted");
		await DeleteFriend.invoke(this.ctx, {
			userId,
			block
		});
		try {
			await this.ctx.apis.contacts.fetchFriendList();
		} catch (err) {
			log$32.warn("friend-list refresh failed after deleting user=%d: %s", userId, err instanceof Error ? err.message : String(err));
		}
	}
	async setRemark(userId, remark) {
		if (findDatalineDeviceByUin(userId)) throw new Error("this contact does not support remarks");
		if (remark === "") {
			await ClearFriendRemark.invoke(this.ctx, { userId });
			return;
		}
		await SetFriendRemark.invoke(this.ctx, {
			userId,
			remark
		});
	}
	/** List doubtful friend-add requests (可能认识的人). */
	async getDoubtRequests(count) {
		const list = await GetDoubtBuddyReq.invoke(this.ctx, { count });
		return Promise.all(list.map(async (item) => {
			let uid = item.uid;
			let userId = item.user_id;
			if (userId <= 0 && uid) userId = this.ctx.identity.findUinByUid(uid) ?? 0;
			if (!uid && userId > 0) try {
				uid = await this.ctx.resolveUserUid(userId);
			} catch (err) {
				log$32.warn("doubt-request uid resolve failed: user=%d err=%s", userId, err instanceof Error ? err.message : String(err));
			}
			return {
				...item,
				uid: uid || "",
				user_id: userId
			};
		}));
	}
	/** Approve a doubtful friend-add request. `uidOrFlag` is the list uid, or a digit-only account number. */
	async approveDoubtRequest(uidOrFlag) {
		log$32.trace("doubt-request approval: resolving applicant");
		const uid = await this.resolveDoubtFlag(uidOrFlag);
		log$32.trace("doubt-request approval: submitting request");
		await ApproveDoubtBuddyReq.invoke(this.ctx, { uid });
		log$32.trace("doubt-request approval: completed");
	}
	/** Reject (delete/decline) a doubtful friend-add request. `uidOrFlag` matches `approveDoubtRequest`. */
	async rejectDoubtRequest(uidOrFlag) {
		return RejectDoubtBuddyReq.invoke(this.ctx, { uid: await this.resolveDoubtFlag(uidOrFlag) });
	}
	/**
	* Digit-only flags are account numbers and must be translated before the
	* approval/reject packet is built. A raw number in that packet is rejected
	* by the server. Same rule as inbound friend-request handling.
	*/
	resolveDoubtFlag(uidOrFlag) {
		if (!/^\d+$/.test(uidOrFlag)) return Promise.resolve(uidOrFlag);
		return this.ctx.resolveUserUid(parseInt(uidOrFlag, 10));
	}
};
