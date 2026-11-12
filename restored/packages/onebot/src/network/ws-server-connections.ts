// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/network/ws-server-connections.ts"
// original bundle lines 340852-341053  (200 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var HEARTBEAT_INTERVAL_MS$1 = 3e4;
var HEARTBEAT_MAX_MISSED$1 = 2;
var HEARTBEAT_DEAD_AFTER_S$1 = HEARTBEAT_INTERVAL_MS$1 * 3 / 1e3;
/**
* Shared OneBot WebSocket session owner.
*
* Listener ownership deliberately stays in the network adapter: a standalone
* WS adapter owns its TCP listener, while an HTTP adapter owns the shared
* listener and only attaches an upgrade handler. This class owns everything
* after a WebSocket connection is accepted so both transports keep identical
* auth, role, event, heartbeat, stream, and shutdown semantics.
*/
var WsServerConnections = class {
	name;
	ctx;
	log;
	meta;
	acceptingActions = false;
	inFlightActions = /* @__PURE__ */ new Set();
	connections = /* @__PURE__ */ new Map();
	config;
	options;
	constructor(name, config, ctx, log, meta) {
		this.name = name;
		this.ctx = ctx;
		this.log = log;
		this.meta = meta;
		this.config = structuredClone(config);
		this.options = resolveReportOptions(config);
	}
	get connectionCount() {
		return this.connections.size;
	}
	get isAcceptingActions() {
		return this.acceptingActions;
	}
	get hasInFlightActions() {
		return this.inFlightActions.size > 0;
	}
	startAccepting() {
		this.acceptingActions = true;
	}
	stopAccepting() {
		this.acceptingActions = false;
	}
	updateConfig(next) {
		const tokenChanged = (this.config.accessToken ?? "") !== (next.accessToken ?? "");
		this.config = structuredClone(next);
		this.options = resolveReportOptions(next);
		for (const connection of this.connections.values()) connection.options = this.options;
		if (tokenChanged) this.disconnectAll(1008, "access token changed");
	}
	acceptsUpgradePath(requestPath) {
		return resolveForwardRole(requestPath, this.config) !== null;
	}
	onEvent(payload) {
		if (!this.acceptingActions || this.connections.size === 0) return;
		for (const connection of this.connections.values()) {
			if (connection.role !== "Event" && connection.role !== "Universal") continue;
			const json = pickDispatchJson(payload, connection.options);
			if (json === null) continue;
			safeSend(connection.socket, json);
		}
	}
	/** Authenticate the HTTP upgrade before a WebSocket object is allocated. */
	authorizeUpgrade(request) {
		const authorized = isAuthorized(request, this.config.accessToken ?? "");
		if (!authorized) this.log.debug("[%s] rejected unauthorized WebSocket upgrade", this.name);
		return authorized;
	}
	accept(socket, request) {
		if (!this.acceptingActions || this.ctx.api.isAcceptingActions === false) {
			safeClose(socket, 1012, "server closing");
			return;
		}
		if (!this.authorizeUpgrade(request)) {
			safeClose(socket, 1008, "invalid access token");
			return;
		}
		const role = resolveForwardRole(parseRequestPath(request.url ?? "/"), this.config);
		if (role === null) {
			this.log.warn("[%s] rejected WebSocket path after upgrade", this.name);
			safeClose(socket, 1008, "invalid path");
			return;
		}
		const stopHeartbeat = startHeartbeat(socket, {
			intervalMs: HEARTBEAT_INTERVAL_MS$1,
			maxMissed: HEARTBEAT_MAX_MISSED$1
		}, () => {
			this.log.warn("[%s] client silent for ~%ds, terminating half-open connection", this.name, HEARTBEAT_DEAD_AFTER_S$1);
			socket.terminate();
		});
		const connection = {
			socket,
			role,
			options: this.options,
			stopHeartbeat
		};
		this.connections.set(socket, connection);
		socket.on("message", (raw) => {
			if (!this.connections.has(socket)) return;
			if (this.ctx.api.isAcceptingActions === false) {
				this.log.warn("[%s] rejected inbound action after instance quiesce", this.name);
				if (role === "Api" || role === "Universal") {
					const text = rawDataToString(raw);
					if (text) this.ctx.api.traceQuiescedStreamRequest(text);
				}
				return;
			}
			this.trackInboundAction(() => this.handleApiMessage(socket, role, raw));
		});
		socket.on("close", () => {
			stopHeartbeat();
			this.connections.delete(socket);
		});
		socket.on("error", (error) => {
			const message = error instanceof Error ? error.message : String(error);
			this.log.warn("[%s] socket error: %s", this.name, error.code === 1009 ? `${message}. ${MAX_PAYLOAD_HINT}` : message);
		});
		if (role === "Event" || role === "Universal") for (const frame of this.meta.bootstrap(this.options)) safeSend(socket, frame);
	}
	async closeConnections() {
		this.stopAccepting();
		const lifecycle = this.ctx.buildLifecycleEvent("disable");
		for (const connection of this.connections.values()) {
			if (connection.role === "Api") continue;
			const frame = this.meta.frame(lifecycle, connection.options);
			if (frame) safeSend(connection.socket, frame);
		}
		this.disconnectAll();
		await Promise.all(this.inFlightActions);
	}
	disconnectAll(code = 1e3, reason = "normal") {
		for (const connection of this.connections.values()) {
			connection.stopHeartbeat();
			safeClose(connection.socket, code, reason);
		}
		this.connections.clear();
	}
	/** Destroy sockets immediately. A graceful close frame can leave the
	*  listener waiting on a peer that will never answer. */
	terminateAll() {
		this.stopAccepting();
		for (const connection of this.connections.values()) {
			connection.stopHeartbeat();
			try {
				connection.socket.terminate();
			} catch {}
		}
		this.connections.clear();
	}
	async handleApiMessage(socket, role, raw) {
		const text = rawDataToString(raw);
		if (!text) {
			this.log.debug("[%s] ignored empty WebSocket frame", this.name);
			return;
		}
		if (role !== "Api" && role !== "Universal") {
			this.log.warn("[%s] rejected Action frame from Event-only connection", this.name);
			return;
		}
		await this.ctx.api.processStreamRequest(text, (frame) => safeSendAsync(socket, frame), () => socket.readyState === 1 && this.connections.has(socket));
	}
	trackInboundAction(start) {
		if (!this.acceptingActions || this.ctx.api.isAcceptingActions === false) {
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
};
function resolveForwardRole(requestPath, config) {
	if (config.role !== void 0 && (!requestPath.startsWith("/") || requestPath.startsWith("//"))) return null;
	const path = normalizePath(requestPath);
	if (config.role === void 0) return classifyForwardRole(path);
	const basePath = normalizePath(config.path);
	if (path === basePath) return config.role;
	if (config.role !== "Universal" || basePath !== "/") return null;
	if (path === "/api") return "Api";
	if (path === "/event") return "Event";
	return null;
}
function classifyForwardRole(path) {
	if (path.endsWith("/api")) return "Api";
	if (path.endsWith("/event")) return "Event";
	return "Universal";
}
export {};
