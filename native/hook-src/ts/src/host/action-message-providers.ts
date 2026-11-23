// The message-provider slice of the OneBot `ActionContext`, built on `MessageApi` and the
// in-memory `MessageStore`.
//
// ===========================================================================
// THIS IS AN ADAPTER. IT PROVES NOTHING ABOUT A REAL QQ SEND.
// ===========================================================================
//
// Every member below is a *translation* between two surfaces that already exist:
//
//   in   `src/onebot/actions/context.ts:1345-1358` — what the action bodies call
//   out  `src/bridge/apis/message.ts` (`MessageApi`) and `src/host/message-store.ts`
//
// Nothing here sends a packet itself, parses a packet, or invents a value the two ends did
// not produce. The consequences, stated plainly because a green test run does not imply
// them:
//
//   1. **With no bound `PacketClient` the send path fails, by design.** `Bridge.sendRawPacket`
//      answers `{ success: false, gotResponse: false, errorCode: -1, errorMessage:
//      "no packet sender attached" }` (`src/bridge/bridge.ts:293-303`, the reference's
//      `-1` sentinel at reference/index.mjs:347459). `MessageApi.sendGroup` turns that into
//      a thrown `send group message failed: no packet sender attached`. This adapter does
//      not catch it: `sendGroupMessage` / `sendPrivateMessage` REJECT with that message and
//      the store stays untouched, so `get_msg` still answers `100 message not found`. That
//      is the honest shape of "the hook is not attached" — it is not success, and it is not
//      a fabricated `messageId`.
//
//   2. **A stored row is not proof of delivery.** The only id this adapter will ever key the
//      store by is the `messageId` `MessageApi` returned in its `SendMessageReceipt`
//      (`apis/message.ts:166`), and `MessageApi` itself throws when QQ returns no receipt
//      sequence ("group message delivery was not confirmed", `apis/message.ts:578-581`). So
//      a row exists only after a decoded server receipt. Whether a bubble appeared in the
//      conversation can only be confirmed on a live QQ client — no test in
//      `ts/test/action-message-providers.test.ts` claims otherwise.
//
//   3. **Recall and media refresh are transport-only.** `recallGroup` / `recallPrivate` are
//      fire-and-forget on the server side (`apis/message.ts:834-882`): they throw only on
//      transport failure. A `deleteMessage() === true` therefore means "the recall packet
//      was accepted by the transport", NOT "the message disappeared for other members".
//
// ===========================================================================
// What is reused instead of re-derived
// ===========================================================================
//
// The OneBot-message → `Segment[]` conversion already exists and is the ONLY converter this
// adapter uses. Nothing in this file rewrites it:
//
//   `parseMessage(message, autoEscape, options)`          `src/onebot/actions/message-parser.ts:890`
//       string with/without CQ codes, a segment array, or a single segment object →
//       `element-builder.ts`'s `Segment[]`. `MessageApi` then encodes those segments itself
//       through `buildSendElems` / `encodePrivateRichText` — so the adapter never touches
//       `Elem`s, `ProtoWriter`s or an encoder, and there is no second conversion to drift.
//
//   `assertOutboundMessageInput(message, autoEscape, scene)`   `message-parser.ts:856`
//       the reference's video/window-shake preflight, run BEFORE parsing so an unsendable
//       combination is refused without any externally visible work
//       (reference/index.mjs:22294, called from `sendGroupMessage`:38442 and
//       `sendPrivateMessage`:38312).
//
//   `exclusiveForwardNodeList(message, autoEscape)`      `message-parser.ts:790`
//       detects the one input shape that is NOT a segment list: a list made only of `node`
//       segments. The reference routes that to `sendGroupForwardMessage` /
//       `sendPrivateForwardMessage` (reference:38444 / :38314); this port has no forward
//       sender wired, so the adapter refuses with a named error instead of sending the
//       nodes as text.
//
//   `elementsToReplyPreview` + `parseMessage(..., { replyPreview: true })`
//       `message-parser.ts:210`, `:890` — used to build a quoted message's preview text for
//       a `reply` segment (see `#replyMeta` for why the port's other preview helper is not
//       usable here).
//
//   `segmentsToRawMessage`                                `message-parser.ts:160`
//       regenerates `raw_message` after `refreshMessageMedia` rewrites a URL, exactly as
//       reference:39832 does.
//
// ===========================================================================
// Which members exist, and which parts of the contract are NOT met
// ===========================================================================
//
// Six providers, and the honest status of each:
//
//   getMessage            COMPLETE. `store.get(messageId) ?? null` — a miss is `null`, never
//                         a synthetic event. `get_msg` turns that into
//                         `100 message not found` (`actions/message.ts:209`).
//   getMessageMeta        COMPLETE. `store.getMeta(messageId) ?? null`. A row that exists but
//                         has no meta answers `null`, which is what makes `delete_msg` say
//                         `message not found or not retractable` rather than recall
//                         sequence 0.
//   sendGroupMessage      COMPLETE, minus forward-node input (refused) and mention display
//                         names (degraded — see `#parseOptions`).
//   sendPrivateMessage     COMPLETE for direct private sends; a temp-session reply
//                         (`tempGroupId !== undefined`) is REFUSED, because the reference
//                         verifies the temp session exists (`ref.tempSessions.has`,
//                         reference:38310) and this port has no temp-session registry — it
//                         would have to send without that check, i.e. guess.
//   deleteMessage         COMPLETE as a recall. Its `boolean` answer is NOT
//                         `ActionContext.deleteMessage`'s `Promise<void>`: see
//                         `ActionMessageProviders` below.
//   refreshMessageMedia   PARTIAL BY CONSTRUCTION. Without an injected `resolveMedia` it
//                         answers the documented `"unsupported"` result and mutates nothing.
//                         This port has no image cache (`mediaStore.findImage` at
//                         reference:39819) and no remote-media URL resolver
//                         (reference:39823); inventing either would fabricate URLs.
//
// ===========================================================================
// Why two members do not have `ActionContext`'s exact signature
// ===========================================================================
//
// `ActionContext.deleteMessage` is `(messageId, meta) => Promise<void>` and
// `refreshMessageMedia` is `(messageId, event) => Promise<void>`. Both are `Promise<void>`,
// which cannot carry the boolean / result this task requires:
//
//     Type 'Promise<boolean>' is not assignable to type 'Promise<void>'.
//
// (verified with this repo's `tsc` under `--strict`). Reporting "unknown id" as a silent
// `resolve()` is precisely the fake success `delete_msg` must not produce, so the adapter
// keeps precise return types and the FOUR members whose signatures do match
// (`getMessage`, `getMessageMeta`, `sendGroupMessage`, `sendPrivateMessage`) are checked
// assignable to `Pick<ActionContext, …>` in the test. The host composes the other two:
//
//     deleteMessage: async (id) => {
//       if (!(await providers.deleteMessage(id))) throw new Error("message not found or not retractable");
//     },
//     refreshMessageMedia: async (id, event) => {
//       const result = await providers.refreshMessageMedia(id, event);
//       if (result.status === "unsupported") log.warn(result.reason);   // or omit the member
//     },
//
// That composition is the host's, and its failure wording is the action's: `delete_msg`
// answers `100 message not found or not retractable` (`actions/message.ts:237`) when
// `getMessageMeta` misses, before this provider is even reached.

import type { Segment } from "../element-builder.js";
import { MessageElementValidationError } from "../element-builder.js";
import type { MessageApi, SendMessageReceipt } from "../bridge/apis/message.js";
import type { ActionContext, ActionUploadedFileMeta, StoredMessageMeta } from "../onebot/actions/context.js";
import { hasAuthoritativeSequence } from "../onebot/actions/message-id.js";
import {
  assertOutboundMessageInput,
  elementsToReplyPreview,
  exclusiveForwardNodeList,
  parseMessage,
  segmentsToRawMessage,
  type ParseOptions,
  type ReplyMeta,
} from "../onebot/actions/message-parser.js";
import { createLogger } from "../onebot/log.js";
import type { MessageStore, StoredMessageMedia } from "./message-store.js";

const log = createLogger("Host.ActionMessage");

// ===========================================================================
// The three collaborators, each narrowed to what this file calls
// ===========================================================================

/**
 * The four `MessageApi` methods the send and recall paths use.
 *
 * `Pick` rather than the class: the adapter has no business calling the history walkers,
 * the read reports or `sendC2cFile`, and a wider type would hide a future call to one of
 * them. Every member is checked against the real class, so a renamed method breaks the
 * build instead of silently disappearing at runtime.
 *
 * `sendGroupTempMessage` is deliberately absent — see the header's temp-session note.
 */
export type ActionMessageApi = Pick<
  MessageApi,
  "sendGroup" | "sendPrivate" | "recallGroup" | "recallPrivate" | "sendC2cFile"
>;

/**
 * The store members used, `Pick`ed from `MessageStore` so there is one definition of each.
 *
 * In particular `getRecallMeta` and not `getMeta` drives the recall: its union is shaped to
 * `recallGroup` / `recallPrivate`'s arguments and it already refuses a non-authoritative
 * sequence (`message-store.ts:379-395`), so the "sequence must be positive" precondition of
 * the recall path (`apis/message.ts:837` region) cannot be skipped here.
 */
export type ActionMessageStore = Pick<
  MessageStore,
  "get" | "getMeta" | "getRecallMeta" | "insert" | "getMedia"
>;

/**
 * The identity lookups the *parser* needs. Deliberately not `BridgeIdentity`.
 *
 * All three members are optional because they drive mentions and reply previews only: a
 * host that passes nothing still sends text, it just cannot render `@nick` or attach a
 * quote preview. `resolveUid` is typed as returning a promise because the real
 * `BridgeIdentity.resolveUid` THROWS on an unresolved uin, which is why `#parseOptions`
 * catches around it instead of letting a mention abort a send.
 */
export interface ActionMessageIdentity {
  /** The bot's own QQ number as a decimal string, for a reply with no stored event. */
  readonly uin?: string | undefined;
  findUidByUin?(uin: number | string, groupId?: number): string | null;
  findGroupMember?(groupId: number, uin: number): { card?: string; nickname?: string; uid?: string } | undefined;
  findFriend?(uin: number): { remark?: string; nickname?: string; uid?: string } | undefined;
  resolveUid?(uin: number | string, groupId?: number): Promise<string>;
}

/**
 * What `resolveMessageOut` receives: everything the host needs to build the stored outbound
 * event, and nothing invented.
 *
 * `segments` are the ones actually sent (the parser's output, post `autoEscape`), `message`
 * is the caller's original OneBot input (for `raw_message`), and `receipt` is the decoded
 * server receipt. `messageId` is `receipt.messageId` — the same value the caller gets back
 * and the key the row is stored under, so the host's event can carry it without a lookup.
 */
export interface MessageOutDraft {
  readonly messageId: number;
  readonly scene: "group" | "private";
  readonly isGroup: boolean;
  readonly targetId: number;
  readonly segments: readonly Segment[];
  readonly message: unknown;
  readonly receipt: SendMessageReceipt;
}

/**
 * The host's outbound-event builder.
 *
 * Returning `null`/`undefined` is meaningful and supported: the row is then stored with
 * recall metadata only, and `getMessage` answers `null` for it. That is the correct outcome
 * for a host with no OneBot event builder yet — better a documented `get_msg` miss than an
 * event with guessed fields. This adapter NEVER writes an event of its own.
 *
 * A throw propagates: the message was already handed to the transport, so a broken builder
 * must be a visible failure, not a swallowed one. The row is simply not written, which
 * leaves `delete_msg` answering "not retractable".
 */
export type ResolveMessageOut = (draft: MessageOutDraft) => Record<string, unknown> | null | undefined;

/**
 * One media-refresh question. `media` is the stored snapshot for the same slot when the
 * store has one (the reference pairs record/video slots by index, reference:39805-39810);
 * `segment` is the OneBot segment being refreshed, so the resolver can read `file` /
 * `file_id` / `url` itself instead of the adapter guessing which key a client sent.
 */
export interface MessageMediaRequest {
  readonly messageId: number;
  readonly meta: StoredMessageMeta | null;
  readonly segment: Record<string, unknown>;
  readonly media: StoredMessageMedia | null;
}

/** Answer a fresh string URL, or `null`/`undefined` for "no URL available". */
export type ResolveMessageMedia = (
  request: MessageMediaRequest,
) => Promise<string | null | undefined> | string | null | undefined;

/**
 * What `refreshMessageMedia` reports.
 *
 * A discriminated union rather than `void`, because "nothing to do" and "this host cannot do
 * it at all" are different facts and a caller that conflates them cannot tell a silent
 * no-op from a missing capability.
 */
export type RefreshMediaResult =
  | { readonly status: "refreshed"; readonly refreshed: number; readonly scanned: number }
  | { readonly status: "unchanged"; readonly refreshed: 0; readonly scanned: number }
  | { readonly status: "not-found"; readonly refreshed: 0; readonly scanned: 0; readonly reason: string }
  | { readonly status: "unsupported"; readonly refreshed: 0; readonly scanned: 0; readonly reason: string };

/** The reason string used when no `resolveMedia` was injected. Exported so tests and hosts agree. */
export const MEDIA_REFRESH_UNSUPPORTED_REASON =
  "media URL refresh is not supported by this adapter: no resolveMedia resolver was injected, " +
  "and this port has neither an image cache nor a remote-media URL resolver to invent one from";

/**
 * The provider slice.
 *
 * The four members whose signatures match `ActionContext` are named exactly as the context
 * names them. `deleteMessage` / `refreshMessageMedia` keep precise return types (see the
 * header) and are documented as needing a host-side composition.
 */
export interface ActionMessageProviders {
  sendGroupMessage(groupId: number, message: unknown, autoEscape: boolean): Promise<{ messageId: number }>;
  sendPrivateMessage(
    userId: number,
    message: unknown,
    autoEscape: boolean,
    tempGroupId?: number | undefined,
  ): Promise<{ messageId: number }>;
  getMessage(messageId: number): Promise<Record<string, unknown> | null>;
  getMessageMeta(messageId: number): Promise<StoredMessageMeta | null>;
  /** `false` for an unknown id or a non-retractable row. `true` = the recall packet was accepted. */
  deleteMessage(messageId: number): Promise<boolean>;
  refreshMessageMedia(messageId: number, event: Record<string, unknown>): Promise<RefreshMediaResult>;
}

export interface ActionMessageProviderOptions {
  readonly messageApi: ActionMessageApi;
  readonly store: ActionMessageStore;
  readonly identity?: ActionMessageIdentity | undefined;
  readonly resolveMessageOut?: ResolveMessageOut | undefined;
  /** Injecting this is the only way `refreshMessageMedia` can do anything. */
  readonly resolveMedia?: ResolveMessageMedia | undefined;
  /**
   * The upload-metadata cache, read for a `file` segment that carries only an id.
   *
   * Absent, a file segment is still sendable — the segment's own `fileName` /
   * `fileSize` / `md5Hex` are used — but one that carries none of them throws,
   * because a c2c-file message with a zero size and empty name is delivered as a
   * corrupt file rather than refused.
   */
  readonly recallUploadedFile?: ((fileId: string) => ActionUploadedFileMeta | undefined) | undefined;
}

/**
 * Compile-time statement of which providers are directly assignable to `ActionContext`.
 *
 * Kept as a type alias rather than a value so a host can widen its context object with it:
 *
 *     const providers: ActionContextMessageProviders = createActionMessageProviders({...});
 *     const ctx: ActionContext = { ...base, ...providers } as ActionContext;
 *
 * `getMessage` / `getMessageMeta` are narrower than the context's (`| null` vs
 * `| null | undefined`), which is assignable, and they are listed so the check covers them.
 */
export type ActionContextMessageProviders = Pick<
  ActionContext,
  "getMessage" | "getMessageMeta" | "sendGroupMessage" | "sendPrivateMessage"
>;

// ===========================================================================
// Factory
// ===========================================================================

export function createActionMessageProviders(
  options: ActionMessageProviderOptions,
): ActionMessageProviders {
  const { messageApi, store, identity, resolveMessageOut, resolveMedia } = options;
  const { recallUploadedFile } = options;

  /**
   * The private scene's own refusal, ported from the reference's wrapper.
   *
   * reference:38402 — `if (elements.some(e => e.type === "at")) throw new
   * MessageElementValidationError("UNSENDABLE_TYPE", 'message element "at" cannot be sent
   * in a private chat', "at")`. `MessageApi.sendPrivate` does NOT perform it (it only runs
   * the poke policy, `apis/message.ts:601`), and `buildSendContent` would happily render an
   * `@uin ` text element with no mention reserve — i.e. a private message that silently
   * loses its mention instead of being refused. The check therefore belongs here, in the
   * scene-aware adapter, and it runs before anything reaches the transport.
   */
  const assertNoPrivateAt = (segments: readonly Segment[]): void => {
    if (segments.some((segment) => segment.type === "at")) {
      throw new MessageElementValidationError(
        "UNSENDABLE_TYPE",
        'message element "at" cannot be sent in a private chat',
        "at",
      );
    }
  };

  /**
   * Forward-node input has no sender in this port: refuse it by name.
   *
   * The reference routes an all-`node` message to a forward uploader (reference:38444 /
   * :38314). Sending those nodes through `parseMessage` would fail anyway
   * (`'message segment "node" is only valid inside a forward node list'`,
   * `message-parser.ts:464`), but the failure would name a parser rule instead of the real
   * gap.
   */
  const assertNoForwardNodes = (message: unknown, autoEscape: boolean, scene: string): void => {
    if (exclusiveForwardNodeList(message, autoEscape) !== null) {
      throw new MessageElementValidationError(
        "UNSENDABLE_TYPE",
        `message segment "node" needs a forward sender, which this adapter does not wire (scene ${scene})`,
        "node",
      );
    }
  };

  /**
   * `ParseOptions` for one scene, built from the store and the optional identity.
   *
   * Three lookups, each with a documented degradation:
   *
   *   `resolveMentionUid`  uin → uid through the identity, with the throw swallowed. The
   *                        parser treats an absent uid as "no uid" and still emits the
   *                        mention text, so an identity miss costs the notification, not the
   *                        send. (The DISPLAY name still degrades to `@uin ` because
   *                        `MessageApi` builds the elements with no `identity` in its
   *                        `SendContext` — `apis/message.ts:546` — so this adapter cannot
   *                        supply a nickname even when it has one. Recorded, not hidden.)
   *   `resolveReplySequence`  messageId → the sequence a `reply` element quotes. Only a row
   *                        whose stored meta is authoritative AND whose target/kind matches
   *                        the scene answers. Everything else returns `undefined`, which puts
   *                        the parser on ITS OWN fallback path — `if (id > 0) return {type:
   *                        "reply", replySeq: id}` (`message-parser.ts:674`, reference:21866).
   *                        That fallback is the reference's, not a bug: a quote whose target
   *                        is unknown still rides `origSeqs` and the server resolves or
   *                        ignores it. Stated here because "no sequence" does NOT mean "no
   *                        quote", and a test pins the difference.
   *   `resolveReplyMeta`    the quote's sender/time/random preview, from the stored event
   *                        plus the meta.
   */
  const parseOptions = (scene: "group" | "private", targetId: number): ParseOptions => {
    const options: ParseOptions = {
      resolveReplySequence: async (replyMessageId: number): Promise<number | undefined> => {
        const meta = store.getMeta(replyMessageId);
        if (meta === null || !hasAuthoritativeSequence(meta)) return undefined;
        if (meta.isGroup !== (scene === "group")) return undefined;
        if (meta.targetId !== targetId) return undefined;
        return meta.sequence;
      },
      resolveReplyMeta: (replyMessageId: number) => replyMeta(replyMessageId),
    };
    if (scene === "group" && identity?.resolveUid !== undefined) {
      const resolveUid = identity.resolveUid.bind(identity);
      options.resolveMentionUid = async (targetUin: number): Promise<string | undefined> => {
        try {
          const uid = await resolveUid(targetUin, targetId);
          return uid.trim() === "" ? undefined : uid;
        } catch {
          // `BridgeIdentity.resolveUid` throws on an unresolved uin; a mention is not worth
          // failing the send over, and the parser has a documented no-uid path.
          return undefined;
        }
      };
    }
    return options;
  };

  /**
   * One `file` segment, sent as its own c2c-file message.
   *
   * reference:38402-38434, and its three branches:
   *
   *   1. `url` and no `fileId`  → upload first (`uploadPrivate`), then send
   *   2. `fileId`               → send straight from the segment + cache
   *   3. neither                → `MISSING_FIELD`
   *
   * Branch 1 is deliberately NOT implemented here. It would need the bridge's
   * `apis.groupFile.uploadPrivate` — a different collaborator than the four message
   * methods this provider is built around, and one whose failure leaves a half-uploaded
   * file. `upload_private_file` never produces branch 1: it uploads itself and passes a
   * `file_id`. So a url-only segment throws, naming what is missing, rather than
   * silently becoming branch 2 with an empty id — which `sendC2cFile` would deliver as
   * a zero-byte file.
   *
   * The metadata comes from the segment when it carries it and from the upload cache
   * otherwise, in that order (`fileEl.fileName ?? cached?.fileName`), with the reference's
   * final fallbacks: name `"file"`, size `0`, md5 from `md5Hex` (HEX on the segment, RAW
   * bytes in the cache — the one conversion in this function), hash `undefined`.
   */
  const sendOnePrivateFile = async (
    userId: number,
    segment: Extract<Segment, { type: "file" }>,
  ): Promise<SendMessageReceipt> => {
    const fileId = segment.fileId;
    if (!fileId) {
      if (segment.url) {
        throw new Error(
          `private file segment with only "url" is not sent by this adapter: it requires ` +
            `the bridge's groupFile.uploadPrivate (reference:38405), and apis.groupFile is ` +
            `not available here — pass file_id (e.g. from upload_private_file) instead`,
        );
      }
      throw new MessageElementValidationError(
        "MISSING_FIELD",
        "private file segment requires file_id or url",
        "file",
      );
    }
    const cached = recallUploadedFile?.(fileId);
    // `md5Hex` → bytes. An absent or malformed hex string yields an EMPTY digest,
    // which is what the reference's `Buffer.from(x, "hex")` does for a short string —
    // it does not throw. The cache's `fileMd5` is already raw.
    const fileMd5 = segment.md5Hex !== undefined
      ? Uint8Array.from(Buffer.from(segment.md5Hex, "hex"))
      : cached?.fileMd5 ?? new Uint8Array(0);
    const fileName = segment.fileName ?? cached?.fileName ?? "file";
    const fileSize = segment.fileSize ?? cached?.fileSize ?? 0;
    const fileHash = segment.fileHash ?? cached?.fileHash;
    // A name/size that is still `file`/0 means the caller gave the segment neither and
    // there is no cache row: the reference sends it anyway (`?? "file"`, `?? 0`).
    // Reproduced, and warned about, because the delivered file then shows up as a
    // zero-byte attachment.
    if (fileSize === 0) {
      log.warn(
        "private file send for file_id=%s has no size (segment and upload cache both lack it) — " +
          "the recipient will see a 0-byte file",
        fileId,
      );
    }
    // `sendC2cFile` addresses the peer by uin AND uid, while everything else in this
    // adapter is uin-only. `identity.resolveUid` is `Bridge.resolveUserUid` under
    // another name (`action-context-host.ts`'s `toMessageIdentity`), and it THROWS
    // when the uin is unknown — the reference's `ensureFileTargetUid` does the same
    // (`if (!resolved) throw new Error(\`c2c file send: could not resolve uid for user ${userId}\`)`).
    if (typeof identity?.resolveUid !== "function") {
      throw new Error(
        `c2c file send requires identity.resolveUid (the peer uid for user ${String(userId)} ` +
          `cannot be derived from the uin alone, and guessing one would address the wrong account)`,
      );
    }
    const userUid = await identity.resolveUid(userId);
    return messageApi.sendC2cFile(userId, userUid, {
      fileId,
      fileName,
      fileSize,
      fileMd5,
      ...(fileHash !== undefined ? { fileHash } : {}),
    });
  };

  /**
   * The quoted message's preview, or `null` when the id is unknown.
   *
   * The reference's provider (reference:38322-38343) returns sender/time/random plus
   * `elements: replyPreviewElements(event.message)` and, for a row with no stored event,
   * falls back to the bot's own uin and the meta timestamp. Both branches are reproduced.
   *
   * The `elements` value is built by REUSING the two real converters rather than
   * re-deriving the label table:
   * `parseMessage(quoted, false, { replyPreview: true })` → element-shaped segments, then
   * `elementsToReplyPreview` → one text segment. This port's `replyPreviewElements`
   * (`message-parser.ts:216`) cannot be used here: it answers OneBot-shaped segments
   * (`{ type, data: { text } }`) while `ReplyMeta.elements` is `Segment[]`, and
   * `makeReplyElem` reads `e.text.length` (`element-builder.ts:1657-1659`) — passing the
   * OneBot shape through would throw inside the encoder. A quoted message that cannot be
   * parsed as a preview simply carries no preview text; the quote still rides `origSeqs`.
   */
  const replyMeta = async (replyMessageId: number): Promise<ReplyMeta | null> => {
    const meta = store.getMeta(replyMessageId);
    const event = store.get(replyMessageId);
    if (event === null) {
      if (meta === null) return null;
      return {
        senderUin: selfUin(),
        time: meta.timestamp,
        random: meta.random,
        sequenceAuthoritative: meta.sequenceAuthoritative,
      };
    }
    const draft: ReplyMeta = {
      senderUin: toUin(event["user_id"]),
      time: toUin(event["time"]),
      random: meta?.random ?? 0,
      sequenceAuthoritative: meta?.sequenceAuthoritative,
    };
    const preview = await previewElements(event["message"]);
    return preview === null ? draft : { ...draft, elements: preview };
  };

  /**
   * The quoted message's preview text, via `parseMessage` + `elementsToReplyPreview`.
   *
   * `reply` and `node` are filtered out first: `assertReplyPreviewType`
   * (`message-parser.ts:176`) refuses exactly those inside a preview, and the reference
   * excludes `reply` for the same reason (reference:22989). Any other segment that the
   * parser rejects yields `null` — no preview, never a failed send.
   */
  const previewElements = async (message: unknown): Promise<Segment[] | null> => {
    if (!Array.isArray(message)) return null;
    const filtered = message.filter((segment) => {
      const type = (segment as { type?: unknown } | null)?.type;
      return typeof type !== "string" || (type !== "reply" && type !== "node");
    });
    if (filtered.length === 0) return null;
    try {
      const parsed = await parseMessage(filtered, false, { replyPreview: true });
      return parsed.length === 0 ? null : elementsToReplyPreview(parsed);
    } catch {
      return null;
    }
  };

  const selfUin = (): number => {
    const raw = identity?.uin;
    if (typeof raw !== "string") return 0;
    const value = Number.parseInt(raw, 10);
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  };

  /**
   * Store one sent message under the receipt's id, and answer that id.
   *
   * The id is the receipt's, full stop: no hash, no counter, no fallback. A receipt whose
   * `messageId` is not a usable integer is the ONE post-transport failure, and it throws
   * rather than storing under a wrong key or answering `0` to a client that then cannot
   * address the message. The message names the sequence and random so the send can be
   * traced in QQ's own logs.
   */
  const recordSend = async (params: {
    scene: "group" | "private";
    targetId: number;
    segments: readonly Segment[];
    message: unknown;
    receipt: SendMessageReceipt;
  }): Promise<number> => {
    const { receipt } = params;
    const messageId = receipt.messageId;
    if (!Number.isSafeInteger(messageId) || messageId === 0) {
      throw new Error(
        `send reached QQ but returned an unusable message id (${String(messageId)}); ` +
          `sequence=${String(receipt.sequence)} random=${String(receipt.random)} — the message ` +
          `may have been delivered but cannot be addressed`,
      );
    }
    const meta: StoredMessageMeta = {
      isGroup: params.scene === "group",
      targetId: params.targetId,
      sequence: receipt.sequence,
      // Same predicate the recall/reaction/essence paths use (`message-id.ts:96`), computed
      // from the field itself rather than re-derived: a group receipt always carries a
      // positive sequence (`apis/message.ts:567-581` throws otherwise), while a private
      // receipt's sequence may legitimately be 0 and then is NOT authoritative.
      sequenceAuthoritative: Number.isInteger(receipt.sequence) && receipt.sequence > 0,
      clientSequence: receipt.clientSequence,
      random: receipt.random,
      timestamp: receipt.timestamp,
    };
    const event = resolveMessageOut === undefined
      ? null
      : (await resolveMessageOut({
          messageId,
          scene: params.scene,
          isGroup: params.scene === "group",
          targetId: params.targetId,
          segments: params.segments,
          message: params.message,
          receipt,
        })) ?? null;
    // `insert` refuses an invalid id without throwing (`message-store.ts:318`); the check
    // above already made that unreachable, so a `false` here is a bug worth reporting.
    const stored = store.insert(messageId, event === null ? { meta } : { meta, event });
    if (!stored) {
      throw new Error(`message store refused the row for message id ${String(messageId)}`);
    }
    log.debug(
      "send recorded: id=%d scene=%s target=%d seq=%d authoritative=%s event=%s",
      messageId,
      params.scene,
      params.targetId,
      receipt.sequence,
      String(meta.sequenceAuthoritative),
      event === null ? "no" : "yes",
    );
    return messageId;
  };

  return {
    // -----------------------------------------------------------------------
    // Send paths
    // -----------------------------------------------------------------------

    async sendGroupMessage(groupId, message, autoEscape) {
      assertGroupId(groupId);
      assertOutboundMessageInput(message, autoEscape, "group");
      assertNoForwardNodes(message, autoEscape, "group");
      const segments = await parseMessage(message, autoEscape, parseOptions("group", groupId));
      if (segments.length === 0) throw new Error("message is empty");
      // Throws — and stores nothing — when the transport fails or QQ returns no receipt.
      const receipt = await messageApi.sendGroup(groupId, segments);
      const messageId = await recordSend({
        scene: "group",
        targetId: groupId,
        segments,
        message,
        receipt,
      });
      return { messageId };
    },

    async sendPrivateMessage(userId, message, autoEscape, tempGroupId) {
      assertUserId(userId);
      if (tempGroupId !== undefined) {
        // reference:38310-38311 verifies the temp session exists before sending. There is no
        // temp-session registry in this port, so the check cannot be made; sending anyway
        // would post into a group-temp scene the host has not proven is open.
        throw new Error(
          `cannot send to user ${String(userId)} in group ${String(tempGroupId)}: ` +
            "group temp sessions are not supported by this adapter (no temp-session registry)",
        );
      }
      assertOutboundMessageInput(message, autoEscape, "direct-private");
      assertNoForwardNodes(message, autoEscape, "direct-private");
      const segments = await parseMessage(message, autoEscape, parseOptions("private", userId));
      if (segments.length === 0) throw new Error("message is empty");
      assertNoPrivateAt(segments);
      // -------------------------------------------------------------------
      // File segments are SPLIT OFF before the text send
      // -------------------------------------------------------------------
      // reference:38362-38417. A private `file` element never reaches
      // `sendPrivate`: it carries a `fileId` that the server already has, and the
      // message that delivers it is a `0xE37` c2c-file send, not a rich-text
      // message. `element-builder.ts:2037` refuses such an element outright ("must
      // use the group/private file upload pipeline"), so without this split the
      // `upload_private_file` action would fail AFTER the bytes were already
      // uploaded — the worst possible sequencing.
      //
      // The two scenes are handled by two branches in the reference; here one
      // branch covers both, because the only difference is where the metadata comes
      // from (`fileEl.url` + a fresh upload vs `fileEl.fileId` + the cache) and
      // `upload_private_file` always takes the second.
      const fileSegments = segments.filter((segment) => segment.type === "file");
      const nonFileSegments = segments.filter((segment) => segment.type !== "file");
      // -------------------------------------------------------------------
      // The send: non-file segments as ONE rich-text message, then each file
      // segment as its OWN `0xE37` c2c-file message
      // -------------------------------------------------------------------
      // reference:38377-38434. Each batch goes through `finalizeBatch` separately
      // (one `recordSend` per send), and the id the action returns is the LAST
      // batch's. So a `{file}` + `{text}` message answers with the file's id, and
      // the store holds two rows — one per delivered message. Recording the whole
      // `segments` array against the last receipt would put the text inside the file
      // message's stored event.
      //
      // A `file` segment never reaches `sendPrivate`: `element-builder.ts:2037`
      // refuses one outright ("must use the group/private file upload pipeline"), so
      // passing the whole batch through would fail the ENTIRE message — including any
      // text — after a file upload had already landed.
      let lastMessageId: number | undefined;
      if (nonFileSegments.length > 0) {
        // `sendPrivate` resolves the peer uid only for media-carrying messages
        // (`apis/message.ts:606-609`); the adapter adds no lookup of its own.
        const receipt = await messageApi.sendPrivate(userId, nonFileSegments);
        lastMessageId = await recordSend({
          scene: "private",
          targetId: userId,
          segments: nonFileSegments,
          message,
          receipt,
        });
      }
      for (const segment of fileSegments) {
        const receipt = await sendOnePrivateFile(userId, segment);
        lastMessageId = await recordSend({
          scene: "private",
          targetId: userId,
          segments: [segment],
          message,
          receipt,
        });
      }
      if (lastMessageId === undefined) {
        // The reference's `if (!lastResult) throw new Error("message is empty")`
        // (:38434). Unreachable from a parsed message — every segment is either file
        // or non-file, and the parser refuses a file segment with neither id nor url
        // — but a hand-built empty array reaches here.
        throw new Error("message is empty");
      }
      return { messageId: lastMessageId };
    },

    // -----------------------------------------------------------------------
    // Store reads
    // -----------------------------------------------------------------------

    async getMessage(messageId) {
      // `null`, never a synthetic event: `get_msg` owns the `100 message not found` wording
      // and inventing an object here would make it answer a fabricated message.
      return store.get(messageId);
    },

    async getMessageMeta(messageId) {
      return store.getMeta(messageId);
    },

    // -----------------------------------------------------------------------
    // Recall
    // -----------------------------------------------------------------------

    async deleteMessage(messageId) {
      const target = store.getRecallMeta(messageId);
      if (target === null) {
        // Either the id is unknown, or the row has no authoritative sequence. Both mean "not
        // retractable": the reference's provider throws inside `deleteMessage`
        // (reference:38214) and this adapter answers `false` so the host can choose the
        // action's wording. Nothing is sent.
        log.debug("recall refused: id %d is unknown or not retractable", messageId);
        return false;
      }
      if (target.kind === "group") {
        await messageApi.recallGroup(target.groupId, target.sequence);
      } else {
        // `sequence` is passed as `msgSeq`; `recallPrivate` derives the composite message id
        // from `random` itself (`apis/message.ts:872`).
        await messageApi.recallPrivate(
          target.userId,
          target.clientSequence,
          target.sequence,
          target.random,
          target.timestamp,
        );
      }
      // The local row is intentionally KEPT: the reference's recall does not delete the
      // stored event either, and dropping it here would make a later `get_msg` on a message
      // that failed to recall (server-side refusal is invisible at the transport level)
      // answer "not found".
      return true;
    },

    // -----------------------------------------------------------------------
    // Media refresh
    // -----------------------------------------------------------------------

    async refreshMessageMedia(messageId, event) {
      if (resolveMedia === undefined) {
        return { status: "unsupported", refreshed: 0, scanned: 0, reason: MEDIA_REFRESH_UNSUPPORTED_REASON };
      }
      const message = event["message"];
      if (!Array.isArray(message)) {
        return {
          status: "not-found",
          refreshed: 0,
          scanned: 0,
          reason: "the event carries no message segment array, so there is no media to refresh",
        };
      }
      const meta = store.getMeta(messageId);
      const snapshots = store.getMedia(messageId) ?? [];
      // Record/video slots are paired by index against non-image snapshots, exactly as
      // reference:39804-39810 does; images resolve from their own `file`/`file_id`.
      const voiceVideo = snapshots.filter((snapshot) => snapshot.type !== "image");
      let voiceVideoIndex = 0;
      let scanned = 0;
      let refreshed = 0;
      for (const item of message) {
        if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
        const segment = item as Record<string, unknown>;
        const type = segment["type"];
        if (type !== "image" && type !== "record" && type !== "video") continue;
        scanned += 1;
        const media = type === "image" ? null : voiceVideo[voiceVideoIndex++] ?? null;
        let url: string | null | undefined;
        try {
          url = await resolveMedia({ messageId, meta, segment, media });
        } catch (error) {
          // Per-segment, as the reference does (reference:39829-39831): one unresolvable
          // image must not deny the voice URL in the same message.
          log.warn(
            "media URL refresh failed: id=%d type=%s: %s",
            messageId,
            String(type),
            error instanceof Error ? error.message : String(error),
          );
          continue;
        }
        if (typeof url !== "string" || url.trim() === "") continue;
        const data = segment["data"];
        if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
        const record = data as Record<string, unknown>;
        if (record["url"] === url) continue;
        record["url"] = url;
        refreshed += 1;
      }
      if (refreshed > 0) {
        // The reference regenerates `raw_message` from the rewritten segments
        // (reference:39832); reusing the port's own serialiser keeps the two in step.
        event["raw_message"] = segmentsToRawMessage(message as { type?: unknown; data?: unknown }[]);
      }
      // NOT persisted: `get_msg` passes a copy of the stored event
      // (`message-store.ts:344-347`), so the refreshed URL lives only in this caller's copy,
      // matching reference:39801-39833 which never writes back to the store.
      return refreshed > 0
        ? { status: "refreshed", refreshed, scanned }
        : { status: "unchanged", refreshed: 0, scanned };
    },
  };
}

// ===========================================================================
// Local coercions
// ===========================================================================

/**
 * A numeric field that may have arrived as a decimal string, as an int, or absent.
 *
 * The stored event is host-built, so `user_id` / `time` may be either shape; both the
 * reference's provider and `onebot/types.ts` parse the string form. `Number.isFinite`
 * degrades a missing or garbled value to `0`, which is a legal `ReplyMeta.senderUin`
 * ("no sender recorded") and never a fabricated uin.
 */
function toUin(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Refuse a destination that could not become a routing field.
 *
 * A port decision, recorded rather than hidden: `MessageApi` converts with `BigInt(groupId)`
 * (`apis/message.ts:549`), which throws `Cannot convert NaN to a BigInt` for a bad id. Naming
 * the destination is the difference between a usable failure and a confusing one.
 */
function assertGroupId(groupId: number): void {
  if (!Number.isSafeInteger(groupId) || groupId <= 0) {
    throw new Error(`invalid group id: ${String(groupId)}`);
  }
}

function assertUserId(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error(`invalid user id: ${String(userId)}`);
  }
}