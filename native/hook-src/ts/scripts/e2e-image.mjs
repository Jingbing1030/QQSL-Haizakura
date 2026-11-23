#!/usr/bin/env node
// End-to-end IMAGE send through the Haizakura stack — the check that the highway wiring
// in `src/highway/pipeline.ts` actually moves bytes, not just that it compiles.
//
// This is the first test that exercises the whole chain against a live server:
//   element-builder -> pipeline (hash, NTV2 session, highway chunks) -> MsgInfo -> PbSendMsg
//
// Success is only visible in the group: a `retcode: 0` proves the client talked to
// itself, not that QQ stored the image. The caller must look at the group.
//
// Usage: node e2e-image.mjs <runtimeDir> <pid> <groupId> [summary]

import { HookClient } from "../build/src/hook-client.js";
import { RecvClient } from "../build/src/recv-client.js";
import { encodeSendMessageRequestRichText } from "../build/src/bridge/apis/message-wire.js";
import { buildSendElems, encodeElem } from "../build/src/element-builder.js";
import { createMediaUploader } from "../build/src/highway/pipeline.js";

const [runtimeDir, pidText, groupText, summary] = process.argv.slice(2);
if (!runtimeDir || !pidText || !groupText) {
  console.error("usage: e2e-image.mjs <runtimeDir> <pid> <groupId> [summary]");
  process.exit(2);
}
const pid = Number(pidText);
const groupId = Number(groupText);

// A real 1x1 PNG, inlined so the script has no external dependency. The pipeline sniffs
// the format from the magic bytes and reads the dimensions from the header, so this
// genuinely exercises both.
const PNG_1X1_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

// A 1x1 image is 70 bytes, which is a legitimate upload but an unusual one: the server may
// refuse it for reasons that have nothing to do with the codec. `HZ_IMAGE_B64` overrides the
// payload so the same script can push a real photo, which is what distinguishes "our bytes are
// wrong" from "the server does not want this particular file".
// Read from a file rather than the environment: a real photo is ~150 KB of base64 and
// `execve` rejects an argv/envp over MAX_ARG_STRLEN (128 KB), which fails as
// "Argument list too long" — a shell error that says nothing about the image.
const imageB64 =
  process.env.HZ_IMAGE_B64_FILE !== undefined
    ? (await import("node:fs")).readFileSync(process.env.HZ_IMAGE_B64_FILE, "utf8").trim()
    : (process.env.HZ_IMAGE_B64 ?? PNG_1X1_B64);

// A fresh random per message: the server answers 241 ("duplicate") to a repeated
// (random, clientSequence) pair, which reads like a broken send and is not one.
let state = (Date.now() ^ (Math.random() * 0xffffffff)) & 0xffffffff;
state = (Math.imul(state, 2654435769) >>> 0) & 0xffffffff;
const random = state & 0x7fffffff;

const hook = new HookClient({ pid, runtimeDir, replyTimeoutMs: 60000 });
const recv = new RecvClient({ pid, runtimeDir });

let settled = 0;
const failures = [];
recv.on("packet", (packet) => {
  if (packet.requestId === 0) return;
  if (hook.settleFromRecv(packet.requestId, packet.status, packet.body)) settled += 1;
});
recv.on("error", (error) => failures.push(`recv: ${String(error)}`));

await hook.connect();
await recv.connect();

// The pipeline needs only `sendRawPacket` and `identity` from a bridge. `HookClient`
// provides the former; the uin has to come from somewhere, and the send below does not
// depend on it being right (the payload stamps the real one), so a placeholder is fine.
// The uin MUST be the real one: it goes into the highway head as `DataHighwayHead.uin`, and the
// server validates it against the session ticket. A placeholder produces `error_code=67` with no
// hint that the account number was the problem.
await hook.connect();
const login = await hook.waitForLogin({ timeoutMs: 5000 });
if (login.uin === null || login.uin === "") {
  throw new Error("the payload did not report an account number; highway cannot be used");
}
const bridge = {
  identity: { uin: login.uin },
  sendRawPacket: async (serviceCmd, body) => hook.sendPacket(serviceCmd, body),
};

const uploadMedia = createMediaUploader({
  bridge,
  isGroup: true,
  targetIdOrUid: String(groupId),
});

const segment = {
  type: "image",
  imageUrl: `base64://${imageB64}`,
  summary: summary ?? "[图片]",
};

console.log("uploading 1x1 png → group %d ...", groupId);
const result = await uploadMedia(segment);
console.log("MsgInfo bytes: %d", result.msgInfo.length);
if (result.compatQMsg) console.log("compatQMsg bytes: %d", result.compatQMsg.length);

// Reuse the already-uploaded MsgInfo instead of letting `buildSendElems` upload again:
// the pipeline call above is the thing under test, and uploading twice would just make
// the test slower and double the failure surface.
const elems = await buildSendElems([{ type: "text", text: "e2e-image" }], {
  groupId,
  scene: "group",
});
elems.push({
  commonElem: { serviceType: 48, pbElem: result.msgInfo, businessType: 20 },
});

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

const sent = await hook.sendPacket("MessageSvc.PbSendMsg", body);
console.log("send: %s", JSON.stringify({
  success: sent.success,
  gotResponse: sent.gotResponse,
  errorCode: sent.errorCode,
  responseLen: sent.responseData?.length ?? 0,
}));

// Give the op 6 reply a moment to land before exiting.
await new Promise((resolve) => setTimeout(resolve, 1500));
recv.close();
hook.close();
console.log("settled=%d failures=%d", settled, failures.length);
if (failures.length > 0) {
  for (const failure of failures) console.error("  %s", failure);
  process.exit(1);
}
if (!sent.success || sent.errorCode !== 0) process.exit(1);
