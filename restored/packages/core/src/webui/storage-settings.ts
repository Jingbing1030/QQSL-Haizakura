init_coerce();
init_runtime();
var StorageSettingsInputError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "StorageSettingsInputError";
	}
};
var StorageSettingsLockedError = class extends Error {
	fields;
	constructor(fields) {
		super(`settings are locked by environment variables: ${fields.join(", ")}`);
		this.fields = fields;
		this.name = "StorageSettingsLockedError";
	}
};
var StorageSettingsTransactionError = class extends Error {
	operationError;
	rollbackErrors;
	constructor(message, operationError, rollbackErrors) {
		super(message, { cause: operationError });
		this.operationError = operationError;
		this.rollbackErrors = rollbackErrors;
		this.name = "StorageSettingsTransactionError";
	}
};
var SETTINGS_FIELDS = [
	"logMaxTotalMb",
	"logRetainDays",
	"logPerUin"
];
var SETTINGS_FIELD_SET = new Set(SETTINGS_FIELDS);
var LogStorageSettingsManager = class {
	deps;
	updateQueue = Promise.resolve();
	constructor(deps) {
		this.deps = deps;
	}
	read() {
		return settingsState(this.deps.readPersisted(), this.deps.readEnvOverrides(), settingsFromStatus(this.deps.readEffective()));
	}
	update(body) {
		const operation = this.updateQueue.then(() => this.performUpdate(body));
		this.updateQueue = operation.then(() => void 0, () => void 0);
		return operation;
	}
	async performUpdate(body) {
		const patch = coerceLogStorageSettingsPatch(body);
		const previousRuntime = this.deps.readPersisted();
		const envOverrides = this.deps.readEnvOverrides();
		const previous = settingsState(previousRuntime, envOverrides, settingsFromStatus(this.deps.readEffective()));
		const locked = SETTINGS_FIELDS.filter((field) => field in patch && field in envOverrides);
		if (locked.length > 0) throw new StorageSettingsLockedError(locked);
		const nextSaved = {
			...previous.saved,
			...patch
		};
		const nextEffective = {
			...previous.effective,
			...patch
		};
		const previousPolicy = toPolicy(previous.effective);
		const nextPolicy = toPolicy(nextEffective);
		let status;
		try {
			status = await this.deps.apply(nextPolicy);
			assertApplied(status, nextPolicy);
		} catch (error) {
			const rollbackErrors = await this.rollbackRuntime(previousPolicy);
			throw new StorageSettingsTransactionError(rollbackErrors.length > 0 ? "failed to apply log settings and runtime rollback was incomplete" : "failed to apply log settings; runtime state was rolled back", error, rollbackErrors);
		}
		let persistedRuntime;
		try {
			persistedRuntime = this.deps.persist(patch);
			assertPersistedSettings(persistedRuntime, nextSaved);
		} catch (error) {
			const rollbackErrors = await this.rollbackAll(previousPolicy, previousRuntime);
			throw new StorageSettingsTransactionError(rollbackErrors.length > 0 ? "failed to persist log settings and rollback was incomplete" : "failed to persist log settings; previous settings were restored", error, rollbackErrors);
		}
		return {
			settings: settingsState(persistedRuntime, envOverrides, settingsFromStatus(status)),
			status: publicLogStorageStatus(status)
		};
	}
	async rollbackRuntime(policy) {
		try {
			assertApplied(await this.deps.apply(policy), policy);
			return [];
		} catch (error) {
			return [error];
		}
	}
	async rollbackAll(policy, runtime) {
		const errors = await this.rollbackRuntime(policy);
		try {
			this.deps.persist(runtime);
		} catch (error) {
			errors.push(error);
		}
		return errors;
	}
};
function coerceLogStorageSettingsPatch(body) {
	if (!isObject$5(body)) throw new StorageSettingsInputError("body must be an object");
	const keys = Object.keys(body);
	if (keys.length === 0) throw new StorageSettingsInputError("at least one setting is required");
	const unknown = keys.filter((key) => !SETTINGS_FIELD_SET.has(key));
	if (unknown.length > 0) throw new StorageSettingsInputError(`unknown setting: ${unknown.join(", ")}`);
	const patch = {};
	if ("logMaxTotalMb" in body) {
		const value = body.logMaxTotalMb;
		if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_LOG_TOTAL_MB) throw new StorageSettingsInputError(`logMaxTotalMb must be an integer in 1..${MAX_LOG_TOTAL_MB}`);
		patch.logMaxTotalMb = value;
	}
	if ("logRetainDays" in body) {
		const value = body.logRetainDays;
		if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_LOG_RETAIN_DAYS) throw new StorageSettingsInputError(`logRetainDays must be an integer in 0..${MAX_LOG_RETAIN_DAYS}`);
		patch.logRetainDays = value;
	}
	if ("logPerUin" in body) {
		if (typeof body.logPerUin !== "boolean") throw new StorageSettingsInputError("logPerUin must be a boolean");
		patch.logPerUin = body.logPerUin;
	}
	return patch;
}
function settingsState(runtime, envOverrides, liveEffective) {
	const saved = settingsFromRuntime(runtime);
	const envOverridesList = SETTINGS_FIELDS.filter((field) => field in envOverrides);
	return {
		saved,
		effective: liveEffective ?? {
			...saved,
			...settingsPatchFromRuntime(envOverrides)
		},
		envOverrides: envOverridesList
	};
}
function settingsFromStatus(status) {
	const maxTotalMb = status.maxTotalBytes / (1024 * 1024);
	if (!Number.isSafeInteger(maxTotalMb)) throw new Error("live log storage limit is not an integer number of megabytes");
	return {
		logMaxTotalMb: maxTotalMb,
		logRetainDays: status.retainDays,
		logPerUin: status.perUinEnabled
	};
}
function settingsFromRuntime(runtime) {
	return {
		logMaxTotalMb: runtime.logMaxTotalMb ?? 1024,
		logRetainDays: runtime.logRetainDays ?? 7,
		logPerUin: runtime.logPerUin ?? false
	};
}
function settingsPatchFromRuntime(runtime) {
	const patch = {};
	if (runtime.logMaxTotalMb !== void 0) patch.logMaxTotalMb = runtime.logMaxTotalMb;
	if (runtime.logRetainDays !== void 0) patch.logRetainDays = runtime.logRetainDays;
	if (runtime.logPerUin !== void 0) patch.logPerUin = runtime.logPerUin;
	return patch;
}
function toPolicy(settings) {
	return {
		maxTotalMb: settings.logMaxTotalMb,
		retainDays: settings.logRetainDays,
		perUinEnabled: settings.logPerUin
	};
}
function assertApplied(status, policy) {
	const expectedBytes = policy.maxTotalMb * 1024 * 1024;
	if (status.state === "warning" || status.state === "degraded" || status.lastError !== void 0 || status.maxTotalBytes !== expectedBytes || status.retainDays !== policy.retainDays || status.perUinEnabled !== policy.perUinEnabled) throw new Error(status.lastError ?? "log storage policy did not become effective");
}
function assertPersistedSettings(runtime, expected) {
	const actual = settingsFromRuntime(runtime);
	if (actual.logMaxTotalMb !== expected.logMaxTotalMb || actual.logRetainDays !== expected.logRetainDays || actual.logPerUin !== expected.logPerUin) throw new Error("persisted log storage settings do not match the requested values");
}
