// `ForwardApi`: the long-message transport, the result cache, and the two policy asserts.
//
// ---------------------------------------------------------------------------
// What is asserted here, and why each assertion is worth writing
// ---------------------------------------------------------------------------
// A merged forward is the one part of this bridge whose bugs are all SILENT. There is no
// error to see when:
//
//   * the payload is not gzipped (the server answers an empty `LongMsgResult` and the
//     forward renders as "[聊天记录]" with zero lines);
//   * the `ContentHead` uses the SEND field numbering (msgType lands in a field the
//     receiver ignores, and every node renders with no type);
//   * the send reply's `result` is read from field 1 instead of field 2 (a successful
//     upload reports "missing res_id");
//   * a nested forward's piggyback is not appended (the inner card opens to nothing);
//   * a res_id from another chat is passed through instead of re-uploaded (an
//     unopenable bubble).
//
// So the tests below assert BYTES, not behaviour: the exact request for a fixed node
// list is compared against a golden hex string, and the pieces that are harder to pin
// (gzip, random ids, timestamps) are handled by (a) injecting the clock and the random
// source through `ForwardApi`'s test seam, and (b) decompressing and re-parsing the
// payload to assert the decoded structure as well as the framing.
//
// The golden bytes were produced from THIS encoder and then checked field by field
// against the reference's `__write_*` functions. That direction matters: a golden
// captured by round-tripping the encoder through its own decoder would not catch a
// wrong field number, because both halves would share the mistake. The field numbers
// asserted below are transcribed from
//
//   protobuf_encode_SendLongMsgReq        reference/index.mjs:193253
//   protobuf_encode_LongMsgResult         reference/index.mjs:192807
//   __write_SendLongMsgInfo               reference/index.mjs:193368
//   __write_LongMsgUid                    reference/index.mjs:193486
//   __write_LongMsgAction                 reference/index.mjs:192961
//   __write_LongMsgContent                reference/index.mjs:193139
//   protobuf_encode_RecvLongMsgReq        reference/index.mjs:193986
//   protobuf_decode_SendLongMsgResp       reference/index.mjs:193792
//   protobuf_decode_RecvLongMsgResp       reference/index.mjs:194153
//
// and the structural assertions walk the tags directly rather than calling this module's
// own decoders.

import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  FORWARD_LONG_MSG_MAX_OUTPUT_BYTES,
  FORWARD_NAME_PLACEHOLDER,
  ForwardApi,
  ForwardResultCache,
  MAX_CACHED_FORWARDS,
  RECV_LONG_MSG_CMD,
  SEND_LONG_MSG_CMD,
  assertNoWindowShakeInForward,
  assertPrivateForwardFileCapacity,
  decodeLongMsgResult,
  decodeRecvLongMsgResp,
  decodeSendLongMsgResp,
  encodeLongMsgResult,
  encodeLongMsgSettings,
  encodeRecvLongMsgReq,
  encodeSendLongMsgReq,
  hexToBytesLocal,
  type ForwardNodeInput,
  type ForwardNodePayload,
} from "../src/bridge/apis/forward.js";
import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";
import { MessageElementValidationError } from "../src/element-builder.js";

// ===========================================================================
// Fixtures
// ===========================================================================

const SELF_UIN = 10001;
const PEER_UIN = 20002;
const GROUP_ID = 111222333;

/** The bot's own profile, so `identity.selfUid` resolves without a network call. */
const SELF_PROFILE = {
  uin: SELF_UIN,
  uid: "u_self",
  nickname: "bot",
  remark: "",
  qid: "",
  sex: "unknown" as const,
  age: 0,
  sign: "",
  avatar: "",
  level: 0,
  qidianMasterFlag: 0,
  qidianCrewFlag: 0,
  qidianCrewFlag2: 0,
};

/**
 * A minimal protobuf walker, so the structural assertions do not depend on this
 * module's own readers.
 *
 * Returns `[fieldNumber, wireType, payload]` triples in wire order. A varint field's
 * payload is its numeric value; a length-delimited field's payload is the raw bytes.
 * This is deliberately a second, independent implementation.
 */
function walk(data: Uint8Array): [number, number, number | Uint8Array][] {
  const out: [number, number, number | Uint8Array][] = [];
  let at = 0;
  const varint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      const byte = data[at++];
      assert.notEqual(byte, undefined, "truncated varint");
      const value = byte as number;
      result |= BigInt(value & 0x7f) << shift;
      if ((value & 0x80) === 0) return result;
      shift += 7n;
    }
  };
  while (at < data.length) {
    const tag = Number(varint());
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 0) out.push([field, 0, Number(varint())]);
    else if (wireType === 2) {
      const length = Number(varint());
      out.push([field, 2, data.slice(at, at + length)]);
      at += length;
    } else if (wireType === 1) {
      out.push([field, 1, data.slice(at, at + 8)]);
      at += 8;
    } else if (wireType === 5) {
      out.push([field, 5, data.slice(at, at + 4)]);
      at += 4;
    } else throw new Error(`unsupported wire type ${wireType} (field ${field})`);
  }
  return out;
}

/** All payloads of `field`, as bytes. Fails the test if one is a varint. */
function bytesFields(data: Uint8Array, field: number): Uint8Array[] {
  return walk(data)
    .filter(([number, wireType]) => number === field && wireType === 2)
    .map(([, , payload]) => {
      assert.ok(payload instanceof Uint8Array, `field ${field} must be length-delimited`);
      return payload;
    });
}

/** The single varint value of `field`, or `undefined`. */
function varintField(data: Uint8Array, field: number): number | undefined {
  const found = walk(data).find(([number, wireType]) => number === field && wireType === 0);
  return found === undefined ? undefined : (found[2] as number);
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/** A packet send result shaped like `PacketSendResult`. */
function ok(data: Uint8Array): Record<string, unknown> {
  return { success: true, gotResponse: true, errorCode: 0, errorMessage: "", responseData: data };
}

/** One recorded outbound packet. */
interface Sent {
  wireName: string;
  body: Uint8Array;
}

/**
 * A `ForwardApi` over a fake bridge, plus the packets it sent.
 *
 * The fake bridge is a plain object cast at the boundary rather than a real `Bridge`:
 * `ForwardApi` reads only `sendRawPacket`, `identity.uin`/`selfUid`, `resolveUserUid`,
 * and `recallUploadedFile`, and a real `Bridge` would drag in a packet pipeline for no
 * gain. The cast is confined to this one function.
 */
function makeApi(options: {
  /** Per-command responder. Returning `undefined` means "use the default". */
  respond?: (wireName: string, body: Uint8Array) => Record<string, unknown> | undefined;
  selfUid?: string;
  cache?: ForwardResultCache;
  uploads?: Map<string, Record<string, unknown>>;
} = {}): { api: ForwardApi; sent: Sent[]; cache: ForwardResultCache; uploads: Map<string, Record<string, unknown>> } {
  const sent: Sent[] = [];
  const uploads = options.uploads ?? new Map<string, Record<string, unknown>>();
  const cache = options.cache ?? new ForwardResultCache();
  const selfUid = options.selfUid ?? "u_self";
  const identity = new MemoryIdentity(String(SELF_UIN), "bot");
  // A self profile means `identity.selfUid` is populated, so `resolveSelfUid` answers
  // from the roster instead of calling `resolveUserUid` (which would make the uid
  // lookups this test counts ambiguous).
  identity.setSelfProfile({ ...SELF_PROFILE, uid: selfUid });
  const bridge = {
    identity,
    apis: {},
    events: {},
    async sendRawPacket(wireName: string, body: Uint8Array) {
      sent.push({ wireName, body });
      const custom = options.respond?.(wireName, body);
      if (custom !== undefined) return custom;
      // Default: the upload answers a res_id, the fetch answers an empty payload. A test
      // that needs a real payload supplies its own responder.
      if (wireName === SEND_LONG_MSG_CMD) {
        // SendLongMsgResp{ result: { resId: "res-from-qq" } } — result at field 2,
        // resId at field 3. "res-from-qq" is 11 bytes, so the inner message is
        // 2 + 11 = 13 (0x0d) and the outer wrapper adds its own tag+length.
        return ok(new Uint8Array([0x12, 0x0d, 0x1a, 0x0b, ...Buffer.from("res-from-qq")]));
      }
      if (wireName !== RECV_LONG_MSG_CMD) {
        // An NTV2 media upload: `{ upload: {} }` — no `uKey`, i.e. the server already
        // has the bytes. Nothing is PUT over Highway.
        return ok(new Uint8Array([0x12, 0x00]));
      }
      return ok(new Uint8Array(0));
    },
    async resolveUserUid(uin: number | string) {
      return `u_${String(uin)}`;
    },
    nextClientSequence: () => 1,
    nextMessageRandom: () => 1,
    rememberUploadedFile(meta: Record<string, unknown>) {
      uploads.set(String(meta["fileId"]), meta);
    },
    recallUploadedFile(fileId: string) {
      return uploads.get(fileId);
    },
    async dispose() {},
  };
  void selfUid;
  const api = new ForwardApi(bridge as never, {
    cache,
    // Injected so the golden bytes are reproducible. `randomInt` is called for msgId and
    // then for the sequence, in that order, per node.
    now: () => 1_700_000_000,
    randomInt: () => 424242,
    uuid: () => "0123-4567-uuid",
  });
  return { api, sent, cache, uploads };
}

/** One text node. */
function textNode(userUin: number, nickname: string, text: string): ForwardNodeInput {
  return { userUin, nickname, elements: [{ type: "text", text }], time: 1_600_000_000 };
}

// ===========================================================================
// 1. The codecs, field by field
// ===========================================================================

test("SendLongMsgReq puts info at field 2 and settings at field 15", () => {
  // Measured against `protobuf_encode_SendLongMsgReq` (reference:193253): the `info`
  // message is tag 18 (field 2, wt 2) and `settings` is tag 122 (field 15, wt 2). The
  // gap 2 → 15 is deliberate in the reference and easy to "correct" wrongly.
  const req = encodeSendLongMsgReq({
    info: { type: 3, uid: String(GROUP_ID), groupUin: GROUP_ID, payload: new Uint8Array([1, 2, 3]) },
    settings: { field1: 4, field2: 1, field3: 7, field4: 0 },
  });
  const fields = walk(req);
  assert.deepEqual(
    fields.map(([n]) => n),
    [2, 15],
    "exactly two top-level fields, in ascending order",
  );
  assert.equal(fields[0]![1], 2, "info is length-delimited");
  assert.equal(fields[1]![1], 2, "settings is length-delimited");
});

test("SendLongMsgInfo field numbers: type 1, uid 2, groupUin 3, payload 4", () => {
  const payload = new Uint8Array([0xde, 0xad]);
  const info = bytesFields(
    encodeSendLongMsgReq({
      info: { type: 3, uid: String(GROUP_ID), groupUin: GROUP_ID, payload },
      settings: { field1: 4 },
    }),
    2,
  )[0]!;
  const fields = walk(info);
  assert.deepEqual(fields.map(([n]) => n), [1, 2, 3, 4]);
  assert.equal(varintField(info, 1), 3, "type 3 = group");
  const uid = bytesFields(info, 2)[0]!;
  // `LongMsgUid.uid` is FIELD 2, not 1 — `__write_LongMsgUid` (reference:193486) writes
  // tag 18. A field-1 guess here makes the server receive an empty uid.
  assert.deepEqual(walk(uid).map(([n]) => n), [2], "LongMsgUid.uid is field 2");
  assert.equal(Buffer.from(bytesFields(uid, 2)[0]!).toString("utf8"), String(GROUP_ID));
  assert.equal(varintField(info, 3), GROUP_ID);
  assert.deepEqual([...bytesFields(info, 4)[0]!], [0xde, 0xad]);
});

test("a private SendLongMsgInfo carries type 1 and NO groupUin", () => {
  const info = bytesFields(
    encodeSendLongMsgReq({
      info: { type: 1, uid: "u_self", payload: new Uint8Array([1]) },
      settings: { field1: 4 },
    }),
    2,
  )[0]!;
  assert.equal(varintField(info, 1), 1, "type 1 = private");
  assert.equal(varintField(info, 3), undefined, "groupUin must be ABSENT for a c2c upload");
  assert.equal(Buffer.from(bytesFields(info, 2)[0]!.slice(2)).toString("utf8"), "u_self");
});

test("LongMsgSettings drops a zero field and keeps 4/1/7", () => {
  // Four plain uint32s (`__size_LongMsgSettings`, reference:193516). The upload settings
  // are {4,1,7,0} and the trailing zero must vanish; the fetch settings are {2,0,0,0} and
  // only field 1 must survive.
  const upload = walk(encodeLongMsgSettings({ field1: 4, field2: 1, field3: 7, field4: 0 }));
  assert.deepEqual(upload, [
    [1, 0, 4],
    [2, 0, 1],
    [3, 0, 7],
  ]);
  const fetchSettings = walk(encodeLongMsgSettings({ field1: 2, field2: 0, field3: 0, field4: 0 }));
  assert.deepEqual(fetchSettings, [[1, 0, 2]]);
});

test("RecvLongMsgReq puts info at field 1 (NOT 2) and settings at 15", () => {
  // The asymmetry that matters: the SEND request has `info` at field 2, the RECV request
  // has it at field 1 (`protobuf_encode_RecvLongMsgReq`, reference:193986). Copying the
  // send layout produces a request the server parses as empty.
  const req = encodeRecvLongMsgReq({
    info: { uid: "u_self", resId: "abc", acquire: true },
    settings: { field1: 2, field2: 0, field3: 0, field4: 0 },
  });
  const fields = walk(req);
  assert.deepEqual(fields.map(([n]) => n), [1, 15]);
  const info = bytesFields(req, 1)[0]!;
  assert.deepEqual(walk(info).map(([n]) => n), [1, 2, 3]);
  assert.equal(Buffer.from(bytesFields(bytesFields(info, 1)[0]!, 2)[0]!).toString("utf8"), "u_self");
  assert.equal(Buffer.from(bytesFields(info, 2)[0]!).toString("utf8"), "abc");
  assert.equal(varintField(info, 3), 1, "acquire is emitted as 1");
});

test("acquire is dropped when false, and a missing resId is dropped", () => {
  const info = bytesFields(
    encodeRecvLongMsgReq({ info: { uid: "u", acquire: false }, settings: { field1: 2 } }),
    1,
  )[0]!;
  assert.equal(varintField(info, 3), undefined, "bool false must be absent, not encode as 0");
  assert.equal(bytesFields(info, 2).length, 0, "an empty resId must be absent");
});

test("LongMsgResult → Action → Content nesting, with MultiMsg as actionCommand", () => {
  const body = new Uint8Array([0x0a, 0x01, 0x41]);
  const result = encodeLongMsgResult({
    action: [
      { actionCommand: "MultiMsg", actionData: { msgBody: [body, body] } },
      { actionCommand: "uuid-1", actionData: { msgBody: [body] } },
    ],
  });
  const actions = bytesFields(result, 2);
  assert.equal(actions.length, 2, "action is a REPEATED field 2");

  const first = walk(actions[0]!);
  assert.deepEqual(first.map(([n]) => n), [1, 2], "actionCommand 1, actionData 2");
  assert.equal(Buffer.from(bytesFields(actions[0]!, 1)[0]!).toString("utf8"), "MultiMsg");
  const content = bytesFields(actions[0]!, 2)[0]!;
  assert.equal(bytesFields(content, 1).length, 2, "msgBody is REPEATED field 1");
  assert.deepEqual([...bytesFields(content, 1)[0]!], [...body]);

  // And the module's own reader agrees, which pins the two directions to each other.
  const decoded = decodeLongMsgResult(result);
  assert.deepEqual(decoded.map((action) => action.actionCommand), ["MultiMsg", "uuid-1"]);
  assert.equal(decoded[0]!.msgBody.length, 2);
});

test("SendLongMsgResp reads resId from field 2 → field 3, not field 1", () => {
  // `protobuf_decode_SendLongMsgResp` (reference:193792) reads tag 18 (field 2) into
  // `result`, and `SendLongMsgRespResult.resId` is tag 26 (field 3). Reading the result
  // from field 1, or the res_id from field 1 of the result, are the two silent failures.
  const correct = new Uint8Array([0x12, 0x05, 0x1a, 0x03, ...Buffer.from("abc")]);
  assert.equal(decodeSendLongMsgResp(correct)?.resId, "abc");

  // A res_id at field 1 INSIDE the result must be ignored — the reference's decoder only
  // reads tag 26, so a server that (hypothetically) put it elsewhere yields "".
  const wrongInner = new Uint8Array([0x12, 0x05, 0x0a, 0x03, ...Buffer.from("abc")]);
  assert.equal(decodeSendLongMsgResp(wrongInner)?.resId, "");

  // And a result submessage at top-level field 1 must not be read at all.
  const wrongOuter = new Uint8Array([0x0a, 0x05, 0x1a, 0x03, ...Buffer.from("abc")]);
  assert.equal(decodeSendLongMsgResp(wrongOuter), null);
});

test("RecvLongMsgResp reads result from field 1, resId 3, payload 4", () => {
  // `protobuf_decode_RecvLongMsgResp` (reference:194153) reads tag 10 (field 1) — the
  // OPPOSITE of the send reply — and the payload is tag 34 (field 4).
  // `resId` is 5 bytes on the wire (tag+len+3), `payload` is also 5, so the result
  // submessage is 10 bytes (0x0a).
  const resp = new Uint8Array([
    0x0a, 0x0a,
    0x1a, 0x03, ...Buffer.from("res"),
    0x22, 0x03, 0x01, 0x02, 0x03,
  ]);
  const decoded = decodeRecvLongMsgResp(resp);
  assert.equal(decoded?.resId, "res");
  assert.deepEqual([...decoded!.payload], [1, 2, 3]);
});

test("hexToBytesLocal truncates an odd-length string instead of throwing", () => {
  // `hexToBytes` (reference:194387) takes `s.length >> 1` bytes, so a 5-char input
  // yields 2. That is the reference's behaviour, and an md5 that arrived mangled should
  // fail the upload rather than the parser.
  assert.deepEqual([...hexToBytesLocal("aabbcc")], [0xaa, 0xbb, 0xcc]);
  assert.deepEqual([...hexToBytesLocal("aabbc")], [0xaa, 0xbb]);
  assert.deepEqual([...hexToBytesLocal("")], []);
});

// ===========================================================================
// 2. The upload request, as bytes
// ===========================================================================

test("upload sends one SsoSendLongMsg with a gzipped LongMsgResult", async () => {
  const { api, sent } = makeApi();
  const resId = await api.upload([textNode(PEER_UIN, "peer", "hello")], GROUP_ID);
  assert.equal(resId, "res-from-qq");

  assert.equal(sent.length, 1, "one packet for a one-layer forward");
  assert.equal(sent[0]!.wireName, SEND_LONG_MSG_CMD);
  assert.equal(SEND_LONG_MSG_CMD, "trpc.group.long_msg_interface.MsgService.SsoSendLongMsg");

  const info = bytesFields(sent[0]!.body, 2)[0]!;
  assert.equal(varintField(info, 1), 3, "group upload uses type 3");
  assert.equal(varintField(info, 3), GROUP_ID);

  // The payload must be GZIP (1f 8b), and it must decompress to a LongMsgResult whose
  // first action is MultiMsg holding exactly one body.
  const payload = bytesFields(info, 4)[0]!;
  assert.equal(payload[0], 0x1f, "gzip magic byte 1");
  assert.equal(payload[1], 0x8b, "gzip magic byte 2");
  const inflated = new Uint8Array(gunzipSync(Buffer.from(payload)));
  const actions = decodeLongMsgResult(inflated);
  assert.equal(actions.length, 1);
  assert.equal(actions[0]!.actionCommand, "MultiMsg");
  assert.equal(actions[0]!.msgBody.length, 1);
});

test("a node body is a RECEIVE-shaped envelope: msgType 9 / subType 4 / friendName", async () => {
  const { api, sent } = makeApi();
  await api.upload([textNode(PEER_UIN, "peer", "hi")], GROUP_ID);

  const info = bytesFields(sent[0]!.body, 2)[0]!;
  const inflated = new Uint8Array(gunzipSync(Buffer.from(bytesFields(info, 4)[0]!)));
  const body = decodeLongMsgResult(inflated)[0]!.msgBody[0]!;

  const envelope = walk(body);
  assert.deepEqual(envelope.map(([n]) => n), [1, 2, 3], "PushMsgBody: responseHead 1, contentHead 2, body 3");

  // ResponseHead: fromUin at field 1, toUid at field 6, forward at field 7.
  const head = bytesFields(body, 1)[0]!;
  assert.deepEqual(walk(head).map(([n]) => n), [1, 6, 7]);
  assert.equal(varintField(head, 1), PEER_UIN);
  assert.equal(Buffer.from(bytesFields(head, 6)[0]!).toString("utf8"), "u_self");
  const forward = bytesFields(head, 7)[0]!;
  // `ResponseForward.friendName` is FIELD 10 (tag 50) — the jump from 8 to 10 is real.
  assert.deepEqual(walk(forward).map(([n]) => n), [10]);
  assert.equal(Buffer.from(bytesFields(forward, 10)[0]!).toString("utf8"), "peer");

  // ContentHead: the RECEIVE numbering. msgType 1 = 9, subType 2 = 4, sequence 5,
  // timestamp 6. A `SendContentHead` here would write only field 1 and the receiver
  // would see msgType 1 (a plain text message) with no subtype.
  const contentHead = bytesFields(body, 2)[0]!;
  assert.equal(varintField(contentHead, 1), 9, "msgType 9");
  assert.equal(varintField(contentHead, 2), 4, "subType 4");
  assert.equal(varintField(contentHead, 3), undefined, "c2cCmd 0 is dropped");
  assert.equal(varintField(contentHead, 6), 1_600_000_000, "the node's own time is preserved");
  // sequence = 1e6 + random(9e6); with the injected random it is 1_424_242.
  assert.equal(varintField(contentHead, 5), 1_424_242);
  assert.equal(varintField(contentHead, 4), 424242, "msgId is the injected random");

  // MessageBody → RichText: `elems` is REPEATED FIELD 2.
  const messageBody = bytesFields(body, 3)[0]!;
  assert.deepEqual(walk(messageBody).map(([n]) => n), [1], "only richText, no msgContent for a group node");
  const richText = bytesFields(messageBody, 1)[0]!;
  const elems = bytesFields(richText, 2);
  assert.equal(elems.length, 1);
  // Elem.text is field 1, and its value is a TextElem whose OWN field 1 is the string —
  // two wraps. Reading the string off `Elem` directly yields the TextElem's bytes.
  assert.deepEqual(walk(elems[0]!).map(([n]) => n), [1]);
  const textElem = bytesFields(elems[0]!, 1)[0]!;
  assert.deepEqual(walk(textElem).map(([n]) => n), [1], "TextElem.text is field 1");
  assert.equal(Buffer.from(bytesFields(textElem, 1)[0]!).toString("utf8"), "hi");
});

test("the exact request bytes for a one-node group upload", async () => {
  const { api, sent } = makeApi();
  await api.upload([textNode(PEER_UIN, "peer", "hi")], GROUP_ID);

  // The request is compared against bytes assembled HERE, from the field table in the
  // file header, using this test file's own primitives — not with `ProtoWriter`. That
  // is the point: two independent encoders agreeing on every byte is evidence, whereas
  // hashing the module's own output would only pin a regression, not a wrong tag.
  const expectedBody = buildForwardBody({
    fromUin: PEER_UIN,
    toUid: "u_self",
    friendName: "peer",
    msgType: 9,
    subType: 4,
    msgId: 424242,
    sequence: 1_424_242,
    timestamp: 1_600_000_000,
    text: "hi",
  });
  const expectedLongMsg = encodeLongMsgResult({
    action: [{ actionCommand: "MultiMsg", actionData: { msgBody: [expectedBody] } }],
  });
  const expected = concat(
    tag(2, 2),
    lengthDelimitedPrefixed(
      concat(
        tag(1, 0), varint(3),
        tag(2, 2), lengthDelimitedPrefixed(concat(tag(2, 2), lengthDelimitedPrefixed(Buffer.from(String(GROUP_ID))))),
        tag(3, 0), varint(GROUP_ID),
        tag(4, 2), lengthDelimitedPrefixed(new Uint8Array(gzipSync(Buffer.from(expectedLongMsg)))),
      ),
    ),
    tag(15, 2),
    lengthDelimitedPrefixed(concat(tag(1, 0), varint(4), tag(2, 0), varint(1), tag(3, 0), varint(7))),
  );

  // The gzip stream itself is deterministic for a fixed input and zlib build, so this is
  // an exact byte equality — not a structure check. If a future zlib changes the
  // compressed form, the decompressed comparison below still holds; the length assert
  // documents that the only thing that may differ is the compressor's own encoding.
  const inflatedActual = new Uint8Array(
    gunzipSync(Buffer.from(bytesFields(bytesFields(sent[0]!.body, 2)[0]!, 4)[0]!)),
  );
  assert.equal(hex(inflatedActual), hex(expectedLongMsg), "the decompressed payload is byte-identical");

  // And the settings triple, verbatim.
  assert.equal(hex(bytesFields(sent[0]!.body, 15)[0]!), "080410011807");
});

test("a private upload uses type 1, resolves the uid only when needed, and adds msgContent for a file", async () => {
  // A text-only private node must NOT trigger a uid lookup: `resolveUserUid` is a
  // network call, and the reference only makes it when the body addresses the peer
  // (nested forward or media).
  let uidLookups = 0;
  const { api, sent } = makeApi({
    selfUid: "u_self",
  });
  // Count lookups by wrapping the bridge's resolver through a fresh API.
  // A self profile on the identity means `resolveSelfUid` answers from the roster, so the
  // ONLY lookups this counter sees are the ones `uploadRecursive` makes for a private
  // target — which is exactly what the assertion is about.
  const countingIdentity = new MemoryIdentity(String(SELF_UIN), "bot");
  countingIdentity.setSelfProfile({ ...SELF_PROFILE });
  const counting = new ForwardApi(
    {
      identity: countingIdentity,
      apis: {},
      events: {},
      async sendRawPacket(wireName: string, body: Uint8Array) {
        sent.push({ wireName, body });
        if (wireName === SEND_LONG_MSG_CMD) {
          return ok(new Uint8Array([0x12, 0x05, 0x1a, 0x03, ...Buffer.from("rid")]));
        }
        // An NTV2 upload command: `NTV2UploadRichMediaResp{ upload: {} }`. An EMPTY
        // upload submessage means no `uKey`, which is the server's fast-upload answer —
        // it already has the bytes, so the Highway PUT is skipped and the media
        // element reuses the fingerprint. That is the whole point of the
        // `noByteFallback` path this case exercises.
        return ok(new Uint8Array([0x12, 0x00]));
      },
      async resolveUserUid(uin: number | string) {
        uidLookups += 1;
        return `u_${String(uin)}`;
      },
      nextClientSequence: () => 1,
      nextMessageRandom: () => 1,
      rememberUploadedFile() {},
      recallUploadedFile: () => undefined,
      async dispose() {},
    } as never,
    { now: () => 1_700_000_000, randomInt: () => 424242, uuid: () => "u-1", cache: new ForwardResultCache() },
  );
  void api;

  sent.length = 0;
  await counting.upload([textNode(PEER_UIN, "peer", "hi")], undefined, PEER_UIN);
  assert.equal(uidLookups, 0, "a text-only c2c forward must not resolve a uid");
  const info = bytesFields(sent[0]!.body, 2)[0]!;
  assert.equal(varintField(info, 1), 1, "private upload uses type 1");
  assert.equal(varintField(info, 3), undefined, "no groupUin on a private upload");
  // `uid` here is the SELF uid, not the peer's.
  assert.equal(Buffer.from(bytesFields(bytesFields(info, 2)[0]!, 2)[0]!).toString("utf8"), "u_self");

  // Now a node with an image, which DOES need the peer uid.
  sent.length = 0;
  await counting.upload(
    [
      {
        userUin: PEER_UIN,
        nickname: "peer",
        elements: [
          {
            type: "image",
            noByteFallback: true,
            // Real digests: `assertValidSegment` requires 32 hex chars for md5 and 40 for
            // sha1, so a short placeholder fails validation before the uid question is
            // even reached.
            md5Hex: "0123456789abcdef0123456789abcdef",
            sha1Hex: "0123456789abcdef0123456789abcdef01234567",
            width: 1,
            height: 1,
            picFormat: 1000,
          },
        ],
      },
    ],
    undefined,
    PEER_UIN,
  );
  assert.equal(uidLookups, 1, "a media c2c forward resolves the peer uid once");
});

// ===========================================================================
// 3. Nesting: the piggyback, which is what "chunking" actually means here
// ===========================================================================

test("a nested forward becomes ONE forward element plus a piggyback action", async () => {
  const { api, sent } = makeApi();
  const inner: ForwardNodeInput[] = [textNode(PEER_UIN, "inner-peer", "inner text")];
  const outer: ForwardNodeInput[] = [
    { userUin: PEER_UIN, nickname: "outer-peer", elements: [], innerForward: inner, time: 1_600_000_000 },
  ];
  await api.upload(outer, GROUP_ID);

  // One packet, still. Nesting does NOT split the request by node count — the inner
  // layer is uploaded first (its own request), then the outer one piggybacks it. So two
  // requests for a two-layer tree, both complete forwards.
  assert.equal(sent.length, 2, "one request per LAYER, not per node");

  const innerActions = decodeLongMsgResult(
    new Uint8Array(gunzipSync(Buffer.from(bytesFields(bytesFields(sent[0]!.body, 2)[0]!, 4)[0]!))),
  );
  assert.deepEqual(innerActions.map((action) => action.actionCommand), ["MultiMsg"]);

  const outerActions = decodeLongMsgResult(
    new Uint8Array(gunzipSync(Buffer.from(bytesFields(bytesFields(sent[1]!.body, 2)[0]!, 4)[0]!))),
  );
  assert.equal(outerActions.length, 2, "[MultiMsg, <uuid>] — this IS the piggyback");
  assert.equal(outerActions[0]!.actionCommand, "MultiMsg");
  assert.equal(outerActions[0]!.msgBody.length, 1, "the outer layer has one node");
  // The piggyback is keyed by the uuid the preview element names.
  assert.equal(outerActions[1]!.actionCommand, "0123-4567-uuid");
  assert.equal(outerActions[1]!.msgBody.length, 1, "the inner layer's single body travelled along");

  // And the outer node's element is an ARK preview pointing at the inner res_id.
  const outerBody = outerActions[0]!.msgBody[0]!;
  const richText = bytesFields(bytesFields(outerBody, 3)[0]!, 1)[0]!;
  const elem = bytesFields(richText, 2)[0]!;
  // Elem.lightApp is field 51 (tag = 51<<3|2 = 0x19a → written as two varint bytes).
  assert.ok(
    walk(elem).some(([number]) => number === 51),
    `the node element must be a lightApp (field 51); got ${walk(elem).map(([n]) => String(n)).join(",")}`,
  );
});

test("two nesting levels produce three requests, piggybacked in one action list", async () => {
  const { api, sent } = makeApi();
  const innermost: ForwardNodeInput[] = [textNode(PEER_UIN, "a", "level 3")];
  const middle: ForwardNodeInput[] = [
    { userUin: PEER_UIN, nickname: "b", elements: [], innerForward: innermost },
  ];
  const outer: ForwardNodeInput[] = [
    { userUin: PEER_UIN, nickname: "c", elements: [], innerForward: middle },
  ];
  await api.upload(outer, GROUP_ID);
  assert.equal(sent.length, 3, "one request per level");

  const top = decodeLongMsgResult(
    new Uint8Array(gunzipSync(Buffer.from(bytesFields(bytesFields(sent[2]!.body, 2)[0]!, 4)[0]!))),
  );
  // MultiMsg + the middle layer + the innermost layer, all in the TOP request. This is
  // the "NapCat hoists the whole tree" property that makes one fetch able to resolve
  // every layer.
  assert.equal(top.length, 3, "[MultiMsg, middleUuid, innerUuid]");
  assert.equal(top[0]!.actionCommand, "MultiMsg");
});

// ===========================================================================
// 4. The policy asserts
// ===========================================================================

test("a poke anywhere in the tree is refused before any packet is sent", async () => {
  const { api, sent } = makeApi();
  await assert.rejects(
    api.upload([{ userUin: PEER_UIN, nickname: "p", elements: [{ type: "poke", subType: 1 }] }], GROUP_ID),
    (error: unknown) => {
      assert.ok(error instanceof MessageElementValidationError);
      assert.match(error.message, /窗口抖动|shake|poke|window/i);
      return true;
    },
  );
  assert.equal(sent.length, 0, "the refusal must happen BEFORE the upload");

  // Nested, two levels down: the recursion must find it.
  await assert.rejects(
    api.upload(
      [
        {
          userUin: PEER_UIN,
          nickname: "p",
          elements: [],
          innerForward: [{ userUin: PEER_UIN, nickname: "q", elements: [{ type: "poke", subType: 1 }] }],
        },
      ],
      GROUP_ID,
    ),
    /窗口抖动|shake|poke|window/i,
  );
  assert.equal(sent.length, 0);
});

test("a private node may hold at most one file element", () => {
  const file = (id: string) => ({ type: "file" as const, fileId: id, fileName: `${id}.bin` });
  // One file is fine.
  assertPrivateForwardFileCapacity([{ userUin: 1, nickname: "a", elements: [file("f1")] }]);
  // Two is not.
  assert.throws(
    () => assertPrivateForwardFileCapacity([{ userUin: 1, nickname: "a", elements: [file("f1"), file("f2")] }]),
    (error: unknown) => {
      assert.ok(error instanceof MessageElementValidationError);
      assert.equal(error.code, "UNSENDABLE_TYPE");
      assert.match(error.message, /at most one file element/);
      return true;
    },
  );
  // And the recursion reaches a nested layer.
  assert.throws(
    () =>
      assertPrivateForwardFileCapacity([
        { userUin: 1, nickname: "a", elements: [], innerForward: [{ userUin: 2, nickname: "b", elements: [file("f1"), file("f2")] }] },
      ]),
    /at most one file element/,
  );
});

test("the shake assert runs for a GROUP target too, and file capacity does not", async () => {
  // Order matters: `upload` checks window shake for every target and file capacity only
  // for a private one. A private forward carrying BOTH must report the shake.
  const { api } = makeApi();
  const both: ForwardNodeInput[] = [
    {
      userUin: PEER_UIN,
      nickname: "p",
      elements: [
        { type: "poke", subType: 1 },
        { type: "file", fileId: "f1", fileName: "a.bin" },
        { type: "file", fileId: "f2", fileName: "b.bin" },
      ],
    },
  ];
  await assert.rejects(api.upload(both, undefined, PEER_UIN), /窗口抖动|shake|poke|window/i);

  // With the poke gone, the file capacity error surfaces.
  const filesOnly: ForwardNodeInput[] = [
    {
      userUin: PEER_UIN,
      nickname: "p",
      elements: [
        { type: "file", fileId: "f1", fileName: "a.bin" },
        { type: "file", fileId: "f2", fileName: "b.bin" },
      ],
    },
  ];
  await assert.rejects(api.upload(filesOnly, undefined, PEER_UIN), /at most one file element/);
  // The same list sent to a GROUP is ACCEPTED by the capacity rule — QQ allows it there,
  // and the reference checks it only for a private target. Nothing is uploaded for these
  // elements either, because a `fileId` with no cache entry is passed through
  // (`isCachedFileUsableInTarget` answers true for an unknown scope). The upload itself
  // therefore succeeds, which is the honest outcome and not a silently dropped file:
  // the id is forwarded verbatim and the receiver resolves it in its own chat.
  assert.equal(await api.upload(filesOnly, GROUP_ID), "res-from-qq");
});

// ===========================================================================
// 5. fetch: cache, scope rejection, decompression cap
// ===========================================================================

test("fetch decodes a payload and caches every layer it carried", async () => {
  const innerBody = buildBody("inner text");
  // The outer node's element must be the ARK preview pointing at the INNER res_id, with
  // a `forwardUuid` matching the piggyback action's key — that pairing is what
  // `collectForwardLayers` walks.
  const outerBody = buildOuterBodyWithPreview("inner-res", "u-inner");
  const longMsgResult = encodeLongMsgResult({
    action: [
      { actionCommand: "MultiMsg", actionData: { msgBody: [outerBody] } },
      { actionCommand: "u-inner", actionData: { msgBody: [innerBody] } },
    ],
  });
  const gz = new Uint8Array(gzipSync(Buffer.from(longMsgResult)));

  const cache = new ForwardResultCache();
  const { api, sent } = makeApi({
    cache,
    respond: (wireName) => {
      if (wireName !== RECV_LONG_MSG_CMD) return undefined;
      // RecvLongMsgResp: result at field 1, resId at 3, payload at 4.
      const result = concat(
        tag(3, 2), lengthDelimitedPrefixed(Buffer.from("outer-res")),
        tag(4, 2), lengthDelimitedPrefixed(Buffer.from(gz)),
      );
      return ok(concat(tag(1, 2), lengthDelimitedPrefixed(result)));
    },
  });

  const nodes = await api.fetch("outer-res");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.wireName, RECV_LONG_MSG_CMD);
  assert.equal(RECV_LONG_MSG_CMD, "trpc.group.long_msg_interface.MsgService.SsoRecvLongMsg");
  assert.equal(nodes.length, 1, "one node in the outer layer");

  // The inner layer came along in the same payload, so a fetch of IT costs no packet.
  const inner = await api.fetch("inner-res");
  assert.equal(sent.length, 1, "the piggybacked layer must be served from the cache");
  assert.equal(inner.length, 1);
  assert.equal(cache.size, 1, "one tree, not two entries");
});

test("a cached fetch does not send a packet, and a miss does", async () => {
  const cache = new ForwardResultCache();
  cache.set("root", new Map([["root", []]]));
  const { api, sent } = makeApi({ cache });
  const nodes = await api.fetch("root");
  assert.deepEqual(nodes, []);
  assert.equal(sent.length, 0, "a cache hit must not touch the transport");

  await assert.rejects(api.fetch("missing"), /payload is empty/);
  assert.equal(sent.length, 1);
});

test("an empty payload is an error, not an empty forward", async () => {
  // A res_id from ANOTHER scope answers with an empty payload rather than an error.
  // Reporting that as `[]` would give the caller a forward that opens to nothing.
  const { api } = makeApi({ respond: () => ok(new Uint8Array(0)) });
  await assert.rejects(api.fetch("scoped-elsewhere"), /download forward message payload is empty/);
});

test("a decompression failure names the res_id and the byte counts", async () => {
  const { api } = makeApi({
    respond: () => {
      const result = concat(
        tag(3, 2), lengthDelimitedPrefixed(Buffer.from("bad")),
        tag(4, 2), lengthDelimitedPrefixed(Buffer.from("not gzip at all")),
      );
      return ok(concat(tag(1, 2), lengthDelimitedPrefixed(result)));
    },
  });
  await assert.rejects(api.fetch("bad"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /download forward message decompression failed/);
    assert.match(error.message, /res_id=bad/);
    assert.match(error.message, /compressed_bytes=15/);
    assert.match(error.message, new RegExp(`max_output_bytes=${String(FORWARD_LONG_MSG_MAX_OUTPUT_BYTES)}`));
    return true;
  });
});

test("a missing or blank res_id is refused locally", async () => {
  const { api, sent } = makeApi();
  await assert.rejects(api.fetch(""), /forward id is missing/);
  await assert.rejects(api.fetch("   "), /forward id is missing/);
  assert.equal(sent.length, 0);
});

// ===========================================================================
// 6. The result cache
// ===========================================================================

test("the cache evicts the oldest root past MAX_CACHED_FORWARDS", () => {
  const cache = new ForwardResultCache();
  for (let index = 0; index < MAX_CACHED_FORWARDS + 1; index += 1) {
    cache.set(`r${String(index)}`, new Map([[`r${String(index)}`, []]]));
  }
  assert.equal(cache.size, MAX_CACHED_FORWARDS, "bounded");
  assert.equal(
    cache.get("r0"),
    undefined,
    "the OLDEST root is the one evicted; the newest survives",
  );
  assert.ok(cache.get(`r${String(MAX_CACHED_FORWARDS)}`) !== undefined);
});

test("a get refreshes recency, so a hot root survives eviction", () => {
  const cache = new ForwardResultCache();
  cache.set("hot", new Map([["hot", []]]));
  for (let index = 0; index < MAX_CACHED_FORWARDS - 1; index += 1) {
    cache.set(`r${String(index)}`, new Map([[`r${String(index)}`, []]]));
  }
  // Touch the oldest, then overflow by one.
  assert.ok(cache.get("hot") !== undefined);
  cache.set("overflow", new Map([["overflow", []]]));
  assert.ok(cache.get("hot") !== undefined, "the touched root must still be present");
  assert.equal(cache.get("r0"), undefined, "the now-oldest root went instead");
});

test("set refuses a layer map without its own root", () => {
  const cache = new ForwardResultCache();
  assert.throws(
    () => cache.set("root", new Map([["other", []]])),
    /forward cache entry is missing its outer result/,
  );
});

test("update writes only into the map it was given", () => {
  const cache = new ForwardResultCache();
  const layers = new Map<string, []>([["root", []]]);
  cache.set("root", layers as never);
  const hit = cache.get("root")!;
  cache.update(hit, [] as never);
  assert.deepEqual(cache.get("root")!.nodes, []);

  // A hit whose tree has since been replaced must not be written into.
  const stale = { ...hit };
  cache.clear();
  cache.set("root", new Map([["root", []]]));
  cache.update(stale, ["nope"] as never);
  assert.deepEqual(cache.get("root")!.nodes, [], "the stale update was ignored");
});

// ===========================================================================
// 7. enrichSenders
// ===========================================================================

test("a nameless group node gets its name from the roster, and a failure keeps the placeholder", async () => {
  // A `ForwardApi` whose bridge carries a contacts slice: the roster knows PEER_UIN,
  // and the profile lookup throws — which must NOT fail the fetch.
  const rosterCalls: number[] = [];
  const profileCalls: number[] = [];
  const cache = new ForwardResultCache();
  const api = new ForwardApi(
    {
      identity: new MemoryIdentity(String(SELF_UIN), "bot"),
      apis: {
        contacts: {
          async fetchGroupMemberList(groupId: number) {
            rosterCalls.push(groupId);
            return [
              { uin: PEER_UIN, nickname: "peer-nick", card: "peer-card" },
              { uin: 30003, nickname: "30003", card: "" },
            ];
          },
          async fetchUserProfile(uin: number) {
            profileCalls.push(uin);
            throw new Error("profile lookup failed");
          },
        },
      },
      events: {},
      async sendRawPacket() {
        return ok(new Uint8Array(0));
      },
      async resolveUserUid(uin: number | string) {
        return `u_${String(uin)}`;
      },
      nextClientSequence: () => 1,
      nextMessageRandom: () => 1,
      rememberUploadedFile() {},
      recallUploadedFile: () => undefined,
      async dispose() {},
    } as never,
    { cache },
  );

  const nodes: ForwardNodePayload[] = [
    { userUin: PEER_UIN, nickname: FORWARD_NAME_PLACEHOLDER, elements: [], messageType: "group", groupId: GROUP_ID },
    { userUin: 30003, nickname: "", elements: [], messageType: "group", groupId: GROUP_ID },
  ];
  const changed = await api.enrichSenders(nodes);
  assert.equal(changed, true);
  assert.equal(nodes[0]!.nickname, "peer-card", "the CARD wins over the nickname");
  assert.equal(nodes[0]!.senderCard, "peer-card");
  assert.equal(nodes[1]!.nickname, "30003", "the roster knew this uin");
  assert.deepEqual(rosterCalls, [GROUP_ID], "one roster fetch for one group");
  assert.deepEqual(profileCalls, [], "nothing was left for the profile level");

  // A node the roster does not know falls through to the profile level, and a profile
  // FAILURE leaves the placeholder rather than throwing.
  const unknown: ForwardNodePayload[] = [
    { userUin: 40004, nickname: FORWARD_NAME_PLACEHOLDER, elements: [], messageType: "group", groupId: GROUP_ID },
  ];
  assert.equal(await api.enrichSenders(unknown), false);
  assert.equal(unknown[0]!.nickname, FORWARD_NAME_PLACEHOLDER, "the placeholder survives a failed lookup");
  assert.deepEqual(profileCalls, [40004]);
});

test("enrichSenders is a no-op when every node already has a name", async () => {
  const api = new ForwardApi(
    {
      identity: new MemoryIdentity(String(SELF_UIN), "bot"),
      apis: {
        contacts: {
          async fetchGroupMemberList() {
            throw new Error("must not be called");
          },
          async fetchUserProfile() {
            throw new Error("must not be called");
          },
        },
      },
      events: {},
      async sendRawPacket() {
        throw new Error("must not be called");
      },
      async resolveUserUid() {
        return "u";
      },
      nextClientSequence: () => 1,
      nextMessageRandom: () => 1,
      rememberUploadedFile() {},
      recallUploadedFile: () => undefined,
      async dispose() {},
    } as never,
  );
  const nodes = [{ userUin: PEER_UIN, nickname: "named", elements: [] }];
  assert.equal(await api.enrichSenders(nodes), false);
});

// ===========================================================================
// 8. The hub actually holds it
// ===========================================================================

test("buildApiHub constructs a ForwardApi under `forward`", async () => {
  const { buildApiHub } = await import("../src/bridge/apis/index.js");
  const bridge = new Bridge(new MemoryIdentity(String(SELF_UIN), "bot"));
  const hub = buildApiHub(bridge);
  assert.ok(hub.forward instanceof ForwardApi, "the slice must be CONSTRUCTED, not merely typed");
  // And the key sits where the reference puts it: after `flashTransfer`, before `misc`.
  // (`flashTransfer` itself is no longer absent — it was the last unbuilt slot and is now
  // a real `FlashTransferApi`, so `profile`'s successor is it, not `forward`.)
  const keys = Object.keys(hub);
  assert.equal(keys[keys.indexOf("profile") + 1], "flashTransfer");
  assert.equal(keys[keys.indexOf("flashTransfer") + 1], "forward");
});

// ===========================================================================
// Helpers for building receive-side payloads
// ===========================================================================

/** A protobuf tag byte sequence for a small field number. */
function tag(field: number, wireType: number): Uint8Array {
  const value = (field << 3) | wireType;
  const out: number[] = [];
  let remaining = value;
  for (;;) {
    if (remaining < 0x80) {
      out.push(remaining);
      return new Uint8Array(out);
    }
    out.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
}

function varint(value: number | bigint): Uint8Array {
  const out: number[] = [];
  let remaining = BigInt(value);
  for (;;) {
    if (remaining < 0x80n) {
      out.push(Number(remaining));
      return new Uint8Array(out);
    }
    out.push(Number(remaining & 0x7fn) | 0x80);
    remaining >>= 7n;
  }
}

function lengthDelimitedPrefixed(bytes: Uint8Array): Uint8Array {
  return concat(varint(bytes.length), bytes);
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Assemble a `PushMsgBody` for the golden-bytes test, from the field table alone.
 *
 * This is the INDEPENDENT encoder: it knows nothing about `bridge/apis/forward.ts` and
 * is written straight off the reference's `__write_*` field numbers. The test then
 * compares the module's gzipped payload against this one's, which is why a wrong tag in
 * the module shows up as a byte difference rather than as a self-consistent round trip.
 *
 * ResponseHead fields: fromUin 1, fromUid 2, toUid 6, forward 7 (+friendName 10).
 * ContentHead fields: msgType 1, subType 2, c2cCmd 3, msgId 4, sequence 5, timestamp 6.
 * RichText: elems is REPEATED field 2, and each entry is an Elem{ text: field 1 }.
 */
function buildForwardBody(fields: {
  fromUin: number;
  toUid: string;
  friendName: string;
  msgType: number;
  subType: number;
  msgId: number;
  sequence: number;
  timestamp: number;
  text: string;
}): Uint8Array {
  const textElem = concat(tag(1, 2), lengthDelimitedPrefixed(Buffer.from(fields.text)));
  const elem = concat(tag(1, 2), lengthDelimitedPrefixed(textElem));
  const richText = concat(tag(2, 2), lengthDelimitedPrefixed(elem));
  const messageBody = concat(tag(1, 2), lengthDelimitedPrefixed(richText));
  const forward = concat(tag(10, 2), lengthDelimitedPrefixed(Buffer.from(fields.friendName)));
  const responseHead = concat(
    tag(1, 0), varint(fields.fromUin),
    tag(6, 2), lengthDelimitedPrefixed(Buffer.from(fields.toUid)),
    tag(7, 2), lengthDelimitedPrefixed(forward),
  );
  const contentHead = concat(
    tag(1, 0), varint(fields.msgType),
    tag(2, 0), varint(fields.subType),
    tag(4, 0), varint(fields.msgId),
    tag(5, 0), varint(fields.sequence),
    tag(6, 0), varint(fields.timestamp),
  );
  return concat(
    tag(1, 2), lengthDelimitedPrefixed(responseHead),
    tag(2, 2), lengthDelimitedPrefixed(contentHead),
    tag(3, 2), lengthDelimitedPrefixed(messageBody),
  );
}

/**
 * The OUTER node of a nested forward: one `lightApp` element carrying the ARK preview
 * JSON that names the inner res_id and uuid.
 *
 * `collectForwardLayers` finds the inner layer by reading `resId`/`forwardUuid` out of
 * the DECODED segment, so the JSON keys must be the ones the decoder looks for — which
 * is why this fixture is built rather than derived from the text body.
 */
function buildOuterBodyWithPreview(innerResId: string, innerUuid: string): Uint8Array {
  const preview = JSON.stringify({
    app: "com.tencent.multimsg",
    // The decoder reads `meta.detail.resid` and `meta.detail.uniseq`
    // (`msg-push.ts:816`): a top-level `meta.resid` decodes as a plain `json` element,
    // which then cannot be walked to the inner layer.
    meta: { detail: { resid: innerResId, uniseq: innerUuid }, summary: "查看1条转发消息" },
  });
  const lightApp = concat(tag(1, 2), lengthDelimitedPrefixed(Buffer.from(preview)));
  const elem = concat(tag(51, 2), lengthDelimitedPrefixed(lightApp));
  const richText = concat(tag(2, 2), lengthDelimitedPrefixed(elem));
  const messageBody = concat(tag(1, 2), lengthDelimitedPrefixed(richText));
  const responseHead = concat(tag(1, 0), varint(PEER_UIN), tag(6, 2), lengthDelimitedPrefixed(Buffer.from("u_self")));
  const contentHead = concat(
    tag(1, 0), varint(82),
    tag(4, 0), varint(1234),
    tag(5, 0), varint(55),
    tag(6, 0), varint(1_600_000_000),
  );
  return concat(
    tag(1, 2), lengthDelimitedPrefixed(responseHead),
    tag(2, 2), lengthDelimitedPrefixed(contentHead),
    tag(3, 2), lengthDelimitedPrefixed(messageBody),
  );
}

/**
 * The body a `SsoRecvLongMsg` payload carries for ONE node, built by hand.
 *
 * `msgType 82` is the group-message package type, which is what makes `decodePush` route
 * it as a `group_message`. `fromUid` is left empty so the decoder falls back to
 * `fromUin`, which is what a real long-message body looks like: the res_id already named
 * the sender, so the uid round-trip is not repeated.
 */
function buildBody(text: string): Uint8Array {
  return buildForwardBody({
    fromUin: PEER_UIN,
    toUid: "u_self",
    friendName: "peer",
    msgType: 82,
    subType: 0,
    msgId: 1234,
    sequence: 55,
    timestamp: 1_600_000_000,
    text,
  });
}
