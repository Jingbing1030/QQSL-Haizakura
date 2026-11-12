var SYSTEM_CLOCK$1 = {
	now: () => Date.now(),
	sleep: (ms, signal) => abortableSleep$1(ms, signal)
};
/**
* Process-wide history request gate.
*
* The gate owns the network operation, not just a preceding delay. This keeps
* concurrent history callers serialized and preserves the stricter spacing on
* both sides of an automatic history-sync request.
*/
var HistoryRequestGate = class {
	clock;
	tail = Promise.resolve();
	lastStartedAt = null;
	nextAllowedAt = 0;
	constructor(clock = SYSTEM_CLOCK$1) {
		this.clock = clock;
	}
	run(minimumGapMs, operation, signal) {
		if (!Number.isSafeInteger(minimumGapMs) || minimumGapMs < 0) return Promise.reject(/* @__PURE__ */ new Error(`history request gap is invalid: ${String(minimumGapMs)}`));
		let operationStarted = false;
		const result = this.tail.then(async () => {
			throwIfAborted$1(signal);
			const now = this.clock.now();
			const requestedBoundary = this.lastStartedAt === null ? now : this.lastStartedAt + minimumGapMs;
			const wait = Math.max(this.nextAllowedAt, requestedBoundary) - now;
			if (wait > 0) await this.clock.sleep(wait, signal);
			throwIfAborted$1(signal);
			const startedAt = this.clock.now();
			this.lastStartedAt = startedAt;
			this.nextAllowedAt = startedAt + minimumGapMs;
			operationStarted = true;
			return operation();
		});
		this.tail = result.then(() => void 0, () => void 0);
		return signal ? rejectWhileQueuedOnAbort$1(result, signal, () => operationStarted) : result;
	}
};
function throwIfAborted$1(signal) {
	if (signal?.aborted) throw signal.reason ?? /* @__PURE__ */ new Error("history request aborted");
}
function abortableSleep$1(ms, signal) {
	throwIfAborted$1(signal);
	if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			reject(signal.reason ?? /* @__PURE__ */ new Error("history request aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
function rejectWhileQueuedOnAbort$1(result, signal, hasStarted) {
	if (signal.aborted && !hasStarted()) return Promise.reject(signal.reason ?? /* @__PURE__ */ new Error("history request aborted"));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			if (!hasStarted()) reject(signal.reason ?? /* @__PURE__ */ new Error("history request aborted"));
		};
		signal.addEventListener("abort", onAbort);
		result.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", onAbort);
		});
	});
}
