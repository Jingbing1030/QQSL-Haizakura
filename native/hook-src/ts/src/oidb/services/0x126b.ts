// OidbSvcTrpcTcp.0x126b_0 — delete a friend (`delete_friend`).
//
// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------
// The batch brief calls 0x126b a "profile card fetch".  It is `DeleteFriend`
// (`command = 4715`, `subCommand = 0`, reference/index.mjs:198275-198276) and the
// only action on it is `delete_friend` (reference/index.mjs:8397, handler at 203919
// → `ctx.bridge.apis.friend.deleteFriend(userId, block)`).  The profile-card
// family is 0xfe1_2 instead — see 0xfe1.ts.
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   OidbDeleteFriend             reference/index.mjs:197937 / 197950 (write)
//     1 field1 -> OidbDeleteFriendField1
//   OidbDeleteFriendField1       reference/index.mjs:197979 / 198003 (write)
//     1 targetUid string
//     2 field2    -> OidbDeleteFriendField2
//     3 block     uint32   **written even when false**
//     4 field4    uint32   `=== true`, always 1
//   OidbDeleteFriendField2       reference/index.mjs:198069 / 198094 (write)
//     1 field1 uint32 (constant 130)
//     2 field2 uint32 (constant 109)
//     3 field3 -> OidbDeleteFriendField2Field3
//   OidbDeleteFriendField2Field3 reference/index.mjs:198173 / 198195 (write)
//     1 field1 uint32 (constant 8)
//     2 field2 uint32 (constant 8)
//     3 field3 uint32 (constant 50)
//
// ⚠️ `block` is the one field here with a `!= null` guard rather than
// `!= null && !== 0`.  Because `serialize` always supplies `p.block ?? false`,
// the field is *always* present — `false` goes on the wire as `18 00`.  Dropping
// it (the ordinary uint32 rule) would remove two bytes and change the request's
// meaning from "do not block" to "block unspecified".  The goldens pin both
// cases: `deletefriend` ends `...3218002001`, `deletefriend_block` ends
// `...3218012001`.
//
// ⚠️ The `field2/field3` numbers (130, 109, 8, 8, 50) look like a version stamp
// rather than data.  They are copied literally from `serialize`
// (reference/index.mjs:198281-198290) — there is no named constant for them in the
// bundle, so nothing here is reinterpretable.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 4715 = 0x126b. */
export const DELETE_FRIEND_COMMAND = 0x126b;

export const DELETE_FRIEND_SUB_COMMAND = 0;

export const DeleteFriendField = { field1: 1 } as const;
export const DeleteFriendField1Field = {
  targetUid: 1,
  field2: 2,
  block: 3,
  field4: 4,
} as const;
export const DeleteFriendField2Field = { field1: 1, field2: 2, field3: 3 } as const;
export const DeleteFriendField2Field3Field = { field1: 1, field2: 2, field3: 3 } as const;

/** The constants `serialize` hard-codes (reference/index.mjs:198281-198290). */
export const DELETE_FRIEND_STAMP = {
  field2: { field1: 130, field2: 109, field3: { field1: 8, field2: 8, field3: 50 } },
} as const;

export interface DeleteFriendStamp {
  field1: number;
  field2: number;
  field3: number;
}

export interface DeleteFriendField2 {
  field1: number;
  field2: number;
  field3: DeleteFriendStamp;
}

export interface DeleteFriendField1 {
  targetUid: string;
  field2: DeleteFriendField2;
  block: boolean;
  field4: boolean;
}

export interface DeleteFriendReq {
  field1: DeleteFriendField1;
}

export function encodeDeleteFriendStamp(s: DeleteFriendStamp): Uint8Array {
  return new ProtoWriter()
    .uint32(DeleteFriendField2Field3Field.field1, s.field1)
    .uint32(DeleteFriendField2Field3Field.field2, s.field2)
    .uint32(DeleteFriendField2Field3Field.field3, s.field3)
    .finish();
}

export function encodeDeleteFriendField2(f: DeleteFriendField2): Uint8Array {
  return new ProtoWriter()
    .uint32(DeleteFriendField2Field.field1, f.field1)
    .uint32(DeleteFriendField2Field.field2, f.field2)
    .message(DeleteFriendField2Field.field3, encodeDeleteFriendStamp(f.field3))
    .finish();
}

/**
 * Encode `OidbDeleteFriendField1`.
 *
 * `block` uses `uint32Present` (the `!= null` rule) and is passed as `block ? 1 : 0`,
 * which reproduces the reference's `buf[offset++] = _f2 ? 1 : 0`.
 */
export function encodeDeleteFriendField1(f: DeleteFriendField1): Uint8Array {
  return new ProtoWriter()
    .string(DeleteFriendField1Field.targetUid, f.targetUid)
    .message(DeleteFriendField1Field.field2, encodeDeleteFriendField2(f.field2))
    .uint32Present(DeleteFriendField1Field.block, f.block ? 1 : 0)
    .bool(DeleteFriendField1Field.field4, f.field4)
    .finish();
}

export function encodeDeleteFriendReq(body: DeleteFriendReq): Uint8Array {
  return new ProtoWriter()
    .message(DeleteFriendField.field1, encodeDeleteFriendField1(body.field1))
    .finish();
}

/** The response is `OidbEmpty` (reference/index.mjs:198293). */
export interface DeleteFriendResp {
  readonly _empty?: never;
}

export function decodeDeleteFriendResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): DeleteFriendResp {
  const reader = new ProtoReader(data, offset, end);
  const unknown = new UnknownFieldCollector();
  while (reader.next()) reader.skip(unknown);
  return {};
}

export interface DeleteFriendParams {
  /** The friend's uid — resolved from the uin by the caller. */
  targetUid: string;
  /** Also block the friend.  Reference default: false (explicitly sent). */
  block?: boolean | undefined;
}

export const DeleteFriend: OidbSpec<DeleteFriendParams, DeleteFriendReq, DeleteFriendResp, void> = {
  command: DELETE_FRIEND_COMMAND,
  subCommand: DELETE_FRIEND_SUB_COMMAND,
  serialize: (params) => ({
    field1: {
      targetUid: params.targetUid,
      field2: {
        field1: DELETE_FRIEND_STAMP.field2.field1,
        field2: DELETE_FRIEND_STAMP.field2.field2,
        field3: { ...DELETE_FRIEND_STAMP.field2.field3 },
      },
      block: params.block ?? false,
      field4: true,
    },
  }),
  encodeBody: encodeDeleteFriendReq,
  decodeBody: decodeDeleteFriendResp,
  deserialize: () => undefined,
};