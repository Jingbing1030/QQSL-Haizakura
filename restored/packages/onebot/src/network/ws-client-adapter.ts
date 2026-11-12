// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/network/ws-client-adapter.ts"
// original bundle lines 342079-342281  (201 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
init_logger();
var moduleLog$3 = createLogger("OneBot.WS-Client");
var DEFAULT_RECONNECT_INTERVAL_MS = 5e3;
var HEARTBEAT_INTERVAL_MS = 3e4;
var HEARTBEAT_MAX_MISSED = 2;
var HEARTBEAT_DEAD_AFTER_S = HEARTBEAT_INTERVAL_MS * 3 / 1e3;
var WsClientAdapter = class extends IOneBotNetworkAdapter {
	socket = null;
	connected = false;
	reconnectTimer = null;
	options;
	role;
	inFlightActions = /* @__PURE__ */ new Set();
	heartbeatStop = null;
	constructor(name, config, ctx) {
		super(name, config, ctx, moduleLog$3);
		this.options = resolveReportOptions(config);
		this.role = config.role ?? "Universal";
	}
	open() {
		if (this.isEnabled || !this.willEnable(this.config)) return;
		this.isEnabled = true;
		try {
			this.connect();
			this.clearApplyFailure();
		} catch (error) {
			this.isEnabled = false;
			this.recordTransportFailure(error);
			throw error;
		}
	}
	forceClose() {
		this.isEnabled = false;
		this.connected = false;
		this.cancelReconnect();
		this.heartbeatStop?.();
		this.heartbeatStop = null;
		const socket = this.socket;
		this.socket = null;
		if (socket) try {
			socket.terminate();
		} catch {}
	}
	async close() {
		this.isEnabled = false;
		this.connected = false;
		this.cancelReconnect();
		this.heartbeatStop?.();
		this.heartbeatStop = null;
		if (this.socket) {
			safeClose(this.socket);
			this.socket = null;
		}
		await Promise.all(this.inFlightActions);
	}
	describeStatus() {
		if (!this.isEnabled) return {
			name: this.name,
			kind: "wsClient",
			status: "disabled",
			detail: "未启用"
		};
		if (this.connected) return {
			name: this.name,
			kind: "wsClient",
			status: "ok",
			detail: "已连接"
		};
		return {
			name: this.name,
			kind: "wsClient",
			status: "warn",
			detail: this.reconnectTimer ? "重连中" : "连接中"
		};
	}
	bindingSignature(config) {
		return `${config.url}#${config.role ?? "Universal"}#${Math.max(1e3, config.reconnectIntervalMs ?? DEFAULT_RECONNECT_INTERVAL_MS)}#${config.accessToken ?? ""}#${config.maxPayloadBytes ?? ""}`;
	}
	willEnable(config) {
		return config.enabled !== false && !!config.url;
	}
	onConfigReplaced(next) {
		this.options = resolveReportOptions(next);
		this.role = next.role ?? "Universal";
	}
	onEvent(_event, payload) {
		if (!this.isEnabled || !this.socket) return;
		if (this.role !== "Event" && this.role !== "Universal") return;
		const json = pickDispatchJson(payload, this.options);
		if (json === null) return;
		safeSend(this.socket, json);
	}
	connect() {
		if (!this.isEnabled) return;
		if (!this.config.url) return;
		if (this.socket) return;
		const headers = {
			"User-Agent": "OneBot/11",
			"X-Self-ID": this.ctx.uin,
			"X-Client-Role": this.role
		};
		if (this.config.accessToken) headers.Authorization = `Bearer ${this.config.accessToken}`;
		const socket = new WebSocket(this.config.url, {
			headers,
			maxPayload: this.config.maxPayloadBytes
		});
		this.socket = socket;
		let stopHeartbeat = null;
		socket.on("open", () => {
			if (this.socket !== socket) return;
			this.connected = true;
			this.log.info("[%s] connected %s", this.name, this.config.url);
			this.sendBootstrapMetaEvents(socket);
			stopHeartbeat = startHeartbeat(socket, {
				intervalMs: HEARTBEAT_INTERVAL_MS,
				maxMissed: HEARTBEAT_MAX_MISSED
			}, () => {
				if (!this.isEnabled) return;
				this.log.warn("[%s] no inbound response for ~%ds, reconnecting half-open connection %s", this.name, HEARTBEAT_DEAD_AFTER_S, this.config.url);
				socket.terminate();
			});
			this.heartbeatStop = stopHeartbeat;
		});
		socket.on("message", (raw) => {
			if (this.socket !== socket) {
				this.log.warn("[%s] rejected inbound action from stale socket", this.name);
				return;
			}
			if (this.ctx.api.isAcceptingActions === false) {
				this.log.warn("[%s] rejected inbound action after instance quiesce", this.name);
				if (this.role === "Api" || this.role === "Universal") {
					const text = rawDataToString(raw);
					if (text) this.ctx.api.traceQuiescedStreamRequest(text);
				}
				return;
			}
			this.trackInboundAction(() => this.handleApiMessage(socket, raw));
		});
		socket.on("close", () => {
			stopHeartbeat?.();
			if (this.heartbeatStop === stopHeartbeat) this.heartbeatStop = null;
			stopHeartbeat = null;
			if (this.socket !== socket) return;
			this.socket = null;
			this.connected = false;
			if (!this.isEnabled) return;
			this.scheduleReconnect();
		});
		socket.on("error", (err) => {
			const message = err instanceof Error ? err.message : String(err);
			this.log.warn("[%s] error %s: %s", this.name, this.config.url, err.code === 1009 ? `${message}. ${MAX_PAYLOAD_HINT}` : message);
		});
	}
	scheduleReconnect() {
		if (this.reconnectTimer) return;
		if (!this.isEnabled) return;
		const interval = Math.max(1e3, this.config.reconnectIntervalMs ?? DEFAULT_RECONNECT_INTERVAL_MS);
		const timer = setTimeout(() => {
			this.reconnectTimer = null;
			if (!this.isEnabled) return;
			this.connect();
		}, interval);
		timer.unref();
		this.reconnectTimer = timer;
	}
	cancelReconnect() {
		if (!this.reconnectTimer) return;
		clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
	}
	async handleApiMessage(socket, raw) {
		if (this.role !== "Api" && this.role !== "Universal") return;
		const text = rawDataToString(raw);
		if (!text) return;
		await this.ctx.api.processStreamRequest(text, (frame) => safeSendAsync(socket, frame), () => socket.readyState === 1);
	}
	trackInboundAction(start) {
		if (!this.isEnabled || this.ctx.api.isAcceptingActions === false) {
			this.log.warn("[%s] rejected inbound action while adapter is closing", this.name);
			return;
		}
		let action;
		try {
			action = start();
		} catch (error) {
			this.log.error("[%s] inbound action start failed: %s", this.name, error instanceof Error ? error.stack ?? error.message : String(error));
			return;
		}
		const tracked = action.then(() => void 0, (error) => {
			this.log.error("[%s] inbound action failed: %s", this.name, error instanceof Error ? error.stack ?? error.message : String(error));
		});
		this.inFlightActions.add(tracked);
		tracked.then(() => {
			this.inFlightActions.delete(tracked);
		});
	}
	sendBootstrapMetaEvents(socket) {
		if (this.role !== "Event" && this.role !== "Universal") return;
		for (const frame of this.bootstrapMetaFrames(this.options)) safeSend(socket, frame);
	}
};
export {};
