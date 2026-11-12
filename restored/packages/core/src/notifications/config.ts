init_coerce();
init_logger();
var log$16 = createLogger("Notifications.Config");
var CONFIG_DIR$3 = "config";
var NOTIFICATIONS_CONFIG_PATH = path$1.join(CONFIG_DIR$3, "notifications.json");
var DEBOUNCE_SECONDS_MAX = 3600;
/** A channel id is a slug: it is referenced by per-UIN `channelIds`, so it must
*  be safe to use as a stable key. Kept in sync with `normalizeChannelIds` in
*  packages/onebot/src/config.ts (cross-package; can't share without a circular
*  dep — core depends on onebot, not the reverse). */
var CHANNEL_ID_RE = /^[\w.-]+$/;
var CHANNEL_ID_MAX = 64;
var CHANNEL_NAME_MAX = 128;
var BODY_TEMPLATE_MAX = 8192;
var HEADER_NAME_MAX = 128;
var HEADER_VALUE_MAX = 1024;
var HEADERS_MAX = 16;
var HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
function isEmailChannel(ch) {
	return ch.type === "email";
}
var SMTP_HOST_MAX = 253;
var SMTP_USER_MAX = 256;
var SMTP_PASS_MAX = 256;
var EMAIL_FIELD_MAX = 1024;
var SUBJECT_TEMPLATE_MAX = 256;
var SMTP_PORT_MIN = 1;
var SMTP_PORT_MAX = 65535;
function defaultNotificationsConfig() {
	return {
		version: 1,
		debounceSeconds: 30,
		channels: []
	};
}
/** Preserve unknown placeholders; escape substituted strings in JSON templates. */
function renderTemplate(template, vars) {
	if (typeof template !== "string") return "";
	let isJson = false;
	try {
		JSON.parse(template);
		isJson = true;
	} catch {}
	return template.replace(/\{(\w+)\}/g, (match, key) => {
		if (!Object.prototype.hasOwnProperty.call(vars, key)) return match;
		const val = vars[key];
		return isJson ? JSON.stringify(val).slice(1, -1) : val;
	});
}
function strOr(value, fallback, maxLen) {
	return typeof value === "string" ? value.slice(0, maxLen) : fallback;
}
function normalizeChannelId(value) {
	if (typeof value !== "string") return null;
	const v = value.trim();
	if (v.length === 0 || v.length > CHANNEL_ID_MAX) return null;
	if (!CHANNEL_ID_RE.test(v)) return null;
	return v;
}
function isHttpUrl(value) {
	try {
		const u = new URL(value);
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}
function normalizeHeaders(value) {
	if (!isObject$5(value)) return;
	const out = {};
	const seen = /* @__PURE__ */ new Set();
	for (const [rawName, rawValue] of Object.entries(value)) {
		if (Object.keys(out).length >= HEADERS_MAX) break;
		if (typeof rawValue !== "string") continue;
		const name = rawName.trim();
		if (name.length === 0 || name.length > HEADER_NAME_MAX) continue;
		if (!HEADER_NAME_RE.test(name)) continue;
		const folded = name.toLowerCase();
		if (seen.has(folded)) continue;
		const headerValue = rawValue.trim();
		if (headerValue.length === 0 || headerValue.length > HEADER_VALUE_MAX) continue;
		if (headerValue.includes("\r") || headerValue.includes("\n")) continue;
		seen.add(folded);
		out[name] = headerValue;
	}
	return Object.keys(out).length > 0 ? out : void 0;
}
function normalizeSmtpHost(value) {
	if (typeof value !== "string") return null;
	const v = value.trim();
	if (!v || v.length > SMTP_HOST_MAX) return null;
	if (/\s/.test(v) || v.includes("/") || v.includes("://")) return null;
	return v;
}
function normalizeFrom(value) {
	if (typeof value !== "string") return null;
	const v = value.trim().slice(0, EMAIL_FIELD_MAX);
	return extractAddress(v) ? v : null;
}
function normalizeTo(value) {
	if (typeof value !== "string") return null;
	const addrs = parseRecipients(value.trim().slice(0, EMAIL_FIELD_MAX));
	return addrs.length > 0 ? addrs.join(", ") : null;
}
function normalizeChannelType(value) {
	if (value === "email") return "email";
	if (value === "webhook" || value === void 0 || value === "") return "webhook";
	return null;
}
function normalizeEmailChannel(raw, id, name) {
	const smtpHost = normalizeSmtpHost(raw.smtpHost);
	const from = normalizeFrom(raw.from);
	const to = normalizeTo(raw.to);
	if (!smtpHost || !from || !to) return null;
	const portRaw = raw.smtpPort;
	const portProvided = portRaw !== void 0 && portRaw !== null && portRaw !== "";
	const secureProvided = typeof raw.smtpSecure === "boolean";
	const port = portProvided ? clampInt(portRaw, SMTP_PORT_MIN, SMTP_PORT_MAX, 0) : 0;
	if (portProvided && port === 0) return null;
	const smtpSecure = secureProvided ? Boolean(raw.smtpSecure) : port === 465 || port === 0;
	const smtpPort = port === 0 ? smtpSecure ? 465 : 587 : port;
	const smtpUser = typeof raw.smtpUser === "string" ? raw.smtpUser.trim().slice(0, SMTP_USER_MAX) : "";
	const smtpPass = typeof raw.smtpPass === "string" ? raw.smtpPass.slice(0, SMTP_PASS_MAX) : "";
	return {
		id,
		name,
		type: "email",
		url: "",
		bodyTemplate: strOr(raw.bodyTemplate, DEFAULT_EMAIL_BODY, BODY_TEMPLATE_MAX),
		enabled: boolOr(raw.enabled, true),
		smtpHost,
		smtpPort,
		smtpSecure,
		...smtpUser ? { smtpUser } : {},
		...smtpPass ? { smtpPass } : {},
		from,
		to,
		subjectTemplate: strOr(raw.subjectTemplate, "账号{event}：{nickname} ({uin})", SUBJECT_TEMPLATE_MAX) || "账号{event}：{nickname} ({uin})"
	};
}
/** A channel is usable only with a valid id AND a deliverable target —
*  http(s) URL for webhooks, SMTP host + from/to for email. Anything else
*  is dropped (total normalize). */
function normalizeChannel(raw) {
	if (!isObject$5(raw)) return null;
	const id = normalizeChannelId(raw.id);
	if (!id) return null;
	const type = normalizeChannelType(raw.type);
	if (!type) return null;
	const name = strOr(raw.name, id, CHANNEL_NAME_MAX).trim() || id;
	if (type === "email") return normalizeEmailChannel(raw, id, name);
	const url = typeof raw.url === "string" ? raw.url.trim() : "";
	if (!isHttpUrl(url)) return null;
	const headers = normalizeHeaders(raw.headers);
	return {
		id,
		name,
		type: "webhook",
		url,
		bodyTemplate: strOr(raw.bodyTemplate, DEFAULT_WEBHOOK_BODY, BODY_TEMPLATE_MAX),
		enabled: boolOr(raw.enabled, true),
		...headers ? { headers } : {}
	};
}
function normalizeChannels(value) {
	if (!Array.isArray(value)) return [];
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const raw of value) {
		const ch = normalizeChannel(raw);
		if (!ch) continue;
		if (seen.has(ch.id)) continue;
		seen.add(ch.id);
		out.push(ch);
	}
	return out;
}
function normalizeNotificationsConfig(value) {
	const v = isObject$5(value) ? value : {};
	return {
		version: 1,
		debounceSeconds: clampInt(v.debounceSeconds, 0, DEBOUNCE_SECONDS_MAX, 30),
		channels: normalizeChannels(v.channels)
	};
}
function ensureConfigDir$3() {
	fs$1.mkdirSync(CONFIG_DIR$3, { recursive: true });
}
function enforceSensitiveFileMode(file) {
	if (process.platform !== "win32") fs$1.chmodSync(file, 384);
}
function atomicWrite$3(config) {
	ensureConfigDir$3();
	const tmp = NOTIFICATIONS_CONFIG_PATH + ".tmp";
	fs$1.writeFileSync(tmp, JSON.stringify(config, null, 2), {
		encoding: "utf8",
		mode: 384
	});
	enforceSensitiveFileMode(tmp);
	fs$1.renameSync(tmp, NOTIFICATIONS_CONFIG_PATH);
	enforceSensitiveFileMode(NOTIFICATIONS_CONFIG_PATH);
}
var cached$1 = null;
/** Load + normalize the channel store, creating it from defaults if absent. */
function loadNotificationsConfig() {
	if (cached$1) return cached$1;
	ensureConfigDir$3();
	if (!fs$1.existsSync(NOTIFICATIONS_CONFIG_PATH)) {
		const fresh = defaultNotificationsConfig();
		try {
			atomicWrite$3(fresh);
		} catch (err) {
			log$16.warn("failed to write initial notifications.json: %s", err instanceof Error ? err.message : String(err));
		}
		cached$1 = fresh;
		return fresh;
	}
	enforceSensitiveFileMode(NOTIFICATIONS_CONFIG_PATH);
	try {
		const raw = fs$1.readFileSync(NOTIFICATIONS_CONFIG_PATH, "utf8");
		const parsed = JSON.parse(raw);
		const normalized = normalizeNotificationsConfig(parsed);
		if (JSON.stringify(parsed) !== JSON.stringify(normalized)) try {
			atomicWrite$3(normalized);
		} catch (err) {
			log$16.warn("failed to normalize notifications.json on disk: %s", err instanceof Error ? err.message : String(err));
		}
		cached$1 = normalized;
		return normalized;
	} catch (err) {
		log$16.warn("notifications.json unreadable; using defaults: %s", err instanceof Error ? err.message : String(err));
		const fresh = defaultNotificationsConfig();
		cached$1 = fresh;
		return fresh;
	}
}
/**
* Persist a (possibly partial) client-supplied config. A missing `channels` or
* `debounceSeconds` keeps the current on-disk value — section-level merge, same
* as `saveUiConfig`. Returns the stored, normalized config.
*/
function saveNotificationsConfig(incoming) {
	const current = loadNotificationsConfig();
	const v = isObject$5(incoming) ? incoming : {};
	const next = {
		version: 1,
		debounceSeconds: v.debounceSeconds !== void 0 ? clampInt(v.debounceSeconds, 0, DEBOUNCE_SECONDS_MAX, 30) : current.debounceSeconds,
		channels: Array.isArray(v.channels) ? normalizeChannels(v.channels) : current.channels
	};
	atomicWrite$3(next);
	cached$1 = next;
	return next;
}
