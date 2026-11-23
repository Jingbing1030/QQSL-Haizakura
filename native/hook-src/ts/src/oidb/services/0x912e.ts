// OidbSvcTrpcTcp.0x912e_0 — set a friend remark (`set_friend_remark`).
// OidbSvcTrpcTcp.0x912f_0 — clear a friend remark (`set_friend_remark` w/ empty).
//
// ---------------------------------------------------------------------------
// Why they are one file
// ---------------------------------------------------------------------------
// ONEBOT-ACTION-SPEC.md lists **both** commands under `set_friend_remark`
// (one action, two serviceCmd cells).  The reference picks between them inside
// the bridge method (`reference/index.mjs:203930`): an empty remark goes to
// ClearFriendRemark, a non-empty one to SetFriendRemark.  Splitting the file
// would hide that routing rule, which is the only thing the action needs to know.
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
// **0x912e_0 SetFriendRemark** (reference/index.mjs:203164-203257 for the write)
//   OidbSetFriendRemark            1 change -> OidbSetFriendRemarkChange
//                                  2 scene  uint32, constant 0 — **written even
//                                    when 0**?  No: the guard is `!= null` on
//                                    `_f1`, and `serialize` always supplies
//                                    `scene: 0`, so `10 00` IS emitted.  The
//                                    goldens end with `...1000`.
//   OidbSetFriendRemarkChange      1 target -> OidbFriendRemarkTarget
//                                  2 remark string (`!= null && !== ""`)
//   OidbFriendRemarkTarget         3 targetUin uint64
//                                  7 targetUid string
// ⚠️ The target submessage numbers its fields **3 and 7**, not 1 and 2.  A
// 1/2 assumption produces a message the server parses as an empty target.
// **0x912f_0 ClearFriendRemark** (reference/index.mjs:196919-196974)
//   OidbClearFriendRemark          1 target -> OidbFriendRemarkTarget (same 3/7 shape)
//
// Response of 0x912e_0 (reference/index.mjs:203422 / 203633 / 203742):
//   ...Response           1 result -> ...Change, 3 error -> ...Error
//   ...Error              2 code uint32, 3 message string
// `deserialize` turns a nonzero `error.code` into an OidbError and refuses a
// response with a missing `result` — so the caller can detect a silent failure
// instead of trusting the envelope's `errorCode: 0`.  That behaviour is preserved
// here (see `SetFriendRemarkResult` / `checkFriendRemarkResponse`).
//
// 0x912f_0 responds with `OidbEmpty` (reference/index.mjs:196998).

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { OidbError } from "../envelope.js";
import { type OidbSpec } from "../spec.js";

/** 37166 = 0x912e. */
export const SET_FRIEND_REMARK_COMMAND = 0x912e;
/** 37167 = 0x912f. */
export const CLEAR_FRIEND_REMARK_COMMAND = 0x912f;

export const SET_FRIEND_REMARK_SUB_COMMAND = 0;
export const CLEAR_FRIEND_REMARK_SUB_COMMAND = 0;

/** `scene: 0` is what the reference always sends (reference/index.mjs:203856). */
export const FRIEND_REMARK_SCENE = 0;

export const SetFriendRemarkField = { change: 1, scene: 2 } as const;
export const SetFriendRemarkChangeField = { target: 1, remark: 2 } as const;
/** ⚠️ 3 and 7, not 1 and 2. */
export const FriendRemarkTargetField = { targetUin: 3, targetUid: 7 } as const;

export const ClearFriendRemarkField = { target: 1 } as const;

export interface FriendRemarkTarget {
  targetUin: bigint;
  targetUid: string;
}

export interface SetFriendRemarkChange {
  target: FriendRemarkTarget;
  remark: string;
}

export interface SetFriendRemarkReq {
  change: SetFriendRemarkChange;
  scene: number;
}

export interface ClearFriendRemarkReq {
  target: FriendRemarkTarget;
}

export function encodeFriendRemarkTarget(target: FriendRemarkTarget): Uint8Array {
  return new ProtoWriter()
    .uint64(FriendRemarkTargetField.targetUin, target.targetUin)
    .string(FriendRemarkTargetField.targetUid, target.targetUid)
    .finish();
}

export function encodeSetFriendRemarkReq(body: SetFriendRemarkReq): Uint8Array {
  const change = new ProtoWriter()
    .message(SetFriendRemarkChangeField.target, encodeFriendRemarkTarget(body.change.target))
    .string(SetFriendRemarkChangeField.remark, body.change.remark)
    .finish();
  return new ProtoWriter()
    .message(SetFriendRemarkField.change, change)
    // `scene` is written even when 0: the reference's guard is `_f1 != null`.
    .uint32Present(SetFriendRemarkField.scene, body.scene)
    .finish();
}

export function encodeClearFriendRemarkReq(body: ClearFriendRemarkReq): Uint8Array {
  return new ProtoWriter()
    .message(ClearFriendRemarkField.target, encodeFriendRemarkTarget(body.target))
    .finish();
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const SetFriendRemarkResponseField = { result: 1, error: 3 } as const;
export const SetFriendRemarkErrorField = { code: 2, message: 3 } as const;

export interface SetFriendRemarkError {
  code: number;
  message: string;
}

export interface SetFriendRemarkResponse {
  result?: SetFriendRemarkChange | undefined;
  error?: SetFriendRemarkError | undefined;
}

export function decodeFriendRemarkTarget(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FriendRemarkTarget {
  const reader = new ProtoReader(data, offset, end);
  const t: FriendRemarkTarget = { targetUin: 0n, targetUid: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FriendRemarkTargetField.targetUin, WireType.varint):
        t.targetUin = reader.uint64();
        break;
      case tagOf(FriendRemarkTargetField.targetUid, WireType.lengthDelimited):
        t.targetUid = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return t;
}

export function decodeSetFriendRemarkChange(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): SetFriendRemarkChange {
  const reader = new ProtoReader(data, offset, end);
  const change: SetFriendRemarkChange = {
    target: { targetUin: 0n, targetUid: "" },
    remark: "",
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(SetFriendRemarkChangeField.target, WireType.lengthDelimited):
        change.target = reader.message(decodeFriendRemarkTarget);
        break;
      case tagOf(SetFriendRemarkChangeField.remark, WireType.lengthDelimited):
        change.remark = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return change;
}

function decodeSetFriendRemarkError(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): SetFriendRemarkError {
  const reader = new ProtoReader(data, offset, end);
  const err: SetFriendRemarkError = { code: 0, message: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(SetFriendRemarkErrorField.code, WireType.varint):
        err.code = reader.uint32();
        break;
      case tagOf(SetFriendRemarkErrorField.message, WireType.lengthDelimited):
        err.message = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return err;
}

export function decodeSetFriendRemarkResponse(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): SetFriendRemarkResponse {
  const reader = new ProtoReader(data, offset, end);
  const resp: SetFriendRemarkResponse = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(SetFriendRemarkResponseField.result, WireType.lengthDelimited):
        resp.result = reader.message(decodeSetFriendRemarkChange);
        break;
      case tagOf(SetFriendRemarkResponseField.error, WireType.lengthDelimited):
        resp.error = reader.message(decodeSetFriendRemarkError);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

/** The response of 0x912f_0 is `OidbEmpty` (reference/index.mjs:196998). */
export interface ClearFriendRemarkResp {
  readonly _empty?: never;
}

export function decodeClearFriendRemarkResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): ClearFriendRemarkResp {
  const reader = new ProtoReader(data, offset, end);
  const unknown = new UnknownFieldCollector();
  while (reader.next()) reader.skip(unknown);
  return {};
}

// ---------------------------------------------------------------------------
// The reference's response validation
// ---------------------------------------------------------------------------

export interface FriendRemarkResult {
  targetUid: string;
  targetUin: number;
  remark: string;
}

/**
 * The reference's `deserialize` for 0x912e_0 (reference/index.mjs:203861).
 *
 * Three failure modes are distinguished, and the distinction matters:
 *
 *   1. `error` present with a nonzero `code`  -> OidbError(code, message)
 *      (a *server-level* rejection carried inside a successful envelope)
 *   2. `error` present with `code === 0`      -> plain Error
 *      "invalid friend remark response: error result has no failure code"
 *   3. `result` missing                       -> plain Error
 *      "invalid friend remark response: missing result"
 *
 * Case 2 is the subtle one: an error record with no code is not success, and
 * treating `code === 0` as "no error" would report a broken response as applied.
 *
 * `targetUin` is parsed from a *string* on the wire (`rawTargetUin`), which is why
 * the check `Number.isSafeInteger` is needed — a uid accidentally placed there
 * would produce NaN and must be rejected rather than silently become 0.
 */
export function checkFriendRemarkResponse(
  response: SetFriendRemarkResponse,
  command: number = SET_FRIEND_REMARK_COMMAND,
  subCommand: number = SET_FRIEND_REMARK_SUB_COMMAND,
): FriendRemarkResult {
  if (response.error) {
    const code = response.error.code ?? 0;
    const message = response.error.message ?? "";
    if (code !== 0) throw new OidbError(code, message, command, subCommand);
    throw new Error(
      `invalid friend remark response: error result has no failure code${message ? ` (${message})` : ""}`,
    );
  }
  const result = response.result;
  if (!result) throw new Error("invalid friend remark response: missing result");
  const targetUid = result.target?.targetUid ?? "";
  // Field 3 is uint64 on the wire, but the reference compares it as a decimal
  // string; the bigint -> string step below is that same comparison, done exactly.
  const rawTargetUin = result.target?.targetUin !== undefined ? String(result.target.targetUin) : "";
  const targetUin = rawTargetUin && rawTargetUin !== "0" ? Number(rawTargetUin) : 0;
  if (targetUin !== 0 && (!Number.isSafeInteger(targetUin) || targetUin <= 0)) {
    throw new Error(`invalid friend remark response: invalid target UIN ${rawTargetUin}`);
  }
  return { targetUid, targetUin, remark: result.remark ?? "" };
}

/**
 * Verify the confirmed remark against what was requested
 * (reference/index.mjs:203887-203890).
 *
 * `targetUin` is only cross-checked when the server echoed a nonzero one, because
 * QQ omits it for some accounts; failing on a missing echo would reject a
 * perfectly applied update.
 */
export function confirmFriendRemark(
  result: FriendRemarkResult,
  expected: { targetUid: string; targetUin?: number | undefined; remark: string },
): void {
  if (result.targetUid !== expected.targetUid) {
    throw new Error(
      `friend remark response target mismatch: expected UID ${expected.targetUid}, got ${result.targetUid || "(missing)"}`,
    );
  }
  if (result.targetUin > 0 && expected.targetUin !== undefined && result.targetUin !== expected.targetUin) {
    throw new Error(
      `friend remark response target mismatch: expected UIN ${expected.targetUin}, got ${result.targetUin}`,
    );
  }
  if (result.remark !== expected.remark) {
    throw new Error("friend remark response value does not match the requested remark");
  }
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export interface SetFriendRemarkParams {
  /** The friend's uid — resolved from the uin by the caller. */
  targetUid: string;
  remark: string;
}

export const SetFriendRemark: OidbSpec<
  SetFriendRemarkParams,
  SetFriendRemarkReq,
  SetFriendRemarkResponse,
  FriendRemarkResult
> = {
  command: SET_FRIEND_REMARK_COMMAND,
  subCommand: SET_FRIEND_REMARK_SUB_COMMAND,
  serialize: (params) => ({
    change: { target: { targetUid: params.targetUid, targetUin: 0n }, remark: params.remark },
    scene: FRIEND_REMARK_SCENE,
  }),
  encodeBody: encodeSetFriendRemarkReq,
  decodeBody: decodeSetFriendRemarkResponse,
  deserialize: (body) => checkFriendRemarkResponse(body),
};

export interface ClearFriendRemarkParams {
  targetUid: string;
}

export const ClearFriendRemark: OidbSpec<
  ClearFriendRemarkParams,
  ClearFriendRemarkReq,
  ClearFriendRemarkResp,
  void
> = {
  command: CLEAR_FRIEND_REMARK_COMMAND,
  subCommand: CLEAR_FRIEND_REMARK_SUB_COMMAND,
  serialize: (params) => ({ target: { targetUid: params.targetUid, targetUin: 0n } }),
  encodeBody: encodeClearFriendRemarkReq,
  decodeBody: decodeClearFriendRemarkResp,
  deserialize: () => undefined,
};