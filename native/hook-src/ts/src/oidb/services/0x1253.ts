// OidbSvcTrpcTcp.0x1253_1 — mute one group member (`set_group_ban`).
//
// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------
// The batch brief calls 0x1253 "stranger lookup".  It is not: `_MuteMember.command
// = 4691` with `subCommand = 1` (reference/index.mjs:210721-210722), and the only
// action that reaches it is `set_group_ban` via
// `ctx.bridge.apis.groupAdmin.muteMember(gid, uid, duration)`
// (reference/index.mjs:9723, handler at 210721).  There is no stranger lookup
// anywhere near this command number; the stranger/profile family is 0xfe1_2.
// See 0xfe1.ts.
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   OidbMuteMember        reference/index.mjs:205?? (write at 210568 region)
//     1 groupUin uint32
//     2 type     uint32   constant 1 — "mute a member", as opposed to a whole group
//     3 body     -> OidbMuteMemberBody
//   OidbMuteMemberBody    reference/index.mjs:210647 / 210664 (write)
//     1 targetUid string
//     2 duration  uint32  seconds; 0 lifts the mute
//
// ⚠️ The target is a **uid string**, not a uin.  The reference resolves it with
// `ctx.resolveUserUid(p.userId, p.groupId)` inside `serialize`
// (reference/index.mjs:210724), i.e. the resolution is group-scoped: the same uin
// can map to different uids in different groups.  Doing that resolution outside
// the spec (as an action-level concern) would break that scoping.
//
// ⚠️ `duration: 0` must still go on the wire?  It does **not**: the guard is
// `!= null && !== 0`, so a zero duration produces a body carrying only
// `targetUid`.  That is how the reference lifts a mute — the *absence* of the
// duration field means "no duration", which is what the server reads as unmute.
// A `uint32Present` here would send `duration: 0` explicitly and change behaviour.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 4691 = 0x1253. */
export const MUTE_MEMBER_COMMAND = 0x1253;

export const MUTE_MEMBER_SUB_COMMAND = 1;

/** `type: 1` — the reference's constant for "single member". */
export const MUTE_MEMBER_TYPE = 1;

export const MuteMemberField = { groupUin: 1, type: 2, body: 3 } as const;
export const MuteMemberBodyField = { targetUid: 1, duration: 2 } as const;

export interface MuteMemberBody {
  targetUid: string;
  duration: number;
}

export interface MuteMemberReq {
  groupUin: number;
  type: number;
  body: MuteMemberBody;
}

export function encodeMuteMemberBody(body: MuteMemberBody): Uint8Array {
  return new ProtoWriter()
    .string(MuteMemberBodyField.targetUid, body.targetUid)
    .uint32(MuteMemberBodyField.duration, body.duration)
    .finish();
}

export function encodeMuteMember(body: MuteMemberReq): Uint8Array {
  return new ProtoWriter()
    .uint32(MuteMemberField.groupUin, body.groupUin)
    .uint32(MuteMemberField.type, body.type)
    .message(MuteMemberField.body, encodeMuteMemberBody(body.body))
    .finish();
}

/** The response is `OidbEmpty` (reference/index.mjs:210730 `protobuf_decode_OidbEmpty$19`). */
export interface MuteMemberResp {
  readonly _empty?: never;
}

export function decodeMuteMemberResp(data: Uint8Array, offset = 0, end = data.length): MuteMemberResp {
  const reader = new ProtoReader(data, offset, end);
  const unknown = new UnknownFieldCollector();
  while (reader.next()) reader.skip(unknown);
  return {};
}

/**
 * Action-level params.
 *
 * `targetUid` is the already-resolved uid: this spec cannot call
 * `resolveUserUid` because `OidbSpec.serialize` is synchronous and knows nothing
 * about identity (deliberately — the transport template in spec.ts is
 * transport-only).  Callers resolve the uid with the group id first.
 */
export interface MuteMemberParams {
  groupId: number;
  targetUid: string;
  /** Seconds; 0 (or undefined) lifts the mute by omitting the field. */
  duration?: number | undefined;
}

export const MuteMember: OidbSpec<MuteMemberParams, MuteMemberReq, MuteMemberResp, void> = {
  command: MUTE_MEMBER_COMMAND,
  subCommand: MUTE_MEMBER_SUB_COMMAND,
  serialize: (params) => ({
    groupUin: params.groupId,
    type: MUTE_MEMBER_TYPE,
    body: { targetUid: params.targetUid, duration: params.duration ?? 0 },
  }),
  encodeBody: encodeMuteMember,
  decodeBody: decodeMuteMemberResp,
  deserialize: () => undefined,
};