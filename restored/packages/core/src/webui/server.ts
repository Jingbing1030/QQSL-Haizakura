init_log_file_transport();
init_logger();
init_runtime();
var log$3 = createLogger("WebUI");
var __dirname = path$1.dirname(fileURLToPath(import.meta.url));
var sessionTokens = /* @__PURE__ */ new Map();
var loginAttempts = /* @__PURE__ */ new Map();
var totpEnrollments = /* @__PURE__ */ new Map();
var LOGIN_MAX_ATTEMPTS = 5;
var LOGIN_LOCKOUT_MS = 900 * 1e3;
var TOKEN_TTL_MS = 1440 * 60 * 1e3;
var TOTP_ENROLL_TTL_MS = 600 * 1e3;
var DEFAULT_TOTP_ISSUER = "SnowLuma";
var AVATAR_CACHE_TTL_MS = 720 * 60 * 60 * 1e3;
var AVATAR_BROWSER_CACHE_SECONDS = 720 * 60 * 60;
/** Translate transaction facts into an operator-facing HTTP failure. */
function describeRestoreFailure(error) {
	const detail = error.cause instanceof Error ? error.cause.message : error.message;
	let message;
	if (error.phase === "preflight") message = `备份校验失败：${detail}`;
	else if (error.rollbackSucceeded === false) {
		const recovery = error.snapshotDir ? `，恢复资料保留在 ${error.snapshotDir}` : "";
		message = `恢复失败，且自动回滚不完整。请勿重启或继续修改配置；事务 ID：${error.transactionId}${recovery}。请检查服务器日志。`;
	} else if (error.committed) {
		const retained = error.snapshotDir ? `，临时事务资料保留在 ${error.snapshotDir}` : "";
		message = `配置已恢复，但临时事务目录清理失败；重启后配置仍会生效。事务 ID：${error.transactionId}${retained}。请检查服务器日志。`;
	} else if (error.phase === "cleanup") {
		const configState = error.rollbackSucceeded === true ? "当前配置已自动回滚" : "当前配置未改动";
		const retained = error.snapshotDir ? `，临时事务资料保留在 ${error.snapshotDir}` : "";
		message = `恢复失败，${configState}，但临时事务目录清理失败；事务 ID：${error.transactionId}${retained}。请检查服务器日志。`;
	} else if (error.rollbackSucceeded === true) message = `恢复失败，当前配置已自动回滚。事务 ID：${error.transactionId}。请检查服务器日志。`;
	else message = `恢复失败，当前配置未改动。事务 ID：${error.transactionId}。请检查服务器日志。`;
	return {
		status: error.phase === "preflight" ? 400 : 500,
		body: {
			success: false,
			message,
			transactionId: error.transactionId,
			phase: error.phase,
			committed: error.committed,
			...error.rollbackSucceeded === void 0 ? {} : { rollbackSucceeded: error.rollbackSucceeded },
			...error.snapshotDir === void 0 ? {} : { snapshotDir: error.snapshotDir },
			failedFiles: error.failedFiles
		}
	};
}
function isMissingPath(error) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
/** Read one allowlisted config file; I/O failures other than absence are fatal. */
function readBackupConfigFile(configDir, name) {
	try {
		return readFileSync$1(path$1.join(configDir, name));
	} catch (error) {
		if (isMissingPath(error)) return null;
		throw error;
	}
}
/** List per-account OneBot config candidates; an unreadable directory is fatal. */
function listPerUinOneBotConfigFiles(configDir) {
	try {
		return readdirSync(configDir).filter((name) => /^onebot_\d+\.json$/.test(name));
	} catch (error) {
		if (isMissingPath(error)) return [];
		throw error;
	}
}
var MUST_CHANGE_ALLOWLIST = /* @__PURE__ */ new Set([
	"/api/status",
	"/api/auth/state",
	"/api/auth/check-strength",
	"/api/auth/change-password",
	"/api/agreements",
	"/api/agreements/record-consent",
	"/api/logout"
]);
var CONSENT_ALLOWLIST = /* @__PURE__ */ new Set([
	"/api/status",
	"/api/auth/state",
	"/api/agreements",
	"/api/agreements/record-consent",
	"/api/logout"
]);
var UIN_REGEX = /^\d{5,10}$/;
var avatarCache = /* @__PURE__ */ new Map();
function purgeExpiredTokens() {
	const now = Date.now();
	for (const [token, info] of sessionTokens) if (now > info.expiresAt) sessionTokens.delete(token);
	for (const [ip, attempt] of loginAttempts) if (now > attempt.resetAt) loginAttempts.delete(ip);
	for (const [token, enrollment] of totpEnrollments) if (now > enrollment.expiresAt) totpEnrollments.delete(token);
}
function sanitizeTotpLabelPart(value, fallback) {
	if (typeof value !== "string") return fallback;
	const trimmed = value.replace(/[\r\n\t]/g, "").trim();
	if (!trimmed) return fallback;
	return trimmed.slice(0, 64);
}
function defaultTotpAccountName() {
	return os.hostname().trim() || "admin";
}
async function fetchQqAvatar(uin) {
	const response = await fetch(`https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(uin)}&s=100`, { headers: {
		"User-Agent": "SnowLuma WebUI",
		Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
	} });
	if (!response.ok) throw new Error(`avatar upstream responded with ${response.status}`);
	const contentType = response.headers.get("content-type") || "image/jpeg";
	return {
		body: new Uint8Array(await response.arrayBuffer()),
		contentType
	};
}
function detectDistro() {
	const parseKernel = (v) => {
		return v.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
	};
	if (os.platform() === "linux") {
		const kernelRelease = os.release();
		const kernelVer = parseKernel(kernelRelease);
		const isRhelFamily = (name) => /^(red hat|centos|rocky|alma|oracle|scientific|anolis|tencentos|bclinux|opencloudos)/.test(name);
		const kernelDistroVer = (distro) => {
			if (!distro) return null;
			const lr = kernelRelease.toLowerCase();
			const ld = distro.toLowerCase();
			if (ld === "debian") {
				const m = lr.match(/deb(\d+)/);
				if (m) return m[1];
			}
			if (isRhelFamily(ld)) {
				const m = lr.match(/el(\d+)/);
				if (m) return m[1];
			}
			if (ld === "fedora") {
				const m = lr.match(/fc(\d+)/);
				if (m) return m[1];
			}
			if (ld === "amazon" || ld.includes("amazon")) {
				const m = lr.match(/amzn(\d+)/);
				if (m) return m[1];
			}
			if (ld === "mageia") {
				const m = lr.match(/mga(\d+)/);
				if (m) return m[1];
			}
			if (ld === "armbian") {
				const m = lr.match(/armbian(\d+)/);
				if (m) return m[1];
			}
			if (ld === "dietpi") {
				const m = lr.match(/dietpi(\d+)/);
				if (m) return m[1];
			}
			if (ld.includes("libreelec")) {
				const m = lr.match(/libreelec(\d+)/);
				if (m) return m[1];
			}
			if (ld.includes("coreelec")) {
				const m = lr.match(/coreelec(\d+)/);
				if (m) return m[1];
			}
			return null;
		};
		let hostName = null;
		try {
			const raw = readFileSync$1("/proc/version", "utf8").trim();
			const vm = raw.match(/^Linux version\s+(\S+)/);
			if (vm) {
				const releaseNameMatch = vm[1].toLowerCase().match(/(armbian|dietpi|libreelec|coreelec)/);
				if (releaseNameMatch) hostName = {
					armbian: "Armbian",
					dietpi: "DietPi",
					libreelec: "LibreELEC",
					coreelec: "CoreELEC"
				}[releaseNameMatch[1]] ?? releaseNameMatch[1];
				else {
					const dm = raw.match(/\b(Debian|Ubuntu|Red Hat|CentOS|Fedora|Alpine|Arch|Gentoo|SUSE|Proxmox|OpenWrt|Deepin|Kylin|openEuler|Anolis|UOS|Linux Mint|Slackware|Manjaro|NixOS|Void|Mageia|Kali|Amazon|Solus|Alibaba|Armbian|DietPi|Raspbian)\b/i);
					hostName = dm ? dm[1] : null;
				}
			}
		} catch {}
		let osReleaseName = null;
		let osReleaseVer = null;
		try {
			for (const f of ["/etc/os-release", "/usr/lib/os-release"]) {
				if (!existsSync$1(f)) continue;
				const raw = readFileSync$1(f, "utf8");
				const get = (k) => {
					return raw.match(new RegExp(`^${k}=("?)(.+?)\\1$`, "m"))?.[2] ?? null;
				};
				const pretty = get("PRETTY_NAME") || get("NAME");
				const ver = get("VERSION_ID");
				if (pretty) {
					const nm = pretty.match(/^([^0-9]+)/);
					osReleaseName = nm ? nm[1].trim() : pretty;
					osReleaseVer = ver;
					break;
				}
			}
		} catch {}
		let finalName;
		let finalVer;
		if (hostName && osReleaseName) {
			const a = hostName.toLowerCase();
			const b = osReleaseName.toLowerCase();
			if (a.includes(b) || b.includes(a) || isRhelFamily(a) && isRhelFamily(b)) {
				finalName = osReleaseName;
				finalVer = kernelDistroVer(hostName) ?? osReleaseVer;
			} else {
				finalName = hostName;
				finalVer = kernelDistroVer(hostName);
			}
		} else if (hostName) {
			finalName = hostName;
			finalVer = kernelDistroVer(hostName);
		} else if (osReleaseName) {
			finalName = osReleaseName;
			finalVer = kernelDistroVer(osReleaseName) ?? osReleaseVer;
		} else {
			for (const [path, prefix] of [
				["/etc/alpine-release", "Alpine Linux "],
				["/etc/redhat-release", ""],
				["/etc/debian_version", "Debian "]
			]) try {
				if (existsSync$1(path)) {
					const raw = prefix + readFileSync$1(path, "utf8").trim();
					return kernelVer ? `${raw} (kernel ${kernelVer})` : raw;
				}
			} catch {}
			return kernelVer ? `Linux (kernel ${kernelVer})` : "Linux";
		}
		const base = finalVer ? `${finalName} ${finalVer}` : finalName;
		return kernelVer ? `${base} (kernel ${kernelVer})` : base;
	}
	if (os.platform() === "win32") {
		try {
			const m = execSync("reg query \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\" /v ProductName", {
				encoding: "utf8",
				timeout: 3e3,
				stdio: "pipe"
			}).match(/ProductName\s+REG_SZ\s+(.+)/);
			let name = m ? m[1].trim() : `Windows ${os.release()}`;
			try {
				const bm = execSync("reg query \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\" /v CurrentBuildNumber", {
					encoding: "utf8",
					timeout: 3e3,
					stdio: "pipe"
				}).match(/CurrentBuildNumber\s+REG_SZ\s+(\d+)/);
				if (bm && parseInt(bm[1], 10) >= 22e3) name = name.replace(/^Windows 10/, "Windows 11");
			} catch {}
			return name;
		} catch {}
		return `Windows ${os.release()}`;
	}
	return os.platform();
}
function normalizeArch(arch) {
	return {
		loong64: "LoongArch",
		riscv64: "RISC-V",
		mips: "MIPS",
		mipsel: "MIPS (LE)",
		arm: "ARM",
		arm64: "ARM64",
		x64: "x86_64",
		ia32: "x86",
		s390: "S/390",
		s390x: "S/390x",
		ppc: "PowerPC",
		ppc64: "PowerPC64",
		ppc64le: "PowerPC64 (LE)"
	}[arch] ?? arch;
}
var CACHED_DISTRO = (() => {
	try {
		return detectDistro();
	} catch {
		return os.platform();
	}
})();
var CACHED_ARCH_LABEL = normalizeArch(os.arch());
async function initWebUI(desiredPort = 5099, oneBotManager, hookManager, notificationManager, listener = {}) {
	const webuiTarget = resolveWebuiTarget(process.env.SNOWLUMA_WEBUI_TARGET);
	if (webuiTarget) log$3.info("presentation target enabled: %s (runtime override; saved appearance is preserved)", webuiTarget);
	const host = listener.host || "127.0.0.1";
	const bootCheck = checkListenerExposure({
		webuiHost: host,
		tlsEnabled: listener.tlsEnabled === true,
		pairOk: resolveTlsContext("config").ok
	});
	if (!bootCheck.ok) {
		const reason = bootCheck.code === "invalid-bind-host" ? `bind host is not a valid TCP address: ${host}` : "TLS is enabled but the certificate/private-key pair is unusable";
		throw new Error(`WebUI listener cannot start: ${reason}`);
	}
	const trustProxyMode = parseTrustProxy(listener.trustProxy);
	const getClientIp = makeClientIpResolver(trustProxyMode);
	const getSecurityClientIp = makeClientIpResolver(trustProxyMode, "");
	let boundPort = desiredPort;
	const auth = WebuiAuth.load();
	const initialPassword = auth.takeInitialPassword();
	if (auth.isDevMode()) {
		log$3.warn("dev mode enabled with the configured development credential");
		log$3.warn("dev mode skips config/webui.json and password rotation");
	} else if (initialPassword) {
		log$3.info("════════════════════════════════════════════════════════════════");
		log$3.info("  ★ WebUI 初始登录凭据 / Initial WebUI Credentials ★");
		log$3.info("  请立即登录并修改密码 —— 关闭程序后此密码无法找回。");
		log$3.info("  若跳过初始改密，下次启动将自动生成新的随机密码。");
		log$3.info("  Log in and change the password now; it will not be shown again.");
		log$3.info("────────────────────────────────────────────────────────────────");
		logInitialWebuiCredentials(initialPassword);
		log$3.info("════════════════════════════════════════════════════════════════");
	} else if (auth.mustChangePassword()) log$3.warn("password change is still required");
	log$3.info("login rate-limit keyed by: %s", describeTrustProxy(trustProxyMode));
	if (trustProxyMode.kind === "all") log$3.warn("SNOWLUMA_WEBUI_TRUST_PROXY=1 — only safe behind a reverse proxy that strips client-set X-Real-IP / X-Forwarded-For");
	const environmentConsent = resolveEnvironmentConsent();
	let consentGatePending = isConsentRequired();
	if (environmentConsent.accepted) log$3.info("EULA/PRIVACY consent supplied by %s and %s (agreements version=%s)", EULA_ACCEPT_ENV, PRIVACY_ACCEPT_ENV, loadAgreements().version);
	else if (environmentConsent.eulaAccepted || environmentConsent.privacyAccepted) log$3.warn("partial environment consent ignored; set both %s=1 and %s=1 to accept the agreements", EULA_ACCEPT_ENV, PRIVACY_ACCEPT_ENV);
	else if (consentGatePending) log$3.info("awaiting EULA/PRIVACY consent before the panel unlocks");
	const app = new Hono();
	const shutdownStreams = new AbortController();
	const sseResponse$1 = (c, start) => sseResponse(c.req.raw.signal, start, shutdownStreams.signal);
	app.use("*", webuiSecurityHeaders);
	registerLoginRequestSecurity(app);
	const storageManagement = new StorageManagementService({
		dataDir: "data",
		getLogStatus: getLogStorageStatus,
		clearLogs: clearManagedLogs,
		temporary: {
			snapshot: snapshotStreamStorage,
			clearInactive: clearInactiveStreamStorage
		},
		listOnlineAccounts: () => oneBotManager.getConnectionStatuses().map((account) => ({
			uin: account.uin,
			nickname: account.nickname
		}))
	});
	const logStorageSettings = new LogStorageSettingsManager({
		readPersisted: readRuntimeConfig,
		readEnvOverrides: () => resolveRuntimeEnvOverrides(process.env),
		readEffective: getLogStorageStatus,
		persist: updateRuntimeConfig,
		apply: configureFileTransport
	});
	app.use("*", async (c, next) => {
		await next();
		c.res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
	});
	app.get("/robots.txt", (c) => {
		c.res.headers.set("Content-Type", "text/plain; charset=utf-8");
		return c.body("User-agent: *\nDisallow: /\n");
	});
	app.use("/api/*", async (c, next) => {
		const reqPath = c.req.path;
		if (reqPath === "/api/login" || reqPath === "/api/ui/public") return next();
		const token = extractWebuiSessionToken(c.req.raw);
		if (!token) return c.json({
			status: "failed",
			message: "Unauthorized"
		}, 401);
		const info = sessionTokens.get(token);
		if (!info || Date.now() > info.expiresAt) return c.json({
			status: "failed",
			message: "Token expired or invalid"
		}, 401);
		if (consentGatePending && !CONSENT_ALLOWLIST.has(reqPath)) return c.json({
			status: "failed",
			message: "请先阅读并同意用户协议与隐私政策",
			consentRequired: true
		}, 403);
		if (info.mustChangePassword && !MUST_CHANGE_ALLOWLIST.has(reqPath)) return c.json({
			status: "failed",
			message: "请先修改密码",
			mustChangePassword: true
		}, 403);
		c.set("sessionToken", token);
		c.res = await traceAuthenticatedWebuiMutation(c.req.raw, async () => {
			await next();
			return c.res;
		});
	});
	app.post("/api/login", async (c) => {
		const ip = getClientIp(c);
		const now = Date.now();
		const attempt = loginAttempts.get(ip);
		if (attempt && attempt.count >= LOGIN_MAX_ATTEMPTS && now < attempt.resetAt) {
			const waitSec = Math.ceil((attempt.resetAt - now) / 1e3);
			return c.json({
				success: false,
				message: `登录尝试过多，请 ${waitSec} 秒后重试`
			}, 429);
		}
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		const result = completeWebuiLogin(auth, body, now);
		if (result.kind === "bad-request") return c.json({
			success: false,
			message: "请求格式错误"
		}, 400);
		if (result.kind === "bad-password" || result.kind === "bad-second-factor") {
			const current = loginAttempts.get(ip) ?? {
				count: 0,
				resetAt: now + LOGIN_LOCKOUT_MS
			};
			current.count += 1;
			if (current.count === 1) current.resetAt = now + LOGIN_LOCKOUT_MS;
			loginAttempts.set(ip, current);
			const message = result.kind === "bad-second-factor" ? "验证码不正确" : "密码错误";
			return c.json({
				success: false,
				message
			}, 401);
		}
		if (result.kind === "needs-totp") return c.json({
			success: false,
			needsTotp: true
		});
		loginAttempts.delete(ip);
		if (result.totpState) try {
			auth.persistTotp(result.totpState);
		} catch (err) {
			log$3.warn("persist totp after login failed: %s", err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "登录失败"
			}, 500);
		}
		const token = randomBytes$1(32).toString("hex");
		sessionTokens.set(token, {
			expiresAt: now + TOKEN_TTL_MS,
			mustChangePassword: result.mustChangePassword
		});
		setAvatarSessionCookie(c, token, listener.tlsEnabled === true);
		return c.json({
			success: true,
			token,
			mustChangePassword: result.mustChangePassword
		});
	});
	app.post("/api/logout", (c) => {
		const token = c.get("sessionToken");
		if (token) sessionTokens.delete(token);
		clearAvatarSessionCookie(c, listener.tlsEnabled === true);
		return c.json({ success: true });
	});
	app.get("/api/auth/state", (c) => {
		const token = c.get("sessionToken");
		const info = token ? sessionTokens.get(token) : void 0;
		return c.json({ mustChangePassword: info?.mustChangePassword ?? auth.mustChangePassword() });
	});
	app.post("/api/auth/check-strength", async (c) => {
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				rules: evaluatePasswordRules(""),
				valid: false
			});
		}
		const pwd = typeof body.password === "string" ? body.password : "";
		return c.json({
			rules: evaluatePasswordRules(pwd),
			valid: isStrongPassword(pwd)
		});
	});
	app.post("/api/auth/change-password", async (c) => {
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		const oldPassword = typeof body.oldPassword === "string" ? body.oldPassword : "";
		const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
		if (!auth.verify(oldPassword)) return c.json({
			success: false,
			message: "当前密码不正确"
		}, 401);
		if (!isStrongPassword(newPassword)) return c.json({
			success: false,
			message: "新密码不符合强度要求",
			rules: evaluatePasswordRules(newPassword)
		}, 400);
		if (oldPassword === newPassword) return c.json({
			success: false,
			message: "新密码不得与旧密码相同"
		}, 400);
		try {
			auth.setPassword(newPassword, oldPassword);
		} catch (err) {
			log$3.warn("change password failed: %s", err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "密码修改失败"
			}, 400);
		}
		sessionTokens.clear();
		clearAvatarSessionCookie(c, listener.tlsEnabled === true);
		log$3.info("password updated; all sessions invalidated");
		return c.json({
			success: true,
			requireRelogin: true
		});
	});
	const totpDisabledInDev = () => auth.isDevMode();
	app.get("/api/auth/totp", (c) => {
		if (totpDisabledInDev()) return c.json({
			success: false,
			message: "开发模式已禁用 2FA"
		}, 400);
		return c.json(auth.totpStatus());
	});
	app.post("/api/auth/totp/begin", async (c) => {
		if (totpDisabledInDev()) return c.json({
			success: false,
			message: "开发模式已禁用 2FA"
		}, 400);
		if (auth.totpEnabled()) return c.json({
			success: false,
			message: "2FA 已开启"
		}, 409);
		const token = c.get("sessionToken");
		let body = {};
		try {
			const parsed = await c.req.json();
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
		} catch {
			body = {};
		}
		const issuer = sanitizeTotpLabelPart(body.issuer, DEFAULT_TOTP_ISSUER);
		const accountName = sanitizeTotpLabelPart(body.accountName, defaultTotpAccountName());
		const now = Date.now();
		const existing = totpEnrollments.get(token);
		const enrollment = beginTotpEnrollment({
			issuer,
			accountName,
			secret: existing && existing.expiresAt > now ? existing.secret : void 0
		});
		totpEnrollments.set(token, {
			secret: enrollment.secret,
			issuer,
			accountName,
			expiresAt: now + TOTP_ENROLL_TTL_MS
		});
		return c.json({
			success: true,
			secret: enrollment.secret,
			otpauthUrl: enrollment.otpauthUrl,
			issuer: enrollment.issuer,
			accountName: enrollment.accountName
		});
	});
	app.post("/api/auth/totp/confirm", async (c) => {
		if (totpDisabledInDev()) return c.json({
			success: false,
			message: "开发模式已禁用 2FA"
		}, 400);
		if (auth.totpEnabled()) return c.json({
			success: false,
			message: "2FA 已开启"
		}, 409);
		const token = c.get("sessionToken");
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		const password = typeof body.password === "string" ? body.password : "";
		const code = typeof body.code === "string" ? body.code : "";
		if (!auth.verify(password)) return c.json({
			success: false,
			message: "当前密码不正确"
		}, 401);
		const pending = totpEnrollments.get(token);
		if (!pending || pending.expiresAt <= Date.now()) {
			totpEnrollments.delete(token);
			return c.json({
				success: false,
				message: "请先开始绑定"
			}, 400);
		}
		try {
			const enabled = confirmTotpEnrollment({
				password,
				secret: pending.secret,
				code,
				label: `${pending.issuer} (${pending.accountName})`,
				atMs: Date.now()
			});
			auth.persistTotp(enabled.state);
			totpEnrollments.delete(token);
			invalidateOtherSessions(sessionTokens, token);
			log$3.info("webui 2FA enabled; other sessions invalidated");
			return c.json({
				success: true,
				recoveryCodes: enabled.recoveryCodes
			});
		} catch (err) {
			log$3.warn("totp confirm failed: %s", err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "验证码不正确"
			}, 401);
		}
	});
	app.post("/api/auth/totp/disable", async (c) => {
		if (totpDisabledInDev()) return c.json({
			success: false,
			message: "开发模式已禁用 2FA"
		}, 400);
		if (!auth.totpEnabled()) return c.json({
			success: false,
			message: "2FA 未开启"
		}, 400);
		const token = c.get("sessionToken");
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		const password = typeof body.password === "string" ? body.password : "";
		if (!auth.verify(password)) return c.json({
			success: false,
			message: "当前密码不正确"
		}, 401);
		if (decideSecondFactorLogin({
			totpEnabled: true,
			state: auth.totpState(),
			password,
			totp: typeof body.totp === "string" ? body.totp : void 0,
			recoveryCode: typeof body.recoveryCode === "string" ? body.recoveryCode : void 0,
			atMs: Date.now()
		}).kind !== "ok") return c.json({
			success: false,
			message: "验证码不正确"
		}, 401);
		auth.persistTotp(void 0);
		totpEnrollments.delete(token);
		invalidateOtherSessions(sessionTokens, token);
		log$3.info("webui 2FA disabled; other sessions invalidated");
		return c.json({ success: true });
	});
	app.post("/api/auth/totp/recovery-codes", async (c) => {
		if (totpDisabledInDev()) return c.json({
			success: false,
			message: "开发模式已禁用 2FA"
		}, 400);
		const state = auth.totpState();
		if (!state) return c.json({
			success: false,
			message: "2FA 未开启"
		}, 400);
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		const password = typeof body.password === "string" ? body.password : "";
		const totp = typeof body.totp === "string" ? body.totp : "";
		if (!auth.verify(password)) return c.json({
			success: false,
			message: "当前密码不正确"
		}, 401);
		try {
			const next = regenerateRecoveryCodes({
				password,
				state,
				totp,
				atMs: Date.now()
			});
			auth.persistTotp(next.state);
			log$3.info("webui 2FA recovery codes regenerated");
			return c.json({
				success: true,
				recoveryCodes: next.recoveryCodes
			});
		} catch (err) {
			log$3.warn("totp recovery regenerate failed: %s", err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "验证码不正确"
			}, 401);
		}
	});
	app.get("/api/agreements", (c) => c.json(getAgreementsPayload()));
	app.post("/api/agreements/record-consent", async (c) => {
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		const version = typeof body.version === "string" ? body.version : "";
		const current = loadAgreements().version;
		if (!version || version !== current) return c.json({
			success: false,
			message: "协议版本已更新，请刷新后重新确认",
			currentVersion: current
		}, 409);
		try {
			recordConsent(version);
		} catch (err) {
			log$3.warn("record consent failed: %s", err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "保存失败，请检查服务器日志"
			}, 500);
		}
		consentGatePending = false;
		log$3.info("agreements consent recorded (version=%s)", version);
		return c.json({
			success: true,
			version
		});
	});
	app.get("/avatar/:uin", async (c) => {
		const sessionToken = readAvatarSessionToken(c);
		const session = sessionTokens.get(sessionToken);
		if (!session || Date.now() > session.expiresAt) {
			if (sessionToken) sessionTokens.delete(sessionToken);
			return c.text("unauthorized", 401);
		}
		const uin = c.req.param("uin");
		if (!UIN_REGEX.test(uin)) return c.text("invalid uin", 400);
		const now = Date.now();
		let cached = avatarCache.get(uin);
		if (!cached || cached.expiresAt <= now) try {
			cached = {
				...await fetchQqAvatar(uin),
				expiresAt: now + AVATAR_CACHE_TTL_MS
			};
			avatarCache.set(uin, cached);
		} catch (err) {
			log$3.warn("failed to proxy avatar for UIN %s: %s", uin, err instanceof Error ? err.message : String(err));
			if (!cached) return c.text("avatar unavailable", 502);
		}
		return new Response(cached.body, { headers: {
			"Content-Type": cached.contentType,
			"Cache-Control": `private, max-age=${AVATAR_BROWSER_CACHE_SECONDS}, immutable`,
			Vary: "Cookie"
		} });
	});
	app.get("/ui-asset/background", (c) => {
		const asset = readBackgroundImage();
		if (!asset) return c.text("no background", 404);
		return new Response(new Uint8Array(asset.bytes), { headers: {
			"Content-Type": asset.mime,
			"Cache-Control": "public, max-age=31536000, immutable",
			"X-Content-Type-Options": "nosniff"
		} });
	});
	app.get("/api/status", (c) => {
		setAvatarSessionCookie(c, c.get("sessionToken"), listener.tlsEnabled === true);
		return c.json({ status: "running" });
	});
	const updater = await createUpdateService(listener.restart ? listener.updateRoot : void 0, APP_VERSION);
	app.route("/api/update", updateRoutes(updater, () => listener.restart?.()));
	app.get("/api/update/check", async (c) => {
		const force = c.req.query("force") === "true" || c.req.query("force") === "1";
		return c.json(await getUpdateInfo(force));
	});
	let lastCpuTimes = null;
	function sampleCpuLoad() {
		const current = os.cpus().map((cpu) => {
			const t = cpu.times;
			const total = t.user + t.nice + t.sys + t.idle + t.irq;
			return {
				idle: t.idle,
				total
			};
		});
		if (!lastCpuTimes || lastCpuTimes.length !== current.length) {
			lastCpuTimes = current;
			return current.map(() => 0);
		}
		const usage = current.map((cur, i) => {
			const prev = lastCpuTimes[i];
			const totalDiff = cur.total - prev.total;
			const idleDiff = cur.idle - prev.idle;
			if (totalDiff <= 0) return 0;
			return Math.max(0, Math.min(100, (totalDiff - idleDiff) / totalDiff * 100));
		});
		lastCpuTimes = current;
		return usage;
	}
	app.get("/api/system", async (c) => {
		const cpus = os.cpus();
		const usage = sampleCpuLoad();
		const totalMem = os.totalmem();
		const freeMem = os.freemem();
		const usedMem = totalMem - freeMem;
		const runtimeMemory = process.memoryUsage();
		return c.json({
			hostname: os.hostname(),
			platform: os.platform(),
			arch: os.arch(),
			archLabel: CACHED_ARCH_LABEL,
			release: os.release(),
			distro: CACHED_DISTRO,
			uptime: os.uptime(),
			processUptime: process.uptime(),
			nodeVersion: process.version,
			cpu: {
				model: cpus[0]?.model ?? "unknown",
				cores: cpus.length,
				speedMHz: cpus[0]?.speed ?? 0,
				loadAvg: os.loadavg(),
				perCore: usage,
				average: usage.length ? usage.reduce((s, v) => s + v, 0) / usage.length : 0
			},
			memory: {
				total: totalMem,
				free: freeMem,
				used: usedMem,
				usagePercent: totalMem ? usedMem / totalMem * 100 : 0
			},
			runtime: {
				pid: process.pid,
				lowIntegrity: hasLowProcessIntegrity(await getRuntimeIntegrity()),
				rss: runtimeMemory.rss,
				heapTotal: runtimeMemory.heapTotal,
				heapUsed: runtimeMemory.heapUsed,
				external: runtimeMemory.external,
				arrayBuffers: runtimeMemory.arrayBuffers
			}
		});
	});
	const SYSTEM_CERT_PATH = path$1.join("config", "cert.pem");
	const SYSTEM_KEY_PATH = path$1.join("config", "key.pem");
	const hasCert = () => existsSync$1(SYSTEM_CERT_PATH) && existsSync$1(SYSTEM_KEY_PATH);
	app.get("/api/system/settings", (c) => {
		const disk = readRuntimeConfig();
		const envOverrides = Object.keys(resolveRuntimeEnvOverrides(process.env));
		return c.json({
			settings: {
				webuiPort: disk.webuiPort,
				webuiHost: disk.webuiHost,
				tlsEnabled: disk.webuiTls?.enabled ?? false,
				trustProxy: disk.trustProxy ?? ""
			},
			hasCert: hasCert(),
			envOverrides,
			listeningPort: boundPort,
			restartRequiredToApply: true
		});
	});
	app.post("/api/system/settings", async (c) => {
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		const coerced = coerceSettingsPatch(body);
		if (!coerced.ok) return c.json({
			success: false,
			message: coerced.error
		}, 400);
		const evaluated = evaluateSettingsSave(readRuntimeConfig(), coerced.patch, resolveTlsContext("config").ok);
		if (!evaluated.ok) return c.json({
			success: false,
			message: evaluated.error
		}, 400);
		const saved = updateRuntimeConfig(evaluated.patch);
		return c.json({
			success: true,
			settings: {
				webuiPort: saved.webuiPort,
				webuiHost: saved.webuiHost,
				tlsEnabled: saved.webuiTls?.enabled ?? false,
				trustProxy: saved.trustProxy ?? ""
			},
			restartRequiredToApply: true
		});
	});
	registerStorageRoutes(app, {
		storage: storageManagement,
		settings: logStorageSettings,
		audit: (event) => {
			log$3.info("storage cleanup scope=%s accountScope=%s category=%s uin=%s deletedFiles=%d freedBytes=%d failures=%d", event.scope, event.accountScope, event.category ?? "-", event.uin ?? "-", event.deletedFiles, event.freedBytes, event.failureCount);
		},
		reportError: (operation, error) => {
			log$3.error("%s failed: %s", operation, error instanceof Error ? error.stack ?? error.message : String(error));
		}
	});
	app.post("/api/system/tls/cert", async (c) => {
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		const cert = body.cert;
		const key = body.key;
		if (typeof cert !== "string" || typeof key !== "string") return c.json({
			success: false,
			message: "cert 和 key 必须为 PEM 字符串"
		}, 400);
		const valid = validateTlsPair(cert, key);
		if (!valid.ok) return c.json({
			success: false,
			message: valid.reason
		}, 400);
		try {
			mkdirSync("config", { recursive: true });
			writeFileSync(SYSTEM_CERT_PATH, cert.endsWith("\n") ? cert : cert + "\n", "utf8");
			writeFileSync(SYSTEM_KEY_PATH, key.endsWith("\n") ? key : key + "\n", {
				encoding: "utf8",
				mode: 384
			});
			try {
				chmodSync(SYSTEM_KEY_PATH, 384);
			} catch {}
		} catch (err) {
			log$3.warn("write cert/key failed: %s", err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "写入证书失败，请检查服务器日志"
			}, 500);
		}
		return c.json({
			success: true,
			restartRequiredToApply: true
		});
	});
	app.delete("/api/system/tls/cert", (c) => {
		if (tlsCertDeletionBlocked(readRuntimeConfig().webuiTls?.enabled === true)) return c.json({
			success: false,
			message: "请先关闭 TLS 再删除证书"
		}, 400);
		try {
			rmSync(SYSTEM_CERT_PATH, { force: true });
			rmSync(SYSTEM_KEY_PATH, { force: true });
		} catch (err) {
			log$3.warn("remove cert/key failed: %s", err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "删除证书失败"
			}, 500);
		}
		return c.json({ success: true });
	});
	app.get("/api/system/backup/export", (c) => {
		try {
			const includeCredentials = c.req.query("credentials") === "1";
			const ts = (/* @__PURE__ */ new Date()).toISOString();
			const bundle = buildBackup((name) => readBackupConfigFile("config", name), listPerUinOneBotConfigFiles("config"), { includeCredentials }, ts);
			c.header("Content-Disposition", `attachment; filename="snowluma-backup-${ts.replace(/[:.]/g, "-")}.json"`);
			c.header("Cache-Control", "no-store, max-age=0");
			c.header("Pragma", "no-cache");
			return c.json(bundle);
		} catch (error) {
			log$3.error("backup export failed: %s", error instanceof Error ? error.stack ?? error.message : String(error));
			return c.json({
				success: false,
				message: "导出失败，请检查服务器日志"
			}, 500);
		}
	});
	app.post("/api/system/backup/import", async (c) => {
		const declaredLen = Number(c.req.header("content-length"));
		if (Number.isFinite(declaredLen) && declaredLen > 32 * 1024 * 1024) return c.json({
			success: false,
			message: "备份文件过大"
		}, 413);
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		if (typeof body !== "object" || body === null) return c.json({
			success: false,
			message: "请求格式错误"
		}, 400);
		const { backup, restoreCredentials } = body;
		try {
			const result = restoreBackup(backup, {
				configDir: "config",
				restoreCredentials: restoreCredentials === true
			});
			return c.json({
				success: true,
				...result
			});
		} catch (err) {
			if (err instanceof RestoreTransactionError) {
				const failure = describeRestoreFailure(err);
				return c.json(failure.body, failure.status);
			}
			log$3.error("backup import failed unexpectedly: %s", err instanceof Error ? err.stack ?? err.message : String(err));
			return c.json({
				success: false,
				message: "恢复遇到未预期错误，请检查服务器日志"
			}, 500);
		}
	});
	app.get("/api/debug/actions", (c) => c.json({
		actions: collectActionDocs(),
		categories: collectCategories()
	}));
	app.post("/api/debug/invoke", async (c) => {
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				status: "failed",
				message: "请求格式错误"
			}, 400);
		}
		const { uin, action, params } = body ?? {};
		if (typeof uin !== "string" || !UIN_REGEX.test(uin)) return c.json({
			status: "failed",
			message: "无效的账号"
		}, 400);
		if (typeof action !== "string" || !action) return c.json({
			status: "failed",
			message: "action 必填"
		}, 400);
		if (params !== void 0 && (typeof params !== "object" || params === null || Array.isArray(params))) return c.json({
			status: "failed",
			message: "params 必须是对象"
		}, 400);
		const inst = oneBotManager.getInstance(uin);
		if (!inst) return c.json({
			status: "failed",
			message: "账号不在线"
		}, 404);
		const result = await inst.invokeAction(action, params ?? {});
		return c.json(result);
	});
	app.post("/api/debug/invoke-stream", async (c) => {
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				status: "failed",
				message: "请求格式错误"
			}, 400);
		}
		const { uin, action, params } = body ?? {};
		if (typeof uin !== "string" || !UIN_REGEX.test(uin)) return c.json({
			status: "failed",
			message: "无效的账号"
		}, 400);
		if (typeof action !== "string" || !action) return c.json({
			status: "failed",
			message: "action 必填"
		}, 400);
		if (params !== void 0 && (typeof params !== "object" || params === null || Array.isArray(params))) return c.json({
			status: "failed",
			message: "params 必须是对象"
		}, 400);
		const inst = oneBotManager.getInstance(uin);
		if (!inst) return c.json({
			status: "failed",
			message: "账号不在线"
		}, 404);
		return buildStreamInvokeResponse((rq, emit, alive) => inst.invokeStream(rq, emit, alive), JSON.stringify({
			action,
			params: params ?? {}
		}), AbortSignal.any([c.req.raw.signal, shutdownStreams.signal]));
	});
	app.post("/api/debug/upload", async (c) => {
		try {
			const result = await streamUploadToDisk(c.req.raw.body, c.req.query("filename"));
			return c.json({
				status: "ok",
				path: result.path,
				size: result.size
			});
		} catch (err) {
			return c.json({
				status: "failed",
				message: err instanceof Error ? err.message : "上传失败"
			}, 400);
		}
	});
	app.get("/api/debug/stream", (c) => sseResponse$1(c, (ch) => {
		const pushFrame = createFramePusher({
			desiredSize: ch.desiredSize,
			enqueue: ch.raw,
			encode: ch.encode
		});
		const send = (payload) => {
			if (!ch.isClosed()) pushFrame(payload);
		};
		send({ kind: "ready" });
		for (const inst of oneBotManager.getInstances()) {
			const uin = inst.uin;
			ch.onClose(inst.subscribeDebugEvents((event) => send({
				kind: "event",
				uin,
				event
			})));
			ch.onClose(inst.observeActions((rec) => send({
				kind: "action",
				uin,
				...rec
			})));
		}
	}));
	app.get("/api/qq-list", (c) => {
		const list = oneBotManager.getInstances().map((inst) => ({
			uin: inst.uin,
			nickname: inst.nickname
		}));
		return c.json({ list });
	});
	app.get("/api/connections", (c) => {
		return c.json({ list: oneBotManager.getConnectionStatuses() });
	});
	const stateBus = listener.stateBus;
	const subscribeConnections = stateBus && createConnectionPoller({
		bus: stateBus,
		getSnapshot: () => oneBotManager.getConnectionStatuses(),
		pickComparable: comparableConnectionSnapshot
	});
	app.get("/api/state/stream", (c) => {
		if (!stateBus || !subscribeConnections) return c.text("state stream not configured", 503);
		const liveBus = stateBus;
		return sseResponse$1(c, (ch) => {
			ch.onClose(subscribeConnections());
			const pushFrame = createFramePusher({
				desiredSize: ch.desiredSize,
				enqueue: ch.raw,
				encode: ch.encode
			});
			const send = (payload) => {
				if (!ch.isClosed()) pushFrame(payload);
			};
			send({ kind: "ready" });
			const handle = bindStateStream({
				bus: liveBus,
				snapshot: async (resource) => {
					if (resource === "processes") {
						if (!hookManager) return [];
						return hookManager.listProcesses();
					}
					if (resource === "qq-list") return oneBotManager.getInstances().map((inst) => ({
						uin: inst.uin,
						nickname: inst.nickname
					}));
					return oneBotManager.getConnectionStatuses();
				},
				send: (frame) => send(frame),
				debounceMs: 50
			});
			ch.onClose(() => handle.dispose());
			handle.sendAllInitial();
		});
	});
	app.get("/api/logs", (c) => {
		const limit = Number(c.req.query("limit") ?? 300);
		return c.json({ list: getRecentLogs(limit) });
	});
	app.get("/api/logs/export/trace", (c) => {
		const exportedAt = (/* @__PURE__ */ new Date()).toISOString();
		const download = buildFullTraceDownload(getLogSnapshot(), {
			version: APP_VERSION,
			operatingSystem: os.platform(),
			architecture: os.arch(),
			nodeVersion: process.version,
			logLevel: getLogLevel(),
			exportedAt
		});
		for (const [name, value] of Object.entries(download.headers)) c.header(name, value);
		return c.body(download.body);
	});
	app.get("/api/logs/level", (c) => {
		return c.json({
			level: getLogLevel(),
			levels: [...LOG_LEVELS$1]
		});
	});
	app.post("/api/logs/level", async (c) => {
		const body = await c.req.json().catch(() => null);
		const next = typeof body?.level === "string" ? body.level : "";
		if (!setLogLevel(next)) return c.json({
			message: `invalid level: ${next}`,
			levels: [...LOG_LEVELS$1]
		}, 400);
		log$3.info("console log level set to %s via WebUI", getLogLevel());
		return c.json({
			level: getLogLevel(),
			levels: [...LOG_LEVELS$1]
		});
	});
	app.get("/api/logs/stream", (c) => sseResponse$1(c, (ch) => {
		ch.send({ type: "ready" });
		ch.onClose(subscribeLogs((entry) => ch.send(entry)));
	}));
	app.get("/api/processes", async (c) => {
		if (!hookManager) return c.json({ list: [] });
		try {
			return c.json({ list: await hookManager.listProcesses() });
		} catch (err) {
			return c.json({
				list: [],
				message: err instanceof Error ? err.message : String(err)
			}, 500);
		}
	});
	const MAX_PID = 4194304;
	function processAction(label, action) {
		return async (c) => {
			if (!hookManager) return c.json({
				success: false,
				message: "hook manager is not available"
			}, 503);
			const pid = Number(c.req.param("pid"));
			if (!Number.isInteger(pid) || pid <= 0 || pid > MAX_PID) return c.json({
				success: false,
				message: "invalid pid"
			}, 400);
			try {
				const processInfo = await action(pid);
				return c.json({
					success: processInfo.status !== "error",
					process: processInfo
				});
			} catch (err) {
				log$3.warn("%s pid=%d failed: %s", label, pid, err instanceof Error ? err.message : String(err));
				return c.json({
					success: false,
					message: "操作失败，请检查服务器日志"
				}, 500);
			}
		};
	}
	app.post("/api/processes/:pid/load", processAction("load", (pid) => hookManager.loadProcess(pid)));
	app.post("/api/processes/:pid/unload", processAction("unload", (pid) => hookManager.unloadProcess(pid)));
	app.post("/api/processes/:pid/refresh", processAction("refresh", (pid) => hookManager.refreshProcess(pid)));
	app.get("/api/config/:uin", (c) => {
		const uin = c.req.param("uin");
		if (!UIN_REGEX.test(uin)) return c.json({ message: "invalid uin" }, 400);
		const config = loadOneBotConfig(uin);
		return c.json({ config });
	});
	app.post("/api/config/:uin", async (c) => {
		const uin = c.req.param("uin");
		if (!UIN_REGEX.test(uin)) return c.json({
			success: false,
			message: "invalid uin"
		}, 400);
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				saved: false,
				applied: false,
				message: "请求格式错误"
			}, 400);
		}
		let nextConfig;
		try {
			assertValidOneBotConfig(body);
			nextConfig = body;
			let previousConfig = null;
			try {
				previousConfig = loadOneBotConfig(uin);
			} catch (err) {
				log$3.warn("could not read prior OneBot config for uin=%s before save: %s", uin, err instanceof Error ? err.message : String(err));
			}
			validateOneBotAccessTokenChanges(previousConfig, nextConfig, {
				clientIp: getSecurityClientIp(c),
				uin
			});
			saveOneBotConfig(uin, nextConfig);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (err instanceof OneBotConfigValidationError || err instanceof OneBotAccessTokenPolicyError) {
				log$3.warn("reject invalid config for uin=%s: %s", uin, message);
				return c.json({
					success: false,
					saved: false,
					applied: false,
					message
				}, 400);
			}
			log$3.error("persist config for uin=%s failed: %s", uin, message);
			return c.json({
				success: false,
				saved: false,
				applied: false,
				message: "配置保存失败，请检查服务器日志"
			}, 500);
		}
		try {
			const apply = await oneBotManager.reloadConfig(uin, nextConfig);
			const message = !apply.online ? "配置保存成功，当前会话未在线，将在下次连接时生效。" : apply.applied ? "配置保存成功，已热重载当前会话。" : "配置已保存，但部分网络节点未能应用；旧节点已尽力恢复，请查看错误详情。";
			log$3.info("Updated OneBot config for UIN=%s saved=true online=%s applied=%s failures=%d", uin, String(apply.online), String(apply.applied), apply.errors.length);
			return c.json({
				success: true,
				saved: true,
				applied: apply.applied,
				online: apply.online,
				errors: apply.errors,
				adapters: apply.adapters,
				config: body,
				reloaded: apply.online && apply.applied,
				message
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log$3.error("config saved but apply crashed for uin=%s: %s", uin, message);
			return c.json({
				success: true,
				saved: true,
				applied: false,
				online: oneBotManager.getInstance(uin) !== null,
				reloaded: false,
				errors: [{
					name: "network-manager",
					phase: "reload",
					message,
					at: Date.now()
				}],
				config: body,
				message: "配置已保存，但热重载失败，请检查服务器日志。"
			});
		}
	});
	app.get("/api/notifications/config", (c) => c.json({ config: loadNotificationsConfig() }));
	app.post("/api/notifications/config", async (c) => {
		const declaredLen = Number(c.req.header("content-length"));
		if (Number.isFinite(declaredLen) && declaredLen > 512 * 1024) return c.json({
			success: false,
			message: "配置过大"
		}, 413);
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		try {
			const config = saveNotificationsConfig(body);
			return c.json({
				success: true,
				config
			});
		} catch (err) {
			log$3.warn("save notifications config failed: %s", err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "保存失败，请检查服务器日志"
			}, 500);
		}
	});
	app.get("/api/notifications/recent", (c) => {
		if (!notificationManager) return c.json({ recent: [] });
		const limitRaw = Number(c.req.query("limit"));
		const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), 100) : 100;
		return c.json({ recent: notificationManager.getRecent(limit) });
	});
	app.post("/api/notifications/test", async (c) => {
		if (!notificationManager) return c.json({
			success: false,
			message: "通知子系统不可用"
		}, 503);
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		const channelId = typeof body.channelId === "string" ? body.channelId : "";
		if (!channelId) return c.json({
			success: false,
			message: "缺少 channelId"
		}, 400);
		const result = await notificationManager.testSend(channelId);
		if (!result.found) return c.json({
			success: false,
			message: "渠道不存在"
		}, 404);
		return c.json({
			success: result.ok,
			status: result.status,
			message: result.ok ? "测试发送成功" : `测试发送失败：${result.error ?? (result.status ? `HTTP ${result.status}` : "未知错误")}`
		});
	});
	app.get("/api/global-config", (c) => c.json({ config: loadGlobalSettings() }));
	app.post("/api/global-config", async (c) => {
		const declaredLen = Number(c.req.header("content-length"));
		if (Number.isFinite(declaredLen) && declaredLen > 512 * 1024) return c.json({
			success: false,
			message: "配置过大"
		}, 413);
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		try {
			const config = saveGlobalSettings(body);
			oneBotManager.reloadGlobalSettings();
			return c.json({
				success: true,
				config
			});
		} catch (err) {
			log$3.warn("save global config failed: %s", err instanceof Error ? err.message : String(err));
			if (err instanceof RangeError) return c.json({
				success: false,
				message: err.message
			}, 400);
			return c.json({
				success: false,
				message: "保存失败，请检查服务器日志"
			}, 500);
		}
	});
	app.get("/api/ui", (c) => c.json({ config: loadUiConfig() }));
	app.get("/api/ui/public", (c) => c.json({ appearance: publicAppearance() }));
	app.post("/api/ui", async (c) => {
		const declaredLen = Number(c.req.header("content-length"));
		if (Number.isFinite(declaredLen) && declaredLen > 256 * 1024) return c.json({
			success: false,
			message: "配置过大"
		}, 413);
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		try {
			const config = saveUiConfig(body);
			return c.json({
				success: true,
				config
			});
		} catch (err) {
			log$3.warn("save ui.json failed: %s", err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "保存失败，请检查服务器日志"
			}, 400);
		}
	});
	app.post("/api/ui/background", async (c) => {
		const declaredLen = Number(c.req.header("content-length"));
		if (Number.isFinite(declaredLen) && declaredLen > 6291456) return c.json({
			success: false,
			message: "图片过大（上限 5MB）"
		}, 413);
		let file;
		try {
			file = (await c.req.parseBody())["file"];
		} catch {
			return c.json({
				success: false,
				message: "上传解析失败"
			}, 400);
		}
		if (!(file instanceof File)) return c.json({
			success: false,
			message: "缺少图片文件"
		}, 400);
		if (file.size > 5242880) return c.json({
			success: false,
			message: "图片过大（上限 5MB）"
		}, 413);
		const bytes = new Uint8Array(await file.arrayBuffer());
		const mime = sniffImageMime(bytes);
		if (!mime) return c.json({
			success: false,
			message: "仅支持 PNG / JPEG / WebP 图片"
		}, 415);
		try {
			const config = writeBackgroundImage(bytes, mime);
			return c.json({
				success: true,
				config
			});
		} catch (err) {
			log$3.warn("write background image failed: %s", err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "保存图片失败，请检查服务器日志"
			}, 500);
		}
	});
	app.delete("/api/ui/background", (c) => {
		try {
			const config = clearBackgroundImage();
			return c.json({
				success: true,
				config
			});
		} catch (err) {
			log$3.warn("clear background image failed: %s", err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "删除图片失败"
			}, 500);
		}
	});
	registerStaticFrontend(app, path$1.resolve(__dirname, "client"), webuiTarget);
	const finalPort = await findAvailablePort(desiredPort, { host });
	if (finalPort !== desiredPort) log$3.warn("port %d is in use, using %d instead", desiredPort, finalPort);
	boundPort = finalPort;
	let tlsServe;
	let scheme = "http";
	if (listener.tlsEnabled) {
		tlsServe = {
			createServer: createServer$2,
			serverOptions: requireTlsContext("config")
		};
		scheme = "https";
	}
	const listeningServer = await new Promise((resolve) => {
		const server = serve({
			fetch: app.fetch,
			port: finalPort,
			hostname: host,
			...tlsServe ?? {}
		}, (info) => {
			log$3.info(`listening ${scheme}://${host}:${info.port}`);
			resolve(server);
		});
	});
	const tokenJanitor = setInterval(purgeExpiredTokens, 6e4);
	tokenJanitor.unref();
	return {
		port: finalPort,
		async stop() {
			clearInterval(tokenJanitor);
			shutdownStreams.abort();
			await new Promise((resolve, reject) => {
				listeningServer.close((err) => err ? reject(err) : resolve());
			});
		}
	};
}
