// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/web/group-signin.ts"
// original bundle lines 338512-338568  (55 lines) of dist/index.mjs
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
var log$24 = createLogger("Bridge.Web");
/**
* Pure transform from the qun.qq.com response into the OneBot list.
* The server returns `signInRank` on a doubled-and-offset scale
* (1, 3, 5, …); NapCat de-skews it with `(rank - 1) / 2 + 1` to recover
* the human 1-based rank — we mirror that exactly. Missing page/infos
* yields an empty list rather than throwing, so a group with no sign-ins
* is an empty result, not an error.
*/
function mapDaySignedList(data) {
	const infos = data.response?.page?.[0]?.infos;
	if (!infos) return [];
	return infos.map((info) => ({
		user_id: Number(info.uid),
		nick: info.uidGroupNick,
		time: Number(info.signedTimeStamp),
		rank: (Number(info.signInRank) - 1) / 2 + 1
	}));
}
/** YYYYMMDD for the given Date (defaults to today), the form the endpoint wants. */
function yyyymmdd(d = /* @__PURE__ */ new Date()) {
	return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
/**
* Fetch today's group sign-in (打卡) list via the qun.qq.com web API.
* Mirrors NapCat's `getDaySignedList`: POST JSON to the signin trpc
* endpoint with `g_tk` derived from p_skey and the cookie jar.
*
* Errors PROPAGATE (transport failure, or a page-less response — which the
* endpoint returns when auth/cookie is bad): we do NOT swallow them to [],
* because that would make an expired cookie indistinguishable from a group
* with zero sign-ins. A genuinely empty group returns page→empty infos,
* which maps to []. The caller (onebot action) turns a throw into a failed
* response. Matches NapCat, which throws on a missing page.
*/
async function getDaySignedListWebAPI(cookieObject, groupCode, selfUin, day) {
	const url = `https://qun.qq.com/v2/signin/trpc/GetDaySignedList?g_tk=${getBknFromCookie(cookieObject)}`;
	const body = {
		dayYmd: yyyymmdd(day),
		offset: 0,
		limit: 100,
		uid: selfUin,
		groupId: groupCode
	};
	const data = await RequestUtil.HttpGetJson(url, "POST", body, {
		Cookie: cookieToString(cookieObject),
		"Content-Type": "application/json"
	}, true, true);
	if (!data.response?.page) {
		log$24.warn("getDaySignedList: no page in response (group=%s) — likely auth/cookie failure", groupCode);
		throw new Error("无法获取该群组打卡列表");
	}
	return mapDaySignedList(data);
}
export {};
