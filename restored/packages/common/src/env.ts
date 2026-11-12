// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/env.ts"
// original bundle lines 1658-1681  (22 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** Read a positive integer environment variable.
*
*  A blank value is absent and returns `fallback`. A present but unusable
*  value is ignored, with a warning, and also returns `fallback`.
*/
function positiveIntEnv(name, fallback, options) {
	const max = options?.max ?? MAX_POSITIVE_INT;
	const raw = (options?.env ?? process.env)[name];
	if (typeof raw !== "string" || !raw.trim()) return fallback;
	const value = raw.trim();
	const parsed = /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
	if (!Number.isSafeInteger(parsed) || parsed > max) {
		log$69.warn("%s=%j is ignored; expected a positive integer up to %d", name, raw, max);
		return fallback;
	}
	return parsed;
}
var log$69, MAX_POSITIVE_INT;
var init_env = __esmMin((() => {
	log$69 = createLogger("Env");
	MAX_POSITIVE_INT = 2147483647;
}));
export {};
