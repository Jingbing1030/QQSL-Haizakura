// OidbSvcTrpcTcp.0x126e_200 — resolve a group voice/PTT media node to a URL.
//
// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------
// The batch brief calls 0x126e a "profile card fetch".  It is `GetGroupPttUrl`
// (`command = 4718`, `subCommand = 200`, `uinForm = true`,
// reference/index.mjs:259482-259484) and it is the NTV2 rich-media download path
// for group PTT.  Two callers:
//
//   * `get_ai_record` (reference/index.mjs:14463) → `fetchAiVoice` → 0x929b →
//     `groupFile.getPttUrl` (reference/index.mjs:289996)
//   * the generic media-url resolver `resolveRemoteMediaUrl`
//     (reference/index.mjs:39766) for `record` media
//
// There is no profile anything on this command; the profile family is 0xfe1_2
// (see 0xfe1.ts).
//
// ---------------------------------------------------------------------------
// Field numbers — request
// ---------------------------------------------------------------------------
// NTV2 is a set of numbered-in-the-hundreds messages rather than a compact schema:
//
//   NTV2RichMediaReq      reference/index.mjs:256873 / 256904
//     1 reqHead -> NTV2ReqHead
//     3 download -> NTV2DownloadReq
//     4 downloadRkey -> NTV2DownloadRKeyReq
//   NTV2ReqHead           256985 / 257016   1 common, 2 scene, 3 client
//   NTV2CommonHead        257097 / 257113   1 requestId, 2 command
//   NTV2SceneInfo         257311            101 requestType, 102 businessType,
//                                            200 sceneType, 201 c2c, 202 group
//   NTV2GroupInfo         257518 / 257528   1 groupUin
//   NTV2ClientMeta        257556 / 257566   1 agentType
//   NTV2DownloadReq       257594 / 257616   1 node, 2 download
//   NTV2IndexNode         257671 / 257715   1 info, 2 fileUuid, 3 storeId,
//                                            4 uploadTime, 5 ttl, 6 subType
//   NTV2FileInfo          257871 / 257935   1 fileSize, 2 fileHash, 3 fileSha1,
//                                            4 fileName, 5 type, 6 width, 7 height,
//                                            8 time, 9 original
//   NTV2FileType          258170 / 258198   1 type, 2 picFormat, 3 videoFormat,
//                                            4 voiceFormat
//   NTV2DownloadExt       258301 / 258314   2 video            <-- field **2**, no field 1
//   NTV2VideoDownloadExt  258343 / 258365   1 busiType, 2 sceneType, 3 subBusiType
//
// ⚠️ `NTV2SceneInfo` uses **101/102/200/201/202** — a hundred-based numbering, not
// 1..5.  The `c2c` and `group` slots sit at 201/202.  Writing `group` at field 4
// produces a request whose scene has no group, which the server answers with a
// generic media error rather than a schema error (so it looks like a bad file id).
//
// ⚠️ `NTV2DownloadExt` starts at field **2**.  There is no field 1 in the message at
// all — the `video` slot is 2.  A "tidy" renumbering to 1 makes the server see an
// unknown field and ignore the download extension entirely.
//
// ⚠️ `busiType: 0` / `sceneType: 0` are supplied by `serialize` and are then
// **dropped** by the ordinary `!== 0` guard (reference/index.mjs:258343 region), so
// the `video` submessage is a zero-length nested message: `12 00`.  It is present,
// not absent — `download.download.video` is a message field whose guard is
// `!= null`, so an empty message still emits tag+len.
//
// ---------------------------------------------------------------------------
// Field numbers — response
// ---------------------------------------------------------------------------
//   NTV2RichMediaResp     reference/index.mjs:258692  1 respHead, 3 download, 4 downloadRkey
//   NTV2RespHead          258823  1 common, 2 retCode uint32, 3 message string
//   NTV2MediaDownloadResp 258952  1 rKeyParam string, 2 rKeyTtlSecond uint32,
//                                 3 info -> NTV2MediaDownloadInfo, 4 rKeyCreateTime uint32
//   NTV2MediaDownloadInfo 259101  1 domain string, 2 urlPath string, 3 httpsPort uint32
//
// The URL is assembled as `https://${domain}${urlPath}${rKeyParam}`
// (reference/index.mjs:256194).  Note that the scheme is hard-coded `https` and
// `httpsPort` is *not* used in the URL — a `:443` suffix would break the signature
// that `rKeyParam` carries.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 4718 = 0x126e. */
export const GROUP_PTT_URL_COMMAND = 0x126e;

export const GROUP_PTT_URL_SUB_COMMAND = 200;

/** Constants from `serialize` (reference/index.mjs:259486-259507). */
export const PTT_REQUEST_ID = 4;
export const PTT_COMMAND = 200;
export const PTT_REQUEST_TYPE = 1;
export const PTT_BUSINESS_TYPE = 3;
export const PTT_SCENE_TYPE = 2;
export const PTT_AGENT_TYPE = 2;

export const RichMediaReqField = { reqHead: 1, download: 3, downloadRkey: 4 } as const;
export const ReqHeadField = { common: 1, scene: 2, client: 3 } as const;
export const CommonHeadField = { requestId: 1, command: 2 } as const;
/** ⚠️ Hundred-based numbering; `group` is 202. */
export const SceneInfoField = {
  requestType: 101,
  businessType: 102,
  sceneType: 200,
  c2c: 201,
  group: 202,
} as const;
export const GroupInfoField = { groupUin: 1 } as const;
export const ClientMetaField = { agentType: 1 } as const;
export const DownloadReqField = { node: 1, download: 2 } as const;
export const IndexNodeField = {
  info: 1,
  fileUuid: 2,
  storeId: 3,
  uploadTime: 4,
  ttl: 5,
  subType: 6,
} as const;
export const FileInfoField = {
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
export const FileTypeField = { type: 1, picFormat: 2, videoFormat: 3, voiceFormat: 4 } as const;
/** ⚠️ `video` is field **2**; the message has no field 1. */
export const DownloadExtField = { video: 2 } as const;
export const VideoDownloadExtField = { busiType: 1, sceneType: 2, subBusiType: 3 } as const;

export const RichMediaRespField = { respHead: 1, download: 3, downloadRkey: 4 } as const;
export const RespHeadField = { common: 1, retCode: 2, message: 3 } as const;
export const MediaDownloadRespField = {
  rKeyParam: 1,
  rKeyTtlSecond: 2,
  info: 3,
  rKeyCreateTime: 4,
} as const;
export const MediaDownloadInfoField = { domain: 1, urlPath: 2, httpsPort: 3 } as const;

// ---------------------------------------------------------------------------
// Request messages
// ---------------------------------------------------------------------------

export interface FileType {
  type?: number | undefined;
  picFormat?: number | undefined;
  videoFormat?: number | undefined;
  voiceFormat?: number | undefined;
}

export interface FileInfo {
  fileSize?: number | undefined;
  fileHash?: string | undefined;
  fileSha1?: string | undefined;
  fileName?: string | undefined;
  type?: FileType | undefined;
  width?: number | undefined;
  height?: number | undefined;
  time?: number | undefined;
  original?: number | undefined;
}

export interface IndexNode {
  info?: FileInfo | undefined;
  fileUuid: string;
  storeId?: number | undefined;
  uploadTime?: number | undefined;
  ttl?: number | undefined;
  subType?: number | undefined;
}

export interface VideoDownloadExt {
  busiType?: number | undefined;
  sceneType?: number | undefined;
  subBusiType?: number | undefined;
}

export interface DownloadExt {
  video?: VideoDownloadExt | undefined;
}

export interface DownloadReq {
  node: IndexNode;
  download?: DownloadExt | undefined;
}

export interface CommonHead {
  requestId?: number | undefined;
  command?: number | undefined;
}

export interface GroupInfo {
  groupUin?: number | undefined;
}

export interface SceneInfo {
  requestType?: number | undefined;
  businessType?: number | undefined;
  sceneType?: number | undefined;
  c2c?: unknown;
  group?: GroupInfo | undefined;
}

export interface ClientMeta {
  agentType?: number | undefined;
}

export interface ReqHead {
  common?: CommonHead | undefined;
  scene?: SceneInfo | undefined;
  client?: ClientMeta | undefined;
}

export interface RichMediaReq {
  reqHead?: ReqHead | undefined;
  download?: DownloadReq | undefined;
  downloadRkey?: unknown;
}

/**
 * Coerce a numeric-ish value to a truncated integer
 * (reference/index.mjs:256170 `toInt$1`).
 *
 * Accepts number, bigint and numeric string, and maps anything else — including
 * NaN/Infinity — to 0.  This is the reference's leniency at the *media node*
 * boundary: nodes come from OneBot segment data, where widths and sizes are
 * routinely strings.
 */
/**
 * Coerce a wire value to an integer. NOT exported from the barrel.
 *
 * `0x6d7.ts` exports a function of the same name with a different signature, and two services
 * both exporting `toInt` makes the barrel ambiguous the moment anything tries to re-export it.
 * Marked @internal so it cannot leak by accident; the codec files that need it import this
 * module directly.
 *
 * @internal
 */
function toInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

export interface MediaNodeLike {
  fileUuid?: unknown;
  info?: {
    fileSize?: unknown;
    fileHash?: unknown;
    fileSha1?: unknown;
    fileName?: unknown;
    type?: {
      type?: unknown;
      picFormat?: unknown;
      videoFormat?: unknown;
      voiceFormat?: unknown;
    } | undefined;
    width?: unknown;
    height?: unknown;
    time?: unknown;
    original?: unknown;
  } | undefined;
  storeId?: unknown;
  uploadTime?: unknown;
  ttl?: unknown;
  subType?: unknown;
}

/**
 * `normalizeMediaNode` (reference/index.mjs:256201).
 *
 * Throws on a missing `fileUuid` — that is the one required slot, and a media
 * request without it can only fail server-side with an opaque error.  Every other
 * field is coerced through `toInt` / `typeof === "string"` so that malformed
 * segment data degrades to an omitted field instead of a bogus one.
 */
export function normalizeMediaNode(node: MediaNodeLike): IndexNode {
  const fileUuid = typeof node.fileUuid === "string" ? node.fileUuid : "";
  if (!fileUuid) throw new Error("media node fileUuid is required");
  const info = node.info ?? {};
  const type = info.type ?? {};
  return {
    info: {
      fileSize: toInt(info.fileSize),
      fileHash: typeof info.fileHash === "string" ? info.fileHash : "",
      fileSha1: typeof info.fileSha1 === "string" ? info.fileSha1 : "",
      fileName: typeof info.fileName === "string" ? info.fileName : "",
      type: {
        type: toInt(type.type),
        picFormat: toInt(type.picFormat),
        videoFormat: toInt(type.videoFormat),
        voiceFormat: toInt(type.voiceFormat),
      },
      width: toInt(info.width),
      height: toInt(info.height),
      time: toInt(info.time),
      original: toInt(info.original),
    },
    fileUuid,
    storeId: toInt(node.storeId),
    uploadTime: toInt(node.uploadTime),
    ttl: toInt(node.ttl),
    subType: toInt(node.subType),
  };
}

export function encodeFileType(t: FileType): Uint8Array {
  return new ProtoWriter()
    .uint32(FileTypeField.type, t.type)
    .uint32(FileTypeField.picFormat, t.picFormat)
    .uint32(FileTypeField.videoFormat, t.videoFormat)
    .uint32(FileTypeField.voiceFormat, t.voiceFormat)
    .finish();
}

export function encodeFileInfo(f: FileInfo): Uint8Array {
  return new ProtoWriter()
    .uint32(FileInfoField.fileSize, f.fileSize)
    .string(FileInfoField.fileHash, f.fileHash)
    .string(FileInfoField.fileSha1, f.fileSha1)
    .string(FileInfoField.fileName, f.fileName)
    .message(FileInfoField.type, f.type ? encodeFileType(f.type) : undefined)
    .uint32(FileInfoField.width, f.width)
    .uint32(FileInfoField.height, f.height)
    .uint32(FileInfoField.time, f.time)
    .uint32(FileInfoField.original, f.original)
    .finish();
}

export function encodeIndexNode(node: IndexNode): Uint8Array {
  return new ProtoWriter()
    .message(IndexNodeField.info, node.info ? encodeFileInfo(node.info) : undefined)
    .string(IndexNodeField.fileUuid, node.fileUuid)
    .uint32(IndexNodeField.storeId, node.storeId)
    .uint32(IndexNodeField.uploadTime, node.uploadTime)
    .uint32(IndexNodeField.ttl, node.ttl)
    .uint32(IndexNodeField.subType, node.subType)
    .finish();
}

export function encodeVideoDownloadExt(v: VideoDownloadExt): Uint8Array {
  return new ProtoWriter()
    .uint32(VideoDownloadExtField.busiType, v.busiType)
    .uint32(VideoDownloadExtField.sceneType, v.sceneType)
    .uint32(VideoDownloadExtField.subBusiType, v.subBusiType)
    .finish();
}

export function encodeDownloadExt(d: DownloadExt): Uint8Array {
  return new ProtoWriter()
    .message(DownloadExtField.video, d.video ? encodeVideoDownloadExt(d.video) : undefined)
    .finish();
}

export function encodeDownloadReq(d: DownloadReq): Uint8Array {
  return new ProtoWriter()
    .message(DownloadReqField.node, encodeIndexNode(d.node))
    .message(DownloadReqField.download, d.download ? encodeDownloadExt(d.download) : undefined)
    .finish();
}

export function encodeCommonHead(h: CommonHead): Uint8Array {
  return new ProtoWriter()
    .uint32(CommonHeadField.requestId, h.requestId)
    .uint32(CommonHeadField.command, h.command)
    .finish();
}

export function encodeGroupInfo(g: GroupInfo): Uint8Array {
  return new ProtoWriter().uint32(GroupInfoField.groupUin, g.groupUin).finish();
}

export function encodeSceneInfo(s: SceneInfo): Uint8Array {
  return new ProtoWriter()
    .uint32(SceneInfoField.requestType, s.requestType)
    .uint32(SceneInfoField.businessType, s.businessType)
    .uint32(SceneInfoField.sceneType, s.sceneType)
    .message(SceneInfoField.group, s.group ? encodeGroupInfo(s.group) : undefined)
    .finish();
}

export function encodeClientMeta(c: ClientMeta): Uint8Array {
  return new ProtoWriter().uint32(ClientMetaField.agentType, c.agentType).finish();
}

export function encodeReqHead(h: ReqHead): Uint8Array {
  return new ProtoWriter()
    .message(ReqHeadField.common, h.common ? encodeCommonHead(h.common) : undefined)
    .message(ReqHeadField.scene, h.scene ? encodeSceneInfo(h.scene) : undefined)
    .message(ReqHeadField.client, h.client ? encodeClientMeta(h.client) : undefined)
    .finish();
}

export function encodeRichMediaReq(body: RichMediaReq): Uint8Array {
  return new ProtoWriter()
    .message(RichMediaReqField.reqHead, body.reqHead ? encodeReqHead(body.reqHead) : undefined)
    .message(RichMediaReqField.download, body.download ? encodeDownloadReq(body.download) : undefined)
    .finish();
}

// ---------------------------------------------------------------------------
// Response decoding
// ---------------------------------------------------------------------------

export interface RichMediaCommonHead {
  requestId?: number | undefined;
  command?: number | undefined;
}

export interface RichMediaRespHead {
  common?: RichMediaCommonHead | undefined;
  retCode: number;
  message: string;
}

export interface MediaDownloadInfo {
  domain: string;
  urlPath: string;
  httpsPort: number;
}

export interface MediaDownloadResp {
  rKeyParam: string;
  rKeyTtlSecond: number;
  info?: MediaDownloadInfo | undefined;
  rKeyCreateTime: number;
}

export interface RichMediaResp {
  respHead?: RichMediaRespHead | undefined;
  download?: MediaDownloadResp | undefined;
  downloadRkey?: unknown;
}

function decodeRichMediaCommonHead(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): RichMediaCommonHead {
  const reader = new ProtoReader(data, offset, end);
  const h: RichMediaCommonHead = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(CommonHeadField.requestId, WireType.varint):
        h.requestId = reader.uint32();
        break;
      case tagOf(CommonHeadField.command, WireType.varint):
        h.command = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return h;
}

function decodeRichMediaRespHead(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): RichMediaRespHead {
  const reader = new ProtoReader(data, offset, end);
  const h: RichMediaRespHead = { retCode: 0, message: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(RespHeadField.common, WireType.lengthDelimited):
        h.common = reader.message(decodeRichMediaCommonHead);
        break;
      case tagOf(RespHeadField.retCode, WireType.varint):
        h.retCode = reader.uint32();
        break;
      case tagOf(RespHeadField.message, WireType.lengthDelimited):
        h.message = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return h;
}

function decodeMediaDownloadInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): MediaDownloadInfo {
  const reader = new ProtoReader(data, offset, end);
  const i: MediaDownloadInfo = { domain: "", urlPath: "", httpsPort: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(MediaDownloadInfoField.domain, WireType.lengthDelimited):
        i.domain = reader.string();
        break;
      case tagOf(MediaDownloadInfoField.urlPath, WireType.lengthDelimited):
        i.urlPath = reader.string();
        break;
      case tagOf(MediaDownloadInfoField.httpsPort, WireType.varint):
        i.httpsPort = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return i;
}

function decodeMediaDownloadResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): MediaDownloadResp {
  const reader = new ProtoReader(data, offset, end);
  const d: MediaDownloadResp = { rKeyParam: "", rKeyTtlSecond: 0, rKeyCreateTime: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(MediaDownloadRespField.rKeyParam, WireType.lengthDelimited):
        d.rKeyParam = reader.string();
        break;
      case tagOf(MediaDownloadRespField.rKeyTtlSecond, WireType.varint):
        d.rKeyTtlSecond = reader.uint32();
        break;
      case tagOf(MediaDownloadRespField.info, WireType.lengthDelimited):
        d.info = reader.message(decodeMediaDownloadInfo);
        break;
      case tagOf(MediaDownloadRespField.rKeyCreateTime, WireType.varint):
        d.rKeyCreateTime = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return d;
}

export function decodeRichMediaResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): RichMediaResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: RichMediaResp = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(RichMediaRespField.respHead, WireType.lengthDelimited):
        resp.respHead = reader.message(decodeRichMediaRespHead);
        break;
      case tagOf(RichMediaRespField.download, WireType.lengthDelimited):
        resp.download = reader.message(decodeMediaDownloadResp);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * `ensureRetCodeZero` (reference/index.mjs:259430-ish, shared helper).
 *
 * The NTV2 response carries its own `retCode` *inside* the body, independent of the
 * envelope's `errorCode`.  A nonzero `retCode` with an `errorCode: 0` envelope is
 * how NTV2 reports media-level failures, so skipping this check would turn an
 * expired-rkey or missing-file condition into "no URL found".
 */
export function ensureRetCodeZero(
  operation: string,
  code: unknown,
  msg: unknown,
  wording?: unknown,
): void {
  const retCode = toInt(code);
  if (retCode === 0) return;
  const detail =
    (typeof wording === "string" && wording) ||
    (typeof msg === "string" && msg) ||
    "unknown error";
  throw new Error(`${operation} failed: code=${retCode} msg=${detail}`);
}

/**
 * `parseNtv2DownloadUrl` (reference/index.mjs:256190).
 *
 * ⚠️ The scheme is always `https://`, and `httpsPort` is deliberately ignored.
 * Appending `:${httpsPort}` produces a URL whose `rKeyParam` signature no longer
 * matches the path the server signed.
 */
export function parseNtv2DownloadUrl(body: RichMediaResp): string {
  ensureRetCodeZero("ntv2 download", body.respHead?.retCode, body.respHead?.message, undefined);
  const domain = typeof body.download?.info?.domain === "string" ? body.download.info.domain : "";
  const path = typeof body.download?.info?.urlPath === "string" ? body.download.info.urlPath : "";
  const rKeyParam = typeof body.download?.rKeyParam === "string" ? body.download.rKeyParam : "";
  if (!domain || !path) throw new Error("ntv2 download response invalid");
  return `https://${domain}${path}${rKeyParam}`;
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

export interface GetGroupPttUrlParams {
  groupId: number;
  node: MediaNodeLike;
}

/**
 * GetGroupPttUrl spec.
 *
 * `node` is normalised inside `serialize`, so a malformed node throws there (before
 * any packet is built) rather than producing a request the server rejects with an
 * unrelated error.  That placement is the reference's.
 */
export const GetGroupPttUrl: OidbSpec<
  GetGroupPttUrlParams,
  RichMediaReq,
  RichMediaResp,
  string
> = {
  command: GROUP_PTT_URL_COMMAND,
  subCommand: GROUP_PTT_URL_SUB_COMMAND,
  uinForm: true,
  serialize: (params) => ({
    reqHead: {
      common: { requestId: PTT_REQUEST_ID, command: PTT_COMMAND },
      scene: {
        requestType: PTT_REQUEST_TYPE,
        businessType: PTT_BUSINESS_TYPE,
        sceneType: PTT_SCENE_TYPE,
        group: { groupUin: params.groupId },
      },
      client: { agentType: PTT_AGENT_TYPE },
    },
    download: {
      node: normalizeMediaNode(params.node),
      // Both zeros are dropped by the `!== 0` guard, leaving an empty `video`
      // message — present on the wire as `12 00`, exactly as the reference sends it.
      download: { video: { busiType: 0, sceneType: 0 } },
    },
  }),
  encodeBody: encodeRichMediaReq,
  decodeBody: decodeRichMediaResp,
  deserialize: (body) => parseNtv2DownloadUrl(body),
};