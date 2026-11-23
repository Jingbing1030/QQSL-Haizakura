// OidbSvcTrpcTcp.0x1096_1 (`set_group_admin`) and 0x1097_1 (`set_group_leave`).
//
// ---------------------------------------------------------------------------
// Two tiny commands that share a shape and nothing else
// ---------------------------------------------------------------------------
//   0x1096_1  grant or revoke a member's admin rights   -- `set_group_admin`
//   0x1097_1  leave a group                             -- `set_group_leave`
//
// They are grouped in one file because both are one-field-plus-a-flag requests
// with an empty reply, and because the task brief listed them together as
// "member role changes".  That description is only half right: 0x1096 does change
// a member's role (member <-> admin), but 0x1097 does not touch any role — it
// removes the caller from the group.  There is no command in this reference that
// transfers ownership or moves a member between arbitrary roles.
//
// Note what is NOT here: neither command carries the target's *uin*.  The admin
// change is addressed by **uid** (field 2), because the group's member list is
// uid-keyed; the leave request carries no target at all (the caller is the
// subject, taken from the envelope's identity).
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   OidbSetAdmin            reference/index.mjs:214026 / 214052 / 214056
//     1 groupUin uint32
//     2 uid      string   <-- a uid, not a uin
//     3 isAdmin  bool     <-- bool: `false` is dropped by the presence rule
//
//   OidbLeaveGroup          reference/index.mjs:208569
//     1 groupUin uint32
//
// Both responses are `OidbEmpty` (`OidbEmpty$16` / `OidbEmpty$21`), so there is
// no body-level retcode: a failure can only arrive as an envelope error code.
//
// ---------------------------------------------------------------------------
// The `isAdmin: false` trap
// ---------------------------------------------------------------------------
// `_SetAdmin.serialize` passes `p.enable` straight into `isAdmin`, and the
// generated encoder writes a bool only when `=== true`
// (reference/index.mjs:213972 region).  So "revoke" is encoded as *field 3
// absent*, which is exactly what the server expects.  Do not "helpfully" change
// the presence rule to `!= null`: that would emit `isAdmin: false` explicitly,
// and the reference never does — a decode of the two forms is indistinguishable,
// but the server's interpretation of an explicit zero is not guaranteed to match
// an absent field.
//
// ---------------------------------------------------------------------------
// uinForm: none
// ---------------------------------------------------------------------------
// Neither sets `uinForm` (reference/index.mjs:214061 / 208574), so `reserved` is
// 0 in both envelopes.

import { ProtoWriter } from "../wire.js";
import { type OidbSpec } from "../spec.js";
import { type OidbEmpty, decodeOidbEmpty } from "./0x89a-0.js";

/** 4246 = 0x1096. */
export const SET_GROUP_ADMIN_COMMAND = 0x1096;

/** 4247 = 0x1097. */
export const SET_GROUP_LEAVE_COMMAND = 0x1097;

/** The only sub-command either command uses. */
export const SET_GROUP_ADMIN_SUB_COMMAND = 1;
export const SET_GROUP_LEAVE_SUB_COMMAND = 1;

export const OidbSetAdminField = { groupUin: 1, uid: 2, isAdmin: 3 } as const;

export const OidbLeaveGroupField = { groupUin: 1 } as const;

// ---------------------------------------------------------------------------
// set_group_admin
// ---------------------------------------------------------------------------

export interface OidbSetAdmin {
  groupUin: number;
  uid: string;
  isAdmin: boolean;
}

export function encodeOidbSetAdmin(body: OidbSetAdmin): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbSetAdminField.groupUin, body.groupUin)
    .string(OidbSetAdminField.uid, body.uid)
    // `.bool` implements the reference's `=== true` rule, so revoke omits field 3.
    .bool(OidbSetAdminField.isAdmin, body.isAdmin)
    .finish();
}

export interface SetGroupAdminParams {
  groupId: number | bigint;
  /** The target's uid — already resolved; see `setAdminParams`. */
  uid: string;
  /** true = grant admin, false = revoke. */
  enable: boolean;
}

/**
 * `set_group_admin`.
 *
 * The reference resolves the uid inside `serialize`
 * (reference/index.mjs:214054, `await ctx.resolveUserUid(p.userId, p.groupId)`).
 * That is ctx-dependent, so the resolved uid is a parameter here and
 * `setAdminParams` is the adapter for callers that own the resolver.
 */
export const SetGroupAdmin: OidbSpec<SetGroupAdminParams, OidbSetAdmin, OidbEmpty, void> = {
  command: SET_GROUP_ADMIN_COMMAND,
  subCommand: SET_GROUP_ADMIN_SUB_COMMAND,
  serialize: (params) => ({
    groupUin: Number(params.groupId),
    uid: params.uid,
    isAdmin: params.enable,
  }),
  encodeBody: encodeOidbSetAdmin,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

/**
 * Adapt an action-shaped `set_group_admin` call onto the ctx-free spec.
 *
 * The reference passes `p.groupId` as the resolver's second argument, which lets
 * an implementation look the uid up in that group's member cache specifically;
 * the second parameter is kept so a caller can do the same.
 */
export async function setAdminParams(
  params: { groupId: number | bigint; userId: number | bigint; enable: boolean },
  resolveUid: (userId: number | bigint, groupId?: number | bigint) => Promise<string> | string,
): Promise<SetGroupAdminParams> {
  const uid = await resolveUid(params.userId, params.groupId);
  // The reference does not guard this one, and neither does it need to: an empty
  // uid sends a request the server rejects with a clear code.  Surfacing the
  // failure here instead keeps the error local and legible.
  if (!uid) throw new Error(`failed to resolve uid for ${params.userId}`);
  return { groupId: params.groupId, uid, enable: params.enable };
}

// ---------------------------------------------------------------------------
// set_group_leave
// ---------------------------------------------------------------------------

export interface OidbLeaveGroup {
  groupUin: number;
}

export function encodeOidbLeaveGroup(body: OidbLeaveGroup): Uint8Array {
  return new ProtoWriter().uint32(OidbLeaveGroupField.groupUin, body.groupUin).finish();
}

export interface SetGroupLeaveParams {
  groupId: number | bigint;
}

/**
 * `set_group_leave` — the caller leaves `groupId`.
 *
 * There is no way to remove *another* member through this command: the request
 * identifies no target, so the subject is always the authenticated identity.
 * Kicking a member is a different command entirely (0x10c8 accept/reject covers
 * join requests; there is no 0x1097 variant for kicks).
 */
export const SetGroupLeave: OidbSpec<SetGroupLeaveParams, OidbLeaveGroup, OidbEmpty, void> = {
  command: SET_GROUP_LEAVE_COMMAND,
  subCommand: SET_GROUP_LEAVE_SUB_COMMAND,
  serialize: (params) => ({ groupUin: Number(params.groupId) }),
  encodeBody: encodeOidbLeaveGroup,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};
