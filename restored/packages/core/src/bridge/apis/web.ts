init_utils();
function asBridge(ctx) {
	return ctx;
}
function finiteNumber(value, field) {
	const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
	if (!Number.isFinite(parsed)) throw new Error(`invalid group notice response: ${field} must be a finite number`);
	return parsed;
}
function collectionValues(collection, field) {
	if (collection === void 0) return [];
	if (Array.isArray(collection)) return collection;
	if (collection === null || typeof collection !== "object") throw new Error(`invalid group notice response: ${field} must be an array or object`);
	return Object.values(collection);
}
function mapGroupNoticeFeed(feed, sendToNewMembers) {
	if (!feed || typeof feed !== "object") throw new Error("invalid group notice response: feed must be an object");
	if (typeof feed.fid !== "string" || feed.fid.length === 0) throw new Error("invalid group notice response: feed.fid must be a non-empty string");
	if (!feed.msg || typeof feed.msg !== "object" || typeof feed.msg.text !== "string") throw new Error(`invalid group notice response: feed ${feed.fid} has no message text`);
	if (feed.settings === void 0) throw new Error(`invalid group notice response: feed ${feed.fid} has no settings`);
	const image = (feed.msg.pics ?? []).map((pic, index) => {
		if (!pic || typeof pic !== "object" || typeof pic.id !== "string") throw new Error(`invalid group notice response: feed ${feed.fid} image ${index} is malformed`);
		return {
			id: pic.id,
			url: groupNoticeImageUrl(pic.id),
			height: finiteNumber(pic.h, `feed ${feed.fid} image ${index}.h`),
			width: finiteNumber(pic.w, `feed ${feed.fid} image ${index}.w`)
		};
	});
	const responseType = feed.type === void 0 ? sendToNewMembers ? 20 : 1 : finiteNumber(feed.type, `feed ${feed.fid}.type`);
	return {
		notice_id: feed.fid,
		sender_id: finiteNumber(feed.u, `feed ${feed.fid}.u`),
		publish_time: finiteNumber(feed.pubt, `feed ${feed.fid}.pubt`),
		message: {
			text: feed.msg.text,
			image,
			images: image
		},
		settings: feed.settings,
		read_num: finiteNumber(feed.read_num, `feed ${feed.fid}.read_num`),
		type: responseType,
		pinned: feed.pinned === void 0 ? 0 : finiteNumber(feed.pinned, `feed ${feed.fid}.pinned`),
		send_to_new_members: sendToNewMembers || responseType === 20
	};
}
/** Merge QQ's regular (`feeds`) and new-member (`inst`) announcement lists. */
function mapGroupNoticeResponse(ret) {
	if (ret.ec !== 0) throw new Error(`获取公告失败: ec=${ret.ec}, em=${ret.em ?? "missing"}`);
	const notices = [];
	const indexByNoticeId = /* @__PURE__ */ new Map();
	const append = (collection, sendToNewMembers, field) => {
		for (const feed of collectionValues(collection, field)) {
			const mapped = mapGroupNoticeFeed(feed, sendToNewMembers);
			const existingIndex = indexByNoticeId.get(mapped.notice_id);
			if (existingIndex === void 0) {
				indexByNoticeId.set(mapped.notice_id, notices.length);
				notices.push(mapped);
			} else if (sendToNewMembers) notices[existingIndex] = mapped;
		}
	};
	append(ret.feeds, false, "feeds");
	append(ret.inst, true, "inst");
	return notices;
}
function forceFetchClientKeyInner(bridge) {
	return ForceFetchClientKey.invoke(bridge);
}
function getPSkey(bridge, domainList) {
	return GetPskey.invoke(bridge, { domainList });
}
async function getCookies(bridge, domain) {
	const ClientKeyData = await forceFetchClientKeyInner(bridge);
	const requestUrl = "https://ssl.ptlogin2.qq.com/jump?ptlang=1033&clientuin=" + bridge.identity.uin + "&clientkey=" + ClientKeyData.clientKey + "&u1=https%3A%2F%2F" + domain + "%2F" + bridge.identity.uin + "%2Finfocenter&keyindex=" + ClientKeyData.keyIndex;
	const data = await RequestUtil.HttpsGetCookies(requestUrl);
	if (!data["p_skey"] || data["p_skey"].length === 0) try {
		const pskey = (await getPSkey(bridge, [domain])).domainPskeyMap.get(domain);
		if (pskey) data["p_skey"] = pskey;
	} catch {
		return data;
	}
	return data;
}
async function getSKey(bridge) {
	const ClientKeyData = await forceFetchClientKeyInner(bridge);
	if (!ClientKeyData.clientKey) throw new Error("getClientKey Error: clientKey is empty");
	const requestUrl = "https://ssl.ptlogin2.qq.com/jump?ptlang=1033&clientuin=" + bridge.identity.uin + "&clientkey=" + ClientKeyData.clientKey + "&u1=https%3A%2F%2Fh5.qzone.qq.com%2Fqqnt%2Fqzoneinpcqq%2Ffriend%3Frefresh%3D0%26clientuin%3D0%26darkMode%3D0&keyindex=" + ClientKeyData.keyIndex;
	const skey = (await RequestUtil.HttpsGetCookies(requestUrl))["skey"];
	if (!skey) throw new Error("SKey is Empty");
	return skey;
}
/**
* Standard QQ bkn hash (also known as token / csrf_token) derived from
* skey or p_skey. djb2 hash truncated to 31 bits.
*/
function getBknFromSKey(skey) {
	let hash = 5381;
	for (let i = 0; i < skey.length; i++) hash += (hash << 5) + skey.charCodeAt(i);
	return hash & 2147483647;
}
var WebApi = class {
	ctx;
	constructor(ctx) {
		this.ctx = ctx;
	}
	async forceFetchClientKey() {
		return forceFetchClientKeyInner(asBridge(this.ctx));
	}
	/** Fetch the cookie jar for a `qq.com` subdomain. Used by GroupAlbumApi
	*  (qzone.qq.com) and by every other web helper here. */
	async getCookies(domain) {
		return getCookies(asBridge(this.ctx), domain);
	}
	/** Cookies for `domain` joined into the canonical "k=v; k=v" header form. */
	async getCookiesStr(domain) {
		const cookieObject = await getCookies(asBridge(this.ctx), domain);
		return Object.entries(cookieObject).map(([key, value]) => `${key}=${value}`).join("; ");
	}
	/** CSRF token == bkn(skey) — used by qzone / qun web APIs. */
	async getCsrfToken() {
		const skey = await getSKey(asBridge(this.ctx));
		if (!skey) throw new Error("SKey is Empty");
		return getBknFromSKey(skey);
	}
	/** Returns the OneBot `get_credentials` payload (cookie string + bkn). */
	async getCredentials(domain) {
		const cookieObject = await getCookies(asBridge(this.ctx), domain);
		const cookiesStr = Object.entries(cookieObject).map(([key, value]) => `${key}=${value}`).join("; ");
		const skey = cookieObject["p_skey"] || cookieObject["skey"] || "";
		const token = skey ? getBknFromSKey(skey) : 0;
		return {
			cookies: cookiesStr,
			token,
			csrf_token: token
		};
	}
	/** Paginated fetch — `pageStart` is 0-indexed, `pageLimit` is server-capped at 50. */
	async getEssence(groupId, pageStart = 0, pageLimit = 50) {
		const bridge = asBridge(this.ctx);
		const groupCode = groupId.toString();
		return await getGroupEssenceMsg(await getCookies(bridge, "qun.qq.com"), groupCode, pageStart, pageLimit) || {
			retcode: -1,
			data: {
				is_end: true,
				msg_list: []
			}
		};
	}
	/** Walks every page and returns the concatenated result. */
	async getEssenceAll(groupId) {
		const bridge = asBridge(this.ctx);
		const groupCode = groupId.toString();
		return await getGroupEssenceMsgAll(await getCookies(bridge, "qun.qq.com"), groupCode);
	}
	async getHonorInfo(groupId, type) {
		const bridge = asBridge(this.ctx);
		const groupCode = groupId.toString();
		const cookieObject = await getCookies(bridge, "qun.qq.com");
		const honorInfo = {
			group_id: groupId,
			current_talkative: null,
			talkative_list: [],
			performer_list: [],
			legend_list: [],
			emotion_list: [],
			strong_newbie_list: []
		};
		if (type === WebHonorType.TALKATIVE || type === WebHonorType.ALL) {
			const talkativeList = await getHonorListWebAPI(cookieObject, groupCode, 1);
			if (talkativeList.length > 0) {
				honorInfo.current_talkative = talkativeList[0];
				honorInfo.talkative_list = talkativeList;
			}
		}
		if (type === WebHonorType.PERFORMER || type === WebHonorType.ALL) honorInfo.performer_list = await getHonorListWebAPI(cookieObject, groupCode, 2);
		if (type === WebHonorType.LEGEND || type === WebHonorType.ALL) honorInfo.legend_list = await getHonorListWebAPI(cookieObject, groupCode, 3);
		if (type === WebHonorType.EMOTION || type === WebHonorType.ALL) honorInfo.emotion_list = await getHonorListWebAPI(cookieObject, groupCode, 6);
		return honorInfo;
	}
	/** Today's group sign-in list via qun.qq.com. [] when the group has no
	*  sign-ins; THROWS on transport / auth failure (caller maps to failed). */
	async getSignedList(groupId) {
		const bridge = asBridge(this.ctx);
		return getDaySignedListWebAPI(await getCookies(bridge, "qun.qq.com"), groupId.toString(), bridge.identity.uin.toString());
	}
	async sendNotice(groupId, content, options) {
		const bridge = asBridge(this.ctx);
		const groupCode = groupId.toString();
		const cookieObject = await getCookies(bridge, "qun.qq.com");
		let picId = "";
		let imgWidth = 540;
		let imgHeight = 300;
		if (options?.image) {
			const loaded = await loadBinarySource(options.image, "group-notice image");
			const picInfo = await uploadGroupNoticeImage(cookieObject, Buffer.from(loaded.bytes));
			picId = picInfo.id;
			imgWidth = picInfo.width;
			imgHeight = picInfo.height;
		}
		const ret = await setGroupNoticeWebAPI(cookieObject, groupCode, content, {
			pinned: options?.pinned,
			type: options?.type,
			sendToNewMembers: options?.sendToNewMembers,
			isShowEditCard: options?.isShowEditCard,
			tipWindowType: options?.tipWindowType,
			confirmRequired: options?.confirmRequired,
			picId,
			imgWidth,
			imgHeight
		});
		if (ret.ec !== 0) throw new Error(`设置群公告失败: ec=${ret.ec ?? "missing"}, em=${ret.em ?? "missing"}`);
		return ret;
	}
	async getNotice(groupId) {
		const bridge = asBridge(this.ctx);
		const groupCode = groupId.toString();
		return mapGroupNoticeResponse(await getGroupNoticeWebAPI(await getCookies(bridge, "qun.qq.com"), groupCode));
	}
	async deleteNotice(groupId, fid) {
		const bridge = asBridge(this.ctx);
		const groupCode = groupId.toString();
		return await deleteGroupNotice(await getCookies(bridge, "qun.qq.com"), groupCode, fid);
	}
	/** 查某人正在用的好友装扮（挂件/名片/来电/输入状态等）。走 vip.qq.com 域，
	*  纯 cookie 鉴权、抓 SSR HTML。「查到但没装扮」返回空 items；网络/未登录态/
	*  风控/页面改版/串号数据抛 FriendDressError（kind 区分具体环节）。 */
	async getFriendDress(targetUin) {
		return getFriendDressWebAPI(await getCookies(asBridge(this.ctx), "vip.qq.com"), targetUin.toString());
	}
};
