// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../websocket/src/native.ts"
// original bundle lines 339598-339668  (69 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var __dirname$2 = path.dirname(fileURLToPath$1(import.meta.url));
function platformBinaryName() {
	return `websocket-${process.platform}-${process.arch}.node`;
}
function searchDirs() {
	return [
		path.resolve(__dirname$2, "native"),
		path.resolve(__dirname$2, "..", "native"),
		path.resolve(__dirname$2, "..", "..", "runtime", "native"),
		path.resolve(process.cwd(), "native"),
		path.resolve(process.cwd(), "dist", "native"),
		path.resolve(process.cwd(), "packages", "runtime", "native")
	];
}
function resolveAddonPath() {
	const fileName = platformBinaryName();
	for (const dir of searchDirs()) {
		const full = path.join(dir, fileName);
		if (existsSync(full)) return full;
	}
	throw new Error(`[snowluma/websocket] native addon not found: ${fileName}. Searched: ${searchDirs().join(", ")}`);
}
function loadAddon() {
	const addonPath = resolveAddonPath();
	const mod = { exports: {} };
	process.dlopen(mod, addonPath);
	return mod.exports;
}
function createStubAddon(reason) {
	const fail = () => {
		throw new Error(`[snowluma/websocket] native addon is stubbed (${reason}). Set SNOWLUMA_DEV_NO_NATIVE=0 (or unset) and provide the prebuilt binary to enable WebSocket I/O.`);
	};
	class StubParser {
		constructor(_options) {}
		push(_chunk) {
			return fail();
		}
	}
	console.warn(`[snowluma/websocket] WARNING: using stub addon (${reason}). WebSocket features are disabled.`);
	return {
		Parser: StubParser,
		buildFrame: fail,
		computeAcceptKey: fail
	};
}
function tryLoad() {
	const devSkip = process.env.SNOWLUMA_DEV_NO_NATIVE === "1";
	try {
		return loadAddon();
	} catch (err) {
		if (devSkip) return createStubAddon(err.message);
		throw err;
	}
}
var addon;
function getAddon() {
	return addon ??= tryLoad();
}
var native = {
	get Parser() {
		return getAddon().Parser;
	},
	buildFrame(...args) {
		return getAddon().buildFrame(...args);
	},
	computeAcceptKey(key) {
		return getAddon().computeAcceptKey(key);
	}
};
export {};
