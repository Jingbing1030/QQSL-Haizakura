// 4.5 — the 擴展 (extended) family: 115 definitions, 121 executable names.
//
// Reference region: `../onebot/src/actions/extended.ts`
// (reference/index.mjs:11263-15686, 4,424 lines, `actions$6`).
//
// ---------------------------------------------------------------------------
// How this batch was sliced, and why the count is what it is
// ---------------------------------------------------------------------------
// 115 actions is too many to land at once without losing the ability to tell a real
// success from a plausible one. So the batch was split by *dependency closure*, and each
// slice was gated separately (`tsc` + the differential oracle) before the next began.
// The grouping below is measured, not editorial: it comes from extracting every `run`
// body and reading which `ctx.*` and `apis.*.*` names it actually touches.
//
//   A  self-contained (42)   every dependency already existed when the batch started.
//   B  + interaction/friend  the specs existed; only the bridge slice was missing.
//   C  + misc               five of nine implementations exist.
//   D  + groupFile/extras   `0x6d8`/`0x6d9`/`0x126e`/`0x929b`/`0x9474`/`0x0f90` exist.
//   E  + flashTransfer      all eleven wired, uploader included (`create_flash_task`).
//
// ---------------------------------------------------------------------------
// What "implemented" means here, stated before the numbers
// ---------------------------------------------------------------------------
// Three distinct states, and conflating them is what this header exists to prevent:
//
//   1. **Runs end-to-end against a live QQ.** The action's whole chain — action → hub
//      slice → OIDB spec → packet — exists in this port. No host injection needed.
//   2. **Faithful, but inert until the host injects a store.** The action body is a
//      transcription of the reference's, so its params, routing, failure wording and
//      response shape all match. What is missing is the `ctx.*` provider the reference
//      wires to its message/reaction store. Against a live QQ these throw or answer the
//      reference's own documented failure — they do NOT silently succeed.
//   3. **Blocked.** The provider the reference calls has no implementation here AND no
//      ported codec behind it, so there is nothing faithful to write. These are absent
//      from the registry, which means `resolve()` answers `undefined` and the dispatcher
//      answers `1404 unknown action` — the reference's own behaviour for an action it
//      does not have. Absent, never a stub that answers `{}`.
//
// The per-action state is recorded in `EXTENDED_ACTION_STATE` at the bottom of this
// file, so the count can be checked rather than trusted.
//
// ---------------------------------------------------------------------------
// The three things a reader is most likely to get wrong
// ---------------------------------------------------------------------------
// `okResponse()` vs `okResponse({})` vs `okResponse(null)`: nineteen of these actions
// are mutators whose data is `null`; `set_input_status`, `set_group_sign` and
// `send_packet`'s `rsp:false` are the exceptions and they are NOT interchangeable.
// Every one is asserted against the oracle.
//
// `delete_custom_face` is NOT blocked, unlike the previous batch's report. The
// `Faceroam.OpReq` codec lives in `service-codecs.ts` and `profile.deleteCustomFace`
// already works.
//
// `add_custom_face` is now LIVE. It was the one blocker on the Highway uploader, and
// that uploader exists: `profile.addCustomFace` does `loadBinarySource` → md5 →
// `ImgStore.BDHExpressionRoam` (token) → one `FavEmojiHighwayHead` POST with
// `commandId: 9` (a fourth cmdId namespace) → the computed `emoji_id`. The three
// codecs live in `oidb/services/0x902e-profile.ts`. Note that this is NOT
// `uploadHighway`: that path chunks at 1 MiB and verifies a `RespDataHighwayHead`
// the emoji store never sends.
//
// `get_forward_msg` is blocked on the HOST (`ctx.getForwardMsg`), not on the action
// layer — the action body is seven lines and is implemented here.

import {
  defineAction,
  f,
  groupAction,
  groupUserAction,
  okResponse,
  failedResponse,
  RETCODE,
  RULES,
  wording,
  type ActionSpec,
  type FieldImpl,
} from "./kit.js";
import type { ActionContext } from "./context.js";
import {
  DOWNLOAD_FILE_MAX_BYTES,
  downloadFileTimeoutMs,
  fetchDownloadFile,
  flashFileInfoToJson,
  groupTodoRun,
  integerFromDecimalString,
  optionalExactString,
  parseDownloadHeaders,
  parseFlashTaskFiles,
  primitiveText,
  projectEssenceMessage,
  readForwardPreviewMeta,
  saveDownloadBuffer,
} from "./extended-helpers.js";
import { formatFriend, formatGroupRequestFlag } from "./format.js";
import { GROUP_MESSAGE_EVENT, hashMessageIdInt32, hasAuthoritativeSequence } from "./message-id.js";

type Spec = ActionSpec<Record<string, unknown>, ActionContext>;
const spec = (s: unknown): Spec => s as Spec;

/** The forward-node field: an optional message whose content may carry reply previews. */
const forwardMessagesField: FieldImpl<unknown> = f
  .message()
  .optional()
  .describe(
    "转发节点数组；节点 content 内的 reply.data.message 可提供自定义引用内容（字符串或消息段），qq/time/seq 可选；仅用于转发内引用预览。",
  );

/** The preview block every forward sender accepts, in the reference's key order. */
const forwardPreviewParams = {
  source: f.string().optional(),
  summary: f.string().optional(),
  prompt: f.string().optional(),
  news: f.raw(),
} as const;

// The definitions. Order is the reference's, so a diff of the two lists is readable.
const all: Spec[] = [];
const push = (s: unknown): void => {
  all.push(spec(s));
};

// ===========================================================================
// Slice A — dependencies already present (42)
// ===========================================================================

push(
  defineAction<{ emoji_id: string }, ActionContext>({
    name: "delete_custom_face",
    summary: "删除收藏表情",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: { emoji_id: f.string({ allowEmpty: false }) },
    run: async (p, ctx) => {
      await ctx.bridge.apis.profile.deleteCustomFace(p.emoji_id);
      return okResponse();
    },
  }),
);

// --- read receipts ---------------------------------------------------------

push(
  defineAction<{ message_id: number; group_id?: number | undefined }, ActionContext>({
    name: "mark_group_msg_as_read",
    summary: "标记群消息已读",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      message_id: f.messageId(),
      group_id: f.groupId().optional(),
    },
    run: async (p, ctx) => {
      const meta = await ctx.getMessageMeta(p.message_id);
      if (!meta || !meta.isGroup) {
        return failedResponse(RETCODE.ACTION_FAILED, "message not found or not a group message");
      }
      if (p.group_id && p.group_id !== meta.targetId) {
        return failedResponse(RETCODE.BAD_REQUEST, "group_id does not match message session");
      }
      await ctx.bridge.apis.message.markGroupRead(meta.targetId);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ message_id: number; user_id?: number | undefined }, ActionContext>({
    name: "mark_private_msg_as_read",
    summary: "标记私聊消息已读",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      message_id: f.messageId(),
      user_id: f.userId().optional(),
    },
    run: async (p, ctx) => {
      const meta = await ctx.getMessageMeta(p.message_id);
      if (!meta || meta.isGroup) {
        return failedResponse(RETCODE.ACTION_FAILED, "message not found or not a private message");
      }
      if (p.user_id && p.user_id !== meta.targetId) {
        return failedResponse(RETCODE.BAD_REQUEST, "user_id does not match message session");
      }
      await ctx.bridge.apis.message.markPrivateRead(meta.targetId);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ message_id: number; target_id?: number | undefined }, ActionContext>({
    name: "mark_msg_as_read",
    summary: "标记消息已读（群聊/私聊自动路由）",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      message_id: f.messageId(),
      // ⚠️ `target_id`, not `group_id`/`user_id`: this action already routes by meta,
      // so the optional field is a CONSISTENCY CHECK, not a selector. Passing a
      // mismatching one is a 1400 rather than a re-route.
      target_id: f.uint().optional(),
    },
    run: async (p, ctx) => {
      const meta = await ctx.getMessageMeta(p.message_id);
      if (!meta) return failedResponse(RETCODE.ACTION_FAILED, "message not found");
      if (p.target_id && p.target_id !== meta.targetId) {
        return failedResponse(RETCODE.BAD_REQUEST, "target_id does not match message session");
      }
      if (meta.isGroup) await ctx.bridge.apis.message.markGroupRead(meta.targetId);
      else await ctx.bridge.apis.message.markPrivateRead(meta.targetId);
      return okResponse();
    },
  }),
);

// --- group notices --------------------------------------------------------

push(
  groupAction<
    {
      content: string;
      image: string;
      pinned: number;
      type?: number | undefined;
      send_to_new_members?: boolean | undefined;
      is_show_edit_card: number;
      tip_window_type: number;
      confirm_required: number;
    },
    ActionContext
  >({
    name: "_send_group_notice",
    summary: "发送群公告（支持置顶、弹窗、新成员、群昵称引导与确认）",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      content: f.string({ allowEmpty: false }).describe("公告正文"),
      // ⚠️ `default("")` on an IMAGE field. The empty default is then mapped to
      // `undefined` in `options` (`p.image || void 0`), which is what makes the field
      // genuinely optional on the wire while still being present in the schema.
      image: f.string().default("").role("image").describe("可选公告图片（本地路径、URL 或 base64）"),
      pinned: f.int({ min: 0, max: 1 }).default(0).describe("是否置顶：1=置顶，0=不置顶"),
      type: f.int().optional().describe("发布类型：1=普通公告，20=新成员公告；建议使用 send_to_new_members"),
      send_to_new_members: f.bool().optional().describe("是否在成员新加入群时发送（与 type=20 等价）"),
      is_show_edit_card: f.int({ min: 0, max: 1 }).default(1).describe("是否引导群成员修改群昵称：1=是，0=否"),
      // The reversed semantics are the server's, and the description is the reference's
      // own note about it.
      tip_window_type: f.int({ min: 0, max: 1 }).default(1).describe("弹窗展示：0=开启弹窗，1=关闭弹窗（QQ 原始字段为反向语义）"),
      confirm_required: f.int({ min: 0, max: 1 }).default(1).describe("是否需要群成员确认收到：1=是，0=否"),
    },
    // Two `rule`s, not field constraints: `type` and `send_to_new_members` are
    // REDUNDANT (both encode the same server bit) and the second rule is what stops a
    // caller from sending contradictory ones. Both messages are observable.
    rules: (r) => [
      r.rule("type must be 1 (regular) or 20 (new members)", (pr) => pr["type"] === undefined || pr["type"] === 1 || pr["type"] === 20),
      r.rule(
        "send_to_new_members conflicts with type",
        (pr) =>
          pr["send_to_new_members"] === undefined ||
          pr["type"] === undefined ||
          pr["type"] === (pr["send_to_new_members"] ? 20 : 1),
      ),
    ],
    run: async (p, ctx) => {
      // Every key is passed unconditionally, including the undefined ones — the provider
      // distinguishes undefined from absent, and `image: ""` becomes undefined here.
      await ctx.bridge.apis.web.sendNotice(p.group_id, p.content, {
        image: p.image || undefined,
        pinned: p.pinned,
        type: p.type,
        sendToNewMembers: p.send_to_new_members,
        isShowEditCard: p.is_show_edit_card,
        tipWindowType: p.tip_window_type,
        confirmRequired: p.confirm_required,
      });
      return okResponse();
    },
  }),
);

push(
  groupAction<Record<string, never>, ActionContext>({
    name: "_get_group_notice",
    summary: "获取群公告",
    returns: "普通公告与新成员公告的合并数组；send_to_new_members 标识后者；图片含 id、url、宽高",
    readOnly: true,
    params: {},
    run: async (p, ctx) => {
      return okResponse(await ctx.bridge.apis.web.getNotice(p.group_id));
    },
  }),
);

push(
  groupAction<{ fid?: string | undefined; notice_id?: string | undefined }, ActionContext>({
    name: "_del_group_notice",
    summary: "删除群公告（fid 或 notice_id 二选一）",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      fid: f.string().optional(),
      notice_id: f.string().optional(),
    },
    run: async (p, ctx) => {
      const fid = p.fid || p.notice_id;
      if (!fid) return failedResponse(RETCODE.BAD_REQUEST, "group_id and fid/notice_id are required");
      return (await ctx.bridge.apis.web.deleteNotice(p.group_id, fid))
        ? okResponse()
        : failedResponse(RETCODE.ACTION_FAILED, "delete failed");
    },
  }),
);

// --- credentials ----------------------------------------------------------

push(
  defineAction<{ domain?: string | undefined }, ActionContext>({
    name: "get_cookies",
    summary: "获取 cookie 字符串",
    readOnly: true,
    returns: "cookies 字符串",
    params: { domain: f.string().default("qun.qq.com") },
    // ⚠️ `{ cookies: "..." }`, not the bare string.
    run: async (p, ctx) => {
      return okResponse({ cookies: await ctx.bridge.apis.web.getCookiesStr(p.domain || "qun.qq.com") });
    },
  }),
);

push(
  defineAction<Record<string, never>, ActionContext>({
    name: "get_csrf_token",
    summary: "获取 csrf token（bkn）",
    readOnly: true,
    returns: "csrf token",
    params: {},
    // ⚠️ `{ token }`, not the bare number.
    run: async (_p, ctx) => {
      return okResponse({ token: await ctx.bridge.apis.web.getCsrfToken() });
    },
  }),
);

push(
  defineAction<{ domain?: string | undefined }, ActionContext>({
    name: "get_credentials",
    summary: "获取 cookie / bkn / skey / pskey / clientKey",
    readOnly: true,
    returns: "凭据集合",
    params: { domain: f.string().default("qun.qq.com") },
    run: async (p, ctx) => {
      return okResponse(await ctx.bridge.apis.web.getCredentials(p.domain || "qun.qq.com"));
    },
  }),
);

push(
  defineAction<Record<string, never>, ActionContext>({
    name: "get_clientkey",
    summary: "获取 clientkey",
    readOnly: true,
    params: {},
    run: async (_p, ctx) => {
      const clientKeyInfo = await ctx.bridge.apis.web.forceFetchClientKey();
      if (!clientKeyInfo.clientKey) return failedResponse(RETCODE.ACTION_FAILED, "get clientkey error");
      return okResponse({ ...clientKeyInfo });
    },
  }),
);

// --- process control (both are the reference's own placeholders) -----------

push(
  defineAction<Record<string, never>, ActionContext>({
    name: "set_restart",
    summary: "重启（不支持）",
    params: {},
    // ⚠️ `failedResponse(100, "not supported")`, NOT `okResponse()`. The reference does
    // not implement restart and says so; a port that answered ok would tell a client the
    // process is restarting when nothing happens. `bot_exit` is the action that really
    // exits, and the two are not interchangeable.
    run: () => failedResponse(RETCODE.ACTION_FAILED, "not supported"),
  }),
);

push(
  defineAction<Record<string, never>, ActionContext>({
    name: "clean_cache",
    summary: "清理缓存（占位）",
    params: {},
    run: () => okResponse(),
  }),
);

push(
  defineAction<Record<string, never>, ActionContext>({
    name: "bot_exit",
    summary: "退出机器人",
    params: {},
    run: () => {
      setTimeout(() => process.exit(0), 50);
      return okResponse();
    },
  }),
);

// --- url safety -----------------------------------------------------------

push(
  defineAction<Record<string, never>, ActionContext>({
    name: "check_url_safely",
    summary: "检查链接安全性",
    readOnly: true,
    returns: "一律放行；实现未接入安全网关",
    params: {},
    // Reference body: `run: () => okResponse({ level: 1 })`. The value is a CONSTANT —
    // it does not inspect `url`. A port that "improved" this would answer a different
    // level for the same input, which the oracle catches.
    run: () => okResponse({ level: 1 }),
  }),
);

// --- self profile ---------------------------------------------------------

push(
  defineAction<
    { nickname?: string | undefined; personal_note?: string | undefined; sex?: number | undefined },
    ActionContext
  >({
    name: "set_qq_profile",
    summary: "设置账号资料",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      nickname: f.string().optional(),
      personal_note: f.string().optional(),
      sex: f.int({ min: 0, max: 2 }).optional(),
    },
    // ⚠️ NO cross-field rule. An all-absent call reaches the provider and the server
    // decides — the reference deliberately does not refuse it, and adding a rule here
    // would 1400 a request the reference forwards.
    run: async (p, ctx) => {
      await ctx.bridge.apis.profile.setProfile(p.nickname, p.personal_note, p.sex);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ status: number; ext_status?: number | undefined; battery_status?: number | undefined }, ActionContext>({
    name: "set_online_status",
    summary: "设置在线状态",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      // `nonZero: true` — status 0 is not a valid presence, so it is a 1400 rather than
      // being forwarded for the server to reject.
      status: f.int({ nonZero: true }),
      ext_status: f.int({ min: 0 }).default(0),
      battery_status: f.int({ min: 0 }).default(100),
    },
    run: async (p, ctx) => {
      await ctx.bridge.apis.profile.setOnlineStatus(p.status, p.ext_status, p.battery_status);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ face_id: number; face_type: number; wording: string }, ActionContext>({
    name: "set_diy_online_status",
    summary: "设置自定义在线状态",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      // `f.faceId()`, not `int({min:0})` — the type name differs in `describe()`, and
      // the comment is the only machine-visible difference between the two.
      face_id: f.faceId(),
      face_type: f.int({ min: 0 }).default(1),
      wording: f.string().default(""),
    },
    // ⚠️ Argument order at the call is (face_id, wording, face_type) while the PARAM
    // order is face_id, face_type, wording. Swapping them silently posts the wrong face.
    run: async (p, ctx) => {
      await ctx.bridge.apis.profile.setDiyOnlineStatus(p.face_id, p.wording, p.face_type);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ longNick?: string | undefined; long_nick?: string | undefined }, ActionContext>({
    name: "set_self_longnick",
    summary: "设置个性签名（longNick/long_nick，严格 string）",
    returns: "成功时为空对象 {}，不是 null",
    // TWO spellings of the same field, `longNick` first. Historical clients send either;
    // `longNick` wins when both are present.
    params: {
      longNick: optionalExactString(),
      long_nick: optionalExactString(),
    },
    run: async (p, ctx) => {
      const longNick = p.longNick !== undefined ? p.longNick : p.long_nick;
      // `typeof !== "string"` — an omitted value is NOT "" here; it is 1400. That
      // refusal is why `setSelfLongNick("")` is unreachable from this action.
      if (typeof longNick !== "string") return failedResponse(RETCODE.BAD_REQUEST, "invalid longNick");
      await ctx.bridge.apis.profile.setSelfLongNick(longNick);
      // ⚠️ `okResponse({})`, not `okResponse()` — the third non-null mutator.
      return okResponse({});
    },
  }),
);

push(
  defineAction<{ user_id: number; event_type: number }, ActionContext>({
    name: "set_input_status",
    summary: "设置输入状态",
    returns: "成功时为空对象 {}，不是 null",
    params: {
      user_id: f.userId(),
      event_type: f.int().default(0),
    },
    // ⚠️ `okResponse({})`, not `okResponse()` — the reference's returnsSchema says
    // 「成功时为空对象 {}，不是 null」. One of only three non-null mutator data values.
    run: async (p, ctx) => {
      await ctx.bridge.apis.profile.setInputStatus(p.user_id, p.event_type);
      return okResponse({});
    },
  }),
);

// --- group reads ---------------------------------------------------------

push(
  groupAction<Record<string, never>, ActionContext>({
    name: "get_group_shut_list",
    summary: "获取群禁言列表",
    readOnly: true,
    params: {},
    run: async (p, ctx) => {
      const members = await ctx.bridge.apis.contacts.fetchGroupMemberList(p.group_id);
      const nowSec = Math.floor(Date.now() / 1000);
      return okResponse(
        members
          .filter((m) => (m.shutUpTime ?? 0) > nowSec)
          .map((m) => ({ user_id: m.uin, nickname: m.nickname, shut_up_time: m.shutUpTime })),
      );
    },
  }),
);

push(
  groupAction<Record<string, never>, ActionContext>({
    name: "get_group_signed_list",
    summary: "获取群今日打卡列表",
    readOnly: true,
    params: {},
    run: async (p, ctx) => {
      return okResponse(await ctx.bridge.apis.web.getSignedList(p.group_id));
    },
  }),
);

push(
  defineAction<Record<string, never>, ActionContext>({
    name: "get_group_ignored_notifies",
    summary: "获取被过滤的入群请求",
    readOnly: true,
    params: {},
    run: async (_p, ctx) => {
      // `fetchFilteredGroupRequests(ctx)` is `fetchGroupRequests(true)` — the FILTERED
      // inbox, not the pending one. Reading the wrong inbox answers an empty list on a
      // healthy account, so the `true` is the whole contract.
      //
      // The rows are the FLAT shape (see `FilteredGroupRequestRow`): `request_id` is the
      // raw sequence (a number, not a string), and `actor` is `operatorUin` — the
      // operator who handled it, NOT the invitor.
      const rows = await ctx.bridge.apis.contacts.fetchFilteredGroupRequests!();
      return okResponse(
        rows.map((r) => ({
          group_id: r.groupId,
          group_name: r.groupName,
          request_id: r.sequence,
          requester_uin: r.targetUin,
          requester_nick: r.targetName,
          message: r.comment,
          checked: r.state !== 1,
          actor: r.operatorUin,
          invitor_uin: r.invitorUin,
          invitor_nick: r.invitorName,
          flag: formatGroupRequestFlag(r),
        })),
      );
    },
  }),
);

push(
  defineAction<Record<string, never>, ActionContext>({
    name: "get_group_ignore_add_request",
    summary: "获取被忽略的入群请求（NapCat）",
    readOnly: true,
    params: {},
    run: async (_p, ctx) => {
      const rows = await ctx.bridge.apis.contacts.fetchFilteredGroupRequests!();
      // Same inbox as above but a DIFFERENT projection: no `flag`, no `requester_uin`,
      // and no `invitor_nick`… the keys are the same SET minus `flag`/`requester_uin`
      // but the ORDER differs and `request_id` is the raw sequence. The two shapes are
      // not interchangeable, which is why they are not shared.
      return okResponse(
        rows.map((r) => ({
          request_id: r.sequence,
          invitor_uin: r.invitorUin,
          invitor_nick: r.invitorName,
          group_id: r.groupId,
          message: r.comment,
          group_name: r.groupName,
          checked: r.state !== 1,
          actor: r.operatorUin,
          requester_nick: r.targetName,
        })),
      );
    },
  }),
);

push(
  groupAction<{ no_cache: boolean }, ActionContext>({
    name: "get_group_info_ex",
    summary: "获取群信息（扩展）",
    readOnly: true,
    params: { no_cache: f.bool().default(false) },
    run: async (p, ctx) => {
      if (ctx.getGroupInfo) return okResponse(await ctx.getGroupInfo(p.group_id, p.no_cache));
      return failedResponse(RETCODE.ACTION_FAILED, "not implemented");
    },
  }),
);

push(
  groupAction<{ no_cache: boolean }, ActionContext>({
    name: "get_group_detail_info",
    summary: "获取群详细信息",
    readOnly: true,
    params: { no_cache: f.bool().default(false) },
    run: async (p, ctx) => {
      if (ctx.getGroupInfo) return okResponse(await ctx.getGroupInfo(p.group_id, p.no_cache));
      return failedResponse(RETCODE.ACTION_FAILED, "not implemented");
    },
  }),
);

// --- likes / stickers ----------------------------------------------------

push(
  defineAction<{ user_id: number; start: number; count: number }, ActionContext>({
    name: "get_profile_like",
    summary: "获取资料点赞",
    readOnly: true,
    params: {
      // ⚠️ `int({min:0}).default(0)`, NOT `userId()`: 0 means "myself" and is the
      // default. A `userId()` here would make the no-argument call a 1400.
      user_id: f.int({ min: 0 }).default(0).role("user_id"),
      start: f.int({ min: 0 }).default(0),
      count: f.int({ min: 0 }).default(10),
    },
    run: async (p, ctx) => {
      return okResponse(await ctx.bridge.apis.profile.getLike(p.user_id, p.start, p.count));
    },
  }),
);

push(
  defineAction<{ count: number; return_type: string }, ActionContext>({
    name: "fetch_custom_face",
    summary: "获取自定义表情",
    readOnly: true,
    returns: "字符串数组：return_type=url 时为图片 URL，return_type=id 时为 emoji_id。",
    params: {
      count: f.int({ min: 0 }).default(10),
      return_type: f.string().default("url"),
    },
    run: async (p, ctx) => {
      // Strict equality, not a truthiness test: `return_type: "URL"` is a url request
      // and falls through, which is the reference's behaviour.
      if (p.return_type === "id") return okResponse(await ctx.bridge.apis.profile.fetchCustomFaceIds(p.count));
      return okResponse(await ctx.bridge.apis.profile.fetchCustomFace(p.count));
    },
  }),
);

// --- placeholders the reference ships as-is ------------------------------

push(
  defineAction<{ count: number }, ActionContext>({
    name: "get_recent_contact",
    summary: "获取最近会话（占位）",
    readOnly: true,
    returns: "一律返回空数组",
    params: { count: f.int({ min: 0 }).default(10) },
    run: () => okResponse([]),
  }),
);

push(
  defineAction<{ model: string }, ActionContext>({
    name: "_get_model_show",
    summary: "获取机型展示（兼容 mock）",
    readOnly: true,
    params: { model: f.string().default("") },
    run: async (p) => okResponse([{ variants: { model_show: p.model || "snowluma", need_pay: false } }]),
  }),
);

push(
  defineAction<Record<string, never>, ActionContext>({
    name: "_set_model_show",
    summary: "设置机型展示（占位）",
    params: {},
    run: () => okResponse(),
  }),
);

push(
  defineAction<Record<string, never>, ActionContext>({
    name: "nc_get_packet_status",
    summary: "获取 packet 状态（占位）",
    readOnly: true,
    params: {},
    run: () => okResponse(null),
  }),
);

push(
  defineAction<Record<string, never>, ActionContext>({
    name: "create_collection",
    summary: "创建收藏（未实现）",
    params: {},
    // The reference's body is `failedResponse(100, "not yet implemented")`. This is a
    // deliberate non-implementation, not a missing one — reproduced verbatim so a
    // client sees the same retcode it would see from the bundle.
    run: () => failedResponse(RETCODE.ACTION_FAILED, "not yet implemented"),
  }),
);

push(
  defineAction<Record<string, never>, ActionContext>({
    name: ".get_word_slices",
    summary: "分词（未实现）",
    readOnly: true,
    params: {},
    run: () => failedResponse(RETCODE.ACTION_FAILED, "not yet implemented"),
  }),
);

// --- ark shares -----------------------------------------------------------

push(
  defineAction<{ user_id?: number | undefined; group_id?: number | undefined; phone_number: string }, ActionContext>({
    name: "share_peer",
    summary: "分享用户/群 Ark 卡片",
    readOnly: true,
    params: {
      user_id: f.userId().optional(),
      group_id: f.groupId().optional(),
      phone_number: f.string().default(""),
    },
    run: async (p, ctx) => {
      // Group wins over user when BOTH are given — the reference tests group first and
      // returns, so a caller passing both gets the group card, not an error.
      if (p.group_id) return okResponse({ arkMsg: await ctx.bridge.apis.contacts.getGroupRecommendArk(p.group_id) });
      if (p.user_id) {
        return okResponse({ arkMsg: await ctx.bridge.apis.contacts.getBuddyRecommendArk(p.user_id, p.phone_number) });
      }
      return failedResponse(RETCODE.BAD_REQUEST, "user_id or group_id is required");
    },
  }),
);

push(
  defineAction<{ user_id?: number | undefined; group_id?: number | undefined; phone_number: string }, ActionContext>({
    name: "send_ark_share",
    summary: "分享用户/群 Ark 卡片（NapCat 标准名）",
    readOnly: true,
    params: {
      user_id: f.userId().optional(),
      group_id: f.groupId().optional(),
      phone_number: f.string().default(""),
    },
    run: async (p, ctx) => {
      if (p.group_id) return okResponse({ arkMsg: await ctx.bridge.apis.contacts.getGroupRecommendArk(p.group_id) });
      if (p.user_id) {
        return okResponse({ arkMsg: await ctx.bridge.apis.contacts.getBuddyRecommendArk(p.user_id, p.phone_number) });
      }
      return failedResponse(RETCODE.BAD_REQUEST, "user_id or group_id is required");
    },
  }),
);

push(
  defineAction<{ group_id: number }, ActionContext>({
    name: "share_group_ex",
    summary: "分享群 Ark 卡片",
    readOnly: true,
    params: { group_id: f.groupId() },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.contacts.getGroupRecommendArk(p.group_id)),
  }),
);

push(
  defineAction<{ group_id: number }, ActionContext>({
    name: "send_group_ark_share",
    summary: "分享群 Ark 卡片（NapCat 标准名）",
    readOnly: true,
    params: { group_id: f.groupId() },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.contacts.getGroupRecommendArk(p.group_id)),
  }),
);

// --- collection ----------------------------------------------------------

push(
  defineAction<{ category: number; count: number }, ActionContext>({
    name: "get_collection_list",
    summary: "获取收藏列表",
    readOnly: true,
    params: {
      category: f.int({ min: 0 }).describe("收藏分类 ID；0 表示全部分类").default(0),
      count: f.int({ min: 1, max: 500 }).describe("最多返回的收藏数量").default(50),
    },
    run: async (p, ctx) => {
      return okResponse(await ctx.bridge.apis.collection.list(p.category, p.count));
    },
  }),
);

// --- friend dress --------------------------------------------------------

push(
  defineAction<{ user_id: number }, ActionContext>({
    name: "_get_friend_dress",
    summary: "获取指定 QQ 号正在使用的个性装扮（挂件/名片/来电/输入状态等）",
    readOnly: true,
    returns:
      "装扮信息；目标未使用任何可查询装扮时 items 为空数组。网络失败、未登录态/风控、页面改版、返回账号与请求不一致时返回失败并附具体原因",
    params: { user_id: f.userId().describe("目标 QQ 号") },
    run: async (p, ctx) => {
      try {
        return okResponse(await ctx.bridge.apis.web.getFriendDress(p.user_id));
      } catch (e) {
        // `FriendDressError` carries a `kind` that distinguishes network / parse /
        // structure / uin_mismatch. The kind is preserved in the wording because a
        // caller retries `network` and must not retry `uin_mismatch` — folding the two
        // into one message loses the only actionable bit.
        if (e instanceof Error && e.name === "FriendDressError") {
          const kind = (e as Error & { kind?: string }).kind ?? "unknown";
          return failedResponse(RETCODE.ACTION_FAILED, `failed to get friend dress (${kind}): ${e.message}`);
        }
        return failedResponse(RETCODE.ACTION_FAILED, `failed to get friend dress: ${(e as Error).message}`);
      }
    },
  }),
);

// --- media / file reads -------------------------------------------------

push(
  defineAction<{ file: string; file_id: string }, ActionContext>({
    name: "get_image",
    summary: "获取图片信息",
    readOnly: true,
    params: {
      file: f.string().default(""),
      file_id: f.string().default(""),
    },
    run: async (p, ctx) => {
      // `p.file || p.file_id` — `file` wins, and an empty `file` falls through to
      // `file_id` rather than being taken literally.
      const file = p.file || p.file_id;
      if (!file) return failedResponse(RETCODE.BAD_REQUEST, "file is required");
      const info = await ctx.getImageInfo?.(file);
      if (info) return okResponse(info);
      return failedResponse(RETCODE.ACTION_FAILED, "image not found in cache");
    },
  }),
);

push(
  defineAction<{ file: string; file_id: string }, ActionContext>({
    name: "get_file",
    summary: "获取文件（仅限图片/语音缓存）",
    readOnly: true,
    params: {
      file_id: f.string().default(""),
      file: f.string().default(""),
    },
    run: async (p, ctx) => {
      const fileId = p.file || p.file_id;
      if (!fileId) return failedResponse(RETCODE.BAD_REQUEST, "file_id is required");
      const image = await ctx.getImageInfo?.(fileId);
      if (image) return okResponse(image);
      const record = await ctx.getRecordInfo?.(fileId);
      if (record) return okResponse(record);
      return failedResponse(
        RETCODE.ACTION_FAILED,
        "file_id not found in the image/voice cache. get_file only resolves cached image/voice ids; for group/normal files use get_group_file_url or get_private_file_url",
      );
    },
  }),
);

push(
  defineAction<{ image: string }, ActionContext>({
    name: ["ocr_image", ".ocr_image"],
    summary: "OCR 图片（服务端，需图片 URL 或已缓存的图片 file_id）",
    readOnly: true,
    params: { image: f.image() },
    run: async (p, ctx) => {
      // An http(s) argument is used AS-IS; anything else is treated as a cached file id.
      let url = /^https?:\/\//i.test(p.image) ? p.image : "";
      if (!url) {
        const info = await ctx.getImageInfo?.(p.image);
        const resolved = info && typeof info.url === "string" ? info.url : "";
        if (resolved) url = resolved;
      }
      if (!url) {
        return failedResponse(
          RETCODE.ACTION_FAILED,
          "ocr_image needs an http(s) image url or a cached image file_id; base64/local-file input is not supported",
        );
      }
      return okResponse(await ctx.bridge.apis.misc.ocrImage(url));
    },
  }),
);

push(
  defineAction<{ file: string; file_id: string; out_format?: string | undefined }, ActionContext>({
    name: "get_record",
    summary: "获取语音信息；传 out_format 则服务端转码并附带 base64",
    readOnly: true,
    returns:
      "语音信息（file/url 为向 QQ 获取的当前下载地址）；资源元数据缺失或远端获取失败时返回错误。out_format 指定时附带转码后的 base64。",
    params: {
      file: f.string().default(""),
      file_id: f.string().default(""),
      out_format: f.enum("mp3", "amr", "wma", "m4a", "spx", "ogg", "wav", "flac").optional(),
    },
    run: async (p, ctx) => {
      const file = p.file || p.file_id;
      if (!file) return failedResponse(RETCODE.BAD_REQUEST, "file is required");
      const info = await ctx.getRecordInfo?.(file);
      if (!info) return failedResponse(RETCODE.ACTION_FAILED, "record not found in cache");
      if (!p.out_format) return okResponse(info);
      const source = String(info.url || info.file || "");
      if (!source) return failedResponse(RETCODE.ACTION_FAILED, "record has no downloadable source");
      try {
        const { base64 } = await ctx.bridge.apis.extras.convertRecord(source, p.out_format);
        return okResponse({ ...info, out_format: p.out_format, base64 });
      } catch (e) {
        // The wording is Chinese here and English everywhere else in this action —
        // that asymmetry is the reference's.
        return failedResponse(
          RETCODE.ACTION_FAILED,
          `语音转码失败：${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
  }),
);

push(
  defineAction<{ message_id: number }, ActionContext>({
    name: ["fetch_ptt_text", "get_ptt_text", "get_record_text"],
    summary: "获取语音转文字结果",
    readOnly: true,
    params: { message_id: f.messageId() },
    // ⚠️ UNGUARDED in the reference: `ctx.fetchPttText` is called directly, so a host
    // without an ASR provider throws a TypeError. Declared optional here so the ~40
    // unrelated hosts are not forced to supply it, but called unguarded so the failure
    // is the reference's.
    run: async (p, ctx) => okResponse(await ctx.fetchPttText?.(p.message_id)),
  }),
);

push(
  defineAction<{ url: string; base64: string; name: string; headers?: unknown }, ActionContext>({
    name: "download_file",
    summary: "下载文件（url 或 base64）到 data/downloads",
    params: {
      url: f.string().default(""),
      base64: f.string().default(""),
      name: f.string().default(""),
      headers: f.raw(),
    },
    run: async (p) => {
      // ⚠️ `base64` IS a second input, not a decoration: a caller with no URL writes
      // bytes directly. And when both are given base64 WINS — no fetch happens.
      if (!p.url && !p.base64) return failedResponse(RETCODE.BAD_REQUEST, "url or base64 is required");
      let buf: Buffer;
      if (p.base64) {
        // Two size checks again: the DECODED length is not known until decode, so the
        // cheap upper bound (`length * 3/4`) runs first to avoid allocating a 4 GiB
        // string for a hostile input.
        if (Math.floor((p.base64.length * 3) / 4) > DOWNLOAD_FILE_MAX_BYTES) {
          return failedResponse(
            RETCODE.BAD_REQUEST,
            `base64 payload too large: > ${String(DOWNLOAD_FILE_MAX_BYTES)} bytes`,
          );
        }
        buf = Buffer.from(p.base64, "base64");
        if (buf.length > DOWNLOAD_FILE_MAX_BYTES) {
          return failedResponse(
            RETCODE.BAD_REQUEST,
            `base64 payload too large: ${String(buf.length)} > ${String(DOWNLOAD_FILE_MAX_BYTES)} bytes`,
          );
        }
      } else {
        // ⚠️ NO try/catch around the FETCH: a network failure throws out of `run` and
        // `dispatchAction` maps it to 100. Only the SAVE is caught, and its failure is a
        // 1400 because a bad `name` is a parameter error.
        buf = await fetchDownloadFile(p.url, parseDownloadHeaders(p.headers), DOWNLOAD_FILE_MAX_BYTES, downloadFileTimeoutMs());
      }
      try {
        // ⚠️ `{ file }` ONLY — no `file_name`/`file_size`. The extra keys I first
        // wrote are not the reference's response shape.
        return okResponse({ file: await saveDownloadBuffer(buf, p.name) });
      } catch (err) {
        return failedResponse(RETCODE.BAD_REQUEST, err instanceof Error ? err.message : String(err));
      }
    },
  }),
);

// --- forward (blocked on the HOST, not the action layer) -----------------

push(
  defineAction<{ messages?: unknown; message?: unknown; group_id?: number | undefined }, ActionContext>({
    name: "upload_forward_msg",
    summary: "上传转发消息",
    params: {
      messages: forwardMessagesField,
      message: forwardMessagesField,
      group_id: f.groupId().optional(),
    },
    run: async (p, ctx) => {
      const messages = p.messages ?? p.message;
      const groupId = p.group_id ?? 0;
      if (messages === undefined) return failedResponse(RETCODE.BAD_REQUEST, "message/messages is required");
      const result = await ctx.sendForwardMsg?.(messages, groupId > 0 ? groupId : undefined);
      if (!result) return failedResponse(RETCODE.ACTION_FAILED, "forward upload is unavailable");
      // ⚠️ `message_id: 0` is HARD-CODED: `upload` returns a resource id only, and a
      // caller must not treat 0 as a sent message. The returnsSchema says so.
      const data: Record<string, unknown> = {
        res_id: result.forwardId,
        forward_id: result.forwardId,
        message_id: 0,
      };
      if (groupId > 0) data["group_id"] = groupId;
      return okResponse(data);
    },
  }),
);

push(
  defineAction<{ messages?: unknown; message?: unknown; group_id?: number | undefined }, ActionContext>({
    name: "upload_foward_msg",
    summary: "上传转发消息（别名拼写）",
    params: {
      messages: forwardMessagesField,
      message: forwardMessagesField,
      group_id: f.groupId().optional(),
    },
    // The misspelled historical name, kept because clients use it. Its body differs
    // from `upload_forward_msg` in ONE way: it never echoes `group_id` back, even when
    // one was passed. That is the reference's bug and it is observable.
    run: async (p, ctx) => {
      const messages = p.messages ?? p.message;
      const groupId = p.group_id ?? 0;
      if (messages === undefined) return failedResponse(RETCODE.BAD_REQUEST, "message/messages is required");
      const result = await ctx.sendForwardMsg?.(messages, groupId > 0 ? groupId : undefined);
      if (!result) return failedResponse(RETCODE.ACTION_FAILED, "forward upload is unavailable");
      return okResponse({ res_id: result.forwardId, forward_id: result.forwardId, message_id: 0 });
    },
  }),
);

push(
  defineAction<
    {
      messages?: unknown;
      message?: unknown;
      message_type?: string | undefined;
      group_id?: number | undefined;
      user_id?: number | undefined;
      source?: string | undefined;
      summary?: string | undefined;
      prompt?: string | undefined;
      news?: unknown;
    },
    ActionContext
  >({
    name: "send_forward_msg",
    summary: "发送合并转发（按 message_type/群号自动路由）",
    params: {
      messages: forwardMessagesField,
      message: forwardMessagesField,
      message_type: f.string().optional(),
      // ⚠️ `int({min:0})`, not `groupId()`: 0 means "unset" here and must not be a 1400.
      group_id: f.int({ min: 0 }).optional(),
      user_id: f.int({ min: 0 }).optional(),
      ...forwardPreviewParams,
    },
    run: async (p, ctx) => {
      const messageType = p.message_type ?? "";
      const groupId = p.group_id ?? 0;
      const userId = p.user_id ?? 0;
      const messages = p.messages ?? p.message;
      const meta = readForwardPreviewMeta(p);
      if (messages === undefined) return failedResponse(RETCODE.BAD_REQUEST, "message/messages is required");
      if ((messageType === "group" || groupId > 0) && ctx.sendGroupForwardMsg) {
        if (!groupId) return failedResponse(RETCODE.BAD_REQUEST, "group_id is required");
        const result = await ctx.sendGroupForwardMsg(groupId, messages, meta);
        return okResponse({ message_id: result.messageId, res_id: result.forwardId, forward_id: result.forwardId });
      }
      if ((messageType === "private" || userId > 0) && ctx.sendPrivateForwardMsg) {
        if (!userId) return failedResponse(RETCODE.BAD_REQUEST, "user_id is required");
        const result = await ctx.sendPrivateForwardMsg(userId, messages, meta);
        return okResponse({ message_id: result.messageId, res_id: result.forwardId, forward_id: result.forwardId });
      }
      // The fallback is UPLOAD-ONLY and answers `message_id: 0`. Note it is reached when
      // a group send was requested but `sendGroupForwardMsg` is absent — so a host
      // missing the provider gets a successful upload, not a failure. That is the
      // reference's own degradation and it is reproduced rather than tightened.
      const result = await ctx.sendForwardMsg?.(messages);
      if (!result) return failedResponse(RETCODE.ACTION_FAILED, "forward upload is unavailable");
      return okResponse({ message_id: 0, res_id: result.forwardId, forward_id: result.forwardId });
    },
  }),
);

push(
  groupAction<
    {
      messages?: unknown;
      message?: unknown;
      source?: string | undefined;
      summary?: string | undefined;
      prompt?: string | undefined;
      news?: unknown;
    },
    ActionContext
  >({
    name: "send_group_forward_msg",
    summary: "发送群合并转发",
    params: {
      messages: forwardMessagesField,
      message: forwardMessagesField,
      ...forwardPreviewParams,
    },
    run: async (p, ctx) => {
      const messages = p.messages ?? p.message;
      if (messages === undefined) return failedResponse(RETCODE.BAD_REQUEST, "message/messages is required");
      // ⚠️ UNGUARDED — no `?.` and no fallback. The reference calls the provider
      // directly, so a host without it throws (→ 100). An "is unavailable" branch here
      // would invent a response the reference never sends.
      const result = await ctx.sendGroupForwardMsg!(p.group_id, messages, readForwardPreviewMeta(p));
      return okResponse({ message_id: result.messageId, res_id: result.forwardId, forward_id: result.forwardId });
    },
  }),
);

push(
  defineAction<
    {
      user_id: number;
      messages?: unknown;
      message?: unknown;
      source?: string | undefined;
      summary?: string | undefined;
      prompt?: string | undefined;
      news?: unknown;
    },
    ActionContext
  >({
    name: "send_private_forward_msg",
    summary: "发送私聊合并转发",
    params: {
      user_id: f.userId(),
      messages: forwardMessagesField,
      message: forwardMessagesField,
      ...forwardPreviewParams,
    },
    run: async (p, ctx) => {
      const messages = p.messages ?? p.message;
      if (messages === undefined) return failedResponse(RETCODE.BAD_REQUEST, "message/messages is required");
      // UNGUARDED for the same reason as `send_group_forward_msg`.
      const result = await ctx.sendPrivateForwardMsg!(p.user_id, messages, readForwardPreviewMeta(p));
      return okResponse({ message_id: result.messageId, res_id: result.forwardId, forward_id: result.forwardId });
    },
  }),
);

push(
  defineAction<{ id?: string | undefined; message_id?: string | undefined }, ActionContext>({
    name: "get_forward_msg",
    summary: "获取合并转发消息（id 或 message_id）",
    readOnly: true,
    params: {
      id: f.string().optional(),
      // STRING, not `messageId()`: the decimal id is a hint used to look the message up
      // locally, and a non-numeric value falls through to being used as the resource id
      // itself. A numeric field would 1400 on the very input the fallback exists for.
      message_id: f.string().optional(),
    },
    run: async (p, ctx) => {
      let id = p.id || "";
      if (!id && p.message_id !== undefined) {
        const numericMessageId = integerFromDecimalString(p.message_id);
        if (numericMessageId > 0) {
          // Walk the stored message for a `forward` segment and read the resource id out
          // of its `data`. All three key spellings are accepted because the send path
          // has emitted each of them at some point.
          const event = await ctx.getMessage(numericMessageId);
          const segments = Array.isArray(event?.message) ? event.message : [];
          for (const seg of segments) {
            if (typeof seg !== "object" || seg === null || Array.isArray(seg)) continue;
            const so = seg as Record<string, unknown>;
            if (String(so["type"] ?? "") !== "forward") continue;
            const data =
              typeof so["data"] === "object" && so["data"] !== null && !Array.isArray(so["data"])
                ? (so["data"] as Record<string, unknown>)
                : null;
            const candidate =
              primitiveText(data?.["id"]) || primitiveText(data?.["res_id"]) || primitiveText(data?.["forward_id"]);
            if (candidate) {
              id = candidate;
              break;
            }
          }
        }
        // Fallback: the raw string IS the id. So `get_forward_msg` on an id whose message
        // is not cached still works when the caller passes the resource id directly.
        if (!id) id = p.message_id;
      }
      if (!id) return failedResponse(RETCODE.BAD_REQUEST, "id or message_id is required");
      // 🚫 Blocked on the HOST: `ctx.getForwardMsg` is `getForwardMessage` in
      // `forward.ts` (reference:194600), which decodes `SsoRecvLongMsg` and walks nodes.
      // The ACTION body above is the reference's.
      return okResponse({ messages: await ctx.getForwardMsg?.(id) });
    },
  }),
);

// --- singles ------------------------------------------------------------

push(
  defineAction<{ message_id: number; user_id: number }, ActionContext>({
    name: "forward_friend_single_msg",
    summary: "转发单条消息到私聊",
    params: { message_id: f.messageId(), user_id: f.userId() },
    run: async (p, ctx) => {
      // ⚠️ UNGUARDED, and the property read is INSIDE the call expression — so an
      // absent provider throws before `okResponse` is even reached.
      return okResponse({ message_id: (await ctx.forwardSingleMsg!(p.message_id, { userId: p.user_id })).messageId });
    },
  }),
);

push(
  defineAction<{ message_id: number; group_id: number }, ActionContext>({
    name: "forward_group_single_msg",
    summary: "转发单条消息到群聊",
    params: { message_id: f.messageId(), group_id: f.groupId() },
    run: async (p, ctx) => {
      return okResponse({ message_id: (await ctx.forwardSingleMsg!(p.message_id, { groupId: p.group_id })).messageId });
    },
  }),
);

// --- raw packet ---------------------------------------------------------

push(
  defineAction<{ cmd: string; data: string; rsp: boolean }, ActionContext>({
    name: ["send_packet", ".send_packet"],
    summary: "发送原始 SSO 包（cmd + hex data）",
    params: {
      cmd: f.string({ allowEmpty: false }),
      data: f.string().default(""),
      rsp: f.bool().default(true),
    },
    run: async (p, ctx) => {
      // The hex check runs BEFORE the packet: an odd-length or non-hex string would
      // otherwise be decoded by `fromHex`'s own throw, which produces a 100 rather than
      // the 1400 a bad parameter deserves.
      if (!/^[0-9a-fA-F]*$/.test(p.data) || p.data.length % 2 !== 0) {
        return failedResponse(RETCODE.BAD_REQUEST, "data must be a hex string of even length");
      }
      const body = Buffer.from(p.data, "hex");
      const result = await ctx.bridge.sendRawPacket(p.cmd, body);
      if (!result.success) return failedResponse(RETCODE.ACTION_FAILED, result.errorMessage || "send failed");
      if (!p.rsp) return okResponse(null);
      // An empty response is `""`, not null — the two mean different things to a caller
      // (no payload vs. no response requested).
      return okResponse(result.responseData ? Buffer.from(result.responseData).toString("hex") : "");
    },
  }),
);

// --- misc odds and ends -------------------------------------------------

push(
  defineAction<{ no_cache: boolean }, ActionContext>({
    name: "get_online_clients",
    summary: "获取在线客户端",
    readOnly: true,
    params: {
      no_cache: f.bool().default(false).describe("是否强制刷新；QQ 当前仅暴露本地快照，true 会明确失败"),
    },
    run: async (p, ctx) => {
      if (p.no_cache) {
        return failedResponse(
          RETCODE.ACTION_FAILED,
          "online-client fresh refresh is unavailable; QQ exposes only its local snapshot",
        );
      }
      const snapshot = ctx.bridge.getOnlineClients();
      if (snapshot === null) {
        return failedResponse(RETCODE.ACTION_FAILED, "online-client snapshot has not been observed in this session");
      }
      // An UNKNOWN kind yields `undefined`, not "unknown" — the label map has no entry
      // for it, and the reference lets that through rather than defaulting.
      const kindLabels: Record<string, string> = { computer: "电脑", pad: "Pad", phone: "手机", unknown: "未知设备" };
      return okResponse({
        clients: snapshot.map((device) => ({
          app_id: device.appId,
          device_name: device.deviceName,
          device_kind: kindLabels[device.deviceKind],
        })),
      });
    },
  }),
);

// ===========================================================================
// Slice B — needs the interaction / friend slices (all specs existed)
// ===========================================================================

push(
  defineAction<{ user_id: number; times: number }, ActionContext>({
    name: "send_like",
    summary: "点赞",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      user_id: f.userId(),
      times: f.int({ min: 0 }).default(1),
    },
    run: async (p, ctx) => {
      await ctx.bridge.apis.interaction.sendLike(p.user_id, p.times);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ user_id: number; target_id?: number | undefined }, ActionContext>({
    name: "friend_poke",
    summary: "好友拍一拍",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      user_id: f.userId(),
      target_id: f.userId().optional(),
    },
    run: async (p, ctx) => {
      await ctx.bridge.apis.interaction.sendPoke(false, p.user_id, p.target_id);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ group_id: number; user_id: number }, ActionContext>({
    name: "group_poke",
    summary: "群拍一拍",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: { group_id: f.groupId(), user_id: f.userId() },
    run: async (p, ctx) => {
      // `peerUin` is the GROUP id and `targetUin` the member — the opposite of the
      // private case, where the only id is the peer. Swapping them pokes the group.
      await ctx.bridge.apis.interaction.sendPoke(true, p.group_id, p.user_id);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ user_id: number; group_id?: number | undefined }, ActionContext>({
    name: "send_poke",
    summary: "拍一拍（群聊/私聊自动路由）",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      user_id: f.userId(),
      group_id: f.groupId().optional(),
    },
    run: async (p, ctx) => {
      if (p.group_id) await ctx.bridge.apis.interaction.sendPoke(true, p.group_id, p.user_id);
      else await ctx.bridge.apis.interaction.sendPoke(false, p.user_id);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ message_id: number }, ActionContext>({
    name: "set_essence_msg",
    summary: "设置精华消息",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: { message_id: f.messageId() },
    run: async (p, ctx) => {
      if (!ctx.setEssenceMsg) return failedResponse(RETCODE.ACTION_FAILED, "essence message store is unavailable");
      await ctx.setEssenceMsg(p.message_id);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ message_id: number }, ActionContext>({
    name: "delete_essence_msg",
    summary: "移除精华消息",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: { message_id: f.messageId() },
    run: async (p, ctx) => {
      if (!ctx.deleteEssenceMsg) return failedResponse(RETCODE.ACTION_FAILED, "essence message store is unavailable");
      await ctx.deleteEssenceMsg(p.message_id);
      return okResponse();
    },
  }),
);

push(
  groupAction<Record<string, never>, ActionContext>({
    name: "get_essence_msg_list",
    summary: "获取精华消息列表",
    readOnly: true,
    params: {},
    run: async (p, ctx) => {
      try {
        const pages = await ctx.bridge.apis.web.getEssenceAll(p.group_id);
        // `flatMap` then `filter(null)`: a page can contain an explicit null row, and
        // passing one to the projector would throw on `group_code`.
        const projections = pages
          .flatMap((res) => res.data.msg_list)
          .filter((message) => message !== null)
          .map((message) => projectEssenceMessage(message as Record<string, unknown>, p.group_id));
        if (!ctx.cacheMessageMetas) {
          return failedResponse(RETCODE.ACTION_FAILED, "message store is unavailable");
        }
        await ctx.cacheMessageMetas(projections.map(({ messageId, meta }) => ({ messageId, meta })));
        return okResponse(projections.map(({ result }) => result));
      } catch (e) {
        // `String(e)` — an Error stringifies to `Error: message`, which is what the
        // reference's template does. Using `e.message` would drop the `Error:` prefix.
        return failedResponse(RETCODE.ACTION_FAILED, `获取精华消息失败: ${String(e)}`);
      }
    },
  }),
);

push(
  defineAction<{ group_id?: number | undefined; message_id: number; code: string; is_set: boolean }, ActionContext>({
    name: "set_group_reaction",
    summary: "群聊表情回应",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      group_id: f.groupId().optional(),
      message_id: f.messageId(),
      code: f.string({ allowEmpty: false }),
      is_set: f.bool().default(true),
    },
    run: async (p, ctx) => {
      const meta = await ctx.getMessageMeta(p.message_id);
      if (!meta || !meta.isGroup) {
        return failedResponse(RETCODE.ACTION_FAILED, "message not found or not a group message");
      }
      if (p.group_id && p.group_id !== meta.targetId) {
        return failedResponse(RETCODE.BAD_REQUEST, "group_id does not match message session");
      }
      if (!hasAuthoritativeSequence(meta)) {
        return failedResponse(RETCODE.ACTION_FAILED, "message has no authoritative QQ sequence");
      }
      await ctx.bridge.apis.interaction.setReaction(meta.targetId, meta.sequence, p.code, p.is_set);
      return okResponse();
    },
  }),
);

// --- history -------------------------------------------------------------

push(
  groupAction<{ message_id: number; count: number; reverse_order: boolean }, ActionContext>({
    name: "get_group_msg_history",
    summary: "获取群消息历史",
    readOnly: true,
    returns: "{ messages }：群消息事件对象数组（每项为 OneBot 消息事件，内部字段不固定）。",
    params: {
      message_id: f.int().default(0).role("message_id"),
      count: f.int({ min: 0 }).default(20),
      reverse_order: f.bool().default(true),
    },
    run: async (p, ctx) => {
      // `message_id` here is `int().default(0)` with a ROLE, not `messageId()` — 0 means
      // "no anchor, start from the newest", so a `messageId()` (nonZero) field would make
      // the default itself invalid.
      if (!ctx.getGroupMsgHistory) return failedResponse(RETCODE.ACTION_FAILED, "message history is unavailable");
      return okResponse({
        messages: await ctx.getGroupMsgHistory(p.group_id, p.message_id, p.count, p.reverse_order),
      });
    },
  }),
);

push(
  defineAction<{ user_id: number; message_id: number; count: number; reverse_order: boolean }, ActionContext>({
    name: "get_friend_msg_history",
    summary: "获取好友消息历史（无锚点时从服务器获取最新双向记录）",
    readOnly: true,
    returns: "{ messages }：好友消息事件对象数组（每项为 OneBot 消息事件，内部字段不固定）。",
    params: {
      user_id: f.userId(),
      message_id: f.int().default(0).role("message_id"),
      count: f.int({ min: 0 }).default(20),
      reverse_order: f.bool().default(true),
    },
    run: async (p, ctx) => {
      if (!ctx.getFriendMsgHistory) return failedResponse(RETCODE.ACTION_FAILED, "message history is unavailable");
      return okResponse({
        messages: await ctx.getFriendMsgHistory(p.user_id, p.message_id, p.count, p.reverse_order),
      });
    },
  }),
);

// --- emoji reactions ----------------------------------------------------


push(
  defineAction<{ message_id: number; emoji_id: string }, ActionContext>({
    name: "get_emoji_likes",
    summary: "获取表情回应用户",
    readOnly: true,
    params: {
      message_id: f.messageId(),
      emoji_id: f.string({ allowEmpty: false }),
    },
    run: async (p, ctx) => {
      // ⚠️ UNGUARDED `.users.map(...)`: the reference does not optional-chain here, and
      // the difference is observable — a provider that resolves `undefined` makes this
      // throw (→ 100) rather than answer an empty list. `?? []` would hide a broken store.
      const page = await ctx.fetchEmojiLikeUsers!(p.message_id, p.emoji_id, 1000);
      // `nick_name: ""` unconditionally — the provider does not carry nicks and this
      // action does not fetch them.
      return okResponse({
        emoji_like_list: page.users.map((u) => ({ user_id: String(u.uin), nick_name: "" })),
      });
    },
  }),
);

push(
  defineAction<{ message_id: number; emojiId: string; count: number; cookie: string }, ActionContext>({
    name: "fetch_emoji_like",
    summary: "获取表情回应用户（NapCat 分页）",
    readOnly: true,
    params: {
      message_id: f.messageId(),
      emojiId: f.string({ allowEmpty: false }),
      count: f.int({ min: 0 }).default(10),
      cookie: f.string().default(""),
    },
    run: async (p, ctx) => {
      // The cookie IS the offset, as a decimal string. A non-numeric cookie degrades to
      // 0 via `|| 0` rather than failing, which is the reference's choice.
      const offset = p.cookie ? Number.parseInt(p.cookie, 10) || 0 : 0;
      const result = await ctx.fetchEmojiLikeUsers?.(p.message_id, p.emojiId, p.count, offset);
      const users = result?.users ?? [];
      const nextOffset = offset + users.length;
      const isLastPage = nextOffset >= (result?.cachedCount ?? 0);
      return okResponse({
        result: 0,
        errMsg: "",
        emojiLikesList: users.map((u) => ({ tinyId: String(u.uin), nickName: "", headUrl: "" })),
        cookie: isLastPage ? "" : String(nextOffset),
        isLastPage,
        isFirstPage: offset === 0,
      });
    },
  }),
);

push(
  defineAction<{ message_id: number }, ActionContext>({
    name: "get_msg_emoji_likes",
    summary: "获取一条消息的全部表情回应",
    readOnly: true,
    params: { message_id: f.messageId() },
    run: async (p, ctx) => {
      // The one GUARDED reaction member, with its own wording.
      if (!ctx.fetchEmojiLikeSummary) {
        return failedResponse(RETCODE.ACTION_FAILED, "emoji reaction summary is unavailable");
      }
      return okResponse(await ctx.fetchEmojiLikeSummary(p.message_id));
    },
  }),
);

push(
  defineAction<{ message_id: number; emoji_id: string; set: boolean }, ActionContext>({
    name: "set_msg_emoji_like",
    summary: "设置消息表情回应",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      message_id: f.messageId(),
      emoji_id: f.string({ allowEmpty: false }),
      set: f.bool().default(true),
    },
    run: async (p, ctx) => {
      if (!ctx.setMsgEmojiLike) return failedResponse(RETCODE.ACTION_FAILED, "reaction store is unavailable");
      await ctx.setMsgEmojiLike(p.message_id, p.emoji_id, p.set);
      return okResponse();
    },
  }),
);

// --- mark all read ------------------------------------------------------

push(
  defineAction<Record<string, never>, ActionContext>({
    name: "_mark_all_as_read",
    summary: "标记全部已读",
    params: {},
    run: async (_p, ctx) => {
      // ⚠️ NO `group_id` scope: this is every group AND every private session, which is
      // why the provider answers both lists instead of one.
      if (!ctx.listReadSessions) return failedResponse(RETCODE.ACTION_FAILED, "read-session store is unavailable");
      const sessions = await ctx.listReadSessions();
      await ctx.bridge.apis.message.markAllRead(sessions.groupIds, sessions.privateUserIds);
      return okResponse();
    },
  }),
);

// --- friend remarks / doubtful requests ---------------------------------

push(
  defineAction<{ user_id: number; remark: string }, ActionContext>({
    name: "set_friend_remark",
    summary: "设置好友备注",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      user_id: f.userId(),
      // REQUIRED with no default — clearing a remark is an explicit `""`, never an
      // omission. The friend slice routes `""` to `0x912f_0` rather than sending an
      // empty string to `0x912e_0`.
      remark: f.string(),
    },
    run: async (p, ctx) => {
      await ctx.bridge.apis.friend.setRemark(p.user_id, p.remark);
      return okResponse();
    },
  }),
);

push(
  groupAction<{ remark: string }, ActionContext>({
    name: "set_group_remark",
    summary: "设置群备注",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: { remark: f.string() },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.setRemark(p.group_id, p.remark);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ count: number }, ActionContext>({
    name: "get_doubt_friends_add_request",
    summary: "获取可疑好友申请",
    readOnly: true,
    params: { count: f.int({ min: 0 }).default(50) },
    run: async (p, ctx) => {
      return okResponse(await ctx.bridge.apis.friend.getDoubtRequests(p.count));
    },
  }),
);

push(
  defineAction<{ flag: string; approve: boolean }, ActionContext>({
    name: "set_doubt_friends_add_request",
    summary: "处理可疑好友申请",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      flag: f.string({ allowEmpty: false }),
      approve: f.bool().default(true),
    },
    run: async (p, ctx) => {
      if (p.approve) await ctx.bridge.apis.friend.approveDoubtRequest(p.flag);
      else await ctx.bridge.apis.friend.rejectDoubtRequest(p.flag);
      return okResponse();
    },
  }),
);

// ===========================================================================
// Slice C — misc (five of nine implemented)
// ===========================================================================

push(
  defineAction<{ words: string[] }, ActionContext>({
    name: "translate_en2zh",
    summary: "英译中",
    readOnly: true,
    params: { words: f.array(f.string()) },
    // ⚠️ Returns `{ words: [...] }`, not a bare array — the response is an OBJECT whose
    // one key echoes the request's name.
    run: async (p, ctx) => okResponse({ words: await ctx.bridge.apis.misc.translateEn2Zh(p.words) }),
  }),
);

push(
  groupAction<Record<string, never>, ActionContext>({
    name: ["set_group_sign", "send_group_sign"],
    summary: "群签到",
    params: {},
    // ⚠️ `okResponse({})`, not `okResponse()` — one of the three non-null mutators.
    run: async (p, ctx) => {
      await ctx.bridge.apis.misc.sendGroupSign(p.group_id);
      return okResponse({});
    },
  }),
);

push(
  defineAction<{ db_path: string }, ActionContext>({
    name: "request_decrypt_key",
    summary: "请求数据库解密密钥",
    params: { db_path: f.string({ allowEmpty: false }) },
    run: async (p, ctx) => {
      // A 128-hex salt lives at bytes [47, 175) of the QQ login database — the offset is
      // the file format's, not a choice. Anything shorter than 175 bytes cannot contain
      // it, so the length check precedes the slice.
      const bytes = await (await import("node:fs/promises")).readFile(p.db_path);
      if (bytes.length < 175) return failedResponse(RETCODE.ACTION_FAILED, "Database file too short");
      const dbSalt = bytes.subarray(47, 175).toString("utf8");
      if (!/^[0-9a-fA-F]{128}$/.test(dbSalt)) {
        return failedResponse(RETCODE.ACTION_FAILED, "Invalid db_salt: not a valid 128-character hex string");
      }
      return okResponse({ db_key: await ctx.bridge.apis.misc.getDecryptKey(dbSalt.toLowerCase()) });
    },
  }),
);

push(
  defineAction<Record<string, never>, ActionContext>({
    name: ["get_rkey", "nc_get_rkey"],
    summary: "获取下载 rkey",
    readOnly: true,
    params: {},
    run: async (_p, ctx) => {
      if (!ctx.getDownloadRKeys) return failedResponse(RETCODE.ACTION_FAILED, "not implemented");
      return okResponse(await ctx.getDownloadRKeys());
    },
  }),
);

push(
  defineAction<Record<string, never>, ActionContext>({
    name: "get_rkey_server",
    summary: "获取 rkey 服务器信息",
    readOnly: true,
    params: {},
    run: async (_p, ctx) => {
      if (!ctx.getDownloadRKeys) return failedResponse(RETCODE.ACTION_FAILED, "not implemented");
      const rkeys = await ctx.getDownloadRKeys();
      const pick = (type: number): (typeof rkeys)[number] | undefined => rkeys.find((r) => r.type === type);
      // Type 10 is private, 20 is group. Both are checked because ONE present rkey is
      // enough for a useful answer; requiring both would fail on a group-only account.
      const priv = pick(10);
      const group = pick(20);
      if (!priv?.rkey && !group?.rkey) return failedResponse(RETCODE.ACTION_FAILED, "no download rkey available");
      const ttls = [priv?.ttlSeconds, group?.ttlSeconds].filter(
        (t): t is number => typeof t === "number" && t > 0,
      );
      const minTtl = ttls.length ? Math.min(...ttls) : 0;
      const data: Record<string, unknown> = {
        expired_time: Math.floor(Date.now() / 1000) + minTtl,
        // The product name, not the account's. Reproduced verbatim.
        name: "Haizakura",
      };
      if (priv?.rkey) data["private_rkey"] = priv.rkey;
      if (group?.rkey) data["group_rkey"] = group.rkey;
      return okResponse(data);
    },
  }),
);

// --- slice C tail: the actions whose provider is genuinely absent --------

push(
  defineAction<
    {
      type?: string | undefined;
      title?: string | undefined;
      desc?: string | undefined;
      picUrl?: string | undefined;
      pic_url?: string | undefined;
      jumpUrl?: string | undefined;
      jump_url?: string | undefined;
    },
    ActionContext
  >({
    name: "get_mini_app_ark",
    summary: "获取小程序卡片 ark",
    readOnly: true,
    params: {
      // EVERY field is optional and `type` defaults to "bili" INSIDE the body rather
      // than in the schema — which is why there is no `default` in `describe()`.
      type: f.string().optional(),
      title: f.string().optional(),
      desc: f.string().optional(),
      // Both camelCase and snake_case, camelCase first. Real clients send either.
      picUrl: f.string().optional(),
      pic_url: f.string().optional(),
      jumpUrl: f.string().optional(),
      jump_url: f.string().optional(),
    },
    run: async (p, ctx) => {
      const type = p.type || "bili";
      const title = p.title || "";
      const desc = p.desc || "";
      const picUrl = p.picUrl || p.pic_url || "";
      const jumpUrl = p.jumpUrl || p.jump_url || "";
      // `MiscApi.getMiniAppArk` is a class method, so it is always present — the old
      // `if (!ctx.bridge.apis.misc.getMiniAppArk)` guard was a stub-era check that could
      // never fire and would have hidden a real failure behind "unavailable".
      //
      // The four `|| ""` defaults are the reference's own (`p.title || ""` etc.): an absent
      // field must reach the server as an empty string, which `encodeMiniAppShareReq` then
      // OMITS from the request rather than writing as a zero-length field.
      return okResponse(await ctx.bridge.apis.misc.getMiniAppArk(type, title, desc, picUrl, jumpUrl));
    },
  }),
);

push(
  groupAction<
    { bot_appid: number; msg_seq: number; button_id: string; callback_data: string },
    ActionContext
  >({
    name: "click_inline_keyboard_button",
    summary: "点击内联键盘按钮",
    readOnly: false,
    returns: "服务端返回的点击结果（字段由 QQ 决定）",
    params: {
      // `f.uint()`, so min 1 — a bot appid of 0 is not representable, and the reference
      // relies on that rather than an explicit check.
      bot_appid: f.uint(),
      msg_seq: f.uint(),
      button_id: f.string({ allowEmpty: false }),
      callback_data: f.string().default(""),
    },
    // ⚠️ The provider's RESULT is the response data — this is one of the few mutators
    // that forwards a server payload instead of answering null.
    run: async (p, ctx) => {
      if (!ctx.bridge.apis.misc.clickInlineKeyboardButton) {
        return failedResponse(RETCODE.ACTION_FAILED, "inline keyboard is unavailable");
      }
      return okResponse(
        await ctx.bridge.apis.misc.clickInlineKeyboardButton(
          p.group_id,
          p.bot_appid,
          p.button_id,
          p.callback_data,
          p.msg_seq,
        ),
      );
    },
  }),
);

// ===========================================================================
// Slice D — groupFile / extras (specs exist, host providers partially do)
// ===========================================================================

// --- 11 slice-D actions that reach a hub member not yet wired ------------
//
// Each body is the reference's, verbatim. Each is inert for a MEASURED reason
// recorded on the hub interface (`context.ts`), and each guards the call so a host
// without the member answers the reference's own failure rather than `{}`.

push(
  defineAction<{ file: string }, ActionContext>({
    name: "add_custom_face",
    summary: "添加收藏表情",
    params: { file: f.image() },
    // ✅ LIVE. `profile.addCustomFace` is implemented: `loadBinarySource` → md5 →
    // `ImgStore.BDHExpressionRoam` for the token → one `FavEmojiHighwayHead` POST
    // (`commandId: 9`) → the computed `emoji_id`. The guard stays because a HOST may
    // inject a narrower `ActionProfileApi` than the real one; it answers the
    // reference's own failure instead of `{}`.
    run: async (p, ctx) => {
      if (!ctx.bridge.apis.profile.addCustomFace) {
        return failedResponse(RETCODE.ACTION_FAILED, "custom face upload is unavailable");
      }
      return okResponse({ emoji_id: await ctx.bridge.apis.profile.addCustomFace(p.file) });
    },
  }),
);

push(
  defineAction<{ emoji_id: string; desc: string }, ActionContext>({
    name: "modify_custom_face",
    summary: "修改收藏表情备注",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      emoji_id: f.string({ allowEmpty: false }),
      desc: f.string().default(""),
    },
    // 🚫 `0x902e_2` descriptor + `0x902f_1` reorder; neither is wired in `profile.ts`.
    run: async (p, ctx) => {
      if (!ctx.bridge.apis.profile.modifyCustomFace) {
        return failedResponse(RETCODE.ACTION_FAILED, "custom face modify is unavailable");
      }
      await ctx.bridge.apis.profile.modifyCustomFace(p.emoji_id, p.desc);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ emoji_id: string }, ActionContext>({
    name: "move_custom_face_to_front",
    summary: "收藏表情移到最前",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: { emoji_id: f.string({ allowEmpty: false }) },
    // 🚫 Needs the full saved-sticker list, then `0x902f_1` with the new head order.
    run: async (p, ctx) => {
      if (!ctx.bridge.apis.profile.moveCustomFaceToFront) {
        return failedResponse(RETCODE.ACTION_FAILED, "custom face reorder is unavailable");
      }
      await ctx.bridge.apis.profile.moveCustomFaceToFront(p.emoji_id);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ count: number }, ActionContext>({
    name: "fetch_custom_face_detail",
    summary: "获取自定义表情详情",
    readOnly: true,
    params: { count: f.int({ min: 0 }).default(48) },
    run: async (p, ctx) => {
      return okResponse(
        // `resId` duplicates `emoji_id` — both names are consumed by real clients, so
        // dropping either breaks one of them.
        (await ctx.bridge.apis.profile.fetchCustomFaceDetails!(p.count)).map((detail) => ({
          emoji_id: detail.emojiId,
          resId: detail.emojiId,
          url: detail.url,
          md5: detail.md5,
          desc: detail.desc,
        })),
      );
    },
  }),
);

push(
  defineAction<{ with_profile: boolean }, ActionContext>({
    name: "get_friends_with_category",
    summary: "获取分组好友列表",
    readOnly: true,
    params: {
      with_profile: f.bool().default(false).describe("主动补查好友公开资料，按账号缓存五分钟；大列表可能耗时较长"),
    },
    run: async (p, ctx) => {
      return okResponse(
        (await ctx.bridge.apis.contacts.fetchFriendCategories!({ withProfile: p.with_profile })).map((category) => ({
          categoryId: category.categoryId,
          categoryName: category.categoryName,
          categoryMbCount: category.memberCount,
          buddyList: category.friends.map((friend) => formatFriend(friend, category.categoryId)),
        })),
      );
    },
  }),
);

push(
  defineAction<{ uin: number; categoryId?: number | undefined; categoryName?: string | undefined }, ActionContext>({
    name: "set_friends_category",
    summary: "移动好友到指定分组",
    returns: "成功时返回空数据。",
    params: {
      uin: f.userId().describe("要移动的好友 QQ 号"),
      categoryId: f.int({ min: 0 }).optional().describe("目标分组 ID"),
      categoryName: f.string({ allowEmpty: false }).optional().describe("目标分组名称（必须唯一且完全匹配）"),
    },
    // ⚠️ `exactlyOneOf`, not `atLeastOneOf`: passing both is ambiguous about which wins,
    // and the reference refuses rather than picking.
    rules: (r) => [r.exactlyOneOf("categoryId", "categoryName")],
    run: async (p, ctx) => {
      await ctx.bridge.apis.contacts.setFriendCategory!({
        uin: p.uin,
        categoryId: p.categoryId,
        categoryName: p.categoryName,
      });
      return okResponse();
    },
  }),
);

push(
  groupAction<Record<string, never>, ActionContext>({
    name: "get_group_at_all_remain",
    summary: "获取群 @全体成员 剩余次数",
    readOnly: true,
    params: {},
    // 🚫 `groupAdmin.getAtAllRemain` — `0x8a7_0` / `0x90f5_1` are ported
    // (`GetAtAllRemain`); one call of wiring.
    run: async (p, ctx) => {
      if (!ctx.bridge.apis.groupAdmin.getAtAllRemain) {
        return failedResponse(RETCODE.ACTION_FAILED, "at-all remain is unavailable");
      }
      return okResponse(await ctx.bridge.apis.groupAdmin.getAtAllRemain(p.group_id));
    },
  }),
);

push(
  defineAction<Record<string, never>, ActionContext>({
    name: "get_unidirectional_friend_list",
    summary: "获取单向好友列表",
    readOnly: true,
    params: {},
    run: async (_p, ctx) => {
      return okResponse(await ctx.bridge.apis.profile.getUnidirectionalFriendList!());
    },
  }),
);

push(
  defineAction<
    {
      user_id?: number | undefined;
      group_id?: number | undefined;
      title: string;
      desc: string;
      summary: string;
      preview_url: string;
      jump_url: string;
    },
    ActionContext
  >({
    name: "send_tuwen_ark",
    summary: "发送图文 Ark 卡片（私聊/群聊）",
    readOnly: false,
    params: {
      user_id: f.userId().optional(),
      group_id: f.groupId().optional(),
      title: f.string(),
      desc: f.string(),
      summary: f.string().default("[分享]"),
      // The reference's own default preview image. It is a real CDN URL, not a
      // placeholder — the card renders with it when a caller omits one.
      preview_url: f
        .string()
        .default(
          "https://tangram-1251316161.file.myqcloud.com/files/20210721/e50a8e37e08f29bf1ffc7466e1950690.png",
        ),
      jump_url: f.string(),
    },
    run: async (p, ctx) => {
      if (!ctx.bridge.apis.contacts.sendTuwenArk) {
        return failedResponse(RETCODE.ACTION_FAILED, "tuwen ark is unavailable");
      }
      // Group wins; `peerType` 1 vs 0 is the discriminator and it is not derivable from
      // `targetId` alone (a QQ number and a group number can collide numerically).
      if (p.group_id) {
        await ctx.bridge.apis.contacts.sendTuwenArk({
          targetId: p.group_id,
          peerType: 1,
          title: p.title,
          desc: p.desc,
          summary: p.summary,
          previewUrl: p.preview_url,
          jumpUrl: p.jump_url,
        });
        // ⚠️ `okResponse(null)` — this mutator's data is null, unlike `set_input_status`.
        return okResponse(null);
      }
      if (p.user_id) {
        await ctx.bridge.apis.contacts.sendTuwenArk({
          targetId: p.user_id,
          peerType: 0,
          title: p.title,
          desc: p.desc,
          summary: p.summary,
          previewUrl: p.preview_url,
          jumpUrl: p.jump_url,
        });
        return okResponse(null);
      }
      return failedResponse(RETCODE.BAD_REQUEST, "user_id or group_id is required");
    },
  }),
);

push(
  groupAction<{ robot_member_switch?: number | undefined; robot_member_examine?: number | undefined }, ActionContext>({
    name: "set_group_robot_add_option",
    summary: "设置群机器人加群选项",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      robot_member_switch: f.int({ min: 0 }).optional(),
      robot_member_examine: f.int({ min: 0 }).optional(),
    },
    // Both params are optional and there is NO atLeastOneOf rule — a call with neither
    // still reaches the server, which answers its own error. Reproduced as-is.
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.setRobotAddOption!(p.group_id, p.robot_member_switch, p.robot_member_examine);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ file: string }, ActionContext>({
    name: "set_qq_avatar",
    summary: "设置 QQ 头像",
    params: { file: f.image() },
    // 🚫 Highway upload + a hand-encoded `SetAvatarExtra`. Same blocker as
    // `set_group_portrait`, and the largest single gap in this batch.
    run: async (p, ctx) => {
      if (!ctx.bridge.apis.profile.setAvatar) {
        return failedResponse(RETCODE.ACTION_FAILED, "avatar upload is unavailable");
      }
      await ctx.bridge.apis.profile.setAvatar(p.file);
      return okResponse();
    },
  }),
);

push(
  groupAction<Record<string, never>, ActionContext>({
    name: "get_group_file_system_info",
    summary: "获取群文件系统信息",
    readOnly: true,
    params: {},
    run: async (p, ctx) => {
      // ⚠️ `Promise.all`, not sequential: the two packets are independent and the
      // reference issues them concurrently. And the key is `limit_count`, not
      // `max_file_count` — a rename would silently drop the field clients read.
      const [count, space] = await Promise.all([
        ctx.bridge.apis.groupFile.getCount(p.group_id),
        ctx.bridge.apis.groupFile.getSpace(p.group_id),
      ]);
      return okResponse({
        file_count: count.fileCount,
        limit_count: count.maxCount,
        used_space: space.usedSpace,
        total_space: space.totalSpace,
      });
    },
  }),
);

push(
  defineAction<{ group_id: number; file_id: string }, ActionContext>({
    name: "trans_group_file",
    summary: "转存群文件",
    params: {
      group_id: f.groupId(),
      file_id: f.fileId(),
    },
    // ⚠️ `okResponse({ ok: true })` — not null.
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupFile.trans(p.group_id, p.file_id);
      return okResponse({ ok: true });
    },
  }),
);

push(
  groupAction<{ folder_id: string }, ActionContext>({
    name: "delete_group_folder",
    summary: "删除群文件夹",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: { folder_id: f.string({ allowEmpty: false }) },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupFile.deleteFolder(p.group_id, p.folder_id);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ user_id: number }, ActionContext>({
    name: "nc_get_user_status",
    summary: "获取用户在线/扩展状态",
    readOnly: true,
    params: { user_id: f.userId() },
    run: async (p, ctx) => {
      const status = await ctx.bridge.apis.extras.getStrangerStatus(p.user_id);
      if (!status) return failedResponse(RETCODE.ACTION_FAILED, "failed to fetch user status");
      return okResponse({ ...status });
    },
  }),
);

push(
  groupAction<{ chat_type: number }, ActionContext>({
    name: "get_ai_characters",
    summary: "获取 AI 语音角色",
    readOnly: true,
    params: { chat_type: f.int({ min: 0 }).default(1) },
    run: async (p, ctx) => {
      return okResponse(
        (await ctx.bridge.apis.extras.fetchAiVoiceList(p.group_id, p.chat_type)).map((cat) => ({
          type: cat.category,
          characters: cat.voices.map((v) => ({
            character_id: v.voiceId,
            character_name: v.voiceDisplayName,
            preview_url: v.voiceExampleUrl,
          })),
        })),
      );
    },
  }),
);

push(
  groupAction<{ character: string; text: string; chat_type: number }, ActionContext>({
    name: "get_ai_record",
    summary: "生成 AI 语音",
    params: {
      character: f.string({ allowEmpty: false }),
      text: f.string({ allowEmpty: false }),
      chat_type: f.int({ min: 0 }).default(1),
    },
    run: async (p, ctx) => {
      const node = await ctx.bridge.apis.extras.fetchAiVoice(p.group_id, p.character, p.text, p.chat_type);
      // ✅ Both hops exist: `extras.fetchAiVoice` synthesises, and `groupFile.getPttUrl`
      // (`0x126e_200`) turns the returned media node into a download URL. The stub-era
      // presence guard that used to sit here could never fire — `getPttUrl` is a required
      // member of `ActionGroupFileApi` — and the reference's body has none
      // (reference:14484-14487).
      return okResponse(await ctx.bridge.apis.groupFile.getPttUrl(p.group_id, node));
    },
  }),
);

push(
  groupAction<{ character: string; text: string; chat_type: number }, ActionContext>({
    name: "send_group_ai_record",
    summary: "发送 AI 语音到群",
    params: {
      character: f.string({ allowEmpty: false }),
      text: f.string({ allowEmpty: false }),
      chat_type: f.int({ min: 0 }).default(1),
    },
    run: async (p, ctx) => {
      // ✅ LIVE. `extras.sendAiVoice` is a class method, so the stub-era presence guard
      // that used to sit here could never fire — and if it ever did, it would hide a real
      // failure behind "ai voice send is unavailable". The reference's body has no guard
      // either (reference:14509-14511): it publishes, awaits the group-message receipt,
      // and hashes the receipt's SEQUENCE into the OneBot message id. The sequence is the
      // only usable field — the synthesis response does not carry one, which is exactly
      // why `sendAiVoice` correlates the echo.
      const receipt = await ctx.bridge.apis.extras.sendAiVoice(p.group_id, p.character, p.text, p.chat_type);
      return okResponse({
        message_id: hashMessageIdInt32(receipt.sequence, p.group_id, GROUP_MESSAGE_EVENT),
      });
    },
  }),
);

push(
  groupAction<Record<string, never>, ActionContext>({
    name: "get_group_todo_list",
    summary: "获取群待办列表",
    readOnly: true,
    params: {},
    run: async (p, ctx) => {
      const projections = (await ctx.bridge.apis.extras.getGroupTodoList(p.group_id)).map((todo) => ({
        todo,
        messageId: hashMessageIdInt32(todo.sequence, p.group_id, GROUP_MESSAGE_EVENT),
        meta: {
          isGroup: true as const,
          targetId: p.group_id,
          sequence: todo.sequence,
          sequenceAuthoritative: true as const,
          eventName: GROUP_MESSAGE_EVENT,
          clientSequence: 0,
          random: todo.random,
          timestamp: todo.createdAt,
        },
      }));
      if (!ctx.cacheMessageMetas) return failedResponse(RETCODE.ACTION_FAILED, "message store is unavailable");
      await ctx.cacheMessageMetas(projections.map(({ messageId, meta }) => ({ messageId, meta })));
      const out = [];
      for (const { todo, messageId } of projections) {
        const cached = (await ctx.getMessage(messageId))?.message;
        out.push({
          message_id: messageId,
          message_seq: todo.sequence,
          message_random: todo.random,
          // `null`, not `[]`: "not cached" and "cached with no segments" differ, and
          // the returnsSchema documents the null case explicitly.
          message: Array.isArray(cached) ? cached : null,
          text: todo.text,
          create_time: todo.createdAt,
          update_time: todo.updatedAt,
        });
      }
      return okResponse(out);
    },
  }),
);

for (const [name, op] of [
  ["set_group_todo", "set"],
  ["complete_group_todo", "complete"],
  ["cancel_group_todo", "cancel"],
] as const) {
  push(
    groupAction<{ message_id: number }, ActionContext>({
      name,
      summary: `群待办：${op}`,
      params: { message_id: f.messageId() },
      run: async (p, ctx) => {
        const result = await groupTodoRun(p.group_id, p.message_id, ctx, async (groupId, msgSeq) => {
          const api = ctx.bridge.apis.extras;
          if (op === "set") return await api.setGroupTodo(groupId, msgSeq);
          if (op === "complete") return await api.completeGroupTodo(groupId, msgSeq);
          return await api.cancelGroupTodo(groupId, msgSeq);
        });
        if (result.status === "failed") return failedResponse(result.retcode, result.wording);
        return okResponse();
      },
    }),
  );
}

// ===========================================================================
// Slice E — flash transfer (11). All eleven wired, uploader included.
// ===========================================================================
//
// Every one of these eleven is gated on `flashTransfer.*`, whose interface is declared
// in `context.ts` and implemented in `bridge/apis/flash-transfer.ts`. All eleven reach
// a real method, including `create_flash_task`, whose `createFlashTask` stages the
// sources, hashes them, applies + commits the fileset, slice-uploads each file and
// uploads the two placeholder thumbnails before answering `fileset_id`. The action
// body itself was already written (it is a transcription of the reference's) and only
// the bridge method was missing.
//
// `flashFileInfoToJson` names the size field `size`, not `file_size` — a NapCat
// compatibility choice recorded on the helper.
//
// ⚠️ NONE of these is `readOnly` in the reference, "list"-shaped names and all. The
// reference's `readOnly` marks an action that cannot mutate QQ state, and it declines to
// assert that for a call it has not verified — so a port that added `readOnly: true` to
// `list_filesets` because it "looks like a getter" would advertise a guarantee the
// reference does not make.

push(
  defineAction<{ files: unknown; name?: string | undefined; thumb_path?: string | undefined }, ActionContext>({
    name: "create_flash_task",
    summary: "创建闪传任务",
    params: {
      files: f.raw().describe("路径、{ file, name }，或它们的数组"),
      name: f.string().optional(),
      thumb_path: f.string().optional(),
    },
    run: async (p, ctx) => {
      const parsed = parseFlashTaskFiles(p.files);
      if ("error" in parsed) return failedResponse(RETCODE.BAD_REQUEST, parsed.error);
      if (!ctx.bridge.apis.flashTransfer.createFlashTask) {
        return failedResponse(RETCODE.ACTION_FAILED, "flash transfer upload is unavailable");
      }
      const result = await ctx.bridge.apis.flashTransfer.createFlashTask(parsed.files, p.name, p.thumb_path);
      // `task_id` duplicates `fileset_id` for older clients. Both keys, same value.
      return okResponse({ fileset_id: result.filesetId, task_id: result.filesetId });
    },
  }),
);

push(
  defineAction<{ fileset_id: string }, ActionContext>({
    name: "get_fileset_info",
    summary: "获取文件集信息",
    params: { fileset_id: f.string({ allowEmpty: false }) },
    run: async (p, ctx) => {
      if (!ctx.bridge.apis.flashTransfer.getFilesetInfo) {
        return failedResponse(RETCODE.ACTION_FAILED, "flash transfer is unavailable");
      }
      const list = await ctx.bridge.apis.flashTransfer.getFilesetInfo(p.fileset_id);
      return okResponse({ fileset_id: p.fileset_id, file_list: list.map(flashFileInfoToJson) });
    },
  }),
);

push(
  defineAction<{ fileset_id: string }, ActionContext>({
    name: "get_flash_file_list",
    summary: "获取闪传文件列表",
    params: { fileset_id: f.string({ allowEmpty: false }) },
    run: async (p, ctx) => {
      if (!ctx.bridge.apis.flashTransfer.getFlashFileList) {
        return failedResponse(RETCODE.ACTION_FAILED, "flash transfer is unavailable");
      }
      return okResponse((await ctx.bridge.apis.flashTransfer.getFlashFileList(p.fileset_id)).map(flashFileInfoToJson));
    },
  }),
);

push(
  defineAction<Record<string, never>, ActionContext>({
    name: "list_filesets",
    summary: "列出当前账号的所有闪传文件集",
    params: {},
    run: async (_p, ctx) => {
      if (!ctx.bridge.apis.flashTransfer.listFilesets) {
        return failedResponse(RETCODE.ACTION_FAILED, "flash transfer is unavailable");
      }
      return okResponse((await ctx.bridge.apis.flashTransfer.listFilesets()).map(flashFileInfoToJson));
    },
  }),
);

push(
  defineAction<{ fileset_id: string; file_name?: string | undefined; file_index?: number | undefined }, ActionContext>({
    name: "get_flash_file_url",
    summary: "获取闪传文件链接",
    params: {
      fileset_id: f.string({ allowEmpty: false }),
      file_name: f.string().optional(),
      // `f.number()`, not `int()` — the reference accepts a float and truncates inside
      // the provider. Tightening it here would reject a request the reference accepts.
      file_index: f.number().optional(),
    },
    run: async (p, ctx) => {
      if (!ctx.bridge.apis.flashTransfer.getFlashFileUrl) {
        return failedResponse(RETCODE.ACTION_FAILED, "flash transfer is unavailable");
      }
      // ⚠️ `file_name` is ACCEPTED BUT IGNORED — only `file_index` reaches the provider.
      // That is the reference's behaviour; wiring `file_name` would change which file is
      // returned for a caller that passes only a name.
      return okResponse({ url: await ctx.bridge.apis.flashTransfer.getFlashFileUrl(p.fileset_id, p.file_index) });
    },
  }),
);

push(
  defineAction<{ fileset_id: string }, ActionContext>({
    name: "get_share_link",
    summary: "获取文件分享链接",
    params: { fileset_id: f.string({ allowEmpty: false }) },
    run: async (p, ctx) => {
      if (!ctx.bridge.apis.flashTransfer.getShareLink) {
        return failedResponse(RETCODE.ACTION_FAILED, "flash transfer is unavailable");
      }
      return okResponse(await ctx.bridge.apis.flashTransfer.getShareLink(p.fileset_id));
    },
  }),
);

push(
  defineAction<{ fileset_id: string }, ActionContext>({
    name: "delete_flash_file",
    summary: "删除闪传文件",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: { fileset_id: f.string({ allowEmpty: false }) },
    run: async (p, ctx) => {
      if (!ctx.bridge.apis.flashTransfer.deleteFlashFile) {
        return failedResponse(RETCODE.ACTION_FAILED, "flash transfer is unavailable");
      }
      await ctx.bridge.apis.flashTransfer.deleteFlashFile(p.fileset_id);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ fileset_id: string; new_name: string }, ActionContext>({
    name: "rename_flash_file",
    summary: "重命名闪传文件",
    returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording（schema.description）",
    params: {
      fileset_id: f.string({ allowEmpty: false }),
      new_name: f.string({ allowEmpty: false }),
    },
    run: async (p, ctx) => {
      if (!ctx.bridge.apis.flashTransfer.renameFlashFile) {
        return failedResponse(RETCODE.ACTION_FAILED, "flash transfer is unavailable");
      }
      await ctx.bridge.apis.flashTransfer.renameFlashFile(p.fileset_id, p.new_name);
      return okResponse();
    },
  }),
);

push(
  defineAction<{ fileset_id: string; file_name?: string | undefined; file_index?: number | undefined }, ActionContext>({
    name: "download_fileset",
    summary: "解析闪传文件下载直链（不下载，由调用方实现下载）",
    params: {
      fileset_id: f.string({ allowEmpty: false }),
      file_name: f.string().optional(),
      file_index: f.number().optional(),
    },
    run: async (p, ctx) => {
      if (!ctx.bridge.apis.flashTransfer.downloadFileset) {
        return failedResponse(RETCODE.ACTION_FAILED, "flash transfer is unavailable");
      }
      const target = await ctx.bridge.apis.flashTransfer.downloadFileset(p.fileset_id, {
        fileName: p.file_name,
        fileIndex: p.file_index,
      });
      // This action RESOLVES a URL and does not fetch the bytes — the summary says so,
      // and a port that downloaded would block a worker for minutes per call.
      return okResponse({ url: target.url, file_name: target.fileName, file_size: target.fileSize });
    },
  }),
);

push(
  defineAction<{ fileset_id: string; user_id?: number | undefined; group_id?: number | undefined }, ActionContext>({
    name: "send_flash_msg",
    summary: "发送闪传消息（私聊或群聊，引用 fileset_id 让对端下载）",
    params: {
      fileset_id: f.string({ allowEmpty: false }),
      user_id: f.userId().optional(),
      group_id: f.groupId().optional(),
    },
    run: async (p, ctx) => {
      if (!p.user_id && !p.group_id) {
        return failedResponse(RETCODE.BAD_REQUEST, "user_id or group_id is required");
      }
      if (!ctx.bridge.apis.flashTransfer.sendFlashMsg) {
        return failedResponse(RETCODE.ACTION_FAILED, "flash transfer is unavailable");
      }
      await ctx.bridge.apis.flashTransfer.sendFlashMsg(p.fileset_id, { userId: p.user_id, groupId: p.group_id });
      // ⚠️ `message_id: 0` — the send is fire-and-forget and no sequence is observed. A
      // caller must not treat 0 as a real message id.
      return okResponse({ message_id: 0 });
    },
  }),
);

push(
  defineAction<{ share_code: string }, ActionContext>({
    name: "get_fileset_id",
    summary: "从 QQ 闪传分享码或官方分享链接获取 fileset_id",
    readOnly: true,
    params: {
      share_code: f
        .string({ allowEmpty: false })
        .describe("QQ 闪传分享码，或 https://qfile.qq.com/q/... 官方分享链接"),
    },
    run: async (p, ctx) => {
      if (!ctx.bridge.apis.flashTransfer.getFilesetIdByCode) {
        return failedResponse(RETCODE.ACTION_FAILED, "flash transfer is unavailable");
      }
      return okResponse({ fileset_id: await ctx.bridge.apis.flashTransfer.getFilesetIdByCode(p.share_code) });
    },
  }),
);

// ===========================================================================
// The registry exports
// ===========================================================================

/**
 * Per-action state, so the count in `ACTION_COUNTS` can be audited.
 *
 * `live`    — the whole chain exists; it works against a live QQ today.
 * `host`    — the action body is the reference's and its OIDB/hub path exists, but a
 *             `ctx.*` provider must be injected by the host. Correct, currently inert.
 * `blocked` — a provider AND its codec are missing. Absent from the registry.
 */
export type ExtendedActionState = "live" | "host" | "blocked";

export const EXTENDED_ACTION_STATE: Record<string, ExtendedActionState> = {
  // live — no host provider involved beyond things the bridge already has
  delete_custom_face: "live",
  mark_group_msg_as_read: "host",
  mark_private_msg_as_read: "host",
  mark_msg_as_read: "host",
  _send_group_notice: "live",
  _get_group_notice: "live",
  _del_group_notice: "live",
  get_cookies: "live",
  get_csrf_token: "live",
  get_credentials: "live",
  get_clientkey: "live",
  set_restart: "live",
  clean_cache: "live",
  bot_exit: "live",
  check_url_safely: "live",
  set_qq_profile: "live",
  set_online_status: "live",
  set_diy_online_status: "live",
  set_self_longnick: "live",
  set_input_status: "live",
  get_group_shut_list: "live",
  get_group_signed_list: "live",
  get_group_ignored_notifies: "live",
  get_group_ignore_add_request: "live",
  get_group_info_ex: "live",
  get_group_detail_info: "live",
  get_profile_like: "live",
  fetch_custom_face: "live",
  get_recent_contact: "live",
  _get_model_show: "live",
  _set_model_show: "live",
  nc_get_packet_status: "live",
  create_collection: "live",
  ".get_word_slices": "live",
  share_peer: "live",
  send_ark_share: "live",
  share_group_ex: "live",
  send_group_ark_share: "live",
  get_collection_list: "live",
  _get_friend_dress: "live",
  send_like: "live",
  friend_poke: "live",
  group_poke: "live",
  send_poke: "live",
  set_friend_remark: "live",
  set_group_remark: "live",
  get_doubt_friends_add_request: "live",
  set_doubt_friends_add_request: "live",
  translate_en2zh: "live",
  set_group_sign: "live",
  send_group_sign: "live",
  nc_get_rkey: "host",
  request_decrypt_key: "live",
  get_rkey: "host",
  get_rkey_server: "host",
  get_group_file_system_info: "live",
  trans_group_file: "live",
  delete_group_folder: "live",
  nc_get_user_status: "live",
  get_ai_characters: "live",
  get_image: "host",
  get_file: "host",
  ocr_image: "host",
  ".ocr_image": "host",
  get_ptt_text: "host",
  get_record_text: "host",
  ".send_packet": "live",
  click_inline_keyboard_button: "live",
  download_file: "live",
  send_packet: "live",
  get_online_clients: "host",

  // host-injected
  set_essence_msg: "host",
  delete_essence_msg: "host",
  get_essence_msg_list: "host",
  set_group_reaction: "host",
  set_msg_emoji_like: "host",
  get_emoji_likes: "host",
  fetch_emoji_like: "host",
  get_msg_emoji_likes: "host",
  _mark_all_as_read: "host",
  get_group_msg_history: "host",
  get_friend_msg_history: "host",
  fetch_ptt_text: "host",
  upload_forward_msg: "host",
  upload_foward_msg: "host",
  send_forward_msg: "host",
  send_group_forward_msg: "host",
  send_private_forward_msg: "host",
  get_forward_msg: "host",
  forward_friend_single_msg: "host",
  forward_group_single_msg: "host",
  get_record: "host",
  get_group_todo_list: "host",
  set_group_todo: "host",
  complete_group_todo: "host",
  cancel_group_todo: "host",
  get_ai_record: "host",
  send_group_ai_record: "live",
  get_mini_app_ark: "live",

  // slice D tail — hub member and codec both present now
  add_custom_face: "live",
  modify_custom_face: "live",
  move_custom_face_to_front: "live",
  fetch_custom_face_detail: "live",
  get_friends_with_category: "host",
  set_friends_category: "host",
  get_group_at_all_remain: "host",
  get_unidirectional_friend_list: "host",
  send_tuwen_ark: "host",
  set_group_robot_add_option: "live",
  set_qq_avatar: "live",

  // slice E — flash transfer: all eleven wired, uploader included
  create_flash_task: "live",
  get_fileset_info: "host",
  get_flash_file_list: "host",
  list_filesets: "host",
  get_flash_file_url: "host",
  get_share_link: "host",
  delete_flash_file: "host",
  rename_flash_file: "host",
  download_fileset: "host",
  send_flash_msg: "host",
  get_fileset_id: "host",
};

export const extendedActions: Spec[] = all;
export const EXTENDED_ACTION_COUNT = all.length;