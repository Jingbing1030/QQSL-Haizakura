// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/actions/stream-download.ts"
// original bundle lines 18321-18778  (456 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
init_utils();
var downloadFrameSchema = {
	oneOf: [
		{
			type: "object",
			properties: {
				type: { const: "stream" },
				data_type: { const: "file_info" },
				file_name: { type: "string" },
				file_size: {
					type: "integer",
					description: "字节数，0 可表示未知"
				},
				chunk_size: { type: "integer" }
			},
			required: [
				"type",
				"data_type",
				"file_name",
				"file_size",
				"chunk_size"
			]
		},
		{
			type: "object",
			properties: {
				type: { const: "stream" },
				data_type: { const: "file_chunk" },
				index: { type: "integer" },
				data: {
					type: "string",
					description: "该分块的 Base64 数据"
				},
				size: { type: "integer" },
				progress: {
					type: "number",
					minimum: 0,
					maximum: 100
				},
				base64_size: { type: "integer" }
			},
			required: [
				"type",
				"data_type",
				"index",
				"data",
				"size",
				"progress",
				"base64_size"
			]
		},
		{
			type: "object",
			properties: {
				type: { const: "response" },
				data_type: { const: "file_complete" },
				file_name: { type: "string" },
				total_chunks: { type: "integer" },
				total_bytes: { type: "integer" },
				message: { type: "string" }
			},
			required: [
				"type",
				"data_type",
				"file_name",
				"total_chunks",
				"total_bytes",
				"message"
			]
		}
	],
	description: "每个成功流式帧的 data；失败帧另由 status/retcode/wording 与 type=error 表示，不是 MCP 保存文件后的工具结果"
};
var DEFAULT_CHUNK_BYTES = 64 * 1024;
var MAX_CHUNK_REQUEST_BYTES = 16 * 1024 * 1024;
var MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024 * 1024;
var FETCH_CONNECT_TIMEOUT_MS = 3e4;
var IDLE_TIMEOUT_MS = 6e4;
var MAX_REDIRECTS = 5;
var DOWNLOAD_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var DownloadError = class extends Error {};
function isWithinStreamRoot(p) {
	let root = path$1.resolve(STREAM_ROOT);
	try {
		root = fs$1.realpathSync(STREAM_ROOT);
	} catch {}
	const rel = path$1.relative(root, path$1.resolve(p));
	return rel !== "" && !rel.startsWith("..") && !path$1.isAbsolute(rel);
}
function isPrivateV4(o) {
	return o[0] === 0 || o[0] === 127 || o[0] === 10 || o[0] === 192 && o[1] === 168 || o[0] === 172 && o[1] >= 16 && o[1] <= 31 || o[0] === 169 && o[1] === 254 || o[0] === 100 && o[1] >= 64 && o[1] <= 127;
}
/** Parse an IPv6 string (any form, incl. `::` compression and embedded IPv4)
*  to its 16 bytes. `new URL().hostname` normalises v4-mapped addresses to hex
*  (`::ffff:7f00:1`), so string matching is unreliable — we work on bytes. */
function ipv6ToBytes(input) {
	let s = input.replace(/^\[|\]$/g, "");
	if (net.isIP(s) !== 6) return null;
	const v4m = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
	if (v4m) {
		const o = v4m[1].split(".").map(Number);
		if (o.some((n) => n > 255)) return null;
		s = s.slice(0, v4m.index) + `:${(o[0] << 8 | o[1]).toString(16)}:${(o[2] << 8 | o[3]).toString(16)}`;
	}
	const halves = s.split("::");
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(":") : [];
	const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
	let groups;
	if (halves.length === 2) {
		const missing = 8 - head.length - tail.length;
		if (missing < 0) return null;
		groups = [
			...head,
			...new Array(missing).fill("0"),
			...tail
		];
	} else groups = head;
	if (groups.length !== 8) return null;
	const bytes = /* @__PURE__ */ new Uint8Array(16);
	for (let i = 0; i < 8; i++) {
		const g = parseInt(groups[i] || "0", 16);
		if (Number.isNaN(g) || g < 0 || g > 65535) return null;
		bytes[i * 2] = g >> 8;
		bytes[i * 2 + 1] = g & 255;
	}
	return bytes;
}
function isPrivateIp(ip) {
	const host = ip.replace(/^\[|\]$/g, "");
	const fam = net.isIP(host);
	if (fam === 4) return isPrivateV4(host.split(".").map(Number));
	if (fam === 6) {
		const b = ipv6ToBytes(host);
		if (!b) return true;
		if (b.every((x) => x === 0)) return true;
		if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true;
		if ((b[0] & 254) === 252) return true;
		if (b[0] === 254 && (b[1] & 192) === 128) return true;
		if (b.slice(0, 10).every((x) => x === 0) && (b[10] === 255 && b[11] === 255 || b[10] === 0 && b[11] === 0)) return isPrivateV4([
			b[12],
			b[13],
			b[14],
			b[15]
		]);
		if (b[0] === 0 && b[1] === 100 && b[2] === 255 && b[3] === 155 && b.slice(4, 12).every((x) => x === 0)) return isPrivateV4([
			b[12],
			b[13],
			b[14],
			b[15]
		]);
		return false;
	}
	return false;
}
/** Parse + SSRF-guard a URL: http(s) only, and neither the literal host nor any
*  DNS-resolved address may be private/loopback/link-local. Not bulletproof
*  against DNS rebinding, but blocks the obvious metadata-endpoint / internal
*  service reach. */
async function assertSafeUrl(raw) {
	let u;
	try {
		u = new URL(raw);
	} catch {
		throw new DownloadError("invalid URL");
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") throw new DownloadError("only http(s) URLs are allowed");
	const host = u.hostname.replace(/^\[|\]$/g, "");
	if (net.isIP(host)) {
		if (isPrivateIp(host)) throw new DownloadError("refusing to fetch a private/loopback address");
		return u;
	}
	let addrs;
	try {
		addrs = await dns.lookup(host, { all: true });
	} catch {
		throw new DownloadError(`cannot resolve host: ${host}`);
	}
	for (const a of addrs) if (isPrivateIp(a.address)) throw new DownloadError("refusing to fetch a host that resolves to a private address");
	return u;
}
var asStr = (v) => typeof v === "string" ? v : "";
var asNum = (v) => {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : 0;
};
/** Follow redirects MANUALLY, SSRF-guarding every hop. Default fetch follows
*  redirects automatically and would NOT re-check the target, so a public URL
*  could 302 to a private/metadata address — re-validating each Location closes
*  that. Each hop gets a TTFB-only timeout (cleared once headers arrive, so a
*  legitimate slow/large body isn't cut mid-transfer); the final hop's
*  AbortController is returned so the caller's idle watchdog can kill a stalled
*  body. (DNS rebinding between our check and undici's own connect remains a
*  known residual — it needs connect-time peer-IP validation to fully close.) */
async function fetchGuarded(rawUrl) {
	let current = rawUrl;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const u = await assertSafeUrl(current);
		const ac = new AbortController();
		const t = setTimeout(() => ac.abort(), FETCH_CONNECT_TIMEOUT_MS);
		let resp;
		try {
			resp = await fetch(u, {
				headers: { "User-Agent": DOWNLOAD_USER_AGENT },
				redirect: "manual",
				signal: ac.signal
			});
		} finally {
			clearTimeout(t);
		}
		if (resp.status >= 300 && resp.status < 400) {
			const loc = resp.headers.get("location");
			await resp.body?.cancel().catch(() => {});
			if (!loc) throw new DownloadError(`download failed: ${resp.status} redirect without Location`);
			current = new URL(loc, u).toString();
			continue;
		}
		return {
			resp,
			abort: () => ac.abort()
		};
	}
	throw new DownloadError("download failed: too many redirects");
}
async function openUrl(rawUrl, name, knownSize) {
	const { resp, abort } = await fetchGuarded(rawUrl);
	if (!resp.ok) {
		await resp.body?.cancel().catch(() => {});
		throw new DownloadError(`download failed: HTTP ${resp.status}`);
	}
	const declared = Number(resp.headers.get("content-length") ?? "");
	const size = (Number.isFinite(declared) && declared > 0 ? declared : 0) || knownSize;
	if (!resp.body) throw new DownloadError("download failed: empty response body");
	return {
		name: name || urlBasename(rawUrl),
		size,
		iterable: resp.body,
		abort
	};
}
function urlBasename(u) {
	try {
		const name = path$1.basename(new URL(u).pathname);
		return name && name !== "/" ? decodeURIComponent(name) : "download.bin";
	} catch {
		return "download.bin";
	}
}
async function resolveDownload(target, ctx, prefer, chunkSize) {
	const local = resolveLocalFilePath(target);
	if (local) {
		let st = null;
		try {
			st = fs$1.statSync(local);
		} catch {
			st = null;
		}
		if (st?.isFile()) {
			ensureStreamDirectory(STREAM_ROOT);
			let real = local;
			try {
				real = fs$1.realpathSync(local);
			} catch {}
			if (!isWithinStreamRoot(real)) throw new DownloadError("local downloads are restricted to the stream temp directory");
			const rs = fs$1.createReadStream(real, { highWaterMark: chunkSize });
			return {
				name: path$1.basename(real),
				size: st.size,
				iterable: rs,
				managedPath: real,
				abort: () => rs.destroy()
			};
		}
	}
	if (/^https?:\/\//i.test(target)) return openUrl(target, "", 0);
	let info = null;
	if (prefer !== "record") info = await ctx.getImageInfo(target);
	if (!info && prefer !== "image") info = await ctx.getRecordInfo(target);
	if (info) {
		const url = asStr(info.url) || asStr(info.file);
		if (/^https?:\/\//i.test(url)) return openUrl(url, asStr(info.file_name), asNum(info.file_size));
	}
	throw new DownloadError("file not found (expected a stream-dir path, an http(s) URL, or a cached image/voice id)");
}
async function streamChunks(sink, iterable, totalSize, dataType, abort) {
	let index = 0;
	let bytesRead = 0;
	let idle = null;
	const armIdle = () => {
		if (idle) clearTimeout(idle);
		idle = setTimeout(() => {
			abort?.();
		}, IDLE_TIMEOUT_MS);
		if (idle.unref) idle.unref();
	};
	armIdle();
	try {
		for await (const part of iterable) {
			armIdle();
			const buf = Buffer.isBuffer(part) ? part : Buffer.from(part);
			bytesRead += buf.length;
			if (bytesRead > MAX_DOWNLOAD_BYTES) throw new DownloadError(`download exceeds size limit (${MAX_DOWNLOAD_BYTES} bytes)`);
			const b64 = buf.toString("base64");
			await sink.send({
				type: StreamStatus.Stream,
				data_type: dataType,
				index,
				data: b64,
				size: buf.length,
				progress: totalSize > 0 ? Math.min(100, Math.round(bytesRead / totalSize * 100)) : 0,
				base64_size: b64.length
			});
			index++;
		}
	} finally {
		if (idle) clearTimeout(idle);
	}
	return {
		totalChunks: index,
		totalBytes: bytesRead
	};
}
async function runDownload(target, chunkSizeReq, ctx, sink, prefer) {
	if (!target) throw new DownloadError("file is required");
	let chunkSize = chunkSizeReq && chunkSizeReq > 0 ? chunkSizeReq : DEFAULT_CHUNK_BYTES;
	if (chunkSize > MAX_CHUNK_REQUEST_BYTES) chunkSize = MAX_CHUNK_REQUEST_BYTES;
	const src = await resolveDownload(target, ctx, prefer, chunkSize);
	const releaseStorageActivity = src.managedPath ? registerActiveStreamItem([src.managedPath]) : void 0;
	try {
		await sink.send({
			type: StreamStatus.Stream,
			data_type: "file_info",
			file_name: src.name,
			file_size: src.size,
			chunk_size: chunkSize
		});
		const { totalChunks, totalBytes } = await streamChunks(sink, src.iterable, src.size, "file_chunk", src.abort);
		return okResponse({
			type: StreamStatus.Response,
			data_type: "file_complete",
			file_name: src.name,
			total_chunks: totalChunks,
			total_bytes: totalBytes,
			message: "Download completed"
		});
	} finally {
		releaseStorageActivity?.();
	}
}
var downloadParams = {
	file: f$1.string().optional().describe("文件路径(限 stream 临时目录)/ http(s) URL").role("file"),
	file_id: f$1.string().optional().describe("文件 ID(缓存的图片/语音 id)").role("file_id"),
	chunk_size: f$1.int({ min: 1 }).optional().describe("分块大小(字节,默认 64KB)")
};
var actions$1 = [
	defineStreamAction({
		name: "download_file_stream",
		examples: [{
			summary: "以流式方式下载文件(stream 目录本地文件 / URL / 缓存媒体)",
			params: {
				file: "https://example.com/report.pdf",
				chunk_size: 65536
			},
			notes: "替换实际公开可访问地址；经 invoke_action 调用，文件保存到 MCP 下载目录。"
		}],
		returnsSchema: downloadFrameSchema,
		summary: "以流式方式下载文件(stream 目录本地文件 / URL / 缓存媒体)",
		returns: "流式帧:file_info → file_chunk* → file_complete",
		params: downloadParams,
		run: (p, ctx, sink) => runDownload(p.file || p.file_id || "", p.chunk_size, ctx, sink, "auto")
	}),
	defineStreamAction({
		name: "download_file_image_stream",
		examples: [{
			summary: "以流式方式下载图片(缓存图片 id / URL / stream 目录本地文件)",
			params: {
				file_id: "<image-file-from-message>",
				chunk_size: 65536
			},
			notes: "file_id 来自当前账号图片消息；经 invoke_action 调用。"
		}],
		returnsSchema: downloadFrameSchema,
		summary: "以流式方式下载图片(缓存图片 id / URL / stream 目录本地文件)",
		returns: "流式帧:file_info → file_chunk* → file_complete",
		params: downloadParams,
		run: (p, ctx, sink) => runDownload(p.file || p.file_id || "", p.chunk_size, ctx, sink, "image")
	}),
	defineStreamAction({
		name: "download_file_record_stream",
		examples: [{
			summary: "以流式方式下载语音(缓存语音 id / URL / stream 目录本地文件)",
			params: {
				file_id: "<record-file-from-message>",
				chunk_size: 65536
			},
			notes: "file_id 来自当前账号语音消息；经 invoke_action 调用。"
		}],
		returnsSchema: downloadFrameSchema,
		summary: "以流式方式下载语音(缓存语音 id / URL / stream 目录本地文件)",
		returns: "流式帧:file_info → file_chunk* → file_complete",
		params: downloadParams,
		run: (p, ctx, sink) => runDownload(p.file || p.file_id || "", p.chunk_size, ctx, sink, "record")
	}),
	defineStreamAction({
		name: "test_download_stream",
		examples: [{
			summary: "测试下载流(推送 10 个数据帧,验证流式传输,不触达 QQ)",
			params: { error: false },
			notes: "经 invoke_action 调用，仅测试传输，不访问 QQ。"
		}],
		returnsSchema: {
			oneOf: [{
				type: "object",
				properties: {
					type: { const: "stream" },
					data_type: { const: "data_chunk" },
					data: { type: "string" }
				},
				required: [
					"type",
					"data_type",
					"data"
				]
			}, {
				type: "object",
				properties: {
					type: { const: "response" },
					data_type: { const: "data_complete" },
					data: { type: "string" }
				},
				required: [
					"type",
					"data_type",
					"data"
				]
			}],
			description: "成功时 10 个 data_chunk 后接 data_complete；error=true 时最终为失败帧"
		},
		summary: "测试下载流(推送 10 个数据帧,验证流式传输,不触达 QQ)",
		returns: "流式帧:data_chunk*10 → data_complete(error=true 时以 error 帧结束)",
		params: { error: f$1.bool().default(false).describe("是否触发测试错误") },
		run: async (p, _ctx, sink) => {
			for (let i = 0; i < 10; i++) await sink.send({
				type: StreamStatus.Stream,
				data: `Index-> ${i + 1}`,
				data_type: "data_chunk"
			});
			if (p.error) throw new DownloadError("This is a test error");
			return okResponse({
				type: StreamStatus.Response,
				data_type: "data_complete",
				data: "Stream transmission complete"
			});
		}
	})
];
export {};
