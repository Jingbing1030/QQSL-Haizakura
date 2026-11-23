// OidbSvcTrpcTcp.0x10c8_1 / _2 — approve or reject one group join/invite request.
//
// ---------------------------------------------------------------------------
// Why this command was a gap
// ---------------------------------------------------------------------------
// `set_group_add_request` is listed against `0x10c0_0` in ONEBOT-ACTION-SPEC.md,
// but the reference routes it through **0x10c8**: `_SetAddRequest.command = 4296`
// (reference/index.mjs:213041).  `0x10c0` is the *list* call; this is the *action*
// call.  docs/oidb.md §7.2 recorded the body shape but not the spec; this file
// closes it.
//
// ---------------------------------------------------------------------------
// The sub-command is 1 or 2, never 0
// ---------------------------------------------------------------------------
// Same trap as 0x10c0: `_SetAddRequest` has no `subCommand` at all, only
//
//     _SetAddRequest.resolveSubCommand = (p) => p.filtered ? 2 : 1   (L213043)
//
// so the wire name is `OidbSvcTrpcTcp.0x10c8_1` for the pending bucket and
// `_2` for the filtered one.  `filtered` therefore is not cosmetic: it selects a
// different server-side queue.  It arrives from the `flag` that
// `formatGroupRequestFlag` (0x10c0.ts) encoded as its sixth field.
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   OidbGroupRequestAction      reference/index.mjs:212822 / 212841 (write)
//     1 accept uint32          1 = approve, 2 = reject
//     2 body   -> OidbGroupRequestBody
//   OidbGroupRequestBody        reference/index.mjs:212895 / 212926 (write)
//     1 sequence          uint64
//     2 eventType         uint32
//     3 groupUin          uint32
//     4 message           string   (`!= null` — a " " placeholder is sent)
//     7 operateTransInfo  bytes
//
// ⚠️ `message` uses the `!= null` presence rule, not `!= null && !== ""`.  The
// reference deliberately sends a single space when the caller has no reason
// (reference/index.mjs:213049: `message: reason.length > 0 ? reason : " "`), which
// suggests the server rejects an empty message field.  Encoding it with the
// ordinary "drop when empty" rule would send a request the server rejects.
//
// ⚠️ `accept` is 1/2, not a bool.  Sending `accept: true` would encode as 1 and
// *appear* to work for approval while making rejection impossible.

import { type OidbSpec } from "../spec.js";
import { decodeOidbEmpty as decodeEmptyMessage, type OidbEmpty as EmptyMessage } from "./0x89a-0.js";
import {
  SET_ADD_REQUEST_COMMAND as GROUP_REQUEST_ACTION_COMMAND,
  GroupRequestActionField,
  GroupRequestBodyField,
  encodeGroupRequestAction,
  type GroupRequestActionReq,
} from "./0x10c0.js";

export {
  GroupRequestActionField,
  GroupRequestBodyField,
  encodeGroupRequestAction,
  type GroupRequestActionReq,
};

/** 4296 = 0x10c8.  Re-exported from 0x10c0.ts, where the field table lives. */
export const SET_ADD_REQUEST_COMMAND = GROUP_REQUEST_ACTION_COMMAND;

/** `filtered` selects the bucket, and the bucket is the sub-command. */
export const SET_ADD_REQUEST_SUB_COMMAND = { pending: 1, filtered: 2 } as const;

/** `accept` values: the reference's own constants, spelled out. */
export const GROUP_REQUEST_ACCEPT = { approve: 1, reject: 2 } as const;

/** The placeholder the reference substitutes for an empty reason. */
export const EMPTY_REASON_PLACEHOLDER = " ";

/**
 * The response is `OidbEmpty` — a message with no fields at all
 * (reference/index.mjs:212516).  0x89a-0.ts already carries that codec, so it is
 * re-used rather than re-declared: the barrel would otherwise export two identical
 * `OidbEmpty` types and collide.
 */
export type OidbEmpty = EmptyMessage;

export const decodeOidbEmpty = decodeEmptyMessage;

export interface SetAddRequestParams {
  groupId: number;
  sequence: bigint | number;
  eventType: number;
  approve: boolean;
  reason?: string | undefined;
  /** Pick sub-command 2 (the filtered bucket) instead of 1. */
  filtered?: boolean | undefined;
  /** The opaque `operateTransInfo` carried by the request event, if any. */
  operateTransInfo?: Uint8Array | undefined;
}

/**
 * SetAddRequest spec.
 *
 * `sequence` arrives as a number or bigint (the flag parser in 0x10c0.ts returns
 * a number) but goes on the wire as uint64, so it is widened here — the reference
 * does `BigInt(p.sequence)` at the same point (reference/index.mjs:213047).
 */
export const SetAddRequest: OidbSpec<
  SetAddRequestParams,
  GroupRequestActionReq,
  OidbEmpty,
  void
> = {
  command: SET_ADD_REQUEST_COMMAND,
  uinForm: true,
  resolveSubCommand: (params) =>
    params.filtered === true ? SET_ADD_REQUEST_SUB_COMMAND.filtered : SET_ADD_REQUEST_SUB_COMMAND.pending,
  serialize: (params) => ({
    accept: params.approve ? GROUP_REQUEST_ACCEPT.approve : GROUP_REQUEST_ACCEPT.reject,
    body: {
      sequence: BigInt(params.sequence),
      eventType: params.eventType,
      groupUin: params.groupId,
      message: (params.reason ?? "").length > 0 ? params.reason! : EMPTY_REASON_PLACEHOLDER,
      ...(params.operateTransInfo && params.operateTransInfo.length > 0
        ? { operateTransInfo: params.operateTransInfo }
        : {}),
    },
  }),
  encodeBody: encodeGroupRequestAction,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};