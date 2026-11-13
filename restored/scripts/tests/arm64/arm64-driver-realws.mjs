// ===================== REAL-SOCKET WS VERIFICATION DRIVER =====================
// Appended after dist/index.mjs is truncated before `//#region src/index.ts`.
// Runs in the bundle's flat scope, so SatoriServerAdapter / mount patches are live.
// Uses the REAL npm `ws` client + the REAL linux-arm64 native framing addon.
async function __satoriArm64Run() {
const __rq = createRequire(import.meta.url);
const { WebSocket } = __rq("ws");

const __res = [];
const __check = (n, ok, extra) => {
  __res.push({ n, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra !== undefined ? "  " + JSON.stringify(extra) : ""}`);
};
const __sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const __ctx = {
  uin: "3254926145", selfId: 3254926145,
  api: {
    isAcceptingActions: true,
    handle: async (action, params) => {
      if (action === "get_login_info") return { status: "ok", retcode: 0, data: { user_id: 3254926145, nickname: "碧海" } };
      return { status: "ok", retcode: 0, data: {} };
    }
  },
  buildLifecycleEvent: () => ({ post_type: "meta_event" }),
  buildHeartbeatEvent: () => ({ post_type: "meta_event" })
};

const PORT = 5613;
const TOKEN = "arm64-real-token";
const URL = `ws://127.0.0.1:${PORT}/v1/events`;

// ---------------------------------------------------------------- 0. native addon
// A successful handshake REQUIRES the native addon (computeAcceptKey/buildFrame).
// The stub addon throws on every call, so reaching 101 proves the real addon loaded.
__check("native addon is REAL (not the dev stub)", process.env.SNOWLUMA_DEV_NO_NATIVE !== "1", {
  SNOWLUMA_DEV_NO_NATIVE: process.env.SNOWLUMA_DEV_NO_NATIVE ?? null,
  arch: process.arch
});

const adapter = new SatoriServerAdapter("satori-arm64", {
  name: "satori-arm64", host: "127.0.0.1", port: PORT, path: "/v1/events",
  accessToken: TOKEN, messageFormat: "array", reportSelfMessage: true
}, __ctx);

await adapter.open();
__check("adapter.open() listening on arm64", adapter.listening === true);
__check("describeStatus kind=satoriServer", adapter.describeStatus().kind === "satoriServer");
__check("eventsPath resolves to /v1/events", adapter.eventsPath() === "/v1/events", adapter.eventsPath());

// ------------------------------------------------------- 1. real handshake (101)
let upgradeStatus = null;
let sockErr = null;
await new Promise((resolve) => {
  const probe = new WebSocket(URL);
  probe.on("upgrade", (res) => { upgradeStatus = res.statusCode; });
  probe.on("open", () => { probe.close(); resolve(); });
  probe.on("error", (e) => { sockErr = String(e && e.message || e); resolve(); });
  setTimeout(resolve, 6000);
});
__check("(1) real WS handshake -> HTTP 101", upgradeStatus === 101, { status: upgradeStatus, sockErr });

// ------------------------------------------------- 5. wrong token -> close 4004
const badClose = await new Promise((resolve) => {
  let opened = false;
  const ws = new WebSocket(URL);
  ws.on("open", () => { opened = true; ws.send(JSON.stringify({ op: 3, body: { token: "WRONG" } })); });
  ws.on("close", (code) => resolve({ code, opened }));
  ws.on("error", (e) => resolve({ err: String(e && e.message || e), opened }));
  setTimeout(() => resolve({ timeout: true, opened }), 8000);
});
__check("(5) bad IDENTIFY token -> close 4004", badClose.code === 4004, badClose);

// --------------------------------------- 2/3/4. good flow over real frames
const flow = await new Promise((resolve) => {
  const out = { ready: null, pong: null, event: null, frames: [], closed: null, err: null, upgraded: null };
  const ws = new WebSocket(URL);
  ws.on("upgrade", (res) => { out.upgraded = res.statusCode; });
  ws.on("open", () => { ws.send(JSON.stringify({ op: 3, body: { token: TOKEN } })); });
  ws.on("message", (raw, isBinary) => {
    let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
    out.frames.push({ op: msg.op, binary: isBinary, bytes: Buffer.byteLength(String(raw)) });
    if (msg.op === 4 && !out.ready) {
      out.ready = msg;
      ws.send(JSON.stringify({ op: 1 }));
      setTimeout(() => {
        adapter.onEvent({
          time: 1763000000, self_id: 3254926145, post_type: "message", message_type: "group",
          sub_type: "normal", message_id: 1018302134, group_id: 391122026, group_name: "ChatLuna 闲聊群",
          user_id: 2635583281, sender: { user_id: 2635583281, nickname: "郁金香.", card: "郁金香." },
          message: [{ type: "text", data: { text: "hello" } }, { type: "at", data: { qq: "3254926145" } }]
        }, null);
      }, 200);
    } else if (msg.op === 2 && !out.pong) out.pong = msg;
    else if (msg.op === 0 && !out.event) {
      out.event = msg;
      setTimeout(() => ws.close(), 200);
    }
  });
  ws.on("close", (c) => { out.closed = c; resolve(out); });
  ws.on("error", (e) => { out.err = String(e && e.message || e); resolve(out); });
  setTimeout(() => resolve(out), 12000);
});

__check("(2) IDENTIFY -> READY op=4 over real frames", flow.ready !== null, flow.upgraded);
__check("(2) READY.logins[0].user.id", flow.ready?.body?.logins?.[0]?.user?.id === "3254926145");
__check("(2) READY.proxy_urls is []", JSON.stringify(flow.ready?.body?.proxy_urls) === "[]");
__check("(3) PING -> PONG op=2", flow.pong !== null);
__check("(4) EVENT op=0 parsed by real client", flow.event !== null);
const ev = flow.event?.body;
__check("(4) EVENT type=message-created", ev?.type === "message-created", ev?.type);
__check("(4) EVENT channel promoted", ev?.channel?.id === "391122026");
__check("(4) EVENT guild promoted", ev?.guild?.id === "391122026");
__check("(4) EVENT user promoted", ev?.user?.id === "2635583281");
__check("(4) EVENT message stripped of resources", !!ev?.message && !("user" in ev.message) && !("channel" in ev.message) && !("guild" in ev.message));
__check("(4) EVENT content encoded w/ <at", String(ev?.message?.content).includes("hello") && String(ev?.message?.content).includes("<at"), ev?.message?.content);
__check("(4) wire snake_case is_bot", ev?.user?.is_bot === false && !("isBot" in (ev?.user ?? {})));
__check("(4) wire snake_case created_at ms", ev?.message?.created_at === 1763000000000, ev?.message?.created_at);
__check("(4) no camelCase createdAt", !("createdAt" in (ev?.message ?? {})));
__check("(6) frames are text (not binary) + non-empty", flow.frames.length >= 3 && flow.frames.every((f) => f.binary === false && f.bytes > 0), flow.frames);

// ---------------------------------- 6b. raw masked-frame decode (native Parser)
// Hand-rolled client frame: proves the native addon unmasks + parses real RFC6455
// bytes (the `ws` client already does this, but this pins the exact wire form).
const net = __rq("node:net");
const crypto = __rq("node:crypto");
const rawResult = await new Promise((resolve) => {
  const key = crypto.randomBytes(16).toString("base64");
  const s = net.connect(PORT, "127.0.0.1", () => {
    s.write(
      "GET /v1/events HTTP/1.1\r\n" +
      `Host: 127.0.0.1:${PORT}\r\n` +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
    );
  });
  let buf = Buffer.alloc(0);
  let sawHandshake = false;
  const out = { acceptOk: false, status: null, frameOp: null, protocolOp: null, text: null };
  s.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (!sawHandshake) {
      const idx = buf.indexOf("\r\n\r\n");
      if (idx === -1) return;
      const head = buf.slice(0, idx).toString("latin1");
      buf = buf.slice(idx + 4);
      sawHandshake = true;
      out.status = Number((head.match(/^HTTP\/1\.1 (\d+)/) || [])[1]);
      const got = (head.match(/Sec-WebSocket-Accept: (.+)/i) || [])[1]?.trim();
      const want = native.computeAcceptKey(key);
      out.acceptOk = got === want;
      // send a MASKED IDENTIFY frame (client frames MUST be masked; native must unmask)
      const payload = Buffer.from(JSON.stringify({ op: 3, body: { token: TOKEN } }));
      const mask = crypto.randomBytes(4);
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
      const header = payload.length < 126
        ? Buffer.from([0x81, 0x80 | payload.length])
        : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
      s.write(Buffer.concat([header, mask, masked]));
      return;
    }
    // server frames are unmasked. Decode the frame, then the JSON body:
    // RFC6455 frame opcode 0x1 = TEXT (Satori's op lives INSIDE the JSON body).
    if (buf.length >= 2) {
      const frameOp = buf[0] & 0x0f;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length >= off + len) {
        const payload = buf.slice(off, off + len);
        out.frameOp = frameOp;
        out.text = payload.toString("utf8").slice(0, 120);
        try { out.protocolOp = JSON.parse(payload.toString("utf8")).op; } catch { out.protocolOp = null; }
        s.destroy();
        resolve(out);
      }
    }
  });
  s.on("error", (e) => { out.err = String(e.message); resolve(out); });
  setTimeout(() => { s.destroy(); resolve(out); }, 8000);
});
__check("(6) raw handshake 101 + correct Sec-WebSocket-Accept", rawResult.status === 101 && rawResult.acceptOk, { status: rawResult.status, acceptOk: rawResult.acceptOk });
__check("(6) native Parser unmasked hand-built mask frame -> TEXT + READY(op=4)", rawResult.frameOp === 1 && rawResult.protocolOp === 4, rawResult);

await adapter.close();
__check("close() released listener", adapter.listening === false);

const failed = __res.filter((r) => !r.ok);
console.log(`\n==== arm64 REAL-SOCKET: ${__res.length - failed.length}/${__res.length} passed ====`);
if (failed.length) { console.log("FAILURES:"); for (const f of failed) console.log(" -", f.n, JSON.stringify(f.extra)); }
return failed.length;
}
process.exitCode = await __satoriArm64Run();
