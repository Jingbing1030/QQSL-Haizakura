// `message-id.ts` — the deterministic OneBot message id, and its event namespaces.
//
// Reference region: `../onebot/src/message-id.ts`
// (reference/index.mjs:11245-11263, 18 lines).
//
// ---------------------------------------------------------------------------
// Why a HASH and not the server's id
// ---------------------------------------------------------------------------
// QQ identifies a group message by `(sequence, random)` and a c2c message by an opaque
// id it does not always echo. OneBot clients, meanwhile, need ONE stable integer they
// can pass back to `get_msg` / `set_msg_emoji_like` / `set_essence_msg`. So the id is
// derived: `sha1("<sequence>:<targetId>:<eventName>")` truncated to int32.
//
// The consequences, all of them load-bearing:
//
//   * the SAME message always hashes to the same id, in the send path and the receive
//     path, which is what lets `send_group_msg`'s reply be used by a later
//     `set_group_reaction`;
//   * a DIFFERENT namespace gives a different id, which is why the four event names
//     below are not interchangeable — a c2c message sent by the bot and the same
//     message received back are deliberately different ids;
//   * `readInt32BE` can yield 0 or negative. Negative is fine (ids are signed); zero is
//     remapped to 1, because `f.messageId()` rejects 0 (`nonZero: true`) and an id the
//     action layer cannot accept is worse than a 1-in-4-billion collision.
//
// ---------------------------------------------------------------------------
// `sequenceAuthoritative` is a separate fact from `sequence`
// ---------------------------------------------------------------------------
// `hasAuthoritativeSequence` (reference:6907) requires BOTH `sequenceAuthoritative ===
// true` AND a positive integer sequence. A message whose sequence was inferred (from a
// client sequence, say) is NOT authoritative and cannot be addressed by the reaction
// and essence paths — they refuse with `message has no authoritative QQ sequence`. Four
// actions in the 擴展 batch depend on that refusal, so the predicate is faithful rather
// than defensive.

import { createHash } from "node:crypto";

/** Group messages, keyed by the server sequence. */
export const GROUP_MESSAGE_EVENT = "group_message";

/** Private messages received from the peer. */
export const PRIVATE_MESSAGE_EVENT = "private_message";

/** Legacy/fallback namespace for private messages sent by the current account. */
export const PRIVATE_SENT_MESSAGE_EVENT = "private_message_sent";

/** Namespace for private messages keyed by QQ's conversation-wide NT sequence. */
export const PRIVATE_NT_MESSAGE_EVENT = "private_message_nt";

/**
 * Which private namespace applies.
 *
 * An NT sequence wins over direction: a message with one is the SAME conversation-wide
 * key whether it was sent or received, so both directions must hash identically or a
 * reaction on one's own sent message would miss.
 */
export function privateMessageEventName(sentBySelf: boolean, hasNtSequence: boolean): string {
  if (hasNtSequence) return PRIVATE_NT_MESSAGE_EVENT;
  return sentBySelf ? PRIVATE_SENT_MESSAGE_EVENT : PRIVATE_MESSAGE_EVENT;
}

/**
 * The OneBot message id.
 *
 * `Number.isFinite` guards rather than a plain `Math.trunc` so `NaN`/`Infinity` degrade
 * to 0 instead of producing the literal strings "NaN"/"Infinity" in the hash key — a
 * difference that would make the id unstable for the same logical message.
 */
export function hashMessageIdInt32(sequence: number, sessionId: number, eventName: string): number {
  const key = `${Number.isFinite(sequence) ? Math.trunc(sequence) : 0}:${
    Number.isFinite(sessionId) ? Math.trunc(sessionId) : 0
  }:${eventName}`;
  let id = createHash("sha1").update(key).digest().readInt32BE(0);
  if (id === 0) id = 1;
  return id;
}

/**
 * `hasAuthoritativeSequence` (reference:6907) — true only when a stored sequence can
 * safely be sent back to QQ.
 *
 * `meta?.sequenceAuthoritative === true` is a strict test on purpose: a truthy-but-not-
 * `true` value (1, "true") must not pass, because the flag is set by this port and a
 * loose comparison would let a decoded packet's accidental value through.
 */
export function hasAuthoritativeSequence(
  meta: { sequenceAuthoritative?: unknown; sequence?: unknown } | null | undefined,
): boolean {
  return (
    meta?.sequenceAuthoritative === true &&
    typeof meta.sequence === "number" &&
    Number.isInteger(meta.sequence) &&
    meta.sequence > 0
  );
}