// ===================== TEST HARNESS (appended by the Satori task) ==========
// Everything lives inside a function scope so no harness identifier can
// collide with one of the bundle's ~8400 top-level names.
async function __satoriRunHarness() {
const __dispatched = [];
const ctx = {
  uin: "10001", selfId: 10001,
  api: {
    isAcceptingActions: true,
    handle: async (action, params) => {
      __dispatched.push({ action, params });
      if (action === "get_login_info") return { status: "ok", retcode: 0, data: { user_id: 10001, nickname: "TestBot" } };
      if (action === "get_group_info") return { status: "ok", retcode: 0, data: { group_id: 20001, group_name: "测试群" } };
      if (action === "get_group_list") return { status: "ok", retcode: 0, data: [{ group_id: 20001, group_name: "测试群" }] };
      if (action === "send_msg") return { status: "ok", retcode: 0, data: { message_id: 4242 } };
      if (action === "get_msg") return { status: "ok", retcode: 0, data: { time: 1700000000, message_type: "group", message_id: 777, group_id: 20001, group_name: "测试群", user_id: 30003, sender: { nickname: "某人", card: "群名片" }, message: [{ type: "text", data: { text: "hi" } }, { type: "face", data: { id: "1" } }] } };
      if (action === "get_stranger_info") return { status: "ok", retcode: 0, data: { user_id: 30003, nickname: "某人" } };
      if (action === "get_group_member_info") return { status: "ok", retcode: 0, data: { user_id: 30003, nickname: "某人", card: "群名片", role: "admin", join_time: 1600000000 } };
      if (action === "get_group_member_list") return { status: "ok", retcode: 0, data: [{ user_id: 30003, nickname: "某人", card: "群名片", role: "member" }] };
      if (action === "get_friend_list") return { status: "ok", retcode: 0, data: [{ user_id: 30003, nickname: "某人", remark: "备注" }] };
      if (action === "get_group_msg_history" || action === "get_friend_msg_history") return { status: "ok", retcode: 0, data: { messages: [{ time: 1700000000, message_type: "group", message_id: 777, group_id: 20001, user_id: 30003, sender: { nickname: "某人" }, message: [{ type: "text", data: { text: "hist" } }] }] } };
      if (action === "get_emoji_likes") return { status: "ok", retcode: 0, data: { emoji_like_list: [{ user_id: "30003", nick_name: "" }] } };
      if (["delete_msg","set_msg_emoji_like","set_group_ban","set_group_kick","set_group_admin","delete_friend","set_friend_add_request","set_group_add_request"].includes(action)) return { status: "ok", retcode: 0, data: null };
      return { status: "failed", retcode: 1404, data: null, wording: "unknown action" };
    }
  },
  buildLifecycleEvent: () => ({ post_type: "meta_event" }),
  buildHeartbeatEvent: () => ({ post_type: "meta_event" })
};

const hzAdapter = new SatoriServerAdapter("satori-e2e", {
  name: "satori-e2e", host: "127.0.0.1", port: 5601, path: "/v1/events",
  accessToken: "test-token-1234567890", messageFormat: "array", reportSelfMessage: true
}, ctx);

const hzResults = [];
const hzCheck = (name, ok, extra) => { hzResults.push({ name, ok, extra }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== undefined ? "  " + JSON.stringify(extra) : ""}`); };
const hzPost = async (method, body, headers = {}) => {
  const res = await fetch(`http://127.0.0.1:5601/v1/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token-1234567890", "Satori-Platform": "haizakura", "Satori-User-ID": "10001", ...headers },
    body: JSON.stringify(body)
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

await hzAdapter.open();
hzCheck("open() listens", hzAdapter.listening === true);
hzCheck("describeStatus ok", hzAdapter.describeStatus().status === "ok", hzAdapter.describeStatus());

hzCheck("route: POST /v1/login.get (no double /v1)", (await hzPost("login.get", {})).status === 200);

const hzNoauth = await hzPost("login.get", {}, { Authorization: "" });
hzCheck("no Authorization -> 401", hzNoauth.status === 401, hzNoauth.status);
hzCheck("bad token -> 403", (await hzPost("login.get", {}, { Authorization: "Bearer wrong" })).status === 403);
hzCheck("wrong Satori-User-ID -> 403", (await hzPost("login.get", {}, { "Satori-User-ID": "99999" })).status === 403);
hzCheck("unknown method -> 404", (await hzPost("nope.nope", {})).status === 404);
hzCheck("GET on method -> 405", (await fetch("http://127.0.0.1:5601/v1/login.get", { headers: { Authorization: "Bearer test-token-1234567890" } })).status === 405);
hzCheck("plain GET /v1/events -> 405", (await fetch("http://127.0.0.1:5601/v1/events", { headers: { Authorization: "Bearer test-token-1234567890" } })).status === 405);

const hzLogin = await hzPost("login.get", {});
hzCheck("login.get -> login.user.id", hzLogin.status === 200 && hzLogin.json?.user?.id === "10001", hzLogin.json);
hzCheck("login.get features include guild.plain", Array.isArray(hzLogin.json?.features) && hzLogin.json.features.includes("guild.plain"), hzLogin.json?.features?.length);

const hzCh = await hzPost("channel.get", { channel_id: "20001" });
hzCheck("channel.get -> TEXT + name", hzCh.status === 200 && hzCh.json?.type === 0 && hzCh.json?.name === "测试群", hzCh.json);
const hzChP = await hzPost("channel.get", { channel_id: "private:30003" });
hzCheck("channel.get private -> DIRECT", hzChP.status === 200 && hzChP.json?.type === 1, hzChP.json);
const hzChL = await hzPost("channel.list", { guild_id: "20001" });
hzCheck("channel.list -> 1 channel", hzChL.status === 200 && hzChL.json?.data?.length === 1, hzChL.json?.data?.length);
const hzG = await hzPost("guild.get", { guild_id: "20001" });
hzCheck("guild.get -> avatar", hzG.status === 200 && String(hzG.json?.avatar).includes("p.qlogo.cn/gh/20001"), hzG.json);
hzCheck("guild.list -> 1 guild", (await hzPost("guild.list", {})).json?.data?.length === 1);

const hzCreated = await hzPost("message.create", { channel_id: "20001", content: "hello <at id=\"30003\"/> <emoji id=\"1\"/>" });
hzCheck("message.create -> Message[]", hzCreated.status === 200 && Array.isArray(hzCreated.json) && hzCreated.json[0]?.id === "4242", hzCreated.json);
hzCheck("message.create created_at is ms", hzCreated.json?.[0]?.created_at > 1e12, hzCreated.json?.[0]?.created_at);
const hzSend = __dispatched.find((d) => d.action === "send_msg");
hzCheck("send_msg group_id + parsed at segment", hzSend?.params?.group_id === 20001 && hzSend?.params?.message?.some((s) => s.type === "at" && s.data.qq === "30003"), hzSend?.params?.message);
hzCheck("message.create private -> 200", (await hzPost("message.create", { channel_id: "private:30003", content: "dm" })).status === 200);
const hzPriv = __dispatched.filter((d) => d.action === "send_msg").pop();
hzCheck("private send_msg uses user_id", hzPriv?.params?.user_id === 30003 && hzPriv?.params?.message_type === "private", hzPriv?.params);

const hzGot = await hzPost("message.get", { channel_id: "20001", message_id: "777" });
hzCheck("message.get -> encoded content", hzGot.status === 200 && hzGot.json?.content?.includes("hi") && hzGot.json?.content?.includes("<emoji"), hzGot.json?.content);
const hzList = await hzPost("message.list", { channel_id: "20001", limit: 10 });
hzCheck("message.list -> BidiList data", hzList.status === 200 && hzList.json?.data?.length === 1, hzList.json?.data?.length);
hzCheck("message.delete -> 200", (await hzPost("message.delete", { channel_id: "20001", message_id: "777" })).status === 200 && __dispatched.some((d) => d.action === "delete_msg"));

const hzMg = await hzPost("guild.member.get", { guild_id: "20001", user_id: "30003" });
hzCheck("guild.member.get -> roles[admin]=3", hzMg.json?.roles?.[0]?.id === "3", hzMg.json);
hzCheck("member joined_at is ms", hzMg.json?.joined_at === 1600000000000, hzMg.json?.joined_at);
hzCheck("guild.member.list -> 1", (await hzPost("guild.member.list", { guild_id: "20001" })).json?.data?.length === 1);
hzCheck("guild.role.list -> 3 static roles", (await hzPost("guild.role.list", { guild_id: "20001" })).json?.data?.length === 3);
hzCheck("guild.member.kick -> set_group_kick", (await hzPost("guild.member.kick", { guild_id: "20001", user_id: "30003" })).status === 200 && __dispatched.some((d) => d.action === "set_group_kick"));
await hzPost("guild.member.mute", { guild_id: "20001", user_id: "30003", duration: 60000 });
const hzMute = __dispatched.filter((d) => d.action === "set_group_ban").pop();
hzCheck("guild.member.mute ms->s (60000->60)", hzMute?.params?.duration === 60, hzMute?.params);
hzCheck("guild.member.role.set -> enable:true", (await hzPost("guild.member.role.set", { guild_id: "20001", user_id: "30003", role_id: "3" })).status === 200 && __dispatched.some((d) => d.action === "set_group_admin" && d.params.enable === true));

const hzUg = await hzPost("user.get", { user_id: "30003" });
hzCheck("user.get -> id + qlogo avatar", hzUg.json?.id === "30003" && String(hzUg.json?.avatar).includes("qlogo"), hzUg.json);
const hzFl = await hzPost("friend.list", {});
hzCheck("friend.list -> 1 friend", hzFl.json?.data?.length === 1 && hzFl.json.data[0].user.id === "30003", hzFl.json);
hzCheck("friend.delete -> delete_friend", (await hzPost("friend.delete", { user_id: "30003" })).status === 200 && __dispatched.some((d) => d.action === "delete_friend"));
hzCheck("friend.approve -> flag", (await hzPost("friend.approve", { message_id: "flag-1", approve: true })).status === 200 && __dispatched.some((d) => d.action === "set_friend_add_request" && d.params.flag === "flag-1"));
hzCheck("guild.approve -> invite", (await hzPost("guild.approve", { message_id: "flag-2", approve: true })).status === 200 && __dispatched.some((d) => d.action === "set_group_add_request" && d.params.sub_type === "invite"));
hzCheck("guild.member.approve -> add+reject", (await hzPost("guild.member.approve", { message_id: "flag-3", approve: false })).status === 200 && __dispatched.some((d) => d.action === "set_group_add_request" && d.params.sub_type === "add" && d.params.approve === false));

hzCheck("reaction.create -> set:true", (await hzPost("reaction.create", { channel_id: "20001", message_id: "777", emoji_id: "128077" })).status === 200 && __dispatched.some((d) => d.action === "set_msg_emoji_like" && d.params.set === true));
hzCheck("reaction.delete -> set:false", (await hzPost("reaction.delete", { channel_id: "20001", message_id: "777", emoji_id: "128077" })).status === 200 && __dispatched.some((d) => d.action === "set_msg_emoji_like" && d.params.set === false));
hzCheck("reaction.list -> users", (await hzPost("reaction.list", { channel_id: "20001", message_id: "777", emoji_id: "128077" })).json?.data?.[0]?.id === "30003");

const hzBad = await fetch("http://127.0.0.1:5601/v1/login.get", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer test-token-1234567890" }, body: "{not json" });
hzCheck("malformed JSON -> 400", hzBad.status === 400, hzBad.status);

// ---------------- WebSocket (protocol state machine via socket double) ----------------
// The vendored ws server needs a native addon for frame (de)coding, and only the
// arm64 binary ships upstream, so this environment cannot open a real WS socket.
// The Satori protocol logic under test is *ours* (the adapter's state machine),
// not the vendored framing, so it is driven through a socket double that mimics
// the subset of the `ws` API the adapter uses: events, send, close, readyState.
function hzMakeSocket() {
  const listeners = new Map();
  const sent = [];
  const sock = {
    readyState: 1,
    sent,
    closed: null,
    on(ev, fn) { (listeners.get(ev) ?? listeners.set(ev, []).get(ev)).push(fn); return sock; },
    off() { return sock; },
    emit(ev, ...a) { for (const fn of listeners.get(ev) ?? []) fn(...a); },
    send(data, cb) { sent.push(JSON.parse(data)); if (cb) cb(); return true; },
    close(code, reason) { sock.closed = { code, reason }; sock.readyState = 3; sock.emit("close", code, reason); },
    terminate() { sock.readyState = 3; }
  };
  return sock;
}
const hzSocket = hzMakeSocket();
const hzUpgradeReq = { url: "/v1/events", headers: { authorization: "Bearer test-token-1234567890" } };
hzCheck("authorizeUpgrade accepts valid token", hzAdapter.authorizeUpgrade(hzUpgradeReq) === true);
hzCheck("authorizeUpgrade rejects bad token", hzAdapter.authorizeUpgrade({ url: "/v1/events", headers: { authorization: "Bearer nope" } }) === false);

hzAdapter.acceptConnection(hzSocket, hzUpgradeReq);
hzCheck("connection registered", hzAdapter.connections.size === 1, hzAdapter.connections.size);
hzCheck("no READY before IDENTIFY", !hzSocket.sent.some((f) => f.op === 4));

// bad token over a live socket -> close 4004
hzSocket.emit("message", Buffer.from(JSON.stringify({ op: 3, body: { token: "wrong" } })));
await new Promise((r) => setTimeout(r, 200));
hzCheck("bad IDENTIFY token -> close 4004", hzSocket.closed?.code === 4004, hzSocket.closed?.code);

// good token on a fresh socket
const hzSocket2 = hzMakeSocket();
hzAdapter.acceptConnection(hzSocket2, hzUpgradeReq);
hzSocket2.emit("message", Buffer.from(JSON.stringify({ op: 3, body: { token: "test-token-1234567890" } })));
await new Promise((r) => setTimeout(r, 250));
const hzReady = hzSocket2.sent.find((f) => f.op === 4);
hzCheck("IDENTIFY -> READY with logins", !!hzReady && hzReady.body?.logins?.[0]?.user?.id === "10001", hzReady?.body?.logins?.[0]);
hzCheck("READY has proxy_urls", Array.isArray(hzReady?.body?.proxy_urls));

hzSocket2.emit("message", Buffer.from(JSON.stringify({ op: 1, body: {} })));
await new Promise((r) => setTimeout(r, 200));
hzCheck("PING -> PONG", hzSocket2.sent.some((f) => f.op === 2));

// invalid JSON frame -> close 4000
const hzSocket3 = hzMakeSocket();
hzAdapter.acceptConnection(hzSocket3, hzUpgradeReq);
hzSocket3.emit("message", Buffer.from("{not json"));
await new Promise((r) => setTimeout(r, 200));
hzCheck("invalid frame JSON -> close 4000", hzSocket3.closed?.code === 4000, hzSocket3.closed?.code);

const hzEmit = async (ev) => { hzAdapter.onEvent(ev, {}); await new Promise((r) => setTimeout(r, 200)); };
await hzEmit({ time: 1700000000, self_id: 10001, post_type: "message", message_type: "group", sub_type: "normal", message_id: 777, group_id: 20001, group_name: "测试群", user_id: 30003, sender: { nickname: "某人", card: "群名片" }, message: [{ type: "text", data: { text: "hello" } }, { type: "at", data: { qq: "30003" } }] });
const hzEv = hzSocket2.sent.find((f) => f.op === 0);
hzCheck("EVENT type=message-created", hzEv?.body?.type === "message-created", hzEv?.body?.type);
hzCheck("EVENT promotes channel/guild/user/member", !!(hzEv?.body?.channel && hzEv?.body?.guild && hzEv?.body?.user && hzEv?.body?.member));
hzCheck("EVENT message stripped of user/member/channel/guild", !!hzEv?.body?.message && !("user" in hzEv.body.message) && !("member" in hzEv.body.message) && !("channel" in hzEv.body.message) && !("guild" in hzEv.body.message));
hzCheck("EVENT content encoded", hzEv?.body?.message?.content?.includes("hello") && hzEv?.body?.message?.content?.includes("<at"), hzEv?.body?.message?.content);
hzCheck("EVENT channel.id = group_id", hzEv?.body?.channel?.id === "20001");
hzCheck("wire is snake_case: is_bot", hzEv?.body?.user?.is_bot === false && !("isBot" in hzEv.body.user), hzEv?.body?.user);
hzCheck("wire is snake_case: created_at in ms", hzEv?.body?.message?.created_at === 1700000000000, hzEv?.body?.message?.created_at);
hzCheck("wire has no camelCase createdAt", !("createdAt" in (hzEv?.body?.message ?? {})));
hzCheck("EVENT login.platform", hzEv?.body?.login?.platform === "haizakura");
hzCheck("EVENT sn increments", hzEv?.body?.sn === 1, hzEv?.body?.sn);
await hzEmit({ time: 1700000001, self_id: 10001, post_type: "notice", notice_type: "group_recall", group_id: 20001, user_id: 30003, operator_id: 30003, message_id: 777 });
hzCheck("group_recall -> message-deleted", hzSocket2.sent.some((f) => f.op === 0 && f.body?.type === "message-deleted"));
await hzEmit({ time: 1700000002, self_id: 10001, post_type: "notice", notice_type: "group_increase", sub_type: "approve", group_id: 20001, user_id: 30003, operator_id: 10001 });
hzCheck("group_increase -> guild-member-added", hzSocket2.sent.some((f) => f.op === 0 && f.body?.type === "guild-member-added"));
await hzEmit({ time: 1700000003, self_id: 10001, post_type: "request", request_type: "friend", user_id: 30003, comment: "加个好友", flag: "flag-9" });
hzCheck("friend request -> friend-request w/ flag", hzSocket2.sent.find((f) => f.body?.type === "friend-request")?.body?.message?.id === "flag-9");
await hzEmit({ time: 1700000004, self_id: 10001, post_type: "request", request_type: "group", sub_type: "invite", group_id: 20001, user_id: 30003, comment: "x", flag: "flag-10" });
hzCheck("group invite -> guild-request", hzSocket2.sent.some((f) => f.op === 0 && f.body?.type === "guild-request"));
await hzEmit({ time: 1700000005, self_id: 10001, post_type: "request", request_type: "group", sub_type: "add", group_id: 20001, user_id: 30003, comment: "y", flag: "flag-11" });
hzCheck("group add -> guild-member-request", hzSocket2.sent.some((f) => f.op === 0 && f.body?.type === "guild-member-request"));
await hzEmit({ time: 1700000006, self_id: 10001, post_type: "notice", notice_type: "group_msg_emoji_like", sub_type: "add", group_id: 20001, operator_id: 30003, message_id: 777, likes: [{ emoji_id: "128077", count: 1 }] });
hzCheck("emoji_like -> reaction-added", hzSocket2.sent.some((f) => f.op === 0 && f.body?.type === "reaction-added"));
await hzEmit({ time: 1700000007, self_id: 10001, post_type: "notice", notice_type: "bot_status", sub_type: "offline" });
hzCheck("bot_status offline -> login-removed", hzSocket2.sent.some((f) => f.op === 0 && f.body?.type === "login-removed"));
await hzEmit({ time: 1700000008, self_id: 10001, post_type: "notice", notice_type: "group_decrease", sub_type: "kick", group_id: 20001, user_id: 30003, operator_id: 10001 });
hzCheck("group_decrease -> guild-member-removed", hzSocket2.sent.some((f) => f.op === 0 && f.body?.type === "guild-member-removed"));
await hzEmit({ time: 1700000009, self_id: 10001, post_type: "notice", notice_type: "group_msg_emoji_like", sub_type: "remove", group_id: 20001, operator_id: 30003, message_id: 777, likes: [{ emoji_id: "1", count: 0 }] });
hzCheck("emoji_like remove -> reaction-removed", hzSocket2.sent.some((f) => f.op === 0 && f.body?.type === "reaction-removed"));
await hzEmit({ time: 1700000010, self_id: 10001, post_type: "meta_event", meta_event_type: "heartbeat" });
hzCheck("meta_event heartbeat -> no Satori event", !hzSocket2.sent.some((f) => f.op === 0 && f.body?.timestamp === 1700000010000));
hzCheck("every EVENT has sn + timestamp", hzSocket2.sent.filter((f) => f.op === 0).every((f) => typeof f.body.sn === "number" && typeof f.body.timestamp === "number"));
hzCheck("9 satori event types emitted", new Set(hzSocket2.sent.filter((f) => f.op === 0).map((f) => f.body.type)).size >= 9, [...new Set(hzSocket2.sent.filter((f) => f.op === 0).map((f) => f.body.type))]);

// close() must drop connections and emit nothing further
await hzAdapter.close();
hzCheck("close() released listener", hzAdapter.listening === false);
hzCheck("close() dropped connections", hzAdapter.connections.size === 0, hzAdapter.connections.size);
const hzBefore = hzSocket2.sent.length;
hzAdapter.onEvent({ time: 1, self_id: 10001, post_type: "message", message_type: "group", group_id: 20001, message_id: 1, user_id: 2, message: [] }, {});
await new Promise((r) => setTimeout(r, 150));
hzCheck("no events after close", hzSocket2.sent.length === hzBefore);
let hzPortFree = true;
try { await fetch("http://127.0.0.1:5601/v1/login.get"); hzPortFree = false; } catch {}
hzCheck("port released after close", hzPortFree);

const hzFailed = hzResults.filter((r) => !r.ok);
console.log(`\n==== ${hzResults.length - hzFailed.length}/${hzResults.length} passed ====`);
if (hzFailed.length) { console.log("FAILURES:"); for (const f of hzFailed) console.log(" -", f.name, JSON.stringify(f.extra)); }
return hzFailed.length;
}
process.exitCode = await __satoriRunHarness();
