// The streaming actions' managed temp directory — `stream-storage.ts`.
//
// Reference region: reference/index.mjs:17363-17593 (`../onebot/src/stream-storage.ts`,
// 230 lines). Ported because the streaming actions cannot work without it, and
// ported CLOSELY because almost every line here is a filesystem safety check rather
// than logic.
//
// ---------------------------------------------------------------------------
// Why this is a security module wearing a utilities hat
// ---------------------------------------------------------------------------
// The stream actions write attacker-influenced filenames into a directory that
// `clean_stream_temp_file` later deletes RECURSIVELY. Two independent hazards follow:
//
//   1. A `stream_id` or `filename` that escapes the root (`../..`, an absolute path,
//      a symlink planted between the check and the write) would let an upload write
//      anywhere the process can, and then let the cleaner delete there.
//   2. A directory that another LOCAL ACCOUNT owns or can write to would let that
//      account plant a symlink this process then follows. Hence `assertManagedDirectory`'s
//      three checks: not a symlink, owned by our uid, and not group/other-writable
//      (`mode & 0o22`).
//
// `resolveManagedRoot` is the subtle one: it does NOT create the root. If the root
// exists it is validated and `realpath`'d (so a symlinked root resolves to its
// target and every later `relative()` check is against the real path). If it does
// not exist, the PARENT must be a directory and the root is composed as
// `realpath(parent) + basename` — still uncreated, still checked on first use. The
// `mkdir` happens in `ensureManagedDirectory`, with mode `0o700`.
//
// ---------------------------------------------------------------------------
// What is deliberately NOT reproduced
// ---------------------------------------------------------------------------
// The reference's `snapshot()` (file/byte totals) has no OneBot caller — it is for
// the WebUI. `downloadDir` is created as a field but never used by any action: the
// download stream reads from the root and from URLs, and `clean_stream_temp_file`
// walks the root (which includes `download/`). Both are kept as fields so the
// directory layout matches, and `snapshot()` is omitted with this note rather than
// silently dropped.
//
// `createStreamStorage`'s `SNOWLUMA_STREAM_DIR` fallback behaviour IS reproduced:
// an invalid override is logged and ignored in favour of `os.tmpdir()/onebot-stream`,
// rather than failing startup. A misconfigured env var should not make the bot
// unbootable.

import { lstatSync, mkdirSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readEnvAlias } from "../bridge/env.js";

/** `0o700` — owner-only. Written as the reference writes it. */
const MANAGED_DIRECTORY_MODE = 0o700;

/** `mode & 0o22` — group-writable or other-writable. */
const GROUP_OR_OTHER_WRITABLE = 0o22;

/** A removable failure: `{ item, message }` with the root already redacted. */
export interface StreamStorageFailure {
  item: string;
  message: string;
}

export interface StreamStorageClearResult {
  deletedFiles: number;
  freedBytes: number;
  skippedActiveItems: number;
  failures: StreamStorageFailure[];
}

/** A `code`-bearing error, checked the way the reference checks it. */
function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `isStrictDescendant` — a child, not the root itself, and not above it. */
export function isStrictDescendant(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** `isSameOrDescendant` — the inclusive form, used by the cleaner. */
export function isSameOrDescendant(root: string, candidate: string): boolean {
  return root === candidate || isStrictDescendant(root, candidate);
}

/**
 * The four-way validation, in the reference's order.
 *
 * Order matters for the MESSAGE a caller sees: a symlink that is also
 * group-writable reports "must not be a symbolic link", because that check is
 * first. A mutation test reorders these to prove the wording is pinned.
 */
/**
 * ⚠️ The parameter type is `Stats`, NOT `ReturnType<typeof lstatSync>`.
 *
 * `lstatSync` is an overloaded interface (`StatSyncFn` in @types/node), and
 * `ReturnType<>` resolves to the LAST overload's return —
 * `Stats | BigIntStats | undefined`. So `ReturnType<typeof lstatSync>` silently admits
 * `undefined` (hence the `'stat' is possibly 'undefined'` errors) and `BigIntStats`
 * (whose `mode` is a `bigint`, hence the `'&' cannot be applied to number | bigint`
 * error). Neither is reachable here: both call sites pass a plain `lstatSync(path)`.
 * Naming `Stats` states that. This was not a reasoning error about the reference, it
 * was a TypeScript overload-resolution trap, found by compiling.
 */
export function assertManagedDirectory(directory: string, stat: Stats): void {
  if (stat.isSymbolicLink()) {
    throw new Error(`managed stream directory must not be a symbolic link: ${directory}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`managed stream path is not a directory: ${directory}`);
  }
  const currentUid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (currentUid !== undefined && stat.uid !== currentUid) {
    throw new Error(`managed stream directory is owned by another account: ${directory}`);
  }
  if (process.platform !== "win32" && (stat.mode & GROUP_OR_OTHER_WRITABLE) !== 0) {
    throw new Error(`managed stream directory is writable by other accounts: ${directory}`);
  }
}

/**
 * `ensureManagedDirectory` — create-then-validate, tolerating EEXIST.
 *
 * The EEXIST tolerance is not defensive noise: two concurrent stream uploads to the
 * same `stream_id` both reach here, and the loser's `mkdirSync` throws EEXIST. It
 * then falls through to the same `lstatSync` validation, so a racing SYMLINK is
 * still caught.
 */
export function ensureManagedDirectory(directory: string): void {
  let stat: Stats;
  try {
    stat = lstatSync(directory);
  } catch (error) {
    if (!isMissing(error)) throw error;
    try {
      mkdirSync(directory, { mode: MANAGED_DIRECTORY_MODE });
    } catch (mkdirError) {
      if (!(mkdirError instanceof Error && "code" in mkdirError && (mkdirError as { code?: unknown }).code === "EEXIST")) {
        throw mkdirError;
      }
    }
    stat = lstatSync(directory);
  }
  assertManagedDirectory(directory, stat);
}

/**
 * `resolveManagedRoot` — resolve without creating; validate if present.
 *
 * The absent branch returns `realpath(parent) + basename(absolute)` and does NOT
 * create it. That is what lets `clearInactive` answer "root missing ⇒ nothing to
 * clean" instead of erroring on a fresh process.
 */
export function resolveManagedRoot(input: string): string {
  const absolute = resolve(input);
  try {
    assertManagedDirectory(absolute, lstatSync(absolute));
    return realpathSync(absolute);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const parent = dirname(absolute);
  if (!statSync(parent).isDirectory()) {
    throw new Error(`managed stream parent is not a directory: ${parent}`);
  }
  return join(realpathSync(parent), basename(absolute));
}

/**
 * The managed directory and its active-item registry.
 *
 * `registerActiveItem` returns a RELEASE function and is idempotent — the reference
 * wraps it in `let released = false`. Idempotence matters because `completeUpload`
 * and `runDownload` call the release in a `finally` as well as on the success path,
 * and a double-release that decremented a counter would under-count active items
 * and let the cleaner delete a file still being written.
 */
export class StreamStorage {
  readonly root: string;
  readonly uploadDir: string;
  readonly downloadDir: string;
  readonly #activeItems = new Map<number, string[]>();
  #nextActiveItemId = 1;

  constructor(root: string) {
    this.root = resolveManagedRoot(root);
    this.uploadDir = join(this.root, "upload");
    this.downloadDir = join(this.root, "download");
  }

  /** Create a directory inside the root, validating every segment as it goes. */
  ensureDirectory(directory: string): void {
    const resolved = resolve(directory);
    if (resolved !== this.root && !isStrictDescendant(this.root, resolved)) {
      throw new Error(`stream directory is outside the managed root: ${directory}`);
    }
    let current = this.root;
    ensureManagedDirectory(current);
    const rel = relative(this.root, resolved);
    if (!rel) return;
    for (const segment of rel.split(sep)) {
      current = join(current, segment);
      ensureManagedDirectory(current);
    }
  }

  /**
   * Claim paths as in-use. Returns the release function.
   *
   * An active path outside the root is a hard error rather than a skip: it means a
   * caller computed a path from something other than a validated id.
   */
  registerActiveItem(paths: readonly string[]): () => void {
    const normalized = paths.map((item) => {
      const resolved = resolve(item);
      if (!isStrictDescendant(this.root, resolved)) {
        throw new Error(`active stream path is outside the managed root: ${item}`);
      }
      return resolved;
    });
    const id = this.#nextActiveItemId;
    this.#nextActiveItemId += 1;
    this.#activeItems.set(id, normalized);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#activeItems.delete(id);
    };
  }

  /**
   * Delete everything under the root that is not active.
   *
   * `skippedActiveItems` counts the REGISTERED ITEMS, not the paths they cover —
   * one upload registers two paths (temp dir + final file) and counts once. The
   * reference computes it as `this.activeItems.size`, and a mutation test flips it
   * to the flat path count to prove the difference is asserted.
   */
  clearInactive(): StreamStorageClearResult {
    const result: StreamStorageClearResult = {
      deletedFiles: 0,
      freedBytes: 0,
      skippedActiveItems: this.#activeItems.size,
      failures: [],
    };
    if (!this.#assertRootDirectoryOrMissing()) return result;
    const activePaths = [...this.#activeItems.values()].flat();
    let entries;
    try {
      entries = readdirSync(this.root, { withFileTypes: true });
    } catch (error) {
      result.failures.push({ item: ".", message: this.#publicErrorMessage(error) });
      return result;
    }
    for (const entry of entries) this.#clearNode(join(this.root, entry.name), activePaths, result);
    return result;
  }

  #assertRootDirectoryOrMissing(): boolean {
    try {
      assertManagedDirectory(this.root, lstatSync(this.root));
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  /**
   * Recurse into one entry.
   *
   * Two early exits, both load-bearing:
   *   * an ACTIVE path (or a descendant of one) is left alone — that is the only
   *     thing standing between the cleaner and a file being streamed right now;
   *   * a `lstat` that misses with ENOENT is silently skipped (the file vanished
   *     under us, which is the desired end state) while any OTHER error becomes a
   *     failure entry.
   *
   * After clearing a directory the reference re-lists it and `rmdir`s only if it is
   * empty. A `readdir` length of 0 is the check, not a count of what we deleted,
   * because a concurrent writer may have added something.
   */
  #clearNode(item: string, activePaths: readonly string[], result: StreamStorageClearResult): void {
    const resolved = resolve(item);
    if (activePaths.some((active) => isSameOrDescendant(active, resolved))) return;
    let stat: Stats;
    try {
      stat = lstatSync(resolved);
    } catch (error) {
      if (!isMissing(error)) {
        result.failures.push({ item: this.#displayPath(resolved), message: this.#publicErrorMessage(error) });
      }
      return;
    }
    if (!stat.isDirectory()) {
      try {
        unlinkSync(resolved);
        result.deletedFiles += 1;
        result.freedBytes += stat.size;
      } catch (error) {
        if (!isMissing(error)) {
          result.failures.push({ item: this.#displayPath(resolved), message: this.#publicErrorMessage(error) });
        }
      }
      return;
    }
    let entries;
    try {
      entries = readdirSync(resolved, { withFileTypes: true });
    } catch (error) {
      result.failures.push({ item: this.#displayPath(resolved), message: this.#publicErrorMessage(error) });
      return;
    }
    for (const entry of entries) this.#clearNode(join(resolved, entry.name), activePaths, result);
    try {
      if (readdirSync(resolved).length === 0) rmdirSync(resolved);
    } catch (error) {
      if (!isMissing(error)) {
        result.failures.push({ item: this.#displayPath(resolved), message: this.#publicErrorMessage(error) });
      }
    }
  }

  #displayPath(item: string): string {
    return relative(this.root, item) || ".";
  }

  /**
   * Redact the absolute root out of a message.
   *
   * The failure strings travel to an OneBot client, and the root is a local
   * filesystem path the client has no business knowing. The reference replaces every
   * occurrence with `[临时目录]` — not just the prefix — because `fs` error messages
   * quote the path in the middle of a sentence.
   */
  #publicErrorMessage(error: unknown): string {
    return errorMessage(error).split(this.root).join("[临时目录]");
  }
}

/** `STREAM_DIRECTORY_PARENT_FALLBACK` — `os.tmpdir()/onebot-stream`. */
export function defaultStreamRoot(): string {
  return join(tmpdir(), "onebot-stream");
}

/**
 * `createStreamStorage` — `SNOWLUMA_STREAM_DIR` override, warn-and-fall-back.
 *
 * Returning a working storage on a bad override (rather than throwing) is the
 * reference's choice: an unparseable or unsafe env var is an operator typo, and the
 * fallback is a safe, private directory. A throw here would make startup depend on
 * an optional env var.
 *
 * `env` is a parameter rather than `process.env` so a test can drive it without
 * mutating global state.
 */
export function createStreamStorage(env: NodeJS.ProcessEnv = process.env): StreamStorage {
  const raw = readEnvAlias("STREAM_DIR", env)?.trim();
  if (!raw) return new StreamStorage(defaultStreamRoot());
  try {
    return new StreamStorage(raw);
  } catch {
    return new StreamStorage(defaultStreamRoot());
  }
}

/**
 * The process-wide storage, created at import.
 *
 * A singleton for the same reason the reference has one: `activeItems` is the
 * registry the cleaner consults, and two instances would each think a file the other
 * is writing is safe to delete.
 */
export const streamStorage = createStreamStorage();
export const STREAM_ROOT = streamStorage.root;
export const STREAM_UPLOAD_DIR = streamStorage.uploadDir;

/** `registerActiveStreamItem` — reference:17560. */
export function registerActiveStreamItem(paths: readonly string[]): () => void {
  return streamStorage.registerActiveItem(paths);
}

/** `ensureStreamDirectory` — reference:17563. */
export function ensureStreamDirectory(directory: string): void {
  streamStorage.ensureDirectory(directory);
}

/** `clearInactiveStreamStorage` — reference:17569. */
export function clearInactiveStreamStorage(): StreamStorageClearResult {
  return streamStorage.clearInactive();
}