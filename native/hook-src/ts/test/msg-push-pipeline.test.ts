// Tests for the MsgPush envelope decoder (`bridge/msg-push-pipeline.ts`).
//
// ---------------------------------------------------------------------------
// EVERY BYTE BELOW IS SYNTHETIC. This is a decode test, not a capture test.
// ---------------------------------------------------------------------------
// The fixtures are assembled field-by-field with `tag`/`lenDelimited`/`uint32Field`
// from the field numbers this decoder actually consumes. Each field number is
// annotated with the `reference/index.mjs` line it is generated from (the same
// line the generated table in `ts/src/msg-push-fields.ts` cites). A passing run
// therefore proves: the op6 body reaches `PushMsg.message`, the content head and
// response head reach `PushContext`, `decodePush` dispatches on `msgType`, the
// survival filter keeps a notice and a non-blank message, and a malformed body is
// a silent drop. It proves NOTHING about real QQ traffic — no packet was
// captured, no container, no production path.
//
// Why synthetic rather than a recorded fixture: a capture would prove the field
// numbers *and* the message schema at once, so if one tag were wrong the test
// would fail for a reason it could not name. Hand-built bytes fail on exactly the
// field that drifted, which is the property a decoder test needs.

import assert from "node:assert/strict";
import { test } from "node:test";
import { format as nodeFormat } from "node:util";

import {
  MSG_PUSH_CMD,
  createMsgPushHandler,
  decodeMsgPushContext,
  decodeMsgPushPacket,
  registerMsgPushHandler,
  withSysMsgDedup,
  type MsgPushPipelineLogger,
} from "../src/bridge/msg-push-pipeline.js";
import { SysMsgDedup } from "../src/bridge/sysmsg-dedup.js";
import { IncomingPacketPipeline, type IncomingPacket } from "../src/bridge/packet-pipeline.js";
import { EMPTY_IDENTITY, type Identity, type MsgPushEvent } from "../src/msg-push.js";

// ===========================================================================
// Wire helpers — varints and tags only, no schema
// ===========================================================================

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function varint(value: number): Uint8Array {
  assert.ok(Number.isSafeInteger(value) && value >= 0, `varint needs a non-negative safe integer, got ${value}`);
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
  return Uint8Array.from(bytes);
}

/**
 * `field << 3 | wireType`. Written as a varint, not a byte: from field 16 upward
 * the tag itself exceeds one byte (field 26 -> 210), and a single-byte write makes
 * the reader treat the high bit as a continuation and desynchronise.
 */
function tag(field: number, wireType: number): Uint8Array {
  return varint(field * 8 + wireType);
}

/** Wire type 0. */
function uint32Field(field: number, value: number): Uint8Array {
  return concat([tag(field, 0), varint(value)]);
}

/** Wire type 2, length-delimited. */
function delimited(field: number, payload: Uint8Array): Uint8Array {
  return concat([tag(field, 2), varint(payload.length), payload]);
}

function stringField(field: number, value: string): Uint8Array {
  return delimited(field, utf8(value));
}

// ===========================================================================
// Envelope builders — the field numbers this decoder consumes, all grounded
// ===========================================================================

/**
 * `PushMsg { message = 1; status = 3 }`.
 * reference/index.mjs:136053 (`case 10:` -> field 1, `case 24:` -> field 3).
 */
function pushMsg(message: Uint8Array, status?: number): Uint8Array {
  return status === undefined
    ? delimited(1, message)
    : concat([delimited(1, message), uint32Field(3, status)]);
}

/**
 * `PushMsgBody { responseHead = 1; contentHead = 2; body = 3 }`.
 * reference/index.mjs:122602 / L122622 / L122642.
 */
function pushMsgBody(parts: { responseHead?: Uint8Array; contentHead?: Uint8Array; body?: Uint8Array }): Uint8Array {
  // `contentHead` is optional on purpose: one malformed case must produce a
  // `PushMsgBody` without one, so `buildContextFromMessage` returns null
  // (reference/index.mjs:143049 `if (!msg.contentHead) return null`).
  return concat([
    ...(parts.responseHead ? [delimited(1, parts.responseHead)] : []),
    ...(parts.contentHead ? [delimited(2, parts.contentHead)] : []),
    ...(parts.body ? [delimited(3, parts.body)] : []),
  ]);
}

/**
 * `ContentHead`:
 *   msgType = 1 (L123230), subType = 2 (L123248), c2cCmd = 3 (L123266),
 *   msgId = 4 (L123284), sequence = 5 (L123302), timestamp = 6 (L123320),
 *   ntMsgSeq = 11 (L123354).
 */
function contentHead(parts: {
  msgType: number;
  subType?: number;
  c2cCmd?: number;
  msgId?: number;
  sequence?: number;
  timestamp?: number;
  ntMsgSeq?: number;
}): Uint8Array {
  return concat([
    uint32Field(1, parts.msgType),
    ...(parts.subType === undefined ? [] : [uint32Field(2, parts.subType)]),
    ...(parts.c2cCmd === undefined ? [] : [uint32Field(3, parts.c2cCmd)]),
    ...(parts.msgId === undefined ? [] : [uint32Field(4, parts.msgId)]),
    ...(parts.sequence === undefined ? [] : [uint32Field(5, parts.sequence)]),
    ...(parts.timestamp === undefined ? [] : [uint32Field(6, parts.timestamp)]),
    ...(parts.ntMsgSeq === undefined ? [] : [uint32Field(11, parts.ntMsgSeq)]),
  ]);
}

/**
 * `ResponseHead`:
 *   fromUin = 1 (L122738), fromUid = 2 (L122756), toUin = 5 (L122812),
 *   grp = 8 (L122870).
 */
function responseHead(parts: {
  fromUin?: number;
  fromUid?: string;
  toUin?: number;
  grp?: Uint8Array;
}): Uint8Array {
  return concat([
    ...(parts.fromUin === undefined ? [] : [uint32Field(1, parts.fromUin)]),
    ...(parts.fromUid === undefined ? [] : [stringField(2, parts.fromUid)]),
    ...(parts.toUin === undefined ? [] : [uint32Field(5, parts.toUin)]),
    ...(parts.grp ? [delimited(8, parts.grp)] : []),
  ]);
}

/**
 * `ResponseGrp`:
 *   groupUin = 1 (L123074), memberName = 2 (L123092),
 *   memberCard = 4 (L123112), groupName = 7 (L123132).
 */
function responseGrp(parts: {
  groupUin: number;
  memberName?: string;
  memberCard?: string;
  groupName?: string;
}): Uint8Array {
  return concat([
    uint32Field(1, parts.groupUin),
    ...(parts.memberName === undefined ? [] : [stringField(2, parts.memberName)]),
    ...(parts.memberCard === undefined ? [] : [stringField(4, parts.memberCard)]),
    ...(parts.groupName === undefined ? [] : [stringField(7, parts.groupName)]),
  ]);
}

/**
 * `MessageBody { richText = 1 (L123464); msgContent = 2 (L123484) }`.
 */
function messageBody(parts: { richText?: Uint8Array; msgContent?: Uint8Array }): Uint8Array {
  return concat([
    ...(parts.richText ? [delimited(1, parts.richText)] : []),
    ...(parts.msgContent ? [delimited(2, parts.msgContent)] : []),
  ]);
}

/**
 * `RichText { elems = 2 (L123574); notOnlineFile = 3; ptt = 4 }`.
 * Field 1 is unused — the generated table's first documented surprise.
 */
function richText(elems: readonly Uint8Array[]): Uint8Array {
  return concat(elems.map((elem) => delimited(2, elem)));
}

/**
 * `Elem` — only the two members these fixtures need:
 *   text = 1 (L123717), face = 2 (L123737).
 */
function textElem(value: string): Uint8Array {
  // TextElem.str = 1 (L124309)
  return delimited(1, stringField(1, value));
}

function faceElem(index: number): Uint8Array {
  // Elem.face = 2 (L123737); FaceElem.index = 1 (L124503)
  return delimited(2, uint32Field(1, index));
}

/** A complete op6 packet. */
function packet(body: Uint8Array, uin = "12345", seq = 1): IncomingPacket {
  return { seq, error: 0, cmd: MSG_PUSH_CMD, uin, body };
}

/**
 * Collects the drop/warn lines so a test can assert on *why* something was empty.
 *
 * The real logger formats printf-style (`createLogger` in `onebot/log.ts` uses
 * `node:util`'s `format`), so the stub formats too — otherwise an assertion would
 * be matching against a raw `%d` template rather than the message a reader sees.
 */
function recordingLogger(): MsgPushPipelineLogger & { readonly lines: string[] } {
  const lines: string[] = [];
  const format = (message: string, args: readonly unknown[]): string =>
    nodeFormat(message, ...args);
  return {
    lines,
    debug: (message, ...args) => { lines.push(`debug ${format(message, args)}`); },
    warn: (message, ...args) => { lines.push(`warn ${format(message, args)}`); },
  };
}

// ===========================================================================
// Context: envelope -> PushContext
// ===========================================================================

test("context: envelope field 1 carries the PushMsgBody", () => {
  const body = pushMsg(pushMsgBody({
    contentHead: contentHead({ msgType: 82, sequence: 7, timestamp: 1700000000 }),
  }));
  const ctx = decodeMsgPushContext({ uin: "12345", body });
  assert.ok(ctx);
  assert.equal(ctx.head.msgType, 82);
  assert.equal(ctx.head.sequence, 7);
  assert.equal(ctx.head.timestamp, 1700000000);
  assert.equal(ctx.selfUin, 12345, "selfUin comes from the packet's own uin");
  // Live pushes are not historical; only the history fetchers pass `true`
  // (reference/index.mjs:143031 `buildContext` passes false).
  assert.equal(ctx.isHistorical, false);
});

test("context: a non-numeric uin degrades to 0 instead of NaN", () => {
  // reference/index.mjs:143035 — parseInt + isNaN.
  const body = pushMsg(pushMsgBody({ contentHead: contentHead({ msgType: 82 }) }));
  const ctx = decodeMsgPushContext({ uin: "not-a-number", body });
  assert.ok(ctx);
  assert.equal(ctx.selfUin, 0);
});

test("context: empty body and a status-only PushMsg produce null", () => {
  assert.equal(decodeMsgPushContext({ uin: "12345", body: new Uint8Array(0) }), null);
  // `PushMsg.status` present but field 1 `message` absent (L136073 puts status at field 3).
  const statusOnly = uint32Field(3, 1);
  assert.equal(decodeMsgPushContext({ uin: "12345", body: statusOnly }), null);
});

// ===========================================================================
// Group message
// ===========================================================================

test("group message: a text elem decodes into a group_message event", () => {
  const body = pushMsg(pushMsgBody({
    // PushMsgBody.responseHead = 1
    responseHead: responseHead({
      fromUin: 10001,
      // ResponseHead.grp = 8
      grp: responseGrp({
        groupUin: 777,
        memberName: "sender-nick",
        memberCard: "sender-card",
        groupName: "group-name",
      }),
    }),
    // PushMsgBody.contentHead = 2
    contentHead: contentHead({
      msgType: 82,          // PkgType.GroupMessage (L143081)
      subType: 0,
      msgId: 0x81234567,    // above the 31-bit mask, to exercise `& 2147483647`
      sequence: 4242,
      timestamp: 1700000123,
    }),
    // PushMsgBody.body = 3
    body: messageBody({ richText: richText([textElem("hello 世界")]) }),
  }));

  const events = decodeMsgPushPacket(packet(body));
  assert.equal(events.length, 1);
  const event = events[0]!;
  if (event.kind !== "group_message") throw new Error(`expected group_message, got ${event.kind}`);

  assert.equal(event.time, 1700000123);
  assert.equal(event.selfUin, 12345);
  assert.equal(event.senderUin, 10001);
  assert.equal(event.msgSeq, 4242);
  assert.equal(event.msgId, 0x81234567 & 2147483647, "msgId is masked to a positive 31-bit id");
  assert.equal(event.groupId, 777, "group id comes from ResponseHead.grp.groupUin");
  assert.equal(event.senderNick, "sender-nick");
  assert.equal(event.groupName, "group-name");
  // With no roster record the wire card is only kept when it differs from the
  // nickname (msg-push.ts:1979), and senderCard stays the member record's "" here.
  assert.equal(event.senderCard, "");
  assert.deepEqual(event.elements, [{ type: "text", text: "hello 世界" }]);
});

test("group message: a face elem beside the text becomes a face segment", () => {
  const body = pushMsg(pushMsgBody({
    responseHead: responseHead({ fromUin: 10001, grp: responseGrp({ groupUin: 777 }) }),
    contentHead: contentHead({ msgType: 82, sequence: 9, timestamp: 1700000999 }),
    body: messageBody({ richText: richText([textElem("a"), faceElem(359)]) }),
  }));
  const events = decodeMsgPushPacket(packet(body));
  const event = events[0]!;
  if (event.kind !== "group_message") throw new Error(`expected group_message, got ${event.kind}`);
  assert.deepEqual(event.elements, [{ type: "text", text: "a" }, { type: "face", faceId: 359 }]);
});

test("group message: the roster fills senderCard and senderRole", () => {
  const identity: Identity = {
    ...EMPTY_IDENTITY,
    findGroupMember: (groupId, uin) =>
      groupId === 777 && uin === 10001
        ? { nickname: "roster-nick", card: "roster-card", role: "admin", uid: "u_sender" }
        : undefined,
  };
  const body = pushMsg(pushMsgBody({
    responseHead: responseHead({ fromUin: 10001, grp: responseGrp({ groupUin: 777 }) }),
    contentHead: contentHead({ msgType: 82, sequence: 10, timestamp: 1700001000 }),
    body: messageBody({ richText: richText([textElem("hi")]) }),
  }));
  const event = decodeMsgPushPacket(packet(body), identity)[0]!;
  if (event.kind !== "group_message") throw new Error(`expected group_message, got ${event.kind}`);
  assert.equal(event.senderNick, "roster-nick", "the wire has no memberName, so the roster supplies the nick");
  assert.equal(event.senderCard, "roster-card");
  assert.equal(event.senderRole, "admin");
});

// ===========================================================================
// Notice types (no element list -> the survival filter must not blank them)
// ===========================================================================

test("notice: group mute (0x2DC/12) decodes and resolves UIDs through identity", () => {
  // GroupMute: groupUin = 1 (L146862), operatorUid = 4 (L146916), data = 5 (L146936)
  // GroupMuteData: timestamp = 1 (L147029), state = 3 (L147065)
  // GroupMuteState: targetUid = 1 (L147155), duration = 2 (L147175)
  const mute = concat([
    uint32Field(1, 777),
    stringField(4, "u_oper"),
    delimited(5, concat([
      uint32Field(1, 1700000001),
      delimited(3, concat([
        stringField(1, "u_target"),
        uint32Field(2, 60),
      ])),
    ])),
  ]);

  const identity: Identity = {
    ...EMPTY_IDENTITY,
    findUinByUid: (uid, groupId) => {
      if (groupId !== 777) return undefined;
      return { u_oper: 10002, u_target: 10001 }[uid];
    },
  };

  const body = pushMsg(pushMsgBody({
    responseHead: responseHead({ fromUin: 10002 }),
    // ContentHead.subType = 2 carries Event0x2DCSubType.GroupMuteNotice = 12 (L143122)
    contentHead: contentHead({ msgType: 732, subType: 12, sequence: 11, timestamp: 1700002000 }),
    body: messageBody({ msgContent: mute }),
  }));

  const events = decodeMsgPushPacket(packet(body), identity);
  assert.equal(events.length, 1, "a notice has no elements and must still survive the filter");
  const event = events[0]!;
  if (event.kind !== "group_mute") throw new Error(`expected group_mute, got ${event.kind}`);
  assert.deepEqual(event, {
    kind: "group_mute",
    time: 1700000001,          // the mute payload's own timestamp wins over the head
    selfUin: 12345,
    groupId: 777,
    operatorUin: 10002,
    userUin: 10001,
    duration: 60,
  });
});

test("notice: group recall (0x2DC/17) decodes through the 7-byte notify envelope", () => {
  // NotifyMessageBody: groupUin = 4 (L147288), recall = 11 (L147326)
  // GroupRecall: operatorUid = 1 (L147541), recallMessages = 3 (L147561)
  // RecallMessage: sequence = 1 (L147734), time = 2 (L147752), authorUid = 6 (L147824)
  const notify = concat([
    uint32Field(4, 777),
    delimited(11, concat([
      stringField(1, "u_oper"),
      delimited(3, concat([
        uint32Field(1, 55),
        uint32Field(2, 1700000123),
        stringField(6, "u_author"),
      ])),
    ])),
  ]);
  // msg-push.ts:1796 `unwrapGroupNotifyPayload`: 5 filler bytes, then a **big-endian**
  // 2-byte length at offsets 5..6.
  const envelope = concat([
    Uint8Array.from([1, 2, 3, 4, 5]),
    Uint8Array.from([(notify.length >> 8) & 0xff, notify.length & 0xff]),
    notify,
  ]);

  const identity: Identity = {
    ...EMPTY_IDENTITY,
    findUinByUid: (uid, groupId) => (groupId === 777 ? { u_oper: 10002, u_author: 10001 }[uid] : undefined),
  };

  const body = pushMsg(pushMsgBody({
    responseHead: responseHead({ fromUin: 10002 }),
    contentHead: contentHead({ msgType: 732, subType: 17, sequence: 12, timestamp: 1700003000 }),
    body: messageBody({ msgContent: envelope }),
  }));

  const event = decodeMsgPushPacket(packet(body), identity)[0]!;
  if (event.kind !== "group_recall") throw new Error(`expected group_recall, got ${event.kind}`);
  assert.equal(event.groupId, 777);
  assert.equal(event.msgSeq, 55);
  assert.equal(event.operatorUin, 10002);
  assert.equal(event.authorUin, 10001);
});

test("notice: group admin change (PkgType 44) decodes from a bare content buffer", () => {
  // GroupAdmin: groupUin = 1 (L151927), body = 4 (L151981)
  // GroupAdminBody: extraDisable = 1 (L152072), extraEnable = 2 (L152092)
  // GroupAdminExtra: adminUid = 1 (L152181)
  const admin = concat([
    uint32Field(1, 777),
    delimited(4, delimited(2, stringField(1, "u_sender"))),
  ]);
  const identity: Identity = {
    ...EMPTY_IDENTITY,
    findUinByUid: (uid, groupId) => (groupId === 777 && uid === "u_sender" ? 10001 : undefined),
  };

  const body = pushMsg(pushMsgBody({
    responseHead: responseHead({ fromUin: 10001 }),
    contentHead: contentHead({ msgType: 44, sequence: 13, timestamp: 1700004000 }),
    body: messageBody({ msgContent: admin }),
  }));

  const event = decodeMsgPushPacket(packet(body), identity)[0]!;
  if (event.kind !== "group_admin") throw new Error(`expected group_admin, got ${event.kind}`);
  assert.deepEqual(event, {
    kind: "group_admin",
    time: 1700004000,
    selfUin: 12345,
    groupId: 777,
    userUin: 10001,
    set: true,
  });
});

// ===========================================================================
// Malformed input: empty / no throw
// ===========================================================================

test("malformed: a body that cannot be decoded returns [] and does not throw", () => {
  const logger = recordingLogger();
  const cases: Array<{ name: string; body: Uint8Array }> = [
    // PushMsg.message (field 1) claims 0x7f bytes that are not there.
    { name: "length overruns the parent", body: concat([tag(1, 2), varint(0x7f), Uint8Array.from([0x0a])]) },
    // A varint whose continuation bit is never cleared.
    { name: "truncated varint", body: concat([tag(1, 2), varint(3), Uint8Array.from([0x0a, 0x80])]) },
    // Field number 0 is illegal in protobuf.
    { name: "field number zero", body: Uint8Array.from([0x00, 0x00]) },
    // A tag that says field 1 but promises a fixed64 payload that is absent.
    { name: "truncated fixed64", body: concat([tag(1, 1), Uint8Array.from([1, 2, 3])]) },
    // Structurally valid PushMsg, but the inner PushMsgBody has no content head,
    // so `buildContextFromMessage` returns null (reference L143049).
    { name: "no content head", body: pushMsg(pushMsgBody({ body: messageBody({}) })) },
    // Random bytes with the high bit set: a tag far past any known field.
    { name: "garbage", body: Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0x01]) },
  ];

  for (const { name, body } of cases) {
    let events: MsgPushEvent[] | undefined;
    assert.doesNotThrow(() => {
      events = decodeMsgPushPacket(packet(body), EMPTY_IDENTITY, logger);
    }, `case "${name}" must not throw`);
    assert.deepEqual(events, [], `case "${name}" must decode to no events`);
  }

  // The drop reasons are logged, not swallowed silently — that is the whole point
  // of catching in this module rather than letting the pipeline's generic
  // "handler error" path take it.
  assert.ok(logger.lines.length > 0, "malformed bodies must leave a debug line behind");
});

test("malformed: a decoder exception is contained and logged, not thrown", () => {
  const logger = recordingLogger();
  const body = pushMsg(pushMsgBody({
    contentHead: contentHead({ msgType: 82, sequence: 1, timestamp: 1700000000 }),
    body: messageBody({ richText: richText([textElem("x")]) }),
  }));
  // An identity that violates its own contract (throws from a lookup) is the
  // cheapest way to force a throw out of the decoder itself; the reference
  // behaves the same way — `MsgPushRegistry.decode` catches (L154000).
  const exploding: Identity = {
    ...EMPTY_IDENTITY,
    findGroupMember: () => { throw new Error("roster exploded"); },
  };
  let events: MsgPushEvent[] | undefined;
  assert.doesNotThrow(() => { events = decodeMsgPushPacket(packet(body), exploding, logger); });
  assert.deepEqual(events, []);
  assert.match(logger.lines.join("\n"), /decoder error for PkgType=82/);
});

// ===========================================================================
// Pipeline registration
// ===========================================================================

test("dedup: an injected pre-decode predicate drops the packet before any decoder runs", () => {
  const logger = recordingLogger();
  const body = pushMsg(pushMsgBody({
    responseHead: responseHead({ fromUin: 10001, grp: responseGrp({ groupUin: 777 }) }),
    contentHead: contentHead({ msgType: 82, sequence: 4242, msgId: 99, timestamp: 1700000000 }),
    body: messageBody({ richText: richText([textElem("dup")]) }),
  }));

  const seen: string[] = [];
  // The seam receives the built PushContext, which is exactly what
  // `deriveSysMsgDedupIdentity` reads (bridge/sysmsg-dedup.ts:144).
  const dedup = (ctx: { head: { msgType: number }; fromUin: number }) => {
    seen.push(`${ctx.head.msgType}:${ctx.fromUin}`);
    return true;
  };

  assert.deepEqual(decodeMsgPushPacket(packet(body), EMPTY_IDENTITY, logger, dedup), []);
  assert.deepEqual(seen, ["82:10001"], "the predicate ran on the decoded context");
  assert.match(logger.lines.join("\n"), /dropped duplicate system push/);

  // Returning false leaves the event alone — the seam must not swallow by accident.
  assert.equal(decodeMsgPushPacket(packet(body), EMPTY_IDENTITY, logger, () => false).length, 1);
});

test("dedup: is off by default, so decode is provable without a stateful filter", () => {
  const body = pushMsg(pushMsgBody({
    responseHead: responseHead({ fromUin: 10001, grp: responseGrp({ groupUin: 777 }) }),
    contentHead: contentHead({ msgType: 82, sequence: 4242, msgId: 99, timestamp: 1700000000 }),
    body: messageBody({ richText: richText([textElem("twice")]) }),
  }));
  assert.equal(decodeMsgPushPacket(packet(body)).length, 1);
  assert.equal(decodeMsgPushPacket(packet(body)).length, 1, "the same packet twice is still two events");
});

test("pipeline: the helper registers MSG_PUSH_CMD and publishes MsgPushEvent[]", async () => {
  const published: unknown[][] = [];
  const pipeline = new IncomingPacketPipeline({
    publish: (events) => { published.push([...events]); },
  });

  const handler = registerMsgPushHandler(pipeline);
  assert.equal(pipeline.handlesCmd(MSG_PUSH_CMD), true);
  assert.equal(pipeline.handlesCmd("trpc.msg.olpush.OlPushService.MsgPush"), true);

  const body = pushMsg(pushMsgBody({
    responseHead: responseHead({ fromUin: 10001, grp: responseGrp({ groupUin: 777 }) }),
    contentHead: contentHead({ msgType: 82, sequence: 1, timestamp: 1700000000 }),
    body: messageBody({ richText: richText([textElem("via pipeline")]) }),
  }));

  await pipeline.process(packet(body, "12345", 100));
  assert.equal(published.length, 1);
  const events = published[0]!;
  assert.equal(events.length, 1);
  const event = events[0] as MsgPushEvent;
  assert.equal(event.kind, "group_message");

  // A malformed packet publishes nothing at all: `PacketHandler` returning [] is
  // the pipeline's "no events" case, not an publish of an empty array.
  await pipeline.process(packet(Uint8Array.from([0x0a, 0x7f]), "12345", 101));
  assert.equal(published.length, 1, "the malformed packet must publish nothing");

  pipeline.unregisterCmd(MSG_PUSH_CMD, handler);
  await pipeline.process(packet(body, "12345", 102));
  assert.equal(published.length, 1, "the handler handed back is the one that was registered");
});

test("pipeline: createMsgPushHandler is usable directly with registerCmd", async () => {
  const published: unknown[][] = [];
  const pipeline = new IncomingPacketPipeline({
    publish: (events) => { published.push([...events]); },
  });
  pipeline.registerCmd(MSG_PUSH_CMD, createMsgPushHandler());

  const body = pushMsg(pushMsgBody({
    responseHead: responseHead({ fromUin: 10001, grp: responseGrp({ groupUin: 777 }) }),
    contentHead: contentHead({ msgType: 82, sequence: 2, timestamp: 1700000001 }),
    body: messageBody({ richText: richText([textElem("direct")]) }),
  }));
  await pipeline.process(packet(body, "99999", 200));
  const event = published[0]![0] as MsgPushEvent;
  assert.equal(event.kind, "group_message");
  if (event.kind !== "group_message") throw new Error("expected group_message");
  assert.equal(event.selfUin, 99999, "selfUin tracks the packet's uin per packet, not the handler's");
});

test("pipeline: another command is untouched", async () => {
  const published: unknown[][] = [];
  const pipeline = new IncomingPacketPipeline({
    publish: (events) => { published.push([...events]); },
  });
  registerMsgPushHandler(pipeline);
  await pipeline.process({ seq: 1, error: 0, cmd: "trpc.msg.olpush.OlPushService.MsgPush.other", uin: "12345", body: new Uint8Array([1]) });
  assert.deepEqual(published, []);
});
test("dedup wiring: unrouted group messages fail open; withSysMsgDedup keys routed contexts", () => {
  const logger = recordingLogger();
  const filter = withSysMsgDedup(new SysMsgDedup(16));

  // PkgType 82 (group message) is NOT in the native dedup route table
  // (`getNativeSysMsgChatType` covers only 528/166/167/732/33/34/85). An unrouted
  // push must fail open: dedup never suppresses a message it cannot key, so the
  // same packet delivered twice still publishes twice.
  const groupBody = pushMsg(pushMsgBody({
    responseHead: responseHead({
      fromUin: 10001,
      grp: responseGrp({ groupUin: 777, memberName: "sender-nick", groupName: "group-name" }),
    }),
    contentHead: contentHead({ msgType: 82, subType: 0, sequence: 5150, msgId: 424242, timestamp: 1700000000 }),
    body: messageBody({ richText: richText([textElem("group push")]) }),
  }));
  assert.equal(decodeMsgPushPacket(packet(groupBody), EMPTY_IDENTITY, logger, filter).length, 1);
  assert.equal(
    decodeMsgPushPacket(packet(groupBody), EMPTY_IDENTITY, logger, filter).length, 1,
    "an unrouted pair must never be deduped, even when delivered twice",
  );

  // The seam itself, exercised on a context the route table DOES cover:
  // (528, 290) is a routed C2C pair, so the same key twice is a duplicate.
  const routed = {
    head: { msgType: 528, subType: 290, c2cCmd: 0, sequence: 6001, ntMsgSeq: 0, timestamp: 0, msgId: 777001 },
    fromUin: 10001,
    fromUid: "u_peer",
    selfUin: 12345,
    content: new Uint8Array(0),
    body: undefined,
    responseHead: undefined,
    identity: EMPTY_IDENTITY,
    isHistorical: false,
  };
  assert.equal(filter(routed), false, "first sighting of a routed key is not a duplicate");
  assert.equal(filter(routed), true, "second sighting of the same routed key is a duplicate");
  assert.equal(
    filter({ ...routed, head: { ...routed.head, sequence: 6002 } }),
    false,
    "a different sequence is a different key",
  );
  assert.equal(
    filter({ ...routed, head: { ...routed.head, msgId: 0 } }),
    false,
    "msgId 0 is not keyable and must fail open",
  );
});
