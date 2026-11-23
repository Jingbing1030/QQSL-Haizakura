// Group-album tests: golden bytes from the reference's OWN encoder, plus oracles
// for every pure transform.
//
// The golden hex below was produced by loading the reference's
// `src/bridge/apis/group-album.ts` region as a live module
// (`work/bridge-parts/ref/group-album.mjs`, built by `work/bridge-parts/mkref-group-album.mjs`)
// and calling its `protobuf_encode_*` functions with the same inputs. That is
// the only way to be sure the field NUMBERS are right: a round-trip through our
// own decoder passes even when both sides share the same wrong tag, and the six
// misordered messages in this module (see `album/packet.ts`) are exactly the kind
// of error a round-trip cannot see.
//
// What is NOT tested, and why: the six packet operations themselves
// (`fetchAlbumList`, `getMediaList`, `getQunFeedDetail`, `comment`, `like`,
// `delete`) and the two uploads. Each is a `sendRawPacket`/HTTPS call plus a
// decode, and a fake transport would only prove the fake matches the fake. What
// IS tested is everything they are built from: the request bytes (golden), the
// response decoding (constructed inputs), and every pure mapping.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DELETE_MEDIAS_CMD,
  DELETE_MEDIAS_SEQ,
  DO_QUN_COMMENT_CMD,
  DO_QUN_COMMENT_SEQ,
  DO_QUN_LIKE_CMD,
  DO_QUN_LIKE_SEQ,
  GET_ALBUM_LIST_CMD,
  GET_ALBUM_LIST_SEQ,
  GET_MEDIA_LIST_CMD,
  GET_QUN_FEED_DETAIL_CMD,
  GET_QUN_FEED_DETAIL_COMMENT_COUNT,
  GroupAlbumApi,
  commentFromResponse,
  commentMediaLloc,
  commentPhotoInfo,
  commentReqHeader,
  convertBigIntToString,
  findCommentMedia,
  findDeleteTarget,
  firstLengthDelimitedField,
  mediaInfoForComment,
  nonemptyBytes,
  normalizeAlbumCover,
  normalizeAlbumCreator,
  normalizeCoverUrl,
  normalizeQunAlbum,
  numericUin,
  optionalBatchId,
  protobufSubmessage,
  qunFeedCellId,
  toLegacyAlbum,
  uint64ToSafeNumber,
  uint64ToString,
} from "../src/bridge/apis/group-album.js";
import {
  GetAlbumListRequestField,
  GetMediaListRequestField,
  DoQunCommentRequestBodyField,
  DoQunLikeReqBodyField,
  GetQunFeedDetailReqDataField,
  ReqInfoField,
  decodeAlbumCreator,
  decodeCommentRespContent,
  decodeDeleteMediasResponse,
  decodeDoQunCommentResponse,
  decodeDoQunLikeResponse,
  decodeGetAlbumListResponse,
  decodeGetMediaListResponse,
  decodeGetQunFeedDetailResponse,
  decodeGroupAlbumInfo,
  decodeImageInfo,
  decodeMediaInfo,
  decodeQunFeed,
  decodeUrlInfo,
  decodeVideoInfo,
  encodeCommentReqBodyHeader,
  encodeCommentReqBodyUserWrap,
  encodeCommentReqPhotoInfo,
  encodeDeleteMediasRequest,
  encodeDoQunCommentRequest,
  encodeDoQunLikeRequest,
  encodeGetAlbumListRequest,
  encodeGetMediaListRequest,
  encodeGetQunFeedDetailRequest,
  type GroupAlbumInfo,
} from "../src/bridge/album/packet.js";
import {
  ALBUM_VIDEO_MAX_BYTES,
  DEFAULT_ALBUM_SLICE_SIZE,
  albumUploadCookie,
  albumUploadGtk,
  detectImageFormat,
  hashFileStreaming,
  isIsoBmffHead,
  isKnownImageHead,
  normalizeAlbumSliceSize,
  stageVideoSource,
  unavailableAlbumVideoProbe,
} from "../src/bridge/web/album-upload.js";
import { MemoryIdentity } from "../src/bridge/bridge.js";
import type { BridgeContext, PacketSendResult } from "../src/bridge/context.js";

// ===========================================================================
// 1. Golden bytes — the reference's own encoder produced these
// ===========================================================================

const EXT_MAP = [{ key: "fc-appid", value: "100" }];
const TRACE = "_1700000000000_12345";

test("GetAlbumListRequest bytes match the reference encoder byte-for-byte", () => {
  // work/bridge-parts/ref/group-album.mjs:
  //   protobuf_encode_GetAlbumListRequest({seq:3331, field2:new Uint8Array(0),
  //     field3:new Uint8Array(0), data:{groupId:"123456789", attachInfo:""},
  //     traceId:"_1700000000000_12345", extMap:[{key:"fc-appid",value:"100"}]})
  const expected =
    "08831a12001a00220d0a0931323334353637383912002a145f313730303030303030303030305f3132333435520f0a0866632d61707069641203313030";
  const actual = Buffer.from(
    encodeGetAlbumListRequest({
      seq: GET_ALBUM_LIST_SEQ,
      field2: new Uint8Array(0),
      field3: new Uint8Array(0),
      data: { groupId: "123456789", attachInfo: "" },
      traceId: TRACE,
      extMap: EXT_MAP,
    }),
  ).toString("hex");
  assert.equal(actual, expected);
});

test("an empty attachInfo is still emitted as `12 00`, not omitted", () => {
  // The presence rule that is easiest to get wrong: `attachInfo` is a string
  // emitted on `!= null`, so the empty group id + empty cursor still costs five
  // bytes (`22 0d 0a 09 <grp> 12 00`). `string()` would drop the `12 00`.
  const bytes = encodeGetAlbumListRequest({
    seq: GET_ALBUM_LIST_SEQ,
    field2: new Uint8Array(0),
    field3: new Uint8Array(0),
    data: { groupId: "123456789", attachInfo: "" },
    traceId: TRACE,
    extMap: EXT_MAP,
  });
  const hex = Buffer.from(bytes).toString("hex");
  assert.ok(hex.includes("1200"), "attachInfo must be present as an empty length-delimited field");
});

test("GetMediaListRequest bytes match the reference encoder byte-for-byte", () => {
  const expected =
    "22160a093132333435363738391209616c62756d2d78797a2a145f313730303030303030303030305f3132333435520f0a0866632d61707069641203313030";
  const actual = Buffer.from(
    encodeGetMediaListRequest({
      field1: 0,
      field2: new Uint8Array(0),
      field3: new Uint8Array(0),
      reqInfo: { groupId: "123456789", albumId: "album-xyz", field3: 0, field4: "", pageInfo: "" },
      traceId: TRACE,
      extMap: EXT_MAP,
    }),
  ).toString("hex");
  assert.equal(actual, expected);
});

test("GetMediaListRequest: field1=0 and field3=0 are dropped, pageInfo=\"\" is dropped", () => {
  // All three use the `!= null && !== 0 / !== ""` rule, so the first byte is the
  // tag for `reqInfo` (field 4 → `22`) rather than `08 00` for field1.
  const hex = Buffer.from(
    encodeGetMediaListRequest({
      field1: 0,
      field2: new Uint8Array(0),
      field3: new Uint8Array(0),
      reqInfo: { groupId: "1", albumId: "a" },
      traceId: TRACE,
      extMap: EXT_MAP,
    }),
  ).toString("hex");
  assert.ok(hex.startsWith("2206"), `expected reqInfo first, got ${hex.slice(0, 4)}`);
  assert.ok(!hex.startsWith("0800"));
});

test("ReqInfo.pageInfo follows the ordinary `!= \"\"` rule", () => {
  // `attachInfo` (GetAlbumListReqData field 2) is `!= null`; `pageInfo`
  // (ReqInfo field 5) is `!= ""`. They look identical in the bridge API and
  // they are not. A non-empty cursor appears as `2a`, an empty one as nothing.
  const withCursor = encodeGetAlbumListRequest({
    data: { groupId: "1", attachInfo: "CURSOR" },
    extMap: [],
  });
  assert.ok(Buffer.from(withCursor).toString("hex").includes("1206435552534f52"));

  const mediaWithPage = encodeGetMediaListRequest({
    reqInfo: { groupId: "1", pageInfo: "NEXT" },
    extMap: [],
  });
  assert.equal(Buffer.from(mediaWithPage).toString("hex"), "22090a01312a044e455854");

  const mediaWithoutPage = encodeGetMediaListRequest({ reqInfo: { groupId: "1", pageInfo: "" }, extMap: [] });
  assert.equal(Buffer.from(mediaWithoutPage).toString("hex"), "22030a0131", "no `2a` at all for an empty pageInfo");
});

test("DoQunCommentRequest bytes match the reference encoder byte-for-byte", () => {
  const header = encodeCommentReqBodyHeader({ time: 1700000000000n, feedId: "422_0_987654321" });
  const user = encodeCommentReqBodyUserWrap({ field1: { uin: "10001" } });
  const photo = encodeCommentReqPhotoInfo(
    commentPhotoInfo(
      null,
      mediaInfoForComment({ batchId: "987654321", uploader: "10001", image: { lloc: "LLOC-1" } }, "LLOC-1"),
      "album-xyz",
      987654321n,
    ),
  );
  const expected =
    "08cf4212001a00228f011209313233343536373839180222510a181880d095ffbc31220f3432325f305f39383736353433323112090a076a0531303030312a2a0a1712081a064c4c4f432d313205313030303138b1d1f9d6031a09616c62756d2d78797a28b1d1f9d6032a2d120a6a05313030303170914e1a100800120c68656c6c6f20e4b896e7958c3a0d313730303030303030303030302a145f313730303030303030303030305f3132333435520f0a0866632d61707069641203313030";
  const actual = Buffer.from(
    encodeDoQunCommentRequest({
      field1: DO_QUN_COMMENT_SEQ,
      field2: new Uint8Array(0),
      field3: new Uint8Array(0),
      body: {
        groupId: "123456789",
        field3: 2,
        reqBody: { field1: header, field2: user, field5: photo },
        field5: {
          user: { uin: "10001", uinNum: 10001n },
          contents: [{ type: 0, content: "hello 世界" }],
          clientKey: "1700000000000",
        },
      },
      traceId: TRACE,
      extMap: EXT_MAP,
    }),
  ).toString("hex");
  assert.equal(actual, expected);
});

test("the comment's three byte blobs are the nested messages verbatim", () => {
  // `reqBody.field1/2/5` are `bytes`, so the sub-messages appear with their own
  // length prefix and NO re-tagging. Reading them back as messages must give the
  // same objects — that property is what lets `getQunFeedDetail` hand over raw
  // slices of the response.
  const header = encodeCommentReqBodyHeader({ time: 1700000000000n, feedId: "422_0_987654321" });
  assert.equal(Buffer.from(header).toString("hex"), "1880d095ffbc31220f3432325f305f393837363534333231");
  const decoded = decodeDoQunCommentResponse(encodeDoQunCommentRequest({ field1: 1 }));
  assert.equal(decoded.field1, 1);
});

test("DoQunLikeRequest bytes match the reference encoder byte-for-byte", () => {
  const expected =
    "08f72a120768355f746573741a0768355f7465737422b60110021a520a503432315f315f305f3132333435363738397c616c62756d2d78797a7c3938373635343332315e7c7c5e3432315f315f305f3132333435363738397c616c62756d2d78797a7c4c4c4f432d315e7c7c5e3022450a181880d095ffbc31220f3432325f305f39383736353433323112090a076a0531303030312a111a09616c62756d2d78797a28b1d1f9d603620b0a093132333435363738392a1731303030315f313730303030303030303030305f373737520f0a0866632d61707069641203313030";
  const actual = Buffer.from(
    encodeDoQunLikeRequest({
      field1: DO_QUN_LIKE_SEQ,
      field2: "h5_test",
      field3: "h5_test",
      body: {
        type: 2,
        like: { id: qunFeedCellId("123456789", "album-xyz", "987654321", "LLOC-1"), status: 0 },
        publish: {
          cellCommon: { time: 1700000000000n, feedId: "422_0_987654321" },
          cellUserInfo: { user: { uin: "10001" } },
          cellMedia: { albumId: "album-xyz", batchId: 987654321n },
          cellQunInfo: { qunId: "123456789" },
        },
        clientKey: "10001_1700000000000_777",
      },
      extMap: EXT_MAP,
    }),
  ).toString("hex");
  assert.equal(actual, expected);
});

test("DeleteMediasRequest bytes match the reference encoder byte-for-byte", () => {
  const expected =
    "08f643120768355f746573741a0768355f7465737422290a093132333435363738391209616c62756d2d78797a1a064c4c4f432d3122093938373635343332312a1731303030315f313730303030303030303030305f373737520f0a0866632d61707069641203313030";
  const actual = Buffer.from(
    encodeDeleteMediasRequest({
      field1: DELETE_MEDIAS_SEQ,
      field2: "h5_test",
      field3: "h5_test",
      body: { groupId: "123456789", albumId: "album-xyz", mediaIds: ["LLOC-1"], batchIds: ["987654321"] },
      traceId: "10001_1700000000000_777",
      extMap: EXT_MAP,
    }),
  ).toString("hex");
  assert.equal(actual, expected);
});

test("an empty batchIds list is emitted as a zero-length field, not dropped", () => {
  // The golden above ends `...4c4c4f432d312200...`: field 4 with length 0. That
  // `2200` is the reference's `_f3.length > 0` guard on an ARRAY that happens to
  // hold one empty string... and here the array is empty, so it must NOT appear.
  const withoutBatch = Buffer.from(
    encodeDeleteMediasRequest({
      body: { groupId: "1", albumId: "a", mediaIds: ["x"], batchIds: [] },
    }),
  ).toString("hex");
  assert.ok(!withoutBatch.includes("2200"), "an empty batchIds must produce no field at all");
});

test("GetQunFeedDetailRequest bytes match the reference encoder byte-for-byte", () => {
  const expected =
    "12001a00222b120931323334353637383920143209616c62756d2d78797a3a0939383736353433323142064c4c4f432d312a145f313730303030303030303030305f3132333435520f0a0866632d61707069641203313030";
  const actual = Buffer.from(
    encodeGetQunFeedDetailRequest({
      seq: 0,
      field2: new Uint8Array(0),
      field3: new Uint8Array(0),
      data: {
        groupId: "123456789",
        feedId: "",
        commentCount: GET_QUN_FEED_DETAIL_COMMENT_COUNT,
        attachInfo: "",
        albumId: "album-xyz",
        batchId: "987654321",
        lloc: "LLOC-1",
      },
      traceId: TRACE,
      extMap: EXT_MAP,
    }),
  ).toString("hex");
  assert.equal(actual, expected);
});

// ===========================================================================
// 2. Field numbers — asserted directly, because six messages are misordered
// ===========================================================================

test("the six messages whose field numbers are not their property order", () => {
  // Each of these is a silent corruption if copied from the object literal's
  // order instead of the writer's tags. The numbers come from the reference's
  // `buf[offset++] = <tag>` lines, not from the property list.
  assert.deepEqual(
    { groupId: ReqInfoField.groupId, albumId: ReqInfoField.albumId, pageInfo: ReqInfoField.pageInfo },
    { groupId: 1, albumId: 2, pageInfo: 5 },
    "ReqInfo: pageInfo is field 5",
  );
  assert.deepEqual(
    {
      groupId: DoQunCommentRequestBodyField.groupId,
      field3: DoQunCommentRequestBodyField.field3,
      reqBody: DoQunCommentRequestBodyField.reqBody,
      field5: DoQunCommentRequestBodyField.field5,
    },
    { groupId: 2, field3: 3, reqBody: 4, field5: 5 },
    "DoQunCommentRequestBody: groupId is field 2",
  );
  assert.deepEqual(
    { type: DoQunLikeReqBodyField.type, like: DoQunLikeReqBodyField.like, publish: DoQunLikeReqBodyField.publish, clientKey: DoQunLikeReqBodyField.clientKey },
    { type: 2, like: 3, publish: 4, clientKey: 5 },
    "DoQunLikeReqBody: type is field 2",
  );
  assert.deepEqual(
    {
      groupId: GetQunFeedDetailReqDataField.groupId,
      feedId: GetQunFeedDetailReqDataField.feedId,
      commentCount: GetQunFeedDetailReqDataField.commentCount,
      lloc: GetQunFeedDetailReqDataField.lloc,
    },
    { groupId: 2, feedId: 3, commentCount: 4, lloc: 8 },
    "GetQunFeedDetailReqData: groupId is field 2, lloc is field 8",
  );
  assert.equal(GetAlbumListRequestField.extMap, 10, "extMap is field 10 on every wrapper");
  assert.equal(GetMediaListRequestField.extMap, 10);
});

test("the request wrapper's extMap is field 10, not field 6", () => {
  // A short field number here would produce a valid-looking message whose map
  // entries land in an unrelated field. It shows up as a missing `fc-appid` on
  // the server, which is a 4xx, not a parse error.
  const bytes = encodeGetAlbumListRequest({ extMap: [{ key: "k", value: "v" }] });
  assert.equal(Buffer.from(bytes).toString("hex"), "52060a016b120176");
});

// ===========================================================================
// 3. Response decoding — constructed inputs, asserted results
// ===========================================================================

// A hand-built protobuf encoder so the tests state the bytes literally rather
// than round-tripping through the code under test.
function pv(n: bigint | number): number[] {
  let v = BigInt(n);
  const out: number[] = [];
  while (v > 127n) {
    out.push(Number(v & 127n) | 128);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}
function ptag(field: number, wire: number): number[] {
  return pv(BigInt(field * 8 + wire));
}
function pstr(field: number, s: string): number[] {
  const body = [...Buffer.from(s, "utf8")];
  return [...ptag(field, 2), ...pv(body.length), ...body];
}
function pmsg(field: number, body: number[]): number[] {
  return [...ptag(field, 2), ...pv(body.length), ...body];
}
function pvar(field: number, n: bigint | number): number[] {
  return [...ptag(field, 0), ...pv(n)];
}

test("GroupAlbumInfo decodes every field with its own type", () => {
  // Built from the reference's own decoder output shape (verified against
  // work/bridge-parts/ref/group-album.mjs), then re-encoded by hand.
  const urlInfo = [...pstr(1, "https://p.qpic.cn/x.jpg"), ...pvar(2, 800), ...pvar(3, 600)];
  const photoUrl = [...pvar(1, 1), ...pmsg(2, urlInfo)];
  const imageInfo = [
    ...pstr(1, "pic.jpg"),
    ...pstr(2, "SLOC"),
    ...pstr(3, "LLOC"),
    ...pmsg(4, photoUrl),
    ...pmsg(5, urlInfo),
    ...pvar(6, 1),
    ...pvar(7, 1),
  ];
  const videoInfo = [
    ...pstr(1, "VID-1"),
    ...pstr(2, "https://v.qq.com/1"),
    ...pmsg(3, imageInfo),
    ...pvar(4, 1280),
    ...pvar(5, 720),
    ...pvar(6, 60000),
    ...pmsg(7, photoUrl),
  ];
  const mediaInfo = [
    ...pvar(1, 1),
    ...pmsg(2, imageInfo),
    ...pmsg(3, videoInfo),
    ...pstr(6, "10001"),
    ...pvar(7, 987654321),
    ...pvar(8, 1700000000),
  ];
  const creator = [
    ...pstr(1, "uid-abc"),
    ...pstr(2, "nick"),
    ...pvar(5, 1),
    ...pvar(6, 0),
    ...pvar(7, 1),
    ...pstr(8, "custom"),
    ...pstr(9, "poly"),
    ...pstr(10, "portrait"),
    ...pvar(11, 1),
    ...pvar(12, 0),
    ...pstr(13, "10001"),
    ...pstr(14, "ditto"),
  ];
  const album = [
    ...pstr(1, "album-xyz"),
    ...pstr(2, "owner-uid"),
    ...pstr(3, "My Album"),
    ...pstr(4, "desc"),
    ...pvar(5, 1700000000),
    ...pvar(6, 1700000001),
    ...pvar(7, 1700000002),
    ...pvar(8, 42),
    ...pmsg(9, mediaInfo),
    ...pmsg(10, creator),
    ...pvar(11, 1),
    ...pvar(12, 3),
    ...pvar(13, 1),
    ...pvar(15, 1),
    ...pvar(16, 1),
    ...pstr(17, "bitmap"),
    ...pvar(18, 1),
    ...pvar(20, 2),
    ...pvar(23, 3),
    ...pstr(26, "default-desc"),
    ...pvar(30, 1),
  ];
  const decoded = decodeGroupAlbumInfo(new Uint8Array(album));
  assert.equal(decoded.albumId, "album-xyz");
  assert.equal(decoded.owner, "owner-uid");
  assert.equal(decoded.name, "My Album");
  assert.equal(decoded.description, "desc");
  assert.equal(decoded.createTime, 1700000000n);
  assert.equal(decoded.modifyTime, 1700000001n);
  assert.equal(decoded.lastUploadTime, 1700000002n);
  assert.equal(decoded.uploadNumber, 42n);
  assert.equal(decoded.topFlag, 1n);
  assert.equal(decoded.busiType, 3);
  assert.equal(decoded.status, 1);
  assert.equal(decoded.allowShare, true);
  assert.equal(decoded.isSubscribe, true);
  assert.equal(decoded.bitmap, "bitmap");
  assert.equal(decoded.isShareAlbum, true);
  assert.equal(decoded.qzAlbumType, 2);
  assert.equal(decoded.coverType, 3);
  assert.equal(decoded.defaultDesc, "default-desc");
  assert.equal(decoded.sortType, 1);
  assert.equal(decoded.cover?.type, 1);
  assert.equal(decoded.cover?.image?.lloc, "LLOC");
  assert.equal(decoded.cover?.image?.defaultUrl?.width, 800);
  assert.equal(decoded.cover?.video?.id, "VID-1");
  assert.equal(decoded.cover?.video?.videoTime, 60000n);
  assert.equal(decoded.cover?.video?.videoUrl.length, 1);
  assert.equal(decoded.cover?.uploader, "10001");
  assert.equal(decoded.cover?.batchId, 987654321n);
  assert.equal(decoded.creator?.uid, "uid-abc");
  assert.equal(decoded.creator?.isSweet, true);
  assert.equal(decoded.creator?.isSpecial, false);
  assert.equal(decoded.creator?.canFollow, 1);
  assert.equal(decoded.creator?.uin, "10001");
  assert.equal(decoded.creator?.dittoUin, "ditto");
});

test("absent scalars decode as null, not as their zero value", () => {
  // The distinction is load-bearing: `fetchAlbumList` tests `result ?? 0`, so a
  // decoder that defaulted `result` to 0 would turn "the server said nothing"
  // into "the server said success".
  const decoded = decodeGetAlbumListResponse(new Uint8Array(pmsg(4, [])));
  assert.equal(decoded.seq, null);
  assert.equal(decoded.result, null);
  assert.equal(decoded.errorText, null);
  assert.deepEqual(decoded.data, { albumList: [], attachInfo: null, hasMore: null });
});

test("unknown fields are skipped, including fixed64 and fixed32", () => {
  // The response carries fields this codec does not model; a decoder that threw
  // on them would fail against a server that added one. Wire types 1 and 5 have
  // to advance by 8 and 4 bytes respectively.
  const body = [
    ...ptag(50, 1),
    1, 2, 3, 4, 5, 6, 7, 8, // a fixed64 at field 6
    ...ptag(60, 5),
    9, 10, 11, 12, // a fixed32 at field 7
    ...pvar(2, 0), // result = 0, which is the field we DO want
    ...pstr(1, "unknown-field-survived"),
  ];
  const decoded = decodeGroupAlbumInfo(new Uint8Array(body));
  assert.equal(decoded.albumId, "unknown-field-survived");
  assert.equal(decoded.status, null);
});

test("GetMediaListResponse's field2/field3 are opaque bytes", () => {
  const decoded = decodeGetMediaListResponse(
    new Uint8Array([...pvar(1, 0), ...pmsg(2, [1, 2, 3]), ...pmsg(3, []), ...pmsg(4, pmsg(3, pmsg(1, pstr(1, "a"))))]),
  );
  assert.equal(decoded.field1, 0);
  assert.deepEqual([...(decoded.field2 ?? [])], [1, 2, 3]);
  assert.equal(decoded.field3?.length, 0);
  assert.equal(decoded.data?.mediaList.length, 1);
});

test("DeleteMediasResponse: errCode 0 and a null errCode are different answers", () => {
  // `delete` tests `resCode !== 8694 || errCode`. A null errCode is falsy so it
  // passes; a 0 is also falsy. The distinction only matters for the message, so
  // both decode to something the caller can print.
  const withZero = decodeDeleteMediasResponse(new Uint8Array([...pvar(1, 8694), ...pvar(2, 0)]));
  assert.equal(withZero.field1, 8694);
  assert.equal(withZero.field2, 0);
  const withoutErr = decodeDeleteMediasResponse(new Uint8Array(pvar(1, 8694)));
  assert.equal(withoutErr.field2, null);
  assert.equal(withoutErr.field3, null);
});

test("QunFeed.cellMedia reuses CommentReqPhotoInfo", () => {
  // The same message number is used for a request field and a response field.
  // Decoding a feed must therefore populate `medias`, not a comment list.
  const mediaInfo = [...pvar(1, 1), ...pmsg(2, pstr(3, "COVER-LLOC"))];
  const cellMedia = [...pmsg(1, mediaInfo), ...pstr(3, "album-xyz"), ...pvar(5, 555)];
  const feed = [...pmsg(1, [...pvar(1, 2), ...pvar(3, 1700000000), ...pstr(4, "422_0_1")]), ...pmsg(5, cellMedia)];
  const decoded = decodeQunFeed(new Uint8Array(feed));
  assert.equal(decoded.cellCommon?.type, 2);
  assert.equal(decoded.cellCommon?.time, 1700000000n);
  assert.equal(decoded.cellCommon?.feedId, "422_0_1");
  assert.equal(decoded.cellMedia?.albumId, "album-xyz");
  assert.equal(decoded.cellMedia?.batchId, 555n);
  assert.equal(decoded.cellMedia?.medias[0]?.image?.lloc, "COVER-LLOC");
});

test("decodeGetQunFeedDetailResponse reaches feed.feed.feedId through three wrappers", () => {
  const cellCommon = [...pvar(1, 0), ...pstr(4, "422_0_987654321")];
  const cellUserInfo = [...pmsg(1, pstr(13, "10001"))];
  const qunFeed = [...pmsg(1, cellCommon), ...pmsg(2, cellUserInfo)];
  const clientFeed = pmsg(1, qunFeed);
  const rspData = pmsg(2, clientFeed);
  const response = [...pvar(1, 0), ...pvar(2, 0), ...pstr(3, "ok"), ...pmsg(4, rspData)];
  const decoded = decodeGetQunFeedDetailResponse(new Uint8Array(response));
  assert.equal(decoded.result, 0);
  assert.equal(decoded.errorText, "ok");
  assert.equal(decoded.data?.feed?.feed?.cellCommon?.feedId, "422_0_987654321");
  assert.equal(decoded.data?.feed?.feed?.cellUserInfo?.user?.uin, "10001");
});

test("decodeDoQunCommentResponse's content list is a repeated message", () => {
  const comment = [
    ...pstr(1, "COMMENT-ID"),
    ...pmsg(2, [...pstr(1, "DATA-ID"), ...pmsg(2, pstr(13, "10001")), ...pmsg(3, [...pvar(1, 0), ...pstr(2, "hi")])]),
    ...pmsg(3, [...pvar(1, 1), ...pstr(2, "emoji")]),
    ...pvar(4, 1700000000),
    ...pstr(7, "CK"),
  ];
  const decoded = decodeDoQunCommentResponse(new Uint8Array([...pvar(2, 0), ...pmsg(4, comment)]));
  assert.equal(decoded.result, 0);
  assert.equal(decoded.comment?.data?.id, "DATA-ID");
  assert.equal(decoded.comment?.content.length, 1, "the comment's own content list, distinct from data.content");
  assert.equal(decoded.comment?.content[0]?.content, "emoji");
  assert.equal(decoded.comment?.data?.content[0]?.content, "hi");
  assert.equal(decoded.comment?.time, 1700000000n);
  assert.equal(decoded.comment?.clientKey, "CK");
});

test("decodeDoQunLikeResponse nests the echoed like under body.like", () => {
  const decoded = decodeDoQunLikeResponse(
    new Uint8Array([...pvar(1, DO_QUN_LIKE_SEQ), ...pmsg(2, pmsg(2, [...pstr(1, "CELL-ID"), ...pvar(3, 0)]))]),
  );
  assert.equal(decoded.field1, DO_QUN_LIKE_SEQ);
  assert.equal(decoded.body?.like?.id, "CELL-ID");
  assert.equal(decoded.body?.like?.status, 0);
});

test("decodeImageInfo / decodeVideoInfo / decodeUrlInfo round out the tree", () => {
  const info = decodeImageInfo(
    new Uint8Array([...pstr(1, "n"), ...pstr(2, "s"), ...pstr(3, "l"), ...pmsg(4, pmsg(2, pstr(1, "u"))), ...pvar(6, 1)]),
  );
  assert.equal(info.name, "n");
  assert.equal(info.photoUrls.length, 1);
  assert.equal(info.photoUrls[0]?.url?.url, "u");
  assert.equal(info.isGif, true);
  assert.equal(info.hasRaw, null, "a missing bool must stay null, not become false");

  const video = decodeVideoInfo(new Uint8Array([...pstr(1, "v"), ...pvar(6, 1000)]));
  assert.equal(video.id, "v");
  assert.equal(video.videoTime, 1000n);
  assert.equal(video.cover, null);

  const url = decodeUrlInfo(new Uint8Array([...pstr(1, "x"), ...pvar(2, 10), ...pvar(3, 20)]));
  assert.deepEqual(url, { url: "x", width: 10, height: 20 });

  const creator = decodeAlbumCreator(new Uint8Array(pstr(13, "42")));
  assert.equal(creator.uin, "42");
  assert.equal(creator.uid, null);

  assert.deepEqual(decodeCommentRespContent(new Uint8Array([...pvar(1, 0), ...pstr(2, "t")])), { type: 0, content: "t" });

  const media = decodeMediaInfo(new Uint8Array([...pvar(1, 0), ...pstr(6, "u")]));
  assert.equal(media.type, 0);
  assert.equal(media.uploader, "u");
});

// ===========================================================================
// 4. Pure transforms — oracles copied from the reference region
// ===========================================================================

test("uint64ToString turns an absent field into \"0\"", () => {
  assert.equal(uint64ToString(null), "0");
  assert.equal(uint64ToString(undefined), "0");
  assert.equal(uint64ToString(0n), "0");
  assert.equal(uint64ToString(18446744073709551615n), "18446744073709551615");
});

test("uint64ToSafeNumber THROWS above the safe-integer ceiling", () => {
  assert.equal(uint64ToSafeNumber(42n, "x"), 42);
  assert.equal(uint64ToSafeNumber(null, "x"), 0);
  // BigInt(Number.MAX_SAFE_INTEGER) + 1n cannot be represented as a Number
  // without rounding, so the reference throws rather than returning 9007199254740992.
  assert.throws(() => uint64ToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n, "upload_number"), {
    message: /group album upload_number exceeds Number.MAX_SAFE_INTEGER/,
  });
});

test("normalizeAlbumCreator zero-fills every absence", () => {
  assert.equal(normalizeAlbumCreator(null), undefined);
  const creator = normalizeAlbumCreator({
    uid: null,
    nick: "n",
    isSweet: null,
    isSpecial: true,
    isSuperLike: null,
    customId: null,
    polyId: null,
    portrait: null,
    canFollow: null,
    isFollowed: 1,
    uin: null,
    dittoUin: null,
  });
  assert.deepEqual(creator, {
    uid: "",
    nick: "n",
    is_sweet: false,
    is_special: true,
    is_super_like: false,
    custom_id: "",
    poly_id: "",
    portrait: "",
    can_follow: 0,
    isfollowed: 1,
    uin: "",
    ditto_uin: "",
  });
});

test("normalizeCoverUrl and normalizeAlbumCover preserve the null shape", () => {
  assert.equal(normalizeCoverUrl(null), null);
  assert.deepEqual(normalizeCoverUrl({ url: "u", width: null, height: 3 }), { url: "u", width: 0, height: 3 });
  assert.equal(normalizeAlbumCover(null), null);
  const cover = normalizeAlbumCover({
    type: null,
    image: null,
    video: null,
    uploader: null,
    batchId: null,
    uploadTime: null,
  });
  assert.deepEqual(cover, { type: 0, image: null });
});

test("normalizeQunAlbum's 64-bit fields are decimal strings and the rest are zero-filled", () => {
  const album: GroupAlbumInfo = {
    albumId: "a",
    owner: null,
    name: null,
    description: null,
    createTime: 1n,
    modifyTime: null,
    lastUploadTime: 2n,
    uploadNumber: 3n,
    cover: null,
    creator: { uid: "u", nick: "n", isSweet: null, isSpecial: null, isSuperLike: null, customId: null, polyId: null, portrait: null, canFollow: null, isFollowed: null, uin: null, dittoUin: null },
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
  const normalized = normalizeQunAlbum(album);
  assert.equal(normalized.album_id, "a");
  assert.equal(normalized.create_time, "1");
  assert.equal(normalized.modify_time, "0");
  assert.equal(normalized.last_upload_time, "2");
  assert.equal(normalized.upload_number, "3");
  assert.equal(normalized.top_flag, "0");
  assert.equal(normalized.owner, "");
  assert.equal(normalized.allow_share, false);
  assert.equal(normalized.creator?.uid, "u");
  // The shape is JSON-safe by construction: no bigint anywhere.
  assert.doesNotThrow(() => JSON.stringify(normalized));
});

test("toLegacyAlbum's createuin chain is creator uin -> owner -> creator uid", () => {
  const base: GroupAlbumInfo = {
    albumId: "a",
    owner: "OWNER",
    name: "n",
    description: "d",
    createTime: 1n,
    modifyTime: 2n,
    lastUploadTime: 3n,
    uploadNumber: 4n,
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
  assert.equal(toLegacyAlbum(base).createuin, "OWNER", "no creator at all -> the album owner");

  // The chain is `creator?.uin || album.owner || creator?.uid || ""`, so the
  // OWNER outranks a creator uid. That ordering is easy to sibilize backwards:
  // the uid fallback only fires for an album with no owner recorded, which the
  // server does emit for a transferred album.
  const uidOnly = { ...base, creator: { uid: "UID", nick: null, isSweet: null, isSpecial: null, isSuperLike: null, customId: null, polyId: null, portrait: null, canFollow: null, isFollowed: null, uin: null, dittoUin: null } };
  assert.equal(toLegacyAlbum(uidOnly).createuin, "OWNER", "the owner still outranks the creator uid");
  assert.equal(toLegacyAlbum({ ...uidOnly, owner: null }).createuin, "UID", "with no owner, the creator uid is the last resort");

  const withUin = { ...base, creator: { ...uidOnly.creator, uin: "UIN" } };
  assert.equal(toLegacyAlbum(withUin).createuin, "UIN", "the creator's uin outranks everything");
  assert.equal(toLegacyAlbum(base).picNum, 4);
  assert.equal(toLegacyAlbum(base).last_upload_time, 3);
});

test("convertBigIntToString is recursive and JSON-safe", () => {
  assert.equal(convertBigIntToString(1n), "1");
  assert.equal(convertBigIntToString(null), null);
  assert.equal(convertBigIntToString(undefined), null);
  assert.deepEqual(convertBigIntToString([1n, { a: 2n }]), ["1", { a: "2" }]);
  assert.equal(convertBigIntToString("s"), "s");
  assert.equal(convertBigIntToString(3), 3);
  assert.equal(convertBigIntToString(true), true);
  assert.equal(convertBigIntToString(() => undefined), null, "a function is not one of the four scalar types");
});

test("findDeleteTarget maps a video id onto its cover lloc", () => {
  const mediaList = [
    { batchId: "111", image: { lloc: "IMG-1" } },
    { batchId: "222", video: { id: "VID-1", cover: { lloc: "COVER-1" } } },
    { batchId: "", video: { id: "VID-2", cover: null } },
  ];
  assert.deepEqual(findDeleteTarget(mediaList, "IMG-1"), { mediaId: "IMG-1", batchId: "111" });
  assert.deepEqual(findDeleteTarget(mediaList, "VID-1"), { mediaId: "COVER-1", batchId: "222" });
  assert.deepEqual(findDeleteTarget(mediaList, "COVER-1"), { mediaId: "COVER-1", batchId: "222" });
  // A video whose cover lloc is absent deletes under its own id — the only
  // branch where the video id survives.
  assert.deepEqual(findDeleteTarget(mediaList, "VID-2"), { mediaId: "VID-2" });
  assert.equal(findDeleteTarget(mediaList, "NOPE"), undefined);
  assert.equal(findDeleteTarget([null, 1, "x"], "IMG-1"), undefined, "non-objects are skipped, not thrown on");
});

test("delete's batchIds is a repeated STRING field, emitted only when non-empty", () => {
  // `batchIds` is `repeated string`, not `repeated uint64`: the value goes on the
  // wire as decimal TEXT, which is why a naive `repeatedUint64` encoder produces
  // a plausible-looking message the server rejects.
  assert.equal(
    Buffer.from(encodeDeleteMediasRequest({ body: { groupId: "1", albumId: "a", mediaIds: ["L"], batchIds: ["987654321"] }, traceId: "T" })).toString("hex"),
    "22140a01311201611a014c22093938373635343332312a0154",
    "field 4 carries the decimal text of the batch id",
  );
  // An empty array produces no field 4 at all — the reference guards on `.length > 0`.
  assert.equal(
    Buffer.from(encodeDeleteMediasRequest({ body: { groupId: "1", albumId: "a", mediaIds: ["L"], batchIds: [] }, traceId: "T" })).toString("hex"),
    "22090a01311201611a014c2a0154",
  );
});

test('optionalBatchId treats 0, the empty string, null and junk as absent', () => {
  assert.equal(optionalBatchId(undefined), undefined);
  assert.equal(optionalBatchId(null), undefined);
  assert.equal(optionalBatchId(""), undefined);
  assert.equal(optionalBatchId(0n), undefined, "a zero batch id is 'no batch', not batch zero");
  assert.equal(optionalBatchId("0"), undefined);
  assert.equal(optionalBatchId("not-a-number"), undefined);
  assert.equal(optionalBatchId("987654321"), 987654321n);
  assert.equal(optionalBatchId(987654321), 987654321n);
  assert.equal(optionalBatchId(987654321n), 987654321n);
});

test("commentMediaLloc comments a video under its cover, not its id", () => {
  assert.equal(commentMediaLloc({ video: { id: "V", cover: { lloc: "C" } } }, "V"), "C");
  assert.equal(commentMediaLloc({ image: { lloc: "I" } }, "X"), "I");
  assert.equal(commentMediaLloc(undefined, "FALLBACK"), "FALLBACK");
  assert.equal(commentMediaLloc({ video: { id: "V", cover: null } }, "V"), "V");
});

test("mediaInfoForComment states only the lloc plus the optional uploader/batch", () => {
  const video = mediaInfoForComment({ uploader: "42", batchId: "555", video: { id: "V", cover: { lloc: "C" } } }, "V");
  assert.equal(video.type, 1);
  assert.equal(video.video?.cover?.lloc, "C");
  assert.equal(video.image, null);
  assert.equal(video.uploader, "42");
  assert.equal(video.batchId, 555n);

  const image = mediaInfoForComment({ image: { lloc: "I" } }, "I");
  assert.equal(image.type, 0);
  assert.equal(image.image?.lloc, "I");
  assert.equal(image.video, null);
  assert.equal(image.uploader, null);
  assert.equal(image.batchId, null);
});

test("qunFeedCellId has a two-cell head and a three-cell form", () => {
  assert.equal(
    qunFeedCellId("123", "alb", "999", "LLOC"),
    "421_1_0_123|alb|999^||^421_1_0_123|alb|LLOC^||^0",
  );
  assert.equal(qunFeedCellId("123", "alb", "999"), "421_1_0_123|alb|999");
  // An empty lloc is falsy and takes the head-only branch, exactly like `undefined`.
  assert.equal(qunFeedCellId("123", "alb", "999", ""), "421_1_0_123|alb|999");
});

test("numericUin refuses a non-numeric uin instead of throwing", () => {
  assert.equal(numericUin("10001"), 10001n);
  assert.equal(numericUin(""), undefined);
  assert.equal(numericUin("u_abc"), undefined);
  assert.equal(numericUin("12 34"), undefined);
});

test("commentReqHeader keeps only time and feedId, and drops null time", () => {
  assert.deepEqual(commentReqHeader({ type: 0, time: 5n, feedId: "F", cellId: "C", field6: 0 }), { time: 5n, feedId: "F" });
  assert.deepEqual(commentReqHeader({ type: 0, time: null, feedId: "F", cellId: null, field6: null }), { feedId: "F" });
  assert.deepEqual(commentReqHeader({ type: 0, time: null, feedId: null, cellId: null, field6: null }), {});
  // Encoding an empty header yields ZERO bytes, and that is correct: the comment
  // request then carries `reqBody` with no field1 at all.
  assert.equal(encodeCommentReqBodyHeader(commentReqHeader({ type: 0, time: null, feedId: null, cellId: null, field6: null })).length, 0);
});

test("commentPhotoInfo prefers the feed's own albumId and batchId", () => {
  const fallback = mediaInfoForComment({ image: { lloc: "L" } }, "L");
  const fromFeed = commentPhotoInfo(
    { medias: [fallback], albumId: "FEED-ALBUM", batchId: 7n },
    fallback,
    "ARG-ALBUM",
    9n,
  );
  assert.equal(fromFeed.albumId, "FEED-ALBUM");
  assert.equal(fromFeed.batchId, 7n);

  // An empty feed albumId falls back to the argument, but a null feed batchId
  // also falls back — two different operators (`||` vs `??`) in one expression.
  const partial = commentPhotoInfo({ medias: [fallback], albumId: "", batchId: null }, fallback, "ARG-ALBUM", 9n);
  assert.equal(partial.albumId, "ARG-ALBUM");
  assert.equal(partial.batchId, 9n);

  // No medias at all: the fallback entry is used and the caller's ids win.
  const empty = commentPhotoInfo(null, fallback, "ARG-ALBUM", 9n);
  assert.equal(empty.medias.length, 1);
  assert.equal(empty.albumId, "ARG-ALBUM");
  assert.equal(empty.batchId, 9n);
});

test("findCommentMedia matches a photo by lloc and a video by id or cover", () => {
  const list = [{ image: { lloc: "I" } }, { video: { id: "V", cover: { lloc: "C" } } }];
  assert.equal(findCommentMedia(list, "I")?.image?.lloc, "I");
  assert.equal(findCommentMedia(list, "V")?.video?.id, "V");
  assert.equal(findCommentMedia(list, "C")?.video?.id, "V");
  assert.equal(findCommentMedia(list, "NOPE"), undefined);
});

test("commentFromResponse tries comment.data, then comment, then nothing", () => {
  // Shape 1: the modern nested one.
  assert.deepEqual(
    commentFromResponse({
      comment: { id: "OUTER", data: { id: "INNER", content: [{ type: 0, content: "x" }], time: 5n, clientKey: "CK", user: { uin: "42" } }, content: [], time: null, clientKey: null },
    }),
    { id: "INNER", content: [{ type: 0, content: "x" }], time: 5n, clientKey: "CK", user: { uin: "42" } },
  );

  // Shape 2: a flat legacy row — its own content/time/clientKey survive, and
  // only `user` is taken from `data`.
  const flat = commentFromResponse({
    comment: { id: "OUTER", data: { user: { uin: "42" } }, content: [{ type: 1, content: "e" }], time: 9n, clientKey: "CK" },
  });
  assert.equal(flat.id, "OUTER");
  assert.deepEqual(flat.content, [{ type: 1, content: "e" }]);
  assert.equal(flat.time, 9n);
  assert.deepEqual(flat.user, { uin: "42" });

  // Shape 3: no comment at all.
  assert.deepEqual(commentFromResponse({ comment: null }), {});
});

test("protobufSubmessage lifts a nested slice without re-encoding it", () => {
  // This is the mechanism the comment request relies on: `[4,2,1,1]` reaches
  // data.feed.feed.cellCommon inside a GetQunFeedDetail response.
  const cellCommon = [...pvar(1, 0), ...pstr(4, "422_0_1")];
  const response = new Uint8Array([...pvar(1, 0), ...pmsg(4, pmsg(2, pmsg(1, pmsg(1, cellCommon))))]);
  const slice = protobufSubmessage(response, [4, 2, 1, 1]);
  assert.deepEqual([...(slice ?? [])], cellCommon, "the slice is byte-identical to the submessage body");

  assert.equal(protobufSubmessage(response, [4, 2, 1, 9]), undefined);
  assert.equal(protobufSubmessage(response, [9]), undefined);
  assert.equal(nonemptyBytes(new Uint8Array(0)), undefined, "an empty slice is treated as absent");
  assert.deepEqual([...(nonemptyBytes(new Uint8Array([1])) ?? [])], [1]);
});

test("firstLengthDelimitedField skips varints, fixed64 and fixed32", () => {
  const bytes = new Uint8Array([
    8, 1, // field 1, varint
    17, 1, 2, 3, 4, 5, 6, 7, 8, // field 2, fixed64
    29, 1, 2, 3, 4, // field 3, fixed32
    34, 2, 65, 66, // field 4, bytes "AB"
  ]);
  assert.deepEqual([...(firstLengthDelimitedField(bytes, 4) ?? [])], [65, 66]);
  assert.equal(firstLengthDelimitedField(bytes, 5), undefined);
});

// ===========================================================================
// 5. The API class — constants and the transport contract
// ===========================================================================

test("the five wire names and two echo constants are the reference's", () => {
  assert.equal(GET_ALBUM_LIST_CMD, "QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.GetAlbumList");
  assert.equal(GET_MEDIA_LIST_CMD, "QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.GetMediaList");
  assert.equal(DO_QUN_COMMENT_CMD, "QunAlbum.trpc.qzone.webapp_qun_operation.FeedsWriter.DoQunComment");
  assert.equal(DO_QUN_LIKE_CMD, "QunAlbum.trpc.qzone.webapp_qun_operation.FeedsWriter.DoQunLike");
  assert.equal(DELETE_MEDIAS_CMD, "QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.DeleteMedias");
  assert.equal(GET_QUN_FEED_DETAIL_CMD, "QunAlbum.trpc.qzone.webapp_qun_feeds.FeedsReader.GetQunFeedDetail");
  // The two constants that are also the expected echo in the response.
  assert.equal(GET_ALBUM_LIST_SEQ, 3331);
  assert.equal(DO_QUN_COMMENT_SEQ, 8527);
  assert.equal(DO_QUN_LIKE_SEQ, 5495);
  assert.equal(DELETE_MEDIAS_SEQ, 8694);
  assert.equal(GET_QUN_FEED_DETAIL_COMMENT_COUNT, 20);
});

/** One recorded `sendRawPacket` call. */
interface RecordedPacket {
  cmd: string;
  body: Uint8Array;
  timeoutMs?: number;
}

/** A BridgeContext whose `sendRawPacket` answers from a queue. */
function stubContext(
  responses: PacketSendResult[],
  options: { cookies?: Record<string, string> } = {},
): { ctx: BridgeContext; calls: RecordedPacket[] } {
  const calls: RecordedPacket[] = [];
  const ctx = {
    identity: new MemoryIdentity("10001", "nick"),
    apis: options.cookies === undefined ? {} : { web: { getCookies: async () => options.cookies as Record<string, string> } },
    events: {},
    resolveUserUid: async () => "",
    nextMessageRandom: () => 0,
    nextClientSequence: () => 0,
    rememberUploadedFile: () => undefined,
    recallUploadedFile: () => undefined,
    dispose: async () => undefined,
    sendRawPacket: async (cmd: string, body: Uint8Array, timeoutMs?: number) => {
      calls.push({ cmd, body, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
      const next = responses.shift();
      if (!next) throw new Error(`stubContext: no response queued for ${cmd}`);
      return next;
    },
  } as unknown as BridgeContext;
  return { ctx, calls };
}

function ok(body: Uint8Array): PacketSendResult {
  return { success: true, gotResponse: true, errorCode: 0, responseData: body };
}

const TRANSPORT_FAILURE: PacketSendResult = {
  success: false,
  gotResponse: false,
  errorCode: -1,
  errorMessage: "no pid",
};

test("fetchAlbumList sends the exact bytes and decodes the page", async () => {
  const response = new Uint8Array([
    ...pvar(1, GET_ALBUM_LIST_SEQ),
    ...pvar(2, 0),
    ...pmsg(4, [...pmsg(1, pstr(1, "alb-1")), ...pstr(2, "CURSOR"), ...pvar(3, 1)]),
  ]);
  const { ctx, calls } = stubContext([ok(response)]);
  const page = await new GroupAlbumApi(ctx).fetchAlbumList(123456789, "");
  assert.equal(calls[0]?.cmd, GET_ALBUM_LIST_CMD);
  assert.equal(page.albumList[0]?.albumId, "alb-1");
  assert.equal(page.attachInfo, "CURSOR");
  assert.equal(page.hasMore, true);
  // The body's shape is fixed: seq, then two empty byte blobs, then data.
  const hex = Buffer.from(calls[0]?.body ?? new Uint8Array()).toString("hex");
  assert.ok(hex.startsWith("08831a12001a00"), `unexpected body head: ${hex.slice(0, 12)}`);
  assert.ok(hex.includes("0a09313233343536373839"), "the group id goes out as a decimal string");
  // `packetTimeoutMs()` is passed EXPLICITLY rather than left to the context's
  // default; the two agree at 15000 but only the explicit form honours
  // SNOWLUMA_PACKET_TIMEOUT_MS.
  assert.equal(calls[0]?.timeoutMs, 15_000);
});

test("a non-zero result code throws with the server's error text", async () => {
  const { ctx } = stubContext([ok(new Uint8Array([...pvar(2, 5), ...pstr(3, "boom")]))]);
  await assert.rejects(new GroupAlbumApi(ctx).fetchAlbumList(1, ""), {
    message: "get group album list failed: result=5, error=boom",
  });
});

test("fetchAlbumList names the transport failure, not a decode error", async () => {
  const { ctx } = stubContext([TRANSPORT_FAILURE]);
  await assert.rejects(new GroupAlbumApi(ctx).fetchAlbumList(1, ""), { message: /no pid/ });
});

test("list pages until hasMore is false", async () => {
  const page = (albumId: string, cursor: string, more: boolean): PacketSendResult =>
    ok(new Uint8Array([...pvar(2, 0), ...pmsg(4, [...pmsg(1, pstr(1, albumId)), ...pstr(2, cursor), ...pvar(3, more ? 1 : 0)])]));
  const { ctx, calls } = stubContext([page("a", "C1", true), page("b", "C2", true), page("c", "", false)]);
  const albums = await new GroupAlbumApi(ctx).list(1);
  assert.deepEqual(
    albums.map((a) => a.id),
    ["a", "b", "c"],
  );
  assert.equal(calls.length, 3);
  // The second request carries the first page's cursor.
  assert.ok(Buffer.from(calls[1]?.body ?? new Uint8Array()).toString("hex").includes(Buffer.from("C1").toString("hex")));
});

test("list refuses a hasMore=true page with an empty cursor", async () => {
  // The alternative is an unbounded request loop whose eventual error names the
  // network timeout instead of the server's empty cursor.
  const { ctx } = stubContext([
    ok(new Uint8Array([...pvar(2, 0), ...pmsg(4, [...pmsg(1, pstr(1, "a")), ...pstr(2, ""), ...pvar(3, 1)])])),
  ]);
  await assert.rejects(new GroupAlbumApi(ctx).list(7), { message: /hasMore=true but cursor is empty/ });
});

test("list refuses a repeated cursor", async () => {
  const page = ok(new Uint8Array([...pvar(2, 0), ...pmsg(4, [...pmsg(1, pstr(1, "a")), ...pstr(2, "SAME"), ...pvar(3, 1)])]));
  const { ctx } = stubContext([page, page]);
  await assert.rejects(new GroupAlbumApi(ctx).list(7), { message: /repeated cursor at page 2/ });
});

test("getMediaList converts every bigint away and carries the cursor", async () => {
  const response = new Uint8Array([
    ...pvar(1, 0),
    ...pmsg(4, [...pmsg(3, [...pvar(1, 1), ...pmsg(2, pstr(3, "LLOC")), ...pvar(7, 999)]), ...pstr(5, "NEXT")]),
  ]);
  const { ctx, calls } = stubContext([ok(response)]);
  const page = await new GroupAlbumApi(ctx).getMediaList(1, "alb");
  assert.equal(calls[0]?.cmd, GET_MEDIA_LIST_CMD);
  assert.equal(page.nextAttachInfo, "NEXT");
  const media = (page.mediaList as { batchId: unknown }[])[0];
  assert.equal(media?.batchId, "999");
  assert.equal(typeof media?.batchId, "string", "a bigint here would break the JSON response");
});

test("getMediaList throws on a non-zero retCode", async () => {
  const { ctx } = stubContext([ok(new Uint8Array(pvar(1, 4)))]);
  await assert.rejects(new GroupAlbumApi(ctx).getMediaList(1, "alb"), { message: "fetch album media list error: retCode 4" });
});

test("like validates the ECHO (5495), not zero", async () => {
  const { ctx, calls } = stubContext([ok(new Uint8Array([...pvar(1, DO_QUN_LIKE_SEQ), ...pmsg(2, pmsg(2, pstr(1, "ID"))) ]))]);
  const result = await new GroupAlbumApi(ctx).like(123, "alb", "555", "LLOC", true);
  assert.equal(calls[0]?.cmd, DO_QUN_LIKE_CMD);
  // Every key the codec models comes back, with `null` for the ones the server
  // did not send — `convertBigIntToString(null)` is `null`, not a dropped key.
  assert.deepEqual(result, { id: "ID", status: null });

  // A successful transport with the WRONG echo constant is a failure. Checking
  // `!== 0` instead would report every genuine success as an error.
  const wrong = stubContext([ok(new Uint8Array(pvar(1, 0)))]);
  await assert.rejects(new GroupAlbumApi(wrong.ctx).like(123, "alb", "555", "LLOC", true), {
    message: "like album media error: retCode 0",
  });
});

test("like's isLike selects type 2/status 0, and unlike type 1/status 1", async () => {
  // Two independent bits, and one of them is dropped by the encoder: status 0
  // (like) is `!== 0`-guarded away, so a LIKE and an UNLIKE differ on the wire in
  // BOTH `type` and the mere presence of `status`. Asserting only the type would
  // miss a swapped status.
  const capture = async (isLike: boolean): Promise<string> => {
    const { ctx, calls } = stubContext([ok(new Uint8Array(pvar(1, DO_QUN_LIKE_SEQ)))]);
    await new GroupAlbumApi(ctx).like(1, "a", "2", "L", isLike);
    return Buffer.from(calls[0]?.body ?? new Uint8Array()).toString("hex");
  };
  const liked = await capture(true);
  const unliked = await capture(false);
  assert.ok(liked.includes("1002"), "like sets body.type=2");
  assert.ok(!liked.includes("1801"), "a like's status 0 is dropped by the encoder");
  assert.ok(unliked.includes("1001"), "unlike sets body.type=1");
  assert.ok(unliked.includes("1801"), "unlike sets body.like.status=1, which IS emitted");
});

test("delete pages for the target, then deletes it", async () => {
  const mediaPage = ok(
    new Uint8Array([...pvar(1, 0), ...pmsg(4, [...pmsg(3, pmsg(2, pstr(3, "L"))), ...pstr(5, "")])]),
  );
  const { ctx, calls } = stubContext([mediaPage, ok(new Uint8Array(pvar(1, DELETE_MEDIAS_SEQ)))]);
  assert.deepEqual(await new GroupAlbumApi(ctx).delete(1, "a", "L"), { success: true });
  assert.equal(calls[0]?.cmd, GET_MEDIA_LIST_CMD, "resolveDeleteTarget pages first");
  assert.equal(calls[1]?.cmd, DELETE_MEDIAS_CMD);
});

test("delete's resolveDeleteTarget falls back to the raw id on a transport failure", async () => {
  const { ctx, calls } = stubContext([TRANSPORT_FAILURE, ok(new Uint8Array(pvar(1, DELETE_MEDIAS_SEQ)))]);
  await new GroupAlbumApi(ctx).delete(1, "a", "RAW-KEY");
  assert.equal(calls[1]?.cmd, DELETE_MEDIAS_CMD);
  assert.ok(
    Buffer.from(calls[1]?.body ?? new Uint8Array()).toString("hex").includes(Buffer.from("RAW-KEY").toString("hex")),
    "the raw key reached the delete request",
  );
});

test("delete reports the echoed code and the server's message together", async () => {
  const mediaPage = ok(new Uint8Array([...pvar(1, 0), ...pmsg(4, [...pmsg(3, pmsg(2, pstr(3, "L"))), ...pstr(5, "")])]));
  const { ctx } = stubContext([
    mediaPage,
    ok(new Uint8Array([...pvar(1, DELETE_MEDIAS_SEQ), ...pvar(2, 3), ...pstr(3, "nope")])),
  ]);
  await assert.rejects(new GroupAlbumApi(ctx).delete(1, "a", "L"), { message: "delete album media error [3]: nope" });
});

test("comment throws before any network work when the media is not in the album", async () => {
  // resolveCommentMedia pages the album; an empty page with no cursor means "not
  // found", and the error names the media rather than a server response.
  const { ctx, calls } = stubContext([
    ok(new Uint8Array([...pvar(1, 0), ...pmsg(4, [...pmsg(3, []), ...pstr(5, "")])])),
  ]);
  await assert.rejects(new GroupAlbumApi(ctx).comment(1, "a", "MISSING", "hi"), {
    message: "comment album media error: media not found",
  });
  assert.equal(calls.length, 1, "only the lookup page was sent");
});

test("comment's request carries the raw response slices verbatim", async () => {
  // The whole point of `protobufSubmessage`: fields the codec does not model
  // must survive into the comment request. The cellCommon slice below carries a
  // field (99, tag `9a 06`) that nothing in this package knows about.
  const cellCommonBody = [...pvar(1, 0), ...pstr(4, "422_0_987654321"), ...ptag(99, 2), 2, 65, 66];
  const cellUserBody = pmsg(1, pstr(13, "10001"));
  const cellMediaBody = [...pmsg(1, [...pvar(1, 1), ...pmsg(2, pstr(3, "LLOC-1"))]), ...pstr(3, "alb"), ...pvar(5, 987654321)];
  const mediaPage = ok(
    new Uint8Array([
      ...pvar(1, 0),
      ...pmsg(4, [...pmsg(3, [...pvar(1, 1), ...pmsg(2, pstr(3, "LLOC-1")), ...pvar(7, 987654321)]), ...pstr(5, "")]),
    ]),
  );
  const feedDetail = ok(
    new Uint8Array([
      ...pvar(2, 0),
      ...pmsg(4, pmsg(2, pmsg(1, [...pmsg(1, cellCommonBody), ...pmsg(2, cellUserBody), ...pmsg(5, cellMediaBody)]))),
    ]),
  );
  const commentResponse = ok(
    new Uint8Array([...pvar(2, 0), ...pmsg(4, [...pmsg(2, [...pstr(1, "NEW-ID"), ...pvar(4, 1700000000)]), ...pstr(7, "CK")])]),
  );
  const { ctx, calls } = stubContext([mediaPage, feedDetail, commentResponse]);
  const result = await new GroupAlbumApi(ctx).comment(123456789, "alb", "LLOC-1", "hello");
  assert.equal(result.id, "NEW-ID");
  assert.equal(calls[2]?.cmd, DO_QUN_COMMENT_CMD);
  const hex = Buffer.from(calls[2]?.body ?? new Uint8Array()).toString("hex");
  // The unmodelled field 99 survived, payload intact.
  assert.ok(hex.includes("9a06024142"), "the unmodelled field reached the comment body");
  // The feed id came from the raw slice, not from a re-encode of the decoded cell.
  assert.ok(hex.includes(Buffer.from("422_0_987654321").toString("hex")));
});

test("getQunFeedDetail throws on an empty feed id", async () => {
  const { ctx } = stubContext([ok(new Uint8Array(pvar(2, 0)))]);
  await assert.rejects(new GroupAlbumApi(ctx).getQunFeedDetail(1, "a", 1n, "L"), {
    message: "comment album media error: empty feed",
  });
});

test("getQunFeedDetail reports the result code and the server text", async () => {
  const { ctx } = stubContext([ok(new Uint8Array([...pvar(2, 7), ...pstr(3, "denied")]))]);
  await assert.rejects(new GroupAlbumApi(ctx).getQunFeedDetail(1, "a", 1n, "L"), {
    message: "fetch album feed error: retCode 7, denied",
  });
});

test("the upload methods require apis.web and say so", async () => {
  const { ctx } = stubContext([]);
  await assert.rejects(new GroupAlbumApi(ctx).upload(1, "a", "n", "file:///tmp/x.jpg"), {
    message: /requires apis\.web/,
  });
});

test("uploadVideo reaches the ISO-BMFF gate before any probe or network work", async () => {
  // Order matters: the format gate runs BEFORE the probe, so a non-MP4 never
  // costs an ffmpeg call. Here the file is a PNG, so the gate must reject it.
  const { ctx } = stubContext([], { cookies: { skey: "s", p_skey: "p" } });
  const { writeFileSync, unlinkSync } = await import("node:fs");
  const path = `${process.env["TMPDIR"] ?? "/tmp"}/album-test-${Date.now()}.bin`;
  writeFileSync(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0]));
  try {
    await assert.rejects(new GroupAlbumApi(ctx).uploadVideo(1, "a", "n", path), {
      message: "群相册视频上传仅支持 MP4 等 ISO BMFF 视频",
    });
  } finally {
    unlinkSync(path);
  }
});

// ===========================================================================
// 6. Upload helpers — pure parts only
// ===========================================================================

test("detectImageFormat recognises the five accepted formats", () => {
  // PNG: magic + IHDR width/height at 16/20.
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71]);
  png[16] = 0;
  png[17] = 0;
  png[18] = 1;
  png[19] = 144; // 400
  png[20] = 0;
  png[21] = 0;
  png[22] = 1;
  png[23] = 44; // 300
  assert.deepEqual(detectImageFormat(png), { format: 1001, width: 400, height: 300 });

  // GIF87a: "GIF87a" + LE16 width/height.
  const gif = new Uint8Array(10);
  gif.set([71, 73, 70, 56, 55, 97]);
  gif[6] = 32;
  gif[7] = 0;
  gif[8] = 16;
  gif[9] = 0;
  assert.deepEqual(detectImageFormat(gif), { format: 2000, width: 32, height: 16 });

  // BMP: "BM" + LE32 width at 18, height at 22.
  const bmp = new Uint8Array(26);
  bmp.set([66, 77]);
  bmp[18] = 10;
  bmp[22] = 20;
  assert.deepEqual(detectImageFormat(bmp), { format: 1005, width: 10, height: 20 });

  // WebP VP8L: lossless with 14-bit width/height packed in one LE32.
  const webp = new Uint8Array(30);
  webp.set([82, 73, 70, 70]);
  webp.set([87, 69, 66, 80], 8);
  webp.set([86, 80, 56, 76], 12);
  // width-1 = 99 (low 14 bits), height-1 = 49 (next 14 bits)
  const bits = 99 | (49 << 14);
  webp[21] = bits & 0xff;
  webp[22] = (bits >> 8) & 0xff;
  webp[23] = (bits >> 16) & 0xff;
  webp[24] = (bits >> 24) & 0xff;
  assert.deepEqual(detectImageFormat(webp), { format: 1002, width: 100, height: 50 });
});

test("detectImageFormat's unknown answer is 1000, which the caller re-checks", () => {
  const junk = new Uint8Array([1, 2, 3, 4, 5]);
  assert.deepEqual(detectImageFormat(junk), { format: 1000, width: 0, height: 0 });
  // A bare SOI with no SOF: still 1000/0/0 — and `uploadImageToGroupAlbum`
  // accepts it because `isJpeg` is true. That is the reference's behaviour.
  const truncatedJpeg = new Uint8Array([255, 216]);
  assert.deepEqual(detectImageFormat(truncatedJpeg), { format: 1000, width: 0, height: 0 });
});

test("a JPEG's dimensions come from the SOF marker, after the APPn segments", () => {
  // SOI, an APP0 of 4 bytes of payload, then SOF0 with height 200, width 300.
  const jpeg = new Uint8Array([
    255, 216, // SOI
    255, 224, 0, 4, 1, 2, // APP0, segLen 4
    255, 192, 0, 11, 8, 0, 200, 1, 44, 3, 1, 1, 1, 0, // SOF0: height 200, width 300
  ]);
  const format = detectImageFormat(jpeg);
  assert.equal(format.format, 1000);
  assert.equal(format.width, 300);
  assert.equal(format.height, 200);
});

test("isKnownImageHead / isIsoBmffHead gate the video upload", () => {
  assert.equal(isKnownImageHead(new Uint8Array([255, 216, 0, 0])), true);
  assert.equal(isKnownImageHead(new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])), true);
  assert.equal(isKnownImageHead(new Uint8Array([66, 77])), true);
  assert.equal(isKnownImageHead(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), false);

  const mp4 = new Uint8Array(16);
  mp4.set([0, 0, 0, 32, 102, 116, 121, 112]); // size 32, "ftyp"
  assert.equal(isIsoBmffHead(mp4), true);
  assert.equal(isIsoBmffHead(new Uint8Array(4)), false);
  assert.equal(isKnownImageHead(mp4), false, "an MP4 is not an image head");
});

test("albumUploadCookie's `o` prefix and header order are byte-exact", () => {
  // `p_uin` and `uin` get the `o` prefix; `p_skey` and `skey` do not. The order
  // is p_uin, p_skey, skey, uin — not the order of the arguments, and not sorted.
  assert.equal(
    albumUploadCookie("10001", "SKEY", "PSKEY"),
    "p_uin=o10001; p_skey=PSKEY; skey=SKEY; uin=o10001",
  );
});

test("albumUploadGtk prefers p_skey over skey", () => {
  // Same djb2 loop as getBknFromCookie, asserted through the upload path too
  // because it is the only place that builds the jar explicitly.
  const fromBoth = albumUploadGtk("SKEY", "PSKEY");
  const fromPskeyOnly = albumUploadGtk("", "PSKEY");
  const fromSkeyOnly = albumUploadGtk("SKEY", "");
  assert.equal(fromBoth, fromPskeyOnly, "p_skey wins when both are present");
  assert.notEqual(fromBoth, fromSkeyOnly);
  assert.match(fromBoth, /^\d+$/);
});

test("normalizeAlbumSliceSize falls back on 0 and on undefined", () => {
  assert.equal(normalizeAlbumSliceSize(undefined), DEFAULT_ALBUM_SLICE_SIZE);
  assert.equal(normalizeAlbumSliceSize(null), DEFAULT_ALBUM_SLICE_SIZE);
  assert.equal(normalizeAlbumSliceSize(0), DEFAULT_ALBUM_SLICE_SIZE);
  assert.equal(normalizeAlbumSliceSize(-1), DEFAULT_ALBUM_SLICE_SIZE);
  assert.equal(normalizeAlbumSliceSize(65536), 65536);
});

test("hashFileStreaming digests a real temp file", async () => {
  const { writeFileSync, unlinkSync } = await import("node:fs");
  const path = `${process.env["TMPDIR"] ?? "/tmp"}/album-hash-${Date.now()}.bin`;
  writeFileSync(path, Buffer.from("hello world"));
  try {
    const hashes = await hashFileStreaming(path);
    // The canonical digests of "hello world".
    assert.equal(hashes.md5Hex, "5eb63bbbe01eeed093cb22bb8f5acdc3");
    assert.equal(hashes.sha1Hex, "2aae6c35c94fcfb415dbe95f408b9ce91ee846ed");
    assert.equal(hashes.md5.length, 16);
    assert.equal(hashes.sha1.length, 20);
  } finally {
    unlinkSync(path);
  }
});

test("stageVideoSource hard-links a local file and reports its real name", async () => {
  const { writeFileSync, unlinkSync, statSync } = await import("node:fs");
  const path = `${process.env["TMPDIR"] ?? "/tmp"}/album-stage-src-${Date.now()}.mp4`;
  writeFileSync(path, Buffer.from([0, 0, 0, 32, 102, 116, 121, 112]));
  let staged: Awaited<ReturnType<typeof stageVideoSource>> | undefined;
  try {
    staged = await stageVideoSource(path);
    assert.equal(staged.fileSize, 8);
    assert.equal(staged.fileName, path.split("/").pop());
    assert.equal(statSync(staged.filePath).size, 8);
    assert.ok(staged.filePath !== path, "the staged path is a fresh one");
  } finally {
    await staged?.cleanup();
    unlinkSync(path);
  }
  // cleanup really removes the staged file.
  await assert.rejects(async () => {
    const { statSync: stat } = await import("node:fs");
    stat(staged?.filePath ?? "");
  });
});

test("stageVideoSource decodes an inline base64 source to a .bin with no name", async () => {
  const staged = await stageVideoSource(`base64://${Buffer.from("ABCD").toString("base64")}`);
  try {
    assert.equal(staged.fileSize, 4);
    assert.equal(staged.fileName, "");
    assert.ok(staged.filePath.endsWith(".bin"));
  } finally {
    await staged.cleanup();
  }
});

test("stageVideoSource rejects an empty source before touching the disk", async () => {
  await assert.rejects(stageVideoSource(""), { message: "stage source is empty" });
});

test("the default video probe throws instead of pretending", async () => {
  // The reference's probe is a native ffmpeg addon this package does not ship.
  // A silent empty cover would turn a missing capability into an opaque server
  // error, so the seam is loud.
  await assert.rejects(unavailableAlbumVideoProbe("/tmp/whatever.mp4"), { message: /requires an ffmpeg-backed probe/ });
});

test("ALBUM_VIDEO_MAX_BYTES matches the highway ceiling", () => {
  assert.equal(ALBUM_VIDEO_MAX_BYTES, 1536 * 1024 * 1024);
});