// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../bridge/src/qq-account/login-db.ts"
// original bundle lines 3472-3601  (128 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var LOGIN_DB_PASSPHRASE = "BD156D6710D54D8782F4";
var COLUMN_UIN = "1000";
var COLUMN_UID = "1001";
var COLUMN_NICKNAME = "1007";
var accountCache = /* @__PURE__ */ new Map();
async function readLocalAccounts(root) {
	const merged = /* @__PURE__ */ new Map();
	const failures = [];
	for (const dbPath of loginDbPaths(root)) {
		const result = await readLoginDb(dbPath);
		if ("failure" in result) {
			failures.push({
				path: dbPath,
				reason: result.failure,
				error: result.error
			});
			continue;
		}
		for (const account of result.accounts) if (!merged.has(account.uin)) merged.set(account.uin, account);
	}
	return {
		accounts: [...merged.values()],
		failures
	};
}
async function readLoginDb(dbPath) {
	let stamp;
	try {
		stamp = (await Promise.all([statIfPresent(dbPath), statIfPresent(dbPath + "-wal")])).map((info) => info ? info.mtimeMs + ":" + info.size : "-").join("|");
	} catch (error) {
		accountCache.delete(dbPath);
		return {
			failure: "read-failed",
			error
		};
	}
	const cached = accountCache.get(dbPath);
	if (cached?.stamp === stamp) return cached.result;
	const entry = {
		stamp,
		result: decryptAndQuery(dbPath)
	};
	accountCache.set(dbPath, entry);
	const result = await entry.result;
	if ("failure" in result && accountCache.get(dbPath) === entry) accountCache.delete(dbPath);
	return result;
}
async function decryptAndQuery(dbPath) {
	let image;
	let wal;
	try {
		const contents = await readIfPresent(dbPath);
		if (!contents) return { accounts: [] };
		image = contents;
		wal = await readIfPresent(dbPath + "-wal");
	} catch (error) {
		return {
			failure: "read-failed",
			error
		};
	}
	const algorithm = detectAlgorithm(image, LOGIN_DB_PASSPHRASE);
	if (!algorithm) return { failure: "undecryptable" };
	const decrypted = decryptDatabase(image, wal, LOGIN_DB_PASSPHRASE, algorithm);
	if (!decrypted) return { failure: "undecryptable" };
	try {
		return { accounts: await queryLoginTable(decrypted.image) };
	} catch (error) {
		return {
			failure: "query-failed",
			error
		};
	}
}
async function queryLoginTable(image) {
	const directory = await mkdtemp(path.join(os$1.tmpdir(), "snowluma-qq-login-"));
	const dbPath = path.join(directory, "login.db");
	try {
		await writeFile(dbPath, image, { mode: 384 });
		const db = new SqliteDatabase(dbPath, { readOnly: true });
		try {
			const rows = await db.prepare(`SELECT [${COLUMN_UIN}], [${COLUMN_UID}], [${COLUMN_NICKNAME}] FROM login_table`).all();
			const accounts = [];
			for (const row of rows) {
				const account = {
					uin: asText(row[COLUMN_UIN]),
					uid: asText(row[COLUMN_UID]),
					nickname: asText(row[COLUMN_NICKNAME])
				};
				if (isRealUin(account.uin) && account.uid.length > 0) accounts.push(account);
			}
			return accounts;
		} finally {
			await db.close();
		}
	} finally {
		await rm(directory, {
			recursive: true,
			force: true
		});
	}
}
async function readIfPresent(file) {
	try {
		return await readFile(file);
	} catch (error) {
		if (isNotFound(error)) return null;
		throw error;
	}
}
function isNotFound(error) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
async function statIfPresent(file) {
	try {
		return await stat(file);
	} catch (error) {
		if (isNotFound(error)) return null;
		throw error;
	}
}
/** SQLite values arrive as numbers, strings or blobs depending on the column. */
function asText(value) {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "bigint") return String(value);
	if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
	return "";
}
export {};
