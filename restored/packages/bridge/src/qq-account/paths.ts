// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/qq-account/paths.ts"
// original bundle lines 3084-3163  (78 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var LOGIN_DB_SEGMENTS = ["nt_db", "login.db"];
function qqDataRoots() {
	if (process.platform === "win32") return windowsDataRoots();
	if (process.platform === "linux") return linuxDataRoots({
		...process.env,
		HOME: process.env.HOME || homedir()
	});
	return [];
}
/** Each Linux client owns its HOME; an unavailable process has no known root. */
function qqDataRootsForPid(pid) {
	if (process.platform === "win32") return windowsDataRoots();
	if (process.platform !== "linux") return [];
	const environment = readProcessEnvironment(pid);
	return environment ? linuxDataRoots(environment) : [];
}
function linuxDataRoots(environment) {
	const base = environment.XDG_CONFIG_HOME || (environment.HOME ? path.join(environment.HOME, ".config") : null);
	return base ? [path.join(base, "QQ")] : [];
}
function readProcessEnvironment(pid) {
	let raw;
	try {
		raw = readFileSync(`/proc/${pid}/environ`, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
	const environment = {};
	for (const entry of raw.split("\0")) {
		const separator = entry.indexOf("=");
		if (separator <= 0) continue;
		const name = entry.slice(0, separator);
		if (name === "HOME" || name === "XDG_CONFIG_HOME") environment[name] = entry.slice(separator + 1);
	}
	return environment;
}
/** Both Linux layouts occur in QQ installations; the primary takes precedence. */
function loginDbPaths(root) {
	if (process.platform === "win32") return [path.join(root, "nt_qq", "global", ...LOGIN_DB_SEGMENTS)];
	return [path.join(root, "global", ...LOGIN_DB_SEGMENTS), path.join(root, "nt_qq", "global", ...LOGIN_DB_SEGMENTS)];
}
function ntMsgDbPath(root, account) {
	if (process.platform === "win32") return path.join(root, account.uin, "nt_qq", "nt_db", "nt_msg.db");
	return path.join(root, accountDirName(account.uid), "nt_db", "nt_msg.db");
}
function accountDirName(uid) {
	const digest = createHash("md5").update(uid, "utf8").digest("hex");
	return `nt_qq_${createHash("md5").update(`${digest}nt_kernel`, "utf8").digest("hex")}`;
}
function windowsDataRoots() {
	return [tencentFilesRootFromUserDataInfo() ?? path.join(homedir(), "Documents", "Tencent Files")];
}
function tencentFilesRootFromUserDataInfo(home = homedir()) {
	const ini = path.join(path.dirname(home), "Public", "Documents", "Tencent", "QQ", "UserDataInfo.ini");
	let text;
	try {
		text = readFileSync(ini, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
	let inDataSet = false;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith("[") && line.endsWith("]")) {
			inDataSet = line.toLowerCase() === "[userdataset]";
			continue;
		}
		if (!inDataSet) continue;
		const separator = line.indexOf("=");
		if (separator === -1 || line.slice(0, separator).trim().toLowerCase() !== "userdatasavepath") continue;
		const value = line.slice(separator + 1).trim();
		if (value.length === 0) return null;
		return path.win32.basename(value).toLowerCase() === "tencent files" ? value : path.win32.join(value, "Tencent Files");
	}
	return null;
}
export {};
