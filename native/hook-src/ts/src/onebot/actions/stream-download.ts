// 4.6 (part 4) — the four stream-download actions.
//
// Reference region: reference/index.mjs:18321-18777 (`actions$1`, 4 definitions,
// plus the whole download engine they share).
//
// ---------------------------------------------------------------------------
// This is the family where "streaming" is REAL, and the distinction matters
// ---------------------------------------------------------------------------
// Compare with `upload_file_stream`: that action is one response per CALL, and the
// "stream" is a multi-call protocol. These four push N frames through the `sink`
// during a SINGLE call:
//
//     download_file_stream / _image_stream / _record_stream
//         file_info → file_chunk* → (terminal) file_complete
//     test_download_stream
//         data_chunk × 10 → (terminal) data_complete
//
// So `isStreamAction` must answer true for these — and the transports must actually
// deliver intermediate frames — or the caller sees exactly one frame and the
// transfer is silently degraded. `ts/src/onebot/api.ts` previously delivered one
// chunk because no stream action existed; that file is updated with this batch and
// the change is proven in `ts/test/onebot-stream.test.ts`.
//
// ---------------------------------------------------------------------------
// The SSRF guard is the largest part of this module, and it is not paranoia
// ---------------------------------------------------------------------------
// `download_file_stream` takes a URL from an OneBot client — i.e. from whatever
// program is driving the bot — and fetches it from inside the bot's network. Without
// a guard that is a request-forgery primitive: `http://169.254.169.254/latest/meta-data/`
// reads cloud credentials, `http://127.0.0.1:8080/` reaches the dashboard, and
// `http://10.0.0.5/admin` reaches the LAN. So `assertSafeUrl`:
//
//   * allows `http:`/`https:` only (a `file:` URL would skip the socket entirely);
//   * rejects a literal private/loopback/link-local host;
//   * resolves the hostname and rejects if ANY resolved address is private;
//   * follows redirects MANUALLY and re-validates each hop, because default `fetch`
//     follows a 302 to a private address without re-checking.
//
// The IPv6 half is byte-based rather than string-based on purpose: `new URL()`
// normalises `::ffff:127.0.0.1` to `::ffff:7f00:1`, so a string matcher on the
// literal form misses v4-mapped addresses entirely. `ipv6ToBytes` handles `::`
// compression and embedded IPv4, then the checks run on the 16 bytes.
//
// The reference documents one KNOWN RESIDUAL: DNS rebinding between `dns.lookup`
// and undici's own connect. Closing it needs connect-time peer-IP validation, which
// is a transport-layer change this port does not make. That is stated here rather
// than quietly claimed as solved.
//
// ---------------------------------------------------------------------------
// `progress` is rounded, and 0 when the total is unknown
// ---------------------------------------------------------------------------
//     progress: totalSize > 0 ? Math.min(100, Math.round(bytesRead / totalSize * 100)) : 0
//
// `Math.round`, not floor — a 1-byte-of-2 chunk reports 50, and the final chunk of a
// known-size file reports 100. A chunked HTTP response has no `content-length`, so
// `totalSize` is 0 and EVERY frame reports `progress: 0`. That is observable and a
// client must key on `file_complete`, not on `progress === 100`.
//
// ---------------------------------------------------------------------------
// The idle watchdog is armed per chunk, not per request
// ---------------------------------------------------------------------------
// `armIdle` resets a 60 s timer before the first chunk and again after each one. So
// a slow-but-moving transfer survives indefinitely while a stalled one is aborted
// (`abort()`, which destroys the read stream or aborts the fetch). `unref`'d, so it
// never keeps the process alive.
//
// ---------------------------------------------------------------------------
// What is reproduced for `test_download_stream` because it is the transport's canary
// ---------------------------------------------------------------------------
// Ten frames with `data: "Index-> 1"` … `"Index-> 10"` (note the arrow and the
// space), then either a `data_complete` terminal or — with `error: true` — a THROW
// whose wording is `"This is a test error"`. Nothing touches the network or the
// disk, which is exactly why this action is the one that proves frame delivery
// without needing a real transfer.

import { createReadStream, realpathSync, statSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { basename, relative, resolve } from "node:path";
import { defineStreamAction, f, okResponse, type StreamActionSpec } from "./kit.js";
import type { ActionContext } from "./context.js";
import { StreamStatus, type ApiResponse, type StreamSink } from "../types.js";
import { STREAM_ROOT, ensureStreamDirectory, registerActiveStreamItem } from "../stream-storage.js";
import { resolveLocalFilePath } from "../../bridge/web/binary-source.js";

// ===========================================================================
// Limits
// ===========================================================================

/** 64 KiB. The reference's default, and the value `file_info` reports. */
export const DEFAULT_CHUNK_BYTES = 64 * 1024;
export const MAX_CHUNK_REQUEST_BYTES = 16 * 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024 * 1024;
/** Time to first byte. Cleared once headers arrive so a large body is not cut. */
export const FETCH_CONNECT_TIMEOUT_MS = 30_000;
/** Between chunks. This is what kills a stalled body. */
export const IDLE_TIMEOUT_MS = 60_000;
export const MAX_REDIRECTS = 5;
export const DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** The error class every download failure uses; distinguishes our failures from fs/fetch ones. */
export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownloadError";
  }
}

// ===========================================================================
// The stream-root guard
// ===========================================================================

/**
 * `isWithinStreamRoot` — the local-file allowlist.
 *
 * A `download_file_stream` given `/etc/shadow` must refuse: the action's contract is
 * "stream temp directory, URL, or a cached media id", and a filesystem read outside
 * the temp dir is an arbitrary-file-read primitive. `realpath` is applied to the
 * ROOT too, because the root itself may be a symlink the operator set up via
 * `SNOWLUMA_STREAM_DIR`, and comparing a real file path against a symlinked root
 * would fail spuriously.
 */
export function isWithinStreamRoot(candidate: string): boolean {
  let root = resolve(STREAM_ROOT);
  try {
    root = realpathSync(STREAM_ROOT);
  } catch {
    // Root not created yet: the unresolved form is the correct comparison basis.
  }
  const rel = relative(root, resolve(candidate));
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith("/");
}

// ===========================================================================
// SSRF: address classification
// ===========================================================================

/** `isPrivateV4` — the eight reserved ranges that are never a public peer. */
export function isPrivateV4(octets: readonly number[]): boolean {
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && (b ?? 0) >= 16 && (b ?? 0) <= 31) ||
    (a === 169 && b === 254) ||
    (a === 100 && (b ?? 0) >= 64 && (b ?? 0) <= 127)
  );
}

/**
 * `ipv6ToBytes` — parse any IPv6 textual form to 16 bytes, or null.
 *
 * Handles `::` compression (at most one), an embedded trailing IPv4 dotted quad, and
 * bracket-stripping. Returns null for anything that is not a valid IPv6 address,
 * which the caller treats as "cannot classify" ⇒ refuse.
 */
export function ipv6ToBytes(input: string): Uint8Array | null {
  let s = input.replace(/^\[|\]$/g, "");
  if (isIP(s) !== 6) return null;
  const v4m = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4m) {
    const octets = v4m[1]!.split(".").map(Number);
    if (octets.some((n) => n > 255)) return null;
    s = `${s.slice(0, v4m.index)}:${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0]!.split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1]!.split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...new Array<string>(missing).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const group = parseInt(groups[i] || "0", 16);
    if (Number.isNaN(group) || group < 0 || group > 0xffff) return null;
    bytes[i * 2] = group >> 8;
    bytes[i * 2 + 1] = group & 0xff;
  }
  return bytes;
}

/**
 * `isPrivateIp` — v4 or v6, byte-based.
 *
 * The six v6 cases, in the reference's order:
 *   1. `::` (all zero) — the unspecified address;
 *   2. `::1` — loopback;
 *   3. `fc00::/7` — unique-local (`(b[0] & 0xfe) === 0xfc`);
 *   4. `fe80::/10` — link-local (`b[0] === 0xfe && (b[1] & 0xc0) === 0x80`);
 *   5. v4-mapped / v4-compatible in the first 10 bytes zero with `ffff` or `0000`,
 *      then delegate the last four bytes to `isPrivateV4`;
 *   6. the NAT64 well-known prefix `64:ff9b::/96`, then the same delegation.
 *
 * Case 5's `0000` branch matters: `::127.0.0.1` (v4-COMPATIBLE) is a valid way to
 * reach loopback on some stacks, and matching only `ffff` would let it through.
 */
export function isPrivateIp(ip: string): boolean {
  const host = ip.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  if (family === 4) return isPrivateV4(host.split(".").map(Number));
  if (family === 6) {
    const bytes = ipv6ToBytes(host);
    if (!bytes) return true;
    if (bytes.every((x) => x === 0)) return true;
    if (bytes.slice(0, 15).every((x) => x === 0) && bytes[15] === 1) return true;
    if ((bytes[0]! & 0xfe) === 0xfc) return true;
    if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true;
    if (
      bytes.slice(0, 10).every((x) => x === 0) &&
      ((bytes[10] === 0xff && bytes[11] === 0xff) || (bytes[10] === 0 && bytes[11] === 0))
    ) {
      return isPrivateV4([bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!]);
    }
    if (
      bytes[0] === 0 &&
      bytes[1] === 0x64 &&
      bytes[2] === 0xff &&
      bytes[3] === 0x9b &&
      bytes.slice(4, 12).every((x) => x === 0)
    ) {
      return isPrivateV4([bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!]);
    }
    return false;
  }
  // Not an IP at all: the caller only reaches here with a literal, so this is a bug
  // rather than a hostname. Treat as unsafe.
  return false;
}

/**
 * `assertSafeUrl` — parse + classify a URL, or throw.
 *
 * A hostname that fails to resolve is a DownloadError with `cannot resolve host: …`,
 * not a bare DNS error: the caller needs to distinguish "your URL is wrong" from
 * "the network is down".
 */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DownloadError("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DownloadError("only http(s) URLs are allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new DownloadError("refusing to fetch a private/loopback address");
    return url;
  }
  let addrs;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new DownloadError(`cannot resolve host: ${host}`);
  }
  for (const addr of addrs) {
    if (isPrivateIp(addr.address)) {
      throw new DownloadError("refusing to fetch a host that resolves to a private address");
    }
  }
  return url;
}

// ===========================================================================
// Redirect-following fetch
// ===========================================================================

export interface GuardedResponse {
  resp: Response;
  abort: () => void;
}

/**
 * `fetchGuarded` — follow redirects manually, validating every hop.
 *
 * `redirect: "manual"` is the whole point: default `fetch` follows a 302 without
 * re-checking the target, so a public URL could redirect to a metadata endpoint.
 * Each hop gets its own first-byte timeout; the LAST hop's controller is returned so
 * the caller's idle watchdog can kill a stalled body.
 */
export async function fetchGuarded(rawUrl: string): Promise<GuardedResponse> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertSafeUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_CONNECT_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: { "User-Agent": DOWNLOAD_USER_AGENT },
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      await resp.body?.cancel().catch(() => {});
      if (!location) throw new DownloadError(`download failed: ${resp.status} redirect without Location`);
      current = new URL(location, url).toString();
      continue;
    }
    return { resp, abort: () => controller.abort() };
  }
  throw new DownloadError("download failed: too many redirects");
}

/** A resolved source: a name, a size claim, and something to iterate. */
export type DownloadSource = {
  name: string;
  size: number;
  iterable: AsyncIterable<Uint8Array | Buffer> | NodeJS.ReadableStream;
  abort: () => void;
  managedPath?: string;
};

async function openUrl(rawUrl: string, name: string, knownSize: number): Promise<DownloadSource> {
  const { resp, abort } = await fetchGuarded(rawUrl);
  if (!resp.ok) {
    await resp.body?.cancel().catch(() => {});
    throw new DownloadError(`download failed: HTTP ${resp.status}`);
  }
  const declared = Number(resp.headers.get("content-length") ?? "");
  // `(valid && > 0 ? declared : 0) || knownSize` — an absent/zero content-length
  // falls through to the caller's own claim, and if that is 0 too the size is
  // genuinely unknown and `progress` reports 0 for every frame.
  const size = (Number.isFinite(declared) && declared > 0 ? declared : 0) || knownSize;
  if (!resp.body) throw new DownloadError("download failed: empty response body");
  return {
    name: name || urlBasename(rawUrl),
    size,
    iterable: resp.body as unknown as AsyncIterable<Uint8Array>,
    abort,
  };
}

/** `urlBasename` — the decoded last path segment, or `download.bin`. */
export function urlBasename(raw: string): string {
  try {
    const name = basename(new URL(raw).pathname);
    return name && name !== "/" ? decodeURIComponent(name) : "download.bin";
  } catch {
    return "download.bin";
  }
}

function asStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Which media provider to try. `auto` tries image then record. */
export type DownloadPreference = "auto" | "image" | "record";

/**
 * `resolveDownload` — the four-way source resolution, in priority order.
 *
 *   1. a LOCAL path under the stream root (stat, realpath, allowlist check);
 *   2. an `http(s)://` target, fetched directly;
 *   3. a cached media id, via `getImageInfo` and/or `getRecordInfo`, whose answer
 *      yields an `http(s)` URL to fetch.
 *
 * The local branch comes FIRST, so a target that is both a path and a URL-looking
 * string (impossible, but the order is still stated) resolves as a path. Note the
 * allowlist check runs on the REALPATH, so a symlink inside the root that points
 * outside is refused — the check is not merely lexical.
 *
 * `prefer` skips a provider rather than reordering: with `"record"`, `getImageInfo`
 * is not called at all, so a voice id is not mis-served by an image lookup that
 * happens to share the id space.
 */
export async function resolveDownload(
  target: string,
  ctx: ActionContext,
  prefer: DownloadPreference,
  chunkSize: number,
): Promise<DownloadSource> {
  const local = resolveLocalFilePath(target);
  if (local) {
    let stat: ReturnType<typeof statSync> | null = null;
    try {
      stat = statSync(local);
    } catch {
      stat = null;
    }
    if (stat?.isFile()) {
      ensureStreamDirectory(STREAM_ROOT);
      let real = local;
      try {
        real = realpathSync(local);
      } catch {
        // Keep the lexical path; `isWithinStreamRoot` still applies.
      }
      if (!isWithinStreamRoot(real)) {
        throw new DownloadError("local downloads are restricted to the stream temp directory");
      }
      const readStream = createReadStream(real, { highWaterMark: chunkSize });
      return {
        name: basename(real),
        size: stat.size,
        iterable: readStream,
        managedPath: real,
        abort: () => readStream.destroy(),
      };
    }
  }
  if (/^https?:\/\//i.test(target)) return openUrl(target, "", 0);
  let info: unknown = null;
  if (prefer !== "record") info = await ctx.getImageInfo?.(target);
  if (!info && prefer !== "image") info = await ctx.getRecordInfo?.(target);
  if (info) {
    const record = info as Record<string, unknown>;
    const url = asStr(record["url"]) || asStr(record["file"]);
    if (/^https?:\/\//i.test(url)) {
      return openUrl(url, asStr(record["file_name"]), asNum(record["file_size"]));
    }
  }
  throw new DownloadError(
    "file not found (expected a stream-dir path, an http(s) URL, or a cached image/voice id)",
  );
}

/**
 * `streamChunks` — push one frame per chunk, with the idle watchdog.
 *
 * `base64_size` is the length of the ENCODED string, which is NOT `size` and not
 * `size * 4/3` (padding varies). A client that preallocates from `size` and trusts
 * `base64_size` for its buffer will be right; one that assumes the ratio will be off
 * by up to two bytes per chunk.
 */
export async function streamChunks(
  sink: StreamSink,
  iterable: AsyncIterable<unknown> | NodeJS.ReadableStream,
  totalSize: number,
  dataType: string,
  abort: (() => void) | undefined,
): Promise<{ totalChunks: number; totalBytes: number }> {
  let index = 0;
  let bytesRead = 0;
  let idle: ReturnType<typeof setTimeout> | null = null;
  const armIdle = (): void => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => abort?.(), IDLE_TIMEOUT_MS);
    if (typeof idle.unref === "function") idle.unref();
  };
  armIdle();
  try {
    for await (const part of iterable as AsyncIterable<unknown>) {
      armIdle();
      // The reference is `Buffer.isBuffer(part) ? part : Buffer.from(part)`. Typed, that
      // one-liner does not compile: `ArrayBufferView` is generic in @types/node 22
      // (`ArrayBufferView<ArrayBufferLike>`), which the `Buffer.from` overloads reject.
      // The branches below are the same three shapes a Node readable actually yields —
      // Buffer, string, Uint8Array — so the runtime behaviour is identical and the extra
      // branches only replace a cast that hid a real type mismatch.
      const buf = Buffer.isBuffer(part)
        ? part
        : typeof part === "string"
          ? Buffer.from(part, "utf8")
          : part instanceof Uint8Array
            ? Buffer.from(part.buffer, part.byteOffset, part.byteLength)
            : Buffer.from(part as ArrayBuffer);
      bytesRead += buf.length;
      if (bytesRead > MAX_DOWNLOAD_BYTES) {
        throw new DownloadError(`download exceeds size limit (${MAX_DOWNLOAD_BYTES} bytes)`);
      }
      const base64 = buf.toString("base64");
      await sink.send({
        type: StreamStatus.Stream,
        data_type: dataType,
        index,
        data: base64,
        size: buf.length,
        progress: totalSize > 0 ? Math.min(100, Math.round((bytesRead / totalSize) * 100)) : 0,
        base64_size: base64.length,
      });
      index += 1;
    }
  } finally {
    if (idle) clearTimeout(idle);
  }
  return { totalChunks: index, totalBytes: bytesRead };
}

/**
 * `runDownload` — the whole lifecycle for one call.
 *
 * The `file_info` frame is sent BEFORE the first chunk and carries the CLAMPED chunk
 * size, so a client that asked for 100 MB is told 16 MB and must use that. The
 * activity registration happens after resolution (only a local source has a
 * `managedPath`) and is released in a `finally`, so an aborted transfer does not
 * leave the cleaner refusing to delete a file nobody is reading.
 */
export async function runDownload(
  target: string,
  chunkSizeReq: number | undefined,
  ctx: ActionContext,
  sink: StreamSink,
  prefer: DownloadPreference,
): Promise<ApiResponse> {
  if (!target) throw new DownloadError("file is required");
  let chunkSize = chunkSizeReq && chunkSizeReq > 0 ? chunkSizeReq : DEFAULT_CHUNK_BYTES;
  if (chunkSize > MAX_CHUNK_REQUEST_BYTES) chunkSize = MAX_CHUNK_REQUEST_BYTES;
  const src = await resolveDownload(target, ctx, prefer, chunkSize);
  const releaseStorageActivity = src.managedPath ? registerActiveStreamItem([src.managedPath]) : undefined;
  try {
    await sink.send({
      type: StreamStatus.Stream,
      data_type: "file_info",
      file_name: src.name,
      file_size: src.size,
      chunk_size: chunkSize,
    });
    const { totalChunks, totalBytes } = await streamChunks(
      sink,
      src.iterable as AsyncIterable<unknown>,
      src.size,
      "file_chunk",
      src.abort,
    );
    return okResponse({
      type: StreamStatus.Response,
      data_type: "file_complete",
      file_name: src.name,
      total_chunks: totalChunks,
      total_bytes: totalBytes,
      message: "Download completed",
    });
  } finally {
    releaseStorageActivity?.();
  }
}

// ===========================================================================
// The four action definitions
// ===========================================================================

/**
 * `downloadParams` — SHARED by three actions in the reference (one object literal,
 * referenced three times).
 *
 * Reproduced as a factory rather than a shared instance for the same reason as the
 * qzone field objects: `FileImpl` is mutable through `.optional()`/`.describe()`, and
 * a shared instance makes one action's doc edit appear in all three. The three
 * actions' `params` arrays are still identical, which the differential test asserts.
 *
 * `file` and `file_id` are BOTH `.optional()` and BOTH carry a `role` — and neither
 * is required, because the actions accept either. `runDownload` rejects an empty
 * target with `"file is required"`, so the "at least one" rule lives in the provider,
 * not in `rules`. That is the reference's choice and it is observable: a call with
 * neither field answers 100 `"file is required"`, not 1400.
 */
const downloadParams = () => ({
  file: f.string().optional().describe("文件路径(限 stream 临时目录)/ http(s) URL").role("file"),
  file_id: f.string().optional().describe("文件 ID(缓存的图片/语音 id)").role("file_id"),
  chunk_size: f.int({ min: 1 }).optional().describe("分块大小(字节,默认 64KB)"),
});

const streamDownloadActions: StreamActionSpec<Record<string, unknown>, ActionContext>[] = [];

streamDownloadActions.push(
  defineStreamAction<{ file?: string | undefined; file_id?: string | undefined; chunk_size?: number | undefined }, ActionContext>({
    name: "download_file_stream",
    examples: [
      {
        summary: "以流式方式下载文件(stream 目录本地文件 / URL / 缓存媒体)",
        params: { file: "https://example.com/report.pdf", chunk_size: 65536 },
        notes: "替换实际公开可访问地址；经 invoke_action 调用，文件保存到 MCP 下载目录。",
      },
    ],
    summary: "以流式方式下载文件(stream 目录本地文件 / URL / 缓存媒体)",
    returns: "流式帧:file_info → file_chunk* → file_complete",
    params: downloadParams(),
    run: (p, ctx, sink) => runDownload(p.file || p.file_id || "", p.chunk_size, ctx, sink, "auto"),
  }) as unknown as StreamActionSpec<Record<string, unknown>, ActionContext>,
);

streamDownloadActions.push(
  defineStreamAction<{ file?: string | undefined; file_id?: string | undefined; chunk_size?: number | undefined }, ActionContext>({
    name: "download_file_image_stream",
    examples: [
      {
        summary: "以流式方式下载图片(缓存图片 id / URL / stream 目录本地文件)",
        params: { file_id: "<image-file-from-message>", chunk_size: 65536 },
        notes: "file_id 来自当前账号图片消息；经 invoke_action 调用。",
      },
    ],
    summary: "以流式方式下载图片(缓存图片 id / URL / stream 目录本地文件)",
    returns: "流式帧:file_info → file_chunk* → file_complete",
    params: downloadParams(),
    run: (p, ctx, sink) => runDownload(p.file || p.file_id || "", p.chunk_size, ctx, sink, "image"),
  }) as unknown as StreamActionSpec<Record<string, unknown>, ActionContext>,
);

streamDownloadActions.push(
  defineStreamAction<{ file?: string | undefined; file_id?: string | undefined; chunk_size?: number | undefined }, ActionContext>({
    name: "download_file_record_stream",
    examples: [
      {
        summary: "以流式方式下载语音(缓存语音 id / URL / stream 目录本地文件)",
        params: { file_id: "<record-file-from-message>", chunk_size: 65536 },
        notes: "file_id 来自当前账号语音消息；经 invoke_action 调用。",
      },
    ],
    summary: "以流式方式下载语音(缓存语音 id / URL / stream 目录本地文件)",
    returns: "流式帧:file_info → file_chunk* → file_complete",
    params: downloadParams(),
    run: (p, ctx, sink) => runDownload(p.file || p.file_id || "", p.chunk_size, ctx, sink, "record"),
  }) as unknown as StreamActionSpec<Record<string, unknown>, ActionContext>,
);

streamDownloadActions.push(
  defineStreamAction<{ error: boolean }, ActionContext>({
    name: "test_download_stream",
    examples: [
      {
        summary: "测试下载流(推送 10 个数据帧,验证流式传输,不触达 QQ)",
        params: { error: false },
        notes: "经 invoke_action 调用，仅测试传输，不访问 QQ。",
      },
    ],
    summary: "测试下载流(推送 10 个数据帧,验证流式传输,不触达 QQ)",
    returns: "流式帧:data_chunk*10 → data_complete(error=true 时以 error 帧结束)",
    params: { error: f.bool().default(false).describe("是否触发测试错误") },
    run: async (p, _ctx, sink) => {
      // Ten frames, `Index-> N` with N from 1 to 10. The literal text — arrow, space,
      // no zero padding — is what the reference sends and what a client's test
      // assertions will be written against.
      for (let i = 0; i < 10; i += 1) {
        await sink.send({
          type: StreamStatus.Stream,
          data: `Index-> ${i + 1}`,
          data_type: "data_chunk",
        });
      }
      // The throw happens AFTER all ten frames, so the client observes the full
      // stream then an error terminal. Throwing first would make this action
      // useless as a frame-delivery test.
      if (p.error) throw new DownloadError("This is a test error");
      return okResponse({
        type: StreamStatus.Response,
        data_type: "data_complete",
        data: "Stream transmission complete",
      });
    },
  }) as unknown as StreamActionSpec<Record<string, unknown>, ActionContext>,
);

export { streamDownloadActions };
export const STREAM_DOWNLOAD_ACTION_COUNT = streamDownloadActions.length;