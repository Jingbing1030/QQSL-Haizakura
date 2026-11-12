// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/web/qzone.ts"
// original bundle lines 335588-336659  (1070 lines) of dist/index.mjs
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
var log$26 = createLogger("Bridge.Web");
/**
* Parse a Qzone CGI body that may be raw JSON or a JSONP callback wrapper
* (`_Callback({...});` / `callback({...})`). Uses a layered fallback approach:
*
* 1. Try direct JSON.parse on the first `{` to last `}` slice.
* 2. Try `back({...})` pattern (the original approach).
* 3. Extract `back(...)` content, trim, then locate `{}` inside.
*
* This is robust to the various callback name variants Qzone uses.
* Throws if no object body is present (e.g. an HTML error page).
*/
function parseQzoneJson(text) {
	const s = text.trim();
	try {
		const start = s.indexOf("{");
		const end = s.lastIndexOf("}");
		if (start !== -1 && end !== -1 && end > start) return JSON.parse(s.slice(start, end + 1));
	} catch {}
	try {
		const start = s.indexOf("back({");
		const end = s.lastIndexOf("})");
		if (start !== -1 && end !== -1 && end > start) return JSON.parse(s.slice(start + 5, end + 1));
	} catch {}
	const backStart = s.lastIndexOf("back(");
	if (backStart === -1) throw new Error("invalid response from qzone api");
	const callEnd = s.indexOf(");", backStart);
	if (callEnd === -1) throw new Error("invalid response from qzone api");
	const inner = s.slice(backStart + 5, callEnd).trim();
	const braceStart = inner.indexOf("{");
	const braceEnd = inner.lastIndexOf("}");
	if (braceStart === -1 || braceEnd === -1 || braceEnd < braceStart) throw new Error("invalid response from qzone api");
	return JSON.parse(inner.slice(braceStart, braceEnd + 1));
}
/**
* Parse the JavaScript OBJECT-LITERAL payload of a Qzone JSONP feeds response
* WITHOUT executing it. feeds3_html_more returns `_preloadCallback({ … })` where
* the `data` value uses unquoted keys, single-quoted strings, `\xNN` escapes and
* literal `undefined`s — it is meant to be eval'd by the browser callback, so
* JSON.parse chokes on it. We ran the alternatives to ground: no param combo
* (outputhtmlfeed/format) makes the CGI emit real JSON, and feeds are pure
* remote H5 (absent from the native client), so there is no cleaner endpoint.
* Rather than eval remote-controlled content (a `vm` sandbox is not a security
* boundary — a tampered body escapes it to RCE), we recursively DESCEND the
* literal as data: it can only ever produce a value, never run code.
*
* Handles the subset the CGI emits: objects (unquoted or quoted keys), arrays
* (incl. `undefined`/elided holes), single/double-quoted strings with JS escapes
* (`\xNN`, `\uNNNN`, `\/`, …), numbers and `true|false|null|undefined`.
* `__proto__` keys are dropped (no prototype pollution).
*/
function parseJsLiteral(src) {
	let i = 0;
	const n = src.length;
	const isWs = (c) => c === " " || c === "	" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
	const skipWs = () => {
		while (i < n && isWs(src[i])) i++;
	};
	function parseString(quote) {
		i++;
		let out = "";
		while (i < n) {
			const c = src[i];
			if (c === "\\") {
				const e = src[i + 1];
				if (e === "x") {
					out += String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16));
					i += 4;
					continue;
				}
				if (e === "u") {
					out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
					i += 6;
					continue;
				}
				out += e !== void 0 ? {
					n: "\n",
					t: "	",
					r: "\r",
					b: "\b",
					f: "\f",
					v: "\v",
					"0": "\0"
				}[e] ?? e : "";
				i += 2;
				continue;
			}
			if (c === quote) {
				i++;
				return out;
			}
			out += c;
			i++;
		}
		throw new Error("unterminated string in qzone feeds payload");
	}
	function parseKey() {
		skipWs();
		const c = src[i];
		if (c === "\"" || c === "'") return parseString(c);
		let s = "";
		while (i < n && /[A-Za-z0-9_$]/.test(src[i])) {
			s += src[i];
			i++;
		}
		if (!s) throw new Error("expected object key in qzone feeds payload");
		return s;
	}
	function parseObject() {
		i++;
		const obj = {};
		skipWs();
		if (src[i] === "}") {
			i++;
			return obj;
		}
		for (;;) {
			const key = parseKey();
			skipWs();
			if (src[i] !== ":") throw new Error("expected \":\" in qzone feeds payload");
			i++;
			const value = parseValue();
			if (key !== "__proto__") obj[key] = value;
			skipWs();
			const ch = src[i];
			if (ch === ",") {
				i++;
				skipWs();
				if (src[i] === "}") {
					i++;
					return obj;
				}
				continue;
			}
			if (ch === "}") {
				i++;
				return obj;
			}
			throw new Error("expected \",\" or \"}\" in qzone feeds payload");
		}
	}
	function parseArray() {
		i++;
		const arr = [];
		skipWs();
		if (src[i] === "]") {
			i++;
			return arr;
		}
		for (;;) {
			arr.push(parseValue());
			skipWs();
			const ch = src[i];
			if (ch === ",") {
				i++;
				skipWs();
				if (src[i] === "]") {
					i++;
					return arr;
				}
				continue;
			}
			if (ch === "]") {
				i++;
				return arr;
			}
			throw new Error("expected \",\" or \"]\" in qzone feeds payload");
		}
	}
	function parseValue() {
		skipWs();
		const c = src[i];
		if (c === void 0) throw new Error("unexpected end of qzone feeds payload");
		if (c === "{") return parseObject();
		if (c === "[") return parseArray();
		if (c === "\"" || c === "'") return parseString(c);
		let token = "";
		while (i < n && !/[,}\]:\s]/.test(src[i])) {
			token += src[i];
			i++;
		}
		if (token === "true") return true;
		if (token === "false") return false;
		if (token === "null") return null;
		if (token === "undefined") return;
		if (token !== "") {
			const num = Number(token);
			if (!Number.isNaN(num)) return num;
		}
		throw new Error("unexpected token in qzone feeds payload: " + token.slice(0, 20));
	}
	return parseValue();
}
/**
* Extract the object a Qzone feeds JSONP body hands to its callback, parsed as
* data (never executed — see {@link parseJsLiteral}). Slices from the first `{`
* (the callback argument) and parses one balanced value; trailing `);` is
* ignored. Throws if the payload is not an object.
*/
function parseQzoneCallback(text) {
	const start = text.indexOf("{");
	if (start === -1) throw new Error("invalid feeds response from qzone api");
	const value = parseJsLiteral(text.slice(start));
	if (value === null || typeof value !== "object") throw new Error("invalid feeds response from qzone api");
	return value;
}
function assertRichParams(richType, richval) {
	if (richType !== void 0 !== (richval !== void 0 && richval.trim() !== "")) throw new Error("richType and richval must be provided together");
	if (richType !== void 0 && (!Number.isInteger(richType) || richType < 1)) throw new Error("richType must be a positive integer");
}
function normalizeQzoneImageBase64(input) {
	let text = input.trim();
	if (/^base64:\/\//i.test(text)) text = text.slice(9).trim();
	if (/^data:/i.test(text)) {
		const comma = text.indexOf(",");
		if (comma === -1) throw new Error("imageBase64 data URI is missing base64 payload");
		text = text.slice(comma + 1);
	}
	const compact = text.replace(/ /g, "+").replace(/[\r\n\t]/g, "");
	if (!compact) throw new Error("imageBase64 is required");
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw new Error("imageBase64 is not valid base64");
	const firstPadding = compact.indexOf("=");
	if (firstPadding !== -1 && /[^=]/.test(compact.slice(firstPadding))) throw new Error("imageBase64 is not valid base64");
	const unpadded = compact.replace(/=+$/, "");
	const remainder = unpadded.length % 4;
	if (remainder === 1) throw new Error("imageBase64 is not valid base64");
	const base64 = unpadded + "=".repeat((4 - remainder) % 4);
	if (Buffer.from(base64, "base64").length === 0) throw new Error("imageBase64 is empty");
	return base64;
}
/** Pick the largest picture URL variant a feed picture offers. */
function pickPicUrl(pic) {
	return pic.url3 || pic.url2 || pic.url1 || pic.smallurl || void 0;
}
/** Pure transform from the raw CGI response into the OneBot list. */
function mapMsgList(data) {
	const list = data.msglist ?? [];
	return {
		total: Number(data.total ?? list.length),
		msglist: list.map((e) => ({
			tid: String(e.tid ?? ""),
			content: e.content ?? "",
			time: Number(e.created_time ?? 0),
			comment_num: Number(e.cmtnum ?? 0),
			is_private: Number(e.secret ?? 0) !== 0,
			images: (e.pic ?? []).map(pickPicUrl).filter((u) => !!u)
		}))
	};
}
/** Legacy route (default): h5.qzone.qq.com → taotao.qzone.qq.com. */
function legacyMsgListRoute(cookieObject, targetUin, pos, num, bkn) {
	return {
		url: `https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_msglist_v6?${new URLSearchParams({
			uin: targetUin,
			ftype: "0",
			sort: "0",
			pos: String(pos),
			num: String(num),
			replynum: "100",
			g_tk: bkn,
			callback: "_preloadCallback",
			code_version: "1",
			format: "jsonp",
			need_private_comment: "1"
		}).toString()}`,
		headers: { Cookie: cookieToString(cookieObject) }
	};
}
/**
* Fallback route: user.qzone.qq.com → taotao.qq.com (NOT taotao.qzone.qq.com).
* Live captures show this pair is not subject to the `-10000` rate-limit the
* legacy route can hit.
*/
function userMsgListRoute(cookieObject, targetUin, pos, num, bkn) {
	return {
		url: `https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6?${new URLSearchParams({
			uin: targetUin,
			ftype: "0",
			sort: "0",
			pos: String(pos),
			num: String(num),
			g_tk: bkn,
			code_version: "1",
			format: "json"
		}).toString()}`,
		headers: {
			Cookie: cookieToString(cookieObject),
			Referer: `https://user.qzone.qq.com/${targetUin}`
		}
	};
}
async function requestMsgList(route, targetUin) {
	const text = await RequestUtil.HttpGetText(route.url, "GET", "", route.headers);
	log$26.trace("getQzoneMsgList raw body (uin=%s): %s", targetUin, text);
	return {
		data: parseQzoneJson(text),
		text
	};
}
/**
* Fetch a 说说 (Qzone emotion/feed) list via the taotao.qzone.qq.com web
* API, proxied through h5.qzone.qq.com — the same cookie/g_tk plumbing the
* group-album helper uses. Defaults to the bot's own space; `targetUin`
* can name any space the bot may view. On a `-10000` rate-limit from that
* route, retries once via the user.qzone.qq.com route (see
* {@link userMsgListRoute}).
*
* Errors PROPAGATE: a transport failure, a non-zero `code` (Qzone's own
* error envelope, e.g. auth/permission), or a missing `msglist` (the body
* an expired cookie produces) all throw — we do NOT swallow them to an
* empty list, because that would make a broken cookie indistinguishable
* from a genuinely empty space. A real empty space returns `msglist: []`,
* which maps to an empty list with the correct `total`. Mirrors the
* group-signin helper's throw-on-auth-failure contract.
*/
async function getQzoneMsgList(cookieObject, targetUin, pos = 0, num = 20) {
	if (!cookieObject || typeof cookieObject !== "object") throw new Error("cookieObject is required");
	const bkn = getBknFromCookie(cookieObject);
	let { data, text } = await requestMsgList(legacyMsgListRoute(cookieObject, targetUin, pos, num, bkn), targetUin);
	if (data.code === -1e4) {
		log$26.warn("getQzoneMsgList: legacy route rate-limited (uin=%s), retrying via user.qzone route", targetUin);
		({data, text} = await requestMsgList(userMsgListRoute(cookieObject, targetUin, pos, num, bkn), targetUin));
	}
	if (typeof data.code === "number" && data.code !== 0) {
		log$26.warn("getQzoneMsgList: non-zero code (uin=%s) code=%d msg=%s", targetUin, data.code, data.message);
		throw new Error(`qzone msglist failed: code=${data.code} ${data.message ?? ""}`.trim());
	}
	if (!Array.isArray(data.msglist)) {
		log$26.warn("getQzoneMsgList: no msglist in response (uin=%s) — likely auth/cookie failure or unverified response shape; body head=%s", targetUin, text.slice(0, 300));
		throw new Error(`无法获取空间说说列表（响应结构异常）: ${text.slice(0, 200)}`);
	}
	return mapMsgList(data);
}
function feedHasMore(data) {
	const value = data.data?.main === void 0 ? data.data?.hasmore : data.data.main.hasMoreFeeds;
	if (value === true || value === 1 || value === "1") return true;
	if (value === false || value === 0 || value === "0") return false;
	throw new Error("空间好友动态缺少有效的分页结束标志");
}
/** Pure mapping; request continuation is attached by getQzoneFeeds. */
function mapFeeds(data) {
	if (!Array.isArray(data.data?.data)) throw new Error("无法获取空间好友动态（响应结构异常）");
	return {
		feeds: data.data.data.filter((item) => item != null).map((item) => {
			if (typeof item !== "object" || Array.isArray(item)) throw new Error("空间好友动态条目结构异常");
			const feed = {
				uin: Number(item.uin ?? 0),
				nickname: item.nickname ?? "",
				time: Number(item.abstime ?? 0),
				appid: Number(item.appid ?? 0),
				key: String(item.key ?? item.feedskey ?? ""),
				html: item.html ?? ""
			};
			if (![
				feed.uin,
				feed.time,
				feed.appid
			].every((n) => Number.isSafeInteger(n) && n >= 0) || typeof feed.nickname !== "string" || typeof feed.html !== "string") throw new Error("空间好友动态条目字段异常");
			return {
				...feed,
				...parseQzoneFeedContent(feed.html, feed.key, feed.uin, feed.appid, item.likecnt, item.commentcnt)
			};
		}),
		has_more: feedHasMore(data),
		next_cursor: null
	};
}
/** Read one page. Legacy page numbers walk continuations from the beginning. */
async function getQzoneFeeds(cookieObject, selfUin, pageNum = 1, count = 10, cursor) {
	if (!cookieObject || typeof cookieObject !== "object") throw new Error("cookieObject is required");
	if (!Number.isSafeInteger(pageNum) || pageNum < 1 || !Number.isSafeInteger(count) || count < 1 || count > 50) throw new Error("空间好友动态页码或数量无效");
	const start = cursor === void 0 ? {
		page: 1,
		state: initialQzoneFeedState()
	} : decodeQzoneFeedCursor(cursor, selfUin);
	if (cursor !== void 0 && pageNum !== 1 && pageNum !== start.page) throw new Error("page_num 与空间好友动态 cursor 不匹配");
	const target = cursor === void 0 ? pageNum : start.page;
	const bkn = getBknFromCookie(cookieObject);
	let state = start.state;
	const seen = /* @__PURE__ */ new Set([qzoneFeedPosition(state)]);
	log$26.debug("getQzoneFeeds start (uin=%s page=%d count=%d cursor=%s)", selfUin, target, count, cursor !== void 0);
	for (let page = start.page; page <= target; page++) {
		const query = new URLSearchParams({
			uin: selfUin,
			scope: "0",
			view: "1",
			gid: "",
			flag: "1",
			filter: "all",
			applist: "all",
			refresh: "0",
			firstGetGroup: "0",
			mixnocache: "0",
			scene: "0",
			sidomain: "qzonestyle.gtimg.cn",
			count: String(count),
			...state,
			getAisort: state.aisortNextTime,
			g_tk: bkn,
			callback: "_preloadCallback",
			format: "jsonp",
			useutf8: "1",
			outputhtmlfeed: "1",
			usertime: String(Date.now()),
			rd: String(Math.random()),
			windowId: String(Math.random())
		});
		query.delete("aisortNextTime");
		const url = `https://h5.qzone.qq.com/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more?${query}`;
		try {
			const data = parseQzoneCallback(await RequestUtil.HttpGetText(url, "GET", "", { Cookie: cookieToString(cookieObject) }));
			if (data.code !== 0 || data.subcode !== void 0 && data.subcode !== 0) throw new Error(`qzone feeds failed: code=${data.code} subcode=${data.subcode ?? 0} ${typeof data.message === "string" ? data.message : ""}`.trim());
			const main = data.data?.main;
			if (main !== void 0 && (main === null || typeof main !== "object" || Array.isArray(main))) throw new Error("空间好友动态分页信息结构异常");
			if (main?.error !== void 0 && main.error !== "") throw new Error("空间好友动态服务端报告拉取失败");
			const result = mapFeeds(data);
			if (result.has_more) {
				if (!main) throw new Error("空间好友动态缺少下一页游标");
				state = nextQzoneFeedState(main, state);
				const position = qzoneFeedPosition(state);
				if (seen.has(position)) throw new Error("空间好友动态分页游标未推进");
				seen.add(position);
				result.next_cursor = encodeQzoneFeedCursor(selfUin, page + 1, state);
			}
			const unavailable = result.feeds.filter((feed) => feed.appid === 311 && feed.content === null).length;
			if (unavailable) log$26.warn("getQzoneFeeds content unavailable (uin=%s page=%d entries=%d)", selfUin, page, unavailable);
			log$26.debug("getQzoneFeeds page (uin=%s page=%d entries=%d more=%s)", selfUin, page, result.feeds.length, result.has_more);
			if (page === target) return result;
			if (!result.has_more) return {
				feeds: [],
				has_more: false,
				next_cursor: null
			};
		} catch (error) {
			log$26.warn("getQzoneFeeds failed (uin=%s page=%d): %s", selfUin, page, error instanceof Error ? error.message : String(error));
			throw error;
		}
	}
	throw new Error("空间好友动态分页未完成");
}
var QZONE_UGC_RIGHTS = /* @__PURE__ */ new Set([
	1,
	4,
	16,
	64,
	128
]);
function normalizeQzoneUgcRight(ugcRight) {
	if (!QZONE_UGC_RIGHTS.has(ugcRight)) throw new Error("ugc_right must be one of 1, 4, 16, 64, 128");
	return ugcRight;
}
function normalizeTargetUins(targetUins) {
	const raw = (targetUins ?? "").trim();
	if (!raw) return "";
	const seen = /* @__PURE__ */ new Set();
	for (const part of raw.split("|")) {
		const uin = part.trim();
		if (!uin) continue;
		if (!/^\d+$/.test(uin)) throw new Error("target_uins must contain QQ numbers separated by |");
		seen.add(uin);
	}
	return [...seen].join("|");
}
/**
* Publish a 说说 via taotao.qzone.qq.com's emotion_cgi_publish_v6 CGI
* (proxied through h5.qzone.qq.com). POSTs a form-urlencoded body with
* `g_tk` in the query, on the bot's own space (`hostUin`).
*
* `richType` / `richval`: for image posts, set `richType=1` and pass the
* richval string(s) from {@link uploadQzoneImage} (multi-image: join with
* `\t`). Omit both for text-only posts.
*
* Errors PROPAGATE: a transport failure, a non-zero Qzone `code` (its error
* envelope, e.g. content rejected / rate-limited), or a success body that
* carries no `tid` all throw — we never report a publish as succeeded
* without the server-assigned feed id.
*/
async function publishQzoneMsg(cookieObject, hostUin, content, richType, richval, ugcRight = 1, targetUins) {
	if (!cookieObject || typeof cookieObject !== "object") throw new Error("cookieObject is required");
	if (!content) throw new Error("content is required");
	assertRichParams(richType, richval);
	const right = normalizeQzoneUgcRight(ugcRight);
	const effectiveTargetUins = right === 16 || right === 128 ? normalizeTargetUins(targetUins) : "";
	if ((right === 16 || right === 128) && !effectiveTargetUins) throw new Error("target_uins is required when ugc_right is 16 or 128");
	const url = `https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6?g_tk=${getBknFromCookie(cookieObject)}`;
	const bodyParams = new URLSearchParams({
		syn_tweet_verson: "1",
		paramstr: "1",
		pic_template: "",
		richtype: richType !== void 0 ? String(richType) : "",
		richval: richval ?? "",
		special_url: "",
		subrichtype: "",
		con: content,
		feedversion: "1",
		ver: "1",
		ugc_right: String(right),
		to_sign: "0",
		who: "1",
		hostuin: hostUin,
		code_version: "1",
		format: "json",
		qzreferrer: `https://user.qzone.qq.com/${hostUin}`
	});
	if (effectiveTargetUins) bodyParams.set("allow_uins", effectiveTargetUins);
	const body = bodyParams.toString();
	const data = parseQzoneJson(await RequestUtil.HttpGetText(url, "POST", body, {
		Cookie: cookieToString(cookieObject),
		"Content-Type": "application/x-www-form-urlencoded"
	}));
	if (typeof data.code === "number" && data.code !== 0) {
		log$26.warn("publishQzoneMsg: non-zero code (uin=%s) code=%d msg=%s", hostUin, data.code, data.message);
		throw new Error(`qzone publish failed: code=${data.code} ${data.message ?? ""}`.trim());
	}
	const tid = data.t1_tid ?? data.tid;
	if (!tid) {
		log$26.warn("publishQzoneMsg: no tid in response (uin=%s) — publish likely rejected", hostUin);
		throw new Error("发表说说失败：响应缺少 tid");
	}
	return {
		tid: String(tid),
		time: Number(data.t1_time ?? data.now ?? 0)
	};
}
/**
* Delete a 说说 by `tid` via taotao.qzone.qq.com's emotion_cgi_delete_v6 CGI
* (proxied through h5.qzone.qq.com), on the bot's own space. Resolves on
* success; THROWS on a transport failure or a non-zero Qzone `code` (e.g. an
* unknown/foreign tid, or an auth failure). Only the bot's own feeds can be
* deleted — the server rejects a tid the `hostUin` doesn't own.
*/
async function deleteQzoneMsg(cookieObject, hostUin, tid) {
	if (!cookieObject || typeof cookieObject !== "object") throw new Error("cookieObject is required");
	if (!tid) throw new Error("tid is required");
	const url = `https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_delete_v6?g_tk=${getBknFromCookie(cookieObject)}`;
	const body = new URLSearchParams({
		hostuin: hostUin,
		tid,
		t1_source: "1",
		code_version: "1",
		format: "fs",
		qzreferrer: `https://user.qzone.qq.com/${hostUin}`
	}).toString();
	const data = parseQzoneJson(await RequestUtil.HttpGetText(url, "POST", body, {
		Cookie: cookieToString(cookieObject),
		"Content-Type": "application/x-www-form-urlencoded"
	}));
	if (typeof data.code === "number" && data.code !== 0) {
		log$26.warn("deleteQzoneMsg: non-zero code (uin=%s tid=%s) code=%d msg=%s", hostUin, tid, data.code, data.message);
		throw new Error(`qzone delete failed: code=${data.code} ${data.message ?? ""}`.trim());
	}
	if (typeof data.subcode === "number" && data.subcode !== 0) {
		log$26.warn("deleteQzoneMsg: non-zero subcode (uin=%s tid=%s) subcode=%d msg=%s", hostUin, tid, data.subcode, data.message);
		throw new Error(`qzone delete failed: subcode=${data.subcode} ${data.message ?? ""}`.trim());
	}
}
/**
* Like or unlike a 说说 by `tid` on `targetUin`'s space, as the bot
* (`opUin`). `abstime` is the target feed's post time (unix seconds) — pass
* the real value (from get_qzone_feeds/msglist) for reliability; 0 is a
* tolerated fallback. Resolves on success; THROWS on a transport failure or
* a non-zero Qzone `code`/`subcode`. `like=false` hits the (unverified)
* unlike CGI.
*/
async function setQzoneLike(cookieObject, opUin, targetUin, tid, like, abstime = 0) {
	if (!cookieObject || typeof cookieObject !== "object") throw new Error("cookieObject is required");
	if (!tid) throw new Error("tid is required");
	const bkn = getBknFromCookie(cookieObject);
	const url = `https://h5.qzone.qq.com/proxy/domain/w.qzone.qq.com/cgi-bin/likes/${like ? "internal_dolike_app" : "internal_unlike_app"}?g_tk=${bkn}`;
	const unikey = `http://user.qzone.qq.com/${targetUin}/mood/${tid}`;
	const body = new URLSearchParams({
		qzreferrer: `https://user.qzone.qq.com/${opUin}`,
		opuin: opUin,
		unikey,
		curkey: unikey,
		appid: "311",
		typeid: "0",
		abstime: String(abstime),
		fid: tid,
		from: "1",
		active: "0",
		fupdate: "1",
		format: "json"
	}).toString();
	const data = parseQzoneJson(await RequestUtil.HttpGetText(url, "POST", body, {
		Cookie: cookieToString(cookieObject),
		"Content-Type": "application/x-www-form-urlencoded"
	}));
	const verb = like ? "like" : "unlike";
	if (typeof data.code === "number" && data.code !== 0) {
		log$26.warn("setQzoneLike(%s): non-zero code (tid=%s) code=%d msg=%s", verb, tid, data.code, data.message);
		throw new Error(`qzone ${verb} failed: code=${data.code} ${data.message ?? ""}`.trim());
	}
	if (typeof data.subcode === "number" && data.subcode !== 0) {
		log$26.warn("setQzoneLike(%s): non-zero subcode (tid=%s) subcode=%d msg=%s", verb, tid, data.subcode, data.message);
		throw new Error(`qzone ${verb} failed: subcode=${data.subcode} ${data.message ?? ""}`.trim());
	}
}
/**
* Upload an image from a source (file:// / http:// / base64://) to Qzone
* hosting. Loads the image via {@link loadBinarySource}, converts to base64,
* and uploads via {@link uploadQzoneImage}.
*
* `source` supports:
* - `file://` local file path
* - `http://` or `https://` remote URL
* - `base64://` base64-encoded data (with or without data-URI prefix)
*
* Errors PROPAGATE from both the load step and the upload step.
*/
async function uploadQzoneImageFromSource(cookieObject, hostUin, source) {
	if (/^base64:\/\//i.test(source)) return uploadQzoneImage(cookieObject, hostUin, source);
	const { loadBinarySource } = await Promise.resolve().then(() => (init_utils(), utils_exports));
	const loaded = await loadBinarySource(source, "qzone-image");
	return uploadQzoneImage(cookieObject, hostUin, Buffer.from(loaded.bytes).toString("base64"));
}
/**
* Upload an image (as base64) to Qzone hosting via up.qzone.qq.com's
* cgi_upload_image CGI. Returns metadata including the `richval` string
* (for use in {@link publishQzoneMsg}'s richval param) and the direct URL.
* Multi-image publish: call this once per image and join the richval strings
* with `\t`.
*
* `imageBase64` is the raw base64-encoded image bytes; a data-URI prefix is
* tolerated and stripped. Errors PROPAGATE: invalid base64, a transport
* failure, a non-zero Qzone `code`/`subcode`, or a success body missing
* required fields all throw.
*/
async function uploadQzoneImage(cookieObject, hostUin, imageBase64) {
	if (!cookieObject || typeof cookieObject !== "object") throw new Error("cookieObject is required");
	if (!imageBase64) throw new Error("imageBase64 is required");
	const base64 = normalizeQzoneImageBase64(imageBase64);
	const skey = cookieObject["skey"] || "";
	const pskey = cookieObject["p_skey"] || "";
	const bkn = getBknFromCookie(cookieObject);
	const url = `https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image?g_tk=${bkn}`;
	const body = new URLSearchParams({
		filename: "filename",
		uin: hostUin,
		skey,
		zzpaneluin: hostUin,
		p_uin: hostUin,
		p_skey: pskey,
		uploadtype: "1",
		albumtype: "7",
		exttype: "0",
		refer: "shuoshuo",
		output_type: "jsonhtml",
		charset: "utf-8",
		output_charset: "utf-8",
		upload_hd: "1",
		hd_width: "2048",
		hd_height: "10000",
		hd_quality: "96",
		backUrls: `http://upbak.photo.qzone.qq.com/cgi-bin/upload/cgi_upload_image,http://119.147.64.75/cgi-bin/upload/cgi_upload_image&url=https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image?g_tk=${bkn}`,
		base64: "1",
		jsonhtml_callback: "callback",
		picfile: base64,
		qzreferrer: `https://user.qzone.qq.com/${hostUin}/main`
	}).toString();
	let jsonText = (await RequestUtil.HttpGetText(url, "POST", body, {
		Cookie: cookieToString(cookieObject),
		"Content-Type": "application/x-www-form-urlencoded"
	})).trim();
	const callbackStart = jsonText.indexOf("callback");
	if (callbackStart !== -1) jsonText = jsonText.slice(callbackStart);
	const data = parseQzoneJson(jsonText);
	if (typeof data.code === "number" && data.code !== 0) {
		log$26.warn("uploadQzoneImage: non-zero code (uin=%s) code=%d msg=%s", hostUin, data.code, data.message);
		throw new Error(`qzone upload image failed: code=${data.code} ${data.message ?? ""}`.trim());
	}
	if (typeof data.subcode === "number" && data.subcode !== 0) {
		log$26.warn("uploadQzoneImage: non-zero subcode (uin=%s) subcode=%d msg=%s", hostUin, data.subcode, data.message);
		throw new Error(`qzone upload image failed: subcode=${data.subcode} ${data.message ?? ""}`.trim());
	}
	if (!data.data || !data.data.albumid || !data.data.lloc || !data.data.url) {
		log$26.warn("uploadQzoneImage: missing required fields in response (uin=%s)", hostUin);
		throw new Error("上传图片失败:响应缺少必要字段");
	}
	const { albumid, lloc, url: imageUrl, type, height, width } = data.data;
	return {
		richval: `,${albumid},${lloc},${lloc},${type ?? 0},${height ?? 0},${width ?? 0},,${height ?? 0},${width ?? 0}`,
		url: imageUrl,
		albumid,
		lloc,
		type: type ?? 0,
		width: width ?? 0,
		height: height ?? 0
	};
}
/**
* Ban (blacklist) or unban a user in the bot's QQ-Zone space via
* w.qzone.qq.com's cgi_black_action_new CGI (proxied through
* h5.qzone.qq.com). `ban=true` adds the target to the blacklist
* (action=1); `ban=false` removes them (action=2). Resolves on success;
* THROWS on a transport failure or a non-zero Qzone `subcode`.
* Confirmed against php-qzone/qzone.class.php:setQzoneRight.
*/
async function setQzoneBlack(cookieObject, selfUin, targetUin, ban) {
	if (!cookieObject || typeof cookieObject !== "object") throw new Error("cookieObject is required");
	if (!targetUin) throw new Error("targetUin is required");
	const url = `https://h5.qzone.qq.com/proxy/domain/w.qzone.qq.com/cgi-bin/right/cgi_black_action_new?g_tk=${getBknFromCookie(cookieObject)}`;
	const body = new URLSearchParams({
		uin: selfUin,
		act_uin: targetUin,
		action: ban ? "1" : "2",
		fupdate: "1",
		qzreferrer: `https://user.qzone.qq.com/${selfUin}/main`
	}).toString();
	const text = await RequestUtil.HttpGetText(url, "POST", body, {
		Cookie: cookieToString(cookieObject),
		"Content-Type": "application/x-www-form-urlencoded"
	});
	let data;
	try {
		data = parseQzoneJson(text.replace(/\{\s*name\s*:/, "{\"name\":"));
	} catch {
		const snippet = text.trim().slice(0, 300);
		throw new Error(`qzone ${ban ? "ban" : "unban"} failed: ${snippet}${text.length > 300 ? "…" : ""}`);
	}
	const verb = ban ? "ban" : "unban";
	if (typeof data.subcode === "number" && data.subcode !== 0) {
		const msg = data.message ?? data.msg ?? "";
		log$26.warn("setQzoneBlack(%s): non-zero subcode (target=%s) subcode=%d msg=%s", verb, targetUin, data.subcode, msg);
		throw new Error(`qzone ${verb} failed: subcode=${data.subcode} ${msg}`.trim());
	}
	if (typeof data.code === "number" && data.code !== 0) {
		const msg = data.message ?? data.msg ?? "";
		log$26.warn("setQzoneBlack(%s): non-zero code (target=%s) code=%d msg=%s", verb, targetUin, data.code, msg);
		throw new Error(`qzone ${verb} failed: code=${data.code} ${msg}`.trim());
	}
}
async function commentQzoneMsg(cookieObject, selfUin, hostUin, tid, content, richType, richval) {
	if (!cookieObject || typeof cookieObject !== "object") throw new Error("cookieObject is required");
	if (!tid) throw new Error("tid is required");
	if (!content) throw new Error("content is required");
	assertRichParams(richType, richval);
	const url = `https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds?g_tk=${getBknFromCookie(cookieObject)}`;
	const body = new URLSearchParams({
		qzreferrer: `https://user.qzone.qq.com/${selfUin}`,
		inCharset: "utf-8",
		outCharset: "utf-8",
		hostUin,
		format: "json",
		ref: "feeds",
		topicId: `${hostUin}_${tid}__1`,
		feedsType: "100",
		private: "0",
		paramstr: "1",
		richtype: richType !== void 0 ? String(richType) : "",
		richval: richval ?? "",
		isSignIn: "",
		uin: selfUin,
		content,
		plat: "qzone",
		source: "ic",
		platformid: "52"
	}).toString();
	const data = parseQzoneJson(await RequestUtil.HttpGetText(url, "POST", body, {
		Cookie: cookieToString(cookieObject),
		"Content-Type": "application/x-www-form-urlencoded"
	}));
	if (typeof data.code === "number" && data.code !== 0) {
		log$26.warn("commentQzoneMsg: non-zero code (host=%s tid=%s) code=%d msg=%s", hostUin, tid, data.code, data.message);
		throw new Error(`qzone comment failed: code=${data.code} ${data.message ?? ""}`.trim());
	}
	if (typeof data.subcode === "number" && data.subcode !== 0) {
		log$26.warn("commentQzoneMsg: non-zero subcode (host=%s tid=%s) subcode=%d msg=%s", hostUin, tid, data.subcode, data.message);
		throw new Error(`qzone comment failed: subcode=${data.subcode} ${data.message ?? ""}`.trim());
	}
	const commentId = data.commentid ?? data.commentId;
	return { comment_id: commentId !== void 0 ? String(commentId) : "" };
}
/**
* Reply within a Qzone comment thread. The web comment module uses a separate
* reply endpoint: commentId/commentUin identify the parent, not a nested reply.
* The addressed author is an automatic mention in content; there is no replyId
* request field. Images are not part of this request's supported contract.
* Request/result contract: qzonestyle.gtimg.cn/qzone/app/controls/commentModule/
* viewModel/viewModel_3.0_common.js (ReplyViewModel.post).
*/
async function replyQzoneComment(cookieObject, selfUin, hostUin, tid, content, target) {
	if (!cookieObject || typeof cookieObject !== "object") throw new Error("cookieObject is required");
	for (const [field, value] of Object.entries({
		selfUin,
		hostUin,
		commentUin: target.commentUin
	})) if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${field} must be a positive safe integer`);
	if (!tid.trim() || !content.trim() || !target.commentId.trim()) throw new Error("tid, content and commentId must not be blank");
	let replyContent = content;
	if (target.replyTo !== void 0) {
		const { uin, name } = target.replyTo;
		if (!/^[1-9]\d*$/.test(uin) || !Number.isSafeInteger(Number(uin)) || !name.trim()) throw new Error("replyTo requires a positive safe integer uin and a non-blank name");
		replyContent = `@{uin:${uin},nick:${name.trim().replace(/%/g, "%25").replace(/,/g, "%2C").replace(/}/g, "%7D")},auto:1} ${content}`;
	}
	const url = `https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_addreply_ugc?g_tk=${getBknFromCookie(cookieObject)}`;
	const body = new URLSearchParams({
		uin: selfUin,
		hostUin,
		hostuin: selfUin,
		topicId: `${hostUin}_${tid}`,
		commentId: target.commentId,
		commentUin: target.commentUin,
		content: replyContent,
		inCharset: "utf-8",
		outCharset: "utf-8",
		ref: "",
		code_version: "1",
		format: "fs",
		qzreferrer: `https://user.qzone.qq.com/${hostUin}`
	}).toString();
	log$26.debug("replyQzoneComment: posting reply (host=%s tid=%s parent=%s)", hostUin, tid, target.commentId);
	const response = parseQzoneJson(await RequestUtil.HttpGetText(url, "POST", body, {
		Cookie: cookieToString(cookieObject),
		"Content-Type": "application/x-www-form-urlencoded"
	}));
	if (response === null || typeof response !== "object" || Array.isArray(response) || !("code" in response) || typeof response.code !== "number" || !Number.isInteger(response.code)) throw new Error("invalid qzone reply response: missing or invalid code; check delivery before retrying");
	const subcode = "subcode" in response ? response.subcode : void 0;
	if (subcode !== void 0 && (typeof subcode !== "number" || !Number.isInteger(subcode))) throw new Error("invalid qzone reply response: invalid subcode; check delivery before retrying");
	if (response.code !== 0 || subcode !== void 0 && subcode !== 0) {
		const message = "message" in response && typeof response.message === "string" ? response.message : "";
		log$26.warn("replyQzoneComment: rejected (host=%s tid=%s parent=%s) code=%s subcode=%s", hostUin, tid, target.commentId, response.code, subcode);
		throw new Error(`qzone reply failed: code=${response.code} subcode=${subcode ?? 0} ${message}`.trim());
	}
	const data = "data" in response ? response.data : void 0;
	const id = data !== null && typeof data === "object" && !Array.isArray(data) && "id" in data ? data.id : void 0;
	if (!(typeof id === "string" && id.trim() !== "" || typeof id === "number" && Number.isSafeInteger(id) && id >= 0)) throw new Error("qzone reply accepted but returned an invalid reply ID; check delivery before retrying");
	log$26.debug("replyQzoneComment: accepted (host=%s tid=%s parent=%s reply=%s)", hostUin, tid, target.commentId, id);
	return {
		comment_id: String(id),
		parent_comment_id: target.commentId,
		parent_comment_uin: Number(target.commentUin)
	};
}
/**
* Rebuild the full emotion_cgi_update payload from a msgdetail_v6 response.
* Field-for-field port of php-qzone's buildUpdatePayloadFromDetail: richval
* strings are reconstructed from each `pic[].pic_id` (`,albumid,lloc,sloc,
* type,height,width,,0,0`, tab-joined), `pic_bo` from the `bo=` query param
* of any picture URL variant (group tab-doubled), and the content from
* `conlist` when present. Exported for tests; THROWS on a detail body it
* cannot rebuild from (missing tid, or an image post whose pic info is
* unusable) rather than submitting a lossy update.
*/
function buildQzoneUpdatePayload(detail, selfUin) {
	if (!detail.tid) throw new Error("qzone msg detail is missing tid");
	const pics = detail.pic ?? [];
	const richtype = detail.richtype !== void 0 ? Number(detail.richtype) : pics.length === 0 ? "" : 1;
	const richvals = [];
	const picBoItems = [];
	for (const pic of pics) {
		const picId = String(pic.pic_id ?? "");
		if (!picId) continue;
		const parts = picId.split(",");
		const albumId = parts[1] ?? "";
		const lloc = parts[2] ?? "";
		if (!albumId || !lloc) throw new Error("qzone msg detail has unsupported pic info");
		const sloc = lloc;
		const picType = String(pic.pictype ?? pic.type ?? 22);
		const height = String(pic.height ?? pic.b_height ?? 0);
		const width = String(pic.width ?? pic.b_width ?? 0);
		richvals.push(`,${albumId},${lloc},${sloc},${picType},${height},${width},,0,0`);
		for (const urlKey of [
			"smallurl",
			"url1",
			"url2",
			"url3"
		]) {
			const picUrl = pic[urlKey];
			if (!picUrl) continue;
			const match = /[?&]bo=([^&#]+)/.exec(picUrl);
			if (match) {
				picBoItems.push(decodeURIComponent(match[1]));
				break;
			}
		}
	}
	if (richtype === 1 && richvals.length === 0) throw new Error("qzone image post detail is missing pic info");
	let content = detail.content ?? "";
	const conParts = (detail.conlist ?? []).map((c) => c.con).filter((c) => c !== void 0);
	if (conParts.length > 0) content = conParts.join("").trim();
	const subrichtype = detail.t1_subtype ?? detail.subrichtype ?? (richvals.length === 0 ? "" : 1);
	const boGroup = picBoItems.join(",");
	const picBo = boGroup ? `${boGroup}\t${boGroup}` : "";
	const hostuin = String(detail.uin ?? selfUin);
	return new URLSearchParams({
		syn_tweet_verson: "1",
		tid: String(detail.tid),
		paramstr: "1",
		pic_template: detail.pic_template ?? "",
		richtype: String(richtype),
		richval: richvals.length > 0 ? richvals.join("	") : detail.richval ?? "",
		special_url: detail.special_url ?? "",
		subrichtype: String(subrichtype),
		pic_bo: picBo,
		con: content,
		feedversion: String(detail.feedversion ?? 1),
		ver: String(detail.ver ?? 1),
		ugc_right: String(Number(detail.ugc_right ?? 1)),
		to_sign: String(Number(detail.to_sign ?? 0)),
		ugcright_id: String(detail.ugcright_id ?? detail.tid),
		hostuin,
		code_version: String(detail.code_version ?? 1),
		format: "fs",
		qzreferrer: `https://user.qzone.qq.com/${hostuin}`
	});
}
/** Shared raw detail for reading comments and rebuilding permission updates. */
async function fetchQzoneMsgDetail(cookieObject, targetUin, tid, page) {
	const bkn = getBknFromCookie(cookieObject);
	const url = `https://h5.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msgdetail_v6?${new URLSearchParams({
		tid,
		uin: targetUin,
		t1_source: "1",
		not_trunc_con: "1",
		need_right: "1",
		not_adapt_outpic: "1",
		g_tk: bkn,
		...page ? {
			pos: String(page.pos),
			num: String(page.num)
		} : {}
	}).toString()}`;
	const data = parseQzoneJson(await RequestUtil.HttpGetText(url, "GET", "", { Cookie: cookieToString(cookieObject) }));
	detailObject(data, "response");
	const code = data.code !== void 0 && data.code !== 0 ? data.code : data.subcode ?? data.code ?? -1;
	if (code !== 0) {
		log$26.warn("getQzoneMsgDetail: non-zero code (tid=%s) code=%d msg=%s", tid, code, data.message ?? data.msg);
		throw new Error(`qzone msg detail failed: code=${code} ${data.message ?? data.msg ?? ""}`.trim());
	}
	return data;
}
function detailObject(value, field) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid qzone msg detail: ${field} must be an object`);
	return value;
}
function detailString(value, field) {
	if (typeof value !== "string") throw new Error(`invalid qzone msg detail: ${field} must be a string`);
	return value;
}
function detailInteger(value, field, min = 0) {
	const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
	if (typeof number !== "number" || !Number.isSafeInteger(number) || number < min) throw new Error(`invalid qzone msg detail: ${field} must be an integer >= ${min}`);
	return number;
}
function detailList(value, field) {
	if (value === void 0 || value === null) return [];
	if (!Array.isArray(value)) throw new Error(`invalid qzone msg detail: ${field} must be an array`);
	return value;
}
function mapQzoneComment(value, field) {
	const id = typeof value.tid === "number" ? String(detailInteger(value.tid, `${field}.tid`)) : detailString(value.tid, `${field}.tid`);
	if (!id) throw new Error(`invalid qzone msg detail: ${field}.tid is empty`);
	return {
		comment_id: id,
		uin: detailInteger(value.uin, `${field}.uin`, 1),
		name: detailString(value.name, `${field}.name`),
		time: detailInteger(value.create_time, `${field}.create_time`),
		content: detailString(value.content, `${field}.content`)
	};
}
/**
* Read one post and a page of comments, with the inline replies Qzone supplies.
* Wire fields and pos/num follow SmartHypercube/Qzone-API's Comment / Emotion.load:
* https://github.com/SmartHypercube/Qzone-API/blob/master/qzone.py
* Mapping is independent of the update payload; malformed data must not look
* like a successful empty page. No raw response (private content) is logged.
*/
async function getQzoneMsgDetail(cookieObject, targetUin, tid, pos = 0, num = 20) {
	const data = await fetchQzoneMsgDetail(cookieObject, targetUin, tid, {
		pos,
		num
	});
	const resultTid = detailString(data.tid, "tid");
	if (!resultTid || resultTid !== tid) throw new Error("invalid qzone msg detail: tid does not match the requested post");
	return {
		tid: resultTid,
		content: detailString(data.content, "content"),
		comment_num: detailInteger(data.cmtnum, "cmtnum"),
		comments: detailList(data.commentlist, "commentlist").map((value, index) => {
			const field = `commentlist[${index}]`;
			const comment = detailObject(value, field);
			const mappedComment = mapQzoneComment(comment, field);
			return {
				...mappedComment,
				replies: detailList(comment.list_3, `${field}.list_3`).map((reply, replyIndex) => {
					const replyField = `${field}.list_3[${replyIndex}]`;
					return {
						...mapQzoneComment(detailObject(reply, replyField), replyField),
						parent_comment_id: mappedComment.comment_id,
						parent_comment_uin: mappedComment.uin
					};
				})
			};
		})
	};
}
/**
* Change the view permission of an existing 说说 (`tid`, on the bot's own
* space) via the msgdetail_v6 → emotion_cgi_update two-step. `ugcRight` is
* one of 1(所有人)/4(好友)/16(部分可见)/64(仅自己)/128(部分不可见);
* `targetUins` (|-separated QQ numbers) is required for 16/128 and ignored
* otherwise. Errors PROPAGATE from both steps: a transport failure, a
* non-zero Qzone code on the detail fetch (unknown/foreign tid, auth), an
* unrebuildable detail, or a non-zero `subcode` on the update all throw.
*/
async function updateQzoneMsgRight(cookieObject, selfUin, tid, ugcRight, targetUins) {
	if (!cookieObject || typeof cookieObject !== "object") throw new Error("cookieObject is required");
	if (!tid) throw new Error("tid is required");
	const right = normalizeQzoneUgcRight(ugcRight);
	const effectiveTargetUins = right === 16 || right === 128 ? normalizeTargetUins(targetUins) : "";
	if ((right === 16 || right === 128) && !effectiveTargetUins) throw new Error("target_uins is required when ugc_right is 16 or 128");
	const bodyParams = buildQzoneUpdatePayload(await fetchQzoneMsgDetail(cookieObject, selfUin, tid), selfUin);
	bodyParams.set("ugc_right", String(right));
	if (effectiveTargetUins) bodyParams.set("allow_uins", effectiveTargetUins);
	const url = `https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_update?g_tk=${getBknFromCookie(cookieObject)}`;
	const data = parseQzoneJson(await RequestUtil.HttpGetText(url, "POST", bodyParams.toString(), {
		Cookie: cookieToString(cookieObject),
		"Content-Type": "application/x-www-form-urlencoded"
	}));
	if (typeof data.subcode === "number" && data.subcode !== 0) {
		log$26.warn("updateQzoneMsgRight: non-zero subcode (tid=%s) subcode=%d msg=%s", tid, data.subcode, data.message ?? data.msg);
		throw new Error(`qzone update right failed: subcode=${data.subcode} ${data.message ?? data.msg ?? ""}`.trim());
	}
	if (typeof data.code === "number" && data.code !== 0) {
		log$26.warn("updateQzoneMsgRight: non-zero code (tid=%s) code=%d msg=%s", tid, data.code, data.message ?? data.msg);
		throw new Error(`qzone update right failed: code=${data.code} ${data.message ?? data.msg ?? ""}`.trim());
	}
	return { ugc_right: Number(data.ugc_right ?? right) };
}
async function getQzoneProfile(cookieObject, selfUin, targetUin = selfUin) {
	const url = `https://h5.qzone.qq.com/proxy/domain/base.qzone.qq.com/cgi-bin/user/cgi_userinfo_get_all?${new URLSearchParams({
		uin: targetUin,
		vuin: selfUin,
		fupdate: "1",
		rd: String(Math.random()),
		g_tk: getBknFromCookie(cookieObject)
	})}`;
	const response = parseQzoneJson(await RequestUtil.HttpGetText(url, "GET", "", { Cookie: cookieToString(cookieObject) }));
	if (response.code !== 0 || response.subcode !== void 0 && response.subcode !== 0) throw new Error(`qzone profile failed: code=${response.code} subcode=${response.subcode ?? 0} ${response.message ?? ""}`.trim());
	if (typeof response.data?.spacename !== "string" || typeof response.data.desc !== "string") throw new Error("invalid qzone profile response");
	return {
		name: response.data.spacename,
		description: response.data.desc
	};
}
async function setQzoneProfile(cookieObject, selfUin, profile) {
	const params = new URLSearchParams({
		uin: selfUin,
		pageindex: "3",
		fupdate: "1"
	});
	let bitmap = 0;
	if (profile.name !== void 0) {
		params.set("spacename", profile.name.replaceAll("\r", ""));
		bitmap |= 2048;
	}
	if (profile.description !== void 0) {
		params.set("desc", profile.description.replaceAll("\r", ""));
		bitmap |= 4096;
	}
	params.set("mb", String(bitmap));
	const url = `https://h5.qzone.qq.com/proxy/domain/w.qzone.qq.com/cgi-bin/user/cgi_apply_updateuserinfo_new?g_tk=${getBknFromCookie(cookieObject)}`;
	const response = parseQzoneJson(await RequestUtil.HttpGetText(url, "POST", params.toString(), {
		Cookie: cookieToString(cookieObject),
		"Content-Type": "application/x-www-form-urlencoded"
	}));
	if (response.code !== 0 || response.subcode !== void 0 && response.subcode !== 0) throw new Error(`qzone profile update failed: code=${response.code} subcode=${response.subcode ?? 0} ${response.message ?? ""}`.trim());
}
export {};
