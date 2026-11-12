// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/web/group-notice.ts"
// original bundle lines 338569-338772  (202 lines) of dist/index.mjs
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
var log$23 = createLogger("Bridge.Web");
var GROUP_NOTICE_IMAGE_CDN = "https://gdynamic.qpic.cn/gdynamic";
/** Public download URL for a group-notice picture id from list_announce. */
function groupNoticeImageUrl(id) {
	const trimmed = id.trim();
	if (!trimmed) throw new Error("group notice image id is empty");
	if (/[/?#\s]/.test(trimmed)) throw new Error("group notice image id is malformed");
	return `${GROUP_NOTICE_IMAGE_CDN}/${encodeURIComponent(trimmed)}/0`;
}
function calculateBkn(key) {
	let hash = 5381;
	for (let i = 0; i < key.length; i++) {
		const code = key.charCodeAt(i);
		hash = hash + (hash << 5) + code;
	}
	return (hash & 2147483647).toString();
}
function binaryOption(name, value, fallback) {
	const resolved = value ?? fallback;
	if (resolved !== 0 && resolved !== 1) throw new RangeError(`${name} must be 0 or 1, received ${resolved}`);
	return resolved;
}
/**
* Resolve the public compatibility fields into the exact QQ request mode.
* Kept pure so both runtime callers and tests share one conflict check.
*/
function resolveGroupNoticeOptions(options = {}) {
	if (options.sendToNewMembers !== void 0 && typeof options.sendToNewMembers !== "boolean") throw new TypeError(`sendToNewMembers must be a boolean, received ${typeof options.sendToNewMembers}`);
	if (options.type !== void 0 && options.type !== 1 && options.type !== 20) throw new RangeError(`type must be 1 (regular) or 20 (new members), received ${options.type}`);
	const semanticType = options.sendToNewMembers === void 0 ? void 0 : options.sendToNewMembers ? 20 : 1;
	if (options.type !== void 0 && semanticType !== void 0 && options.type !== semanticType) throw new Error(`sendToNewMembers=${options.sendToNewMembers} conflicts with type=${options.type}`);
	const type = options.type ?? semanticType ?? 1;
	const imgWidth = options.imgWidth ?? 540;
	const imgHeight = options.imgHeight ?? 300;
	if (!Number.isFinite(imgWidth) || imgWidth <= 0 || !Number.isFinite(imgHeight) || imgHeight <= 0) throw new RangeError(`group notice image dimensions must be positive finite numbers, received ${imgWidth}x${imgHeight}`);
	return {
		pinned: binaryOption("pinned", options.pinned, 0),
		type,
		sendToNewMembers: type === 20,
		isShowEditCard: binaryOption("isShowEditCard", options.isShowEditCard, 1),
		tipWindowType: binaryOption("tipWindowType", options.tipWindowType, 1),
		confirmRequired: binaryOption("confirmRequired", options.confirmRequired, 1),
		picId: options.picId ?? "",
		imgWidth,
		imgHeight
	};
}
/** Parse QQ's HTML-escaped JSON metadata returned by the image upload CGI. */
function parseGroupNoticeImageUploadResponse(data) {
	let result;
	try {
		result = JSON.parse(data);
	} catch (cause) {
		throw new Error("group notice image upload returned invalid JSON", { cause });
	}
	if (result.ec !== 0 || !result.id) throw new Error(`group notice image upload failed: ec=${result.ec ?? "missing"} em=${result.em ?? "missing"}`);
	let idObj;
	try {
		idObj = JSON.parse(result.id.replace(/&quot;/g, "\""));
	} catch (cause) {
		throw new Error("group notice image upload returned invalid image metadata JSON", { cause });
	}
	const width = Number(idObj.w);
	const height = Number(idObj.h);
	if (typeof idObj.id !== "string" || idObj.id.length === 0 || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) throw new Error("group notice image upload returned malformed image metadata");
	return {
		id: idObj.id,
		width,
		height
	};
}
/**
* 发送群公告 Web API
*/
async function setGroupNoticeWebAPI(cookieObject, groupCode, content, options = {}) {
	const resolved = resolveGroupNoticeOptions(options);
	const skey = cookieObject["skey"] || "";
	const pskey = cookieObject["p_skey"] || skey;
	const bodyBkn = calculateBkn(skey);
	const urlBkn = calculateBkn(pskey);
	const settings = JSON.stringify({
		is_show_edit_card: resolved.isShowEditCard,
		tip_window_type: resolved.tipWindowType,
		confirm_required: resolved.confirmRequired
	});
	const bodyParams = {
		qid: groupCode,
		bkn: bodyBkn,
		text: content,
		pinned: resolved.pinned.toString(),
		type: resolved.type.toString(),
		settings
	};
	if (resolved.picId !== "") {
		bodyParams.pic = resolved.picId;
		bodyParams.imgWidth = resolved.imgWidth.toString();
		bodyParams.imgHeight = resolved.imgHeight.toString();
	}
	const url = `https://web.qun.qq.com/cgi-bin/announce/${resolved.sendToNewMembers ? "add_qun_instruction" : "add_qun_notice"}?bkn=${urlBkn}`;
	const body = new URLSearchParams(bodyParams).toString();
	log$23.debug("group-notice publish: group=%s target=%s pinned=%d edit-card=%d popup=%s confirm=%d image=%s", groupCode, resolved.sendToNewMembers ? "new-members" : "regular", resolved.pinned, resolved.isShowEditCard, resolved.tipWindowType === 0 ? "on" : "off", resolved.confirmRequired, resolved.picId ? "yes" : "no");
	return RequestUtil.HttpGetJson(url, "POST", body, {
		Cookie: cookieToString(cookieObject),
		"Content-Type": "application/x-www-form-urlencoded"
	}, true, false);
}
/**
* 获取群公告列表 Web API
*/
async function getGroupNoticeWebAPI(cookieObject, groupCode, start = -1, count = 20) {
	const skey = cookieObject["skey"] || "";
	const pskey = cookieObject["p_skey"] || skey;
	const bodyBkn = calculateBkn(skey);
	const urlBkn = calculateBkn(pskey);
	const bodyParams = new URLSearchParams({
		qid: groupCode,
		bkn: bodyBkn,
		ft: "23",
		s: start.toString(),
		n: count.toString(),
		i: "1",
		ni: "1"
	}).toString();
	const url = `https://web.qun.qq.com/cgi-bin/announce/list_announce?bkn=${urlBkn}`;
	return RequestUtil.HttpGetJson(url, "POST", bodyParams, {
		Cookie: cookieToString(cookieObject),
		"Content-Type": "application/x-www-form-urlencoded",
		Referer: "https://web.qun.qq.com/mannounce/index.html?_wv=1031&_bid=148"
	}, true, false);
}
/**
* 上传群公告图片 Web API
*/
async function uploadGroupNoticeImage(cookieObject, imageBuffer) {
	const bkn = calculateBkn(cookieObject["skey"] || "");
	const boundary = `-----------------------------${Date.now()}`;
	const parts = [];
	parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="bkn"\r\n\r\n${bkn}\r\n`));
	parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="source"\r\n\r\ntroopNotice\r\n`));
	parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="m"\r\n\r\n0\r\n`));
	parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="pic_up"; filename="image.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`));
	parts.push(imageBuffer);
	parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
	const body = Buffer.concat(parts);
	const options = {
		hostname: "web.qun.qq.com",
		path: "/cgi-bin/announce/upload_img",
		method: "POST",
		headers: {
			"Content-Type": `multipart/form-data; boundary=${boundary}`,
			"Content-Length": body.length,
			Cookie: cookieToString(cookieObject)
		}
	};
	return new Promise((resolve, reject) => {
		const req = https.request(options, (res) => {
			let data = "";
			res.on("data", (chunk) => {
				data += chunk;
			});
			res.on("end", () => {
				if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
					reject(/* @__PURE__ */ new Error(`group notice image upload returned HTTP ${res.statusCode ?? "unknown"}`));
					return;
				}
				try {
					resolve(parseGroupNoticeImageUploadResponse(data));
				} catch (error) {
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			});
		});
		req.on("error", (error) => reject(new Error(`group notice image upload transport error: ${error.message}`, { cause: error })));
		req.write(body);
		req.end();
	});
}
/**
* 删除群公告 Web API
*/
async function deleteGroupNotice(cookieObject, groupCode, fid) {
	try {
		const skey = cookieObject["skey"] || "";
		const pskey = cookieObject["p_skey"] || skey;
		const bodyBkn = calculateBkn(skey);
		const urlBkn = calculateBkn(pskey);
		const params = new URLSearchParams({
			bkn: bodyBkn,
			fid,
			qid: groupCode
		}).toString();
		const url = `https://web.qun.qq.com/cgi-bin/announce/del_feed?bkn=${urlBkn}`;
		return (await RequestUtil.HttpGetJson(url, "POST", params, {
			Cookie: cookieToString(cookieObject),
			"Content-Type": "application/x-www-form-urlencoded"
		}, true, false))?.ec === 0;
	} catch (e) {
		log$23.warn("deleteGroupNotice failed (group=%s fid=%s): %s", groupCode, fid, e instanceof Error ? e.stack ?? e.message : String(e));
		return false;
	}
}
export {};
