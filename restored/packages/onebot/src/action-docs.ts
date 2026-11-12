// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/action-docs.ts"
// original bundle lines 353512-353524  (11 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** Every declarative action's doc (with category), sorted by name. */
function collectActionDocs() {
	return ACTION_REGISTRY.actions.map(({ doc }) => structuredClone(doc)).sort((a, b) => a.name.localeCompare(b.name));
}
/** Distinct categories with action counts. */
function collectCategories() {
	return ACTION_REGISTRY.categories.map(({ category, count }) => ({
		category,
		count
	}));
}
export {};
