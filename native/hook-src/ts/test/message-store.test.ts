// Tests for `ts/src/host/message-store.ts`, the in-memory message table.
//
// ===========================================================================
// What these tests do and do not prove
// ===========================================================================
//
// **Do prove:** insert/get/getMeta/getMedia/getRecord/delete semantics, the upsert rules
// (absent keeps, `null` clears), copy-on-read and copy-on-write isolation, LRU eviction
// under a bound, the recall-target projection fitting `recallGroup` / `recallPrivate`,
// and the authoritative-sequence gate.
//
// **Do NOT prove:** that any message was sent, delivered or recalled on QQ. Every row
// here is fabricated in the test. There is no packet, no container, no network and no
// persistence — `MessageStore` is in-memory only, and a passing run says nothing about
// the wire. See the source header.
//
// ===========================================================================
// Why recall expectations are asserted as OBJECT LITERALS
// ===========================================================================
//
// `getRecallMeta` exists to fit `MessageApi.recallGroup` / `recallPrivate` argument
// shapes, so the risk worth testing is that a field quietly changes name or goes
// missing — a mutation, not a formatting difference. `assert.deepEqual` against a literal
// pins every member including the extra ones, which a per-field `assert.equal` would not.
// The literals below are transcribed from the two signatures at
// `ts/src/bridge/apis/message.ts:841` and `:859`, so a divergence fails here rather than at
// the first real recall.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { StoredMessageMeta } from "../src/onebot/actions/context.js";
import {
  DEFAULT_MAX_ENTRIES,
  MessageStore,
  type MessageRecordInput,
  type StoredMessageMedia,
} from "../src/host/message-store.js";

// ===========================================================================
// Fixtures
// ===========================================================================

/** A plausible inbound group message event. Shape from the reference's own emit sites. */
function groupEvent(messageId: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    time: 1_700_000_000,
    self_id: 10000,
    post_type: "message",
    message_type: "group",
    sub_type: "normal",
    message_id: messageId,
    group_id: 20001,
    user_id: 30001,
    message: [{ type: "text", data: { text: "你好" } }],
    raw_message: "你好",
    font: 0,
    sender: { user_id: 30001, nickname: "peer", card: "", role: "member" },
    ...overrides,
  };
}

/** A group recall meta: server sequence is authoritative. */
function groupMeta(overrides: Partial<StoredMessageMeta> = {}): StoredMessageMeta {
  return {
    isGroup: true,
    targetId: 20001,
    sequence: 4242,
    sequenceAuthoritative: true,
    clientSequence: 0,
    random: 1_234_567,
    timestamp: 1_700_000_000,
    ...overrides,
  };
}

/** A c2c recall meta. Private messages need `clientSequence` and a real random. */
function privateMeta(overrides: Partial<StoredMessageMeta> = {}): StoredMessageMeta {
  return {
    isGroup: false,
    targetId: 30002,
    sequence: 777,
    sequenceAuthoritative: true,
    clientSequence: 100_000_001,
    random: 2_345_678,
    timestamp: 1_700_000_123,
    ...overrides,
  };
}

const imageMedia: StoredMessageMedia = {
  type: "image",
  fileId: "ABC123.image",
  md5Hex: "0123456789abcdef0123456789abcdef",
  width: 320,
  height: 240,
};

// ===========================================================================
// insert / get
// ===========================================================================

test("insert stores an event and get returns it", () => {
  const store = new MessageStore();
  const event = groupEvent(101);
  assert.equal(store.insert(101, { event }), true);
  assert.equal(store.size, 1);
  assert.deepEqual(store.get(101), event);
});

test("insert upserts: an event-only re-insert keeps the stored meta", () => {
  const store = new MessageStore();
  store.insert(102, { event: groupEvent(102), meta: groupMeta() });
  // Exactly what the self-sent echo path does: it re-writes the event and passes no meta.
  assert.equal(store.insert(102, { event: groupEvent(102, { raw_message: "edited" }) }), true);
  assert.equal(store.get(102)?.["raw_message"], "edited");
  assert.deepEqual(store.getMeta(102), groupMeta());
});

test("insert upserts: an absent member is kept, an explicit null clears it", () => {
  const store = new MessageStore();
  store.insert(103, { event: groupEvent(103), meta: groupMeta(), media: [imageMedia] });

  store.insert(103, { meta: privateMeta({ targetId: 103 }) });
  assert.equal(store.get(103)?.["message_id"], 103, "event kept");
  assert.deepEqual(store.getMedia(103), [imageMedia], "media kept");
  assert.equal(store.getMeta(103)?.isGroup, false, "meta replaced");

  store.insert(103, { media: null });
  assert.equal(store.getMedia(103), null, "explicit null clears media");
  assert.ok(store.get(103), "event still present after clearing media");
});

test("insert accepts negative ids and rejects zero with a false answer", () => {
  const store = new MessageStore();
  // Negative ids are real: PROGRESS.md records OneBot ids like -453391294.
  assert.equal(store.insert(-453_391_294, { event: groupEvent(-453_391_294) }), true);
  assert.ok(store.get(-453_391_294));

  // `isValidMessageId` refuses 0 (reference:41208), the same way `f.messageId()` does.
  assert.equal(store.insert(0, { event: groupEvent(0) }), false);
  assert.equal(store.has(0), false);

  // Non-integers are refused rather than stored under a fractional key.
  assert.equal(store.insert(1.5, { event: groupEvent(1) }), false);
  assert.equal(store.insert(Number.NaN, { event: groupEvent(1) }), false);
});

test("insert throws on an empty record and on a malformed meta", () => {
  const store = new MessageStore();
  assert.throws(() => store.insert(104, {}), {
    name: "TypeError",
    message: /at least one of event\/meta\/media/,
  });

  // A NaN sequence would otherwise become a recall packet for sequence 0.
  assert.throws(() => store.insert(105, { meta: groupMeta({ sequence: Number.NaN }) }), {
    name: "TypeError",
    message: /sequence must be an integer/,
  });
  // `isGroup` decides which recall is attempted, so a non-boolean is not coercion-safe.
  assert.throws(
    () => store.insert(106, { meta: { ...groupMeta(), isGroup: "yes" } as unknown as StoredMessageMeta }),
    { name: "TypeError", message: /isGroup must be a boolean/ },
  );
  assert.equal(store.size, 0, "nothing was stored by the throwing calls");
});

// ===========================================================================
// Copy isolation
// ===========================================================================

test("get returns a copy, so a caller mutating it cannot corrupt the store", () => {
  const store = new MessageStore();
  store.insert(107, { event: groupEvent(107), media: [imageMedia] });

  // This is precisely what `get_msg` does: it spread-copies the event, then
  // `refreshMessageMedia` rewrites segment URLs in place on the COPY.
  const first = store.get(107);
  assert.ok(first);
  const segments = first["message"];
  assert.ok(Array.isArray(segments));
  const segment = segments[0];
  assert.ok(segment !== null && typeof segment === "object");
  (segment as { data: Record<string, unknown> }).data["url"] = "https://example.invalid/refreshed";

  const second = store.get(107);
  const secondSegment = (second?.["message"] as Array<{ data: Record<string, unknown> }>)[0];
  assert.equal(secondSegment?.data["url"], undefined, "refresh did not leak into the store");
});

test("insert copies the caller's event, so later mutation by the caller is not stored", () => {
  const store = new MessageStore();
  const event = groupEvent(108);
  store.insert(108, { event });
  event["raw_message"] = "mutated after insert";
  assert.equal(store.get(108)?.["raw_message"], "你好");
});

test("getMeta and getMedia return copies", () => {
  const store = new MessageStore();
  store.insert(109, { meta: groupMeta(), media: [imageMedia] });

  const meta = store.getMeta(109);
  assert.ok(meta);
  meta.sequence = 999_999;
  assert.equal(store.getMeta(109)?.sequence, 4242);

  const media = store.getMedia(109);
  assert.ok(media);
  media[0] = { type: "record" };
  assert.deepEqual(store.getMedia(109), [imageMedia]);
});

// ===========================================================================
// getMeta / getRecallMeta — recall is by sequence
// ===========================================================================

test("getMeta answers null for unknown, evicted and meta-less rows", () => {
  const store = new MessageStore();
  assert.equal(store.getMeta(999), null, "unknown id");

  store.insert(110, { event: groupEvent(110) });
  assert.equal(store.getMeta(110), null, "event-only row carries no recall meta");
  assert.equal(store.get(110)?.["message_id"], 110, "but the event is still there");

  // An evicted row misses on every provider, which is the `100 message not found` state.
  const bounded = new MessageStore({ maxEntries: 1 });
  bounded.insert(110, { event: groupEvent(110) });
  bounded.insert(111, { meta: groupMeta() });
  assert.equal(bounded.has(110), false, "bound of 1: the second insert evicted the first row");
  assert.equal(bounded.getMeta(110), null, "evicted id");
  assert.equal(bounded.get(110), null, "evicted id");
});

test("getRecallMeta projects a group target that fits recallGroup(groupId, sequence)", () => {
  const store = new MessageStore();
  store.insert(112, { meta: groupMeta({ targetId: 391_122_026, sequence: 88_001 }) });

  // `recallGroup(groupId, sequence)` — those two arguments, and nothing else.
  assert.deepEqual(store.getRecallMeta(112), {
    kind: "group",
    groupId: 391_122_026,
    sequence: 88_001,
  });
});

test("getRecallMeta projects a private target that fits recallPrivate(userUin, clientSeq, msgSeq, random, timestamp)", () => {
  const store = new MessageStore();
  store.insert(113, {
    meta: privateMeta({ targetId: 30002, sequence: 777, clientSequence: 100_000_001, random: 2_345_678, timestamp: 1_700_000_123 }),
  });

  // All five arguments survive; a lost `clientSequence` or `timestamp` would make the
  // recall target nothing, which is the failure the reference comment warns about.
  assert.deepEqual(store.getRecallMeta(113), {
    kind: "private",
    userId: 30002,
    sequence: 777,
    clientSequence: 100_000_001,
    random: 2_345_678,
    timestamp: 1_700_000_123,
  });
});

test("getRecallMeta refuses a meta that is not authoritative", () => {
  // `hasAuthoritativeSequence` (message-id.ts:86) is the recall path's own precondition:
  // a non-authoritative sequence would be a request QQ must reject (message.ts:837).
  const cases: Array<[string, StoredMessageMeta]> = [
    ["flag false", groupMeta({ sequenceAuthoritative: false })],
    ["sequence zero", groupMeta({ sequence: 0 })],
    ["sequence negative", groupMeta({ sequence: -5 })],
  ];
  for (const [label, meta] of cases) {
    const store = new MessageStore();
    store.insert(114, { meta });
    assert.equal(store.getRecallMeta(114), null, label);
    assert.equal(store.isRetractable(114), false, `${label}: isRetractable agrees`);
    // `getMeta` still answers, because the row exists and the caller may want to inspect it.
    assert.ok(store.getMeta(114), `${label}: getMeta still reports the row`);
  }

  const authoritative = new MessageStore();
  authoritative.insert(115, { meta: groupMeta() });
  assert.equal(authoritative.isRetractable(115), true);
  assert.notEqual(authoritative.getRecallMeta(115), null);
});

test("getRecallMeta answers null for an unknown id, without throwing", () => {
  const store = new MessageStore();
  assert.equal(store.getRecallMeta(100_000), null);
  assert.equal(store.getRecallMeta(0), null);
  assert.equal(store.isRetractable(100_000), false);
});

// ===========================================================================
// getRecord / delete / has
// ===========================================================================

test("getRecord reports id, event, meta and media together as copies", () => {
  const store = new MessageStore();
  store.insert(116, { event: groupEvent(116), meta: groupMeta(), media: [imageMedia] });

  const record = store.getRecord(116);
  assert.ok(record);
  assert.equal(record.messageId, 116);
  assert.deepEqual(record.event, groupEvent(116));
  assert.deepEqual(record.meta, groupMeta());
  assert.deepEqual(record.media, [imageMedia]);

  assert.ok(record.meta);
  record.meta.sequence = 0;
  assert.equal(store.getMeta(116)?.sequence, 4242, "getRecord hands out copies too");

  assert.equal(store.getRecord(117), null);
});

test("delete drops one row and reports whether it existed", () => {
  const store = new MessageStore();
  store.insert(118, { event: groupEvent(118), meta: groupMeta() });

  assert.equal(store.has(118), true);
  assert.equal(store.delete(118), true);
  assert.equal(store.has(118), false);
  assert.equal(store.size, 0);
  // Everything the providers read now misses: this is the `100 message not found` state.
  assert.equal(store.get(118), null);
  assert.equal(store.getMeta(118), null);
  assert.equal(store.getRecallMeta(118), null);

  assert.equal(store.delete(118), false, "second delete is a no-op");
  assert.equal(store.delete(0), false, "invalid id is a no-op");
});

test("clear empties the store and resets the eviction counter", () => {
  const store = new MessageStore({ maxEntries: 1 });
  store.insert(119, { event: groupEvent(119) });
  store.insert(120, { event: groupEvent(120) });
  assert.equal(store.evictions, 1);

  store.clear();
  assert.equal(store.size, 0);
  assert.equal(store.evictions, 0);
  assert.equal(store.has(120), false);
});

// ===========================================================================
// updateMedia
// ===========================================================================

test("updateMedia replaces snapshots on an existing row", () => {
  const store = new MessageStore();
  store.insert(121, { event: groupEvent(121), media: [imageMedia] });

  const record: StoredMessageMedia = { type: "record", fileId: "XYZ.amr", duration: 3 };
  assert.equal(store.updateMedia(121, [record]), true);
  assert.deepEqual(store.getMedia(121), [record]);
  assert.equal(store.get(121)?.["message_id"], 121, "the event is untouched");

  assert.equal(store.updateMedia(121, null), true);
  assert.equal(store.getMedia(121), null);
});

test("updateMedia refuses to create a row for an unknown id", () => {
  const store = new MessageStore();
  assert.equal(store.updateMedia(122, [imageMedia]), false);
  assert.equal(store.has(122), false, "no row was invented");
  assert.equal(store.size, 0);
});

test("updateMedia stores a copy of the snapshots it is handed", () => {
  const store = new MessageStore();
  store.insert(123, { event: groupEvent(123) });
  const media: StoredMessageMedia[] = [{ type: "image", fileId: "A" }];
  store.updateMedia(123, media);
  media.push({ type: "image", fileId: "B" });
  assert.equal(store.getMedia(123)?.length, 1);
});

// ===========================================================================
// Eviction
// ===========================================================================

test("a bound of 1 keeps only the newest non-touched row", () => {
  const store = new MessageStore({ maxEntries: 1 });
  store.insert(124, { event: groupEvent(124) });
  store.insert(125, { event: groupEvent(125) });

  assert.equal(store.size, 1);
  assert.equal(store.has(124), false, "the oldest row was evicted");
  assert.equal(store.has(125), true);
  assert.equal(store.evictions, 1);
});

test("eviction is LRU, not FIFO: a read protects the row from the next insert", () => {
  // Baseline: with no reads, the least recently USED row is the oldest inserted one, so
  // the third insert evicts the FIRST row and leaves the other two.
  const store = new MessageStore({ maxEntries: 2 });
  store.insert(126, { event: groupEvent(126) });
  store.insert(127, { event: groupEvent(127) });
  store.insert(128, { event: groupEvent(128) });

  assert.equal(store.has(126), false, "126 is the LRU row");
  assert.equal(store.has(127), true);
  assert.equal(store.has(128), true);
  assert.equal(store.size, 2);
  assert.equal(store.evictions, 1);

  // Now the discriminating case: reading 126 moves it to the MRU end, so the SAME third
  // insert must drop 127 instead. A plain FIFO (or an insert-order timestamp) fails here.
  const store2 = new MessageStore({ maxEntries: 2 });
  store2.insert(126, { event: groupEvent(126) });
  store2.insert(127, { event: groupEvent(127) });
  assert.equal(store2.get(126)?.["message_id"], 126, "read 126, making 127 the LRU row");
  store2.insert(128, { event: groupEvent(128) });
  assert.equal(store2.has(126), true, "LRU keeps the read row");
  assert.equal(store2.has(127), false, "and drops the untouched one");
  assert.equal(store2.has(128), true);
  assert.equal(store2.evictions, 1);
});

test("getMeta and getMedia also count as a use for LRU purposes", () => {
  for (const read of ["getMeta", "getMedia", "getRecallMeta"] as const) {
    const store = new MessageStore({ maxEntries: 2 });
    store.insert(129, { event: groupEvent(129), meta: groupMeta(), media: [imageMedia] });
    store.insert(130, { event: groupEvent(130), meta: groupMeta(), media: [imageMedia] });
    if (read === "getMeta") store.getMeta(129);
    else if (read === "getMedia") store.getMedia(129);
    else store.getRecallMeta(129);
    store.insert(131, { event: groupEvent(131) });
    assert.equal(store.has(129), true, `${read} protected 129`);
    assert.equal(store.has(130), false, `${read}: 130 became the LRU row`);
  }
});

test("an upsert on an existing id refreshes its recency", () => {
  const store = new MessageStore({ maxEntries: 2 });
  store.insert(132, { event: groupEvent(132) });
  store.insert(133, { event: groupEvent(133) });
  store.insert(132, { meta: groupMeta() });
  store.insert(134, { event: groupEvent(134) });
  assert.equal(store.has(132), true);
  assert.equal(store.has(133), false);
  assert.equal(store.evictions, 1);
});

test("eviction drops up to the bound and counts every drop", () => {
  const store = new MessageStore({ maxEntries: 3 });
  for (let i = 0; i < 7; i += 1) store.insert(200 + i, { event: groupEvent(200 + i) });
  assert.equal(store.size, 3);
  assert.equal(store.evictions, 4);
  assert.deepEqual(
    [200, 201, 202, 203, 204, 205, 206].filter((id) => store.has(id)),
    [204, 205, 206],
    "only the three newest survive",
  );
});

test("the default bound is applied when no options are passed", () => {
  const store = new MessageStore();
  assert.equal(store.maxEntries, DEFAULT_MAX_ENTRIES);
  assert.ok(DEFAULT_MAX_ENTRIES > 0);
});

test("an invalid bound is rejected at construction", () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new MessageStore({ maxEntries: bad }), {
      name: "RangeError",
      message: /positive safe integer/,
    });
  }
});