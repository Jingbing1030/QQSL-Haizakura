// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/media-store.ts"
// original bundle lines 22633-22863  (229 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var TYPE_IMAGE = "image";
var TYPE_RECORD = "record";
var TYPE_VIDEO = "video";
var DEFAULT_KEEP_ENTRIES = 4096;
var INLINE_MEDIA_SOURCE = /^(base64:\/\/|data:)/i;
/** Durable media metadata. Production shares messages.db with MessageStore.
* Only the in-memory lookup cache is bounded; history dependencies never expire.
*/
var MediaStore = class {
	maxCachedEntries;
	db;
	cache = /* @__PURE__ */ new Map();
	upsertEntry;
	upsertKey;
	findEntry;
	findLegacyEntry;
	initialization;
	constructor(dbPath, maxCachedEntries = DEFAULT_KEEP_ENTRIES) {
		this.maxCachedEntries = maxCachedEntries;
		this.db = openSqliteDb(dbPath);
		this.initialization = this.db.serial(async () => {
			for (const prefix of ["", "legacy_"]) await this.db.exec(`
          CREATE TABLE IF NOT EXISTS ${prefix}media_entries (
            type TEXT NOT NULL, primary_key TEXT NOT NULL, data TEXT NOT NULL,
            last_seen INTEGER NOT NULL, PRIMARY KEY (type, primary_key)
          );
          CREATE TABLE IF NOT EXISTS ${prefix}media_keys (
            type TEXT NOT NULL, key TEXT NOT NULL, primary_key TEXT NOT NULL,
            PRIMARY KEY (type, key)
          );
        `);
			this.upsertEntry = this.db.prepare(`
        INSERT INTO media_entries (type, primary_key, data, last_seen) VALUES (?, ?, ?, ?)
        ON CONFLICT(type, primary_key) DO UPDATE SET data = excluded.data, last_seen = excluded.last_seen
      `);
			this.upsertKey = this.db.prepare(`
        INSERT INTO media_keys (type, key, primary_key) VALUES (?, ?, ?)
        ON CONFLICT(type, key) DO UPDATE SET primary_key = excluded.primary_key
      `);
			this.findEntry = this.db.prepare(`
        SELECT data FROM media_entries WHERE type = ? AND primary_key = COALESCE(
          (SELECT primary_key FROM media_keys WHERE type = ? AND key = ?), ?
        )
      `);
			this.findLegacyEntry = this.db.prepare(`
        SELECT data FROM legacy_media_entries WHERE type = ? AND primary_key = COALESCE(
          (SELECT primary_key FROM legacy_media_keys WHERE type = ? AND key = ?), ?
        )
      `);
		});
		this.initialization.catch(() => void 0);
	}
	async close() {
		await this.initialization.catch(() => void 0);
		await this.db.close();
	}
	async rememberImage(info) {
		info = structuredClone(info);
		return this.db.serial(async () => {
			await this.initialization;
			await this.remember(TYPE_IMAGE, info, [
				info.file,
				info.fileName,
				info.url
			]);
		});
	}
	async rememberRecord(info) {
		info = structuredClone(info);
		return this.db.serial(async () => {
			await this.initialization;
			await this.remember(TYPE_RECORD, info, [
				info.file,
				info.fileName,
				info.fileId,
				info.url
			]);
		});
	}
	async rememberVideo(info) {
		info = structuredClone(info);
		return this.db.serial(async () => {
			await this.initialization;
			await this.remember(TYPE_VIDEO, info, [
				info.file,
				info.fileName,
				info.fileId,
				info.url
			]);
		});
	}
	async findImage(key, source = "current") {
		return this.db.serial(async () => {
			await this.initialization;
			return await this.find(TYPE_IMAGE, key, source);
		});
	}
	async findRecord(key, source = "current") {
		return this.db.serial(async () => {
			await this.initialization;
			return await this.find(TYPE_RECORD, key, source);
		});
	}
	async findVideo(key, source = "current") {
		return this.db.serial(async () => {
			await this.initialization;
			return await this.find(TYPE_VIDEO, key, source);
		});
	}
	async updateImageUrl(key, url) {
		return this.db.serial(async () => {
			await this.initialization;
			await this.updateUrl(TYPE_IMAGE, key, url);
		});
	}
	async updateRecordUrl(key, url) {
		return this.db.serial(async () => {
			await this.initialization;
			await this.updateUrl(TYPE_RECORD, key, url);
		});
	}
	async updateVideoUrl(key, url) {
		return this.db.serial(async () => {
			await this.initialization;
			await this.updateUrl(TYPE_VIDEO, key, url);
		});
	}
	/** Counts durable records, not the bounded lookup cache. */
	async size() {
		return this.db.serial(async () => {
			await this.initialization;
			const counts = await this.db.prepare(`SELECT type, COUNT(*) AS n FROM (
          SELECT type FROM media_entries UNION ALL SELECT type FROM legacy_media_entries
        ) GROUP BY type`).all();
			const count = (type) => counts.find((row) => row.type === type)?.n ?? 0;
			return {
				images: await count(TYPE_IMAGE),
				records: await count(TYPE_RECORD),
				videos: await count(TYPE_VIDEO)
			};
		});
	}
	async remember(type, info, aliases) {
		const primary = pickPrimary(aliases);
		if (!primary) throw new Error(`cannot store ${type} metadata without an identifier`);
		const data = serializeMediaInfo(info);
		await this.db.exec("BEGIN IMMEDIATE");
		try {
			await this.upsertEntry.run(type, primary, data, Math.floor(Date.now() / 1e3));
			for (const key of new Set(aliases.filter(Boolean).map(foldMediaKey))) await this.upsertKey.run(type, key, primary);
			await this.db.exec("COMMIT");
		} catch (error) {
			await rollbackMediaTransaction(this.db, error);
		}
		this.cache.clear();
	}
	async find(type, key, source = "current") {
		const lookup = foldMediaKey(key);
		if (!lookup) return null;
		const cacheKey = `${source}:${type}:${lookup}`;
		let data = this.cache.get(cacheKey);
		if (data === void 0) {
			const row = (source === "current" ? await this.findEntry.get(type, type, lookup, lookup) : void 0) ?? await this.findLegacyEntry.get(type, type, lookup, lookup);
			if (!row) return null;
			data = row.data;
		}
		const result = JSON.parse(data);
		if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error(`invalid persisted ${type} metadata`);
		this.cache.delete(cacheKey);
		this.cache.set(cacheKey, data);
		while (this.cache.size > Math.max(0, this.maxCachedEntries)) this.cache.delete(this.cache.keys().next().value);
		return result;
	}
	async updateUrl(type, key, url) {
		if (!url || mustFoldMediaKey(url)) return;
		const info = await this.find(type, key);
		if (!info || info.url === url) return;
		await this.remember(type, {
			...info,
			url
		}, [
			info.file,
			info.fileName,
			info.fileId,
			url
		].filter((value) => typeof value === "string"));
	}
};
function serializeMediaInfo(info) {
	const data = JSON.stringify(persistableMediaInfo(info));
	if (data.length > 65536) throw new Error(`media metadata exceeds storage limit (${data.length} characters)`);
	return data;
}
async function rollbackMediaTransaction(db, error) {
	try {
		await db.exec("ROLLBACK");
	} catch (rollbackError) {
		throw new AggregateError([error, rollbackError], "media write and rollback failed", { cause: error });
	}
	throw error;
}
function mustFoldMediaKey(value) {
	return value.length > 2048 || INLINE_MEDIA_SOURCE.test(value);
}
function foldMediaKey(value) {
	if (!value) return "";
	if (!mustFoldMediaKey(value)) return value;
	return `inline:${createHash("sha256").update(value).digest("hex")}`;
}
function persistableMediaInfo(info) {
	const next = { ...info };
	for (const field of [
		"file",
		"fileId",
		"fileName"
	]) {
		const value = next[field];
		if (typeof value === "string") next[field] = foldMediaKey(value);
	}
	for (const field of ["url", "imageUrl"]) {
		const value = next[field];
		if (typeof value === "string" && mustFoldMediaKey(value)) next[field] = "";
	}
	return next;
}
function pickPrimary(candidates) {
	for (const c of candidates) if (c && c.length > 0) return foldMediaKey(c);
	return "";
}
export {};
