// `GroupAlbumApi` — the 9,288-line group album (群相册) module, ported.
//
// ---------------------------------------------------------------------------
// What the 9,288 lines actually are
// ---------------------------------------------------------------------------
// Measured, not guessed: of the region's 9,288 lines,
//
//   8,390  are a generated protobuf codec — 38 messages, each with a
//          `protobuf_encode_*` or `protobuf_decode_*` front door plus an
//          `__size_*` / `__write_*` pair. Every one of those is a field table.
//   603    are the class and its 19 helper functions — the actual business logic.
//   295    are a per-region copy of the runtime's own UTF-8 / varint / skip
//          helpers (`__utf8Read$46`, `__allocate$49`, `__skipUnknownField$47`, …).
//
// So the module is ~6% logic. That is the single most useful number in this
// port: the file's size is a codec artefact, not a difficulty estimate. The
// codec now lives in `album/packet.ts` (one hand-written function per message,
// on top of `oidb/wire.ts`), and this file is the 603 lines.
//
// ---------------------------------------------------------------------------
// THE HTTP SURFACE IS ZERO — this is not a web module
// ---------------------------------------------------------------------------
// The task brief said `group-album.ts` "needs only cookies". Half true, and the
// half that is false is the important half:
//
//   * its SIX packet operations (list, media list, feed detail, comment, like,
//     delete) are **protobuf over the raw packet transport** — the same
//     `ctx.sendRawPacket` the OIDB layer uses, with five `trpc.qzone.*` wire
//     names and no envelope. Not HTTPS, not a cookie CGI.
//   * only its TWO upload operations are HTTPS, and they are not even in this
//     region: they are `../protocol/src/web/group-album.ts` (412 lines), reached
//     through `apis.web.getCookies("qzone.qq.com")`.
//
// The `trpc.qzone.*` names look like the `h5.qzone.qq.com/http2rpc` endpoints
// `qzone-public.ts` uses, and they are not: qzone-public posts JSON to a URL
// with an `x-oidb` header, while these go out as bare protobuf on the packet
// channel. Two different transports with confusingly similar names.
//
// ---------------------------------------------------------------------------
// What the business layer does that is not obvious
// ---------------------------------------------------------------------------
// 1. **Three ids for one media item, and they are not interchangeable.** A photo
//    is addressed by `lloc`; a video by `id`, whose *deletion* address is its
//    cover's `lloc`; comments need the `batchId` as well. `resolveDeleteTarget`
//    and `resolveCommentMedia` page the album to translate between them, and
//    `findDeleteTarget` already returns the cover lloc for a video id. Pass a
//    video id to `comment` and the request carries the cover lloc, not the id.
// 2. **`delete`'s pagination is best-effort; `comment`'s is fatal.** A failed
//    page walk in `resolveDeleteTarget` falls back to using the raw id (the
//    server then either accepts it or rejects it with a real error), while a
//    miss in `resolveCommentMedia` throws "media not found". Different policies
//    for the same walk, deliberately.
// 3. **The comment body is assembled from RAW SUBMESSAGE SLICES of the feed
//    detail response.** Four nested fields (`data.feed.feed.cellCommon`,
//    `.cellUserInfo`, `.cellMedia`) are lifted out of the response bytes with
//    `protobufSubmessage(bytes, [4,2,1,1])` and re-embedded verbatim, so the
//    comment inherits fields this codec does not model. When a slice is absent
//    the code rebuilds it from the decoded values — so the fast path and the
//    fallback produce different bytes for the same logical request, and both
//    are correct.
// 4. **`like`'s success code is the request's own constant.** `field1` is 5495
//    out and must come back as 5495; `delete`'s is 8694. Checking `!== 0` would
//    report every successful like as a failure.
//
// Reference region: src/bridge/apis/group-album.ts (reference/index.mjs:234750).
// The web upload half is reference/index.mjs:234338.

import { createLogger } from "../../onebot/log.js";
import { packetTimeoutMs, type BridgeContext } from "../context.js";
import { ProtoReader } from "../../oidb/wire.js";
import {
  decodeDeleteMediasResponse,
  decodeDoQunCommentResponse,
  decodeDoQunLikeResponse,
  decodeGetAlbumListResponse,
  decodeGetMediaListResponse,
  decodeGetQunFeedDetailResponse,
  encodeCommentReqBodyHeader,
  encodeCommentReqBodyUserWrap,
  encodeCommentReqPhotoInfo,
  encodeDeleteMediasRequest,
  encodeDoQunCommentRequest,
  encodeDoQunLikeRequest,
  encodeGetAlbumListRequest,
  encodeGetMediaListRequest,
  encodeGetQunFeedDetailRequest,
  type CommentReqPhotoInfo,
  type GroupAlbumInfo,
  type MediaInfo,
  type QunFeedCellCommon,
} from "../album/packet.js";
import { uploadImageToGroupAlbum, uploadVideoToGroupAlbum, type AlbumVideoProbe } from "../web/album-upload.js";

const log = createLogger("Bridge.GroupAlbum");

/** The wire name for the album list. */
export const GET_ALBUM_LIST_CMD = "QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.GetAlbumList";
/** `seq` in the album-list request. A protocol constant, not a sequence number. */
export const GET_ALBUM_LIST_SEQ = 3331;
/** The wire name for the comment write. */
export const DO_QUN_COMMENT_CMD = "QunAlbum.trpc.qzone.webapp_qun_operation.FeedsWriter.DoQunComment";
/** `field1` in the comment request AND the value the response must echo. */
export const DO_QUN_COMMENT_SEQ = 8527;
/** The wire name for the feed detail read. */
export const GET_QUN_FEED_DETAIL_CMD = "QunAlbum.trpc.qzone.webapp_qun_feeds.FeedsReader.GetQunFeedDetail";
/** How many comments the feed detail asks for; only the feed body is used. */
export const GET_QUN_FEED_DETAIL_COMMENT_COUNT = 20;
/** The wire name for the media list. */
export const GET_MEDIA_LIST_CMD = "QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.GetMediaList";
/** The wire name for the like write. */
export const DO_QUN_LIKE_CMD = "QunAlbum.trpc.qzone.webapp_qun_operation.FeedsWriter.DoQunLike";
/** The wire name for the delete. */
export const DELETE_MEDIAS_CMD = "QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.DeleteMedias";

/** `field1` in the like request, and the value the response must echo. */
export const DO_QUN_LIKE_SEQ = 5495;
/** `field1` in the delete request, and the value the response must echo. */
export const DELETE_MEDIAS_SEQ = 8694;
/** `field2`/`field3` of both writers — a literal stamp, not a version we can compute. */
export const QZONE_TRPC_STAMP = "h5_test";

/** The one `extMap` entry every request carries. */
const EXT_MAP = [{ key: "fc-appid", value: "100" }];

// ===========================================================================
// Pure transforms
// ===========================================================================

/** `uint64ToString` — a null/absent 64-bit field becomes `"0"`, not `"null"`. */
export function uint64ToString(value: bigint | null | undefined): string {
  return (value ?? 0n).toString();
}

/**
 * `uint64ToSafeNumber` — narrows a 64-bit field to a JS number, THROWING above
 * `Number.MAX_SAFE_INTEGER`.
 *
 * The throw is the point: silently rounding a timestamp is invisible, while a
 * rounded `uploadNumber` can make two different albums compare equal in a
 * caller that keys on it.
 */
export function uint64ToSafeNumber(value: bigint | null | undefined, fieldName: string): number {
  const normalized = value ?? 0n;
  if (normalized > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`group album ${fieldName} exceeds Number.MAX_SAFE_INTEGER: ${normalized}`);
  }
  return Number(normalized);
}

/** One creator row in the normalized album shape. */
export interface NormalizedAlbumCreator {
  uid: string;
  nick: string;
  is_sweet: boolean;
  is_special: boolean;
  is_super_like: boolean;
  custom_id: string;
  poly_id: string;
  portrait: string;
  can_follow: number;
  isfollowed: number;
  uin: string;
  ditto_uin: string;
}

/** `normalizeAlbumCreator` — every absence becomes its zero value. */
export function normalizeAlbumCreator(creator: GroupAlbumInfo["creator"]): NormalizedAlbumCreator | undefined {
  if (!creator) return undefined;
  return {
    uid: creator.uid ?? "",
    nick: creator.nick ?? "",
    is_sweet: creator.isSweet ?? false,
    is_special: creator.isSpecial ?? false,
    is_super_like: creator.isSuperLike ?? false,
    custom_id: creator.customId ?? "",
    poly_id: creator.polyId ?? "",
    portrait: creator.portrait ?? "",
    can_follow: creator.canFollow ?? 0,
    isfollowed: creator.isFollowed ?? 0,
    uin: creator.uin ?? "",
    ditto_uin: creator.dittoUin ?? "",
  };
}

/** A normalized cover URL. */
export interface NormalizedCoverUrl {
  url: string;
  width: number;
  height: number;
}

/** `normalizeCoverUrl`. */
export function normalizeCoverUrl(url: { url: string | null; width: number | null; height: number | null } | null): NormalizedCoverUrl | null {
  if (!url) return null;
  return { url: url.url ?? "", width: url.width ?? 0, height: url.height ?? 0 };
}

/** A normalized cover image. */
export interface NormalizedAlbumCoverImage {
  name: string;
  sloc: string;
  lloc: string;
  photoUrls: { spec: number; url: NormalizedCoverUrl | null }[];
  defaultUrl: NormalizedCoverUrl | null;
  isGif: boolean;
  hasRaw: boolean;
}

/** A normalized cover. `image` stays optional-null because a video-only cover has none. */
export interface NormalizedAlbumCover {
  type: number;
  image: NormalizedAlbumCoverImage | null;
}

/** `normalizeAlbumCover`. */
export function normalizeAlbumCover(cover: MediaInfo | null): NormalizedAlbumCover | null {
  if (!cover) return null;
  const image = cover.image;
  return {
    type: cover.type ?? 0,
    image: image
      ? {
          name: image.name ?? "",
          sloc: image.sloc ?? "",
          lloc: image.lloc ?? "",
          photoUrls: (image.photoUrls ?? []).map((photoUrl) => ({
            spec: photoUrl.spec ?? 0,
            url: normalizeCoverUrl(photoUrl.url),
          })),
          defaultUrl: normalizeCoverUrl(image.defaultUrl),
          isGif: image.isGif ?? false,
          hasRaw: image.hasRaw ?? false,
        }
      : null,
  };
}

/** The normalized album shape `listQun` returns. */
export interface NormalizedQunAlbum {
  album_id: string;
  owner: string;
  name: string;
  desc: string;
  create_time: string;
  modify_time: string;
  last_upload_time: string;
  upload_number: string;
  cover: NormalizedAlbumCover | null;
  top_flag: string;
  busi_type: number;
  status: number;
  allow_share: boolean;
  is_subscribe: boolean;
  bitmap: string;
  is_share_album: boolean;
  qz_album_type: number;
  cover_type: number;
  default_desc: string;
  sort_type: number;
  creator?: NormalizedAlbumCreator;
}

/**
 * `normalizeQunAlbum`.
 *
 * Every 64-bit field becomes a decimal STRING and the rest become their zero
 * value, so the result is JSON-safe without the lossy `convertBigIntToString`
 * pass the other paths need.
 */
export function normalizeQunAlbum(album: GroupAlbumInfo): NormalizedQunAlbum {
  const normalized: NormalizedQunAlbum = {
    album_id: album.albumId ?? "",
    owner: album.owner ?? "",
    name: album.name ?? "",
    desc: album.description ?? "",
    create_time: uint64ToString(album.createTime),
    modify_time: uint64ToString(album.modifyTime),
    last_upload_time: uint64ToString(album.lastUploadTime),
    upload_number: uint64ToString(album.uploadNumber),
    cover: normalizeAlbumCover(album.cover),
    top_flag: uint64ToString(album.topFlag),
    busi_type: album.busiType ?? 0,
    status: album.status ?? 0,
    allow_share: album.allowShare ?? false,
    is_subscribe: album.isSubscribe ?? false,
    bitmap: album.bitmap ?? "",
    is_share_album: album.isShareAlbum ?? false,
    qz_album_type: album.qzAlbumType ?? 0,
    cover_type: album.coverType ?? 0,
    default_desc: album.defaultDesc ?? "",
    sort_type: album.sortType ?? 0,
  };
  const creator = normalizeAlbumCreator(album.creator);
  if (creator) normalized.creator = creator;
  return normalized;
}

/** The legacy album shape `list` returns (the OneBot payload's own naming). */
export interface LegacyAlbum {
  id: string;
  name: string;
  picNum: number;
  createTime: number;
  desc: string;
  owner: string;
  createuin: string;
  createnickname: string;
  last_upload_time: number;
  cover: NormalizedAlbumCover | null;
}

/**
 * `toLegacyAlbum` — the pre-normalization shape, with NUMBERS.
 *
 * `createuin` falls back creator uin → owner → creator uid, in that order. That
 * chain matters: a group album created by a QQ number whose uid the server did
 * not send still has an `owner`, while an album created in the QQ NT client may
 * have only a creator uid. Picking one fallback would blank the field for one
 * of the two.
 */
export function toLegacyAlbum(album: GroupAlbumInfo): LegacyAlbum {
  const creator = normalizeAlbumCreator(album.creator);
  return {
    id: album.albumId ?? "",
    name: album.name ?? "",
    picNum: uint64ToSafeNumber(album.uploadNumber, "upload_number"),
    createTime: uint64ToSafeNumber(album.createTime, "create_time"),
    desc: album.description ?? "",
    owner: album.owner ?? "",
    createuin: creator?.uin || album.owner || creator?.uid || "",
    createnickname: creator?.nick ?? "",
    last_upload_time: uint64ToSafeNumber(album.lastUploadTime, "last_upload_time"),
    cover: normalizeAlbumCover(album.cover),
  };
}

/**
 * `convertBigIntToString` — recursively replace `bigint` with its decimal string.
 *
 * Arrays, plain objects, and the four JSON scalar types pass through; anything
 * else (`undefined`, functions) becomes `null`, which is what the reference
 * does and what keeps the result `JSON.stringify`-able for the OneBot payload.
 */
export function convertBigIntToString(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(convertBigIntToString);
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = convertBigIntToString(item);
    }
    return result;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

/** Where a delete should point: a media id, plus the batch id when known. */
export interface DeleteTarget {
  mediaId: string;
  batchId?: string;
}

/**
 * `findDeleteTarget` — map a caller-supplied media key onto the album's own ids.
 *
 * A video is matched either by its `id` or by its cover's `lloc`, and the result
 * is always the COVER's lloc (or the raw key when the cover has none). Deleting
 * by a video's `id` is rejected by the server, which is why this translation
 * exists at all.
 */
export function findDeleteTarget(mediaList: readonly unknown[], mediaKey: string): DeleteTarget | undefined {
  for (const raw of mediaList) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { batchId?: unknown; image?: { lloc?: string } | null; video?: { id?: string; cover?: { lloc?: string } | null } | null };
    const batchId = item.batchId === undefined || item.batchId === "" ? undefined : String(item.batchId);
    if (item.image?.lloc === mediaKey) return { mediaId: mediaKey, ...(batchId === undefined ? {} : { batchId }) };
    const coverLloc = item.video?.cover?.lloc;
    if (item.video?.id === mediaKey || coverLloc === mediaKey) {
      return { mediaId: coverLloc || mediaKey, ...(batchId === undefined ? {} : { batchId }) };
    }
  }
  return undefined;
}

/**
 * `optionalBatchId` — a `bigint` batch id, or `undefined` for ""/non-numeric/zero.
 *
 * Zero is treated as absent on purpose: the server uses `0` for "no batch" on
 * feed items that were never uploaded through the batch CGI, and requesting a
 * zero batch id makes the comment endpoint answer with an empty comment.
 */
export function optionalBatchId(value: unknown): bigint | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  try {
    const batchId = BigInt(value as bigint | number | string);
    return batchId === 0n ? undefined : batchId;
  } catch {
    return undefined;
  }
}

/** A media item, as far as the comment/delete translation needs it. */
export interface AlbumMediaItem {
  batchId?: string | null;
  uploader?: string | null;
  image?: { lloc?: string | null } | null;
  video?: { id?: string | null; cover?: { lloc?: string | null } | null } | null;
}

/** `commentMediaLloc` — a video comments under its cover, not its id. */
export function commentMediaLloc(item: AlbumMediaItem | undefined, lloc: string): string {
  if (item?.video?.cover?.lloc) return item.video.cover.lloc;
  if (item?.image?.lloc) return item.image.lloc;
  return lloc;
}

/**
 * `mediaInfoForComment` — the `CommentReqPhotoInfo.medias` entry to embed.
 *
 * Only `lloc` (of the image, or of the video's cover) and the optional
 * `uploader`/`batchId` are set. Every other field stays absent, which matters:
 * `MediaInfo` is embedded VERBATIM into the comment request, so a `type: 0`
 * that this function did not intend to state would be a statement about the
 * media kind rather than a default. `type` is 0 or 1 here and both are emitted
 * because the reference writes `type` for `!= null`.
 */
export function mediaInfoForComment(item: AlbumMediaItem | undefined, lloc: string): MediaInfo {
  const batchId = optionalBatchId(item?.batchId);
  const shared = {
    uploader: item?.uploader || null,
    batchId: batchId ?? null,
  };
  if (item?.video) {
    return {
      ...shared,
      type: 1,
      image: null,
      video: {
        id: null,
        url: null,
        cover: { name: null, sloc: null, lloc: item.video.cover?.lloc || lloc, photoUrls: [], defaultUrl: null, isGif: null, hasRaw: null },
        width: null,
        height: null,
        videoTime: null,
        videoUrl: [],
      },
      uploadTime: null,
    };
  }
  return {
    ...shared,
    type: 0,
    image: { name: null, sloc: null, lloc: item?.image?.lloc || lloc, photoUrls: [], defaultUrl: null, isGif: null, hasRaw: null },
    video: null,
    uploadTime: null,
  };
}

/**
 * `qunFeedCellId` — the `^||^`-separated cell id a like is addressed by.
 *
 * With a lloc it is a THREE-cell chain (group|album|batch, group|album|lloc,
 * 0); without one it is just the head. The server accepts both, which is why the
 * missing-lloc branch exists rather than a throw.
 */
export function qunFeedCellId(groupId: string | number | bigint, albumId: string, batchId: string, lloc?: string): string {
  const head = `421_1_0_${groupId}|${albumId}|${batchId}`;
  if (!lloc) return head;
  return `${head}^||^421_1_0_${groupId}|${albumId}|${lloc}^||^0`;
}

/**
 * `protobufSubmessage` — walk a length-delimited field path and return the raw
 * slice, so a nested submessage can be re-embedded without re-encoding it.
 *
 * This is the trick that keeps the comment request faithful: the reference lifts
 * `cellCommon` / `cellUserInfo` / `cellMedia` out of the feed-detail response
 * verbatim, so any field this codec does not model still reaches the server.
 */
export function protobufSubmessage(buf: Uint8Array, path: readonly number[]): Uint8Array | undefined {
  let current: Uint8Array | undefined = buf;
  for (const fieldNo of path) {
    if (!current) return undefined;
    current = firstLengthDelimitedField(current, fieldNo);
  }
  return current;
}

/** The first length-delimited field with `fieldNo`, as a slice; skips other fields. */
export function firstLengthDelimitedField(buf: Uint8Array, fieldNo: number): Uint8Array | undefined {
  const reader = new ProtoReader(buf);
  while (reader.next()) {
    if (reader.fieldNumber === fieldNo && reader.wireType === 2) return reader.bytes();
    reader.skip();
  }
  return undefined;
}

/** `commentReqHeader` — only the two fields the comment needs. */
export function commentReqHeader(cell: QunFeedCellCommon): { time?: bigint; feedId?: string } {
  return {
    ...(cell.time !== null && cell.time !== undefined ? { time: cell.time } : {}),
    ...(cell.feedId ? { feedId: cell.feedId } : {}),
  };
}

/**
 * `commentPhotoInfo` — prefer the feed's own media list, fall back to one entry.
 *
 * The feed's `albumId`/`batchId` win over the caller's when present (they are the
 * server's own answer), and the fallback covers a feed detail whose `cellMedia`
 * was empty — which happens for a media item the album has since deleted.
 */
export function commentPhotoInfo(
  feedMedia: CommentReqPhotoInfo | null | undefined,
  fallback: MediaInfo,
  albumId: string,
  batchId: bigint,
): CommentReqPhotoInfo {
  if (feedMedia?.medias?.length) {
    return {
      medias: feedMedia.medias,
      albumId: feedMedia.albumId || albumId,
      batchId: feedMedia.batchId ?? batchId,
    };
  }
  return { medias: [fallback], albumId, batchId };
}

/** `findCommentMedia` — a photo by lloc, a video by id or cover lloc. */
export function findCommentMedia(mediaList: readonly unknown[], mediaKey: string): AlbumMediaItem | undefined {
  for (const raw of mediaList) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as AlbumMediaItem;
    if (item.image?.lloc === mediaKey) return item;
    if (item.video?.id === mediaKey || item.video?.cover?.lloc === mediaKey) return item;
  }
  return undefined;
}

/** The comment shape both the success and fallback paths produce. */
export interface CommentResultSource {
  id?: string | null;
  user?: { uin?: string | null } | null;
  content?: { type?: number | null; content?: string | null }[] | null;
  time?: bigint | null;
  clientKey?: string | null;
}

/**
 * `commentFromResponse` — three response shapes, in a fixed precedence.
 *
 * The server answers a comment write in one of three layouts depending on which
 * batch pipeline handled it: `comment.data` (the modern one), `comment` itself
 * (a flat legacy row), or nothing at all. Trying `comment.data` first is not
 * cosmetic — the flat branch deliberately keeps `comment.content`/`time` and
 * reads only `user` from `data`.
 */
export function commentFromResponse(resp: {
  comment: { id: string | null; data: CommentResultSource | null; content: unknown[]; time: bigint | null; clientKey: string | null } | null;
}): CommentResultSource {
  const wrapped = resp.comment;
  if (!wrapped) return {};
  if (wrapped.data?.id) return wrapped.data;
  if (wrapped.id) {
    return {
      id: wrapped.id,
      content: (wrapped.content as { type?: number | null; content?: string | null }[]) ?? [],
      time: wrapped.time,
      clientKey: wrapped.clientKey,
      user: wrapped.data?.user ?? null,
    };
  }
  return wrapped.data ?? {};
}

/** `numericUin` — the uin as a `bigint` only when it is all digits. */
export function numericUin(uin: string): bigint | undefined {
  if (!/^\d+$/.test(uin)) return undefined;
  try {
    return BigInt(uin);
  } catch {
    return undefined;
  }
}

// ===========================================================================
// The API
// ===========================================================================

/** One raw album page, as `fetchAlbumList` returns it. */
export interface AlbumListPage {
  albumList: GroupAlbumInfo[];
  attachInfo: string;
  hasMore: boolean;
}

/** The normalized album page `listQun` returns. */
export interface QunAlbumPage {
  albumList: NormalizedQunAlbum[];
  attachInfo: string;
  hasMore: boolean;
}

/** The media page `getMediaList` returns, already JSON-safe. */
export interface MediaListPage {
  mediaList: unknown[];
  nextAttachInfo: string;
}

/** The feed-detail slice the comment builder consumes. */
export interface QunFeedDetail {
  cellCommon: QunFeedCellCommon;
  ownerUin: string;
  media: CommentReqPhotoInfo | null;
  rawCellCommon: Uint8Array | undefined;
  rawCellUser: Uint8Array | undefined;
  rawCellMedia: Uint8Array | undefined;
}

/** The comment the API returns. */
export interface AlbumComment {
  id: string;
  user: { uin: string };
  content: { type: number; content: string }[];
  time: string;
  clientKey: string;
}

/** Injectable seams for the two upload paths (used by tests, and by hosts with no ffmpeg). */
export interface GroupAlbumApiOptions {
  /** Extracts a duration and a cover frame from a video. Default throws (see below). */
  probe?: AlbumVideoProbe;
  /** Seconds-since-epoch clock; the batch ids are derived from it. */
  now?: () => number;
}

export class GroupAlbumApi {
  readonly #ctx: BridgeContext;
  readonly #options: GroupAlbumApiOptions;

  constructor(ctx: BridgeContext, options: GroupAlbumApiOptions = {}) {
    this.#ctx = ctx;
    this.#options = options;
  }

  /** The trace id every request carries: `_<ms>_<5 random digits>`. */
  #traceId(): string {
    return `_${Date.now()}_${Math.floor(Math.random() * 1e5)}`;
  }

  /** The client key the writers carry: `<uin>_<ms>_<5 random digits>`. */
  #clientKey(): string {
    return `${this.#ctx.identity.uin}_${Date.now()}_${Math.floor(Math.random() * 1e5)}`;
  }

  /**
   * One album page.
   *
   * `attachInfo` is the server's opaque cursor: `""` starts, and the response's
   * own `attachInfo` continues. `hasMore` alone is not enough to decide to
   * continue — a `hasMore: true` page with an empty cursor is a server bug the
   * `list` walk turns into an error rather than an infinite loop.
   */
  async fetchAlbumList(groupId: number | bigint, attachInfo: string): Promise<AlbumListPage> {
    const traceId = this.#traceId();
    const body = encodeGetAlbumListRequest({
      seq: GET_ALBUM_LIST_SEQ,
      field2: new Uint8Array(0),
      field3: new Uint8Array(0),
      data: { groupId: groupId.toString(), attachInfo },
      traceId,
      extMap: EXT_MAP,
    });
    log.debug(
      "get album list request: group=%s cursorChars=%d requestBytes=%d",
      String(groupId),
      attachInfo.length,
      body.length,
    );
    const result = await this.#ctx.sendRawPacket(GET_ALBUM_LIST_CMD, body, packetTimeoutMs());
    if (!result.success || !result.gotResponse || !result.responseData) {
      throw new Error(
        `get group album list transport failed: ${result.errorMessage || `code ${String(result.errorCode)}`}`,
      );
    }
    const response = decodeGetAlbumListResponse(result.responseData);
    const resultCode = response.result ?? 0;
    if (resultCode !== 0) {
      throw new Error(`get group album list failed: result=${String(resultCode)}, error=${response.errorText || "unknown"}`);
    }
    const normalized: AlbumListPage = {
      albumList: response.data?.albumList ?? [],
      attachInfo: response.data?.attachInfo ?? "",
      hasMore: response.data?.hasMore ?? false,
    };
    log.debug(
      "get album list response: group=%s albums=%d hasMore=%s cursorChars=%d responseBytes=%d",
      String(groupId),
      normalized.albumList.length,
      String(normalized.hasMore),
      normalized.attachInfo.length,
      result.responseData.length,
    );
    return normalized;
  }

  /** One normalized page, keeping the cursor, for a caller that pages itself. */
  async listQun(groupId: number | bigint, attachInfo = ""): Promise<QunAlbumPage> {
    const result = await this.fetchAlbumList(groupId, attachInfo);
    return {
      albumList: result.albumList.map(normalizeQunAlbum),
      attachInfo: result.attachInfo,
      hasMore: result.hasMore,
    };
  }

  /**
   * Every album, paging until `hasMore` is false.
   *
   * The cursor guard is not defensive padding: a server that repeats its cursor
   * makes this loop issue requests until something else times out, and the
   * resulting error would name the timeout instead of the repeating cursor.
   * `seenCursors` starts empty — the FIRST cursor is not pre-seeded, so a server
   * that returns the cursor it was given is caught on page two.
   */
  async list(groupId: number | bigint): Promise<LegacyAlbum[]> {
    const albumList: LegacyAlbum[] = [];
    const seenCursors = new Set<string>();
    let attachInfo = "";
    let page = 0;
    for (;;) {
      const result = await this.fetchAlbumList(groupId, attachInfo);
      page += 1;
      albumList.push(...result.albumList.map(toLegacyAlbum));
      if (!result.hasMore) {
        log.debug("get complete album list: group=%s pages=%d albums=%d", String(groupId), page, albumList.length);
        return albumList;
      }
      const nextAttachInfo = result.attachInfo;
      if (!nextAttachInfo) {
        throw new Error(
          `get group album list pagination failed: group=${String(groupId)} page=${page} hasMore=true but cursor is empty`,
        );
      }
      if (seenCursors.has(nextAttachInfo)) {
        throw new Error(`get group album list pagination failed: group=${String(groupId)} repeated cursor at page ${page}`);
      }
      seenCursors.add(nextAttachInfo);
      attachInfo = nextAttachInfo;
    }
  }

  /** Upload an image (or a `base64://` / `http(s)://` source) into an album. */
  async upload(groupId: number | bigint, albumId: string, albumName: string, filePath: string): Promise<void> {
    const groupCode = groupId.toString();
    const uin = this.#ctx.identity.uin;
    await uploadImageToGroupAlbum(
      await this.#cookies(),
      groupCode,
      albumId,
      albumName,
      filePath,
      uin,
    );
  }

  /** Upload a video and its cover; returns the video id. Needs an ffmpeg probe. */
  async uploadVideo(
    groupId: number | bigint,
    albumId: string,
    albumName: string,
    filePath: string,
  ): Promise<{ id: string }> {
    const groupCode = groupId.toString();
    const uin = this.#ctx.identity.uin;
    return uploadVideoToGroupAlbum(await this.#cookies(), groupCode, albumId, albumName, filePath, uin, {
      ...(this.#options.probe === undefined ? {} : { probe: this.#options.probe }),
      ...(this.#options.now === undefined ? {} : { now: this.#options.now }),
    });
  }

  /**
   * The `qzone.qq.com` cookie jar.
   *
   * The ONLY cookie use in this module, and it is the upload half only. The six
   * packet operations never touch it.
   */
  async #cookies(): Promise<Record<string, string>> {
    const web = this.#ctx.apis.web;
    if (!web) throw new Error("group album upload requires apis.web (cookie provider) to be attached");
    return web.getCookies("qzone.qq.com");
  }

  /**
   * One media page.
   *
   * `field1` of the response is the retCode, and it is checked as `!== 0` rather
   * than `!== 200` or `=== 0`: the album service answers `0` on success, unlike
   * the CGI endpoints this module also touches.
   */
  async getMediaList(groupId: number | bigint, albumId: string, attachInfo = ""): Promise<MediaListPage> {
    const traceId = this.#traceId();
    const body = encodeGetMediaListRequest({
      field1: 0,
      field2: new Uint8Array(0),
      field3: new Uint8Array(0),
      reqInfo: { groupId: groupId.toString(), albumId, field3: 0, field4: "", pageInfo: attachInfo },
      traceId,
      extMap: EXT_MAP,
    });
    const result = await this.#ctx.sendRawPacket(GET_MEDIA_LIST_CMD, body, packetTimeoutMs());
    if (!result.success || !result.gotResponse || !result.responseData) {
      throw new Error(result.errorMessage || "failed to get album media list");
    }
    const resp = decodeGetMediaListResponse(result.responseData);
    const retCode = resp.field1 ?? 0;
    if (retCode !== 0) throw new Error(`fetch album media list error: retCode ${String(retCode)}`);
    const data = resp.data;
    return convertBigIntToString({
      mediaList: data?.mediaList ?? [],
      nextAttachInfo: data?.nextAttachInfo ?? "",
    }) as MediaListPage;
  }

  /**
   * Comment on one media item.
   *
   * The five-part body is assembled in a fixed order and the middle three parts
   * prefer the RAW response slices (see the module header, point 3). `field1`
   * must equal `DO_QUN_COMMENT_SEQ` on the response, not 0.
   */
  async comment(groupId: number | bigint, albumId: string, lloc: string, content: string): Promise<AlbumComment> {
    const traceId = this.#traceId();
    const clientKey = Date.now().toString();
    const uin = this.#ctx.identity.uin;
    const resolved = await this.resolveCommentMedia(groupId, albumId, lloc);
    const batchId = optionalBatchId(resolved?.batchId);
    if (batchId === undefined) throw new Error("comment album media error: media not found");
    const mediaLloc = commentMediaLloc(resolved, lloc);
    const feed = await this.getQunFeedDetail(groupId, albumId, batchId, mediaLloc);
    const ownerUin = feed.ownerUin || resolved?.uploader || "";
    const photoInfo = commentPhotoInfo(feed.media, mediaInfoForComment(resolved, mediaLloc), albumId, batchId);
    const headerBytes = feed.rawCellCommon ?? encodeCommentReqBodyHeader(commentReqHeader(feed.cellCommon));
    const userBytes =
      feed.rawCellUser ?? (ownerUin ? encodeCommentReqBodyUserWrap({ field1: { uin: ownerUin } }) : undefined);
    const mediaBytes = feed.rawCellMedia ?? encodeCommentReqPhotoInfo(photoInfo);
    const commenterUinNum = numericUin(uin);
    const body = encodeDoQunCommentRequest({
      field1: DO_QUN_COMMENT_SEQ,
      field2: new Uint8Array(0),
      field3: new Uint8Array(0),
      body: {
        groupId: groupId.toString(),
        field3: 2,
        reqBody: {
          field1: headerBytes,
          ...(userBytes ? { field2: userBytes } : {}),
          field5: mediaBytes,
        },
        field5: {
          user: { uin, ...(commenterUinNum !== undefined ? { uinNum: commenterUinNum } : {}) },
          contents: [{ type: 0, content }],
          clientKey,
        },
      },
      traceId,
      extMap: EXT_MAP,
    });
    const result = await this.#ctx.sendRawPacket(DO_QUN_COMMENT_CMD, body, packetTimeoutMs());
    if (!result.success || !result.gotResponse || !result.responseData) {
      throw new Error(result.errorMessage || "failed to comment on album media");
    }
    const resp = decodeDoQunCommentResponse(result.responseData);
    const resultCode = resp.result ?? 0;
    if (resultCode !== 0) {
      throw new Error(`comment album media error: retCode ${String(resultCode)}` + (resp.errorText ? `, ${resp.errorText}` : ""));
    }
    const commentData = commentFromResponse(resp);
    if (!commentData.id) throw new Error("comment album media error: empty comment");
    return {
      id: commentData.id,
      user: { uin: commentData.user?.uin || uin },
      content: (
        commentData.content ?? [{ type: 0, content }]
      ).map((item) => ({ type: item.type ?? 0, content: item.content ?? "" })),
      time: uint64ToString(commentData.time),
      clientKey: commentData.clientKey || clientKey,
    };
  }

  /**
   * Like or unlike one media item.
   *
   * Both the request constant and the response constant are `5495` / `8694` —
   * `like` and `delete` validate the ECHO, not zero.
   */
  async like(groupId: number | bigint, albumId: string, batchId: string, lloc: string, isLike: boolean): Promise<unknown> {
    const uin = this.#ctx.identity.uin;
    const clientKey = this.#clientKey();
    const type = isLike ? 2 : 1;
    const status = isLike ? 0 : 1;
    const body = encodeDoQunLikeRequest({
      field1: DO_QUN_LIKE_SEQ,
      field2: QZONE_TRPC_STAMP,
      field3: QZONE_TRPC_STAMP,
      body: {
        type,
        like: { id: qunFeedCellId(groupId, albumId, batchId, lloc), status },
        publish: {
          cellCommon: { time: BigInt(Date.now()), feedId: `422_0_${batchId}` },
          cellUserInfo: { user: { uin } },
          cellMedia: { albumId, batchId: BigInt(batchId) },
          cellQunInfo: { qunId: groupId.toString() },
        },
        clientKey,
      },
      extMap: EXT_MAP,
    });
    const result = await this.#ctx.sendRawPacket(DO_QUN_LIKE_CMD, body, packetTimeoutMs());
    if (!result.success || !result.gotResponse || !result.responseData) {
      throw new Error(result.errorMessage || "failed to like album media");
    }
    const resp = decodeDoQunLikeResponse(result.responseData);
    const resCode = resp.field1;
    if (resCode !== DO_QUN_LIKE_SEQ) {
      throw new Error(`like album media error: retCode ${resCode === null ? "unknown" : String(resCode)}`);
    }
    return convertBigIntToString(resp.body?.like ?? {});
  }

  /**
   * Delete one media item.
   *
   * `resCode !== 8694 || errCode` is one condition, not two: a transport that
   * succeeded with the right echo and a non-zero `errCode` still means the media
   * is there, and the message names the server's own text.
   */
  async delete(groupId: number | bigint, albumId: string, lloc: string): Promise<{ success: true }> {
    const target = await this.resolveDeleteTarget(groupId, albumId, lloc);
    const clientKey = this.#clientKey();
    const body = encodeDeleteMediasRequest({
      field1: DELETE_MEDIAS_SEQ,
      field2: QZONE_TRPC_STAMP,
      field3: QZONE_TRPC_STAMP,
      body: {
        groupId: groupId.toString(),
        albumId,
        mediaIds: [target.mediaId],
        ...(target.batchId ? { batchIds: [target.batchId] } : {}),
      },
      traceId: clientKey,
      extMap: EXT_MAP,
    });
    const result = await this.#ctx.sendRawPacket(DELETE_MEDIAS_CMD, body, packetTimeoutMs());
    if (!result.success || !result.gotResponse || !result.responseData) {
      throw new Error(result.errorMessage || "failed to delete album media");
    }
    const resp = decodeDeleteMediasResponse(result.responseData);
    const resCode = resp.field1;
    const errCode = resp.field2;
    const errMsg = resp.field3;
    if (resCode !== DELETE_MEDIAS_SEQ || errCode) {
      throw new Error(`delete album media error [${errCode === null ? "unknown" : String(errCode)}]: ${errMsg ?? "unknown"}`);
    }
    return { success: true };
  }

  /**
   * Translate a media key into a delete target.
   *
   * Best-effort by design: any failure (transport, retCode, a page that never
   * contains the key) falls back to using the raw key so the caller still gets a
   * meaningful server answer instead of a local "not found".
   */
  async resolveDeleteTarget(groupId: number | bigint, albumId: string, mediaKey: string): Promise<DeleteTarget> {
    try {
      const seenCursors = new Set<string>();
      let attachInfo = "";
      for (;;) {
        const page = await this.getMediaList(groupId, albumId, attachInfo);
        const hit = findDeleteTarget(page.mediaList, mediaKey);
        if (hit) return hit;
        const next = page.nextAttachInfo ?? "";
        if (!next || seenCursors.has(next)) return { mediaId: mediaKey };
        seenCursors.add(next);
        attachInfo = next;
      }
    } catch (error) {
      log.debug(
        "resolve album delete target failed, using raw id: group=%s album=%s err=%s",
        String(groupId),
        albumId,
        error instanceof Error ? error.message : String(error),
      );
      return { mediaId: mediaKey };
    }
  }

  /**
   * Translate a media key into the item a comment needs.
   *
   * Fatal on a miss, unlike the delete walk: a comment with no `batchId` cannot
   * be built at all, so returning a partial item would only move the failure to
   * the server's parser.
   */
  async resolveCommentMedia(groupId: number | bigint, albumId: string, mediaKey: string): Promise<AlbumMediaItem | undefined> {
    const seenCursors = new Set<string>();
    let attachInfo = "";
    for (;;) {
      const page = await this.getMediaList(groupId, albumId, attachInfo);
      const hit = findCommentMedia(page.mediaList, mediaKey);
      if (hit) return hit;
      const next = page.nextAttachInfo ?? "";
      if (!next || seenCursors.has(next)) return undefined;
      seenCursors.add(next);
      attachInfo = next;
    }
  }

  /**
   * The feed detail behind one media item.
   *
   * The four `raw*` slices are the load-bearing output: they let the comment
   * request carry the server's own submessage bytes, so fields this codec does
   * not model survive the round trip. An empty feed id is fatal — it means the
   * server answered a different media item than the one asked for.
   */
  async getQunFeedDetail(
    groupId: number | bigint,
    albumId: string,
    batchId: bigint,
    lloc: string,
  ): Promise<QunFeedDetail> {
    const traceId = this.#traceId();
    const body = encodeGetQunFeedDetailRequest({
      seq: 0,
      field2: new Uint8Array(0),
      field3: new Uint8Array(0),
      data: {
        groupId: groupId.toString(),
        feedId: "",
        commentCount: GET_QUN_FEED_DETAIL_COMMENT_COUNT,
        attachInfo: "",
        albumId,
        batchId: batchId.toString(),
        lloc,
      },
      traceId,
      extMap: EXT_MAP,
    });
    const result = await this.#ctx.sendRawPacket(GET_QUN_FEED_DETAIL_CMD, body, packetTimeoutMs());
    if (!result.success || !result.gotResponse || !result.responseData) {
      throw new Error(result.errorMessage || "failed to fetch album feed");
    }
    const resp = decodeGetQunFeedDetailResponse(result.responseData);
    const resultCode = resp.result ?? 0;
    if (resultCode !== 0) {
      throw new Error(`fetch album feed error: retCode ${String(resultCode)}` + (resp.errorText ? `, ${resp.errorText}` : ""));
    }
    const feed = resp.data?.feed?.feed;
    const cell = feed?.cellCommon;
    const feedId = cell?.feedId ?? "";
    if (!feedId) throw new Error("comment album media error: empty feed");
    const responseBytes = result.responseData instanceof Uint8Array ? result.responseData : new Uint8Array(result.responseData);
    return {
      // The reference's fallback is `{ feedId }` and NOTHING else: `commentReqHeader`
      // tests `cell.time !== undefined`, so a `time: null` here would make the
      // header carry a `time` field it must not have.
      cellCommon: cell ?? EMPTY_CELL(feedId),
      ownerUin: feed?.cellUserInfo?.user?.uin ?? "",
      media: feed?.cellMedia ?? null,
      rawCellCommon: nonemptyBytes(protobufSubmessage(responseBytes, [4, 2, 1, 1])),
      rawCellUser: nonemptyBytes(protobufSubmessage(responseBytes, [4, 2, 1, 2])),
      rawCellMedia: nonemptyBytes(protobufSubmessage(responseBytes, [4, 2, 1, 5])),
    };
  }
}

/**
 * The feed-detail fallback cell: `{ feedId }` and nothing else.
 *
 * The other fields are `null` rather than 0 so `commentReqHeader` leaves them
 * out of the header. This is byte-equivalent to the reference's `cell ?? {
 * feedId }` because its header encoder drops a null `time` anyway — the two
 * only disagree in the intermediate object, never on the wire.
 */
function EMPTY_CELL(feedId: string): QunFeedCellCommon {
  return { type: null, time: null, feedId, cellId: null, field6: null };
}

/** `nonemptyBytes` — a zero-length slice is treated as absent so the fallback runs. */
export function nonemptyBytes(value: Uint8Array | undefined): Uint8Array | undefined {
  return value && value.byteLength > 0 ? value : undefined;
}