// ---------------------------------------------------------------------------
// Satori adapter — event conversion + resource mapping
// ---------------------------------------------------------------------------
// NEW region: packages/onebot/src/network/satori-events.ts
//
// Pure functions. The bundle is ONE flat scope with all imports hoisted, so
// this file must not `import` anything and must not `export` anything real
// (the trailing `export {}` is stripped by scripts/build.mjs).
//
//   OneBot v11 event  ->  Satori v1 event
//
// Key conventions (decision 3 — follow LLBot so the SDK ecosystem lines up):
//   group   channel_id = String(group_id)        Channel.type = 0 (TEXT)
//   private channel_id = "private:" + user_id    Channel.type = 1 (DIRECT)
//   guild_id           = String(group_id)        QQ: one group == one guild
//
// Two traps this file is careful about:
//   * Message.created_at / updated_at are SECONDS  (contract), while the event
//     envelope's `timestamp` is MILLISECONDS.
//   * Message.id is always a STRING — OneBot's message_id is an integer and is
//     frequently negative, so a raw passthrough would break every SDK.
//
// Resource promotion (Satori spec): message.user / message.member /
// message.channel / message.guild are LIFTED to the top level of the event and
// are NOT left inside `message`.
// ---------------------------------------------------------------------------

// --- Satori Channel.type ---------------------------------------------------
var SATORI_CHANNEL_TYPE_TEXT = 0;
var SATORI_CHANNEL_TYPE_DIRECT = 1;

// --- platform id + private channel prefix ----------------------------------
var SATORI_PLATFORM = "qq";
var SATORI_PRIVATE_PREFIX = "private:";

// --- GuildRole: QQ role value -> Satori role id ----------------------------
// QQ semantic role is owner(4) / admin(3) / member(2); the three roles are
// static in QQ, so they are modelled as a fixed table.
var SATORI_ROLE_TABLE = [
	{ id: "4", name: "群主" },
	{ id: "3", name: "管理员" },
	{ id: "2", name: "成员" }
];
var SATORI_ROLE_ID_BY_ONEBOT = { owner: "4", admin: "3", member: "2" };
var SATORI_ROLE_BY_ID = {
	"4": SATORI_ROLE_TABLE[0],
	"3": SATORI_ROLE_TABLE[1],
	"2": SATORI_ROLE_TABLE[2]
};

// --- known robot UIN ranges (ported from LLBot) ----------------------------
var SATORI_ROBOT_UIN_RANGES = [
	["3328144510", "3328144510"],
	["2854196301", "2854216399"],
	["66600000", "66600000"],
	["3889000000", "3889999999"],
	["4010000000", "4019999999"]
];

/* -------------------------------------------------------------- primitives */

/** Any id-ish value -> string. `undefined`/`null` become `""`. */
function satoriIdString(value): string {
	if (value === undefined || value === null) return "";
	return String(value);
}

/** OneBot `time` (seconds) -> integer seconds, defaulting to "now". */
function satoriEventSeconds(time): number {
	const n = typeof time === "number" ? time : Number(time);
	if (!Number.isFinite(n) || n <= 0) return Math.floor(Date.now() / 1e3);
	return Math.floor(n);
}

/** OneBot `time` (seconds) -> milliseconds. Tolerates an already-ms input
*  (anything past 1e11 is far beyond any sane second timestamp). */
function satoriEventMilliseconds(time): number {
	const n = typeof time === "number" ? time : Number(time);
	if (!Number.isFinite(n) || n <= 0) return Date.now();
	return n > 1e11 ? Math.floor(n) : Math.floor(n * 1e3);
}

/** True when `uin` falls inside one of the well-known QQ robot UIN ranges. */
function satoriIsRobotUin(uin): boolean {
	const n = Number(uin);
	if (!Number.isFinite(n) || n <= 0) return false;
	for (let i = 0; i < SATORI_ROBOT_UIN_RANGES.length; i += 1) {
		const range = SATORI_ROBOT_UIN_RANGES[i];
		if (n >= Number(range[0]) && n <= Number(range[1])) return true;
	}
	return false;
}

/** `{ uin, nick }` (LLBot shape) with fallbacks for `user_id`/`id` and
*  `nickname`/`name`, so the adapter may hand us whatever ctx exposes. */
function satoriNormalizeSelf(selfInfo): { uin: string; nick: string } {
	const info = selfInfo && typeof selfInfo === "object" ? selfInfo : {};
	const rawUin = info.uin !== undefined && info.uin !== null ? info.uin
		: info.user_id !== undefined && info.user_id !== null ? info.user_id
			: info.id;
	const rawNick = info.nick !== undefined && info.nick !== null ? info.nick
		: info.nickname !== undefined && info.nickname !== null ? info.nickname
			: info.name;
	return {
		uin: rawUin === undefined || rawUin === null ? "" : String(rawUin),
		nick: rawNick === undefined || rawNick === null ? "" : String(rawNick)
	};
}

/* ------------------------------------------------------- resource builders */

/** User — `{ id, name, nick?, avatar?, is_bot? }`.
*  `name` falls back to the id so a nameless sender is still displayable. */
function satoriUserObject(id, name): any {
	const uid = satoriIdString(id);
	const label = name === undefined || name === null || name === "" ? uid : String(name);
	return {
		id: uid,
		name: label,
		avatar: `http://q.qlogo.cn/headimg_dl?dst_uin=${uid}&spec=640`,
		is_bot: satoriIsRobotUin(uid)
	};
}

/** Guild — `{ id, name, avatar? }`. QQ guilds show the group logo. */
function satoriGuildObject(id, name): any {
	const gid = satoriIdString(id);
	const label = name === undefined || name === null || name === "" ? gid : String(name);
	return {
		id: gid,
		name: label,
		avatar: `https://p.qlogo.cn/gh/${gid}/${gid}/640`
	};
}

/** Channel — `{ id, type, name?, parent_id? }`.
*  `parentId` is a PARENT CHANNEL, not the guild (Satori keeps those apart);
*  it is only set for temp sessions, where the source group is the parent. */
function satoriChannelObject(id, type, name?, parentId?): any {
	const channel: any = { id: satoriIdString(id), type };
	if (name !== undefined && name !== null && name !== "") channel.name = String(name);
	if (parentId !== undefined && parentId !== null && parentId !== "") channel.parent_id = satoriIdString(parentId);
	return channel;
}

/** Resolve a `GuildRole` from either an OneBot role name (`owner`/`admin`/
*  `member`) or an already-numeric Satori role id (`4`/`3`/`2`). */
function satoriGuildRole(role): any {
	if (role === undefined || role === null || role === "") return SATORI_ROLE_BY_ID["2"];
	const key = String(role);
	const id = SATORI_ROLE_ID_BY_ONEBOT[key] ?? (/^[234]$/.test(key) ? key : "2");
	return SATORI_ROLE_BY_ID[id];
}

/** GuildMember — `{ user, nick?, roles?, joined_at? }`.
*  `joinedAt` is given in SECONDS and emitted in milliseconds (Satori's
*  convention for GuildMember); it is omitted when unknown, which is the
*  normal case for OneBot notice events. */
function satoriGuildMemberObject(user, nick, role?, joinedAt?): any {
	const member: any = { user };
	if (nick !== undefined && nick !== null && nick !== "") member.nick = String(nick);
	member.roles = [satoriGuildRole(role)];
	if (typeof joinedAt === "number" && Number.isFinite(joinedAt) && joinedAt > 0) {
		member.joined_at = Math.floor(joinedAt * 1e3);
	}
	return member;
}

/* ------------------------------------------------- message content encoding */

/** Attribute-value escaping for the generated element string. */
function satoriEscapeAttribute(value): string {
	return String(value === undefined || value === null ? "" : value)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** Text-node escaping: `<`, `&`, `>` only. */
function satoriEscapeText(value): string {
	return String(value === undefined || value === null ? "" : value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** One OneBot v11 segment -> one Satori element. Unknown segments degrade to
*  a `[type]` text marker instead of throwing. */
function satoriSegmentToElement(segment): string {
	if (typeof segment === "string") return satoriEscapeText(segment);
	if (!segment || typeof segment !== "object") return "";
	const type = String((segment as any).type ?? "");
	const data = (segment as any).data && typeof (segment as any).data === "object" ? (segment as any).data : {};
	switch (type) {
		case "text": return satoriEscapeText(data.text ?? "");
		case "at": return data.qq === "all" ? "<at type=\"all\"/>" : `<at id="${satoriEscapeAttribute(data.qq)}"/>`;
		case "face": return `<emoji id="${satoriEscapeAttribute(data.id)}"/>`;
		case "image":
		case "mface": return `<img src="${satoriEscapeAttribute(data.url ?? data.file ?? "")}"/>`;
		case "record": return `<audio src="${satoriEscapeAttribute(data.url ?? data.file ?? "")}"/>`;
		case "video": return `<video src="${satoriEscapeAttribute(data.url ?? data.file ?? "")}"/>`;
		case "file": return `<file src="${satoriEscapeAttribute(data.url ?? data.file ?? data.file_id ?? "")}"/>`;
		case "reply": return `<quote id="${satoriEscapeAttribute(data.id)}"/>`;
		case "forward": return `<message id="${satoriEscapeAttribute(data.id)}"/>`;
		default: return satoriEscapeText(`[${type}]`);
	}
}

/** Local fallback encoder: OneBot `message` (segment array | single segment |
*  raw string) -> Satori element string. Plain text for raw strings, since CQ
*  decoding is not available synchronously here. */
function satoriEncodeContentFallback(message): string {
	if (typeof message === "string") return satoriEscapeText(message);
	if (Array.isArray(message)) return message.map((segment) => satoriSegmentToElement(segment)).join("");
	if (message && typeof message === "object") return satoriSegmentToElement(message);
	return "";
}

/** Content encoder. Delegates to `satoriEncodeMessage` from
*  satori-elements.ts when that region is part of the build, otherwise falls
*  back to the local encoder above. `typeof` on an undeclared identifier is
*  safe in JS, so this works whether or not the sibling file has landed. */
function satoriEncodeContent(message): string {
	if (typeof satoriEncodeMessage === "function") {
		try {
			const encoded = satoriEncodeMessage(message);
			if (typeof encoded === "string") return encoded;
		} catch {
			// fall through to the local encoder
		}
	}
	return satoriEncodeContentFallback(message);
}

/* --------------------------------------------------------- event envelope */

/** Monotonic Satori `sn` (and `id`). Reset only when the server restarts. */
var satoriEventSequence = 0;
/** `login.sn` — bumped by the adapter on (re)login via satoriSetLoginSequence. */
var satoriLoginSequence = 1;

function satoriResetEventSequence(value?): void {
	satoriEventSequence = typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function satoriSetLoginSequence(value?): void {
	satoriLoginSequence = typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function satoriGetEventSequence(): number {
	return satoriEventSequence;
}

/** Universal Satori event envelope:
*  `{ id, type, self_id, platform, timestamp, sn, login, ...body }`.
*  Body keys are copied over the envelope, so a converter may pass its own
*  `timestamp` (milliseconds) for exact event timing. */
function satoriEventEnvelope(type, body, selfInfo): any {
	const self = satoriNormalizeSelf(selfInfo);
	satoriEventSequence += 1;
	const sn = satoriEventSequence;
	const event: any = {
		id: sn,
		type: String(type),
		self_id: self.uin,
		platform: SATORI_PLATFORM,
		timestamp: Date.now(),
		sn,
		// Non-login events carry only `sn`, `user` and `platform` on `login`.
		login: {
			sn: satoriLoginSequence,
			user: satoriUserObject(self.uin, self.nick),
			platform: SATORI_PLATFORM
		}
	};
	if (body && typeof body === "object") {
		for (const key in body) {
			if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
			if (body[key] === undefined) continue;
			event[key] = body[key];
		}
	}
	return event;
}

/* --------------------------------------------------------- channel helpers */

/** `channel_id` -> `{ isPrivate, peerId }`. */
function satoriParseChannelId(channelId): { isPrivate: boolean; peerId: string } {
	const raw = satoriIdString(channelId);
	if (raw.indexOf(SATORI_PRIVATE_PREFIX) === 0) {
		return { isPrivate: true, peerId: raw.slice(SATORI_PRIVATE_PREFIX.length) };
	}
	return { isPrivate: false, peerId: raw };
}

/** Build a `channel_id`. A positive `groupId` wins (group channel), otherwise
*  the id is the private channel for `userId`. */
function satoriChannelId(groupId, userId): string {
	if (groupId !== undefined && groupId !== null && groupId !== "" && Number(groupId) > 0) {
		return String(groupId);
	}
	return SATORI_PRIVATE_PREFIX + satoriIdString(userId);
}

/* ------------------------------------------------------- message converter */

/** `message` / `message_sent` -> `message-created` (group or private).
*
*  `message.user|member|channel|guild` are promoted to the top level and are
*  absent from `message` itself. */
function satoriConvertMessageEvent(event, selfInfo): any {
	const self = satoriNormalizeSelf(selfInfo);
	const isGroup = event.message_type === "group";
	const sender = event.sender && typeof event.sender === "object" ? event.sender : {};
	const rawUserId = event.user_id !== undefined && event.user_id !== null ? event.user_id : sender.user_id;
	const userId = satoriIdString(rawUserId);
	const nickname = sender.nickname !== undefined && sender.nickname !== null ? sender.nickname : sender.card;
	const user = satoriUserObject(userId, nickname);
	const messageId = satoriIdString(event.message_id);
	const createdAt = satoriEventSeconds(event.time);
	const isSelf = event.post_type === "message_sent" || (self.uin !== "" && userId === self.uin);

	const message: any = {
		id: messageId,
		content: satoriEncodeContent(event.message),
		created_at: createdAt
	};
	// Additive marker for self echoes; only present when actually true so
	// ordinary inbound messages keep the untouched Satori shape.
	if (isSelf) message.is_self = true;

	const body: any = { timestamp: satoriEventMilliseconds(event.time) };

	if (isGroup) {
		const groupId = satoriIdString(event.group_id);
		const groupName = event.group_name !== undefined && event.group_name !== null ? event.group_name : "";
		body.message = message;
		body.channel = satoriChannelObject(groupId, SATORI_CHANNEL_TYPE_TEXT, groupName);
		body.guild = satoriGuildObject(groupId, groupName);
		body.member = satoriGuildMemberObject(user, sender.card, sender.role);
		body.user = user;
		return satoriEventEnvelope("message-created", body, selfInfo);
	}

	// Private: friend chat, or a temp session whose parent channel is the
	// source group (`sender.group_id`).
	let peerId = userId;
	if (event.post_type === "message_sent" && event.target_id !== undefined && event.target_id !== null) {
		peerId = satoriIdString(event.target_id);
	}
	const parentId = event.sub_type === "group" && sender.group_id ? satoriIdString(sender.group_id) : undefined;
	const channelName = isSelf ? undefined : nickname;

	body.message = message;
	body.channel = satoriChannelObject(
		satoriChannelId(0, peerId),
		SATORI_CHANNEL_TYPE_DIRECT,
		channelName,
		parentId
	);
	body.user = user;
	return satoriEventEnvelope("message-created", body, selfInfo);
}

/* -------------------------------------------------------- notice converters */

/** `group_recall` -> `message-deleted`. Only the message id survives (OneBot
*  recall notices carry no content), so `message` is a minimal shell. */
function satoriConvertGroupRecall(event, selfInfo): any {
	const groupId = satoriIdString(event.group_id);
	const operatorId = event.operator_id !== undefined && event.operator_id !== null ? event.operator_id : event.user_id;
	return satoriEventEnvelope("message-deleted", {
		timestamp: satoriEventMilliseconds(event.time),
		message: { id: satoriIdString(event.message_id), created_at: satoriEventSeconds(event.time) },
		channel: satoriChannelObject(groupId, SATORI_CHANNEL_TYPE_TEXT),
		guild: satoriGuildObject(groupId),
		user: satoriUserObject(event.user_id),
		operator: satoriUserObject(operatorId)
	}, selfInfo);
}

/** `friend_recall` -> `message-deleted` on a direct channel. */
function satoriConvertFriendRecall(event, selfInfo): any {
	return satoriEventEnvelope("message-deleted", {
		timestamp: satoriEventMilliseconds(event.time),
		message: { id: satoriIdString(event.message_id), created_at: satoriEventSeconds(event.time) },
		channel: satoriChannelObject(satoriChannelId(0, event.user_id), SATORI_CHANNEL_TYPE_DIRECT),
		user: satoriUserObject(event.user_id)
	}, selfInfo);
}

/** `group_increase` -> `guild-added` when the BOT joined, else
*  `guild-member-added` (same split LLBot makes for join gray-tips). */
function satoriConvertGroupIncrease(event, selfInfo): any {
	const self = satoriNormalizeSelf(selfInfo);
	const groupId = satoriIdString(event.group_id);
	if (self.uin !== "" && satoriIdString(event.user_id) === self.uin) {
		return satoriEventEnvelope("guild-added", {
			timestamp: satoriEventMilliseconds(event.time),
			guild: satoriGuildObject(groupId)
		}, selfInfo);
	}
	const user = satoriUserObject(event.user_id);
	return satoriEventEnvelope("guild-member-added", {
		timestamp: satoriEventMilliseconds(event.time),
		guild: satoriGuildObject(groupId),
		user,
		member: satoriGuildMemberObject(user, undefined, "member")
	}, selfInfo);
}

/** `group_decrease` -> `guild-removed` when the BOT left/was kicked, else
*  `guild-member-removed`. */
function satoriConvertGroupDecrease(event, selfInfo): any {
	const self = satoriNormalizeSelf(selfInfo);
	const groupId = satoriIdString(event.group_id);
	if (self.uin !== "" && satoriIdString(event.user_id) === self.uin) {
		return satoriEventEnvelope("guild-removed", {
			timestamp: satoriEventMilliseconds(event.time),
			guild: satoriGuildObject(groupId)
		}, selfInfo);
	}
	const user = satoriUserObject(event.user_id);
	return satoriEventEnvelope("guild-member-removed", {
		timestamp: satoriEventMilliseconds(event.time),
		guild: satoriGuildObject(groupId),
		user,
		member: satoriGuildMemberObject(user, undefined, "member")
	}, selfInfo);
}

/** `group_admin` -> `guild-member-updated` with the role flipped. */
function satoriConvertGroupAdmin(event, selfInfo): any {
	const groupId = satoriIdString(event.group_id);
	const user = satoriUserObject(event.user_id);
	const role = event.sub_type === "unset" ? "member" : "admin";
	return satoriEventEnvelope("guild-member-updated", {
		timestamp: satoriEventMilliseconds(event.time),
		guild: satoriGuildObject(groupId),
		user,
		member: satoriGuildMemberObject(user, undefined, role)
	}, selfInfo);
}

/** `group_card` -> `guild-member-updated` carrying the new card as `nick`. */
function satoriConvertGroupCardChange(event, selfInfo): any {
	const groupId = satoriIdString(event.group_id);
	const user = satoriUserObject(event.user_id);
	return satoriEventEnvelope("guild-member-updated", {
		timestamp: satoriEventMilliseconds(event.time),
		guild: satoriGuildObject(groupId),
		user,
		member: satoriGuildMemberObject(user, event.card_new, "member")
	}, selfInfo);
}

/** `group_msg_emoji_like` -> `reaction-added` / `reaction-removed`. */
function satoriConvertGroupReaction(event, selfInfo): any {
	const groupId = satoriIdString(event.group_id);
	const operatorId = event.operator_id !== undefined && event.operator_id !== null ? event.operator_id : event.user_id;
	const likes = Array.isArray(event.likes) ? event.likes : [];
	const first = likes.length > 0 && likes[0] && typeof likes[0] === "object" ? likes[0] : {};
	const emojiId = first.emoji_id !== undefined && first.emoji_id !== null ? first.emoji_id : event.emoji_id;
	const type = event.sub_type === "remove" ? "reaction-removed" : "reaction-added";
	return satoriEventEnvelope(type, {
		timestamp: satoriEventMilliseconds(event.time),
		message: { id: satoriIdString(event.message_id) },
		channel: satoriChannelObject(groupId, SATORI_CHANNEL_TYPE_TEXT),
		guild: satoriGuildObject(groupId),
		user: satoriUserObject(operatorId),
		emoji: { id: satoriIdString(emojiId) }
	}, selfInfo);
}

/** `notify` sub-types -> Satori events; the rest degrade to `null`. */
function satoriConvertNotify(event, selfInfo): any {
	const subType = event.sub_type;
	if (subType === "group_name") {
		const groupId = satoriIdString(event.group_id);
		return satoriEventEnvelope("guild-updated", {
			timestamp: satoriEventMilliseconds(event.time),
			guild: satoriGuildObject(groupId, event.name_new)
		}, selfInfo);
	}
	if (subType === "title") {
		const groupId = satoriIdString(event.group_id);
		const user = satoriUserObject(event.user_id);
		const member: any = satoriGuildMemberObject(user, undefined, "member");
		// GuildMember has no title field in the Satori schema; expose it as an
		// additive property so the information is not silently dropped.
		if (event.title !== undefined && event.title !== null) member.title = String(event.title);
		return satoriEventEnvelope("guild-member-updated", {
			timestamp: satoriEventMilliseconds(event.time),
			guild: satoriGuildObject(groupId),
			user,
			member
		}, selfInfo);
	}
	// poke / profile_like / input_status and anything unknown: dropped.
	return null;
}

/** All 13 OneBot `notice_type` values, plus `notify` sub-types. */
function satoriConvertNoticeEvent(event, selfInfo): any {
	switch (event.notice_type) {
		case "group_recall": return satoriConvertGroupRecall(event, selfInfo);
		case "friend_recall": return satoriConvertFriendRecall(event, selfInfo);
		case "group_increase": return satoriConvertGroupIncrease(event, selfInfo);
		case "group_decrease": return satoriConvertGroupDecrease(event, selfInfo);
		case "group_admin": return satoriConvertGroupAdmin(event, selfInfo);
		case "group_card": return satoriConvertGroupCardChange(event, selfInfo);
		case "group_msg_emoji_like": return satoriConvertGroupReaction(event, selfInfo);
		case "notify": return satoriConvertNotify(event, selfInfo);
		default: return null;
	}
}

/* ------------------------------------------------------- request converters */

/** `request_type=friend` -> `friend-request`. */
function satoriConvertFriendRequest(event, selfInfo): any {
	return satoriEventEnvelope("friend-request", {
		timestamp: satoriEventMilliseconds(event.time),
		user: satoriUserObject(event.user_id),
		message: {
			id: satoriIdString(event.flag),
			content: event.comment === undefined || event.comment === null ? "" : String(event.comment)
		}
	}, selfInfo);
}

/** `request_type=group` -> `guild-request` (bot invited) /
*  `guild-member-request` (someone applies or is invited). The `flag` is kept
*  as `message.id` because that is what `guild.approve` /
*  `guild.member.approve` must echo back. */
function satoriConvertGroupRequest(event, selfInfo): any {
	const groupId = satoriIdString(event.group_id);
	const body = {
		timestamp: satoriEventMilliseconds(event.time),
		guild: satoriGuildObject(groupId),
		message: {
			id: satoriIdString(event.flag),
			content: event.comment === undefined || event.comment === null ? "" : String(event.comment)
		}
	};
	const type = event.sub_type === "invite" ? "guild-request" : "guild-member-request";
	return satoriEventEnvelope(type, body, selfInfo);
}

function satoriConvertRequestEvent(event, selfInfo): any {
	switch (event.request_type) {
		case "friend": return satoriConvertFriendRequest(event, selfInfo);
		case "group": return satoriConvertGroupRequest(event, selfInfo);
		default: return null;
	}
}

/* -------------------------------------------------------- meta converters */

/** `meta_event` -> `login-added` / `login-removed`. `heartbeat` is internal
*  bookkeeping and is never converted. */
function satoriConvertMetaEvent(event, selfInfo): any {
	if (event.meta_event_type !== "lifecycle") return null;
	if (event.sub_type === "disable") {
		return satoriEventEnvelope("login-removed", { timestamp: satoriEventMilliseconds(event.time) }, selfInfo);
	}
	return satoriEventEnvelope("login-added", { timestamp: satoriEventMilliseconds(event.time) }, selfInfo);
}

/* --------------------------------------------------------------- entry point */

/** OneBot v11 event -> Satori v1 event, or `null` when there is no faithful
*  mapping. Never throws: any internal failure degrades to `null`. */
function satoriConvertEvent(onebotEvent, selfInfo): any {
	if (!onebotEvent || typeof onebotEvent !== "object") return null;
	try {
		switch (onebotEvent.post_type) {
			case "message":
			case "message_sent":
				return satoriConvertMessageEvent(onebotEvent, selfInfo);
			case "notice":
				return satoriConvertNoticeEvent(onebotEvent, selfInfo);
			case "request":
				return satoriConvertRequestEvent(onebotEvent, selfInfo);
			case "meta_event":
				return satoriConvertMetaEvent(onebotEvent, selfInfo);
			default:
				return null;
		}
	} catch {
		return null;
	}
}
export {};
