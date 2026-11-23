// OidbSvcTrpcTcp.0x102a_0 — GetPskey, and 0x102a_1 — ForceFetchClientKey.
//
// ---------------------------------------------------------------------------
// Why this pair is the keystone
// ---------------------------------------------------------------------------
// 41 of the HTTP-backed OneBot actions ride on QQ's web endpoints, and those
// endpoints want cookies.  Two OIDB calls mint the material for those cookies:
//
//   0x102a_0  GetPskey            -> p_skey per domain
//   0x102a_1  ForceFetchClientKey -> clientkey (+ keyindex, ttl)
//
// `getCookies` (reference/index.mjs:338972) calls *only* these two and then
// hits `ssl.ptlogin2.qq.com/jump`, so every web action inherits their
// correctness.  Getting a field number wrong here breaks dozens of actions at
// once, which is why they were extracted first.
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
// All read from the generated codec, none guessed:
//   OidbGetPskeyReq    reference/index.mjs:41909 (__write_...)
//                       1 domainList  repeated string
//   OidbGetPskeyResp   reference/index.mjs:42367 (protobuf_decode_...)
//                       1 pskeyItems  repeated OidbPskeyItem
//     OidbPskeyItem    reference/index.mjs:42454
//                       1 domain      string
//                       2 pskey       string
//                       3 expireTime  uint64
//   OidbClientKeyReq   reference/index.mjs:338050 — body has no fields at all
//                      (`__size_OidbClientKeyReq` returns 0)
//   OidbClientKeyResp  reference/index.mjs:338475 (protobuf_decode_...)
//                       2 keyIndex    uint32
//                       3 clientKey   string
//                       4 expireTime  uint32
//
// Note the two responses number their fields differently: pskey's expireTime is
// field 3, clientkey's expireTime is field 4 and its keyIndex is field 2.  A
// shared "expireTime is field 3" assumption would silently zero clientkey's TTL.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

// ---------------------------------------------------------------------------
// 0x102a_0 — GetPskey
// ---------------------------------------------------------------------------

/** Command id: 4138 = 0x102a. Both halves of the pair share it. */
export const GET_PSKEY_COMMAND = 0x102a;

export const GetPskeyReqField = { domainList: 1 } as const;

export const PskeyItemField = { domain: 1, pskey: 2, expireTime: 3 } as const;

export const GetPskeyRespField = { pskeyItems: 1 } as const;

export interface GetPskeyReq {
  domainList: string[];
}

export interface PskeyItem {
  domain: string;
  pskey: string;
  expireTime: bigint;
}

export interface GetPskeyResp {
  pskeyItems: PskeyItem[];
}

export function encodeGetPskeyReq(body: GetPskeyReq): Uint8Array {
  return new ProtoWriter().repeatedString(GetPskeyReqField.domainList, body.domainList).finish();
}

export function encodePskeyItem(item: PskeyItem): Uint8Array {
  return new ProtoWriter()
    .string(PskeyItemField.domain, item.domain)
    .string(PskeyItemField.pskey, item.pskey)
    .uint64(PskeyItemField.expireTime, item.expireTime)
    .finish();
}

export function decodePskeyItem(data: Uint8Array, offset = 0, end = data.length): PskeyItem {
  const reader = new ProtoReader(data, offset, end);
  const item: PskeyItem = { domain: "", pskey: "", expireTime: 0n };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(PskeyItemField.domain, WireType.lengthDelimited):
        item.domain = reader.string();
        break;
      case tagOf(PskeyItemField.pskey, WireType.lengthDelimited):
        item.pskey = reader.string();
        break;
      case tagOf(PskeyItemField.expireTime, WireType.varint):
        item.expireTime = reader.uint64();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return item;
}

export function decodeGetPskeyResp(data: Uint8Array, offset = 0, end = data.length): GetPskeyResp {
  const reader = new ProtoReader(data, offset, end);
  const pskeyItems: PskeyItem[] = [];
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GetPskeyRespField.pskeyItems, WireType.lengthDelimited):
        pskeyItems.push(reader.message(decodePskeyItem));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return { pskeyItems };
}

/** Action-level input for `GetPskey`. */
export interface GetPskeyParams {
  domainList: string[];
}

/** The business result: domain -> pskey, with the empty pairs dropped. */
export interface GetPskeyResult {
  domainPskeyMap: Map<string, string>;
}

/**
 * GetPskey spec.
 *
 * `deserialize` drops items with an empty domain or an empty pskey before
 * building the map (reference/index.mjs:42561): a domain the server declined to
 * mint a key for comes back as an entry whose pskey is "", and inserting it
 * would make "no key" indistinguishable from "key is empty string" for callers
 * that test `if (pskey)`.
 */
export const GetPskey: OidbSpec<GetPskeyParams, GetPskeyReq, GetPskeyResp, GetPskeyResult> = {
  command: GET_PSKEY_COMMAND,
  subCommand: 0,
  serialize: (params) => ({ domainList: params.domainList }),
  encodeBody: encodeGetPskeyReq,
  decodeBody: decodeGetPskeyResp,
  deserialize: (body) => {
    const domainPskeyMap = new Map<string, string>();
    for (const item of body.pskeyItems) {
      if (item.domain && item.pskey) domainPskeyMap.set(item.domain, item.pskey);
    }
    return { domainPskeyMap };
  },
};

// ---------------------------------------------------------------------------
// 0x102a_1 — ForceFetchClientKey
// ---------------------------------------------------------------------------

export const FORCE_FETCH_CLIENT_KEY_COMMAND = 0x102a;

/** The request body is empty; `__size_OidbClientKeyReq` returns 0. */
export interface ClientKeyReq {
  readonly _empty?: never;
}

export const ClientKeyRespField = { keyIndex: 2, clientKey: 3, expireTime: 4 } as const;

export interface ClientKeyResp {
  keyIndex: number;
  clientKey: string;
  expireTime: number;
}

/** An empty body encodes to zero bytes — the envelope still emits field 4 as `22 00`. */
export function encodeClientKeyReq(_body: ClientKeyReq): Uint8Array {
  return new Uint8Array(0);
}

export function decodeClientKeyResp(data: Uint8Array, offset = 0, end = data.length): ClientKeyResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: ClientKeyResp = { keyIndex: 0, clientKey: "", expireTime: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(ClientKeyRespField.keyIndex, WireType.varint):
        resp.keyIndex = reader.uint32();
        break;
      case tagOf(ClientKeyRespField.clientKey, WireType.lengthDelimited):
        resp.clientKey = reader.string();
        break;
      case tagOf(ClientKeyRespField.expireTime, WireType.varint):
        resp.expireTime = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

/** The business result: all three values stringified, because they end up in a URL. */
export interface ClientKeyResult {
  clientKey: string;
  keyIndex: string;
  expireTime: string;
}

/**
 * ForceFetchClientKey spec.
 *
 * The reference stringifies all three and applies defaults of "19" for
 * keyIndex and "1800" for expireTime (reference/index.mjs:338580) — those are
 * the values `ssl.ptlogin2.qq.com/jump` tolerates when the response omits them,
 * so an absent field must not become the string "0".
 */
export const ForceFetchClientKey: OidbSpec<
  Record<string, never>,
  ClientKeyReq,
  ClientKeyResp,
  ClientKeyResult
> = {
  command: FORCE_FETCH_CLIENT_KEY_COMMAND,
  subCommand: 1,
  serialize: () => ({}),
  encodeBody: encodeClientKeyReq,
  decodeBody: decodeClientKeyResp,
  deserialize: (body) => ({
    clientKey: body.clientKey || "",
    keyIndex: String(body.keyIndex || "19"),
    expireTime: String(body.expireTime || "1800"),
  }),
};