// The Weiyun collection (QQ 收藏) wire format: a 16-byte header in front of two
// protobuf messages, for the `collector.weiyun.com` endpoint.
//
// Reference region: ../protocol/src/web/collection.ts
// (reference/index.mjs:42572, 4394 lines). Only the parts `CollectionApi.list`
// reaches are ported; the region's remaining 4300 lines are the generated codec
// for every *summary* variant a collection item can carry, and those are decoded
// structurally below rather than hand-expanded.
//
// ---------------------------------------------------------------------------
// This is NOT an OIDB call, and forcing it into `OidbSpec` would be a mistake
// ---------------------------------------------------------------------------
// `CollectionApi.list` first mints a pskey with `GetPskey` (that part IS OIDB,
// `0x102a_0`, already ported in `ts/src/oidb/services/0x102a.ts`), then posts to
// Weiyun over plain HTTPS with a hand-rolled envelope:
//
//     offset 0   4 bytes  magic           20 13 03 29   (not a protobuf tag)
//     offset 4   2 bytes  version         00 01
//     offset 6   4 bytes  totalLength     BE, INCLUDING the 16-byte header
//     offset 10  4 bytes  bodyLength      BE, header not included
//     offset 14  2 bytes  reserved        00 00
//     offset 16  n bytes  head            protobuf CollectionRequestHead
//     ...        m bytes  body            protobuf CollectionRequestBody
//
// The two lengths are the subtle part: `totalLength` counts the header and
// `bodyLength` does not, so `head` occupies `totalLength - 16 - bodyLength`. A
// decoder that assumes `bodyLength` covers everything after the head reads the
// head as body.
//
// ---------------------------------------------------------------------------
// Why the request is not a single protobuf message
// ---------------------------------------------------------------------------
// The head and the body carry DIFFERENT field numbers for "the operation", and
// the body's wrapper is `field 1 -> operation` while the head's is flat
// `uin/sequence/commandType/operationId/...`. Field 11 in the head is not a
// scalar: it is a `string` at tag 90, and tags 112/120 are fields 14/15. Those
// field numbers are read from the reference's `__write_CollectionRequestHead`,
// whose tag bytes are `8,16,24,32,40,48,56,80,90,112,120` (raw, not <<3).
//
// ---------------------------------------------------------------------------
// Pagination cursor
// ---------------------------------------------------------------------------
// The first request sends `timeStamp = 0xFFFFFFFFFFFFFFFF` (uint64 max) and each
// subsequent page sends the SMALLEST `modifyTime` seen so far. The loop requires
// that cursor to strictly DECREASE; a page that does not move it backwards throws
// rather than looping, because a non-decreasing cursor means the server is
// repeating a page and the walk would never terminate.
//
// `reachedBottom == 0` means "more data", which reads backwards but is the
// reference's condition and is asserted directly.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../../oidb/wire.js";

/** The 4-byte magic that starts every collection frame. Not a protobuf tag. */
export const COLLECTION_MAGIC = Uint8Array.from([0x20, 0x13, 0x03, 0x29]);

/** Frame version, 2 bytes. */
export const COLLECTION_VERSION = Uint8Array.from([0x00, 0x01]);

/** The 16-byte header length. */
export const COLLECTION_HEADER_LENGTH = 16;

export const COLLECTION_ENDPOINT = "https://collector.weiyun.com/collector.fcg";
export const COLLECTION_HOST = "collector.weiyun.com";
export const COLLECTION_OPERATION_ID = 20_000;
export const COLLECTION_TICKET_TYPE = 27;
export const COLLECTION_APP_ID = 5004;
export const COLLECTION_PAGE_SIZE = 50;
export const COLLECTION_MAX_COUNT = 500;
export const COLLECTION_MAX_PAGES = 100;
export const COLLECTION_TIMEOUT_MS = 10_000;
export const COLLECTION_OPERATION_TIMEOUT_MS = 60_000;
export const COLLECTION_RESPONSE_LIMIT = 16 * 1024 * 1024;
/** The initial pagination cursor: uint64 max, i.e. "newest first". */
export const COLLECTION_INITIAL_TIMESTAMP = 18_446_744_073_709_551_615n;

/** `clientVersion` is a fixed 64-bit build stamp in the reference, not a date. */
const COLLECTION_CLIENT_VERSION = 6_667_389_245_007n;

// ---------------------------------------------------------------------------
// Request messages
// ---------------------------------------------------------------------------

/** Field numbers of `CollectionRequestHead`, from `__write_`'s tag bytes. */
export const CollectionRequestHeadField = {
  uin: 1,
  sequence: 2,
  commandType: 3,
  operationId: 4,
  clientVersion: 5,
  platform: 6,
  ticketType: 7,
  /** Field 8 exists in the message but `__write_` never emits it — there is no
   *  `_f` bound to tag 64 at all. Field 10 is `reserved`. */
  reserved: 10,
  /** Field 11, tag 90 — NOT field 8/9. The pskey lands here. */
  ticket: 11,
  field14: 14,
  field15: 15,
} as const;

export interface CollectionRequestHead {
  uin: bigint;
  sequence: number;
  commandType: number;
  operationId: number;
  clientVersion: bigint;
  platform: number;
  ticketType: number;
  reserved: number;
  ticket: string;
  field14: number;
  field15: number;
}

/** `CollectionRequestBody { operation }`, field 1. */
export const CollectionRequestBodyField = { operation: 1 } as const;

/** `CollectionRequestOperation { getCollectionList }`, field 20000. */
export const CollectionRequestOperationField = { getCollectionList: 20_000 } as const;

/** Field numbers of `GetCollectionListRequest`, from `__write_`'s tag bytes. */
export const GetCollectionListRequestField = {
  field1: 1,
  field2: 2,
  field3: 3,
  timeStamp: 4,
  orderType: 5,
  groupId: 6,
  count: 7,
  searchDown: 8,
  field9: 9,
} as const;

export interface GetCollectionListRequest {
  field1: number;
  field2: number;
  field3: number;
  timeStamp: bigint;
  orderType: number;
  groupId: bigint;
  count: number;
  searchDown: number;
  field9: number;
}

/**
 * Encode `CollectionRequestHead`.
 *
 * Presence rule copied from the reference's `__size_`/`__write_` pair: each field
 * is emitted only when it is `!= null && !== 0` (`!== 0n` for the 64-bit ones,
 * `!== ""` for the ticket). `commandType`, `operationId`, `platform`,
 * `ticketType`, `field14` and `field15` are always non-zero in the reference's own
 * call site, so their zero-suppression is never exercised — but reproducing it
 * means an all-default head encodes to zero bytes, exactly as there.
 */
export function encodeCollectionRequestHead(head: CollectionRequestHead): Uint8Array {
  return new ProtoWriter()
    .uint64(CollectionRequestHeadField.uin, head.uin)
    .uint32(CollectionRequestHeadField.sequence, head.sequence)
    .uint32(CollectionRequestHeadField.commandType, head.commandType)
    .uint32(CollectionRequestHeadField.operationId, head.operationId)
    .uint64(CollectionRequestHeadField.clientVersion, head.clientVersion)
    .uint32(CollectionRequestHeadField.platform, head.platform)
    .uint32(CollectionRequestHeadField.ticketType, head.ticketType)
    .uint32(CollectionRequestHeadField.reserved, head.reserved)
    .string(CollectionRequestHeadField.ticket, head.ticket)
    .uint32(CollectionRequestHeadField.field14, head.field14)
    .uint32(CollectionRequestHeadField.field15, head.field15)
    .finish();
}

/** Encode one `GetCollectionListRequest`. */
export function encodeGetCollectionListRequest(body: GetCollectionListRequest): Uint8Array {
  return new ProtoWriter()
    .uint32(GetCollectionListRequestField.field1, body.field1)
    .uint32(GetCollectionListRequestField.field2, body.field2)
    .uint32(GetCollectionListRequestField.field3, body.field3)
    .uint64(GetCollectionListRequestField.timeStamp, body.timeStamp)
    .uint32(GetCollectionListRequestField.orderType, body.orderType)
    .uint64(GetCollectionListRequestField.groupId, body.groupId)
    .uint32(GetCollectionListRequestField.count, body.count)
    .uint32(GetCollectionListRequestField.searchDown, body.searchDown)
    .uint32(GetCollectionListRequestField.field9, body.field9)
    .finish();
}

/** Encode `CollectionRequestOperation { getCollectionList }`. */
export function encodeCollectionRequestOperation(body: GetCollectionListRequest): Uint8Array {
  return new ProtoWriter()
    .message(CollectionRequestOperationField.getCollectionList, encodeGetCollectionListRequest(body))
    .finish();
}

/** Encode `CollectionRequestBody { operation }`. */
export function encodeCollectionRequestBody(body: GetCollectionListRequest): Uint8Array {
  return new ProtoWriter()
    .message(CollectionRequestBodyField.operation, encodeCollectionRequestOperation(body))
    .finish();
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/**
 * Wrap a head and a body in the Weiyun frame.
 *
 * `totalLength` includes the 16-byte header; `bodyLength` does not. Both are
 * big-endian, and the `reserved` halfword is written as literal zero.
 */
export function encodeCollectionEnvelope(head: Uint8Array, body: Uint8Array): Uint8Array {
  const totalLength = COLLECTION_HEADER_LENGTH + head.length + body.length;
  const output = Buffer.allocUnsafe(totalLength);
  output.set(COLLECTION_MAGIC, 0);
  output.set(COLLECTION_VERSION, 4);
  output.writeUInt32BE(totalLength, 6);
  output.writeUInt32BE(body.length, 10);
  output.writeUInt16BE(0, 14);
  output.set(head, COLLECTION_HEADER_LENGTH);
  output.set(body, COLLECTION_HEADER_LENGTH + head.length);
  return output;
}

/** The head and body of one decoded response frame. */
export interface CollectionResponseFrame {
  head: CollectionResponseHead;
  body: CollectionResponseBody;
}

/**
 * Decode a response frame.
 *
 * Every check in here is a real guard copied from the reference, and they are all
 * "reject rather than guess": a wrong magic, a wrong version, a mismatched total
 * length or a body length that leaves no room for the head all mean the bytes are
 * not a collection frame, and reading them anyway would produce a plausible-looking
 * empty result instead of an error.
 *
 * `bodyOffset = totalLength - bodyLength` is the trick: the body is anchored to the
 * END of the frame, so the head is whatever sits between the header and it.
 */
export function decodeCollectionEnvelope(bytes: Uint8Array): CollectionResponseFrame {
  const input = Buffer.from(bytes);
  if (input.length <= COLLECTION_HEADER_LENGTH) throw new Error("collection response is too short");
  if (!input.subarray(0, 4).equals(Buffer.from(COLLECTION_MAGIC))) {
    throw new Error("collection response has invalid magic");
  }
  if (!input.subarray(4, 6).equals(Buffer.from(COLLECTION_VERSION))) {
    throw new Error("collection response has unsupported version");
  }
  const totalLength = input.readUInt32BE(6);
  if (totalLength !== input.length) {
    throw new Error(`collection response length mismatch: ${String(totalLength)} != ${String(input.length)}`);
  }
  const bodyLength = input.readUInt32BE(10);
  if (input.readUInt16BE(14) !== 0) throw new Error("collection response has invalid reserved bytes");
  if (bodyLength === 0 || bodyLength >= totalLength - COLLECTION_HEADER_LENGTH) {
    throw new Error("collection response has invalid body length");
  }
  const bodyOffset = totalLength - bodyLength;
  return {
    head: decodeCollectionResponseHead(input.subarray(COLLECTION_HEADER_LENGTH, bodyOffset)),
    body: decodeCollectionResponseBody(input.subarray(bodyOffset)),
  };
}

// ---------------------------------------------------------------------------
// Response messages
// ---------------------------------------------------------------------------

/** `CollectionResponseHead`: retCode / retMsg / promptMsg. */
export const CollectionResponseHeadField = { retCode: 101, retMsg: 102, promptMsg: 103 } as const;

export interface CollectionResponseHead {
  retCode: number | null;
  retMsg: string | null;
  promptMsg: string | null;
}

/** `CollectionResponseBody { operation }`. */
export const CollectionResponseBodyField = { operation: 2 } as const;

/** `CollectionResponseOperation { getCollectionList }`. */
export const CollectionResponseOperationField = { getCollectionList: 20_000 } as const;

export interface CollectionResponseBody {
  operation: GetCollectionListResponse | null;
}

/** `GetCollectionListResponse`: items / totalCount / reachedBottom. */
export const GetCollectionListResponseField = { items: 1, totalCount: 2, reachedBottom: 3 } as const;

export interface GetCollectionListResponse {
  items: CollectionItem[];
  totalCount: number | null;
  reachedBottom: number | null;
}

/**
 * `CollectionItem` — the 22 fields the reference decodes.
 *
 * `field6`/`field7`/`field13`/`field14`/`field16`/`field17`/`field19`/`field506`
 * are the reference's own placeholder names for fields it decodes without
 * naming; the port keeps them so a diff against the reference's decoded object is
 * literal rather than "equal after dropping keys".
 */
export interface CollectionItem {
  cid: string | null;
  type: number | null;
  status: number | null;
  author: CollectionAuthor | null;
  bid: number | null;
  field6: number | null;
  field7: string | null;
  category: number | null;
  createTime: bigint | null;
  collectTime: bigint | null;
  modifyTime: bigint | null;
  sequence: bigint | null;
  field13: string | null;
  field14: string[];
  summary: CollectionSummary | null;
  field16: boolean | null;
  field17: bigint | null;
  shareUrl: string | null;
  field19: number | null;
  customGroupId: number | null;
  securityBeat: boolean | null;
  field506: string | null;
}

/** `CollectionAuthor`: type / numId / strId / groupId / groupName / uid. */
export interface CollectionAuthor {
  type: number | null;
  numId: bigint | null;
  strId: string | null;
  groupId: bigint | null;
  groupName: string | null;
  uid: string | null;
}

/** `CollectionSummary`'s eight optional variants, fields 1..8. */
export interface CollectionSummary {
  textSummary: CollectionTextSummary | null;
  linkSummary: unknown;
  gallerySummary: unknown;
  audioSummary: unknown;
  videoSummary: unknown;
  fileSummary: unknown;
  locationSummary: unknown;
  richMediaSummary: CollectionRichMediaSummary | null;
}

export interface CollectionTextSummary {
  text: string | null;
  truncated: boolean | null;
}

export interface CollectionRichMediaSummary {
  title: string | null;
  subTitle: string | null;
  brief: string | null;
  picList: unknown[];
  contentType: number | null;
  originalUri: string | null;
  publisher: string | null;
  richMediaVersion: number | null;
}

/** Decode `CollectionResponseHead`. `retCode` is signed (`_val | 0`). */
export function decodeCollectionResponseHead(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): CollectionResponseHead {
  const reader = new ProtoReader(data, offset, end);
  const head: CollectionResponseHead = { retCode: null, retMsg: null, promptMsg: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(CollectionResponseHeadField.retCode, WireType.varint):
        // Signed: the reference ends this case with `_f0 = _val | 0`, and a QQ
        // "wrong pskey" answer is a negative code.
        head.retCode = reader.int32();
        break;
      case tagOf(CollectionResponseHeadField.retMsg, WireType.lengthDelimited):
        head.retMsg = reader.string();
        break;
      case tagOf(CollectionResponseHeadField.promptMsg, WireType.lengthDelimited):
        head.promptMsg = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return head;
}

/** Decode `CollectionResponseBody`. */
export function decodeCollectionResponseBody(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): CollectionResponseBody {
  const reader = new ProtoReader(data, offset, end);
  const body: CollectionResponseBody = { operation: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(CollectionResponseBodyField.operation, WireType.lengthDelimited):
        body.operation = reader.message(decodeCollectionResponseOperation);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return body;
}

function decodeCollectionResponseOperation(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GetCollectionListResponse | null {
  const reader = new ProtoReader(data, offset, end);
  let result: GetCollectionListResponse | null = null;
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(CollectionResponseOperationField.getCollectionList, WireType.lengthDelimited):
        result = reader.message(decodeGetCollectionListResponse);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return result;
}

/** Decode `GetCollectionListResponse`. `items` is repeated, so it starts as `[]`. */
export function decodeGetCollectionListResponse(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GetCollectionListResponse {
  const reader = new ProtoReader(data, offset, end);
  const response: GetCollectionListResponse = { items: [], totalCount: null, reachedBottom: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GetCollectionListResponseField.items, WireType.lengthDelimited):
        response.items.push(reader.message(decodeCollectionItem));
        break;
      case tagOf(GetCollectionListResponseField.totalCount, WireType.varint):
        response.totalCount = reader.uint32();
        break;
      case tagOf(GetCollectionListResponseField.reachedBottom, WireType.varint):
        response.reachedBottom = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return response;
}

/** Decode `CollectionItem`. */
export function decodeCollectionItem(data: Uint8Array, offset = 0, end = data.length): CollectionItem {
  const reader = new ProtoReader(data, offset, end);
  const item: CollectionItem = {
    cid: null,
    type: null,
    status: null,
    author: null,
    bid: null,
    field6: null,
    field7: null,
    category: null,
    createTime: null,
    collectTime: null,
    modifyTime: null,
    sequence: null,
    field13: null,
    field14: [],
    summary: null,
    field16: null,
    field17: null,
    shareUrl: null,
    field19: null,
    customGroupId: null,
    securityBeat: null,
    field506: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(1, WireType.lengthDelimited):
        item.cid = reader.string();
        break;
      case tagOf(2, WireType.varint):
        item.type = reader.uint32();
        break;
      case tagOf(3, WireType.varint):
        item.status = reader.uint32();
        break;
      case tagOf(4, WireType.lengthDelimited):
        item.author = reader.message(decodeCollectionAuthor);
        break;
      case tagOf(5, WireType.varint):
        item.bid = reader.uint32();
        break;
      case tagOf(6, WireType.varint):
        item.field6 = reader.uint32();
        break;
      case tagOf(7, WireType.lengthDelimited):
        item.field7 = reader.string();
        break;
      case tagOf(8, WireType.varint):
        item.category = reader.uint32();
        break;
      case tagOf(9, WireType.varint):
        item.createTime = reader.uint64();
        break;
      case tagOf(10, WireType.varint):
        item.collectTime = reader.uint64();
        break;
      case tagOf(11, WireType.varint):
        item.modifyTime = reader.uint64();
        break;
      case tagOf(12, WireType.varint):
        item.sequence = reader.uint64();
        break;
      case tagOf(13, WireType.lengthDelimited):
        item.field13 = reader.string();
        break;
      case tagOf(14, WireType.lengthDelimited):
        item.field14.push(reader.string());
        break;
      case tagOf(15, WireType.lengthDelimited):
        item.summary = reader.message(decodeCollectionSummary);
        break;
      case tagOf(16, WireType.varint):
        item.field16 = reader.bool();
        break;
      case tagOf(17, WireType.varint):
        item.field17 = reader.uint64();
        break;
      case tagOf(18, WireType.lengthDelimited):
        item.shareUrl = reader.string();
        break;
      case tagOf(19, WireType.varint):
        item.field19 = reader.uint32();
        break;
      case tagOf(20, WireType.varint):
        item.customGroupId = reader.uint32();
        break;
      case tagOf(21, WireType.varint):
        item.securityBeat = reader.bool();
        break;
      case tagOf(506, WireType.lengthDelimited):
        item.field506 = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return item;
}

/** Decode `CollectionAuthor`. */
export function decodeCollectionAuthor(data: Uint8Array, offset = 0, end = data.length): CollectionAuthor {
  const reader = new ProtoReader(data, offset, end);
  const author: CollectionAuthor = { type: null, numId: null, strId: null, groupId: null, groupName: null, uid: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(1, WireType.varint):
        author.type = reader.uint32();
        break;
      case tagOf(2, WireType.varint):
        author.numId = reader.uint64();
        break;
      case tagOf(3, WireType.lengthDelimited):
        author.strId = reader.string();
        break;
      case tagOf(4, WireType.varint):
        author.groupId = reader.uint64();
        break;
      case tagOf(5, WireType.lengthDelimited):
        author.groupName = reader.string();
        break;
      case tagOf(6, WireType.lengthDelimited):
        author.uid = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return author;
}

/** Decode `CollectionSummary` — eight message-typed variants, only two named. */
export function decodeCollectionSummary(data: Uint8Array, offset = 0, end = data.length): CollectionSummary {
  const reader = new ProtoReader(data, offset, end);
  const summary: CollectionSummary = {
    textSummary: null,
    linkSummary: null,
    gallerySummary: null,
    audioSummary: null,
    videoSummary: null,
    fileSummary: null,
    locationSummary: null,
    richMediaSummary: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(1, WireType.lengthDelimited):
        summary.textSummary = reader.message(decodeCollectionTextSummary);
        break;
      case tagOf(2, WireType.lengthDelimited):
        summary.linkSummary = reader.message(decodeCollectionOpaqueMessage);
        break;
      case tagOf(3, WireType.lengthDelimited):
        summary.gallerySummary = reader.message(decodeCollectionOpaqueMessage);
        break;
      case tagOf(4, WireType.lengthDelimited):
        summary.audioSummary = reader.message(decodeCollectionOpaqueMessage);
        break;
      case tagOf(5, WireType.lengthDelimited):
        summary.videoSummary = reader.message(decodeCollectionOpaqueMessage);
        break;
      case tagOf(6, WireType.lengthDelimited):
        summary.fileSummary = reader.message(decodeCollectionOpaqueMessage);
        break;
      case tagOf(7, WireType.lengthDelimited):
        summary.locationSummary = reader.message(decodeCollectionOpaqueMessage);
        break;
      case tagOf(8, WireType.lengthDelimited):
        summary.richMediaSummary = reader.message(decodeCollectionRichMediaSummary);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return summary;
}

/**
 * A summary variant this port does not name field-by-field.
 *
 * The reference expands all five (link/gallery/audio/video/file/location) into
 * their own decoders, ~2600 lines in total, and every one of them exists only to
 * be handed to `jsonSafe()` and dropped into the OneBot payload. Decoding them
 * structurally — keeping the unknown-field metadata — preserves the bytes' shape
 * without inventing field numbers this port has not verified. When an action
 * actually reads, say, `linkSummary.url`, that variant gets its own decoder.
 */
export interface OpaqueSummary {
  readonly __opaque: true;
  readonly bytes: Uint8Array;
}

export function decodeCollectionOpaqueMessage(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OpaqueSummary {
  return { __opaque: true, bytes: data.slice(offset, end) };
}

/** Decode `CollectionTextSummary`: text / truncated. */
export function decodeCollectionTextSummary(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): CollectionTextSummary {
  const reader = new ProtoReader(data, offset, end);
  const summary: CollectionTextSummary = { text: null, truncated: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(1, WireType.lengthDelimited):
        summary.text = reader.string();
        break;
      case tagOf(2, WireType.varint):
        summary.truncated = reader.bool();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return summary;
}

/** Decode `CollectionRichMediaSummary` — the one variant with named nested pictures. */
export function decodeCollectionRichMediaSummary(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): CollectionRichMediaSummary {
  const reader = new ProtoReader(data, offset, end);
  const summary: CollectionRichMediaSummary = {
    title: null,
    subTitle: null,
    brief: null,
    picList: [],
    contentType: null,
    originalUri: null,
    publisher: null,
    richMediaVersion: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(1, WireType.lengthDelimited):
        summary.title = reader.string();
        break;
      case tagOf(2, WireType.lengthDelimited):
        summary.subTitle = reader.string();
        break;
      case tagOf(3, WireType.lengthDelimited):
        summary.brief = reader.string();
        break;
      case tagOf(4, WireType.lengthDelimited):
        summary.picList.push(reader.message(decodeCollectionOpaqueMessage));
        break;
      case tagOf(5, WireType.varint):
        summary.contentType = reader.uint32();
        break;
      case tagOf(6, WireType.lengthDelimited):
        summary.originalUri = reader.string();
        break;
      case tagOf(7, WireType.lengthDelimited):
        summary.publisher = reader.string();
        break;
      case tagOf(8, WireType.varint):
        summary.richMediaVersion = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return summary;
}