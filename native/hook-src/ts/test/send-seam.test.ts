/**
 * The assembly seam: `HaizakuraRuntime` -> `Bridge` -> `message.sendGroup` -> op2 bytes.
 *
 * ## Why this file exists
 *
 * Every component of the send path already had its own passing test, and the port
 * still could not send a message, because nothing wired them together. A component can
 * be individually correct and collectively dead — that is precisely how
 * `MSG_PUSH_CMD` stayed unregistered while 1300 tests were green.
 *
 * So this test asserts the *composition*: given a runtime and an attached packet
 * sender, `sendGroup` must actually produce `MessageSvc.PbSendMsg` bytes, and those
 * bytes must carry the group id and text that were asked for.
 *
 * ## What it proves, and what it does not
 *
 * Proves: the runtime reaches the encoder, the wire name is right, and the request
 * carries the right fields.
 *
 * Does NOT prove: a real QQ accepts it. The `PacketClient` here is a recording
 * double; real delivery needs the injected payload and is a separate, still-open
 * claim. The double deliberately never replies, and the assertion is that the
 * resulting failure is *honest* (`no response`) rather than a fabricated success.
 */
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { HaizakuraRuntime } from "../src/main.js";

const UIN = "10001";
const GROUP = 1234567890;

interface SentPacket {
  readonly wireName: string;
  readonly body: Uint8Array;
}

/** A `PacketClient` that records what was written and never replies. */
function recordingClient(pid: number, sent: SentPacket[]) {
  return {
    pid,
    sendPacket: async (wireName: string, body: Uint8Array) => {
      sent.push({ wireName, body });
      // No reply: the caller must fail honestly instead of inventing a message id.
      // `gotResponse: false` is the real shape — `PacketSendResult` extends
      // `OidbTransportResult`, so a partial object would not type-check and, worse,
      // would let a caller read `success` as `undefined` (falsy) by accident.
      return { gotResponse: false, success: false };
    },
  };
}

/**
 * Read a protobuf varint, returning `[value, nextOffset]`.
 *
 * A local reader rather than a general decoder on purpose: this test must not depend
 * on the very encoder it is checking. It parses only what it asserts.
 */
function readVarint(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  for (;;) {
    const byte = bytes[cursor];
    assert.ok(byte !== undefined, "varint ran off the end of the buffer");
    value += (byte & 0x7f) * 2 ** shift;
    cursor += 1;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [value, cursor];
}

/**
 * Extract `groupId` (RoutingHead.grp.groupId, field 1.2.1) and `random` (field 5).
 *
 * Field numbers are from `ts/src/send-message-request.ts`, which established them
 * byte-for-byte against the reference:
 *   - field 1 = RoutingHead, whose field 2 = `grp`, whose field 1 = group id
 *     (field 1 of RoutingHead is `c2c` — swapping them is the classic error)
 *   - field 5 = `random`
 */
function decodeGroupAndRandom(bytes: Uint8Array): { groupId: number | null; random: number | null } {
  const out: { groupId: number | null; random: number | null } = { groupId: null, random: null };
  let offset = 0;
  while (offset < bytes.length) {
    const [tag, afterTag] = readVarint(bytes, offset);
    const field = Math.floor(tag / 8);
    const wireType = tag & 7;
    offset = afterTag;

    if (wireType === 0) {
      const [value, next] = readVarint(bytes, offset);
      offset = next;
      if (field === 5) out.random = value > 0x7fffffff ? value - 0x100000000 : value;
      continue;
    }
    if (wireType !== 2) { offset += 1; continue; }

    const [length, bodyStart] = readVarint(bytes, offset);
    const bodyEnd = bodyStart + length;
    const body = bytes.subarray(bodyStart, bodyEnd);
    offset = bodyEnd;

    if (field !== 1) continue;
    // RoutingHead: walk its fields looking for field 2 (`grp`).
    let inner = 0;
    while (inner < body.length) {
      const [innerTag, innerNext] = readVarint(body, inner);
      const innerField = Math.floor(innerTag / 8);
      const innerWire = innerTag & 7;
      inner = innerNext;
      if (innerWire !== 2) { inner += 1; continue; }
      const [innerLen, innerStart] = readVarint(body, inner);
      const innerBody = body.subarray(innerStart, innerStart + innerLen);
      inner = innerStart + innerLen;
      if (innerField !== 2) continue;
      // grp: field 1 is the group id varint.
      let grp = 0;
      while (grp < innerBody.length) {
        const [grpTag, grpNext] = readVarint(innerBody, grp);
        const grpField = Math.floor(grpTag / 8);
        const grpWire = grpTag & 7;
        grp = grpNext;
        if (grpWire !== 0) { grp += 1; continue; }
        const [grpValue, grpAfter] = readVarint(innerBody, grp);
        grp = grpAfter;
        if (grpField === 1) out.groupId = grpValue;
      }
    }
  }
  return out;
}

/** Whether the UTF-8 bytes of `text` appear verbatim in the request. */
function containsText(bytes: Uint8Array, text: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(text, "utf8"));
}

describe("send seam: runtime -> bridge -> op2 encoder -> PacketClient", () => {
  test("sendGroup emits MessageSvc.PbSendMsg with the real group id and text", async () => {
    const runtime = new HaizakuraRuntime({ uin: UIN, nickname: "鱼糕" });
    runtime.start();
    const sent: SentPacket[] = [];
    runtime.bindSender(999, recordingClient(999, sent));

    await assert.rejects(
      runtime.getBridge().apis.message.sendGroup(GROUP, [{ type: "text", text: "测试" }]),
      /no response/i,
      "a sender that never replies must fail, not fabricate a receipt",
    );
    await runtime.stop();

    assert.equal(sent.length, 1, `expected exactly one packet, got ${sent.length}`);
    const packet = sent[0]!;
    assert.equal(packet.wireName, "MessageSvc.PbSendMsg");
    assert.ok(packet.body.length > 0, "the request body must not be empty");

    const { groupId, random } = decodeGroupAndRandom(packet.body);
    assert.equal(
      groupId,
      GROUP,
      `group id on the wire, hex=${Buffer.from(packet.body).toString("hex")}`,
    );
    assert.ok(random !== null && random > 0, "field 5 `random` must be a positive int32");
    assert.ok(
      containsText(packet.body, "测试"),
      `text must survive encoding verbatim, hex=${Buffer.from(packet.body).toString("hex")}`,
    );
  });

  test("the encoded request carries a fresh random, so two sends differ", async () => {
    // A fixed `random` makes QQ treat a repeated send as a duplicate.
    const runtime = new HaizakuraRuntime({ uin: UIN, nickname: "鱼糕" });
    runtime.start();
    const sent: SentPacket[] = [];
    runtime.bindSender(999, recordingClient(999, sent));

    for (const text of ["a", "b"]) {
      await assert.rejects(
        runtime.getBridge().apis.message.sendGroup(GROUP, [{ type: "text", text }]),
        /no response/i,
      );
    }
    await runtime.stop();

    assert.equal(sent.length, 2);
    const first = decodeGroupAndRandom(sent[0]!.body);
    const second = decodeGroupAndRandom(sent[1]!.body);
    assert.equal(first.groupId, GROUP);
    assert.equal(second.groupId, GROUP);
    assert.notEqual(first.random, second.random, "each send must pick a fresh `random`");
  });

  test("without an attached sender the send fails loudly and sends nothing", async () => {
    const runtime = new HaizakuraRuntime({ uin: UIN, nickname: "鱼糕" });
    runtime.start();
    await assert.rejects(
      runtime.getBridge().apis.message.sendGroup(GROUP, [{ type: "text", text: "x" }]),
      /no packet sender attached/i,
      "the no-sender error must name the real cause",
    );
    await runtime.stop();
  });

  test("stop() detaches the sender, so a later send cannot reach the old client", async () => {
    // A detached client that still receives packets is how a restart silently keeps
    // writing to a dead process.
    const runtime = new HaizakuraRuntime({ uin: UIN, nickname: "鱼糕" });
    runtime.start();
    const sent: SentPacket[] = [];
    runtime.bindSender(999, recordingClient(999, sent));
    await runtime.stop();
    assert.equal(runtime.getBridge().hasPid(999), false, "stop must detach the pid");
    await assert.rejects(
      runtime.getBridge().apis.message.sendGroup(GROUP, [{ type: "text", text: "x" }]),
      /no packet sender attached/i,
    );
    assert.equal(sent.length, 0, "a detached sender must receive nothing");
  });

  test("two runtimes keep their senders apart", async () => {
    // A module-level singleton would make this pass trivially; two instances must not
    // route to each other's client.
    const a = new HaizakuraRuntime({ uin: "1", nickname: "one" });
    const b = new HaizakuraRuntime({ uin: "2", nickname: "two" });
    a.start();
    b.start();
    const sentA: SentPacket[] = [];
    const sentB: SentPacket[] = [];
    a.bindSender(1, recordingClient(1, sentA));
    b.bindSender(2, recordingClient(2, sentB));

    await assert.rejects(a.getBridge().apis.message.sendGroup(GROUP, [{ type: "text", text: "x" }]), /no response/i);
    await a.stop();
    await b.stop();

    assert.equal(sentA.length, 1, "runtime A must send on its own client");
    assert.equal(sentB.length, 0, "runtime B must not see A's traffic");
  });
});
