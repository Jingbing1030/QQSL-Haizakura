// `get_group_msg_history` / `get_friend_msg_history`, and the message-id resolver.
//
// Reference regions:
//   ../onebot/src/modules/message-actions.ts
//     getGroupMsgHistory            reference/index.mjs:37950
//     getFriendMsgHistory           reference/index.mjs:37966
//     getGroupHistory               reference/index.mjs:37987
//     getFriendHistory              reference/index.mjs:38026
//     normalizeHistoryCount         reference/index.mjs:38751
//     sanitizeMessageEventForApi    reference/index.mjs:38758
//   ../onebot/src/message-media.ts + message-actions.ts
//     persistHistoryEvent           reference/index.mjs:37745
//   ../onebot/src/message-id-resolver.ts
//     createMessageIdResolver       reference/index.mjs:41254
//
// ===========================================================================
// Why these live in `host/` and not in `bridge/event-converters.ts`
// ===========================================================================
// `bridge/event-converters.ts` is a PURE translation layer: a decoded event in, an
// OneBot object out, no I/O and no state. Everything here needs both a transport
// (`apis.message.getGroupHistory` sends `SsoGetGroupMsg`) and the message table
// (`findMeta` turns an anchor `message_id` back into a QQ sequence). Folding either
// into the converter would make the converter untestable without a bridge.
//
// This is also the exact split the reference makes: `convertEvent` lives in
// `onebot/src/event-converter/index.ts`, while `getGroupHistory` lives in
// `onebot/src/modules/message-actions.ts` and takes the whole `ref`.
//
// ===========================================================================
// The two-tier design, and why a server failure is not an error
// ===========================================================================
// Both history readers try the SERVER first and fall back to the LOCAL store:
//
//   getGroupHistory ──► apis.message.getGroupHistory ──convertEvent──► rows
//        │                                                    ▲
//        └── anchor, count, page ─────────────────────────────┘
//        │ (throw / empty page)
//        └──► getGroupMsgHistory ► store.listSessionEvents ► stored rows
//
// The fallback is NOT laziness. The local store holds messages this process OBSERVED;
// the server holds the group's whole history. So:
//
//   * a server success returns messages nobody ever saw live — and each is persisted
//     on the way out, which is what makes a later `get_msg`/reply on an old message
//     work at all;
//   * a server failure still answers with what is known, because "the history service
//     is unavailable" and "this conversation is empty" must not both be `[]` with no
//     way to tell them apart — the reference logs the difference and returns the local
//     page.
//
// `getFriendHistory` DIVERGES deliberately (its own header, reference:38022: "Server
// and UID failures are surfaced instead of returning a partial local conversation as
// a successful response"). An unresolvable peer uid throws. The reason is asymmetric
// risk: a group's local page is a subset of the truth, while a private conversation
// returned from a stale local cache can contain messages the peer has recalled.

import { convertEvent, type ConverterContext } from "../bridge/event-converters.js";
import {
  GROUP_MESSAGE_EVENT,
  PRIVATE_MESSAGE_EVENT,
  PRIVATE_NT_MESSAGE_EVENT,
  PRIVATE_SENT_MESSAGE_EVENT,
  hashMessageIdInt32,
  privateMessageEventName,
} from "../onebot/actions/message-id.js";
import type { MessageStore } from "./message-store.js";
import type { StoredMessageMeta } from "../onebot/actions/context.js";
import type { MsgPushEvent } from "../msg-push.js";
import { createLogger } from "../onebot/log.js";

const log = createLogger("Host.History");

/** The message table, narrowed to what the history readers call. */
export type HistoryStore = Pick<
  MessageStore,
  | "getMeta"
  | "get"
  | "listSessionEvents"
  | "findLatestAuthoritativeSequence"
  | "storeHistoryEvent"
  | "isPrivateMessageRecalled"
>;

/** The two fetchers `apis.message` provides for history. */
export interface HistoryMessageApi {
  getGroupHistory(
    groupUin: number,
    anchorSeq: number,
    count: number,
    selfUin?: number,
    reverseOrder?: boolean,
  ): Promise<readonly MsgPushEvent[]>;
  getC2cHistory(
    friendUid: string,
    anchorSeq: number,
    count: number,
    selfUin?: number,
    reverseOrder?: boolean,
  ): Promise<readonly MsgPushEvent[]>;
  getC2cLatestHistory(
    friendUid: string,
    count: number,
    selfUin?: number,
    beforeTime?: number,
  ): Promise<readonly MsgPushEvent[]>;
}

/** What a history reader needs from the session. */
export interface HistoryContext {
  selfId: number;
  store: HistoryStore;
  messageApi: HistoryMessageApi;
  converterCtx: ConverterContext;
  /** `bridge.resolveUserUid` — the uid the c2c fetchers are keyed by. */
  resolveUserUid(userId: number): Promise<string>;
}

// ===========================================================================
// The message-id resolver
// ===========================================================================

/**
 * reference:41254 `createMessageIdResolver`.
 *
 * The rule is a three-way split, and each arm exists because a different lookup is
 * possible:
 *
 *   * a GROUP message ids by its server sequence — always hashable, nothing to look up;
 *   * a RECEIVED private message may have its client sequence reused, so it goes
 *     through `resolvePrivateReplyMessageId` (the store's ±30s + preview match) and
 *     falls back to 0 when the store has never seen it;
 *   * a private message the BOT sent with a canonical NT sequence is hashed under
 *     `PRIVATE_NT_MESSAGE_EVENT`, NOT `private_message_sent` — the last line of the
 *     reference's function. Without that remap the same outgoing message hashes to one
 *     id on send and a different id on the echo, and a bot that replies to its own
 *     message addresses nothing.
 *
 * `eventName || default` (L41256) is the reference's own coercion: an empty-string
 * event name means "caller did not decide", and guessing the other way would silently
 * change every id a caller passing `""` produced.
 */
export function createMessageIdResolver(store: {
  resolvePrivateReplyMessageId(
    sessionId: number,
    replySequence: number,
    sentBySelf: boolean,
    timestamp: number,
    replyElements?: readonly unknown[] | undefined,
    excludedMessage?: unknown,
  ): number | null;
}): NonNullable<ConverterContext["messageIdResolver"]> {
  return (isGroup, sessionId, sequence, eventName, timestamp, replyElements, excludedMessage) => {
    const resolvedEventName = eventName || (isGroup ? GROUP_MESSAGE_EVENT : PRIVATE_MESSAGE_EVENT);
    if (
      !isGroup &&
      timestamp !== undefined &&
      (resolvedEventName === PRIVATE_MESSAGE_EVENT || resolvedEventName === PRIVATE_SENT_MESSAGE_EVENT)
    ) {
      return (
        store.resolvePrivateReplyMessageId(
          sessionId,
          sequence,
          resolvedEventName === PRIVATE_SENT_MESSAGE_EVENT,
          timestamp,
          replyElements,
          excludedMessage,
        ) ?? 0
      );
    }
    return hashMessageIdInt32(
      sequence,
      sessionId,
      resolvedEventName === PRIVATE_SENT_MESSAGE_EVENT ? PRIVATE_NT_MESSAGE_EVENT : resolvedEventName,
    );
  };
}

// ===========================================================================
// The two shared helpers
// ===========================================================================

/**
 * reference:38751 `normalizeHistoryCount`.
 *
 * Non-finite and non-positive BOTH become 20, and 200 is the ceiling — the server
 * rejects a larger page, so clamping is what keeps `count: 1e9` from costing a
 * round-trip.
 */
export function normalizeHistoryCount(count: number): number {
  if (!Number.isFinite(count)) return 20;
  const n = Math.trunc(count);
  if (n <= 0) return 20;
  if (n > 200) return 200;
  return n;
}

/**
 * reference:38758 `sanitizeMessageEventForApi`.
 *
 * `post_type` and `self_id` are DELETED: a history row is not a push, and a client
 * that branches on `post_type` would treat a fetched page as an inbound event. The
 * real id is then echoed as `real_id` before `message_id` is left alone.
 *
 * Returns a SHALLOW copy — the reference's `{...event}` is too — so the caller's
 * object is never mutated. The nested `message` array IS shared; a caller that edits
 * segments edits the stored row's segments, which is why `MessageStore.get` hands out
 * a fresh copy per call.
 */
export function sanitizeMessageEventForApi(event: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...event };
  delete result["post_type"];
  delete result["self_id"];
  result["real_id"] = result["message_id"] ?? 0;
  return result;
}

/** reference:6907 `hasAuthoritativeSequence`, re-exported so this file has one source. */
function hasAuthoritativeSequence(
  meta: StoredMessageMeta | null | undefined,
): meta is StoredMessageMeta & { sequence: number } {
  return (
    meta !== null &&
    meta !== undefined &&
    meta.sequenceAuthoritative === true &&
    Number.isInteger(meta.sequence) &&
    meta.sequence > 0
  );
}

/** reference:37774 `toHistoryInt`. */
function toHistoryInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return 0;
}

/**
 * reference:37745 `persistHistoryEvent` — store a converted event WITHOUT dispatching.
 *
 * Dispatching a history row would make every `get_group_msg_history` call look like
 * live traffic arriving, and a bot would reply to its own backfill.
 *
 * `privatePeerId` exists because a private event's `user_id` names the SENDER, which
 * on an outgoing message is the bot — so the conversation cannot be found from the
 * event alone. `source` (the decoded push) supplies the two facts the OneBot event
 * does not carry: the canonical NT sequence, and whether sequences are authoritative.
 *
 * Throws rather than returning false on a bad id/sequence/type: those are
 * `convertEvent` output invariant violations, and persisting a row nothing can
 * address is how a store accumulates garbage.
 */
export async function persistHistoryEvent(
  store: HistoryStore,
  event: Record<string, unknown>,
  privatePeerId?: number,
  source?: MsgPushEvent,
): Promise<boolean> {
  const messageId = toHistoryInt(event["message_id"]);
  if (!Number.isSafeInteger(messageId) || messageId === 0) {
    throw new Error(`history event has invalid message_id ${String(event["message_id"])}`);
  }
  const messageType = event["message_type"];
  if (messageType !== "group" && messageType !== "private") {
    throw new Error(`history event has invalid message_type ${String(messageType)}`);
  }
  const isGroup = messageType === "group";
  const sessionId = isGroup
    ? toHistoryInt(event["group_id"])
    : privatePeerId && privatePeerId > 0
      ? privatePeerId
      : toHistoryInt(event["user_id"]);
  const messageSequence = toHistoryInt(event["message_seq"]);
  // reference:37750 `source?.ntMsgSeq ?? messageSequence` — the SOURCE wins for ANY
  // kind that carries one, not only `friend_message`. A temp message carries an
  // `ntMsgSeq` too, so restricting this to friend messages would file it under the
  // group sequence QQ never assigned it. The defensive read covers the kinds with no
  // such field at all (`group_recall`, `bot_offline`, …), where it is absent and
  // `??` falls through exactly as the reference's optional chain does.
  const sourceNtMsgSeq = (source as { ntMsgSeq?: number } | undefined)?.ntMsgSeq;
  const sequence = sourceNtMsgSeq ?? messageSequence;
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    throw new Error(`history event has invalid session id ${String(sessionId)}`);
  }
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error(`history event has invalid sequence ${String(sequence)}`);
  }
  // reference:37755 `source?.sequenceAuthoritative !== false && sequence > 0` — again
  // ANY source, and the `!== false` means "absent counts as authoritative", which is
  // the opposite of the default a `=== true` test would produce.
  const sequenceAuthoritative =
    (source as { sequenceAuthoritative?: boolean } | undefined)?.sequenceAuthoritative !== false &&
    sequence > 0;
  const sourceUins = source as { senderUin?: number; selfUin?: number } | undefined;
  const isOutgoingPrivate =
    !isGroup &&
    sourceUins !== undefined &&
    sourceUins.senderUin !== undefined &&
    sourceUins.senderUin === sourceUins.selfUin;
  const eventName = isGroup
    ? GROUP_MESSAGE_EVENT
    : source !== undefined
      ? privateMessageEventName(isOutgoingPrivate, sequenceAuthoritative)
      : privateMessageEventName(event["post_type"] === "message_sent", false);

  // The reference builds a `meta` ONLY for a private row with a source event
  // (L37761-37772); a group row is stored with no meta because its sequence came from
  // the event itself and is re-derived on read. Copying that asymmetry exactly.
  const meta =
    !isGroup && source !== undefined && sourceUins?.senderUin !== undefined
      ? {
          isGroup: false,
          targetId: sessionId,
          sequence,
          sequenceAuthoritative,
          eventName,
          // ⚠️ `StoredMessageMeta` (context.ts:1251) declares SEVEN fields and neither
          // `eventName` nor `privateDirection`, both of which the reference stores as
          // columns (reference:40943 passes `event_name` and `private_direction`). The
          // port derives the direction from the stored event's `post_type` instead — see
          // `privateEventDirection` in message-store.ts — so the history path matches the
          // recall path on the same substituted fact rather than on a field that does not
          // exist here.
          clientSequence:
            (source as { clientSeq?: number; msgSeq?: number }).clientSeq ??
            (source as { msgSeq?: number }).msgSeq ??
            0,
          random: (source as { msgId?: number }).msgId ?? 0,
          timestamp: source.time,
        }
      : undefined;
  return store.storeHistoryEvent(messageId, isGroup, sessionId, sequence, eventName, event, {
    sequenceAuthoritative,
    // `meta` is dropped for a group row: `storeHistoryEvent` keeps whatever meta the
    // row already has, which is the reference's upsert semantics.
    ...(meta === undefined ? {} : { meta }),
  });
}

// ===========================================================================
// Tier 2 — the local store
// ===========================================================================

/**
 * reference:37950 `getGroupMsgHistory` — the local-store page.
 *
 * Two filters after `listSessionEvents`, and both are the reference's:
 * `message_type === "group"` (a private row can share a session NUMBER with a group)
 * and `group_id === groupId` for the same reason.
 *
 * An anchor whose meta is missing, non-authoritative, or belongs to a different
 * conversation yields `[]` — NOT "fall back to unanchored". Returning the newest 20
 * messages for a request anchored on an unknown id would be a wrong answer that looks
 * right.
 */
export async function getGroupMsgHistoryFromStore(
  store: HistoryStore,
  groupId: number,
  messageId: number,
  count: number,
  reverseOrder = true,
): Promise<Record<string, unknown>[]> {
  if (!Number.isInteger(groupId) || groupId <= 0) return [];
  const limit = normalizeHistoryCount(count);
  const hasAnchor = Number.isInteger(messageId) && messageId !== 0;
  let anchorSequence: number | null | undefined;
  if (hasAnchor) {
    const meta = store.getMeta(messageId);
    if (!hasAuthoritativeSequence(meta) || !meta.isGroup || meta.targetId !== groupId) return [];
    anchorSequence = meta.sequence;
  }
  return store
    .listSessionEvents(true, groupId, limit, anchorSequence ?? null, reverseOrder)
    .filter((event) => {
      if (event["message_type"] !== "group") return false;
      const gid = Number(event["group_id"] ?? 0);
      return Number.isFinite(gid) && Math.trunc(gid) === groupId;
    })
    .map(sanitizeMessageEventForApi);
}

/** reference:37966 `getFriendMsgHistory` — the private twin. */
export async function getFriendMsgHistoryFromStore(
  store: HistoryStore,
  userId: number,
  messageId: number,
  count: number,
  reverseOrder = true,
): Promise<Record<string, unknown>[]> {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  const limit = normalizeHistoryCount(count);
  const hasAnchor = Number.isInteger(messageId) && messageId !== 0;
  let anchorSequence: number | null | undefined;
  if (hasAnchor) {
    const meta = store.getMeta(messageId);
    if (!hasAuthoritativeSequence(meta) || meta.isGroup || meta.targetId !== userId) return [];
    anchorSequence = meta.sequence;
  }
  return store
    .listSessionEvents(false, userId, limit, anchorSequence ?? null, reverseOrder)
    .filter((event) => event["message_type"] === "private")
    .map(sanitizeMessageEventForApi);
}

// ===========================================================================
// Tier 1 — the server
// ===========================================================================

/**
 * reference:37987 `getGroupHistory` — server fetch, with the local store as fallback.
 *
 * The anchor choice is the subtle part. With NO `message_id`, the reference takes the
 * newest LOCAL authoritative sequence rather than "now", because the point of the
 * call is to fill gaps below what was observed live; a fresh session with no rows
 * gets `anchorSeq = 0`, and the whole server branch is skipped.
 *
 * `effectiveReverseOrder` is forced to `true` when there is no anchor: walking
 * FORWARD from the newest known message has nothing newer to return, so an
 * unanchored `reverse_order: false` request would silently answer `[]`.
 *
 * An empty server page ALSO falls back. QQ returns an empty page for a group whose
 * history the account cannot page through, and treating "server said nothing" as
 * "there is nothing" would throw away messages this process already has.
 */
export async function getGroupHistory(
  ref: HistoryContext,
  groupId: number,
  messageId: number,
  count: number,
  reverseOrder = true,
): Promise<Record<string, unknown>[]> {
  if (!Number.isInteger(groupId) || groupId <= 0) return [];
  const want = normalizeHistoryCount(count);
  const hasAnchor = Number.isInteger(messageId) && messageId !== 0;
  const effectiveReverseOrder = hasAnchor ? reverseOrder : true;
  let anchorSeq = 0;
  if (hasAnchor) {
    const meta = ref.store.getMeta(messageId);
    if (!hasAuthoritativeSequence(meta) || !meta.isGroup || meta.targetId !== groupId) {
      return getGroupMsgHistoryFromStore(ref.store, groupId, messageId, count, reverseOrder);
    }
    anchorSeq = meta.sequence;
  } else {
    anchorSeq = ref.store.findLatestAuthoritativeSequence(true, groupId) ?? 0;
  }
  log.debug(
    "group history anchor selected: group=%d source=%s anchorSeq=%d",
    groupId,
    hasAnchor ? "message_id" : "latest_authoritative",
    anchorSeq,
  );
  if (anchorSeq > 0) {
    try {
      const events = await ref.messageApi.getGroupHistory(
        groupId,
        anchorSeq,
        want,
        ref.selfId,
        effectiveReverseOrder,
      );
      const out: Record<string, unknown>[] = [];
      for (const ev of events) {
        const json = await convertEvent(ref.converterCtx, ev);
        if (!json || json["message_type"] !== "group") continue;
        // ⚠️ NO `source` here, and that matches the reference exactly
        // (reference:38015 `await persistHistoryEvent(ref.messageStore, json)` — two
        // arguments). Consequence, stated rather than fixed: a group row is stored with
        // `source === undefined`, so `persistHistoryEvent` takes its
        // `privateMessageEventName(event.post_type === "message_sent", false)` branch for
        // the EVENT NAME — irrelevant for a group (the name is `GROUP_MESSAGE_EVENT`
        // unconditionally) — and builds NO `meta`, so `sequenceAuthoritative` comes from
        // `(undefined)?.sequenceAuthoritative !== false`, i.e. `true`. Passing `ev` here
        // would be "more correct" and would DIFFER from the reference: a group history row
        // would then carry a meta and a sequence derived from `ntMsgSeq`, changing which
        // rows a later anchored page can reach.
        await persistHistoryEvent(ref.store, json);
        out.push(sanitizeMessageEventForApi(json));
      }
      if (out.length > 0) return out;
      log.debug(
        "group history server fetch returned no usable messages: group=%d anchorSeq=%d count=%d; using local store",
        groupId,
        anchorSeq,
        want,
      );
    } catch (err) {
      log.warn(
        "group history server fetch failed: group=%d anchorSeq=%d count=%d reverseOrder=%s error=%s; using local store",
        groupId,
        anchorSeq,
        want,
        String(effectiveReverseOrder),
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return getGroupMsgHistoryFromStore(ref.store, groupId, messageId, count, reverseOrder);
}

/**
 * reference:38026 `getFriendHistory` — the private twin, with two real differences.
 *
  *  1. NO anchor without a `message_id`: an unanchored request goes to `SsoGetRoamMsg`
 *     (`getC2cLatestHistory`) instead, because a c2c field-5 sequence is SENDER-LOCAL —
 *     the peer's counter and the bot's own are different numbers, so one cannot
 *     bootstrap the other. A group sequence is conversation-wide and can.
 *  2. Failures THROW. The reference's own header: "Server and UID failures are
 *     surfaced instead of returning a partial local conversation as a successful
 *     response." The local store falls back only when an explicit `message_id` cannot
 *     supply a safe anchor.
 *
 * The anchor check is wider than the group one: a row whose `targetId` is the BOT is
 * accepted when the stored event's `target_id` names the peer. That is what a
 * self-sent echo looks like — `user_id` is the bot, `target_id` is the friend.
 */
export async function getFriendHistory(
  ref: HistoryContext,
  userId: number,
  messageId: number,
  count: number,
  reverseOrder = true,
): Promise<Record<string, unknown>[]> {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  const want = normalizeHistoryCount(count);
  const hasAnchor = Number.isInteger(messageId) && messageId !== 0;
  const effectiveReverseOrder = hasAnchor ? reverseOrder : true;
  let anchorSeq = 0;
  if (hasAnchor) {
    const meta = ref.store.getMeta(messageId);
    const storedEvent = meta?.targetId === ref.selfId ? ref.store.get(messageId) : null;
    const belongsToPeer =
      meta?.targetId === userId ||
      (meta?.targetId === ref.selfId && toHistoryInt(storedEvent?.["target_id"]) === userId);
    if (!hasAuthoritativeSequence(meta) || meta.isGroup || !belongsToPeer) {
      return getFriendMsgHistoryFromStore(ref.store, userId, messageId, count, reverseOrder);
    }
    anchorSeq = meta.sequence;
  }
  log.debug(
    "friend history source selected: user=%d source=%s anchorSeq=%d",
    userId,
    hasAnchor ? "message_id" : "roam",
    anchorSeq,
  );
  const friendUid = await ref.resolveUserUid(userId);
  if (!friendUid) throw new Error(`friend history cannot resolve uid for user ${userId}`);
  const events = hasAnchor
    ? await ref.messageApi.getC2cHistory(friendUid, anchorSeq, want, ref.selfId, effectiveReverseOrder)
    : await ref.messageApi.getC2cLatestHistory(friendUid, want, ref.selfId);
  const out: Record<string, unknown>[] = [];
  for (const ev of events) {
    // reference:38045-38047. These three reads are written WITHOUT a kind test, so they
    // are reproduced without one:
    //   * `peerUin` is filled from the REQUESTED user when the page omitted it — a roam
    //     page can carry a message with no peer, and `persistHistoryEvent` needs one to
    //     key the row;
    //   * `clientSeq ?? msgSeq` prefers the sender-local number the later recall notice
    //     will name;
    //   * `sentBySelf` is a plain equality, so an event whose `senderUin` is absent
    //     compares unequal and reads as incoming.
    // Narrowing these to `friend_message` would look tidier and would silently skip the
    // recall check for any event the decoder tags differently.
    const narrow = ev as { peerUin?: number; clientSeq?: number; msgSeq?: number; senderUin?: number };
    if (!narrow.peerUin || narrow.peerUin <= 0) narrow.peerUin = userId;
    const clientSequence = narrow.clientSeq ?? narrow.msgSeq ?? 0;
    const sentBySelf = narrow.senderUin === ref.selfId;
    const json = await convertEvent(ref.converterCtx, ev);
    if (!json || json["message_type"] !== "private") continue;
    if (ref.store.isPrivateMessageRecalled(userId, clientSequence, sentBySelf, ev.time)) {
      log.debug(
        "friend history omitted recalled message: user=%d clientSeq=%d self=%s",
        userId,
        clientSequence,
        String(sentBySelf),
      );
      continue;
    }
    // A self-sent echo with no `target_id` would be filed under the bot's own uin and
    // never found from the friend's conversation again.
    if (json["post_type"] === "message_sent" && toHistoryInt(json["target_id"]) === 0) {
      json["target_id"] = userId;
    }
    // `storeHistoryEvent` returns false (rather than throwing) when a recall tombstone
    // covers the row; the reference skips the message on that answer (L38053).
    if (await persistHistoryEvent(ref.store, json, userId, ev)) {
      out.push(sanitizeMessageEventForApi(json));
    }
  }
  log.debug(
    "friend history server fetch complete: user=%d source=%s anchorSeq=%d requested=%d returned=%d",
    userId,
    hasAnchor ? "message_id" : "roam",
    anchorSeq,
    want,
    out.length,
  );
  return out;
}
