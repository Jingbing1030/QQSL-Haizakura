init_logger();
var log$5 = createLogger("Update");
var CACHE_TTL_MS = 360 * 60 * 1e3;
var FETCH_TIMEOUT_MS = 8e3;
var NOTES_MAX = 4e3;
function isEnabled() {
	const v = (process.env.SNOWLUMA_UPDATE_CHECK ?? "").trim().toLowerCase();
	return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}
var updateCache = createSingleFlightCache({
	ttlMs: CACHE_TTL_MS,
	shouldCache: (r) => !r.error,
	load: async (key) => {
		const [current, source] = JSON.parse(key);
		const result = await fetchLatest(current, source);
		if (result.error) log$5.debug("update check failed: %s", result.error);
		else if (result.hasUpdate) log$5.info("a newer release is available: v%s (running v%s)", result.latest, current);
		return result;
	}
});
async function fetchLatest(current, source) {
	const base = {
		current,
		latest: null,
		hasUpdate: false,
		htmlUrl: null,
		notes: null,
		publishedAt: null,
		checkedAt: Date.now()
	};
	try {
		const { data: rel } = await fetchRelease(void 0, source, `SnowLuma/${current}`, FETCH_TIMEOUT_MS);
		if (!rel || typeof rel !== "object" || Array.isArray(rel)) return {
			...base,
			error: "invalid release info"
		};
		const tag = "tag_name" in rel && typeof rel.tag_name === "string" ? rel.tag_name.trim() : "";
		if (!tag) return {
			...base,
			error: "no tag"
		};
		const latest = tag.startsWith("v") ? tag.slice(1) : tag;
		if (!parseVersion(latest)) return {
			...base,
			error: "invalid release version"
		};
		return {
			current,
			latest,
			hasUpdate: compareVersions(latest, current) > 0,
			htmlUrl: "html_url" in rel && typeof rel.html_url === "string" ? rel.html_url : null,
			notes: "body" in rel && typeof rel.body === "string" && rel.body ? rel.body.slice(0, NOTES_MAX) : null,
			publishedAt: "published_at" in rel && typeof rel.published_at === "string" ? rel.published_at : null,
			checkedAt: Date.now()
		};
	} catch (e) {
		return {
			...base,
			error: e instanceof Error ? e.message : "network error"
		};
	}
}
/**
* Get the update-availability result. Cached for {@link CACHE_TTL_MS}; pass
* `force` to bypass the cache (the WebUI's "立即检查" button). Never throws —
* failures come back as a result with `error` set and `hasUpdate: false`, and
* are not cached so the next check retries.
*/
async function getUpdateInfo(force = false, source) {
	const current = APP_VERSION;
	if (!isEnabled()) return {
		...emptyResult(current),
		error: "disabled"
	};
	try {
		return await updateCache.get(JSON.stringify([current, source ?? readUpdateSource()]), { force });
	} catch (error) {
		return {
			...emptyResult(current),
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
function emptyResult(current) {
	return {
		current,
		latest: null,
		hasUpdate: false,
		htmlUrl: null,
		notes: null,
		publishedAt: null,
		checkedAt: Date.now()
	};
}
