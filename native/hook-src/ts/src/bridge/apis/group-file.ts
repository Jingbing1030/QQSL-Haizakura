// `GroupFileApi` — the group-file (群文件) slice: ten of its twelve actions land here.
//
// ---------------------------------------------------------------------------
// Reference region
// ---------------------------------------------------------------------------
// `src/bridge/apis/group-file.ts` (reference/index.mjs:288485-296994, 8,510 lines).
// As with the album module, the line count is a codec artefact: nineteen OIDB specs
// with their generated field tables live inside that region. The class itself is the
// last 340 lines and is, with two exceptions, one `SomeOidbSpec.invoke(this.ctx, …)`
// per method.
//
// ---------------------------------------------------------------------------
// The two exceptions, and what they cost
// ---------------------------------------------------------------------------
// `upload` and `uploadPrivate` are NOT thin. Both:
//
//   1. stage the source onto disk (`stageSourceToDisk`, 4 GiB cap),
//   2. hash it streaming (md5 + sha1, plus a `MD5_HEAD_LIMIT`-byte head md5 for
//      the private path),
//   3. send the "request upload" OIDB command (0x6d6_0 / 0xe37_1700),
//   4. **send the actual bytes over the Highway channel**
//      (`uploadHighway`, 71 for group / 95 for private),
//   5. optionally publish / finalize and remember the upload metadata.
//
// Step 4 is a different protocol from `album-upload.ts`'s qzone web endpoint (form
// POST + slice upload). The two cannot be substituted for each other: the Highway
// path speaks raw TCP with a hand-written HTTP/1.1 PUT loop and a protobuf
// `bytesReqExtendInfo`, and the web endpoint would be rejected outright.
//
// ---------------------------------------------------------------------------
// The failure ORDER is the contract
// ---------------------------------------------------------------------------
// Everything cheap happens before everything expensive, and the ordering is
// observable:
//
//   stage → empty-file guard → stat → hash → OIDB → host/port check → PUT
//
// The empty-file guard is BEFORE the OIDB call on purpose. A zero-byte file that
// reached the server would create a real record on the group's file list with no
// way to delete it from this side; refusing first means the server never hears
// about it. Likewise the host/port validation is before the hash-free part of the
// PUT but after the OIDB request, because the address only exists in the response.
//
// ---------------------------------------------------------------------------
// What IS here, end to end
// ---------------------------------------------------------------------------
//   list           0x6d8_1, paginated 20-per-page with a 200-page ceiling
//   getUrl         0x6d6_2, plus the URL *composition* the spec does not do
//   getPrivateUrl  0xe37_1200 (+ self-uid resolution)
//   delete         0x6d6_3
//   move           0x6d6_5
//   rename         0x6d6_4
//   createFolder   0x6d7_0
//   deleteFolder   0x6d7_1
//   renameFolder   0x6d7_2
//
// Nine methods, seven OIDB commands — and every one of them is reachable from an
// action in stage 4.3 except `list`, which the action layer reaches indirectly
// through `ctx.getGroupFiles` (see `onebot/actions/group-file.ts`).
//
// ---------------------------------------------------------------------------
// `getUrl`'s composition is real logic, not formatting
// ---------------------------------------------------------------------------
// The reference's `GetGroupFileUrl` spec overrides `deserialize` inside its own
// `.invoke` (reference/index.mjs:256161-256187) so that the composed URL can see
// `params.fileId`. The port's spec (`oidb/services/0x6d6.ts`) keeps the raw
// `GroupFileUrlResult` instead, so the composition lives here — and it is where the
// `ensureRetCodeZero` check has to happen too, because the spec does not make it.
//
// The URL is `https://<dns>/ftn_handler/<UPPERCASE HEX of the url bytes>/?fname=<fileId>`.
// Note the trailing `/?fname=`: it is the reference's own quirk, an empty path
// segment before the query, and it is reproduced because servers sometimes notice.
//
// ---------------------------------------------------------------------------
// `list`'s pagination is bounded on purpose
// ---------------------------------------------------------------------------
// `for (let page = 0; page < 200; page++)`: a folder with more than 4,000 entries
// reports the first 4,000 rather than looping forever. The reference does exactly
// this, and the bound is invisible until the day a server stops setting `isEnd`.
// `isEnd` is `list.isEnd !== 0` — a server that omits it means "not done", so the
// walk continues, which is why the page bound is not optional.

import { createLogger } from "../../onebot/log.js";
import type { BridgeContext } from "../context.js";
import { oidbCaller } from "../oidb-invoke.js";
import { invokeOidb, type OidbSpec } from "../../oidb/spec.js";
import {
  CreateGroupFolder,
  DeleteGroupFolder,
  RenameGroupFolder,
  type FolderInfo,
} from "../../oidb/services/0x6d7.js";
import {
  GetGroupFileSpace,
  GetGroupFileCount,
  ListGroupFilesPage,
  type GroupFileListItem,
} from "../../oidb/services/0x6d8.js";
import {
  DeleteGroupFile,
  GetGroupFileUrl,
  MoveGroupFile,
  RenameGroupFile,
  UploadGroupFile,
  type GroupFileDownloadBody,
  type GroupFileDownloadResp,
  type GroupFileResp,
  type GroupFileUrlParams,
  type GroupFileUploadResp,
} from "../../oidb/services/0x6d6.js";
import {
  GetPrivateFileUrl,
  GetPrivatePttUrl,
  GetPrivateVideoUrl,
  GetGroupVideoUrl,
  UploadPrivateFileRequest,
  type IPv4,
} from "../../oidb/services/0x3639-offline.js";
import { PublishGroupFile, TransGroupFile } from "../../oidb/services/0x6d9.js";
import { GetGroupPttUrl, type MediaNodeLike } from "../../oidb/services/0x126e.js";
import {
  FILE_UPLOAD_HIGHWAY_CMD_IDS,
  buildGroupFileUploadExt,
  buildPrivateFileUploadExt,
} from "../../highway/file-ext.js";
import { FileChunkSource, uploadHighway } from "../../highway/upload.js";
import { HighwaySessionCache, type HighwaySession } from "../../highway/session.js";
import {
  FILE_UPLOAD_MAX_BYTES,
  MD5_HEAD_LIMIT,
  assertUnchanged,
  hashFileStreaming,
  stageSourceToDisk,
} from "../web/stage-source.js";

const log = createLogger("Bridge.GroupFile");

// ===========================================================================
// The two normalization helpers the reference has at module scope
// ===========================================================================

/**
 * `normalizeDirectory` — reference/index.mjs:289632, three lines.
 *
 * Note it returns the directory UNTRIMMED: `" /sub "` passes through with its
 * spaces, and only a blank-or-absent value becomes `"/"`. Trimming here would be a
 * silent behaviour change for a folder whose name really has leading spaces.
 */
export function normalizeDirectory(dir: string | null | undefined): string {
  if (!dir || !dir.trim()) return "/";
  return dir;
}

/** The reference's `toInt` for this module: number | bigint | string | null → integer. */
function toInt(value: number | bigint | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : 0;
  if (typeof value === "bigint") return Number(value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

/** The `sendC2cFile` payload this module builds — a subset of `message.ts`'s `C2cFileInfo`. */
interface C2cFileSendInfo {
  fileId: string;
  fileName: string;
  fileSize: number;
  fileMd5: Uint8Array;
  fileHash: string;
}

/** `promises.stat`, narrowed to the two fields `assertUnchanged` compares. */
async function statFile(filePath: string): Promise<{ size: number; mtimeMs: number }> {
  const { stat } = await import("node:fs/promises");
  const value = await stat(filePath);
  return { size: value.size, mtimeMs: value.mtimeMs };
}

/**
 * The upload paths' retCode gate — the reference's GLOBAL `ensureRetCodeZero`
 * (:82629), NOT the 0x6d6 spec's `GroupFileRetError` variant next door.
 *
 * The two are different functions with different messages, and the upload call
 * sites use the global one (:289769, :289823). The global one also accepts
 * `null`, which is what an absent response field decodes to in this port, and
 * `toInt(null) === 0` is what makes "no retCode at all" a pass.
 */
function ensureUploadRetCodeZero(
  operation: string,
  code: number | null | undefined,
  msg: string | null | undefined,
  wording: string | null | undefined,
): void {
  const retCode = toInt(code);
  if (retCode === 0) return;
  throw new Error(
    `${operation} failed: code=${String(retCode)} msg=${
      (typeof wording === "string" && wording) || (typeof msg === "string" && msg) || "unknown error"
    }`,
  );
}

/** `int32ToIpv4Dotted` — reference/index.mjs:289636. LOW OCTET FIRST. */
export function int32ToIpv4Dotted(value: number): string {
  return `${value & 255}.${(value >>> 8) & 255}.${(value >>> 16) & 255}.${(value >>> 24) & 255}`;
}

/**
 * `normalizeUploadFileName` — reference/index.mjs:289639.
 *
 * The caller's `name` wins when non-blank; otherwise the staged file's own name;
 * and only when BOTH are blank does it become `"file.bin"`. Note it TRIMS the
 * fallback (`staged.fileName.trim()`) but returns the winner UNTRIMMED — a name
 * of `" x "` is kept with its spaces. Asymmetric, and reproduced as such.
 */
export function normalizeUploadFileName(name: string, fallback: string): string {
  const trimmed = name.trim();
  if (trimmed) return trimmed;
  return fallback.trim() || "file.bin";
}

/**
 * The private-file upload's host/port resolution — reference/index.mjs:289839-289845.
 *
 * A six-fallback chain for the address and a three-way branch for the port, and
 * the branches are COUPLED: `httpsHostUsed` is true only when the host came from
 * `uploadHttpsDomain` specifically (i.e. none of rtp/inIP, `uploadIp`,
 * `uploadDomain`, or `uploadIpList[0]` supplied one), and only then is
 * `uploadHttpsPort` preferred. A domain that arrived through an earlier fallback
 * is paired with the PLAIN port. Reading the two fields independently — host from
 * the chain, port from `uploadHttpsPort ?? uploadPort` — sends a TLS-only host at
 * a cleartext port, which fails as a hang, not as an error.
 *
 * `rtpMediaPlatformUploadAddress` is checked for `inIP !== 0` (not merely
 * present): a zero address is the server saying "no RTP path for you".
 */
export function pickPrivateUploadHost(upload: {
  uploadIp?: string | null;
  uploadDomain?: string | null;
  uploadPort?: number | null;
  uploadIpList?: string[] | null;
  uploadHttpsPort?: number | null;
  uploadHttpsDomain?: string | null;
  uploadDns?: string | null;
  rtpMediaPlatformUploadAddress?: IPv4[] | null;
}): { host: string; port: number; httpsHostUsed: boolean } {
  const rtpFirst =
    Array.isArray(upload.rtpMediaPlatformUploadAddress) && upload.rtpMediaPlatformUploadAddress[0]
      ? upload.rtpMediaPlatformUploadAddress[0]
      : null;
  const rtpInIp = rtpFirst && typeof rtpFirst.inIP === "number" && rtpFirst.inIP !== 0
    ? int32ToIpv4Dotted(rtpFirst.inIP)
    : "";
  const rtpInPort = rtpFirst && typeof rtpFirst.inPort === "number" ? rtpFirst.inPort : 0;
  const ipListFirst = Array.isArray(upload.uploadIpList) && upload.uploadIpList[0] ? upload.uploadIpList[0] : "";
  const host =
    rtpInIp ||
    (typeof upload.uploadIp === "string" && upload.uploadIp) ||
    (typeof upload.uploadDomain === "string" && upload.uploadDomain) ||
    ipListFirst ||
    (typeof upload.uploadHttpsDomain === "string" && upload.uploadHttpsDomain) ||
    (typeof upload.uploadDns === "string" && upload.uploadDns) ||
    "";
  const httpsHostUsed =
    !rtpInIp &&
    !upload.uploadIp &&
    !upload.uploadDomain &&
    !ipListFirst &&
    typeof upload.uploadHttpsDomain === "string" &&
    !!upload.uploadHttpsDomain;
  const port =
    rtpInIp && rtpInPort > 0
      ? rtpInPort
      : httpsHostUsed && toInt(upload.uploadHttpsPort) > 0
        ? toInt(upload.uploadHttpsPort)
        : toInt(upload.uploadPort);
  return { host, port, httpsHostUsed };
}

// ===========================================================================
// Result rows
// ===========================================================================

/** One file row, as `list` returns it (the pre-OneBot shape). */
export interface GroupFileRow {
  fileId: string;
  fileName: string;
  busId: number;
  fileSize: number;
  uploadTime: number;
  deadTime: number;
  modifyTime: number;
  downloadTimes: number;
  uploader: number;
  uploaderName: string;
}

/** One folder row. */
export interface GroupFolderRow {
  folderId: string;
  folderName: string;
  createTime: number;
  creator: number;
  creatorName: string;
  totalFileCount: number;
  lastUploadTime: number;
  lastUploader: number;
  lastUploaderName: string;
}

export interface GroupFileListResult {
  files: GroupFileRow[];
  folders: GroupFolderRow[];
}

/** `composeGroupFileUrl` — reference/index.mjs:256154. */
export function composeGroupFileUrl(
  download: GroupFileDownloadResp | null | undefined,
  fileId: string,
): string {
  if (!download) throw new Error("group file url response missing");
  if (toInt(download.retCode) !== 0) {
    const wording =
      (typeof download.clientWording === "string" && download.clientWording) ||
      (typeof download.retMsg === "string" && download.retMsg) ||
      "unknown error";
    throw new Error(`group file url failed: code=${String(toInt(download.retCode))} msg=${wording}`);
  }
  const dns =
    (typeof download.downloadDns === "string" && download.downloadDns) ||
    (typeof download.downloadIp === "string" && download.downloadIp) ||
    "";
  const urlBytes = download.downloadUrl;
  const hexUrl =
    urlBytes instanceof Uint8Array && urlBytes.length > 0
      ? Buffer.from(urlBytes.buffer, urlBytes.byteOffset, urlBytes.byteLength).toString("hex").toUpperCase()
      : "";
  if (!dns || !hexUrl) throw new Error("group file url response invalid");
  return `https://${dns}/ftn_handler/${hexUrl}/?fname=${fileId}`;
}

// ===========================================================================
// The API
// ===========================================================================

const publishGroupFileCall = oidbCaller(PublishGroupFile);

export class GroupFileApi {
  readonly #ctx: BridgeContext;

  constructor(ctx: BridgeContext) {
    this.#ctx = ctx;
  }

  /**
   * Every file and folder in one directory.
   *
   * `folderId` is a PATH (`"/"` is the root, `"/sub"` a child), not an opaque id —
   * which is why `get_group_files_by_folder`'s `folder_id` parameter can carry
   * either a path or a name and both work.
   */
  async list(groupId: number | bigint, folderId = "/"): Promise<GroupFileListResult> {
    const targetDirectory = normalizeDirectory(folderId);
    const files: GroupFileRow[] = [];
    const folders: GroupFolderRow[] = [];
    const pageSize = 20;
    let startIndex = 0;
    for (let page = 0; page < 200; page += 1) {
      const list = await oidbCaller(ListGroupFilesPage).invoke(this.#ctx, {
        groupId,
        targetDirectory,
        startIndex,
        pageSize,
      });
      if (!list) break;
      for (const item of list.items as GroupFileListItem[]) {
        const type = toInt(item?.type);
        if (type === 1 && item?.fileInfo) {
          const file = item.fileInfo;
          const uploader = toInt(file.uploaderUin);
          const cached = this.#ctx.identity.findGroupMember(toInt(groupId), uploader);
          files.push({
            fileId: typeof file.fileId === "string" ? file.fileId : "",
            fileName: typeof file.fileName === "string" ? file.fileName : "",
            busId: toInt(file.busId),
            fileSize: toInt(file.fileSize),
            uploadTime: toInt(file.uploadedTime),
            deadTime: toInt(file.expireTime),
            modifyTime: toInt(file.modifiedTime),
            downloadTimes: toInt(file.downloadedTimes),
            uploader,
            uploaderName:
              (typeof file.uploaderName === "string" && file.uploaderName) ||
              cached?.card ||
              cached?.nickname ||
              "",
          });
        } else if (type === 2 && item?.folderInfo) {
          const folder = item.folderInfo;
          const creator = toInt(folder.creatorUin);
          const cached = this.#ctx.identity.findGroupMember(toInt(groupId), creator);
          const lastUploader = toInt(folder.modifierUin);
          const lastUploaderCached = this.#ctx.identity.findGroupMember(toInt(groupId), lastUploader);
          folders.push({
            folderId: typeof folder.folderId === "string" ? folder.folderId : "",
            folderName: typeof folder.folderName === "string" ? folder.folderName : "",
            createTime: toInt(folder.createTime),
            creator,
            creatorName:
              (typeof folder.creatorName === "string" && folder.creatorName) ||
              cached?.card ||
              cached?.nickname ||
              "",
            totalFileCount: toInt(folder.totalFileCount),
            lastUploadTime: toInt(folder.modifiedTime),
            lastUploader,
            lastUploaderName:
              (typeof folder.modifierName === "string" && folder.modifierName) ||
              lastUploaderCached?.card ||
              lastUploaderCached?.nickname ||
              "",
          });
        }
      }
      if (list.isEnd) break;
      startIndex += pageSize;
    }
    return { files, folders };
  }

  /**
   * The download URL for one group file.
   *
   * Composed here rather than in the spec because the composition needs `fileId`
   * and `OidbSpec.deserialize` receives only the body — the reference solves the
   * same problem by overriding `deserialize` inside its own `.invoke`. Building the
   * derived spec is not cleverness: it is the same statement, in the same place.
   */
  async getUrl(groupId: number, fileId: string, busId = 102): Promise<string> {
    const spec: OidbSpec<GroupFileUrlParams, GroupFileDownloadBody, GroupFileResp, string> = {
      ...GetGroupFileUrl,
      deserialize: (body: GroupFileResp): string => composeGroupFileUrl(body.download, fileId),
    };
    return invokeOidb(this.#ctx, spec, { groupId, fileId, busId });
  }

  /**
   * The download URL for a private (c2c) file.
   *
   * `userId` is accepted and IGNORED — the reference's signature takes it and never
   * reads it, because the request is addressed by the RECEIVER's uid, which is the
   * bot's own. Keeping the parameter position matters: `get_private_file_url`'s
   * `user_id` is optional, and the action passes `p.user_id ?? 0`.
   */
  async getPrivateUrl(_userId: number, fileId: string, fileHash: string): Promise<string> {
    const selfUid = await resolveSelfUid(this.#ctx);
    return oidbCaller(GetPrivateFileUrl).invoke(this.#ctx, { selfUid, fileId, fileHash });
  }

  delete(groupId: number, fileId: string): Promise<void> {
    return oidbCaller(DeleteGroupFile).invoke(this.#ctx, { groupId, fileId });
  }

  move(groupId: number, fileId: string, parentDirectory: string, targetDirectory: string): Promise<void> {
    return oidbCaller(MoveGroupFile).invoke(this.#ctx, {
      groupId,
      fileId,
      parentDirectory,
      targetDirectory,
    });
  }

  rename(groupId: number, fileId: string, parentDirectory: string, newFileName: string): Promise<void> {
    return oidbCaller(RenameGroupFile).invoke(this.#ctx, {
      groupId,
      fileId,
      parentDirectory,
      newFileName,
    });
  }

  createFolder(groupId: number, name: string, parentId = "/"): Promise<FolderInfo> {
    return oidbCaller(CreateGroupFolder).invoke(this.#ctx, {
      groupId,
      parentId: normalizeDirectory(parentId),
      folderName: name,
    });
  }

  deleteFolder(groupId: number, folderId: string): Promise<void> {
    return oidbCaller(DeleteGroupFolder).invoke(this.#ctx, { groupId, folderId });
  }

  renameFolder(groupId: number, folderId: string, newFolderName: string): Promise<void> {
    return oidbCaller(RenameGroupFolder).invoke(this.#ctx, { groupId, folderId, newFolderName });
  }

  /** `get_group_file_count` — not reached by any action in stage 4.3; kept for parity. */
  getCount(groupId: number | bigint): Promise<{ fileCount: number; maxCount: number }> {
    return oidbCaller(GetGroupFileCount).invoke(this.#ctx, { groupId });
  }

  /** `get_group_file_space` — same status as `getCount`. */
  getSpace(groupId: number | bigint): Promise<{ usedSpace: number; totalSpace: number }> {
    return oidbCaller(GetGroupFileSpace).invoke(this.#ctx, { groupId });
  }

  trans(groupId: number | bigint, fileId: string): Promise<{ saveBusId: number; saveFilePath: string }> {
    if (!fileId) throw new Error("trans requires fileId");
    return oidbCaller(TransGroupFile).invoke(this.#ctx, { groupId, fileId });
  }

  getPttUrl(groupId: number, node: MediaNodeLike): Promise<string> {
    return oidbCaller(GetGroupPttUrl).invoke(this.#ctx, { groupId, node });
  }

  // -------------------------------------------------------------------
  // The three NTV2 rich-media URL reads (reference:290002-290020)
  // -------------------------------------------------------------------
  //
  // `MediaUrlResolver` (host/media-url-resolver.ts) needs all four arms of the dispatch,
  // and until these three existed only the group-ptt one did — so a cached private voice
  // or any video resolved to a `TypeError` from inside the resolver rather than to a URL.
  //
  // Each is wiring only: the OIDB specs (`0x126d_200` / `0x11ea_200` / `0x11e9_200`)
  // have been in `oidb/services/0x3639-offline.ts` since that batch and needed no change.
  //
  // ⚠️ The two PRIVATE arms take no `sessionId`: the request is addressed by the bot's
  // own uid (`resolveSelfUid`, exactly as `getPrivateUrl` above), so the peer's id is not
  // part of the packet. Keeping them one-argument is what makes that visible at the call
  // site — a `getPrivatePttUrl(sessionId, node)` would compile (the extra argument would
  // be ignored) and would read as if the session mattered.

  /** `0x126d_200` — the private (c2c) voice download URL. Addressed by the bot's uid. */
  async getPrivatePttUrl(node: MediaNodeLike): Promise<string> {
    const selfUid = await resolveSelfUid(this.#ctx);
    return oidbCaller(GetPrivatePttUrl).invoke(this.#ctx, { selfUid, node });
  }

  /** `0x11ea_200` — the group video download URL. */
  getVideoUrl(groupId: number, node: MediaNodeLike): Promise<string> {
    return oidbCaller(GetGroupVideoUrl).invoke(this.#ctx, { groupId, node });
  }

  /** `0x11e9_200` — the private (c2c) video download URL. Addressed by the bot's uid. */
  async getPrivateVideoUrl(node: MediaNodeLike): Promise<string> {
    const selfUid = await resolveSelfUid(this.#ctx);
    return oidbCaller(GetPrivateVideoUrl).invoke(this.#ctx, { selfUid, node });
  }

  // -------------------------------------------------------------------
  // The two uploads
  // -------------------------------------------------------------------
  //
  // Both are the same seven steps, differing in three places:
  //
  //   step                  group                          private
  //   OIDB "request upload" 0x6d6_0  (:289761)             0xe37_1700 (:289814)
  //   file id from          `upload.fileId`                `upload.uuid`
  //   highway cmdId         71 (:289790)                   95 (:289859)
  //   ext builder           buildGroupFileUploadExt        buildPrivateFileUploadExt
  //   host from             uploadIp || serverDns          a six-fallback chain
  //   publish               `PublishGroupFile` 0x6d9_4    `message.sendC2cFile`
  //
  // The full sequence (reference :289753 / :289802):
  //
  //   1. stage the source onto disk                     stageSourceToDisk
  //   2. reject an empty file                           BEFORE the OIDB call
  //   3. hash it streaming (md5 + sha1 [+ 10002432-byte head md5])
  //   4. ask the server to open the upload              OIDB
  //   5. record the metadata                            rememberUploadedFile
  //   6. unless the server already has it: PUT the bytes over highway
  //   7. optionally publish / send
  //
  // Step 5 before step 6 is the reference's order and it looks wrong — a metadata
  // row for an upload that may still fail. It is deliberate: `upload_private_file`
  // reads the row back immediately after `uploadPrivate` resolves, and a
  // 4 GiB transfer that completed but forgot its row would fail the action's own
  // guard with "metadata missing" AFTER the bytes are on the server.

  /**
   * `upload` — `upload_group_file`. Restored from BLOCKED status.
   *
   * `uploadFile: false` is a real mode, not a test flag: it asks the server to
   * create the file record WITHOUT transferring bytes (the reference's
   * `upload_file` param). In that mode nothing is uploaded and the returned
   * `fileId` refers to a zero-byte record — which is what the caller asked for.
   *
   * `publishFile` defaults to `uploadFile`. When it is true and the actual publish
   * fails, the error deliberately names the `fileId`: the file IS on the group's
   * list, and a caller that retries the whole upload will create a second copy.
   */
  async upload(
    groupId: number,
    source: string,
    name = "",
    folderId = "/",
    uploadFile = true,
    publishFile = uploadFile,
  ): Promise<{ fileId: string }> {
    const staged = await stageSourceToDisk(source, FILE_UPLOAD_MAX_BYTES);
    try {
      if (staged.fileSize === 0) throw new Error("group file is empty");
      const fileName = normalizeUploadFileName(name, staged.fileName);
      // The stat the guard compares against, taken BEFORE hashing: hashing reads
      // the whole file, so a mutation during the hash pass would otherwise be
      // invisible to `assertUnchanged` later.
      const guardStat = await statFile(staged.filePath);
      const hashes = await hashFileStreaming(staged.filePath);
      const upload = await oidbCaller(UploadGroupFile).invoke(this.#ctx, {
        groupId,
        fileName,
        folderId: normalizeDirectory(folderId),
        fileSize: staged.fileSize,
        fileSha1: hashes.sha1,
        fileMd5: hashes.md5,
      });
      ensureUploadRetCodeZero("group file upload", upload.retCode, upload.retMsg, upload.clientWording);
      const fileId = typeof upload.fileId === "string" && upload.fileId ? upload.fileId : null;
      // Not a warning: without a file id the caller has nothing to reference, and
      // the record the server just created is unreachable.
      if (!fileId) throw new Error("group file upload response missing file_id");
      this.#ctx.rememberUploadedFile({
        fileId,
        scope: "group",
        groupId,
        fileName,
        fileSize: staged.fileSize,
        fileMd5: hashes.md5,
        fileSha1: hashes.sha1,
        rememberedAt: Date.now(),
      });

      // `boolFileExist` is the fast-upload signal: the server already holds these
      // exact bytes (same md5, same account), so the highway PUT is skipped. That
      // is success, not a no-op worth warning about.
      if (!upload.boolFileExist && uploadFile) {
        const senderUin = toInt(this.#ctx.identity.uin);
        if (senderUin <= 0) throw new Error("invalid self uin for group file upload");
        // `uploadIp` first, `serverDns` second. `uploadIp` is an address; the DNS
        // name is a fallback for when the server offers only one.
        const uploadHost =
          (typeof upload.uploadIp === "string" && upload.uploadIp) ||
          (typeof upload.serverDns === "string" && upload.serverDns) ||
          "";
        const uploadPort = toInt(upload.uploadPort);
        if (!uploadHost || uploadPort <= 0) throw new Error("group file upload host is invalid");
        const ext = buildGroupFileUploadExt({
          senderUin,
          groupId,
          fileName,
          fileSize: staged.fileSize,
          md5: hashes.md5,
          fileId,
          uploadKey: upload.fileKey instanceof Uint8Array ? upload.fileKey : new Uint8Array(0),
          checkKey: upload.checkKey instanceof Uint8Array ? upload.checkKey : new Uint8Array(0),
          uploadHost,
          uploadPort,
        });
        await assertUnchanged(staged.filePath, guardStat);
        const bytes = await FileChunkSource.open(staged.filePath);
        await uploadHighway(bytes, {
          uin: String(toInt(this.#ctx.identity.uin)),
          commandId: FILE_UPLOAD_HIGHWAY_CMD_IDS.group,
          session: await this.#highwaySession(),
          fileMd5: hashes.md5,
          extend: ext,
        });
      }

      if (publishFile) {
        try {
          await oidbCaller(PublishGroupFile).invoke(this.#ctx, { groupId, fileId });
        } catch (error) {
          // Named `fileId` on purpose: see this method's comment.
          throw new Error(
            `group file uploaded (fileId=${fileId}) but chat post failed: ` +
              `${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
      }
      return { fileId };
    } finally {
      await staged.cleanup();
    }
  }

  /**
   * `uploadPrivate` — `upload_private_file`.
   *
   * `publishFile` defaults to `uploadFile` here too, but the ACTION calls it with
   * `false` explicitly (`onebot/actions/group-file.ts`:  `uploadPrivate(…, false)`)
   * because it posts the file itself through `sendPrivateMessage` with the richer
   * segment the read-back provides. Keeping the default means a direct caller
   * still gets a send.
   *
   * The publish failure is a WARNING, not a throw — the reference's asymmetry with
   * the group path (:289869 logs, :289794 throws). A file that reached the server
   * but was not posted is recoverable by re-sending the message; a throw there
   * would make the caller re-upload the bytes.
   */
  async uploadPrivate(
    userId: number,
    source: string,
    name = "",
    uploadFile = true,
    publishFile = uploadFile,
  ): Promise<{ fileId: string; fileHash: string | null }> {
    const staged = await stageSourceToDisk(source, FILE_UPLOAD_MAX_BYTES);
    try {
      if (staged.fileSize === 0) throw new Error("private file is empty");
      const targetUid = await this.#ctx.resolveUserUid(userId);
      const selfUid = await resolveSelfUid(this.#ctx);
      const senderUin = toInt(this.#ctx.identity.uin);
      if (senderUin <= 0) throw new Error("invalid self uin for private file upload");
      const fileName = normalizeUploadFileName(name, staged.fileName);
      const guardStat = await statFile(staged.filePath);
      // The head md5 is this path's extra field (`md510MCheckSum`). Note the
      // limit is `MD5_HEAD_LIMIT`, not 10 MiB — see that constant.
      const hashes = await hashFileStreaming(staged.filePath, { headLimit: MD5_HEAD_LIMIT });
      const upload = await oidbCaller(UploadPrivateFileRequest).invoke(this.#ctx, {
        senderUid: selfUid,
        receiverUid: targetUid,
        fileName,
        fileSize: staged.fileSize,
        fileSha1: hashes.sha1,
        fileMd5: hashes.md5,
        md510MCheckSum: hashes.headMd5 ?? new Uint8Array(0),
      });
      ensureUploadRetCodeZero("private file upload", upload.retCode, upload.retMsg, null);
      // The private path's file id is `uuid`, not `fileId` — a different field
      // name for the same concept, and the one swap that would silently produce
      // `fileId: ""` on an otherwise successful upload.
      const fileId = typeof upload.uuid === "string" && upload.uuid ? upload.uuid : null;
      const fileHash = typeof upload.fileAddon === "string" && upload.fileAddon ? upload.fileAddon : null;
      if (!fileId) throw new Error("private file upload response missing file_id");
      this.#ctx.rememberUploadedFile({
        fileId,
        scope: "private",
        userId,
        fileName,
        fileSize: staged.fileSize,
        fileMd5: hashes.md5,
        fileSha1: hashes.sha1,
        fileHash: fileHash ?? "",
        rememberedAt: Date.now(),
      });

      if (!upload.boolFileExist && uploadFile) {
        const { host, port } = pickPrivateUploadHost(upload);
        if (!host || port <= 0) throw new Error("private file upload host is invalid");
        const ext = buildPrivateFileUploadExt({
          senderUin,
          fileName,
          fileSize: staged.fileSize,
          md5: hashes.md5,
          sha1: hashes.sha1,
          fileId,
          // `mediaPlatformUploadKey` first, then `uploadKey`. The media-platform
          // one is issued by the newer RTP path and supersedes the old key when
          // both are present.
          uploadKey:
            upload.mediaPlatformUploadKey instanceof Uint8Array
              ? upload.mediaPlatformUploadKey
              : upload.uploadKey instanceof Uint8Array
                ? upload.uploadKey
                : new Uint8Array(0),
          uploadHost: host,
          uploadPort: port,
        });
        await assertUnchanged(staged.filePath, guardStat);
        const bytes = await FileChunkSource.open(staged.filePath);
        await uploadHighway(bytes, {
          uin: String(senderUin),
          commandId: FILE_UPLOAD_HIGHWAY_CMD_IDS.private,
          session: await this.#highwaySession(),
          fileMd5: hashes.md5,
          extend: ext,
        });
      }

      if (publishFile) {
        try {
          const message = this.#ctx.apis.message as
            | { sendC2cFile?: (uid: number, target: string, info: C2cFileSendInfo) => Promise<unknown> }
            | undefined;
          if (typeof message?.sendC2cFile !== "function") {
            throw new Error("private file chat post requires apis.message.sendC2cFile");
          }
          await message.sendC2cFile(userId, targetUid, {
            fileId,
            fileName,
            fileSize: staged.fileSize,
            fileMd5: hashes.md5,
            fileHash: fileHash ?? "",
          });
        } catch (error) {
          // Warning, not throw — see this method's comment.
          log.warn(
            "private file uploaded (fileId=%s) but chat post failed: %s",
            fileId,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      return { fileId, fileHash };
    } finally {
      await staged.cleanup();
    }
  }

  /**
   * The shared highway session, cached per instance.
   *
   * Lazy for the same reason `pipeline.ts`'s image path is: a `uploadFile: false`
   * call or a fast upload (`boolFileExist`) must not pay an `HttpConn` round trip
   * for a transfer that will not happen.
   */
  #sessionCache: HighwaySessionCache | null = null;

  async #highwaySession(): Promise<HighwaySession> {
    this.#sessionCache ??= new HighwaySessionCache({
      sendRawPacket: (serviceCmd, body) => this.#ctx.sendRawPacket(serviceCmd, body),
    });
    return this.#sessionCache.get();
  }

  /** Log-only accessor so the module has the same logger name as the reference. */
  get logName(): string {
    void log;
    return "Bridge.GroupFile";
  }
  /**
   * `publish` — make an uploaded group file visible in the group's file list.
   *
   * A separate step from the upload: an unpublished file exists on the server but no member
   * can see it. `fileId` is checked for emptiness because `0`/`""` would target nothing and
   * the request would still be accepted.
   */
  publish(groupId: number, fileId: string): Promise<void> {
    if (!fileId) throw new Error("publish requires fileId");
    return publishGroupFileCall.invoke(this.#ctx, { groupId, fileId });
  }

}

/**
 * `resolveSelfUid` — reference/index.mjs:82652.
 *
 * The cache lives on `identity.selfUid`; before warmup, the numeric uin is resolved
 * through `ctx.resolveUserUid`. Throws when there is no usable self identity at all,
 * because an empty uid on the wire is a broken packet rather than a degraded one.
 *
 * `apis/message.ts` already exports an identical helper for the same reason; it is
 * not imported here because its parameter type is `MessageApiContext`, which would
 * make the group-file slice depend on the message slice.
 */
async function resolveSelfUid(ctx: BridgeContext): Promise<string> {
  const cached = ctx.identity.selfUid;
  if (typeof cached === "string" && cached.length > 0) return cached;
  const selfUin = Number(ctx.identity.uin);
  if (!Number.isFinite(selfUin) || selfUin <= 0) throw new Error("self uid is unavailable");
  return ctx.resolveUserUid(selfUin);
}