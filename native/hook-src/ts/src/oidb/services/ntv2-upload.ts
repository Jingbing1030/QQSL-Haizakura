// The NTV2 rich-media upload request — the OIDB call that asks QQ's server for a
// highway upload session for an image, voice clip, or video.
//
// Reference region: `../protocol/src/oidb-services/highway/ntv2-upload-request.ts`
// (reference/index.mjs:23589+), generated encoders at `:27032`+.
// Field tables: `docs/ntv2-upload-codec.md` §2.
//
// ---------------------------------------------------------------------------
// Why this file is long and the comments are longer
// ---------------------------------------------------------------------------
// Seventeen nested messages, and **four** of them have field numbers that are not
// what their position suggests:
//
//   * `NTV2UploadSceneInfo` uses **100-based** numbering (101, 102, 200, 201, 202).
//     The tags are therefore multi-byte: field 101 is `a8 06`, which a naive
//     first-byte reading reports as "field 21". Getting this wrong means the scene
//     block names no target and the server rejects the upload — with an error that
//     says nothing about scene numbering.
//   * `PicExtData.textSummary` is field **9**, not 2.
//   * `PicExtBizInfo` skips 3–10 entirely: `bytesPbReserveC2c` is 11 and
//     `extData` is 12, then it jumps to 1001–1003.
//   * `PttExtBizInfo` skips 6–10: `bytesReserve` is 11.
//
// The last two are the kind of mistake that produces a *successful* upload of a
// message with no text summary, which is worse than a parse error because nobody
// notices until a user reports it.
//
// ---------------------------------------------------------------------------
// The hashes are hex STRINGS, not digests
// ---------------------------------------------------------------------------
// `NTV2FileInfo.fileHash` / `fileSha1` are strings of lowercase hex — 32 chars for
// an md5, 40 for a sha1. Sending the raw 16/20-byte digests is a different length,
// and the server rejects the hash. This is the single most common mistake here
// because everywhere *else* in this codebase a hash is bytes.
//
// ---------------------------------------------------------------------------
// `bytesPbReserveC2c` vs `extData` are mutually exclusive
// ---------------------------------------------------------------------------
// The private-image arm carries `bytesPbReserveC2c` (field 11); the group arm
// carries `extData` (field 12). The call site spreads exactly one of them. Sending
// both is not something the real client does, and the server's behaviour on it is
// unspecified.

import { ProtoWriter } from "../wire.js";

// ===========================================================================
// Field numbers
// ===========================================================================

/** `OidbBase` envelope for the NTV2 upload request. Fields 6–10 are skipped. */
export const Ntv2UploadEnvelopeField = {
  command: 1,
  subCommand: 2,
  errorCode: 3,
  body: 4,
  errorMsg: 5,
  properties: 11,
  reserved: 12,
} as const;

/** `NTV2UploadRichMediaReq`. */
export const Ntv2UploadRichMediaReqField = { reqHead: 1, upload: 2 } as const;

/** `NTV2UploadReqHead`. */
export const Ntv2UploadReqHeadField = { common: 1, scene: 2, client: 3 } as const;

/** `NTV2CommonHead`. `command` here is the SUB-command (100), a second copy. */
export const Ntv2CommonHeadField = { requestId: 1, command: 2 } as const;

/**
 * `NTV2UploadSceneInfo` — **100-based**. See the module comment.
 *
 * `c2c` (201) vs `group` (202) is the only scene difference between a private and
 * a group send.
 */
export const Ntv2UploadSceneInfoField = {
  requestType: 101,
  businessType: 102,
  sceneType: 200,
  c2c: 201,
  group: 202,
} as const;

/** `NTV2C2CUserInfo`. Field 3 is a pre-encoded `RoutingHead`, temp sessions only. */
export const Ntv2C2CUserInfoField = { accountType: 1, targetUid: 2, routingHead: 3 } as const;

/** `NTV2GroupInfo`. */
export const Ntv2GroupInfoField = { groupUin: 1 } as const;

/** `NTV2ClientMeta`. */
export const Ntv2ClientMetaField = { agentType: 1 } as const;

/** `NTV2UploadReq`. `clientRandomId` is uint64 — do not 32-bit truncate it. */
export const Ntv2UploadReqField = {
  uploadInfo: 1,
  tryFastUploadCompleted: 2,
  srvSendMsg: 3,
  clientRandomId: 4,
  compatQmsgSceneType: 5,
  extBizInfo: 6,
  clientSeq: 7,
  noNeedCompatMsg: 8,
} as const;

/** `NTV2UploadInfo`. `subFileType` 0 = primary, 100 = sub-file (video thumbnail). */
export const Ntv2UploadInfoField = { fileInfo: 1, subFileType: 2 } as const;

/** `NTV2FileInfo`. `fileHash`/`fileSha1` are hex STRINGS. */
export const Ntv2FileInfoField = {
  fileSize: 1,
  fileHash: 2,
  fileSha1: 3,
  fileName: 4,
  type: 5,
  width: 6,
  height: 7,
  time: 8,
  original: 9,
} as const;

/** `NTV2FileType`. `type`: 1 image, 2 video, 3 voice. */
export const Ntv2FileTypeField = {
  type: 1,
  picFormat: 2,
  videoFormat: 3,
  voiceFormat: 4,
} as const;

/** `NTV2ExtBizInfo`. All three arms are supplied; unused ones encode empty. */
export const Ntv2ExtBizInfoField = { pic: 1, video: 2, ptt: 3, busiType: 10 } as const;

/** `PicExtBizInfo`. Fields 3–10 are skipped. */
export const PicExtBizInfoField = {
  bizType: 1,
  textSummary: 2,
  bytesPbReserveC2c: 11,
  extData: 12,
  fromScene: 1001,
  toScene: 1002,
  oldFileId: 1003,
} as const;

/** `PicExtData`. `textSummary` is field 9, not 2. */
export const PicExtDataField = { subType: 1, textSummary: 9 } as const;

/** `VideoExtBizInfo`. */
export const VideoExtBizInfoField = {
  fromScene: 1,
  toScene: 2,
  bytesPbReserve: 3,
} as const;

/** `PttExtBizInfo`. Fields 6–10 are skipped. */
export const PttExtBizInfoField = {
  srcUin: 1,
  pttScene: 2,
  pttType: 3,
  changeVoice: 4,
  waveform: 5,
  autoConvertText: 6,
  bytesReserve: 11,
  bytesPbReserve: 12,
  bytesGeneralFlags: 13,
} as const;

/**
 * `NotOnlineImagePbReserve` — the nested blob inside `bytesPbReserveC2c`.
 *
 * The message declares 8 fields (1, 3, 4, 8, 10, 20, 30, 31) but the image upload
 * path supplies only **1 and 8**. Field 8 is `summary`, a STRING — not a numeric
 * flag, which is what an early reading of this assumed. Encoding it as a varint
 * produces an 18-byte blob of the right *length* and the wrong *shape*, so the
 * server accepts the upload and then renders the sticker with no label.
 */
export const NotOnlineImagePbReserveField = {
  subType: 1,
  field3: 3,
  field4: 4,
  summary: 8,
  field10: 10,
  field20: 20,
  url: 30,
  md5Str: 31,
} as const;

// ===========================================================================
// Media-type constants
// ===========================================================================

/** `NTV2FileType.type` values. */
export const Ntv2MediaType = { image: 1, video: 2, voice: 3 } as const;

/** `NTV2FileType.picFormat` values, from the reference's `detectImageFormat`. */
export const Ntv2PicFormat = {
  jpg: 1000,
  png: 1001,
  gifOrWebp: 1002,
  bmp: 1005,
} as const;

/** `NTV2UploadSceneInfo.sceneType`. */
export const Ntv2SceneType = { c2c: 1, group: 2 } as const;

/** `NTV2UploadSceneInfo.businessType`. */
export const Ntv2BusinessType = { image: 1, video: 2, voice: 3 } as const;

/** `NTV2UploadSceneInfo.requestType` — the same value on every call site. */
export const NTV2_REQUEST_TYPE = 2;

/** `NTV2ClientMeta.agentType` — the same value on every call site. */
export const NTV2_AGENT_TYPE = 2;

/** The OIDB sub-command. Also written into `NTV2CommonHead.command`. */
export const NTV2_UPLOAD_SUB_COMMAND = 100;

/** `NTV2UploadInfo.subFileType` for the primary file. */
export const NTV2_SUB_FILE_TYPE_PRIMARY = 0;

/** `NTV2UploadInfo.subFileType` for a video thumbnail. */
export const NTV2_SUB_FILE_TYPE_THUMBNAIL = 100;

// ===========================================================================
// Message types
// ===========================================================================

export interface Ntv2CommonHead {
  requestId?: number;
  /** The sub-command (100), not the OIDB command. */
  command?: number;
}

export interface Ntv2C2CUserInfo {
  accountType?: number;
  targetUid?: string;
  /** A pre-encoded `RoutingHead`; temp-session group uploads only. */
  routingHead?: Uint8Array;
}

export interface Ntv2GroupInfo {
  groupUin?: number;
}

export interface Ntv2UploadSceneInfo {
  requestType?: number;
  businessType?: number;
  sceneType?: number;
  c2c?: Ntv2C2CUserInfo;
  group?: Ntv2GroupInfo;
}

export interface Ntv2ClientMeta {
  agentType?: number;
}

export interface Ntv2UploadReqHead {
  common?: Ntv2CommonHead;
  scene?: Ntv2UploadSceneInfo;
  client?: Ntv2ClientMeta;
}

export interface Ntv2FileType {
  type?: number;
  picFormat?: number;
  videoFormat?: number;
  voiceFormat?: number;
}

export interface Ntv2FileInfo {
  fileSize?: number;
  /** Lowercase hex, 32 chars. NOT raw digest bytes. */
  fileHash?: string;
  /** Lowercase hex, 40 chars. NOT raw digest bytes. */
  fileSha1?: string;
  fileName?: string;
  type?: Ntv2FileType;
  width?: number;
  height?: number;
  time?: number;
  original?: number;
}

export interface Ntv2UploadInfo {
  fileInfo?: Ntv2FileInfo;
  subFileType?: number;
}

export interface PicExtData {
  subType?: number;
  /** Field 9. */
  textSummary?: string;
}

export interface PicExtBizInfo {
  bizType?: number;
  textSummary?: string;
  /** Private-image arm. Mutually exclusive with `extData`. */
  bytesPbReserveC2c?: Uint8Array;
  /** Group-image arm. Mutually exclusive with `bytesPbReserveC2c`. */
  extData?: PicExtData;
  fromScene?: number;
  toScene?: number;
  oldFileId?: number;
}

export interface VideoExtBizInfo {
  fromScene?: number;
  toScene?: number;
  bytesPbReserve?: Uint8Array;
}

export interface PttExtBizInfo {
  srcUin?: bigint;
  pttScene?: number;
  pttType?: number;
  changeVoice?: number;
  waveform?: Uint8Array;
  autoConvertText?: number;
  bytesReserve?: Uint8Array;
  bytesPbReserve?: Uint8Array;
  bytesGeneralFlags?: Uint8Array;
}

export interface Ntv2ExtBizInfo {
  pic?: PicExtBizInfo;
  video?: VideoExtBizInfo;
  ptt?: PttExtBizInfo;
  busiType?: number;
}

export interface Ntv2UploadReq {
  uploadInfo?: Ntv2UploadInfo[];
  tryFastUploadCompleted?: boolean;
  srvSendMsg?: boolean;
  /** uint64. Truncating to 32 bits still parses but no longer matches the client. */
  clientRandomId?: bigint;
  compatQmsgSceneType?: number;
  extBizInfo?: Ntv2ExtBizInfo;
  clientSeq?: number;
  noNeedCompatMsg?: boolean;
}

export interface Ntv2UploadRichMediaReq {
  reqHead?: Ntv2UploadReqHead;
  upload?: Ntv2UploadReq;
}

/** The full OIDB envelope plus body. */
export interface Ntv2UploadEnvelope {
  command: number;
  subCommand: number;
  errorCode?: number;
  body: Ntv2UploadRichMediaReq;
  errorMsg?: string;
  reserved?: number;
}

// ===========================================================================
// Encoders
// ===========================================================================

function encodeCommonHead(head: Ntv2CommonHead): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(Ntv2CommonHeadField.requestId, head.requestId);
  w.uint32(Ntv2CommonHeadField.command, head.command);
  return w.finish();
}

function encodeC2CUserInfo(info: Ntv2C2CUserInfo): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(Ntv2C2CUserInfoField.accountType, info.accountType);
  w.string(Ntv2C2CUserInfoField.targetUid, info.targetUid);
  w.bytes(Ntv2C2CUserInfoField.routingHead, info.routingHead);
  return w.finish();
}

function encodeGroupInfo(info: Ntv2GroupInfo): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(Ntv2GroupInfoField.groupUin, info.groupUin);
  return w.finish();
}

export function encodeUploadSceneInfo(scene: Ntv2UploadSceneInfo): Uint8Array {
  const w = new ProtoWriter();
  // These four are 100-based, so their tags are multi-byte. `ProtoWriter.uint32` computes the
  // varint tag itself, which is why this file never writes tag bytes by hand.
  w.uint32(Ntv2UploadSceneInfoField.requestType, scene.requestType);
  w.uint32(Ntv2UploadSceneInfoField.businessType, scene.businessType);
  w.uint32(Ntv2UploadSceneInfoField.sceneType, scene.sceneType);
  if (scene.c2c) w.message(Ntv2UploadSceneInfoField.c2c, encodeC2CUserInfo(scene.c2c));
  if (scene.group) w.message(Ntv2UploadSceneInfoField.group, encodeGroupInfo(scene.group));
  return w.finish();
}

function encodeClientMeta(meta: Ntv2ClientMeta): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(Ntv2ClientMetaField.agentType, meta.agentType);
  return w.finish();
}

function encodeReqHead(head: Ntv2UploadReqHead): Uint8Array {
  const w = new ProtoWriter();
  if (head.common) w.message(Ntv2UploadReqHeadField.common, encodeCommonHead(head.common));
  if (head.scene) w.message(Ntv2UploadReqHeadField.scene, encodeUploadSceneInfo(head.scene));
  if (head.client) w.message(Ntv2UploadReqHeadField.client, encodeClientMeta(head.client));
  return w.finish();
}

function encodeFileType(type: Ntv2FileType): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(Ntv2FileTypeField.type, type.type);
  w.uint32(Ntv2FileTypeField.picFormat, type.picFormat);
  w.uint32(Ntv2FileTypeField.videoFormat, type.videoFormat);
  w.uint32(Ntv2FileTypeField.voiceFormat, type.voiceFormat);
  return w.finish();
}

export function encodeFileInfo(info: Ntv2FileInfo): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(Ntv2FileInfoField.fileSize, info.fileSize);
  // Hex STRINGS. A `Uint8Array` here would produce a 16/20-byte field the server rejects.
  w.string(Ntv2FileInfoField.fileHash, info.fileHash);
  w.string(Ntv2FileInfoField.fileSha1, info.fileSha1);
  w.string(Ntv2FileInfoField.fileName, info.fileName);
  if (info.type) w.message(Ntv2FileInfoField.type, encodeFileType(info.type));
  w.uint32(Ntv2FileInfoField.width, info.width);
  w.uint32(Ntv2FileInfoField.height, info.height);
  w.uint32(Ntv2FileInfoField.time, info.time);
  w.uint32(Ntv2FileInfoField.original, info.original);
  return w.finish();
}

function encodeUploadInfo(info: Ntv2UploadInfo): Uint8Array {
  const w = new ProtoWriter();
  if (info.fileInfo) w.message(Ntv2UploadInfoField.fileInfo, encodeFileInfo(info.fileInfo));
  w.uint32(Ntv2UploadInfoField.subFileType, info.subFileType);
  return w.finish();
}

function encodePicExtData(data: PicExtData): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(PicExtDataField.subType, data.subType);
  w.string(PicExtDataField.textSummary, data.textSummary);
  return w.finish();
}

export function encodePicExtBizInfo(info: PicExtBizInfo): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(PicExtBizInfoField.bizType, info.bizType);
  w.string(PicExtBizInfoField.textSummary, info.textSummary);
  // Fields 3–10 are skipped, so these are 11 and 12. The two arms are mutually exclusive at
  // the call site; both are written here if supplied, because silently preferring one would
  // hide a caller bug rather than surface it.
  w.bytes(PicExtBizInfoField.bytesPbReserveC2c, info.bytesPbReserveC2c);
  if (info.extData) w.message(PicExtBizInfoField.extData, encodePicExtData(info.extData));
  w.uint32(PicExtBizInfoField.fromScene, info.fromScene);
  w.uint32(PicExtBizInfoField.toScene, info.toScene);
  w.uint32(PicExtBizInfoField.oldFileId, info.oldFileId);
  return w.finish();
}

function encodeVideoExtBizInfo(info: VideoExtBizInfo): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(VideoExtBizInfoField.fromScene, info.fromScene);
  w.uint32(VideoExtBizInfoField.toScene, info.toScene);
  w.bytes(VideoExtBizInfoField.bytesPbReserve, info.bytesPbReserve);
  return w.finish();
}

export function encodePttExtBizInfo(info: PttExtBizInfo): Uint8Array {
  const w = new ProtoWriter();
  w.uint64(PttExtBizInfoField.srcUin, info.srcUin);
  w.uint32(PttExtBizInfoField.pttScene, info.pttScene);
  w.uint32(PttExtBizInfoField.pttType, info.pttType);
  w.uint32(PttExtBizInfoField.changeVoice, info.changeVoice);
  w.bytes(PttExtBizInfoField.waveform, info.waveform);
  w.uint32(PttExtBizInfoField.autoConvertText, info.autoConvertText);
  // Fields 6–10 skipped: these are 11, 12, 13.
  w.bytes(PttExtBizInfoField.bytesReserve, info.bytesReserve);
  w.bytes(PttExtBizInfoField.bytesPbReserve, info.bytesPbReserve);
  w.bytes(PttExtBizInfoField.bytesGeneralFlags, info.bytesGeneralFlags);
  return w.finish();
}

export function encodeExtBizInfo(info: Ntv2ExtBizInfo): Uint8Array {
  const w = new ProtoWriter();
  // All three arms are supplied on every media type; the unused ones encode empty. A present
  // but empty nested message is `12 00` / `1a 00` on the wire, which is what the client sends.
  if (info.pic) w.message(Ntv2ExtBizInfoField.pic, encodePicExtBizInfo(info.pic));
  if (info.video) w.message(Ntv2ExtBizInfoField.video, encodeVideoExtBizInfo(info.video));
  if (info.ptt) w.message(Ntv2ExtBizInfoField.ptt, encodePttExtBizInfo(info.ptt));
  w.uint32(Ntv2ExtBizInfoField.busiType, info.busiType);
  return w.finish();
}

function encodeUploadReq(req: Ntv2UploadReq): Uint8Array {
  const w = new ProtoWriter();
  for (const info of req.uploadInfo ?? []) {
    w.message(Ntv2UploadReqField.uploadInfo, encodeUploadInfo(info));
  }
  w.bool(Ntv2UploadReqField.tryFastUploadCompleted, req.tryFastUploadCompleted);
  w.bool(Ntv2UploadReqField.srvSendMsg, req.srvSendMsg);
  w.uint64(Ntv2UploadReqField.clientRandomId, req.clientRandomId);
  w.uint32(Ntv2UploadReqField.compatQmsgSceneType, req.compatQmsgSceneType);
  if (req.extBizInfo) w.message(Ntv2UploadReqField.extBizInfo, encodeExtBizInfo(req.extBizInfo));
  w.uint32(Ntv2UploadReqField.clientSeq, req.clientSeq);
  w.bool(Ntv2UploadReqField.noNeedCompatMsg, req.noNeedCompatMsg);
  return w.finish();
}

export function encodeUploadRichMediaReq(req: Ntv2UploadRichMediaReq): Uint8Array {
  const w = new ProtoWriter();
  if (req.reqHead) w.message(Ntv2UploadRichMediaReqField.reqHead, encodeReqHead(req.reqHead));
  if (req.upload) w.message(Ntv2UploadRichMediaReqField.upload, encodeUploadReq(req.upload));
  return w.finish();
}

/**
 * Encode the full OIDB envelope.
 *
 * `reserved: 1` is the `uinForm` flag, which tells the transport to prepend the uin.
 * `encodeOidbEnvelope` in `envelope.ts` maps it, but this message writes its own
 * envelope because the reference's generated codec does — the field ordering differs
 * from the generic one.
 */
export function encodeNtv2UploadEnvelope(envelope: Ntv2UploadEnvelope): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(Ntv2UploadEnvelopeField.command, envelope.command);
  w.uint32(Ntv2UploadEnvelopeField.subCommand, envelope.subCommand);
  w.uint32(Ntv2UploadEnvelopeField.errorCode, envelope.errorCode);
  w.message(Ntv2UploadEnvelopeField.body, encodeUploadRichMediaReq(envelope.body));
  w.string(Ntv2UploadEnvelopeField.errorMsg, envelope.errorMsg);
  w.uint32(Ntv2UploadEnvelopeField.reserved, envelope.reserved);
  return w.finish();
}

/**
 * Encode a `NotOnlineImagePbReserve` — the private-image compatibility blob.
 *
 * The image upload path supplies only `subType` (always 1) and `summary` (the
 * localized media label, e.g. `[动画表情]`). The other six declared fields are for
 * the *download* direction and are never written here.
 *
 * Golden (`{ subType: 1, summary: "[动画表情]" }`):
 *   `0801420e5be58aa8e794bbe8a1a8e683855d`
 * Field 8 is wire type 2 (`0x42`), which is why this is a string and not a varint.
 */
export function encodeNotOnlineImagePbReserve(subType: number, summary: string): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(NotOnlineImagePbReserveField.subType, subType);
  w.string(NotOnlineImagePbReserveField.summary, summary);
  return w.finish();
}
