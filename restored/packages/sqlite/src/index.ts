// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../sqlite/src/index.ts"
// original bundle lines 2949-3083  (133 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var MAX_PENDING_OPERATIONS = 2048;
var context = new AsyncLocalStorage$1();
/** Owns one native asynchronous connection. Serialize whole store operations,
* not only statements, so unrelated calls cannot enter another call's transaction.
*/
var SqliteDatabase = class {
	initialization;
	database = null;
	tail;
	statements = /* @__PURE__ */ new Map();
	pending = 0;
	shutdown = null;
	constructor(filename, options = {}) {
		this.initialization = (async () => {
			await options.beforeOpen;
			if (!options.readOnly && filename !== ":memory:") await mkdir(path.dirname(filename), { recursive: true });
			const database = await openDatabase(filename, options.readOnly ?? false);
			this.database = database;
			try {
				await database.exec(`PRAGMA busy_timeout = ${options.busyTimeout ?? 1e3}`);
				await database.exec("PRAGMA foreign_keys = ON");
				if (!options.readOnly) {
					await database.exec("PRAGMA journal_mode = WAL");
					await database.exec("PRAGMA synchronous = NORMAL");
				}
			} catch (error) {
				try {
					await database.close();
					this.database = null;
				} catch (closeError) {
					throw new AggregateError([error, closeError], "SQLite initialization and cleanup failed", { cause: error });
				}
				throw error;
			}
		})();
		this.tail = this.initialization.catch(() => void 0);
	}
	serial(operation) {
		const current = context.getStore();
		if (current?.database === this && current.active) return Promise.resolve().then(operation);
		if (this.shutdown) return Promise.reject(/* @__PURE__ */ new Error("SQLite database is closing"));
		if (this.pending >= MAX_PENDING_OPERATIONS) return Promise.reject(/* @__PURE__ */ new Error("SQLite operation queue is full"));
		this.pending++;
		const work = this.tail.then(async () => {
			await this.initialization;
			const scope = {
				database: this,
				active: true
			};
			try {
				return await context.run(scope, operation);
			} finally {
				scope.active = false;
			}
		});
		this.tail = work.then(() => void 0, () => void 0).finally(() => {
			this.pending--;
		});
		return work;
	}
	prepare(sql) {
		return new SqliteStatement(this, sql);
	}
	exec(sql) {
		return this.serial(() => this.database.exec(sql));
	}
	/** Preparation and statement execution both happen in the driver's native workers. */
	execute(sql, operation) {
		return this.serial(async () => {
			let statement = this.statements.get(sql);
			if (!statement) {
				statement = await this.database.prepare(sql);
				this.statements.set(sql, statement);
			}
			try {
				return await operation(statement);
			} finally {
				await statement.reset();
			}
		});
	}
	close() {
		const current = context.getStore();
		if (current?.database === this && current.active) return Promise.reject(/* @__PURE__ */ new Error("Cannot close SQLite from a serialized operation"));
		const shutdown = this.shutdown ??= { task: null };
		if (shutdown.task) return shutdown.task;
		shutdown.task = (async () => {
			await this.tail;
			if (!this.database) return;
			const results = await Promise.allSettled([...this.statements.values()].map((statement) => statement.finalize()));
			this.statements.clear();
			const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
			try {
				await this.database.close();
				this.database = null;
			} catch (error) {
				errors.push(error);
			}
			if (errors.length) throw new AggregateError(errors, "SQLite close failed");
		})();
		shutdown.task.catch(() => {
			shutdown.task = null;
		});
		return shutdown.task;
	}
};
/** A lazy SQL descriptor: creating it does not touch SQLite or block JavaScript. */
var SqliteStatement = class {
	database;
	sourceSQL;
	constructor(database, sourceSQL) {
		this.database = database;
		this.sourceSQL = sourceSQL;
	}
	run(...values) {
		const parameters = structuredClone(values);
		return this.database.execute(this.sourceSQL, async (statement) => {
			const result = await statement.run(parameters);
			return {
				changes: result.changes,
				lastInsertRowid: result.lastIDBigInt
			};
		});
	}
	get(...values) {
		const parameters = structuredClone(values);
		return this.database.execute(this.sourceSQL, (statement) => statement.get(parameters));
	}
	all(...values) {
		const parameters = structuredClone(values);
		return this.database.execute(this.sourceSQL, (statement) => statement.all(parameters));
	}
};
export {};
