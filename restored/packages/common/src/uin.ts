// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/uin.ts"
// original bundle lines 1652-1657  (4 lines) of dist/index.mjs
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
function isRealUin(uin) {
	return /^\d{5,10}$/.test(uin);
}
export {};
