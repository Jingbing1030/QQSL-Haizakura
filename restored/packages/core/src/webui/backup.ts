init_runtime();
var BACKUP_APP = "snowluma";
var MAX_BACKUP_DECODED_BYTES = 32 * 1024 * 1024;
/** Static allowlist. Per-account `onebot_<uin>.json` are matched by pattern. */
var BACKUP_FILES = [
	{
		name: "runtime.json",
		binary: false,
		credential: false
	},
	{
		name: "ui.json",
		binary: false,
		credential: false
	},
	{
		name: "notifications.json",
		binary: false,
		credential: true
	},
	{
		name: "snowluma.json",
		binary: false,
		credential: false
	},
	{
		name: "cert.pem",
		binary: false,
		credential: false
	},
	{
		name: "ui-assets/background",
		binary: true,
		credential: false
	},
	{
		name: "webui.json",
		binary: false,
		credential: true
	},
	{
		name: "key.pem",
		binary: false,
		credential: true
	},
	{
		name: "onebot.json",
		binary: false,
		credential: true
	}
];
var SPEC_BY_NAME = new Map(BACKUP_FILES.map((f) => [f.name, f]));
var PER_UIN_ONEBOT = /^onebot_(\d+)\.json$/;
function isPerUinOneBotName(name) {
	const match = PER_UIN_ONEBOT.exec(name);
	return match !== null && isRealUin(match[1]);
}
/** Resolve a file name (static or per-uin onebot pattern) to its spec, or null. */
function specFor(name) {
	const s = SPEC_BY_NAME.get(name);
	if (s) return s;
	if (isPerUinOneBotName(name)) return {
		name,
		binary: false,
		credential: true
	};
	return null;
}
/**
* Assemble a bundle from the allowlist plus any per-account onebot files.
* `readFile` returns null for missing.
*/
function buildBackup(readFile, perUinOnebotNames, opts, createdAt) {
	const files = {};
	const all = [...BACKUP_FILES, ...perUinOnebotNames.filter(isPerUinOneBotName).map((n) => ({
		name: n,
		binary: false,
		credential: true
	}))];
	for (const spec of all) {
		if (spec.credential && !opts.includeCredentials) continue;
		const buf = readFile(spec.name);
		if (!buf) continue;
		files[spec.name] = spec.binary ? {
			encoding: "base64",
			data: buf.toString("base64")
		} : {
			encoding: "utf8",
			data: buf.toString("utf8")
		};
	}
	return {
		version: 1,
		app: BACKUP_APP,
		createdAt,
		files
	};
}
function validateBackupEntries(parsed, skipEntryValidation) {
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {
		ok: false,
		error: "backup must be an object"
	};
	const b = parsed;
	if (b.app !== "snowluma") return {
		ok: false,
		error: "not a SnowLuma backup"
	};
	if (b.version !== 1) return {
		ok: false,
		error: `unsupported backup version ${String(b.version)}`
	};
	if (typeof b.files !== "object" || b.files === null || Array.isArray(b.files)) return {
		ok: false,
		error: "backup.files must be an object"
	};
	const files = b.files;
	for (const [name, entry] of Object.entries(files)) {
		const spec = specFor(name);
		if (!spec) return {
			ok: false,
			error: `unknown file in backup: ${name}`
		};
		if (skipEntryValidation(spec)) continue;
		if (typeof entry !== "object" || entry === null) return {
			ok: false,
			error: `malformed entry: ${name}`
		};
		const e = entry;
		if (e.encoding !== "utf8" && e.encoding !== "base64") return {
			ok: false,
			error: `bad encoding for ${name}`
		};
		if (typeof e.data !== "string") return {
			ok: false,
			error: `bad data for ${name}`
		};
	}
	return {
		ok: true,
		backup: {
			version: 1,
			app: BACKUP_APP,
			createdAt: typeof b.createdAt === "string" ? b.createdAt : void 0,
			files
		}
	};
}
var RestorePreflightError = class extends Error {
	file;
	constructor(file, message, options) {
		super(`${file}: ${message}`, options);
		this.name = "RestorePreflightError";
		this.file = file;
	}
};
/**
* Validate every selected file semantically and materialize canonical bytes
* before the transaction is allowed to touch live configuration.
*/
function prepareRestorePlan(parsed, opts) {
	const checked = validateBackupEntries(parsed, (spec) => spec.credential && !opts.restoreCredentials);
	if (!checked.ok) throw new RestorePreflightError("<backup>", checked.error);
	const restore = [];
	const skipped = [];
	const migrated = [];
	const selected = [];
	let decodedBytes = 0;
	for (const [name, entry] of Object.entries(checked.backup.files)) {
		const spec = specFor(name);
		if (!spec) throw new RestorePreflightError(name, "file is not in the restore allowlist");
		if (spec.credential && !opts.restoreCredentials) {
			skipped.push(name);
			continue;
		}
		if (entry.encoding !== (spec.binary ? "base64" : "utf8")) throw new RestorePreflightError(name, `encoding must be ${spec.binary ? "base64" : "utf8"}`);
		const decoded = decodeEntryStrict(name, entry);
		decodedBytes += decoded.length;
		if (decodedBytes > 33554432) throw new RestorePreflightError(name, `selected files exceed ${String(MAX_BACKUP_DECODED_BYTES)} decoded bytes`);
		selected.push({
			name,
			data: decoded,
			spec
		});
	}
	const selectedGlobal = selected.find((file) => file.name === "onebot.json");
	const selectedPerUin = selected.filter((file) => isPerUinOneBotName(file.name));
	const selectedPerUinRaw = new Map(selectedPerUin.map((file) => [file.name, parseJson(file.name, file.data)]));
	const perUinNeedsGlobal = [...selectedPerUinRaw.values()].some((raw) => !isPlainObject(raw) || raw.mode !== "snapshot");
	let effectiveGlobalOneBot;
	let preparedGlobalOneBot = null;
	if (selectedGlobal) {
		if (!opts.listCurrentOneBotNames) throw new RestorePreflightError("onebot.json", "current per-account config listing is required to validate the effective overlay");
		const raw = parseJson(selectedGlobal.name, selectedGlobal.data);
		preparedGlobalOneBot = prepareOneBotOrThrow(selectedGlobal.name, raw, "global");
		effectiveGlobalOneBot = preparedGlobalOneBot.value;
	} else if (perUinNeedsGlobal) {
		const current = readCurrentForPreflight(opts, "onebot.json");
		if (current) effectiveGlobalOneBot = prepareOneBotOrThrow("onebot.json", parseJson("onebot.json", current), "global").value;
	}
	for (const { name, data, spec } of selected) {
		let prepared;
		if (name === "onebot.json") {
			const global = preparedGlobalOneBot;
			prepared = {
				data: serializeJson(global.value),
				migratedFields: global.migratedFields
			};
		} else if (isPerUinOneBotName(name)) {
			const onebot = prepareOneBotOrThrow(name, selectedPerUinRaw.get(name), "per-uin", effectiveGlobalOneBot);
			prepared = {
				data: serializeJson(onebot.value),
				migratedFields: onebot.migratedFields
			};
		} else prepared = prepareFile(name, data);
		restore.push({
			name,
			data: prepared.data,
			mode: spec.credential ? 384 : 420
		});
		if (prepared.migratedFields.length > 0) migrated.push({
			name,
			fields: [...prepared.migratedFields].sort()
		});
	}
	if (selectedGlobal) {
		const selectedNames = new Set(selected.map((file) => file.name));
		let currentNames;
		try {
			currentNames = opts.listCurrentOneBotNames();
		} catch (error) {
			throw new RestorePreflightError("onebot.json", `failed to list current per-account configs: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
		for (const name of currentNames) {
			if (!isPerUinOneBotName(name) || selectedNames.has(name)) continue;
			const current = readCurrentForPreflight(opts, name);
			if (!current) continue;
			prepareOneBotOrThrow(name, parseJson(name, current), "per-uin", effectiveGlobalOneBot);
		}
	}
	validateEffectiveTls(restore, opts);
	validateEffectiveUi(restore, opts);
	return {
		restore,
		skipped,
		migrated
	};
}
function decodeEntryStrict(name, entry) {
	if (entry.encoding === "utf8") return Buffer.from(entry.data, "utf8");
	if (!isCanonicalBase64(entry.data)) throw new RestorePreflightError(name, "data is not canonical base64");
	return Buffer.from(entry.data, "base64");
}
function isCanonicalBase64(value) {
	if (value.length === 0) return true;
	if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
	return Buffer.from(value, "base64").toString("base64") === value;
}
function prepareFile(name, data) {
	try {
		switch (name) {
			case "runtime.json": return prepareRuntimeJson(name, data);
			case "ui.json": return prepareNormalizedJson(name, data, normalizeStoredUiConfig);
			case "notifications.json": return prepareNormalizedJson(name, data, normalizeNotificationsConfig);
			case "snowluma.json": return prepareGlobalSettingsJson(name, data);
			case "webui.json": return {
				data: serializeJson(prepareWebuiAuthStateForRestore(parseJson(name, data))),
				migratedFields: []
			};
			case "ui-assets/background":
				if (data.length > 5242880) throw new Error(`image exceeds ${String(MAX_BACKGROUND_BYTES)} bytes`);
				if (!sniffImageMime(data)) throw new Error("image must be PNG, JPEG, or WebP");
				return {
					data,
					migratedFields: []
				};
			case "cert.pem":
			case "key.pem":
				if (!data.toString("utf8").trim()) throw new Error("PEM file must not be empty");
				return {
					data,
					migratedFields: []
				};
			default: throw new Error("file is not in the restore allowlist");
		}
	} catch (error) {
		if (error instanceof RestorePreflightError) throw error;
		throw new RestorePreflightError(name, error instanceof Error ? error.message : String(error), { cause: error });
	}
}
function prepareOneBotOrThrow(name, value, scope, inheritedGlobal) {
	try {
		return prepareOneBotConfigForRestore(value, scope, inheritedGlobal);
	} catch (error) {
		throw new RestorePreflightError(name, error instanceof Error ? error.message : String(error), { cause: error });
	}
}
function readCurrentForPreflight(opts, name) {
	try {
		return opts.readCurrent(name);
	} catch (error) {
		throw new RestorePreflightError(name, `failed to read current file: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
}
function parseJson(name, data) {
	try {
		return JSON.parse(data.toString("utf8"));
	} catch (error) {
		throw new RestorePreflightError(name, "invalid JSON", { cause: error });
	}
}
function prepareNormalizedJson(name, data, normalize) {
	const raw = parseJson(name, data);
	const canonical = normalize(raw);
	const migratedFields = [];
	assertNoLossyNormalization(name, raw, canonical, "$", migratedFields);
	return {
		data: serializeJson(canonical),
		migratedFields
	};
}
function prepareRuntimeJson(name, data) {
	const prepared = prepareNormalizedJson(name, data, normalizeRuntimeConfig);
	const runtime = JSON.parse(prepared.data.toString("utf8"));
	if (!runtime.webuiHost || !isValidBindHost(runtime.webuiHost)) throw new RestorePreflightError(name, "$.webuiHost is not a valid TCP bind host");
	return prepared;
}
function prepareGlobalSettingsJson(name, data) {
	const raw = parseJson(name, data);
	const normalized = normalizeGlobalSettings(raw);
	const canonical = { rkey: normalized.rkey };
	if (isPlainObject(raw) && Object.prototype.hasOwnProperty.call(raw, "videoUploadConcurrency")) canonical.videoUploadConcurrency = normalized.videoUploadConcurrency;
	if (isPlainObject(raw) && Object.prototype.hasOwnProperty.call(raw, "musicSignUrl")) canonical.musicSignUrl = normalized.musicSignUrl;
	const migratedFields = [];
	assertNoLossyNormalization(name, raw, canonical, "$", migratedFields);
	return {
		data: serializeJson(canonical),
		migratedFields
	};
}
function assertNoLossyNormalization(name, raw, canonical, at, additions) {
	if (isPlainObject(raw)) {
		if (!isPlainObject(canonical)) throw new RestorePreflightError(name, `${at} has an invalid type`);
		for (const [key, rawValue] of Object.entries(raw)) {
			const child = `${at}.${key}`;
			if (!Object.prototype.hasOwnProperty.call(canonical, key)) throw new RestorePreflightError(name, `${child} is unsupported or would be discarded`);
			assertNoLossyNormalization(name, rawValue, canonical[key], child, additions);
		}
		for (const key of Object.keys(canonical)) if (!Object.prototype.hasOwnProperty.call(raw, key)) additions.push(`${at}.${key}`);
		return;
	}
	if (Array.isArray(raw)) {
		if (!Array.isArray(canonical) || raw.length !== canonical.length) throw new RestorePreflightError(name, `${at} contains an invalid, duplicate, or discarded item`);
		raw.forEach((value, index) => {
			assertNoLossyNormalization(name, value, canonical[index], `${at}[${String(index)}]`, additions);
		});
		return;
	}
	if (!Object.is(raw, canonical)) {
		if (isKnownLosslessScalarCoercion(name, at, raw, canonical)) {
			additions.push(at);
			return;
		}
		throw new RestorePreflightError(name, `${at} is invalid or would be changed`);
	}
}
function isKnownLosslessScalarCoercion(name, at, raw, canonical) {
	if (typeof raw === "string" && typeof canonical === "string" && raw.trim() === canonical) return true;
	if (typeof raw === "string" && typeof canonical === "number") {
		const parsed = Number(raw.trim());
		return raw.trim().length > 0 && Number.isFinite(parsed) && Object.is(parsed, canonical);
	}
	if (name === "runtime.json" && (at === "$.hookAutoLoad" || at === "$.webuiTls.enabled") && typeof canonical === "boolean") {
		if (raw === 1 || raw === 0) return canonical === (raw === 1);
		if (typeof raw !== "string") return false;
		const token = raw.trim().toLowerCase();
		const truthy = /* @__PURE__ */ new Set([
			"true",
			"1",
			"yes",
			"on"
		]);
		const falsy = /* @__PURE__ */ new Set([
			"false",
			"0",
			"no",
			"off",
			""
		]);
		return canonical && truthy.has(token) || !canonical && falsy.has(token);
	}
	return false;
}
function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function serializeJson(value) {
	return Buffer.from(JSON.stringify(value, null, 2), "utf8");
}
function validateEffectiveTls(restore, opts) {
	const byName = new Map(restore.map((file) => [file.name, file.data]));
	const pairTouched = byName.has("cert.pem") || byName.has("key.pem");
	if (!(pairTouched || byName.has("runtime.json"))) return;
	const readEffective = (name) => {
		const prepared = byName.get(name);
		if (prepared) return prepared;
		try {
			return opts.readCurrent(name);
		} catch (error) {
			throw new RestorePreflightError(name, `failed to read current file: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
	};
	const runtime = readEffective("runtime.json");
	let tlsEnabled = false;
	if (runtime) try {
		tlsEnabled = normalizeRuntimeConfig(JSON.parse(runtime.toString("utf8"))).webuiTls?.enabled === true;
	} catch (error) {
		throw new RestorePreflightError("runtime.json", "effective runtime config is invalid JSON", { cause: error });
	}
	if (!tlsEnabled && !pairTouched) return;
	const cert = readEffective("cert.pem");
	const key = readEffective("key.pem");
	if (cert && key) {
		const valid = validateTlsPair(cert, key);
		if (!valid.ok) throw new RestorePreflightError("cert.pem + key.pem", valid.reason ?? "TLS pair is invalid");
		return;
	}
	if (tlsEnabled) throw new RestorePreflightError("cert.pem + key.pem", "TLS is enabled but the effective certificate/private-key pair is incomplete");
}
function validateEffectiveUi(restore, opts) {
	const byName = new Map(restore.map((file) => [file.name, file.data]));
	if (!byName.has("ui.json") && !byName.has("ui-assets/background")) return;
	const readEffective = (name) => {
		const prepared = byName.get(name);
		if (prepared) return prepared;
		try {
			return opts.readCurrent(name);
		} catch (error) {
			throw new RestorePreflightError(name, `failed to read current file: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
	};
	const uiBytes = readEffective("ui.json");
	if (!uiBytes) return;
	let ui;
	try {
		ui = normalizeStoredUiConfig(JSON.parse(uiBytes.toString("utf8")));
	} catch (error) {
		throw new RestorePreflightError("ui.json", "effective UI config is invalid JSON", { cause: error });
	}
	const background = ui.appearance.background;
	if (!background.hasImage) return;
	const image = readEffective("ui-assets/background");
	if (!image) throw new RestorePreflightError("ui.json + ui-assets/background", "background metadata says an image exists, but the effective image is missing");
	if (image.length > 5242880) throw new RestorePreflightError("ui.json + ui-assets/background", `effective background exceeds ${String(MAX_BACKGROUND_BYTES)} bytes`);
	const mime = sniffImageMime(image);
	if (!mime) throw new RestorePreflightError("ui.json + ui-assets/background", "effective background is not PNG, JPEG, or WebP");
	if (mime !== background.imageMime) throw new RestorePreflightError("ui.json + ui-assets/background", `background metadata MIME ${background.imageMime} does not match image bytes ${mime}`);
}
