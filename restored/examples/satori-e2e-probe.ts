// ---------------------------------------------------------------------------
// 验证脚手架 —— 非生产代码（test scaffolding, NOT shipped）。
// Satori 传输层端到端回归：真起 HTTP 服务，覆盖鉴权/6 个 MVP API/404/405。
// 用法：node scripts/build.mjs --extra manifest-extra-transport.json
// ---------------------------------------------------------------------------
// END-TO-END probe for the Satori transport. Runs in the flat bundle scope.
var e2eLog = createLogger("E2E.Satori");
var E2E_PORT = 5611;
var E2E_TOKEN = "e2e-token-xyz";

var e2eCalls = [];
function e2eApi() {
	return {
		isAcceptingActions: true,
		async handle(action, params) {
			e2eCalls.push({ action: action, params: params });
			if (action === "get_login_info") return { status: "ok", retcode: 0, data: { user_id: 10001, nickname: "HaizakuraBot" } };
			if (action === "send_msg") return { status: "ok", retcode: 0, data: { message_id: 1018302134 } };
			if (action === "get_group_info") return { status: "ok", retcode: 0, data: { group_id: 391122026, group_name: "ChatLuna 闲聊群", member_count: 42, max_member_count: 200 } };
			if (action === "get_group_list") return { status: "ok", retcode: 0, data: [{ group_id: 391122026, group_name: "ChatLuna 闲聊群", member_count: 42, max_member_count: 200 }] };
			if (action === "get_msg") return { status: "ok", retcode: 0, data: { message_id: 1018302134, message_type: "group", group_id: 391122026, user_id: 2635583281, message: [{ type: "text", data: { text: "hello" } }], time: 1763000000, sender: { user_id: 2635583281, nickname: "郁金香." } } };
			if (action === "get_stranger_info") return { status: "ok", retcode: 0, data: { user_id: 2635583281, nickname: "郁金香." } };
			// deliberately FAIL like the real backend does (HTTP still 200)
			return { status: "failed", retcode: 1404, wording: "unknown action" };
		}
	};
}

var e2eCtx = {
	uin: "10001",
	selfId: 10001,
	api: e2eApi(),
	buildLifecycleEvent: function (s) { return { post_type: "meta_event", meta_event_type: "lifecycle", sub_type: s, self_id: 10001, time: Math.floor(Date.now() / 1000) }; },
	buildHeartbeatEvent: function () { return { post_type: "meta_event", meta_event_type: "heartbeat", self_id: 10001, time: Math.floor(Date.now() / 1000) }; }
};

function httpJson(method, path, body, headers) {
	return new Promise(function (resolve, reject) {
		var data = body === undefined ? null : Buffer.from(JSON.stringify(body));
		var h = Object.assign({}, headers || {});
		if (data) { h["Content-Type"] = "application/json"; h["Content-Length"] = String(data.length); }
		var req = require$e2e("node:http").request({ host: "127.0.0.1", port: E2E_PORT, path: path, method: method, headers: h }, function (res) {
			var chunks = [];
			res.on("data", function (c) { chunks.push(c); });
			res.on("end", function () { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }); });
		});
		req.on("error", reject);
		if (data) req.write(data);
		req.end();
	});
}
var e2eRequire = createRequire(import.meta.url);
function require$e2e(m) { return e2eRequire(m); }

function httpPost(path, body) {
	return httpJson("POST", path, body, { "Authorization": "Bearer " + E2E_TOKEN, "Satori-Platform": "haizakura", "Satori-User-ID": "10001" });
}

async function e2eMain() {
	var adapter = new SatoriServerAdapter("satori-e2e", {
		name: "satori-e2e", host: "127.0.0.1", port: E2E_PORT, path: "/",
		accessToken: E2E_TOKEN, messageFormat: "array", reportSelfMessage: false
	}, e2eCtx);
	await adapter.open();
	e2eLog.info("PROBE listen ok=%s status=%s", String(adapter.listening), JSON.stringify(adapter.describeStatus()));

	var results = [];
	function rec(name, got, want) { results.push({ name: name, got: String(got), want: String(want), pass: String(got) === String(want) }); }

	// --- HTTP auth ---
	var noAuth = await httpJson("POST", "/v1/login.get", {}, { "Satori-Platform": "haizakura" });
	rec("no-auth -> 401", noAuth.status, 401);
	var badAuth = await httpJson("POST", "/v1/login.get", {}, { "Authorization": "Bearer wrong" });
	rec("bad-auth -> 403", badAuth.status, 403);
	var wrongUser = await httpJson("POST", "/v1/login.get", {}, { "Authorization": "Bearer " + E2E_TOKEN, "Satori-User-ID": "999" });
	rec("wrong-user -> 403", wrongUser.status, 403);

	// --- login.get ---
	var login = await httpPost("/v1/login.get", {});
	rec("login.get -> 200", login.status, 200);
	var loginBody = JSON.parse(login.body || "{}");
	rec("login.get has user.id", loginBody.user && loginBody.user.id, "10001");
	rec("login.get has features", Array.isArray(loginBody.features) && loginBody.features.length > 0, true);

	// --- message.create (group) ---
	var created = await httpPost("/v1/message.create", { channel_id: "391122026", content: "hello <at id=\"2635583281\"/>" });
	rec("message.create -> 200", created.status, 200);
	var sendCall = e2eCalls.filter(function (c) { return c.action === "send_msg"; })[0];
	rec("send_msg message_type", sendCall && sendCall.params.message_type, "group");
	rec("send_msg group_id", sendCall && sendCall.params.group_id, "391122026");
	rec("send_msg has at segment", sendCall && JSON.stringify(sendCall.params.message).indexOf("\"at\"") >= 0, true);

	// --- message.create (private) ---
	await httpPost("/v1/message.create", { channel_id: "private:2635583281", content: "dm" });
	var sendCalls = e2eCalls.filter(function (c) { return c.action === "send_msg"; });
	rec("private send_msg type", sendCalls[1] && sendCalls[1].params.message_type, "private");
	rec("private send_msg user_id", sendCalls[1] && sendCalls[1].params.user_id, "2635583281");

	// --- other MVP APIs ---
	var g = await httpPost("/v1/guild.get", { guild_id: "391122026" });
	rec("guild.get -> 200", g.status, 200);
	rec("guild.get id", JSON.parse(g.body || "{}").id, "391122026");
	var gl = await httpPost("/v1/guild.list", {});
	rec("guild.list -> 200", gl.status, 200);
	rec("guild.list data len", (JSON.parse(gl.body || "{}").data || []).length, 1);
	var ch = await httpPost("/v1/channel.get", { channel_id: "391122026" });
	rec("channel.get -> 200", ch.status, 200);
	rec("channel.get id", JSON.parse(ch.body || "{}").id, "391122026");
	var mg = await httpPost("/v1/message.get", { channel_id: "391122026", message_id: "1018302134" });
	rec("message.get -> 200", mg.status, 200);
	rec("message.get id is string", typeof JSON.parse(mg.body || "{}").id, "string");

	// --- protocol: unsupported API -> 404 (NOT 501) ---
	var unknown = await httpPost("/v1/definitely.not.an.api", {});
	rec("unsupported API -> 404", unknown.status, 404);
	// --- method not allowed ---
	var getApi = await httpJson("GET", "/v1/login.get", undefined, { "Authorization": "Bearer " + E2E_TOKEN });
	rec("GET /v1/login.get -> 405", getApi.status, 405);
	// --- unknown path -> 404 ---
	var notFound = await httpJson("POST", "/nope", {}, { "Authorization": "Bearer " + E2E_TOKEN });
	rec("/nope -> 404", notFound.status, 404);

	for (var i = 0; i < results.length; i++) {
		e2eLog.info("%s %s (got=%s want=%s)", results[i].pass ? "PASS" : "FAIL", results[i].name, results[i].got, results[i].want);
	}
	var failed = results.filter(function (r) { return !r.pass; });
	e2eLog.info("HTTP RESULT: %d/%d passed", results.length - failed.length, results.length);
	await adapter.close();
	e2eLog.info("PROBE done");
}
e2eMain().then(function () { process.exit(0); }, function (e) { e2eLog.error("PROBE FAILED: %s", e && e.stack || String(e)); process.exit(1); });
