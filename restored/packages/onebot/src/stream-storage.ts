// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/stream-storage.ts"
// original bundle lines 17363-17593  (229 lines) of dist/index.mjs
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
var log$62 = createLogger("OneBot.Stream");
var StreamStorage = class {
	root;
	uploadDir;
	downloadDir;
	activeItems = /* @__PURE__ */ new Map();
	nextActiveItemId = 1;
	constructor(root) {
		this.root = resolveManagedRoot(root);
		this.uploadDir = path.join(this.root, "upload");
		this.downloadDir = path.join(this.root, "download");
	}
	/**
	* Create a directory inside the managed root without following a substituted
	* directory link. Existing directories remain usable when they belong to the
	* current account and cannot be modified by other local accounts.
	*/
	ensureDirectory(directory) {
		const resolved = path.resolve(directory);
		if (resolved !== this.root && !isStrictDescendant(this.root, resolved)) throw new Error(`stream directory is outside the managed root: ${directory}`);
		let current = this.root;
		ensureManagedDirectory(current);
		const relative = path.relative(this.root, resolved);
		if (!relative) return;
		for (const segment of relative.split(path.sep)) {
			current = path.join(current, segment);
			ensureManagedDirectory(current);
		}
	}
	registerActiveItem(paths) {
		const normalized = paths.map((item) => {
			const resolved = path.resolve(item);
			if (!isStrictDescendant(this.root, resolved)) throw new Error(`active stream path is outside the managed root: ${item}`);
			return resolved;
		});
		const id = this.nextActiveItemId++;
		this.activeItems.set(id, normalized);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.activeItems.delete(id);
		};
	}
	snapshot() {
		if (!this.assertRootDirectoryOrMissing()) return {
			totalBytes: 0,
			fileCount: 0,
			activeItemCount: this.activeItems.size
		};
		let totalBytes = 0;
		let fileCount = 0;
		this.walkFiles(this.root, (stat) => {
			totalBytes += stat.size;
			fileCount += 1;
		});
		return {
			totalBytes,
			fileCount,
			activeItemCount: this.activeItems.size
		};
	}
	clearInactive() {
		const result = {
			deletedFiles: 0,
			freedBytes: 0,
			skippedActiveItems: this.activeItems.size,
			failures: []
		};
		if (!this.assertRootDirectoryOrMissing()) return result;
		const activePaths = [...this.activeItems.values()].flat();
		let entries;
		try {
			entries = fs.readdirSync(this.root, { withFileTypes: true });
		} catch (error) {
			result.failures.push({
				item: ".",
				message: this.publicErrorMessage(error)
			});
			return result;
		}
		for (const entry of entries) this.clearNode(path.join(this.root, entry.name), activePaths, result);
		return result;
	}
	assertRootDirectoryOrMissing() {
		try {
			const stat = fs.lstatSync(this.root);
			assertManagedDirectory(this.root, stat);
			return true;
		} catch (error) {
			if (isMissing$1(error)) return false;
			throw error;
		}
	}
	walkFiles(dir, visit) {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const item = path.join(dir, entry.name);
			const stat = fs.lstatSync(item);
			if (stat.isDirectory()) this.walkFiles(item, visit);
			else visit(stat);
		}
	}
	clearNode(item, activePaths, result) {
		const resolved = path.resolve(item);
		if (activePaths.some((active) => isSameOrDescendant(active, resolved))) return;
		let stat;
		try {
			stat = fs.lstatSync(resolved);
		} catch (error) {
			if (!isMissing$1(error)) result.failures.push({
				item: this.displayPath(resolved),
				message: this.publicErrorMessage(error)
			});
			return;
		}
		if (!stat.isDirectory()) {
			try {
				fs.unlinkSync(resolved);
				result.deletedFiles += 1;
				result.freedBytes += stat.size;
			} catch (error) {
				if (!isMissing$1(error)) result.failures.push({
					item: this.displayPath(resolved),
					message: this.publicErrorMessage(error)
				});
			}
			return;
		}
		let entries;
		try {
			entries = fs.readdirSync(resolved, { withFileTypes: true });
		} catch (error) {
			result.failures.push({
				item: this.displayPath(resolved),
				message: this.publicErrorMessage(error)
			});
			return;
		}
		for (const entry of entries) this.clearNode(path.join(resolved, entry.name), activePaths, result);
		try {
			if (fs.readdirSync(resolved).length === 0) fs.rmdirSync(resolved);
		} catch (error) {
			if (!isMissing$1(error)) result.failures.push({
				item: this.displayPath(resolved),
				message: this.publicErrorMessage(error)
			});
		}
	}
	displayPath(item) {
		return path.relative(this.root, item) || ".";
	}
	publicErrorMessage(error) {
		return errorMessage(error).split(this.root).join("[临时目录]");
	}
};
function isStrictDescendant(root, candidate) {
	const relative = path.relative(root, candidate);
	return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
function isSameOrDescendant(root, candidate) {
	return root === candidate || isStrictDescendant(root, candidate);
}
function isMissing$1(error) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function assertManagedDirectory(directory, stat) {
	if (stat.isSymbolicLink()) throw new Error(`managed stream directory must not be a symbolic link: ${directory}`);
	if (!stat.isDirectory()) throw new Error(`managed stream path is not a directory: ${directory}`);
	const currentUid = typeof process.getuid === "function" ? process.getuid() : void 0;
	if (currentUid !== void 0 && stat.uid !== currentUid) throw new Error(`managed stream directory is owned by another account: ${directory}`);
	if (process.platform !== "win32" && (stat.mode & 18) !== 0) throw new Error(`managed stream directory is writable by other accounts: ${directory}`);
}
function ensureManagedDirectory(directory) {
	let stat;
	try {
		stat = fs.lstatSync(directory);
	} catch (error) {
		if (!isMissing$1(error)) throw error;
		try {
			fs.mkdirSync(directory, { mode: 448 });
		} catch (mkdirError) {
			if (!(mkdirError instanceof Error && "code" in mkdirError && mkdirError.code === "EEXIST")) throw mkdirError;
		}
		stat = fs.lstatSync(directory);
	}
	assertManagedDirectory(directory, stat);
}
function resolveManagedRoot(input) {
	const absolute = path.resolve(input);
	try {
		assertManagedDirectory(absolute, fs.lstatSync(absolute));
		return fs.realpathSync(absolute);
	} catch (error) {
		if (!isMissing$1(error)) throw error;
	}
	const parent = path.dirname(absolute);
	if (!fs.statSync(parent).isDirectory()) throw new Error(`managed stream parent is not a directory: ${parent}`);
	return path.join(fs.realpathSync(parent), path.basename(absolute));
}
function createStreamStorage(env = process.env) {
	const fallback = path.join(os$1.tmpdir(), "onebot-stream");
	const raw = env.SNOWLUMA_STREAM_DIR?.trim();
	if (!raw) return new StreamStorage(fallback);
	try {
		return new StreamStorage(raw);
	} catch (error) {
		log$62.warn("SNOWLUMA_STREAM_DIR=%j is ignored: %s", raw, error instanceof Error ? error.message : String(error));
		return new StreamStorage(fallback);
	}
}
var streamStorage = createStreamStorage();
var STREAM_ROOT = streamStorage.root;
var STREAM_UPLOAD_DIR = streamStorage.uploadDir;
streamStorage.downloadDir;
function registerActiveStreamItem(paths) {
	return streamStorage.registerActiveItem(paths);
}
function ensureStreamDirectory(directory) {
	streamStorage.ensureDirectory(directory);
}
function snapshotStreamStorage() {
	return streamStorage.snapshot();
}
function clearInactiveStreamStorage() {
	return streamStorage.clearInactive();
}
export {};
