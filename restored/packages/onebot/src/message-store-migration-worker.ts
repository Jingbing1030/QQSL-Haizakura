// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/message-store-migration-worker.ts"
// original bundle lines 343112-343173  (60 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var MESSAGE_STORE_WORKER_KIND = "snowluma-message-store-migration";
var DEFAULT_BATCH_SIZE = 200;
var DEFAULT_BATCH_PAUSE_MS = 25;
function isMessageStoreMigrationWorkerData(value = workerData) {
	if (value === null || typeof value !== "object") return false;
	const candidate = value;
	return candidate.kind === "snowluma-message-store-migration" && typeof candidate.dbPath === "string";
}
async function runMessageStoreMigrationWorker(data, port = parentPort) {
	if (!port) throw new Error("database migration worker port is unavailable");
	let migrator = null;
	let cancelled = false;
	let releaseStart;
	const startRequested = new Promise((resolve) => {
		releaseStart = resolve;
	});
	const handleControlMessage = (message) => {
		if (message === "cancel") cancelled = true;
		if (message === "start" || message === "cancel") releaseStart();
	};
	port.on("message", handleControlMessage);
	try {
		await prepareMessageStoreDatabase(data.dbPath);
		await migrateLegacyMedia(data.dbPath, () => cancelled);
		if (cancelled) return;
		port.postMessage({ kind: "ready" });
		await startRequested;
		if (cancelled) return;
		migrator = new MessageStoreMigrator(data.dbPath, (progress) => {
			port.postMessage({
				kind: "preparation",
				progress
			});
		});
		let lastProgressAt = null;
		while (!cancelled) {
			const status = await migrator.runBatch(DEFAULT_BATCH_SIZE);
			const progressAt = performance.now();
			port.postMessage({
				kind: "progress",
				status,
				elapsedMs: lastProgressAt === null ? 0 : Math.max(0, progressAt - lastProgressAt)
			});
			lastProgressAt = progressAt;
			if (status.phase === "complete") return;
			await pause(DEFAULT_BATCH_PAUSE_MS);
		}
	} catch (error) {
		port.postMessage({
			kind: "failed",
			message: error instanceof Error ? error.message : String(error)
		});
	} finally {
		port.off("message", handleControlMessage);
		await migrator?.close();
	}
}
function pause(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
export {};
