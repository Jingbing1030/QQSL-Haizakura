init_logger();
var log$12 = createLogger("WebUI.Consent");
var __dirname$1 = path$1.dirname(fileURLToPath(import.meta.url));
var CONFIG_DIR$1 = "config";
var CONSENT_CONFIG_PATH = path$1.join(CONFIG_DIR$1, "consent.json");
var AGREEMENT_FILES = [{
	id: "eula",
	file: "EULA.md"
}, {
	id: "privacy",
	file: "PRIVACY.md"
}];
var EULA_ACCEPT_ENV = "SNOWLUMA_ACCEPT_EULA";
var PRIVACY_ACCEPT_ENV = "SNOWLUMA_ACCEPT_PRIVACY";
function parseEnvironmentAcceptance(name, raw) {
	if (raw === void 0 || raw.trim() === "") return false;
	const normalized = raw.trim().toLowerCase();
	if (normalized === "1" || normalized === "true") return true;
	if (normalized === "0" || normalized === "false") return false;
	throw new Error(`${name} must be one of: 1, true, 0, false; received ${JSON.stringify(raw)}`);
}
/**
* Resolve declarative consent for unattended deployments. Environment consent
* is intentionally ephemeral: removing either variable restores the normal
* versioned consent gate instead of silently writing a permanent record.
*/
function resolveEnvironmentConsent(env = process.env) {
	const eulaAccepted = parseEnvironmentAcceptance(EULA_ACCEPT_ENV, env[EULA_ACCEPT_ENV]);
	const privacyAccepted = parseEnvironmentAcceptance(PRIVACY_ACCEPT_ENV, env[PRIVACY_ACCEPT_ENV]);
	return {
		eulaAccepted,
		privacyAccepted,
		accepted: eulaAccepted && privacyAccepted
	};
}
/**
* Resolve an agreement file across the dev and packaged layouts. In dev the
* server runs from source (`__dirname` = packages/core/src/webui); in a build
* it is the single bundled dist/index.mjs (`__dirname` = dist/) with the docs
* copied alongside. cwd is not reliable (dev cwd = packages/core, prod = repo
* root or dist/), so we probe a handful of candidates and take the first hit.
*/
function resolveAgreementFile(file) {
	const candidates = [
		path$1.join(__dirname$1, file),
		path$1.resolve(__dirname$1, "..", "..", "..", "..", file),
		path$1.resolve(process.cwd(), file),
		path$1.resolve(process.cwd(), "..", "..", file)
	];
	for (const candidate of candidates) try {
		if (fs$1.existsSync(candidate)) return candidate;
	} catch {}
	return null;
}
/** Extract title / declared version / effective date from a doc body. */
function parseAgreementMeta(text) {
	return {
		title: text.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() ?? "",
		declaredVersion: text.match(/(?:Version|版本)[^\n0-9]*([0-9][0-9A-Za-z.-]*)/)?.[1]?.trim() ?? "",
		effectiveDate: text.match(/(?:Effective date|生效日期)[^\n0-9]*(\d{4}-\d{2}-\d{2})/)?.[1] ?? ""
	};
}
/**
* Canonical agreements version = short sha256 over each doc's id + body.
* Deliberately content-derived, NOT app-version-derived: it stays stable when
* only the app is upgraded (so a one-time consent survives across versions),
* and changes the moment any agreement's TEXT changes (forcing re-consent).
*/
function computeAgreementsVersion(docs) {
	const hash = createHash$1("sha256");
	for (const doc of docs) {
		hash.update(doc.id);
		hash.update("\0");
		hash.update(doc.text);
		hash.update("\0");
	}
	return hash.digest("hex").slice(0, 16);
}
var cache = null;
/** Load + parse both agreements and compute the version. Cached per process. */
function loadAgreements() {
	if (cache) return cache;
	const docs = AGREEMENT_FILES.map(({ id, file }) => {
		const resolved = resolveAgreementFile(file);
		let text = "";
		if (resolved) try {
			text = fs$1.readFileSync(resolved, "utf8");
		} catch (err) {
			log$12.warn("failed to read %s: %s", file, err instanceof Error ? err.message : String(err));
		}
		else log$12.warn("agreement file not found (looked for %s near the bundle and repo root)", file);
		const meta = parseAgreementMeta(text);
		return {
			id,
			title: meta.title,
			declaredVersion: meta.declaredVersion,
			effectiveDate: meta.effectiveDate,
			text
		};
	});
	cache = {
		docs,
		version: computeAgreementsVersion(docs)
	};
	return cache;
}
function ensureConfigDir$1() {
	fs$1.mkdirSync(CONFIG_DIR$1, { recursive: true });
}
function isConsentRecord(value) {
	if (!value || typeof value !== "object") return false;
	const v = value;
	return typeof v.version === "string" && v.version.length > 0 && typeof v.acceptedAt === "string";
}
function loadConsentRecord() {
	try {
		if (!fs$1.existsSync(CONSENT_CONFIG_PATH)) return null;
		const parsed = JSON.parse(fs$1.readFileSync(CONSENT_CONFIG_PATH, "utf8"));
		return isConsentRecord(parsed) ? parsed : null;
	} catch (err) {
		log$12.warn("consent.json unreadable, treating as no consent: %s", err instanceof Error ? err.message : String(err));
		return null;
	}
}
function atomicWrite$1(record) {
	ensureConfigDir$1();
	const tmp = CONSENT_CONFIG_PATH + ".tmp";
	fs$1.writeFileSync(tmp, JSON.stringify(record, null, 2), { encoding: "utf8" });
	fs$1.renameSync(tmp, CONSENT_CONFIG_PATH);
}
/** Persist that the operator accepted `version`. Returns the stored record. */
function recordConsent(version) {
	const record = {
		version,
		acceptedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	atomicWrite$1(record);
	return record;
}
/** True when neither environment nor stored consent covers the current agreements. */
function isConsentRequired(env = process.env) {
	if (resolveEnvironmentConsent(env).accepted) return false;
	const { docs, version } = loadAgreements();
	if (!docs.some((d) => d.text.trim().length > 0)) return false;
	return loadConsentRecord()?.version !== version;
}
/** Public payload for GET /api/agreements (texts + version + consentRequired). */
function getAgreementsPayload() {
	const { docs, version } = loadAgreements();
	return {
		version,
		consentRequired: isConsentRequired(),
		documents: docs
	};
}
