// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/qq-account/detect.ts"
// original bundle lines 3602-3639  (36 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
init_logger();
var log$68 = createLogger("QqAccount");
var reportedFailures = /* @__PURE__ */ new Map();
async function detectAccountLogins(roots = qqDataRoots()) {
	const states = [];
	for (const root of roots) {
		const report = await readLocalAccounts(root);
		for (const dbPath of loginDbPaths(root)) {
			const failure = report.failures.find((item) => item.path === dbPath);
			if (!failure) {
				reportedFailures.delete(dbPath);
				continue;
			}
			const detail = failure.error instanceof Error ? failure.error.message : String(failure.error ?? "");
			const reason = detail ? failure.reason + ": " + detail : failure.reason;
			if (reportedFailures.get(dbPath) !== reason) {
				reportedFailures.set(dbPath, reason);
				log$68.warn("login.db unreadable: path=%s reason=%s", dbPath, reason);
			}
		}
		for (const account of report.accounts) {
			const holder = (await getDatabaseHolders(ntMsgDbPath(root, account))).find((candidate) => isQqProcessName(candidate.name));
			states.push({
				...account,
				pid: holder?.pid ?? null
			});
		}
	}
	return states;
}
async function detectAccountLoginsForPids(pids) {
	return detectAccountLogins([...new Set(pids.flatMap((pid) => qqDataRootsForPid(pid)))]);
}
async function detectUinForPid(pid) {
	return (await detectAccountLoginsForPids([pid])).find((account) => account.pid === pid)?.uin ?? null;
}
export {};
