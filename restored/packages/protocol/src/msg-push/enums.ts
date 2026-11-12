// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/msg-push/enums.ts"
// original bundle lines 142945-143088  (142 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var PkgType = /* @__PURE__ */ function(PkgType) {
	PkgType[PkgType["ForwardFakePrivateMessage"] = 9] = "ForwardFakePrivateMessage";
	PkgType[PkgType["PrivateMessage"] = 166] = "PrivateMessage";
	PkgType[PkgType["GroupMessage"] = 82] = "GroupMessage";
	PkgType[PkgType["TempMessage"] = 141] = "TempMessage";
	PkgType[PkgType["Event0x210"] = 528] = "Event0x210";
	PkgType[PkgType["Event0x2DC"] = 732] = "Event0x2DC";
	PkgType[PkgType["PrivateRecordMessage"] = 208] = "PrivateRecordMessage";
	PkgType[PkgType["PrivateFileMessage"] = 529] = "PrivateFileMessage";
	PkgType[PkgType["GroupRequestInvitationNotice"] = 525] = "GroupRequestInvitationNotice";
	PkgType[PkgType["GroupRequestJoinNotice"] = 84] = "GroupRequestJoinNotice";
	/**
	* Self-join admittance — fires on the bot's session right after an
	* admin approves its `set_group_add_request` or an invite-accept
	* goes through. Ported from `lagrange-python`'s
	* `server_push/msg.py:108 case 85`. Maps to OneBot11
	* `notice.group_increase` with the bot itself as `user_id` —
	* existing 33 (GroupMemberIncreaseNotice) doesn't fire for the
	* bot's own join, so without this case the bot never knows it
	* just entered a group until the first message arrives.
	*/
	PkgType[PkgType["GroupSelfJoinedNotice"] = 85] = "GroupSelfJoinedNotice";
	PkgType[PkgType["GroupInviteNotice"] = 87] = "GroupInviteNotice";
	PkgType[PkgType["GroupAdminChangedNotice"] = 44] = "GroupAdminChangedNotice";
	PkgType[PkgType["GroupMemberIncreaseNotice"] = 33] = "GroupMemberIncreaseNotice";
	PkgType[PkgType["GroupMemberDecreaseNotice"] = 34] = "GroupMemberDecreaseNotice";
	return PkgType;
}({});
var Event0x2DCSubType = /* @__PURE__ */ function(Event0x2DCSubType) {
	Event0x2DCSubType[Event0x2DCSubType["GroupMuteNotice"] = 12] = "GroupMuteNotice";
	Event0x2DCSubType[Event0x2DCSubType["GroupMsgEmojiLikeNotice"] = 16] = "GroupMsgEmojiLikeNotice";
	Event0x2DCSubType[Event0x2DCSubType["GroupRecallNotice"] = 17] = "GroupRecallNotice";
	Event0x2DCSubType[Event0x2DCSubType["GroupGreyTipNotice"] = 20] = "GroupGreyTipNotice";
	Event0x2DCSubType[Event0x2DCSubType["GroupEssenceNotice"] = 21] = "GroupEssenceNotice";
	return Event0x2DCSubType;
}({});
var Event0x210SubType = /* @__PURE__ */ function(Event0x210SubType) {
	Event0x210SubType[Event0x210SubType["FriendRequestNotice"] = 35] = "FriendRequestNotice";
	/**
	* Voice-to-text (语音转文字) async result push, fired after a
	* `pttTrans.Trans{C2C,Group}PttReq` once the server finishes transcribing.
	* Live-verified body: `{ f1:uint, f2:{ f1=msgId, f8=text, ... } }`. There's
	* no static sys_msg_0x210_0x3d handler — the ptt-trans subsystem registers
	* it dynamically; we decode it into an internal `ptt_trans_result` event.
	*/
	Event0x210SubType[Event0x210SubType["PttTransResult"] = 61] = "PttTransResult";
	/**
	* Outgoing friend-message recall — bot recalled its own message that
	* was sent to a friend. Same `FriendRecall` wire shape as 138; the
	* difference is direction (138 = friend recalled their own message
	* sent to bot, 139 = bot recalled own message sent to friend).
	* Cross-referenced against Lagrange V2 (`FriendRecallMessageProcessor`
	* registered for both 138 and 139) + acidify (`138, 139 ->
	* parseFriendRecall`). The decoder uses the subType to figure out
	* which UID side ends up as `userUin` on the emitted event.
	*/
	Event0x210SubType[Event0x210SubType["FriendRecallSelfNotice"] = 139] = "FriendRecallSelfNotice";
	Event0x210SubType[Event0x210SubType["FriendRecallNotice"] = 138] = "FriendRecallNotice";
	Event0x210SubType[Event0x210SubType["FriendPokeNotice"] = 290] = "FriendPokeNotice";
	/**
	* Mutual-accept friend notice — 179 fires when bot sent a friend
	* request and the other side accepted; 226 fires for the opposite
	* direction. Both decode through the same `NewFriend` wire shape
	* (LagrangeGo registers them via a `case 226: case 179:` fallthrough
	* in `client/listener.go:248-258`). Maps to OneBot11
	* `notice.friend_add`.
	*/
	Event0x210SubType[Event0x210SubType["NewFriendNotice"] = 179] = "NewFriendNotice";
	Event0x210SubType[Event0x210SubType["NewFriendNoticeAlt"] = 226] = "NewFriendNoticeAlt";
	/**
	* Multiplexed subType (Lagrange calls it FriendDeleteOrPinChanged=39). One of
	* its variants is the profile-like ("名片赞") push: body.msgContent decodes as
	* `ProfileLikeTip` and is a like only when inner msgType==0 && subType==203.
	* NapCat routes 528/39 → parseLikeEvent (`api/msg.ts:1547`); other 39 variants
	* (multi-device sync etc.) fall through.
	*/
	Event0x210SubType[Event0x210SubType["ProfileLikeNotice"] = 39] = "ProfileLikeNotice";
	/**
	* C2C input-status notify — the "对方正在输入…" push. subMsgType 0x115 (277).
	* RE-confirmed against `wrapper.linux.node`
	* `aio_input_state_worker.cc::IsInputStateNotifySysMsg`, which matches exactly
	* `(msg_type ^ 0x210) | (sub_msg_type ^ 0x115) == 0`. The payload
	* (`InputStatusNotify`) rides in `body.msgContent`. Mirrors NapCat's
	* `onInputStatusPush`.
	*/
	Event0x210SubType[Event0x210SubType["InputStatusNotice"] = 277] = "InputStatusNotice";
	/**
	* QQ NT online-device cache update. The payload is a snapshot with repeated
	* device entries; the kernel's getOnLineDev call only replays this cache and
	* does not issue a separate network request.
	*/
	Event0x210SubType[Event0x210SubType["OnlineDevicesNotice"] = 349] = "OnlineDevicesNotice";
	/** Server-authoritative friend/stranger remark synchronization push. */
	Event0x210SubType[Event0x210SubType["FriendRemarkChangedNotice"] = 364] = "FriendRemarkChangedNotice";
	/**
	* Group-app state push (troop shortcut bar / discussion app).
	*
	* Sourced from the decompiled stock QQ Android client decoder at
	* `com.tencent.imcore.message.ext.codec.decoder.msgType0x210.SubType0x26`
	* (tsuzcx/qq_apk @ afe46ef). The payload is `submsgtype0x26.MsgBody`
	* dispatching on `uint32_sub_cmd`:
	*
	*   - 0x1 → `UpdateAppUnreadNum`: a list of
	*     `{group_code, app_id, unread_num}` entries the QQ client uses
	*     to keep group-internal "mini-app" badges (e.g. `appId=101846662`
	*     / `101896870` for the shortcut bar) in sync.
	*   - 0x3 → `UpdateDiscussAppInfo`: `{conf_uin, app_tip_notify.text}`
	*     for discussion-group app tips, routed to `getGAudioHandler()`.
	*   - 0x4 → delegated to the troop online-push handler.
	*
	* None of these have a OneBot event mapping — they're QQ-client-UI
	* state pushes (unread badges, in-app tips), not user-visible
	* conversation events. Acknowledge the subType so it doesn't keep
	* showing up as "unknown" in debug logs and drop it silently.
	* Lagrange V2 / lagrange-python / LagrangeGo / acidify all also
	* fall through on this one because they don't surface the shortcut
	* bar either.
	*/
	Event0x210SubType[Event0x210SubType["GroupAppStatePush"] = 38] = "GroupAppStatePush";
	/**
	* Unmapped QQ-NT-internal subType — first seen as a recurring
	* "Event0x210 unknown subType=380" debug log in production captures.
	*
	* The tsuzcx/qq_apk decompile of the legacy QQ Android client only
	* enumerates SubType0x26 (38) through SubType0x146 (326) under
	* `com.tencent.imcore.message.ext.codec.decoder.msgType0x210/` —
	* `SubType0x17c.java` (380) literally doesn't exist in that tree, so
	* 380 is a QQ-NT-era addition rather than a missed legacy subType.
	*
	* The NT-era reference clients also don't handle it: Lagrange.Core
	* (`PushMessageService.cs`), LagrangeGo (`client/listener.go`),
	* lagrange-python (`server_push/msg.py`), and mania (`push_msg.rs`)
	* each enumerate explicit 0x210 subtypes and none include 380 / 0x17C.
	*
	* Most likely a QQ-NT-client-UI state push (similar to 38) that
	* doesn't map to any OneBot event. Acknowledge silently to keep the
	* unknown log clean; if a real OneBot event ends up depending on it,
	* revisit with whichever NT-era project finally maps the schema.
	*/
	Event0x210SubType[Event0x210SubType["UnmappedClientState380"] = 380] = "UnmappedClientState380";
	return Event0x210SubType;
}({});
export {};
