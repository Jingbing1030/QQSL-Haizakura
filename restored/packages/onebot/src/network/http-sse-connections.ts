// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/network/http-sse-connections.ts"
// original bundle lines 341063-341234  (170 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var REPLAY_EVENTS = 256;
var REPLAY_BYTES = 8 * 1024 * 1024;
var CLIENT_BYTES = 8 * 1024 * 1024;
var HEARTBEAT_MS = 15e3;
/** Per-adapter event history and connections; never shared between accounts. */
var HttpSseConnections = class {
	log;
	bootstrap;
	config;
	epoch = randomUUID();
	sequence = 0;
	droppedThrough = 0;
	history = [];
	historyBytes = 0;
	connections = /* @__PURE__ */ new Set();
	heartbeat;
	constructor(config, log, bootstrap) {
		this.log = log;
		this.bootstrap = bootstrap;
		this.config = structuredClone(config);
	}
	get connectionCount() {
		return this.connections.size;
	}
	updateConfig(next) {
		if (this.config.enableSse !== next.enableSse || (this.config.accessToken ?? "") !== (next.accessToken ?? "") || (this.config.messageFormat ?? "array") !== (next.messageFormat ?? "array") || (this.config.reportSelfMessage ?? false) !== (next.reportSelfMessage ?? false)) this.close("configuration changed");
		this.config = structuredClone(next);
	}
	accept(request, response) {
		const cursor = request.headers["last-event-id"];
		let after = this.sequence;
		if (cursor !== void 0 && cursor !== "") {
			const match = typeof cursor === "string" ? /^([0-9a-f-]{36}):(0|[1-9]\d{0,15})$/.exec(cursor) : null;
			const value = match ? Number(match[2]) : NaN;
			if (!match || !Number.isSafeInteger(value)) {
				this.rejectCursor(response, 400, "invalid Last-Event-ID");
				return;
			}
			if (match[1] !== this.epoch || value < this.droppedThrough || value > this.sequence) {
				this.rejectCursor(response, 409, "SSE replay unavailable; resync and reconnect without Last-Event-ID");
				return;
			}
			after = value;
		}
		response.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			"X-Accel-Buffering": "no",
			Connection: "keep-alive"
		});
		response.flushHeaders();
		request.socket.setTimeout(0);
		const onDrain = () => {
			connection.blocked = false;
			this.flush(connection);
		};
		const onError = (error) => {
			this.log.warn("[%s] SSE connection failed: %s", this.config.name, error.message);
			this.drop(connection);
		};
		const onClose = () => this.drop(connection);
		const connection = {
			response,
			queue: [],
			bytes: 0,
			blocked: false,
			dispose: () => {
				response.off("drain", onDrain);
				response.off("close", onClose);
				response.off("error", onError);
			}
		};
		response.on("drain", onDrain);
		response.once("close", onClose);
		response.on("error", onError);
		this.connections.add(connection);
		this.log.debug("[%s] SSE connected (%d clients)", this.config.name, this.connectionCount);
		this.enqueue(connection, this.frame("retry: 3000\n\n"));
		for (const frame of this.history) if (frame.sequence > after) this.enqueue(connection, frame);
		for (const json of this.bootstrap()) this.enqueue(connection, this.eventFrame(json));
		if (!this.heartbeat && this.connections.size > 0) {
			this.heartbeat = setInterval(() => {
				const frame = this.frame(": ping\n\n");
				for (const client of this.connections) this.enqueue(client, frame);
			}, HEARTBEAT_MS);
			this.heartbeat.unref();
		}
	}
	onEvent(payload) {
		const json = pickDispatchJson(payload, resolveReportOptions(this.config));
		if (json === null) return;
		this.sequence += 1;
		const frame = this.eventFrame(json);
		this.history.push(frame);
		this.historyBytes += frame.bytes;
		while (this.history.length > REPLAY_EVENTS || this.historyBytes > REPLAY_BYTES) {
			const removed = this.history.shift();
			this.historyBytes -= removed.bytes;
			this.droppedThrough = removed.sequence;
		}
		for (const connection of this.connections) this.enqueue(connection, frame);
	}
	close(reason) {
		if (this.connections.size > 0) this.log.debug("[%s] SSE closing: %s", this.config.name, reason);
		for (const connection of this.connections) this.drop(connection);
		this.history = [];
		this.historyBytes = 0;
		this.sequence = 0;
		this.droppedThrough = 0;
		this.epoch = randomUUID();
	}
	eventFrame(json) {
		return this.frame(`id: ${this.epoch}:${this.sequence}\ndata: ${json}\n\n`);
	}
	frame(text) {
		return {
			sequence: this.sequence,
			text,
			bytes: Buffer.byteLength(text)
		};
	}
	enqueue(connection, frame) {
		if (!this.connections.has(connection)) return;
		if (connection.bytes + connection.response.writableLength + frame.bytes > CLIENT_BYTES) {
			this.log.warn("[%s] SSE client exceeded %d buffered bytes; disconnecting", this.config.name, CLIENT_BYTES);
			this.drop(connection);
			return;
		}
		connection.queue.push(frame);
		connection.bytes += frame.bytes;
		this.flush(connection);
	}
	flush(connection) {
		while (!connection.blocked && connection.queue.length > 0) {
			const frame = connection.queue.shift();
			connection.bytes -= frame.bytes;
			try {
				connection.blocked = !connection.response.write(frame.text);
			} catch (error) {
				this.log.warn("[%s] SSE write failed: %s", this.config.name, error instanceof Error ? error.message : String(error));
				this.drop(connection);
				return;
			}
		}
	}
	drop(connection) {
		if (!this.connections.delete(connection)) return;
		connection.queue = [];
		connection.bytes = 0;
		if (connection.response.destroyed) connection.dispose();
		else {
			connection.response.once("close", connection.dispose);
			connection.response.destroy();
		}
		if (this.connections.size === 0 && this.heartbeat) {
			clearInterval(this.heartbeat);
			this.heartbeat = void 0;
		}
	}
	rejectCursor(response, status, wording) {
		this.log.warn("[%s] rejected SSE reconnect: %s", this.config.name, wording);
		response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
		response.end(JSON.stringify({
			status: "failed",
			retcode: status === 400 ? 1400 : 1409,
			data: null,
			wording
		}));
	}
};
export {};
