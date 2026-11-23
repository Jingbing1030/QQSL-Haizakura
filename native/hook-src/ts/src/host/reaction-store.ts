// Reaction cache: who reacted to which message with what emoji.
//
// The reference keeps this in a SQLite table (`reactions.db`, index.mjs:342600-342692) keyed by
// `(group_id, msg_seq, emoji_id, operator_uin)`. That table exists for three reasons: to
// survive a restart, to answer `fetchEmojiLikeUsers` without a network round trip, and to know
// which emoji to remove when the bot un-reacts.
//
// The primary key is the interesting part. QQ's sequence is per-group, NOT a message id, so the
// identity of a reaction is `(group, seq, emoji, operator)` — not `(message_id, emoji)`. Two
// different messages can share a sequence across groups, and the same user can add the same
// emoji to the same message twice only if the first was removed. Keying on anything else
// silently merges unrelated reactions.
//
// This port keeps the same four-part key in memory. There is no `reactions.db` yet, so the cache
// is lost on restart; that degrades `fetchEmojiLikeUsers` to a network-only answer rather than
// producing a wrong one, which is the only acceptable direction for a cache to fail.
//
// ⚠️ `set_at` is in SECONDS, matching both the reference column and the action's
// `last_reaction_time` field. Passing milliseconds would put every timestamp in the year 57000.

export interface ReactionEntry {
  operatorUin: number;
  operatorUid: string;
  setAt: number;
}

export interface ReactionSummaryEntry {
  emojiId: string;
  emojiType: number;
  count: number;
  lastSetAt: number;
}

/** The bounds the reference clamps to: at least 1, at most 500 (index.mjs:342660). */
const MIN_LIMIT = 1;
const MAX_LIMIT = 500;

/**
 * The emoji type Satori/OneBot expect for an emoji id.
 *
 * The reference infers it from the id's length: a system face is a short numeric id ("14",
 * "128512" is a unicode codepoint rendered as a string and stays type 1 up to 3 chars), while a
 * longer id is a custom face (image) — `emojiId.length > 3 ? 2 : 1` (index.mjs:40077). Getting
 * this backwards makes the server reject the reaction outright.
 */
export function emojiTypeFor(emojiId: string): number {
  return emojiId.length > 3 ? 2 : 1;
}

/** A composite key that cannot collide with another triple. */
function keyOf(groupId: number, msgSeq: number, emojiId: string): string {
  return `${groupId}:${msgSeq}:${emojiId}`;
}

function userKeyOf(operatorUin: number): string {
  return String(operatorUin);
}

export class ReactionStore {
  /** `group:seq:emoji` → operator uin → entry. Insertion order tracks first-set order. */
  readonly #byMessage = new Map<string, Map<string, ReactionEntry>>();

  /**
   * Record (or refresh) one reaction.
   *
   * An upsert, not an insert: the reference's `stmtUpsert` overwrites `emoji_type`,
   * `operator_uid` and `set_at` on conflict (index.mjs:342605-342611). Re-reacting must update
   * the timestamp rather than create a second row, or `countUsers` would report two.
   *
   * Refuses silently — not by throwing — when any of the four key parts is missing, because the
   * reference's guard is `if (!groupId || !msgSeq || !emojiId || !operatorUin) return;`. The
   * caller is mid-send at that point; aborting the action because the cache could not be
   * written would turn a bookkeeping miss into a failed reaction.
   */
  recordAdd(
    groupId: number,
    msgSeq: number,
    emojiId: string,
    emojiType: number,
    operatorUin: number,
    operatorUid: string,
    setAt: number,
  ): void {
    if (!groupId || !msgSeq || !emojiId || !operatorUin) return;
    const key = keyOf(groupId, msgSeq, emojiId);
    let users = this.#byMessage.get(key);
    if (users === undefined) {
      users = new Map();
      this.#byMessage.set(key, users);
    }
    users.set(userKeyOf(operatorUin), { operatorUin, operatorUid, setAt });
  }

  /** Drop one reaction. A no-op when it was never recorded. */
  recordRemove(groupId: number, msgSeq: number, emojiId: string, operatorUin: number): void {
    if (!groupId || !msgSeq || !emojiId || !operatorUin) return;
    const key = keyOf(groupId, msgSeq, emojiId);
    const users = this.#byMessage.get(key);
    if (users === undefined) return;
    users.delete(userKeyOf(operatorUin));
    // Leaving an empty map behind would make `summarizeMessage` emit a zero-count entry for an
    // emoji nobody has on the message any more.
    if (users.size === 0) this.#byMessage.delete(key);
  }

  /**
   * One page of reactors for a single emoji, oldest first.
   *
   * `ORDER BY set_at ASC` in the reference (index.mjs:342663): the first person to react is the
   * first row. `limit` clamps to 1..500 and `offset` floors at 0, matching
   * `Math.max(1, Math.min(limit, 500))` / `Math.max(0, offset)`.
   */
  listUsers(
    groupId: number,
    msgSeq: number,
    emojiId: string,
    limit = 20,
    offset = 0,
  ): ReactionEntry[] {
    const users = this.#byMessage.get(keyOf(groupId, msgSeq, emojiId));
    if (users === undefined) return [];
    const safeLimit = Math.max(MIN_LIMIT, Math.min(Math.trunc(limit) || 0, MAX_LIMIT));
    const safeOffset = Math.max(0, Math.trunc(offset) || 0);
    return [...users.values()]
      .sort((a, b) => a.setAt - b.setAt)
      .slice(safeOffset, safeOffset + safeLimit);
  }

  /** How many cached reactors an emoji has — the LOCAL count, not the server's. */
  countUsers(groupId: number, msgSeq: number, emojiId: string): number {
    return this.#byMessage.get(keyOf(groupId, msgSeq, emojiId))?.size ?? 0;
  }

  /**
   * Every emoji on a message, with its local count and the newest reaction time.
   *
   * Grouped by `emoji_id` only — `emoji_type` is carried from whichever row the group saw, which
   * is what the reference's `GROUP BY emoji_id` does with its `MAX(set_at)` companion
   * (index.mjs:342680-342689). The `count` here is the local one; `fetchEmojiLikeSummary`
   * deliberately takes `Math.max(local, remote)` because a fresh cache always undercounts.
   */
  summarizeMessage(groupId: number, msgSeq: number): ReactionSummaryEntry[] {
    const prefix = `${groupId}:${msgSeq}:`;
    const grouped = new Map<string, ReactionSummaryEntry>();
    for (const [key, users] of this.#byMessage) {
      if (!key.startsWith(prefix)) continue;
      // The emoji id is everything after the second colon; splitting rather than slicing keeps
      // an emoji id that itself contains ':' intact.
      const emojiId = key.slice(prefix.length);
      let lastSetAt = 0;
      for (const entry of users.values()) if (entry.setAt > lastSetAt) lastSetAt = entry.setAt;
      grouped.set(emojiId, {
        // The type is a pure function of the id (see `emojiTypeFor`), so deriving it here is
        // exact and avoids storing a second copy that could drift from what was sent.
        emojiId,
        emojiType: emojiTypeFor(emojiId),
        count: users.size,
        lastSetAt,
      });
    }
    return [...grouped.values()].sort((a, b) => a.emojiId.localeCompare(b.emojiId));
  }

  /** Drop everything. Exposed for tests and for a future `clear()` on logout. */
  clear(): void {
    this.#byMessage.clear();
  }

  /** Number of recorded reactions, for tests and diagnostics. */
  get size(): number {
    let total = 0;
    for (const users of this.#byMessage.values()) total += users.size;
    return total;
  }
}