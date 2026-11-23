// OidbSvcTrpcTcp.0xf16_1 — the caller's own remark (local alias) for a group.
//
// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------
// The batch brief said `SetGroupRemark` and the reference agrees:
// `var SetGroupRemark` with `command = 3862 / 0xf16`, `subCommand = 1`
// (reference/index.mjs:221635-221636). No `uinForm`.
//
// This is a *local* label, not a group setting: it changes how this account sees
// the group in its own list. Nothing about the group itself moves, and no other
// member can observe it — which is why the response is `OidbEmpty` and the
// `deserialize` discards the body entirely.
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   Oidb0xf16Req            reference/index.mjs:221513 / 221532 (write)
//     1  inner    message   always present (`!= null`)
//    12  field12  uint32    constant 0 -> dropped
//
//   Oidb0xf16Inner          reference/index.mjs:221586 / 221599 (write)
//     1  groupId  **uint64**  (the outer wrapper's group is not here — this is
//                              the only group number in the message)
//     3  remark   string     **field 3, and `!= null && !== ""`**
//
//   ⚠️ Two things surprise here:
//     * `remark` is field **3**, not 2. `__write_Oidb0xf16Inner` emits tag `26`
//       = 3<<3|2. A remark written at field 2 (`12`) is simply an unknown field
//       to the server and the call succeeds without changing anything.
//     * `groupId` is uint64 here (`__writeVarint64$24`), unlike `0x89a_15`'s
//       rename which uses uint32 for the same value.
//
//   The empty-remark case is a genuinely distinct request. Because the guard is
//   `!= null && !== ""`, `remark: ""` produces an inner message with ONLY the
//   group id (`0a 05 08 ...`) — there is no field 3 at all. That is what
//   "clear the remark" looks like on the wire, and golden `groupremark_empty`
//   pins it: one byte shorter than a non-empty remark would be, and with the
//   inner message still present.

import { ProtoReader, ProtoWriter, UnknownFieldCollector } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 3862 = 0xf16. */
export const GROUP_REMARK_COMMAND = 0xf16;

/** The only sub-command on this command. */
export const GROUP_REMARK_SUB_COMMAND = 1;

export const Oidb0xf16ReqField = { inner: 1, field12: 12 } as const;
export const Oidb0xf16InnerField = { groupId: 1, remark: 3 } as const;

export interface Oidb0xf16Inner {
  groupId: bigint;
  /** `!= null && !== ""`: empty means "clear", and is encoded as an absent field. */
  remark: string;
}

export interface Oidb0xf16Req {
  inner: Oidb0xf16Inner;
  /** Constant 0 in the reference, therefore never emitted. */
  field12: number;
}

export function encodeOidb0xf16Inner(inner: Oidb0xf16Inner): Uint8Array {
  return new ProtoWriter()
    .uint64(Oidb0xf16InnerField.groupId, inner.groupId)
    // `.string` is the `!= null && !== ""` rule, i.e. exactly the reference's
    // guard — an empty remark drops field 3 and leaves a group-only inner message.
    .string(Oidb0xf16InnerField.remark, inner.remark)
    .finish();
}

export function encodeOidb0xf16Req(body: Oidb0xf16Req): Uint8Array {
  return new ProtoWriter()
    // `_f0 != null`, so the inner message is emitted even when it would be empty.
    .message(Oidb0xf16ReqField.inner, encodeOidb0xf16Inner(body.inner))
    .uint32(Oidb0xf16ReqField.field12, body.field12)
    .finish();
}

/** The response is `OidbEmpty$13` (reference/index.mjs:221636). */
export interface GroupRemarkResp {
  readonly _empty?: never;
}

export function decodeGroupRemarkResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupRemarkResp {
  const reader = new ProtoReader(data, offset, end);
  const unknown = new UnknownFieldCollector();
  while (reader.next()) reader.skip(unknown);
  return {};
}

export interface SetGroupRemarkParams {
  groupId: number | bigint;
  remark: string;
}

export const SetGroupRemark: OidbSpec<SetGroupRemarkParams, Oidb0xf16Req, GroupRemarkResp, void> = {
  command: GROUP_REMARK_COMMAND,
  subCommand: GROUP_REMARK_SUB_COMMAND,
  serialize: (params) => ({
    inner: { groupId: BigInt(params.groupId), remark: params.remark },
    field12: 0,
  }),
  encodeBody: encodeOidb0xf16Req,
  decodeBody: decodeGroupRemarkResp,
  deserialize: () => undefined,
};
