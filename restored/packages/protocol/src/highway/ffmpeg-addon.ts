// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/highway/ffmpeg-addon.ts"
// original bundle lines 23416-23588  (171 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var ffmpeg_addon_exports = /* @__PURE__ */ __exportAll({
	AUDIO_OUT_FORMATS: () => AUDIO_OUT_FORMATS,
	convertAudioBytes: () => convertAudioBytes,
	defaultPttTempDir: () => defaultPttTempDir,
	encodeSilk: () => encodeSilk,
	getFFmpegAddon: () => getFFmpegAddon,
	isAudioOutFormat: () => isAudioOutFormat,
	isSilkFile: () => isSilkFile
});
function addonFileName() {
	return `ffmpegAddon.${process.platform}.${process.arch}.node`;
}
/**
* Load the ffmpegAddon once and return a cached instance.
* Throws on first-use failure; subsequent calls replay the same error message
* so callers don't silently fall back.
*/
function getFFmpegAddon() {
	if (cachedAddon) return cachedAddon;
	if (cachedLoadError) throw new Error(cachedLoadError);
	const addonPath = resolveRuntimeNativePath(path$1.join("ffmpeg", addonFileName()));
	if (!addonPath) {
		cachedLoadError = `ffmpegAddon not found for ${process.platform}-${process.arch} (looked for ${addonFileName()})`;
		throw new Error(cachedLoadError);
	}
	try {
		const mod = { exports: {} };
		process.dlopen(mod, addonPath);
		cachedAddon = mod.exports;
		return cachedAddon;
	} catch (error) {
		cachedLoadError = `failed to load ffmpegAddon (${addonPath}): ${errorMessage(error)}`;
		throw new Error(cachedLoadError);
	}
}
/**
* Check whether `filePath` is already an NT SILK container. The addon can
* read any input directly so the only reason we peek at the header is to
* skip the conversion (and the temp file) when the caller already fed us
* a ready-to-upload silk file.
*/
function isSilkFile(filePath) {
	const fd = fs$1.openSync(filePath, "r");
	try {
		const buf = Buffer.alloc(10);
		fs$1.readSync(fd, buf, 0, 10, 0);
		return buf.toString().includes("#!SILK");
	} finally {
		fs$1.closeSync(fd);
	}
}
/**
* Convert `inputFile` to NT SILK when necessary and return the output path
* + duration. The caller is responsible for unlinking the returned path
* when `converted === true`.
*/
async function encodeSilk(inputFile, tempDir) {
	const addon = getFFmpegAddon();
	const duration = Math.max(1, Math.round(await addon.getDuration(inputFile)));
	if (isSilkFile(inputFile)) return {
		path: inputFile,
		duration,
		converted: false
	};
	fs$1.mkdirSync(tempDir, { recursive: true });
	const outPath = path$1.join(tempDir, crypto$2.randomUUID());
	try {
		await addon.convertToNTSilkTct(inputFile, outPath);
		if (!fs$1.existsSync(outPath)) throw new Error("convertToNTSilkTct produced no output file");
	} catch (error) {
		try {
			await fs$1.promises.rm(outPath, { force: true });
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], `SILK conversion failed: ${errorMessage(error)}; temporary file cleanup failed: ${errorMessage(cleanupError)}`);
		}
		throw error;
	}
	return {
		path: outPath,
		duration,
		converted: true
	};
}
/** Default location for temporary silk files. */
function defaultPttTempDir() {
	return path$1.join(os.tmpdir(), "audio-upload");
}
function isAudioOutFormat(s) {
	return AUDIO_OUT_FORMATS.includes(s);
}
/**
* QQ AI voices use the same SILK payload as ordinary QQ voices but may carry
* a 0x03 container marker. The bundled decoder accepts the ordinary 0x02
* marker, so normalize this exact, observed container variant at the shared
* transcode boundary. Copy before rewriting to preserve caller-owned bytes.
*/
function normalizeQqAiSilkContainer(bytes) {
	if (bytes.length < SILK_V3_SIGNATURE.length + 1 || bytes[0] !== 3) return bytes;
	for (let index = 0; index < SILK_V3_SIGNATURE.length; index += 1) if (bytes[index + 1] !== SILK_V3_SIGNATURE[index]) return bytes;
	const normalized = Uint8Array.from(bytes);
	normalized[0] = 2;
	log$56.debug("normalized QQ AI SILK container for audio transcoding");
	return normalized;
}
/**
* Transcode raw audio bytes (a QQ voice SILK/AMR) to `format`, returning the
* result as base64 + byte size. Writes the input + output to temp files (the
* native addon is file-based), always cleaning them up. `deps` injects a fake
* addon / tmp dir for tests. Throws on an unsupported format or a failed
* conversion (e.g. the binary lacks SILK decode).
*/
async function convertAudioBytes(bytes, format, deps = {}) {
	if (!isAudioOutFormat(format)) throw new Error(`unsupported out_format: ${format} (expected one of ${AUDIO_OUT_FORMATS.join(", ")})`);
	const addon = deps.addon ?? getFFmpegAddon();
	const maxOut = deps.maxOutputBytes ?? DEFAULT_MAX_AUDIO_OUTPUT;
	const dir = deps.tmpDir ?? path$1.join(os.tmpdir(), "audio-transcode");
	fs$1.mkdirSync(dir, { recursive: true });
	const id = crypto$2.randomBytes(8).toString("hex");
	const inPath = path$1.join(dir, `${id}.in`);
	const outPath = path$1.join(dir, `${id}.${format}`);
	let outcome;
	try {
		await fs$1.promises.writeFile(inPath, normalizeQqAiSilkContainer(bytes));
		await addon.decodeAudioToFmt(inPath, outPath, format);
		if (!fs$1.existsSync(outPath)) throw new Error("audio conversion failed: no output file");
		const stat = await fs$1.promises.stat(outPath);
		if (stat.size > maxOut) throw new Error(`converted audio too large: ${stat.size} > ${maxOut}`);
		const out = await fs$1.promises.readFile(outPath);
		outcome = {
			status: "fulfilled",
			value: {
				base64: out.toString("base64"),
				size: out.length
			}
		};
	} catch (reason) {
		outcome = {
			status: "rejected",
			reason
		};
	}
	const cleanupErrors = (await Promise.allSettled([fs$1.promises.rm(inPath, { force: true }), fs$1.promises.rm(outPath, { force: true })])).filter((result) => result.status === "rejected").map((result) => result.reason);
	if (cleanupErrors.length > 0) {
		const cleanupMessage = cleanupErrors.map(errorMessage).join("; ");
		if (outcome.status === "rejected") throw new AggregateError([outcome.reason, ...cleanupErrors], `audio conversion failed: ${errorMessage(outcome.reason)}; temporary audio file cleanup failed: ${cleanupMessage}`);
		throw new AggregateError(cleanupErrors, `temporary audio file cleanup failed: ${cleanupMessage}`);
	}
	if (outcome.status === "rejected") throw outcome.reason;
	return outcome.value;
}
var log$56, cachedAddon, cachedLoadError, AUDIO_OUT_FORMATS, DEFAULT_MAX_AUDIO_OUTPUT, SILK_V3_SIGNATURE;
var init_ffmpeg_addon = __esmMin((() => {
	init_errors();
	init_native_path();
	init_logger();
	log$56 = createLogger("Highway.Audio");
	cachedAddon = null;
	cachedLoadError = null;
	AUDIO_OUT_FORMATS = [
		"mp3",
		"amr",
		"wma",
		"m4a",
		"spx",
		"ogg",
		"wav",
		"flac"
	];
	DEFAULT_MAX_AUDIO_OUTPUT = 256 * 1024 * 1024;
	SILK_V3_SIGNATURE = Buffer.from("#!SILK_V3", "ascii");
}));
export {};
