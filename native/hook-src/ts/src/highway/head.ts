// The highway chunk header — the protobuf message that precedes every chunk of a
// large upload, telling the server where the chunk goes and what it contains.
//
// Reference region: `../protocol/src/highway/protobuf.ts` (reference/index.mjs:32230+,
// `ReqDataHighwayHead` / `RespDataHighwayHead` and their nested messages),
// encoder `protobuf_encode_ReqDataHighwayHead`, decoder
// `protobuf_decode_RespDataHighwayHead`.
//
// ---------------------------------------------------------------------------
// This is protobuf, but not the repo's OIDB protobuf
// ---------------------------------------------------------------------------
// There is no command/sub-command/errorCode envelope here — that is OIDB's shape,
// and highway is a different service. The bytes go straight into
// `packHighwayFrame`'s `head` slot. Wrapping it in an `OidbBase` produces a
// header the server cannot parse, and the failure looks like a body-length
// mismatch rather than a malformed head.
//
// ---------------------------------------------------------------------------
// Field numbers are the contract; names are local
// ---------------------------------------------------------------------------
// The reference's generated encoder names the fields `_f0`.._f10` and assigns tag
// bytes by position. The numbers below were read off that encoder
// (`buf[offset++] = 8` for field 1, `16` for field 2, ...), which is why they are
// written as an explicit map rather than derived from declaration order: renaming
// a field must not silently renumber it.
//
//   DataHighwayHead (msgBaseHead)
//     1 version       uint32
//     2 uin           string      <-- the decimal uin, NOT a number
//     3 command       string      <-- "PicUp.DataUp" for an upload
//     4 seq           uint32
//     5 retryTimes    uint32
//     6 appId         uint32
//     7 dataFlag      uint32
//     8 commandId     uint32
//
//   SegHead (msgSegHead)
//     1  serviceId     uint32
//     2  filesize      uint64
//     3  dataOffset    uint64
//     4  dataLength    uint32
//     6  serviceTicket bytes       <-- the sig_session from HttpConn.0x6ff_501
//     7  flag          uint32      <-- 5 is skipped
//     8  md5           bytes       <-- the CHUNK md5
//     9  fileMd5       bytes       <-- the WHOLE FILE md5
//     10 cacheAddr     uint32
//     13 cachePort     uint32      <-- 11 and 12 are BOTH skipped
//
//   ReqDataHighwayHead
//     1 msgBaseHead         DataHighwayHead
//     2 msgSegHead           SegHead
//     3 bytesReqExtendInfo   bytes       <-- the file-key / msg-info extension
//     4 timestamp            uint64
//     5 msgLoginSigHead     LoginSigHead
//
//   LoginSigHead
//     1 loginSigType uint32
//     2 appId        uint32
//
// ---------------------------------------------------------------------------
// Why `uin` is a string and `filesize`/`dataOffset` are `bigint`
// ---------------------------------------------------------------------------
// `uin` is a `uint64` on the wire but is encoded as a **string** field by the
// reference (wire type 2), because QQ's uins exceed `Number.MAX_SAFE_INTEGER` and
// the generated code chose string for it. Emitting it as a varint produces a
// head the server rejects with a generic parse error.
//
// `filesize`/`dataOffset` are genuine varints but are `bigint` for the same
// reason — a 4 GiB file offset does not fit in a 32-bit `dataLength`, and the
// reference treats them as bigint throughout. The acknowledgement comparison in
// the chunk loop (`seg.filesize !== BigInt(totalSize)`) depends on that.

import { ProtoReader, ProtoWriter, tagOf, WireType } from "../oidb/wire.js";

/**
 * The `appId` every highway request carries: `1600001604`.
 *
 * A constant of the protocol, not a setting. Both `DataHighwayHead.appId` and
 * `LoginSigHead.appId` use it, and they must agree — a mismatch makes the server
 * treat the login signature as belonging to a different application.
 */
export const HIGHWAY_APP_ID = 1_600_001_604;

/** The `command` string for an upload. Downloads use a different one. */
export const HIGHWAY_COMMAND_UPLOAD = "PicUp.DataUp";

/** The `dataFlag` for an upload. */
export const HIGHWAY_DATA_FLAG_UPLOAD = 16;

/** `loginSigType` for an upload: a session ticket, not a password. */
export const HIGHWAY_LOGIN_SIG_TYPE = 8;

/** `DataHighwayHead` — the base head shared by every highway operation. */
export interface DataHighwayHead {
  version: number;
  /** Decimal uin, as a string. See the module comment. */
  uin: string;
  /** `"PicUp.DataUp"` for an upload. */
  command: string;
  seq: number;
  retryTimes: number;
  appId: number;
  dataFlag: number;
  commandId: number;
}

/** `SegHead` — per-chunk addressing. */
export interface SegHead {
  serviceId: number;
  filesize: bigint;
  dataOffset: bigint;
  dataLength: number;
  retCode: number;
  /** The `sig_session` from `HttpConn.0x6ff_501`. */
  serviceTicket: Uint8Array;
  flag: number;
  /** MD5 of this chunk. */
  md5: Uint8Array;
  /** MD5 of the whole file. */
  fileMd5: Uint8Array;
  cacheAddr: number;
  cachePort: number;
}

/**
 * `LoginSigHead` — identifies which login the ticket belongs to.
 *
 * `appId` is field **3**, not 2: the reference skips 2 entirely
 * (`__write_LoginSigHead` emits tag `8` then tag `24`). Numbering it 2 produces a
 * head that decodes as `appId=0` with a stray field-2 varint, and the server
 * rejects the session ticket as belonging to a different application — a failure
 * that looks like an auth problem rather than an encoding one.
 */
export interface LoginSigHead {
  loginSigType: number;
  appId: number;
}

/** `ReqDataHighwayHead` — what an upload chunk sends. */
export interface ReqDataHighwayHead {
  msgBaseHead: DataHighwayHead;
  msgSegHead: SegHead;
  /** The file-key / msg-info extension; empty for a plain image upload. */
  bytesReqExtendInfo: Uint8Array;
  timestamp: bigint;
  msgLoginSigHead: LoginSigHead;
}

/** `RespDataHighwayHead` — what the server answers. Every field is optional. */
export interface RespDataHighwayHead {
  errorCode: number;
  msgBaseHead?: { seq?: number };
  msgSegHead?: {
    retCode?: number;
    serviceId?: number;
    filesize?: bigint;
    dataOffset?: bigint;
    dataLength?: number;
  };
}

/**
 * Nested messages must be length-prefixed, so each one is built into its own
 * writer and then embedded. `ProtoWriter` has no "sub-message" helper because
 * every other codec in this repo writes its members inline; highway's nesting is
 * deeper than OIDB's, so it is done explicitly here.
 */
function encodeDataHighwayHead(head: DataHighwayHead): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(1, head.version);
  // `uin` is a STRING field on the wire (wire type 2), even though it is a uint64 in QQ's
  // data model. Emitting it as a varint produces a head the server rejects with a generic
  // parse error several layers away from the cause.
  w.string(2, head.uin);
  w.string(3, head.command);
  w.uint32(4, head.seq);
  w.uint32(5, head.retryTimes);
  w.uint32(6, head.appId);
  w.uint32(7, head.dataFlag);
  w.uint32(8, head.commandId);
  return w.finish();
}

/**
 * Encode a `SegHead`.
 *
 * Exported for tests: the per-field goldens below are the only way to catch a wrong
 * field number, and a structural round-trip test cannot (encoder and decoder share the
 * mistake).
 */
export function encodeSegHead(seg: SegHead): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(1, seg.serviceId);
  w.uint64(2, seg.filesize);
  w.uint64(3, seg.dataOffset);
  w.uint32(4, seg.dataLength);
  // `retCode` is field 5 (tag 40), and `serviceTicket` is field 6 (tag 50). These were both
  // written as field 6, which meant the ticket OVERWROTE the return code: `retCode` is 0 on
  // every upload and `uint32` elides a zero, so the only field that reached the wire was the
  // ticket. The server then saw a well-formed SegHead with no return code and rejected the
  // chunk with a generic application error (error_code=921, cmdId=1004) that names nothing.
  //
  // Reference: `__write_SegHead` emits tags 8/16/24/32/40/50 for fields 1..6
  // (index.mjs:32955-33035), i.e. serviceId, filesize, dataOffset, dataLength, retCode,
  // serviceTicket.
  // Field 5 is `retCode`. The reference's `buf[offset++] = 40;` looks unconditional, but the
  // 447-byte golden settles it: it contains no `2800`, so a zero retCode is ABSENT on the wire.
  // The tag is emitted and the value elided by the varint writer. Keeping `uint32` (elides
  // zeros) is therefore correct, and `uint32Always` here would add two bytes the reference does
  // not send — which the golden caught.
  w.uint32(5, seg.retCode);
  // Emitted only when non-empty, matching the reference (`_f5 != null && _f5.length > 0`).
  // A zero-length ticket is therefore ABSENT rather than present-but-empty, which is what the
  // server expects for "use the session from the bootstrap".
  w.bytes(6, seg.serviceTicket);
  w.uint32(7, seg.flag);
  w.bytes(8, seg.md5);
  w.bytes(9, seg.fileMd5);
  w.uint32(10, seg.cacheAddr);
  // Field 13, not 11: the reference skips 11 AND 12 (`buf[offset++] = 104` = 13<<3).
  // The bug this replaces was latent — `cachePort` is 0 on every NTV2 call site and
  // `uint32` elides a zero — so the golden vector with cachePort=0 matched either way.
  // It would have bitten the first caller to send a non-zero port, and produced a head
  // the server parses as two unknown fields plus a missing cachePort.
  w.uint32(13, seg.cachePort);
  return w.finish();
}

export function encodeLoginSigHead(head: LoginSigHead): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(1, head.loginSigType);
  // Field 3, not 2. See the interface comment.
  w.uint32(3, head.appId);
  return w.finish();
}

/** Encode a `ReqDataHighwayHead` into the bytes that go into a frame's `head`. */
export function encodeReqDataHighwayHead(req: ReqDataHighwayHead): Uint8Array {
  const w = new ProtoWriter();
  // `message` (not `bytes`): these are nested messages and must be length-prefixed the same
  // way, but the reader distinguishes them by the decoder it dispatches to, so keeping the
  // intent visible matters more than the identical bytes.
  w.message(1, encodeDataHighwayHead(req.msgBaseHead));
  w.message(2, encodeSegHead(req.msgSegHead));
  w.bytes(3, req.bytesReqExtendInfo);
  w.uint64(4, req.timestamp);
  w.message(5, encodeLoginSigHead(req.msgLoginSigHead));
  return w.finish();
}

/** `DataHighwayHead.seq` (field 4) from a response. */
function decodeNestedSeq(bytes: Uint8Array): number | undefined {
  const reader = new ProtoReader(bytes);
  let seq: number | undefined;
  while (reader.next()) {
    if (reader.tag === tagOf(4, WireType.varint)) {
      seq = Number(reader.uint64());
      continue;
    }
    reader.skip();
  }
  return seq;
}

function decodeNestedSeg(bytes: Uint8Array): NonNullable<RespDataHighwayHead["msgSegHead"]> {
  const out: NonNullable<RespDataHighwayHead["msgSegHead"]> = {};
  const reader = new ProtoReader(bytes);
  while (reader.next()) {
    switch (reader.tag) {
      // `SegHead` field numbers, from `protobuf_decode_SegHead`'s dispatch
      // (index.mjs:33189-33462). Tags are 8/16/24/32/40/48/56/66/74/80/104, i.e. fields
      // 1..11 with wire type 0 — EXCEPT field 8 (`md5`) and 9 (`fileMd5`) which are
      // length-delimited at tags 66 and 74.
      //
      //  1 serviceId · 2 filesize · 3 dataOffset · 4 dataLength · 5 retCode
      //
      // These were each one too high, which made the acknowledgement read `filesize` out of
      // `dataOffset` and `dataOffset` out of `dataLength`. The mismatch check then compared the
      // wrong values and reported a protocol error that was our own off-by-one.
      case tagOf(1, WireType.varint):
        out.serviceId = Number(reader.uint64());
        break;
      case tagOf(2, WireType.varint):
        out.filesize = reader.uint64();
        break;
      case tagOf(3, WireType.varint):
        out.dataOffset = reader.uint64();
        break;
      case tagOf(4, WireType.varint):
        out.dataLength = Number(reader.uint64());
        break;
      case tagOf(5, WireType.varint):
        out.retCode = Number(reader.uint64());
        break;
      default:
        reader.skip();
        break;
    }
  }
  return out;
}

/**
 * Decode a `RespDataHighwayHead`.
 *
 * Every field is treated as absent-able and unknown fields are skipped, because
 * the server adds fields over time and a strict decoder turns a server-side
 * addition into a broken upload. The chunk loop only reads `errorCode`,
 * `msgSegHead.retCode`, and the acknowledgement triple.
 */
export function decodeRespDataHighwayHead(bytes: Uint8Array): RespDataHighwayHead {
  const result: RespDataHighwayHead = { errorCode: 0 };
  const reader = new ProtoReader(bytes);
  while (reader.next()) {
    switch (reader.tag) {
      // The RESPONSE head's field numbering is NOT the request head's, and this is not a
      // symmetric message despite the shared name prefix:
      //
      //   ReqDataHighwayHead  { 1 msgBaseHead, 2 msgSegHead, 3 bytesReqExtendInfo,
      //                         4 timestamp, 5 msgLoginSigHead }
      //   RespDataHighwayHead { 1 msgBaseHead, 2 msgSegHead, 3 errorCode }
      //
      // Reference: `protobuf_decode_RespDataHighwayHead` dispatches case 10 (= field 1, wt 2)
      // to DataHighwayHead, case 18 (= field 2, wt 2) to SegHead, and case 24 (= field 3,
      // wt 0) to errorCode (index.mjs:33966-34000).
      //
      // Reading `errorCode` from field 1 instead shifts everything by one: field 1 is a
      // length-delimited message, so a varint read there is nonsense, field 2's SeqHead gets
      // decoded as the base head, and field 3 — which does not exist — leaves `msgSegHead`
      // undefined. The acknowledgement then compares `msgBaseHead.seq` against
      // `SegHead.dataLength` and fails with `ackSeq=<chunkSize>`, which looks like a server
      // protocol disagreement and is entirely our own field numbering.
      case tagOf(1, WireType.lengthDelimited): {
        const seq = decodeNestedSeq(reader.bytes());
        if (seq !== undefined) result.msgBaseHead = { seq };
        break;
      }
      case tagOf(2, WireType.lengthDelimited):
        result.msgSegHead = decodeNestedSeg(reader.bytes());
        break;
      case tagOf(3, WireType.varint):
        result.errorCode = Number(reader.uint64());
        break;
      default:
        // A varint on fields 2/3 means the server changed the shape; skipping is safer than
        // mis-assigning a value to an acknowledgement field, which would fail the upload with
        // a confusing "acknowledgement mismatch".
        reader.skip();
        break;
    }
  }
  return result;
}
