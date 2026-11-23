// `MiscApi` — the reference's `misc` hub slot.
//
// Reference region: reference/index.mjs:317267-317300 (`getMiniAppArk`).
//
// ---------------------------------------------------------------------------
// Why only one method
// ---------------------------------------------------------------------------
// The reference's `misc` slot holds a dozen members (inline-keyboard clicks, group
// sign-in, database keys, …). Only ONE of them is reachable from an action that this
// port still has as a gap, and that is `getMiniAppArk`. Adding the others would mean
// typing members with no caller — the exact "declared but never exercised" surface the
// hub documents as `never`. They are added when an action needs them.
//
// ---------------------------------------------------------------------------
// The transport is NOT OIDB
// ---------------------------------------------------------------------------
// `LightAppSvc.mini_app_share.AdaptShareInfo` is a bare `sendRawPacket` service: no
// command number, no `{cmd, svc, result, body}` envelope. The request is the
// `MiniAppShareReq` protobuf and the response is `MiniAppShareResp`, whose `body.jsonStr`
// is a JSON DOCUMENT — the actual card arrives as a string inside protobuf, so there are
// two independent decode layers and a failure in either produces a different error.
//
// ---------------------------------------------------------------------------
// The response is reshaped, and the reshuffle is not cosmetic
// ---------------------------------------------------------------------------
// The server's JSON uses different key names than the action's schema:
//
//   parsed.appName   → app      parsed.metaData  → meta
//   parsed.appView   → view
//
// `miniappShareOrigin: 3` and `miniappOpenRefer: "10002"` are CONSTANTS the reference
// stamps on (reference:317293-317294) — they are not in the server's payload. A client
// that receives the raw server keys instead would render a blank card, which looks like
// a server problem rather than a port bug.

import type { BridgeContext } from "../context.js";
import { oidbCaller } from "../oidb-invoke.js";
import {
  ClickInlineKeyboardButton,
  ImageOcr,
  RequestDbKey,
  SendGroupSign,
  TranslateEnToZh,
  requestDbKeyResult,
} from "../../oidb/services/index.js";

/** The one wire service this module speaks directly (the rest go through `oidbCaller`). */
const MINI_APP_SHARE_SERVICE = "LightAppSvc.mini_app_share.AdaptShareInfo";

// Every other method here is a thin wrapper over an `OidbSpec` that ALREADY existed in
// `src/oidb/services/`. They were missing from this class, which made five live actions
// crash at runtime with `TypeError: ... is not a function` — the specs were ported, the
// forwarders were not. Building the callers once at module scope keeps the per-call cost
// to one property read, exactly like the slices that were wired correctly.
const clickInlineKeyboardButtonCall = oidbCaller(ClickInlineKeyboardButton);
const requestDbKeyCall = oidbCaller(RequestDbKey);
const imageOcrCall = oidbCaller(ImageOcr);
const sendGroupSignCall = oidbCaller(SendGroupSign);
const translateEnToZhCall = oidbCaller(TranslateEnToZh);

/**
 * `sdkVersion` — a literal, and a deliberately absurd one.
 *
 * `99.99.99` is what the reference sends (reference:317276). It is not a version we
 * invented and it is not a typo: the server accepts it, and "fixing" it to a real SDK
 * version is the kind of well-intentioned change that gets the request refused.
 */
const MINI_APP_SDK_VERSION = "V1_PC_MINISDK_99.99.99_1_APP_A";

/** Per-app constants: the appid and the icon the card shows. */
const MINI_APP_ICONS = {
  bili: {
    appid: "1109937557",
    iconUrl: "http://miniapp.gtimg.cn/public/appicon/51f90239b78a2e4994c11215f4c4ba15_200.jpg",
  },
  weibo: {
    appid: "1109224783",
    iconUrl: "http://miniapp.gtimg.cn/public/appicon/35bbb44dc68e65194cfacfb206b8f1f7_200.jpg",
  },
} as const;

export type MiniAppArkType = keyof typeof MINI_APP_ICONS;

/** The card object the action returns, in the action's own key names. */
export interface MiniAppArk {
  ver: unknown;
  prompt: unknown;
  config: unknown;
  app: unknown;
  view: unknown;
  meta: unknown;
  miniappShareOrigin: 3;
  miniappOpenRefer: "10002";
}

/** A protobuf field writer, kept local so this file needs no shared helper. */
function writeTag(out: number[], fieldNumber: number, wireType: number): void {
  let value = (fieldNumber << 3) | wireType;
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    out.push(byte);
  } while (value !== 0);
}

function writeLengthDelimited(out: number[], fieldNumber: number, value: string): void {
  // An EMPTY string is OMITTED, not written as a zero-length field. The reference's own
  // encoder checks `!= null && !== ""` for all six strings (reference:316839-316869), so a
  // request with an empty `desc` is shorter than one with any desc — and a server comparing
  // request shapes would notice the difference.
  if (value === "") return;
  const bytes = new TextEncoder().encode(value);
  writeTag(out, fieldNumber, 2);
  let length = bytes.length;
  do {
    let byte = length & 0x7f;
    length >>>= 7;
    if (length !== 0) byte |= 0x80;
    out.push(byte);
  } while (length !== 0);
  for (const byte of bytes) out.push(byte);
}

/**
 * `MiniAppShareReq { f1 sdkVersion : string, f2 body : MiniAppShareReqBody }`.
 *
 * `MiniAppShareReqBody` is six consecutive strings, fields 1..6:
 * `appid, title, desc, picUrl, jumpUrl, iconUrl` (reference:316833-316838).
 */
export function encodeMiniAppShareReq(params: {
  sdkVersion: string;
  appid: string;
  title: string;
  desc: string;
  picUrl: string;
  jumpUrl: string;
  iconUrl: string;
}): Uint8Array {
  const body: number[] = [];
  writeLengthDelimited(body, 1, params.appid);
  writeLengthDelimited(body, 2, params.title);
  writeLengthDelimited(body, 3, params.desc);
  writeLengthDelimited(body, 4, params.picUrl);
  writeLengthDelimited(body, 5, params.jumpUrl);
  writeLengthDelimited(body, 6, params.iconUrl);

  const out: number[] = [];
  writeLengthDelimited(out, 1, params.sdkVersion);
  writeTag(out, 2, 2);
  let length = body.length;
  do {
    let byte = length & 0x7f;
    length >>>= 7;
    if (length !== 0) byte |= 0x80;
    out.push(byte);
  } while (length !== 0);
  out.push(...body);
  return new Uint8Array(out);
}

/** Read one varint, advancing `state.at`. */
function readVarint(data: Uint8Array, state: { at: number }): number {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (state.at >= data.length) throw new Error("truncated protobuf varint");
    const byte = data[state.at++]!;
    if (shift < 32) result |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) === 0) return result >>> 0;
  }
}

/**
 * `MiniAppShareResp { f1 …, f2 body : { …, f? jsonStr } }` — only `body.jsonStr` is read.
 *
 * `jsonStr` is protobuf field 3 inside `body` in the reference's schema. The decoder walks
 * every field and keeps the last `jsonStr` it sees, which is what a protobuf parser does
 * for a singular field seen twice.
 */
export function decodeMiniAppShareResp(data: Uint8Array): string | null {
  const state = { at: 0 };
  let jsonStr: string | null = null;
  while (state.at < data.length) {
    const tag = readVarint(data, state);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x7;
    if (wireType === 2) {
      const length = readVarint(data, state);
      const end = state.at + length;
      if (end > data.length) throw new Error("truncated protobuf field");
      if (fieldNumber === 2) {
        // `body` — re-scan it for `jsonStr`.
        const inner = data.subarray(state.at, end);
        const innerState = { at: 0 };
        while (innerState.at < inner.length) {
          const innerTag = readVarint(inner, innerState);
          const innerField = innerTag >>> 3;
          const innerWire = innerTag & 0x7;
          if (innerWire === 2) {
            const innerLength = readVarint(inner, innerState);
            const innerEnd = innerState.at + innerLength;
            if (innerEnd > inner.length) throw new Error("truncated protobuf field");
            if (innerField === 3) {
              jsonStr = new TextDecoder().decode(inner.subarray(innerState.at, innerEnd));
            }
            innerState.at = innerEnd;
          } else if (innerWire === 0) {
            readVarint(inner, innerState);
          } else if (innerWire === 5) {
            innerState.at += 4;
          } else if (innerWire === 1) {
            innerState.at += 8;
          } else {
            throw new Error(`unsupported wire type ${innerWire}`);
          }
        }
      }
      state.at = end;
    } else if (wireType === 0) {
      readVarint(data, state);
    } else if (wireType === 5) {
      state.at += 4;
    } else if (wireType === 1) {
      state.at += 8;
    } else {
      throw new Error(`unsupported wire type ${wireType}`);
    }
  }
  return jsonStr;
}

export class MiscApi {
  readonly #ctx: BridgeContext;

  constructor(ctx: BridgeContext) {
    this.#ctx = ctx;
  }

  /**
   * `get_mini_app_ark` — build a mini-program share card.
   *
   * The card is FETCHED, not assembled locally: `AdaptShareInfo` answers a JSON document
   * with the rendered `config`/`view`/`meta`, which no local code could synthesise.
   *
   * `type` defaults to `bili` and anything other than `bili`/`weibo` is refused BEFORE a
   * request (reference:317273 `unsupported type: …, only support bili and weibo`). An
   * unknown type is a caller error, not something the server should be asked about.
   */
  async getMiniAppArk(
    type: string,
    title: string,
    desc: string,
    picUrl: string,
    jumpUrl: string,
  ): Promise<MiniAppArk> {
    const resolvedType = type === "" ? "bili" : type;
    if (resolvedType !== "bili" && resolvedType !== "weibo") {
      throw new Error(`unsupported type: ${resolvedType}, only support bili and weibo`);
    }
    const icons = MINI_APP_ICONS[resolvedType];
    const request = encodeMiniAppShareReq({
      sdkVersion: MINI_APP_SDK_VERSION,
      appid: icons.appid,
      title,
      desc,
      picUrl,
      jumpUrl,
      iconUrl: icons.iconUrl,
    });
    const result = await this.#ctx.sendRawPacket(MINI_APP_SHARE_SERVICE, request);
    // The reference checks `!success || !responseData` as ONE condition and reports
    // `result.errorMessage || "get mini app ark failed"` — so an empty response with no
    // error message gets the generic wording, not "no response".
    if (!result.success || !result.responseData) {
      throw new Error(result.errorMessage || "get mini app ark failed");
    }
    const jsonStr = decodeMiniAppShareResp(result.responseData);
    if (!jsonStr) throw new Error("mini app share json empty");
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    // The key reshuffle is load-bearing: `appName`/`appView`/`metaData` are the server's
    // names, and the action's schema declares `app`/`view`/`meta`.
    return {
      ver: parsed.ver,
      prompt: parsed.prompt,
      config: parsed.config,
      app: parsed.appName,
      view: parsed.appView,
      meta: parsed.metaData,
      miniappShareOrigin: 3,
      miniappOpenRefer: "10002",
    };
  }

  /**
   * `click_inline_keyboard_button` — press a button on a bot's inline keyboard.
   *
   * The provider RESULT is the response data (see the action's own note): the server
   * answers command-specific fields, so the value is passed through untouched rather
   * than projected onto a shape this port would have to invent.
   *
   * `botAppid`/`msgSeq` are positional here because that is the reference's signature
   * (reference MiscApi.clickInlineKeyboardButton); the action supplies them in that order.
   */
  clickInlineKeyboardButton(
    groupId: number,
    botAppid: number,
    buttonId: string,
    callbackData: string,
    msgSeq: number,
  ): Promise<unknown> {
    return clickInlineKeyboardButtonCall.invoke(this.#ctx, {
      groupId,
      botAppid,
      buttonId,
      callbackData,
      msgSeq,
    });
  }

  /**
   * `get_decrypt_key` — fetch the key that decrypts a QQ message database.
   *
   * Two DISTINCT failures, and the reference distinguishes them: a failed request
   * carries the server's own message (falling back to the numeric code), while a
   * successful request that answers an EMPTY key is its own error. Collapsing them would
   * make "the server said no" indistinguishable from "the server said yes with nothing",
   * which are different operator problems.
   */
  async getDecryptKey(dbSalt: string): Promise<string> {
    // `requestDbKeyResult` exists precisely for this split: action callers must be able to
    // tell a WRONG-DATABASE code (1006, with its own Chinese wording) from a transport
    // failure, and an exception cannot carry that distinction to a OneBot caller.
    const result = await requestDbKeyResult(() =>
      requestDbKeyCall.invoke(this.#ctx, { db_salt: dbSalt }),
    );
    if (!result.success) {
      throw new Error(result.errorMsg || `Failed to get decrypt key (code: ${result.errorCode})`);
    }
    if (!result.dbKey) throw new Error("Decrypt key is empty");
    return result.dbKey;
  }

  /** `ocr_image` — optical character recognition over an image URL. */
  ocrImage(imageUrl: string): Promise<unknown> {
    return imageOcrCall.invoke(this.#ctx, { imageUrl });
  }

  /** `send_group_sign` — group sign-in (打卡). */
  async sendGroupSign(groupId: number): Promise<void> {
    // `selfUin` is a REQUIRED field of the request and the signature takes only the group,
    // so it is read from the identity here — which is what the reference does too
    // (`SendGroupSignParams.selfUin` is documented as "read from ctx.identity.uin").
    await sendGroupSignCall.invoke(this.#ctx, { groupId, selfUin: this.#ctx.identity.uin });
  }

  /** `translate_en2zh` — translate English words to Chinese. */
  translateEn2Zh(words: readonly string[]): Promise<unknown> {
    // `TranslateEnToZhParams.words` is a mutable array in the spec; spreading keeps the
    // public signature read-only without mutating the caller's list.
    return translateEnToZhCall.invoke(this.#ctx, { words: [...words] });
  }
}
