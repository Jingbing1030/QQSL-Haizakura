// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/event-converter/to-notice.ts"
// original bundle lines 23129-23320  (190 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function convertGroupMemberJoin(ctx, event) {
	return notice(ctx, event, {
		notice_type: "group_increase",
		sub_type: event.joinType ?? (isSameActor(event.operatorUin, event.operatorUid, event.userUin, event.userUid) ? "approve" : "invite"),
		group_id: event.groupId,
		operator_id: event.operatorUin,
		user_id: event.userUin
	});
}
function convertGroupMemberLeave(ctx, event) {
	let subType;
	switch (event.leaveType) {
		case "disband":
			subType = "disband";
			break;
		case "kick":
			subType = event.userUin === ctx.selfId ? "kick_me" : "kick";
			break;
		default: subType = "leave";
	}
	return notice(ctx, event, {
		notice_type: "group_decrease",
		sub_type: subType,
		group_id: event.groupId,
		operator_id: event.operatorUin,
		user_id: event.userUin
	});
}
function convertGroupMute(ctx, event) {
	return notice(ctx, event, {
		notice_type: "group_ban",
		sub_type: event.duration > 0 ? "ban" : "lift_ban",
		group_id: event.groupId,
		operator_id: event.operatorUin,
		user_id: event.userUin,
		duration: event.duration
	});
}
function convertGroupAdmin(ctx, event) {
	return notice(ctx, event, {
		notice_type: "group_admin",
		sub_type: event.set ? "set" : "unset",
		group_id: event.groupId,
		user_id: event.userUin
	});
}
async function convertFriendRecall(ctx, event) {
	const messageId = await applyMessageIdResolver(ctx.messageIdResolver, false, event.userUin, event.msgSeq, privateMessageEventName(event.recalledBySelf === true, false), event.time);
	return notice(ctx, event, {
		notice_type: "friend_recall",
		user_id: event.userUin,
		message_id: messageId
	});
}
async function convertGroupRecall(ctx, event) {
	const messageId = await applyMessageIdResolver(ctx.messageIdResolver, true, event.groupId, event.msgSeq, GROUP_MESSAGE_EVENT);
	return notice(ctx, event, {
		notice_type: "group_recall",
		group_id: event.groupId,
		operator_id: event.operatorUin,
		user_id: event.authorUin,
		message_id: messageId
	});
}
function convertFriendPoke(ctx, event) {
	return notice(ctx, event, {
		notice_type: "notify",
		sub_type: "poke",
		user_id: event.peerUin,
		sender_id: event.senderUin,
		target_id: event.targetUin,
		action: event.action,
		suffix: event.suffix,
		action_img_url: event.actionImgUrl
	});
}
function convertGroupPoke(ctx, event) {
	return notice(ctx, event, {
		notice_type: "notify",
		sub_type: "poke",
		group_id: event.groupId,
		user_id: event.userUin,
		target_id: event.targetUin,
		action: event.action,
		suffix: event.suffix,
		action_img_url: event.actionImgUrl
	});
}
async function convertGroupEssence(ctx, event) {
	const messageId = await applyMessageIdResolver(ctx.messageIdResolver, true, event.groupId, event.msgSeq, GROUP_MESSAGE_EVENT);
	return notice(ctx, event, {
		notice_type: "essence",
		sub_type: event.set ? "add" : "delete",
		group_id: event.groupId,
		user_id: event.senderUin,
		sender_id: event.senderUin,
		operator_id: event.operatorUin,
		message_id: messageId,
		message_seq: event.msgSeq,
		random: event.random
	});
}
function convertGroupFileUpload(ctx, event) {
	return notice(ctx, event, {
		notice_type: "group_upload",
		group_id: event.groupId,
		user_id: event.userUin,
		file: {
			id: event.fileId,
			name: event.fileName,
			size: event.fileSize,
			busid: event.busId
		}
	});
}
function convertFriendAdd(ctx, event) {
	return notice(ctx, event, {
		notice_type: "friend_add",
		user_id: event.userUin
	});
}
function convertGroupCardChange(ctx, event) {
	return notice(ctx, event, {
		notice_type: "group_card",
		group_id: event.groupId,
		user_id: event.userUin,
		card_new: event.cardNew,
		card_old: event.cardOld
	});
}
function convertBotOffline(ctx, event) {
	return notice(ctx, event, {
		notice_type: "bot_offline",
		user_id: event.selfUin,
		tag: event.tag,
		message: event.message
	});
}
function convertFriendProfileLike(ctx, event) {
	return notice(ctx, event, {
		notice_type: "notify",
		sub_type: "profile_like",
		operator_id: event.operatorUin,
		operator_nick: event.operatorNick,
		times: event.times
	});
}
function convertGroupTitleChange(ctx, event) {
	return notice(ctx, event, {
		notice_type: "notify",
		sub_type: "title",
		group_id: event.groupId,
		user_id: event.userUin,
		title: event.title
	});
}
function convertGroupNameChange(ctx, event) {
	return notice(ctx, event, {
		notice_type: "notify",
		sub_type: "group_name",
		group_id: event.groupId,
		user_id: event.operatorUin,
		name_new: event.name
	});
}
function convertFriendInputStatus(ctx, event) {
	return notice(ctx, event, {
		notice_type: "notify",
		sub_type: "input_status",
		user_id: event.userUin,
		event_type: event.eventType,
		status_text: event.statusText
	});
}
async function convertGroupMsgEmojiLike(ctx, event) {
	const messageId = await applyMessageIdResolver(ctx.messageIdResolver, true, event.groupId, event.msgSeq, GROUP_MESSAGE_EVENT);
	return notice(ctx, event, {
		notice_type: "group_msg_emoji_like",
		sub_type: event.isAdd ? "add" : "remove",
		group_id: event.groupId,
		user_id: event.operatorUin,
		operator_id: event.operatorUin,
		message_id: messageId,
		message_seq: event.msgSeq,
		likes: [{
			emoji_id: event.emojiId,
			count: event.count
		}]
	});
}
export {};
