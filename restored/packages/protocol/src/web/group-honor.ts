// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/web/group-honor.ts"
// original bundle lines 8877-8917  (39 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
init_logger();
var log$63 = createLogger("Bridge.Web");
var WebHonorType = /* @__PURE__ */ function(WebHonorType) {
	WebHonorType["TALKATIVE"] = "talkative";
	WebHonorType["PERFORMER"] = "performer";
	WebHonorType["LEGEND"] = "legend";
	WebHonorType["EMOTION"] = "emotion";
	WebHonorType["ALL"] = "all";
	return WebHonorType;
}({});
async function fetchHonorData(cookieObject, groupCode, type) {
	let resJson;
	try {
		const res = await RequestUtil.HttpGetText(`https://qun.qq.com/interactive/honorlist?${new URLSearchParams({
			gc: groupCode,
			type: type.toString()
		}).toString()}`, "GET", "", { Cookie: cookieToString(cookieObject) });
		const match = /window\.__INITIAL_STATE__=(.*?);/.exec(res);
		if (match?.[1]) resJson = JSON.parse(match[1].trim());
		return type === 1 ? resJson?.talkativeList : resJson?.actorList;
	} catch (e) {
		throw new Error(`获取群 ${groupCode} 类型 ${type} 的荣誉信息失败: ${e}`);
	}
}
async function getHonorListWebAPI(cookieObject, groupCode, type) {
	try {
		const data = await fetchHonorData(cookieObject, groupCode, type);
		if (!data) return [];
		return data.map((item) => ({
			user_id: item?.uin ?? null,
			nickname: item?.name ?? "",
			avatar: item?.avatar ?? "",
			description: item?.desc ?? ""
		}));
	} catch (e) {
		log$63.warn("getHonorListWebAPI failed (group=%s type=%d): %s", groupCode, type, e instanceof Error ? e.stack ?? e.message : String(e));
		return [];
	}
}
export {};
