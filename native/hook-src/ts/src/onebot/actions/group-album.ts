// 4.3b — the group-album family (9 actions) from ../onebot/src/actions/group-album.ts.
//
// Reference region: reference/index.mjs:15687-16256 (`actions$5`, 9 definitions).
//
// ---------------------------------------------------------------------------
// All nine are reachable — nothing here is blocked
// ---------------------------------------------------------------------------
// Measured by reading each `run` body (nine one-liners, listed below), not assumed
// from the names:
//
//   get_group_album_list        -> apis.groupAlbum.list           ✅
//   get_qun_album_list          -> apis.groupAlbum.listQun        ✅ (reshapes)
//   upload_image_to_qun_album   -> apis.groupAlbum.upload         ✅
//   upload_video_to_qun_album   -> apis.groupAlbum.uploadVideo    ✅
//   get_group_album_media_list  -> apis.groupAlbum.getMediaList   ✅
//   do_group_album_comment      -> apis.groupAlbum.comment        ✅
//   set_group_album_media_like  -> apis.groupAlbum.like(…, true)  ✅
//   cancel_group_album_media_like -> apis.groupAlbum.like(…,false)✅
//   del_group_album_media       -> apis.groupAlbum.delete         ✅
//
// The module behind them (`ts/src/bridge/apis/group-album.ts`) is ported in full,
// including the two HTTPS upload paths. So unlike the 群文件 family, no action here
// depends on the Highway channel. What `upload_video_to_qun_album` DOES depend on is
// a media probe (ffmpeg) on the bridge side; that dependency is real but it lives
// entirely in `uploadVideo`, and this action surface is unaffected by it.
//
// ---------------------------------------------------------------------------
// Seven of the nine do NO reshaping — that is the reference's choice, not laziness
// ---------------------------------------------------------------------------
// `get_group_album_media_list`, `do_group_album_comment`, the two `like` actions and
// `del_group_album_media` all pass the API's answer straight into `okResponse`. Their
// response is therefore the API's shape, and "improving" it (renaming `mediaList` to
// `media_list`, say) would change the contract while still compiling. The tests
// assert pass-through by handing back a sentinel object and requiring identity of
// content, which fails loudly if a future edit starts reshaping.
//
// ---------------------------------------------------------------------------
// The two that DO reshape, and the exact mapping
// ---------------------------------------------------------------------------
// `get_qun_album_list` (reference:15988):
//
//     const result = await ctx.bridge.apis.groupAlbum.listQun(p.group_id, p.attach_info);
//     return okResponse({
//       album_list:  result.albumList,
//       attach_info: result.attachInfo,
//       has_more:    result.hasMore
//     });
//
// Three renames, and the ARRAY CONTENTS are left alone — the per-album
// `album_id`/`create_time` shape is `listQun`'s doing (`normalizeQunAlbum` in the
// bridge), not this action's. Re-mapping the items here would double-normalise.
//
// `create_group_file_folder` lives in the sibling family but reshapes the same way;
// see `group-file.ts`.
//
// ---------------------------------------------------------------------------
// `upload_image_to_qun_album` answers `okResponse(null)`, not `okResponse()`
// ---------------------------------------------------------------------------
// The reference writes `return okResponse(null);` while every other void mutator in
// these two families writes `return okResponse();`. Both produce `data: null`
// (`okResponse(data = null)`), so the two are observationally identical — but the
// explicit `null` is reproduced because a reader comparing the two families should
// see why they differ rather than assume a slip.
//
// ---------------------------------------------------------------------------
// `lloc` is `optional()` on the two like actions, and `|| void 0` flips it
// ---------------------------------------------------------------------------
//     params: { …, lloc: f$1.string().optional() }
//     run:    like(…, p.lloc || void 0, true)
//
// `optional()` means an ABSENT `lloc` is `undefined`, and the `|| void 0` then
// rewrites a PRESENT `""` to `undefined` as well. So the bridge never sees an empty
// string on this parameter — which matters because `qunFeedCellId(groupId, albumId,
// batchId, lloc)` branches on `if (!lloc)`, i.e. both reach the head-only form. The
// `||` is thus redundant given `!lloc`'s own falsiness, but it is reproduced: a
// recording fake distinguishes `undefined` from `""` in the call arguments.
//
// `batch_id` is `string({allowEmpty: false})` and stays a STRING all the way down —
// the request does `BigInt(batchId)`, so a client that sends a JSON number would
// fail the field's type coercion before the bridge ever sees it.
//
// ---------------------------------------------------------------------------
// The seven actions with no `summary` have no `summary` in the reference either
// ---------------------------------------------------------------------------
// This is measured, not an omission: `describe()` from the bundle's own code returns
// `summary: undefined` for `get_group_album_list`, `get_qun_album_list`,
// `upload_image_to_qun_album`, `get_group_album_media_list`, `do_group_album_comment`,
// `set_group_album_media_like` and `cancel_group_album_media_like`. Inventing a
// summary would make `describe()` disagree with the reference.

import { defineAction, f, groupAction, okResponse, type ActionSpec } from "./kit.js";
import type { ActionContext } from "./context.js";

const actions: ActionSpec<Record<string, unknown>, ActionContext>[] = [];

// ---------------------------------------------------------------------------
// The two album listings
// ---------------------------------------------------------------------------

actions.push(
  groupAction<Record<string, never>, ActionContext>({
    name: "get_group_album_list",
    readOnly: true,
    returns: "群相册列表数组，每项为一个相册的基本信息。",
    params: {},
    // Pass-through: the legacy albums array, already snake_cased by
    // `toLegacyAlbum` on the bridge (it produces `picNum`, `createuin`,
    // `createnickname`, `last_upload_time` — a deliberately MIXED casing, which is
    // the pre-normalization shape the reference ships for this older action).
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.groupAlbum.list(p.group_id)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

actions.push(
  groupAction<{ attach_info: string }, ActionContext>({
    name: "get_qun_album_list",
    readOnly: true,
    returns: "NapCat 风格的相册列表封套：{album_list, attach_info, has_more}。",
    params: { attach_info: f.string().default("") },
    run: async (p, ctx) => {
      const result = await ctx.bridge.apis.groupAlbum.listQun(p.group_id, p.attach_info);
      // The THREE renames. `albumList`'s items are NOT touched — see the header.
      return okResponse({
        album_list: result.albumList,
        attach_info: result.attachInfo,
        has_more: result.hasMore,
      });
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ---------------------------------------------------------------------------
// The two uploads
// ---------------------------------------------------------------------------

actions.push(
  groupAction<{ album_id: string; album_name: string; file: string }, ActionContext>({
    name: "upload_image_to_qun_album",
    // No `summary` and no `returns`: measured, the reference declares neither.
    params: {
      album_id: f.string({ allowEmpty: false }),
      album_name: f.string({ allowEmpty: false }),
      // `f.image()`, not `f.file()`: the reference's role here is `image`, and the
      // bridge's upload path treats the source as a picture (it sniffs the format).
      file: f.image(),
    },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAlbum.upload(p.group_id, p.album_id, p.album_name, p.file);
      // Explicit `null`, as the reference wrote it — see the header note.
      return okResponse(null);
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

actions.push(
  groupAction<{ album_id: string; album_name: string; file: string }, ActionContext>({
    name: "upload_video_to_qun_album",
    summary: "上传视频到群相册",
    returns: "{ id: string }",
    params: {
      album_id: f.string({ allowEmpty: false }).describe("相册 id"),
      album_name: f.string({ allowEmpty: false }).describe("相册名称"),
      file: f.video().describe("视频文件"),
    },
    // Pass-through: `{id}`. Not renamed to `video_id`, because the reference's
    // `returnsSchema` requires literally `id`.
    run: async (p, ctx) =>
      okResponse(await ctx.bridge.apis.groupAlbum.uploadVideo(p.group_id, p.album_id, p.album_name, p.file)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ---------------------------------------------------------------------------
// The media list
// ---------------------------------------------------------------------------

actions.push(
  groupAction<{ album_id: string; attach_info: string }, ActionContext>({
    name: "get_group_album_media_list",
    readOnly: true,
    returns: "相册图片/视频列表及下一页分页游标；视频项包含 id、url、cover、尺寸、时长和多规格地址。",
    params: { album_id: f.string({ allowEmpty: false }), attach_info: f.string().default("") },
    // Pass-through `{mediaList, nextAttachInfo}` — CAMELCASE, unlike the album list
    // next door which the action itself converts to snake_case. The inconsistency is
    // the reference's and is preserved; "fixing" it would silently break clients
    // that read `nextAttachInfo`.
    run: async (p, ctx) =>
      okResponse(await ctx.bridge.apis.groupAlbum.getMediaList(p.group_id, p.album_id, p.attach_info)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ---------------------------------------------------------------------------
// Comment, the two likes, delete
// ---------------------------------------------------------------------------

actions.push(
  groupAction<{ album_id: string; lloc: string; content: string }, ActionContext>({
    name: "do_group_album_comment",
    params: {
      album_id: f.string({ allowEmpty: false }),
      // REQUIRED and non-empty here, unlike the like actions where the same field
      // is optional: a comment has to address one specific item.
      lloc: f.string({ allowEmpty: false }),
      content: f.string({ allowEmpty: false }),
    },
    run: async (p, ctx) =>
      okResponse(await ctx.bridge.apis.groupAlbum.comment(p.group_id, p.album_id, p.lloc, p.content)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

/**
 * The two like actions are one body differing in a single boolean.
 *
 * They are written out twice rather than looped, because `describe()` must report
 * two names with no aliases, and a loop over `[["set_…", true], ["cancel_…", false]]`
 * produces exactly that with less duplication — but the duplication is what makes
 * the two `run` bodies auditable against the reference side by side. The reference
 * itself duplicates them (reference:16169 / 16196), so this port does too.
 */
actions.push(
  groupAction<{ album_id: string; batch_id: string; lloc: string | undefined }, ActionContext>({
    name: "set_group_album_media_like",
    params: {
      album_id: f.string({ allowEmpty: false }),
      batch_id: f.string({ allowEmpty: false }),
      lloc: f.string().optional(),
    },
    run: async (p, ctx) =>
      okResponse(
        await ctx.bridge.apis.groupAlbum.like(p.group_id, p.album_id, p.batch_id, p.lloc || undefined, true),
      ),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

actions.push(
  groupAction<{ album_id: string; batch_id: string; lloc: string | undefined }, ActionContext>({
    name: "cancel_group_album_media_like",
    params: {
      album_id: f.string({ allowEmpty: false }),
      batch_id: f.string({ allowEmpty: false }),
      lloc: f.string().optional(),
    },
    run: async (p, ctx) =>
      okResponse(
        await ctx.bridge.apis.groupAlbum.like(p.group_id, p.album_id, p.batch_id, p.lloc || undefined, false),
      ),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

actions.push(
  groupAction<{ album_id: string; lloc: string }, ActionContext>({
    name: "del_group_album_media",
    summary: "删除群相册图片或视频",
    params: {
      album_id: f.string({ allowEmpty: false }),
      lloc: f.string({ allowEmpty: false }).describe("图片长定位标识，或视频 id"),
    },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.groupAlbum.delete(p.group_id, p.album_id, p.lloc)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

export const groupAlbumActions: ActionSpec<Record<string, unknown>, ActionContext>[] = actions;

/** 9 definitions; asserted by the registry tests so a dropped action is a failure. */
export const GROUP_ALBUM_ACTION_COUNT = 9;