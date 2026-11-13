// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/config.ts"
// original bundle lines 5124-5931  (806 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
init_env();
init_logger();
var log$67 = createLogger("OneBot.Config");
var CONFIG_DIR$5 = "config";
var DEFAULT_CONFIG_PATH = path$1.join(CONFIG_DIR$5, "onebot.json");
var DEFAULT_ACCESS_TOKEN_BYTES = 32;
var NODE_TIMER_MAX_MS = 2147483647;
/** Bounds for a per-adapter inbound WebSocket frame cap. 2 GiB is several
*  orders of magnitude past any real OneBot frame; above that a sender has to
*  split its payload instead of expecting a single buffer to hold it. */
var MAX_PAYLOAD_BYTES_MIN = 1024;
var MAX_PAYLOAD_BYTES_MAX = 2 * 1024 * 1024 * 1024;
var PER_UIN_SNAPSHOT_MARKER = "snapshot";
var DEFAULT_STATUS_COMMAND = {
	enabled: true,
	swallow: false,
	cooldownSeconds: 5,
	trigger: "#Haizakura"
};
/** Upper bound on the status-command reply cooldown — a year is effectively "off but sane". */
var STATUS_COMMAND_COOLDOWN_MAX = 31536e3;
function makeDefaultStatusCommand() {
	return { ...DEFAULT_STATUS_COMMAND };
}
function makeDefaultOneBotConfig() {
	return {
		networks: {
			httpServers: [{
				name: "http-default",
				host: "127.0.0.1",
				port: 3e3,
				path: "/",
				enableWebSocket: false,
				enableSse: false,
				accessToken: generateAccessToken(),
				messageFormat: "array",
				reportSelfMessage: false
			}],
			httpClients: [],
			wsServers: [{
				name: "ws-default",
				host: "127.0.0.1",
				port: 3001,
				path: "/",
				role: "Universal",
				accessToken: generateAccessToken(),
				messageFormat: "array",
				reportSelfMessage: false
			}],
			wsClients: []
		},
		statusCommand: makeDefaultStatusCommand(),
		historySync: { enabled: false },
		notifications: { channelIds: [] }
	};
}
function generateAccessToken() {
	return randomBytes$1(DEFAULT_ACCESS_TOKEN_BYTES).toString("base64url");
}
/** A deterministic configuration error. Callers may safely return this as a
*  4xx without conflating it with filesystem/runtime failures. */
var OneBotConfigValidationError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "OneBotConfigValidationError";
	}
};
function loadOneBotConfig(uin, options = {}) {
	ensureConfigDir$4();
	const perUinPath = path$1.join(CONFIG_DIR$5, `onebot_${uin}.json`);
	const globalRaw = tryLoadJson(DEFAULT_CONFIG_PATH);
	const perUinRaw = tryLoadJson(perUinPath, true);
	const legacy = !!perUinRaw && hasLegacyTopLevel(perUinRaw);
	const sources = [];
	const isCanonicalSnapshot = perUinRaw?.mode === PER_UIN_SNAPSHOT_MARKER;
	if (globalRaw && !isCanonicalSnapshot) sources.push(globalRaw);
	if (perUinRaw) sources.push(perUinRaw);
	const config = fromJson(sources, !perUinRaw && !globalRaw);
	if (options.persistDefaults && (!perUinRaw || legacy)) saveOneBotConfig(uin, config, { mode: globalRaw ? "overlay" : "snapshot" });
	return applyOneBotListenPortOverrides(config);
}
var HTTP_DEFAULT_SERVER = "http-default";
var WS_DEFAULT_SERVER = "ws-default";
/** Override only the factory listeners. Other adapters keep their saved ports. */
function applyOneBotListenPortOverrides(config, env = process.env) {
	const httpPort = readListenPort("SNOWLUMA_ONEBOT_HTTP_PORT", env);
	const wsPort = readListenPort("SNOWLUMA_ONEBOT_WS_PORT", env);
	if (httpPort === void 0 && wsPort === void 0) return config;
	const next = structuredClone(config);
	const httpApplied = httpPort !== void 0 && assignFactoryPort(next.networks.httpServers, HTTP_DEFAULT_SERVER, httpPort, "SNOWLUMA_ONEBOT_HTTP_PORT");
	const wsApplied = wsPort !== void 0 && assignFactoryPort(next.networks.wsServers, WS_DEFAULT_SERVER, wsPort, "SNOWLUMA_ONEBOT_WS_PORT");
	if (!httpApplied && !wsApplied) return config;
	try {
		assertValidOneBotConfig(next);
	} catch (error) {
		log$67.warn("OneBot listen port override ignored: %s", error instanceof Error ? error.message : String(error));
		return config;
	}
	return next;
}
function readListenPort(name, env) {
	const raw = env[name];
	if (typeof raw !== "string" || !raw.trim()) return;
	const port = positiveIntEnv(name, 0, {
		max: 65535,
		env
	});
	return port > 0 ? port : void 0;
}
function assignFactoryPort(servers, name, port, envName) {
	const server = servers.find((entry) => entry.name === name);
	if (!server) {
		log$67.warn("%s is ignored; no %s listener", envName, name);
		return false;
	}
	server.port = port;
	return true;
}
function saveOneBotConfig(uin, config, options = {}) {
	assertValidOneBotConfig(config);
	ensureConfigDir$4();
	saveJson(path$1.join(CONFIG_DIR$5, `onebot_${uin}.json`), toJsonObject(config, options.mode ?? "snapshot"));
}
/**
* Parse and canonicalize an on-disk OneBot config without touching the
* filesystem. Restore uses this owner-provided seam so legacy layouts are
* migrated deliberately while malformed values cannot disappear through the
* normal load path's permissive compatibility parser.
*/
function prepareOneBotConfigForRestore(value, scope, inheritedGlobal) {
	if (!isObject$4(value)) invalid("restore source must be an object");
	validateOneBotRestoreSource(value);
	let global = null;
	if (inheritedGlobal !== void 0 && inheritedGlobal !== null) {
		if (!isObject$4(inheritedGlobal)) invalid("inherited global restore source must be an object");
		validateOneBotRestoreSource(inheritedGlobal);
		global = inheritedGlobal;
	}
	if (scope === "global") return {
		value,
		migratedFields: []
	};
	const canonical = toJsonObject(fromJson(value.mode !== PER_UIN_SNAPSHOT_MARKER && global ? [global, value] : [value], false), scope === "per-uin" && value.mode === PER_UIN_SNAPSHOT_MARKER ? "snapshot" : "overlay");
	if (Object.prototype.hasOwnProperty.call(value, "musicSignUrl")) canonical.musicSignUrl = value.musicSignUrl;
	return {
		value: canonical,
		migratedFields: JSON.stringify(value) === JSON.stringify(canonical) ? [] : ["$"]
	};
}
var RESTORE_TOP_LEVEL_KEYS = /* @__PURE__ */ new Set([
	"mode",
	"networks",
	"statusCommand",
	"historySync",
	"notifications",
	"musicSignUrl",
	"httpServers",
	"httpClients",
	"httpPostEndpoints",
	"wsServers",
	"wsClients",
	"messageFormat",
	"reportSelfMessage"
]);
var RESTORE_NETWORK_KEYS = /* @__PURE__ */ new Set([
	"httpServers",
	"httpClients",
	"wsServers",
	"wsClients"
]);
var RESTORE_BASE_ADAPTER_KEYS = [
	"name",
	"enabled",
	"accessToken",
	"messageFormat", "protocol",
	"reportSelfMessage"
];
function validateOneBotRestoreSource(value) {
	rejectUnknownKeys(value, RESTORE_TOP_LEVEL_KEYS, "$");
	if (value.mode !== void 0 && value.mode !== "snapshot" && value.mode !== "overlay") invalid("$.mode must be snapshot or overlay");
	if (value.messageFormat !== void 0 && parseMessageFormat(value.messageFormat) === void 0) invalid("$.messageFormat must be array or string");
	if (value.reportSelfMessage !== void 0 && typeof value.reportSelfMessage !== "boolean") invalid("$.reportSelfMessage must be a boolean");
	if (value.musicSignUrl !== void 0) {
		if (typeof value.musicSignUrl !== "string") invalid("$.musicSignUrl must be a string");
		const url = value.musicSignUrl.trim();
		if (url && !isHttpUrlForRestore(url)) invalid("$.musicSignUrl must be empty or an http(s) URL");
	}
	const networks = value.networks;
	if (networks !== void 0) {
		if (!isObject$4(networks)) invalid("$.networks must be an object");
		rejectUnknownKeys(networks, RESTORE_NETWORK_KEYS, "$.networks");
	}
	const counts = {
		httpServers: 0,
		httpClients: 0,
		wsServers: 0,
		wsClients: 0
	};
	const visit = (owner, key, pathPrefix) => {
		if (owner[key] === void 0) return;
		counts[key] += validateRestoreAdapterArray(owner[key], key, `${pathPrefix}.${key}`);
	};
	if (isObject$4(networks)) for (const key of RESTORE_NETWORK_KEYS) visit(networks, key, "$.networks");
	for (const key of RESTORE_NETWORK_KEYS) visit(value, key, "$");
	if (value.httpPostEndpoints !== void 0) counts.httpClients += validateRestoreAdapterArray(value.httpPostEndpoints, "httpClients", "$.httpPostEndpoints");
	validateRestoreStatusCommand(value.statusCommand);
	validateRestoreHistorySync(value.historySync);
	validateRestoreNotifications(value.notifications);
	const parsed = fromJson([value], false);
	for (const key of RESTORE_NETWORK_KEYS) {
		const kind = key;
		if (parsed.networks[kind].length !== counts[kind]) invalid(`$.${kind} contains a duplicate or unusable adapter`);
	}
}
function validateRestoreAdapterArray(value, kind, at) {
	if (!Array.isArray(value)) invalid(`${at} must be an array`);
	const specific = kind === "httpServers" || kind === "wsServers" ? [
		"host",
		"port",
		"path"
	] : kind === "httpClients" ? ["url", "timeoutMs"] : [
		"url",
		"role",
		"reconnectIntervalMs"
	];
	if (kind === "httpServers") specific.push("enableWebSocket", "enableSse", "maxPayloadBytes");
	if (kind === "wsServers") specific.push("role", "maxPayloadBytes");
	if (kind === "wsClients") specific.push("maxPayloadBytes");
	const allowed = /* @__PURE__ */ new Set([...RESTORE_BASE_ADAPTER_KEYS, ...specific]);
	value.forEach((raw, index) => {
		const pathAt = `${at}[${String(index)}]`;
		if (!isObject$4(raw)) invalid(`${pathAt} must be an object`);
		rejectUnknownKeys(raw, allowed, pathAt);
		if (raw.name !== void 0 && typeof raw.name !== "string") invalid(`${pathAt}.name must be a string`);
		if (raw.enabled !== void 0 && typeof raw.enabled !== "boolean") invalid(`${pathAt}.enabled must be a boolean`);
		if (raw.accessToken !== void 0 && typeof raw.accessToken !== "string") invalid(`${pathAt}.accessToken must be a string`);
		if (raw.messageFormat !== void 0 && parseMessageFormat(raw.messageFormat) === void 0) invalid(`${pathAt}.messageFormat must be array or string`);
		if (raw.reportSelfMessage !== void 0 && typeof raw.reportSelfMessage !== "boolean") invalid(`${pathAt}.reportSelfMessage must be a boolean`);
		if (kind !== "httpClients") parseMaxPayloadBytes(raw.maxPayloadBytes, pathAt);
		if (kind === "httpServers" || kind === "wsServers") {
			const port = parseRestoreInteger(raw.port);
			if (port === null || port <= 0 || port > 65535) invalid(`${pathAt}.port must be an integer between 1 and 65535`);
			if (raw.host !== void 0 && typeof raw.host !== "string") invalid(`${pathAt}.host must be a string`);
			if (raw.path !== void 0 && typeof raw.path !== "string") invalid(`${pathAt}.path must be a string`);
			if (kind === "httpServers" && raw.enableWebSocket !== void 0 && typeof raw.enableWebSocket !== "boolean") invalid(`${pathAt}.enableWebSocket must be a boolean`);
			if (kind === "httpServers" && raw.enableSse !== void 0 && typeof raw.enableSse !== "boolean") invalid(`${pathAt}.enableSse must be a boolean`);
		} else {
			if (raw.url !== void 0 && typeof raw.url !== "string") invalid(`${pathAt}.url must be a string`);
			if (raw.url === void 0 && raw.enabled !== false) invalid(`${pathAt}.url is required while the adapter is enabled`);
		}
		if (kind === "httpClients" && raw.timeoutMs !== void 0) {
			const timeout = parseRestoreInteger(raw.timeoutMs);
			if (timeout === null || timeout <= 0 || timeout > NODE_TIMER_MAX_MS) invalid(`${pathAt}.timeoutMs must be an integer between 1 and ${NODE_TIMER_MAX_MS}`);
		}
		if (kind === "wsServers" || kind === "wsClients") {
			const role = raw.role;
			if (role !== void 0 && ![
				"api",
				"event",
				"universal"
			].includes(String(role).toLowerCase())) invalid(`${pathAt}.role must be Api, Event, or Universal`);
		}
		if (kind === "wsClients" && raw.reconnectIntervalMs !== void 0) {
			const interval = parseRestoreInteger(raw.reconnectIntervalMs);
			if (interval === null || interval < 1e3 || interval > NODE_TIMER_MAX_MS) invalid(`${pathAt}.reconnectIntervalMs must be an integer between 1000 and ${NODE_TIMER_MAX_MS}`);
		}
	});
	return value.length;
}
function validateRestoreStatusCommand(value) {
	if (value === void 0) return;
	if (!isObject$4(value)) invalid("$.statusCommand must be an object");
	rejectUnknownKeys(value, /* @__PURE__ */ new Set([
		"enabled",
		"swallow",
		"cooldownSeconds",
		"trigger"
	]), "$.statusCommand");
	if (value.enabled !== void 0 && typeof value.enabled !== "boolean") invalid("$.statusCommand.enabled must be a boolean");
	if (value.swallow !== void 0 && typeof value.swallow !== "boolean") invalid("$.statusCommand.swallow must be a boolean");
	if (value.cooldownSeconds !== void 0) {
		const cooldown = parseRestoreInteger(value.cooldownSeconds);
		if (cooldown === null || cooldown < 0 || cooldown > STATUS_COMMAND_COOLDOWN_MAX) invalid(`$.statusCommand.cooldownSeconds must be an integer between 0 and ${STATUS_COMMAND_COOLDOWN_MAX}`);
	}
	if (value.trigger !== void 0) {
		const trigger = typeof value.trigger === "string" ? value.trigger.trim() : "";
		if (typeof value.trigger !== "string" || !trigger || /[\r\n]/.test(value.trigger) || trigger.length > 32) invalid(`$.statusCommand.trigger must be non-empty, single-line, and <= 32 characters`);
	}
}
function validateRestoreNotifications(value) {
	if (value === void 0) return;
	if (!isObject$4(value)) invalid("$.notifications must be an object");
	rejectUnknownKeys(value, /* @__PURE__ */ new Set(["channelIds"]), "$.notifications");
	if (value.channelIds === void 0) return;
	if (!Array.isArray(value.channelIds)) invalid("$.notifications.channelIds must be an array");
	value.channelIds.forEach((id, index) => {
		if (typeof id !== "string") invalid(`$.notifications.channelIds[${String(index)}] must be a string`);
		const normalized = id.trim();
		if (!normalized || normalized.length > 64 || !/^[\w.-]+$/.test(normalized)) invalid(`$.notifications.channelIds[${String(index)}] is invalid`);
	});
}
function validateRestoreHistorySync(value) {
	if (value === void 0) return;
	if (!isObject$4(value)) invalid("$.historySync must be an object");
	rejectUnknownKeys(value, /* @__PURE__ */ new Set(["enabled"]), "$.historySync");
	if (value.enabled !== void 0 && typeof value.enabled !== "boolean") invalid("$.historySync.enabled must be a boolean");
}
function rejectUnknownKeys(value, allowed, at) {
	const unknown = Object.keys(value).find((key) => !allowed.has(key));
	if (unknown) invalid(`${at}.${unknown} is not supported`);
}
function parseRestoreInteger(value) {
	const number = typeof value === "string" && value.trim() ? Number(value) : value;
	return typeof number === "number" && Number.isSafeInteger(number) ? number : null;
}
function isHttpUrlForRestore(value) {
	try {
		const parsed = new URL(value);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host.length > 0;
	} catch {
		return false;
	}
}
/** Validate the normalized, public OneBot configuration shape before it is
*  persisted or compiled into a live network plan. Adapter names form one
*  process-wide namespace per account, not four independent namespaces. */
function assertValidOneBotConfig(value) {
	if (!isObject$4(value)) invalid("configuration must be an object");
	if (!isObject$4(value.networks)) invalid("networks must be an object");
	const seen = /* @__PURE__ */ new Map();
	const serverBindings = /* @__PURE__ */ new Map();
	validateNetworkList(value.networks, "httpServers", seen, (item, at) => {
		validateServer(item, at);
		parseMaxPayloadBytes(item.maxPayloadBytes, at);
		if (item.enableWebSocket !== void 0 && typeof item.enableWebSocket !== "boolean") invalid(`${at}.enableWebSocket must be a boolean`);
		if (item.enableSse !== void 0 && typeof item.enableSse !== "boolean") invalid(`${at}.enableSse must be a boolean`);
		validateServerBinding(item, at, serverBindings);
	});
	validateNetworkList(value.networks, "httpClients", seen, (item, at) => {
		validateClient(item, at, /* @__PURE__ */ new Set(["http:", "https:"]));
		rejectHttpClientMaxPayloadBytes(item, at);
		if (item.timeoutMs !== void 0 && (typeof item.timeoutMs !== "number" || !Number.isSafeInteger(item.timeoutMs) || item.timeoutMs <= 0 || item.timeoutMs > NODE_TIMER_MAX_MS)) invalid(`${at}.timeoutMs must be an integer between 1 and ${NODE_TIMER_MAX_MS}`);
	});
	validateNetworkList(value.networks, "wsServers", seen, (item, at) => {
		validateServer(item, at);
		validateServerBinding(item, at, serverBindings);
		validateRole(item.role, `${at}.role`);
		parseMaxPayloadBytes(item.maxPayloadBytes, at);
	});
	validateNetworkList(value.networks, "wsClients", seen, (item, at) => {
		validateClient(item, at, /* @__PURE__ */ new Set(["ws:", "wss:"]));
		validateRole(item.role, `${at}.role`);
		parseMaxPayloadBytes(item.maxPayloadBytes, at);
		if (item.reconnectIntervalMs !== void 0 && (typeof item.reconnectIntervalMs !== "number" || !Number.isSafeInteger(item.reconnectIntervalMs) || item.reconnectIntervalMs < 1e3 || item.reconnectIntervalMs > NODE_TIMER_MAX_MS)) invalid(`${at}.reconnectIntervalMs must be an integer between 1000 and ${NODE_TIMER_MAX_MS}`);
	});
	if (!isObject$4(value.statusCommand)) invalid("statusCommand must be an object");
	const status = value.statusCommand;
	if (typeof status.enabled !== "boolean") invalid("statusCommand.enabled must be a boolean");
	if (typeof status.swallow !== "boolean") invalid("statusCommand.swallow must be a boolean");
	if (typeof status.cooldownSeconds !== "number" || !Number.isInteger(status.cooldownSeconds) || status.cooldownSeconds < 0) invalid("statusCommand.cooldownSeconds must be a non-negative integer");
	if (typeof status.trigger !== "string" || !status.trigger.trim() || status.trigger.length > 32 || /[\r\n]/.test(status.trigger)) invalid(`statusCommand.trigger must be non-empty, single-line, and <= 32 characters`);
	if (!isObject$4(value.historySync)) invalid("historySync must be an object");
	if (typeof value.historySync.enabled !== "boolean") invalid("historySync.enabled must be a boolean");
	if (value.notifications !== void 0) {
		if (!isObject$4(value.notifications) || !Array.isArray(value.notifications.channelIds)) invalid("notifications.channelIds must be an array");
		for (const [index, channelId] of value.notifications.channelIds.entries()) if (typeof channelId !== "string" || !channelId || channelId.length > 64 || !/^[\w.-]+$/.test(channelId)) invalid(`notifications.channelIds[${index}] is invalid`);
	}
}
function validateNetworkList(networks, kind, seen, validateSpecific) {
	const list = networks[kind];
	if (!Array.isArray(list)) invalid(`networks.${kind} must be an array`);
	for (let index = 0; index < list.length; index += 1) {
		const item = list[index];
		const at = `networks.${kind}[${index}]`;
		if (!isObject$4(item)) invalid(`${at} must be an object`);
		validateNetworkBase(item, at);
		const name = item.name;
		const previousKind = seen.get(name);
		if (previousKind !== void 0) invalid(`network adapter name "${name}" is duplicated in ${previousKind} and ${kind}`);
		seen.set(name, kind);
		validateSpecific(item, at);
	}
}
function validateNetworkBase(item, at) {
	if (typeof item.name !== "string" || !item.name.trim()) invalid(`${at}.name must be a non-empty string`);
	if (item.name !== item.name.trim()) invalid(`${at}.name must not have surrounding whitespace`);
	if (item.enabled !== void 0 && typeof item.enabled !== "boolean") invalid(`${at}.enabled must be a boolean`);
	if (item.accessToken !== void 0 && typeof item.accessToken !== "string") invalid(`${at}.accessToken must be a string`);
	if (item.messageFormat !== "array" && item.messageFormat !== "string") invalid(`${at}.messageFormat must be "array" or "string"`);
	if (typeof item.reportSelfMessage !== "boolean") invalid(`${at}.reportSelfMessage must be a boolean`);
}
/** Apply the same limit validation to files, restores and API writes. */
function parseMaxPayloadBytes(value, at) {
	if (value === void 0) return;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < MAX_PAYLOAD_BYTES_MIN || value > MAX_PAYLOAD_BYTES_MAX) invalid(`${at}.maxPayloadBytes must be an integer between ${MAX_PAYLOAD_BYTES_MIN} and ${MAX_PAYLOAD_BYTES_MAX}`);
	return value;
}
function rejectHttpClientMaxPayloadBytes(item, at) {
	if (item.maxPayloadBytes !== void 0) invalid(`${at}.maxPayloadBytes is only supported by WebSocket adapters`);
}
function validateServer(item, at) {
	if (!Number.isInteger(item.port) || item.port <= 0 || item.port > 65535) invalid(`${at}.port must be an integer between 1 and 65535`);
	if (item.host !== void 0) {
		if (typeof item.host !== "string") invalid(`${at}.host must be a string`);
		if (!item.host.trim()) invalid(`${at}.host must be a non-empty string when provided`);
		if (item.host !== item.host.trim()) invalid(`${at}.host must not have surrounding whitespace`);
		if (!isValidBindHost$1(item.host)) invalid(`${at}.host must be a valid TCP bind host`);
	}
	if (item.path !== void 0) {
		if (typeof item.path !== "string") invalid(`${at}.path must be a string`);
		if (item.path !== item.path.trim()) invalid(`${at}.path must not have surrounding whitespace`);
		const pathValue = item.path || "/";
		if (!pathValue.startsWith("/")) invalid(`${at}.path must be empty or start with /`);
		if (pathValue.includes("?") || pathValue.includes("#")) invalid(`${at}.path must not include query or hash`);
		if (new URL(`http://127.0.0.1${pathValue}`).pathname !== pathValue) invalid(`${at}.path must already be a normalized URL pathname`);
	}
}
function validateServerBinding(item, at, bindings) {
	if (item.enabled === false) return;
	const host = typeof item.host === "string" && item.host.trim() ? item.host.trim().toLowerCase() : "0.0.0.0";
	const port = item.port;
	const binding = `${host}:${String(port)}`;
	const exact = bindings.get(binding);
	if (exact) invalid(`${at} conflicts with ${exact} on server binding ${binding}`);
	const wildcardKey = `*:${String(port)}`;
	const previousWildcard = bindings.get(wildcardKey);
	if (previousWildcard) invalid(`${at} conflicts with ${previousWildcard} on wildcard server port ${String(port)}`);
	if (host === "0.0.0.0" || host === "::" || host === "[::]") {
		const previousSamePort = [...bindings.entries()].find(([key]) => key.endsWith(`:${String(port)}`));
		if (previousSamePort) invalid(`${at} conflicts with ${previousSamePort[1]} on wildcard server port ${String(port)}`);
		bindings.set(wildcardKey, at);
	}
	bindings.set(binding, at);
}
function validateClient(item, at, protocols) {
	if (typeof item.url !== "string") invalid(`${at}.url must be a string`);
	if (item.enabled === false) return;
	if (!item.url.trim()) invalid(`${at}.url must be non-empty while the adapter is enabled`);
	let parsed;
	try {
		parsed = new URL(item.url);
	} catch {
		invalid(`${at}.url must be a valid absolute URL`);
	}
	if (!protocols.has(parsed.protocol)) invalid(`${at}.url protocol must be one of ${[...protocols].join(", ")}`);
}
function validateRole(value, at) {
	if (value !== void 0 && value !== "Api" && value !== "Event" && value !== "Universal") invalid(`${at} must be Api, Event, or Universal`);
}
function invalid(message) {
	throw new OneBotConfigValidationError(message);
}
function ensureConfigDir$4() {
	fs$1.mkdirSync(CONFIG_DIR$5, { recursive: true });
}
var PER_UIN_CONFIG = /^onebot_(\d+)\.json$/;
/**
* Remove per-UIN config files whose UIN is not a real QQ account — leftovers
* from the phantom-account bug where the native hook reported a garbage
* (timestamp-shaped) UIN and a `onebot_<garbage>.json` got persisted (issue
* #162). Only files matching `onebot_<digits>.json` are considered, and only
* those failing isRealUin (i.e. 11+ digits) are deleted — legitimate accounts
* are never touched. Returns the deleted file names. Safe to call at startup.
*/
function cleanupInvalidPerUinConfigs() {
	let entries;
	try {
		entries = fs$1.readdirSync(CONFIG_DIR$5);
	} catch {
		return [];
	}
	const removed = [];
	for (const name of entries) {
		const match = PER_UIN_CONFIG.exec(name);
		if (!match || isRealUin(match[1])) continue;
		try {
			fs$1.unlinkSync(path$1.join(CONFIG_DIR$5, name));
			removed.push(name);
			log$67.warn("removed phantom per-UIN config (invalid UIN): %s", name);
		} catch (err) {
			log$67.warn("failed to remove phantom config %s: %s", name, err instanceof Error ? err.message : String(err));
		}
	}
	return removed;
}
function toJsonObject(config, mode) {
	const nets = config.networks;
	return {
		mode,
		networks: {
			httpServers: nets.httpServers.map(httpServerToJson),
			httpClients: nets.httpClients.map(httpClientToJson),
			wsServers: nets.wsServers.map(wsServerToJson),
			wsClients: nets.wsClients.map(wsClientToJson)
		},
		statusCommand: {
			enabled: config.statusCommand.enabled,
			swallow: config.statusCommand.swallow,
			cooldownSeconds: config.statusCommand.cooldownSeconds,
			trigger: config.statusCommand.trigger
		},
		historySync: { enabled: config.historySync.enabled },
		notifications: { channelIds: config.notifications?.channelIds ?? [] }
	};
}
function applyBase(out, n) {
	out.name = n.name;
	if (n.enabled === false) out.enabled = false;
	if (n.accessToken) out.accessToken = n.accessToken;
	out.messageFormat = n.messageFormat;
	out.reportSelfMessage = n.reportSelfMessage;
	if (n.maxPayloadBytes !== void 0) out.maxPayloadBytes = n.maxPayloadBytes;
}
function httpServerToJson(n) {
	const out = {};
	applyBase(out, n);
	out.host = n.host ?? "0.0.0.0";
	out.port = n.port;
	out.path = n.path ?? "/";
	out.enableWebSocket = n.enableWebSocket === true;
	out.enableSse = n.enableSse === true;
	return out;
}
function httpClientToJson(n) {
	const out = {};
	applyBase(out, n);
	out.url = n.url;
	if (typeof n.timeoutMs === "number" && n.timeoutMs > 0) out.timeoutMs = n.timeoutMs;
	return out;
}
function wsServerToJson(n) {
	const out = {};
	applyBase(out, n);
	out.host = n.host ?? "0.0.0.0";
	out.port = n.port;
	out.path = n.path ?? "/";
	out.role = n.role ?? "Universal"; if (n.protocol === "satori") out.protocol = "satori";
	return out;
}
function wsClientToJson(n) {
	const out = {};
	applyBase(out, n);
	out.url = n.url;
	out.role = n.role ?? "Universal";
	out.reconnectIntervalMs = typeof n.reconnectIntervalMs === "number" && Number.isFinite(n.reconnectIntervalMs) ? Math.max(1e3, Math.trunc(n.reconnectIntervalMs)) : 5e3;
	return out;
}
function fromJson(sources, freshInstall) {
	let legacyFormat;
	let legacyReport;
	for (const src of sources) {
		const mf = parseMessageFormat(src.messageFormat);
		if (mf) legacyFormat = mf;
		if (typeof src.reportSelfMessage === "boolean") legacyReport = src.reportSelfMessage;
	}
	const adapterDefaults = {
		messageFormat: legacyFormat ?? "array",
		reportSelfMessage: legacyReport ?? false
	};
	const httpServers = collectByName(sources, "httpServers", (raw) => parseHttpServer(raw, adapterDefaults));
	const httpClients = collectByName(sources, "httpClients", (raw) => parseHttpClient(raw, adapterDefaults), "httpPostEndpoints");
	const wsServers = collectByName(sources, "wsServers", (raw) => parseWsServer(raw, adapterDefaults));
	const wsClients = collectByName(sources, "wsClients", (raw) => parseWsClient(raw, adapterDefaults));
	if (freshInstall && httpServers.length === 0 && httpClients.length === 0 && wsServers.length === 0 && wsClients.length === 0) {
		const defaults = makeDefaultOneBotConfig().networks;
		httpServers.push(...defaults.httpServers);
		wsServers.push(...defaults.wsServers);
	}
	const config = {
		networks: {
			httpServers,
			httpClients,
			wsServers,
			wsClients
		},
		statusCommand: parseStatusCommand(sources),
		historySync: parseHistorySync(sources),
		notifications: parseNotifications(sources)
	};
	assertValidOneBotConfig(config);
	return config;
}
function parseHistorySync(sources) {
	let enabled = false;
	for (const source of sources) {
		if (!Object.prototype.hasOwnProperty.call(source, "historySync")) continue;
		const raw = source.historySync;
		if (!isObject$4(raw)) invalid("historySync must be an object");
		rejectUnknownKeys(raw, /* @__PURE__ */ new Set(["enabled"]), "historySync");
		if (typeof raw.enabled !== "boolean") invalid("historySync.enabled must be a boolean");
		enabled = raw.enabled;
	}
	return { enabled };
}
/** Last-write-wins merge of `notifications.channelIds` across config sources,
*  each id validated as a slug + deduped. Mirrors the channel-id rule in
*  packages/core/src/notifications/config.ts (CHANNEL_ID_RE) — duplicated
*  deliberately: core depends on onebot, so onebot cannot import from core. */
function parseNotifications(sources) {
	let channelIds = [];
	for (const src of sources) {
		const raw = src.notifications;
		if (!isObject$4(raw)) continue;
		if (Array.isArray(raw.channelIds)) channelIds = normalizeChannelIds(raw.channelIds);
	}
	return { channelIds };
}
function normalizeChannelIds(value) {
	if (!Array.isArray(value)) return [];
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const item of value) {
		if (typeof item !== "string") continue;
		const v = item.trim();
		if (!v || v.length > 64 || !/^[\w.-]+$/.test(v)) continue;
		if (seen.has(v)) continue;
		seen.add(v);
		out.push(v);
	}
	return out;
}
/** Last-write-wins merge of `statusCommand` across config sources, with
*  defaults filled and the cooldown clamped to a sane non-negative range. */
function parseStatusCommand(sources) {
	const out = makeDefaultStatusCommand();
	for (const src of sources) {
		const raw = src.statusCommand;
		if (!isObject$4(raw)) continue;
		if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
		if (typeof raw.swallow === "boolean") out.swallow = raw.swallow;
		if (raw.cooldownSeconds !== void 0) out.cooldownSeconds = Math.min(STATUS_COMMAND_COOLDOWN_MAX, asNumber(raw.cooldownSeconds, DEFAULT_STATUS_COMMAND.cooldownSeconds));
		if (typeof raw.trigger === "string" && raw.trigger.trim().length > 0 && !/[\r\n]/.test(raw.trigger)) out.trigger = raw.trigger.trim().slice(0, 32);
	}
	return out;
}
function collectByName(sources, kind, parse, legacyKey) {
	const byName = /* @__PURE__ */ new Map();
	const order = [];
	let counter = 0;
	const ingest = (rawArr) => {
		if (!Array.isArray(rawArr)) return;
		for (const raw of rawArr) {
			if (!isObject$4(raw)) continue;
			const parsed = parse(raw);
			if (!parsed) continue;
			const name = parsed.name && parsed.name.trim() ? parsed.name.trim() : pickAutoName(kind, byName, ++counter);
			parsed.name = name;
			if (!byName.has(name)) order.push(name);
			byName.set(name, parsed);
		}
	};
	for (const src of sources) {
		ingest(isObject$4(src.networks) ? src.networks[kind] : void 0);
		if (legacyKey) ingest(src[legacyKey]);
		ingest(src[kind]);
	}
	return order.map((n) => byName.get(n));
}
function pickAutoName(kind, used, counter) {
	const prefix = kind === "httpServers" ? "http" : kind === "httpClients" ? "httppost" : kind === "wsServers" ? "ws" : "wsclient";
	let candidate = `${prefix}-${counter}`;
	while (used.has(candidate)) {
		counter += 1;
		candidate = `${prefix}-${counter}`;
	}
	return candidate;
}
function parseBase(value, defaults) {
	return {
		name: asString$1(value.name),
		enabled: typeof value.enabled === "boolean" ? value.enabled : void 0,
		accessToken: asString$1(value.accessToken) || void 0,
		protocol: value.protocol === "satori" ? "satori" : void 0, messageFormat: parseMessageFormat(value.messageFormat) ?? defaults.messageFormat,
		reportSelfMessage: typeof value.reportSelfMessage === "boolean" ? value.reportSelfMessage : defaults.reportSelfMessage
	};
}
function parseHttpServer(value, defaults) {
	const maxPayloadBytes = parseMaxPayloadBytes(value.maxPayloadBytes, "http server");
	if (value.enableWebSocket !== void 0 && typeof value.enableWebSocket !== "boolean") invalid("http server enableWebSocket must be a boolean");
	if (value.enableSse !== void 0 && typeof value.enableSse !== "boolean") invalid("http server enableSse must be a boolean");
	const port = asNumber(value.port, 0);
	if (port <= 0) return null;
	return clean({
		...parseBase(value, defaults),
		host: asString$1(value.host, "0.0.0.0"),
		port,
		path: asString$1(value.path, "/"),
		enableWebSocket: value.enableWebSocket === true,
		enableSse: value.enableSse === true,
		maxPayloadBytes
	});
}
function parseHttpClient(value, defaults) {
	rejectHttpClientMaxPayloadBytes(value, "http client");
	const url = asString$1(value.url);
	const base = parseBase(value, defaults);
	if (!url && base.enabled !== false) return null;
	const timeout = asNumber(value.timeoutMs, 0);
	return clean({
		...base,
		url,
		timeoutMs: timeout > 0 ? timeout : void 0
	});
}
function parseWsServer(value, defaults) {
	const maxPayloadBytes = parseMaxPayloadBytes(value.maxPayloadBytes, "websocket server");
	const port = asNumber(value.port, 0);
	if (port <= 0) return null;
	return clean({
		...parseBase(value, defaults),
		host: asString$1(value.host, "0.0.0.0"),
		port,
		path: asString$1(value.path, value.protocol === "satori" ? "/v1/events" : "/"),
		role: asRole(value.role, "Universal"),
		maxPayloadBytes
	});
}
function parseWsClient(value, defaults) {
	const maxPayloadBytes = parseMaxPayloadBytes(value.maxPayloadBytes, "websocket client");
	const url = asString$1(value.url);
	const base = parseBase(value, defaults);
	if (!url && base.enabled !== false) return null;
	const reconnectIntervalMs = asNumber(value.reconnectIntervalMs, 5e3);
	return clean({
		...base,
		url,
		role: asRole(value.role, "Universal"),
		reconnectIntervalMs: Math.max(1e3, reconnectIntervalMs),
		maxPayloadBytes
	});
}
function hasLegacyTopLevel(raw) {
	return Array.isArray(raw.httpServers) || Array.isArray(raw.httpPostEndpoints) || Array.isArray(raw.wsServers) || Array.isArray(raw.wsClients) || typeof raw.messageFormat === "string" || typeof raw.reportSelfMessage === "boolean";
}
function parseMessageFormat(value) {
	if (value === "array" || value === "string") return value;
}
function clean(obj) {
	for (const key of Object.keys(obj)) if (obj[key] === void 0) delete obj[key];
	return obj;
}
function asRole(value, fallback) {
	const text = asString$1(value, fallback).toLowerCase();
	if (text === "api") return "Api";
	if (text === "event") return "Event";
	if (text === "universal") return "Universal";
	return fallback;
}
function asString$1(value, fallback = "") {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return fallback;
}
function asNumber(value, fallback = 0) {
	if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
	if (typeof value === "string" && value.trim()) {
		const n = Number(value);
		if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
	}
	return fallback;
}
function tryLoadJson(filePath, failOnCorrupt = false) {
	if (!fs$1.existsSync(filePath)) return null;
	try {
		const raw = fs$1.readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw);
		if (!isObject$4(parsed)) throw new Error("configuration root must be an object");
		return parsed;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (failOnCorrupt) throw new Error(`config file ${filePath} is corrupt: ${message}`, { cause: err });
		log$67.warn("config file %s is corrupt and will be ignored: %s", filePath, message);
		return null;
	}
}
function saveJson(filePath, json) {
	const dir = path$1.dirname(filePath);
	fs$1.mkdirSync(dir, { recursive: true });
	const tempPath = path$1.join(dir, `.${path$1.basename(filePath)}.${String(process.pid)}.${randomBytes$1(6).toString("hex")}.tmp`);
	let fd = null;
	try {
		fd = fs$1.openSync(tempPath, "wx", 384);
		fs$1.writeFileSync(fd, JSON.stringify(json, null, 2), "utf8");
		fs$1.fsyncSync(fd);
		fs$1.closeSync(fd);
		fd = null;
		fs$1.renameSync(tempPath, filePath);
	} catch (error) {
		if (fd !== null) try {
			fs$1.closeSync(fd);
		} catch {}
		try {
			fs$1.unlinkSync(tempPath);
		} catch {}
		throw error;
	}
}
function isObject$4(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isValidBindHost$1(value) {
	if (!value || value.length > 253 || /[\s/?#@]/u.test(value)) return false;
	if (value.includes(":")) return isIP(value) === 6;
	if (/^[\d.]+$/.test(value)) return isIP(value) === 4;
	return (value.endsWith(".") ? value.slice(0, -1) : value).split(".").every((label) => /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/.test(label));
}
export {};
