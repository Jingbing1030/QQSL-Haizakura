// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/native-path.ts"
// original bundle lines 2697-2709  (11 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function resolveRuntimeNativePath(fileName) {
	for (const directory of [path$1.join(moduleDir, "native"), path$1.resolve(moduleDir, "..", "..", "runtime", "native")]) {
		const candidate = path$1.join(directory, fileName);
		if (existsSync$1(candidate)) return candidate;
	}
	return null;
}
var moduleDir;
var init_native_path = __esmMin((() => {
	moduleDir = path$1.dirname(fileURLToPath(import.meta.url));
}));
export {};
