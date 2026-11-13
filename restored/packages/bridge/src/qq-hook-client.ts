// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/qq-hook-client.ts"
// original bundle lines 1765-2648  (882 lines) of dist/index.mjs
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
init_log_summary();
init_env();
var PIPE_MAGIC = 827344977;
var MAX_PIPE_CMD_BYTES = 4096;
var MAX_PIPE_MSG_BYTES = 65536;
var MAX_PIPE_BODY_BYTES = 16 * 1024 * 1024;
var DEFAULT_ACK_TIMEOUT_MS = 5e3;
var DEFAULT_REPLY_TIMEOUT_MS = 3e4;
var DEFAULT_PIPE_PROBE_TIMEOUT_MS = 250;
var packetLog$1 = createLogger("QQHook.Packet");
var runtimeLog$2 = createLogger("QQHook.Runtime");
var PipeFlagWantReply = 1;
var PipeFlagLoggedIn = 4;
function isMissingDirectoryError(error) {
	const code = error?.code;
	return code === "ENOENT" || code === "ENOTDIR";
}
function isUnavailableSocketError(error) {
	const code = error?.code;
	return code === "ENOENT" || code === "ENOTDIR" || code === "ENOTSOCK" || code === "ECONNREFUSED" || code === "ECONNRESET";
}
/**
* Sync directory scan for `mojo.<pid>.control.sock` socket files in the
* runtime dir, returning the pid set. Used by the darwin path of
* `listHookProcesses()` — on macOS the DYLD_INSERT injection model means
* there is no native enumerate-QQ-processes addon; the existence of our
* dylib's listener socket IS the proof that a QQ process is hooked. The
* sync variant is needed because the watcher's `listProcesses` dep is sync.
*
* Mirrors `listLiveLinuxPipePids` (the async + connectable-probe variant)
* but skips the connectable probe — the existence of the socket file is
* sufficient signal for "process exists with our dylib mapped". The async
* variant still gates the subsequent `pipe-up` emit via a real connect.
*/
function listSnowlumaPipePidsSync(runtimeDir = resolveHookRuntimeDir()) {
	const result = /* @__PURE__ */ new Set();
	let names;
	try {
		names = readdirSync(runtimeDir);
	} catch (error) {
		if (isMissingDirectoryError(error)) return result;
		throw error;
	}
	for (const name of names) {
		const m = /^mojo\.(\d+)\.control\.sock$/i.exec(name);
		if (!m) continue;
		const pid = Number(m[1]);
		if (Number.isInteger(pid) && pid > 0) result.add(pid);
	}
	return result;
}
function mojoPipeName(pid, suffix, runtimeDir = resolveHookRuntimeDir(pid)) {
	if (process.platform === "win32") return `\\\\.\\pipe\\mojo.${pid}.${suffix}`;
	return path$1.join(runtimeDir, `mojo.${pid}.${suffix}.sock`);
}
async function isConnectableUnixSocket(socketPath) {
	try {
		if (!(await promises$1.stat(socketPath)).isSocket()) return false;
	} catch (error) {
		if (isUnavailableSocketError(error)) return false;
		throw error;
	}
	return new Promise((resolve, reject) => {
		let socket;
		try {
			socket = net.createConnection(socketPath);
		} catch (error) {
			if (isUnavailableSocketError(error)) resolve(false);
			else reject(error);
			return;
		}
		let done = false;
		let timer;
		const finish = (ok) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			socket.removeAllListeners();
			socket.destroy();
			resolve(ok);
		};
		timer = setTimeout(() => finish(false), DEFAULT_PIPE_PROBE_TIMEOUT_MS);
		socket.once("connect", () => finish(true));
		socket.once("error", (error) => {
			if (isUnavailableSocketError(error)) finish(false);
			else {
				if (done) return;
				done = true;
				clearTimeout(timer);
				socket.removeAllListeners();
				socket.destroy();
				reject(error);
			}
		});
	});
}
async function listLiveLinuxPipePids(runtimeDir = resolveHookRuntimeDir(), probe = isConnectableUnixSocket) {
	const result = /* @__PURE__ */ new Set();
	let names;
	try {
		names = await promises$1.readdir(runtimeDir);
	} catch (error) {
		if (isMissingDirectoryError(error)) return result;
		throw error;
	}
	await Promise.all(names.map(async (name) => {
		const m = /^mojo\.(\d+)\.control\.sock$/.exec(name);
		if (!m) return;
		const pid = Number(m[1]);
		if (!Number.isInteger(pid) || pid <= 0) return;
		if (await probe(path$1.join(runtimeDir, name))) result.add(pid);
	}));
	return result;
}
function toBuffer(body) {
	if (Buffer.isBuffer(body)) return body;
	if (body instanceof Uint8Array) return Buffer.from(body);
	if (typeof body === "string") return Buffer.from(body, "utf8");
	if (body == null) return Buffer.alloc(0);
	throw new TypeError("body must be Buffer, Uint8Array, string, or null");
}
function createDeferred() {
	let resolve;
	let reject;
	return {
		promise: new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		}),
		resolve,
		reject
	};
}
var OperationTimeoutError = class extends Error {
	label;
	constructor(label, timeoutMs) {
		super(`${label} timed out after ${timeoutMs} ms`);
		this.label = label;
		this.name = "OperationTimeoutError";
	}
};
function withTimeout(promise, timeoutMs, label) {
	if (!timeoutMs || timeoutMs <= 0) return promise;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new OperationTimeoutError(label, timeoutMs));
		}, timeoutMs);
		promise.then((value) => {
			clearTimeout(timer);
			resolve(value);
		}, (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}
var HookPipeRequestError = class extends Error {
	status;
	requestId;
	constructor(message, status, requestId) {
		super(message);
		this.status = status;
		this.requestId = requestId;
		this.name = "HookPipeRequestError";
	}
};
function packetFailureReason(error, requestId) {
	if (error instanceof HookPipeRequestError) return "request_failed";
	if (error instanceof OperationTimeoutError) {
		if (error.label === `send ack ${requestId}`) return "ack_timeout";
		if (error.label === `send reply ${requestId}`) return "reply_timeout";
	}
	return "transport_failure";
}
function encodeFrame({ op, requestId = 0, status = 0, flags = 0, value0 = 0n, cmd = "", msg = "", body = Buffer.alloc(0) }) {
	const cmdBuf = Buffer.from(cmd, "utf8");
	const msgBuf = Buffer.from(msg, "utf8");
	const bodyBuf = toBuffer(body);
	validatePipeFrameLengths(cmdBuf.length, msgBuf.length, bodyBuf.length);
	const header = Buffer.alloc(40);
	header.writeUInt32LE(PIPE_MAGIC, 0);
	header.writeUInt16LE(1, 4);
	header.writeUInt16LE(op, 6);
	header.writeUInt32LE(requestId >>> 0, 8);
	header.writeInt32LE(status | 0, 12);
	header.writeUInt32LE(flags >>> 0, 16);
	header.writeUInt32LE(cmdBuf.length >>> 0, 20);
	header.writeUInt32LE(msgBuf.length >>> 0, 24);
	header.writeUInt32LE(bodyBuf.length >>> 0, 28);
	header.writeBigUInt64LE(BigInt(value0), 32);
	return Buffer.concat([
		header,
		cmdBuf,
		msgBuf,
		bodyBuf
	]);
}
function validatePipeFrameLengths(cmdLen, msgLen, bodyLen) {
	const lengths = [
		[
			"command",
			cmdLen,
			MAX_PIPE_CMD_BYTES
		],
		[
			"message",
			msgLen,
			MAX_PIPE_MSG_BYTES
		],
		[
			"body",
			bodyLen,
			MAX_PIPE_BODY_BYTES
		]
	];
	for (const [name, length, limit] of lengths) if (length > limit) throw new Error(`pipe frame ${name} length ${length} exceeds limit ${limit}`);
}
var FrameReader = class {
	onFrame;
	header = Buffer.alloc(40);
	headerBytes = 0;
	pending = null;
	constructor(onFrame) {
		this.onFrame = onFrame;
	}
	push(chunk) {
		let chunkOffset = 0;
		while (chunkOffset < chunk.length) {
			if (!this.pending) {
				const headerBytes = Math.min(40 - this.headerBytes, chunk.length - chunkOffset);
				chunk.copy(this.header, this.headerBytes, chunkOffset, chunkOffset + headerBytes);
				this.headerBytes += headerBytes;
				chunkOffset += headerBytes;
				if (this.headerBytes < 40) return;
				this.headerBytes = 0;
				const magic = this.header.readUInt32LE(0);
				const version = this.header.readUInt16LE(4);
				if (magic !== 827344977 || version !== 1) throw new Error(`bad frame header magic=0x${magic.toString(16)} version=${version}`);
				const cmdLen = this.header.readUInt32LE(20);
				const msgLen = this.header.readUInt32LE(24);
				const bodyLen = this.header.readUInt32LE(28);
				validatePipeFrameLengths(cmdLen, msgLen, bodyLen);
				const payloadLength = cmdLen + msgLen + bodyLen;
				this.pending = {
					op: this.header.readUInt16LE(6),
					requestId: this.header.readUInt32LE(8),
					status: this.header.readInt32LE(12),
					flags: this.header.readUInt32LE(16),
					value0: this.header.readBigUInt64LE(32),
					cmdLen,
					msgLen,
					bodyLen,
					payload: payloadLength === 0 ? Buffer.alloc(0) : Buffer.allocUnsafe(payloadLength),
					received: 0
				};
			}
			const pending = this.pending;
			const payloadBytes = Math.min(pending.payload.length - pending.received, chunk.length - chunkOffset);
			if (payloadBytes > 0) {
				chunk.copy(pending.payload, pending.received, chunkOffset, chunkOffset + payloadBytes);
				pending.received += payloadBytes;
				chunkOffset += payloadBytes;
			}
			if (pending.received < pending.payload.length) return;
			this.pending = null;
			const frame = {
				op: pending.op,
				requestId: pending.requestId,
				status: pending.status,
				flags: pending.flags,
				value0: pending.value0,
				cmd: "",
				msg: "",
				body: Buffer.alloc(0)
			};
			let offset = 0;
			frame.cmd = pending.payload.subarray(offset, offset + pending.cmdLen).toString("utf8");
			offset += pending.cmdLen;
			frame.msg = pending.payload.subarray(offset, offset + pending.msgLen).toString("utf8");
			offset += pending.msgLen;
			frame.body = Buffer.from(pending.payload.subarray(offset, offset + pending.bodyLen));
			this.onFrame(frame);
		}
	}
};
var QqHookClient = class QqHookClient extends EventEmitter {
	connectingSockets = /* @__PURE__ */ new Set();
	pid;
	runtimeDir;
	defaultAckTimeoutMs;
	defaultReplyTimeoutMs;
	controlSocket = null;
	recvSocket = null;
	controlConnectPromise = null;
	recvConnectPromise = null;
	nextRequestId = 1;
	pendingAcks = /* @__PURE__ */ new Map();
	pendingReplies = /* @__PURE__ */ new Map();
	controlHello = null;
	recvHello = null;
	controlHelloResolver = null;
	recvHelloResolver = null;
	controlWriteChain = Promise.resolve();
	closed = false;
	runtimeFailure = null;
	loginState = {
		loggedIn: false,
		uin: "0",
		uinNumber: 0n
	};
	loginWaiters = /* @__PURE__ */ new Set();
	constructor(pid, { ackTimeoutMs = positiveIntEnv("SNOWLUMA_HOOK_ACK_TIMEOUT_MS", DEFAULT_ACK_TIMEOUT_MS), replyTimeoutMs = DEFAULT_REPLY_TIMEOUT_MS, runtimeDir = resolveHookRuntimeDir(pid) } = {}) {
		super();
		this.pid = pid;
		this.runtimeDir = runtimeDir;
		this.defaultAckTimeoutMs = ackTimeoutMs;
		this.defaultReplyTimeoutMs = replyTimeoutMs;
	}
	get isLoggedIn() {
		return this.loginState.loggedIn;
	}
	get isClosed() {
		return this.closed;
	}
	get currentUin() {
		return this.loginState.uin;
	}
	get currentUinNumber() {
		return this.loginState.uinNumber;
	}
	getLoginState() {
		return { ...this.loginState };
	}
	/**
	* Forward an observed account identity for reconciliation. This does not
	* change login state; readiness still requires peer confirmation.
	*/
	async reconcileLoginIdentity(uin) {
		if (!isRealUin(uin)) throw new Error(`invalid QQ login identity hint: ${JSON.stringify(uin)}`);
		await this.sendAckOnly(17, BigInt(uin), "login identity hint");
	}
	async waitForLogin({ timeoutMs = 0 } = {}) {
		await this.connect();
		this.assertUsable();
		if (this.loginState.loggedIn) return this.getLoginState();
		const deferred = createDeferred();
		this.loginWaiters.add(deferred);
		try {
			return await withTimeout(deferred.promise, timeoutMs, "waitForLogin");
		} finally {
			this.loginWaiters.delete(deferred);
		}
	}
	static controlPipeName(pid, runtimeDir = resolveHookRuntimeDir(pid)) {
		return mojoPipeName(pid, "control", runtimeDir);
	}
	static recvPipeName(pid, runtimeDir = resolveHookRuntimeDir(pid)) {
		return mojoPipeName(pid, "recv", runtimeDir);
	}
	/**
	* Lightweight liveness check for the control pipe. Used to detect whether an
	* existing Haizakura hook is still hosted inside the QQ.exe process without
	* opening the pipe, so probing cannot disturb the first real client connect.
	*/
	static async probePipe(pid) {
		return (await QqHookClient.listLivePipes([pid])).has(pid);
	}
	/**
	* Enumerate every PID currently hosting a Haizakura `mojo.<pid>.control` pipe
	* in a single filesystem listing. The HookManager's pipe-watcher uses this
	* to drive connect/reconnect decisions without per-PID stat calls.
	*/
	static async listLivePipes(pids = []) {
		const result = /* @__PURE__ */ new Set();
		if (process.platform === "win32") {
			const names = await promises$1.readdir("\\\\.\\pipe\\");
			for (const name of names) {
				const m = /^mojo\.(\d+)\.control$/i.exec(name);
				if (m) result.add(Number(m[1]));
			}
		} else {
			const runtimeDirs = /* @__PURE__ */ new Set();
			if (pids.length === 0) runtimeDirs.add(resolveHookRuntimeDir());
			else for (const pid of pids) runtimeDirs.add(resolveHookRuntimeDir(pid));
			for (const runtimeDir of runtimeDirs) for (const pid of await listLiveLinuxPipePids(runtimeDir)) result.add(pid);
		}
		return result;
	}
	async connect() {
		this.assertUsable();
		if (this.controlSocket && this.controlHello) return this.controlHello;
		if (this.controlConnectPromise) return this.controlConnectPromise;
		this.controlConnectPromise = this.connectPipe("control");
		try {
			return await this.controlConnectPromise;
		} finally {
			this.controlConnectPromise = null;
		}
	}
	async startRecv(onPacket) {
		this.assertUsable();
		if (typeof onPacket === "function") this.on("packet", onPacket);
		if (this.recvSocket && this.recvHello) return this.recvHello;
		if (this.recvConnectPromise) return this.recvConnectPromise;
		this.recvConnectPromise = this.connectPipe("recv");
		try {
			return await this.recvConnectPromise;
		} finally {
			this.recvConnectPromise = null;
		}
	}
	async connectAll({ recv = true } = {}) {
		return {
			control: await this.connect(),
			recv: recv ? await this.startRecv() : null
		};
	}
	async send(cmd, body, { wantReply = true, ackTimeoutMs = this.defaultAckTimeoutMs, replyTimeoutMs = this.defaultReplyTimeoutMs } = {}) {
		await this.connect();
		const requestId = this.allocateRequestId();
		const startedAt = Date.now();
		const bodyBytes = toBuffer(body);
		const payload = encodeFrame({
			op: 2,
			requestId,
			flags: wantReply ? PipeFlagWantReply : 0,
			cmd,
			body: bodyBytes
		});
		packetLog$1.trace(() => [
			"packet_send serviceCmd=%j requestId=%d length=%d body=%s",
			cmd,
			requestId,
			bodyBytes.length,
			renderTraceBytes(bodyBytes)
		]);
		const ackDeferred = createDeferred();
		ackDeferred.promise.catch(() => {});
		this.pendingAcks.set(requestId, {
			resolve: ackDeferred.resolve,
			reject: ackDeferred.reject,
			wantReply
		});
		let replyDeferred = null;
		if (wantReply) {
			replyDeferred = createDeferred();
			replyDeferred.promise.catch(() => {});
			this.pendingReplies.set(requestId, replyDeferred);
		}
		try {
			await this.writeControl(payload);
			await withTimeout(ackDeferred.promise, ackTimeoutMs, `send ack ${requestId}`);
			if (!wantReply) {
				packetLog$1.trace(() => [
					"packet_terminal serviceCmd=%j requestId=%d outcome=ok reason=ack_received elapsedMs=%d",
					cmd,
					requestId,
					Date.now() - startedAt
				]);
				return { requestId };
			}
			const reply = await withTimeout(replyDeferred.promise, replyTimeoutMs, `send reply ${requestId}`);
			packetLog$1.trace(() => [
				"packet_recv serviceCmd=%j requestId=%d error=%d message=%j length=%d body=%s",
				cmd,
				requestId,
				reply.error,
				reply.message,
				reply.body.length,
				renderTraceBytes(reply.body)
			]);
			packetLog$1.trace(() => [
				"packet_terminal serviceCmd=%j requestId=%d outcome=%s reason=%s error=%d elapsedMs=%d",
				cmd,
				requestId,
				reply.error === 0 ? "ok" : "failed",
				reply.error === 0 ? "reply_received" : "reply_error",
				reply.error,
				Date.now() - startedAt
			]);
			return reply;
		} catch (error) {
			this.pendingAcks.delete(requestId);
			this.pendingReplies.delete(requestId);
			const reason = packetFailureReason(error, requestId);
			packetLog$1.trace(() => [
				"packet_terminal serviceCmd=%j requestId=%d outcome=%s reason=%s error=%j elapsedMs=%d",
				cmd,
				requestId,
				reason.endsWith("_timeout") ? "timeout" : "failed",
				reason,
				error instanceof Error ? error.message : String(error),
				Date.now() - startedAt
			]);
			throw error;
		}
	}
	async sendNoReply(cmd, body, options = {}) {
		return this.send(cmd, body, {
			...options,
			wantReply: false
		});
	}
	async sendAndWait(cmd, body, options = {}) {
		return this.send(cmd, body, {
			...options,
			wantReply: true
		});
	}
	async sendMany(items, { concurrency = 64, wantReply = true, ackTimeoutMs = this.defaultAckTimeoutMs, replyTimeoutMs = this.defaultReplyTimeoutMs } = {}) {
		const results = new Array(items.length);
		let nextIndex = 0;
		const workerCount = Math.max(1, Math.min(concurrency | 0, items.length || 1));
		const worker = async () => {
			for (;;) {
				const index = nextIndex;
				nextIndex += 1;
				if (index >= items.length) return;
				const item = items[index];
				const itemWantReply = item.wantReply ?? wantReply;
				results[index] = await this.send(item.cmd, item.body, {
					wantReply: itemWantReply,
					ackTimeoutMs: item.ackTimeoutMs ?? ackTimeoutMs,
					replyTimeoutMs: item.replyTimeoutMs ?? replyTimeoutMs
				});
			}
		};
		await Promise.all(Array.from({ length: workerCount }, () => worker()));
		return results;
	}
	waitForPacket(predicate = () => true, { timeoutMs = 0 } = {}) {
		return new Promise((resolve, reject) => {
			let timer = null;
			const cleanup = () => {
				this.off("packet", onPacket);
				if (timer) {
					clearTimeout(timer);
					timer = null;
				}
			};
			const onPacket = (packet) => {
				try {
					if (!predicate(packet)) return;
					cleanup();
					resolve(packet);
				} catch (error) {
					cleanup();
					reject(error);
				}
			};
			this.on("packet", onPacket);
			if (timeoutMs > 0) timer = setTimeout(() => {
				cleanup();
				reject(/* @__PURE__ */ new Error(`recv packet timed out after ${timeoutMs} ms`));
			}, timeoutMs);
		});
	}
	close() {
		if (this.closed) return;
		this.closed = true;
		this.rejectControlPending(/* @__PURE__ */ new Error("qq_hook client closed"));
		this.rejectRecvPending(/* @__PURE__ */ new Error("qq_hook client closed"));
		this.rejectLoginWaiters(/* @__PURE__ */ new Error("qq_hook client closed"));
		for (const socket of this.connectingSockets) socket.destroy();
		this.connectingSockets.clear();
		if (this.controlSocket) {
			this.controlSocket.destroy();
			this.controlSocket = null;
		}
		if (this.recvSocket) {
			this.recvSocket.destroy();
			this.recvSocket = null;
		}
		this.controlHello = null;
		this.recvHello = null;
		this.controlWriteChain = Promise.resolve();
	}
	assertUsable() {
		if (this.runtimeFailure) throw this.runtimeFailure;
		if (this.closed) throw new Error("qq_hook client is closed");
	}
	rejectLoginWaiters(error) {
		for (const waiter of this.loginWaiters) waiter.reject(error);
		this.loginWaiters.clear();
	}
	rejectControlPending(error) {
		for (const pending of this.pendingAcks.values()) pending.reject(error);
		for (const pending of this.pendingReplies.values()) pending.reject(error);
		this.pendingAcks.clear();
		this.pendingReplies.clear();
		if (this.controlHelloResolver) {
			this.controlHelloResolver.reject(error);
			this.controlHelloResolver = null;
		}
	}
	rejectRecvPending(error) {
		if (this.recvHelloResolver) {
			this.recvHelloResolver.reject(error);
			this.recvHelloResolver = null;
		}
	}
	writeControl(payload) {
		const socket = this.controlSocket;
		if (!socket || socket.destroyed) return Promise.reject(this.runtimeFailure ?? /* @__PURE__ */ new Error("control pipe is not connected"));
		const writePromise = this.controlWriteChain.then(() => {
			this.assertUsable();
			if (this.controlSocket !== socket || socket.destroyed) throw new Error("control pipe is not connected");
			return new Promise((resolve, reject) => {
				socket.write(payload, (error) => {
					if (error) reject(error);
					else resolve();
				});
			});
		});
		this.controlWriteChain = writePromise.catch(() => {});
		return writePromise;
	}
	allocateRequestId() {
		let requestId = this.nextRequestId;
		while (this.pendingAcks.has(requestId) || this.pendingReplies.has(requestId)) {
			requestId = requestId + 1 >>> 0;
			if (requestId === 0) requestId = 1;
		}
		this.nextRequestId = requestId + 1 >>> 0;
		if (this.nextRequestId === 0) this.nextRequestId = 1;
		return requestId;
	}
	async sendAckOnly(op, value0, label) {
		await this.connect();
		const requestId = this.allocateRequestId();
		const ackDeferred = createDeferred();
		ackDeferred.promise.catch(() => {});
		this.pendingAcks.set(requestId, {
			resolve: ackDeferred.resolve,
			reject: ackDeferred.reject,
			wantReply: false
		});
		try {
			await this.writeControl(encodeFrame({
				op,
				requestId,
				value0
			}));
			await withTimeout(ackDeferred.promise, this.defaultAckTimeoutMs, `${label} ack ${requestId}`);
			return requestId;
		} catch (error) {
			this.pendingAcks.delete(requestId);
			throw error;
		}
	}
	async connectPipe(kind) {
		return runWithTraceRequest(async () => {
			const startedAt = Date.now();
			const pipeName = kind === "control" ? QqHookClient.controlPipeName(this.pid, this.runtimeDir) : QqHookClient.recvPipeName(this.pid, this.runtimeDir);
			let phase = "connect";
			runtimeLog$2.trace("hook_pipe_start pid=%d kind=%s pipeName=%j", this.pid, kind, pipeName);
			try {
				const socket = await runWithoutRequestContext(() => this.connectSocket(pipeName, kind, kind === "control" ? (frame) => this.handleControlFrame(frame) : (frame) => this.handleRecvFrame(frame)));
				if (this.closed || this.runtimeFailure) {
					socket.destroy();
					this.assertUsable();
				}
				if (kind === "control") this.controlSocket = socket;
				else this.recvSocket = socket;
				runtimeLog$2.trace("hook_pipe_branch pid=%d kind=%s branch=socket_connected", this.pid, kind);
				phase = "hello";
				const hello = await this.waitForHello(kind === "recv");
				this.assertUsable();
				if (kind === "control") this.controlHello = hello;
				else this.recvHello = hello;
				runtimeLog$2.trace(() => [
					"hook_pipe_terminal pid=%d kind=%s outcome=completed reason=hello_received hello=%s elapsedMs=%d",
					this.pid,
					kind,
					renderParamsVerbose(hello),
					Date.now() - startedAt
				]);
				return hello;
			} catch (error) {
				runtimeLog$2.trace(() => [
					"hook_pipe_terminal pid=%d kind=%s outcome=failed reason=%s error=%j elapsedMs=%d",
					this.pid,
					kind,
					phase === "connect" ? "connect_failed" : "hello_failed",
					error instanceof Error ? error.message : String(error),
					Date.now() - startedAt
				]);
				throw error;
			}
		});
	}
	connectSocket(pipeName, kind, onFrame) {
		return new Promise((resolve, reject) => {
			const socket = net.createConnection(pipeName);
			this.connectingSockets.add(socket);
			const reader = new FrameReader(onFrame);
			const onInitialError = (error) => reject(error);
			const onInitialClose = () => {
				this.connectingSockets.delete(socket);
				socket.off("connect", onConnect);
				reject(/* @__PURE__ */ new Error(`${kind} pipe closed before connecting`));
			};
			const onConnect = () => {
				this.connectingSockets.delete(socket);
				socket.off("close", onInitialClose);
				socket.off("error", onInitialError);
				socket.on("data", (chunk) => {
					try {
						reader.push(chunk);
					} catch (error) {
						this.emit("error", error);
						socket.destroy();
					}
				});
				socket.on("error", (error) => {
					this.emit("error", error);
				});
				socket.on("close", () => {
					runWithTraceRequest(() => {
						this.handleSocketClose(kind);
						this.emit("close", kind);
					});
				});
				resolve(socket);
			};
			socket.once("error", onInitialError);
			socket.once("close", onInitialClose);
			socket.once("connect", onConnect);
		});
	}
	waitForHello(recvPipe) {
		const deferred = createDeferred();
		if (recvPipe) this.recvHelloResolver = deferred;
		else this.controlHelloResolver = deferred;
		return deferred.promise;
	}
	resolveHello(frame, recvPipe) {
		const resolver = recvPipe ? this.recvHelloResolver : this.controlHelloResolver;
		if (!resolver) return;
		if (recvPipe) this.recvHelloResolver = null;
		else this.controlHelloResolver = null;
		resolver.resolve({
			pipeName: frame.msg,
			pid: Number(frame.value0),
			recvPipe
		});
	}
	handleSocketClose(kind) {
		runtimeLog$2.trace("hook_runtime_fact pid=%d event=pipe_closed kind=%s loggedIn=%s uin=%j", this.pid, kind, this.loginState.loggedIn, this.loginState.uin);
		if (kind === "control") {
			this.controlSocket = null;
			this.controlHello = null;
			this.rejectControlPending(/* @__PURE__ */ new Error("control pipe closed"));
			return;
		}
		this.recvSocket = null;
		this.recvHello = null;
		this.rejectRecvPending(/* @__PURE__ */ new Error("recv pipe closed"));
	}
	applyLoginStateFrame(frame) {
		const flaggedLoggedIn = (frame.flags & PipeFlagLoggedIn) !== 0;
		const statusLoggedIn = frame.status !== 0;
		const loggedIn = flaggedLoggedIn || statusLoggedIn;
		const uinNumber = BigInt(frame.value0);
		const uin = frame.msg || uinNumber.toString();
		this.applyLoginState({
			loggedIn,
			uin,
			uinNumber
		});
	}
	applyLoginState(next) {
		const previous = this.loginState;
		this.loginState = next;
		if (previous.loggedIn === next.loggedIn && previous.uin === next.uin) {
			this.emit("loginState", next);
			return;
		}
		runWithTraceRequest(() => {
			runtimeLog$2.trace("hook_runtime_fact pid=%d event=login_state_changed previousLoggedIn=%s previousUin=%j loggedIn=%s uin=%j", this.pid, previous.loggedIn, previous.uin, next.loggedIn, next.uin);
			this.emit("loginState", next);
			if (next.loggedIn) {
				for (const waiter of this.loginWaiters) waiter.resolve({ ...next });
				this.loginWaiters.clear();
			}
		});
	}
	handleControlFrame(frame) {
		if (this.runtimeFailure) return;
		if (frame.op === 1) {
			this.resolveHello(frame, false);
			return;
		}
		if (frame.op === 7) {
			this.applyLoginStateFrame(frame);
			return;
		}
		if (frame.op === 3) {
			const pending = this.pendingAcks.get(frame.requestId);
			if (!pending) return;
			this.pendingAcks.delete(frame.requestId);
			pending.resolve({
				requestId: frame.requestId,
				wantReply: pending.wantReply
			});
			return;
		}
		if (frame.op === 4) {
			const pending = this.pendingReplies.get(frame.requestId);
			if (!pending) return;
			this.pendingReplies.delete(frame.requestId);
			pending.resolve({
				requestId: frame.requestId,
				error: frame.status,
				message: frame.msg,
				body: Buffer.from(frame.body)
			});
			return;
		}
		if (frame.op === 5) {
			const error = new HookPipeRequestError(frame.msg || `pipe error ${frame.status}`, frame.status, frame.requestId);
			if (frame.requestId === 0 && frame.cmd === "runtime") {
				this.runtimeFailure = error;
				this.rejectControlPending(error);
				this.rejectRecvPending(error);
				this.rejectLoginWaiters(error);
				this.emit("runtimeError", error);
				return;
			}
			const ack = this.pendingAcks.get(frame.requestId);
			if (ack) {
				this.pendingAcks.delete(frame.requestId);
				ack.reject(error);
			}
			const reply = this.pendingReplies.get(frame.requestId);
			if (reply) {
				this.pendingReplies.delete(frame.requestId);
				reply.reject(error);
			}
		}
	}
	handleRecvFrame(frame) {
		if (this.runtimeFailure) return;
		if (frame.op === 1) {
			this.resolveHello(frame, true);
			return;
		}
		if (frame.op === 7) {
			this.applyLoginStateFrame(frame);
			return;
		}
		if (frame.op === 22) {
			if (frame.status === 1) runtimeLog$2.debug("Client private-message reporting is available: PID=%d", this.pid);
			else runtimeLog$2.warn("Client private-message reporting is unavailable: PID=%d status=%d%s", this.pid, frame.status, frame.value0 === 0n ? "" : ` reason=${frame.value0}`);
			return;
		}
		if (frame.op === 21) {
			if (frame.cmd !== "" || frame.requestId !== 0 || frame.flags !== 0 || frame.value0 <= 0n || frame.value0 > BigInt(Number.MAX_SAFE_INTEGER) || !isRealUin(frame.msg)) {
				runtimeLog$2.warn("Invalid client message receipt: PID=%d", this.pid);
				return;
			}
			this.emit("packet", {
				seq: Number(frame.value0),
				error: frame.status,
				cmd: CLIENT_MESSAGE_RECEIPT_CMD,
				uin: frame.msg,
				body: Buffer.from(frame.body),
				source: "client-message"
			});
			return;
		}
		if (frame.op !== 6) return;
		this.emit("packet", {
			seq: Number(frame.value0),
			error: frame.status,
			cmd: frame.cmd,
			uin: frame.msg,
			body: Buffer.from(frame.body)
		});
	}
};
export {};
