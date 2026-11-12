// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../websocket/src/server.ts"
// original bundle lines 340318-340532  (213 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function computeAccept(key) {
	return native.computeAcceptKey(key);
}
function abortUpgrade(socket, status, message) {
	try {
		const body = message ? message : http.STATUS_CODES[status] || "";
		const head = `HTTP/1.1 ${status} ${http.STATUS_CODES[status] || "Error"}\r\nConnection: close\r
Content-Length: ${Buffer.byteLength(body)}\r\nContent-Type: text/plain\r
\r
`;
		socket.write(head + body);
	} catch {}
	try {
		socket.destroy();
	} catch {}
}
var TLS_OPTION_KEYS = [
	"ALPNProtocols",
	"SNICallback",
	"ca",
	"cert",
	"ciphers",
	"clientCertEngine",
	"crl",
	"dhparam",
	"ecdhCurve",
	"honorCipherOrder",
	"key",
	"maxVersion",
	"minVersion",
	"passphrase",
	"pfx",
	"privateKeyEngine",
	"privateKeyIdentifier",
	"requestCert",
	"rejectUnauthorized",
	"secureOptions",
	"secureProtocol",
	"sessionIdContext",
	"sigalgs",
	"ticketKeys"
];
function getTlsOptions(options) {
	const tlsOptions = {};
	for (const key of TLS_OPTION_KEYS) if (options[key] !== void 0) tlsOptions[key] = options[key];
	if (options.tls && typeof options.tls === "object") Object.assign(tlsOptions, options.tls);
	return tlsOptions;
}
var WebSocketServer = class extends EventEmitter$1 {
	options;
	clients = /* @__PURE__ */ new Set();
	_server = null;
	_externalServer = null;
	_upgradeHandler = null;
	constructor(options) {
		super();
		options = options || {};
		this.options = {
			port: options.port,
			host: options.host,
			server: options.server,
			noServer: !!options.noServer,
			path: options.path,
			maxPayload: options.maxPayload,
			verifyClient: options.verifyClient,
			protocols: options.protocols,
			perMessageDeflate: options.perMessageDeflate,
			backlog: options.backlog,
			tls: options.tls
		};
		const tlsOptions = getTlsOptions(options);
		this.options.tls = Object.keys(tlsOptions).length > 0 ? tlsOptions : void 0;
		if (this.options.noServer) return;
		if (this.options.server) {
			this._externalServer = this.options.server;
			this._attachToServer(this._externalServer);
		} else if (this.options.port !== void 0) {
			const requestHandler = (_req, res) => {
				const body = http.STATUS_CODES[426] ?? "";
				res.writeHead(426, {
					"Content-Length": Buffer.byteLength(body),
					"Content-Type": "text/plain"
				});
				res.end(body);
			};
			this._server = this.options.tls ? https.createServer(this.options.tls, requestHandler) : http.createServer(requestHandler);
			this._attachToServer(this._server);
			this._server.listen(this.options.port, this.options.host, this.options.backlog, () => this.emit("listening"));
			this._server.on("error", (err) => this.emit("error", err));
		} else throw new Error("WebSocketServer requires { port } or { server } or { noServer: true }");
	}
	address() {
		if (this._server) return this._server.address();
		if (this._externalServer && this._externalServer.address) return this._externalServer.address();
		return null;
	}
	_attachToServer(server) {
		const handler = (req, socket, head) => {
			if (this.options.path) {
				if ((req.url ?? "/").split("?")[0] !== this.options.path) {
					if (server.listenerCount("upgrade") === 1) abortUpgrade(socket, 400, "Bad path for WebSocket");
					return;
				}
			}
			this.handleUpgrade(req, socket, head, (ws) => {
				this.emit("connection", ws, req);
			});
		};
		this._upgradeHandler = handler;
		server.on("upgrade", handler);
	}
	handleUpgrade(request, socket, head, cb) {
		const upgrade = (request.headers["upgrade"] ?? "").toLowerCase();
		const connection = (Array.isArray(request.headers["connection"]) ? request.headers["connection"].join(",") : request.headers["connection"] ?? "").toLowerCase();
		const version = request.headers["sec-websocket-version"];
		const key = request.headers["sec-websocket-key"];
		if (request.method !== "GET") return abortUpgrade(socket, 405, "Method not allowed");
		if (upgrade !== "websocket") return abortUpgrade(socket, 400, "Upgrade header must be websocket");
		if (!/\bupgrade\b/i.test(connection)) return abortUpgrade(socket, 400, "Connection header must contain \"upgrade\"");
		if (version !== "13") {
			try {
				socket.write("HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\n\r\n");
			} catch {}
			try {
				socket.destroy();
			} catch {}
			return;
		}
		if (typeof key !== "string" || !/^[+/0-9A-Za-z]{22}==$/.test(key)) return abortUpgrade(socket, 400, "Invalid Sec-WebSocket-Key");
		const doAccept = () => {
			const accept = computeAccept(key);
			const extension = acceptPerMessageDeflate(request.headers["sec-websocket-extensions"], this.options.perMessageDeflate);
			const protocol = chooseSubprotocol(request.headers["sec-websocket-protocol"], this.options.protocols);
			const responseHeaders = [
				"HTTP/1.1 101 Switching Protocols",
				"Upgrade: websocket",
				"Connection: Upgrade",
				`Sec-WebSocket-Accept: ${accept}`
			];
			if (extension) responseHeaders.push(`Sec-WebSocket-Extensions: ${extension.header}`);
			if (protocol) responseHeaders.push(`Sec-WebSocket-Protocol: ${protocol}`);
			try {
				socket.write(responseHeaders.join("\r\n") + "\r\n\r\n");
			} catch {
				try {
					socket.destroy();
				} catch {}
				return;
			}
			const ns = socket;
			ns.setTimeout?.(0);
			ns.setNoDelay?.(true);
			const ws = new WebSocket$1(socket, {
				isServer: true,
				maxPayload: this.options.maxPayload,
				extensions: extension ? { perMessageDeflate: extension.options } : void 0,
				protocol: protocol ?? "",
				readyState: 1
			});
			this.clients.add(ws);
			ws.on("close", () => this.clients.delete(ws));
			if (head && head.length > 0) ws._onData(head);
			cb(ws, request);
		};
		const verify = this.options.verifyClient;
		if (typeof verify === "function") {
			const info = {
				origin: request.headers["origin"],
				secure: !!socket.encrypted,
				req: request
			};
			if (verify.length >= 2) verify(info, (allow, code, message) => {
				if (!allow) return abortUpgrade(socket, code || 401, message);
				doAccept();
			});
			else {
				if (!verify(info)) return abortUpgrade(socket, 401, "Unauthorized");
				doAccept();
			}
		} else doAccept();
	}
	close(cb) {
		if (this._externalServer && this._upgradeHandler) {
			this._externalServer.removeListener("upgrade", this._upgradeHandler);
			this._upgradeHandler = null;
		}
		for (const ws of this.clients) try {
			ws.close(1001, "Server shutting down");
		} catch {}
		if (this._server) this._server.close((err) => cb && cb(err));
		else if (cb) setImmediate(cb);
	}
	/** Destroy clients and, when this server owns the HTTP listener, that
	*  listener too. An external HTTP server is left to its owner. */
	destroy() {
		for (const ws of this.clients) try {
			ws.terminate();
		} catch {}
		if (this._externalServer && this._upgradeHandler) {
			this._externalServer.removeListener("upgrade", this._upgradeHandler);
			this._upgradeHandler = null;
		}
		if (this._server) {
			try {
				this._server.closeAllConnections();
			} catch {}
			try {
				this._server.close(() => void 0);
			} catch {}
			this._server = null;
		}
	}
};
export {};
