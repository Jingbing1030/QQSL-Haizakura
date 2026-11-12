// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/message-media.ts"
// original bundle lines 22864-22963  (98 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var mediaSnapshot = Symbol("message media snapshot");
/** Snapshot queued writes, including metadata that is deliberately absent from JSON. */
function snapshotMessageEvent(event) {
	const snapshot = structuredClone(event);
	if (Array.isArray(event.message) && Array.isArray(snapshot.message)) for (const [index, segment] of event.message.entries()) {
		if (!segment || typeof segment !== "object" || Array.isArray(segment)) continue;
		const media = segment[mediaSnapshot];
		const copied = snapshot.message[index];
		if (media && copied && typeof copied === "object") Object.defineProperty(copied, mediaSnapshot, { value: structuredClone(media) });
	}
	return snapshot;
}
function isMessageMedia(element) {
	return element.type === "image" || element.type === "record" || element.type === "video";
}
/** Keep persistence-only metadata beside the converted segment, never on the
* public JSON wire. Capture after successful conversion so skipped elements
* cannot shift the association between a message and its media snapshots.
*/
function attachMessageMedia(segment, element) {
	if (!isMessageMedia(element)) return;
	const { type, fileId, fileName, fileSize, url, imageUrl, md5Hex, sha1Hex, subType, summary, width, height, picFormat, duration, voiceFormat, videoFormat, fileHash, mediaNode, flash } = element;
	const snapshot = JSON.parse(serializeMediaInfo({
		type,
		fileId,
		fileName,
		fileSize,
		url,
		imageUrl,
		md5Hex,
		sha1Hex,
		subType,
		summary,
		width,
		height,
		picFormat,
		duration,
		voiceFormat,
		videoFormat,
		fileHash,
		mediaNode,
		flash
	}));
	Object.defineProperty(segment, mediaSnapshot, { value: snapshot });
}
function serializeMessageMedia(event) {
	if (!Array.isArray(event.message)) return null;
	const snapshots = event.message.flatMap((segment) => {
		if (!segment || typeof segment !== "object" || Array.isArray(segment)) return [];
		const snapshot = segment[mediaSnapshot];
		return snapshot ? [snapshot] : [];
	});
	return snapshots.length > 0 ? JSON.stringify(snapshots) : null;
}
function parseMessageMedia(data) {
	const parsed = JSON.parse(data);
	if (!Array.isArray(parsed) || parsed.some((value) => !value || typeof value !== "object" || ![
		"image",
		"record",
		"video"
	].includes(value.type))) throw new Error("invalid persisted message media metadata");
	return parsed;
}
/** A repeated server representation may omit fields already learned from an
* upload or earlier receive. Preserve those fields only for the same resource;
* conflicting fingerprints or uncertain associations must not rewrite history.
*/
function mergeMessageMedia(previous, next) {
	if (!previous) return next;
	if (previous === next) return previous;
	if (!next) throw new Error("message update is missing previously stored media metadata");
	const oldMedia = parseMessageMedia(previous);
	const newMedia = parseMessageMedia(next);
	if (oldMedia.length !== newMedia.length) throw new Error("message media association changed");
	const merged = newMedia.map((media, index) => {
		const old = oldMedia[index];
		if (old.type !== media.type) throw new Error("message media association changed");
		let matched = false;
		for (const field of ["md5Hex", "sha1Hex"]) {
			if (!old[field] || !media[field]) continue;
			if (old[field].toLowerCase() !== media[field].toLowerCase()) throw new Error("message update has conflicting media fingerprints");
			matched = true;
		}
		matched ||= media.type !== "image" && !!old.fileId && old.fileId === media.fileId;
		if (!matched && JSON.stringify(old) !== JSON.stringify(media)) throw new Error("message update has an unverified media association");
		return mergeKnownMediaFields(old, media);
	});
	return JSON.stringify(merged);
}
function mergeKnownMediaFields(old, next) {
	const merged = { ...old };
	for (const [key, value] of Object.entries(next)) {
		if (value === void 0 || value === null || value === "" || value === 0) continue;
		const previous = merged[key];
		merged[key] = typeof value === "object" && !Array.isArray(value) && previous !== null && typeof previous === "object" && !Array.isArray(previous) ? mergeKnownMediaFields(previous, value) : value;
	}
	return merged;
}
export {};
