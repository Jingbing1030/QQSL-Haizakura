// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/message-store-migration-task.ts"
// original bundle lines 343174-343241  (66 lines) of dist/index.mjs
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
function createMessageStoreMigrationTask(uin, createWorker = (filename, options) => new Worker(filename, options)) {
	const log = createLogger("OneBot.MessageMigration").child({ uin: Number(uin) });
	let worker = null;
	let cancelled = false;
	let finished = false;
	let failureReported = false;
	return {
		start(callbacks) {
			const reportFailure = (error) => {
				if (cancelled || failureReported) return;
				failureReported = true;
				callbacks.onFailed(error);
			};
			const data = {
				kind: MESSAGE_STORE_WORKER_KIND,
				dbPath: path.join("data", uin, "messages.db")
			};
			const entryPath = process.argv[1];
			const sourceEntry = /\.(?:cts|mts|ts|tsx)$/.test(entryPath);
			worker = createWorker(sourceEntry ? sourceWorkerBootstrap(entryPath) : entryPath, {
				workerData: data,
				eval: sourceEntry,
				execArgv: sourceEntry ? [] : process.execArgv
			});
			worker.on("message", (message) => {
				if (cancelled) return;
				if (message.kind === "ready") callbacks.onReady();
				else if (message.kind === "preparation") {
					const progress = message.progress;
					if (progress.stage === "started") log.info("preparing message history migration");
					else if (progress.stage === "indexed") log.info("message history migration preparation finished in %dms", Math.round(progress.elapsedMs));
					else log.info("message history migration: pending=%d checked in %dms", progress.total, Math.round(progress.elapsedMs));
				} else if (message.kind === "progress") {
					callbacks.onProgress(message.status, message.elapsedMs);
					if (message.status.phase === "complete") finished = true;
				} else reportFailure(new Error(message.message));
			});
			worker.once("error", reportFailure);
			worker.once("exit", (code) => {
				if (!cancelled && !finished) reportFailure(/* @__PURE__ */ new Error(`database migration worker exited before completion with code ${code}`));
			});
		},
		beginMigration() {
			if (!cancelled) worker?.postMessage("start");
		},
		cancel() {
			cancelled = true;
			worker?.postMessage("cancel");
			worker?.unref();
		}
	};
}
function sourceWorkerBootstrap(entryPath) {
	const require = createRequire(path.resolve(entryPath));
	return [
		`const { register } = require(${JSON.stringify(require.resolve("tsx/esm/api"))});`,
		"register();",
		`import(${JSON.stringify(path.resolve(entryPath))});`
	].join("\n");
}
function estimateRemainingSeconds(status, recentRowsPerSecond) {
	if (status.phase === "complete") return 0;
	if (!recentRowsPerSecond || recentRowsPerSecond <= 0) return null;
	return Math.max(0, Math.ceil((status.total - status.processed) / recentRowsPerSecond));
}
export {};
