// Long-lived recv client: connects once, then drives several sends while staying subscribed.
//
// Every earlier test opened a fresh recv connection per run. The payload accepts on a single
// thread, so between "old client closed" and "new client accepted" g_recv_peer is -1 and any
// op 6 emitted in that window is dropped. A real deployment never reconnects per message, so this
// test reflects the actual usage instead of the reconnect race.
import { HookClient } from "../build/src/hook-client.js";
import { RecvClient } from "../build/src/recv-client.js";

const [runtimeDir, pidText, groupText, prefix] = process.argv.slice(2);
const pid = Number(pidText);
const group = Number(groupText);

const recv = new RecvClient({ pid, runtimeDir });
const hook = new HookClient({ pid, runtimeDir });

const replies = new Map();
recv.on("packet", (p) => {
  console.log(`PACKET cmd=${p.cmd} corr=${p.requestId} seq=${p.sequence} len=${p.body.length}`);
  replies.set(p.requestId, p);
});
recv.on("error", (e) => console.log("recv error:", e.message));

await recv.connect();
await new Promise((r) => { const t = setTimeout(r, 3000); recv.once("hello", () => { clearTimeout(t); setTimeout(r, 200); }); });
console.log("recv ready");

for (let i = 1; i <= 3; i++) {
  const body = buildBody(`persist-${i}`, group);
  const res = await hook.sendPacket("MessageSvc.PbSendMsg", body, 12000);
  console.log(`send ${i}:`, JSON.stringify(res));
  await new Promise((r) => setTimeout(r, 1500));
}
console.log("replies seen:", replies.size);
recv.close();
process.exit(0);

function buildBody(text, groupId) {
  const enc = (s) => Buffer.from(s, "utf8");
  const field = (num, wire, payload) => {
    const tag = Buffer.alloc(1);
    tag[0] = (num << 3) | wire;
    return Buffer.concat([tag, payload]);
  };
  const varint = (v) => {
    const out = [];
    while (v > 127) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
    out.push(v);
    return Buffer.from(out);
  };
  const c2c = field(1, 2, enc(text));
  const routing = field(1, 0, varint(groupId)) ;
  return Buffer.concat([field(1, 0, varint(1)), field(2, 2, routing), field(3, 2, c2c)]);
}
