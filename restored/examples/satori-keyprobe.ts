// ---------------------------------------------------------------------------
// 验证脚手架 —— 非生产代码（test scaffolding, NOT shipped）。
// 字段名/单位检查：断言 Satori 线格式为 snake_case（is_bot/created_at）
// 且 created_at 为【秒】级（契约 SATORI-INTERFACE.md:151）。
// 用法：node scripts/build.mjs --extra manifest-extra-transport.json
// ---------------------------------------------------------------------------
var kpLog = createLogger("E2E.Keys");
var kpCtx = { uin: "10001", selfId: 10001,
	api: { isAcceptingActions: true, async handle(){ return { status:"ok", data:{} }; } },
	buildLifecycleEvent: function(){ return {}; }, buildHeartbeatEvent: function(){ return {}; } };
async function kpMain() {
	var a = new SatoriServerAdapter("kp", { name:"kp", host:"127.0.0.1", port:5698, path:"/", accessToken:"", messageFormat:"array", reportSelfMessage:false }, kpCtx);
	await a.open();
	var out = null;
	var fake = { readyState: 1, on: function(){}, send: function(){}, close: function(){} };
	a.connections.set(fake, { socket: fake, identified: true, lastSn: 0, identifyTimer: null });
	var real = new EventEmitter$1(); real.readyState = 1; real.on = function(){}; real.send = function(p){ out = String(p); }; real.close = function(){};
	a.connections.clear(); a.connections.set(real, { socket: real, identified: true, lastSn: 0, identifyTimer: null });
	a.onEvent({ time:1763000000, self_id:10001, post_type:"message", message_type:"group",
		message_id:1018302134, group_id:391122026, user_id:2635583281,
		message:[{type:"text",data:{text:"hi"}}], sender:{user_id:2635583281,nickname:"N"} }, null);
	var ev = JSON.parse(out);
	kpLog.info("MESSAGE KEYS: %s", JSON.stringify(Object.keys(ev.body.message)));
	kpLog.info("TOP KEYS: %s", JSON.stringify(Object.keys(ev.body)));
	kpLog.info("created_at = %s | createdAt = %s", String(ev.body.message.created_at), String(ev.body.message.createdAt));
	kpLog.info("CHANNEL KEYS: %s", JSON.stringify(Object.keys(ev.body.channel||{})));
	kpLog.info("USER KEYS: %s", JSON.stringify(Object.keys(ev.body.user||{})));
	kpLog.info("GUILD KEYS: %s", JSON.stringify(Object.keys(ev.body.guild||{})));
	kpLog.info("LOGIN KEYS: %s", JSON.stringify(Object.keys(ev.body.login||{})));
	await a.close();
}
kpMain().then(()=>process.exit(0), e=>{ kpLog.error("%s", e&&e.stack||e); process.exit(1); });
