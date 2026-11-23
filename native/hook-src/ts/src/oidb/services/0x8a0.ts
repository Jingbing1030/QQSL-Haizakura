// OidbSvcTrpcTcp.0x8a0_1 — kick members, in TWO shapes under one command/sub.
//
// ---------------------------------------------------------------------------
// Naming: both labels the batch brief gave me were right, but they are not the
// same message
// ---------------------------------------------------------------------------
// `KickMember`  (single, reference/index.mjs:206347) and `KickMembers` (batch,
// reference/index.mjs:207595) both declare `command = 2208`, `subCommand = 1`,
// and both have `uinForm` unset.  So the wire name is identical:
//
//     OidbSvcTrpcTcp.0x8a0_1        for both
//
// …and the request bodies are **completely different messages**.  This is the
// same trap 0x112a_2 has (two schemas, one cmd/sub), and it is worth stating
// plainly because a single shared codec here would encode one and decode the
// other:
//
//   KickMember (single)        reference/index.mjs:205809 / 205835
//     1 groupUin         uint32   (NOT uint64)
//     3 targetUid        string   (one uid; field 2 is skipped entirely)
//     4 rejectAddRequest bool     `=== true` rule -> false is DROPPED
//     5 reason           string   `!= null && !== ""` -> "" dropped
//
//   KickMembers (batch)        reference/index.mjs:207451 / 207482
//     1 groupId          uint64
//     3 targetUids       repeated string, non-packed (one `1a` per element)
//     4 rejectAddRequest uint32   `!= null && !== 0` -> 1 when true, dropped when false
//     5 kickReason       bytes    empty `Uint8Array(0)` is DROPPED by the length rule
//    12 field12          uint32   always 0 in serialize, so never on the wire
//
// Note the type difference on field 1 (uint32 vs uint64) and on field 4
// (bool vs uint32).  For a group number below 2^31 both encode to the same
// bytes, so a shared struct would pass every test with a small group id and
// then silently truncate a large one.  The tests below pin a group id above
// 2^31 in the batch test to make that visible.
//
// ---------------------------------------------------------------------------
// The responses are also two copies of the same message
// ---------------------------------------------------------------------------
// `OidbKickMemberResponse$1` (L206133, for KickMember) and
// `OidbKickMemberResponse` (L206995, for KickMembers) are byte-identical in
// shape — the `$1` suffix is just the second region's private copy of the
// generated codec, which is exactly the `$N` hazard MEMORY.md §8 warns about:
// they happen to agree here, but they are distinct functions in distinct
// regions and the next command's copies do NOT agree.
//
//   OidbKickMemberResponse   1 groupUin uint32, 2 results[] message
//   OidbKickMemberResult     1 result   uint32, 2 uid     string
//
// The business result is not the decoded body: the reference's `deserialize`
// walks `results[]` and throws on the first nonzero `result`, converting a
// per-member failure into an exception rather than a return value.  Both specs
// therefore return `void`, and a caller that wants the per-member codes has to
// decode the body itself.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";


/** 2208 = 0x8a0. */
export const KICK_MEMBER_COMMAND = 0x8a0;

/**
 * Sub-command 1 for both shapes.
 *
 * There is no `_0`: the reference has exactly two specs on this command and both
 * say `subCommand = 1`.  Nothing in the bundle resolves a different value, so a
 * `0x8a0_0` does not exist.
 */
export const KICK_MEMBER_SUB_COMMAND = 1;

// ---------------------------------------------------------------------------
// Field tables
// ---------------------------------------------------------------------------

export const OidbKickMemberField = {
  groupUin: 1,
  targetUid: 3,
  rejectAddRequest: 4,
  reason: 5,
} as const;

export const Oidb0x8a0ReqField = {
  groupId: 1,
  targetUids: 3,
  rejectAddRequest: 4,
  kickReason: 5,
  field12: 12,
} as const;

export const OidbKickMemberResponseField = { groupUin: 1, results: 2 } as const;

export const OidbKickMemberResultField = { result: 1, uid: 2 } as const;

// ---------------------------------------------------------------------------
// Single kick (0x8a0_1, `OidbKickMember`)
// ---------------------------------------------------------------------------

export interface OidbKickMember {
  /** uint32 here, unlike the batch form's uint64. */
  groupUin: number;
  /** The target's uid, resolved from the uin by the caller. */
  targetUid: string;
  /** `=== true` presence rule: `false` is dropped, not written as 0. */
  rejectAddRequest: boolean;
  /** `!= null && !== ""`: an empty reason is dropped. */
  reason: string;
}

export function encodeOidbKickMember(body: OidbKickMember): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbKickMemberField.groupUin, body.groupUin)
    .string(OidbKickMemberField.targetUid, body.targetUid)
    // `.bool` implements the reference's `=== true` rule, so `reject: false`
    // omits field 4 entirely (golden `kick_one` has no `20 01`).
    .bool(OidbKickMemberField.rejectAddRequest, body.rejectAddRequest)
    .string(OidbKickMemberField.reason, body.reason)
    .finish();
}

// ---------------------------------------------------------------------------
// Batch kick (0x8a0_1, `Oidb0x8a0Req`)
// ---------------------------------------------------------------------------

export interface Oidb0x8a0Req {
  groupId: bigint;
  /** repeated, NON-packed: one `1a` tag per uid. */
  targetUids: string[];
  /** uint32 here, not a bool: 1 when rejecting, DROPPED when false. */
  rejectAddRequest: number;
  /** bytes; the reference always passes `new Uint8Array(0)`, which is dropped. */
  kickReason: Uint8Array;
  /** Always 0 in `serialize`, so the `!== 0` rule keeps it off the wire. */
  field12: number;
}

export function encodeOidb0x8a0Req(body: Oidb0x8a0Req): Uint8Array {
  return new ProtoWriter()
    .uint64(Oidb0x8a0ReqField.groupId, body.groupId)
    // `.repeatedString` is non-packed (one tag per element), matching the
    // generated writer's `for` loop. `packedUint32` would be wrong here twice
    // over: wrong shape (string not uint32) and wrong packing.
    .repeatedString(Oidb0x8a0ReqField.targetUids, body.targetUids)
    // uint32 presence, `!== 0`: `reject: false` -> serialize writes 0 -> dropped.
    .uint32(Oidb0x8a0ReqField.rejectAddRequest, body.rejectAddRequest)
    .bytes(Oidb0x8a0ReqField.kickReason, body.kickReason)
    .uint32(Oidb0x8a0ReqField.field12, body.field12)
    .finish();
}

// ---------------------------------------------------------------------------
// Response (shared shape, two region-local copies)
// ---------------------------------------------------------------------------

export interface OidbKickMemberResult {
  result: number;
  uid: string;
}

export interface OidbKickMemberResponse {
  groupUin: number;
  /** Always an array: the decoder initialises `_f1 = []`, never null. */
  results: OidbKickMemberResult[];
}

export function decodeOidbKickMemberResult(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbKickMemberResult {
  const reader = new ProtoReader(data, offset, end);
  const result: OidbKickMemberResult = { result: 0, uid: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbKickMemberResultField.result, WireType.varint):
        result.result = reader.uint32();
        break;
      case tagOf(OidbKickMemberResultField.uid, WireType.lengthDelimited):
        result.uid = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return result;
}

export function decodeOidbKickMemberResponse(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbKickMemberResponse {
  const reader = new ProtoReader(data, offset, end);
  const response: OidbKickMemberResponse = { groupUin: 0, results: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbKickMemberResponseField.groupUin, WireType.varint):
        response.groupUin = reader.uint32();
        break;
      case tagOf(OidbKickMemberResponseField.results, WireType.lengthDelimited):
        response.results.push(reader.message(decodeOidbKickMemberResult));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return response;
}

/**
 * The reference's `deserialize` for both kick specs.
 *
 * Exported rather than inlined into the two `deserialize` closures because the
 * two are character-for-character identical apart from the operation name, and
 * the operation name is the part a test asserts on.
 */
export function checkKickResults(
  response: OidbKickMemberResponse,
  operation: "kick member" | "kick members" = "kick member",
): void {
  for (const item of response.results ?? []) {
    const code = item.result ?? 0;
    if (code !== 0) throw new Error(`${operation} failed: result=${code}`);
  }
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export interface KickMemberParams {
  groupId: number | bigint;
  /** The target's uid — already resolved; see `kickMemberParams`. */
  targetUid: string;
  /** Also reject the member's pending join request.  Default false (dropped). */
  reject?: boolean | undefined;
  /** Default "" (dropped). */
  reason?: string | undefined;
}

export const KickMember: OidbSpec<KickMemberParams, OidbKickMember, OidbKickMemberResponse, void> = {
  command: KICK_MEMBER_COMMAND,
  subCommand: KICK_MEMBER_SUB_COMMAND,
  serialize: (params) => ({
    // Field 1 is uint32 in this message; `Number()` is the faithful narrowing.
    groupUin: Number(params.groupId),
    targetUid: params.targetUid,
    // `p.reject` is passed through un-coerced. `undefined` is falsy, and the
    // reference's `=== true` guard drops both `undefined` and `false` alike.
    rejectAddRequest: params.reject === true,
    reason: params.reason ?? "",
  }),
  encodeBody: encodeOidbKickMember,
  decodeBody: decodeOidbKickMemberResponse,
  deserialize: (body) => checkKickResults(body, "kick member"),
};

export interface KickMembersParams {
  groupId: number | bigint;
  /** The targets' uids, already resolved, in order. */
  targetUids: string[];
  /** Default false -> the reference writes 0 -> dropped. */
  reject?: boolean | undefined;
}

export const KickMembers: OidbSpec<KickMembersParams, Oidb0x8a0Req, OidbKickMemberResponse, void> = {
  command: KICK_MEMBER_COMMAND,
  subCommand: KICK_MEMBER_SUB_COMMAND,
  serialize: (params) => ({
    groupId: BigInt(params.groupId),
    targetUids: params.targetUids,
    // ⚠️ `p.reject ? 1 : 0` — a uint32, not a bool. The `!== 0` rule then drops
    // the explicit 0, which is the same on-wire outcome as the single form but
    // arrives there by a different rule.
    rejectAddRequest: params.reject === true ? 1 : 0,
    // The reference hard-codes `new Uint8Array(0)`, which `.bytes` drops.
    kickReason: new Uint8Array(0),
    field12: 0,
  }),
  encodeBody: encodeOidb0x8a0Req,
  decodeBody: decodeOidbKickMemberResponse,
  deserialize: (body) => checkKickResults(body, "kick members"),
};

/**
 * Resolve uins to uids for a single kick.
 *
 * The reference does this inside `serialize` with
 * `await ctx.resolveUserUid(p.userId, p.groupId)` (reference/index.mjs:206352).
 * Our spec is ctx-free, so the resolution is hoisted here — same signature, same
 * second argument (the group id lets the resolver use that group's roster).
 */
export async function kickMemberParams(
  params: { groupId: number | bigint; userId: number | bigint; reject?: boolean | undefined; reason?: string | undefined },
  resolveUid: (userId: number | bigint, groupId?: number | bigint) => Promise<string> | string,
): Promise<KickMemberParams> {
  const targetUid = await resolveUid(params.userId, params.groupId);
  if (!targetUid) throw new Error(`failed to resolve uid for ${params.userId}`);
  return {
    groupId: params.groupId,
    targetUid,
    reject: params.reject === true,
    reason: params.reason ?? "",
  };
}

/**
 * Resolve uins to uids for a batch kick.
 *
 * The reference maps the whole list through `Promise.all`
 * (reference/index.mjs:207600-207602), so resolution order does not matter and
 * the result keeps the input order.  Preserved here, with the same emptiness
 * check per element.
 */
export async function kickMembersParams(
  params: { groupId: number | bigint; userIds: readonly (number | bigint)[]; reject?: boolean | undefined },
  resolveUid: (userId: number | bigint, groupId?: number | bigint) => Promise<string> | string,
): Promise<KickMembersParams> {
  const targetUids = await Promise.all(
    params.userIds.map((userId) => Promise.resolve(resolveUid(userId, params.groupId))),
  );
  for (const [index, uid] of targetUids.entries()) {
    if (!uid) throw new Error(`failed to resolve uid for ${String(params.userIds[index])}`);
  }
  return { groupId: params.groupId, targetUids, reject: params.reject === true };
}