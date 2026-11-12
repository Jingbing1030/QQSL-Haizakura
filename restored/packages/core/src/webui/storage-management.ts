init_errors();
function publicLogStorageStatus(status) {
	const { directory, ...publicStatus } = status;
	if (!publicStatus.lastError) return publicStatus;
	return {
		...publicStatus,
		lastError: redactFilesystemPath(publicStatus.lastError, directory, "[日志目录]")
	};
}
var StorageManagementInputError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "StorageManagementInputError";
	}
};
var StorageAccountOnlineError = class extends Error {
	uins;
	constructor(uins) {
		super(`account data cleanup requires offline accounts: ${uins.join(", ")}`);
		this.uins = uins;
		this.name = "StorageAccountOnlineError";
	}
};
var DATABASE_FILES = {
	messages: [
		"messages.db",
		"messages.db-wal",
		"messages.db-shm",
		"messages.db-journal"
	],
	media: [
		"media.db",
		"media.db-wal",
		"media.db-shm",
		"media.db-journal"
	],
	reactions: [
		"reactions.db",
		"reactions.db-wal",
		"reactions.db-shm",
		"reactions.db-journal"
	]
};
var StorageManagementService = class {
	deps;
	constructor(deps) {
		this.deps = deps;
	}
	snapshot() {
		const logs = publicLogStorageStatus(this.deps.getLogStatus());
		const temporary = this.deps.temporary.snapshot();
		const accounts = this.accountSnapshots();
		const accountDataBytes = accounts.reduce((sum, account) => sum + account.totalBytes, 0);
		return {
			logs,
			temporary,
			accounts,
			totals: {
				logsBytes: logs.totalBytes,
				temporaryBytes: temporary.totalBytes,
				accountDataBytes,
				managedBytes: logs.totalBytes + temporary.totalBytes + accountDataBytes
			}
		};
	}
	async clearLogs() {
		const result = await this.deps.clearLogs();
		return {
			...result,
			failures: result.failures.map((failure) => ({
				...failure,
				message: redactFilesystemPath(failure.message, result.status.directory, "[日志目录]")
			})),
			status: publicLogStorageStatus(result.status)
		};
	}
	clearTemporary() {
		return this.deps.temporary.clearInactive();
	}
	clearAccountData(category, uin) {
		const validatedCategory = validateAccountStorageCategory(category);
		if (!isRealUin(uin)) throw new StorageManagementInputError(`invalid UIN: ${uin}`);
		return this.clearAccountDataForUins(validatedCategory, [uin]);
	}
	clearAllAccountData(category) {
		const validatedCategory = validateAccountStorageCategory(category);
		const uins = listDirectoryNames(this.deps.dataDir).filter((name) => isRealUin(name)).sort((a, b) => Number(a) - Number(b));
		return this.clearAccountDataForUins(validatedCategory, uins);
	}
	clearAccountDataForUins(category, uins) {
		const hasManagedRoot = assertManagedDataRootOrMissing(this.deps.dataDir);
		const onlineUins = new Set(this.deps.listOnlineAccounts().map((account) => account.uin).filter((uin) => isRealUin(uin)));
		const blockedUins = uins.filter((uin) => onlineUins.has(uin));
		if (blockedUins.length > 0) throw new StorageAccountOnlineError(blockedUins);
		const failures = [];
		let deletedFiles = 0;
		let freedBytes = 0;
		if (!hasManagedRoot) return {
			category,
			uins,
			deletedFiles,
			freedBytes,
			failures
		};
		for (const uin of uins) {
			const dir = path.join(this.deps.dataDir, uin);
			if (!isManagedDirectory(dir)) continue;
			for (const name of DATABASE_FILES[category]) {
				const filePath = path.join(dir, name);
				let bytes;
				try {
					const stat = fs.lstatSync(filePath);
					if (!stat.isFile()) continue;
					bytes = stat.size;
				} catch (error) {
					if (isMissing(error)) continue;
					failures.push({
						uin,
						file: name,
						message: redactFilesystemPath(errorMessage(error), filePath, "[账号数据库]")
					});
					continue;
				}
				try {
					fs.unlinkSync(filePath);
					deletedFiles += 1;
					freedBytes += bytes;
				} catch (error) {
					if (isMissing(error)) continue;
					failures.push({
						uin,
						file: name,
						message: redactFilesystemPath(errorMessage(error), filePath, "[账号数据库]")
					});
				}
			}
		}
		return {
			category,
			uins,
			deletedFiles,
			freedBytes,
			failures
		};
	}
	accountSnapshots() {
		const online = new Map(this.deps.listOnlineAccounts().filter((account) => isRealUin(account.uin)).map((account) => [account.uin, account.nickname]));
		const uins = new Set(online.keys());
		for (const name of listDirectoryNames(this.deps.dataDir)) if (isRealUin(name)) uins.add(name);
		return [...uins].sort((a, b) => Number(a) - Number(b)).map((uin) => {
			const dir = path.join(this.deps.dataDir, uin);
			const managedDirectory = isManagedDirectory(dir);
			const messagesBytes = managedDirectory ? sumAllowlistedFiles(dir, DATABASE_FILES.messages) : 0;
			const mediaBytes = managedDirectory ? sumAllowlistedFiles(dir, DATABASE_FILES.media) : 0;
			const reactionsBytes = managedDirectory ? sumAllowlistedFiles(dir, DATABASE_FILES.reactions) : 0;
			const nickname = online.get(uin);
			return {
				uin,
				...nickname ? { nickname } : {},
				online: online.has(uin),
				messagesBytes,
				mediaBytes,
				reactionsBytes,
				totalBytes: messagesBytes + mediaBytes + reactionsBytes
			};
		});
	}
};
function listDirectoryNames(dir) {
	if (!assertManagedDataRootOrMissing(dir)) return [];
	try {
		return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch (error) {
		if (isMissing(error)) return [];
		throw error;
	}
}
function assertManagedDataRootOrMissing(dir) {
	try {
		if (!fs.lstatSync(dir).isDirectory()) throw new Error("managed data root must be a real directory");
		return true;
	} catch (error) {
		if (isMissing(error)) return false;
		throw error;
	}
}
function sumAllowlistedFiles(dir, names) {
	let total = 0;
	for (const name of names) {
		const filePath = path.join(dir, name);
		try {
			const stat = fs.lstatSync(filePath);
			if (stat.isFile()) total += stat.size;
		} catch (error) {
			if (!isMissing(error)) throw error;
		}
	}
	return total;
}
function isMissing(error) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function isManagedDirectory(dir) {
	try {
		return fs.lstatSync(dir).isDirectory();
	} catch (error) {
		if (isMissing(error)) return false;
		throw error;
	}
}
function validateAccountStorageCategory(value) {
	if (value === "messages" || value === "media" || value === "reactions") return value;
	throw new StorageManagementInputError(`unsupported account storage category: ${value}`);
}
function redactFilesystemPath(message, filePath, label) {
	const absolute = path.resolve(filePath);
	return message.split(absolute).join(label).split(filePath).join(label);
}
