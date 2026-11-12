// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../websocket/src/extensions.ts"
// original bundle lines 339669-340317  (647 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var TRAILER = Buffer.from([
	0,
	0,
	255,
	255
]);
function parseHeader(header) {
	const offers = [];
	if (!header) return offers;
	for (const rawOffer of String(header).split(",")) {
		const parts = rawOffer.split(";").map((p) => p.trim()).filter(Boolean);
		if (parts.length === 0) continue;
		const name = parts.shift().toLowerCase();
		const params = Object.create(null);
		for (const part of parts) {
			const eq = part.indexOf("=");
			if (eq === -1) params[part.toLowerCase()] = true;
			else {
				const key = part.slice(0, eq).trim().toLowerCase();
				let value = part.slice(eq + 1).trim();
				if (value.startsWith("\"") && value.endsWith("\"") || value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
				params[key] = value;
			}
		}
		offers.push({
			name,
			params
		});
	}
	return offers;
}
function normalizePerMessageDeflateOptions(value) {
	if (value === void 0 || value === false || value === null) return null;
	if (value === true) return {
		clientNoContextTakeover: true,
		serverNoContextTakeover: true
	};
	if (typeof value === "object") return {
		clientNoContextTakeover: true,
		serverNoContextTakeover: true,
		...value
	};
	return {
		clientNoContextTakeover: true,
		serverNoContextTakeover: true
	};
}
function acceptPerMessageDeflate(requestHeader, options) {
	const config = normalizePerMessageDeflateOptions(options);
	if (!config) return null;
	const offer = parseHeader(requestHeader).find((item) => item.name === "permessage-deflate");
	if (!offer) return null;
	const responseParams = [];
	if (config.serverNoContextTakeover !== false || offer.params.server_no_context_takeover) responseParams.push("server_no_context_takeover");
	if (config.clientNoContextTakeover !== false || offer.params.client_no_context_takeover) responseParams.push("client_no_context_takeover");
	const accepted = {
		enabled: true,
		requestNoContextTakeover: responseParams.includes("client_no_context_takeover"),
		responseNoContextTakeover: responseParams.includes("server_no_context_takeover"),
		threshold: config.threshold ?? 1024
	};
	return {
		header: ["permessage-deflate", ...responseParams].join("; "),
		options: accepted
	};
}
function offerPerMessageDeflate(options) {
	const config = normalizePerMessageDeflateOptions(options);
	if (!config) return null;
	const params = ["permessage-deflate"];
	if (config.clientNoContextTakeover !== false) params.push("client_no_context_takeover");
	if (config.serverNoContextTakeover !== false) params.push("server_no_context_takeover");
	return params.join("; ");
}
function parseAcceptedPerMessageDeflate(responseHeader, requestedOptions) {
	const config = normalizePerMessageDeflateOptions(requestedOptions);
	if (!config) return null;
	const accepted = parseHeader(responseHeader).find((item) => item.name === "permessage-deflate");
	if (!accepted) return null;
	for (const key of Object.keys(accepted.params)) if (key !== "client_no_context_takeover" && key !== "server_no_context_takeover") throw new Error(`Unsupported permessage-deflate parameter: ${key}`);
	return {
		enabled: true,
		requestNoContextTakeover: !!accepted.params.server_no_context_takeover,
		responseNoContextTakeover: !!accepted.params.client_no_context_takeover,
		threshold: config.threshold ?? 1024
	};
}
function compressRaw(data) {
	const compressed = zlib.deflateRawSync(data, { flush: zlib.constants.Z_SYNC_FLUSH });
	if (compressed.length >= 4 && compressed.subarray(compressed.length - 4).equals(TRAILER)) return compressed.subarray(0, compressed.length - 4);
	return compressed;
}
function decompressRaw(data, maxPayload) {
	let inflated;
	try {
		inflated = zlib.inflateRawSync(Buffer.concat([data, TRAILER]), {
			finishFlush: zlib.constants.Z_SYNC_FLUSH,
			...maxPayload === void 0 ? {} : { maxOutputLength: Math.max(1, maxPayload) }
		});
	} catch (cause) {
		if (maxPayload !== void 0 && cause.code === "ERR_BUFFER_TOO_LARGE") {
			const err = new Error(`Message too large after inflate (maxPayload=${maxPayload})`, { cause });
			err.code = 1009;
			throw err;
		}
		throw cause;
	}
	if (maxPayload !== void 0 && inflated.length > maxPayload) {
		const err = /* @__PURE__ */ new Error(`Message too large after inflate (maxPayload=${maxPayload})`);
		err.code = 1009;
		throw err;
	}
	return inflated;
}
function normalizeProtocolList(protocols) {
	if (!protocols) return [];
	if (typeof protocols === "string") return protocols.split(",").map((p) => p.trim()).filter(Boolean);
	if (Array.isArray(protocols)) return protocols.map(String).map((p) => p.trim()).filter(Boolean);
	if (protocols instanceof Set) return Array.from(protocols).map(String).map((p) => p.trim()).filter(Boolean);
	return [];
}
function chooseSubprotocol(requestHeader, protocols) {
	const requested = normalizeProtocolList(requestHeader);
	if (typeof protocols === "function") {
		const selected = protocols(requested);
		return selected && requested.includes(String(selected)) ? String(selected) : null;
	}
	const supported = normalizeProtocolList(protocols);
	if (requested.length === 0 || supported.length === 0) return null;
	for (const protocol of supported) if (requested.includes(protocol)) return protocol;
	return null;
}
/** RFC 6455 §5.5 bounds a close frame's payload to 125 bytes; the 2-byte code
*  leaves this much room for a reason. Long diagnostics are truncated (never
*  mid-code-point) because an over-long reason would make the close invalid. */
var MAX_CLOSE_REASON_BYTES = 123;
function isValidCloseCode(code) {
	if (code === 1e3 || code === 1001 || code === 1002 || code === 1003 || code === 1007 || code === 1008 || code === 1009 || code === 1010 || code === 1011) return true;
	if (code >= 3e3 && code <= 4999) return true;
	return false;
}
function encodeClosePayload(code, reason) {
	const reasonBuf = truncateCloseReason(reason);
	if (code === void 0 || code === null) {
		if (reasonBuf.length > 0) throw new Error("Cannot send close reason without a code");
		return Buffer.alloc(0);
	}
	const buf = Buffer.allocUnsafe(2 + reasonBuf.length);
	buf.writeUInt16BE(code & 65535, 0);
	reasonBuf.copy(buf, 2);
	return buf;
}
/** UTF-8 safe truncation of a close reason to the RFC 6455 control-frame room. */
function truncateCloseReason(reason) {
	if (!reason) return Buffer.alloc(0);
	const encoded = Buffer.from(String(reason), "utf8");
	if (encoded.length <= MAX_CLOSE_REASON_BYTES) return encoded;
	let end = MAX_CLOSE_REASON_BYTES;
	while (end > 0 && (encoded[end] & 192) === 128) end -= 1;
	return encoded.subarray(0, end);
}
/** Human label for the message type carried by a frame's opcode. */
function opcodeLabel(opcode) {
	if (opcode === 1) return "text";
	if (opcode === 2) return "binary";
	return `opcode ${opcode}`;
}
/** Budget for re-reading inbound bytes when an oversized frame is reported. */
var DIAG_BUFFER_LIMIT = 64 * 1024;
/**
* Walk a frame stream from `bytes` and return the first data frame whose declared
* payload exceeds `maxPayload`.
*
* The native parser rejects an oversized frame without saying where it is or how
* large it is, so the reporting path re-reads the retained bytes from the first
* unparsed frame. Walking from a frame boundary removes the "the first bytes of
* this chunk are the offending header" assumption: earlier data frames, interleaved
* control frames and a header split across chunks are all stepped over correctly.
* Returns `null` when the walk cannot reach a verdict, in which case the caller
* reports the cap without a size instead of guessing.
*/
function scanOversizedFrame(bytes, maxPayload) {
	let offset = 0;
	while (offset + 2 <= bytes.length) {
		const first = bytes[offset];
		const second = bytes[offset + 1];
		const opcode = first & 15;
		const masked = (second & 128) !== 0;
		const shortLength = second & 127;
		let payloadBytes;
		let headerBytes;
		if (shortLength === 126) {
			if (offset + 4 > bytes.length) return null;
			payloadBytes = bytes.readUInt16BE(offset + 2);
			headerBytes = 4;
		} else if (shortLength === 127) {
			if (offset + 10 > bytes.length) return null;
			const high = bytes.readUInt32BE(offset + 2);
			const low = bytes.readUInt32BE(offset + 6);
			if (high > 2097151) return null;
			payloadBytes = high * 2 ** 32 + low;
			headerBytes = 10;
		} else {
			payloadBytes = shortLength;
			headerBytes = 2;
		}
		if (masked) headerBytes += 4;
		if (payloadBytes > maxPayload) return opcode === 1 || opcode === 2 ? {
			opcode,
			payloadBytes
		} : null;
		offset += headerBytes + payloadBytes;
	}
	return null;
}
var Utf8Validator = class {
	state = 0;
	codepoint = 0;
	minNext = 0;
	push(buf) {
		for (let i = 0; i < buf.length; i++) {
			const b = buf[i];
			if (this.state === 0) {
				if ((b & 128) === 0) continue;
				if ((b & 224) === 192) {
					if (b < 194) return false;
					this.codepoint = b & 31;
					this.state = 1;
					this.minNext = 128;
				} else if ((b & 240) === 224) {
					this.codepoint = b & 15;
					this.state = 2;
					this.minNext = b === 224 ? 160 : 128;
				} else if ((b & 248) === 240) {
					if (b > 244) return false;
					this.codepoint = b & 7;
					this.state = 3;
					this.minNext = b === 240 ? 144 : 128;
				} else return false;
			} else {
				if (b < this.minNext || b > 191) return false;
				if (this.state === 2 && this.codepoint === 13 && b >= 160) return false;
				this.codepoint = this.codepoint << 6 | b & 63;
				this.state--;
				this.minNext = 128;
			}
		}
		return true;
	}
	done() {
		return this.state === 0;
	}
};
function randomMaskKey() {
	const b = Buffer.allocUnsafe(4);
	crypto$1.randomFillSync(b);
	return b;
}
var WebSocket$1 = class extends EventEmitter$1 {
	_socket;
	_isServer;
	_maxPayload;
	_readyState;
	_perMessageDeflate;
	protocol;
	extensions;
	_parser;
	_msgOpcode = 0;
	_msgChunks = [];
	_msgSize = 0;
	_msgValidator = null;
	_msgCompressed = false;
	_diagChunks = [];
	_diagBytes = 0;
	_diagOverflow = false;
	_closeCodeSent = null;
	_closeCodeReceived = null;
	_closeReasonReceived = "";
	_closeFrameSent = false;
	_closeTimer = null;
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;
	constructor(socket, options) {
		super();
		options = options || {};
		this._socket = socket;
		this._isServer = !!options.isServer;
		this._maxPayload = options.maxPayload ?? 104857600;
		this._readyState = options.readyState ?? 1;
		this._perMessageDeflate = options.extensions?.perMessageDeflate;
		this.protocol = options.protocol || "";
		this.extensions = this._perMessageDeflate ? "permessage-deflate" : "";
		this._parser = new native.Parser({
			isServer: this._isServer,
			maxPayload: this._maxPayload,
			allowedRsv: this._perMessageDeflate ? 64 : 0
		});
		this._bindSocket();
	}
	get readyState() {
		return this._readyState;
	}
	get isServer() {
		return this._isServer;
	}
	_bindSocket() {
		const sock = this._socket;
		sock.on("data", (chunk) => this._onData(chunk));
		sock.on("end", () => this._onEnd());
		sock.on("close", () => this._onSocketClose());
		sock.on("error", (err) => this._onError(err));
	}
	/** @internal */
	_onData(chunk) {
		if (this._readyState === 3) return;
		this._recordDiagnosticBytes(chunk);
		const res = this._parser.push(chunk);
		if (res.error) {
			this._failConnection(res.code || 1002, this._describeParseError(res));
			return;
		}
		for (const f of res.frames) {
			this._consumeDiagnosticFrame(f);
			this._handleFrame(f);
			if (this._readyState === 3) return;
		}
	}
	/**
	* Add the numbers a payload-limit failure needs to be actionable: how big the
	* offending frame is, its message type, and the effective cap. The native
	* parser only reports that the cap was exceeded, so the size is recovered by
	* re-walking the buffered bytes; when that walk cannot reach a verdict the
	* text names the cap alone instead of inventing a size.
	*/
	_describeParseError(res) {
		const message = res.message || "Protocol error";
		if (res.code !== 1009) return message;
		const info = this._scanDiagnosticBytes();
		this._resetDiagnosticBytes();
		const limit = `${this._maxPayload} byte limit (maxPayloadBytes)`;
		if (!info) return `${message}: an inbound frame exceeds the ${limit}`;
		return `${message}: ${info.payloadBytes} B ${opcodeLabel(info.opcode)} frame exceeds the ${limit}`;
	}
	/** Keep bounded diagnostic bytes starting at the first unparsed frame. */
	_recordDiagnosticBytes(chunk) {
		this._diagBytes += chunk.length;
		if (this._diagOverflow) return;
		if (this._diagBytes > DIAG_BUFFER_LIMIT) {
			this._diagOverflow = true;
			this._diagChunks = [];
			return;
		}
		this._diagChunks.push(chunk);
	}
	_consumeDiagnosticFrame(frame) {
		const payloadBytes = frame.payload.length;
		let remaining = 2 + (payloadBytes <= 125 ? 0 : payloadBytes <= 65535 ? 2 : 8) + (this._isServer ? 4 : 0) + payloadBytes;
		this._diagBytes -= remaining;
		if (this._diagBytes === 0) {
			this._resetDiagnosticBytes();
			return;
		}
		if (this._diagOverflow) return;
		let consumedChunks = 0;
		while (remaining > 0) {
			const chunk = this._diagChunks[consumedChunks];
			if (remaining < chunk.length) {
				this._diagChunks[consumedChunks] = chunk.subarray(remaining);
				break;
			}
			remaining -= chunk.length;
			consumedChunks += 1;
		}
		this._diagChunks.splice(0, consumedChunks);
	}
	_resetDiagnosticBytes() {
		this._diagChunks = [];
		this._diagBytes = 0;
		this._diagOverflow = false;
	}
	_scanDiagnosticBytes() {
		if (this._diagOverflow || this._diagChunks.length === 0) return null;
		return scanOversizedFrame(this._diagChunks.length === 1 ? this._diagChunks[0] : Buffer.concat(this._diagChunks, this._diagBytes), this._maxPayload);
	}
	_onEnd() {
		if (this._readyState !== 3) {
			if (this._closeCodeReceived === null) {
				this._closeCodeReceived = 1006;
				this._closeReasonReceived = "";
			}
			this._destroySocket();
		}
	}
	_onSocketClose() {
		if (this._readyState === 3) return;
		if (this._closeCodeReceived === null) this._closeCodeReceived = 1006;
		this._readyState = 3;
		if (this._closeTimer) {
			clearTimeout(this._closeTimer);
			this._closeTimer = null;
		}
		this.emit("close", this._closeCodeReceived, this._closeReasonReceived);
	}
	_onError(err) {
		this.emit("error", err);
	}
	_handleFrame(f) {
		const { fin, opcode, payload } = f;
		const rsv = f.rsv ?? 0;
		if (opcode === 9) {
			this.emit("ping", payload);
			if (this._readyState === 1) this._sendControl(10, payload);
			return;
		}
		if (opcode === 10) {
			this.emit("pong", payload);
			return;
		}
		if (opcode === 8) {
			this._handleCloseFrame(payload);
			return;
		}
		if (opcode === 1 || opcode === 2) {
			if (this._msgOpcode !== 0) {
				this._failConnection(1002, "New data frame started before previous fragmented message finished");
				return;
			}
			if (rsv & 64 && !this._perMessageDeflate) {
				this._failConnection(1002, "Compressed frame without negotiated permessage-deflate");
				return;
			}
			this._msgOpcode = opcode;
			this._msgChunks = [];
			this._msgSize = 0;
			this._msgCompressed = (rsv & 64) !== 0;
			this._msgValidator = opcode === 1 ? new Utf8Validator() : null;
		} else if (opcode === 0) {
			if (this._msgOpcode === 0) {
				this._failConnection(1002, "Continuation frame without active message");
				return;
			}
			if (rsv !== 0) {
				this._failConnection(1002, "RSV bits set on continuation frame");
				return;
			}
		}
		this._msgSize += payload.length;
		if (this._msgSize > this._maxPayload) {
			this._failConnection(1009, `Message too large: ${this._msgSize} B ${opcodeLabel(this._msgOpcode)} message exceeds the ${this._maxPayload} byte limit (maxPayloadBytes)`);
			return;
		}
		if (payload.length > 0) this._msgChunks.push(payload);
		if (fin) {
			let data = this._msgChunks.length === 1 ? this._msgChunks[0] : Buffer.concat(this._msgChunks, this._msgSize);
			if (this._msgCompressed) try {
				data = decompressRaw(data, this._maxPayload);
			} catch (err) {
				const e = err;
				this._failConnection(e.code || 1007, e.message || "Invalid compressed payload");
				return;
			}
			if (this._msgValidator) {
				if (!this._msgValidator.push(data) || !this._msgValidator.done()) {
					this._failConnection(1007, "Invalid UTF-8");
					return;
				}
			}
			const isBinary = this._msgOpcode === 2;
			this._msgOpcode = 0;
			this._msgChunks = [];
			this._msgSize = 0;
			this._msgValidator = null;
			this._msgCompressed = false;
			this.emit("message", data, isBinary);
		}
	}
	_handleCloseFrame(payload) {
		let code = 1005;
		let reason = "";
		if (payload.length === 1) {
			this._failConnection(1002, "Close payload length 1");
			return;
		}
		if (payload.length >= 2) {
			code = payload.readUInt16BE(0);
			if (!isValidCloseCode(code)) {
				this._failConnection(1002, "Invalid close code");
				return;
			}
			if (payload.length > 2) try {
				reason = new TextDecoder("utf-8", { fatal: true }).decode(payload.subarray(2));
			} catch {
				this._failConnection(1007, "Invalid UTF-8 in close reason");
				return;
			}
		}
		this._closeCodeReceived = code;
		this._closeReasonReceived = reason;
		if (this._readyState === 1) {
			this._readyState = 2;
			const echo = encodeClosePayload(code === 1005 ? void 0 : code, "");
			this._sendControl(8, echo);
			this._closeFrameSent = true;
			this._endSocketSoon();
		} else if (this._readyState === 2) this._endSocketSoon();
	}
	_endSocketSoon() {
		try {
			this._socket.end();
		} catch {}
		if (this._closeTimer) clearTimeout(this._closeTimer);
		this._closeTimer = setTimeout(() => this._destroySocket(), 3e4);
		this._closeTimer.unref?.();
	}
	_destroySocket() {
		try {
			this._socket.destroy();
		} catch {}
	}
	_failConnection(code, reason) {
		if (this._readyState === 3) return;
		const payload = encodeClosePayload(code, reason);
		let frame = null;
		try {
			frame = native.buildFrame(8, true, payload, this._isServer ? null : randomMaskKey(), 0);
		} catch {}
		this._closeCodeSent = code;
		this._readyState = 2;
		const err = /* @__PURE__ */ new Error(`WebSocket protocol error: ${reason}`);
		err.code = code;
		this.emit("error", err);
		try {
			if (frame) this._socket.end(frame);
			else this._socket.end();
		} catch {}
		if (this._closeTimer) clearTimeout(this._closeTimer);
		this._closeTimer = setTimeout(() => this._destroySocket(), 2e3);
		this._closeTimer.unref?.();
	}
	_sendControl(opcode, payload) {
		const data = payload ?? Buffer.alloc(0);
		const frame = native.buildFrame(opcode, true, data, this._isServer ? null : randomMaskKey(), 0);
		this._socket.write(frame);
	}
	send(data, options, cb) {
		if (typeof options === "function") {
			cb = options;
			options = void 0;
		}
		const opts = options || {};
		if (this._readyState !== 1) {
			const err = /* @__PURE__ */ new Error("WebSocket is not open");
			if (cb) {
				cb(err);
				return;
			}
			throw err;
		}
		let payload;
		let opcode;
		if (typeof data === "string") {
			payload = Buffer.from(data, "utf8");
			opcode = opts.binary ? 2 : 1;
		} else if (Buffer.isBuffer(data)) {
			payload = data;
			opcode = opts.binary === false ? 1 : 2;
		} else if (data instanceof Uint8Array) {
			payload = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
			opcode = opts.binary === false ? 1 : 2;
		} else if (data instanceof ArrayBuffer) {
			payload = Buffer.from(data);
			opcode = opts.binary === false ? 1 : 2;
		} else {
			const err = /* @__PURE__ */ new TypeError("Unsupported data type for send()");
			if (cb) {
				cb(err);
				return;
			}
			throw err;
		}
		let rsv = 0;
		if (this._perMessageDeflate && opts.compress !== false && payload.length >= (this._perMessageDeflate.threshold ?? 1024)) {
			payload = compressRaw(payload);
			rsv = 64;
		}
		const maskKey = this._isServer ? null : randomMaskKey();
		const frame = native.buildFrame(opcode, true, payload, maskKey, rsv);
		this._socket.write(frame, cb);
	}
	ping(data, _mask, cb) {
		if (typeof data === "function") {
			cb = data;
			data = void 0;
		}
		const payload = data ? Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8") : Buffer.alloc(0);
		if (payload.length > 125) throw new Error("Ping payload must be <=125 bytes");
		if (this._readyState !== 1) {
			const err = /* @__PURE__ */ new Error("WebSocket is not open");
			if (cb) {
				cb(err);
				return;
			}
			throw err;
		}
		const maskKey = this._isServer ? null : randomMaskKey();
		const frame = native.buildFrame(9, true, payload, maskKey, 0);
		this._socket.write(frame, cb);
	}
	pong(data, _mask, cb) {
		if (typeof data === "function") {
			cb = data;
			data = void 0;
		}
		const payload = data ? Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8") : Buffer.alloc(0);
		if (payload.length > 125) throw new Error("Pong payload must be <=125 bytes");
		if (this._readyState !== 1) {
			const err = /* @__PURE__ */ new Error("WebSocket is not open");
			if (cb) {
				cb(err);
				return;
			}
			throw err;
		}
		const maskKey = this._isServer ? null : randomMaskKey();
		const frame = native.buildFrame(10, true, payload, maskKey, 0);
		this._socket.write(frame, cb);
	}
	close(code, reason) {
		if (this._readyState === 3 || this._readyState === 2) return;
		if (code !== void 0 && !isValidCloseCode(code)) throw new RangeError(`Invalid close code: ${code}`);
		if ((reason ? Buffer.from(String(reason), "utf8") : Buffer.alloc(0)).length > 123) throw new RangeError("Close reason must be <=123 bytes");
		const payload = encodeClosePayload(code, reason);
		const maskKey = this._isServer ? null : randomMaskKey();
		const frame = native.buildFrame(8, true, payload, maskKey, 0);
		this._readyState = 2;
		this._closeCodeSent = code ?? null;
		this._socket.write(frame);
		this._closeFrameSent = true;
		this._endSocketSoon();
	}
	terminate() {
		this._readyState = 2;
		this._destroySocket();
	}
};
export {};
