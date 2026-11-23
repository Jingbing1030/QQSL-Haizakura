// OidbSvcTrpcTcp.0x8fc — member card (`_3`) and special title (`_2`).
//
// ---------------------------------------------------------------------------
// One command, two unrelated bodies
// ---------------------------------------------------------------------------
// `SetMemberCard`    command 2300 / 0x8fc, subCommand 3   (reference/index.mjs:222724)
// `SetSpecialTitle`  command 2300 / 0x8fc, subCommand 2   (reference/index.mjs:232843)
//
// ⚠️ The two regions are ~10 000 lines apart in the bundle and share nothing but
// the command number and a *structurally similar* wrapper. They are grouped here
// only because the wrapper is genuinely identical; the inner messages are
// different messages with different field numbers, and reading one region's
// codec while writing the other is the exact `$N` trap MEMORY.md §8 describes.
//
// Note the sub-command order: `_2` is the *title* and `_3` is the *card*.
// Number proximity again predicts nothing — `_2` before `_3` would suggest the
// reverse if you assumed declaration order.
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   Wrapper (both)           OidbRenameMember / OidbSpecialTitle, both
//                            reference/index.mjs:222576 / 232629 (write):
//     1 groupUin  **uint32**   `!= null && !== 0`
//     3 body      message      **field 3, not 2** (`1a`)
//   Both wrappers skip field 2. The tag byte in each writer is `26` = 3<<3|2.
//
//   OidbRenameMemberBody     reference/index.mjs:222649 / 222667  (card, _3)
//     1 targetUid    string  (a uid, `!= null && !== ""`)
//     8 targetName   **field 8**, `!= null` -> an empty card IS sent as `42 00`
//
//   OidbSpecialTitleBody     reference/index.mjs:232702 / 232733  (title, _2)
//     1 targetUid     string  (`!= null && !== ""`)
//     5 specialTitle  **field 5**, `!= null` -> empty title sent as `2a 00`
//     6 expireTime    uint32  `!= null && !== 0` -> -1 becomes 0xffffffff
//     7 uinName       **field 7**, `!= null`, a duplicate of the title
//
//   ⚠️ The four surprises, all pinned by goldens:
//     * the card's text field is **8**, the title's is **5**, and neither is 2;
//     * `specialTitle` and `uinName` carry the SAME string at two different
//       field numbers (5 and 7). The reference sets both from `p.title`; sending
//       only one of them leaves the name blank in the client;
//     * `expireTime: -1` is written as the *unsigned* varint `ffffffff0f`
//       (5 bytes), because the field is uint32 and `-1 >>> 0` is 4294967295.
//       An int32 writer would emit a 10-byte negative varint instead — same
//       value, different bytes, and the reference never emits that form;
//     * the title body's `targetUid` guard is `!= null && !== ""` while the
//       card body's `targetName` guard is a bare `!= null`. So an empty card
//       produces `42 00` but an empty uid produces nothing at all.
//
// ---------------------------------------------------------------------------
// Both responses are `OidbEmpty`
// ---------------------------------------------------------------------------
// `OidbEmpty$12` (card, :222725) and `OidbEmpty$5` (title, :232843). Neither body
// carries a retcode, so a failure can only arrive as an envelope error code, and
// both `deserialize`s are `(_ctx, _) => {}`.

import { ProtoReader, ProtoWriter, UnknownFieldCollector } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 2300 = 0x8fc. */
export const GROUP_MEMBER_COMMAND = 0x8fc;

/** Sub-command 3 — set a member's group card (nickname inside this group). */
export const SET_MEMBER_CARD_SUB_COMMAND = 3;

/** Sub-command 2 — set a member's special title. */
export const SET_SPECIAL_TITLE_SUB_COMMAND = 2;

// ---------------------------------------------------------------------------
// Wrappers — identical shape, different type names
// ---------------------------------------------------------------------------

export const OidbRenameMemberField = { groupUin: 1, body: 3 } as const;
export const OidbSpecialTitleField = { groupUin: 1, body: 3 } as const;

export const OidbRenameMemberBodyField = { targetUid: 1, targetName: 8 } as const;
export const OidbSpecialTitleBodyField = {
  targetUid: 1,
  specialTitle: 5,
  expireTime: 6,
  uinName: 7,
} as const;

/**
 * `expireTime` value the reference always sends: -1, i.e. "never expires".
 *
 * Kept as a named constant because the number is the whole semantic content of
 * the field, and because -1 is written as a 5-byte unsigned varint (uint32
 * `>>> 0`), not as a 10-byte signed one.
 */
export const SPECIAL_TITLE_NEVER_EXPIRES = -1;

// ---------------------------------------------------------------------------
// Member card (0x8fc_3)
// ---------------------------------------------------------------------------

export interface OidbRenameMemberBody {
  /** The target's uid, resolved from the uin by the caller. */
  targetUid: string;
  /** `!= null`: an empty string clears the card and IS written as `42 00`. */
  targetName: string;
}

export interface OidbRenameMember {
  groupUin: number;
  body: OidbRenameMemberBody;
}

export function encodeOidbRenameMemberBody(body: OidbRenameMemberBody): Uint8Array {
  return new ProtoWriter()
    .string(OidbRenameMemberBodyField.targetUid, body.targetUid)
    // `.stringPresent` is the bare `!= null` rule: "" reaches the wire as
    // `42 00`, which is how "clear this member's card" is expressed.
    .stringPresent(OidbRenameMemberBodyField.targetName, body.targetName)
    .finish();
}

export function encodeOidbRenameMember(body: OidbRenameMember): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbRenameMemberField.groupUin, body.groupUin)
    .message(OidbRenameMemberField.body, encodeOidbRenameMemberBody(body.body))
    .finish();
}

/** The response of 0x8fc_3 is `OidbEmpty$12` (reference/index.mjs:222725). */
export interface SetMemberCardResp {
  readonly _empty?: never;
}

export function decodeSetMemberCardResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): SetMemberCardResp {
  const reader = new ProtoReader(data, offset, end);
  const unknown = new UnknownFieldCollector();
  while (reader.next()) reader.skip(unknown);
  return {};
}

export interface SetMemberCardParams {
  groupId: number | bigint;
  /** The target's uid — already resolved; see `setMemberCardParams`. */
  targetUid: string;
  card: string;
}

export const SetMemberCard: OidbSpec<SetMemberCardParams, OidbRenameMember, SetMemberCardResp, void> = {
  command: GROUP_MEMBER_COMMAND,
  subCommand: SET_MEMBER_CARD_SUB_COMMAND,
  serialize: (params) => ({
    // Field 1 of the wrapper is uint32 in this message (`__write_OidbRenameMember`
    // has an inline 32-bit varint, not `__writeVarint64`).
    groupUin: Number(params.groupId),
    body: { targetUid: params.targetUid, targetName: params.card },
  }),
  encodeBody: encodeOidbRenameMember,
  decodeBody: decodeSetMemberCardResp,
  deserialize: () => undefined,
};

/**
 * Adapt an action-shaped `set_group_card` call onto the ctx-free spec.
 *
 * The reference resolves the uid inside `serialize`
 * (`await ctx.resolveUserUid(p.userId, p.groupId)`, reference/index.mjs:222727).
 */
export async function setMemberCardParams(
  params: { groupId: number | bigint; userId: number | bigint; card: string },
  resolveUid: (userId: number | bigint, groupId?: number | bigint) => Promise<string> | string,
): Promise<SetMemberCardParams> {
  const targetUid = await resolveUid(params.userId, params.groupId);
  if (!targetUid) throw new Error(`failed to resolve uid for ${params.userId}`);
  return { groupId: params.groupId, targetUid, card: params.card };
}

// ---------------------------------------------------------------------------
// Special title (0x8fc_2)
// ---------------------------------------------------------------------------

export interface OidbSpecialTitleBody {
  targetUid: string;
  /** `!= null`: "" is written as `2a 00` and clears the title. */
  specialTitle: string;
  /** uint32; -1 (`0xffffffff`) means never. 0 is dropped by the `!== 0` rule. */
  expireTime: number;
  /** The same text as `specialTitle`, at field 7. `!= null`, so "" is written. */
  uinName: string;
}

export interface OidbSpecialTitle {
  groupUin: number;
  body: OidbSpecialTitleBody;
}

export function encodeOidbSpecialTitleBody(body: OidbSpecialTitleBody): Uint8Array {
  return new ProtoWriter()
    .string(OidbSpecialTitleBodyField.targetUid, body.targetUid)
    .stringPresent(OidbSpecialTitleBodyField.specialTitle, body.specialTitle)
    // `expireTime` is uint32 with a `!== 0` guard. -1 arrives as 4294967295 via
    // `>>> 0`, giving the 5-byte `ffffffff0f`. `.uint32` performs that coercion.
    .uint32(OidbSpecialTitleBodyField.expireTime, body.expireTime)
    .stringPresent(OidbSpecialTitleBodyField.uinName, body.uinName)
    .finish();
}

export function encodeOidbSpecialTitle(body: OidbSpecialTitle): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbSpecialTitleField.groupUin, body.groupUin)
    .message(OidbSpecialTitleField.body, encodeOidbSpecialTitleBody(body.body))
    .finish();
}

/** The response of 0x8fc_2 is `OidbEmpty$5` (reference/index.mjs:232843). */
export interface SetSpecialTitleResp {
  readonly _empty?: never;
}

export function decodeSetSpecialTitleResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): SetSpecialTitleResp {
  const reader = new ProtoReader(data, offset, end);
  const unknown = new UnknownFieldCollector();
  while (reader.next()) reader.skip(unknown);
  return {};
}

export interface SetSpecialTitleParams {
  groupId: number | bigint;
  /** The target's uid — already resolved; see `setSpecialTitleParams`. */
  targetUid: string;
  title: string;
}

export const SetSpecialTitle: OidbSpec<
  SetSpecialTitleParams,
  OidbSpecialTitle,
  SetSpecialTitleResp,
  void
> = {
  command: GROUP_MEMBER_COMMAND,
  subCommand: SET_SPECIAL_TITLE_SUB_COMMAND,
  serialize: (params) => ({
    groupUin: Number(params.groupId),
    body: {
      targetUid: params.targetUid,
      specialTitle: params.title,
      expireTime: SPECIAL_TITLE_NEVER_EXPIRES,
      // The reference writes the title twice, at fields 5 and 7
      // (reference/index.mjs:232846). They are not the same field: 5 is the
      // title, 7 is the display name the client renders. Dropping one is a
      // partial write the server accepts.
      uinName: params.title,
    },
  }),
  encodeBody: encodeOidbSpecialTitle,
  decodeBody: decodeSetSpecialTitleResp,
  deserialize: () => undefined,
};

/**
 * Adapt an action-shaped `set_group_special_title` call onto the ctx-free spec.
 *
 * The reference resolves the uid inside `serialize`
 * (`await ctx.resolveUserUid(p.userId, p.groupId)`, reference/index.mjs:232845).
 */
export async function setSpecialTitleParams(
  params: { groupId: number | bigint; userId: number | bigint; title: string },
  resolveUid: (userId: number | bigint, groupId?: number | bigint) => Promise<string> | string,
): Promise<SetSpecialTitleParams> {
  const targetUid = await resolveUid(params.userId, params.groupId);
  if (!targetUid) throw new Error(`failed to resolve uid for ${params.userId}`);
  return { groupId: params.groupId, targetUid, title: params.title };
}
