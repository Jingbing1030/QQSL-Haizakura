// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/network/ws-server-adapter.ts"
// original bundle lines 342282-342457  (174 lines) of dist/index.mjs
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
var moduleLog$2 = createLogger("OneBot.WS-Server");
var WsServerAdapter = class extends IOneBotNetworkAdapter {
	wss = null;
	listening = false;
	releaseForced = false;
	closePromise = null;
	connections;
	constructor(name, config, ctx) {
		super(name, config, ctx, moduleLog$2);
		this.connections = new WsServerConnections(name, standaloneConnectionConfig(config), ctx, this.log, {
			frame: (event, options) => this.metaFrame(event, options),
			bootstrap: (options) => this.bootstrapMetaFrames(options)
		});
	}
	async open() {
		if (this.isEnabled && this.listening) return;
		if (this.config.enabled === false) return;
		if (this.wss) throw new Error(`WebSocket adapter [${this.name}] still owns a previous server`);
		await this.startServer();
		this.isEnabled = true;
		this.clearApplyFailure();
	}
	async close() {
		if (this.closePromise) return this.closePromise;
		if (!this.isEnabled && this.connections.connectionCount === 0 && !this.wss && !this.connections.hasInFlightActions) return;
		const wasEnabled = this.isEnabled;
		const wasListening = this.listening;
		const wasAcceptingActions = this.connections.isAcceptingActions;
		this.isEnabled = false;
		this.listening = false;
		const connectionDrain = this.connections.closeConnections();
		const wss = this.wss;
		const releaseResult = wss ? new Promise((resolve) => {
			wss.close((error) => resolve(error && !isAlreadyClosedError(error) ? { error } : {}));
		}) : Promise.resolve({});
		const attempt = (async () => {
			await connectionDrain;
			const release = await releaseResult;
			if (release.error) throw release.error;
		})();
		this.closePromise = attempt;
		try {
			await attempt;
			if (wss && this.wss === wss) this.wss = null;
		} catch (error) {
			if (this.releaseForced) return;
			this.isEnabled = wasEnabled;
			this.listening = wasListening;
			if (wasAcceptingActions) this.connections.startAccepting();
			throw error;
		} finally {
			this.closePromise = null;
		}
	}
	forceClose() {
		this.releaseForced = true;
		this.isEnabled = false;
		this.listening = false;
		this.connections.stopAccepting();
		this.connections.terminateAll();
		const wss = this.wss;
		this.wss = null;
		if (wss) try {
			wss.destroy();
		} catch {}
	}
	describeStatus() {
		if (!this.isEnabled) return {
			name: this.name,
			kind: "wsServer",
			status: "disabled",
			detail: "未启用"
		};
		if (!this.listening) return {
			name: this.name,
			kind: "wsServer",
			status: "down",
			detail: "未监听（端口被占用？）"
		};
		return {
			name: this.name,
			kind: "wsServer",
			status: "ok",
			detail: `${this.connections.connectionCount} 个客户端`
		};
	}
	bindingSignature(config) {
		return `${config.host ?? "0.0.0.0"}:${config.port}${normalizePath(config.path)}#${config.role ?? "auto"}#${config.accessToken ?? ""}#${config.maxPayloadBytes ?? ""}`;
	}
	onConfigReplaced(next) {
		this.connections.updateConfig(standaloneConnectionConfig(next));
	}
	onEvent(_event, payload) {
		if (!this.isEnabled) return;
		this.connections.onEvent(payload);
	}
	startServer() {
		return new Promise((resolve, reject) => {
			let wss;
			try {
				wss = new WebSocketServer({
					host: this.config.host ?? "0.0.0.0",
					port: this.config.port,
					maxPayload: this.config.maxPayloadBytes,
					verifyClient: ({ req }, done) => {
						const requestPath = parseRequestPath(req.url ?? "/");
						if (!this.connections.acceptsUpgradePath(requestPath)) {
							this.log.debug("[%s] rejected unknown WebSocket path %s", this.name, requestPath);
							done(false, 400, "Bad path for WebSocket");
							return;
						}
						if (!this.connections.authorizeUpgrade(req)) {
							done(false, 401, "Unauthorized");
							return;
						}
						done(true);
					}
				});
			} catch (error) {
				this.recordTransportFailure(error);
				reject(error);
				return;
			}
			this.wss = wss;
			let opening = true;
			wss.once("listening", () => {
				opening = false;
				if (this.wss !== wss || this.closePromise) {
					wss.close();
					reject(/* @__PURE__ */ new Error(`WebSocket adapter [${this.name}] was closed while binding`));
					return;
				}
				this.listening = true;
				this.isEnabled = true;
				this.connections.startAccepting();
				this.log.success("[%s] listening %s:%d%s", this.name, this.config.host ?? "0.0.0.0", this.config.port, this.config.path ?? "/");
				resolve();
			});
			wss.on("error", (error) => {
				if (this.wss === wss) {
					this.listening = false;
					this.isEnabled = false;
					this.connections.stopAccepting();
					this.recordTransportFailure(error);
					if (opening) this.wss = null;
				}
				this.log.error("[%s] server error: %s", this.name, error instanceof Error ? error.message : String(error));
				if (opening) {
					opening = false;
					reject(error);
				}
			});
			wss.on("connection", (socket, request) => this.connections.accept(socket, request));
		});
	}
	/** Kept as the adapter-level lifecycle test seam. */
	get acceptingActions() {
		return this.connections.isAcceptingActions;
	}
	/** Kept as the adapter-level lifecycle test seam. */
	trackInboundAction(start) {
		this.connections.trackInboundAction(start);
	}
};
function isAlreadyClosedError(error) {
	return error.code === "ERR_SERVER_NOT_RUNNING";
}
function standaloneConnectionConfig(config) {
	return {
		...config,
		role: config.role ?? "Universal"
	};
}
export {};
