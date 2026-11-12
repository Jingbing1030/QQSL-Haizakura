// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/oidb-services/shared.ts"
// original bundle lines 82478-82499  (20 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** Coerce numbers, strings, and bigints to a plain integer. */
function toInt$1(value) {
	if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === "bigint") {
		const n = Number(value);
		return Number.isFinite(n) ? Math.trunc(n) : 0;
	}
	if (typeof value === "string" && value.trim()) {
		const n = Number(value);
		return Number.isFinite(n) ? Math.trunc(n) : 0;
	}
	return 0;
}
/** Standard OIDB sub-response check: throw a typed Error if retCode != 0.
*  Prefers `wording` over `msg` for the human-facing message. */
function ensureRetCodeZero(operation, code, msg, wording) {
	const retCode = toInt$1(code);
	if (retCode === 0) return;
	throw new Error(`${operation} failed: code=${retCode} msg=${typeof wording === "string" && wording || typeof msg === "string" && msg || "unknown error"}`);
}
export {};
