var InteractionApi = class {
	ctx;
	constructor(ctx) {
		this.ctx = ctx;
	}
	sendPoke(isGroup, peerUin, targetUin) {
		return SendPoke.invoke(this.ctx, {
			isGroup,
			peerUin,
			targetUin
		});
	}
	sendLike(userId, count) {
		return SendLike.invoke(this.ctx, {
			userId,
			count
		});
	}
	setReaction(groupId, sequence, code, isSet) {
		return SetReaction.invoke(this.ctx, {
			groupId,
			sequence,
			code,
			isSet
		});
	}
	setEssence(groupId, sequence, random, enable) {
		return SetEssence.invoke(this.ctx, {
			groupId,
			sequence,
			random,
			enable
		});
	}
	/** Fetch the reactor list for one emoji on a group message. */
	async getEmojiLikes(groupId, sequence, emojiId, emojiType = 1, count = 10, cookie = "") {
		try {
			return await GetEmojiLikes.invoke(this.ctx, {
				groupId,
				sequence,
				emojiId,
				emojiType,
				count,
				cookie
			});
		} catch {
			return {
				users: [],
				cookie: "",
				isLast: true
			};
		}
	}
	/**
	* Recent-used emoji catalog (0x9084_1). Not a per-message reaction list.
	*/
	fetchReactionSummary(groupId, sequence) {
		return FetchReactionSummary.invoke(this.ctx, {
			groupId,
			sequence
		});
	}
};
