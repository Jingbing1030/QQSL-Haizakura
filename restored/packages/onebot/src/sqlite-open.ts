// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/sqlite-open.ts"
// original bundle lines 22627-22632  (4 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** Opens asynchronously with the shared WAL, durability and busy-timeout defaults. */
function openSqliteDb(dbPath) {
	return new SqliteDatabase(dbPath);
}
export {};
