var TOTP_PERIOD_SECONDS = 30;
var TOTP_WINDOW = 1;
var TOTP_DIGITS = 6;
var RECOVERY_CODE_COUNT = 8;
var RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var WRAP_SALT_BYTES = 16;
var WRAP_IV_BYTES = 12;
var WRAP_KEY_BYTES = 32;
var SCRYPT_N$1 = 16384;
var SCRYPT_R$1 = 8;
var SCRYPT_P$1 = 1;
function totpFromSecret(secretBase32, issuer = "", accountName = "admin") {
	return new TOTP({
		issuer,
		label: accountName,
		algorithm: "SHA1",
		digits: TOTP_DIGITS,
		period: TOTP_PERIOD_SECONDS,
		secret: Secret.fromBase32(secretBase32)
	});
}
function verifyTotpCode(secretBase32, code, atMs, lastUsedStep) {
	const token = code.replace(/\s/g, "");
	if (!/^\d{6}$/.test(token)) return { ok: false };
	let totp;
	try {
		totp = totpFromSecret(secretBase32);
	} catch {
		return { ok: false };
	}
	const delta = totp.validate({
		token,
		timestamp: atMs,
		window: TOTP_WINDOW
	});
	if (delta === null) return { ok: false };
	const step = totp.counter({ timestamp: atMs }) + delta;
	if (lastUsedStep !== void 0 && step === lastUsedStep) return { ok: false };
	return {
		ok: true,
		step
	};
}
function deriveWrapKey(password, salt) {
	return scryptSync(password, salt, WRAP_KEY_BYTES, {
		N: SCRYPT_N$1,
		r: SCRYPT_R$1,
		p: SCRYPT_P$1
	});
}
function wrapTotpSecret(password, secret) {
	const wrapSalt = randomBytes(WRAP_SALT_BYTES);
	const iv = randomBytes(WRAP_IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", deriveWrapKey(password, wrapSalt), iv);
	const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
	return {
		wrapSalt: wrapSalt.toString("hex"),
		iv: iv.toString("hex"),
		ciphertext: ciphertext.toString("hex"),
		authTag: cipher.getAuthTag().toString("hex")
	};
}
function unwrapTotpSecret(password, wrapped) {
	try {
		const wrapSalt = Buffer.from(wrapped.wrapSalt, "hex");
		const iv = Buffer.from(wrapped.iv, "hex");
		const ciphertext = Buffer.from(wrapped.ciphertext, "hex");
		const authTag = Buffer.from(wrapped.authTag, "hex");
		if (wrapSalt.length !== WRAP_SALT_BYTES || iv.length !== WRAP_IV_BYTES || authTag.length !== 16) return null;
		const decipher = createDecipheriv("aes-256-gcm", deriveWrapKey(password, wrapSalt), iv);
		decipher.setAuthTag(authTag);
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
	} catch {
		return null;
	}
}
function randomRecoveryChunk() {
	const bytes = randomBytes(4);
	let chunk = "";
	for (let i = 0; i < 4; i++) chunk += RECOVERY_ALPHABET[bytes[i] % 32];
	return chunk;
}
function generateRecoveryCodes() {
	const codes = /* @__PURE__ */ new Set();
	while (codes.size < RECOVERY_CODE_COUNT) codes.add(`${randomRecoveryChunk()}-${randomRecoveryChunk()}`);
	return [...codes];
}
function normalizeRecoveryCode(code) {
	return code.replace(/[-\s]/g, "").toUpperCase();
}
function hashRecoveryCode(code) {
	return createHash("sha256").update(normalizeRecoveryCode(code), "utf8").digest("hex");
}
function hashesEqual(left, right) {
	const a = Buffer.from(left, "hex");
	const b = Buffer.from(right, "hex");
	if (a.length !== b.length || a.length === 0) return false;
	return timingSafeEqual(a, b);
}
function consumeRecoveryCode(code, hashes) {
	const candidate = hashRecoveryCode(code);
	const index = hashes.findIndex((hash) => hashesEqual(hash, candidate));
	if (index < 0) return { ok: false };
	return {
		ok: true,
		remainingHashes: hashes.filter((_, i) => i !== index)
	};
}
function beginTotpEnrollment(options) {
	const secret = options.secret ?? new Secret({ size: 20 }).base32;
	return {
		secret,
		otpauthUrl: totpFromSecret(secret, options.issuer, options.accountName).toString(),
		issuer: options.issuer,
		accountName: options.accountName
	};
}
function confirmTotpEnrollment(options) {
	const verified = verifyTotpCode(options.secret, options.code, options.atMs);
	if (!verified.ok) throw new Error("验证码不正确");
	const recoveryCodes = generateRecoveryCodes();
	return {
		recoveryCodes,
		state: {
			...wrapTotpSecret(options.password, options.secret),
			recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
			lastUsedStep: verified.step,
			label: options.label
		}
	};
}
function verifySecondFactor(options) {
	if (typeof options.recoveryCode === "string" && options.recoveryCode.length > 0) {
		const consumed = consumeRecoveryCode(options.recoveryCode, options.state.recoveryCodeHashes);
		if (!consumed.ok) return { ok: false };
		return {
			ok: true,
			state: {
				...options.state,
				recoveryCodeHashes: consumed.remainingHashes
			}
		};
	}
	if (typeof options.totp !== "string") return { ok: false };
	const secret = unwrapTotpSecret(options.password, options.state);
	if (secret === null) return { ok: false };
	const checked = verifyTotpCode(secret, options.totp, options.atMs, options.state.lastUsedStep);
	if (!checked.ok) return { ok: false };
	return {
		ok: true,
		state: {
			...options.state,
			lastUsedStep: checked.step
		}
	};
}
function decideSecondFactorLogin(options) {
	if (!options.totpEnabled) return { kind: "ok" };
	if (!options.state) return { kind: "bad-second-factor" };
	const totp = typeof options.totp === "string" && options.totp.trim().length > 0 ? options.totp.trim() : void 0;
	const recoveryCode = typeof options.recoveryCode === "string" && options.recoveryCode.trim().length > 0 ? options.recoveryCode.trim() : void 0;
	if (!totp && !recoveryCode) return { kind: "needs-totp" };
	const result = verifySecondFactor({
		password: options.password,
		state: options.state,
		atMs: options.atMs,
		totp,
		recoveryCode
	});
	if (!result.ok) return { kind: "bad-second-factor" };
	return {
		kind: "ok",
		state: result.state
	};
}
function regenerateRecoveryCodes(options) {
	const verified = verifySecondFactor({
		password: options.password,
		state: options.state,
		totp: options.totp,
		atMs: options.atMs
	});
	if (!verified.ok) throw new Error("验证码不正确");
	const recoveryCodes = generateRecoveryCodes();
	return {
		recoveryCodes,
		state: {
			...verified.state,
			recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode)
		}
	};
}
function rewrapTotpSecret(oldPassword, newPassword, state) {
	const secret = unwrapTotpSecret(oldPassword, state);
	if (secret === null) throw new Error("无法使用当前密码解开 2FA 密钥");
	return {
		...state,
		...wrapTotpSecret(newPassword, secret)
	};
}
var HEX = /^[0-9a-f]+$/i;
function isWrappedShape(value) {
	return typeof value.wrapSalt === "string" && HEX.test(value.wrapSalt) && value.wrapSalt.length === WRAP_SALT_BYTES * 2 && typeof value.iv === "string" && HEX.test(value.iv) && value.iv.length === WRAP_IV_BYTES * 2 && typeof value.ciphertext === "string" && HEX.test(value.ciphertext) && value.ciphertext.length > 0 && value.ciphertext.length % 2 === 0 && typeof value.authTag === "string" && HEX.test(value.authTag) && value.authTag.length === 32;
}
function prepareTotpStateForRestore(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("totp state must be an object");
	const v = value;
	if (!isWrappedShape(v)) throw new Error("totp wrapped secret fields are invalid");
	if (!Array.isArray(v.recoveryCodeHashes) || v.recoveryCodeHashes.length > RECOVERY_CODE_COUNT || v.recoveryCodeHashes.some((hash) => typeof hash !== "string" || !/^[0-9a-f]{64}$/i.test(hash))) throw new Error("totp recoveryCodeHashes must be SHA-256 hex strings");
	if (typeof v.lastUsedStep !== "number" || !Number.isInteger(v.lastUsedStep) || v.lastUsedStep < 0) throw new Error("totp lastUsedStep must be a non-negative integer");
	if (typeof v.label !== "string" || v.label.length === 0 || v.label.length > 128) throw new Error("totp label must be a non-empty string");
	const allowed = /* @__PURE__ */ new Set([
		"wrapSalt",
		"iv",
		"ciphertext",
		"authTag",
		"recoveryCodeHashes",
		"lastUsedStep",
		"label"
	]);
	const unknown = Object.keys(v).find((key) => !allowed.has(key));
	if (unknown) throw new Error(`unknown totp field $.${unknown}`);
	return {
		wrapSalt: v.wrapSalt.toLowerCase(),
		iv: v.iv.toLowerCase(),
		ciphertext: v.ciphertext.toLowerCase(),
		authTag: v.authTag.toLowerCase(),
		recoveryCodeHashes: v.recoveryCodeHashes.map((hash) => hash.toLowerCase()),
		lastUsedStep: v.lastUsedStep,
		label: v.label
	};
}
function parseTotpStateLenient(value) {
	if (value === void 0 || value === null) return;
	try {
		return prepareTotpStateForRestore(value);
	} catch {
		return;
	}
}
