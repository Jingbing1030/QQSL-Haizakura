// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/event-converter/index.ts"
// original bundle lines 23343-23415  (71 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var CONVERTERS = {
	friend_message: convertFriendMessage,
	group_message: convertGroupMessage,
	temp_message: convertTempMessage,
	group_member_join: convertGroupMemberJoin,
	group_member_leave: convertGroupMemberLeave,
	group_mute: convertGroupMute,
	group_admin: convertGroupAdmin,
	friend_recall: convertFriendRecall,
	group_recall: convertGroupRecall,
	friend_poke: convertFriendPoke,
	group_poke: convertGroupPoke,
	group_essence: convertGroupEssence,
	group_file_upload: convertGroupFileUpload,
	friend_add: convertFriendAdd,
	friend_input_status: convertFriendInputStatus,
	friend_profile_like: convertFriendProfileLike,
	bot_offline: convertBotOffline,
	group_name_change: convertGroupNameChange,
	group_title_change: convertGroupTitleChange,
	group_card_change: convertGroupCardChange,
	group_msg_emoji_like: convertGroupMsgEmojiLike,
	friend_request: convertFriendRequest,
	group_invite: convertGroupInvite,
	ptt_trans_result: null,
	online_devices_changed: null,
	friend_remark_changed: null
};
async function convertEvent(ctx, event) {
	const converter = CONVERTERS[event.kind];
	if (!converter) return null;
	return converter(ctx, event);
}
var DATALINE_DEVICES = [
	{
		terType: 1,
		uid: "u_rK7NMsbv2ZjEGPdCuOiCfw",
		name: "我的电脑",
		uin: 2113929217
	},
	{
		terType: 2,
		uid: "u_Wcc5rknRRqRO8y5gxMD6sA",
		name: "我的手机",
		uin: 2113929218
	},
	{
		terType: 3,
		uid: "u_l7jpPIZxQo0mzJwoEt-SKw",
		name: "我的Pad",
		uin: 2113929219
	}
];
var BY_UIN = new Map(DATALINE_DEVICES.map((device) => [device.uin, device]));
var BY_TER = new Map(DATALINE_DEVICES.map((device) => [device.terType, device]));
function findDatalineDeviceByUin(uin) {
	return BY_UIN.get(uin);
}
function findDatalineDeviceByTerType(terType) {
	return BY_TER.get(terType);
}
function datalineFriendListEntries() {
	return DATALINE_DEVICES.map((device) => ({
		user_id: device.uin,
		nickname: device.name,
		remark: device.name
	}));
}
function appIdForTerType(terType) {
	return terType === 1 ? 1 : 1001;
}
export {};
