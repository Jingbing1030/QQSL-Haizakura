// OidbSvcTrpcTcp.0x6d8_1 / _2 / _3 — group file listing, count, and quota.
//
// ---------------------------------------------------------------------------
// The file-tab trio, part 2 of 3
// ---------------------------------------------------------------------------
//   0x6d7_*  folder tree mutations      (see 0x6d7.ts)
//   0x6d8_*  folder/file listing + quota   <- this file
//   0x6d9_*  upload/trans/download      (see 0x6d9.ts)
//
// The OneBot actions are `get_group_root_files` / `get_group_files_by_folder`
// (both `_1`, differing only in the directory argument), whose reply is a
// `{files, folders}` pair.
//
// ---------------------------------------------------------------------------
// Field numbers (read out of the reference)
// ---------------------------------------------------------------------------
//   _1 listing
//   OidbGroupFileViewReq / Resp      reference/index.mjs:271672 (req wrapper)
//     2 list  message              <-- field 2, NOT 1.  Field 1 does not exist.
//
//   OidbGroupFileListReq             reference/index.mjs:271760 .. 271932
//     1  groupUin        uint32
//     2  appId           uint32    hard-coded 7
//     3  targetDirectory string    the folder PATH ("/" for root)
//     5  fileCount       uint32    page size      <-- 4 is skipped
//     9  sortBy          uint32    hard-coded 1
//     13 startIndex      uint32    <-- 13, not 6; the gap 5->9->13 is real
//     17 field17         uint32    hard-coded 2
//     18 field18         uint32    hard-coded 0 (so never written)
//
//   OidbGroupFileListResp            reference/index.mjs:272259 .. 272335
//     1 retCode        uint32
//     2 retMsg         string
//     3 clientWording  string
//     4 isEnd          uint32      (0/1, decoded as a NUMBER here, not a bool)
//     5 items          repeated OidbGroupFileListItemResp
//
//   OidbGroupFileListItemResp        reference/index.mjs:272428 / 272446 / 272466
//     1 type        uint32   1 = folder, 2 = file
//     2 folderInfo  OidbGroupFileListFolderResp
//     3 fileInfo    OidbGroupFileListFileResp
//
//   OidbGroupFileListFolderResp      reference/index.mjs:272564 .. 272732
//     1 folderId           string
//     2 parentDirectoryId  string
//     3 folderName         string
//     4 createTime         uint32
//     5 modifiedTime       uint32
//     6 creatorUin         uint32
//     7 creatorName        string
//     8 totalFileCount     uint32
//     9 modifierUin        uint64    <-- the only uint64 in this message
//     10 modifierName      string    <-- field 10 is AFTER a uint64 field 9
//
//   OidbGroupFileListFileResp        reference/index.mjs:272838 .. 273022
//     1  fileId          string
//     2  fileName        string
//     3  fileSize        uint64    (bytes; must stay bigint)
//     4  busId           uint32
//     6  uploadedTime    uint32    <-- 5 is skipped
//     7  expireTime      uint32
//     8  modifiedTime    uint32
//     9  downloadedTimes uint32
//     14 uploaderName    string    <-- 9 -> 14
//     15 uploaderUin     uint32
//     16 parentDirectory string
//
// Two surprises worth naming:
//
//   1. The listing wrapper puts the payload in field **2**, not 1 — and each
//      sub-command keeps that layout, so the count/space responses below ALSO
//      use 3 and 4 for their two payloads, not 1 and 2.
//   2. `fileSize` and `modifierUin` are uint64 while their neighbours are
//      uint32.  A file over 4 GiB read through a uint32 field is truncated;
//      this is why those two are `bigint` in the types below.
//
// ---------------------------------------------------------------------------
// uinForm: the family's odd one out
// ---------------------------------------------------------------------------
// `_1` carries `uinForm: true` (reference/index.mjs:273099) but `_2` and `_3` do
// NOT (251855 / 253307 carry no `uinForm` line at all).  So the envelope's
// `reserved` bit is 1 for listing and 0 for count/space, even though all three
// read the group id from the same shaped field.  Copying `uinForm: true` onto
// _2/_3 — the obvious "consistency fix" — changes how the server interprets the
// group id.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";
// The retcode check keeps the reference's exact wording; see 0x6d7.ts for why it
// is not the same helper 0x6d6.ts exports.
import { checkRetCodeZero } from "./0x6d7.js";

/** 1752 = 0x6d8. */
export const GROUP_FILE_VIEW_COMMAND = 0x6d8;

/** 1 = list, 2 = file count, 3 = space quota. */
export const GROUP_FILE_VIEW_SUB_COMMAND = { list: 1, count: 2, space: 3 } as const;

/**
 * The app id this family sends: **7** (reference/index.mjs:271673, 251857,
 * 283548).
 *
 * Do not reach for 0x6d6.ts's `GROUP_FILE_APP_ID` here — that one is **4**, the
 * *upload* app id.  The reference splits them: uploads/listing-by-app use 4,
 * while viewing, counting and transferring use 7 (`GROUP_FILE_DOWNLOAD_APP_ID`
 * in 0x6d6.ts's naming, which is the same number under a misleading name).  A
 * shared constant across 0x6d6/0x6d8/0x6d9 would be wrong for one of them, so
 * each family carries its own.
 */
export const GROUP_FILE_VIEW_APP_ID = 7;

/**
 * `busId` for the file-count request: 6 (reference/index.mjs:251858).
 *
 * Coincidentally equal to 0x6d6.ts's `GROUP_FILE_ENTRANCE`, but a different
 * field on a different message; kept separate so the two cannot be edited as
 * one.
 */
export const GROUP_FILE_COUNT_BUS_ID = 6;

// ---------------------------------------------------------------------------
// _1 — listing
// ---------------------------------------------------------------------------

export const GroupFileViewReqField = { list: 2 } as const;

export const GroupFileListReqField = {
  groupUin: 1,
  appId: 2,
  targetDirectory: 3,
  fileCount: 5,
  sortBy: 9,
  startIndex: 13,
  field17: 17,
  field18: 18,
} as const;

export interface GroupFileListReq {
  groupUin: number;
  appId: number;
  targetDirectory: string;
  fileCount: number;
  sortBy: number;
  startIndex: number;
  field17: number;
  field18: number;
}

export interface GroupFileViewReq {
  list: GroupFileListReq;
}

export function encodeGroupFileListReq(body: GroupFileListReq): Uint8Array {
  return new ProtoWriter()
    .uint32(GroupFileListReqField.groupUin, body.groupUin)
    .uint32(GroupFileListReqField.appId, body.appId)
    .string(GroupFileListReqField.targetDirectory, body.targetDirectory)
    .uint32(GroupFileListReqField.fileCount, body.fileCount)
    .uint32(GroupFileListReqField.sortBy, body.sortBy)
    .uint32(GroupFileListReqField.startIndex, body.startIndex)
    .uint32(GroupFileListReqField.field17, body.field17)
    .uint32(GroupFileListReqField.field18, body.field18)
    .finish();
}

export function encodeGroupFileViewReq(body: GroupFileViewReq): Uint8Array {
  return new ProtoWriter()
    .message(GroupFileViewReqField.list, encodeGroupFileListReq(body.list))
    .finish();
}

// ---------------------------------------------------------------------------
// _1 — response
// ---------------------------------------------------------------------------

export const GroupFileViewRespField = { list: 2 } as const;

export const GroupFileListRespField = {
  retCode: 1,
  retMsg: 2,
  clientWording: 3,
  isEnd: 4,
  items: 5,
} as const;

export const GroupFileListItemRespField = { type: 1, folderInfo: 2, fileInfo: 3 } as const;

export const GroupFileListFolderRespField = {
  folderId: 1,
  parentDirectoryId: 2,
  folderName: 3,
  createTime: 4,
  modifiedTime: 5,
  creatorUin: 6,
  creatorName: 7,
  totalFileCount: 8,
  modifierUin: 9,
  modifierName: 10,
} as const;

export const GroupFileListFileRespField = {
  fileId: 1,
  fileName: 2,
  fileSize: 3,
  busId: 4,
  uploadedTime: 6,
  expireTime: 7,
  modifiedTime: 8,
  downloadedTimes: 9,
  uploaderName: 14,
  uploaderUin: 15,
  parentDirectory: 16,
} as const;

export interface GroupFileListFolder {
  folderId: string;
  parentDirectoryId: string;
  folderName: string;
  createTime: number;
  modifiedTime: number;
  creatorUin: number;
  creatorName: string;
  totalFileCount: number;
  modifierUin: bigint;
  modifierName: string;
}

export interface GroupFileListFile {
  fileId: string;
  fileName: string;
  /** uint64 on the wire: bytes, not a truncated u32. */
  fileSize: bigint;
  busId: number;
  uploadedTime: number;
  expireTime: number;
  modifiedTime: number;
  downloadedTimes: number;
  uploaderName: string;
  uploaderUin: number;
  parentDirectory: string;
}

export interface GroupFileListItem {
  /** 1 = folder entry, 2 = file entry. */
  type: number;
  folderInfo: GroupFileListFolder | null;
  fileInfo: GroupFileListFile | null;
}

export interface GroupFileListResp {
  retCode: number;
  retMsg: string;
  clientWording: string;
  /** `0`/`1` as a number, matching the decoder (`_val`, not `_val !== 0`). */
  isEnd: number;
  items: GroupFileListItem[];
}

export interface GroupFileViewResp {
  list: GroupFileListResp | null;
}

export function decodeGroupFileListFolder(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupFileListFolder {
  const reader = new ProtoReader(data, offset, end);
  const folder: GroupFileListFolder = {
    folderId: "",
    parentDirectoryId: "",
    folderName: "",
    createTime: 0,
    modifiedTime: 0,
    creatorUin: 0,
    creatorName: "",
    totalFileCount: 0,
    modifierUin: 0n,
    modifierName: "",
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupFileListFolderRespField.folderId, WireType.lengthDelimited):
        folder.folderId = reader.string();
        break;
      case tagOf(GroupFileListFolderRespField.parentDirectoryId, WireType.lengthDelimited):
        folder.parentDirectoryId = reader.string();
        break;
      case tagOf(GroupFileListFolderRespField.folderName, WireType.lengthDelimited):
        folder.folderName = reader.string();
        break;
      case tagOf(GroupFileListFolderRespField.createTime, WireType.varint):
        folder.createTime = reader.uint32();
        break;
      case tagOf(GroupFileListFolderRespField.modifiedTime, WireType.varint):
        folder.modifiedTime = reader.uint32();
        break;
      case tagOf(GroupFileListFolderRespField.creatorUin, WireType.varint):
        folder.creatorUin = reader.uint32();
        break;
      case tagOf(GroupFileListFolderRespField.creatorName, WireType.lengthDelimited):
        folder.creatorName = reader.string();
        break;
      case tagOf(GroupFileListFolderRespField.totalFileCount, WireType.varint):
        folder.totalFileCount = reader.uint32();
        break;
      case tagOf(GroupFileListFolderRespField.modifierUin, WireType.varint):
        folder.modifierUin = reader.uint64();
        break;
      case tagOf(GroupFileListFolderRespField.modifierName, WireType.lengthDelimited):
        folder.modifierName = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return folder;
}

export function decodeGroupFileListFile(data: Uint8Array, offset = 0, end = data.length): GroupFileListFile {
  const reader = new ProtoReader(data, offset, end);
  const file: GroupFileListFile = {
    fileId: "",
    fileName: "",
    fileSize: 0n,
    busId: 0,
    uploadedTime: 0,
    expireTime: 0,
    modifiedTime: 0,
    downloadedTimes: 0,
    uploaderName: "",
    uploaderUin: 0,
    parentDirectory: "",
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupFileListFileRespField.fileId, WireType.lengthDelimited):
        file.fileId = reader.string();
        break;
      case tagOf(GroupFileListFileRespField.fileName, WireType.lengthDelimited):
        file.fileName = reader.string();
        break;
      case tagOf(GroupFileListFileRespField.fileSize, WireType.varint):
        file.fileSize = reader.uint64();
        break;
      case tagOf(GroupFileListFileRespField.busId, WireType.varint):
        file.busId = reader.uint32();
        break;
      case tagOf(GroupFileListFileRespField.uploadedTime, WireType.varint):
        file.uploadedTime = reader.uint32();
        break;
      case tagOf(GroupFileListFileRespField.expireTime, WireType.varint):
        file.expireTime = reader.uint32();
        break;
      case tagOf(GroupFileListFileRespField.modifiedTime, WireType.varint):
        file.modifiedTime = reader.uint32();
        break;
      case tagOf(GroupFileListFileRespField.downloadedTimes, WireType.varint):
        file.downloadedTimes = reader.uint32();
        break;
      case tagOf(GroupFileListFileRespField.uploaderName, WireType.lengthDelimited):
        file.uploaderName = reader.string();
        break;
      case tagOf(GroupFileListFileRespField.uploaderUin, WireType.varint):
        file.uploaderUin = reader.uint32();
        break;
      case tagOf(GroupFileListFileRespField.parentDirectory, WireType.lengthDelimited):
        file.parentDirectory = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return file;
}

export function decodeGroupFileListItem(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupFileListItem {
  const reader = new ProtoReader(data, offset, end);
  const item: GroupFileListItem = { type: 0, folderInfo: null, fileInfo: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupFileListItemRespField.type, WireType.varint):
        item.type = reader.uint32();
        break;
      case tagOf(GroupFileListItemRespField.folderInfo, WireType.lengthDelimited):
        item.folderInfo = reader.message(decodeGroupFileListFolder);
        break;
      case tagOf(GroupFileListItemRespField.fileInfo, WireType.lengthDelimited):
        item.fileInfo = reader.message(decodeGroupFileListFile);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return item;
}

export function decodeGroupFileListResp(data: Uint8Array, offset = 0, end = data.length): GroupFileListResp {
  const reader = new ProtoReader(data, offset, end);
  const list: GroupFileListResp = { retCode: 0, retMsg: "", clientWording: "", isEnd: 0, items: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupFileListRespField.retCode, WireType.varint):
        list.retCode = reader.uint32();
        break;
      case tagOf(GroupFileListRespField.retMsg, WireType.lengthDelimited):
        list.retMsg = reader.string();
        break;
      case tagOf(GroupFileListRespField.clientWording, WireType.lengthDelimited):
        list.clientWording = reader.string();
        break;
      case tagOf(GroupFileListRespField.isEnd, WireType.varint):
        list.isEnd = reader.uint32();
        break;
      case tagOf(GroupFileListRespField.items, WireType.lengthDelimited):
        list.items.push(reader.message(decodeGroupFileListItem));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return list;
}

export function decodeGroupFileViewResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupFileViewResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: GroupFileViewResp = { list: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupFileViewRespField.list, WireType.lengthDelimited):
        resp.list = reader.message(decodeGroupFileListResp);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// _2 / _3 — count and quota (one shared message for both)
// ---------------------------------------------------------------------------
//
// The request holds two optional members and each sub-command fills exactly one:
// `_2` fills `count`, `_3` fills `space`.  Because both members are `!= null`
// checked, a bug that fills both still encodes both and the server reads the
// wrong one — so the two encoders below take a single body and pick a field.

export const GroupFileCountViewReqField = { count: 3, space: 4 } as const;

export const GroupFileCountReqField = { groupUin: 1, appId: 2, busId: 3 } as const;

export const GroupFileSpaceReqField = { groupUin: 1, appId: 2 } as const;

export interface GroupFileCountReq {
  groupUin: number;
  appId: number;
  busId: number;
}

export interface GroupFileSpaceReq {
  groupUin: number;
  appId: number;
}

export interface GroupFileCountViewReq {
  count?: GroupFileCountReq | undefined;
  space?: GroupFileSpaceReq | undefined;
}

export function encodeGroupFileCountReq(body: GroupFileCountReq): Uint8Array {
  return new ProtoWriter()
    .uint32(GroupFileCountReqField.groupUin, body.groupUin)
    .uint32(GroupFileCountReqField.appId, body.appId)
    .uint32(GroupFileCountReqField.busId, body.busId)
    .finish();
}

export function encodeGroupFileSpaceReq(body: GroupFileSpaceReq): Uint8Array {
  return new ProtoWriter()
    .uint32(GroupFileSpaceReqField.groupUin, body.groupUin)
    .uint32(GroupFileSpaceReqField.appId, body.appId)
    .finish();
}

export function encodeGroupFileCountViewReq(body: GroupFileCountViewReq): Uint8Array {
  return new ProtoWriter()
    .message(GroupFileCountViewReqField.count, body.count ? encodeGroupFileCountReq(body.count) : null)
    .message(GroupFileCountViewReqField.space, body.space ? encodeGroupFileSpaceReq(body.space) : null)
    .finish();
}

export const GroupFileCountViewRespField = { count: 3, space: 4 } as const;

export const GroupFileCountRespField = { fileCount: 4, maxCount: 6, isFull: 7 } as const;

export const GroupFileSpaceRespField = { totalSpace: 4, usedSpace: 5 } as const;

export interface GroupFileCountResp {
  fileCount: number;
  maxCount: number;
  isFull: number;
}

export interface GroupFileSpaceResp {
  /** uint64: the group's total quota in bytes (10 GiB by default, > u32). */
  totalSpace: bigint;
  /** uint64: bytes currently used. */
  usedSpace: bigint;
}

export interface GroupFileCountViewResp {
  count: GroupFileCountResp | null;
  space: GroupFileSpaceResp | null;
}

export function decodeGroupFileCountResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupFileCountResp {
  const reader = new ProtoReader(data, offset, end);
  const count: GroupFileCountResp = { fileCount: 0, maxCount: 0, isFull: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupFileCountRespField.fileCount, WireType.varint):
        count.fileCount = reader.uint32();
        break;
      case tagOf(GroupFileCountRespField.maxCount, WireType.varint):
        count.maxCount = reader.uint32();
        break;
      case tagOf(GroupFileCountRespField.isFull, WireType.varint):
        count.isFull = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return count;
}

export function decodeGroupFileSpaceResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupFileSpaceResp {
  const reader = new ProtoReader(data, offset, end);
  const space: GroupFileSpaceResp = { totalSpace: 0n, usedSpace: 0n };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupFileSpaceRespField.totalSpace, WireType.varint):
        space.totalSpace = reader.uint64();
        break;
      case tagOf(GroupFileSpaceRespField.usedSpace, WireType.varint):
        space.usedSpace = reader.uint64();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return space;
}

export function decodeGroupFileCountViewResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupFileCountViewResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: GroupFileCountViewResp = { count: null, space: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupFileCountViewRespField.count, WireType.lengthDelimited):
        resp.count = reader.message(decodeGroupFileCountResp);
        break;
      case tagOf(GroupFileCountViewRespField.space, WireType.lengthDelimited):
        resp.space = reader.message(decodeGroupFileSpaceResp);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export interface ListGroupFilesParams {
  groupId: number | bigint;
  /** The folder PATH; "/" is the root. */
  targetDirectory: string;
  pageSize: number;
  startIndex?: number | undefined;
}

export interface GroupFileListPage {
  items: GroupFileListItem[];
  isEnd: boolean;
}

/**
 * `get_group_root_files` / `get_group_files_by_folder`.
 *
 * Both actions call this and differ only in `targetDirectory`, which is why
 * `folder_id` and `folder` in the OneBot schema both feed the same slot.
 *
 * A missing `list` member is NOT an error here — the reference returns `null`
 * (reference/index.mjs:273104) while the folder-create sibling throws.  That
 * asymmetry is deliberate on the server side (an empty folder legitimately has
 * nothing to report) and is reproduced by returning `null`.
 */
export const ListGroupFilesPage: OidbSpec<
  ListGroupFilesParams,
  GroupFileViewReq,
  GroupFileViewResp,
  GroupFileListPage | null
> = {
  command: GROUP_FILE_VIEW_COMMAND,
  subCommand: GROUP_FILE_VIEW_SUB_COMMAND.list,
  uinForm: true,
  serialize: (params) => ({
    list: {
      groupUin: Number(params.groupId),
      appId: GROUP_FILE_VIEW_APP_ID,
      targetDirectory: params.targetDirectory,
      fileCount: params.pageSize,
      sortBy: 1,
      startIndex: params.startIndex ?? 0,
      field17: 2,
      field18: 0,
    },
  }),
  encodeBody: encodeGroupFileViewReq,
  decodeBody: decodeGroupFileViewResp,
  deserialize: (body) => {
    const list = body.list;
    if (!list) return null;
    checkRetCodeZero("group file list", list.retCode, list.retMsg, list.clientWording);
    return { items: list.items ?? [], isEnd: list.isEnd !== 0 };
  },
};

export interface GroupFileCountParams {
  groupId: number | bigint;
}

export interface GroupFileCountResult {
  fileCount: number;
  /** The server's cap; 10000 is the reference's fallback when it sends none. */
  maxCount: number;
}

/** `get_group_file_count` — note `uinForm` is absent for _2 (see the header). */
export const GetGroupFileCount: OidbSpec<
  GroupFileCountParams,
  GroupFileCountViewReq,
  GroupFileCountViewResp,
  GroupFileCountResult
> = {
  command: GROUP_FILE_VIEW_COMMAND,
  subCommand: GROUP_FILE_VIEW_SUB_COMMAND.count,
  serialize: (params) => ({
    count: { groupUin: Number(params.groupId), appId: GROUP_FILE_VIEW_APP_ID, busId: GROUP_FILE_COUNT_BUS_ID },
  }),
  encodeBody: encodeGroupFileCountViewReq,
  decodeBody: decodeGroupFileCountViewResp,
  deserialize: (body) => ({
    fileCount: Number(body.count?.fileCount ?? 0),
    maxCount: Number(body.count?.maxCount ?? 10000),
  }),
};

export interface GroupFileSpaceResult {
  usedSpace: number;
  totalSpace: number;
}

/**
 * `get_group_file_space`.
 *
 * The wire fields are uint64 but the reference's projection narrows them to
 * `Number` (reference/index.mjs:253314).  That is lossless up to 2^53 bytes —
 * 9 PB — so it is safe for any real quota; the narrowing is kept because the
 * business layer compares these against JS numbers.
 */
export const GetGroupFileSpace: OidbSpec<
  GroupFileCountParams,
  GroupFileCountViewReq,
  GroupFileCountViewResp,
  GroupFileSpaceResult
> = {
  command: GROUP_FILE_VIEW_COMMAND,
  subCommand: GROUP_FILE_VIEW_SUB_COMMAND.space,
  serialize: (params) => ({
    space: { groupUin: Number(params.groupId), appId: GROUP_FILE_VIEW_APP_ID },
  }),
  encodeBody: encodeGroupFileCountViewReq,
  decodeBody: decodeGroupFileCountViewResp,
  deserialize: (body) => ({
    usedSpace: Number(body.space?.usedSpace ?? 0n),
    totalSpace: Number(body.space?.totalSpace ?? 0n),
  }),
};