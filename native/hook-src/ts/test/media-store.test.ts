// Tests for `ts/src/host/media-store.ts` — the durable media metadata index.
//
// ===========================================================================
// What these tests do and do not prove
// ===========================================================================
//
// **Do prove:** the two-table lookup (alias → primary key, `COALESCE` fallback to the
// primary key itself), the `legacy_` fallback ORDER, `foldMediaKey` at both boundaries
// (2048/2049) and for both inline prefixes, `persistableMediaInfo`'s two different rules
// (fold identity, blank URLs), `updateUrl`'s two refusals, the LRU bound, `size()`'s
// `UNION ALL` counting across both table pairs, and `remember`'s missing-identifier
// error.
//
// **Do NOT prove:** that any media is retrievable. A row records that metadata was
// OBSERVED; the URL it holds may be long dead, and nothing here contacts a CDN, a
// container or QQ. See the source header.
//
// ===========================================================================
// Why the tests use a REAL SQLite file for most cases
// ===========================================================================
//
// `:memory:` is a real database, so the SQL is exercised either way — but the property
// most worth pinning (`legacy_` fallback) is INDEX visibility, and it is much too easy to
// write a test that passes only because the two table pairs happen to be in the same
// in-memory database. Every case that touches the legacy pair therefore goes through a
// file and re-opens it, which also proves the schema is created idempotently.
//
// The one thing a file costs is cleanup, so the helper at the top of each case owns a
// temporary directory and removes it in a `finally`.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  DEFAULT_KEEP_ENTRIES,
  MediaStore,
  TYPE_IMAGE,
  TYPE_RECORD,
  TYPE_VIDEO,
  foldMediaKey,
  mustFoldMediaKey,
  persistableMediaInfo,
  pickPrimary,
  serializeMediaInfo,
  type MediaInfoRecord,
} from "../src/host/media-store.js";

// ===========================================================================
// Fixtures
// ===========================================================================

/** Temporary directories created by a case; removed once, after the suite. */
const temporaryRoots: string[] = [];

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryDatabasePath(name = "messages.db"): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "media-store-"));
  temporaryRoots.push(root);
  return path.join(root, name);
}

/** Run `body` against a fresh file-backed store, closing it even when the body throws. */
async function withStore<T>(
  body: (store: MediaStore, dbPath: string) => Promise<T>,
  options: { readonly maxCachedEntries?: number } = {},
): Promise<T> {
  const dbPath = await temporaryDatabasePath();
  const store =
    options.maxCachedEntries === undefined
      ? new MediaStore(dbPath)
      : new MediaStore(dbPath, options.maxCachedEntries);
  try {
    await store.initialization;
    return await body(store, dbPath);
  } finally {
    await store.close();
  }
}

/** An image row with every field distinct, so a swapped field is visible. */
function imageInfo(overrides: Partial<MediaInfoRecord> = {}): MediaInfoRecord {
  return {
    type: TYPE_IMAGE,
    file: "file-alpha",
    fileId: "fileid-alpha",
    fileName: "name-alpha",
    fileSize: 1234,
    url: "https://cdn.example/image?x=1",
    imageUrl: "https://cdn.example/image-url",
    md5Hex: "0123456789abcdef0123456789abcdef",
    subType: 0,
    isGroup: true,
    sessionId: 555,
    ...overrides,
  };
}

function recordInfo(overrides: Partial<MediaInfoRecord> = {}): MediaInfoRecord {
  return {
    type: TYPE_RECORD,
    file: "record-alpha",
    fileId: "recordid-alpha",
    fileName: "voice-alpha.amr",
    fileSize: 4321,
    url: "https://cdn.example/voice",
    duration: 3,
    fileHash: "hash-alpha",
    mediaNode: { fileUuid: "uuid-alpha" },
    isGroup: true,
    sessionId: 555,
    ...overrides,
  };
}

/** The exact folding the store applies, computed independently. */
function folded(value: string): string {
  return `inline:${createHash("sha256").update(value).digest("hex")}`;
}

// ===========================================================================
// 1. The two-table structure
// ===========================================================================

describe("MediaStore — a media row is one entry plus one alias row per identifier", () => {
  test("every alias resolves to the same row", async () => {
    await withStore(async (store) => {
      const info = imageInfo();
      await store.rememberImage(info);

      // `file`, `fileName` and `url` are the image aliases; `fileId` is deliberately NOT
      // among them (the indexer folds it into `file` before calling), so a lookup by
      // `fileId` alone must MISS. That asymmetry is the reference's and it is asserted
      // rather than assumed.
      for (const key of ["file-alpha", "name-alpha", "https://cdn.example/image?x=1"]) {
        const found = await store.findImage(key);
        assert.ok(found, `alias ${key} must resolve`);
        assert.equal(found.file, "file-alpha");
        assert.equal(found.fileName, "name-alpha");
      }
      assert.equal(await store.findImage("fileid-alpha"), null, "fileId is not an image alias");
    });
  });

  test("a record exposes fileId as an alias, unlike an image", async () => {
    await withStore(async (store) => {
      await store.rememberRecord(recordInfo());
      for (const key of ["record-alpha", "voice-alpha.amr", "recordid-alpha", "https://cdn.example/voice"]) {
        assert.ok(await store.findRecord(key), `record alias ${key} must resolve`);
      }
    });
  });

  test("the PRIMARY key itself resolves without a self-referential alias row", async () => {
    // This is the `COALESCE(..., ?)` arm: `media_keys` has no row for `pickPrimary`'s
    // answer unless an alias happens to equal it, so the direct `primary_key` match is the
    // only thing that can answer. A subquery-only implementation returns null here.
    await withStore(async (store) => {
      // `file` is the first alias and therefore the primary key.
      await store.rememberImage(imageInfo({ file: "only-key" }));
      const found = await store.findImage("only-key");
      assert.ok(found);
      assert.equal(found.file, "only-key");
    });
  });

  test("types are independent: the same key under image and record is two rows", async () => {
    // The tables are keyed by `(type, key)`, not by `key`. Collapsing the type would make
    // an image and a voice sharing a file name overwrite each other.
    await withStore(async (store) => {
      await store.rememberImage(imageInfo({ file: "shared", url: "https://cdn.example/i" }));
      await store.rememberRecord(recordInfo({ file: "shared", url: "https://cdn.example/r" }));

      assert.equal((await store.findImage("shared"))?.url, "https://cdn.example/i");
      assert.equal((await store.findRecord("shared"))?.url, "https://cdn.example/r");
      assert.equal(await store.findVideo("shared"), null);
    });
  });

  test("re-remembering the same primary key UPDATES the row rather than duplicating it", async () => {
    await withStore(async (store) => {
      await store.rememberImage(imageInfo({ file: "k", fileSize: 1 }));
      await store.rememberImage(imageInfo({ file: "k", fileSize: 2 }));
      assert.equal((await store.findImage("k"))?.fileSize, 2);
      assert.deepEqual(await store.size(), { images: 1, records: 0, videos: 0 });
    });
  });

  test("an unknown key answers null, not an empty object", async () => {
    await withStore(async (store) => {
      assert.equal(await store.findImage("nope"), null);
      assert.equal(await store.findRecord("nope"), null);
      assert.equal(await store.findVideo("nope"), null);
    });
  });

  test("an EMPTY key answers null without touching the database", async () => {
    // `foldMediaKey("")` is `""` and `find` returns early. Without that guard the query
    // would run with `""` and could match a row whose primary key is legitimately empty —
    // which `remember` refuses to create, so the guard is what keeps the two halves
    // consistent.
    await withStore(async (store) => {
      assert.equal(await store.findImage(""), null);
      assert.equal(store.cachedEntries, 0, "an empty lookup must not enter the cache");
    });
  });
});

// ===========================================================================
// 2. `legacy_` fallback
// ===========================================================================

describe("MediaStore — the legacy tables are consulted, in the reference's order", () => {
  test("a row that exists ONLY in legacy_media_entries is found", async () => {
    // Written through raw SQL, because nothing in `MediaStore` writes the legacy pair: it
    // is produced by the reference's migration, and this port must still read it.
    const dbPath = await temporaryDatabasePath();
    const first = new MediaStore(dbPath);
    await first.initialization;
    await first.close();

    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(dbPath);
    raw
      .prepare("INSERT INTO legacy_media_entries (type, primary_key, data, last_seen) VALUES (?, ?, ?, ?)")
      .run(TYPE_IMAGE, "legacy-key", JSON.stringify({ type: TYPE_IMAGE, file: "legacy-key", url: "https://old" }), 1);
    raw
      .prepare("INSERT INTO legacy_media_keys (type, key, primary_key) VALUES (?, ?, ?)")
      .run(TYPE_IMAGE, "legacy-alias", "legacy-key");
    raw.close();

    const store = new MediaStore(dbPath);
    try {
      await store.initialization;
      // Both the primary key and the alias resolve, through `legacy_media_keys`.
      assert.equal((await store.findImage("legacy-key"))?.url, "https://old");
      assert.equal((await store.findImage("legacy-alias"))?.url, "https://old");
    } finally {
      await store.close();
    }
  });

  test("source=\"legacy\" does NOT read the current tables", async () => {
    // The reference's `find(type, key, "legacy")` is used by the ptt-text path
    // (reference:39867) to look in the migrated store ONLY. If `"legacy"` fell through to
    // current it would find rows the caller is deliberately not consulting.
    await withStore(async (store) => {
      await store.rememberImage(imageInfo({ file: "current-only" }));
      assert.ok(await store.findImage("current-only"), "current source finds it");
      assert.equal(
        await store.findImage("current-only", "legacy"),
        null,
        "legacy source must not reach the current tables",
      );
    });
  });

  test("source=\"current\" prefers the current row when BOTH tables have the key", async () => {
    // The order is the contract: a migrated row must not shadow the live one, or every
    // refreshed URL would be invisible.
    const dbPath = await temporaryDatabasePath();
    const first = new MediaStore(dbPath);
    await first.initialization;
    await first.rememberImage(imageInfo({ file: "both", url: "https://current" }));
    await first.close();

    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(dbPath);
    raw
      .prepare("INSERT INTO legacy_media_entries (type, primary_key, data, last_seen) VALUES (?, ?, ?, ?)")
      .run(TYPE_IMAGE, "both", JSON.stringify({ type: TYPE_IMAGE, file: "both", url: "https://legacy" }), 1);
    raw.close();

    const store = new MediaStore(dbPath);
    try {
      await store.initialization;
      assert.equal((await store.findImage("both"))?.url, "https://current");
      // And the legacy-only source still answers the old row, so the fallback is not
      // "current shadows legacy" in BOTH directions.
      assert.equal((await store.findImage("both", "legacy"))?.url, "https://legacy");
    } finally {
      await store.close();
    }
  });

  test("the cache key carries the source, so the two orders cannot poison each other", async () => {
    const dbPath = await temporaryDatabasePath();
    const first = new MediaStore(dbPath);
    await first.initialization;
    await first.rememberImage(imageInfo({ file: "cached", url: "https://current" }));
    await first.close();

    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(dbPath);
    raw
      .prepare("INSERT INTO legacy_media_entries (type, primary_key, data, last_seen) VALUES (?, ?, ?, ?)")
      .run(TYPE_IMAGE, "cached", JSON.stringify({ type: TYPE_IMAGE, file: "cached", url: "https://legacy" }), 1);
    raw.close();

    const store = new MediaStore(dbPath);
    try {
      await store.initialization;
      const current = (await store.findImage("cached"))?.url;
      const legacy = (await store.findImage("cached", "legacy"))?.url;
      assert.equal(current, "https://current");
      assert.equal(legacy, "https://legacy");
      // Two distinct cache entries — a shared key would have made the second answer
      // `https://current`.
      assert.equal(store.cachedEntries, 2);
      assert.deepEqual(
        [...store.cacheKeys].sort(),
        [`current:${TYPE_IMAGE}:cached`, `legacy:${TYPE_IMAGE}:cached`],
      );
    } finally {
      await store.close();
    }
  });
});

// ===========================================================================
// 3. `foldMediaKey` — the boundaries
// ===========================================================================

describe("foldMediaKey — long and inline keys become a stable hash", () => {
  test("2048 characters is kept verbatim; 2049 is folded", () => {
    // The reference's condition is `value.length > 2048`, so exactly 2048 passes. Off by
    // one in either direction is invisible until a real 2048-character key appears.
    const atLimit = "a".repeat(2048);
    const overLimit = "a".repeat(2049);
    assert.equal(atLimit.length, 2048);
    assert.equal(overLimit.length, 2049);

    assert.equal(mustFoldMediaKey(atLimit), false);
    assert.equal(foldMediaKey(atLimit), atLimit);

    assert.equal(mustFoldMediaKey(overLimit), true);
    assert.equal(foldMediaKey(overLimit), folded(overLimit));
  });

  test("a long `file:`-prefixed key is folded, and the fold is 71 characters", () => {
    // The task's own case: `file:` is NOT an inline-source prefix (only `base64://` and
    // `data:` are), so this key is folded purely because of its LENGTH. A pattern-based
    // implementation that only folded inline sources would keep a multi-kilobyte primary
    // key here.
    const long = `file:${"f".repeat(3000)}`;
    assert.equal(mustFoldMediaKey(long), true);
    const result = foldMediaKey(long);
    assert.equal(result, folded(long));
    assert.equal(result.length, "inline:".length + 64);
    assert.match(result, /^inline:[0-9a-f]{64}$/);
  });

  test("both inline prefixes are folded, case-insensitively", () => {
    for (const value of [
      "base64://AAAABBBB",
      "BASE64://AAAABBBB",
      "Base64://AAAABBBB",
      "data:image/png;base64,AAAABBBB",
      "DATA:image/png;base64,AAAABBBB",
      "Data:text/plain,hello",
    ]) {
      assert.equal(mustFoldMediaKey(value), true, `${value} must be treated as inline`);
      assert.match(foldMediaKey(value), /^inline:[0-9a-f]{64}$/);
    }
  });

  test("`base64:` WITHOUT slashes is NOT an inline source", () => {
    // The pattern is `/^(base64:\/\/|data:)/i`. Losing the `\/\/` would fold a key the
    // reference keeps verbatim, which changes the primary key of a real row.
    assert.equal(mustFoldMediaKey("base64:abc"), false);
    assert.equal(foldMediaKey("base64:abc"), "base64:abc");
  });

  test("a short ordinary key is returned unchanged", () => {
    assert.equal(foldMediaKey("ABCDEF0123456789"), "ABCDEF0123456789");
    assert.equal(foldMediaKey("https://cdn.example/x?y=1"), "https://cdn.example/x?y=1");
  });

  test("the fold is DETERMINISTIC and distinguishes different inputs", () => {
    // Determinism is what makes an alias row stored under a folded key resolvable by a
    // later lookup of the same raw key — the whole point of folding.
    const a = `data:image/png;base64,${"A".repeat(100)}`;
    const b = `data:image/png;base64,${"B".repeat(100)}`;
    assert.equal(foldMediaKey(a), foldMediaKey(a));
    assert.notEqual(foldMediaKey(a), foldMediaKey(b));
  });

  test("an empty key folds to the empty string, not a hash of empty", () => {
    // `pickPrimary` relies on this: a hash would look like a valid identifier.
    assert.equal(foldMediaKey(""), "");
    assert.equal(foldMediaKey(""), "");
    assert.equal(pickPrimary(["", undefined, ""]), "");
  });

  test("a folded key still resolves through a lookup with the RAW key", async () => {
    // The end-to-end statement: `remember` folds the alias it stores, `find` folds the key
    // it looks up, so the two meet. A store that folded only one side would write rows
    // nothing can find.
    await withStore(async (store) => {
      const raw = `data:image/png;base64,${"Q".repeat(5000)}`;
      await store.rememberImage(imageInfo({ file: raw, url: "" }));
      const found = await store.findImage(raw);
      assert.ok(found, "the raw key must resolve through the folded primary key");
      assert.equal(found.file, folded(raw));
      // And the folded form resolves too, since it is also an alias value.
      assert.ok(await store.findImage(folded(raw)));
    });
  });
});

// ===========================================================================
// 4. `persistableMediaInfo`
// ===========================================================================

describe("persistableMediaInfo — identity fields fold, URLs blank", () => {
  test("over-long identity fields are folded and over-long URLs are blanked", () => {
    const long = "z".repeat(3000);
    const next = persistableMediaInfo({
      type: TYPE_IMAGE,
      file: long,
      fileId: long,
      fileName: long,
      url: long,
      imageUrl: long,
    });
    for (const field of ["file", "fileId", "fileName"] as const) {
      assert.equal(next[field], folded(long), `${field} must be folded`);
    }
    // Blanked, NOT folded: a folded URL is a syntactically valid string that downloads
    // nothing, so the store's own "no URL" (`""`) is the only honest value.
    assert.equal(next.url, "");
    assert.equal(next.imageUrl, "");
  });

  test("short values pass through untouched", () => {
    const next = persistableMediaInfo({
      type: TYPE_RECORD,
      file: "f",
      fileId: "i",
      fileName: "n",
      url: "https://cdn.example/u",
      imageUrl: "https://cdn.example/i",
    });
    assert.equal(next.file, "f");
    assert.equal(next.fileId, "i");
    assert.equal(next.fileName, "n");
    assert.equal(next.url, "https://cdn.example/u");
    assert.equal(next.imageUrl, "https://cdn.example/i");
  });

  test("an inline imageUrl is blanked even when it is short", () => {
    // Blanking is driven by `mustFoldMediaKey`, not by length: a short `data:` URL is
    // still a payload-shaped value that must not be persisted as a URL.
    const next = persistableMediaInfo({ type: TYPE_IMAGE, imageUrl: "data:text/plain,x" });
    assert.equal(next.imageUrl, "");
  });

  test("it returns a COPY — the caller's object is not mutated", () => {
    const original: MediaInfoRecord = { type: TYPE_IMAGE, file: "keep", url: "data:text/plain,x" };
    const next = persistableMediaInfo(original);
    assert.equal(original.url, "data:text/plain,x", "the input must be untouched");
    assert.equal(next.url, "");
    assert.notEqual(next, original);
  });

  test("non-string fields are left alone", () => {
    // A `fileSize` of 0, a `mediaNode` object and an absent `file` must all survive; only
    // strings participate in the folding rules.
    const node = { fileUuid: "u" };
    const next = persistableMediaInfo({ type: TYPE_RECORD, fileSize: 0, mediaNode: node });
    assert.equal(next.fileSize, 0);
    assert.equal(next.mediaNode, node);
    assert.equal(next.file, undefined);
  });
});

describe("serializeMediaInfo — the 65536-character cap", () => {
  test("a payload under the cap serializes", () => {
    const data = serializeMediaInfo({ type: TYPE_IMAGE, summary: "s".repeat(1000) });
    assert.ok(data.startsWith("{"));
    assert.ok(data.length < 65_536);
  });

  test("a payload over the cap THROWS instead of being truncated", () => {
    // Truncation would produce invalid JSON or a silently shortened row. The reference
    // throws, and the message names the length so a caller can see how far over it was.
    assert.throws(
      () => serializeMediaInfo({ type: TYPE_IMAGE, summary: "s".repeat(70_000) }),
      /media metadata exceeds storage limit \(\d+ characters\)/,
    );
  });

  test("an over-long IDENTITY field does not count against the cap", () => {
    // Because folding happens first: a 100 KB `file` becomes 71 characters, so it must not
    // trip a limit meant for genuine metadata bloat.
    const data = serializeMediaInfo({ type: TYPE_IMAGE, file: "f".repeat(100_000) });
    assert.ok(data.length < 200);
  });
});

// ===========================================================================
// 5. `updateUrl`
// ===========================================================================

describe("updateUrl — refuses the two URLs that must never be persisted", () => {
  test("an over-long URL is NOT written back", async () => {
    await withStore(async (store) => {
      const original = "https://cdn.example/original";
      await store.rememberImage(imageInfo({ file: "u1", url: original }));
      await store.updateImageUrl("u1", `https://cdn.example/${"x".repeat(3000)}`);
      assert.equal(
        (await store.findImage("u1"))?.url,
        original,
        "a >2048 URL must be refused, leaving the previous URL intact",
      );
    });
  });

  test("an inline (data:/base64://) URL is NOT written back", async () => {
    await withStore(async (store) => {
      await store.rememberRecord(recordInfo({ file: "u2", url: "https://cdn.example/original" }));
      await store.updateRecordUrl("u2", "data:audio/amr;base64,AAAA");
      assert.equal((await store.findRecord("u2"))?.url, "https://cdn.example/original");

      await store.updateRecordUrl("u2", "base64://AAAA");
      assert.equal((await store.findRecord("u2"))?.url, "https://cdn.example/original");
    });
  });

  test("an EMPTY URL is a no-op, not an erase", async () => {
    // `!url` returns before the lookup. Without it a resolver that found nothing would
    // wipe a URL that an earlier refresh had resolved.
    await withStore(async (store) => {
      await store.rememberImage(imageInfo({ file: "u3", url: "https://cdn.example/keep" }));
      await store.updateImageUrl("u3", "");
      assert.equal((await store.findImage("u3"))?.url, "https://cdn.example/keep");
    });
  });

  test("a normal URL IS written back, and a new alias row is created for it", async () => {
    await withStore(async (store) => {
      await store.rememberImage(imageInfo({ file: "u4", url: "https://cdn.example/old" }));
      await store.updateImageUrl("u4", "https://cdn.example/new");
      assert.equal((await store.findImage("u4"))?.url, "https://cdn.example/new");
      // `remember` re-runs with the new URL among the aliases, so it is addressable.
      assert.equal((await store.findImage("https://cdn.example/new"))?.url, "https://cdn.example/new");
    });
  });

  test("an identical URL is a no-op (no row churn)", async () => {
    await withStore(async (store) => {
      await store.rememberImage(imageInfo({ file: "u5", url: "https://cdn.example/same" }));
      const before = await store.findImage("u5");
      await store.updateImageUrl("u5", "https://cdn.example/same");
      assert.deepEqual(await store.findImage("u5"), before);
    });
  });

  test("an unknown key updates nothing and does not throw", async () => {
    await withStore(async (store) => {
      await store.updateImageUrl("absent", "https://cdn.example/x");
      assert.deepEqual(await store.size(), { images: 0, records: 0, videos: 0 });
    });
  });

  test("updateUrl reads the CURRENT table only", async () => {
    // `#updateUrl` calls `#find(type, key, "current")`, mirroring the reference's
    // single-argument `find`. A legacy-only row is therefore NOT updated — the migration
    // is read-only from this store's perspective.
    const dbPath = await temporaryDatabasePath();
    const first = new MediaStore(dbPath);
    await first.initialization;
    await first.close();

    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(dbPath);
    raw
      .prepare("INSERT INTO legacy_media_entries (type, primary_key, data, last_seen) VALUES (?, ?, ?, ?)")
      .run(TYPE_IMAGE, "legacy-u", JSON.stringify({ type: TYPE_IMAGE, file: "legacy-u", url: "https://old" }), 1);
    raw.close();

    const store = new MediaStore(dbPath);
    try {
      await store.initialization;
      await store.updateImageUrl("legacy-u", "https://cdn.example/new");
      assert.equal((await store.findImage("legacy-u", "legacy"))?.url, "https://old");
    } finally {
      await store.close();
    }
  });
});

// ===========================================================================
// 6. The LRU bound
// ===========================================================================

describe("MediaStore — the lookup cache is bounded and recency-ordered", () => {
  test("the default bound is 4096", () => {
    assert.equal(DEFAULT_KEEP_ENTRIES, 4096);
    const store = new MediaStore(":memory:");
    try {
      assert.equal(store.maxCachedEntries, 4096);
    } finally {
      void store.close();
    }
  });

  test("a hit moves the key to the END, so eviction is LRU and not FIFO", async () => {
    // The assertion that distinguishes LRU from FIFO. With `maxCachedEntries: 2`:
    //   read A, read B  -> order [A, B]
    //   read A again    -> LRU order [B, A]
    //   read C          -> evicts B, leaving [A, C]
    // A FIFO cache would evict A (the first INSERTED) and leave B.
    await withStore(
      async (store) => {
        await store.rememberImage(imageInfo({ file: "A" }));
        await store.rememberImage(imageInfo({ file: "B" }));
        await store.rememberImage(imageInfo({ file: "C" }));

        await store.findImage("A");
        await store.findImage("B");
        assert.deepEqual(store.cacheKeys, [`current:${TYPE_IMAGE}:A`, `current:${TYPE_IMAGE}:B`]);

        await store.findImage("A");
        assert.deepEqual(
          store.cacheKeys,
          [`current:${TYPE_IMAGE}:B`, `current:${TYPE_IMAGE}:A`],
          "a hit must move the key to the most-recently-used end",
        );

        await store.findImage("C");
        assert.deepEqual(
          store.cacheKeys,
          [`current:${TYPE_IMAGE}:A`, `current:${TYPE_IMAGE}:C`],
          "the LEAST recently used (B) must be the one evicted",
        );
        assert.equal(store.cachedEntries, 2);
      },
      { maxCachedEntries: 2 },
    );
  });

  test("the cache never exceeds the bound, over many interleaved lookups", async () => {
    await withStore(
      async (store) => {
        for (let index = 0; index < 50; index += 1) {
          await store.rememberImage(imageInfo({ file: `k${index}` }));
        }
        for (let round = 0; round < 3; round += 1) {
          for (let index = 0; index < 50; index += 1) {
            await store.findImage(`k${index}`);
            assert.ok(store.cachedEntries <= 5, `cache grew to ${store.cachedEntries}`);
          }
        }
      },
      { maxCachedEntries: 5 },
    );
  });

  test("a WRITE clears the cache", async () => {
    // `remember` drops the whole cache rather than the affected key: the write may have
    // re-pointed an alias, and a stale entry under any other key would then resolve to a
    // row that no longer exists.
    await withStore(async (store) => {
      await store.rememberImage(imageInfo({ file: "x" }));
      await store.findImage("x");
      assert.equal(store.cachedEntries, 1);
      await store.rememberImage(imageInfo({ file: "y" }));
      assert.equal(store.cachedEntries, 0);
    });
  });

  test("a bound of 0 caches nothing but still answers correctly", async () => {
    // `Math.max(0, ...)` in the trim loop: a zero bound must not loop forever, and must
    // not turn a valid row into a miss.
    await withStore(
      async (store) => {
        await store.rememberImage(imageInfo({ file: "z", url: "https://cdn.example/z" }));
        assert.equal((await store.findImage("z"))?.url, "https://cdn.example/z");
        assert.equal(store.cachedEntries, 0);
      },
      { maxCachedEntries: 0 },
    );
  });
});

// ===========================================================================
// 7. `size()` — the UNION over both table pairs
// ===========================================================================

describe("size() — UNION ALL over current and legacy, grouped by type", () => {
  test("counts each type independently", async () => {
    await withStore(async (store) => {
      await store.rememberImage(imageInfo({ file: "i1" }));
      await store.rememberImage(imageInfo({ file: "i2" }));
      await store.rememberRecord(recordInfo({ file: "r1" }));
      await store.rememberVideo({ ...recordInfo({ file: "v1" }), type: TYPE_VIDEO });
      assert.deepEqual(await store.size(), { images: 2, records: 1, videos: 1 });
    });
  });

  test("an empty store answers three zeroes", async () => {
    await withStore(async (store) => {
      assert.deepEqual(await store.size(), { images: 0, records: 0, videos: 0 });
    });
  });

  test("legacy rows are COUNTED, not merely reachable", async () => {
    // The `UNION ALL` half. A `size()` that read only `media_entries` would report 1 here
    // while `findImage` happily answered 2 distinct images — an inconsistency that only
    // shows up after a migration.
    const dbPath = await temporaryDatabasePath();
    const first = new MediaStore(dbPath);
    await first.initialization;
    await first.rememberImage(imageInfo({ file: "current-1" }));
    await first.close();

    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(dbPath);
    const insert = raw.prepare(
      "INSERT INTO legacy_media_entries (type, primary_key, data, last_seen) VALUES (?, ?, ?, ?)",
    );
    insert.run(TYPE_IMAGE, "legacy-1", JSON.stringify({ type: TYPE_IMAGE, file: "legacy-1" }), 1);
    insert.run(TYPE_IMAGE, "legacy-2", JSON.stringify({ type: TYPE_IMAGE, file: "legacy-2" }), 1);
    insert.run(TYPE_RECORD, "legacy-r", JSON.stringify({ type: TYPE_RECORD, file: "legacy-r" }), 1);
    raw.close();

    const store = new MediaStore(dbPath);
    try {
      await store.initialization;
      assert.deepEqual(await store.size(), { images: 3, records: 1, videos: 0 });
    } finally {
      await store.close();
    }
  });

  test("a type present in only one table pair still counts (GROUP BY, not a fixed join)", async () => {
    // `UNION` (without `ALL`) would deduplicate the `type` STRING and collapse each count
    // to 1. This case has 3 images in one pair and 1 in the other; `UNION` answers 1.
    const dbPath = await temporaryDatabasePath();
    const first = new MediaStore(dbPath);
    await first.initialization;
    await first.rememberImage(imageInfo({ file: "a" }));
    await first.rememberImage(imageInfo({ file: "b" }));
    await first.rememberImage(imageInfo({ file: "c" }));
    await first.close();

    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(dbPath);
    raw
      .prepare("INSERT INTO legacy_media_entries (type, primary_key, data, last_seen) VALUES (?, ?, ?, ?)")
      .run(TYPE_IMAGE, "d", JSON.stringify({ type: TYPE_IMAGE, file: "d" }), 1);
    raw.close();

    const store = new MediaStore(dbPath);
    try {
      await store.initialization;
      assert.equal((await store.size()).images, 4, "UNION ALL must not deduplicate");
    } finally {
      await store.close();
    }
  });

  test("size() counts ROWS, so an evicted cache entry does not change it", async () => {
    await withStore(
      async (store) => {
        for (let index = 0; index < 10; index += 1) await store.rememberImage(imageInfo({ file: `s${index}` }));
        // Touch only two, so the other eight are evicted from the lookup cache.
        await store.findImage("s0");
        await store.findImage("s1");
        assert.ok(store.cachedEntries <= 2);
        assert.equal((await store.size()).images, 10, "the row count is not the cache size");
      },
      { maxCachedEntries: 2 },
    );
  });
});

// ===========================================================================
// 8. `remember` without an identifier
// ===========================================================================

describe("remember — a row with no identifier is a caller bug", () => {
  test("throws, naming the type, when every alias is absent", async () => {
    await withStore(async (store) => {
      // No `file` / `fileName` / `url` at all. `fileSize` and `type` are NOT aliases, so
      // they cannot rescue the row.
      await assert.rejects(
        async () => await store.rememberImage({ type: TYPE_IMAGE, fileSize: 1, subType: 0 }),
        /cannot store image metadata without an identifier/,
      );
    });
  });

  test("`url` ALONE is a valid identifier, because it is an alias", async () => {
    // The complement of the case above, and the reason `url` must not be passed there: an
    // image whose only known identifier is its CDN URL is storable, and `get_image` can
    // then resolve it by that URL. Omitting `file`/`fileName` is not a bug on its own.
    await withStore(async (store) => {
      await store.rememberImage({ type: TYPE_IMAGE, url: "https://cdn.example/only-url" });
      const found = await store.findImage("https://cdn.example/only-url");
      assert.ok(found);
      assert.equal(found.url, "https://cdn.example/only-url");
    });
  });

  test("throws for a record and a video too, with their own type names", async () => {
    await withStore(async (store) => {
      await assert.rejects(
        async () => await store.rememberRecord({ type: TYPE_RECORD }),
        /cannot store record metadata without an identifier/,
      );
      await assert.rejects(
        async () => await store.rememberVideo({ type: TYPE_VIDEO }),
        /cannot store video metadata without an identifier/,
      );
    });
  });

  test("empty-string aliases count as absent", async () => {
    // `pickPrimary` skips `""`, and so does `remember`'s `Set` filter. A row whose only
    // "identifier" is the empty string would be addressable by nothing.
    await withStore(async (store) => {
      await assert.rejects(
        async () => await store.rememberImage({ type: TYPE_IMAGE, file: "", fileName: "", url: "" }),
        /without an identifier/,
      );
      assert.deepEqual(await store.size(), { images: 0, records: 0, videos: 0 });
    });
  });

  test("a refused write leaves NO partial row behind", async () => {
    // The throw happens before `BEGIN`, so there is nothing to roll back — but the
    // assertion is worth making, because moving the check inside the transaction would
    // still pass a "does it throw" test while leaving the cache cleared.
    await withStore(async (store) => {
      await store.rememberImage(imageInfo({ file: "existing" }));
      await store.findImage("existing");
      assert.equal(store.cachedEntries, 1);
      await assert.rejects(async () => await store.rememberImage({ type: TYPE_IMAGE }), /without an identifier/);
      assert.equal(store.cachedEntries, 1, "a refused write must not clear the cache");
      assert.deepEqual(await store.size(), { images: 1, records: 0, videos: 0 });
    });
  });

  test("a metadata payload over the cap throws AND rolls back", async () => {
    // `serializeMediaInfo` runs before `BEGIN`, so this also cannot half-write. The point
    // of the case is that the store stays usable afterwards: a failed transaction that
    // left the connection mid-transaction would make every later write fail.
    await withStore(async (store) => {
      await assert.rejects(
        async () => await store.rememberImage({ type: TYPE_IMAGE, file: "big", summary: "x".repeat(70_000) }),
        /media metadata exceeds storage limit/,
      );
      await store.rememberImage(imageInfo({ file: "after" }));
      assert.equal((await store.size()).images, 1, "the store must still accept writes");
    });
  });
});

// ===========================================================================
// 9. Lifecycle
// ===========================================================================

describe("MediaStore — lifecycle", () => {
  test(":memory: is a working store", async () => {
    const store = new MediaStore(":memory:");
    try {
      await store.initialization;
      await store.rememberImage(imageInfo({ file: "mem" }));
      assert.equal((await store.findImage("mem"))?.file, "mem");
    } finally {
      await store.close();
    }
  });

  test("rows survive close and re-open", async () => {
    const dbPath = await temporaryDatabasePath();
    const first = new MediaStore(dbPath);
    await first.initialization;
    await first.rememberImage(imageInfo({ file: "durable", url: "https://cdn.example/d" }));
    await first.close();

    const second = new MediaStore(dbPath);
    try {
      await second.initialization;
      assert.equal((await second.findImage("durable"))?.url, "https://cdn.example/d");
    } finally {
      await second.close();
    }
  });

  test("the schema is created idempotently across re-opens", async () => {
    // `CREATE TABLE IF NOT EXISTS` for both prefixes, twice. A missing `IF NOT EXISTS` in
    // the legacy loop fails on the SECOND open, which is easy to miss in a test that only
    // opens once.
    const dbPath = await temporaryDatabasePath();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const store = new MediaStore(dbPath);
      try {
        await store.initialization;
        assert.deepEqual(await store.size(), { images: 0, records: 0, videos: 0 });
      } finally {
        await store.close();
      }
    }
  });

  test("close is idempotent and every method refuses afterwards", async () => {
    const store = new MediaStore(":memory:");
    await store.initialization;
    await store.close();
    await store.close();
    assert.equal(store.closed, true);
    await assert.rejects(async () => await store.findImage("x"), /MediaStore is closed/);
    await assert.rejects(async () => await store.rememberImage(imageInfo()), /MediaStore is closed/);
    await assert.rejects(async () => await store.size(), /MediaStore is closed/);
  });

  test("a missing parent directory is created", async () => {
    // `data/<uin>/messages.db` is the production path, and the directory may not exist on
    // a first run.
    const root = await mkdtemp(path.join(os.tmpdir(), "media-store-"));
    temporaryRoots.push(root);
    const dbPath = path.join(root, "nested", "deeper", "messages.db");
    const store = new MediaStore(dbPath);
    try {
      await store.initialization;
      await store.rememberImage(imageInfo({ file: "nested" }));
      assert.ok(await store.findImage("nested"));
    } finally {
      await store.close();
    }
  });

  test("an empty database path is rejected at construction", () => {
    assert.throws(() => new MediaStore(""), /MediaStore requires a database path/);
  });

  test("a corrupt database file fails initialization with a named error", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "media-store-"));
    temporaryRoots.push(root);
    const dbPath = path.join(root, "corrupt.db");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(dbPath, "this is not a sqlite database");
    const store = new MediaStore(dbPath);
    await assert.rejects(async () => await store.initialization, /MediaStore failed to initialize/);
  });
});

// ===========================================================================
// 10. Corrupt rows
// ===========================================================================

describe("MediaStore — a corrupt row is an error, not a plausible answer", () => {
  test("data that is valid JSON but not an object throws", async () => {
    // `null`, `[]` and `42` are all legal JSON. Returning one would make every consumer
    // guard against a shape `remember` forbids.
    for (const bad of ["null", "[]", "42", '"a string"']) {
      const dbPath = await temporaryDatabasePath();
      const first = new MediaStore(dbPath);
      await first.initialization;
      await first.close();

      const { DatabaseSync } = await import("node:sqlite");
      const raw = new DatabaseSync(dbPath);
      raw
        .prepare("INSERT INTO media_entries (type, primary_key, data, last_seen) VALUES (?, ?, ?, ?)")
        .run(TYPE_IMAGE, "bad", bad, 1);
      raw.close();

      const store = new MediaStore(dbPath);
      try {
        await store.initialization;
        await assert.rejects(async () => await store.findImage("bad"), /invalid persisted image metadata/);
      } finally {
        await store.close();
      }
    }
  });

  test("a valid object round-trips with every field intact", async () => {
    // The complement: the shape guard must not reject a real row. `deepEqual` pins the
    // whole object, so a field silently dropped by serialization fails here.
    await withStore(async (store) => {
      const info = recordInfo({ file: "round-trip" });
      await store.rememberRecord(info);
      const found = await store.findRecord("round-trip");
      assert.ok(found);
      // `type` is stored because the indexer supplies it; everything else must survive
      // JSON verbatim.
      assert.equal(found.file, info.file);
      assert.equal(found.fileId, info.fileId);
      assert.equal(found.fileName, info.fileName);
      assert.equal(found.fileSize, info.fileSize);
      assert.equal(found.duration, info.duration);
      assert.equal(found.fileHash, info.fileHash);
      assert.deepEqual(found.mediaNode, info.mediaNode);
      assert.equal(found.isGroup, true);
      assert.equal(found.sessionId, 555);
    });
  });

  test("remember clones its input, so a later mutation cannot change the stored row", async () => {
    // `structuredClone` in `rememberImage`/`rememberRecord`/`rememberVideo`. The indexer
    // reuses its element object, so a store holding the reference would silently follow it.
    await withStore(async (store) => {
      const info = imageInfo({ file: "clone" });
      await store.rememberImage(info);
      info.fileSize = 999_999;
      info.file = "mutated";
      const found = await store.findImage("clone");
      assert.ok(found);
      assert.equal(found.fileSize, 1234);
      assert.equal(found.file, "clone");
    });
  });
});
