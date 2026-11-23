// 4.4 (part 1) — the 12 说说/主页 qzone actions from ../onebot/src/actions/qzone.ts.
//
// Reference region: reference/index.mjs:16226-16867 (`actions$4`, 12 definitions).
//
// ---------------------------------------------------------------------------
// These are pure wiring, and that is a measured fact, not a hope
// ---------------------------------------------------------------------------
// Every `run` here is a single `ctx.bridge.apis.qzone.*` call wrapped in
// `okResponse(...)`, except for four that do a little more:
//
//   set_qzone_profile   awaits, then answers `okResponse(null)` (NOT `okResponse()`)
//   delete_qzone_msg    same
//   like_qzone          same, and passes a literal `true`
//   unlike_qzone        same, passes `false` — the ONLY difference from the above
//   send_qzone_msg      uploads images first, joins richvals with a TAB
//   comment_qzone       branches on comment_id/images, and strings the uins
//
// `ts/src/bridge/apis/qzone.ts` already implements all 19 `QzoneApi` methods these
// calls name, and `ts/src/bridge/web/qzone.ts` + `web/qzone-public.ts` already
// implement the sixteen CGI endpoints and the gotrpc JSON surface behind them. So
// this file adds no wire logic: the missing infrastructure the brief warned about
// is the ACTION layer, not the HTTP layer.
//
// ---------------------------------------------------------------------------
// `okResponse(null)` vs `okResponse()` — both are `data: null`, deliberately
// ---------------------------------------------------------------------------
// `types.ts`'s `okResponse(data = null)` makes these identical, and the reference
// writes both forms across the family (`delete_qzone_msg` passes an explicit null,
// `set_qzone_ban` passes one too, while `set_qzone_profile` passes `null` as well;
// nothing here uses the bare form). The port keeps the explicit `null` so a reader
// comparing the two files sees the same token in the same place — and the
// differential tests compare `data` literally, so a host that changed the default
// would go red.
//
// ---------------------------------------------------------------------------
// The tab that joins richvals is byte-significant
// ---------------------------------------------------------------------------
// `uploadQzoneImages` joins uploaded images with `"\t"` (a literal U+0009), not
// with a comma or a space. `publishQzoneMsg`'s `richval` is a `\t`-separated list
// of per-image records, and the CGI splits on exactly that byte. A comma-joined
// list uploads as one malformed record. The reference calls the separator
// `"\t"` in source and the port writes `"\t"` for the same reason; a mutation test
// flips it to `","` and asserts the response differs.
//
// ---------------------------------------------------------------------------
// Order of the two upload join rules differs between publish and comment
// ---------------------------------------------------------------------------
//   send_qzone_msg   joins `upload.richval` with "\t" and sends richType = 1
//   comment_qzone    joins `upload.url`     with "\t" and sends richType = 1
// The two upload outputs are different fields of `QzoneUploadedImage`
// (`richval` is the CGI's own record, `url` is the picture URL). Swapping them
// produces a comment whose "image" is a bare URL the server rejects, which is why
// the differential test asserts the exact joined string rather than "some string".

import {
  defineAction,
  f,
  okResponse,
  type ActionSpec,
} from "./kit.js";
import type { ActionContext } from "./context.js";

/**
 * `QZONE_UGC_RIGHTS$1` — reference:16234.
 *
 * Declared here rather than imported from `bridge/web/qzone.ts` because the action
 * layer's rule must fail with the ACTION's wording (`"ugc_right must be one of
 * 1, 4, 16, 64, 128"`, produced by `rules`), while the bridge's own
 * `normalizeQzoneUgcRight` throws the same string from a different layer. Keeping
 * both means an action-level rejection never reaches the bridge — which is what
 * the reference does, and it is observable: the rejection is a 1400, not a 100.
 */
const QZONE_UGC_RIGHTS = new Set([1, 4, 16, 64, 128]);

/**
 * Upload a list of image sources and join the selected field.
 *
 * Reference:16227 `uploadQzoneImages`. Two things are load-bearing:
 *
 *   * the join separator is `"\t"` (see the header);
 *   * an upload failure is re-thrown with `第 N 张图片上传失败: <message>`, so a
 *     caller learns WHICH image failed. The reference catches EVERY throw from the
 *     upload, not just `Error`, and falls back to `"unknown error"`.
 */
async function uploadQzoneImages(
  ctx: ActionContext,
  images: readonly string[],
  select: (upload: { richval: string; url: string }) => string,
): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < images.length; i += 1) {
    try {
      const upload = await ctx.bridge.apis.qzone.uploadImageFromSource(images[i]!);
      parts.push(select(upload));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      throw new Error(`第 ${i + 1} 张图片上传失败: ${message}`);
    }
  }
  return parts.join("\t");
}

const qzoneActions: ActionSpec<Record<string, unknown>, ActionContext>[] = [];

// ===========================================================================
// Profile
// ===========================================================================

qzoneActions.push(
  defineAction<{ target_uin?: number | undefined }, ActionContext>({
    name: "get_qzone_profile",
    readOnly: true,
    summary: "获取 QQ 空间名称和说明（默认当前账号）",
    returns: "空间名称和说明。",
    params: { target_uin: f.userId().describe("目标 QQ 号，省略则取机器人自己").optional() },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.getProfile(p.target_uin)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzoneActions.push(
  defineAction<{ name?: string | undefined; description?: string | undefined }, ActionContext>({
    name: "set_qzone_profile",
    summary: "修改当前账号的 QQ 空间名称或说明",
    params: {
      name: f.string().describe("新的空间名称，空字符串表示清空，省略则保留").optional(),
      description: f.string().describe("新的空间说明，空字符串表示清空，省略则保留").optional(),
    },
    // `atLeastOneOf` — a request with neither field would be a `mb=0` no-op, so it
    // is rejected as 1400 instead of pretending to succeed.
    rules: (r) => [r.atLeastOneOf("name", "description")],
    run: async (p, ctx) => {
      await ctx.bridge.apis.qzone.setProfile(p);
      return okResponse(null);
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ===========================================================================
// 说说 listing / detail
// ===========================================================================

qzoneActions.push(
  defineAction<{ target_uin?: number | undefined; pos: number; num: number }, ActionContext>({
    name: "get_qzone_msg_list",
    readOnly: true,
    summary: "获取 QQ 空间说说列表（默认机器人自己的空间）",
    returns: "说说列表对象，含说说总数与本页说说数组。",
    params: {
      target_uin: f.userId().describe("目标 QQ 号，省略则取机器人自己").optional(),
      pos: f.int({ min: 0 }).describe("起始偏移").default(0),
      num: f.int({ min: 1, max: 100 }).describe("本页数量").default(20),
    },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.getMsgList(p.target_uin, p.pos, p.num)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzoneActions.push(
  defineAction<{ tid: string; target_uin?: number | undefined; pos: number; num: number }, ActionContext>({
    name: "get_qzone_msg_detail",
    readOnly: true,
    summary: "获取 QQ 空间说说详情与一页评论（含服务端内联回复，需有访问权限）",
    returns: "说说详情、服务端报告的评论总数与本页评论；replies 仅含服务端内联返回的二级回复，不保证完整。",
    params: {
      tid: f.string({ allowEmpty: false }).describe("说说 tid（来自 get_qzone_msg_list / send_qzone_msg）"),
      target_uin: f.userId().describe("说说所属 QQ 号，省略则取机器人自己").optional(),
      pos: f.int({ min: 0 }).describe("一级评论起始偏移").default(0),
      num: f.int({ min: 1, max: 100 }).describe("请求的一级评论数量，实际数量受服务端限制").default(20),
    },
    run: async (p, ctx) =>
      okResponse(await ctx.bridge.apis.qzone.getMsgDetail(p.tid, p.target_uin, p.pos, p.num)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzoneActions.push(
  defineAction<{ page_num: number; count: number; cursor?: string | undefined }, ActionContext>({
    name: "get_qzone_feeds",
    readOnly: true,
    summary: "获取 QQ 空间好友动态，支持结构化正文与游标分页",
    returns: "好友动态、可提取的正文与图片、统计值及下一页游标；未知内容或统计为 null，HTML 保留。",
    params: {
      page_num: f.int({ min: 1 }).describe("页码（1 起）；不传 cursor 时从首页顺序定位，较深页可能耗时较长").default(1),
      count: f.int({ min: 1, max: 50 }).describe("本页数量").default(10),
      cursor: f
        .string({ allowEmpty: false, maxLen: 65536 })
        .describe("上一次返回的 next_cursor；原样传递，省略 page_num 或传入对应页码")
        .optional(),
    },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.qzone.getFeeds(p.page_num, p.count, p.cursor)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ===========================================================================
// 说说 writes
// ===========================================================================

qzoneActions.push(
  defineAction<
    { content: string; images?: string[] | undefined; ugc_right: number; target_uins?: number[] | undefined },
    ActionContext
  >({
    name: "send_qzone_msg",
    summary: "发表说说（QQ 空间，支持纯文字或带图；传 images 自动上传；可设置查看权限）",
    params: {
      content: f.string({ allowEmpty: false }).describe("说说正文"),
      images: f
        .array(f.string({ allowEmpty: false }))
        .describe("图片数组（可选），支持 file:// http:// base64://；自动上传")
        .optional(),
      ugc_right: f
        .int({ min: 1 })
        .describe("查看权限：1=所有人可见，4=好友可见，16=部分好友可见，64=仅自己可见，128=部分好友不可见")
        .default(1),
      target_uins: f
        .array(f.uint())
        .describe("权限作用 QQ 号数组；ugc_right=16 时表示可见名单，128 时表示不可见名单")
        .optional(),
    },
    rules: (r) => [
      r.rule("ugc_right must be one of 1, 4, 16, 64, 128", (p) => QZONE_UGC_RIGHTS.has(p["ugc_right"] as number)),
      // `!!p.target_uins?.length` — an EMPTY array does not satisfy the rule, so
      // `ugc_right: 16, target_uins: []` is 1400. Reading this as `!== undefined`
      // would let an empty allow-list through and publish a post nobody can see.
      r.rule(
        "target_uins is required when ugc_right is 16 or 128",
        (p) =>
          (p["ugc_right"] !== 16 && p["ugc_right"] !== 128) ||
          ((p["target_uins"] as number[] | undefined)?.length ?? 0) > 0,
      ),
    ],
    run: async (p, ctx) => {
      if (p.images && p.images.length > 0) {
        const richval = await uploadQzoneImages(ctx, p.images, (upload) => upload.richval);
        return okResponse(
          await ctx.bridge.apis.qzone.publish(p.content, 1, richval, p.ugc_right, p.target_uins?.join("|")),
        );
      }
      // `void 0` for richType/richval, NOT 0/"": `publishQzoneMsg` asserts that the
      // pair is absent together, and a `0` would be a present-but-meaningless richType.
      return okResponse(
        await ctx.bridge.apis.qzone.publish(p.content, undefined, undefined, p.ugc_right, p.target_uins?.join("|")),
      );
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzoneActions.push(
  defineAction<{ tid: string }, ActionContext>({
    name: "delete_qzone_msg",
    summary: "删除一条说说（QQ 空间，按 tid）",
    params: { tid: f.string({ allowEmpty: false }).describe("说说 tid（来自 get_qzone_msg_list / send_qzone_msg）") },
    run: async (p, ctx) => {
      await ctx.bridge.apis.qzone.delete(p.tid);
      return okResponse(null);
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzoneActions.push(
  defineAction<{ tid: string; ugc_right: number; target_uins?: number[] | undefined }, ActionContext>({
    name: "set_qzone_msg_right",
    summary: "修改一条已发说说的查看权限（QQ 空间，按 tid）",
    returns: "更新后的权限对象。",
    params: {
      tid: f.string({ allowEmpty: false }).describe("说说 tid（来自 get_qzone_msg_list / send_qzone_msg）"),
      ugc_right: f
        .int({ min: 1 })
        .describe("查看权限：1=所有人可见，4=好友可见，16=部分好友可见，64=仅自己可见，128=部分好友不可见"),
      target_uins: f
        .array(f.uint())
        .describe("权限作用 QQ 号数组；ugc_right=16 时表示可见名单，128 时表示不可见名单")
        .optional(),
    },
    // The same two rules as `send_qzone_msg`, in the same order.
    rules: (r) => [
      r.rule("ugc_right must be one of 1, 4, 16, 64, 128", (p) => QZONE_UGC_RIGHTS.has(p["ugc_right"] as number)),
      r.rule(
        "target_uins is required when ugc_right is 16 or 128",
        (p) =>
          (p["ugc_right"] !== 16 && p["ugc_right"] !== 128) ||
          ((p["target_uins"] as number[] | undefined)?.length ?? 0) > 0,
      ),
    ],
    run: async (p, ctx) =>
      okResponse(await ctx.bridge.apis.qzone.updateRight(p.tid, p.ugc_right, p.target_uins?.join("|"))),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ===========================================================================
// Like / unlike — the two differ ONLY in the boolean
// ===========================================================================

qzoneActions.push(
  defineAction<{ tid: string; target_uin?: number | undefined; abstime: number }, ActionContext>({
    name: "like_qzone",
    summary: "给一条说说点赞（QQ 空间）",
    params: {
      tid: f.string({ allowEmpty: false }).describe("说说 tid"),
      target_uin: f.userId().describe("说说所属 QQ 号，省略则为机器人自己").optional(),
      abstime: f.int({ min: 0 }).describe("说说发表时间（unix 秒），传真实值更可靠").default(0).role("timestamp"),
    },
    run: async (p, ctx) => {
      await ctx.bridge.apis.qzone.like(p.tid, p.target_uin, true, p.abstime);
      return okResponse(null);
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

qzoneActions.push(
  defineAction<{ tid: string; target_uin?: number | undefined; abstime: number }, ActionContext>({
    name: "unlike_qzone",
    summary: "取消对一条说说的点赞（QQ 空间；取消赞端点待真机核实）",
    params: {
      tid: f.string({ allowEmpty: false }).describe("说说 tid"),
      target_uin: f.userId().describe("说说所属 QQ 号，省略则为机器人自己").optional(),
      abstime: f.int({ min: 0 }).describe("说说发表时间（unix 秒），传真实值更可靠").default(0).role("timestamp"),
    },
    run: async (p, ctx) => {
      await ctx.bridge.apis.qzone.like(p.tid, p.target_uin, false, p.abstime);
      return okResponse(null);
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ===========================================================================
// Comments
// ===========================================================================

qzoneActions.push(
  defineAction<
    {
      tid: string;
      content: string;
      target_uin?: number | undefined;
      comment_id?: string | undefined;
      comment_uin?: number | undefined;
      reply_uin?: number | undefined;
      reply_name?: string | undefined;
      images?: string[] | undefined;
    },
    ActionContext
  >({
    name: "comment_qzone",
    summary: "评论说说或回复指定评论（普通评论支持带图，楼中楼仅支持文字）",
    params: {
      tid: f.string({ allowEmpty: false }).describe("说说 tid"),
      content: f.string({ allowEmpty: false }).describe("评论内容"),
      target_uin: f.userId().describe("说说所属 QQ 号，省略则为机器人自己").optional(),
      comment_id: f
        .string({ allowEmpty: false })
        .describe("一级父评论 ID，与 comment_uin 同时提供；编号 0 有效，不能传二级回复自身的 ID")
        .optional(),
      comment_uin: f
        .userId()
        .describe("一级父评论作者 QQ 号，与 comment_id 同时提供；不是说说所属账号")
        .optional(),
      reply_uin: f
        .userId()
        .describe("楼中楼中要回复的用户 QQ 号，与 reply_name 同时提供，需指定父评论")
        .optional(),
      reply_name: f
        .string({ allowEmpty: false })
        .describe("要回复的用户昵称，来自评论详情的 name；与 reply_uin 同时提供")
        .optional(),
      images: f
        .array(f.string({ allowEmpty: false }))
        .describe("图片数组（可选），支持 file:// http:// base64://；自动上传")
        .optional(),
    },
    // Five rules, and each one rejects a request the server would otherwise
    // half-accept. The 4th is the subtle one: it treats a present-but-blank
    // `comment_id` OR `reply_name` as invalid even though `allowEmpty: false`
    // already ran — because both fields are reached only when the OTHER half of
    // their pair is present, and a blank one builds a reply CGI call with an empty
    // parent id.
    rules: (r) => [
      r.requiredTogether("comment_id", "comment_uin"),
      r.requiredTogether("reply_uin", "reply_name"),
      r.rule(
        "reply_uin/reply_name require comment_id/comment_uin",
        (p) => p["reply_uin"] === undefined || p["comment_id"] !== undefined,
      ),
      // `images are not supported for comment replies` — the reply CGI has no
      // image support, and `QzoneApi.comment` also throws on the same combination.
      // Two guards for one rule is the reference's choice; the action-level one
      // turns it into a 1400 before any upload happens.
      r.rule(
        "images are not supported for comment replies",
        (p) => p["comment_id"] === undefined || ((p["images"] as string[] | undefined)?.length ?? 0) === 0,
      ),
      r.rule(
        "comment_id, reply_name and reply content must not be blank",
        (p) =>
          ((p["comment_id"] as string | undefined) === undefined ||
            ((p["comment_id"] as string).trim().length > 0 && (p["content"] as string).trim().length > 0)) &&
          ((p["reply_name"] as string | undefined) === undefined ||
            (p["reply_name"] as string).trim().length > 0),
      ),
      r.rule(
        "comment_uin and reply_uin must be safe integers",
        (p) =>
          ((p["comment_uin"] as number | undefined) === undefined ||
            Number.isSafeInteger(p["comment_uin"] as number)) &&
          ((p["reply_uin"] as number | undefined) === undefined ||
            Number.isSafeInteger(p["reply_uin"] as number)),
      ),
    ],
    run: async (p, ctx) => {
      // Branch 1: a reply. The uins become STRINGS on the reply argument — the
      // reply CGI's fields are strings, and `QzoneReplyTarget` says so.
      if (p.comment_id !== undefined && p.comment_uin !== undefined) {
        return okResponse(
          await ctx.bridge.apis.qzone.comment(
            p.tid,
            p.content,
            p.target_uin,
            undefined,
            undefined,
            {
              commentId: p.comment_id,
              commentUin: String(p.comment_uin),
              ...(p.reply_uin !== undefined && p.reply_name !== undefined
                ? { replyTo: { uin: String(p.reply_uin), name: p.reply_name } }
                : {}),
            },
          ),
        );
      }
      // Branch 2: a top-level comment with images. `url`, not `richval`.
      if (p.images && p.images.length > 0) {
        const richval = await uploadQzoneImages(ctx, p.images, (upload) => upload.url);
        return okResponse(await ctx.bridge.apis.qzone.comment(p.tid, p.content, p.target_uin, 1, richval));
      }
      // Branch 3: plain text.
      return okResponse(await ctx.bridge.apis.qzone.comment(p.tid, p.content, p.target_uin));
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ===========================================================================
// Blacklist
// ===========================================================================

qzoneActions.push(
  defineAction<{ user_id: number; enable: boolean }, ActionContext>({
    name: "set_qzone_ban",
    summary: "拉黑或解除拉黑某人（修改机器人自身 QQ 空间黑名单；enable=true 拉黑，false 解除）",
    params: {
      user_id: f.userId().describe("目标 QQ 号"),
      enable: f.bool().describe("true 拉黑，false 解除拉黑").default(true),
    },
    run: async (p, ctx) => {
      await ctx.bridge.apis.qzone.setBlack(p.user_id, p.enable);
      return okResponse(null);
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

export { qzoneActions };
export const QZONE_ACTION_COUNT = qzoneActions.length;