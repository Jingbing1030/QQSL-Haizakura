// ---------------------------------------------------------------------------
// 验证脚手架 —— 非生产代码（test scaffolding, NOT shipped）。
// WS 协议逻辑回归（fake socket）：IDENTIFY/READY/PING/PONG/事件广播/资源提升。
// x64 无 native addon（arm64-only），故用 fake socket 驱动真实代码路径。
// 用法：node scripts/build.mjs --extra manifest-extra-transport.json
// ---------------------------------------------------------------------------
// WS protocol-logic probe: drives handleClientFrame/onEvent with a FAKE socket.
// Real WS I/O needs the arm64-only native addon (absent on x64), so this
// exercises the exactly-same code paths without the frame codec.
var wlLog = createLogger("E2E.WSLogic");

function makeFakeSocket() {
	var s = new EventEmitter$1();
	s.readyState = 1;
	s.sent = [];
	s.closedWith = null;
	s.send = function (payload, cb) { s.sent.push(String(payload)); if (typeof cb === "function") cb(null); };
	s.close = function (code, reason) { s.closedWith = { code: code, reason: reason }; s.readyState = 3; };
	return s;
}

var wlCtx = {
	uin: "10001", selfId: 10001,
	api: {
		isAcceptingActions: true,
		async handle(a) {
			if (a === "get_login_info") return { status: "ok", data: { user_id: 10001, nickname: "HaizakuraBot" } };
			return { status: "ok", data: {} };
		}
	},
	buildLifecycleEvent: function (s) { return { post_type: "meta_event", meta_event_type: "lifecycle", sub_type: s, self_id: 10001, time: Math.floor(Date.now() / 1000) }; },
	buildHeartbeatEvent: function () { return { post_type: "meta_event", meta_event_type: "heartbeat", self_id: 10001, time: Math.floor(Date.now() / 1000) }; }
};

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function wlMain() {
	var results = [];
	function rec(n, got, want) { results.push({ n: n, got: String(got), want: String(want), pass: String(got) === String(want) }); }

	var adapter = new SatoriServerAdapter("satori-wl", {
		name: "satori-wl", host: "127.0.0.1", port: 5699, path: "/", accessToken: "tk",
		messageFormat: "array", reportSelfMessage: false
	}, wlCtx);
	await adapter.open();
	rec("listening", adapter.listening, true);
	rec("isEnabled", adapter.isEnabled, true);

	// bad token -> close 4004
	var bad = makeFakeSocket();
	adapter.acceptConnection(bad, { url: "/v1/events", headers: {} });
	await adapter.handleClientFrame({ socket: bad, identified: false, lastSn: 0, identifyTimer: null }, JSON.stringify({ op: 3, body: { token: "nope" } }));
	rec("bad token close code", bad.closedWith && bad.closedWith.code, 4004);

	// good token -> READY(4)
	var good = makeFakeSocket();
	adapter.acceptConnection(good, { url: "/v1/events", headers: {} });
	var conn = adapter.connections.get(good);
	await adapter.handleClientFrame(conn, JSON.stringify({ op: 3, body: { token: "tk" } }));
	rec("identified", conn.identified, true);
	var ready = JSON.parse(good.sent[0] || "{}");
	rec("READY op", ready.op, 4);
	rec("READY logins len", ready.body.logins.length, 1);
	rec("READY login user id", ready.body.logins[0].user.id, "10001");
	rec("READY proxy_urls", JSON.stringify(ready.body.proxy_urls), "[]");

	// PING -> PONG(2)
	await adapter.handleClientFrame(conn, JSON.stringify({ op: 1 }));
	var pong = JSON.parse(good.sent[1] || "{}");
	rec("PONG op", pong.op, 2);

	// garbage -> close 4000
	var junk = makeFakeSocket();
	adapter.acceptConnection(junk, { url: "/v1/events", headers: {} });
	await adapter.handleClientFrame(adapter.connections.get(junk), "not json{{{");
	rec("invalid frame close code", junk.closedWith && junk.closedWith.code, 4000);

	// onEvent -> EVENT(0) broadcast with promoted resources
	good.sent.length = 0;
	adapter.onEvent({
		time: 1763000000, self_id: 10001, post_type: "message", message_type: "group",
		message_id: 1018302134, group_id: 391122026, user_id: 2635583281,
		message: [{ type: "text", data: { text: "hi" } }, { type: "at", data: { qq: "10001" } }],
		sender: { user_id: 2635583281, nickname: "郁金香.", card: "郁金香." }
	}, null);
	var evt = JSON.parse(good.sent[0] || "{}");
	rec("EVENT op", evt.op, 0);
	rec("event type", evt.body.type, "message-created");
	rec("event sn>0", evt.body.sn > 0, true);
	rec("event channel promoted", evt.body.channel && evt.body.channel.id, "391122026");
	rec("event guild promoted", evt.body.guild && evt.body.guild.id, "391122026");
	rec("event user promoted", evt.body.user && evt.body.user.id, "2635583281");
	rec("msg has NO channel(key removed)", evt.body.message.channel === undefined, true);
	rec("msg has NO user", evt.body.message.user === undefined, true);
	rec("msg id is string", typeof evt.body.message.id, "string");
	rec("created_at ms (== event.time*1000)", evt.body.message.created_at, 1763000000000);
	rec("content has at element", String(evt.body.message.content).indexOf("<at") >= 0, true);

	// heartbeat meta event must NOT be broadcast (returns null)
	good.sent.length = 0;
	adapter.onEvent({ post_type: "meta_event", meta_event_type: "heartbeat", self_id: 10001, time: 1763000000 }, null);
	rec("heartbeat not broadcast", good.sent.length, 0);

	// private message -> DIRECT channel
	good.sent.length = 0;
	adapter.onEvent({
		time: 1763000001, self_id: 10001, post_type: "message", message_type: "private",
		message_id: 1018302135, user_id: 2635583281, sub_type: "friend",
		message: [{ type: "text", data: { text: "dm" } }], sender: { user_id: 2635583281, nickname: "郁金香." }
	}, null);
	var priv = JSON.parse(good.sent[0] || "{}");
	rec("private channel_id prefix", priv.body.channel && priv.body.channel.id, "private:2635583281");
	rec("private channel type=1", priv.body.channel && priv.body.channel.type, 1);

	// reload resets state
	await adapter.reload({ name: "satori-wl", host: "127.0.0.1", port: 5699, path: "/", accessToken: "tk2", messageFormat: "array", reportSelfMessage: false });
	rec("reload keeps listening", adapter.listening, true);
	rec("reload status ok", adapter.describeStatus().status, "ok");

	// describeStatus shape
	var st = adapter.describeStatus();
	rec("status name", st.name, "satori-wl");
	rec("status kind", st.kind, "satoriServer");
	rec("status has detail", typeof st.detail, "string");

	await adapter.close();
	rec("closed: not listening", adapter.listening, false);

	for (var i = 0; i < results.length; i++) wlLog.info("%s %s (got=%s want=%s)", results[i].pass ? "PASS" : "FAIL", results[i].n, results[i].got, results[i].want);
	var bad2 = results.filter(function (r) { return !r.pass; });
	wlLog.info("WSLOGIC RESULT: %d/%d passed", results.length - bad2.length, results.length);
	wlLog.info("WSLOGIC done");
}
wlMain().then(function () { process.exit(0); }, function (e) { wlLog.error("WSLOGIC FAILED: %s", e && e.stack || String(e)); process.exit(1); });
