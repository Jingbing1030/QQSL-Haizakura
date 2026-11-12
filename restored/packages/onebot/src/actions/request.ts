// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/actions/request.ts"
// original bundle lines 10924-10977  (52 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var actions$7 = [defineAction({
	name: "set_friend_add_request",
	examples: [{
		summary: "处理好友添加请求",
		params: {
			flag: "<flag-from-friend-request-event>",
			approve: true
		},
		notes: "flag 必须原样使用当前账号好友请求事件的 flag，不能根据 QQ 号构造。"
	}],
	returnsSchema: {
		type: "null",
		description: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"
	},
	summary: "处理好友添加请求",
	params: {
		flag: f$1.string({ allowEmpty: false }),
		approve: f$1.bool().default(true)
	},
	run: async (p, ctx) => {
		await ctx.bridge.apis.friend.handleRequest(p.flag, p.approve);
		return okResponse();
	}
}), defineAction({
	name: "set_group_add_request",
	examples: [{
		summary: "处理加群请求",
		params: {
			flag: "<flag-from-group-request-event>",
			sub_type: "add",
			approve: true
		},
		notes: "flag 和 sub_type 原样取自同一条群请求事件；邀请事件使用 invite。"
	}],
	returnsSchema: {
		type: "null",
		description: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"
	},
	summary: "处理加群请求",
	params: {
		flag: f$1.string({ allowEmpty: false }),
		sub_type: f$1.string().optional(),
		type: f$1.string().optional(),
		approve: f$1.bool().default(true),
		reason: f$1.string().default("")
	},
	run: async (p, ctx) => {
		const subType = p.sub_type !== void 0 ? p.sub_type : p.type !== void 0 ? p.type : "add";
		await ctx.handleGroupRequest(p.flag, subType, p.approve, p.reason);
		return okResponse();
	}
})];
export {};
