// OidbSvcTrpcTcp.0xfd4_1 — one page of the friend roster (`get_friend_list`).
//
// ---------------------------------------------------------------------------
// The one command that does two jobs at once
// ---------------------------------------------------------------------------
// ONEBOT-ACTION-SPEC.md lists `get_friend_list` and `set_friends_category` against
// this command.  Only `get_friend_list` is real: the *write* side of friend-分组
// management is 0x1255_0 (see 0x1255.ts).  What 0xfd4_1 does for categories is
// *read* them — `categories[]` (field 102) rides along with the friend page, which
// is why `set_friends_category` can accept a category *name*: the name→id map comes
// from here.  (0x12b7 / 0x12b8, which the batch brief expected to be the 分组
// management commands, do not exist in the reference at all.)
//
// ---------------------------------------------------------------------------
// The request is a constant
// ---------------------------------------------------------------------------
// There are exactly two knobs: the page `cookie`, and the fact that the reference
// asks for the same 300-friend page every time.  Everything else is a literal.
//
// ---------------------------------------------------------------------------
// Field numbers — and the surprise
// ---------------------------------------------------------------------------
//   OidbFriendListRequest        reference/index.mjs:51597 / 51652 (write)
//     2  friendCount   uint32   300
//     4  field4        uint32   0     <- **written even though it is 0**
//     5  cookie        bytes
//     6  field6        uint32   1
//     7  field7        uint32   2147483647
//     10001 body       repeated -> OidbFriendListBodyItem
//     10002 field10002 uint32   repeated   [13578, 13579, 13573, 13572, 13568]
//     10003 field10003 uint32   4051
//   OidbFriendListBodyItem       reference/index.mjs:51865 / 51884
//     1 type   uint32
//     2 number -> OidbFriendListNumber
//   OidbFriendListNumber         reference/index.mjs:51938 / 51948
//     1 numbers uint32 repeated
//
// ⚠️ There is **no field 1 and no field 3** in this request.  `friendCount` starts
// at 2.  The numbering is neither contiguous nor 1-based and it is not a typo —
// the generated writer emits `10 ac 02` for it (field 2, varint, 300), which the
// golden bytes confirm.  Any "helpful" renumbering to 1 would produce a request the
// server reads as empty.
//
// ⚠️ `field4` is asked for with value 0 and is **not** written: its guard is the
// ordinary `_f1 != null && _f1 !== 0` (reference/index.mjs:51681), so the zero
// vanishes.  Reading the constant `field4: 0` in `serialize` as "a field that must
// be sent as zero" would add a spurious `20 00` and two bytes.
//
// ⚠️ Repeated uint32 fields (`numbers`, `field10002`) are written **unpacked** —
// one tag per element (reference/index.mjs:51789 and 51949), not as a single
// length-delimited packed run.  The generated *decoder* accepts both forms
// (reference/index.mjs:59040 handles `case 10` as packed and `case 8` as single),
// which is why an encoder can be wrong here and still decode its own output.
//
// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------
//   OidbSvcTrpcTcp0xFD4_1Response  reference/index.mjs:52187
//     2   cookie    bytes
//     3   isEnd     bool       (`_val !== 0`)
//     6   timestamp uint64
//     7   selfUin   uint64
//     8   smallSeq  uint32
//     101 friends    repeated -> OidbFriend
//     102 categories repeated -> OidbFriendCategory
//   OidbFriend          reference/index.mjs:52394
//     1 uid string, 2 customGroup uint32, 3 uin uint32, 10001 additional repeated
//   OidbFriendAdditional 52543   1 type uint32, 2 layer1 -> ...
//   OidbFriendLayer1     52650   1 numberProperties, 2 properties
//   OidbFriendNumberProperty 52759  1 key uint32, 2 value **int32**
//   OidbFriendProperty   52864  1 code uint32, 2 value bytes
//   OidbFriendCategory   52971  1 categoryId, 2 categoryName string, 3 memberCount, 4 sortId
//
// ⚠️ `OidbFriendNumberProperty.value` is **int32** (`_val | 0` at
// reference/index.mjs:52840).  Every other "number property" in this file family is
// uint32.  Reading it unsigned would turn a negative sentinel into ~4e9 and, e.g.,
// an age of -1 into a plausible-looking 4294967295.
//
// ⚠️ `additional[]` entries with `type !== 1` or with no `layer1` are **skipped**
// (reference/index.mjs:53110).  There are several `type` values in the wild and only
// type 1 carries the display properties; harvesting every entry would let a later,
// different-typed block overwrite the nickname.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";
import {
  decodePublicProfile,
  PUBLIC_PROFILE_KEYS,
  type PublicProfile,
} from "./0xfe1.js";

/** 4052 = 0xfd4. */
export const FRIEND_LIST_COMMAND = 0xfd4;

export const FRIEND_LIST_SUB_COMMAND = 1;

/** Constants from `serialize` (reference/index.mjs:53149-53178). */
export const FRIEND_LIST_PAGE_SIZE = 300;
export const FRIEND_LIST_FIELD6 = 1;
export const FRIEND_LIST_FIELD7 = 2147483647;
export const FRIEND_LIST_FIELD10003 = 4051;
export const FRIEND_LIST_FIELD10002: readonly number[] = [13578, 13579, 13573, 13572, 13568];

export const FriendListRequestField = {
  friendCount: 2,
  field4: 4,
  cookie: 5,
  field6: 6,
  field7: 7,
  body: 10001,
  field10002: 10002,
  field10003: 10003,
} as const;

export const FriendListBodyItemField = { type: 1, number: 2 } as const;
export const FriendListNumberField = { numbers: 1 } as const;

export const FriendListResponseField = {
  cookie: 2,
  isEnd: 3,
  timestamp: 6,
  selfUin: 7,
  smallSeq: 8,
  friends: 101,
  categories: 102,
} as const;

export const FriendField = { uid: 1, customGroup: 2, uin: 3, additional: 10001 } as const;
export const FriendAdditionalField = { type: 1, layer1: 2 } as const;
export const FriendLayer1Field = { numberProperties: 1, properties: 2 } as const;
export const FriendNumberPropertyField = { key: 1, value: 2 } as const;
export const FriendPropertyField = { code: 1, value: 2 } as const;
export const FriendCategoryField = {
  categoryId: 1,
  categoryName: 2,
  memberCount: 3,
  sortId: 4,
} as const;

/**
 * The keys the reference asks for in body item `type: 1`
 * (reference/index.mjs:53155-53161): `new Set([103, 102, 20002, 27394, ...PUBLIC_PROFILE_KEYS])`.
 */
export const FRIEND_DETAIL_KEYS: readonly number[] = [
  ...new Set([103, 102, 20002, 27394, ...PUBLIC_PROFILE_KEYS]),
];

/** Body item `type: 4`'s keys (reference/index.mjs:53165): `[100, 101, 102]`. */
export const FRIEND_BASE_KEYS: readonly number[] = [100, 101, 102];

export interface FriendListBodyItem {
  type: number;
  number: { numbers: readonly number[] };
}

export interface FriendListRequest {
  friendCount: number;
  field4: number;
  cookie?: Uint8Array | undefined;
  field6: number;
  field7: number;
  body: FriendListBodyItem[];
  field10002: readonly number[];
  field10003: number;
}

/**
 * Unpacked repeated uint32: one tag per element
 * (reference/index.mjs:51949 emits `buf[offset++] = 8` inside the loop).
 *
 * `uint32Present` rather than `uint32` because the reference's loop has no
 * per-element zero test — it writes every element it is given, including a 0.
 */
export function encodeRepeatedUint32(fieldNumber: number, values: readonly number[]): ProtoWriter {
  const w = new ProtoWriter();
  for (const value of values) w.uint32Present(fieldNumber, value);
  return w;
}

export function encodeFriendListBodyItem(item: FriendListBodyItem): Uint8Array {
  const number = encodeRepeatedUint32(FriendListNumberField.numbers, item.number.numbers).finish();
  return new ProtoWriter()
    .uint32(FriendListBodyItemField.type, item.type)
    .message(FriendListBodyItemField.number, number)
    .finish();
}

export function encodeFriendListRequest(body: FriendListRequest): Uint8Array {
  const writer = new ProtoWriter()
    .uint32(FriendListRequestField.friendCount, body.friendCount)
    // Ordinary `!== 0` rule: the 0 is dropped, as in reference/index.mjs:51681.
    .uint32(FriendListRequestField.field4, body.field4)
    .bytes(FriendListRequestField.cookie, body.cookie)
    .uint32(FriendListRequestField.field6, body.field6)
    .uint32(FriendListRequestField.field7, body.field7)
    .repeatedMessage(FriendListRequestField.body, body.body.map(encodeFriendListBodyItem));

  for (const value of body.field10002) writer.uint32Present(FriendListRequestField.field10002, value);
  writer.uint32(FriendListRequestField.field10003, body.field10003);
  return writer.finish();
}

// ---------------------------------------------------------------------------
// Response decoding
// ---------------------------------------------------------------------------

export interface FriendNumberProperty {
  key: number;
  /** int32 on the wire — see the header warning. */
  value: number;
}

export interface FriendProperty {
  code: number;
  value: Uint8Array;
}

export interface FriendLayer1 {
  numberProperties: FriendNumberProperty[];
  properties: FriendProperty[];
}

export interface FriendAdditional {
  type: number;
  layer1?: FriendLayer1 | undefined;
}

export interface Friend {
  uid: string;
  customGroup: number;
  uin: number;
  additional: FriendAdditional[];
}

export interface FriendCategory {
  categoryId: number;
  categoryName: string;
  memberCount: number;
  sortId: number;
}

export interface FriendListResponse {
  cookie?: Uint8Array | undefined;
  isEnd: boolean;
  timestamp: bigint;
  selfUin: bigint;
  smallSeq: number;
  friends: Friend[];
  categories: FriendCategory[];
}

function decodeFriendNumberProperty(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FriendNumberProperty {
  const reader = new ProtoReader(data, offset, end);
  const p: FriendNumberProperty = { key: 0, value: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FriendNumberPropertyField.key, WireType.varint):
        p.key = reader.uint32();
        break;
      case tagOf(FriendNumberPropertyField.value, WireType.varint):
        p.value = reader.int32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return p;
}

function decodeFriendProperty(data: Uint8Array, offset = 0, end = data.length): FriendProperty {
  const reader = new ProtoReader(data, offset, end);
  const p: FriendProperty = { code: 0, value: new Uint8Array(0) };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FriendPropertyField.code, WireType.varint):
        p.code = reader.uint32();
        break;
      case tagOf(FriendPropertyField.value, WireType.lengthDelimited):
        p.value = reader.bytes();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return p;
}

function decodeFriendLayer1(data: Uint8Array, offset = 0, end = data.length): FriendLayer1 {
  const reader = new ProtoReader(data, offset, end);
  const layer: FriendLayer1 = { numberProperties: [], properties: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FriendLayer1Field.numberProperties, WireType.lengthDelimited):
        layer.numberProperties.push(reader.message(decodeFriendNumberProperty));
        break;
      case tagOf(FriendLayer1Field.properties, WireType.lengthDelimited):
        layer.properties.push(reader.message(decodeFriendProperty));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return layer;
}

function decodeFriendAdditional(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FriendAdditional {
  const reader = new ProtoReader(data, offset, end);
  const a: FriendAdditional = { type: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FriendAdditionalField.type, WireType.varint):
        a.type = reader.uint32();
        break;
      case tagOf(FriendAdditionalField.layer1, WireType.lengthDelimited):
        a.layer1 = reader.message(decodeFriendLayer1);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return a;
}

function decodeFriend(data: Uint8Array, offset = 0, end = data.length): Friend {
  const reader = new ProtoReader(data, offset, end);
  const f: Friend = { uid: "", customGroup: 0, uin: 0, additional: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FriendField.uid, WireType.lengthDelimited):
        f.uid = reader.string();
        break;
      case tagOf(FriendField.customGroup, WireType.varint):
        f.customGroup = reader.uint32();
        break;
      case tagOf(FriendField.uin, WireType.varint):
        f.uin = reader.uint32();
        break;
      case tagOf(FriendField.additional, WireType.lengthDelimited):
        f.additional.push(reader.message(decodeFriendAdditional));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return f;
}

function decodeFriendCategory(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FriendCategory {
  const reader = new ProtoReader(data, offset, end);
  const c: FriendCategory = { categoryId: 0, categoryName: "", memberCount: 0, sortId: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FriendCategoryField.categoryId, WireType.varint):
        c.categoryId = reader.uint32();
        break;
      case tagOf(FriendCategoryField.categoryName, WireType.lengthDelimited):
        c.categoryName = reader.string();
        break;
      case tagOf(FriendCategoryField.memberCount, WireType.varint):
        c.memberCount = reader.uint32();
        break;
      case tagOf(FriendCategoryField.sortId, WireType.varint):
        c.sortId = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return c;
}

export function decodeFriendListResponse(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FriendListResponse {
  const reader = new ProtoReader(data, offset, end);
  const resp: FriendListResponse = {
    isEnd: false,
    timestamp: 0n,
    selfUin: 0n,
    smallSeq: 0,
    friends: [],
    categories: [],
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FriendListResponseField.cookie, WireType.lengthDelimited):
        resp.cookie = reader.bytes();
        break;
      case tagOf(FriendListResponseField.isEnd, WireType.varint):
        resp.isEnd = reader.bool();
        break;
      case tagOf(FriendListResponseField.timestamp, WireType.varint):
        resp.timestamp = reader.uint64();
        break;
      case tagOf(FriendListResponseField.selfUin, WireType.varint):
        resp.selfUin = reader.uint64();
        break;
      case tagOf(FriendListResponseField.smallSeq, WireType.varint):
        resp.smallSeq = reader.uint32();
        break;
      case tagOf(FriendListResponseField.friends, WireType.lengthDelimited):
        resp.friends.push(reader.message(decodeFriend));
        break;
      case tagOf(FriendListResponseField.categories, WireType.lengthDelimited):
        resp.categories.push(reader.message(decodeFriendCategory));
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

/** `friendProperties` (reference/index.mjs:53101). */
export function friendProperties(friend: Friend): {
  props: Map<number, Uint8Array>;
  numbers: Map<number, number>;
} {
  const props = new Map<number, Uint8Array>();
  const numbers = new Map<number, number>();
  for (const additional of friend.additional) {
    if ((additional.type ?? 0) !== 1 || !additional.layer1) continue;
    for (const property of additional.layer1.properties) {
      props.set(property.code ?? 0, property.value ?? new Uint8Array(0));
    }
    for (const property of additional.layer1.numberProperties) {
      numbers.set(property.key ?? 0, property.value ?? 0);
    }
  }
  return { props, numbers };
}

export interface FriendEntry {
  uin: number;
  uid: string;
  /** Nickname, falling back to the uin as a decimal string. */
  nickname: string;
  remark: string;
  categoryId: number;
  /** Only present when at least one public-profile key decoded. */
  profile?: PublicProfile | undefined;
}

export interface FriendListItem {
  categoryId: number;
  friend: FriendEntry;
}

/**
 * `mapFriend` (reference/index.mjs:53131).
 *
 * ⚠️ `nickname` falls back to `String(uin)` — **not** to "" — when property 20002
 * is absent.  That is deliberate: a OneBot `friend` needs a non-empty name, and QQ
 * always has one; the fallback is what makes an unusual roster entry usable rather
 * than empty.  Using "" here changes observable output for such entries.
 */
export function mapFriend(raw: Friend): FriendListItem {
  const { props, numbers } = friendProperties(raw);
  const profile = decodePublicProfile(props, numbers);
  return {
    categoryId: raw.customGroup ?? 0,
    friend: {
      uin: raw.uin ?? 0,
      uid: raw.uid ?? "",
      nickname: props.has(20002)
        ? new TextDecoder("utf-8").decode(props.get(20002))
        : String(raw.uin ?? 0),
      remark: new TextDecoder("utf-8").decode(props.get(103) ?? new Uint8Array(0)),
      categoryId: raw.customGroup ?? 0,
      ...(Object.keys(profile).length > 0 ? { profile } : {}),
    },
  };
}

export interface FriendListPage {
  entries: FriendListItem[];
  categories: FriendCategory[];
  cookie?: Uint8Array | undefined;
}

/** `FetchFriendListPage.deserialize` (reference/index.mjs:53180). */
export function toFriendListPage(body: FriendListResponse): FriendListPage {
  return {
    entries: (body.friends ?? []).map(mapFriend),
    categories: (body.categories ?? []).map((raw) => ({
      categoryId: raw.categoryId ?? 0,
      categoryName: raw.categoryName ?? "",
      memberCount: raw.memberCount ?? 0,
      sortId: raw.sortId ?? 0,
    })),
    ...(body.cookie && body.cookie.length > 0 ? { cookie: Uint8Array.from(body.cookie) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

export interface FetchFriendListPageParams {
  /** Continuation token from a previous page. */
  cookie?: Uint8Array | undefined;
}

export const FetchFriendListPage: OidbSpec<
  FetchFriendListPageParams,
  FriendListRequest,
  FriendListResponse,
  FriendListPage
> = {
  command: FRIEND_LIST_COMMAND,
  subCommand: FRIEND_LIST_SUB_COMMAND,
  serialize: (params) => {
    const body: FriendListRequest = {
      friendCount: FRIEND_LIST_PAGE_SIZE,
      field4: 0,
      field6: FRIEND_LIST_FIELD6,
      field7: FRIEND_LIST_FIELD7,
      body: [
        { type: 1, number: { numbers: FRIEND_DETAIL_KEYS } },
        { type: 4, number: { numbers: FRIEND_BASE_KEYS } },
      ],
      field10002: FRIEND_LIST_FIELD10002,
      field10003: FRIEND_LIST_FIELD10003,
    };
    if (params.cookie && params.cookie.length > 0) body.cookie = params.cookie;
    return body;
  },
  encodeBody: encodeFriendListRequest,
  decodeBody: decodeFriendListResponse,
  deserialize: (body) => toFriendListPage(body),
};