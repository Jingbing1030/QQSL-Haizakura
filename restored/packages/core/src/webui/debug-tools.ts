/** Temp dir for browser→server uploads. Siblings the Stream API's temp root but
*  kept distinct so the two cleanup stories don't entangle. */
var DEBUG_UPLOAD_DIR = path$1.join(os.tmpdir(), "webui-upload");
/** Uploads older than this are swept on the next upload (best-effort). */
var UPLOAD_TTL_MS = 1440 * 60 * 1e3;
/** Reduce a client-supplied filename to a safe basename (extension preserved),
*  with no path separators or traversal. The client path is NEVER trusted for
*  placement — this is only used to keep the stored name human-readable. */
function safeUploadName(raw) {
	return path$1.basename(String(raw ?? "").replace(/\\/g, "/")).replace(/[^\w.-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "file";
}
/** Unguessable destination path under DEBUG_UPLOAD_DIR for a sanitised name.
*  Throws if the composed path would escape the dir (defence in depth — it
*  can't, given the random id + basename, but we assert anyway). */
function uploadDestPath(safeName) {
	const id = randomBytes$1(12).toString("hex");
	const dest = path$1.join(DEBUG_UPLOAD_DIR, `${id}__${safeName}`);
	const rel = path$1.relative(DEBUG_UPLOAD_DIR, dest);
	if (rel === "" || rel.startsWith("..") || path$1.isAbsolute(rel)) throw new Error("invalid upload path");
	return dest;
}
/** Stream raw request-body bytes to a temp file under DEBUG_UPLOAD_DIR, enforcing
*  a byte cap. Returns the final server path + byte size. On overflow or any
*  error the partial file is removed and the call rejects. Never buffers the
*  whole body. */
async function streamUploadToDisk(body, filename, opts = {}) {
	if (!body) throw new Error("empty body");
	const maxBytes = opts.maxBytes ?? 4294967296;
	await mkdir$1(DEBUG_UPLOAD_DIR, { recursive: true });
	sweepOldUploads();
	const dest = uploadDestPath(safeUploadName(filename));
	const out = createWriteStream$1(dest, { mode: 384 });
	const errored = new Promise((_, rej) => out.once("error", rej));
	errored.catch(() => {});
	let size = 0;
	try {
		const reader = body.getReader();
		for (;;) {
			const { done, value } = await Promise.race([errored, reader.read()]);
			if (done) break;
			if (!value || value.byteLength === 0) continue;
			const offset = size;
			size += value.byteLength;
			traceWebuiMutationRequestChunk(value, offset);
			if (size > maxBytes) throw new Error("上传超出大小上限");
			if (!out.write(value)) await Promise.race([errored, new Promise((res) => out.once("drain", res))]);
		}
		await Promise.race([errored, new Promise((res, rej) => out.end((err) => err ? rej(err) : res()))]);
		if (size === 0) throw new Error("empty body");
		return {
			path: dest,
			size
		};
	} catch (err) {
		out.destroy();
		if (!out.closed) await new Promise((res) => out.once("close", () => res()));
		await rm$1(dest, { force: true }).catch(() => {});
		throw err;
	}
}
/** Remove upload temp files older than the TTL. Best-effort; never throws. */
async function sweepOldUploads(now = Date.now()) {
	let removed = 0;
	try {
		const names = await readdir(DEBUG_UPLOAD_DIR);
		await Promise.all(names.map(async (n) => {
			const p = path$1.join(DEBUG_UPLOAD_DIR, n);
			try {
				if (now - (await stat$1(p)).mtimeMs > UPLOAD_TTL_MS) {
					await rm$1(p, {
						force: true,
						recursive: true
					});
					removed += 1;
				}
			} catch {}
		}));
	} catch {}
	return removed;
}
/** How long emit() will wait for a backed-up consumer to drain before it gives
*  up waiting and enqueues anyway (the request abort / action idle-watchdog are
*  the real stall guards). */
var DRAIN_WAIT_MS = 20;
var DRAIN_MAX_SPINS = 3e3;
/** Build the SSE `Response` for `/api/debug/invoke-stream`: each relayed frame
*  is one `data: <json>\n\n` event; no frame is ever dropped. A driver error
*  becomes a terminal `failed` frame. Closing the request (signal abort) stops
*  delivery. `delay` is injectable for tests. */
function buildStreamInvokeResponse(driver, rawRequest, signal, delay = (ms) => new Promise((r) => setTimeout(r, ms))) {
	return sseResponse(signal, (channel) => {
		const isAlive = () => !channel.isClosed();
		const emit = async (json) => {
			if (!isAlive()) throw new Error("stream transport closed");
			let spins = 0;
			while (isAlive() && (channel.desiredSize() ?? 1) <= 0 && spins < DRAIN_MAX_SPINS) {
				await delay(DRAIN_WAIT_MS);
				spins += 1;
			}
			if (!isAlive()) throw new Error("stream transport closed");
			channel.raw(channel.encode(`data: ${json}\n\n`));
		};
		const run = async () => {
			try {
				await driver(rawRequest, emit, isAlive);
			} catch (err) {
				if (isAlive()) {
					const msg = err instanceof Error ? err.message : "stream error";
					channel.send({
						status: "failed",
						retcode: 1400,
						message: msg,
						wording: msg
					});
				}
			} finally {
				channel.close();
			}
		};
		run();
	});
}
