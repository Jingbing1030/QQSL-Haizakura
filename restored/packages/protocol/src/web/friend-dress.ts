// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/web/friend-dress.ts"
// original bundle lines 11022-11176  (153 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var FriendDressError = class extends Error {
	kind;
	constructor(kind, message, options) {
		super(message, options);
		this.kind = kind;
		this.name = "FriendDressError";
	}
};
/** appId → 装扮类别（取自装扮页 business-name / tab 文案）。 */
var APP_KIND = {
	2: "气泡",
	4: "挂件",
	5: "字体",
	15: "名片",
	17: "来电",
	22: "彩色屏保",
	23: "头像",
	47: "头像双击动作",
	352: "输入状态"
};
/**
* 服务器不会回真值的装扮类型：气泡(2)/字体(5)/头像(23)。这几类只按 targetUin 查
* 永远回默认款，必须客户端在请求里带对应 id 才知道对方用了啥 —— 拿到也是废数据，剔除。
*/
var UNRESOLVABLE_APPS = /* @__PURE__ */ new Set([
	2,
	5,
	23
]);
/**
* HAR 里的 traceDetail：base64({"appid":"toaio","page_id":"37","item_id":"","item_type":""})。
* 与 targetUin 无关，固定值；已是编码后的串，拼接时不可再被二次编码。
*/
var TRACE_DETAIL = "base64-eyJhcHBpZCI6InRvYWlvIiwicGFnZV9pZCI6IjM3IiwiaXRlbV9pZCI6IiIsIml0ZW1fdHlwZSI6%0AIiJ9%0A";
/** aio webview 的移动端 UA（照 HAR；桌面 UA 可能返回不同壳）。 */
var DRESS_UA = "Mozilla/5.0 (Linux; Android 13; 2109119BC Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/121.0.6167.71 MQQBrowser/6.2 TBS/047925 Mobile Safari/537.36 V1_AND_SQ_9.2.66_13188_YYB_D QQ/9.2.66.33870 NetType/WIFI WebP/0.3.0 AppId/537339358";
var DRESS_RESPONSE_LIMITS = {
	timeoutMs: 1e4,
	maxResponseBytes: 2 * 1024 * 1024
};
/** 按 targetUin 拼装扮页 URL（结构照 HAR）。 */
function buildDressUrl(targetUin) {
	const inner = `https://zb.vip.qq.com/v2/pages/aioDressPage?fromPage=1&targetUin=${targetUin}&widgetId=0&fontEffectId=0&bgId=custom&chatId=${targetUin}&isGroup=0&traceDetail=${TRACE_DETAIL}`;
	return `https://zb.vip.qq.com/v2/pages/aioDressPage?${new URLSearchParams({
		fromPage: "1",
		enteranceId: "aio",
		url: inner,
		fontEffectId: "0",
		chatId: targetUin,
		widgetId: "0",
		targetUin,
		isGroup: "0",
		bgId: "custom"
	}).toString()}&traceDetail=${TRACE_DETAIL}`;
}
/** 从 SSR HTML 抠出 window.__INITIAL_ASYNCDATA__ 的 JSON（抠不到/坏 JSON 抛 parse）。 */
function parseAsyncData(html) {
	const m = html.match(/window\.__INITIAL_ASYNCDATA__\s*=\s*(\{[\s\S]*?\});\(function/);
	if (!m?.[1]) throw new FriendDressError("parse", "装扮页中未找到 __INITIAL_ASYNCDATA__（未登录态/风控/页面改版）");
	try {
		return JSON.parse(m[1]);
	} catch (e) {
		throw new FriendDressError("parse", "__INITIAL_ASYNCDATA__ 不是合法 JSON", { cause: e });
	}
}
/** 运行时结构校验：不符合预期的一律抛 structure，绝不带着畸形数据继续。 */
function validateAsyncData(data) {
	if (data === null || typeof data !== "object" || Array.isArray(data)) throw new FriendDressError("structure", "__INITIAL_ASYNCDATA__ 顶层不是对象");
	const d = data;
	if (typeof d["targetUin"] !== "string" || d["targetUin"].length === 0) throw new FriendDressError("structure", "targetUin 缺失或不是非空字符串");
	if (d["isSvip"] !== void 0 && typeof d["isSvip"] !== "boolean") throw new FriendDressError("structure", "isSvip 不是布尔值");
	if (d["avatarImage"] !== void 0 && typeof d["avatarImage"] !== "string") throw new FriendDressError("structure", "avatarImage 不是字符串");
	if (!Array.isArray(d["rawUsingList"])) throw new FriendDressError("structure", "rawUsingList 缺失或不是数组");
	d["rawUsingList"].forEach((item, i) => {
		if (item === null || typeof item !== "object" || Array.isArray(item)) throw new FriendDressError("structure", `rawUsingList[${i}] 不是对象`);
		const r = item;
		if (typeof r["appId"] !== "number") throw new FriendDressError("structure", `rawUsingList[${i}].appId 缺失或不是数字`);
		if (r["itemId"] !== void 0 && typeof r["itemId"] !== "number") throw new FriendDressError("structure", `rawUsingList[${i}].itemId 不是数字`);
		if (r["name"] !== void 0 && typeof r["name"] !== "string") throw new FriendDressError("structure", `rawUsingList[${i}].name 不是字符串`);
		if (r["image"] !== void 0 && typeof r["image"] !== "string") throw new FriendDressError("structure", `rawUsingList[${i}].image 不是字符串`);
		if (r["extraappinfo"] !== void 0) {
			if (r["extraappinfo"] === null || typeof r["extraappinfo"] !== "object" || Array.isArray(r["extraappinfo"])) throw new FriendDressError("structure", `rawUsingList[${i}].extraappinfo 不是对象`);
			const extraInfo = r["extraappinfo"]["extraInfo"];
			if (extraInfo !== void 0) {
				if (extraInfo === null || typeof extraInfo !== "object" || Array.isArray(extraInfo)) throw new FriendDressError("structure", `rawUsingList[${i}].extraappinfo.extraInfo 不是对象`);
				const immersiveMaterial = extraInfo["immersiveMaterial"];
				if (immersiveMaterial !== void 0 && typeof immersiveMaterial !== "string") throw new FriendDressError("structure", `rawUsingList[${i}].extraappinfo.extraInfo.immersiveMaterial 不是字符串`);
			}
		}
	});
	return data;
}
/**
* 抠出该装扮项的动态预览视频 url（没有则空串）。
*  - 名片(appId 15)：video 藏在 extraInfo.immersiveMaterial（JSON 字符串）的 videoUrl。
*  - 来电(appId 17)：无独立字段，按预览图同目录换名 (web_)image.jpg → media.mp4
*    （funCall/item/{itemId}/media.mp4，已验证可访问）；文件名不匹配时不猜测，返回空串。
*/
function resolveVideoUrl(r) {
	if (r.appId === 15) {
		const raw = r.extraappinfo?.extraInfo?.immersiveMaterial;
		if (raw === void 0) return "";
		let material;
		try {
			material = JSON.parse(raw);
		} catch (error) {
			throw new FriendDressError("structure", `装扮 appId=${r.appId} itemId=${r.itemId ?? 0} 的 immersiveMaterial 不是合法 JSON`, { cause: error });
		}
		if (material === null || typeof material !== "object" || Array.isArray(material)) throw new FriendDressError("structure", `装扮 appId=${r.appId} itemId=${r.itemId ?? 0} 的 immersiveMaterial 不是对象`);
		const videoUrl = material["videoUrl"];
		if (typeof videoUrl !== "string" || videoUrl.length === 0) throw new FriendDressError("structure", `装扮 appId=${r.appId} itemId=${r.itemId ?? 0} 的 immersiveMaterial.videoUrl 缺失或不是非空字符串`);
		return videoUrl;
	}
	if (r.appId === 17 && r.image && /\/(?:web_)?image\.jpg$/.test(r.image)) return r.image.replace(/\/(?:web_)?image\.jpg$/, "/media.mp4");
	return "";
}
function toItem(r) {
	return {
		app_id: r.appId,
		kind: APP_KIND[r.appId] ?? `appId=${r.appId}`,
		item_id: r.itemId ?? 0,
		name: r.name ?? "",
		preview_url: r.image ?? "",
		video_url: resolveVideoUrl(r),
		price: typeof r.extrainfo?.price === "number" ? r.extrainfo.price : 0
	};
}
/**
* 查 targetUin 正在用的好友装扮（挂件/名片/来电/输入状态等）。「查到但没装扮」
* 正常返回空 items；请求/解析/校验的任何一环失败都抛 {@link FriendDressError}，
* 带 kind 区分网络、未登录态/风控、页面改版、串号数据。
*/
async function getFriendDressWebAPI(cookieObject, targetUin) {
	let html;
	try {
		html = await RequestUtil.HttpGetText(buildDressUrl(targetUin), "GET", "", {
			Cookie: cookieToString(cookieObject),
			"User-Agent": DRESS_UA,
			Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"Accept-Language": "zh-CN,zh;q=0.9"
		}, DRESS_RESPONSE_LIMITS);
	} catch (e) {
		throw new FriendDressError("network", `装扮页请求失败: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
	}
	const data = validateAsyncData(parseAsyncData(html));
	if (data.targetUin !== targetUin) throw new FriendDressError("uin_mismatch", `装扮页返回账号 ${data.targetUin} 与请求账号 ${targetUin} 不一致`);
	return {
		target_uin: data.targetUin,
		is_svip: data.isSvip ?? false,
		avatar_url: data.avatarImage ?? "",
		items: data.rawUsingList.filter((r) => !UNRESOLVABLE_APPS.has(r.appId)).map(toItem)
	};
}
export {};
