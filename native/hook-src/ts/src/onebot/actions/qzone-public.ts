// 4.4 (part 2) — the 17 空友爱看 (public recommendation) actions.
//
// Reference region: reference/index.mjs:16867-17594 (`actions$3`, 17 definitions).
//
// ---------------------------------------------------------------------------
// Every one of these is a pass-through, on purpose
// ---------------------------------------------------------------------------
// Each `run` is `okResponse(await ctx.bridge.apis.qzone.<one method>(...))` with no
// post-processing at all. That is not laziness on the reference's part — the gotrpc
// surface answers with upstream cell objects whose unknown fields matter (the
// `returns` text says "保留未知字段" five times), so re-shaping them here would
// destroy the handles the follow-up calls need. The port therefore returns whatever
// `QzoneApi` returns, byte-for-byte, and the differential test asserts that the
// action layer adds and removes nothing.
//
// ---------------------------------------------------------------------------
// The four shared field objects
// ---------------------------------------------------------------------------
// `feed`, `comment`, `reply` and `content` are `f.object()`/`f.textOrObjectArray()`
// up at region scope in the reference and reused across definitions. They are
// re-created here per definition (via the four factory functions below) because
// `FieldImpl` is mutated by `.describe()`/`.optional()` in a chain, and sharing one
// instance across two actions would let the `.optional()` on `set_qzone_public_comment_like`
// leak into `reply_qzone_public_feed`. That leak is invisible until someone diffs
// the two `describe()` outputs — so it is prevented structurally, not by care.
//
// The `describe()` TEXTS are the reference's, verbatim, because they are user-facing
// documentation and a paraphrase would be a silent doc change.

import { defineAction, f, okResponse, type ActionSpec } from "./kit.js";
import type { ActionContext } from "./context.js";

/**
 * A complete feed cell. `f.object()` — unknown fields are the POINT.
 *
 * The reference's `feed` field is deliberately not a schema: the upstream cell has
 * dozens of fields that change between server releases, and the follow-up calls
 * (`get_qzone_public_feed_detail`, `set_qzone_public_like`, …) read handles out of
 * it. Validating the shape here would reject newly added fields.
 */
const feedField = (): ReturnType<typeof f.object> =>
  f.object().describe("get_qzone_public_feeds 返回的完整 feeds 条目，保留所有原始 cell 字段");

const commentField = (): ReturnType<typeof f.object> =>
  f.object().describe("详情或评论页返回的完整评论对象，保留 user 等原始字段");

const replyField = (): ReturnType<typeof f.object> =>
  f.object().describe("评论或回复页返回的完整回复对象，保留 user 等原始字段");

/**
 * `textOrObjectArray()` — non-empty text OR a non-empty array of upstream
 * RichItem objects.
 *
 * The reference's doc is emphatic that a string is ALWAYS sent as-is and must not
 * be parsed as an OneBot message segment array; rich text goes in as objects. That
 * is why the action uses this field type rather than `message()`: a caller passing
 * `"[{\"type\":\"text\"}]"` wants those literal characters in their comment.
 */
const contentField = (): ReturnType<typeof f.textOrObjectArray> =>
  f
    .textOrObjectArray()
    .describe("非空文本，或非空上游 RichItem 对象数组；字符串始终原样发送，富文本请直接传对象数组，不是 OneBot 消息段");

const qzonePublicActions: ActionSpec<Record<string, unknown>, ActionContext>[] = [];

// ===========================================================================
// Reading
// ===========================================================================

qzonePublicActions.push(
  defineAction<{ target_uin?: number | undefined; cursor?: string | undefined }, ActionContext>({
    name: "get_qzone_home_feeds",
    readOnly: true,
    summary: "读取自己或有权访问的空间主页动态，保留完整分享信息",
    returns: "完整动态及分页状态；访问受空间权限限制，旧说说接口保持不变。",
    params: {
      target_uin: f.userId().describe("主页所属 QQ 号，省略则为当前账号").optional(),
      cursor: f
        .string({ allowEmpty: false, maxLen: 65536 })
        .describe("上次返回的 next_cursor，仅限同一账号及主页")
        .optional(),
    },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.getHomeFeeds(p.target_uin, p.cursor)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzonePublicActions.push(
  defineAction<{ tid: string }, ActionContext>({
    name: "get_qzone_feed_detail",
    readOnly: true,
    summary: "按说说 tid 读取完整空间动态，可用于生成分享卡片",
    returns:
      "完整动态及上游详情字段。feed 保留图片、视频、分享信息和未知字段，可直接用于 get_qzone_share_ark；attach_info 保留上游评论游标，不自动翻页。",
    params: { tid: f.string({ allowEmpty: false, maxLen: 24 }).describe("24 位十六进制说说编号") },
    // A tid that is not 24 hex chars is a client bug that would otherwise produce a
    // CGI call the server answers with an empty feed rather than an error.
    rules: (r) => [r.rule("tid must be a 24-character hexadecimal post ID", (p) => /^[0-9a-f]{24}$/i.test(p["tid"] as string))],
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.getFeedDetail(p.tid)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzonePublicActions.push(
  defineAction<{ feed: Record<string, unknown> }, ActionContext>({
    name: "get_qzone_share_ark",
    readOnly: false,
    summary: "生成空间动态分享卡片，返回原文及分享提示",
    returns: "生成卡片但不发送消息；后续发送仍返回普通消息编号。",
    params: { feed: f.object().describe("主页、详情或推荐列表返回的完整动态，保留所有原始字段") },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.getShareArk(p.feed)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzonePublicActions.push(
  defineAction<Record<string, never>, ActionContext>({
    name: "get_qzone_public_capabilities",
    readOnly: true,
    summary: "读取当前账号的空友爱看入口与推权限",
    returns: "当前账号的上游入口能力对象，保留未知字段。",
    params: {},
    run: async (_p, ctx) => okResponse(await ctx.bridge.apis.qzone.getPublicCapabilities()),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzonePublicActions.push(
  defineAction<{ cursor?: string | undefined }, ActionContext>({
    name: "get_qzone_public_feeds",
    readOnly: true,
    summary: "读取空友爱看推荐动态，支持独立游标分页",
    returns: "推荐动态原始 cell 对象及分页状态，保留其余上游页面字段。",
    params: {
      cursor: f
        .string({ allowEmpty: false, maxLen: 65536 })
        .describe("上次返回的 next_cursor，省略则刷新首页")
        .optional(),
    },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.getPublicFeeds(p.cursor)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzonePublicActions.push(
  defineAction<{ feed: Record<string, unknown> }, ActionContext>({
    name: "get_qzone_public_feed_detail",
    readOnly: true,
    summary: "读取推荐动态详情及初始评论",
    returns: "上游详情 data；初始评论位于 feed.feed.cell_comment.comments，续页使用 attach_info。",
    params: { feed: feedField() },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.getPublicFeedDetail(p.feed)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzonePublicActions.push(
  defineAction<{ feed: Record<string, unknown>; cursor: string }, ActionContext>({
    name: "get_qzone_public_comments",
    readOnly: true,
    summary: "继续读取推荐动态评论",
    returns: "上游评论页对象，保留评论、分页和未知字段。",
    params: {
      feed: feedField(),
      cursor: f.string({ allowEmpty: false }).describe("详情或上一评论页返回的 attach_info"),
    },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.getPublicComments(p.feed, p.cursor)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzonePublicActions.push(
  defineAction<
    { feed: Record<string, unknown>; comment: Record<string, unknown>; cursor: string; page_size: number },
    ActionContext
  >({
    name: "get_qzone_public_replies",
    readOnly: true,
    summary: "继续读取指定评论的回复",
    returns: "上游回复页对象，保留回复、分页和未知字段。",
    params: {
      feed: feedField(),
      comment: commentField(),
      // `default("")`, not `.optional()`: an empty cursor means "use the comment's
      // own reply_attach_info", which `getPublicReplies` distinguishes from
      // `undefined`. The default is what makes the distinction reachable.
      cursor: f.string().describe("上一回复页的 reply_attach_info；省略则使用评论自带游标").default(""),
      page_size: f.int({ min: 1 }).describe("请求的回复数量").default(20),
    },
    run: async (p, ctx) =>
      okResponse(await ctx.bridge.apis.qzone.getPublicReplies(p.feed, p.comment, p.cursor, p.page_size)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ===========================================================================
// Interactions
// ===========================================================================

qzonePublicActions.push(
  defineAction<{ feed: Record<string, unknown>; enable: boolean }, ActionContext>({
    name: "set_qzone_public_upvote",
    summary: "推或取消推空友爱看动态（独立于普通赞）",
    returns: "上游推操作结果，保留未知字段。",
    params: { feed: feedField(), enable: f.bool().describe("true 推，false 取消推").default(true) },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.setPublicUpvote(p.feed, p.enable)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzonePublicActions.push(
  defineAction<{ feed: Record<string, unknown>; enable: boolean }, ActionContext>({
    name: "set_qzone_public_like",
    summary: "点赞或取消赞推荐动态",
    returns: "上游普通赞操作结果，保留未知字段。",
    params: { feed: feedField(), enable: f.bool().describe("true 点赞，false 取消赞").default(true) },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.setPublicLike(p.feed, p.enable)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzonePublicActions.push(
  defineAction<
    { feed: Record<string, unknown>; comment: Record<string, unknown>; enable: boolean; reply?: Record<string, unknown> | undefined },
    ActionContext
  >({
    name: "set_qzone_public_comment_like",
    summary: "点赞或取消赞推荐动态中的评论或回复",
    returns: "上游普通赞操作结果，保留未知字段。",
    params: {
      feed: feedField(),
      comment: commentField(),
      enable: f.bool().describe("true 点赞，false 取消赞").default(true),
      // `.optional()`, and the ORDER matters for `describe()`: the reference lists
      // `enable` before `reply` even though `reply` reads like it belongs next to
      // `comment`. The differential test compares the params array in order.
      reply: replyField().optional(),
    },
    run: async (p, ctx) =>
      okResponse(await ctx.bridge.apis.qzone.setPublicCommentLike(p.feed, p.comment, p.enable, p.reply)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzonePublicActions.push(
  defineAction<{ feed: Record<string, unknown>; content: string | Record<string, unknown>[] }, ActionContext>({
    name: "comment_qzone_public_feed",
    summary: "评论推荐动态，支持文本或上游富文本条目",
    returns: "上游评论结果，包含新评论，保留未知字段。",
    params: { feed: feedField(), content: contentField() },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.commentPublicFeed(p.feed, p.content)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzonePublicActions.push(
  defineAction<
    {
      feed: Record<string, unknown>;
      comment: Record<string, unknown>;
      content: string | Record<string, unknown>[];
      reply?: Record<string, unknown> | undefined;
    },
    ActionContext
  >({
    name: "reply_qzone_public_feed",
    summary: "回复推荐动态的评论或其中某条回复",
    returns: "上游回复结果，包含新回复，保留未知字段。",
    params: { feed: feedField(), comment: commentField(), content: contentField(), reply: replyField().optional() },
    run: async (p, ctx) =>
      okResponse(await ctx.bridge.apis.qzone.replyPublicFeed(p.feed, p.comment, p.content, p.reply)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzonePublicActions.push(
  defineAction<{ feed: Record<string, unknown>; comment: Record<string, unknown> }, ActionContext>({
    name: "delete_qzone_public_comment",
    summary: "删除推荐动态的一条评论（需有权限）",
    returns: "上游删除结果，保留未知字段。",
    params: { feed: feedField(), comment: commentField() },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.deletePublicComment(p.feed, p.comment)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzonePublicActions.push(
  defineAction<
    { feed: Record<string, unknown>; comment: Record<string, unknown>; reply: Record<string, unknown> },
    ActionContext
  >({
    name: "delete_qzone_public_reply",
    summary: "删除推荐动态评论下的一条回复（需有权限）",
    returns: "上游删除结果，保留未知字段。",
    params: { feed: feedField(), comment: commentField(), reply: replyField() },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.deletePublicReply(p.feed, p.comment, p.reply)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzonePublicActions.push(
  defineAction<{ feed: Record<string, unknown>; enable: boolean }, ActionContext>({
    name: "set_qzone_public_follow",
    summary: "蹲或取消蹲推荐动态作者",
    returns: "上游关系操作结果，保留未知字段。",
    params: { feed: feedField(), enable: f.bool().describe("true 蹲，false 取消蹲").default(true) },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.setPublicFollow(p.feed, p.enable)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzonePublicActions.push(
  defineAction<{ feed: Record<string, unknown>; reason: string }, ActionContext>({
    name: "forward_qzone_public_feed",
    summary: "将推荐动态转发到当前账号空间",
    returns: "上游转发结果，保留未知字段。",
    params: {
      feed: feedField(),
      // `default("")` — a forward with no comment is legal and the default supplies
      // the empty string the CGI expects, rather than `undefined`.
      reason: f.string().describe("转发附言，可为空").default(""),
    },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.forwardPublicFeed(p.feed, p.reason)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

export { qzonePublicActions };
export const QZONE_PUBLIC_ACTION_COUNT = qzonePublicActions.length;