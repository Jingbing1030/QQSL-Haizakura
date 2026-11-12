// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/hook-manager.ts"
// original bundle lines 4671-5061  (389 lines) of dist/index.mjs
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
init_log_summary();
var AUTO_LOAD_MAX_ATTEMPTS = 3;
/**
* HookManager — thin orchestrator over a per-PID HookSession map and a
* singleton PipeWatcher.
*
* Responsibilities:
*   - Route user commands (load/unload/refresh) to the matching session.
*   - Route watcher diff events to the matching session.
*   - Forward session events ('login' / 'disconnected' / transport health) to BridgeManager.
*   - Retry stuck-in-connecting sessions on every watcher tick (so a
*     failed connect eventually recovers without a manual refresh).
*   - Retry the bounded early-process auto-load race without retrying
*     permanent injector errors.
*
* The native injector, native pipe-client, and native process/pipe
* listings are all swappable dependencies so tests can run without a
* real QQ.exe or a native addon.
*/
var HookManager = class {
	bridgeManager;
	onPacket;
	injector;
	makeClient;
	pipeWatcher;
	ownsPipeWatcher;
	enumerator;
	detectAccounts;
	watchAccounts;
	autoLoadOnDiscovery;
	onSessionsChangedRaw;
	log;
	sessions = /* @__PURE__ */ new Map();
	autoLoadAttempts = /* @__PURE__ */ new Map();
	startPromise;
	accounts = /* @__PURE__ */ new Map();
	accountProbe = null;
	accountsDirty = true;
	stopWatchingAccounts;
	lastAccountProbeFailure = "";
	disposed = false;
	constructor(deps) {
		this.bridgeManager = deps.bridgeManager;
		this.onPacket = deps.onPacket ?? ((pkt) => deps.bridgeManager.onPacket(pkt));
		this.onSessionsChangedRaw = deps.onSessionsChanged;
		this.log = deps.log ?? createLogger("Hook");
		this.injector = deps.injector ?? {
			inject: injectHookProcess,
			unload: unloadHookProcess
		};
		this.makeClient = deps.makeClient ?? ((pid) => new QqHookClient(pid));
		this.detectAccounts = deps.detectAccounts ?? detectAccountLoginsForPids;
		this.watchAccounts = deps.watchAccounts ?? ((pids, onChange) => watchAccountChangesForPids(pids, onChange, this.log));
		this.autoLoadOnDiscovery = deps.autoLoadOnDiscovery ?? false;
		this.enumerator = createProcessEnumerator({
			listProcesses: deps.listProcesses ?? listHookProcesses,
			log: this.log
		});
		if (deps.pipeWatcher) {
			this.pipeWatcher = deps.pipeWatcher;
			this.ownsPipeWatcher = false;
		} else {
			this.pipeWatcher = new PipeWatcher({
				listProcesses: this.enumerator.enumerate,
				listLivePipes: (processes) => QqHookClient.listLivePipes(processes.map(({ pid }) => pid)),
				intervalMs: deps.watcherIntervalMs,
				log: this.log
			});
			this.ownsPipeWatcher = true;
		}
		this.bindWatcher();
		this.startPromise = this.pipeWatcher.start();
	}
	async listProcesses() {
		await this.startPromise;
		const processes = await this.enumerator.enumerate();
		const sessions = processes === null ? [...this.sessions.values()] : processes.map((proc) => {
			const session = this.ensureSession(proc.pid);
			session.attachProcessInfo(proc);
			return session;
		});
		await this.refreshAccounts();
		return sessions.filter((session) => this.sessions.get(session.pid) === session).map((session) => this.processInfo(session)).sort((a, b) => a.pid - b.pid);
	}
	async loadProcess(pid) {
		this.assertValidPid(pid);
		await this.startPromise;
		this.autoLoadAttempts.delete(pid);
		const session = this.ensureSession(pid);
		this.invalidateAccounts();
		await session.load();
		this.pipeWatcher.wake();
		await this.refreshAccounts();
		return this.processInfo(session);
	}
	async unloadProcess(pid) {
		this.assertValidPid(pid);
		await this.startPromise;
		this.autoLoadAttempts.delete(pid);
		const session = this.ensureSession(pid);
		this.invalidateAccounts();
		await session.unload();
		await this.refreshAccounts();
		return this.processInfo(session);
	}
	async refreshProcess(pid) {
		this.assertValidPid(pid);
		await this.startPromise;
		const session = this.ensureSession(pid);
		this.updateAccountWatcher();
		this.invalidateAccounts();
		await session.refresh();
		await this.refreshAccounts();
		return this.processInfo(session);
	}
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.stopWatchingAccounts?.();
		for (const session of this.sessions.values()) session.dispose();
		this.sessions.clear();
		this.accounts.clear();
		this.autoLoadAttempts.clear();
		this.enumerator.dispose();
		if (this.ownsPipeWatcher) this.pipeWatcher.dispose();
	}
	processInfo(session) {
		return {
			...session.toInfo(),
			account: this.accounts.get(session.pid) ?? null
		};
	}
	invalidateAccounts() {
		this.accountsDirty = true;
	}
	updateAccountWatcher() {
		this.stopWatchingAccounts?.();
		this.stopWatchingAccounts = this.watchAccounts([...this.sessions.keys()], () => {
			this.invalidateAccounts();
			this.refreshAccounts();
		});
	}
	/** REST, watcher ticks and login reconciliation share the same account snapshot. */
	async refreshAccounts() {
		if (this.disposed || this.sessions.size === 0) return;
		if (this.accountProbe) {
			await this.accountProbe;
			return;
		}
		if (!this.accountsDirty) return;
		this.accountProbe = runWithTraceRequest(async () => {
			do {
				this.accountsDirty = false;
				await this.readAccounts();
			} while (!this.disposed && this.sessions.size > 0 && this.accountsDirty);
		}).finally(() => {
			this.accountProbe = null;
		});
		await this.accountProbe;
	}
	async readAccounts() {
		const accounts = /* @__PURE__ */ new Map();
		try {
			for (const state of await this.detectAccounts([...this.sessions.keys()])) if (state.pid !== null && this.sessions.has(state.pid)) accounts.set(state.pid, {
				uin: state.uin,
				nickname: state.nickname
			});
			this.lastAccountProbeFailure = "";
		} catch (error) {
			const message = errorMessage(error);
			if (this.lastAccountProbeFailure !== message) {
				this.lastAccountProbeFailure = message;
				this.log.warn("account detection failed: %s", message);
			}
		}
		if (this.disposed || this.accountsDirty) return;
		const changed = accounts.size !== this.accounts.size || [...accounts].some(([pid, account]) => {
			const previous = this.accounts.get(pid);
			return previous?.uin !== account.uin || previous.nickname !== account.nickname;
		});
		this.accounts = accounts;
		if (changed) this.notifySessionsChanged();
	}
	bindWatcher() {
		this.pipeWatcher.on("process-discovered", (info) => {
			if (this.disposed) return;
			runWithTraceRequest(() => {
				const session = this.ensureSession(info.pid);
				session.attachProcessInfo(info);
				this.log.trace(() => [
					"hook_manager_fact event=process_discovered pid=%d info=%s autoLoad=%s",
					info.pid,
					renderParamsVerbose(info),
					this.autoLoadOnDiscovery
				]);
				if (this.autoLoadOnDiscovery && shouldAutoLoadPid(info.pid, this.log)) this.runAutoLoad(session);
				this.notifySessionsChanged();
			});
		});
		this.pipeWatcher.on("process-gone", (pid) => {
			if (this.disposed) return;
			runWithTraceRequest(() => {
				this.autoLoadAttempts.delete(pid);
				const session = this.sessions.get(pid);
				this.log.trace("hook_manager_fact event=process_gone pid=%d tracked=%s", pid, session !== void 0);
				if (session) session.notifyProcessGone();
				this.notifySessionsChanged();
			});
		});
		this.pipeWatcher.on("pipe-up", (pid) => {
			if (this.disposed) return;
			const session = this.sessions.get(pid);
			if (session) {
				this.invalidateAccounts();
				session.onPipeUp();
			}
		});
		this.pipeWatcher.on("pipe-down", (pid) => {
			if (this.disposed) return;
			const session = this.sessions.get(pid);
			if (session) {
				this.invalidateAccounts();
				session.onPipeDown();
			}
		});
		this.pipeWatcher.on("tick", () => {
			if (this.disposed) return;
			this.refreshAccounts();
			for (const session of this.sessions.values()) {
				const autoLoad = this.autoLoadAttempts.get(session.pid);
				if (autoLoad && !autoLoad.inFlight && session.status === "error" && isTransientLibcMappingError(session.error)) {
					this.runAutoLoad(session, autoLoad);
					continue;
				}
				if ((session.status === "connecting" || session.status === "disconnected" || session.status === "error") && this.pipeWatcher.isPipeLive(session.pid)) session.onPipeUp();
			}
		});
	}
	runAutoLoad(session, existing) {
		if (this.disposed || session.isDisposed) return;
		const state = existing ?? {
			attempts: 0,
			inFlight: false
		};
		if (state.inFlight || state.attempts >= AUTO_LOAD_MAX_ATTEMPTS) return;
		state.attempts += 1;
		state.inFlight = true;
		this.autoLoadAttempts.set(session.pid, state);
		const attempt = state.attempts;
		runWithTraceRequest(async () => {
			const startedAt = Date.now();
			this.log.trace("hook_autoload_start pid=%d attempt=%d maxAttempts=%d", session.pid, attempt, AUTO_LOAD_MAX_ATTEMPTS);
			try {
				const info = await session.load();
				if (this.autoLoadAttempts.get(session.pid) !== state) {
					this.log.trace("hook_autoload_terminal pid=%d attempt=%d outcome=dropped reason=superseded elapsedMs=%d", session.pid, attempt, Date.now() - startedAt);
					return;
				}
				state.inFlight = false;
				if (info.status !== "error") {
					this.autoLoadAttempts.delete(session.pid);
					const reason = attempt > 1 ? "recovered" : "loaded";
					this.log.trace(() => [
						"hook_autoload_terminal pid=%d attempt=%d outcome=completed reason=%s state=%s elapsedMs=%d",
						session.pid,
						attempt,
						reason,
						renderParamsVerbose(info),
						Date.now() - startedAt
					]);
					if (attempt > 1) this.log.info("auto-load recovered: PID=%d attempt=%d/%d", session.pid, attempt, AUTO_LOAD_MAX_ATTEMPTS);
					return;
				}
				if (!isTransientLibcMappingError(info.error)) {
					this.autoLoadAttempts.delete(session.pid);
					this.log.trace("hook_autoload_terminal pid=%d attempt=%d outcome=failed reason=permanent_failure error=%j elapsedMs=%d", session.pid, attempt, info.error, Date.now() - startedAt);
					return;
				}
				if (attempt >= AUTO_LOAD_MAX_ATTEMPTS) {
					this.autoLoadAttempts.delete(session.pid);
					this.log.trace("hook_autoload_terminal pid=%d attempt=%d outcome=failed reason=retry_exhausted error=%j elapsedMs=%d", session.pid, attempt, info.error, Date.now() - startedAt);
					this.log.warn("auto-load retry exhausted: PID=%d attempts=%d err=%s", session.pid, attempt, info.error);
					return;
				}
				this.log.trace("hook_autoload_terminal pid=%d attempt=%d outcome=failed reason=retry_pending error=%j elapsedMs=%d", session.pid, attempt, info.error, Date.now() - startedAt);
				this.log.warn("auto-load retry pending: PID=%d attempt=%d/%d err=%s", session.pid, attempt, AUTO_LOAD_MAX_ATTEMPTS, info.error);
			} catch (err) {
				if (this.autoLoadAttempts.get(session.pid) === state) this.autoLoadAttempts.delete(session.pid);
				this.log.trace("hook_autoload_terminal pid=%d attempt=%d outcome=failed reason=unexpected_failure error=%j elapsedMs=%d", session.pid, attempt, errorMessage(err), Date.now() - startedAt);
				this.log.warn("auto-load failed: PID=%d err=%s", session.pid, errorMessage(err));
			}
		});
	}
	ensureSession(pid) {
		let session = this.sessions.get(pid);
		if (session) return session;
		session = new HookSession(pid, {
			injector: this.injector,
			makeClient: this.makeClient,
			pipeWatcher: this.pipeWatcher,
			onPacket: this.onPacket,
			detectLoginUin: async () => {
				await this.refreshAccounts();
				return this.accounts.get(pid)?.uin ?? null;
			},
			log: this.log
		});
		session.attachProcessInfo({ name: defaultProcessName() });
		session.on("login", (uin, sender) => {
			this.invalidateAccounts();
			this.bridgeManager.onHookLogin(pid, uin, sender);
			this.notifySessionsChanged();
		});
		session.on("disconnected", (wasLoggedIn) => {
			if (wasLoggedIn) this.bridgeManager.onPidDisconnected(pid);
		});
		session.on("receive-health-changed", (healthy) => {
			this.bridgeManager.onPidReceiveHealthChanged(pid, healthy);
		});
		let previousStatus = session.status;
		session.on("status-changed", (status) => {
			if (previousStatus === "online" && status !== "online") this.invalidateAccounts();
			previousStatus = status;
			this.notifySessionsChanged();
		});
		session.on("disposed", () => {
			this.sessions.delete(pid);
			this.accounts.delete(pid);
			this.updateAccountWatcher();
			this.invalidateAccounts();
		});
		this.sessions.set(pid, session);
		this.updateAccountWatcher();
		this.invalidateAccounts();
		return session;
	}
	/** Fire the optional sessions-changed hook with exceptions isolated.
	* A throwing subscriber must not abort the watcher's emit loop or break
	* a HookSession event handler in flight. */
	notifySessionsChanged() {
		if (this.disposed) return;
		if (!this.onSessionsChangedRaw) return;
		try {
			this.onSessionsChangedRaw();
		} catch (err) {
			this.log.warn("onSessionsChanged threw: %s", errorMessage(err));
		}
	}
	assertValidPid(pid) {
		if (!Number.isInteger(pid) || pid <= 0) throw new Error("invalid pid");
	}
};
function defaultProcessName() {
	return process.platform === "win32" ? "QQ.exe" : "qq";
}
function isTransientLibcMappingError(error) {
	return /^target process does not map \S*\/libc\.so\.6 while resolving mmap$/.test(error);
}
/**
* Filter for auto-load only. Returns false for Linux Electron child
* processes (zygote/renderer/gpu/utility), which the native enumerator
* mis-classifies as "main QQ" because their cmdline contains "qq" and
* they transiently inherit wrapper.node via fork copy-on-write.
*
* Injecting into a zygote spawns the hook's resolver thread inside it;
* every renderer Electron later forks then inherits that thread + the
* partially-init'd hook state, which breaks QQ's IPC and login UI.
*
* Manual loadProcess() bypasses this gate — the operator is responsible
* for picking the right PID from WebUI.
*/
function shouldAutoLoadPid(pid, log) {
	if (process.platform !== "linux") return true;
	if (process.env.SNOWLUMA_HOOK_AUTOLOAD_ALL === "1") return true;
	let cmdline;
	try {
		cmdline = fs$1.readFileSync(`/proc/${pid}/cmdline`, "utf8");
	} catch {
		return true;
	}
	if (cmdline.includes("--type=")) {
		const type = /--type=([^\0\s]+)/.exec(cmdline)?.[1] ?? "unknown";
		log.info("auto-load skip: PID=%d is an Electron child process (--type=%s)", pid, type);
		return false;
	}
	return true;
}
export {};
