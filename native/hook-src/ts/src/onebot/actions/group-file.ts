// 4.3 (a) — the group-file family (12 actions) from ../onebot/src/actions/group-file.ts.
//
// Reference region: reference/index.mjs:10340-10839 (`actions$8`, 12 definitions).
// The formatter the two listing actions reach is a SEPARATE region,
// `../onebot/src/modules/contact-actions.ts` (reference:39317-39759), and the
// function itself is at reference:39476 — see the ported copy at the bottom.
//
// ---------------------------------------------------------------------------
// 10 of the 12 need nothing this port lacks; the last two used to. Both uploads are
// now implemented (`bridge/apis/group-file.ts`): the OIDB request, the staging, the
// hashing, the Highway PUT with its own `FileUploadExt`, and the publish step.
// ---------------------------------------------------------------------------
// Measured by reading each `run` body, not by assuming from the names:
//
//   upload_group_file          -> apis.groupFile.upload        ✅ (Highway cmdId 71)
//   upload_private_file        -> apis.groupFile.uploadPrivate ✅ (Highway cmdId 95)
//   get_group_file_url         -> apis.groupFile.getUrl         ✅
//   get_group_root_files       -> ctx.getGroupFiles             ✅
//   get_group_files_by_folder  -> ctx.getGroupFiles             ✅
//   delete_group_file          -> apis.groupFile.delete         ✅
//   move_group_file            -> apis.groupFile.move           ✅
//   rename_group_file          -> apis.groupFile.rename         ✅
//   create_group_file_folder   -> apis.groupFile.createFolder   ✅
//   delete_group_file_folder   -> apis.groupFile.deleteFolder   ✅
//   rename_group_file_folder   -> apis.groupFile.renameFolder   ✅
//   get_private_file_url       -> apis.groupFile.getPrivateUrl  ✅
//
// Neither upload is stubbed with a plausible empty answer. Their `run` bodies call
// the bridge straight through; a bridge-side failure surfaces as retcode 100 with
// the bridge's own wording intact, which is what the action tests still assert (with
// a different message now that the implementation exists).
//
// ---------------------------------------------------------------------------
// Two of the twelve are `defineAction`, not `groupAction`
// ---------------------------------------------------------------------------
// `upload_private_file` (no group) and `get_private_file_url` (no group) are plain
// `defineAction`, so their `user_id` is a normal REQUIRED field
// (`f.userId()`), except in `get_private_file_url` where it is `.optional()` and the
// action passes `p.user_id ?? 0`. The reference passes 0 and the bridge ignores the
// argument entirely — `getPrivateUrl` addresses the request by the bot's own uid —
// so the 0 is a real, observable-to-a-fake argument even though the server never
// sees it. That is reproduced rather than "cleaned up", because a recording fake can
// tell the two apart.
//
// ---------------------------------------------------------------------------
// The three `|| "/"` and the two `|| ""` fallbacks
// ---------------------------------------------------------------------------
// These are not defensive padding: they are the reference's own choices about EMPTY
// STRINGS, and each differs from the field default, which is why `f.string().default("")`
// is followed by a `||`:
//
//   upload_group_file      folderId = p.folder || p.folder_id || "/"     (two empties -> root)
//   get_group_files_by_folder folderId = p.folder_id || p.folder || "/"  (ORDER IS SWAPPED)
//   get_group_file_url     busId    = busidOr102(p.busid)                (raw, so absent -> 102)
//   create_group_file_folder parentId = p.parent_id || "/"
//   rename_group_file      parentDirectory = p.current_parent_directory || "/"
//   create_group_file_folder `groupItem.folderInfo` is the bridge's row verbatim
//   rename_group_file_folder newName = p.new_folder_name || p.name, and BOTH empty is a 1400
//
// The `folder`/`folder_id` swap between rows 1 and 2 is easy to "unify" and wrong:
// row 1 prefers `folder`, row 2 prefers `folder_id`.
//
// ---------------------------------------------------------------------------
// `rename_group_file_folder`'s own 1400 is checked AFTER parsing, not by a rule
// ---------------------------------------------------------------------------
// The reference writes:
//
//     const newName = p.new_folder_name || p.name;
//     if (!newName) return failedResponse(RETCODE.BAD_REQUEST, "group_id, folder_id and new_folder_name are required");
//
// i.e. the two fields are each individually optional (both default `""`), and the
// failure is a 1400 from `run` with a fixed sentence — NOT the kit's `field: reason`
// wording. A `rules:` entry would produce the wrong wording, so this file does not
// add one.

import {
  defineAction,
  f,
  failedResponse,
  groupAction,
  okResponse,
  RETCODE,
  type ActionSpec,
} from "./kit.js";
import type { ActionContext, GroupFileEntry, GroupFolderEntry } from "./context.js";

const actions: ActionSpec<Record<string, unknown>, ActionContext>[] = [];

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

actions.push(
  groupAction<{ file: string; name: string; folder: string; folder_id: string; upload_file: boolean }, ActionContext>({
    name: "upload_group_file",
    summary: "上传群文件",
    returns: "{ file_id: string }",
    params: {
      file: f.file(),
      name: f.string().default(""),
      folder: f.string().default(""),
      folder_id: f.string().default(""),
      upload_file: f.bool().default(true),
    },
    run: async (p, ctx) => {
      // `folder` wins over `folder_id`; both empty means the root.
      const folderId = p.folder || p.folder_id || "/";
      const result = await ctx.bridge.apis.groupFile.upload(p.group_id, p.file, p.name, folderId, p.upload_file);
      return okResponse({ file_id: result.fileId });
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

actions.push(
  defineAction<{ user_id: number; file: string; name: string; upload_file: boolean }, ActionContext>({
    name: "upload_private_file",
    summary: "上传私聊文件",
    returns: "{ file_id: string }",
    params: {
      user_id: f.userId(),
      file: f.file(),
      name: f.string().default(""),
      upload_file: f.bool().default(true),
    },
    run: async (p, ctx) => {
      const result = await ctx.bridge.apis.groupFile.uploadPrivate(p.user_id, p.file, p.name, p.upload_file, false);
      if (p.upload_file) {
        // Two guards, both the reference's: a missing file_id is a failure even
        // though the upload itself reported success, and so is an upload-metadata
        // entry that is absent or belongs to a different chat.
        if (!result.fileId) throw new Error("private file upload returned no file_id");
        const uploaded = ctx.bridge.recallUploadedFile(result.fileId);
        if (!uploaded || uploaded.scope !== "private" || uploaded.userId !== p.user_id) {
          throw new Error(`private file upload metadata missing for file_id ${result.fileId}`);
        }
        await ctx.sendPrivateMessage(
          p.user_id,
          [
            {
              type: "file",
              data: {
                file_id: result.fileId,
                name: uploaded.fileName,
                file_size: uploaded.fileSize,
                md5: Buffer.from(uploaded.fileMd5).toString("hex"),
                file_hash: result.fileHash ?? uploaded.fileHash ?? "",
              },
            },
          ],
          false,
        );
      }
      return okResponse({ file_id: result.fileId });
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/**
 * `busidOr102` — reference:10341, four lines.
 *
 * Not `f.int().default(102)`: the field is `f.raw()` (type `raw`, `required: false`,
 * schema `{}`), so ANY value reaches this function and only a finite non-negative
 * integer survives. `"102"` becomes 102; `"abc"`, `-1`, `null`, `{}` and a missing
 * value all become 102. Coercing at the field would change `describe()`'s output for
 * the parameter, which the schema test compares against the reference.
 */
function busidOr102(raw: unknown): number {
  const n =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.trunc(raw)
      : typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))
        ? Math.trunc(Number(raw))
        : NaN;
  return Number.isInteger(n) && n >= 0 ? n : 102;
}

actions.push(
  groupAction<{ file_id: string; busid: unknown }, ActionContext>({
    name: "get_group_file_url",
    summary: "获取群文件下载链接",
    readOnly: true,
    returns: "群文件下载链接。",
    params: { file_id: f.fileId(), busid: f.raw() },
    run: async (p, ctx) =>
      okResponse({ url: await ctx.bridge.apis.groupFile.getUrl(p.group_id, p.file_id, busidOr102(p.busid)) }),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

actions.push(
  defineAction<{ user_id: number | undefined; file_id: string; file_hash: string }, ActionContext>({
    name: "get_private_file_url",
    summary: "获取私聊文件下载链接",
    readOnly: true,
    returns: "私聊文件下载链接。",
    params: { user_id: f.userId().optional(), file_id: f.fileId(), file_hash: f.string().default("") },
    // `?? 0`, not `|| 0`: an explicit `user_id: 0` fails `f.userId()`'s min-1 check
    // before reaching here, so only an ABSENT one arrives as undefined.
    run: async (p, ctx) =>
      okResponse({ url: await ctx.bridge.apis.groupFile.getPrivateUrl(p.user_id ?? 0, p.file_id, p.file_hash) }),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ---------------------------------------------------------------------------
// Listings — both go through `ctx.getGroupFiles`, not through the bridge
// ---------------------------------------------------------------------------
//
// 🔴 This is the one place the family does NOT call `apis.groupFile` directly. The
// reference's `getGroupFiles` (reference:39476) is a formatting function in
// `onebot/src/modules/contact-actions.ts`: it calls `apis.groupFile.list` and then
// renames every field into the OneBot shape (`fileId` → `file_id`, `busId` →
// `busid`, `creatorName` → `create_name`, …). Skipping it here and calling the
// bridge would return the bridge's own camelCase rows, which is a different
// response for the same action.
//
// The reference reaches it as `ctx.getGroupFiles`, and this port does the same so
// the seam is where the reference put it — `formatGroupFiles` at the bottom of this
// file is the ported function, and a host that prefers to wire the `ctx` member to
// it (rather than re-implementing the rename) gets the reference's answer.
//
// Because the member is OPTIONAL — see `ActionContext.getGroupFiles` — the
// unguarded call is a named throw rather than a bare TypeError, matching the
// pattern `friend.ts` established for `handleGroupRequest`.

actions.push(
  groupAction<Record<string, never>, ActionContext>({
    name: "get_group_root_files",
    summary: "获取群根目录文件列表",
    readOnly: true,
    returns: "群文件系统信息（文件与文件夹列表）。",
    params: {},
    // `"/"` is a literal here, not a defaulted field: the reference writes
    // `ctx.getGroupFiles(p.group_id, "/")`, and the formatter's own `folderId ?? "/"`
    // never fires from this action.
    run: async (p, ctx) => okResponse(await callGetGroupFiles(ctx, p.group_id, "/")),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

actions.push(
  groupAction<{ folder_id: string; folder: string }, ActionContext>({
    name: "get_group_files_by_folder",
    summary: "获取群子目录文件列表",
    readOnly: true,
    returns: "群文件系统信息（文件与文件夹列表）。",
    params: { folder_id: f.string().default(""), folder: f.string().default("") },
    run: async (p, ctx) => {
      // NOTE THE ORDER: `folder_id` first here, `folder` first in upload_group_file.
      // Both are `default("")`, so a caller that sends neither reaches `"/"`.
      const folderId = p.folder_id || p.folder || "/";
      return okResponse(await callGetGroupFiles(ctx, p.group_id, folderId));
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ---------------------------------------------------------------------------
// Mutators on files
// ---------------------------------------------------------------------------

actions.push(
  groupAction<{ file_id: string }, ActionContext>({
    name: "delete_group_file",
    summary: "删除群文件",
    params: { file_id: f.fileId() },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupFile.delete(p.group_id, p.file_id);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

actions.push(
  groupAction<{ file_id: string; parent_directory: string; target_directory: string }, ActionContext>({
    name: "move_group_file",
    summary: "移动群文件",
    params: {
      file_id: f.fileId(),
      parent_directory: f.string({ allowEmpty: false }),
      target_directory: f.string({ allowEmpty: false }),
    },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupFile.move(p.group_id, p.file_id, p.parent_directory, p.target_directory);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

actions.push(
  groupAction<{ file_id: string; current_parent_directory: string; new_name: string }, ActionContext>({
    name: "rename_group_file",
    summary: "重命名群文件",
    returns: "{ok}",
    params: {
      file_id: f.fileId(),
      current_parent_directory: f.string().default("/"),
      new_name: f.string({ allowEmpty: false }),
    },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupFile.rename(p.group_id, p.file_id, p.current_parent_directory || "/", p.new_name);
      // This one answers `{ok: true}`, not null — one of only two in the family.
      return okResponse({ ok: true });
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ---------------------------------------------------------------------------
// Mutators on folders
// ---------------------------------------------------------------------------

actions.push(
  groupAction<{ name: string; parent_id: string }, ActionContext>({
    name: "create_group_file_folder",
    summary: "创建群文件夹",
    returns:
      "{ result: { retCode, retMsg }, groupItem: { folderInfo: { folderId, folderName, folderPath, createTime, modifyTime, createUin, modifyUin } } }",
    params: { name: f.string({ allowEmpty: false }), parent_id: f.string().default("/") },
    run: async (p, ctx) =>
      okResponse({
        // `retCode: 0` / `retMsg: "success"` are LITERALS, not the bridge's answer:
        // the bridge either returned a folder row or threw. Copying the server's own
        // retcode here instead would report a non-zero code on a success path.
        result: { retCode: 0, retMsg: "success" },
        groupItem: { folderInfo: await ctx.bridge.apis.groupFile.createFolder(p.group_id, p.name, p.parent_id || "/") },
      }),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

actions.push(
  groupAction<{ folder_id: string }, ActionContext>({
    name: "delete_group_file_folder",
    summary: "删除群文件夹",
    params: { folder_id: f.string({ allowEmpty: false }) },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupFile.deleteFolder(p.group_id, p.folder_id);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

actions.push(
  groupAction<{ folder_id: string; new_folder_name: string; name: string }, ActionContext>({
    name: "rename_group_file_folder",
    summary: "重命名群文件夹",
    params: {
      folder_id: f.string({ allowEmpty: false }),
      new_folder_name: f.string().default(""),
      name: f.string().default(""),
    },
    run: async (p, ctx) => {
      const newName = p.new_folder_name || p.name;
      if (!newName) {
        return failedResponse(RETCODE.BAD_REQUEST, "group_id, folder_id and new_folder_name are required");
      }
      await ctx.bridge.apis.groupFile.renameFolder(p.group_id, p.folder_id, newName);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

export const groupFileActions: ActionSpec<Record<string, unknown>, ActionContext>[] = actions;

// ---------------------------------------------------------------------------
// The formatter — `getGroupFiles` (reference:39476), ported verbatim
// ---------------------------------------------------------------------------
//
// The reference's function, in full (nine statements, and every one of the
// twenty-one renames is visible here):
//
//     async function getGroupFiles(bridge, groupId, folderId) {
//       const result = await bridge.apis.groupFile.list(groupId, folderId ?? "/");
//       return {
//         files: result.files.map((file) => ({
//           group_id: groupId,
//           file_id: file.fileId,
//           file_name: file.fileName,
//           busid: file.busId,
//           file_size: file.fileSize,
//           upload_time: file.uploadTime,
//           dead_time: file.deadTime,
//           modify_time: file.modifyTime,
//           download_times: file.downloadTimes,
//           uploader: file.uploader,
//           uploader_name: file.uploaderName
//         })),
//         folders: result.folders.map((folder) => ({
//           group_id: groupId,
//           folder_id: folder.folderId,
//           folder_name: folder.folderName,
//           create_time: folder.createTime,
//           creator: folder.creator,
//           create_name: folder.creatorName,
//           total_file_count: folder.totalFileCount,
//           last_upload_time: folder.lastUploadTime,
//           last_uploader: folder.lastUploader,
//           last_uploader_name: folder.lastUploaderName
//         }))
//       };
//     }
//
// Four things a "tidy" rewrite would get wrong:
//
//   1. `folderId ?? "/"` uses NULLISH coalescing, not `||`. A present `""` survives
//      and is passed to the bridge, which then normalises it. This is NOT the same
//      as the actions' own `|| "/"` fallbacks, which treat `""` as absent. Both
//      behaviours exist in the reference, three lines apart.
//   2. `group_id` is written into EVERY row from the `groupId` ARGUMENT, not from
//      anything on the row. The bridge rows do not carry a group id at all.
//   3. The renames are not a uniform camel→snake transform: `creatorName` becomes
//      `create_name` (not `creator_name`), and `modifyTime` becomes `modify_time`
//      on files but `last_upload_time` on folders (the bridge's
//      `GroupFolderRow.lastUploadTime` is already `folder.modifiedTime` upstream,
//      so no second rename happens here).
//   4. `busid` happens to be lowercase on both sides — `busId` → `busid` — so it is
//      a rename even though the two spellings differ only in case.

/**
 * `getGroupFiles(bridge, groupId, folderId)` — the PORTED formatter.
 *
 * Exported so the `ctx.getGroupFiles` provider can be a one-liner regardless of
 * whether the host owns a `Bridge` or only an `ActionApiHub`:
 *
 *     getGroupFiles: (id, folder) => formatGroupFiles(ctx.bridge.apis.groupFile, id, folder)
 *
 * The first parameter is the `groupFile` SLICE rather than the whole bridge, so the
 * function is usable against a fake in a test without constructing a Bridge — a
 * narrower dependency than the reference's, with no behaviour change.
 */
export async function formatGroupFiles(
  groupFile: ActionContext["bridge"]["apis"]["groupFile"],
  groupId: number,
  folderId: string | undefined,
): Promise<{ files: GroupFileEntry[]; folders: GroupFolderEntry[] }> {
  const result = await groupFile.list(groupId, folderId ?? "/");
  return {
    files: result.files.map((file) => ({
      group_id: groupId,
      file_id: file.fileId,
      file_name: file.fileName,
      busid: file.busId,
      file_size: file.fileSize,
      upload_time: file.uploadTime,
      dead_time: file.deadTime,
      modify_time: file.modifyTime,
      download_times: file.downloadTimes,
      uploader: file.uploader,
      uploader_name: file.uploaderName,
    })),
    folders: result.folders.map((folder) => ({
      group_id: groupId,
      folder_id: folder.folderId,
      folder_name: folder.folderName,
      create_time: folder.createTime,
      creator: folder.creator,
      create_name: folder.creatorName,
      total_file_count: folder.totalFileCount,
      last_upload_time: folder.lastUploadTime,
      last_uploader: folder.lastUploader,
      last_uploader_name: folder.lastUploaderName,
    })),
  };
}

/**
 * The two listing actions' call site.
 *
 * A NAMED throw rather than a TypeError, because `getGroupFiles` is optional on this
 * port's context (the same reasoning as `friend.ts`'s `handleGroupRequest`): the
 * reference calls it unguarded, so a host without one must fail — but the dispatcher
 * reports the message, and "provider is not attached" says what to fix while
 * "ctx.getGroupFiles is not a function" does not.
 */
async function callGetGroupFiles(
  ctx: ActionContext,
  groupId: number,
  folderId: string | undefined,
): Promise<{ files: GroupFileEntry[]; folders: GroupFolderEntry[] }> {
  if (!ctx.getGroupFiles) throw new Error("getGroupFiles provider is not attached");
  return await ctx.getGroupFiles(groupId, folderId);
}

/** 12 definitions; asserted by the registry tests so a dropped action is a failure. */
export const GROUP_FILE_ACTION_COUNT = 12;