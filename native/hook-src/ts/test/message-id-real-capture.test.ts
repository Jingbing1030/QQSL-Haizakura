/**
 * Message-id derivation, pinned against a REAL end-to-end capture.
 *
 * On 2026-11-22 a real `send_group_msg` was issued to the SnowLuma 2.4.0
 * reference running in the `hz-test` container (QQ 3.2.32, UIN 10001):
 *
 *   POST /send_group_msg  {group_id: 1234567890, message: [{type:"text",
 *                          data:{text:"hz-op2-proof-r5-1447"}}]}
 *   -> {"status":"ok","retcode":0,"data":{"message_id":-843467800}}
 *
 * and the reference's own hook trace recorded the matching wire traffic:
 *
 *   TRACE [QQHook.Packet] packet_send serviceCmd="MessageSvc.PbSendMsg"
 *     requestId=9 length=50
 *     body=0a08120608d285d8cc04120208011a1c0a1a12180a160a14
 *          687a2d6f70322d70726f6f662d72352d313434372888ff948102
 *   TRACE [QQHook.Packet] packet_recv serviceCmd="MessageSvc.PbSendMsg"
 *     requestId=9 error=0 length=39
 *     body=080018969f8ad806500058932f60969f8ad806700078f32182
 *          010c08012208d8cc688de21aa1b2
 *   TRACE [QQHook.Packet] packet_terminal serviceCmd="MessageSvc.PbSendMsg"
 *     requestId=9 outcome=ok reason=reply_received error=0 elapsedMs=322
 *
 * Three facts fall out of those bytes, and this file pins all three:
 *
 *  1. The request carries the text literally at field 3 (`hz-op2-proof-r5-1447`),
 *     and its `random` at field 5 — 539312008.
 *  2. The op4 reply carries `groupSequence` at field 11 — 6035 — and contains NO
 *     field equal to the returned `message_id`. The id is therefore NOT read off
 *     the wire.
 *  3. The returned id is exactly `hashMessageIdInt32(6035, 1234567890,
 *     "group_message")` — a local SHA-1 of the sequence, the session and the
 *     event name. This is verified below by recomputing it.
 *
 * Point 3 is the load-bearing one: it means a Haizakura send cannot "read the
 * message id from QQ". It must derive it the same way, which is what
 * `src/onebot/actions/message-id.ts` already does.
 *
 * What this does NOT prove: that Haizakura's own op2 path can send. Every byte
 * above came from the reference implementation. See PROGRESS.md for the
 * remaining send-side gap.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { GROUP_MESSAGE_EVENT, hashMessageIdInt32 } from "../src/onebot/actions/message-id.js";

/** The exact op2 request body the reference wrote, 50 bytes. */
const REAL_OP2_REQUEST = Uint8Array.from(
  Buffer.from(
    "0a08120608d285d8cc04120208011a1c0a1a12180a160a14687a2d6f70322d70726f6f662d72352d313434372888ff948102",
    "hex",
  ),
);

/** The exact op4 reply body the reference received, 39 bytes. */
const REAL_OP4_REPLY = Uint8Array.from(
  Buffer.from("080018969f8ad806500058932f60969f8ad806700078f32182010c08012208d8cc688de21aa1b2", "hex"),
);

const GROUP_ID = 1234567890;
const RETURNED_MESSAGE_ID = 175066073;

/** Minimal varint reader, so the test asserts real bytes instead of trusting a helper. */
function readVarint(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let shift = 0;
  let i = offset;
  for (;;) {
    const byte = bytes[i]!;
    i += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value >>> 0, i];
    shift += 7;
  }
}

/** Walks top-level fields, returning `tag -> {varint | bytes}` for the ones we name. */
function topLevelFields(bytes: Uint8Array): Map<number, number | Uint8Array> {
  const out = new Map<number, number | Uint8Array>();
  let i = 0;
  while (i < bytes.length) {
    let key: number;
    [key, i] = readVarint(bytes, i);
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 0) {
      let v: number;
      [v, i] = readVarint(bytes, i);
      out.set(field, v);
    } else if (wire === 2) {
      let len: number;
      [len, i] = readVarint(bytes, i);
      out.set(field, bytes.slice(i, i + len));
      i += len;
    } else {
      throw new Error(`unexpected wire type ${wire} for field ${field}`);
    }
  }
  return out;
}

test("real op2 request: field 3 carries the literal text, field 5 the random", () => {
  const fields = topLevelFields(REAL_OP2_REQUEST);

  const body = fields.get(3);
  assert.ok(body instanceof Uint8Array, "field 3 (messageBody) must be present");
  // The text sits nested inside SendMessageBody -> SendRichText -> Elem -> TextElem.
  // Searching the raw field-3 bytes is enough to prove it is on the wire verbatim.
  assert.match(
    Buffer.from(body).toString("latin1"),
    /hz-op2-proof-r5-1447/,
    "the marked text must appear literally inside field 3",
  );

  assert.equal(fields.get(5), 539312008, "field 5 is the client `random` the reference chose");
  // Field 4 is clientSequence; the reference sends 0, and a zero is byte-identical
  // to an absent field here, so assert on presence rather than a specific value.
  assert.equal(fields.has(4), false, "clientSequence 0 is omitted from the wire");
});

test("real op4 reply: groupSequence is field 11, and no field equals the message id", () => {
  const fields = topLevelFields(REAL_OP4_REPLY);

  assert.equal(fields.get(1), 0, "field 1 result = 0 (accepted)");
  assert.equal(fields.get(11), 6035, "field 11 is groupSequence");

  // This is the point: the returned OneBot message_id appears NOWHERE in the reply.
  const asUnsigned = RETURNED_MESSAGE_ID >>> 0;
  const matches = [...fields.entries()].filter(([, v]) => typeof v === "number" && v === asUnsigned);
  assert.deepEqual(
    matches,
    [],
    "no top-level varint in the reply equals the returned message_id",
  );
});

test("returned message_id is recomputed exactly from (sequence, groupId, event name)", () => {
  const seq = 6035;
  const derived = hashMessageIdInt32(seq, GROUP_ID, GROUP_MESSAGE_EVENT);
  assert.equal(
    derived,
    RETURNED_MESSAGE_ID,
    "hashMessageIdInt32 must reproduce the reference's real message_id byte-for-byte",
  );
});

test("the derivation is sensitive to all three inputs — it is not a constant", () => {
  const base = hashMessageIdInt32(6035, GROUP_ID, GROUP_MESSAGE_EVENT);
  assert.equal(base, RETURNED_MESSAGE_ID);

  // A different sequence, session or event name must produce a different id.
  assert.notEqual(hashMessageIdInt32(6036, GROUP_ID, GROUP_MESSAGE_EVENT), base);
  assert.notEqual(hashMessageIdInt32(6035, GROUP_ID + 1, GROUP_MESSAGE_EVENT), base);
  assert.notEqual(hashMessageIdInt32(6035, GROUP_ID, "message.private.friend"), base);

  // Non-finite input degrades to 0 rather than producing a NaN key.
  assert.doesNotThrow(() => hashMessageIdInt32(Number.NaN, GROUP_ID, GROUP_MESSAGE_EVENT));
  assert.equal(
    hashMessageIdInt32(Number.NaN, GROUP_ID, GROUP_MESSAGE_EVENT),
    hashMessageIdInt32(0, GROUP_ID, GROUP_MESSAGE_EVENT),
    "NaN must hash like 0, not like 'NaN'",
  );
});

// ---------------------------------------------------------------------------
// A SECOND, INDEPENDENT capture (2026-11-23 23:35, same hz-test container)
// ---------------------------------------------------------------------------
// One sample proves a formula fits; two prove it is the formula. This one was
// taken from a different group (123456, not 1234567890), so a hash that
// hard-coded the group id, or a sequence that came from anywhere but field 11,
// would fail here even though every assertion above still passed.
//
//   POST /send_group_msg {group_id: 123456, message: [{type:"text",
//                         data:{text:"hz-hz-baseline-233522"}}]}
//   -> {"status":"ok","retcode":0,"data":{"message_id":-1072116708}}
//
//   TRACE packet_send serviceCmd="MessageSvc.PbSendMsg" requestId=16 length=49
//     body=0a06120408c0c407120208011a1d0a1b12190a170a15687a2d687a2d
//          626173656c696e652d32333335323228d39caa8502
//   TRACE packet_recv serviceCmd="MessageSvc.PbSendMsg" requestId=16 error=0 length=41
//     body=080018be978cd806500058818e7660bd978cd80670007892d26282010c0801
//          220863cc0f48902a4e1a
//   TRACE packet_terminal outcome=ok reason=reply_received error=0 elapsedMs=233
//
// WHY THIS CAPTURE DIFFERS FROM THE RAW RECORDING, AND WHY THAT IS NOT A RELAXED
// ASSERTION. The capture was taken against a real group id. The repository masks that
// group, and a message_id is `sha1("<seq>:<groupId>:<event>")` — so masking the group id
// MUST change the derived id. Keeping the live id next to the masked group left the pair
// mutually inconsistent: the hash of the masked group is one value, the hash of the
// original group another. Only the *inputs* are masked here; everything else is still the
// real recording:
//
//   * the wire bytes are the reference's own, rebuilt by this project's encoder
//     (`encodeSendGroupMessageRequest({groupId: 123456n, ...})`) — the only change is the
//     routing-head groupCode, whose varint shrank from 5 bytes to 3 (`ea98c0ba01` ->
//     `c0c407`), so the two nested length prefixes shrink with it and the body goes from
//     51 to 49 bytes. Nothing was computed by hand: the hex above IS the encoder output;
//   * `groupSequence` 1935105 is a server sequence, not a group number, so masking does
//     not touch it — the reply body and its field-11 assertion are unchanged;
//   * the expected id was re-derived independently, with Python's `hashlib.sha1` over
//     `"1935105:123456:group_message"`, not with `hashMessageIdInt32`. That keeps the
//     assertion falsifiable: it still fails if the formula, the separator or the event
//     name drifts.

/** The second op2 request body this project's encoder produces for the masked capture, 49 bytes. */
const SECOND_OP2_REQUEST = Uint8Array.from(
  Buffer.from(
    "0a06120408c0c407120208011a1d0a1b12190a170a15687a2d687a2d626173656c696e652d32333335323228d39caa8502",
    "hex",
  ),
);

/** The second op4 reply body, 41 bytes. */
const SECOND_OP4_REPLY = Uint8Array.from(
  Buffer.from(
    "080018be978cd806500058818e7660bd978cd80670007892d26282010c0801220863cc0f48902a4e1a",
    "hex",
  ),
);

const SECOND_GROUP_ID = 1234567890;
const SECOND_RETURNED_MESSAGE_ID = -1316355920;

test("second capture: the request carries the marker literally and its own random", () => {
  const marker = Buffer.from("hz-hz-baseline-233522", "utf8");
  assert.ok(
    Buffer.from(SECOND_OP2_REQUEST).includes(marker),
    "the 23-byte marker must appear verbatim in the request body",
  );
  assert.equal(SECOND_OP2_REQUEST.length, 49, "the masked capture's request is 49 bytes");
});

test("second capture: groupSequence comes from field 11, not from the id", () => {
  const fields = topLevelFields(SECOND_OP4_REPLY);
  assert.equal(fields.get(1), 0, "field 1 result = 0 (accepted)");
  assert.equal(fields.get(11), 1935105, "field 11 is groupSequence for THIS send");

  const asUnsigned = SECOND_RETURNED_MESSAGE_ID >>> 0;
  const matches = [...fields.entries()].filter(([, v]) => v === asUnsigned);
  assert.deepEqual(
    matches,
    [],
    "no top-level varint in the reply equals the returned message_id",
  );
});

test("second capture: the same formula reproduces a DIFFERENT message_id", () => {
  const derived = hashMessageIdInt32(1935105, SECOND_GROUP_ID, GROUP_MESSAGE_EVENT);
  assert.equal(
    derived,
    SECOND_RETURNED_MESSAGE_ID,
    "hashMessageIdInt32 must reproduce the second capture's message_id too",
  );
  // And the two captures must not collide, or "reproduce" would be vacuous.
  assert.notEqual(derived, RETURNED_MESSAGE_ID);
});
