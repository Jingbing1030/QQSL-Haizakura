// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/coerce.ts"
// original bundle lines 174-196  (21 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** True only for a plain, non-null, non-array object. */
function isObject$5(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** The value when it is a real boolean, else the fallback. Strings/numbers
*  are NOT coerced — `'true'` and `1` both yield the fallback. */
function boolOr(value, fallback) {
	return typeof value === "boolean" ? value : fallback;
}
/** A finite number (numeric strings coerced) clamped to `[min, max]`, else
*  the fallback. Fractional precision is preserved — use `clampInt` to floor. */
function clampNum(value, min, max, fallback) {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}
/** `clampNum` truncated toward zero — clamp first, then drop the fraction. */
function clampInt(value, min, max, fallback) {
	return Math.trunc(clampNum(value, min, max, fallback));
}
var init_coerce = __esmMin((() => {}));
export {};
