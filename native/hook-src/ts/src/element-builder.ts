// Message segments -> protobuf `Elem`s, the encoding half of `MessageSvc.PbSendMsg`.
//
// ---------------------------------------------------------------------------
// Where this came from
// ---------------------------------------------------------------------------
//   reference/index.mjs
//     region `../protocol/src/element-builder.ts`  lines 110973 .. 121793  (the code this file is)
//     region `../protocol/src/element-manifest.ts` lines   6371 ..   6904  (the type table below)
//
// Per-builder source lines, all in reference/index.mjs:
//
//   protobuf_encode_Elem                 111206     Elem (the outer oneof-ish container)
//   __size_*/__write_* for Elem $2       111212/111351
//   TextElem                             112010/112052   FaceElem                             112221/112243
//   OnlineImage                          112327/112349   NotOnlineImage                       112436/112620
//   TransElem                            112914/112930   MarketFace                           112980/113064
//   CustomFace                           113408/113625   RichMsg                              114532/114566
//   GroupFileElem                        114702/114762   ExtraInfo                            114992/115064
//   VideoFile                            115359/115481   GeneralFlags                         115985/116016
//   SrcMsg                               116126/116188   LightAppElem                         116441/116457
//   CommonElem                           116516/116538   SendRichText (richText wrapper)      117360
//   QFaceExtra (super face)              119231        QSmallFaceExtra                      120975
//   MentionExtraSend (@ / at)            121079        PokeExtra                            121209
//   MarketFacePbReserve                  121245        MarkdownData                         119493
//   GroupFileExtra / Inner / GroupFileInfo 120128 / 120206 / 120215
//
//   makeTextElem                         121367   makeFaceElem              121370
//   resolveMentionDisplay                121397   makeMentionElem           121407
//   makeReplyElem                        121427   makeReplyMentionElem      121435
//   makeDeflatedPayload                  121453   makeJsonElem              121460
//   makeXmlElem                          121463   makeMarkdownElem          121470
//   makePokeElem                         121477   makeMarketFaceElem        121495
//   makeForwardElem                      121521   makeLegacyForwardImageElem 121593
//   makeImageElem                        121617   makePttElem               121633
//   makeGroupFileElem                    121667   makeVideoElem             121698
//   buildSendContent                     121713   buildSendElems            121783
//   encodePrivateRichText                121786
//
// ---------------------------------------------------------------------------
// Coverage: 14 of the 16 message-segment types the reference manifest declares
// ---------------------------------------------------------------------------
//   ENCODED HERE -- 14 types, and the reference `buildSendContent` switch has a case
//   for every one of them:
//     text  at  face  reply  json  xml  markdown  poke  mface  forward  image
//     record  video  file
//
//   NOT ENCODED, and deliberately so -- the reference does not encode them either:
//     inline_keyboard   manifest direction W = "no"; receive-only
//     flash_file        manifest direction W = "by-design-no"; sending goes through
//                       the separate `send_flash_msg` action, not through PbSendMsg
//   Both types exist in `ELEMENT_MANIFEST` and in the receive-side codecs, which is
//   why they are listed here instead of silently disappearing.
//
//   Three of the encoded types -- image, record, video -- are only *wrapped* here.
//   Their payload is a `MsgInfo` produced by an NTV2 highway upload
//   (uploadImageMsgInfo @110501, uploadPtt @110879, uploadVideoMsgInfo @37622), all
//   of which live outside this region. Those builders therefore take the already
//   uploaded `MsgInfo` bytes and encode the `commonElem{serviceType:48}` envelope,
//   which is the whole of what element-builder.ts contributes to them.
//
// ---------------------------------------------------------------------------
// Why the encoder is hand-written
// ---------------------------------------------------------------------------
// The reference ships a codegen'd protobuf runtime (size pass, then write pass, with
// a slot table holding each nested message's length). Re-deriving that machinery
// would mean reimplementing a code generator to get back to bytes we can already
// produce directly. A single accumulating writer is simpler, has no size-pass/write-
// pass drift to get wrong, and keeps the field numbers visible on the line where
// they are used -- which is the point of this file: the field numbers are the
// reverse-engineered knowledge. `protocol.ts` already hand-rolls its framing for the
// same reason, and nothing here needs a schema at runtime.
//
// The one behaviour carried over verbatim is that proto3 scalar fields with their
// default value are omitted, because the reference omits them and the server has
// only ever seen the omitted form.

import { deflateSync } from "node:zlib";
import { randomUUID } from "node:crypto";
// A TYPE-only import, so there is no runtime cycle: `msg-push.ts` does not import this
// module at all (it re-uses `Elem`/`RichText` from `msg-push-fields.ts`). The direction
// of the value dependency stays `element-builder → nothing`.
import type { MessageSegment } from "./msg-push.js";

// ===========================================================================
// Wire primitives
// ===========================================================================

/**
 * Growable protobuf writer.
 *
 * Fields are written in ascending field-number order by every caller below, which is
 * what the reference's size-then-write pass produced. Protobuf does not require it,
 * but keeping the byte layout identical means a diff of our output against the
 * reference is a pure equality check rather than a re-canonicalisation exercise.
 */
class ProtoWriter {
  private buf: Uint8Array;
  private pos = 0;

  constructor(initial = 64) {
    this.buf = new Uint8Array(initial);
  }

  private ensure(extra: number): void {
    const need = this.pos + extra;
    if (need <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < need) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }

  /** Appends a base-128 varint. Unsigned only; callers mask to 32 or 64 bits. */
  varint(value: number): void {
    let v = value >>> 0;
    this.ensure(5);
    while (v > 127) {
      this.buf[this.pos++] = (v & 127) | 128;
      v >>>= 7;
    }
    this.buf[this.pos++] = v;
  }

  /**
   * Appends a 64-bit varint from a bigint.
   *
   * Split into two 32-bit halves instead of shifting the bigint a byte at a time:
   * a `bigint` shift allocates, and these fields (sender uin, file size) appear on
   * every reply and every group file.
   */
  varint64(value: bigint): void {
    let lo = Number(value & 0xffffffffn) >>> 0;
    let hi = Number((value >> 32n) & 0xffffffffn) >>> 0;
    this.ensure(10);
    while (hi !== 0 || lo > 127) {
      this.buf[this.pos++] = (lo & 127) | 128;
      lo = ((lo >>> 7) | (hi << 25)) >>> 0;
      hi >>>= 7;
    }
    this.buf[this.pos++] = lo;
  }

  /** Appends a tag: `(fieldNumber << 3) | wireType`. */
  tag(fieldNumber: number, wireType: number): void {
    this.varint((fieldNumber << 3) | wireType);
  }

  bytes(value: Uint8Array): void {
    this.ensure(value.length);
    this.buf.set(value, this.pos);
    this.pos += value.length;
  }

  /** Length-delimited field: tag, length, payload. */
  lenDelimited(fieldNumber: number, value: Uint8Array): void {
    this.tag(fieldNumber, 2);
    this.varint(value.length);
    this.bytes(value);
  }

  /** UTF-8 string field. Encoded with `TextEncoder` so surrogates match V8's own. */
  string(fieldNumber: number, value: string): void {
    this.lenDelimited(fieldNumber, UTF8.encode(value));
  }

  /** Varint field from a JS number, masked to 32 bits like the reference's `>>> 0`. */
  uint32(fieldNumber: number, value: number): void {
    this.tag(fieldNumber, 0);
    this.varint(value >>> 0);
  }

  /** Varint field from a bigint, masked to 64 bits like `BigInt.asUintN(64, v)`. */
  uint64(fieldNumber: number, value: bigint): void {
    this.tag(fieldNumber, 0);
    this.varint64(BigInt.asUintN(64, value));
  }

  /** Copies out exactly the bytes written. */
  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

const UTF8 = new TextEncoder();

/** Encodes a hex string to bytes. Odd lengths get a leading zero nibble, as the reference does. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  return out;
}

const EMPTY = new Uint8Array(0);

/** `Buffer.concat` over a list of encoder outputs; returns a view usable as `bytes` below. */
function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// ===========================================================================
// Proto messages
// ===========================================================================
//
// Field numbers and wire types below were read out of the reference's
// `__write_<Msg>$n` functions, where the tag byte is a literal. They are the whole
// reverse-engineered content of this section: everything else is plumbing.

/** `TextElem` (reference 112010). Field 12 `pbReserve` carries the @-mention metadata. */
export interface TextElem {
  str?: string;
  link?: string;
  attr6Buf?: Uint8Array;
  attr7Buf?: Uint8Array;
  buf?: Uint8Array;
  pbReserve?: Uint8Array;
}

export function encodeTextElem(obj: TextElem): Uint8Array {
  const w = new ProtoWriter(32);
  if (obj.str !== undefined && obj.str !== "") w.string(1, obj.str);
  if (obj.link !== undefined && obj.link !== "") w.string(2, obj.link);
  if (obj.attr6Buf !== undefined && obj.attr6Buf.length > 0) w.lenDelimited(3, obj.attr6Buf);
  if (obj.attr7Buf !== undefined && obj.attr7Buf.length > 0) w.lenDelimited(4, obj.attr7Buf);
  if (obj.buf !== undefined && obj.buf.length > 0) w.lenDelimited(11, obj.buf);
  if (obj.pbReserve !== undefined && obj.pbReserve.length > 0) w.lenDelimited(12, obj.pbReserve);
  return w.finish();
}

/** `FaceElem` (reference 112221). Field 1 is a varint face id, not a string. */
export interface FaceElem {
  index?: number;
  oldData?: Uint8Array;
  buf?: Uint8Array;
}

export function encodeFaceElem(obj: FaceElem): Uint8Array {
  const w = new ProtoWriter(16);
  if (obj.index !== undefined && obj.index !== 0) w.uint32(1, obj.index);
  if (obj.oldData !== undefined && obj.oldData.length > 0) w.lenDelimited(2, obj.oldData);
  if (obj.buf !== undefined && obj.buf.length > 0) w.lenDelimited(11, obj.buf);
  return w.finish();
}

/**
 * `RichMsg` (reference 114532): the xml/forward card envelope.
 *
 * `template1` is **deflated** XML with a leading `0x01` marker byte -- see
 * {@link makeDeflatedPayload}. Sending it uncompressed produces a card that QQ
 * renders as empty rather than as an error, so the marker is load-bearing.
 */
export interface RichMsg {
  template1?: Uint8Array;
  serviceId?: number;
  msgResId?: Uint8Array;
  rand?: number;
  seq?: number;
}

export function encodeRichMsg(obj: RichMsg): Uint8Array {
  const w = new ProtoWriter(128);
  if (obj.template1 !== undefined && obj.template1.length > 0) w.lenDelimited(1, obj.template1);
  if (obj.serviceId !== undefined && obj.serviceId !== 0) w.uint32(2, obj.serviceId);
  if (obj.msgResId !== undefined && obj.msgResId.length > 0) w.lenDelimited(3, obj.msgResId);
  if (obj.rand !== undefined && obj.rand !== 0) w.uint32(4, obj.rand);
  if (obj.seq !== undefined && obj.seq !== 0) w.uint32(5, obj.seq);
  return w.finish();
}

/** `LightAppElem` (reference 116441): the JSON card envelope, also deflated. */
export interface LightAppElem {
  data?: Uint8Array;
  msgResid?: Uint8Array;
}

export function encodeLightAppElem(obj: LightAppElem): Uint8Array {
  const w = new ProtoWriter(128);
  if (obj.data !== undefined && obj.data.length > 0) w.lenDelimited(1, obj.data);
  if (obj.msgResid !== undefined && obj.msgResid.length > 0) w.lenDelimited(2, obj.msgResid);
  return w.finish();
}

/**
 * `CommonElem` (reference 116516): the service-dispatch envelope.
 *
 * `serviceType` decides how the receiver interprets `pbElem`: 2 window shake, 33
 * small face, 37 super face, 45 markdown, 48 NT media (image/record/video).
 */
export interface CommonElem {
  serviceType?: number;
  pbElem?: Uint8Array;
  businessType?: number;
}

export function encodeCommonElem(obj: CommonElem): Uint8Array {
  const w = new ProtoWriter(64);
  if (obj.serviceType !== undefined && obj.serviceType !== 0) w.uint32(1, obj.serviceType);
  if (obj.pbElem !== undefined && obj.pbElem.length > 0) w.lenDelimited(2, obj.pbElem);
  if (obj.businessType !== undefined && obj.businessType !== 0) w.uint32(3, obj.businessType);
  return w.finish();
}

/**
 * `TransElem` (reference 112914): a typed byte envelope.
 *
 * `elemType` 24 is the group-file shape used inside long-message uploads. The QQ-NT
 * server **rejects** `transElem(24)` in a live PbSendMsg with `result=79`; live group
 * file sends go through OIDB 0x6d9_4 instead. It stays here because the forward /
 * multi-msg path needs it.
 */
export interface TransElem {
  elemType?: number;
  elemValue?: Uint8Array;
}

export function encodeTransElem(obj: TransElem): Uint8Array {
  const w = new ProtoWriter(64);
  if (obj.elemType !== undefined && obj.elemType !== 0) w.uint32(1, obj.elemType);
  if (obj.elemValue !== undefined && obj.elemValue.length > 0) w.lenDelimited(2, obj.elemValue);
  return w.finish();
}

/** `MarketFace` (reference 112980): a mall sticker. `faceId` is the raw GUID bytes, not hex. */
export interface MarketFace {
  faceName?: string;
  itemType?: number;
  faceInfo?: number;
  faceId?: Uint8Array;
  tabId?: number;
  subType?: number;
  key?: string;
  param?: Uint8Array;
  mediaType?: number;
  imageWidth?: number;
  imageHeight?: number;
  mobileParam?: Uint8Array;
  pbReserve?: Uint8Array;
}

export function encodeMarketFace(obj: MarketFace): Uint8Array {
  const w = new ProtoWriter(128);
  if (obj.faceName !== undefined && obj.faceName !== "") w.string(1, obj.faceName);
  if (obj.itemType !== undefined && obj.itemType !== 0) w.uint32(2, obj.itemType);
  if (obj.faceInfo !== undefined && obj.faceInfo !== 0) w.uint32(3, obj.faceInfo);
  if (obj.faceId !== undefined && obj.faceId.length > 0) w.lenDelimited(4, obj.faceId);
  if (obj.tabId !== undefined && obj.tabId !== 0) w.uint32(5, obj.tabId);
  if (obj.subType !== undefined && obj.subType !== 0) w.uint32(6, obj.subType);
  if (obj.key !== undefined && obj.key !== "") w.string(7, obj.key);
  if (obj.param !== undefined && obj.param.length > 0) w.lenDelimited(8, obj.param);
  if (obj.mediaType !== undefined && obj.mediaType !== 0) w.uint32(9, obj.mediaType);
  if (obj.imageWidth !== undefined && obj.imageWidth !== 0) w.uint32(10, obj.imageWidth);
  if (obj.imageHeight !== undefined && obj.imageHeight !== 0) w.uint32(11, obj.imageHeight);
  if (obj.mobileParam !== undefined && obj.mobileParam.length > 0) w.lenDelimited(12, obj.mobileParam);
  if (obj.pbReserve !== undefined && obj.pbReserve.length > 0) w.lenDelimited(13, obj.pbReserve);
  return w.finish();
}

/**
 * `CustomFace` (reference 113408). Only the md5/name/size corner is emitted by the
 * send path (the legacy-forward image sibling); the rest is receive-side decoding.
 */
export interface CustomFace {
  guid?: Uint8Array;
  filePath?: string;
  shortcut?: string;
  buffer?: Uint8Array;
  flag?: Uint8Array;
  oldData?: Uint8Array;
  fileId?: number;
  serverIp?: number;
  serverPort?: number;
  fileType?: number;
  signature?: Uint8Array;
  useful?: number;
  md5?: Uint8Array;
  thumbUrl?: string;
  bigUrl?: string;
  origUrl?: string;
  bizType?: number;
  repeatIndex?: number;
  repeatImage?: number;
  imageType?: number;
  index?: number;
  width?: number;
  height?: number;
  source?: number;
  size?: number;
  origin?: number;
  thumbWidth?: number;
  thumbHeight?: number;
  showLen?: number;
  downloadLen?: number;
  x400Url?: string;
  x400Width?: number;
  x400Height?: number;
  pbRes?: Uint8Array;
}

export function encodeCustomFace(obj: CustomFace): Uint8Array {
  const w = new ProtoWriter(128);
  if (obj.guid !== undefined && obj.guid.length > 0) w.lenDelimited(1, obj.guid);
  if (obj.filePath !== undefined && obj.filePath !== "") w.string(2, obj.filePath);
  if (obj.shortcut !== undefined && obj.shortcut !== "") w.string(3, obj.shortcut);
  if (obj.buffer !== undefined && obj.buffer.length > 0) w.lenDelimited(4, obj.buffer);
  if (obj.flag !== undefined && obj.flag.length > 0) w.lenDelimited(5, obj.flag);
  if (obj.oldData !== undefined && obj.oldData.length > 0) w.lenDelimited(6, obj.oldData);
  if (obj.fileId !== undefined && obj.fileId !== 0) w.uint32(7, obj.fileId);
  if (obj.serverIp !== undefined && obj.serverIp !== 0) w.uint32(8, obj.serverIp);
  if (obj.serverPort !== undefined && obj.serverPort !== 0) w.uint32(9, obj.serverPort);
  if (obj.fileType !== undefined && obj.fileType !== 0) w.uint32(10, obj.fileType);
  if (obj.signature !== undefined && obj.signature.length > 0) w.lenDelimited(11, obj.signature);
  if (obj.useful !== undefined && obj.useful !== 0) w.uint32(12, obj.useful);
  if (obj.md5 !== undefined && obj.md5.length > 0) w.lenDelimited(13, obj.md5);
  if (obj.thumbUrl !== undefined && obj.thumbUrl !== "") w.string(14, obj.thumbUrl);
  if (obj.bigUrl !== undefined && obj.bigUrl !== "") w.string(15, obj.bigUrl);
  if (obj.origUrl !== undefined && obj.origUrl !== "") w.string(16, obj.origUrl);
  if (obj.bizType !== undefined && obj.bizType !== 0) w.uint32(17, obj.bizType);
  if (obj.repeatIndex !== undefined && obj.repeatIndex !== 0) w.uint32(18, obj.repeatIndex);
  if (obj.repeatImage !== undefined && obj.repeatImage !== 0) w.uint32(19, obj.repeatImage);
  if (obj.imageType !== undefined && obj.imageType !== 0) w.uint32(20, obj.imageType);
  if (obj.index !== undefined && obj.index !== 0) w.uint32(21, obj.index);
  if (obj.width !== undefined && obj.width !== 0) w.uint32(22, obj.width);
  if (obj.height !== undefined && obj.height !== 0) w.uint32(23, obj.height);
  if (obj.source !== undefined && obj.source !== 0) w.uint32(24, obj.source);
  if (obj.size !== undefined && obj.size !== 0) w.uint32(25, obj.size);
  if (obj.origin !== undefined && obj.origin !== 0) w.uint32(26, obj.origin);
  if (obj.thumbWidth !== undefined && obj.thumbWidth !== 0) w.uint32(27, obj.thumbWidth);
  if (obj.thumbHeight !== undefined && obj.thumbHeight !== 0) w.uint32(28, obj.thumbHeight);
  if (obj.showLen !== undefined && obj.showLen !== 0) w.uint32(29, obj.showLen);
  if (obj.downloadLen !== undefined && obj.downloadLen !== 0) w.uint32(30, obj.downloadLen);
  if (obj.x400Url !== undefined && obj.x400Url !== "") w.string(31, obj.x400Url);
  if (obj.x400Width !== undefined && obj.x400Width !== 0) w.uint32(32, obj.x400Width);
  if (obj.x400Height !== undefined && obj.x400Height !== 0) w.uint32(33, obj.x400Height);
  if (obj.pbRes !== undefined && obj.pbRes.length > 0) w.lenDelimited(34, obj.pbRes);
  return w.finish();
}

/**
 * `NotOnlineImage` (reference 112436). The c2c counterpart of CustomFace; the send
 * path emits the filePath/picMd5/fileLen/picWidth/picHeight corner only.
 */
export interface NotOnlineImage {
  filePath?: string;
  fileLen?: number;
  downloadPath?: string;
  oldVerSendFile?: Uint8Array;
  imgType?: number;
  previewsImage?: Uint8Array;
  picMd5?: Uint8Array;
  picHeight?: number;
  picWidth?: number;
  resId?: string;
  flag?: Uint8Array;
  thumbUrl?: string;
  original?: number;
  bigUrl?: string;
  origUrl?: string;
  bizType?: number;
  result?: number;
  index?: number;
  opFaceBuf?: Uint8Array;
  /**
   * Field 20 is written only when this is literally `true`, as a fixed `1` -- the
   * reference emits `tag,1` and no other value. Kept as a boolean, not a number, so a
   * caller cannot accidentally ask for the `false` form the reference never produces.
   */
  oldPicMd5?: boolean;
  thumbWidth?: number;
  thumbHeight?: number;
  fileId?: number;
  showLen?: number;
  downloadLen?: number;
  x400Url?: string;
  x400Width?: number;
  x400Height?: number;
  pbRes?: Uint8Array;
}

export function encodeNotOnlineImage(obj: NotOnlineImage): Uint8Array {
  const w = new ProtoWriter(128);
  if (obj.filePath !== undefined && obj.filePath !== "") w.string(1, obj.filePath);
  if (obj.fileLen !== undefined && obj.fileLen !== 0) w.uint32(2, obj.fileLen);
  if (obj.downloadPath !== undefined && obj.downloadPath !== "") w.string(3, obj.downloadPath);
  if (obj.oldVerSendFile !== undefined && obj.oldVerSendFile.length > 0) w.lenDelimited(4, obj.oldVerSendFile);
  if (obj.imgType !== undefined && obj.imgType !== 0) w.uint32(5, obj.imgType);
  if (obj.previewsImage !== undefined && obj.previewsImage.length > 0) w.lenDelimited(6, obj.previewsImage);
  if (obj.picMd5 !== undefined && obj.picMd5.length > 0) w.lenDelimited(7, obj.picMd5);
  if (obj.picHeight !== undefined && obj.picHeight !== 0) w.uint32(8, obj.picHeight);
  if (obj.picWidth !== undefined && obj.picWidth !== 0) w.uint32(9, obj.picWidth);
  if (obj.resId !== undefined && obj.resId !== "") w.string(10, obj.resId);
  if (obj.flag !== undefined && obj.flag.length > 0) w.lenDelimited(11, obj.flag);
  if (obj.thumbUrl !== undefined && obj.thumbUrl !== "") w.string(12, obj.thumbUrl);
  if (obj.original !== undefined && obj.original !== 0) w.uint32(13, obj.original);
  if (obj.bigUrl !== undefined && obj.bigUrl !== "") w.string(14, obj.bigUrl);
  if (obj.origUrl !== undefined && obj.origUrl !== "") w.string(15, obj.origUrl);
  if (obj.bizType !== undefined && obj.bizType !== 0) w.uint32(16, obj.bizType);
  if (obj.result !== undefined && obj.result !== 0) w.uint32(17, obj.result);
  if (obj.index !== undefined && obj.index !== 0) w.uint32(18, obj.index);
  if (obj.opFaceBuf !== undefined && obj.opFaceBuf.length > 0) w.lenDelimited(19, obj.opFaceBuf);
  if (obj.oldPicMd5 === true) w.uint32(20, 1);
  if (obj.thumbWidth !== undefined && obj.thumbWidth !== 0) w.uint32(21, obj.thumbWidth);
  if (obj.thumbHeight !== undefined && obj.thumbHeight !== 0) w.uint32(22, obj.thumbHeight);
  if (obj.fileId !== undefined && obj.fileId !== 0) w.uint32(23, obj.fileId);
  if (obj.showLen !== undefined && obj.showLen !== 0) w.uint32(24, obj.showLen);
  if (obj.downloadLen !== undefined && obj.downloadLen !== 0) w.uint32(25, obj.downloadLen);
  if (obj.x400Url !== undefined && obj.x400Url !== "") w.string(26, obj.x400Url);
  if (obj.x400Width !== undefined && obj.x400Width !== 0) w.uint32(27, obj.x400Width);
  if (obj.x400Height !== undefined && obj.x400Height !== 0) w.uint32(28, obj.x400Height);
  if (obj.pbRes !== undefined && obj.pbRes.length > 0) w.lenDelimited(29, obj.pbRes);
  return w.finish();
}

/** `VideoFile` (reference 115359). Receive-side today; listed so the field map is complete. */
export interface VideoFile {
  fileUuid?: string;
  fileMd5?: Uint8Array;
  fileName?: string;
  fileFormat?: number;
  fileTime?: number;
  fileSize?: number;
  thumbWidth?: number;
  thumbHeight?: number;
  thumbFileMd5?: Uint8Array;
  source?: Uint8Array;
  thumbFileSize?: number;
  busiType?: number;
  fromChatType?: number;
  toChatType?: number;
  supportProgressive?: number;
  fileWidth?: number;
  fileHeight?: number;
  subBusiType?: number;
  videoAttr?: number;
  pbReserve?: Uint8Array;
}

export function encodeVideoFile(obj: VideoFile): Uint8Array {
  const w = new ProtoWriter(128);
  if (obj.fileUuid !== undefined && obj.fileUuid !== "") w.string(1, obj.fileUuid);
  if (obj.fileMd5 !== undefined && obj.fileMd5.length > 0) w.lenDelimited(2, obj.fileMd5);
  if (obj.fileName !== undefined && obj.fileName !== "") w.string(3, obj.fileName);
  if (obj.fileFormat !== undefined && obj.fileFormat !== 0) w.uint32(4, obj.fileFormat);
  if (obj.fileTime !== undefined && obj.fileTime !== 0) w.uint32(5, obj.fileTime);
  if (obj.fileSize !== undefined && obj.fileSize !== 0) w.uint32(6, obj.fileSize);
  if (obj.thumbWidth !== undefined && obj.thumbWidth !== 0) w.uint32(7, obj.thumbWidth);
  if (obj.thumbHeight !== undefined && obj.thumbHeight !== 0) w.uint32(8, obj.thumbHeight);
  if (obj.thumbFileMd5 !== undefined && obj.thumbFileMd5.length > 0) w.lenDelimited(9, obj.thumbFileMd5);
  if (obj.source !== undefined && obj.source.length > 0) w.lenDelimited(10, obj.source);
  if (obj.thumbFileSize !== undefined && obj.thumbFileSize !== 0) w.uint32(11, obj.thumbFileSize);
  if (obj.busiType !== undefined && obj.busiType !== 0) w.uint32(12, obj.busiType);
  if (obj.fromChatType !== undefined && obj.fromChatType !== 0) w.uint32(13, obj.fromChatType);
  if (obj.toChatType !== undefined && obj.toChatType !== 0) w.uint32(14, obj.toChatType);
  if (obj.supportProgressive !== undefined && obj.supportProgressive !== 0) w.uint32(15, obj.supportProgressive);
  if (obj.fileWidth !== undefined && obj.fileWidth !== 0) w.uint32(16, obj.fileWidth);
  if (obj.fileHeight !== undefined && obj.fileHeight !== 0) w.uint32(17, obj.fileHeight);
  if (obj.subBusiType !== undefined && obj.subBusiType !== 0) w.uint32(18, obj.subBusiType);
  if (obj.videoAttr !== undefined && obj.videoAttr !== 0) w.uint32(19, obj.videoAttr);
  if (obj.pbReserve !== undefined && obj.pbReserve.length > 0) w.lenDelimited(24, obj.pbReserve);
  return w.finish();
}

/**
 * `SrcMsg` (reference 116126): the quote/reply element.
 *
 * `origSeqs` is `repeated uint32` (wire 0, one tag per entry) while `elemsRaw` is
 * `repeated bytes` (wire 2, one tag + length per entry). Mixing those two up is the
 * single easiest way to make a reply that QQ accepts but shows as quoting nothing.
 */
export interface SrcMsg {
  origSeqs?: readonly number[];
  senderUin?: bigint;
  time?: number;
  flag?: number;
  elemsRaw?: readonly Uint8Array[];
  type?: number;
  richMsg?: Uint8Array;
  pbReserve?: Uint8Array;
  sourceMsg?: Uint8Array;
  toUin?: bigint;
  troopName?: Uint8Array;
}

export function encodeSrcMsg(obj: SrcMsg): Uint8Array {
  const w = new ProtoWriter(64);
  if (obj.origSeqs !== undefined) for (const seq of obj.origSeqs) w.uint32(1, seq);
  if (obj.senderUin !== undefined && obj.senderUin !== 0n) w.uint64(2, obj.senderUin);
  if (obj.time !== undefined && obj.time !== 0) w.uint32(3, obj.time);
  if (obj.flag !== undefined && obj.flag !== 0) w.uint32(4, obj.flag);
  if (obj.elemsRaw !== undefined) for (const raw of obj.elemsRaw) w.lenDelimited(5, raw);
  if (obj.type !== undefined && obj.type !== 0) w.uint32(6, obj.type);
  if (obj.richMsg !== undefined && obj.richMsg.length > 0) w.lenDelimited(7, obj.richMsg);
  if (obj.pbReserve !== undefined && obj.pbReserve.length > 0) w.lenDelimited(8, obj.pbReserve);
  if (obj.sourceMsg !== undefined && obj.sourceMsg.length > 0) w.lenDelimited(9, obj.sourceMsg);
  if (obj.toUin !== undefined && obj.toUin !== 0n) w.uint64(10, obj.toUin);
  if (obj.troopName !== undefined && obj.troopName.length > 0) w.lenDelimited(11, obj.troopName);
  return w.finish();
}

/** `ExtraInfo` (reference 114992). Not emitted by the send path; kept for the field map. */
export interface ExtraInfo {
  nick?: string;
  groupCard?: string;
  level?: number;
  flags?: number;
  groupMask?: number;
  msgTailId?: number;
  senderTitle?: string;
  apnsTips?: string;
  uin?: number;
  msgStateFlag?: number;
  apnsSoundType?: number;
  newGroupFlag?: number;
}

export function encodeExtraInfo(obj: ExtraInfo): Uint8Array {
  const w = new ProtoWriter(64);
  if (obj.nick !== undefined && obj.nick !== "") w.string(1, obj.nick);
  if (obj.groupCard !== undefined && obj.groupCard !== "") w.string(2, obj.groupCard);
  if (obj.level !== undefined && obj.level !== 0) w.uint32(3, obj.level);
  if (obj.flags !== undefined && obj.flags !== 0) w.uint32(4, obj.flags);
  if (obj.groupMask !== undefined && obj.groupMask !== 0) w.uint32(5, obj.groupMask);
  if (obj.msgTailId !== undefined && obj.msgTailId !== 0) w.uint32(6, obj.msgTailId);
  if (obj.senderTitle !== undefined && obj.senderTitle !== "") w.string(7, obj.senderTitle);
  if (obj.apnsTips !== undefined && obj.apnsTips !== "") w.string(8, obj.apnsTips);
  if (obj.uin !== undefined && obj.uin !== 0) w.uint32(9, obj.uin);
  if (obj.msgStateFlag !== undefined && obj.msgStateFlag !== 0) w.uint32(10, obj.msgStateFlag);
  if (obj.apnsSoundType !== undefined && obj.apnsSoundType !== 0) w.uint32(11, obj.apnsSoundType);
  if (obj.newGroupFlag !== undefined && obj.newGroupFlag !== 0) w.uint32(12, obj.newGroupFlag);
  return w.finish();
}

/** `GroupFileElem` (reference 114702). Receive-side; the send path uses transElem(24) instead. */
export interface GroupFileElem {
  filename?: string;
  fileSize?: number;
  fileId?: string;
  batchId?: string;
  fileKey?: string;
  mark?: string;
  sequence?: number;
  batchItemId?: string;
  feedMsgTime?: number;
  pbReserve?: Uint8Array;
}

export function encodeGroupFileElem(obj: GroupFileElem): Uint8Array {
  const w = new ProtoWriter(64);
  if (obj.filename !== undefined && obj.filename !== "") w.string(1, obj.filename);
  if (obj.fileSize !== undefined && obj.fileSize !== 0) w.uint32(2, obj.fileSize);
  if (obj.fileId !== undefined && obj.fileId !== "") w.string(3, obj.fileId);
  if (obj.batchId !== undefined && obj.batchId !== "") w.string(4, obj.batchId);
  if (obj.fileKey !== undefined && obj.fileKey !== "") w.string(5, obj.fileKey);
  if (obj.mark !== undefined && obj.mark !== "") w.string(6, obj.mark);
  if (obj.sequence !== undefined && obj.sequence !== 0) w.uint32(7, obj.sequence);
  if (obj.batchItemId !== undefined && obj.batchItemId !== "") w.string(8, obj.batchItemId);
  if (obj.feedMsgTime !== undefined && obj.feedMsgTime !== 0) w.uint32(9, obj.feedMsgTime);
  if (obj.pbReserve !== undefined && obj.pbReserve.length > 0) w.lenDelimited(10, obj.pbReserve);
  return w.finish();
}

/** `GeneralFlags` (reference 115985). Not emitted by the send path; kept for the field map. */
export interface GeneralFlags {
  bubbleDiyTextId?: number;
  groupFlagNew?: number;
  uin?: number;
  longTextFlag?: number;
  longTextResId?: string;
}

export function encodeGeneralFlags(obj: GeneralFlags): Uint8Array {
  const w = new ProtoWriter(32);
  if (obj.bubbleDiyTextId !== undefined && obj.bubbleDiyTextId !== 0) w.uint32(1, obj.bubbleDiyTextId);
  if (obj.groupFlagNew !== undefined && obj.groupFlagNew !== 0) w.uint32(2, obj.groupFlagNew);
  if (obj.uin !== undefined && obj.uin !== 0) w.uint32(3, obj.uin);
  if (obj.longTextFlag !== undefined && obj.longTextFlag !== 0) w.uint32(6, obj.longTextFlag);
  if (obj.longTextResId !== undefined && obj.longTextResId !== "") w.string(7, obj.longTextResId);
  return w.finish();
}
/**
 * `QFaceExtra` (reference 119231): the super-face (animated sticker) payload.
 *
 * Fields are `packId`/`stickerId` as **strings**, not numbers -- QQ's pack ids exceed
 * 2^31 and the server round-trips them as decimal text.
 */
export interface QFaceExtra {
  packId?: string;
  stickerId?: string;
  qsid?: number;
  sourceType?: number;
  stickerType?: number;
  resultId?: string;
  text?: string;
  randomType?: number;
}

export function encodeQFaceExtra(obj: QFaceExtra): Uint8Array {
  const w = new ProtoWriter(64);
  if (obj.packId !== undefined && obj.packId !== "") w.string(1, obj.packId);
  if (obj.stickerId !== undefined && obj.stickerId !== "") w.string(2, obj.stickerId);
  if (obj.qsid !== undefined && obj.qsid !== 0) w.uint32(3, obj.qsid);
  if (obj.sourceType !== undefined && obj.sourceType !== 0) w.uint32(4, obj.sourceType);
  if (obj.stickerType !== undefined && obj.stickerType !== 0) w.uint32(5, obj.stickerType);
  if (obj.resultId !== undefined && obj.resultId !== "") w.string(6, obj.resultId);
  if (obj.text !== undefined && obj.text !== "") w.string(7, obj.text);
  if (obj.randomType !== undefined && obj.randomType !== 0) w.uint32(9, obj.randomType);
  return w.finish();
}

/** `QSmallFaceExtra` (reference 120975): the small/unicode face payload (serviceType 33). */
export interface QSmallFaceExtra {
  faceId?: number;
  preview?: string;
  preview2?: string;
}

export function encodeQSmallFaceExtra(obj: QSmallFaceExtra): Uint8Array {
  const w = new ProtoWriter(32);
  if (obj.faceId !== undefined && obj.faceId !== 0) w.uint32(1, obj.faceId);
  if (obj.preview !== undefined && obj.preview !== "") w.string(2, obj.preview);
  if (obj.preview2 !== undefined && obj.preview2 !== "") w.string(3, obj.preview2);
  return w.finish();
}

/**
 * `MentionExtraSend` (reference 121079): the @-mention metadata carried on
 * `TextElem.pbReserve`.
 *
 * Note the field numbers: 3/4/5/9, not 1/2/3. `type` is 1 for @all and 2 for a
 * single user; `uin` is 0 for @all (the uid string carries the identity instead).
 */
export interface MentionExtraSend {
  type?: number;
  uin?: number;
  field5?: number;
  uid?: string;
}

export function encodeMentionExtraSend(obj: MentionExtraSend): Uint8Array {
  const w = new ProtoWriter(32);
  if (obj.type !== undefined && obj.type !== 0) w.uint32(3, obj.type);
  if (obj.uin !== undefined && obj.uin !== 0) w.uint32(4, obj.uin);
  if (obj.field5 !== undefined && obj.field5 !== 0) w.uint32(5, obj.field5);
  if (obj.uid !== undefined && obj.uid !== "") w.string(9, obj.uid);
  return w.finish();
}

/** `PokeExtra` (reference 121209): window shake (serviceType 2). Field 1 is the poke type. */
export interface PokeExtra {
  type?: number;
}

export function encodePokeExtra(obj: PokeExtra): Uint8Array {
  const w = new ProtoWriter(16);
  if (obj.type !== undefined && obj.type !== 0) w.uint32(1, obj.type);
  return w.finish();
}

/**
 * `MarketFacePbReserve` (reference 121245). Only field 8 is ever set, always to 1:
 * the constant that makes the server relay the sticker instead of dropping it.
 */
export interface MarketFacePbReserve {
  field8?: number;
}

export function encodeMarketFacePbReserve(obj: MarketFacePbReserve): Uint8Array {
  const w = new ProtoWriter(8);
  if (obj.field8 !== undefined && obj.field8 !== 0) w.uint32(8, obj.field8);
  return w.finish();
}

/** `MarkdownData` (reference 119493): markdown bot message (serviceType 45). */
export interface MarkdownData {
  content?: string;
  field2?: string;
  field3?: Uint8Array;
  processMsg?: string;
  summary?: string;
  extType?: number;
  /** `MarkdownFlashTransferExt`; the send path leaves it unset. */
  extInfo?: Uint8Array;
}

export function encodeMarkdownData(obj: MarkdownData): Uint8Array {
  const w = new ProtoWriter(64);
  if (obj.content !== undefined && obj.content !== "") w.string(1, obj.content);
  if (obj.field2 !== undefined && obj.field2 !== "") w.string(2, obj.field2);
  if (obj.field3 !== undefined && obj.field3.length > 0) w.lenDelimited(3, obj.field3);
  if (obj.processMsg !== undefined && obj.processMsg !== "") w.string(4, obj.processMsg);
  if (obj.summary !== undefined && obj.summary !== "") w.string(5, obj.summary);
  if (obj.extType !== undefined && obj.extType !== 0) w.uint32(6, obj.extType);
  if (obj.extInfo !== undefined && obj.extInfo.length > 0) w.lenDelimited(7, obj.extInfo);
  return w.finish();
}

/** `GroupFileInfo` (reference 120215). `fileSize` is a real 64-bit value. */
export interface GroupFileInfo {
  busId?: number;
  fileId?: string;
  fileSize?: bigint;
  fileName?: string;
  field5?: number;
  fileSha?: Uint8Array;
  extInfoString?: string;
  fileMd5?: Uint8Array;
}

export function encodeGroupFileInfo(obj: GroupFileInfo): Uint8Array {
  const w = new ProtoWriter(64);
  if (obj.busId !== undefined && obj.busId !== 0) w.uint32(1, obj.busId);
  if (obj.fileId !== undefined && obj.fileId !== "") w.string(2, obj.fileId);
  if (obj.fileSize !== undefined && obj.fileSize !== 0n) w.uint64(3, obj.fileSize);
  if (obj.fileName !== undefined && obj.fileName !== "") w.string(4, obj.fileName);
  if (obj.field5 !== undefined && obj.field5 !== 0) w.uint32(5, obj.field5);
  if (obj.fileSha !== undefined && obj.fileSha.length > 0) w.lenDelimited(6, obj.fileSha);
  if (obj.extInfoString !== undefined && obj.extInfoString !== "") w.string(7, obj.extInfoString);
  if (obj.fileMd5 !== undefined && obj.fileMd5.length > 0) w.lenDelimited(8, obj.fileMd5);
  return w.finish();
}

/**
 * `GroupFileExtra` (reference 120128) + its inner wrapper (120206).
 *
 * Field 1 is always 6 on the send path; `inner.info` is field 2 of the wrapper, so the
 * real nesting is `GroupFileExtra{1:6, 2:fileName, 7:Inner{2:Info}}`.
 */
export interface GroupFileExtra {
  field1?: number;
  fileName?: string;
  display?: string;
  inner?: { info?: GroupFileInfo };
}

export function encodeGroupFileExtra(obj: GroupFileExtra): Uint8Array {
  const w = new ProtoWriter(128);
  if (obj.field1 !== undefined && obj.field1 !== 0) w.uint32(1, obj.field1);
  if (obj.fileName !== undefined && obj.fileName !== "") w.string(2, obj.fileName);
  if (obj.display !== undefined && obj.display !== "") w.string(3, obj.display);
  if (obj.inner !== undefined) {
    const inner = new ProtoWriter(64);
    if (obj.inner.info !== undefined) inner.lenDelimited(2, encodeGroupFileInfo(obj.inner.info));
    w.lenDelimited(7, inner.finish());
  }
  return w.finish();
}

// ===========================================================================
// Elem -- the container every segment becomes
// ===========================================================================
//
// Field numbers, with the gaps the reference leaves: 1 text, 2 face, 3 onlineImage,
// 4 notOnlineImage, 5 transElem, 6 marketFace, 8 customFace (7 is unused), 12 richMsg,
// 13 groupFile, 16 extraInfo, 19 videoFile, 37 generalFlags, 45 srcMsg, 51 lightApp,
// 53 commonElem. Field 7 really is absent from the reference's writer -- do not
// "fix" it by renumbering.

export interface Elem {
  text?: TextElem;
  face?: FaceElem;
  onlineImage?: OnlineImageStub;
  notOnlineImage?: NotOnlineImage;
  transElem?: TransElem;
  marketFace?: MarketFace;
  customFace?: CustomFace;
  richMsg?: RichMsg;
  groupFile?: GroupFileElem;
  extraInfo?: ExtraInfo;
  videoFile?: VideoFile;
  generalFlags?: GeneralFlags;
  srcMsg?: SrcMsg;
  lightApp?: LightAppElem;
  commonElem?: CommonElem;
}

/**
 * `OnlineImage` (reference 112327) exists in the reference as a decode/encode pair but
 * the send path never builds one -- peer images arrive as `notOnlineImage`. Declared as
 * a stub rather than omitted so `Elem` field 3 keeps its slot; a caller that sets it
 * gets the tag and a zero-length body, which is what an unsupported field should look
 * like if anyone ever reaches for it.
 */
export interface OnlineImageStub {
  readonly __unsupported?: never;
}

export function encodeElem(obj: Elem): Uint8Array {
  const w = new ProtoWriter(128);
  if (obj.text !== undefined) w.lenDelimited(1, encodeTextElem(obj.text));
  if (obj.face !== undefined) w.lenDelimited(2, encodeFaceElem(obj.face));
  if (obj.onlineImage !== undefined) w.lenDelimited(3, EMPTY);
  if (obj.notOnlineImage !== undefined) w.lenDelimited(4, encodeNotOnlineImage(obj.notOnlineImage));
  if (obj.transElem !== undefined) w.lenDelimited(5, encodeTransElem(obj.transElem));
  if (obj.marketFace !== undefined) w.lenDelimited(6, encodeMarketFace(obj.marketFace));
  if (obj.customFace !== undefined) w.lenDelimited(8, encodeCustomFace(obj.customFace));
  if (obj.richMsg !== undefined) w.lenDelimited(12, encodeRichMsg(obj.richMsg));
  if (obj.groupFile !== undefined) w.lenDelimited(13, encodeGroupFileElem(obj.groupFile));
  if (obj.extraInfo !== undefined) w.lenDelimited(16, encodeExtraInfo(obj.extraInfo));
  if (obj.videoFile !== undefined) w.lenDelimited(19, encodeVideoFile(obj.videoFile));
  if (obj.generalFlags !== undefined) w.lenDelimited(37, encodeGeneralFlags(obj.generalFlags));
  if (obj.srcMsg !== undefined) w.lenDelimited(45, encodeSrcMsg(obj.srcMsg));
  if (obj.lightApp !== undefined) w.lenDelimited(51, encodeLightAppElem(obj.lightApp));
  if (obj.commonElem !== undefined) w.lenDelimited(53, encodeCommonElem(obj.commonElem));
  return w.finish();
}

/**
 * `SendRichText` (reference 117360): `repeated Elem elems = 2`.
 *
 * Field 2, not 1 -- field 1 is unused in this message. This is the wrapper that goes
 * into `MessageBody.richText` on a group send, and the one a private send concatenates
 * with the voice-compatibility blob (see {@link encodePrivateRichText}).
 */
export function encodeSendRichText(obj: { elems?: readonly Elem[] }): Uint8Array {
  const w = new ProtoWriter(256);
  if (obj.elems !== undefined) for (const elem of obj.elems) w.lenDelimited(2, encodeElem(elem));
  return w.finish();
}

// ===========================================================================
// Segment types -- the OneBot-facing surface
// ===========================================================================
//
// Field names and required-field sets come from `ELEMENT_MANIFEST`
// (reference/index.mjs:6371-6904). The manifest is authoritative: it is the table the
// reference's own validation runs against, and its `directions.W === "yes"` column is
// exactly the set `buildSendContent`'s switch handles.

/** Why an element was refused. Mirrors the reference's `MessageElementValidationError.code`. */
export type ElementErrorCode =
  | "UNKNOWN_TYPE"
  | "UNSENDABLE_TYPE"
  | "MISSING_FIELD"
  | "INVALID_FIELD"
  | "UNEXPECTED_FIELD";

/**
 * Raised for anything the reference would refuse before touching the wire.
 *
 * Carries the element type and field so a caller can map it to an OneBot BAD_REQUEST
 * with a pointer at the offending part, which is what the reference does.
 */
export class MessageElementValidationError extends Error {
  readonly code: ElementErrorCode;
  readonly elementType: string;
  readonly field?: string;
  override readonly name = "MessageElementValidationError";

  constructor(code: ElementErrorCode, message: string, elementType: string, field?: string) {
    super(message);
    this.code = code;
    this.elementType = elementType;
    if (field !== undefined) this.field = field;
  }
}

/** Forward-card preview entry. Only `text` exists; the manifest rejects any other key. */
export interface ForwardNewsItem {
  text: string;
}

interface SegmentBase {
  type: string;
}

export interface TextSegment extends SegmentBase {
  type: "text";
  text: string;
}

export interface AtSegment extends SegmentBase {
  type: "at";
  /** 0 means @all, and then `uid` should be "all". */
  targetUin: number;
  uid?: string;
  /** Pre-rendered `@name ` text. Resolved from the member cache when absent. */
  text?: string;
}

export interface FaceSegment extends SegmentBase {
  type: "face";
  faceId: number;
  /** `false` forces the classic/small encoding and forbids `resultId`. Defaults true. */
  large?: boolean;
  /** Animation id for super faces. Requires `large !== false`. */
  resultId?: string;
}

export interface ReplySegment extends SegmentBase {
  type: "reply";
  replySeq: number;
  replyMessageId?: number;
  replySenderUin?: number;
  replyTime?: number;
  replyRandom?: number;
  replyElements?: readonly Segment[];
}

export interface JsonSegment extends SegmentBase {
  type: "json";
  text: string;
}

export interface XmlSegment extends SegmentBase {
  type: "xml";
  text: string;
  /** RichMsg serviceId. Defaults to 35, which is the "structure card" service. */
  subType?: number;
}

export interface ForwardSegment extends SegmentBase {
  type: "forward";
  resId: string;
  forwardSource?: string;
  forwardSummary?: string;
  forwardPrompt?: string;
  forwardNews?: readonly ForwardNewsItem[];
  forwardTSum?: number;
  forwardUuid?: string;
}

export interface ImageSegment extends SegmentBase {
  type: "image";
  imageUrl?: string;
  fileId?: string;
  fileName?: string;
  fileSize?: number;
  url?: string;
  subType?: number;
  summary?: string;
  width?: number;
  height?: number;
  flash?: boolean;
  md5Hex?: string;
  sha1Hex?: string;
  picFormat?: number;
  /**
   * "Upload by fingerprint only; never read the bytes."
   *
   * It is in `SEGMENT_FIELDS.image` (reference:6519) but was MISSING from this
   * interface, so any caller setting it failed to compile while the whitelist happily
   * allowed it. The semantics are the reference's (reference:110462 `loadImage`): when
   * true, `md5Hex` + `sha1Hex` are mandatory and the uploader skips `resolveSegmentBytes`
   * entirely — which is what makes re-forwarding a decoded image possible at all, since
   * a decoded segment has no readable byte source.
   */
  noByteFallback?: boolean;
}

export interface RecordSegment extends SegmentBase {
  type: "record";
  fileName?: string;
  fileId?: string;
  fileSize?: number;
  fileHash?: string;
  url?: string;
  duration?: number;
  md5Hex?: string;
  sha1Hex?: string;
  voiceFormat?: number;
  /** Fingerprint-only upload; requires `md5Hex` + `sha1Hex`. See `ImageSegment`. */
  noByteFallback?: boolean;
}

export interface VideoSegment extends SegmentBase {
  type: "video";
  fileName?: string;
  fileId?: string;
  fileSize?: number;
  fileHash?: string;
  url?: string;
  thumbUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
  md5Hex?: string;
  sha1Hex?: string;
  videoFormat?: number;
  /** Fingerprint-only upload; requires `md5Hex` + `sha1Hex`. See `ImageSegment`. */
  noByteFallback?: boolean;
}

export interface MfaceSegment extends SegmentBase {
  type: "mface";
  /** 32 hex chars: the sticker GUID. Encoded onto the wire as raw bytes. */
  emojiId: string;
  emojiPackageId?: number;
  emojiKey?: string;
  text?: string;
}

export interface FileSegment extends SegmentBase {
  type: "file";
  fileId?: string;
  fileName?: string;
  fileSize?: number;
  fileHash?: string;
  url?: string;
  md5Hex?: string;
  sha1Hex?: string;
}

export interface PokeSegment extends SegmentBase {
  type: "poke";
  subType: number;
}

export interface MarkdownSegment extends SegmentBase {
  type: "markdown";
  text: string;
}

/**
 * Every segment this module can encode.
 *
 * `inline_keyboard` and `flash_file` are absent on purpose: the reference manifest marks
 * their send direction unsupported and `buildSendContent` has no case for them. Adding
 * them here without a wire encoding would be inventing protocol.
 */
export type Segment =
  | TextSegment
  | AtSegment
  | FaceSegment
  | ReplySegment
  | JsonSegment
  | XmlSegment
  | ForwardSegment
  | ImageSegment
  | RecordSegment
  | VideoSegment
  | MfaceSegment
  | FileSegment
  | PokeSegment
  | MarkdownSegment;

export type SegmentType = Segment["type"];

/** The 14 encodable types, in the order the reference's dispatch switch lists them. */
export const ENCODABLE_SEGMENT_TYPES = [
  "text",
  "face",
  "poke",
  "mface",
  "at",
  "reply",
  "json",
  "xml",
  "markdown",
  "image",
  "forward",
  "record",
  "video",
  "file",
] as const satisfies readonly SegmentType[];

/**
 * Types the reference declares but never encodes for sending, with the reason.
 *
 * Kept as data so a caller gets a specific error instead of "unknown type", and so the
 * gap is visible in one place rather than implied by absence.
 */
export const UNENCODED_SEGMENT_TYPES: Readonly<Record<string, string>> = {
  inline_keyboard: "receive-only: the reference manifest marks its send direction unsupported",
  flash_file: "sent through the send_flash_msg action, not through PbSendMsg",
};

// ===========================================================================
// SendContext -- what the media and mention builders need from the outside world
// ===========================================================================

/** A group member as the mention resolver sees it. `card` is the per-group nickname. */
export interface MentionMember {
  uid?: string;
  card?: string;
  nickname?: string;
}

/** A friend as the mention resolver sees it. Friends have a `remark`, not a `card`. */
export interface MentionFriend {
  uid?: string;
  remark?: string;
  nickname?: string;
}

/**
 * The identity lookups and uploads element building depends on.
 *
 * The reference reaches these through a fat `bridge` object (QQ account state, highway
 * client, caches). Narrowing it to the four calls this module actually makes means the
 * builders are testable without a QQ session, which is the point of the split.
 */
export interface ElementIdentity {
  findGroupMember?(groupId: number | string, uin: number): MentionMember | undefined;
  findFriend?(uin: number): MentionFriend | undefined;
  resolveUid?(uin: number, groupId: number | string): Promise<string>;
}

/** Metadata for a previously uploaded file, keyed by the id the upload returned. */
export interface UploadedFileMeta {
  fileName?: string;
  fileSize?: number;
  fileMd5?: Uint8Array;
  fileSha1?: Uint8Array;
  fileHash?: string;
}

/**
 * Supplies an already-uploaded `MsgInfo` for one media segment.
 *
 * The reference inlines the NTV2 highway upload here; that code is 25 KB and lives in
 * `highway/image-upload.ts`, `highway/ptt-upload.ts` and `highway/video-upload.ts`
 * (`reference/index.mjs:110501`, `:110879`, `:37622`), i.e. outside the region this file
 * was extracted from. Taking the encoded `MsgInfo` as an input keeps that boundary
 * honest: this module owns the envelope, the upload module owns the payload.
 */
export interface MediaUploadResult {
  /** The encoded `MsgInfo` that becomes `commonElem.pbElem`. */
  msgInfo: Uint8Array;
  /**
   * c2c voice only: the legacy `Anonymous{ptt}` bytes the client needs to play the
   * recording. The reference's `uploadPtt` returns this alongside the MsgInfo; a group
   * upload leaves it unset.
   */
  compatQMsg?: Uint8Array;
}

export type MediaUploader = (
  segment: ImageSegment | RecordSegment | VideoSegment,
) => Promise<MediaUploadResult>;

export interface SendContext {
  identity?: ElementIdentity;
  /** Present for group sends; its absence is what selects the c2c encodings. */
  groupId?: number;
  userUid?: string;
  /** Source group of a temporary session. Required when `scene` is "group-temp". */
  tempGroupId?: number;
  scene?: "group" | "direct-private" | "group-temp" | "forward";
  /** Set on the long-message (forward / multi-msg) path. Enables the `file` element. */
  forwardFake?: boolean;
  uploadMedia?: MediaUploader;
  recallUploadedFile?: (fileId: string) => UploadedFileMeta | undefined;
}

/** Result of {@link buildSendContent}. `voiceCompatibility` is non-null only on c2c voice. */
export interface SendContent {
  elems: Elem[];
  voiceCompatibility?: Uint8Array;
}

// ===========================================================================
// Validation -- the parts of element-manifest.ts the send path enforces
// ===========================================================================

/**
 * The field whitelist per type, straight from `ELEMENT_MANIFEST`
 * (reference/index.mjs:6371-6904, `fields:` entries).
 *
 * The reference rejects an unknown key with UNEXPECTED_FIELD rather than ignoring it, and
 * that matters: a typo like `target_uin` for `targetUin` would otherwise encode an @ of
 * uin 0 (i.e. @all) and the caller would never learn why their message pinged everyone.
 */
const SEGMENT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  text: ["text"],
  at: ["targetUin", "uid", "text"],
  face: ["faceId", "large", "resultId"],
  reply: ["replySeq", "replyMessageId", "replySenderUin", "replyTime", "replyRandom", "replyElements"],
  json: ["text"],
  xml: ["text", "subType"],
  forward: ["resId", "forwardSource", "forwardSummary", "forwardPrompt", "forwardNews", "forwardTSum", "forwardUuid"],
  image: [
    "imageUrl", "fileId", "fileName", "fileSize", "url", "subType", "summary",
    "width", "height", "flash", "md5Hex", "sha1Hex", "picFormat", "noByteFallback",
  ],
  record: [
    "fileName", "fileId", "fileSize", "fileHash", "url", "duration",
    "md5Hex", "sha1Hex", "voiceFormat", "noByteFallback", "mediaNode",
  ],
  video: [
    "fileName", "fileId", "fileSize", "fileHash", "url", "thumbUrl", "duration",
    "width", "height", "md5Hex", "sha1Hex", "videoFormat", "noByteFallback", "mediaNode",
  ],
  mface: ["emojiId", "emojiPackageId", "emojiKey", "text"],
  file: ["fileId", "fileName", "fileSize", "fileHash", "url", "md5Hex", "sha1Hex"],
  poke: ["subType"],
  markdown: ["text"],
};

/** Field whitelist for a type, or undefined when the type is not encodable. */
export function segmentFields(type: string): readonly string[] | undefined {
  return SEGMENT_FIELDS[type];
}

/**
 * Refuses a segment whose shape the reference would refuse.
 *
 * Only the W-direction rules are reproduced: the manifest also validates the receive and
 * decode directions, which belong to the msg-push rewrite. Anything enforced here is
 * traceable to a specific manifest clause or to a builder's own guard.
 */
export function assertValidSegment(segment: Segment): void {
  const type = segment.type;
  const allowed = SEGMENT_FIELDS[type];
  if (allowed !== undefined) {
    for (const key of Object.keys(segment)) {
      if (key !== "type" && !allowed.includes(key)) {
        throw new MessageElementValidationError(
          "UNEXPECTED_FIELD",
          `message element "${type}" does not allow field "${key}"`,
          type,
          key,
        );
      }
    }
  }
  switch (type) {
    case "text":
    case "markdown":
      requireNonEmptyString(segment.text, type, "text");
      return;
    case "json":
      requireNonEmptyString(segment.text, type, "text");
      // The manifest parses json on the W direction and refuses a non-object.
      try {
        const parsed: unknown = JSON.parse(segment.text);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("not an object");
        }
      } catch {
        throw new MessageElementValidationError(
          "INVALID_FIELD",
          'message element "json" field "text" must contain a JSON object',
          type,
          "text",
        );
      }
      return;
    case "xml":
      requireNonEmptyString(segment.text, type, "text");
      return;
    case "at":
      if (!Number.isInteger(segment.targetUin) || segment.targetUin < 0) {
        throw new MessageElementValidationError(
          "INVALID_FIELD",
          'message element "at" field "targetUin" must be a non-negative integer',
          type,
          "targetUin",
        );
      }
      return;
    case "face":
      if (!Number.isInteger(segment.faceId) || segment.faceId < 0) {
        throw new MessageElementValidationError(
          "INVALID_FIELD",
          'message element "face" field "faceId" must be a non-negative integer',
          type,
          "faceId",
        );
      }
      if (segment.resultId !== undefined) {
        if (!segment.resultId.trim()) {
          throw new MessageElementValidationError("INVALID_FIELD", "face.resultId must not be empty", type, "resultId");
        }
        if (segment.large === false) {
          throw new MessageElementValidationError(
            "INVALID_FIELD",
            "face.resultId requires an animated face; large cannot be false",
            type,
            "resultId",
          );
        }
      }
      return;
    case "reply":
      if (!Number.isInteger(segment.replySeq) || segment.replySeq <= 0) {
        throw new MessageElementValidationError(
          "INVALID_FIELD",
          'message element "reply" field "replySeq" must be a positive integer',
          type,
          "replySeq",
        );
      }
      return;
    case "mface":
      if (!/^[0-9a-fA-F]{32}$/.test(segment.emojiId)) {
        throw new MessageElementValidationError(
          "INVALID_FIELD",
          'message element "mface" field "emojiId" must be exactly 32 hexadecimal characters',
          type,
          "emojiId",
        );
      }
      return;
    case "forward":
      requireNonEmptyString(segment.resId, type, "resId");
      return;
    case "poke":
      // The manifest requires subType but the reference sends `poke` with whatever
      // value it was given; only the destination policy is strict (see sendPokePolicy).
      return;
    case "image":
    case "record":
    case "video":
    case "file": {
      if (segment.md5Hex !== undefined && !/^[0-9a-fA-F]{32}$/.test(segment.md5Hex)) {
        throw new MessageElementValidationError(
          "INVALID_FIELD",
          `message element "${type}" field "md5Hex" must be exactly 32 hexadecimal characters`,
          type,
          "md5Hex",
        );
      }
      if (segment.sha1Hex !== undefined && !/^[0-9a-fA-F]{40}$/.test(segment.sha1Hex)) {
        throw new MessageElementValidationError(
          "INVALID_FIELD",
          `message element "${type}" field "sha1Hex" must be exactly 40 hexadecimal characters`,
          type,
          "sha1Hex",
        );
      }
      return;
    }
    default: {
      // Exhaustive over Segment; reaching here means an untyped caller passed a raw string.
      const raw = (segment as { type?: unknown }).type;
      const known = typeof raw === "string" ? UNENCODED_SEGMENT_TYPES[raw] : undefined;
      throw new MessageElementValidationError(
        known !== undefined ? "UNSENDABLE_TYPE" : "UNKNOWN_TYPE",
        known !== undefined
          ? `message element "${String(raw)}" cannot be sent; ${known}`
          : `unknown message element type: ${String(raw)}`,
        String(raw),
      );
    }
  }
}

function requireNonEmptyString(value: unknown, type: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new MessageElementValidationError(
      "INVALID_FIELD",
      `message element "${type}" field "${field}" must not be empty`,
      type,
      field,
    );
  }
}

/**
 * A video is a standalone message: siblings are accepted on the wire but never rendered,
 * so a mixed message reports success while showing something else. Refuse it.
 * (reference/index.mjs:6383 `assertVideoSendPolicy`)
 */
export function assertVideoSendPolicy(videoCount: number, segmentCount: number): void {
  if (videoCount === 0) return;
  if (videoCount !== 1) {
    throw new MessageElementValidationError(
      "UNSENDABLE_TYPE",
      'message element "video" may appear only once in a message',
      "video",
    );
  }
  if (segmentCount !== 1) {
    throw new MessageElementValidationError(
      "UNSENDABLE_TYPE",
      'message element "video" must be the only segment in a message',
      "video",
    );
  }
}

/**
 * Window shake is an action, not content: it only means anything to a friend in a
 * direct private chat, and it cannot share a message.
 * (reference/index.mjs:6375 `assertWindowShakeSendPolicy`)
 */
export function assertWindowShakeSendPolicy(
  windowShakeCount: number,
  segmentCount: number,
  scene: SendContext["scene"],
): void {
  if (windowShakeCount === 0) return;
  if (scene !== "direct-private") {
    throw new MessageElementValidationError(
      "UNSENDABLE_TYPE",
      'message element "poke" can only be sent in a direct private chat',
      "poke",
    );
  }
  if (windowShakeCount !== 1 || segmentCount !== 1) {
    throw new MessageElementValidationError(
      "UNSENDABLE_TYPE",
      'message element "poke" must be the only segment in a private window-shake request',
      "poke",
    );
  }
}

// ===========================================================================
// Per-type builders
// ===========================================================================

/**
 * Deflates a card payload and prefixes the `0x01` marker byte.
 *
 * Both xml and JSON cards go through this. The marker is what tells the client the
 * payload is compressed; without it the card renders as empty rather than failing
 * loudly. (reference 121453 `makeDeflatedPayload`)
 */
export function makeDeflatedPayload(content: string): Uint8Array {
  const deflated = new Uint8Array(deflateSync(Buffer.from(content, "utf8")));
  const payload = new Uint8Array(deflated.length + 1);
  payload[0] = 1;
  payload.set(deflated, 1);
  return payload;
}

/** text -> `Elem{text{str}}` (reference 121367). */
export function makeTextElem(text: string): Elem {
  return { text: { str: text } };
}

/** How a face id is put on the wire. Resolved from the system-face catalog by the caller. */
export interface FaceWire {
  kind: "classic" | "small" | "super";
  packId?: string;
  stickerId?: string;
  stickerType?: number;
}

/**
 * Resolves the wire form of a face id without a catalog.
 *
 * The reference asks `sysFaceStore` (a catalog of animated stickers) and falls back to
 * "classic below 260, small from 260 up" when the id is not listed
 * (`faceWireFor`, reference 109583). This reproduces only the fallback; a caller with a
 * catalog passes the resolved form in.
 */
export function classifyFace(faceId: number): FaceWire {
  return { kind: faceId < 260 ? "classic" : "small" };
}

/**
 * face -> one of three encodings (reference 121370 `makeFaceElem`):
 *
 *   super    `commonElem{serviceType:37, QFaceExtra, businessType}`
 *   small    `commonElem{serviceType:33, QSmallFaceExtra}`
 *   classic  `face{index}`
 *
 * `large` selects between "ask the catalog" and "derive from the id". Passing
 * `large: false` on a super face downgrades it to the small form, which is what the
 * reference does for clients that cannot render the animation.
 */
export async function makeFaceElem(
  segment: FaceSegment,
  ctx?: SendContext & { resolveFaceWire?: (faceId: number) => FaceWire | Promise<FaceWire> },
): Promise<Elem> {
  const faceId = segment.faceId;
  const large = segment.large ?? true;
  const resolved =
    large && ctx?.resolveFaceWire !== undefined ? await ctx.resolveFaceWire(faceId) : classifyFace(faceId);
  const wire: FaceWire = large ? resolved : { kind: faceId < 260 ? "classic" : "small" };

  if (wire.kind === "super") {
    if (wire.packId === undefined || wire.stickerId === undefined || wire.stickerType === undefined) {
      throw new MessageElementValidationError(
        "INVALID_FIELD",
        `QQ system face id ${faceId} has incomplete super-face metadata`,
        "face",
      );
    }
    const stickerType = wire.stickerType;
    return {
      commonElem: {
        serviceType: 37,
        pbElem: encodeQFaceExtra({
          packId: wire.packId,
          stickerId: wire.stickerId,
          qsid: faceId,
          sourceType: 1,
          stickerType,
          ...(segment.resultId !== undefined ? { resultId: segment.resultId } : {}),
          randomType: 1,
        }),
        // Sticker types 0..3 travel as themselves; everything else collapses to 1.
        businessType: stickerType < 4 ? stickerType : 1,
      },
    };
  }
  if (segment.resultId !== undefined) {
    throw new MessageElementValidationError(
      "INVALID_FIELD",
      `face.resultId requires animation metadata for face ${faceId}`,
      "face",
      "resultId",
    );
  }
  if (wire.kind === "small") {
    return {
      commonElem: {
        serviceType: 33,
        pbElem: encodeQSmallFaceExtra({ faceId, preview: "", preview2: "" }),
        businessType: 1,
      },
    };
  }
  return { face: { index: faceId } };
}

/**
 * Looks up the display name a mention should render.
 *
 * For a group the card wins over the nickname; for a friend the remark wins over the
 * nickname. Empty when the identity has no entry, in which case the caller falls back to
 * the numeric uin. (reference 121397 `resolveMentionDisplay`)
 */
export function resolveMentionDisplay(ctx: SendContext | undefined, targetUin: number): string {
  if (ctx?.identity === undefined || targetUin === 0) return "";
  if (ctx.groupId !== undefined) {
    const member = ctx.identity.findGroupMember?.(ctx.groupId, targetUin);
    return member?.card?.trim() || member?.nickname?.trim() || "";
  }
  const friend = ctx.identity.findFriend?.(targetUin);
  return friend?.remark?.trim() || friend?.nickname?.trim() || "";
}

/**
 * at -> `Elem{text{str, pbReserve}}` (reference 121407).
 *
 * A mention is **not** a dedicated element type: it is a text element whose
 * `pbReserve` carries `MentionExtraSend`. The rendered `@name ` must be present too,
 * because clients that do not understand the reserve still show the plain text.
 */
export function makeMentionElem(segment: AtSegment, ctx?: SendContext): Elem {
  const mentionAll = segment.uid === "all" || segment.targetUin === 0;
  const targetUin = segment.targetUin;
  const extra = encodeMentionExtraSend({
    type: mentionAll ? 1 : 2,
    // @all carries its identity in the uid string, so the numeric field stays 0.
    uin: mentionAll ? 0 : targetUin,
    field5: 0,
    uid: mentionAll ? "all" : segment.uid ?? "",
  });
  let str = segment.text;
  if (str === undefined || str === "") {
    if (mentionAll) str = "@全体成员 ";
    else {
      const name = resolveMentionDisplay(ctx, targetUin);
      str = name !== "" ? `@${name} ` : `@${targetUin} `;
    }
  }
  return { text: { str, pbReserve: extra } };
}

/**
 * reply -> `Elem{srcMsg{...}}` (reference 121427).
 *
 * `replySeq` is masked to 32 bits because QQ's sequence is unsigned but the id a caller
 * holds may have come back signed. Only `text` previews are embedded: a reply that
 * quotes an image shows the image on the server side from `origSeqs` alone.
 */
export function makeReplyElem(segment: ReplySegment): Elem {
  const srcMsg: SrcMsg = { origSeqs: [segment.replySeq & 0xffffffff] };
  if (segment.replySenderUin !== undefined && segment.replySenderUin !== 0) {
    srcMsg.senderUin = BigInt(segment.replySenderUin);
  }
  if (segment.replyTime !== undefined && segment.replyTime !== 0) srcMsg.time = segment.replyTime;
  const previews = (segment.replyElements ?? []).filter(
    (e): e is TextSegment => e.type === "text" && (e as TextSegment).text.length > 0,
  );
  if (previews.length > 0) srcMsg.elemsRaw = previews.map((e) => encodeElem(makeTextElem(e.text)));
  return { srcMsg };
}

/**
 * The extra mention that follows a reply in a group when the message also @s someone
 * (reference 121435 `makeReplyMentionElem`).
 *
 * Returns null when the target is not a resolvable group member -- the reference treats
 * that as "no mention" rather than as an error, because the reply itself is still valid.
 */
export async function makeReplyMentionElem(ctx: SendContext, uin: number): Promise<Elem | null> {
  if (ctx.groupId === undefined || uin <= 0) return null;
  const member = ctx.identity?.findGroupMember?.(ctx.groupId, uin);
  let uid = member?.uid ?? "";
  if (uid === "" && ctx.identity?.resolveUid !== undefined) {
    uid = await ctx.identity.resolveUid(uin, ctx.groupId).catch(() => "");
  }
  if (uid === "") return null;
  const name = member?.card?.trim() || member?.nickname?.trim() || String(uin);
  return {
    text: {
      str: `@${name} `,
      pbReserve: encodeMentionExtraSend({ type: 2, uin: 0, field5: 0, uid }),
    },
  };
}

/** json -> `Elem{lightApp{data}}` (reference 121460). */
export function makeJsonElem(segment: JsonSegment): Elem {
  return { lightApp: { data: makeDeflatedPayload(segment.text) } };
}

/**
 * xml -> `Elem{richMsg{serviceId, template1}}` (reference 121463).
 *
 * `subType` doubles as the RichMsg serviceId; 35 is the default the reference uses for
 * a plain structure card.
 */
export function makeXmlElem(segment: XmlSegment): Elem {
  return {
    richMsg: {
      serviceId: segment.subType === 0 ? 35 : segment.subType ?? 35,
      template1: makeDeflatedPayload(segment.text),
    },
  };
}

/** markdown -> `commonElem{serviceType:45}` (reference 121470). */
export function makeMarkdownElem(segment: MarkdownSegment): Elem {
  return {
    commonElem: {
      serviceType: 45,
      pbElem: encodeMarkdownData({ content: segment.text }),
      businessType: 1,
    },
  };
}

/**
 * poke -> `commonElem{serviceType:2, businessType:subType}` (reference 121477).
 *
 * `businessType` repeats the poke type; the server reads it as the action selector.
 */
export function makePokeElem(segment: PokeSegment): Elem {
  const pokeType = segment.subType;
  return {
    commonElem: {
      serviceType: 2,
      pbElem: encodePokeExtra({ type: pokeType }),
      businessType: pokeType,
    },
  };
}

/**
 * mface -> `Elem{marketFace{...}}` (reference 121495).
 *
 * The constants mirror NapCat's `PacketMsgMarkFaceElement.buildElement`: itemType 6,
 * faceInfo 1, subType 3, a 300x300 placeholder, and `pbReserve{field8:1}`. They are what
 * pairs the GUID with the package id so the server relays the sticker.
 */
export function makeMarketFaceElem(segment: MfaceSegment): Elem {
  return {
    marketFace: {
      faceName: segment.text ?? "",
      itemType: 6,
      faceInfo: 1,
      faceId: hexToBytes(segment.emojiId.trim()),
      tabId: segment.emojiPackageId ?? 0,
      subType: 3,
      key: segment.emojiKey ?? "",
      imageWidth: 300,
      imageHeight: 300,
      pbReserve: encodeMarketFacePbReserve({ field8: 1 }),
    },
  };
}

/** Escapes the five XML entities plus tab/CR/LF so a preview cannot break the card. */
function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("\t", "&#x9;")
    .replaceAll("\n", "&#xA;")
    .replaceAll("\r", "&#xD;");
}

/** Replaces control characters and lone surrogates with U+FFFD (reference 121540). */
function xmlPreviewText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu, "\uFFFD");
}

function escapeForwardPreview(value: string): string {
  return escapeXml(xmlPreviewText(value));
}

/**
 * forward -> either a `richMsg` card (when no `forwardUuid`) or a `lightApp` card
 * (reference 121521 `makeForwardElem`).
 *
 * The two branches are not interchangeable: a forward that already has a server-side
 * uuid is a `com.tencent.multimsg` JSON card, while a fresh one has to be described by
 * the legacy XML template so the client offers to fetch it.
 *
 * `generateUuid` exists only so tests can pin the random `uniseq`; production callers
 * leave it out and the reference's `randomUUID` behaviour is what they get.
 */
export function makeForwardElem(segment: ForwardSegment, generateUuid: () => string = randomUUID): Elem {
  const resId = (segment.resId ?? "").trim();
  if (resId === "") throw new Error("forward resId is required");
  const uniseq = (segment.forwardUuid ?? "").trim() || generateUuid();
  const source = segment.forwardSource !== undefined && segment.forwardSource.length > 0 ? segment.forwardSource : "聊天记录";
  const summary =
    segment.forwardSummary !== undefined && segment.forwardSummary.length > 0 ? segment.forwardSummary : "查看转发消息";
  const prompt =
    segment.forwardPrompt !== undefined && segment.forwardPrompt.length > 0 ? segment.forwardPrompt : "[聊天记录]";
  const news = segment.forwardNews ?? [];
  const tSum = segment.forwardTSum !== undefined && segment.forwardTSum > 0 ? segment.forwardTSum : Math.max(news.length, 1);

  if (segment.forwardUuid === undefined) {
    // The resId goes into an XML attribute, so a stray control character would produce a
    // card the client silently drops. Refuse it instead.
    if (xmlPreviewText(resId) !== resId) {
      throw new MessageElementValidationError(
        "INVALID_FIELD",
        "forward resId contains invalid characters",
        "forward",
        "resId",
      );
    }
    const escapedSource = escapeForwardPreview(source);
    const titles = news
      .map((item) => `<title color="#777777" size="26">${escapeForwardPreview(item.text)}</title>`)
      .join("");
    const xml =
      `<?xml version='1.0' encoding='UTF-8' standalone='yes'?> <msg serviceID="35" templateID="1" ` +
      `action="viewMultiMsg" brief="${escapeForwardPreview(prompt)}" m_fileName="${escapeXml(uniseq)}" ` +
      `m_resid="${escapeXml(resId)}" tSum="${tSum}" flag="3"><item layout="1"> ` +
      `<title color="#000000" size="34">${escapedSource}</title>${titles} <hr></hr> ` +
      `<summary color="#808080">${escapeForwardPreview(summary)}</summary></item> ` +
      `<source name="${escapedSource}"></source> </msg>`;
    return { richMsg: { template1: makeDeflatedPayload(xml), serviceId: 35 } };
  }

  const lightApp = {
    app: "com.tencent.multimsg",
    config: { autosize: 1, forward: 1, round: 1, type: "normal", width: 300 },
    desc: prompt,
    extra: JSON.stringify({ filename: uniseq, tsum: tSum }),
    meta: {
      detail: {
        news: news.map((n) => ({ text: n.text })),
        resid: resId,
        source,
        summary,
        uniseq,
      },
    },
    prompt,
    ver: "0.0.0.5",
    view: "contact",
  };
  return { lightApp: { data: makeDeflatedPayload(JSON.stringify(lightApp)) } };
}

/**
 * The legacy sibling that lets `get_forward_msg` rebuild an image URL.
 *
 * Long-message storage strips NT download paths, so a forward containing an image needs a
 * md5-bearing `customFace` (group) or `notOnlineImage` (private) next to the modern
 * `commonElem`. Returns null when no usable md5 is available.
 * (reference 121593 `makeLegacyForwardImageElem`)
 */
export function makeLegacyForwardImageElem(
  isGroup: boolean,
  segment: ImageSegment,
  fingerprints?: { md5Hex?: string; fileName?: string; fileSize?: number; width?: number; height?: number },
): Elem | null {
  const md5Hex = md5BytesFromHex(segment.md5Hex) ?? md5BytesFromHex(fingerprints?.md5Hex);
  if (md5Hex === null) return null;
  const hex = segment.md5Hex ?? fingerprints?.md5Hex ?? "";
  const fileName = segment.fileName ?? fingerprints?.fileName ?? `${hex.toLowerCase()}.png`;
  const fileSize = segment.fileSize ?? fingerprints?.fileSize ?? 0;
  const width = segment.width ?? fingerprints?.width ?? 0;
  const height = segment.height ?? fingerprints?.height ?? 0;
  if (isGroup) {
    return { customFace: { filePath: fileName, md5: md5Hex, size: fileSize, width, height } };
  }
  return {
    notOnlineImage: {
      filePath: fileName,
      picMd5: md5Hex,
      fileLen: fileSize,
      picWidth: width,
      picHeight: height,
    },
  };
}

function md5BytesFromHex(hex: string | undefined): Uint8Array | null {
  if (hex === undefined || !/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  const bytes = hexToBytes(hex);
  return bytes.length === 16 ? bytes : null;
}

/**
 * image -> `commonElem{serviceType:48, businessType:20|10}` (reference 121617).
 *
 * `businessType` is 20 in a group and 10 in c2c; the two are not interchangeable, and
 * getting it wrong produces a message the receiver renders as a broken placeholder.
 * On the forward path a legacy sibling follows the modern element; otherwise the array
 * holds exactly one.
 */
export async function makeImageElem(ctx: SendContext, segment: ImageSegment): Promise<Elem[]> {
  const isGroup = ctx.groupId !== undefined;
  const target = isGroup ? String(ctx.groupId) : ctx.userUid ?? "";
  if (!isGroup && target === "") throw new Error("private image target uid is missing");
  if (ctx.scene === "group-temp" && ctx.tempGroupId === undefined) {
    throw new Error("temp-session image source group is missing");
  }
  if (ctx.uploadMedia === undefined) {
    throw new MessageElementValidationError("MISSING_FIELD", 'message element "image" requires SendContext', "image");
  }
  const { msgInfo } = await ctx.uploadMedia(segment);
  const modern: Elem = {
    commonElem: { serviceType: 48, pbElem: msgInfo, businessType: isGroup ? 20 : 10 },
  };
  if (ctx.forwardFake !== true) return [modern];
  const legacy = makeLegacyForwardImageElem(isGroup, segment);
  return legacy !== null ? [modern, legacy] : [modern];
}

/**
 * record -> `commonElem{serviceType:48, businessType:22|12}` (reference 121633).
 *
 * Also returns the compatibility blob: a single voice message in a direct private chat
 * has to be followed by the legacy `ptt` bytes or the client shows a recording that
 * cannot be played. `compatQMsg` is only used when `scene === "direct-private"` and this
 * is the only record in the message.
 */
export async function makePttElem(
  ctx: SendContext,
  segment: RecordSegment,
): Promise<{ elem: Elem; compatQMsg?: Uint8Array }> {
  const isGroup = ctx.groupId !== undefined;
  const target = isGroup ? String(ctx.groupId) : ctx.userUid ?? "";
  if (!isGroup && target === "") throw new Error("private record target uid is missing");
  if (ctx.uploadMedia === undefined) {
    throw new MessageElementValidationError("MISSING_FIELD", 'message element "record" requires SendContext', "record");
  }
  const upload = await ctx.uploadMedia(segment);
  const elem: Elem = {
    commonElem: { serviceType: 48, pbElem: upload.msgInfo, businessType: isGroup ? 22 : 12 },
  };
  return upload.compatQMsg !== undefined ? { elem, compatQMsg: upload.compatQMsg } : { elem };
}

/**
 * video -> `commonElem{serviceType:48, businessType:21|11}` (reference 121698).
 *
 * Note the businessType is one higher than image's in each scene, and unlike image there
 * is no legacy sibling.
 */
export async function makeVideoElem(ctx: SendContext, segment: VideoSegment): Promise<Elem> {
  const isGroup = ctx.groupId !== undefined;
  const target = isGroup ? String(ctx.groupId) : ctx.userUid ?? "";
  if (!isGroup && target === "") throw new Error("private video target uid is missing");
  if (ctx.uploadMedia === undefined) {
    throw new MessageElementValidationError("MISSING_FIELD", 'message element "video" requires SendContext', "video");
  }
  return {
    commonElem: {
      serviceType: 48,
      pbElem: (await ctx.uploadMedia(segment)).msgInfo,
      businessType: isGroup ? 21 : 11,
    },
  };
}

/**
 * file -> `transElem{elemType:24, elemValue}` (reference 121667).
 *
 * The value is `0x01 | BE16(len) | GroupFileExtra`: a one-byte version marker, a
 * **big-endian** 16-bit length, then the protobuf. The length is big-endian on the wire
 * even though everything else here is little-endian, and the reference caps it at 65535.
 *
 * Only reachable on the forward path (`forwardFake`); a live group-file send goes through
 * OIDB 0x6d9_4 because the server rejects transElem(24) in PbSendMsg with result=79.
 */
export function makeGroupFileElem(segment: FileSegment, ctx?: SendContext): Elem {
  if (segment.fileId === undefined || segment.fileId === "") {
    throw new MessageElementValidationError("MISSING_FIELD", "file element missing fileId", "file", "fileId");
  }
  const cached = ctx?.recallUploadedFile?.(segment.fileId);
  const fileSize = segment.fileSize ?? cached?.fileSize ?? 0;
  const fileName = segment.fileName ?? cached?.fileName ?? "";
  const md5 = segment.md5Hex !== undefined ? hexToBytes(segment.md5Hex) : cached?.fileMd5 ?? EMPTY;
  const sha1 = segment.sha1Hex !== undefined ? hexToBytes(segment.sha1Hex) : cached?.fileSha1 ?? EMPTY;
  const extraBytes = encodeGroupFileExtra({
    field1: 6,
    fileName,
    inner: {
      info: {
        busId: 102,
        fileId: segment.fileId,
        fileSize: BigInt(fileSize),
        fileName,
        fileSha: sha1,
        extInfoString: "",
        fileMd5: md5,
      },
    },
  });
  if (extraBytes.length > 65535) throw new Error(`group file extra too large (${extraBytes.length} > 65535)`);
  const elemValue = new Uint8Array(3 + extraBytes.length);
  elemValue[0] = 1;
  elemValue[1] = (extraBytes.length >> 8) & 0xff;
  elemValue[2] = extraBytes.length & 0xff;
  elemValue.set(extraBytes, 3);
  return { transElem: { elemType: 24, elemValue } };
}

// ===========================================================================
// Dispatch
// ===========================================================================

/**
 * Builds `Elem`s from a list of segments.
 *
 * The preflight mirrors `buildSendContent`'s (reference 121713) guards, in the same
 * order, because the order decides which error a caller sees: a message that is both
 * empty-invalid and unsendable should complain about the destination first.
 *
 * Returns the voice compatibility blob alongside the elements; it is only produced for a
 * lone voice message in a direct private chat, and only `encodePrivateRichText` uses it.
 */
export async function buildSendContent(segments: readonly Segment[], ctx?: SendContext): Promise<SendContent> {
  for (const segment of segments) assertValidSegment(segment);
  assertVideoSendPolicy(segments.filter((s) => s.type === "video").length, segments.length);
  assertWindowShakeSendPolicy(
    segments.filter((s) => s.type === "poke").length,
    segments.length,
    ctx?.scene,
  );
  for (const segment of segments) {
    if ((segment.type === "image" || segment.type === "record" || segment.type === "video") && ctx === undefined) {
      throw new MessageElementValidationError(
        "MISSING_FIELD",
        `message element "${segment.type}" requires SendContext`,
        segment.type,
      );
    }
    if (segment.type === "file" && ctx?.forwardFake !== true) {
      throw new MessageElementValidationError(
        "UNSENDABLE_TYPE",
        'message element "file" must use the group/private file upload pipeline',
        "file",
      );
    }
  }

  const elems: Elem[] = [];
  let voiceCompatibility: Uint8Array | undefined;
  const singlePrivateVoice =
    ctx?.scene === "direct-private" && segments.filter((s) => s.type === "record").length === 1;
  const hasUserAt = segments.some((s) => s.type === "at");

  for (const segment of segments) {
    switch (segment.type) {
      case "text":
        elems.push(makeTextElem(segment.text));
        break;
      case "face":
        elems.push(await makeFaceElem(segment, ctx));
        break;
      case "poke":
        elems.push(makePokeElem(segment));
        break;
      case "mface":
        elems.push(makeMarketFaceElem(segment));
        break;
      case "at":
        elems.push(makeMentionElem(segment, ctx));
        break;
      case "reply": {
        elems.push(makeReplyElem(segment));
        // A reply in a group that also @s someone gets a trailing mention of the quoted
        // sender, so the person being answered sees the notification.
        if (hasUserAt && ctx?.groupId !== undefined && segment.replySenderUin !== undefined && segment.replySenderUin !== 0) {
          const mention = await makeReplyMentionElem(ctx, segment.replySenderUin);
          if (mention !== null) elems.push(mention);
        }
        break;
      }
      case "json":
        elems.push(makeJsonElem(segment));
        break;
      case "xml":
        elems.push(makeXmlElem(segment));
        break;
      case "markdown":
        elems.push(makeMarkdownElem(segment));
        break;
      case "image":
        elems.push(...(await makeImageElem(requireContext(ctx, "image"), segment)));
        break;
      case "forward":
        elems.push(makeForwardElem(segment));
        break;
      case "record": {
        const voice = await makePttElem(requireContext(ctx, "record"), segment);
        elems.push(voice.elem);
        if (singlePrivateVoice) voiceCompatibility = voice.compatQMsg;
        break;
      }
      case "video":
        elems.push(await makeVideoElem(requireContext(ctx, "video"), segment));
        break;
      case "file":
        // The preflight above guarantees forwardFake and a context here.
        if (ctx === undefined || ctx.forwardFake !== true) {
          throw new Error("element-builder file routing invariant failed after preflight");
        }
        if (ctx.groupId !== undefined) elems.push(makeGroupFileElem(segment, ctx));
        break;
      default: {
        const unreachable: never = segment;
        throw new Error(`element-builder dispatch invariant failed: ${String((unreachable as { type: string }).type)}`);
      }
    }
  }
  return voiceCompatibility !== undefined ? { elems, voiceCompatibility } : { elems };
}

function requireContext(ctx: SendContext | undefined, type: string): SendContext {
  if (ctx === undefined) {
    throw new MessageElementValidationError("MISSING_FIELD", `message element "${type}" requires SendContext`, type);
  }
  return ctx;
}

/** The elements alone. (reference 121783 `buildSendElems`) */
export async function buildSendElems(segments: readonly Segment[], ctx?: SendContext): Promise<Elem[]> {
  return (await buildSendContent(segments, ctx)).elems;
}

/**
 * A DECODED segment (`msg-push.ts`'s `MessageSegment`) → the SEND-side `Segment`.
 *
 * The reference never needed this because its bundle has one untyped `MessageElement`
 * that both directions use. This port has two unions — the receive one (`msg-push.ts`)
 * and the send one (this file) — and the forward path is the only place that must cross
 * from one to the other: `apis/forward.ts` decodes a long-message payload into
 * `MessageSegment[]`, and `forwardSingleMessage` re-uploads those same nodes to a
 * different chat, which means encoding them with `buildSendContent`.
 *
 * The crossing is field-by-field on purpose. A bare `as` would let a receiver-only
 * field reach `assertValidSegment` (which rejects unknown keys with
 * `UNEXPECTED_FIELD`) or, worse, let a sender read a field the decoder never set and
 * silently encode a zero.
 *
 * What is deliberately NOT carried across:
 *
 *   `image.imageUrl` → `url`   The receive side's `imageUrl` is a CDN display URL. The
 *                             send side's `url` means "fetch these bytes and upload
 *                             them". Copying one to the other would turn every
 *                             re-forwarded image into a re-download. So `imageUrl` is
 *                             copied to `imageUrl` only, and `noByteFallback` is set
 *                             (see below) so the uploader uses the fingerprints.
 *   `fileId`                  IS carried: it is the id BOTH sides use, and
 *                             `isCachedFileUsableInTarget` decides whether it can be
 *                             reused in the target chat.
 *   `mediaNode`               Dropped. It is receive-side download addressing
 *                             (`record`/`video` URL requests); the send side has no
 *                             reader for it. Carrying it would be dead weight that
 *                             `SEGMENT_FIELDS` then rejects on `image`.
 *
 * `noByteFallback: true` is set on image/record/video whenever the decoded segment has
 * BOTH fingerprints, because a decoded segment has no byte source this port can read
 * (`resolveSegmentBytes` would see `imageUrl`/`url` missing and throw "media segment has
 * no file source"). That is exactly the reference's own condition
 * (`element.noByteFallback`, reference:110462 / :110796 / :37573) — a fingerprint-only
 * reload. A decoded segment WITHOUT both fingerprints cannot be re-sent, and the caller
 * (`enrichForForward`) is the one that must fill them from the media cache; this
 * function does not invent them.
 *
 * `flash_file` throws: it has no send-side encoding at all (`Segment` excludes it — see
 * the union's own comment), and turning it into a `file` element would post a bubble
 * pointing at a `filesetId` the file store has never seen.
 */
export function messageSegmentToSendSegment(segment: MessageSegment): Segment {
  switch (segment.type) {
    case "text":
      return { type: "text", text: segment.text };
    case "at": {
      const out: AtSegment = { type: "at", targetUin: segment.targetUin };
      if (segment.text !== "") out.text = segment.text;
      if (segment.uid !== undefined && segment.uid !== "") out.uid = segment.uid;
      return out;
    }
    case "face": {
      const out: FaceSegment = { type: "face", faceId: segment.faceId };
      if (segment.resultId !== undefined && segment.resultId !== "") out.resultId = segment.resultId;
      return out;
    }
    case "mface": {
      const out: MfaceSegment = { type: "mface", emojiId: segment.emojiId };
      if (segment.emojiPackageId !== 0) out.emojiPackageId = segment.emojiPackageId;
      if (segment.emojiKey !== "") out.emojiKey = segment.emojiKey;
      if (segment.text !== "") out.text = segment.text;
      return out;
    }
    case "reply": {
      const out: ReplySegment = { type: "reply", replySeq: segment.replySeq };
      if (segment.replySenderUin !== undefined) out.replySenderUin = segment.replySenderUin;
      if (segment.replyTime !== undefined) out.replyTime = segment.replyTime;
      if (segment.replyElements !== undefined) {
        out.replyElements = segment.replyElements.map(messageSegmentToSendSegment);
      }
      return out;
    }
    case "json":
      return { type: "json", text: segment.text };
    case "xml": {
      const out: XmlSegment = { type: "xml", text: segment.text };
      if (segment.subType !== undefined) out.subType = segment.subType;
      return out;
    }
    case "forward": {
      const out: ForwardSegment = { type: "forward", resId: segment.resId };
      if (segment.forwardUuid !== undefined && segment.forwardUuid !== "") out.forwardUuid = segment.forwardUuid;
      return out;
    }
    case "markdown":
      return { type: "markdown", text: segment.text };
    case "image": {
      const out: ImageSegment = { type: "image" };
      if (segment.imageUrl !== "") out.imageUrl = segment.imageUrl;
      if (segment.fileId !== "") out.fileId = segment.fileId;
      if (segment.fileSize > 0) out.fileSize = segment.fileSize;
      if (segment.width > 0) out.width = segment.width;
      if (segment.height > 0) out.height = segment.height;
      if (segment.subType !== undefined) out.subType = segment.subType;
      if (segment.summary !== undefined && segment.summary !== "") out.summary = segment.summary;
      if (segment.md5Hex !== undefined && segment.md5Hex !== "") out.md5Hex = segment.md5Hex;
      if (segment.sha1Hex !== undefined && segment.sha1Hex !== "") out.sha1Hex = segment.sha1Hex;
      if (segment.picFormat !== undefined) out.picFormat = segment.picFormat;
      if (segment.flash === true) out.flash = true;
      if (out.md5Hex !== undefined && out.sha1Hex !== undefined) out.noByteFallback = true;
      return out;
    }
    case "record": {
      const out: RecordSegment = { type: "record" };
      if (segment.fileName !== "") out.fileName = segment.fileName;
      if (segment.fileId !== undefined && segment.fileId !== "") out.fileId = segment.fileId;
      if (segment.fileSize > 0) out.fileSize = segment.fileSize;
      if (segment.fileHash !== "") out.fileHash = segment.fileHash;
      if (segment.duration > 0) out.duration = segment.duration;
      if (segment.md5Hex !== undefined && segment.md5Hex !== "") out.md5Hex = segment.md5Hex;
      if (segment.sha1Hex !== undefined && segment.sha1Hex !== "") out.sha1Hex = segment.sha1Hex;
      if (segment.voiceFormat !== undefined) out.voiceFormat = segment.voiceFormat;
      if (out.md5Hex !== undefined && out.sha1Hex !== undefined) out.noByteFallback = true;
      return out;
    }
    case "video": {
      const out: VideoSegment = { type: "video" };
      if (segment.fileName !== "") out.fileName = segment.fileName;
      if (segment.fileId !== "") out.fileId = segment.fileId;
      if (segment.fileSize > 0) out.fileSize = segment.fileSize;
      if (segment.fileHash !== "") out.fileHash = segment.fileHash;
      if (segment.duration > 0) out.duration = segment.duration;
      if (segment.width !== undefined) out.width = segment.width;
      if (segment.height !== undefined) out.height = segment.height;
      if (segment.md5Hex !== undefined && segment.md5Hex !== "") out.md5Hex = segment.md5Hex;
      if (segment.sha1Hex !== undefined && segment.sha1Hex !== "") out.sha1Hex = segment.sha1Hex;
      if (segment.videoFormat !== undefined) out.videoFormat = segment.videoFormat;
      if (out.md5Hex !== undefined && out.sha1Hex !== undefined) out.noByteFallback = true;
      return out;
    }
    case "file": {
      const out: FileSegment = { type: "file" };
      if (segment.fileId !== "") out.fileId = segment.fileId;
      if (segment.fileName !== "") out.fileName = segment.fileName;
      if (segment.fileSize > 0) out.fileSize = segment.fileSize;
      if (segment.fileHash !== undefined && segment.fileHash !== "") out.fileHash = segment.fileHash;
      return out;
    }
    case "poke":
      return { type: "poke", subType: segment.subType };
    default: {
      // `flash_file` is the only remaining member, and it is genuinely unsendable here.
      const unsendable: { type?: unknown } = segment;
      const type = typeof unsendable.type === "string" ? unsendable.type : "unknown";
      throw new MessageElementValidationError(
        "UNSENDABLE_TYPE",
        `message element "${type}" has no send-side encoding and cannot be forwarded`,
        type,
      );
    }
  }
}

/**
 * The c2c `richText` body: modern elements, then the legacy voice blob when there is one.
 *
 * The two are concatenated rather than nested, and that is not a bug: the server parses
 * the trailing `Anonymous{ptt}` bytes after the `SendRichText` message ends. A private
 * voice upload that returns no playback info is refused rather than half-sent.
 * (reference 121786 `encodePrivateRichText`)
 */
export async function encodePrivateRichText(segments: readonly Segment[], ctx?: SendContext): Promise<Buffer> {
  const { elems, voiceCompatibility } = await buildSendContent(segments, ctx);
  const modern = encodeSendRichText({ elems });
  if (voiceCompatibility === undefined || voiceCompatibility.length === 0) return Buffer.from(modern);
  if (!anonymousHasPtt(voiceCompatibility)) {
    throw new Error("private voice upload returned incomplete playback information");
  }
  return Buffer.concat([Buffer.from(modern), Buffer.from(voiceCompatibility)]);
}

/**
 * Does the compatibility blob carry `Anonymous.ptt` (field 4)?
 *
 * The reference fully decodes `Anonymous` here; this only needs the one field, so it walks
 * the tags and stops as soon as it sees field 4 rather than materialising a message.
 */
function anonymousHasPtt(blob: Uint8Array): boolean {
  let at = 0;
  while (at < blob.length) {
    let tag = 0;
    let shift = 0;
    for (;;) {
      if (at >= blob.length) throw new Error("Truncated protobuf varint");
      const byte = blob[at++] as number;
      tag |= (byte & 127) << shift;
      shift += 7;
      if ((byte & 128) === 0) break;
    }
    const wireType = tag & 7;
    const fieldNumber = tag >>> 3;
    if (fieldNumber === 0) throw new Error("Invalid protobuf field number");
    if (wireType === 2) {
      let length = 0;
      let lshift = 0;
      for (;;) {
        if (at >= blob.length) throw new Error("Truncated protobuf varint");
        const byte = blob[at++] as number;
        length |= (byte & 127) << lshift;
        lshift += 7;
        if ((byte & 128) === 0) break;
      }
      if (fieldNumber === 4) return length > 0;
      at += length;
    } else if (wireType === 0) {
      for (;;) {
        if (at >= blob.length) throw new Error("Truncated protobuf varint");
        if (((blob[at++] as number) & 128) === 0) break;
      }
    } else if (wireType === 5) {
      at += 4;
    } else if (wireType === 1) {
      at += 8;
    } else {
      throw new Error(`unsupported wire type ${wireType} in Anonymous`);
    }
  }
  return false;
}
