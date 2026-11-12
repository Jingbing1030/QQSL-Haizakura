// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../websocket/src/client.ts"
// original bundle lines 340533-340727  (193 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function parseHeaders(headerBlock) {
	const lines = headerBlock.split("\r\n");
	const status = lines.shift();
	const m = /^HTTP\/1\.1\s+(\d+)\s*(.*)$/.exec(status);
	if (!m) throw new Error("Bad HTTP status line: " + status);
	const headers = Object.create(null);
	for (const line of lines) {
		if (!line) continue;
		const idx = line.indexOf(":");
		if (idx < 0) continue;
		const k = line.slice(0, idx).trim().toLowerCase();
		headers[k] = line.slice(idx + 1).trim();
	}
	return {
		statusCode: Number(m[1]),
		statusMessage: m[2] ?? "",
		headers
	};
}
var WebSocketClient = class extends EventEmitter$1 {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;
	static Server;
	_url;
	_secure;
	_readyState;
	_maxPayload;
	_ws = null;
	_pendingQueue = [];
	_perMessageDeflate;
	_protocols;
	protocol = "";
	extensions = "";
	_socket;
	_handshakeBuf = Buffer.alloc(0);
	_wsKey;
	_expectedAccept;
	constructor(address, protocols, options) {
		super();
		if (typeof protocols === "object" && !Array.isArray(protocols) && protocols !== null) {
			options = protocols;
			protocols = void 0;
		}
		options = options || {};
		this._url = new URL$1(address);
		if (this._url.protocol !== "ws:" && this._url.protocol !== "wss:") throw new Error("Only ws: and wss: URLs are supported");
		this._secure = this._url.protocol === "wss:";
		this._readyState = 0;
		this._maxPayload = options.maxPayload;
		this._perMessageDeflate = options.perMessageDeflate;
		this._protocols = Array.isArray(protocols) ? protocols.map(String) : typeof protocols === "string" ? [protocols] : void 0;
		const host = this._url.hostname;
		const port = this._url.port ? Number(this._url.port) : this._secure ? 443 : 80;
		const keyBytes = crypto$1.randomBytes(16);
		this._wsKey = keyBytes.toString("base64");
		this._expectedAccept = native.computeAcceptKey(this._wsKey);
		const connectOpts = {
			host,
			port,
			...options.socketOptions || {}
		};
		const onConnect = () => {
			const pathAndQuery = (this._url.pathname || "/") + (this._url.search || "");
			const hostHeader = this._url.port && Number(this._url.port) !== (this._secure ? 443 : 80) ? `${host}:${this._url.port}` : host;
			const reqLines = [
				`GET ${pathAndQuery} HTTP/1.1`,
				`Host: ${hostHeader}`,
				"Upgrade: websocket",
				"Connection: Upgrade",
				`Sec-WebSocket-Key: ${this._wsKey}`,
				"Sec-WebSocket-Version: 13"
			];
			if (this._protocols && this._protocols.length > 0) reqLines.push(`Sec-WebSocket-Protocol: ${this._protocols.join(", ")}`);
			const extensionOffer = offerPerMessageDeflate(this._perMessageDeflate);
			if (extensionOffer) reqLines.push(`Sec-WebSocket-Extensions: ${extensionOffer}`);
			if (options.headers) for (const [k, v] of Object.entries(options.headers)) reqLines.push(`${k}: ${v}`);
			reqLines.push("", "");
			this._socket.write(reqLines.join("\r\n"));
		};
		if (this._secure && connectOpts.servername === void 0 && net$1.isIP(host) === 0) connectOpts.servername = host;
		this._socket = this._secure ? tls.connect(connectOpts, onConnect) : net$1.connect(connectOpts, onConnect);
		this._socket.setNoDelay?.(true);
		this._socket.on("data", (chunk) => this._onHandshakeData(chunk));
		this._socket.on("error", (err) => this._onEarlyError(err));
		this._socket.on("close", () => this._onEarlyClose());
	}
	get readyState() {
		return this._ws ? this._ws.readyState : this._readyState;
	}
	_onHandshakeData(chunk) {
		this._handshakeBuf = Buffer.concat([this._handshakeBuf, chunk]);
		const idx = this._handshakeBuf.indexOf("\r\n\r\n");
		if (idx < 0) {
			if (this._handshakeBuf.length > 16384) this._abort("Handshake response too large");
			return;
		}
		const headBlock = this._handshakeBuf.slice(0, idx).toString("latin1");
		const rest = this._handshakeBuf.slice(idx + 4);
		let parsed;
		try {
			parsed = parseHeaders(headBlock);
		} catch (e) {
			return this._abort(e.message);
		}
		if (parsed.statusCode !== 101) return this._abort(`Unexpected response status ${parsed.statusCode}`);
		if ((parsed.headers["upgrade"] || "").toLowerCase() !== "websocket") return this._abort("Missing/invalid Upgrade header");
		if (!/\bupgrade\b/i.test(parsed.headers["connection"] || "")) return this._abort("Missing Connection: Upgrade header");
		if (parsed.headers["sec-websocket-accept"] !== this._expectedAccept) return this._abort("Invalid Sec-WebSocket-Accept");
		let acceptedExtensions;
		try {
			acceptedExtensions = parseAcceptedPerMessageDeflate(parsed.headers["sec-websocket-extensions"], this._perMessageDeflate);
		} catch (e) {
			return this._abort(e.message);
		}
		if (parsed.headers["sec-websocket-extensions"] && !acceptedExtensions) return this._abort("Unexpected Sec-WebSocket-Extensions");
		const protocol = parsed.headers["sec-websocket-protocol"] || "";
		if (protocol && (!this._protocols || !this._protocols.includes(protocol))) return this._abort("Unexpected Sec-WebSocket-Protocol");
		this._socket.removeAllListeners("data");
		this._socket.removeAllListeners("error");
		this._socket.removeAllListeners("close");
		this._readyState = 1;
		this._ws = new WebSocket$1(this._socket, {
			isServer: false,
			maxPayload: this._maxPayload,
			extensions: acceptedExtensions ? { perMessageDeflate: acceptedExtensions } : void 0,
			protocol,
			readyState: 1
		});
		this.protocol = protocol;
		this.extensions = acceptedExtensions ? "permessage-deflate" : "";
		this._ws.on("message", (d, isBinary) => this.emit("message", d, isBinary));
		this._ws.on("ping", (d) => this.emit("ping", d));
		this._ws.on("pong", (d) => this.emit("pong", d));
		this._ws.on("close", (c, r) => this.emit("close", c, r));
		this._ws.on("error", (e) => this.emit("error", e));
		this.emit("upgrade", parsed);
		this.emit("open");
		if (rest.length > 0) this._ws._onData(rest);
		for (const entry of this._pendingQueue) this._ws.send(entry.data, entry.options, entry.cb);
		this._pendingQueue = [];
	}
	_onEarlyError(err) {
		this.emit("error", err);
	}
	_onEarlyClose() {
		if (!this._ws) {
			this._readyState = 3;
			this.emit("close", 1006, "");
		}
	}
	_abort(msg) {
		const err = /* @__PURE__ */ new Error("WebSocket handshake failed: " + msg);
		try {
			this._socket.destroy();
		} catch {}
		this.emit("error", err);
		this._readyState = 3;
		this.emit("close", 1006, "");
	}
	send(data, options, cb) {
		if (this._ws) return this._ws.send(data, options, cb);
		if (typeof options === "function") {
			cb = options;
			options = void 0;
		}
		this._pendingQueue.push({
			data,
			options,
			cb
		});
	}
	ping(data, mask, cb) {
		this._ws?.ping(data, mask, cb);
	}
	pong(data, mask, cb) {
		this._ws?.pong(data, mask, cb);
	}
	close(code, reason) {
		if (code !== void 0 && !isValidCloseCode(code)) throw new RangeError(`Invalid close code: ${code}`);
		if (this._ws) return this._ws.close(code, reason);
		try {
			this._socket.destroy();
		} catch {}
	}
	terminate() {
		if (this._ws) return this._ws.terminate();
		try {
			this._socket.destroy();
		} catch {}
	}
};
export {};
