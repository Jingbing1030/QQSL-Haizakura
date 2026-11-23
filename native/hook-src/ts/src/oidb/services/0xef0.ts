// OidbSvcTrpcTcp.0xef0_1 and 0xf00_3 — the group "ext info" pair.
//
// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------
// The batch brief listed `FetchGroupExtInfo` and `ModifyGroupExtInfo`, and the
// reference uses exactly those variable names:
//
//   FetchGroupExtInfo    command 3824 / 0xef0, subCommand 1, uinForm TRUE
//   ModifyGroupExtInfo   command 3840 / 0xf00, subCommand 3, uinForm TRUE
//
// ⚠️ The two command numbers are adjacent in the source (0xef0 then 0xf00) but
// they are **different commands**, not a request/response pair, and the
// sub-commands are unrelated (1 vs 3). What makes them a legitimate pair is the
// shared message: both speak `OidbGroupExtBody`, and both are about the same two
// settings (robot-invite switch and robot-invite examine). One reads them, the
// other writes them.
//
// This is the command pair PROGRESS.md row 2.4's neighbour 0x88d.ts comment
// alludes to: `robot_member_switch` / `robot_member_examine` come from HERE, not
// from `0x88d_0` (which returns group *detail*, including the add-option question
// but not the robot flags).
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   OidbGetGroupExtReq            reference/index.mjs:223504 / 223519 (write)
//     1 groupCodes repeated uint64, NON-packed (`08` per element)
//     2 filter     message
//
//   OidbGroupExtFilter            reference/index.mjs:223553 / 223569 (write)
//    29 inviteRobotMemberSwitch  uint32  **field 29**, not 1
//    30 inviteRobotMemberExamine uint32  **field 30**, not 2
//
//   ⚠️ Both wrappers' payload fields are in the 29/30 range. `__write_...` emits
//   tag bytes `232, 1` (= 0xE8) and `240, 1` (= 0xF0) — two-byte tags for 29 and
//   30. A filter written at 1/2 produces `08 01 10 01`, which is 2 bytes shorter
//   and asks the server for nothing; the reply then has an `ext` with neither
//   field set.
//
//   OidbGetGroupExtResp           reference/index.mjs:223835 (decode only)
//     1 items repeated message
//   OidbGetGroupExtItem           reference/index.mjs:223920
//     1 groupCode  uint64
//     2 resultCode uint32
//     3 ext        message -> OidbGroupExtBody
//   OidbGroupExtBody              reference/index.mjs:223157 (decode) /
//                                 233649 (write, in the modify region)
//    29 inviteRobotMemberSwitch
//    30 inviteRobotMemberExamine
//
//   ⚠️ `OidbGroupExtBody` exists in BOTH regions under the same name but with
//   different suffixes and **different presence guards**:
//     * as a *decoder* (223157) it is a plain reader;
//     * as a *writer* in the modify region (233649) BOTH fields use a bare
//       `!= null` guard, so an explicit 0 IS emitted (`e80100`), whereas the
//       *filter* writer in the fetch region (223569) uses `!== 0` and drops
//       zeros.
//   That asymmetry is the whole reason `modifyGroupExtInfo({robotMemberSwitch: 0})`
//   is expressible at all: leaving the field out would mean "no change", while
//   sending 0 means "turn the switch off". Golden `modifyext_switch_only` has
//   `e80100`; `extinfo`'s filter has `e80101`. Same message name, opposite rules.
//
//   OidbModifyGroupExtReq         reference/index.mjs:233503 / 233522 (write)
//     1 groupCode **uint32**  (`!= null && !== 0`)
//     2 info      message
//   OidbGroupExtInfo              reference/index.mjs:233576 / 233595 (write)
//     1 groupCode **uint32**  (the same group number AGAIN, at the same number
//                              but in a different message)
//     2 ext       message -> OidbGroupExtBody
//
//   ⚠️ The group number appears twice, nested: `groupCode` on the wrapper and
//   `groupCode` on `info`. A request that fills only the outer one encodes to
//   `08 <group> 12 <inner with only 12 <ext>>`, which parses fine and is ignored.
//   Both are uint32 here, whereas the *fetch* wrapper's `groupCodes` is uint64 —
//   the same group id in two widths across two adjacent commands.
//
// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------
// `FetchGroupExtInfo.deserialize` (:224058) reads only `items[0]`, throws if it
// is missing, throws if `resultCode` is truthy and nonzero, then flattens the
// body to `{ robotMemberSwitch, robotMemberExamine }` with `?? 0` defaults. A
// multi-group response is silently truncated to the first entry — the command is
// only ever called with one group, so that is faithful rather than a limitation
// worth "fixing".
//
// `ModifyGroupExtInfo.deserialize` (:234048) throws when `result` is truthy and
// nonzero. Note it uses a plain `Error`, not `OidbError`: the failure arrives
// inside a successful envelope.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 3824 = 0xef0. */
export const FETCH_GROUP_EXT_INFO_COMMAND = 0xef0;

/** 3840 = 0xf00. */
export const MODIFY_GROUP_EXT_INFO_COMMAND = 0xf00;

export const FETCH_GROUP_EXT_INFO_SUB_COMMAND = 1;
export const MODIFY_GROUP_EXT_INFO_SUB_COMMAND = 3;

// ---------------------------------------------------------------------------
// Field tables
// ---------------------------------------------------------------------------

/** Payload fields of `OidbGroupExtBody`, shared by the filter, the item ext and the write. */
export const OidbGroupExtBodyField = {
  inviteRobotMemberSwitch: 29,
  inviteRobotMemberExamine: 30,
} as const;

export const OidbGetGroupExtReqField = { groupCodes: 1, filter: 2 } as const;
export const OidbGroupExtFilterField = {
  inviteRobotMemberSwitch: 29,
  inviteRobotMemberExamine: 30,
} as const;

export const OidbGetGroupExtRespField = { items: 1 } as const;
export const OidbGetGroupExtItemField = { groupCode: 1, resultCode: 2, ext: 3 } as const;

export const OidbModifyGroupExtReqField = { groupCode: 1, info: 2 } as const;
export const OidbGroupExtInfoField = { groupCode: 1, ext: 2 } as const;

export const OidbModifyGroupExtRespField = { groupCode: 1, result: 2 } as const;

// ---------------------------------------------------------------------------
// 0xef0_1 — read
// ---------------------------------------------------------------------------

export interface OidbGroupExtFilter {
  /** `!== 0` rule: the reference sends 1, so the field is present. */
  inviteRobotMemberSwitch: number;
  inviteRobotMemberExamine: number;
}

export interface OidbGetGroupExtReq {
  /** repeated uint64, NON-packed. */
  groupCodes: bigint[];
  filter: OidbGroupExtFilter;
}

export function encodeOidbGroupExtFilter(filter: OidbGroupExtFilter): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbGroupExtFilterField.inviteRobotMemberSwitch, filter.inviteRobotMemberSwitch)
    .uint32(OidbGroupExtFilterField.inviteRobotMemberExamine, filter.inviteRobotMemberExamine)
    .finish();
}

export function encodeOidbGetGroupExtReq(body: OidbGetGroupExtReq): Uint8Array {
  return new ProtoWriter()
    .repeatedUint64(OidbGetGroupExtReqField.groupCodes, body.groupCodes)
    .message(OidbGetGroupExtReqField.filter, encodeOidbGroupExtFilter(body.filter))
    .finish();
}

/** `OidbGroupExtBody` as it arrives (decoder side, reference/index.mjs:223157). */
export interface OidbGroupExtBody {
  inviteRobotMemberSwitch?: number;
  inviteRobotMemberExamine?: number;
}

export interface OidbGetGroupExtItem {
  groupCode?: bigint;
  resultCode?: number;
  ext?: OidbGroupExtBody | undefined;
}

export interface OidbGetGroupExtResp {
  items: OidbGetGroupExtItem[];
}

export function decodeOidbGroupExtBody(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbGroupExtBody {
  const reader = new ProtoReader(data, offset, end);
  const body: OidbGroupExtBody = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbGroupExtBodyField.inviteRobotMemberSwitch, WireType.varint):
        body.inviteRobotMemberSwitch = reader.uint32();
        break;
      case tagOf(OidbGroupExtBodyField.inviteRobotMemberExamine, WireType.varint):
        body.inviteRobotMemberExamine = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return body;
}

export function decodeOidbGetGroupExtItem(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbGetGroupExtItem {
  const reader = new ProtoReader(data, offset, end);
  const item: OidbGetGroupExtItem = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbGetGroupExtItemField.groupCode, WireType.varint):
        item.groupCode = reader.uint64();
        break;
      case tagOf(OidbGetGroupExtItemField.resultCode, WireType.varint):
        item.resultCode = reader.uint32();
        break;
      case tagOf(OidbGetGroupExtItemField.ext, WireType.lengthDelimited):
        item.ext = reader.message(decodeOidbGroupExtBody);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return item;
}

export function decodeOidbGetGroupExtResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbGetGroupExtResp {
  const reader = new ProtoReader(data, offset, end);
  const response: OidbGetGroupExtResp = { items: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(OidbGetGroupExtRespField.items, WireType.lengthDelimited)) {
      response.items.push(reader.message(decodeOidbGetGroupExtItem));
    } else {
      reader.skip(unknown);
    }
  }
  return response;
}

/** The action-shaped answer (`get_group_robot_add_option`, reference/index.mjs:224058). */
export interface GroupRobotAddOption {
  robotMemberSwitch: number;
  robotMemberExamine: number;
}

/**
 * Flatten a fetch response the way the reference's `deserialize` does.
 *
 * Two hard failures, both plain `Error`s:
 *   * no `items[0]` at all
 *   * `items[0].resultCode` truthy and nonzero
 *
 * Then `?? 0` on each flag, so a server that omits the ext still yields a usable
 * pair rather than `undefined`.
 */
export function toGroupRobotAddOption(body: OidbGetGroupExtResp): GroupRobotAddOption {
  const item = body.items?.[0];
  if (!item) throw new Error("unable to read group robot-add option");
  if (item.resultCode && item.resultCode !== 0) {
    throw new Error(`unable to read group robot-add option: result=${item.resultCode}`);
  }
  return {
    robotMemberSwitch: item.ext?.inviteRobotMemberSwitch ?? 0,
    robotMemberExamine: item.ext?.inviteRobotMemberExamine ?? 0,
  };
}

export interface FetchGroupExtInfoParams {
  groupId: number | bigint;
}

export const FetchGroupExtInfo: OidbSpec<
  FetchGroupExtInfoParams,
  OidbGetGroupExtReq,
  OidbGetGroupExtResp,
  GroupRobotAddOption
> = {
  command: FETCH_GROUP_EXT_INFO_COMMAND,
  subCommand: FETCH_GROUP_EXT_INFO_SUB_COMMAND,
  uinForm: true,
  serialize: (params) => ({
    groupCodes: [BigInt(params.groupId)],
    // The filter asks for both fields by sending 1 for each; that is a selector,
    // not a value (reference/index.mjs:224050).
    filter: { inviteRobotMemberSwitch: 1, inviteRobotMemberExamine: 1 },
  }),
  encodeBody: encodeOidbGetGroupExtReq,
  decodeBody: decodeOidbGetGroupExtResp,
  deserialize: toGroupRobotAddOption,
};

// ---------------------------------------------------------------------------
// 0xf00_3 — write
// ---------------------------------------------------------------------------

/**
 * `OidbGroupExtBody` as it is WRITTEN.
 *
 * Both fields are optional because the reference builds `ext` from whichever
 * parameters it was given (reference/index.mjs:234041) and, crucially, wraps each
 * in a bare `!= null` test (:233665) so a supplied 0 is emitted.
 */
export interface OidbGroupExtBodyWrite {
  inviteRobotMemberSwitch?: number | undefined;
  inviteRobotMemberExamine?: number | undefined;
}

export interface OidbGroupExtInfo {
  /** The same group number again, as uint32. */
  groupCode: number;
  ext: OidbGroupExtBodyWrite;
}

export interface OidbModifyGroupExtReq {
  groupCode: number;
  info: OidbGroupExtInfo;
}

/**
 * Encode the writable `OidbGroupExtBody`.
 *
 * ⚠️ `!= null` on both fields — an explicit 0 reaches the wire. This is the
 * opposite of the fetch-side filter's rule, for the same message name; see the
 * header. Using `.uint32` here would drop the 0 and turn "switch off" into
 * "leave unchanged".
 */
export function encodeOidbGroupExtBodyWrite(body: OidbGroupExtBodyWrite): Uint8Array {
  return new ProtoWriter()
    .uint32Present(OidbGroupExtBodyField.inviteRobotMemberSwitch, body.inviteRobotMemberSwitch)
    .uint32Present(OidbGroupExtBodyField.inviteRobotMemberExamine, body.inviteRobotMemberExamine)
    .finish();
}

export function encodeOidbGroupExtInfo(info: OidbGroupExtInfo): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbGroupExtInfoField.groupCode, info.groupCode)
    // `_f1 != null`, so an empty ext still emits `12 00` — golden
    // `modifyext_none` pins that. This is a genuinely different request from
    // omitting field 2 entirely.
    .message(OidbGroupExtInfoField.ext, encodeOidbGroupExtBodyWrite(info.ext))
    .finish();
}

export function encodeOidbModifyGroupExtReq(body: OidbModifyGroupExtReq): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbModifyGroupExtReqField.groupCode, body.groupCode)
    .message(OidbModifyGroupExtReqField.info, encodeOidbGroupExtInfo(body.info))
    .finish();
}

/** `OidbModifyGroupExtResp` (reference/index.mjs:233931). */
export interface OidbModifyGroupExtResp {
  groupCode?: number;
  result?: number;
}

export function decodeOidbModifyGroupExtResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbModifyGroupExtResp {
  const reader = new ProtoReader(data, offset, end);
  const response: OidbModifyGroupExtResp = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbModifyGroupExtRespField.groupCode, WireType.varint):
        response.groupCode = reader.uint32();
        break;
      case tagOf(OidbModifyGroupExtRespField.result, WireType.varint):
        response.result = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return response;
}

export interface ModifyGroupExtInfoParams {
  groupId: number | bigint;
  /** Omitted means "leave unchanged"; 0 means "turn off". */
  robotMemberSwitch?: number | undefined;
  robotMemberExamine?: number | undefined;
}

/**
 * `serialize` (reference/index.mjs:234036) builds `ext` from the parameters that
 * are present and always emits both `groupCode`s.
 */
export function modifyGroupExtInfoSerialize(
  params: ModifyGroupExtInfoParams,
): OidbModifyGroupExtReq {
  const ext: OidbGroupExtBodyWrite = {};
  if (params.robotMemberSwitch !== undefined) ext.inviteRobotMemberSwitch = params.robotMemberSwitch;
  if (params.robotMemberExamine !== undefined) ext.inviteRobotMemberExamine = params.robotMemberExamine;
  const groupCode = Number(params.groupId);
  return { groupCode, info: { groupCode, ext } };
}

export const ModifyGroupExtInfo: OidbSpec<
  ModifyGroupExtInfoParams,
  OidbModifyGroupExtReq,
  OidbModifyGroupExtResp,
  void
> = {
  command: MODIFY_GROUP_EXT_INFO_COMMAND,
  subCommand: MODIFY_GROUP_EXT_INFO_SUB_COMMAND,
  uinForm: true,
  serialize: modifyGroupExtInfoSerialize,
  encodeBody: encodeOidbModifyGroupExtReq,
  decodeBody: decodeOidbModifyGroupExtResp,
  deserialize: (body) => {
    // Plain Error, not OidbError: the failure rides inside a successful envelope
    // (reference/index.mjs:234048).
    if (body.result && body.result !== 0) {
      throw new Error(`modifyGroupExtInfo failed: result=${body.result}`);
    }
  },
};