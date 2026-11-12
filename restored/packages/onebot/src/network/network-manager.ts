// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/network/network-manager.ts"
// original bundle lines 341742-342078  (335 lines) of dist/index.mjs
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
init_errors();
var log$21 = createLogger("OneBot.Network");
/**
* Single owner of the configured network topology.
*
* Configs are first compiled into a globally-name-unique desired plan. Every
* startup/reload/shutdown operation then runs through one FIFO, so a reload can
* never race another reload or teardown. Runtime failures are isolated per
* adapter and returned as data; deterministic plan errors throw before the
* operation is queued.
*/
var OneBotNetworkManager = class {
	adapters = /* @__PURE__ */ new Map();
	factory;
	operationTail = Promise.resolve();
	accepting = true;
	inFlightEmits = /* @__PURE__ */ new Set();
	shutdownPromise = null;
	/** Debug-stream taps — notified for every emitted event regardless of adapter
	*  state. Attached on-demand (ref-counted) by the WebUI debug stream. */
	debugSubscribers = /* @__PURE__ */ new Set();
	constructor(factory) {
		this.factory = factory ?? null;
	}
	subscribeDebug(cb) {
		this.debugSubscribers.add(cb);
		return () => {
			this.debugSubscribers.delete(cb);
		};
	}
	/** Test/embedding seam for pre-built adapters. Production topology changes
	*  go through reconcile(), which refuses duplicate names. */
	register(adapter) {
		if (!this.accepting) throw new Error("network manager is shutting down");
		if (this.adapters.has(adapter.name)) throw new Error(`network adapter name already registered: ${adapter.name}`);
		const kind = adapter.describeStatus().kind;
		this.adapters.set(adapter.name, {
			kind,
			adapter
		});
	}
	has(name) {
		return this.adapters.has(name);
	}
	get(name) {
		return this.adapters.get(name)?.adapter ?? null;
	}
	list() {
		return [...this.adapters.values()].map((entry) => entry.adapter);
	}
	/** Live status of every registered adapter, including desired/live apply
	*  failures even when an older binding was restored and remains active. */
	describeStatuses() {
		return this.list().map((adapter) => adapter.describeManagedStatus());
	}
	hasActiveAdapters() {
		for (const { adapter } of this.adapters.values()) if (adapter.isActive) return true;
		return false;
	}
	/** Compile and validate outside the queue: deterministic errors never wait
	*  behind network I/O and can be rejected before a WebUI save. */
	compileDesiredPlan(config) {
		assertValidOneBotConfig(config);
		return [
			...config.networks.httpServers.map((network) => ({
				name: network.name,
				kind: "httpServer",
				config: structuredClone(network)
			})),
			...config.networks.httpClients.map((network) => ({
				name: network.name,
				kind: "httpClient",
				config: structuredClone(network)
			})),
			...config.networks.wsServers.map((network) => ({
				name: network.name,
				kind: "wsServer",
				config: structuredClone(network)
			})),
			...config.networks.wsClients.map((network) => ({
				name: network.name,
				kind: "wsClient",
				config: structuredClone(network)
			}))
		];
	}
	reconcile(config) {
		const desired = this.compileDesiredPlan(config);
		if (!this.accepting) return Promise.reject(/* @__PURE__ */ new Error("network manager is shutting down"));
		return this.enqueue(() => this.reconcileNow(desired));
	}
	/** Open registered adapters in order and report each failure. */
	openAll() {
		if (!this.accepting) return Promise.reject(/* @__PURE__ */ new Error("network manager is shutting down"));
		return this.enqueue(async () => {
			const errors = [];
			for (const entry of this.adapters.values()) try {
				await entry.adapter.open();
				entry.adapter.clearApplyFailure();
			} catch (error) {
				entry.adapter.markApplyFailure(error);
				errors.push(this.report(entry.adapter.name, entry.kind, "open", error));
			}
			return this.result(errors);
		});
	}
	closeOne(name) {
		if (!this.accepting) return Promise.reject(/* @__PURE__ */ new Error("network manager is shutting down"));
		return this.enqueue(async () => {
			const entry = this.adapters.get(name);
			if (!entry) return;
			await entry.adapter.close();
			this.adapters.delete(name);
		});
	}
	/** Ordered, idempotent shutdown. Reconcile calls made before shutdown finish
	*  first; calls made after shutdown is requested fail immediately. */
	shutdown() {
		if (this.shutdownPromise) return this.shutdownPromise;
		this.accepting = false;
		const attempt = this.enqueue(async () => {
			const errors = [];
			const dispatches = await Promise.allSettled([...this.inFlightEmits]);
			for (const dispatch of dispatches) if (dispatch.status === "rejected") log$21.error("in-flight event dispatch failed during shutdown: %s", errorMessage(dispatch.reason));
			const entries = [...this.adapters.entries()].reverse();
			for (const [name, entry] of entries) try {
				await entry.adapter.close();
				this.adapters.delete(name);
			} catch (error) {
				entry.adapter.markApplyFailure(error);
				errors.push(this.report(name, entry.kind, "shutdown", error));
			}
			this.debugSubscribers.clear();
			return {
				closed: errors.length === 0,
				errors
			};
		});
		this.shutdownPromise = attempt;
		attempt.then((result) => {
			if (!result.closed) this.shutdownPromise = null;
		}, () => {
			this.shutdownPromise = null;
		});
		return attempt;
	}
	/** Best-effort immediate release. Does not wait for the operation queue,
	*  in-flight dispatches, or peer close handshakes. */
	forceRelease() {
		this.accepting = false;
		for (const { adapter } of this.adapters.values()) try {
			adapter.forceClose();
		} catch (error) {
			log$21.error("forced adapter release failed: %s", errorMessage(error));
		}
	}
	emitEvent(event) {
		if (!this.accepting) return Promise.reject(/* @__PURE__ */ new Error("network manager is shutting down; event dispatch rejected"));
		const operation = this.emitEventNow(event);
		this.inFlightEmits.add(operation);
		operation.then(() => {
			this.inFlightEmits.delete(operation);
		}, () => {
			this.inFlightEmits.delete(operation);
		});
		return operation;
	}
	async emitEventNow(event) {
		if (this.debugSubscribers.size) for (const cb of this.debugSubscribers) try {
			cb(event);
		} catch (error) {
			log$21.warn("debug subscriber error: %s", errorMessage(error));
		}
		const active = [...this.adapters.values()].map(({ adapter }) => adapter).filter((adapter) => adapter.isActive);
		if (active.length === 0) {
			log$21.trace("report_terminal outcome=no_active_targets");
			return;
		}
		log$21.trace(() => ["report_targets targets=%s", JSON.stringify(active.map((adapter) => adapter.name))]);
		const payload = buildDispatchPayload(event);
		const tasks = active.map((adapter) => Promise.resolve().then(() => adapter.onEvent(event, payload)).catch((error) => {
			log$21.warn("adapter [%s] onEvent error: %s", adapter.name, errorMessage(error));
			log$21.trace(() => [
				"report_target_failed target=%s error=%s",
				adapter.name,
				error instanceof Error ? error.stack ?? error.message : String(error)
			]);
		}));
		await Promise.allSettled(tasks);
		log$21.trace("report_terminal outcome=settled");
	}
	async reconcileNow(desired) {
		const errors = [];
		const desiredByName = new Map(desired.map((entry) => [entry.name, entry]));
		for (const [name, live] of [...this.adapters]) {
			if (desiredByName.has(name)) continue;
			try {
				await live.adapter.close();
				this.adapters.delete(name);
			} catch (error) {
				live.adapter.markApplyFailure(error);
				errors.push(this.report(name, live.kind, "close", error));
			}
		}
		for (const next of desired) {
			const live = this.adapters.get(next.name);
			if (!live) await this.createAndOpen(next, errors);
			else if (live.kind === next.kind) await this.reloadSameKind(live, next, errors);
			else await this.replaceKind(live, next, errors);
		}
		return this.result(errors);
	}
	async createAndOpen(next, errors) {
		let adapter;
		try {
			adapter = this.create(next);
		} catch (error) {
			errors.push(this.report(next.name, next.kind, "open", error));
			return;
		}
		this.adapters.set(next.name, {
			kind: next.kind,
			adapter
		});
		try {
			await adapter.open();
			adapter.clearApplyFailure();
		} catch (error) {
			adapter.markApplyFailure(error);
			errors.push(this.report(next.name, next.kind, "open", error));
		}
	}
	async reloadSameKind(live, next, errors) {
		const previous = structuredClone(live.adapter.currentConfig);
		try {
			if (live.adapter.hasApplyFailure) await live.adapter.close();
			await live.adapter.reload(next.config);
			live.adapter.clearApplyFailure();
		} catch (error) {
			let restored = false;
			try {
				await live.adapter.reload(previous);
				restored = true;
			} catch (restoreError) {
				errors.push(this.report(next.name, live.kind, "restore", restoreError));
			}
			live.adapter.markApplyFailure(error);
			errors.push(this.report(next.name, next.kind, "reload", error, restored));
		}
	}
	async replaceKind(live, next, errors) {
		try {
			await live.adapter.close();
		} catch (error) {
			live.adapter.markApplyFailure(error);
			errors.push(this.report(next.name, live.kind, "replace", error));
			return;
		}
		let replacement;
		try {
			replacement = this.create(next);
		} catch (error) {
			let restored = false;
			try {
				await live.adapter.open();
				restored = true;
			} catch (restoreError) {
				errors.push(this.report(next.name, live.kind, "restore", restoreError));
			}
			live.adapter.markApplyFailure(error);
			errors.push(this.report(next.name, next.kind, "replace", error, restored));
			return;
		}
		this.adapters.set(next.name, {
			kind: next.kind,
			adapter: replacement
		});
		try {
			await replacement.open();
			replacement.clearApplyFailure();
			return;
		} catch (error) {
			try {
				await replacement.close();
			} catch (cleanupError) {
				replacement.markApplyFailure(error);
				errors.push(this.report(next.name, next.kind, "close", cleanupError));
				errors.push(this.report(next.name, next.kind, "replace", error, false));
				return;
			}
			let restored = false;
			try {
				await live.adapter.open();
				live.adapter.markApplyFailure(error);
				this.adapters.set(next.name, live);
				restored = true;
			} catch (restoreError) {
				replacement.markApplyFailure(error);
				errors.push(this.report(next.name, live.kind, "restore", restoreError));
			}
			errors.push(this.report(next.name, next.kind, "replace", error, restored));
		}
	}
	create(next) {
		if (!this.factory) throw new Error(`no network adapter factory configured for ${next.name}`);
		const adapter = this.factory(next);
		if (adapter.name !== next.name) throw new Error(`network adapter factory returned name ${adapter.name} for desired ${next.name}`);
		return adapter;
	}
	result(errors) {
		return {
			applied: errors.length === 0,
			errors,
			statuses: this.describeStatuses()
		};
	}
	report(name, kind, phase, error, restored) {
		const detail = {
			name,
			kind,
			phase,
			message: errorMessage(error),
			at: Date.now(),
			...restored === void 0 ? {} : { restored }
		};
		log$21.error("adapter [%s] kind=%s phase=%s failed%s: %s", name, kind, phase, restored === void 0 ? "" : ` restored=${String(restored)}`, detail.message);
		return detail;
	}
	enqueue(operation) {
		const result = this.operationTail.then(operation);
		this.operationTail = result.then(() => void 0, () => void 0);
		return result;
	}
};
export {};
