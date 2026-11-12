// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/highway/stage.ts"
// original bundle lines 37076-37278  (201 lines) of dist/index.mjs
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
init_utils();
var log$54 = createLogger("Highway.Stage");
var STAGE_DIR = path$1.join(os.tmpdir(), "media-stage");
var STAGE_TTL_MS = 1800 * 1e3;
var REAPER_INTERVAL_MS = 300 * 1e3;
/** Absolute paths currently in use (being written, or a live staged file). The
*  reaper never touches these — an in-flight upload's file is read-only so its
*  mtime won't advance, and an age-only sweep would otherwise delete it. */
var active = /* @__PURE__ */ new Set();
var reaperTimer = null;
function ensureReaper() {
	if (reaperTimer) return;
	reaperTimer = setInterval(() => {
		sweepStagedUploads();
	}, REAPER_INTERVAL_MS);
	reaperTimer.unref();
	sweepStagedUploads();
}
/** Reap staged temps older than the TTL, skipping any path currently in use.
*  Best-effort; never throws. Exposed for an explicit startup/interval hook. */
async function sweepStagedUploads(now = Date.now()) {
	let removed = 0;
	let names;
	try {
		names = await promises$1.readdir(STAGE_DIR);
	} catch {
		return 0;
	}
	await Promise.all(names.map(async (n) => {
		const p = path$1.join(STAGE_DIR, n);
		if (active.has(p)) return;
		try {
			if (now - (await promises$1.stat(p)).mtimeMs > STAGE_TTL_MS) {
				await promises$1.rm(p, { force: true });
				removed += 1;
			}
		} catch {}
	}));
	if (removed > 0) log$54.debug("reaped %d stale staged upload temp(s)", removed);
	return removed;
}
function tempPaths(ext) {
	const id = randomUUID$1();
	const base = path$1.join(STAGE_DIR, `stage-${id}${ext}`);
	return {
		partPath: `${base}.part`,
		finalPath: base
	};
}
/** fsync the file's directory entry so the rename survives a crash (POSIX). */
async function fsyncDir() {
	try {
		const dh = await promises$1.open(STAGE_DIR, "r");
		try {
			await dh.sync();
		} finally {
			await dh.close();
		}
	} catch {}
}
async function finalizeRename(partPath, finalPath) {
	await promises$1.rename(partPath, finalPath);
	await fsyncDir();
}
function registerStaged(filePath, fileSize, fileName) {
	active.add(filePath);
	let done = false;
	return {
		filePath,
		fileSize,
		fileName,
		async cleanup() {
			if (done) return;
			done = true;
			active.delete(filePath);
			await promises$1.unlink(filePath).catch(() => {});
		}
	};
}
/** Disk sink for `downloadHttp`: streams chunks to a FileHandle, fsyncs on
*  success, and closes-before-unlink on failure. Backpressure comes from
*  awaiting each `fh.write`. */
function fileSink(partPath) {
	let opened = null;
	const open = () => opened ??= promises$1.open(partPath, "w");
	return {
		async write(chunk) {
			await (await open()).write(chunk);
		},
		async done() {
			const fh = await open();
			await fh.sync();
			await fh.close();
		},
		async discard() {
			if (opened) try {
				await (await opened).close();
			} catch {}
			await promises$1.unlink(partPath).catch(() => {});
		}
	};
}
/** base64 decoded byte length without allocating the buffer. */
function base64DecodedLength(b64) {
	const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
	const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
	return Math.floor(clean.length * 3 / 4) - pad;
}
/**
* Stage `source` onto a local disk path. `maxBytes` bounds the size (rejected
* before any large allocation for base64, before reading for local files, and
* incrementally for http). The returned `cleanup()` MUST be called when the
* upload is done (or fails) to remove the staged temp.
*/
async function stageSourceToDisk(source, maxBytes) {
	if (!source) throw new Error("stage source is empty");
	ensureReaper();
	await promises$1.mkdir(STAGE_DIR, { recursive: true });
	const b64 = inlineBase64Payload(source);
	if (b64 !== null) {
		const decodedLen = base64DecodedLength(b64);
		if (decodedLen > maxBytes) throw new Error(`stage source too large: ${decodedLen} > ${maxBytes}`);
		const bytes = Buffer.from(b64, "base64");
		if (bytes.length > maxBytes) throw new Error(`stage source too large: ${bytes.length} > ${maxBytes}`);
		const { partPath, finalPath } = tempPaths(".bin");
		active.add(partPath);
		try {
			const fh = await promises$1.open(partPath, "w");
			try {
				await fh.write(bytes);
				await fh.sync();
			} finally {
				await fh.close();
			}
			await finalizeRename(partPath, finalPath);
		} catch (e) {
			await promises$1.unlink(partPath).catch(() => {});
			throw e;
		} finally {
			active.delete(partPath);
		}
		log$54.debug("staged inline base64 source (%d bytes)", bytes.length);
		return registerStaged(finalPath, bytes.length, "");
	}
	if (/^https?:\/\//i.test(source)) {
		const { partPath, finalPath } = tempPaths(".bin");
		active.add(partPath);
		let fileName = "";
		try {
			fileName = (await downloadHttp(source, "stage", maxBytes, () => fileSink(partPath))).fileName;
			await finalizeRename(partPath, finalPath);
		} catch (e) {
			await promises$1.unlink(partPath).catch(() => {});
			throw e;
		} finally {
			active.delete(partPath);
		}
		const { size } = await promises$1.stat(finalPath);
		log$54.debug("staged http source %s (%d bytes)", fileName || "(unnamed)", size);
		return registerStaged(finalPath, size, fileName);
	}
	const local = resolveLocalFilePath(source);
	if (!local) throw new Error("stage source is not a local file");
	const real = await promises$1.realpath(local);
	const st = await promises$1.stat(real);
	if (!st.isFile()) throw new Error(`stage source is not a regular file: ${local}`);
	if (st.size > maxBytes) throw new Error(`stage source too large: ${st.size} > ${maxBytes}`);
	const fileName = path$1.basename(local);
	const { partPath, finalPath } = tempPaths(path$1.extname(local) || ".bin");
	active.add(finalPath);
	let staged;
	try {
		try {
			await promises$1.link(real, finalPath);
			staged = "link";
		} catch {
			active.add(partPath);
			try {
				await promises$1.copyFile(real, partPath);
				const fh = await promises$1.open(partPath, "r+");
				try {
					await fh.sync();
				} finally {
					await fh.close();
				}
				await finalizeRename(partPath, finalPath);
				staged = "copy";
			} finally {
				active.delete(partPath);
			}
		}
	} catch (e) {
		active.delete(finalPath);
		await promises$1.unlink(finalPath).catch(() => {});
		await promises$1.unlink(partPath).catch(() => {});
		throw e;
	}
	log$54.debug("staged local source %s via %s (%d bytes)", fileName, staged, st.size);
	return registerStaged(finalPath, st.size, fileName);
}
export {};
