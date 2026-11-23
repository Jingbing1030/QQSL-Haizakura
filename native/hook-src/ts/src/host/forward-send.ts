// Forward orchestration: node parsing, preview building, per-target regeneration.
//
// ===========================================================================
// Reference region
// ===========================================================================
//   `sendGroupForwardMessage`        reference/index.mjs:38524
//   `sendPrivateForwardMessage`      reference/index.mjs:38536
//   `uploadForwardMessage`           reference/index.mjs:38549
//   `forwardSingleMessage`           reference/index.mjs:38558
//   `prepareSingleForwardElements`   reference/index.mjs:38588
//   `expandForwardTreeForTarget`     reference/index.mjs:38603
//   `expandForwardNodeForTarget`     reference/index.mjs:38612
//   `restoreHistoricalMedia`         reference/index.mjs:38666
//   `enrichForForward`               reference/index.mjs:38682
//   `getForwardMessage`              reference/index.mjs:38717
//   `parseForwardNodes`              reference/index.mjs:38878
//   `buildForwardPreviewElement`     reference/index.mjs:39018
//   `buildNewsFromNodes` / `deriveForwardSource` / `elementPreview`
//                                    reference/index.mjs:38991-39016
//   `MAX_FORWARD_DEPTH = 3`          reference/index.mjs:38818
//
// ===========================================================================
// Why this lives in `host/` and not in `bridge/apis/forward.ts`
// ===========================================================================
// `ForwardApi` is transport: bytes in, bytes out, plus the result cache. Everything in
// THIS file is policy that needs facts the bridge layer does not have — the message
// store (to turn a `message_id` node into segments), `parseMessage` (to turn OneBot
// content into elements), and the OneBot converter (to turn decoded elements back into
// segments for `get_forward_msg`). The reference puts all of it in `onebot/src/modules`,
// and this port keeps that split: `forward.ts` never imports the action layer.
//
// ===========================================================================
// The four things this file is careful about
// ===========================================================================
//  1. **A res_id is scope-scoped.** One issued for a group cannot be fetched from a
//     private context, and the server answers an empty payload rather than an error.
//     `forwardSingleMessage` therefore FETCHES the tree and RE-UPLOADS it for the
//     target instead of passing the res_id through. That is not an optimisation
//     opportunity; it is the only thing that works.
//
//  2. **A forward node can name an existing message** (`node.data.id`) instead of
//     carrying content. That is resolved through the store, and a miss is an error
//     (`forward node message_id not found`) rather than an empty node — a client that
//     mistypes an id must not receive a forward with a silently dropped line.
//
//  3. **Historical media needs its fingerprints.** Re-uploading a stored image needs
//     md5+sha1(+width/height/picFormat), and QQ frequently sends an inline URL with no
//     digest. `enrichForForward` therefore consults the media store and throws
//     `historical image metadata is incomplete; fetch the original message again`
//     when it cannot find them — an actionable message, not a broken image.
//
//  4. **Depth is capped at 3.** A forward inside a forward inside a forward is the
//     limit; deeper is refused by BOTH the parser and the expander, with different
//     field names ("node"/"content" vs "forward"/"id") because they fail at different
//     points and a caller needs to know which.
//
// ===========================================================================
// What is NOT ported, and why
// ===========================================================================
// `assertForwardMessageInputPolicies` (reference:38846) is folded into `parseForwardNodes`
// rather than kept as a separate pre-pass. It walks the node list and calls
// `assertOutboundMessageInput` on each node's content — a policy check whose ONLY job
// is to reject a poke/video-count violation before upload starts. Doing it inline means
// one traversal instead of two and, more importantly, means the check cannot be skipped
// by a caller that builds nodes directly. The error messages are identical.

import { createLogger } from "../onebot/log.js";
import {
  MessageElementValidationError,
  messageSegmentToSendSegment,
  type Segment,
} from "../element-builder.js";
import {
  assertOutboundMessageInput,
  parseMessage,
} from "../onebot/actions/message-parser.js";
import { elementsToOneBotSegments, type ConverterContext } from "../bridge/event-converters.js";
import type { ForwardApi, ForwardNodeInput, ForwardNodePayload } from "../bridge/apis/forward.js";
import type { MessageSegment } from "../msg-push.js";
import type { MediaInfoRecord } from "./media-store.js";
import type { StoredMessageMedia } from "./message-store.js";
import type { ForwardPreview } from "../onebot/actions/context.js";
import type { OneBotSegment } from "../bridge/event-converters.js";

const log = createLogger("Host.Forward");

/** `MAX_FORWARD_DEPTH` (reference:38818). */
export const MAX_FORWARD_DEPTH = 3;

/** The per-element fan-out `expandForwardNodeForTarget` uses (reference:38613). */
const EXPAND_CONCURRENCY = 8;

// ===========================================================================
// The host slice this module reads
// ===========================================================================

/**
 * Every dependency the orchestration needs, named once.
 *
 * A structural slice and not the whole `ActionContext`: this module is called BY the
 * host, so taking the host as a parameter would be a cycle in the type graph. Each
 * member below is one the reference's `ref` object also carries, and the comment says
 * which reference member it is.
 */
export interface ForwardOrchestrationContext {
  /** `ref.selfId` — the bot's uin, as a number. */
  selfId: number;
  /** `ref.bridge.apis.forward`. */
  forward: ForwardApi;
  /** `ref.bridge.apis.message` — only the two senders. */
  message: {
    sendGroup(groupId: number, elements: readonly Segment[]): Promise<SendReceipt>;
    sendPrivate(userUin: number, elements: readonly Segment[]): Promise<SendReceipt>;
  };
  /** `ref.messageStore` — the three reads the forward paths make. */
  store: {
    get(messageId: number): Record<string, unknown> | null;
    getMedia(messageId: number): readonly StoredMessageMedia[] | null;
    getMeta(messageId: number): { isGroup: boolean; targetId: number } | null;
  };
  /** `ref.mediaStore` — the fingerprint lookups `enrichForForward` falls back to. */
  media: {
    findImage(key: string, source?: "current" | "legacy"): Promise<MediaInfoRecord | null>;
    findRecord(key: string, source?: "current" | "legacy"): Promise<MediaInfoRecord | null>;
    findVideo(key: string, source?: "current" | "legacy"): Promise<MediaInfoRecord | null>;
  } | null;
  /** `ref.converterCtx` — what `get_forward_msg` converts each node with. */
  converterCtx: ConverterContext;
  /** The bot's nickname, for the self-sent echo body (`ref.bridge.identity.nickname`). */
  selfNickname: string;
  /**
   * `ref.finalizeSend` — store the receipt's meta and answer the OneBot message id.
   *
   * Injected rather than re-implemented: the host already owns that composition
   * (`recordSend` in `action-message-providers.ts`), and a second copy here would be a
   * second definition of the id hash.
   */
  recordSent(
    scene: "group" | "private",
    targetId: number,
    segments: readonly Segment[],
    receipt: SendReceipt,
  ): Promise<number>;
}

/** The receipt fields the orchestration reads. `messageId` is what it returns. */
export interface SendReceipt {
  messageId: number;
  sequence: number;
  clientSequence: number;
  random: number;
  timestamp: number;
}

// ===========================================================================
// Small value helpers (reference:39030-39080)
// ===========================================================================

/** `asJsonObject` (reference:39030): a plain object or `null`. Arrays are excluded. */
function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** `toPositiveInt` (reference:39035). A non-finite or negative value becomes 0. */
function toPositiveInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
  }
  return 0;
}

/** `toSafeSignedInteger` (reference:39045). */
function toSafeSignedInteger(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return 0;
}

/** `parseForwardMessageId` (reference:39055). Throws on a malformed value, not on absence. */
function parseForwardMessageId(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new MessageElementValidationError(
    "INVALID_FIELD",
    "forward node id/message_id must be a non-zero safe integer",
    "node",
    "message_id",
  );
}

/** `isMessageMedia` (reference:22877). */
function isMessageMedia(segment: Segment): boolean {
  return segment.type === "image" || segment.type === "record" || segment.type === "video";
}

/**
 * Is this array a nested forward chain — every entry `{type: "node"}`?
 *
 * `false` for an empty array and for any mixed content. The mixed case matters: a node
 * whose `content` is `[text, node]` is NOT a nested forward, and the regular strict
 * parser then rejects the embedded `node` segment with its own message. Treating it as
 * a nested chain would silently drop the text.
 */
function isNestedNodeArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  for (const item of value) {
    const seg = asJsonObject(item);
    if (!seg || seg["type"] !== "node") return false;
  }
  return true;
}

/** `isForwardNewsArray` (reference:38835). */
function isForwardNewsArray(value: unknown): value is { text: string }[] {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    const obj = asJsonObject(item);
    if (!obj || typeof obj["text"] !== "string") return false;
  }
  return true;
}

/**
 * `assertForwardNodeMetadata` (reference:38800).
 *
 * Every key except `content`/`message` must be a scalar, a string for the four preview
 * fields, or a `{text}[]` for `news`. The point is to reject a nested OBJECT early: a
 * caller that sends `{data: {content: {...}}}` would otherwise have the object
 * stringified into `[object Object]` as message text.
 */
function assertForwardNodeMetadata(nodeData: Record<string, unknown>, index: number): void {
  for (const [field, value] of Object.entries(nodeData)) {
    if (field === "content" || field === "message") continue;
    if (value === undefined) continue;
    if (field === "news") {
      if (isForwardNewsArray(value)) continue;
      throw new MessageElementValidationError(
        "INVALID_FIELD",
        `forward messages[${index}].news must be an array of objects with string text`,
        "node",
        field,
      );
    }
    if (field === "title" || field === "source" || field === "summary" || field === "prompt") {
      if (typeof value === "string") continue;
      throw new MessageElementValidationError(
        "INVALID_FIELD",
        `forward messages[${index}].${field} must be a string`,
        "node",
        field,
      );
    }
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      continue;
    }
    throw new MessageElementValidationError(
      "INVALID_FIELD",
      `forward messages[${index}].${field} must be a scalar value`,
      "node",
      field,
    );
  }
}

/** `mapWithConcurrency` (reference:11011): batches, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        out[index] = await run(items[index]!, index);
      }
    }),
  );
  return out;
}

// ===========================================================================
// Preview construction (reference:38991-39028)
// ===========================================================================

/** `elementPreview` (reference:38978): one short label per element. */
function elementPreview(element: Segment): string {
  switch (element.type) {
    case "text": {
      const text = element.text;
      return text.length > 40 ? `${text.slice(0, 40)}…` : text;
    }
    case "at":
      return element.text?.trim() || "@";
    case "face":
      return "[表情]";
    case "mface":
      return element.text ? `[${element.text}]` : "[表情]";
    case "image":
      return "[图片]";
    case "record":
      return "[语音]";
    case "video":
      return "[视频]";
    case "file":
      return element.fileName ? `[文件:${element.fileName}]` : "[文件]";
    case "reply":
      return "";
    case "json":
      return "[JSON消息]";
    case "xml":
      return "[XML消息]";
    case "markdown":
      return "[Markdown]";
    case "forward":
      return "[聊天记录]";
    case "poke":
      return "[窗口抖动]";
    default:
      return "";
  }
}

/** `buildNewsFromNodes` (reference:39008): at most four `name: preview` lines. */
function buildNewsFromNodes(nodes: readonly ForwardNodeInput[]): { text: string }[] {
  const lines: { text: string }[] = [];
  for (const node of nodes) {
    const preview = node.elements.map(elementPreview).filter(Boolean).join(" ").trim();
    const nickname = node.nickname || String(node.userUin);
    lines.push({ text: `${nickname}: ${preview || "[消息]"}` });
    if (lines.length >= 4) break;
  }
  return lines;
}

/**
 * `deriveForwardSource` (reference:39018).
 *
 * A group forward always says "群聊的聊天记录" — the group is the context, so per-sender
 * names would be noise. A private forward names up to four distinct senders.
 */
function deriveForwardSource(nodes: readonly ForwardNodeInput[], isGroup: boolean): string {
  if (nodes.length === 0) return "聊天记录";
  if (isGroup) return "群聊的聊天记录";
  const seen = new Set<string>();
  const nicks: string[] = [];
  for (const node of nodes) {
    const nick = (node.nickname || String(node.userUin)).trim();
    if (!nick || seen.has(nick)) continue;
    seen.add(nick);
    nicks.push(nick);
    if (nicks.length >= 4) break;
  }
  return nicks.length > 0 ? `${nicks.join("和")}的聊天记录` : "聊天记录";
}

/**
 * `buildForwardPreviewElement` (reference:39018).
 *
 * The `meta` override is per-FIELD, not all-or-nothing: a caller that sets only
 * `summary` still gets the derived `source`, `prompt` and `news`. That is what makes
 * `{summary: "…"}` in an action's params behave the way its documentation says.
 */
export function buildForwardPreviewElement(
  resId: string,
  nodes: readonly ForwardNodeInput[],
  isGroup: boolean,
  meta: ForwardPreview | undefined,
): Segment {
  const news = meta?.news !== undefined && meta.news.length > 0 ? meta.news : buildNewsFromNodes(nodes);
  return {
    type: "forward",
    resId,
    forwardSource:
      meta?.source !== undefined && meta.source.length > 0 ? meta.source : deriveForwardSource(nodes, isGroup),
    forwardSummary:
      meta?.summary !== undefined && meta.summary.length > 0 ? meta.summary : `查看${nodes.length}条转发消息`,
    forwardPrompt: meta?.prompt !== undefined && meta.prompt.length > 0 ? meta.prompt : "[聊天记录]",
    forwardNews: news,
    forwardTSum: nodes.length,
  };
}

// ===========================================================================
// parseForwardNodes (reference:38878)
// ===========================================================================

/**
 * OneBot `messages` → uploadable nodes.
 *
 * Two shapes are accepted per entry, both of which real clients send:
 *
 *   `{type: "node", data: {...}}`   the documented OneBot shape;
 *   `{content: …, user_id: …}`      the bare shape, which the reference also accepts
 *                                   (it only requires `content` or `message` to exist).
 *
 * A third possibility — `data.id` naming an EXISTING message — is resolved through the
 * store, so `forward` can re-send a message the bot logged earlier without the caller
 * having to supply its content.
 */
export async function parseForwardNodes(
  ctx: ForwardOrchestrationContext,
  messages: unknown,
  options: { groupId?: number | undefined; userId?: number | undefined; depth?: number | undefined } = {},
): Promise<ForwardNodeInput[]> {
  const depth = options.depth ?? 0;
  if (depth >= MAX_FORWARD_DEPTH) {
    throw new MessageElementValidationError(
      "INVALID_FIELD",
      `forward nesting depth exceeds ${MAX_FORWARD_DEPTH}`,
      "node",
      "content",
    );
  }
  if (!Array.isArray(messages)) {
    throw new MessageElementValidationError(
      "INVALID_FIELD",
      "forward messages must be an array of node segments",
      "node",
      "messages",
    );
  }
  if (messages.length === 0) {
    throw new MessageElementValidationError(
      "MISSING_FIELD",
      "forward messages must contain at least one node",
      "node",
      "messages",
    );
  }

  // Pass 1: normalise the two accepted shapes into node data objects, validating
  // metadata as we go. No awaits — a shape error must not be reported after a store
  // read has already happened for an earlier node.
  const prepared = messages.map((item, index) => {
    const segment = asJsonObject(item);
    if (!segment) {
      throw new MessageElementValidationError(
        "INVALID_FIELD",
        `forward messages[${index}] must be an object`,
        "node",
        `messages[${index}]`,
      );
    }
    const rawType = segment["type"];
    if (rawType !== undefined && typeof rawType !== "string") {
      throw new MessageElementValidationError(
        "INVALID_FIELD",
        `forward messages[${index}].type must be "node"`,
        "node",
        "type",
      );
    }
    if (typeof rawType === "string" && rawType !== "node") {
      throw new MessageElementValidationError(
        "UNKNOWN_TYPE",
        `unknown forward message segment type: ${rawType}`,
        rawType,
        "type",
      );
    }
    if (rawType === "node") {
      const nodeData = asJsonObject(segment["data"]);
      if (!nodeData) {
        throw new MessageElementValidationError(
          "INVALID_FIELD",
          `forward messages[${index}].data must be an object`,
          "node",
          "data",
        );
      }
      assertForwardNodeMetadata(nodeData, index);
      return nodeData;
    }
    if (segment["content"] === undefined && segment["message"] === undefined) {
      throw new MessageElementValidationError(
        "MISSING_FIELD",
        `forward messages[${index}] requires type:"node" data or bare content/message`,
        "node",
        "content",
      );
    }
    assertForwardNodeMetadata(segment, index);
    return segment;
  });

  // Pass 2: build nodes. Each one either resolves an existing message (by id) or parses
  // its own content — possibly recursing for a nested chain.
  const nodes: ForwardNodeInput[] = [];
  for (const nodeData of prepared) {
    const messageId = parseForwardMessageId(nodeData["id"] ?? nodeData["message_id"]);
    if (messageId !== 0) {
      const event = ctx.store.get(messageId);
      if (!event) {
        throw new MessageElementValidationError(
          "INVALID_FIELD",
          `forward node message_id not found: ${String(messageId)}`,
          "node",
          "message_id",
        );
      }
      const eventSender = asJsonObject(event["sender"]) ?? {};
      const senderCard = eventSender["card"] !== undefined ? String(eventSender["card"]) : undefined;
      const nickname = String(
        eventSender["card"] || eventSender["nickname"] || nodeData["nickname"] || nodeData["name"] || "",
      );
      const userUin = toPositiveInt(event["user_id"]);
      if (userUin <= 0) {
        throw new MessageElementValidationError(
          "INVALID_FIELD",
          `forward node message_id ${String(messageId)} has no valid sender user_id`,
          "node",
          "user_id",
        );
      }
      const eventTime = toPositiveInt(event["time"]);
      const content = event["message"] ?? event["raw_message"] ?? "";
      const elements = await restoreHistoricalMedia(
        ctx,
        await parseMessage(content, false, {
          forwardReply: { senderUin: userUin, ...(eventTime > 0 ? { time: eventTime } : {}) },
        }),
        messageId,
      );
      if (elements.length > 0) {
        const groupIdValue = toPositiveInt(event["group_id"]);
        nodes.push({
          userUin,
          nickname: nickname || String(userUin),
          elements,
          time: typeof event["time"] === "number" ? event["time"] : eventTime,
          msgId: toSafeSignedInteger(event["message_id"]),
          msgSeq: toPositiveInt(event["message_seq"]),
          ...(groupIdValue > 0 ? { groupId: groupIdValue } : {}),
          ...(senderCard !== undefined ? { senderCard } : {}),
          messageType: event["message_type"] === "group" ? "group" : "private",
        });
      }
      continue;
    }

    const userUin = toPositiveInt(nodeData["user_id"] ?? nodeData["uin"]) || ctx.selfId;
    if (userUin <= 0) throw new Error("forward node user_id/uin is required");
    const nickname = String(nodeData["nickname"] ?? nodeData["name"] ?? userUin);
    const content = nodeData["content"] ?? nodeData["message"] ?? "";
    const nodeTime = toPositiveInt(nodeData["time"]);
    // `4294967295` is QQ's "unset" sentinel for a uint32 timestamp.
    const time = nodeTime > 0 && nodeTime < 4_294_967_295 ? nodeTime : undefined;

    let elements: Segment[];
    let innerForward: ForwardNodeInput[] | undefined;
    if (isNestedNodeArray(content)) {
      innerForward = await parseForwardNodes(ctx, content, {
        ...(options.groupId !== undefined ? { groupId: options.groupId } : {}),
        ...(options.userId !== undefined ? { userId: options.userId } : {}),
        depth: depth + 1,
      });
      elements = [];
    } else {
      // The policy check the reference does in a separate pre-pass. Running it here
      // means it cannot be skipped by a caller that builds nodes directly, and a
      // poke/video-count violation is still reported before any upload starts — the
      // node list is fully parsed before `upload` is called.
      assertOutboundMessageInput(content, false, "forward");
      elements = await parseMessage(content, false, {
        forwardReply: { senderUin: userUin, ...(time !== undefined ? { time } : {}) },
      });
    }
    if (innerForward === undefined && elements.length === 0) {
      throw new Error(`forward node content is empty: ${userUin}`);
    }

    const node: ForwardNodeInput = { userUin, nickname, elements };
    if (nodeData["news"] !== undefined) {
      const rawNews = nodeData["news"];
      if (!isForwardNewsArray(rawNews)) {
        throw new MessageElementValidationError(
          "INVALID_FIELD",
          "forward node news must be an array of objects with string text",
          "node",
          "news",
        );
      }
      node.news = rawNews.map((item) => ({ text: item.text }));
    }
    for (const field of ["title", "source", "summary", "prompt"] as const) {
      const value = nodeData[field];
      if (typeof value === "string") node[field] = value;
    }
    if (time !== undefined) node.time = time;
    if (innerForward !== undefined) node.innerForward = innerForward;
    nodes.push(node);
  }

  if (nodes.length === 0) throw new Error("forward node list is empty");
  return nodes;
}

// ===========================================================================
// Media restoration for a re-forwarded message (reference:38666)
// ===========================================================================

/**
 * Attach the stored fingerprints to a re-forwarded message's media.
 *
 * The pairing is POSITIONAL and the type must match. That is stricter than it looks:
 * a store row whose media list has drifted by one (an element dropped at insert time)
 * would otherwise attach an image's digest to a voice element, producing a message
 * whose bytes never resolve. `index !== snapshots.length` catches drift at the tail.
 *
 * When the store has NO media rows at all (`snapshots === null`) the elements are still
 * enriched — `enrichForForward` then falls back to the media store by cache key. That
 * is the reference's behaviour and it is the useful one: a message stored before the
 * media index existed can still be forwarded if the index has the fingerprints.
 */
export async function restoreHistoricalMedia(
  ctx: ForwardOrchestrationContext,
  elements: readonly Segment[],
  messageId: number,
): Promise<Segment[]> {
  if (!elements.some((element) => isMessageMedia(element))) return [...elements];
  const snapshots = ctx.store.getMedia(messageId);
  let index = 0;
  const restored = await mapWithConcurrency(elements, EXPAND_CONCURRENCY, async (element) => {
    if (!isMessageMedia(element)) return element;
    const snapshot = snapshots?.[index++];
    if (snapshots !== null && (!snapshot || snapshot.type !== element.type)) {
      throw new Error(`historical media metadata does not match message ${messageId}`);
    }
    return await enrichForForward(ctx, element, snapshot);
  });
  if (snapshots !== null && index !== snapshots.length) {
    throw new Error(`historical media metadata does not match message ${messageId}`);
  }
  return restored;
}

/**
 * `enrichForForward` (reference:38682): fill a media element's fingerprints.
 *
 * The refusal list is the interesting half. Everything that cannot be re-encoded is
 * rejected with a specific message rather than passed through:
 *
 *   `forward` → "merged forward must be regenerated for the target chat", because the
 *                res_id is scope-scoped and passing it through produces an unopenable
 *                bubble. The caller (`prepareSingleForwardElements`) handles this before
 *                calling here, so reaching this line is a bug in that caller.
 *   `file`    → "forward of file segment is not supported". The reference refuses a
 *                FILE element inside a re-forwarded single message, distinct from the
 *                file elements inside forward NODES (which `prepareForwardFiles`
 *                handles). Recorded as-is.
 *
 * Everything not media-or-refused (text/face/at/reply/json/xml/poke/mface/markdown) is
 * returned unchanged: it needs no upload.
 */
export async function enrichForForward(
  ctx: ForwardOrchestrationContext,
  element: Segment,
  snapshot?: StoredMessageMedia | undefined,
): Promise<Segment> {
  if (element.type === "forward") {
    throw new Error("merged forward must be regenerated for the target chat");
  }
  if (
    element.type === "text" ||
    element.type === "face" ||
    element.type === "at" ||
    element.type === "reply" ||
    element.type === "json" ||
    element.type === "xml" ||
    element.type === "poke" ||
    element.type === "mface" ||
    element.type === "markdown"
  ) {
    return element;
  }
  if (element.type === "file") throw new Error("forward of file segment is not supported");

  const lookupKey = element.url || element.fileName || element.fileId || "";
  if (!lookupKey && snapshot === undefined) {
    throw new Error(`forward ${element.type} missing cache key`);
  }
  if (ctx.media === null && snapshot === undefined) {
    // No media index AND no snapshot: the fingerprints cannot be recovered. Saying so
    // is the honest answer; inventing an empty digest would upload a zero-byte file.
    throw new Error(
      "historical media metadata is unavailable: this host has no media store, " +
        `so the ${element.type} cannot be re-uploaded`,
    );
  }

  if (element.type === "image") {
    const cached = snapshot?.type === "image" ? (snapshot as MediaInfoRecord) : await ctx.media?.findImage(lookupKey, "legacy") ?? null;
    if (
      !cached ||
      !cached.md5Hex ||
      !cached.sha1Hex ||
      !cached.width ||
      !cached.height ||
      !cached.picFormat
    ) {
      throw new Error("historical image metadata is incomplete; fetch the original message again");
    }
    const out: Segment = {
      ...element,
      type: "image",
      noByteFallback: true,
      md5Hex: cached.md5Hex,
      sha1Hex: cached.sha1Hex,
    };
    if (cached.fileSize !== undefined) out.fileSize = cached.fileSize;
    if (cached.fileName !== undefined) out.fileName = cached.fileName;
    if (cached.subType !== undefined) out.subType = cached.subType;
    if (cached.summary !== undefined) out.summary = cached.summary;
    out.width = cached.width;
    out.height = cached.height;
    out.picFormat = cached.picFormat;
    return out;
  }
  if (element.type === "record") {
    const cached = snapshot?.type === "record" ? (snapshot as MediaInfoRecord) : await ctx.media?.findRecord(lookupKey, "legacy") ?? null;
    if (!cached || !cached.md5Hex || !cached.sha1Hex) {
      throw new Error("historical voice metadata is incomplete; fetch the original message again");
    }
    const out: Segment = {
      ...element,
      type: "record",
      noByteFallback: true,
      md5Hex: cached.md5Hex,
      sha1Hex: cached.sha1Hex,
    };
    if (cached.fileSize !== undefined) out.fileSize = cached.fileSize;
    if (cached.fileName !== undefined) out.fileName = cached.fileName;
    if (cached.fileId !== undefined) out.fileId = cached.fileId;
    if (cached.duration !== undefined) out.duration = cached.duration;
    out.voiceFormat = cached.voiceFormat ?? 1;
    return out;
  }
  // video
  const cached = snapshot?.type === "video" ? (snapshot as MediaInfoRecord) : await ctx.media?.findVideo(lookupKey, "legacy") ?? null;
  if (!cached || !cached.md5Hex || !cached.sha1Hex) {
    throw new Error("historical video metadata is incomplete; fetch the original message again");
  }
  // The reference logs this rather than failing: a video's thumbnail is regenerated
  // from the video's own bytes by the native addon, which this port does not have, so
  // the fallback thumbnail is used instead.
  log.warn("video forward uses a fallback thumbnail (original thumb not cached)");
  const out: Segment = {
    ...element,
    type: "video",
    noByteFallback: true,
    md5Hex: cached.md5Hex,
    sha1Hex: cached.sha1Hex,
  };
  if (cached.fileSize !== undefined) out.fileSize = cached.fileSize;
  if (cached.fileName !== undefined) out.fileName = cached.fileName;
  if (cached.fileId !== undefined) out.fileId = cached.fileId;
  if (cached.duration !== undefined) out.duration = cached.duration;
  out.width = cached.width ?? 0;
  out.height = cached.height ?? 0;
  out.videoFormat = cached.videoFormat ?? 0;
  return out;
}

// ===========================================================================
// Per-target regeneration (reference:38603-38665)
// ===========================================================================

/**
 * Re-upload a whole forward tree for one target chat.
 *
 * The depth check is here AND in `parseForwardNodes` on purpose: this path walks a tree
 * that came off the wire, which was never seen by the parser. The reference reports it
 * against `"forward"/"id"` for exactly that reason — the offending value is a res_id,
 * not a node's content.
 */
export async function expandForwardTreeForTarget(
  ctx: ForwardOrchestrationContext,
  resId: string,
  target: { groupId?: number | undefined; userId?: number | undefined },
  depth: number,
): Promise<ForwardNodeInput[]> {
  if (depth >= MAX_FORWARD_DEPTH) {
    throw new MessageElementValidationError(
      "INVALID_FIELD",
      `forward nesting depth exceeds ${MAX_FORWARD_DEPTH}`,
      "forward",
      "id",
    );
  }
  const nodes = await ctx.forward.fetch(resId);
  if (!Array.isArray(nodes) || nodes.length === 0) throw new Error("forward content is empty");
  const expanded: ForwardNodeInput[] = [];
  for (const node of nodes) {
    expanded.push(await expandForwardNodeForTarget(ctx, node, target, depth));
  }
  return expanded;
}

/**
 * One decoded node → an uploadable node, with its nested forwards regenerated.
 *
 * The same collapse rule as `uploadRecursive`, seen from the other side: a node whose
 * elements are EXACTLY one `forward` element becomes an `innerForward` chain (`elements`
 * emptied), because that is what the original send meant. A node mixing a forward with
 * anything else keeps the mix, and each forward element is re-uploaded and replaced by a
 * fresh preview card.
 */
async function expandForwardNodeForTarget(
  ctx: ForwardOrchestrationContext,
  node: ForwardNodePayload,
  target: { groupId?: number | undefined; userId?: number | undefined },
  depth: number,
): Promise<ForwardNodeInput> {
  const preparedElements = await mapWithConcurrency(node.elements, EXPAND_CONCURRENCY, async (segment) => {
    // A DECODED segment is a different union from the send one; cross it first, so the
    // checks below see the shape `enrichForForward` and the uploader both want.
    const element = messageSegmentToSendSegment(segment as MessageSegment);
    // Only an element that ALREADY has both fingerprints is enriched here; anything
    // else is left for the uploader to resolve from its own source. The image case also
    // needs the geometry, because a fingerprint-only image upload sends width/height.
    if (!isMessageMedia(element)) return element;
    const media = element as {
      md5Hex?: string | undefined;
      sha1Hex?: string | undefined;
      width?: number | undefined;
      height?: number | undefined;
      picFormat?: number | undefined;
    };
    if (media.md5Hex === undefined || media.sha1Hex === undefined) return element;
    if (
      element.type === "image" &&
      (!media.width || !media.height || !media.picFormat)
    ) {
      return element;
    }
    // ⚠️ NO snapshot here, deliberately: the element came off the wire, not out of the
    // store, so there is no positional media row to pair it with. Passing the element
    // itself as a "snapshot" would also be wrong in a subtle way — it would satisfy
    // `enrichForForward`'s `snapshot !== undefined` guard while carrying no digest, and
    // the image branch would then read `cached.md5Hex` off a `Segment` that has none.
    // The fingerprints are already on the element; `enrichForForward` re-reads them from
    // the media store, which is where the geometry comes from for an image.
    return await enrichForForward(ctx, element);
  });

  const forwards = preparedElements.filter((element) => element.type === "forward");
  if (forwards.length === 0) {
    return { ...node, elements: preparedElements };
  }
  if (forwards.length === preparedElements.length && forwards.length === 1) {
    const innerId = (forwards[0] as { resId: string }).resId.trim();
    if (!innerId) throw new Error("nested forward id is missing");
    return {
      ...node,
      elements: [],
      innerForward: await expandForwardTreeForTarget(ctx, innerId, target, depth + 1),
    };
  }
  const elements: Segment[] = [];
  for (const element of preparedElements) {
    if (element.type !== "forward") {
      elements.push(element);
      continue;
    }
    const innerId = element.resId.trim();
    if (!innerId) throw new Error("nested forward id is missing");
    const inner = await expandForwardTreeForTarget(ctx, innerId, target, depth + 1);
    const newResId = await ctx.forward.upload(inner, target.groupId, target.userId);
    if (!newResId) throw new Error("forward regenerate failed");
    elements.push(buildForwardPreviewElement(newResId, inner, target.groupId !== undefined, undefined));
  }
  return { ...node, elements };
}

/**
 * `prepareSingleForwardElements` (reference:38588).
 *
 * Every `forward` element is regenerated for the target; every other element is passed
 * through `enrichForForward` (media) or untouched (text). A regenerated tree's upload
 * failure is fatal (`forward regenerate failed`) rather than a silent pass-through,
 * because a stale res_id renders as an unopenable card.
 */
export async function prepareSingleForwardElements(
  ctx: ForwardOrchestrationContext,
  elements: readonly Segment[],
  target: { groupId?: number | undefined; userId?: number | undefined },
): Promise<Segment[]> {
  const out: Segment[] = [];
  for (const element of elements) {
    if (element.type !== "forward") {
      out.push(isMessageMedia(element) ? element : await enrichForForward(ctx, element));
      continue;
    }
    const resId = element.resId.trim();
    if (!resId) throw new Error("forward id is missing");
    const nodes = await expandForwardTreeForTarget(ctx, resId, target, 0);
    if (nodes.length === 0) throw new Error("forward content is empty");
    const newResId = await ctx.forward.upload(nodes, target.groupId, target.userId);
    if (!newResId) throw new Error("forward regenerate failed");
    out.push(buildForwardPreviewElement(newResId, nodes, target.groupId !== undefined, undefined));
  }
  return out;
}

// ===========================================================================
// The five host entry points
// ===========================================================================

/** `sendGroupForwardMessage` (reference:38524). */
export async function sendGroupForwardMessage(
  ctx: ForwardOrchestrationContext,
  groupId: number,
  messages: unknown,
  meta: ForwardPreview | undefined,
): Promise<{ messageId: number; forwardId: string }> {
  const nodes = await parseForwardNodes(ctx, messages, { groupId });
  const forwardId = await ctx.forward.upload(nodes, groupId);
  const preview = buildForwardPreviewElement(forwardId, nodes, true, meta);
  const receipt = await ctx.message.sendGroup(groupId, [preview]);
  const messageId = await ctx.recordSent("group", groupId, [preview], receipt);
  return { messageId, forwardId };
}

/** `sendPrivateForwardMessage` (reference:38536). */
export async function sendPrivateForwardMessage(
  ctx: ForwardOrchestrationContext,
  userId: number,
  messages: unknown,
  meta: ForwardPreview | undefined,
): Promise<{ messageId: number; forwardId: string }> {
  const nodes = await parseForwardNodes(ctx, messages, { userId });
  const forwardId = await ctx.forward.upload(nodes, undefined, userId);
  const preview = buildForwardPreviewElement(forwardId, nodes, false, meta);
  const receipt = await ctx.message.sendPrivate(userId, [preview]);
  const messageId = await ctx.recordSent("private", userId, [preview], receipt);
  return { messageId, forwardId };
}

/** `uploadForwardMessage` (reference:38549) — upload only, nothing is sent. */
export async function uploadForwardMessage(
  ctx: ForwardOrchestrationContext,
  messages: unknown,
  groupId: number | undefined,
): Promise<{ forwardId: string }> {
  const nodes = await parseForwardNodes(ctx, messages, groupId !== undefined ? { groupId } : {});
  return { forwardId: await ctx.forward.upload(nodes, groupId) };
}

/**
 * `forwardSingleMessage` (reference:38558).
 *
 * The reason this is not a one-line resend: a merged-forward card's res_id is scoped to
 * the chat it was uploaded for, so it is fetched and re-uploaded for the target (see
 * `prepareSingleForwardElements`). Plain text/image/voice/video reuse their cached
 * fingerprints and ride the ordinary send pipeline.
 */
export async function forwardSingleMessage(
  ctx: ForwardOrchestrationContext,
  messageId: number,
  target: { userId?: number | undefined; groupId?: number | undefined },
): Promise<{ messageId: number }> {
  if (target.groupId === undefined && target.userId === undefined) {
    throw new Error("forward target group_id or user_id is required");
  }
  const event = ctx.store.get(messageId);
  if (!event) throw new Error(`message not found: ${messageId}`);
  const content = event["message"] ?? event["raw_message"] ?? "";
  assertOutboundMessageInput(content, false, "forward");
  const parsed = await parseMessage(content, false);
  if (parsed.length === 0) throw new Error("message has no content");
  const elements = await prepareSingleForwardElements(
    ctx,
    await restoreHistoricalMedia(ctx, parsed, messageId),
    target,
  );
  if (target.groupId !== undefined) {
    const receipt = await ctx.message.sendGroup(target.groupId, elements);
    const outId = await ctx.recordSent("group", target.groupId, elements, receipt);
    return { messageId: outId };
  }
  const userId = target.userId ?? 0;
  const receipt = await ctx.message.sendPrivate(userId, elements);
  const outId = await ctx.recordSent("private", userId, elements, receipt);
  return { messageId: outId };
}

// ===========================================================================
// getForwardMessage (reference:38717)
// ===========================================================================

/**
 * A res_id → OneBot message objects, one per node.
 *
 * Field order is the reference's object-literal order, because `okResponse` serialises
 * `data` as written and a client that diffs raw JSON sees that order.
 *
 * `raw_message` is `""` rather than the serialised segments. That is the reference's
 * choice, and it is defensible: these nodes were never sent as messages, so there is no
 * CQ string that would have produced them. A caller that wants text reads
 * `message`/`message_format: "array"`.
 *
 * `message_str`/`raw` are NOT included — the reference does not add them either.
 */
export async function getForwardMessage(
  ctx: ForwardOrchestrationContext,
  resId: string,
): Promise<unknown[]> {
  const nodes = await ctx.forward.fetch(resId);
  const results: unknown[] = [];
  for (const node of nodes) {
    const isGroup = node.messageType === "group" || (node.groupId !== undefined && node.groupId > 0);
    const sessionId = isGroup ? node.groupId ?? 0 : node.userUin;
    const segments: OneBotSegment[] = await elementsToOneBotSegments(
      ctx.converterCtx,
      node.elements,
      isGroup,
      sessionId,
      { includeReplyContent: true },
    );
    const sender: Record<string, unknown> = { user_id: node.userUin, nickname: node.nickname };
    if (isGroup) sender["card"] = node.senderCard ?? "";
    const message: Record<string, unknown> = {
      self_id: ctx.selfId,
      user_id: node.userUin,
      time: node.time ?? Math.floor(Date.now() / 1_000),
      message_id: node.msgId ?? 0,
      message_seq: node.msgSeq ?? node.msgId ?? 0,
      real_id: node.msgId ?? 0,
      message_type: isGroup ? "group" : "private",
      sender,
      raw_message: "",
      font: 14,
      sub_type: isGroup ? "normal" : "friend",
      message: segments,
      message_format: "array",
      post_type: "message",
    };
    if (isGroup && node.groupId !== undefined && node.groupId > 0) message["group_id"] = node.groupId;
    results.push(message);
  }
  return results;
}
