// `MessageApi` — the bridge's send / recall / read-report / history surface.
//
// ---------------------------------------------------------------------------
// What this file is, relative to the reference
// ---------------------------------------------------------------------------
// Reference region `src/bridge/apis/message.ts`, reference/index.mjs:298712-309793
// (11,081 lines). Only the last **661 lines** are logic; the other 10,420 are the 99
// codec functions, which live in `message-wire.ts` and `dataline.ts` rebased onto
// `ProtoWriter`/`ProtoReader` (see that file's header for the field-number traps).
//
// So the port is: ~660 lines of logic, all of it here, against a 700-line wire layer and
// a 1,900-line re-used element builder. Nothing was dropped.
//
// ---------------------------------------------------------------------------
// The five send paths, and the four ways they differ
// ---------------------------------------------------------------------------
// They all end at `MessageSvc.PbSendMsg` with the same envelope, and the differences are
// entirely in routing, body kind and receipt field:
//
//   method              routingHead            body                       receipt seq
//   sendGroup           grp{groupCode}         richText{elems}            groupSequence (11)
//   sendPrivate         c2c{uin,uid?}          encodePrivateRichText      privateSequence (14)
//   sendDatalineText    trans0x211{ccCmd:7}    msgContent=dataline body   privateSequence (14)
//   sendGroupTempMessage grpTmp{groupUin,toUid} richText{elems}           privateSequence (14)
//   sendC2cFile         trans0x211{ccCmd:4}    msgContent=FileExtra       privateSequence (14)
//
// The `!= null && !== 0` guards on `clientSequence`, `random`, `via`, `dataStatist` and
// `multiSendSeq` mean all five paths send those five as *absent*. `sendGroup` passes
// `clientSequence: 0` explicitly and it is dropped; `sendDatalineText` and the others pass
// a real one and it is emitted. That asymmetry is in the reference and is preserved.
//
// ---------------------------------------------------------------------------
// Behaviours that are easy to "clean up" and wrong to
// ---------------------------------------------------------------------------
//
//   1. **`sendPrivate` resolves the uid only when media is present.** A text-only c2c
//      message carries `routingHead.c2c {uin}` with NO `uid`, and the lookup never
//      happens. Resolving eagerly would add a network round trip to every text message
//      and, worse, change the bytes.
//
//   2. **`sendPrivate` checks the poke policy BEFORE the empty check's uid resolution.**
//      The reference's order is: dataline branch, empty check, poke policy, uid. A poke
//      in a group-temp scene must fail with the policy error, not with "message is empty".
//
//   3. **`sendGroup` throws when `groupSequence <= 0`.** A group send that returns
//      result 0 but no sequence is an unconfirmed delivery: the server accepted the
//      packet and dropped the message. Returning a receipt anyway would let the caller
//      cache a messageId that matches nothing, and the failure would resurface much later
//      as "the recalled message does not exist". The reference logs the full response and
//      throws; this port does the same.
//
//   4. **`sendC2cFile`'s finalize is best-effort.** If `0xE37_800` fails, the file is
//      still sent, just without `FileExtra.field6`. The comment cites issue #157. Making
//      the finalize mandatory turns a cosmetic-metadata failure into a total send failure.
//
//   5. **`recallGroup` / `recallPrivate` do not check `gotResponse`.** They only test
//      `success`. A recall is fire-and-forget on the server side; requiring a body would
//      reject recalls that actually took effect.
//
// ---------------------------------------------------------------------------
// Mark-read: two packets, and why the first one reports zero
// ---------------------------------------------------------------------------
// `SsoReadedReport` both *sets* the read cursor and *returns* the server's current
// read/latest pair. Message-head sequences are sender-local and are not valid c2c read
// sequences, so the first packet reports `lastReadSeq: 0n` for everything — which
// protobuf omits entirely, leaving a bare `{groupUin}` or `{uid}` — and the server
// answers "here is where you are" without moving anything. The second packet then
// advances only the conversations that are actually behind, and its response is checked
// to confirm the server did not move backwards.
//
// That is why `markReadBatch` makes two round trips and why `probeHistorySyncState` makes
// one. Reporting a stale local sequence would move the cursor *backwards* and the user
// would see unread badges reappear.

import { createLogger } from "../../onebot/log.js";
import type { BridgeContext, PacketSendResult } from "../context.js";
import { createMediaUploader, type MediaUploadContext } from "../../highway/pipeline.js";
import { HighwaySessionCache, bridgeSessionTransport } from "../../highway/session.js";
import {
  assertWindowShakeSendPolicy,
  buildSendElems,
  encodeElem,
  encodePrivateRichText,
  type Elem,
  type Segment,
} from "../../element-builder.js";
import {
  decodeSsoReadedReportResp,
  encodeC2CRecallRequest,
  encodeFileExtra,
  encodeGroupRecallRequest,
  encodeSendMessageRequestBytes,
  encodeSendMessageRequestRichText,
  encodeSsoReadedReportReq,
  decodeSendMessageResponse,
  type C2CReadedReportResponseItem,
  type FileExtra,
  type GroupReadedReportResponseItem,
  type MessageControlFields,
  type SsoReadedReportReq,
  type SsoReadedReportResp,
} from "./message-wire.js";
import {
  DATALINE_SUBCMD_GENERIC,
  datalineTextFromElements,
  encodeDatalineText,
  findDatalineDeviceByUin,
  type DatalineDevice,
  type DatalineSegment,
} from "./dataline.js";
import { HistoryRequestGate, historyRequestGate } from "./history-request-gate.js";
import {
  fetchC2cMessageRange,
  fetchC2cRoamMessagePage,
  fetchGroupMessageRange,
  type C2cRoamPage,
} from "./history-fetch.js";
import { invokeOidb } from "../../oidb/spec.js";
import { FinalizeOfflineFile, type OidbOfflineFileMetadata } from "../../oidb/services/0x3639-offline.js";
import type { MsgPushEvent } from "../../msg-push.js";


const log = createLogger("Bridge.Message");

// ===========================================================================
// Constants
// ===========================================================================

/** reference/index.mjs:10243 `SEND_MSG_CMD`. */
export const SEND_MSG_CMD = "MessageSvc.PbSendMsg";
/** reference/index.mjs:10244 `READ_REPORT_CMD`. */
export const READ_REPORT_CMD = "trpc.msg.msg_svc.MsgService.SsoReadedReport";
/** reference/index.mjs:10245 `READ_REPORT_BATCH_SIZE`. */
export const READ_REPORT_BATCH_SIZE = 100;
/** reference/index.mjs:10246 `LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS`. */
export const LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS = {
  maxTargetsPerKind: READ_REPORT_BATCH_SIZE,
  maxMessagesPerSession: 20,
  minimumGapMs: 2_000,
} as const;
/** reference/index.mjs:10327 `HISTORY_MAX_COUNT`. */
export const HISTORY_MAX_COUNT = 200;
/** reference/index.mjs:10328 `PRIVATE_HISTORY_PAGE_SIZE`. */
export const PRIVATE_HISTORY_PAGE_SIZE = 100;
/** reference/index.mjs:10329 `HISTORY_CHUNK_SEQ` — sequences per request. */
export const HISTORY_CHUNK_SEQ = 30;
/** reference/index.mjs:10330 `HISTORY_MAX_REQUESTS` — one `history` call's budget. */
export const HISTORY_MAX_REQUESTS = 12;
/** reference/index.mjs:10331 `HISTORY_MIN_GAP_MS`. */
export const HISTORY_MIN_GAP_MS = 300;
/** reference/index.mjs:10332 `HISTORY_MAX_SEQUENCE` — a uint32 cursor. */
export const HISTORY_MAX_SEQUENCE = 4_294_967_295;

/** The recall commands. reference/index.mjs:10471 / :10484. */
export const GROUP_RECALL_CMD = "trpc.msg.msg_svc.MsgService.SsoGroupRecallMsg";
export const C2C_RECALL_CMD = "trpc.msg.msg_svc.MsgService.SsoC2CRecallMsg";

/** `subcmd: 1` — the c2c file-send command code the intake validator requires. */
const NOT_ONLINE_FILE_SUBCMD_C2C_SEND = 1;
/** Seven days, in minutes. The reference's `expireTime` convention. */
const FILE_EXPIRE_MINUTES = 10_080;

// ===========================================================================
// Types
// ===========================================================================

/** What a successful send returns. Callers cache it for recall and reply lookups. */
export interface SendMessageReceipt {
  messageId: number;
  sequence: number;
  clientSequence: number;
  random: number;
  timestamp: number;
}

/** One private read-report target, after uid resolution. */
export interface C2cReadTarget {
  userId: number;
  uid: string;
}

/** One private history-sync target, as the login flow supplies it. */
export interface HistorySyncPrivateTarget {
  userId: number;
  uid: string;
}

export interface HistorySyncGroupState {
  groupId: number;
  readSeq: number;
  latestSeq: number;
}

export interface HistorySyncPrivateState extends C2cReadTarget {
  readSeq: number;
  latestSeq: number;
  lastMsgTime: number;
}

export interface HistorySyncProbe {
  groups: HistorySyncGroupState[];
  privateUsers: HistorySyncPrivateState[];
}

/** The c2c file metadata `UploadC2cFile` hands over. */
export interface C2cFileInfo {
  fileId: string;
  fileName: string;
  fileSize: number | bigint;
  fileMd5: Uint8Array;
  fileHash?: string;
}

/**
 * Everything `MessageApi` needs from the bridge.
 *
 * Narrower than `BridgeContext` on purpose: this module never touches the roster, the
 * event bus or the config, so listing only the six members it calls documents the actual
 * coupling. `BridgeContext` satisfies this structurally, so no adapter is needed at the
 * construction site.
 */
export type MessageApiContext = Pick<
  BridgeContext,
  | "sendRawPacket"
  | "resolveUserUid"
  | "nextMessageRandom"
  | "nextClientSequence"
  | "identity"
  | "recallUploadedFile"
>;

// ===========================================================================
// Read-report helpers
// ===========================================================================

/**
 * Turn a transport result into a decoded read-report response, or throw.
 *
 * reference/index.mjs:10254 `decodeReadReportResponse`. The decode is wrapped separately
 * from the transport check because a malformed body and a failed send are different bugs
 * and the message must say which.
 */
function decodeReadReportResponse(result: PacketSendResult, label: string): SsoReadedReportResp {
  if (!result.success) throw new Error(result.errorMessage || `${label} transport failed`);
  if (!result.gotResponse || !result.responseData || result.responseData.length === 0) {
    throw new Error(`${label} response is empty`);
  }
  let response: SsoReadedReportResp;
  try {
    response = decodeSsoReadedReportResp(result.responseData);
  } catch (error) {
    throw new Error(`${label} response decode failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const resultCode = response.resultCode ?? 0;
  if (resultCode !== 0) throw new Error(response.errorMessage || `${label} failed with result code ${resultCode}`);
  return response;
}

/** reference/index.mjs:10267 `uniqueSessionIds`. Validates, then de-duplicates preserving order. */
export function uniqueSessionIds(ids: readonly number[], label: string): number[] {
  const result: number[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`invalid ${label} read target ${String(id)}`);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/**
 * reference/index.mjs:10279 `uniqueHistorySyncPrivateTargets`.
 *
 * Bidirectional conflict detection: a `userId` mapped to two uids, or one uid mapped to two
 * userIds, both throw. A one-directional check would let the second case through, and then
 * the probe's response matching (`item.uid === target.uid`) would match the wrong target.
 */
export function uniqueHistorySyncPrivateTargets(targets: readonly HistorySyncPrivateTarget[]): C2cReadTarget[] {
  const result: C2cReadTarget[] = [];
  const userToUid = new Map<number, string>();
  const uidToUser = new Map<string, number>();
  for (const target of targets) {
    if (!Number.isSafeInteger(target.userId) || target.userId <= 0) {
      throw new Error(`invalid private history sync target ${String(target.userId)}`);
    }
    if (typeof target.uid !== "string" || target.uid.trim().length === 0) {
      throw new Error(`private history sync target ${target.userId} has no uid`);
    }
    const uid = target.uid.trim();
    const knownUid = userToUid.get(target.userId);
    if (knownUid !== undefined) {
      if (knownUid !== uid) throw new Error(`private history sync target ${target.userId} maps to conflicting uids`);
      continue;
    }
    const knownUser = uidToUser.get(uid);
    if (knownUser !== undefined && knownUser !== target.userId) {
      throw new Error(`private history sync uid ${uid} maps to conflicting users`);
    }
    userToUid.set(target.userId, uid);
    uidToUser.set(uid, target.userId);
    result.push({ userId: target.userId, uid });
  }
  return result;
}

/**
 * reference/index.mjs:10303 `requireReadResponseItem`.
 *
 * Matching by identity first and falling back to position, then RE-checking the match:
 * the server answers in request order, but a positional-only read would accept a
 * response for a different conversation when the server reorders. Asking for the
 * position and then verifying identity catches both.
 */
function requireReadResponseItem<T extends { resultCode: number | null; errorMessage: string | null }>(
  items: readonly T[] | undefined,
  index: number,
  matches: (item: T) => boolean,
  label: string,
): T {
  const item = items?.find(matches) ?? items?.[index];
  if (!item) throw new Error(`${label} response item is missing`);
  const resultCode = item.resultCode ?? 0;
  if (resultCode !== 0) throw new Error(item.errorMessage || `${label} failed with result code ${resultCode}`);
  if (!matches(item)) throw new Error(`${label} response identity does not match the request`);
  return item;
}

/** reference/index.mjs:10311 `readUnsignedSequence`. `null` becomes `0n`; a negative rejects. */
export function readUnsignedSequence(value: bigint | null, label: string): bigint {
  if (value == null) return 0n;
  if (typeof value !== "bigint" || value < 0n) throw new Error(`${label} is invalid`);
  return value;
}

/** reference/index.mjs:10316 `requirePositiveSequence`. */
export function requirePositiveSequence(value: bigint | null, label: string): bigint {
  const sequence = readUnsignedSequence(value, label);
  if (sequence === 0n) throw new Error(`${label} is missing`);
  return sequence;
}

/** reference/index.mjs:10321 `readSafeSequence`. */
export function readSafeSequence(value: bigint | null, label: string): number {
  const sequence = readUnsignedSequence(value, label);
  if (sequence > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds the safe integer range`);
  return Number(sequence);
}

/**
 * reference/index.mjs:10326 `validateHistorySyncRange`.
 *
 * The `+ 1` is not off-by-one: `endSeq - startSeq + 1` is the inclusive slot count, and the
 * 20-message cap is on slots, not on the difference.
 */
export function validateHistorySyncRange(startSeq: number, endSeq: number, label: string): void {
  if (!Number.isSafeInteger(startSeq) || startSeq <= 0) {
    throw new Error(`${label} start sequence is invalid: ${String(startSeq)}`);
  }
  if (!Number.isSafeInteger(endSeq) || endSeq < startSeq || endSeq > HISTORY_MAX_SEQUENCE) {
    throw new Error(`${label} end sequence is invalid: ${String(endSeq)}`);
  }
  if (endSeq - startSeq + 1 > LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.maxMessagesPerSession) {
    throw new Error(
      `${label} may request at most ${LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.maxMessagesPerSession} sequence slots`,
    );
  }
}

// ===========================================================================
// The history walkers
// ===========================================================================

/** The sequence a history walk should sort and bound by. */
type SequenceOf = (event: MsgPushEvent) => number;

const GROUP_SEQUENCE: SequenceOf = (event) => sequenceField(event, "msgSeq");
const C2C_SEQUENCE: SequenceOf = (event) => sequenceField(event, "ntMsgSeq");

function sequenceField(event: MsgPushEvent, field: string): number {
  const value = (event as unknown as Record<string, unknown>)[field];
  return typeof value === "number" ? value : 0;
}

function timeField(event: MsgPushEvent): number {
  const value = (event as unknown as Record<string, unknown>)["time"];
  return typeof value === "number" ? value : 0;
}

/**
 * reference/index.mjs:10340 `walkBackHistory`.
 *
 * Walks strictly backward in `HISTORY_CHUNK_SEQ` windows. The `minSeq` short-cap handling
 * is the load-bearing part: when the server returns fewer messages than the window asked
 * for, the next window must end at the oldest sequence ACTUALLY RETURNED, not at
 * `curEnd - HISTORY_CHUNK_SEQ`. Using the arithmetic boundary would skip the gap between
 * the short-capped batch's oldest message and the arithmetic boundary.
 */
async function walkBackHistory(
  endSeq: number,
  count: number,
  gate: HistoryRequestGate,
  fetchWindow: (start: number, end: number) => Promise<MsgPushEvent[]>,
  sequenceOf: SequenceOf = GROUP_SEQUENCE,
): Promise<MsgPushEvent[]> {
  if (!(endSeq > 0)) return [];
  const want = Math.min(Math.max(1, Math.trunc(count) || 0), HISTORY_MAX_COUNT);
  const collected = new Map<number, MsgPushEvent>();
  let curEnd = endSeq;
  for (let i = 0; i < HISTORY_MAX_REQUESTS && collected.size < want && curEnd >= 1; i += 1) {
    const start = Math.max(1, curEnd - HISTORY_CHUNK_SEQ + 1);
    const batch = await gate.run(HISTORY_MIN_GAP_MS, () => fetchWindow(start, curEnd));
    if (batch.length > 0) {
      let minSeq = curEnd;
      for (const ev of batch) {
        const sequence = sequenceOf(ev);
        if (!Number.isInteger(sequence) || sequence < start || sequence > curEnd) {
          throw new Error(`history response sequence is outside requested range ${start}-${curEnd}`);
        }
        collected.set(sequence, ev);
        if (sequence < minSeq) minSeq = sequence;
      }
      curEnd = minSeq - 1;
    } else {
      curEnd = start - 1;
    }
  }
  return [...collected.values()].sort((a, b) => sequenceOf(a) - sequenceOf(b)).slice(-want);
}

/** A forward window plus whether its prefix was resolved. */
interface ForwardWindow {
  messages: MsgPushEvent[];
  complete: boolean;
}

/**
 * reference/index.mjs:10366 `fetchForwardWindow`.
 *
 * The history service may answer a `[start, end]` range with only its NEWEST suffix. This
 * recursively fetches the omitted prefix so the suffix is never exposed before the
 * messages nearest the anchor. Recursion depth is bounded by the request budget, not by a
 * counter — `budget.remaining` is decremented before every request including recursive
 * ones, so a pathological server cannot drive unbounded recursion.
 */
async function fetchForwardWindow(
  startSeq: number,
  endSeq: number,
  budget: { remaining: number },
  gate: HistoryRequestGate,
  fetchWindow: (start: number, end: number) => Promise<MsgPushEvent[]>,
  sequenceOf: SequenceOf,
): Promise<ForwardWindow> {
  if (budget.remaining <= 0) return { messages: [], complete: false };
  budget.remaining -= 1;
  const batch = await gate.run(HISTORY_MIN_GAP_MS, () => fetchWindow(startSeq, endSeq));
  if (batch.length === 0) return { messages: [], complete: true };
  const messages = [...new Map(batch.map((event) => [sequenceOf(event), event])).values()].sort(
    (a, b) => sequenceOf(a) - sequenceOf(b),
  );
  for (const message of messages) {
    const sequence = sequenceOf(message);
    if (!Number.isInteger(sequence) || sequence < startSeq || sequence > endSeq) {
      throw new Error(`history response sequence is outside requested range ${startSeq}-${endSeq}`);
    }
  }
  const firstSequence = sequenceOf(messages[0]!);
  if (firstSequence === startSeq) return { messages, complete: true };
  const prefix = await fetchForwardWindow(startSeq, firstSequence - 1, budget, gate, fetchWindow, sequenceOf);
  if (!prefix.complete) return prefix;
  return { messages: [...prefix.messages, ...messages], complete: true };
}

/**
 * reference/index.mjs:10402 `walkForwardHistory`.
 *
 * Stops on `!window.complete`, which is how an exhausted budget prevents later messages
 * from being returned ahead of an unresolved prefix.
 */
async function walkForwardHistory(
  startSeq: number,
  count: number,
  gate: HistoryRequestGate,
  fetchWindow: (start: number, end: number) => Promise<MsgPushEvent[]>,
  sequenceOf: SequenceOf = GROUP_SEQUENCE,
): Promise<MsgPushEvent[]> {
  if (!(startSeq > 0) || startSeq > HISTORY_MAX_SEQUENCE) return [];
  const want = Math.min(Math.max(1, Math.trunc(count) || 0), HISTORY_MAX_COUNT);
  const collected = new Map<number, MsgPushEvent>();
  const budget = { remaining: HISTORY_MAX_REQUESTS };
  let curStart = startSeq;
  while (budget.remaining > 0 && collected.size < want && curStart <= HISTORY_MAX_SEQUENCE) {
    const end = Math.min(HISTORY_MAX_SEQUENCE, curStart + HISTORY_CHUNK_SEQ - 1);
    const window = await fetchForwardWindow(curStart, end, budget, gate, fetchWindow, sequenceOf);
    for (const event of window.messages) collected.set(sequenceOf(event), event);
    if (!window.complete || end === HISTORY_MAX_SEQUENCE) break;
    curStart = end + 1;
  }
  return [...collected.values()].sort((a, b) => sequenceOf(a) - sequenceOf(b)).slice(0, want);
}

/**
 * Resolve the bot's own uid, for the c2c file finalize.
 *
 * reference/index.mjs:10120 `resolveSelfUid` (region `protocol/src/self-uid.ts`, 24 lines).
 * Caches on `identity.selfUid` so the resolve happens once per process. The numeric-uid
 * short-circuit is a protocol fact: a uid that is itself a decimal uin needs no network
 * lookup, so an account whose identity was bootstrapped from a numeric uid never pays for
 * the resolve.
 */
/**
 * Whether a send actually needs the highway pipeline.
 *
 * Only image, record and video carry a `MsgInfo`; everything else is pure protobuf. The
 * distinction matters because constructing the uploader allocates a session cache and,
 * more importantly, makes it obvious at the call site when a send is capable of network
 * I/O beyond the final `send_msg` — which is the thing a reader of `sendGroup` most needs
 * to know.
 */
function needsMediaUpload(elements: readonly Segment[]): boolean {
  return elements.some((e) => e.type === "image" || e.type === "record" || e.type === "video");
}

export async function resolveSelfUid(ctx: MessageApiContext): Promise<string> {
  const cached = ctx.identity.selfUid;
  if (typeof cached === "string" && cached.length > 0) return cached;
  const selfUin = Number(ctx.identity.uin);
  if (!Number.isFinite(selfUin) || selfUin <= 0) throw new Error("self uid is unavailable");
  return ctx.resolveUserUid(selfUin);
}

// ===========================================================================
// MessageApi
// ===========================================================================

/**
 * The message API.
 *
 * Reference `var MessageApi = class` at reference/index.mjs:309132. Twenty-one methods:
 * five send paths, two recalls, five read-report entry points plus two private helpers,
 * and eight history entry points plus one validator.
 */
export class MessageApi {
  readonly #ctx: MessageApiContext;
  /**
   * One highway session bootstrap shared by every media send on this connection.
   *
   * The bootstrap is two SSO round-trips and the servers are stable for minutes, so
   * rebuilding it per image would double the latency of a burst. The cache owns the TTL
   * (5 min) and the single-flight guard.
   *
   * The transport delegates lazily to `#ctx` because class-property initialisers run
   * before the constructor body assigns `#ctx`.
   */
  readonly #mediaSessionCache = new HighwaySessionCache({
    sendRawPacket: (serviceCmd, body) => this.#ctx.sendRawPacket(serviceCmd, body),
  });
  /** The shared roaming gate; injectable so tests can drive the clock. */
  readonly #gate: HistoryRequestGate;

  constructor(ctx: MessageApiContext, gate: HistoryRequestGate = historyRequestGate) {
    this.#ctx = ctx;
    this.#gate = gate;
  }

  // -------------------------------------------------------------------------
  // Send paths
  // -------------------------------------------------------------------------

  /** Send a message to a group. reference/index.mjs:309143 `sendGroup`. */
  async sendGroup(groupId: number, elements: readonly Segment[]): Promise<SendMessageReceipt> {
    if (elements.length === 0) throw new Error("message is empty");
    const protoElems = await buildSendElems(elements, {
      groupId,
      scene: "group",
      // Created per send, not per segment, so a multi-image message shares one session.
      // Only for a media-carrying message: text sends would pay for an unused object.
      ...(needsMediaUpload(elements)
        ? {
            uploadMedia: createMediaUploader({
              bridge: this.#ctx as unknown as MediaUploadContext["bridge"],
              isGroup: true,
              targetIdOrUid: String(groupId),
              sessionCache: this.#mediaSessionCache,
            }),
          }
        : {}),
    });
    const random = this.#ctx.nextMessageRandom();
    const request = encodeSendMessageRequestRichText({
      routingHead: { grp: { groupCode: BigInt(groupId) } },
      contentHead: { type: 1 },
      messageBody: { richText: { elems: protoElems.map((elem) => encodeElemForSend(elem)) } },
      clientSequence: 0,
      random,
      syncCookie: new Uint8Array(0),
      via: 0,
      dataStatist: 0,
      multiSendSeq: 0,
    });
    const result = await this.#ctx.sendRawPacket(SEND_MSG_CMD, request);
    if (!result.success || !result.gotResponse || !result.responseData) {
      throw new Error(`send group message failed: ${result.errorMessage || "no response"}`);
    }
    const response = decodeSendMessageResponse(result.responseData);
    if (response.result != null && response.result !== 0) {
      throw new Error(`send group message rejected: result=${response.result} err=${response.errMsg ?? ""}`);
    }
    const seq = response.groupSequence ?? 0;
    if (seq <= 0) {
      log.warn(
        "group message delivery unconfirmed: group=%d random=%d result=%s sequence=%s time=%s responseBytes=%d",
        groupId,
        random,
        response.result,
        response.groupSequence,
        response.timestamp1,
        result.responseData.length,
      );
      throw new Error(
        "group message delivery was not confirmed: QQ returned no message receipt; check the conversation before retrying",
      );
    }
    return {
      messageId: (random & 2_147_483_647) || seq,
      sequence: seq,
      clientSequence: 0,
      random,
      timestamp: response.timestamp1 ?? Math.floor(Date.now() / 1_000),
    };
  }

  /**
   * Send a c2c message. reference/index.mjs:309183 `sendPrivate`.
   *
   * Two early exits before any encoding, in this order: the my-device branch, then the
   * empty check. The uid lookup happens only for media-carrying messages.
   */
  async sendPrivate(userUin: number, elements: readonly Segment[]): Promise<SendMessageReceipt> {
    const device = findDatalineDeviceByUin(userUin);
    if (device) return this.sendDatalineText(device, elements);
    if (elements.length === 0) throw new Error("message is empty");
    assertWindowShakeSendPolicy(
      elements.filter((element) => element.type === "poke").length,
      elements.length,
      "direct-private",
    );
    let userUid = "";
    if (elements.some((e) => e.type === "image" || e.type === "record" || e.type === "video")) {
      userUid = await this.#ctx.resolveUserUid(userUin);
    }
    const richText = await encodePrivateRichText(elements, {
      userUid,
      scene: "direct-private",
      ...(needsMediaUpload(elements)
        ? {
            uploadMedia: createMediaUploader({
              bridge: this.#ctx as unknown as MediaUploadContext["bridge"],
              isGroup: false,
              targetIdOrUid: userUid,
              sessionCache: this.#mediaSessionCache,
            }),
          }
        : {}),
    });
    const random = this.#ctx.nextMessageRandom();
    const clientSeq = this.#ctx.nextClientSequence();
    const ctrl = { msgFlag: Math.floor(Date.now() / 1_000) };
    const routingC2c: { uin: number; uid?: string } = userUid ? { uin: userUin, uid: userUid } : { uin: userUin };
    const request = encodeSendMessageRequestBytes({
      routingHead: { c2c: routingC2c },
      contentHead: { type: 1, subType: 0, c2cCmd: 11 },
      messageBody: { richText },
      clientSequence: clientSeq,
      random,
      syncCookie: new Uint8Array(0),
      via: 0,
      dataStatist: 0,
      ctrl,
      multiSendSeq: 0,
    });
    const response = await this.#sendAndDecode(request, "send private message");
    const seq = response.privateSequence ?? 0;
    return {
      messageId: (random & 2_147_483_647) || seq,
      sequence: seq,
      clientSequence: clientSeq,
      random,
      timestamp: response.timestamp1 ?? Math.floor(Date.now() / 1_000),
    };
  }

  /**
   * Send text to a my-device contact. reference/index.mjs:309240 `sendDatalineText`.
   *
   * `toUin` is the BOT's own uin, not the device's pseudo-uin (2113929217…). The device is
   * addressed by `dstTerType` inside the body. See `dataline.ts`'s `encodeDatalineText`.
   *
   * `contentHead` carries no `c2cCmd`, so it encodes as `{type: 1, subType: 0}` and the
   * server routes on `trans0x211.ccCmd: 7`.
   */
  async sendDatalineText(device: DatalineDevice, elements: readonly Segment[]): Promise<SendMessageReceipt> {
    const text = datalineTextFromElements(elements as readonly DatalineSegment[]);
    const selfUin = Number.parseInt(this.#ctx.identity.uin, 10);
    if (!Number.isSafeInteger(selfUin) || selfUin <= 0) throw new Error("self uin unavailable");
    const random = this.#ctx.nextMessageRandom();
    const clientSeq = this.#ctx.nextClientSequence();
    const nowSec = Math.floor(Date.now() / 1_000);
    const request = encodeSendMessageRequestRichText({
      routingHead: { trans0x211: { toUin: BigInt(selfUin), ccCmd: 7, uid: device.uid } },
      contentHead: { type: 1, subType: 0 },
      messageBody: { msgContent: encodeDatalineText({ selfUin, dstTerType: device.terType, text }) },
      clientSequence: clientSeq,
      random,
      syncCookie: new Uint8Array(0),
      via: 0,
      dataStatist: 0,
      ctrl: { msgFlag: nowSec },
      multiSendSeq: 0,
    });
    const response = await this.#sendAndDecode(request, "send device message");
    const seq = response.privateSequence ?? 0;
    return {
      messageId: (random & 2_147_483_647) || seq,
      sequence: seq,
      clientSequence: clientSeq,
      random,
      timestamp: response.timestamp1 ?? Math.floor(Date.now() / 1_000),
    };
  }

  /**
   * Reply into an existing group temp session. reference/index.mjs:309290 `sendGroupTempMessage`.
   *
   * Wire primitive only — this does NOT verify the temp session exists. Unlike
   * `sendPrivate`, the uid is ALWAYS resolved: `grpTmp.toUid` is mandatory, so a temp
   * message cannot skip the lookup the way a text-only c2c message can.
   */
  async sendGroupTempMessage(
    userUin: number,
    groupUin: number,
    elements: readonly Segment[],
  ): Promise<SendMessageReceipt> {
    if (elements.length === 0) throw new Error("message is empty");
    assertWindowShakeSendPolicy(
      elements.filter((element) => element.type === "poke").length,
      elements.length,
      "group-temp",
    );
    const userUid = await this.#ctx.resolveUserUid(userUin);
    const protoElems = await buildSendElems(elements, {
      userUid,
      scene: "group-temp",
      tempGroupId: groupUin,
      ...(needsMediaUpload(elements)
        ? {
            uploadMedia: createMediaUploader({
              bridge: this.#ctx as unknown as MediaUploadContext["bridge"],
              // A temporary session uploads on the GROUP command with the temp scene,
              // which is why this is `true` even though the recipient is one person.
              isGroup: true,
              targetIdOrUid: String(groupUin),
              tempGroupId: groupUin,
              sessionCache: this.#mediaSessionCache,
            }),
          }
        : {}),
    });
    const random = this.#ctx.nextMessageRandom();
    const clientSeq = this.#ctx.nextClientSequence();
    const request = encodeSendMessageRequestRichText({
      routingHead: { grpTmp: { groupUin: BigInt(groupUin), toUid: userUid } },
      contentHead: { type: 1, subType: 0, c2cCmd: 11 },
      messageBody: { richText: { elems: protoElems.map((elem) => encodeElemForSend(elem)) } },
      clientSequence: clientSeq,
      random,
      syncCookie: new Uint8Array(0),
      via: 0,
      dataStatist: 0,
      ctrl: { msgFlag: Math.floor(Date.now() / 1_000) },
      multiSendSeq: 0,
    });
    const response = await this.#sendAndDecode(request, "send temp message");
    const seq = response.privateSequence ?? 0;
    return {
      messageId: (random & 2_147_483_647) || seq,
      sequence: seq,
      clientSequence: clientSeq,
      random,
      timestamp: response.timestamp1 ?? Math.floor(Date.now() / 1_000),
    };
  }

  /**
   * Send a c2c file as a chat message. reference/index.mjs:309358 `sendC2cFile`.
   *
   * Three wire details that differ from a normal c2c send, all recorded in the reference's
   * comment and all verified against Lagrange's `MessagePacker.BuildPacketBase`:
   *
   *   1. `routingHead.trans0x211 {ccCmd: 4}` instead of `routingHead.c2c`. The server
   *      rejects a file sent through the regular c2c slot.
   *   2. the `FileExtra` bytes go in `messageBody.msgContent`, NOT in
   *      `richText.notOnlineFile` — the receiver never reads that slot for file metadata.
   *   3. `contentHead.c2cCmd` stays 0. The `c2cCmd: 11` used by text sends is a stale
   *      go-cqhttp value the QQ-NT server does not recognise on the file path.
   *
   * The finalize (`0xE37_800`) is best-effort: on failure the file is sent without
   * `field6` rather than failing (issue #157).
   */
  async sendC2cFile(userUin: number, userUid: string, info: C2cFileInfo): Promise<SendMessageReceipt> {
    const random = this.#ctx.nextMessageRandom();
    const clientSeq = this.#ctx.nextClientSequence();
    const selfUid = await resolveSelfUid(this.#ctx);
    const fileHash = info.fileHash ?? "";
    let meta: OidbOfflineFileMetadata | null = null;
    try {
      const result = await invokeOidb(this.#ctx, FinalizeOfflineFile, {
        senderUid: selfUid,
        receiverUid: userUid,
        fileUuid: info.fileId,
        fileHash,
      });
      meta = isEmptyRecord(result) ? null : result;
    } catch (err) {
      log.warn(
        "c2c file finalize (0xE37_800) failed, sending without field6: %s",
        err instanceof Error ? err.message : String(err),
      );
    }
    const nowSec = Math.floor(Date.now() / 1_000);
    const fileExtra: FileExtra = {
      file: {
        fileType: 0,
        fileUuid: info.fileId,
        fileMd5: info.fileMd5,
        fileName: info.fileName,
        fileSize: BigInt(info.fileSize),
        subcmd: NOT_ONLINE_FILE_SUBCMD_C2C_SEND,
        dangerEvel: 0,
        expireTime: nowSec + FILE_EXPIRE_MINUTES * 60,
        fileHash,
      },
    };
    if (meta) {
      fileExtra.field6 = {
        field2: {
          field1: meta.field110,
          fileUuid: info.fileId,
          fileName: info.fileName,
          field6: meta.field3,
          field7: meta.field101,
          field8: meta.field100,
          timestamp1: meta.timestamp1,
          fileHash,
          selfUid,
          destUid: userUid,
        },
      };
    }
    const fileExtraBytes = encodeFileExtra(fileExtra);
    const request = encodeSendMessageRequestRichText({
      routingHead: { trans0x211: { ccCmd: 4, uid: userUid } },
      contentHead: { type: 1, subType: 0 },
      messageBody: { msgContent: fileExtraBytes },
      clientSequence: clientSeq,
      random,
      syncCookie: new Uint8Array(0),
      via: 0,
      dataStatist: 0,
      ctrl: { msgFlag: nowSec },
      multiSendSeq: 0,
    });
    const response = await this.#sendAndDecode(request, "send c2c file message");
    const seq = response.privateSequence ?? 0;
    return {
      messageId: (random & 2_147_483_647) || seq,
      sequence: seq,
      clientSequence: clientSeq,
      random,
      timestamp: response.timestamp1 ?? Math.floor(Date.now() / 1_000),
    };
  }

  /**
   * The private send paths' shared tail: transport check, decode, result check.
   *
   * Factored out because four methods repeat it verbatim; `sendGroup` keeps its own copy
   * because it reads a different receipt field and has an extra `seq <= 0` throw.
   */
  async #sendAndDecode(request: Uint8Array, what: string): Promise<{ result: number | null; errMsg: string | null; timestamp1: number | null; privateSequence: number | null }> {
    const result = await this.#ctx.sendRawPacket(SEND_MSG_CMD, request);
    if (!result.success || !result.gotResponse || !result.responseData) {
      throw new Error(`${what} failed: ${result.errorMessage || "no response"}`);
    }
    const response = decodeSendMessageResponse(result.responseData);
    if (response.result != null && response.result !== 0) {
      throw new Error(`${what} rejected: result=${response.result} err=${response.errMsg ?? ""}`);
    }
    return response;
  }

  // -------------------------------------------------------------------------
  // Recall
  // -------------------------------------------------------------------------

  /**
   * Recall a group message by sequence. reference/index.mjs:309444 `recallGroup`.
   *
   * Only `success` is checked, not `gotResponse`: a recall is accepted or refused at the
   * transport level and requiring a body would reject recalls that took effect. The
   * 2-minute window is server-side and enforced by the response, not here.
   */
  async recallGroup(groupId: number, sequence: number): Promise<void> {
    const request = encodeGroupRecallRequest({
      type: 1,
      groupUin: groupId,
      info: { sequence, random: 0, field3: 0 },
      settings: { field1: 0 },
    });
    const result = await this.#ctx.sendRawPacket(GROUP_RECALL_CMD, request);
    if (!result.success) throw new Error(result.errorMessage || "recall group message failed");
  }

  /**
   * Recall a c2c message. reference/index.mjs:309465 `recallPrivate`.
   *
   * `messageId` is `16777216n << 32n | BigInt(random >>> 0)` — a composite of a fixed
   * 0x1000000 discriminator and the message random, NOT the receipt's `messageId`. Passing
   * the receipt's `messageId` produces a recall that silently targets nothing.
   */
  async recallPrivate(
    userUin: number,
    clientSeq: number,
    msgSeq: number,
    random: number,
    timestamp: number,
  ): Promise<void> {
    const request = encodeC2CRecallRequest({
      type: 1,
      targetUid: await this.#ctx.resolveUserUid(userUin),
      info: {
        clientSequence: clientSeq,
        random,
        messageId: (16_777_216n << 32n) | BigInt(random >>> 0),
        timestamp,
        field5: 0,
        messageSequence: msgSeq,
      },
      settings: { field1: false, field2: false },
      field6: false,
    });
    const result = await this.#ctx.sendRawPacket(C2C_RECALL_CMD, request);
    if (!result.success) throw new Error(result.errorMessage || "recall private message failed");
  }

  // -------------------------------------------------------------------------
  // Read reports
  // -------------------------------------------------------------------------

  /** Mark a whole group conversation read. reference/index.mjs:309495 `markGroupRead`. */
  async markGroupRead(groupId: number): Promise<void> {
    await this.markAllRead([groupId], []);
  }

  /** Mark a whole private conversation read. reference/index.mjs:309499 `markPrivateRead`. */
  async markPrivateRead(userId: number): Promise<void> {
    await this.markAllRead([], [userId]);
  }

  /**
   * Mark every supplied conversation read. reference/index.mjs:309512 `markAllRead`.
   *
   * QQ NT caps each packet at 100 c2c plus 100 group entries and waits for the response
   * before the next page; the batch loop mirrors that rather than firing all pages at once.
   * `totalBatches` is the max of the two counts' batch totals, so a call with 250 groups
   * and 0 private users makes three batches with empty c2c lists.
   */
  async markAllRead(groupIds: readonly number[], privateUserIds: readonly number[]): Promise<void> {
    const groups = uniqueSessionIds(groupIds, "group");
    const privateUsers = uniqueSessionIds(privateUserIds, "private");
    const c2cTargets: C2cReadTarget[] = [];
    for (const userId of privateUsers) {
      const uid = await this.#ctx.resolveUserUid(userId);
      if (!uid) throw new Error(`failed to resolve uid for private read target ${userId}`);
      c2cTargets.push({ userId, uid });
    }
    const totalBatches = Math.max(
      Math.ceil(groups.length / READ_REPORT_BATCH_SIZE),
      Math.ceil(c2cTargets.length / READ_REPORT_BATCH_SIZE),
    );
    if (totalBatches === 0) return;
    log.debug("mark-read start: groups=%d c2c=%d batches=%d", groups.length, c2cTargets.length, totalBatches);
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
      const start = batchIndex * READ_REPORT_BATCH_SIZE;
      await this.markReadBatch(
        groups.slice(start, start + READ_REPORT_BATCH_SIZE),
        c2cTargets.slice(start, start + READ_REPORT_BATCH_SIZE),
        batchIndex + 1,
        totalBatches,
      );
    }
    log.debug("mark-read complete: groups=%d c2c=%d", groups.length, c2cTargets.length);
  }

  /** reference/index.mjs:309551 `sendReadReport`. One packet through the roaming gate. */
  async sendReadReport(
    request: SsoReadedReportReq,
    label: string,
    minimumGapMs: number = HISTORY_MIN_GAP_MS,
    signal?: AbortSignal,
  ): Promise<SsoReadedReportResp> {
    log.debug("%s send: groups=%d c2c=%d", label, request.groupList?.length ?? 0, request.c2cList?.length ?? 0);
    const payload = encodeSsoReadedReportReq(request);
    const response = decodeReadReportResponse(
      await this.#gate.run(minimumGapMs, () => this.#ctx.sendRawPacket(READ_REPORT_CMD, payload), signal),
      label,
    );
    log.debug("%s response: groups=%d c2c=%d", label, response.groupList?.length ?? 0, response.c2cList?.length ?? 0);
    return response;
  }

  /**
   * Read the server's cursors without advancing any read marker.
   * reference/index.mjs:309587 `probeHistorySyncState`.
   *
   * The zero-valued report fields are omitted on the wire, which is exactly the read-only
   * probe: a bare `{groupUin}` asks "where am I" and a bare `{uid}` likewise.
   */
  async probeHistorySyncState(
    groupIds: readonly number[],
    privateTargets: readonly HistorySyncPrivateTarget[],
    signal?: AbortSignal,
  ): Promise<HistorySyncProbe> {
    const groups = uniqueSessionIds(groupIds, "group");
    const privateUsers = uniqueHistorySyncPrivateTargets(privateTargets);
    const maxTargets = LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.maxTargetsPerKind;
    if (groups.length > maxTargets) throw new Error(`history sync probe accepts at most ${maxTargets} group targets`);
    if (privateUsers.length > maxTargets) throw new Error(`history sync probe accepts at most ${maxTargets} private targets`);
    if (groups.length === 0 && privateUsers.length === 0) return { groups: [], privateUsers: [] };
    const label = "login history sync probe";
    const response = await this.sendReadReport(
      {
        groupList: groups.map((groupId) => ({ groupUin: BigInt(groupId), lastReadSeq: 0n })),
        c2cList: privateUsers.map((target) => ({ uid: target.uid, lastReadTime: 0n, lastReadSeq: 0n })),
      },
      label,
      LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.minimumGapMs,
      signal,
    );
    return {
      groups: groups.map((groupId, index) => {
        const item = this.#groupReadResponse(response, groupId, index, label);
        const readSeq = readSafeSequence(item.readSeq, `${label} group ${groupId} read sequence`);
        const latestSeq = readSafeSequence(item.latestSeq, `${label} group ${groupId} latest sequence`);
        if (latestSeq < readSeq) {
          throw new Error(`${label} group ${groupId} latest sequence ${latestSeq} is before read sequence ${readSeq}`);
        }
        return { groupId, readSeq, latestSeq };
      }),
      privateUsers: privateUsers.map((target, index) => {
        const item = this.#c2cReadResponse(response, target, index, label);
        const targetUin = readSafeSequence(item.targetUin, `${label} private user ${target.userId} target uin`);
        if (targetUin !== 0 && targetUin !== target.userId) {
          throw new Error(`${label} private user ${target.userId} response target ${targetUin} does not match`);
        }
        const readSeq = readSafeSequence(item.readSeq, `${label} private user ${target.userId} read sequence`);
        const latestSeq = readSafeSequence(item.latestSeq, `${label} private user ${target.userId} latest sequence`);
        if (latestSeq < readSeq) {
          throw new Error(
            `${label} private user ${target.userId} latest sequence ${latestSeq} is before read sequence ${readSeq}`,
          );
        }
        return {
          ...target,
          readSeq,
          latestSeq,
          lastMsgTime: readSafeSequence(item.lastMsgTime, `${label} private user ${target.userId} last message time`),
        };
      }),
    };
  }

  #groupReadResponse(
    response: SsoReadedReportResp,
    groupId: number,
    index: number,
    label: string,
  ): GroupReadedReportResponseItem {
    const groupUin = BigInt(groupId);
    return requireReadResponseItem(
      response.groupList,
      index,
      (item) => item.groupUin === groupUin,
      `${label} group ${groupId}`,
    );
  }

  #c2cReadResponse(
    response: SsoReadedReportResp,
    target: C2cReadTarget,
    index: number,
    label: string,
  ): C2CReadedReportResponseItem {
    return requireReadResponseItem(response.c2cList, index, (item) => item.uid === target.uid, `${label} private user ${target.userId}`);
  }

  /**
   * One batch of `markAllRead`: probe, then confirm. reference/index.mjs:309666.
   *
   * The confirmation step verifies the server did not move the cursor BACKWARD. That check
   * is the whole point of the second round trip: a silently ignored advance would otherwise
   * leave the caller believing the conversation was marked read.
   */
  async markReadBatch(
    groupIds: readonly number[],
    c2cTargets: readonly C2cReadTarget[],
    batchIndex: number,
    totalBatches: number,
  ): Promise<void> {
    const batchLabel = `mark-read batch ${batchIndex}/${totalBatches}`;
    const probe = await this.sendReadReport(
      {
        groupList: groupIds.map((groupId) => ({ groupUin: BigInt(groupId), lastReadSeq: 0n })),
        c2cList: c2cTargets.map((target) => ({ uid: target.uid, lastReadTime: 0n, lastReadSeq: 0n })),
      },
      `${batchLabel} probe`,
    );
    const groupList: { groupUin: bigint; lastReadSeq: bigint }[] = [];
    for (let i = 0; i < groupIds.length; i += 1) {
      const groupId = groupIds[i]!;
      const item = this.#groupReadResponse(probe, groupId, i, `${batchLabel} probe`);
      const readSeq = readUnsignedSequence(item.readSeq, `${batchLabel} group ${groupId} read sequence`);
      const latestSeq = readUnsignedSequence(item.latestSeq, `${batchLabel} group ${groupId} latest sequence`);
      if (latestSeq < readSeq) {
        throw new Error(`${batchLabel} group ${groupId} latest sequence ${latestSeq} is before read sequence ${readSeq}`);
      }
      if (latestSeq > readSeq) groupList.push({ groupUin: BigInt(groupId), lastReadSeq: latestSeq });
    }
    const c2cList: { uid: string; lastReadTime: bigint; lastReadSeq: bigint }[] = [];
    const c2cConfirmTargets: C2cReadTarget[] = [];
    for (let i = 0; i < c2cTargets.length; i += 1) {
      const target = c2cTargets[i]!;
      const item = this.#c2cReadResponse(probe, target, i, `${batchLabel} probe`);
      const readSeq = readUnsignedSequence(item.readSeq, `${batchLabel} private user ${target.userId} read sequence`);
      const latestSeq = readUnsignedSequence(item.latestSeq, `${batchLabel} private user ${target.userId} latest sequence`);
      if (latestSeq < readSeq) {
        throw new Error(
          `${batchLabel} private user ${target.userId} latest sequence ${latestSeq} is before read sequence ${readSeq}`,
        );
      }
      if (latestSeq > readSeq) {
        const lastMsgTime = requirePositiveSequence(
          item.lastMsgTime,
          `${batchLabel} private user ${target.userId} last message time`,
        );
        c2cList.push({ uid: target.uid, lastReadTime: lastMsgTime, lastReadSeq: latestSeq });
        c2cConfirmTargets.push(target);
      }
    }
    if (groupList.length === 0 && c2cList.length === 0) {
      log.debug("%s already current", batchLabel);
      return;
    }
    const confirm = await this.sendReadReport({ groupList, c2cList }, `${batchLabel} confirm`);
    for (let i = 0; i < groupList.length; i += 1) {
      const requested = groupList[i]!;
      const groupId = Number(requested.groupUin);
      const readSeq = readUnsignedSequence(
        this.#groupReadResponse(confirm, groupId, i, `${batchLabel} confirm`).readSeq,
        `${batchLabel} group ${groupId} confirmed read sequence`,
      );
      if (readSeq < requested.lastReadSeq) {
        throw new Error(
          `${batchLabel} group ${groupId} confirmed sequence ${readSeq} before requested ${requested.lastReadSeq}`,
        );
      }
    }
    for (let i = 0; i < c2cList.length; i += 1) {
      const requested = c2cList[i]!;
      const target = c2cConfirmTargets[i]!;
      const readSeq = readUnsignedSequence(
        this.#c2cReadResponse(confirm, target, i, `${batchLabel} confirm`).readSeq,
        `${batchLabel} private user ${target.userId} confirmed read sequence`,
      );
      if (readSeq < requested.lastReadSeq) {
        throw new Error(
          `${batchLabel} private user ${target.userId} confirmed sequence ${readSeq} before requested ${requested.lastReadSeq}`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  /**
   * Fetch group history, walking backward or forward from the anchor.
   * reference/index.mjs:309741 `getGroupHistory`.
   */
  async getGroupHistory(
    groupUin: number,
    anchorSeq: number,
    count: number,
    selfUin = 0,
    reverseOrder = true,
  ): Promise<MsgPushEvent[]> {
    if (!(groupUin > 0)) return [];
    const fetchWindow = (start: number, end: number): Promise<MsgPushEvent[]> =>
      fetchGroupMessageRange(this.#ctx, this.#ctx.identity, selfUin, groupUin, start, end);
    return reverseOrder
      ? walkBackHistory(anchorSeq, count, this.#gate, fetchWindow, GROUP_SEQUENCE)
      : walkForwardHistory(anchorSeq, count, this.#gate, fetchWindow, GROUP_SEQUENCE);
  }

  /**
   * One bounded group-history window for login sync. Never paginates or retries.
   * reference/index.mjs:309751 `getGroupHistorySyncPage`.
   */
  async getGroupHistorySyncPage(
    groupUin: number,
    startSeq: number,
    endSeq: number,
    selfUin = 0,
    signal?: AbortSignal,
  ): Promise<MsgPushEvent[]> {
    if (!Number.isSafeInteger(groupUin) || groupUin <= 0) {
      throw new Error(`group history sync target is invalid: ${String(groupUin)}`);
    }
    validateHistorySyncRange(startSeq, endSeq, `group ${groupUin} history sync`);
    const messages = await this.#gate.run(
      LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.minimumGapMs,
      () => fetchGroupMessageRange(this.#ctx, this.#ctx.identity, selfUin, groupUin, startSeq, endSeq),
      signal,
    );
    return this.#validateHistorySyncPage(messages, GROUP_SEQUENCE, startSeq, endSeq, `group ${groupUin} history sync`);
  }

  /**
   * Fetch private history, walking from the anchor. reference/index.mjs:309764 `getC2cHistory`.
   *
   * Sorts by `ntMsgSeq` rather than the message-head sequence: c2c sequences are
   * conversation-wide only in the NT field.
   */
  async getC2cHistory(
    friendUid: string,
    anchorSeq: number,
    count: number,
    selfUin = 0,
    reverseOrder = true,
  ): Promise<MsgPushEvent[]> {
    if (!friendUid) return [];
    const fetchWindow = (start: number, end: number): Promise<MsgPushEvent[]> =>
      fetchC2cMessageRange(this.#ctx, this.#ctx.identity, selfUin, friendUid, start, end);
    return reverseOrder
      ? walkBackHistory(anchorSeq, count, this.#gate, fetchWindow, C2C_SEQUENCE)
      : walkForwardHistory(anchorSeq, count, this.#gate, fetchWindow, C2C_SEQUENCE);
  }

  /** One bounded private-history window for login sync. reference/index.mjs:309778 `getC2cHistorySyncPage`. */
  async getC2cHistorySyncPage(
    friendUid: string,
    startSeq: number,
    endSeq: number,
    selfUin = 0,
    signal?: AbortSignal,
  ): Promise<MsgPushEvent[]> {
    if (!friendUid.trim()) throw new Error("private history sync uid is required");
    validateHistorySyncRange(startSeq, endSeq, `private ${friendUid} history sync`);
    const messages = await this.#gate.run(
      LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.minimumGapMs,
      () => fetchC2cMessageRange(this.#ctx, this.#ctx.identity, selfUin, friendUid, startSeq, endSeq),
      signal,
    );
    return this.#validateHistorySyncPage(messages, C2C_SEQUENCE, startSeq, endSeq, `private ${friendUid} history sync`);
  }

  /**
   * One latest private roaming page for a session with no local authoritative sequence.
   * reference/index.mjs:309790 `getC2cLatestHistorySyncPage`.
   *
   * Duplicate NT sequences are collapsed by a `Map` built from the page, so a server that
   * repeats a message within one page yields one event. The final length check catches a
   * server that ignored `count`.
   */
  async getC2cLatestHistorySyncPage(
    friendUid: string,
    count: number,
    selfUin = 0,
    beforeTime = Math.floor(Date.now() / 1_000) + 1,
    signal?: AbortSignal,
  ): Promise<MsgPushEvent[]> {
    if (!friendUid.trim()) throw new Error("private history sync uid is required");
    const maxMessages = LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.maxMessagesPerSession;
    if (!Number.isSafeInteger(count) || count < 1 || count > maxMessages) {
      throw new Error(`private history sync may request at most ${maxMessages} messages`);
    }
    const page: C2cRoamPage = await this.#gate.run(
      LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS.minimumGapMs,
      () => fetchC2cRoamMessagePage(this.#ctx, this.#ctx.identity, selfUin, friendUid, beforeTime, count, 0),
      signal,
    );
    const messages = [
      ...new Map(
        page.messages.map((message) => {
          const sequence = sequenceField(message, "ntMsgSeq");
          if (!Number.isSafeInteger(sequence) || sequence <= 0) {
            throw new Error(`private ${friendUid} history sync returned invalid NT sequence ${String(sequence)}`);
          }
          return [sequence, message];
        }),
      ).values(),
    ].sort((a, b) => sequenceField(a, "ntMsgSeq") - sequenceField(b, "ntMsgSeq") || timeField(a) - timeField(b));
    if (messages.length > count) {
      throw new Error(
        `private ${friendUid} history sync returned ${messages.length} messages for a ${count}-message request`,
      );
    }
    return messages;
  }

  /**
   * Latest private history page without a locally cached sequence.
   * reference/index.mjs:309818 `getC2cLatestHistory`.
   *
   * Two loop guards, both needed: `reachedEnd` on `isComplete` OR an all-zero cursor, and a
   * `seenCursors` set so a server that echoes the cursor does not loop forever inside the
   * request budget. Exhausting the budget without `reachedEnd` throws rather than returning
   * a partial page, because a partial page here would be cached as "the conversation starts
   * here".
   */
  async getC2cLatestHistory(
    friendUid: string,
    count: number,
    selfUin = 0,
    beforeTime = Math.floor(Date.now() / 1_000) + 1,
  ): Promise<MsgPushEvent[]> {
    if (!friendUid) return [];
    const want = Math.min(Math.max(1, Math.trunc(count) || 0), HISTORY_MAX_COUNT);
    const collected = new Map<number, MsgPushEvent>();
    let cursor = { time: beforeTime, random: 0 };
    const seenCursors = new Set<string>([`${cursor.time}:${cursor.random}`]);
    let reachedEnd = false;
    for (let i = 0; i < HISTORY_MAX_REQUESTS && collected.size < want; i += 1) {
      const page = await this.#gate.run(HISTORY_MIN_GAP_MS, () =>
        fetchC2cRoamMessagePage(
          this.#ctx,
          this.#ctx.identity,
          selfUin,
          friendUid,
          cursor.time,
          Math.min(want - collected.size, PRIVATE_HISTORY_PAGE_SIZE),
          cursor.random,
        ),
      );
      for (const message of page.messages) {
        const sequence = sequenceField(message, "ntMsgSeq");
        if (!Number.isSafeInteger(sequence) || sequence <= 0) {
          throw new Error(`private roam history returned invalid NT sequence ${String(sequence)}`);
        }
        collected.set(sequence, message);
      }
      if (collected.size >= want) break;
      if (page.isComplete || (page.cursor.time === 0 && page.cursor.random === 0)) {
        reachedEnd = true;
        break;
      }
      const nextCursorKey = `${page.cursor.time}:${page.cursor.random}`;
      if (seenCursors.has(nextCursorKey)) {
        throw new Error(`private roam history cursor did not advance from ${cursor.time}/${cursor.random}`);
      }
      seenCursors.add(nextCursorKey);
      cursor = page.cursor;
    }
    if (collected.size < want && !reachedEnd) {
      throw new Error(
        `private roam history request budget exhausted after ${HISTORY_MAX_REQUESTS} pages (requested=${want}, collected=${collected.size})`,
      );
    }
    return [...collected.values()]
      .sort((a, b) => sequenceField(a, "ntMsgSeq") - sequenceField(b, "ntMsgSeq") || timeField(a) - timeField(b))
      .slice(-want);
  }

  /**
   * One group message by exact sequence, through the gate. Returns null on miss AND on
   * error. reference/index.mjs:309866 `getGroupMessageBySeq`.
   *
   * The blanket `catch` is deliberate: this is the reply back-fill path, and a failure to
   * back-fill must not fail the message being sent.
   */
  async getGroupMessageBySeq(groupUin: number, seq: number, selfUin = 0): Promise<MsgPushEvent | null> {
    if (!(groupUin > 0) || !(seq > 0)) return null;
    try {
      const messages = await this.#gate.run(HISTORY_MIN_GAP_MS, () =>
        fetchGroupMessageRange(this.#ctx, this.#ctx.identity, selfUin, groupUin, seq, seq),
      );
      return messages.find((m) => sequenceField(m, "msgSeq") === seq) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * One c2c message by exact conversation-wide NT sequence. Returns null on miss and error.
   * reference/index.mjs:309878 `getC2cMessageBySeq`.
   */
  async getC2cMessageBySeq(friendUid: string, seq: number, selfUin = 0): Promise<MsgPushEvent | null> {
    if (!friendUid || !(seq > 0)) return null;
    try {
      const messages = await this.#gate.run(HISTORY_MIN_GAP_MS, () =>
        fetchC2cMessageRange(this.#ctx, this.#ctx.identity, selfUin, friendUid, seq, seq),
      );
      return messages.find((m) => sequenceField(m, "ntMsgSeq") === seq) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * reference/index.mjs:309890 `validateHistorySyncPage`.
   *
   * Collapses duplicate sequences and re-sorts, after rejecting any message outside the
   * requested range. The range check is what stops a server that pads a response with
   * neighbours from poisoning the sync cursor.
   */
  #validateHistorySyncPage(
    messages: readonly MsgPushEvent[],
    sequenceOf: SequenceOf,
    startSeq: number,
    endSeq: number,
    label: string,
  ): MsgPushEvent[] {
    const bySequence = new Map<number, MsgPushEvent>();
    for (const message of messages) {
      const sequence = sequenceOf(message);
      if (!Number.isSafeInteger(sequence) || sequence < startSeq || sequence > endSeq) {
        throw new Error(`${label} returned sequence ${String(sequence)} outside requested range ${startSeq}-${endSeq}`);
      }
      bySequence.set(sequence, message);
    }
    return [...bySequence.values()].sort((a, b) => sequenceOf(a) - sequenceOf(b));
  }

  /**
   * Pick the c2c item that answers THIS target out of a read-report response.
   *
   * Matched by `uid`, not by position: the server may answer several sessions in one
   * response, and `index` is only the fallback the shared helper uses when no uid matches.
   * The `label` reaches the error message, so a multi-target caller can say which target
   * failed without re-wrapping the error.
   */
  c2cReadResponse(
    response: { c2cList?: readonly { uid: string; resultCode: number | null; errorMessage: string | null }[] },
    target: { uid: string; userId: number },
    index: number,
    label: string,
  ): { uid: string; resultCode: number | null; errorMessage: string | null } {
    return requireReadResponseItem(
      response.c2cList,
      index,
      (item) => item.uid === target.uid,
      `${label} private user ${target.userId}`,
    );
  }

  /**
   * The group counterpart of {@link c2cReadResponse}.
   *
   * `groupUin` is compared as a BigInt in the reference because the field arrives as a
   * 64-bit integer that a JS number cannot hold exactly; `BigInt(groupId)` keeps that
   * comparison exact instead of silently rounding for large group numbers.
   */
  groupReadResponse(
    response: { groupList?: readonly { groupUin: bigint; resultCode: number | null; errorMessage: string | null }[] },
    groupId: number,
    index: number,
    label: string,
  ): { groupUin: bigint; resultCode: number | null; errorMessage: string | null } {
    const groupUin = BigInt(groupId);
    return requireReadResponseItem(
      response.groupList,
      index,
      (item) => item.groupUin === groupUin,
      `${label} group ${groupId}`,
    );
  }

  /**
   * Validate one history-sync page and return it ordered by sequence.
   *
   * Four checks in one pass, and each protects a different caller assumption: every
   * sequence must be a SAFE integer (a lossy 64-bit read would silently reorder), inside
   * the REQUESTED range (the server may answer more than asked), unique (a duplicate would
   * be delivered twice), and the result is sorted so the caller can append without
   * re-sorting.
   */
  validateHistorySyncPage<T>(
    messages: readonly T[],
    sequenceOf: (message: T) => number,
    startSeq: number,
    endSeq: number,
    label: string,
  ): T[] {
    const bySequence = new Map<number, T>();
    for (const message of messages) {
      const sequence = sequenceOf(message);
      if (!Number.isSafeInteger(sequence) || sequence < startSeq || sequence > endSeq) {
        throw new Error(
          `${label} returned sequence ${String(sequence)} outside requested range ${startSeq}-${endSeq}`,
        );
      }
      bySequence.set(sequence, message);
    }
    return [...bySequence.values()].sort((a, b) => sequenceOf(a) - sequenceOf(b));
  }
}

// ===========================================================================
// Local helpers
// ===========================================================================

/**
 * `buildSendElems` returns decoded-shape `Elem` objects; the wire layer wants bytes.
 *
 * `encodeSendRichText` in `element-builder.ts` already does exactly this, so the mapping
 * is a thin re-export rather than a second encoder. Keeping it named here documents why a
 * decoded-looking value is being re-encoded on the send path.
 */
function encodeElemForSend(elem: Elem): Uint8Array {
  return encodeElem(elem);
}

/**
 * `FinalizeOfflineFile` returns `Record<string, never>` (an empty object) when the response
 * carried no metadata, so "no metadata" and "metadata" are different shapes rather than
 * `null` versus object.
 */
function isEmptyRecord(value: OidbOfflineFileMetadata | Record<string, never>): value is Record<string, never> {
  return Object.keys(value).length === 0;
}