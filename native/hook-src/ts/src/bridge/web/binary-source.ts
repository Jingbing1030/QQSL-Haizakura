// Loading a binary source (local path / http(s) URL / `base64://` / `data:`) into
// bytes, for the web APIs that upload a user-supplied file.
//
// Reference region: ../protocol/src/highway/utils.ts (reference/index.mjs:17968,
// 353 lines), functions `loadBinarySource`, `inlineBase64Payload`,
// `resolveLocalFilePath`, `downloadHttp`, `guessFileNameFromUrl`, `tooLarge`.
//
// Only the "into memory" half is ported. The region's other half (`packHighwayFrame`
// / `unpackHighwayFrame` and the streaming-to-disk sink) belongs to the highway
// upload path, which is not part of the bridge layer.
//
// ---------------------------------------------------------------------------
// Why the size limit is a hard error with a retry-suppressing tag
// ---------------------------------------------------------------------------
// A source larger than the cap is rejected before and during the download, and the
// resulting Error carries `noRetry: true`. Without that tag the one Referer retry
// would re-download the same oversized body and double the transfer cost to reach
// the same conclusion.
//
// The cap is per-source-kind in the reference (`FLASH_TRANSFER_MAX_BYTES` is 4 GiB
// from disk but `DEFAULT_MAX_BINARY_SIZE` is 1 GiB in memory). This port keeps one
// in-memory default and lets the caller override it, which is the distinction that
// matters for a group-notice image.
//
// ---------------------------------------------------------------------------
// The `data:` / `base64://` split
// ---------------------------------------------------------------------------
// `base64://<payload>` is QQ's own convention and the payload starts at byte 9.
// `data:<mediatype>[;base64],<payload>` is the RFC form and the payload starts
// after the first comma, but ONLY if the metadata ends in `;base64` — a `data:`
// URL with percent-encoded content is rejected rather than mis-decoded as base64,
// because mis-decoding produces plausible-length garbage that fails much later.

import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

import { positiveIntEnv } from "../env.js";

/** The default in-memory cap: 1 GiB (`DEFAULT_MAX_BINARY_DOWNLOAD_BYTES`). */
export const DEFAULT_MAX_BINARY_SIZE = 1024 * 1024 * 1024;

/** The largest value `SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES` may take: 4 GiB. */
export const MAX_BINARY_DOWNLOAD_BYTES = 4 * 1024 * 1024 * 1024;

/** Per-download timeout, 60 s. */
export const DEFAULT_HTTP_DOWNLOAD_TIMEOUT_MS = 60_000;

/** The UA the reference's downloader presents. */
export const DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** `maxBinaryDownloadBytes()` — env-overridable cap. */
export function maxBinaryDownloadBytes(env: NodeJS.ProcessEnv = process.env): number {
  return positiveIntEnv("SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES", DEFAULT_MAX_BINARY_SIZE, {
    env,
    max: MAX_BINARY_DOWNLOAD_BYTES,
  });
}

/** `httpDownloadTimeoutMs()` — env-overridable download timeout. */
export function httpDownloadTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return positiveIntEnv("SNOWLUMA_HTTP_DOWNLOAD_TIMEOUT_MS", DEFAULT_HTTP_DOWNLOAD_TIMEOUT_MS, {
    env,
    max: 2_147_483_647,
  });
}

/** A size-limit failure that the retry path must not retry. */
export function tooLarge(message: string): Error {
  return Object.assign(new Error(message), { noRetry: true });
}

/** Extract the base64 payload of an inline source, or null when it is not inline. */
export function inlineBase64Payload(source: string): string | null {
  if (/^base64:\/\//i.test(source)) return source.slice(9);
  if (!/^data:/i.test(source)) return null;
  const comma = source.indexOf(",");
  if (comma < 0) throw new Error("data URL source is missing its payload separator");
  const metadata = source.slice(5, comma);
  if (!/;base64$/i.test(metadata)) throw new Error("data URL source must use base64 encoding");
  return source.slice(comma + 1);
}

/** Resolve a local path from a `file://` URL or a bare path; null for non-file sources. */
export function resolveLocalFilePath(source: string): string | null {
  if (!source) return null;
  if (/^(?:base64:\/\/|data:)/i.test(source)) return null;
  if (/^https?:\/\//i.test(source)) return null;
  let filePath = source;
  if (/^file:\/\//i.test(source)) {
    try {
      filePath = fileURLToPath(source);
    } catch {
      filePath = source.replace(/^file:\/+/i, "/");
      try {
        filePath = decodeURIComponent(filePath);
      } catch {
        // Keep the un-decoded path; the stat below will report the real problem.
      }
    }
    if (process.platform !== "win32" && filePath.startsWith("//")) filePath = filePath.replace(/^\/+/, "/");
  }
  if (/^\/[a-zA-Z]:/.test(filePath)) filePath = filePath.slice(1);
  return filePath;
}

/** The trailing path segment of a URL, percent-decoded when possible. */
export function guessFileNameFromUrl(url: string): string {
  const queryPos = url.search(/[?#]/);
  const pathPart = queryPos >= 0 ? url.slice(0, queryPos) : url;
  const lastSlash = pathPart.lastIndexOf("/");
  const raw = lastSlash >= 0 ? pathPart.slice(lastSlash + 1) : "";
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** A loaded binary source. `fileName` is "" for inline payloads. */
export interface BinarySource {
  bytes: Uint8Array;
  fileName: string;
}

/**
 * The shared HTTP download engine: browser UA, redirect follow, a deadline, an
 * incremental byte cap, and exactly one Referer retry.
 *
 * The retry exists because QQ's CDN rejects a bare request for some media and
 * accepts it with a Referer; retrying with the source URL as Referer is the
 * reference's fix. Any `noRetry` error (i.e. a size limit) skips it.
 */
async function downloadHttp(
  source: string,
  resourceName: string,
  maxBytes: number,
): Promise<{ result: Uint8Array; fileName: string }> {
  const fileName = guessFileNameFromUrl(source);
  const attempt = async (headers: Record<string, string>): Promise<Uint8Array> => {
    const resp = await fetch(source, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(httpDownloadTimeoutMs()),
    });
    if (!resp.ok) throw new Error(`HTTP download failed: ${String(resp.status)}`);
    const declared = Number(resp.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw tooLarge(`${resourceName} too large: ${String(declared)} > ${String(maxBytes)}`);
    }
    const reader = resp.body?.getReader();
    if (!reader) {
      const buffer = new Uint8Array(await resp.arrayBuffer());
      if (buffer.length > maxBytes) {
        throw tooLarge(`${resourceName} too large: ${String(buffer.length)} > ${String(maxBytes)}`);
      }
      return buffer;
    }
    const chunks: Uint8Array[] = [];
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
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  };
  const baseHeaders = { "User-Agent": DOWNLOAD_USER_AGENT, Accept: "*/*" };
  try {
    return { result: await attempt(baseHeaders), fileName };
  } catch (error) {
    if ((error as { noRetry?: boolean }).noRetry === true) throw error;
    return { result: await attempt({ ...baseHeaders, Referer: source }), fileName };
  }
}

/**
 * Load a binary source into memory.
 *
 * The three source forms are tried in a fixed order — inline, http(s), local file —
 * and the order is observable: a string that looks like both a URL and a path is a
 * URL.
 */
export async function loadBinarySource(
  source: string,
  resourceName: string,
  maxBytes: number = maxBinaryDownloadBytes(),
): Promise<BinarySource> {
  if (!source) throw new Error(`${resourceName} source is empty`);
  const inlinePayload = inlineBase64Payload(source);
  if (inlinePayload !== null) {
    const bytes = Buffer.from(inlinePayload, "base64");
    if (bytes.length > maxBytes) {
      throw new Error(`${resourceName} too large: ${String(bytes.length)} > ${String(maxBytes)}`);
    }
    return { bytes, fileName: "" };
  }
  if (/^https?:\/\//i.test(source)) {
    const { result, fileName } = await downloadHttp(source, resourceName, maxBytes);
    return { bytes: result, fileName };
  }
  const filePath = resolveLocalFilePath(source);
  if (!filePath) throw new Error(`${resourceName} source is not a local file`);
  const stat = statSync(filePath);
  if (stat.size > maxBytes) {
    throw new Error(`${resourceName} too large: ${String(stat.size)} > ${String(maxBytes)}`);
  }
  return { bytes: readFileSync(filePath), fileName: basename(filePath) };
}