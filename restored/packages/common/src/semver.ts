// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/semver.ts"
// original bundle lines 360136-360163  (26 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var import_parse = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
	var SemVer = require_semver();
	var parse = (version, options, throwErrors = false) => {
		if (version instanceof SemVer) return version;
		try {
			return new SemVer(version, options);
		} catch (er) {
			if (!throwErrors) return null;
			throw er;
		}
	};
	module.exports = parse;
})))(), 1);
/** Parse a canonical SemVer string; tag prefixes belong at the GitHub boundary. */
function parseVersion(value) {
	if (typeof value !== "string") return null;
	const parsed = (0, import_parse.default)(value);
	if (!parsed) return null;
	return value === parsed.version + (parsed.build.length ? `+${parsed.build.join(".")}` : "") ? parsed : null;
}
function compareVersions(a, b) {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) throw new TypeError("Invalid semantic version");
	return left.compare(right);
}
export {};
