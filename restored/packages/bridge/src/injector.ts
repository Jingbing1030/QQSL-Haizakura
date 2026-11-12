// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/injector.ts"
// original bundle lines 2710-2779  (68 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
init_errors();
init_native_path();
var nativeAddon = null;
var nativeLoadError = null;
function loadNativeAddon(addonPath) {
	const mod = { exports: {} };
	process.dlopen(mod, addonPath);
	return mod.exports;
}
function platformInjectableExt() {
	return process.platform === "win32" ? "dll" : "so";
}
function defaultProcessName$1() {
	return process.platform === "win32" ? "QQ.exe" : "qq";
}
function resolveHookNativePath(ext) {
	return resolveRuntimeNativePath(`snowluma-${process.platform}-${process.arch}.${ext}`);
}
function getNativeHookAddon() {
	if (nativeAddon) return nativeAddon;
	const addonPath = resolveHookNativePath("node");
	if (!addonPath) {
		nativeLoadError = `No hook native addon found for ${process.platform}-${process.arch}`;
		return null;
	}
	try {
		nativeAddon = loadNativeAddon(addonPath);
		nativeLoadError = null;
		return nativeAddon;
	} catch (error) {
		nativeLoadError = errorMessage(error);
		return null;
	}
}
function getNativeHookLoadError() {
	return nativeLoadError;
}
async function listHookProcesses() {
	if (process.platform === "darwin") return [...listSnowlumaPipePidsSync()].sort((a, b) => a - b).map((pid) => ({
		pid,
		name: defaultProcessName$1(),
		path: ""
	}));
	const addon = getNativeHookAddon();
	if (!addon) throw new Error(getNativeHookLoadError() ?? "hook native addon is not available");
	if (typeof addon.getAllMainProcessAsync !== "function") throw new Error("Hook native addon lacks getAllMainProcessAsync; update the native artifacts");
	return [...new Set(await addon.getAllMainProcessAsync())].filter((pid) => Number.isInteger(pid) && pid > 0).sort((a, b) => a - b).map((pid) => ({
		pid,
		name: defaultProcessName$1(),
		path: ""
	}));
}
async function injectHookProcess(pid) {
	const addon = getNativeHookAddon();
	if (!addon) throw new Error(getNativeHookLoadError() ?? "hook native addon is not available");
	const injectableExt = platformInjectableExt();
	const dllPath = resolveHookNativePath(injectableExt);
	if (!dllPath) throw new Error(`No hook ${injectableExt} found for ${process.platform}-${process.arch}`);
	return {
		method: "loadModuleManual",
		handle: await addon.loadModuleManualAsync(pid, dllPath)
	};
}
async function unloadHookProcess(pid, handle) {
	const addon = getNativeHookAddon();
	if (!addon) throw new Error(getNativeHookLoadError() ?? "hook native addon is not available");
	await addon.unloadModuleManualAsync(pid, handle);
}
export {};
