// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/sys-face-store.ts"
// original bundle lines 109443-109712  (268 lines) of dist/index.mjs
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
var log$43 = createLogger("SysFace");
/** Use animation metadata when available; any numeric id has a small-face encoding. */
function faceWireFor(entry, faceId) {
	if (entry && isSuperFaceEntry(entry)) {
		if (entry.aniStickerPackId == null || entry.aniStickerId == null || entry.aniStickerType == null) throw new Error(`QQ system face id ${faceId} has incomplete super-face metadata`);
		return {
			kind: "super",
			packId: String(entry.aniStickerPackId),
			stickerId: String(entry.aniStickerId),
			stickerType: entry.aniStickerType
		};
	}
	return faceId < 260 ? { kind: "classic" } : { kind: "small" };
}
var SysFaceStore = class {
	catalog = null;
	storage;
	fetchCatalog;
	now;
	fetchFace;
	cacheLoad = null;
	refreshInflight = null;
	refreshedInProcess = false;
	prewarmTask = null;
	constructor(options = {}) {
		this.storage = options.storage ?? null;
		this.fetchCatalog = options.fetchCatalog ?? ((sender) => FetchSysFaces.invoke(sender));
		this.now = options.now ?? Date.now;
		this.fetchFace = options.fetchFace ?? ((sender, faceId) => FetchSysFace.invoke(sender, { faceId }));
	}
	/** Configure persistence before the shared store has been used. */
	configureStorage(storage) {
		if (this.cacheLoad || this.catalog || this.refreshInflight) throw new Error("system face catalog storage must be configured before first use");
		this.storage = storage;
	}
	/** Index a trusted catalog. Kept public for protocol consumers that already
	* obtained a full catalog and want to reuse the same query/send semantics. */
	load(packs) {
		this.catalog = indexCatalog(validateCatalog(packs));
	}
	lookup(faceId) {
		const lookup = this.catalog?.lookups.get(faceId);
		return this.catalog?.byId.get(String(faceId)) ?? (lookup && "entry" in lookup ? lookup.entry : null);
	}
	/** Case-insensitive query over id, description, aliases, and pack name. */
	search(query) {
		const needle = query.trim().toLocaleLowerCase();
		if (!needle || !this.catalog) return [];
		const matches = [];
		const matchedIds = /* @__PURE__ */ new Set();
		for (const pack of this.catalog.packs) for (const face of pack.emojis) {
			if (matchedIds.has(face.qSid)) continue;
			if ([
				face.qSid,
				face.qDes,
				face.emCode,
				pack.packName,
				...face.emojiNameAlias
			].some((value) => value.toLocaleLowerCase().includes(needle))) {
				const canonical = this.catalog.byId.get(face.qSid);
				if (!canonical) throw new Error(`system face index is missing catalog id ${face.qSid}`);
				matches.push(canonical);
				matchedIds.add(face.qSid);
			}
		}
		return matches;
	}
	/** Synchronous classification, including IDs no longer listed in a panel. */
	classify(faceId) {
		return faceWireFor(this.lookup(faceId), faceId);
	}
	/** Load durable state, fetching only when no usable catalog exists. */
	async ensureReady(sender) {
		await (this.refreshInflight ?? this.loadCache());
		if (this.refreshInflight || !this.catalog) await this.refresh(sender);
	}
	/** Restore once, then refresh from the first logged-in account. */
	prewarm(sender) {
		return this.prewarmTask ??= (async () => {
			try {
				await this.loadCache();
			} catch {}
			await this.refresh(sender);
		})().catch((error) => {
			this.prewarmTask = null;
			throw error;
		});
	}
	/** Fetch the current authoritative catalog. Concurrent callers share one
	* request and one atomic persistence operation. */
	refresh(sender) {
		if (this.refreshInflight) return this.refreshInflight;
		const startedAt = this.now();
		this.refreshInflight = this.fetchCatalog(sender).then(async (packs) => {
			const validated = validateCatalog(packs);
			const snapshot = {
				schemaVersion: 1,
				fetchedAt: this.now(),
				packs: validated
			};
			const catalog = indexCatalog(validated);
			this.catalog = catalog;
			this.refreshedInProcess = true;
			if (this.storage) await this.storage.save(snapshot);
			log$43.info("system face catalog refreshed: entries=%d uniqueFaces=%d overlaps=%d packs=%d elapsedMs=%d", catalog.entryCount, catalog.byId.size, catalog.overlapCount, validated.length, this.now() - startedAt);
			return validated;
		}).catch((error) => {
			log$43.error("system face catalog refresh failed: elapsedMs=%d error=%s", this.now() - startedAt, errorMessage(error));
			throw error;
		}).finally(() => {
			this.refreshInflight = null;
		});
		return this.refreshInflight;
	}
	/** Panel membership does not determine whether a face can be animated. */
	async resolve(sender, faceId) {
		await this.ensureReady(sender);
		let cached = this.lookup(faceId);
		if (cached) return cached;
		if (!this.refreshedInProcess) {
			await this.refresh(sender);
			cached = this.lookup(faceId);
			if (cached) return cached;
		}
		const catalog = this.catalog;
		if (!catalog) throw new Error("system face catalog is unavailable after readiness completed");
		const lookup = catalog.lookups.get(faceId);
		if (lookup && "entry" in lookup) return lookup.entry;
		const request = lookup?.promise ?? this.fetchSingleFace(sender, faceId).then((entry) => {
			catalog.lookups.set(faceId, { entry });
			return entry;
		}).catch((error) => {
			catalog.lookups.delete(faceId);
			throw error;
		});
		catalog.lookups.set(faceId, { promise: request });
		try {
			const entry = await request;
			if (this.catalog === catalog) return entry;
		} catch (error) {
			if (this.catalog === catalog) throw error;
		}
		return this.resolve(sender, faceId);
	}
	async fetchSingleFace(sender, faceId) {
		try {
			const entry = await this.fetchFace(sender, faceId);
			if (entry) {
				if (entry.qSid !== String(faceId)) throw new Error(`system face lookup id mismatch: requested=${faceId} received=${entry.qSid}`);
				validateCatalog([{
					packName: "",
					emojis: [entry]
				}]);
				faceWireFor(entry, faceId);
			}
			log$43.debug("system face lookup completed: id=%d found=%s animated=%s", faceId, entry !== null, entry !== null && isSuperFaceEntry(entry));
			return entry;
		} catch (error) {
			log$43.error("system face lookup failed: id=%d error=%s", faceId, errorMessage(error));
			throw error;
		}
	}
	async resolveWire(sender, faceId) {
		const entry = await this.resolve(sender, faceId);
		if (!entry) log$43.debug("system face id %d has no metadata after lookup; sending its small representation", faceId);
		return faceWireFor(entry, faceId);
	}
	async getCatalog(sender, refresh = false) {
		if (refresh) await this.refresh(sender);
		else await this.ensureReady(sender);
		if (!this.catalog) throw new Error("system face catalog is unavailable after readiness completed");
		return this.catalog.packs;
	}
	loadCache() {
		if (this.catalog) return Promise.resolve();
		return this.cacheLoad ??= this.restoreCache();
	}
	async restoreCache() {
		if (!this.storage) return;
		const startedAt = this.now();
		try {
			const snapshot = await this.storage.load();
			if (this.catalog || !snapshot) return;
			validateSnapshot(snapshot);
			const catalog = indexCatalog(snapshot.packs);
			this.catalog = catalog;
			log$43.info("system face catalog restored: entries=%d uniqueFaces=%d overlaps=%d packs=%d fetchedAt=%d elapsedMs=%d", catalog.entryCount, catalog.byId.size, catalog.overlapCount, snapshot.packs.length, snapshot.fetchedAt, this.now() - startedAt);
		} catch (error) {
			if (this.catalog) return;
			log$43.error("system face catalog restore failed: elapsedMs=%d error=%s", this.now() - startedAt, errorMessage(error));
			throw error;
		}
	}
};
function validateSnapshot(snapshot) {
	if (typeof snapshot !== "object" || snapshot === null) throw new Error("invalid system face catalog snapshot root");
	if (snapshot.schemaVersion !== 1) throw new Error(`unsupported system face catalog schema version: ${String(snapshot.schemaVersion)}`);
	if (!Number.isSafeInteger(snapshot.fetchedAt) || snapshot.fetchedAt < 0) throw new Error(`invalid system face catalog fetchedAt: ${String(snapshot.fetchedAt)}`);
	validateCatalog(snapshot.packs);
}
function validateCatalog(packs) {
	if (!Array.isArray(packs) || packs.length === 0) throw new Error("system face catalog is empty");
	const seen = /* @__PURE__ */ new Map();
	let faceCount = 0;
	for (const [packIndex, pack] of packs.entries()) {
		if (!pack || typeof pack.packName !== "string" || !Array.isArray(pack.emojis)) throw new Error(`invalid system face pack at index ${packIndex}`);
		for (const [faceIndex, face] of pack.emojis.entries()) {
			if (!face || typeof face.qSid !== "string" || face.qSid.length === 0) throw new Error(`invalid system face id at pack ${packIndex}, face ${faceIndex}: value=${JSON.stringify(face?.qSid)}`);
			if (!Array.isArray(face.emojiNameAlias) || face.emojiNameAlias.some((alias) => typeof alias !== "string")) throw new Error(`invalid aliases for system face id ${face.qSid}`);
			if (typeof face.qDes !== "string" || typeof face.emCode !== "string") throw new Error(`invalid text metadata for system face id ${face.qSid}`);
			for (const [name, value] of [
				["qCid", face.qCid],
				["aniStickerType", face.aniStickerType],
				["aniStickerPackId", face.aniStickerPackId],
				["aniStickerId", face.aniStickerId],
				["aniStickerWidth", face.aniStickerWidth],
				["aniStickerHeight", face.aniStickerHeight]
			]) if (value !== null && !Number.isSafeInteger(value)) throw new Error(`invalid ${name} for system face id ${face.qSid}`);
			if (face.url !== null && typeof face.url !== "string") throw new Error(`invalid url for system face id ${face.qSid}`);
			const previous = seen.get(face.qSid);
			if (previous) {
				const previousFaceIndex = previous.faceIndexByPack.get(packIndex);
				if (previousFaceIndex !== void 0) throw new Error(`duplicate system face id ${face.qSid} within pack ${packIndex}: faces ${previousFaceIndex} and ${faceIndex}`);
				if (!hasCompatibleSendMetadata(previous.face, face)) throw new Error(`conflicting system face send metadata for id ${face.qSid}: pack ${previous.packIndex}, face ${previous.faceIndex} vs pack ${packIndex}, face ${faceIndex}`);
				previous.faceIndexByPack.set(packIndex, faceIndex);
			} else seen.set(face.qSid, {
				face,
				packIndex,
				faceIndex,
				faceIndexByPack: /* @__PURE__ */ new Map([[packIndex, faceIndex]])
			});
			faceCount += 1;
		}
	}
	if (faceCount === 0) throw new Error("system face catalog contains no faces");
	return packs;
}
function hasCompatibleSendMetadata(left, right) {
	if (!isAddressableFaceId(left.qSid)) return true;
	const leftIsSuper = isSuperFaceEntry(left);
	if (leftIsSuper !== isSuperFaceEntry(right)) return false;
	if (!leftIsSuper) return true;
	return left.aniStickerType === right.aniStickerType && left.aniStickerPackId === right.aniStickerPackId && left.aniStickerId === right.aniStickerId;
}
function isAddressableFaceId(id) {
	if (!/^(?:0|[1-9]\d*)$/.test(id)) return false;
	const numeric = Number(id);
	return Number.isSafeInteger(numeric) && numeric >= 0;
}
function indexCatalog(packs) {
	const byId = /* @__PURE__ */ new Map();
	let entryCount = 0;
	for (const pack of packs) for (const emoji of pack.emojis) {
		entryCount += 1;
		if (!byId.has(emoji.qSid)) byId.set(emoji.qSid, emoji);
	}
	return {
		packs,
		byId,
		entryCount,
		overlapCount: entryCount - byId.size,
		lookups: /* @__PURE__ */ new Map()
	};
}
/** Shared, process-wide catalog (the face set is account-independent). */
var sysFaceStore = new SysFaceStore();
export {};
