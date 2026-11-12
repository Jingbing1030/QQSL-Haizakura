// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/runtime.ts"
// original bundle lines 223-410  (186 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/**
* Pure on-disk-object → typed config normalization (defaults + validation,
* no fs / no env). Exported for testing; `loadRuntimeConfig` wraps it.
*/
function normalizeRuntimeConfig(parsed) {
	const obj = isObject$5(parsed) ? parsed : {};
	return {
		...obj.updateSource === void 0 ? {} : { updateSource: normalizeUpdateSourceConfig(obj.updateSource) },
		webuiPort: normalizePort(obj.webuiPort ?? DEFAULT_WEBUI_PORT, DEFAULT_WEBUI_PORT),
		hookAutoLoad: normalizeBool(obj.hookAutoLoad, false),
		webuiHost: normalizeHost(obj.webuiHost),
		webuiTls: { enabled: isObject$5(obj.webuiTls) ? normalizeBool(obj.webuiTls.enabled, false) : false },
		trustProxy: typeof obj.trustProxy === "string" ? obj.trustProxy : "",
		logMaxTotalMb: normalizeRequiredInteger(obj.logMaxTotalMb, DEFAULT_LOG_MAX_TOTAL_MB, 1, MAX_LOG_TOTAL_MB, "logMaxTotalMb"),
		logRetainDays: normalizeRequiredInteger(obj.logRetainDays, 7, 0, MAX_LOG_RETAIN_DAYS, "logRetainDays"),
		logPerUin: normalizeRequiredBool(obj.logPerUin, false, "logPerUin")
	};
}
/**
* Pure SNOWLUMA_* env → override patch (no fs). Env wins over runtime.json
* (a trusted launcher like SnowLumaDesktop pins these per-launch without
* rewriting the file). Absent vars produce no key.
*/
function resolveRuntimeEnvOverrides(env) {
	const out = {};
	const port = parsePortString(env.SNOWLUMA_WEBUI_PORT);
	if (port !== void 0) out.webuiPort = port;
	const host = env.SNOWLUMA_WEBUI_HOST;
	if (typeof host === "string" && host.trim()) out.webuiHost = host.trim();
	const tp = env.SNOWLUMA_WEBUI_TRUST_PROXY;
	if (typeof tp === "string") out.trustProxy = tp;
	const logMaxTotalMb = parseRequiredIntegerEnv(env.SNOWLUMA_LOG_MAX_TOTAL_MB, 1, MAX_LOG_TOTAL_MB, "SNOWLUMA_LOG_MAX_TOTAL_MB");
	if (logMaxTotalMb !== void 0) out.logMaxTotalMb = logMaxTotalMb;
	const logRetainDays = parseRequiredIntegerEnv(env.SNOWLUMA_LOG_RETAIN_DAYS, 0, MAX_LOG_RETAIN_DAYS, "SNOWLUMA_LOG_RETAIN_DAYS");
	if (logRetainDays !== void 0) out.logRetainDays = logRetainDays;
	const logPerUin = parseRequiredBoolEnv(env.SNOWLUMA_LOG_PER_UIN, "SNOWLUMA_LOG_PER_UIN");
	if (logPerUin !== void 0) out.logPerUin = logPerUin;
	const webuiTls = parseRequiredBoolEnv(env.SNOWLUMA_WEBUI_TLS, "SNOWLUMA_WEBUI_TLS");
	if (webuiTls !== void 0) out.webuiTls = { enabled: webuiTls };
	return out;
}
function loadRuntimeConfig() {
	fs$1.mkdirSync(CONFIG_DIR$6, { recursive: true });
	const parsed = tryLoadRuntimeConfig();
	const normalized = normalizeRuntimeConfig(parsed ?? {});
	if (parsed === null || !sameRuntimeConfig(parsed, normalized)) saveRuntimeConfig(normalized);
	return {
		...normalized,
		...resolveRuntimeEnvOverrides(process.env)
	};
}
/**
* Read the persisted config (normalized, no env overrides, no write). For the
* settings panel's GET — shows what's actually saved/editable on disk.
*/
function readRuntimeConfig() {
	return normalizeRuntimeConfig(tryLoadRuntimeConfig() ?? {});
}
/**
* Persist a partial update. Merges onto the ON-DISK config (not the env-merged
* runtime view) so an env override (e.g. SNOWLUMA_WEBUI_PORT) is never baked
* into runtime.json. Returns the new persisted config (without env overrides).
*/
function updateRuntimeConfig(patch) {
	fs$1.mkdirSync(CONFIG_DIR$6, { recursive: true });
	const next = normalizeRuntimeConfig({
		...normalizeRuntimeConfig(tryLoadRuntimeConfig() ?? {}),
		...patch
	});
	saveRuntimeConfig(next);
	return next;
}
function tryLoadRuntimeConfig() {
	if (!fs$1.existsSync(RUNTIME_CONFIG_PATH)) return null;
	try {
		const parsed = JSON.parse(fs$1.readFileSync(RUNTIME_CONFIG_PATH, "utf8"));
		return isObject$5(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
function saveRuntimeConfig(config) {
	const temporaryPath = `${RUNTIME_CONFIG_PATH}.tmp-${String(process.pid)}`;
	try {
		fs$1.writeFileSync(temporaryPath, JSON.stringify(config, null, 2), "utf8");
		fs$1.renameSync(temporaryPath, RUNTIME_CONFIG_PATH);
	} catch (error) {
		try {
			fs$1.unlinkSync(temporaryPath);
		} catch (cleanupError) {
			if (!isErrnoCode(cleanupError, "ENOENT")) throw new AggregateError([error, cleanupError], "failed to persist runtime config and remove its temporary file");
		}
		throw error;
	}
}
/** True when the raw on-disk object already matches the normalized config
*  on every known field (so we can skip a needless rewrite). */
function sameRuntimeConfig(parsed, n) {
	const parsedTls = isObject$5(parsed.webuiTls) ? parsed.webuiTls.enabled : void 0;
	return parsed.webuiPort === n.webuiPort && parsed.hookAutoLoad === n.hookAutoLoad && parsed.webuiHost === n.webuiHost && parsedTls === n.webuiTls?.enabled && parsed.trustProxy === n.trustProxy && parsed.logMaxTotalMb === n.logMaxTotalMb && parsed.logRetainDays === n.logRetainDays && parsed.logPerUin === n.logPerUin && JSON.stringify(parsed.updateSource) === JSON.stringify(n.updateSource);
}
function parsePortString(raw) {
	if (typeof raw !== "string" || !raw.trim()) return;
	const n = Number(raw.trim());
	if (!Number.isFinite(n)) return;
	const port = Math.trunc(n);
	if (port <= 0 || port > 65535) return;
	return port;
}
function normalizeHost(value) {
	if (typeof value === "string" && value.trim()) return value.trim();
	return DEFAULT_WEBUI_HOST;
}
function normalizePort(value, fallback) {
	if (typeof value === "number" && Number.isFinite(value)) {
		const n = Math.trunc(value);
		if (n > 0 && n <= 65535) return n;
		return fallback;
	}
	if (typeof value === "string" && value.trim()) {
		const n = Number(value);
		if (Number.isFinite(n)) {
			const port = Math.trunc(n);
			if (port > 0 && port <= 65535) return port;
		}
	}
	return fallback;
}
function normalizeRequiredInteger(value, fallback, min, max, field) {
	if (value === void 0) return fallback;
	const n = typeof value === "string" && value.trim() ? Number(value.trim()) : value;
	if (typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max) return n;
	throw new RangeError(`${field} must be an integer in ${String(min)}..${String(max)}`);
}
function normalizeRequiredBool(value, fallback, field) {
	if (value === void 0) return fallback;
	const parsed = parseBoolValue(value);
	if (parsed !== void 0) return parsed;
	throw new TypeError(`${field} must be a boolean`);
}
function normalizeBool(value, fallback) {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string") {
		const v = value.trim().toLowerCase();
		if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
		if (v === "false" || v === "0" || v === "no" || v === "off" || v === "") return false;
	}
	return fallback;
}
function parseRequiredIntegerEnv(raw, min, max, field) {
	if (typeof raw !== "string" || !raw.trim()) return;
	const n = Number(raw.trim());
	if (Number.isSafeInteger(n) && n >= min && n <= max) return n;
	throw new RangeError(`${field} must be an integer in ${String(min)}..${String(max)}`);
}
function parseRequiredBoolEnv(raw, field) {
	if (typeof raw !== "string" || !raw.trim()) return;
	const parsed = parseBoolValue(raw);
	if (parsed !== void 0) return parsed;
	throw new TypeError(`${field} must be a boolean`);
}
function parseBoolValue(raw) {
	if (typeof raw === "boolean") return raw;
	if (raw === 1) return true;
	if (raw === 0) return false;
	if (typeof raw !== "string") return;
	const value = raw.trim().toLowerCase();
	if (value === "true" || value === "1" || value === "yes" || value === "on") return true;
	if (value === "false" || value === "0" || value === "no" || value === "off") return false;
}
function isErrnoCode(error, code) {
	return error instanceof Error && "code" in error && error.code === code;
}
var CONFIG_DIR$6, RUNTIME_CONFIG_PATH, DEFAULT_WEBUI_PORT, DEFAULT_WEBUI_HOST, DEFAULT_LOG_MAX_TOTAL_MB, MAX_LOG_TOTAL_MB, MAX_LOG_RETAIN_DAYS;
var init_runtime = __esmMin((() => {
	init_coerce();
	init_update_source();
	CONFIG_DIR$6 = "config";
	RUNTIME_CONFIG_PATH = path$1.join(CONFIG_DIR$6, "runtime.json");
	DEFAULT_WEBUI_PORT = 5099;
	DEFAULT_WEBUI_HOST = "127.0.0.1";
	DEFAULT_LOG_MAX_TOTAL_MB = 1024;
	MAX_LOG_TOTAL_MB = Math.floor(Number.MAX_SAFE_INTEGER / (1024 * 1024));
	MAX_LOG_RETAIN_DAYS = Math.floor(Number.MAX_SAFE_INTEGER / (1440 * 60 * 1e3));
}));
export {};
