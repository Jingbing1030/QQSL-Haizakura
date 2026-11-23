// 4.6 (part 1) — the friend family (3) and the request family (2).
//
// Reference regions:
//   ../onebot/src/actions/friend.ts   reference/index.mjs:8216-8421  (`actions$11`, 3)
//   ../onebot/src/actions/request.ts  reference/index.mjs:10924-11263 (`actions$7`, 2)
//
// ---------------------------------------------------------------------------
// Why these two families live in one file
// ---------------------------------------------------------------------------
// Not just because the task batch pairs them. Both `delete_friend` (friend.ts) and
// `set_friend_add_request` (request.ts) call `ctx.bridge.apis.friend.*`, and both
// `set_group_add_request` (request.ts) and `get_group_system_msg` (group-info.ts)
// work with the same five-field `slreq:1:…` flag grammar that
// `oidb/services/0x10c0.ts` owns. Co-locating the two families keeps the flag
// contract visible next to one of its two producers.
//
// ---------------------------------------------------------------------------
// `get_stranger_info`'s two fallback shapes are DIFFERENT and both are observable
// ---------------------------------------------------------------------------
// Reference:8283.
//
//     if (ctx.getStrangerInfo) return okResponse(await ctx.getStrangerInfo(id) ?? {MINIMAL});
//     return okResponse({MINIMAL});
//
// The provider-present branch can therefore answer the provider's own object, or —
// when the provider answers null/undefined — the five-field MINIMAL object. The
// provider-absent branch answers MINIMAL unconditionally. So the two branches
// coincide only when the provider misses. Both are reproduced because a wrong
// reading here (`ctx.getStrangerInfo ? ... : {}` with a spread) loses the null
// coalescing, and `get_stranger_info` for an unknown QQ then answers `null` data
// instead of a profile-shaped object with `sex: "unknown"`.
//
// `get_friend_list` has the mirror-image asymmetry, and the reference states both:
// with a provider and `with_profile: true`, a profile-fetch failure is a HARD error
// (100), not a silent fallback — because the caller explicitly asked for profiles.
//
// ---------------------------------------------------------------------------
// `set_group_add_request`'s sub_type/type aliasing
// ---------------------------------------------------------------------------
//     const subType = p.sub_type !== void 0 ? p.sub_type : p.type !== void 0 ? p.type : "add";
//
// Three-way, in that precedence order, with `"add"` as the final default. Note the
// reference passes `_subType` (UNUSED) to the context's `handleGroupRequest`
// (reference:40057: `(flag, _subType, approve, reason) => …`). The action still
// computes `subType` and passes it — the provider ignores it — because the
// computation is observable through a custom context that records its arguments,
// and the differential test asserts the recorded triple.

import { defineAction, f, okResponse, failedResponse, RETCODE, type ActionSpec } from "./kit.js";
import type { ActionContext } from "./context.js";

const friendActions: ActionSpec<Record<string, unknown>, ActionContext>[] = [];

// ===========================================================================
// 好友 (3)
// ===========================================================================

friendActions.push(
  defineAction<{ with_profile: boolean }, ActionContext>({
    name: "get_friend_list",
    readOnly: true,
    summary: "获取好友列表",
    returns:
      "好友列表，包含账号、昵称、备注及回包已有的公开资料；with_profile=true 时主动补查，失败会报错。未返回的资料省略，零、空字符串和 false 保留。",
    params: {
      with_profile: f
        .bool()
        .default(false)
        .describe("主动补查好友公开资料，按账号缓存五分钟；大列表可能耗时较长"),
    },
    run: async (p, ctx) => {
      if (ctx.getFriendList) return okResponse(await ctx.getFriendList(p.with_profile));
      // No provider AND profiles requested: an empty array would claim "you have no
      // friends", which is a different fact from "this host cannot enrich profiles".
      if (p.with_profile) return failedResponse(RETCODE.ACTION_FAILED, "friend profile provider unavailable");
      return okResponse([]);
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

friendActions.push(
  defineAction<{ user_id: number }, ActionContext>({
    name: "get_stranger_info",
    readOnly: true,
    summary: "获取陌生人信息",
    returns:
      "用户资料，含账号标识、等级别名和可用的注册时间、生日、会员信息。注册时间、生日或会员信息未返回时省略对应字段，出生年份未公开时只省略年份；登录天数暂无可靠来源，不返回占位值。",
    params: { user_id: f.userId().describe("QQ 号") },
    run: async (p, ctx) => {
      const userId = p.user_id;
      if (ctx.getStrangerInfo) {
        // `?? MINIMAL` — a provider that answers null is treated as a miss, not as
        // "the profile is null". See the header.
        return okResponse(
          (await ctx.getStrangerInfo(userId)) ?? {
            user_id: userId,
            nickname: "",
            remark: "",
            sex: "unknown",
            age: 0,
            long_nick: "",
          },
        );
      }
      return okResponse({
        user_id: userId,
        nickname: "",
        remark: "",
        sex: "unknown",
        age: 0,
        long_nick: "",
      });
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

friendActions.push(
  defineAction<{ user_id: number; block: boolean }, ActionContext>({
    name: "delete_friend",
    summary: "删除好友",
    params: { user_id: f.userId().describe("QQ 号"), block: f.bool().default(false) },
    run: async (p, ctx) => {
      await ctx.bridge.apis.friend.delete(p.user_id, p.block);
      // `okResponse()` — null data, matching the reference's bare form here. Unlike
      // the qzone mutators (which write an explicit `null`), this one uses the
      // default, so the port keeps the same token to make the two files diffable.
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

// ===========================================================================
// 请求 (2)
// ===========================================================================

friendActions.push(
  defineAction<{ flag: string; approve: boolean }, ActionContext>({
    name: "set_friend_add_request",
    summary: "处理好友添加请求",
    params: { flag: f.string({ allowEmpty: false }), approve: f.bool().default(true) },
    run: async (p, ctx) => {
      await ctx.bridge.apis.friend.handleRequest(p.flag, p.approve);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

friendActions.push(
  defineAction<
    { flag: string; sub_type?: string | undefined; type?: string | undefined; approve: boolean; reason: string },
    ActionContext
  >({
    name: "set_group_add_request",
    summary: "处理加群请求",
    params: {
      flag: f.string({ allowEmpty: false }),
      sub_type: f.string().optional(),
      type: f.string().optional(),
      approve: f.bool().default(true),
      reason: f.string().default(""),
    },
    run: async (p, ctx) => {
      // Three-way precedence, then "add". `p.sub_type !== void 0` rather than
      // `p.sub_type ?? p.type ?? "add"`: the latter would treat a present empty
      // string as absent, and `sub_type: ""` is a present value here.
      const subType = p.sub_type !== undefined ? p.sub_type : p.type !== undefined ? p.type : "add";
      // `handleGroupRequest` is OPTIONAL on this port's context only because the
      // same interface serves the ~40 actions that do guard their providers. The
      // reference calls it unguarded, so reaching this line without one is a host
      // bug that must fail loudly — throwing a named Error here rather than a bare
      // TypeError keeps the failure legible in the dispatcher's 100 wording.
      if (!ctx.handleGroupRequest) throw new Error("handleGroupRequest provider is not attached");
      await ctx.handleGroupRequest(p.flag, subType, p.approve, p.reason);
      return okResponse();
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

export { friendActions };
export const FRIEND_ACTION_COUNT = friendActions.length;