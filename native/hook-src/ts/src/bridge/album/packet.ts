// The protobuf codec for the group-album (群相册) packet commands.
//
// ---------------------------------------------------------------------------
// These are NOT OIDB commands, and that is why they live here
// ---------------------------------------------------------------------------
// `apis/group-album.ts` sends nine protobuf messages over five `trpc.qzone.*`
// wire names (`QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.GetAlbumList`, …)
// through `ctx.sendRawPacket`. No envelope, no command number, no service type;
// the whole payload is the message the reference's generated codec produces.
// There is therefore nothing in `ts/src/oidb/spec.ts` that could describe them,
// and putting them in `ts/src/oidb/services/` would invent an OIDB command that
// does not exist. They get their own module and reuse `oidb/wire.ts`'s
// primitives (`ProtoWriter`/`ProtoReader`), which is the only shared thing.
//
// ---------------------------------------------------------------------------
// Field numbers are not the property order
// ---------------------------------------------------------------------------
// The reference's generated writers assign tags from the *proto* definition, and
// the JS object literal in the bridge API lists the properties in declaration
// order, not field order. Six of the messages below disagree, and every one of
// them would still "work" against a lenient server while being wrong:
//
//   GetMediaListRequest.reqInfo      groupId=1  albumId=2  field3=3  field4=4  pageInfo=5
//   DoQunCommentRequestBody          groupId=**2**  field3=**3**  reqBody=**4**  field5=**5**
//   CommentReqContent                user=**2**  contents=**3**  clientKey=**7**
//   DoQunLikeReqBody                 type=**2**  like=**3**  publish=**4**  clientKey=**5**
//   DoQunLikeReqLikeInfo             id=1  status=**3**
//   GetQunFeedDetailReqData          groupId=**2**  feedId=**3**  commentCount=**4** … lloc=**8**
//
// Every number below is copied from the `case <tag>` arms of the reference's own
// decoder / the `buf[offset++] = <tag>` lines of its writer, and each message
// names its reference line range so the mapping stays auditable.
//
// ---------------------------------------------------------------------------
// Two presence rules that are not proto3 defaults
// ---------------------------------------------------------------------------
// 1. `field2`/`field3` of the request wrappers are `bytes` emitted on
//    `!= null` alone, so an EMPTY array still goes on the wire as `12 00`. The
//    bridge API always passes `new Uint8Array(0)`, which means the bytes are
//    always there; `ProtoWriter.bytes()` (drops empty) would silently shorten
//    every request by two bytes. They use `message()` instead.
// 2. `attachInfo` in `GetAlbumListReqData` is a string emitted on `!= null`
//    alone, so `""` encodes as `12 00`; it uses `stringPresent()`. (`ReqInfo`'s
//    `pageInfo` is the ordinary `!= ""` rule and encodes to nothing — the two
//    look identical in the bridge API and are not, reference/index.mjs:234750.)
//
// Reference region: src/bridge/apis/group-album.ts (reference/index.mjs:234750).

import { ProtoReader, ProtoWriter, tagOf, WireType } from "../../oidb/wire.js";

// ===========================================================================
// Field tables
// ===========================================================================

/** `OidbGetAlbumListRequest`; reference/index.mjs:234750 (`__size_GetAlbumListRequest`). */
export const GetAlbumListRequestField = {
  seq: 1,
  field2: 2,
  field3: 3,
  data: 4,
  traceId: 5,
  extMap: 10,
} as const;

/** `GetAlbumListReqData`. */
export const GetAlbumListReqDataField = { groupId: 1, attachInfo: 2 } as const;

/** The `(key, value)` entry in `extMap`; tag 82 on every wrapper request. */
export const ExtMapEntryField = { key: 1, value: 2 } as const;

/** `GetMediaListRequest`; reference/index.mjs:234750 (`__size_GetMediaListRequest`). */
export const GetMediaListRequestField = {
  field1: 1,
  field2: 2,
  field3: 3,
  reqInfo: 4,
  traceId: 5,
  extMap: 10,
} as const;

/** `ReqInfo` — note `pageInfo` is the *fifth* field. */
export const ReqInfoField = { groupId: 1, albumId: 2, field3: 3, field4: 4, pageInfo: 5 } as const;

/** `CommentReqBodyHeader` — field 6 is `field6`, fields 4/5 do not exist. */
export const CommentReqBodyHeaderField = { type: 1, time: 3, feedId: 4, cellId: 6, field6: 7 } as const;

/** `CommentReqBodyUserWrap` — a one-field wrapper around `CommentUser`. */
export const CommentReqBodyUserWrapField = { field1: 1 } as const;

/** `CommentUser` — `uin` at 13, `uinNum` at 14 (a uin in a *high* field, not field 1). */
export const CommentUserField = { uin: 13, uinNum: 14 } as const;

/** `CommentReqPhotoInfo` — `batchId` at 5. */
export const CommentReqPhotoInfoField = { medias: 1, albumId: 3, batchId: 5 } as const;

/** `MediaInfo`. */
export const MediaInfoField = {
  type: 1,
  image: 2,
  video: 3,
  uploader: 6,
  batchId: 7,
  uploadTime: 8,
} as const;

/** `ImageInfo`. */
export const ImageInfoField = {
  name: 1,
  sloc: 2,
  lloc: 3,
  photoUrls: 4,
  defaultUrl: 5,
  isGif: 6,
  hasRaw: 7,
} as const;

/** `PhotoUrl`. */
export const PhotoUrlField = { spec: 1, url: 2 } as const;

/** `UrlInfo`. */
export const UrlInfoField = { url: 1, width: 2, height: 3 } as const;

/** `VideoInfo` — `videoUrl` is repeated. */
export const VideoInfoField = {
  id: 1,
  url: 2,
  cover: 3,
  width: 4,
  height: 5,
  videoTime: 6,
  videoUrl: 7,
} as const;

/** `AlbumCreator` — six fields use the `!= null` (not `!= ""`) string rule. */
export const AlbumCreatorField = {
  uid: 1,
  nick: 2,
  isSweet: 5,
  isSpecial: 6,
  isSuperLike: 7,
  customId: 8,
  polyId: 9,
  portrait: 10,
  canFollow: 11,
  isFollowed: 12,
  uin: 13,
  dittoUin: 14,
} as const;

/** `GroupAlbumInfo`; reference/index.mjs:234879 (decode) / 234750 (tags). */
export const GroupAlbumInfoField = {
  albumId: 1,
  owner: 2,
  name: 3,
  description: 4,
  createTime: 5,
  modifyTime: 6,
  lastUploadTime: 7,
  uploadNumber: 8,
  cover: 9,
  creator: 10,
  topFlag: 11,
  busiType: 12,
  status: 13,
  allowShare: 15,
  isSubscribe: 16,
  bitmap: 17,
  isShareAlbum: 18,
  qzAlbumType: 20,
  coverType: 23,
  defaultDesc: 26,
  sortType: 30,
} as const;

/** `GetMediaListResponse` — like the request wrapper, `field2`/`field3` are raw bytes. */
export const GetMediaListResponseField = { field1: 1, field2: 2, field3: 3, data: 4 } as const;

/** `GetMediaListRspData` — `mediaList` is at 3, not 2. */
export const GetMediaListRspDataField = {
  albumInfo: 1,
  mediaList: 3,
  prevAttachInfo: 4,
  nextAttachInfo: 5,
} as const;

/** `GetMediaListAlbumInfo`. */
export const GetMediaListAlbumInfoField = { albumId: 1, owner: 2, name: 3 } as const;

/** `DoQunCommentRequest` — `extMap` at field 10. */
export const DoQunCommentRequestField = {
  field1: 1,
  field2: 2,
  field3: 3,
  body: 4,
  traceId: 5,
  extMap: 10,
} as const;

/** `DoQunCommentRequestBody` — `groupId` is field **2**. */
export const DoQunCommentRequestBodyField = {
  groupId: 2,
  field3: 3,
  reqBody: 4,
  field5: 5,
} as const;

/** `CommentReqBody` — three raw byte blobs, all `length > 0`. */
export const CommentReqBodyField = { field1: 1, field2: 2, field5: 5 } as const;

/** `CommentReqContent` — `user` at 2, `contents` at 3, `clientKey` at 7. */
export const CommentReqContentField = { user: 2, contents: 3, clientKey: 7 } as const;

/** `CommentContentItem` — `type` is emitted even when 0 (`!= null`). */
export const CommentContentItemField = { type: 1, content: 2 } as const;

/** `DoQunLikeRequest`. */
export const DoQunLikeRequestField = {
  field1: 1,
  field2: 2,
  field3: 3,
  body: 4,
  extMap: 10,
} as const;

/** `DoQunLikeReqBody` — `type` at 2, `like` at 3, `publish` at 4, `clientKey` at 5. */
export const DoQunLikeReqBodyField = { type: 2, like: 3, publish: 4, clientKey: 5 } as const;

/** `DoQunLikeReqLikeInfo` — `status` at 3. */
export const DoQunLikeReqLikeInfoField = { id: 1, status: 3 } as const;

/** `DoQunLikeReqFeedPublish` — `cellMedia` at 5, `cellQunInfo` at 12. */
export const DoQunLikeReqFeedPublishField = {
  cellCommon: 1,
  cellUserInfo: 2,
  cellMedia: 5,
  cellQunInfo: 12,
} as const;

/** `DoQunLikeReqCellCommon` — `time` at 3, `feedId` at 4. */
export const DoQunLikeReqCellCommonField = { time: 3, feedId: 4 } as const;

/** `DoQunLikeReqCellUserInfo`. */
export const DoQunLikeReqCellUserInfoField = { user: 1 } as const;

/** `DoQunLikeReqCellUser` — same high field as `CommentUser.uin`. */
export const DoQunLikeReqCellUserField = { uin: 13 } as const;

/** `DoQunLikeReqCellMedia` — `albumId` at 3, `batchId` at 5. */
export const DoQunLikeReqCellMediaField = { albumId: 3, batchId: 5 } as const;

/** `DoQunLikeReqCellQunInfo`. */
export const DoQunLikeReqCellQunInfoField = { qunId: 1 } as const;

/** `DeleteMediasRequest`. */
export const DeleteMediasRequestField = {
  field1: 1,
  field2: 2,
  field3: 3,
  body: 4,
  traceId: 5,
  extMap: 10,
} as const;

/** `DeleteMediasReqBody` — `batchIds` is a repeated **string**, not uint64. */
export const DeleteMediasReqBodyField = {
  groupId: 1,
  albumId: 2,
  mediaIds: 3,
  batchIds: 4,
} as const;

/** `DoQunLikeResponse`. */
export const DoQunLikeResponseField = { field1: 1, body: 2 } as const;

/** `DoQunLikeRespBody` — the result lives under `like` at field 2. */
export const DoQunLikeRespBodyField = { like: 2 } as const;

/** `DeleteMediasResponse`. */
export const DeleteMediasResponseField = { field1: 1, field2: 2, field3: 3 } as const;

/** `GetQunFeedDetailRequest`. */
export const GetQunFeedDetailRequestField = {
  seq: 1,
  field2: 2,
  field3: 3,
  data: 4,
  traceId: 5,
  extMap: 10,
} as const;

/** `GetQunFeedDetailReqData` — `groupId` at 2 through `lloc` at 8. */
export const GetQunFeedDetailReqDataField = {
  groupId: 2,
  feedId: 3,
  commentCount: 4,
  attachInfo: 5,
  albumId: 6,
  batchId: 7,
  lloc: 8,
} as const;

/** `GetQunFeedDetailResponse`. */
export const GetQunFeedDetailResponseField = { seq: 1, result: 2, errorText: 3, data: 4 } as const;

/** `GetQunFeedDetailRspData` — `feed` at 2. */
export const GetQunFeedDetailRspDataField = { feed: 2 } as const;

/** `QunClientFeed` — one-field wrapper. */
export const QunClientFeedField = { feed: 1 } as const;

/** `QunFeed` — `cellMedia` at 5, and it is a `CommentReqPhotoInfo` (reused message). */
export const QunFeedField = { cellCommon: 1, cellUserInfo: 2, cellMedia: 5 } as const;

/** `QunFeedCellCommon`. */
export const QunFeedCellCommonField = { type: 1, time: 3, feedId: 4, cellId: 5, field6: 6 } as const;

/** `QunFeedCellUserInfo`. */
export const QunFeedCellUserInfoField = { user: 1 } as const;

/** `QunFeedCellUser`. */
export const QunFeedCellUserField = { uin: 13 } as const;

/** `DoQunCommentResponse`. */
export const DoQunCommentResponseField = { field1: 1, result: 2, errorText: 3, comment: 4 } as const;

/** `DoQunCommentResponseComment` — `time` at 4, `clientKey` at 7. */
export const DoQunCommentResponseCommentField = {
  id: 1,
  data: 2,
  content: 3,
  time: 4,
  clientKey: 7,
} as const;

/** `CommentRespData` — same shape as the wrapper above, minus the wrapper. */
export const CommentRespDataField = {
  id: 1,
  user: 2,
  content: 3,
  time: 4,
  clientKey: 7,
} as const;

/** `CommentRespUser`. */
export const CommentRespUserField = { uin: 13 } as const;

/** `CommentRespContent`. */
export const CommentRespContentField = { type: 1, content: 2 } as const;

/** `GetAlbumListResponse`. */
export const GetAlbumListResponseField = { seq: 1, result: 2, errorText: 3, data: 4 } as const;

/** `GetAlbumListRspData`. */
export const GetAlbumListRspDataField = { albumList: 1, attachInfo: 2, hasMore: 3 } as const;

// ===========================================================================
// Wire types
// ===========================================================================

/** One `extMap` entry. */
export interface ExtMapEntry {
  key?: string;
  value?: string;
}

/** `GetAlbumListReqData`. */
export interface GetAlbumListReqData {
  groupId?: string;
  /** Emitted even when `""` (see the header's presence rule 2). */
  attachInfo?: string;
}

/** The `GetAlbumListRequest` body the bridge API builds. */
export interface GetAlbumListRequest {
  seq?: number;
  /** Always `new Uint8Array(0)` in practice, but always present on the wire. */
  field2?: Uint8Array;
  field3?: Uint8Array;
  data?: GetAlbumListReqData;
  traceId?: string;
  extMap?: ExtMapEntry[];
}

/** `ReqInfo`. */
export interface ReqInfo {
  groupId?: string;
  albumId?: string;
  field3?: number;
  field4?: string;
  /** Emitted even when `""`. */
  pageInfo?: string;
}

/** `GetMediaListRequest`. */
export interface GetMediaListRequest {
  field1?: number;
  field2?: Uint8Array;
  field3?: Uint8Array;
  reqInfo?: ReqInfo;
  traceId?: string;
  extMap?: ExtMapEntry[];
}

/** `UrlInfo`. */
export interface UrlInfo {
  url: string | null;
  width: number | null;
  height: number | null;
}

/** `PhotoUrl`. */
export interface PhotoUrl {
  spec: number | null;
  url: UrlInfo | null;
}

/** `ImageInfo`. */
export interface ImageInfo {
  name: string | null;
  sloc: string | null;
  lloc: string | null;
  photoUrls: PhotoUrl[];
  defaultUrl: UrlInfo | null;
  isGif: boolean | null;
  hasRaw: boolean | null;
}

/** `VideoInfo`. */
export interface VideoInfo {
  id: string | null;
  url: string | null;
  cover: ImageInfo | null;
  width: number | null;
  height: number | null;
  videoTime: bigint | null;
  videoUrl: PhotoUrl[];
}

/** `MediaInfo`. */
export interface MediaInfo {
  type: number | null;
  image: ImageInfo | null;
  video: VideoInfo | null;
  uploader: string | null;
  batchId: bigint | null;
  uploadTime: bigint | null;
}

/** `AlbumCreator`. */
export interface AlbumCreator {
  uid: string | null;
  nick: string | null;
  isSweet: boolean | null;
  isSpecial: boolean | null;
  isSuperLike: boolean | null;
  customId: string | null;
  polyId: string | null;
  portrait: string | null;
  canFollow: number | null;
  isFollowed: number | null;
  uin: string | null;
  dittoUin: string | null;
}

/** `GroupAlbumInfo`. */
export interface GroupAlbumInfo {
  albumId: string | null;
  owner: string | null;
  name: string | null;
  description: string | null;
  createTime: bigint | null;
  modifyTime: bigint | null;
  lastUploadTime: bigint | null;
  uploadNumber: bigint | null;
  cover: MediaInfo | null;
  creator: AlbumCreator | null;
  topFlag: bigint | null;
  busiType: number | null;
  status: number | null;
  allowShare: boolean | null;
  isSubscribe: boolean | null;
  bitmap: string | null;
  isShareAlbum: boolean | null;
  qzAlbumType: number | null;
  coverType: number | null;
  defaultDesc: string | null;
  sortType: number | null;
}

/** `GetAlbumListRspData`. */
export interface GetAlbumListRspData {
  albumList: GroupAlbumInfo[];
  attachInfo: string | null;
  hasMore: boolean | null;
}

/** `GetAlbumListResponse`. */
export interface GetAlbumListResponse {
  seq: number | null;
  result: number | null;
  errorText: string | null;
  data: GetAlbumListRspData | null;
}

/** `GetMediaListAlbumInfo`. */
export interface MediaListAlbumInfo {
  albumId: string | null;
  owner: string | null;
  name: string | null;
}

/** `GetMediaListRspData`. */
export interface GetMediaListRspData {
  albumInfo: MediaListAlbumInfo | null;
  mediaList: MediaInfo[];
  prevAttachInfo: string | null;
  nextAttachInfo: string | null;
}

/** `GetMediaListResponse` — `field2`/`field3` are opaque byte blobs. */
export interface GetMediaListResponse {
  field1: number | null;
  field2: Uint8Array | null;
  field3: Uint8Array | null;
  data: GetMediaListRspData | null;
}

/** `CommentReqPhotoInfo`, which `QunFeed.cellMedia` also reuses. */
export interface CommentReqPhotoInfo {
  medias: MediaInfo[];
  albumId: string | null;
  batchId: bigint | null;
}

/** `CommentRespContent`. */
export interface CommentRespContent {
  type: number | null;
  content: string | null;
}

/** `CommentRespUser`. */
export interface CommentRespUser {
  uin: string | null;
}

/** `CommentRespData`. */
export interface CommentRespData {
  id: string | null;
  user: CommentRespUser | null;
  content: CommentRespContent[];
  time: bigint | null;
  clientKey: string | null;
}

/** `DoQunCommentResponseComment`. */
export interface DoQunCommentResponseComment {
  id: string | null;
  data: CommentRespData | null;
  content: CommentRespContent[];
  time: bigint | null;
  clientKey: string | null;
}

/** `DoQunCommentResponse`. */
export interface DoQunCommentResponse {
  field1: number | null;
  result: number | null;
  errorText: string | null;
  comment: DoQunCommentResponseComment | null;
}

/** `DoQunLikeReqLikeInfo`. */
export interface DoQunLikeReqLikeInfo {
  id: string | null;
  status: number | null;
}

/** `DoQunLikeReqCellCommon`. */
export interface DoQunLikeReqCellCommon {
  time?: bigint;
  feedId?: string;
}

/** `DoQunLikeReqCellUser`. */
export interface DoQunLikeReqCellUser {
  uin?: string;
}

/** `DoQunLikeReqCellUserInfo`. */
export interface DoQunLikeReqCellUserInfo {
  user?: DoQunLikeReqCellUser;
}

/** `DoQunLikeReqCellMedia`. */
export interface DoQunLikeReqCellMedia {
  albumId?: string;
  batchId?: bigint;
}

/** `DoQunLikeReqCellQunInfo`. */
export interface DoQunLikeReqCellQunInfo {
  qunId?: string;
}

/** `DoQunLikeReqFeedPublish`. */
export interface DoQunLikeReqFeedPublish {
  cellCommon?: DoQunLikeReqCellCommon;
  cellUserInfo?: DoQunLikeReqCellUserInfo;
  cellMedia?: DoQunLikeReqCellMedia;
  cellQunInfo?: DoQunLikeReqCellQunInfo;
}

/** `DoQunLikeReqBody`. */
export interface DoQunLikeReqBody {
  type?: number;
  like?: DoQunLikeReqLikeInfo;
  publish?: DoQunLikeReqFeedPublish;
  clientKey?: string;
}

/** `DoQunLikeRequest`. */
export interface DoQunLikeRequest {
  field1?: number;
  field2?: string;
  field3?: string;
  body?: DoQunLikeReqBody;
  extMap?: ExtMapEntry[];
}

/** `DoQunLikeRespBody`. */
export interface DoQunLikeRespBody {
  like: DoQunLikeReqLikeInfo | null;
}

/** `DoQunLikeResponse`. */
export interface DoQunLikeResponse {
  field1: number | null;
  body: DoQunLikeRespBody | null;
}

/** `CommentReqBodyHeader`. */
export interface CommentReqBodyHeader {
  type?: number;
  time?: bigint;
  feedId?: string;
  cellId?: string;
  field6?: number;
}

/** `CommentUser`. */
export interface CommentUser {
  uin?: string;
  uinNum?: bigint;
}

/** `CommentContentItem` — `type` is written even when 0. */
export interface CommentContentItem {
  type?: number;
  content?: string;
}

/** `CommentReqContent` (the request's `field5`, the comment author payload). */
export interface CommentReqContent {
  user?: CommentUser;
  contents?: CommentContentItem[];
  clientKey?: string;
}

/** `CommentReqBody`. */
export interface CommentReqBody {
  field1?: Uint8Array;
  field2?: Uint8Array;
  field5?: Uint8Array;
}

/** `DoQunCommentRequestBody`. */
export interface DoQunCommentRequestBody {
  groupId?: string;
  field3?: number;
  reqBody?: CommentReqBody;
  field5?: CommentReqContent;
}

/** `DoQunCommentRequest`. */
export interface DoQunCommentRequest {
  field1?: number;
  field2?: Uint8Array;
  field3?: Uint8Array;
  body?: DoQunCommentRequestBody;
  traceId?: string;
  extMap?: ExtMapEntry[];
}

/** `DeleteMediasReqBody` — `batchIds` is repeated string. */
export interface DeleteMediasReqBody {
  groupId?: string;
  albumId?: string;
  mediaIds?: string[];
  batchIds?: string[];
}

/** `DeleteMediasRequest`. */
export interface DeleteMediasRequest {
  field1?: number;
  field2?: string;
  field3?: string;
  body?: DeleteMediasReqBody;
  traceId?: string;
  extMap?: ExtMapEntry[];
}

/** `DeleteMediasResponse`. */
export interface DeleteMediasResponse {
  field1: number | null;
  field2: number | null;
  field3: string | null;
}

/** `GetQunFeedDetailReqData`. */
export interface GetQunFeedDetailReqData {
  groupId?: string;
  feedId?: string;
  commentCount?: number;
  attachInfo?: string;
  albumId?: string;
  batchId?: string;
  lloc?: string;
}

/** `GetQunFeedDetailRequest`. */
export interface GetQunFeedDetailRequest {
  seq?: number;
  field2?: Uint8Array;
  field3?: Uint8Array;
  data?: GetQunFeedDetailReqData;
  traceId?: string;
  extMap?: ExtMapEntry[];
}

/** `QunFeedCellCommon`. */
export interface QunFeedCellCommon {
  type: number | null;
  time: bigint | null;
  feedId: string | null;
  cellId: string | null;
  field6: number | null;
}

/** `QunFeedCellUser`. */
export interface QunFeedCellUser {
  uin: string | null;
}

/** `QunFeedCellUserInfo`. */
export interface QunFeedCellUserInfo {
  user: QunFeedCellUser | null;
}

/** `QunFeed`. */
export interface QunFeed {
  cellCommon: QunFeedCellCommon | null;
  cellUserInfo: QunFeedCellUserInfo | null;
  cellMedia: CommentReqPhotoInfo | null;
}

/** `QunClientFeed`. */
export interface QunClientFeed {
  feed: QunFeed | null;
}

/** `GetQunFeedDetailRspData`. */
export interface GetQunFeedDetailRspData {
  feed: QunClientFeed | null;
}

/** `GetQunFeedDetailResponse`. */
export interface GetQunFeedDetailResponse {
  seq: number | null;
  result: number | null;
  errorText: string | null;
  data: GetQunFeedDetailRspData | null;
}

// ===========================================================================
// Encoders
// ===========================================================================

function encodeExtMapEntry(entry: ExtMapEntry): Uint8Array {
  return new ProtoWriter(32)
    .string(ExtMapEntryField.key, entry.key)
    .string(ExtMapEntryField.value, entry.value)
    .finish();
}

/** `GetAlbumListReqData`. */
export function encodeGetAlbumListReqData(data: GetAlbumListReqData): Uint8Array {
  return new ProtoWriter(64)
    .string(GetAlbumListReqDataField.groupId, data.groupId)
    .stringPresent(GetAlbumListReqDataField.attachInfo, data.attachInfo)
    .finish();
}

/** `GetAlbumListRequest` — the body of `QunMedia.GetAlbumList`. */
export function encodeGetAlbumListRequest(request: GetAlbumListRequest): Uint8Array {
  return new ProtoWriter(128)
    .uint32(GetAlbumListRequestField.seq, request.seq)
    // `message()`, not `bytes()`: an empty `field2` is still emitted as `12 00`.
    .message(GetAlbumListRequestField.field2, request.field2)
    .message(GetAlbumListRequestField.field3, request.field3)
    .message(
      GetAlbumListRequestField.data,
      request.data === undefined ? undefined : encodeGetAlbumListReqData(request.data),
    )
    .string(GetAlbumListRequestField.traceId, request.traceId)
    .repeatedMessage(
      GetAlbumListRequestField.extMap,
      request.extMap === undefined ? undefined : request.extMap.map(encodeExtMapEntry),
    )
    .finish();
}

/** `ReqInfo`. */
export function encodeReqInfo(info: ReqInfo): Uint8Array {
  return new ProtoWriter(96)
    .string(ReqInfoField.groupId, info.groupId)
    .string(ReqInfoField.albumId, info.albumId)
    .uint32(ReqInfoField.field3, info.field3)
    .string(ReqInfoField.field4, info.field4)
    .string(ReqInfoField.pageInfo, info.pageInfo)
    .finish();
}

/** `GetMediaListRequest` — the body of `QunMedia.GetMediaList`. */
export function encodeGetMediaListRequest(request: GetMediaListRequest): Uint8Array {
  return new ProtoWriter(128)
    .uint32(GetMediaListRequestField.field1, request.field1)
    .bytes(GetMediaListRequestField.field2, request.field2)
    .bytes(GetMediaListRequestField.field3, request.field3)
    .message(
      GetMediaListRequestField.reqInfo,
      request.reqInfo === undefined ? undefined : encodeReqInfo(request.reqInfo),
    )
    .string(GetMediaListRequestField.traceId, request.traceId)
    .repeatedMessage(
      GetMediaListRequestField.extMap,
      request.extMap === undefined ? undefined : request.extMap.map(encodeExtMapEntry),
    )
    .finish();
}

/** `CommentReqBodyHeader`. */
export function encodeCommentReqBodyHeader(header: CommentReqBodyHeader): Uint8Array {
  return new ProtoWriter(64)
    .uint32(CommentReqBodyHeaderField.type, header.type)
    .uint64(CommentReqBodyHeaderField.time, header.time)
    .string(CommentReqBodyHeaderField.feedId, header.feedId)
    .string(CommentReqBodyHeaderField.cellId, header.cellId)
    .uint32(CommentReqBodyHeaderField.field6, header.field6)
    .finish();
}

/** `CommentUser`. */
export function encodeCommentUser(user: CommentUser): Uint8Array {
  return new ProtoWriter(32)
    .string(CommentUserField.uin, user.uin)
    .uint64(CommentUserField.uinNum, user.uinNum)
    .finish();
}

/** `CommentReqBodyUserWrap`. */
export function encodeCommentReqBodyUserWrap(wrap: { field1?: CommentUser }): Uint8Array {
  return new ProtoWriter(32)
    .message(
      CommentReqBodyUserWrapField.field1,
      wrap.field1 === undefined ? undefined : encodeCommentUser(wrap.field1),
    )
    .finish();
}

/** `CommentReqPhotoInfo` — also used by `QunFeed.cellMedia`, hence its own export. */
export function encodeCommentReqPhotoInfo(info: CommentReqPhotoInfo): Uint8Array {
  return new ProtoWriter(64)
    .repeatedMessage(CommentReqPhotoInfoField.medias, info.medias.map(encodeMediaInfo))
    .string(CommentReqPhotoInfoField.albumId, info.albumId)
    .uint64(CommentReqPhotoInfoField.batchId, info.batchId)
    .finish();
}

/** `DoQunCommentRequest` — the body of `FeedsWriter.DoQunComment`. */
export function encodeDoQunCommentRequest(request: DoQunCommentRequest): Uint8Array {
  return new ProtoWriter(256)
    .uint32(DoQunCommentRequestField.field1, request.field1)
    .message(DoQunCommentRequestField.field2, request.field2)
    .message(DoQunCommentRequestField.field3, request.field3)
    .message(
      DoQunCommentRequestField.body,
      request.body === undefined ? undefined : encodeDoQunCommentRequestBody(request.body),
    )
    .string(DoQunCommentRequestField.traceId, request.traceId)
    .repeatedMessage(
      DoQunCommentRequestField.extMap,
      request.extMap === undefined ? undefined : request.extMap.map(encodeExtMapEntry),
    )
    .finish();
}

function encodeDoQunCommentRequestBody(body: DoQunCommentRequestBody): Uint8Array {
  return new ProtoWriter(192)
    .string(DoQunCommentRequestBodyField.groupId, body.groupId)
    .uint32(DoQunCommentRequestBodyField.field3, body.field3)
    .message(
      DoQunCommentRequestBodyField.reqBody,
      body.reqBody === undefined ? undefined : encodeCommentReqBody(body.reqBody),
    )
    .message(
      DoQunCommentRequestBodyField.field5,
      body.field5 === undefined ? undefined : encodeCommentReqContent(body.field5),
    )
    .finish();
}

function encodeCommentReqBody(body: CommentReqBody): Uint8Array {
  return new ProtoWriter(128)
    .bytes(CommentReqBodyField.field1, body.field1)
    .bytes(CommentReqBodyField.field2, body.field2)
    .bytes(CommentReqBodyField.field5, body.field5)
    .finish();
}

function encodeCommentReqContent(content: CommentReqContent): Uint8Array {
  return new ProtoWriter(96)
    .message(
      CommentReqContentField.user,
      content.user === undefined ? undefined : encodeCommentUser(content.user),
    )
    .repeatedMessage(
      CommentReqContentField.contents,
      content.contents === undefined
        ? undefined
        : content.contents.map((item) => encodeCommentContentItem(item)),
    )
    .string(CommentReqContentField.clientKey, content.clientKey)
    .finish();
}

function encodeCommentContentItem(item: CommentContentItem): Uint8Array {
  return new ProtoWriter(32)
    // `uint32Present`: `type: 0` is a real value here, not "absent".
    .uint32Present(CommentContentItemField.type, item.type)
    .string(CommentContentItemField.content, item.content)
    .finish();
}

/** `DoQunLikeRequest` — the body of `FeedsWriter.DoQunLike`. */
export function encodeDoQunLikeRequest(request: DoQunLikeRequest): Uint8Array {
  return new ProtoWriter(224)
    .uint32(DoQunLikeRequestField.field1, request.field1)
    .string(DoQunLikeRequestField.field2, request.field2)
    .string(DoQunLikeRequestField.field3, request.field3)
    .message(
      DoQunLikeRequestField.body,
      request.body === undefined ? undefined : encodeDoQunLikeReqBody(request.body),
    )
    .repeatedMessage(
      DoQunLikeRequestField.extMap,
      request.extMap === undefined ? undefined : request.extMap.map(encodeExtMapEntry),
    )
    .finish();
}

function encodeDoQunLikeReqBody(body: DoQunLikeReqBody): Uint8Array {
  return new ProtoWriter(160)
    .uint32(DoQunLikeReqBodyField.type, body.type)
    .message(
      DoQunLikeReqBodyField.like,
      body.like === undefined
        ? undefined
        : new ProtoWriter(32)
            .string(DoQunLikeReqLikeInfoField.id, body.like.id)
            .uint32(DoQunLikeReqLikeInfoField.status, body.like.status)
            .finish(),
    )
    .message(
      DoQunLikeReqBodyField.publish,
      body.publish === undefined ? undefined : encodeDoQunLikeReqFeedPublish(body.publish),
    )
    .string(DoQunLikeReqBodyField.clientKey, body.clientKey)
    .finish();
}

function encodeDoQunLikeReqFeedPublish(publish: DoQunLikeReqFeedPublish): Uint8Array {
  return new ProtoWriter(128)
    .message(
      DoQunLikeReqFeedPublishField.cellCommon,
      publish.cellCommon === undefined
        ? undefined
        : new ProtoWriter(32)
            .uint64(DoQunLikeReqCellCommonField.time, publish.cellCommon.time)
            .string(DoQunLikeReqCellCommonField.feedId, publish.cellCommon.feedId)
            .finish(),
    )
    .message(
      DoQunLikeReqFeedPublishField.cellUserInfo,
      publish.cellUserInfo === undefined
        ? undefined
        : new ProtoWriter(32)
            .message(
              DoQunLikeReqCellUserInfoField.user,
              publish.cellUserInfo.user === undefined
                ? undefined
                : new ProtoWriter(16)
                    .string(DoQunLikeReqCellUserField.uin, publish.cellUserInfo.user.uin)
                    .finish(),
            )
            .finish(),
    )
    .message(
      DoQunLikeReqFeedPublishField.cellMedia,
      publish.cellMedia === undefined
        ? undefined
        : new ProtoWriter(32)
            .string(DoQunLikeReqCellMediaField.albumId, publish.cellMedia.albumId)
            .uint64(DoQunLikeReqCellMediaField.batchId, publish.cellMedia.batchId)
            .finish(),
    )
    .message(
      DoQunLikeReqFeedPublishField.cellQunInfo,
      publish.cellQunInfo === undefined
        ? undefined
        : new ProtoWriter(24)
            .string(DoQunLikeReqCellQunInfoField.qunId, publish.cellQunInfo.qunId)
            .finish(),
    )
    .finish();
}

/** `DeleteMediasRequest` — the body of `QunMedia.DeleteMedias`. */
export function encodeDeleteMediasRequest(request: DeleteMediasRequest): Uint8Array {
  return new ProtoWriter(128)
    .uint32(DeleteMediasRequestField.field1, request.field1)
    .string(DeleteMediasRequestField.field2, request.field2)
    .string(DeleteMediasRequestField.field3, request.field3)
    .message(
      DeleteMediasRequestField.body,
      request.body === undefined ? undefined : encodeDeleteMediasReqBody(request.body),
    )
    .string(DeleteMediasRequestField.traceId, request.traceId)
    .repeatedMessage(
      DeleteMediasRequestField.extMap,
      request.extMap === undefined ? undefined : request.extMap.map(encodeExtMapEntry),
    )
    .finish();
}

function encodeDeleteMediasReqBody(body: DeleteMediasReqBody): Uint8Array {
  let writer = new ProtoWriter(96)
    .string(DeleteMediasReqBodyField.groupId, body.groupId)
    .string(DeleteMediasReqBodyField.albumId, body.albumId);
  // Per-element emission: the reference writes every array entry even when the
  // entry is `""`, so `repeatedString` (which skips empties) would diverge.
  for (const mediaId of body.mediaIds ?? []) {
    writer = writer.stringPresent(DeleteMediasReqBodyField.mediaIds, mediaId);
  }
  for (const batchId of body.batchIds ?? []) {
    writer = writer.stringPresent(DeleteMediasReqBodyField.batchIds, batchId);
  }
  return writer.finish();
}

/** `GetQunFeedDetailRequest` — the body of `FeedsReader.GetQunFeedDetail`. */
export function encodeGetQunFeedDetailRequest(request: GetQunFeedDetailRequest): Uint8Array {
  return new ProtoWriter(128)
    .uint32(GetQunFeedDetailRequestField.seq, request.seq)
    .message(GetQunFeedDetailRequestField.field2, request.field2)
    .message(GetQunFeedDetailRequestField.field3, request.field3)
    .message(
      GetQunFeedDetailRequestField.data,
      request.data === undefined ? undefined : encodeGetQunFeedDetailReqData(request.data),
    )
    .string(GetQunFeedDetailRequestField.traceId, request.traceId)
    .repeatedMessage(
      GetQunFeedDetailRequestField.extMap,
      request.extMap === undefined ? undefined : request.extMap.map(encodeExtMapEntry),
    )
    .finish();
}

function encodeGetQunFeedDetailReqData(data: GetQunFeedDetailReqData): Uint8Array {
  return new ProtoWriter(96)
    .string(GetQunFeedDetailReqDataField.groupId, data.groupId)
    .string(GetQunFeedDetailReqDataField.feedId, data.feedId)
    .uint32(GetQunFeedDetailReqDataField.commentCount, data.commentCount)
    .string(GetQunFeedDetailReqDataField.attachInfo, data.attachInfo)
    .string(GetQunFeedDetailReqDataField.albumId, data.albumId)
    .string(GetQunFeedDetailReqDataField.batchId, data.batchId)
    .string(GetQunFeedDetailReqDataField.lloc, data.lloc)
    .finish();
}

/**
 * `MediaInfo` — exported because `CommentReqPhotoInfo` reuses it and a caller
 * that builds a `cellMedia` by hand needs it.
 */
export function encodeMediaInfo(info: MediaInfo): Uint8Array {
  return new ProtoWriter(96)
    .uint32(MediaInfoField.type, info.type)
    .message(MediaInfoField.image, info.image === undefined || info.image === null ? undefined : encodeImageInfo(info.image))
    .message(MediaInfoField.video, info.video === undefined || info.video === null ? undefined : encodeVideoInfo(info.video))
    .string(MediaInfoField.uploader, info.uploader)
    .uint64(MediaInfoField.batchId, info.batchId)
    .uint64(MediaInfoField.uploadTime, info.uploadTime)
    .finish();
}

function encodeImageInfo(info: ImageInfo): Uint8Array {
  return new ProtoWriter(96)
    .string(ImageInfoField.name, info.name)
    .string(ImageInfoField.sloc, info.sloc)
    .string(ImageInfoField.lloc, info.lloc)
    .repeatedMessage(ImageInfoField.photoUrls, info.photoUrls.map(encodePhotoUrl))
    .message(ImageInfoField.defaultUrl, info.defaultUrl === null ? undefined : encodeUrlInfo(info.defaultUrl))
    .bool(ImageInfoField.isGif, info.isGif)
    .bool(ImageInfoField.hasRaw, info.hasRaw)
    .finish();
}

function encodePhotoUrl(url: PhotoUrl): Uint8Array {
  return new ProtoWriter(32).uint32(PhotoUrlField.spec, url.spec).message(PhotoUrlField.url, url.url === null ? undefined : encodeUrlInfo(url.url)).finish();
}

function encodeUrlInfo(info: UrlInfo): Uint8Array {
  return new ProtoWriter(48)
    .string(UrlInfoField.url, info.url)
    .uint32(UrlInfoField.width, info.width)
    .uint32(UrlInfoField.height, info.height)
    .finish();
}

function encodeVideoInfo(info: VideoInfo): Uint8Array {
  return new ProtoWriter(96)
    .string(VideoInfoField.id, info.id)
    .string(VideoInfoField.url, info.url)
    .message(VideoInfoField.cover, info.cover === null ? undefined : encodeImageInfo(info.cover))
    .uint32(VideoInfoField.width, info.width)
    .uint32(VideoInfoField.height, info.height)
    .uint64(VideoInfoField.videoTime, info.videoTime)
    .repeatedMessage(VideoInfoField.videoUrl, info.videoUrl.map(encodePhotoUrl))
    .finish();
}

// ===========================================================================
// Decoders
// ===========================================================================
//
// Absent scalars stay `null` rather than collapsing to 0/""/false: the business
// layer distinguishes "the server did not send this" from "it sent zero" in at
// least one place (`resp.field1 ?? 0` for the like/delete result codes), and a
// decoder that defaulted would erase that.

function readString(reader: ProtoReader): string {
  return reader.string();
}

/** `GetAlbumListResponse`. */
export function decodeGetAlbumListResponse(data: Uint8Array, offset = 0, end = data.length): GetAlbumListResponse {
  const reader = new ProtoReader(data, offset, end);
  const result: GetAlbumListResponse = { seq: null, result: null, errorText: null, data: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GetAlbumListResponseField.seq, WireType.varint):
        result.seq = reader.int32();
        break;
      case tagOf(GetAlbumListResponseField.result, WireType.varint):
        result.result = reader.int32();
        break;
      case tagOf(GetAlbumListResponseField.errorText, WireType.lengthDelimited):
        result.errorText = readString(reader);
        break;
      case tagOf(GetAlbumListResponseField.data, WireType.lengthDelimited):
        result.data = reader.message(decodeGetAlbumListRspData);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return result;
}

/** `GetAlbumListRspData`. */
export function decodeGetAlbumListRspData(data: Uint8Array, offset = 0, end = data.length): GetAlbumListRspData {
  const reader = new ProtoReader(data, offset, end);
  const result: GetAlbumListRspData = { albumList: [], attachInfo: null, hasMore: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GetAlbumListRspDataField.albumList, WireType.lengthDelimited):
        result.albumList.push(reader.message(decodeGroupAlbumInfo));
        break;
      case tagOf(GetAlbumListRspDataField.attachInfo, WireType.lengthDelimited):
        result.attachInfo = readString(reader);
        break;
      case tagOf(GetAlbumListRspDataField.hasMore, WireType.varint):
        result.hasMore = reader.bool();
        break;
      default:
        reader.skip();
        break;
    }
  }
  return result;
}

/** `GroupAlbumInfo`. */
export function decodeGroupAlbumInfo(data: Uint8Array, offset = 0, end = data.length): GroupAlbumInfo {
  const reader = new ProtoReader(data, offset, end);
  const album: GroupAlbumInfo = {
    albumId: null,
    owner: null,
    name: null,
    description: null,
    createTime: null,
    modifyTime: null,
    lastUploadTime: null,
    uploadNumber: null,
    cover: null,
    creator: null,
    topFlag: null,
    busiType: null,
    status: null,
    allowShare: null,
    isSubscribe: null,
    bitmap: null,
    isShareAlbum: null,
    qzAlbumType: null,
    coverType: null,
    defaultDesc: null,
    sortType: null,
  };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupAlbumInfoField.albumId, WireType.lengthDelimited):
        album.albumId = readString(reader);
        break;
      case tagOf(GroupAlbumInfoField.owner, WireType.lengthDelimited):
        album.owner = readString(reader);
        break;
      case tagOf(GroupAlbumInfoField.name, WireType.lengthDelimited):
        album.name = readString(reader);
        break;
      case tagOf(GroupAlbumInfoField.description, WireType.lengthDelimited):
        album.description = readString(reader);
        break;
      case tagOf(GroupAlbumInfoField.createTime, WireType.varint):
        album.createTime = reader.uint64();
        break;
      case tagOf(GroupAlbumInfoField.modifyTime, WireType.varint):
        album.modifyTime = reader.uint64();
        break;
      case tagOf(GroupAlbumInfoField.lastUploadTime, WireType.varint):
        album.lastUploadTime = reader.uint64();
        break;
      case tagOf(GroupAlbumInfoField.uploadNumber, WireType.varint):
        album.uploadNumber = reader.uint64();
        break;
      case tagOf(GroupAlbumInfoField.cover, WireType.lengthDelimited):
        album.cover = reader.message(decodeMediaInfo);
        break;
      case tagOf(GroupAlbumInfoField.creator, WireType.lengthDelimited):
        album.creator = reader.message(decodeAlbumCreator);
        break;
      case tagOf(GroupAlbumInfoField.topFlag, WireType.varint):
        album.topFlag = reader.uint64();
        break;
      case tagOf(GroupAlbumInfoField.busiType, WireType.varint):
        album.busiType = reader.int32();
        break;
      case tagOf(GroupAlbumInfoField.status, WireType.varint):
        album.status = reader.int32();
        break;
      case tagOf(GroupAlbumInfoField.allowShare, WireType.varint):
        album.allowShare = reader.bool();
        break;
      case tagOf(GroupAlbumInfoField.isSubscribe, WireType.varint):
        album.isSubscribe = reader.bool();
        break;
      case tagOf(GroupAlbumInfoField.bitmap, WireType.lengthDelimited):
        album.bitmap = readString(reader);
        break;
      case tagOf(GroupAlbumInfoField.isShareAlbum, WireType.varint):
        album.isShareAlbum = reader.bool();
        break;
      case tagOf(GroupAlbumInfoField.qzAlbumType, WireType.varint):
        album.qzAlbumType = reader.int32();
        break;
      case tagOf(GroupAlbumInfoField.coverType, WireType.varint):
        album.coverType = reader.int32();
        break;
      case tagOf(GroupAlbumInfoField.defaultDesc, WireType.lengthDelimited):
        album.defaultDesc = readString(reader);
        break;
      case tagOf(GroupAlbumInfoField.sortType, WireType.varint):
        album.sortType = reader.int32();
        break;
      default:
        reader.skip();
        break;
    }
  }
  return album;
}

/** `MediaInfo`. */
export function decodeMediaInfo(data: Uint8Array, offset = 0, end = data.length): MediaInfo {
  const reader = new ProtoReader(data, offset, end);
  const media: MediaInfo = { type: null, image: null, video: null, uploader: null, batchId: null, uploadTime: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(MediaInfoField.type, WireType.varint):
        media.type = reader.uint32();
        break;
      case tagOf(MediaInfoField.image, WireType.lengthDelimited):
        media.image = reader.message(decodeImageInfo);
        break;
      case tagOf(MediaInfoField.video, WireType.lengthDelimited):
        media.video = reader.message(decodeVideoInfo);
        break;
      case tagOf(MediaInfoField.uploader, WireType.lengthDelimited):
        media.uploader = readString(reader);
        break;
      case tagOf(MediaInfoField.batchId, WireType.varint):
        media.batchId = reader.uint64();
        break;
      case tagOf(MediaInfoField.uploadTime, WireType.varint):
        media.uploadTime = reader.uint64();
        break;
      default:
        reader.skip();
        break;
    }
  }
  return media;
}

/** `ImageInfo`. */
export function decodeImageInfo(data: Uint8Array, offset = 0, end = data.length): ImageInfo {
  const reader = new ProtoReader(data, offset, end);
  const image: ImageInfo = {
    name: null,
    sloc: null,
    lloc: null,
    photoUrls: [],
    defaultUrl: null,
    isGif: null,
    hasRaw: null,
  };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(ImageInfoField.name, WireType.lengthDelimited):
        image.name = readString(reader);
        break;
      case tagOf(ImageInfoField.sloc, WireType.lengthDelimited):
        image.sloc = readString(reader);
        break;
      case tagOf(ImageInfoField.lloc, WireType.lengthDelimited):
        image.lloc = readString(reader);
        break;
      case tagOf(ImageInfoField.photoUrls, WireType.lengthDelimited):
        image.photoUrls.push(reader.message(decodePhotoUrl));
        break;
      case tagOf(ImageInfoField.defaultUrl, WireType.lengthDelimited):
        image.defaultUrl = reader.message(decodeUrlInfo);
        break;
      case tagOf(ImageInfoField.isGif, WireType.varint):
        image.isGif = reader.bool();
        break;
      case tagOf(ImageInfoField.hasRaw, WireType.varint):
        image.hasRaw = reader.bool();
        break;
      default:
        reader.skip();
        break;
    }
  }
  return image;
}

/** `PhotoUrl`. */
export function decodePhotoUrl(data: Uint8Array, offset = 0, end = data.length): PhotoUrl {
  const reader = new ProtoReader(data, offset, end);
  const photo: PhotoUrl = { spec: null, url: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(PhotoUrlField.spec, WireType.varint):
        photo.spec = reader.uint32();
        break;
      case tagOf(PhotoUrlField.url, WireType.lengthDelimited):
        photo.url = reader.message(decodeUrlInfo);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return photo;
}

/** `UrlInfo`. */
export function decodeUrlInfo(data: Uint8Array, offset = 0, end = data.length): UrlInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: UrlInfo = { url: null, width: null, height: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(UrlInfoField.url, WireType.lengthDelimited):
        info.url = readString(reader);
        break;
      case tagOf(UrlInfoField.width, WireType.varint):
        info.width = reader.uint32();
        break;
      case tagOf(UrlInfoField.height, WireType.varint):
        info.height = reader.uint32();
        break;
      default:
        reader.skip();
        break;
    }
  }
  return info;
}

/** `VideoInfo`. */
export function decodeVideoInfo(data: Uint8Array, offset = 0, end = data.length): VideoInfo {
  const reader = new ProtoReader(data, offset, end);
  const video: VideoInfo = {
    id: null,
    url: null,
    cover: null,
    width: null,
    height: null,
    videoTime: null,
    videoUrl: [],
  };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(VideoInfoField.id, WireType.lengthDelimited):
        video.id = readString(reader);
        break;
      case tagOf(VideoInfoField.url, WireType.lengthDelimited):
        video.url = readString(reader);
        break;
      case tagOf(VideoInfoField.cover, WireType.lengthDelimited):
        video.cover = reader.message(decodeImageInfo);
        break;
      case tagOf(VideoInfoField.width, WireType.varint):
        video.width = reader.uint32();
        break;
      case tagOf(VideoInfoField.height, WireType.varint):
        video.height = reader.uint32();
        break;
      case tagOf(VideoInfoField.videoTime, WireType.varint):
        video.videoTime = reader.uint64();
        break;
      case tagOf(VideoInfoField.videoUrl, WireType.lengthDelimited):
        video.videoUrl.push(reader.message(decodePhotoUrl));
        break;
      default:
        reader.skip();
        break;
    }
  }
  return video;
}

/** `AlbumCreator`. */
export function decodeAlbumCreator(data: Uint8Array, offset = 0, end = data.length): AlbumCreator {
  const reader = new ProtoReader(data, offset, end);
  const creator: AlbumCreator = {
    uid: null,
    nick: null,
    isSweet: null,
    isSpecial: null,
    isSuperLike: null,
    customId: null,
    polyId: null,
    portrait: null,
    canFollow: null,
    isFollowed: null,
    uin: null,
    dittoUin: null,
  };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(AlbumCreatorField.uid, WireType.lengthDelimited):
        creator.uid = readString(reader);
        break;
      case tagOf(AlbumCreatorField.nick, WireType.lengthDelimited):
        creator.nick = readString(reader);
        break;
      case tagOf(AlbumCreatorField.isSweet, WireType.varint):
        creator.isSweet = reader.bool();
        break;
      case tagOf(AlbumCreatorField.isSpecial, WireType.varint):
        creator.isSpecial = reader.bool();
        break;
      case tagOf(AlbumCreatorField.isSuperLike, WireType.varint):
        creator.isSuperLike = reader.bool();
        break;
      case tagOf(AlbumCreatorField.customId, WireType.lengthDelimited):
        creator.customId = readString(reader);
        break;
      case tagOf(AlbumCreatorField.polyId, WireType.lengthDelimited):
        creator.polyId = readString(reader);
        break;
      case tagOf(AlbumCreatorField.portrait, WireType.lengthDelimited):
        creator.portrait = readString(reader);
        break;
      case tagOf(AlbumCreatorField.canFollow, WireType.varint):
        creator.canFollow = reader.int32();
        break;
      case tagOf(AlbumCreatorField.isFollowed, WireType.varint):
        creator.isFollowed = reader.int32();
        break;
      case tagOf(AlbumCreatorField.uin, WireType.lengthDelimited):
        creator.uin = readString(reader);
        break;
      case tagOf(AlbumCreatorField.dittoUin, WireType.lengthDelimited):
        creator.dittoUin = readString(reader);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return creator;
}

/** `GetMediaListResponse`. */
export function decodeGetMediaListResponse(data: Uint8Array, offset = 0, end = data.length): GetMediaListResponse {
  const reader = new ProtoReader(data, offset, end);
  const result: GetMediaListResponse = { field1: null, field2: null, field3: null, data: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GetMediaListResponseField.field1, WireType.varint):
        result.field1 = reader.int32();
        break;
      case tagOf(GetMediaListResponseField.field2, WireType.lengthDelimited):
        result.field2 = reader.bytes();
        break;
      case tagOf(GetMediaListResponseField.field3, WireType.lengthDelimited):
        result.field3 = reader.bytes();
        break;
      case tagOf(GetMediaListResponseField.data, WireType.lengthDelimited):
        result.data = reader.message(decodeGetMediaListRspData);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return result;
}

/** `GetMediaListRspData`. */
export function decodeGetMediaListRspData(data: Uint8Array, offset = 0, end = data.length): GetMediaListRspData {
  const reader = new ProtoReader(data, offset, end);
  const result: GetMediaListRspData = {
    albumInfo: null,
    mediaList: [],
    prevAttachInfo: null,
    nextAttachInfo: null,
  };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GetMediaListRspDataField.albumInfo, WireType.lengthDelimited):
        result.albumInfo = reader.message(decodeGetMediaListAlbumInfo);
        break;
      case tagOf(GetMediaListRspDataField.mediaList, WireType.lengthDelimited):
        result.mediaList.push(reader.message(decodeMediaInfo));
        break;
      case tagOf(GetMediaListRspDataField.prevAttachInfo, WireType.lengthDelimited):
        result.prevAttachInfo = readString(reader);
        break;
      case tagOf(GetMediaListRspDataField.nextAttachInfo, WireType.lengthDelimited):
        result.nextAttachInfo = readString(reader);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return result;
}

/** `GetMediaListAlbumInfo`. */
export function decodeGetMediaListAlbumInfo(data: Uint8Array, offset = 0, end = data.length): MediaListAlbumInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: MediaListAlbumInfo = { albumId: null, owner: null, name: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GetMediaListAlbumInfoField.albumId, WireType.lengthDelimited):
        info.albumId = readString(reader);
        break;
      case tagOf(GetMediaListAlbumInfoField.owner, WireType.lengthDelimited):
        info.owner = readString(reader);
        break;
      case tagOf(GetMediaListAlbumInfoField.name, WireType.lengthDelimited):
        info.name = readString(reader);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return info;
}

/** `CommentReqPhotoInfo`. */
export function decodeCommentReqPhotoInfo(data: Uint8Array, offset = 0, end = data.length): CommentReqPhotoInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: CommentReqPhotoInfo = { medias: [], albumId: null, batchId: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(CommentReqPhotoInfoField.medias, WireType.lengthDelimited):
        info.medias.push(reader.message(decodeMediaInfo));
        break;
      case tagOf(CommentReqPhotoInfoField.albumId, WireType.lengthDelimited):
        info.albumId = readString(reader);
        break;
      case tagOf(CommentReqPhotoInfoField.batchId, WireType.varint):
        info.batchId = reader.uint64();
        break;
      default:
        reader.skip();
        break;
    }
  }
  return info;
}

/** `DoQunCommentResponse`. */
export function decodeDoQunCommentResponse(data: Uint8Array, offset = 0, end = data.length): DoQunCommentResponse {
  const reader = new ProtoReader(data, offset, end);
  const result: DoQunCommentResponse = { field1: null, result: null, errorText: null, comment: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(DoQunCommentResponseField.field1, WireType.varint):
        result.field1 = reader.int32();
        break;
      case tagOf(DoQunCommentResponseField.result, WireType.varint):
        result.result = reader.int32();
        break;
      case tagOf(DoQunCommentResponseField.errorText, WireType.lengthDelimited):
        result.errorText = readString(reader);
        break;
      case tagOf(DoQunCommentResponseField.comment, WireType.lengthDelimited):
        result.comment = reader.message(decodeDoQunCommentResponseComment);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return result;
}

/** `DoQunCommentResponseComment`. */
export function decodeDoQunCommentResponseComment(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): DoQunCommentResponseComment {
  const reader = new ProtoReader(data, offset, end);
  const comment: DoQunCommentResponseComment = {
    id: null,
    data: null,
    content: [],
    time: null,
    clientKey: null,
  };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(DoQunCommentResponseCommentField.id, WireType.lengthDelimited):
        comment.id = readString(reader);
        break;
      case tagOf(DoQunCommentResponseCommentField.data, WireType.lengthDelimited):
        comment.data = reader.message(decodeCommentRespData);
        break;
      case tagOf(DoQunCommentResponseCommentField.content, WireType.lengthDelimited):
        comment.content.push(reader.message(decodeCommentRespContent));
        break;
      case tagOf(DoQunCommentResponseCommentField.time, WireType.varint):
        comment.time = reader.uint64();
        break;
      case tagOf(DoQunCommentResponseCommentField.clientKey, WireType.lengthDelimited):
        comment.clientKey = readString(reader);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return comment;
}

/** `CommentRespData`. */
export function decodeCommentRespData(data: Uint8Array, offset = 0, end = data.length): CommentRespData {
  const reader = new ProtoReader(data, offset, end);
  const comment: CommentRespData = { id: null, user: null, content: [], time: null, clientKey: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(CommentRespDataField.id, WireType.lengthDelimited):
        comment.id = readString(reader);
        break;
      case tagOf(CommentRespDataField.user, WireType.lengthDelimited):
        comment.user = reader.message(decodeCommentRespUser);
        break;
      case tagOf(CommentRespDataField.content, WireType.lengthDelimited):
        comment.content.push(reader.message(decodeCommentRespContent));
        break;
      case tagOf(CommentRespDataField.time, WireType.varint):
        comment.time = reader.uint64();
        break;
      case tagOf(CommentRespDataField.clientKey, WireType.lengthDelimited):
        comment.clientKey = readString(reader);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return comment;
}

/** `CommentRespUser`. */
export function decodeCommentRespUser(data: Uint8Array, offset = 0, end = data.length): CommentRespUser {
  const reader = new ProtoReader(data, offset, end);
  const user: CommentRespUser = { uin: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(CommentRespUserField.uin, WireType.lengthDelimited):
        user.uin = readString(reader);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return user;
}

/** `CommentRespContent`. */
export function decodeCommentRespContent(data: Uint8Array, offset = 0, end = data.length): CommentRespContent {
  const reader = new ProtoReader(data, offset, end);
  const item: CommentRespContent = { type: null, content: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(CommentRespContentField.type, WireType.varint):
        item.type = reader.uint32();
        break;
      case tagOf(CommentRespContentField.content, WireType.lengthDelimited):
        item.content = readString(reader);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return item;
}

/** `DoQunLikeReqLikeInfo` as a decoder — the like response echoes the request shape. */
export function decodeDoQunLikeReqLikeInfo(data: Uint8Array, offset = 0, end = data.length): DoQunLikeReqLikeInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: DoQunLikeReqLikeInfo = { id: null, status: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(DoQunLikeReqLikeInfoField.id, WireType.lengthDelimited):
        info.id = readString(reader);
        break;
      case tagOf(DoQunLikeReqLikeInfoField.status, WireType.varint):
        info.status = reader.uint32();
        break;
      default:
        reader.skip();
        break;
    }
  }
  return info;
}

/** `DoQunLikeResponse`. */
export function decodeDoQunLikeResponse(data: Uint8Array, offset = 0, end = data.length): DoQunLikeResponse {
  const reader = new ProtoReader(data, offset, end);
  const result: DoQunLikeResponse = { field1: null, body: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(DoQunLikeResponseField.field1, WireType.varint):
        result.field1 = reader.int32();
        break;
      case tagOf(DoQunLikeResponseField.body, WireType.lengthDelimited):
        result.body = reader.message(decodeDoQunLikeRespBody);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return result;
}

/** `DoQunLikeRespBody`. */
export function decodeDoQunLikeRespBody(data: Uint8Array, offset = 0, end = data.length): DoQunLikeRespBody {
  const reader = new ProtoReader(data, offset, end);
  const body: DoQunLikeRespBody = { like: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(DoQunLikeRespBodyField.like, WireType.lengthDelimited):
        body.like = reader.message(decodeDoQunLikeReqLikeInfo);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return body;
}

/** `DeleteMediasResponse`. */
export function decodeDeleteMediasResponse(data: Uint8Array, offset = 0, end = data.length): DeleteMediasResponse {
  const reader = new ProtoReader(data, offset, end);
  const result: DeleteMediasResponse = { field1: null, field2: null, field3: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(DeleteMediasResponseField.field1, WireType.varint):
        result.field1 = reader.int32();
        break;
      case tagOf(DeleteMediasResponseField.field2, WireType.varint):
        result.field2 = reader.int32();
        break;
      case tagOf(DeleteMediasResponseField.field3, WireType.lengthDelimited):
        result.field3 = readString(reader);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return result;
}

/** `GetQunFeedDetailResponse`. */
export function decodeGetQunFeedDetailResponse(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GetQunFeedDetailResponse {
  const reader = new ProtoReader(data, offset, end);
  const result: GetQunFeedDetailResponse = { seq: null, result: null, errorText: null, data: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GetQunFeedDetailResponseField.seq, WireType.varint):
        result.seq = reader.int32();
        break;
      case tagOf(GetQunFeedDetailResponseField.result, WireType.varint):
        result.result = reader.int32();
        break;
      case tagOf(GetQunFeedDetailResponseField.errorText, WireType.lengthDelimited):
        result.errorText = readString(reader);
        break;
      case tagOf(GetQunFeedDetailResponseField.data, WireType.lengthDelimited):
        result.data = reader.message(decodeGetQunFeedDetailRspData);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return result;
}

/** `GetQunFeedDetailRspData`. */
export function decodeGetQunFeedDetailRspData(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GetQunFeedDetailRspData {
  const reader = new ProtoReader(data, offset, end);
  const result: GetQunFeedDetailRspData = { feed: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GetQunFeedDetailRspDataField.feed, WireType.lengthDelimited):
        result.feed = reader.message(decodeQunClientFeed);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return result;
}

/** `QunClientFeed`. */
export function decodeQunClientFeed(data: Uint8Array, offset = 0, end = data.length): QunClientFeed {
  const reader = new ProtoReader(data, offset, end);
  const feed: QunClientFeed = { feed: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(QunClientFeedField.feed, WireType.lengthDelimited):
        feed.feed = reader.message(decodeQunFeed);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return feed;
}

/** `QunFeed`. */
export function decodeQunFeed(data: Uint8Array, offset = 0, end = data.length): QunFeed {
  const reader = new ProtoReader(data, offset, end);
  const feed: QunFeed = { cellCommon: null, cellUserInfo: null, cellMedia: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(QunFeedField.cellCommon, WireType.lengthDelimited):
        feed.cellCommon = reader.message(decodeQunFeedCellCommon);
        break;
      case tagOf(QunFeedField.cellUserInfo, WireType.lengthDelimited):
        feed.cellUserInfo = reader.message(decodeQunFeedCellUserInfo);
        break;
      case tagOf(QunFeedField.cellMedia, WireType.lengthDelimited):
        feed.cellMedia = reader.message(decodeCommentReqPhotoInfo);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return feed;
}

/** `QunFeedCellCommon`. */
export function decodeQunFeedCellCommon(data: Uint8Array, offset = 0, end = data.length): QunFeedCellCommon {
  const reader = new ProtoReader(data, offset, end);
  const cell: QunFeedCellCommon = { type: null, time: null, feedId: null, cellId: null, field6: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(QunFeedCellCommonField.type, WireType.varint):
        cell.type = reader.uint32();
        break;
      case tagOf(QunFeedCellCommonField.time, WireType.varint):
        cell.time = reader.uint64();
        break;
      case tagOf(QunFeedCellCommonField.feedId, WireType.lengthDelimited):
        cell.feedId = readString(reader);
        break;
      case tagOf(QunFeedCellCommonField.cellId, WireType.lengthDelimited):
        cell.cellId = readString(reader);
        break;
      case tagOf(QunFeedCellCommonField.field6, WireType.varint):
        cell.field6 = reader.uint32();
        break;
      default:
        reader.skip();
        break;
    }
  }
  return cell;
}

/** `QunFeedCellUserInfo`. */
export function decodeQunFeedCellUserInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): QunFeedCellUserInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: QunFeedCellUserInfo = { user: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(QunFeedCellUserInfoField.user, WireType.lengthDelimited):
        info.user = reader.message(decodeQunFeedCellUser);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return info;
}

/** `QunFeedCellUser`. */
export function decodeQunFeedCellUser(data: Uint8Array, offset = 0, end = data.length): QunFeedCellUser {
  const reader = new ProtoReader(data, offset, end);
  const user: QunFeedCellUser = { uin: null };
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(QunFeedCellUserField.uin, WireType.lengthDelimited):
        user.uin = readString(reader);
        break;
      default:
        reader.skip();
        break;
    }
  }
  return user;
}

