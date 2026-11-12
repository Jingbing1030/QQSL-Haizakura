// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/media-indexer.ts"
// original bundle lines 40372-40437  (64 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var MediaIndexer = class {
	mediaStore;
	constructor(mediaStore) {
		this.mediaStore = mediaStore;
	}
	async remember(mediaType, element, data, isGroup, sessionId) {
		const url = typeof data.url === "string" ? data.url : "";
		const file = typeof data.file === "string" ? data.file : "";
		if (mediaType === "image") {
			await this.mediaStore.rememberImage({
				file: file || element.fileId || "",
				url,
				fileSize: element.fileSize ?? 0,
				fileName: element.fileId ?? "",
				subType: element.subType ?? 0,
				summary: element.summary ?? "",
				imageUrl: element.imageUrl ?? "",
				isGroup,
				sessionId,
				md5Hex: element.md5Hex,
				sha1Hex: element.sha1Hex,
				width: element.width,
				height: element.height,
				picFormat: element.picFormat
			});
			return;
		}
		if (mediaType === "record") {
			await this.mediaStore.rememberRecord({
				file: file || element.fileName || element.fileId || "",
				fileId: element.fileId ?? "",
				url,
				fileSize: element.fileSize ?? 0,
				fileName: element.fileName ?? "",
				duration: element.duration ?? 0,
				fileHash: element.fileHash ?? "",
				mediaNode: element.mediaNode,
				isGroup,
				sessionId,
				md5Hex: element.md5Hex,
				sha1Hex: element.sha1Hex,
				voiceFormat: element.voiceFormat
			});
			return;
		}
		await this.mediaStore.rememberVideo({
			file: file || element.fileName || element.fileId || "",
			fileId: element.fileId ?? "",
			url,
			fileSize: element.fileSize ?? 0,
			fileName: element.fileName ?? "",
			duration: element.duration ?? 0,
			fileHash: element.fileHash ?? "",
			mediaNode: element.mediaNode,
			isGroup,
			sessionId,
			md5Hex: element.md5Hex,
			sha1Hex: element.sha1Hex,
			width: element.width,
			height: element.height,
			videoFormat: element.videoFormat
		});
	}
};
export {};
