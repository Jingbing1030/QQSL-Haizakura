import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface IdentityMapping {
  uid: string;
  uin: number;
}

export interface IdentityServiceOptions {
  /** Defaults to the reference-compatible data/<uin>/snowluma_identity.db path. */
  dataRoot?: string;
}

/** Durable bidirectional UID/UIN index. Memory remains authoritative after startup. */
export class IdentityService {
  readonly uin: string;
  readonly initialization: Promise<void>;
  #db: DatabaseSync | null = null;
  #uidToUin = new Map<string, number>();
  #uinToUid = new Map<number, string>();
  #closed = false;

  constructor(uin: string, databasePath?: string) {
    if (!uin.trim()) throw new Error("IdentityService requires a non-empty UIN");
    this.uin = uin;
    this.initialization = databasePath === undefined
      ? Promise.resolve()
      : this.#initialize(databasePath);
  }

  static openForUin(uin: string, dataRoot = "data"): IdentityService {
    return new IdentityService(uin, path.join(dataRoot, uin, "snowluma_identity.db"));
  }

  static memory(uin: string): IdentityService {
    return new IdentityService(uin);
  }

  get persistent(): boolean {
    return this.#db !== null;
  }

  findUidByUin(uin: number | string): string | null {
    const normalized = normalizeUin(uin);
    return normalized === null ? null : this.#uinToUid.get(normalized) ?? null;
  }

  findUinByUid(uid: string): number | null {
    const normalized = normalizeUid(uid);
    if (!normalized) return null;
    const numeric = /^\d+$/.test(normalized) ? normalizeUin(normalized) : null;
    return numeric ?? this.#uidToUin.get(normalized) ?? null;
  }

  /** Replace conflicting pairs in both indexes, matching the reference's observation rule. */
  async rememberUidUin(uid: string, uin: number | string): Promise<void> {
    this.#assertOpen("remember mapping");
    const normalizedUid = normalizeUid(uid);
    const normalizedUin = normalizeUin(uin);
    if (!normalizedUid || normalizedUin === null) return;
    await this.initialization;
    const oldUid = this.#uinToUid.get(normalizedUin);
    if (oldUid && oldUid !== normalizedUid) this.#uidToUin.delete(oldUid);
    const oldUin = this.#uidToUin.get(normalizedUid);
    if (oldUin !== undefined && oldUin !== normalizedUin) this.#uinToUid.delete(oldUin);
    this.#uidToUin.set(normalizedUid, normalizedUin);
    this.#uinToUid.set(normalizedUin, normalizedUid);
    try {
      if (this.#db) {
        const db = this.#db;
        db.exec("BEGIN");
        try {
          const existing = db.prepare("SELECT id FROM users WHERE uid = ? OR uin = ? ORDER BY id").all(normalizedUid, normalizedUin) as { id: number }[];
          const timestamp = Math.floor(Date.now() / 1000);
          if (existing.length > 0) {
            db.prepare("DELETE FROM users WHERE uid = ? OR uin = ?").run(normalizedUid, normalizedUin);
          }
          db.prepare(`INSERT INTO users (uid, uin, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(uid) DO UPDATE SET uin = excluded.uin, updated_at = excluded.updated_at`).run(
            normalizedUid, normalizedUin, timestamp,
          );
          db.exec("COMMIT");
        } catch (cause) {
          try { db.exec("ROLLBACK"); } catch { /* Preserve the write failure. */ }
          throw cause;
        }
      }
    } catch (cause) {
      throw persistenceError("write mapping", cause);
    }
  }

  async flush(): Promise<void> {
    this.#assertOpen("flush");
    try {
      await this.initialization;
      this.#db?.exec("PRAGMA wal_checkpoint(PASSIVE)");
    } catch (cause) {
      throw persistenceError("flush", cause);
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    try {
      await this.initialization;
      this.#db?.close();
      this.#db = null;
      this.#closed = true;
    } catch (cause) {
      throw persistenceError("close", cause);
    }
  }

  async #initialize(databasePath: string): Promise<void> {
    try {
      await mkdir(path.dirname(databasePath), { recursive: true });
      const db = new DatabaseSync(databasePath);
      this.#db = db;
      db.exec(`PRAGMA busy_timeout = 0;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          uid TEXT UNIQUE,
          uin INTEGER UNIQUE,
          nickname TEXT NOT NULL DEFAULT '',
          remark TEXT NOT NULL DEFAULT '',
          is_friend INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT '',
          updated_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_identity_users_uid ON users(uid);
        CREATE INDEX IF NOT EXISTS idx_identity_users_uin ON users(uin);`);
      const rows = db.prepare("SELECT uid, uin FROM users WHERE uid IS NOT NULL AND uin IS NOT NULL ORDER BY id").all() as { uid: unknown; uin: unknown }[];
      for (const row of rows) {
        const uid = normalizeUid(row.uid);
        const uin = normalizeUin(row.uin as number | string);
        if (!uid || uin === null) continue;
        this.#insertLoadedMapping(uid, uin);
      }
    } catch (cause) {
      try { this.#db?.close(); } catch { /* Preserve the initialization failure. */ }
      this.#db = null;
      throw persistenceError("initialize database", cause);
    }
  }

  #insertLoadedMapping(uid: string, uin: number): void {
    const currentUin = this.#uidToUin.get(uid);
    const currentUid = this.#uinToUid.get(uin);
    if ((currentUin !== undefined && currentUin !== uin) || (currentUid !== undefined && currentUid !== uid)) return;
    this.#uidToUin.set(uid, uin);
    this.#uinToUid.set(uin, uid);
  }

  #assertOpen(operation: string): void {
    if (this.#closed) throw new Error(`IdentityService is closed; cannot ${operation}`);
  }
}

function normalizeUid(uid: unknown): string {
  return typeof uid === "string" ? uid.trim() : "";
}

function normalizeUin(uin: number | string): number | null {
  const value = typeof uin === "number" ? uin : Number(uin.trim());
  if (!Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : null;
}

function persistenceError(operation: string, cause: unknown): Error {
  return new Error(`IdentityService failed to ${operation}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
}
