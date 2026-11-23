// OidbSvcTrpcTcp.0x8a7_0 — how many @-all the account has left.
//
// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------
// The batch brief called this `GetAtAllRemain`, and the reference agrees: the
// spec variable is literally `GetAtAllRemain` (reference/index.mjs:205143) with
// `command = 2215 / 0x8a7`, `subCommand = 0`, `uinForm` unset.
//
// This is one of the few commands in the batch whose *label* was accurate. It is
// also the one where the request has almost nothing caller-supplied: three
// constants (`basic1: 1`, `basic2: 2`, `basic3: 1`), the caller's uin, the group
// id and `type: 0`.
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   Oidb0x8a7Req            reference/index.mjs:204640 / 204672 (write)
//     1  basic1   uint32    constant 1
//     2  basic2   uint32    constant 2
//     3  basic3   uint32    constant 1
//     4  uin      uint64    the caller's own uin (from ctx.identity.uin)
//     5  groupId  uint64
//    12  type     uint32    constant 0 -> `!== 0` rule drops it
//
//   ⚠️ Field 12 is the first gap. `__size_Oidb0x8a7Req` (§204640) skips 6..11
//   entirely and the writer's tag bytes are `8,16,24,32,40` for 1..5 then `96`
//   for field 12. So the six constants live at 1/2/3 and the two real values at
//   4/5 — writing uin at 3 would pass a shape check and hit the server's
//   basic3.
//
//   Oidb0x8a7Resp           reference/index.mjs:204996 (decode only)
//     2  uinRemain    uint32
//     3  groupRemain  uint32
//     4  msg          string
//     6  canAtAll     uint32
//
//   ⚠️ The response starts at field **2**, not 1, and the text field is 4 while
//   `canAtAll` is 6. Field 1 and field 5 do not exist in the decoder, so a
//   response builder that packs remain-counters at 1/2 decodes to zeros.
//
// ---------------------------------------------------------------------------
// The result is remapped, not passed through
// ---------------------------------------------------------------------------
// `deserialize` (reference/index.mjs:205155) renames every field and defaults
// the two counters with `?? 0`, so a message that omits field 2 yields 0 rather
// than undefined. `can_at_all` is `!!body.canAtAll`, i.e. `0` and `null` both
// become false. The reference never throws here — a "cannot @ all" account is a
// valid answer, not an error.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 2215 = 0x8a7. */
export const GET_AT_ALL_REMAIN_COMMAND = 0x8a7;

/** The only sub-command; there is no `_N` variant of this command. */
export const GET_AT_ALL_REMAIN_SUB_COMMAND = 0;

export const Oidb0x8a7ReqField = {
  basic1: 1,
  basic2: 2,
  basic3: 3,
  uin: 4,
  groupId: 5,
  type: 12,
} as const;

export const Oidb0x8a7RespField = {
  uinRemain: 2,
  groupRemain: 3,
  msg: 4,
  canAtAll: 6,
} as const;

/** The three constants `serialize` hard-codes (reference/index.mjs:205147-205149). */
export const GET_AT_ALL_REMAIN_BASIC = { basic1: 1, basic2: 2, basic3: 1 } as const;

export interface Oidb0x8a7Req {
  basic1: number;
  basic2: number;
  basic3: number;
  /** The caller's uin — uint64, so a bigint even though it is usually small. */
  uin: bigint;
  groupId: bigint;
  /** Constant 0 in the reference, therefore never emitted. */
  type: number;
}

export function encodeOidb0x8a7Req(body: Oidb0x8a7Req): Uint8Array {
  return new ProtoWriter()
    .uint32(Oidb0x8a7ReqField.basic1, body.basic1)
    .uint32(Oidb0x8a7ReqField.basic2, body.basic2)
    .uint32(Oidb0x8a7ReqField.basic3, body.basic3)
    .uint64(Oidb0x8a7ReqField.uin, body.uin)
    .uint64(Oidb0x8a7ReqField.groupId, body.groupId)
    // Always 0 -> dropped by the `!== 0` rule. Kept in the struct so a future
    // caller cannot "helpfully" set it without the type system noticing.
    .uint32(Oidb0x8a7ReqField.type, body.type)
    .finish();
}

export interface Oidb0x8a7Resp {
  uinRemain?: number;
  groupRemain?: number;
  msg?: string;
  canAtAll?: number;
}

export function decodeOidb0x8a7Resp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): Oidb0x8a7Resp {
  const reader = new ProtoReader(data, offset, end);
  const response: Oidb0x8a7Resp = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Oidb0x8a7RespField.uinRemain, WireType.varint):
        response.uinRemain = reader.uint32();
        break;
      case tagOf(Oidb0x8a7RespField.groupRemain, WireType.varint):
        response.groupRemain = reader.uint32();
        break;
      case tagOf(Oidb0x8a7RespField.msg, WireType.lengthDelimited):
        response.msg = reader.string();
        break;
      case tagOf(Oidb0x8a7RespField.canAtAll, WireType.varint):
        response.canAtAll = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return response;
}

/** The action-shaped answer, matching the reference's `deserialize` keys exactly. */
export interface AtAllRemain {
  can_at_all: boolean;
  remain_at_all_count_for_group: number;
  remain_at_all_count_for_uin: number;
}

export function toAtAllRemain(body: Oidb0x8a7Resp): AtAllRemain {
  return {
    can_at_all: !!body.canAtAll,
    remain_at_all_count_for_group: Number(body.groupRemain ?? 0),
    remain_at_all_count_for_uin: Number(body.uinRemain ?? 0),
  };
}

export interface GetAtAllRemainParams {
  groupId: number | bigint;
  /**
   * The caller's own uin.
   *
   * The reference reads it from `ctx.identity.uin` inside `serialize`
   * (reference/index.mjs:205150), which our ctx-free spec cannot do — so it is a
   * parameter. Getting it wrong is not a silent failure: the server answers for
   * the other account's quota, which is why the goldens pin it explicitly.
   */
  selfUin: number | bigint;
}

export const GetAtAllRemain: OidbSpec<
  GetAtAllRemainParams,
  Oidb0x8a7Req,
  Oidb0x8a7Resp,
  AtAllRemain
> = {
  command: GET_AT_ALL_REMAIN_COMMAND,
  subCommand: GET_AT_ALL_REMAIN_SUB_COMMAND,
  serialize: (params) => ({
    basic1: GET_AT_ALL_REMAIN_BASIC.basic1,
    basic2: GET_AT_ALL_REMAIN_BASIC.basic2,
    basic3: GET_AT_ALL_REMAIN_BASIC.basic3,
    uin: BigInt(params.selfUin),
    groupId: BigInt(params.groupId),
    type: 0,
  }),
  encodeBody: encodeOidb0x8a7Req,
  decodeBody: decodeOidb0x8a7Resp,
  deserialize: toAtAllRemain,
};