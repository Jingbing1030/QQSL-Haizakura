// 4.2 — the group-info family (7 actions) from ../onebot/src/actions/group-info.ts.
//
// Reference region: reference/index.mjs:8918-9664 (`actions$10`, 7 definitions).
//
// ---------------------------------------------------------------------------
// The three "provider absent" fallbacks all differ
// ---------------------------------------------------------------------------
// Each getter tests `if (ctx.getX)` and answers something else when it is absent.
// Those fallbacks are not interchangeable and are NOT all empty:
//
//   get_group_list        (no provider) → `[]`
//   get_group_info        (no provider) → a full 10-field zero object
//   get_group_member_list (no provider) → `[]`
//   get_group_member_info (no provider) → a 13-field object WITHOUT the three
//                                          qidian flags, which the
//                                          provider-returned-null branch DOES have
//   get_group_honor_info  (no provider) → NOT a presence test at all: it calls
//                                          `apis.web.getHonorInfo` and catches
//   get_group_system_msg  (no provider) → `[]`
//
// The member-info asymmetry is the one worth staring at: `getGroupMemberInfo`
// answering `null` means "the provider ran and did not find the member", which
// still yields qidian flags as 0; the provider being absent yields an object with no
// qidian keys at all. A test that only asserts "role === 'member'" passes both.
//
// ---------------------------------------------------------------------------
// `get_group_share_link`'s three defaults
// ---------------------------------------------------------------------------
// `need_short_url` is `bool().default(true)` — note `true`, not `false`, which is
// the opposite of every other `bool().default()` in this batch. `src_id` is
// `int({min:0,max:4294967295}).default(73)`. `additional_param` is
// `string().default("")`. Changing the 73 or the `true` silently changes the URL.

import {
  defineAction,
  f,
  RETCODE,
  failedResponse,
  groupAction,
  groupUserAction,
  okResponse,
  type ActionSpec,
} from "./kit.js";
import type { ActionContext } from "./context.js";

// ===========================================================================
// get_group_share_link
// ===========================================================================

interface GroupShareLinkParams {
  group_id: number;
  need_short_url: boolean;
  src_id: number;
  additional_param: string;
}

const getGroupShareLink = groupAction<Omit<GroupShareLinkParams, "group_id">, ActionContext>({
  name: "get_group_share_link",
  summary: "获取群分享链接",
  readOnly: true,
  returns: "用于分享或邀请加群的链接，可作为群二维码内容。",
  params: {
    need_short_url: f.bool().default(true).describe("是否获取短链接"),
    src_id: f.int({ min: 0, max: 4_294_967_295 }).default(73).describe("来源标识（兼容参数）"),
    additional_param: f.string().default("").describe("附加参数"),
  },
  run: async (p, ctx) =>
    okResponse({
      url: await ctx.bridge.apis.contacts.getGroupShareLink(p.group_id, p.need_short_url, p.src_id, p.additional_param),
    }),
});

// ===========================================================================
// get_group_list
// ===========================================================================

interface GetGroupListParams {
  no_cache: boolean;
}

const getGroupList = defineAction<GetGroupListParams, ActionContext>({
  name: "get_group_list",
  summary: "获取群列表",
  readOnly: true,
  returns: "群信息对象数组。",
  params: { no_cache: f.bool().default(false) },
  run: async (p, ctx) => {
    if (ctx.getGroupList) return okResponse(await ctx.getGroupList(p.no_cache));
    return okResponse([]);
  },
});

// ===========================================================================
// get_group_info
// ===========================================================================

interface GetGroupInfoParams {
  group_id: number;
  no_cache: boolean;
}

/**
 * The 10-field zero object `get_group_info` answers with when no provider is
 * installed. `group_all_shut` is 0 (= not muted), not -1.
 */
function emptyGroupInfo(groupId: number): Record<string, unknown> {
  return {
    group_id: groupId,
    group_name: "",
    group_remark: "",
    member_count: 0,
    max_member_count: 0,
    group_create_time: 0,
    group_level: 0,
    group_memo: "",
    group_description: "",
    group_all_shut: 0,
  };
}

const getGroupInfo = groupAction<Omit<GetGroupInfoParams, "group_id">, ActionContext>({
  name: "get_group_info",
  summary: "获取群信息",
  readOnly: true,
  returns: "群信息对象。",
  params: { no_cache: f.bool().default(false) },
  run: async (p, ctx) => {
    const fallback = emptyGroupInfo(p.group_id);
    if (ctx.getGroupInfo) return okResponse((await ctx.getGroupInfo(p.group_id, p.no_cache)) ?? fallback);
    return okResponse(fallback);
  },
});

// ===========================================================================
// get_group_member_list
// ===========================================================================

interface GetGroupMemberListParams {
  group_id: number;
  no_cache: boolean;
}

const getGroupMemberList = groupAction<Omit<GetGroupMemberListParams, "group_id">, ActionContext>({
  name: "get_group_member_list",
  summary: "获取群成员列表",
  readOnly: true,
  returns: "群成员信息对象数组。",
  params: { no_cache: f.bool().default(false) },
  run: async (p, ctx) => {
    if (ctx.getGroupMemberList) return okResponse(await ctx.getGroupMemberList(p.group_id, p.no_cache));
    return okResponse([]);
  },
});

// ===========================================================================
// get_group_member_info
// ===========================================================================

interface GetGroupMemberInfoParams {
  group_id: number;
  user_id: number;
  no_cache: boolean;
}

const getGroupMemberInfo = groupUserAction<Omit<GetGroupMemberInfoParams, "group_id" | "user_id">, ActionContext>({
  name: "get_group_member_info",
  summary: "获取群成员信息",
  readOnly: true,
  returns: "群成员信息对象。",
  params: { no_cache: f.bool().default(false) },
  run: async (p, ctx) => {
    if (ctx.getGroupMemberInfo) {
      const found = await ctx.getGroupMemberInfo(p.group_id, p.user_id, p.no_cache);
      if (found) return okResponse(found);
      // Provider ran, member unknown. NOTE the three qidian flags: they are present
      // as 0 here and ABSENT from the provider-less fallback below.
      return okResponse({
        group_id: p.group_id,
        user_id: p.user_id,
        nickname: "",
        card: "",
        is_robot: false,
        sex: "unknown",
        age: 0,
        join_time: 0,
        last_sent_time: 0,
        shut_up_timestamp: 0,
        level: "0",
        role: "member",
        title: "",
        qidian_master_flag: 0,
        qidian_crew_flag: 0,
        qidian_crew_flag_2: 0,
      });
    }
    return okResponse({
      group_id: p.group_id,
      user_id: p.user_id,
      nickname: "",
      card: "",
      is_robot: false,
      sex: "unknown",
      age: 0,
      join_time: 0,
      last_sent_time: 0,
      shut_up_timestamp: 0,
      level: "0",
      role: "member",
      title: "",
    });
  },
});

// ===========================================================================
// get_group_honor_info
// ===========================================================================

/**
 * The honour types, as the bundle's own enum values (reference:8880
 * `WebHonorType`). `Object.values()` order is declaration order, which is what the
 * "must be one of" wording uses.
 */
export const WEB_HONOR_TYPES = ["talkative", "performer", "legend", "emotion", "all"] as const;

interface GetGroupHonorInfoParams {
  group_id: number;
  type?: string | undefined;
}

const getGroupHonorInfo = groupAction<Omit<GetGroupHonorInfoParams, "group_id">, ActionContext>({
  name: "get_group_honor_info",
  summary: "获取群荣誉信息",
  readOnly: true,
  returns: "群荣誉信息；未请求的分类为空数组，当前龙王可能为 null。",
  params: { type: f.string().optional() },
  run: async (p, ctx) => {
    // `p.type || "all"` — an empty string also means "all", not "invalid".
    const typeStr = p.type || "all";
    if (!(WEB_HONOR_TYPES as readonly string[]).includes(typeStr)) {
      return failedResponse(RETCODE.BAD_REQUEST, `invalid type, must be one of ${WEB_HONOR_TYPES.join(", ")}`);
    }
    try {
      return okResponse(await ctx.bridge.apis.web.getHonorInfo(p.group_id, typeStr));
    } catch (e) {
      return failedResponse(RETCODE.ACTION_FAILED, `failed to get group honor info: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
});

// ===========================================================================
// get_group_system_msg
// ===========================================================================

interface GetGroupSystemMsgParams {
  group_id?: number | undefined;
  only_pending: boolean;
  count: number;
}

const getGroupSystemMsg = defineAction<GetGroupSystemMsgParams, ActionContext>({
  name: "get_group_system_msg",
  summary: "获取群系统消息",
  readOnly: true,
  returns: "群系统消息数组，可按群号或未处理状态过滤。",
  params: {
    group_id: f.groupId().optional(),
    only_pending: f.bool().default(false),
    count: f.int({ min: 1, max: 100 }).default(50).describe("每个收件箱最多读取的记录数"),
  },
  run: async (p, ctx) => {
    if (ctx.handleGetGroupSystemMsg) {
      return okResponse(
        await ctx.handleGetGroupSystemMsg({
          groupId: p.group_id,
          onlyPending: p.only_pending,
          count: p.count,
        }),
      );
    }
    return okResponse([]);
  },
});

export const groupInfoActions: ActionSpec<Record<string, unknown>, ActionContext>[] = [
  getGroupShareLink as ActionSpec<Record<string, unknown>, ActionContext>,
  getGroupList as ActionSpec<Record<string, unknown>, ActionContext>,
  getGroupInfo as ActionSpec<Record<string, unknown>, ActionContext>,
  getGroupMemberList as ActionSpec<Record<string, unknown>, ActionContext>,
  getGroupMemberInfo as ActionSpec<Record<string, unknown>, ActionContext>,
  getGroupHonorInfo as ActionSpec<Record<string, unknown>, ActionContext>,
  getGroupSystemMsg as ActionSpec<Record<string, unknown>, ActionContext>,
];