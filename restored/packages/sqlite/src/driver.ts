// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../sqlite/src/driver.ts"
// original bundle lines 2877-2948  (70 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
/** Promises adapt native completion callbacks; SQLite work stays on native workers. */
async function openDatabase(filename, readOnly) {
	if (process.permission && filename !== ":memory:") {
		const file = path.resolve(filename);
		const checks = [["fs.read", file]];
		if (!readOnly) checks.push(["fs.write", file], ["fs.write", path.dirname(file)]);
		for (const [scope, resource] of checks) if (!process.permission.has(scope, resource)) throw new Error(`SQLite permission denied: ${scope} ${resource}`);
	}
	const binding = loadNative();
	const mode = (readOnly ? binding.OPEN_READONLY : binding.OPEN_READWRITE | binding.OPEN_CREATE) | binding.OPEN_FULLMUTEX;
	return new Promise((resolve, reject) => {
		new binding.Database(filename, mode, function(error) {
			if (error) reject(error);
			else resolve(new Database(this));
		});
	});
}
var Database = class {
	native;
	constructor(native) {
		this.native = native;
	}
	exec(sql) {
		return new Promise((resolve, reject) => this.native.exec(sql, (error) => error ? reject(error) : resolve()));
	}
	prepare(sql) {
		const binding = loadNative();
		return new Promise((resolve, reject) => {
			new binding.Statement(this.native, sql, function(error) {
				if (error) reject(error);
				else resolve(new Statement(this));
			});
		});
	}
	close() {
		return new Promise((resolve, reject) => this.native.close((error) => error ? reject(error) : resolve()));
	}
};
var Statement = class {
	native;
	constructor(native) {
		this.native = native;
	}
	run(parameters) {
		return new Promise((resolve, reject) => this.native.run(parameters, (error) => {
			if (error) {
				reject(error);
				return;
			}
			const { changes, lastIDBigInt } = this.native;
			if (changes === void 0 || lastIDBigInt === void 0) reject(/* @__PURE__ */ new Error("SQLite native run completed without its result metadata"));
			else resolve({
				changes,
				lastIDBigInt
			});
		}));
	}
	get(parameters) {
		return new Promise((resolve, reject) => this.native.get(parameters, (error, row) => error ? reject(error) : resolve(row)));
	}
	all(parameters) {
		return new Promise((resolve, reject) => this.native.all(parameters, (error, rows) => error ? reject(error) : resolve(rows)));
	}
	reset() {
		return new Promise((resolve, reject) => this.native.reset((error) => error ? reject(error) : resolve()));
	}
	finalize() {
		return new Promise((resolve, reject) => this.native.finalize((error) => error ? reject(error) : resolve()));
	}
};
export {};
