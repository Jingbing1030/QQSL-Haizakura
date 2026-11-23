// The group-file family — 0xe3b_0, 0x635_1c8, 0x11e6_200, 0x11ef_200, 0xe07_...

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";
import {
  ReqHeadField,
  SceneInfoField,
  ClientMetaField,
  RichMediaReqField,
  encodeCommonHead,
  encodeDownloadReq,
  encodeClientMeta,
  encodeDownloadExt,
  encodeIndexNode,
  decodeRichMediaResp,
  normalizeMediaNode,
  parseNtv2DownloadUrl,
  type RichMediaReq,
  type RichMediaResp,
  type MediaNodeLike,
} from "./0x126e.js";

// ---------------------------------------------------------------------------
// Command numbers
// ---------------------------------------------------------------------------

export const PRIVATE_FILE_DOWNLOAD_COMMAND = 3639;
export const PRIVATE_FILE_DOWNLOAD_SUB_COMMAND = 1200;
export const PRIVATE_FILE_UPLOAD_SUB_COMMAND = 1700;
export const OFFLINE_FILE_FINALIZE_SUB_COMMAND = 800;

export const PRIVATE_FILE_DOWNLOAD_TIMEOUT_MS = 30_000;

export const OidbPrivateFileDownloadReqField = {
  subCommand: 1,
  field2: 2,
  body: 14,
  field101: 101,
  field102: 102,
  field200: 200,
  field99999: 99999,
} as const;

export const OidbPrivateFileDownloadReqBodyField = {
  receiverUid: 10,
  fileUuid: 20,
  type: 30,
  fileHash: 60,
  t2: 601,
} as const;

export const OidbPrivateFileDownloadRespField = { body: 14 } as const;
export const OidbPrivateFileDownloadRespBodyField = { state: 20, result: 30 } as const;
export const OidbPrivateFileDownloadRespResultField = { server: 20, port: 40, url: 50 } as const;

export const OidbPrivateFileUploadReqField = {
  command: 1,
  seq: 2,
  upload: 19,
  businessId: 101,
  clientType: 102,
  flagSupportMediaPlatform: 200,
} as const;

export const OidbPrivateFileUploadReqBodyField = {
  senderUid: 10,
  receiverUid: 20,
  fileSize: 30,
  fileName: 40,
  md510MCheckSum: 50,
  sha1CheckSum: 60,
  localPath: 70,
  md5CheckSum: 110,
  sha3CheckSum: 120,
} as const;

export const OidbPrivateFileUploadRespField = { body: 19 } as const;
export const OidbPrivateFileUploadRespBodyField = {
  retCode: 10,
  retMsg: 20,
  uploadIp: 60,
  uploadDomain: 70,
  uploadPort: 80,
  uuid: 90,
  uploadKey: 100,
  boolFileExist: 110,
  uploadIpList: 130,
  uploadHttpsPort: 140,
  uploadHttpsDomain: 150,
  uploadDns: 160,
  uploadLanip: 170,
  fileAddon: 200,
  rtpMediaPlatformUploadAddress: 210,
  mediaPlatformUploadKey: 220,
} as const;

export const OidbOfflineFileFinalizeReqField = {
  subCommand: 1,
  field2: 2,
  body: 10,
  field101: 101,
  field102: 102,
  field200: 200,
} as const;

export const OidbOfflineFileFinalizeReqBodyField = {
  senderUid: 10,
  receiverUid: 20,
  fileUuid: 30,
  fileHash: 40,
} as const;

export const OidbOfflineFileFinalizeRespField = {
  command: 1,
  subCommand: 2,
  body: 10,
  field50: 50,
} as const;

export const OidbOfflineFileFinalizeRespBodyField = { field10: 10, metadata: 30 } as const;
export const OidbOfflineFileMetadataField = {
  field3: 3,
  field100: 100,
  field101: 101,
  field110: 110,
  timestamp1: 130,
} as const;

export interface OidbPrivateFileDownloadReqBody {
  receiverUid: string;
  fileUuid: string;
  type: number;
  fileHash: string;
  t2: number;
}

export interface OidbPrivateFileDownloadReq {
  subCommand: number;
  field2: number;
  body: OidbPrivateFileDownloadReqBody;
  field101: number;
  field102: number;
  field200: number;
  field99999: Uint8Array;
}

export function encodeOidbPrivateFileDownloadReqBody(
  body: OidbPrivateFileDownloadReqBody,
): Uint8Array {
  return new ProtoWriter()
    .string(OidbPrivateFileDownloadReqBodyField.receiverUid, body.receiverUid)
    .string(OidbPrivateFileDownloadReqBodyField.fileUuid, body.fileUuid)
    .uint32(OidbPrivateFileDownloadReqBodyField.type, body.type)
    .string(OidbPrivateFileDownloadReqBodyField.fileHash, body.fileHash)
    .uint32(OidbPrivateFileDownloadReqBodyField.t2, body.t2)
    .finish();
}

export function encodeOidbPrivateFileDownloadReq(body: OidbPrivateFileDownloadReq): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbPrivateFileDownloadReqField.subCommand, body.subCommand)
    .uint32(OidbPrivateFileDownloadReqField.field2, body.field2)
    .message(OidbPrivateFileDownloadReqField.body, encodeOidbPrivateFileDownloadReqBody(body.body))
    .uint32(OidbPrivateFileDownloadReqField.field101, body.field101)
    .uint32(OidbPrivateFileDownloadReqField.field102, body.field102)
    .uint32(OidbPrivateFileDownloadReqField.field200, body.field200)
    .bytes(OidbPrivateFileDownloadReqField.field99999, body.field99999)
    .finish();
}

export interface OidbPrivateFileDownloadRespResult {
  server: string | null;
  port: number | null;
  url: string | null;
}

export interface OidbPrivateFileDownloadRespBody {
  state: string | null;
  result: OidbPrivateFileDownloadRespResult | null;
}

export interface OidbPrivateFileDownloadResp {
  body: OidbPrivateFileDownloadRespBody | null;
}

export function decodeOidbPrivateFileDownloadRespResult(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbPrivateFileDownloadRespResult {
  const reader = new ProtoReader(data, offset, end);
  const result: OidbPrivateFileDownloadRespResult = { server: null, port: null, url: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbPrivateFileDownloadRespResultField.server, WireType.lengthDelimited):
        result.server = reader.string();
        break;
      case tagOf(OidbPrivateFileDownloadRespResultField.port, WireType.varint):
        result.port = reader.uint32();
        break;
      case tagOf(OidbPrivateFileDownloadRespResultField.url, WireType.lengthDelimited):
        result.url = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return result;
}

export function decodeOidbPrivateFileDownloadRespBody(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbPrivateFileDownloadRespBody {
  const reader = new ProtoReader(data, offset, end);
  const body: OidbPrivateFileDownloadRespBody = { state: null, result: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbPrivateFileDownloadRespBodyField.state, WireType.lengthDelimited):
        body.state = reader.string();
        break;
      case tagOf(OidbPrivateFileDownloadRespBodyField.result, WireType.lengthDelimited):
        body.result = reader.message(decodeOidbPrivateFileDownloadRespResult);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return body;
}

export function decodeOidbPrivateFileDownloadResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbPrivateFileDownloadResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: OidbPrivateFileDownloadResp = { body: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(OidbPrivateFileDownloadRespField.body, WireType.lengthDelimited)) {
      resp.body = reader.message(decodeOidbPrivateFileDownloadRespBody);
    } else {
      reader.skip(unknown);
    }
  }
  return resp;
}

export function toPrivateFileUrl(resp: OidbPrivateFileDownloadResp): string {
  const result = resp.body?.result;
  if (!result) throw new Error("private file url response invalid");
  const server = typeof result.server === "string" ? result.server : "";
  const port = Number(result.port ?? 0);
  const url = typeof result.url === "string" ? result.url : "";
  if (!server || !port || !url) throw new Error("private file url response invalid");
  return `http://${server}:${port}${url}&isthumb=0`;
}

export interface OidbPrivateFileUploadReqBody {
  senderUid: string;
  receiverUid: string;
  fileSize: number;
  fileName: string;
  md510MCheckSum: Uint8Array;
  sha1CheckSum: Uint8Array;
  localPath: string;
  md5CheckSum: Uint8Array;
  sha3CheckSum: Uint8Array;
}

export interface OidbPrivateFileUploadReq {
  command: number;
  seq: number;
  upload: OidbPrivateFileUploadReqBody;
  businessId: number;
  clientType: number;
  flagSupportMediaPlatform: number;
}

export function encodeOidbPrivateFileUploadReqBody(
  body: OidbPrivateFileUploadReqBody,
): Uint8Array {
  return new ProtoWriter()
    .string(OidbPrivateFileUploadReqBodyField.senderUid, body.senderUid)
    .string(OidbPrivateFileUploadReqBodyField.receiverUid, body.receiverUid)
    .uint32(OidbPrivateFileUploadReqBodyField.fileSize, body.fileSize)
    .string(OidbPrivateFileUploadReqBodyField.fileName, body.fileName)
    .bytes(OidbPrivateFileUploadReqBodyField.md510MCheckSum, body.md510MCheckSum)
    .bytes(OidbPrivateFileUploadReqBodyField.sha1CheckSum, body.sha1CheckSum)
    .string(OidbPrivateFileUploadReqBodyField.localPath, body.localPath)
    .bytes(OidbPrivateFileUploadReqBodyField.md5CheckSum, body.md5CheckSum)
    .bytes(OidbPrivateFileUploadReqBodyField.sha3CheckSum, body.sha3CheckSum)
    .finish();
}

export function encodeOidbPrivateFileUploadReq(body: OidbPrivateFileUploadReq): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbPrivateFileUploadReqField.command, body.command)
    .uint32(OidbPrivateFileUploadReqField.seq, body.seq)
    .message(OidbPrivateFileUploadReqField.upload, encodeOidbPrivateFileUploadReqBody(body.upload))
    .uint32(OidbPrivateFileUploadReqField.businessId, body.businessId)
    .uint32(OidbPrivateFileUploadReqField.clientType, body.clientType)
    .uint32(OidbPrivateFileUploadReqField.flagSupportMediaPlatform, body.flagSupportMediaPlatform)
    .finish();
}

/** ⚠️ All five fields are **int32** (`_val | 0`), and the order is out/in interleaved. */
export const IPv4Field = { outIP: 1, outPort: 2, inIP: 3, inPort: 4, iPType: 5 } as const;

export interface IPv4 {
  outIP: number | null;
  outPort: number | null;
  inIP: number | null;
  inPort: number | null;
  iPType: number | null;
}

export function decodeIPv4(data: Uint8Array, offset = 0, end = data.length): IPv4 {
  const reader = new ProtoReader(data, offset, end);
  const ip: IPv4 = { outIP: null, outPort: null, inIP: null, inPort: null, iPType: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(IPv4Field.outIP, WireType.varint):
        ip.outIP = reader.int32();
        break;
      case tagOf(IPv4Field.outPort, WireType.varint):
        ip.outPort = reader.int32();
        break;
      case tagOf(IPv4Field.inIP, WireType.varint):
        ip.inIP = reader.int32();
        break;
      case tagOf(IPv4Field.inPort, WireType.varint):
        ip.inPort = reader.int32();
        break;
      case tagOf(IPv4Field.iPType, WireType.varint):
        ip.iPType = reader.int32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return ip;
}

export interface OidbPrivateFileUploadRespBody {
  retCode: number | null;
  retMsg: string | null;
  uploadIp: string | null;
  uploadDomain: string | null;
  uploadPort: number | null;
  uuid: string | null;
  uploadKey: Uint8Array | null;
  boolFileExist: boolean | null;
  uploadIpList: string[];
  uploadHttpsPort: number | null;
  uploadHttpsDomain: string | null;
  uploadDns: string | null;
  uploadLanip: string | null;
  fileAddon: string | null;
  rtpMediaPlatformUploadAddress: IPv4[];
  mediaPlatformUploadKey: Uint8Array | null;
}

export interface OidbPrivateFileUploadResp {
  body: OidbPrivateFileUploadRespBody | null;
}

export function decodeOidbPrivateFileUploadRespBody(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbPrivateFileUploadRespBody {
  const reader = new ProtoReader(data, offset, end);
  const body: OidbPrivateFileUploadRespBody = {
    retCode: null,
    retMsg: null,
    uploadIp: null,
    uploadDomain: null,
    uploadPort: null,
    uuid: null,
    uploadKey: null,
    boolFileExist: null,
    uploadIpList: [],
    uploadHttpsPort: null,
    uploadHttpsDomain: null,
    uploadDns: null,
    uploadLanip: null,
    fileAddon: null,
    rtpMediaPlatformUploadAddress: [],
    mediaPlatformUploadKey: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbPrivateFileUploadRespBodyField.retCode, WireType.varint):
        body.retCode = reader.int32();
        break;
      case tagOf(OidbPrivateFileUploadRespBodyField.retMsg, WireType.lengthDelimited):
        body.retMsg = reader.string();
        break;
      case tagOf(OidbPrivateFileUploadRespBodyField.uploadIp, WireType.lengthDelimited):
        body.uploadIp = reader.string();
        break;
      case tagOf(OidbPrivateFileUploadRespBodyField.uploadDomain, WireType.lengthDelimited):
        body.uploadDomain = reader.string();
        break;
      case tagOf(OidbPrivateFileUploadRespBodyField.uploadPort, WireType.varint):
        body.uploadPort = reader.uint32();
        break;
      case tagOf(OidbPrivateFileUploadRespBodyField.uuid, WireType.lengthDelimited):
        body.uuid = reader.string();
        break;
      case tagOf(OidbPrivateFileUploadRespBodyField.uploadKey, WireType.lengthDelimited):
        body.uploadKey = reader.bytes();
        break;
      case tagOf(OidbPrivateFileUploadRespBodyField.boolFileExist, WireType.varint):
        body.boolFileExist = reader.bool();
        break;
      case tagOf(OidbPrivateFileUploadRespBodyField.uploadIpList, WireType.lengthDelimited):
        body.uploadIpList.push(reader.string());
        break;
      case tagOf(OidbPrivateFileUploadRespBodyField.uploadHttpsPort, WireType.varint):
        body.uploadHttpsPort = reader.int32();
        break;
      case tagOf(OidbPrivateFileUploadRespBodyField.uploadHttpsDomain, WireType.lengthDelimited):
        body.uploadHttpsDomain = reader.string();
        break;
      case tagOf(OidbPrivateFileUploadRespBodyField.uploadDns, WireType.lengthDelimited):
        body.uploadDns = reader.string();
        break;
      case tagOf(OidbPrivateFileUploadRespBodyField.uploadLanip, WireType.lengthDelimited):
        body.uploadLanip = reader.string();
        break;
      case tagOf(OidbPrivateFileUploadRespBodyField.fileAddon, WireType.lengthDelimited):
        body.fileAddon = reader.string();
        break;
      case tagOf(OidbPrivateFileUploadRespBodyField.rtpMediaPlatformUploadAddress, WireType.lengthDelimited):
        body.rtpMediaPlatformUploadAddress.push(reader.message(decodeIPv4));
        break;
      case tagOf(OidbPrivateFileUploadRespBodyField.mediaPlatformUploadKey, WireType.lengthDelimited):
        body.mediaPlatformUploadKey = reader.bytes();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return body;
}

export function decodeOidbPrivateFileUploadResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbPrivateFileUploadResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: OidbPrivateFileUploadResp = { body: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(OidbPrivateFileUploadRespField.body, WireType.lengthDelimited)) {
      resp.body = reader.message(decodeOidbPrivateFileUploadRespBody);
    } else {
      reader.skip(unknown);
    }
  }
  return resp;
}

export interface OidbOfflineFileFinalizeReqBody {
  senderUid: string;
  receiverUid: string;
  fileUuid: string;
  fileHash: string;
}

export interface OidbOfflineFileFinalizeReq {
  subCommand: number;
  field2: number;
  body: OidbOfflineFileFinalizeReqBody;
  field101: number;
  field102: number;
  field200: number;
}

export function encodeOidbOfflineFileFinalizeReqBody(
  body: OidbOfflineFileFinalizeReqBody,
): Uint8Array {
  return new ProtoWriter()
    .string(OidbOfflineFileFinalizeReqBodyField.senderUid, body.senderUid)
    .string(OidbOfflineFileFinalizeReqBodyField.receiverUid, body.receiverUid)
    .string(OidbOfflineFileFinalizeReqBodyField.fileUuid, body.fileUuid)
    .string(OidbOfflineFileFinalizeReqBodyField.fileHash, body.fileHash)
    .finish();
}

export function encodeOidbOfflineFileFinalizeReq(
  body: OidbOfflineFileFinalizeReq,
): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbOfflineFileFinalizeReqField.subCommand, body.subCommand)
    .uint32(OidbOfflineFileFinalizeReqField.field2, body.field2)
    .message(OidbOfflineFileFinalizeReqField.body, encodeOidbOfflineFileFinalizeReqBody(body.body))
    .uint32(OidbOfflineFileFinalizeReqField.field101, body.field101)
    .uint32(OidbOfflineFileFinalizeReqField.field102, body.field102)
    .uint32(OidbOfflineFileFinalizeReqField.field200, body.field200)
    .finish();
}

export interface OidbOfflineFileMetadata {
  field3: number | null;
  field100: Uint8Array | null;
  field101: Uint8Array | null;
  field110: number | null;
  timestamp1: number | null;
}

export interface OidbOfflineFileFinalizeRespBody {
  field10: number | null;
  metadata: OidbOfflineFileMetadata | null;
}

export interface OidbOfflineFileFinalizeResp {
  command: number | null;
  subCommand: number | null;
  body: OidbOfflineFileFinalizeRespBody | null;
  field50: number | null;
}

export function decodeOidbOfflineFileMetadata(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbOfflineFileMetadata {
  const reader = new ProtoReader(data, offset, end);
  const meta: OidbOfflineFileMetadata = {
    field3: null,
    field100: null,
    field101: null,
    field110: null,
    timestamp1: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbOfflineFileMetadataField.field3, WireType.varint):
        meta.field3 = reader.uint32();
        break;
      case tagOf(OidbOfflineFileMetadataField.field100, WireType.lengthDelimited):
        meta.field100 = reader.bytes();
        break;
      case tagOf(OidbOfflineFileMetadataField.field101, WireType.lengthDelimited):
        meta.field101 = reader.bytes();
        break;
      case tagOf(OidbOfflineFileMetadataField.field110, WireType.varint):
        meta.field110 = reader.uint32();
        break;
      case tagOf(OidbOfflineFileMetadataField.timestamp1, WireType.varint):
        meta.timestamp1 = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return meta;
}

export function decodeOidbOfflineFileFinalizeRespBody(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbOfflineFileFinalizeRespBody {
  const reader = new ProtoReader(data, offset, end);
  const body: OidbOfflineFileFinalizeRespBody = { field10: null, metadata: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbOfflineFileFinalizeRespBodyField.field10, WireType.varint):
        body.field10 = reader.uint32();
        break;
      case tagOf(OidbOfflineFileFinalizeRespBodyField.metadata, WireType.lengthDelimited):
        body.metadata = reader.message(decodeOidbOfflineFileMetadata);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return body;
}

export function decodeOidbOfflineFileFinalizeResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbOfflineFileFinalizeResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: OidbOfflineFileFinalizeResp = {
    command: null,
    subCommand: null,
    body: null,
    field50: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbOfflineFileFinalizeRespField.command, WireType.varint):
        resp.command = reader.uint32();
        break;
      case tagOf(OidbOfflineFileFinalizeRespField.subCommand, WireType.varint):
        resp.subCommand = reader.uint32();
        break;
      case tagOf(OidbOfflineFileFinalizeRespField.body, WireType.lengthDelimited):
        resp.body = reader.message(decodeOidbOfflineFileFinalizeRespBody);
        break;
      case tagOf(OidbOfflineFileFinalizeRespField.field50, WireType.varint):
        resp.field50 = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export interface GetPrivateFileUrlParams {
  selfUid: string;
  fileId: string;
  fileHash: string;
}

export const GetPrivateFileUrl: OidbSpec<
  GetPrivateFileUrlParams,
  OidbPrivateFileDownloadReq,
  OidbPrivateFileDownloadResp,
  string
> = {
  command: PRIVATE_FILE_DOWNLOAD_COMMAND,
  subCommand: PRIVATE_FILE_DOWNLOAD_SUB_COMMAND,
  serialize: (params) => ({
    subCommand: PRIVATE_FILE_DOWNLOAD_SUB_COMMAND,
    field2: 1,
    body: {
      receiverUid: params.selfUid,
      fileUuid: params.fileId,
      type: 2,
      fileHash: params.fileHash,
      t2: 0,
    },
    field101: 3,
    field102: 103,
    field200: 1,
    field99999: new Uint8Array([192, 133, 44, 1]),
  }),
  encodeBody: encodeOidbPrivateFileDownloadReq,
  decodeBody: decodeOidbPrivateFileDownloadResp,
  deserialize: toPrivateFileUrl,
};

export interface UploadPrivateFileRequestParams {
  senderUid: string;
  receiverUid: string;
  fileSize: number;
  fileName: string;
  md510MCheckSum: Uint8Array;
  fileSha1: Uint8Array;
  fileMd5: Uint8Array;
}

export const UploadPrivateFileRequest: OidbSpec<
  UploadPrivateFileRequestParams,
  OidbPrivateFileUploadReq,
  OidbPrivateFileUploadResp,
  OidbPrivateFileUploadRespBody
> = {
  command: PRIVATE_FILE_DOWNLOAD_COMMAND,
  subCommand: PRIVATE_FILE_UPLOAD_SUB_COMMAND,
  serialize: (params) => ({
    command: PRIVATE_FILE_UPLOAD_SUB_COMMAND,
    seq: 0,
    upload: {
      senderUid: params.senderUid,
      receiverUid: params.receiverUid,
      fileSize: params.fileSize,
      fileName: params.fileName,
      md510MCheckSum: params.md510MCheckSum,
      sha1CheckSum: params.fileSha1,
      localPath: "/",
      md5CheckSum: params.fileMd5,
      sha3CheckSum: new Uint8Array(0),
    },
    businessId: 3,
    clientType: 1,
    flagSupportMediaPlatform: 1,
  }),
  encodeBody: encodeOidbPrivateFileUploadReq,
  decodeBody: decodeOidbPrivateFileUploadResp,
  deserialize: (body) => {
    const upload = body.body;
    if (!upload) throw new Error("private file upload response missing");
    return upload;
  },
};

export interface FinalizeOfflineFileParams {
  senderUid: string;
  receiverUid: string;
  fileUuid: string;
  fileHash: string;
}

export const FinalizeOfflineFile: OidbSpec<
  FinalizeOfflineFileParams,
  OidbOfflineFileFinalizeReq,
  OidbOfflineFileFinalizeResp,
  OidbOfflineFileMetadata | Record<string, never>
> = {
  command: PRIVATE_FILE_DOWNLOAD_COMMAND,
  subCommand: OFFLINE_FILE_FINALIZE_SUB_COMMAND,
  serialize: (params) => ({
    subCommand: OFFLINE_FILE_FINALIZE_SUB_COMMAND,
    field2: 0,
    body: {
      senderUid: params.senderUid,
      receiverUid: params.receiverUid,
      fileUuid: params.fileUuid,
      fileHash: params.fileHash,
    },
    field101: 3,
    field102: 1,
    field200: 1,
  }),
  encodeBody: encodeOidbOfflineFileFinalizeReq,
  decodeBody: decodeOidbOfflineFileFinalizeResp,
  deserialize: (body) => body.body?.metadata ?? {},
};
// ---------------------------------------------------------------------------
// The three NTV2 rich-media URL commands
// ---------------------------------------------------------------------------
//
//   GetPrivatePttUrl    0x126d (4717)  sub 200  uinForm=true
//   GetPrivateVideoUrl  0x11e9 (4585)  sub 200  uinForm=true
//   GetGroupVideoUrl    0x11ea (4586)  sub 200  uinForm=true
//
// All three carry an **identical message pair** (`NTV2RichMediaReq` /
// `NTV2RichMediaResp`) and differ only in the request's `scene` block:
//
//   spec                requestType  businessType  sceneType  scene body
//   GetPrivatePttUrl        1            3            1      c2c{2, selfUid}
//   GetPrivateVideoUrl      2            2            1      c2c{2, selfUid}
//   GetGroupVideoUrl        2            2            2      group{groupId}
//
// So the scene discriminator is `requestType`+`businessType` for "what kind of
// media" and `sceneType` for "private or group" — three numbers that must agree, on
// three separate commands. Getting `sceneType` wrong (1 vs 2) on the group command
// produces a request the server answers with a private-scene error.
//
// ⚠️ **These specs reuse `0x126e.ts`'s encoders rather than their own copies, and
// that was verified, not assumed.** The region gives each command its own
// `$N`-suffixed helpers (`$1` for ptt, `$2` for group video); I dumped all three
// and the field numbers are identical — including the hundred-based `SceneInfo`
// (101/102/200/201/202) and `DownloadExt.video` at field **2**. The `$N` suffix
// there distinguishes code *copies*, not schemas. That is the opposite of the
// `contacts/` case in this same batch, where `$4` genuinely differed — which is
// why the check is per-region and cannot be generalised either way.
//
// Every one of the three `deserialize`s is the same call,
// `parseNtv2DownloadUrl` (already in `0x126e.ts`), which asserts `respHead.retCode
// === 0` and builds `https://{domain}{path}{rKeyParam}`.

export interface GetPrivatePttUrlParams {
  selfUid: string;
  node: MediaNodeLike;
}

export interface GetPrivateVideoUrlParams {
  selfUid: string;
  node: MediaNodeLike;
}

export interface GetGroupVideoUrlParams {
  groupId: number | bigint;
  node: MediaNodeLike;
}

/** Scene constants, one row per command. */
export const PRIVATE_PTT_SCENE = { requestType: 1, businessType: 3, sceneType: 1 } as const;
export const PRIVATE_VIDEO_SCENE = { requestType: 2, businessType: 2, sceneType: 1 } as const;
export const GROUP_VIDEO_SCENE = { requestType: 2, businessType: 2, sceneType: 2 } as const;

/** The `video` sub-message both zero fields are dropped from, leaving `12 00`. */
const EMPTY_VIDEO_EXT = { video: { busiType: 0, sceneType: 0 } };

/**
 * ⚠️ A **local** scene encoder, because `0x126e.ts`'s `encodeSceneInfo` only
 * handles the `group` arm — its `SceneInfo` type has `c2c?: unknown` and the
 * encoder never writes field 201. The two private commands here need exactly that
 * field, so reusing it would silently drop the recipient uid and produce a request
 * whose scene block names no target at all (`0a 16 0a 05 08 01 10 c8 01 12 09 ...`
 * instead of the golden's `12 16 a8 06 02 ... ca 0c 0a 08 02 12 06 u_self`).
 * Verified against `__write_NTV2SceneInfo$1` (:265501): 101/102/200/201/202.
 */
export const NTV2C2CUserInfoField = { accountType: 1, targetUid: 2 } as const;

export interface NTV2C2CUserInfo {
  accountType: number;
  targetUid: string;
}

export interface NTV2SceneInfo {
  requestType: number;
  businessType: number;
  sceneType: number;
  c2c?: NTV2C2CUserInfo | undefined;
  group?: { groupUin: number } | undefined;
}

export function encodeNTV2C2CUserInfo(c2c: NTV2C2CUserInfo): Uint8Array {
  return new ProtoWriter()
    .uint32(NTV2C2CUserInfoField.accountType, c2c.accountType)
    .string(NTV2C2CUserInfoField.targetUid, c2c.targetUid)
    .finish();
}

export function encodeNTV2SceneInfo(scene: NTV2SceneInfo): Uint8Array {
  return new ProtoWriter()
    .uint32(SceneInfoField.requestType, scene.requestType)
    .uint32(SceneInfoField.businessType, scene.businessType)
    .uint32(SceneInfoField.sceneType, scene.sceneType)
    .message(SceneInfoField.c2c, scene.c2c ? encodeNTV2C2CUserInfo(scene.c2c) : undefined)
    .message(
      SceneInfoField.group,
      scene.group
        ? new ProtoWriter().uint32(1, scene.group.groupUin).finish()
        : undefined,
    )
    .finish();
}

export interface NTV2ReqHead {
  common: { requestId: number; command: number };
  scene: NTV2SceneInfo;
  client: { agentType: number };
}

/** The NTV2 request as these three commands build it — scenes are the only variable. */
export interface NTV2UrlRequest {
  reqHead: NTV2ReqHead;
  download: Parameters<typeof encodeDownloadReq>[0];
}

function encodeNTV2ReqHead(head: NTV2ReqHead): Uint8Array {
  return new ProtoWriter()
    .message(ReqHeadField.common, encodeCommonHead(head.common))
    .message(ReqHeadField.scene, encodeNTV2SceneInfo(head.scene))
    .message(ReqHeadField.client, encodeClientMeta(head.client))
    .finish();
}

/** Encode the full NTV2 request with the local scene encoder. */
export function encodeNTV2UrlRequest(body: NTV2UrlRequest): Uint8Array {
  return new ProtoWriter()
    .message(RichMediaReqField.reqHead, encodeNTV2ReqHead(body.reqHead))
    .message(RichMediaReqField.download, encodeDownloadReq(body.download))
    .finish();
}

export const GetPrivatePttUrl: OidbSpec<
  GetPrivatePttUrlParams,
  NTV2UrlRequest,
  RichMediaResp,
  string
> = {
  command: 0x126d,
  subCommand: 200,
  uinForm: true,
  serialize: (params) => ({
    reqHead: {
      common: { requestId: 1, command: 200 },
      scene: {
        ...PRIVATE_PTT_SCENE,
        c2c: { accountType: 2, targetUid: params.selfUid },
      },
      client: { agentType: 2 },
    },
    download: { node: normalizeMediaNode(params.node), download: EMPTY_VIDEO_EXT },
  }),
  encodeBody: encodeNTV2UrlRequest,
  decodeBody: decodeRichMediaResp,
  deserialize: (body) => parseNtv2DownloadUrl(body),
};

export const GetPrivateVideoUrl: OidbSpec<
  GetPrivateVideoUrlParams,
  NTV2UrlRequest,
  RichMediaResp,
  string
> = {
  command: 0x11e9,
  subCommand: 200,
  uinForm: true,
  serialize: (params) => ({
    reqHead: {
      common: { requestId: 1, command: 200 },
      scene: {
        ...PRIVATE_VIDEO_SCENE,
        c2c: { accountType: 2, targetUid: params.selfUid },
      },
      client: { agentType: 2 },
    },
    download: { node: normalizeMediaNode(params.node), download: EMPTY_VIDEO_EXT },
  }),
  encodeBody: encodeNTV2UrlRequest,
  decodeBody: decodeRichMediaResp,
  deserialize: (body) => parseNtv2DownloadUrl(body),
};

export const GetGroupVideoUrl: OidbSpec<
  GetGroupVideoUrlParams,
  NTV2UrlRequest,
  RichMediaResp,
  string
> = {
  command: 0x11ea,
  subCommand: 200,
  uinForm: true,
  serialize: (params) => ({
    reqHead: {
      common: { requestId: 1, command: 200 },
      scene: {
        ...GROUP_VIDEO_SCENE,
        group: { groupUin: Number(params.groupId) },
      },
      client: { agentType: 2 },
    },
    download: { node: normalizeMediaNode(params.node), download: EMPTY_VIDEO_EXT },
  }),
  encodeBody: encodeNTV2UrlRequest,
  decodeBody: decodeRichMediaResp,
  deserialize: (body) => parseNtv2DownloadUrl(body),
};
