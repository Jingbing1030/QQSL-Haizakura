// Tests for the QQ NT system-message dedup port (`bridge/sysmsg-dedup.ts`).
//
// ---------------------------------------------------------------------------
// NO CAPTURE VALIDATES THIS. Every case below is derived from the reference's
// disassembly notes, not from real QQ traffic.
// ---------------------------------------------------------------------------
// The module mirrors macOS QQ 6.9.98 `sys_msg_mgr.cc`: a static route table
// (`msgType`, `subType`) -> chatType, a peer selector (C2C `fromUid` vs group
// decimal `fromUin`), and a fixed-capacity ring keyed
// `{peerUid}_{chatType}_{sequence}_{random}`. These tests assert the port
// reproduces that behaviour exactly, route by route and early-return by
// early-return. They prove NOTHING about whether the table matches the real
// client: no packet was captured, no container, no production path. If the
// reference mis-transcribed a route, every test here passes anyway.
//
// The one case that is not a behaviour test is the structural check at the
// bottom: it pins `PushContext` (`msg-push.ts`) as assignable to the narrow
// context interface this module declares, at compile time and at run time, so
// the two cannot drift apart silently.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SysMsgDedup,
  deriveSysMsgDedupIdentity,
  getNativeSysMsgChatType,
  type SysMsgDedupContext,
  type SysMsgDedupIdentity,
} from "../src/bridge/sysmsg-dedup.js";
import { EMPTY_IDENTITY, type PushContext } from "../src/msg-push.js";

// ===========================================================================
// Fixtures
// ===========================================================================

/** Every route in the native table, with the chatType it must produce. */
const ROUTES: ReadonlyArray<{ msgType: number; subType: number; chatType: 1 | 2 }> = [
  // reference L154042: (528, 290) -> C2C
  { msgType: 528, subType: 290, chatType: 1 },
  // reference L154043: (166, 75|129|131|133|135) -> C2C
  { msgType: 166, subType: 75, chatType: 1 },
  { msgType: 166, subType: 129, chatType: 1 },
  { msgType: 166, subType: 131, chatType: 1 },
  { msgType: 166, subType: 133, chatType: 1 },
  { msgType: 166, subType: 135, chatType: 1 },
  // reference L154044: (167, 133) -> C2C
  { msgType: 167, subType: 133, chatType: 1 },
  // reference L154045: (732, 12|16|20) -> group
  { msgType: 732, subType: 12, chatType: 2 },
  { msgType: 732, subType: 16, chatType: 2 },
  { msgType: 732, subType: 20, chatType: 2 },
  // reference L154046: (33|34|85, 0) -> group
  { msgType: 33, subType: 0, chatType: 2 },
  { msgType: 34, subType: 0, chatType: 2 },
  { msgType: 85, subType: 0, chatType: 2 },
];

/** `(msgType, subType)` pairs that must NOT route, including near-misses. */
const NON_ROUTES: ReadonlyArray<{ msgType: number; subType: number; why: string }> = [
  { msgType: 528, subType: 0, why: "528 only routes on 290" },
  { msgType: 528, subType: 291, why: "528 only routes on 290" },
  { msgType: 166, subType: 0, why: "166 routes only on the five listed subTypes" },
  { msgType: 166, subType: 130, why: "130 sits inside the 129..135 range but is not listed" },
  { msgType: 166, subType: 134, why: "134 sits inside the 129..135 range but is not listed" },
  { msgType: 166, subType: 138, why: "friend recall is not a deduped system route" },
  { msgType: 166, subType: 290, why: "290 belongs to 528, not to 166" },
  { msgType: 167, subType: 0, why: "167 routes only on 133" },
  { msgType: 167, subType: 75, why: "75 belongs to 166, not to 167" },
  { msgType: 732, subType: 0, why: "732 routes only on 12/16/20" },
  { msgType: 732, subType: 11, why: "732 routes only on 12/16/20" },
  { msgType: 732, subType: 21, why: "732 routes only on 12/16/20" },
  { msgType: 33, subType: 1, why: "33/34/85 route only on subType 0" },
  { msgType: 34, subType: 12, why: "33/34/85 route only on subType 0" },
  { msgType: 85, subType: 20, why: "33/34/85 route only on subType 0" },
  { msgType: 82, subType: 0, why: "ordinary group message is not a system route" },
  { msgType: 141, subType: 0, why: "group-temp message is not a system route" },
  { msgType: 0, subType: 0, why: "an unset head routes nowhere" },
];

function head(msgType: number, subType: number, sequence = 1001, msgId = 2002) {
  return { msgType, subType, sequence, msgId };
}

function context(msgType: number, subType: number, fromUid: string, fromUin: number, sequence = 1001, msgId = 2002): SysMsgDedupContext {
  return { head: head(msgType, subType, sequence, msgId), fromUid, fromUin };
}

function identity(overrides: Partial<SysMsgDedupIdentity> = {}): SysMsgDedupIdentity {
  return { peerUid: "u_peer", chatType: 1, sequence: 1001, random: 2002, ...overrides };
}

// ===========================================================================
// getNativeSysMsgChatType — the static route table
// ===========================================================================

test("route table: every listed (msgType, subType) maps to its native chatType", () => {
  for (const route of ROUTES) {
    assert.equal(
      getNativeSysMsgChatType(route.msgType, route.subType),
      route.chatType,
      `(${route.msgType}, ${route.subType}) must be chatType ${route.chatType}`,
    );
  }
});

test("route table: nothing else routes, so unrelated events fail open", () => {
  for (const route of NON_ROUTES) {
    assert.equal(
      getNativeSysMsgChatType(route.msgType, route.subType),
      null,
      `(${route.msgType}, ${route.subType}) must not route: ${route.why}`,
    );
  }
});

test("route table: routes are exactly the listed pairs, across a broad grid", () => {
  // Enumerating a grid of plausible (msgType, subType) pairs and requiring
  // "routes iff listed" catches both directions of drift: a row quietly widened
  // (extra subTypes route) and a row quietly narrowed (a listed subType stops
  // routing). It says nothing about whether the table matches the real client —
  // see the file header.
  const msgTypes = [0, 33, 34, 82, 85, 141, 166, 167, 528, 732, 999];
  const subTypes = [0, 11, 12, 16, 20, 21, 75, 129, 130, 131, 133, 134, 135, 138, 290, 291];

  for (const msgType of msgTypes) {
    for (const subType of subTypes) {
      const listed = ROUTES.find((r) => r.msgType === msgType && r.subType === subType);
      assert.equal(
        getNativeSysMsgChatType(msgType, subType),
        listed?.chatType ?? null,
        `(${msgType}, ${subType}) must ${listed ? "" : "not "}route`,
      );
    }
  }

  // No duplicate rows: a repeated pair would hide a contradictory chatType.
  const pairs = ROUTES.map((r) => `${r.msgType}_${r.subType}`);
  assert.equal(new Set(pairs).size, pairs.length, "every (msgType, subType) pair is listed once");
});

// ===========================================================================
// deriveSysMsgDedupIdentity — peer selection per chatType
// ===========================================================================

test("derive: C2C routes key on fromUid, group routes on String(fromUin)", () => {
  for (const route of ROUTES) {
    // Distinct values so a wrong selector cannot accidentally pass.
    const ctx = context(route.msgType, route.subType, "u_abcdef", 12345);
    const derived = deriveSysMsgDedupIdentity(ctx);
    assert.notEqual(derived, null, `(${route.msgType}, ${route.subType}) must derive an identity`);
    assert.equal(derived!.chatType, route.chatType);
    assert.equal(derived!.sequence, 1001, "sequence is content-head field 5");
    assert.equal(derived!.random, 2002, "random is content-head field 4 / msgId");
    if (route.chatType === 1) {
      assert.equal(derived!.peerUid, "u_abcdef", "C2C peer is fromUid");
    } else {
      assert.equal(derived!.peerUid, "12345", "group peer is the decimal fromUin");
      assert.equal(typeof derived!.peerUid, "string");
    }
  }
});

test("derive: group peer is the decimal form of fromUin, not the uid", () => {
  // fromUid is deliberately a value that would sort differently as a string, so a
  // port that keyed groups on fromUid would produce "u_group" here.
  const derived = deriveSysMsgDedupIdentity(context(732, 12, "u_group", 987654321));
  assert.deepEqual(derived, { peerUid: "987654321", chatType: 2, sequence: 1001, random: 2002 });
});

test("derive: C2C peer ignores fromUin entirely", () => {
  const a = deriveSysMsgDedupIdentity(context(528, 290, "u_same", 111));
  const b = deriveSysMsgDedupIdentity(context(528, 290, "u_same", 222));
  assert.deepEqual(a, b, "C2C identity must not depend on fromUin");
});

test("derive: an unrouted (msgType, subType) returns null", () => {
  for (const route of NON_ROUTES) {
    assert.equal(
      deriveSysMsgDedupIdentity(context(route.msgType, route.subType, "u_peer", 12345)),
      null,
      `(${route.msgType}, ${route.subType}) must not be dedupable: ${route.why}`,
    );
  }
});

test("derive: zero sequence returns null", () => {
  for (const route of ROUTES) {
    assert.equal(
      deriveSysMsgDedupIdentity(context(route.msgType, route.subType, "u_peer", 12345, 0, 2002)),
      null,
      `(${route.msgType}, ${route.subType}) with sequence 0 must be unkeyable`,
    );
  }
});

test("derive: zero msgId (random) returns null", () => {
  for (const route of ROUTES) {
    assert.equal(
      deriveSysMsgDedupIdentity(context(route.msgType, route.subType, "u_peer", 12345, 1001, 0)),
      null,
      `(${route.msgType}, ${route.subType}) with msgId 0 must be unkeyable`,
    );
  }
});

test("derive: a group event with fromUin 0 returns null", () => {
  // String(0) is the truthy string "0", so the falsy peer check alone would let
  // this through; the explicit chatType===2 && fromUin===0 guard is what stops
  // every fromUin-0 group event collapsing into one dedup entry.
  for (const route of ROUTES.filter((r) => r.chatType === 2)) {
    assert.equal(
      deriveSysMsgDedupIdentity(context(route.msgType, route.subType, "u_group", 0)),
      null,
      `group route (${route.msgType}, ${route.subType}) with fromUin 0 must be unkeyable`,
    );
  }
});

test("derive: a C2C event with a blank fromUid returns null", () => {
  for (const route of ROUTES.filter((r) => r.chatType === 1)) {
    assert.equal(
      deriveSysMsgDedupIdentity(context(route.msgType, route.subType, "", 12345)),
      null,
      `C2C route (${route.msgType}, ${route.subType}) with a blank fromUid must be unkeyable`,
    );
  }
});

// ===========================================================================
// SysMsgDedup — the ring buffer
// ===========================================================================

test("dedup: the second identical identity is a duplicate, the first is not", () => {
  const dedup = new SysMsgDedup();
  const id = identity();
  assert.equal(dedup.seenDuplicate(id), false, "first sighting is not a duplicate");
  assert.equal(dedup.seenDuplicate(id), true, "second sighting is a duplicate");
  assert.equal(dedup.seenDuplicate(id), true, "and stays one");
});

test("dedup: capacity defaults to 1024", () => {
  assert.equal(new SysMsgDedup().capacity, 1024);
});

test("dedup: every component of the key separates identities", () => {
  const dedup = new SysMsgDedup();
  const base = identity();
  assert.equal(dedup.seenDuplicate(base), false);
  // Each of these differs in exactly one key component, so none may dedup against
  // `base`: a port that formatted the key with a missing or extra component
  // collapses at least one of them.
  assert.equal(dedup.seenDuplicate(identity({ peerUid: "u_other" })), false, "peerUid is part of the key");
  assert.equal(dedup.seenDuplicate(identity({ chatType: 2 })), false, "chatType is part of the key");
  assert.equal(dedup.seenDuplicate(identity({ sequence: 1002 })), false, "sequence is part of the key");
  assert.equal(dedup.seenDuplicate(identity({ random: 2003 })), false, "random is part of the key");
});

test("dedup: capacity 3, insert 4 — the oldest no longer dedups", () => {
  const dedup = new SysMsgDedup(3);
  const first = identity({ sequence: 1 });
  const second = identity({ sequence: 2 });
  const third = identity({ sequence: 3 });
  const fourth = identity({ sequence: 4 });

  assert.equal(dedup.seenDuplicate(first), false);
  assert.equal(dedup.seenDuplicate(second), false);
  assert.equal(dedup.seenDuplicate(third), false);
  assert.equal(dedup.seenDuplicate(fourth), false, "the fourth insert evicts the first");

  assert.equal(dedup.seenDuplicate(first), false, "the evicted oldest is no longer remembered");
  // Re-inserting `first` now evicted `second`, which is the ring's own order.
  assert.equal(dedup.seenDuplicate(second), false, "eviction follows insertion order, not recency of a hit");
  assert.equal(dedup.seenDuplicate(fourth), true, "the most recent entry is still remembered");
});

test("dedup: a duplicate hit does not advance the cursor", () => {
  const dedup = new SysMsgDedup(2);
  const a = identity({ sequence: 1 });
  const b = identity({ sequence: 2 });
  const c = identity({ sequence: 3 });

  assert.equal(dedup.seenDuplicate(a), false, "a takes slot 0");
  assert.equal(dedup.seenDuplicate(b), false, "b takes slot 1, cursor wraps to 0");
  assert.equal(dedup.seenDuplicate(a), true, "a repeat must not consume a slot");
  assert.equal(dedup.seenDuplicate(a), true, "and repeated hits still do not move the cursor");
  assert.equal(dedup.seenDuplicate(a), true, "so slot 0 still holds a, not a clone of a");

  assert.equal(dedup.seenDuplicate(c), false, "c evicts slot 0, which is a");
  assert.equal(dedup.seenDuplicate(b), true, "b was untouched throughout: it sat in slot 1 the whole time");
  assert.equal(dedup.seenDuplicate(a), false, "a was evicted despite the three earlier hits, so recency of a hit buys nothing");
});

test("dedup: zero fields never dedup and never consume a slot", () => {
  const dedup = new SysMsgDedup(2);
  const zeroSequence = identity({ sequence: 0 });
  const zeroRandom = identity({ random: 0 });
  const emptyPeer = identity({ peerUid: "" });

  for (const id of [zeroSequence, zeroRandom, emptyPeer]) {
    assert.equal(dedup.seenDuplicate(id), false, "a zero field fails open");
    assert.equal(dedup.seenDuplicate(id), false, "and keeps failing open, never becoming a duplicate");
  }

  // Nothing above took a slot: with capacity 2 the ring still holds two live keys.
  const a = identity({ sequence: 11 });
  const b = identity({ sequence: 12 });
  assert.equal(dedup.seenDuplicate(a), false);
  assert.equal(dedup.seenDuplicate(b), false);
  assert.equal(dedup.seenDuplicate(a), true, "zero-field calls did not evict a");
  assert.equal(dedup.seenDuplicate(b), true, "zero-field calls did not evict b");
});

test("dedup: capacity 1 remembers exactly one identity", () => {
  const dedup = new SysMsgDedup(1);
  const a = identity({ sequence: 1 });
  const b = identity({ sequence: 2 });
  assert.equal(dedup.seenDuplicate(a), false, "a takes the only slot");
  assert.equal(dedup.seenDuplicate(a), true, "and dedups against itself");
  assert.equal(dedup.seenDuplicate(b), false, "b evicts a");
  assert.equal(dedup.seenDuplicate(a), false, "a is gone — a single slot cannot hold two keys");
  assert.equal(dedup.seenDuplicate(b), false, "and that last call evicted b in turn");

  // A capacity-1 ring still dedups a strictly alternating sequence only when no
  // third identity intervenes, which is exactly one slot's worth of memory.
  const alternating = new SysMsgDedup(1);
  assert.equal(alternating.seenDuplicate(a), false);
  assert.equal(alternating.seenDuplicate(a), true);
  assert.equal(alternating.seenDuplicate(a), true);
});

test("dedup: distinct peers never collide across the derived key", () => {
  // End-to-end through the derivation: a C2C peer whose uid is "12345" and a group
  // peer whose uin is 12345 are different chatTypes, so they must not collide.
  const dedup = new SysMsgDedup();
  const c2c = deriveSysMsgDedupIdentity(context(528, 290, "12345", 0, 777, 888));
  const group = deriveSysMsgDedupIdentity(context(732, 12, "u_ignored", 12345, 777, 888));
  assert.notEqual(c2c, null);
  assert.notEqual(group, null);
  assert.equal(dedup.seenDuplicate(c2c!), false);
  assert.equal(dedup.seenDuplicate(group!), false, "same peer string and numbers, different chatType");
  assert.equal(dedup.seenDuplicate(c2c!), true);
  assert.equal(dedup.seenDuplicate(group!), true);
});

test("dedup: null identities are the caller's problem, not silently deduped", () => {
  // `deriveSysMsgDedupIdentity` returning null is the "fail open" signal. This
  // asserts the module gives the caller something it can branch on rather than a
  // zero-valued identity that would key every unrouted event together.
  assert.equal(deriveSysMsgDedupIdentity(context(166, 130, "u_peer", 12345)), null);
});

// ===========================================================================
// Structural compatibility with `PushContext` (msg-push.ts)
// ===========================================================================

// Compile-time: `PushContext` must satisfy the narrow interface this module
// declares. If either side drifts — a field renamed, a type widened — this line
// stops compiling, which is the whole point of declaring the local interface
// instead of importing `PushContext`.
type AssertAssignable<Constraint, T extends Constraint> = T;
type _PushContextIsSysMsgDedupContext = AssertAssignable<SysMsgDedupContext, PushContext>;

test("integration: a real PushContext from msg-push.ts satisfies SysMsgDedupContext", () => {
  // Same assertion at run time, through an actual PushContext-shaped object: the
  // compiler is happy AND the derived identity is correct for a live-shaped head.
  const ctx: PushContext = {
    head: {
      msgType: 732,
      subType: 16,
      c2cCmd: 0,
      sequence: 4242,
      ntMsgSeq: 4242,
      timestamp: 1700000000,
      msgId: 9001,
    },
    fromUin: 55555,
    fromUid: "u_group_peer",
    selfUin: 10001,
    content: new Uint8Array(0),
    body: undefined,
    responseHead: undefined,
    identity: EMPTY_IDENTITY,
    isHistorical: false,
  };

  const derived = deriveSysMsgDedupIdentity(ctx);
  assert.deepEqual(derived, { peerUid: "55555", chatType: 2, sequence: 4242, random: 9001 });

  const dedup = new SysMsgDedup();
  assert.equal(dedup.seenDuplicate(derived!), false);
  assert.equal(dedup.seenDuplicate(deriveSysMsgDedupIdentity(ctx)!), true, "the same push seen twice is a duplicate");
});