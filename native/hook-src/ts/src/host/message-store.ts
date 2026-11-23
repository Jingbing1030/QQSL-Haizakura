// `MessageStore` — the in-memory message table behind the OneBot `ActionContext` message
// providers, plus the recall metadata a `delete_msg` actually needs.
//
// ===========================================================================
// WHAT THIS FILE ESTABLISHES, AND WHAT IT DOES NOT
// ===========================================================================
//
// **Establishes:** a bounded, process-local table keyed by OneBot message id holding the
// stored OneBot event, the recall metadata, and the media snapshots. It supplies the
// *signatures* the message providers in `src/onebot/actions/context.ts:1345-1350`
// require, and it is testable without a QQ client, a packet, a container or a network.
//
// **Does NOT establish:**
//
//   1. **No persistence.** Nothing is written to disk and nothing is restored on
//      restart: a new `MessageStore` starts empty. The reference's store is SQLite
//      (`reference/index.mjs:40748`, `../onebot/src/message-store.ts`); this is
//      deliberately the volatile subset. Consequently there is no `listSessionEvents`,
//      no history cursor, no reply-resolution by sequence and no recall-tombstone
//      table — all of those need durable rows. Do not call this "the message store" in
//      a progress report without the "in-memory only" qualifier.
//
//   2. **No real QQ send success.** A stored row is not proof that QQ delivered
//      anything. A row can come from a synthetic fixture, from an inbound push, or from
//      a self-sent echo the host built locally. Whether a `MessageSvc.PbSendMsg` packet
//      was accepted, and whether the bubble appeared in the conversation, is decided by
//      the send path (`src/bridge/apis/message.ts`, `MessageApi.sendGroup` /
//      `sendPrivate`) and can only be confirmed on a live QQ client. This module sends
//      nothing and recalls nothing.
//
//   3. **No recall.** `delete(messageId)` drops a local row; it does NOT make a message
//      disappear from a group or a friend chat. See `getRecallMeta` below for what a
//      real recall needs and why the store cannot perform it.
//
// ===========================================================================
// Recall is by SEQUENCE, not by message id — that is why `getRecallMeta` exists
// ===========================================================================
//
// The OneBot message id is a `sha1` hash this port derives (message-id.ts:69); QQ has
// never heard of it. The two recall calls take server-side identifiers instead:
//
//     MessageApi.recallGroup(groupId, sequence)                          // message.ts:841
//     MessageApi.recallPrivate(userUin, clientSeq, msgSeq, random, timestamp)  // message.ts:859
//
// `getRecallMeta(messageId)` therefore answers a discriminated union that maps 1:1 onto
// those two signatures — a caller does not have to know which fields each call wants:
//
//     const target = store.getRecallMeta(id);
//     if (target === null) return failedResponse(RETCODE.ACTION_FAILED, "message not found or not retractable");
//     if (target.kind === "group") await messageApi.recallGroup(target.groupId, target.sequence);
//     else await messageApi.recallPrivate(target.userId, target.clientSequence, target.sequence, target.random, target.timestamp);
//
// Two deliberate shapes:
//
//   * **Group recall gets no `random`.** `recallGroup` hardcodes `random: 0` inside
//     `GroupRecallInfo` (message.ts:841-851), so carrying the stored random in the
//     target type would advertise a knob that does not exist.
//   * **Private recall's `sequence` is the `msgSeq` argument**, not the composite
//     `(16777216n << 32n) | random` message id — `recallPrivate` builds that itself and
//     the comment warns that passing a receipt id "silently targets nothing".
//
// **What the store deliberately does NOT export: a member named `deleteMessage`.** The
// `ActionContext` provider of that name is a *recall*: the reference implements it as
// `deleteMessage(bridge, meta) -> bridge.apis.message.recallGroup/recallPrivate`
// (reference:40049), i.e. the store is not involved beyond supplying `meta`. Naming a
// local row-drop `deleteMessage` invites a host to wire
// `deleteMessage: store.deleteMessage` and answer `delete_msg` with `retcode 0` while the
// message is still sitting in the group — a false success, which is exactly the failure
// mode MEMORY.md §2.4b records for misleading header comments. The host must compose:
//
//     deleteMessage: async (id) => {
//       const target = store.getRecallMeta(id);
//       if (!target) throw new Error("message not found or not retractable");
//       if (target.kind === "group") await messageApi.recallGroup(target.groupId, target.sequence);
//       else await messageApi.recallPrivate(...);
//       store.delete(id);                       // only after QQ accepted
//     }
//
// The same caution applies to `refreshMessageMedia`: the reference's version mutates the
// CALLER's event object in place (reference:39801) and never writes back to the store, so
// a refreshed media URL is per-call and is not persisted. `get` returns a copy for exactly
// that reason (the reference re-parses stored JSON on every read), and `updateMedia` is
// the only explicit write path for snapshots.
//
// ===========================================================================
// Eviction policy: LRU, bounded by entry count
// ===========================================================================
//
// The bound is on ENTRIES, not bytes: a byte bound over decoded OneBot JSON objects
// cannot be enforced without serialising them on every insert.
//
//   * one row per id, whether it holds an event, a meta, media, or all three;
//   * every successful read (`get`, `getMeta`, `getMedia`, `getRecallMeta`) marks the row
//     most recently used; so does a write to an existing id;
//   * when an insert pushes the table past `maxEntries`, the LEAST recently used rows are
//     dropped one at a time until it is within bounds;
//   * eviction is silent (no callback) and counted in `evictions`, so a test asserts it
//     happened instead of inferring it from a miss.
//
// LRU rather than FIFO or TTL: the access pattern that matters is `get_msg`/`delete_msg`
// on a *recent* id taken from a chat, so recency of USE predicts the next hit far better
// than recency of insert. No TTL, because recall metadata for an old message stays valid
// until eviction, and expiring it on a clock turns a working recall into
// `message not found` for no gain.
//
// Recency order is the `Map`'s own iteration order: a touch re-inserts the key at the end
// (`delete` then `set`), so `keys().next()` is always the least recently used row. O(1),
// and no timestamp sweep on every eviction.

import type { StoredMessageMeta } from "../onebot/actions/context.js";
import { hasAuthoritativeSequence } from "../onebot/actions/message-id.js";
import { cqUnescape } from "../onebot/actions/message-parser.js";
import { createLogger } from "../onebot/log.js";

const log = createLogger("Host.MessageStore");

/**
 * One media snapshot stored beside a message.
 *
 * Shape follows the reference's `serializeMessageMedia` output: a flat record whose
 * `type` is one of `image` / `record` / `video`. Only `type` is required, because the
 * remaining members (`md5Hex`, `duration`, `mediaNode`, …) are uploader metadata this
 * module never interprets — it stores and returns them untouched. Typing the rest as
 * `unknown` instead of naming fields is deliberate: a guessed field list would be a claim
 * about `element-builder`'s output that nothing here verifies.
 */
export interface StoredMessageMedia {
  readonly type: string;
  readonly [field: string]: unknown;
}

/**
 * What one insert carries.
 *
 * The per-message facts the parent record must hold all live on `StoredMessageMeta`
 * (context.ts:1247), which is the port's existing shape for them — reused rather than
 * duplicated, so there is one definition instead of a second one that can drift:
 *
 *     isGroup               chat kind                  -> "group" | "private"
 *     targetId              groupId when isGroup, else the peer's user id
 *     sequence              server sequence (group) / NT sequence (private)
 *     sequenceAuthoritative whether `sequence` may be sent back to QQ
 *     clientSequence        c2c client sequence (0 for group)
 *     random                message random
 *     timestamp             seconds
 *
 * `messageId` is the key, echoed on every read.
 *
 * All three members are optional so a metadata-only or event-only row can be written:
 * the reference has separate `storeMeta` / `storeEvent` entry points for exactly that
 * ("a message can be known but not retractable, and vice versa", context.ts:1244). At
 * least one must be present; an empty record is a caller bug, not a row.
 */
export interface MessageRecordInput {
  /** The OneBot event (`post_type` / `message_type` / `message` / `user_id` / …). */
  event?: Record<string, unknown> | null;
  /** Recall metadata. Absent ⇒ `getMeta`/`getRecallMeta` answer null. */
  meta?: StoredMessageMeta | null;
  /** Media snapshots. Absent ⇒ the stored snapshots are kept as they are. */
  media?: readonly StoredMessageMedia[] | null;
}

/** A group recall target: the two arguments `recallGroup` takes, and nothing else. */
export interface GroupRecallTarget {
  readonly kind: "group";
  readonly groupId: number;
  /** The `info.sequence` member of `GroupRecallRequest`. */
  readonly sequence: number;
}

/**
 * A c2c recall target: the five arguments `recallPrivate` takes.
 *
 * `sequence` is passed as `msgSeq`; `recallPrivate` derives the composite message id
 * from `random` itself.
 */
export interface PrivateRecallTarget {
  readonly kind: "private";
  readonly userId: number;
  readonly sequence: number;
  readonly clientSequence: number;
  readonly random: number;
  readonly timestamp: number;
}

export type RecallTarget = GroupRecallTarget | PrivateRecallTarget;

/** One row as `getRecord`/`get` report it. Copies, never the stored objects. */
export interface MessageRecord {
  readonly messageId: number;
  readonly event: Record<string, unknown> | null;
  readonly meta: StoredMessageMeta | null;
  readonly media: readonly StoredMessageMedia[] | null;
}

export interface MessageStoreOptions {
  /**
   * Maximum number of retained rows. Default {@link DEFAULT_MAX_ENTRIES}.
   *
   * A bound is mandatory rather than optional: an unbounded map of decoded events in a
   * long-lived host process is a leak, and the reference's durability is not available
   * here to make the growth harmless.
   */
  maxEntries?: number;
}

/** Default row bound: enough for a busy chat, small enough to stay predictable. */
export const DEFAULT_MAX_ENTRIES = 512;

interface Entry {
  event: Record<string, unknown> | null;
  meta: StoredMessageMeta | null;
  media: readonly StoredMessageMedia[] | null;
}

/**
 * The reference's `isValidMessageId` (reference:41208): an integer that is not zero.
 *
 * Negative ids are LEGAL — OneBot shows ids like `-453391294`, and the action layer's
 * `f.messageId()` accepts them while rejecting `0`. Refusing negatives here would make
 * `get_msg`/`delete_msg` fail on real messages, so the check is copied exactly.
 */
function isValidMessageId(messageId: number): boolean {
  return Number.isInteger(messageId) && messageId !== 0;
}

function normalizeMaxEntries(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_ENTRIES;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("message store maxEntries must be a positive safe integer");
  }
  return value;
}

/**
 * `normalizePositiveInt` (reference:41245) — the page-size clamp `listSessionEvents`
 * uses: non-finite or non-positive falls back, and anything above `max` is capped.
 *
 * Kept local rather than imported: `message-parser.ts` has no equivalent, and the
 * clamp belongs to the store's own cursor logic.
 */
function normalizePositiveInt(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  if (n <= 0) return fallback;
  if (n > max) return max;
  return n;
}

/**
 * `validatePrivateRecallKey` (reference:41232).
 *
 * A recall is keyed by three numbers, and a `0` in any of them cannot identify
 * anything — it names the message the sender numbered zero, which QQ never produced.
 * `timestamp` may be zero (an unrecorded time is a real state) but must not be
 * negative or non-integer.
 */
function validatePrivateRecallKey(
  sessionId: number,
  clientSequence: number,
  timestamp: number,
  timestampLabel = "recall time",
): void {
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    throw new Error(`invalid private recall peer ${String(sessionId)}`);
  }
  if (!Number.isSafeInteger(clientSequence) || clientSequence <= 0) {
    throw new Error(`invalid private recall client sequence ${String(clientSequence)}`);
  }
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error(`invalid private recall ${timestampLabel} ${String(timestamp)}`);
  }
}

/**
 * `eventPrivateDirection` (reference:41216). `-1` means "not a directional private
 * message", and that is not the same as incoming: a group event, a temp-session
 * message (`sub_type !== "friend"`) and anything that is not a friend message carry no
 * direction, so a recall tombstone must never be consulted for them.
 */
function eventPrivateDirection(isGroup: boolean, event: Record<string, unknown>): -1 | 0 | 1 {
  if (isGroup || event["message_type"] !== "private" || event["sub_type"] !== "friend") return -1;
  if (event["post_type"] === "message") return 0;
  if (event["post_type"] === "message_sent") return 1;
  return -1;
}

/**
 * `toInt` (reference:41237 `toInt$2`) — the lenient numeric read a SQL column used to
 * provide for free.
 *
 * A stored OneBot event came from JSON, so `time` and `message_seq` may arrive as
 * strings from a caller that built the event by hand. `0` on anything unreadable,
 * including `NaN`/`Infinity`, because the column default was 0 and every consumer
 * treats 0 as absent.
 */
function toHistoryInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return 0;
}

/** The tombstone key: peer, sender-local sequence, and direction. */
function privateRecallKey(sessionId: number, clientSequence: number, sentBySelf: boolean): string {
  return `${sessionId}:${clientSequence}:${sentBySelf ? 1 : 0}`;
}

/**
 * `TIME_WINDOWS` (reference:37817) — the ladder `selectPrivateQuote` widens through
 * when matching an outgoing quote by timestamp alone.
 *
 * `0` first is deliberate: an exact timestamp match is the strongest signal, and it is
 * tried before any tolerance is allowed.
 */
const TIME_WINDOWS: readonly number[] = [0, 5, 30];

/**
 * `isUsableQuoteTime` (reference:37822).
 *
 * `MAX_SAFE_INTEGER` is excluded, not merely tolerated: the reply codec substitutes
 * `Number.MAX_SAFE_INTEGER` when the quote carried NO time, so that sentinel has to
 * read as "no time" here rather than as a timestamp thirty seconds wide.
 */
function isUsableQuoteTime(timestamp: number | undefined): boolean {
  return (
    timestamp !== undefined &&
    Number.isSafeInteger(timestamp) &&
    timestamp > 0 &&
    timestamp < Number.MAX_SAFE_INTEGER
  );
}

/** One candidate a private quote may resolve to (reference:41222 `privateReplyCandidate`). */
interface PrivateReplyCandidate {
  id: number;
  /** 0 when the stored sequence is not authoritative — such a row can only match by client sequence. */
  sequence: number;
  clientSequence: number;
  timestamp: number;
  preview: { text: string; plain: boolean } | null;
}

/**
 * One stored row as a quote candidate.
 *
 * reference:41222 `privateReplyCandidate`. `sequence` is ZEROED when the row is not
 * authoritative, which is what stops a fallback sequence from matching the
 * `sequence = ?` half of the query.
 */
function privateReplyCandidate(
  messageId: number,
  meta: StoredMessageMeta,
  event: Record<string, unknown> | null,
): PrivateReplyCandidate {
  if (!isValidMessageId(messageId)) {
    throw new Error(`private quote matched invalid message id ${String(messageId)}`);
  }
  return {
    id: messageId,
    sequence: hasAuthoritativeSequence(meta) ? meta.sequence : 0,
    clientSequence: meta.clientSequence,
    timestamp: meta.timestamp,
    preview: cachedQuotePreview(event),
  };
}

/** The display labels `cachedQuotePreview` substitutes for a non-text segment. */
const QUOTE_LABELS: Readonly<Record<string, string>> = {
  image: "[图片]",
  record: "[语音]",
  video: "[视频]",
  file: "[文件]",
  face: "[表情]",
  mface: "[表情]",
  forward: "[聊天记录]",
  json: "[卡片]",
  xml: "[卡片]",
};

/**
 * `cachedQuotePreview` (reference:37868) — the displayable text of a STORED event.
 *
 * A string `message` is CQ-decoded and reported as `plain: true`; an array is walked
 * segment by segment. Any segment outside the label table makes the whole preview
 * `null` rather than partial, because `selectPrivateQuote` compares previews to decide
 * between candidates and a truncated one would match the wrong message.
 */
function cachedQuotePreview(event: Record<string, unknown> | null): { text: string; plain: boolean } | null {
  if (event === null) return null;
  const message = event["message"];
  if (typeof message === "string") {
    return message.includes("[CQ:") ? null : { text: cqUnescape(message), plain: true };
  }
  if (!Array.isArray(message) || message.length === 0) return null;
  const parts: string[] = [];
  let plain = true;
  for (const segment of message) {
    if (typeof segment !== "object" || segment === null || Array.isArray(segment)) return null;
    const seg = segment as { type?: unknown; data?: unknown };
    const data = (typeof seg.data === "object" && seg.data !== null ? seg.data : {}) as Record<string, unknown>;
    if (seg.type === "text" && typeof data["text"] === "string") {
      parts.push(data["text"]);
    } else if (typeof seg.type === "string" && Object.hasOwn(QUOTE_LABELS, seg.type)) {
      parts.push(typeof data["summary"] === "string" ? data["summary"] : (QUOTE_LABELS[seg.type] as string));
      plain = false;
    } else {
      return null;
    }
  }
  return { text: parts.join(""), plain };
}

/** The quoted message's own text, when every segment is a text segment (reference:37828). */
function quoteText(elements: readonly { type?: unknown; text?: unknown }[] | undefined): string {
  if (!elements?.length) return "";
  if (!elements.every((element) => element.type === "text")) return "";
  return elements.map((element) => (typeof element.text === "string" ? element.text : "")).join("");
}

/**
 * `selectPrivateQuote` (reference:37826) — pick one candidate, or refuse.
 *
 * The reference's whole function is 30 lines of narrowing, and every stage is a
 * different way the answer can be *ambiguous* rather than merely absent. Reproduced
 * in its own order:
 *
 *   1. drop candidates the caller EXCLUDED (the message being quoted cannot quote
 *      itself), and any outside ±30s;
 *   2. drop candidates whose preview text contradicts the quote's;
 *   3. an exact sequence match wins — but only if it is UNIQUE;
 *   4. otherwise, for an outgoing quote with a time, widen through `TIME_WINDOWS`;
 *      a "confirmed" match is the only one accepted, and a tie is `ambiguous`;
 *   5. else `missing`.
 *
 * `excludedMessage` is not threaded through: this port's only caller
 * (`resolvePrivateReplyMessageId` from the reply codec) never supplies one, and
 * inventing a parameter no caller sets would be untested code. A caller that needs it
 * must extend the signature AND this function together.
 */
function privateQuoteSelection(
  candidates: readonly PrivateReplyCandidate[],
  replySequence: number,
  sentBySelf: boolean,
  timestamp: number,
  text: string,
): { candidate: PrivateReplyCandidate | null; reason: string } {
  const time = isUsableQuoteTime(timestamp) ? timestamp : null;
  const nearby = candidates.filter((candidate) => time === null || Math.abs(candidate.timestamp - time) <= 30);
  const compatible = nearby.filter(
    (candidate) => !text || !candidate.preview || candidate.preview.text.startsWith(text),
  );
  const bySequence = compatible.filter(
    (candidate) =>
      replySequence > 0 &&
      (candidate.clientSequence === replySequence || candidate.sequence === replySequence),
  );
  if (bySequence.length > 0) {
    return {
      candidate: bySequence.length === 1 ? (bySequence[0] as PrivateReplyCandidate) : null,
      reason: bySequence.length === 1 ? "sequence" : "ambiguous",
    };
  }
  if (sentBySelf && time !== null) {
    for (const window of TIME_WINDOWS) {
      const matches = compatible.filter((candidate) => Math.abs(candidate.timestamp - time) <= window);
      if (matches.length > 0) {
        const match = matches.length === 1 ? (matches[0] as PrivateReplyCandidate) : null;
        const windowCount = nearby.filter((candidate) => Math.abs(candidate.timestamp - time) <= window).length;
        const confirmed =
          match !== null &&
          (!text ||
            (match.preview !== null &&
              (windowCount === 1 || (match.preview.plain && match.preview.text === text))));
        return { candidate: confirmed ? match : null, reason: confirmed ? "time" : "ambiguous" };
      }
    }
  }
  return { candidate: null, reason: "missing" };
}

/**
 * The direction a stored row represents, for `recordPrivateRecall`.
 *
 * `true` (outgoing) only when the stored event's `post_type` says `message_sent`. A
 * row with no event body answers `false`, which is why a meta-only row can never be
 * matched — see the call site's note on `StoredMessageMeta` having no direction.
 */
function privateEventDirection(event: Record<string, unknown> | null): boolean {
  return event !== null && event["post_type"] === "message_sent";
}

/**
 * Reject a meta that could only produce a broken recall.
 *
 * The reference coerces with SQLite (`toInt$2`) on the way in, which turns a `NaN`
 * sequence into 0 and lets the row exist. Here a non-integer sequence or random is a
 * `TypeError` at insert, because the failure it would otherwise cause is a recall packet
 * for sequence 0 that the server rejects after burning a round trip — and the stack would
 * point at the recall, not at the bug. This is a port decision, recorded rather than
 * hidden: coercion and validation differ observably.
 */
function assertMeta(meta: StoredMessageMeta): void {
  const problems: string[] = [];
  if (typeof meta.isGroup !== "boolean") problems.push("isGroup must be a boolean");
  if (typeof meta.sequenceAuthoritative !== "boolean") problems.push("sequenceAuthoritative must be a boolean");
  for (const field of ["targetId", "sequence", "clientSequence", "random", "timestamp"] as const) {
    if (!Number.isInteger(meta[field])) problems.push(`${field} must be an integer`);
  }
  if (problems.length > 0) throw new TypeError(`invalid stored message meta: ${problems.join("; ")}`);
}

/**
 * Copy an event into the store, or out of it.
 *
 * `structuredClone` rather than `JSON.parse(JSON.stringify(...))`: the reference round-
 * trips through JSON only because its rows are text, and JSON silently drops `undefined`
 * members and throws on bigint. A stored OneBot event is decoded client data, so any
 * `Uint8Array` members must survive the copy.
 */
function cloneEvent(event: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(event);
}

function cloneMeta(meta: StoredMessageMeta): StoredMessageMeta {
  // Flat and all-primitive by declaration, so a spread is exact.
  return { ...meta };
}

function cloneMedia(media: readonly StoredMessageMedia[]): StoredMessageMedia[] {
  return media.map((snapshot) => structuredClone(snapshot));
}

export class MessageStore {
  readonly #entries = new Map<number, Entry>();
  /**
   * Private recall tombstones, keyed `sessionId:clientSequence:direction`.
   *
   * reference:41126 `private_recalls`. A Map rather than a table because this store has
   * no durability to lose — the reference's tombstones survive a restart and these do
   * not, which is the same trade the whole module makes (header, "No persistence").
   *
   * NOT bounded by `maxEntries`: a tombstone is three numbers, and evicting one
   * resurrects a message the user already watched disappear. The reference does not
   * evict them either. The growth is one entry per recalled message per process life,
   * bounded by how many recalls a session sees.
   */
  readonly #recallTombstones = new Map<string, number>();

  readonly #maxEntries: number;
  #evictions = 0;

  constructor(options: MessageStoreOptions = {}) {
    this.#maxEntries = normalizeMaxEntries(options.maxEntries);
  }

  /** The row bound this store was constructed with. */
  get maxEntries(): number {
    return this.#maxEntries;
  }

  /** Retained rows (event-only, meta-only and combined all count as one). */
  get size(): number {
    return this.#entries.size;
  }

  /** Rows dropped by the eviction policy since construction or the last `clear`. */
  get evictions(): number {
    return this.#evictions;
  }

  /**
   * Insert or update one row.
   *
   * Upsert semantics, matching the reference's `ON CONFLICT(message_hash)` clause: a
   * member present in `input` replaces the stored one; a member ABSENT from `input`
   * leaves the stored one alone. An explicit `null` CLEARS that member — different from
   * omitting it, and the difference is load-bearing for `media` (omit to keep the
   * snapshots an inbound conversion produced).
   *
   * Returns `false`, without throwing, for an invalid message id. A `false` answer means
   * "nothing was stored", never "stored but full": a successful insert may still evict a
   * DIFFERENT row, which `evictions` reports. Throws `TypeError` for an empty record or a
   * malformed meta — caller bugs, not runtime conditions.
   */
  insert(messageId: number, input: MessageRecordInput): boolean {
    const hasEvent = input.event !== undefined;
    const hasMeta = input.meta !== undefined;
    const hasMedia = input.media !== undefined;
    if (!hasEvent && !hasMeta && !hasMedia) {
      throw new TypeError("message record must carry at least one of event/meta/media");
    }
    if (input.meta !== undefined && input.meta !== null) assertMeta(input.meta);
    if (!isValidMessageId(messageId)) return false;

    let entry = this.#entries.get(messageId);
    if (entry === undefined) {
      entry = { event: null, meta: null, media: null };
      this.#entries.set(messageId, entry);
    }

    if (hasEvent) entry.event = input.event == null ? null : cloneEvent(input.event);
    if (hasMeta) entry.meta = input.meta == null ? null : cloneMeta(input.meta);
    if (hasMedia) entry.media = input.media == null ? null : cloneMedia(input.media);

    this.#touch(messageId, entry);
    this.#enforceBound();
    return true;
  }

  /**
   * The stored OneBot event, or null.
   *
   * A COPY, not the stored object. Two reasons: the store stays authoritative (a caller
   * that mutates a returned event — and `get_msg` DOES mutate it, via
   * `refreshMessageMedia` — cannot corrupt the row), and the reference has the same
   * property because it re-parses the stored JSON on every read. Consequence worth
   * knowing: a refreshed media URL lives only in the caller's copy.
   */
  get(messageId: number): Record<string, unknown> | null {
    const entry = this.#lookup(messageId);
    return entry === null || entry.event === null ? null : cloneEvent(entry.event);
  }

  /**
   * The recall metadata in the `ActionContext` shape, or null.
   *
   * Null for three distinct cases on purpose: unknown id, evicted id, and a row inserted
   * without `meta`. The third DIVERGES from the reference, which writes `sequence` and
   * `random` as zeroes on an event-only row and so answers with a non-null but useless
   * meta. Handing zeros to the recall path produces a request for sequence 0, which the
   * server can only reject after a wasted packet. Null makes `delete_msg` answer
   * `100 message not found or not retractable`, which is the truth.
   */
  getMeta(messageId: number): StoredMessageMeta | null {
    const entry = this.#lookup(messageId);
    return entry === null || entry.meta === null ? null : cloneMeta(entry.meta);
  }

  /**
   * Exactly what a recall call needs, or null.
   *
   * Use this — not `getMeta` — to drive `recallGroup` / `recallPrivate`: the union it
   * returns is shaped to their arguments, so the private case cannot accidentally lose
   * `clientSequence` or `timestamp`.
   *
   * Returns null when the row has no meta AND when the meta is not authoritative
   * (`hasAuthoritativeSequence`, message-id.ts:86 — `sequenceAuthoritative === true` and
   * a positive integer sequence). That gate is the recall path's own precondition
   * (message.ts:837 throws `message has no authoritative QQ sequence and cannot be
   * recalled`); folding it in here means no caller can skip it and send a request the
   * server must reject. `isRetractable(messageId)` answers the same predicate without
   * materialising the target.
   */
  getRecallMeta(messageId: number): RecallTarget | null {
    const entry = this.#lookup(messageId);
    if (entry === null || entry.meta === null) return null;
    const meta = entry.meta;
    if (!hasAuthoritativeSequence(meta)) return null;
    if (meta.isGroup) {
      return { kind: "group", groupId: meta.targetId, sequence: meta.sequence };
    }
    return {
      kind: "private",
      userId: meta.targetId,
      sequence: meta.sequence,
      clientSequence: meta.clientSequence,
      random: meta.random,
      timestamp: meta.timestamp,
    };
  }

  /** The media snapshots, or null. A copy, for the same reason as `get`. */
  getMedia(messageId: number): StoredMessageMedia[] | null {
    const entry = this.#lookup(messageId);
    return entry === null || entry.media === null ? null : cloneMedia(entry.media);
  }

  /**
   * The whole row, for a caller that needs event and meta together. Copies throughout.
   *
   * `messageId` is echoed rather than trusted from the key only, because
   * `get_msg` needs `real_id` and the reference derives it from the event when the event
   * has one, falling back to the requested id (context.ts:216).
   */
  getRecord(messageId: number): MessageRecord | null {
    const entry = this.#lookup(messageId);
    if (entry === null) return null;
    return {
      messageId,
      event: entry.event === null ? null : cloneEvent(entry.event),
      meta: entry.meta === null ? null : cloneMeta(entry.meta),
      media: entry.media === null ? null : cloneMedia(entry.media),
    };
  }

  /**
   * Replace the media snapshots for an existing id. Returns false when the id is absent.
   *
   * Refusing to create a row: media for a message that does not exist would be a row
   * `get` can never satisfy, and the reference's media write is an upsert on the same
   * primary key for exactly that reason. Pass `null` to clear the snapshots while keeping
   * the event and the meta.
   */
  updateMedia(messageId: number, media: readonly StoredMessageMedia[] | null): boolean {
    // `#lookup` already marked the row as used; re-touching here would be a no-op.
    const entry = this.#lookup(messageId);
    if (entry === null) return false;
    entry.media = media === null ? null : cloneMedia(media);
    return true;
  }

  /**
   * Drop one local row. Returns false when there was nothing to drop.
   *
   * LOCAL ONLY — it does not recall anything from QQ. See the header, and
   * `getRecallMeta` for the target a real recall needs.
   */
  delete(messageId: number): boolean {
    return this.#entries.delete(messageId);
  }

  /** True when a row exists, whether or not it carries an event or a meta. */
  has(messageId: number): boolean {
    return this.#entries.has(messageId);
  }

  // -------------------------------------------------------------------------
  // Session index — the reads the history actions are built on
  // -------------------------------------------------------------------------
  //
  // The reference's `listSessionEvents` / `findLatestAuthoritativeSequence` are two
  // SQL queries over a `messages` table indexed on `(is_group, session_id, sequence)`
  // (reference:40827). This store is a `Map` keyed by message id, so both are a
  // LINEAR SCAN. That is a real difference — O(n) per call against SQLite's index —
  // and it is stated rather than hidden, because the bound is `maxEntries` (512 by
  // default) and the alternative is a second index that has to be kept in sync with
  // every `insert`/`delete`/`updateMedia`/eviction path.
  //
  // The predicated rows below MIRROR the reference's SQL `WHERE` clauses field for
  // field, including the `sequence_authoritative = 1 AND sequence > 0` filter. It is
  // not "have a sequence": a fallback sequence is not addressable, and returning it
  // would make a history walk anchor on a number QQ will reject. A row that has an
  // event but no meta is therefore invisible to both readers, exactly as it is to
  // SQLite (where `sequence` is `NULL` and `sequence > 0` is false).

  /**
   * Rows of one conversation whose data body is present, in sequence order.
   *
   * reference:41066 `listSessionEvents`. The four shapes are the reference's four
   * statements:
   *
   *   anchored  + reverse ⇒ `sequence <= anchor`, newest first, then REVERSED
   *   anchored  + forward ⇒ `sequence >= anchor`, oldest first
   *   unanchored         ⇒ newest `count`, then reversed
   *
   * The final `reverse()` is the reference's own (L41078): every statement is
   * `ORDER BY sequence DESC` and every caller wants ascending, so a forward walk
   * that skipped the reverse would return the page newest-last *and* feed the next
   * cursor the wrong end.
   */
  listSessionEvents(
    isGroup: boolean,
    sessionId: number,
    count = 20,
    anchorSequence?: number | null,
    reverseOrder = true,
  ): Record<string, unknown>[] {
    if (!Number.isInteger(sessionId) || sessionId <= 0) return [];
    const limit = normalizePositiveInt(count, 20, 200);
    const hasAnchor = Number.isInteger(anchorSequence) && (anchorSequence as number) > 0;
    const anchor = hasAnchor ? (anchorSequence as number) : 0;
    const rows: { sequence: number; event: Record<string, unknown> }[] = [];
    for (const entry of this.#entries.values()) {
      // `data IS NOT NULL` — a meta-only row has no event body to return.
      if (entry.event === null || entry.meta === null) continue;
      const meta = entry.meta;
      if (meta.isGroup !== isGroup || meta.targetId !== sessionId) continue;
      if (!hasAuthoritativeSequence(meta)) continue;
      if (hasAnchor) {
        if (reverseOrder ? meta.sequence > anchor : meta.sequence < anchor) continue;
      }
      rows.push({ sequence: meta.sequence, event: entry.event });
    }
    // Every SQL statement is `ORDER BY sequence DESC`, then the reference reverses.
    rows.sort((left, right) => right.sequence - left.sequence);
    const page = rows.slice(0, limit);
    const result = page.map((row) => cloneEvent(row.event));
    if (!hasAnchor || reverseOrder) result.reverse();
    return result;
  }

  /**
   * The newest authoritative sequence of one conversation, or null.
   *
   * reference:41090 `findLatestAuthoritativeSequence`. A `null` answer means "nothing
   * in this session has a sequence QQ will accept as a cursor", which is the
   * unanchored-history bootstrap's failure mode — not "sequence 0".
   */
  findLatestAuthoritativeSequence(isGroup: boolean, sessionId: number): number | null {
    if (!Number.isInteger(sessionId) || sessionId <= 0) return null;
    let best: number | null = null;
    for (const entry of this.#entries.values()) {
      if (entry.meta === null) continue;
      const meta = entry.meta;
      if (meta.isGroup !== isGroup || meta.targetId !== sessionId) continue;
      if (!hasAuthoritativeSequence(meta)) continue;
      if (best === null || meta.sequence > best) best = meta.sequence;
    }
    return best;
  }

  /**
   * True when a private recall tombstone covers `messageTime`.
   *
   * reference:41135 `isPrivateMessageRecalled`. The reference keeps a tombstone table
   * (`session_id, client_sequence, direction, recalled_at`) so a recall seen once keeps
   * suppressing the message from every later roam page: the wire recall notice carries
   * the sender-local client sequence, and a re-fetch of the same window would otherwise
   * resurrect a message the user already saw disappear.
   *
   * `recordPrivateRecall` is the writer. Both are keyed the same three ways and the
   * comparison is `recalled_at >= messageTime` — a LATER recall does not un-recall an
   * older message, and a recall at exactly the message's timestamp does.
   */
  isPrivateMessageRecalled(
    sessionId: number,
    clientSequence: number,
    sentBySelf: boolean,
    messageTime: number,
  ): boolean {
    validatePrivateRecallKey(sessionId, clientSequence, messageTime, "message time");
    const recalledAt = this.#recallTombstones.get(privateRecallKey(sessionId, clientSequence, sentBySelf));
    return recalledAt !== undefined && recalledAt >= messageTime;
  }

  /**
   * Record a recall tombstone and return the message id it evicted, or null.
   *
   * reference:41117 `recordPrivateRecall`. The tombstone is written BEFORE the lookup
   * (the reference upserts and *then* selects, L41126-41129), so a recall for a message
   * this store never saw still suppresses a later fetch. Returns the dropped id so a
   * caller can log the association; `null` means "recorded, nothing to drop".
   */
  recordPrivateRecall(
    sessionId: number,
    clientSequence: number,
    recalledBySelf: boolean,
    recalledAt: number,
  ): number | null {
    validatePrivateRecallKey(sessionId, clientSequence, recalledAt);
    const key = privateRecallKey(sessionId, clientSequence, recalledBySelf);
    // reference:40890 `DO UPDATE SET recalled_at = MAX(existing, excluded)` — a
    // re-recorded recall must never move its timestamp EARLIER, or a message the
    // tombstone already suppressed at a later time would come back.
    const previous = this.#recallTombstones.get(key);
    this.#recallTombstones.set(key, previous === undefined ? recalledAt : Math.max(previous, recalledAt));
    // reference:40865 `stmtFindPrivateRecall` —
    //   WHERE is_group = 0 AND session_id = ? AND client_sequence = ?
    //     AND private_direction = ? AND timestamp <= ?
    //   ORDER BY timestamp DESC, sequence DESC LIMIT 1
    // The `timestamp <=` half is load-bearing: a recall cannot remove a message that
    // happened AFTER it. `<= recalledAt` is therefore applied, and the winner is the
    // newest row rather than the first one the scan reached, because a Map iteration
    // order is insertion/recency order and has nothing to do with time.
    let winner: { messageId: number; timestamp: number; sequence: number } | null = null;
    for (const [messageId, entry] of this.#entries) {
      if (entry.meta === null) continue;
      const meta = entry.meta;
      if (meta.isGroup || meta.targetId !== sessionId) continue;
      if (meta.clientSequence !== clientSequence) continue;
      if (meta.timestamp > recalledAt) continue;
      // The direction is part of the identity, exactly as in the reference's
      // `private_direction` column: the same client sequence can be reused in the
      // opposite direction after a client restart.
      //
      // ⚠️ THIS PORT'S `StoredMessageMeta` HAS NO DIRECTION FIELD. The reference reads
      // the column (reference:41017); the port's type (context.ts:1247) does not carry
      // one, so the direction is read off the stored event's `post_type` — the same
      // substitution the reference itself makes in `persistHistoryEvent` when it has no
      // source event (L37758 `privateMessageEventName(event.post_type === "message_sent",
      // false)`). Consequence, stated rather than hidden: a META-ONLY row (no event body)
      // has no direction and is never matched, so its id survives the recall and only the
      // tombstone suppresses it. `isPrivateMessageRecalled` still answers `true` for it
      // on every later history page, which is the outcome the user sees.
      if (privateEventDirection(entry.event) !== recalledBySelf) continue;
      if (
        winner === null ||
        meta.timestamp > winner.timestamp ||
        (meta.timestamp === winner.timestamp && meta.sequence > winner.sequence)
      ) {
        winner = { messageId, timestamp: meta.timestamp, sequence: meta.sequence };
      }
    }
    if (winner === null) return null;
    this.#entries.delete(winner.messageId);
    return winner.messageId;
  }

  /**
   * Resolve a sender-local C2C sequence to the stored OneBot id.
   *
   * reference:41035 `findPrivateMessageId`. Direction and timestamp are part of the key
   * because QQ can reuse the same client sequence in the opposite direction and after a
   * client restart — `atOrBefore` (the recall's own time) bounds which reuse is meant.
   *
   * Returns `null` for "no row", never `0`: a caller that treated 0 as an id would
   * name the message OneBot reserves for "invalid".
   */
  findPrivateMessageId(
    sessionId: number,
    clientSequence: number,
    sentBySelf: boolean,
    atOrBefore?: number,
  ): number | null {
    const upperTimestamp = atOrBefore === undefined ? Number.MAX_SAFE_INTEGER : atOrBefore;
    validatePrivateRecallKey(sessionId, clientSequence, upperTimestamp, "message lookup time");
    let winner: { messageId: number; timestamp: number; sequence: number } | null = null;
    for (const [messageId, entry] of this.#entries) {
      if (entry.meta === null) continue;
      const meta = entry.meta;
      if (meta.isGroup || meta.targetId !== sessionId) continue;
      if (meta.clientSequence !== clientSequence) continue;
      if (meta.timestamp > upperTimestamp) continue;
      if (privateEventDirection(entry.event) !== sentBySelf) continue;
      if (
        winner === null ||
        meta.timestamp > winner.timestamp ||
        (meta.timestamp === winner.timestamp && meta.sequence > winner.sequence)
      ) {
        if (!isValidMessageId(messageId)) {
          throw new Error(`private message lookup matched invalid message id ${String(messageId)}`);
        }
        winner = { messageId, timestamp: meta.timestamp, sequence: meta.sequence };
      }
    }
    return winner === null ? null : winner.messageId;
  }

  /**
   * Resolve a quote's sender-local sequence to the stored OneBot id.
   *
   * reference:41049 `resolvePrivateReplyMessageId`. **Independent of
   * `findPrivateMessageId`** (L41048: "a reused sequence is not an identity") — a reply
   * lookup must survive the sequence being reused, so it also matches on the quoted
   * text when the caller supplied segments.
   *
   * The search widens in the reference's own order, and each stage exists for a
   * different reason:
   *
   *   1. same sequence within ±30s of the quote's timestamp (`stmtFindPrivateReplyBySequence`);
   *   2. **only when nothing was found and nothing was ambiguous**, and only when the
   *      quote was sent by the bot, the same ±30s window ignoring the sequence
   *      (`stmtFindPrivateReplyByTime`).
   *
   * Stage 2 is skipped on "ambiguous" on purpose: a tie in stage 1 is a real
   * ambiguity, and widening the net would turn a refusal into a guess.
   *
   * `selectPrivateQuote` (reference:37826) is ported as {@link privateQuoteSelection},
   * with one omission stated there: `excludedMessage` is not threaded through.
   */
  resolvePrivateReplyMessageId(
    sessionId: number,
    replySequence: number,
    sentBySelf: boolean,
    timestamp: number,
    replyElements?: readonly { type?: unknown; text?: unknown }[] | undefined,
    _excludedMessage?: unknown,
  ): number | null {
    const hasTime = isUsableQuoteTime(timestamp);
    const lower = hasTime ? timestamp - 30 : 0;
    const upper = hasTime ? timestamp + 30 : Number.MAX_SAFE_INTEGER;
    const text = quoteText(replyElements);
    const bySequence: PrivateReplyCandidate[] = [];
    const seen = new Set<number>();
    for (const [messageId, entry] of this.#entries) {
      if (entry.meta === null) continue;
      const meta = entry.meta;
      if (meta.isGroup || meta.targetId !== sessionId) continue;
      if (privateEventDirection(entry.event) !== sentBySelf) continue;
      if (meta.timestamp < lower || meta.timestamp > upper) continue;
      // reference:40871 `UNION` of two predicates —
      //   client_sequence = ?                        (any authoritative state)
      //   sequence = ? AND sequence_authoritative = 1 (the NT namespace)
      // `UNION` rather than `UNION ALL` DEDUPES, so a row matching both is one
      // candidate; a row matching both would otherwise look like an ambiguity and be
      // refused as "multiple pending candidates".
      const matchesClientSequence = meta.clientSequence === replySequence;
      const matchesAuthoritativeSequence =
        hasAuthoritativeSequence(meta) && meta.sequence === replySequence;
      if (!matchesClientSequence && !matchesAuthoritativeSequence) continue;
      if (seen.has(messageId)) continue;
      seen.add(messageId);
      bySequence.push(privateReplyCandidate(messageId, meta, entry.event));
    }
    let selected = privateQuoteSelection(bySequence, replySequence, sentBySelf, timestamp, text);
    if (selected.candidate === null && selected.reason !== "ambiguous" && sentBySelf && hasTime) {
      const byTime: PrivateReplyCandidate[] = [];
      for (const [messageId, entry] of this.#entries) {
        if (entry.meta === null) continue;
        const meta = entry.meta;
        if (meta.isGroup || meta.targetId !== sessionId) continue;
        if (privateEventDirection(entry.event) !== true) continue;
        if (meta.timestamp < lower || meta.timestamp > upper) continue;
        byTime.push(privateReplyCandidate(messageId, meta, entry.event));
      }
      selected = privateQuoteSelection(byTime, replySequence, sentBySelf, timestamp, text);
    }
    log.debug(
      "private quote lookup: peer=%d seq=%d outgoing=%s time=%s result=%s messageId=%s",
      sessionId,
      replySequence,
      String(sentBySelf),
      String(timestamp),
      selected.reason,
      selected.candidate === null ? "unknown" : String(selected.candidate.id),
    );
    return selected.candidate === null ? null : selected.candidate.id;
  }

  /**
   * True when the stored metadata can be handed to a recall.
   *
   * Delegates to `hasAuthoritativeSequence` (message-id.ts:86), the predicate the recall,
   * reaction and essence paths all use, so "authoritative" has one definition in the port
   * instead of a second, drifting one.
   *
   * Deliberately does NOT touch recency: it is a predicate a caller may probe while
   * deciding what to do, and letting a probe extend a row's life would make eviction
   * depend on inspection rather than on use. Use `getRecallMeta` when the row is genuinely
   * being acted on.
   */
  isRetractable(messageId: number): boolean {
    const entry = this.#entries.get(messageId);
    return entry !== undefined && entry.meta !== null && hasAuthoritativeSequence(entry.meta);
  }

  /**
   * Persist a converted server-history event WITHOUT dispatching it.
   *
   * reference:40980 `storeHistoryEvent` = `storeMeta` + `storeEvent` in one
   * transaction. The pairing is the point: a history row must never leave an
   * authoritative sequence beside a missing body, because the login-sync cursor would
   * then skip a message whose text was never stored.
   *
   * Two refusals, both the reference's:
   *   * an id that is not a non-zero integer → `false` (`isValidMessageId`), the same
   *     answer `insert` gives;
   *   * a private row whose recall tombstone already covers it → `false`, and the row
   *     is DELETED if present. That check is `storeEvent`'s own (reference:40913), and
   *     it is what stops a re-fetched page from resurrecting a recalled message — the
   *     mirror image of `isPrivateMessageRecalled`, which is what the history *read*
   *     path uses.
   *
   * `meta` is optional: a caller that only has the event body (a group page, where the
   * sequence is unambiguous) may omit it and the row keeps whatever meta it had, which
   * is `insert`'s upsert semantics — an omitted member leaves the stored one alone.
   */
  storeHistoryEvent(
    messageId: number,
    isGroup: boolean,
    sessionId: number,
    sequence: number,
    eventName: string,
    event: Record<string, unknown>,
    options: { sequenceAuthoritative?: boolean | undefined; meta?: StoredMessageMeta | undefined } = {},
  ): boolean {
    if (!isValidMessageId(messageId)) return false;
    // reference:40908 `eventPrivateDirection` — only a genuine incoming/outgoing
    // FRIEND message is directional. A group event, a temp (sub_type "group") private
    // event and a notice all answer -1, and -1 means "no tombstone check".
    const direction = eventPrivateDirection(isGroup, event);
    if (direction >= 0) {
      const existing = this.getMeta(messageId);
      const eventClientSequence = toHistoryInt(event["message_seq"]);
      const clientSequence =
        existing !== null && existing.clientSequence > 0 ? existing.clientSequence : eventClientSequence;
      const timestamp = toHistoryInt(event["time"]);
      if (clientSequence > 0 && this.isPrivateMessageRecalled(sessionId, clientSequence, direction === 1, timestamp)) {
        this.delete(messageId);
        log.debug(
          "suppressed recalled private event: peer=%d clientSeq=%d self=%s messageId=%d",
          sessionId,
          clientSequence,
          String(direction === 1),
          messageId,
        );
        return false;
      }
    }
    if (options.meta !== undefined) {
      return this.insert(messageId, { event, meta: options.meta });
    }
    return this.insert(messageId, { event });
  }

  /**
   * Every conversation this store has seen, split into groups and private peers.
   *
   * The reference reads this out of a `messages` table indexed by `(is_group, session_id)`
   * (index.mjs:41149-41179). This store keeps no such index — it is keyed by message id and
   * deliberately volatile — so the same fact is derived by scanning the rows it does hold.
   * A row contributes only when its metadata carries an authoritative sequence, because that
   * is the predicate the rest of the store uses to decide a row is addressable at all; a row
   * without one names no conversation a caller could act on.
   *
   * `currentGroupIds` is validated, not merely accepted: the reference throws on a
   * non-positive or non-integer id (`current group list contains invalid group id`), and
   * silently dropping one would make a caller believe it had marked a group as read when it
   * had not. Duplicates collapse, preserving first-seen order.
   *
   * The returned group list is the caller's own list — this store cannot invent groups it has
   * never seen — while the private list is derived from the rows.
   */
  listReadSessions(currentGroupIds: readonly number[]): {
    groupIds: number[];
    privateUserIds: number[];
  } {
    const groupIds: number[] = [];
    const seenGroups = new Set<number>();
    for (const groupId of currentGroupIds) {
      if (!Number.isSafeInteger(groupId) || groupId <= 0) {
        throw new Error(`current group list contains invalid group id ${String(groupId)}`);
      }
      if (seenGroups.has(groupId)) continue;
      seenGroups.add(groupId);
      groupIds.push(groupId);
    }

    const privateUserIds: number[] = [];
    const seenPrivate = new Set<number>();
    for (const entry of this.#entries.values()) {
      const meta = entry.meta;
      if (meta === null || !hasAuthoritativeSequence(meta)) continue;
      // Only a private conversation contributes here; a group row is covered by the caller's
      // own list, and including it would report a "private" session with a group's number.
      if (meta.isGroup) continue;
      const sessionId = meta.targetId;
      if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
        throw new Error(`messages database contains invalid session id ${String(sessionId)}`);
      }
      if (seenPrivate.has(sessionId)) continue;
      seenPrivate.add(sessionId);
      privateUserIds.push(sessionId);
    }
    return { groupIds, privateUserIds };
  }

  /** Drop every row and reset `evictions`. There is nothing else to reset. */
  clear(): void {
    this.#entries.clear();
    this.#recallTombstones.clear();
    this.#evictions = 0;
  }

  /** Look up and mark as most recently used. */
  #lookup(messageId: number): Entry | null {
    if (!isValidMessageId(messageId)) return null;
    const entry = this.#entries.get(messageId);
    if (entry === undefined) return null;
    this.#touch(messageId, entry);
    return entry;
  }

  /**
   * Move `messageId` to the most-recently-used end.
   *
   * The re-insertion is what keeps the map's iteration order equal to recency order;
   * without it eviction would be FIFO, and a hot id would be dropped while a one-shot id
   * stayed.
   */
  #touch(messageId: number, entry: Entry): void {
    this.#entries.delete(messageId);
    this.#entries.set(messageId, entry);
  }

  #enforceBound(): void {
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) return;
      this.#entries.delete(oldest.value);
      this.#evictions += 1;
    }
  }
}