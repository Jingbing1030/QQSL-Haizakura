// 4.2 — the group-admin family (24 actions) from ../onebot/src/actions/group-admin.ts.
//
// Reference region: reference/index.mjs:9664-10340 (`actions$9`, 24 definitions).
//
// ---------------------------------------------------------------------------
// 22 do work, 2 are documented no-ops
// ---------------------------------------------------------------------------
// `set_group_anonymous` and `set_group_anonymous_ban` take no params and their
// entire body is `run: () => okResponse()`. They are NOT stubs in the "forgot to
// implement" sense: the bundle's own `summary` says 「未实现，返回 ok」. So the port
// reproduces them as `okResponse()` with `data: null` — and a test asserts that
// they call NOTHING on the bridge, because making them do something would be
// inventing protocol.
//
// ---------------------------------------------------------------------------
// `okResponse()` vs `okResponse(undefined)` vs `okResponse({})`
// ---------------------------------------------------------------------------
// Every mutator here returns `okResponse()` with no argument, whose data is `null`
// (types.ts `okResponse(data = null)`). Nineteen of them, so a single mistake in a
// shared helper would flip 19 responses from `null` to `undefined`/`{}` and the
// `_ctx, _body => {}` lesson (MEMORY §2.3ad) would repeat at the action layer.
// The tests assert `data === null` for all of them, and one mutation test flips a
// single action to `okResponse({})` to prove the assertion catches it.
//
// ---------------------------------------------------------------------------
// Which params are `default(...)` vs `optional()`
// ---------------------------------------------------------------------------
// This matters because an `optional()` field passes `undefined` to the bridge while
// a `default(x)` field passes `x`:
//
//   set_group_kick        reject_add_request  bool().default(false)
//   set_group_ban         duration            duration().default(1800)
//   set_group_whole_ban   enable              bool().default(true)
//   set_group_add_option  add_type            int({min:0}).default(0)
//                         group_question      string().optional()
//                         group_answer        string().optional()
//   set_group_search      no_finger_open      int({min:0}).optional()
//                         no_code_finger_open int({min:0}).optional()
//   set_group_admin       enable              bool().default(true)
//   set_group_card        card                string().default("")
//   set_group_name        group_name          string().default("")
//   set_group_special_title special_title     string().default("")
//   set_group_new_member_history_visibility visible  bool()   ← REQUIRED, no default
//   set_group_admin_receive_verify           enable   bool()   ← REQUIRED, no default
//
// The last two are the ones an implementer tends to make optional out of habit.
// ---------------------------------------------------------------------------
// The three validation rules on `set_group_admin_permissions`
// ---------------------------------------------------------------------------
// They live in `rules:` (declarative), so they run BEFORE `run` and produce 1400
// with the rule doc as wording. The middle rule's allowed set is exactly
// [0,5,10,20,50,100,200] — the OIDB layer's own check is looser, so this list is the
// only place the 200 ceiling is enforced for this action.

import {
  defineAction,
  f,
  groupAction,
  groupUserAction,
  okResponse,
  type ActionSpec,
} from "./kit.js";
import type { ActionContext, MemberInvitePolicy } from "./context.js";

const mutators: ActionSpec<Record<string, unknown>, ActionContext>[] = [];

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

mutators.push(
  groupUserAction<{ reject_add_request: boolean }, ActionContext>({
    name: "set_group_kick",
    summary: "踢出群成员",
    params: { reject_add_request: f.bool().default(false) },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.kickMember(p.group_id, p.user_id, p.reject_add_request);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  groupAction<{ user_id: number[]; reject_add_request: boolean }, ActionContext>({
    name: "set_group_kick_members",
    summary: "批量踢出群成员",
    params: {
      // `array(memberId()).nonEmpty()` — an EMPTY array is 1400, not a no-op.
      user_id: f.array(f.memberId()).nonEmpty(),
      reject_add_request: f.bool().default(false),
    },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.kickMembers(p.group_id, p.user_id, p.reject_add_request);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  groupUserAction<{ duration: number }, ActionContext>({
    name: "set_group_ban",
    summary: "禁言群成员（duration=0 解除）",
    params: { duration: f.duration().default(1800) },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.muteMember(p.group_id, p.user_id, p.duration);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  groupAction<{ enable: boolean }, ActionContext>({
    name: "set_group_whole_ban",
    summary: "全员禁言开关",
    params: { enable: f.bool().default(true) },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.muteAll(p.group_id, p.enable);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  groupAction<{ add_type: number; group_question?: string | undefined; group_answer?: string | undefined }, ActionContext>({
    name: "set_group_add_option",
    summary: "设置加群选项",
    params: {
      add_type: f.int({ min: 0 }).default(0),
      group_question: f.string().optional(),
      group_answer: f.string().optional(),
    },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.setAddOption(p.group_id, p.add_type, p.group_question, p.group_answer);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  groupAction<{ no_finger_open?: number | undefined; no_code_finger_open?: number | undefined }, ActionContext>({
    name: "set_group_search",
    summary: "设置群被搜索方式（群指纹 / 群号搜索开关）",
    params: {
      no_finger_open: f.int({ min: 0 }).optional(),
      no_code_finger_open: f.int({ min: 0 }).optional(),
    },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.setSearch(p.group_id, p.no_finger_open, p.no_code_finger_open);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  groupAction<{ policy: MemberInvitePolicy }, ActionContext>({
    name: "set_group_member_invite_policy",
    summary: "设置群成员邀请策略",
    params: { policy: f.enum("disabled", "require_approval", "no_approval", "no_approval_under_100") },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.setMemberInvitePolicy(p.group_id, p.policy);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  groupAction<{ visible: boolean }, ActionContext>({
    name: "set_group_new_member_history_visibility",
    summary: "设置新成员是否可查看历史消息",
    params: { visible: f.bool() },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.setNewMemberHistoryVisibility(p.group_id, p.visible);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  groupAction<
    {
      allow_member_upload_album?: boolean | undefined;
      allow_member_temporary_session?: boolean | undefined;
      allow_member_create_group?: boolean | undefined;
    },
    ActionContext
  >({
    name: "set_group_member_permissions",
    summary: "设置群成员权限（仅群主可改）",
    params: {
      allow_member_upload_album: f.bool().optional(),
      allow_member_temporary_session: f.bool().optional(),
      allow_member_create_group: f.bool().optional(),
    },
    rules: (r) => [
      r.atLeastOneOf("allow_member_upload_album", "allow_member_temporary_session", "allow_member_create_group"),
    ],
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.setMemberPermissions(p.group_id, {
        allowMemberUploadAlbum: p.allow_member_upload_album,
        allowMemberTemporarySession: p.allow_member_temporary_session,
        allowMemberCreateGroup: p.allow_member_create_group,
      });
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

mutators.push(
  groupAction<Record<string, never>, ActionContext>({
    name: "get_group_admin_settings",
    summary: "获取群管理设置的当前值",
    readOnly: true,
    returns: "与对应设置接口字段对齐的当前群管理设置。",
    params: {},
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.groupAdmin.getAdminSettings(p.group_id)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  defineAction<{ group_class: number }, ActionContext>({
    name: "get_group_tags",
    summary: "读取某个群分类下的资料标签",
    readOnly: true,
    returns: "该分类下的资料标签列表。",
    params: { group_class: f.int({ min: 0, max: 4_294_967_295 }) },
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.groupAdmin.listCategoryTags(p.group_class)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  defineAction<{ group_class: number; name: string }, ActionContext>({
    name: "add_group_tag",
    summary: "向某个群分类添加资料标签",
    params: {
      group_class: f.int({ min: 0, max: 4_294_967_295 }),
      // `allowEmpty: false` — a blank tag name is 1400 "name: must not be empty".
      name: f.string({ allowEmpty: false }),
    },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.addCategoryTag(p.group_class, p.name);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  defineAction<{ group_class: number; name: string }, ActionContext>({
    name: "delete_group_tag",
    summary: "从某个群分类移除资料标签",
    params: {
      group_class: f.int({ min: 0, max: 4_294_967_295 }),
      name: f.string({ allowEmpty: false }),
    },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.removeCategoryTag(p.group_class, p.name);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

mutators.push(
  groupUserAction<{ enable: boolean }, ActionContext>({
    name: "set_group_admin",
    summary: "设置/取消管理员",
    params: { enable: f.bool().default(true) },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.setAdmin(p.group_id, p.user_id, p.enable);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  groupUserAction<Record<string, never>, ActionContext>({
    name: "get_group_admin_permissions",
    summary: "读取指定管理员的撤回、移除成员、每日移除上限及接收验证消息状态",
    readOnly: true,
    returns:
      "服务器返回的管理员权限；未返回或未指定的开关为 null。每日上限仅在移除权限开启时返回，0 表示不限。",
    params: {},
    run: async (p, ctx) => okResponse(await ctx.bridge.apis.groupAdmin.getAdminPermissions(p.group_id, p.user_id)),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  groupUserAction<
    {
      recall_member_message?: boolean | undefined;
      kick_member?: boolean | undefined;
      kick_member_per_day?: number | undefined;
    },
    ActionContext
  >({
    name: "set_group_admin_permissions",
    summary: "设置指定管理员的撤回和移除成员权限",
    returns: "服务器确认请求后 data 为 null；不代表已经过客户端回读验证。可用 get_group_admin_permissions 查询。",
    params: {
      recall_member_message: f.bool().optional(),
      kick_member: f.bool().optional(),
      kick_member_per_day: f.int({ min: 0, max: 200 }).optional(),
    },
    rules: (r) => [
      // Note: `atLeastOneOf` covers only the two BOOLEANS. Sending
      // `kick_member_per_day` alone passes this rule and is caught by the third.
      r.atLeastOneOf("recall_member_message", "kick_member"),
      r.rule("kick_member=true requires kick_member_per_day: 0, 5, 10, 20, 50, 100 or 200", (p) => {
        if (p["kick_member"] !== true) return true;
        const perDay = p["kick_member_per_day"];
        return perDay !== undefined && [0, 5, 10, 20, 50, 100, 200].includes(perDay as number);
      }),
      r.rule("kick_member_per_day requires kick_member=true", (p) => p["kick_member_per_day"] === undefined || p["kick_member"] === true),
    ],
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.setAdminPermissions(p.group_id, p.user_id, {
        recallMemberMessage: p.recall_member_message,
        kickMember: p.kick_member,
        kickMemberPerDay: p.kick_member_per_day,
      });
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  groupUserAction<{ enable: boolean }, ActionContext>({
    name: "set_group_admin_receive_verify",
    summary: "设置指定管理员是否接收加群验证消息",
    returns: "服务器响应确认目标群和管理员后 data 为 null；未确认目标时返回错误。",
    params: { enable: f.bool() },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.setAdminReceiveVerify(p.group_id, p.user_id, p.enable);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ---------------------------------------------------------------------------
// Identity within the group
// ---------------------------------------------------------------------------

mutators.push(
  groupUserAction<{ card: string }, ActionContext>({
    name: "set_group_card",
    summary: "设置群名片（空字符串清除）",
    params: { card: f.string().default("") },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.setCard(p.group_id, p.user_id, p.card);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  groupAction<{ group_name: string }, ActionContext>({
    name: "set_group_name",
    summary: "设置群名",
    params: { group_name: f.string().default("") },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.setName(p.group_id, p.group_name);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  groupAction<Record<string, never>, ActionContext>({
    name: "set_group_leave",
    summary: "退群",
    params: {},
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.leave(p.group_id);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

mutators.push(
  groupUserAction<{ special_title: string }, ActionContext>({
    name: "set_group_special_title",
    summary: "设置群头衔",
    params: { special_title: f.string().default("") },
    run: async (p, ctx) => {
      await ctx.bridge.apis.groupAdmin.setSpecialTitle(p.group_id, p.user_id, p.special_title);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ---------------------------------------------------------------------------
// The two documented no-ops
// ---------------------------------------------------------------------------

/**
 * `set_group_anonymous` (reference:10270).
 *
 * The bundle's summary is 「匿名开关（未实现，返回 ok）」 — it is an intentional
 * compatibility stub that answers success WITHOUT changing anything. Ported
 * verbatim, including `params: {}`: this action accepts no parameters at all, so
 * `{group_id: 1}` still parses (unknown keys are ignored) and answers 0/null.
 */
mutators.push(
  defineAction<Record<string, never>, ActionContext>({
    name: "set_group_anonymous",
    summary: "匿名开关（未实现，返回 ok）",
    params: {},
    run: () => okResponse(),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

/** `set_group_anonymous_ban` (reference:10282) — same status as its sibling. */
mutators.push(
  defineAction<Record<string, never>, ActionContext>({
    name: "set_group_anonymous_ban",
    summary: "匿名禁言（未实现，返回 ok）",
    params: {},
    run: () => okResponse(),
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ---------------------------------------------------------------------------
// set_group_portrait
// ---------------------------------------------------------------------------

mutators.push(
  groupAction<{ file: string }, ActionContext>({
    name: "set_group_portrait",
    summary: "设置群头像",
    params: { file: f.image() },
    run: async (p, ctx) => {
      await ctx.bridge.apis.profile.setGroupAvatar(p.group_id, p.file);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

export const groupAdminActions: ActionSpec<Record<string, unknown>, ActionContext>[] = mutators;

/** 24 definitions; the registry asserts this so a dropped action is a test failure. */
export const GROUP_ADMIN_COUNT = 24;