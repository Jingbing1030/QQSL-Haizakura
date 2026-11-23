// The roaming-history fetchers: one packet per call, the caller owns chunking.
//
// ---------------------------------------------------------------------------
// Why these live in the bridge layer and not in `msg-push.ts`
// ---------------------------------------------------------------------------
// The outbound side of history needs one thing `msg-push.ts` does not have: a transport.
// `msg-push.ts` is the *inbound* decoder — it turns bytes into events and never sends.
// These functions are the mirror image: they build a request, send it through
// `ctx.sendRawPacket`, and hand the response's bodies back to the inbound decoder. So
// they are bridge-layer code (matching the reference, where they live in
// `protocol/src/msg-push/fetch-*-history.ts` but take a `sender` object that is the
// bridge), and `msg-push.ts` is untouched by this port.
//
// ---------------------------------------------------------------------------
// The three commands, and how their responses differ
// ---------------------------------------------------------------------------
//
//   wire name                                                        encoder                     response
//   trpc.msg.register_proxy.RegisterProxy.SsoGetGroupMsg            SsoGetGroupMsg              body at field 3
//   trpc.msg.register_proxy.RegisterProxy.SsoGetC2cMsg              SsoGetC2cMsg                friendUid at 4
//   trpc.msg.register_proxy.RegisterProxy.SsoGetRoamMsg             SsoGetRoamMsg               friendUid at 3
//
// **`SsoGetC2cMsg` and `SsoGetRoamMsg` are different messages, not two spellings.** The
// c2c one is sequence-addressed (`startSequence`/`endSequence`) and echoes `friendUid` at
// field 4; the roam one is timestamp-addressed (`time`/`random`/`count`) and echoes
// `friendUid` at field 3, plus `isComplete` and a next-cursor. A port that shares one
// decoder between them reads the wrong field for `friendUid`, and the
// "response friend uid mismatch" guard then either never fires (wrong field reads null)
// or always fires (reading a uint32 as a string). They share only the repeated
// `PushMsgBody` payload.
//
// `SsoGetGroupMsg` returns a *wrapper* whose messages are `PushMsgBody`s already; there
// is no echo of the group in the same place. Its request also carries `direction: true`
// as a strict bool, so `direction: 1` would silently drop the field.
//
// ---------------------------------------------------------------------------
// What the caller must do
// ---------------------------------------------------------------------------
// One packet per call. The server rate-limits these and the chunking (how many sequences
// per request, the gap between requests) belongs to the caller — see
// `HISTORY_CHUNK_SEQ` and `HISTORY_MIN_GAP_MS` in `message.ts`, and the
// `HistoryRequestGate` they are passed to.

import type { BridgeContext, BridgeIdentity } from "../context.js";
import {
  decodeSsoGetC2cMsgResponse,
  decodeSsoGetGroupMsgResponse,
  decodeSsoGetRoamMsgResponse,
  encodeSsoGetC2cMsgRequest,
  encodeSsoGetGroupMsgRequest,
  encodeSsoGetRoamMsgRequest,
  type PushMsgBodyLike,
} from "./message-wire.js";
import { decodePushMsgBody } from "../../msg-push-fields.js";
import { buildContextFromMessage, decodeGroupMessage, decodeFriendMessage, hasDecodableContent, isOfflineFileReceipt } from "../../msg-push.js";
import type { Identity, MsgPushEvent } from "../../msg-push.js";
import { createLogger } from "../../onebot/log.js";

const log = createLogger("MsgPush.GroupHistory");
const logC2c = createLogger("MsgPush.C2CHistory");

/** The wire name `SsoGetGroupMsg` rides on. reference/index.mjs:177145 */
export const SSO_GET_GROUP_MSG_CMD = "trpc.msg.register_proxy.RegisterProxy.SsoGetGroupMsg";
/** The wire name `SsoGetC2cMsg` rides on. reference/index.mjs:161821 */
export const SSO_GET_C2C_MSG_CMD = "trpc.msg.register_proxy.RegisterProxy.SsoGetC2cMsg";
/** The wire name `SsoGetRoamMsg` rides on. reference/index.mjs:161822 */
export const SSO_GET_ROAM_MSG_CMD = "trpc.msg.register_proxy.RegisterProxy.SsoGetRoamMsg";

/** The slice of `ctx` these functions need: a transport. */
export type HistorySender = Pick<BridgeContext, "sendRawPacket">;

/**
 * Adapt the bridge roster to the inbound decoder's `Identity`.
 *
 * The two interfaces disagree on exactly one thing: `BridgeIdentity.findUinByUid` returns
 * `number | null` and `msg-push.ts`'s `Identity` returns `number | undefined`. `context.ts`
 * makes the `null` explicit because a roster that was asked and missed has no answer,
 * rather than "not applicable"; the inbound layer was written against `undefined` and
 * guards with `??` (reference/index.mjs:122226 `identity.findUinByUid(uid, groupId || void 0) ?? 0`).
 *
 * The two are interchangeable at every call site — `??` treats them alike, and the only
 * consumers either coerce with `||`/`??` or test for truthiness. So the adapter is a
 * three-line narrowing rather than a change to either interface: widening `Identity` to
 * `| null` would edit the inbound layer, which this port does not own, and narrowing
 * `BridgeIdentity` would lose the distinction the bridge relies on.
 */
function asInboundIdentity(identity: BridgeIdentity): Identity {
  return {
    findUinByUid: (uid, groupId) => identity.findUinByUid(uid, groupId) ?? undefined,
    findGroupMember: (groupId, uin) => identity.findGroupMember(groupId, uin) ?? undefined,
    findFriend: (uin) => identity.findFriend(uin) ?? undefined,
    findGroup: (groupId) => identity.findGroup(groupId) ?? undefined,
  };
}

/**
 * The transport result check, shared by all three commands.
 *
 * reference/index.mjs:154104 `requirePacketResponse`. Three distinct failures are kept
 * distinct because they mean different things: a transport failure is "the hook is not
 * attached", an empty response is "the server answered nothing", and only the third is a
 * protocol-level problem. Collapsing them into one message makes the first look like the
 * third.
 */
export function requirePacketResponse(
  result: { success: boolean; gotResponse?: boolean; responseData?: Uint8Array | null; errorMessage?: string | null },
  command: string,
): Uint8Array {
  if (!result.success) throw new Error(`${command} transport failed: ${result.errorMessage || "unknown transport error"}`);
  if (!result.gotResponse || !result.responseData || result.responseData.length === 0) {
    throw new Error(`${command} response is empty`);
  }
  return result.responseData;
}

/**
 * Fetch one `[startSeq, endSeq]` window of group history.
 *
 * reference/index.mjs:177130 `fetchGroupMessageRange`.
 *
 * Two behaviours worth naming:
 *
 *   * A "QQ null roam record" — `fromUin <= 0` and `timestamp <= 0` — is dropped rather
 *     than throwing. The server emits these as padding for deleted messages, and a port
 *     that throws on them fails the whole page for one tombstone.
 *   * The group check is `!== groupUin` and throws. Reading the group off the response
 *     rather than trusting the request is what catches a server-side shard mixup; the
 *     alternative is delivering another group's messages into this one.
 */
export async function fetchGroupMessageRange(
  sender: HistorySender,
  identity: BridgeIdentity,
  selfUin: number,
  groupUin: number,
  startSeq: number,
  endSeq: number,
): Promise<MsgPushEvent[]> {
  if (!(groupUin > 0) || !(endSeq > 0) || startSeq > endSeq) return [];
  const req = encodeSsoGetGroupMsgRequest({
    info: { groupUin, startSequence: startSeq, endSequence: endSeq },
    direction: true,
  });
  const decoded = decodeSsoGetGroupMsgResponse(
    requirePacketResponse(await sender.sendRawPacket(SSO_GET_GROUP_MSG_CMD, req), "SsoGetGroupMsg"),
    decodePushMsgBody as (data: Uint8Array, offset: number, end: number) => PushMsgBodyLike,
  );
  const messages = decoded.body?.messages ?? [];
  const out: MsgPushEvent[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const msg = messages[index]!;
    const ctx = buildContextFromMessage(msg as never, selfUin, asInboundIdentity(identity));
    if (!ctx) {
      throw new Error(
        `SsoGetGroupMsg response message ${index} has no content head (group=${groupUin} range=${startSeq}-${endSeq})`,
      );
    }
    if (ctx.fromUin <= 0 && ctx.head.timestamp <= 0) {
      log.debug("dropping QQ null roam record: group=%d seq=%d msgId=%d", groupUin, ctx.head.sequence, ctx.head.msgId);
      continue;
    }
    for (const ev of decodeGroupMessage(ctx)) {
      if (ev.kind !== "group_message") {
        throw new Error(
          `SsoGetGroupMsg response message ${index} decoded as ${ev.kind} (group=${groupUin} range=${startSeq}-${endSeq})`,
        );
      }
      if (!Number.isSafeInteger(ev.msgSeq) || ev.msgSeq <= 0) {
        throw new Error(
          `SsoGetGroupMsg response message ${index} has invalid sequence ${String(ev.msgSeq)} (group=${groupUin} range=${startSeq}-${endSeq})`,
        );
      }
      if (ev.groupId !== groupUin) {
        throw new Error(
          `SsoGetGroupMsg response message ${index} belongs to group ${ev.groupId} (expected=${groupUin} range=${startSeq}-${endSeq})`,
        );
      }
      if (!keepDecodedMessage(ctx.head, ev.elements, ctx.body, ev.kind, ctx.fromUin)) continue;
      out.push(ev);
    }
  }
  out.sort((a, b) => sequenceOfEvent(a) - sequenceOfEvent(b));
  return out;
}

/**
 * Decode c2c history bodies into `friend_message` events.
 *
 * reference/index.mjs:161824 `decodeC2cMessages`.
 *
 * The `sequenceAuthoritative === false` guard is the important one. QQ sometimes sends a
 * c2c history message with the client sequence and no NT sequence, and the client
 * sequence is the SENDER's counter — it is not comparable across participants. Accepting
 * one would sort the page wrongly and then cache the wrong cursor, so it throws instead.
 */
function decodeC2cMessages(
  messages: readonly PushMsgBodyLike[],
  identity: BridgeIdentity,
  selfUin: number,
  source: string,
): MsgPushEvent[] {
  const out: MsgPushEvent[] = [];
  for (const msg of messages) {
    const ctx = buildContextFromMessage(msg as never, selfUin, asInboundIdentity(identity));
    if (!ctx) throw new Error(`${source} response contains a message without a content head`);
    if (isC2cControlPush(ctx.head)) continue;
    for (const ev of decodeFriendMessage(ctx)) {
      if (ev.kind !== "friend_message") continue;
      if (!keepDecodedMessage(ctx.head, ev.elements, ctx.body, ev.kind, ctx.fromUin)) continue;
      if (ev.sequenceAuthoritative === false || !ev.ntMsgSeq || ev.ntMsgSeq <= 0) {
        throw new Error(
          `${source} message is missing the canonical NT sequence (clientSeq=${ev.clientSeq ?? ev.msgSeq} from=${ev.senderUin} time=${ev.time})`,
        );
      }
      out.push(ev);
    }
  }
  return out;
}

/**
 * Fetch one `[startSeq, endSeq]` window of private history through `SsoGetC2cMsg`.
 *
 * reference/index.mjs:161846 `fetchC2cMessageRange`. `friendUid` is the conversation
 * peer's uid, not the bot's.
 */
export async function fetchC2cMessageRange(
  sender: HistorySender,
  identity: BridgeIdentity,
  selfUin: number,
  friendUid: string,
  startSeq: number,
  endSeq: number,
): Promise<MsgPushEvent[]> {
  if (!friendUid || !(endSeq > 0) || startSeq > endSeq) return [];
  const req = encodeSsoGetC2cMsgRequest({ friendUid, startSequence: startSeq, endSequence: endSeq });
  const decoded = decodeSsoGetC2cMsgResponse(
    requirePacketResponse(await sender.sendRawPacket(SSO_GET_C2C_MSG_CMD, req), "SsoGetC2cMsg"),
    decodePushMsgBody as (data: Uint8Array, offset: number, end: number) => PushMsgBodyLike,
  );
  if (decoded.friendUid && decoded.friendUid !== friendUid) {
    throw new Error(`SsoGetC2cMsg response friend uid mismatch: ${decoded.friendUid}`);
  }
  const messages = decoded.messages;
  const out = decodeC2cMessages(messages, identity, selfUin, "SsoGetC2cMsg");
  out.sort((a, b) => sequenceOfField(a, "ntMsgSeq") - sequenceOfField(b, "ntMsgSeq"));
  logC2c.debug(
    "SsoGetC2cMsg decoded friend=%s range=%d-%d wire=%d usable=%d",
    friendUid,
    startSeq,
    endSeq,
    messages.length,
    out.length,
  );
  return out;
}

/** The cursor and messages `fetchC2cRoamMessagePage` returns. */
export interface C2cRoamPage {
  messages: MsgPushEvent[];
  cursor: { time: number; random: number };
  isComplete: boolean;
}

/**
 * Fetch one timestamp-cursor page of c2c roaming history.
 *
 * reference/index.mjs:161865 `fetchC2cRoamMessagePage`.
 *
 * `result === 100000301` means "reached the start of the conversation" and is a normal
 * end-of-walk, not a failure — it returns an empty page with a zero cursor and
 * `isComplete: true`. Treating it as an error makes `getC2cFullHistory` throw instead of
 * returning what it already collected.
 */
export async function fetchC2cRoamMessagePage(
  sender: HistorySender,
  identity: BridgeIdentity,
  selfUin: number,
  friendUid: string,
  beforeTime: number,
  count: number,
  beforeRandom = 0,
): Promise<C2cRoamPage> {
  if (!friendUid) throw new Error("SsoGetRoamMsg friend uid is required");
  if (!Number.isSafeInteger(beforeTime) || beforeTime < 0 || beforeTime > 4294967295) {
    throw new Error(`SsoGetRoamMsg cursor time is invalid: ${String(beforeTime)}`);
  }
  if (!Number.isSafeInteger(beforeRandom) || beforeRandom < 0 || beforeRandom > 4294967295) {
    throw new Error(`SsoGetRoamMsg cursor random is invalid: ${String(beforeRandom)}`);
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 200) {
    throw new Error(`SsoGetRoamMsg count is invalid: ${String(count)}`);
  }
  const req = encodeSsoGetRoamMsgRequest({ friendUid, time: beforeTime, random: beforeRandom, count, direction: true });
  const response = decodeSsoGetRoamMsgResponse(
    requirePacketResponse(await sender.sendRawPacket(SSO_GET_ROAM_MSG_CMD, req), "SsoGetRoamMsg"),
    decodePushMsgBody as (data: Uint8Array, offset: number, end: number) => PushMsgBodyLike,
  );
  if (response.result === 100000301) {
    logC2c.debug("SsoGetRoamMsg reached the end of private history");
    return { messages: [], cursor: { time: 0, random: 0 }, isComplete: true };
  }
  if (response.result) {
    throw new Error(`SsoGetRoamMsg failed: result=${response.result} ${response.errorMessage ?? ""}`.trim());
  }
  if (response.friendUid && response.friendUid !== friendUid) {
    throw new Error(`SsoGetRoamMsg response friend uid mismatch: ${response.friendUid}`);
  }
  const wireMessages = response.messages;
  const messages = decodeC2cMessages(wireMessages, identity, selfUin, "SsoGetRoamMsg");
  messages.sort((a, b) => sequenceOfField(a, "ntMsgSeq") - sequenceOfField(b, "ntMsgSeq") || timeOf(a) - timeOf(b));
  const cursor = { time: response.timestamp ?? 0, random: response.random ?? 0 };
  logC2c.debug(
    "SsoGetRoamMsg decoded friend=%s before=%d/%d count=%d wire=%d usable=%d next=%d/%d complete=%s",
    friendUid,
    beforeTime,
    beforeRandom,
    count,
    wireMessages.length,
    messages.length,
    cursor.time,
    cursor.random,
    response.isComplete === true,
  );
  return { messages, cursor, isComplete: response.isComplete === true };
}

// ===========================================================================
// Small shared readers
// ===========================================================================

/**
 * The c2c control-signal test, moved here from the inbound layer's blank filter.
 *
 * These are `(msgType, c2cCmd)` pairs the official client dispatches through
 * `OnRecvSysMsg` instead of rendering. History has to drop them *before* decode as well
 * as after, because a control push can carry junk content that decodes to a stray
 * element. reference/index.mjs:135850 `isC2cControlPush`.
 */
const C2C_CONTROL_TYPES = new Set([141, 166, 167]);
const C2C_CONTROL_CMDS = new Set([1, 73, 75, 129, 131, 133, 135, 192]);

export function isC2cControlPush(head: { msgType: number; c2cCmd: number }): boolean {
  return C2C_CONTROL_TYPES.has(head.msgType) && C2C_CONTROL_CMDS.has(head.c2cCmd);
}

/**
 * The post-decode bubble decision, from `../msg-push/blank-filter.ts`.
 *
 * reference/index.mjs:135905 `keepDecodedMessage`. Four outcomes, and the third is the
 * subtle one: a body that had content but decoded to ZERO elements is "keep-undecoded",
 * not "blank" — dropping it silently loses messages whenever a decoder is missing, so it
 * keeps the message and warns instead.
 */
export function keepDecodedMessage(
  head: { msgType: number; c2cCmd: number; sequence: number; subType: number },
  elements: readonly unknown[],
  body: { richText?: unknown; msgContent?: Uint8Array | null } | null | undefined,
  kind: string,
  fromUin: number,
): boolean {
  if (isC2cControlPush(head)) return false;
  if (isOfflineFileReceipt(body as never)) return false;
  if (elements.length !== 0) return true;
  // Reuse the canonical port instead of keeping a second copy of the same predicate:
  // `msg-push.ts` owns `hasDecodableContent` (reference L135251) and a divergent local
  // twin here would silently change the blank/undecoded decision on one path only.
  if (hasDecodableContent(body as { richText?: never; msgContent?: Uint8Array | null })) {
    log.warn(
      "message had content but decoded to 0 elements — missing decoder? (kind=%s seq=%d from=%d msgType=%d/%d)",
      kind,
      head.sequence,
      fromUin,
      head.msgType,
      head.subType,
    );
    return true;
  }
  return false;
}

function sequenceOfEvent(ev: MsgPushEvent): number {
  return sequenceOfField(ev, "msgSeq");
}

function sequenceOfField(ev: MsgPushEvent, field: string): number {
  const value = (ev as unknown as Record<string, unknown>)[field];
  return typeof value === "number" ? value : 0;
}

function timeOf(ev: MsgPushEvent): number {
  const value = (ev as unknown as Record<string, unknown>)["time"];
  return typeof value === "number" ? value : 0;
}