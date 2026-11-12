// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/oidb-services/group-file/ntv2-download.ts"
// original bundle lines 256054-256095  (40 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function parseNtv2DownloadUrl(body) {
	ensureRetCodeZero("ntv2 download", body.respHead?.retCode, body.respHead?.message, void 0);
	const domain = typeof body.download?.info?.domain === "string" ? body.download.info.domain : "";
	const path = typeof body.download?.info?.urlPath === "string" ? body.download.info.urlPath : "";
	const rKeyParam = typeof body.download?.rKeyParam === "string" ? body.download.rKeyParam : "";
	if (!domain || !path) throw new Error("ntv2 download response invalid");
	return `https://${domain}${path}${rKeyParam}`;
}
/** Normalize a MediaIndexNode-shaped object into the wire-fields the
*  NTV2RichMedia `download.node` slot expects: `info{...}` /
*  `fileUuid` / `storeId` / `uploadTime` / `ttl` / `subType`. */
function normalizeMediaNode(node) {
	const fileUuid = typeof node.fileUuid === "string" ? node.fileUuid : "";
	if (!fileUuid) throw new Error("media node fileUuid is required");
	const info = node.info ?? {};
	const type = info.type ?? {};
	return {
		info: {
			fileSize: toInt$1(info.fileSize),
			fileHash: typeof info.fileHash === "string" ? info.fileHash : "",
			fileSha1: typeof info.fileSha1 === "string" ? info.fileSha1 : "",
			fileName: typeof info.fileName === "string" ? info.fileName : "",
			type: {
				type: toInt$1(type.type),
				picFormat: toInt$1(type.picFormat),
				videoFormat: toInt$1(type.videoFormat),
				voiceFormat: toInt$1(type.voiceFormat)
			},
			width: toInt$1(info.width),
			height: toInt$1(info.height),
			time: toInt$1(info.time),
			original: toInt$1(info.original)
		},
		fileUuid,
		storeId: toInt$1(node.storeId),
		uploadTime: toInt$1(node.uploadTime),
		ttl: toInt$1(node.ttl),
		subType: toInt$1(node.subType)
	};
}
export {};
