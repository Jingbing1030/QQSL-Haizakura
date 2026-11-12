// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/qq-account/watch.ts"
// original bundle lines 3640-3703  (62 lines) of dist/index.mjs
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
init_logger();
function watchAccountChangesForPids(pids, onChange, log = createLogger("QqAccount")) {
	const roots = /* @__PURE__ */ new Set();
	for (const pid of pids) try {
		for (const root of qqDataRootsForPid(pid)) roots.add(root);
	} catch (error) {
		log.warn("account watch root failed: PID=%d err=%s", pid, errorMessage(error));
	}
	return watchAccountFiles([...roots].flatMap(loginDbPaths), onChange, log);
}
/** Watch directories so replacing login.db or recreating its WAL keeps working. */
function watchAccountFiles(dbPaths, onChange, log = createLogger("QqAccount")) {
	const watchers = /* @__PURE__ */ new Map();
	let timer;
	const changed = () => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			timer = void 0;
			onChange();
		}, 250);
		timer.unref();
	};
	const observe = (dbPath) => {
		watchers.get(dbPath)?.close();
		watchers.delete(dbPath);
		const dbDirectory = path.dirname(dbPath);
		let directory = dbDirectory;
		for (;;) {
			const target = path.relative(directory, dbPath).split(path.sep)[0];
			try {
				const watcher = watch(directory, { persistent: false }, (_event, filename) => {
					if (watchers.get(dbPath) !== watcher || filename !== null && filename !== target && !(directory === dbDirectory && filename === `${target}-wal`)) return;
					if (directory !== dbDirectory) observe(dbPath);
					changed();
				});
				watcher.on("error", (error) => {
					if (watchers.get(dbPath) !== watcher) return;
					watcher.close();
					watchers.delete(dbPath);
					log.warn("account watch failed: path=%s err=%s", dbPath, errorMessage(error));
				});
				watchers.set(dbPath, watcher);
				return;
			} catch (error) {
				const parent = path.dirname(directory);
				if (error instanceof Error && "code" in error && error.code === "ENOENT" && parent !== directory) {
					directory = parent;
					continue;
				}
				log.warn("account watch failed: path=%s err=%s", dbPath, errorMessage(error));
				return;
			}
		}
	};
	for (const dbPath of new Set(dbPaths)) observe(dbPath);
	return () => {
		clearTimeout(timer);
		for (const watcher of watchers.values()) watcher.close();
		watchers.clear();
	};
}
export {};
