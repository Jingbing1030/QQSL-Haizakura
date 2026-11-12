var MANIFEST_FILE = "release.json";
async function updateDirectory(root, temporaryRoot = os$1.tmpdir()) {
	const local = path.join(root, "tmp", "update");
	if (existsSync(local)) return local;
	const identity = createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16);
	const directory = path.join(temporaryRoot, `snowluma-update-${identity}`);
	try {
		await mkdir(directory, { recursive: true });
		await access(directory, constants.W_OK);
		return directory;
	} catch (error) {
		if (!(error instanceof Error) || !("code" in error) || ![
			"EACCES",
			"EPERM",
			"EROFS"
		].includes(String(error.code))) throw error;
		await mkdir(local, { recursive: true });
		return local;
	}
}
var runtimeEntries = /* @__PURE__ */ new Set([
	"native",
	"client",
	"package.json",
	MANIFEST_FILE,
	"launcher.bat",
	"launcher.sh",
	"check-node-version.cjs",
	"EULA.md",
	"PRIVACY.md"
]);
function isRuntimeEntry(name) {
	return runtimeEntries.has(name) || /^[\w-]+\.mjs(?:\.map)?$/.test(name);
}
function entryList(value) {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string" && isRuntimeEntry(entry)) && new Set(value).size === value.length;
}
async function exists(file) {
	try {
		await lstat(file);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}
async function readManifest(root) {
	const value = JSON.parse(await readFile(path.join(root, MANIFEST_FILE), "utf8"));
	if (!value || typeof value !== "object" || !("version" in value) || typeof value.version !== "string" || !parseVersion(value.version) || !("target" in value) || typeof value.target !== "string" || !/^(win32-x64|linux-(x64|arm64))$/.test(value.target) || !("entries" in value) || !entryList(value.entries)) throw new Error("更新包清单无效");
	const entries = value.entries;
	if (![
		"index.mjs",
		"native",
		"client",
		"package.json",
		"release.json",
		"check-node-version.cjs",
		"EULA.md",
		"PRIVACY.md",
		value.target.startsWith("win32") ? "launcher.bat" : "launcher.sh"
	].every((entry) => entries.includes(entry))) throw new Error("更新包清单无效");
	return {
		version: value.version,
		target: value.target,
		entries: value.entries
	};
}
async function checkEntryTypes(root, entries) {
	for (const entry of entries) {
		const stat = await lstat(path.join(root, entry));
		if (entry === "native" || entry === "client" ? !stat.isDirectory() : !stat.isFile()) throw new Error(`更新包文件类型无效: ${entry}`);
	}
}
async function readTransaction(file) {
	const value = JSON.parse(await readFile(file, "utf8"));
	if (!value || typeof value !== "object" || !("entries" in value) || !entryList(value.entries) || !("original" in value) || !entryList(value.original)) throw new Error("更新恢复记录无效");
	const entries = value.entries;
	if (value.original.some((entry) => !entries.includes(entry))) throw new Error("更新恢复记录无效");
	return {
		entries: value.entries,
		original: value.original
	};
}
async function restore(root, pending, transaction) {
	for (const entry of transaction.entries) {
		const backup = path.join(pending, "backup", entry);
		const destination = path.join(root, entry);
		if (transaction.original.includes(entry)) await replaceEntry(backup, destination, path.join(root, ".update-install"));
		else await rm(destination, {
			recursive: true,
			force: true
		});
	}
	await rm(path.join(pending, "transaction.json"));
}
async function replaceEntry(source, destination, temporary) {
	await rm(temporary, {
		recursive: true,
		force: true
	});
	await cp(source, temporary, { recursive: true });
	if ((await lstat(source)).isDirectory()) await rm(destination, {
		recursive: true,
		force: true
	});
	await rename(temporary, destination);
}
async function applyPendingUpdate(root) {
	const directory = await updateDirectory(root);
	const pending = path.join(directory, "pending");
	const completed = path.join(directory, "completed");
	await rm(completed, {
		recursive: true,
		force: true
	});
	await rm(path.join(directory, "downloading"), {
		recursive: true,
		force: true
	});
	await rm(path.join(root, ".update-install"), {
		recursive: true,
		force: true
	});
	if (!await exists(pending)) {
		await rm(directory, { recursive: true });
		return null;
	}
	const journal = path.join(pending, "transaction.json");
	if (await exists(journal)) await restore(root, pending, await readTransaction(journal));
	const payload = path.join(pending, "payload");
	const next = await readManifest(payload);
	const current = await readManifest(root);
	if (next.target !== current.target) throw new Error("更新包平台不匹配");
	await checkEntryTypes(payload, next.entries);
	const entries = [.../* @__PURE__ */ new Set([...current.entries, ...next.entries])];
	const original = [];
	for (const entry of entries) if (await exists(path.join(root, entry))) {
		if ((await lstat(path.join(root, entry))).isSymbolicLink()) throw new Error(`更新目标不能是符号链接: ${entry}`);
		original.push(entry);
	}
	const transaction = {
		entries,
		original
	};
	const backup = path.join(pending, "backup");
	await rm(backup, {
		recursive: true,
		force: true
	});
	await mkdir(backup);
	for (const entry of original) await cp(path.join(root, entry), path.join(backup, entry), { recursive: true });
	await writeFile(`${journal}.tmp`, JSON.stringify(transaction));
	await rename(`${journal}.tmp`, journal);
	try {
		for (const entry of next.entries) await replaceEntry(path.join(payload, entry), path.join(root, entry), path.join(root, ".update-install"));
		for (const entry of current.entries) if (!next.entries.includes(entry)) await rm(path.join(root, entry), {
			recursive: true,
			force: true
		});
		await rename(pending, completed);
	} catch (error) {
		try {
			await restore(root, pending, transaction);
		} catch (restoreError) {
			throw new AggregateError([error, restoreError], "更新失败，恢复未完成；下次启动将继续恢复");
		}
		throw error;
	}
	await rm(directory, { recursive: true });
	return next.version;
}
