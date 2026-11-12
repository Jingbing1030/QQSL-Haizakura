// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/reaction-store.ts"
// original bundle lines 342458-342557  (98 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
var ReactionStore = class {
	db;
	stmtUpsert;
	stmtRemove;
	stmtList;
	stmtCount;
	stmtCountByEmoji;
	initialization;
	constructor(dbPath) {
		this.db = openSqliteDb(dbPath);
		this.initialization = this.db.serial(async () => {
			await this.initSchema();
			this.stmtUpsert = this.db.prepare(`INSERT INTO reactions
         (group_id, msg_seq, emoji_id, emoji_type, operator_uin, operator_uid, set_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(group_id, msg_seq, emoji_id, operator_uin) DO UPDATE SET
           emoji_type = excluded.emoji_type,
           operator_uid = excluded.operator_uid,
           set_at = excluded.set_at`);
			this.stmtRemove = this.db.prepare(`DELETE FROM reactions
         WHERE group_id = ? AND msg_seq = ? AND emoji_id = ? AND operator_uin = ?`);
			this.stmtList = this.db.prepare(`SELECT operator_uin, operator_uid, set_at
         FROM reactions
         WHERE group_id = ? AND msg_seq = ? AND emoji_id = ?
         ORDER BY set_at ASC
         LIMIT ? OFFSET ?`);
			this.stmtCount = this.db.prepare(`SELECT COUNT(*) AS n FROM reactions
         WHERE group_id = ? AND msg_seq = ? AND emoji_id = ?`);
			this.stmtCountByEmoji = this.db.prepare(`SELECT emoji_id, emoji_type, COUNT(*) AS n, MAX(set_at) AS last_at
         FROM reactions
         WHERE group_id = ? AND msg_seq = ?
         GROUP BY emoji_id`);
		});
		this.initialization.catch(() => void 0);
	}
	async initSchema() {
		await this.db.exec(`
      CREATE TABLE IF NOT EXISTS reactions (
        group_id     INTEGER NOT NULL,
        msg_seq      INTEGER NOT NULL,
        emoji_id     TEXT    NOT NULL,
        emoji_type   INTEGER NOT NULL DEFAULT 1,
        operator_uin INTEGER NOT NULL,
        operator_uid TEXT    NOT NULL DEFAULT '',
        set_at       INTEGER NOT NULL,
        PRIMARY KEY (group_id, msg_seq, emoji_id, operator_uin)
      );
      CREATE INDEX IF NOT EXISTS idx_reactions_msg_emoji
        ON reactions (group_id, msg_seq, emoji_id, set_at);
    `);
	}
	async recordAdd(groupId, msgSeq, emojiId, emojiType, operatorUin, operatorUid, setAt) {
		return this.db.serial(async () => {
			await this.initialization;
			if (!groupId || !msgSeq || !emojiId || !operatorUin) return;
			await this.stmtUpsert.run(groupId, msgSeq, emojiId, emojiType, operatorUin, operatorUid, setAt);
		});
	}
	async recordRemove(groupId, msgSeq, emojiId, operatorUin) {
		return this.db.serial(async () => {
			await this.initialization;
			if (!groupId || !msgSeq || !emojiId || !operatorUin) return;
			await this.stmtRemove.run(groupId, msgSeq, emojiId, operatorUin);
		});
	}
	async listUsers(groupId, msgSeq, emojiId, limit = 20, offset = 0) {
		return this.db.serial(async () => {
			await this.initialization;
			return (await this.stmtList.all(groupId, msgSeq, emojiId, Math.max(1, Math.min(limit, 500)), Math.max(0, offset))).map((r) => ({
				operatorUin: r.operator_uin,
				operatorUid: r.operator_uid,
				setAt: r.set_at
			}));
		});
	}
	async countUsers(groupId, msgSeq, emojiId) {
		return this.db.serial(async () => {
			await this.initialization;
			return (await this.stmtCount.get(groupId, msgSeq, emojiId))?.n ?? 0;
		});
	}
	/** Summary of all cached reactions on a message, grouped by emoji. */
	async summarizeMessage(groupId, msgSeq) {
		return this.db.serial(async () => {
			await this.initialization;
			return (await this.stmtCountByEmoji.all(groupId, msgSeq)).map((r) => ({
				emojiId: r.emoji_id,
				emojiType: r.emoji_type,
				count: r.n,
				lastSetAt: r.last_at
			}));
		});
	}
	async close() {
		await this.initialization.catch(() => void 0);
		await this.db.close();
	}
};
export {};
