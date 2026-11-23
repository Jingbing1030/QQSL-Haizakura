#!/usr/bin/env node
// End-to-end send through the Haizakura stack, with no reference implementation involved.
//
// This is the check that the port is actually usable: it builds a `MessageSvc.PbSendMsg` request
// with our own encoder, hands it to `HookClient`, and lets the DSND path originate the message.
// Success is only observable in the group -- a `retcode: 0` proves the client talked to itself,
// not that the server accepted anything -- so the caller is expected to confirm the text arrived.
//
// Usage: node e2e-send.mjs <runtimeDir> <pid> <groupId> <text>
import { HookClient } from "../build/src/hook-client.js";
import { RecvClient } from "../build/src/recv-client.js";
import { encodeSendMessageRequestRichText } from "../build/src/bridge/apis/message-wire.js";
import { buildSendElems, encodeElem } from "../build/src/element-builder.js";

const [runtimeDir, pidText, groupText, text] = process.argv.slice(2);
if (!runtimeDir || !pidText || !groupText || !text) {
  console.error("usage: e2e-send.mjs <runtimeDir> <pid> <groupId> <text>");
  process.exit(2);
}
const pid = Number(pidText);
const groupId = Number(groupText);

// A fresh random per message. The server answers 241 ("duplicate") to a repeated
// (random, clientSequence) pair, which reads like a broken send and is not one.
let state = (Date.now() ^ (Math.random() * 0xffffffff)) & 0xffffffff;
state = (Math.imul(state, 2654435769) >>> 0) & 0xffffffff;
const random = state & 0x7fffffff;

const elems = await buildSendElems([{ type: "text", text }], { groupId, scene: "group" });
const body = encodeSendMessageRequestRichText({
  routingHead: { grp: { groupCode: BigInt(groupId) } },
  contentHead: { type: 1 },
  messageBody: { richText: { elems: elems.map((e) => encodeElem(e)) } },
  clientSequence: 0,
  random,
  syncCookie: new Uint8Array(0),
  via: 0,
  dataStatist: 0,
  multiSendSeq: 0,
});

const hook = new HookClient({ pid, runtimeDir, replyTimeoutMs: 15000 });
const recv = new RecvClient({ pid, runtimeDir });

// The correlation that makes a send possible: the payload stamps the DSND request id onto the
// op 6 reply, and this listener is what turns that stamp into a settled promise.
let settled = 0;
recv.on("packet", (packet) => {
  if (packet.requestId === 0) return;
  if (hook.settleFromRecv(packet.requestId, packet.status, packet.body)) {
    settled++;
    console.log(`recv reply settled requestId=${packet.requestId} cmd=${packet.cmd} status=${packet.status} len=${packet.body.length}`);
  }
});

await recv.connect();
console.log("recv connected");

// The payload's accept() runs on its own thread, and the kernel completes our connect() before
// that thread has stored the fd. A send issued in that window still succeeds -- the message really
// is delivered -- but its op 6 reply is emitted to `g_recv_peer == -1` and lost forever, so the
// caller would see a timeout on a send that worked.
//
// The payload answers a fresh recv connection with a hello, and only after that hello is the peer
// registered for emission. Wait for it explicitly rather than sleeping: a fixed delay that is
// long enough today is a flaky test tomorrow.
await new Promise((resolve) => {
  const timer = setTimeout(() => {
    console.warn("recv: no hello within 3s, sending anyway (reply may be lost)");
    resolve();
  }, 3000);
  recv.once("hello", () => {
    clearTimeout(timer);
    // The accept thread stores the fd immediately before/after writing the hello, so give the
    // store a moment to land. One tick is enough; this is not a tuning knob.
    setTimeout(resolve, 150);
  });
});
console.log("recv ready (hello seen)");

// `sendPacket` recognises MessageSvc.PbSendMsg and routes it to DSND, so this is the same call
// every OneBot action makes.
const result = await hook.sendPacket("MessageSvc.PbSendMsg", body, 15000);
console.log("send result:", JSON.stringify({
  gotResponse: result.gotResponse,
  success: result.success,
  errorCode: result.errorCode,
  errorMessage: result.errorMessage,
  responseLen: result.responseData ? result.responseData.length : 0,
  responseHex: result.responseData ? Buffer.from(result.responseData).toString("hex") : null,
}));
console.log("random:", random, "settled:", settled);

hook.close();
recv.close();
process.exit(result.gotResponse && result.success ? 0 : 1);
