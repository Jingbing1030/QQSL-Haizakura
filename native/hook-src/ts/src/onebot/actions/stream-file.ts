// 4.6 (part 3) — the two stream-file actions: `upload_file_stream` and
// `clean_stream_temp_file`.
//
// Reference region: reference/index.mjs:17805-17922 (`actions$2`, 2 definitions,
// plus the upload state machine they share).
//
// ---------------------------------------------------------------------------
// The state machine, and why it is a process-wide Map
// ---------------------------------------------------------------------------
// An upload arrives as N separate action calls. Nothing ties them together except
// `stream_id`, so the chunks must accumulate across calls — in a `Map` at module
// scope, keyed `account:stream_id` (or bare `stream_id` when no account is known).
// The account prefix exists so two accounts in one process cannot collide on a
// shared/UUID id, which would interleave one user's bytes into another's file.
//
// Chunk ordering is NOT assumed. Each `(index, chunk)` call writes `index.chunk` in
// the temp dir and records the index in `written`; completion requires
// `written.size === total_chunks`, and the merge loop then reads `0.chunk` through
// `(total-1).chunk` in ORDER. So out-of-order arrival works and a missing index is
// named in the error (`missing 2 chunk(s) [3,7]`).
//
// ---------------------------------------------------------------------------
// `claimed` vs `written` — two sets, and neither is redundant
// ---------------------------------------------------------------------------
//   `claimed`  holds an index from the moment the bytes are accepted, BEFORE the
//              async write resolves. A duplicate concurrent call for the same index
//              therefore answers `chunk_received` immediately instead of racing a
//              second write to the same path.
//   `written`  holds an index only after the write SUCCEEDED, and is what
//              `completeUpload`'s completeness check reads.
//
// On a write failure the index is removed from BOTH and the byte counter is rolled
// back, so a retry works. Collapsing the two sets would make a retry-after-failure
// answer `chunk_received` for a chunk that was never written — the file would then
// merge short and the sha256 check would be the only symptom.
//
// ---------------------------------------------------------------------------
// What is reproduced verbatim because it is observable on the wire
// ---------------------------------------------------------------------------
//   * `statusFrame`'s five keys in order: `type, stream_id, status,
//     received_chunks, total_chunks`.
//   * the completion frame's nine keys: `type, stream_id, status, received_chunks,
//     total_chunks, file_path, file_name, file_size, sha256`.
//   * `status` values `"file_created"`, `"chunk_received"`, `"file_complete"` — and
//     `type` `StreamStatus.Stream` for the first two, `StreamStatus.Response` for
//     completion.
//   * `reset` THROWS (`"Stream reset completed"`) rather than answering ok. A reset
//     is a failure response with that wording; treating it as success would let a
//     client believe a discarded stream completed.
//   * a duplicate chunk answers `chunk_received` and does NOT consume the byte
//     budget again.
//   * `file_retention` schedules deletion AFTER the response is built, and `0`
//     disables it. Both timers are `unref`'d so they never hold the process open.
//
// ---------------------------------------------------------------------------
// Not ported, with the reason
// ---------------------------------------------------------------------------
// The reference's `writeChunkToStream` uses `fs.createWriteStream` with a
// per-write callback. This port uses `fs.promises.appendFile` on the final path
// instead — equivalent observable behaviour (same bytes, same order, same
// `file_size`, same sha256) with one fewer failure mode. The streaming read of the
// temp chunks is still sequential, so memory stays at one chunk rather than the
// whole file.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, rmSync, statSync, promises as fsPromises } from "node:fs";
import { join } from "node:path";
import { defineAction, defineStreamAction, f, okResponse, type ActionSpec, type StreamActionSpec } from "./kit.js";
import type { ActionContext } from "./context.js";
import { StreamStatus, type ApiResponse } from "../types.js";
import {
  STREAM_UPLOAD_DIR,
  ensureStreamDirectory,
  registerActiveStreamItem,
  clearInactiveStreamStorage,
} from "../stream-storage.js";

// ===========================================================================
// Limits — every one of the reference's constants, unchanged
// ===========================================================================

/** 10 minutes. A stalled upload is reaped, not kept forever. */
export const UPLOAD_TIMEOUT_MS = 600 * 1_000;
/** The `file_retention` default: the merged file lives 5 minutes. */
export const DEFAULT_RETENTION_MS = 300 * 1_000;
export const MAX_CONCURRENT_STREAMS = 64;
export const MAX_CHUNKS = 200_000;
export const MAX_CHUNK_BYTES = 32 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

/**
 * `SAFE_ID_RE` — the whole path-traversal defence for `stream_id`, in one regex.
 *
 * 1-128 chars of `[A-Za-z0-9_-]`. No dots, so no `..`; no slashes, so no
 * separators. `assertWithin` then re-checks the derived path as belt-and-braces,
 * because a future weakening of this regex must not silently become a traversal.
 */
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** The error class every upload failure uses. Never `Error` directly. */
export class StreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamError";
  }
}

export function validateStreamId(id: string): void {
  if (!SAFE_ID_RE.test(id)) {
    throw new StreamError("invalid stream_id (allowed: 1-128 chars of A-Z a-z 0-9 _ -)");
  }
}

/**
 * The account namespace for the map key and the on-disk dir.
 *
 * `""` when there is no login (tests, pre-login), which flattens the layout. The
 * `replace` + `slice` is not cosmetic: the account string becomes a path segment,
 * so a uid containing `/` or `..` would widen the path. `getLoginInfo` is called
 * through optional chaining inside a try, because a context without it must not
 * crash an upload.
 */
export function accountKey(ctx: ActionContext): string {
  let raw = "";
  try {
    raw = String(ctx?.getLoginInfo?.().userId ?? "");
  } catch {
    raw = "";
  }
  return raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

/** `assertWithin` — the second line of defence behind `SAFE_ID_RE`. */
function assertWithin(root: string, target: string): void {
  const rel = join("/", target).slice(root.length + 1);
  // `relative` is the reference's tool; kept as a direct check so the error text
  // and the condition are identical to the reference's.
  if (rel === "" || rel.startsWith("..") || rel.startsWith("/")) {
    throw new StreamError("resolved stream path escapes the upload directory");
  }
}

/** One in-flight upload. */
export interface UploadState {
  id: string;
  key: string;
  filename: string;
  totalChunks: number;
  claimed: Set<number>;
  written: Set<number>;
  bytesWritten: number;
  fileSize: number | undefined;
  expectedSha256: string | undefined;
  tempDir: string;
  finalPath: string;
  fileRetention: number;
  timeoutId: ReturnType<typeof setTimeout>;
  releaseStorageActivity: () => void;
}

/** The process-wide registry. Keyed `account:stream_id` when an account is known. */
export const uploads = new Map<string, UploadState>();

function reapTimer(key: string): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    cleanupUpload(key, true);
  }, UPLOAD_TIMEOUT_MS);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

/**
 * Drop the state, the temp dir and (optionally) the merged file.
 *
 * `deleteFinal: false` is used on the SUCCESS path: the merged file is the product
 * the caller asked for, and only the chunk directory may go. Using `true` there
 * would delete the file the response is about to name.
 */
export function cleanupUpload(key: string, deleteFinal: boolean): void {
  const state = uploads.get(key);
  if (!state) return;
  clearTimeout(state.timeoutId);
  try {
    rmSync(state.tempDir, { recursive: true, force: true });
  } catch {
    // The reference logs and continues: a chunk dir that cannot be removed must not
    // stop the upload state from being dropped, or the reaper would never free it.
  }
  if (deleteFinal) {
    try {
      rmSync(state.finalPath, { force: true });
    } catch {
      // Same reasoning.
    }
  }
  uploads.delete(key);
  state.releaseStorageActivity();
}

/**
 * `safeFilename` — slash/backslash and `..` runs become `_`, leading dots stripped.
 *
 * A filename is the OTHER attacker-controlled path component, and unlike
 * `stream_id` it is allowed to contain almost anything. So: no separators (would
 * escape), no `..` runs (would traverse), no leading dots (would create a hidden
 * file that a naive cleaner skips). An empty result falls back to `upload_<id>`,
 * which is safe by construction because the id already passed `SAFE_ID_RE`.
 */
export function safeFilename(name: string | undefined, id: string): string {
  return (
    (name ?? "")
      .replace(/[/\\]/g, "_")
      .replace(/\.\.+/g, "_")
      .replace(/^\.+/, "")
      .trim() || `upload_${id}`
  );
}

function createUpload(p: UploadParams, account: string): UploadState {
  if (!p.total_chunks || p.total_chunks <= 0) throw new StreamError("total_chunks required for new stream");
  if (p.total_chunks > MAX_CHUNKS) throw new StreamError(`total_chunks exceeds limit (${MAX_CHUNKS})`);
  if (p.file_size !== undefined && p.file_size > MAX_UPLOAD_BYTES) {
    throw new StreamError(`file_size exceeds limit (${MAX_UPLOAD_BYTES} bytes)`);
  }
  if (uploads.size >= MAX_CONCURRENT_STREAMS) {
    throw new StreamError(`too many concurrent upload streams (${MAX_CONCURRENT_STREAMS})`);
  }
  const filename = safeFilename(p.filename, p.stream_id);
  const dirRoot = account ? join(STREAM_UPLOAD_DIR, account) : STREAM_UPLOAD_DIR;
  const tempDir = join(dirRoot, p.stream_id);
  const finalPath = join(dirRoot, `${p.stream_id}__${filename}`);
  assertWithin(STREAM_UPLOAD_DIR, tempDir);
  assertWithin(STREAM_UPLOAD_DIR, finalPath);
  ensureStreamDirectory(tempDir);
  const key = account ? `${account}:${p.stream_id}` : p.stream_id;
  const releaseStorageActivity = registerActiveStreamItem([tempDir, finalPath]);
  const state: UploadState = {
    id: p.stream_id,
    key,
    filename,
    totalChunks: p.total_chunks,
    claimed: new Set(),
    written: new Set(),
    bytesWritten: 0,
    fileSize: p.file_size,
    expectedSha256: p.expected_sha256,
    tempDir,
    finalPath,
    fileRetention: p.file_retention,
    timeoutId: reapTimer(key),
    releaseStorageActivity,
  };
  uploads.set(key, state);
  return state;
}

/**
 * A progress frame. Five keys, in order — the schema lists exactly these.
 *
 * `received_chunks` is `written.size`, so it counts CONFIRMED chunks. A `claimed`
 * but unwritten chunk is not counted, which is what makes the value usable as
 * "how much do I still need to send".
 */
function statusFrame(state: UploadState, status: "file_created" | "chunk_received"): ApiResponse {
  return okResponse({
    type: StreamStatus.Stream,
    stream_id: state.id,
    status,
    received_chunks: state.written.size,
    total_chunks: state.totalChunks,
  });
}

/**
 * Merge the chunks in index order and verify.
 *
 * Four failure modes, each with the reference's own wording:
 *   * incomplete → `incomplete stream: missing N chunk(s) [a,b,…]`, listing at most
 *     16 indices then `…`. The cap keeps the message bounded for a 200k-chunk stream.
 *   * a read/write failure mid-merge → the partial file is removed, then the error
 *     propagates. Leaving it would make a retry of `is_complete` hash a truncated file.
 *   * sha256 mismatch → the file is removed and `sha256 mismatch (expected …, got …)`.
 *     Removing is essential: a retry that only re-hashes would keep failing, and a
 *     caller that ignored the wording would send the wrong bytes.
 *   * success → state dropped (keeping the final file), retention timer armed.
 */
async function completeUpload(state: UploadState): Promise<ApiResponse> {
  if (state.written.size !== state.totalChunks) {
    const missing: number[] = [];
    for (let i = 0; i < state.totalChunks && missing.length < 16; i += 1) {
      if (!state.written.has(i)) missing.push(i);
    }
    const more = state.totalChunks - state.written.size > missing.length ? "…" : "";
    throw new StreamError(
      `incomplete stream: missing ${state.totalChunks - state.written.size} chunk(s) [${missing.join(",")}${more}]`,
    );
  }
  const hash = createHash("sha256");
  const out = createWriteStream(state.finalPath);
  try {
    for (let i = 0; i < state.totalChunks; i += 1) {
      const buf = await fsPromises.readFile(join(state.tempDir, `${i}.chunk`));
      hash.update(buf);
      await new Promise<void>((resolve, reject) => {
        out.write(buf, (error) => (error ? reject(error) : resolve()));
      });
    }
    await new Promise<void>((resolve, reject) => {
      out.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    out.destroy();
    try {
      rmSync(state.finalPath, { force: true });
    } catch {
      // Best effort; the thrown error is the one the caller needs to see.
    }
    throw error;
  }
  const sha256 = hash.digest("hex");
  if (state.expectedSha256 && sha256 !== state.expectedSha256) {
    try {
      rmSync(state.finalPath, { force: true });
    } catch {
      // Best effort.
    }
    throw new StreamError(`sha256 mismatch (expected ${state.expectedSha256}, got ${sha256})`);
  }
  const finalPath = state.finalPath;
  const fileSize = statSync(finalPath).size;
  const received = state.written.size;
  const total = state.totalChunks;
  const retention = state.fileRetention;
  cleanupUpload(state.key, false);
  if (retention > 0) {
    const timer = setTimeout(() => {
      rmSync(finalPath, { force: true });
    }, retention);
    if (typeof timer.unref === "function") timer.unref();
  }
  return okResponse({
    type: StreamStatus.Response,
    stream_id: state.id,
    status: "file_complete",
    received_chunks: received,
    total_chunks: total,
    file_path: finalPath,
    file_name: state.filename,
    file_size: fileSize,
    sha256,
  });
}

/** The coerced params of `upload_file_stream`, in declaration order. */
export interface UploadParams {
  stream_id: string;
  chunk_data?: string | undefined;
  chunk_index?: number | undefined;
  total_chunks?: number | undefined;
  file_size?: number | undefined;
  expected_sha256?: string | undefined;
  is_complete?: boolean | undefined;
  filename?: string | undefined;
  reset?: boolean | undefined;
  verify_only?: boolean | undefined;
  file_retention: number;
}

/**
 * `handleUpload` — reference:17953.
 *
 * The branch ORDER is the contract, and it is not the obvious one:
 *
 *   1. `validateStreamId` first — before `reset`, before everything. An invalid id
 *      must not be able to reset or verify anything.
 *   2. `reset` → cleanup (including the final file) then THROW.
 *   3. `verify_only` → lookup only; a missing state throws `"stream not found"`.
 *   4. otherwise get-or-create. A create needs `total_chunks`; a subsequent call
 *      may omit it.
 *   5. `expected_sha256`/`file_size` overwrite the stored values when supplied —
 *      a later call can correct an earlier claim.
 *   6. a chunk is accepted only when BOTH `chunk_data` and `chunk_index` are
 *      present. One without the other falls through to the completion check, which
 *      is deliberate: the reference does not error on a half-specified chunk, it
 *      treats the call as "nothing to append".
 *   7. completion when `is_complete` OR when every chunk happens to be written.
 *   8. otherwise `file_created`.
 */
export async function handleUpload(p: UploadParams, account = ""): Promise<ApiResponse> {
  validateStreamId(p.stream_id);
  const key = account ? `${account}:${p.stream_id}` : p.stream_id;

  if (p.reset) {
    cleanupUpload(key, true);
    // A reset is reported as a FAILURE with this wording, not as success. See the
    // header.
    throw new StreamError("Stream reset completed");
  }

  if (p.verify_only) {
    const state = uploads.get(key);
    if (!state) throw new StreamError("stream not found");
    return statusFrame(state, "file_created");
  }

  const state = uploads.get(key) ?? createUpload(p, account);
  if (p.expected_sha256 !== undefined) state.expectedSha256 = p.expected_sha256;
  if (p.file_size !== undefined) state.fileSize = p.file_size;

  if (p.chunk_data !== undefined && p.chunk_index !== undefined) {
    const index = p.chunk_index;
    if (index < 0 || index >= state.totalChunks) throw new StreamError(`invalid chunk index: ${index}`);
    // A duplicate is NOT an error and does NOT re-count its bytes: the client is
    // retrying a chunk whose acknowledgement it lost.
    if (state.claimed.has(index)) return statusFrame(state, "chunk_received");
    const buf = Buffer.from(p.chunk_data, "base64");
    if (buf.length > MAX_CHUNK_BYTES) throw new StreamError(`chunk exceeds size limit (${MAX_CHUNK_BYTES} bytes)`);
    if (state.bytesWritten + buf.length > MAX_UPLOAD_BYTES) {
      throw new StreamError(`stream exceeds total size limit (${MAX_UPLOAD_BYTES} bytes)`);
    }
    state.claimed.add(index);
    state.bytesWritten += buf.length;
    try {
      await fsPromises.writeFile(join(state.tempDir, `${index}.chunk`), buf);
    } catch (error) {
      // Roll BOTH sets and the byte count back, so a retry of this index is
      // accepted. See the header.
      state.claimed.delete(index);
      state.bytesWritten -= buf.length;
      throw error;
    }
    state.written.add(index);
    clearTimeout(state.timeoutId);
    state.timeoutId = reapTimer(state.key);
    return statusFrame(state, "chunk_received");
  }

  if (p.is_complete || state.written.size === state.totalChunks) return completeUpload(state);
  return statusFrame(state, "file_created");
}

// ===========================================================================
// The two action definitions
// ===========================================================================

const streamFileActions: (StreamActionSpec<Record<string, unknown>, ActionContext> | ActionSpec<Record<string, unknown>, ActionContext>)[] =
  [];

streamFileActions.push(
  defineStreamAction<
    {
      stream_id: string;
      chunk_data?: string | undefined;
      chunk_index?: number | undefined;
      total_chunks?: number | undefined;
      file_size?: number | undefined;
      expected_sha256?: string | undefined;
      is_complete?: boolean | undefined;
      filename?: string | undefined;
      reset?: boolean | undefined;
      verify_only?: boolean | undefined;
      file_retention: number;
    },
    ActionContext
  >({
    name: "upload_file_stream",
    examples: [
      {
        summary: "上传分块",
        params: {
          stream_id: "example-upload-001",
          filename: "hello.txt",
          total_chunks: 1,
          file_size: 5,
          chunk_index: 0,
          chunk_data: "aGVsbG8=",
        },
        notes: "第 1 步：每次上传生成新的 stream_id；这里上传 hello 的唯一分块。通过 invoke_action 调用，分块确认不等于整文件完成。",
      },
      {
        summary: "完成同一上传",
        params: { stream_id: "example-upload-001", is_complete: true },
        notes: "第 2 步：等待全部分块确认后，用同一个 stream_id 单独请求完成；成功时返回 file_path。MCP 的 invoke_action 也可通过 execution.input_file 自动完成上传。",
      },
    ],
    summary: "以流式分块方式上传文件到机器人本地(返回可用于发送的本地路径)",
    returns: "流式帧:分块确认 type=stream、完成 type=response(含 file_path/file_name/file_size/sha256)",
    params: {
      stream_id: f.string({ allowEmpty: false }).describe("流 ID(客户端生成的 UUID,限 [A-Za-z0-9_-])"),
      chunk_data: f.string().optional().describe("分块数据(Base64)"),
      chunk_index: f.int({ min: 0 }).optional().describe("分块索引(从 0 开始)"),
      total_chunks: f.int({ min: 1 }).optional().describe("总分块数(新流必填)"),
      file_size: f.int({ min: 0 }).optional().describe("文件总大小(字节)"),
      expected_sha256: f.string().optional().describe("期望的整文件 SHA256(校验)"),
      is_complete: f.bool().optional().describe("是否为最后一个分块/触发合并"),
      filename: f.string().optional().describe("文件名"),
      reset: f.bool().optional().describe("重置并丢弃该流"),
      verify_only: f.bool().optional().describe("仅查询当前流状态"),
      // `DEFAULT_RETENTION_MS` is the DOCUMENTED default, and it is the field whose
      // absence would silently delete a caller's upload after 5 minutes.
      file_retention: f
        .int({ min: 0 })
        .default(DEFAULT_RETENTION_MS)
        .describe("合并文件保留毫秒(0=不回收)"),
    },
    // The reference's `run` is `(p, ctx) => handleUpload(p, accountKey(ctx))` — it
    // IGNORES the sink. So every frame of this action is the terminal response; the
    // "stream" in its name describes the multi-CALL protocol, not multi-FRAME
    // delivery. That is why this is still declared with `defineStreamAction`: the
    // registry's `isStreamAction` must answer true so the transports wrap the
    // response in `wrapStreamTerminal`, which is what gives the client the
    // `stream: "stream-action"` marker it waits for.
    run: (p, ctx) => handleUpload(p, accountKey(ctx)),
  }) as unknown as StreamActionSpec<Record<string, unknown>, ActionContext>,
);

streamFileActions.push(
  defineAction<Record<string, never>, ActionContext>({
    name: "clean_stream_temp_file",
    examples: [
      {
        summary: "清理流式传输临时文件(仅清理 stream 上传/下载目录)",
        params: {},
        notes: "清理未使用的流式临时文件；不会清理正在传输的项目。",
      },
    ],
    summary: "清理流式传输临时文件(仅清理 stream 上传/下载目录)",
    returns: "{ message, removed }",
    params: {},
    run: () => {
      const result = clearInactiveStreamStorage();
      // A failure is escalated to a 100 rather than reported in the payload: the
      // reference throws, so a partial clean answers failed with the COUNT of
      // problems. Reporting `{removed: 3}` while three other items could not be
      // removed would be the "plausible empty object" failure mode in disguise.
      if (result.failures.length > 0) {
        throw new StreamError(`failed to remove ${result.failures.length} stream temp item(s)`);
      }
      return okResponse({
        message: "success",
        removed: result.deletedFiles,
        freed_bytes: result.freedBytes,
        skipped_active: result.skippedActiveItems,
      });
    },
  }) as unknown as ActionSpec<Record<string, unknown>, ActionContext>,
);

export { streamFileActions };
export const STREAM_FILE_ACTION_COUNT = streamFileActions.length;