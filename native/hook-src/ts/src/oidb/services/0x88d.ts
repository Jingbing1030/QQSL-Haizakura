// OidbSvcTrpcTcp.0x88d_0 — group detail (the `group_level` source).
//
// ---------------------------------------------------------------------------
// Why this command was a gap
// ---------------------------------------------------------------------------
// `0xfe5_2` (group list) carries every OneBot group field *except* `group_level`
// — that message has no level field at all.  The reference fills the level from a
// separate detail call, `getGroupLevel` (reference/index.mjs:39377):
//
//     const level = (await bridge.apis.contacts.fetchGroupDetail(groupId))?.level ?? 0;
//
// and `fetchGroupDetail` (reference/index.mjs:74552) reads
// `FetchGroupDetail(...).groupInfo?.results`.  So the missing piece was never a
// field of 0xfe5_2; it was this whole command.  docs/oidb.md §7.6 recorded it as a
// cross-command gap; this file closes it.
//
// 0x88d_0 has three consumers besides `group_level`:
//   * `get_group_admin_settings` — reads addType / question / answer /
//     privilegeFlag / groupFlagExt4 / noFingerOpen / noCodeFingerOpen
//     (reference/index.mjs:234083)
//   * `set_group_member_permissions` and friends — read `privilegeFlag` and
//     `ownerUid` before writing, then re-read after (reference/index.mjs:234162)
//   * `fetchGroupDetail` — the non-member group path (reference/index.mjs:39426)
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
// Read from the generated codec's *write* functions, which emit literal tag
// bytes.  The `__size_` pass is not usable for numbering: it only counts bytes,
// and its `size += 2` / `+= 3` constants are the *tag width*, not the tag.
//
//   OidbGroupDetailRequest                reference/index.mjs:53858 / 53877
//     1 field1  uint32   (constant 537099973)
//     2 config  -> OidbGroupDetailConfig
//   OidbGroupDetailConfig                 reference/index.mjs:53931 / 53946
//     1 uin     uint64
//     2 flags   -> OidbGroupDetailFlags
//   OidbGroupDetailFlags                  reference/index.mjs:53980 / 54047
//     1 ownerUid            bool  (`=== true`, so only true goes on the wire)
//     2 createTime          bool
//     5 maxMemberCount      bool
//     6 memberCount         bool
//     7 addType             bool
//     10 level              bool
//     15 name               string  (dropped when "")
//     16 noticePreview      string  (dropped when "")
//     21 uin                bool
//     22 lastSequence       bool
//     23 lastMessageTime    bool
//     24 question           string  (`!= null`, so "" still emits)
//     25 answer             string  (`!= null`)
//     29 maxAdminCount      string  (dropped when "")
//     45 shutUpAllTimestamp bool
//     56 privilegeFlag      bool
//     82 noFingerOpen       bool
//     83 noCodeFingerOpen   bool
//     101 groupFlagExt4     bool
//
// ⚠️ The request's flag field numbers are NOT contiguous, and they are not the
// same numbers as the response's.  In the *request* the flags message marks
// "please return this field" with a bool; in the *response* the same-named
// fields carry values under different numbers (see below).  A flag at 82 in the
// request asks for the response field 82; they happen to agree here, but
// nothing guarantees it, so both tables are written out separately.
//
// Response: reference/index.mjs:54267 (envelope), 54478 (top), 54563 (groupInfo),
// 54668 (results).
//   ...0x88D_0Response        1 groupInfo -> ...ResponseGroupInfo
//   ...ResponseGroupInfo      1 uin uint64, 3 results -> ...Results
//   ...Results
//     1 ownerUid string, 2 createTime uint64, 5 maxMemberCount uint64,
//     6 memberCount uint64, 7 addType uint32, 10 level uint64,
//     15 name string, 16 noticePreview string, 21 uin uint64,
//     22 lastSequence uint64, 23 lastMessageTime uint64, 24 question string,
//     25 answer string, 29 maxAdminCount uint64, 45 shutUpAllTimestamp uint32,
//     56 privilegeFlag uint32, 82 noFingerOpen uint32,
//     83 noCodeFingerOpen uint32, 101 groupFlagExt4 uint32
//
// ⚠️ `ownerUid` is a **string** in the response (a uid, not a uin) while its
// neighbour `uin` is uint64.  Reading the string as a varint yields 0 and no
// error, which would make the "only the owner may change permissions" check
// (which compares it with the self uid) pass for everyone.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 2189 = 0x88d. */
export const GROUP_DETAIL_COMMAND = 0x88d;

export const GROUP_DETAIL_SUB_COMMAND = 0;

/** The constant the reference puts in field 1 of every detail request. */
export const GROUP_DETAIL_REQUEST_FIELD1 = 537099973;

export const GroupDetailRequestField = { field1: 1, config: 2 } as const;
export const GroupDetailConfigField = { uin: 1, flags: 2 } as const;

/** Request-side "please return this field" switches, by their own field numbers. */
export const GroupDetailFlagsField = {
  ownerUid: 1,
  createTime: 2,
  maxMemberCount: 5,
  memberCount: 6,
  addType: 7,
  level: 10,
  name: 15,
  noticePreview: 16,
  uin: 21,
  lastSequence: 22,
  lastMessageTime: 23,
  question: 24,
  answer: 25,
  maxAdminCount: 29,
  shutUpAllTimestamp: 45,
  privilegeFlag: 56,
  noFingerOpen: 82,
  noCodeFingerOpen: 83,
  groupFlagExt4: 101,
} as const;

/** Response-side value fields.  Same names, guaranteed-different numbering rules. */
export const GroupDetailResultsField = { ...GroupDetailFlagsField } as const;

export const GroupDetailResponseField = { groupInfo: 1 } as const;
export const GroupDetailInfoField = { uin: 1, results: 3 } as const;

/** The request flags the reference always turns on (reference/index.mjs:55115). */
export interface GroupDetailFlags {
  ownerUid?: boolean | undefined;
  createTime?: boolean | undefined;
  maxMemberCount?: boolean | undefined;
  memberCount?: boolean | undefined;
  addType?: boolean | undefined;
  level?: boolean | undefined;
  name?: string | undefined;
  noticePreview?: string | undefined;
  uin?: boolean | undefined;
  lastSequence?: boolean | undefined;
  lastMessageTime?: boolean | undefined;
  question?: string | undefined;
  answer?: string | undefined;
  maxAdminCount?: string | undefined;
  shutUpAllTimestamp?: boolean | undefined;
  privilegeFlag?: boolean | undefined;
  noFingerOpen?: boolean | undefined;
  noCodeFingerOpen?: boolean | undefined;
  groupFlagExt4?: boolean | undefined;
}

export interface GroupDetailConfig {
  uin: bigint;
  flags: GroupDetailFlags;
}

export interface GroupDetailRequest {
  field1: number;
  config: GroupDetailConfig;
}

/** What the reference asks for on every call (all bools true, strings ""). */
export const GROUP_DETAIL_FLAGS: GroupDetailFlags = {
  ownerUid: true,
  createTime: true,
  maxMemberCount: true,
  memberCount: true,
  level: true,
  name: "",
  noticePreview: "",
  uin: true,
  lastSequence: true,
  lastMessageTime: true,
  question: "",
  answer: "",
  maxAdminCount: "",
  shutUpAllTimestamp: true,
  addType: true,
  privilegeFlag: true,
  groupFlagExt4: true,
  noFingerOpen: true,
  noCodeFingerOpen: true,
};

/**
 * Encode `OidbGroupDetailFlags`.
 *
 * The three string fields split into two presence classes, and the difference is
 * load-bearing:
 *   * `name` / `noticePreview` / `maxAdminCount` use `!= null && !== ""`, so the
 *     reference's `""` values vanish;
 *   * `question` / `answer` use only `!= null`, so `""` is written as a
 *     zero-length field (`c2 01 00` / `ca 01 00`).
 * Making them uniform would change the request length by four bytes and the
 * server would see a different set of fields.
 */
export function encodeGroupDetailFlags(flags: GroupDetailFlags): Uint8Array {
  return new ProtoWriter()
    .bool(GroupDetailFlagsField.ownerUid, flags.ownerUid)
    .bool(GroupDetailFlagsField.createTime, flags.createTime)
    .bool(GroupDetailFlagsField.maxMemberCount, flags.maxMemberCount)
    .bool(GroupDetailFlagsField.memberCount, flags.memberCount)
    .bool(GroupDetailFlagsField.addType, flags.addType)
    .bool(GroupDetailFlagsField.level, flags.level)
    .string(GroupDetailFlagsField.name, flags.name)
    .string(GroupDetailFlagsField.noticePreview, flags.noticePreview)
    .bool(GroupDetailFlagsField.uin, flags.uin)
    .bool(GroupDetailFlagsField.lastSequence, flags.lastSequence)
    .bool(GroupDetailFlagsField.lastMessageTime, flags.lastMessageTime)
    .stringPresent(GroupDetailFlagsField.question, flags.question)
    .stringPresent(GroupDetailFlagsField.answer, flags.answer)
    .string(GroupDetailFlagsField.maxAdminCount, flags.maxAdminCount)
    .bool(GroupDetailFlagsField.shutUpAllTimestamp, flags.shutUpAllTimestamp)
    .bool(GroupDetailFlagsField.privilegeFlag, flags.privilegeFlag)
    .bool(GroupDetailFlagsField.noFingerOpen, flags.noFingerOpen)
    .bool(GroupDetailFlagsField.noCodeFingerOpen, flags.noCodeFingerOpen)
    .bool(GroupDetailFlagsField.groupFlagExt4, flags.groupFlagExt4)
    .finish();
}

export function encodeGroupDetailConfig(config: GroupDetailConfig): Uint8Array {
  return new ProtoWriter()
    .uint64(GroupDetailConfigField.uin, config.uin)
    .message(GroupDetailConfigField.flags, encodeGroupDetailFlags(config.flags))
    .finish();
}

export function encodeGroupDetailReq(body: GroupDetailRequest): Uint8Array {
  return new ProtoWriter()
    .uint32(GroupDetailRequestField.field1, body.field1)
    .message(GroupDetailRequestField.config, encodeGroupDetailConfig(body.config))
    .finish();
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface GroupDetailResults {
  ownerUid: string;
  createTime: bigint;
  maxMemberCount: bigint;
  memberCount: bigint;
  addType: number;
  level: bigint;
  name: string;
  noticePreview: string;
  uin: bigint;
  lastSequence: bigint;
  lastMessageTime: bigint;
  question: string;
  answer: string;
  maxAdminCount: bigint;
  shutUpAllTimestamp: number;
  privilegeFlag: number;
  noFingerOpen: number;
  noCodeFingerOpen: number;
  groupFlagExt4: number;
}

export interface GroupDetailInfo {
  uin: bigint;
  results?: GroupDetailResults | undefined;
}

export interface GroupDetailResp {
  groupInfo?: GroupDetailInfo | undefined;
}

export function decodeGroupDetailResults(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupDetailResults {
  const reader = new ProtoReader(data, offset, end);
  const r: GroupDetailResults = {
    ownerUid: "",
    createTime: 0n,
    maxMemberCount: 0n,
    memberCount: 0n,
    addType: 0,
    level: 0n,
    name: "",
    noticePreview: "",
    uin: 0n,
    lastSequence: 0n,
    lastMessageTime: 0n,
    question: "",
    answer: "",
    maxAdminCount: 0n,
    shutUpAllTimestamp: 0,
    privilegeFlag: 0,
    noFingerOpen: 0,
    noCodeFingerOpen: 0,
    groupFlagExt4: 0,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupDetailResultsField.ownerUid, WireType.lengthDelimited):
        r.ownerUid = reader.string();
        break;
      case tagOf(GroupDetailResultsField.createTime, WireType.varint):
        r.createTime = reader.uint64();
        break;
      case tagOf(GroupDetailResultsField.maxMemberCount, WireType.varint):
        r.maxMemberCount = reader.uint64();
        break;
      case tagOf(GroupDetailResultsField.memberCount, WireType.varint):
        r.memberCount = reader.uint64();
        break;
      case tagOf(GroupDetailResultsField.addType, WireType.varint):
        r.addType = reader.uint32();
        break;
      case tagOf(GroupDetailResultsField.level, WireType.varint):
        r.level = reader.uint64();
        break;
      case tagOf(GroupDetailResultsField.name, WireType.lengthDelimited):
        r.name = reader.string();
        break;
      case tagOf(GroupDetailResultsField.noticePreview, WireType.lengthDelimited):
        r.noticePreview = reader.string();
        break;
      case tagOf(GroupDetailResultsField.uin, WireType.varint):
        r.uin = reader.uint64();
        break;
      case tagOf(GroupDetailResultsField.lastSequence, WireType.varint):
        r.lastSequence = reader.uint64();
        break;
      case tagOf(GroupDetailResultsField.lastMessageTime, WireType.varint):
        r.lastMessageTime = reader.uint64();
        break;
      case tagOf(GroupDetailResultsField.question, WireType.lengthDelimited):
        r.question = reader.string();
        break;
      case tagOf(GroupDetailResultsField.answer, WireType.lengthDelimited):
        r.answer = reader.string();
        break;
      case tagOf(GroupDetailResultsField.maxAdminCount, WireType.varint):
        r.maxAdminCount = reader.uint64();
        break;
      case tagOf(GroupDetailResultsField.shutUpAllTimestamp, WireType.varint):
        r.shutUpAllTimestamp = reader.uint32();
        break;
      case tagOf(GroupDetailResultsField.privilegeFlag, WireType.varint):
        r.privilegeFlag = reader.uint32();
        break;
      case tagOf(GroupDetailResultsField.noFingerOpen, WireType.varint):
        r.noFingerOpen = reader.uint32();
        break;
      case tagOf(GroupDetailResultsField.noCodeFingerOpen, WireType.varint):
        r.noCodeFingerOpen = reader.uint32();
        break;
      case tagOf(GroupDetailResultsField.groupFlagExt4, WireType.varint):
        r.groupFlagExt4 = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return r;
}

export function decodeGroupDetailInfo(data: Uint8Array, offset = 0, end = data.length): GroupDetailInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: GroupDetailInfo = { uin: 0n };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupDetailInfoField.uin, WireType.varint):
        info.uin = reader.uint64();
        break;
      case tagOf(GroupDetailInfoField.results, WireType.lengthDelimited):
        info.results = reader.message(decodeGroupDetailResults);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return info;
}

export function decodeGroupDetailResp(data: Uint8Array, offset = 0, end = data.length): GroupDetailResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: GroupDetailResp = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupDetailResponseField.groupInfo, WireType.lengthDelimited):
        resp.groupInfo = reader.message(decodeGroupDetailInfo);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// The OneBot projection
// ---------------------------------------------------------------------------

/**
 * The shape `fetchGroupDetail` returns (reference/index.mjs:74557).
 *
 * `memberCount` / `memberMax` / `createTime` / `level` are narrowed from bigint
 * to number here, because the OneBot schema wants JSON numbers and the reference
 * does the same conversion.
 */
export interface GroupDetail {
  groupId: number;
  groupName: string;
  remark: string;
  memberCount: number;
  memberMax: number;
  createTime: number;
  level: number;
  memo: string;
  allMuted: boolean;
}

/**
 * Whether a `shutUpAllTimestamp` means "all members muted right now".
 *
 * Identical to `isGroupAllMuted` in 0xfe5-2.ts (reference/index.mjs:74348 counts a
 * timestamp in the future as muted and everything else, including 0, as not).
 * Kept as a separate export so this file does not silently depend on the group
 * list module's copy.
 */
export function isGroupDetailAllMuted(shutUpAllTimestamp: number, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return shutUpAllTimestamp > nowSeconds;
}

/**
 * Project the decoded body onto the detail record, or `null` when the server
 * returned no results.
 *
 * Returning null (rather than an empty record) matches the reference exactly
 * (reference/index.mjs:74554: `if (!r) return null;`) and it matters: the
 * non-member group path in `getGroupInfo` treats null as "no such group / denied"
 * and falls through to the cached roster instead of caching a bogus all-zero entry.
 */
export function toGroupDetail(resp: GroupDetailResp, groupId: number): GroupDetail | null {
  const r = resp.groupInfo?.results;
  if (!r) return null;
  return {
    groupId,
    groupName: r.name,
    remark: "",
    memberCount: Number(r.memberCount),
    memberMax: Number(r.maxMemberCount),
    createTime: Number(r.createTime),
    level: Number(r.level),
    memo: r.noticePreview,
    allMuted: isGroupDetailAllMuted(r.shutUpAllTimestamp),
  };
}

/**
 * Group admin settings, as `getAdminSettings` reads them
 * (reference/index.mjs:234083).
 *
 * Only the fields that live in 0x88d_0 are produced; `robot_member_switch` /
 * `robot_member_examine` come from `0xef0_1` (`FetchGroupExtInfo`) and are the
 * caller's job.  `privilegeFlag` is returned raw as well, because the write path
 * (set_group_member_permissions) needs the raw value to merge against.
 */
export interface GroupAdminSettings {
  addType: number;
  question: string;
  answer: string;
  privilegeFlag: number;
  groupFlagExt4: number;
  noFingerOpen: number;
  noCodeFingerOpen: number;
}

export function toGroupAdminSettings(results: GroupDetailResults): GroupAdminSettings {
  return {
    addType: results.addType,
    question: results.question,
    answer: results.answer,
    privilegeFlag: results.privilegeFlag,
    groupFlagExt4: results.groupFlagExt4,
    noFingerOpen: results.noFingerOpen,
    noCodeFingerOpen: results.noCodeFingerOpen,
  };
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

export interface GroupDetailParams {
  groupUin: number | bigint;
}

/**
 * FetchGroupDetail spec.
 *
 * `serialize` is a constant apart from the group number: the reference asks for
 * *every* field on every call and lets the actions filter.  `uinForm` is absent,
 * i.e. the envelope carries no `reserved` bit — unlike its sibling `0xfe5_2`
 * which sets it.
 */
export const FetchGroupDetail: OidbSpec<
  GroupDetailParams,
  GroupDetailRequest,
  GroupDetailResp,
  GroupDetailResp
> = {
  command: GROUP_DETAIL_COMMAND,
  subCommand: GROUP_DETAIL_SUB_COMMAND,
  serialize: (params) => ({
    field1: GROUP_DETAIL_REQUEST_FIELD1,
    config: { uin: BigInt(params.groupUin), flags: { ...GROUP_DETAIL_FLAGS } },
  }),
  encodeBody: encodeGroupDetailReq,
  decodeBody: decodeGroupDetailResp,
  deserialize: (body) => body,
};