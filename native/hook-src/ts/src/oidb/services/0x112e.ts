// OidbSvcTrpcTcp.0x112e_1 — `click_inline_keyboard_button`.
//
// ---------------------------------------------------------------------------
// What this command is
// ---------------------------------------------------------------------------
// Pressing a button on an inline keyboard that a bot attached to a message.  The
// request identifies the bot app, the message, and which button; the reply tells
// the caller what the bot wants to show next (a prompt, or an error).
//
// The action name in ONEBOT-ACTION-SPEC.md is
// `click_inline_keyboard_button`, and it is one of the few commands whose OneBot
// surface is a *raw* pass-through: the reply fields `promptText` / `promptType` /
// `promptIcon` are forwarded to the caller as-is rather than being interpreted.
//
// ---------------------------------------------------------------------------
// Field numbers              (reference/index.mjs:310499 .. 310607)
// ---------------------------------------------------------------------------
//   Oidb0x112eReq
//     1 field1      -- DOES NOT EXIST in the reference encoder; the message
//                      starts at 3.  See below.
//     3 botAppid     uint64
//     4 msgSeq       uint64
//     5 buttonId     string
//     6 callbackData string
//     7 unknown7     uint32   hard-coded 0 (so never written)
//     8 groupId      uint64
//     9 unknown9     uint32   hard-coded 1 (always written)
//
// The request numbers start at **3**: fields 1 and 2 are absent from the message
// definition entirely, which is normal for a message that was extended in place.
// A "tidy" renumbering from 1 would produce a request the server cannot read.
//
// ---------------------------------------------------------------------------
// Response                (reference/index.mjs:310847 .. 310885)
// ---------------------------------------------------------------------------
//   Oidb0x112eResp
//     3 result     uint32
//     4 promptText string
//     5 errMsg     string
//
// The response *also* starts at 3, mirroring the request — a second place where
// assuming 1-based numbering goes wrong.  `deserialize` projects to
// `{result, errMsg, status: 0, promptText, promptType: 0, promptIcon: 0}`
// (reference/index.mjs:310958): the three zero fields are constants, not decoded
// values, and are kept so the shape matches what the OneBot action forwards.
//
// ---------------------------------------------------------------------------
// uinForm: none
// ---------------------------------------------------------------------------
// `_ClickInlineKeyboardButton` does not set `uinForm`
// (reference/index.mjs:310952), so `reserved` is 0.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 4398 = 0x112e. */
export const CLICK_INLINE_KEYBOARD_COMMAND = 0x112e;

/** 1 — the only sub-command used. */
export const CLICK_INLINE_KEYBOARD_SUB_COMMAND = 1;

export const Oidb0x112eReqField = {
  botAppid: 3,
  msgSeq: 4,
  buttonId: 5,
  callbackData: 6,
  unknown7: 7,
  groupId: 8,
  unknown9: 9,
} as const;

export const Oidb0x112eRespField = { result: 3, promptText: 4, errMsg: 5 } as const;

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface Oidb0x112eReq {
  botAppid: bigint;
  msgSeq: bigint;
  buttonId: string;
  callbackData: string;
  unknown7: number;
  groupId: bigint;
  unknown9: number;
}

export function encodeOidb0x112eReq(body: Oidb0x112eReq): Uint8Array {
  return new ProtoWriter()
    .uint64(Oidb0x112eReqField.botAppid, body.botAppid)
    .uint64(Oidb0x112eReqField.msgSeq, body.msgSeq)
    .string(Oidb0x112eReqField.buttonId, body.buttonId)
    .string(Oidb0x112eReqField.callbackData, body.callbackData)
    .uint32(Oidb0x112eReqField.unknown7, body.unknown7)
    .uint64(Oidb0x112eReqField.groupId, body.groupId)
    .uint32(Oidb0x112eReqField.unknown9, body.unknown9)
    .finish();
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface Oidb0x112eResp {
  /** Field 3 on the wire; there is no field 1 or 2. */
  result: number;
  promptText: string;
  errMsg: string;
}

export function decodeOidb0x112eResp(data: Uint8Array, offset = 0, end = data.length): Oidb0x112eResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: Oidb0x112eResp = { result: 0, promptText: "", errMsg: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Oidb0x112eRespField.result, WireType.varint):
        resp.result = reader.uint32();
        break;
      case tagOf(Oidb0x112eRespField.promptText, WireType.lengthDelimited):
        resp.promptText = reader.string();
        break;
      case tagOf(Oidb0x112eRespField.errMsg, WireType.lengthDelimited):
        resp.errMsg = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

export interface ClickInlineKeyboardButtonParams {
  botAppid: number | bigint;
  msgSeq: number | bigint;
  buttonId: string;
  /** Optional: an absent value is sent as `""` (dropped by the string rule). */
  callbackData?: string | undefined;
  groupId: number | bigint;
}

/** The action reply, matching the reference's projection (three constants). */
export interface ClickInlineKeyboardButtonResult {
  result: number;
  errMsg: string;
  status: number;
  promptText: string;
  promptType: number;
  promptIcon: number;
}

/**
 * `click_inline_keyboard_button`.
 *
 * `callbackData` defaults to `""` (the reference does `String(p.callbackData ||
 * "")`), which means field 6 is omitted.  That is a real distinction the server
 * uses: a button with no callback data is a "link" button and answers with a
 * prompt instead of a callback ack.
 */
export const ClickInlineKeyboardButton: OidbSpec<
  ClickInlineKeyboardButtonParams,
  Oidb0x112eReq,
  Oidb0x112eResp,
  ClickInlineKeyboardButtonResult
> = {
  command: CLICK_INLINE_KEYBOARD_COMMAND,
  subCommand: CLICK_INLINE_KEYBOARD_SUB_COMMAND,
  serialize: (params) => ({
    botAppid: BigInt(params.botAppid),
    msgSeq: BigInt(params.msgSeq),
    buttonId: String(params.buttonId),
    callbackData: String(params.callbackData || ""),
    unknown7: 0,
    groupId: BigInt(params.groupId),
    unknown9: 1,
  }),
  encodeBody: encodeOidb0x112eReq,
  decodeBody: decodeOidb0x112eResp,
  deserialize: (body) => ({
    result: body.result ?? 0,
    errMsg: body.errMsg ?? "",
    status: 0,
    promptText: body.promptText ?? "",
    promptType: 0,
    promptIcon: 0,
  }),
};
