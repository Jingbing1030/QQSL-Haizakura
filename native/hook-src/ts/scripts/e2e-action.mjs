#!/usr/bin/env node
// End-to-end `send_group_msg` through the OneBot ACTION layer, against a live QQ.
//
// `e2e-send.mjs` stops at `HookClient.sendPacket("MessageSvc.PbSendMsg", …)`. That proves the
// payload can originate a message, but it skips the entire port between the action's name and
// the wire: parameter validation, `resolveMessage`, the element builder, the send-context
// wiring, and the reply correlation. This script enters at `api.handle("send_group_msg", …)`
// — the same call an HTTP request makes — so a green run here means the action really works.
//
// What it does NOT do: open an HTTP listener. `api.handle` is the dispatcher the HTTP/WS
// adapters sit on top of, and going through it exercises every layer except the socket framing
// (which has its own tests and no dependency on a live account).
//
// Usage: node e2e-action.mjs <runtimeDir> <pid> <groupId> [text]
import { HookClient } from "../build/src/hook-client.js";
import { RecvClient } from "../build/src/recv-client.js";
import { Bridge, MemoryIdentity } from "../build/src/bridge/bridge.js";
import { BridgeActionContextHost } from "../build/src/host/action-context-host.js";
import { createOneBotApi } from "../build/src/onebot/api.js";

const [runtimeDir, pidText, groupText, textArg] = process.argv.slice(2);
if (!runtimeDir || !pidText || !groupText) {
  console.error("usage: e2e-action.mjs <runtimeDir> <pid> <groupId> [text]");
  process.exit(2);
}
const pid = Number(pidText);
const groupId = Number(groupText);
// Unique per run: a repeated text would make "did my send land?" unanswerable by reading the
// group, because a previous run's message looks identical.
const text = textArg ?? `hz-action-${Date.now().toString(36)}`;

const hook = new HookClient({ pid, runtimeDir, replyTimeoutMs: 15000 });
const recv = new RecvClient({ pid, runtimeDir });

// The correlation that makes a send possible: the payload stamps the DSND request id onto the
// op 6 reply, and this listener is what turns that stamp into a settled promise.
let settled = 0;
recv.on("packet", (packet) => {
  if (packet.requestId === 0) return;
  if (hook.settleFromRecv(packet.requestId, packet.status, packet.body)) {
    settled++;
  }
});

await recv.connect();

// The payload's accept() runs on its own thread and the kernel completes our connect() before
// that thread has stored the fd. A send in that window still delivers, but its op 6 reply is
// emitted to `g_recv_peer == -1` and lost — so the caller times out on a send that worked.
await new Promise((resolve) => {
  const timer = setTimeout(() => {
    console.warn("recv: no hello within 3s, sending anyway (reply may be lost)");
    resolve();
  }, 3000);
  recv.once("hello", () => {
    clearTimeout(timer);
    setTimeout(resolve, 150);
  });
});

// The bridge needs the real account number: it goes into the highway head and the message
// routing, and a placeholder is rejected with an error code that names nothing.
await hook.connect();
const login = await hook.waitForLogin({ timeoutMs: 5000 });
if (login.uin === null || login.uin === "") {
  throw new Error("the payload did not report an account number; cannot send");
}

// A real `Bridge` over the live payload. This is the object the production session builds; the
// only difference from a logged-in client is that the roster is an empty in-memory one rather
// than the fetched one. Sending needs no roster, so that difference cannot mask a send failure.
const bridge = new Bridge(new MemoryIdentity(login.uin, ""));
// Bind the live payload as this PID's packet client. `receiveHealthy` is a GETTER over the
// bound connections, so the only way to make the bridge online is to attach one — assigning
// the property would throw and, worse, an offline bridge makes `send_group_msg` refuse.
bridge.bindPid(pid, {
  sendPacket: (wireName, body, timeoutMs) =>
    timeoutMs === undefined
      ? hook.sendPacket(wireName, body)
      : hook.sendPacket(wireName, body, timeoutMs),
});

const host = new BridgeActionContextHost({ bridge });
const api = createOneBotApi({
  createContext: () => host,
  isAcceptingActions: () => true,
});

console.log("dispatching send_group_msg → group %d", groupId);
const started = Date.now();
const result = await api.handle("send_group_msg", {
  group_id: groupId,
  message: text,
  auto_escape: false,
});
const elapsed = Date.now() - started;

console.log("action result: %s", JSON.stringify(result));
console.log("elapsed: %d ms, recv replies settled: %d", elapsed, settled);

// Success is a `retcode: 0` AND a non-zero message_id. The retcode alone only proves the
// dispatcher answered; the id is what the caller stores for recall and reply, and the
// reference derives it from the event name + sequence, so a zero means the send path never
// produced a sequence.
const ok =
  result !== null &&
  typeof result === "object" &&
  result.retcode === 0 &&
  typeof result.data?.message_id === "number" &&
  result.data.message_id !== 0;

console.log(ok ? "PASS: send_group_msg delivered" : "FAIL: send_group_msg did not deliver");
console.log("text to look for in group %d: %s", groupId, text);

hook.close();
recv.close();
process.exit(ok ? 0 : 1);
