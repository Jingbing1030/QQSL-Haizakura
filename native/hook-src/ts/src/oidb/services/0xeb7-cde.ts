// The misc family — 0xeb7_1, 0x990_2, 0xcde_2, 0xe07_0.
//
// ---------------------------------------------------------------------------
// Which command is which
// ---------------------------------------------------------------------------
// All four labels in the brief were right, and all four are unrelated commands on
// unrelated numbers — there is no "misc" family in the protocol, only in the
// bridge module that happens to call them:
//
//   SendGroupSign   0xeb7  (3767)   sub 1   wireName OVERRIDE: "OidbSvcTrpcTcp.0xEB7_1"
//   TranslateEnToZh 0x990  (2448)   sub 2
//   RequestDbKey    0xcde  (3294)   sub 2
//   ImageOcr        0xe07  (3591)   sub 0
//
// ⚠️ `SendGroupSign` is the **only command in this port that overrides its wire
// name**, and it does so with different capitalisation:
//
//     default  oidbWireName(0xeb7, 1) = "OidbSvcTrpcTcp.0xeb7_1"   (lowercase)
//     override                          "OidbSvcTrpcTcp.0xEB7_1"   (UPPERCASE)
//
// `ts/src/oidb/envelope.ts`'s `oidbWireName` lowercases the hex, so the published
// `wireName` field on the spec is required to keep the uppercase spelling. This is
// a server-side string match: sending the lowercase form is a different service
// name and the reply never arrives. `spec.ts` already carries a `wireName`
// override hook “only 0xeb7_1 needs it” — that comment is about this command and
// it is the reason the hook exists.
//
// ⚠️ `RequestDbKey` has **two** independent failure channels and the spec uses
// both: the envelope's error code (thrown by `invokeOidb`) and a missing `dbKey`
// inside a successful envelope. Its `invoke` is the one that *returns* a result
// object instead of throwing, so a caller can distinguish "wrong database"
// (code 1006) from "network". That wrapper is rebuilt here as
// `requestDbKeyResult` rather than folded into the spec, because a spec that
// swallows its own errors cannot be tested through `invokeOidb`.
//
// ---------------------------------------------------------------------------
// Field-number surprises
// ---------------------------------------------------------------------------
// ★ THE ONE PATTERN IN THIS FAMILY: all three `Oidb*Req` bodies put their real
//   payload at field **2**, leaving field 1 unused — `signInInfo` (0xeb7),
//   `translateReq` (0x990) and `info` (0xcde). Only 0xe07's `ImageOcrReq` follows
//   the conventional "field 1 first". Three out of four guessing wrong is the
//   clearest illustration of MEMORY.md §2.3's rule in this batch: none of these
//   is a typo, each schema simply reserves 1. The failure mode is silence — the
//   server skips an unknown field, so a field-1 build sends a well-formed request
//   that the server answers with an empty or default response.
//   Oidb0xeb7Req       **2 signInInfo** (field 1 UNUSED)
//     Oidb0xeb7SignInInfo  1 uin(string!), 2 groupId(string!), 3 version(string)
//     ⚠️ All three are **strings**, including the two numeric ones. The reference
//     passes `String(ctx.identity.uin)` and `String(p.groupId)`. A group id sent
//     as a varint here is silently unreadable to the server. `version` is the
//     literal "9.0.90" — a client build string, not a schema version.
//
//   Oidb0x990Req       **2 translateReq** (field 1 UNUSED), 10 tag10, 12 tag12
//     The two trailing fields are constants (both 1) and are not part of any
//     sub-message; they sit at 10 and 12 because the schema skipped 2..9.
//     Oidb0x990TranslateReq  1 srcLang, 2 dstLang, 3 words **repeated string,
//     non-packed** (one `1a` per word — a packed encoding reads as nothing).
//
//   Oidb0xcdeReq       **2 info** (field 1 UNUSED), 10 sessionData(bytes)
//     Oidb0xcdeReqBodyInfo  1 db_salt  ⚠️ **snake_case on the wire-facing
//     property name**, the only such name in this whole port. It is the
//     reference's own spelling, kept because a re-encode by name is a real use
//     case and renaming it would break that silently.
//     `sessionData` is **optional in the request and OMITTED, not empty**, when
//     absent — `if (p.sessionData) req.sessionData = p.sessionData` (:314580), so
//     a zero-length Uint8Array is dropped while `undefined` is too. Both are the
//     `length > 0` rule; there is no third state.
//
//   ImageOcrReq        1 version, 2 client, 3 entrance, 10 ocrReqBody
//     OcrReqBody  1 imageUrl, 2 languageType, 3 scene, **10..14** the compress
//     block (originMd5 / afterCompressMd5 / afterCompressFileSize /
//     afterCompressWeight / afterCompressHeight) — all five are **strings** even
//     though three of them are numbers, and `serialize` sends all five as "" so
//     none reaches the wire. `isCut` (the reference sets `false`) is **not a field
//     of this message at all**: it is dropped, and there is nothing at 15+.
//
// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------
//   Oidb0xeb7Resp     — an EMPTY message: the decoder has no case at all and
//                       returns `{}`. `deserialize` returns undefined.
//   Oidb0x990Resp     2 translateResp
//     Oidb0x990TranslateResp  1 errorCode, 2 errorMsg, 3 srcLang, 4 dstLang,
//                             5 srcWords[], 6 dstWords[]
//     ⚠️ The response's error is **inside** field 2's sub-message (`errorCode`
//     field 1) and `deserialize` does NOT inspect it — it returns `dstWords`
//     whatever the code says. Preserved: a failed translation therefore looks like
//     an empty array, which is why `translateToChinese` documents that behaviour
//     instead of "fixing" it.
//   Oidb0xcdeResp     2 info -> 1 dbKey(string)
//   ImageOcrResp      1 retCode, 2 errMsg, 3 wording, 10 ocrRspBody
//     OcrRspBody  1 textDetections[], 2 language, 3 requestId
//     OcrTextDetection  1 detectedText, 2 confidence, 3 polygon, 4 advancedInfo
//     OcrPolygon  1 coordinates[]
//     OcrCoordinate  1 x, 2 y   -- **int32**, decoded `_val | 0`, so a negative
//     coordinate comes back negative. The reference feeds these straight into
//     `coordinates: {x, y}`; reading them as uint32 turns -1 into 4294967295.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";
import { OidbError } from "../envelope.js";
import { decodeOidbEmpty, type OidbEmpty } from "./0x89a-0.js";

// ---------------------------------------------------------------------------
// Command numbers
// ---------------------------------------------------------------------------

/** 3767 = 0xeb7 — group sign-in. */
export const SEND_GROUP_SIGN_COMMAND = 0xeb7;
export const SEND_GROUP_SIGN_SUB_COMMAND = 1;
/**
 * The only wire-name override in the port. Uppercase `EB7` — see the header.
 *
 * `spec.ts`'s `wireName` hook exists for exactly this command.
 */
export const SEND_GROUP_SIGN_WIRE_NAME = "OidbSvcTrpcTcp.0xEB7_1";

/** 2448 = 0x990 — English -> Chinese translation. */
export const TRANSLATE_COMMAND = 0x990;
export const TRANSLATE_SUB_COMMAND = 2;

/** 3294 = 0xcde — database decryption key. */
export const REQUEST_DB_KEY_COMMAND = 0xcde;
export const REQUEST_DB_KEY_SUB_COMMAND = 2;
/** The one error code the reference special-cases: the database is not this account's. */
export const DB_KEY_MISMATCH_CODE = 1006;

/** 3591 = 0xe07 — image OCR. */
export const IMAGE_OCR_COMMAND = 0xe07;
export const IMAGE_OCR_SUB_COMMAND = 0;

/** The client build string `SendGroupSign` sends as `version`. */
export const GROUP_SIGN_CLIENT_VERSION = "9.0.90";

// ---------------------------------------------------------------------------
// Field tables
// ---------------------------------------------------------------------------

/**
 * ⚠️ `signInInfo` is field **2**, not 1 — the third message in this family whose
 * payload starts at 2 with field 1 unused (`__write_Oidb0xeb7Req` emits `12`,
 * reference/index.mjs:311631).
 */
export const Oidb0xeb7ReqField = { signInInfo: 2 } as const;
/** ⚠️ Every field is a **string**, including the numeric uin and group id. */
export const Oidb0xeb7SignInInfoField = { uin: 1, groupId: 2, version: 3 } as const;

/**
 * ⚠️ `translateReq` is field **2**, not 1 — the schema starts at 2 and leaves 1
 * unused (`__write_Oidb0x990Req` emits tag `18`, reference/index.mjs:312727).
 * The obvious "first field is 1" guess produces a body the server ignores: the
 * golden `0890131002221c...` shows `12` (field 2) where a field-1 build shows `0a`.
 */
export const Oidb0x990ReqField = { translateReq: 2, tag10: 10, tag12: 12 } as const;
export const Oidb0x990TranslateReqField = { srcLang: 1, dstLang: 2, words: 3 } as const;
export const Oidb0x990RespField = { translateResp: 2 } as const;
export const Oidb0x990TranslateRespField = {
  errorCode: 1,
  errorMsg: 2,
  srcLang: 3,
  dstLang: 4,
  srcWords: 5,
  dstWords: 6,
} as const;

/**
 * ⚠️ `info` is field **2**, not 1 — tag `12` on the wire (:314090). Same trap as
 * 0x990Req: both of these messages begin at 2, and both would fail silently.
 */
export const Oidb0xcdeReqField = { info: 2, sessionData: 10 } as const;
/** ⚠️ `db_salt` keeps the reference's snake_case spelling. */
export const Oidb0xcdeReqBodyInfoField = { db_salt: 1 } as const;
export const Oidb0xcdeRespField = { info: 2 } as const;
export const Oidb0xcdeRespBodyInfoField = { dbKey: 1 } as const;

export const ImageOcrReqField = {
  version: 1,
  client: 2,
  entrance: 3,
  ocrReqBody: 10,
} as const;
export const OcrReqBodyField = {
  imageUrl: 1,
  languageType: 2,
  scene: 3,
  originMd5: 10,
  afterCompressMd5: 11,
  afterCompressFileSize: 12,
  afterCompressWeight: 13,
  afterCompressHeight: 14,
} as const;
export const ImageOcrRespField = {
  retCode: 1,
  errMsg: 2,
  wording: 3,
  ocrRspBody: 10,
} as const;
export const OcrRspBodyField = {
  textDetections: 1,
  language: 2,
  requestId: 3,
} as const;
export const OcrTextDetectionField = {
  detectedText: 1,
  confidence: 2,
  polygon: 3,
  advancedInfo: 4,
} as const;
export const OcrPolygonField = { coordinates: 1 } as const;
/** `x`/`y` are int32 (`_val | 0`), so negative values are meaningful. */
export const OcrCoordinateField = { x: 1, y: 2 } as const;

// ---------------------------------------------------------------------------
// 0xeb7_1 — group sign-in
// ---------------------------------------------------------------------------

export interface Oidb0xeb7SignInInfo {
  /** The signer's uin as a **decimal string**. */
  uin: string;
  /** The group number as a **decimal string**. */
  groupId: string;
  /** Client build string, e.g. "9.0.90". */
  version: string;
}

export interface Oidb0xeb7Req {
  signInInfo: Oidb0xeb7SignInInfo;
}

export function encodeOidb0xeb7SignInInfo(info: Oidb0xeb7SignInInfo): Uint8Array {
  return new ProtoWriter()
    .string(Oidb0xeb7SignInInfoField.uin, info.uin)
    .string(Oidb0xeb7SignInInfoField.groupId, info.groupId)
    .string(Oidb0xeb7SignInInfoField.version, info.version)
    .finish();
}

export function encodeOidb0xeb7Req(body: Oidb0xeb7Req): Uint8Array {
  return new ProtoWriter()
    .message(Oidb0xeb7ReqField.signInInfo, encodeOidb0xeb7SignInInfo(body.signInInfo))
    .finish();
}

// ---------------------------------------------------------------------------
// 0x990_2 — translate en -> zh
// ---------------------------------------------------------------------------

export interface Oidb0x990TranslateReq {
  /** Always "en". */
  srcLang: string;
  /** Always "zh". */
  dstLang: string;
  /** Repeated, **non-packed** — one length-delimited field per word. */
  words: string[];
}

export interface Oidb0x990Req {
  translateReq: Oidb0x990TranslateReq;
  /** Constant 1. */
  tag10: number;
  /** Constant 1. */
  tag12: number;
}

export function encodeOidb0x990TranslateReq(req: Oidb0x990TranslateReq): Uint8Array {
  const writer = new ProtoWriter()
    .string(Oidb0x990TranslateReqField.srcLang, req.srcLang)
    .string(Oidb0x990TranslateReqField.dstLang, req.dstLang);
  // Non-packed repetition: each element is its own `1a`. `repeatedString` does
  // this, and a packed writer would produce a body the server reads as empty.
  for (const word of req.words) writer.string(Oidb0x990TranslateReqField.words, word);
  return writer.finish();
}

export function encodeOidb0x990Req(body: Oidb0x990Req): Uint8Array {
  return new ProtoWriter()
    .message(Oidb0x990ReqField.translateReq, encodeOidb0x990TranslateReq(body.translateReq))
    .uint32(Oidb0x990ReqField.tag10, body.tag10)
    .uint32(Oidb0x990ReqField.tag12, body.tag12)
    .finish();
}

export interface Oidb0x990TranslateResp {
  errorCode: number | null;
  errorMsg: string | null;
  srcLang: string | null;
  dstLang: string | null;
  srcWords: string[];
  dstWords: string[];
}

export interface Oidb0x990Resp {
  translateResp: Oidb0x990TranslateResp | null;
}

export function decodeOidb0x990TranslateResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): Oidb0x990TranslateResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: Oidb0x990TranslateResp = {
    errorCode: null,
    errorMsg: null,
    srcLang: null,
    dstLang: null,
    srcWords: [],
    dstWords: [],
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Oidb0x990TranslateRespField.errorCode, WireType.varint):
        resp.errorCode = reader.uint32();
        break;
      case tagOf(Oidb0x990TranslateRespField.errorMsg, WireType.lengthDelimited):
        resp.errorMsg = reader.string();
        break;
      case tagOf(Oidb0x990TranslateRespField.srcLang, WireType.lengthDelimited):
        resp.srcLang = reader.string();
        break;
      case tagOf(Oidb0x990TranslateRespField.dstLang, WireType.lengthDelimited):
        resp.dstLang = reader.string();
        break;
      case tagOf(Oidb0x990TranslateRespField.srcWords, WireType.lengthDelimited):
        resp.srcWords.push(reader.string());
        break;
      case tagOf(Oidb0x990TranslateRespField.dstWords, WireType.lengthDelimited):
        resp.dstWords.push(reader.string());
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export function decodeOidb0x990Resp(data: Uint8Array, offset = 0, end = data.length): Oidb0x990Resp {
  const reader = new ProtoReader(data, offset, end);
  const resp: Oidb0x990Resp = { translateResp: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(Oidb0x990RespField.translateResp, WireType.lengthDelimited)) {
      resp.translateResp = reader.message(decodeOidb0x990TranslateResp);
    } else {
      reader.skip(unknown);
    }
  }
  return resp;
}

/**
 * The reference's `TranslateEnToZh.deserialize` (reference/index.mjs:313427).
 *
 * ⚠️ It throws only when the whole sub-message is missing, and returns
 * `dstWords || []` otherwise — the sub-message's own `errorCode` (field 1) is
 * **never inspected**. So a server-side translation failure comes back as an
 * empty array, indistinguishable from "nothing to translate". That is preserved
 * rather than corrected: callers in the reference already treat an empty result
 * as "no translation", and inventing an error here would change behaviour the
 * OneBot action does not expect.
 */
export function toTranslatedWords(resp: Oidb0x990Resp): string[] {
  const inner = resp.translateResp;
  if (!inner) throw new Error("translate response empty");
  return inner.dstWords || [];
}

// ---------------------------------------------------------------------------
// 0xcde_2 — database key
// ---------------------------------------------------------------------------

export interface Oidb0xcdeReqBodyInfo {
  /** ⚠️ snake_case is the reference's own property name for this wire field. */
  db_salt: string;
}

export interface Oidb0xcdeReq {
  info: Oidb0xcdeReqBodyInfo;
  /** Optional; omitted entirely (not sent empty) when absent. */
  sessionData?: Uint8Array | undefined;
}

export function encodeOidb0xcdeReqBodyInfo(info: Oidb0xcdeReqBodyInfo): Uint8Array {
  return new ProtoWriter().string(Oidb0xcdeReqBodyInfoField.db_salt, info.db_salt).finish();
}

export function encodeOidb0xcdeReq(body: Oidb0xcdeReq): Uint8Array {
  const writer = new ProtoWriter().message(
    Oidb0xcdeReqField.info,
    encodeOidb0xcdeReqBodyInfo(body.info),
  );
  // `if (p.sessionData) req.sessionData = p.sessionData` — presence, then the
  // usual `length > 0` rule, so empty and undefined are the same on the wire.
  if (body.sessionData) writer.bytes(Oidb0xcdeReqField.sessionData, body.sessionData);
  return writer.finish();
}

export interface Oidb0xcdeRespBodyInfo {
  dbKey: string | null;
}

export interface Oidb0xcdeResp {
  info: Oidb0xcdeRespBodyInfo | null;
}

export function decodeOidb0xcdeRespBodyInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): Oidb0xcdeRespBodyInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: Oidb0xcdeRespBodyInfo = { dbKey: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(Oidb0xcdeRespBodyInfoField.dbKey, WireType.lengthDelimited)) {
      info.dbKey = reader.string();
    } else {
      reader.skip(unknown);
    }
  }
  return info;
}

export function decodeOidb0xcdeResp(data: Uint8Array, offset = 0, end = data.length): Oidb0xcdeResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: Oidb0xcdeResp = { info: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(Oidb0xcdeRespField.info, WireType.lengthDelimited)) {
      resp.info = reader.message(decodeOidb0xcdeRespBodyInfo);
    } else {
      reader.skip(unknown);
    }
  }
  return resp;
}

/** The reference's `RequestDbKey.deserialize` (:314590): a missing dbKey is an error. */
export function toDbKey(resp: Oidb0xcdeResp): string {
  const dbKey = resp.info?.dbKey;
  if (!dbKey) throw new Error("Oidb 0xcde_2 payload empty (Missing dbKey)");
  return dbKey;
}

/** What `RequestDbKey.invoke` returns instead of throwing. */
export interface DbKeyResult {
  success: boolean;
  dbKey?: string;
  errorCode?: number;
  errorMsg?: string;
}

/**
 * Rebuild `RequestDbKey`'s own `invoke` wrapper (reference/index.mjs:314596).
 *
 * Unlike every other spec in this port, this one **catches its own errors** and
 * returns `{success: false, ...}` — because the actions that call it
 * (`get_db_key`) need to distinguish a wrong-database code (1006, with its own
 * Chinese wording) from a transport failure, and an exception cannot carry that
 * distinction to a OneBot caller.
 *
 * The call itself is passed in so this module never imports `invokeOidb`
 * (the codec half must stay callable from a pure test).
 */
export async function requestDbKeyResult(call: () => Promise<string>): Promise<DbKeyResult> {
  try {
    return { success: true, dbKey: await call() };
  } catch (error) {
    const failure = (typeof error === "object" && error !== null ? error : {}) as {
      code?: number;
      serverMsg?: string;
      message?: string;
    };
    const code = failure.code ?? -1;
    return {
      success: false,
      errorCode: code,
      errorMsg:
        code === DB_KEY_MISMATCH_CODE
          ? "数据库不匹配！检查数据库是否属于当前帐号"
          : failure.serverMsg || failure.message || "网络或包结构解析失败",
    };
  }
}

// ---------------------------------------------------------------------------
// 0xe07_0 — image OCR
// ---------------------------------------------------------------------------

export interface OcrReqBody {
  imageUrl: string;
  /** Always 0 in `serialize` (dropped). */
  languageType: number;
  /** Always 0 in `serialize` (dropped). */
  scene: number;
  /** All five are strings; `serialize` sends "" for each, so none is emitted. */
  originMd5: string;
  afterCompressMd5: string;
  afterCompressFileSize: string;
  afterCompressWeight: string;
  afterCompressHeight: string;
}

export interface ImageOcrReq {
  /** Constant 1. */
  version: number;
  /** Constant 0 (dropped). */
  client: number;
  /** Constant 1. */
  entrance: number;
  ocrReqBody: OcrReqBody;
}

export function encodeOcrReqBody(body: OcrReqBody): Uint8Array {
  return new ProtoWriter()
    .string(OcrReqBodyField.imageUrl, body.imageUrl)
    .uint32(OcrReqBodyField.languageType, body.languageType)
    .uint32(OcrReqBodyField.scene, body.scene)
    .string(OcrReqBodyField.originMd5, body.originMd5)
    .string(OcrReqBodyField.afterCompressMd5, body.afterCompressMd5)
    .string(OcrReqBodyField.afterCompressFileSize, body.afterCompressFileSize)
    .string(OcrReqBodyField.afterCompressWeight, body.afterCompressWeight)
    .string(OcrReqBodyField.afterCompressHeight, body.afterCompressHeight)
    .finish();
}

export function encodeImageOcrReq(body: ImageOcrReq): Uint8Array {
  return new ProtoWriter()
    .uint32(ImageOcrReqField.version, body.version)
    .uint32(ImageOcrReqField.client, body.client)
    .uint32(ImageOcrReqField.entrance, body.entrance)
    .message(ImageOcrReqField.ocrReqBody, encodeOcrReqBody(body.ocrReqBody))
    .finish();
}

export interface OcrCoordinate {
  /** **Signed** — the decoder narrows with `_val | 0`. */
  x: number;
  y: number;
}

export interface OcrPolygon {
  coordinates: OcrCoordinate[];
}

export interface OcrTextDetection {
  detectedText: string | null;
  confidence: number | null;
  polygon: OcrPolygon | null;
  advancedInfo: string | null;
}

export interface OcrRspBody {
  textDetections: OcrTextDetection[];
  language: string | null;
  requestId: string | null;
}

export interface ImageOcrResp {
  /** int32 on the wire (`_val | 0`). */
  retCode: number | null;
  errMsg: string | null;
  wording: string | null;
  ocrRspBody: OcrRspBody | null;
}

export function decodeOcrCoordinate(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OcrCoordinate {
  const reader = new ProtoReader(data, offset, end);
  const coordinate: OcrCoordinate = { x: 0, y: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OcrCoordinateField.x, WireType.varint):
        coordinate.x = reader.int32();
        break;
      case tagOf(OcrCoordinateField.y, WireType.varint):
        coordinate.y = reader.int32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return coordinate;
}

export function decodeOcrPolygon(data: Uint8Array, offset = 0, end = data.length): OcrPolygon {
  const reader = new ProtoReader(data, offset, end);
  const polygon: OcrPolygon = { coordinates: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(OcrPolygonField.coordinates, WireType.lengthDelimited)) {
      polygon.coordinates.push(reader.message(decodeOcrCoordinate));
    } else {
      reader.skip(unknown);
    }
  }
  return polygon;
}

export function decodeOcrTextDetection(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OcrTextDetection {
  const reader = new ProtoReader(data, offset, end);
  const detection: OcrTextDetection = {
    detectedText: null,
    confidence: null,
    polygon: null,
    advancedInfo: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OcrTextDetectionField.detectedText, WireType.lengthDelimited):
        detection.detectedText = reader.string();
        break;
      case tagOf(OcrTextDetectionField.confidence, WireType.varint):
        detection.confidence = reader.uint32();
        break;
      case tagOf(OcrTextDetectionField.polygon, WireType.lengthDelimited):
        detection.polygon = reader.message(decodeOcrPolygon);
        break;
      case tagOf(OcrTextDetectionField.advancedInfo, WireType.lengthDelimited):
        detection.advancedInfo = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return detection;
}

export function decodeOcrRspBody(data: Uint8Array, offset = 0, end = data.length): OcrRspBody {
  const reader = new ProtoReader(data, offset, end);
  const body: OcrRspBody = { textDetections: [], language: null, requestId: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OcrRspBodyField.textDetections, WireType.lengthDelimited):
        body.textDetections.push(reader.message(decodeOcrTextDetection));
        break;
      case tagOf(OcrRspBodyField.language, WireType.lengthDelimited):
        body.language = reader.string();
        break;
      case tagOf(OcrRspBodyField.requestId, WireType.lengthDelimited):
        body.requestId = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return body;
}

export function decodeImageOcrResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): ImageOcrResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: ImageOcrResp = { retCode: null, errMsg: null, wording: null, ocrRspBody: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(ImageOcrRespField.retCode, WireType.varint):
        resp.retCode = reader.int32();
        break;
      case tagOf(ImageOcrRespField.errMsg, WireType.lengthDelimited):
        resp.errMsg = reader.string();
        break;
      case tagOf(ImageOcrRespField.wording, WireType.lengthDelimited):
        resp.wording = reader.string();
        break;
      case tagOf(ImageOcrRespField.ocrRspBody, WireType.lengthDelimited):
        resp.ocrRspBody = reader.message(decodeOcrRspBody);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export interface OcrTextBlock {
  text: string;
  confidence: number;
  coordinates: { x: number; y: number }[];
}

export interface ImageOcrResult {
  texts: OcrTextBlock[];
  language: string;
}

/**
 * The reference's own retcode check for this command
 * (`ensureRetCodeZero`, reference/index.mjs:82629, called at :316521).
 *
 * Its wording is `failed: code=N msg=...` with `wording` preferred over `errMsg` —
 * one of the two spellings this port has (see MEMORY.md §8: `0x6d6.ts` uses
 * `failed with retcode N: ...`). Kept verbatim so an error string can be compared
 * against the reference's.
 */
export function ensureOcrRetCodeZero(
  operation: string,
  code: number | null,
  msg: string | null,
  wording: string | null,
): void {
  const retCode = Math.trunc(Number(code ?? 0)) || 0;
  if (retCode === 0) return;
  const text =
    (typeof wording === "string" && wording) ||
    (typeof msg === "string" && msg) ||
    "unknown error";
  throw new Error(`${operation} failed: code=${retCode} msg=${text}`);
}

/** Project the decoded body to the reference's `{texts, language}` result (:316520). */
export function toImageOcrResult(resp: ImageOcrResp): ImageOcrResult {
  ensureOcrRetCodeZero("image ocr", resp.retCode, resp.errMsg, resp.wording);
  const rsp = resp.ocrRspBody;
  return {
    texts: (rsp?.textDetections ?? []).map((d) => ({
      text: d.detectedText ?? "",
      confidence: d.confidence ?? 0,
      coordinates: (d.polygon?.coordinates ?? []).map((c) => ({ x: c.x ?? 0, y: c.y ?? 0 })),
    })),
    language: rsp?.language ?? "",
  };
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export interface SendGroupSignParams {
  groupId: number | bigint;
  /** The signer's own uin; the reference reads it from `ctx.identity.uin`. */
  selfUin: number | bigint | string;
}

export const SendGroupSign: OidbSpec<SendGroupSignParams, Oidb0xeb7Req, OidbEmpty, void> = {
  command: SEND_GROUP_SIGN_COMMAND,
  subCommand: SEND_GROUP_SIGN_SUB_COMMAND,
  // ⚠️ The ONLY wire-name override in the port: uppercase EB7, not 0xeb7.
  wireName: () => SEND_GROUP_SIGN_WIRE_NAME,
  serialize: (params) => ({
    signInInfo: {
      // Strings, not numbers — see the field table.
      uin: String(params.selfUin),
      groupId: String(params.groupId),
      version: GROUP_SIGN_CLIENT_VERSION,
    },
  }),
  encodeBody: encodeOidb0xeb7Req,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

export interface TranslateEnToZhParams {
  words: string[];
}

export const TranslateEnToZh: OidbSpec<
  TranslateEnToZhParams,
  Oidb0x990Req,
  Oidb0x990Resp,
  string[]
> = {
  command: TRANSLATE_COMMAND,
  subCommand: TRANSLATE_SUB_COMMAND,
  serialize: (params) => ({
    translateReq: { srcLang: "en", dstLang: "zh", words: params.words },
    tag10: 1,
    tag12: 1,
  }),
  encodeBody: encodeOidb0x990Req,
  decodeBody: decodeOidb0x990Resp,
  deserialize: toTranslatedWords,
};

export interface RequestDbKeyParams {
  db_salt: string;
  sessionData?: Uint8Array | undefined;
}

export const RequestDbKey: OidbSpec<
  RequestDbKeyParams,
  Oidb0xcdeReq,
  Oidb0xcdeResp,
  string
> = {
  command: REQUEST_DB_KEY_COMMAND,
  subCommand: REQUEST_DB_KEY_SUB_COMMAND,
  serialize: (params) => {
    const req: Oidb0xcdeReq = { info: { db_salt: params.db_salt } };
    // Optional and dropped when absent — `if (p.sessionData)`, not `?? empty`.
    if (params.sessionData) req.sessionData = params.sessionData;
    return req;
  },
  encodeBody: encodeOidb0xcdeReq,
  decodeBody: decodeOidb0xcdeResp,
  deserialize: toDbKey,
};

export interface ImageOcrParams {
  imageUrl: string;
}

export const ImageOcr: OidbSpec<ImageOcrParams, ImageOcrReq, ImageOcrResp, ImageOcrResult> = {
  command: IMAGE_OCR_COMMAND,
  subCommand: IMAGE_OCR_SUB_COMMAND,
  serialize: (params) => ({
    version: 1,
    client: 0,
    entrance: 1,
    ocrReqBody: {
      imageUrl: params.imageUrl,
      languageType: 0,
      scene: 0,
      // All five are sent as "" and dropped; they are in the type because the
      // server's schema has them and a caller may one day fill them in.
      originMd5: "",
      afterCompressMd5: "",
      afterCompressFileSize: "",
      afterCompressWeight: "",
      afterCompressHeight: "",
    },
  }),
  encodeBody: encodeImageOcrReq,
  decodeBody: decodeImageOcrResp,
  deserialize: toImageOcrResult,
};

/** Re-exported so a test can assert the `OidbError` code path without the barrel. */
export { OidbError };