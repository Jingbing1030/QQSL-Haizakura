// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/media-store-migration.ts"
// original bundle lines 343046-343111  (64 lines) of dist/index.mjs
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
var log$20 = createLogger("OneBot.MediaMigration");
var BATCH_SIZE = 200;
/** Runs in the existing database worker, before the account is marked ready.
* Copy only: leave the old database (including its WAL) intact for recovery.
* Each committed batch advances its cursor in the destination transaction.
*/
async function migrateLegacyMedia(messageDbPath, cancelled = () => false) {
	await new MediaStore(messageDbPath).close();
	const destination = openSqliteDb(messageDbPath);
	let source;
	try {
		await destination.exec(`CREATE TABLE IF NOT EXISTS media_migration_state (
      id INTEGER PRIMARY KEY CHECK (id = 1), phase TEXT NOT NULL, cursor INTEGER NOT NULL
    ); INSERT OR IGNORE INTO media_migration_state VALUES (1, 'entries', 0)`);
		const state = await destination.prepare("SELECT phase, cursor FROM media_migration_state WHERE id = 1").get();
		if (state.phase === "complete") return;
		const sourcePath = path.join(path.dirname(messageDbPath), "media.db");
		if (!fs.existsSync(sourcePath)) {
			await destination.exec("UPDATE media_migration_state SET phase = 'complete' WHERE id = 1");
			return;
		}
		source = new SqliteDatabase(sourcePath, { readOnly: true });
		log$20.info("preserving legacy media metadata: migration started");
		const insertEntry = destination.prepare(`INSERT INTO legacy_media_entries (type, primary_key, data, last_seen)
      VALUES (?, ?, ?, ?) ON CONFLICT(type, primary_key) DO NOTHING`);
		const insertKey = destination.prepare(`INSERT INTO legacy_media_keys (type, key, primary_key)
      VALUES (?, ?, ?) ON CONFLICT(type, key) DO NOTHING`);
		const saveState = destination.prepare("UPDATE media_migration_state SET phase = ?, cursor = ? WHERE id = 1");
		while (!cancelled() && state.phase !== "complete") {
			const table = state.phase === "entries" ? "media_entries" : "media_keys";
			const rows = await source.prepare(`SELECT rowid AS migration_rowid, * FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ?`).all(state.cursor, BATCH_SIZE);
			const nextPhase = rows.length === 0 ? state.phase === "entries" ? "keys" : "complete" : state.phase;
			const nextCursor = rows.at(-1)?.migration_rowid ?? 0;
			await destination.exec("BEGIN IMMEDIATE");
			try {
				for (const row of rows) {
					if (![
						"image",
						"record",
						"video"
					].includes(row.type)) throw new Error(`unsupported legacy media type at row ${row.migration_rowid}`);
					if (state.phase === "entries") {
						const info = JSON.parse(row.data);
						if (!info || typeof info !== "object" || Array.isArray(info)) throw new Error(`invalid legacy media metadata at row ${row.migration_rowid}`);
						await insertEntry.run(row.type, foldMediaKey(row.primary_key), serializeMediaInfo(info), row.last_seen);
					} else await insertKey.run(row.type, foldMediaKey(row.key), foldMediaKey(row.primary_key));
				}
				await saveState.run(nextPhase, nextCursor);
				await destination.exec("COMMIT");
			} catch (error) {
				await rollbackMediaTransaction(destination, error);
			}
			state.phase = nextPhase;
			state.cursor = nextCursor;
			log$20.debug("preserving legacy media metadata: phase=%s cursor=%d", state.phase, state.cursor);
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		if (!cancelled()) log$20.info("preserving legacy media metadata: migration complete; source retained");
	} finally {
		await source?.close();
		await destination.close();
	}
}
export {};
