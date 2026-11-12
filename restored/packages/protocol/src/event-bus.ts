// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/event-bus.ts"
// original bundle lines 344731-344808  (76 lines) of dist/index.mjs
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
var DEFAULT_LOGGER = createLogger("Bridge.Events");
var BridgeEventBus = class {
	handlers = /* @__PURE__ */ new Map();
	anyHandlers = /* @__PURE__ */ new Set();
	onError;
	constructor(opts = {}) {
		if (opts.onError) this.onError = opts.onError;
		else {
			const log = opts.loggerName ? createLogger(opts.loggerName) : DEFAULT_LOGGER;
			this.onError = (kind, err) => {
				log.error("event handler error [%s]: %s", kind, err instanceof Error ? err.stack ?? err.message : String(err));
			};
		}
	}
	/** Each subscription owns its unsubscribe function. */
	on(kind, handler) {
		let set = this.handlers.get(kind);
		if (!set) {
			set = /* @__PURE__ */ new Set();
			this.handlers.set(kind, set);
		}
		const subscription = { handler };
		set.add(subscription);
		return () => {
			this.handlers.get(kind)?.delete(subscription);
		};
	}
	/** Subscribe to every kind (low-volume callers like loggers). */
	onAny(handler) {
		const subscription = { handler };
		this.anyHandlers.add(subscription);
		return () => {
			this.anyHandlers.delete(subscription);
		};
	}
	/** Remove every registration of this handler for the given kind. */
	off(kind, handler) {
		const subscriptions = this.handlers.get(kind);
		if (subscriptions) {
			for (const subscription of subscriptions) if (subscription.handler === handler) subscriptions.delete(subscription);
		}
	}
	has(kind) {
		return (this.handlers.get(kind)?.size ?? 0) + this.anyHandlers.size > 0;
	}
	/** Drop every subscriber. Mostly useful for tests. */
	clear() {
		this.handlers.clear();
		this.anyHandlers.clear();
	}
	/**
	* Dispatch an event in parallel to every subscriber for its kind plus every
	* onAny handler. Rejections are isolated per-handler — one bad subscriber
	* never blocks the others, and the returned promise resolves once every
	* subscriber settles. Subscription changes apply to the next event.
	*/
	async emit(event) {
		const kindHandlers = [...this.handlers.get(event.kind) ?? []];
		const anyHandlers = [...this.anyHandlers];
		const tasks = [];
		for (const { handler } of kindHandlers) {
			const typed = handler;
			tasks.push(invoke$1(this.onError, event.kind, () => typed(event)));
		}
		for (const { handler } of anyHandlers) tasks.push(invoke$1(this.onError, "*", () => handler(event)));
		await Promise.allSettled(tasks);
	}
};
async function invoke$1(onError, kind, fn) {
	try {
		await fn();
	} catch (err) {
		onError(kind, err);
	}
}
export {};
