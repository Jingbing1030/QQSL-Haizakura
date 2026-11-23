// `trpc.msg.olpush.OlPushService.MsgPush` — the recv-op6 → `MsgPushEvent[]` adapter.
//
// ---------------------------------------------------------------------------
// What this file proves, and what it does NOT prove
// ---------------------------------------------------------------------------
// **This proves decode only.** Every byte this module is exercised against in
// `ts/test/msg-push-pipeline.test.ts` is synthetic, assembled field-by-field from
// the field numbers named below. There is no real QQ capture behind it: a test
// that passes here says the envelope path, the dispatch table and the survival
// filter are wired correctly, NOT that a live OlPush frame from a real account
// decodes. Byte-level fidelity is argued from `reference/index.mjs` line numbers,
// not from traffic.
//
// ---------------------------------------------------------------------------
// The decode path, in the reference's own three steps
// ---------------------------------------------------------------------------
// reference/index.mjs:177190 `parseMsgPush` → L177196 `parseMsgPushInternal`:
//
//   1. `buildContext(pkt, identity)`      L143031
//        `protobuf_decode_PushMsg(pkt.body)` → `push.message`
//        → `buildContextFromMessage(push.message, selfUin, identity, false)`
//      (`false` = not historical; only the group-history fetchers pass `true`.)
//   2. `registry.decode(ctx)`             L153993 → `decodePush(ctx)` in `msg-push.ts`
//   3. per-event survival filter          L135905 `classifyMessageSurvival`
//
// **No protobuf schema is missing, so nothing is re-derived here.** The envelope
// decoder already exists as generated code: `ts/src/msg-push-fields.ts` exports
// `decodePushMsg` (`PUSH_MSG_FIELDS`, field 1 `message` = `PushMsgBody`,
// reference L136053) and `decodePushMsgBody`. Step 1 is reachable end-to-end as
// `buildContext`, which is the ported twin of the reference's L143031 function and
// already owns two policy details this file must not fork:
//
//   * `pkt.uin` is the account the frame arrived on, and a non-numeric value
//     degrades to `selfUin = 0` (L143035 — `parseInt` + `isNaN`), never `NaN`;
//   * an empty body, or a `PushMsg` without `message`, yields `null`.
//
// So this module deliberately does NOT open-code `decodePushMsg` +
// `buildContextFromMessage` a second time. Re-spelling field 1 here would create a
// second, silently divergent definition of the envelope, which is precisely the
// failure mode `msg-push-fields.ts`'s generated tables exist to prevent.
//
// ---------------------------------------------------------------------------
// What the reference does that this file does NOT do by default
// ---------------------------------------------------------------------------
//   * **SysMsg dedup is not applied by default.** L177174 `SysMsgDedup` /
//     L154080 `deriveSysMsgDedupIdentity` suppress duplicate system pushes using
//     QQ NT's own `{peerUid}_{chatType}_{msgSeq}_{random}` key, before the decoder
//     even runs. That logic IS ported — `bridge/sysmsg-dedup.ts` exports
//     `deriveSysMsgDedupIdentity`, `getNativeSysMsgChatType` and the
//     `SysMsgDedup` ring class. This module exposes the seam
//     (`MsgPushHandlerOptions.dedup` / the 4th arg of `decodeMsgPushPacket`) and
//     defaults to *off*; {@link withSysMsgDedup} is the one-call wiring. Off by
//     default because which `SysMsgDedup` instance a session owns is a
//     composition decision (state must outlive one packet, and must not leak
//     across accounts), and because a handler that silently dropped events by
//     default would make the decode tests unfalsifiable. Consequence, stated
//     plainly: registered without the seam, a duplicated system push (the same
//     0x2DC recall delivered twice) is reported twice, which is MORE than a real
//     QQ client shows.
//     dropped events by default would make the decode test above unfalsifiable.
//   * **`warnMissingC2cSequence`** (L177186) is cosmetic (a `log.warn` when a C2C
//     push carries no authoritative NT sequence) and is not emitted here.
//
// ---------------------------------------------------------------------------
// The one policy this file owns: a malformed body is a drop, not an exception
// ---------------------------------------------------------------------------
// Reference lets a `protobuf_decode_PushMsg` throw escape `parseMsgPush`; its
// `IncomingPacketPipeline` catches it in the per-parser `try` (L346909), logs
// "handler error", and dispatches nothing. `IncomingPacketPipeline` here does the
// same (packet-pipeline.ts:61-67). The observable event set is identical — `[]`
// — so returning `[]` from this handler does not change any outcome, it only moves
// the log line from the pipeline's `onError` to this module's logger, where the
// message can name the reason ("truncated varint" vs "no content head") instead of
// an anonymous handler failure. A packet body is untrusted input arriving from a
// process we do not control; making its noise indistinguishable from a handler
// bug is the thing worth avoiding.

import { IncomingPacketPipeline } from "./packet-pipeline.js";
import type { IncomingPacket, PacketHandler } from "./packet-pipeline.js";

import {
  EMPTY_IDENTITY,
  buildContext,
  decodePush,
  type Identity,
  type MessageSegment,
  type MsgPushEvent,
  type PushContext,
} from "../msg-push.js";
import { keepDecodedMessage } from "./apis/history-fetch.js";
import { deriveSysMsgDedupIdentity, type SysMsgDedup } from "./sysmsg-dedup.js";
import { createLogger } from "../onebot/log.js";

/** The wire command OlPush pushes ride on. reference/index.mjs:177164 `MSG_PUSH_CMD`. */
export const MSG_PUSH_CMD = "trpc.msg.olpush.OlPushService.MsgPush";

/** The logger surface this module needs — `debug` for drops, `warn` for decoder faults. */
export interface MsgPushPipelineLogger {
  debug(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
}

const defaultLogger: MsgPushPipelineLogger = createLogger("MsgPush");

export interface MsgPushHandlerOptions {
  /**
   * UID→UIN resolver used to fill `senderUin`/`operatorUin`/… on notices.
   *
   * Defaults to `EMPTY_IDENTITY`, which leaves every UID unresolved as `0` — the
   * reference's `resolveUidToUin` contract (L122224: a miss means unknown, never a
   * fabricated UIN). A `BridgeIdentity` from `context.ts` is structurally close
   * but returns `number | null` where this `Identity` returns `number | undefined`;
   * `bridge/apis/history-fetch.ts:87` is the three-line adapter.
   */
  identity?: Identity;
  /** Injected so tests can assert on the drop reasons; defaults to a real logger. */
  logger?: MsgPushPipelineLogger;
  /**
   * Pre-decode duplicate predicate, run after the context is built and before
   * `decodePush` — the position the reference puts `SysMsgDedup` at
   * (L177196-177203). Returning true drops the packet silently.
   *
   * Defaults to `undefined` (no dedup). `bridge/sysmsg-dedup.ts` is the ported
   * filter; this module takes the predicate rather than the class so a caller
   * decides which `SysMsgDedup` instance a session owns, and so these tests keep
   * proving decode without a stateful filter in the way.
   */
  dedup?: (ctx: PushContext) => boolean;
}

/**
 * Raw op6 body → `PushContext`, or `null` when the body carries no push.
 *
 * reference/index.mjs:143031 `buildContext`. Never throws: a malformed body (bad
 * varint, a length that overruns its parent, field number 0, a truncated nested
 * message) is reported as `null` plus one `debug` line. See the module header for
 * why swallowing here cannot change the published event set.
 */
export function decodeMsgPushContext(
  packet: Pick<IncomingPacket, "uin" | "body">,
  identity: Identity = EMPTY_IDENTITY,
  logger: MsgPushPipelineLogger = defaultLogger,
): PushContext | null {
  if (packet.body.length === 0) {
    // The reference returns null before touching the decoder (L143032), so an
    // empty body is not an error and must not log like one.
    return null;
  }
  try {
    return buildContext({ uin: packet.uin, body: packet.body }, identity);
  } catch (error) {
    logger.debug(
      "olpush body rejected before dispatch (bytes=%d): %s",
      packet.body.length,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/** The element list of a message event; `undefined` for every notice event. */
function messageElementsOf(event: MsgPushEvent): MessageSegment[] | undefined {
  switch (event.kind) {
    case "group_message":
    case "friend_message":
    case "temp_message":
      return event.elements;
    default:
      return undefined;
  }
}

/**
 * One decoded push → the events worth publishing.
 *
 * `eventSet`: step 2 + step 3 of the reference path. Notice events bypass the
 * survival filter exactly as in the reference (`messageElements(ev) === undefined
 * → keep`, L177205), because a mute/recall has no element list to be blank.
 */
export function decodeMsgPushPacket(
  packet: IncomingPacket,
  identity: Identity = EMPTY_IDENTITY,
  logger: MsgPushPipelineLogger = defaultLogger,
  dedup?: (ctx: PushContext) => boolean,
): MsgPushEvent[] {
  const ctx = decodeMsgPushContext(packet, identity, logger);
  if (!ctx) return [];

  // reference/index.mjs:177196 — the dedup test sits between the context build and
  // the registry dispatch, so a duplicate never reaches a decoder.
  if (dedup?.(ctx) === true) {
    logger.debug(
      "dropped duplicate system push (msgType=%d/%d seq=%d msgId=%d)",
      ctx.head.msgType,
      ctx.head.subType,
      ctx.head.sequence,
      ctx.head.msgId,
    );
    return [];
  }

  let events: MsgPushEvent[];
  try {
    events = decodePush(ctx);
  } catch (error) {
    // reference/index.mjs:154000 `MsgPushRegistry.decode`: a decoder exception is
    // logged and becomes an empty result, never a propagated throw.
    logger.warn(
      "decoder error for PkgType=%d subType=%d: %s",
      ctx.head.msgType,
      ctx.head.subType,
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    return [];
  }

  return events.filter((event) => {
    const elements = messageElementsOf(event);
    if (elements === undefined) return true;
    return keepDecodedMessage(ctx.head, elements, ctx.body, event.kind, ctx.fromUin);
  });
}

/**
 * A `PacketHandler` for `MSG_PUSH_CMD`.
 *
 * Bind it with `pipeline.registerCmd(MSG_PUSH_CMD, handler)` or use
 * {@link registerMsgPushHandler}. The identity is captured at construction
 * because `PacketHandler` receives only the packet, not a per-dispatch roster.
 */
export function createMsgPushHandler(options: MsgPushHandlerOptions = {}): PacketHandler {
  const identity = options.identity ?? EMPTY_IDENTITY;
  const logger = options.logger ?? defaultLogger;
  const dedup = options.dedup;
  return (packet: IncomingPacket) => decodeMsgPushPacket(packet, identity, logger, dedup);
}

/**
 * Register the MsgPush handler on a pipeline and hand the handler back.
 *
 * The return value is the registered function, so the caller can
 * `pipeline.unregisterCmd(MSG_PUSH_CMD, handler)` without having to keep its own
 * reference. Registration never replaces an existing handler — `registerCmd`
 * appends, and dispatch runs all of them — so registering twice publishes twice.
 */
export function registerMsgPushHandler(
  pipeline: IncomingPacketPipeline,
  options: MsgPushHandlerOptions = {},
): PacketHandler {
  const handler = createMsgPushHandler(options);
  pipeline.registerCmd(MSG_PUSH_CMD, handler);
  return handler;
}

/**
 * The reference's pre-dispatch dedup, as the seam `MsgPushHandlerOptions.dedup`
 * expects. `SysMsgDedup` is stateful, so the caller owns one instance per
 * account/session and passes it here.
 *
 * reference/index.mjs:177196-177203: the identity is derived from the just-built
 * context, and `seenDuplicate` returning true drops the packet before any decoder
 * runs. A context that cannot be keyed (unrouted msgType/subType, zero seq or
 * msgId, unresolvable peer) yields `null` and is never deduped — that is the
 * reference's fail-open behaviour and must not be tightened here.
 */
export function withSysMsgDedup(dedup: SysMsgDedup): (ctx: PushContext) => boolean {
  return (ctx) => {
    const identity = deriveSysMsgDedupIdentity(ctx);
    return identity === null ? false : dedup.seenDuplicate(identity);
  };
}