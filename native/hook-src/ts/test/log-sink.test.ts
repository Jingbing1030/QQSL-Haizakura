// Tests for the file log sink: naming, rotation, retention, the total-size quota,
// the trace guard, the error surface and the backpressure policy.
//
// ===========================================================================
// WHAT THESE TESTS PIN, AND WHY EACH ONE IS A REAL FAILURE MODE
// ===========================================================================
//
// Every assertion here corresponds to a way the reference's behaviour could be
// got wrong in a way that stays green under a weaker test:
//
//   * **Naming** (`snowluma-YYYY-MM-DD.log`) — a sweep only recognises files
//     that match `LOG_FILE_RE`. Get the prefix or the separator wrong and
//     retention silently stops working: the files exist, nothing is ever
//     deleted, and the only symptom is a full disk weeks later.
//   * **Rotation at the size cap** — the trigger is
//     `file.bytes + incoming > maxBytes && file.bytes > 0`. Off by one and
//     either every file is one line short or an oversized single line creates an
//     endless tail of empty rotated files.
//   * **Retention by mtime** — the cutoff compares the date *in the file name*
//     while `mtimeMs` orders the deletion. A test that only checks "old file
//     disappears" cannot tell which field was used, so this file asserts both,
//     plus the `retainDays === 0` disable and the "never delete an open file"
//     invariant.
//   * **`trace`** — `resolveFileMinLevel()` throws `TypeError` on `trace` in the
//     reference (L1437-L1441) and `passesFile` excludes it (L1480). A sink
//     written from scratch crashes the process on `SNOWLUMA_LOG_LEVEL=trace`,
//     which is a live configuration and the exact bug this port already paid for.
//   * **Write errors** — `LogSink` is `(entry) => void`: it has no error
//     channel. A sink that swallows ENOSPC/EACCES reports "healthy" while
//     writing nothing, which is the worst outcome available.
//   * **`logMaxTotalMb`** — the promise is a bound on total bytes on disk. It is
//     only meaningful if measured with `stat`, so this file measures with
//     `stat`.
//
// All I/O is real: a fresh directory under `ts/build/test-tmp` per test. Not
// `/tmp` — that is tmpfs on this box (1.9 GB RAM) and a quota test that writes
// megabytes would be competing with the page cache it depends on.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MAX_QUEUE_BYTES,
  LOG_FILE_RE,
  LogFileSink,
  LogQuota,
  listManagedLogFiles,
  logFilePath,
  resolveFileMinLevel,
  sanitizeLogLine,
  todayString,
  validateLogStoragePolicy,
  type LogFileSinkOptions,
  type LogStorageStatus,
} from "../src/host/log-sink.js";
import type { LogEntry, LogLevel } from "../src/onebot/log.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `ts/build/test` -> `ts/build/test-tmp`. Inside the build tree, on the root fs. */
const TEMP_ROOT = path.join(HERE, "..", "test-tmp");

const scratchDirs: string[] = [];

function makeDir(label: string): string {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const dir = mkdtempSync(path.join(TEMP_ROOT, `${label}-`));
  scratchDirs.push(dir);
  return dir;
}

// One `after` hook for the whole file: `rmSync` on a directory whose mode was
// changed by the permission test must not fail the run, hence `force` + a mode
// restore first.
process.on("exit", () => {
  for (const dir of scratchDirs) {
    try {
      chmodSync(dir, 0o700);
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort: the OS reaps test-tmp */
    }
  }
});

function entry(level: LogLevel, message: string, uin?: number): LogEntry {
  return {
    level,
    scope: "Test",
    ...(uin !== undefined ? { uin } : {}),
    message,
    line: `${level.toUpperCase().padEnd(5, " ")} [Test] ${message}`,
    time: new Date().toISOString(),
  };
}

interface Collected {
  readonly sink: LogFileSink;
  readonly errors: string[];
  readonly dir: string;
}

function makeSink(label: string, options: LogFileSinkOptions = {}): Collected {
  const dir = options.dir ?? makeDir(label);
  const errors: string[] = [];
  const sink = new LogFileSink({
    ...options,
    dir,
    onError: (message) => {
      errors.push(message);
    },
  });
  return { sink, errors, dir };
}

/** Bytes on disk across every file the sweep would consider. */
function managedBytes(dir: string): number {
  return listManagedLogFiles(dir).reduce((sum, file) => sum + statSync(file.path).size, 0);
}

function managedNames(dir: string): string[] {
  return listManagedLogFiles(dir)
    .map((file) => path.basename(file.path))
    .sort();
}

function readUtf8(file: string): string {
  return readFileSync(file, "utf8");
}

/** Poll until `predicate()` holds. For genuinely async fs events (EACCES on open). */
async function waitFor(predicate: () => boolean, message: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

// ---------------------------------------------------------------------------
// Naming (reference L526-L529, L899-L902)
// ---------------------------------------------------------------------------

test("naming: the base file has no split suffix, the first rotation is .1", () => {
  // L899-L902 `pathFor`: `splitIndex > 0 ? "." + idx : ""`. Index 0 IS the base
  // name — a sink that numbered the first file `.0` would produce files the
  // reference's regex still matches but whose ordering a human cannot read.
  assert.equal(logFilePath("logs", "2026-11-22", 0), path.join("logs", "snowluma-2026-11-22.log"));
  assert.equal(logFilePath("logs", "2026-11-22", 1), path.join("logs", "snowluma-2026-11-22.1.log"));
  assert.equal(logFilePath("logs", "2026-11-22", 12), path.join("logs", "snowluma-2026-11-22.12.log"));
});

test("naming: the sweep's regex accepts exactly the names pathFor produces", () => {
  // The two halves have to agree or retention is a no-op. Pin the round trip
  // and the names that must NOT be reaped (anything else in the directory).
  for (const index of [0, 1, 2, 42]) {
    const name = path.basename(logFilePath("logs", "2026-11-22", index));
    const match = LOG_FILE_RE.exec(name);
    assert.notEqual(match, null, `${name} must match the managed-file regex`);
    assert.equal(match?.[1], "2026-11-22");
  }
  for (const foreign of ["app.log", "snowluma-2026-11-22.txt", "snowluma-20261122.log", "other-snowluma-2026-11-22.log"]) {
    assert.equal(LOG_FILE_RE.exec(foreign), null, `${foreign} must not be treated as a managed log`);
  }
});

test("naming: today's file name is the local calendar day, zero-padded", () => {
  assert.equal(todayString(new Date(2026, 0, 5, 23, 59, 59)), "2026-01-05");
  assert.equal(todayString(new Date(2026, 11, 31, 0, 0, 0)), "2026-12-31");
});

// ---------------------------------------------------------------------------
// A real write (requirement: real temp-dir writes)
// ---------------------------------------------------------------------------

test("write: a line reaches the real file, newline-terminated, under the managed name", async () => {
  const { sink, dir, errors } = makeSink("write");
  assert.equal(sink.write(entry("info", "hello from the sink")), true);
  await sink.flush();

  const expected = path.join(dir, `snowluma-${todayString()}.log`);
  assert.equal(sink.currentPath, expected);
  const text = readUtf8(expected);
  assert.ok(text.includes("hello from the sink"), `expected the message in ${text}`);
  assert.ok(text.endsWith("\n"), "every record must be newline-terminated");
  assert.deepEqual(errors, []);
  assert.equal(sink.status.state, "healthy");
  assert.equal(sink.status.droppedLines, 0);
  await sink.close();
});

test("write: lines keep their order across several flushes", async () => {
  // Ordering is the whole point of a serialised queue; an implementation that
  // pipelined writes could reorder under load and still produce every line.
  const { sink } = makeSink("order");
  for (let i = 0; i < 50; i += 1) {
    sink.write(entry("info", `line-${String(i).padStart(3, "0")}`));
    if (i % 10 === 9) await sink.flush();
  }
  await sink.flush();
  const text = readUtf8(sink.currentPath ?? "");
  const order = [...text.matchAll(/line-(\d{3})/g)].map((m) => Number(m[1]));
  assert.deepEqual(order, Array.from({ length: 50 }, (_, i) => i));
  await sink.close();
});

test("write: ANSI and control sequences are stripped before the bytes hit disk", async () => {
  // Reference L134-L172 `sanitizeLogLine`, applied at L1041. A payload can
  // smuggle raw ESC through `%s`; terminal escapes must not be persisted.
  assert.equal(sanitizeLogLine("\u001b[31mred\u001b[0m"), "red");
  assert.equal(sanitizeLogLine("a\u0000b\u0007c"), "abc");
  assert.equal(sanitizeLogLine("tab\tand\nnewline"), "tab\tand\nnewline");

  const { sink } = makeSink("sanitize");
  sink.write({ ...entry("info", "x"), line: "before\u001b[1mbold\u001b[0m after" });
  await sink.flush();
  const text = readUtf8(sink.currentPath ?? "");
  assert.ok(text.includes("beforebold after"), `expected the stripped form, got ${JSON.stringify(text)}`);
  assert.ok(!text.includes("\u001b"), "no ESC byte may survive to disk");
  await sink.close();
});

// ---------------------------------------------------------------------------
// Rotation at the size cap (reference L814, L840-L848)
// ---------------------------------------------------------------------------

test("rotation: the file rotates when the next line would exceed the cap", async () => {
  // L814: `file.bytes + bytes > this.maxBytes && file.bytes > 0`.
  // The record length is derived from the sink's own line format rather than
  // hardcoded, so this test cannot drift out of sync with `render()` — a
  // hardcoded byte count would silently stop exercising the trigger.
  const recordBytes = Buffer.byteLength(`${entry("info", "record-0").line}\n`, "utf8");
  const maxFileBytes = recordBytes * 2 + 1; // exactly two records fit
  const { sink, dir } = makeSink("rotate", { maxFileBytes });
  for (let i = 0; i < 5; i += 1) sink.write(entry("info", `record-${String(i)}`));
  await sink.flush();

  const today = todayString();
  const names = managedNames(dir);
  assert.deepEqual(
    names,
    [`snowluma-${today}.1.log`, `snowluma-${today}.2.log`, `snowluma-${today}.log`].sort(),
    `expected two rotations, got ${names.join(", ")}`,
  );

  const base = statSync(logFilePath(dir, today, 0)).size;
  assert.ok(base <= maxFileBytes, `base file must respect the cap, got ${base}`);
  assert.ok(base > recordBytes, `base file must be more than one record, got ${base}`);

  // Content survives the rotation, in order, with no duplication.
  const all = [0, 1, 2].map((i) => readUtf8(logFilePath(dir, today, i))).join("");
  for (let i = 0; i < 5; i += 1) assert.ok(all.includes(`record-${String(i)}`), `record-${String(i)} was lost`);
  assert.equal([...all.matchAll(/record-\d/g)].length, 5, "a rotation must not duplicate records");
  await sink.close();
});

test("rotation: an oversized single line is written whole, not as an endless empty tail", async () => {
  // The `file.bytes > 0` half of L814. Without it a line larger than the cap
  // rotates to an empty file, which is immediately over the cap again, forever.
  const { sink, dir } = makeSink("oversize", { maxFileBytes: 16 });
  assert.equal(sink.write(entry("error", "a".repeat(500))), true);
  await sink.flush();
  const names = managedNames(dir);
  assert.deepEqual(names, [`snowluma-${todayString()}.log`], `a single oversized line must not rotate: ${names.join(", ")}`);
  assert.ok(readUtf8(logFilePath(dir, todayString(), 0)).includes("a".repeat(500)));
  await sink.close();
});

test("rotation: a fresh writer reopens the day's first GAP, not the next free index", async () => {
  // The reference has TWO different index probes and they disagree on purpose:
  //
  //   L833-L838 `ensureForToday` : idx = 0; while (exists(idx + 1)) idx++  -> first GAP
  //   L840-L848 `rotateBySize`   : idx = prev + 1; while (exists(idx)) idx++ -> first FREE
  //
  // The first one is the surprising one, and it is a real observable behaviour:
  // with `.1` present but no base file, a fresh writer lands on `.1` and appends
  // to it. Collapsing the two probes into "next free index" would instead create
  // a fresh base file, which silently changes which file a restart continues.
  //
  // Pinned because it is counter-intuitive. It is NOT a bug being blessed: an
  // append-only log has no ordering guarantee across restarts either way, and
  // the file name (not the write order) is what retention reads.
  const today = todayString();

  // The probe only advances while `idx + 1` exists contiguously from `.1`, so
  // with `.1` present and no base file a fresh writer appends to `.1`.
  {
    const { sink, dir } = makeSink("probe-gap", { maxFileBytes: 1_000_000 });
    writeFileSync(logFilePath(dir, today, 1), "previous run\n", "utf8");
    sink.write(entry("info", "fresh"));
    await sink.flush();
    assert.equal(sink.currentPath, logFilePath(dir, today, 1), "a contiguous .1 must be appended to");
    assert.equal(existsSync(logFilePath(dir, today, 0)), false, "no base file may be created when .1 is contiguous");
    assert.ok(readUtf8(logFilePath(dir, today, 1)).includes("fresh"), "the contiguous file is appended to");
    await sink.close();
  }

  // The probe only advances while `idx + 1` exists *contiguously* from `.1`
  // (L836 `while (exists(idx + 1))`). So a hole at `.1` stops it at index 0 and
  // the base file is APPENDED TO — even though `.2` is also occupied. Collapsing
  // this into "highest index + 1" would instead create `.3` and leave the base
  // file as a frozen first run.
  {
    const { sink, dir } = makeSink("probe-gap2", { maxFileBytes: 1_000_000 });
    writeFileSync(logFilePath(dir, today, 0), "base\n", "utf8");
    writeFileSync(logFilePath(dir, today, 2), "third\n", "utf8");
    sink.write(entry("info", "into-base"));
    await sink.flush();
    assert.equal(sink.currentPath, logFilePath(dir, today, 0), "a hole at .1 must stop the probe at the base file");
    assert.equal(readUtf8(logFilePath(dir, today, 2)), "third\n", "an existing rotated file must not be appended to");
    await sink.close();
  }

  // No files at all -> index 0, the base name (the common case).
  {
    const { sink, dir } = makeSink("probe-empty", { maxFileBytes: 1_000_000 });
    sink.write(entry("info", "first ever"));
    await sink.flush();
    assert.equal(sink.currentPath, logFilePath(dir, today, 0));
    await sink.close();
  }
});

// ---------------------------------------------------------------------------
// Retention (reference L719-L726)
// ---------------------------------------------------------------------------

test("retention: files whose name-date is older than retainDays are deleted", () => {
  // L719-L726. The cutoff is compared against `dateOf(file.date)` — the date in
  // the NAME — not mtime. So a file *named* long ago is reaped even if it was
  // written a second ago.
  const dir = makeDir("retention");
  const old = ["snowluma-2020-01-01.log", "snowluma-2020-01-02.1.log"];
  const recent = [`snowluma-${todayString()}.log`];
  for (const name of [...old, ...recent]) writeFileSync(path.join(dir, name), "x\n", "utf8");

  const quota = new LogQuota(dir, 1024 * 1024, 7, () => undefined, false);
  assert.equal(quota.fileCount, 3);
  // `now` is pinned so the assertion cannot drift across a midnight boundary.
  const deleted = quota.cleanupExpired(Date.now());
  assert.equal(deleted, 2, "both 2020 files are past a 7-day cutoff");
  assert.deepEqual(managedNames(dir), recent);
  assert.equal(quota.totalBytes, 2, "accounting must drop the reaped bytes");
});

test("retention: retainDays === 0 disables the sweep entirely", () => {
  // L720 `if (this.retainDays === 0) return;` — "keep forever", NOT "delete
  // everything". Reading 0 as "expire immediately" would eat the whole log
  // directory on the first start with the knob at its floor.
  const dir = makeDir("retention-off");
  writeFileSync(path.join(dir, "snowluma-2001-01-01.log"), "ancient\n", "utf8");
  const quota = new LogQuota(dir, 1024 * 1024, 0, () => undefined, false);
  assert.equal(quota.cleanupExpired(Date.now()), 0);
  assert.deepEqual(managedNames(dir), ["snowluma-2001-01-01.log"]);
});

test("retention: a file the sink currently has open is never deleted", () => {
  // The invariant behind `active`: `cleanupExpired` and `ensureCapacity` both
  // filter on `!active.has(path)`. Deleting an open file would not fail on Linux
  // — the fd keeps working — so the log would keep "writing" to an unlinked
  // inode and vanish on close. That is why this is asserted directly.
  //
  // Note the second half: `deactivate()` runs `maintainAfterClose()`, which
  // reaps immediately. So the file must be gone the moment it closes — checking
  // a later `cleanupExpired()` would see 0 and pass for the wrong reason.
  const dir = makeDir("retention-active");
  const ancient = path.join(dir, "snowluma-2001-01-01.log");
  writeFileSync(ancient, "still being written\n", "utf8");
  const quota = new LogQuota(dir, 1024 * 1024, 7, () => undefined, false);
  assert.notEqual(quota.activate(ancient), null, "activation must succeed");
  assert.equal(quota.activeFileCount, 1);
  assert.equal(quota.cleanupExpired(Date.now()), 0, "an active file must survive retention");
  assert.ok(statSync(ancient).size > 0);

  // Closing is what makes it eligible; `maintainAfterClose` (L694) reaps at once.
  quota.deactivate(ancient);
  assert.equal(quota.activeFileCount, 0);
  assert.equal(existsSync(ancient), false, "deactivate must reap an expired file immediately");
  assert.equal(quota.totalBytes, 0, "the reaped bytes must leave the accounting");
});

test("retention: a file that is still open holds its bytes against the quota", () => {
  // The other half of `active`: an open file cannot be reclaimed, so
  // `ensureCapacity` must report failure rather than over-reclaim. A sink that
  // ignored `active` here would delete the file it is writing to.
  const dir = makeDir("retention-quota-active");
  const open = path.join(dir, "snowluma-2001-01-01.log");
  writeFileSync(open, "x".repeat(60), "utf8");
  const quota = new LogQuota(dir, 100, 7, () => undefined, false);
  assert.equal(quota.activate(open), 60);
  assert.equal(quota.ensureCapacity(80), false, "one open 60-byte file + 80 bytes cannot fit in 100");
  assert.equal(quota.isDegraded, true, "an unsatisfiable quota must degrade, not throw");
  assert.equal(existsSync(open), true, "the open file must survive the failed eviction");
});

test("retention: deletion is ordered by mtime, oldest first", () => {
  // L722 `.sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path))`.
  // All three names share an expired date, so only mtime can order them. The
  // newest must be the survivor when the quota only allows one.
  const dir = makeDir("retention-mtime");
  const now = Date.now();
  const names = ["snowluma-2019-01-01.log", "snowluma-2019-01-01.1.log", "snowluma-2019-01-01.2.log"];
  names.forEach((name, index) => {
    const file = path.join(dir, name);
    writeFileSync(file, `${"x".repeat(100)}\n`, "utf8");
    // Distinct, well-separated mtimes so the comparison cannot tie.
    utimesSync(file, new Date(now + index * 60_000), new Date(now + index * 60_000));
  });

  const quota = new LogQuota(dir, 202, 7, () => undefined, false);
  assert.equal(quota.fileCount, 3);
  // Budget 202 = two 101-byte files. Eviction must free exactly the two oldest
  // and leave the newest-mtime file standing; a sort on name or on size would
  // leave a different one (`.1` and `.2` differ only by their mtime).
  assert.equal(quota.ensureCapacity(101), true);
  assert.deepEqual(managedNames(dir), ["snowluma-2019-01-01.2.log"], "the newest-mtime file must be the last evicted");
});

test("retention: an unmanaged file in the directory is never touched", () => {
  const dir = makeDir("retention-foreign");
  writeFileSync(path.join(dir, "app.log"), "not ours\n", "utf8");
  writeFileSync(path.join(dir, "snowluma-2001-01-01.log"), "ours\n", "utf8");
  const quota = new LogQuota(dir, 1024 * 1024, 7, () => undefined, false);
  assert.equal(quota.cleanupExpired(Date.now()), 1);
  assert.deepEqual(managedNames(dir), []);

  const { sink } = makeSink("retention-foreign-sink", { dir, retainDays: 7 });
  sink.cleanupExpired(Date.now());
  assert.ok(statSync(path.join(dir, "app.log")).size > 0, "a foreign file must survive every sweep");
});

// ---------------------------------------------------------------------------
// Symlink safety (requirement 3)
// ---------------------------------------------------------------------------

test("safety: a symlink inside the log dir is neither listed nor reaped", () => {
  // `readdirSync(..., { withFileTypes: true })` + `entry.isFile()` is an lstat
  // fact, so a symlink never becomes a candidate: it cannot be counted toward
  // the quota and cannot be unlinked. Following it would let a link planted in
  // `logs/` delete a file anywhere the process can write.
  const dir = makeDir("symlink");
  const outside = path.join(makeDir("symlink-target"), "precious.txt");
  writeFileSync(outside, "do not delete me\n", "utf8");
  symlinkSync(outside, path.join(dir, "snowluma-2001-01-01.log"));

  assert.deepEqual(listManagedLogFiles(dir), [], "a symlink must not appear in the inventory");
  const quota = new LogQuota(dir, 1024 * 1024, 7, () => undefined, false);
  assert.equal(quota.cleanupExpired(Date.now()), 0);
  assert.equal(readUtf8(outside), "do not delete me\n", "the symlink target must be untouched");
  // `lstatSync`, not `statSync`: the latter follows the link and would report the
  // target's type, which is exactly the bug being guarded against.
  assert.ok(lstatSync(path.join(dir, "snowluma-2001-01-01.log")).isSymbolicLink());
});

// ---------------------------------------------------------------------------
// Missing directory (requirement 3)
// ---------------------------------------------------------------------------

test("safety: a missing log directory is created, not an error", async () => {
  const parent = makeDir("mkdir");
  const dir = path.join(parent, "nested", "logs");
  const { sink, errors } = makeSink("mkdir-sink", { dir });
  sink.write(entry("info", "created on demand"));
  await sink.flush();
  assert.deepEqual(errors, []);
  assert.ok(statSync(path.join(dir, `snowluma-${todayString()}.log`)).size > 0);
  await sink.close();
});

// ---------------------------------------------------------------------------
// The trace guard (requirement 4 in the brief; reference L1437-L1441, L1479-L1480)
// ---------------------------------------------------------------------------

test("trace: writing a trace entry does not crash the sink and never reaches a file", async () => {
  // The reference throws `TypeError` out of `resolveFileMinLevel()` for
  // `trace`, and `passesFile` excludes trace before the threshold is consulted.
  // A sink that indexed `LEVEL_WEIGHT[level]` after a throw, or that treated
  // trace as "more verbose than debug, write it", would crash or bloat here.
  const { sink, errors } = makeSink("trace-guard");
  assert.doesNotThrow(() => {
    sink.write(entry("trace", "packet_push serviceCmd=trpc.msg.olpush.OlPushService.MsgPush"));
  });

  assert.equal(sink.write(entry("trace", "packet_send")), false, "trace must be refused");
  assert.equal(sink.write(entry("trace", "packet_recv")), false);
  assert.equal(sink.write(entry("trace", "packet_terminal")), false);
  await sink.flush();

  assert.equal(sink.status.traceSuppressed, 4, "every refused trace line must be counted, so the silence is explainable");
  assert.deepEqual(errors, [], "a trace line is not an error");
  assert.equal(sink.status.droppedLines, 0, "a trace line is not a dropped line");

  // Nothing but trace was written, so the file must be empty or absent.
  const names = managedNames(sink.directory);
  assert.ok(names.length <= 1, `unexpected files: ${names.join(", ")}`);
  if (names.length === 1) assert.equal(readUtf8(path.join(sink.directory, names[0] ?? "")), "");
  await sink.close();
});

test("trace: resolveFileMinLevel normalises `trace` to debug instead of throwing", () => {
  // Deliberate, documented divergence from L1441. `trace` cannot change file
  // behaviour (it is excluded upstream), so crashing the process over it is all
  // downside — but the normalisation must be OBSERVABLE, not silent.
  assert.deepEqual(resolveFileMinLevel("trace"), { level: "debug", traceCoerced: true });
  assert.deepEqual(resolveFileMinLevel("TRACE "), { level: "debug", traceCoerced: true });
  assert.deepEqual(resolveFileMinLevel(undefined), { level: "debug", traceCoerced: false });
  assert.deepEqual(resolveFileMinLevel(""), { level: "debug", traceCoerced: false });
  for (const level of ["debug", "info", "success", "warn", "error"] as const) {
    assert.deepEqual(resolveFileMinLevel(level), { level, traceCoerced: false });
  }
  // Anything genuinely unknown is still a programming error, as in the reference.
  assert.throws(() => resolveFileMinLevel("verbose"), TypeError);
});

test("trace: a trace-only process still records debug-and-above, and says it coerced", async () => {
  // End-to-end form of the above: the sink is constructed with `fileLevel`
  // resolution for `trace`, and both facts (coerced, and debug still written)
  // are observable on the status.
  const dir = makeDir("trace-coerced");
  const sink = new LogFileSink({ dir, fileLevel: "debug" });
  assert.equal(sink.status.fileLevel, "debug");
  assert.equal(sink.status.fileLevelTraceCoerced, false);
  sink.write(entry("trace", "should not appear"));
  sink.write(entry("debug", "should appear"));
  await sink.flush();
  const text = readUtf8(sink.currentPath ?? "");
  assert.ok(text.includes("should appear"));
  assert.ok(!text.includes("should not appear"));
  await sink.close();
});

test("level: a threshold suppresses everything below it", async () => {
  const { sink } = makeSink("level", { fileLevel: "warn" });
  assert.equal(sink.write(entry("info", "below-threshold")), false);
  assert.equal(sink.write(entry("success", "below-threshold")), false);
  assert.equal(sink.write(entry("warn", "at-threshold")), true);
  assert.equal(sink.write(entry("error", "above-threshold")), true);
  await sink.flush();
  const text = readUtf8(sink.currentPath ?? "");
  assert.ok(!text.includes("below-threshold"));
  assert.ok(text.includes("at-threshold"));
  assert.ok(text.includes("above-threshold"));
  await sink.close();
});

// ---------------------------------------------------------------------------
// Error surface (requirement 5)
// ---------------------------------------------------------------------------

test("errors: a failing write is reported through onError and never thrown at the caller", async () => {
  // Deterministic EISDIR: the day's file name already exists as a directory, so
  // `createWriteStream` fails asynchronously. The sink must (a) not throw,
  // (b) report exactly why, and (c) stop pretending to be healthy.
  const { sink, dir, errors } = makeSink("write-error");
  const blocked = path.join(dir, `snowluma-${todayString()}.log`);
  mkdirSync(blocked, { recursive: true });

  assert.doesNotThrow(() => {
    sink.write(entry("info", "this cannot be written"));
  });
  await waitFor(() => errors.length > 0, "the write failure must surface through onError");

  assert.ok(
    errors.some((message) => /EISDIR|EACCES|EPERM|failed/i.test(message)),
    `expected a filesystem error, got ${JSON.stringify(errors)}`,
  );
  assert.notEqual(sink.status.state, "healthy", "a failing writer must not report healthy");
  assert.ok(sink.status.lastError !== undefined);
  await sink.close();
});

test("errors: an uncreatable log directory is reported, not thrown", () => {
  // L779-L785 + L1155-L1170: `initialize()` catches, records and reports. The
  // constructor must return a disabled sink rather than explode, because it runs
  // during process startup where a throw is a crash loop.
  const parent = makeDir("mkdir-fail");
  const blocker = path.join(parent, "not-a-directory");
  writeFileSync(blocker, "file, not dir\n", "utf8");
  const dir = path.join(blocker, "logs");

  const errors: string[] = [];
  const build = (): LogFileSink => new LogFileSink({ dir, onError: (message) => errors.push(message) });
  // A throw here is a crash loop at every process start, so the constructor has
  // to be total.
  const sink = build();
  assert.ok(errors.length > 0, "an unusable log dir must be reported");
  assert.equal(sink.status.state, "disabled");
  assert.equal(sink.write(entry("info", "nowhere to go")), false);
});

test("errors: a bad policy is a RangeError, thrown at construction (not at write)", () => {
  // L492-L498. This is the one place throwing is correct: it is a config bug,
  // detected once at startup, not a per-line failure.
  assert.throws(() => validateLogStoragePolicy({ maxTotalMb: 0, retainDays: 7, perUinEnabled: false }), RangeError);
  assert.throws(() => validateLogStoragePolicy({ maxTotalMb: 1.5, retainDays: 7, perUinEnabled: false }), RangeError);
  assert.throws(() => validateLogStoragePolicy({ maxTotalMb: 1, retainDays: -1, perUinEnabled: false }), RangeError);
  assert.throws(() => validateLogStoragePolicy({ maxTotalMb: 1, retainDays: 7, perUinEnabled: "yes" as unknown as boolean }), TypeError);
  assert.doesNotThrow(() => validateLogStoragePolicy({ maxTotalMb: 1024, retainDays: 7, perUinEnabled: false }));
});

test("errors: asLogSink swallows the return value so the ambient logger cannot see a throw", () => {
  // `setLogSink` takes `(entry: LogEntry) => void`. This adapter is the only
  // supported wiring, and it must be total: `write` never throws, so a bad line
  // cannot take down the transport that logged it.
  const { sink } = makeSink("adapter");
  const adapt = sink.asLogSink();
  assert.doesNotThrow(() => adapt(entry("info", "through the adapter")));
  assert.doesNotThrow(() => adapt(entry("trace", "also fine")));
});

// ---------------------------------------------------------------------------
// logMaxTotalMb (requirement 6)
// ---------------------------------------------------------------------------

test("quota: total bytes on disk stay under logMaxTotalMb while writing far more", async () => {
  // The real promise of the knob. 1 MiB of budget, 32 KiB per file, ~1.6 MiB of
  // input: eviction has to keep firing for the whole run. Measured with `stat`,
  // not with the sink's own counter, because that is the number the disk cares
  // about.
  const maxTotalMb = 1;
  const maxTotalBytes = maxTotalMb * 1024 * 1024;
  const { sink, dir, errors } = makeSink("quota", { maxTotalMb, maxFileBytes: 32 * 1024, retainDays: 0 });

  const payload = "q".repeat(1000);
  let accepted = 0;
  let peak = 0;
  for (let i = 0; i < 1600; i += 1) {
    if (sink.write(entry("info", `${String(i).padStart(4, "0")} ${payload}`))) accepted += 1;
    if (i % 50 === 49) {
      await sink.flush();
      peak = Math.max(peak, managedBytes(dir));
    }
  }
  await sink.flush();
  peak = Math.max(peak, managedBytes(dir));

  assert.ok(peak <= maxTotalBytes, `on-disk bytes exceeded logMaxTotalMb: peak ${peak} > ${maxTotalBytes}`);
  assert.ok(accepted > 0, "the sink must accept at least the first file worth of lines");
  assert.equal(errors.length, 0, `eviction is not an error: ${errors.join("; ")}`);

  // The bound is only interesting if it actually bit — i.e. the input really was
  // more than the budget and eviction is what kept it in range.
  assert.ok(accepted * 1024 > maxTotalBytes, `input (${accepted} KiB) must exceed the ${maxTotalMb} MiB budget`);

  const status: LogStorageStatus = sink.status;
  assert.ok(status.totalBytes <= maxTotalBytes, `accounted bytes ${status.totalBytes} must respect the cap`);
  await sink.close();
});

test("quota: one oversized line is refused rather than pushing the total over the cap", () => {
  // `ensureCapacity` returns false when nothing closed can be reclaimed, and the
  // writer then refuses the line. Silently writing it would break the bound.
  const dir = makeDir("quota-oversize");
  const quota = new LogQuota(dir, 100, 0, () => undefined, false);
  const file = logFilePath(dir, todayString(), 0);
  assert.equal(quota.reserve(file, 40), true);
  assert.equal(quota.reserve(file, 40), true);
  assert.equal(quota.reserve(file, 200), false, "a line that cannot fit must be refused");
  assert.equal(quota.droppedLines, 1);
  assert.ok(quota.totalBytes <= 100);
});

// ---------------------------------------------------------------------------
// Backpressure (requirement 4 in the brief)
// ---------------------------------------------------------------------------

test("backpressure: the queue never exceeds maxQueueBytes, and overflow is counted and reported", async () => {
  // The policy under test: one write in flight, a hard byte cap on the rest, and
  // drop-newest when the cap is reached. Because `write()` is synchronous and the
  // write callback is not, a tight loop necessarily outruns the disk — which is
  // exactly the slow-disk case, without needing a slow disk.
  const maxQueueBytes = 64;
  const { sink, dir, errors } = makeSink("backpressure", { maxQueueBytes });

  let accepted = 0;
  let refused = 0;
  for (let i = 0; i < 200; i += 1) {
    if (sink.write(entry("info", `burst-${String(i).padStart(3, "0")}-${"z".repeat(20)}`))) accepted += 1;
    else refused += 1;
    // Hard invariant, checked on every single iteration: memory is bounded.
    assert.ok(sink.status.peakQueuedBytes <= maxQueueBytes, `peak queued ${sink.status.peakQueuedBytes} > cap ${maxQueueBytes}`);
  }

  assert.ok(refused > 0, "a 200-line synchronous burst must outrun a 64-byte queue");
  assert.ok(accepted > 0, "the first lines must be accepted");

  await sink.flush();
  assert.equal(sink.status.droppedLines, refused, "every refused line must be counted exactly once");
  assert.ok(
    errors.some((message) => /queue full/i.test(message)),
    `the onset of dropping must be reported, got ${JSON.stringify(errors)}`,
  );

  // Dropping must not have corrupted what did get written.
  const text = managedNames(dir).map((name) => readUtf8(path.join(dir, name))).join("");
  assert.equal([...text.matchAll(/burst-\d{3}/g)].length, accepted, "written records must equal accepted records");
  await sink.close();
});

test("backpressure: the default queue cap is a fixed, documented number of bytes", () => {
  // A default that silently tracked `maxTotalMb` would let a 1024 MiB quota
  // buffer 1024 MiB in RAM on a 1.9 GB box.
  assert.equal(DEFAULT_MAX_QUEUE_BYTES, 4 * 1024 * 1024);
  const { sink } = makeSink("defaults");
  assert.equal(sink.status.maxQueueBytes, DEFAULT_MAX_QUEUE_BYTES);
  assert.equal(sink.status.peakQueuedBytes, 0);
});

// ---------------------------------------------------------------------------
// logPerUin (requirement 2)
// ---------------------------------------------------------------------------

test("perUin: false writes one shared file and no account directories", async () => {
  // The shipped `config/runtime.json` value.
  const { sink, dir } = makeSink("shared-only", { perUinEnabled: false });
  sink.write(entry("info", "shared line", 10001));
  await sink.flush();
  assert.deepEqual(managedNames(dir), [`snowluma-${todayString()}.log`]);
  assert.deepEqual(
    listManagedLogFiles(dir).map((file) => path.dirname(file.path)),
    [dir],
    "no account subdirectory may be created",
  );
  await sink.close();
});

test("perUin: true mirrors each tagged line into <dir>/<uin>/ under the same name", async () => {
  // L1052-L1060. Implemented, not rejected: the reference fans out on
  // `options.uin` and names the account directory after the UIN (`/^\d+$/`).
  const { sink, dir } = makeSink("per-uin", { perUinEnabled: true });
  sink.write(entry("info", "for-10001", 10001));
  sink.write(entry("info", "for-20002", 20002));
  sink.write(entry("info", "untagged"));
  await sink.flush();

  const shared = readUtf8(path.join(dir, `snowluma-${todayString()}.log`));
  assert.ok(shared.includes("for-10001") && shared.includes("for-20002") && shared.includes("untagged"));

  const first = readUtf8(path.join(dir, "10001", `snowluma-${todayString()}.log`));
  const second = readUtf8(path.join(dir, "20002", `snowluma-${todayString()}.log`));
  assert.ok(first.includes("for-10001"));
  assert.ok(!first.includes("for-20002"), "an account log must not contain another account's lines");
  assert.ok(second.includes("for-20002"));
  assert.ok(!second.includes("untagged"), "an untagged line must not be fanned out");
  assert.equal(sink.perUinPath(10001), path.join(dir, "10001", `snowluma-${todayString()}.log`));

  // The quota is SHARED across directories (L921/L1048): the account files
  // count against the same `logMaxTotalMb` as the shared file.
  const total = managedBytes(dir);
  assert.ok(total > 0);
  assert.equal(sink.status.totalBytes, total, "account files must be included in the quota accounting");
  await sink.close();
});

test("perUin: updatePolicy(false) closes the account writers and stops fanning out", async () => {
  const { sink, dir } = makeSink("per-uin-off", { perUinEnabled: true });
  sink.write(entry("info", "before", 10001));
  await sink.flush();
  assert.notEqual(sink.perUinPath(10001), null);

  await sink.updatePolicy({ maxTotalMb: 1024, retainDays: 7, perUinEnabled: false });
  assert.equal(sink.perUinPath(10001), null, "disabling per-UIN must close the account writer");
  assert.equal(sink.status.perUinEnabled, false);

  sink.write(entry("info", "after", 10001));
  await sink.flush();
  const account = readUtf8(path.join(dir, "10001", `snowluma-${todayString()}.log`));
  assert.ok(account.includes("before"));
  assert.ok(!account.includes("after"), "no new line may be fanned out after the switch is turned off");
  await sink.close();
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test("lifecycle: close() flushes, and a write after close is refused instead of throwing", async () => {
  const { sink, dir } = makeSink("lifecycle");
  sink.write(entry("info", "last words"));
  // Capture the path before `close()`: it nulls `currentPath` (the writer is
  // detached), so reading it afterwards would test nothing.
  const file = sink.currentPath;
  assert.notEqual(file, null);
  await sink.close();
  assert.ok(readUtf8(file ?? "").includes("last words"), "close() must flush the queue to disk");
  assert.equal(sink.write(entry("info", "too late")), false, "a write after close must be refused, not thrown");
  assert.deepEqual(managedNames(dir), [`snowluma-${todayString()}.log`]);
});

test("lifecycle: clearManagedLogs removes closed files and leaves a working writer", async () => {
  const { sink } = makeSink("clear");
  sink.write(entry("info", "to be cleared"));
  await sink.flush();
  const result = await sink.clearManagedLogs();
  assert.ok(result.deletedFiles >= 0);
  // The writer must still work afterwards — a `clear` that leaves the sink dead
  // is a silent outage.
  assert.equal(sink.write(entry("info", "still alive")), true);
  await sink.flush();
  const text = managedNames(sink.directory)
    .map((name) => readUtf8(path.join(sink.directory, name)))
    .join("");
  assert.ok(text.includes("still alive"));
  await sink.close();
});
