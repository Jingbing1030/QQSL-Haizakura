// Regression test over REAL captured op6 (`MsgPush`) wire bytes.
//
// ===========================================================================
// EVERY BYTE DECODED HERE IS REAL. IT CAME FROM THE REFERENCE IMPLEMENTATION.
// ===========================================================================
//
// The fixtures live in `ts/src/bridge/fixtures/real-op6-captures.ts` and were
// copied verbatim out of `@snowluma/runtime` 2.4.0's own `docker logs`
// (`TRACE [Bridge.Packet] packet_push`), UIN 10001, all retCode=0, all
// fromClient=false. The transcription is recorded in
// `work/captures/real-op6-samples.md`.
//
// DO NOT CONFUSE THIS FILE WITH `msg-push-pipeline.test.ts`.
//
//   * `msg-push-pipeline.test.ts`  — SYNTHETIC. Hand-assembled bytes, field by
//     field, from the reference's own field numbers. Its header says so and
//     should keep saying so: it is the decoder *unit* test, and hand-built
//     bytes fail on exactly the field that drifted.
//   * `msg-push-real-capture.test.ts` (this file) — REAL. No byte here was
//     authored by us, so a pass cannot be an artefact of our own encoder.
//
// The two are complements. The synthetic suite proves the envelope path is
// wired; this suite proves the reference and this decoder agree on traffic
// neither of us wrote.
//
// ---------------------------------------------------------------------------
// What a green run proves
// ---------------------------------------------------------------------------
//
// DECODE PARITY ON REAL INPUT. The reference parsed these exact bytes and
// produced the field values asserted below; so does this decoder. That is the
// strongest evidence the project has for the op6 receive path, because the
// input is not ours to bend.
//
// ---------------------------------------------------------------------------
// What a green run proves NOTHING about — read this before citing it
// ---------------------------------------------------------------------------
//
//   * **op2 send success.** There is no `packet_send` and no `packet_terminal`
//     evidence in the capture log for any of these bytes. Decoding an inbound
//     push is silent about outbound send, and no assertion here may be read as
//     send evidence. There is deliberately not one assertion about send/op2 in
//     this file.
//   * **The meaning of the unknown tags.** The reference itself drops
//     `elem.generalFlags` tags 10, 12, 13 and 19 (`[MsgPush.UnknownElement]
//     wire element ignored unknownTag=... path=elem.generalFlags`), plus
//     `RichText` tag 1 and `Elem` tag 9. We match it — skip, keep going — so
//     this file can only show *that we agree about what to ignore*. It cannot
//     show what those tags mean, and it does not claim to.
//
// ---------------------------------------------------------------------------
// A discrepancy in the capture log, asserted rather than silently reconciled
// ---------------------------------------------------------------------------
//
// The capture log names each sample by `seq=` — e.g. `seq=2626218455`. That is
// the log line's `seqId`, i.e. `packet.seq` ← the op6 frame header `value0`, a
// per-connection monotonic counter the reference only ever logs
// (`hook-session.ts:712`; `docs/payload-recv-format.md` §6.8). It is NOT
// `ContentHead.sequence` and NOT `ContentHead.msgId` — all three are different
// numbers in every capture.
//
// The last test in this file pins that difference down. If anyone ever
// "tidies" a fixture so `seqId` equals `sequence`, that test fails, because the
// disagreement is a property of the captured bytes, not a typo.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MSG_PUSH_CMD,
  decodeMsgPushContext,
  decodeMsgPushPacket,
  type MsgPushPipelineLogger,
} from "../src/bridge/msg-push-pipeline.js";
import type { IncomingPacket } from "../src/bridge/packet-pipeline.js";
import { EMPTY_IDENTITY, type GroupMessageEvent, type MsgPushEvent } from "../src/msg-push.js";
import {
  decodeElem,
  decodeExtraInfo,
  decodeRichText,
  type Elem,
  type ExtraInfo,
} from "../src/msg-push-fields.js";
import {
  CAPTURE_137_SEQ2626218455,
  CAPTURE_138_SEQ2564024904,
  CAPTURE_402_EXPECTED_SEGMENT_COUNT,
  CAPTURE_402_EXPECTED_TEXT,
  CAPTURE_402_SEQ2526989626,
  CAPTURE_402_UNKNOWN_GENERAL_FLAGS_TAGS,
  REAL_OP6_CAPTURES,
  hexToBytes,
  sliceUtf8,
  type RealOp6Capture,
} from "../src/bridge/fixtures/real-op6-captures.js";

/**
 * Decode one protobuf tag varint starting at `offset`.
 *
 * Returns the raw tag value and how many bytes it occupied. Needed because a
 * field number above 15 with wire type 2 exceeds 127, so its tag is a two-byte
 * varint — field 19 wire type 2 is `9a 01`. Assuming one byte silently
 * mis-reports every such tag.
 */
function readTagVarint(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let shift = 0;
  let i = offset;
  for (;;) {
    const byte = bytes[i];
    assert.notEqual(byte, undefined, `truncated tag varint at offset ${offset}`);
    i += 1;
    value |= (byte! & 0x7f) << shift;
    if ((byte! & 0x80) === 0) return [value >>> 0, i - offset];
    shift += 7;
    assert.ok(shift < 35, `tag varint at ${offset} is absurdly long`);
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

/** A real capture as the `IncomingPacket` the pipeline actually receives. */
function packetOf(capture: RealOp6Capture, seq = 1): IncomingPacket {
  return {
    seq,
    error: capture.retCode,
    cmd: MSG_PUSH_CMD,
    uin: capture.uin,
    body: capture.bytes,
  };
}

/**
 * Collects drop/warn lines. Used only to prove a *real* capture did not take
 * the "rejected before dispatch" path — a decoder that silently swallows a real
 * packet would otherwise pass every value assertion by producing nothing.
 */
function recordingLogger(): MsgPushPipelineLogger & { readonly lines: string[] } {
  const lines: string[] = [];
  const render = (message: string, args: readonly unknown[]): string =>
    [message, ...args.map((arg) => String(arg))].join(" ");
  return {
    lines,
    debug: (message, ...args) => { lines.push(`debug ${render(message, args)}`); },
    warn: (message, ...args) => { lines.push(`warn ${render(message, args)}`); },
  };
}

/** The single `group_message` event of a capture, or a failure naming what came back. */
function expectSingleGroupMessage(capture: RealOp6Capture): GroupMessageEvent {
  const events: MsgPushEvent[] = decodeMsgPushPacket(packetOf(capture));
  assert.equal(
    events.length,
    1,
    `${capture.id} must decode to exactly one event, got ${events.length} (${JSON.stringify(events.map((e) => e.kind))})`,
  );
  const event = events[0]!;
  if (event.kind !== "group_message") {
    throw new Error(`${capture.id}: expected kind "group_message", got "${event.kind}"`);
  }
  return event;
}

// ===========================================================================
// Fixture integrity — the captures are real, complete, and self-consistent
// ===========================================================================

test("fixtures: all three real captures are present and match their logged length", () => {
  assert.equal(REAL_OP6_CAPTURES.length, 3, "the capture log records exactly three hex bodies");

  for (const capture of REAL_OP6_CAPTURES) {
    assert.equal(
      capture.bytes.length,
      capture.byteLength,
      `${capture.id}: hex decodes to ${capture.bytes.length} bytes but the log line says length=${capture.byteLength}`,
    );
    // Provenance the log line states for every MsgPush it printed.
    assert.equal(capture.retCode, 0, `${capture.id}: every capture in the log has retCode=0`);
    assert.equal(capture.fromClient, false, `${capture.id}: every capture in the log has fromClient=false`);
    assert.equal(capture.uin, "10001", `${capture.id}: captured from UIN 10001`);
    assert.ok(capture.seqId > 0, `${capture.id}: a real frame seqId is positive`);
  }

  // The three lengths the capture log records, in order.
  assert.deepEqual(REAL_OP6_CAPTURES.map((c) => c.bytes.length), [137, 138, 402]);
});

test("fixtures: every recorded literal really is at its recorded offset", () => {
  // This is what keeps the load-bearing text assertion honest. If an offset were
  // wrong, the "text contains 流行不了" test below would still pass (the string
  // is in the bytes somewhere) while the offset annotation — the thing a reader
  // uses to re-derive the decode by hand — quietly lied.
  for (const capture of REAL_OP6_CAPTURES) {
    assert.ok(capture.literals.length > 0, `${capture.id}: at least one literal is recorded`);
    for (const literal of capture.literals) {
      const atOffset = sliceUtf8(capture.bytes, literal.offset, literal.length);
      assert.equal(
        atOffset,
        literal.utf8,
        `${capture.id} ${literal.path} @${literal.offset}: bytes say ${JSON.stringify(atOffset)}, fixture says ${JSON.stringify(literal.utf8)}`,
      );
      assert.equal(
        Buffer.from(literal.utf8, "utf8").length,
        literal.length,
        `${capture.id} ${literal.path}: "${literal.utf8}" is ${Buffer.from(literal.utf8, "utf8").length} UTF-8 bytes, fixture says ${literal.length}`,
      );
    }
  }
});

test("fixtures: hexToBytes rejects a mistranscribed hex string", () => {
  // A dropped or doubled nibble is the realistic transcription error, and it must
  // fail here rather than decode to something plausible one byte short.
  assert.throws(() => hexToBytes("abc"), /odd length/);
  assert.throws(() => hexToBytes("zz"), /non-hex/);
  assert.deepEqual(Array.from(hexToBytes("0aff")), [0x0a, 0xff]);
});

// ===========================================================================
// Context decode — the envelope, on every real capture
// ===========================================================================

test("context: every real capture decodes to a non-empty PushContext with the exact head it encodes", () => {
  for (const capture of REAL_OP6_CAPTURES) {
    const logger = recordingLogger();
    const ctx = decodeMsgPushContext({ uin: capture.uin, body: capture.bytes }, EMPTY_IDENTITY, logger);

    assert.ok(ctx, `${capture.id}: real bytes must build a context, not null`);
    assert.deepEqual(
      logger.lines,
      [],
      `${capture.id}: a real capture must not take the "rejected before dispatch" path (${logger.lines.join("; ")})`,
    );

    // The values the bytes encode, at the offsets the fixture records. These are
    // not guesses: each is a varint read out of the `ContentHead` payload.
    assert.equal(ctx.head.msgType, capture.expected.head.msgType, `${capture.id} ContentHead.msgType @${capture.offsets["ContentHead.msgType"]}`);
    assert.equal(ctx.head.subType, capture.expected.head.subType, `${capture.id} ContentHead.subType @${capture.offsets["ContentHead.subType"]}`);
    assert.equal(ctx.head.c2cCmd, capture.expected.head.c2cCmd, `${capture.id} ContentHead.c2cCmd @${capture.offsets["ContentHead.c2cCmd"]}`);
    assert.equal(ctx.head.msgId, capture.expected.head.msgId, `${capture.id} ContentHead.msgId @${capture.offsets["ContentHead.msgId"]}`);
    assert.equal(ctx.head.sequence, capture.expected.head.sequence, `${capture.id} ContentHead.sequence @${capture.offsets["ContentHead.sequence"]}`);
    assert.equal(ctx.head.timestamp, capture.expected.head.timestamp, `${capture.id} ContentHead.timestamp @${capture.offsets["ContentHead.timestamp"]}`);

    // `ntMsgSeq` is field 11 and is ABSENT from all three captures. 0 by
    // absence, not a 0 on the wire — the distinction matters for the C2C
    // sequence-authority decision downstream.
    assert.equal(ctx.head.ntMsgSeq, capture.expected.head.ntMsgSeq, `${capture.id}: ContentHead.ntMsgSeq is absent (field 11)`);

    // Response head.
    assert.equal(ctx.fromUin, capture.expected.fromUin, `${capture.id} ResponseHead.fromUin @${capture.offsets["ResponseHead.fromUin"]}`);
    assert.equal(ctx.fromUid, capture.expected.fromUid, `${capture.id} ResponseHead.fromUid @${capture.offsets["ResponseHead.fromUid"]}`);
    assert.equal(ctx.responseHead?.toUin, capture.expected.toUin, `${capture.id} ResponseHead.toUin @${capture.offsets["ResponseHead.toUin"]}`);

    // Group fields are present only on the group sample.
    assert.equal(ctx.responseHead?.grp?.groupUin ?? null, capture.expected.groupUin, `${capture.id} ResponseGrp.groupUin`);
    assert.equal(ctx.responseHead?.grp?.memberCard ?? null, capture.expected.memberCard, `${capture.id} ResponseGrp.memberCard`);
    assert.equal(ctx.responseHead?.grp?.groupName ?? null, capture.expected.groupName, `${capture.id} ResponseGrp.groupName`);

    // Live pushes are not historical (reference L143031 passes `false`).
    assert.equal(ctx.isHistorical, false, `${capture.id}: an op6 live push is not historical`);

    // selfUin comes from the frame, not the body.
    assert.equal(ctx.selfUin, 10001, `${capture.id}: selfUin is the account the frame arrived on`);

    // msgContent length distinguishes the C2C samples (opaque 12-byte payload,
    // no rich text) from the group sample (rich text, no msgContent).
    assert.equal(
      ctx.content.length,
      capture.expected.msgContentLength,
      `${capture.id}: MessageBody.msgContent is ${capture.expected.msgContentLength} bytes`,
    );
  }
});

test("context: the two C2C captures are 528/382 service pushes with no decodable rich text", () => {
  // Both are `Event0x210` subType 382, which the reference acknowledges and
  // drops (`unknownLog.debug("Event0x210 unknown subType=%d")` → `[]`). They
  // still build a context: the envelope decoded, there is just no event type
  // for it. This is the "decode parity" half of the claim — we agree with the
  // reference, including about the drop.
  for (const capture of [CAPTURE_137_SEQ2626218455, CAPTURE_138_SEQ2564024904]) {
    const ctx = decodeMsgPushContext({ uin: capture.uin, body: capture.bytes });
    assert.ok(ctx, `${capture.id}: context decodes`);
    assert.equal(ctx.head.msgType, 528, `${capture.id}: PkgType.Event0x210`);
    assert.equal(ctx.head.subType, 382, `${capture.id}: the subType the reference logs as unknown`);

    // No RichText.elems at all — the body is `richText { }` (empty) plus
    // msgContent. So there is nothing for the element decoder to produce.
    assert.equal(ctx.body?.richText?.elems?.length ?? 0, 0, `${capture.id}: RichText.elems is empty`);

    // And therefore no event. Asserting the empty result is what makes this a
    // parity test rather than a "we found a way to produce something" test.
    assert.deepEqual(decodeMsgPushPacket(packetOf(capture)), [], `${capture.id}: subType 382 is acknowledged and dropped`);
  }
});

// ===========================================================================
// The load-bearing test: real group text, decoded end to end
// ===========================================================================

test("group message: the 402-byte capture decodes to a real group_message with real text", () => {
  const event = expectSingleGroupMessage(CAPTURE_402_SEQ2526989626);

  // --- the strings that are literally present in the bytes ---------------
  //
  // Each of these is a UTF-8 run the fixture records an offset for, so a
  // failure here points at a byte range, not just at "the text was wrong".
  // `CAPTURE_402_EXPECTED_TEXT` is itself derived by slicing 199..246 out of
  // the captured bytes, so this comparison is wire-text vs decoder-text.
  const segments = event.elements;
  const texts = segments.flatMap((segment) => (segment.type === "text" ? [segment.text] : []));
  const decoded = texts.join("");

  assert.equal(
    decoded,
    CAPTURE_402_EXPECTED_TEXT,
    `402-byte capture: TextElem.str @199..246 must round-trip exactly`,
  );

  // The four clauses the task names, each asserted against the bytes it lives in
  // rather than against a hand-typed copy of the whole sentence.
  assert.ok(decoded.includes("流行不了"), `missing 「流行不了」 (@199..210) in ${JSON.stringify(decoded)}`);
  assert.ok(decoded.includes("这种要求一次都不该有"), `missing 「这种要求一次都不该有」 (@214..243) in ${JSON.stringify(decoded)}`);

  // The group card and the group name are separate fields, decoded from
  // separate nested messages — asserting them proves the ResponseGrp path, not
  // just the text path.
  assert.ok(
    event.senderNick.includes("郁金香."),
    `senderNick must contain 「郁金香.」 (ResponseGrp.memberCard @68..77), got ${JSON.stringify(event.senderNick)}`,
  );
  assert.ok(
    event.groupName.includes("ChatLuna "),
    `groupName must contain "ChatLuna " (ResponseGrp.groupName @84..101), got ${JSON.stringify(event.groupName)}`,
  );
  // The full group name, so a truncation at the space is caught too.
  assert.equal(event.groupName, "ChatLuna 闲聊群", "ResponseGrp.groupName @84..101 is the whole name");

  // --- exactly one segment, on purpose -----------------------------------
  //
  // Four `Elem`s are on the wire (@193, @247, @255, @379). Only the first is
  // text; the rest are generalFlags / extraInfo metadata, which the reference
  // never turns into a OneBot segment. A decoder that emitted them as segments
  // would still "contain the text" and would still show green for a sloppy
  // assertion — so the count is pinned.
  assert.equal(
    segments.length,
    CAPTURE_402_EXPECTED_SEGMENT_COUNT,
    `expected ${CAPTURE_402_EXPECTED_SEGMENT_COUNT} segment (text @193), got ${segments.length}: ${JSON.stringify(segments)}`,
  );
  assert.deepEqual(segments, [{ type: "text", text: "流行不了，这种要求一次都不该有。" }]);
});

test("group message: the 402-byte capture is a group_message with a plausible non-zero group and sender", () => {
  const event = expectSingleGroupMessage(CAPTURE_402_SEQ2526989626);

  assert.equal(event.kind, "group_message");

  // groupId is `ResponseGrp.groupUin` @54..59.
  assert.equal(event.groupId, 123456, "groupId is ResponseGrp.groupUin @54..59");
  assert.notEqual(event.groupId, 0, "a real group message has a non-zero groupId");
  assert.ok(Number.isSafeInteger(event.groupId), `groupId ${event.groupId} must be a safe integer`);
  assert.ok(event.groupId > 0 && event.groupId <= 0xffff_ffff, `groupId ${event.groupId} must fit the u32 wire field`);

  // senderUin is `ResponseHead.fromUin` @5..10.
  assert.equal(event.senderUin, 10002, "senderUin is ResponseHead.fromUin @5..10");
  assert.notEqual(event.senderUin, 0, "a real group message has a non-zero senderUin");
  // A real QQ UIN; the bot account is 10001, so this is a *different* member.
  assert.notEqual(event.senderUin, 10001, "the sender is another member, not the bot itself");
  assert.ok(Number.isSafeInteger(event.senderUin), `senderUin ${event.senderUin} must be a safe integer`);

  // Sequence / msgId / time, straight off the ContentHead.
  assert.equal(event.msgSeq, 1933136, "msgSeq is ContentHead.sequence @111..114");
  assert.equal(event.msgId, 157460581, "msgId is ContentHead.msgId @106..110, below the 31-bit mask so unmasked");
  assert.equal(event.time, 1795328836, "time is ContentHead.timestamp @115..120");
  assert.equal(event.selfUin, 10001, "selfUin is the frame's uin");
});

test("group message: the 402-byte capture's text is one segment, not several split ones", () => {
  // The sentence contains a full-width comma (U+FF0C) at @211..213. If the
  // decoder split on it, the "contains 流行不了" assertion above would still
  // pass — so the join is asserted explicitly too.
  const event = expectSingleGroupMessage(CAPTURE_402_SEQ2526989626);
  const texts = event.elements.flatMap((segment) => (segment.type === "text" ? [segment.text] : []));
  assert.equal(texts.length, 1, `the sentence must decode as one text segment, got ${texts.length}`);
  assert.ok(texts[0]!.includes("，"), "the full-width comma is inside the single segment, not a split point");
  // ...and that it is the byte range at @199..246, i.e. 48 UTF-8 bytes.
  assert.equal(Buffer.from(texts[0]!, "utf8").length, 48, "TextElem.str @199..246 is 48 bytes");
});

// ===========================================================================
// Unknown element tags — must be skipped, must not disturb their neighbours
// ===========================================================================

test("unknown tags: the four generalFlags tags the reference drops do not throw and do not break neighbours", () => {
  // `RichText.elems[2]` @255 is a `generalFlags` element whose entire payload is
  // four tags the reference logs as unknown (10, 12, 13, 19). The load-bearing
  // property is that decoding it neither throws nor perturbs the text element
  // before it (@193) or the extraInfo element after it (@379).
  const capture = CAPTURE_402_SEQ2526989626;

  // 1. It does not throw.
  let richText: ReturnType<typeof decodeRichText> | undefined;
  assert.doesNotThrow(() => {
    richText = decodeRichText(capture.bytes, capture.offsets["MessageBody.richText"]! + 3, capture.bytes.length);
  }, "RichText with unknown-tagged elements must decode without throwing");

  const elems = (richText as { elems?: Elem[] }).elems;
  assert.ok(elems, "RichText.elems decodes");
  assert.equal(elems!.length, 4, "all four wire elements are preserved as elems, including the unknown-tagged ones");

  // 2. The unknown-tagged element decodes to *no known field* — every known
  //    `GeneralFlags` member is null, because its payload is only unknown tags.
  const generalFlagsElem = elems![2]!;
  const flags = generalFlagsElem.generalFlags;
  assert.ok(flags, "elems[2] is the generalFlags element @257..378");
  for (const [name, value] of Object.entries(flags!)) {
    assert.equal(
      value,
      null,
      `GeneralFlags.${name} must be null: the payload is entirely unknown tags (10/12/13/19), so no known field is present`,
    );
  }

  // 3. Each unknown tag really is at the offset the fixture records, with the
  //    wire type the reference's own log reported. This is what makes "unknown
  //    tags were skipped" a checkable claim instead of a comment.
  for (const unknown of CAPTURE_402_UNKNOWN_GENERAL_FLAGS_TAGS) {
    // Tags are VARINTS, not single bytes. Fields 10/12/13 encode to 0x50/0x60/0x68
    // (one byte), but field 19 with wire type 2 is 154 = 0x9a, which needs a
    // continuation byte: `9a 01`. Hard-coding "one byte" here was wrong and the
    // assertion below now decodes the varint properly.
    const [tagValue, tagBytes] = readTagVarint(capture.bytes, unknown.tagOffset);
    assert.equal(
      tagValue >>> 3,
      unknown.field,
      `unknown tag @${unknown.tagOffset} decodes to field ${unknown.field}`,
    );
    assert.equal(
      tagValue & 0x07,
      unknown.wireType,
      `unknown tag ${unknown.field} @${unknown.tagOffset} is wire type ${unknown.wireType}`,
    );
    if (unknown.payloadLength !== null) {
      // Wire type 2: a length varint follows the tag, at tagOffset + tagBytes.
      assert.equal(
        capture.bytes[unknown.tagOffset + tagBytes]!,
        unknown.payloadLength,
        `unknown tag ${unknown.field} @${unknown.tagOffset} declares a ${unknown.payloadLength}-byte payload`,
      );
    }
  }

  // 4. The neighbours are intact: the text element before it and the
  //    extraInfo element after it both decoded to their real values.
  assert.equal(elems![0]!.text?.str, new TextDecoder().decode(capture.bytes.subarray(199, 247)), "elems[0] text @199..246 survives the unknown element before it");
  // `ExtraInfo.nick` is field 1, `bytes` (wire type 2). The reference declares
  // `_f0 = null` and assigns `data.slice(offset, offset + _len)` only when the
  // tag is present (`reference/index.mjs:127598` → `:127631` `case 10` →
  // `:127647` → emitted as `"nick": _f0` at `:127883`). So the field's type is
  // `Uint8Array | null` (`msg-push-fields.ts:174`, spec at `:1227`) and NEVER
  // `undefined` — an absent field is `null`, and this capture does NOT take the
  // absent case: bytes @384 are `0a 0a`, i.e. field 1 / wire type 2 / length 10.
  //
  // Asserting `undefined` here was the reported defect: it contradicted the line
  // right below it and would fail on correct decoding. The replacement pins the
  // three things that make "the field is there and is the right field" checkable
  // instead of assumed: the instance type, the exact length, and the exact bytes.
  const extraInfo = elems![3]!.extraInfo;
  assert.ok(extraInfo, "elems[3] @379 carries the extraInfo element @381");
  const nick = extraInfo.nick;
  assert.ok(
    nick instanceof Uint8Array,
    `ExtraInfo.nick must be Uint8Array (never undefined/null here): field 1 IS present at @384, got ${nick === null ? "null" : typeof nick}`,
  );
  // Bytes @384..385 are the tag + length of this very field; asserting them makes
  // the "present, length 10, payload @386..396" claim a property of the capture.
  assert.equal(capture.bytes[384], 0x0a, "ExtraInfo.nick tag @384 is 0x0a = field 1, wire type 2");
  assert.equal(capture.bytes[385], 10, "ExtraInfo.nick declares a 10-byte payload @385");
  assert.equal(nick.length, 10, "ExtraInfo.nick is 10 bytes");
  assert.deepEqual(
    Array.from(nick),
    [0xe9, 0x83, 0x81, 0xe9, 0x87, 0x91, 0xe9, 0xa6, 0x99, 0x2e],
    "ExtraInfo.nick @386..395 is exactly the captured UTF-8 「郁金香.」",
  );
  assert.equal(Buffer.from(nick).toString("hex"), "e98381e98791e9a6992e", "ExtraInfo.nick hex @386..395");
  assert.deepEqual(
    Buffer.from(nick),
    Buffer.from(capture.bytes.subarray(386, 396)),
    "ExtraInfo.nick is the wire slice @386..395, not a re-encode",
  );
  assert.equal(new TextDecoder().decode(nick), "郁金香.", "ExtraInfo.nick @386..395 survives the unknown element before it");
  assert.equal(elems![3]!.extraInfo!.level, 1, "elems[3] ExtraInfo.level @396 is 1");
  assert.equal(elems![3]!.extraInfo!.groupMask, 1, "elems[3] ExtraInfo.groupMask @398 is 1");

  // 5. And end to end: the message still decodes to its one real segment.
  const event = expectSingleGroupMessage(capture);
  const texts = event.elements.flatMap((segment) => (segment.type === "text" ? [segment.text] : []));
  assert.deepEqual(texts, ["流行不了，这种要求一次都不该有。"], "the unknown-tagged elements contribute no segment and swallow no text");
});

test("ExtraInfo.nick: the field is `Uint8Array | null`, and absent means null — never undefined", () => {
  // ---------------------------------------------------------------------
  // Why this test exists at all
  // ---------------------------------------------------------------------
  //
  // The presence half of this claim is asserted in the test above: that capture
  // DOES carry `nick` (@384, 10 bytes). Asserting presence alone cannot catch the
  // bug the type actually invites, though — a decoder that returns `undefined`
  // for an absent `bytes` field would still pass every presence assertion, and
  // `x === undefined` and `x === null` both look "empty" at a careless glance.
  //
  // The reference is unambiguous: every `_fN` starts at `null`
  // (`reference/index.mjs:127598`), and `"nick": _f0` (`:127883`) is emitted
  // verbatim. So an absent field is `null`. `msg-push-fields.ts:174` declares
  // exactly that (`nick: Uint8Array | null`), and `exactOptionalPropertyTypes` +
  // `strict` means `undefined` is not even assignable to it.
  //
  // The bytes below are REAL and already in the fixture: @396..402 is the tail of
  // this same captured `ExtraInfo`, i.e. fields 3 and 5 followed by the empty
  // field 7. Decoding it exercises the absent-`nick` path on capture bytes rather
  // than on bytes written by this test.
  const capture = CAPTURE_402_SEQ2526989626;

  // Pin the bytes first, so the assertions below cannot silently be about a
  // range that no longer means what the comment says.
  assert.deepEqual(
    Array.from(capture.bytes.subarray(396, 402)),
    [0x18, 0x01, 0x28, 0x01, 0x3a, 0x00],
    'ExtraInfo tail @396..402 is `level=1`, `groupMask=1`, `senderTitle=` empty — no field 1 tag',
  );
  for (let i = 396; i < 402; i += 1) {
    assert.notEqual(capture.bytes[i], 0x0a, `byte @${i} must not be a field-1 (nick) tag: this range has no nick`);
  }

  const tail = decodeExtraInfo(capture.bytes, 396, 402) as ExtraInfo;

  // The load-bearing assertion: absent bytes field decodes to `null`.
  //
  // (This is also why the checks below go through a local: `assert.equal` narrows
  // `tail.nick` to exactly `null`, so TypeScript itself proves `undefined` is not
  // in the declared type. Runtime checks on the narrowed value need the widened
  // copy.)
  const absentNick: Uint8Array | null = tail.nick;
  // Ordered deliberately: `assert.equal` narrows the variable to `null`, so the
  // `instanceof` check must run BEFORE it or TypeScript rejects the operand as
  // "not an object type" — which is itself proof the declared type is
  // `Uint8Array | null` with no `undefined` in it.
  assert.ok(!(absentNick instanceof Uint8Array), "with no field 1 on the wire there is no byte array to hand out");
  assert.notEqual(absentNick, undefined, "ExtraInfo.nick must NEVER be undefined — the type is `Uint8Array | null`");
  assert.equal(typeof absentNick, "object", 'null is an object; `undefined` would be typeof "undefined"');
  assert.equal(absentNick, null, "an absent ExtraInfo.nick must be null (reference:127883 `_f0` starts null at :127598)");

  // The fields that ARE present in the same range still decode, so "nick is null"
  // is a statement about nick alone and not about a decode that gave up.
  assert.equal(tail.level, 1, "ExtraInfo.level @396 is still 1");
  assert.equal(tail.groupMask, 1, "ExtraInfo.groupMask @398 is still 1");
  assert.deepEqual(
    tail.senderTitle,
    new Uint8Array(0),
    "ExtraInfo.senderTitle @400 is present-but-empty: a zero-length Uint8Array, NOT null — the mirror image of nick",
  );

  // And the contrast that makes both halves one claim: same field, same decoder,
  // present → Uint8Array(10); absent → null.
  const present = (decodeExtraInfo(capture.bytes, 384, 402) as ExtraInfo).nick;
  assert.ok(present instanceof Uint8Array && present.length === 10, "the same decoder returns 10 bytes when field 1 IS present");
  assert.notEqual(present, null, "present-vs-absent must produce different results, or the null assertion above proves nothing");
});

test("unknown tags: the Elem tag 9 and RichText tag 1 the reference drops do not throw either", () => {
  // `RichText` tag 1 @159 (32 bytes, containing the font name 宋体) and `Elem`
  // tag 9 @249 (4 bytes) are not in either implementation's schema. They are
  // dropped by both. Asserting the skip is what stops "we drop unknown tags"
  // from being an unverified claim.
  const capture = CAPTURE_402_SEQ2526989626;

  const richTextTag = capture.bytes[capture.offsets["RichText.field1"]!]!;
  assert.equal(richTextTag >> 3, 1, "RichText tag 1 @159 is field 1 — absent from RICH_TEXT_FIELDS (2/3/4)");
  assert.equal(richTextTag & 0x07, 2, "RichText tag 1 is length-delimited");
  // 宋体 sits inside that dropped payload @187..192 — proving the payload is
  // really an unknown sub-message and not text we are losing.
  assert.equal(sliceUtf8(capture.bytes, 187, 6), "宋体", "the font name inside the dropped RichText tag 1 payload");

  const elemTag9 = capture.bytes[capture.offsets["Elem.field9"]!]!;
  assert.equal(elemTag9 >> 3, 9, "Elem tag 9 @249 is field 9 — absent from ELEM_FIELDS");
  assert.equal(elemTag9 & 0x07, 2, "Elem tag 9 is length-delimited");

  // A bare Elem decode of that unknown field must not throw and must yield no
  // known field — the whole element is one unknown tag.
  const unknownElem = decodeElem(capture.bytes, 249, 255) as Elem;
  assert.equal(unknownElem.text, null, "Elem tag 9 does not decode as text");
  for (const [name, value] of Object.entries(unknownElem)) {
    assert.equal(value, null, `Elem.${name} must be null: the element is a single unknown tag 9`);
  }
});

// ===========================================================================
// The capture-log discrepancy: `seqId` is not `sequence` and not `msgId`
// ===========================================================================

test("capture log: `seqId` (frame value0) is a different number from ContentHead.sequence and msgId", () => {
  // The capture log labels these samples `seq=2626218455` etc. That value is
  // `packet.seq` — the op6 frame header's `value0`, a per-connection counter the
  // reference only ever logs. It is NOT the message sequence and NOT the
  // message id. All three differ in every capture.
  //
  // Recorded as an assertion because the alternative — quietly renaming the
  // samples or "correcting" a fixture — would hide a real fact about the wire.
  for (const capture of REAL_OP6_CAPTURES) {
    const ctx = decodeMsgPushContext({ uin: capture.uin, body: capture.bytes });
    assert.ok(ctx, `${capture.id}: context decodes`);

    assert.notEqual(
      capture.seqId,
      ctx.head.sequence,
      `${capture.id}: the log's seqId (${capture.seqId}) is the frame counter, not ContentHead.sequence (${ctx.head.sequence})`,
    );
    assert.notEqual(
      capture.seqId,
      ctx.head.msgId,
      `${capture.id}: the log's seqId (${capture.seqId}) is not ContentHead.msgId (${ctx.head.msgId})`,
    );
    // Nor is msgId the sequence: the reference's dedup key uses both, so an
    // accidental collapse of one onto the other would silently change dedup.
    assert.notEqual(
      ctx.head.msgId,
      ctx.head.sequence,
      `${capture.id}: ContentHead.msgId and ContentHead.sequence are distinct fields`,
    );
  }

  // The concrete numbers, so a reader can re-derive them from the log lines.
  assert.deepEqual(
    REAL_OP6_CAPTURES.map((capture) => ({
      bytes: capture.byteLength,
      seqId: capture.seqId,
      sequence: capture.expected.head.sequence,
      msgId: capture.expected.head.msgId,
    })),
    [
      { bytes: 137, seqId: 2626218455, sequence: 2014043859, msgId: 2014043858 },
      { bytes: 138, seqId: 2564024904, sequence: 1501433598, msgId: 1501433597 },
      { bytes: 402, seqId: 2526989626, sequence: 1933136, msgId: 157460581 },
    ],
    "the three captures' frame seqId / ContentHead.sequence / ContentHead.msgId",
  );
});

// ===========================================================================
// Scope guard — this file must never grow a send/op2 assertion
// ===========================================================================

test("scope: these captures are inbound op6 only, so nothing here can speak to op2 send", () => {
  // A tripwire, not a tautology. The capture log contains no `packet_send` and
  // no `packet_terminal` line, so the only honest claim these bytes support is
  // about decoding. If someone later adds a send assertion to this file, they
  // are citing evidence that does not exist — and this test is where that
  // should be noticed.
  for (const capture of REAL_OP6_CAPTURES) {
    assert.equal(
      packetOf(capture).cmd,
      "trpc.msg.olpush.OlPushService.MsgPush",
      `${capture.id}: an OlPush MsgPush command is inbound receive, not a send op`,
    );
    // The frame the capture arrived on has no request/response pairing of its
    // own; op6 is fire-and-forget inbound. `error` 0 means "accepted", not
    // "delivered".
    assert.equal(capture.retCode, 0, `${capture.id}: retCode 0 is an inbound disposition, not a send receipt`);
  }
});
