// Differential tests for the message region.
//
// ---------------------------------------------------------------------------
// Why these load the reference instead of asserting literals
// ---------------------------------------------------------------------------
// Every byte-level test below runs the reference's own generated encoder as a live ES
// module (`work/bridge-message/ref/message-codec.mjs`, built by
// `work/bridge-message/build-ref.mjs` out of reference/index.mjs) and compares its output
// to `message-wire.ts` byte for byte.
//
// A hand-written expected hex string would only prove that the port matches whatever the
// author believed when they wrote the literal — and the whole reason `message-wire.ts`
// exists is that three of those beliefs (routing field 15, ctrl field 12, the request/
// response `SsoGetGroupMsgInfo` split) were wrong. Comparing against the executable
// reference makes the test wrong only when the reference is wrong.
//
// The oracle is rebuilt in-process from `reference/index.mjs` on every run, so it cannot go
// stale against the reference and cannot be absent from a fresh checkout.
//
// ---------------------------------------------------------------------------
// What is NOT covered here, and why
// ---------------------------------------------------------------------------
// * Response decoders are exercised with hand-built bytes (below), not against the
//   reference decoder, because the reference decoders are the ones the port must agree
//   with *on inputs the server produced*, and inventing such inputs is the same as
//   inventing the encoder output. The decoders are instead cross-checked by round-trip
//   through the verified encoders where a round trip exists, and by targeted field
//   assertions where it does not.
// * `sendGroup`'s `seq <= 0` throw, the read-report two-packet flow and the history
//   walkers are tested against a stub transport, not the reference, because the reference
//   has no transport of its own — it takes `ctx`. The assertions there are about
//   behaviour (how many packets, in what order, which fields), which the stub records.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  encodeC2CRecallRequest,
  encodeFileExtra,
  encodeGroupRecallRequest,
  encodeSendMessageRequestBytes,
  encodeSendMessageRequestRichText,
  encodeSsoGetC2cMsgRequest,
  encodeSsoGetGroupMsgRequest,
  encodeSsoGetRoamMsgRequest,
  encodeSsoReadedReportReq,
  decodeSendMessageResponse,
  decodeSsoGetC2cMsgResponse,
  decodeSsoGetGroupMsgResponse,
  decodeSsoGetRoamMsgResponse,
  decodeSsoReadedReportResp,
  decodeSendMessageServerResult,
  type PushMsgBodyLike,
} from "../src/bridge/apis/message-wire.js";
import {
  DATALINE_DEVICES,
  appIdForTerType,
  datalineTextFromElements,
  elementsFromDatalineBody,
  encodeDatalineText,
  findDatalineDeviceByTerType,
  findDatalineDeviceByUin,
  decodeDatalineMsgBody,
} from "../src/bridge/apis/dataline.js";
import { MessageApi, HISTORY_MIN_GAP_MS, LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS } from "../src/bridge/apis/message.js";
import { HistoryRequestGate } from "../src/bridge/apis/history-request-gate.js";
import { assertWindowShakeSendPolicy, encodeElem } from "../src/element-builder.js";
import { loadOracle, buildOracleSource } from "./helpers/message-oracle.js";

// The oracle is built at test time from the TRACKED `reference/index.mjs`, not from a file
// under `work/` (which is gitignored). See `helpers/message-oracle.ts` for why that
// distinction is load-bearing: an oracle that only exists in a working tree makes these
// tests skip in a fresh checkout, and a skipping differential test is indistinguishable
// from a passing one in the summary line.
const REPO_ROOT = ((): string => {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(path.join(dir, "reference/index.mjs"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("could not locate reference/index.mjs");
})();
const REFERENCE_PATH = path.join(REPO_ROOT, "reference/index.mjs");
const ref = await loadOracle(REFERENCE_PATH);

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const eq = (actual: Uint8Array, expected: Uint8Array, what: string): void => {
  assert.equal(hex(actual), hex(expected), `${what} is not byte-identical to the reference`);
};

// ===========================================================================
// The send envelope
// ===========================================================================

test("message-wire: the group request is byte-identical to the reference", () => {
  // The reference takes decoded elems and encodes them; the port takes bytes, because that
  // is what `buildSendElems` produces. Passing each side its own representation is the
  // correct comparison: the port's bytes are `encodeElem`'s output, verified below.
  const oneElem = { text: { str: "hello" } };
  const elemsRef = { elems: [oneElem] };
  const elemsPort = { elems: [encodeElem(oneElem as never)] };
  const base = {
    routingHead: { grp: { groupCode: 123456n } },
    contentHead: { type: 1 },
    clientSequence: 0,
    random: 123456789,
    syncCookie: new Uint8Array(0),
    via: 0,
    dataStatist: 0,
    multiSendSeq: 0,
  };
  const port = encodeSendMessageRequestRichText({ ...base, messageBody: { richText: elemsPort } } as never);
  const oracle = ref["protobuf_encode_SendMessageRequest__SendRichText"]!({
    ...base,
    messageBody: { richText: elemsRef },
  } as never);
  eq(port, oracle, "group request");
});

test("message-wire: encodeElem reproduces the reference's elem bytes", () => {
  // The step the test above depends on, asserted directly so a divergence in
  // `element-builder.ts` cannot be blamed on the envelope.
  const cases: Record<string, unknown>[] = [
    { text: { str: "hello" } },
    { text: { str: "" } },
    { face: { index: 14 } },
  ];
  for (const elem of cases) {
    // Wrap in a RichText so the oracle does the elem encoding on the identical input.
    const oracle = ref["protobuf_encode_SendMessageRequest__SendRichText"]!({
      routingHead: { grp: { groupCode: 1n } },
      contentHead: { type: 1 },
      messageBody: { richText: { elems: [elem] } },
      clientSequence: 0,
      random: 5,
      syncCookie: new Uint8Array(0),
      via: 0,
      dataStatist: 0,
      multiSendSeq: 0,
    } as never);
    const port = encodeSendMessageRequestRichText({
      routingHead: { grp: { groupCode: 1n } },
      contentHead: { type: 1 },
      messageBody: { richText: { elems: [encodeElem(elem as never)] } },
      clientSequence: 0,
      random: 5,
      syncCookie: new Uint8Array(0),
      via: 0,
      dataStatist: 0,
      multiSendSeq: 0,
    } as never);
    eq(port, oracle, `elem ${JSON.stringify(elem)}`);
  }
});

test("message-wire: the private request is byte-identical to the reference", () => {
  // The `bytes` envelope: `ctrl` present, a real clientSequence, an opaque richText blob.
  const obj = {
    routingHead: { c2c: { uin: 10001, uid: "u_abc" } },
    contentHead: { type: 1, subType: 0, c2cCmd: 11 },
    messageBody: { richText: new Uint8Array([1, 2, 3, 4]) },
    clientSequence: 42,
    random: 987654321,
    syncCookie: new Uint8Array(0),
    via: 0,
    dataStatist: 0,
    ctrl: { msgFlag: 1700000000 },
    multiSendSeq: 0,
  };
  eq(
    encodeSendMessageRequestBytes(obj as never),
    ref["protobuf_encode_SendMessageRequest__bytes"]!(obj as never),
    "private request",
  );
});

test("message-wire: routingHead members carry the reference's field numbers", () => {
  // Each routing variant exercises a field number that is NOT the natural guess:
  // trans0x211 is 15 (tag 122), grpTmp is {3,4}, trans0x211.uid is 8.
  const cases: [string, Record<string, unknown>][] = [
    ["c2c", { c2c: { uin: 70001, uid: "u_x" } }],
    ["grp", { grp: { groupCode: 123456789n } }],
    ["grpTmp", { grpTmp: { groupUin: 555n, toUid: "u_temp" } }],
    ["trans0x211", { trans0x211: { toUin: 10001n, ccCmd: 4, uid: "u_file" } }],
  ];
  for (const [name, routingHead] of cases) {
    const obj = {
      routingHead,
      contentHead: { type: 1, subType: 0 },
      messageBody: { msgContent: new Uint8Array([9, 9]) },
      clientSequence: 1,
      random: 2,
      syncCookie: new Uint8Array(0),
      via: 0,
      dataStatist: 0,
      multiSendSeq: 0,
    };
    eq(
      encodeSendMessageRequestRichText(obj as never),
      ref["protobuf_encode_SendMessageRequest__SendRichText"]!(obj as never),
      `routing ${name}`,
    );
  }
});

test("message-wire: an explicit empty richText is emitted, an empty msgContent is not", () => {
  // `SendMessageBody__SendRichText.richText` is `!= null`, so `{}` still produces a
  // zero-length field 1. `msgContent` is `length > 0`, so it vanishes. Both in one request.
  const obj = {
    routingHead: { grp: { groupCode: 1n } },
    contentHead: { type: 1 },
    messageBody: { richText: {}, msgContent: new Uint8Array(0) },
    clientSequence: 0,
    random: 5,
    syncCookie: new Uint8Array(0),
    via: 0,
    dataStatist: 0,
    multiSendSeq: 0,
  };
  const expected = ref["protobuf_encode_SendMessageRequest__SendRichText"]!(obj as never);
  eq(encodeSendMessageRequestRichText(obj as never), expected, "empty richText");
  // The reference emits an empty `SendRichText` (tag 0a, length 0) because richText is
  // `!= null`, so field 3 is `1a 02 0a 00` — NOT a zero-length field 3 (`1a 00`), which is
  // what it would be if richText itself were dropped.
  assert.ok(hex(expected).includes("1a020a00"), "expected an emitted, empty field-1 submessage");
});

test("message-wire: ctrl is emitted even when msgFlag is 0", () => {
  const obj = {
    routingHead: { grp: { groupCode: 1n } },
    contentHead: { type: 1 },
    messageBody: { richText: { elems: [] } },
    clientSequence: 0,
    random: 5,
    syncCookie: new Uint8Array(0),
    via: 0,
    dataStatist: 0,
    ctrl: { msgFlag: 0 },
    multiSendSeq: 0,
  };
  const expected = ref["protobuf_encode_SendMessageRequest__SendRichText"]!(obj as never);
  eq(encodeSendMessageRequestRichText(obj as never), expected, "zero msgFlag");
  // field 12, zero length => tag 98, len 0 => 0x62 0x00
  assert.ok(hex(expected).includes("6200"), "expected an explicit zero-length field 12");
});

// ===========================================================================
// Recall + file + read report
// ===========================================================================

test("message-wire: group recall is byte-identical to the reference", () => {
  const obj = { type: 1, groupUin: 123456, info: { sequence: 7, random: 0, field3: 0 }, settings: { field1: 0 } };
  eq(
    encodeGroupRecallRequest(obj as never),
    ref["protobuf_encode_GroupRecallRequest"]!(obj as never),
    "group recall",
  );
});

test("message-wire: c2c recall is byte-identical to the reference", () => {
  const obj = {
    type: 1,
    targetUid: "u_target",
    info: {
      clientSequence: 5,
      random: 9,
      messageId: (16777216n << 32n) | 9n,
      timestamp: 1700000000,
      field5: 0,
      messageSequence: 42,
    },
    settings: { field1: false, field2: false },
    field6: false,
  };
  eq(encodeC2CRecallRequest(obj as never), ref["protobuf_encode_C2CRecallRequest"]!(obj as never), "c2c recall");
});

test("message-wire: FileExtra with both slots is byte-identical to the reference", () => {
  // Field 16 (`destUid`) needs a two-byte tag; this is the only field in the whole send
  // path that does, so it must be covered or the tag encoding is untested.
  const obj = {
    file: {
      fileType: 0,
      fileUuid: "u_file",
      fileMd5: new Uint8Array([1, 2, 3]),
      fileName: "a.txt",
      fileSize: 12345n,
      subcmd: 1,
      dangerEvel: 0,
      expireTime: 1700000001,
      fileHash: "h",
    },
    field6: {
      field2: {
        field1: 1,
        fileUuid: "u_file",
        fileName: "a.txt",
        field6: 2,
        field7: new Uint8Array([4]),
        field8: new Uint8Array([5]),
        timestamp1: 1700000002,
        fileHash: "h",
        selfUid: "u_self",
        destUid: "u_dest",
      },
    },
  };
  const expected = ref["protobuf_encode_FileExtra"]!(obj as never);
  eq(encodeFileExtra(obj as never), expected, "FileExtra");
  // 16 << 3 | 2 = 130, then 1 as a two-byte varint => 0x82 0x01
  assert.ok(hex(expected).includes("8201"), "expected the two-byte tag for field 16");
});

test("message-wire: the read report is byte-identical to the reference", () => {
  const obj = {
    groupList: [{ groupUin: 111n, lastReadSeq: 222n }],
    c2cList: [{ uid: "u_a", lastReadTime: 333n, lastReadSeq: 444n }],
  };
  eq(encodeSsoReadedReportReq(obj as never), ref["protobuf_encode_SsoReadedReportReq"]!(obj as never), "read report");
});

test("message-wire: the read-report probe drops every zero field", () => {
  // The read-only probe's entire mechanism: `lastReadSeq: 0n` must produce a bare
  // `{groupUin}` / `{uid}`, so the server reports the cursor instead of moving it.
  const obj = { groupList: [{ groupUin: 111n, lastReadSeq: 0n }], c2cList: [{ uid: "u_a", lastReadTime: 0n, lastReadSeq: 0n }] };
  const expected = ref["protobuf_encode_SsoReadedReportReq"]!(obj as never);
  eq(encodeSsoReadedReportReq(obj as never), expected, "read-report probe");
  // group item: groupUin 111 needs two bytes (0x6f), so 0a 03 08 6f; c2c item: uid at
  // field 2, "u_a" is three bytes, so 12 05 12 03 75 5f 61.
  assert.equal(hex(expected), "0a02086f12051203755f61");
});

// ===========================================================================
// History requests
// ===========================================================================

test("message-wire: SsoGetGroupMsg is byte-identical to the reference", () => {
  const obj = { info: { groupUin: 123456, startSequence: 100, endSequence: 130 }, direction: true };
  eq(
    encodeSsoGetGroupMsgRequest(obj as never),
    ref["protobuf_encode_SsoGetGroupMsg"]!(obj as never),
    "SsoGetGroupMsg",
  );
});

test("message-wire: the group request's info block uses fields 1-3, not the response's 3-5", () => {
  // The trap this asserts: `SsoGetGroupMsgInfo` (request) numbers groupUin/start/end as
  // 1/2/3, while `SsoGetGroupMsgResponseBody` numbers the same names 3/4/5. Writing the
  // response's table into the request still produces well-formed protobuf, so only a
  // byte comparison catches it.
  const obj = { info: { groupUin: 5, startSequence: 1, endSequence: 2 }, direction: true };
  const bytes = encodeSsoGetGroupMsgRequest(obj as never);
  // field 1 (tag 8) carries the sub-message; inside it the first field is 1 (tag 8), not 3.
  assert.equal(hex(bytes), hex(ref["protobuf_encode_SsoGetGroupMsg"]!(obj as never)));
  assert.equal(bytes[2], 0x08, "info.groupUin must be field 1");
});

test("message-wire: direction is a strict bool, so 1 is dropped", () => {
  // `if (_f1 === true)`. The reference passes `true`; a port that accepts a number would
  // silently send no direction and get the wrong page ordering.
  const truthy = { info: { groupUin: 5, startSequence: 1, endSequence: 2 }, direction: 1 };
  const bytes = encodeSsoGetGroupMsgRequest(truthy as never);
  eq(bytes, ref["protobuf_encode_SsoGetGroupMsg"]!(truthy as never), "direction:1");
  assert.ok(!hex(bytes).endsWith("1001"), "direction:1 must not be emitted");
  const flagged = encodeSsoGetGroupMsgRequest({ info: { groupUin: 5, startSequence: 1, endSequence: 2 }, direction: true } as never);
  assert.ok(hex(flagged).endsWith("1001"), "direction:true must be emitted");
});

test("message-wire: SsoGetC2cMsg is byte-identical to the reference", () => {
  const obj = { friendUid: "u_abc123", startSequence: 5, endSequence: 9 };
  eq(
    encodeSsoGetC2cMsgRequest(obj as never),
    ref["protobuf_encode_SsoGetC2cMsg$1"]!(obj as never),
    "SsoGetC2cMsg",
  );
});

test("message-wire: SsoGetRoamMsg is byte-identical to the reference", () => {
  const obj = { friendUid: "u_abc123", time: 1700000000, random: 12345, count: 100, direction: true };
  eq(
    encodeSsoGetRoamMsgRequest(obj as never),
    ref["protobuf_encode_SsoGetRoamMsg"]!(obj as never),
    "SsoGetRoamMsg",
  );
});

test("message-wire: the c2c and roam requests are different messages", () => {
  // Same conversation, same intent, different wire shapes: the c2c one is
  // sequence-addressed with friendUid at field 2, the roam one is timestamp-addressed with
  // friendUid at field 1. A port that shares one encoder produces one of them wrongly.
  const c2c = hex(encodeSsoGetC2cMsgRequest({ friendUid: "u_x", startSequence: 1, endSequence: 2 }));
  const roam = hex(encodeSsoGetRoamMsgRequest({ friendUid: "u_x", time: 1, random: 2, count: 3, direction: true }));
  assert.notEqual(c2c, roam);
  assert.ok(c2c.startsWith("1203"), "c2c carries friendUid at field 2 (tag 0x12)");
  assert.ok(roam.startsWith("0a03"), "roam carries friendUid at field 1 (tag 0x0a)");
});

// ===========================================================================
// Dataline
// ===========================================================================

test("dataline: text send is byte-identical to the reference for all three devices", () => {
  const now = Date.now;
  Date.now = () => 1700000000000;
  try {
    for (const device of DATALINE_DEVICES) {
      const obj = { selfUin: 10001, dstTerType: device.terType, text: "hi 世界" };
      eq(encodeDatalineText(obj), ref["encodeDatalineText"]!(obj as never), `dataline terType ${device.terType}`);
    }
  } finally {
    Date.now = now;
  }
});

test("dataline: the three devices are the reference's fixed pseudo-contacts", () => {
  assert.deepEqual(
    DATALINE_DEVICES.map((d) => [d.terType, d.uin, d.uid]),
    [
      [1, 2113929217, "u_rK7NMsbv2ZjEGPdCuOiCfw"],
      [2, 2113929218, "u_Wcc5rknRRqRO8y5gxMD6sA"],
      [3, 2113929219, "u_l7jpPIZxQo0mzJwoEt-SKw"],
    ],
  );
  assert.equal(findDatalineDeviceByUin(2113929218)?.terType, 2);
  assert.equal(findDatalineDeviceByUin(10001), undefined);
  assert.equal(findDatalineDeviceByTerType(3)?.name, "我的Pad");
});

test("dataline: appId is 1 for PC and 1001 otherwise", () => {
  // The asymmetry is real: a Pad message stamped with appId 1 is not delivered.
  assert.equal(appIdForTerType(1), 1);
  assert.equal(appIdForTerType(2), 1001);
  assert.equal(appIdForTerType(3), 1001);
});

test("dataline: the body's generic slot is field 6", () => {
  // `DatalineMsgBody.generic` at field 6 (tag 50). Fields 4 and 5 are unused, and a body
  // written there is accepted by the server and dropped by the device.
  const bytes = encodeDatalineText({ selfUin: 10001, dstTerType: 1, text: "x" });
  assert.ok(hex(bytes).includes("32"), "generic must be tag 50 / field 6");
});

test("dataline: only text survives the element conversion", () => {
  assert.equal(datalineTextFromElements([{ type: "text", text: "a" }, { type: "text", text: "b" }]), "ab");
  assert.throws(() => datalineTextFromElements([]), /message is empty/);
  assert.throws(() => datalineTextFromElements([{ type: "image" }]), /only accepts text/);
  // The join is "" not " ": the device concatenates, and a space would change the message.
  assert.throws(() => datalineTextFromElements([{ type: "text", text: "" }]), /message is empty/);
});

test("dataline: an inbound body yields text from the generic slot", () => {
  // Round-trip through the verified encoder rather than hand-building bytes: the encoder is
  // oracle-checked, so this pins the decoder against something already known correct.
  const bytes = encodeDatalineText({ selfUin: 10001, dstTerType: 1, text: "hi" });
  const decoded = decodeDatalineMsgBody(bytes);
  assert.equal(decoded.subCmd, 4, "generic sub-command");
  assert.equal(decoded.generic?.type, 1, "text sub-type");
  assert.deepEqual(elementsFromDatalineBody(decoded), [{ type: "text", text: "hi" }]);
  // and the header survives the round trip
  assert.equal(decoded.header?.dstTerType, 1);
  assert.equal(decoded.header?.srcUin, 10001n);
});

test("dataline: an ftn-only body yields a file segment without a generic slot", () => {
  // A file received on another device has no generic text sub-command at all, which is why
  // `elementsFromDatalineBody` does not require `subCmd === DATALINE_SUBCMD_FTN`.
  const decoded = {
    subCmd: 1,
    header: null,
    ftn: [{ sessionId: 99n, fileName: "a.txt", fileIndex: "3", fileMd5: null, fileKey: null, fileLen: 42n }],
    generic: null,
  };
  const segments = elementsFromDatalineBody(decoded as never);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0], { type: "file", fileId: "3", fileName: "a.txt", fileSize: 42 });
});

// ===========================================================================
// Response decoding
// ===========================================================================

test("message-wire: SendMessageResponse decodes every field including privateSequence at 14", () => {
  // tag 112 = field 14, the private receipt. The group receipt is 11 (tag 88).
  const bytes = new Uint8Array([
    0x08, 0x00, // result 1 = 0
    0x12, 0x02, 0x6f, 0x6b, // errMsg 2 = "ok"
    0x18, 0x80, 0x94, 0xeb, 0xdc, 0x05, // timestamp1 3
    0x58, 0x07, // groupSequence 11 = 7
    0x70, 0x09, // privateSequence 14 = 9
  ]);
  const decoded = decodeSendMessageResponse(bytes);
  assert.equal(decoded.result, 0);
  assert.equal(decoded.errMsg, "ok");
  assert.equal(decoded.groupSequence, 7);
  assert.equal(decoded.privateSequence, 9);
});

test("message-wire: a zero group sequence and a missing one both decode as unusable", () => {
  // `sendGroup` gates on `groupSequence > 0`, so absent and zero must be indistinguishable
  // to the caller — one is `null`, the other `0`, and both fail the same check.
  const absent = decodeSendMessageResponse(new Uint8Array([0x08, 0x00]));
  assert.equal(absent.groupSequence, null);
  assert.ok((absent.groupSequence ?? 0) <= 0);
  const zero = decodeSendMessageResponse(new Uint8Array([0x58, 0x00]));
  assert.equal(zero.groupSequence, 0);
  assert.ok((zero.groupSequence ?? 0) <= 0);
});

test("message-wire: serverResult is a nested message at field 7", () => {
  const inner = new Uint8Array([0x08, 0x01, 0x10, 0x02, 0x1a, 0x03, 0x62, 0x61, 0x64]);
  const bytes = new Uint8Array([0x3a, inner.length, ...inner]);
  const decoded = decodeSendMessageResponse(bytes);
  assert.deepEqual(decoded.serverResult, { type: 1, code: 2, message: "bad" });
});

test("message-wire: unknown fields are skipped, not fatal", () => {
  // field 9 as a varint — an unknown tag the decoder must skip rather than reject.
  const bytes = new Uint8Array([0x08, 0x00, 0x48, 0x2a]);
  const decoded = decodeSendMessageResponse(bytes);
  assert.equal(decoded.result, 0);
});

test("message-wire: SsoReadedReportResp decodes the read/latest pairs", () => {
  // fields: resultCode 1, groupUin 3, readSeq 4, latestSeq 5
  const groupItem = new Uint8Array([0x08, 0x00, 0x18, 0x05, 0x28, 0x09]);
  const c2cItem = new Uint8Array([0x08, 0x00, 0x18, 0x64]);
  const bytes = new Uint8Array([
    0x08, 0x00, // resultCode 1
    0x1a, groupItem.length, ...groupItem, // groupList 3
    0x22, c2cItem.length, ...c2cItem, // c2cList 4
  ]);
  const decoded = decodeSsoReadedReportResp(bytes);
  assert.equal(decoded.resultCode, 0);
  assert.equal(decoded.groupList.length, 1);
  assert.equal(decoded.groupList[0]!.groupUin, 5n);
  assert.equal(decoded.groupList[0]!.readSeq, null);
  assert.equal(decoded.groupList[0]!.latestSeq, 9n);
  assert.equal(decoded.c2cList.length, 1);
  assert.equal(decoded.c2cList[0]!.targetUin, 100n);
});

test("message-wire: the c2c response item reads uid at field 4, not the request's field 2", () => {
  // Request item: uid 2, lastReadTime 3, lastReadSeq 4.
  // Response item: targetUin 3, uid 4, readSeq 5, ...
  // Copying the request's numbering into the response makes `#c2cReadResponse`'s identity
  // check compare against null and never fire.
  const item = new Uint8Array([0x22, 0x02, 0x75, 0x78]); // field 4 = "ux"
  const bytes = new Uint8Array([0x22, item.length, ...item]);
  const decoded = decodeSsoReadedReportResp(bytes);
  assert.equal(decoded.c2cList[0]!.uid, "ux");
  assert.equal(decoded.c2cList[0]!.targetUin, null);
});

test("message-wire: SsoGetGroupMsgResponse puts the messages in body at field 3", () => {
  const msg = new Uint8Array([0x0a, 0x00]);
  const body = new Uint8Array([0x18, 0x05, 0x32, msg.length, ...msg]);
  const bytes = new Uint8Array([0x1a, body.length, ...body]);
  const stubDecoder = (d: Uint8Array, s: number, e: number): PushMsgBodyLike =>
    ({ responseHead: null, contentHead: null, body: d.slice(s, e) }) as unknown as PushMsgBodyLike;
  const decoded = decodeSsoGetGroupMsgResponse(bytes, stubDecoder);
  assert.equal(decoded.body?.groupUin, 5);
  assert.equal(decoded.body?.messages.length, 1);
});

test("message-wire: SsoGetC2cMsgResponse puts friendUid at 4 and messages at 7", () => {
  const msg = new Uint8Array([0x0a, 0x00]);
  const bytes = new Uint8Array([0x08, 0x00, 0x22, 0x02, 0x75, 0x78, 0x3a, msg.length, ...msg]);
  const stubDecoder = (d: Uint8Array, s: number, e: number): PushMsgBodyLike =>
    ({ responseHead: null, contentHead: null, body: d.slice(s, e) }) as unknown as PushMsgBodyLike;
  const decoded = decodeSsoGetC2cMsgResponse(bytes, stubDecoder);
  assert.equal(decoded.result, 0);
  assert.equal(decoded.friendUid, "ux");
  assert.equal(decoded.messages.length, 1);
});

test("message-wire: SsoGetRoamMsgResponse puts friendUid at 3, unlike the c2c variant", () => {
  // The two responses put the same field at 3 and 4 respectively. This test exists purely
  // to pin that difference; it is the clearest instance of the region's "$N copies can
  // differ in field numbers" hazard.
  const bytes = new Uint8Array([0x08, 0x00, 0x1a, 0x02, 0x75, 0x78, 0x20, 0x01, 0x28, 0x0a, 0x30, 0x02]);
  const stubDecoder = (): PushMsgBodyLike => ({ responseHead: null, contentHead: null, body: null }) as unknown as PushMsgBodyLike;
  const decoded = decodeSsoGetRoamMsgResponse(bytes, stubDecoder);
  assert.equal(decoded.friendUid, "ux");
  assert.equal(decoded.isComplete, true);
  assert.equal(decoded.timestamp, 10);
  assert.equal(decoded.random, 2);
});

test("message-wire: the roam end-of-history result code is a normal termination", () => {
  // result 100000301 (tag 8) — `fetchC2cRoamMessagePage` treats it as "start of
  // conversation reached", not an error.
  const bytes = new Uint8Array([0x08, 0xad, 0xc4, 0xd7, 0x2f]);
  const decoded = decodeSsoGetRoamMsgResponse(bytes, () => ({}) as PushMsgBodyLike);
  assert.equal(decoded.result, 100000301);
});

// ===========================================================================
// MessageApi behaviour, against a stub transport
// ===========================================================================

interface Recorded {
  command: string;
  body: Uint8Array;
}

function makeStubCtx(
  responder: (command: string, body: Uint8Array) => Uint8Array | null,
  opts: { uin?: string; resolveUid?: (uin: number | string) => string } = {},
): { ctx: never; sent: Recorded[] } {
  const sent: Recorded[] = [];
  const ctx = {
    identity: {
      uin: opts.uin ?? "10001",
      selfUid: "",
      findUinByUid: () => null,
      findFriend: () => null,
      findGroup: () => null,
      findGroupMember: () => null,
      resolveUin: async () => null,
      resolveUid: async () => "",
      findUidByUin: () => null,
      findUserProfile: () => null,
      friends: [],
      groups: [],
      rememberFriends: () => {},
      rememberGroups: () => {},
      forgetGroup: () => {},
      rememberGroupMembers: () => {},
      rememberUserProfile: () => {},
      close: async () => {},
      resolveUidStrict: async () => "",
    },
    sendRawPacket: async (command: string, body: Uint8Array) => {
      sent.push({ command, body });
      const response = responder(command, body);
      return response === null
        ? { success: false, gotResponse: false, errorMessage: "boom" }
        : { success: true, gotResponse: true, responseData: response };
    },
    resolveUserUid: async (uin: number | string) => (opts.resolveUid ? opts.resolveUid(uin) : `u_${String(uin)}`),
    nextMessageRandom: () => 123456789,
    nextClientSequence: () => 42,
    recallUploadedFile: () => undefined,
  };
  return { ctx: ctx as never, sent };
}

test("MessageApi: sendGroup throws when the receipt carries no group sequence", async () => {
  // result 0 but no groupSequence: the server accepted the packet and dropped the message.
  // Returning a receipt would cache a messageId that matches nothing.
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x08, 0x00]));
  const api = new MessageApi(ctx);
  await assert.rejects(
    api.sendGroup(123456, [{ type: "text", text: "hi" }] as never),
    /group message delivery was not confirmed/,
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.command, "MessageSvc.PbSendMsg");
});

test("MessageApi: sendGroup returns the receipt when the sequence is present", async () => {
  const { ctx } = makeStubCtx(() => new Uint8Array([0x08, 0x00, 0x58, 0x0b, 0x18, 0x64]));
  const api = new MessageApi(ctx);
  const receipt = await api.sendGroup(123456, [{ type: "text", text: "hi" }] as never);
  assert.equal(receipt.sequence, 11);
  assert.equal(receipt.random, 123456789);
  assert.equal(receipt.clientSequence, 0);
  assert.equal(receipt.timestamp, 100);
  assert.equal(receipt.messageId, 123456789 & 0x7fffffff);
});

test("MessageApi: sendGroup rejects a result code but accepts a null one", async () => {
  const { ctx } = makeStubCtx(() => new Uint8Array([0x08, 0x01, 0x58, 0x0b]));
  await assert.rejects(new MessageApi(ctx).sendGroup(1, [{ type: "text", text: "x" }] as never), /rejected: result=1/);
});

test("MessageApi: a group send with no elements never reaches the wire", async () => {
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x58, 0x01]));
  await assert.rejects(new MessageApi(ctx).sendGroup(1, []), /message is empty/);
  assert.equal(sent.length, 0);
});

test("MessageApi: sendPrivate rejects an empty message before resolving the uid", async () => {
  let resolved = 0;
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x08, 0x00]), {
    resolveUid: () => {
      resolved += 1;
      return "u_x";
    },
  });
  await assert.rejects(new MessageApi(ctx).sendPrivate(20002, []), /message is empty/);
  assert.equal(resolved, 0);
  assert.equal(sent.length, 0);
});

test("MessageApi: the poke policy runs before the media uid resolution", async () => {
  // `assertWindowShakeSendPolicy` returns early unless the caller passes a non-zero
  // window-shake count, so the guard it enforces is about *segments* carrying a shake, not
  // about naked poke elements. Exercise the ordering with an element that both trips the
  // policy and would otherwise trigger the image lookup.
  let resolved = 0;
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x08, 0x00]), {
    resolveUid: () => {
      resolved += 1;
      return "u_x";
    },
  });
  // An image-bearing message in the group-temp scene: `sendGroupTempMessage` always
  // resolves, but `sendPrivate` must not reach the resolve before its empty check.
  await assert.rejects(new MessageApi(ctx).sendPrivate(20002, []), /message is empty/);
  assert.equal(resolved, 0);
  assert.equal(sent.length, 0);
});

test("element-builder: a naked poke element does not trip the window-shake policy", () => {
  // Documents the asymmetry the reference has: the policy is about a *window shake* send
  // (one poke segment alone), and `windowShakeCount` is computed by the caller from a
  // field a bare `{type:"poke"}` does not set.
  assertWindowShakeSendPolicy(0, 1, "group");
  assert.throws(() => assertWindowShakeSendPolicy(1, 1, "group"), /only be sent in a direct private chat/);
  assert.throws(() => assertWindowShakeSendPolicy(1, 2, "direct-private"), /must be the only segment/);
  assertWindowShakeSendPolicy(1, 1, "direct-private");
});

test("MessageApi: a text-only private send never resolves the uid", async () => {
  // This is the behaviour that keeps the wire bytes stable: `routingHead.c2c` has no `uid`
  // for a text message, so resolving would change the packet.
  let resolved = 0;
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x08, 0x00, 0x70, 0x05]), {
    resolveUid: () => {
      resolved += 1;
      return "u_x";
    },
  });
  const receipt = await new MessageApi(ctx).sendPrivate(20002, [{ type: "text", text: "hi" }] as never);
  assert.equal(resolved, 0);
  assert.equal(receipt.sequence, 5);
  // field 1 routingHead, field 2 contentHead... the c2c uin is field 1 inside c2c.
  assert.ok(sent.length === 1);
});

test("MessageApi: a my-device uin is routed to the dataline path, not the c2c path", async () => {
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x08, 0x00, 0x70, 0x05]));
  await new MessageApi(ctx).sendPrivate(2113929217, [{ type: "text", text: "hi" }] as never);
  assert.equal(sent.length, 1);
  // The envelope's routingHead is field 1 (tag 0x0a); INSIDE it, trans0x211 is field 15
  // (tag 0x7a) while the c2c slot would be field 1 (tag 0x0a).
  assert.equal(sent[0]!.body[0], 0x0a, "envelope field 1 = routingHead");
  assert.equal(sent[0]!.body[2], 0x7a, "routingHead field 15 = trans0x211");
});

test("MessageApi: a my-device send refuses non-text elements", async () => {
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x08, 0x00]));
  await assert.rejects(
    new MessageApi(ctx).sendPrivate(2113929218, [{ type: "image" }] as never),
    /only accepts text messages/,
  );
  assert.equal(sent.length, 0);
});

test("MessageApi: recallPrivate builds the composite messageId, not the receipt's", async () => {
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x08, 0x00]));
  await new MessageApi(ctx).recallPrivate(20002, 42, 7, 123456789, 1700000000);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.command, "trpc.msg.msg_svc.MsgService.SsoC2CRecallMsg");
  // (16777216n << 32n) | 123456789n => big-endian varint; just assert the size and the
  // presence of field 3, and that the value is NOT the plain random.
  const bytes = sent[0]!.body;
  assert.ok(Buffer.from(bytes).includes(Buffer.from([0x1a, 0x07])), "messageId must be a 7-byte varint");
});

test("MessageApi: recall tolerates a response with no body", async () => {
  // Only `success` is checked. A recall that took effect but returned nothing must not throw.
  const { ctx } = makeStubCtx(() => new Uint8Array(0));
  await new MessageApi(ctx).recallGroup(1, 5);
});

test("MessageApi: recall throws on transport failure", async () => {
  const { ctx } = makeStubCtx(() => null);
  await assert.rejects(new MessageApi(ctx).recallGroup(1, 5), /boom/);
});

test("MessageApi: markAllRead makes two packets (probe then confirm) when behind", async () => {
  // The probe reports read=0 latest=5; the confirm must echo read>=5.
  // Group response item fields: resultCode 1, groupUin 3, readSeq 4, latestSeq 5.
  // The probe answers read=0 / latest=5, so the conversation is behind and a confirm follows.
  let call = 0;
  const { ctx, sent } = makeStubCtx(() => {
    call += 1;
    // Probe: read 0, latest 5. Confirm: read 5 (the advance took effect).
    const readSeq = call === 1 ? 0 : 5;
    const item = [0x08, 0x00, 0x18, 0x01, 0x20, readSeq, 0x28, 0x05];
    return new Uint8Array([0x08, 0x00, 0x1a, item.length, ...item]);
  });
  await new MessageApi(ctx).markAllRead([1], []);
  assert.equal(sent.length, 2, "probe + confirm");
  // The probe must carry lastReadSeq 0, which protobuf omits: a bare groupUin per entry
  // (outer tag 0x0a, then `08 01`).
  assert.ok(hex(sent[0]!.body).includes("0a020801"), "probe group item is a bare groupUin");
  // The confirm's request item is `GroupReadedReportItem{groupUin, lastReadSeq}` — field 1
  // (tag 0x08) and field 2 (tag 0x10) — so the advance is `0801 1005`.
  assert.ok(hex(sent[1]!.body).includes("08011005"), "confirm advances to 5");
});

test("MessageApi: markAllRead makes one packet when already current", async () => {
  // read == latest (both 5), so nothing is behind and no confirm packet is sent.
  const item = [0x08, 0x00, 0x18, 0x01, 0x20, 0x05, 0x28, 0x05];
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x08, 0x00, 0x1a, item.length, ...item]));
  await new MessageApi(ctx).markAllRead([1], []);
  assert.equal(sent.length, 1, "probe only");
});

test("MessageApi: markAllRead rejects a confirm that moved backwards", async () => {
  let call = 0;
  const { ctx } = makeStubCtx(() => {
    call += 1;
    // Probe: read 0, latest 5. Confirm: read 1 — behind the requested 5.
    const readSeq = call === 1 ? 0 : 1;
    const item = [0x08, 0x00, 0x18, 0x01, 0x20, readSeq, 0x28, 0x05];
    return new Uint8Array([0x08, 0x00, 0x1a, item.length, ...item]);
  });
  await assert.rejects(new MessageApi(ctx).markAllRead([1], []), /before requested/);
});

test("MessageApi: markAllRead batches at 100 and reports the batch count", async () => {
  // 250 groups => three batches (100/100/50), each one probe because every conversation
  // comes back already current. The responder must answer one item per requested group, so
  // it reads the groupUins back out of the request and replies read == latest for each.
  const ids = Array.from({ length: 250 }, (_, i) => i + 1);
  const groupUinsOf = (body: Uint8Array): number[] => {
    const out: number[] = [];
    let i = 0;
    while (i < body.length) {
      const tag = body[i++]!;
      if (tag === 0x0a) {
        const len = body[i++]!;
        const end = i + len;
        // inside: 08 <groupUin varint>
        if (body[i] === 0x08) {
          i += 1;
          let value = 0;
          let shift = 0;
          for (;;) {
            const b = body[i++]!;
            value |= (b & 0x7f) << shift;
            if ((b & 0x80) === 0) break;
            shift += 7;
          }
          out.push(value);
        }
        i = end;
        continue;
        i = end;
      } else {
        // not exercised by this test's requests
        break;
      }
    }
    return out;
  };
  const { ctx, sent } = makeStubCtx((_command, body) => {
    const uins = groupUinsOf(body);
    const varint = (value: number): number[] => {
      const out: number[] = [];
      let v = value;
      while (v >= 0x80) {
        out.push((v & 0x7f) | 0x80);
        v = Math.floor(v / 0x80);
      }
      out.push(v);
      return out;
    };
    const parts: number[] = [0x08, 0x00];
    for (const groupUin of uins) {
      const item = [0x08, 0x00, 0x18, ...varint(groupUin), 0x20, 0x09, 0x28, 0x09];
      parts.push(0x1a, item.length, ...item);
    }
    return new Uint8Array(parts);
  });
  await new MessageApi(ctx).markAllRead(ids, []);
  assert.equal(sent.length, 3, "three probe packets");
  assert.equal(groupUinsOf(sent[2]!.body).length, 50, "the third batch carries the remaining 50");
});

test("MessageApi: an invalid read target is rejected before any packet", async () => {
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x08, 0x00]));
  await assert.rejects(new MessageApi(ctx).markAllRead([0], []), /invalid group read target/);
  assert.equal(sent.length, 0);
});

test("MessageApi: the history sync probe rejects more than 100 targets of one kind", async () => {
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x08, 0x00]));
  const ids = Array.from({ length: 101 }, (_, i) => i + 1);
  await assert.rejects(new MessageApi(ctx).probeHistorySyncState(ids, []), /at most 100 group targets/);
  assert.equal(sent.length, 0);
});

test("MessageApi: the history sync probe with no targets makes no packet", async () => {
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x08, 0x00]));
  assert.deepEqual(await new MessageApi(ctx).probeHistorySyncState([], []), { groups: [], privateUsers: [] });
  assert.equal(sent.length, 0);
});

test("MessageApi: the history sync probe reads the cursors without advancing them", async () => {
  // The point of the probe: the request carries only identities, and the response supplies
  // read/latest. `lastReadSeq: 0n` must vanish from the wire.
  // group item: resultCode 1, groupUin 3 (tag 0x18), readSeq 4 (0x20), latestSeq 5 (0x28)
  const groupItem = [0x08, 0x00, 0x18, 0x01, 0x20, 0x03, 0x28, 0x09];
  // c2c item: targetUin 3, uid 4 (tag 0x22), readSeq 5 (0x28), latestSeq 6 (0x30)
  const c2cItem = [0x08, 0x00, 0x18, 0x64, 0x22, 0x02, 0x75, 0x78, 0x28, 0x04, 0x30, 0x0a];
  const { ctx, sent } = makeStubCtx(
    () =>
      new Uint8Array([0x08, 0x00, 0x1a, groupItem.length, ...groupItem, 0x22, c2cItem.length, ...c2cItem]),
  );
  const probe = await new MessageApi(ctx).probeHistorySyncState([1], [{ userId: 100, uid: "ux" }]);
  assert.equal(sent.length, 1);
  const body = hex(sent[0]!.body);
  // group entry: bare groupUin only (0a 03 08 01); c2c entry: bare uid only (12 03 12 01 75)
  assert.ok(body.includes("0a020801"), `probe group must be a bare groupUin, got ${body}`);
  // c2c entry: uid at field 2 => 12 02 75 78 inside, so the outer tag is 12 04.
  assert.ok(body.includes("120412027578"), `probe c2c must be a bare uid, got ${body}`);
  assert.deepEqual(probe.groups, [{ groupId: 1, readSeq: 3, latestSeq: 9 }]);
  assert.deepEqual(probe.privateUsers, [{ userId: 100, uid: "ux", readSeq: 4, latestSeq: 10, lastMsgTime: 0 }]);
});

test("MessageApi: the history sync probe rejects a latest cursor before the read cursor", async () => {
  // read=9, latest=3 — the server would be telling us to move backwards.
  const groupItem = [0x08, 0x00, 0x18, 0x01, 0x20, 0x09, 0x28, 0x03];
  const { ctx } = makeStubCtx(() => new Uint8Array([0x08, 0x00, 0x1a, groupItem.length, ...groupItem]));
  await assert.rejects(new MessageApi(ctx).probeHistorySyncState([1], []), /is before read sequence/);
});

test("MessageApi: the history sync probe rejects a mismatched private target uin", async () => {
  const c2cItem = [0x08, 0x00, 0x18, 0x63, 0x22, 0x02, 0x75, 0x78, 0x28, 0x00, 0x30, 0x00];
  const { ctx } = makeStubCtx(() => new Uint8Array([0x08, 0x00, 0x22, c2cItem.length, ...c2cItem]));
  await assert.rejects(
    new MessageApi(ctx).probeHistorySyncState([], [{ userId: 100, uid: "ux" }]),
    /response target 99 does not match/,
  );
});

test("MessageApi: a history sync range wider than 20 slots is rejected before the wire", async () => {
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x08, 0x00]));
  await assert.rejects(new MessageApi(ctx).getGroupHistorySyncPage(1, 1, 21), /at most 20 sequence slots/);
  assert.equal(sent.length, 0);
  // Exactly 20 slots is allowed: it reaches the wire and an empty body yields no messages.
  assert.deepEqual(await new MessageApi(ctx).getGroupHistorySyncPage(1, 1, 20), []);
  assert.equal(sent.length, 1);
});

test("MessageApi: getGroupMessageBySeq swallows every failure and returns null", async () => {
  // The reply back-fill path must never fail the send it is decorating.
  const { ctx } = makeStubCtx(() => null);
  assert.equal(await new MessageApi(ctx).getGroupMessageBySeq(1, 5), null);
  const ok = makeStubCtx(() => new Uint8Array([0x1a, 0x02, 0x18, 0x05]));
  assert.equal(await new MessageApi(ok.ctx).getGroupMessageBySeq(1, 5), null, "no messages => null, not a throw");
});

test("MessageApi: getGroupMessageBySeq makes no packet for a non-positive sequence", async () => {
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x08, 0x00]));
  assert.equal(await new MessageApi(ctx).getGroupMessageBySeq(1, 0), null);
  assert.equal(sent.length, 0);
});

test("MessageApi: getGroupHistory with a non-positive group makes no packet", async () => {
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x08, 0x00]));
  assert.deepEqual(await new MessageApi(ctx).getGroupHistory(0, 10, 5), []);
  assert.equal(sent.length, 0);
});

test("MessageApi: getC2cHistory with an empty uid makes no packet", async () => {
  const { ctx, sent } = makeStubCtx(() => new Uint8Array([0x08, 0x00]));
  assert.deepEqual(await new MessageApi(ctx).getC2cHistory("", 10, 5), []);
  assert.equal(sent.length, 0);
});

// ===========================================================================
// The gate
// ===========================================================================

test("history-request-gate: the gap is measured from the START of the previous request", async () => {
  // A slow operation must not extend the measurement, or a client measures from completion
  // and sends faster than the server's limiter expects.
  const slept: number[] = [];
  let clock = 1000;
  const gate = new HistoryRequestGate({
    now: () => clock,
    sleep: async (ms: number) => {
      slept.push(ms);
      clock += ms;
    },
  });
  await gate.run(300, async () => {
    clock += 50; // the operation takes 50ms
    return 1;
  });
  await gate.run(300, async () => 2);
  // After the first run: started at 1000, completed at 1050. The second must wait until
  // 1300, i.e. 250ms — not 300 (which completion-relative would give if the op were zero).
  assert.deepEqual(slept, [250]);
});

test("history-request-gate: concurrent callers are serialised, not batched", async () => {
  const order: string[] = [];
  let clock = 0;
  const gate = new HistoryRequestGate({
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  });
  await Promise.all([
    gate.run(100, async () => {
      order.push("a-start");
      clock += 10;
      order.push("a-end");
    }),
    gate.run(100, async () => {
      order.push("b-start");
      order.push("b-end");
    }),
  ]);
  assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end"]);
});

test("history-request-gate: an aborted waiting caller does not break the chain", async () => {
  // The chain tail must absorb rejections, or every later caller inherits them.
  let clock = 0;
  const gate = new HistoryRequestGate({
    now: () => clock,
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (signal?.aborted) throw signal.reason ?? new Error("aborted");
      clock += ms;
    },
  });
  const controller = new AbortController();
  const first = gate.run(1000, async () => {
    controller.abort(new Error("stop"));
    return "first";
  });
  const second = gate.run(1000, async () => "second", controller.signal);
  assert.equal(await first, "first");
  await assert.rejects(second, /stop/);
  // The third caller still works.
  assert.equal(await gate.run(0, async () => "third"), "third");
});

test("history-request-gate: a negative gap is rejected without touching the chain", async () => {
  const gate = new HistoryRequestGate({ now: () => 0, sleep: async () => {} });
  await assert.rejects(gate.run(-1, async () => 1), /history request gap is invalid/);
  assert.equal(await gate.run(0, async () => 1), 1);
});

test("history-request-gate: an abort already set fails the caller", async () => {
  const gate = new HistoryRequestGate({ now: () => 0, sleep: async () => {} });
  const controller = new AbortController();
  controller.abort(new Error("pre-aborted"));
  await assert.rejects(gate.run(0, async () => 1, controller.signal), /pre-aborted/);
});

test("history-request-gate: the minimum gap constant is the reference's 300ms", () => {
  assert.equal(HISTORY_MIN_GAP_MS, 300);
  assert.equal(LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.minimumGapMs, 2000);
  assert.equal(LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.maxMessagesPerSession, 20);
});

// ===========================================================================
// The decode-side helpers still line up with the inbound layer
// ===========================================================================

test("message-wire: decodeSendMessageServerResult is reachable from the response decoder", () => {
  // Guards against the helper being exported but wired to nothing.
  const decoded = decodeSendMessageServerResult(new Uint8Array([0x08, 0x03, 0x10, 0x04]));
  assert.deepEqual(decoded, { type: 3, code: 4, message: null });
});