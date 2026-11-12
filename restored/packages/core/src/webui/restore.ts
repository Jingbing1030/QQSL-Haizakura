init_errors();
init_logger();
var log$10 = createLogger("WebUI.Restore");
var RestoreTransactionError = class extends Error {
	phase;
	transactionId;
	rollbackSucceeded;
	snapshotDir;
	committed;
	failedFiles;
	constructor(options) {
		super(options.message, { cause: options.cause });
		this.name = "RestoreTransactionError";
		this.phase = options.phase;
		this.transactionId = options.transactionId;
		this.rollbackSucceeded = options.rollbackSucceeded;
		this.snapshotDir = options.snapshotDir;
		this.committed = options.committed ?? false;
		this.failedFiles = options.failedFiles ?? [];
	}
};
/**
* Restore one validated overlay as a process-level transaction.
*
* This deliberately does not promise recovery from power loss or SIGKILL.
* Within the running process, every failure before commit leaves live files
* untouched. A partial commit is rolled back when possible; incomplete
* rollback retains the transaction directory and reports its recovery path.
*/
function restoreBackup(parsed, options) {
	const transactionId = options.transactionId ?? randomUUID();
	if (!/^[A-Za-z0-9_-]+$/.test(transactionId)) throw new Error("restore transactionId must contain only letters, numbers, _ or -");
	const configDir = path.resolve(options.configDir);
	const readCurrent = (name) => {
		const file = path.join(configDir, name);
		try {
			return fs.readFileSync(file);
		} catch (error) {
			if (isMissingPathError(error)) return null;
			throw error;
		}
	};
	const listCurrentOneBotNames = () => {
		try {
			return fs.readdirSync(configDir);
		} catch (error) {
			if (isMissingPathError(error)) return [];
			throw error;
		}
	};
	log$10.info("restore transaction=%s phase=preflight", transactionId);
	let prepared;
	try {
		prepared = prepareRestorePlan(parsed, {
			restoreCredentials: options.restoreCredentials,
			readCurrent,
			listCurrentOneBotNames
		});
	} catch (error) {
		const file = error instanceof RestorePreflightError ? error.file : void 0;
		log$10.warn("restore transaction=%s phase=preflight file=%s failed error=%s", transactionId, file ?? "-", errorMessage(error));
		throw new RestoreTransactionError({
			phase: "preflight",
			transactionId,
			message: `restore preflight failed: ${errorMessage(error)}`,
			cause: error,
			failedFiles: file ? [file] : []
		});
	}
	const names = prepared.restore.map((file) => file.name);
	log$10.info("restore transaction=%s phase=preflight-complete files=%s", transactionId, names.join(","));
	if (prepared.restore.length === 0) return {
		transactionId,
		restored: [],
		skipped: prepared.skipped,
		migrated: prepared.migrated,
		restartRequiredToApply: false
	};
	const transactionDir = path.join(configDir, `.restore-transaction-${transactionId}`);
	const snapshotRoot = path.join(transactionDir, "snapshot");
	const stagedRoot = path.join(transactionDir, "staged");
	const rollbackRoot = path.join(transactionDir, "rollback");
	const existed = /* @__PURE__ */ new Map();
	const committed = [];
	let phase = "snapshot";
	let activeFile;
	let transactionCreated = false;
	try {
		fs.mkdirSync(configDir, { recursive: true });
		fs.mkdirSync(transactionDir, { mode: 448 });
		transactionCreated = true;
		fs.chmodSync(transactionDir, 448);
		log$10.info("restore transaction=%s phase=snapshot files=%s", transactionId, names.join(","));
		for (const file of prepared.restore) {
			activeFile = file.name;
			const live = path.join(configDir, file.name);
			let wasPresent;
			try {
				fs.lstatSync(live);
				wasPresent = true;
			} catch (error) {
				if (!isMissingPathError(error)) throw error;
				wasPresent = false;
			}
			existed.set(file.name, wasPresent);
			if (!wasPresent) continue;
			const snapshot = path.join(snapshotRoot, file.name);
			fs.mkdirSync(path.dirname(snapshot), { recursive: true });
			invoke(options, {
				phase: "snapshot",
				operation: "copy-current",
				file: file.name
			});
			fs.copyFileSync(live, snapshot);
		}
		phase = "stage";
		log$10.info("restore transaction=%s phase=stage files=%s", transactionId, names.join(","));
		for (const file of prepared.restore) {
			activeFile = file.name;
			const staged = path.join(stagedRoot, file.name);
			fs.mkdirSync(path.dirname(staged), { recursive: true });
			invoke(options, {
				phase: "stage",
				operation: "write-staged",
				file: file.name
			});
			fs.writeFileSync(staged, file.data, {
				flag: "wx",
				mode: file.mode
			});
			invoke(options, {
				phase: "stage",
				operation: "chmod-staged",
				file: file.name
			});
			fs.chmodSync(staged, file.mode);
		}
		phase = "commit";
		log$10.info("restore transaction=%s phase=commit files=%s", transactionId, names.join(","));
		for (const file of prepared.restore) {
			activeFile = file.name;
			const staged = path.join(stagedRoot, file.name);
			const live = path.join(configDir, file.name);
			fs.mkdirSync(path.dirname(live), { recursive: true });
			invoke(options, {
				phase: "commit",
				operation: "rename-staged",
				file: file.name
			});
			fs.renameSync(staged, live);
			committed.push({
				name: file.name,
				existed: existed.get(file.name) === true
			});
		}
		activeFile = void 0;
	} catch (error) {
		if (phase !== "commit") {
			const cleanupError = transactionCreated ? removeTransaction(options, transactionDir) : null;
			if (cleanupError) {
				log$10.error("restore transaction=%s phase=cleanup failed-after=%s file=%s original-error=%s cleanup-error=%s", transactionId, phase, activeFile ?? "-", errorMessage(error), errorMessage(cleanupError));
				throw new RestoreTransactionError({
					phase: "cleanup",
					transactionId,
					message: `restore ${phase} failed and transaction cleanup also failed`,
					cause: new AggregateError([error, cleanupError], `restore ${phase} and cleanup both failed`),
					snapshotDir: transactionDir,
					failedFiles: activeFile ? [activeFile] : []
				});
			}
			log$10.warn("restore transaction=%s phase=%s file=%s failed error=%s", transactionId, phase, activeFile ?? "-", errorMessage(error));
			throw new RestoreTransactionError({
				phase,
				transactionId,
				message: `restore ${phase} failed before live commit`,
				cause: error,
				failedFiles: activeFile ? [activeFile] : []
			});
		}
		const rollbackErrors = rollbackCommitted(options, configDir, snapshotRoot, rollbackRoot, committed);
		if (rollbackErrors.length > 0) {
			const failedFiles = rollbackErrors.map((entry) => entry.name);
			const rollbackDetails = rollbackErrors.map((entry) => `${entry.name}:${errorMessage(entry.error)}`).join(";");
			log$10.error("restore transaction=%s phase=rollback commit-file=%s commit-error=%s failed=%s snapshot=%s", transactionId, activeFile ?? "-", errorMessage(error), rollbackDetails, transactionDir);
			throw new RestoreTransactionError({
				phase: "rollback",
				transactionId,
				message: "restore commit failed and rollback was incomplete",
				cause: new AggregateError([error, ...rollbackErrors.map((entry) => entry.error)], "restore commit and rollback both failed"),
				rollbackSucceeded: false,
				snapshotDir: transactionDir,
				committed: committed.length > 0,
				failedFiles
			});
		}
		const cleanupError = removeTransaction(options, transactionDir);
		if (cleanupError) {
			log$10.error("restore transaction=%s phase=cleanup failed-after=rollback commit-file=%s commit-error=%s cleanup-error=%s snapshot=%s", transactionId, activeFile ?? "-", errorMessage(error), errorMessage(cleanupError), transactionDir);
			throw new RestoreTransactionError({
				phase: "cleanup",
				transactionId,
				message: "restore commit failed, rollback succeeded, but transaction cleanup failed",
				cause: new AggregateError([error, cleanupError], "restore commit and post-rollback cleanup both failed"),
				rollbackSucceeded: true,
				snapshotDir: transactionDir,
				failedFiles: activeFile ? [activeFile] : []
			});
		}
		log$10.warn("restore transaction=%s phase=commit file=%s failed rollback=complete error=%s", transactionId, activeFile ?? "-", errorMessage(error));
		throw new RestoreTransactionError({
			phase: "commit",
			transactionId,
			message: "restore commit failed; every committed file was rolled back",
			cause: error,
			rollbackSucceeded: true,
			failedFiles: activeFile ? [activeFile] : []
		});
	}
	const cleanupError = removeTransaction(options, transactionDir);
	if (cleanupError) {
		log$10.error("restore transaction=%s phase=cleanup failed-after=commit cleanup-error=%s snapshot=%s", transactionId, errorMessage(cleanupError), transactionDir);
		throw new RestoreTransactionError({
			phase: "cleanup",
			transactionId,
			message: "restore committed successfully, but transaction cleanup failed",
			cause: cleanupError,
			snapshotDir: transactionDir,
			committed: true
		});
	}
	log$10.info("restore transaction=%s phase=complete files=%s", transactionId, names.join(","));
	return {
		transactionId,
		restored: names,
		skipped: prepared.skipped,
		migrated: prepared.migrated,
		restartRequiredToApply: true
	};
}
function rollbackCommitted(options, configDir, snapshotRoot, rollbackRoot, committed) {
	const errors = [];
	for (const file of [...committed].reverse()) {
		const live = path.join(configDir, file.name);
		try {
			if (!file.existed) {
				invoke(options, {
					phase: "rollback",
					operation: "remove-created",
					file: file.name
				});
				fs.rmSync(live, { force: true });
				continue;
			}
			const snapshot = path.join(snapshotRoot, file.name);
			const rollback = path.join(rollbackRoot, file.name);
			fs.mkdirSync(path.dirname(rollback), { recursive: true });
			invoke(options, {
				phase: "rollback",
				operation: "restore-current",
				file: file.name
			});
			fs.copyFileSync(snapshot, rollback);
			fs.chmodSync(rollback, fs.statSync(snapshot).mode & 511);
			fs.renameSync(rollback, live);
		} catch (error) {
			errors.push({
				name: file.name,
				error
			});
		}
	}
	return errors;
}
function removeTransaction(options, transactionDir) {
	try {
		invoke(options, {
			phase: "cleanup",
			operation: "remove-transaction"
		});
		fs.rmSync(transactionDir, {
			recursive: true,
			force: true
		});
		return null;
	} catch (error) {
		return error;
	}
}
function invoke(options, operation) {
	options.beforeOperation?.(operation);
}
function isMissingPathError(error) {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
