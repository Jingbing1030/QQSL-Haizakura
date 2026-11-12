// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/qq-account/database-holders.ts"
// original bundle lines 2780-2851  (70 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
async function getDatabaseHolders(dbPath) {
	if (process.platform === "win32") return getWindowsHolders(dbPath);
	return process.platform === "linux" ? getLinuxHolders(dbPath) : [];
}
async function getWindowsHolders(dbPath) {
	const addon = getNativeHookAddon();
	if (!addon?.getFileHoldersAsync) throw new Error("Windows account detection requires a hook addon with getFileHoldersAsync");
	const holders = await addon.getFileHoldersAsync(dbPath);
	if (!Array.isArray(holders) || holders.some((holder) => !holder || !Number.isInteger(holder.pid) || holder.pid <= 0 || typeof holder.name !== "string")) throw new Error("Invalid database holders returned by the hook addon");
	return holders;
}
function isQqProcessName(name) {
	return name.trim().toLowerCase().replace(/\.exe$/, "") === "qq";
}
/** Match POSIX locks by device and inode; the table does not contain file paths. */
async function getLinuxHolders(dbPath) {
	const stat = await fs$2.stat(dbPath).catch((error) => {
		if (error.code === "ENOENT") return null;
		throw error;
	});
	if (!stat) return [];
	const key = deviceInodeKey(stat.dev, stat.ino);
	const table = await fs$2.readFile("/proc/locks", "utf8");
	const holders = [];
	const seen = /* @__PURE__ */ new Set();
	for (const line of table.split("\n")) {
		const fields = line.trim().split(/\s+/);
		if (fields.length < 8 || fields[5] !== key) continue;
		const pid = Number(fields[4]);
		if (!Number.isInteger(pid) || pid <= 0 || seen.has(pid)) continue;
		seen.add(pid);
		holders.push({
			pid,
			name: await readProcessName(pid)
		});
	}
	return holders;
}
function deviceInodeKey(device, inode) {
	const major = device >> 8 & 4095;
	const minor = device & 255 | device >> 12 & 1048320;
	return `${major.toString(16).padStart(2, "0")}:${minor.toString(16).padStart(2, "0")}:${inode}`;
}
async function readProcessName(pid) {
	try {
		return (await fs$2.readFile(`/proc/${pid}/comm`, "utf8")).trim();
	} catch (error) {
		if (error.code === "ENOENT") return "";
		throw error;
	}
}
var RELEASE_PREBUILDS = "./native/sqlite/prebuilds/";
function prebuildFiles(target) {
	if (!/^(win32|linux|darwin)-(x64|arm64)$/.test(target)) throw new Error(`Unsupported SQLite target: ${target}`);
	return (target.startsWith("linux-") ? ["@appthreat+sqlite3.glibc.node", "@appthreat+sqlite3.musl.node"] : ["@appthreat+sqlite3.node"]).map((file) => `${target}/${file}`);
}
function runtimePrebuild(platform, arch, libc) {
	const target = `${platform}-${arch}`;
	const files = prebuildFiles(target);
	if (platform !== "linux") return files[0];
	if (!libc) throw new Error("SQLite requires an explicit Linux libc selection");
	return `${target}/@appthreat+sqlite3.${libc}.node`;
}
function assertRuntime(node, napi) {
	if (!(Number.parseInt(node, 10) >= 24) || !(Number(napi) >= 10)) throw new Error(`SQLite requires Node >=24 and Node-API >=10; got Node ${node}, Node-API ${napi ?? "unavailable"}`);
}
function runtimeLibc(report) {
	if (!("header" in report) || !report.header || typeof report.header !== "object") throw new Error("Cannot determine SQLite libc: Node diagnostic report has no header");
	return "glibcVersionRuntime" in report.header && typeof report.header.glibcVersionRuntime === "string" && report.header.glibcVersionRuntime.length > 0 ? "glibc" : "musl";
}
export {};
