// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/process-enumerator.ts"
// original bundle lines 4626-4670  (43 lines) of dist/index.mjs
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
function createProcessEnumerator(deps) {
	const log = deps.log ?? createLogger("ProcessEnumerator");
	const timeoutMs = deps.timeoutMs ?? 4e3;
	let disposed = false;
	let pending = null;
	return {
		enumerate() {
			if (disposed) return Promise.resolve(null);
			if (pending) return pending.promise;
			let resolve;
			const promise = new Promise((done) => {
				resolve = done;
			});
			const settle = (result) => {
				clearTimeout(timer);
				resolve(result);
			};
			const timer = setTimeout(() => {
				log.warn("process enumeration timed out after %dms; keeping prior process set", timeoutMs);
				settle(null);
			}, timeoutMs);
			pending = {
				promise,
				settle
			};
			Promise.resolve().then(() => disposed ? null : deps.listProcesses()).then((processes) => {
				pending = null;
				settle(disposed ? null : processes);
			}, (error) => {
				pending = null;
				log.warn("process enumeration failed: %s", errorMessage(error));
				settle(null);
			});
			return promise;
		},
		dispose() {
			disposed = true;
			pending?.settle(null);
		}
	};
}
export {};
