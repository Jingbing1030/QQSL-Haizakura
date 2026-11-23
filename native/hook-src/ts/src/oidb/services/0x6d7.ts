// OidbSvcTrpcTcp.0x6d7_0 / _1 / _2 — group file FOLDER create / delete / rename.
//
// ---------------------------------------------------------------------------
// What this command family actually is
// ---------------------------------------------------------------------------
// Despite the "0x6d7 = group member" reading that shows up in some notes, all
// three sub-commands here operate on the group's **file system**: the folder
// tree under the group's file tab.  0x6d8 is the file *listing* side of the same
// tree and 0x6d9 is file *transfer*; the three commands are one feature split
// across three ids, which is why they share a codec message.
//
//   0x6d7_0  create_folder   -> OidbGroupFileFolderReq.create
//   0x6d7_1  delete_folder   -> .delete
//   0x6d7_2  rename_folder   -> .rename
//
// ONEBOT-ACTION-SPEC.md's rows 54/55/56 (`create_group_file_folder`,
// `delete_group_file_folder`, `rename_group_file_folder`) are the actions.
//
// ---------------------------------------------------------------------------
// Field numbers  (everything below read out of the reference, not guessed)
// ---------------------------------------------------------------------------
//   OidbGroupFileFolderReq            reference/index.mjs:280893 / 280918 / 280943
//     1 create  message OidbGroupFileCreateFolderReq
//     2 delete  message OidbGroupFileDeleteFolderReq
//     3 rename  message OidbGroupFileRenameFolderReq
//
//   OidbGroupFileCreateFolderReq      reference/index.mjs:280998 / 281022 / 281048
//     1 groupUin      uint32
//     3 rootDirectory string      <-- field 2 is SKIPPED
//     4 folderName    string
//
//   OidbGroupFileDeleteFolderReq      reference/index.mjs:281096 / 281120
//     1 groupUin  uint32
//     3 folderId  string          <-- again field 2 is skipped
//
//   OidbGroupFileRenameFolderReq      reference/index.mjs:281176 / 281200 / 281226
//     1 groupUin      uint32
//     3 folderId      string
//     4 newFolderName string
//
//   OidbGroupFileFolderResp           reference/index.mjs:281492 / 281512 / 281532
//     1 create / 2 delete / 3 rename -> each a OidbGroupFileFolderRetResp
//
//   OidbGroupFileFolderRetResp        reference/index.mjs:281624 .. 281682
//     1 retcode       uint32
//     2 retMsg        string
//     3 clientWording string
//     4 folderInfo    message OidbGroupFileFolderInfoResp   (only on _0)
//
//   OidbGroupFileFolderInfoResp       reference/index.mjs:281731 .. 281913
//     1 folderId    string
//     2 folderPath  string
//     3 folderName  string
//     4 createTime  uint32
//     5 modifyTime  uint32
//     6 createUin   uint32
//     9 modifyUin   uint32      <-- 6 -> 9, fields 7/8 are not in this message
//
// Two structural surprises, both verified above and both easy to "fix" wrongly:
//
//   1. The request sub-messages skip field 2.  Writing the folder name as
//      field 3 (the number that "should" be 3 for a create request) means the
//      server silently ignores it and creates a folder with the default name.
//   2. `modifyUin` is field **9**, not 7.  Renumbering it to 7 makes every
//      folder report a zero modifier.
//
// ---------------------------------------------------------------------------
// uinForm
// ---------------------------------------------------------------------------
// All three carry `uinForm: true` (reference/index.mjs:245784 / 250406 /
// 281963), so the envelope's `reserved` is 1.  None of the sibling group-file
// commands on 0x6d8/0x6d9 do — see the comments in those files.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** Coerce numbers, strings and bigints to a plain integer (reference/index.mjs:82615). */
export function toInt(value: number | bigint | string | null | undefined): number {
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

/**
 * Throw unless `code` is zero, in the reference's exact wording
 * (reference/index.mjs:82629).  `wording` wins over `msg`.
 */
export function checkRetCodeZero(
  operation: string,
  code: number | bigint | string | null | undefined,
  msg?: string | null,
  wording?: string | null,
): void {
  const retCode = toInt(code);
  if (retCode === 0) return;
  const detail =
    (typeof wording === "string" && wording) || (typeof msg === "string" && msg) || "unknown error";
  throw new Error(`${operation} failed: code=${retCode} msg=${detail}`);
}

/** 1751 = 0x6d7. */
export const GROUP_FILE_FOLDER_COMMAND = 0x6d7;

/** 0 = create, 1 = delete, 2 = rename. */
export const GROUP_FILE_FOLDER_SUB_COMMAND = { create: 0, delete: 1, rename: 2 } as const;

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const GroupFileFolderReqField = { create: 1, delete: 2, rename: 3 } as const;

export const CreateFolderField = { groupUin: 1, rootDirectory: 3, folderName: 4 } as const;

export const DeleteFolderField = { groupUin: 1, folderId: 3 } as const;

export const RenameFolderField = { groupUin: 1, folderId: 3, newFolderName: 4 } as const;

export interface CreateFolderBody {
  groupUin: number;
  rootDirectory: string;
  folderName: string;
}

export interface DeleteFolderBody {
  groupUin: number;
  folderId: string;
}

export interface RenameFolderBody {
  groupUin: number;
  folderId: string;
  newFolderName: string;
}

/**
 * One wire body for all three sub-commands.
 *
 * The reference models this as a single message with three mutually exclusive
 * oneof-ish members rather than three messages, and the encoder emits whichever
 * members are `!= null`.  Keeping that shape means a caller can (and a bug can)
 * send two at once — which is why each encoder below builds exactly one.
 */
export interface GroupFileFolderReq {
  create?: CreateFolderBody | undefined;
  delete?: DeleteFolderBody | undefined;
  rename?: RenameFolderBody | undefined;
}

export function encodeCreateFolder(body: CreateFolderBody): Uint8Array {
  return new ProtoWriter()
    .uint32(CreateFolderField.groupUin, body.groupUin)
    .string(CreateFolderField.rootDirectory, body.rootDirectory)
    .string(CreateFolderField.folderName, body.folderName)
    .finish();
}

export function encodeDeleteFolder(body: DeleteFolderBody): Uint8Array {
  return new ProtoWriter()
    .uint32(DeleteFolderField.groupUin, body.groupUin)
    .string(DeleteFolderField.folderId, body.folderId)
    .finish();
}

export function encodeRenameFolder(body: RenameFolderBody): Uint8Array {
  return new ProtoWriter()
    .uint32(RenameFolderField.groupUin, body.groupUin)
    .string(RenameFolderField.folderId, body.folderId)
    .string(RenameFolderField.newFolderName, body.newFolderName)
    .finish();
}

export function encodeGroupFileFolderReq(body: GroupFileFolderReq): Uint8Array {
  return new ProtoWriter()
    .message(GroupFileFolderReqField.create, body.create ? encodeCreateFolder(body.create) : null)
    .message(GroupFileFolderReqField.delete, body.delete ? encodeDeleteFolder(body.delete) : null)
    .message(GroupFileFolderReqField.rename, body.rename ? encodeRenameFolder(body.rename) : null)
    .finish();
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export const GroupFileFolderRespField = { create: 1, delete: 2, rename: 3 } as const;

export const FolderRetRespField = { retcode: 1, retMsg: 2, clientWording: 3, folderInfo: 4 } as const;

export const FolderInfoRespField = {
  folderId: 1,
  folderPath: 2,
  folderName: 3,
  createTime: 4,
  modifyTime: 5,
  createUin: 6,
  modifyUin: 9,
} as const;

export interface FolderInfo {
  folderId: string;
  folderPath: string;
  folderName: string;
  createTime: number;
  modifyTime: number;
  createUin: number;
  modifyUin: number;
}

export interface FolderRet {
  retcode: number;
  retMsg: string;
  clientWording: string;
  folderInfo: FolderInfo | null;
}

export interface GroupFileFolderResp {
  create: FolderRet | null;
  delete: FolderRet | null;
  rename: FolderRet | null;
}

export function decodeFolderInfo(data: Uint8Array, offset = 0, end = data.length): FolderInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: FolderInfo = {
    folderId: "",
    folderPath: "",
    folderName: "",
    createTime: 0,
    modifyTime: 0,
    createUin: 0,
    modifyUin: 0,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FolderInfoRespField.folderId, WireType.lengthDelimited):
        info.folderId = reader.string();
        break;
      case tagOf(FolderInfoRespField.folderPath, WireType.lengthDelimited):
        info.folderPath = reader.string();
        break;
      case tagOf(FolderInfoRespField.folderName, WireType.lengthDelimited):
        info.folderName = reader.string();
        break;
      case tagOf(FolderInfoRespField.createTime, WireType.varint):
        info.createTime = reader.uint32();
        break;
      case tagOf(FolderInfoRespField.modifyTime, WireType.varint):
        info.modifyTime = reader.uint32();
        break;
      case tagOf(FolderInfoRespField.createUin, WireType.varint):
        info.createUin = reader.uint32();
        break;
      case tagOf(FolderInfoRespField.modifyUin, WireType.varint):
        info.modifyUin = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return info;
}

export function decodeFolderRet(data: Uint8Array, offset = 0, end = data.length): FolderRet {
  const reader = new ProtoReader(data, offset, end);
  const ret: FolderRet = { retcode: 0, retMsg: "", clientWording: "", folderInfo: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FolderRetRespField.retcode, WireType.varint):
        ret.retcode = reader.uint32();
        break;
      case tagOf(FolderRetRespField.retMsg, WireType.lengthDelimited):
        ret.retMsg = reader.string();
        break;
      case tagOf(FolderRetRespField.clientWording, WireType.lengthDelimited):
        ret.clientWording = reader.string();
        break;
      case tagOf(FolderRetRespField.folderInfo, WireType.lengthDelimited):
        ret.folderInfo = reader.message(decodeFolderInfo);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return ret;
}

export function decodeGroupFileFolderResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupFileFolderResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: GroupFileFolderResp = { create: null, delete: null, rename: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupFileFolderRespField.create, WireType.lengthDelimited):
        resp.create = reader.message(decodeFolderRet);
        break;
      case tagOf(GroupFileFolderRespField.delete, WireType.lengthDelimited):
        resp.delete = reader.message(decodeFolderRet);
        break;
      case tagOf(GroupFileFolderRespField.rename, WireType.lengthDelimited):
        resp.rename = reader.message(decodeFolderRet);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// The body-level retcode check
// ---------------------------------------------------------------------------
//
// Every group-file sub-response carries its own retcode, and a call can succeed
// at the envelope level and still fail here.  The reference's helper is
// `ensureRetCodeZero` (reference/index.mjs:82629):
//
//     throw new Error(`${operation} failed: code=${retCode} msg=${wording || msg || "unknown error"}`)
//
// Two properties matter and both are easy to get wrong:
//
//   * the *exact* wording, `failed: code=N msg=...` — callers and log greps match
//     on it;
//   * `clientWording` (the server's user-facing Chinese text) wins over `retMsg`.
//
// `0x6d6.ts` exported a helper of the same name with the same precedence rule but a
// different message shape (`failed with retcode N: ...`). That divergence has since been
// reconciled -- 0x6d6 now uses the reference's wording too -- so the two helpers produce
// identical text and could be merged. They are still separate because merging them is a
// refactor with no behavioural payoff, and this file would then depend on 0x6d6 for a
// one-line function.

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export interface CreateFolderParams {
  groupId: number | bigint;
  parentId: string;
  folderName: string;
}

export interface DeleteFolderParams {
  groupId: number | bigint;
  folderId: string;
}

export interface RenameFolderParams {
  groupId: number | bigint;
  folderId: string;
  newFolderName: string;
}

/**
 * `create_group_file_folder`.
 *
 * `parentId` is the *path*, not an id: the reference sends the caller's
 * `parent_id` straight into `rootDirectory`, and QQ's default root is the
 * literal `"/"` (the action schema's default too).
 */
export const CreateGroupFolder: OidbSpec<CreateFolderParams, GroupFileFolderReq, GroupFileFolderResp, FolderInfo> = {
  command: GROUP_FILE_FOLDER_COMMAND,
  subCommand: GROUP_FILE_FOLDER_SUB_COMMAND.create,
  uinForm: true,
  serialize: (params) => ({
    create: {
      groupUin: Number(params.groupId),
      rootDirectory: params.parentId,
      folderName: params.folderName,
    },
  }),
  encodeBody: encodeGroupFileFolderReq,
  decodeBody: decodeGroupFileFolderResp,
  deserialize: (body) => {
    const result = body.create;
    // reference/index.mjs:245790 — a response with no `create` member is an
    // error, not an empty success.
    if (!result) throw new Error("group folder create response missing");
    checkRetCodeZero("group folder create", result.retcode, result.retMsg, result.clientWording);
    const info = result.folderInfo ?? {
      folderId: "",
      folderPath: "",
      folderName: "",
      createTime: 0,
      modifyTime: 0,
      createUin: 0,
      modifyUin: 0,
    };
    return {
      folderId: info.folderId ?? "",
      folderName: info.folderName ?? "",
      folderPath: info.folderPath ?? "",
      createTime: info.createTime ?? 0,
      modifyTime: info.modifyTime ?? 0,
      createUin: info.createUin ?? 0,
      modifyUin: info.modifyUin ?? 0,
    };
  },
};

/** `delete_group_file_folder` — the reference's deserialize returns nothing. */
export const DeleteGroupFolder: OidbSpec<DeleteFolderParams, GroupFileFolderReq, GroupFileFolderResp, void> = {
  command: GROUP_FILE_FOLDER_COMMAND,
  subCommand: GROUP_FILE_FOLDER_SUB_COMMAND.delete,
  uinForm: true,
  serialize: (params) => ({
    delete: { groupUin: Number(params.groupId), folderId: params.folderId },
  }),
  encodeBody: encodeGroupFileFolderReq,
  decodeBody: decodeGroupFileFolderResp,
  deserialize: (body) => {
    const result = body.delete;
    if (!result) throw new Error("group folder delete response missing");
    checkRetCodeZero("group folder delete", result.retcode, result.retMsg, result.clientWording);
  },
};

/** `rename_group_file_folder`. */
export const RenameGroupFolder: OidbSpec<RenameFolderParams, GroupFileFolderReq, GroupFileFolderResp, void> = {
  command: GROUP_FILE_FOLDER_COMMAND,
  subCommand: GROUP_FILE_FOLDER_SUB_COMMAND.rename,
  uinForm: true,
  serialize: (params) => ({
    rename: {
      groupUin: Number(params.groupId),
      folderId: params.folderId,
      newFolderName: params.newFolderName,
    },
  }),
  encodeBody: encodeGroupFileFolderReq,
  decodeBody: decodeGroupFileFolderResp,
  deserialize: (body) => {
    const result = body.rename;
    if (!result) throw new Error("group folder rename response missing");
    checkRetCodeZero("group folder rename", result.retcode, result.retMsg, result.clientWording);
  },
};