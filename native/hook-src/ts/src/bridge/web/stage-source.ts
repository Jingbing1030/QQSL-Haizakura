// Staging an arbitrary message/file source onto disk, plus the streaming hash the
// file-transfer upload needs.
//
// Reference region: `../protocol/src/media/source.ts` (reference/index.mjs:37080-37270):
//
//   STAGE_DIR / STAGE_TTL_MS / REAPER_INTERVAL_MS   :37080-37082
//   `active` + `ensureReaper` + `sweepStagedUploads` :37084-37117
//   `tempPaths` / `fsyncDir` / `finalizeRename`      :37118-37141
//   `registerStaged`                                 :37142-37159
//   `fileSink`                                       :37160-37180
//   `base64DecodedLength`                            :37181-37191
//   `stageSourceToDisk`                              :37192
//   `assertUnchanged`                                :289648
//   `MD5_HEAD_LIMIT`                                 :289644
//   `FILE_UPLOAD_MAX_BYTES`                          :18315
//
// and `hashFileStreaming` at `:37383`.
//
// ---------------------------------------------------------------------------
// Why staging exists at all, when `binary-source.ts` already loads bytes
// ---------------------------------------------------------------------------
// `loadBinarySource` returns a `Uint8Array`. For a group file the reference caps
// the size at **4 GiB** (`FILE_UPLOAD_MAX_BYTES`, :18315) — buffering that is not
// an option, and the highway PUT loop reads one 1 MiB chunk at a time from a file
// handle anyway (`upload.ts`'s `FileChunkSource`). So the upload path needs a
// PATH, not bytes, and every source form has to end up on disk:
//
//   local file   hardlink (zero-copy) into the staging dir, copy as fallback
//   http(s)      streamed to disk through a file sink, never fully buffered
//   base64/data  decoded, written, fsynced, renamed into place
//
// The hardlink is the part worth keeping: a 1.5 GiB local file staged by copy
// doubles peak disk usage and takes seconds, and the staged path is only ever
// read. `cleanup()` unlinks the LINK, not the original — the original's inode
// survives as long as the source file still exists.
//
// ---------------------------------------------------------------------------
// Why the `.part` + rename dance, instead of writing the final name
// ---------------------------------------------------------------------------
// `finalizeRename` writes to `<name>.part`, fsyncs the FILE, renames, then fsyncs
// the DIRECTORY. That is the standard POSIX crash-atomicity sequence, and here it
// protects a specific thing: the reaper below decides "stale" from mtime. A
// half-written file that a crashed process left behind is garbage worth deleting;
// a file whose rename was never fsynced might still be being written by a process
// that is merely slow. With the two-phase name, a `.part` never becomes visible
// under its final name until it is complete.
//
// ---------------------------------------------------------------------------
// The reaper, and why it needs the `active` set
// ---------------------------------------------------------------------------
// Every 5 minutes, files in the staging dir older than 30 minutes are removed —
// UNLESS their path is in `active`. The set is not belt-and-braces: an in-flight
// upload's file is opened read-only, so its mtime never advances, and an
// age-only sweep would delete a staged file out from under a multi-gigabyte
// upload that has been running for 31 minutes. The reference's own comment says
// exactly this (:37083-37086).
//
// The timer is `unref()`ed so a process whose only remaining work is "someday
// reap temp files" can exit.

import { createHash, randomUUID } from "node:crypto";
import { promises as fsPromises } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  DOWNLOAD_USER_AGENT,
  guessFileNameFromUrl,
  httpDownloadTimeoutMs,
  inlineBase64Payload,
  resolveLocalFilePath,
  tooLarge,
} from "./binary-source.js";

/** `STAGE_DIR` — reference/index.mjs:37080. Same directory the album path uses. */
export const STAGE_DIR = path.join(os.tmpdir(), "media-stage");

/*// `STAGE_TTL_MS` — a staged file older than this is swept. 30 minutes (reference:37081). */
export const STAGE_TTL_MS = 1800 * 1000;

/** `REAPER_INTERVAL_MS` — how often the sweep runs. 5 minutes. */
export const REAPER_INTERVAL_MS = 300 * 1000;

/** `FILE_UPLOAD_MAX_BYTES` — reference/index.mjs:18315. 4 GiB. */
export const FILE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024 * 1024;

/**
 * `MD5_HEAD_LIMIT` — reference/index.mjs:289644: `10002432`.
 *
 * Not 10 MiB (`10485760`) and not `10000000`. The value is `9_768_000 + 234_432`,
 * i.e. whatever QQ's client uses, and the private-file upload request sends its
 * head md5 as `md510MCheckSum`; a file between 9.3 and 10 MiB hashes a different
 * number of bytes depending on which "10 MiB" is used. Reproduced verbatim.
 */
export const MD5_HEAD_LIMIT = 10002432;

/** Paths currently staged/being-written. The reaper skips these. */
const active = new Set<string>();
let reaperTimer: NodeJS.Timeout | null = null;

function ensureReaper(): void {
  if (reaperTimer) return;
  reaperTimer = setInterval(() => {
    void sweepStagedUploads().catch(() => undefined);
  }, REAPER_INTERVAL_MS);
  // A process that is otherwise done must not be held open by the sweeper.
  reaperTimer.unref?.();
}

/**
 * `sweepStagedUploads` — reference/index.mjs:37098.
 *
 * Returns how many files were removed, which the reference only logs; exposed
 * because a test asserting "the reaper skips a live upload" needs to see that it
 * removed ZERO.
 */
export async function sweepStagedUploads(now = Date.now()): Promise<number> {
  let names: string[];
  try {
    names = await fsPromises.readdir(STAGE_DIR);
  } catch {
    return 0;
  }
  let removed = 0;
  await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(STAGE_DIR, name);
      if (active.has(filePath)) return;
      try {
        if (now - (await fsPromises.stat(filePath)).mtimeMs > STAGE_TTL_MS) {
          await fsPromises.rm(filePath, { force: true });
          removed += 1;
        }
      } catch {
        // Vanished between readdir and stat: someone else reaped it.
      }
    }),
  );
  return removed;
}

/** `<partPath, finalPath>` for one new staged file. */
function tempPaths(extension: string): { partPath: string; finalPath: string } {
  const base = path.join(STAGE_DIR, `stage-${randomUUID()}${extension}`);
  return { partPath: `${base}.part`, finalPath: base };
}

/**
 * fsync the staging DIRECTORY so the rename itself survives a crash.
 *
 * The file's own durability is not enough: without the directory entry being
 * flushed, a power loss can leave a complete file that no name points at.
 * Swallowing the failure matches the reference (:37130) — some filesystems
 * reject `fsync` on a directory handle, and the rename is already done.
 */
async function fsyncDir(): Promise<void> {
  try {
    const handle = await fsPromises.open(STAGE_DIR, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Best-effort, as in the reference.
  }
}

async function finalizeRename(partPath: string, finalPath: string): Promise<void> {
  await fsPromises.rename(partPath, finalPath);
  await fsyncDir();
}

/** A staged file plus the `cleanup()` the caller MUST run. */
export interface StagedSource {
  filePath: string;
  fileSize: number;
  /** `""` for an inline base64 source, the URL's last segment for http, the basename for local. */
  fileName: string;
  /** Idempotent. Also called on the failure paths by `stageSourceToDisk`'s callers. */
  cleanup(): Promise<void>;
}

function registerStaged(filePath: string, fileSize: number, fileName: string): StagedSource {
  active.add(filePath);
  let done = false;
  return {
    filePath,
    fileSize,
    fileName,
    async cleanup() {
      if (done) return;
      done = true;
      active.delete(filePath);
      await fsPromises.unlink(filePath).catch(() => undefined);
    },
  };
}

/**
 * `base64DecodedLength` — reference/index.mjs:37181.
 *
 * The cheap pre-check that keeps an oversized inline source from being decoded:
 * the caller may pass a 4 GiB base64 string, and `Buffer.from(…, "base64")` on it
 * allocates 3 GiB before anyone can object.
 */
export function base64DecodedLength(b64: string): number {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

/** The sink `downloadHttp` streams into. Mirrors reference/index.mjs:37160. */
interface DiskSink {
  write(chunk: Uint8Array): Promise<void>;
  done(): Promise<void>;
  discard(): Promise<void>;
}

function fileSink(partPath: string): DiskSink {
  let opened: Promise<import("node:fs/promises").FileHandle> | null = null;
  const open = () => (opened ??= fsPromises.open(partPath, "w"));
  return {
    async write(chunk) {
      // Awaiting each write is what provides backpressure: without it a 4 GiB
      // download outruns the disk and buffers in memory anyway.
      await (await open()).write(chunk);
    },
    async done() {
      const handle = await open();
      await handle.sync();
      await handle.close();
    },
    async discard() {
      if (opened) {
        try {
          await (await opened).close();
        } catch {
          // Already closed by an error path.
        }
      }
      await fsPromises.unlink(partPath).catch(() => undefined);
    },
  };
}

/**
 * Stream `url` to `sink`, with the reference's one Referer retry.
 *
 * The retry is not for a server that dislikes `fetch`: some QQ CDNs reject a bare
 * request and answer the same request with a `Referer`. A `noRetry` error — which
 * is what every size-limit failure is tagged with — skips it, because retrying a
 * download that was rejected for being too big just transfers it twice to reach
 * the same conclusion.
 *
 * reference/index.mjs:18037 (`downloadHttp` with the `makeSink` parameter, the
 * streaming half of the pair; `binary-source.ts` ports the in-memory half).
 */
async function downloadHttpToSink(
  source: string,
  resourceName: string,
  maxBytes: number,
  makeSink: () => DiskSink,
): Promise<{ fileName: string }> {
  const fileName = guessFileNameFromUrl(source);
  const attempt = async (headers: Record<string, string>): Promise<void> => {
    const response = await fetch(source, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(httpDownloadTimeoutMs()),
    });
    if (!response.ok) throw new Error(`HTTP download failed: ${String(response.status)}`);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw tooLarge(`${resourceName} too large: ${String(declared)} > ${String(maxBytes)}`);
    }
    const sink = makeSink();
    try {
      const reader = response.body?.getReader();
      if (!reader) {
        const buffer = new Uint8Array(await response.arrayBuffer());
        if (buffer.length > maxBytes) {
          throw tooLarge(`${resourceName} too large: ${String(buffer.length)} > ${String(maxBytes)}`);
        }
        await sink.write(buffer);
      } else {
        let total = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            total += value.byteLength;
            if (total > maxBytes) {
              await reader.cancel().catch(() => undefined);
              throw tooLarge(`${resourceName} too large: > ${String(maxBytes)}`);
            }
            await sink.write(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      await sink.done();
    } catch (error) {
      await sink.discard();
      throw error;
    }
  };
  const baseHeaders = { "User-Agent": DOWNLOAD_USER_AGENT, Accept: "*/*" };
  try {
    await attempt(baseHeaders);
  } catch (error) {
    if ((error as { noRetry?: boolean }).noRetry === true) throw error;
    try {
      await attempt({ ...baseHeaders, Referer: source });
    } catch {
      // The reference rethrows the ORIGINAL error (:18099), not the retry's: the
      // first failure is the informative one.
      throw error;
    }
  }
  return { fileName };
}

/**
 * `stageSourceToDisk` — reference/index.mjs:37192.
 *
 * The three source forms are tried in a fixed order (inline, http, local) and the
 * order is observable: a string that is both a URL-shaped thing and a path is
 * treated as a URL. Same order as `binary-source.ts`'s in-memory loader, so the
 * two halves of the reference's source handling agree about what a source IS.
 *
 * Every size rejection happens BEFORE the expensive step: a base64 length is
 * computed arithmetically, a local file is `stat`ed, an http body is checked
 * incrementally.
 *
 * The caller MUST call `cleanup()` — including on the paths that throw after
 * staging — or the file lives until the reaper collects it 30 minutes later.
 */
export async function stageSourceToDisk(
  source: string,
  maxBytes: number = FILE_UPLOAD_MAX_BYTES,
): Promise<StagedSource> {
  if (!source) throw new Error("stage source is empty");
  ensureReaper();
  await fsPromises.mkdir(STAGE_DIR, { recursive: true });

  const b64 = inlineBase64Payload(source);
  if (b64 !== null) {
    const decodedLength = base64DecodedLength(b64);
    if (decodedLength > maxBytes) {
      throw new Error(`stage source too large: ${String(decodedLength)} > ${String(maxBytes)}`);
    }
    const bytes = Buffer.from(b64, "base64");
    if (bytes.length > maxBytes) {
      throw new Error(`stage source too large: ${String(bytes.length)} > ${String(maxBytes)}`);
    }
    const { partPath, finalPath } = tempPaths(".bin");
    active.add(partPath);
    try {
      const handle = await fsPromises.open(partPath, "w");
      try {
        await handle.write(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await finalizeRename(partPath, finalPath);
    } catch (error) {
      await fsPromises.unlink(partPath).catch(() => undefined);
      throw error;
    } finally {
      active.delete(partPath);
    }
    // `fileName: ""` is load-bearing: the caller's `normalizeUploadFileName`
    // falls back to it, so an inline source with no explicit name is rejected
    // rather than uploaded as ".bin".
    return registerStaged(finalPath, bytes.length, "");
  }

  if (/^https?:\/\//i.test(source)) {
    const { partPath, finalPath } = tempPaths(".bin");
    active.add(partPath);
    let fileName = "";
    try {
      fileName = (await downloadHttpToSink(source, "stage", maxBytes, () => fileSink(partPath))).fileName;
      await finalizeRename(partPath, finalPath);
    } catch (error) {
      await fsPromises.unlink(partPath).catch(() => undefined);
      throw error;
    } finally {
      active.delete(partPath);
    }
    const { size } = await fsPromises.stat(finalPath);
    return registerStaged(finalPath, size, fileName);
  }

  const local = resolveLocalFilePath(source);
  if (!local) throw new Error("stage source is not a local file");
  const real = await fsPromises.realpath(local);
  const stat = await fsPromises.stat(real);
  if (!stat.isFile()) throw new Error(`stage source is not a regular file: ${local}`);
  if (stat.size > maxBytes) {
    throw new Error(`stage source too large: ${String(stat.size)} > ${String(maxBytes)}`);
  }
  // The DISPLAY name is the caller's basename; the staged path uses realpath's
  // extension. A symlinked upload keeps the name the user wrote.
  const fileName = path.basename(local);
  const { partPath, finalPath } = tempPaths(path.extname(local) || ".bin");
  active.add(finalPath);
  try {
    try {
      // Zero-copy for the common case. Cross-device links fail with EXDEV, which
      // is exactly when a copy is required.
      await fsPromises.link(real, finalPath);
    } catch {
      active.add(partPath);
      try {
        await fsPromises.copyFile(real, partPath);
        const handle = await fsPromises.open(partPath, "r+");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        await finalizeRename(partPath, finalPath);
      } finally {
        active.delete(partPath);
      }
    }
  } catch (error) {
    active.delete(finalPath);
    await fsPromises.unlink(finalPath).catch(() => undefined);
    await fsPromises.unlink(partPath).catch(() => undefined);
    throw error;
  }
  return registerStaged(finalPath, stat.size, fileName);
}

// ===========================================================================
// The streaming hash
// ===========================================================================

/**
 * `SHA1_STREAM_BLOCK_SIZE` — 1 MiB, the same block size highway chunks at.
 *
 * One constant governs both: the per-block sha1 list is only meaningful if the
 * blocks are the chunks. Importing it from `highway/upload.ts` would make the web
 * layer depend on the transport layer, so the value is stated here and asserted
 * equal in `test/highway-file-ext.test.ts`'s neighbours.
 */
export const SHA1_STREAM_BLOCK_SIZE = 1024 * 1024;

/** `hashFileStreaming`'s result. */
export interface StreamingFileHashes {
  /** 16 raw bytes. The file-transfer ext wants these, not `md5Hex`. */
  md5: Uint8Array;
  /** 20 raw bytes. */
  sha1: Uint8Array;
  md5Hex: string;
  sha1Hex: string;
  /** md5 of the first `headLimit` bytes — only present when `headLimit` was passed. */
  headMd5?: Uint8Array;
}

/**
 * `hashFileStreaming` — reference/index.mjs:37383.
 *
 * md5 + sha1 in ONE pass over the file, reading through `FileChunkSource` so a
 * 4 GiB file costs one megabyte of memory.
 *
 * The reference also emits `sha1Blocks` (a per-MiB intermediate state list for the
 * NTV2 resumable path). The file-transfer ext does NOT read it — it sends the
 * whole-file md5/sha1 and lets the server verify per chunk against the md5 in each
 * segment head (`upload.ts`'s `msgSegHead.md5`) — so it is not reproduced.
 *
 * `headMd5` is the private-file path's `md510MCheckSum`, and it is the field a
 * naive port is most likely to get wrong: it is the md5 of the first
 * `MD5_HEAD_LIMIT` bytes **only when a headLimit is passed**. Passing none leaves
 * the field absent (`undefined`), which is what the group path sends.
 */
export async function hashFileStreaming(
  filePath: string,
  options: { headLimit?: number } = {},
): Promise<StreamingFileHashes> {
  const { FileChunkSource } = await import("../../highway/upload.js");
  const { size } = await fsPromises.stat(filePath);
  const source = await FileChunkSource.open(filePath);
  try {
    const md5 = createHash("md5");
    const sha1 = createHash("sha1");
    const headLimit = options.headLimit;
    const headMd5 = headLimit !== undefined ? createHash("md5") : null;
    let headRemaining = headLimit ?? 0;
    for (let offset = 0; offset < size; offset += SHA1_STREAM_BLOCK_SIZE) {
      const length = Math.min(SHA1_STREAM_BLOCK_SIZE, size - offset);
      const chunk = await source.read(offset, length);
      md5.update(chunk);
      sha1.update(chunk);
      if (headMd5 && headRemaining > 0) {
        const take = Math.min(headRemaining, chunk.byteLength);
        headMd5.update(chunk.subarray(0, take));
        headRemaining -= take;
      }
    }
    const md5Digest = md5.digest();
    const sha1Digest = sha1.digest();
    return {
      md5: new Uint8Array(md5Digest),
      sha1: new Uint8Array(sha1Digest),
      md5Hex: md5Digest.toString("hex"),
      sha1Hex: sha1Digest.toString("hex"),
      ...(headMd5 ? { headMd5: new Uint8Array(headMd5.digest()) } : {}),
    };
  } finally {
    await source.close();
  }
}

/**
 * `assertUnchanged` — reference/index.mjs:289648.
 *
 * A cheap guard against a local source that mutated between the hash pass and the
 * transfer: the server's per-chunk md5 is the real backstop, but by then a
 * partially-uploaded wrong file is already on the group's file list.
 *
 * Compares size AND mtimeMs, so a same-size rewrite is caught while a read atime
 * change is not (`atime` is not compared, deliberately — `relatime` mounts touch
 * it on every open and the check would fire on a re-upload of an untouched file).
 */
export async function assertUnchanged(
  filePath: string,
  baseline: { size: number; mtimeMs: number },
): Promise<void> {
  const now = await fsPromises.stat(filePath);
  if (now.size !== baseline.size || now.mtimeMs !== baseline.mtimeMs) {
    throw new Error("file source changed during send (mutated between hashing and upload)");
  }
}
