// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/network/http-server-adapter.ts"
// original bundle lines 341235-341741  (505 lines) of dist/index.mjs
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
var moduleLog$4 = createLogger("OneBot.HTTP");
var HttpServerAdapter = class extends IOneBotNetworkAdapter {
	server = null;
	webSocketServer = null;
	listening = false;
	releaseForced = false;
	closePromise = null;
	acceptingActions = false;
	inFlightActions = /* @__PURE__ */ new Set();
	webSocketConnections;
	sseConnections;
	constructor(name, config, ctx) {
		super(name, config, ctx, moduleLog$4);
		this.sseConnections = new HttpSseConnections(config, this.log, () => this.bootstrapMetaFrames(resolveReportOptions(this.config)));
		this.webSocketConnections = new WsServerConnections(name, config, ctx, this.log, {
			frame: (event, options) => this.metaFrame(event, options),
			bootstrap: (options) => this.bootstrapMetaFrames(options)
		});
	}
	async open() {
		if (this.isEnabled && this.listening) return;
		if (this.config.enabled === false) return;
		if (this.server) throw new Error(`HTTP adapter [${this.name}] still owns a previous server`);
		if (this.webSocketServer) throw new Error(`HTTP adapter [${this.name}] still owns a previous WebSocket upgrade handler`);
		await this.startServer();
		this.isEnabled = true;
		this.clearApplyFailure();
	}
	async close() {
		if (this.closePromise) return this.closePromise;
		if (!this.isEnabled && !this.server && !this.webSocketServer && this.inFlightActions.size === 0 && !this.webSocketConnections.hasInFlightActions) return;
		const wasEnabled = this.isEnabled;
		const wasListening = this.listening;
		const wasAcceptingActions = this.acceptingActions;
		const wasAcceptingWebSocketActions = this.webSocketConnections.isAcceptingActions;
		this.acceptingActions = false;
		this.webSocketConnections.stopAccepting();
		this.sseConnections.close("server closing");
		this.isEnabled = false;
		this.listening = false;
		const server = this.server;
		const webSocketServer = this.webSocketServer;
		const webSocketDrain = webSocketServer ? this.webSocketConnections.closeConnections() : Promise.resolve();
		const releaseHttp = server ? new Promise((resolve, reject) => {
			server.close((error) => {
				if (error && !isAlreadyClosedError$1(error)) reject(error);
				else resolve();
			});
		}) : Promise.resolve();
		let httpReleased = false;
		const attempt = (async () => {
			await Promise.all([
				releaseHttp,
				Promise.all(this.inFlightActions),
				webSocketDrain
			]);
			httpReleased = true;
			if (this.server === server) this.server = null;
			if (webSocketServer) {
				const releaseWebSocket = new Promise((resolve, reject) => {
					webSocketServer.close((error) => {
						if (error && !isAlreadyClosedError$1(error)) reject(error);
						else resolve();
					});
				});
				await Promise.all([releaseWebSocket, this.webSocketConnections.closeConnections()]);
				if (this.webSocketServer === webSocketServer) this.webSocketServer = null;
			}
		})();
		this.closePromise = attempt;
		try {
			await attempt;
		} catch (error) {
			if (this.releaseForced) return;
			if (!httpReleased && server?.listening === true) {
				this.isEnabled = wasEnabled;
				this.listening = wasListening;
				this.acceptingActions = wasAcceptingActions;
				if (wasAcceptingWebSocketActions) this.webSocketConnections.startAccepting();
			}
			throw error;
		} finally {
			this.closePromise = null;
		}
	}
	forceClose() {
		this.releaseForced = true;
		this.acceptingActions = false;
		this.webSocketConnections.stopAccepting();
		this.sseConnections.close("server closing");
		this.isEnabled = false;
		this.listening = false;
		this.webSocketConnections.terminateAll();
		const webSocketServer = this.webSocketServer;
		this.webSocketServer = null;
		const server = this.server;
		this.server = null;
		if (webSocketServer) try {
			webSocketServer.destroy();
		} catch {}
		if (server) {
			try {
				server.closeAllConnections();
			} catch {}
			try {
				server.close(() => void 0);
			} catch {}
		}
	}
	describeStatus() {
		if (!this.isEnabled) return {
			name: this.name,
			kind: "httpServer",
			status: "disabled",
			detail: "未启用"
		};
		if (!this.listening) return {
			name: this.name,
			kind: "httpServer",
			status: "down",
			detail: "未监听（端口被占用？）"
		};
		let detail = this.config.enableWebSocket === true ? `监听中 · WebSocket ${this.webSocketConnections.connectionCount} 个客户端` : "监听中";
		if (this.config.enableSse === true) detail += ` · SSE ${this.sseConnections.connectionCount} 个客户端`;
		return {
			name: this.name,
			kind: "httpServer",
			status: "ok",
			detail
		};
	}
	bindingSignature(config) {
		const webSocket = config.enableWebSocket === true ? "ws" : "http";
		const maxPayload = config.enableWebSocket === true ? config.maxPayloadBytes ?? "" : "";
		return `${config.host ?? "0.0.0.0"}:${config.port}${normalizePath(config.path ?? "/")}#${webSocket}#${maxPayload}`;
	}
	onConfigReplaced(next) {
		this.webSocketConnections.updateConfig(next);
		this.sseConnections.updateConfig(next);
	}
	onEvent(_event, payload) {
		if (!this.isEnabled) return;
		if (this.config.enableWebSocket === true) this.webSocketConnections.onEvent(payload);
		if (this.config.enableSse === true) this.sseConnections.onEvent(payload);
	}
	startServer() {
		return new Promise((resolve, reject) => {
			const server = createServer$1((req, res) => {
				this.trackInboundAction(req, res);
			});
			this.server = server;
			let webSocketServer = null;
			try {
				if (this.config.enableWebSocket === true) {
					webSocketServer = new WebSocketServer({
						server,
						maxPayload: this.config.maxPayloadBytes,
						verifyClient: ({ req }) => this.webSocketConnections.authorizeUpgrade(req)
					});
					webSocketServer.on("connection", (socket, request) => {
						this.webSocketConnections.accept(socket, request);
					});
					webSocketServer.on("error", (error) => {
						this.recordTransportFailure(error);
						this.log.error("[%s] embedded WebSocket error: %s", this.name, error instanceof Error ? error.message : String(error));
					});
					this.webSocketServer = webSocketServer;
				}
			} catch (error) {
				this.server = null;
				this.recordTransportFailure(error);
				reject(error);
				return;
			}
			let opening = true;
			server.once("listening", () => {
				opening = false;
				if (this.server !== server || this.closePromise) {
					webSocketServer?.close();
					server.close();
					reject(/* @__PURE__ */ new Error(`HTTP adapter [${this.name}] was closed while binding`));
					return;
				}
				this.listening = true;
				this.isEnabled = true;
				this.acceptingActions = true;
				if (webSocketServer) this.webSocketConnections.startAccepting();
				this.log.success("[%s] listening %s:%d%s%s", this.name, this.config.host ?? "0.0.0.0", this.config.port, normalizePath(this.config.path ?? "/"), webSocketServer ? " with WebSocket" : "");
				resolve();
			});
			server.on("error", (error) => {
				if (this.server === server) {
					this.listening = false;
					this.isEnabled = false;
					this.acceptingActions = false;
					this.webSocketConnections.stopAccepting();
					this.sseConnections.close("server closing");
					this.recordTransportFailure(error);
					if (opening) {
						this.server = null;
						if (this.webSocketServer === webSocketServer) this.webSocketServer = null;
						webSocketServer?.close();
					}
				}
				this.log.error("[%s] server error: %s", this.name, error instanceof Error ? error.message : String(error));
				if (opening) {
					opening = false;
					reject(error);
				}
			});
			try {
				server.listen(this.config.port, this.config.host ?? "0.0.0.0");
			} catch (error) {
				opening = false;
				if (this.server === server) this.server = null;
				if (this.webSocketServer === webSocketServer) this.webSocketServer = null;
				webSocketServer?.close();
				this.recordTransportFailure(error);
				reject(error);
			}
		});
	}
	handleRequest(req, res) {
		return runWithTraceRequest(() => this.handleRequestInContext(req, res));
	}
	async handleRequestInContext(req, res) {
		const apiQuiescedAtIngress = this.ctx.api.isAcceptingActions === false;
		if (apiQuiescedAtIngress) writeJson(res, 503, serverClosingResponse());
		const respond = (statusCode, data) => {
			if (apiQuiescedAtIngress) return;
			writeJson(res, statusCode, data);
		};
		const expectedPath = normalizePath(this.config.path ?? "/");
		const accessToken = this.config.accessToken ?? "";
		const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
		const incomingPath = parsedUrl.pathname;
		const ep = expectedPath.endsWith("/") ? expectedPath : expectedPath + "/";
		let action = "";
		if (incomingPath === expectedPath || incomingPath === expectedPath + "/") action = "";
		else if (incomingPath.startsWith(ep)) action = incomingPath.substring(ep.length);
		else {
			respond(404, {
				status: "failed",
				retcode: 1404,
				data: null,
				wording: "not found"
			});
			return;
		}
		if (!isAuthorized(req, accessToken, true)) {
			respond(401, {
				status: "failed",
				retcode: 1401,
				data: null,
				wording: "unauthorized"
			});
			return;
		}
		if (action === "_events") {
			if (apiQuiescedAtIngress) return;
			if (this.config.enableSse !== true) respond(404, {
				status: "failed",
				retcode: 1404,
				data: null,
				wording: "SSE is disabled"
			});
			else if (req.method !== "GET") {
				res.setHeader("Allow", "GET");
				respond(405, {
					status: "failed",
					retcode: 1405,
					data: null,
					wording: "SSE requires GET"
				});
			} else this.sseConnections.accept(req, res);
			return;
		}
		if (req.headers.traceparent !== void 0) {
			const traceparent = httpTraceparent(req.headers.traceparent);
			if (traceparent) this.log.trace("http_trace traceparent=%s", traceparent);
			else this.log.trace("http_trace ignored invalid traceparent");
		}
		if (req.method === "GET" && !action) {
			respond(200, {
				status: "ok",
				retcode: 0,
				data: { online: true }
			});
			return;
		}
		try {
			let params = {};
			let echo;
			if (req.method === "GET") parsedUrl.searchParams.forEach((value, key) => {
				try {
					params[key] = JSON.parse(value);
				} catch {
					params[key] = value;
				}
			});
			else if (req.method === "POST") {
				const bodyContent = await readRequestBody(req);
				if (bodyContent.trim()) {
					const contentType = req.headers["content-type"] ?? "";
					if (contentType.includes("application/x-www-form-urlencoded")) {
						new URLSearchParams(bodyContent).forEach((value, key) => {
							try {
								params[key] = JSON.parse(value);
							} catch {
								params[key] = value;
							}
						});
						if (params.action && !action) {
							action = String(params.action);
							delete params.action;
						}
						if (params.echo !== void 0) {
							echo = params.echo;
							delete params.echo;
						}
					} else if (contentType.includes("application/json") || !contentType) try {
						const parsedBody = JSON.parse(bodyContent);
						if (typeof parsedBody === "object" && parsedBody !== null && !Array.isArray(parsedBody)) {
							if (parsedBody.action && !action) action = String(parsedBody.action);
							if (parsedBody.params && typeof parsedBody.params === "object" && !Array.isArray(parsedBody.params)) params = parsedBody.params;
							else params = parsedBody;
							echo = parsedBody.echo;
						}
					} catch {
						if (contentType.includes("application/json")) {
							respond(400, {
								status: "failed",
								retcode: 1400,
								data: null,
								wording: "bad request: invalid json"
							});
							return;
						}
						new URLSearchParams(bodyContent).forEach((value, key) => {
							try {
								params[key] = JSON.parse(value);
							} catch {
								params[key] = value;
							}
						});
						if (params.action && !action) {
							action = String(params.action);
							delete params.action;
						}
						if (params.echo !== void 0) {
							echo = params.echo;
							delete params.echo;
						}
					}
					else {
						respond(400, {
							status: "failed",
							retcode: 1400,
							data: null,
							wording: `bad request: unsupported content-type: ${contentType}`
						});
						return;
					}
				}
			} else {
				respond(405, {
					status: "failed",
					retcode: 1400,
					data: null,
					wording: "method not allowed"
				});
				return;
			}
			if (!action) {
				respond(400, {
					status: "failed",
					retcode: 1400,
					data: null,
					wording: "bad request: missing action"
				});
				return;
			}
			if (apiQuiescedAtIngress) {
				const response = serverClosingResponse();
				this.ctx.api.traceQuiescedAction(action, params, response);
				respond(503, response);
				return;
			}
			if (this.ctx.api.isStreamAction(action)) {
				await streamHttpResponse(res, this.ctx.api, action, params, echo);
				return;
			}
			const response = await this.ctx.api.handle(action, params);
			if (echo !== void 0) response.echo = echo;
			respond(200, response);
		} catch (error) {
			const wording = error instanceof Error ? error.message : "internal error";
			const tooLarge = error instanceof RequestBodyTooLargeError;
			respond(tooLarge ? 413 : 500, {
				status: "failed",
				retcode: tooLarge ? 1413 : 1200,
				data: null,
				wording
			});
		}
	}
	trackInboundAction(req, res) {
		if (!this.acceptingActions) {
			writeJson(res, 503, serverClosingResponse());
			return;
		}
		if (this.ctx.api.isAcceptingActions === false) {
			this.handleRequest(req, res).catch((error) => {
				this.log.warn("[%s] quiesced inbound action trace failed: %s", this.name, error instanceof Error ? error.stack ?? error.message : String(error));
			});
			return;
		}
		let action;
		try {
			action = this.handleRequest(req, res);
		} catch (error) {
			this.log.error("[%s] inbound action start failed: %s", this.name, error instanceof Error ? error.stack ?? error.message : String(error));
			writeJson(res, 500, {
				status: "failed",
				retcode: 1200,
				data: null,
				wording: "internal error"
			});
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
function serverClosingResponse() {
	return {
		status: "failed",
		retcode: 1200,
		data: null,
		wording: "server closing"
	};
}
function isAlreadyClosedError$1(error) {
	return error.code === "ERR_SERVER_NOT_RUNNING";
}
var RequestBodyTooLargeError = class extends Error {};
function readRequestBody(req, maxBytes = 64 * 1024 * 1024) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let total = 0;
		let exceeded = false;
		req.on("data", (chunk) => {
			if (exceeded) return;
			total += chunk.length;
			if (total > maxBytes) {
				exceeded = true;
				chunks.length = 0;
				reject(new RequestBodyTooLargeError("request body too large"));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}
function writeJson(res, statusCode, data) {
	if (res.headersSent || res.writableEnded || res.destroyed) return;
	res.statusCode = statusCode;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.end(JSON.stringify(data));
}
/** Stream a multi-frame Stream API response (#163): chunked transfer (no
*  Content-Length → Node frames it), each frame a JSON envelope delimited by
*  `\r\n\r\n`, the action's terminal response written last. Matches NapCat:
*  the body is `\r\n\r\n`-joined JSON objects, NOT a single JSON document, so
*  no `application/json` Content-Type is claimed. Each `res.write` is awaited
*  (flush callback) for backpressure, and the sink aborts the action once the
*  client disconnects so a big download stops pumping into a dead socket. */
async function streamHttpResponse(res, api, action, params, echo) {
	res.statusCode = 200;
	const writeFrame = (frame) => new Promise((resolve, reject) => {
		if (res.writableEnded || res.destroyed) {
			reject(new StreamTransportClosedError("stream client disconnected"));
			return;
		}
		res.write(JSON.stringify(frame) + "\r\n\r\n", (error) => {
			if (error) {
				reject(new StreamTransportClosedError("stream client disconnected"));
				return;
			}
			resolve();
		});
	});
	await writeFrame(wrapStreamTerminal(await api.handle(action, params, { send: async (frame) => {
		await writeFrame(wrapStreamFrame(frame, echo));
	} }), echo));
	if (!res.writableEnded && !res.destroyed) res.end();
}
export {};
