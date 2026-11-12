// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/logger.ts"
// original bundle lines 1425-1651  (225 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** Trace ring cap — env-tunable since trace is the high-volume stream. */
function resolveTraceBufferMax() {
	const raw = Number.parseInt(process.env.SNOWLUMA_TRACE_BUFFER ?? "", 10);
	return Number.isFinite(raw) && raw >= 100 ? raw : 5e3;
}
function resolveMinLevel() {
	const raw = (process.env.SNOWLUMA_LOG_LEVEL ?? "info").toLowerCase();
	if (raw === "trace" || raw === "debug" || raw === "info" || raw === "success" || raw === "warn" || raw === "error") return raw;
	return "info";
}
function resolveFileMinLevel() {
	const raw = process.env.SNOWLUMA_LOG_FILE_LEVEL;
	if (raw === void 0 || raw.trim() === "") return "debug";
	const normalized = raw.trim().toLowerCase();
	if (normalized === "debug" || normalized === "info" || normalized === "success" || normalized === "warn" || normalized === "error") return normalized;
	throw new TypeError("SNOWLUMA_LOG_FILE_LEVEL must be one of: debug, info, success, warn, error");
}
function shouldLog(level) {
	return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[currentLevel];
}
function shouldLogToFile(level) {
	return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[currentFileLevel];
}
function getLogLevel() {
	return currentLevel;
}
function setLogLevel(level) {
	const lower = String(level).toLowerCase();
	if (!LOG_LEVELS$1.includes(lower)) return false;
	currentLevel = lower;
	return true;
}
function useColor() {
	if (process.env.NO_COLOR === "1") return false;
	return Boolean(process.stdout.isTTY);
}
function ansi(code, text) {
	return `\x1b[${code}m${text}${COLOR_RESET}`;
}
function currentTime() {
	const d = /* @__PURE__ */ new Date();
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
function render(level, options, message, reqId) {
	const ts = currentTime();
	const label = LEVEL_LABEL[level].padEnd(5, " ");
	const uinTag = options.uin !== void 0 ? `[${options.uin}]` : "";
	const uinSlot = uinTag.padEnd(UIN_SLOT_WIDTH);
	const reqTag = reqId !== void 0 ? `[req#${reqId}]` : "";
	if (!useColor()) return `${ts} ${label} ${uinSlot} [${options.scope}] ${reqTag ? `${reqTag} ` : ""}${message}`;
	return `${ansi(COLOR_DIM, ts)} ${ansi(COLOR_CODE[level], label)} ${uinTag ? ansi(COLOR_DIM, uinTag) + " ".repeat(Math.max(0, UIN_SLOT_WIDTH - uinTag.length)) : " ".repeat(UIN_SLOT_WIDTH)} ${ansi(COLOR_SCOPE, `[${options.scope}]`)} ${reqTag ? `${ansi(COLOR_DIM, reqTag)} ` : ""}${message}`;
}
function emit(level, options, args) {
	const passesConsole = shouldLog(level);
	const passesFile = level !== "trace" && shouldLogToFile(level);
	if (!passesConsole && !passesFile) return;
	if (level === "trace" && !passesConsole) return;
	let realArgs = args;
	if (level === "trace" && args.length === 1 && typeof args[0] === "function") realArgs = args[0]();
	const reqId = currentRequestId();
	const formattedMessage = format(...realArgs);
	const message = level === "trace" ? formattedMessage : redactLogMessage(formattedMessage);
	const line = render(level, options, message, reqId);
	const entry = {
		id: nextLogId++,
		time: (/* @__PURE__ */ new Date()).toISOString(),
		level,
		scope: options.scope,
		...options.uin !== void 0 ? { uin: options.uin } : {},
		...reqId !== void 0 ? { req: reqId } : {},
		message,
		line: sanitizeLogLine(line)
	};
	if (passesConsole) {
		(level === "trace" ? traceRing : logRing).push(entry);
		for (const subscriber of logSubscribers) subscriber(entry);
		const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
		const consoleLine = line.replace(/[\x00-\x08\x0B-\x1A\x1C-\x1F\x7F]/g, "") + "\n";
		try {
			stream.write(consoleLine);
		} catch {}
	}
	if (passesFile) getFileTransport().write(line, options.uin);
}
/**
* Flush and close the underlying log file. Call from shutdown hooks
* (SIGINT / SIGTERM / uncaughtException) so the WriteStream's internal
* buffer makes it to disk. Returns a promise that resolves once the OS
* has finalized the write.
*/
function closeLogger() {
	return getFileTransport().close();
}
function mergeLogRings() {
	return traceRing.size > 0 ? [...logRing.toArray(), ...traceRing.toArray()].sort((a, b) => a.id - b.id) : logRing.toArray();
}
function getLogSnapshot() {
	return mergeLogRings();
}
function getRecentLogs(limit = 300) {
	const n = Math.max(1, Math.trunc(limit));
	return mergeLogRings().slice(-n);
}
function subscribeLogs(callback) {
	logSubscribers.add(callback);
	return () => {
		logSubscribers.delete(callback);
	};
}
function makeLogger(opts) {
	return {
		trace: (...args) => emit("trace", opts, args),
		debug: (...args) => emit("debug", opts, args),
		info: (...args) => emit("info", opts, args),
		success: (...args) => emit("success", opts, args),
		warn: (...args) => emit("warn", opts, args),
		error: (...args) => emit("error", opts, args),
		child: (meta) => {
			const nextUin = typeof meta.uin === "number" ? meta.uin : opts.uin;
			return makeLogger({
				scope: opts.scope,
				uin: nextUin,
				meta: {
					...opts.meta ?? {},
					...meta
				}
			});
		}
	};
}
function createLogger(scope) {
	return makeLogger({ scope });
}
function renderTraceBytes(body) {
	return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("hex");
}
function runWithTraceRequest(fn) {
	if (currentRequestId() !== void 0 || currentLevel !== "trace") return fn();
	return runWithRequestId(nextRequestId(), fn);
}
function logInitialWebuiCredentials(password) {
	const line = render("info", { scope: "WebUI" }, format("initial credentials: user=admin password=%s", password));
	process.stdout.write(line.replace(/[\x00-\x08\x0B-\x1A\x1C-\x1F\x7F]/g, "") + "\n");
}
var UIN_SLOT_WIDTH, LEVEL_WEIGHT, LEVEL_LABEL, COLOR_CODE, COLOR_SCOPE, COLOR_DIM, COLOR_RESET, MAX_LOG_ENTRIES, TRACE_BUFFER_MAX, RingBuffer, logRing, traceRing, logSubscribers, nextLogId, currentLevel, currentFileLevel, LOG_LEVELS$1;
var init_logger = __esmMin((() => {
	init_log_file_transport();
	init_log_summary();
	init_log_sanitize();
	init_request_context();
	UIN_SLOT_WIDTH = 12;
	LEVEL_WEIGHT = {
		trace: 5,
		debug: 10,
		info: 20,
		success: 25,
		warn: 30,
		error: 40
	};
	LEVEL_LABEL = {
		trace: "TRACE",
		debug: "DEBUG",
		info: "INFO",
		success: "OK",
		warn: "WARN",
		error: "ERROR"
	};
	COLOR_CODE = {
		trace: 90,
		debug: 90,
		info: 36,
		success: 32,
		warn: 33,
		error: 31
	};
	COLOR_SCOPE = 35;
	COLOR_DIM = 2;
	COLOR_RESET = "\x1B[0m";
	MAX_LOG_ENTRIES = 1e3;
	TRACE_BUFFER_MAX = resolveTraceBufferMax();
	RingBuffer = class {
		cap;
		buf;
		start = 0;
		count = 0;
		constructor(cap) {
			this.cap = cap;
			this.buf = new Array(cap);
		}
		push(item) {
			const end = (this.start + this.count) % this.cap;
			this.buf[end] = item;
			if (this.count < this.cap) this.count += 1;
			else this.start = (this.start + 1) % this.cap;
		}
		/** Most recent `n` items, oldest→newest. */
		recent(n) {
			const take = Math.max(0, Math.min(Math.trunc(n), this.count));
			const out = new Array(take);
			const first = this.start + (this.count - take);
			for (let i = 0; i < take; i += 1) out[i] = this.buf[(first + i) % this.cap];
			return out;
		}
		toArray() {
			return this.recent(this.count);
		}
		get size() {
			return this.count;
		}
	};
	logRing = new RingBuffer(MAX_LOG_ENTRIES);
	traceRing = new RingBuffer(TRACE_BUFFER_MAX);
	logSubscribers = /* @__PURE__ */ new Set();
	nextLogId = 1;
	currentLevel = resolveMinLevel();
	currentFileLevel = resolveFileMinLevel();
	LOG_LEVELS$1 = [
		"trace",
		"debug",
		"info",
		"success",
		"warn",
		"error"
	];
}));
export {};
