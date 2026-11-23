// OidbSvcTrpcTcp.0x1255_0 — move a friend into a 分组 (friend category/group).
//
// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------
// The batch brief calls 0x1255 a "stranger lookup".  It is `SetFriendCategory`
// (`command = 4693`, `subCommand = 0`, reference/index.mjs:74271-74272) and the
// only action on it is `set_friends_category` (reference/index.mjs:13490, handler
// at 74535).  There is no lookup on this command at all.
//
// Note also that **0x12b7 / 0x12b8 do not exist** anywhere in the bundle — no
// `_X.command = 4791` or `= 4792`.  Friend-分组 management is this single command;
// there is no sibling.  (Reading the 分组 list is a *different* command,
// `0xfd4_1` FetchFriendListPage, which returns `categories[]` alongside the
// friends — see 0xfd4.ts.)
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   OidbSetFriendCategoryRequest  reference/index.mjs:74090 / 74107 (write)
//     1 uid        string
//     2 categoryId uint32
//
// ⚠️ The target is a **uid string**, resolved from the uin by the caller
// (`reference/index.mjs:74515`: it looks the friend up in the live roster and
// throws when the roster has no uid).  The action accepts `categoryId` or
// `categoryName`; name→id resolution is the caller's job because the names come
// from the `0xfd4_1` category list, not from this command.
//
// ⚠️ `acceptedEnvelopeCodes = [2001002]`.  That code means "already applied" —
// moving a friend to the category it is already in.  Treating it as a failure
// (the default in invokeOidb) would make an idempotent call look broken.  This is
// one of only a handful of commands in the whole bundle that carries the field.
//
// ⚠️ `uinForm: true`, so the envelope sends `reserved: 1`.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 4693 = 0x1255. */
export const SET_FRIEND_CATEGORY_COMMAND = 0x1255;

export const SET_FRIEND_CATEGORY_SUB_COMMAND = 0;

/** Envelope code 2001002 = "the move is already in effect"; not a failure. */
export const FRIEND_CATEGORY_ALREADY_APPLIED = 2001002;

export const ACCEPTED_FRIEND_CATEGORY_CODES: readonly number[] = [FRIEND_CATEGORY_ALREADY_APPLIED];

export const SetFriendCategoryField = { uid: 1, categoryId: 2 } as const;

export interface SetFriendCategoryReq {
  uid: string;
  categoryId: number;
}

export function encodeSetFriendCategoryReq(body: SetFriendCategoryReq): Uint8Array {
  return new ProtoWriter()
    .string(SetFriendCategoryField.uid, body.uid)
    .uint32(SetFriendCategoryField.categoryId, body.categoryId)
    .finish();
}

/**
 * The reference's response type is the request message itself
 * (reference/index.mjs:74280: `decode = protobuf_decode_OidbBase__OidbSetFriendCategoryRequest`)
 * and `deserialize` returns `undefined`, so only the codec shape is needed here.
 */
export interface SetFriendCategoryResp {
  uid: string;
  categoryId: number;
}

export function decodeSetFriendCategoryReq(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): SetFriendCategoryResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: SetFriendCategoryResp = { uid: "", categoryId: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(SetFriendCategoryField.uid, WireType.lengthDelimited):
        resp.uid = reader.string();
        break;
      case tagOf(SetFriendCategoryField.categoryId, WireType.varint):
        resp.categoryId = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export interface SetFriendCategoryParams {
  /** The friend's uid (not uin) — see the header. */
  uid: string;
  categoryId: number;
}

export const SetFriendCategory: OidbSpec<
  SetFriendCategoryParams,
  SetFriendCategoryReq,
  SetFriendCategoryResp,
  void
> = {
  command: SET_FRIEND_CATEGORY_COMMAND,
  subCommand: SET_FRIEND_CATEGORY_SUB_COMMAND,
  uinForm: true,
  acceptedEnvelopeCodes: ACCEPTED_FRIEND_CATEGORY_CODES,
  serialize: (params) => ({ uid: params.uid, categoryId: params.categoryId }),
  encodeBody: encodeSetFriendCategoryReq,
  decodeBody: decodeSetFriendCategoryReq,
  deserialize: () => undefined,
};