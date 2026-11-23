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
 *   群 [ChatLuna 闲聊群(123456)] | [匿名者.(10002)]:
 *   ID:860800303 流行不了，这种要求一次都不该有。
 *
 * NOT proven here: nothing about op2 send, and nothing about the unknown
 * `elem.generalFlags` tags (the reference drops those itself).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";
import { MSG_PUSH_CMD } from "../src/bridge/msg-push-pipeline.js";
import { CAPTURE_402_SEQ2526989626 } from "../src/bridge/fixtures/real-op6-captures.js";

/**
 * A real 402-byte `trpc.msg.olpush.OlPushService.MsgPush` body.
 *
 * `length=402` in the reference trace matches `hex.length / 2`, which is asserted
 * below so a truncated paste cannot silently weaken the test.
 */
// Taken from the fixture rather than pasted a second time: the same packet lives in
// `real-op6-captures.ts` as CAPTURE_402, and two independent copies drifted apart under
// redaction (one kept its length prefix, the other did not). One source, one truth.
const REAL_PUSH_BODY = CAPTURE_402_SEQ2526989626.bytes;

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
  // 123456 = "ChatLuna 闲聊群", 10002 = "匿名者." — both from the
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
