// Reaction cache — the four-part key, the upsert, and the clamp bounds.
//
// Every case here corresponds to a way the cache can lie. A cache that returns a stale or
// merged answer is worse than no cache, because `fetchEmojiLikeSummary` prefers the larger of
// local and remote: an inflated local count gets reported as truth and never corrected.
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { ReactionStore, emojiTypeFor } from "../src/host/reaction-store.js";

describe("ReactionStore: the composite key", () => {
  test("the same sequence in two groups is two separate reactions", () => {
    // QQ's sequence is per-group. Keying on `(seq, emoji)` alone would merge two unrelated
    // messages that happen to share a sequence — which is common, because sequences are dense.
    const store = new ReactionStore();
    store.recordAdd(111, 42, "14", 1, 1000, "", 100);
    store.recordAdd(222, 42, "14", 1, 1000, "", 100);
    assert.equal(store.countUsers(111, 42, "14"), 1);
    assert.equal(store.countUsers(222, 42, "14"), 1);
    assert.equal(store.size, 2);
  });

  test("the same emoji on two sequences in one group is two reactions", () => {
    const store = new ReactionStore();
    store.recordAdd(111, 42, "14", 1, 1000, "", 100);
    store.recordAdd(111, 43, "14", 1, 1000, "", 100);
    assert.equal(store.size, 2);
  });

  test("two emoji on one message are independent", () => {
    const store = new ReactionStore();
    store.recordAdd(111, 42, "14", 1, 1000, "", 100);
    store.recordAdd(111, 42, "128512", 1, 1000, "", 100);
    assert.equal(store.countUsers(111, 42, "14"), 1);
    assert.equal(store.countUsers(111, 42, "128512"), 1);
  });

  test("an emoji id containing a colon does not corrupt the summary", () => {
    // Custom-face ids are server-assigned strings with an unpredictable alphabet. Slicing by a
    // fixed offset instead of splitting would truncate one.
    const store = new ReactionStore();
    store.recordAdd(1, 2, "a:b:c", 2, 1000, "", 100);
    const summary = store.summarizeMessage(1, 2);
    assert.equal(summary.length, 1);
    assert.equal(summary[0]!.emojiId, "a:b:c");
  });
});

describe("ReactionStore: upsert semantics", () => {
  test("re-adding the same reaction updates instead of duplicating", () => {
    // The reference's `ON CONFLICT ... DO UPDATE` (index.mjs:342605-342611). A plain insert
    // would make `countUsers` report two reactors where there is one.
    const store = new ReactionStore();
    store.recordAdd(1, 2, "14", 1, 1000, "", 100);
    store.recordAdd(1, 2, "14", 1, 1000, "", 200);
    assert.equal(store.countUsers(1, 2, "14"), 1);
    const users = store.listUsers(1, 2, "14");
    assert.equal(users[0]!.setAt, 200, "the newer timestamp wins");
  });
});

describe("ReactionStore: guards", () => {
  test("a missing key part is refused silently, not thrown", () => {
    // The reference guard is `if (!groupId || !msgSeq || !emojiId || !operatorUin) return;`.
    // Throwing would turn a bookkeeping miss into a failed send, mid-action.
    const store = new ReactionStore();
    const cases: Array<[number, number, string, number, number]> = [
      [0, 2, "14", 1, 1000],
      [1, 0, "14", 1, 1000],
      [1, 2, "", 1, 1000],
      [1, 2, "14", 1, 0],
    ];
    for (const [groupId, msgSeq, emojiId, emojiType, operatorUin] of cases) {
      assert.doesNotThrow(() =>
        store.recordAdd(groupId, msgSeq, emojiId, emojiType, operatorUin, "", 100),
      );
    }
    assert.equal(store.size, 0);
  });

  test("removing a reaction that was never recorded is a no-op", () => {
    const store = new ReactionStore();
    assert.doesNotThrow(() => store.recordRemove(1, 2, "14", 1000));
    assert.equal(store.size, 0);
  });

  test("removing the last reactor drops the emoji from the summary", () => {
    // An empty map left behind would make `summarizeMessage` emit a zero-count entry for an
    // emoji nobody has — and `fetchEmojiLikeSummary` would forward `count: 0` to the client.
    const store = new ReactionStore();
    store.recordAdd(1, 2, "14", 1, 1000, "", 100);
    store.recordRemove(1, 2, "14", 1000);
    assert.deepEqual(store.summarizeMessage(1, 2), []);
  });

  test("removing one of two reactors keeps the other", () => {
    const store = new ReactionStore();
    store.recordAdd(1, 2, "14", 1, 1000, "", 100);
    store.recordAdd(1, 2, "14", 1, 2000, "", 100);
    store.recordRemove(1, 2, "14", 1000);
    assert.equal(store.countUsers(1, 2, "14"), 1);
    assert.equal(store.listUsers(1, 2, "14")[0]!.operatorUin, 2000);
  });
});

describe("ReactionStore: pagination", () => {
  test("oldest first", () => {
    // `ORDER BY set_at ASC` — the first reactor is the first row.
    const store = new ReactionStore();
    store.recordAdd(1, 2, "14", 1, 3000, "", 300);
    store.recordAdd(1, 2, "14", 1, 1000, "", 100);
    store.recordAdd(1, 2, "14", 1, 2000, "", 200);
    assert.deepEqual(
      store.listUsers(1, 2, "14").map((r) => r.operatorUin),
      [1000, 2000, 3000],
    );
  });

  test("limit clamps to 1..500 and offset floors at 0", () => {
    const store = new ReactionStore();
    for (let uin = 1; uin <= 5; uin += 1) store.recordAdd(1, 2, "14", 1, uin, "", uin);
    assert.equal(store.listUsers(1, 2, "14", 0).length, 1, "limit 0 becomes 1");
    assert.equal(store.listUsers(1, 2, "14", -5).length, 1, "a negative limit becomes 1");
    assert.equal(store.listUsers(1, 2, "14", 100_000).length, 5, "an over-limit is capped at what exists");
    assert.equal(store.listUsers(1, 2, "14", 2, -3).length, 2, "a negative offset floors at 0");
    assert.deepEqual(
      store.listUsers(1, 2, "14", 2, 1).map((r) => r.operatorUin),
      [2, 3],
    );
  });
});

describe("ReactionStore: summarizeMessage", () => {
  test("groups by emoji with a per-emoji count and newest time", () => {
    const store = new ReactionStore();
    store.recordAdd(1, 2, "14", 1, 1000, "", 100);
    store.recordAdd(1, 2, "14", 1, 2000, "", 250);
    store.recordAdd(1, 2, "128512", 1, 1000, "", 400);
    const summary = store.summarizeMessage(1, 2);
    assert.equal(summary.length, 2);
    const fourteen = summary.find((e) => e.emojiId === "14")!;
    assert.equal(fourteen.count, 2);
    assert.equal(fourteen.lastSetAt, 250, "MAX(set_at), not the first");
  });

  test("ignores other messages and other groups", () => {
    const store = new ReactionStore();
    store.recordAdd(1, 2, "14", 1, 1000, "", 100);
    store.recordAdd(1, 3, "14", 1, 1000, "", 100);
    store.recordAdd(2, 2, "14", 1, 1000, "", 100);
    assert.equal(store.summarizeMessage(1, 2).length, 1);
  });

  test("an unknown message summarizes to nothing", () => {
    const store = new ReactionStore();
    assert.deepEqual(store.summarizeMessage(9, 9), []);
  });
});

describe("emojiTypeFor", () => {
  test("three characters or fewer is a system face, longer is a custom face", () => {
    // `emojiId.length > 3 ? 2 : 1` (index.mjs:40077). Backwards, the server rejects the call.
    assert.equal(emojiTypeFor("14"), 1);
    assert.equal(emojiTypeFor("128"), 1);
    assert.equal(emojiTypeFor("128512"), 2);
    assert.equal(emojiTypeFor("abcdef"), 2);
  });

  test("the boundary is exactly four characters", () => {
    assert.equal(emojiTypeFor("123"), 1);
    assert.equal(emojiTypeFor("1234"), 2);
  });
});
