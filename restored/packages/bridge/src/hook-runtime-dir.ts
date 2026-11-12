// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/hook-runtime-dir.ts"
// original bundle lines 1693-1764  (70 lines) of dist/index.mjs
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
function configuredDirectory(value, variable) {
	if (!value) return null;
	if (!path$1.isAbsolute(value)) throw new Error(`${variable} must be an absolute path`);
	return value;
}
function parseProcessEnvironment(raw) {
	const result = {};
	for (const entry of raw.split("\0")) {
		if (!entry) continue;
		const separator = entry.indexOf("=");
		if (separator <= 0) continue;
		result[entry.slice(0, separator)] = entry.slice(separator + 1);
	}
	return result;
}
function parseRealUid(status) {
	const match = /^Uid:\s+(\d+)/m.exec(status);
	if (!match) return null;
	const uid = Number(match[1]);
	return Number.isSafeInteger(uid) && uid >= 0 ? uid : null;
}
function isProcessGoneError(error) {
	const code = error?.code;
	return code === "ENOENT" || code === "ESRCH";
}
function ownRuntimeDir(platform, env, ownUid) {
	const explicit = configuredDirectory(env.SNOWLUMA_HOOK_RUNTIME_DIR, "SNOWLUMA_HOOK_RUNTIME_DIR");
	if (explicit) return explicit;
	const xdg = configuredDirectory(env.XDG_RUNTIME_DIR, "XDG_RUNTIME_DIR");
	if (xdg) return xdg;
	if (platform === "darwin") {
		const tmpdir = configuredDirectory(env.TMPDIR, "TMPDIR");
		if (tmpdir) return path$1.join(tmpdir, "snowluma-hook");
	}
	return `/tmp/snowluma-${ownUid}`;
}
/**
* Resolve the socket directory for the target QQ process. The supervisor may
* run under a different user, so its own runtime directory is not authoritative.
*/
function resolveHookRuntimeDir(targetPid, deps = {}) {
	const platform = deps.platform ?? process.platform;
	const env = deps.env ?? process.env;
	const ownUid = deps.ownUid ?? (typeof process.geteuid === "function" ? process.geteuid() : os.userInfo().uid);
	const readText = deps.readText ?? ((file) => readFileSync$1(file, "utf8"));
	if (platform !== "linux" || !Number.isSafeInteger(targetPid) || targetPid <= 0) return ownRuntimeDir(platform, env, ownUid);
	let environError;
	try {
		const targetEnv = parseProcessEnvironment(readText(`/proc/${targetPid}/environ`));
		const explicit = configuredDirectory(targetEnv.SNOWLUMA_HOOK_RUNTIME_DIR, `QQ process ${targetPid} SNOWLUMA_HOOK_RUNTIME_DIR`);
		if (explicit) return explicit;
		const xdg = configuredDirectory(targetEnv.XDG_RUNTIME_DIR, `QQ process ${targetPid} XDG_RUNTIME_DIR`);
		if (xdg) return xdg;
		environError = /* @__PURE__ */ new Error("runtime directory is not present");
	} catch (error) {
		if (error instanceof Error && error.message.includes("must be an absolute path")) throw error;
		environError = error;
	}
	let statusError;
	try {
		const uid = parseRealUid(readText(`/proc/${targetPid}/status`));
		if (uid !== null) return `/tmp/snowluma-${uid}`;
		statusError = /* @__PURE__ */ new Error("real uid is not available");
	} catch (error) {
		statusError = error;
	}
	if (isProcessGoneError(statusError) && (isProcessGoneError(environError) || environError instanceof Error && environError.message === "runtime directory is not present")) return ownRuntimeDir(platform, env, ownUid);
	throw new Error(`cannot resolve hook runtime directory for PID ${targetPid}: environment=${errorMessage(environError)}; status=${errorMessage(statusError)}`);
}
export {};
