init_logger();
var log$13 = createLogger("WebUI.Auth");
var CONFIG_DIR$2 = "config";
var WEBUI_CONFIG_PATH = path$1.join(CONFIG_DIR$2, "webui.json");
var SCRYPT_KEYLEN = 64;
var SCRYPT_N = 16384;
var SCRYPT_R = 8;
var SCRYPT_P = 1;
var DEV_PASSWORD = "snowluma-dev";
function isDevAuthMode() {
	return process.env.SNOWLUMA_DEV_MODE === "1";
}
function envBootstrapPassword() {
	const raw = process.env.SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD;
	if (!raw || typeof raw !== "string") return null;
	if (raw.length < 8) return null;
	return raw;
}
var PASSWORD_RULES = [
	{
		id: "length",
		label: "长度不少于 10 位",
		test: (p) => p.length >= 10
	},
	{
		id: "lower",
		label: "包含小写字母",
		test: (p) => /[a-z]/.test(p)
	},
	{
		id: "upper",
		label: "包含大写字母",
		test: (p) => /[A-Z]/.test(p)
	},
	{
		id: "special",
		label: "包含特殊符号 (!@#$%…)",
		test: (p) => /[^A-Za-z0-9\s]/.test(p)
	},
	{
		id: "no-space",
		label: "不包含空格",
		test: (p) => !/\s/.test(p) && p.length > 0
	}
];
function evaluatePasswordRules(password) {
	return PASSWORD_RULES.map((r) => ({
		id: r.id,
		label: r.label,
		ok: r.test(password)
	}));
}
function isStrongPassword(password) {
	return PASSWORD_RULES.every((r) => r.test(password));
}
function hashPassword(password, salt) {
	return scryptSync$1(password, salt, SCRYPT_KEYLEN, {
		N: SCRYPT_N,
		r: SCRYPT_R,
		p: SCRYPT_P
	});
}
function ensureConfigDir$2() {
	fs$1.mkdirSync(CONFIG_DIR$2, { recursive: true });
}
/**
* Validate credential state before it crosses a persistence boundary.
*
* The hash/salt lengths are part of the on-disk contract: accepting any hex
* string here only postpones failure until password verification, where the
* operator would be locked out after a restore.
*/
function prepareWebuiAuthStateForRestore(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("credential state must be an object");
	const v = value;
	if (typeof v.passwordHash !== "string" || !/^[0-9a-f]{128}$/i.test(v.passwordHash)) throw new Error("passwordHash must be exactly 128 hexadecimal characters");
	if (typeof v.passwordSalt !== "string" || !/^[0-9a-f]{32}$/i.test(v.passwordSalt)) throw new Error("passwordSalt must be exactly 32 hexadecimal characters");
	if (typeof v.mustChangePassword !== "boolean") throw new Error("mustChangePassword must be a boolean");
	if (typeof v.generatedAt !== "string" || !Number.isFinite(Date.parse(v.generatedAt))) throw new Error("generatedAt must be a valid timestamp");
	if (typeof v.updatedAt !== "string" || !Number.isFinite(Date.parse(v.updatedAt))) throw new Error("updatedAt must be a valid timestamp");
	const allowed = /* @__PURE__ */ new Set([
		"passwordHash",
		"passwordSalt",
		"mustChangePassword",
		"generatedAt",
		"updatedAt",
		"totp"
	]);
	const unknown = Object.keys(v).find((key) => !allowed.has(key));
	if (unknown) throw new Error(`unknown field $.${unknown}`);
	const state = {
		passwordHash: v.passwordHash,
		passwordSalt: v.passwordSalt,
		mustChangePassword: v.mustChangePassword,
		generatedAt: v.generatedAt,
		updatedAt: v.updatedAt
	};
	if (!Object.prototype.hasOwnProperty.call(v, "totp") || v.totp === void 0) return state;
	state.totp = prepareTotpStateForRestore(v.totp);
	return state;
}
function parseLiveAuthState(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const v = value;
	const totpValue = v.totp;
	const withoutTotp = { ...v };
	delete withoutTotp.totp;
	try {
		const state = prepareWebuiAuthStateForRestore(Object.prototype.hasOwnProperty.call(v, "totp") ? withoutTotp : value);
		const totp = parseTotpStateLenient(totpValue);
		if (Object.prototype.hasOwnProperty.call(v, "totp") && totpValue !== void 0 && !totp) log$13.warn("webui.json totp field is invalid and will be ignored; password credentials are unchanged");
		if (totp) state.totp = totp;
		return state;
	} catch {
		return null;
	}
}
function generateInitialState(initialPassword) {
	const salt = randomBytes$1(16);
	const hash = hashPassword(initialPassword, salt);
	const now = (/* @__PURE__ */ new Date()).toISOString();
	return {
		passwordHash: hash.toString("hex"),
		passwordSalt: salt.toString("hex"),
		mustChangePassword: true,
		generatedAt: now,
		updatedAt: now
	};
}
function backupCorruptConfig() {
	try {
		const dest = `${WEBUI_CONFIG_PATH}.bak.${Date.now()}`;
		fs$1.renameSync(WEBUI_CONFIG_PATH, dest);
		log$13.warn("previous webui.json moved to %s", dest);
	} catch (err) {
		log$13.warn("failed to back up corrupt webui.json: %s", err instanceof Error ? err.message : String(err));
	}
}
function atomicWrite$2(state) {
	ensureConfigDir$2();
	const tmp = WEBUI_CONFIG_PATH + ".tmp";
	fs$1.writeFileSync(tmp, JSON.stringify(state, null, 2), {
		encoding: "utf8",
		mode: 384
	});
	try {
		fs$1.chmodSync(tmp, 384);
	} catch {}
	fs$1.renameSync(tmp, WEBUI_CONFIG_PATH);
}
var WebuiAuth = class WebuiAuth {
	state;
	initialPlain;
	devMode;
	constructor(state, initialPlain, devMode) {
		this.state = state;
		this.initialPlain = initialPlain;
		this.devMode = devMode;
	}
	static load() {
		if (isDevAuthMode()) {
			const salt = randomBytes$1(16);
			const hash = hashPassword(DEV_PASSWORD, salt);
			const now = (/* @__PURE__ */ new Date()).toISOString();
			const state = {
				passwordHash: hash.toString("hex"),
				passwordSalt: salt.toString("hex"),
				mustChangePassword: false,
				generatedAt: now,
				updatedAt: now
			};
			return new WebuiAuth(state, null, true);
		}
		ensureConfigDir$2();
		if (fs$1.existsSync(WEBUI_CONFIG_PATH)) try {
			const raw = fs$1.readFileSync(WEBUI_CONFIG_PATH, "utf8");
			const live = parseLiveAuthState(JSON.parse(raw));
			if (live) {
				if (live.mustChangePassword) {
					const initialPassword = randomBytes$1(8).toString("hex");
					const state = generateInitialState(initialPassword);
					atomicWrite$2(state);
					log$13.warn("previous bootstrap password was never rotated; regenerated a new one");
					return new WebuiAuth(state, initialPassword, false);
				}
				return new WebuiAuth(live, null, false);
			}
			log$13.error("webui.json schema invalid; backing up and regenerating credentials");
			backupCorruptConfig();
		} catch (err) {
			log$13.error("webui.json is corrupt and will be regenerated; the previous file is backed up: %s", err instanceof Error ? err.message : String(err));
			backupCorruptConfig();
		}
		const envPassword = envBootstrapPassword();
		if (envPassword !== null) {
			const salt = randomBytes$1(16);
			const hash = hashPassword(envPassword, salt);
			const now = (/* @__PURE__ */ new Date()).toISOString();
			const state = {
				passwordHash: hash.toString("hex"),
				passwordSalt: salt.toString("hex"),
				mustChangePassword: false,
				generatedAt: now,
				updatedAt: now
			};
			atomicWrite$2(state);
			log$13.info("webui credentials seeded from SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD");
			return new WebuiAuth(state, null, false);
		}
		const initialPassword = randomBytes$1(8).toString("hex");
		const state = generateInitialState(initialPassword);
		atomicWrite$2(state);
		return new WebuiAuth(state, initialPassword, false);
	}
	/** True when SNOWLUMA_DEV_MODE was active at load time. */
	isDevMode() {
		return this.devMode;
	}
	/** Fixed dev password (only meaningful when {@link isDevMode} is true). */
	static get devPassword() {
		return DEV_PASSWORD;
	}
	/** Returns the auto-generated initial password if this is a fresh install, else null. */
	takeInitialPassword() {
		const p = this.initialPlain;
		this.initialPlain = null;
		return p;
	}
	mustChangePassword() {
		return this.state.mustChangePassword;
	}
	verify(password) {
		if (typeof password !== "string" || password.length === 0) return false;
		try {
			const salt = Buffer.from(this.state.passwordSalt, "hex");
			const expected = Buffer.from(this.state.passwordHash, "hex");
			const got = hashPassword(password, salt);
			if (got.length !== expected.length) return false;
			return timingSafeEqual$1(got, expected);
		} catch {
			return false;
		}
	}
	setPassword(newPassword, currentPassword) {
		if (this.devMode) throw new Error("开发模式 (SNOWLUMA_DEV_MODE=1) 已禁用密码修改");
		if (!isStrongPassword(newPassword)) throw new Error("密码不符合强度要求");
		let totp = this.state.totp;
		if (totp) {
			if (typeof currentPassword !== "string" || currentPassword.length === 0) throw new Error("修改密码需要当前密码以重新保护 2FA 密钥");
			totp = rewrapTotpSecret(currentPassword, newPassword, totp);
		}
		const salt = randomBytes$1(16);
		const next = {
			passwordHash: hashPassword(newPassword, salt).toString("hex"),
			passwordSalt: salt.toString("hex"),
			mustChangePassword: false,
			generatedAt: this.state.generatedAt,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			...totp ? { totp } : {}
		};
		atomicWrite$2(next);
		this.state = next;
	}
	totpEnabled() {
		return this.state.totp !== void 0;
	}
	totpStatus() {
		const totp = this.state.totp;
		if (!totp) return { enabled: false };
		return {
			enabled: true,
			remainingRecoveryCodes: totp.recoveryCodeHashes.length,
			label: totp.label
		};
	}
	totpState() {
		return this.state.totp;
	}
	persistTotp(totp) {
		if (this.devMode) throw new Error("开发模式 (SNOWLUMA_DEV_MODE=1) 已禁用 2FA");
		const next = {
			...this.state,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		if (totp) next.totp = totp;
		else delete next.totp;
		atomicWrite$2(next);
		this.state = next;
	}
};
