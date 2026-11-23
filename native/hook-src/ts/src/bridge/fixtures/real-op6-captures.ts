// REAL op6 (`trpc.msg.olpush.OlPushService.MsgPush`) inbound wire captures.
//
// ===========================================================================
// THESE BYTES ARE REAL. THEY WERE CAPTURED FROM THE REFERENCE IMPLEMENTATION.
// ===========================================================================
//
// Not synthesised, not assembled field-by-field, not round-tripped through our
// own encoder. Every byte below was printed by `@snowluma/runtime` 2.4.0
// (the SnowLuma reference) and copied out verbatim.
//
//   source      : `docker logs` of the `hz-test` container
//                 (`motricseven7/snowluma:latest`), the reference implementation
//   log line    : `TRACE [Bridge.Packet] packet_push serviceCmd="trpc.msg.olpush.OlPushService.MsgPush" ...`
//                 (reference/index.mjs:347815, the `packet_push` trace)
//   account     : UIN 10001
//   captured at : 2026-11-22 14:24–14:36 Asia/Shanghai
//   disposition : every capture here is retCode=0, fromClient=false
//   transcribed : `work/captures/real-op6-samples.md` (the capture log)
//
// The `docker logs` channel is not incidental. The reference has two
// independent level gates, and `resolveFileMinLevel()` accepts only
// `debug|info|success|warn|error` — `trace` throws a TypeError there. So
// `packet_push` never reaches `/app/data/logs/*.log`; stdout is the only place
// these bytes exist. See the capture log for the full explanation.
//
// ---------------------------------------------------------------------------
// Which fixtures are real and which are synthetic — read this before citing either
// ---------------------------------------------------------------------------
//
//   * THIS FILE                                — REAL. Captured wire bytes.
//   * `ts/test/msg-push-real-capture.test.ts`  — REAL. Decodes this file.
//   * `ts/test/msg-push-pipeline.test.ts`      — SYNTHETIC. Every byte there is
//     assembled by hand from field numbers. Its own header says so, and that
//     file is the one that should keep saying so: hand-built bytes fail on the
//     exact field that drifted, which is what a decoder *unit* test needs.
//
// The two are complements, not duplicates. The synthetic suite proves the
// envelope path is wired; this file proves the reference and this decoder agree
// on bytes neither of us authored.
//
// ---------------------------------------------------------------------------
// What this file proves, and what it proves NOTHING about
// ---------------------------------------------------------------------------
//
// PROVES: DECODE parity on real input. The reference parsed these exact bytes
// and produced these exact field values; so does `decodeMsgPushContext` /
// `decodeMsgPushPacket`. That is the strongest evidence the project has for the
// op6 receive path, because the bytes are not ours to bend.
//
// PROVES NOTHING ABOUT:
//   * **op2 send success.** There is no `packet_send` or `packet_terminal`
//     evidence anywhere in the capture log, and nothing here may be read as
//     such. Decoding an inbound push says nothing about outbound send.
//   * **The meaning of the unknown tags.** The reference itself drops
//     `elem.generalFlags` tags 10, 12, 13 and 19 (`[MsgPush.UnknownElement]
//     wire element ignored unknownTag=... path=elem.generalFlags`), as well as
//     RichText tag 1 and Elem tag 9. We match its behaviour — skip and keep
//     going — so these captures can only show "we agree about what to ignore".
//     They cannot show what those tags mean, and no assertion here claims to.
//
// ---------------------------------------------------------------------------
// A naming discrepancy in the capture log, recorded rather than papered over
// ---------------------------------------------------------------------------
//
// The capture log labels each sample `seq=2626218455` / `seq=2564024904` /
// `seq=2526989626`. That value is the log line's **`seqId`** field, which is
// `packet.seq` ← the op6 frame header's `value0` — a per-recv-connection
// monotonic counter the reference only ever logs (`hook-session.ts:712`
// `seqId: packet.seq`; see `docs/payload-recv-format.md` §6.8).
//
// It is NOT `ContentHead.sequence`, and it is NOT `ContentHead.msgId`. All
// three are different numbers in these captures:
//
//   capture   seqId (frame value0)  ContentHead.sequence  ContentHead.msgId
//   137 B              2626218455              2014043859           2014043858
//   138 B              2564024904              1501433598           1501433597
//   402 B              2526989626                 1933136            157460581
//
// The captures are therefore keyed by their **byte length** below, and the
// frame `seqId` is carried as provenance only (`RealOp6Capture.seqId`). The
// tests assert the decoded `sequence`/`msgId` and separately assert that the
// frame `seqId` differs from both — so the discrepancy stays visible and
// executable instead of being silently "fixed" by editing a number.
//
// Throughout, `sequence` and `msgId` are marked `number` even though the wire
// carries them as varints: they fit in 32 bits, and the decoder reads them as
// `u32`.

/** One literal UTF-8 run that is physically present in a capture's bytes. */
export interface WireLiteral {
  /** What the run says, for a reader skimming the fixture. */
  readonly label: string;
  /** Absolute offset of the first byte of the run within the capture body. */
  readonly offset: number;
  /** Length in bytes. */
  readonly length: number;
  /** The run itself. Must equal `utf8(bytes[offset .. offset + length])`. */
  readonly utf8: string;
  /** Where in the message schema the run lives. */
  readonly path: string;
}

/** A decoded `ContentHead`, plus the wire offset each varint starts at. */
export interface ExpectedContentHead {
  readonly msgType: number;
  readonly subType: number;
  readonly c2cCmd: number;
  readonly msgId: number;
  readonly sequence: number;
  readonly timestamp: number;
  /** `ContentHead.ntMsgSeq` is field 11 and is **absent** from all three. */
  readonly ntMsgSeq: number;
}

/** Absolute offset of a field's tag byte, so a mismatch can be re-derived by hand. */
export type FieldOffsets = Readonly<Record<string, number>>;

export interface RealOp6Capture {
  /** Stable id, derived from the capture's byte length. */
  readonly id: string;
  /** How the capture log refers to it. */
  readonly docLabel: string;
  /** `packet_push ... seqId=` from the log line — the op6 frame `value0`. Provenance only. */
  readonly seqId: number;
  readonly retCode: number;
  readonly fromClient: boolean;
  /** The account the frame arrived on (`uin="10001"` in every log line). */
  readonly uin: string;
  /** `length=` from the log line. Asserted against `bytes.length`. */
  readonly byteLength: number;
  /** The body exactly as printed in the log line. */
  readonly hex: string;
  /** `hex` decoded. */
  readonly bytes: Uint8Array;
  /** What the reference's own decoder produced, field by field. */
  readonly expected: {
    readonly head: ExpectedContentHead;
    readonly fromUin: number;
    readonly fromUid: string;
    readonly toUin: number;
    /** `ResponseGrp.groupUin` — the group id, for group samples. */
    readonly groupUin: number | null;
    /** `ResponseGrp.memberCard` — absent for the C2C samples. */
    readonly memberCard: string | null;
    /** `ResponseGrp.groupName` — absent for the C2C samples. */
    readonly groupName: string | null;
    /** `MessageBody.msgContent` byte length; 0 when the body is a rich-text body. */
    readonly msgContentLength: number;
  };
  /** Absolute offset of each field's tag byte, keyed by dotted path. */
  readonly offsets: FieldOffsets;
  /** Literal UTF-8 runs physically present in `bytes`. */
  readonly literals: readonly WireLiteral[];
}

/**
 * Hex string → bytes.
 *
 * Deliberately strict: an odd-length or non-hex string is a transcription
 * error in this file, and it must fail loudly here rather than decode to
 * something plausible a few bytes short.
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`hex string has an odd length (${hex.length})`);
  if (!/^[0-9a-f]*$/.test(hex)) throw new Error("hex string contains a non-hex character");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

/** UTF-8 decode of `bytes[offset .. offset + length]`. */
export function sliceUtf8(bytes: Uint8Array, offset: number, length: number): string {
  return new TextDecoder().decode(bytes.subarray(offset, offset + length));
}

// ===========================================================================
// Capture 1 — 137 bytes, `MsgPush`, frame seqId=2626218455
// ===========================================================================
//
// A C2C service push: msgType=528 (Event0x210) subType=382, which the reference
// answers with `unknownLog.debug("Event0x210 unknown subType=%d")` and `[]`.
// The payload is 12 bytes of `msgContent`, not rich text — there is no `Elem`
// list to decode, so the interesting content here is the envelope.
//
// Wire layout, re-derivable with `offsets` below:
//
//   @0     PushMsg.message                 len 134
//   @3       PushMsgBody.responseHead      len  64
//   @5         ResponseHead.fromUin        = 10001   (5..10)
//   @11        ResponseHead.fromUid        = "u_anon000000000000000000" (13..36)
//   @37        ResponseHead.toUin          = 10001  (field 5, varint)
//   @43        ResponseHead.toUid          = "u_anon000000000000000000" (45..68)
//   @69      PushMsgBody.contentHead       len  48
//   @71        ContentHead.msgType        = 528         (71..73)
//   @74        ContentHead.subType        = 382         (74..76)
//   @77        ContentHead.c2cCmd         = 382         (77..79)
//   @80        ContentHead.msgId          = 2014043858  (80..85)
//   @86        ContentHead.sequence       = 2014043859  (86..91)
//   @92        ContentHead.timestamp      = 1795328690  (92..97)
//   @98        ContentHead.newId          = 144115190089899740 (field 12)
//   @108       ContentHead.field32        = 982423767070582000 (field 32, unknown)
//   @119     PushMsgBody.body              len  16
//   @121       MessageBody.richText       len   0   (present but empty)
//   @123       MessageBody.msgContent     12 bytes = "EP4CGAAgZSgA"
//
// Note there is no `ntMsgSeq` (field 11): the value is 0 by absence, not 0 on
// the wire. `field32` is not in `ContentHead`'s schema at all and is skipped by
// both implementations.
export const CAPTURE_137_SEQ2626218455: RealOp6Capture = {
  id: "op6-137",
  docLabel: "137 字节，MsgPush，seq=2626218455",
  seqId: 2626218455,
  retCode: 0,
  fromClient: false,
  uin: "10001",
  byteLength: 137,
  hex:
    "0a86010a400891ce8080001218755f616e6f6e3030303030303030303030303030303030302891" +
    "ce8080003218755f616e6f6e303030303030303030303030303030303030123008900410fe0218" +
    "fe0220d2bdafc00728d3bdafc00730b2958ad80660d2bdafc087808080028002efc992b9e0a691" +
    "d10d1a100a00120c45503443474141675a536741",
  bytes: new Uint8Array(0), // filled in below
  expected: {
    head: {
      msgType: 528,
      subType: 382,
      c2cCmd: 382,
      msgId: 2014043858,
      sequence: 2014043859,
      timestamp: 1795328690,
      ntMsgSeq: 0,
    },
    fromUin: 10001,
    fromUid: "u_anon000000000000000000",
    toUin: 10001,
    groupUin: null,
    memberCard: null,
    groupName: null,
    msgContentLength: 12,
  },
  offsets: {
    "PushMsg.message": 0,
    "PushMsgBody.responseHead": 3,
    "ResponseHead.fromUin": 5,
    "ResponseHead.fromUid": 11,
    "ResponseHead.toUin": 37,
    "ResponseHead.toUid": 43,
    "PushMsgBody.contentHead": 69,
    "ContentHead.msgType": 71,
    "ContentHead.subType": 74,
    "ContentHead.c2cCmd": 77,
    "ContentHead.msgId": 80,
    "ContentHead.sequence": 86,
    "ContentHead.timestamp": 92,
    "ContentHead.newId": 98,
    "ContentHead.field32": 108,
    "PushMsgBody.body": 119,
    "MessageBody.richText": 121,
    "MessageBody.msgContent": 123,
  },
  literals: [
    {
      label: "sender UID",
      offset: 13,
      length: 24,
      utf8: "u_anon000000000000000000",
      path: "ResponseHead.fromUid",
    },
    {
      label: "recipient UID",
      offset: 45,
      length: 24,
      utf8: "u_anon000000000000000000",
      path: "ResponseHead.toUid",
    },
    {
      label: "msgContent (opaque base64-ish, not rich text)",
      offset: 125,
      length: 12,
      utf8: "EP4CGAAgZSgA",
      path: "MessageBody.msgContent",
    },
  ],
};

// ===========================================================================
// Capture 2 — 138 bytes, `MsgPush`, frame seqId=2564024904
// ===========================================================================
//
// Same shape as capture 1 (msgType=528 / subType=382 / c2cCmd=382), one byte
// longer because both `msgId` and `sequence` crossed a varint boundary. It is
// kept as a separate capture rather than "capture 1 with different numbers"
// precisely because the interesting failure mode — a one-byte shift in a
// length-delimited field — is what a second real sample catches and a
// re-parameterised fixture cannot.
//
//   @0     PushMsg.message                 len 135
//   @3       PushMsgBody.responseHead      len  64
//   @5         ResponseHead.fromUin        = 10001   (5..10)
//   @11        ResponseHead.fromUid        = "u_anon000000000000000000" (13..36)
//   @37        ResponseHead.toUin          = 10001  (field 5, varint)
//   @43        ResponseHead.toUid          = "u_anon000000000000000000" (45..68)
//   @69      PushMsgBody.contentHead       len  49
//   @71        ContentHead.msgType        = 528         (71..73)
//   @74        ContentHead.subType        = 382         (74..76)
//   @77        ContentHead.c2cCmd         = 382         (77..79)
//   @80        ContentHead.msgId          = 1501433597  (80..85)
//   @86        ContentHead.sequence       = 1501433598  (86..91)
//   @92        ContentHead.timestamp      = 1795328690  (92..97)
//   @98        ContentHead.newId          = 144115189577289470 (field 12)
//   @108       ContentHead.field32        = 11893423091874885316 (field 32, unknown)
//   @120     PushMsgBody.body              len  16
//   @122       MessageBody.richText       len   0
//   @124       MessageBody.msgContent     12 bytes = "EP4CGAAgZSgA"
export const CAPTURE_138_SEQ2564024904: RealOp6Capture = {
  id: "op6-138",
  docLabel: "138 字节，MsgPush，seq=2564024904",
  seqId: 2564024904,
  retCode: 0,
  fromClient: false,
  uin: "10001",
  byteLength: 138,
  hex:
    "0a87010a400891ce8080001218755f616e6f6e3030303030303030303030303030303030302891" +
    "ce8080003218755f616e6f6e303030303030303030303030303030303030123108900410fe0218" +
    "fe0220fd9df8cb0528fe9df8cb0530b2958ad80660fd9df8cb85808080028002c4dd85d59ba9fb" +
    "86a5011a100a00120c45503443474141675a536741",
  bytes: new Uint8Array(0), // filled in below
  expected: {
    head: {
      msgType: 528,
      subType: 382,
      c2cCmd: 382,
      msgId: 1501433597,
      sequence: 1501433598,
      timestamp: 1795328690,
      ntMsgSeq: 0,
    },
    fromUin: 10001,
    fromUid: "u_anon000000000000000000",
    toUin: 10001,
    groupUin: null,
    memberCard: null,
    groupName: null,
    msgContentLength: 12,
  },
  offsets: {
    "PushMsg.message": 0,
    "PushMsgBody.responseHead": 3,
    "ResponseHead.fromUin": 5,
    "ResponseHead.fromUid": 11,
    "ResponseHead.toUin": 37,
    "ResponseHead.toUid": 43,
    "PushMsgBody.contentHead": 69,
    "ContentHead.msgType": 71,
    "ContentHead.subType": 74,
    "ContentHead.c2cCmd": 77,
    "ContentHead.msgId": 80,
    "ContentHead.sequence": 86,
    "ContentHead.timestamp": 92,
    "ContentHead.newId": 98,
    "ContentHead.field32": 108,
    "PushMsgBody.body": 120,
    "MessageBody.richText": 122,
    "MessageBody.msgContent": 124,
  },
  literals: [
    {
      label: "sender UID",
      offset: 13,
      length: 24,
      utf8: "u_anon000000000000000000",
      path: "ResponseHead.fromUid",
    },
    {
      label: "recipient UID",
      offset: 45,
      length: 24,
      utf8: "u_anon000000000000000000",
      path: "ResponseHead.toUid",
    },
    {
      label: "msgContent (opaque base64-ish, not rich text)",
      offset: 126,
      length: 12,
      utf8: "EP4CGAAgZSgA",
      path: "MessageBody.msgContent",
    },
  ],
};

// ===========================================================================
// Capture 3 — 402 bytes, `MsgPush`, frame seqId=2526989626
//
// THE LOAD-BEARING CAPTURE. This is a real group message carrying real
// Chinese text, a group card, and a group name. It is the only sample here
// with a non-empty `RichText.elems`, so it is the only one that exercises
// `Elem` decoding on real wire data end-to-end.
//
// Wire layout (all offsets absolute, all re-derivable):
//
//   @0     PushMsg.message                        len 399
//   @3       PushMsgBody.responseHead             len  97
//   @5         ResponseHead.fromUin               = 10002  (5..10)
//   @11        ResponseHead.fromUid               = "u_w0yM0R728oIxUl6dRS69sA" (13..36)
//   @37        ResponseHead.type                  = 1001        (field 3, varint)
//   @40        ResponseHead.sigMap                = 537379447   (field 4, varint)
//   @46        ResponseHead.toUin                 = 10001  (46..51)
//   @52        ResponseHead.grp                   len  48
//   @54          ResponseGrp.groupUin             = 123456   (54..59)
//   @60          ResponseGrp.field2 (varint)      = 1           (unknown wire type)
//   @62          ResponseGrp.field3 (varint)      = 20327       (not in schema)
//   @66          ResponseGrp.memberCard           = "匿名者."    (68..77)
//   @78          ResponseGrp.field5 (varint)      = 2
//   @80          ResponseGrp.field6 (varint)      = 1
//   @82          ResponseGrp.groupName            = "ChatLuna 闲聊群" (84..101)
//   @102     PushMsgBody.contentHead              len  49
//   @104       ContentHead.msgType                = 82          (104..105)
//   @106       ContentHead.msgId                  = 157460581   (106..110)
//   @111       ContentHead.sequence               = 1933136     (111..114)
//   @115       ContentHead.timestamp              = 1795328836  (115..120)
//   @121       ContentHead.field7                 = 1
//   @123       ContentHead.newId                  = 72057594195388510 (field 12)
//   @133       ContentHead.field29                = 1614106     (not in schema)
//   @138       ContentHead.field30                = 1           (not in schema)
//   @141       ContentHead.field32                = 14149950327114399263 (unknown)
//   @153     PushMsgBody.body                     len 246
//   @156       MessageBody.richText              len 243
//   @159         RichText.field1 (unknown)       len  32  → "\b\u0000\u0010...宋体"
//   @193         RichText.elems[0]               len  52
//   @195           Elem.text                     len  50
//   @197             TextElem.str                = "流行不了，这种要求一次都不该有。" (199..246)
//   @247         RichText.elems[1]               len   6
//   @249           Elem.field9 (UNKNOWN TAG 9)   len   4  → "\b\u0000@\u0001"
//   @255         RichText.elems[2]               len 122
//   @257           Elem.generalFlags             len 119
//   @260             GeneralFlags.field10  (UNKNOWN TAG 10, varint) = 0
//   @262             GeneralFlags.field12  (UNKNOWN TAG 12, varint) = 0
//   @264             GeneralFlags.field13  (UNKNOWN TAG 13, varint) = 0
//   @266             GeneralFlags.field19  (UNKNOWN TAG 19, len 110, 269..378)
//   @379         RichText.elems[3]               len  21
//   @381           Elem.extraInfo                len  18
//   @384             ExtraInfo.nick              = "匿名者."   (386..395)
//   @396             ExtraInfo.level             = 1
//   @398             ExtraInfo.groupMask         = 1
//   @400             ExtraInfo.senderTitle       = "" (len 0)
//
// Tags 10 / 12 / 13 / 19 under `elem.generalFlags` are the four the reference
// logs as `[MsgPush.UnknownElement] wire element ignored unknownTag=...` and
// drops. Tag 9 on `Elem`, and tag 1 on `RichText`, are dropped the same way and
// are not in either schema. Only `elems[0]` (text) produces a segment; the
// other three elements are metadata and are intentionally invisible to OneBot.
// The load-bearing consequence: the text at 199..246 survives intact even
// though it is surrounded, before and after, by elements neither
// implementation understands.
export const CAPTURE_402_SEQ2526989626: RealOp6Capture = {
  id: "op6-402",
  docLabel: "402 字节，MsgPush，seq=2526989626（真实群消息，含可见文本）",
  seqId: 2526989626,
  retCode: 0,
  fromClient: false,
  uin: "10001",
  byteLength: 402,
  hex:
    "0a8f030a610892ce8080001218755f7730794d30523732386f4978556c366452533639734118e9" +
    "0720f7849f80022891ce808000423008c0c4878000100118e79e01220ae58cbfe5908de880852e" +
    "280230013a12436861744c756e6120e997b2e8818ae7bea41231085220e5d08a4b28d0fe7530c4" +
    "968ad806380160e5d08acb8080808001e8019ac262f0010180029ffccda8a59baeafc4011af601" +
    "0af3010a20080010c4968ad80618e5d08a4b2000280a300038860140024a06e5ae8be4bd931234" +
    "0a320a30e6b581e8a18ce4b88de4ba86efbc8ce8bf99e7a78de8a681e6b182e4b880e6aca1e983" +
    "bde4b88de8afa5e69c89e3808212064a0408004001127aaa02775000600068009a016e080020cb" +
    "50c80100f00100f80100900200980300a00300b00300c00300d00300e803008a04040802105d90" +
    "048001b80400c00401ca04023005f8048c800c880500b2060a0a080800100018002000d8069ac2" +
    "62ea060c080122089c5d2e5370f5a470a0079ffccda8a59baeafc40112158201120a0ae58cbfe5" +
    "908de880852e180128013a00",
  bytes: new Uint8Array(0), // filled in below
  expected: {
    head: {
      msgType: 82, // PkgType.GroupMessage
      subType: 0,
      c2cCmd: 0,
      msgId: 157460581,
      sequence: 1933136,
      timestamp: 1795328836,
      ntMsgSeq: 0, // field 11 absent; 0 by absence
    },
    fromUin: 10002,
    fromUid: "u_w0yM0R728oIxUl6dRS69sA",
    toUin: 10001,
    groupUin: 123456,
    memberCard: "匿名者.",
    groupName: "ChatLuna 闲聊群",
    msgContentLength: 0,
  },
  offsets: {
    "PushMsg.message": 0,
    "PushMsgBody.responseHead": 3,
    "ResponseHead.fromUin": 5,
    "ResponseHead.fromUid": 11,
    "ResponseHead.type": 37,
    "ResponseHead.sigMap": 40,
    "ResponseHead.toUin": 46,
    "ResponseHead.grp": 52,
    "ResponseGrp.groupUin": 54,
    "ResponseGrp.field2": 60,
    "ResponseGrp.field3": 62,
    "ResponseGrp.memberCard": 66,
    "ResponseGrp.field5": 78,
    "ResponseGrp.field6": 80,
    "ResponseGrp.groupName": 82,
    "PushMsgBody.contentHead": 102,
    "ContentHead.msgType": 104,
    "ContentHead.msgId": 106,
    "ContentHead.sequence": 111,
    "ContentHead.timestamp": 115,
    "ContentHead.field7": 121,
    "ContentHead.newId": 123,
    "ContentHead.field29": 133,
    "ContentHead.field30": 138,
    "ContentHead.field32": 141,
    "PushMsgBody.body": 153,
    "MessageBody.richText": 156,
    "RichText.field1": 159,
    "RichText.elems[0]": 193,
    "Elem.text": 195,
    "TextElem.str": 197,
    "RichText.elems[1]": 247,
    "Elem.field9": 249,
    "RichText.elems[2]": 255,
    "Elem.generalFlags": 257,
    "GeneralFlags.field10": 260,
    "GeneralFlags.field12": 262,
    "GeneralFlags.field13": 264,
    "GeneralFlags.field19": 266,
    "RichText.elems[3]": 379,
    "Elem.extraInfo": 381,
    "ExtraInfo.nick": 384,
    "ExtraInfo.level": 396,
    "ExtraInfo.groupMask": 398,
    "ExtraInfo.senderTitle": 400,
  },
  literals: [
    {
      label: "group card (sender display name)",
      offset: 68,
      length: 10,
      utf8: "匿名者.",
      path: "ResponseGrp.memberCard",
    },
    {
      label: "group name",
      offset: 84,
      length: 18,
      utf8: "ChatLuna 闲聊群",
      path: "ResponseGrp.groupName",
    },
    {
      label: "sender UID",
      offset: 13,
      length: 24,
      utf8: "u_w0yM0R728oIxUl6dRS69sA",
      path: "ResponseHead.fromUid",
    },
    {
      label: "font name inside the unknown RichText.field1 payload",
      offset: 187,
      length: 6,
      utf8: "宋体",
      path: "RichText.field1",
    },
    {
      label: "message text — first clause",
      offset: 199,
      length: 12,
      utf8: "流行不了",
      path: "TextElem.str",
    },
    {
      label: "message text — full sentence incl. trailing 。",
      offset: 199,
      length: 48,
      utf8: "流行不了，这种要求一次都不该有。",
      path: "TextElem.str",
    },
    {
      label: "message text — second clause",
      offset: 214,
      length: 30,
      utf8: "这种要求一次都不该有",
      path: "TextElem.str",
    },
    {
      label: "extraInfo nick (the same display name, second copy)",
      offset: 386,
      length: 10,
      utf8: "匿名者.",
      path: "Elem.extraInfo.nick",
    },
  ],
};

/** Every real capture, in the order the capture log records them. */
export const REAL_OP6_CAPTURES: readonly RealOp6Capture[] = [
  CAPTURE_137_SEQ2626218455,
  CAPTURE_138_SEQ2564024904,
  CAPTURE_402_SEQ2526989626,
];

// The `bytes` field is declared on the object literals above as an empty array so
// the hex stays the single source of truth; decode it exactly once, here, and
// fail the module load if any hex was mistyped.
for (const capture of REAL_OP6_CAPTURES) {
  (capture as { bytes: Uint8Array }).bytes = hexToBytes(capture.hex);
}

/**
 * The four tags the reference logs as `[MsgPush.UnknownElement]` under
 * `elem.generalFlags`, with the wire type and payload length it reported.
 *
 * Recorded as data so the test can prove the payload at each offset really is
 * the unknown field the reference described — rather than asserting "some
 * unknown field exists somewhere".
 */
export interface UnknownGeneralFlagsTag {
  readonly field: number;
  readonly wireType: 0 | 2;
  /** Absolute offset of the tag byte. */
  readonly tagOffset: number;
  /** Payload length for wire type 2; `null` for a varint. */
  readonly payloadLength: number | null;
}

/** The unknown tags inside `RichText.elems[2].generalFlags` of the 402-byte capture. */
export const CAPTURE_402_UNKNOWN_GENERAL_FLAGS_TAGS: readonly UnknownGeneralFlagsTag[] = [
  { field: 10, wireType: 0, tagOffset: 260, payloadLength: null },
  { field: 12, wireType: 0, tagOffset: 262, payloadLength: null },
  { field: 13, wireType: 0, tagOffset: 264, payloadLength: null },
  { field: 19, wireType: 2, tagOffset: 266, payloadLength: 110 },
];

/**
 * The one element of the 402-byte capture that is *not* metadata: the text
 * element at `RichText.elems[0]`. Its sibling elements (2 and 3) are
 * `generalFlags` / `extraInfo`, which the reference treats as metadata and never
 * turns into a OneBot segment — so a correctly decoded message has exactly one
 * segment even though four elements are on the wire.
 */
export const CAPTURE_402_EXPECTED_SEGMENT_COUNT = 1;

/** The exact text the 402-byte capture must decode to, byte-derived. */
export const CAPTURE_402_EXPECTED_TEXT: string = (() => {
  // 199..246 inclusive: the `TextElem.str` payload.
  return sliceUtf8(CAPTURE_402_SEQ2526989626.bytes, 199, 48);
})();
