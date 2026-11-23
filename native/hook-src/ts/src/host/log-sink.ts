// File log sink with rotation, a total-size quota and mtime-ordered retention.
//
// Reference regions (all line numbers in `reference/index.mjs`):
//   L411-L530   ../common/src/log-file-transport.ts  parsing helpers, naming, constants
//   L442-L447   `todayString` / `dateOf`            — the date baked into the file name
//   L449-L487   `listManagedLogFiles`               — the sweep's file inventory
//   L489-L490   `reportStorageError`                — `[logger.storage]` on stderr
//   L492-L498   `validatePolicy`                    — RangeError/TypeError on bad knobs
//   L531-L769   `LogQuota`                          — quota, retention, degraded state
//   L770-L908   `FileWriter`                        — daily open, size rotation, append
//   L909-L1170  `FileTransport`                     — shared + per-UIN fan-out
//   L1479-L1508 `emit`                              — `passesFile` gate, per-UIN dispatch
//   L1437-L1441 `resolveFileMinLevel`               — the gate that throws on `trace`
//   L134-L172   `sanitizeLogLine`                   — control/ANSI stripping before disk
//
// ===========================================================================
// THE TRACE DISTINCTION — READ THIS BEFORE WONDERING WHY TRACE IS SILENT
// ===========================================================================
//
// The reference has TWO INDEPENDENT LEVEL GATES, and only one of them can ever
// reach a file:
//
//     L1479  const passesConsole = shouldLog(level);                       // SNOWLUMA_LOG_LEVEL
//     L1480  const passesFile    = level !== "trace" && shouldLogToFile(level); // SNOWLUMA_LOG_FILE_LEVEL
//
// `passesFile` short-circuits on `level !== "trace"` **before** it consults the
// file threshold, so `trace` output is structurally incapable of reaching disk.
// The file threshold itself comes from `resolveFileMinLevel()` (L1437-L1441),
// which accepts only `debug|info|success|warn|error` and **throws a TypeError on
// `trace`**. That is not an oversight in the reference: `trace` is the packet
// firehose, and a packet log is a different artifact with a different lifetime.
//
// The consequence, and the reason this project lost hours to it:
//
//     packet_push / packet_send / packet_recv / packet_terminal
//       are `packetLog.trace(...)` calls (L2196-L2253, L346839-L347005).
//       They are gated by `passesConsole`.
//       They go to stdout.
//       THEY NEVER APPEAR IN A LOG FILE.
//
// So this sink has to do three things that look contradictory until you have
// read the above:
//
//   1. **Not crash when the process level is `trace`.** A process running
//      `SNOWLUMA_LOG_LEVEL=trace` emits trace entries; `setLogSink` hands every
//      one of them to us. `write()` must return `false` for them, not throw.
//
//   2. **Not crash when the *file* level is `trace`.** The reference throws a
//      TypeError at startup here; see `resolveFileMinLevel` below for the
//      deliberate, documented divergence and why it is safer.
//
//   3. **Keep the separation visible.** `LogFileSink.write` drops `trace` and
//      counts it in `status.traceSuppressed`, so "why is my packet log empty?"
//      has an observable answer instead of being a silent mystery.
//
// ===========================================================================
// BACKPRESSURE POLICY — BOUNDED MEMORY, DROP-NEWEST, LOUD
// ===========================================================================
//
// The reference hands every line to a `WriteStream` and **ignores the boolean
// return** of `stream.write()` (L1043, L1060). A `WriteStream` accepts
// unconditionally; it buffers whatever it cannot hand to the fd. On a slow or
// stalled disk that buffer is the process's RSS, growing without bound until the
// OOM killer or a 1.9 GB box says otherwise. That is the one behaviour this port
// deliberately does NOT copy.
//
// This sink keeps a single FIFO queue with a hard byte cap (`maxQueueBytes`,
// default 4 MiB) and at most one write in flight:
//
//   * `write()` never blocks. It never awaits, never returns a promise, and
//     never throws — the caller is a logging call, and a logger that applies
//     backpressure to its caller deadlocks the first time the caller is logging
//     *about* the stall.
//   * The next line is handed to the stream only when the previous one's
//     write callback fires. Queue depth is therefore a real measure of disk lag,
//     not of how fast the caller can log.
//   * When a line would push the queue past the cap it is DROPPED — newest
//     first — and `status.droppedLines` is incremented. Dropping the newest is
//     the reference's own choice in `LogQuota.reserve` (L597-L619): it returns
//     `false` and the writer returns without writing. Keeping the newest and
//     discarding the oldest would reorder causality for no benefit, since the
//     file is a tail, not a transcript.
//   * A transition into "dropping" is reported once per reason through the
//     `onError` callback (rate-limited by `QUOTA_RETRY_MS`), so the failure is
//     never silent.
//   * `peakQueuedBytes` is exposed so a test (or an operator) can assert the cap
//     was never exceeded rather than inferring it.
//
// Memory ceiling: `maxQueueBytes` queued + one in-flight chunk + one
// `OpenLogFile` per open stream. Nothing else grows with log volume.
//
// ===========================================================================
// NAMING, ROTATION AND RETENTION — COPIED, NOT INVENTED
// ===========================================================================
//
//   file name   `snowluma-YYYY-MM-DD.log`, then `.1.log`, `.2.log`, … (L526-L528)
//   regex       /^snowluma-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/   (L528)
//   per-UIN     `<dir>/<uin>/snowluma-YYYY-MM-DD[.N].log`, dir matches /^\d+$/ (L529)
//   rotation    `file.bytes + incoming > maxBytes && file.bytes > 0` (L814),
//               next index found by `existsSync` probing upwards (L840-L848)
//   retention   `retainDays === 0` disables the sweep entirely (L719);
//               otherwise delete where `dateOf(nameDate) < now - retainDays*86400e3`
//               (L719-L725), oldest **mtime** first, and **stop at the first
//               failure** (`break`, L724).
//
// One honest note on "mtime-based retention": the reference's *cutoff comparison*
// uses the date parsed out of the **file name** (`dateOf(file.date)`, L722), not
// the mtime. mtime is what orders the deletion (`.sort` on `mtimeMs`, L722) and
// what orders quota eviction (L707). Both matter and they are different fields;
// this port reproduces both, exactly. A file renamed to an old date is therefore
// reaped immediately, and the newest-mtime file is the last one evicted.
//
// ===========================================================================
// SAFETY INVARIANTS
// ===========================================================================
//
//   * **Never delete a file it just opened.** Open streams live in `active`; both
//     the retention sweep and quota eviction filter on `!active.has(path)`, and
//     `clearClosedFiles` wraps its closes in `suspendMaintenance()` (L588-L596,
//     L995-L999) so maintenance cannot run midway through a swap.
//   * **Never follow a symlink out of the log dir.** The inventory walks with
//     `readdirSync(..., { withFileTypes: true })` and requires `entry.isFile()`,
//     which is an lstat fact: a symlink is `isSymbolicLink()`, never `isFile()`,
//     so it is skipped and never even stat'ed (L449-L487). Sizes come from
//     `lstatSync`, so a link's *target* is never measured either. Deletion only
//     ever sees paths that came out of that inventory.
//   * **A missing directory is created, not an error.** `mkdirSync(recursive)`
//     (L779-L785); if creation fails the writer goes `disabled` and reports
//     through `onError` instead of throwing.
//   * **Never throw into the caller's logging call.** `write()` has no `throw`
//     path: every fs call is wrapped, and every failure becomes an `onError`
//     report plus a `degraded` status.

import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  type Dirent,
  type WriteStream,
} from "node:fs";
import path from "node:path";

import type { LogEntry, LogLevel, LogSink } from "../onebot/log.js";
import { readEnvAlias } from "../bridge/env.js";

// ---------------------------------------------------------------------------
// Constants (reference L518-L530)
// ---------------------------------------------------------------------------

/** L519 `DEFAULT_DIR`. */
export const DEFAULT_LOG_DIR = "logs";
/** L520 `DEFAULT_MAX_MB` — the per-file rotation cap, NOT the total. */
export const DEFAULT_LOG_MAX_MB = 50;
/** L521 `DEFAULT_MAX_TOTAL_MB` — matches `config/runtime.json: logMaxTotalMb`. */
export const DEFAULT_LOG_MAX_TOTAL_MB = 1024;
/** L522 `DEFAULT_RETAIN_DAYS` — matches `config/runtime.json: logRetainDays`. */
export const DEFAULT_LOG_RETAIN_DAYS = 7;
/** L523-L525 naming. */
export const LOG_FILE_PREFIX = "snowluma-";
export const LOG_FILE_SUFFIX = ".log";
/** L528 — the only names the sweep will ever consider. */
export const LOG_FILE_RE = /^snowluma-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/;
/** L529 — per-UIN subdirectory names. */
export const ACCOUNT_DIR_RE = /^\d+$/;
/** L530 `QUOTA_RETRY_MS` — how long a degraded writer stays degraded before retry. */
export const QUOTA_RETRY_MS = 5_000;

/** L407 `MAX_LOG_TOTAL_MB`. */
export const MAX_LOG_TOTAL_MB = Math.floor(Number.MAX_SAFE_INTEGER / (1024 * 1024));
/** L408 `MAX_LOG_RETAIN_DAYS`. */
export const MAX_LOG_RETAIN_DAYS = Math.floor(Number.MAX_SAFE_INTEGER / (1440 * 60 * 1_000));

/**
 * Default bound on queued-but-not-yet-written log bytes (see "BACKPRESSURE
 * POLICY"). 4 MiB is ~1.5% of this box's RAM and ~40 000 averaged log lines, so
 * it only engages when the disk is genuinely the bottleneck.
 */
export const DEFAULT_MAX_QUEUE_BYTES = 4 * 1024 * 1024;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  trace: 5,
  debug: 10,
  info: 20,
  success: 25,
  warn: 30,
  error: 40,
};

// ---------------------------------------------------------------------------
// log-sanitize (reference L93-L172)
// ---------------------------------------------------------------------------

const ESC = 27;
const BEL = 7;
const C1_CSI = 155;
const C1_ST = 156;
const C1_OSC = 157;
const C1_STRING_STARTERS = new Set([144, 152, 158, 159]);

function skipCsi(line: string, start: number): number {
  for (let i = start; i < line.length; i += 1) {
    const code = line.charCodeAt(i);
    if (code >= 64 && code <= 126) return i + 1;
  }
  return line.length;
}

function skipControlString(line: string, start: number, allowBell: boolean): number {
  for (let i = start; i < line.length; i += 1) {
    const code = line.charCodeAt(i);
    if (allowBell && code === BEL) return i + 1;
    if (code === C1_ST) return i + 1;
    if (code === ESC && line.charCodeAt(i + 1) === 92) return i + 2;
  }
  return line.length;
}

function skipEscSequence(line: string, start: number): number {
  if (start >= line.length) return line.length;
  const first = line.charCodeAt(start);
  if (first === 91) return skipCsi(line, start + 1);
  if (first === 93) return skipControlString(line, start + 1, true);
  if (first === 80 || first === 88 || first === 94 || first === 95) return skipControlString(line, start + 1, false);
  let i = start;
  while (i < line.length) {
    const code = line.charCodeAt(i);
    if (code < 32 || code > 47) break;
    i += 1;
  }
  const final = line.charCodeAt(i);
  return final >= 48 && final <= 126 ? i + 1 : start;
}

/**
 * L134 `sanitizeLogLine`: strip terminal presentation and control sequences
 * before the line reaches disk.
 *
 * The reference applies this *inside* the file transport (L1043), not to the
 * console line, because a payload can carry raw bytes into a formatted message.
 * TAB and LF survive (stack traces need them). An unterminated terminal string
 * consumes the remainder rather than leaking its invisible payload.
 */
export function sanitizeLogLine(line: string): string {
  let plain = "";
  for (let i = 0; i < line.length; ) {
    const code = line.charCodeAt(i);
    if (code === ESC) {
      i = skipEscSequence(line, i + 1);
      continue;
    }
    if (code === C1_CSI) {
      i = skipCsi(line, i + 1);
      continue;
    }
    if (code === C1_OSC || C1_STRING_STARTERS.has(code)) {
      i = skipControlString(line, i + 1, code === C1_OSC);
      continue;
    }
    if ((code < 32 && code !== 9 && code !== 10) || (code >= 127 && code <= 159)) {
      i += 1;
      continue;
    }
    plain += line[i];
    i += 1;
  }
  return plain;
}

// ---------------------------------------------------------------------------
// File level gate (reference L1437-L1441)
// ---------------------------------------------------------------------------

/** A level a file is allowed to record. `trace` is deliberately absent. */
export type FileLogLevel = Exclude<LogLevel, "trace">;

const FILE_LEVELS: readonly FileLogLevel[] = ["debug", "info", "success", "warn", "error"];

export interface FileLevelResolution {
  /** The threshold the sink will apply. */
  readonly level: FileLogLevel;
  /** True when the configured value was `trace` and was normalised to `debug`. */
  readonly traceCoerced: boolean;
}

/**
 * L1437 `resolveFileMinLevel`, with one deliberate and documented divergence.
 *
 * The reference throws `TypeError("SNOWLUMA_LOG_FILE_LEVEL must be one of:
 * debug, info, success, warn, error")` for `trace`. That is a **startup** crash
 * triggered by a config value whose only possible effect — given that
 * `passesFile` already excludes trace — is "record debug and above". Crashing
 * the process over a value that cannot change behaviour is strictly worse than
 * the equivalent of `debug`, and it is exactly the failure this project spent
 * hours chasing (see the header). So:
 *
 *   * `trace`            -> `{ level: "debug", traceCoerced: true }`  (divergence)
 *   * `debug|info|success|warn|error` -> that level
 *   * absent / blank     -> `debug` (reference L1439 default)
 *   * anything else      -> `TypeError`, as the reference does
 *
 * `traceCoerced` is surfaced on `LogFileSink.status` so the normalisation is
 * observable rather than silent.
 */
export function resolveFileMinLevel(raw: string | undefined = readEnvAlias("LOG_FILE_LEVEL")): FileLevelResolution {
  if (raw === undefined || raw.trim() === "") return { level: "debug", traceCoerced: false };
  const normalized = raw.trim().toLowerCase();
  if (normalized === "trace") return { level: "debug", traceCoerced: true };
  if ((FILE_LEVELS as readonly string[]).includes(normalized)) {
    return { level: normalized as FileLogLevel, traceCoerced: false };
  }
  throw new TypeError("HAIZAKURA_LOG_FILE_LEVEL (or SNOWLUMA_LOG_FILE_LEVEL) must be one of: debug, info, success, warn, error");
}

// ---------------------------------------------------------------------------
// Naming (reference L442-L447, L899-L902)
// ---------------------------------------------------------------------------

/** L442 `todayString` — LOCAL date, because the file name is a wall-clock day. */
export function todayString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** L445 `dateOf` — parse a `YYYY-MM-DD` name fragment back to a local midnight. */
export function dateOf(s: string): Date {
  const [y, m, d] = s.split("-").map((v) => Number.parseInt(v, 10));
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** L899 `pathFor`: `snowluma-<date>.log`, then `snowluma-<date>.1.log`, … */
export function logFilePath(dir: string, date: string, splitIndex: number): string {
  const tail = splitIndex > 0 ? `.${String(splitIndex)}` : "";
  return path.join(dir, `${LOG_FILE_PREFIX}${date}${tail}${LOG_FILE_SUFFIX}`);
}

/**
 * L833-L838 `ensureForToday`'s index probe, reproduced exactly including its
 * quirk: `idx` starts at `0` and the loop tests `idx + 1`, so the day's first
 * **gap** is used, not `highest + 1`. With `.1` present but no base file, a
 * fresh open still lands on index `0`.
 */
function existingDayIndex(dir: string, date: string): number {
  let index = 0;
  while (existsSync(logFilePath(dir, date, index + 1))) index += 1;
  return index;
}

/** L840-L848 `rotateBySize`'s index probe: first free index at or above `from`. */
function firstFreeIndex(dir: string, date: string, from: number): number {
  let index = from;
  while (existsSync(logFilePath(dir, date, index))) index += 1;
  return index;
}

// ---------------------------------------------------------------------------
// Policies and status
// ---------------------------------------------------------------------------

export interface LogStoragePolicy {
  /** `config/runtime.json: logMaxTotalMb` — total bytes across every managed file. */
  readonly maxTotalMb: number;
  /** `config/runtime.json: logRetainDays` — 0 disables retention (reference L719). */
  readonly retainDays: number;
  /** `config/runtime.json: logPerUin` — also mirror each line into `<dir>/<uin>/`. */
  readonly perUinEnabled: boolean;
}

export interface LogFileSinkOptions extends Partial<LogStoragePolicy> {
  /** Directory the managed logs live in. Defaults to `SNOWLUMA_LOG_DIR` or `logs`. */
  readonly dir?: string;
  /** Per-file rotation cap in bytes. Defaults to `SNOWLUMA_LOG_MAX_MB` (MiB) or 50 MiB. */
  readonly maxFileBytes?: number;
  /** Hard cap on queued-but-unwritten bytes. Defaults to 4 MiB. */
  readonly maxQueueBytes?: number;
  /** File threshold. Defaults to `resolveFileMinLevel()`. */
  readonly fileLevel?: FileLogLevel;
  /**
   * Where storage failures go. The `LogSink` signature is `(entry) => void`, which
   * has no error channel, so this callback IS the error surface. Defaults to
   * `[logger.storage] …` on stderr, matching reference L489-L490.
   */
  readonly onError?: (message: string, error?: unknown) => void;
}

export interface LogStorageStatus {
  readonly state: "healthy" | "warning" | "degraded" | "disabled";
  readonly directory: string;
  readonly totalBytes: number;
  readonly maxTotalBytes: number;
  readonly retainDays: number;
  readonly perUinEnabled: boolean;
  readonly fileCount: number;
  readonly activeFileCount: number;
  readonly droppedLines: number;
  /** Lines refused because they were `trace` (see the header). */
  readonly traceSuppressed: number;
  /** Bytes queued but not yet handed to a stream. */
  readonly queuedBytes: number;
  /** High-water mark of `queuedBytes`; never exceeds `maxQueueBytes`. */
  readonly peakQueuedBytes: number;
  readonly maxQueueBytes: number;
  readonly fileLevel: FileLogLevel;
  /** True when `SNOWLUMA_LOG_FILE_LEVEL=trace` was normalised to `debug`. */
  readonly fileLevelTraceCoerced: boolean;
  readonly currentPath: string | null;
  readonly lastError?: string;
}

interface ManagedLogFile {
  readonly path: string;
  readonly bytes: number;
  readonly mtimeMs: number;
  readonly date: string;
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** L489 `reportStorageError` — the default `onError`. */
function reportStorageError(message: string): void {
  process.stderr.write(`[logger.storage] ${message}\n`);
}

/** L492 `validatePolicy`. Throws on bad config; never called from `write()`. */
export function validateLogStoragePolicy(policy: LogStoragePolicy): void {
  if (!Number.isSafeInteger(policy.maxTotalMb) || policy.maxTotalMb <= 0 || policy.maxTotalMb > MAX_LOG_TOTAL_MB) {
    throw new RangeError(`maxTotalMb must be an integer in 1..${String(MAX_LOG_TOTAL_MB)}`);
  }
  if (!Number.isSafeInteger(policy.retainDays) || policy.retainDays < 0 || policy.retainDays > MAX_LOG_RETAIN_DAYS) {
    throw new RangeError(`retainDays must be an integer in 0..${String(MAX_LOG_RETAIN_DAYS)}`);
  }
  if (typeof policy.perUinEnabled !== "boolean") throw new TypeError("perUinEnabled must be a boolean");
}

// ---------------------------------------------------------------------------
// Inventory (reference L449-L487)
// ---------------------------------------------------------------------------

/**
 * L449 `listManagedLogFiles`: every *regular file* under `root` (and under each
 * `<uin>/` account directory) whose name matches `LOG_FILE_RE`.
 *
 * Symlink safety is structural, not a check: `entry.isFile()` is an lstat fact,
 * so a symlink is filtered out before any `stat` could follow it. Sizes come
 * from `lstatSync`, so a link's target is never measured either — meaning a link
 * planted in the log directory can neither be counted toward the quota nor
 * deleted. `readdirSync` entries are also never followed into (only names
 * matching `ACCOUNT_DIR_RE` are descended, one level, non-recursively).
 *
 * A missing root yields `[]` (L457-L459). Any other readdir/stat error throws —
 * the caller (`LogQuota`) turns that into a `degraded` report, because a
 * silently-empty inventory would let retention and the quota both stop working
 * without anyone noticing.
 */
export function listManagedLogFiles(root: string): ManagedLogFile[] {
  const out: ManagedLogFile[] = [];

  const readDirectory = (dir: string): Dirent[] | null => {
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return null;
      throw new Error(`failed to read managed log directory ${dir}: ${messageOf(error)}`, { cause: error });
    }
  };

  const visit = (dir: string, entries: readonly Dirent[]): void => {
    for (const entry of entries) {
      // lstat fact: a symlink is never `isFile()`, so it is skipped here and
      // never stat'ed below. This is the "never follow a symlink out" guarantee.
      if (!entry.isFile()) continue;
      const match = LOG_FILE_RE.exec(entry.name);
      if (!match?.[1]) continue;
      const filePath = path.resolve(dir, entry.name);
      try {
        const stat = lstatSync(filePath);
        // Belt and braces: `isFile()` above already excluded links, but if a
        // future Node changes Dirent semantics the link itself (not its target)
        // is what must be measured.
        if (stat.isSymbolicLink()) continue;
        out.push({ path: filePath, bytes: stat.size, mtimeMs: stat.mtimeMs, date: match[1] });
      } catch (error) {
        if (isMissing(error)) continue;
        throw new Error(`failed to stat managed log ${filePath}: ${messageOf(error)}`, { cause: error });
      }
    }
  };

  const rootEntries = readDirectory(root);
  if (rootEntries === null) return out;
  visit(root, rootEntries);
  for (const entry of rootEntries) {
    if (!entry.isDirectory() || !ACCOUNT_DIR_RE.test(entry.name)) continue;
    const accountEntries = readDirectory(path.join(root, entry.name));
    if (accountEntries !== null) visit(path.join(root, entry.name), accountEntries);
  }
  return out;
}

// ---------------------------------------------------------------------------
// LogQuota (reference L531-L769)
// ---------------------------------------------------------------------------

/**
 * L531 `LogQuota`: the process-wide accounting for every managed file.
 *
 * Two independent reapers share this bookkeeping:
 *
 *   * **retention** (`cleanupExpired`) — name-date older than `retainDays`.
 *   * **capacity** (`ensureCapacity`) — evict oldest-mtime *closed* files until
 *     the incoming line fits under `maxTotalBytes`.
 *
 * and one invariant both respect: `active` files are never candidates. That is
 * the "never delete a file it just opened" rule, and it is why `deactivate` —
 * not the `unlink` — is the thing that makes a rotated file eligible.
 */
export class LogQuota {
  private readonly root: string;
  private maxTotalBytes: number;
  private retainDays: number;
  private readonly files = new Map<string, ManagedLogFile>();
  private readonly active = new Set<string>();
  private usedBytes = 0;
  private degraded = false;
  private lastError: string | null = null;
  private nextRetryAt = 0;
  private dropped = 0;
  private maintenanceSuspensions = 0;

  constructor(
    root: string,
    maxTotalBytes: number,
    retainDays: number,
    private readonly onError: (message: string, error?: unknown) => void = reportStorageError,
    maintainOnLoad = true,
  ) {
    this.root = root;
    this.maxTotalBytes = maxTotalBytes;
    this.retainDays = retainDays;
    this.loadManagedFiles();
    if (maintainOnLoad) {
      this.cleanupExpired();
      this.ensureCapacity(0);
    }
  }

  get totalBytes(): number {
    return this.usedBytes;
  }

  get fileCount(): number {
    return this.files.size;
  }

  get activeFileCount(): number {
    return this.active.size;
  }

  get droppedLines(): number {
    return this.dropped;
  }

  get isDegraded(): boolean {
    return this.degraded;
  }

  get lastFailure(): string | null {
    return this.lastError;
  }

  /** L553 `activate`: register an open stream and return the bytes already on disk. */
  activate(filePath: string): number | null {
    const normalized = path.resolve(filePath);
    const known = this.files.get(normalized);
    if (known) {
      this.active.add(normalized);
      return known.bytes;
    }
    let bytes = 0;
    let mtimeMs = Date.now();
    try {
      const stat = lstatSync(normalized);
      bytes = stat.size;
      mtimeMs = stat.mtimeMs;
    } catch (error) {
      if (!isMissing(error)) {
        this.enterDegraded(`failed to inspect active log ${normalized}: ${messageOf(error)}`, error);
        return null;
      }
    }
    const date = LOG_FILE_RE.exec(path.basename(normalized))?.[1] ?? todayString();
    this.files.set(normalized, { path: normalized, bytes, mtimeMs, date });
    this.usedBytes += bytes;
    this.active.add(normalized);
    return bytes;
  }

  /** L583 `deactivate`: the stream is closed, so the file becomes reapable. */
  deactivate(filePath: string): void {
    this.active.delete(path.resolve(filePath));
    if (this.maintenanceSuspensions > 0) return;
    this.maintainAfterClose();
  }

  /**
   * L588 `suspendMaintenance`: hold maintenance off across a multi-file swap
   * (closing and reopening every writer) so a sweep cannot run against a
   * half-updated `active` set and delete a file that is about to be reopened.
   */
  suspendMaintenance(): () => void {
    this.maintenanceSuspensions += 1;
    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      this.maintenanceSuspensions = Math.max(0, this.maintenanceSuspensions - 1);
    };
  }

  /**
   * L597 `reserve`: account `bytes` against `filePath`, freeing closed files if
   * needed. `false` means "do not write this line" — the drop-newest policy.
   */
  reserve(filePath: string, bytes: number): boolean {
    if (bytes <= 0) return true;
    if (this.degraded && !this.retry(false)) {
      this.dropped += 1;
      return false;
    }
    if (!this.ensureCapacity(bytes)) {
      this.dropped += 1;
      return false;
    }
    const normalized = path.resolve(filePath);
    const file = this.files.get(normalized);
    if (!file) {
      if (this.activate(normalized) === null) {
        this.dropped += 1;
        return false;
      }
      return this.reserve(normalized, bytes);
    }
    this.files.set(normalized, { ...file, bytes: file.bytes + bytes, mtimeMs: Date.now() });
    this.usedBytes += bytes;
    return true;
  }

  /** L620 `writeFailed`. */
  writeFailed(filePath: string, error: unknown): void {
    this.storageFailed(`write ${filePath}`, error);
  }

  /** L624 `storageFailed`. */
  storageFailed(operation: string, error: unknown): void {
    this.enterDegraded(`${operation}: ${messageOf(error)}`, error);
  }

  /**
   * Count lines dropped by the writer's own queue cap (see "BACKPRESSURE
   * POLICY"). Reported through the same `onError` surface — `enterDegraded`
   * already suppresses a repeated identical reason — so a stalled disk shows up
   * as both a counter and a line on stderr.
   */
  recordDropped(count: number, reason: string): void {
    if (count <= 0) return;
    this.dropped += count;
    this.enterDegraded(reason);
  }

  /** L629 `snapshot`. */
  snapshot(): {
    state: "healthy" | "warning" | "degraded";
    totalBytes: number;
    fileCount: number;
    activeFileCount: number;
    droppedLines: number;
    lastError?: string;
  } {
    return {
      state: this.degraded ? "degraded" : this.lastError !== null ? "warning" : "healthy",
      totalBytes: this.usedBytes,
      fileCount: this.files.size,
      activeFileCount: this.active.size,
      droppedLines: this.dropped,
      ...(this.lastError !== null ? { lastError: this.lastError } : {}),
    };
  }

  /** L638 `updatePolicy`. */
  updatePolicy(maxTotalBytes: number, retainDays: number): void {
    this.maxTotalBytes = maxTotalBytes;
    this.retainDays = retainDays;
    this.degraded = false;
    this.lastError = null;
    this.nextRetryAt = 0;
    try {
      this.refreshClosedFiles();
      this.cleanupExpired();
      this.ensureCapacity(0);
    } catch (error) {
      this.enterDegraded(`failed to apply log storage policy: ${messageOf(error)}`, error);
      throw error;
    }
  }

  /** L655 `clearClosedFiles`: delete every closed managed file, quota ignored. */
  clearClosedFiles(): {
    deletedFiles: number;
    freedBytes: number;
    failures: { file: string; message: string }[];
  } {
    this.refreshClosedFiles();
    let deletedFiles = 0;
    let freedBytes = 0;
    const failures: { file: string; message: string }[] = [];
    const candidates = [...this.files.values()]
      .filter((file) => !this.active.has(file.path))
      .sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
    for (const file of candidates) {
      const bytes = file.bytes;
      if (this.deleteManagedFile(file, "capacity")) {
        deletedFiles += 1;
        freedBytes += bytes;
      } else {
        failures.push({ file: path.relative(this.root, file.path), message: this.lastError ?? "unknown cleanup error" });
      }
    }
    if (failures.length === 0) {
      this.degraded = false;
      this.lastError = null;
      this.nextRetryAt = 0;
    } else if (this.usedBytes > this.maxTotalBytes) {
      this.enterDegraded(
        `managed logs still use ${String(this.usedBytes)} bytes after manual cleanup, exceeding the ${String(this.maxTotalBytes)} byte limit`,
      );
    }
    this.ensureCapacity(0);
    return { deletedFiles, freedBytes, failures };
  }

  /** L676 `retry`. */
  retry(force: boolean): boolean {
    if (!force && Date.now() < this.nextRetryAt) return false;
    this.degraded = false;
    this.lastError = null;
    try {
      this.refreshClosedFiles();
      const recovered = this.ensureCapacity(0);
      if (recovered) this.nextRetryAt = 0;
      return recovered;
    } catch (error) {
      this.enterDegraded(`failed to refresh managed logs: ${messageOf(error)}`, error);
      return false;
    }
  }

  /** L694 `maintainAfterClose`: reap as soon as a stream closes. */
  maintainAfterClose(): void {
    try {
      this.refreshClosedFiles();
      this.cleanupExpired();
      if (this.degraded) this.retry(true);
      else this.ensureCapacity(0);
    } catch (error) {
      this.enterDegraded(`failed to maintain managed logs after rotation: ${messageOf(error)}`, error);
    }
  }

  /**
   * L704 `ensureCapacity`: evict oldest-mtime closed files until `incomingBytes`
   * fits. `break` on the first failed delete, like the reference — retrying a
   * delete that just failed for a permission reason only burns syscalls.
   */
  ensureCapacity(incomingBytes: number): boolean {
    if (this.usedBytes + incomingBytes <= this.maxTotalBytes) return true;
    const candidates = [...this.files.values()]
      .filter((file) => !this.active.has(file.path))
      .sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
    for (const file of candidates) {
      if (this.usedBytes + incomingBytes <= this.maxTotalBytes) break;
      if (!this.deleteManagedFile(file, "capacity")) break;
    }
    if (this.usedBytes + incomingBytes <= this.maxTotalBytes) return true;
    this.enterDegraded(
      `managed logs require ${String(this.usedBytes + incomingBytes)} bytes, exceeding the ${String(this.maxTotalBytes)} byte limit; no closed log can be reclaimed`,
    );
    return false;
  }

  /** L715 `enterDegraded`. */
  private enterDegraded(message: string, cause?: unknown): void {
    const shouldReport = !this.degraded || this.lastError !== message;
    this.degraded = true;
    this.lastError = message;
    this.nextRetryAt = Date.now() + QUOTA_RETRY_MS;
    if (shouldReport) this.onError(message, cause);
  }

  /**
   * L719 `cleanupExpired`.
   *
   * `retainDays === 0` disables the sweep entirely (L720) — "keep forever", not
   * "delete everything". The cutoff is compared against the date in the **file
   * name**; `mtimeMs` only orders the deletion. See the header for why those are
   * two different fields and why copying exactly matters.
   */
  cleanupExpired(now: number = Date.now()): number {
    if (this.retainDays === 0) return 0;
    const cutoff = now - this.retainDays * 24 * 60 * 60 * 1_000;
    const expired = [...this.files.values()]
      .filter((file) => !this.active.has(file.path) && dateOf(file.date).getTime() < cutoff)
      .sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
    let deleted = 0;
    for (const file of expired) {
      if (!this.deleteManagedFile(file, "retention")) break;
      deleted += 1;
    }
    return deleted;
  }

  /** L728 `deleteManagedFile`. */
  private deleteManagedFile(file: ManagedLogFile, reason: string): boolean {
    try {
      unlinkSync(file.path);
      this.files.delete(file.path);
      this.usedBytes = Math.max(0, this.usedBytes - file.bytes);
      return true;
    } catch (error) {
      this.lastError = `${reason} cleanup failed for ${file.path}: ${messageOf(error)}`;
      this.onError(this.lastError, error);
      return false;
    }
  }

  /** L742 `loadManagedFiles`. */
  private loadManagedFiles(): void {
    for (const file of listManagedLogFiles(this.root)) {
      this.files.set(file.path, file);
      this.usedBytes += file.bytes;
    }
  }

  /**
   * L748 `refreshClosedFiles`. Active streams are tracked in memory and may be
   * newer than `lstat` while the WriteStream buffer is still flushing, so they
   * are skipped — otherwise the quota would *under*-count and never evict.
   */
  private refreshClosedFiles(): void {
    const disk = new Map(listManagedLogFiles(this.root).map((file) => [file.path, file]));
    for (const [filePath, file] of [...this.files]) {
      if (this.active.has(filePath)) continue;
      const next = disk.get(filePath);
      this.usedBytes -= file.bytes;
      if (next) {
        this.files.set(filePath, next);
        this.usedBytes += next.bytes;
        disk.delete(filePath);
      } else {
        this.files.delete(filePath);
      }
    }
    for (const file of disk.values()) {
      if (this.files.has(file.path)) continue;
      this.files.set(file.path, file);
      this.usedBytes += file.bytes;
    }
  }
}

// ---------------------------------------------------------------------------
// LogFileWriter (reference L770-L908) — one open file, one bounded queue
// ---------------------------------------------------------------------------

interface OpenLogFile {
  readonly stream: WriteStream;
  readonly path: string;
  readonly date: string;
  readonly splitIndex: number;
  /** Bytes accepted into this file (enqueued + written), reference L829. */
  bytes: number;
}

type QueueItem =
  | { readonly kind: "line"; readonly file: OpenLogFile; readonly data: string; readonly bytes: number }
  | { readonly kind: "close"; readonly file: OpenLogFile };

/**
 * L770 `FileWriter`, plus the bounded queue described in the header.
 *
 * `close` is enqueued rather than applied immediately, so it is strictly
 * ordered behind that file's pending lines. Calling `stream.end()` while a
 * `stream.write()` callback is still outstanding is what produces
 * `ERR_STREAM_WRITE_AFTER_END`; serialising through the one FIFO removes the
 * whole class of bug without a lock.
 */
export class LogFileWriter {
  private readonly maxQueueBytes: number;
  private readonly quota: LogQuota;
  private readonly onError: (message: string, error?: unknown) => void;
  private disabled = false;
  private shuttingDown = false;
  private file: OpenLogFile | null = null;
  private readonly queue: QueueItem[] = [];
  private queuedBytes = 0;
  private peakQueuedBytes = 0;
  private inFlight = false;
  private readonly openStreams = new Set<WriteStream>();

  constructor(
    private readonly dir: string,
    private readonly maxBytes: number,
    quota: LogQuota,
    options: { maxQueueBytes: number; onError: (message: string, error?: unknown) => void },
  ) {
    this.maxQueueBytes = options.maxQueueBytes;
    this.onError = options.onError;
    this.quota = quota;
    try {
      mkdirSync(dir, { recursive: true });
    } catch (error) {
      // L779-L785: a log dir that cannot be created disables the writer and is
      // reported — it never propagates out of the logging call.
      this.disabled = true;
      this.quota.storageFailed(`failed to create log directory ${dir}`, error);
    }
  }

  get isDisabled(): boolean {
    return this.disabled;
  }

  get currentPath(): string | null {
    return this.file?.path ?? null;
  }

  get pendingBytes(): number {
    return this.queuedBytes;
  }

  get peakPendingBytes(): number {
    return this.peakQueuedBytes;
  }

  get pendingLines(): number {
    return this.queue.filter((item) => item.kind === "line").length;
  }

  /** L792 `prepare`: open today's file so a caller can assert it exists. */
  async prepare(): Promise<void> {
    if (this.disabled) throw new Error(`log writer is disabled for ${this.dir}`);
    const file = this.targetFile(0);
    if (file === null) throw new Error(`failed to prepare log writer in ${this.dir}`);
    // Reference L792-L806 races `open` against `error` so a directory that
    // became unwritable after `mkdirSync` rejects instead of hanging forever.
    await new Promise<void>((resolve, reject) => {
      const opened = (): void => {
        file.stream.off("error", failed);
        resolve();
      };
      const failed = (error: unknown): void => {
        file.stream.off("open", opened);
        reject(error instanceof Error ? error : new Error(messageOf(error)));
      };
      file.stream.once("open", opened);
      file.stream.once("error", failed);
    });
  }

  /**
   * L809 `write`: enqueue one already-newline-terminated line. Returns `false`
   * when the line was dropped (queue cap, quota, or a disabled writer). Never
   * throws.
   */
  write(data: string, bytes: number): boolean {
    if (this.disabled || this.shuttingDown) return false;
    if (bytes > 0 && this.queuedBytes + bytes > this.maxQueueBytes) {
      // Drop-newest (see header). The line is refused *before* the quota is
      // charged, so accounting never drifts from what is really queued. The
      // reason string is deliberately stable so `enterDegraded` reports the
      // onset of a stall once instead of once per line.
      this.quota.recordDropped(1, `log queue full (${String(this.maxQueueBytes)} byte cap): disk is slower than the logger`);
      return false;
    }
    const file = this.targetFile(bytes);
    if (file === null) return false;
    if (!this.quota.reserve(file.path, bytes)) return false;
    file.bytes += bytes;
    this.queue.push({ kind: "line", file, data, bytes });
    this.queuedBytes += bytes;
    if (this.queuedBytes > this.peakQueuedBytes) this.peakQueuedBytes = this.queuedBytes;
    this.pump();
    return true;
  }

  /**
   * L812 `ensureForToday` + L814 rotation trigger, in one place because the
   * order matters: the day boundary is checked before the size cap, so a line
   * that straddles midnight starts the new day's file rather than rotating the
   * old day's.
   */
  private targetFile(incoming: number): OpenLogFile | null {
    const today = todayString();
    if (this.file !== null && this.file.date !== today) this.closeCurrent();
    if (this.file === null && !this.openForDate(today, existingDayIndex(this.dir, today))) return null;
    const current = this.file;
    if (current === null) return null;
    // L814: `bytes > 0` keeps an oversized single line from producing an empty
    // rotated file followed by another empty one.
    if (current.bytes + incoming > this.maxBytes && current.bytes > 0) this.rotateBySize();
    return this.file;
  }

  /** L840 `rotateBySize`. */
  private rotateBySize(): void {
    const current = this.file;
    if (current === null) return;
    this.closeCurrent();
    this.openForDate(current.date, firstFreeIndex(this.dir, current.date, current.splitIndex + 1));
  }

  /** L873 `openFile`. */
  private openForDate(date: string, splitIndex: number): boolean {
    this.file = this.openFile(date, splitIndex);
    return this.file !== null;
  }

  /** L835 `closeCurrent` — enqueue the close, do not apply it out of order. */
  private closeCurrent(): void {
    const current = this.file;
    this.file = null;
    if (current === null) return;
    this.queue.push({ kind: "close", file: current });
    this.pump();
  }

  /** L873 `openFile`. */
  private openFile(date: string, splitIndex: number): OpenLogFile | null {
    const p = logFilePath(this.dir, date, splitIndex);
    const existingBytes = this.quota.activate(p);
    if (existingBytes === null) return null;
    try {
      const stream = createWriteStream(p, { flags: "a" });
      this.openStreams.add(stream);
      stream.on("close", () => this.openStreams.delete(stream));
      stream.on("error", (error: unknown) => {
        this.disabled = true;
        if (this.file?.stream === stream) this.file = null;
        this.quota.deactivate(p);
        this.quota.writeFailed(p, error);
        this.failQueue(`log stream failed for ${p}`, error);
        this.onError(`log stream failed for ${p}: ${messageOf(error)}`, error);
      });
      return { stream, bytes: existingBytes, date, splitIndex, path: p };
    } catch (error) {
      // L891-L896.
      this.disabled = true;
      this.quota.deactivate(p);
      this.quota.storageFailed(`failed to open log file ${p}`, error);
      this.onError(`failed to open log file ${p}: ${messageOf(error)}`, error);
      return null;
    }
  }

  /**
   * Hand the head of the queue to its stream. Exactly one write is in flight at
   * a time: that is what makes `queuedBytes` a true measure of disk lag and what
   * bounds memory at `maxQueueBytes` + one chunk.
   */
  private pump(): void {
    if (this.inFlight) return;
    const item = this.queue.shift();
    if (item === undefined) return;

    if (item.kind === "close") {
      this.inFlight = true;
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.inFlight = false;
        this.quota.deactivate(item.file.path);
        this.pump();
      };
      item.file.stream.once("error", finish);
      try {
        item.file.stream.end(finish);
      } catch (error) {
        this.quota.writeFailed(item.file.path, error);
        this.onError(`failed to close log file ${item.file.path}: ${messageOf(error)}`, error);
        finish();
      }
      return;
    }

    this.queuedBytes -= item.bytes;
    this.inFlight = true;
    let settled = false;
    const settle = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      this.inFlight = false;
      if (error !== undefined) {
        this.disabled = true;
        this.quota.writeFailed(item.file.path, error);
        this.onError(`failed to write log file ${item.file.path}: ${messageOf(error)}`, error);
        this.failQueue(`write failed for ${item.file.path}`, error);
        return;
      }
      this.pump();
    };
    try {
      item.file.stream.write(item.data, () => settle());
    } catch (error) {
      // A synchronous throw from `write()` (destroyed stream, ENOSPC surfaced
      // eagerly) still must not reach the caller.
      settle(error);
    }
  }

  /** Abandon every queued line, counting them as dropped. */
  private failQueue(reason: string, error?: unknown): void {
    const dropped = this.queue.reduce((count, item) => (item.kind === "line" ? count + 1 : count), 0);
    const bytes = this.queuedBytes;
    this.queue.length = 0;
    this.queuedBytes = 0;
    this.peakQueuedBytes = 0;
    if (dropped > 0) this.quota.recordDropped(dropped, `${reason}: ${String(dropped)} line(s), ${String(bytes)} byte(s) discarded`);
    this.onError(`${reason}: discarded ${String(dropped)} pending line(s)`, error);
    for (const stream of this.openStreams) {
      try {
        stream.destroy();
      } catch {
        /* already gone */
      }
    }
    this.openStreams.clear();
  }

  /** L853 `close`: drain the queue (lines and closes), then resolve. */
  async close(): Promise<void> {
    if (this.shuttingDown) {
      await this.drain();
      return;
    }
    this.shuttingDown = true;
    this.closeCurrent();
    await this.drain();
  }

  /** Wait until nothing is queued and no write is in flight. */
  async drain(): Promise<void> {
    this.pump();
    while (this.queue.length > 0 || this.inFlight) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      this.pump();
    }
  }
}

// ---------------------------------------------------------------------------
// LogFileSink (reference L909-L1170) — shared writer + optional per-UIN fan-out
// ---------------------------------------------------------------------------

/**
 * L909 `FileTransport`: the object you hand to `setLogSink`.
 *
 * `logPerUin: false` (the shipped `config/runtime.json`) means one shared file.
 * `logPerUin: true` is **implemented**, not rejected, because the reference
 * implements it: every line whose entry carries a `uin` is mirrored into
 * `<dir>/<uin>/` (L1052-L1060) with the same name, the same rotation trigger
 * and the **same quota** (`LogQuota`, L921/L1048) — so the total across shared
 * and per-UIN files is what `logMaxTotalMb` bounds, not each directory.
 */
export class LogFileSink {
  private readonly dir: string;
  private readonly maxFileBytes: number;
  private readonly maxQueueBytes: number;
  private readonly onError: (message: string, error?: unknown) => void;
  private readonly fileLevel: FileLogLevel;
  private readonly fileLevelTraceCoerced: boolean;
  private maxTotalBytes: number;
  private retainDays: number;
  private perUinEnabled: boolean;
  private quota: LogQuota | null = null;
  private shared: LogFileWriter | null = null;
  private readonly perUin = new Map<number, LogFileWriter>();
  private initializationError: string | null = null;
  private nextWriterRetryAt = 0;
  private traceSuppressed = 0;
  private closed = false;

  constructor(options: LogFileSinkOptions = {}) {
    const policy: LogStoragePolicy = {
      maxTotalMb: options.maxTotalMb ?? DEFAULT_LOG_MAX_TOTAL_MB,
      retainDays: options.retainDays ?? DEFAULT_LOG_RETAIN_DAYS,
      perUinEnabled: options.perUinEnabled ?? false,
    };
    validateLogStoragePolicy(policy);
    const level = options.fileLevel === undefined ? resolveFileMinLevel() : resolveFileMinLevel(options.fileLevel);
    this.fileLevel = level.level;
    this.fileLevelTraceCoerced = level.traceCoerced;
    this.dir = path.resolve(options.dir ?? readEnvAlias("LOG_DIR") ?? DEFAULT_LOG_DIR);
    this.maxFileBytes = options.maxFileBytes ?? resolveMaxFileBytes();
    this.maxQueueBytes = options.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES;
    this.onError = options.onError ?? reportStorageError;
    this.maxTotalBytes = policy.maxTotalMb * 1024 * 1024;
    this.retainDays = policy.retainDays;
    this.perUinEnabled = policy.perUinEnabled;
    this.initialize();
  }

  /** The directory managed files live in (absolute). */
  get directory(): string {
    return this.dir;
  }

  /** Current shared-file path, or `null` before the first line / when disabled. */
  get currentPath(): string | null {
    return this.shared?.currentPath ?? null;
  }

  /** Path of the per-UIN file for `uin`, if one is open. */
  perUinPath(uin: number): string | null {
    return this.perUin.get(uin)?.currentPath ?? null;
  }

  get status(): LogStorageStatus {
    const base = {
      directory: this.dir,
      maxTotalBytes: this.maxTotalBytes,
      retainDays: this.retainDays,
      perUinEnabled: this.perUinEnabled,
      maxQueueBytes: this.maxQueueBytes,
      fileLevel: this.fileLevel,
      fileLevelTraceCoerced: this.fileLevelTraceCoerced,
      traceSuppressed: this.traceSuppressed,
      queuedBytes: this.shared?.pendingBytes ?? 0,
      peakQueuedBytes: this.shared?.peakPendingBytes ?? 0,
      currentPath: this.shared?.currentPath ?? null,
    } as const;
    if (this.quota === null) {
      return {
        ...base,
        state: "disabled",
        totalBytes: 0,
        fileCount: 0,
        activeFileCount: 0,
        droppedLines: 0,
        ...(this.initializationError !== null ? { lastError: this.initializationError } : {}),
      };
    }
    return { ...this.quota.snapshot(), ...base };
  }

  /**
   * Write one emitted entry. **Never throws** — this is the caller's logging
   * call, and `LogSink` is `(entry) => void` with no error channel, so failures
   * leave through `onError` and `status`.
   *
   * Returns `true` when the line was accepted for at least one file.
   */
  write(entry: LogEntry): boolean {
    if (this.closed) return false;

    // ---- THE TRACE GUARD (reference L1480) -------------------------------
    // `passesFile = level !== "trace" && shouldLogToFile(level)`. Trace is
    // excluded *before* the threshold is consulted, so a process running
    // SNOWLUMA_LOG_LEVEL=trace still writes nothing here. This also keeps a
    // `trace` entry from ever reaching `LEVEL_WEIGHT` lookups in the file
    // gate, which is what the (throwing) `resolveFileMinLevel` path would do.
    if (entry.level === "trace") {
      this.traceSuppressed += 1;
      return false;
    }
    if (LEVEL_WEIGHT[entry.level] < LEVEL_WEIGHT[this.fileLevel]) return false;

    let line: string;
    try {
      // L1041: sanitize here, not in the logger — a payload can smuggle raw
      // control bytes through `%s` into the formatted message.
      line = `${sanitizeLogLine(entry.line)}\n`;
    } catch (error) {
      this.onError("failed to format log line", error);
      return false;
    }
    const bytes = Buffer.byteLength(line, "utf8");

    try {
      return this.dispatch(line, bytes, entry.uin);
    } catch (error) {
      // Defensive: nothing above is expected to throw, but the caller's logging
      // call must survive even a bug in this file.
      this.onError(`log sink threw while writing: ${messageOf(error)}`, error);
      return false;
    }
  }

  /** L1034 `write`. */
  private dispatch(line: string, bytes: number, uin: number | undefined): boolean {
    const shared = this.ensureSharedWriter();
    if (shared === null) return false;
    const accepted = shared.write(line, bytes);
    if (shared.isDisabled) {
      this.shared = null;
      this.nextWriterRetryAt = Date.now() + QUOTA_RETRY_MS;
      return false;
    }
    if (uin !== undefined && this.perUinEnabled) {
      let writer = this.perUin.get(uin);
      if (writer?.isDisabled === true) {
        this.perUin.delete(uin);
        writer = undefined;
      }
      if (writer === undefined) {
        writer = this.createWriter(path.join(this.dir, String(uin)));
        if (writer.isDisabled) return accepted;
        this.perUin.set(uin, writer);
      }
      writer.write(line, bytes);
    }
    return accepted;
  }

  private ensureSharedWriter(): LogFileWriter | null {
    if (this.shared !== null && !this.shared.isDisabled) return this.shared;
    if (this.closed) return null;
    // L1077-L1091 `recoverSharedWriterForWrite`: rate-limited recovery, so a
    // full disk does not turn every log line into a `mkdir` syscall.
    if (Date.now() < this.nextWriterRetryAt) return null;
    this.shared = null;
    if (this.quota === null) this.initialize();
    if (this.quota === null) return null;
    const writer = this.createWriter(this.dir);
    if (writer.isDisabled) return null;
    this.shared = writer;
    this.initializationError = null;
    this.nextWriterRetryAt = 0;
    return writer;
  }

  private createWriter(dir: string): LogFileWriter {
    // `this.quota` is guaranteed non-null by every caller.
    const quota = this.quota;
    if (quota === null) throw new Error("log quota is not initialised");
    return new LogFileWriter(dir, this.maxFileBytes, quota, { maxQueueBytes: this.maxQueueBytes, onError: this.onError });
  }

  /** L1155 `initialize`. */
  private initialize(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      const quota = new LogQuota(this.dir, this.maxTotalBytes, this.retainDays, this.onError);
      const writer = new LogFileWriter(this.dir, this.maxFileBytes, quota, {
        maxQueueBytes: this.maxQueueBytes,
        onError: this.onError,
      });
      if (writer.isDisabled) throw new Error(`failed to create shared log writer in ${this.dir}`);
      this.quota = quota;
      this.shared = writer;
      this.initializationError = null;
      this.nextWriterRetryAt = 0;
    } catch (error) {
      this.quota = null;
      this.shared = null;
      this.recordWriterRecoveryFailure(error);
    }
  }

  /** L1149 `recordWriterRecoveryFailure`. */
  private recordWriterRecoveryFailure(error: unknown): void {
    this.initializationError = `failed to initialize log storage ${this.dir}: ${messageOf(error)}`;
    this.nextWriterRetryAt = Date.now() + QUOTA_RETRY_MS;
    this.onError(this.initializationError, error);
  }

  /** L968 `updatePolicy`. */
  async updatePolicy(policy: LogStoragePolicy): Promise<LogStorageStatus> {
    validateLogStoragePolicy(policy);
    this.maxTotalBytes = policy.maxTotalMb * 1024 * 1024;
    this.retainDays = policy.retainDays;
    const disablingPerUin = this.perUinEnabled && !policy.perUinEnabled;
    this.perUinEnabled = policy.perUinEnabled;
    if (disablingPerUin) {
      const writers = [...this.perUin.values()];
      this.perUin.clear();
      await Promise.all(writers.map((writer) => writer.close()));
    }
    if (this.quota !== null) this.quota.updatePolicy(this.maxTotalBytes, this.retainDays);
    if (this.shared === null || this.shared.isDisabled) {
      this.nextWriterRetryAt = 0;
      this.ensureSharedWriter();
    }
    return this.status;
  }

  /** L982 `clearManagedLogs`. */
  async clearManagedLogs(): Promise<{
    deletedFiles: number;
    freedBytes: number;
    failures: { file: string; message: string }[];
    status: LogStorageStatus;
  }> {
    const quota = this.quota;
    if (quota === null) {
      return { deletedFiles: 0, freedBytes: 0, failures: [], status: this.status };
    }
    const writers = [...(this.shared !== null ? [this.shared] : []), ...this.perUin.values()];
    this.shared = null;
    this.perUin.clear();
    // L995: hold maintenance off until every stream is closed, so the sweep
    // cannot run while `active` still names files that are about to reopen.
    const resumeMaintenance = quota.suspendMaintenance();
    try {
      await Promise.all(writers.map((writer) => writer.close()));
    } finally {
      resumeMaintenance();
    }
    const result = quota.clearClosedFiles();
    if (!this.closed) this.ensureSharedWriter();
    return { ...result, status: this.status };
  }

  /** L719 manual sweep, for an operator or a test. */
  cleanupExpired(now?: number): number {
    return this.quota?.cleanupExpired(now) ?? 0;
  }

  /** Resolve once every queued line has reached the OS. */
  async flush(): Promise<void> {
    await this.shared?.drain();
    for (const writer of this.perUin.values()) await writer.drain();
  }

  /** L1516 `closeLogger`: flush, then close every stream. */
  async close(): Promise<void> {
    this.closed = true;
    const writers = [...(this.shared !== null ? [this.shared] : []), ...this.perUin.values()];
    this.shared = null;
    this.perUin.clear();
    await Promise.all(writers.map((writer) => writer.close()));
  }

  /** Adapt to the ambient logger's `LogSink` type. Safe: `write` never throws. */
  asLogSink(): LogSink {
    return (entry: LogEntry) => {
      this.write(entry);
    };
  }
}

/** L920 `SNOWLUMA_LOG_MAX_MB`, in bytes. */
function resolveMaxFileBytes(): number {
  const raw = readEnvAlias("LOG_MAX_MB");
  if (raw === undefined || raw.trim() === "") return DEFAULT_LOG_MAX_MB * 1024 * 1024;
  const parsed = Number(raw.trim());
  if (Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_LOG_TOTAL_MB) return parsed * 1024 * 1024;
  throw new RangeError(`SNOWLUMA_LOG_MAX_MB must be an integer in 1..${String(MAX_LOG_TOTAL_MB)}`);
}

/** Convenience constructor mirroring `configureFileTransport` (L501). */
export function createLogFileSink(options: LogFileSinkOptions = {}): LogFileSink {
  return new LogFileSink(options);
}
