// OidbSvcTrpcTcp.0x6d6_<n> — the group-file family.
//
// ---------------------------------------------------------------------------
// One command id, five sub-commands, five unrelated bodies
// ---------------------------------------------------------------------------
// Unlike 0x89a (which multiplexes by populating a different *submessage*),
// 0x6d6 multiplexes by *sub-command*, and each sub-command has its own message
// shape with the file descriptor in a different slot:
//
//   sub  action                     body root
//    0   upload_group_file          file      (field 1)  OidbGroupFileUploadReq
//    2   get_group_file_url         download  (field 3)  OidbGroupFileDownloadReq
//    3   delete_group_file          delete    (field 4)  OidbGroupFileDeleteReq
//    4   rename_group_file          rename    (field 5)  OidbGroupFileRenameReq
//    5   move_group_file            move      (field 6)  OidbGroupFileMoveReq
//
// The outer message (OidbGroupFileReq, reference/index.mjs:284300) declares all
// five slots as fields 1/3/4/5/6, and each spec fills exactly one.  That is why
// the slot numbers are NOT 1..5: field 2 is skipped in the reference's schema.
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   OidbGroupFileReq outer        reference/index.mjs:284300
//     1 file, 3 download, 4 delete, 5 rename, 6 move
//   OidbGroupFileUploadReq        reference/index.mjs:284486
//     1 groupUin uint64, 2 appId uint32, 3 busId uint32, 4 entrance uint32,
//     5 targetDirectory string, 6 fileName string, 7 localDirectory string,
//     8 fileSize uint64, 9 fileSha1 bytes, 10 fileSha3 bytes, 11 fileMd5 bytes,
//     15 field15 bool
//   OidbGroupFileDownloadReq      reference/index.mjs:284785
//     1 groupUin uint64, 2 appId uint32, 3 busId uint32, 4 fileId string
//   OidbGroupFileDeleteReq        reference/index.mjs:284912
//     1 groupUin uint64, 3 busId uint32, 5 fileId string     <- fileId is 5, not 4
//   OidbGroupFileRenameReq        reference/index.mjs:285031
//     1 groupUin uint64, 3 busId uint32, 4 fileId string,
//     5 parentFolder string, 6 newFileName string
//   OidbGroupFileMoveReq          reference/index.mjs:285209
//     1 groupUin uint64, 2 appId uint32, 3 busId uint32, 4 fileId string,
//     5 parentDirectory string, 6 targetDirectory string
//   OidbGroupFileResp outer       reference/index.mjs:285700 region
//     1 upload, 3 download, 4 delete, 5 rename, 6 move
//   OidbGroupFileUploadResp       reference/index.mjs:285782
//     1 retCode int32, 2 retMsg string, 3 clientWording string, 4 uploadIp string,
//     5 serverDns string, 6 busId int32, 7 fileId string, 8 checkKey bytes,
//     9 fileKey bytes, 10 boolFileExist varint, 14 uploadPort varint
//   OidbGroupFileDownloadResp     reference/index.mjs:285900 region
//     1 retCode, 2 retMsg, 3 clientWording, 4 downloadIp, 5 downloadDns,
//     6 downloadUrl bytes, 11 saveFileName string
//   OidbGroupFileRetResp (delete/rename/move)  reference/index.mjs:286010 region
//     1 retCode, 2 retMsg, 3 clientWording
//
// The delete body's `fileId` at 5 while the others use 4 is exactly the kind of
// off-by-one a "looks systematic" guess would get wrong.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 1750 = 0x6d6. */
export const GROUP_FILE_COMMAND = 0x6d6;

export const GROUP_FILE_SUB_COMMAND = {
  upload: 0,
  download: 2,
  delete: 3,
  rename: 4,
  move: 5,
} as const;

export const GroupFileOuterField = {
  file: 1,
  download: 3,
  delete: 4,
  rename: 5,
  move: 6,
} as const;

export const GroupFileUploadReqField = {
  groupUin: 1,
  appId: 2,
  busId: 3,
  entrance: 4,
  targetDirectory: 5,
  fileName: 6,
  localDirectory: 7,
  fileSize: 8,
  fileSha1: 9,
  fileSha3: 10,
  fileMd5: 11,
  field15: 15,
} as const;

export const GroupFileDownloadReqField = { groupUin: 1, appId: 2, busId: 3, fileId: 4 } as const;
export const GroupFileDeleteReqField = { groupUin: 1, busId: 3, fileId: 5 } as const;
export const GroupFileRenameReqField = {
  groupUin: 1,
  busId: 3,
  fileId: 4,
  parentFolder: 5,
  newFileName: 6,
} as const;
export const GroupFileMoveReqField = {
  groupUin: 1,
  appId: 2,
  busId: 3,
  fileId: 4,
  parentDirectory: 5,
  targetDirectory: 6,
} as const;

export const GroupFileUploadRespField = {
  retCode: 1,
  retMsg: 2,
  clientWording: 3,
  uploadIp: 4,
  serverDns: 5,
  busId: 6,
  fileId: 7,
  checkKey: 8,
  fileKey: 9,
  boolFileExist: 10,
  uploadPort: 14,
} as const;

export const GroupFileDownloadRespField = {
  retCode: 1,
  retMsg: 2,
  clientWording: 3,
  downloadIp: 4,
  downloadDns: 5,
  downloadUrl: 6,
  saveFileName: 11,
} as const;

export const GroupFileRetRespField = { retCode: 1, retMsg: 2, clientWording: 3 } as const;

export const GroupFileRespOuterField = {
  upload: 1,
  download: 3,
  delete: 4,
  rename: 5,
  move: 6,
} as const;

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export interface GroupFileUploadReq {
  groupUin: bigint;
  appId: number;
  busId: number;
  entrance: number;
  targetDirectory: string;
  fileName: string;
  localDirectory: string;
  fileSize: bigint;
  fileSha1: Uint8Array;
  fileSha3: Uint8Array;
  fileMd5: Uint8Array;
  field15: boolean;
}

export interface GroupFileDownloadReq {
  groupUin: bigint;
  appId: number;
  busId: number;
  fileId: string;
}

export interface GroupFileDeleteReq {
  groupUin: bigint;
  busId: number;
  fileId: string;
}

export interface GroupFileRenameReq {
  groupUin: bigint;
  busId: number;
  fileId: string;
  parentFolder: string;
  newFileName: string;
}

export interface GroupFileMoveReq {
  groupUin: bigint;
  appId: number;
  busId: number;
  fileId: string;
  parentDirectory: string;
  targetDirectory: string;
}

/** Any of the five request shapes, tagged with which slot it belongs in. */
export type GroupFileReq =
  | GroupFileUploadBody
  | GroupFileDownloadBody
  | GroupFileDeleteBody
  | GroupFileRenameBody
  | GroupFileMoveBody;

/**
 * The five slot wrappers, one per sub-command.
 *
 * Each spec below is typed as its own wrapper rather than as the `GroupFileReq`
 * union: a union member is not reachable through the union's other members, so a
 * `GroupFileReq`-typed spec would make `serialize(...).file` unreadable to
 * callers even though the upload spec always produces exactly that.  The union
 * survives only where a generic reader is genuinely needed (`decodeGroupFileResp`
 * and `GroupFileResp`).
 */
export type GroupFileUploadBody = { file: GroupFileUploadReq };
export type GroupFileDownloadBody = { download: GroupFileDownloadReq };
export type GroupFileDeleteBody = { delete: GroupFileDeleteReq };
export type GroupFileRenameBody = { rename: GroupFileRenameReq };
export type GroupFileMoveBody = { move: GroupFileMoveReq };

// ---------------------------------------------------------------------------
// Response bodies
// ---------------------------------------------------------------------------

export interface GroupFileUploadResp {
  retCode: number;
  retMsg: string;
  clientWording: string;
  uploadIp: string;
  serverDns: string;
  busId: number;
  fileId: string;
  checkKey: Uint8Array;
  fileKey: Uint8Array;
  boolFileExist: number;
  uploadPort: number;
}

export interface GroupFileDownloadResp {
  retCode: number;
  retMsg: string;
  clientWording: string;
  downloadIp: string;
  downloadDns: string;
  downloadUrl: Uint8Array;
  saveFileName: string;
}

export interface GroupFileRetResp {
  retCode: number;
  retMsg: string;
  clientWording: string;
}

export interface GroupFileResp {
  upload?: GroupFileUploadResp | undefined;
  download?: GroupFileDownloadResp | undefined;
  delete?: GroupFileRetResp | undefined;
  rename?: GroupFileRetResp | undefined;
  move?: GroupFileRetResp | undefined;
}

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

export function encodeGroupFileUploadReq(body: GroupFileUploadReq): Uint8Array {
  return new ProtoWriter()
    .uint64(GroupFileUploadReqField.groupUin, body.groupUin)
    .uint32(GroupFileUploadReqField.appId, body.appId)
    .uint32(GroupFileUploadReqField.busId, body.busId)
    .uint32(GroupFileUploadReqField.entrance, body.entrance)
    .string(GroupFileUploadReqField.targetDirectory, body.targetDirectory)
    .string(GroupFileUploadReqField.fileName, body.fileName)
    .string(GroupFileUploadReqField.localDirectory, body.localDirectory)
    .uint64(GroupFileUploadReqField.fileSize, body.fileSize)
    .bytes(GroupFileUploadReqField.fileSha1, body.fileSha1)
    .bytes(GroupFileUploadReqField.fileSha3, body.fileSha3)
    .bytes(GroupFileUploadReqField.fileMd5, body.fileMd5)
    .bool(GroupFileUploadReqField.field15, body.field15)
    .finish();
}

export function encodeGroupFileDownloadReq(body: GroupFileDownloadReq): Uint8Array {
  return new ProtoWriter()
    .uint64(GroupFileDownloadReqField.groupUin, body.groupUin)
    .uint32(GroupFileDownloadReqField.appId, body.appId)
    .uint32(GroupFileDownloadReqField.busId, body.busId)
    .string(GroupFileDownloadReqField.fileId, body.fileId)
    .finish();
}

export function encodeGroupFileDeleteReq(body: GroupFileDeleteReq): Uint8Array {
  return new ProtoWriter()
    .uint64(GroupFileDeleteReqField.groupUin, body.groupUin)
    .uint32(GroupFileDeleteReqField.busId, body.busId)
    .string(GroupFileDeleteReqField.fileId, body.fileId)
    .finish();
}

export function encodeGroupFileRenameReq(body: GroupFileRenameReq): Uint8Array {
  return new ProtoWriter()
    .uint64(GroupFileRenameReqField.groupUin, body.groupUin)
    .uint32(GroupFileRenameReqField.busId, body.busId)
    .string(GroupFileRenameReqField.fileId, body.fileId)
    .string(GroupFileRenameReqField.parentFolder, body.parentFolder)
    .string(GroupFileRenameReqField.newFileName, body.newFileName)
    .finish();
}

export function encodeGroupFileMoveReq(body: GroupFileMoveReq): Uint8Array {
  return new ProtoWriter()
    .uint64(GroupFileMoveReqField.groupUin, body.groupUin)
    .uint32(GroupFileMoveReqField.appId, body.appId)
    .uint32(GroupFileMoveReqField.busId, body.busId)
    .string(GroupFileMoveReqField.fileId, body.fileId)
    .string(GroupFileMoveReqField.parentDirectory, body.parentDirectory)
    .string(GroupFileMoveReqField.targetDirectory, body.targetDirectory)
    .finish();
}

/** Encode the outer message: exactly one of the five slots is populated. */
export function encodeGroupFileReq(body: GroupFileReq): Uint8Array {
  const writer = new ProtoWriter();
  if ("file" in body) writer.message(GroupFileOuterField.file, encodeGroupFileUploadReq(body.file));
  else if ("download" in body) writer.message(GroupFileOuterField.download, encodeGroupFileDownloadReq(body.download));
  else if ("delete" in body) writer.message(GroupFileOuterField.delete, encodeGroupFileDeleteReq(body.delete));
  else if ("rename" in body) writer.message(GroupFileOuterField.rename, encodeGroupFileRenameReq(body.rename));
  else writer.message(GroupFileOuterField.move, encodeGroupFileMoveReq(body.move));
  return writer.finish();
}

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

export function decodeGroupFileUploadResp(data: Uint8Array, offset = 0, end = data.length): GroupFileUploadResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: GroupFileUploadResp = {
    retCode: 0,
    retMsg: "",
    clientWording: "",
    uploadIp: "",
    serverDns: "",
    busId: 0,
    fileId: "",
    checkKey: new Uint8Array(0),
    fileKey: new Uint8Array(0),
    boolFileExist: 0,
    uploadPort: 0,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupFileUploadRespField.retCode, WireType.varint):
        // int32 on the wire; the reference reads it as `_val | 0`.
        resp.retCode = reader.int32();
        break;
      case tagOf(GroupFileUploadRespField.retMsg, WireType.lengthDelimited):
        resp.retMsg = reader.string();
        break;
      case tagOf(GroupFileUploadRespField.clientWording, WireType.lengthDelimited):
        resp.clientWording = reader.string();
        break;
      case tagOf(GroupFileUploadRespField.uploadIp, WireType.lengthDelimited):
        resp.uploadIp = reader.string();
        break;
      case tagOf(GroupFileUploadRespField.serverDns, WireType.lengthDelimited):
        resp.serverDns = reader.string();
        break;
      case tagOf(GroupFileUploadRespField.busId, WireType.varint):
        resp.busId = reader.int32();
        break;
      case tagOf(GroupFileUploadRespField.fileId, WireType.lengthDelimited):
        resp.fileId = reader.string();
        break;
      case tagOf(GroupFileUploadRespField.checkKey, WireType.lengthDelimited):
        resp.checkKey = reader.bytes();
        break;
      case tagOf(GroupFileUploadRespField.fileKey, WireType.lengthDelimited):
        resp.fileKey = reader.bytes();
        break;
      case tagOf(GroupFileUploadRespField.boolFileExist, WireType.varint):
        resp.boolFileExist = reader.uint32();
        break;
      case tagOf(GroupFileUploadRespField.uploadPort, WireType.varint):
        resp.uploadPort = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export function decodeGroupFileDownloadResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupFileDownloadResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: GroupFileDownloadResp = {
    retCode: 0,
    retMsg: "",
    clientWording: "",
    downloadIp: "",
    downloadDns: "",
    downloadUrl: new Uint8Array(0),
    saveFileName: "",
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupFileDownloadRespField.retCode, WireType.varint):
        resp.retCode = reader.uint32();
        break;
      case tagOf(GroupFileDownloadRespField.retMsg, WireType.lengthDelimited):
        resp.retMsg = reader.string();
        break;
      case tagOf(GroupFileDownloadRespField.clientWording, WireType.lengthDelimited):
        resp.clientWording = reader.string();
        break;
      case tagOf(GroupFileDownloadRespField.downloadIp, WireType.lengthDelimited):
        resp.downloadIp = reader.string();
        break;
      case tagOf(GroupFileDownloadRespField.downloadDns, WireType.lengthDelimited):
        resp.downloadDns = reader.string();
        break;
      case tagOf(GroupFileDownloadRespField.downloadUrl, WireType.lengthDelimited):
        resp.downloadUrl = reader.bytes();
        break;
      case tagOf(GroupFileDownloadRespField.saveFileName, WireType.lengthDelimited):
        resp.saveFileName = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export function decodeGroupFileRetResp(data: Uint8Array, offset = 0, end = data.length): GroupFileRetResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: GroupFileRetResp = { retCode: 0, retMsg: "", clientWording: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupFileRetRespField.retCode, WireType.varint):
        resp.retCode = reader.uint32();
        break;
      case tagOf(GroupFileRetRespField.retMsg, WireType.lengthDelimited):
        resp.retMsg = reader.string();
        break;
      case tagOf(GroupFileRetRespField.clientWording, WireType.lengthDelimited):
        resp.clientWording = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export function decodeGroupFileResp(data: Uint8Array, offset = 0, end = data.length): GroupFileResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: GroupFileResp = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupFileRespOuterField.upload, WireType.lengthDelimited):
        resp.upload = reader.message(decodeGroupFileUploadResp);
        break;
      case tagOf(GroupFileRespOuterField.download, WireType.lengthDelimited):
        resp.download = reader.message(decodeGroupFileDownloadResp);
        break;
      case tagOf(GroupFileRespOuterField.delete, WireType.lengthDelimited):
        resp.delete = reader.message(decodeGroupFileRetResp);
        break;
      case tagOf(GroupFileRespOuterField.rename, WireType.lengthDelimited):
        resp.rename = reader.message(decodeGroupFileRetResp);
        break;
      case tagOf(GroupFileRespOuterField.move, WireType.lengthDelimited):
        resp.move = reader.message(decodeGroupFileRetResp);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// Ret-code handling
// ---------------------------------------------------------------------------

/**
 * The `retCode` a group-file operation reports inside its body.
 *
 * These are NOT envelope error codes: the call can succeed at the envelope level
 * and still report a per-operation failure here (e.g. "file not found"), which is
 * why the reference's `ensureRetCodeZero` inspects the body
 * (reference/index.mjs:248654 region).
 */
export class GroupFileRetError extends Error {
  readonly retCode: number;
  readonly retMsg: string;
  readonly clientWording: string;
  readonly operation: string;

  constructor(operation: string, retCode: number, retMsg: string, clientWording: string) {
    // Wording copied from the reference's shared helper (reference/index.mjs:82629):
    //   `${operation} failed: code=${retCode} msg=${wording || msg || "unknown error"}`
    //
    // This was `failed with retcode N: ...` until two independent ports of other commands both
    // reported the mismatch. It is not cosmetic: the goldens in this repo quote the reference's
    // error strings verbatim, so a different shape here makes a correct implementation look like
    // a failing one, and log greps written against the reference miss these entirely.
    super(`${operation} failed: code=${retCode} msg=${clientWording || retMsg || "unknown error"}`);
    this.name = "GroupFileRetError";
    this.operation = operation;
    this.retCode = retCode;
    this.retMsg = retMsg;
    this.clientWording = clientWording;
  }
}

/** Throw unless the body-level retCode is zero. */
export function ensureRetCodeZero(
  operation: string,
  retCode: number | undefined,
  retMsg: string | undefined,
  clientWording: string | undefined,
): void {
  if (retCode === undefined) return;
  if (retCode === 0) return;
  throw new GroupFileRetError(operation, retCode, retMsg ?? "", clientWording ?? "");
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

/**
 * The uploaded file's descriptor, as OneBot hands it over.
 *
 * All four hashes are required by the action schema but `fileSha3` is sent as
 * zero bytes: the reference sets `fileSha3: new Uint8Array(0)`
 * (reference/index.mjs:286400 region) and the encoder's `length > 0` rule drops
 * it, so the field never reaches the wire.
 */
export interface GroupFileUploadParams {
  groupId: number | bigint;
  fileName: string;
  fileSize: bigint | number;
  fileSha1: Uint8Array;
  fileMd5: Uint8Array;
  folderId?: string | undefined;
}

/** `appId` 4 / `busId` 102 / `entrance` 6 are the group-file constants the reference hard-codes. */
export const GROUP_FILE_APP_ID = 4;
export const GROUP_FILE_BUS_ID = 102;
export const GROUP_FILE_ENTRANCE = 6;

export const UploadGroupFile: OidbSpec<
  GroupFileUploadParams,
  GroupFileUploadBody,
  GroupFileResp,
  GroupFileUploadResp
> = {
  command: GROUP_FILE_COMMAND,
  subCommand: GROUP_FILE_SUB_COMMAND.upload,
  uinForm: true,
  serialize: (params) => ({
    file: {
      groupUin: BigInt(params.groupId),
      appId: GROUP_FILE_APP_ID,
      busId: GROUP_FILE_BUS_ID,
      entrance: GROUP_FILE_ENTRANCE,
      targetDirectory: params.folderId ?? "",
      fileName: params.fileName,
      // The reference sets localDirectory to "/" + fileName, not the caller's
      // folder: it is the *client-side* path, which the server only echoes.
      localDirectory: `/${params.fileName}`,
      fileSize: BigInt(params.fileSize),
      fileSha1: params.fileSha1,
      fileSha3: new Uint8Array(0),
      fileMd5: params.fileMd5,
      field15: true,
    },
  }),
  encodeBody: encodeGroupFileReq,
  decodeBody: decodeGroupFileResp,
  deserialize: (body) => {
    const upload = body.upload;
    if (!upload) throw new Error("group file upload response missing");
    return upload;
  },
};

export interface GroupFileUrlParams {
  groupId: number | bigint;
  fileId: string;
  busId: number;
}

/** `appId` 7 identifies the "download" client in the reference's get-url call. */
export const GROUP_FILE_DOWNLOAD_APP_ID = 7;

/**
 * The download URL the server returns.
 *
 * `downloadUrl` is *bytes*, not a string (reference/index.mjs:285940): the
 * reference passes it through `composeGroupFileUrl` which decodes it, so it is
 * kept as bytes here and decoded at the boundary. Some responses carry a bare
 * path and others a full URL, hence the join with the dns/ip fields in the
 * caller rather than here.
 */
export interface GroupFileUrlResult {
  downloadUrl: string;
  downloadIp: string;
  downloadDns: string;
  saveFileName: string;
}

export const GetGroupFileUrl: OidbSpec<
  GroupFileUrlParams,
  GroupFileDownloadBody,
  GroupFileResp,
  GroupFileUrlResult
> = {
  command: GROUP_FILE_COMMAND,
  subCommand: GROUP_FILE_SUB_COMMAND.download,
  uinForm: true,
  serialize: (params) => ({
    download: {
      groupUin: BigInt(params.groupId),
      appId: GROUP_FILE_DOWNLOAD_APP_ID,
      busId: params.busId,
      fileId: params.fileId,
    },
  }),
  encodeBody: encodeGroupFileReq,
  decodeBody: decodeGroupFileResp,
  deserialize: (body) => {
    const download = body.download;
    if (!download) throw new Error("group file url response missing");
    return {
      downloadUrl: new TextDecoder().decode(download.downloadUrl),
      downloadIp: download.downloadIp,
      downloadDns: download.downloadDns,
      saveFileName: download.saveFileName,
    };
  },
};

export interface GroupFileIdParams {
  groupId: number | bigint;
  fileId: string;
}

export const DeleteGroupFile: OidbSpec<GroupFileIdParams, GroupFileDeleteBody, GroupFileResp, void> = {
  command: GROUP_FILE_COMMAND,
  subCommand: GROUP_FILE_SUB_COMMAND.delete,
  uinForm: true,
  serialize: (params) => ({
    delete: { groupUin: BigInt(params.groupId), busId: GROUP_FILE_BUS_ID, fileId: params.fileId },
  }),
  encodeBody: encodeGroupFileReq,
  decodeBody: decodeGroupFileResp,
  deserialize: (body) => {
    const result = body.delete;
    if (!result) throw new Error("group file delete response missing");
    ensureRetCodeZero("group file delete", result.retCode, result.retMsg, result.clientWording);
    return undefined;
  },
};

export interface GroupFileRenameParams extends GroupFileIdParams {
  parentDirectory?: string | undefined;
  newFileName: string;
}

export const RenameGroupFile: OidbSpec<
  GroupFileRenameParams,
  GroupFileRenameBody,
  GroupFileResp,
  void
> = {
  command: GROUP_FILE_COMMAND,
  subCommand: GROUP_FILE_SUB_COMMAND.rename,
  uinForm: true,
  serialize: (params) => ({
    rename: {
      groupUin: BigInt(params.groupId),
      busId: GROUP_FILE_BUS_ID,
      fileId: params.fileId,
      parentFolder: params.parentDirectory ?? "/",
      newFileName: params.newFileName,
    },
  }),
  encodeBody: encodeGroupFileReq,
  decodeBody: decodeGroupFileResp,
  deserialize: (body) => {
    const result = body.rename;
    if (!result) throw new Error("group file rename response missing");
    ensureRetCodeZero("group file rename", result.retCode, result.retMsg, result.clientWording);
    return undefined;
  },
};

export interface GroupFileMoveParams extends GroupFileIdParams {
  parentDirectory: string;
  targetDirectory: string;
}

export const MoveGroupFile: OidbSpec<GroupFileMoveParams, GroupFileMoveBody, GroupFileResp, void> = {
  command: GROUP_FILE_COMMAND,
  subCommand: GROUP_FILE_SUB_COMMAND.move,
  uinForm: true,
  serialize: (params) => ({
    move: {
      groupUin: BigInt(params.groupId),
      appId: GROUP_FILE_DOWNLOAD_APP_ID,
      busId: GROUP_FILE_BUS_ID,
      fileId: params.fileId,
      parentDirectory: params.parentDirectory,
      targetDirectory: params.targetDirectory,
    },
  }),
  encodeBody: encodeGroupFileReq,
  decodeBody: decodeGroupFileResp,
  deserialize: (body) => {
    const result = body.move;
    if (!result) throw new Error("group file move response missing");
    ensureRetCodeZero("group file move", result.retCode, result.retMsg, result.clientWording);
    return undefined;
  },
};