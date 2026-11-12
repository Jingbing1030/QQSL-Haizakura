// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/manager.ts"
// original bundle lines 343242-343656  (413 lines) of dist/index.mjs
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
var log$19 = createLogger("OneBot");
var InstanceLifecycleError = class extends Error {
	instance;
	rootCause;
	constructor(instance, rootCause) {
		super(rootCause instanceof Error ? rootCause.message : String(rootCause));
		this.instance = instance;
		this.rootCause = rootCause;
		this.name = "InstanceLifecycleError";
	}
};
/** A peer that never finishes a close handshake must not keep the next
*  account session offline. Ten seconds covers a normal drain.
*  SNOWLUMA_SESSION_RELEASE_DEADLINE_MS overrides the configured value. */
var DEFAULT_SESSION_RELEASE_DEADLINE_MS = 1e4;
var SESSION_RELEASE_DEADLINE_ENV = "SNOWLUMA_SESSION_RELEASE_DEADLINE_MS";
var MAX_SESSION_RELEASE_DEADLINE_MS = 2147483647;
/** Positive integer milliseconds, or `undefined` when the raw value is absent
*  or not usable. Callers decide the fallback. */
function parseSessionReleaseDeadlineMs(raw) {
	if (raw === void 0) return;
	const value = raw.trim();
	if (!/^[1-9]\d*$/.test(value)) return;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed > MAX_SESSION_RELEASE_DEADLINE_MS) return;
	return parsed;
}
/** Env wins over an explicit deadline. An unusable env value is ignored. */
function resolveSessionReleaseDeadlineMs(configured, envRaw) {
	const fromEnv = parseSessionReleaseDeadlineMs(envRaw);
	if (fromEnv !== void 0) return fromEnv;
	if (configured !== void 0 && Number.isSafeInteger(configured) && configured > 0 && configured <= MAX_SESSION_RELEASE_DEADLINE_MS) return configured;
	return DEFAULT_SESSION_RELEASE_DEADLINE_MS;
}
var OneBotManager = class {
	instances = /* @__PURE__ */ new Map();
	pendingLifecycle = /* @__PURE__ */ new Set();
	retiringInstances = /* @__PURE__ */ new Set();
	lifecycleFailures = [];
	pendingStarts = /* @__PURE__ */ new Map();
	databaseMigrations = /* @__PURE__ */ new Map();
	createDatabaseMigrationTask;
	createInstance;
	disposePromise = null;
	disposed = false;
	unsubscribeSessions = null;
	sessionReleaseDeadlineMs;
	constructor(options = {}) {
		setVideoUploadConcurrency(loadGlobalSettings().videoUploadConcurrency ?? 1);
		const envRaw = process.env[SESSION_RELEASE_DEADLINE_ENV];
		if (envRaw !== void 0 && envRaw.trim() && parseSessionReleaseDeadlineMs(envRaw) === void 0) log$19.warn("%s=%j is ignored; expected a positive integer number of milliseconds", SESSION_RELEASE_DEADLINE_ENV, envRaw);
		this.sessionReleaseDeadlineMs = resolveSessionReleaseDeadlineMs(options.sessionReleaseDeadlineMs, envRaw);
		this.createDatabaseMigrationTask = options.createDatabaseMigrationTask ?? createMessageStoreMigrationTask;
		this.createInstance = options.createInstance ?? ((uin, bridge, config, globalSettings) => new OneBotInstance(uin, bridge, config, globalSettings));
	}
	bind(bridgeManager) {
		if (this.disposed) return;
		this.unsubscribeSessions?.();
		this.unsubscribeSessions = bridgeManager.subscribeSessions({
			started: (uin, bridge) => {
				runWithoutRequestContext(() => this.onSessionStarted(uin, bridge));
			},
			closed: (uin) => this.onSessionClosed(uin)
		});
	}
	getInstance(uin) {
		return this.instances.get(uin) ?? null;
	}
	getInstances() {
		return [...this.instances.values()];
	}
	/** Live OneBot adapter status for active accounts plus failed retiring
	*  generations. A zombie that still owns a port must remain observable. */
	getConnectionStatuses() {
		const connections = [.../* @__PURE__ */ new Set([...this.instances.values(), ...this.retiringInstances])].map((instance) => {
			const migration = this.databaseMigrations.get(instance.uin);
			return {
				uin: instance.uin,
				nickname: instance.nickname,
				adapters: instance.getConnectionStatuses(),
				...migration ? { databaseMigration: migration.state } : {}
			};
		});
		const activeUins = new Set(this.instances.keys());
		for (const [uin, migration] of this.databaseMigrations) {
			if (activeUins.has(uin)) continue;
			connections.push({
				uin,
				nickname: migration.bridge.identity?.nickname || uin,
				adapters: [],
				databaseMigration: migration.state
			});
		}
		return connections;
	}
	async reloadConfig(uin, config) {
		const instance = this.instances.get(uin);
		if (!instance) return {
			online: false,
			applied: false,
			errors: [],
			adapters: []
		};
		const result = await runWithoutRequestContext(() => instance.reloadConfig(config));
		if (result.applied) log$19.info("configuration applied: UIN=%s adapters=%d", uin, result.statuses.length);
		else log$19.warn("configuration saved but not fully applied: UIN=%s failures=%d", uin, result.errors.length);
		return {
			online: true,
			applied: result.applied,
			errors: result.errors,
			adapters: result.statuses
		};
	}
	/** Re-read global (all-accounts) settings from config/snowluma.json and push
	*  them to every live instance. Called after the WebUI saves global config. */
	reloadGlobalSettings() {
		const globalSettings = loadGlobalSettings();
		setVideoUploadConcurrency(globalSettings.videoUploadConcurrency ?? 1);
		for (const instance of this.instances.values()) instance.applyGlobalSettings(globalSettings);
		log$19.info("global settings reloaded for %d instance(s)", this.instances.size);
	}
	dispose() {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		this.unsubscribeSessions?.();
		this.unsubscribeSessions = null;
		const migrations = [...this.databaseMigrations.values()];
		this.databaseMigrations.clear();
		for (const migration of migrations) {
			if (migration.retryTimer) clearTimeout(migration.retryTimer);
			migration.task.cancel();
		}
		for (const instance of this.instances.values()) this.retiringInstances.add(instance);
		for (const instance of this.retiringInstances) instance.quiesce();
		this.instances.clear();
		const attempt = (async () => {
			await Promise.all(this.pendingLifecycle);
			let failures = this.lifecycleFailures.splice(0);
			const targets = [...this.retiringInstances];
			const settled = await Promise.allSettled(targets.map((instance) => instance.dispose()));
			for (let index = 0; index < settled.length; index += 1) {
				const instance = targets[index];
				const result = settled[index];
				const shutdownLabel = `network shutdown UIN=${instance.uin}`;
				if (result.status === "rejected") {
					failures.push({
						label: shutdownLabel,
						error: result.reason,
						instances: /* @__PURE__ */ new Set([instance])
					});
					continue;
				}
				this.retirementSucceeded(instance);
				failures = failures.flatMap((failure) => {
					if (!failure.instances?.has(instance)) return [failure];
					const remaining = new Set(failure.instances);
					remaining.delete(instance);
					return remaining.size > 0 ? [{
						...failure,
						instances: remaining
					}] : [];
				});
			}
			if (failures.length > 0) throw new AggregateError(failures.map(({ label, error }) => /* @__PURE__ */ new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`)), "failed to dispose OneBot manager cleanly");
			this.pendingStarts.clear();
		})();
		this.disposePromise = attempt;
		attempt.then(() => void 0, () => {
			if (this.disposePromise === attempt) this.disposePromise = null;
		});
		return attempt;
	}
	onSessionStarted(uin, bridge) {
		if (this.disposed || this.instances.has(uin) || this.pendingStarts.has(uin)) return;
		const retiring = [...this.retiringInstances].filter((instance) => instance.uin === uin);
		if (retiring.length > 0) {
			const pending = { bridge };
			this.pendingStarts.set(uin, pending);
			this.trackLifecycle(`session handoff UIN=${uin}`, this.finishRetiringBeforeStart(uin, pending, retiring));
			return;
		}
		this.prepareDatabase(uin, bridge);
	}
	prepareDatabase(uin, bridge) {
		if (this.disposed || this.instances.has(uin) || this.databaseMigrations.has(uin)) return;
		const migration = {
			bridge,
			task: this.createDatabaseMigrationTask(uin),
			state: preparingMigrationState(),
			rowsPerSecond: null,
			retryTimer: null
		};
		this.databaseMigrations.set(uin, migration);
		const startTask = () => {
			const task = migration.task;
			const isCurrent = () => this.databaseMigrations.get(uin) === migration && migration.task === task && migration.state.phase !== "failed" && migration.state.phase !== "complete";
			const handleFailure = (error, stage = "database migration") => {
				if (!isCurrent()) return;
				const retryable = !(error instanceof OneBotConfigValidationError);
				const detail = error instanceof Error ? error.message : String(error);
				const label = stage === "session startup" ? "账号启动失败" : "数据库迁移失败";
				migration.state = {
					...migration.state,
					phase: "failed",
					estimatedRemainingSeconds: null,
					error: `${label}：${detail}${retryable ? "；将自动重试" : "；请修正配置后重启"}`
				};
				log$19.error("%s failed: UIN=%s retryable=%s error=%s", stage, uin, retryable, error instanceof Error ? error.stack ?? error.message : String(error));
				task.cancel();
				if (!retryable || migration.retryTimer) return;
				migration.retryTimer = setTimeout(() => {
					migration.retryTimer = null;
					if (this.databaseMigrations.get(uin) !== migration) return;
					migration.task = this.createDatabaseMigrationTask(uin);
					migration.state = migration.state.usable ? {
						...migration.state,
						phase: "migrating",
						usable: true,
						error: void 0
					} : preparingMigrationState();
					startTask();
				}, 5e3);
				migration.retryTimer.unref();
			};
			try {
				task.start({
					onReady: () => {
						if (!isCurrent()) return;
						try {
							this.startSession(uin, bridge);
						} catch (error) {
							handleFailure(error, "session startup");
							return;
						}
						migration.state = {
							...migration.state,
							phase: "migrating",
							usable: true,
							error: void 0
						};
						try {
							task.beginMigration();
						} catch (error) {
							handleFailure(error);
						}
					},
					onProgress: (status, elapsedMs) => {
						if (!isCurrent()) return;
						const previousProcessed = migration.state.processed;
						const processedDelta = Math.max(0, status.processed - previousProcessed);
						if (processedDelta > 0 && elapsedMs > 0) {
							const observed = processedDelta / (elapsedMs / 1e3);
							migration.rowsPerSecond = migration.rowsPerSecond === null ? observed : migration.rowsPerSecond * .7 + observed * .3;
						}
						migration.state = migrationPublicState(status, migration.rowsPerSecond);
						if (status.phase === "complete") task.cancel();
					},
					onFailed: handleFailure
				});
			} catch (error) {
				handleFailure(error);
			}
		};
		startTask();
	}
	startSession(uin, bridge) {
		if (this.disposed || this.instances.has(uin)) return;
		const config = loadOneBotConfig(uin, { persistDefaults: true });
		const instance = this.createInstance(uin, bridge, config, loadGlobalSettings());
		const activePid = bridge.activePid;
		if (activePid !== null) instance.addPid(activePid);
		if (!bridge.identity.nickname) bridge.identity.nickname = uin;
		this.instances.set(uin, instance);
		log$19.info("session started: UIN=%s", uin);
		this.trackLifecycle(`network startup UIN=${uin}`, instance.waitUntilNetworkReady().then(async (result) => {
			if (result.applied) log$19.info("network startup applied: UIN=%s adapters=%d", uin, result.statuses.length);
			else log$19.warn("network startup degraded: UIN=%s failures=%d", uin, result.errors.length);
			if (this.disposed || this.instances.get(uin) !== instance) return;
			try {
				await instance.emitBotStatus("online");
			} catch (error) {
				log$19.warn("bot_status online failed: UIN=%s: %s", uin, error instanceof Error ? error.stack ?? error.message : String(error));
			}
		}));
		this.armLoginHistorySync(uin, instance, bridge);
	}
	async armLoginHistorySync(uin, instance, bridge) {
		let warmup;
		try {
			warmup = await bridge.whenRosterWarmupSettled();
		} catch (err) {
			log$19.warn("warmup error for UIN %s: %s", uin, err instanceof Error ? err.stack ?? err.message : String(err));
			return;
		}
		if (this.disposed || this.instances.get(uin) !== instance) return;
		if (warmup.friendsLoaded && warmup.groupsLoaded) {
			instance.startLoginHistorySync();
			return;
		}
		log$19.warn("login history sync skipped because roster warmup was incomplete: UIN=%s friendsLoaded=%s groupsLoaded=%s", uin, String(warmup.friendsLoaded), String(warmup.groupsLoaded));
	}
	onSessionClosed(uin) {
		if (this.disposed) return;
		const migration = this.databaseMigrations.get(uin);
		if (migration) {
			this.databaseMigrations.delete(uin);
			if (migration.retryTimer) clearTimeout(migration.retryTimer);
			migration.task.cancel();
		}
		const instance = this.instances.get(uin);
		if (!instance) {
			this.pendingStarts.delete(uin);
			return;
		}
		this.instances.delete(uin);
		this.retiringInstances.add(instance);
		this.trackLifecycle(`network shutdown UIN=${uin}`, this.emitOfflineThenDispose(instance), [instance]);
		log$19.info("session closed: UIN=%s", uin);
	}
	async emitOfflineThenDispose(instance) {
		try {
			await instance.emitBotStatus("offline");
		} catch (error) {
			log$19.warn("bot_status offline failed: UIN=%s: %s", instance.uin, error instanceof Error ? error.stack ?? error.message : String(error));
		}
		const result = await instance.dispose();
		this.retirementSucceeded(instance);
		return result;
	}
	async releaseRetiringInstance(uin, pending, instance) {
		let timer;
		const timeout = new Promise((resolve) => {
			timer = setTimeout(() => resolve("timeout"), this.sessionReleaseDeadlineMs);
			timer.unref();
		});
		const releasing = instance.dispose().then(() => "released", (error) => ({ failed: error }));
		try {
			const outcome = await Promise.race([releasing, timeout]);
			if (outcome === "timeout") {
				log$19.error("session release timed out; forcing adapters closed and starting the replacement: UIN=%s", uin);
				try {
					instance.forceRelease();
				} catch (error) {
					log$19.error("forced session release failed: UIN=%s: %s", uin, error instanceof Error ? error.message : String(error));
				}
				return;
			}
			if (typeof outcome === "object") {
				if (this.pendingStarts.get(uin) === pending) this.pendingStarts.delete(uin);
				throw new InstanceLifecycleError(instance, outcome.failed);
			}
		} finally {
			if (timer) clearTimeout(timer);
		}
	}
	async finishRetiringBeforeStart(uin, pending, retiring) {
		for (const instance of retiring) {
			await this.releaseRetiringInstance(uin, pending, instance);
			this.retirementSucceeded(instance);
		}
		if (this.pendingStarts.get(uin) !== pending) return;
		this.pendingStarts.delete(uin);
		if (this.disposed) return;
		this.prepareDatabase(uin, pending.bridge);
	}
	trackLifecycle(label, operation, instances) {
		const tracked = operation.then(() => void 0, (error) => {
			const rootCause = error instanceof InstanceLifecycleError ? error.rootCause : error;
			const relatedInstances = error instanceof InstanceLifecycleError ? [error.instance] : instances;
			log$19.error("%s failed: %s", label, rootCause instanceof Error ? rootCause.stack ?? rootCause.message : String(rootCause));
			this.lifecycleFailures.push({
				label,
				error: rootCause,
				...relatedInstances && relatedInstances.length > 0 ? { instances: new Set(relatedInstances) } : {}
			});
		});
		this.pendingLifecycle.add(tracked);
		tracked.then(() => {
			this.pendingLifecycle.delete(tracked);
		});
	}
	retirementSucceeded(instance) {
		this.retiringInstances.delete(instance);
		for (let index = this.lifecycleFailures.length - 1; index >= 0; index -= 1) {
			const failure = this.lifecycleFailures[index];
			if (!failure.instances?.has(instance)) continue;
			failure.instances.delete(instance);
			if (failure.instances.size === 0) this.lifecycleFailures.splice(index, 1);
		}
	}
};
function preparingMigrationState() {
	return {
		phase: "preparing",
		usable: false,
		processed: 0,
		total: null,
		progress: null,
		estimatedRemainingSeconds: null
	};
}
function migrationPublicState(status, rowsPerSecond) {
	const progress = status.total === 0 ? 1 : Math.min(1, status.processed / status.total);
	return {
		phase: status.phase,
		usable: true,
		processed: status.processed,
		total: status.total,
		progress,
		estimatedRemainingSeconds: estimateRemainingSeconds(status, rowsPerSecond)
	};
}
export {};
