// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/actions/stream-file.ts"
// original bundle lines 17594-17923  (328 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
init_errors();
init_logger();
var log$61 = createLogger("OneBot.Stream");
var UPLOAD_TIMEOUT_MS = 600 * 1e3;
var DEFAULT_RETENTION_MS = 300 * 1e3;
var MAX_CONCURRENT_STREAMS = 64;
var MAX_CHUNKS = 2e5;
var MAX_CHUNK_BYTES = 32 * 1024 * 1024;
var MAX_UPLOAD_BYTES$1 = 4 * 1024 * 1024 * 1024;
var SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
var StreamError = class extends Error {};
function validateStreamId(id) {
	if (!SAFE_ID_RE.test(id)) throw new StreamError("invalid stream_id (allowed: 1-128 chars of A-Z a-z 0-9 _ -)");
}
/** Account namespace for the in-memory map + on-disk dirs. Empty (tests / no
*  login) → flat, un-namespaced. Sanitised so it can't widen the path either. */
function accountKey(ctx) {
	let raw = "";
	try {
		raw = String(ctx?.getLoginInfo?.().userId ?? "");
	} catch {
		raw = "";
	}
	return raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}
/** Belt-and-braces: assert a derived path stays inside the upload dir even if
*  the allowlist above is ever weakened. */
function assertWithin(root, target) {
	const rel = path$1.relative(root, target);
	if (rel === "" || rel.startsWith("..") || path$1.isAbsolute(rel)) throw new StreamError("resolved stream path escapes the upload directory");
}
/** Process-wide. Key is account-namespaced so two accounts (same process) can't
*  collide on a shared/non-UUID stream_id. */
var uploads = /* @__PURE__ */ new Map();
function reapTimer(key) {
	const t = setTimeout(() => {
		cleanupUpload(key, true);
	}, UPLOAD_TIMEOUT_MS);
	if (typeof t.unref === "function") t.unref();
	return t;
}
function cleanupUpload(key, deleteFinal) {
	const state = uploads.get(key);
	if (!state) return;
	clearTimeout(state.timeoutId);
	try {
		fs$1.rmSync(state.tempDir, {
			recursive: true,
			force: true
		});
	} catch (error) {
		log$61.warn("failed to delete stream upload chunks %s: %s", state.tempDir, errorMessage(error));
	}
	if (deleteFinal) try {
		fs$1.rmSync(state.finalPath, { force: true });
	} catch (error) {
		log$61.warn("failed to delete stream upload file %s: %s", state.finalPath, errorMessage(error));
	}
	uploads.delete(key);
	state.releaseStorageActivity();
}
function safeFilename(name, id) {
	return (name ?? "").replace(/[/\\]/g, "_").replace(/\.\.+/g, "_").replace(/^\.+/, "").trim() || `upload_${id}`;
}
function createUpload(p, account) {
	if (!p.total_chunks || p.total_chunks <= 0) throw new StreamError("total_chunks required for new stream");
	if (p.total_chunks > MAX_CHUNKS) throw new StreamError(`total_chunks exceeds limit (${MAX_CHUNKS})`);
	if (p.file_size !== void 0 && p.file_size > MAX_UPLOAD_BYTES$1) throw new StreamError(`file_size exceeds limit (${MAX_UPLOAD_BYTES$1} bytes)`);
	if (uploads.size >= MAX_CONCURRENT_STREAMS) throw new StreamError(`too many concurrent upload streams (${MAX_CONCURRENT_STREAMS})`);
	const filename = safeFilename(p.filename, p.stream_id);
	const dirRoot = account ? path$1.join(STREAM_UPLOAD_DIR, account) : STREAM_UPLOAD_DIR;
	const tempDir = path$1.join(dirRoot, p.stream_id);
	const finalPath = path$1.join(dirRoot, `${p.stream_id}__${filename}`);
	assertWithin(STREAM_UPLOAD_DIR, tempDir);
	assertWithin(STREAM_UPLOAD_DIR, finalPath);
	ensureStreamDirectory(tempDir);
	const key = account ? `${account}:${p.stream_id}` : p.stream_id;
	const releaseStorageActivity = registerActiveStreamItem([tempDir, finalPath]);
	const state = {
		id: p.stream_id,
		key,
		filename,
		totalChunks: p.total_chunks,
		claimed: /* @__PURE__ */ new Set(),
		written: /* @__PURE__ */ new Set(),
		bytesWritten: 0,
		fileSize: p.file_size,
		expectedSha256: p.expected_sha256,
		tempDir,
		finalPath,
		fileRetention: p.file_retention,
		timeoutId: reapTimer(key),
		releaseStorageActivity
	};
	uploads.set(key, state);
	return state;
}
function statusFrame(state, status) {
	return okResponse({
		type: StreamStatus.Stream,
		stream_id: state.id,
		status,
		received_chunks: state.written.size,
		total_chunks: state.totalChunks
	});
}
function writeChunkToStream(stream, buf) {
	return new Promise((resolve, reject) => {
		stream.write(buf, (err) => err ? reject(err) : resolve());
	});
}
async function completeUpload(state) {
	if (state.written.size !== state.totalChunks) {
		const missing = [];
		for (let i = 0; i < state.totalChunks && missing.length < 16; i++) if (!state.written.has(i)) missing.push(i);
		const more = state.totalChunks - state.written.size > missing.length ? "…" : "";
		throw new StreamError(`incomplete stream: missing ${state.totalChunks - state.written.size} chunk(s) [${missing.join(",")}${more}]`);
	}
	const hash = createHash$1("sha256");
	const out = fs$1.createWriteStream(state.finalPath);
	try {
		for (let i = 0; i < state.totalChunks; i++) {
			const buf = await fs$1.promises.readFile(path$1.join(state.tempDir, `${i}.chunk`));
			hash.update(buf);
			await writeChunkToStream(out, buf);
		}
		await new Promise((resolve, reject) => out.end((err) => err ? reject(err) : resolve()));
	} catch (err) {
		out.destroy();
		try {
			fs$1.rmSync(state.finalPath, { force: true });
		} catch (error) {
			log$61.warn("failed to delete incomplete stream file %s: %s", state.finalPath, errorMessage(error));
		}
		throw err;
	}
	const sha256 = hash.digest("hex");
	if (state.expectedSha256 && sha256 !== state.expectedSha256) {
		try {
			fs$1.rmSync(state.finalPath, { force: true });
		} catch (error) {
			log$61.warn("failed to delete invalid stream file %s: %s", state.finalPath, errorMessage(error));
		}
		throw new StreamError(`sha256 mismatch (expected ${state.expectedSha256}, got ${sha256})`);
	}
	const finalPath = state.finalPath;
	const fileSize = fs$1.statSync(finalPath).size;
	const received = state.written.size;
	const total = state.totalChunks;
	const retention = state.fileRetention;
	cleanupUpload(state.key, false);
	if (retention > 0) {
		const t = setTimeout(() => {
			fs$1.rm(finalPath, { force: true }, (err) => {
				if (err) log$61.warn("failed to delete retained stream file %s: %s", finalPath, err.message);
			});
		}, retention);
		if (typeof t.unref === "function") t.unref();
	}
	return okResponse({
		type: StreamStatus.Response,
		stream_id: state.id,
		status: "file_complete",
		received_chunks: received,
		total_chunks: total,
		file_path: finalPath,
		file_name: state.filename,
		file_size: fileSize,
		sha256
	});
}
async function handleUpload(p, account = "") {
	validateStreamId(p.stream_id);
	const key = account ? `${account}:${p.stream_id}` : p.stream_id;
	if (p.reset) {
		cleanupUpload(key, true);
		throw new StreamError("Stream reset completed");
	}
	if (p.verify_only) {
		const state = uploads.get(key);
		if (!state) throw new StreamError("stream not found");
		return statusFrame(state, "file_created");
	}
	const state = uploads.get(key) ?? createUpload(p, account);
	if (p.expected_sha256 !== void 0) state.expectedSha256 = p.expected_sha256;
	if (p.file_size !== void 0) state.fileSize = p.file_size;
	if (p.chunk_data !== void 0 && p.chunk_index !== void 0) {
		const index = p.chunk_index;
		if (index < 0 || index >= state.totalChunks) throw new StreamError(`invalid chunk index: ${index}`);
		if (state.claimed.has(index)) return statusFrame(state, "chunk_received");
		const buf = Buffer.from(p.chunk_data, "base64");
		if (buf.length > MAX_CHUNK_BYTES) throw new StreamError(`chunk exceeds size limit (${MAX_CHUNK_BYTES} bytes)`);
		if (state.bytesWritten + buf.length > MAX_UPLOAD_BYTES$1) throw new StreamError(`stream exceeds total size limit (${MAX_UPLOAD_BYTES$1} bytes)`);
		state.claimed.add(index);
		state.bytesWritten += buf.length;
		try {
			await fs$1.promises.writeFile(path$1.join(state.tempDir, `${index}.chunk`), buf);
		} catch (err) {
			state.claimed.delete(index);
			state.bytesWritten -= buf.length;
			throw err;
		}
		state.written.add(index);
		clearTimeout(state.timeoutId);
		state.timeoutId = reapTimer(state.key);
		return statusFrame(state, "chunk_received");
	}
	if (p.is_complete || state.written.size === state.totalChunks) return completeUpload(state);
	return statusFrame(state, "file_created");
}
var actions$2 = [defineStreamAction({
	name: "upload_file_stream",
	examples: [{
		summary: "上传分块",
		params: {
			stream_id: "example-upload-001",
			filename: "hello.txt",
			total_chunks: 1,
			file_size: 5,
			chunk_index: 0,
			chunk_data: "aGVsbG8="
		},
		notes: "第 1 步：每次上传生成新的 stream_id；这里上传 hello 的唯一分块。通过 invoke_action 调用，分块确认不等于整文件完成。"
	}, {
		summary: "完成同一上传",
		params: {
			stream_id: "example-upload-001",
			is_complete: true
		},
		notes: "第 2 步：等待全部分块确认后，用同一个 stream_id 单独请求完成；成功时返回 file_path。MCP 的 invoke_action 也可通过 execution.input_file 自动完成上传。"
	}],
	returnsSchema: {
		oneOf: [{
			type: "object",
			properties: {
				type: { const: "stream" },
				stream_id: { type: "string" },
				status: { enum: ["file_created", "chunk_received"] },
				received_chunks: { type: "integer" },
				total_chunks: { type: "integer" }
			},
			required: [
				"type",
				"stream_id",
				"status",
				"received_chunks",
				"total_chunks"
			]
		}, {
			type: "object",
			properties: {
				type: { const: "response" },
				stream_id: { type: "string" },
				status: { const: "file_complete" },
				received_chunks: { type: "integer" },
				total_chunks: { type: "integer" },
				file_path: { type: "string" },
				file_name: { type: "string" },
				file_size: { type: "integer" },
				sha256: { type: "string" }
			},
			required: [
				"type",
				"stream_id",
				"status",
				"received_chunks",
				"total_chunks",
				"file_path",
				"file_name",
				"file_size",
				"sha256"
			]
		}],
		description: "分块确认与完成帧的 data；reset 和其他失败由错误帧返回。必须等到 file_complete 才能使用 file_path"
	},
	summary: "以流式分块方式上传文件到机器人本地(返回可用于发送的本地路径)",
	returns: "流式帧:分块确认 type=stream、完成 type=response(含 file_path/file_name/file_size/sha256)",
	params: {
		stream_id: f$1.string({ allowEmpty: false }).describe("流 ID(客户端生成的 UUID,限 [A-Za-z0-9_-])"),
		chunk_data: f$1.string().optional().describe("分块数据(Base64)"),
		chunk_index: f$1.int({ min: 0 }).optional().describe("分块索引(从 0 开始)"),
		total_chunks: f$1.int({ min: 1 }).optional().describe("总分块数(新流必填)"),
		file_size: f$1.int({ min: 0 }).optional().describe("文件总大小(字节)"),
		expected_sha256: f$1.string().optional().describe("期望的整文件 SHA256(校验)"),
		is_complete: f$1.bool().optional().describe("是否为最后一个分块/触发合并"),
		filename: f$1.string().optional().describe("文件名"),
		reset: f$1.bool().optional().describe("重置并丢弃该流"),
		verify_only: f$1.bool().optional().describe("仅查询当前流状态"),
		file_retention: f$1.int({ min: 0 }).default(DEFAULT_RETENTION_MS).describe("合并文件保留毫秒(0=不回收)")
	},
	run: (p, ctx) => handleUpload(p, accountKey(ctx))
}), defineAction({
	name: "clean_stream_temp_file",
	examples: [{
		summary: "清理流式传输临时文件(仅清理 stream 上传/下载目录)",
		params: {},
		notes: "清理未使用的流式临时文件；不会清理正在传输的项目。"
	}],
	returnsSchema: {
		type: "object",
		properties: {
			message: { const: "success" },
			removed: { type: "integer" },
			freed_bytes: { type: "integer" },
			skipped_active: { type: "integer" }
		},
		required: [
			"message",
			"removed",
			"freed_bytes",
			"skipped_active"
		]
	},
	summary: "清理流式传输临时文件(仅清理 stream 上传/下载目录)",
	returns: "{ message, removed }",
	params: {},
	run: () => {
		const result = clearInactiveStreamStorage();
		for (const failure of result.failures) log$61.warn("failed to remove stream temp %s: %s", failure.item, failure.message);
		if (result.failures.length > 0) throw new StreamError(`failed to remove ${result.failures.length} stream temp item(s)`);
		return okResponse({
			message: "success",
			removed: result.deletedFiles,
			freed_bytes: result.freedBytes,
			skipped_active: result.skippedActiveItems
		});
	}
})];
export {};
