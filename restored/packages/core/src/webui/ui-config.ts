init_coerce();
init_logger();
var log$11 = createLogger("WebUI.UiConfig");
var CONFIG_DIR = "config";
var UI_CONFIG_PATH = path$1.join(CONFIG_DIR, "ui.json");
/** Directory for operator-uploaded UI assets (currently just the background). */
var UI_ASSETS_DIR = path$1.join(CONFIG_DIR, "ui-assets");
/** Fixed path of the single background image (overwrite-on-upload). */
var BACKGROUND_IMAGE_PATH = path$1.join(UI_ASSETS_DIR, "background");
/** Reject uploads larger than this (bytes). */
var MAX_BACKGROUND_BYTES = 5 * 1024 * 1024;
var DEFAULT_BACKGROUND = {
	type: "none",
	color: "#b99ae6",
	gradient: "none",
	imageOpacity: .15,
	imageBlur: 0,
	hasImage: false,
	imageMime: "",
	imageVersion: 0
};
var DEFAULT_APPEARANCE = {
	mode: "system",
	accentMode: "preset",
	accentPreset: "lavender",
	accentCustom: "#8561bd",
	accentScope: "global",
	darkIntensity: "soft",
	palette: "default",
	sidebarStyle: "follow",
	background: DEFAULT_BACKGROUND,
	fontSans: "default",
	fontSansCustom: "",
	fontMono: "default",
	fontMonoCustom: "",
	uiScale: 1,
	radius: .75,
	density: "cozy",
	reduceMotion: false,
	disableMotion: false,
	customPointerSystem: false,
	customContextMenu: true,
	highContrast: false,
	sidebarPinned: false,
	timeFormat: "24h",
	pollInterval: 3e3,
	customCss: "",
	cssVars: {}
};
var DEFAULT_OVERVIEW_BLOCKS = [
	{
		id: "stats",
		visible: true
	},
	{
		id: "connections",
		visible: true
	},
	{
		id: "alerts",
		visible: true
	},
	{
		id: "host",
		visible: true
	},
	{
		id: "sessions",
		visible: true
	}
];
var DEFAULT_OVERVIEW_MOBILE = [
	{
		id: "stat:status",
		visible: true
	},
	{
		id: "stat:accounts",
		visible: true
	},
	{
		id: "stat:processes",
		visible: true
	},
	{
		id: "stat:host",
		visible: true
	},
	{
		id: "stat:uptime",
		visible: true
	},
	{
		id: "connections",
		visible: true
	},
	{
		id: "alerts",
		visible: true
	},
	{
		id: "host",
		visible: true
	},
	{
		id: "sessions",
		visible: true
	}
];
var DEFAULT_NAV_ITEMS = [
	{
		id: "/",
		visible: true
	},
	{
		id: "/processes",
		visible: true
	},
	{
		id: "/config",
		visible: true
	},
	{
		id: "/logs",
		visible: true
	},
	{
		id: "/settings",
		visible: true
	}
];
var DEFAULT_TOPBAR_ITEMS = [
	{
		id: "status",
		visible: true
	},
	{
		id: "theme",
		visible: true
	},
	{
		id: "kiosk",
		visible: true
	}
];
var LOG_LEVELS = [
	"trace",
	"debug",
	"info",
	"success",
	"warn",
	"error"
];
var DEFAULT_PAGES = {
	defaultRoute: "/",
	logs: {
		visibleLevels: [...LOG_LEVELS],
		maxLines: 1e3,
		autoScroll: true,
		wrap: true,
		highlightRules: [],
		preset: "custom"
	},
	processesSort: "pid",
	configTab: ""
};
function defaultUiConfig() {
	return {
		version: 1,
		appearance: {
			...DEFAULT_APPEARANCE,
			background: { ...DEFAULT_BACKGROUND },
			cssVars: {}
		},
		layout: {
			overviewBlocks: DEFAULT_OVERVIEW_BLOCKS.map((b) => ({ ...b })),
			overviewMobile: DEFAULT_OVERVIEW_MOBILE.map((b) => ({ ...b })),
			navItems: DEFAULT_NAV_ITEMS.map((b) => ({ ...b })),
			topbarItems: DEFAULT_TOPBAR_ITEMS.map((b) => ({ ...b }))
		},
		pages: defaultPages()
	};
}
function defaultPages() {
	return {
		...DEFAULT_PAGES,
		logs: {
			...DEFAULT_PAGES.logs,
			visibleLevels: [...LOG_LEVELS],
			highlightRules: []
		}
	};
}
function oneOf(value, allowed, fallback) {
	return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
function isFiniteNum(value) {
	if (typeof value === "number") return Number.isFinite(value);
	return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
}
var HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
function hexOr(value, fallback) {
	return typeof value === "string" && HEX_RE.test(value.trim()) ? value.trim() : fallback;
}
/** Bounded free-form id (frontend owns the actual catalogue). */
function idOr(value, fallback, maxLen = 64) {
	if (typeof value !== "string") return fallback;
	const v = value.trim();
	if (v.length === 0 || v.length > maxLen) return fallback;
	if (!/^[\w./:-]+$/.test(v)) return fallback;
	return v;
}
/**
* A free-form font-family value (a single family or a comma-separated stack),
* safe to interpolate into `--font-sans: <value>;`. Allows letters (incl. CJK),
* digits, spaces and the punctuation real font names use, but refuses anything
* that could break out of the declaration (`;`, `{`, `}`, control chars, etc.).
* Empty / over-long / invalid → fallback ('' = "no custom family set").
*/
var FONT_FAMILY_RE = /^[\p{L}\p{N}\s,'"._-]+$/u;
function fontFamilyOr(value, fallback, maxLen = 200) {
	if (typeof value !== "string") return fallback;
	const v = value.trim();
	if (v.length === 0) return "";
	if (v.length > maxLen || !FONT_FAMILY_RE.test(v)) return fallback;
	return v;
}
/** The `--token` names the variable panel is allowed to override. Kept in sync
*  with the surface/accent tokens `ThemeContext` actually injects. */
var CSS_VAR_WHITELIST = /* @__PURE__ */ new Set([
	"--background",
	"--foreground",
	"--card",
	"--card-foreground",
	"--popover",
	"--popover-foreground",
	"--primary",
	"--primary-foreground",
	"--secondary",
	"--secondary-foreground",
	"--muted",
	"--muted-foreground",
	"--accent",
	"--accent-foreground",
	"--destructive",
	"--destructive-foreground",
	"--success",
	"--warning",
	"--border",
	"--input",
	"--ring",
	"--sidebar",
	"--sidebar-foreground",
	"--sidebar-primary",
	"--sidebar-primary-foreground",
	"--sidebar-accent",
	"--sidebar-accent-foreground",
	"--sidebar-border",
	"--sidebar-ring"
]);
var CSS_HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
var CSS_NAMED_RE = /^[a-zA-Z]{1,24}$/;
var CSS_FUNC_RE = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\([a-zA-Z0-9.,%/\s#-]{1,120}\)$/;
function cssColorOrNull(value) {
	if (typeof value !== "string") return null;
	const v = value.trim();
	if (v.length === 0 || v.length > 128) return null;
	if (CSS_HEX_RE.test(v) || CSS_NAMED_RE.test(v) || CSS_FUNC_RE.test(v)) return v;
	return null;
}
/** Keep only whitelisted token keys with valid colour values; drop the rest. */
function normalizeCssVars(value) {
	if (!isObject$5(value)) return {};
	const out = {};
	for (const key of Object.keys(value)) {
		if (!CSS_VAR_WHITELIST.has(key)) continue;
		const color = cssColorOrNull(value[key]);
		if (color) out[key] = color;
	}
	return out;
}
function normalizeLayoutItems(value, fallback) {
	if (!Array.isArray(value)) return fallback.map((i) => ({ ...i }));
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const raw of value) {
		if (!isObject$5(raw)) continue;
		const id = idOr(raw.id, "");
		if (!id || seen.has(id)) continue;
		seen.add(id);
		const item = {
			id,
			visible: boolOr(raw.visible, true)
		};
		if (isFiniteNum(raw.x) || isFiniteNum(raw.y) || isFiniteNum(raw.w) || isFiniteNum(raw.h)) {
			item.x = clampInt(raw.x, 0, 50, 0);
			item.y = clampInt(raw.y, 0, 1e3, 0);
			item.w = clampInt(raw.w, 1, 12, 1);
			item.h = clampInt(raw.h, 1, 100, 1);
		}
		if (isObject$5(raw.config)) try {
			if (JSON.stringify(raw.config).length <= 4096) item.config = raw.config;
		} catch {}
		out.push(item);
	}
	return out.length > 0 ? out : fallback.map((i) => ({ ...i }));
}
var DEFAULT_IMAGE_STATE = {
	hasImage: false,
	imageMime: "",
	imageVersion: 0
};
var KNOWN_IMAGE_MIMES = [
	"image/png",
	"image/jpeg",
	"image/webp"
];
/** Coerce a raw background-ish object into a coherent, trusted image state. */
function sanitizeImageState(value) {
	const v = isObject$5(value) ? value : {};
	const version = Math.trunc(clampNum(v.imageVersion, 0, Number.MAX_SAFE_INTEGER, 0));
	if (!boolOr(v.hasImage, false)) return {
		hasImage: false,
		imageMime: "",
		imageVersion: version
	};
	const mime = typeof v.imageMime === "string" && KNOWN_IMAGE_MIMES.includes(v.imageMime) ? v.imageMime : "";
	if (!mime) return {
		hasImage: false,
		imageMime: "",
		imageVersion: version
	};
	return {
		hasImage: true,
		imageMime: mime,
		imageVersion: version
	};
}
/** Trusted image state read FROM a parsed-from-disk config blob. */
function imageStateFromParsed(parsed) {
	if (!isObject$5(parsed) || !isObject$5(parsed.appearance)) return DEFAULT_IMAGE_STATE;
	return sanitizeImageState(parsed.appearance.background);
}
/** Normalize a complete ui.json read from disk or a backup bundle. */
function normalizeStoredUiConfig(value) {
	return normalizeUiConfig(value, imageStateFromParsed(value));
}
function normalizeBackground(value, imageState) {
	const v = isObject$5(value) ? value : {};
	let type = oneOf(v.type, [
		"none",
		"solid",
		"gradient",
		"image"
	], DEFAULT_BACKGROUND.type);
	if (type === "image" && !imageState.hasImage) type = "none";
	return {
		type,
		color: hexOr(v.color, DEFAULT_BACKGROUND.color),
		gradient: idOr(v.gradient, DEFAULT_BACKGROUND.gradient),
		imageOpacity: clampNum(v.imageOpacity, 0, 1, DEFAULT_BACKGROUND.imageOpacity),
		imageBlur: clampNum(v.imageBlur, 0, 40, DEFAULT_BACKGROUND.imageBlur),
		hasImage: imageState.hasImage,
		imageMime: imageState.imageMime,
		imageVersion: imageState.imageVersion
	};
}
function normalizeAppearance(value, imageState = DEFAULT_IMAGE_STATE) {
	const v = isObject$5(value) ? value : {};
	return {
		mode: oneOf(v.mode, [
			"light",
			"dark",
			"system"
		], DEFAULT_APPEARANCE.mode),
		accentMode: oneOf(v.accentMode, ["preset", "custom"], DEFAULT_APPEARANCE.accentMode),
		accentPreset: idOr(v.accentPreset, DEFAULT_APPEARANCE.accentPreset, 32),
		accentCustom: hexOr(v.accentCustom, DEFAULT_APPEARANCE.accentCustom),
		accentScope: oneOf(v.accentScope, ["sidebar", "global"], DEFAULT_APPEARANCE.accentScope),
		darkIntensity: oneOf(v.darkIntensity, ["soft", "black"], DEFAULT_APPEARANCE.darkIntensity),
		palette: oneOf(v.palette, [
			"default",
			"catppuccin-latte",
			"catppuccin-frappe",
			"catppuccin-macchiato",
			"catppuccin-mocha",
			"rose-pine",
			"rose-pine-moon",
			"rose-pine-dawn",
			"nord",
			"everforest-dark",
			"everforest-light"
		], DEFAULT_APPEARANCE.palette),
		sidebarStyle: oneOf(v.sidebarStyle, [
			"follow",
			"panel",
			"accent"
		], DEFAULT_APPEARANCE.sidebarStyle),
		background: normalizeBackground(v.background, imageState),
		fontSans: idOr(v.fontSans, DEFAULT_APPEARANCE.fontSans),
		fontSansCustom: fontFamilyOr(v.fontSansCustom, DEFAULT_APPEARANCE.fontSansCustom),
		fontMono: idOr(v.fontMono, DEFAULT_APPEARANCE.fontMono),
		fontMonoCustom: fontFamilyOr(v.fontMonoCustom, DEFAULT_APPEARANCE.fontMonoCustom),
		uiScale: clampNum(v.uiScale, .9, 1.2, DEFAULT_APPEARANCE.uiScale),
		radius: clampNum(v.radius, 0, 2, DEFAULT_APPEARANCE.radius),
		density: oneOf(v.density, ["cozy", "compact"], DEFAULT_APPEARANCE.density),
		reduceMotion: boolOr(v.reduceMotion, DEFAULT_APPEARANCE.reduceMotion),
		disableMotion: boolOr(v.disableMotion, DEFAULT_APPEARANCE.disableMotion),
		customPointerSystem: boolOr(v.customPointerSystem, DEFAULT_APPEARANCE.customPointerSystem),
		customContextMenu: boolOr(v.customContextMenu, DEFAULT_APPEARANCE.customContextMenu),
		highContrast: boolOr(v.highContrast, DEFAULT_APPEARANCE.highContrast),
		sidebarPinned: boolOr(v.sidebarPinned, DEFAULT_APPEARANCE.sidebarPinned),
		timeFormat: oneOf(v.timeFormat, ["12h", "24h"], DEFAULT_APPEARANCE.timeFormat),
		pollInterval: clampNum(v.pollInterval, 0, 6e4, DEFAULT_APPEARANCE.pollInterval),
		customCss: typeof v.customCss === "string" ? v.customCss.slice(0, 5e4) : DEFAULT_APPEARANCE.customCss,
		cssVars: normalizeCssVars(v.cssVars)
	};
}
function normalizeLayout(value) {
	const layout = isObject$5(value) ? value : {};
	return {
		overviewBlocks: normalizeLayoutItems(layout.overviewBlocks, DEFAULT_OVERVIEW_BLOCKS),
		overviewMobile: normalizeLayoutItems(layout.overviewMobile, DEFAULT_OVERVIEW_MOBILE),
		navItems: normalizeLayoutItems(layout.navItems, DEFAULT_NAV_ITEMS),
		topbarItems: normalizeLayoutItems(layout.topbarItems, DEFAULT_TOPBAR_ITEMS)
	};
}
function normalizeHighlightRules(value) {
	if (!Array.isArray(value)) return [];
	const out = [];
	for (const raw of value) {
		if (!isObject$5(raw) || typeof raw.keyword !== "string") continue;
		const keyword = raw.keyword.trim().slice(0, 50);
		if (!keyword) continue;
		const color = typeof raw.color === "string" ? raw.color.slice(0, 32) : "";
		out.push({
			keyword,
			color
		});
		if (out.length >= 20) break;
	}
	return out;
}
function normalizePages(value) {
	const v = isObject$5(value) ? value : {};
	const logs = isObject$5(v.logs) ? v.logs : {};
	const levels = Array.isArray(logs.visibleLevels) ? LOG_LEVELS.filter((l) => logs.visibleLevels.includes(l)) : DEFAULT_PAGES.logs.visibleLevels;
	return {
		defaultRoute: idOr(v.defaultRoute, DEFAULT_PAGES.defaultRoute),
		logs: {
			visibleLevels: levels.length > 0 ? levels : [...LOG_LEVELS],
			maxLines: clampInt(logs.maxLines, 100, 5e3, DEFAULT_PAGES.logs.maxLines),
			autoScroll: boolOr(logs.autoScroll, DEFAULT_PAGES.logs.autoScroll),
			wrap: boolOr(logs.wrap, DEFAULT_PAGES.logs.wrap),
			highlightRules: normalizeHighlightRules(logs.highlightRules),
			preset: oneOf(logs.preset, [
				"dev",
				"ops",
				"minimal",
				"custom"
			], "custom")
		},
		processesSort: idOr(v.processesSort, DEFAULT_PAGES.processesSort),
		configTab: typeof v.configTab === "string" ? v.configTab.slice(0, 64) : DEFAULT_PAGES.configTab
	};
}
function normalizeUiConfig(value, imageState = DEFAULT_IMAGE_STATE) {
	const v = isObject$5(value) ? value : {};
	return {
		version: 1,
		appearance: normalizeAppearance(v.appearance, imageState),
		layout: normalizeLayout(v.layout),
		pages: normalizePages(v.pages)
	};
}
function ensureConfigDir() {
	fs$1.mkdirSync(CONFIG_DIR, { recursive: true });
}
function atomicWrite(config) {
	ensureConfigDir();
	const tmp = UI_CONFIG_PATH + ".tmp";
	fs$1.writeFileSync(tmp, JSON.stringify(config, null, 2), "utf8");
	fs$1.renameSync(tmp, UI_CONFIG_PATH);
}
var cached = null;
/** Load + normalize the UI config, creating it from defaults if absent. */
function loadUiConfig() {
	if (cached) return cached;
	ensureConfigDir();
	if (!fs$1.existsSync(UI_CONFIG_PATH)) {
		const fresh = defaultUiConfig();
		try {
			atomicWrite(fresh);
		} catch (err) {
			log$11.warn("failed to write initial ui.json: %s", err instanceof Error ? err.message : String(err));
		}
		cached = fresh;
		return fresh;
	}
	try {
		const raw = fs$1.readFileSync(UI_CONFIG_PATH, "utf8");
		const parsed = JSON.parse(raw);
		const normalized = normalizeStoredUiConfig(parsed);
		if (JSON.stringify(parsed) !== JSON.stringify(normalized)) try {
			atomicWrite(normalized);
		} catch {}
		cached = normalized;
		return normalized;
	} catch (err) {
		log$11.warn("ui.json unreadable; using defaults: %s", err instanceof Error ? err.message : String(err));
		const fresh = defaultUiConfig();
		cached = fresh;
		return fresh;
	}
}
/**
* Persist a client-supplied config. The incoming appearance is normalized and
* its server-managed background-image fields are forced to the current on-disk
* truth (the client cannot fake `hasImage`). Returns the stored config.
*/
function saveUiConfig(incoming) {
	const current = loadUiConfig();
	const v = isObject$5(incoming) ? incoming : {};
	const next = {
		version: 1,
		appearance: isObject$5(v.appearance) ? normalizeAppearance(v.appearance, current.appearance.background) : current.appearance,
		layout: isObject$5(v.layout) ? normalizeLayout(v.layout) : current.layout,
		pages: isObject$5(v.pages) ? normalizePages(v.pages) : current.pages ?? defaultPages()
	};
	atomicWrite(next);
	cached = next;
	return next;
}
/** The appearance subset served unauthenticated to the login page. Strips
*  `customCss` so a broken/hostile rule can never reach the pre-auth page
*  (and so the operator can always log in to fix it). */
function publicAppearance() {
	return {
		...loadUiConfig().appearance,
		customCss: ""
	};
}
var IMAGE_MIME = {
	png: "image/png",
	jpeg: "image/jpeg",
	webp: "image/webp"
};
/**
* Identify an image by its magic bytes (never by a client-supplied filename or
* Content-Type). Returns the canonical MIME, or null if it isn't a supported
* image. Supported: PNG, JPEG, WebP.
*/
function sniffImageMime(bytes) {
	if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return IMAGE_MIME.png;
	if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return IMAGE_MIME.jpeg;
	if (bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return IMAGE_MIME.webp;
	return null;
}
/** Write the uploaded image to disk and record its metadata. Returns the config. */
function writeBackgroundImage(bytes, mime) {
	fs$1.mkdirSync(UI_ASSETS_DIR, { recursive: true });
	const tmp = BACKGROUND_IMAGE_PATH + ".tmp";
	fs$1.writeFileSync(tmp, bytes);
	fs$1.renameSync(tmp, BACKGROUND_IMAGE_PATH);
	const current = loadUiConfig();
	const next = {
		...current,
		appearance: {
			...current.appearance,
			background: {
				...current.appearance.background,
				type: "image",
				hasImage: true,
				imageMime: mime,
				imageVersion: current.appearance.background.imageVersion + 1
			}
		}
	};
	atomicWrite(next);
	cached = next;
	return next;
}
/** Remove the background image (if any) and clear its metadata. Returns the config. */
function clearBackgroundImage() {
	try {
		if (fs$1.existsSync(BACKGROUND_IMAGE_PATH)) fs$1.unlinkSync(BACKGROUND_IMAGE_PATH);
	} catch (err) {
		log$11.warn("failed to remove background image: %s", err instanceof Error ? err.message : String(err));
	}
	const current = loadUiConfig();
	const next = {
		...current,
		appearance: {
			...current.appearance,
			background: {
				...current.appearance.background,
				type: current.appearance.background.type === "image" ? "none" : current.appearance.background.type,
				hasImage: false,
				imageMime: ""
			}
		}
	};
	atomicWrite(next);
	cached = next;
	return next;
}
/** Read the background image bytes + MIME, or null if none is stored. */
function readBackgroundImage() {
	const { background } = loadUiConfig().appearance;
	if (!background.hasImage) return null;
	try {
		return {
			bytes: fs$1.readFileSync(BACKGROUND_IMAGE_PATH),
			mime: background.imageMime || "application/octet-stream"
		};
	} catch {
		return null;
	}
}
