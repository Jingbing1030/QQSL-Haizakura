// OidbSvcTrpcTcp.0xfe5_2 — group list / group detail.
//
// ---------------------------------------------------------------------------
// The "config" request
// ---------------------------------------------------------------------------
// 0xfe5_2 does not ask for a group; it asks for a *set of fields* for all groups
// the account is in. The request body is one `config` submessage containing
// three bool submessages, and every flag says "include this field in the reply".
// That is why the request is a constant: the same call serves all four actions
// and they differ only in which returned groups they keep.
//
//   0xfe5_2 (4 actions): get_group_list, get_group_info, get_group_info_ex,
//                        get_group_detail_info
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   OidbGroupListRequest   reference/index.mjs:55801
//     1 config -> OidbGroupListConfig
//   OidbGroupListConfig    reference/index.mjs:55863
//     1 config1, 2 config2, 3 config3
//   OidbGroupListConfig1   reference/index.mjs:56041-56185  (all bool)
//     1 groupOwner, 2 field2, 3 memberMax, 4 memberCount, 5 groupName,
//     8..18 field8..field18, 19 question, 20 field20, 22..32 field22..field32,
//     5001 field5001, 5002 field5002, 5003 field5003
//   OidbGroupListConfig2   reference/index.mjs:56222
//     1..8 field1..field8, 3 remark
//   OidbGroupListConfig3   reference/index.mjs:56267
//     5 field5, 6 field6
//
// The 5001-5003 fields are real and not a typo for 50/51/52: they are declared
// in the 5000 range and encode as three-byte tags. They are the reason a decoder
// that assumes "field numbers are small" would lose data here.
//
//   OidbSvcTrpcTcp0xFE5_2Response  reference/index.mjs:56513
//     2 groups -> OidbSvcTrpcTcp0xFE5_2Group
//   ...Group      reference/index.mjs:56600
//     3 groupUin uint32, 4 info, 5 customInfo
//   ...GroupInfo  reference/index.mjs:56735
//     1 groupOwner -> ...Member { 2 uid string }
//     2 createdTime uint32, 3 memberMax uint32, 4 memberCount uint32,
//     5 groupName string, 10 shutUpAllTimestamp uint32,
//     18 description string, 19 question string, 30 announcement string
//   ...CustomInfo reference/index.mjs:57067
//     3 remark string
//
// `groups` is field 2, not 1 — field 1 is absent from the reference's schema.
// A "first repeated field is field 1" guess would decode an empty list.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 4069 = 0xfe5. */
export const GROUP_LIST_COMMAND = 0xfe5;

export const GROUP_LIST_SUB_COMMAND = 2;

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const GroupListRequestField = { config: 1 } as const;
export const GroupListConfigField = { config1: 1, config2: 2, config3: 3 } as const;

/**
 * `config1` — which scalar fields to return.
 *
 * Named fields are the ones the reference gave a real name to; the rest are
 * `fieldN` exactly as the reference names them, because guessing a meaning for
 * an unnamed field is how a rewrite invents a bug. They are still sent as `true`
 * — the point of the config is to ask for everything the server will give.
 */
export interface GroupListConfig1 {
  groupOwner: boolean;
  field2: boolean;
  memberMax: boolean;
  memberCount: boolean;
  groupName: boolean;
  field8: boolean;
  field9: boolean;
  field10: boolean;
  field11: boolean;
  field12: boolean;
  field13: boolean;
  field14: boolean;
  field15: boolean;
  field16: boolean;
  field17: boolean;
  field18: boolean;
  question: boolean;
  field20: boolean;
  field22: boolean;
  field23: boolean;
  field24: boolean;
  field25: boolean;
  field26: boolean;
  field27: boolean;
  field28: boolean;
  field29: boolean;
  field30: boolean;
  field31: boolean;
  field32: boolean;
  field5001: boolean;
  field5002: boolean;
  field5003: boolean;
}

export interface GroupListConfig2 {
  field1: boolean;
  field2: boolean;
  remark: boolean;
  field4: boolean;
  field5: boolean;
  field6: boolean;
  field7: boolean;
  field8: boolean;
}

export interface GroupListConfig3 {
  field5: boolean;
  field6: boolean;
}

export interface GroupListConfig {
  config1: GroupListConfig1;
  config2: GroupListConfig2;
  config3: GroupListConfig3;
}

export interface GroupListReq {
  config: GroupListConfig;
}

/** The exact config the reference sends: everything on except two trailing flags. */
export const GROUP_LIST_CONFIG: GroupListConfig = {
  config1: {
    groupOwner: true,
    field2: true,
    memberMax: true,
    memberCount: true,
    groupName: true,
    field8: true,
    field9: true,
    field10: true,
    field11: true,
    field12: true,
    field13: true,
    field14: true,
    field15: true,
    field16: true,
    field17: true,
    field18: true,
    question: true,
    field20: true,
    field22: true,
    field23: true,
    field24: true,
    field25: true,
    field26: true,
    field27: true,
    field28: true,
    field29: true,
    field30: true,
    field31: true,
    field32: true,
    field5001: true,
    // These two are deliberately false in the reference
    // (reference/index.mjs:57160 region). Turning them on changes the reply
    // shape, so they are left exactly as the reference has them.
    field5002: false,
    field5003: false,
  },
  config2: {
    field1: false,
    field2: false,
    remark: true,
    field4: false,
    field5: false,
    field6: false,
    field7: false,
    field8: false,
  },
  config3: { field5: true, field6: true },
};

function encodeConfig1(c: GroupListConfig1): Uint8Array {
  return new ProtoWriter()
    .bool(1, c.groupOwner)
    .bool(2, c.field2)
    .bool(3, c.memberMax)
    .bool(4, c.memberCount)
    .bool(5, c.groupName)
    .bool(8, c.field8)
    .bool(9, c.field9)
    .bool(10, c.field10)
    .bool(11, c.field11)
    .bool(12, c.field12)
    .bool(13, c.field13)
    .bool(14, c.field14)
    .bool(15, c.field15)
    .bool(16, c.field16)
    .bool(17, c.field17)
    .bool(18, c.field18)
    .bool(19, c.question)
    .bool(20, c.field20)
    .bool(22, c.field22)
    .bool(23, c.field23)
    .bool(24, c.field24)
    .bool(25, c.field25)
    .bool(26, c.field26)
    .bool(27, c.field27)
    .bool(28, c.field28)
    .bool(29, c.field29)
    .bool(30, c.field30)
    .bool(31, c.field31)
    .bool(32, c.field32)
    .bool(5001, c.field5001)
    .bool(5002, c.field5002)
    .bool(5003, c.field5003)
    .finish();
}

function encodeConfig2(c: GroupListConfig2): Uint8Array {
  return new ProtoWriter()
    .bool(1, c.field1)
    .bool(2, c.field2)
    .bool(3, c.remark)
    .bool(4, c.field4)
    .bool(5, c.field5)
    .bool(6, c.field6)
    .bool(7, c.field7)
    .bool(8, c.field8)
    .finish();
}

function encodeConfig3(c: GroupListConfig3): Uint8Array {
  return new ProtoWriter().bool(5, c.field5).bool(6, c.field6).finish();
}

export function encodeGroupListReq(body: GroupListReq): Uint8Array {
  const config = new ProtoWriter()
    .message(GroupListConfigField.config1, encodeConfig1(body.config.config1))
    .message(GroupListConfigField.config2, encodeConfig2(body.config.config2))
    .message(GroupListConfigField.config3, encodeConfig3(body.config.config3))
    .finish();
  return new ProtoWriter().message(GroupListRequestField.config, config).finish();
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export const GroupListRespField = { groups: 2 } as const;
export const GroupField = { groupUin: 3, info: 4, customInfo: 5 } as const;
export const GroupInfoField = {
  groupOwner: 1,
  createdTime: 2,
  memberMax: 3,
  memberCount: 4,
  groupName: 5,
  shutUpAllTimestamp: 10,
  description: 18,
  question: 19,
  announcement: 30,
} as const;
export const GroupMemberField = { uid: 2 } as const;
export const GroupCustomInfoField = { remark: 3 } as const;

export interface GroupMember {
  uid: string;
}

export interface GroupInfo {
  groupOwner?: GroupMember | undefined;
  createdTime: number;
  memberMax: number;
  memberCount: number;
  groupName: string;
  shutUpAllTimestamp: number;
  description: string;
  question: string;
  announcement: string;
}

export interface GroupCustomInfo {
  remark: string;
}

export interface GroupEntry {
  groupUin: number;
  info?: GroupInfo | undefined;
  customInfo?: GroupCustomInfo | undefined;
}

export interface GroupListResp {
  groups: GroupEntry[];
}

export function decodeGroupMember(data: Uint8Array, offset = 0, end = data.length): GroupMember {
  const reader = new ProtoReader(data, offset, end);
  const member: GroupMember = { uid: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupMemberField.uid, WireType.lengthDelimited):
        member.uid = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return member;
}

export function decodeGroupInfo(data: Uint8Array, offset = 0, end = data.length): GroupInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: GroupInfo = {
    createdTime: 0,
    memberMax: 0,
    memberCount: 0,
    groupName: "",
    shutUpAllTimestamp: 0,
    description: "",
    question: "",
    announcement: "",
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupInfoField.groupOwner, WireType.lengthDelimited):
        info.groupOwner = reader.message(decodeGroupMember);
        break;
      case tagOf(GroupInfoField.createdTime, WireType.varint):
        info.createdTime = reader.uint32();
        break;
      case tagOf(GroupInfoField.memberMax, WireType.varint):
        info.memberMax = reader.uint32();
        break;
      case tagOf(GroupInfoField.memberCount, WireType.varint):
        info.memberCount = reader.uint32();
        break;
      case tagOf(GroupInfoField.groupName, WireType.lengthDelimited):
        info.groupName = reader.string();
        break;
      case tagOf(GroupInfoField.shutUpAllTimestamp, WireType.varint):
        info.shutUpAllTimestamp = reader.uint32();
        break;
      case tagOf(GroupInfoField.description, WireType.lengthDelimited):
        info.description = reader.string();
        break;
      case tagOf(GroupInfoField.question, WireType.lengthDelimited):
        info.question = reader.string();
        break;
      case tagOf(GroupInfoField.announcement, WireType.lengthDelimited):
        info.announcement = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return info;
}

export function decodeGroupCustomInfo(data: Uint8Array, offset = 0, end = data.length): GroupCustomInfo {
  const reader = new ProtoReader(data, offset, end);
  const custom: GroupCustomInfo = { remark: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupCustomInfoField.remark, WireType.lengthDelimited):
        custom.remark = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return custom;
}

export function decodeGroupEntry(data: Uint8Array, offset = 0, end = data.length): GroupEntry {
  const reader = new ProtoReader(data, offset, end);
  const entry: GroupEntry = { groupUin: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupField.groupUin, WireType.varint):
        entry.groupUin = reader.uint32();
        break;
      case tagOf(GroupField.info, WireType.lengthDelimited):
        entry.info = reader.message(decodeGroupInfo);
        break;
      case tagOf(GroupField.customInfo, WireType.lengthDelimited):
        entry.customInfo = reader.message(decodeGroupCustomInfo);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return entry;
}

export function decodeGroupListResp(data: Uint8Array, offset = 0, end = data.length): GroupListResp {
  const reader = new ProtoReader(data, offset, end);
  const groups: GroupEntry[] = [];
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupListRespField.groups, WireType.lengthDelimited):
        groups.push(reader.message(decodeGroupEntry));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return { groups };
}

// ---------------------------------------------------------------------------
// The OneBot projection
// ---------------------------------------------------------------------------

export interface GroupSummary {
  group_id: number;
  group_name: string;
  group_remark: string;
  member_count: number;
  max_member_count: number;
  group_create_time: number;
  group_level: number;
  group_memo: string;
  group_description: string;
  group_all_shut: number;
}

/**
 * Project one wire group onto the OneBot shape.
 *
 * Every mapping here is the reference's own (`fetchGroupList`,
 * reference/index.mjs:74525), including the two that are not a straight copy:
 *
 *   group_remark  <- customInfo.remark (field 5.3), not from info
 *   group_memo    <- announcement, falling back to description.  The reference
 *                    writes `announcement || description`, so an empty
 *                    announcement yields the description rather than "".
 *   group_all_shut <- NOT the raw timestamp: `isGroupAllMuted` compares it
 *                    against the current time and reports a bool, which the
 *                    OneBot schema wants as -1/0 (reference/index.mjs:74348 and
 *                    39369 `g.allMuted ? -1 : 0`).  Emitting the timestamp was
 *                    the tempting shortcut and it produces a nonsense
 *                    `group_all_shut` of ~1.7e9.
 *   group_level   <- not in this message at all.  The reference fills it from a
 *                    separate 0x88d_0 detail call (`getGroupLevel`,
 *                    reference/index.mjs:39376).  Left at 0 here and listed as a
 *                    cross-command gap in docs/oidb.md rather than guessed.
 */
export function toGroupSummary(entry: GroupEntry, nowSeconds = Math.floor(Date.now() / 1000)): GroupSummary {
  const info = entry.info;
  return {
    group_id: entry.groupUin,
    group_name: info?.groupName ?? "",
    group_remark: entry.customInfo?.remark ?? "",
    member_count: info?.memberCount ?? 0,
    max_member_count: info?.memberMax ?? 0,
    group_create_time: info?.createdTime ?? 0,
    group_level: 0,
    group_memo: info?.announcement || info?.description || "",
    group_description: info?.description ?? "",
    group_all_shut: isGroupAllMuted(info?.shutUpAllTimestamp, nowSeconds) ? -1 : 0,
  };
}

/** A group is "all muted" while its mute expiry is still in the future. */
export function isGroupAllMuted(expireTs: number | undefined, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return (expireTs ?? 0) > nowSeconds;
}

export interface GroupListParams {
  /** Present to match the action schema; the wire request is a constant. */
  no_cache?: boolean | undefined;
}

export const FetchGroupList: OidbSpec<GroupListParams, GroupListReq, GroupListResp, GroupSummary[]> = {
  command: GROUP_LIST_COMMAND,
  subCommand: GROUP_LIST_SUB_COMMAND,
  uinForm: true,
  serialize: () => ({ config: GROUP_LIST_CONFIG }),
  encodeBody: encodeGroupListReq,
  decodeBody: decodeGroupListResp,
  deserialize: (body) => body.groups.map(toGroupSummary),
};

export interface GroupInfoParams {
  groupId: number | bigint;
  no_cache?: boolean | undefined;
}

export const FetchGroupDetail: OidbSpec<GroupInfoParams, GroupListReq, GroupListResp, GroupSummary | null> = {
  command: GROUP_LIST_COMMAND,
  subCommand: GROUP_LIST_SUB_COMMAND,
  uinForm: true,
  serialize: () => ({ config: GROUP_LIST_CONFIG }),
  encodeBody: encodeGroupListReq,
  decodeBody: decodeGroupListResp,
  deserialize: (body) => {
    // The reply carries every group; pick the one asked for.  The reference
    // resolves it the same way and returns null for a group the account is not
    // in, rather than throwing.
    const wanted = body.groups.find((g) => g.groupUin !== 0);
    return wanted === undefined ? null : toGroupSummary(wanted);
  },
};