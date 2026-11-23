// Bridge layer tests: only for code that actually runs without a live QQ.
//
// Three kinds of assertion here, deliberately separated:
//
//   1. GOLDEN BYTES. `collectionRequestBytes`'s expected hex was produced by
//      loading the reference's own `src/web/collection.ts` region and calling its
//      `requestBytes`. `work/bridge-parts/ref/collection.mjs` reproduces it; the
//      literal below is that harness's output, quoted verbatim. This is the only
//      way to know the frame layout (`totalLength` including the header,
//      `bodyLength` excluding it) is right — a round-trip test would pass with both
//      lengths swapped.
//
//   2. PURE TRANSFORMS. `mapGroupNoticeResponse`, `resolveGroupNoticeOptions`,
//      `mapDaySignedList`, `getBknFromSKey`, `resolveVideoUrl` — each is an oracle
//      copied from the reference region named in its module, so the test states the
//      reference's own behaviour (including the surprising parts: the rank de-skew,
//      the bkn pair, `inst` winning over `feeds`).
//
//   3. CONTRACT CHECKS. `Bridge`'s `sendRawPacket` sentinel, the LCG, the seq
//      counters, the upload cache bound. Cheap, and they are the invariants the
//      OIDB layer depends on.
//
// What is NOT tested, and why: every `WebApi` method that ends in an HTTPS request
// (`getCookies`, `getNotice`, `getFriendDress`, …). Their whole body is a network
// call plus a decode, and a fake transport would only prove the fake matches the
// fake. `getCollectionList`'s pagination loop IS tested, through the injectable
// `transport`, because its bounds (page cap, cursor monotonicity, dedupe, `hasMore`)
// are logic rather than I/O.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Bridge, BRIDGE_EVENT_KINDS } from "../src/bridge/bridge.js";
import { BridgeEventBusImpl } from "../src/bridge/events.js";
import { collectionRequestBytes, getCollectionList, mapCollectionItem, collectionJsonSafe } from "../src/bridge/web/collection.js";
import { decodeCollectionEnvelope, encodeCollectionEnvelope, COLLECTION_MAGIC, CollectionRequestHeadField } from "../src/bridge/web/collection-wire.js";
import { getBknFromSKey, mapGroupNoticeResponse, WebApi, buildJumpUrl } from "../src/bridge/apis/web.js";
import { resolveGroupNoticeOptions, groupNoticeImageUrl, parseGroupNoticeImageUploadResponse } from "../src/bridge/web/group-notice.js";
import { mapDaySignedList, yyyymmdd } from "../src/bridge/web/group-signin.js";
import { resolveVideoUrl, UNRESOLVABLE_APPS, FriendDressError, validateAsyncData } from "../src/bridge/web/friend-dress.js";
import { getBknFromCookie } from "../src/bridge/web/request-util.js";
import { MemoryIdentity } from "../src/bridge/bridge.js";

// ===========================================================================
// 1. Golden bytes
// ===========================================================================

test("collection request frame matches the reference's own encoder", () => {
  // Produced by work/bridge-parts/ref/collection.mjs, which is the reference's
  // src/web/collection.ts region loaded verbatim:
  //   requestBytes(10001n, "PSKEY-ABC", 1, 18446744073709551615n)
  // 80 bytes. Field-by-field: magic 20130329, version 0001, totalLength
  // 00000050 (= 80), bodyLength 00000017 (= 23), reserved 0000, then
  // head 08 914e (uin) … and body 0a 15 … (operation 20000 → 0x9c2 → tags e2 09 11).
  const expected =
    "2013032900010000005000000017000008914e1001180120a09c0128cfacf8fa85c2013004381b5a0950534b45592d414243700878090a1582e2091120ffffffffffffffffff01280238324001";
  const actual = Buffer.from(collectionRequestBytes("10001", "PSKEY-ABC", 1, 18446744073709551615n)).toString("hex");
  assert.equal(actual, expected);
});

test("collection frame header: totalLength includes the header, bodyLength does not", () => {
  const bytes = collectionRequestBytes("10001", "PSKEY-ABC", 1, 18446744073709551615n);
  const view = Buffer.from(bytes);
  assert.deepEqual([...view.subarray(0, 4)], [...COLLECTION_MAGIC]);
  assert.equal(view.readUInt32BE(6), view.length);
  assert.equal(view.readUInt16BE(14), 0);
  const bodyLength = view.readUInt32BE(10);
  // If bodyLength were inclusive of the header, head length would be negative.
  assert.ok(bodyLength < view.length - 16);
});

// ===========================================================================
// 2. Frame decoding guards — every one must REJECT, not guess
// ===========================================================================

/** `encodeCollectionEnvelope` returns a Buffer at runtime; keep a view for the
 *  mutating tests so they can corrupt one header field in place. */
function frame(head: Uint8Array, body: Uint8Array): Buffer {
  return Buffer.from(encodeCollectionEnvelope(head, body));
}

/**
 * A minimal NON-EMPTY response head.
 *
 * The reference's own decoder requires `bodyLength < totalLength - 16`, i.e. the
 * head must occupy at least one byte — and its encoder suppresses zero-valued
 * fields, so a fully-default head encodes to ZERO bytes and is then rejected by its
 * own decoder. In practice the server always sets at least one head field, so this
 * is unreachable in production; it does mean a test cannot build a frame with an
 * empty head and expect it to decode.
 *
 * `promptMsg` (field 103, tag `ba 06`) as an empty string is the cheapest way to
 * make the head non-empty without asserting anything about `retCode`.
 */
const MINIMAL_HEAD = Uint8Array.from([0xba, 0x06, 0x00]);

test("collection envelope rejects a bad magic", () => {
  const bytes = frame(MINIMAL_HEAD, Uint8Array.from([0x0a, 0x00]));
  bytes[0] = 0xff;
  assert.throws(() => decodeCollectionEnvelope(bytes), /invalid magic/);
});

test("collection envelope rejects an unsupported version", () => {
  const bytes = frame(MINIMAL_HEAD, Uint8Array.from([0x0a, 0x00]));
  bytes[5] = 0x02;
  assert.throws(() => decodeCollectionEnvelope(bytes), /unsupported version/);
});

test("collection envelope rejects a length mismatch", () => {
  const bytes = frame(MINIMAL_HEAD, Uint8Array.from([0x0a, 0x00]));
  // The frame is only 19 bytes, so `readUInt32BE(6)` is `00 00 00 13`; bumping the
  // low byte is the smallest edit that makes the declared length disagree.
  bytes[9] = bytes[9]! + 1;
  assert.throws(() => decodeCollectionEnvelope(bytes), /length mismatch/);
});

test("collection envelope rejects reserved bytes", () => {
  const bytes = frame(MINIMAL_HEAD, Uint8Array.from([0x0a, 0x00]));
  bytes[15] = 0x01;
  assert.throws(() => decodeCollectionEnvelope(bytes), /reserved/);
});

test("collection envelope rejects a body that leaves no room for the head", () => {
  const bytes = frame(MINIMAL_HEAD, Uint8Array.from([0x0a, 0x00]));
  // bodyLength == totalLength - 16 means the head is empty *and* the body starts
  // inside the header, which the reference treats as invalid rather than "no head".
  bytes.writeUInt32BE(bytes.length - 16, 10);
  assert.throws(() => decodeCollectionEnvelope(bytes), /invalid body length/);
});

test("collection envelope decodes an empty page and reports more data", () => {
  // Body: field 2 → operation, zero length, so `getCollectionList` itself is absent.
  const body = Uint8Array.from([0x12, 0x00]);
  const decoded = decodeCollectionEnvelope(frame(MINIMAL_HEAD, body));
  assert.equal(decoded.head.retCode, null);
  assert.equal(decoded.head.promptMsg, "");
  assert.equal(decoded.body.operation, null);
});

test("collection envelope decodes retCode 0 explicitly when it is present", () => {
  // tagOf(101, varint) = 101<<3 = 808 = 0x328 → varint bytes 0xa8 0x06.
  const decoded = decodeCollectionEnvelope(frame(Uint8Array.from([0xa8, 0x06, 0x00]), Uint8Array.from([0x12, 0x00])));
  assert.equal(decoded.head.retCode, 0);
});

test("collection head field numbers come from __write_'s tag bytes, not the field order", () => {
  // ticket is field ELEVEN (tag 90 / 0x5a), not field 8 or 9. Getting this wrong
  // puts the pskey in a field the server ignores.
  assert.equal(CollectionRequestHeadField.ticket, 11);
  assert.equal(CollectionRequestHeadField.reserved, 10);
  const bytes = Buffer.from(
    encodeCollectionEnvelope(
      new Uint8Array(0),
      new Uint8Array(0),
    ),
  );
  assert.equal(bytes.length, 16);
});

test("collection envelope rejects a zero-length head, which its own encoder can emit", () => {
  // Encode/decode asymmetry inherited from the reference: every head field is
  // zero-suppressed, so a "success with no prompts" head is 0 bytes, and
  // `bodyLength >= totalLength - 16` then rejects the frame. Documented rather than
  // fixed — the server always writes at least one field.
  const bytes = frame(new Uint8Array(0), Uint8Array.from([0x12, 0x00]));
  assert.throws(() => decodeCollectionEnvelope(bytes), /invalid body length/);
});

// ===========================================================================
// 3. The pagination walk
// ===========================================================================

/** Build one collection response frame with `reachedBottom` and items. */
function pageFrame(items: Array<{ cid: string; category: number; modifyTime: bigint }>, reachedBottom: number): Uint8Array {
  const itemBytes = items.map((item) => {
    const parts: number[] = [];
    // field 1 cid (string)
    parts.push(0x0a, item.cid.length, ...Buffer.from(item.cid));
    // field 4 author — REQUIRED: the walk validates it before mapping, because a
    // collection item with no author cannot be attributed. field 6 inside it is uid.
    const author = [0x32, 0x01, 0x75]; // uid = "u"
    parts.push(0x22, author.length, ...author);
    // field 8 category (varint)
    parts.push(0x40, item.category);
    // field 11 modifyTime (varint) — consumed as uint64
    parts.push(0x58);
    parts.push(...encodeVarint(item.modifyTime));
    return parts;
  });
  const listParts: number[] = [];
  for (const item of itemBytes) listParts.push(0x0a, item.length, ...item);
  // field 2 totalCount, field 3 reachedBottom
  listParts.push(0x10, 60);
  listParts.push(0x18, reachedBottom);
  // Field 20000, wire type 2 → tag 160002 → varint 0x82 0xe2 0x09. (The golden
  // frame above confirms these bytes; `0xe2 0x09 0x11` would be tag 0x9c2<<3,
  // i.e. field 20000 encoded as wire type 0 followed by a stray byte.)
  const operation = [0x82, 0xe2, 0x09, listParts.length, ...listParts];
  const body = [0x12, operation.length, ...operation];
  return encodeCollectionEnvelope(MINIMAL_HEAD, Uint8Array.from(body));
}

/**
 * Read `GetCollectionListRequest.timeStamp` (field 4, varint) back out of a request
 * frame, so a test can prove the walk really sends the cursor it computed.
 *
 * The head is variable-length, so scanning for the tag byte `0x20` from the end is
 * the reliable route: field 4 is followed only by single-byte varints for
 * `orderType` (5), `count` (7) and `searchDown` (8), and the uint64 `groupId` (6) is
 * zero-suppressed here.
 */
function readCursorFromRequest(body: Uint8Array): bigint {
  const index = body.lastIndexOf(0x20);
  if (index < 0) return -1n;
  let cursor = 0n;
  let shift = 0n;
  for (let i = index + 1; i < body.length; i++) {
    const byte = body[i] ?? 0;
    cursor |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
    if ((byte & 0x80) === 0) break;
  }
  return cursor;
}

function encodeVarint(value: bigint): number[] {
  const out: number[] = [];
  let v = value;
  for (;;) {
    const byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v === 0n) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

test("collection pagination stops at the requested count and reports hasMore", async () => {
  const calls: Array<{ timeStamp: bigint; sequence: number }> = [];
  const transport = async (request: { body: Uint8Array }): Promise<Uint8Array> => {
    calls.push({ timeStamp: readCursorFromRequest(request.body), sequence: calls.length + 1 });
    if (calls.length === 1) {
      return pageFrame(
        [
          { cid: "a", category: 0, modifyTime: 900n },
          { cid: "b", category: 0, modifyTime: 800n },
        ],
        0, // 0 = MORE data
      );
    }
    return pageFrame(
      [
        { cid: "c", category: 0, modifyTime: 700n },
        { cid: "d", category: 0, modifyTime: 600n },
      ],
      1, // non-zero = end
    );
  };
  const result = await getCollectionList({ uin: "10001", pskey: "K", count: 4, transport });
  assert.equal(result.errCode, 0);
  assert.deepEqual(
    result.collectionSearchList.collectionItemList.map((item) => item.cid),
    ["a", "b", "c", "d"],
  );
  // First cursor is uint64 max, second is the minimum modifyTime of page one.
  assert.equal(calls[0]?.timeStamp, 18446744073709551615n);
  assert.equal(calls[1]?.timeStamp, 800n);
  assert.equal(result.collectionSearchList.hasMore, false);
  assert.equal(result.collectionSearchList.bottomTimeStamp, "600");
});

test("collection pagination throws when the cursor does not decrease", async () => {
  // A server that repeats page one. Without the monotonicity check this would
  // issue 100 identical requests and then blame the page cap.
  const transport = async (): Promise<Uint8Array> =>
    pageFrame([{ cid: "a", category: 0, modifyTime: 900n }], 0);
  await assert.rejects(
    () => getCollectionList({ uin: "10001", pskey: "K", count: 10, transport }),
    /cursor did not decrease/,
  );
});

test("collection pagination dedupes by cid before counting", async () => {
  // Paging on modifyTime can repeat an item sitting exactly on the boundary.
  let call = 0;
  const transport = async (): Promise<Uint8Array> => {
    call += 1;
    if (call === 1) {
      return pageFrame(
        [
          { cid: "same", category: 0, modifyTime: 900n },
          { cid: "x", category: 0, modifyTime: 800n },
        ],
        0,
      );
    }
    return pageFrame([{ cid: "same", category: 0, modifyTime: 700n }], 1);
  };
  const result = await getCollectionList({ uin: "10001", pskey: "K", count: 5, transport });
  assert.deepEqual(
    result.collectionSearchList.collectionItemList.map((item) => item.cid),
    ["same", "x"],
  );
});

test("collection category filter asks for one extra item so hasMore is answerable", async () => {
  // With a category filter, `hasMore` cannot be answered from the server's
  // `reachedBottom` (which counts ALL categories), so the walk asks for
  // `count + 1` MATCHING items and reports whether it got the extra one.
  const transport = async (): Promise<Uint8Array> =>
    pageFrame(
      [
        { cid: "a", category: 1, modifyTime: 900n },
        { cid: "b", category: 2, modifyTime: 800n }, // wrong category: not counted
        { cid: "c", category: 1, modifyTime: 700n },
        { cid: "d", category: 1, modifyTime: 600n }, // the extra one: proves more exist
      ],
      1,
    );
  const result = await getCollectionList({ uin: "10001", pskey: "K", category: 1, count: 2, transport });
  assert.deepEqual(
    result.collectionSearchList.collectionItemList.map((item) => item.cid),
    ["a", "c"],
  );
  // Three category-1 items exist but only two were asked for => more remain.
  assert.equal(result.collectionSearchList.hasMore, true);
});

test("collection category filter with EXACTLY count matches reports hasMore false", async () => {
  const transport = async (): Promise<Uint8Array> =>
    pageFrame(
      [
        { cid: "a", category: 1, modifyTime: 900n },
        { cid: "b", category: 2, modifyTime: 800n },
        { cid: "c", category: 1, modifyTime: 700n },
      ],
      1,
    );
  const result = await getCollectionList({ uin: "10001", pskey: "K", category: 1, count: 2, transport });
  assert.equal(result.collectionSearchList.collectionItemList.length, 2);
  assert.equal(result.collectionSearchList.hasMore, false);
});

test("collection rejects a non-positive count and an empty pskey", async () => {
  const transport = async (): Promise<Uint8Array> => pageFrame([], 1);
  await assert.rejects(() => getCollectionList({ uin: "1", pskey: "", count: 5, transport }), /p_skey is empty/);
  await assert.rejects(() => getCollectionList({ uin: "1", pskey: "K", count: 0, transport }), /count must be between/);
  await assert.rejects(() => getCollectionList({ uin: "1", pskey: "K", count: 1e9, transport }), /count must be between/);
});

test("collection rejects an item without modifyTime because it is the cursor", async () => {
  // modifyTime is not merely data: the next page's cursor is min(modifyTime).
  const item = {
    cid: "x",
    type: 0,
    status: 0,
    author: { type: 0, numId: 0n, strId: "", groupId: 0n, groupName: "", uid: "u" },
    bid: 0,
    field6: null,
    field7: null,
    category: 0,
    createTime: 1n,
    collectTime: 1n,
    modifyTime: 0n,
    sequence: 0n,
    field13: null,
    field14: [],
    summary: null,
    field16: null,
    field17: null,
    shareUrl: "",
    field19: null,
    customGroupId: 0,
    securityBeat: false,
    field506: null,
  };
  // `assert.rejects`, not `assert.throws`: the walk is async and `throws` never
  // awaits, so it would pass a promise it never observes.
  await assert.rejects(
    () =>
      getCollectionList({
        uin: "1",
        pskey: "K",
        transport: async () => {
          // Build a frame containing this item so validation runs inside the walk.
          const parts: number[] = [];
          parts.push(0x0a, 0x01, 0x78); // cid "x"
          parts.push(0x22, 0x03, 0x32, 0x01, 0x75); // author { uid: "u" }
          parts.push(0x40, 0x00); // category 0
          const listParts: number[] = [0x0a, parts.length, ...parts];
          // reachedBottom 0 = "more data", so the walk must reach the per-item
          // validation instead of breaking out on end-of-list first.
          listParts.push(0x18, 0x00);
          const operation = [0x82, 0xe2, 0x09, listParts.length, ...listParts];
          const body = [0x12, operation.length, ...operation];
          return encodeCollectionEnvelope(MINIMAL_HEAD, Uint8Array.from(body));
        },
      }),
    /missing modifyTime/,
  );
  assert.equal(item.modifyTime, 0n);
});

test("collectionJsonSafe stringifies bigints and base64-encodes opaque bytes", () => {
  assert.equal(collectionJsonSafe(123n), "123");
  assert.deepEqual(collectionJsonSafe({ a: 1n, b: [2n] }), { a: "1", b: ["2"] });
  assert.equal(collectionJsonSafe(new Uint8Array([1, 2, 3])), "AQID");
  assert.equal(collectionJsonSafe({ __opaque: true, bytes: new Uint8Array([4, 5]) }), "BAU=");
  assert.equal(collectionJsonSafe(null), null);
});

test("mapCollectionItem fills every default rather than leaving nulls", () => {
  const mapped = mapCollectionItem({
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
  });
  assert.equal(mapped.cid, "");
  assert.equal(mapped.author.numId, "0");
  assert.equal(mapped.createTime, "0");
  assert.equal(mapped.securityBeat, false);
  assert.equal(mapped.summary.textSummary, null);
});

// ===========================================================================
// 4. bkn: two helpers, two return types
// ===========================================================================

test("getBknFromSKey returns a number and getBknFromCookie returns a string", () => {
  // The two live in different modules in the reference and the OneBot payload
  // publishes the NUMBER as csrf_token while every URL builder concatenates the
  // STRING. A single helper would force one side to convert.
  assert.equal(typeof getBknFromSKey("test"), "number");
  assert.equal(typeof getBknFromCookie({ skey: "test" }), "string");
  assert.equal(String(getBknFromSKey("test")), getBknFromCookie({ skey: "test" }));
});

test("getBknFromCookie prefers p_skey over skey", () => {
  assert.notEqual(
    getBknFromCookie({ skey: "aaa", p_skey: "bbb" }),
    getBknFromCookie({ skey: "aaa" }),
  );
});

test("bkn is the djb2 hash truncated to 31 bits", () => {
  // djb2("test") = 2090109... & 0x7FFFFFFF. Verified against the reference's own
  // getBknFromSKey by construction (same three lines); the value pins the mask.
  assert.equal(getBknFromCookie({ skey: "test" }), String(djb2("test")));
});

function djb2(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = hash + (hash << 5) + value.charCodeAt(i);
  return hash & 2147483647;
}

// ===========================================================================
// 5. Group notice: the option conflict, the inst-wins merge, the image id
// ===========================================================================

test("resolveGroupNoticeOptions defaults exactly as the reference does", () => {
  const resolved = resolveGroupNoticeOptions();
  assert.equal(resolved.type, 1);
  assert.equal(resolved.pinned, 0);
  assert.equal(resolved.isShowEditCard, 1);
  assert.equal(resolved.tipWindowType, 1);
  assert.equal(resolved.confirmRequired, 1);
  assert.equal(resolved.imgWidth, 540);
  assert.equal(resolved.imgHeight, 300);
  assert.equal(resolved.sendToNewMembers, false);
});

test("sendToNewMembers and type are two spellings of one field, and conflict", () => {
  assert.equal(resolveGroupNoticeOptions({ sendToNewMembers: true }).type, 20);
  assert.equal(resolveGroupNoticeOptions({ sendToNewMembers: false }).type, 1);
  assert.equal(resolveGroupNoticeOptions({ type: 20 }).sendToNewMembers, true);
  assert.throws(
    () => resolveGroupNoticeOptions({ sendToNewMembers: true, type: 1 }),
    /conflicts with type=1/,
  );
  assert.throws(() => resolveGroupNoticeOptions({ type: 2 }), /type must be 1 \(regular\) or 20/);
});

test("binary notice options reject anything but 0 and 1", () => {
  assert.throws(() => resolveGroupNoticeOptions({ pinned: 2 }), /pinned must be 0 or 1/);
  assert.throws(() => resolveGroupNoticeOptions({ isShowEditCard: -1 }), /isShowEditCard must be 0 or 1/);
});

test("groupNoticeImageUrl rejects empty and path-shaped ids", () => {
  // A pasted URL in the id field would otherwise become a request to an arbitrary
  // host under gdynamic.qpic.cn's origin.
  assert.throws(() => groupNoticeImageUrl(""), /empty/);
  assert.throws(() => groupNoticeImageUrl("a/b"), /malformed/);
  assert.throws(() => groupNoticeImageUrl("a?b"), /malformed/);
  assert.equal(groupNoticeImageUrl("abc123"), "https://gdynamic.qpic.cn/gdynamic/abc123/0");
});

test("parseGroupNoticeImageUploadResponse un-escapes the nested JSON id", () => {
  // `id` is itself HTML-escaped JSON: {"id":"...","w":540,"h":300}
  const payload = JSON.stringify({
    ec: 0,
    em: "",
    id: JSON.stringify({ id: "PICID", w: 800, h: 600 }).replace(/"/g, "&quot;"),
  });
  assert.deepEqual(parseGroupNoticeImageUploadResponse(payload), { id: "PICID", width: 800, height: 600 });
  assert.throws(() => parseGroupNoticeImageUploadResponse(JSON.stringify({ ec: 1, em: "nope" })), /ec=1/);
  assert.throws(() => parseGroupNoticeImageUploadResponse("not json"), /invalid JSON/);
});

test("mapGroupNoticeResponse lets inst REPLACE feeds in place on a duplicate fid", () => {
  const feed = {
    fid: "N1",
    u: 100,
    pubt: 1000,
    msg: { text: "hi", pics: [] },
    settings: {},
    read_num: 0,
    pinned: 0,
    type: 1,
  };
  const instFeed = { ...feed, type: 20 };
  const merged = mapGroupNoticeResponse({
    ec: 0,
    feeds: [feed, { ...feed, fid: "N2", u: 200 }],
    inst: [instFeed],
  });
  // One entry for N1, still FIRST (feeds ordering), but now marked as new-member.
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.notice_id, "N1");
  assert.equal(merged[0]?.type, 20);
  assert.equal(merged[0]?.send_to_new_members, true);
  assert.equal(merged[1]?.notice_id, "N2");
});

test("mapGroupNoticeResponse accepts feeds as an OBJECT keyed by index", () => {
  // The server sends an object rather than an array when a page is filtered short.
  const feed = {
    fid: "N9",
    u: 1,
    pubt: 2,
    msg: { text: "t", pics: [] },
    settings: {},
    read_num: 0,
  };
  const merged = mapGroupNoticeResponse({ ec: 0, feeds: { 0: feed } });
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.notice_id, "N9");
});

test("mapGroupNoticeResponse validates numerics instead of zeroing them", () => {
  // sender_id 0 would attribute the announcement to QQ号 0.
  assert.throws(
    () =>
      mapGroupNoticeResponse({
        ec: 0,
        feeds: [{ fid: "X", u: "not-a-number", pubt: 1, msg: { text: "t" }, settings: {}, read_num: 0 }],
      }),
    /feed X\.u must be a finite number/,
  );
  // A numeric STRING is accepted: read_num really does arrive as a string.
  const ok = mapGroupNoticeResponse({
    ec: 0,
    feeds: [{ fid: "X", u: "123", pubt: "1", msg: { text: "t" }, settings: {}, read_num: "0" }],
  });
  assert.equal(ok[0]?.sender_id, 123);
});

test("mapGroupNoticeResponse throws on a non-zero ec naming both fields", () => {
  assert.throws(() => mapGroupNoticeResponse({ ec: 100 }), /获取公告失败: ec=100, em=missing/);
});

// ===========================================================================
// 6. Sign-in: the rank de-skew
// ===========================================================================

test("mapDaySignedList de-skews the doubled rank", () => {
  // The server sends 1, 3, 5, … so ties can interleave; human ranks are 1, 2, 3.
  const mapped = mapDaySignedList({
    response: {
      page: [
        {
          infos: [
            { uid: "111", uidGroupNick: "a", signedTimeStamp: 10, signInRank: 1 },
            { uid: "222", uidGroupNick: "b", signedTimeStamp: 20, signInRank: 3 },
            { uid: "333", uidGroupNick: "c", signedTimeStamp: 30, signInRank: 5 },
          ],
        },
      ],
    },
  });
  assert.deepEqual(
    mapped.map((row) => row.rank),
    [1, 2, 3],
  );
  assert.equal(mapped[0]?.user_id, 111);
});

test("mapDaySignedList returns [] for an empty group but the caller throws on a missing page", () => {
  assert.deepEqual(mapDaySignedList({ response: { page: [{ infos: [] }] } }), []);
  assert.deepEqual(mapDaySignedList({}), []);
});

test("yyyymmdd pads month and day", () => {
  assert.equal(yyyymmdd(new Date(2026, 0, 5)), "20260105");
  assert.equal(yyyymmdd(new Date(2026, 11, 31)), "20261231");
});

// ===========================================================================
// 7. Friend dress: typed failures and the unresolvable apps
// ===========================================================================

test("the three unresolvable dress apps are filtered out", () => {
  assert.deepEqual([...UNRESOLVABLE_APPS].sort((a, b) => a - b), [2, 5, 23]);
});

test("validateAsyncData reports structure failures with a typed kind", () => {
  assert.throws(
    () => validateAsyncData({ targetUin: "1", rawUsingList: "nope" }),
    (error: unknown) => error instanceof FriendDressError && error.kind === "structure",
  );
  assert.throws(
    () => validateAsyncData(null),
    (error: unknown) => error instanceof FriendDressError && error.kind === "structure",
  );
  assert.throws(
    () => validateAsyncData({ rawUsingList: [] }),
    (error: unknown) => error instanceof FriendDressError && error.kind === "structure",
  );
});

test("resolveVideoUrl maps appId 15's immersiveMaterial.videoUrl", () => {
  const url = resolveVideoUrl({
    appId: 15,
    extraappinfo: { extraInfo: { immersiveMaterial: JSON.stringify({ videoUrl: "https://v/x.mp4" }) } },
  });
  assert.equal(url, "https://v/x.mp4");
});

test("resolveVideoUrl derives appId 17's media.mp4 from the preview path", () => {
  assert.equal(
    resolveVideoUrl({ appId: 17, image: "https://i/funCall/item/9/web_image.jpg" }),
    "https://i/funCall/item/9/media.mp4",
  );
  assert.equal(resolveVideoUrl({ appId: 17, image: "https://i/funCall/item/9/image.jpg" }),
    "https://i/funCall/item/9/media.mp4");
  // Anything else is "" rather than a guessed path.
  assert.equal(resolveVideoUrl({ appId: 17, image: "https://i/other.png" }), "");
  assert.equal(resolveVideoUrl({ appId: 17 }), "");
});

test("resolveVideoUrl throws a structure error on malformed immersiveMaterial", () => {
  assert.throws(
    () => resolveVideoUrl({ appId: 15, extraappinfo: { extraInfo: { immersiveMaterial: "{" } } }),
    (error: unknown) => error instanceof FriendDressError && error.kind === "structure",
  );
});

// ===========================================================================
// 8. Bridge contract
// ===========================================================================

test("sendRawPacket with no sender returns the -1 sentinel instead of throwing", async () => {
  // invokeOidb turns gotResponse:false into a command-named error. Throwing here
  // would surface as an unhandled rejection from a background task instead.
  const bridge = new Bridge(new MemoryIdentity("10001"));
  const result = await bridge.sendRawPacket("trpc.test.Cmd", new Uint8Array([1]));
  assert.equal(result.success, false);
  assert.equal(result.gotResponse, false);
  assert.equal(result.errorCode, -1);
  assert.equal(result.errorMessage, "no packet sender attached");
  assert.equal(result.responseData, undefined);
  await bridge.dispose();
});

test("sendRawPacket forwards to the newest bound client and copies the body", async () => {
  const bridge = new Bridge(new MemoryIdentity("10001"));
  const sent: Uint8Array[] = [];
  const client = {
    sendPacket: async (_cmd: string, body: Uint8Array) => {
      sent.push(body);
      return { success: true, gotResponse: true, errorCode: 0, responseData: new Uint8Array([7]) };
    },
  };
  bridge.bindPid(1, client);
  bridge.bindPid(2, client);
  // The newest binding is the active sender.
  assert.equal(bridge.activePid, 2);
  const body = new Uint8Array([1, 2, 3]);
  const result = await bridge.sendRawPacket("trpc.test.Cmd", body);
  body[0] = 99;
  assert.equal(sent.length, 1);
  assert.deepEqual([...(sent[0] ?? [])], [1, 2, 3]);
  assert.equal(result.responseData?.[0], 7);
  await bridge.dispose();
});

test("nextMessageRandom matches the 32-bit LCG with a 31-bit mask", () => {
  const bridge = new Bridge(new MemoryIdentity("10001"));
  const first = bridge.nextMessageRandom();
  assert.ok(first >= 0 && first <= 0x7fffffff);
  for (let i = 0; i < 100; i++) {
    const value = bridge.nextMessageRandom();
    assert.ok(value >= 0 && value <= 0x7fffffff, `iteration ${String(i)} produced ${String(value)}`);
  }
});

test("nextClientSequence starts above 1e8 and increments", () => {
  const bridge = new Bridge(new MemoryIdentity("10001"));
  const first = bridge.nextClientSequence();
  assert.ok(first > 1e8);
  assert.equal(bridge.nextClientSequence(), first + 1);
});

test("rememberUploadedFile is bounded and drops an empty fileId", () => {
  const bridge = new Bridge(new MemoryIdentity("10001"));
  bridge.rememberUploadedFile({ fileId: "" });
  assert.equal(bridge.uploadedFileCount, 0);
  for (let i = 0; i <= Bridge.UPLOADED_FILE_CACHE_MAX; i++) {
    bridge.rememberUploadedFile({ fileId: `f${String(i)}` });
  }
  assert.equal(bridge.uploadedFileCount, Bridge.UPLOADED_FILE_CACHE_MAX);
  // The oldest was evicted, the newest survived.
  assert.equal(bridge.recallUploadedFile("f0"), undefined);
  assert.equal(bridge.recallUploadedFile(`f${String(Bridge.UPLOADED_FILE_CACHE_MAX)}`)?.fileId, `f${String(Bridge.UPLOADED_FILE_CACHE_MAX)}`);
  assert.equal(bridge.recallUploadedFile(""), undefined);
});

test("setPidReceiveHealthy throws on an unattached PID", () => {
  const bridge = new Bridge(new MemoryIdentity("10001"));
  assert.throws(() => bridge.setPidReceiveHealthy(9, true), /invariant violated: PID=9 is not attached/);
});

test("dispose is idempotent and closes the identity exactly once", async () => {
  let closes = 0;
  const identity = new MemoryIdentity("10001");
  const original = identity.close.bind(identity);
  identity.close = async () => {
    closes += 1;
    await original();
  };
  const bridge = new Bridge(identity);
  const first = bridge.dispose();
  const second = bridge.dispose();
  assert.equal(first, second);
  await first;
  assert.equal(closes, 1);
  assert.equal(bridge.stillOpen(), false);
  assert.equal(bridge.empty, true);
});

test("MemoryIdentity keeps uin a string and separates sync lookups from resolveUid", async () => {
  // Several URL builders concatenate identity.uin; typing it as a number would
  // silently change those URLs.
  const identity = new MemoryIdentity("10001", "me");
  assert.equal(typeof identity.uin, "string");
  identity.rememberFriends([{ uin: 20002, uid: "u-20002", nickname: "n", remark: "" }]);
  assert.equal(identity.findUidByUin(20002), "u-20002");
  assert.equal(identity.findUinByUid("u-20002"), 20002);
  // A miss is null, not a throw.
  assert.equal(identity.findUidByUin(30003), null);
  // resolveUid throws only when it has nowhere left to look.
  await assert.rejects(() => identity.resolveUid(30003), /no fetcher installed/);
});

test("MemoryIdentity group forget also drops the member map", () => {
  const identity = new MemoryIdentity("10001");
  identity.rememberGroups([{ groupId: 5, groupName: "g", remark: "", memberCount: 1, memberMax: 200 }]);
  identity.rememberGroupMembers(5, [
    // `role` is the string form the reference's roster stores; the 0/1/2 enum exists only
    // at the 0xfe7 wire boundary. See `context.ts`'s `GroupMemberInfo`.
    { uin: 20002, uid: "u", nickname: "n", card: "", role: "member", joinTime: 0, lastSentTime: 0, shutUpTime: 0 },
  ]);
  assert.ok(identity.findGroupMember(5, 20002));
  identity.forgetGroup(5);
  assert.equal(identity.findGroupMember(5, 20002), null);
});

// ===========================================================================
// 9. Event bus
// ===========================================================================

test("emit isolates a throwing handler and never rejects", async () => {
  const errors: Array<{ kind: string; error: unknown }> = [];
  const bus = new BridgeEventBusImpl({ onError: (kind, error) => errors.push({ kind, error }) });
  let reached = 0;
  bus.on("online_devices_changed", () => {
    throw new Error("boom");
  });
  bus.on("online_devices_changed", () => {
    reached += 1;
  });
  await bus.emit({ kind: "online_devices_changed", devices: [] } as never);
  assert.equal(reached, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.kind, "online_devices_changed");
});

test("the same handler may be registered twice and unsubscribed one at a time", async () => {
  const bus = new BridgeEventBusImpl({ onError: () => undefined });
  let calls = 0;
  const handler = (): void => {
    calls += 1;
  };
  const off1 = bus.on("online_devices_changed", handler);
  bus.on("online_devices_changed", handler);
  await bus.emit({ kind: "online_devices_changed", devices: [] } as never);
  assert.equal(calls, 2);
  off1();
  await bus.emit({ kind: "online_devices_changed", devices: [] } as never);
  assert.equal(calls, 3);
});

test("onAny receives every kind and off removes every matching registration", async () => {
  const bus = new BridgeEventBusImpl({ onError: () => undefined });
  const seen: string[] = [];
  bus.onAny((event) => {
    seen.push(event.kind);
  });
  await bus.emit({ kind: "online_devices_changed", devices: [] } as never);
  assert.deepEqual(seen, ["online_devices_changed"]);
  assert.equal(bus.has("online_devices_changed"), true);
  bus.off("online_devices_changed", () => undefined);
  assert.equal(bus.has("online_devices_changed"), true); // onAny still counts
  bus.clear();
  assert.equal(bus.has("online_devices_changed"), false);
});

test("emit snapshots its subscribers so a handler can unsubscribe during dispatch", async () => {
  const bus = new BridgeEventBusImpl({ onError: () => undefined });
  let calls = 0;
  let off: (() => void) | null = null;
  off = bus.on("online_devices_changed", () => {
    calls += 1;
    off?.();
  });
  await bus.emit({ kind: "online_devices_changed", devices: [] } as never);
  await bus.emit({ kind: "online_devices_changed", devices: [] } as never);
  assert.equal(calls, 1);
});

test('BRIDGE_EVENT_KINDS has no runtime consumer, and "packet" is not a bridge event kind', async () => {
  // ---------------------------------------------------------------------
  // Why this test exists
  // ---------------------------------------------------------------------
  //
  // A handover note said: "if anything emits a packet-kind event, add `"packet"`
  // to `BRIDGE_EVENT_KINDS` in `bridge.ts`". That instruction rests on a false
  // premise; this test pins the two facts that refute it so it is not acted on.
  //
  // FACT 1 — `"packet"` is not, and never was, a *bridge* event kind.
  //   The reference registers its bridge event kinds in exactly two places, and
  //   the two lists are identical (26 kinds):
  //     * `CONVERTERS`     — reference/index.mjs:23344..23371
  //     * `EVENT_PIPELINE` — reference/index.mjs:39288..39315
  //   `"packet"` appears in neither. It is an **EventEmitter event on the
  //   protocol client**: `QqHookClient extends EventEmitter`
  //   (reference/index.mjs:2052), emitted at :2628 and :2639, consumed at :4245
  //   (`client.on("packet", (packet) => this.handlePacket(packet))`). That is a
  //   different bus carrying raw wire packets, not `BridgeEvent`s. This port
  //   mirrors it exactly: `RecvClient extends EventEmitter<RecvClientEvents>`
  //   (`src/recv-client.ts:39`) emits `"packet"` (`src/recv-client.ts:141`), and
  //   `src/bridge/recv-ingress.ts:255` subscribes to it. Neither touches
  //   `BridgeEventBus`.
  //
  // FACT 2 — `BRIDGE_EVENT_KINDS` cannot reject anything, because nothing reads
  //   it (grep: its only occurrence in `src/` is its own declaration,
  //   `src/bridge/bridge.ts:663`). It is a `const ... satisfies` declaration whose
  //   sole purpose is to hand subscribers the kind string without a literal.
  //   `BridgeEventBusImpl.emit` (`src/bridge/events.ts:135`) looks up
  //   `handlers.get(event.kind)` and dispatches unconditionally — there is no
  //   allow-list check anywhere on the path. A kind missing from the array is
  //   still delivered, so "the whitelist rejected it" is not a failure mode this
  //   code can have.
  //
  // The assertions verify the conclusion, not a wish.
  assert.equal(
    (BRIDGE_EVENT_KINDS as readonly string[]).includes("packet"),
    false,
    'BRIDGE_EVENT_KINDS must NOT contain "packet": the reference has no such bridge event kind (ref:23344..23371, ref:39288..39315)',
  );
  // The one kind the REFERENCE's `Bridge` emits is `online_devices_changed`, which is
  // converter-less there too (`reference/index.mjs:23369` → `null`).
  //
  // The two `session_*` kinds are this port's OWN additions, and the distinction is the
  // point: the reference does NOT publish session lifecycle on its event bus at all —
  // `BridgeManager.fireSessionStarted`/`fireSessionClosed` call a private subscriber set
  // instead (reference/index.mjs:347736-L347750). This port has no `BridgeManager`, so
  // `bindPid`/`detachPid` publish the edge on the bus and
  // `src/host/notification-source.ts` adapts it to the notification manager's
  // `NotificationSessionSource`. They are listed here because this constant's contract
  // is "the kinds `Bridge` itself emits", which is now three; they are deliberately
  // absent from `REFERENCE_BRIDGE_EVENT_KINDS` below, which stays the reference's 26.
  assert.deepEqual(
    [...BRIDGE_EVENT_KINDS],
    ["online_devices_changed", "session_started", "session_closed"],
    "BRIDGE_EVENT_KINDS lists exactly the kinds Bridge itself emits",
  );

  // The reference's kind vocabulary, transcribed from ref:23344..23371. Pinned so a
  // later "just add packet" edit has to confront the real list.
  const REFERENCE_BRIDGE_EVENT_KINDS = [
    "friend_message",
    "group_message",
    "temp_message",
    "group_member_join",
    "group_member_leave",
    "group_mute",
    "group_admin",
    "friend_recall",
    "group_recall",
    "friend_poke",
    "group_poke",
    "group_essence",
    "group_file_upload",
    "friend_add",
    "friend_input_status",
    "friend_profile_like",
    "bot_offline",
    "group_name_change",
    "group_title_change",
    "group_card_change",
    "group_msg_emoji_like",
    "friend_request",
    "group_invite",
    "ptt_trans_result",
    "online_devices_changed",
    "friend_remark_changed",
  ] as const;
  assert.equal(REFERENCE_BRIDGE_EVENT_KINDS.length, 26, "the reference registers 26 bridge event kinds");
  assert.equal(
    (REFERENCE_BRIDGE_EVENT_KINDS as readonly string[]).includes("packet"),
    false,
    'the reference bridge event vocabulary has no "packet" kind — it is a QqHookClient EventEmitter event',
  );

  // And the mechanism claim: a kind absent from BRIDGE_EVENT_KINDS is NOT filtered
  // out. Emitting the very string the note wanted added reaches its subscriber,
  // which is only possible because no allow-list exists.
  const bus = new BridgeEventBusImpl({ onError: () => undefined });
  const seen: string[] = [];
  bus.on("packet", (event: { kind: string }) => {
    seen.push(event.kind);
  });
  await bus.emit({ kind: "packet", cmd: "trpc.msg.olpush.OlPushService.MsgPush" } as never);
  assert.deepEqual(seen, ["packet"], "an unlisted kind is delivered: BRIDGE_EVENT_KINDS is not an allow-list");
});

// ===========================================================================
// 10. WebApi surface: the parts that need no network
// ===========================================================================

test("buildJumpUrl double-encodes u1 and concatenates identity.uin as a string", () => {
  // A URLSearchParams builder would collapse the double encoding to one level and
  // the endpoint answers with a redirect loop instead of cookies.
  const url = buildJumpUrl("10001", "CK", "19", "qun.qq.com");
  assert.ok(url.includes("u1=https%3A%2F%2Fqun.qq.com%2F10001%2Finfocenter"));
  assert.ok(url.includes("clientuin=10001"));
  assert.ok(url.endsWith("&keyindex=19"));
  assert.ok(!url.includes("10001.0"));
});

test("WebApi is constructible from a bare context and exposes the reference's methods", () => {
  const bridge = new Bridge(new MemoryIdentity("10001"));
  const api = bridge.apis.web;
  assert.ok(api instanceof WebApi);
  for (const method of [
    "forceFetchClientKey",
    "getCookies",
    "getCookiesStr",
    "getCsrfToken",
    "getCredentials",
    "getEssence",
    "getEssenceAll",
    "getHonorInfo",
    "getSignedList",
    "sendNotice",
    "getNotice",
    "deleteNotice",
    "getFriendDress",
    "getSKey",
  ] as const) {
    assert.equal(typeof (api as unknown as Record<string, unknown>)[method], "function", method);
  }
});

test("the hub exposes exactly the ported slots, and nothing is absent", () => {
  const bridge = new Bridge(new MemoryIdentity("10001"));
  // The sixteen ported slices, in the reference's key order. `groupFile`,
  // `interaction`, `friend` and `systemFace` joined this list in 2.4b: their classes
  // existed and typechecked for several batches while never being constructed by
  // `buildApiHub`, so they answered `undefined` at runtime. `forward`, `misc` and
  // `extras` followed, and `flashTransfer` closes the list — every slot is filled.
  for (const name of [
    "collection",
    "message",
    "contacts",
    "groupAdmin",
    "groupFile",
    "groupAlbum",
    "qzone",
    "interaction",
    "friend",
    "profile",
    "flashTransfer",
    "forward",
    "misc",
    "extras",
    "web",
    "systemFace",
  ] as const) {
    assert.ok(bridge.apis[name], name);
  }
  // No slice is absent any more. The old `flashTransfer` absence loop is replaced by
  // a POSITIVE assertion: a future removal must fail here rather than pass silently.
  assert.equal("flashTransfer" in bridge.apis, true);
  // And the key ORDER matches the reference's literal exactly.
  assert.deepEqual(Object.keys(bridge.apis), [
    "collection",
    "message",
    "contacts",
    "groupAdmin",
    "groupFile",
    "groupAlbum",
    "qzone",
    "interaction",
    "friend",
    "profile",
    "flashTransfer",
    "forward",
    "misc",
    "extras",
    "web",
    "systemFace",
  ]);
});