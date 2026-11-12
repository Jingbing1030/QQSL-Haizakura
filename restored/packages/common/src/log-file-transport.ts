// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/log-file-transport.ts"
// original bundle lines 411-1174  (762 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function parseNonNegativeInt(value, fallback, max, field) {
	if (value === void 0 || value.trim() === "") return fallback;
	const parsed = Number(value.trim());
	if (Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max) return parsed;
	if (field) throw new RangeError(`${field} must be an integer in 0..${String(max)}`);
	return fallback;
}
function parseRequiredPositiveInt(value, fallback, max, field) {
	if (value === void 0 || value.trim() === "") return fallback;
	const parsed = Number(value.trim());
	if (Number.isSafeInteger(parsed) && parsed > 0 && parsed <= max) return parsed;
	throw new RangeError(`${field} must be an integer in 1..${String(max)}`);
}
function parseRequiredBool(value, fallback, field) {
	if (value === void 0 || value.trim() === "") return fallback;
	const normalized = value.trim().toLowerCase();
	if ([
		"1",
		"true",
		"yes",
		"on"
	].includes(normalized)) return true;
	if ([
		"0",
		"false",
		"no",
		"off"
	].includes(normalized)) return false;
	throw new TypeError(`${field} must be a boolean`);
}
function todayString(d = /* @__PURE__ */ new Date()) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateOf(s) {
	const [y, m, d] = s.split("-").map((v) => Number.parseInt(v, 10));
	return new Date(y, m - 1, d);
}
function listManagedLogFiles(root) {
	const out = [];
	const readDirectory = (dir) => {
		try {
			return fs.readdirSync(dir, { withFileTypes: true });
		} catch (error) {
			if (isMissing$2(error)) return null;
			throw new Error(`failed to read managed log directory ${dir}: ${errorMessage(error)}`, { cause: error });
		}
	};
	const visit = (dir, entries) => {
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			const match = FILE_RE.exec(entry.name);
			if (!match) continue;
			const filePath = path.resolve(dir, entry.name);
			try {
				const stat = fs.statSync(filePath);
				out.push({
					path: filePath,
					bytes: stat.size,
					mtimeMs: stat.mtimeMs,
					date: match[1]
				});
			} catch (error) {
				if (isMissing$2(error)) continue;
				throw new Error(`failed to stat managed log ${filePath}: ${errorMessage(error)}`, { cause: error });
			}
		}
	};
	const rootEntries = readDirectory(root);
	if (!rootEntries) return out;
	visit(root, rootEntries);
	for (const entry of rootEntries) if (entry.isDirectory() && ACCOUNT_DIR_RE.test(entry.name)) {
		const accountDir = path.join(root, entry.name);
		const accountEntries = readDirectory(accountDir);
		if (accountEntries) visit(accountDir, accountEntries);
	}
	return out;
}
function reportStorageError(message) {
	process.stderr.write(`[logger.storage] ${message}\n`);
}
function validatePolicy(policy) {
	if (!Number.isSafeInteger(policy.maxTotalMb) || policy.maxTotalMb <= 0 || policy.maxTotalMb > MAX_LOG_TOTAL_MB) throw new RangeError(`maxTotalMb must be an integer in 1..${String(MAX_LOG_TOTAL_MB)}`);
	if (!Number.isSafeInteger(policy.retainDays) || policy.retainDays < 0 || policy.retainDays > MAX_LOG_RETAIN_DAYS) throw new RangeError(`retainDays must be an integer in 0..${String(MAX_LOG_RETAIN_DAYS)}`);
	if (typeof policy.perUinEnabled !== "boolean") throw new TypeError("perUinEnabled must be a boolean");
}
function getFileTransport() {
	if (!singleton) singleton = new FileTransport(configuredPolicy ?? void 0);
	return singleton;
}
async function configureFileTransport(policy) {
	validatePolicy(policy);
	configuredPolicy = { ...policy };
	if (!singleton) singleton = new FileTransport(configuredPolicy);
	else await singleton.updatePolicy(configuredPolicy);
	return singleton.getStorageStatus();
}
function getLogStorageStatus() {
	return getFileTransport().getStorageStatus();
}
function clearManagedLogs() {
	return getFileTransport().clearManagedLogs();
}
function isMissing$2(error) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
var DEFAULT_DIR, DEFAULT_MAX_MB, DEFAULT_MAX_TOTAL_MB, DEFAULT_RETAIN_DAYS, FILE_PREFIX, FILE_SUFFIX, FILE_RE, ACCOUNT_DIR_RE, QUOTA_RETRY_MS, LogQuota, FileWriter, FileTransport, singleton, configuredPolicy;
var init_log_file_transport = __esmMin((() => {
	init_errors();
	init_log_sanitize();
	init_runtime();
	DEFAULT_DIR = "logs";
	DEFAULT_MAX_MB = 50;
	DEFAULT_MAX_TOTAL_MB = 1024;
	DEFAULT_RETAIN_DAYS = 7;
	FILE_PREFIX = "snowluma-";
	FILE_SUFFIX = ".log";
	FILE_RE = /^snowluma-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/;
	ACCOUNT_DIR_RE = /^\d+$/;
	QUOTA_RETRY_MS = 5e3;
	LogQuota = class {
		root;
		maxTotalBytes;
		retainDays;
		files = /* @__PURE__ */ new Map();
		active = /* @__PURE__ */ new Set();
		usedBytes = 0;
		degraded = false;
		lastError = null;
		nextRetryAt = 0;
		droppedLines = 0;
		maintenanceSuspensions = 0;
		constructor(root, maxTotalBytes, retainDays, maintainOnLoad = true) {
			this.root = root;
			this.maxTotalBytes = maxTotalBytes;
			this.retainDays = retainDays;
			this.loadManagedFiles();
			if (maintainOnLoad) {
				this.cleanupExpired();
				this.ensureCapacity(0);
			}
		}
		activate(filePath) {
			const normalized = path.resolve(filePath);
			const known = this.files.get(normalized);
			if (known) {
				this.active.add(normalized);
				return known.bytes;
			}
			let bytes = 0;
			let mtimeMs = Date.now();
			try {
				const stat = fs.statSync(normalized);
				bytes = stat.size;
				mtimeMs = stat.mtimeMs;
			} catch (error) {
				if (!isMissing$2(error)) {
					this.enterDegraded(`failed to inspect active log ${normalized}: ${errorMessage(error)}`);
					return null;
				}
			}
			const date = FILE_RE.exec(path.basename(normalized))?.[1] ?? todayString();
			this.files.set(normalized, {
				path: normalized,
				bytes,
				mtimeMs,
				date
			});
			this.usedBytes += bytes;
			this.active.add(normalized);
			return bytes;
		}
		deactivate(filePath) {
			this.active.delete(path.resolve(filePath));
			if (this.maintenanceSuspensions > 0) return;
			this.maintainAfterClose();
		}
		suspendMaintenance() {
			this.maintenanceSuspensions += 1;
			let resumed = false;
			return () => {
				if (resumed) return;
				resumed = true;
				this.maintenanceSuspensions = Math.max(0, this.maintenanceSuspensions - 1);
			};
		}
		reserve(filePath, bytes) {
			if (bytes <= 0) return true;
			if (this.degraded && !this.retry(false)) {
				this.droppedLines += 1;
				return false;
			}
			if (!this.ensureCapacity(bytes)) {
				this.droppedLines += 1;
				return false;
			}
			const normalized = path.resolve(filePath);
			const file = this.files.get(normalized);
			if (!file) {
				if (this.activate(normalized) === null) {
					this.droppedLines += 1;
					return false;
				}
				return this.reserve(normalized, bytes);
			}
			file.bytes += bytes;
			file.mtimeMs = Date.now();
			this.usedBytes += bytes;
			return true;
		}
		writeFailed(filePath, error) {
			this.storageFailed(`write ${filePath}`, error);
		}
		storageFailed(operation, error) {
			this.enterDegraded(`${operation}: ${errorMessage(error)}`);
		}
		snapshot() {
			return {
				state: this.degraded ? "degraded" : this.lastError ? "warning" : "healthy",
				totalBytes: this.usedBytes,
				fileCount: this.files.size,
				activeFileCount: this.active.size,
				droppedLines: this.droppedLines,
				...this.lastError ? { lastError: this.lastError } : {}
			};
		}
		updatePolicy(maxTotalBytes, retainDays) {
			this.maxTotalBytes = maxTotalBytes;
			this.retainDays = retainDays;
			this.degraded = false;
			this.lastError = null;
			this.nextRetryAt = 0;
			try {
				this.refreshClosedFiles();
				this.cleanupExpired();
				this.ensureCapacity(0);
			} catch (error) {
				this.enterDegraded(`failed to apply log storage policy: ${errorMessage(error)}`);
				throw error;
			}
		}
		clearClosedFiles() {
			this.refreshClosedFiles();
			let deletedFiles = 0;
			let freedBytes = 0;
			const failures = [];
			const candidates = [...this.files.values()].filter((file) => !this.active.has(file.path)).sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
			for (const file of candidates) {
				const bytes = file.bytes;
				if (this.deleteManagedFile(file, "capacity")) {
					deletedFiles += 1;
					freedBytes += bytes;
				} else failures.push({
					file: path.relative(this.root, file.path),
					message: this.lastError ?? "unknown cleanup error"
				});
			}
			if (failures.length === 0) {
				this.degraded = false;
				this.lastError = null;
				this.nextRetryAt = 0;
			} else if (this.usedBytes > this.maxTotalBytes) this.enterDegraded(`managed logs still use ${String(this.usedBytes)} bytes after manual cleanup, exceeding the ${String(this.maxTotalBytes)} byte limit`);
			this.ensureCapacity(0);
			return {
				deletedFiles,
				freedBytes,
				failures
			};
		}
		retry(force) {
			if (!force && Date.now() < this.nextRetryAt) return false;
			this.degraded = false;
			this.lastError = null;
			try {
				this.refreshClosedFiles();
				const recovered = this.ensureCapacity(0);
				if (recovered) this.nextRetryAt = 0;
				return recovered;
			} catch (error) {
				this.enterDegraded(`failed to refresh managed logs: ${errorMessage(error)}`);
				return false;
			}
		}
		maintainAfterClose() {
			try {
				this.refreshClosedFiles();
				this.cleanupExpired();
				if (this.degraded) this.retry(true);
				else this.ensureCapacity(0);
			} catch (error) {
				this.enterDegraded(`failed to maintain managed logs after rotation: ${errorMessage(error)}`);
			}
		}
		ensureCapacity(incomingBytes) {
			if (this.usedBytes + incomingBytes <= this.maxTotalBytes) return true;
			const candidates = [...this.files.values()].filter((file) => !this.active.has(file.path)).sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
			for (const file of candidates) {
				if (this.usedBytes + incomingBytes <= this.maxTotalBytes) break;
				if (!this.deleteManagedFile(file, "capacity")) break;
			}
			if (this.usedBytes + incomingBytes <= this.maxTotalBytes) return true;
			this.enterDegraded(`managed logs require ${String(this.usedBytes + incomingBytes)} bytes, exceeding the ${String(this.maxTotalBytes)} byte limit; no closed log can be reclaimed`);
			return false;
		}
		enterDegraded(message) {
			const shouldReport = !this.degraded || this.lastError !== message;
			this.degraded = true;
			this.lastError = message;
			this.nextRetryAt = Date.now() + QUOTA_RETRY_MS;
			if (shouldReport) reportStorageError(message);
		}
		cleanupExpired() {
			if (this.retainDays === 0) return;
			const cutoff = Date.now() - this.retainDays * 24 * 60 * 60 * 1e3;
			const expired = [...this.files.values()].filter((file) => !this.active.has(file.path) && dateOf(file.date).getTime() < cutoff).sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
			for (const file of expired) if (!this.deleteManagedFile(file, "retention")) break;
		}
		deleteManagedFile(file, reason) {
			try {
				fs.unlinkSync(file.path);
				this.files.delete(file.path);
				this.usedBytes = Math.max(0, this.usedBytes - file.bytes);
				return true;
			} catch (error) {
				this.lastError = `${reason} cleanup failed for ${file.path}: ${error instanceof Error ? error.message : String(error)}`;
				reportStorageError(this.lastError);
				return false;
			}
		}
		loadManagedFiles() {
			for (const file of listManagedLogFiles(this.root)) {
				this.files.set(file.path, file);
				this.usedBytes += file.bytes;
			}
		}
		/** Refresh only closed files; active stream bytes are tracked in-memory and
		* may be newer than fs.stat while the WriteStream buffer is still flushing. */
		refreshClosedFiles() {
			const disk = new Map(listManagedLogFiles(this.root).map((file) => [file.path, file]));
			for (const [filePath, file] of this.files) {
				if (this.active.has(filePath)) continue;
				const next = disk.get(filePath);
				this.usedBytes -= file.bytes;
				if (next) {
					this.files.set(filePath, next);
					this.usedBytes += next.bytes;
					disk.delete(filePath);
				} else this.files.delete(filePath);
			}
			for (const file of disk.values()) {
				if (this.files.has(file.path)) continue;
				this.files.set(file.path, file);
				this.usedBytes += file.bytes;
			}
		}
	};
	FileWriter = class {
		dir;
		maxBytes;
		quota;
		disabled = false;
		file = null;
		pendingCloses = /* @__PURE__ */ new Set();
		constructor(dir, maxBytes, quota) {
			this.dir = dir;
			this.maxBytes = maxBytes;
			this.quota = quota;
			try {
				fs.mkdirSync(dir, { recursive: true });
			} catch (err) {
				this.disabled = true;
				this.quota.storageFailed(`failed to create log directory ${dir}`, err);
				return;
			}
		}
		get isDisabled() {
			return this.disabled;
		}
		get currentPath() {
			return this.file?.path ?? null;
		}
		async prepare() {
			this.ensureForToday(todayString());
			const stream = this.file?.stream;
			if (!stream) throw new Error(`failed to prepare log writer in ${this.dir}`);
			await new Promise((resolve, reject) => {
				const opened = () => {
					stream.off("error", failed);
					resolve();
				};
				const failed = (error) => {
					stream.off("open", opened);
					reject(error);
				};
				stream.once("open", opened);
				stream.once("error", failed);
			});
		}
		write(data, bytes) {
			if (this.disabled) return false;
			const today = todayString();
			this.ensureForToday(today);
			if (!this.file) return false;
			if (this.file.bytes + bytes > this.maxBytes && this.file.bytes > 0) {
				this.rotateBySize();
				if (!this.file) return false;
			}
			if (!this.quota.reserve(this.file.path, bytes)) return false;
			try {
				this.file.stream.write(data);
			} catch (error) {
				this.disabled = true;
				this.quota.writeFailed(this.file.path, error);
				return false;
			}
			this.file.bytes += bytes;
			return true;
		}
		async close() {
			this.closeCurrent();
			await Promise.all(this.pendingCloses);
		}
		ensureForToday(today) {
			if (this.file && this.file.date === today) return;
			if (this.file) this.closeCurrent();
			let idx = 0;
			while (fs.existsSync(this.pathFor(today, idx + 1))) idx++;
			this.file = this.openFile(today, idx);
		}
		rotateBySize() {
			if (!this.file) return;
			const date = this.file.date;
			const previousIndex = this.file.splitIndex;
			this.closeCurrent();
			let next = previousIndex + 1;
			while (fs.existsSync(this.pathFor(date, next))) next++;
			this.file = this.openFile(date, next);
		}
		closeCurrent() {
			const file = this.file;
			this.file = null;
			if (!file) return;
			let finish;
			const closed = new Promise((resolve) => {
				let settled = false;
				finish = () => {
					if (settled) return;
					settled = true;
					this.quota.deactivate(file.path);
					resolve();
				};
			});
			this.pendingCloses.add(closed);
			closed.finally(() => this.pendingCloses.delete(closed));
			file.stream.once("error", finish);
			try {
				file.stream.end(finish);
			} catch (error) {
				this.quota.writeFailed(file.path, error);
				finish();
			}
		}
		openFile(date, splitIndex) {
			const p = this.pathFor(date, splitIndex);
			const existingBytes = this.quota.activate(p);
			if (existingBytes === null) return null;
			try {
				const stream = fs.createWriteStream(p, { flags: "a" });
				stream.on("error", (err) => {
					this.disabled = true;
					if (this.file?.stream === stream) this.file = null;
					this.quota.deactivate(p);
					this.quota.writeFailed(p, err);
				});
				return {
					stream,
					bytes: existingBytes,
					date,
					splitIndex,
					path: p
				};
			} catch (err) {
				this.disabled = true;
				this.quota.deactivate(p);
				this.quota.storageFailed(`failed to open log file ${p}`, err);
				return null;
			}
		}
		pathFor(date, splitIndex) {
			const tail = splitIndex > 0 ? `.${splitIndex}` : "";
			return path.join(this.dir, `${FILE_PREFIX}${date}${tail}${FILE_SUFFIX}`);
		}
	};
	FileTransport = class {
		dir;
		maxBytes;
		maxTotalBytes;
		retainDays;
		enabled;
		perUinEnabled;
		initializationError = null;
		nextWriterRetryAt = 0;
		quota = null;
		shared = null;
		perUin = /* @__PURE__ */ new Map();
		constructor(policy) {
			if (policy) validatePolicy(policy);
			this.dir = path.resolve(process.env.SNOWLUMA_LOG_DIR || DEFAULT_DIR);
			this.maxBytes = parseRequiredPositiveInt(process.env.SNOWLUMA_LOG_MAX_MB, DEFAULT_MAX_MB, MAX_LOG_TOTAL_MB, "SNOWLUMA_LOG_MAX_MB") * 1024 * 1024;
			this.maxTotalBytes = (policy?.maxTotalMb ?? parseRequiredPositiveInt(process.env.SNOWLUMA_LOG_MAX_TOTAL_MB, DEFAULT_MAX_TOTAL_MB, MAX_LOG_TOTAL_MB, "SNOWLUMA_LOG_MAX_TOTAL_MB")) * 1024 * 1024;
			this.retainDays = policy?.retainDays ?? parseNonNegativeInt(process.env.SNOWLUMA_LOG_RETAIN_DAYS, DEFAULT_RETAIN_DAYS, MAX_LOG_RETAIN_DAYS, "SNOWLUMA_LOG_RETAIN_DAYS");
			this.enabled = process.env.SNOWLUMA_LOG_FILE !== "0";
			this.perUinEnabled = policy?.perUinEnabled ?? parseRequiredBool(process.env.SNOWLUMA_LOG_PER_UIN, false, "SNOWLUMA_LOG_PER_UIN");
			if (this.enabled) this.initialize();
		}
		/** True when no file output will happen (env disable or init failure). */
		get isDisabled() {
			return !this.shared;
		}
		/** Current shared-file path (or null if disabled / not yet opened). */
		get currentPath() {
			return this.shared?.currentPath ?? null;
		}
		/** Path of the per-UIN file for the given UIN, if open. */
		perUinPath(uin) {
			return this.perUin.get(uin)?.currentPath ?? null;
		}
		getStorageStatus() {
			if (!this.quota) return {
				state: "disabled",
				directory: this.dir,
				totalBytes: 0,
				maxTotalBytes: this.maxTotalBytes,
				retainDays: this.retainDays,
				perUinEnabled: this.perUinEnabled,
				fileCount: 0,
				activeFileCount: 0,
				droppedLines: 0,
				...this.initializationError ? { lastError: this.initializationError } : {}
			};
			return {
				...this.quota.snapshot(),
				directory: this.dir,
				maxTotalBytes: this.maxTotalBytes,
				retainDays: this.retainDays,
				perUinEnabled: this.perUinEnabled
			};
		}
		async updatePolicy(policy) {
			validatePolicy(policy);
			this.maxTotalBytes = policy.maxTotalMb * 1024 * 1024;
			this.retainDays = policy.retainDays;
			const disablingPerUin = this.perUinEnabled && !policy.perUinEnabled;
			this.perUinEnabled = policy.perUinEnabled;
			if (disablingPerUin) {
				const writers = [...this.perUin.values()];
				this.perUin.clear();
				await Promise.all(writers.map((writer) => writer.close()));
			}
			if (this.quota) this.quota.updatePolicy(this.maxTotalBytes, this.retainDays);
			if (this.enabled && (!this.quota || !this.shared || this.shared.isDisabled)) await this.recoverSharedWriter(true);
			return this.getStorageStatus();
		}
		async clearManagedLogs() {
			if (!this.enabled) return this.clearLogsWhileDisabled();
			if (!this.quota) try {
				this.quota = new LogQuota(this.dir, this.maxTotalBytes, this.retainDays);
			} catch (error) {
				this.recordWriterRecoveryFailure(error);
			}
			if (!this.quota) return {
				deletedFiles: 0,
				freedBytes: 0,
				failures: this.initializationError ? [{
					file: ".",
					message: this.initializationError
				}] : [],
				status: this.getStorageStatus()
			};
			const quota = this.quota;
			const accountUins = [...this.perUin.keys()];
			const writers = [...this.shared ? [this.shared] : [], ...this.perUin.values()];
			this.shared = null;
			this.perUin.clear();
			const resumeMaintenance = quota.suspendMaintenance();
			try {
				await Promise.all(writers.map((writer) => writer.close()));
			} finally {
				resumeMaintenance();
			}
			const result = quota.clearClosedFiles();
			const shared = new FileWriter(this.dir, this.maxBytes, quota);
			try {
				await shared.prepare();
				this.shared = shared;
				this.initializationError = null;
				this.nextWriterRetryAt = 0;
			} catch (error) {
				this.recordWriterRecoveryFailure(error);
				result.failures.push({
					file: ".",
					message: this.initializationError ?? "failed to reopen the shared log writer"
				});
			}
			if (this.perUinEnabled) for (const uin of accountUins) {
				const writer = new FileWriter(path.join(this.dir, String(uin)), this.maxBytes, quota);
				if (writer.isDisabled) continue;
				try {
					await writer.prepare();
					this.perUin.set(uin, writer);
				} catch (error) {
					quota.storageFailed(`failed to reopen account log writer for ${String(uin)}`, error);
					result.failures.push({
						file: String(uin),
						message: `failed to reopen account log writer: ${errorMessage(error)}`
					});
				}
			}
			return {
				...result,
				status: this.getStorageStatus()
			};
		}
		write(line, uin) {
			if (!this.enabled) return;
			if (!this.shared || this.shared.isDisabled) {
				if (!this.recoverSharedWriterForWrite()) return;
			}
			if (!this.shared) return;
			const data = sanitizeLogLine(line) + "\n";
			const bytes = Buffer.byteLength(data, "utf8");
			if (!this.shared.write(data, bytes)) {
				if (this.shared.isDisabled) {
					this.shared = null;
					this.nextWriterRetryAt = Date.now() + QUOTA_RETRY_MS;
				}
				return;
			}
			if (uin !== void 0 && this.perUinEnabled && this.quota) {
				let w = this.perUin.get(uin);
				if (w?.isDisabled) {
					this.perUin.delete(uin);
					w = void 0;
				}
				if (!w) {
					w = new FileWriter(path.join(this.dir, String(uin)), this.maxBytes, this.quota);
					if (w.isDisabled) return;
					this.perUin.set(uin, w);
				}
				w.write(data, bytes);
			}
		}
		async close() {
			const closes = [];
			if (this.shared) closes.push(this.shared.close());
			for (const w of this.perUin.values()) closes.push(w.close());
			this.shared = null;
			this.perUin.clear();
			await Promise.all(closes);
		}
		async recoverSharedWriter(force) {
			if (!this.enabled) return;
			if (!force && Date.now() < this.nextWriterRetryAt) throw new Error(this.initializationError ?? "log writer retry is rate-limited");
			if (this.shared?.isDisabled) this.shared = null;
			if (!this.quota) this.initialize();
			if (!this.shared && this.quota) {
				const writer = new FileWriter(this.dir, this.maxBytes, this.quota);
				if (!writer.isDisabled) this.shared = writer;
			}
			const writer = this.shared;
			if (!writer) throw new Error(this.initializationError ?? "failed to create the shared log writer");
			try {
				await writer.prepare();
				if (writer.isDisabled || !writer.currentPath) throw new Error("the shared log writer did not open a file");
				this.initializationError = null;
				this.nextWriterRetryAt = 0;
			} catch (error) {
				this.shared = null;
				this.recordWriterRecoveryFailure(error);
				throw error;
			}
		}
		recoverSharedWriterForWrite() {
			if (!this.enabled || Date.now() < this.nextWriterRetryAt) return false;
			if (this.shared?.isDisabled) this.shared = null;
			if (!this.quota) this.initialize();
			if (!this.shared && this.quota) {
				const writer = new FileWriter(this.dir, this.maxBytes, this.quota);
				if (!writer.isDisabled) this.shared = writer;
			}
			if (this.shared) {
				this.initializationError = null;
				this.nextWriterRetryAt = 0;
				return true;
			}
			return false;
		}
		clearLogsWhileDisabled() {
			try {
				const quota = new LogQuota(this.dir, this.maxTotalBytes, this.retainDays, false);
				const result = quota.clearClosedFiles();
				const snapshot = quota.snapshot();
				return {
					...result,
					status: {
						...snapshot,
						state: "disabled",
						directory: this.dir,
						maxTotalBytes: this.maxTotalBytes,
						retainDays: this.retainDays,
						perUinEnabled: this.perUinEnabled
					}
				};
			} catch (error) {
				const message = `failed to clear disabled log storage ${this.dir}: ${errorMessage(error)}`;
				reportStorageError(message);
				return {
					deletedFiles: 0,
					freedBytes: 0,
					failures: [{
						file: ".",
						message
					}],
					status: {
						state: "disabled",
						directory: this.dir,
						totalBytes: 0,
						maxTotalBytes: this.maxTotalBytes,
						retainDays: this.retainDays,
						perUinEnabled: this.perUinEnabled,
						fileCount: 0,
						activeFileCount: 0,
						droppedLines: 0,
						lastError: message
					}
				};
			}
		}
		recordWriterRecoveryFailure(error) {
			this.initializationError = `failed to initialize log storage ${this.dir}: ${errorMessage(error)}`;
			this.nextWriterRetryAt = Date.now() + QUOTA_RETRY_MS;
			reportStorageError(this.initializationError);
		}
		initialize() {
			try {
				fs.mkdirSync(this.dir, { recursive: true });
				const quota = new LogQuota(this.dir, this.maxTotalBytes, this.retainDays);
				const writer = new FileWriter(this.dir, this.maxBytes, quota);
				if (writer.isDisabled) throw new Error(`failed to create shared log writer in ${this.dir}`);
				this.quota = quota;
				this.shared = writer;
				this.initializationError = null;
				this.nextWriterRetryAt = 0;
			} catch (error) {
				this.quota = null;
				this.shared = null;
				this.recordWriterRecoveryFailure(error);
			}
		}
	};
	singleton = null;
	configuredPolicy = null;
}));
export {};
