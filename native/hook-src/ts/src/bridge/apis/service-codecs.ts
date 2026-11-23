// The four packets the `profile` / `contacts` slices send that are NOT OIDB.
//
// ---------------------------------------------------------------------------
// Why these are not in `ts/src/oidb/services/`
// ---------------------------------------------------------------------------
// The OIDB layer is one envelope (`OidbBase`) plus 92 bodies. These are not that:
// they name a bare trpc/Faceroam service and carry their own top-level message, so
// `invokeOidb` would emit an `OidbBase` frame the server does not accept
// (`0x902e-profile.ts` says the same thing about the same commands and
// deliberately returns codecs only).
//
//   Faceroam.OpReq                                        custom-face list / delete
//   trpc.basic.corp.Datacard.SsoCorpInfo                  qidian (企点) corp card
//   trpc.qq_new_tech.status_svc.StatusService.SetStatus   online status
//
// ---------------------------------------------------------------------------
// Every byte layout here is measured, not read
// ---------------------------------------------------------------------------
// Each encoder below is pinned in `test/bridge-slices.test.ts` against a golden
// produced by loading the reference's OWN generated encoder out of its region and
// calling it (`work/bridge-slices/extract.mjs` + `probe.mjs`). The probe output,
// verbatim:
//
//   faceroam_list    0a1c0801120a31302e302e32363230301a0c392e392e32382d343639323810914e18013001
//   faceroam_delete  0a0e0801120a31302e302e323632303010914e18022a320a30...5f305f30
//   faceroam_resp    {"retCode":null,"message":null,"field3":null,"item":{"faceIds":["aaa","bbb"],"category":"cat","totalCount":2}}
//   qidian_req       08914e
//   qidian_resp      {"corpName":"Acme","intro":"intro!","website":"site","slogan":"slogan","address":"addr","phone":"phone","email":"mail"}
//   setstatus_plain  080b10e8071864
//   setstatus_diy    080a10d00f22080801120268691802
//   setstatus_resp   {"errCode":0,"errMsg":"set status success"}
//   setstatus_empty  {"errCode":null,"errMsg":null}
//
// Three field-number traps are visible in those bytes and each one is a place a
// plausible guess goes wrong:
//
//   1. Faceroam's `item` is FIELD 4, not field 3 (field 3 is an unused scalar).
//      A response decoder that reads `1a` instead of `22` returns `item: null` for
//      every real list — silently empty, never an error.
//   2. Faceroam's request wraps the client environment in `inner` (field 1) with
//      `qqVersion` present for list but ABSENT for delete; that 14-byte difference
//      is the entire reason `makeInner` takes a boolean.
//   3. `QidianCorpInfoRequest` carries a uint32 uin at field 1 — 3 bytes for a
//      5-digit uin, not a uint64 uid string.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../../oidb/wire.js";

// ===========================================================================
// Shared: Faceroam.OpReq
// ===========================================================================

/** `FACEROAM_SERVICE` (reference/index.mjs:319329). */
export const FACEROAM_SERVICE = "Faceroam.OpReq";

/** `CLIENT_VERSION` (:319331) — shared by the Faceroam inner and 0x902e's body field 2. */
export const CLIENT_VERSION = "10.0.26200";

/** `LIST_QQ_VERSION` (:319333) — present on list, absent on delete. */
export const LIST_QQ_VERSION = "9.9.28-46928";

/**
 * The `inner` client-environment message (:319338 `makeInner`).
 *
 * `withQqVersion` is not a cosmetic flag: the list request carries `qqVersion`
 * and the delete request does not, and that is the only structural difference
 * between their inners.
 */
export function makeInner(withQqVersion: boolean): { field1: number; osVersion: string; qqVersion?: string } {
  const inner: { field1: number; osVersion: string; qqVersion?: string } = {
    field1: 1,
    osVersion: CLIENT_VERSION,
  };
  if (withQqVersion) inner.qqVersion = LIST_QQ_VERSION;
  return inner;
}

export const FaceroamOpReqInnerField = { field1: 1, osVersion: 2, qqVersion: 3 } as const;
export const FaceroamOpReqField = { inner: 1, uin: 2, field3: 3, body: 5, field6: 6 } as const;
export const FaceroamOpBodyField = { emojiId: 1 } as const;
export const FaceroamOpRespField = { retCode: 1, message: 2, field3: 3, item: 4 } as const;
export const FaceroamOpRespItemField = { faceIds: 1, category: 3, totalCount: 4 } as const;

/** The in-body selector, copied from the reference's `serialize` calls. */
export const FACEROAM_OP = { list: 1, delete: 2 } as const;

export interface FaceroamOpReqInner {
  field1: number;
  osVersion: string;
  qqVersion?: string | undefined;
}

export interface FaceroamOpReq {
  inner: FaceroamOpReqInner;
  uin: bigint;
  /** The operation: 1 = list, 2 = delete. */
  field3: number;
  body?: { emojiId: string } | undefined;
  /**
   * Field 6 — present on LIST only.
   *
   * ⚠️ The reference's two `serialize` functions differ here and nowhere else that
   * matters: `FetchCustomFaceList` sets `field6: 1`
   * (reference/index.mjs:322092-322097) while `DeleteCustomFace` does NOT set it at
   * all (:319776-319781). Sending `1` on a delete appends a trailing `30 01` the
   * server does not expect. A golden-byte test caught exactly that, which is why
   * this is optional rather than a constant.
   */
  field6?: number | undefined;
}

export function encodeFaceroamOpReqInner(inner: FaceroamOpReqInner): Uint8Array {
  return new ProtoWriter()
    .uint32(FaceroamOpReqInnerField.field1, inner.field1)
    .string(FaceroamOpReqInnerField.osVersion, inner.osVersion)
    .string(FaceroamOpReqInnerField.qqVersion, inner.qqVersion)
    .finish();
}

export function encodeFaceroamOpBody(body: { emojiId: string }): Uint8Array {
  return new ProtoWriter().string(FaceroamOpBodyField.emojiId, body.emojiId).finish();
}

/**
 * The whole `FaceroamOpReq` body.
 *
 * Presence rules, all from the generated writer:
 *   field 1 `inner`      `!= null`             -> always present
 *   field 2 `uin`        `!= null && !== 0n`   -> dropped for uin 0
 *   field 3 `field3`     `!= null && !== 0`    -> dropped for op 0
 *   field 5 `body`       `!= null`             -> present on delete, absent on list
 *   field 6 `field6`     `!= null && !== 0`    -> always 1 here
 */
export function encodeFaceroamOpReq(req: FaceroamOpReq): Uint8Array {
  const writer = new ProtoWriter()
    .message(FaceroamOpReqField.inner, encodeFaceroamOpReqInner(req.inner))
    .uint64(FaceroamOpReqField.uin, req.uin)
    .uint32(FaceroamOpReqField.field3, req.field3);
  if (req.body !== undefined) writer.message(FaceroamOpReqField.body, encodeFaceroamOpBody(req.body));
  // `uint32` drops 0 and `undefined` alike, so an absent `field6` produces no field.
  return writer.uint32(FaceroamOpReqField.field6, req.field6).finish();
}

export interface FaceroamOpRespItem {
  faceIds: string[];
  category: string;
  totalCount: number;
}

export interface FaceroamOpResp {
  retCode: number | null;
  message: string | null;
  field3: number | null;
  item: FaceroamOpRespItem | null;
}

export function decodeFaceroamOpResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FaceroamOpResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: FaceroamOpResp = { retCode: null, message: null, field3: null, item: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FaceroamOpRespField.retCode, WireType.varint):
        resp.retCode = reader.uint32();
        break;
      case tagOf(FaceroamOpRespField.message, WireType.lengthDelimited):
        resp.message = reader.string();
        break;
      case tagOf(FaceroamOpRespField.field3, WireType.varint):
        resp.field3 = reader.uint32();
        break;
      case tagOf(FaceroamOpRespField.item, WireType.lengthDelimited):
        resp.item = reader.message(decodeFaceroamOpRespItem);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export function decodeFaceroamOpRespItem(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FaceroamOpRespItem {
  const reader = new ProtoReader(data, offset, end);
  const item: FaceroamOpRespItem = { faceIds: [], category: "", totalCount: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FaceroamOpRespItemField.faceIds, WireType.lengthDelimited):
        // Repeated string, NON-packed: one `0a` per element.
        item.faceIds.push(reader.string());
        break;
      case tagOf(FaceroamOpRespItemField.category, WireType.lengthDelimited):
        item.category = reader.string();
        break;
      case tagOf(FaceroamOpRespItemField.totalCount, WireType.varint):
        item.totalCount = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return item;
}

// ===========================================================================
// trpc.basic.corp.Datacard.SsoCorpInfo — 企点 corp card
// ===========================================================================

/** `QIDIAN_CORP_INFO_CMD` (reference/index.mjs:68236). */
export const QIDIAN_CORP_INFO_CMD = "trpc.basic.corp.Datacard.SsoCorpInfo";

export const QidianCorpInfoRequestField = { uin: 1 } as const;
export const QidianCorpInfoResponseField = {
  corpName: 2,
  intro: 3,
  website: 4,
  slogan: 5,
  address: 6,
  phone: 7,
  email: 8,
} as const;

/**
 * The request is one uint32 at field 1 — the whole message.
 *
 * Note the presence rule is `!= null && !== 0`, so uin 0 produces a zero-byte
 * request rather than `08 00`. That matters only for an invalid caller, but the
 * rule is kept because "encode nothing" is what the reference would send.
 */
export function encodeQidianCorpInfoRequest(uin: number): Uint8Array {
  return new ProtoWriter().uint32(QidianCorpInfoRequestField.uin, uin).finish();
}

export interface QidianCorpInfo {
  name: string;
  intro: string;
  website: string;
  slogan: string;
  address: string;
  phone: string;
  email: string;
}

/**
 * Decode the corp card, or `null` when there is no usable name.
 *
 * The reference's `fetchCorpInfo` (:68243) returns `null` in three cases —
 * no response bytes, no `corpName`, and a failed decode is NOT caught (it throws)
 * — so `null` here means exactly "no corp name", which is the caller's signal
 * that this is not a 企点 account.
 */
export function decodeQidianCorpInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): QidianCorpInfo | null {
  const reader = new ProtoReader(data, offset, end);
  let corpName = "";
  let intro = "";
  let website = "";
  let slogan = "";
  let address = "";
  let phone = "";
  let email = "";
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(QidianCorpInfoResponseField.corpName, WireType.lengthDelimited):
        corpName = reader.string();
        break;
      case tagOf(QidianCorpInfoResponseField.intro, WireType.lengthDelimited):
        intro = reader.string();
        break;
      case tagOf(QidianCorpInfoResponseField.website, WireType.lengthDelimited):
        website = reader.string();
        break;
      case tagOf(QidianCorpInfoResponseField.slogan, WireType.lengthDelimited):
        slogan = reader.string();
        break;
      case tagOf(QidianCorpInfoResponseField.address, WireType.lengthDelimited):
        address = reader.string();
        break;
      case tagOf(QidianCorpInfoResponseField.phone, WireType.lengthDelimited):
        phone = reader.string();
        break;
      case tagOf(QidianCorpInfoResponseField.email, WireType.lengthDelimited):
        email = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  if (!corpName) return null;
  return { name: corpName, intro, website, slogan, address, phone, email };
}

// ===========================================================================
// trpc.qq_new_tech.status_svc.StatusService.SetStatus
// ===========================================================================

/** The status service's wire name (reference/index.mjs:333330 `dispatchSetStatus`). */
export const SET_STATUS_CMD = "trpc.qq_new_tech.status_svc.StatusService.SetStatus";

export const SetStatusReqField = { status: 1, extStatus: 2, batteryStatus: 3, customExt: 4 } as const;
export const SetStatusCustomExtField = { faceId: 1, text: 2, faceType: 3 } as const;
export const SetStatusRespField = { errCode: 1, errMsg: 2 } as const;

/** The two hard-coded status words the reference's DIY path uses (:333300). */
export const DIY_STATUS = { status: 10, extStatus: 2000 } as const;

export interface SetStatusCustomExt {
  faceId: number;
  text: string;
  faceType: number;
}

export interface SetStatusReq {
  status: number;
  extStatus: number;
  batteryStatus: number;
  customExt?: SetStatusCustomExt | undefined;
}

/**
 * The presence rules are all `!= null && !== 0`, so:
 *   * `batteryStatus: 0` (the DIY path) is DROPPED, not written as `18 00`;
 *   * `customExt` is a message field (`!= null`) and IS written for a zero faceId.
 *
 * That asymmetry is why `setstatus_diy` above is 13 bytes and not 11 or 14.
 */
export function encodeSetStatusReq(req: SetStatusReq): Uint8Array {
  const writer = new ProtoWriter()
    .uint32(SetStatusReqField.status, req.status)
    .uint32(SetStatusReqField.extStatus, req.extStatus)
    .uint32(SetStatusReqField.batteryStatus, req.batteryStatus);
  if (req.customExt !== undefined) {
    writer.message(
      SetStatusReqField.customExt,
      new ProtoWriter()
        .uint32(SetStatusCustomExtField.faceId, req.customExt.faceId)
        .string(SetStatusCustomExtField.text, req.customExt.text)
        .uint32(SetStatusCustomExtField.faceType, req.customExt.faceType)
        .finish(),
    );
  }
  return writer.finish();
}

export interface SetStatusResp {
  errCode: number | null;
  errMsg: string | null;
}

export function decodeSetStatusResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): SetStatusResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: SetStatusResp = { errCode: null, errMsg: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(SetStatusRespField.errCode, WireType.varint):
        resp.errCode = reader.uint32();
        break;
      case tagOf(SetStatusRespField.errMsg, WireType.lengthDelimited):
        resp.errMsg = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

/**
 * The reference's success test (:333340): an empty message and the literal
 * `"set status success"` both pass; anything else is an error whose TEXT is the
 * server's wording, not a wrapper around it.
 */
export function checkSetStatusResponse(resp: SetStatusResp): void {
  const message = resp.errMsg ?? "";
  if (message !== "" && message !== "set status success") throw new Error(message);
}