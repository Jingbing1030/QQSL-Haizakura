// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../sqlite/src/native.ts"
// original bundle lines 2852-2876  (23 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function assertBinding(value) {
	if (!value || typeof value !== "object" || !("NATIVE_INTERFACE_VERSION" in value) || value.NATIVE_INTERFACE_VERSION !== 1 || !("Database" in value) || typeof value.Database !== "function" || !("Statement" in value) || typeof value.Statement !== "function" || !("OPEN_READONLY" in value) || value.OPEN_READONLY !== 1 || !("OPEN_READWRITE" in value) || value.OPEN_READWRITE !== 2 || !("OPEN_CREATE" in value) || value.OPEN_CREATE !== 4 || !("OPEN_FULLMUTEX" in value) || value.OPEN_FULLMUTEX !== 65536) throw new Error(`SQLite native interface mismatch; expected interface 1`);
}
var binding;
function loadNative() {
	if (binding) return binding;
	assertRuntime(process.versions.node, process.versions.napi);
	const libc = process.platform === "linux" ? runtimeLibc(process.report.getReport()) : void 0;
	const file = runtimePrebuild(process.platform, process.arch, libc);
	const root = fileURLToPath$1(new URL(RELEASE_PREBUILDS, import.meta.url));
	const filename = path.join(root, file);
	try {
		const module = { exports: {} };
		process.dlopen(module, filename);
		assertBinding(module.exports);
		Object.assign(module.exports.Database.prototype, EventEmitter$1.prototype);
		Object.assign(module.exports.Statement.prototype, EventEmitter$1.prototype);
		binding = module.exports;
		return binding;
	} catch (cause) {
		throw new Error(`Failed to load SQLite native addon: ${filename}`, { cause });
	}
}
export {};
