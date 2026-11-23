// `MediaStore` — the durable media metadata index behind `get_image` / `get_record`.
//
// ===========================================================================
// What this is, and where it comes from
// ===========================================================================
//
// Port of the reference's `../onebot/src/media-store.ts` (reference:22642-22862, the
// region that starts at `var MediaStore = class`). It is a two-table SQLite index that
// maps a media *key* to the metadata learned when the media was sent or received:
//
//     media_entries (type, primary_key)  -> data (JSON), last_seen
//     media_keys    (type, key)          -> primary_key
//
// **Why two tables rather than one.** A single media resource is known by several
// aliases — the sending client's `file`, the uploader's `fileName`, the server's
// `fileId`, and the CDN `url` are all the *same* resource. `get_image` is handed
// whichever one the caller has. So one row holds the data (keyed by a chosen PRIMARY
// key) and a side table maps every alias to that primary key. Lookup therefore resolves
// through `media_keys` first and falls back to a direct `primary_key` match:
//
//     SELECT data FROM media_entries
//      WHERE type = ?
//        AND primary_key = COALESCE(
//              (SELECT primary_key FROM media_keys WHERE type = ? AND key = ?),
//              ?)
//
// The `COALESCE(..., ?)` is load-bearing, not decoration: it is what makes the PRIMARY
// key itself addressable without also inserting a self-referential alias row, and it is
// the one clause a "simplification" would break. `find` and `findLegacyEntry` are the
// same statement against different table pairs.
//
// ===========================================================================
// The `legacy_` tables
// ===========================================================================
//
// `find` consults the CURRENT tables first and falls back to `legacy_media_entries` /
// `legacy_media_keys` (reference:22767). This is migration compatibility: a store that
// was re-indexed under different primary keys keeps the old rows addressable, so an old
// `file_id` a client still holds continues to resolve. Both table pairs are created at
// open; nothing here ever *writes* the legacy pair (the migration that produced it did),
// which is why `remember` only touches the current one.
//
// `find`'s `source` argument selects the ORDER, not a filter: `"current"` tries current
// and then legacy; `"legacy"` skips current entirely. The cache key carries the source
// so the two orders cannot poison each other.
//
// ===========================================================================
// `foldMediaKey` — why a key is sometimes replaced by a hash
// ===========================================================================
//
// A media key is used as an indexed TEXT column. Two kinds of input must not reach it
// verbatim:
//
//   1. **Inline payloads.** `data:image/png;base64,<megabytes>` and
//      `base64://<megabytes>` are self-contained sources with no length bound. Storing
//      one as a primary key would put a multi-megabyte string in an index page and in
//      every row that references it.
//   2. **Anything longer than 2048 characters**, which is the same problem with a
//      different cause (a signed URL, a very long file name).
//
// Both are folded to `inline:<sha256 hex>` — 71 characters, stable, and collision-
// resistant enough that the reference accepts it. `persistableMediaInfo` applies the same
// rule to `file` / `fileId` / `fileName`, and BLANKS an over-long `url` / `imageUrl`
// rather than folding it (a URL is not an identity — a plausible-looking folded URL would
// be a broken download link, while an empty one is an honest "no URL").
//
// ===========================================================================
// Divergences from the reference, and the reasons
// ===========================================================================
//
//  1. **`node:sqlite`'s `DatabaseSync` instead of `better-sqlite3`-style async driver.**
//     The reference's `SqliteDatabase` (reference:2955-3050) keeps a promise chain
//     (`serial()`) so that statements from different async callers cannot interleave
//     inside a transaction. `DatabaseSync` is synchronous, so every public method's body
//     after its single `await this.initialization` is one uninterrupted synchronous
//     block — the serialization the reference buys with a queue is free here. The
//     consequence is stated rather than hidden: `updateUrl` calls the PRIVATE sync
//     `#find` / `#remember` instead of the public async wrappers, so its
//     read-modify-write is atomic. Calling the wrappers would have reintroduced the
//     interleaving the reference's queue exists to prevent.
//
//  2. **`size()` uses `UNION ALL`, exactly as the reference does.** The task brief says
//     "UNION the two tables"; the reference (reference:22770) says `UNION ALL`, and the
//     difference is observable — `UNION` would deduplicate rows that happen to share a
//     `type` string, collapsing every count to at most one per type. `UNION ALL` is
//     correct and is what this port implements.
//
//  3. **No error swallowing around `initialization`.** The reference does
//     `this.initialization.catch(() => void 0)` in the constructor purely to silence an
//     unhandled rejection; this port keeps that (a host that never opens the store must
//     not crash on a rejected promise nobody awaited) but every public method awaits and
//     therefore propagates the real failure.
//
// ===========================================================================
// What this does NOT establish
// ===========================================================================
//
// A row here is a record that metadata *was observed*, not that the media is retrievable.
// `get_image` resolving a URL through this store still needs the URL to be live at the
// CDN, and nothing here validates that. There is no packet, no network call and no
// expiry: rows live until the database is deleted, which is the reference's behaviour
// ("Only the in-memory lookup cache is bounded; history dependencies never expire").

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

/** reference:22634-22636 `TYPE_IMAGE` / `TYPE_RECORD` / `TYPE_VIDEO`. */
export const TYPE_IMAGE = "image";
export const TYPE_RECORD = "record";
export const TYPE_VIDEO = "video";

/** reference:22637 `DEFAULT_KEEP_ENTRIES` — the lookup-cache bound, not a row limit. */
export const DEFAULT_KEEP_ENTRIES = 4096;

/**
 * reference:22638 `INLINE_MEDIA_SOURCE`.
 *
 * Anchored and case-insensitive. The `//` after `base64:` is load-bearing: a hypothetical
 * `base64:foo` (no slashes) is NOT an inline source in the reference, and matching it
 * here would fold a key the reference keeps verbatim.
 */
const INLINE_MEDIA_SOURCE = /^(base64:\/\/|data:)/i;

/** reference:22879 `value.length > 2048`. */
const MAX_MEDIA_KEY_LENGTH = 2048;

/** reference:22865 `data.length > 65536` — the JSON, not the key. */
const MAX_MEDIA_INFO_CHARACTERS = 65_536;

/** The three media types this store indexes. */
export type MediaType = typeof TYPE_IMAGE | typeof TYPE_RECORD | typeof TYPE_VIDEO;

/**
 * Which table pair `find` consults first.
 *
 * `"current"` = current then legacy (the production path). `"legacy"` = legacy only
 * (the migration/replay path the reference uses at reference:38663/38681/38697).
 */
export type MediaSource = "current" | "legacy";

/**
 * One media metadata row, as it is stored and returned.
 *
 * The reference is untyped (`info` is whatever the indexer passed in), and the field list
 * is large and only partly consumed: `getImageInfo` reads `url` / `imageUrl` / `file` /
 * `fileSize` / `fileName`, `getRecordInfo` reads `mediaNode` / `isGroup` / `sessionId` /
 * `fileName` / `fileSize`, and the rest (`md5Hex`, `width`, `duration`, …) is carried
 * verbatim so a later reader does not have to re-derive it. The open index signature says
 * exactly that: known fields are named for type safety, unknown ones survive.
 *
 * Every member is `| undefined` because `exactOptionalPropertyTypes` is on and the
 * indexer legitimately passes `md5Hex: element.md5Hex` even when the element has none.
 */
export interface MediaInfoRecord {
  [field: string]: unknown;
  type?: string | undefined;
  file?: string | undefined;
  fileId?: string | undefined;
  fileName?: string | undefined;
  fileSize?: number | undefined;
  fileHash?: string | undefined;
  url?: string | undefined;
  imageUrl?: string | undefined;
  md5Hex?: string | undefined;
  sha1Hex?: string | undefined;
  subType?: number | undefined;
  summary?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  picFormat?: number | undefined;
  duration?: number | undefined;
  voiceFormat?: number | undefined;
  videoFormat?: number | undefined;
  /** The NTV2 node a `record`/`video` download URL is requested with. Opaque here. */
  mediaNode?: unknown;
  flash?: unknown;
  isGroup?: boolean | undefined;
  sessionId?: number | undefined;
}

/** What `size()` reports. reference:22785. */
export interface MediaStoreSize {
  images: number;
  records: number;
  videos: number;
}

/** The prepared statements, created once per open. */
interface MediaStatements {
  readonly upsertEntry: StatementSync;
  readonly upsertKey: StatementSync;
  readonly findEntry: StatementSync;
  readonly findLegacyEntry: StatementSync;
  readonly countTypes: StatementSync;
}

/**
 * reference:22879 `mustFoldMediaKey`.
 *
 * Exported because the rule is a contract the tests pin at both boundaries (2048 vs 2049)
 * and the inline-source pattern at its case variants.
 */
export function mustFoldMediaKey(value: string): boolean {
  return value.length > MAX_MEDIA_KEY_LENGTH || INLINE_MEDIA_SOURCE.test(value);
}

/**
 * reference:22883 `foldMediaKey`.
 *
 * A falsy value folds to `""` (not a hash of `""`): an absent key must stay absent so
 * `pickPrimary` can skip it and `find` can answer `null` without a query. Everything else
 * either passes through verbatim or becomes `inline:<sha256 hex>`.
 */
export function foldMediaKey(value: string): string {
  if (!value) return "";
  if (!mustFoldMediaKey(value)) return value;
  return `inline:${createHash("sha256").update(value).digest("hex")}`;
}

/**
 * reference:22894 `persistableMediaInfo`.
 *
 * A copy, never the caller's object: the indexer's element is mutated elsewhere and a
 * stored row must be a snapshot.
 *
 * The two rules differ on purpose, and the difference is the interesting part:
 *
 *   * identity fields (`file` / `fileId` / `fileName`) are FOLDED — they are keys, and a
 *     folded key still resolves through `media_keys` because `find` folds the lookup the
 *     same way;
 *   * URL fields (`url` / `imageUrl`) are BLANKED — a URL is not an identity. A folded
 *     URL would be a syntactically valid string that downloads nothing, whereas `""` is
 *     the store's own "no URL" and every consumer already handles it.
 */
export function persistableMediaInfo(info: MediaInfoRecord): MediaInfoRecord {
  const next: MediaInfoRecord = { ...info };
  for (const field of ["file", "fileId", "fileName"] as const) {
    const value = next[field];
    if (typeof value === "string") next[field] = foldMediaKey(value);
  }
  for (const field of ["url", "imageUrl"] as const) {
    const value = next[field];
    if (typeof value === "string" && mustFoldMediaKey(value)) next[field] = "";
  }
  return next;
}

/**
 * reference:22882 `pickPrimary`.
 *
 * The first non-empty candidate, folded. Empty string (not `null`) when there is none, so
 * `remember` can test it with `if (!primary)` and fail with a message naming the type.
 */
export function pickPrimary(candidates: readonly (string | undefined)[]): string {
  for (const candidate of candidates) {
    if (candidate && candidate.length > 0) return foldMediaKey(candidate);
  }
  return "";
}

/**
 * reference:22864 `serializeMediaInfo`.
 *
 * A hard cap on the serialized row rather than an advisory one: a metadata object of
 * 65536+ characters is a bug in the caller (a raw payload leaked into a field nobody
 * folds), and truncating it silently would corrupt every later read.
 */
export function serializeMediaInfo(info: MediaInfoRecord): string {
  const data = JSON.stringify(persistableMediaInfo(info));
  if (data.length > MAX_MEDIA_INFO_CHARACTERS) {
    throw new Error(`media metadata exceeds storage limit (${data.length} characters)`);
  }
  return data;
}

/**
 * reference:22870 `rollbackMediaTransaction`.
 *
 * Rolls back, then rethrows the ORIGINAL error so the caller sees why the write failed
 * rather than why the rollback did. When the rollback fails too, both are reported: a
 * store that cannot roll back has a half-applied transaction, and which of the two
 * failures surfaces first matters to whoever debugs it.
 */
function rollbackMediaTransaction(db: DatabaseSync, error: unknown): never {
  try {
    db.exec("ROLLBACK");
  } catch (rollbackError) {
    throw new AggregateError([error, rollbackError], "media write and rollback failed", { cause: error });
  }
  throw error;
}

/**
 * Durable media metadata.
 *
 * Production shares `data/<uin>/messages.db` with `MessageStore` (reference:342767); this
 * port's `MessageStore` is in-memory, so the file is the only durable half. `":memory:"`
 * is accepted and is a real SQLite database, just not persisted — the right choice for a
 * test and the wrong one for a host, which is why the host's default is documented at the
 * injection point rather than here.
 */
export class MediaStore {
  /** reference:22643 `maxCachedEntries` — the LOOKUP cache bound; rows are unbounded. */
  readonly maxCachedEntries: number;

  /** Resolves once the tables and statements exist. Every method awaits it. */
  readonly initialization: Promise<void>;

  /** `source:type:foldedKey` → the stored JSON. Recency order = insertion order. */
  readonly #cache = new Map<string, string>();

  #db: DatabaseSync | null = null;
  #statements: MediaStatements | null = null;
  #closed = false;

  constructor(dbPath: string, maxCachedEntries: number = DEFAULT_KEEP_ENTRIES) {
    if (!dbPath) throw new Error("MediaStore requires a database path (use \":memory:\" for a volatile store)");
    this.maxCachedEntries = maxCachedEntries;
    this.initialization = this.#initialize(dbPath);
    // reference:22689 — silence the unhandled rejection; every public method awaits the
    // same promise and therefore still reports the failure to its caller.
    this.initialization.catch(() => undefined);
  }

  /** True once `close()` has run. Exposed so a host can avoid a double close. */
  get closed(): boolean {
    return this.#closed;
  }

  /** Retained lookup-cache entries. Diagnostic surface; the ROW count is `size()`. */
  get cachedEntries(): number {
    return this.#cache.size;
  }

  /**
   * The cache keys in recency order (least recently used first).
   *
   * Diagnostic surface, and the only way to observe the LRU contract from outside: a
   * cache HIT and a cache MISS are indistinguishable through `find` (both answer the same
   * row), so a bound test that did not look at the keys could not tell LRU from FIFO —
   * which is the one property worth pinning.
   */
  get cacheKeys(): readonly string[] {
    return [...this.#cache.keys()];
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async #initialize(dbPath: string): Promise<void> {
    // reference:2964 — `":memory:"` has no directory, and `path.dirname` would yield
    // `"."`; creating that is harmless but misleading in an error message.
    if (dbPath !== ":memory:") await mkdir(path.dirname(path.resolve(dbPath)), { recursive: true });
    const db = new DatabaseSync(dbPath);
    try {
      // reference:2971-2977 — the shared durability defaults. `busy_timeout` matters
      // because a second connection (a migration, or a test's own writer) may hold the
      // write lock; WAL because the file is shared with the message store.
      db.exec("PRAGMA busy_timeout = 1000");
      db.exec("PRAGMA foreign_keys = ON");
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = NORMAL");

      // reference:22651-22660 — the SAME two tables under both prefixes. `legacy_` is
      // created here and read by `find`; nothing in this class ever writes it.
      for (const prefix of ["", "legacy_"]) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS ${prefix}media_entries (
            type TEXT NOT NULL, primary_key TEXT NOT NULL, data TEXT NOT NULL,
            last_seen INTEGER NOT NULL, PRIMARY KEY (type, primary_key)
          );
          CREATE TABLE IF NOT EXISTS ${prefix}media_keys (
            type TEXT NOT NULL, key TEXT NOT NULL, primary_key TEXT NOT NULL,
            PRIMARY KEY (type, key)
          );
        `);
      }

      const statements: MediaStatements = {
        upsertEntry: db.prepare(`
          INSERT INTO media_entries (type, primary_key, data, last_seen) VALUES (?, ?, ?, ?)
          ON CONFLICT(type, primary_key) DO UPDATE SET data = excluded.data, last_seen = excluded.last_seen
        `),
        upsertKey: db.prepare(`
          INSERT INTO media_keys (type, key, primary_key) VALUES (?, ?, ?)
          ON CONFLICT(type, key) DO UPDATE SET primary_key = excluded.primary_key
        `),
        // The `COALESCE` is the whole point: resolve the alias, and when there is no
        // alias row, match the primary key directly. See the header.
        findEntry: db.prepare(`
          SELECT data FROM media_entries WHERE type = ? AND primary_key = COALESCE(
            (SELECT primary_key FROM media_keys WHERE type = ? AND key = ?), ?
          )
        `),
        findLegacyEntry: db.prepare(`
          SELECT data FROM legacy_media_entries WHERE type = ? AND primary_key = COALESCE(
            (SELECT primary_key FROM legacy_media_keys WHERE type = ? AND key = ?), ?
          )
        `),
        // Both table pairs, and NOT deduplicated by type — see divergence 2.
        countTypes: db.prepare(`
          SELECT type, COUNT(*) AS n FROM (
            SELECT type FROM media_entries UNION ALL SELECT type FROM legacy_media_entries
          ) GROUP BY type
        `),
      };

      this.#db = db;
      this.#statements = statements;
    } catch (cause) {
      // reference:2979-2988 — close what opened before reporting, so a failed open does
      // not leave a descriptor (and, for a file, a WAL sidecar) behind.
      try {
        db.close();
      } catch (closeError) {
        throw new AggregateError(
          [cause, closeError],
          "MediaStore initialization and cleanup failed",
          { cause },
        );
      }
      throw new Error(
        `MediaStore failed to initialize ${dbPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
  }

  /**
   * Close the database. Idempotent.
   *
   * Awaits `initialization` first so a close racing an open cannot call `close()` on a
   * handle that does not exist yet, and swallows an initialization failure — there is
   * nothing to close in that case and the failure already reached whoever awaited it.
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    await this.initialization.catch(() => undefined);
    this.#statements = null;
    try {
      this.#db?.close();
    } finally {
      this.#db = null;
      this.#closed = true;
      this.#cache.clear();
    }
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /**
   * reference:22690 `rememberImage`.
   *
   * Aliases are `file` / `fileName` / `url` — the three identifiers an image segment
   * carries. `fileId` is included for records and videos but NOT images, matching the
   * reference: an image's `file` already falls back to `fileId` at the indexer
   * (reference:40385 `file || element.fileId`), so adding it again would only create a
   * second alias row for the same value.
   */
  async rememberImage(info: MediaInfoRecord): Promise<void> {
    this.#assertOpen("remember an image");
    await this.initialization;
    this.#remember(TYPE_IMAGE, structuredClone(info), [info.file, info.fileName, info.url]);
  }

  /** reference:22701 `rememberRecord`. Aliases: `file` / `fileName` / `fileId` / `url`. */
  async rememberRecord(info: MediaInfoRecord): Promise<void> {
    this.#assertOpen("remember a record");
    await this.initialization;
    this.#remember(TYPE_RECORD, structuredClone(info), [info.file, info.fileName, info.fileId, info.url]);
  }

  /** reference:22713 `rememberVideo`. Same aliases as a record. */
  async rememberVideo(info: MediaInfoRecord): Promise<void> {
    this.#assertOpen("remember a video");
    await this.initialization;
    this.#remember(TYPE_VIDEO, structuredClone(info), [info.file, info.fileName, info.fileId, info.url]);
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** reference:22725 `findImage`. */
  async findImage(key: string, source: MediaSource = "current"): Promise<MediaInfoRecord | null> {
    this.#assertOpen("find an image");
    await this.initialization;
    return this.#find(TYPE_IMAGE, key, source);
  }

  /** reference:22731 `findRecord`. */
  async findRecord(key: string, source: MediaSource = "current"): Promise<MediaInfoRecord | null> {
    this.#assertOpen("find a record");
    await this.initialization;
    return this.#find(TYPE_RECORD, key, source);
  }

  /** reference:22737 `findVideo`. */
  async findVideo(key: string, source: MediaSource = "current"): Promise<MediaInfoRecord | null> {
    this.#assertOpen("find a video");
    await this.initialization;
    return this.#find(TYPE_VIDEO, key, source);
  }

  // -------------------------------------------------------------------------
  // URL rewrites
  // -------------------------------------------------------------------------

  /** reference:22743 `updateImageUrl`. */
  async updateImageUrl(key: string, url: string): Promise<void> {
    this.#assertOpen("update an image URL");
    await this.initialization;
    this.#updateUrl(TYPE_IMAGE, key, url);
  }

  /** reference:22749 `updateRecordUrl`. */
  async updateRecordUrl(key: string, url: string): Promise<void> {
    this.#assertOpen("update a record URL");
    await this.initialization;
    this.#updateUrl(TYPE_RECORD, key, url);
  }

  /** reference:22755 `updateVideoUrl`. */
  async updateVideoUrl(key: string, url: string): Promise<void> {
    this.#assertOpen("update a video URL");
    await this.initialization;
    this.#updateUrl(TYPE_VIDEO, key, url);
  }

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  /**
   * reference:22761 `size`.
   *
   * Counts ROWS, not cache entries — the lookup cache is bounded and evicting from it
   * must not make the store look emptier. Both table pairs are counted (a migrated store
   * answers its full history) and `UNION ALL` keeps per-type counts independent.
   */
  async size(): Promise<MediaStoreSize> {
    this.#assertOpen("count media");
    await this.initialization;
    const rows = this.#requireStatements().countTypes.all() as { type?: unknown; n?: unknown }[];
    const count = (type: MediaType): number => {
      const row = rows.find((candidate) => candidate.type === type);
      return typeof row?.n === "number" ? row.n : Number(row?.n ?? 0);
    };
    return { images: count(TYPE_IMAGE), records: count(TYPE_RECORD), videos: count(TYPE_VIDEO) };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * reference:22788 `remember`.
   *
   * Synchronous, and that is the transaction: `BEGIN IMMEDIATE` … `COMMIT` cannot be
   * interleaved by another caller because there is no `await` between them. `IMMEDIATE`
   * (not the default `DEFERRED`) takes the write lock up front, so the transaction cannot
   * fail partway through on a lock upgrade — the same reason the reference chose it.
   *
   * The whole cache is dropped afterwards rather than just the affected key: the write may
   * have re-pointed an alias, and a stale entry under any other key would then resolve to
   * a row that no longer exists.
   */
  #remember(type: MediaType, info: MediaInfoRecord, aliases: readonly (string | undefined)[]): void {
    const primary = pickPrimary(aliases);
    if (!primary) throw new Error(`cannot store ${type} metadata without an identifier`);
    const data = serializeMediaInfo(info);
    const statements = this.#requireStatements();
    const db = this.#requireDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      statements.upsertEntry.run(type, primary, data, Math.floor(Date.now() / 1_000));
      // `Set` collapses two aliases that fold to the same key (a `file` and a `fileName`
      // that happen to be equal), which would otherwise be a duplicate upsert of the
      // same row.
      const keys = new Set(
        aliases.filter((alias): alias is string => typeof alias === "string" && alias.length > 0).map(foldMediaKey),
      );
      for (const key of keys) statements.upsertKey.run(type, key, primary);
      db.exec("COMMIT");
    } catch (error) {
      rollbackMediaTransaction(db, error);
    }
    this.#cache.clear();
  }

  /**
   * reference:22799 `find`.
   *
   * `source === "current"` tries the current table and then the legacy one; `"legacy"`
   * skips current. A miss is NOT negatively cached — the row may be written by the next
   * inbound message, and a negative cache would answer `null` for it.
   */
  #find(type: MediaType, key: string, source: MediaSource): MediaInfoRecord | null {
    const lookup = foldMediaKey(key);
    if (!lookup) return null;
    const cacheKey = `${source}:${type}:${lookup}`;
    let data = this.#cache.get(cacheKey);
    if (data === undefined) {
      const statements = this.#requireStatements();
      const row =
        (source === "current" ? statements.findEntry.get(type, type, lookup, lookup) : undefined) ??
        statements.findLegacyEntry.get(type, type, lookup, lookup);
      if (!row) return null;
      const stored = row["data"];
      if (typeof stored !== "string") throw new Error(`invalid persisted ${type} metadata`);
      data = stored;
    }
    const result: unknown = JSON.parse(data);
    // A row whose `data` is valid JSON but not an object (`null`, `[]`, `42`) is corrupt;
    // answering it would make every consumer guard against a shape the writer forbids.
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error(`invalid persisted ${type} metadata`);
    }
    // LRU touch: re-insert so the Map's iteration order stays recency order. Without this
    // the eviction below would be FIFO and a hot key would be dropped first.
    this.#cache.delete(cacheKey);
    this.#cache.set(cacheKey, data);
    while (this.#cache.size > Math.max(0, this.maxCachedEntries)) {
      const oldest = this.#cache.keys().next();
      if (oldest.done === true) break;
      this.#cache.delete(oldest.value);
    }
    return result as MediaInfoRecord;
  }

  /**
   * reference:22830 `updateUrl`.
   *
   * Two refusals, both load-bearing:
   *
   *   * `!url` — an empty URL means "the resolver had nothing", and writing it would
   *     erase a URL that a previous refresh DID resolve.
   *   * `mustFoldMediaKey(url)` — an over-long or inline URL must never be persisted.
   *     Folding it would store a hash-shaped string that is not a URL; writing it
   *     verbatim would put the payload in the database, which is the exact failure
   *     `foldMediaKey` exists to prevent. Not writing is the only honest option.
   *
   * `info.url === url` short-circuits, so a repeated refresh does not churn `last_seen`
   * or drop the cache.
   */
  #updateUrl(type: MediaType, key: string, url: string | null | undefined): void {
    if (!url || mustFoldMediaKey(url)) return;
    const info = this.#find(type, key, "current");
    if (!info || info.url === url) return;
    this.#remember(
      type,
      { ...info, url },
      [info.file, info.fileName, info.fileId, url].filter(
        (value): value is string => typeof value === "string",
      ),
    );
  }

  #assertOpen(operation: string): void {
    if (this.#closed) throw new Error(`MediaStore is closed; cannot ${operation}`);
  }

  #requireStatements(): MediaStatements {
    if (this.#statements === null) throw new Error("MediaStore is not open");
    return this.#statements;
  }

  #requireDatabase(): DatabaseSync {
    if (this.#db === null) throw new Error("MediaStore is not open");
    return this.#db;
  }
}
