// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/instance-context.ts"
// original bundle lines 40032-40137  (104 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function buildApiContext(ref) {
	const { bridge, messageStore, mediaStore, reactionStore } = ref;
	return {
		bridge,
		getLoginInfo: () => getLoginInfo(ref),
		isOnline: () => true,
		getUptimeMs: () => ref.getUptimeMs(),
		getMessage: async (messageId) => await messageStore.findEvent(messageId),
		refreshMessageMedia: (messageId, event) => refreshMessageMedia(ref, messageId, event),
		getMessageMeta: async (messageId) => await messageStore.findMeta(messageId),
		cacheMessageMetas: async (entries) => await messageStore.storeMetas(entries),
		listReadSessions: async () => await messageStore.listReadSessions(bridge.identity.groups.map((group) => group.groupId)),
		canSendImage: () => true,
		canSendRecord: () => true,
		sendPrivateMessage: (userId, message, autoEscape, tempGroupId) => sendPrivateMessage(ref, userId, message, autoEscape, tempGroupId, tempGroupId === void 0 ? async (event) => await ref.dispatchEvent(event, "send") : void 0),
		sendGroupMessage: (groupId, message, autoEscape) => sendGroupMessage(ref, groupId, message, autoEscape),
		deleteMessage: (_messageId, meta) => deleteMessage(bridge, meta),
		getFriendList: (withProfile) => getFriendList(bridge, withProfile),
		getGroupList: (noCache) => getGroupList(bridge, noCache),
		getGroupInfo: (groupId, noCache) => getGroupInfo(bridge, groupId, noCache),
		getGroupMemberList: (groupId, noCache) => getGroupMemberList(bridge, groupId, noCache),
		getGroupMemberInfo: (groupId, userId, noCache) => getGroupMemberInfo(bridge, groupId, userId, noCache),
		getStrangerInfo: (userId) => getStrangerInfo(bridge, userId),
		getGroupFiles: (groupId, folderId) => getGroupFiles(bridge, groupId, folderId),
		handleGroupRequest: (flag, _subType, approve, reason) => handleGroupAddRequest(bridge, flag, approve, reason),
		getGroupMsgHistory: (groupId, messageId, count, reverseOrder) => getGroupHistory(ref, groupId, messageId, count, reverseOrder),
		getFriendMsgHistory: (userId, messageId, count, reverseOrder) => getFriendHistory(ref, userId, messageId, count, reverseOrder),
		handleGetGroupSystemMsg: (query) => getGroupSystemMessages(bridge, query),
		getDownloadRKeys: () => getDownloadRKeys(bridge),
		sendGroupForwardMsg: (groupId, messages, meta) => sendGroupForwardMessage(ref, groupId, messages, meta),
		sendPrivateForwardMsg: (userId, messages, meta) => sendPrivateForwardMessage(ref, userId, messages, meta, async (event) => await ref.dispatchEvent(event, "send")),
		sendForwardMsg: (messages, groupId) => uploadForwardMessage(ref, messages, groupId),
		getForwardMsg: (resId) => getForwardMessage(ref, resId),
		forwardSingleMsg: (messageId, target) => forwardSingleMessage(ref, messageId, target, target.userId !== void 0 ? async (event) => await ref.dispatchEvent(event, "send") : void 0),
		setEssenceMsg: (messageId) => setEssenceMessage(bridge, messageStore, messageId, true),
		deleteEssenceMsg: (messageId) => setEssenceMessage(bridge, messageStore, messageId, false),
		setMsgEmojiLike: async (messageId, emojiId, set) => {
			const meta = await messageStore.findMeta(messageId);
			if (!meta) throw new Error("message not found");
			if (!meta.isGroup) throw new Error("emoji reactions are not supported on private messages");
			if (!hasAuthoritativeSequence(meta)) throw new Error("message has no authoritative QQ sequence");
			await bridge.apis.interaction.setReaction(meta.targetId, meta.sequence, emojiId, set);
			const emojiType = emojiId.length > 3 ? 2 : 1;
			if (set) await reactionStore.recordAdd(meta.targetId, meta.sequence, emojiId, emojiType, ref.selfId, "", Math.floor(Date.now() / 1e3));
			else await reactionStore.recordRemove(meta.targetId, meta.sequence, emojiId, ref.selfId);
		},
		fetchEmojiLikeSummary: async (messageId) => {
			const meta = await messageStore.findMeta(messageId);
			if (!meta) throw new Error("message not found");
			if (!meta.isGroup) throw new Error("emoji reactions are not supported on private messages");
			if (!hasAuthoritativeSequence(meta)) throw new Error("message has no authoritative QQ sequence");
			const summary = await reactionStore.summarizeMessage(meta.targetId, meta.sequence);
			const out = [];
			for (const entry of summary) {
				let users = (await reactionStore.listUsers(meta.targetId, meta.sequence, entry.emojiId, 1e3, 0)).map((user) => ({ user_id: user.operatorUin }));
				try {
					const remote = await bridge.apis.interaction.getEmojiLikes(meta.targetId, meta.sequence, entry.emojiId, entry.emojiType, 1e3);
					if (remote.users.length > 0) users = remote.users.map((user) => ({ user_id: user.uin }));
				} catch {}
				out.push({
					emoji_id: entry.emojiId,
					emoji_type: entry.emojiType,
					count: Math.max(entry.count, users.length),
					last_reaction_time: entry.lastSetAt,
					users
				});
			}
			return out;
		},
		fetchEmojiLikeUsers: async (messageId, emojiId, count, offset = 0) => {
			const meta = await messageStore.findMeta(messageId);
			if (!meta) throw new Error("message not found");
			if (!meta.isGroup) throw new Error("emoji reactions are not supported on private messages");
			if (!hasAuthoritativeSequence(meta)) throw new Error("message has no authoritative QQ sequence");
			let users = (await reactionStore.listUsers(meta.targetId, meta.sequence, emojiId, count, offset)).map((r) => ({
				uin: r.operatorUin,
				uid: r.operatorUid,
				setAt: r.setAt
			}));
			const cachedCount = await reactionStore.countUsers(meta.targetId, meta.sequence, emojiId);
			let serverCount = cachedCount;
			try {
				const remote = await bridge.apis.interaction.getEmojiLikes(meta.targetId, meta.sequence, emojiId, emojiId.length > 3 ? 2 : 1, count);
				if (remote.users.length > 0) {
					serverCount = remote.users.length;
					if (offset === 0) users = remote.users.slice(0, count).map((user) => ({
						uin: user.uin,
						uid: "",
						setAt: 0
					}));
				}
			} catch {}
			return {
				users,
				cachedCount,
				serverCount,
				complete: cachedCount >= serverCount
			};
		},
		getImageInfo: (file) => getImageInfo(mediaStore, file, ref.converterCtx.imageUrlResolver),
		getRecordInfo: (file) => getRecordInfo(bridge, mediaStore, file),
		fetchPttText: (messageId) => fetchPttText(messageStore, mediaStore, bridge, ref.selfId, messageId)
	};
}
export {};
