// The contacts family — 0x496_0, 0x9060_3, 0x10c0_1|2 (by-uid variant), 0xdc2_34,
// and the constant-only 0x9067_202 rkey request.
//
// ---------------------------------------------------------------------------
// Which command is which
// ---------------------------------------------------------------------------
// All five labels in the brief were right:
//
//   FetchRobotUinRanges     0x496  (1174)   sub 0    uinForm=false
//   GetGroupShareLink       0x9060 (36960)  sub 3    uinForm=true
//   FetchGroupRequestsByUid 0x10c0 (4288)   sub 1|2  uinForm=false
//   SendTuwenArk            0xdc2  (3522)   sub 34   uinForm=false
//   FetchDownloadRkeys      0x9067 (36967)  sub 202  uinForm=true
//
// ⚠️ `FetchGroupRequestsByUid` is the interesting one. Its **sibling** in the same
// region — `FetchGroupRequests`, already ported in `0x10c0.ts` — is the same
// command, the same sub-command pair, the same request message and the same
// response message, but declares **`uinForm = true`** where this one declares
// nothing. So the two specs differ on the wire by exactly the `reserved` field,
// and by nothing else in the request. They are not interchangeable, and the
// reference keeps both because some call sites need the uid-shaped response only.
//
// The response difference is real, though: `FetchGroupRequests.decode` decodes the
// bytes **twice** (by-uin and by-uid) and merges the two lists, while
// `FetchGroupRequestsByUid.decode` decodes **once**, uid-only, and
// `deserialize: (_ctx, body) => body` returns the raw page. That is why this file
// reuses `0x10c0.ts`'s request encoder but must not reuse its spec.
//
// ⚠️ `FetchDownloadRkeys` takes **no parameters at all**. Its `invoke` is
// `(deps) => invokeOidb(deps, FetchDownloadRkeys, {})` — the request is built
// entirely from constants (request id 1, command 202, scene 2/1/0, agent 2, and
// the fixed type list `[10, 20, 2]`). There is no code path that varies it. The
// spec therefore has `serialize: () => ...` ignoring its argument, and the param
// type is an empty object. A caller passing a type list would be silently ignored.
//
// ---------------------------------------------------------------------------
// Field-number surprises
// ---------------------------------------------------------------------------
//   OidbRobotUinRangeRequest   **5 justFetchMsgConfig, 6 type, 7 version,
//                              8 aioKeywordVersion** — fields 1..4 are all unused.
//     Both `version` and `aioKeywordVersion` use the bare `!= null` guard, so an
//     explicit 0 IS written: the golden contains `3800 4000`. Dropping them (the
//     usual zero rule) sends a request the server reads as "unspecified version",
//     which is a different query, not the same one with defaults.
//     On the response side the config is at field **5** (`robotConfig`), matching
//     the request's first used field — the only symmetry in this message.
//
//   OidbGroupShareLinkRequest  1 type(uint64 const 2), **12 group**
//     `type` is a **uint64** (`_f0 !== 0n`), not uint32 — the only uint64 constant
//     in this file. And the sub-message sits at 12 while 2..11 are unused.
//     GroupShareLinkRequest  1 groupCode(uint64), 3 additionalParam, 4 needShortUrl
//       field 2 is unused, and `additionalParam` (a string) uses bare `!= null`, so
//       "" is still emitted (`1a00`). `needShortUrl` is bare `!= null` too, so
//       `false` is emitted (`2000`) — a caller cannot say "default it" by passing
//       false, which is why the reference's own caller defaults it to true.
//     The response is: 12 group -> 1 url. Both `!= null` slots.
//
//   Oidb0xdc2_34Req  1 appInfo, 2 meta
//     Oidb0xdc2AppInfo  1 appId, 2 field2, 3 field3, **5 field5**, **11 targetId**,
//                       **12 content**
//       Fields 4 and 6..10 are unused, and `field3` uses bare `!= null` so the
//       constant 0 IS written (`1800`). `field5` is a one-field sub-message
//       (`{1 field1}` = 1) that exists purely so the server sees a "card" flag.
//     Oidb0xdc2CardContent  **1 flag, then 10..14** title/desc/summary/jumpUrl/
//       previewUrl. The five text fields start at 10, not 2 — and `previewUrl`
//       alone uses bare `!= null`, so an empty preview URL is emitted while an
//       empty title is dropped. Five adjacent fields with two different presence
//       rules is the kind of thing only the writer's tag bytes settle.
//     Oidb0xdc2Meta  1 peerType (bare `!= null` — 0 = C2C IS emitted), 2 targetId
//       So `peerType: 0` means "friend" and is a real value, unlike most zeros.
//     Result: 1 results[] -> {4 errorCode, 5 errorMessage}
//       Note the result's fields start at **4**, and `deserialize` throws
//       `OidbError(errorCode, ...)` per entry when errorCode is nonzero — a
//       per-entry error, not an envelope-level one, so `invokeOidb` cannot see it.
//
// ---------------------------------------------------------------------------
// FetchRobotUinRanges validates its response hard, and every check is observable
// ---------------------------------------------------------------------------
// `deserialize` (reference/index.mjs:62952) runs five separate validations and
// throws a distinct message for each:
//
//   1. config missing            -> "0x496_0 response missing robot range config"
//   2. `version === undefined`   -> "... missing robot range config version"
//      ⚠️ This check can NEVER fire: the decoder initialises the slot to `null`,
//      so an absent version is `null`, not `undefined`. Dead code in the
//      reference. The port keeps the check but documents it rather than silently
//      "fixing" it — a test that expects the message would otherwise fail.
//   3. version not a safe int >=0 -> "... invalid config version: X"
//   4. ranges empty/absent       -> "... has no robot UIN ranges"
//   5. per range: minUin/maxUin via `decodeUin`, then min > max -> "... inverted"
//
// `decodeUin` (:62946) rejects `<= 0` and `> 4294967295` — the uint64 fields are
// narrowed to a *uint32* domain, so a legitimate QQ-robot uin range cannot exceed
// 2^32-1 and a zero uin is an error rather than "absent".

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";
import { OidbError } from "../envelope.js";
import {
  GroupRequestItemField,
  GroupRequestGroupField,
  GroupRequestUserByUidField,
  GroupRequestsRespField,
  encodeGroupRequestList,
  type GroupRequestListReq,
} from "./0x10c0.js";

// ---------------------------------------------------------------------------
// Command numbers
// ---------------------------------------------------------------------------

/** 1174 = 0x496 — robot uin ranges (for the @-mention picker). */
export const ROBOT_UIN_RANGES_COMMAND = 0x496;
export const ROBOT_UIN_RANGES_SUB_COMMAND = 0;

/** 36960 = 0x9060 — group share link. */
export const GROUP_SHARE_LINK_COMMAND = 0x9060;
export const GROUP_SHARE_LINK_SUB_COMMAND = 3;

/** 4288 = 0x10c0 — group join requests. */
export const GROUP_REQUESTS_BY_UID_COMMAND = 0x10c0;
export const GROUP_REQUESTS_BY_UID_SUB_COMMAND = { pending: 1, filtered: 2 } as const;

/** 3522 = 0xdc2 — the 图文 ARK card. */
export const SEND_TUWEN_ARK_COMMAND = 0xdc2;
export const SEND_TUWEN_ARK_SUB_COMMAND = 34;
/** The ARK app id the reference hard-codes (reference/index.mjs:73201). */
export const TUWEN_ARK_APPID = 100446242;

/** 36967 = 0x9067 — rich-media download rkeys. */
export const FETCH_DOWNLOAD_RKEYS_COMMAND = 0x9067;
export const FETCH_DOWNLOAD_RKEYS_SUB_COMMAND = 202;

/**
 * The rkey type list. Three entries, in this order, always.
 *
 * 10 = private image, 20 = group image, 2 = the fallback that older clients use.
 */
export const DOWNLOAD_RKEY_TYPES = [10, 20, 2] as const;

// ---------------------------------------------------------------------------
// 0x496_0 — robot uin ranges
// ---------------------------------------------------------------------------

/**
 * ⚠️ The request's first used field is **5**, not 1: fields 1..4 are unused.
 * The response's `robotConfig` happens to share that number, which is the only
 * reason it is written as a named constant rather than a literal twice.
 */
export const OIDB_ROBOT_CONFIG_FIELD = 5;

export const OidbRobotUinRangeRequestField = {
  justFetchMsgConfig: OIDB_ROBOT_CONFIG_FIELD,
  type: 6,
  version: 7,
  aioKeywordVersion: 8,
} as const;

export interface OidbRobotUinRangeRequest {
  justFetchMsgConfig: number;
  type: number;
  /** Bare `!= null`: an explicit 0 IS written. */
  version: number;
  /** Bare `!= null`: an explicit 0 IS written. */
  aioKeywordVersion: number;
}

export function encodeOidbRobotUinRangeRequest(body: OidbRobotUinRangeRequest): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbRobotUinRangeRequestField.justFetchMsgConfig, body.justFetchMsgConfig)
    .uint32(OidbRobotUinRangeRequestField.type, body.type)
    // Both of these need the `Present` variants: the reference's guard is
    // `_f != null` with no `!== 0`, and the golden carries `3800 4000`.
    .uint32Present(OidbRobotUinRangeRequestField.version, body.version)
    .uint32Present(OidbRobotUinRangeRequestField.aioKeywordVersion, body.aioKeywordVersion)
    .finish();
}

export interface OidbRobotUinRange {
  /** uint64 on the wire; narrowed to a uint32 domain by `decodeUin`. */
  minUin: bigint | null;
  maxUin: bigint | null;
}

export interface OidbRobotUinRangeConfig {
  version: number | null;
  ranges: OidbRobotUinRange[];
}

export interface OidbRobotUinRangeResponse {
  robotConfig: OidbRobotUinRangeConfig | null;
}

export function decodeOidbRobotUinRange(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbRobotUinRange {
  const reader = new ProtoReader(data, offset, end);
  const range: OidbRobotUinRange = { minUin: null, maxUin: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(1, WireType.varint):
        range.minUin = reader.uint64();
        break;
      case tagOf(2, WireType.varint):
        range.maxUin = reader.uint64();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return range;
}

export function decodeOidbRobotUinRangeConfig(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbRobotUinRangeConfig {
  const reader = new ProtoReader(data, offset, end);
  const config: OidbRobotUinRangeConfig = { version: null, ranges: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(1, WireType.varint):
        config.version = reader.uint32();
        break;
      case tagOf(2, WireType.lengthDelimited):
        config.ranges.push(reader.message(decodeOidbRobotUinRange));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return config;
}

export function decodeOidbRobotUinRangeResponse(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbRobotUinRangeResponse {
  const reader = new ProtoReader(data, offset, end);
  const resp: OidbRobotUinRangeResponse = { robotConfig: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(OIDB_ROBOT_CONFIG_FIELD, WireType.lengthDelimited)) {
      resp.robotConfig = reader.message(decodeOidbRobotUinRangeConfig);
    } else {
      reader.skip(unknown);
    }
  }
  return resp;
}

export interface RobotUinRange {
  minUin: number;
  maxUin: number;
}

export interface RobotUinRanges {
  version: number;
  ranges: RobotUinRange[];
}

/** `decodeUin` (reference/index.mjs:62946): uint64 in, but only a uint32 accepted. */
function decodeUin(value: bigint | null, label: string): number {
  const uin = Number(value ?? 0);
  if (!Number.isSafeInteger(uin) || uin <= 0 || uin > 4_294_967_295) {
    throw new Error(`0x496_0 response has invalid ${label}: ${String(value)}`);
  }
  return uin;
}

/**
 * The reference's `FetchRobotUinRanges.deserialize` (reference/index.mjs:62952).
 *
 * ⚠️ Check 2 (`config.version === void 0`) is **unreachable**: the generated
 * decoder starts the slot at `null`, so an absent version is `null` and the
 * `void 0` comparison never matches. The version check that actually fires for a
 * missing version is check 3's `Number(null) === 0`, which is a safe integer >= 0
 * and therefore *passes* — so a response with no version at all yields
 * `version: 0` rather than an error. Reproduced faithfully; a caller that needs
 * "version present" must check `> 0` itself.
 */
export function toRobotUinRanges(resp: OidbRobotUinRangeResponse): RobotUinRanges {
  const config = resp.robotConfig;
  if (!config) throw new Error("0x496_0 response missing robot range config");
  if (config.version === undefined) {
    throw new Error("0x496_0 response missing robot range config version");
  }
  const version = Number(config.version);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error(`0x496_0 response has invalid config version: ${String(config.version)}`);
  }
  if (!config.ranges || config.ranges.length === 0) {
    throw new Error("0x496_0 response has no robot UIN ranges");
  }
  return {
    version,
    ranges: config.ranges.map((range, index) => {
      const minUin = decodeUin(range.minUin, `range[${index}].minUin`);
      const maxUin = decodeUin(range.maxUin, `range[${index}].maxUin`);
      if (minUin > maxUin) {
        throw new Error(`0x496_0 response has inverted range[${index}]: ${minUin}-${maxUin}`);
      }
      return { minUin, maxUin };
    }),
  };
}

// ---------------------------------------------------------------------------
// 0x9060_3 — group share link
// ---------------------------------------------------------------------------

export const OidbGroupShareLinkRequestField = { type: 1, group: 12 } as const;
export const GroupShareLinkRequestField = {
  groupCode: 1,
  additionalParam: 3,
  needShortUrl: 4,
} as const;
export const OidbGroupShareLinkResponseField = { group: 12 } as const;
export const GroupShareLinkResponseField = { url: 1 } as const;

export interface GroupShareLinkRequest {
  groupCode: bigint;
  /** Bare `!= null`: "" IS emitted. */
  additionalParam: string;
  /** Bare `!= null`: `false` IS emitted. */
  needShortUrl: boolean;
}

export interface OidbGroupShareLinkRequest {
  /** **uint64** constant 2, not uint32. */
  type: bigint;
  group: GroupShareLinkRequest;
}

export function encodeGroupShareLinkRequest(body: GroupShareLinkRequest): Uint8Array {
  return new ProtoWriter()
    .uint64(GroupShareLinkRequestField.groupCode, body.groupCode)
    // `stringPresent` / `boolPresent`: both guards are bare `!= null`, so an empty
    // param and a `false` short-url flag are values, not absences.
    .stringPresent(GroupShareLinkRequestField.additionalParam, body.additionalParam)
    // `needShortUrl`'s guard is bare `!= null` and its writer emits `_f2 ? 1 : 0`
    // (reference/index.mjs:71154) — so `false` produces an explicit `2000`, which
    // wire.ts's `.bool` (the `=== true` rule) would drop. `.uint32Present` writes
    // the identical bytes: same varint wire type, value 1 or 0. No wire.ts change
    // needed, and `false` still reaches the server.
    .uint32Present(GroupShareLinkRequestField.needShortUrl, body.needShortUrl ? 1 : 0)
    .finish();
}

export function encodeOidbGroupShareLinkRequest(body: OidbGroupShareLinkRequest): Uint8Array {
  return new ProtoWriter()
    // `.uint64` with a zero check would drop the constant; `uint64Present` keeps
    // it. Here the value is 2, so either works — but `uint64` is what the field is.
    .uint64(OidbGroupShareLinkRequestField.type, body.type)
    .message(OidbGroupShareLinkRequestField.group, encodeGroupShareLinkRequest(body.group))
    .finish();
}

export interface GroupShareLinkResponse {
  url: string | null;
}

export interface OidbGroupShareLinkResponse {
  group: GroupShareLinkResponse | null;
}

export function decodeGroupShareLinkResponse(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupShareLinkResponse {
  const reader = new ProtoReader(data, offset, end);
  const resp: GroupShareLinkResponse = { url: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(GroupShareLinkResponseField.url, WireType.lengthDelimited)) {
      resp.url = reader.string();
    } else {
      reader.skip(unknown);
    }
  }
  return resp;
}

export function decodeOidbGroupShareLinkResponse(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbGroupShareLinkResponse {
  const reader = new ProtoReader(data, offset, end);
  const resp: OidbGroupShareLinkResponse = { group: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(OidbGroupShareLinkResponseField.group, WireType.lengthDelimited)) {
      resp.group = reader.message(decodeGroupShareLinkResponse);
    } else {
      reader.skip(unknown);
    }
  }
  return resp;
}

/** `deserialize` (:71550): a blank URL is an error, not a string. */
export function toGroupShareLink(resp: OidbGroupShareLinkResponse): string {
  const url = resp.group?.url;
  if (!url?.trim()) throw new Error("group share link response did not include a URL");
  return url;
}

// ---------------------------------------------------------------------------
// 0xdc2_34 — 图文 ARK card
// ---------------------------------------------------------------------------

export const Oidb0xdc2_34ReqField = { appInfo: 1, meta: 2 } as const;
export const Oidb0xdc2AppInfoField = {
  appId: 1,
  field2: 2,
  field3: 3,
  field5: 5,
  targetId: 11,
  content: 12,
} as const;
export const Oidb0xdc2CardField5Field = { field1: 1 } as const;
export const Oidb0xdc2CardContentField = {
  flag: 1,
  title: 10,
  desc: 11,
  summary: 12,
  jumpUrl: 13,
  previewUrl: 14,
} as const;
export const Oidb0xdc2MetaField = { peerType: 1, targetId: 2 } as const;
export const Oidb0xdc2_34RespField = { results: 1 } as const;
/** ⚠️ Fields start at **4**, not 1. */
export const Oidb0xdc2CardResultField = { errorCode: 4, errorMessage: 5 } as const;

/** Peer type 0 = C2C friend, 1 = group. */
export const TUWEN_ARK_PEER = { friend: 0, group: 1 } as const;

export interface Oidb0xdc2CardField5 {
  field1: number;
}

export interface Oidb0xdc2CardContent {
  flag: number;
  title: string;
  desc: string;
  summary: string;
  jumpUrl: string;
  /** Bare `!= null`: "" IS emitted, unlike the other four text fields. */
  previewUrl: string;
}

export interface Oidb0xdc2AppInfo {
  appId: number;
  field2: number;
  /** Bare `!= null`: the constant 0 IS written. */
  field3: number;
  field5: Oidb0xdc2CardField5;
  targetId: number;
  content: Oidb0xdc2CardContent;
}

export interface Oidb0xdc2Meta {
  /** Bare `!= null`: `0` (= friend) IS emitted. A real value, not an absence. */
  peerType: number;
  targetId: number;
}

export interface Oidb0xdc2_34Req {
  appInfo: Oidb0xdc2AppInfo;
  meta: Oidb0xdc2Meta;
}

export function encodeOidb0xdc2CardField5(body: Oidb0xdc2CardField5): Uint8Array {
  return new ProtoWriter().uint32(Oidb0xdc2CardField5Field.field1, body.field1).finish();
}

export function encodeOidb0xdc2CardContent(body: Oidb0xdc2CardContent): Uint8Array {
  return new ProtoWriter()
    .uint32(Oidb0xdc2CardContentField.flag, body.flag)
    .string(Oidb0xdc2CardContentField.title, body.title)
    .string(Oidb0xdc2CardContentField.desc, body.desc)
    .string(Oidb0xdc2CardContentField.summary, body.summary)
    .string(Oidb0xdc2CardContentField.jumpUrl, body.jumpUrl)
    // Only this one is bare `!= null`; the four above drop when empty.
    .stringPresent(Oidb0xdc2CardContentField.previewUrl, body.previewUrl)
    .finish();
}

export function encodeOidb0xdc2AppInfo(body: Oidb0xdc2AppInfo): Uint8Array {
  return new ProtoWriter()
    .uint32(Oidb0xdc2AppInfoField.appId, body.appId)
    .uint32(Oidb0xdc2AppInfoField.field2, body.field2)
    // Bare `!= null`: the constant 0 is written (`1800` in the golden).
    .uint32Present(Oidb0xdc2AppInfoField.field3, body.field3)
    .message(Oidb0xdc2AppInfoField.field5, encodeOidb0xdc2CardField5(body.field5))
    .uint32(Oidb0xdc2AppInfoField.targetId, body.targetId)
    .message(Oidb0xdc2AppInfoField.content, encodeOidb0xdc2CardContent(body.content))
    .finish();
}

export function encodeOidb0xdc2Meta(body: Oidb0xdc2Meta): Uint8Array {
  return new ProtoWriter()
    // Bare `!= null`: `peerType: 0` (friend) must reach the wire.
    .uint32Present(Oidb0xdc2MetaField.peerType, body.peerType)
    .uint32(Oidb0xdc2MetaField.targetId, body.targetId)
    .finish();
}

export function encodeOidb0xdc2_34Req(body: Oidb0xdc2_34Req): Uint8Array {
  return new ProtoWriter()
    .message(Oidb0xdc2_34ReqField.appInfo, encodeOidb0xdc2AppInfo(body.appInfo))
    .message(Oidb0xdc2_34ReqField.meta, encodeOidb0xdc2Meta(body.meta))
    .finish();
}

export interface Oidb0xdc2CardResult {
  errorCode: number | null;
  errorMessage: string | null;
}

export interface Oidb0xdc2_34Resp {
  results: Oidb0xdc2CardResult[];
}

export function decodeOidb0xdc2CardResult(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): Oidb0xdc2CardResult {
  const reader = new ProtoReader(data, offset, end);
  const result: Oidb0xdc2CardResult = { errorCode: null, errorMessage: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Oidb0xdc2CardResultField.errorCode, WireType.varint):
        result.errorCode = reader.uint32();
        break;
      case tagOf(Oidb0xdc2CardResultField.errorMessage, WireType.lengthDelimited):
        result.errorMessage = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return result;
}

export function decodeOidb0xdc2_34Resp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): Oidb0xdc2_34Resp {
  const reader = new ProtoReader(data, offset, end);
  const resp: Oidb0xdc2_34Resp = { results: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(Oidb0xdc2_34RespField.results, WireType.lengthDelimited)) {
      resp.results.push(reader.message(decodeOidb0xdc2CardResult));
    } else {
      reader.skip(unknown);
    }
  }
  return resp;
}

/**
 * The reference's `SendTuwenArk.deserialize` (:73228).
 *
 * The per-entry `OidbError` is raised from `deserialize`, i.e. **after**
 * `invokeOidb` has already checked the envelope's own error code — so a nonzero
 * `errorCode` here is a *card-level* failure delivered inside a successful OIDB
 * response, and it surfaces with the same `OidbError` type as a transport failure.
 * A caller cannot tell the two apart by type, only by the fact that this one has
 * `command`/`subCommand` set for 0xdc2_34.
 */
export function assertTuwenArkDelivered(resp: Oidb0xdc2_34Resp): void {
  if (!resp.results?.length) throw new Error("send_tuwen_ark response has no delivery result");
  for (const result of resp.results) {
    if (result.errorCode) {
      throw new OidbError(
        result.errorCode,
        result.errorMessage ?? "",
        SEND_TUWEN_ARK_COMMAND,
        SEND_TUWEN_ARK_SUB_COMMAND,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 0x9067_202 — rich-media download rkeys (constant request)
// ---------------------------------------------------------------------------
//
// ⚠️ **Every field number in this section was wrong on first reading, and the
// extractor said so only when I dumped the region's own `$4`-suffixed copies.**
// The bare names resolve to `contacts/get-private-file-url.ts`'s copies, which
// use a *different* schema for the same message names. The `$4` copies in
// `contacts/fetch-download-rkeys.ts` are the ones this command uses:
//
//   NTV2RichMediaReq$4     1 reqHead, 3 download, **4 downloadRkey**
//     (not 2 — field 2 does not exist in this copy)
//   NTV2ReqHead$4          1 common, 2 scene, 3 client
//   NTV2CommonHead$4       1 requestId, 2 command
//   NTV2SceneInfo$4      **101 requestType, 102 businessType, 200 sceneType,
//                          201 c2c, 202 group**  — hundred-based, NOT 1/2/3
//   NTV2ClientMeta$4       1 agentType
//   NTV2DownloadRKeyReq$4  1 types (repeated uint32, non-packed)
//
//   NTV2RichMediaResp$4    1 respHead, 3 download, **4 downloadRkey**
//   NTV2RespHead$4         1 common, 2 retCode, 3 message
//   NTV2DownloadRKeyResp$4 **1 rkeys**  (not 5)
//   NTV2RKeyInfo$4         1 rkey, **2 rkeyTtlSec uint64**, 3 storeId,
//                          **4 rkeyCreateTime uint32**, 5 type
//
// The hundred-based `SceneInfo` numbering is the trap that matters most: it is the
// *same message name* as `0x126e.ts`'s `SceneInfo` and the *same* numbers there
// (that file already encodes 101/102/200/201/202), but a naive read of
// `NTV2SceneInfo` by bare name gets a 1/2/3 copy from another region and produces a
// request whose scene block the server cannot read at all.
//
// ⚠️ `sceneType` = 0 and it is **dropped**: this copy's guard is
// `!= null && !== 0`, so the golden has `a80602 b00601` and nothing at 200.
// (`0x126e.ts`'s own `SceneInfo` also drops it.)
//
// ⚠️ `types` is repeated **uint32, non-packed** — three separate `08` tags
// (`080a08140802`), not one packed run. A packed encoder yields a request with an
// empty type list and a response with no rkeys.
//
// ⚠️ `deserialize` returns **the whole response body**, not the rkey list
// (reference/index.mjs:50326). Its only job is to raise on a nonzero
// `respHead.retCode` — a *media-level* code inside a successful OIDB envelope —
// and then hand back `body`. So `FetchDownloadRkeys`'s result is the NTV2 response
// shape, and callers read `.downloadRkey` themselves.

export const NTV2RichMediaReqField = { reqHead: 1, download: 3, downloadRkey: 4 } as const;
export const NTV2ReqHeadField = { common: 1, scene: 2, client: 3 } as const;
export const NTV2CommonHeadField = { requestId: 1, command: 2 } as const;
/** ⚠️ Hundred-based. Identical to `0x126e.ts`'s `SceneInfoField` by coincidence of schema. */
export const NTV2SceneInfoField = {
  requestType: 101,
  businessType: 102,
  sceneType: 200,
  c2c: 201,
  group: 202,
} as const;
export const NTV2ClientMetaField = { agentType: 1 } as const;
export const NTV2DownloadRKeyReqField = { types: 1 } as const;
export const NTV2RichMediaRespField = { respHead: 1, download: 3, downloadRkey: 4 } as const;
export const NTV2RespHeadField = { common: 1, retCode: 2, message: 3 } as const;
/** ⚠️ `rkeys` is field **1**, not 5. */
export const NTV2DownloadRKeyRespField = { rkeys: 1 } as const;
export const NTV2RKeyInfoField = {
  rkey: 1,
  /** uint64 on the wire, though only ever a small TTL. */
  rkeyTtlSec: 2,
  storeId: 3,
  /** uint32 on the wire — the *narrow* twin of a field that looks like a timestamp. */
  rkeyCreateTime: 4,
  type: 5,
} as const;

/** The `command` field inside `NTV2CommonHead` — same value as the sub-command. */
export const RKEY_REQUEST_COMMAND = 202;

export interface NTV2CommonHead {
  requestId: number;
  command: number;
}

export interface NTV2SceneInfo {
  requestType: number;
  businessType: number;
  /** Guard is `!= null && !== 0`, so 0 is dropped. */
  sceneType: number;
}

export interface NTV2ClientMeta {
  agentType: number;
}

export interface NTV2ReqHead {
  common: NTV2CommonHead;
  scene: NTV2SceneInfo;
  client: NTV2ClientMeta;
}

export interface NTV2DownloadRKeyReq {
  /** Repeated **uint32**, non-packed. */
  types: number[];
}

export interface NTV2RichMediaReq {
  reqHead: NTV2ReqHead;
  downloadRkey: NTV2DownloadRKeyReq;
}

/** Build the fixed 0x9067_202 request body. */
export function buildDownloadRkeyRequest(): NTV2RichMediaReq {
  return {
    reqHead: {
      common: { requestId: 1, command: RKEY_REQUEST_COMMAND },
      scene: { requestType: 2, businessType: 1, sceneType: 0 },
      client: { agentType: 2 },
    },
    downloadRkey: { types: [...DOWNLOAD_RKEY_TYPES] },
  };
}

export function encodeNTV2CommonHead(body: NTV2CommonHead): Uint8Array {
  return new ProtoWriter()
    .uint32(NTV2CommonHeadField.requestId, body.requestId)
    .uint32(NTV2CommonHeadField.command, body.command)
    .finish();
}

export function encodeNTV2SceneInfo(body: NTV2SceneInfo): Uint8Array {
  return new ProtoWriter()
    .uint32(NTV2SceneInfoField.requestType, body.requestType)
    .uint32(NTV2SceneInfoField.businessType, body.businessType)
    // `!== 0`, so the constant 0 is dropped — matching the golden's `a80602 b00601`.
    .uint32(NTV2SceneInfoField.sceneType, body.sceneType)
    .finish();
}

export function encodeNTV2ClientMeta(body: NTV2ClientMeta): Uint8Array {
  return new ProtoWriter().uint32(NTV2ClientMetaField.agentType, body.agentType).finish();
}

export function encodeNTV2ReqHead(body: NTV2ReqHead): Uint8Array {
  return new ProtoWriter()
    .message(NTV2ReqHeadField.common, encodeNTV2CommonHead(body.common))
    .message(NTV2ReqHeadField.scene, encodeNTV2SceneInfo(body.scene))
    .message(NTV2ReqHeadField.client, encodeNTV2ClientMeta(body.client))
    .finish();
}

export function encodeNTV2DownloadRKeyReq(body: NTV2DownloadRKeyReq): Uint8Array {
  const writer = new ProtoWriter();
  // Non-packed: one `08` per type. See the note above.
  for (const type of body.types) writer.uint32(NTV2DownloadRKeyReqField.types, type);
  return writer.finish();
}

export function encodeNTV2RichMediaReq(body: NTV2RichMediaReq): Uint8Array {
  return new ProtoWriter()
    .message(NTV2RichMediaReqField.reqHead, encodeNTV2ReqHead(body.reqHead))
    // Field **4** — field 2 is not part of this copy of the message.
    .message(NTV2RichMediaReqField.downloadRkey, encodeNTV2DownloadRKeyReq(body.downloadRkey))
    .finish();
}

export interface NTV2RespHead {
  common: NTV2CommonHead | null;
  retCode: number | null;
  message: string | null;
}

export interface NTV2RKeyInfo {
  rkey: string | null;
  /** uint64 on the wire. */
  rkeyTtlSec: bigint | null;
  storeId: number | null;
  /** uint32 on the wire. */
  rkeyCreateTime: number | null;
  type: number | null;
}

export interface NTV2DownloadRKeyResp {
  rkeys: NTV2RKeyInfo[];
}

export interface NTV2RichMediaResp {
  respHead: NTV2RespHead | null;
  /** Opaque: this command never requests a download block. */
  download: Uint8Array | null;
  downloadRkey: NTV2DownloadRKeyResp | null;
}

export function decodeNTV2RespHead(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): NTV2RespHead {
  const reader = new ProtoReader(data, offset, end);
  const head: NTV2RespHead = { common: null, retCode: null, message: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(NTV2RespHeadField.common, WireType.lengthDelimited):
        head.common = reader.message(decodeNTV2CommonHead);
        break;
      case tagOf(NTV2RespHeadField.retCode, WireType.varint):
        head.retCode = reader.uint32();
        break;
      case tagOf(NTV2RespHeadField.message, WireType.lengthDelimited):
        head.message = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return head;
}

/** The response's `common` head is the same message as the request's. */
export function decodeNTV2CommonHead(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): NTV2CommonHead {
  const reader = new ProtoReader(data, offset, end);
  const head: NTV2CommonHead = { requestId: 0, command: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(NTV2CommonHeadField.requestId, WireType.varint):
        head.requestId = reader.uint32();
        break;
      case tagOf(NTV2CommonHeadField.command, WireType.varint):
        head.command = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return head;
}

export function decodeNTV2RKeyInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): NTV2RKeyInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: NTV2RKeyInfo = {
    rkey: null,
    rkeyTtlSec: null,
    storeId: null,
    rkeyCreateTime: null,
    type: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(NTV2RKeyInfoField.rkey, WireType.lengthDelimited):
        info.rkey = reader.string();
        break;
      case tagOf(NTV2RKeyInfoField.rkeyTtlSec, WireType.varint):
        info.rkeyTtlSec = reader.uint64();
        break;
      case tagOf(NTV2RKeyInfoField.storeId, WireType.varint):
        info.storeId = reader.uint32();
        break;
      case tagOf(NTV2RKeyInfoField.rkeyCreateTime, WireType.varint):
        info.rkeyCreateTime = reader.uint32();
        break;
      case tagOf(NTV2RKeyInfoField.type, WireType.varint):
        info.type = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return info;
}

export function decodeNTV2DownloadRKeyResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): NTV2DownloadRKeyResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: NTV2DownloadRKeyResp = { rkeys: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(NTV2DownloadRKeyRespField.rkeys, WireType.lengthDelimited)) {
      resp.rkeys.push(reader.message(decodeNTV2RKeyInfo));
    } else {
      reader.skip(unknown);
    }
  }
  return resp;
}

export function decodeNTV2RichMediaResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): NTV2RichMediaResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: NTV2RichMediaResp = { respHead: null, download: null, downloadRkey: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(NTV2RichMediaRespField.respHead, WireType.lengthDelimited):
        resp.respHead = reader.message(decodeNTV2RespHead);
        break;
      case tagOf(NTV2RichMediaRespField.download, WireType.lengthDelimited):
        // Decoded as opaque bytes: this command never requests a download block,
        // and `0x126e.ts` already owns the full media-download schema.
        resp.download = reader.bytes();
        break;
      case tagOf(NTV2RichMediaRespField.downloadRkey, WireType.lengthDelimited):
        resp.downloadRkey = reader.message(decodeNTV2DownloadRKeyResp);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

/**
 * `FetchDownloadRkeys.deserialize` (reference/index.mjs:50326).
 *
 * ⚠️ It returns the **whole body**, not the rkey list. The only work it does is
 * the media-level retCode check — `body.respHead?.retCode && !== 0` — which is how
 * NTV2 reports an expired-credential or missing-file condition *inside* a
 * successful OIDB envelope. Skipping it would leave a caller with
 * `downloadRkey: null` and no reason why.
 */
export function assertRkeyRetCode(resp: NTV2RichMediaResp): NTV2RichMediaResp {
  const retCode = resp.respHead?.retCode;
  if (retCode && retCode !== 0) {
    throw new Error(resp.respHead?.message ?? "fetch download rkey failed");
  }
  return resp;
}

/** Convenience projection for callers that only want the keys. */
export function toDownloadRkeys(resp: NTV2RichMediaResp): DownloadRkey[] {
  return (resp.downloadRkey?.rkeys ?? []).map((info) => ({
    rkey: info.rkey ?? "",
    rkeyTtlSec: Number(info.rkeyTtlSec ?? 0n),
    storeId: info.storeId ?? 0,
    rkeyCreateTime: info.rkeyCreateTime ?? 0,
    type: info.type ?? 0,
  }));
}

/** One resolved rkey, after narrowing the two odd widths. */
export interface DownloadRkey {
  rkey: string;
  /** Widened from uint64; only ever a small TTL. */
  rkeyTtlSec: number;
  storeId: number;
  /** Narrowed from the wire's uint32 — NOT a bigint timestamp. */
  rkeyCreateTime: number;
  type: number;
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export const FetchRobotUinRanges: OidbSpec<
  Record<string, never>,
  OidbRobotUinRangeRequest,
  OidbRobotUinRangeResponse,
  RobotUinRanges
> = {
  command: ROBOT_UIN_RANGES_COMMAND,
  subCommand: ROBOT_UIN_RANGES_SUB_COMMAND,
  // No parameters at all — `serialize: () => ({...})` in the reference (:62955).
  serialize: () => ({ justFetchMsgConfig: 1, type: 1, version: 0, aioKeywordVersion: 0 }),
  encodeBody: encodeOidbRobotUinRangeRequest,
  decodeBody: decodeOidbRobotUinRangeResponse,
  deserialize: toRobotUinRanges,
};

export interface GetGroupShareLinkParams {
  groupId: number | bigint;
  needShortUrl: boolean;
  additionalParam: string;
}

export const GetGroupShareLink: OidbSpec<
  GetGroupShareLinkParams,
  OidbGroupShareLinkRequest,
  OidbGroupShareLinkResponse,
  string
> = {
  command: GROUP_SHARE_LINK_COMMAND,
  subCommand: GROUP_SHARE_LINK_SUB_COMMAND,
  uinForm: true,
  serialize: (params) => ({
    type: 2n,
    group: {
      groupCode: BigInt(params.groupId),
      additionalParam: params.additionalParam,
      needShortUrl: params.needShortUrl,
    },
  }),
  encodeBody: encodeOidbGroupShareLinkRequest,
  decodeBody: decodeOidbGroupShareLinkResponse,
  deserialize: toGroupShareLink,
};

export interface FetchGroupRequestsByUidParams {
  /** `false` -> sub-command 1 (pending), `true` -> sub-command 2 (filtered). */
  filtered?: boolean | undefined;
  count?: number | undefined;
  cursor?: bigint | undefined;
}

/** The by-uid user submessage: field 1 is a **string** uid, field 2 a name. */
export interface GroupRequestUser {
  uid: string | null;
  name: string | null;
}

export interface GroupRequestGroup {
  groupUin: number | null;
  groupName: string | null;
}

/**
 * One join request, uid-shaped.
 *
 * ⚠️ Every scalar is `| null`, not `0`/`""`: the generated decoder starts each
 * slot at `null` (`protobuf_decode_...0x10C0ResponseRequest`, `_f0.._f9 = null`,
 * reference/index.mjs:61184). `0x10c0.ts`'s own `GroupRequestItemByUid` defaults
 * them to `0n`/`0`/`""` instead, which erases "absent" — a difference the probe
 * caught as `comment: ""` vs `comment: null` on the very first golden.
 */
export interface GroupRequestItem {
  /** uint64. */
  sequence: bigint | null;
  eventType: number | null;
  state: number | null;
  group: GroupRequestGroup | null;
  target: GroupRequestUser | null;
  invitor: GroupRequestUser | null;
  operatorUser: GroupRequestUser | null;
  field9: string | null;
  comment: string | null;
  operateTransInfo: Uint8Array | null;
}

/** The paging wrapper. All five metadata slots are `null` when absent. */
export interface GroupRequestsPage {
  requests: GroupRequestItem[];
  /** uint64 cursor. */
  field2: bigint | null;
  /** uint64. */
  newLatestSeq: bigint | null;
  field4: number | null;
  /** uint64. */
  field5: bigint | null;
  field6: number | null;
}

export function decodeGroupRequestUser(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupRequestUser {
  const reader = new ProtoReader(data, offset, end);
  const user: GroupRequestUser = { uid: null, name: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupRequestUserByUidField.uid, WireType.lengthDelimited):
        user.uid = reader.string();
        break;
      case tagOf(GroupRequestUserByUidField.name, WireType.lengthDelimited):
        user.name = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return user;
}

export function decodeGroupRequestGroup(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupRequestGroup {
  const reader = new ProtoReader(data, offset, end);
  const group: GroupRequestGroup = { groupUin: null, groupName: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      // `groupUin` is a plain uint32 here (`_f0 = _val`), not a uint64 — the
      // group number fits, and a protocol-level group code would not.
      case tagOf(GroupRequestGroupField.groupUin, WireType.varint):
        group.groupUin = reader.uint32();
        break;
      case tagOf(GroupRequestGroupField.groupName, WireType.lengthDelimited):
        group.groupName = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return group;
}

export function decodeGroupRequestItem(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupRequestItem {
  const reader = new ProtoReader(data, offset, end);
  const item: GroupRequestItem = {
    sequence: null,
    eventType: null,
    state: null,
    group: null,
    target: null,
    invitor: null,
    operatorUser: null,
    field9: null,
    comment: null,
    operateTransInfo: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupRequestItemField.sequence, WireType.varint):
        item.sequence = reader.uint64();
        break;
      case tagOf(GroupRequestItemField.eventType, WireType.varint):
        item.eventType = reader.uint32();
        break;
      case tagOf(GroupRequestItemField.state, WireType.varint):
        item.state = reader.uint32();
        break;
      case tagOf(GroupRequestItemField.group, WireType.lengthDelimited):
        item.group = reader.message(decodeGroupRequestGroup);
        break;
      case tagOf(GroupRequestItemField.target, WireType.lengthDelimited):
        item.target = reader.message(decodeGroupRequestUser);
        break;
      case tagOf(GroupRequestItemField.invitor, WireType.lengthDelimited):
        item.invitor = reader.message(decodeGroupRequestUser);
        break;
      case tagOf(GroupRequestItemField.operatorUser, WireType.lengthDelimited):
        item.operatorUser = reader.message(decodeGroupRequestUser);
        break;
      case tagOf(GroupRequestItemField.field9, WireType.lengthDelimited):
        item.field9 = reader.string();
        break;
      case tagOf(GroupRequestItemField.comment, WireType.lengthDelimited):
        item.comment = reader.string();
        break;
      case tagOf(GroupRequestItemField.operateTransInfo, WireType.lengthDelimited):
        item.operateTransInfo = reader.bytes();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return item;
}

/**
 * The uid-shaped page: `{ 1 requests[], 2 field2, 3 newLatestSeq, 4 field4,
 * 5 field5, 6 field6 }`.
 *
 * A local copy rather than a call into `0x10c0.ts`'s `decodeGroupRequestsByUid`,
 * because that one starts every slot at `0`/`0n` and this spec's `deserialize` is
 * `(_ctx, body) => body` — the page IS the result, so an absent cursor would come
 * back as `0n` instead of `null` and a caller could not tell "no more pages" from
 * "cursor zero". The field *numbers* are imported, so the two cannot drift.
 */
export function decodeGroupRequestsPage(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupRequestsPage {
  const reader = new ProtoReader(data, offset, end);
  const page: GroupRequestsPage = {
    requests: [],
    field2: null,
    newLatestSeq: null,
    field4: null,
    field5: null,
    field6: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupRequestsRespField.requests, WireType.lengthDelimited):
        page.requests.push(reader.message(decodeGroupRequestItem));
        break;
      case tagOf(GroupRequestsRespField.field2, WireType.varint):
        page.field2 = reader.uint64();
        break;
      case tagOf(GroupRequestsRespField.newLatestSeq, WireType.varint):
        page.newLatestSeq = reader.uint64();
        break;
      case tagOf(GroupRequestsRespField.field4, WireType.varint):
        page.field4 = reader.uint32();
        break;
      case tagOf(GroupRequestsRespField.field5, WireType.varint):
        page.field5 = reader.uint64();
        break;
      case tagOf(GroupRequestsRespField.field6, WireType.varint):
        page.field6 = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return page;
}

/**
 * The uid-only twin of `0x10c0.ts`'s `FetchGroupRequests`.
 *
 * ⚠️ Same command, same sub-commands, same request bytes — but **no `uinForm`**
 * where the sibling declares `true`, and a single (uid-only) decode instead of the
 * sibling's double decode plus merge. Sharing the request codec is correct; sharing
 * the spec would not be.
 */
export const FetchGroupRequestsByUid: OidbSpec<
  FetchGroupRequestsByUidParams,
  GroupRequestListReq,
  GroupRequestsPage,
  GroupRequestsPage
> = {
  command: GROUP_REQUESTS_BY_UID_COMMAND,
  resolveSubCommand: (params) =>
    params.filtered === true
      ? GROUP_REQUESTS_BY_UID_SUB_COMMAND.filtered
      : GROUP_REQUESTS_BY_UID_SUB_COMMAND.pending,
  serialize: (params) => ({
    count: params.count ?? 50,
    field2: params.cursor ?? 0n,
  }),
  encodeBody: encodeGroupRequestList,
  // uid-only: the reference's decode is `protobuf_decode_...0x10C0Response`, the
  // uid variant, with no by-uin pass and no merge.
  decodeBody: decodeGroupRequestsPage,
  // `deserialize: (_ctx, body) => body` — the raw page, not `body.requests`.
  deserialize: (body) => body,
};

export interface SendTuwenArkParams {
  /** The group number or the friend's uin. */
  targetId: number;
  /** 0 = friend, 1 = group (`TUWEN_ARK_PEER`). */
  peerType: number;
  title: string;
  desc: string;
  summary: string;
  previewUrl: string;
  jumpUrl: string;
}

export const SendTuwenArk: OidbSpec<SendTuwenArkParams, Oidb0xdc2_34Req, Oidb0xdc2_34Resp, void> = {
  command: SEND_TUWEN_ARK_COMMAND,
  subCommand: SEND_TUWEN_ARK_SUB_COMMAND,
  uinForm: false,
  serialize: (params) => ({
    appInfo: {
      appId: TUWEN_ARK_APPID,
      field2: 1,
      field3: 0,
      field5: { field1: 1 },
      targetId: params.targetId,
      content: {
        flag: 1,
        title: params.title,
        desc: params.desc,
        summary: params.summary,
        jumpUrl: params.jumpUrl,
        previewUrl: params.previewUrl,
      },
    },
    meta: { peerType: params.peerType, targetId: params.targetId },
  }),
  encodeBody: encodeOidb0xdc2_34Req,
  decodeBody: decodeOidb0xdc2_34Resp,
  deserialize: (body) => {
    assertTuwenArkDelivered(body);
    return undefined;
  },
};

/**
 * `FetchDownloadRkeys` takes no parameters — see the header comment.
 *
 * Its result is the whole NTV2 response, because that is what the reference's
 * `deserialize` returns. Use `toDownloadRkeys` to narrow it.
 */
export const FetchDownloadRkeys: OidbSpec<
  Record<string, never>,
  NTV2RichMediaReq,
  NTV2RichMediaResp,
  NTV2RichMediaResp
> = {
  command: FETCH_DOWNLOAD_RKEYS_COMMAND,
  subCommand: FETCH_DOWNLOAD_RKEYS_SUB_COMMAND,
  uinForm: true,
  serialize: () => buildDownloadRkeyRequest(),
  encodeBody: encodeNTV2RichMediaReq,
  decodeBody: decodeNTV2RichMediaResp,
  deserialize: assertRkeyRetCode,
};

// Re-export the shared field tables so a consumer needs one import, not two.
export {
  GroupRequestItemField,
  GroupRequestGroupField,
  GroupRequestUserByUidField,
  GroupRequestsRespField,
};