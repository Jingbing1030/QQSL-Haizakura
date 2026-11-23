// The friend-request family — 0xd69_0 (two shapes), 0xd72_0, 0xb5d_44.
//
// ---------------------------------------------------------------------------
// Which command is which
// ---------------------------------------------------------------------------
// All four labels in the brief were right, and — unusually — two of them are not
// even the same command:
//
//   GetDoubtBuddyReq      0xd69  (3433)  sub 0  uinForm=true   list  (可能认识的人)
//   RejectDoubtBuddyReq   0xd69  (3433)  sub 0  uinForm=true   delete one
//   ApproveDoubtBuddyReq  0xd72  (3442)  sub 0  uinForm=false  accept one
//   HandleFriendRequest   0xb5d  (2909)  sub 44               accept/reject a
//                                                             normal add request
//
// ⚠️ `GetDoubtBuddyReq` and `RejectDoubtBuddyReq` share **command AND sub AND
// uinForm** and still carry different messages (`OidbDoubtGetReq` vs
// `OidbDoubtDelReq`). They are told apart only by the `field1` value inside the
// body (1 for "list", 3 for "delete"), which is a discriminator the server reads.
// The port keeps them as two specs, because a shared codec would have to encode
// one message as the other.
//
// ⚠️ And `ApproveDoubtBuddyReq` is the odd one out: same *concept*, but on a
// different command, with `uinForm = false` where the other two have `true`.
// Grouping by "the doubt-request commands" would therefore put a `reserved=0`
// envelope on a call the server expects `reserved=1` on, or vice versa.
//
// `HandleFriendRequest` is a third thing entirely: the ordinary inbound friend
// add, on 0xb5d with sub-command **44** (not 0), `uinForm` unset. Its body is a
// two-field message — `accept` 3 for approve / 5 for reject, and the applicant's
// uid.
//
// ---------------------------------------------------------------------------
// Field-number surprises
// ---------------------------------------------------------------------------
//   OidbDoubtGetReq       1 field1(uint32 const 1), 2 inner
//     OidbDoubtGetReqInner 1 num, 2 uk      -- the cursor is called `uk`
//
//   OidbDoubtDelReq       1 field1(uint32 const 3), **3 inner**   -- field 2 skipped
//     OidbDoubtDelReqInner 1 uid
//     Note the parallel: list uses sub-message field **2**, delete uses **3**.
//     A copy-paste between them is a silent no-op, since an unknown field is
//     skipped by the server rather than rejected.
//
//   OidbDoubtApprovalReq  1 selfUid, 2 targetUid, **3 field3(uint32 const 0),
//                         4 field4(string const "")**
//     Fields 3 and 4 use the **bare `!= null`** guard, so the explicit 0 and the
//     empty string ARE written (`1800 2200` appears in the golden). That is the
//     opposite of the usual "drop when zero" rule and is the reason this request
//     is 8 bytes longer than a "clean" version would be. Building it with a
//     generic zero-dropping writer produces a body the server treats as a
//     different, malformed request.
//
//   OidbFriendRequestAction  1 accept, 2 targetUid
//     `accept` is 3 for approve and 5 for reject — not 1/2, and not a bool.
//
// ---------------------------------------------------------------------------
// The response is decoded TWICE, and the second pass exists to recover a uin
// ---------------------------------------------------------------------------
// `GetDoubtBuddyReq.decode` (reference/index.mjs:200286) runs the body through
// **two different decoders** over the same bytes:
//
//     protobuf_decode_OidbDoubtGetResp                 -> body.list[].uid etc.
//     protobuf_decode_OidbDoubtGetRespAccountOnTag1     -> body.list[].uin
//
// and then copies `uin` from the second pass onto the first pass's items **by
// index**. That is not defensive coding: the uin lives at field **1** of
// `OidbDoubtItemAccountOnTag1`, but field 1 of `OidbDoubtItem` is the **uid
// string**. One message number, two incompatible readings, both present in the
// same response. So `uin` is recovered positionally, and if the two lists ever
// disagreed in length the pairing would be wrong — the reference accepts that
// risk, and so does this port, because there is no other channel for the uin.
//
// Zero-valued uins are therefore genuinely `0` and `deserialize` maps
// `it.uin ?? 0` — an absent second-pass entry yields 0, not an error.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";
import { decodeOidbEmpty, type OidbEmpty } from "./0x89a-0.js";

// ---------------------------------------------------------------------------
// Command numbers
// ---------------------------------------------------------------------------

/** 3433 = 0xd69 — doubt-request list and doubt-request delete. */
export const DOUBT_BUDDY_COMMAND = 0xd69;
/** 3442 = 0xd72 — doubt-request approve. */
export const APPROVE_DOUBT_BUDDY_COMMAND = 0xd72;
/** 2909 = 0xb5d — ordinary friend-request action. */
export const HANDLE_FRIEND_REQUEST_COMMAND = 0xb5d;

/** All three doubt specs declare sub-command 0, and so does the friend action's list half. */
export const DOUBT_BUDDY_SUB_COMMAND = 0;
export const APPROVE_DOUBT_BUDDY_SUB_COMMAND = 0;
/** ⚠️ 44, not 0: `HandleFriendRequest.subCommand = 44` (reference/index.mjs:201291). */
export const HANDLE_FRIEND_REQUEST_SUB_COMMAND = 44;

/** `OidbDoubtGetReq.field1` — the "list" discriminator. */
export const DOUBT_GET_OP = 1;
/** `OidbDoubtDelReq.field1` — the "delete" discriminator. */
export const DOUBT_DEL_OP = 3;

/**
 * `OidbFriendRequestAction.accept`: **3** approves, **5** rejects.
 *
 * Neither value is 0 or 1, so a caller that guesses "1 = accept" produces a
 * request the server interprets as neither. The reference hard-codes both
 * (reference/index.mjs:201294 `accept: p.approve ? 3 : 5`).
 */
export const FRIEND_REQUEST_ACCEPT = 3;
export const FRIEND_REQUEST_REJECT = 5;

// ---------------------------------------------------------------------------
// Field tables
// ---------------------------------------------------------------------------

export const OidbDoubtGetReqField = { field1: 1, inner: 2 } as const;
export const OidbDoubtGetReqInnerField = { num: 1, uk: 2 } as const;

export const OidbDoubtDelReqField = { field1: 1, inner: 3 } as const;
export const OidbDoubtDelReqInnerField = { uid: 1 } as const;

export const OidbDoubtApprovalReqField = {
  selfUid: 1,
  targetUid: 2,
  field3: 3,
  field4: 4,
} as const;

export const OidbFriendRequestActionField = { accept: 1, targetUid: 2 } as const;

export const OidbDoubtItemField = {
  uid: 1,
  nick: 2,
  age: 3,
  sex: 4,
  msg: 5,
  source: 6,
  reason: 7,
  reqTime: 8,
  groupCode: 9,
  commFriendNum: 10,
} as const;

/**
 * The second reading of the same list: `OidbDoubtItemAccountOnTag1` is
 * `{ 1 uin uint64 }`, and its field 1 is the item's uin where `OidbDoubtItem`'s
 * field 1 is the uid string.
 */
export const OidbDoubtItemAccountOnTag1Field = { uin: 1 } as const;

export const OidbDoubtGetRespField = { status: 1, body: 2 } as const;
export const OidbDoubtGetRespBodyField = { list: 1, reason: 2 } as const;
/** The uin-only envelope's body repeats `OidbDoubtItemAccountOnTag1` at field 1. */
export const OidbDoubtGetRespAccountOnTag1BodyField = { list: 1 } as const;

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export interface OidbDoubtGetReqInner {
  num: number;
  /** The pagination cursor; empty on the first call and dropped by the writer. */
  uk: string;
}

export interface OidbDoubtGetReq {
  /** Always `DOUBT_GET_OP` (1). */
  field1: number;
  inner: OidbDoubtGetReqInner;
}

export function encodeOidbDoubtGetReqInner(inner: OidbDoubtGetReqInner): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbDoubtGetReqInnerField.num, inner.num)
    .string(OidbDoubtGetReqInnerField.uk, inner.uk)
    .finish();
}

export function encodeOidbDoubtGetReq(body: OidbDoubtGetReq): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbDoubtGetReqField.field1, body.field1)
    .message(OidbDoubtGetReqField.inner, encodeOidbDoubtGetReqInner(body.inner))
    .finish();
}

export interface OidbDoubtDelReqInner {
  uid: string;
}

export interface OidbDoubtDelReq {
  /** Always `DOUBT_DEL_OP` (3). */
  field1: number;
  inner: OidbDoubtDelReqInner;
}

export function encodeOidbDoubtDelReqInner(inner: OidbDoubtDelReqInner): Uint8Array {
  return new ProtoWriter().string(OidbDoubtDelReqInnerField.uid, inner.uid).finish();
}

export function encodeOidbDoubtDelReq(body: OidbDoubtDelReq): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbDoubtDelReqField.field1, body.field1)
    // ⚠️ field **3**, not 2 — the sibling list request puts its sub-message at 2.
    .message(OidbDoubtDelReqField.inner, encodeOidbDoubtDelReqInner(body.inner))
    .finish();
}

export interface OidbDoubtApprovalReq {
  selfUid: string;
  targetUid: string;
  /** Bare `!= null`: an explicit 0 IS written. Always 0 in `serialize`. */
  field3: number;
  /** Bare `!= null`: an empty string IS written. Always "" in `serialize`. */
  field4: string;
}

export function encodeOidbDoubtApprovalReq(body: OidbDoubtApprovalReq): Uint8Array {
  return new ProtoWriter()
    .string(OidbDoubtApprovalReqField.selfUid, body.selfUid)
    .string(OidbDoubtApprovalReqField.targetUid, body.targetUid)
    // These two need the `present` variants: the reference's guards are `_f != null`
    // with no `!== 0` / `!== ""` clause, so zero and empty are VALUES, not absence.
    .uint32Present(OidbDoubtApprovalReqField.field3, body.field3)
    .stringPresent(OidbDoubtApprovalReqField.field4, body.field4)
    .finish();
}

export interface OidbFriendRequestAction {
  /** 3 = accept, 5 = reject. */
  accept: number;
  targetUid: string;
}

export function encodeOidbFriendRequestAction(body: OidbFriendRequestAction): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbFriendRequestActionField.accept, body.accept)
    .string(OidbFriendRequestActionField.targetUid, body.targetUid)
    .finish();
}

// ---------------------------------------------------------------------------
// Response bodies
// ---------------------------------------------------------------------------

/** One doubtful friend-add request, as `OidbDoubtItem` decodes it. */
export interface OidbDoubtItem {
  uid: string | null;
  nick: string | null;
  age: number | null;
  sex: number | null;
  msg: string | null;
  source: string | null;
  reason: string | null;
  /** uint64. */
  reqTime: bigint | null;
  /** uint64. `deserialize` stringifies it when nonzero. */
  groupCode: bigint | null;
  commFriendNum: number | null;
  /**
   * NOT decoded from this message — field 1 here is the uid. Populated by the
   * second decoding pass; see the header comment.
   */
  uin?: bigint | null;
}

export function decodeOidbDoubtItem(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbDoubtItem {
  const reader = new ProtoReader(data, offset, end);
  const item: OidbDoubtItem = {
    uid: null,
    nick: null,
    age: null,
    sex: null,
    msg: null,
    source: null,
    reason: null,
    reqTime: null,
    groupCode: null,
    commFriendNum: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbDoubtItemField.uid, WireType.lengthDelimited):
        item.uid = reader.string();
        break;
      case tagOf(OidbDoubtItemField.nick, WireType.lengthDelimited):
        item.nick = reader.string();
        break;
      case tagOf(OidbDoubtItemField.age, WireType.varint):
        item.age = reader.uint32();
        break;
      case tagOf(OidbDoubtItemField.sex, WireType.varint):
        item.sex = reader.uint32();
        break;
      case tagOf(OidbDoubtItemField.msg, WireType.lengthDelimited):
        item.msg = reader.string();
        break;
      case tagOf(OidbDoubtItemField.source, WireType.lengthDelimited):
        item.source = reader.string();
        break;
      case tagOf(OidbDoubtItemField.reason, WireType.lengthDelimited):
        item.reason = reader.string();
        break;
      case tagOf(OidbDoubtItemField.reqTime, WireType.varint):
        item.reqTime = reader.uint64();
        break;
      case tagOf(OidbDoubtItemField.groupCode, WireType.varint):
        item.groupCode = reader.uint64();
        break;
      case tagOf(OidbDoubtItemField.commFriendNum, WireType.varint):
        item.commFriendNum = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return item;
}

export interface OidbDoubtGetRespBody {
  list: OidbDoubtItem[];
  reason: string | null;
}

export interface OidbDoubtGetResp {
  status: number | null;
  body: OidbDoubtGetRespBody | null;
}

export function decodeOidbDoubtGetRespBody(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbDoubtGetRespBody {
  const reader = new ProtoReader(data, offset, end);
  const body: OidbDoubtGetRespBody = { list: [], reason: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbDoubtGetRespBodyField.list, WireType.lengthDelimited):
        body.list.push(reader.message(decodeOidbDoubtItem));
        break;
      case tagOf(OidbDoubtGetRespBodyField.reason, WireType.lengthDelimited):
        body.reason = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return body;
}

export function decodeOidbDoubtGetResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbDoubtGetResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: OidbDoubtGetResp = { status: null, body: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbDoubtGetRespField.status, WireType.varint):
        resp.status = reader.uint32();
        break;
      case tagOf(OidbDoubtGetRespField.body, WireType.lengthDelimited):
        resp.body = reader.message(decodeOidbDoubtGetRespBody);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

/** One `{ 1 uin }` entry from the second reading. */
export interface OidbDoubtItemAccountOnTag1 {
  uin: bigint | null;
}

export function decodeOidbDoubtItemAccountOnTag1(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbDoubtItemAccountOnTag1 {
  const reader = new ProtoReader(data, offset, end);
  const item: OidbDoubtItemAccountOnTag1 = { uin: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(OidbDoubtItemAccountOnTag1Field.uin, WireType.varint)) {
      item.uin = reader.uint64();
    } else {
      reader.skip(unknown);
    }
  }
  return item;
}

export interface OidbDoubtGetRespAccountOnTag1Body {
  list: OidbDoubtItemAccountOnTag1[];
}

export interface OidbDoubtGetRespAccountOnTag1 {
  status: number | null;
  body: OidbDoubtGetRespAccountOnTag1Body | null;
}

export function decodeOidbDoubtGetRespAccountOnTag1Body(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbDoubtGetRespAccountOnTag1Body {
  const reader = new ProtoReader(data, offset, end);
  const body: OidbDoubtGetRespAccountOnTag1Body = { list: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(OidbDoubtGetRespAccountOnTag1BodyField.list, WireType.lengthDelimited)) {
      body.list.push(reader.message(decodeOidbDoubtItemAccountOnTag1));
    } else {
      reader.skip(unknown);
    }
  }
  return body;
}

export function decodeOidbDoubtGetRespAccountOnTag1(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbDoubtGetRespAccountOnTag1 {
  const reader = new ProtoReader(data, offset, end);
  const resp: OidbDoubtGetRespAccountOnTag1 = { status: null, body: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbDoubtGetRespField.status, WireType.varint):
        resp.status = reader.uint32();
        break;
      case tagOf(OidbDoubtGetRespField.body, WireType.lengthDelimited):
        resp.body = reader.message(decodeOidbDoubtGetRespAccountOnTag1Body);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

/**
 * Merge the uin-only reading into the full reading, by index.
 *
 * Copied from `GetDoubtBuddyReq.decode` (reference/index.mjs:200288-200295).
 * The pairing is positional and the reference makes no attempt to match by uid,
 * because the second message carries nothing else. Kept as a separate function so
 * the risk is visible at the call site.
 */
export function mergeDoubtAccountOnTag1(
  resp: OidbDoubtGetResp,
  numeric: OidbDoubtGetRespAccountOnTag1,
): OidbDoubtGetResp {
  const items = resp.body?.list ?? [];
  const numericItems = numeric.body?.list ?? [];
  for (let i = 0; i < items.length; i++) items[i]!.uin = numericItems[i]?.uin ?? null;
  return resp;
}

// ---------------------------------------------------------------------------
// Business result
// ---------------------------------------------------------------------------

/** One doubtful request, after `deserialize` normalises it to OneBot's spelling. */
export interface DoubtRequest {
  uid: string;
  user_id: number;
  nick: string;
  source: string;
  reason: string;
  msg: string;
  /** `""` when absent, otherwise the decimal string — the reference keeps it a string. */
  group_code: string;
  reqTime: number;
}

/**
 * The reference's `GetDoubtBuddyReq.deserialize` (reference/index.mjs:200279).
 *
 * `group_code` is `it.groupCode ? String(it.groupCode) : ""` — a **truthiness**
 * test on a bigint, so a group code of 0 and an absent group code agree on `""`.
 * `reqTime` goes through `Number()` and loses precision above 2^53 exactly like
 * the reference does.
 */
export function toDoubtRequests(resp: OidbDoubtGetResp): DoubtRequest[] {
  // `invokeOidb` hands `deserialize` the envelope's `.body`, which for this
  // command IS the `{ status, body }` message — so the list is one level down.
  const list = resp.body?.list ?? [];
  return list.map((it) => ({
    uid: it.uid ?? "",
    user_id: Number(it.uin ?? 0),
    nick: it.nick ?? "",
    source: it.source ?? "",
    reason: it.reason ?? "",
    msg: it.msg ?? "",
    group_code: it.groupCode ? String(it.groupCode) : "",
    reqTime: Number(it.reqTime ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export interface GetDoubtBuddyReqParams {
  count: number;
  /** Continuation cursor; omitted on the first page. */
  cookie?: string | undefined;
}

export const GetDoubtBuddyReq: OidbSpec<
  GetDoubtBuddyReqParams,
  OidbDoubtGetReq,
  OidbDoubtGetResp,
  DoubtRequest[]
> = {
  command: DOUBT_BUDDY_COMMAND,
  subCommand: DOUBT_BUDDY_SUB_COMMAND,
  uinForm: true,
  serialize: (params) => ({
    field1: DOUBT_GET_OP,
    inner: { num: params.count, uk: params.cookie ?? "" },
  }),
  encodeBody: encodeOidbDoubtGetReq,
  // The double decode lives in the spec, exactly as it does in the reference.
  decodeBody: (data, offset = 0, end = data.length) => {
    const decoded = decodeOidbDoubtGetResp(data, offset, end);
    const numeric = decodeOidbDoubtGetRespAccountOnTag1(data, offset, end);
    return mergeDoubtAccountOnTag1(decoded, numeric);
  },
  deserialize: toDoubtRequests,
};

export interface RejectDoubtBuddyReqParams {
  /** The applicant's uid — NOT a digit-only account number; resolve it first. */
  uid: string;
}

export const RejectDoubtBuddyReq: OidbSpec<
  RejectDoubtBuddyReqParams,
  OidbDoubtDelReq,
  OidbEmpty,
  void
> = {
  command: DOUBT_BUDDY_COMMAND,
  subCommand: DOUBT_BUDDY_SUB_COMMAND,
  uinForm: true,
  serialize: (params) => ({ field1: DOUBT_DEL_OP, inner: { uid: params.uid } }),
  encodeBody: encodeOidbDoubtDelReq,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

export interface ApproveDoubtBuddyReqParams {
  /** The applicant's uid. */
  uid: string;
  /** The caller's own uid; resolved from the identity roster before the call. */
  selfUid: string;
}

export const ApproveDoubtBuddyReq: OidbSpec<
  ApproveDoubtBuddyReqParams,
  OidbDoubtApprovalReq,
  OidbEmpty,
  void
> = {
  command: APPROVE_DOUBT_BUDDY_COMMAND,
  subCommand: APPROVE_DOUBT_BUDDY_SUB_COMMAND,
  // ⚠️ false, where the other two doubt commands are true.
  uinForm: false,
  serialize: (params) => {
    // The reference validates BOTH uids and throws rather than send a request
    // that names an empty applicant (`serialize`, reference/index.mjs:195970).
    if (!params.uid.trim()) {
      throw new Error("cannot approve doubt request: applicant uid is unavailable");
    }
    if (!params.selfUid.trim()) {
      throw new Error("cannot approve doubt request: self uid is unavailable");
    }
    return { selfUid: params.selfUid, targetUid: params.uid, field3: 0, field4: "" };
  },
  encodeBody: encodeOidbDoubtApprovalReq,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

export interface HandleFriendRequestParams {
  /** Either a pre-resolved uid or a digit-only account number. */
  uidOrFlag: string;
  approve: boolean;
}

export const HandleFriendRequest: OidbSpec<
  HandleFriendRequestParams,
  OidbFriendRequestAction,
  OidbEmpty,
  void
> = {
  command: HANDLE_FRIEND_REQUEST_COMMAND,
  subCommand: HANDLE_FRIEND_REQUEST_SUB_COMMAND,
  serialize: (params) => ({
    accept: params.approve ? FRIEND_REQUEST_ACCEPT : FRIEND_REQUEST_REJECT,
    targetUid: params.uidOrFlag,
  }),
  encodeBody: encodeOidbFriendRequestAction,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

/**
 * Resolve a "uid or flag" argument the way both doubt specs require.
 *
 * `resolveDoubtFlag` (reference/index.mjs:203977) and the first line of
 * `HandleFriendRequest.serialize` (:201291) apply the same rule: a **digit-only**
 * string is an account number and must go through uid resolution; anything else
 * is already a uid and is passed through untouched.
 *
 * This is async and takes the resolver as an argument so the codec module stays
 * free of any dependency on the bridge context.
 */
export async function resolveFriendTarget(
  uidOrFlag: string,
  resolveUid: (uin: number) => Promise<string> | string,
): Promise<string> {
  if (!/^\d+$/.test(uidOrFlag)) return uidOrFlag;
  return Promise.resolve(resolveUid(parseInt(uidOrFlag, 10)));
}