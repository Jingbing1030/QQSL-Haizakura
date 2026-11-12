// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/network/http-trace.ts"
// original bundle lines 341054-341062  (7 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** Accept W3C traceparent without treating caller-supplied IDs as local request IDs. */
function httpTraceparent(value) {
	if (typeof value !== "string" || /[^\x21-\x7e]/.test(value)) return;
	const match = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(.*)$/.exec(value);
	if (!match || match[1] === "ff" || /^0+$/.test(match[2]) || /^0+$/.test(match[3]) || (match[1] === "00" ? match[5] !== "" : match[5] !== "" && !match[5].startsWith("-"))) return;
	return value.slice(0, 55);
}
export {};
