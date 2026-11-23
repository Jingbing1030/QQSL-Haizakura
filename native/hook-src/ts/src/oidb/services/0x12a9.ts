// OidbSvcTrpcTcp.0x12a9_200 — resolve a flash-transfer (fileset) file to a URL.
//
// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------
// The batch brief calls 0x12a9 a "profile card fetch".  It is `GetFlashDownload`
// (`command = 4777`, `subCommand = 200`, `uinForm = true`,
// reference/index.mjs:90790-90792), used by `get_flash_file_url` and
// `download_fileset`.  Nothing profile-related lives here.
//
// ---------------------------------------------------------------------------
// Why this file contains a request *counter*
// ---------------------------------------------------------------------------
// `serialize` uses `seq: seqCounter$2++` — a module-scope counter that starts at
// **300** (reference/index.mjs:90787) and increments on every call
// (reference/index.mjs:90796).  It is part of the request, so two identical calls
// do **not** produce identical bytes.
//
// The counter is state.  It is modelled here as a module-level `let` seeded at 300,
// with a `resetFlashSequence()` escape hatch so tests can pin it.  Note that the
// counter is *not* per-connection or per-account in the reference either; it is per
// loaded module copy, which is why `$2` appears in the name — there are several
// copies in the bundle and each has its own counter.
//
// Because the sequence is the only variable part, the goldens for this command are
// generated with the counter pinned to its initial 300 (`get-flash-download`'s
// fresh module copy) and the tests reset it before asserting.
//
// ---------------------------------------------------------------------------
// Field numbers — the request is almost entirely constants
// ---------------------------------------------------------------------------
//   FlashGetDownloadReq    reference/index.mjs:88689 / 88711
//     1 head -> FlashApplyHead
//     3 payload -> FlashGetDownloadPayload
//   FlashApplyHead         88766 / 88797   1 sub, 2 config, 3 field3
//   FlashApplyHeadSub      88878 / 88894   1 seq, 2 sub
//   FlashApplyHeadConfig   89052 / 89080   101 field101, 102 field102,
//                                          103 field103, 200 field200
//   FlashApplyFlag2        89187 / 89197   1 field1        (the head's `field3`)
//   FlashGetDownloadPayload 89225 / 89253  1 wrapper, 2 field2, 3 field3
//   FlashGetDownloadWrapper 89333 / 89377  1 fileInfo, 2 fileId, 3..6 field3..6
//   FlashGetDownloadFileInfo 89533 / 89583 1 field1, 4 field4, 5 field5,
//                                          6..9 field6..9
//   FlashApplyFileInfo5    89764 / 89792   1..4 field1..4, all `!= null`
//   FlashGetDownloadPayload2 89895 / 89926 2 field2, 4 field4, 10 filesetWrap
//   FlashGetDownloadParam  90007 / 90038   1 field1, 3 field3, 5 field5, 6 field6
//   FlashGetDownloadParam6 90142 / 90152   1 field1
//   FlashGetDownloadFlag4  90180 / 90190   1 field1
//   FlashGetDownloadFilesetWrap 90218 / 90249  1 filesetUuid, 2 fileUuid,
//                                              3 field3, 4 field4
//
// ⚠️ Three separate messages have a field numbered **1 that is not their first
// payload slot**: `FlashGetDownloadPayload2` starts at 2, `FlashApplyHeadConfig`
// starts at 101, and `FlashGetDownloadFileInfo` skips 2 and 3.  The only reason
// these tables are usable at all is that every number came from the literal tag
// byte in `__write_`.
//
// ⚠️ `FlashApplyFileInfo5`'s four fields all use the bare `!= null` guard, so the
// reference's explicit zeros are **written** (`08 00 10 00 18 00 20 00`).  Every
// other all-zero field in this file vanishes.  This is the single easiest place to
// get the byte length wrong by four.
//
// ⚠️ `field1: 4294967294` and `field3: 4294967295` in `FlashGetDownloadParam` are
// **uint32 sentinels** (2^32-2 and 2^32-1), not `-2`/`-1`.  Encoding them through
// `int32` produces the ten-byte sign-extended varint `fe ff ff ff ff ff ff ff ff 01`
// instead of the five-byte `fe ff ff ff 0f`.  The golden bytes show
// `08feffffff0f18ffffffff0f`, which is the unsigned five-byte form.
//
// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------
//   FlashGetDownloadResp    reference/index.mjs:90569
//     1 head -> FlashApplyHeadResp
//     3 body **bytes**          <-- the URL blob, not a message
//   FlashApplyHeadResp      90678   1 sub -> FlashApplyHeadSub, 3 msg string
//
// The body is an opaque byte blob holding the actual download URL as text
// (`serialize`'s `deserialize` scans it with regexes).  It is *not* protobuf there,
// which is why the decoder must keep it as bytes and the projection must do the
// latin1 scan itself.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 4777 = 0x12a9. */
export const FLASH_DOWNLOAD_COMMAND = 0x12a9;

export const FLASH_DOWNLOAD_SUB_COMMAND = 200;

/** Constants from `serialize` (reference/index.mjs:90793-90820). */
export const FLASH_APPLY_HEAD_CONFIG = { field101: 2, field102: 4, field103: 22, field200: 5 } as const;
export const FLASH_FILE_INFO5 = { field1: 0, field2: 0, field3: 0, field4: 0 } as const;
export const FLASH_PARAM = {
  field1: 4294967294,
  field3: 4294967295,
  field5: 111,
  field6: { field1: 3403722988 },
} as const;
export const FLASH_FILESET_EXTRA_FIELD3 = 26;

/**
 * `seqCounter$2` (reference/index.mjs:90787).  Module state, part of the request.
 *
 * Seeded at 300 — not 0 and not 1.  A fresh counter is assumed by the reference's
 * own first call, so any test that starts from a freshly loaded module sees 300.
 */
let flashSequence = 300;

/** Read the next value `serialize` would use, without consuming it. */
export function peekFlashSequence(): number {
  return flashSequence;
}

/**
 * Reset the counter.
 *
 * Exists only so tests are deterministic.  Production code must never call it: the
 * counter is monotonic in the reference and the server uses it to order transfers.
 */
export function resetFlashSequence(value = 300): void {
  flashSequence = value;
}

export const FlashDownloadReqField = { head: 1, payload: 3 } as const;
export const FlashApplyHeadField = { sub: 1, config: 2, field3: 3 } as const;
export const FlashApplyHeadSubField = { seq: 1, sub: 2 } as const;
export const FlashApplyHeadConfigField = {
  field101: 101,
  field102: 102,
  field103: 103,
  field200: 200,
} as const;
export const FlashApplyFlag2Field = { field1: 1 } as const;
export const FlashDownloadPayloadField = { wrapper: 1, field2: 2, field3: 3 } as const;
export const FlashDownloadWrapperField = {
  fileInfo: 1,
  fileId: 2,
  field3: 3,
  field4: 4,
  field5: 5,
  field6: 6,
} as const;
export const FlashFileInfoField = {
  field1: 1,
  field4: 4,
  field5: 5,
  field6: 6,
  field7: 7,
  field8: 8,
  field9: 9,
} as const;
export const FlashFileInfo5Field = { field1: 1, field2: 2, field3: 3, field4: 4 } as const;
export const FlashDownloadPayload2Field = { field2: 2, field4: 4, filesetWrap: 10 } as const;
export const FlashDownloadParamField = { field1: 1, field3: 3, field5: 5, field6: 6 } as const;
export const FlashDownloadParam6Field = { field1: 1 } as const;
export const FlashDownloadFlag4Field = { field1: 1 } as const;
export const FlashFilesetWrapField = {
  filesetUuid: 1,
  fileUuid: 2,
  field3: 3,
  field4: 4,
} as const;

export const FlashDownloadRespField = { head: 1, body: 3 } as const;
export const FlashApplyHeadRespField = { sub: 1, msg: 3 } as const;

// ---------------------------------------------------------------------------
// Request messages
// ---------------------------------------------------------------------------

export interface FlashApplyHeadSub {
  seq: number;
  sub: number;
}

export interface FlashApplyHeadConfig {
  field101: number;
  field102: number;
  field103: number;
  field200: number;
}

export interface FlashApplyHead {
  sub: FlashApplyHeadSub;
  config: FlashApplyHeadConfig;
  field3: { field1: number };
}

export interface FlashFileInfo5 {
  field1: number;
  field2: number;
  field3: number;
  field4: number;
}

export interface FlashFileInfo {
  field1: number;
  field4: string;
  field5: FlashFileInfo5;
  field6: number;
  field7: number;
  field8: number;
  field9: number;
}

export interface FlashDownloadWrapper {
  fileInfo: FlashFileInfo;
  fileId: string;
  field3: number;
  field4: number;
  field5: number;
  field6: number;
}

export interface FlashDownloadParam6 {
  field1: number;
}

export interface FlashDownloadParam {
  field1: number;
  field3: number;
  field5: number;
  field6: FlashDownloadParam6;
}

export interface FlashFilesetWrap {
  filesetUuid: string;
  fileUuid: string;
  field3: number;
  field4: string;
}

export interface FlashDownloadPayload2 {
  field2: FlashDownloadParam;
  field4: { field1: number };
  filesetWrap: FlashFilesetWrap;
}

export interface FlashDownloadPayload {
  wrapper: FlashDownloadWrapper;
  field2: FlashDownloadPayload2;
  field3: number;
}

export interface FlashDownloadReq {
  head: FlashApplyHead;
  payload: FlashDownloadPayload;
}

export function encodeFlashApplyHeadSub(s: FlashApplyHeadSub): Uint8Array {
  return new ProtoWriter()
    .uint32(FlashApplyHeadSubField.seq, s.seq)
    .uint32(FlashApplyHeadSubField.sub, s.sub)
    .finish();
}

export function encodeFlashApplyHeadConfig(c: FlashApplyHeadConfig): Uint8Array {
  return new ProtoWriter()
    .uint32(FlashApplyHeadConfigField.field101, c.field101)
    .uint32(FlashApplyHeadConfigField.field102, c.field102)
    .uint32(FlashApplyHeadConfigField.field103, c.field103)
    .uint32(FlashApplyHeadConfigField.field200, c.field200)
    .finish();
}

export function encodeFlashApplyFlag2(f: { field1: number }): Uint8Array {
  return new ProtoWriter().uint32(FlashApplyFlag2Field.field1, f.field1).finish();
}

export function encodeFlashApplyHead(h: FlashApplyHead): Uint8Array {
  return new ProtoWriter()
    .message(FlashApplyHeadField.sub, encodeFlashApplyHeadSub(h.sub))
    .message(FlashApplyHeadField.config, encodeFlashApplyHeadConfig(h.config))
    .message(FlashApplyHeadField.field3, encodeFlashApplyFlag2(h.field3))
    .finish();
}

/** ⚠️ All four use the bare `!= null` guard, so the zeros ARE written. */
export function encodeFlashFileInfo5(f: FlashFileInfo5): Uint8Array {
  return new ProtoWriter()
    .uint32Present(FlashFileInfo5Field.field1, f.field1)
    .uint32Present(FlashFileInfo5Field.field2, f.field2)
    .uint32Present(FlashFileInfo5Field.field3, f.field3)
    .uint32Present(FlashFileInfo5Field.field4, f.field4)
    .finish();
}

export function encodeFlashFileInfo(f: FlashFileInfo): Uint8Array {
  return new ProtoWriter()
    .uint32(FlashFileInfoField.field1, f.field1)
    .string(FlashFileInfoField.field4, f.field4)
    .message(FlashFileInfoField.field5, encodeFlashFileInfo5(f.field5))
    .uint32(FlashFileInfoField.field6, f.field6)
    .uint32(FlashFileInfoField.field7, f.field7)
    .uint32(FlashFileInfoField.field8, f.field8)
    .uint32(FlashFileInfoField.field9, f.field9)
    .finish();
}

export function encodeFlashDownloadWrapper(w: FlashDownloadWrapper): Uint8Array {
  return new ProtoWriter()
    .message(FlashDownloadWrapperField.fileInfo, encodeFlashFileInfo(w.fileInfo))
    .string(FlashDownloadWrapperField.fileId, w.fileId)
    .uint32(FlashDownloadWrapperField.field3, w.field3)
    .uint32(FlashDownloadWrapperField.field4, w.field4)
    .uint32(FlashDownloadWrapperField.field5, w.field5)
    .uint32(FlashDownloadWrapperField.field6, w.field6)
    .finish();
}

export function encodeFlashDownloadParam6(p: FlashDownloadParam6): Uint8Array {
  return new ProtoWriter().uint32(FlashDownloadParam6Field.field1, p.field1).finish();
}

/**
 * ⚠️ `field1: 4294967294` / `field3: 4294967295` are uint32 sentinels.
 *
 * They are written as plain uint32 (five bytes each), not as int32 — the generated
 * writer does `let _v = _f0 >>> 0` (reference/index.mjs:90047 region), which the
 * golden confirms as `feffffff0f` / `ffffffff0f`.
 */
export function encodeFlashDownloadParam(p: FlashDownloadParam): Uint8Array {
  return new ProtoWriter()
    .uint32(FlashDownloadParamField.field1, p.field1)
    .uint32(FlashDownloadParamField.field3, p.field3)
    .uint32(FlashDownloadParamField.field5, p.field5)
    .message(FlashDownloadParamField.field6, encodeFlashDownloadParam6(p.field6))
    .finish();
}

export function encodeFlashFilesetWrap(f: FlashFilesetWrap): Uint8Array {
  return new ProtoWriter()
    .string(FlashFilesetWrapField.filesetUuid, f.filesetUuid)
    .string(FlashFilesetWrapField.fileUuid, f.fileUuid)
    .uint32(FlashFilesetWrapField.field3, f.field3)
    .string(FlashFilesetWrapField.field4, f.field4)
    .finish();
}

export function encodeFlashDownloadPayload2(p: FlashDownloadPayload2): Uint8Array {
  return new ProtoWriter()
    .message(FlashDownloadPayload2Field.field2, encodeFlashDownloadParam(p.field2))
    .message(
      FlashDownloadPayload2Field.field4,
      new ProtoWriter()
        .uint32(FlashDownloadFlag4Field.field1, p.field4.field1)
        .finish(),
    )
    .message(FlashDownloadPayload2Field.filesetWrap, encodeFlashFilesetWrap(p.filesetWrap))
    .finish();
}

export function encodeFlashDownloadPayload(p: FlashDownloadPayload): Uint8Array {
  return new ProtoWriter()
    .message(FlashDownloadPayloadField.wrapper, encodeFlashDownloadWrapper(p.wrapper))
    .message(FlashDownloadPayloadField.field2, encodeFlashDownloadPayload2(p.field2))
    .uint32(FlashDownloadPayloadField.field3, p.field3)
    .finish();
}

export function encodeFlashDownloadReq(body: FlashDownloadReq): Uint8Array {
  return new ProtoWriter()
    .message(FlashDownloadReqField.head, encodeFlashApplyHead(body.head))
    .message(FlashDownloadReqField.payload, encodeFlashDownloadPayload(body.payload))
    .finish();
}

// ---------------------------------------------------------------------------
// Response decoding
// ---------------------------------------------------------------------------

export interface FlashApplyHeadResp {
  sub?: FlashApplyHeadSub | undefined;
  msg: string;
}

export interface FlashDownloadResp {
  head?: FlashApplyHeadResp | undefined;
  /** The opaque URL blob — **bytes**, not a message. */
  body?: Uint8Array | undefined;
}

function decodeFlashApplyHeadSubResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashApplyHeadSub {
  const reader = new ProtoReader(data, offset, end);
  const sub: FlashApplyHeadSub = { seq: 0, sub: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashApplyHeadSubField.seq, WireType.varint):
        sub.seq = reader.uint32();
        break;
      case tagOf(FlashApplyHeadSubField.sub, WireType.varint):
        sub.sub = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return sub;
}

function decodeFlashApplyHeadResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashApplyHeadResp {
  const reader = new ProtoReader(data, offset, end);
  const h: FlashApplyHeadResp = { msg: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashApplyHeadRespField.sub, WireType.lengthDelimited):
        h.sub = reader.message(decodeFlashApplyHeadSubResp);
        break;
      case tagOf(FlashApplyHeadRespField.msg, WireType.lengthDelimited):
        h.msg = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return h;
}

export function decodeFlashDownloadResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashDownloadResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: FlashDownloadResp = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashDownloadRespField.head, WireType.lengthDelimited):
        resp.head = reader.message(decodeFlashApplyHeadResp);
        break;
      case tagOf(FlashDownloadRespField.body, WireType.lengthDelimited):
        resp.body = reader.bytes();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * `GetFlashDownload.deserialize` (reference/index.mjs:90856).
 *
 * The blob is scanned as **latin1**, not UTF-8: it is raw bytes where the URL is
 * only part of the content, and a UTF-8 decode would both mangle the surrounding
 * bytes and throw on invalid sequences.  The three regexes are copied verbatim —
 * the appid `14901` and the `[\x20-\x7e]*` range are what constrain the match, and
 * widening the range to "anything" would swallow the trailing binary.
 *
 * ⚠️ The `rkey` capture is appended as `&${match[0]}`, where `match[0]` already
 * starts with `rkey=` — so the result ends `...&rkey=...`, not `...&...`.  Stripping
 * the prefix from the match would produce a signed-looking URL that does not work.
 *
 * Returns `null` (not "") when the host or path is missing: the caller distinguishes
 * "no flash URL available" from "empty URL".
 */
export function parseFlashDownloadUrl(body: FlashDownloadResp): string | null {
  const raw = body.body;
  if (!raw || raw.length === 0) return null;
  const text = latin1(raw);
  const host = /multimedia\.qfile\.qq\.com/.exec(text);
  const path = /\/download\?appid=14901[\x20-\x7e]*/.exec(text);
  const rkey = /rkey=([A-Za-z0-9_-]+)/.exec(text);
  if (!host || !path) return null;
  const base = `https://${host[0]}${path[0]}`;
  return rkey ? `${base}&${rkey[0]}` : base;
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  // Chunked to keep the argument count well under the engine's spread limit while
  // still being a single pass — the blob can be tens of kilobytes.
  const chunk = 4096;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

export interface GetFlashDownloadParams {
  filesetUuid: string;
  fileUuid: string;
  fileName: string;
  fileId: string;
}

/**
 * GetFlashDownload spec.
 *
 * `serialize` consumes the module-scope sequence counter, so this spec is *stateful*
 * — two calls with identical params differ in `head.sub.seq`.  Every other byte is a
 * constant.
 */
export const GetFlashDownload: OidbSpec<
  GetFlashDownloadParams,
  FlashDownloadReq,
  FlashDownloadResp,
  string | null
> = {
  command: FLASH_DOWNLOAD_COMMAND,
  subCommand: FLASH_DOWNLOAD_SUB_COMMAND,
  uinForm: true,
  serialize: (params) => ({
    head: {
      sub: { seq: flashSequence++, sub: FLASH_DOWNLOAD_SUB_COMMAND },
      config: { ...FLASH_APPLY_HEAD_CONFIG },
      field3: { field1: 1 },
    },
    payload: {
      wrapper: {
        fileInfo: {
          field1: 0,
          field4: params.fileName,
          field5: { ...FLASH_FILE_INFO5 },
          field6: 0,
          field7: 0,
          field8: 0,
          field9: 0,
        },
        fileId: params.fileId,
        field3: 0,
        field4: 0,
        field5: 0,
        field6: 0,
      },
      field2: {
        field2: {
          field1: FLASH_PARAM.field1,
          field3: FLASH_PARAM.field3,
          field5: FLASH_PARAM.field5,
          field6: { field1: FLASH_PARAM.field6.field1 },
        },
        field4: { field1: 0 },
        filesetWrap: {
          filesetUuid: params.filesetUuid,
          fileUuid: params.fileUuid,
          field3: FLASH_FILESET_EXTRA_FIELD3,
          field4: params.fileUuid,
        },
      },
      field3: 0,
    },
  }),
  encodeBody: encodeFlashDownloadReq,
  decodeBody: decodeFlashDownloadResp,
  deserialize: (body) => parseFlashDownloadUrl(body),
};