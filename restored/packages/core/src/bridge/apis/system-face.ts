/** QQ's account-independent system-face directory. The shared store owns
* persistence and refresh coalescing; this API binds it to one live sender. */
var SystemFaceApi = class {
	ctx;
	constructor(ctx) {
		this.ctx = ctx;
	}
	fetchCatalog(refresh = false) {
		return sysFaceStore.getCatalog(this.ctx, refresh);
	}
	async fetchFace(faceId, refresh = false) {
		if (refresh) {
			await sysFaceStore.refresh(this.ctx);
			return sysFaceStore.lookup(faceId);
		}
		return sysFaceStore.resolve(this.ctx, faceId);
	}
	async search(query) {
		await sysFaceStore.ensureReady(this.ctx);
		return sysFaceStore.search(query);
	}
	async isSuper(faceId, refresh = false) {
		const face = await this.fetchFace(faceId, refresh);
		return face !== null && isSuperFaceEntry(face);
	}
};
