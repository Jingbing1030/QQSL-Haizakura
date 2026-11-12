// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/highway/video-upload.ts"
// original bundle lines 37472-37737  (264 lines) of dist/index.mjs
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
var moduleLog$9 = createLogger("Highway.Video");
function loggerFor$2(bridge) {
	const raw = bridge.identity?.uin;
	const uin = typeof raw === "string" ? Number.parseInt(raw, 10) : 0;
	return Number.isFinite(uin) && uin > 0 ? moduleLog$9.child({ uin }) : moduleLog$9;
}
var PRIVATE_VIDEO_CMD_ID = 1001;
var PRIVATE_VIDEO_THUMB_CMD_ID = 1002;
var GROUP_VIDEO_CMD_ID = 1005;
var GROUP_VIDEO_THUMB_CMD_ID = 1006;
var MAX_VIDEO_SIZE = 1536 * 1024 * 1024;
function getVideoSourceSize(element) {
	if (element.fileSize && element.fileSize > 0) return element.fileSize;
	const source = element.url || element.fileId || "";
	if (!source) return null;
	const local = resolveLocalFilePath(source);
	if (local && fs$1.existsSync(local)) return fs$1.statSync(local).size;
	return null;
}
var FALLBACK_THUMB = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAtAAAAUACAIAAADhrPJqAAAACXBIWXMAAAABAAAAAQBPJcTWAAAQAElEQVR4nO3WQQkAMAzAwOqYf6FVEQblTkGemQcAEJvfAQDAfYYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGgi6AggAABVxJREFUAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACC3fMQgSD2JVRsAAAAASUVORK5CYII=", "base64");
var FALLBACK_THUMB_FORMAT = detectImageFormat(new Uint8Array(FALLBACK_THUMB));
var FAST_UPLOAD_FALLBACK_WIDTH = FALLBACK_THUMB_FORMAT.width || 720;
var FAST_UPLOAD_FALLBACK_HEIGHT = FALLBACK_THUMB_FORMAT.height || 1280;
function makeFallbackThumb() {
	const bytes = new Uint8Array(FALLBACK_THUMB);
	const hashes = computeHashes(bytes);
	return {
		bytes,
		md5: hashes.md5,
		sha1: hashes.sha1,
		md5Hex: hashes.md5Hex,
		sha1Hex: hashes.sha1Hex,
		width: FAST_UPLOAD_FALLBACK_WIDTH,
		height: FAST_UPLOAD_FALLBACK_HEIGHT
	};
}
function videoPayloadFromFingerprint(element) {
	return {
		bytes: /* @__PURE__ */ new Uint8Array(0),
		md5: hexToBytes(element.md5Hex ?? ""),
		sha1: hexToBytes(element.sha1Hex ?? ""),
		sha1Blocks: [],
		md5Hex: element.md5Hex ?? "",
		sha1Hex: element.sha1Hex ?? "",
		fileName: element.fileName || `${element.md5Hex ?? "video"}.mp4`,
		fileSize: element.fileSize ?? 0,
		width: element.width || FAST_UPLOAD_FALLBACK_WIDTH,
		height: element.height || FAST_UPLOAD_FALLBACK_HEIGHT,
		duration: element.duration || 1,
		videoFormat: element.videoFormat ?? 0,
		thumb: makeFallbackThumb(),
		fastOnly: true,
		cleanup: async () => {}
	};
}
async function loadThumb(element, videoPath) {
	let width = element.width ?? 0;
	let height = element.height ?? 0;
	let duration = element.duration ?? 0;
	let thumbBytes = null;
	if (element.thumbUrl) try {
		thumbBytes = (await loadBinarySource(element.thumbUrl, "video thumbnail")).bytes;
	} catch (err) {
		moduleLog$9.warn("custom video thumbnail load failed: %s", err instanceof Error ? err.message : String(err));
	}
	if (!thumbBytes) try {
		const info = await getFFmpegAddon().getVideoInfo(videoPath);
		width = width || info.width || 0;
		height = height || info.height || 0;
		duration = duration || Math.max(1, Math.round(info.duration || 0));
		if (info.image && info.image.length > 0) thumbBytes = new Uint8Array(info.image);
	} catch (err) {
		moduleLog$9.warn("video thumbnail generation failed: %s", err instanceof Error ? err.message : String(err));
	}
	if (!thumbBytes) thumbBytes = new Uint8Array(FALLBACK_THUMB);
	const fmt = detectImageFormat(thumbBytes);
	width = width || fmt.width || 1;
	height = height || fmt.height || 1;
	duration = duration || 1;
	const thumbWidth = fmt.width || width;
	const thumbHeight = fmt.height || height;
	const hashes = computeHashes(thumbBytes);
	return {
		width,
		height,
		duration,
		thumb: {
			bytes: thumbBytes,
			md5: hashes.md5,
			sha1: hashes.sha1,
			md5Hex: hashes.md5Hex,
			sha1Hex: hashes.sha1Hex,
			width: thumbWidth,
			height: thumbHeight
		}
	};
}
async function loadVideo(element) {
	if (element.noByteFallback) {
		if (!element.md5Hex || !element.sha1Hex) throw new Error("video fast-upload requires md5Hex + sha1Hex");
		return videoPayloadFromFingerprint(element);
	}
	const source = element.url || element.fileId || "";
	if (!source) throw new Error("video source is empty");
	const staged = await stageSourceToDisk(source, MAX_VIDEO_SIZE);
	try {
		if (staged.fileSize === 0) throw new Error("video file is empty");
		const g = await promises$1.stat(staged.filePath);
		const hashes = await hashFileStreaming(staged.filePath);
		const { thumb, width, height, duration } = await loadThumb(element, staged.filePath);
		return {
			bytes: /* @__PURE__ */ new Uint8Array(0),
			fileSource: {
				filePath: staged.filePath,
				fileSize: staged.fileSize
			},
			md5: hashes.md5,
			sha1: hashes.sha1,
			sha1Blocks: hashes.sha1Blocks,
			md5Hex: hashes.md5Hex,
			sha1Hex: hashes.sha1Hex,
			fileName: element.fileName || staged.fileName || `${hashes.md5Hex}.mp4`,
			fileSize: staged.fileSize,
			width,
			height,
			duration,
			videoFormat: 0,
			thumb,
			fastOnly: false,
			guard: {
				size: g.size,
				mtimeMs: g.mtimeMs
			},
			cleanup: staged.cleanup
		};
	} catch (err) {
		await staged.cleanup();
		throw err;
	}
}
/**
* Upload a video and return the encoded MsgInfo bytes that go inside a
* `commonElem { serviceType: 48, businessType: 21 }`.
*
* Two highway PUTs run when the server doesn't fast-path: the main video
* (with per-1MB-block sha1) and a thumb (read off `upload.subFileInfos[0]`).
*/
async function uploadVideoMsgInfo(bridge, isGroup, targetIdOrUid, element) {
	const log = loggerFor$2(bridge);
	const concurrency = getVideoUploadConcurrency();
	const preparedAt = Date.now();
	const video = await loadVideo(element);
	log.debug("video preparation done: bytes=%d elapsedMs=%d concurrency=%d", video.fileSize, Date.now() - preparedAt, concurrency);
	log.debug("uploading %d bytes md5=%s... → %s %s", video.fileSize, video.md5Hex.slice(0, 8), isGroup ? "group" : "c2c", String(targetIdOrUid));
	try {
		const uploads = [{
			source: "top",
			concurrency,
			cmdId: isGroup ? GROUP_VIDEO_CMD_ID : PRIVATE_VIDEO_CMD_ID,
			bytes: video.bytes,
			fileSource: video.fileSource,
			md5: video.md5,
			sha1: video.sha1Blocks,
			subFileIndex: 0,
			fastOnlyError: "video fast-upload not available (server requires bytes)"
		}, {
			source: 0,
			cmdId: isGroup ? GROUP_VIDEO_THUMB_CMD_ID : PRIVATE_VIDEO_THUMB_CMD_ID,
			bytes: video.thumb.bytes,
			md5: video.thumb.md5,
			sha1: video.thumb.sha1,
			subFileIndex: 1
		}];
		if (video.guard && video.fileSource) {
			const now = await promises$1.stat(video.fileSource.filePath);
			if (now.size !== video.guard.size || now.mtimeMs !== video.guard.mtimeMs) throw new Error("video source changed during send (mutated between hashing and upload)");
		}
		const upload = await runNtv2Upload({
			bridge,
			isGroup,
			targetIdOrUid,
			oidbCmd: isGroup ? 4586 : 4585,
			serviceCmd: isGroup ? "OidbSvcTrpcTcp.0x11ea_100" : "OidbSvcTrpcTcp.0x11e9_100",
			requestId: 3,
			businessType: 2,
			uploadInfo: [{
				fileInfo: {
					fileSize: video.fileSize,
					fileHash: video.md5Hex,
					fileSha1: video.sha1Hex,
					fileName: "nya.mp4",
					type: {
						type: 2,
						picFormat: 0,
						videoFormat: 0,
						voiceFormat: 0
					},
					height: isGroup ? video.height : 0,
					width: isGroup ? video.width : 0,
					time: video.duration,
					original: 0
				},
				subFileType: 0
			}, {
				fileInfo: {
					fileSize: video.thumb.bytes.length,
					fileHash: video.thumb.md5Hex,
					fileSha1: video.thumb.sha1Hex,
					fileName: "nya.jpg",
					type: {
						type: 1,
						picFormat: 0,
						videoFormat: 0,
						voiceFormat: 0
					},
					height: video.thumb.height,
					width: video.thumb.width,
					time: 0,
					original: 0
				},
				subFileType: 100
			}],
			compatQmsgSceneType: 2,
			extBizInfo: {
				pic: {
					bizType: 0,
					textSummary: "Nya~"
				},
				video: { bytesPbReserve: new Uint8Array([
					128,
					1,
					0
				]) },
				ptt: {
					bytesPbReserve: /* @__PURE__ */ new Uint8Array(0),
					bytesReserve: /* @__PURE__ */ new Uint8Array(0),
					bytesGeneralFlags: /* @__PURE__ */ new Uint8Array(0)
				}
			},
			uploads,
			label: "video"
		});
		log.debug("video upload completed: md5=%s scene=%s", video.md5Hex, isGroup ? "group" : "c2c");
		const encoded = finalizeMediaMsgInfo(upload);
		const mediaNode = upload.msgInfo?.msgInfoBody?.[0]?.index;
		Object.assign(element, {
			md5Hex: video.md5Hex,
			sha1Hex: video.sha1Hex,
			fileSize: video.fileSize,
			fileName: "nya.mp4",
			duration: video.duration,
			width: video.width,
			height: video.height,
			videoFormat: 0,
			fileId: mediaNode?.fileUuid,
			mediaNode
		});
		return encoded;
	} finally {
		await video.cleanup();
	}
}
export {};
