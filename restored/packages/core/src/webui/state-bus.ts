init_logger();
var log$14 = createLogger("WebUI.State");
var StateBus = class {
	listeners = /* @__PURE__ */ new Set();
	disposed = false;
	/** Subscribe to every publish; returns an unsubscribe handle. Calling
	*  the handle more than once is a no-op. */
	subscribe(listener) {
		if (this.disposed) return () => void 0;
		this.listeners.add(listener);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			this.listeners.delete(listener);
		};
	}
	/** Notify every CURRENTLY-subscribed listener that `resource` is stale.
	*  Iterates a frozen snapshot of the subscriber set so add/remove during
	*  the emit don't change which listeners see THIS publish; subscriber
	*  exceptions are isolated and do not abort the fan-out. */
	publish(resource) {
		if (this.disposed) return;
		const snapshot = [...this.listeners];
		for (const fn of snapshot) try {
			fn(resource);
		} catch (error) {
			log$14.warn("state listener failed: resource=%s error=%s", resource, error instanceof Error ? error.message : String(error));
		}
	}
	/** Drop every subscriber and refuse future subscribes / publishes. */
	dispose() {
		this.disposed = true;
		this.listeners.clear();
	}
};
