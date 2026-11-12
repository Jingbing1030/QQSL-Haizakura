// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../common/src/single-flight-cache.ts"
// original bundle lines 74150-74209  (58 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var SingleFlightCache = class {
	ttlMs;
	load;
	shouldCache;
	now;
	fresh = /* @__PURE__ */ new Map();
	inflight = /* @__PURE__ */ new Map();
	constructor(opts) {
		this.ttlMs = opts.ttlMs;
		this.load = opts.load;
		this.shouldCache = opts.shouldCache ?? (() => true);
		this.now = opts.now ?? Date.now;
	}
	/**
	* Get the value for `key`.
	*
	* - Returns a fresh cached value when the last load was within `ttlMs`.
	* - Otherwise de-dupes concurrent callers onto a single `load()` and caches
	*   the result (subject to `shouldCache`). A rejected `load` propagates to
	*   every joined caller, clears the in-flight slot, and is not cached.
	* - `force` bypasses the freshness check but still joins an in-flight load
	*   rather than starting a second one.
	*/
	get(key, opts = {}) {
		if (!opts.force) {
			const hit = this.fresh.get(key);
			if (hit && this.now() - hit.at < this.ttlMs) return Promise.resolve(hit.value);
		}
		const existing = this.inflight.get(key);
		if (existing) return existing;
		const load = async () => {
			const value = await this.load(key);
			if (this.inflight.get(key) === task && this.shouldCache(value)) this.fresh.set(key, {
				at: this.now(),
				value
			});
			return value;
		};
		const task = load().finally(() => {
			if (this.inflight.get(key) === task) this.inflight.delete(key);
		});
		this.inflight.set(key, task);
		return task;
	}
	/** Detach the entry and its pending load; existing callers still settle. */
	invalidate(key) {
		this.fresh.delete(key);
		this.inflight.delete(key);
	}
	/** Detach all entries and pending loads without aborting existing callers. */
	clear() {
		this.fresh.clear();
		this.inflight.clear();
	}
};
function createSingleFlightCache(opts) {
	return new SingleFlightCache(opts);
}
export {};
