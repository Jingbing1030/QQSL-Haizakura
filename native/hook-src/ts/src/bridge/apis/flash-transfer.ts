// `FlashTransferApi` — the 閃伝 (`闪传`) fileset family, READ-ONLY half.
//
// ---------------------------------------------------------------------------
// What this file is, relative to the reference
// ---------------------------------------------------------------------------
// Reference region `src/bridge/apis/flash-transfer.ts` (reference/index.mjs:107728-
// 108131, 404 lines). Every OIDB spec it needs is already ported in
// `ts/src/oidb/services/0x93d0-flash.ts` (thirteen commands) and
// `ts/src/oidb/services/0x12a9.ts` (`GetFlashDownload`, sub 200), so this module is
// **pure wiring plus three behaviours that are not one-liners**:
//
//   getFileDownload      the `0x93d4 → 0x12a9_200` two-hop, with a retry schedule;
//   getFilesetIdByCode   an HTTP GET against `qfile.qq.com/q/<code>` (not OIDB);
//   fileTypeCode         the extension → {typeCode, formatCode} table.
//
// Everything else is a one-line `.invoke(this.#ctx, {...})`.
//
// ---------------------------------------------------------------------------
// ⚠️ The download URL is TWO commands, and neither alone is enough
// ---------------------------------------------------------------------------
// `0x93d4` (`GetDownloadUrl`) returns one row per file in the fileset. Its
// `downloadUrl` field — and `0x93d3`'s identically-named field — is a **thumbnail**
// (`appid=14903` for png, `14902` for jpg), NOT the main file. The main file's
// direct link only comes from `0x12a9` sub 200 (`GetFlashDownload`), which needs
// `fileId`/`fileUuid`/`filesetUuid`/`fileName` from the `0x93d4` row.
//
// Which is why `getFileDownload` is the only place that knows the ordering: ask
// `0x93d4`, pick the row by `fileIndex`, and only then ask `0x12a9`.
//
// ---------------------------------------------------------------------------
// ⚠️ `fileId` can legitimately be absent right after `create`
// ---------------------------------------------------------------------------
// `0x93d4` may omit the main-file `fileId` for a few seconds after the fileset is
// created (#364 — the server indexes lazily). The reference therefore re-queries on
// a fixed schedule, and this port reproduces it exactly
// (`FLASH_FILE_ID_RETRY_DELAYS_MS`). The first lookup is **immediate**: the schedule
// lists the *delays before the retries*, not the delays before each attempt.
//
// Once a `fileId` IS present, `0x12a9` is called exactly once — retrying it would
// create duplicate download sessions for no benefit.
//
// ---------------------------------------------------------------------------
// ⚠️ `fileTypeCode` returns two DIFFERENT numbers, for two different commands
// ---------------------------------------------------------------------------
//   typeCode   goes in `0x93cf` field 3 — the CARD's coarse class. zip=6,
//              other archives=2, everything else=7. (Three values only.)
//   formatCode goes in `0x93d0` field 7 and `0x12a9` `filesetWrap.field7` — the
//              peer's ICON. png=26, mp4=2, zip=4, unknown=11, and ~25 more.
//
// They disagree on almost every extension (a .png is `typeCode: 7` but
// `formatCode: 26`) and sharing one function between them would put a card class
// where the icon belongs. Both tables are transcribed from the reference, including
// its ordering quirks (`zip` is special-cased before the archive set, and
// `doc`/`docx` are checked by equality rather than through a set).
//
// The extension is lower-cased and taken as the last dot-segment: `/\.([^.]+)$/`.
// That regex is the reference's, so `archive.tar.gz` → `gz` (not `tar.gz`), and a
// name with no dot at all → `""` → the "unknown" fallbacks (typeCode 7, formatCode
// 11). A name ending in a dot (`"report."`) also yields `""`, because the capture
// requires at least one character.
//
// ---------------------------------------------------------------------------
// The uploader half: `createFlashTask`
// ---------------------------------------------------------------------------
// `createFlashTask` (reference:107905-108010, plus the four private helpers after it)
// is the ONE member of this class that needs a byte pipeline rather than a codec:
// it stages sources to disk, streams MD5/SHA1, applies a fileset, commits entries,
// slices each file into 1 MiB chunks and POSTs them to
// `multimedia.qfile.qq.com/sliceupload`, then uploads two placeholder thumbnails.
//
// Read it as five phases, in this exact order — the order IS the protocol:
//
//   stage               per file: `stageSourceToDisk` → display name → `formatCode` →
//                       `guardStat` → a cleanup handle. An empty file is rejected
//                       HERE, after staging, so the `finally` still removes its temp.
//   ApplyFileset        ONE call for the whole fileset: the CARD's name, the SUM of
//                       all file sizes (that sum is how the server decides the
//                       fileset is multi-file), and `typeCode` from the FIRST file.
//   CommitFile          ALL entries in ONE request, before any upload. Each carries
//                       its own 1-based `fileIndex` (`i + 1`), which prepare/apply
//                       must repeat or the file is not counted into the set.
//   CompleteFileset     once, still before uploading.
//   upload              per file: streaming hash → PrepareUpload (rkey) → ApplyUpload
//                       (fileId) → one sliceupload POST per 1 MiB slice. Then the two
//                       thumbnails, then SetFilesetStatus.
//
// ⚠️ Everything goes through `sliceupload`; there is no small-file PUT path. Only
// that path reports the main file's sha1/size, and only a reported sha1 lets the
// server mark the fileset complete. A "shortcut" for small files leaves the fileset
// stuck at "uploading" and undownloadable by the peer.
//
// ⚠️ The two `fileTypeCode` calls are NOT the same call twice. Per file it takes
// `.formatCode` (the peer's icon, `0x93d0` field 7). Once for the fileset it takes
// `.typeCode` (the card's coarse class, `0x93cf` field 3), and from the FIRST file
// only. Collapsing them puts a card class where an icon belongs.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { promises as fsPromises } from "node:fs";
import { deflateSync } from "node:zlib";

import type { BridgeContext } from "../context.js";
import type { FlashFileInfo } from "../../onebot/actions/context.js";
import { oidbCaller } from "../oidb-invoke.js";
import {
  ApplyFileset,
  ApplyUpload,
  CommitFile,
  CompleteFileset,
  DeleteFlashFile,
  GetDownloadUrl,
  GetFilesetDetail,
  ListFilesets,
  PrepareUpload,
  RenameFlashFile,
  SendFlashMsg,
  SetFilesetStatus,
} from "../../oidb/services/0x93d0-flash.js";
import type { FlashFileEntry } from "../../oidb/services/0x93d0-flash.js";
import { GetFlashDownload } from "../../oidb/services/0x12a9.js";
import { ProtoReader, ProtoWriter, WireType, tagOf } from "../../oidb/wire.js";
import { FileChunkSource } from "../../highway/upload.js";
import { DEFAULT_MAX_BINARY_SIZE, inlineBase64Payload } from "../web/binary-source.js";
import { FILE_UPLOAD_MAX_BYTES, assertUnchanged, stageSourceToDisk } from "../web/stage-source.js";

// ===========================================================================
// The module-scope callers
// ===========================================================================
//
// `oidbCaller(spec)` is the `.invoke(ctx, params)` adapter (`oidb-invoke.ts`): the
// specs are pure data, and the reference attaches `.invoke` to them in an IIFE. Hoisted
// to module scope so the five one-liners below stay one line each.

const getFilesetDetailCall = oidbCaller(GetFilesetDetail);
const listFilesetsCall = oidbCaller(ListFilesets);
const getDownloadUrlCall = oidbCaller(GetDownloadUrl);
const getFlashDownloadCall = oidbCaller(GetFlashDownload);
const deleteFlashFileCall = oidbCaller(DeleteFlashFile);
const renameFlashFileCall = oidbCaller(RenameFlashFile);
const sendFlashMsgCall = oidbCaller(SendFlashMsg);

// The uploader's six. Same adapter, same reason — the specs themselves stay pure data.
const applyFilesetCall = oidbCaller(ApplyFileset);
const commitFileCall = oidbCaller(CommitFile);
const completeFilesetCall = oidbCaller(CompleteFileset);
const setFilesetStatusCall = oidbCaller(SetFilesetStatus);
const prepareUploadCall = oidbCaller(PrepareUpload);
const applyUploadCall = oidbCaller(ApplyUpload);

// ===========================================================================
// The extension tables
// ===========================================================================
//
// Transcribed verbatim from reference/index.mjs:107440-107535. Kept as `Set`s (rather
// than objects) to match the reference and because membership is the only operation.

const FLASH_IMAGE_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "bmp",
  "webp",
  "heic",
  "avif",
  "tiff",
  "tif",
  "ico",
  "dib",
  "heif",
]);

const FLASH_AUDIO_EXT = new Set(["mp3", "wav", "aac", "flac"]);

const FLASH_VIDEO_EXT = new Set([
  "mp4",
  "avi",
  "mkv",
  "mov",
  "3gp",
  "mpeg",
  "rmvb",
  "rm",
  "wmv",
  "flv",
  "asf",
  "webm",
  "mpg",
  "vob",
  "m4v",
  "f4v",
]);

const FLASH_ARCHIVE_EXT = new Set(["zip", "rar", "tar", "bz2", "xz", "tgz", "gz", "7z"]);

const FLASH_MODEL_EXT = new Set(["pt", "pth", "onnx", "model", "mlmodel"]);

/**
 * `0x93cf` field 3 — the card's coarse class. **Three possible values.**
 *
 * `zip` is checked FIRST and answers 6; every other archive answers 2; everything else
 * (images, video, audio, documents, unknown) answers 7. The reference's own comment
 * calls it "压缩包走 2/6，其余按媒体类 7".
 *
 * ⚠️ Do not merge this with `flashFormatCode`. A `.png` is `typeCode: 7` here and
 * `formatCode: 26` there — the card class and the icon are different vocabularies.
 */
function flashApplyTypeCode(ext: string): number {
  if (ext === "zip") return 6;
  if (FLASH_ARCHIVE_EXT.has(ext)) return 2;
  return 7;
}

/**
 * `0x93d0` field 7 / `0x12a9` `filesetWrap.field7` — the peer's ICON code.
 *
 * Matches what the QQ client itself picks per extension. The fallthrough is 11
 * ("unknown"), so an extension nobody listed still produces a valid icon rather than 0.
 *
 * Field-checking order is the reference's and is load-bearing only in one place: `zip`
 * reaches the archive branch (4), NOT the `typeCode` special case (6). `doc`/`docx` and
 * the other equality checks are written out rather than put in sets, matching the
 * reference — they are not worth "tidying" into a table that could drift.
 */
function flashFormatCode(ext: string): number {
  if (FLASH_IMAGE_EXT.has(ext)) return 26;
  if (FLASH_AUDIO_EXT.has(ext)) return 1;
  if (FLASH_VIDEO_EXT.has(ext)) return 2;
  if (ext === "doc" || ext === "docx") return 3;
  if (FLASH_ARCHIVE_EXT.has(ext)) return 4;
  if (ext === "apk") return 5;
  if (ext === "xls" || ext === "xlsx") return 6;
  if (ext === "ppt" || ext === "pptx") return 7;
  if (ext === "html" || ext === "htm") return 8;
  if (ext === "pdf") return 9;
  if (ext === "txt") return 10;
  if (ext === "psd") return 12;
  if (FLASH_MODEL_EXT.has(ext)) return 15;
  if (ext === "ttf" || ext === "otf") return 16;
  if (ext === "ipa") return 17;
  if (ext === "dmg") return 23;
  if (ext === "pkg") return 24;
  if (ext === "key") return 18;
  if (ext === "note") return 19;
  if (ext === "numbers") return 20;
  if (ext === "pages") return 21;
  if (ext === "sketch") return 22;
  if (ext === "exe") return 27;
  return 11;
}

// ===========================================================================
// `0x93d4` → `0x12a9` retry schedule
// ===========================================================================

/**
 * After `create` returns, `0x93d4` can still omit the main-file `fileId` for a few
 * seconds (#364). Re-query on this schedule; the FIRST lookup is immediate, so these
 * are the waits *between* attempts, not before each one.
 *
 * Total worst case is 1 + 2 + 4 + 4 = 11 s of sleeping across 5 `0x93d4` calls. The
 * reference's numbers, not tuned here: shortening them turns a slow index into a
 * spurious "no download url available".
 */
const FLASH_FILE_ID_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 4_000] as const;

// ===========================================================================
// `get_fileset_id` — the share-page scrape
// ===========================================================================
//
// `code → fileset UUID` does NOT go through OIDB. The QQ client calls a signed trpc
// HTTP API; the share page `qfile.qq.com/q/<code>` embeds the same `fileset_id` in its
// HTML, so a plain GET plus a regex is enough and avoids re-implementing the signature.
//
// Every one of these guards is the reference's (reference:107611-107655). They exist
// because the input is a user-supplied code that ends up in a URL path:
//   * the origin is hard-coded (never taken from the caller) — no SSRF;
//   * a redirect is REFUSED rather than followed, so the hard-coded origin cannot be
//     bounced somewhere else;
//   * the page is capped at 2 MiB, both by `content-length` and by a running byte
//     count, so a hostile or broken response cannot exhaust memory;
//   * the code itself is length- and character-checked before it is percent-encoded.

const QFILE_SHARE_ORIGIN = "https://qfile.qq.com";
const QFILE_SHARE_PAGE_MAX_BYTES = 2 * 1024 * 1024;
const QFILE_SHARE_TIMEOUT_MS = 20_000;

/**
 * Normalise a share code OR an official share URL into the canonical page URL.
 *
 * Accepts both `abc123` and `https://qfile.qq.com/q/abc123`. A URL is only accepted if
 * it is `https:`, host `qfile.qq.com`, default port, and no credentials — anything else
 * throws, which is the reference's behaviour (it does not silently treat a foreign URL
 * as a bare code).
 */
function officialQfileShareUrl(input: string): string {
  const value = input.trim();
  if (!value) throw new Error("get_fileset_id: share code is empty");
  let code = value;
  // A scheme (`https:`) or a protocol-relative `//host/...` means "this is meant to be
  // a URL", so a parse failure must be an error rather than a literal code.
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith("//")) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch (error) {
      throw new Error("get_fileset_id: expected an official QQ share URL", { cause: error });
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "qfile.qq.com" ||
      parsed.port !== "" ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      throw new Error("get_fileset_id: expected an official QQ share URL");
    }
    const match = /^\/q\/([^/]+)\/?$/.exec(parsed.pathname);
    if (!match) throw new Error("get_fileset_id: expected an official QQ share URL");
    try {
      code = decodeURIComponent(match[1] as string);
    } catch (error) {
      throw new Error("get_fileset_id: expected an official QQ share URL", { cause: error });
    }
  }
  // Control characters and path separators would let a code escape its path segment.
  const hasForbiddenCharacter = Array.from(code).some((char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return codePoint <= 32 || codePoint === 127 || "/\\?#".includes(char);
  });
  if (code.length > 256 || hasForbiddenCharacter) throw new Error("get_fileset_id: invalid share code");
  return `${QFILE_SHARE_ORIGIN}/q/${encodeURIComponent(code)}`;
}

/**
 * Cancel the response body, then throw `error`.
 *
 * A `fetch` body left unread keeps the socket (and its buffer) alive until GC. The
 * `AggregateError` branch exists because `body.cancel()` itself can reject, and losing
 * the original reason behind a cleanup failure would be worse than the leak.
 */
async function rejectShareResponse(response: Response, error: Error): Promise<never> {
  try {
    await response.body?.cancel(error);
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], error.message);
  }
  throw error;
}

/**
 * Read the share page as text, enforcing the 2 MiB cap twice.
 *
 * `content-length` first (cheap rejection), then a running total on the stream (a
 * response that lied about — or omitted — its length). Chunked decoding is used so a
 * multi-byte character split across chunks is not mangled.
 */
async function readSharePage(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      await rejectShareResponse(response, new Error("get_fileset_id: invalid response length"));
    }
    if (Number(declaredLength) > QFILE_SHARE_PAGE_MAX_BYTES) {
      await rejectShareResponse(response, new Error("get_fileset_id: share page too large"));
    }
  }
  if (!response.body) throw new Error("get_fileset_id: share page response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let html = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > QFILE_SHARE_PAGE_MAX_BYTES) {
        const error = new Error("get_fileset_id: share page too large");
        try {
          await reader.cancel(error);
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], error.message);
        }
        throw error;
      }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
    return html;
  } finally {
    reader.releaseLock();
  }
}

/**
 * `fileset_id` out of the share page HTML.
 *
 * The page embeds a JSON blob, possibly backslash-escaped inside a JS string, so the
 * pattern allows an optional `\` on both sides of the key/value quotes. Copied from
 * reference/index.mjs:107850 — the optional backslashes are the whole point, and
 * dropping them works on one of the two embeddings and silently fails on the other.
 */
const FLASH_SHARE_FILESET_ID =
  /fileset_id\\?"\s*:\s*\\?"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;

// ===========================================================================
// `entryToInfo` — the OIDB entry → the action layer's row
// ===========================================================================

/**
 * `FlashFileEntry` → `FlashFileInfo`.
 *
 * Every field is `?? ""` / `Number(… ?? 0)` rather than a non-null assertion: the
 * decoder answers `null` for an absent field, and the action layer's
 * `flashFileInfoToJson` renames these onto `fileset_id` / `file_name` / `orig_name` /
 * `size` / `share_url` / `file_id` / `download_url`. So the SHAPE here is the contract
 * — returning `undefined` would make `flashFileInfoToJson` emit `undefined` where a
 * client expects `""`.
 */
function entryToInfo(entry: FlashFileEntry): FlashFileInfo {
  return {
    filesetUuid: entry.filesetUuid ?? "",
    fileName: entry.fileName ?? "",
    origName: entry.origName ?? "",
    fileSize: Number(entry.fileSize ?? 0),
    shareUrl: entry.uploadUrlWrap?.uploadUrl ?? "",
    fileId: entry.fileIdWrap?.fileId ?? "",
    downloadUrl: entry.fileIdWrap?.download?.downloadUrl ?? "",
  };
}

// ===========================================================================
// The uploader's building blocks
// ===========================================================================
//
// Everything below is needed by `createFlashTask` alone. Kept at module scope (rather
// than as private methods) for the ones that are pure, matching the reference, which
// hoists `flashStageMaxBytes` / `flashFileDisplayName` / `normalizeFlashTaskInputs`
// / `hashFlashFileStreaming` / `generatePng` exactly this way.

/**
 * `FLASH_SLICE_SIZE` — 1 MiB, the `sliceupload` slice size (reference:107460).
 *
 * The hash pass reads at the same size (`SHA1_STREAM_BLOCK_SIZE`), and the two MUST
 * stay equal: `sha1StateV[i]` is "the SHA-1 state after slice i", so a hash pass that
 * bucketed differently from the uploader would send states the server cannot match
 * against the slices it receives.
 */
const FLASH_SLICE_SIZE = 1024 * 1024;

/**
 * `flashStageMaxBytes` — the staging cap **per source kind**, not a constant.
 *
 * 4 GiB for a local path or an http(s) URL (both stream to disk, so the cost is
 * disk space). 1 GiB for an inline base64/`data:` source, because
 * `stageSourceToDisk` must materialise those bytes in RAM before writing them —
 * a 4 GiB cap there would be a 4 GiB allocation.
 */
function flashStageMaxBytes(source: string): number {
  return inlineBase64Payload(source) !== null ? DEFAULT_MAX_BINARY_SIZE : FILE_UPLOAD_MAX_BYTES;
}

/**
 * `flashFileDisplayName(override, fallback)` — the peer-visible file name.
 *
 * The caller's name wins, with path separators flattened to `_` (a display name is
 * not a path) and trimmed; an absent/blank name falls back to the staged basename.
 * `override ?? ""` then `.trim() ||` means `""` and `"   "` both fall back — which is
 * the reference's behaviour, and matters because the ACTION's parser accepts an empty
 * `name` string.
 */
function flashFileDisplayName(override: string | undefined, fallback: string): string {
  return (override ?? "").replace(/[/\\]/g, "_").trim() || fallback;
}

/** `normalizeFlashTaskInputs` (reference:107572): a bare source, or a list of them. */
function normalizeFlashTaskInputs(
  files: readonly ({ file: string; name?: string | undefined } | string)[],
): { file: string; name?: string | undefined }[] {
  return files.map((item) => (typeof item === "string" ? { file: item } : item));
}

// ---------------------------------------------------------------------------
// `Sha1Stream` — the intermediate-state SHA-1 the slice protocol needs
// ---------------------------------------------------------------------------
//
// `node:crypto` can only answer a FINAL digest, but `sha1StateV` is a list of
// intermediate states: 20 bytes each, taken after each 1 MiB slice without finalising.
// That is why the reference carries its own SHA-1 (reference:37285-37350, ~65 lines)
// and why `hashFileStreaming` cannot be substituted for `hashFlashFileStreaming` —
// its per-block list is finalised digests with an extra trailing state when the size
// is an exact multiple of 1 MiB.
//
// Ported operation-for-operation rather than "cleaned up": `hash(true)` must produce
// the same 20 bytes the QQ client produces, i.e. the five `uint32` state words in
// LITTLE-endian order.

const SHA1_BLOCK_SIZE = 64;
const SHA1_DIGEST_SIZE = 20;

function rotl(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n));
}

class Sha1Stream {
  readonly #state = new Uint32Array(5);
  readonly #count = new Uint32Array(2);
  readonly #buffer = new Uint8Array(SHA1_BLOCK_SIZE);

  constructor() {
    this.#state[0] = 0x67452301;
    this.#state[1] = 0xefcdab89;
    this.#state[2] = 0x98badcfe;
    this.#state[3] = 0x10325476;
    this.#state[4] = 0xc3d2e1f0;
  }

  #transform(data: Uint8Array, offset: number): void {
    const w = new Uint32Array(80);
    const dv = new DataView(data.buffer, data.byteOffset + offset, SHA1_BLOCK_SIZE);
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(i * 4, false);
    for (let i = 16; i < 80; i++) w[i] = rotl((w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!) >>> 0, 1);
    let a = this.#state[0]!;
    let b = this.#state[1]!;
    let c = this.#state[2]!;
    let d = this.#state[3]!;
    let e = this.#state[4]!;
    for (let i = 0; i < 80; i++) {
      let temp: number;
      if (i < 20) temp = ((b & c) | (~b & d)) + 0x5a827999;
      else if (i < 40) temp = (b ^ c ^ d) + 0x6ed9eba1;
      else if (i < 60) temp = ((b & c) | (b & d) | (c & d)) + 0x8f1bbcdc;
      else temp = (b ^ c ^ d) + 0xca62c1d6;
      temp = (temp + rotl(a, 5) + e + w[i]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30) >>> 0;
      b = a;
      a = temp;
    }
    this.#state[0] = (this.#state[0]! + a) >>> 0;
    this.#state[1] = (this.#state[1]! + b) >>> 0;
    this.#state[2] = (this.#state[2]! + c) >>> 0;
    this.#state[3] = (this.#state[3]! + d) >>> 0;
    this.#state[4] = (this.#state[4]! + e) >>> 0;
  }

  update(data: Uint8Array): void {
    const len = data.length;
    let index = (this.#count[0]! >>> 3) & 63;
    this.#count[0] = (this.#count[0]! + (len << 3)) >>> 0;
    if (this.#count[0]! < (len << 3)) this.#count[1] = (this.#count[1]! + 1) >>> 0;
    this.#count[1] = (this.#count[1]! + (len >>> 29)) >>> 0;
    let partLen = SHA1_BLOCK_SIZE - index;
    let i = 0;
    if (len >= partLen) {
      this.#buffer.set(data.subarray(0, partLen), index);
      this.#transform(this.#buffer, 0);
      i = partLen;
      while (i + SHA1_BLOCK_SIZE <= len) {
        this.#transform(data, i);
        i += SHA1_BLOCK_SIZE;
      }
      index = 0;
    }
    this.#buffer.set(data.subarray(i), index);
  }

  /** The five state words as 20 bytes. `littleEndian=true` is what flash wants. */
  hash(littleEndian: boolean): Uint8Array {
    const digest = new Uint8Array(SHA1_DIGEST_SIZE);
    const dv = new DataView(digest.buffer);
    for (let i = 0; i < 5; i++) dv.setUint32(i * 4, this.#state[i]!, littleEndian);
    return digest;
  }
}

/** `hashFlashFileStreaming`'s result. All three digests, in the forms the wire wants. */
interface FlashFileHashes {
  md5: Uint8Array;
  sha1: Uint8Array;
  md5Hex: string;
  sha1Hex: string;
  /** One 20-byte state per 1 MiB slice; the LAST is the finalised whole-file digest. */
  sha1StateV: Uint8Array[];
  sliceCount: number;
}

/**
 * `hashFlashFileStreaming` (reference:37435) — md5 + sha1 + `sha1StateV` in ONE pass.
 *
 * Streaming through `FileChunkSource` is not an optimisation here but a requirement:
 * the cap is 4 GiB, and buffering that to hash it is not possible.
 *
 * The last state is the plain `createHash("sha1")` digest, NOT `Sha1Stream.hash()`;
 * the intermediate ones are un-finalised states. Empty files answer `sliceCount: 0`
 * and an EMPTY `sha1StateV` — the caller rejects them earlier, so nothing downstream
 * has to handle the degenerate case.
 */
async function hashFlashFileStreaming(filePath: string): Promise<FlashFileHashes> {
  const { size } = await fsPromises.stat(filePath);
  const sliceCount = Math.ceil(size / FLASH_SLICE_SIZE);
  const source = await FileChunkSource.open(filePath);
  try {
    const md5 = createHash("md5");
    const sha1 = createHash("sha1");
    const blockSha1 = new Sha1Stream();
    const sha1StateV: Uint8Array[] = [];
    let offset = 0;
    let sliceIndex = 0;
    while (offset < size) {
      const length = Math.min(FLASH_SLICE_SIZE, size - offset);
      const chunk = await source.read(offset, length);
      md5.update(chunk);
      sha1.update(chunk);
      blockSha1.update(chunk);
      if (sliceIndex !== sliceCount - 1) sha1StateV.push(blockSha1.hash(true));
      offset += length;
      sliceIndex += 1;
    }
    const sha1Digest = sha1.digest();
    if (sliceCount > 0) sha1StateV.push(new Uint8Array(sha1Digest));
    const md5Digest = md5.digest();
    return {
      md5: new Uint8Array(md5Digest),
      sha1: new Uint8Array(sha1Digest),
      md5Hex: md5Digest.toString("hex"),
      sha1Hex: sha1Digest.toString("hex"),
      sha1StateV,
      sliceCount,
    };
  } finally {
    await source.close();
  }
}

/** `computeHashes` (reference:18164) — md5 + sha1 over an in-memory buffer. */
function computeHashes(bytes: Uint8Array): { md5: Uint8Array; sha1: Uint8Array; md5Hex: string; sha1Hex: string } {
  const md5 = createHash("md5").update(bytes).digest();
  const sha1 = createHash("sha1").update(bytes).digest();
  return {
    md5: new Uint8Array(md5),
    sha1: new Uint8Array(sha1),
    md5Hex: md5.toString("hex"),
    sha1Hex: sha1.toString("hex"),
  };
}

/**
 * `computeSha1StateV` (reference:37363) — the in-memory twin of the streaming pass.
 *
 * Only the thumbnail path uses it, always with `sliceCount: 1`, where the single state
 * IS the whole-file digest. Kept general because that is what the reference does.
 */
function computeSha1StateV(bytes: Uint8Array, sliceCount: number, sliceSize: number): Uint8Array[] {
  const states: Uint8Array[] = [];
  const sha1 = new Sha1Stream();
  for (let i = 0; i < sliceCount; i++) {
    const start = i * sliceSize;
    const end = Math.min(start + sliceSize, bytes.length);
    sha1.update(bytes.subarray(start, end));
    if (i !== sliceCount - 1) states.push(sha1.hash(true));
    else states.push(new Uint8Array(createHash("sha1").update(Buffer.from(bytes)).digest()));
  }
  return states;
}

// ---------------------------------------------------------------------------
// `buildFileId` — the client-generated `0x12a9` fileId
// ---------------------------------------------------------------------------

const FLASH_FILE_ID_FIELD = {
  sha1: 2,
  fileSize: 3,
  appid: 4,
  timestamp: 5,
  env: 6,
  ttl: 10,
  sessionId: 11,
  field15: 15,
  region: 16,
} as const;

/** The main-file appid. Thumbnails use 14903 (png) / 14902 (jpg). */
const FLASH_MAIN_APPID = 14901;
const FLASH_PNG_APPID = 14903;
const FLASH_JPG_APPID = 14902;
/** 14 days, the reference's own literal in both `buildFileId` and `ApplyUpload`. */
const FLASH_FILE_TTL = 1_209_600;

/**
 * `FlashTransferApi.buildFileId` — the protobuf-encoded, base64url `fileId`.
 *
 * `appid` decides which slot the fileId lands in: 14901 is the main file (it must be
 * this, or the server does not adopt the fileId into `0x93d4`'s `f14` and the peer
 * gets no download entry), 14903 png / 14902 jpg are the thumbnails.
 *
 * `sessionId` and `field15` are random and the server does not validate them, but
 * they are part of the byte layout, so they are not omitted.
 */
function buildFlashFileId(sha1: Uint8Array, fileSize: number, appid: number = FLASH_MAIN_APPID): string {
  const bytes = new ProtoWriter()
    .bytes(FLASH_FILE_ID_FIELD.sha1, new Uint8Array(sha1))
    .uint32(FLASH_FILE_ID_FIELD.fileSize, fileSize)
    .uint32(FLASH_FILE_ID_FIELD.appid, appid)
    .uint64(FLASH_FILE_ID_FIELD.timestamp, BigInt(Date.now()) * 1000n)
    .string(FLASH_FILE_ID_FIELD.env, "prod")
    .uint32(FLASH_FILE_ID_FIELD.ttl, FLASH_FILE_TTL)
    .bytes(FLASH_FILE_ID_FIELD.sessionId, new Uint8Array(randomBytes(16)))
    .bytes(FLASH_FILE_ID_FIELD.field15, new Uint8Array(randomBytes(3)))
    .string(FLASH_FILE_ID_FIELD.region, "gz")
    .finish();
  return Buffer.from(bytes).toString("base64url");
}

// ---------------------------------------------------------------------------
// The `sliceupload` POST — a hand-rolled codec, not an OIDB command
// ---------------------------------------------------------------------------
//
// `multimedia.qfile.qq.com/sliceupload` is a plain HTTPS POST whose body is a
// protobuf message. It is not an OIDB call, so there is no spec for it in
// `oidb/services/`; the two codecs live here, next to their only caller.
//
// Field numbers are the reference's generated tags (`__write_FlashSliceUploadBody`
// / `__write_FlashSlicePayload` / `__write_FlashSha1StateV`, reference:106944-107340).
// The payload sits at field **107**, not 16: 218/6 is a two-byte tag varint
// (`0xDA 0x06` = 858) whose field is `858 >>> 3 === 107`.

const FLASH_SLICE_BODY_FIELD = { field1: 1, appid: 2, field3: 3, payload: 107 } as const;
const FLASH_SLICE_PAYLOAD_FIELD = {
  field1: 1,
  rkey: 2,
  start: 3,
  end: 4,
  sha1: 5,
  sha1StateV: 6,
  chunk: 7,
} as const;
const FLASH_SHA1_STATE_V_FIELD = { state: 1 } as const;
/** `FlashSliceUploadResp` — `5 status` (tag 42). */
const FLASH_SLICE_RESP_FIELD = { status: 5 } as const;

/**
 * Encode one `sliceupload` request body.
 *
 * `field1: 0` and `field3: 2` are emitted even though they are 0 / nonzero-consonant
 * — the reference's generated writer uses `!= null` for both, so `field1` is present
 * as an explicit zero. `payload.field1` is an EMPTY message (`10 00`), which is
 * structural, not a placeholder.
 */
function encodeFlashSliceBody(params: {
  appid: number;
  rkey: string;
  start: number;
  end: number;
  sha1: Uint8Array;
  sha1StateV: readonly Uint8Array[];
  chunk: Uint8Array;
}): Uint8Array {
  const payload = new ProtoWriter()
    .message(FLASH_SLICE_PAYLOAD_FIELD.field1, new Uint8Array(0))
    .string(FLASH_SLICE_PAYLOAD_FIELD.rkey, params.rkey)
    .uint32Present(FLASH_SLICE_PAYLOAD_FIELD.start, params.start)
    .uint32Present(FLASH_SLICE_PAYLOAD_FIELD.end, params.end)
    .bytes(FLASH_SLICE_PAYLOAD_FIELD.sha1, params.sha1)
    .message(
      FLASH_SLICE_PAYLOAD_FIELD.sha1StateV,
      new ProtoWriter()
        .repeatedMessage(
          FLASH_SHA1_STATE_V_FIELD.state,
          params.sha1StateV.map((state) => new Uint8Array(state)),
        )
        .finish(),
    )
    .bytes(FLASH_SLICE_PAYLOAD_FIELD.chunk, params.chunk)
    .finish();
  return new ProtoWriter()
    .uint32Present(FLASH_SLICE_BODY_FIELD.field1, 0)
    .uint32(FLASH_SLICE_BODY_FIELD.appid, params.appid)
    .uint32Present(FLASH_SLICE_BODY_FIELD.field3, 2)
    .message(FLASH_SLICE_BODY_FIELD.payload, payload)
    .finish();
}

/** `status` out of a `sliceupload` response, or `null` when the field is absent. */
function decodeFlashSliceStatus(data: Uint8Array): string | null {
  const reader = new ProtoReader(data);
  let status: string | null = null;
  while (reader.next()) {
    if (reader.tag === tagOf(FLASH_SLICE_RESP_FIELD.status, WireType.lengthDelimited)) status = reader.string();
    else reader.skip();
  }
  return status;
}

// ---------------------------------------------------------------------------
// The placeholder thumbnails
// ---------------------------------------------------------------------------
//
// A fileset uploaded by a bot has no real cover image, and the server only fills the
// main-file download entry once a thumbnail is associated with the fileset. So two
// tiny random solid-colour PNGs are uploaded — png at `filesetIndex n+1`, jpg at
// `n+2` — purely so `download_fileset` can resolve the main file.
//
// Random colour is deliberate: a fixed colour would hash identically every time and
// the server would answer "already uploaded" (秒传) with no rkey, leaving the
// thumbnail slot registered but empty.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: big-endian length, ASCII type, data, CRC32 over type+data. */
function pngChunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, Buffer.from(data)])), 0);
  return Buffer.concat([len, typeBuf, Buffer.from(data), crc]);
}

/** `generatePng` (reference:107687) — a random solid-colour 8-bit RGB PNG. */
function generatePng(width: number, height: number): Buffer {
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);
  const rowLen = 1 + width * 3;
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    const off = y * rowLen;
    // Filter type 0 (None) for every scanline.
    raw[off] = 0;
    for (let x = 0; x < width; x++) {
      raw[off + 1 + x * 3] = r;
      raw[off + 1 + x * 3 + 1] = g;
      raw[off + 1 + x * 3 + 2] = b;
    }
  }
  const compressed = deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", compressed), pngChunk("IEND", Buffer.alloc(0))]);
}

/**
 * `resolveSelfUid` — reference/index.mjs:82652.
 *
 * A fifth copy of this six-line function (`apis/message.ts`, `apis/group-file.ts`
 * and `apis/forward.ts` each keep a private one). Not imported for the same reason
 * those are not: their parameter types are the respective slice's context, and
 * hoisting this into `context.ts` would make a bridge helper part of the layer
 * contract. The `ApplyFileset` uploader block needs it, so this slice carries its own.
 */
async function resolveSelfUid(ctx: BridgeContext): Promise<string> {
  const cached = ctx.identity.selfUid;
  if (typeof cached === "string" && cached.length > 0) return cached;
  const selfUin = Number(ctx.identity.uin);
  if (!Number.isFinite(selfUin) || selfUin <= 0) throw new Error("self uid is unavailable");
  return ctx.resolveUserUid(selfUin);
}

// ---------------------------------------------------------------------------
// The staged file, as the uploader carries it between phases
// ---------------------------------------------------------------------------

/**
 * One staged file — the reference's anonymous `items[]` element, given a name.
 *
 * `guardStat` is the `stat` taken at staging time. `assertUnchanged` compares it
 * before the hash pass and again before each slice upload, so a file edited mid-flight
 * is rejected instead of being published under a sha1 that no longer describes it.
 *
 * `cleanup` is idempotent (`stageSourceToDisk` guarantees it) and is called from the
 * `finally`, exactly once per item.
 */
interface FlashUploadItem {
  filePath: string;
  fileSize: number;
  fileName: string;
  fileUuid: string;
  /** 1-based position in the fileset. Both commit's field 6 and prepare/apply use it. */
  fileIndex: number;
  formatCode: number;
  guardStat: { size: number; mtimeMs: number };
  cleanup: () => Promise<void>;
}

/** What `#prepareAndApply` hands to `#sliceuploadFile`. `null` means "no upload needed". */
interface FlashUploadPlan {
  rkey: string;
  sha1StateV: Uint8Array[];
  sliceCount: number;
}

// ===========================================================================
// The API
// ===========================================================================

export class FlashTransferApi {
  readonly #ctx: BridgeContext;

  constructor(ctx: BridgeContext) {
    this.#ctx = ctx;
  }

  /** 获取文件集信息（`get_fileset_info`）— `0x93d3_1`. */
  async getFilesetInfo(filesetUuid: string): Promise<FlashFileInfo[]> {
    return (await getFilesetDetailCall.invoke(this.#ctx, { filesetUuid })).map(entryToInfo);
  }

  /**
   * 获取闪传文件列表（`get_flash_file_list`）.
   *
   * The SAME command as `getFilesetInfo` — `0x93d3` already answers a `repeated`
   * entry list, so "list this fileset's files" and "get this fileset's info" are one
   * request. Kept as a separate member because the two actions have different
   * response schemas (`{fileset_id, file_list}` vs a bare array) and a caller reading
   * `getFlashFileList` should not have to know it aliases the other.
   */
  async getFlashFileList(filesetUuid: string): Promise<FlashFileInfo[]> {
    return this.getFilesetInfo(filesetUuid);
  }

  /**
   * 拿指定文件的下载直链 + 元信息.
   *
   * Two hops, in this order:
   *   1. `0x93d4_1` — one row per file in the fileset; select by `fileIndex`
   *      (default 1, i.e. the first file). The row's `fileId` is what `0x12a9`
   *      needs; its `downloadUrl` is a THUMBNAIL and is not used.
   *   2. `0x12a9_200` — the main file's direct link.
   *
   * `fileId` may be absent for a few seconds after `create` (#364), so step 1 is
   * retried on `FLASH_FILE_ID_RETRY_DELAYS_MS`. Step 2 is never retried: once a
   * `fileId` exists the link is deterministic, and re-asking would open a second
   * download session.
   *
   * Answers `null` — not a throw — when the schedule is exhausted or the row is
   * missing. The two public wrappers turn that into their own distinct messages, so
   * the reason ("wrong index" vs "server never indexed it") survives to the action.
   */
  async getFileDownload(
    filesetUuid: string,
    fileIndex = 1,
  ): Promise<{ url: string; fileName: string; fileSize: number } | null> {
    for (let attempt = 0; ; attempt += 1) {
      const meta = (await getDownloadUrlCall.invoke(this.#ctx, { filesetUuid })).find(
        (row) => row.fileIndex === fileIndex,
      );
      if (meta?.fileId) {
        const url = await getFlashDownloadCall.invoke(this.#ctx, {
          filesetUuid: meta.filesetUuid,
          fileUuid: meta.fileUuid,
          fileId: meta.fileId,
          fileName: meta.fileName,
        });
        if (!url) return null;
        return { url, fileName: meta.fileName, fileSize: meta.fileSize };
      }
      const delay = FLASH_FILE_ID_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) return null;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  /**
   * 获取闪传文件下载链接（`get_flash_file_url`）.
   *
   * Returns the URL STRING, not a row — the action's `returnsSchema` is
   * `{url: string}`. Throws (rather than answering `""`) when there is no link, so a
   * caller never mistakes "no such file" for "empty URL".
   */
  async getFlashFileUrl(filesetUuid: string, fileIndex = 1): Promise<string> {
    const dl = await this.getFileDownload(filesetUuid, fileIndex);
    if (!dl || !dl.url) throw new Error("get_flash_file_url: no download url available");
    return dl.url;
  }

  /**
   * 解析闪传文件下载直链（`download_fileset`）.
   *
   * Resolves the URL and its metadata; it does NOT fetch the bytes. The action summary
   * says so explicitly — downloading here would block a worker for minutes per call and
   * the action has nowhere to put the content anyway.
   *
   * ⚠️ `opts.fileName` is accepted and IGNORED, exactly as in the reference: only
   * `fileIndex` selects a file. Wiring the name would change which file a
   * name-only caller receives.
   */
  async downloadFileset(
    filesetUuid: string,
    opts?: { fileName?: string | undefined; fileIndex?: number | undefined },
  ): Promise<{ url: string; fileName: string; fileSize: number }> {
    const dl = await this.getFileDownload(filesetUuid, opts?.fileIndex ?? 1);
    if (!dl || !dl.url) throw new Error("download_fileset: no download url available");
    return dl;
  }

  /**
   * 获取分享链接（`get_share_link`）— `qfile.qq.com/q/<code>`.
   *
   * Read out of `0x93d3`'s `uploadUrlWrap.uploadUrl`, which is the whole reason
   * `entryToInfo` maps it to `shareUrl`. Answers `""` (not a throw) when the fileset
   * has no share URL, matching the reference's `?? ""`.
   *
   * ⚠️ Returns a STRING. `ActionFlashTransferApi.getShareLink` used to declare
   * `Record<string, unknown>` here, which was a declaration defect — the reference's
   * `returnsSchema` is `{type: "string", description: "…不是含 url 字段的对象"}` and
   * `get_share_link` passes the value straight through. Corrected at the declaration.
   */
  async getShareLink(filesetUuid: string): Promise<string> {
    return (
      (await getFilesetDetailCall.invoke(this.#ctx, { filesetUuid })).find(
        (entry) => entry.uploadUrlWrap?.uploadUrl,
      )?.uploadUrlWrap?.uploadUrl ?? ""
    );
  }

  /**
   * 列出当前账号的所有 fileset（`list_filesets`）.
   *
   * `0x93d2_1` with the reference's pagination defaults (`field1: 3`, `field3: 10`),
   * which the spec supplies — so `{}` is the correct, complete parameter set here.
   *
   * Not a OneBot standard action; it exists because the QQ panel has the entry.
   */
  async listFilesets(): Promise<FlashFileInfo[]> {
    return (await listFilesetsCall.invoke(this.#ctx, {})).map(entryToInfo);
  }

  /** 删除闪传文件（`delete_flash_file`）— `0x9407_1`. The response carries nothing. */
  async deleteFlashFile(filesetUuid: string): Promise<void> {
    await deleteFlashFileCall.invoke(this.#ctx, { filesetUuid });
  }

  /**
   * 重命名闪传文件（`rename_flash_file`）— `0x9427` **sub 0**, `uinForm: true`.
   *
   * Both the display name and the "new name" get the same value: `0x9427` carries two
   * name slots and the reference fills both from one argument.
   */
  async renameFlashFile(filesetUuid: string, newName: string): Promise<void> {
    await renameFlashFileCall.invoke(this.#ctx, { filesetUuid, newName });
  }

  /**
   * 发送闪传文件（`send_flash_msg`）— `0x93d7_1`.
   *
   * Group target: `group_id` goes on the wire directly (it is already the group's id).
   * Private target: `user_id` is a UIN and must be resolved to a UID first, which is
   * why this method is `async` while the others are one-liners. `groupId` wins when
   * both are supplied — the reference tests `groupId` first, so a stray `userId` is
   * silently ignored rather than rejected (reproduced; see the spec's comment).
   *
   * `0x93d7`'s response carries no `message_id` — it shares a fileset into the chat
   * rather than creating a message — so the action answers a literal `0`. A caller
   * must not treat that `0` as a real id.
   */
  async sendFlashMsg(
    filesetUuid: string,
    target: { userId?: number | undefined; groupId?: number | undefined },
  ): Promise<void> {
    if (target.groupId) {
      await sendFlashMsgCall.invoke(this.#ctx, { groupId: target.groupId, filesetUuid });
      return;
    }
    const userId = target.userId;
    if (!userId) throw new Error("send_flash_msg: user_id or group_id is required");
    const targetUid = await this.#ctx.identity.resolveUid(userId);
    await sendFlashMsgCall.invoke(this.#ctx, { targetUid, filesetUuid });
  }

  /**
   * 从分享码/链接获取 `fileset_id`（`get_fileset_id`）.
   *
   * NOT an OIDB call: see the block comment above `officialQfileShareUrl`. The
   * `fileset_id` is scraped out of the share page's embedded JSON.
   *
   * `redirect: "manual"` and the 3xx check are both required — `redirect: "manual"`
   * alone yields an opaque response whose `ok` is `false` and whose body cannot be
   * read, so the explicit range check is what turns that into a named error instead of
   * "fileset_id not found".
   */
  async getFilesetIdByCode(shareCode: string): Promise<string> {
    const url = officialQfileShareUrl(shareCode);
    let resp: Response;
    try {
      resp = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(QFILE_SHARE_TIMEOUT_MS),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw new Error("get_fileset_id: share page request timed out", { cause: error });
      }
      throw error;
    }
    if (resp.status >= 300 && resp.status < 400) {
      await rejectShareResponse(resp, new Error("get_fileset_id: share page redirect is not allowed"));
    }
    if (!resp.ok) await rejectShareResponse(resp, new Error(`get_fileset_id: HTTP ${resp.status}`));
    const html = await readSharePage(resp);
    const m = FLASH_SHARE_FILESET_ID.exec(html);
    if (!m || m[1] === undefined) throw new Error("get_fileset_id: fileset_id not found in share page");
    return m[1];
  }

  /**
   * 文件扩展名 → 闪传类型码.
   *
   * Two DIFFERENT numbers for two different commands — see the header. `typeCode` is the
   * card's coarse class (`0x93cf` field 3), `formatCode` the peer's icon (`0x93d0`
   * field 7 / `0x12a9` `filesetWrap.field7`).
   *
   * Static because the uploader needs it too (`createFlashTask` derives `formatCode`
   * per file and `typeCode` for the fileset as a whole), and a static keeps the table in
   * one place instead of forcing an instance just to read a constant.
   */
  static fileTypeCode(fileName: string): { typeCode: number; formatCode: number } {
    const ext = /\.([^.]+)$/.exec(fileName.toLowerCase())?.[1] ?? "";
    return { typeCode: flashApplyTypeCode(ext), formatCode: flashFormatCode(ext) };
  }

  /**
   * 创建闪传任务（`create_flash_task`）— the uploader half.
   *
   * Reference: `reference/index.mjs:107905-108010`, plus `prepareAndApply`,
   * `sliceuploadFile`, `postSliceupload` and `uploadThumbnail` immediately after it.
   * See the header for the five phases and why the order is load-bearing.
   *
   * `_thumbPath` is accepted and IGNORED — in the reference it is an unused third
   * parameter (`_thumbPath`), and the two thumbnails are always generated
   * placeholders. Wiring a caller-supplied image would change the fileset's cover.
   *
   * ⚠️ Cleanup is in a `finally`, and it runs on EVERY exit path, including a success.
   * `items` only ever holds files that were staged successfully, and the empty-file
   * rejection happens AFTER the push so that throw cleans up too. Two narrow leaks
   * remain, both inherited from the reference and both reported rather than "fixed"
   * (changing them would make failure behaviour differ from the reference):
   *   1. if `fsPromises.stat` (the `guardStat`) rejects, the object literal has not
   *      been pushed yet, so that one staged file is never unlinked;
   *   2. if `stageSourceToDisk` itself rejects, nothing was staged, so there is
   *      nothing to clean (not a leak).
   */
  async createFlashTask(
    files: readonly ({ file: string; name?: string | undefined } | string)[],
    name?: string | undefined,
    _thumbPath?: string | undefined,
  ): Promise<{ filesetId: string }> {
    const fileList = normalizeFlashTaskInputs(files);
    if (fileList.length === 0) throw new Error("create_flash_task: files is empty");
    const uploader = {
      uin: this.#ctx.identity.uin,
      nickname: this.#ctx.identity.nickname,
      uid: await resolveSelfUid(this.#ctx),
    };
    const items: FlashUploadItem[] = [];
    try {
      // ---- phase 1: stage, name, per-file formatCode, guard stat ----------------
      for (let i = 0; i < fileList.length; i++) {
        const source = fileList[i]?.file;
        if (!source) throw new Error("create_flash_task: files is empty");
        const staged = await stageSourceToDisk(source, flashStageMaxBytes(source));
        const fileName = flashFileDisplayName(fileList[i]?.name, staged.fileName);
        // Per-FILE call: `.formatCode` only (the peer's icon). `typeCode` is not used
        // here — see phase 2.
        const { formatCode } = FlashTransferApi.fileTypeCode(fileName);
        items.push({
          filePath: staged.filePath,
          fileSize: staged.fileSize,
          fileName,
          fileUuid: randomUUID(),
          fileIndex: i + 1, // 1-based: prepare/apply must agree with commit's field 6.
          formatCode,
          guardStat: await fsPromises.stat(staged.filePath),
          cleanup: () => staged.cleanup(),
        });
        // After the push, so the `finally` still removes the staged file.
        if (staged.fileSize === 0) throw new Error("create_flash_task: file is empty");
      }

      // ---- phase 2: ApplyFileset — the CARD, one call for the whole fileset ------
      const first = items[0]!;
      // Fileset-level call: `.typeCode` only, from the FIRST file. A multi-file set of
      // mixed types still takes its card class from file 1; that is the reference's
      // choice, not an oversight this port may improve on.
      const { typeCode } = FlashTransferApi.fileTypeCode(first.fileName);
      const isMulti = items.length > 1;
      const filesetName =
        name?.trim() || (isMulti ? `${first.fileName}等${items.length}个文件` : first.fileName);
      const totalSize = items.reduce((sum, item) => sum + item.fileSize, 0);
      const filesetUuid = (
        await applyFilesetCall.invoke(this.#ctx, {
          fileName: filesetName,
          origName: filesetName,
          fileSize: totalSize,
          typeCode,
          uploader,
        })
      ).filesetUuid;
      if (!filesetUuid) throw new Error("apply fileset failed: missing uuid");

      // ---- phase 3: CommitFile — ALL entries, ONE request, before any upload ----
      await commitFileCall.invoke(this.#ctx, {
        filesetUuid,
        entries: items.map((item) => ({
          fileUuid: item.fileUuid,
          fileName: item.fileName,
          origName: item.fileName,
          fileSize: item.fileSize,
          formatCode: item.formatCode,
          fileIndex: item.fileIndex,
        })),
      });

      // ---- phase 4: CompleteFileset — still before uploading -------------------
      await completeFilesetCall.invoke(this.#ctx, { filesetUuid });

      // ---- phase 5a: prepare + apply every file, then upload every file --------
      // Two loops, not one: the reference finishes ALL prepares before the first
      // sliceupload. Reproduced as-is — interleaving would change the request order.
      const prepared: { item: FlashUploadItem; plan: FlashUploadPlan }[] = [];
      for (const item of items) {
        const plan = await this.#prepareAndApply(filesetUuid, item);
        if (plan) prepared.push({ item, plan });
      }
      for (const { item, plan } of prepared) {
        await assertUnchanged(item.filePath, item.guardStat);
        await this.#sliceuploadFile(item, plan);
      }

      // ---- phase 5b: two placeholder thumbnails, then publish ------------------
      await this.#uploadThumbnail(filesetUuid, items[0]!.fileUuid, "png", items.length + 1);
      await this.#uploadThumbnail(filesetUuid, items[0]!.fileUuid, "jpg", items.length + 2);
      await setFilesetStatusCall.invoke(this.#ctx, { filesetUuid });
      return { filesetId: filesetUuid };
    } finally {
      await Promise.all(items.map((item) => item.cleanup()));
    }
  }

  /**
   * Phase 5a, per file: streaming hash + prepare (rkey) + apply (registers the fileId).
   *
   * ⚠️ A `null` return means "skip the slice upload", NOT "skip apply". On a 秒传 hit
   * the server answers no rkey, and apply must STILL be called — without it the file
   * stays registered in the fileset but never becomes ready, and the fileset hangs at
   * "waiting to upload".
   *
   * `assertUnchanged` runs before AND (in the caller) after this, so a source edited
   * between hashing and uploading is caught rather than producing a fileset whose
   * reported sha1 does not match its bytes.
   */
  async #prepareAndApply(
    filesetUuid: string,
    item: FlashUploadItem,
  ): Promise<FlashUploadPlan | null> {
    const hashes = await hashFlashFileStreaming(item.filePath);
    await assertUnchanged(item.filePath, item.guardStat);
    const rkey = await prepareUploadCall.invoke(this.#ctx, {
      filesetUuid,
      fileUuid: item.fileUuid,
      fileName: item.fileName,
      fileSize: item.fileSize,
      sha1: hashes.sha1Hex,
      fileIndex: item.fileIndex,
      formatCode: item.formatCode,
    });
    const fileId = buildFlashFileId(hashes.sha1, item.fileSize);
    await applyUploadCall.invoke(this.#ctx, {
      filesetUuid,
      fileUuid: item.fileUuid,
      fileId,
      fileName: item.fileName,
      fileSize: item.fileSize,
      md5: hashes.md5Hex,
      sha1: hashes.sha1Hex,
      fileIndex: item.fileIndex,
      formatCode: item.formatCode,
    });
    if (rkey === null) return null;
    return { rkey, sha1StateV: hashes.sha1StateV, sliceCount: hashes.sliceCount };
  }

  /**
   * Phase 5a, the bytes: one `sliceupload` POST per 1 MiB slice, read from disk.
   *
   * The whole file is never in memory — `FileChunkSource.read` takes one slice at a
   * time, and the per-slice sha1 is computed on that slice alone.
   */
  async #sliceuploadFile(item: FlashUploadItem, plan: FlashUploadPlan): Promise<void> {
    const source = await FileChunkSource.open(item.filePath);
    try {
      for (let i = 0; i < plan.sliceCount; i++) {
        const start = i * FLASH_SLICE_SIZE;
        const chunkLength = Math.min(FLASH_SLICE_SIZE, item.fileSize - start);
        const chunk = await source.read(start, chunkLength);
        const chunkSha1 = new Uint8Array(createHash("sha1").update(Buffer.from(chunk)).digest());
        const body = encodeFlashSliceBody({
          appid: FLASH_MAIN_APPID,
          rkey: plan.rkey,
          start,
          end: start + chunkLength - 1,
          sha1: chunkSha1,
          sha1StateV: plan.sha1StateV,
          chunk,
        });
        await this.#postSliceupload(body, `${item.fileName} slice ${i}`);
      }
    } finally {
      await source.close();
    }
  }

  /**
   * POST one `sliceupload` body and validate the BUSINESS status.
   *
   * ⚠️ HTTP 200 is not success. The response carries `5 status` as text, and anything
   * other than `"success"` is a failure that a status-code check alone would miss —
   * which would turn a rejected slice into a fileset that silently never completes.
   * `label` names the slice so a failure identifies which file/chunk produced it.
   */
  async #postSliceupload(body: Uint8Array, label: string): Promise<void> {
    const resp = await fetch("https://multimedia.qfile.qq.com/sliceupload", {
      method: "POST",
      // Copy into a fresh `ArrayBuffer`-backed view: `BodyInit` rejects the wider
      // `Uint8Array<ArrayBufferLike>` a `ProtoWriter` hands back. The copy is one
      // megabyte at most and the POST would buffer it anyway.
      body: new Uint8Array(body),
      headers: {
        Accept: "*/*",
        Connection: "Keep-Alive",
        "User-Agent": "Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2)",
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
        "Content-Length": String(body.length),
        "X-Retried-Times": "1",
      },
    });
    if (!resp.ok) {
      const errorBody = await resp.text().catch(() => "");
      throw new Error(`${label} failed: HTTP ${resp.status} ${errorBody.slice(0, 300)}`);
    }
    const status = decodeFlashSliceStatus(new Uint8Array(await resp.arrayBuffer()));
    if (status !== "success") {
      throw new Error(`${label} failed: ${status || "no status in response"}`);
    }
  }

  /**
   * Upload one generated placeholder thumbnail (png or jpg slot).
   *
   * Called after the main files uploaded, and it matters: `0x93d3`'s download entry
   * for the main file is only populated once a thumbnail is associated, so without
   * this a bot-created fileset cannot be resolved by `download_fileset`.
   *
   * The png gets a fresh `fileUuid` and the jpg REUSES the main file's uuid; the png
   * also gets a random `<8 hex>_one.png` name while the jpg is named after its own
   * md5. Both quirks are the reference's and are reproduced.
   *
   * `fileIndex` is the thumbnail's slot in the fileset — `n+1` for png, `n+2` for jpg
   * — which must line up with the commit's field 6 numbering.
   */
  async #uploadThumbnail(
    filesetUuid: string,
    mainFileUuid: string,
    thumbType: "jpg" | "png",
    fileIndex: number,
  ): Promise<void> {
    const width = 526;
    const height = 360;
    const thumbBytes = generatePng(width, height);
    const appid = thumbType === "png" ? FLASH_PNG_APPID : FLASH_JPG_APPID;
    const fileUuid = thumbType === "png" ? randomUUID() : mainFileUuid;
    const fileName =
      thumbType === "png"
        ? `${randomUUID().slice(0, 8)}_one.png`
        : `${createHash("md5").update(thumbBytes).digest("hex").slice(0, 32)}.jpg`;
    const hashes = computeHashes(new Uint8Array(thumbBytes));
    const fileSize = thumbBytes.length;
    // 26 = png, 2 = jpg: the icon codes for the two thumbnail formats.
    const thumbFormatCode = thumbType === "png" ? 26 : 2;
    const rkey = await prepareUploadCall.invoke(this.#ctx, {
      filesetUuid,
      fileUuid,
      fileName,
      fileSize,
      sha1: hashes.sha1Hex,
      fileIndex,
      formatCode: thumbFormatCode,
      thumbType,
      width,
      height,
    });
    const fileId = buildFlashFileId(hashes.sha1, fileSize, appid);
    await applyUploadCall.invoke(this.#ctx, {
      filesetUuid,
      fileUuid,
      fileId,
      fileName,
      fileSize,
      md5: hashes.md5Hex,
      sha1: hashes.sha1Hex,
      fileIndex,
      formatCode: thumbFormatCode,
      thumbType,
      width,
      height,
    });
    if (rkey === null) return;
    const body = encodeFlashSliceBody({
      appid,
      rkey,
      start: 0,
      end: fileSize - 1,
      sha1: new Uint8Array(hashes.sha1),
      sha1StateV: computeSha1StateV(new Uint8Array(thumbBytes), 1, fileSize),
      chunk: new Uint8Array(thumbBytes),
    });
    await this.#postSliceupload(body, "thumbnail sliceupload");
  }
}
