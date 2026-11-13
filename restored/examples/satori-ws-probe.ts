// ---------------------------------------------------------------------------
// 验证脚手架 —— 非生产代码（test scaffolding, NOT shipped）。
// WS 真 socket 探针：需要 native addon（仅 linux-arm64 有产物）。
// 在 x64 上会因缺 websocket-linux-x64.node 失败 —— 请在 arm64 机器上运行。
// 用法：node scripts/build.mjs --extra manifest-extra-transport.json
// ---------------------------------------------------------------------------
// WS end-to-end probe: IDENTIFY -> READY, PING->PONG, onEvent -> EVENT broadcast.
var wsLog = createLogger("E2E.WS");
var WS_PORT = 5612;
var WS_TOKEN = "ws-token-abc";

var wsCalls = [];
var wsCtx = {
	uin: "10001", selfId: 10001,
	api: { isAcceptingActions: true, async handle(a, p) {
		wsCalls.push(a);
		if (a === "get_login_info") return { status: "ok", data: { user_id: 10001, nickname: "HaizakuraBot" } };
		return { status: "ok", data: {} };
	} },
	buildLifecycleEvent: function (s) { return { post_type: "meta_event", meta_event_type: "lifecycle", sub_type: s, self_id: 10001, time: Math.floor(Date.now() / 1000) }; },
	buildHeartbeatEvent: function () { return { post_type: "meta_event", meta_event_type: "heartbeat", self_id: 10001, time: Math.floor(Date.now() / 1000) }; }
};

async function wsMain() {
	var adapter = new SatoriServerAdapter("satori-ws", {
		name: "satori-ws", host: "127.0.0.1", port: WS_PORT, path: "/", accessToken: WS_TOKEN,
		messageFormat: "array", reportSelfMessage: false
	}, wsCtx);
	await adapter.open();
	var results = [];
	function rec(n, got, want) { results.push({ n: n, got: String(got), want: String(want), pass: String(got) === String(want) }); }

	// 1) BAD token must be closed with 4004
	var badClose = await new Promise(function (resolve) {
		var ws = new WebSocket("ws://127.0.0.1:" + WS_PORT + "/v1/events");
		ws.on("open", function () { ws.send(JSON.stringify({ op: 3, body: { token: "wrong" } })); });
		ws.on("close", function (code) { resolve(code); });
		ws.on("error", function () { resolve("error"); });
		setTimeout(function () { resolve("timeout"); }, 6000);
	});
	rec("bad IDENTIFY -> close 4004", badClose, 4004);

	// 2) GOOD flow: IDENTIFY -> READY, then PING -> PONG, then event
	var flow = await new Promise(function (resolve) {
		var out = { ready: null, pong: null, event: null, closed: null };
		var ws = new WebSocket("ws://127.0.0.1:" + WS_PORT + "/v1/events");
		ws.on("open", function () { ws.send(JSON.stringify({ op: 3, body: { token: WS_TOKEN } })); });
		ws.on("message", function (d) {
			var msg; try { msg = JSON.parse(String(d)); } catch (e) { return; }
			if (msg.op === 4 && !out.ready) {
				out.ready = msg;
				ws.send(JSON.stringify({ op: 1 }));
				setTimeout(function () {
					adapter.onEvent({
						time: 1763000000, self_id: 10001, post_type: "message", message_type: "group",
						message_id: 1018302134, group_id: 391122026, user_id: 2635583281,
						message: [{ type: "text", data: { text: "hello" } }],
						sender: { user_id: 2635583281, nickname: "郁金香.", card: "郁金香." }
					}, null);
				}, 150);
			} else if (msg.op === 2 && !out.pong) out.pong = msg;
			else if (msg.op === 0 && !out.event) { out.event = msg; ws.close(); resolve(out); }
		});
		ws.on("close", function (c) { out.closed = c; if (!out.event) resolve(out); });
		ws.on("error", function (e) { out.err = String(e && e.message || e); resolve(out); });
		setTimeout(function () { resolve(out); }, 9000);
	});

	rec("READY op=4", flow.ready && flow.ready.op, 4);
	rec("READY has logins[]", flow.ready && Array.isArray(flow.ready.body.logins) && flow.ready.body.logins.length, 1);
	rec("READY logins[0].user.id", flow.ready && flow.ready.body.logins[0].user.id, "10001");
	rec("READY proxy_urls=[]", flow.ready && JSON.stringify(flow.ready.body.proxy_urls), "[]");
	rec("PING -> PONG op=2", flow.pong && flow.pong.op, 2);
	rec("EVENT op=0", flow.event && flow.event.op, 0);

	var ev = flow.event && flow.event.body;
	rec("event type", ev && ev.type, "message-created");
	rec("event has sn", ev && typeof ev.sn, "number");
	rec("event platform", ev && ev.platform, "haizakura");
	rec("event self_id", ev && ev.self_id, "10001");
	// Satori spec: resources PROMOTED to top level, NOT inside message
	rec("event.channel promoted", ev && ev.channel && ev.channel.id, "391122026");
	rec("event.guild promoted", ev && ev.guild && ev.guild.id, "391122026");
	rec("event.user promoted", ev && ev.user && ev.user.id, "2635583281");
	rec("ev.message has NO user", ev && ev.message && ev.message.user === undefined, true);
	rec("ev.message has NO channel", ev && ev.message && ev.message.channel === undefined, true);
	rec("ev.message.id is string", ev && typeof ev.message.id, "string");
	rec("ev.message.created_at seconds", ev && ev.message.created_at < 1e11, true);
	rec("ev.timestamp ms", ev && ev.timestamp > 1e12, true);

	// 3) IDENTIFY timeout (no frame) -> close 4000
	var idleClose = await new Promise(function (resolve) {
		var ws = new WebSocket("ws://127.0.0.1:" + WS_PORT + "/v1/events");
		ws.on("close", function (c) { resolve(c); });
		ws.on("error", function () { resolve("error"); });
		setTimeout(function () { resolve("timeout"); }, 14000);
	});
	rec("no IDENTIFY -> close 4000", idleClose, 4000);

	for (var i = 0; i < results.length; i++) wsLog.info("%s %s (got=%s want=%s)", results[i].pass ? "PASS" : "FAIL", results[i].n, results[i].got, results[i].want);
	var bad = results.filter(function (r) { return !r.pass; });
	wsLog.info("WS RESULT: %d/%d passed", results.length - bad.length, results.length);
	await adapter.close();
	wsLog.info("WS PROBE done");
}
wsMain().then(function () { process.exit(0); }, function (e) { wsLog.error("WS PROBE FAILED: %s", e && e.stack || String(e)); process.exit(1); });
