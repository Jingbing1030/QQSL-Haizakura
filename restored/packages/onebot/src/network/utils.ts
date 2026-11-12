// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/network/utils.ts"
// original bundle lines 340732-340851  (118 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/**
* Appended to a 1009 (frame-over-cap) log line. Shared so the client and server
* adapters cannot drift apart on the advice they give.
*/
var MAX_PAYLOAD_HINT = "Raise this adapter's maxPayloadBytes, or have the peer send a smaller frame (a URL/file reference or SILK instead of inline PCM)";
function isAuthorized(request, token, allowRawToken = false) {
	if (!token) return true;
	const auth = request.headers.authorization ?? "";
	if (auth === `Bearer ${token}` || allowRawToken && auth === token) return true;
	try {
		if (new URL(request.url ?? "/", "http://127.0.0.1").searchParams.get("access_token") === token) return true;
	} catch {}
	return false;
}
/** Convert anything ws can hand us into a UTF-8 string. */
function rawDataToString(raw) {
	if (typeof raw === "string") return raw;
	if (Buffer.isBuffer(raw)) return raw.toString("utf8");
	if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
	if (raw instanceof ArrayBuffer) return Buffer.from(new Uint8Array(raw)).toString("utf8");
	return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("utf8");
}
function safeSend(socket, payload, onError) {
	if (socket.readyState !== 1) return;
	socket.send(payload, (error) => {
		if (error && onError) onError(error);
	});
}
/** Backpressure-aware send: resolves only once `ws` has flushed `payload` to
*  the socket (the `send` callback fires post-write), so a streaming producer
*  that awaits this won't outrun a slow client and balloon the send buffer.
*  A closed socket or failed write rejects with the shared transport sentinel,
*  allowing the action boundary to classify an in-progress stream cancellation. */
function safeSendAsync(socket, payload) {
	return new Promise((resolve, reject) => {
		if (socket.readyState !== 1) {
			reject(new StreamTransportClosedError("stream client disconnected"));
			return;
		}
		try {
			socket.send(payload, (error) => {
				if (error) {
					reject(new StreamTransportClosedError("stream client disconnected"));
					return;
				}
				resolve();
			});
		} catch {
			reject(new StreamTransportClosedError("stream client disconnected"));
		}
	});
}
function safeClose(socket, code = 1e3, reason = "normal") {
	if (socket.readyState === 3 || socket.readyState === 2) return;
	socket.close(code, reason);
}
/** RFC6455 transport-level keepalive for a reverse-WS connection.
*
*  The OneBot app-level `meta_event` heartbeat is a one-way outbound push, so it
*  cannot detect a connection that is writable but no longer readable — a
*  half-open link left behind when the peer restarts behind a proxy/NAT. In that
*  state events keep flowing out while inbound action frames silently never
*  arrive, and only a full restart recovers it (issue #208).
*
*  This pings every `intervalMs` and counts consecutive silent intervals. ANY
*  inbound activity — a pong OR a message — resets the counter, so a connection
*  carrying real traffic is never reaped. Death is declared once `maxMissed`
*  pings have gone unanswered, i.e. after roughly `(maxMissed + 1) * intervalMs`
*  of total silence (the counter is checked at the top of each tick, so the
*  tick that observes the threshold is one interval past the last ping). The
*  tolerance plus a conservative interval keeps the false-positive rate near
*  zero: a single GC pause, event-loop stall, or transient latency spike is
*  absorbed (Node fires an overdue interval once, not N catch-up times), and
*  death is declared only on genuine sustained silence.
*
*  Returns an idempotent stop function; the timer is `unref`'d so it never keeps
*  the process alive. */
function startHeartbeat(socket, opts, onDead) {
	let missed = 0;
	let stopped = false;
	const onActivity = () => {
		missed = 0;
	};
	socket.on("pong", onActivity);
	socket.on("message", onActivity);
	const timer = setInterval(() => {
		if (missed >= opts.maxMissed) {
			stop();
			onDead();
			return;
		}
		missed += 1;
		try {
			socket.ping();
		} catch {
			stop();
			onDead();
		}
	}, opts.intervalMs);
	timer.unref();
	function stop() {
		if (stopped) return;
		stopped = true;
		clearInterval(timer);
		socket.off("pong", onActivity);
		socket.off("message", onActivity);
	}
	return stop;
}
function normalizePath(pathValue) {
	const path = (pathValue ?? "/").trim() || "/";
	if (path === "/") return "/";
	return path.endsWith("/") ? path.slice(0, -1) : path;
}
function parseRequestPath(urlValue) {
	const queryIndex = urlValue.indexOf("?");
	return queryIndex === -1 ? urlValue : urlValue.slice(0, queryIndex);
}
export {};
