// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/pipe-watcher.ts"
// original bundle lines 4498-4625  (126 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
init_errors();
init_logger();
var DEFAULT_INTERVAL_MS = 1500;
var MIN_INTERVAL_MS = 250;
/** Publishes process and pipe snapshots, then emits their ordered differences. */
var PipeWatcher = class extends EventEmitter$1 {
	listProcesses;
	listLivePipes;
	intervalMs;
	log;
	livePipes = /* @__PURE__ */ new Set();
	knownPids = /* @__PURE__ */ new Set();
	timer = null;
	tickTask = null;
	pendingTick = false;
	startPromise = null;
	stopped = false;
	constructor(deps) {
		super();
		this.listProcesses = deps.listProcesses;
		this.listLivePipes = deps.listLivePipes;
		this.intervalMs = Math.max(MIN_INTERVAL_MS, deps.intervalMs ?? DEFAULT_INTERVAL_MS);
		this.log = deps.log ?? createLogger("PipeWatcher");
	}
	isPipeLive(pid) {
		return this.livePipes.has(pid);
	}
	isProcessAlive(pid) {
		return this.knownPids.has(pid);
	}
	/** Read the initial snapshot and start polling. Repeated calls share startup. */
	start() {
		return this.startPromise ??= this.tickNow().finally(() => {
			this.scheduleNext(this.intervalMs);
		});
	}
	/** Coalesce wake requests into one scan after the current read. */
	wake() {
		if (this.stopped) return;
		if (this.tickTask) this.pendingTick = true;
		else this.scheduleNext(0);
	}
	/** Wait for a fresh snapshot, including a scan queued behind an active read. */
	tickNow() {
		if (this.stopped) return Promise.resolve();
		if (this.tickTask) {
			this.pendingTick = true;
			return this.tickTask;
		}
		this.tickTask = (async () => {
			do {
				this.pendingTick = false;
				await this.readSnapshot();
				if (this.pendingTick && !this.stopped) await setImmediate$1();
			} while (this.pendingTick && !this.stopped);
		})().finally(() => {
			this.tickTask = null;
		});
		return this.tickTask;
	}
	stop() {
		this.stopped = true;
		this.pendingTick = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}
	dispose() {
		this.stop();
		this.removeAllListeners();
	}
	scheduleNext(delayMs) {
		if (this.stopped) return;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			this.tickAndReschedule();
		}, delayMs);
	}
	async tickAndReschedule() {
		try {
			await this.tickNow();
		} catch (error) {
			this.log.warn("poll failed: %s", errorMessage(error));
		} finally {
			this.scheduleNext(this.intervalMs);
		}
	}
	async readSnapshot() {
		let processes;
		try {
			processes = await this.listProcesses();
		} catch (error) {
			this.log.warn("listProcesses failed: %s", errorMessage(error));
			processes = null;
		}
		if (this.stopped) return;
		if (processes === null) {
			this.emit("tick");
			return;
		}
		let livePipes;
		try {
			livePipes = await this.listLivePipes(processes);
		} catch (error) {
			this.log.warn("listLivePipes failed: %s", errorMessage(error));
			livePipes = this.livePipes;
		}
		if (this.stopped) return;
		const knownPids = new Set(processes.map(({ pid }) => pid));
		const currentPipes = new Set([...livePipes].filter((pid) => knownPids.has(pid)));
		const events = [];
		for (const process of processes) if (!this.knownPids.has(process.pid)) events.push(["process-discovered", process]);
		for (const pid of currentPipes) if (!this.livePipes.has(pid)) events.push(["pipe-up", pid]);
		for (const pid of this.livePipes) if (!currentPipes.has(pid)) events.push(["pipe-down", pid]);
		for (const pid of this.knownPids) if (!knownPids.has(pid)) events.push(["process-gone", pid]);
		this.knownPids = knownPids;
		this.livePipes = currentPipes;
		for (const [event, payload] of events) {
			if (this.stopped) return;
			this.emit(event, payload);
		}
		if (!this.stopped) this.emit("tick");
	}
};
export {};
