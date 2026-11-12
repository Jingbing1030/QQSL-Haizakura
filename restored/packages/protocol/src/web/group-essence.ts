// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/web/group-essence.ts"
// original bundle lines 338456-338511  (54 lines) of dist/index.mjs
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
var log$25 = createLogger("Bridge.Web");
var MAX_ESSENCE_PAGES = 20;
/**
* 分页获取群精华消息
*/
async function getGroupEssenceMsg(cookieObject, groupCode, pageStart = 0, pageLimit = 50) {
	const bkn = getBknFromCookie(cookieObject);
	const url = `https://qun.qq.com/cgi-bin/group_digest/digest_list?${new URLSearchParams({
		bkn,
		page_start: pageStart.toString(),
		page_limit: pageLimit.toString(),
		group_code: groupCode
	}).toString()}`;
	try {
		const ret = await RequestUtil.HttpGetJson(url, "GET", "", { Cookie: cookieToString(cookieObject) });
		if (ret.retcode !== 0) throw new Error(`group essence request failed with retcode ${ret.retcode}: ${ret.retmsg ?? "unknown error"}`);
		if (ret.data?.is_end === true && ret.data.msg_list == null) {
			log$25.debug("normalized empty group essence response (group=%s page=%d/%d)", groupCode, pageStart, pageLimit);
			return {
				...ret,
				data: {
					...ret.data,
					is_end: true,
					msg_list: []
				}
			};
		}
		if (!ret.data || typeof ret.data.is_end !== "boolean" || !Array.isArray(ret.data.msg_list)) throw new Error("invalid group essence response: data.is_end or data.msg_list is missing");
		return {
			...ret,
			data: {
				...ret.data,
				is_end: ret.data.is_end,
				msg_list: ret.data.msg_list
			}
		};
	} catch (e) {
		log$25.warn("getGroupEssenceMsg failed (group=%s page=%d/%d): %s", groupCode, pageStart, pageLimit, e instanceof Error ? e.stack ?? e.message : String(e));
		throw e;
	}
}
/**
* 获取所有群精华消息 (最多循环 20 页)
*/
async function getGroupEssenceMsgAll(cookieObject, groupCode) {
	const ret = [];
	for (let i = 0; i < MAX_ESSENCE_PAGES; i++) {
		const data = await getGroupEssenceMsg(cookieObject, groupCode, i, 50);
		ret.push(data);
		if (data.data.is_end) return ret;
	}
	throw new Error(`group essence pagination exceeded ${MAX_ESSENCE_PAGES} pages for group ${groupCode}`);
}
export {};
