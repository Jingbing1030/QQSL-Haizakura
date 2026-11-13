// ---------------------------------------------------------------------------
// Haizakura (SnowLuma) — Satori protocol adapter.
//
// This file is NOT from the original bundle. It is declared in
// manifest-extra.json and spliced into dist/index.mjs by scripts/build.mjs,
// running in the SAME flat module scope as the other 467 regions — so every
// bundle top-level name (createLogger, IOneBotNetworkAdapter, WebSocketServer,
// isAuthorized, readRequestBody, writeJson, abortUpgrade, safeSend, safeClose,
// parseRequestPath, normalizePath, ...) is directly visible. No imports here.
//
// Transport
//   POST /v1/<resource>.<method>   -> OneBot action, JSON body
//   GET  /v1/events (Upgrade)      -> Satori WebSocket event stream
//   auth: Authorization: Bearer <token>; WS browser token via IDENTIFY.body.token
//
// Mounting: satori-mount.ts patches OneBotInstance.createNetworkAdapter and
// instantiates this class for the `wsServers[]` entry whose `path` is the
// Satori event endpoint (`/v1/events`). That happens BEFORE any instance is
// created, so the adapter lands in OneBotNetworkManager through the normal
// reconcile() path and emitEventNow() fans every account event out to it.
// `describeStatus().kind` is therefore "satoriServer", while the config-side
// plan entry keeps kind "wsServer" — the manager only reads kind from
// describeStatus(), never from the plan.
// ---------------------------------------------------------------------------
// @ts-nocheck
init_logger();
init_errors();
var satoriLog = createLogger("OneBot.Satori");

/* -------------------------------------------------------------- protocol */

var SATORI_OP_EVENT = 0;
var SATORI_OP_PING = 1;
var SATORI_OP_PONG = 2;
var SATORI_OP_IDENTIFY = 3;
var SATORI_OP_READY = 4;
var SATORI_OP_META = 5;
var SATORI_CHANNEL_TEXT = 0;
var SATORI_CHANNEL_DIRECT = 1;
var SATORI_STATUS_OFFLINE = 0;
var SATORI_STATUS_ONLINE = 1;
var SATORI_PLATFORM = "haizakura";
var SATORI_PRIVATE_PREFIX = "private:";
/** Satori WebSocket event endpoint. Also the sentinel `path` that marks a
*  `networks.wsServers[]` entry as a Satori listener (see satori-mount.ts). */
var SATORI_EVENTS_PATH = "/v1/events";
/** Satori spec: an unsupported API must answer 404, never 501. */
var SATORI_CLOSE_INVALID_TOKEN = 4004;
var SATORI_CLOSE_INVALID_FRAME = 4000;

/* ------------------------------------------------------------ utilities */

/** QQ reports bot accounts from a few well-known number blocks. */
var SATORI_BOT_UIN_RANGES = [
	["3328144510", "3328144510"],
	["2854196301", "2854216399"],
	["66600000", "66600000"],
	["3889000000", "3889999999"],
	["4010000000", "4019999999"]
];
function satoriIsBotUin(uin) {
	var value = Number(uin);
	if (!Number.isFinite(value) || value <= 0) return false;
	for (var i = 0; i < SATORI_BOT_UIN_RANGES.length; i++) {
		if (value >= Number(SATORI_BOT_UIN_RANGES[i][0]) && value <= Number(SATORI_BOT_UIN_RANGES[i][1])) return true;
	}
	return false;
}
function satoriUserAvatar(uin) {
	return "http://q.qlogo.cn/headimg_dl?dst_uin=" + String(uin) + "&spec=640";
}
function satoriGuildAvatar(groupId) {
	return "https://p.qlogo.cn/gh/" + String(groupId) + "/" + String(groupId) + "/640";
}
/** `User` resource. `id` is always a string on the wire. */
function satoriDecodeUser(uin, name) {
	var id = String(uin ?? "");
	var label = String(name ?? "").trim();
	var user = {
		id: id,
		avatar: satoriUserAvatar(id),
		is_bot: satoriIsBotUin(id)
	};
	if (label) {
		user.name = label;
		user.nick = label;
	}
	return user;
}
function satoriDecodeGuild(groupId, name) {
	return {
		id: String(groupId ?? ""),
		name: String(name ?? ""),
		avatar: satoriGuildAvatar(groupId)
	};
}
function satoriDecodeChannel(channelId, name, isDirect) {
	var channel = {
		id: String(channelId ?? ""),
		type: isDirect ? SATORI_CHANNEL_DIRECT : SATORI_CHANNEL_TEXT
	};
	if (name) channel.name = String(name);
	return channel;
}
/** Group role id -> Satori GuildRole. QQ has a fixed 3-role ladder. */
function satoriDecodeRole(role) {
	var normalized = String(role ?? "").toLowerCase();
	var table = {
		owner: ["4", "owner"],
		admin: ["3", "admin"],
		member: ["2", "member"]
	};
	var entry = table[normalized] ?? table.member;
	return { id: entry[0], name: entry[1] };
}
function satoriRoleIdFromOneBot(role) {
	var normalized = String(role ?? "").toLowerCase();
	if (normalized === "owner") return "4";
	if (normalized === "admin") return "3";
	return "2";
}
/** OneBot `role` string from a Satori role id accepted by `guild.member.role.set`. */
function satoriRoleNameFromId(roleId) {
	var normalized = String(roleId ?? "").trim();
	if (normalized === "4" || normalized === "owner") return "owner";
	if (normalized === "3" || normalized === "admin") return "admin";
	return "member";
}
/** Split a Satori channel id into its OneBot conversation. */
function satoriParseChannelId(channelId) {
	var raw = String(channelId ?? "").trim();
	if (raw.startsWith(SATORI_PRIVATE_PREFIX)) {
		var uin = raw.slice(SATORI_PRIVATE_PREFIX.length).trim();
		return { isGroup: false, sessionId: /^\d+$/.test(uin) ? Number(uin) : 0, userId: uin, raw: raw };
	}
	return { isGroup: true, sessionId: /^\d+$/.test(raw) ? Number(raw) : 0, userId: "", raw: raw };
}
function satoriChannelIdFor(isGroup, sessionId) {
	return isGroup ? String(sessionId) : SATORI_PRIVATE_PREFIX + String(sessionId);
}
/** Satori message ids are strings; OneBot message ids are signed int32. */
function satoriToInt(value) {
	if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === "string" && value.trim()) {
		var parsed = Number(value.trim());
		if (Number.isFinite(parsed)) return Math.trunc(parsed);
	}
	return 0;
}
/** The account's own uin. `networkCtx` exposes `uin` (a string); `selfId` is
*  only present on the ApiHandler context, so both are accepted. */
function satoriSelfId(ctx) {
	var fromSelfId = satoriToInt(ctx?.selfId);
	if (fromSelfId > 0) return fromSelfId;
	return satoriToInt(ctx?.uin);
}
function satoriEscapeText(text) {
	return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function satoriEscapeAttr(value) {
	return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function satoriSegmentData(segment) {
	var data = segment && typeof segment === "object" ? segment.data : null;
	return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

/* ------------------------------------------- OneBot segments -> Satori XML */

/** Render one attribute pair, skipping empty values (Satori omits them). */
function satoriAttr(name, value) {
	if (value === void 0 || value === null) return "";
	var text = String(value);
	if (!text) return "";
	return " " + name + "=\"" + satoriEscapeAttr(text) + "\"";
}
/**
* Encode an OneBot message segment array into a Satori element string.
* Unknown segment types degrade to their printable text so an application never
* receives a raw OneBot type it cannot render.
*/
function satoriEncodeSegments(segments) {
	if (!Array.isArray(segments)) return satoriEscapeText(typeof segments === "string" ? segments : "");
	var out = [];
	for (var i = 0; i < segments.length; i++) {
		var segment = segments[i];
		if (!segment || typeof segment !== "object") continue;
		var type = String(segment.type ?? "");
		var data = satoriSegmentData(segment);
		switch (type) {
			case "text":
				out.push(satoriEscapeText(data.text ?? ""));
				break;
			case "at":
				if (String(data.qq ?? "") === "all") out.push("<at type=\"all\"/>");
				else out.push("<at" + satoriAttr("id", data.qq) + satoriAttr("name", data.name ?? data.nickname ?? data.card) + "/>");
				break;
			case "face":
				out.push("<emoji" + satoriAttr("id", data.id) + satoriAttr("name", data.name) + "/>");
				break;
			case "mface":
				out.push("<emoji" + satoriAttr("id", data.emoji_id ?? data.id) + satoriAttr("name", data.summary ?? data.name) + "/>");
				break;
			case "image":
			case "flash_file":
				out.push("<img" + satoriAttr("src", data.url ?? data.file) + satoriAttr("title", data.summary) + "/>");
				break;
			case "record":
				out.push("<audio" + satoriAttr("src", data.url ?? data.file) + "/>");
				break;
			case "video":
				out.push("<video" + satoriAttr("src", data.url ?? data.file) + satoriAttr("poster", data.thumb) + "/>");
				break;
			case "file":
				out.push("<file" + satoriAttr("src", data.url) + satoriAttr("title", data.name ?? data.file) + "/>");
				break;
			case "reply":
				out.push("<quote" + satoriAttr("id", data.id) + "/>");
				break;
			case "forward":
				out.push("<message" + satoriAttr("id", data.id) + " forward/>");
				break;
			case "json":
			case "xml":
				out.push(satoriEscapeText(data.data ?? ""));
				break;
			case "poke":
				out.push("[戳一戳]");
				break;
			default:
				if (data.text) out.push(satoriEscapeText(data.text));
				break;
		}
	}
	return out.join("");
}

/* ------------------------------------------- Satori XML -> OneBot segments */

/**
* Parse a Satori element string into an explicit tree.
*
* Deliberately tolerant: an unpaired tag or stray `>` is treated as text, which
* is what the protocol requires, and it keeps a malformed application payload
* from turning into a 500.
*/
function satoriParseTag(raw) {
	var text = String(raw ?? "").trim();
	if (!text) return null;
	var closing = text.startsWith("/");
	if (closing) text = text.slice(1).trim();
	var selfClosing = text.endsWith("/");
	if (selfClosing) text = text.slice(0, -1).trim();
	var nameMatch = /^([a-z][a-z0-9-]*)/i.exec(text);
	if (!nameMatch) return null;
	var name = nameMatch[1].toLowerCase();
	var attrs = {};
	var rest = text.slice(nameMatch[0].length);
	var re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
	var m;
	while ((m = re.exec(rest))) attrs[m[1].toLowerCase()] = satoriUnescape(m[2] ?? m[3] ?? m[4] ?? "");
	return { name: name, attrs: attrs, closing: closing, selfClosing: selfClosing };
}
function satoriUnescape(value) {
	return String(value ?? "")
		.replace(/&#x([0-9a-fA-F]+);/g, function (_all, hex) { return String.fromCodePoint(Number.parseInt(hex, 16)); })
		.replace(/&#(\d+);/g, function (_all, dec) { return String.fromCodePoint(Number.parseInt(dec, 10)); })
		.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
		.replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function satoriParseFragment(content) {
	var source = String(content ?? "");
	var roots = [];
	var stack = [{ name: "#root", attrs: {}, children: [] }];
	var buffer = "";
	var flush = function () {
		if (!buffer) return;
		stack[stack.length - 1].children.push({ name: "#text", attrs: {}, children: [], text: satoriUnescape(buffer) });
		buffer = "";
	};
	var i = 0;
	while (i < source.length) {
		var ch = source[i];
		if (ch !== "<") {
			buffer += ch;
			i += 1;
			continue;
		}
		var end = source.indexOf(">", i + 1);
		if (end === -1) {
			buffer += source.slice(i);
			break;
		}
		var raw = source.slice(i + 1, end);
		if (raw.startsWith("!--")) {
			var commentEnd = source.indexOf("-->", i + 4);
			i = commentEnd === -1 ? source.length : commentEnd + 3;
			continue;
		}
		var tag = satoriParseTag(raw);
		if (!tag) {
			buffer += source.slice(i, end + 1);
			i = end + 1;
			continue;
		}
		flush();
		if (tag.closing) {
			for (var depth = stack.length - 1; depth > 0; depth--) {
				if (stack[depth].name !== tag.name) continue;
				var closed = stack.splice(depth)[0];
				stack[stack.length - 1].children.push(closed);
				break;
			}
		} else if (tag.selfClosing) {
			stack[stack.length - 1].children.push({ name: tag.name, attrs: tag.attrs, children: [], selfClosing: true });
		} else {
			stack.push({ name: tag.name, attrs: tag.attrs, children: [] });
		}
		i = end + 1;
	}
	flush();
	while (stack.length > 1) {
		var unclosed = stack.pop();
		stack[stack.length - 1].children.push(unclosed);
	}
	for (var r = 0; r < stack[0].children.length; r++) roots.push(stack[0].children[r]);
	return roots;
}
/** Concatenate the text of a subtree (used for `p`, `a`, modifier elements). */
function satoriNodeText(node) {
	if (node.name === "#text") return node.text ?? "";
	var out = "";
	for (var i = 0; i < (node.children ?? []).length; i++) out += satoriNodeText(node.children[i]);
	return out;
}
/**
* Convert a parsed Satori fragment into OneBot message segments.
*
* Satori delivers media as `src` (a URL); OneBot's `file` field accepts a URL
* verbatim, so no download or temp file is involved on this path.
*/
function satoriNodesToSegments(nodes) {
	var segments = [];
	var push = function (segment) {
		if (segment) segments.push(segment);
	};
	var walk = function (list) {
		for (var i = 0; i < list.length; i++) {
			var node = list[i];
			var attrs = node.attrs ?? {};
			switch (node.name) {
				case "#text":
					if (node.text) push({ type: "text", data: { text: node.text } });
					break;
				case "br":
					push({ type: "text", data: { text: "\n" } });
					break;
				case "p":
					if (segments.length > 0) push({ type: "text", data: { text: "\n" } });
					walk(node.children ?? []);
					push({ type: "text", data: { text: "\n" } });
					break;
				case "at":
					push({ type: "at", data: { qq: attrs.type === "all" ? "all" : String(attrs.id ?? "") } });
					break;
				case "sharp":
					push({ type: "text", data: { text: "#" + String(attrs.name ?? attrs.id ?? "") } });
					break;
				case "emoji":
				case "face":
					push({ type: "face", data: { id: String(attrs.id ?? "0") } });
					break;
				case "img":
				case "image":
					push({ type: "image", data: { file: String(attrs.src ?? attrs.url ?? "") } });
					break;
				case "audio":
					push({ type: "record", data: { file: String(attrs.src ?? attrs.url ?? "") } });
					break;
				case "video":
					push({
						type: "video",
						data: { file: String(attrs.src ?? attrs.url ?? ""), ...(attrs.poster ? { thumb: String(attrs.poster) } : {}) }
					});
					break;
				case "file":
					push({
						type: "file",
						data: { file: String(attrs.src ?? attrs.url ?? ""), name: String(attrs.title ?? "file") }
					});
					break;
				case "quote":
					push({ type: "reply", data: { id: String(attrs.id ?? "0") } });
					walk(node.children ?? []);
					break;
				case "a":
					push({ type: "text", data: { text: satoriNodeText(node) + " ( " + String(attrs.href ?? "") + " )" } });
					break;
				case "author":
					break;
				case "message":
					walk(node.children ?? []);
					break;
				default:
					walk(node.children ?? []);
					break;
			}
		}
	};
	walk(nodes);
	return segments.filter(function (segment) {
		if (segment.type !== "text") return true;
		return String(segment.data.text ?? "").length > 0;
	});
}
/** Full Satori content string -> OneBot segments. */
function satoriParseContent(content) {
	return satoriNodesToSegments(satoriParseFragment(content));
}

/* ------------------------------------------------------- event conversion */

/** Must match the OneBot notice/request discriminator OneBot actually emits. */
function satoriMessageChannelOf(event) {
	if (event.message_type === "group") {
		return { isGroup: true, sessionId: satoriToInt(event.group_id), name: String(event.group_name ?? "") };
	}
	var sessionId = event.post_type === "message_sent" ? satoriToInt(event.target_id) || satoriToInt(event.user_id) : satoriToInt(event.user_id);
	return { isGroup: false, sessionId: sessionId, name: "" };
}
function satoriDecodeMessage(event, channel) {
	var sender = event.sender && typeof event.sender === "object" && !Array.isArray(event.sender) ? event.sender : {};
	var user = satoriDecodeUser(event.user_id, sender.card || sender.nickname);
	var channelId = satoriChannelIdFor(channel.isGroup, channel.sessionId);
	var message = {
		id: String(event.message_id ?? ""),
		content: satoriEncodeSegments(event.message),
		/** Satori timestamps are milliseconds; OneBot `time` is in seconds. */
		created_at: satoriToInt(event.time) * 1000
	};
	if (channel.isGroup) message.guild = satoriDecodeGuild(channel.sessionId, channel.name || event.group_name);
	message.channel = satoriDecodeChannel(channelId, channel.name || event.group_name, !channel.isGroup);
	message.user = user;
	if (channel.isGroup) message.member = { user: user, nick: String(sender.card || sender.nickname || "") };
	return message;
}
/**
* Promote nested resources to the event's top level and strip them from
* `message`. Satori requires `message` to be free of user/member/channel/guild
* when those resources appear as siblings.
*/
function satoriPromoteResources(event, message) {
	var payload = { message: { ...message } };
	delete payload.message.user;
	delete payload.message.member;
	delete payload.message.channel;
	delete payload.message.guild;
	if (message.user) payload.user = message.user;
	if (message.member) payload.member = message.member;
	if (message.channel) payload.channel = message.channel;
	if (message.guild) payload.guild = message.guild;
	return payload;
}
/**
* OneBot event -> Satori `{type, payload}`.
*
* Returns null for events with no Satori equivalent; those are dropped rather
* than guessed at, so an application never sees a fabricated event type.
*/
function satoriConvertOneBotEvent(event, loginUserId) {
	var postType = String(event.post_type ?? "");
	if (postType === "message" || postType === "message_sent") {
		var channel = satoriMessageChannelOf(event);
		if (channel.sessionId <= 0) return null;
		var message = satoriDecodeMessage(event, channel);
		return { type: "message-created", payload: satoriPromoteResources(event, message) };
	}
	if (postType === "notice") return satoriConvertNotice(event, loginUserId);
	if (postType === "request") return satoriConvertRequest(event);
	return null;
}
function satoriConvertNotice(event, loginUserId) {
	var noticeType = String(event.notice_type ?? "");
	var subType = String(event.sub_type ?? "");
	var groupId = satoriToInt(event.group_id);
	if (noticeType === "group_recall" || noticeType === "friend_recall") {
		var isGroupRecall = noticeType === "group_recall";
		var recallChannelId = satoriChannelIdFor(isGroupRecall, isGroupRecall ? groupId : satoriToInt(event.user_id));
		var recallPayload = {
			message: {
				id: String(event.message_id ?? ""),
				channel: satoriDecodeChannel(recallChannelId, "", !isGroupRecall)
			},
			channel: satoriDecodeChannel(recallChannelId, "", !isGroupRecall),
			user: satoriDecodeUser(event.user_id)
		};
		if (isGroupRecall) recallPayload.guild = satoriDecodeGuild(groupId);
		if (satoriToInt(event.operator_id) > 0 && satoriToInt(event.operator_id) !== satoriToInt(event.user_id)) {
			recallPayload.operator = satoriDecodeUser(event.operator_id);
		}
		return { type: "message-deleted", payload: recallPayload };
	}
	if (noticeType === "group_increase" || noticeType === "group_decrease") {
		var added = noticeType === "group_increase";
		var guild = satoriDecodeGuild(groupId);
		var memberUser = satoriDecodeUser(event.user_id);
		return {
			type: added ? "guild-member-added" : "guild-member-removed",
			payload: {
				guild: guild,
				channel: satoriDecodeChannel(String(groupId), "", false),
				user: memberUser,
				member: { user: memberUser, nick: "" },
				...(satoriToInt(event.operator_id) > 0 ? { operator: satoriDecodeUser(event.operator_id) } : {})
			}
		};
	}
	if (noticeType === "group_card" || noticeType === "group_admin") {
		var memberGuild = satoriDecodeGuild(groupId);
		var updatedUser = satoriDecodeUser(event.user_id);
		var updatePayload = {
			guild: memberGuild,
			channel: satoriDecodeChannel(String(groupId), "", false),
			user: updatedUser,
			member: {
				user: updatedUser,
				nick: String(event.card_new ?? ""),
				...(noticeType === "group_admin" ? { roles: [satoriDecodeRole(subType === "set" ? "admin" : "member")] } : {})
			}
		};
		return { type: "guild-member-updated", payload: updatePayload };
	}
	if (noticeType === "group_msg_emoji_like") {
		var reactionGuild = satoriDecodeGuild(groupId);
		var reactionChannelId = String(groupId);
		var reactionUser = satoriDecodeUser(event.operator_id ?? event.user_id);
		return {
			type: subType === "remove" ? "reaction-removed" : "reaction-added",
			payload: {
				guild: reactionGuild,
				channel: satoriDecodeChannel(reactionChannelId, "", false),
				message: { id: String(event.message_id ?? ""), channel: satoriDecodeChannel(reactionChannelId, "", false) },
				user: reactionUser,
				operator: reactionUser,
				emoji: { id: String((Array.isArray(event.likes) ? event.likes[0]?.emoji_id : "") ?? "") }
			}
		};
	}
	if (noticeType === "bot_status") {
		var login = satoriMakeLogin(loginUserId, subType === "online");
		return { type: subType === "offline" ? "login-removed" : "login-added", payload: { login: login } };
	}
	return null;
}
function satoriConvertRequest(event) {
	var requestType = String(event.request_type ?? "");
	var comment = String(event.comment ?? "");
	if (requestType === "friend") {
		return {
			type: "friend-request",
			payload: {
				user: satoriDecodeUser(event.user_id),
				message: { id: String(event.flag ?? ""), content: comment }
			}
		};
	}
	if (requestType === "group") {
		var invite = String(event.sub_type ?? "") === "invite";
		var groupId = satoriToInt(event.group_id);
		return {
			type: invite ? "guild-request" : "guild-member-request",
			payload: {
				guild: satoriDecodeGuild(groupId),
				channel: satoriDecodeChannel(String(groupId), "", false),
				user: satoriDecodeUser(event.user_id),
				member: { user: satoriDecodeUser(event.user_id), nick: "" },
				message: { id: String(event.flag ?? ""), content: comment },
				operator: satoriDecodeUser(event.user_id)
			}
		};
	}
	return null;
}
/** Readiness of this adapter, surfaced to the WebUI status list. */
function satoriDescribeError(error) {
	return error instanceof Error ? error.message : String(error);
}

/* -------------------------------------------------------- API surface */

/** Feature ids the Login advertises — exactly the methods this adapter serves. */
var SATORI_FEATURES = [
	"login.get",
	"message.create",
	"message.get",
	"message.delete",
	"message.list",
	"message.list.from",
	"channel.get",
	"channel.list",
	"guild.get",
	"guild.list",
	"guild.plain",
	"guild.member.get",
	"guild.member.list",
	"guild.member.kick",
	"guild.member.mute",
	"guild.member.role.set",
	"guild.member.approve",
	"guild.approve",
	"guild.role.list",
	"reaction.create",
	"reaction.delete",
	"reaction.list",
	"user.get",
	"friend.list",
	"friend.delete",
	"friend.approve"
];
/** OneBot response codes worth translating into an HTTP status. */
function satoriHttpStatusForResponse(response) {
	var retcode = satoriToInt(response?.retcode);
	if (retcode === 0) return 200;
	if (retcode === RETCODE.BAD_REQUEST) return 400;
	if (retcode === RETCODE.UNKNOWN_ACTION) return 404;
	return 500;
}
function satoriMethodParams(payload, ctx) {
	var source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
	/** channel_id presence is what decides group vs private for most methods. */
	var channel = satoriParseChannelId(source.channel_id);
	return { source: source, channel: channel, api: ctx.api };
}
/** `message.create` — Satori `content` in, Satori `Message[]` out. */
async function satoriCreateMessage(ctx, payload) {
	var parsed = satoriMethodParams(payload, ctx);
	if (!parsed.channel.raw) throw new Error("channel_id is required");
	if (parsed.channel.sessionId <= 0) throw new Error("channel_id is invalid");
	var segments = satoriParseContent(parsed.source.content);
	if (segments.length === 0) throw new Error("content must contain at least one sendable element");
	var params = parsed.channel.isGroup
		? { message_type: "group", group_id: parsed.channel.sessionId, message: segments }
		: { message_type: "private", user_id: parsed.channel.sessionId, message: segments };
	var sent = await ctx.api.handle("send_msg", params);
	if (sent.status !== "ok") throw new Error(sent.wording || "send_msg failed");
	var messageId = satoriToInt(sent.data?.message_id);
	return [satoriBuildSentMessage(parsed.channel, messageId, segments)];
}
/**
* Build the Satori Message for a just-sent OneBot message.
*
* The local OneBot `get_msg` lookup can legitimately miss a self-sent message
* whose echo has not landed yet, so a missing record falls back to echoing the
* submitted content instead of failing a send that already succeeded.
*/
function satoriBuildSentMessage(channel, messageId, segments) {
	var channelId = satoriChannelIdFor(channel.isGroup, channel.sessionId);
	var message = {
		id: String(messageId),
		content: satoriEncodeSegments(segments),
		/** Satori timestamps are milliseconds (matching `created_at` on receive). */
		created_at: Date.now(),
		channel: satoriDecodeChannel(channelId, "", !channel.isGroup)
	};
	if (channel.isGroup) message.guild = satoriDecodeGuild(channel.sessionId, "");
	return message;
}
async function satoriGetMessage(ctx, payload) {
	var parsed = satoriMethodParams(payload, ctx);
	var messageId = satoriToInt(parsed.source.message_id);
	if (messageId === 0) throw new Error("message_id is required");
	var response = await ctx.api.handle("get_msg", { message_id: messageId });
	if (response.status !== "ok" || !response.data) throw new Error(response.wording || "message not found");
	return satoriDecodeMessage(response.data, satoriMessageChannelOf(response.data));
}
async function satoriDeleteMessage(ctx, payload) {
	var parsed = satoriMethodParams(payload, ctx);
	var messageId = satoriToInt(parsed.source.message_id);
	if (messageId === 0) throw new Error("message_id is required");
	var response = await ctx.api.handle("delete_msg", { message_id: messageId });
	if (response.status !== "ok") throw new Error(response.wording || "delete_msg failed");
	return null;
}
/** `message.list` — OneBot history actions, remapped into a Satori BidiList. */
async function satoriListMessages(ctx, payload) {
	var parsed = satoriMethodParams(payload, ctx);
	if (!parsed.channel.raw) throw new Error("channel_id is required");
	if (parsed.channel.sessionId <= 0) throw new Error("channel_id is invalid");
	var limit = satoriToInt(parsed.source.limit);
	if (limit <= 0 || limit > 100) limit = 50;
	var anchor = satoriToInt(parsed.source.next ?? parsed.source.message_id);
	var order = String(parsed.source.order ?? "desc") === "asc" ? false : true;
	var params = parsed.channel.isGroup
		? { group_id: parsed.channel.sessionId, message_id: anchor, count: limit, reverse_order: order }
		: { user_id: parsed.channel.sessionId, message_id: anchor, count: limit, reverse_order: order };
	var response = await ctx.api.handle(parsed.channel.isGroup ? "get_group_msg_history" : "get_friend_msg_history", params);
	if (response.status !== "ok") throw new Error(response.wording || "message history unavailable");
	var rows = Array.isArray(response.data?.messages) ? response.data.messages : [];
	var data = [];
	for (var i = 0; i < rows.length; i++) {
		var row = rows[i];
		if (!row || typeof row !== "object") continue;
		data.push(satoriDecodeMessage(row, parsed.channel));
	}
	var list = { data: data };
	/** A full page implies there may be more; the oldest id is the next cursor. */
	if (data.length >= limit && data.length > 0) list.next = data[data.length - 1].id;
	return list;
}
async function satoriGetChannel(ctx, payload) {
	var parsed = satoriMethodParams(payload, ctx);
	if (!parsed.channel.raw) throw new Error("channel_id is required");
	if (!parsed.channel.isGroup) {
		if (parsed.channel.sessionId <= 0) throw new Error("channel_id is invalid");
		var stranger = await ctx.api.handle("get_stranger_info", { user_id: parsed.channel.sessionId });
		var strangerName = stranger.status === "ok" ? String(stranger.data?.nickname ?? "") : "";
		return satoriDecodeChannel(parsed.channel.raw, strangerName, true);
	}
	var info = await ctx.api.handle("get_group_info", { group_id: parsed.channel.sessionId });
	var name = info.status === "ok" ? String(info.data?.group_name ?? info.data?.group_remark ?? "") : "";
	return satoriDecodeChannel(parsed.channel.raw, name, false);
}
async function satoriListChannels(ctx, payload) {
	var source = payload && typeof payload === "object" ? payload : {};
	var guildId = satoriToInt(source.guild_id);
	if (guildId <= 0) throw new Error("guild_id is required");
	var info = await ctx.api.handle("get_group_info", { group_id: guildId });
	var name = info.status === "ok" ? String(info.data?.group_name ?? "") : "";
	return { data: [satoriDecodeChannel(String(guildId), name, false)] };
}
async function satoriGetGuild(ctx, payload) {
	var source = payload && typeof payload === "object" ? payload : {};
	var guildId = satoriToInt(source.guild_id);
	if (guildId <= 0) throw new Error("guild_id is required");
	var info = await ctx.api.handle("get_group_info", { group_id: guildId });
	var row = info.status === "ok" && info.data ? info.data : {};
	return satoriDecodeGuild(guildId, row.group_name ?? row.group_remark ?? "");
}
async function satoriListGuilds(ctx) {
	var response = await ctx.api.handle("get_group_list", {});
	var rows = Array.isArray(response.data) ? response.data : [];
	var data = [];
	for (var i = 0; i < rows.length; i++) {
		var row = rows[i];
		if (!row || typeof row !== "object") continue;
		data.push(satoriDecodeGuild(row.group_id, row.group_name ?? row.group_remark ?? ""));
	}
	return { data: data };
}
async function satoriGetGuildMember(ctx, payload) {
	var source = payload && typeof payload === "object" ? payload : {};
	var guildId = satoriToInt(source.guild_id);
	var userId = satoriToInt(source.user_id);
	if (guildId <= 0 || userId <= 0) throw new Error("guild_id and user_id are required");
	var response = await ctx.api.handle("get_group_member_info", { group_id: guildId, user_id: userId });
	if (response.status !== "ok" || !response.data) throw new Error(response.wording || "member not found");
	return satoriDecodeMember(response.data);
}
function satoriDecodeMember(row) {
	var user = satoriDecodeUser(row.user_id, row.card || row.nickname);
	var member = { user: user, nick: String(row.card || row.nickname || ""), avatar: satoriUserAvatar(row.user_id) };
	var joinedAt = satoriToInt(row.join_time);
	if (joinedAt > 0) member.joined_at = joinedAt * 1000;
	member.roles = [satoriDecodeRole(row.role)];
	return member;
}
async function satoriListGuildMembers(ctx, payload) {
	var source = payload && typeof payload === "object" ? payload : {};
	var guildId = satoriToInt(source.guild_id);
	if (guildId <= 0) throw new Error("guild_id is required");
	var response = await ctx.api.handle("get_group_member_list", { group_id: guildId });
	var rows = Array.isArray(response.data) ? response.data : [];
	var data = [];
	for (var i = 0; i < rows.length; i++) {
		var row = rows[i];
		if (!row || typeof row !== "object") continue;
		data.push(satoriDecodeMember(row));
	}
	return { data: data };
}
async function satoriKickGuildMember(ctx, payload) {
	var source = payload && typeof payload === "object" ? payload : {};
	var guildId = satoriToInt(source.guild_id);
	var userId = satoriToInt(source.user_id);
	if (guildId <= 0 || userId <= 0) throw new Error("guild_id and user_id are required");
	var response = await ctx.api.handle("set_group_kick", {
		group_id: guildId,
		user_id: userId,
		reject_add_request: source.permanent === true
	});
	if (response.status !== "ok") throw new Error(response.wording || "kick failed");
	return null;
}
async function satoriMuteGuildMember(ctx, payload) {
	var source = payload && typeof payload === "object" ? payload : {};
	var guildId = satoriToInt(source.guild_id);
	var userId = satoriToInt(source.user_id);
	if (guildId <= 0 || userId <= 0) throw new Error("guild_id and user_id are required");
	/** Satori durations are milliseconds; OneBot's set_group_ban takes seconds. */
	var durationMs = satoriToInt(source.duration);
	var seconds = durationMs <= 0 ? 0 : Math.max(1, Math.ceil(durationMs / 1000));
	var response = await ctx.api.handle("set_group_ban", { group_id: guildId, user_id: userId, duration: seconds });
	if (response.status !== "ok") throw new Error(response.wording || "mute failed");
	return null;
}
async function satoriSetGuildMemberRole(ctx, payload) {
	var source = payload && typeof payload === "object" ? payload : {};
	var guildId = satoriToInt(source.guild_id);
	var userId = satoriToInt(source.user_id);
	if (guildId <= 0 || userId <= 0) throw new Error("guild_id and user_id are required");
	var enable = satoriRoleNameFromId(source.role_id) === "admin";
	var response = await ctx.api.handle("set_group_admin", { group_id: guildId, user_id: userId, enable: enable });
	if (response.status !== "ok") throw new Error(response.wording || "role change failed");
	return null;
}
async function satoriListGuildRoles(ctx, payload) {
	var source = payload && typeof payload === "object" ? payload : {};
	var guildId = satoriToInt(source.guild_id);
	if (guildId <= 0) throw new Error("guild_id is required");
	/** QQ has a fixed ladder, so the list is static and never hits the network. */
	return {
		data: [
			{ id: "4", name: "owner", position: 3 },
			{ id: "3", name: "admin", position: 2 },
			{ id: "2", name: "member", position: 1 }
		]
	};
}
async function satoriCreateReaction(ctx, payload) {
	var parsed = satoriMethodParams(payload, ctx);
	var messageId = satoriToInt(parsed.source.message_id);
	if (messageId === 0) throw new Error("message_id is required");
	if (!String(parsed.source.emoji_id ?? "").trim()) throw new Error("emoji_id is required");
	var response = await ctx.api.handle("set_msg_emoji_like", {
		message_id: messageId,
		emoji_id: String(parsed.source.emoji_id),
		set: true
	});
	if (response.status !== "ok") throw new Error(response.wording || "reaction failed");
	return null;
}
async function satoriDeleteReaction(ctx, payload) {
	var parsed = satoriMethodParams(payload, ctx);
	var messageId = satoriToInt(parsed.source.message_id);
	if (messageId === 0) throw new Error("message_id is required");
	if (!String(parsed.source.emoji_id ?? "").trim()) throw new Error("emoji_id is required");
	var response = await ctx.api.handle("set_msg_emoji_like", {
		message_id: messageId,
		emoji_id: String(parsed.source.emoji_id),
		set: false
	});
	if (response.status !== "ok") throw new Error(response.wording || "reaction removal failed");
	return null;
}
async function satoriListReactions(ctx, payload) {
	var parsed = satoriMethodParams(payload, ctx);
	var messageId = satoriToInt(parsed.source.message_id);
	if (messageId === 0) throw new Error("message_id is required");
	if (!String(parsed.source.emoji_id ?? "").trim()) throw new Error("emoji_id is required");
	var response = await ctx.api.handle("get_emoji_likes", {
		message_id: messageId,
		emoji_id: String(parsed.source.emoji_id)
	});
	if (response.status !== "ok") throw new Error(response.wording || "reaction list unavailable");
	var rows = Array.isArray(response.data?.emoji_like_list) ? response.data.emoji_like_list : [];
	var data = [];
	for (var i = 0; i < rows.length; i++) {
		var row = rows[i];
		if (!row || typeof row !== "object") continue;
		data.push(satoriDecodeUser(row.user_id, row.nick_name));
	}
	return { data: data };
}
async function satoriGetUser(ctx, payload) {
	var source = payload && typeof payload === "object" ? payload : {};
	var userId = satoriToInt(source.user_id);
	if (userId <= 0) throw new Error("user_id is required");
	var response = await ctx.api.handle("get_stranger_info", { user_id: userId });
	if (response.status !== "ok" || !response.data) throw new Error(response.wording || "user not found");
	return satoriDecodeUser(userId, response.data.nickname);
}
async function satoriListFriends(ctx) {
	var response = await ctx.api.handle("get_friend_list", {});
	var rows = Array.isArray(response.data) ? response.data : [];
	var data = [];
	for (var i = 0; i < rows.length; i++) {
		var row = rows[i];
		if (!row || typeof row !== "object") continue;
		data.push({ user: satoriDecodeUser(row.user_id, row.nickname ?? row.remark), nick: String(row.remark ?? "") });
	}
	return { data: data };
}
async function satoriDeleteFriend(ctx, payload) {
	var source = payload && typeof payload === "object" ? payload : {};
	var userId = satoriToInt(source.user_id);
	if (userId <= 0) throw new Error("user_id is required");
	var response = await ctx.api.handle("delete_friend", { user_id: userId });
	if (response.status !== "ok") throw new Error(response.wording || "delete friend failed");
	return null;
}
async function satoriApproveFriend(ctx, payload) {
	var source = payload && typeof payload === "object" ? payload : {};
	var flag = String(source.message_id ?? "").trim();
	if (!flag) throw new Error("message_id (request flag) is required");
	var response = await ctx.api.handle("set_friend_add_request", { flag: flag, approve: source.approve !== false });
	if (response.status !== "ok") throw new Error(response.wording || "friend request failed");
	return null;
}
async function satoriApproveGuild(ctx, payload) {
	var source = payload && typeof payload === "object" ? payload : {};
	var flag = String(source.message_id ?? "").trim();
	if (!flag) throw new Error("message_id (request flag) is required");
	var response = await ctx.api.handle("set_group_add_request", {
		flag: flag,
		sub_type: "invite",
		approve: source.approve !== false,
		reason: String(source.comment ?? "")
	});
	if (response.status !== "ok") throw new Error(response.wording || "guild request failed");
	return null;
}
async function satoriApproveGuildMember(ctx, payload) {
	var source = payload && typeof payload === "object" ? payload : {};
	var flag = String(source.message_id ?? "").trim();
	if (!flag) throw new Error("message_id (request flag) is required");
	var response = await ctx.api.handle("set_group_add_request", {
		flag: flag,
		sub_type: "add",
		approve: source.approve !== false,
		reason: String(source.comment ?? "")
	});
	if (response.status !== "ok") throw new Error(response.wording || "member request failed");
	return null;
}
function satoriMakeLogin(userId, online) {
	return {
		sn: 1,
		adapter: SATORI_PLATFORM,
		platform: SATORI_PLATFORM,
		user: satoriDecodeUser(userId),
		status: online ? SATORI_STATUS_ONLINE : SATORI_STATUS_OFFLINE,
		features: SATORI_FEATURES
	};
}
async function satoriGetLogin(ctx) {
	var info = await ctx.api.handle("get_login_info", {});
	var userId = info.status === "ok" && info.data ? info.data.user_id : satoriSelfId(ctx);
	var login = satoriMakeLogin(userId, true);
	if (info.status === "ok" && info.data) login.user = satoriDecodeUser(userId, info.data.nickname);
	return login;
}
/**
* `resource.method` -> handler. A name absent from this table is answered with
* 404, which is what the protocol requires for an API the platform does not
* support.
*/
var SATORI_API = {
	"login.get": satoriGetLogin,
	"message.create": satoriCreateMessage,
	"message.get": satoriGetMessage,
	"message.delete": satoriDeleteMessage,
	"message.list": satoriListMessages,
	"channel.get": satoriGetChannel,
	"channel.list": satoriListChannels,
	"guild.get": satoriGetGuild,
	"guild.list": satoriListGuilds,
	"guild.member.get": satoriGetGuildMember,
	"guild.member.list": satoriListGuildMembers,
	"guild.member.kick": satoriKickGuildMember,
	"guild.member.mute": satoriMuteGuildMember,
	"guild.member.role.set": satoriSetGuildMemberRole,
	"guild.member.approve": satoriApproveGuildMember,
	"guild.approve": satoriApproveGuild,
	"guild.role.list": satoriListGuildRoles,
	"reaction.create": satoriCreateReaction,
	"reaction.delete": satoriDeleteReaction,
	"reaction.list": satoriListReactions,
	"user.get": satoriGetUser,
	"friend.list": satoriListFriends,
	"friend.delete": satoriDeleteFriend,
	"friend.approve": satoriApproveFriend
};

/* ---------------------------------------------------------- the adapter */

var moduleLogSatori = satoriLog;

var SatoriServerAdapter = class extends IOneBotNetworkAdapter {
	server = null;
	webSocketServer = null;
	listening = false;
	releaseForced = false;
	closePromise = null;
	acceptingActions = false;
	inFlightActions = /* @__PURE__ */ new Set();
	/** Live Satori event connections, each with its own event sequence. */
	connections = /* @__PURE__ */ new Map();
	/** Monotonic Satori event `sn`; also the session-resume cursor. */
	eventSeq = 0;
	/** Most recent event per connection is tracked for IDENTIFY session resume. */
	constructor(name, config, ctx) {
		super(name, config, ctx, moduleLogSatori);
	}
	async open() {
		if (this.isEnabled && this.listening) return;
		if (this.config.enabled === false) return;
		if (this.server) throw new Error(`Satori adapter [${this.name}] still owns a previous server`);
		await this.startServer();
		this.isEnabled = true;
		this.clearApplyFailure();
	}
	async close() {
		if (this.closePromise) return this.closePromise;
		if (!this.isEnabled && !this.server && this.inFlightActions.size === 0 && this.connections.size === 0) return;
		const wasEnabled = this.isEnabled;
		const wasListening = this.listening;
		const wasAccepting = this.acceptingActions;
		this.acceptingActions = false;
		this.isEnabled = false;
		this.listening = false;
		this.closeConnections(1001, "server closing");
		const server = this.server;
		const webSocketServer = this.webSocketServer;
		const releaseHttp = server ? new Promise((resolve, reject) => {
			server.close((error) => {
				if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
				else resolve();
			});
		}) : Promise.resolve();
		let httpReleased = false;
		const attempt = (async () => {
			await Promise.all([releaseHttp, Promise.all(this.inFlightActions)]);
			httpReleased = true;
			if (this.server === server) this.server = null;
			if (webSocketServer) {
				await new Promise((resolve) => {
					webSocketServer.close(() => resolve());
				});
				if (this.webSocketServer === webSocketServer) this.webSocketServer = null;
			}
		})();
		this.closePromise = attempt;
		try {
			await attempt;
		} catch (error) {
			if (this.releaseForced) return;
			if (!httpReleased && server?.listening === true) {
				this.isEnabled = wasEnabled;
				this.listening = wasListening;
				this.acceptingActions = wasAccepting;
			}
			throw error;
		} finally {
			this.closePromise = null;
		}
	}
	forceClose() {
		this.releaseForced = true;
		this.acceptingActions = false;
		this.isEnabled = false;
		this.listening = false;
		this.closeConnections(1001, "server closing");
		const webSocketServer = this.webSocketServer;
		this.webSocketServer = null;
		const server = this.server;
		this.server = null;
		if (webSocketServer) try {
			webSocketServer.destroy();
		} catch {}
		if (server) {
			try {
				server.closeAllConnections();
			} catch {}
			try {
				server.close(() => void 0);
			} catch {}
		}
	}
	describeStatus() {
		if (!this.isEnabled) return {
			name: this.name,
			kind: "satoriServer",
			status: "disabled",
			detail: "未启用"
		};
		if (!this.listening) return {
			name: this.name,
			kind: "satoriServer",
			status: "down",
			detail: "未监听（端口被占用？）"
		};
		return {
			name: this.name,
			kind: "satoriServer",
			status: "ok",
			detail: `Satori v1 · ${this.connections.size} 个事件客户端`
		};
	}
	bindingSignature(config) {
		return `${config.host ?? "0.0.0.0"}:${config.port}${normalizePath(config.path ?? "/")}#${config.accessToken ?? ""}#${config.maxPayloadBytes ?? ""}`;
	}
	onConfigReplaced(next) {
		/** A rotated token must not leave old clients subscribed. */
		if ((this.config.accessToken ?? "") !== (next.accessToken ?? "")) this.closeConnections(1008, "access token changed");
	}
	onEvent(event, _payload) {
		if (!this.isEnabled || this.connections.size === 0) return;
		/** SECURITY: only sockets that completed IDENTIFY may receive event
		*  frames. Without this check a connection that never authenticated
		*  would still receive full event payloads (message contents included)
		*  during the 10 s IDENTIFY grace window. */
		let hasIdentified = false;
		for (const connection of this.connections.values()) {
			if (connection.identified) { hasIdentified = true; break; }
		}
		if (!hasIdentified) return;
		let converted;
		try {
			converted = satoriConvertOneBotEvent(event, satoriSelfId(this.ctx));
		} catch (error) {
			this.log.warn("[%s] event conversion failed: %s", this.name, satoriDescribeError(error));
			return;
		}
		if (!converted) return;
		this.eventSeq += 1;
		const frame = JSON.stringify({
			op: SATORI_OP_EVENT,
			body: {
				id: this.eventSeq,
				sn: this.eventSeq,
				type: converted.type,
				timestamp: Date.now(),
				login: { sn: 1, adapter: SATORI_PLATFORM, platform: SATORI_PLATFORM, user: satoriDecodeUser(satoriSelfId(this.ctx)) },
				...converted.payload
			}
		});
		for (const connection of this.connections.values()) {
			/** SECURITY: never broadcast to sockets that have not IDENTIFYed. */
			if (connection.identified) safeSend(connection.socket, frame);
		}
	}
	closeConnections(code, reason) {
		for (const connection of this.connections.values()) safeClose(connection.socket, code, reason);
		this.connections.clear();
	}
	/** Authenticate the HTTP upgrade. Satori's WebSocket token arrives later in
	*  IDENTIFY, so the upgrade itself only passes when no token is configured. */
	authorizeUpgrade(request) {
		if (!this.config.accessToken) return true;
		return isAuthorized(request, this.config.accessToken ?? "");
	}
	acceptConnection(socket, request) {
		if (!this.acceptingActions || this.ctx.api.isAcceptingActions === false) {
			safeClose(socket, 1012, "server closing");
			return;
		}
		const connection = {
			socket: socket,
			identified: false,
			lastSn: 0,
			/** Frames may not arrive before IDENTIFY; the spec allows 10 s. */
			identifyTimer: null
		};
		const requireIdentifyBy = setTimeout(() => {
			if (!connection.identified && this.connections.has(socket)) safeClose(socket, SATORI_CLOSE_INVALID_FRAME, "IDENTIFY timeout");
		}, 1e4);
		if (requireIdentifyBy.unref) requireIdentifyBy.unref();
		connection.identifyTimer = requireIdentifyBy;
		this.connections.set(socket, connection);
		socket.on("message", (raw) => {
			if (!this.connections.has(socket)) return;
			this.trackInboundAction(() => this.handleClientFrame(connection, raw));
		});
		socket.on("close", () => {
			if (connection.identifyTimer) clearTimeout(connection.identifyTimer);
			this.connections.delete(socket);
		});
		socket.on("error", (error) => {
			this.log.warn("[%s] Satori socket error: %s", this.name, satoriDescribeError(error));
		});
	}
	async handleClientFrame(connection, raw) {
		const text = rawDataToString(raw);
		if (!text) return;
		let payload;
		try {
			payload = JSON.parse(text);
		} catch {
			safeClose(connection.socket, SATORI_CLOSE_INVALID_FRAME, "invalid message");
			return;
		}
		if (!payload || typeof payload !== "object") {
			safeClose(connection.socket, SATORI_CLOSE_INVALID_FRAME, "invalid message");
			return;
		}
		if (payload.op === SATORI_OP_IDENTIFY) {
			const expected = this.config.accessToken ?? "";
			const provided = payload.body && typeof payload.body === "object" ? String(payload.body.token ?? "") : "";
			if (expected && provided !== expected) {
				this.log.debug("[%s] rejected Satori IDENTIFY with a bad token", this.name);
				safeClose(connection.socket, SATORI_CLOSE_INVALID_TOKEN, "invalid token");
				return;
			}
			connection.identified = true;
			if (connection.identifyTimer) clearTimeout(connection.identifyTimer);
			const resumeSn = satoriToInt(payload.body?.sn);
			if (resumeSn > 0) connection.lastSn = resumeSn;
			let logins = [];
			try {
				logins = [await satoriGetLogin(this.ctx)];
			} catch (error) {
				this.log.warn("[%s] login lookup failed for READY: %s", this.name, satoriDescribeError(error));
				logins = [satoriMakeLogin(satoriSelfId(this.ctx), true)];
			}
			safeSend(connection.socket, JSON.stringify({
				op: SATORI_OP_READY,
				body: { logins: logins, proxy_urls: [] }
			}));
			this.log.success("[%s] Satori client identified (%d online)", this.name, this.connections.size);
			return;
		}
		if (payload.op === SATORI_OP_PING) {
			safeSend(connection.socket, JSON.stringify({ op: SATORI_OP_PONG, body: {} }));
			return;
		}
		/** Any other opcode is a protocol error; the spec only defines the two above. */
		this.log.debug("[%s] ignored unsupported Satori opcode %s", this.name, String(payload.op));
	}
	trackInboundAction(start) {
		if (!this.acceptingActions) return;
		let action;
		try {
			action = start();
		} catch (error) {
			this.log.error("[%s] inbound action start failed: %s", this.name, satoriDescribeError(error));
			return;
		}
		const tracked = action.then(() => void 0, (error) => {
			this.log.error("[%s] inbound action failed: %s", this.name, satoriDescribeError(error));
		});
		this.inFlightActions.add(tracked);
		tracked.then(() => {
			this.inFlightActions.delete(tracked);
		});
	}
	startServer() {
		return new Promise((resolve, reject) => {
			const server = http.createServer((req, res) => {
				this.trackInboundAction(() => this.handleRequest(req, res));
			});
			this.server = server;
			let webSocketServer = null;
			try {
				webSocketServer = new WebSocketServer({
					noServer: true,
					maxPayload: this.config.maxPayloadBytes
				});
				this.webSocketServer = webSocketServer;
				server.on("upgrade", (req, socket, head) => {
					if (parseRequestPath(req.url ?? "/") !== this.eventsPath()) {
						this.log.debug("[%s] rejected WebSocket upgrade for an unknown path", this.name);
						abortUpgrade(socket, 404, "Not Found");
						return;
					}
					webSocketServer.handleUpgrade(req, socket, head, (ws) => this.acceptConnection(ws, req));
				});
			} catch (error) {
				this.server = null;
				this.recordTransportFailure(error);
				reject(error);
				return;
			}
			let opening = true;
			server.once("listening", () => {
				opening = false;
				if (this.server !== server || this.closePromise) {
					webSocketServer?.close();
					server.close();
					reject(/* @__PURE__ */ new Error(`Satori adapter [${this.name}] was closed while binding`));
					return;
				}
				this.listening = true;
				this.isEnabled = true;
				this.acceptingActions = true;
				this.log.success("[%s] Satori listening %s:%d%s", this.name, this.config.host ?? "0.0.0.0", this.config.port, normalizePath(this.config.path ?? "/"));
				resolve();
			});
			server.on("error", (error) => {
				if (this.server === server) {
					this.listening = false;
					this.isEnabled = false;
					this.acceptingActions = false;
					this.recordTransportFailure(error);
					if (opening) {
						this.server = null;
						if (this.webSocketServer === webSocketServer) this.webSocketServer = null;
					}
				}
				this.log.error("[%s] server error: %s", this.name, satoriDescribeError(error));
				if (opening) {
					opening = false;
					reject(error);
				}
			});
			try {
				server.listen(this.config.port, this.config.host ?? "0.0.0.0");
			} catch (error) {
				opening = false;
				if (this.server === server) this.server = null;
				if (this.webSocketServer === webSocketServer) this.webSocketServer = null;
				this.recordTransportFailure(error);
				reject(error);
			}
		});
	}
	/**
	* Absolute mount prefix of this listener.
	*
	* This adapter is mounted by reuse of `networks.wsServers[]`, where a
	* `path` of `/v1/events` is the sentinel that selects the Satori transport.
	* That sentinel already names the Satori WebSocket endpoint, so the router
	* must NOT append another `/v1` — otherwise the server would only answer
	* `/v1/events/v1/...`. Any other `path` is treated as a plain prefix.
	*/
	mountPrefix() {
		const base = normalizePath(this.config.path ?? "/");
		if (base === "/") return "";
		if (base === SATORI_EVENTS_PATH) return "";
		return base;
	}
	/** Absolute path of the Satori event endpoint: `<prefix>/v1/events`. */
	eventsPath() {
		return this.mountPrefix() + SATORI_EVENTS_PATH;
	}
	/** Absolute prefix of the Satori API: `<prefix>/v1/`. */
	apiPrefix() {
		const prefix = this.mountPrefix();
		return prefix === "" ? "/v1/" : prefix + "/v1/";
	}
	async handleRequest(req, res) {
		if (!this.acceptingActions) {
			writeJson(res, 503, { message: "server closing" });
			return;
		}
		const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
		const incomingPath = parsedUrl.pathname;
		const prefix = this.apiPrefix();
		/** Only `POST /v1/<method>` is an API call; `/v1/events` is upgrade-only. */
		if (incomingPath === prefix.slice(0, -1) || incomingPath === prefix) {
			this.respondError(req, res, 404, "method not found");
			return;
		}
		if (!incomingPath.startsWith(prefix)) {
			this.respondError(req, res, 404, "not found");
			return;
		}
		const method = incomingPath.slice(prefix.length);
		if (method === "events") {
			/** A plain GET here means the client never performed the upgrade. */
			res.setHeader("Allow", "GET");
			this.respondError(req, res, 405, "please connect with WebSocket");
			return;
		}
		if (req.method !== "POST") {
			res.setHeader("Allow", "POST");
			this.respondError(req, res, 405, "method not allowed");
			return;
		}
		const token = this.config.accessToken ?? "";
		if (token) {
			const auth = req.headers.authorization ?? "";
			if (!auth) {
				this.respondError(req, res, 401, "authorization required");
				return;
			}
			if (auth !== `Bearer ${token}`) {
				this.respondError(req, res, 403, "invalid token");
				return;
			}
		}
		/** Satori identifies the account per request; a mismatch is a client bug. */
		const platform = req.headers["satori-platform"];
		const selfId = req.headers["satori-user-id"];
		if (selfId !== void 0 && String(selfId) !== String(this.ctx.uin)) {
			this.respondError(req, res, 403, "login not found");
			return;
		}
		if (platform !== void 0 && String(platform) !== SATORI_PLATFORM) {
			this.respondError(req, res, 403, "login not found");
			return;
		}
		const handler = SATORI_API[method];
		if (!handler) {
			this.log.debug("[%s] unsupported Satori method %s", this.name, method);
			this.respondError(req, res, 404, "method not found");
			return;
		}
		if (this.ctx.api.isAcceptingActions === false) {
			writeJson(res, 503, { message: "server closing" });
			return;
		}
		let payload = {};
		if (req.method === "POST") {
			let bodyContent;
			try {
				bodyContent = await readRequestBody(req);
			} catch (error) {
				this.respondError(req, res, error instanceof RequestBodyTooLargeError ? 413 : 400, satoriDescribeError(error));
				return;
			}
			if (bodyContent.trim()) {
				try {
					const parsedBody = JSON.parse(bodyContent);
					if (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)) payload = parsedBody;
					else {
						this.respondError(req, res, 400, "请求体必须是 JSON 对象");
						return;
					}
				} catch {
					this.respondError(req, res, 400, "请求体不是合法 JSON");
					return;
				}
			}
		}
		try {
			const result = await handler(this.ctx, payload);
			writeJson(res, 200, result);
		} catch (error) {
			const message = satoriDescribeError(error);
			this.log.warn("[%s] %s failed: %s", this.name, method, message);
			this.respondError(req, res, 400, message);
		}
	}
	/** Satori errors are a plain `{ message }` body with an HTTP status. */
	respondError(_req, res, status, message) {
		writeJson(res, status, { message: message });
	}
};

/* ----------------------------------------------------------- config bits */

/** Default Satori listener used on a fresh install; mirrors ws-default. */
var SATORI_DEFAULT_SERVER = "satori-default";
function makeDefaultSatoriServer() {
	return {
		name: SATORI_DEFAULT_SERVER,
		host: "127.0.0.1",
		port: 5600,
		path: "/",
		accessToken: generateAccessToken(),
		maxPayloadBytes: void 0,
		messageFormat: "array",
		reportSelfMessage: false,
		enabled: false
	};
}
export {};
