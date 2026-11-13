// ============ INTEGRATION: real OneBotInstance patch + real config =========
async function __satoriInteg() {
  const out = [];
  const ck = (n, ok, extra) => { out.push({ n, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra !== undefined ? "  " + JSON.stringify(extra) : ""}`); };

  // -- 1. the mount patched the prototype (not an instance)
  ck("OneBotInstance.prototype.createNetworkAdapter patched", OneBotInstance.prototype.createNetworkAdapter.__satoriMounted === undefined ? OneBotInstance.prototype.createNetworkAdapter.name === "satoriCreateNetworkAdapter" : true, OneBotInstance.prototype.createNetworkAdapter.name);
  ck("compileDesiredPlan NOT patched (v2 minimal)", OneBotNetworkManager.prototype.compileDesiredPlan.name !== "satoriCompileDesiredPlan");
  ck("RESTORE_NETWORK_KEYS not polluted", !RESTORE_NETWORK_KEYS.has("satoriServers"));

  // -- 2. a real config: sentinel wsServer + a normal wsServer
  const cfg = {
    networks: {
      httpServers: [], httpClients: [], wsClients: [],
      wsServers: [
        { name: "satori-1", host: "127.0.0.1", port: 5611, path: "/v1/events", role: "Universal",
          accessToken: "tok-1234567890abcd", messageFormat: "array", reportSelfMessage: false },
        { name: "ob-1", host: "127.0.0.1", port: 5612, path: "/", role: "Universal",
          accessToken: "tok-1234567890abcd", messageFormat: "array", reportSelfMessage: false }
      ]
    },
    statusCommand: { enabled: false, swallow: false, cooldownSeconds: 5, trigger: "#Haizakura" },
    historySync: { enabled: false }, notifications: { channelIds: [] }
  };
  assertValidOneBotConfig(cfg);
  ck("config with sentinel path passes assertValidOneBotConfig", true);

  // -- 3. compileDesiredPlan yields wsServer kinds (mount relies on this)
  const mgr = new OneBotNetworkManager();
  const plan = mgr.compileDesiredPlan(cfg);
  ck("compileDesiredPlan -> 2 wsServer entries", plan.length === 2 && plan.every((p) => p.kind === "wsServer"), plan.map((p) => p.kind));

  // -- 4. the factory actually returns the Satori adapter for the sentinel
  const fakeInstance = Object.create(OneBotInstance.prototype);
  const apiCtx = { uin: "10001", selfId: 10001, api: { isAcceptingActions: true, handle: async () => ({ status: "ok", retcode: 0, data: null }) } };
  const madeSatori = fakeInstance.createNetworkAdapter({ name: "satori-1", kind: "wsServer", config: cfg.networks.wsServers[0] }, apiCtx);
  const madeOb = fakeInstance.createNetworkAdapter({ name: "ob-1", kind: "wsServer", config: cfg.networks.wsServers[1] }, apiCtx);
  ck("sentinel /v1/events -> SatoriServerAdapter", madeSatori instanceof SatoriServerAdapter, madeSatori?.constructor?.name);
  ck("normal path -> WsServerAdapter (unchanged)", !(madeOb instanceof SatoriServerAdapter) && madeOb?.constructor?.name === "WsServerAdapter", madeOb?.constructor?.name);
  ck("Satori adapter describeStatus().kind", madeSatori.describeStatus().kind === "satoriServer", madeSatori.describeStatus().kind);
  ck("satori adapter eventsPath = /v1/events", madeSatori.eventsPath() === "/v1/events", madeSatori.eventsPath());
  ck("satori adapter apiPrefix = /v1/", madeSatori.apiPrefix() === "/v1/", madeSatori.apiPrefix());

  // -- 5. non-wsServer kinds still delegate correctly
  const httpSrv = fakeInstance.createNetworkAdapter({ name: "h", kind: "httpServer", config: { name: "h", host: "127.0.0.1", port: 5613, path: "/", enableWebSocket: false, enableSse: false, accessToken: "", messageFormat: "array", reportSelfMessage: false } }, apiCtx);
  ck("httpServer still -> HttpServerAdapter", httpSrv?.constructor?.name === "HttpServerAdapter", httpSrv?.constructor?.name);

  // -- 6. end-to-end through NetworkManager.register() + emitEventNow fan-out
  const adapter = madeSatori;
  const dispatched = [];
  adapter.ctx = { ...apiCtx, api: { isAcceptingActions: true, handle: async (a, p) => { dispatched.push({ a, p }); return { status: "ok", retcode: 0, data: { message_id: 99 } }; } } };
  await adapter.open();
  ck("NetworkManager path: adapter.open() listens", adapter.listening === true);
  mgr.register(adapter);
  ck("register() accepted adapter", mgr.get("satori-1") === adapter);
  ck("hasActiveAdapters true", mgr.hasActiveAdapters() === true);

  const sock = { readyState: 1, sent: [], closed: null, handlers: new Map(),
    on(e, f) { (this.handlers.get(e) ?? this.handlers.set(e, []).get(e)).push(f); return this; },
    off() { return this; }, emit(e, ...a) { for (const f of this.handlers.get(e) ?? []) f(...a); },
    send(d, cb) { this.sent.push(JSON.parse(d)); if (cb) cb(); return true; },
    close(c, r) { this.closed = { c, r }; this.readyState = 3; }, terminate() { this.readyState = 3; } };
  adapter.acceptConnection(sock, { url: "/v1/events", headers: {} });
  sock.emit("message", Buffer.from(JSON.stringify({ op: 3, body: { token: "tok-1234567890abcd" } })));
  await new Promise((r) => setTimeout(r, 200));
  ck("IDENTIFY over manager-registered adapter -> READY", sock.sent.some((f) => f.op === 4));

  // emitEventNow fans out to ALL active adapters -> this is the mount's whole point
  await mgr.emitEvent({ time: 1700000000, self_id: 10001, post_type: "message", message_type: "group", message_id: 5, group_id: 20001, group_name: "G", user_id: 30003, sender: { nickname: "N" }, message: [{ type: "text", data: { text: "via manager" } }] });
  await new Promise((r) => setTimeout(r, 250));
  const ev = sock.sent.find((f) => f.op === 0);
  ck("NetworkManager.emitEvent() -> Satori EVENT frame", ev?.body?.type === "message-created", ev?.body?.type);
  ck("manager-fed EVENT has channel+user promoted", !!ev?.body?.channel && !!ev?.body?.user && ev?.body?.channel?.id === "20001");
  ck("manager-fed EVENT content", ev?.body?.message?.content === "via manager", ev?.body?.message?.content);

  // message.create through the manager-registered adapter
  const res = await fetch("http://127.0.0.1:5611/v1/message.create", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer tok-1234567890abcd" },
    body: JSON.stringify({ channel_id: "20001", content: "ping" }) });
  const j = await res.json();
  ck("HTTP message.create via manager adapter", res.status === 200 && j[0]?.id === "99", j);
  ck("send_msg dispatched with group_id", dispatched.some((d) => d.a === "send_msg" && d.p.group_id === 20001), dispatched);

  await mgr.shutdown();
  ck("manager.shutdown() closed adapter", adapter.listening === false);
  let free = true; try { await fetch("http://127.0.0.1:5611/v1/login.get"); free = false; } catch {}
  ck("port 5611 released after shutdown", free);

  const bad = out.filter((o) => !o.ok);
  console.log(`\n==== INTEGRATION ${out.length - bad.length}/${out.length} passed ====`);
  if (bad.length) { console.log("FAILURES:"); for (const b of bad) console.log(" -", b.n); }
  return bad.length;
}
process.exitCode = await __satoriInteg();
