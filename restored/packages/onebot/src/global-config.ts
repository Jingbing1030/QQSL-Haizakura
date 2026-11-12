// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/global-config.ts"
// original bundle lines 5932-6083  (150 lines) of dist/index.mjs
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
var log$66 = createLogger("OneBot.GlobalConfig");
var CONFIG_DIR$4 = "config";
var GLOBAL_CONFIG_PATH = path$1.join(CONFIG_DIR$4, "snowluma.json");
function defaultGlobalSettings() {
	return {
		rkey: { fallbackServers: [] },
		musicSignUrl: "",
		videoUploadConcurrency: 1
	};
}
/** Keep only well-formed, deduped http(s) URLs (must parse + have a host). */
function normalizeRkeyServers(value) {
	if (!Array.isArray(value)) return [];
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const item of value) {
		if (typeof item !== "string") continue;
		const v = item.trim();
		if (!v || !isHttpUrl$1(v) || seen.has(v)) continue;
		seen.add(v);
		out.push(v);
	}
	return out;
}
function isHttpUrl$1(value) {
	try {
		const u = new URL(value);
		return (u.protocol === "http:" || u.protocol === "https:") && u.host.length > 0;
	} catch {
		return false;
	}
}
function normalizeGlobalSettings(value) {
	const out = defaultGlobalSettings();
	if (!isObject$3(value)) return out;
	const rkey = value.rkey;
	if (isObject$3(rkey)) out.rkey.fallbackServers = normalizeRkeyServers(rkey.fallbackServers);
	if (typeof value.musicSignUrl === "string") {
		const v = value.musicSignUrl.trim();
		out.musicSignUrl = v && isHttpUrl$1(v) ? v : "";
	}
	if ("videoUploadConcurrency" in value) out.videoUploadConcurrency = validateUploadConcurrency(value.videoUploadConcurrency);
	return out;
}
function loadGlobalSettings() {
	if (!fs$1.existsSync(GLOBAL_CONFIG_PATH)) return defaultGlobalSettings();
	try {
		const raw = fs$1.readFileSync(GLOBAL_CONFIG_PATH, "utf8");
		return normalizeGlobalSettings(JSON.parse(raw));
	} catch (err) {
		if (err instanceof RangeError) {
			log$66.error("invalid global upload settings: %s", err.message);
			throw err;
		}
		log$66.warn("config/snowluma.json is corrupt and will be ignored: %s", err instanceof Error ? err.message : String(err));
		return defaultGlobalSettings();
	}
}
/**
* Persist global settings, SECTION-MERGING over what's on disk: only the
* top-level sections actually present in `incoming` are overwritten, so a
* partial save (e.g. just `rkey`) never wipes a sibling knob. Mirrors
* saveNotificationsConfig's merge discipline.
*/
function saveGlobalSettings(incoming) {
	const merged = loadGlobalSettings();
	if (isObject$3(incoming)) {
		if (isObject$3(incoming.rkey)) merged.rkey.fallbackServers = normalizeRkeyServers(incoming.rkey.fallbackServers);
		if ("videoUploadConcurrency" in incoming) merged.videoUploadConcurrency = validateUploadConcurrency(incoming.videoUploadConcurrency);
		if (typeof incoming.musicSignUrl === "string") {
			const v = incoming.musicSignUrl.trim();
			merged.musicSignUrl = v && isHttpUrl$1(v) ? v : "";
		}
	}
	fs$1.mkdirSync(CONFIG_DIR$4, { recursive: true });
	const tmp = GLOBAL_CONFIG_PATH + ".tmp";
	fs$1.writeFileSync(tmp, JSON.stringify(toJson(merged), null, 2), "utf8");
	fs$1.renameSync(tmp, GLOBAL_CONFIG_PATH);
	return merged;
}
function toJson(settings) {
	return {
		rkey: { fallbackServers: settings.rkey.fallbackServers },
		musicSignUrl: settings.musicSignUrl,
		videoUploadConcurrency: settings.videoUploadConcurrency ?? 1
	};
}
function isObject$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* One-shot copy-up: `musicSignUrl` used to live in per-UIN config. If the global
* store has none yet, lift the first non-empty value found in any legacy
* `config/onebot*.json` into `config/snowluma.json`. Idempotent — skips once the
* global value is set. (If an operator later clears the global value while a
* stale per-UIN value lingers, a restart would re-copy it; benign and rare.)
*/
function migrateGlobalSettings() {
	if (globalConfigHasMusicSignUrlKey()) return;
	const found = scanLegacyMusicSignUrl();
	if (!found) return;
	saveGlobalSettings({ musicSignUrl: found.value });
	const extra = found.others.length ? `; ignored differing value(s) in ${found.others.join(", ")}` : "";
	log$66.info("migrated musicSignUrl to global config from %s: %s%s", found.source, found.value, extra);
}
function globalConfigHasMusicSignUrlKey() {
	if (!fs$1.existsSync(GLOBAL_CONFIG_PATH)) return false;
	try {
		const raw = JSON.parse(fs$1.readFileSync(GLOBAL_CONFIG_PATH, "utf8"));
		return isObject$3(raw) && "musicSignUrl" in raw;
	} catch {
		return false;
	}
}
/** Scan config/onebot.json + config/onebot_<uin>.json for a non-empty
*  musicSignUrl. Returns the first found plus any other files that carried a
*  (differing) value, for logging. */
function scanLegacyMusicSignUrl() {
	let dir;
	try {
		dir = fs$1.readdirSync(CONFIG_DIR$4);
	} catch {
		return null;
	}
	const files = dir.filter((f) => f === "onebot.json" || /^onebot_\d+\.json$/.test(f)).sort();
	let first = null;
	const others = [];
	for (const file of files) {
		let value;
		try {
			const raw = JSON.parse(fs$1.readFileSync(path$1.join(CONFIG_DIR$4, file), "utf8"));
			value = isObject$3(raw) ? raw.musicSignUrl : void 0;
		} catch {
			continue;
		}
		if (typeof value !== "string") continue;
		const v = value.trim();
		if (!v || !isHttpUrl$1(v)) continue;
		if (!first) first = {
			value: v,
			source: file
		};
		else if (v !== first.value) others.push(file);
	}
	return first ? {
		...first,
		others
	} : null;
}
export {};
