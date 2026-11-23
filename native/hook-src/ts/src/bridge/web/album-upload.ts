// The group-album upload half — `../protocol/src/web/group-album.ts`.
//
// ---------------------------------------------------------------------------
// This is the only cookie-backed part of `apis/group-album.ts`
// ---------------------------------------------------------------------------
// The six packet operations in `apis/group-album.ts` ride `ctx.sendRawPacket`.
// These two uploads are the opposite: an HTTPS batch-control CGI that mints a
// session, then a slice-by-slice `multipart/form-data` POST per 16 KiB chunk.
// They are reached through `apis.web.getCookies("qzone.qq.com")` and never touch
// the packet channel.
//
// Reference region: ../protocol/src/web/group-album.ts (reference/index.mjs:234338,
// 412 lines). All four endpoints are reproduced byte-for-byte:
//
//   POST https://h5.qzone.qq.com/webapp/json/sliceUpload/FileBatchControl/<checksum>?g_tk=<bkn>
//   POST https://h5.qzone.qq.com/webapp/json/sliceUpload/FileUpload?seq=..&retry=0&offset=..&end=..&total=..&type=form&g_tk=..
//   POST https://h5.qzone.qq.com/webapp/json/sliceUpload/FileUploadVideo?…    (same query shape)
//
// ---------------------------------------------------------------------------
// `slice_size` is the CHUNK's length, not the session's
// ---------------------------------------------------------------------------
// In `uploadAlbumSlice` (the image path) the form field `slice_size` is the
// constant 16384 while `end` is `min(offset + chunk.length, img_size)` — a last
// chunk shorter than the window therefore lies about its own size in one field.
// In `uploadAlbumFileSlices` (the video/cover path) the same field is
// `String(chunkBytes.length)` and `end` is `offset + chunkBytes.length`. The two
// are NOT the same function and were not unified here: the image path runs a
// `createReadStream` loop of fixed 16 KiB windows, so its `slice_size` is
// constant by construction, while the video path takes the session's own
// `slice_size` and can therefore see a short tail.
//
// ---------------------------------------------------------------------------
// Three size/shape gates before a single byte is uploaded
// ---------------------------------------------------------------------------
// 1. Images: `detectImageFormat` must not say "unknown" unless the bytes are
//    actually JPEG SOI. The check is `format === 1000 && !isJpeg` — i.e. the
//    fallback format value plus a magic-number recheck, NOT `format === 1000`.
// 2. Videos: exactly 16 header bytes are read, and the upload is rejected when
//    the head looks like a known IMAGE *or* does not look like ISO BMFF
//    (`ftyp` at offset 4). A renamed `.mp4` that is really a PNG is caught here.
// 3. Both: the whole source is materialised before anything is sent, because
//    `imgMd5`/`sha1Hex` are in the URL path and the query string.
//
// ---------------------------------------------------------------------------
// `now()` is injected, and the reference's own reason is the audit trail
// ---------------------------------------------------------------------------
// `iBatchID` on the video session and `iUploadTime` on the cover session come
// from the same `videoTimestamp` (seconds), while `iUploadTime` of the video is
// `videoTimestamp` and of the cover is a SECOND `now()` call. So a caller that
// supplies a clock gets two distinct stamps back-to-back; one that does not gets
// two calls to `Date.now()` that may or may not differ. Both are faithful.
//
// Reference: reference/index.mjs:234338 (`createAlbumUploadSession`,
// `uploadAlbumSlice`, `uploadImageToGroupAlbum`), 234489 (`stageSourceToDisk`
// helpers), 234560 (`uploadAlbumFileSlices`), 234591
// (`uploadVideoToGroupAlbum`).

import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { createLogger } from "../../onebot/log.js";
import { loadBinarySource, resolveLocalFilePath } from "../web/binary-source.js";
import { RequestUtil, getBknFromCookie } from "../web/request-util.js";

const log = createLogger("Bridge.GroupAlbum.Upload");

/** `ALBUM_VIDEO_MAX_BYTES` — the same ceiling as the highway video upload. */
export const ALBUM_VIDEO_MAX_BYTES = 1536 * 1024 * 1024;

/** `DEFAULT_ALBUM_SLICE_SIZE`; the server may override it per session. */
export const DEFAULT_ALBUM_SLICE_SIZE = 16384;

/** `detectImageFormat`'s "did not recognise this" value. */
export const UNKNOWN_IMAGE_FORMAT = 1000;

// ===========================================================================
// Image sniffing
// ===========================================================================

/** One recognised image format: the reference's numeric id plus its pixel size. */
export interface ImageFormat {
  format: number;
  width: number;
  height: number;
}

function readBE16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readBE32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function readLE16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readLE32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function readLE24(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

/**
 * `detectImageFormat` — magic-number sniffing for PNG, GIF, BMP, WebP and JPEG.
 *
 * The JPEG branch is a SOF marker walk rather than a fixed offset: the SOF
 * segment the dimensions live in sits after a variable number of APPn/COM
 * segments, so a JPEG with EXIF does not have its size where a bare one does.
 * A SOF segment with `segLen < 2` or one that runs past the buffer ends the
 * walk and yields `{format: 1000, 0, 0}` — the caller then re-checks the SOI
 * magic (`255 216`) and accepts it anyway, which is why a truncated JPEG still
 * uploads.
 *
 * Reference: reference/index.mjs:18192.
 */
export function detectImageFormat(bytes: Uint8Array): ImageFormat {
  if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
    return { format: 1001, width: readBE32(bytes, 16), height: readBE32(bytes, 20) };
  }
  if (
    bytes.length >= 10 &&
    bytes[0] === 71 &&
    bytes[1] === 73 &&
    bytes[2] === 70 &&
    bytes[3] === 56 &&
    (bytes[4] === 55 || bytes[4] === 57) &&
    bytes[5] === 97
  ) {
    return { format: 2000, width: readLE16(bytes, 6), height: readLE16(bytes, 8) };
  }
  if (bytes.length >= 26 && bytes[0] === 66 && bytes[1] === 77) {
    return { format: 1005, width: readLE32(bytes, 18), height: readLE32(bytes, 22) };
  }
  if (
    bytes.length >= 30 &&
    bytes[0] === 82 &&
    bytes[1] === 73 &&
    bytes[2] === 70 &&
    bytes[3] === 70 &&
    bytes[8] === 87 &&
    bytes[9] === 69 &&
    bytes[10] === 66 &&
    bytes[11] === 80
  ) {
    if (bytes[12] === 86 && bytes[13] === 80 && bytes[14] === 56 && bytes[15] === 32) {
      return { format: 1002, width: readLE16(bytes, 26), height: readLE16(bytes, 28) };
    }
    if (bytes[12] === 86 && bytes[13] === 80 && bytes[14] === 56 && bytes[15] === 76) {
      const bits = readLE32(bytes, 21);
      return { format: 1002, width: (bits & 16383) + 1, height: ((bits >> 14) & 16383) + 1 };
    }
    if (bytes[12] === 86 && bytes[13] === 80 && bytes[14] === 56 && bytes[15] === 88) {
      return { format: 1002, width: readLE24(bytes, 24) + 1, height: readLE24(bytes, 27) + 1 };
    }
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 9 <= bytes.length) {
      if (bytes[offset] !== 255) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      if (marker === 216 || marker === 217) {
        offset += 2;
        continue;
      }
      if (offset + 4 > bytes.length) break;
      const segLen = readBE16(bytes, offset + 2);
      if (segLen < 2 || offset + 2 + segLen > bytes.length) break;
      if (
        marker >= 192 &&
        marker <= 207 &&
        marker !== 196 &&
        marker !== 200 &&
        marker !== 204 &&
        segLen >= 7 &&
        offset + 9 <= bytes.length
      ) {
        return { format: 1000, width: readBE16(bytes, offset + 7), height: readBE16(bytes, offset + 5) };
      }
      offset += 2 + segLen;
    }
    return { format: 1000, width: 0, height: 0 };
  }
  return { format: 1000, width: 0, height: 0 };
}

/** `isKnownImageHead` — the first 16 bytes look like one of the five formats. */
export function isKnownImageHead(bytes: Uint8Array): boolean {
  if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 216) return true;
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return true;
  if (bytes.length >= 6 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 56) return true;
  if (bytes.length >= 2 && bytes[0] === 66 && bytes[1] === 77) return true;
  return (
    bytes.length >= 12 &&
    bytes[0] === 82 &&
    bytes[1] === 73 &&
    bytes[2] === 70 &&
    bytes[3] === 70 &&
    bytes[8] === 87 &&
    bytes[9] === 69 &&
    bytes[10] === 66 &&
    bytes[11] === 80
  );
}

/** `isIsoBmffHead` — `ftyp` at offset 4, i.e. an MP4/MOV container. */
export function isIsoBmffHead(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[4] === 102 && bytes[5] === 116 && bytes[6] === 121 && bytes[7] === 112;
}

/** `readFileHead` — the first `size` bytes, or fewer at EOF. */
export function readFileHead(filePath: string, size: number): Uint8Array {
  const full = readFileSync(filePath);
  return full.subarray(0, Math.min(size, full.length));
}

// ===========================================================================
// Session + slice upload
// ===========================================================================

/** `albumUploadCookie` — note `uin` gets an `o` prefix twice, and p_skey is not. */
export function albumUploadCookie(uin: string, skey: string, pskey: string): string {
  return `p_uin=o${uin}; p_skey=${pskey}; skey=${skey}; uin=o${uin}`;
}

/**
 * `albumUploadGtk` — the bkn computed from `pskey` FIRST, then `skey`.
 *
 * `getBknFromCookie` already prefers `p_skey`, so passing both here matches the
 * six CGI helpers in `web/qzone.ts` — but this call site constructs the jar
 * explicitly instead of forwarding the whole cookie object, which is the only
 * reason the precedence is visible at all.
 */
export function albumUploadGtk(skey: string, pskey: string): string {
  return getBknFromCookie({ p_skey: pskey, skey });
}

/** `normalizeAlbumSliceSize` — a missing or non-positive override means the default. */
export function normalizeAlbumSliceSize(sliceSize: number | undefined | null): number {
  return sliceSize && sliceSize > 0 ? sliceSize : DEFAULT_ALBUM_SLICE_SIZE;
}

/** One `biz_req` the batch-control CGI accepts. The shape is per-CGI, not shared. */
export interface AlbumBizReq {
  sPicTitle: string;
  sPicDesc: string;
  sAlbumName: string;
  sAlbumID: string;
  iAlbumTypeID: number;
  iBitmap: number;
  iUploadType: number;
  iUpPicType: number;
  iBatchID: number;
  sPicPath: string;
  iPicWidth: number;
  iPicHight: number;
  iWaterType: number;
  iDistinctUse: number;
  [extra: string]: unknown;
}

/** The `control_req[0]` the batch-control CGI accepts. */
export interface AlbumControlReq {
  uin: string;
  token: { type: number; data: string; appid: number };
  appid: string;
  checksum: string;
  check_type: number;
  file_len: number;
  env: { refer: string; deviceInfo: string };
  model: number;
  biz_req: AlbumBizReq;
  session: string;
  asy_upload: number;
  cmd: string;
}

/** The session the batch-control CGI mints. */
export interface AlbumUploadSession {
  session: string;
  sliceSize: number;
  /** Echoed back for the audit trail; the reference returns it but never reads it. */
  timestamp: number;
}

/** One slice's answer, accumulated across the upload. */
export interface AlbumUploadBiz {
  vid?: string | undefined;
  photoId?: string | undefined;
  photoUrl?: string | undefined;
}

/**
 * `createAlbumMediaSession` — mint a slice-upload session.
 *
 * `ret !== 0` and a missing `session` are one check because a `ret: 0` with no
 * session is the shape an expired cookie produces, and reporting it as a
 * transport error would send the caller looking at the network.
 */
export async function createAlbumMediaSession(
  checksum: string,
  skey: string,
  pskey: string,
  uin: string,
  timestamp: number,
  controlReq: AlbumControlReq,
): Promise<AlbumUploadSession> {
  const api = `https://h5.qzone.qq.com/webapp/json/sliceUpload/FileBatchControl/${checksum}?g_tk=${albumUploadGtk(skey, pskey)}`;
  const response = (await RequestUtil.HttpGetJson(
    api,
    "POST",
    { control_req: [controlReq] },
    { Cookie: albumUploadCookie(uin, skey, pskey), "Content-Type": "application/json" },
  )) as { ret?: number; msg?: string; data?: { session?: string; slice_size?: number } };
  if (response.ret !== 0 || !response.data?.session) {
    throw new Error(`创建上传会话失败: ${response.msg ?? ""}`);
  }
  return {
    session: response.data.session,
    sliceSize: normalizeAlbumSliceSize(response.data.slice_size),
    timestamp,
  };
}

/** Everything one `FileUpload` / `FileUploadVideo` slice needs. */
export interface AlbumSliceUploadOptions {
  session: string;
  filePath: string;
  fileSize: number;
  sliceSize: number;
  appid: string;
  checkType: number;
  uploadCmd: string;
  skey: string;
  pskey: string;
  uin: string;
}

/**
 * `uploadAlbumFileSlices` — the video/cover slice loop.
 *
 * The completeness check at the end is `fileSize === 0 || offset !== fileSize`
 * and it is not redundant: a stream that ends early produces a `ret: 0` on every
 * slice it DID send, so without this the caller would treat a truncated video
 * as uploaded and then fail at the feed publish with no useful error.
 */
export async function uploadAlbumFileSlices(options: AlbumSliceUploadOptions): Promise<AlbumUploadBiz> {
  const { session, filePath, fileSize, sliceSize, appid, checkType, uploadCmd, skey, pskey, uin } = options;
  const bkn = albumUploadGtk(skey, pskey);
  const cookie = albumUploadCookie(uin, skey, pskey);
  const stream = createReadStream(filePath, { highWaterMark: sliceSize });
  let seq = 0;
  let offset = 0;
  let lastBiz: AlbumUploadBiz = {};
  for await (const chunk of stream) {
    const chunkBytes = chunk as Buffer;
    const end = offset + chunkBytes.length;
    const form = new FormData();
    form.append("uin", uin);
    form.append("appid", appid);
    form.append("session", session);
    form.append("offset", offset.toString());
    form.append("data", new Blob([asBlobPart(chunkBytes)], { type: "application/octet-stream" }), "blob");
    form.append("checksum", "");
    form.append("check_type", String(checkType));
    form.append("retry", "0");
    form.append("seq", seq.toString());
    form.append("end", end.toString());
    form.append("cmd", "FileUpload");
    form.append("slice_size", String(chunkBytes.length));
    const api = `https://h5.qzone.qq.com/webapp/json/sliceUpload/${uploadCmd}?seq=${seq}&retry=0&offset=${offset}&end=${end}&total=${fileSize}&type=form&g_tk=${bkn}`;
    const response = await fetch(api, { method: "POST", headers: { Cookie: cookie }, body: form });
    if (!response.ok) throw new Error(`HTTP error! status: ${String(response.status)}`);
    const post = (await response.json()) as {
      ret?: number;
      msg?: string;
      data?: { biz?: { sVid?: string; sPhotoID?: string; sBURL?: string } };
    };
    if (post.ret !== 0) throw new Error(`分片 ${String(seq)} 上传失败: ${post.msg ?? ""}`);
    lastBiz = {
      vid: post.data?.biz?.sVid || lastBiz.vid,
      photoId: post.data?.biz?.sPhotoID || lastBiz.photoId,
      photoUrl: post.data?.biz?.sBURL || lastBiz.photoUrl,
    };
    offset = end;
    seq += 1;
  }
  if (fileSize === 0 || offset !== fileSize) throw new Error("视频分片上传不完整");
  return lastBiz;
}

/**
 * `uploadAlbumSlice` — the IMAGE slice loop, which is a different function.
 *
 * Two divergences from the loop above, both kept: `slice_size` is the CONSTANT
 * 16384 (not the chunk length) and `end` is clamped to `img_size`; and the
 * request goes through `fetch` with a `Blob`, not through `RequestUtil`, because
 * `RequestUtil` has no multipart support. `biz_req.iUploadType` is the only
 * `biz_req.*` field in the multipart body.
 */
export async function uploadAlbumSlice(
  session: string,
  filePath: string,
  _imgMd5: string,
  skey: string,
  pskey: string,
  uin: string,
): Promise<void> {
  const imgSize = statSync(filePath).size;
  const sliceSize = 16384;
  const bkn = albumUploadGtk(skey, pskey);
  const cookie = albumUploadCookie(uin, skey, pskey);
  const stream = createReadStream(filePath, { highWaterMark: sliceSize });
  let seq = 0;
  let offset = 0;
  for await (const chunk of stream) {
    const end = Math.min(offset + chunk.length, imgSize);
    const form = new FormData();
    form.append("uin", uin);
    form.append("appid", "qun");
    form.append("session", session);
    form.append("offset", offset.toString());
    form.append("data", new Blob([asBlobPart(chunk)], { type: "application/octet-stream" }), "blob");
    form.append("checksum", "");
    form.append("check_type", "0");
    form.append("retry", "0");
    form.append("seq", seq.toString());
    form.append("end", end.toString());
    form.append("cmd", "FileUpload");
    form.append("slice_size", sliceSize.toString());
    form.append("biz_req.iUploadType", "0");
    const api = `https://h5.qzone.qq.com/webapp/json/sliceUpload/FileUpload?seq=${seq}&retry=0&offset=${offset}&end=${end}&total=${imgSize}&type=form&g_tk=${bkn}`;
    const response = await fetch(api, { method: "POST", headers: { Cookie: cookie }, body: form });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const post = (await response.json()) as { ret?: number; msg?: string };
    if (post.ret !== 0) throw new Error(`分片 ${String(seq)} 上传失败: ${post.msg ?? ""}`);
    offset += chunk.length;
    seq += 1;
  }
}

/** `createAlbumUploadSession` — the image session, whose `biz_req` differs from the video one. */
export async function createAlbumUploadSession(
  groupId: string,
  albumId: string,
  albumName: string,
  filePath: string,
  skey: string,
  pskey: string,
  imgMd5: string,
  uin: string,
  now: () => number = () => Math.floor(Date.now() / 1e3),
): Promise<string> {
  const imgSize = statSync(filePath).size;
  const imgName = basename(filePath);
  const timestamp = now();
  const session = await createAlbumMediaSession(imgMd5, skey, pskey, uin, timestamp, {
    uin,
    token: { type: 4, data: pskey, appid: 5 },
    appid: "qun",
    checksum: imgMd5,
    check_type: 0,
    file_len: imgSize,
    env: { refer: "qzone", deviceInfo: "h5" },
    model: 0,
    biz_req: {
      sPicTitle: imgName,
      sPicDesc: "",
      sAlbumName: albumName,
      sAlbumID: albumId,
      iAlbumTypeID: 0,
      iBitmap: 0,
      iUploadType: 0,
      iUpPicType: 0,
      iBatchID: timestamp,
      sPicPath: "",
      iPicWidth: 0,
      iPicHight: 0,
      iWaterType: 0,
      iDistinctUse: 0,
      iNeedFeeds: 1,
      iUploadTime: timestamp,
      mapExt: { appid: "qun", userid: groupId },
      stExtendInfo: { mapParams: { photo_num: "1", video_num: "0", batch_num: "1" } },
    },
    session: "",
    asy_upload: 0,
    cmd: "FileUpload",
  });
  return session.session;
}

/**
 * `uploadImageToGroupAlbum`.
 *
 * Remote and inline sources are staged to a temp file because the slice loop
 * needs a real path (`createReadStream`) — the bytes are already in memory, so
 * the staging is a `writeFileSync` plus a `finally` unlink rather than a
 * download. The temp name is `album_<ms>_<base36>.tmp` and the suffix is NOT
 * an image extension: the server takes the format from the bytes.
 */
export async function uploadImageToGroupAlbum(
  cookieObject: Record<string, string>,
  groupId: string,
  albumId: string,
  albumName: string,
  filePath: string,
  uin: string,
): Promise<void> {
  const loaded = await loadBinarySource(filePath, "album image");
  const format = detectImageFormat(loaded.bytes);
  const isJpeg = loaded.bytes.length >= 2 && loaded.bytes[0] === 255 && loaded.bytes[1] === 216;
  if (format.format === UNKNOWN_IMAGE_FORMAT && !isJpeg) {
    throw new Error("群相册上传仅支持 JPEG、PNG、GIF、WebP 或 BMP 图片");
  }
  let tempFile: string | null = null;
  let actualPath = filePath;
  if (/^(https?:\/\/|base64:\/\/)/i.test(filePath)) {
    tempFile = join(tmpdir(), `album_${String(Date.now())}_${Math.random().toString(36).slice(2)}.tmp`);
    writeFileSync(tempFile, loaded.bytes);
    actualPath = tempFile;
  }
  try {
    const imgMd5 = createHash("md5").update(loaded.bytes).digest("hex");
    const skey = cookieObject["skey"] || "";
    const pskey = cookieObject["p_skey"] || "";
    await uploadAlbumSlice(
      await createAlbumUploadSession(groupId, albumId, albumName, actualPath, skey, pskey, imgMd5, uin),
      actualPath,
      imgMd5,
      skey,
      pskey,
      uin,
    );
  } finally {
    if (tempFile) {
      try {
        unlinkSync(tempFile);
      } catch {
        // The temp file is best-effort: failing to remove it must not mask the
        // upload's own result.
      }
    }
  }
}

/** What a video upload needs to know about the file before it starts. */
export interface AlbumVideoProbeResult {
  /** Seconds; multiplied by 1000 for `iPlayTime`. */
  duration: number;
  /** One JPEG frame. Must not be empty. */
  cover: Uint8Array;
}

/** Extracts `{duration, cover}` from a staged video file. */
export type AlbumVideoProbe = (videoPath: string) => Promise<AlbumVideoProbeResult>;

/**
 * The default probe — NOT ported, and it throws rather than pretending.
 *
 * The reference calls `getFFmpegAddon().getVideoInfo(path)`
 * (reference/index.mjs:234511), a native addon that shells out to ffmpeg. This
 * package has no native addon and no ffmpeg dependency, and nothing in the TS
 * tree can produce a cover frame from an MP4. A host that wants
 * `uploadVideo` to work must pass `{ probe }` to `GroupAlbumApi`.
 *
 * Throwing here is the whole point: a silently-returned empty cover would make
 * `uploadVideo` fail at the server with an opaque error and no hint that the
 * local capability is missing.
 */
export const unavailableAlbumVideoProbe: AlbumVideoProbe = async () => {
  throw new Error(
    "group album video upload requires an ffmpeg-backed probe: the reference uses a native addon " +
      "(getFFmpegAddon().getVideoInfo) that this package does not ship. Pass { probe } to GroupAlbumApi.",
  );
};

/** The staged video. */
export interface AlbumVideoUploadOptions {
  probe?: AlbumVideoProbe;
  now?: () => number;
}

/**
 * `uploadVideoToGroupAlbum` — the video, then its client-extracted cover.
 *
 * The three gates before any network call: the head must be ISO BMFF and must
 * not be a known image; the hashes come from one streaming pass; and the probe
 * must produce a non-empty cover. `iBatchID` of the cover session is the
 * VIDEO's timestamp, not the cover's — they link the two server-side, and using
 * the cover's own stamp would produce an orphan image.
 */
export async function uploadVideoToGroupAlbum(
  cookieObject: Record<string, string>,
  groupId: string,
  albumId: string,
  albumName: string,
  filePath: string,
  uin: string,
  options: AlbumVideoUploadOptions = {},
): Promise<{ id: string }> {
  const skey = cookieObject["skey"] || "";
  const pskey = cookieObject["p_skey"] || "";
  const now = options.now ?? (() => Math.floor(Date.now() / 1e3));
  const probe = options.probe ?? unavailableAlbumVideoProbe;
  const staged = await stageVideoSource(filePath);
  let coverPath: string | null = null;
  try {
    const head = readFileHead(staged.filePath, 16);
    if (isKnownImageHead(head) || !isIsoBmffHead(head)) {
      throw new Error("群相册视频上传仅支持 MP4 等 ISO BMFF 视频");
    }
    const hashes = await hashFileStreaming(staged.filePath);
    const fileName = staged.fileName || "video.mp4";
    const info = await probe(staged.filePath);
    if (info.cover.length === 0) throw new Error("无法从视频提取封面");
    coverPath = join(tmpdir(), `album_video_cover_${String(Date.now())}_${Math.random().toString(36).slice(2)}.tmp`);
    writeFileSync(coverPath, Buffer.from(info.cover));
    const coverMd5 = createHash("md5").update(Buffer.from(info.cover)).digest("hex");
    const coverSize = info.cover.length;
    const videoTimestamp = now();
    const playTime = info.duration * 1000;
    const videoSession = await createAlbumMediaSession(hashes.sha1Hex, skey, pskey, uin, videoTimestamp, {
      uin,
      token: { type: 4, data: pskey, appid: 5 },
      appid: "video_qun",
      checksum: hashes.sha1Hex,
      check_type: 1,
      file_len: staged.fileSize,
      env: { refer: "qzone", deviceInfo: "h5" },
      model: 0,
      biz_req: {
        sPicTitle: fileName,
        sPicDesc: "",
        sAlbumName: "",
        sAlbumID: "",
        iAlbumTypeID: 0,
        iBitmap: 0,
        iUploadType: 3,
        iUpPicType: 0,
        iBatchID: 0,
        sPicPath: "",
        iPicWidth: 0,
        iPicHight: 0,
        iWaterType: 0,
        iDistinctUse: 0,
        sTitle: fileName,
        sDesc: "",
        iFlag: 0,
        iUploadTime: videoTimestamp,
        iPlayTime: playTime,
        sCoverUrl: "",
        iIsNew: 111,
        iIsOriginalVideo: 0,
        iIsFormatF20: 0,
        extend_info: {
          video_type: "3",
          domainid: "5",
          photo_num: "0",
          video_num: "1",
          qun_id: groupId,
        },
      },
      session: "",
      asy_upload: 0,
      cmd: "FileUploadVideo",
    });
    const videoBiz = await uploadAlbumFileSlices({
      session: videoSession.session,
      filePath: staged.filePath,
      fileSize: staged.fileSize,
      sliceSize: videoSession.sliceSize,
      appid: "video_qun",
      checkType: 1,
      uploadCmd: "FileUploadVideo",
      skey,
      pskey,
      uin,
    });
    if (!videoBiz.vid) throw new Error("视频上传未返回视频 id");
    const coverTimestamp = now();
    const coverSession = await createAlbumMediaSession(coverMd5, skey, pskey, uin, coverTimestamp, {
      uin,
      token: { type: 4, data: pskey, appid: 5 },
      appid: "qun",
      checksum: coverMd5,
      check_type: 0,
      file_len: coverSize,
      env: { refer: "huodong", deviceInfo: "h5" },
      model: 0,
      biz_req: {
        sPicTitle: fileName,
        sPicDesc: "",
        sAlbumName: albumName,
        sAlbumID: albumId,
        iAlbumTypeID: 0,
        iBitmap: 0,
        iUploadType: 2,
        iUpPicType: 0,
        iBatchID: videoTimestamp,
        sPicPath: "",
        iPicWidth: 0,
        iPicHight: 0,
        iWaterType: 0,
        iDistinctUse: 0,
        iNeedFeeds: 1,
        iUploadTime: coverTimestamp,
        mapExt: { appid: "qun", userid: groupId },
        stExtendInfo: { mapParams: { photo_num: "1", video_num: "1", batch_num: "1" } },
      },
      session: "",
      asy_upload: 0,
      cmd: "FileUpload",
    });
    const coverBiz = await uploadAlbumFileSlices({
      session: coverSession.session,
      filePath: coverPath,
      fileSize: coverSize,
      sliceSize: coverSession.sliceSize,
      appid: "qun",
      checkType: 0,
      uploadCmd: "FileUpload",
      skey,
      pskey,
      uin,
    });
    if (!coverBiz.photoId || !coverBiz.photoUrl) throw new Error("视频封面上传未返回图片 id");
    return { id: videoBiz.vid };
  } finally {
    if (coverPath) unlinkQuiet(coverPath);
    await staged.cleanup();
  }
}

/**
 * A `Buffer` viewed as a `BlobPart`.
 *
 * `@types/node` types `Buffer` over `ArrayBufferLike`, which can be a
 * `SharedArrayBuffer`, and `Blob`'s constructor only accepts `ArrayBufferView`s
 * over a plain `ArrayBuffer`. The cast is safe: every chunk reaching it comes
 * from `createReadStream`, whose buffers are never shared. Copying instead would
 * double the memory of every 16 KiB slice for no benefit.
 */
function asBlobPart(chunk: Uint8Array): BlobPart {
  return chunk as unknown as BlobPart;
}

/** `unlinkQuiet`. */
function unlinkQuiet(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Best-effort; see `uploadImageToGroupAlbum`'s finally block.
  }
}

/** A source staged onto local disk with a cleanup hook. */
export interface StagedVideo {
  filePath: string;
  fileSize: number;
  fileName: string;
  cleanup: () => Promise<void>;
}

/**
 * The video staging step, minus the reference's TTL reaper.
 *
 * The reference stages through `../protocol/src/highway/stage.ts`, whose real
 * job is a 30-minute reaper and a 300 s sweep timer for temps that outlive a
 * crash. This port has one caller and always cleans up in a `finally`, so it
 * keeps the two behaviours the upload actually depends on:
 *
 *   * a local file is HARD-LINKED when possible (a copy otherwise), so a 1.5 GB
 *     video is not duplicated on disk;
 *   * the returned `fileName` comes from the source, because it becomes
 *     `sPicTitle`/`sTitle` on the wire.
 *
 * Inline (`base64://`) sources stage to a `.bin` file with `fileName: ""`, which
 * is why `uploadVideoToGroupAlbum` falls back to `"video.mp4"`.
 */
export async function stageVideoSource(source: string): Promise<StagedVideo> {
  if (!source) throw new Error("stage source is empty");
  const directory = join(tmpdir(), "media-stage");
  const { mkdirSync, linkSync, copyFileSync } = await import("node:fs");
  mkdirSync(directory, { recursive: true });
  const unique = `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;

  const inline = /^base64:\/\//i.test(source) ? source.slice(9) : null;
  if (inline !== null) {
    const bytes = Buffer.from(inline, "base64");
    if (bytes.length > ALBUM_VIDEO_MAX_BYTES) {
      throw new Error(`stage source too large: ${String(bytes.length)} > ${String(ALBUM_VIDEO_MAX_BYTES)}`);
    }
    const filePath = join(directory, `stage-${unique}.bin`);
    writeFileSync(filePath, bytes);
    log.debug("staged inline base64 video source (%d bytes)", bytes.length);
    return { filePath, fileSize: bytes.length, fileName: "", cleanup: () => removeQuietly(filePath) };
  }

  if (/^https?:\/\//i.test(source)) {
    const loaded = await loadBinarySource(source, "stage", ALBUM_VIDEO_MAX_BYTES);
    const filePath = join(directory, `stage-${unique}.bin`);
    writeFileSync(filePath, loaded.bytes);
    log.debug("staged http video source %s (%d bytes)", loaded.fileName || "(unnamed)", loaded.bytes.length);
    return {
      filePath,
      fileSize: loaded.bytes.length,
      fileName: loaded.fileName,
      cleanup: () => removeQuietly(filePath),
    };
  }

  const local = resolveLocalFilePath(source);
  if (!local) throw new Error("stage source is not a local file");
  const { size } = statSync(local);
  if (size > ALBUM_VIDEO_MAX_BYTES) {
    throw new Error(`stage source too large: ${String(size)} > ${String(ALBUM_VIDEO_MAX_BYTES)}`);
  }
  const extension = /\.[A-Za-z0-9]+$/.exec(local)?.[0] ?? ".bin";
  const filePath = join(directory, `stage-${unique}${extension}`);
  try {
    linkSync(local, filePath);
  } catch {
    copyFileSync(local, filePath);
  }
  const fileName = basename(local);
  log.debug("staged local video source %s (%d bytes)", fileName, size);
  return { filePath, fileSize: size, fileName, cleanup: () => removeQuietly(filePath) };
}

async function removeQuietly(filePath: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(filePath, { force: true }).catch(() => undefined);
}

/** `hashFileStreaming`'s result. `sha1Blocks` is included for completeness. */
export interface FileHashes {
  md5: Uint8Array;
  sha1: Uint8Array;
  md5Hex: string;
  sha1Hex: string;
}

/** The block size the reference's streaming hash reads at a time (1 MiB). */
export const SHA1_STREAM_BLOCK_SIZE = 1024 * 1024;

/**
 * `hashFileStreaming`, reduced to the digests the album path uses.
 *
 * The reference's version also emits `sha1Blocks` (a per-MiB SHA-1 state list
 * for highway's resumable upload) and an optional head MD5. Neither is read by
 * `uploadVideoToGroupAlbum` — it uses `sha1Hex` as the session checksum and the
 * `fileSize` from `stat` — so they are not reproduced. Streaming matters: a
 * 1.5 GB video must not be read into one buffer.
 */
export async function hashFileStreaming(filePath: string): Promise<FileHashes> {
  const md5 = createHash("md5");
  const sha1 = createHash("sha1");
  const stream = createReadStream(filePath, { highWaterMark: SHA1_STREAM_BLOCK_SIZE });
  for await (const chunk of stream) {
    md5.update(chunk as Buffer);
    sha1.update(chunk as Buffer);
  }
  const md5Digest = md5.digest();
  const sha1Digest = sha1.digest();
  return {
    md5: new Uint8Array(md5Digest),
    sha1: new Uint8Array(sha1Digest),
    md5Hex: md5Digest.toString("hex"),
    sha1Hex: sha1Digest.toString("hex"),
  };
}