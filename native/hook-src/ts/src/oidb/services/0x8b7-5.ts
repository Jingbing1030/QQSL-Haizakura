// OidbSvcTrpcTcp.0x8b7_5 — group share card (ark), and
// OidbSvcTrpcTcp.0x12b6_0 — friend share card (ark).
//
// ---------------------------------------------------------------------------
// What they do
// ---------------------------------------------------------------------------
// Both fetch a JSON "ark" card: the little rich preview that QQ renders for a
// shared group or contact.  The request identifies the subject; the response's
// single string field is the card JSON, which the caller forwards to an
// ark-sending action.
//
// The two commands are the same *operation* on two *subjects*, which is why the
// action list overlaps almost completely:
//
//   0x8b7_5  (9 actions): send_custom_face, send_msg, send_private_msg,
//            send_group_msg, upload_private_file, share_peer, send_ark_share,
//            share_group_ex, send_group_ark_share
//   0x12b6_0 (7 actions): the same list minus share_group_ex and
//            send_group_ark_share
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   0x8b7_5 request   OidbGroupRecommendArkReq, reference/index.mjs:70012
//                       1 reqType    uint32
//                       2 groupCode  uint64
//                       5 flag       uint32
//   0x8b7_5 response  OidbGroupRecommendArkResp, reference/index.mjs:70316
//                       1 errCode    uint32
//                       5 arkJson    string
//   0x12b6_0 request  OidbBuddyRecommendArkReq, reference/index.mjs:68954
//                       1 uin          uint64
//                       2 phoneNumber  string
//                       3 jumpUrl      string
//   0x12b6_0 response OidbBuddyRecommendArkResp, reference/index.mjs:69263
//                       1 ark          string
//
// Note the asymmetry: 0x12b6_0's response field 1 is the card itself, while
// 0x8b7_5's field 1 is an error code and the card is field 5.  Reading field 1
// as a string in both would yield "" for every group card.
//
// ---------------------------------------------------------------------------
// The `reserved` bit differs between the two
// ---------------------------------------------------------------------------
// 0x8b7_5 carries `uinForm: true` (reference/index.mjs:70385) and 0x12b6_0
// does not (reference/index.mjs:69310).  That is not cosmetic: it flips how the
// server reads the subject field.  They are split into two spec objects here
// rather than one parameterised spec precisely because of that bit.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

// ---------------------------------------------------------------------------
// 0x8b7_5 — GetGroupRecommendArk
// ---------------------------------------------------------------------------

export const GET_GROUP_RECOMMEND_ARK_COMMAND = 0x8b7;

export const GroupRecommendArkReqField = { reqType: 1, groupCode: 2, flag: 5 } as const;

export const GroupRecommendArkRespField = { errCode: 1, arkJson: 5 } as const;

export interface GroupRecommendArkReq {
  reqType: number;
  groupCode: bigint;
  flag: number;
}

export interface GroupRecommendArkResp {
  errCode: number;
  arkJson: string;
}

export function encodeGroupRecommendArkReq(body: GroupRecommendArkReq): Uint8Array {
  return new ProtoWriter()
    .uint32(GroupRecommendArkReqField.reqType, body.reqType)
    .uint64(GroupRecommendArkReqField.groupCode, body.groupCode)
    .uint32(GroupRecommendArkReqField.flag, body.flag)
    .finish();
}

export function decodeGroupRecommendArkResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupRecommendArkResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: GroupRecommendArkResp = { errCode: 0, arkJson: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupRecommendArkRespField.errCode, WireType.varint):
        resp.errCode = reader.uint32();
        break;
      case tagOf(GroupRecommendArkRespField.arkJson, WireType.lengthDelimited):
        resp.arkJson = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export interface GroupRecommendArkParams {
  groupId: number | bigint;
}

/**
 * GetGroupRecommendArk spec.
 *
 * `reqType: 1, flag: 1` are the values the reference hard-codes
 * (reference/index.mjs:70386) — they select the "group card" variant of the
 * ark, so they are not exposed as action parameters.
 */
export const GetGroupRecommendArk: OidbSpec<
  GroupRecommendArkParams,
  GroupRecommendArkReq,
  GroupRecommendArkResp,
  string
> = {
  command: GET_GROUP_RECOMMEND_ARK_COMMAND,
  subCommand: 5,
  uinForm: true,
  serialize: (params) => ({ reqType: 1, groupCode: BigInt(params.groupId), flag: 1 }),
  encodeBody: encodeGroupRecommendArkReq,
  decodeBody: decodeGroupRecommendArkResp,
  deserialize: (body) => body.arkJson ?? "",
};

// ---------------------------------------------------------------------------
// 0x12b6_0 — GetBuddyRecommendArk
// ---------------------------------------------------------------------------

export const GET_BUDDY_RECOMMEND_ARK_COMMAND = 0x12b6;

export const BuddyRecommendArkReqField = { uin: 1, phoneNumber: 2, jumpUrl: 3 } as const;

export const BuddyRecommendArkRespField = { ark: 1 } as const;

export interface BuddyRecommendArkReq {
  uin: bigint;
  phoneNumber: string;
  jumpUrl: string;
}

export interface BuddyRecommendArkResp {
  ark: string;
}

export function encodeBuddyRecommendArkReq(body: BuddyRecommendArkReq): Uint8Array {
  return new ProtoWriter()
    .uint64(BuddyRecommendArkReqField.uin, body.uin)
    .string(BuddyRecommendArkReqField.phoneNumber, body.phoneNumber)
    .string(BuddyRecommendArkReqField.jumpUrl, body.jumpUrl)
    .finish();
}

export function decodeBuddyRecommendArkResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): BuddyRecommendArkResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: BuddyRecommendArkResp = { ark: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(BuddyRecommendArkRespField.ark, WireType.lengthDelimited):
        resp.ark = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export interface BuddyRecommendArkParams {
  userId: number | bigint;
  phoneNumber?: string;
}

/**
 * Build the card's `jumpUrl`.
 *
 * The reference hard-codes this template with the uin interpolated twice
 * (reference/index.mjs:69312).  It looks redundant but both copies are load-
 * bearing: `uin=` selects the card and `source=sharecard` selects the renderer.
 */
export function buddyRecommendArkJumpUrl(userId: number | bigint): string {
  return `mqqapi://card/show_pslcard?src_type=internal&source=sharecard&version=1&uin=${userId}`;
}

/**
 * GetBuddyRecommendArk spec.
 *
 * `phoneNumber` defaults to "-" — a literal hyphen.  The server rejects an
 * empty string here, and the client is not supposed to know the real number.
 */
export const GetBuddyRecommendArk: OidbSpec<
  BuddyRecommendArkParams,
  BuddyRecommendArkReq,
  BuddyRecommendArkResp,
  string
> = {
  command: GET_BUDDY_RECOMMEND_ARK_COMMAND,
  subCommand: 0,
  uinForm: false,
  serialize: (params) => ({
    uin: BigInt(params.userId),
    phoneNumber: params.phoneNumber || "-",
    jumpUrl: buddyRecommendArkJumpUrl(params.userId),
  }),
  encodeBody: encodeBuddyRecommendArkReq,
  decodeBody: decodeBuddyRecommendArkResp,
  deserialize: (body) => body.ark ?? "",
};