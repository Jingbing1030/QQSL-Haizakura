// OidbSvcTrpcTcp.0xfe7_3 — one page of the group member roster
// (`get_group_member_list`).
//
// ---------------------------------------------------------------------------
// The sub-command is 3, not 4
// ---------------------------------------------------------------------------
// ONEBOT-ACTION-SPEC.md lists `get_group_member_list` against `0xfe7_4`.  The
// reference's roster call is **`_FetchGroupMemberListPage.subCommand = 3`**
// (reference/index.mjs:59154).  `_4` is a different spec on the same command
// (group admin receive-verify) and answering `_4` here would address the wrong
// server handler.  The goldens pin `OidbSvcTrpcTcp.0xfe7_3`.
//
// ---------------------------------------------------------------------------
// Field numbers — request
// ---------------------------------------------------------------------------
//   OidbGroupMemberListRequest   reference/index.mjs:57832 / 57870 (write)
//     1 groupUin uint32
//     2 field2   uint32   constant 5
//     3 field3   uint32   constant 2
//     4 body     -> OidbGroupMemberListBody
//     15 token   string
//   OidbGroupMemberListBody      reference/index.mjs:58001 / 58043 (write)
//     10  memberName       bool
//     11  memberCard       bool
//     12  level            bool
//     13  field13          bool
//     16  field16          bool
//     17  specialTitle     bool
//     18  field18          bool
//     20  field20          bool
//     21  field21          bool
//     100 joinTimestamp    bool
//     101 lastMsgTimestamp bool
//     102 shutUpTimestamp  bool
//     103 field103         bool
//     104 field104         bool
//     105 field105         bool
//     106 field106         bool
//     107 permission       bool
//     200 field200         bool
//     201 field201         bool
//
// ⚠️ The body's field numbers start at **10**, jump to 100, and end at 200/201.
// They are not 1-based and not contiguous; only the *set* of requested fields
// matters to the server.  Every one of them uses the `=== true` bool rule, so
// `false` drops silently and only `true` occupies a byte — which is why all
// nineteen fit in exactly 38 bytes (`2a 26 50 01 ...`).
//
// ⚠️ `token` (field 15) is optional and, when absent, no tag is written at all.
// It is the *string* presence rule: `if (p.token) body.token = p.token`, so an
// empty string is indistinguishable from no token.
//
// ---------------------------------------------------------------------------
// Field numbers — response
// ---------------------------------------------------------------------------
//   OidbSvcTrpcTcp0xFE7_3Response   reference/index.mjs:58367
//     1  groupUin           uint32
//     2  members            repeated -> ...Member
//     3  field3             uint32
//     5  memberChangeSeq    uint32
//     6  memberCardChangeSeq uint32
//     15 token              string
//   ...Member                       reference/index.mjs:58556
//     1   uin -> ...Uin
//     10  memberName   string
//     11  memberCard -> ...Card
//     12  level      -> ...Level
//     17  specialTitle string
//     100 joinTimestamp    uint32
//     101 lastMsgTimestamp uint32
//     102 shutUpTimestamp  uint32
//     107 permission       uint32
//   ...Uin                          reference/index.mjs:58811
//     2 uid string
//     4 uin uint32
//   ...Card                         reference/index.mjs:58918
//     2 memberCard string
//   ...Level                        reference/index.mjs:59003
//     1 infos repeated uint32 **and** repeated packed uint32 (both cases feed `infos`)
//     2 level uint32
//
// ⚠️ `...Uin` puts `uid` at **2** and `uin` at **4**, and `...Card` puts the card
// string at **2**, not 1.  These nested wrapper messages exist only so several
// field numbers can carry an optional scalar; the inner numbers do not start at 1.
//
// ⚠️ `...Level.infos` is decoded from *both* the unpacked (`case 8`) and packed
// (`case 10`) encodings into the same array (reference/index.mjs:59040-59090).
// The reference tolerates either; here both wire shapes are accepted too, because
// the server has been observed using both across versions.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 4071 = 0xfe7. */
export const GROUP_MEMBER_LIST_COMMAND = 0xfe7;

/** ⚠️ 3, not the 4 that ONEBOT-ACTION-SPEC.md implies. */
export const GROUP_MEMBER_LIST_SUB_COMMAND = 3;

/** Constants from `serialize` (reference/index.mjs:59156-59158). */
export const GROUP_MEMBER_LIST_FIELD2 = 5;
export const GROUP_MEMBER_LIST_FIELD3 = 2;

export const GroupMemberListRequestField = {
  groupUin: 1,
  field2: 2,
  field3: 3,
  body: 4,
  token: 15,
} as const;

/** The nineteen "please return this" switches, by their real field numbers. */
export const GroupMemberListBodyField = {
  memberName: 10,
  memberCard: 11,
  level: 12,
  field13: 13,
  field16: 16,
  specialTitle: 17,
  field18: 18,
  field20: 20,
  field21: 21,
  joinTimestamp: 100,
  lastMsgTimestamp: 101,
  shutUpTimestamp: 102,
  field103: 103,
  field104: 104,
  field105: 105,
  field106: 106,
  permission: 107,
  field200: 200,
  field201: 201,
} as const;

export const GroupMemberListResponseField = {
  groupUin: 1,
  members: 2,
  field3: 3,
  memberChangeSeq: 5,
  memberCardChangeSeq: 6,
  token: 15,
} as const;

export const GroupMemberField = {
  uin: 1,
  memberName: 10,
  memberCard: 11,
  level: 12,
  specialTitle: 17,
  joinTimestamp: 100,
  lastMsgTimestamp: 101,
  shutUpTimestamp: 102,
  permission: 107,
} as const;

/** ⚠️ uid at 2, uin at 4. */
export const GroupMemberUinField = { uid: 2, uin: 4 } as const;
/** ⚠️ the card text is at 2. */
export const GroupMemberCardField = { memberCard: 2 } as const;
export const GroupMemberLevelField = { infos: 1, level: 2 } as const;

export interface GroupMemberListBody {
  memberName?: boolean | undefined;
  memberCard?: boolean | undefined;
  level?: boolean | undefined;
  field13?: boolean | undefined;
  field16?: boolean | undefined;
  specialTitle?: boolean | undefined;
  field18?: boolean | undefined;
  field20?: boolean | undefined;
  field21?: boolean | undefined;
  joinTimestamp?: boolean | undefined;
  lastMsgTimestamp?: boolean | undefined;
  shutUpTimestamp?: boolean | undefined;
  field103?: boolean | undefined;
  field104?: boolean | undefined;
  field105?: boolean | undefined;
  field106?: boolean | undefined;
  permission?: boolean | undefined;
  field200?: boolean | undefined;
  field201?: boolean | undefined;
}

export interface GroupMemberListRequest {
  groupUin: number;
  field2: number;
  field3: number;
  body: GroupMemberListBody;
  token?: string | undefined;
}

/** All nineteen switches on — what the reference sends (reference/index.mjs:59159). */
export const GROUP_MEMBER_LIST_ALL_TRUE: GroupMemberListBody = {
  memberName: true,
  memberCard: true,
  level: true,
  field13: true,
  field16: true,
  specialTitle: true,
  field18: true,
  field20: true,
  field21: true,
  joinTimestamp: true,
  lastMsgTimestamp: true,
  shutUpTimestamp: true,
  field103: true,
  field104: true,
  field105: true,
  field106: true,
  permission: true,
  field200: true,
  field201: true,
};

export function encodeGroupMemberListBody(body: GroupMemberListBody): Uint8Array {
  return new ProtoWriter()
    .bool(GroupMemberListBodyField.memberName, body.memberName)
    .bool(GroupMemberListBodyField.memberCard, body.memberCard)
    .bool(GroupMemberListBodyField.level, body.level)
    .bool(GroupMemberListBodyField.field13, body.field13)
    .bool(GroupMemberListBodyField.field16, body.field16)
    .bool(GroupMemberListBodyField.specialTitle, body.specialTitle)
    .bool(GroupMemberListBodyField.field18, body.field18)
    .bool(GroupMemberListBodyField.field20, body.field20)
    .bool(GroupMemberListBodyField.field21, body.field21)
    .bool(GroupMemberListBodyField.joinTimestamp, body.joinTimestamp)
    .bool(GroupMemberListBodyField.lastMsgTimestamp, body.lastMsgTimestamp)
    .bool(GroupMemberListBodyField.shutUpTimestamp, body.shutUpTimestamp)
    .bool(GroupMemberListBodyField.field103, body.field103)
    .bool(GroupMemberListBodyField.field104, body.field104)
    .bool(GroupMemberListBodyField.field105, body.field105)
    .bool(GroupMemberListBodyField.field106, body.field106)
    .bool(GroupMemberListBodyField.permission, body.permission)
    .bool(GroupMemberListBodyField.field200, body.field200)
    .bool(GroupMemberListBodyField.field201, body.field201)
    .finish();
}

export function encodeGroupMemberListRequest(body: GroupMemberListRequest): Uint8Array {
  return new ProtoWriter()
    .uint32(GroupMemberListRequestField.groupUin, body.groupUin)
    .uint32(GroupMemberListRequestField.field2, body.field2)
    .uint32(GroupMemberListRequestField.field3, body.field3)
    .message(GroupMemberListRequestField.body, encodeGroupMemberListBody(body.body))
    .string(GroupMemberListRequestField.token, body.token)
    .finish();
}

// ---------------------------------------------------------------------------
// Response decoding
// ---------------------------------------------------------------------------

export interface GroupMemberUin {
  uid: string;
  uin: number;
}

export interface GroupMemberCard {
  memberCard: string;
}

export interface GroupMemberLevel {
  /** Populated from both the unpacked and the packed wire form. */
  infos: number[];
  level: number;
}

export interface GroupMember {
  uin?: GroupMemberUin | undefined;
  memberName: string;
  memberCard?: GroupMemberCard | undefined;
  level?: GroupMemberLevel | undefined;
  specialTitle: string;
  joinTimestamp: number;
  lastMsgTimestamp: number;
  shutUpTimestamp: number;
  permission: number;
}

export interface GroupMemberListResponse {
  groupUin: number;
  members: GroupMember[];
  field3: number;
  memberChangeSeq: number;
  memberCardChangeSeq: number;
  token: string;
}

function decodeGroupMemberUin(data: Uint8Array, offset = 0, end = data.length): GroupMemberUin {
  const reader = new ProtoReader(data, offset, end);
  const u: GroupMemberUin = { uid: "", uin: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupMemberUinField.uid, WireType.lengthDelimited):
        u.uid = reader.string();
        break;
      case tagOf(GroupMemberUinField.uin, WireType.varint):
        u.uin = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return u;
}

function decodeGroupMemberCard(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupMemberCard {
  const reader = new ProtoReader(data, offset, end);
  const c: GroupMemberCard = { memberCard: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupMemberCardField.memberCard, WireType.lengthDelimited):
        c.memberCard = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return c;
}

/**
 * `...Level` — accepts `infos` as unpacked varints (tag `08`) **and** as packed
 * varints (tag `0a`), both appending to the same array
 * (reference/index.mjs:59040 and 59068).
 *
 * The wire reader's `skip` cannot do this, so the packed payload is walked here
 * with a nested reader.
 */
function decodeGroupMemberLevel(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupMemberLevel {
  const reader = new ProtoReader(data, offset, end);
  const l: GroupMemberLevel = { infos: [], level: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupMemberLevelField.infos, WireType.varint):
        l.infos.push(reader.uint32());
        break;
      case tagOf(GroupMemberLevelField.infos, WireType.lengthDelimited): {
        const packed = reader.bytes();
        const inner = new ProtoReader(packed, 0, packed.length);
        while (inner.offset < packed.length) l.infos.push(inner.uint32());
        break;
      }
      case tagOf(GroupMemberLevelField.level, WireType.varint):
        l.level = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return l;
}

function decodeGroupMember(data: Uint8Array, offset = 0, end = data.length): GroupMember {
  const reader = new ProtoReader(data, offset, end);
  const m: GroupMember = {
    memberName: "",
    specialTitle: "",
    joinTimestamp: 0,
    lastMsgTimestamp: 0,
    shutUpTimestamp: 0,
    permission: 0,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupMemberField.uin, WireType.lengthDelimited):
        m.uin = reader.message(decodeGroupMemberUin);
        break;
      case tagOf(GroupMemberField.memberName, WireType.lengthDelimited):
        m.memberName = reader.string();
        break;
      case tagOf(GroupMemberField.memberCard, WireType.lengthDelimited):
        m.memberCard = reader.message(decodeGroupMemberCard);
        break;
      case tagOf(GroupMemberField.level, WireType.lengthDelimited):
        m.level = reader.message(decodeGroupMemberLevel);
        break;
      case tagOf(GroupMemberField.specialTitle, WireType.lengthDelimited):
        m.specialTitle = reader.string();
        break;
      case tagOf(GroupMemberField.joinTimestamp, WireType.varint):
        m.joinTimestamp = reader.uint32();
        break;
      case tagOf(GroupMemberField.lastMsgTimestamp, WireType.varint):
        m.lastMsgTimestamp = reader.uint32();
        break;
      case tagOf(GroupMemberField.shutUpTimestamp, WireType.varint):
        m.shutUpTimestamp = reader.uint32();
        break;
      case tagOf(GroupMemberField.permission, WireType.varint):
        m.permission = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return m;
}

export function decodeGroupMemberListResponse(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupMemberListResponse {
  const reader = new ProtoReader(data, offset, end);
  const resp: GroupMemberListResponse = {
    groupUin: 0,
    members: [],
    field3: 0,
    memberChangeSeq: 0,
    memberCardChangeSeq: 0,
    token: "",
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupMemberListResponseField.groupUin, WireType.varint):
        resp.groupUin = reader.uint32();
        break;
      case tagOf(GroupMemberListResponseField.members, WireType.lengthDelimited):
        resp.members.push(reader.message(decodeGroupMember));
        break;
      case tagOf(GroupMemberListResponseField.field3, WireType.varint):
        resp.field3 = reader.uint32();
        break;
      case tagOf(GroupMemberListResponseField.memberChangeSeq, WireType.varint):
        resp.memberChangeSeq = reader.uint32();
        break;
      case tagOf(GroupMemberListResponseField.memberCardChangeSeq, WireType.varint):
        resp.memberCardChangeSeq = reader.uint32();
        break;
      case tagOf(GroupMemberListResponseField.token, WireType.lengthDelimited):
        resp.token = reader.string();
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

export type GroupMemberRole = "owner" | "admin" | "member";

/** `permissionToRole` (reference/index.mjs:59145). */
export function permissionToRole(permission: number): GroupMemberRole {
  switch (permission) {
    case 1:
      return "owner";
    case 2:
      return "admin";
    default:
      return "member";
  }
}

export interface GroupMemberEntry {
  uin: number;
  uid: string;
  nickname: string;
  card: string;
  /** Always false: the reference never sets this from the roster. */
  isRobot: boolean;
  role: GroupMemberRole;
  level: number;
  title: string;
  joinTime: number;
  lastSentTime: number;
  shutUpTime: number;
}

export interface GroupMemberListPage {
  members: GroupMemberEntry[];
  token: string;
}

/**
 * `FetchGroupMemberListPage.deserialize` (reference/index.mjs:59182).
 *
 * ⚠️ `isRobot` is a **constant false** — not a decoded field.  The roster message
 * has no robot flag; `get_group_member_list` learns robot-ness from a different
 * command.  Anything that made this a decoded boolean would be inventing a field.
 *
 * ⚠️ `token` defaults to `""`, not undefined: the caller uses `if (token)` to
 * decide whether to fetch another page, and both spellings behave the same, but the
 * *type* is a non-optional string in the reference's contract.
 */
export function toGroupMemberListPage(body: GroupMemberListResponse): GroupMemberListPage {
  return {
    members: (body.members ?? []).map((raw) => ({
      uin: raw.uin?.uin ?? 0,
      uid: raw.uin?.uid ?? "",
      nickname: raw.memberName ?? "",
      card: raw.memberCard?.memberCard ?? "",
      isRobot: false,
      role: permissionToRole(raw.permission ?? 0),
      level: raw.level?.level ?? 0,
      title: raw.specialTitle ?? "",
      joinTime: raw.joinTimestamp ?? 0,
      lastSentTime: raw.lastMsgTimestamp ?? 0,
      shutUpTime: raw.shutUpTimestamp ?? 0,
    })),
    token: body.token ?? "",
  };
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

export interface FetchGroupMemberListPageParams {
  groupId: number;
  /** Continuation token from a previous page. */
  token?: string | undefined;
}

export const FetchGroupMemberListPage: OidbSpec<
  FetchGroupMemberListPageParams,
  GroupMemberListRequest,
  GroupMemberListResponse,
  GroupMemberListPage
> = {
  command: GROUP_MEMBER_LIST_COMMAND,
  subCommand: GROUP_MEMBER_LIST_SUB_COMMAND,
  serialize: (params) => {
    const body: GroupMemberListRequest = {
      groupUin: params.groupId,
      field2: GROUP_MEMBER_LIST_FIELD2,
      field3: GROUP_MEMBER_LIST_FIELD3,
      body: { ...GROUP_MEMBER_LIST_ALL_TRUE },
    };
    if (params.token) body.token = params.token;
    return body;
  },
  encodeBody: encodeGroupMemberListRequest,
  decodeBody: decodeGroupMemberListResponse,
  deserialize: (body) => toGroupMemberListPage(body),
};