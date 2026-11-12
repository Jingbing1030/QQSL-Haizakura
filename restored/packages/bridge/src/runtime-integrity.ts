// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/runtime-integrity.ts"
// original bundle lines 5062-5109  (46 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** File labels can change after startup; only the actual token decides the warning. */
function hasLowProcessIntegrity(integrity) {
	return integrity.status === "available" && integrity.process.status === "ok" && integrity.process.rid < 8192;
}
function record$1(value) {
	return typeof value === "object" && value !== null;
}
function uint32(value) {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4294967295;
}
function readError(value) {
	return value.status === "error" && typeof value.operation === "string" && uint32(value.code);
}
function isNativeRuntimeIntegrity(value) {
	if (!record$1(value) || value.pid !== process.pid || !(typeof value.executablePath === "string" || value.executablePath === null) || !record$1(value.process) || !record$1(value.file)) return false;
	if (!(readError(value.process) || value.process.status === "ok" && uint32(value.process.rid))) return false;
	const file = value.file;
	return readError(file) || file.status === "ok" && (file.label === null || record$1(file.label) && uint32(file.label.rid) && typeof file.label.inherited === "boolean" && uint32(file.label.policy));
}
var cached$2;
/** One startup snapshot, shared by the startup log and the WebUI warning. */
function getRuntimeIntegrity() {
	return cached$2 ??= readRuntimeIntegrity();
}
async function readRuntimeIntegrity() {
	if (process.platform !== "win32") return { status: "unsupported" };
	try {
		const addon = getNativeHookAddon();
		if (!addon) throw new Error(getNativeHookLoadError() ?? "原生组件不可用");
		if (typeof addon.getRuntimeIntegrityAsync !== "function") throw new Error("当前原生组件不支持完整性诊断，请更新原生组件");
		const result = await addon.getRuntimeIntegrityAsync();
		if (!isNativeRuntimeIntegrity(result)) throw new Error("原生完整性诊断返回了无效数据");
		return {
			status: "available",
			pid: result.pid,
			executablePath: result.executablePath,
			process: result.process,
			file: result.file
		};
	} catch (error) {
		return {
			status: "unavailable",
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
export {};
