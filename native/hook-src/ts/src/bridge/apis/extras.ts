// `ExtrasApi` — the reference's `extras` hub slot.
//
// Reference region: reference/index.mjs:82407-82611 (`var ExtrasApi = class`), plus
// the three module-private helpers immediately above it at 82386-82406
// (`log$44`, `AI_VOICE_RECEIPT_TIMEOUT_MS`, `AI_VOICE_CANDIDATE_LIMIT`,
// `AI_VOICE_CLAIM_LIMIT`, `normalizeMediaUuid`, `matchesAiVoiceEvent`,
// `describeAiVoiceFingerprint`).
//
// ---------------------------------------------------------------------------
// What is implemented, and what is not
// ---------------------------------------------------------------------------
// Ported whole (the class is 205 reference lines; eleven of its members):
//
//   getGroupTodoList    0x9474_0 GetGroupTodoList
//   setGroupTodo        0x0f90   GroupTodo action=set
//   completeGroupTodo   0x0f90   GroupTodo action=complete
//   cancelGroupTodo     0x0f90   GroupTodo action=cancel
//   getStrangerStatus   0xfe1_2  GetStrangerStatus
//   fetchAiVoiceList    0x929d_0 FetchAiVoiceList
//   fetchAiVoice        0x929b_0 FetchAiVoice (30-poll retry loop)
//   sendAiVoice         0x929b_0 + event-bus receipt correlation   ← the hard one
//
// Named throws, each because the dependency genuinely does not exist here:
//
//   convertRecord        needs a SILK-capable ffmpeg addon (`convertAudioBytes`).
//                        `loadBinarySource` exists; the transcoder does not, and no
//                        amount of TypeScript can produce one.
//   translatePttToText   needs the `pttTrans` codec pair (`protobuf_encode_PttTransReq`
//                        / `protobuf_decode_PttTransResp`, reference:81426-82100) and
//                        the two bare services `pttTrans.TransGroupPttReq` /
//                        `pttTrans.TransC2CPttReq`. Neither is in `oidb/services/`.
//                        No action in this port reaches it — `get_ptt_text` &
//                        friends go through the host's `ctx.fetchPttText` — so this
//                        is a named refusal, not a silent hole.
//
// ---------------------------------------------------------------------------
// ★ `sendAiVoice` is a REQUEST + RECEIPT-WAIT composite, not invoke-and-return
// ---------------------------------------------------------------------------
// The 0x929b completion response carries the media node but, on live QQ, omits the
// group message sequence. So the canonical sequence can only be learned from the
// *echo*: QQ pushes the just-sent voice back as a `group_message` whose sender is
// the bot itself. `sendAiVoice` therefore:
//
//   1. subscribes to `group_message` BEFORE publishing, so an echo that arrives
//      while the OIDB call is still in flight is BUFFERED rather than lost. This
//      ordering is load-bearing and is the reference's (reference:82530 is above
//      82533): swapping the two lines makes the method lose receipts under load.
//   2. publishes (`fetchAiVoice`).
//   3. correlates by the exact media UUID. Never by content hash, never by "the
//      next voice in the group" — two concurrent requests can legitimately render
//      byte-identical audio, and a hash match would hand one caller the other's
//      sequence.
//   4. de-duplicates claims ACROSS calls: `claimedAiVoiceReceiptKeys` is one
//      bounded (256) insertion-ordered `Set` per `ExtrasApi` instance, so a second
//      call cannot claim the same `groupId:msgSeq:msgId` twice. Note this is the
//      instance's set, while `receiptSettled` is per-call — the two together are
//      what make a receipt belong to exactly one caller.
//   5. distinguishes CANDIDATE OVERFLOW from TIMEOUT. They are different errors
//      with different wording, because they mean different things: "I watched 64
//      other self voice messages go by and the one I wanted may have been pushed
//      out" is not "nothing showed up in 5 s".
//
// The `finally` clears the timer and unsubscribes on EVERY exit path — success,
// timeout, overflow, a throwing publish, an invalid sequence. A per-call
// subscription that survives its call is the classic leak here: after a few
// thousand sends the bus would hold thousands of dead handlers, each retaining a
// captured `candidates` array.
//
// ---------------------------------------------------------------------------
// Reference quirks reproduced on purpose (NOT fixed)
// ---------------------------------------------------------------------------
// 1. `receiptPromise` is created with only a `resolve` and is never rejected, so
//    when the timeout wins the race it stays PENDING forever. That is harmless
//    (nothing awaits it once the race settles, and `accept` is unsubscribed) but it
//    does mean "the promise is settled" is never a property one can rely on.
// 2. `candidates` only receives events that did NOT match-and-claim. Events seen
//    before `expectedNode` is set can never match (the gate is `expectedNode &&`),
//    so they all land in the buffer — which is exactly the race the subscription
//    order is there to handle.
// 3. `claimedAiVoiceReceiptKeys` is pruned by ONE entry per insert, so the bound is
//    a bound and not a target: the set sits at 257 briefly and evicts the oldest
//    insertion (Set iteration order), not the least-recently used. A receipt that
//    was claimed long ago but re-arrives can be claimed again once evicted.
// 4. The overflow error is only raised when `candidatesOverflowed` is set AND no
//    buffered candidate matched. An overflow that happened but whose wanted event
//    is still buffered reports success. That is the reference's behaviour.

import { createLogger } from "../../onebot/log.js";
import type { BridgeContext, BridgeEvent, Unsubscribe } from "../context.js";
import { oidbCaller } from "../oidb-invoke.js";
import {
  FetchAiVoice,
  FetchAiVoiceList,
  GetGroupTodoList,
  GetStrangerStatus,
  GroupTodo,
  type GroupTodoEntry,
  type OidbAiVoiceIndexNode,
  type OidbAiVoiceListCategory,
} from "../../oidb/services/index.js";

const log = createLogger("Bridge.Extras");

/**
 * Default receipt wait (reference:82387 `5e3`).
 *
 * Five seconds is the reference's number, not a guess: the echo normally arrives in
 * well under a second on a healthy connection, and a longer window only makes a
 * genuinely lost receipt slower to surface. Overridable per call (`sendAiVoice`'s
 * fifth argument) — that parameter is the reference's too, and tests depend on it.
 */
export const AI_VOICE_RECEIPT_TIMEOUT_MS = 5_000;

/**
 * How many unmatched self voice messages are buffered while waiting
 * (reference:82388 `64`).
 *
 * Bounded because a busy group can produce a stream of them, and because the whole
 * point of the buffer is to cover the publish→echo race, not to hold history.
 */
export const AI_VOICE_CANDIDATE_LIMIT = 64;

/**
 * How many receipts are remembered for cross-call de-duplication
 * (reference:82389 `256`).
 */
export const AI_VOICE_CLAIM_LIMIT = 256;

/**
 * `normalizeMediaUuid` (reference:82390): trim a string, and answer `""` for
 * anything that is not a string.
 *
 * The `""` matters twice: an empty expected UUID makes `matchesAiVoiceEvent` answer
 * `false` for every event (so a fingerprint-less node can never correlate), and an
 * empty element UUID never equals a non-empty one.
 */
function normalizeMediaUuid(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The shape `sendAiVoice` reads off a bus event.
 *
 * Deliberately the *minimum*: the reference reads `groupId`, `senderUin`,
 * `selfUin`, `msgSeq`, `msgId` and `elements`, and nothing else. The scalar members
 * are typed as their natural type because the reference compares them with `!==`
 * and does NO coercion — an event whose `senderUin` is the string `"123"` therefore
 * does NOT match a `selfUin` of `123`, and a port that `Number(...)`-ed them would
 * silently accept it.
 */
interface AiVoiceReceiptEvent {
  readonly groupId: number;
  readonly senderUin: number;
  readonly selfUin: number;
  readonly msgSeq: number;
  readonly msgId: number;
  readonly elements: readonly unknown[];
}

/** A `record` element, as far as receipt correlation can see it. */
interface ReceiptRecordElement {
  readonly type: "record";
  readonly fileId?: unknown;
  readonly mediaNode?: { readonly fileUuid?: unknown } | undefined;
}

/**
 * Re-view a `BridgeEvent` as an `AiVoiceReceiptEvent`.
 *
 * A CAST, not a validator, and that is deliberate: the reference body is untyped, so
 * a malformed `group_message` reaches it as `undefined` and fails at the first
 * dereference (`event.elements.some` → TypeError) or simply does not match. Adding
 * validation here would be a behaviour change dressed as robustness — the bus turns
 * a throwing handler into an `onError` report, which is the reference's own
 * containment.
 */
function asReceiptEvent(event: BridgeEvent): AiVoiceReceiptEvent {
  return event as unknown as AiVoiceReceiptEvent;
}

/**
 * `matchesAiVoiceEvent` (reference:82393) — does this event carry the node we
 * published?
 *
 * The comparison is `element.mediaNode?.fileUuid || element.fileId`, i.e. a falsy
 * `fileUuid` falls back to `fileId`. Both sides go through `normalizeMediaUuid`, so
 * `" uuid "` matches `"uuid"` and a non-string never matches anything.
 */
function matchesAiVoiceEvent(node: OidbAiVoiceIndexNode, event: AiVoiceReceiptEvent): boolean {
  const expectedUuid = normalizeMediaUuid(node.fileUuid);
  if (!expectedUuid) return false;
  for (const raw of event.elements) {
    const element = raw as ReceiptRecordElement | null;
    if (element === null || typeof element !== "object") continue;
    if (element.type !== "record") continue;
    if (normalizeMediaUuid(element.mediaNode?.fileUuid || element.fileId) === expectedUuid) return true;
  }
  return false;
}

/**
 * `describeAiVoiceFingerprint` (reference:82402) — the last 12 characters of the
 * UUID, or `"missing"`.
 *
 * Only a diagnostic string for error messages and logs; the twelve-character slice
 * keeps a UUID's entropy visible without printing the whole identifier into a log
 * line. `"missing"` is also the sentinel `sendAiVoice` tests to refuse a node that
 * cannot be correlated.
 */
function describeAiVoiceFingerprint(node: OidbAiVoiceIndexNode): string {
  const uuid = normalizeMediaUuid(node.fileUuid);
  if (uuid) return `uuid:${uuid.slice(-12)}`;
  return "missing";
}

/** One AI voice synthesis poll's answer, or `null` while the render is in flight. */
export interface AiVoiceReceipt {
  /** The group message sequence of the echoed voice — what the action hashes into a message id. */
  sequence: number;
}

export class ExtrasApi {
  readonly #ctx: BridgeContext;

  /**
   * Receipts already claimed by SOME call on this instance (reference:82409
   * `claimedAiVoiceReceiptKeys = new Set()`).
   *
   * Public in the reference and public here: it is plain state, and a test (or a
   * future diagnostic) needs to see the bound rather than trust a comment about it.
   */
  readonly claimedAiVoiceReceiptKeys = new Set<string>();

  constructor(ctx: BridgeContext) {
    this.#ctx = ctx;
  }

  async getGroupTodoList(groupId: number): Promise<GroupTodoEntry[]> {
    const items = await oidbCaller(GetGroupTodoList).invoke(this.#ctx, { groupId });
    log.debug("group todo list fetched group=%d count=%d", groupId, items.length);
    return items;
  }

  setGroupTodo(groupId: number, msgSeq: bigint): Promise<undefined> {
    return oidbCaller(GroupTodo).invoke(this.#ctx, { groupId, msgSeq, action: "set" });
  }

  completeGroupTodo(groupId: number, msgSeq: bigint): Promise<undefined> {
    return oidbCaller(GroupTodo).invoke(this.#ctx, { groupId, msgSeq, action: "complete" });
  }

  cancelGroupTodo(groupId: number, msgSeq: bigint): Promise<undefined> {
    return oidbCaller(GroupTodo).invoke(this.#ctx, { groupId, msgSeq, action: "cancel" });
  }

  /**
   * Keeps the action response user-safe while retaining the underlying failure in
   * the service log for diagnosis (reference:82439-82452).
   *
   * The `try`/`catch` is the whole method: a status query that fails answers `null`
   * and logs, so `nc_get_user_status` reports its own "failed to fetch user status"
   * instead of a packet-level error string. `null` is also what a *successful*
   * response with no status property answers, which is why the warning below can
   * only say "returned no status", not "failed".
   */
  async getStrangerStatus(uin: number): Promise<{ status: number; ext_status: number } | null> {
    try {
      const status = await oidbCaller(GetStrangerStatus).invoke(this.#ctx, { uin });
      if (!status) log.warn("user status query returned no status target=%d", uin);
      return status;
    } catch (error) {
      log.warn(
        "user status query failed target=%d: %s",
        uin,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  fetchAiVoiceList(groupId: number, chatType: number): Promise<OidbAiVoiceListCategory[]> {
    return oidbCaller(FetchAiVoiceList).invoke(this.#ctx, { groupId, chatType });
  }

  /**
   * Trigger AI voice synthesis (reference:82459-82486).
   *
   * The server may answer an EMPTY msgInfo while the render is still in flight, so
   * this polls until a node materialises or the cap is hit — `maxRetries = 30`, the
   * same budget napcat uses. One `sessionId` is generated per call and reused across
   * every poll: the server correlates the polls of one synthesis request by it, so
   * regenerating per iteration would start 30 separate syntheses.
   *
   * `sessionId` is `Math.floor(Math.random() * 4294967295) >>> 0` — the reference's
   * exact expression, including the `>>> 0` that makes it an unsigned 32-bit int.
   *
   * The returned node plugs straight into `groupFile.getPttUrl`, which is why
   * `get_ai_record` needs nothing else. The response carries NO reliable sequence;
   * a caller that needs one must use `sendAiVoice`.
   */
  async fetchAiVoice(
    groupId: number,
    voiceId: string,
    text: string,
    chatType: number,
    maxRetries = 30,
  ): Promise<OidbAiVoiceIndexNode> {
    const sessionId = Math.floor(Math.random() * 4294967295) >>> 0;
    for (let i = 0; i < maxRetries; i += 1) {
      const node = await oidbCaller(FetchAiVoice).invoke(this.#ctx, {
        groupId,
        voiceId,
        text,
        chatType,
        sessionId,
      });
      if (node) {
        log.debug(
          "AI voice synthesis completed group=%d media=%s polls=%d",
          groupId,
          describeAiVoiceFingerprint(node),
          i + 1,
        );
        return node;
      }
    }
    throw new Error(`AI voice synthesis did not complete after ${maxRetries} polls`);
  }

  /**
   * Publish an AI voice and wait for QQ's canonical self-message receipt
   * (reference:82496-82552).
   *
   * Read the file header before changing anything here: the subscription order, the
   * two de-duplication layers, and the three distinct failure modes are all
   * load-bearing and all reproduced from the reference.
   */
  async sendAiVoice(
    groupId: number,
    voiceId: string,
    text: string,
    chatType: number,
    receiptTimeoutMs = AI_VOICE_RECEIPT_TIMEOUT_MS,
  ): Promise<AiVoiceReceipt> {
    /** Self voice messages that arrived before the node was known, or that did not match it. */
    const candidates: AiVoiceReceiptEvent[] = [];
    let candidatesOverflowed = false;
    let expectedNode: OidbAiVoiceIndexNode | null = null;
    let receiptSettled = false;
    let resolveReceipt: ((event: AiVoiceReceiptEvent) => void) | null = null;
    const receiptPromise = new Promise<AiVoiceReceiptEvent>((resolve) => {
      resolveReceipt = resolve;
    });

    /**
     * Take ownership of one receipt. `false` means "somebody else has it, or this
     * call already settled" — in both cases the event must not resolve anything.
     */
    const claim = (event: AiVoiceReceiptEvent): boolean => {
      if (receiptSettled) return false;
      const key = `${event.groupId}:${event.msgSeq}:${event.msgId}`;
      if (this.claimedAiVoiceReceiptKeys.has(key)) return false;
      this.claimedAiVoiceReceiptKeys.add(key);
      if (this.claimedAiVoiceReceiptKeys.size > AI_VOICE_CLAIM_LIMIT) {
        const oldest = this.claimedAiVoiceReceiptKeys.values().next().value;
        if (oldest !== undefined) this.claimedAiVoiceReceiptKeys.delete(oldest);
      }
      receiptSettled = true;
      return true;
    };

    const accept = (busEvent: BridgeEvent): void => {
      const event = asReceiptEvent(busEvent);
      if (event.groupId !== groupId || event.senderUin !== event.selfUin) return;
      if (!event.elements.some((element) => (element as ReceiptRecordElement).type === "record")) return;
      if (expectedNode && matchesAiVoiceEvent(expectedNode, event) && claim(event)) {
        resolveReceipt?.(event);
        return;
      }
      candidates.push(event);
      if (candidates.length > AI_VOICE_CANDIDATE_LIMIT) {
        candidates.shift();
        candidatesOverflowed = true;
      }
    };

    // BEFORE the publish, deliberately (reference:82530 precedes 82533).
    const unsubscribe: Unsubscribe = this.#ctx.events.on("group_message", accept);
    let timeout: NodeJS.Timeout | null = null;
    try {
      const node = await this.fetchAiVoice(groupId, voiceId, text, chatType);
      expectedNode = node;
      const fingerprint = describeAiVoiceFingerprint(node);
      if (fingerprint === "missing") {
        throw new Error(
          "AI voice was published but QQ returned no exact media identifier for receipt correlation",
        );
      }
      const buffered = candidates.find((event) => matchesAiVoiceEvent(node, event) && claim(event));
      if (!buffered && candidatesOverflowed) {
        throw new Error(
          `AI voice was published but receipt correlation overflowed after ${AI_VOICE_CANDIDATE_LIMIT} unmatched self voice messages (group=${groupId} media=${fingerprint})`,
        );
      }
      const event =
        buffered ??
        (await Promise.race([
          receiptPromise,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              reject(
                new Error(
                  `AI voice was published but no matching group-message receipt arrived within ${receiptTimeoutMs}ms (group=${groupId} media=${fingerprint})`,
                ),
              );
            }, receiptTimeoutMs);
            timeout.unref();
          }),
        ]));
      if (!Number.isInteger(event.msgSeq) || event.msgSeq <= 0) {
        throw new Error(`AI voice receipt carried invalid message sequence: ${String(event.msgSeq)}`);
      }
      log.debug(
        "AI voice receipt matched group=%d media=%s sequence=%d random=%d",
        groupId,
        fingerprint,
        event.msgSeq,
        event.msgId,
      );
      return { sequence: event.msgSeq };
    } finally {
      // Every exit path: success, timeout, overflow, throw from the publish, invalid
      // sequence. A surviving subscription would keep this call's `candidates` array
      // (and its closure) alive forever.
      if (timeout) clearTimeout(timeout);
      unsubscribe();
    }
  }

  /**
   * `translatePttToText` — NOT ported; see the file header.
   *
   * A named refusal rather than an absent member: the reference has this method, so
   * a caller that reaches for it should learn what is missing instead of hitting
   * `undefined is not a function`.
   */
  translatePttToText(_input: unknown): Promise<string> {
    return Promise.reject(
      new Error(
        "ExtrasApi.translatePttToText is not implemented: the pttTrans request/response codecs " +
          "(reference:81426-82100) and the bare services pttTrans.TransGroupPttReq / " +
          "pttTrans.TransC2CPttReq are not ported to this repo",
      ),
    );
  }

  /**
   * Transcode a voice record (`get_record out_format`, reference:82607).
   *
   * NOT ported: it needs the bundled SILK-capable ffmpeg addon (`convertAudioBytes`).
   * `loadBinarySource` exists in `bridge/web/binary-source.ts`, so the *load* half is
   * available — the transcode half is a native dependency this package does not have.
   */
  convertRecord(_source: string, _format: string): Promise<{ base64: string; fileSize: number }> {
    return Promise.reject(
      new Error(
        "ExtrasApi.convertRecord is not implemented: it requires a SILK-capable ffmpeg addon " +
          "(convertAudioBytes), which this package does not ship",
      ),
    );
  }
}
