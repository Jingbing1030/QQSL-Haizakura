// OidbSvcTrpcTcp.0xfe1_2 — the stranger / profile cluster.
//
// ---------------------------------------------------------------------------
// This is the command the batch brief was reaching for
// ---------------------------------------------------------------------------
// The brief named 0x1253 / 0x1255 / 0x126b / 0x126e as "stranger, contact and
// profile-card lookups".  All four turned out to be something else (group mute,
// friend category, delete friend, group PTT url — each documented in its own
// file), and 0x12b7 / 0x12b8 do not exist at all.  The actual stranger/profile
// family is **0xfe1** at command 4065 with sub-command 2, and it carries *three*
// separate specs that share that one command number:
//
//   GetStrangerStatus       reference/index.mjs:64364  ->  get_stranger_info,
//                                                            nc_get_user_status
//   FetchUserProfile        reference/index.mjs:66138  ->  get_stranger_info,
//                                                            get_group_member_info
//   FetchUserProfileByUid   reference/index.mjs:67815  ->  get_stranger_info,
//                                                            get_group_member_info
//
// They differ in the *request* body and never in the command number, so the
// wire name is `OidbSvcTrpcTcp.0xfe1_2` for all three.  That is why they are in
// one file: the file is organised by command, and a reader looking for 0xfe1 must
// find all three codecs together or the numbering tables look contradictory.
//
// ⚠️ `FetchUserProfile` sets `uinForm: true` and `FetchUserProfileByUid` does
// **not** (reference/index.mjs:66140 vs 67815-67817: only two assignments, no
// `uinForm`).  Both use sub-command 2.  So the same wire name is sent with
// `reserved: 1` in one case and `reserved` absent in the other.  Collapsing them
// into one spec would send the wrong mode bit for half the callers.
//
// ---------------------------------------------------------------------------
// Field numbers — requests
// ---------------------------------------------------------------------------
//   OidbStrangerStatusReq   reference/index.mjs:63628 / 63647 (write)
//     1 uin  uint32
//     3 key  repeated -> OidbStrangerStatusKey
//   OidbStrangerStatusKey   reference/index.mjs:63701 / 63711
//     1 key uint32
//   -> `GetStrangerStatus.serialize` always sends exactly one key, the constant
//      27372 (reference/index.mjs:64362 `STATUS_PROPERTY_KEY`).
//
//   OidbUserInfoRequest (by uin)   reference/index.mjs:65999 / 66018
//     1 uin  uint32
//     3 keys repeated -> OidbUserInfoKey
//   OidbUserInfoByUidRequest       reference/index.mjs:66931 / 66951
//     1 uid  string          <-- same field number, different type
//     3 keys repeated
//   OidbUserInfoKey                reference/index.mjs:64866 / 64876
//     1 key uint32
//
// ⚠️ Field 1 is a **uint32 uin** in one request and a **string uid** in the other.
// They are the same field number in the same command with the same wire *name*,
// so nothing at the transport layer distinguishes them — only which spec built the
// body.  Decoding a response whose field 1 is a uid as a varint is impossible, but
// encode-side a mistaken `uint32(uin)` where a uid belongs produces a body the
// server silently ignores (it sees a uid it cannot parse as an account).
//
// ---------------------------------------------------------------------------
// Field numbers — responses (shared by all three specs)
// ---------------------------------------------------------------------------
//   OidbUserInfoResponse / OidbStrangerStatusResp share the same outer shape:
//     OidbStrangerStatusResp      reference/index.mjs:63950
//       1 data -> OidbStrangerStatusRespData
//     OidbStrangerStatusRespData  reference/index.mjs:64035
//       1 targetUin uint32, 2 properties -> ..., 3 uin uint32
//     OidbStrangerStatusRespProperties reference/index.mjs:64162
//       1 entries repeated -> OidbStrangerStatusRespProperty
//     OidbStrangerStatusRespProperty    reference/index.mjs:64247
//       1 key uint32, 2 value uint64
//
//     OidbUserInfoResponse        reference/index.mjs:65115
//       1 body -> OidbUserInfoResponseBody
//     OidbUserInfoResponseBody    reference/index.mjs:65200
//       1 uid string, 2 properties -> ..., 3 uin uint32
//     OidbUserInfoProperty        reference/index.mjs:65329
//       1 numberProperties repeated -> OidbTwoNumber, 2 bytesProperties repeated -> OidbByteProperty
//     OidbTwoNumber               reference/index.mjs:65438
//       1 number1 uint32, 2 number2 uint32
//     OidbByteProperty            reference/index.mjs:65543
//       1 code uint32, 2 value bytes
//     OidbCustomStatus            reference/index.mjs:65650
//       1 faceId uint32, 2 msg string
//     AvatarInfo                  reference/index.mjs:64781
//       5 url string
//
// ⚠️ `OidbStrangerStatusRespProperty.value` is **uint64**, so it decodes to a
// bigint, while every `OidbTwoNumber` value in the profile response is uint32.
// The status word is packed into that 64-bit value (see `unpackStatusWord`) and a
// 32-bit read would truncate the `ext_status` half to zero.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 4065 = 0xfe1.  All three specs below share it. */
export const USER_INFO_COMMAND = 0xfe1;

export const USER_INFO_SUB_COMMAND = 2;

// ---------------------------------------------------------------------------
// Field tables
// ---------------------------------------------------------------------------

export const StrangerStatusReqField = { uin: 1, key: 3 } as const;
export const StrangerStatusKeyField = { key: 1 } as const;
export const StrangerStatusRespField = { data: 1 } as const;
export const StrangerStatusRespDataField = { targetUin: 1, properties: 2, uin: 3 } as const;
export const StrangerStatusRespPropertiesField = { entries: 1 } as const;
export const StrangerStatusRespPropertyField = { key: 1, value: 2 } as const;

export const UserInfoReqField = { uin: 1, keys: 3 } as const;
export const UserInfoByUidReqField = { uid: 1, keys: 3 } as const;
export const UserInfoKeyField = { key: 1 } as const;
export const UserInfoResponseField = { body: 1 } as const;
export const UserInfoResponseBodyField = { uid: 1, properties: 2, uin: 3 } as const;
export const UserInfoPropertyField = { numberProperties: 1, bytesProperties: 2 } as const;
export const TwoNumberField = { number1: 1, number2: 2 } as const;
export const BytePropertyField = { code: 1, value: 2 } as const;
export const CustomStatusField = { faceId: 1, msg: 2 } as const;
export const AvatarInfoField = { url: 5 } as const;

/**
 * The single property key the reference asks for when it wants a status word
 * (reference/index.mjs:64362 `STATUS_PROPERTY_KEY = 27372`).
 */
export const STATUS_PROPERTY_KEY = 27372;

/**
 * The keys `FetchUserProfile` requests, in the reference's own order
 * (reference/index.mjs:66103 `REQUESTED_KEYS$1`, deduplicated with `new Set`).
 *
 * `...PUBLIC_PROFILE_KEYS` expands the fifteen public-profile codes
 * (reference/index.mjs:50827).  The order matters for byte-identity: the
 * reference builds the array literal in this order and only then dedups, so a
 * re-sorted list produces the same *set* but different bytes.
 */
export const REQUESTED_PROFILE_KEYS: readonly number[] = [
  20002, 27394, 20009, 20031, 101, 103, 102, 20020, 20003, 20026, 105, 27372, 27406, 20037,
  41756, 41757, 42241, 40410, 42031,
  // ...PUBLIC_PROFILE_KEYS (reference/index.mjs:50827)
  102, 105, 107, 20003, 20004, 20020, 20009, 20011, 20016, 20021, 20031, 20037, 41756, 41757, 42241,
];

/** `PUBLIC_PROFILE_KEYS` on its own (reference/index.mjs:50827). */
export const PUBLIC_PROFILE_KEYS: readonly number[] = [
  102, 105, 107, 20003, 20004, 20020, 20009, 20011, 20016, 20021, 20031, 20037, 41756, 41757, 42241,
];

/**
 * The deduplicated key list the reference actually puts on the wire.
 *
 * Computed with `new Set` in the same order, so the byte order is the reference's.
 * Both specs use an identical array literal — `REQUESTED_KEYS$1` at
 * reference/index.mjs:66115 for the by-uin spec and `REQUESTED_KEYS` at
 * reference/index.mjs:67790 for the by-uid spec — so one list serves both.  The
 * dedup is not cosmetic: 102, 105, 20003, 20009, 20020, 20031, 20037, 41756 and
 * 41757 each appear twice in the literal (once explicitly, once via
 * `...PUBLIC_PROFILE_KEYS`), and sending them twice would add nine redundant
 * fields to every request.
 */
export const UNIQUE_PROFILE_KEYS: readonly number[] = dedupe(REQUESTED_PROFILE_KEYS);

function dedupe(keys: readonly number[]): number[] {
  return [...new Set(keys)];
}

// ---------------------------------------------------------------------------
// GetStrangerStatus — request
// ---------------------------------------------------------------------------

export interface StrangerStatusReq {
  uin: number;
  key: readonly { key: number }[];
}

export function encodeStrangerStatusReq(body: StrangerStatusReq): Uint8Array {
  const keys = body.key.map((k) => new ProtoWriter().uint32(StrangerStatusKeyField.key, k.key).finish());
  return new ProtoWriter()
    .uint32(StrangerStatusReqField.uin, body.uin)
    .repeatedMessage(StrangerStatusReqField.key, keys)
    .finish();
}

// ---------------------------------------------------------------------------
// GetStrangerStatus — response
// ---------------------------------------------------------------------------

export interface StrangerStatusProperty {
  key: number;
  value: bigint;
}

export interface StrangerStatusProperties {
  entries: StrangerStatusProperty[];
}

export interface StrangerStatusData {
  targetUin: number;
  properties?: StrangerStatusProperties | undefined;
  uin: number;
}

export interface StrangerStatusResp {
  data?: StrangerStatusData | undefined;
}

function decodeStrangerStatusProperty(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): StrangerStatusProperty {
  const reader = new ProtoReader(data, offset, end);
  const p: StrangerStatusProperty = { key: 0, value: 0n };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(StrangerStatusRespPropertyField.key, WireType.varint):
        p.key = reader.uint32();
        break;
      case tagOf(StrangerStatusRespPropertyField.value, WireType.varint):
        p.value = reader.uint64();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return p;
}

function decodeStrangerStatusProperties(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): StrangerStatusProperties {
  const reader = new ProtoReader(data, offset, end);
  const props: StrangerStatusProperties = { entries: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(StrangerStatusRespPropertiesField.entries, WireType.lengthDelimited):
        props.entries.push(reader.message(decodeStrangerStatusProperty));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return props;
}

function decodeStrangerStatusData(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): StrangerStatusData {
  const reader = new ProtoReader(data, offset, end);
  const d: StrangerStatusData = { targetUin: 0, uin: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(StrangerStatusRespDataField.targetUin, WireType.varint):
        d.targetUin = reader.uint32();
        break;
      case tagOf(StrangerStatusRespDataField.properties, WireType.lengthDelimited):
        d.properties = reader.message(decodeStrangerStatusProperties);
        break;
      case tagOf(StrangerStatusRespDataField.uin, WireType.varint):
        d.uin = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return d;
}

export function decodeStrangerStatusResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): StrangerStatusResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: StrangerStatusResp = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(StrangerStatusRespField.data, WireType.lengthDelimited):
        resp.data = reader.message(decodeStrangerStatusData);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// UserInfo — requests (two variants)
// ---------------------------------------------------------------------------

export interface UserInfoReq {
  uin: number;
  keys: readonly { key: number }[];
}

export interface UserInfoByUidReq {
  uid: string;
  keys: readonly { key: number }[];
}

function encodeUserInfoKeys(keys: readonly { key: number }[]): Uint8Array[] {
  return keys.map((k) => new ProtoWriter().uint32(UserInfoKeyField.key, k.key).finish());
}

export function encodeUserInfoReq(body: UserInfoReq): Uint8Array {
  return new ProtoWriter()
    .uint32(UserInfoReqField.uin, body.uin)
    .repeatedMessage(UserInfoReqField.keys, encodeUserInfoKeys(body.keys))
    .finish();
}

export function encodeUserInfoByUidReq(body: UserInfoByUidReq): Uint8Array {
  return new ProtoWriter()
    .string(UserInfoByUidReqField.uid, body.uid)
    .repeatedMessage(UserInfoByUidReqField.keys, encodeUserInfoKeys(body.keys))
    .finish();
}

// ---------------------------------------------------------------------------
// UserInfo — response
// ---------------------------------------------------------------------------

export interface TwoNumber {
  number1: number;
  number2: number;
}

export interface ByteProperty {
  code: number;
  value: Uint8Array;
}

export interface UserInfoProperties {
  numberProperties: TwoNumber[];
  bytesProperties: ByteProperty[];
}

export interface UserInfoResponseBody {
  uid: string;
  properties?: UserInfoProperties | undefined;
  uin: number;
}

export interface UserInfoResponse {
  body?: UserInfoResponseBody | undefined;
}

export interface CustomStatus {
  faceId: number;
  msg: string;
}

function decodeTwoNumber(data: Uint8Array, offset = 0, end = data.length): TwoNumber {
  const reader = new ProtoReader(data, offset, end);
  const n: TwoNumber = { number1: 0, number2: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(TwoNumberField.number1, WireType.varint):
        n.number1 = reader.uint32();
        break;
      case tagOf(TwoNumberField.number2, WireType.varint):
        n.number2 = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return n;
}

function decodeByteProperty(data: Uint8Array, offset = 0, end = data.length): ByteProperty {
  const reader = new ProtoReader(data, offset, end);
  const b: ByteProperty = { code: 0, value: new Uint8Array(0) };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(BytePropertyField.code, WireType.varint):
        b.code = reader.uint32();
        break;
      case tagOf(BytePropertyField.value, WireType.lengthDelimited):
        b.value = reader.bytes();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return b;
}

function decodeUserInfoProperties(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): UserInfoProperties {
  const reader = new ProtoReader(data, offset, end);
  const props: UserInfoProperties = { numberProperties: [], bytesProperties: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(UserInfoPropertyField.numberProperties, WireType.lengthDelimited):
        props.numberProperties.push(reader.message(decodeTwoNumber));
        break;
      case tagOf(UserInfoPropertyField.bytesProperties, WireType.lengthDelimited):
        props.bytesProperties.push(reader.message(decodeByteProperty));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return props;
}

function decodeUserInfoResponseBody(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): UserInfoResponseBody {
  const reader = new ProtoReader(data, offset, end);
  const body: UserInfoResponseBody = { uid: "", uin: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(UserInfoResponseBodyField.uid, WireType.lengthDelimited):
        body.uid = reader.string();
        break;
      case tagOf(UserInfoResponseBodyField.properties, WireType.lengthDelimited):
        body.properties = reader.message(decodeUserInfoProperties);
        break;
      case tagOf(UserInfoResponseBodyField.uin, WireType.varint):
        body.uin = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return body;
}

export function decodeUserInfoResponse(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): UserInfoResponse {
  const reader = new ProtoReader(data, offset, end);
  const resp: UserInfoResponse = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(UserInfoResponseField.body, WireType.lengthDelimited):
        resp.body = reader.message(decodeUserInfoResponseBody);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export function decodeCustomStatus(data: Uint8Array, offset = 0, end = data.length): CustomStatus {
  const reader = new ProtoReader(data, offset, end);
  const s: CustomStatus = { faceId: 0, msg: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(CustomStatusField.faceId, WireType.varint):
        s.faceId = reader.uint32();
        break;
      case tagOf(CustomStatusField.msg, WireType.lengthDelimited):
        s.msg = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return s;
}

/** `AvatarInfo` — field **5** is the url, not field 1 (reference/index.mjs:64781). */
export interface AvatarInfo {
  url: string;
}

export function decodeAvatarInfo(data: Uint8Array, offset = 0, end = data.length): AvatarInfo {
  const reader = new ProtoReader(data, offset, end);
  const a: AvatarInfo = { url: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(AvatarInfoField.url, WireType.lengthDelimited):
        a.url = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return a;
}

// ---------------------------------------------------------------------------
// Status-word unpacking
// ---------------------------------------------------------------------------

export interface UnpackedStatus {
  status: number;
  ext_status: number;
}

/**
 * Unpack the packed status word (reference/index.mjs:64350).
 *
 * Values `<= 10` are a plain status code and mean "multiply by ten, no extended
 * status".  Anything larger packs `ext_status` into the *middle* two bytes while
 * the low byte and the high byte carry something else — the reference's formula
 *
 *     ext_status = (raw & 0xff00) + (raw >> 16 & 0xff)
 *
 * is non-obvious (it *adds* a shifted-down byte to a masked one) and is copied
 * verbatim.  Simplifying it to `raw >> 8` happens to give the same answer only
 * while bit 16..23 is zero.
 */
export function unpackStatusWord(raw: bigint | number): UnpackedStatus {
  const extBig = typeof raw === "bigint" ? raw : BigInt(raw);
  if (extBig <= 10n) return { status: Number(extBig) * 10, ext_status: 0 };
  return {
    status: 10,
    ext_status: Number((extBig & 65280n) + ((extBig >> 16n) & 255n)),
  };
}

/**
 * `GetStrangerStatus.deserialize` (reference/index.mjs:64371).
 *
 * Returns null — not zeros — when the status property is absent, because "the
 * server said nothing about status" must not be reported as "offline".
 */
export function toStrangerStatus(resp: StrangerStatusResp): UnpackedStatus | null {
  const raw = resp.data?.properties?.entries.find((e) => e.key === STATUS_PROPERTY_KEY)?.value;
  if (raw === undefined || raw === null) return null;
  return unpackStatusWord(raw);
}

// ---------------------------------------------------------------------------
// The profile projection
// ---------------------------------------------------------------------------

export interface Membership {
  vipFlag?: boolean | undefined;
  yearVipFlag?: boolean | undefined;
  svipFlag?: boolean | undefined;
  vipLevel?: number | undefined;
}

/**
 * Membership flags, from the two packed number properties
 * (reference/index.mjs:50900 `decodeMembership`).
 *
 * ⚠️ The `vipLevel` branch is a three-way fallback whose *third* arm
 * (`flags !== undefined && numbers.has(42241)`) yields 0 explicitly, while the
 * second arm yields 1.  Collapsing the two would report level 1 for accounts the
 * server marks as level 0.
 */
export function decodeMembership(numbers: ReadonlyMap<number, number>): Membership {
  const result: Membership = {};
  const flags = numbers.get(41756);
  if (flags !== undefined) {
    result.vipFlag = (flags & 1) !== 0;
    result.yearVipFlag = (flags & 2) !== 0;
    result.svipFlag = (flags & 256) !== 0;
  }
  const level = numbers.get(41757);
  if (level !== undefined) {
    const mask = level & 4095;
    if (mask !== 0) result.vipLevel = 33 - Math.clz32(mask);
    else if (result.vipFlag || result.yearVipFlag || result.svipFlag || numbers.get(42241) === 1) {
      result.vipLevel = 1;
    } else if (flags !== undefined && numbers.has(42241)) result.vipLevel = 0;
  }
  return result;
}

export interface PublicProfile {
  sign?: string | undefined;
  email?: string | undefined;
  phoneNum?: string | undefined;
  country?: string | undefined;
  province?: string | undefined;
  city?: string | undefined;
  college?: string | undefined;
  age?: number | undefined;
  level?: number | undefined;
  sex?: string | undefined;
  birthdayYear?: number | undefined;
  birthdayMonth?: number | undefined;
  birthdayDay?: number | undefined;
  vipFlag?: boolean | undefined;
  yearVipFlag?: boolean | undefined;
  svipFlag?: boolean | undefined;
  vipLevel?: number | undefined;
  privilegeIcons?: PrivilegeIcons | undefined;
}

export interface PrivilegeEntry {
  type?: number | undefined;
  level?: number | undefined;
  flag?: number | undefined;
  isBig?: number | undefined;
  jumpUrl?: string | undefined;
  iconUrl?: string | undefined;
  deluxeIconUrl?: string | undefined;
}

/**
 * Decode a privilege URL field.
 *
 * The wire type is bytes, but the *content* is an ASCII URL, and the reference's
 * `text$1` helper applies a fatal UTF-8 decoder to it (reference/index.mjs:50838)
 * — so a corrupt URL throws rather than becoming replacement characters.  Only
 * the *decoded* entry (PrivilegeEntry) is a string; the wire message keeps bytes.
 */
function privilegeText(value: Uint8Array, code: number): string {
  try {
    return text(value);
  } catch (cause) {
    throw new Error(`invalid UTF-8 in profile property ${code}`, { cause });
  }
}

export interface PrivilegeIcons {
  jumpUrl?: string | undefined;
  open: PrivilegeEntry[];
  closed: PrivilegeEntry[];
}

export const ProfilePrivilegesField = { lists: 3 } as const;
export const ProfilePrivilegeListsField = { jumpUrl: 2, open: 3, closed: 4 } as const;
export const ProfilePrivilegeField = {
  type: 1,
  level: 4,
  flag: 5,
  iconUrl: 6,
  deluxeIconUrl: 7,
  jumpUrl: 8,
  isBig: 9,
} as const;

export interface ProfilePrivilege {
  type?: number | undefined;
  level?: number | undefined;
  flag?: number | undefined;
  /** Raw bytes on the wire (reference/index.mjs:50700 `data.slice(...)`), not a string. */
  iconUrl?: Uint8Array | undefined;
  deluxeIconUrl?: Uint8Array | undefined;
  jumpUrl?: Uint8Array | undefined;
  isBig?: number | undefined;
}

export interface ProfilePrivilegeLists {
  jumpUrl?: Uint8Array | undefined;
  open: ProfilePrivilege[];
  closed: ProfilePrivilege[];
}

export interface ProfilePrivileges {
  lists?: ProfilePrivilegeLists | undefined;
}

function decodeProfilePrivilege(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): ProfilePrivilege {
  const reader = new ProtoReader(data, offset, end);
  const p: ProfilePrivilege = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      // int32, not uint32: the generated decoder ends with `_val | 0`
      // (reference/index.mjs:50659), so a negative flag keeps its sign.
      case tagOf(ProfilePrivilegeField.type, WireType.varint):
        p.type = reader.int32();
        break;
      case tagOf(ProfilePrivilegeField.level, WireType.varint):
        p.level = reader.int32();
        break;
      case tagOf(ProfilePrivilegeField.flag, WireType.varint):
        p.flag = reader.int32();
        break;
      case tagOf(ProfilePrivilegeField.iconUrl, WireType.lengthDelimited):
        p.iconUrl = reader.bytes();
        break;
      case tagOf(ProfilePrivilegeField.deluxeIconUrl, WireType.lengthDelimited):
        p.deluxeIconUrl = reader.bytes();
        break;
      case tagOf(ProfilePrivilegeField.jumpUrl, WireType.lengthDelimited):
        p.jumpUrl = reader.bytes();
        break;
      case tagOf(ProfilePrivilegeField.isBig, WireType.varint):
        p.isBig = reader.int32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return p;
}

function decodeProfilePrivilegeLists(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): ProfilePrivilegeLists {
  const reader = new ProtoReader(data, offset, end);
  const lists: ProfilePrivilegeLists = { open: [], closed: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(ProfilePrivilegeListsField.jumpUrl, WireType.lengthDelimited):
        lists.jumpUrl = reader.bytes();
        break;
      case tagOf(ProfilePrivilegeListsField.open, WireType.lengthDelimited):
        lists.open.push(reader.message(decodeProfilePrivilege));
        break;
      case tagOf(ProfilePrivilegeListsField.closed, WireType.lengthDelimited):
        lists.closed.push(reader.message(decodeProfilePrivilege));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return lists;
}

export function decodeProfilePrivileges(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): ProfilePrivileges {
  const reader = new ProtoReader(data, offset, end);
  const p: ProfilePrivileges = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(ProfilePrivilegesField.lists, WireType.lengthDelimited):
        p.lists = reader.message(decodeProfilePrivilegeLists);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return p;
}

function text(value: Uint8Array): string {
  // The reference uses a *fatal* decoder here and throws on invalid UTF-8
  // (reference/index.mjs:50838).  A lenient decode would turn a corrupt profile
  // field into replacement characters and pass silently.
  return new TextDecoder("utf-8", { fatal: true }).decode(value);
}

/**
 * Birthday (bytes property 20031): year as big-endian uint16, then month, then day
 * (reference/index.mjs:50945 and 66078).
 *
 * `month === 0 && day === 0` means "not set" and yields `{}` — the keys are
 * *absent*, not zero.  A year of 0 means "not disclosed": the year key is omitted
 * while month/day stay.  Both matter for `get_stranger_info`, which must not
 * report a birthday that the user hid.
 */
export function decodeBirthday(raw: Uint8Array): Partial<PublicProfile> {
  if (raw.length !== 4) throw new Error("invalid birthday length in profile property 20031");
  const year = (raw[0]! << 8) | raw[1]!;
  const month = raw[2]!;
  const day = raw[3]!;
  if (month === 0 && day === 0) return {};
  const date = new Date(0);
  date.setUTCFullYear(year || 2000, month - 1, day);
  if (year > 9999 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("invalid date in profile property 20031");
  }
  return {
    ...(year > 0 ? { birthdayYear: year } : {}),
    birthdayMonth: month,
    birthdayDay: day,
  };
}

/**
 * `decodePublicProfile` (reference/index.mjs:50907).
 *
 * The two byte/text tables are separate on purpose: the same *code* space holds
 * text codes and number codes, and a code looked up in the wrong map yields
 * nothing rather than an error, so a single merged map would silently drop fields.
 */
export function decodePublicProfile(
  bytes: ReadonlyMap<number, Uint8Array>,
  numbers: ReadonlyMap<number, number>,
): PublicProfile {
  const result: PublicProfile = {};
  for (const [code, field] of [
    [102, "sign"],
    [20011, "email"],
    [20016, "phoneNum"],
    [20003, "country"],
    [20004, "province"],
    [20020, "city"],
    [20021, "college"],
  ] as const) {
    const value = bytes.get(code);
    if (value !== undefined) result[field] = text(value);
  }
  for (const [code, field] of [
    [20037, "age"],
    [105, "level"],
  ] as const) {
    const value = numbers.get(code);
    if (value !== undefined && Number.isInteger(value) && value >= 0) result[field] = value;
  }
  const sex = numbers.get(20009);
  if (sex !== undefined) result.sex = sex === 1 ? "male" : sex === 2 ? "female" : "unknown";
  const birthday = bytes.get(20031);
  if (birthday !== undefined && birthday.length > 0) {
    // The reference catches a bad birthday and logs a warning rather than failing
    // the whole profile (reference/index.mjs:50936) — a corrupt optional field
    // must not cost the caller the nickname.
    try {
      Object.assign(result, decodeBirthday(birthday));
    } catch {
      /* birthday unavailable */
    }
  }
  Object.assign(result, decodeMembership(numbers));
  const icons = bytes.get(107);
  if (icons !== undefined) {
    const decoded = decodeProfilePrivileges(icons);
    if (decoded.lists) {
      result.privilegeIcons = {
        ...(decoded.lists.jumpUrl !== undefined
          ? { jumpUrl: privilegeText(decoded.lists.jumpUrl, 107) }
          : {}),
        open: decoded.lists.open.map(privilegeEntry),
        closed: decoded.lists.closed.map(privilegeEntry),
      };
    }
  }
  return result;
}

function privilegeEntry(entry: ProfilePrivilege): PrivilegeEntry {
  return {
    ...(entry.type !== undefined ? { type: entry.type } : {}),
    ...(entry.level !== undefined ? { level: entry.level } : {}),
    ...(entry.flag !== undefined ? { flag: entry.flag } : {}),
    ...(entry.isBig !== undefined ? { isBig: entry.isBig } : {}),
    ...(entry.jumpUrl !== undefined ? { jumpUrl: privilegeText(entry.jumpUrl, 107) } : {}),
    ...(entry.iconUrl !== undefined ? { iconUrl: privilegeText(entry.iconUrl, 107) } : {}),
    ...(entry.deluxeIconUrl !== undefined
      ? { deluxeIconUrl: privilegeText(entry.deluxeIconUrl, 107) }
      : {}),
  };
}

/** The full profile record `FetchUserProfile(.ByUid)` produces. */
export interface UserProfile {
  uin: number;
  uid: string;
  nickname: string;
  remark: string;
  qid: string;
  sex: string;
  age: number;
  sign: string;
  avatar: string;
  level: number;
  qidianMasterFlag: number;
  qidianCrewFlag: number;
  qidianCrewFlag2: number;
  status?: number | undefined;
  extStatus?: number | undefined;
  batteryStatus?: number | undefined;
  customStatus?: { faceId: number; wording: string } | undefined;
  customStatusDesc?: string | undefined;
  regTime?: number | undefined;
  vipFlag?: boolean | undefined;
  yearVipFlag?: boolean | undefined;
  svipFlag?: boolean | undefined;
  vipLevel?: number | undefined;
  birthdayYear?: number | undefined;
  birthdayMonth?: number | undefined;
  birthdayDay?: number | undefined;
  profile?: PublicProfile | undefined;
}

/**
 * Build the profile record from a decoded body
 * (reference/index.mjs:66145 `deserializeWithFallback`, and its by-uid twin at
 * 67817 which is the same body minus the uin cross-check).
 *
 * `requestedUin` > 0 enables the reference's mismatch guard: a response whose
 * body carries a *different* uin is an error, not a profile for the wrong person.
 * The by-uid spec passes 0 because it has no uin to check.
 */
export function toUserProfile(body: UserInfoResponse, requestedUin = 0): UserProfile {
  if (!body.body) throw new Error("user info response body missing");
  if (requestedUin > 0 && body.body.uin !== undefined && body.body.uin !== requestedUin) {
    throw new Error("profile response does not match the requested account");
  }
  const info: UserProfile = {
    uin: body.body.uin ?? requestedUin,
    uid: body.body.uid ?? "",
    nickname: "",
    remark: "",
    qid: "",
    sex: "unknown",
    age: 0,
    sign: "",
    avatar: "",
    level: 0,
    qidianMasterFlag: 0,
    qidianCrewFlag: 0,
    qidianCrewFlag2: 0,
  };
  const properties = body.body.properties;
  if (!properties) return info;

  const bytesMap = new Map<number, Uint8Array>();
  const numMap = new Map<number, number>();
  for (const bp of properties.bytesProperties) bytesMap.set(bp.code, bp.value);
  for (const np of properties.numberProperties) numMap.set(np.number1, np.number2);

  const getString = (code: number): string => {
    const b = bytesMap.get(code);
    return b && b.length > 0 ? new TextDecoder("utf-8").decode(b) : "";
  };

  info.nickname = getString(20002);
  info.remark = getString(103);
  info.qid = getString(27394);
  info.sign = getString(102);

  const avatarBytes = bytesMap.get(101);
  if (avatarBytes) {
    const av = decodeAvatarInfo(avatarBytes);
    if (av.url) info.avatar = av.url + "640";
  }

  const sexNum = numMap.get(20009) ?? 0;
  info.sex = sexNum === 1 ? "male" : sexNum === 2 ? "female" : "unknown";
  info.age = numMap.get(20037) ?? 0;
  info.level = numMap.get(105) ?? 0;

  // Online status (reference/index.mjs:66070 `applyOnlineStatus`).
  const statusRaw = numMap.get(27372);
  if (statusRaw !== undefined) {
    const unpacked = unpackStatusWord(statusRaw);
    info.status = unpacked.status;
    info.extStatus = unpacked.ext_status;
    info.batteryStatus = 0;
  }
  const customBytes = bytesMap.get(27406);
  if (customBytes && customBytes.length > 0) {
    const custom = decodeCustomStatus(customBytes);
    info.customStatus = { faceId: custom.faceId, wording: custom.msg };
    info.customStatusDesc = custom.msg;
  }

  // Registration time + membership (reference/index.mjs:66093 `applyProfileDetails`).
  const registered = numMap.get(20026);
  if (registered !== undefined && registered > 0) info.regTime = registered;
  Object.assign(info, decodeMembership(numMap));

  // Birthday (reference/index.mjs:66078 `applyBirthday`): identical decode but
  // *silently skipped* on a bad length/date instead of throwing, unlike the public
  // profile path.  Two functions, two error policies — that asymmetry is the
  // reference's, and it is preserved.
  const raw = bytesMap.get(20031);
  if (raw?.length === 4) {
    const year = (raw[0]! << 8) | raw[1]!;
    const month = raw[2]!;
    const day = raw[3]!;
    const date = new Date(0);
    date.setUTCFullYear(year || 2000, month - 1, day);
    if (date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      if (year > 0) info.birthdayYear = year;
      info.birthdayMonth = month;
      info.birthdayDay = day;
    }
  }

  const profile = decodePublicProfile(bytesMap, numMap);
  if (Object.keys(profile).length > 0) info.profile = profile;
  info.qidianMasterFlag = numMap.get(42031) ?? 0;
  info.qidianCrewFlag = numMap.get(40410) ?? 0;
  return info;
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export interface GetStrangerStatusParams {
  uin: number;
}

export const GetStrangerStatus: OidbSpec<
  GetStrangerStatusParams,
  StrangerStatusReq,
  StrangerStatusResp,
  UnpackedStatus | null
> = {
  command: USER_INFO_COMMAND,
  subCommand: USER_INFO_SUB_COMMAND,
  uinForm: true,
  serialize: (params) => ({ uin: params.uin, key: [{ key: STATUS_PROPERTY_KEY }] }),
  encodeBody: encodeStrangerStatusReq,
  decodeBody: decodeStrangerStatusResp,
  deserialize: (body) => toStrangerStatus(body),
};

export interface FetchUserProfileParams {
  uin: number;
}

export const FetchUserProfile: OidbSpec<
  FetchUserProfileParams,
  UserInfoReq,
  UserInfoResponse,
  UserProfile
> = {
  command: USER_INFO_COMMAND,
  subCommand: USER_INFO_SUB_COMMAND,
  uinForm: true,
  serialize: (params) => ({
    uin: params.uin,
    keys: UNIQUE_PROFILE_KEYS.map((k) => ({ key: k })),
  }),
  encodeBody: encodeUserInfoReq,
  decodeBody: decodeUserInfoResponse,
  // `invoke` closes over the requested uin so the mismatch guard can use it
  // (reference/index.mjs:66198); the spec-level default keeps the reference's
  // `deserialize` behaviour of passing 0.
  deserialize: (body) => toUserProfile(body, 0),
};

/**
 * The params-aware variant `FetchUserProfile.invoke` actually builds
 * (reference/index.mjs:66198-66202: it spreads the spec and overrides
 * `deserialize`).  Provided so callers get the uin cross-check without
 * re-implementing the template.
 */
export function withRequestedUin(
  spec: OidbSpec<FetchUserProfileParams, UserInfoReq, UserInfoResponse, UserProfile>,
  uin: number,
): OidbSpec<FetchUserProfileParams, UserInfoReq, UserInfoResponse, UserProfile> {
  return { ...spec, deserialize: (body) => toUserProfile(body, uin) };
}

export interface FetchUserProfileByUidParams {
  uid: string;
}

export const FetchUserProfileByUid: OidbSpec<
  FetchUserProfileByUidParams,
  UserInfoByUidReq,
  UserInfoResponse,
  UserProfile
> = {
  command: USER_INFO_COMMAND,
  subCommand: USER_INFO_SUB_COMMAND,
  serialize: (params) => ({
    uid: params.uid,
    keys: UNIQUE_PROFILE_KEYS.map((k) => ({ key: k })),
  }),
  encodeBody: encodeUserInfoByUidReq,
  decodeBody: decodeUserInfoResponse,
  deserialize: (body) => toUserProfile(body, 0),
};