/**
 * Real op6 end-to-end: a captured QQ push packet through the production `Bridge`.
 *
 * Every other op6 test in this repo feeds synthetic bytes into a decoder directly.
 * This one is different in two ways, and both matter:
 *
 *  1. The bytes are REAL — captured 2026-11-22 from the SnowLuma 2.4.0 reference
 *     (`hz-test` container, UIN 10001) out of its `packet_push` trace. See
 *     `work/captures/real-op6-samples.md`.
 *  2. It goes through `Bridge.onPacket`, not straight into a decoder — so it also
 *     proves the production wiring, i.e. that `MSG_PUSH_CMD` is actually
 *     registered and that a real packet reaches the event bus.
 *
 * That second point is the one that was genuinely missing: `Bridge`'s constructor
 * did not register `MSG_PUSH_CMD` at all until this was fixed, so every decoder
 * test could pass while a live push produced zero events.
 *
 * The expected values come from the reference's own log line for this packet:
 *
 *   群 [ChatLuna 闲聊群(123456)] | [郁金香.(10002)]:
 *   ID:860800303 流行不了，这种要求一次都不该有。
 *
 * NOT proven here: nothing about op2 send, and nothing about the unknown
 * `elem.generalFlags` tags (the reference drops those itself).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";
import { MSG_PUSH_CMD } from "../src/bridge/msg-push-pipeline.js";

/**
 * A real 402-byte `trpc.msg.olpush.OlPushService.MsgPush` body.
 *
 * `length=402` in the reference trace matches `hex.length / 2`, which is asserted
 * below so a truncated paste cannot silently weaken the test.
 */
const REAL_PUSH_BODY_HEX =
  "0a8f030a6108924e1218755f7730794d30523732386f4978556c366452533639734118e90720f78" +
  "49f800228914e423008c0c407100118e79e01220ae98381e98791e9a6992e280230013a1243" +
  "6861744c756e6120e997b2e8818ae7bea41231085220e5d08a4b28d0fe7530c4968ad806380160e5d08ac" +
  "b8080808001e8019ac262f0010180029ffccda8a59baeafc4011af6010af3010a20080010c4968ad80618e" +
  "5d08a4b2000280a300038860140024a06e5ae8be4bd9312340a320a30e6b581e8a18ce4b88de4ba86efbc8" +
  "ce8bf99e7a78de8a681e6b182e4b880e6aca1e983bde4b88de8afa5e69c89e3808212064a040800400112" +
  "7aaa02775000600068009a016e080020cb50c80100f00100f80100900200980300a00300b00300c00300d0" +
  "0300e803008a04040802105d90048001b80400c00401ca04023005f8048c800c880500b2060a0a0808001" +
  "00018002000d8069ac262ea060c080122089c5d2e5370f5a470a0079ffccda8a59baeafc40112158201120" +
  "a0ae98381e98791e9a6992e180128013a00";

const REAL_PUSH_BODY = Uint8Array.from(Buffer.from(REAL_PUSH_BODY_HEX, "hex"));

/** From the reference trace: `seqId=2526989626 ... length=402`. */
const TRACE_SEQ = 2526989626;
const TRACE_UIN = "10001";

/**
 * The real identity helper, so the test cannot drift from the interface.
 *
 * `setSelfProfile` is required: `Bridge.onPacket` returns early while
 * `selfProfile` is null (that is the "not logged in yet" guard), so without this
 * every push is silently dropped.
 */
function makeIdentity() {
  const identity = new MemoryIdentity(TRACE_UIN);
  identity.setSelfProfile({
    uin: Number(TRACE_UIN),
    uid: "u_selfplaceholder000000",
    nickname: "鱼糕",
  } as never);
  return identity;
}

test("the captured body is 402 bytes, matching the reference's length=402", () => {
  assert.equal(REAL_PUSH_BODY.length, 402);
});

test("Bridge registers MSG_PUSH_CMD — a live push cannot be silently dropped", () => {
  const bridge = new Bridge(makeIdentity());
  assert.equal(
    bridge.handlesCmd(MSG_PUSH_CMD),
    true,
    "Bridge must register the MsgPush parser in its constructor (reference/index.mjs:347367)",
  );
});

test("a REAL op6 push produces exactly one group_message event with the reference's ids", async () => {
  const bridge = new Bridge(makeIdentity());
  const seen: unknown[] = [];
  // `group_message` is the kind the reference logs for this packet.
  (bridge.events as unknown as { on(k: string, f: (e: unknown) => void): void }).on(
    "group_message",
    (event) => seen.push(event),
  );

  await bridge.onPacket({
    seq: TRACE_SEQ,
    error: 0,
    cmd: MSG_PUSH_CMD,
    uin: TRACE_UIN,
    body: REAL_PUSH_BODY,
  });

  assert.equal(seen.length, 1, "exactly one event per push packet");
  const event = seen[0] as Record<string, unknown>;

  assert.equal(event.kind, "group_message");
  // 123456 = "ChatLuna 闲聊群", 10002 = "郁金香." — both from the
  // reference's own log line for this exact packet.
  assert.equal(event.groupId, 123456);
  assert.equal(event.senderUin ?? event.userId, 10002);
  // The decoded text element, verbatim from the wire.
  const text = JSON.stringify(event);
  assert.match(text, /流行不了/, "decoded text must contain the real message body");
});

test("a second identical push is delivered — MsgPush is not deduped at the Bridge", async () => {
  // `SysMsgDedup` only routes a narrow set of msgType/subType pairs; a PkgType 82
  // group message is deliberately NOT one of them, so the reference fails open and
  // publishes both. Pinned because "dedup everything" would be a silent behaviour
  // change that no other test would catch.
  const bridge = new Bridge(makeIdentity());
  const seen: unknown[] = [];
  (bridge.events as unknown as { on(k: string, f: (e: unknown) => void): void }).on(
    "group_message",
    (event) => seen.push(event),
  );

  const packet = {
    seq: TRACE_SEQ,
    error: 0,
    cmd: MSG_PUSH_CMD,
    uin: TRACE_UIN,
    body: REAL_PUSH_BODY,
  };
  await bridge.onPacket(packet);
  await bridge.onPacket(packet);

  assert.equal(seen.length, 2, "an unrouted push must publish twice, not be swallowed");
});

test("a push for another UIN is dropped before decoding", async () => {
  const bridge = new Bridge(makeIdentity());
  const seen: unknown[] = [];
  (bridge.events as unknown as { on(k: string, f: (e: unknown) => void): void }).on(
    "group_message",
    (event) => seen.push(event),
  );

  await bridge.onPacket({
    seq: TRACE_SEQ,
    error: 0,
    cmd: MSG_PUSH_CMD,
    uin: "10001000", // not the logged-in account
    body: REAL_PUSH_BODY,
  });

  assert.deepEqual(seen, [], "a packet for a different account must not be published");
});
