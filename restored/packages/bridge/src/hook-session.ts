// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/hook-session.ts"
// original bundle lines 3720-4497  (776 lines) of dist/index.mjs
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
/** How often to re-check account identity while the connection is not ready.
*  Identity alone never proves that requests can be served. */
var LOGIN_RECONCILE_INTERVAL_MS = 3e3;
var LOGIN_IDENTITY_OBSERVE_INTERVAL_MS = 3e4;
var LOGIN_HINT_MAX_ATTEMPTS = 3;
var LOGIN_HINT_RETRY_DELAYS_MS = [3e3, 9e3];
/** Bounds channel discovery and handshakes, not account login. */
var INITIAL_CONNECTION_TIMEOUT_MS = 6e4;
/** QQ emits this response periodically while its MSF receive path is healthy.
*  Seeing it once arms the watchdog; before that, silence is UNKNOWN rather
*  than unhealthy so QQ versions that do not expose this command cannot be
*  false-flagged. Any later recv packet proves the same end-to-end path. */
var QQ_RECV_HEARTBEAT_CMD = "trpc.qq_new_tech.status_svc.StatusService.SsoHeartBeat";
var RECEIVE_STALE_AFTER_MS = 9e4;
var RECEIVE_STALE_CONFIRM_MS = 15e3;
/**
* HookSession — owns the lifecycle of one QQ.exe process: injection,
* pipe client, login state, and the public status field.
*
* Concurrency: every state-mutating method goes through a per-session
* promise chain so user clicks (load/unload/refresh) and watcher-driven
* events (onPipeUp/onPipeDown) never interleave.
*
* Communication: emits high-level events instead of calling BridgeManager
* directly, so HookManager forwards them and tests can attach spies.
*
* Emitted events:
*   'login'          (uin, packetSender) — real-UIN login detected
*   'disconnected'   (wasLoggedIn)       — connection dropped, torn down, or
*                                          dispose() of a logged-in session
*                                          (process shutdown uses this path)
*   'receive-health-changed' (healthy)   — combined receive/request path health changed
*   'status-changed' (status, error)     — status field mutated
*   'disposed'       ()                  — session stopped tracking this PID
*/
var HookSession = class extends EventEmitter {
	pid;
	injector;
	makeClient;
	detectLoginUin;
	pipeWatcher;
	onPacket;
	log;
	_status = "available";
	_error = "";
	runtimeFailure = "";
	_uin = "0";
	_method = "";
	_name = "";
	_path = "";
	injected = false;
	connected = false;
	loggedIn = false;
	injectResult = null;
	client = null;
	sender = null;
	bound = false;
	opChain = Promise.resolve();
	disposed = false;
	initialConnectionWatch = null;
	initialConnectionError = "";
	hasConnected = false;
	cancelConnectAttempt = null;
	pipeUpPending = false;
	loginReconcileTimer = null;
	detecting = false;
	lastDetectFailure = "";
	acceptedLoginHintUin = "";
	loginHintAttemptUin = "";
	loginHintAttempts = 0;
	nextLoginHintAt = 0;
	nextLoginIdentityObservationAt = 0;
	_receiveHealthy = true;
	_outboundHealthy = true;
	receiveWatchUin = "";
	receiveWatchArmed = false;
	receiveWatchTimer = null;
	lastReceiveAt = 0;
	constructor(pid, deps) {
		super();
		this.pid = pid;
		this.injector = deps.injector;
		this.makeClient = deps.makeClient;
		this.detectLoginUin = deps.detectLoginUin ?? detectUinForPid;
		this.pipeWatcher = deps.pipeWatcher;
		this.onPacket = deps.onPacket ?? null;
		this.log = deps.log ?? createLogger("HookSession");
	}
	get status() {
		return this._status;
	}
	get error() {
		return this._error;
	}
	get uin() {
		return this._uin;
	}
	get method() {
		return this._method;
	}
	get isDisposed() {
		return this.disposed;
	}
	get receiveHealthy() {
		return this._receiveHealthy && this._outboundHealthy;
	}
	attachProcessInfo(info) {
		if (info.name) this._name = info.name;
		if (info.path) this._path = info.path;
	}
	toInfo() {
		return {
			pid: this.pid,
			name: this._name,
			path: this._path,
			injected: this.injected,
			connected: this.connected,
			loggedIn: this.loggedIn,
			uin: this._uin,
			status: this._status,
			error: this._error,
			method: this._method,
			account: null
		};
	}
	load() {
		return this.traceCommand("load", () => this.loadInternal());
	}
	unload() {
		this.cancelConnectAttempt?.();
		return this.traceCommand("unload", () => this.unloadInternal());
	}
	refresh() {
		return this.traceCommand("refresh", () => this.refreshInternal());
	}
	/** Pipe came up (or stayed up across a Haizakura restart). Drives connect
	* attempts and adopts pre-existing hooks. Idempotent; safe to call on
	* every watcher tick where the pipe is live. */
	onPipeUp() {
		if (this.disposed || this.pipeUpPending || this.cancelConnectAttempt) return;
		this.pipeUpPending = true;
		this.serialize(async () => {
			if (this.disposed) return;
			await this.reconcilePipeUp();
		}).catch((err) => this.log.warn("onPipeUp failed: PID=%d err=%s", this.pid, errorMessage(err))).finally(() => {
			this.pipeUpPending = false;
		});
	}
	onPipeDown() {
		if (this.disposed) return;
		this.serialize(async () => {
			if (this.disposed) return;
			this.reconcilePipeDown();
		}).catch((err) => this.log.warn("onPipeDown failed: PID=%d err=%s", this.pid, errorMessage(err)));
	}
	/** Called by the manager when the watcher reports the QQ.exe process is
	* gone. Cleans up and signals the manager to remove this session. */
	notifyProcessGone() {
		if (this.disposed) return;
		this.cancelConnectAttempt?.();
		this.serialize(async () => {
			if (this.disposed) return;
			runWithTraceRequest(() => {
				const startedAt = Date.now();
				const wasLoggedIn = this.loggedIn;
				this.log.trace(() => [
					"hook_session_process_start pid=%d event=process_gone state=%s",
					this.pid,
					renderParamsVerbose(this.toInfo())
				]);
				this.stopInitialConnectionWatch();
				this.tearDownClient();
				this.injected = false;
				this.injectResult = null;
				this._method = "";
				this.setStatus("available", "");
				try {
					if (wasLoggedIn) this.emit("disconnected", true);
					this.disposed = true;
					this.emit("disposed");
					this.log.trace(() => [
						"hook_session_process_terminal pid=%d outcome=completed reason=process_gone wasLoggedIn=%s state=%s elapsedMs=%d",
						this.pid,
						wasLoggedIn,
						renderParamsVerbose(this.toInfo()),
						Date.now() - startedAt
					]);
					this.removeAllListeners();
				} catch (error) {
					this.log.trace(() => [
						"hook_session_process_terminal pid=%d outcome=failed reason=listener_failed error=%j state=%s elapsedMs=%d",
						this.pid,
						errorMessage(error),
						renderParamsVerbose(this.toInfo()),
						Date.now() - startedAt
					]);
					throw error;
				}
			});
		}).catch((err) => this.log.warn("notifyProcessGone failed: PID=%d err=%s", this.pid, errorMessage(err)));
	}
	dispose() {
		if (this.disposed) return;
		const wasLoggedIn = this.loggedIn;
		this.disposed = true;
		this.stopInitialConnectionWatch();
		this.tearDownClient();
		if (wasLoggedIn) this.emit("disconnected", true);
		this.removeAllListeners();
	}
	traceCommand(operation, command) {
		return runWithTraceRequest(async () => {
			const startedAt = Date.now();
			this.log.trace(() => [
				"hook_session_start pid=%d operation=%s state=%s",
				this.pid,
				operation,
				renderParamsVerbose(this.toInfo())
			]);
			try {
				const info = await this.serialize(command);
				const outcome = info.status === "error" || operation === "unload" && info.status !== "available" ? "failed" : "completed";
				let reason;
				if (operation === "unload" && info.status === "connecting") reason = "unload_verification_failed";
				else if (outcome === "failed") reason = `${operation}_failed`;
				else reason = `${operation}_settled`;
				this.log.trace(() => [
					"hook_session_terminal pid=%d operation=%s outcome=%s reason=%s%s state=%s elapsedMs=%d",
					this.pid,
					operation,
					outcome,
					reason,
					info.error ? ` error=${JSON.stringify(info.error)}` : "",
					renderParamsVerbose(info),
					Date.now() - startedAt
				]);
				return info;
			} catch (error) {
				this.log.trace(() => [
					"hook_session_terminal pid=%d operation=%s outcome=failed reason=%s error=%j state=%s elapsedMs=%d",
					this.pid,
					operation,
					`${operation}_threw`,
					errorMessage(error),
					renderParamsVerbose(this.toInfo()),
					Date.now() - startedAt
				]);
				throw error;
			}
		});
	}
	serialize(op) {
		const result = this.opChain.then(op);
		this.opChain = result.then(() => void 0, () => void 0);
		return result;
	}
	async loadInternal() {
		if (this.disposed) return this.toInfo();
		this._error = "";
		this.setStatus("loading", "");
		try {
			if (!this.injected) if (this.pipeWatcher.isPipeLive(this.pid)) {
				this.injected = true;
				this._method = this._method || "reconnect";
				this.log.trace("hook_session_branch pid=%d operation=load branch=existing_pipe method=%j", this.pid, this._method);
				this.log.info("PID=%d already has Haizakura pipe; will reconnect", this.pid);
			} else {
				this.log.trace("hook_session_branch pid=%d operation=load branch=inject_begin", this.pid);
				this.injectResult = await this.injector.inject(this.pid);
				this.injected = true;
				this._method = this.injectResult.method;
				this.log.trace("hook_session_branch pid=%d operation=load branch=inject_completed method=%j", this.pid, this._method);
			}
			if (this.disposed) return this.toInfo();
			this.initialConnectionError = "";
			this.startInitialConnectionWatch();
			this.applyStatus();
		} catch (error) {
			this._error = errorMessage(error);
			this.setStatus("error", this._error);
			this.log.error("load failed: PID=%d err=%s", this.pid, this._error);
			await this.pipeWatcher.tickNow?.();
			if (!this.disposed && this.pipeWatcher.isPipeLive(this.pid)) {
				this.log.info("PID=%d load failed but pipe is up; connecting", this.pid);
				await this.reconcilePipeUp();
			}
		}
		return this.toInfo();
	}
	async unloadInternal() {
		this._error = "";
		this.stopInitialConnectionWatch();
		this.initialConnectionError = "";
		this.hasConnected = false;
		try {
			const wasLoggedIn = this.loggedIn;
			this.tearDownClient();
			if (wasLoggedIn) this.emit("disconnected", true);
			const handle = this.injectResult?.handle;
			if (this.injected && handle) {
				await this.injector.unload(this.pid, handle);
				this.log.info("Haizakura unloaded from PID=%d", this.pid);
			}
			this.injected = false;
			this.injectResult = null;
			this._method = "";
			this._uin = "0";
			await this.pipeWatcher.tickNow?.();
			if (this.pipeWatcher.isPipeLive(this.pid)) {
				this._error = "DLL卸载失败：命名管道仍然存在，watcher将自动重连";
				this.setStatus("connecting", this._error);
				this.log.warn("unload verification failed: PID=%d pipe still up", this.pid);
			} else this.setStatus("available", "");
		} catch (error) {
			this._error = errorMessage(error);
			this.setStatus("error", this._error);
			this.log.error("unload failed: PID=%d err=%s", this.pid, this._error);
		}
		return this.toInfo();
	}
	async refreshInternal() {
		this._error = "";
		try {
			if (this.pipeWatcher.isPipeLive(this.pid)) await this.reconcilePipeUp();
			else this.reconcilePipeDown();
		} catch (error) {
			this._error = errorMessage(error);
			this.setStatus(this.injected ? "disconnected" : "error", this._error);
			this.log.warn("refresh failed: PID=%d err=%s", this.pid, this._error);
		}
		return this.toInfo();
	}
	/** Push the settled status derived from the live flags. `wasLoggedIn`
	* defaults to the current `loggedIn`; callers that just tore the client
	* down pass the value captured *before* teardown (teardown clears it). */
	applyStatus(wasLoggedIn = this.loggedIn, error = "") {
		if (this.runtimeFailure) {
			this.setStatus("error", this.runtimeFailure);
			return;
		}
		if (this.initialConnectionError) {
			this.setStatus("error", this.initialConnectionError);
			return;
		}
		this.setStatus(statusFor({
			injected: this.injected,
			connected: this.connected,
			loggedIn: this.loggedIn,
			wasLoggedIn
		}), error);
	}
	/** Pipe is up: adopt a DLL that survived a Haizakura restart, drop a
	* stale client, then (re)connect if needed or just settle the status.
	* Shared by onPipeUp and refresh's pipe-up branch. */
	async reconcilePipeUp() {
		if (!this.injected) {
			this.injected = true;
			if (!this._method) this._method = "reconnect";
		}
		this.startInitialConnectionWatch();
		if (this.client?.isClosed) this.tearDownClient();
		if (!this.connected) await this.attemptConnect();
		else this.applyStatus();
	}
	/** Pipe is down (or the client closed): tear down, settle the status,
	* and emit the disconnect notification iff we owed BridgeManager one
	* (i.e. we had reached login). Shared by onPipeDown, refresh's pipe-down
	* branch, and the client 'close' handler. */
	reconcilePipeDown() {
		if (!this.connected) {
			if (this.injected) this.applyStatus(this.loggedIn, this._error);
			return;
		}
		runWithTraceRequest(() => {
			const startedAt = Date.now();
			const wasLoggedIn = this.loggedIn;
			this.log.trace(() => [
				"hook_session_disconnect_start pid=%d reason=pipe_down state=%s",
				this.pid,
				renderParamsVerbose(this.toInfo())
			]);
			this.tearDownClient(true);
			this.applyStatus(wasLoggedIn);
			try {
				if (wasLoggedIn) this.emit("disconnected", true);
				this.log.trace(() => [
					"hook_session_disconnect_terminal pid=%d outcome=completed reason=pipe_down wasLoggedIn=%s state=%s elapsedMs=%d",
					this.pid,
					wasLoggedIn,
					renderParamsVerbose(this.toInfo()),
					Date.now() - startedAt
				]);
			} catch (error) {
				this.log.trace(() => [
					"hook_session_disconnect_terminal pid=%d outcome=failed reason=listener_failed error=%j state=%s elapsedMs=%d",
					this.pid,
					errorMessage(error),
					renderParamsVerbose(this.toInfo()),
					Date.now() - startedAt
				]);
				throw error;
			}
		});
	}
	async attemptConnect() {
		if (this.connected) return;
		return runWithTraceRequest(async () => {
			const startedAt = Date.now();
			this.log.trace(() => [
				"hook_session_connect_start pid=%d state=%s",
				this.pid,
				renderParamsVerbose(this.toInfo())
			]);
			if (this.client?.isClosed) this.tearDownClient();
			if (!this.client) {
				this.runtimeFailure = "";
				this.client = this.makeClient(this.pid);
				this.sender = new HookPacketClient(this.client, (healthy) => this.setOutboundHealthy(healthy));
				this.bound = false;
			}
			if (!this.bound) {
				this.bindClient(this.client);
				this.bound = true;
			}
			const client = this.client;
			const watch = this.initialConnectionWatch;
			const timeoutMs = watch ? Math.max(1, INITIAL_CONNECTION_TIMEOUT_MS - (Date.now() - watch.startedAt)) : INITIAL_CONNECTION_TIMEOUT_MS;
			try {
				await this.connectWithTimeout(client, timeoutMs);
				if (this.disposed || this.client !== client) return;
				if (this.runtimeFailure) throw new Error(this.runtimeFailure);
				this.connected = true;
				this.hasConnected = true;
				this.stopInitialConnectionWatch();
				this.initialConnectionError = "";
				const loginState = client.getLoginState();
				if (loginState.loggedIn) this.handleLoginState(loginState);
				else {
					this.applyStatus();
					runWithoutRequestContext(() => this.startLoginReconcile());
				}
				this.log.info("pipe connected: PID=%d", this.pid);
				this.log.trace(() => [
					"hook_session_connect_terminal pid=%d outcome=completed reason=connect_settled state=%s elapsedMs=%d",
					this.pid,
					renderParamsVerbose(this.toInfo()),
					Date.now() - startedAt
				]);
			} catch (error) {
				if (this.disposed || this.client !== client) return;
				this._error = errorMessage(error);
				const wasLoggedIn = this.loggedIn;
				this.tearDownClient(true);
				if (watch && Date.now() - watch.startedAt >= INITIAL_CONNECTION_TIMEOUT_MS) this.expireInitialConnection(watch, "handshake");
				this.applyStatus(wasLoggedIn, this._error);
				if (wasLoggedIn) this.emit("disconnected", true);
				this.log.trace(() => [
					"hook_session_connect_terminal pid=%d outcome=failed reason=connect_failed error=%j state=%s elapsedMs=%d",
					this.pid,
					this._error,
					renderParamsVerbose(this.toInfo()),
					Date.now() - startedAt
				]);
			}
		});
	}
	startInitialConnectionWatch() {
		if (this.disposed || this.hasConnected || this.initialConnectionWatch || this.initialConnectionError) return;
		const watch = {
			startedAt: Date.now(),
			timer: setTimeout(() => {
				this.serialize(async () => this.expireInitialConnection(watch)).catch((error) => this.log.error("initial connection timeout transition failed: PID=%d err=%s", this.pid, errorMessage(error)));
			}, INITIAL_CONNECTION_TIMEOUT_MS)
		};
		watch.timer.unref();
		this.initialConnectionWatch = watch;
		this.log.debug("initial connection started: PID=%d timeoutMs=%d", this.pid, INITIAL_CONNECTION_TIMEOUT_MS);
	}
	stopInitialConnectionWatch() {
		if (this.initialConnectionWatch) {
			clearTimeout(this.initialConnectionWatch.timer);
			this.initialConnectionWatch = null;
		}
	}
	expireInitialConnection(watch, phase = "waiting_channel") {
		if (this.disposed || this.connected || this.initialConnectionWatch !== watch) return;
		const previousError = this._error;
		this.stopInitialConnectionWatch();
		this.initialConnectionError = "首次连接超时（60 秒）：组件已加载，但通信通道尚未就绪，可重试连接或卸载组件";
		this.log.error("initial connection timed out: PID=%d phase=%s timeoutMs=%d elapsedMs=%d previousError=%j", this.pid, phase, INITIAL_CONNECTION_TIMEOUT_MS, Date.now() - watch.startedAt, previousError);
		this.applyStatus();
	}
	async connectWithTimeout(client, timeoutMs) {
		let cancel;
		let timer;
		const deadline = new Promise((_, reject) => {
			cancel = () => reject(/* @__PURE__ */ new Error("Connection attempt cancelled"));
			timer = setTimeout(() => reject(/* @__PURE__ */ new Error(`Connection handshake timed out after ${timeoutMs} ms`)), timeoutMs);
			timer.unref();
		});
		this.cancelConnectAttempt = cancel;
		try {
			await Promise.race([client.connectAll({ recv: true }), deadline]);
		} finally {
			clearTimeout(timer);
			if (this.cancelConnectAttempt === cancel) this.cancelConnectAttempt = null;
		}
	}
	bindClient(client) {
		client.on("runtimeError", (error) => {
			if (this.client !== client || this.disposed) return;
			const wasLoggedIn = this.loggedIn;
			this.runtimeFailure = errorMessage(error);
			this.stopInitialConnectionWatch();
			this.loggedIn = false;
			this.stopLoginReconcile();
			this.resetReceiveWatch();
			this.applyStatus(wasLoggedIn);
			this.log.error("QQ runtime unavailable: PID=%d err=%s", this.pid, this.runtimeFailure);
			if (wasLoggedIn) this.emit("disconnected", true);
		});
		client.on("packet", (packet) => this.handlePacket(packet));
		client.on("loginState", (state) => this.handleLoginState(state));
		client.on("error", (error) => {
			const msg = errorMessage(error);
			this._error = this.runtimeFailure || this.initialConnectionError || msg;
			this.log.warn("pipe error: PID=%d err=%s", this.pid, msg);
		});
		client.on("close", () => {
			if (this.disposed) return;
			if (this.client !== client) return;
			this.serialize(async () => {
				if (this.disposed) return;
				if (this.client !== client) return;
				this.reconcilePipeDown();
			}).catch((err) => this.log.warn("close reconcile failed: PID=%d err=%s", this.pid, errorMessage(err)));
		});
	}
	tearDownClient(preserveRuntimeFailure = false) {
		this.cancelConnectAttempt?.();
		this.stopLoginReconcile();
		this.resetReceiveWatch();
		const client = this.client;
		if (client) {
			client.removeAllListeners();
			try {
				client.close();
			} catch {}
		}
		this.client = null;
		if (!preserveRuntimeFailure) this.runtimeFailure = "";
		this.sender = null;
		this.bound = false;
		this.connected = false;
		this.loggedIn = false;
		this._outboundHealthy = true;
		this.resetLoginHint();
	}
	handleLoginState(state) {
		if (this.runtimeFailure) return;
		const wasLoggedIn = this.loggedIn;
		const previousUin = this._uin;
		this._uin = state.uin || state.uinNumber.toString();
		this.loggedIn = state.loggedIn && isRealUin(this._uin);
		if (this.loggedIn) {
			this.stopLoginReconcile();
			if (this.receiveWatchUin !== this._uin) {
				this.resetReceiveWatch(this._uin);
				this._outboundHealthy = true;
			}
		} else {
			this.resetReceiveWatch();
			this._outboundHealthy = true;
		}
		if (this.connected || this.loggedIn) this.applyStatus(wasLoggedIn, this.loggedIn ? "" : this._error);
		if (!this.loggedIn || !this.sender) return;
		if (wasLoggedIn && previousUin === this._uin) return;
		runWithTraceRequest(() => {
			const startedAt = Date.now();
			this.log.trace("hook_session_login_start pid=%d previousUin=%j uin=%j", this.pid, previousUin, this._uin);
			try {
				this.emit("login", this._uin, this.sender);
				this.log.success("login detected: PID=%d UIN=%s", this.pid, this._uin);
				this.log.trace(() => [
					"hook_session_login_terminal pid=%d outcome=completed reason=login_detected previousUin=%j uin=%j state=%s elapsedMs=%d",
					this.pid,
					previousUin,
					this._uin,
					renderParamsVerbose(this.toInfo()),
					Date.now() - startedAt
				]);
			} catch (error) {
				this.log.trace(() => [
					"hook_session_login_terminal pid=%d outcome=failed reason=listener_failed error=%j state=%s elapsedMs=%d",
					this.pid,
					errorMessage(error),
					renderParamsVerbose(this.toInfo()),
					Date.now() - startedAt
				]);
				throw error;
			}
		});
	}
	startLoginReconcile() {
		if (this.loginReconcileTimer || this.disposed || this.runtimeFailure) return;
		this.log.info("awaiting login: PID=%d", this.pid);
		this.detectLoginOnce();
		this.loginReconcileTimer = setInterval(() => void this.detectLoginOnce(), LOGIN_RECONCILE_INTERVAL_MS);
		this.loginReconcileTimer.unref();
	}
	stopLoginReconcile() {
		if (this.loginReconcileTimer) {
			clearInterval(this.loginReconcileTimer);
			this.loginReconcileTimer = null;
		}
	}
	async detectLoginOnce() {
		if (this.detecting) return;
		const client = this.client;
		if (this.disposed || !client || !this.connected || this.loggedIn || this.runtimeFailure) {
			this.stopLoginReconcile();
			return;
		}
		if (Date.now() < this.nextLoginIdentityObservationAt) return;
		this.detecting = true;
		try {
			let uin;
			try {
				uin = await this.detectLoginUin(this.pid);
			} catch (error) {
				const message = errorMessage(error);
				if (this.lastDetectFailure !== message) {
					this.lastDetectFailure = message;
					this.log.warn("login identity detection failed: PID=%d err=%s", this.pid, message);
				}
				return;
			}
			if (this.client !== client || this.disposed || !this.connected || this.loggedIn || this.runtimeFailure) return;
			this.lastDetectFailure = "";
			if (uin !== null && isRealUin(uin)) {
				if (this.acceptedLoginHintUin === uin) {
					this.nextLoginIdentityObservationAt = Date.now() + LOGIN_IDENTITY_OBSERVE_INTERVAL_MS;
					return;
				}
				if (this.loginHintAttemptUin !== uin) {
					this.loginHintAttemptUin = uin;
					this.loginHintAttempts = 0;
					this.nextLoginHintAt = 0;
					this.nextLoginIdentityObservationAt = 0;
				}
				if (this.loginHintAttempts >= LOGIN_HINT_MAX_ATTEMPTS || Date.now() < this.nextLoginHintAt) return;
				const attempt = ++this.loginHintAttempts;
				this.log.info("login identity discovered: PID=%d UIN=%s; awaiting readiness", this.pid, uin);
				try {
					await client.reconcileLoginIdentity(uin);
					if (this.client !== client || this.disposed || !this.connected || this.loggedIn || this.runtimeFailure) return;
					this.acceptedLoginHintUin = uin;
					this.nextLoginIdentityObservationAt = Date.now() + LOGIN_IDENTITY_OBSERVE_INTERVAL_MS;
				} catch (error) {
					if (this.client !== client || this.disposed || this.runtimeFailure) return;
					if (attempt >= LOGIN_HINT_MAX_ATTEMPTS) {
						this.log.warn("login identity reconciliation failed: PID=%d UIN=%s attempts=%d err=%s", this.pid, uin, attempt, errorMessage(error));
						this.nextLoginIdentityObservationAt = Date.now() + LOGIN_IDENTITY_OBSERVE_INTERVAL_MS;
					} else {
						this.nextLoginHintAt = Date.now() + LOGIN_HINT_RETRY_DELAYS_MS[attempt - 1];
						this.log.trace("login identity hint failed: PID=%d UIN=%s attempt=%d err=%s", this.pid, uin, attempt, errorMessage(error));
					}
				}
			}
		} finally {
			this.detecting = false;
		}
	}
	resetLoginHint() {
		this.acceptedLoginHintUin = "";
		this.loginHintAttemptUin = "";
		this.loginHintAttempts = 0;
		this.nextLoginHintAt = 0;
		this.nextLoginIdentityObservationAt = 0;
		this.lastDetectFailure = "";
	}
	handlePacket(packet) {
		if (!this.loggedIn) return;
		if (packet.source === "client-message" && (!isRealUin(packet.uin) || packet.uin !== this._uin)) {
			this.log.warn("Client message receipt belongs to an inactive account: PID=%d", this.pid);
			return;
		}
		const uin = packet.uin || this._uin;
		const receiveUin = isRealUin(uin) ? uin : this.receiveWatchUin || this._uin;
		if (isRealUin(receiveUin)) this.noteReceiveActivity(packet.cmd, receiveUin);
		if (!isRealUin(uin)) return;
		if (!this.onPacket) return;
		this.onPacket({
			pid: this.pid,
			uin,
			serviceCmd: packet.cmd,
			seqId: packet.seq,
			retCode: packet.error,
			fromClient: false,
			...packet.source ? { source: packet.source } : {},
			body: Buffer.from(packet.body)
		});
	}
	setStatus(status, error) {
		if (this._status === status && this._error === error) return;
		this._status = status;
		this._error = error;
		this.emit("status-changed", status, error);
	}
	noteReceiveActivity(cmd, uin) {
		if (this.receiveWatchUin !== uin) this.resetReceiveWatch(uin);
		if (!this.receiveWatchArmed) {
			if (cmd !== QQ_RECV_HEARTBEAT_CMD) return;
			this.receiveWatchArmed = true;
			this.log.debug("receive health armed by QQ heartbeat: PID=%d UIN=%s", this.pid, this.receiveWatchUin);
		}
		const now = Date.now();
		const silentForMs = this.lastReceiveAt > 0 ? now - this.lastReceiveAt : 0;
		this.lastReceiveAt = now;
		this.scheduleReceiveStaleCheck();
		if (!this._receiveHealthy) {
			this.setReceiveHealthy(true);
			this.log.info("receive path recovered: PID=%d UIN=%s silentFor=%dms", this.pid, this.receiveWatchUin, silentForMs);
		}
	}
	scheduleReceiveStaleCheck() {
		if (this.receiveWatchTimer) clearTimeout(this.receiveWatchTimer);
		this.receiveWatchTimer = setTimeout(() => {
			this.receiveWatchTimer = null;
			if (!this.shouldWatchReceive()) return;
			this.receiveWatchTimer = setTimeout(() => {
				this.receiveWatchTimer = null;
				if (!this.shouldWatchReceive()) return;
				const silentForMs = Date.now() - this.lastReceiveAt;
				if (silentForMs < 105e3) {
					this.scheduleReceiveStaleCheck();
					return;
				}
				this.setReceiveHealthy(false);
				this.log.warn("receive path stale: PID=%d UIN=%s lastRecvAt=%s silentFor=%dms; reporting good=false", this.pid, this.receiveWatchUin, new Date(this.lastReceiveAt).toISOString(), silentForMs);
			}, RECEIVE_STALE_CONFIRM_MS);
			this.receiveWatchTimer.unref();
		}, RECEIVE_STALE_AFTER_MS);
		this.receiveWatchTimer.unref();
	}
	shouldWatchReceive() {
		return !this.disposed && this.connected && this.loggedIn && this.receiveWatchArmed;
	}
	setReceiveHealthy(healthy) {
		if (this._receiveHealthy === healthy) return;
		const previous = this.receiveHealthy;
		this._receiveHealthy = healthy;
		if (previous !== this.receiveHealthy) this.emit("receive-health-changed", this.receiveHealthy);
	}
	setOutboundHealthy(healthy) {
		if (this._outboundHealthy === healthy) return;
		const previous = this.receiveHealthy;
		this._outboundHealthy = healthy;
		if (previous !== this.receiveHealthy) this.emit("receive-health-changed", this.receiveHealthy);
		if (healthy) this.log.info("request path recovered: PID=%d UIN=%s", this.pid, this._uin);
		else this.log.warn("request path unavailable: PID=%d UIN=%s; reporting good=false", this.pid, this._uin);
	}
	resetReceiveWatch(uin = "") {
		if (this.receiveWatchTimer) {
			clearTimeout(this.receiveWatchTimer);
			this.receiveWatchTimer = null;
		}
		this.receiveWatchUin = uin;
		this.receiveWatchArmed = false;
		this.lastReceiveAt = 0;
		this._receiveHealthy = true;
	}
};
export {};
