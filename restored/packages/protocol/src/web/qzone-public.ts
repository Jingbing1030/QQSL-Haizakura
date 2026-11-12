// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/web/qzone-public.ts"
// original bundle lines 336660-337296  (635 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var __te$1 = new TextEncoder();
var __nonAscii$1 = /[^\x00-\x7f]/;
var __utf8Scratch$1;
function __utf8LenLong$1(value) {
	const buffer = __utf8Scratch$1 ??= /* @__PURE__ */ new Uint8Array(4096);
	let length = 0;
	for (;;) {
		const result = __te$1.encodeInto(value, buffer);
		length += result.written;
		if (result.read === value.length) return length;
		value = value.slice(result.read);
	}
}
function __utf8Len$1(value) {
	if (value.length >= 32) return __utf8LenLong$1(value);
	if (value.length >= 8 && value.charCodeAt(0) < 128 && !__nonAscii$1.test(value)) return value.length;
	let length = 0;
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code < 128) {
			length++;
			continue;
		}
		if (code < 2048) {
			length += 2;
			continue;
		}
		if ((code & 64512) === 55296) {
			if (i + 1 < value.length) {
				if ((value.charCodeAt(i + 1) & 64512) === 56320) {
					length += 4;
					i++;
					continue;
				}
			}
			length += 3;
			continue;
		}
		if ((code & 64512) === 56320) {
			length += 3;
			continue;
		}
		length += 3;
	}
	return length;
}
function __utf8Write$1(buf, offset, value) {
	for (let i = 0; i < value.length; i++) {
		let code = value.charCodeAt(i);
		if (code < 128) {
			buf[offset++] = code;
			continue;
		}
		if (code < 2048) {
			buf[offset++] = 192 | code >> 6;
			buf[offset++] = 128 | code & 63;
			continue;
		}
		if ((code & 64512) === 55296) {
			if (i + 1 < value.length) {
				const next = value.charCodeAt(i + 1);
				if ((next & 64512) === 56320) {
					const point = (code - 55296 << 10) + (next - 56320) + 65536;
					buf[offset++] = 240 | point >> 18;
					buf[offset++] = 128 | point >> 12 & 63;
					buf[offset++] = 128 | point >> 6 & 63;
					buf[offset++] = 128 | point & 63;
					i++;
					continue;
				}
			}
			code = 65533;
		} else if ((code & 64512) === 56320) code = 65533;
		buf[offset++] = 224 | code >> 12;
		buf[offset++] = 128 | code >> 6 & 63;
		buf[offset++] = 128 | code & 63;
	}
	return offset;
}
function __utf8WriteLong$1(buf, offset, value) {
	return offset + __te$1.encodeInto(value, buf.subarray(offset)).written;
}
function __asciiWrite$1(buf, offset, value) {
	let i = 0;
	for (; i + 7 < value.length; i += 8) {
		buf[offset++] = value.charCodeAt(i);
		buf[offset++] = value.charCodeAt(i + 1);
		buf[offset++] = value.charCodeAt(i + 2);
		buf[offset++] = value.charCodeAt(i + 3);
		buf[offset++] = value.charCodeAt(i + 4);
		buf[offset++] = value.charCodeAt(i + 5);
		buf[offset++] = value.charCodeAt(i + 6);
		buf[offset++] = value.charCodeAt(i + 7);
	}
	for (; i < value.length; i++) buf[offset++] = value.charCodeAt(i);
	return offset;
}
var __pool$1;
var __poolOffset$1 = 0;
function __allocate$1(size) {
	if (size > 4096) return new Uint8Array(size);
	let buffer = __pool$1;
	if (!buffer || __poolOffset$1 + size > buffer.length) {
		buffer = __pool$1 = /* @__PURE__ */ new Uint8Array(8192);
		__poolOffset$1 = 0;
	}
	const start = __poolOffset$1;
	__poolOffset$1 += size;
	return buffer.subarray(start, start + size);
}
function __varint64Size(value) {
	if (value < 128n) return 1;
	const hi = Number(value >> 32n);
	return ((hi ? 64 - Math.clz32(hi) : 32 - Math.clz32(Number(value))) + 6) / 7 | 0;
}
function __writeVarint64(buf, offset, value) {
	let lo = Number(value & 4294967295n) >>> 0;
	let hi = Number(value >> 32n) >>> 0;
	while (hi || lo > 127) {
		buf[offset++] = lo & 127 | 128;
		lo = (lo >>> 7 | hi << 25) >>> 0;
		hi >>>= 7;
	}
	buf[offset++] = lo;
	return offset;
}
function protobuf_encode_QzoneEmotionUgcId(obj) {
	let size = 0;
	const _f0 = obj["appId"];
	const _f1 = obj["uin"];
	const _f2 = obj["publishTime"];
	const _f3 = obj["field4"];
	let _c3;
	const _f4 = obj["field5"];
	let _c4;
	const _f5 = obj["field6"];
	let _c5;
	const _f6 = obj["tid"];
	let _c6;
	if (_f0 != null && _f0 !== 0n) size += 1 + __varint64Size(BigInt.asUintN(64, _f0));
	if (_f1 != null && _f1 !== 0n) size += 1 + __varint64Size(BigInt.asUintN(64, _f1));
	if (_f2 != null && _f2 !== 0n) size += 1 + __varint64Size(BigInt.asUintN(64, _f2));
	if (_f3 != null) {
		const _len = __utf8Len$1(_f3);
		_c3 = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f4 != null) {
		const _len = __utf8Len$1(_f4);
		_c4 = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f5 != null && _f5 !== "") {
		const _len = __utf8Len$1(_f5);
		_c5 = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	if (_f6 != null && _f6 !== "") {
		const _len = __utf8Len$1(_f6);
		_c6 = _len;
		size += 1 + _len;
		size += _len < 128 ? 1 : _len < 16384 ? 2 : _len < 2097152 ? 3 : _len < 268435456 ? 4 : 5;
	}
	const buf = size <= 64 ? new Uint8Array(size) : __allocate$1(size);
	let offset = 0;
	if (_f0 != null && _f0 !== 0n) {
		buf[offset++] = 8;
		offset = __writeVarint64(buf, offset, BigInt.asUintN(64, _f0));
	}
	if (_f1 != null && _f1 !== 0n) {
		buf[offset++] = 16;
		offset = __writeVarint64(buf, offset, BigInt.asUintN(64, _f1));
	}
	if (_f2 != null && _f2 !== 0n) {
		buf[offset++] = 24;
		offset = __writeVarint64(buf, offset, BigInt.asUintN(64, _f2));
	}
	if (_f3 != null) {
		buf[offset++] = 34;
		const _len = _c3;
		let _v = _len;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = _len >= 128 ? __utf8WriteLong$1(buf, offset, _f3) : _len === _f3.length ? __asciiWrite$1(buf, offset, _f3) : __utf8Write$1(buf, offset, _f3);
	}
	if (_f4 != null) {
		buf[offset++] = 42;
		const _len = _c4;
		let _v = _len;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = _len >= 128 ? __utf8WriteLong$1(buf, offset, _f4) : _len === _f4.length ? __asciiWrite$1(buf, offset, _f4) : __utf8Write$1(buf, offset, _f4);
	}
	if (_f5 != null && _f5 !== "") {
		buf[offset++] = 50;
		const _len = _c5;
		let _v = _len;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = _len >= 128 ? __utf8WriteLong$1(buf, offset, _f5) : _len === _f5.length ? __asciiWrite$1(buf, offset, _f5) : __utf8Write$1(buf, offset, _f5);
	}
	if (_f6 != null && _f6 !== "") {
		buf[offset++] = 66;
		const _len = _c6;
		let _v = _len;
		if (_v < 128) buf[offset++] = _v;
		else if (_v < 16384) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7;
		} else if (_v < 2097152) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14;
		} else if (_v < 268435456) {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21;
		} else {
			buf[offset++] = _v & 127 | 128;
			buf[offset++] = _v >>> 7 & 127 | 128;
			buf[offset++] = _v >>> 14 & 127 | 128;
			buf[offset++] = _v >>> 21 & 127 | 128;
			buf[offset++] = _v >>> 28;
		}
		offset = _len >= 128 ? __utf8WriteLong$1(buf, offset, _f6) : _len === _f6.length ? __asciiWrite$1(buf, offset, _f6) : __utf8Write$1(buf, offset, _f6);
	}
	return buf;
}
var reader = "trpc.qzone.feeds_reader.FeedsReader";
var interaction = "trpc.qzone.interaction_writer.InteractionWriter";
var upvote = "trpc.public_qzone.interaction.UFOComment";
var relation = "trpc.public_qzone.relation.RelationService";
function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function request(cookies, service, method, oidb, params) {
	const [command, serviceType] = oidb.split("_");
	const result = await RequestUtil.HttpGetJson(`https://h5.qzone.qq.com/http2rpc/gotrpc/v1/${service}/${method}?g_tk=${getBknFromCookie(cookies)}`, "POST", params, {
		Cookie: cookieToString(cookies),
		"Content-Type": "application/json",
		Referer: "https://h5.qzone.qq.com/pc-qzone/index.html",
		"x-web-qua": "V1_HT5_QZ_9.9.32_001_IDC_B",
		"x-oidb": JSON.stringify({
			uint32_command: command,
			uint32_service_type: serviceType
		})
	});
	if (!isObject(result) || result.retcode !== 0 || !isObject(result.data)) {
		const code = isObject(result) ? result.retcode : "invalid response";
		const message = isObject(result) && typeof result.message === "string" ? result.message : "";
		throw new Error(`qzone public ${method} failed: retcode=${code} ${message}`.trim());
	}
	return result.data;
}
function feedParams(feed) {
	const common = feed.cell_common;
	if (!isObject(common) || !isObject(common.union_id) || !Object.keys(common.union_id).length) throw new Error("空友动态缺少 cell_common.union_id，请使用推荐列表或详情返回的完整动态");
	return {
		union_id: common.union_id,
		...feed.cell_feed_transfer === void 0 ? {} : { cell_feed_transfer: feed.cell_feed_transfer }
	};
}
function encodeCursor(state) {
	const cursor = Buffer.from(JSON.stringify(state)).toString("base64url");
	if (cursor.length > 65536) throw new Error("空友推荐分页游标过大");
	return cursor;
}
function decodeCursor(cursor, uin) {
	if (!cursor || cursor.length > 65536 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("无效的空友推荐 cursor");
	let value;
	try {
		const bytes = Buffer.from(cursor, "base64url");
		if (bytes.toString("base64url") !== cursor) throw new Error("non-canonical encoding");
		value = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("无效的空友推荐 cursor");
	}
	if (!isObject(value) || value.version !== 1 || value.uin !== uin || typeof value.refresh_id !== "string" || !value.refresh_id || typeof value.attach_info !== "string" || !(value.last_client_feed_union_id === null || isObject(value.last_client_feed_union_id))) throw new Error("空友推荐 cursor 无效或不属于当前账号");
	return {
		version: 1,
		uin,
		refresh_id: value.refresh_id,
		attach_info: value.attach_info,
		last_client_feed_union_id: value.last_client_feed_union_id
	};
}
async function getQzonePublicCapabilities(cookies, selfUin) {
	const data = await request(cookies, "trpc.public_qzone.entrance_ctrl.EntranceCtrl", "BatchEntranceWhitelist", "0x9741_0", {
		uins: [selfUin],
		entrance_types: [1, 15]
	});
	const result = Array.isArray(data.results) ? data.results.find((entry) => isObject(entry) && String(entry.uin) === selfUin) : void 0;
	if (!isObject(result) || !isObject(result.entrances)) throw new Error("qzone public BatchEntranceWhitelist 缺少当前账号的 entrances");
	return result.entrances;
}
async function getQzoneHomeFeeds(cookies, selfUin, targetUin = selfUin, cursor) {
	let attachInfo = "";
	if (cursor !== void 0) {
		if (!cursor || cursor.length > 65536 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("无效的空间主页 cursor");
		const bytes = Buffer.from(cursor, "base64url");
		const value = JSON.parse(bytes.toString("utf8"));
		if (bytes.toString("base64url") !== cursor || !isObject(value) || value.version !== 1 || value.kind !== "home" || value.uin !== selfUin || value.host_uin !== targetUin || typeof value.attach_info !== "string" || !value.attach_info) throw new Error("空间主页 cursor 无效或不属于当前账号及主页");
		attachInfo = value.attach_info;
	}
	const data = await request(cookies, reader, "GetMainPageFeeds", "0x9794_2", {
		host_uid: "",
		host_uin: targetUin,
		attach_info: attachInfo,
		refresh_attach_info: "",
		feed_action_domain_type: 1
	});
	if (!Array.isArray(data.feeds) || typeof data.has_more !== "boolean") throw new Error("空间主页动态分页响应异常");
	const feeds = data.feeds.map((entry) => {
		if (!isObject(entry) || !isObject(entry.feed)) throw new Error("空间主页动态响应异常");
		return entry.feed;
	});
	let nextCursor = null;
	if (data.has_more) {
		if (typeof data.attach_info !== "string" || !data.attach_info || data.attach_info === attachInfo) throw new Error("空间主页动态分页未推进");
		nextCursor = encodeCursor({
			version: 1,
			kind: "home",
			uin: selfUin,
			host_uin: targetUin,
			attach_info: data.attach_info
		});
	}
	return {
		...data,
		feeds,
		has_more: data.has_more,
		next_cursor: nextCursor
	};
}
async function getQzoneFeedDetail(cookies, tid) {
	if (tid.length !== 24 || !/^[0-9a-f]{24}$/i.test(tid)) throw new Error("空间说说 tid 必须是 24 位十六进制编号");
	const feedId = tid.toLowerCase();
	const identity = Buffer.from(feedId, "hex");
	const ugcId = protobuf_encode_QzoneEmotionUgcId({
		appId: 311n,
		uin: BigInt(identity.readUInt32LE(0)),
		publishTime: BigInt(identity.readUInt32LE(4)),
		field4: "",
		field5: "",
		field6: "0",
		tid: feedId
	});
	const data = await request(cookies, reader, "GetFeedDetail", "0x97b1_1", {
		union_id: {
			feed_id: feedId,
			ugc_id: Buffer.from(ugcId).toString("base64"),
			adv_id: null
		},
		feed_action_domain_type: 1,
		from_page: 1
	});
	const wrapper = data.feed;
	if (!isObject(wrapper) || !isObject(wrapper.feed)) throw new Error("qzone GetFeedDetail 响应缺少完整动态 feed.feed");
	const feed = wrapper.feed;
	const common = feed.cell_common;
	const unionId = isObject(common) ? common.union_id : void 0;
	if (!isObject(unionId) || typeof unionId.feed_id !== "string" || unionId.feed_id.toLowerCase() !== feedId) throw new Error("qzone GetFeedDetail 返回的动态编号与请求不符");
	if (data.attach_info != null && typeof data.attach_info !== "string") throw new Error("qzone GetFeedDetail 评论游标格式异常");
	return {
		...data,
		feed,
		attach_info: data.attach_info ?? null
	};
}
async function getQzoneShareArk(cookies, feed) {
	const operation = feed.cell_operation;
	const share = isObject(operation) ? operation.share_outside : void 0;
	const resource = isObject(share) ? share.share_access_resource : void 0;
	const common = feed.cell_common;
	const mask = isObject(common) ? common.operate_mask : void 0;
	if (mask !== void 0 && (typeof mask !== "number" || !Number.isSafeInteger(mask) || mask < 0)) throw new Error("空间动态分享权限数据异常");
	if (typeof mask === "number" && (mask & 1 << 17) !== 0) {
		const reason = isObject(share) && typeof share.share_out_button_toast === "string" ? share.share_out_button_toast : "该空间动态暂不支持分享";
		throw new Error(reason);
	}
	if (!isObject(resource) || typeof resource.busi_id !== "string" || !resource.busi_id || typeof resource.resource_id !== "string" || !resource.resource_id || typeof feed.cell_feed_transfer !== "string" || !feed.cell_feed_transfer) throw new Error("空间动态缺少分享信息，请传入主页、详情或推荐列表返回的完整动态");
	const data = await request(cookies, "trpc.qq.share.Service", "CreateShare", "0x9409_1", { info: {
		busi_id: resource.busi_id,
		resource_id: resource.resource_id,
		template: "ark_busi_select",
		busi_data: feed.cell_feed_transfer,
		plat: 1,
		target: 3
	} });
	if (data.err !== void 0 && data.err !== null) {
		if (!isObject(data.err) || data.err.code !== void 0 && typeof data.err.code !== "number") throw new Error("空间分享业务响应异常");
		if (data.err.code !== void 0 && data.err.code !== 0) {
			const message = typeof data.err.msg === "string" ? data.err.msg : "";
			throw new Error(`空间分享失败: ${data.err.code} ${message}`.trim());
		}
	}
	if (typeof data.template_data !== "string" || !data.template_data.trim()) throw new Error("空间分享未返回卡片");
	if (!isObject(JSON.parse(data.template_data))) throw new Error("空间分享返回的卡片格式异常");
	let requiresConfirmation = false;
	let notice = null;
	if (data.info !== void 0) {
		if (!isObject(data.info)) throw new Error("空间分享提示格式异常");
		const encoded = data.info.busi_data;
		if (encoded !== void 0 && encoded !== "") {
			if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("空间分享提示编码异常");
			const decoded = Buffer.from(encoded, "base64");
			if (decoded.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) throw new Error("空间分享提示编码异常");
			const permission = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
			if (permission !== null) {
				if (!isObject(permission) || permission.need_break !== void 0 && typeof permission.need_break !== "boolean") throw new Error("空间分享提示格式异常");
				requiresConfirmation = permission.need_break === true;
				if (isObject(permission.tips) && typeof permission.tips.content === "string" && permission.tips.content) notice = permission.tips.content;
				if (requiresConfirmation && !notice) notice = "你的空间有权限，分享出去的页面所有人都可以看。";
			}
		}
	}
	return {
		ark: data.template_data,
		requires_confirmation: requiresConfirmation,
		notice
	};
}
async function getQzonePublicFeeds(cookies, selfUin, cursor) {
	const state = cursor === void 0 ? {
		version: 1,
		uin: selfUin,
		refresh_id: `${selfUin}_${Date.now()}`,
		attach_info: "",
		last_client_feed_union_id: null
	} : decodeCursor(cursor, selfUin);
	const data = await request(cookies, reader, "GetPublicRecomFeeds", "0x9a38_0", {
		refresh_id: state.refresh_id,
		...cursor === void 0 ? {} : {
			attach_info: state.attach_info,
			...state.last_client_feed_union_id === null ? {} : { last_client_feed_union_id: state.last_client_feed_union_id }
		}
	});
	if (!Array.isArray(data.feeds) || typeof data.has_more !== "boolean") throw new Error("qzone public GetPublicRecomFeeds 分页响应异常");
	const feeds = data.feeds.map((entry) => {
		if (!isObject(entry) || !isObject(entry.feed)) throw new Error("qzone public GetPublicRecomFeeds 动态响应异常");
		return entry.feed;
	});
	let lastUnion = state.last_client_feed_union_id;
	for (const feed of feeds) {
		const common = feed.cell_common;
		if (isObject(common) && common.feed_type !== 3 && isObject(common.union_id)) lastUnion = common.union_id;
	}
	let nextCursor = null;
	if (data.has_more) {
		if (typeof data.attach_info !== "string") throw new Error("qzone public GetPublicRecomFeeds 缺少 attach_info");
		nextCursor = encodeCursor({
			...state,
			attach_info: data.attach_info,
			last_client_feed_union_id: lastUnion
		});
	}
	return {
		...data,
		feeds,
		has_more: data.has_more,
		next_cursor: nextCursor
	};
}
function getQzonePublicFeedDetail(cookies, feed) {
	return request(cookies, reader, "GetFeedDetail", "0x97b1_1", {
		...feedParams(feed),
		feed_action_domain_type: 3,
		from_page: 1
	});
}
function getQzonePublicComments(cookies, feed, cursor) {
	return request(cookies, reader, "GetComment", "0x9bfd_1", {
		...feedParams(feed),
		attach_info: cursor
	});
}
function getQzonePublicReplies(cookies, feed, comment, cursor, pageSize) {
	return request(cookies, reader, "GetReplies", "0x9bfe_1", {
		...feedParams(feed),
		cur_comment: comment,
		comment_attach_info: "",
		reply_attach_info: cursor || comment.reply_attach_info || "",
		page_size: pageSize
	});
}
async function setQzonePublicUpvote(cookies, feed, enable) {
	const data = await request(cookies, upvote, enable ? "Upvote" : "Downvote", enable ? "0x9d18_1" : "0x9d19_1", feedParams(feed));
	if (!data.upvote) throw new Error("qzone public upvote 响应缺少 upvote");
	return data;
}
async function setLike(cookies, feed, likeKey, likeType, enable) {
	if (typeof likeKey !== "string" || !likeKey) throw new Error("空友点赞目标缺少 like_key");
	const data = await request(cookies, interaction, enable ? "DoLike" : "UnLike", enable ? "0x9699_1" : "0x969c_1", {
		...feedParams(feed),
		like_key: likeKey,
		like_type: likeType
	});
	if (!data.like) throw new Error("qzone public like 响应缺少 like");
	return data;
}
function setQzonePublicLike(cookies, feed, enable) {
	const common = feed.cell_common;
	return setLike(cookies, feed, isObject(common) ? common.cur_like_key : void 0, 1, enable);
}
function setQzonePublicCommentLike(cookies, feed, comment, enable, reply) {
	const like = (reply ?? comment).like;
	return setLike(cookies, feed, isObject(like) ? like.id : void 0, reply ? 3 : 2, enable);
}
function richContent(content) {
	return typeof content === "string" ? [{
		type: 0,
		content
	}] : content;
}
async function commentQzonePublicFeed(cookies, feed, user, content) {
	const data = await request(cookies, interaction, "AddComment", "0x9676_1", {
		...feedParams(feed),
		comment: {
			user,
			content: richContent(content)
		}
	});
	if (!data.comment) throw new Error("qzone public AddComment 响应缺少 comment");
	return data;
}
async function replyQzonePublicFeed(cookies, feed, user, comment, content, reply) {
	const targetUser = reply?.user ?? comment.user;
	if (!isObject(targetUser)) throw new Error("空友评论或回复缺少 user");
	const data = await request(cookies, interaction, "AddReply", "0x9677_1", {
		...feedParams(feed),
		comment,
		reply: {
			content: richContent(content),
			target_user: targetUser,
			user
		}
	});
	if (!data.reply) throw new Error("qzone public AddReply 响应缺少 reply");
	return data;
}
function deleteQzonePublicComment(cookies, feed, comment) {
	return request(cookies, interaction, "DeleteComment", "0x9989_0", {
		...feedParams(feed),
		comment
	});
}
function deleteQzonePublicReply(cookies, feed, comment, reply) {
	return request(cookies, interaction, "DeleteReply", "0x998a_0", {
		...feedParams(feed),
		comment,
		reply
	});
}
async function setQzonePublicFollow(cookies, feed, enable) {
	const params = feedParams(feed);
	const common = feed.cell_common;
	const user = isObject(feed.cell_user_info) ? feed.cell_user_info.user : void 0;
	const uid = isObject(user) && typeof user.uid === "string" ? user.uid.trim() : "";
	const uin = isObject(user) && typeof user.uin === "string" ? user.uin.trim() : "";
	const useUid = common.domain_type === 3 && !!uid || !uin;
	if (useUid ? !uid : !uin) throw new Error("空友动态缺少作者 uid/uin");
	const union = params.union_id;
	const data = await request(cookies, relation, enable ? "Follow" : "Unfollow", enable ? "0x9d1a_1" : "0x9d1b_1", {
		follow_from_type: 1,
		...useUid ? { target_uid: uid } : { target_uin: uin },
		...union.uf_key ? { follow_feed_id: union.uf_key } : {},
		...feed.cell_feed_transfer === void 0 ? {} : { cell_feed_transfer: feed.cell_feed_transfer }
	});
	if (data.ret_code !== void 0 && data.ret_code !== null && data.ret_code !== 0 && data.ret_code !== "0") throw new Error(`qzone public follow failed: ret_code=${data.ret_code} ${data.ret_msg ?? ""}`.trim());
	return data;
}
function forwardQzonePublicFeed(cookies, feed, reason) {
	return request(cookies, "trpc.qzone.feeds_writer.FeedsWriter", "ForwardFeed", "0x969a_1", {
		...feedParams(feed),
		reason
	});
}
export {};
