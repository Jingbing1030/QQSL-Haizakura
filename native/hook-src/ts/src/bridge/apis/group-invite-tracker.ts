// `GroupInviteTracker` — the in-memory state machine that pairs an invitation CARD
// with the group-request NOTICE for the same person.
//
// Reference region: `../protocol/src/group-invite-tracker.ts`
// (reference/index.mjs:46986-47055, ~70 lines). No network, no I/O, no clock of
// its own beyond `Date.now` — which is why it is a separate module rather than a
// corner of `contacts.ts`: it is pure state and can be driven by a test with three
// method calls.
//
// ---------------------------------------------------------------------------
// What the two maps mean, and why there are THREE containers
// ---------------------------------------------------------------------------
// QQ delivers one invitation as two unrelated events:
//
//   * a CARD — a private message whose payload names the group and the approval
//     `sequence` (`inviteCardGroupUin` / `inviteCardSequence` in `msg-push.ts`);
//   * a NOTICE — a group-system row that names the group and the INVITER's uid
//     but not the sequence.
//
// Neither event alone can be approved: the card knows the sequence, the notice
// knows who to answer. `cards` and `notices` are the two long-lived indexes keyed
// by what each side can be looked up by (`groupId:sequence` and `groupId:uid`),
// and `unpaired` is the SHORT-lived list of arrivals that have not found a partner
// yet. A card whose uid is unknown when it arrives therefore waits in `unpaired`
// for up to `PAIR_WINDOW_MS`, and the notice that follows claims it.
//
// ---------------------------------------------------------------------------
// The pairing asymmetry is deliberate, not a bug
// ---------------------------------------------------------------------------
// `receiveCard` returns `!paired` and `receiveNotice` returns `false` when it
// pairs. The two call sites read that flag as "is this a NEW invite I should
// dispatch?" (reference:347041 and :347126), so:
//
//   * a card that pairs with a waiting notice must NOT dispatch (the notice will
//     carry it), hence `false`;
//   * a notice that claims a waiting card must likewise not dispatch twice.
//
// And when `receiveNotice` pairs it does NOT write `notices` — the notice object
// it allocated is dropped, because the partner it claimed was a CARD, and a card
// carries no notice. ⚠️ The observable consequence, which is the reference's own
// behaviour and is reproduced rather than repaired: a card-then-notice order
// leaves `getSelfInviteNotice` with nothing, so the `cardSequence` back-fill only
// ever happens notice-then-card. See this file's "reference contradictions" note
// in the batch report.
//
// ---------------------------------------------------------------------------
// Why `remember` deletes before it sets
// ---------------------------------------------------------------------------
// Both maps are bounded LRU-ish indexes: re-inserting an existing key must move it
// to the END of the iteration order, or the eviction below would drop the entry
// that was just refreshed. The eviction happens BEFORE the insert and only when
// the map is already at `MAX_INVITES`, so the map never exceeds that size.

/** `PAIR_WINDOW_MS` (reference:46988) — how long an unclaimed arrival waits. */
export const PAIR_WINDOW_MS = 3e3;

/** `MAX_INVITES` (:46989) — the ceiling for each of the three containers. */
export const MAX_INVITES = 1024;

/**
 * One card, as `cards` stores it.
 *
 * `groupId` is on the value as well as in the key because `getCardSequence` walks
 * the values and `findCardGroup` answers with it — a key-only record would force
 * both to re-parse the string.
 */
export interface InviteCard {
  groupId: number;
  sequence: number;
}

/**
 * One notice, as `notices` stores it.
 *
 * Both fields are filled in AFTER the object is created: `cardSequence` by the
 * card that pairs with it, `ambiguous` by a second notice for the same
 * group/uid inside the window. Neither is known at construction time.
 */
export interface PendingInviteNotice {
  /** Set by `receiveCard` when this notice is the one the card paired with. */
  cardSequence?: number | undefined;
  /** Set when more than one notice shares this group/uid — see `getSelfInviteNotice`. */
  ambiguous?: boolean | undefined;
}

/** One unclaimed arrival in `unpaired`. */
export interface PendingInvite {
  /** `groupId:uid` for a notice, `groupId:sequence` for a card. */
  key: string;
  source: "card" | "notice";
  /** The notice object, for `source: "notice"` so the card can back-fill it. */
  notice: PendingInviteNotice | undefined;
  /** Absolute time; the entry is dropped by the next `pair` after this. */
  expiresAt: number;
}

/**
 * Bounded insert: refresh the key's position, evict the oldest if full, then set.
 *
 * The `done` check is not defensive noise — `keys().next()` on an empty map
 * returns `{done: true}`, and the `size >= MAX_INVITES` guard can only be true
 * for a non-empty map, but TypeScript's `IteratorResult` narrowing needs the test
 * to reach `value` at all.
 */
function remember<K, V>(entries: Map<K, V>, key: K, value: V): void {
  entries.delete(key);
  if (entries.size >= MAX_INVITES) {
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  }
  entries.set(key, value);
}

/**
 * Account-local state shared by incoming invitations and their approval actions.
 *
 * Reference `var GroupInviteTracker = class` at reference/index.mjs:46992.
 *
 * ⚠️ ONE instance per account session, not per group: `MAX_INVITES` bounds each
 * container across every group, and `findCardGroup` deliberately searches them all
 * (a bare-sequence flag carries no group id).
 */
export class GroupInviteTracker {
  /** `groupId:sequence` → card. */
  readonly #cards = new Map<string, InviteCard>();
  /** `groupId:uid` → notice. */
  readonly #notices = new Map<string, PendingInviteNotice>();
  /**
   * Arrivals that have not found a partner yet, oldest first.
   *
   * Public because it is public in the reference (`unpaired = []`) and because the
   * eviction rule is only observable through it — a test that could not see the
   * list could not tell "evicted the oldest" from "evicted nothing".
   */
  unpaired: PendingInvite[] = [];

  /**
   * @param now Clock, defaulting to `Date.now`. Injected so the expiry rule is
   *   testable without sleeping for `PAIR_WINDOW_MS`; the reference reads
   *   `Date.now` directly and its own tests stub the global.
   */
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /**
   * A group-system notice arrived: group + inviter uid, no sequence.
   *
   * @returns `true` when this is a NEW notice worth dispatching, `false` when it
   *   claimed a card that is already on its way — see the file header.
   */
  receiveNotice(groupId: number, uid: string): boolean {
    const key = `${groupId}:${uid}`;
    const notice: PendingInviteNotice = {};
    // ⚠️ On a pair the freshly allocated `notice` is DISCARDED (the partner is a
    // card, which has no notice to keep). Reproduced from the reference; see the
    // header for why this is asymmetry rather than an oversight.
    if (this.#pair(key, "notice", notice)) return false;
    remember(this.#notices, key, notice);
    return true;
  }

  /**
   * An invitation card arrived: group + sequence, and the sender's uid when the
   * push carried one.
   *
   * @returns `true` when the card is UNPAIRED — i.e. the caller must dispatch it
   *   itself, because no notice is going to. `false` means a notice claimed it and
   *   the notice's own dispatch carries the card.
   */
  receiveCard(groupId: number, sequence: number, uid?: string | undefined): boolean {
    const key = `${groupId}:${sequence}`;
    // A repeated card for the same approval sequence is the same invitation (the
    // server re-sends it on reconnect) and must not dispatch twice.
    if (this.#cards.has(key)) return false;
    // No uid means the push carried no sender identity, so there is nothing to pair
    // WITH: the card is unpaired by definition and the notice (if any) will find it
    // through the group/sequence index instead.
    const paired = uid ? this.#pair(`${groupId}:${uid}`, "card") : undefined;
    if (paired?.notice) paired.notice.cardSequence = sequence;
    remember(this.#cards, key, { groupId, sequence });
    return !paired;
  }

  /**
   * Claim a partner from `unpaired`, or enqueue this arrival.
   *
   * @returns the claimed entry (whose `notice` the caller may back-fill), or
   *   `undefined` when nothing was waiting and this arrival was enqueued.
   */
  #pair(key: string, source: "card" | "notice", notice?: PendingInviteNotice | undefined): PendingInvite | undefined {
    const now = this.#now();
    // Expiry is evaluated only here, on the next arrival: an idle tracker must not
    // need a timer, and a clock that jumps forward simply expires everything at once.
    this.unpaired = this.unpaired.filter((entry) => entry.expiresAt > now);
    // `source !== source` is the whole pairing rule: a notice claims a card, a card
    // claims a notice, and two of the same kind never pair (a second notice is a
    // second invitation, handled below).
    const match = this.unpaired.findIndex((entry) => entry.key === key && entry.source !== source);
    if (match !== -1) return this.unpaired.splice(match, 1)[0];
    if (this.unpaired.length >= MAX_INVITES) this.unpaired.shift();
    // A second NOTICE for the same group/uid inside the window means two live
    // invitations share one key, and approving "the" notice would be a guess. Only
    // notices carry the flag: a card is identified by its sequence, so two cards
    // for one group are two different approvals and never ambiguous.
    if (notice && this.unpaired.some((entry) => entry.key === key && entry.source === "notice")) {
      notice.ambiguous = true;
    }
    this.unpaired.push({ key, source, notice, expiresAt: now + PAIR_WINDOW_MS });
    return undefined;
  }

  /**
   * The notice for a group/uid, if one was stored.
   *
   * ⚠️ THROWS when two notices shared the key inside the window. Answering either
   * one would approve an invitation the operator may not have meant, so the
   * ambiguity is surfaced to the caller rather than resolved by picking.
   */
  getSelfInviteNotice(groupId: number, uid: string): PendingInviteNotice | undefined {
    const notice = this.#notices.get(`${groupId}:${uid}`);
    if (notice?.ambiguous) throw new Error("multiple pending self invitations share this flag");
    return notice;
  }

  /**
   * The most recent card sequence for a group.
   *
   * ⚠️ LAST match, not first: a group that re-invited has several cards, and the
   * sequence the approval action needs is the newest one. Map iteration order is
   * insertion order and `remember` refreshes it, so "last" is also "most recent".
   */
  getCardSequence(groupId: number): number | undefined {
    let sequence: number | undefined;
    for (const card of this.#cards.values()) {
      if (card.groupId === groupId) sequence = card.sequence;
    }
    return sequence;
  }

  /**
   * Resolve a card's group from its sequence.
   *
   * @param groupId When the caller already knows the group, the lookup is a single
   *   map hit. Otherwise the sequence is searched across every group — and a
   *   sequence that matches more than one group THROWS, because the two groups'
   *   approvals are not interchangeable.
   */
  findCardGroup(sequence: number, groupId?: number | undefined): number | undefined {
    if (groupId !== undefined) return this.#cards.get(`${groupId}:${sequence}`)?.groupId;
    let match: number | undefined;
    for (const card of this.#cards.values()) {
      if (card.sequence === sequence) {
        if (match !== undefined) throw new Error("multiple groups match this invitation card sequence");
        match = card.groupId;
      }
    }
    return match;
  }
}
