// `GroupInviteTracker` — the invitation CARD ↔ NOTICE pairer.
//
// Reference region: `../protocol/src/group-invite-tracker.ts`
// (reference/index.mjs:46986-47055, ~70 lines).
//
// ---------------------------------------------------------------------------
// Why this file stubs the clock instead of sleeping
// ---------------------------------------------------------------------------
// `PAIR_WINDOW_MS` is 3 s, and the ONLY thing time does here is expire an unpaired
// arrival. A test that slept would take 3 s per case to prove a `>` comparison; the
// constructor takes the clock (`now`), so each case drives it directly. The reference
// reads `Date.now` inline and its own tests stub the global — same coverage, and the
// injection is why this class is a separate module rather than a corner of
// `contacts.ts`.
//
// ---------------------------------------------------------------------------
// What these tests are actually pinning
// ---------------------------------------------------------------------------
// Every case below is one of the reference's SURPRISING branches — the ones a
// reimplementation gets wrong by making them "more sensible":
//
//   * `receiveCard` returns `!paired`, not `paired`;
//   * a card with NO uid never enters `unpaired` at all (there is no key to pair on);
//   * `receiveNotice` does NOT write `notices` when it pairs;
//   * expiry is evaluated only on the next arrival, never by a timer, and the boundary
//     is `expiresAt > now` — so an entry is gone AT its deadline, not after it;
//   * `getCardSequence` answers the LAST match (newest), not the first;
//   * a bare-sequence lookup with several groups THROWS rather than picking;
//   * two notices for one group/uid mark `ambiguous` and the getter THROWS.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GroupInviteTracker,
  MAX_INVITES,
  PAIR_WINDOW_MS,
} from "../src/bridge/apis/group-invite-tracker.js";

/** A tracker over a clock the test advances by hand. */
function makeTracker(): { tracker: GroupInviteTracker; advance: (ms: number) => void } {
  let now = 1_000_000;
  return {
    tracker: new GroupInviteTracker(() => now),
    advance: (ms) => {
      now += ms;
    },
  };
}

const GROUP_A = 111;
const GROUP_B = 222;
const UID = "u_10001";

describe("GroupInviteTracker — the two arrival orders", () => {
  it("a card with NO uid is unpaired and never enters `unpaired`", () => {
    // ⚠️ The uid argument is the SENDER's uid, and a card push may omit it. When it is
    // absent `pair` is never called at all (`uid ? this.pair(...) : void 0`), so the
    // card is unpaired by definition — `true`, dispatch it — AND it leaves no entry
    // behind. A version that enqueued it would hold an unclaimable slot for 3 s: the
    // key space is `groupId:uid`, and this card has no uid to be looked up by.
    const { tracker } = makeTracker();

    assert.equal(tracker.receiveCard(GROUP_A, 100, undefined), true);
    assert.equal(tracker.unpaired.length, 0, "no uid ⇒ no pair key ⇒ nothing enqueued");
    // The card IS indexed, because the sequence is what it is looked up by later.
    assert.equal(tracker.getCardSequence(GROUP_A), 100);

    // The notice therefore cannot pair with it — different key space — and is stored.
    assert.equal(tracker.receiveNotice(GROUP_A, UID), true);
    assert.equal(tracker.unpaired.length, 1);
    assert.deepEqual(tracker.getSelfInviteNotice(GROUP_A, UID), {}, "stored, with no cardSequence");
  });

  it("notice-then-card pairs: the card returns false and back-fills cardSequence", () => {
    // The order QQ actually delivers: the group-system notice first (it carries the
    // inviter uid), the card second (it carries the sequence and the sender uid).
    const { tracker } = makeTracker();

    assert.equal(tracker.receiveNotice(GROUP_A, UID), true, "first arrival is unpaired");
    // `false` — NOT `true`. The card found a partner, so the NOTICE's dispatch carries
    // it; dispatching the card as well would approve the same invitation twice.
    assert.equal(tracker.receiveCard(GROUP_A, 100, UID), false);

    const notice = tracker.getSelfInviteNotice(GROUP_A, UID);
    assert.equal(notice?.cardSequence, 100, "the notice is the handle the approval action needs");
    assert.equal(tracker.unpaired.length, 0, "the pair consumed both entries");
  });

  it("card-then-notice leaves no notice behind — the asymmetry the reference ships", () => {
    // ⚠️ NOT a bug being tolerated, and not a bug being fixed: `receiveNotice` pairs
    // against a CARD, so the `notice` object it allocated is discarded (a card has no
    // notice to back-fill). The observable consequence is that
    // `getSelfInviteNotice` answers `undefined` for a card-then-notice pair, so
    // `cardSequence` is only ever populated notice-then-card.
    //
    // This is asserted rather than repaired because repairing it would mean the notice
    // path stores a notice the card is SUPPOSED to have already dispatched, and the
    // reference's `emitGroupInviteCard`/`dispatchGroupInvite` pair (reference:347041,
    // :347126) relies on the current behaviour to avoid double dispatch.
    const { tracker } = makeTracker();

    assert.equal(tracker.receiveCard(GROUP_A, 100, UID), true);
    assert.equal(tracker.receiveNotice(GROUP_A, UID), false, "paired, so it must not dispatch");
    assert.equal(tracker.getSelfInviteNotice(GROUP_A, UID), undefined, "no notice was written");
    assert.equal(tracker.unpaired.length, 0);
  });
});

describe("GroupInviteTracker — dedupe and ambiguity", () => {
  it("a repeated card for the same group/sequence is not a new invitation", () => {
    // The server re-sends an undelivered card on reconnect. The second copy is the
    // SAME approval, so it must answer `false` (do not dispatch) — and it must not
    // enqueue a second arrival either.
    const { tracker } = makeTracker();

    assert.equal(tracker.receiveCard(GROUP_A, 100), true);
    assert.equal(tracker.receiveCard(GROUP_A, 100), false);
    assert.equal(tracker.getCardSequence(GROUP_A), 100);
    assert.equal(tracker.unpaired.length, 0, "the duplicate must not enqueue a second arrival");
  });

  it("two notices for one group/uid mark the notice ambiguous, and the getter THROWS", () => {
    // Two live self-invitations sharing a group/uid is a flag that cannot be resolved:
    // approving "the" notice would approve one the operator may not have meant. The
    // reference throws rather than picking, and so does this.
    //
    // ⚠️ The flag is set on the SECOND notice only — the one that can see a sibling
    // already waiting. The first never learns it was ambiguous, and it is the second
    // that `remember` stores, so the getter sees the flag.
    const { tracker } = makeTracker();

    assert.equal(tracker.receiveNotice(GROUP_A, UID), true);
    assert.equal(tracker.receiveNotice(GROUP_A, UID), true, "a second notice is still a new arrival");
    assert.throws(
      () => tracker.getSelfInviteNotice(GROUP_A, UID),
      /multiple pending self invitations share this flag/,
    );
  });

  it("the ambiguity flag is per group/uid, not global", () => {
    // A guard that threw for every notice once ANY pair was ambiguous would make one
    // bad invitation disable the whole inbox.
    const { tracker } = makeTracker();

    tracker.receiveNotice(GROUP_A, UID);
    tracker.receiveNotice(GROUP_A, UID);
    tracker.receiveNotice(GROUP_B, UID);

    assert.throws(() => tracker.getSelfInviteNotice(GROUP_A, UID), /multiple pending/);
    assert.deepEqual(tracker.getSelfInviteNotice(GROUP_B, UID), {}, "the other group is clean");
    assert.equal(tracker.getSelfInviteNotice(GROUP_A, "other-uid"), undefined);
  });

  it("a card never marks ambiguity — two cards for one group are two approvals", () => {
    // The `ambiguous` flag is gated on `notice` being passed, and `receiveCard` passes
    // none. A card is identified by its SEQUENCE, so two cards for one group are two
    // different approvals, not one flag with two candidates.
    const { tracker } = makeTracker();

    tracker.receiveCard(GROUP_A, 100, UID);
    // A second card for a DIFFERENT sequence, same sender: still two real invitations.
    assert.equal(tracker.receiveCard(GROUP_A, 200, UID), true);

    assert.equal(tracker.unpaired.length, 2, "both cards wait");
    assert.equal(
      tracker.unpaired.some((entry) => entry.notice?.ambiguous === true),
      false,
      "no card entry carries a notice, so nothing can be ambiguous",
    );
  });
});

describe("GroupInviteTracker — expiry", () => {
  it("an unpaired arrival is claimable until its deadline and gone AT it", () => {
    // Two things this pins, both easy to get off by one:
    //
    //   1. Expiry runs only inside `pair` — an idle tracker needs no timer, and a
    //      clock that jumps forward expires everything at once;
    //   2. the comparison is `expiresAt > now`, so an entry is dropped AT its deadline
    //      rather than one millisecond after it. `expiresAt` is stamped `now + 3000`
    //      at arrival, so the window is [t0, t0+3000) — half open.
    const { tracker, advance } = makeTracker();

    tracker.receiveCard(GROUP_A, 100, UID);
    assert.equal(tracker.unpaired.length, 1);

    // One millisecond before the deadline: still live, and a notice claims it.
    advance(PAIR_WINDOW_MS - 1);
    assert.equal(tracker.receiveNotice(GROUP_A, UID), false, "still claimable just before the deadline");
    assert.equal(tracker.unpaired.length, 0, "the sweep ran and the pair consumed the entry");

    // A fresh arrival, then PAST its own deadline: swept, so the notice cannot pair.
    tracker.receiveCard(GROUP_B, 200, UID);
    assert.equal(tracker.unpaired.length, 1);
    advance(PAIR_WINDOW_MS + 1);
    assert.equal(tracker.receiveNotice(GROUP_B, UID), true, "an expired card cannot pair");
    assert.equal(tracker.unpaired.length, 1, "the expired card was swept, the new notice remains");
    assert.equal(tracker.unpaired[0]?.source, "notice");
  });

  it("expiry does not touch `cards` — a remembered card outlives the window", () => {
    // The 3 s window bounds UNPAIRED arrivals only. A card that was claimed (or was
    // never pairable) stays indexed for the session, because the approval action may
    // run long after the push. Expiring `cards` on the pair window would make a
    // `sequence` flag unresolvable minutes later.
    const { tracker, advance } = makeTracker();

    tracker.receiveCard(GROUP_A, 100);
    advance(PAIR_WINDOW_MS * 100);

    assert.equal(tracker.getCardSequence(GROUP_A), 100, "still known");
    assert.equal(tracker.findCardGroup(100, GROUP_A), GROUP_A);
  });
});

describe("GroupInviteTracker — the bounded containers", () => {
  it("`unpaired` evicts the OLDEST arrival at MAX_INVITES, not the newest", () => {
    // Unbounded growth here is a leak: the window bounds each entry's LIFETIME but
    // nothing bounds the arrival rate. Evicting the newest instead would make every
    // arrival after the cap useless — pairable with nothing, immediately displaced.
    const { tracker } = makeTracker();

    for (let i = 0; i < MAX_INVITES; i++) {
      assert.equal(tracker.receiveCard(GROUP_A, i + 1, `uid_${i}`), true);
    }
    assert.equal(tracker.unpaired.length, MAX_INVITES);
    assert.equal(tracker.unpaired[0]?.key, `${GROUP_A}:uid_0`, "oldest first");

    // One more arrival evicts `uid_0` and appends.
    assert.equal(tracker.receiveCard(GROUP_A, MAX_INVITES + 1, "uid_overflow"), true);
    assert.equal(tracker.unpaired.length, MAX_INVITES, "the cap holds");
    assert.equal(tracker.unpaired[0]?.key, `${GROUP_A}:uid_1`, "the oldest was dropped");
    assert.equal(tracker.unpaired.at(-1)?.key, `${GROUP_A}:uid_overflow`);

    // A surviving entry still pairs; the evicted one no longer waits.
    assert.equal(tracker.receiveNotice(GROUP_A, "uid_5"), false, "uid_5 still waits");
    assert.equal(tracker.receiveNotice(GROUP_A, "uid_0"), true, "uid_0 was evicted, so this enqueues");
  });

  it("`cards` is bounded the same way — the oldest sequence is the one dropped", () => {
    const { tracker } = makeTracker();

    for (let i = 1; i <= MAX_INVITES; i++) tracker.receiveCard(GROUP_A, i);
    // Past the cap: sequence 1 is the least recently inserted and goes first.
    tracker.receiveCard(GROUP_A, MAX_INVITES + 1);

    assert.equal(tracker.findCardGroup(1, GROUP_A), undefined, "sequence 1 was evicted");
    assert.equal(tracker.findCardGroup(2, GROUP_A), GROUP_A, "sequence 2 survived");
    assert.equal(tracker.findCardGroup(MAX_INVITES + 1, GROUP_A), GROUP_A, "the newest is present");
  });

  it("`remember` re-inserts a key at the END, so a refreshed entry is not the next evicted", () => {
    // `remember` deletes before it sets. Without the delete, a re-inserted key would
    // keep its ORIGINAL position, so the eviction below would drop the entry that was
    // just refreshed — the opposite of an LRU.
    //
    // `notices` is where this is observable: `receiveCard` short-circuits a duplicate
    // before ever reaching `remember`, so a card's position never needs refreshing.
    //
    // ⚠️ At the cap, `pair` shifts the OLDEST `unpaired` entry BEFORE it looks for an
    // ambiguity sibling — and `u0` IS the oldest, so this re-notice displaces u0's own
    // pending entry and then enqueues a fresh one (hence non-ambiguous). The `notices`
    // write still goes through `remember`, so u0 ends up LAST in insertion order.
    const { tracker } = makeTracker();

    for (let i = 0; i < MAX_INVITES; i++) tracker.receiveNotice(GROUP_A, `u${i}`);
    tracker.receiveNotice(GROUP_A, "u0");
    // The next distinct notice therefore evicts u1, not u0.
    tracker.receiveNotice(GROUP_A, "u_overflow");

    assert.equal(tracker.getSelfInviteNotice(GROUP_A, "u1"), undefined, "u1 was the oldest, so it went");
    assert.deepEqual(tracker.getSelfInviteNotice(GROUP_A, "u0"), {}, "u0 was refreshed, so it survived");
  });
});

describe("GroupInviteTracker — the two lookups", () => {
  it("getCardSequence answers the LAST matching card, not the first", () => {
    // A group that re-invited has several cards, and the sequence the approval action
    // needs is the NEWEST. Answering the first would approve a stale request.
    const { tracker } = makeTracker();

    tracker.receiveCard(GROUP_A, 100);
    tracker.receiveCard(GROUP_A, 200);
    tracker.receiveCard(GROUP_B, 999);
    tracker.receiveCard(GROUP_A, 300);

    assert.equal(tracker.getCardSequence(GROUP_A), 300);
    assert.equal(tracker.getCardSequence(GROUP_B), 999);
    assert.equal(tracker.getCardSequence(404), undefined, "a group with no card answers undefined");
  });

  it("findCardGroup with a groupId is a single map hit", () => {
    const { tracker } = makeTracker();

    tracker.receiveCard(GROUP_A, 100);

    assert.equal(tracker.findCardGroup(100, GROUP_A), GROUP_A);
    assert.equal(tracker.findCardGroup(100, GROUP_B), undefined, "the sequence is not in that group");
    assert.equal(tracker.findCardGroup(999, GROUP_A), undefined);
  });

  it("findCardGroup without a groupId answers a unique match and THROWS on several", () => {
    // A bare `sequence` flag carries no group id, so the lookup searches every group.
    // Two groups can genuinely share a sequence — they are independent counters — and
    // approving the wrong group's invitation is not a recoverable guess.
    const { tracker } = makeTracker();

    tracker.receiveCard(GROUP_A, 100);
    assert.equal(tracker.findCardGroup(100), GROUP_A, "unique match resolves");
    assert.equal(tracker.findCardGroup(404), undefined, "no match is undefined, not an error");

    tracker.receiveCard(GROUP_B, 100);
    assert.throws(
      () => tracker.findCardGroup(100),
      /multiple groups match this invitation card sequence/,
    );
    // Supplying the group disambiguates — only the unscoped lookup throws.
    assert.equal(tracker.findCardGroup(100, GROUP_A), GROUP_A);
    assert.equal(tracker.findCardGroup(100, GROUP_B), GROUP_B);
  });
});
