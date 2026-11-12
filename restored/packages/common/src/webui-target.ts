// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/webui-target.ts"
// original bundle lines 348337-348367  (29 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** Browser-safe contract shared by startup, the WebUI and embedding hosts.
* Targets are deployment choices; they never belong in the saved UI preferences. */
var WEBUI_TARGETS = { maibot: {
	label: "麦麦 / 一键包",
	styles: ["millennium"],
	defaultStyle: "millennium"
} };
var WEBUI_TARGET_BOOTSTRAP_ID = "snowluma-webui-target";
function resolveWebuiTarget(raw) {
	if (raw === void 0 || raw.trim() === "") return null;
	const value = raw.trim();
	if (!Object.hasOwn(WEBUI_TARGETS, value)) throw new Error(`Invalid SNOWLUMA_WEBUI_TARGET: ${JSON.stringify(value)}. Expected ${Object.keys(WEBUI_TARGETS).join(", ")} or an empty value.`);
	return value;
}
function defaultWebuiPresentation(target) {
	return {
		version: 1,
		target,
		style: WEBUI_TARGETS[target].defaultStyle,
		mode: "system"
	};
}
/** Inject before the cached pre-paint theme script. Default HTML stays byte-for-byte intact. */
function injectWebuiTarget(html, target) {
	if (target === null) return html;
	if (!html.includes("<head>")) throw new Error("WebUI HTML is missing <head>; cannot inject runtime target");
	const json = JSON.stringify(defaultWebuiPresentation(target)).replaceAll("<", "\\u003c");
	return html.replace("<head>", `<head>\n    <script id="${WEBUI_TARGET_BOOTSTRAP_ID}" type="application/json">${json}<\/script>`);
}
export {};
