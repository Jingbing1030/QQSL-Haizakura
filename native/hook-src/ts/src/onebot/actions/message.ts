// 4.1 — the message family (6 actions) from ../onebot/src/actions/message.ts.
//
// Reference region: reference/index.mjs:7869-8058 (`actions$12`).
//
// ---------------------------------------------------------------------------
// The routing rules are subtler than they read
// ---------------------------------------------------------------------------
// `send_msg`'s branch condition is:
//
//     const isTempReply = message_type === "private" && user_id !== undefined
//                                                    && group_id !== undefined;
//     if (!isTempReply && (message_type === "group" || group_id !== undefined)) { ...group... }
//
// so:
//   * `group_id` present alone routes to the GROUP branch, regardless of
//     `message_type` — a client that sends `{user_id, group_id}` without
//     `message_type` quietly posts to the group.
//   * `message_type: "group"` with no `group_id` is a 1400 "group_id is required",
//     not a fall-through to private.
//   * `{message_type: "private", user_id, group_id}` is the temp-session reply and
//     takes the PRIVATE branch with `groupId` passed through as the temp source.
//   * `send_private_msg` uses a different rule for the same field: `group_id && > 0`,
//     so an explicit `group_id: 0` is dropped there but `send_msg` never looks at 0.
//
// These four cases are each pinned by a test because "auto-routes by group id" is
// the kind of summary that hides them.
//
// ---------------------------------------------------------------------------
// `delete_msg` and `get_msg` failure codes differ from the usual
// ---------------------------------------------------------------------------
// Both use `RETCODE.ACTION_FAILED` (100) when the store misses, not 1400: the
// request was well-formed, the message simply is not there. `delete_msg` refuses
// with the same 100 when the message exists but has no authoritative sequence
// (the bridge's `deleteMessage` raises that), so a caller cannot tell "unknown id"
// from "not retractable" by retcode alone — only by wording, which is why the two
// wordings are different strings here.

import {
  defineAction,
  f,
  RETCODE,
  failedResponse,
  okResponse,
  sendMsgOptionalGroupId,
  type ActionSpec,
} from "./kit.js";
import type { ActionContext, StoredMessageMeta } from "./context.js";

// ===========================================================================
// send_custom_face
// ===========================================================================

interface SendCustomFaceParams {
  emoji_id: string;
  group_id?: number | undefined;
  user_id?: number | undefined;
  reply_to?: number | undefined;
}

const sendCustomFace = defineAction<SendCustomFaceParams, ActionContext>({
  name: "send_custom_face",
  summary: "发送账号收藏表情（emoji_id 或 MD5），保留表情显示样式",
  returns: "{ message_id: number }",
  params: {
    emoji_id: f.string().describe("当前账号收藏表情的完整 ID 或 32 位 MD5"),
    group_id: f.groupId().optional().describe("目标群号；与 user_id 二选一"),
    user_id: f.userId().optional().describe("目标 QQ 号；与 group_id 二选一"),
    reply_to: f.messageId().optional().describe("可选回复消息 ID"),
  },
  // ⚠️ NOT a declarative rule: the reference checks this inside `run`
  // (reference:7906), so `describe().invariants` is EMPTY for this action and the
  // wording below is the run-time message, not a rule doc. Moving it into `rules`
  // would change both the invariants list and the error text.
  run: async (p, ctx) => {
    if ((p.group_id === undefined) === (p.user_id === undefined)) {
      return failedResponse(RETCODE.BAD_REQUEST, "exactly one of group_id and user_id is required");
    }
    if (!p.emoji_id.trim()) return failedResponse(RETCODE.BAD_REQUEST, "emoji_id is required");
    const face = await ctx.bridge.apis.profile.resolveCustomFace(p.emoji_id);
    const message: Record<string, unknown>[] = [];
    if (p.reply_to !== undefined) message.push({ type: "reply", data: { id: String(p.reply_to) } });
    message.push({
      type: "image",
      data: { file: face.url, sub_type: 1, summary: "[动画表情]" },
    });
    const groupId = p.group_id;
    if (groupId !== undefined) {
      const sent = await ctx.sendGroupMessage(groupId, message, false);
      return okResponse({ message_id: sent.messageId });
    }
    const sent = await ctx.sendPrivateMessage(p.user_id!, message, false);
    return okResponse({ message_id: sent.messageId });
  },
});

// ===========================================================================
// send_msg
// ===========================================================================

interface SendMsgParams {
  message: unknown;
  message_type?: string | undefined;
  group_id?: number | undefined;
  user_id?: number | undefined;
  auto_escape: boolean;
}

const sendMsg = defineAction<SendMsgParams, ActionContext>({
  name: "send_msg",
  summary: "发送消息（按 message_type/群号 自动路由群聊或私聊）",
  returns: "{ message_id: number }",
  params: {
    message: f.message(),
    message_type: f.string().optional(),
    group_id: sendMsgOptionalGroupId(),
    user_id: f.userId().optional(),
    auto_escape: f.bool().default(false),
  },
  run: async (p, ctx) => {
    const isTempReply = p.message_type === "private" && p.user_id !== undefined && p.group_id !== undefined;
    if (!isTempReply && (p.message_type === "group" || p.group_id !== undefined)) {
      if (p.group_id === undefined) return failedResponse(RETCODE.BAD_REQUEST, "group_id is required");
      const sent = await ctx.sendGroupMessage(p.group_id, p.message, p.auto_escape);
      return okResponse({ message_id: sent.messageId });
    }
    if (p.user_id === undefined) return failedResponse(RETCODE.BAD_REQUEST, "user_id is required");
    const sent = await ctx.sendPrivateMessage(
      p.user_id,
      p.message,
      p.auto_escape,
      isTempReply ? p.group_id : undefined,
    );
    return okResponse({ message_id: sent.messageId });
  },
});

// ===========================================================================
// send_private_msg
// ===========================================================================

interface SendPrivateMsgParams {
  user_id: number;
  message: unknown;
  group_id?: number | undefined;
  auto_escape: boolean;
}

const sendPrivateMsg = defineAction<SendPrivateMsgParams, ActionContext>({
  name: "send_private_msg",
  summary: "发送私聊消息",
  returns: "{ message_id: number }",
  params: {
    user_id: f.userId(),
    message: f.message(),
    // `int({min:0}).optional()`, NOT `groupId()`: 0 is accepted here and means
    // "no temp session". `groupId()` would reject it with "must be >= 1".
    group_id: f.int({ min: 0 }).optional(),
    auto_escape: f.bool().default(false),
  },
  run: async (p, ctx) => {
    const tempGroupId = p.group_id && p.group_id > 0 ? p.group_id : undefined;
    const sent = await ctx.sendPrivateMessage(p.user_id, p.message, p.auto_escape, tempGroupId);
    return okResponse({ message_id: sent.messageId });
  },
});

// ===========================================================================
// send_group_msg
// ===========================================================================

interface SendGroupMsgParams {
  group_id: number;
  message: unknown;
  auto_escape: boolean;
}

const sendGroupMsg = defineAction<SendGroupMsgParams, ActionContext>({
  name: "send_group_msg",
  summary: "发送群消息",
  returns: "{ message_id: number }",
  params: {
    group_id: f.groupId().describe("群号"),
    message: f.message(),
    auto_escape: f.bool().default(false),
  },
  run: async (p, ctx) => {
    const sent = await ctx.sendGroupMessage(p.group_id, p.message, p.auto_escape);
    return okResponse({ message_id: sent.messageId });
  },
});

// ===========================================================================
// get_msg
// ===========================================================================

interface GetMsgParams {
  message_id: number;
}

const getMsg = defineAction<GetMsgParams, ActionContext>({
  name: "get_msg",
  readOnly: true,
  summary: "获取消息",
  returns:
    "消息事件对象（去除 post_type/self_id，附带 real_id）；逐个尝试刷新图片、语音和视频 URL，成功使用新地址，失败保留该段原地址并继续返回消息；地址更新时同步 raw_message。",
  params: { message_id: f.messageId() },
  run: async (p, ctx) => {
    const data = (await ctx.getMessage(p.message_id)) ?? null;
    if (!data) return failedResponse(RETCODE.ACTION_FAILED, "message not found");
    const result: Record<string, unknown> = { ...data };
    delete result["post_type"];
    delete result["self_id"];
    // `real_id` is the event's own message_id when it has one, and the REQUESTED id
    // when it does not — so an old stored record with no message_id still answers
    // with the id the caller asked about.
    result["real_id"] = result["message_id"] ?? p.message_id;
    await ctx.refreshMessageMedia(p.message_id, result);
    return okResponse(result);
  },
});

// ===========================================================================
// delete_msg
// ===========================================================================

interface DeleteMsgParams {
  message_id: number;
}

const deleteMsg = defineAction<DeleteMsgParams, ActionContext>({
  name: "delete_msg",
  summary: "撤回消息",
  returns: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording",
  params: { message_id: f.messageId() },
  run: async (p, ctx) => {
    const meta: StoredMessageMeta | null | undefined = await ctx.getMessageMeta(p.message_id);
    if (!meta) return failedResponse(RETCODE.ACTION_FAILED, "message not found or not retractable");
    await ctx.deleteMessage(p.message_id, meta);
    // `okResponse()` with no argument — the data is literally `null`, not `{}`.
    return okResponse();
  },
});

export const messageActions: ActionSpec<Record<string, unknown>, ActionContext>[] = [
  sendCustomFace as ActionSpec<Record<string, unknown>, ActionContext>,
  sendMsg as ActionSpec<Record<string, unknown>, ActionContext>,
  sendPrivateMsg as ActionSpec<Record<string, unknown>, ActionContext>,
  sendGroupMsg as ActionSpec<Record<string, unknown>, ActionContext>,
  getMsg as ActionSpec<Record<string, unknown>, ActionContext>,
  deleteMsg as ActionSpec<Record<string, unknown>, ActionContext>,
];