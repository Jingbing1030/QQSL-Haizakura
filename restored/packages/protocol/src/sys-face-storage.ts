// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../protocol/src/sys-face-storage.ts"
// original bundle lines 367140-367180  (39 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function isErrno(error, code) {
	return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
/** Atomic JSON persistence for the process-wide system-face catalog. */
var JsonSysFaceCatalogStorage = class {
	filePath;
	constructor(filePath) {
		this.filePath = filePath;
	}
	async load() {
		let text;
		try {
			text = await readFile(this.filePath, "utf8");
		} catch (error) {
			if (isErrno(error, "ENOENT")) return null;
			throw new Error(`failed to read system face catalog ${this.filePath}`, { cause: error });
		}
		try {
			return JSON.parse(text);
		} catch (error) {
			throw new Error(`failed to parse system face catalog ${this.filePath}`, { cause: error });
		}
	}
	async save(snapshot) {
		await mkdir(dirname(this.filePath), { recursive: true });
		const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
		try {
			await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), "utf8");
			await rename(temporaryPath, this.filePath);
		} catch (error) {
			try {
				await unlink(temporaryPath);
			} catch (cleanupError) {
				if (!isErrno(cleanupError, "ENOENT")) throw new AggregateError([error, cleanupError], `failed to persist system face catalog ${this.filePath} and remove its temporary file`);
			}
			throw new Error(`failed to persist system face catalog ${this.filePath}`, { cause: error });
		}
	}
};
export {};
