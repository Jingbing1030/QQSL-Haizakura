// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/instance-rkey.ts"
// original bundle lines 40180-40371  (190 lines) of dist/index.mjs
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
var log$48 = createLogger("OneBot");
var RKEY_REFRESH_SKEW = 60;
var RKEY_REFRESH_COOLDOWN = 30;
var RKEY_EMPTY_COOLDOWN = 10;
var RKEY_REFRESH_TIMEOUT_MS = 5e3;
var PRIVATE_IMAGE_RKEY_TYPE = 10;
var GROUP_IMAGE_RKEY_TYPE = 20;
var PRIVATE_VIDEO_RKEY_TYPE = 12;
var GROUP_VIDEO_RKEY_TYPE = 22;
var PRIVATE_PTT_RKEY_TYPE = 14;
var GROUP_PTT_RKEY_TYPE = 24;
var FALLBACK_IMAGE_RKEY_TYPE = 2;
var RKeyCache = class {
	cache = /* @__PURE__ */ new Map();
	lastRefreshAttempt = 0;
	refreshInflight = null;
	/** Opt-in remote rkey endpoints; empty = feature off (the default). */
	fallbackServers;
	constructor(config) {
		this.fallbackServers = config?.fallbackServers ?? [];
	}
	/** Replace the fallback endpoint list (global-config hot-reload). */
	setFallbackServers(servers) {
		this.fallbackServers = servers;
	}
	warmUp(bridge, uin) {
		this.ensureFresh(bridge).then(() => log$48.info("rkeys loaded: UIN=%s count=%d", uin, this.cache.size), (err) => log$48.warn("failed to load rkeys for UIN %s: %s", uin, err instanceof Error ? err.message : String(err)));
	}
	resolveImageUrl(bridge, element, isGroup) {
		const url = element.imageUrl ?? "";
		const type = imageRKeyTypeFromUrl(url) ?? (isGroup ? GROUP_IMAGE_RKEY_TYPE : PRIVATE_IMAGE_RKEY_TYPE);
		return this.resolveUrl(bridge, url, type);
	}
	resolveMediaUrl(bridge, element, isGroup) {
		let type;
		if (element.type === "video") type = isGroup ? GROUP_VIDEO_RKEY_TYPE : PRIVATE_VIDEO_RKEY_TYPE;
		else if (element.type === "record") type = isGroup ? GROUP_PTT_RKEY_TYPE : PRIVATE_PTT_RKEY_TYPE;
		else type = isGroup ? GROUP_IMAGE_RKEY_TYPE : PRIVATE_IMAGE_RKEY_TYPE;
		return this.resolveUrl(bridge, element.url ?? "", type);
	}
	async resolveUrl(bridge, url, type) {
		if (!urlNeedsRKey(url)) return url;
		const rkey = await this.findRKeyForType(bridge, type);
		if (!rkey) return url;
		return url + (url.includes("?") ? "&rkey=" : "?rkey=") + encodeURIComponent(stripRKeyPrefix(rkey));
	}
	updateCache(rkeys) {
		const now = Math.floor(Date.now() / 1e3);
		for (const rk of rkeys) {
			if (!rk.rkey || !rk.type) continue;
			const baseTime = rk.createTime || now;
			const ttl = rk.ttlSeconds || 3600;
			this.cache.set(rk.type, {
				value: rk.rkey,
				expiresAt: baseTime + ttl
			});
		}
	}
	/** True when at least one common image rkey (group or private) is cached and
	*  still valid — i.e. we can sign a typical image without a fresh fetch. */
	hasUsableRkey() {
		return this.findInCache(GROUP_IMAGE_RKEY_TYPE) !== null || this.findInCache(PRIVATE_IMAGE_RKEY_TYPE) !== null;
	}
	/** Pull a still-valid rkey out of the cache, or null if missing/expiring. */
	findInCache(primaryType) {
		const now = Math.floor(Date.now() / 1e3);
		const tryFind = (type) => {
			const cached = this.cache.get(type);
			if (!cached || !cached.value) return null;
			if (cached.expiresAt !== 0 && now + RKEY_REFRESH_SKEW >= cached.expiresAt) return null;
			return cached.value;
		};
		return tryFind(primaryType) ?? tryFind(FALLBACK_IMAGE_RKEY_TYPE);
	}
	async findRKeyForType(bridge, primaryType) {
		const cached = this.findInCache(primaryType);
		if (cached) return cached;
		await this.ensureFresh(bridge);
		return this.findInCache(primaryType);
	}
	/**
	* Refresh the rkey cache via OIDB 0x9067_202, coalescing concurrent
	* callers onto one in-flight request and backing off (RKEY_REFRESH_COOLDOWN
	* when a usable rkey is held, RKEY_EMPTY_COOLDOWN while none is) so a
	* persistently-failing fetch isn't hammered once per inbound image. The await
	* is bounded by RKEY_REFRESH_TIMEOUT_MS.
	*/
	async ensureFresh(bridge) {
		if (!this.refreshInflight) {
			const now = Math.floor(Date.now() / 1e3);
			const cooldown = this.hasUsableRkey() ? RKEY_REFRESH_COOLDOWN : RKEY_EMPTY_COOLDOWN;
			if (now - this.lastRefreshAttempt < cooldown) return;
			this.lastRefreshAttempt = now;
			this.refreshInflight = this.runRefresh(bridge).finally(() => {
				this.refreshInflight = null;
			});
		}
		const inflight = this.refreshInflight;
		let timer;
		const timeout = new Promise((resolve) => {
			timer = setTimeout(resolve, RKEY_REFRESH_TIMEOUT_MS);
		});
		try {
			await Promise.race([inflight, timeout]);
		} finally {
			clearTimeout(timer);
		}
	}
	/** One refresh round: native OIDB fetch, then — only if that left us without
	*  a usable image rkey AND fallback servers are configured — the remote
	*  fallback. Never throws; logs and degrades to whatever the cache holds. */
	async runRefresh(bridge) {
		try {
			const rkeys = await bridge.apis.contacts.fetchDownloadRKeys();
			this.updateCache(rkeys);
		} catch (err) {
			log$48.warn("rkey refresh failed: %s", err instanceof Error ? err.message : String(err));
		}
		if (this.fallbackServers.length > 0 && !this.hasUsableRkey()) await this.refreshFromFallback();
	}
	/** Ask each configured fallback server in turn for an rkey, stopping at the
	*  first that yields one. Populates the group/private image rkey types. */
	async refreshFromFallback() {
		for (const server of this.fallbackServers) try {
			const data = await fetchFallbackRkey(server);
			if (!data) continue;
			const now = Math.floor(Date.now() / 1e3);
			const expiresAt = data.expiredTime > now ? data.expiredTime : now + 3600;
			if (data.groupRkey) this.setFallbackRkey(GROUP_IMAGE_RKEY_TYPE, data.groupRkey, expiresAt);
			if (data.privateRkey) this.setFallbackRkey(PRIVATE_IMAGE_RKEY_TYPE, data.privateRkey, expiresAt);
			if (data.groupRkey || data.privateRkey) {
				log$48.info("rkey loaded from fallback server %s", server);
				return;
			}
		} catch (err) {
			log$48.warn("rkey fallback server %s failed: %s", server, err instanceof Error ? err.message : String(err));
		}
	}
	setFallbackRkey(type, value, expiresAt) {
		this.cache.set(type, {
			value,
			expiresAt
		});
	}
};
/** Fetch + parse one fallback server's response. Accepts the bare
*  `{ group_rkey, private_rkey, expired_time }` shape and an OneBot
*  `{ retcode, data: {...} }` wrapper. Returns null when neither rkey is
*  present. The stored values keep any leading `&rkey=`/`?rkey=` — resolveImageUrl
*  strips it before re-appending, so both prefixed and bare tokens work. */
async function fetchFallbackRkey(server) {
	const res = await fetch(server, { signal: AbortSignal.timeout(RKEY_REFRESH_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`http ${res.status}`);
	let body = await res.json();
	if (body && typeof body === "object" && "retcode" in body && isRecord(body.data)) body = body.data;
	if (!isRecord(body)) return null;
	const groupRkey = typeof body.group_rkey === "string" ? body.group_rkey : "";
	const privateRkey = typeof body.private_rkey === "string" ? body.private_rkey : "";
	if (!groupRkey && !privateRkey) return null;
	return {
		groupRkey,
		privateRkey,
		expiredTime: typeof body.expired_time === "number" ? body.expired_time : 0
	};
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
var APPID_PRIVATE_IMAGE = "1406";
var APPID_GROUP_IMAGE = "1407";
/** Map the `appid` baked into an NT download URL to its rkey type. Returns
*  null when the URL carries no recognised appid, leaving the caller to fall
*  back to the message's group/private context. */
function imageRKeyTypeFromUrl(url) {
	const match = url.match(/[?&]appid=(\d+)/);
	if (!match) return null;
	if (match[1] === APPID_PRIVATE_IMAGE) return PRIVATE_IMAGE_RKEY_TYPE;
	if (match[1] === APPID_GROUP_IMAGE) return GROUP_IMAGE_RKEY_TYPE;
	return null;
}
function urlNeedsRKey(url) {
	if (!url || url.includes("rkey=")) return false;
	if (url.includes("gchat.qpic.cn")) return false;
	return url.includes("multimedia.nt.qq.com.cn") || url.includes(".nt.qq.com.cn") || url.includes("/download");
}
function stripRKeyPrefix(rkey) {
	for (const prefix of ["&rkey=", "?rkey="]) if (rkey.startsWith(prefix)) return rkey.slice(prefix.length);
	return rkey;
}
export {};
