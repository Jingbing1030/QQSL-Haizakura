// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/media-url-resolver.ts"
// original bundle lines 39760-39794  (33 lines) of dist/index.mjs
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
var log$51 = createLogger("OneBot");
function resolveRemoteMediaUrl(bridge, type, node, isGroup, sessionId) {
	if (!node) throw new Error(`${type} media metadata is missing`);
	const api = bridge.apis.groupFile;
	if (type === "record") return isGroup ? api.getPttUrl(sessionId, node) : api.getPrivatePttUrl(node);
	return isGroup ? api.getVideoUrl(sessionId, node) : api.getPrivateVideoUrl(node);
}
var MediaUrlResolver = class {
	bridge;
	rkeyCache;
	constructor(bridge, rkeyCache) {
		this.bridge = bridge;
		this.rkeyCache = rkeyCache;
	}
	async resolve(element, isGroup, sessionId) {
		if (!element.url) try {
			await this.populateUrl(element, isGroup, sessionId);
		} catch (err) {
			log$51.warn("media URL resolution failed type=%s is_group=%s: %s", element.type, isGroup, err instanceof Error ? err.message : String(err));
		}
		return this.rkeyCache.resolveMediaUrl(this.bridge, element, isGroup);
	}
	async populateUrl(element, isGroup, sessionId) {
		if (element.type === "file" && element.fileId) {
			if (isGroup) element.url = await this.bridge.apis.groupFile.getUrl(sessionId, element.fileId);
			else if (element.fileHash) element.url = await this.bridge.apis.groupFile.getPrivateUrl(sessionId, element.fileId, element.fileHash);
			else element.url = "";
			return;
		}
		if ((element.type === "record" || element.type === "video") && element.mediaNode) element.url = await resolveRemoteMediaUrl(this.bridge, element.type, element.mediaNode, isGroup, sessionId);
	}
};
export {};
