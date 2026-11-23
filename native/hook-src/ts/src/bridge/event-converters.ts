// `MsgPushEvent` → the OneBot 11 JSON event, for all 26 converter entries.
//
// Reference region: `../onebot/src/event-converter/` —
//   utils.ts          reference/index.mjs:21674-21697  (`isSameActor`, the two
//                                                      message-id helpers)
//   element-codecs.ts reference/index.mjs:21698-22156 (`ELEMENT_CODECS.toSegment`,
//                                                      `getElementCodec`)
//   to-segment.ts     reference/index.mjs:22964-23017 (`elementsToOneBotSegments`)
//   envelope.ts       reference/index.mjs:23018-23049 (`notice` / `request` /
//                                                      `message`)
//   to-message.ts     reference/index.mjs:23050-23128 (`convertPrivateMessage`,
//                                                      `convertFriendMessage`,
//                                                      `convertTempMessage`,
//                                                      `convertGroupMessage`)
//   to-notice.ts      reference/index.mjs:23129-23320 (17 notice converters)
//   to-request.ts     reference/index.mjs:23321-23342 (2 request converters)
//   index.ts          reference/index.mjs:23343-23377 (`CONVERTERS` + `convertEvent`)
//
// ---------------------------------------------------------------------------
// Why this file was the blocker
// ---------------------------------------------------------------------------
// `apis/message.getGroupHistory` returns `MsgPushEvent[]` — decoded protocol events.
// `get_group_msg_history` must answer OneBot EVENT objects. Nothing bridged the two,
// so `host/action-context-host.ts` threw `notImplemented` for `getGroupMsgHistory` /
// `getFriendMsgHistory`, and every caller of those two actions (plus the quote
// backfill path) was unreachable. This file is that bridge and nothing else: it
// reads the decoded event, and writes the JSON the wire carries.
//
// ---------------------------------------------------------------------------
// The exhaustiveness contract
// ---------------------------------------------------------------------------
// `CONVERTERS` is typed `Record<MsgPushEvent["kind"], Converter | null>`. That is a
// COMPILE-TIME check that the table names every variant: add a 27th `kind` to
// `MsgPushEvent` and this file stops building until it is mapped (to a converter or
// to an explicit `null`). `convertEvent`'s runtime `if (!converter) return null` is
// then only reachable for the three deliberate `null` entries — never for "someone
// forgot a kind".
//
// Reference does the same thing with a plain object literal plus `if (!converter)`
// (L23372-23377), but its table is NOT keyed against the union, so a kind the union
// gained would silently fall through to `null`. The `Record<…>` annotation is the
// one place this port tightens rather than transcribes, and it tightens a check the
// reference does not have — it changes no output.
//
// ---------------------------------------------------------------------------
// The four things the reference does that this file reproduces exactly
// ---------------------------------------------------------------------------
//  1. **`message_id` is the SEQUENCE when no resolver is configured.**
//     `applyMessageIdResolver` (L21682) falls back to `Math.trunc(sequence)` — NOT to
//     a hash. In production the resolver is always supplied
//     (`createMessageIdResolver`, L41254), and it hashes `sequence:sessionId:eventName`
//     to an int32, so the fallback is unreachable there. It IS reachable here,
//     because a caller may omit the resolver, and then `message_id` equals `msgSeq`.
//     That is the reference's own behaviour, so it is what this port does — see
//     `applyMessageIdResolver`.
//  2. **`time` is in SECONDS.** Every envelope copies `event.time` straight through
//     (L23020/23034/23045), and the decoders fill it from the QQ content head's
//     `timestamp`, which is a Unix second count. Nothing here multiplies by 1000.
//  3. **`sender.card` / `role` exist on GROUP events only.** `convertPrivateMessage`
//     (L23059) builds `{user_id, nickname, sex, age}` plus `group_id` for temp
//     messages; `convertGroupMessage` (L23102) adds `card` and
//     `role: senderRole || "member"`. A private event carrying `card` would be a
//     field no client expects.
//  4. **`operator_id` and `user_id` mean different people in a recall.**
//     `convertGroupRecall` (L23184) puts the RECALLER in `operator_id` and the
//     ORIGINAL AUTHOR in `user_id`. In `friend_recall` (L23176) there is only
//     `user_id` — the peer — because a two-person chat has nobody else to name.
//
// ---------------------------------------------------------------------------
// Reference behaviour that is contradictory or dead, recorded not "fixed"
// ---------------------------------------------------------------------------
//  A. **`group_file_upload` has a converter and no producer.** `convertGroupFileUpload`
//     is in `CONVERTERS` (L23357) and in the action dispatch table (L39303), and
//     `formatEvent` names it (L6344) — but no decoder anywhere in
//     `reference/index.mjs` ever constructs `kind: "group_file_upload"`. The event
//     type is dead. The converter is ported anyway, because the task is the
//     converter layer and dropping it would silently change the table; the *producer*
//     is absent in the reference too, so nothing is lost.
//  B. **`applyMessageIdResolver` can yield `message_id: 0`.** With no resolver and
//     `sequence === 0`, it returns 0 (L21684-21686), and nothing downstream rejects a
//     zero message id — `persistHistoryEvent` (L37745) is what finally throws. So a
//     converter can produce an event that its own persistence path refuses.
//     Reproduced, not repaired: clamping to 1 here would make the id differ from the
//     reference's for the same input.
//  C. **`resolveReplyId` and `applyMessageIdResolver` disagree about a bad resolver
//     return.** `applyMessageIdResolver` treats a non-integer result as "use the
//     sequence" (L21683); `resolveReplyId` THROWS
//     `"reply resolver returned an invalid message id"` (L21694). Two helpers, one
//     contract, two answers. Reproduced as written.
//  D. **`convertGroupMemberJoin`'s `sub_type` fallback is lossy.**
//     `joinType ?? (isSameActor(...) ? "approve" : "invite")` (L23130) infers the
//     join type from whether operator and member are the same account. The self-join
//     decoder (`decodeGroupSelfJoined`, L153913) omits `joinType` entirely, so every
//     self-join reports `invite` — the bot invited itself. The reference's own
//     `joinTypeFromOperationType` exists and is used by the non-self path only.
//     Reproduced; a reader should not read `invite` as evidence a human invited.
//
// ---------------------------------------------------------------------------
// What is deliberately NOT ported: the media side channels
// ---------------------------------------------------------------------------
// `elementsToOneBotSegments` (L22969) does three things this port cannot:
//
//   * `attachMessageMedia` (L22884) stamps a `Symbol`-keyed snapshot onto every
//     image/record/video segment for the SQLite media store. There is no media store
//     here (`MessageStore` is in-memory and stores `StoredMessageMedia` snapshots
//     supplied by the caller), and a `Symbol` key is invisible to JSON, so its only
//     effect would be to add an unread property. Omitted.
//   * `ctx.mediaSegmentSink?.("image" | "record" | "video", …)` (L22903) is the
//     `MediaIndexer` write. No indexer exists. The seam is kept as an OPTIONAL
//     context member so a future media layer plugs in without re-editing this file,
//     and its absence changes no output field.
//   * `ctx.imageUrlResolver` / `ctx.mediaUrlResolver` (L21873 / L21913 / L21936 /
//     L21995) turn a QQ-internal file id into a signed CDN URL via the rkey cache.
//     There is no rkey cache. Absent ⇒ the reference itself falls back to
//     `element.imageUrl || element.url`, which is exactly what the undefined branch
//     below does. Both seams are optional and testable by injection.

import { createLogger } from "../onebot/log.js";
import {
  GROUP_MESSAGE_EVENT,
  PRIVATE_MESSAGE_EVENT,
  privateMessageEventName,
} from "../onebot/actions/message-id.js";
import { segmentToCQ } from "../onebot/actions/message-parser.js";
import type { MessageSegment, MsgPushEvent } from "../msg-push.js";

const log = createLogger("OneBot.EventConverter");

// ===========================================================================
// The context a converter reads (reference:342700 `converterCtx` type)
// ===========================================================================

/**
 * One OneBot message segment as the event JSON carries it: `{type, data}`.
 *
 * Deliberately NOT `element-builder.ts`'s `Segment` union: that is the SEND-side
 * shape (`{type: "text", text}`), while a received event carries the OneBot wire
 * shape (`{type: "text", data: {text}}`). Conflating the two is the mistake the
 * reference's `element-codecs.ts` exists to prevent — it has a `toSegment` half
 * (receive) and a `fromSegment` half (send), and they are not the same mapping.
 */
export interface OneBotSegment {
  type: string;
  data: Record<string, unknown>;
}

/** The public OneBot event JSON. Key ORDER is observable on the wire, so it is written as built. */
export type OneBotEvent = Record<string, unknown>;

/**
 * `currentMessage` — the message the segments belong to, handed to the reply codec
 * so a self-quote can be excluded from its own resolution.
 * reference:23073.
 */
export interface CurrentMessage {
  id: number;
  sequence: number;
  clientSequence: number;
  timestamp: number;
  sentBySelf: boolean;
}

/**
 * `messageIdResolver` (reference:41254 `createMessageIdResolver`'s return type).
 *
 * `replyElements` and `excludedMessage` are only meaningful on the reply path; a
 * top-level message id call passes five arguments.
 */
export type MessageIdResolver = (
  isGroup: boolean,
  sessionId: number,
  sequence: number,
  eventName: string,
  timestamp?: number,
  replyElements?: readonly MessageSegment[],
  excludedMessage?: CurrentMessage,
) => Promise<number> | number;

/**
 * What a converter is allowed to read off the instance.
 *
 * `selfId` is the only REQUIRED member, because it is the only one every converter
 * needs: it decides `post_type` (`message` vs `message_sent`), `kick_me`, and
 * `bot_offline`'s `user_id`. The other three are the media seams documented in the
 * file header — all optional, and a caller that supplies none gets the reference's
 * own undefined-resolver fallbacks.
 */
export interface ConverterContext {
  /** The bot's own uin, as a number. reference:342773 `parseInt(this.uin, 10) || 0`. */
  selfId: number;
  /** Omitted ⇒ `message_id` is the raw sequence. See the header, point 1. */
  messageIdResolver?: MessageIdResolver | null;
  /** Omitted ⇒ an image's `url` is its own `imageUrl`/`url`. reference:21873. */
  imageUrlResolver?:
    | ((element: MessageSegment, isGroup: boolean) => Promise<string> | string)
    | null;
  /** Omitted ⇒ a record/video/file `url` is its own `url`. reference:21913. */
  mediaUrlResolver?:
    | ((element: MessageSegment, isGroup: boolean, sessionId: number) => Promise<string> | string)
    | null;
  /** Omitted ⇒ nothing is indexed. reference:22903 (the `MediaIndexer` write). */
  mediaSegmentSink?:
    | ((
        mediaType: "image" | "record" | "video",
        element: MessageSegment,
        data: Record<string, unknown>,
        isGroup: boolean,
        sessionId: number,
      ) => Promise<void> | void)
    | null;
}

/** The narrow per-call context the element codecs get (reference:22966). */
interface SegmentContext extends ConverterContext {
  isGroup: boolean;
  sessionId: number;
  mediaSegmentSink: null;
  currentMessage?: CurrentMessage | undefined;
}

// ===========================================================================
// Message-id helpers (reference:21674-21697 `utils.ts`)
// ===========================================================================

/**
 * reference L21675 `isSameActor`.
 *
 * UIN first: two known uins are the same account iff they are equal. Only when a
 * uin is missing does the UID decide — and a missing UID is never a match, so two
 * unknown actors are NOT reported as the same. Falling back to "both zero ⇒ same"
 * would label every unresolved join an `approve`.
 */
export function isSameActor(
  leftUin: number,
  leftUid: string,
  rightUin: number,
  rightUid: string,
): boolean {
  if (leftUin > 0 && rightUin > 0) return leftUin === rightUin;
  return Boolean(leftUid) && leftUid === rightUid;
}

/**
 * reference L21682 `applyMessageIdResolver`.
 *
 * The fallback is `Math.trunc(sequence)` — the raw sequence, not a hash — and a
 * `0` sequence stays `0`. A resolver result that is not a non-zero integer is
 * IGNORED (the sequence wins), which is the reference's exact ordering.
 */
export async function applyMessageIdResolver(
  resolver: MessageIdResolver | null | undefined,
  isGroup: boolean,
  sessionId: number,
  sequence: number,
  eventName: string,
  timestamp?: number,
): Promise<number> {
  if (resolver) {
    const resolved = await resolver(isGroup, sessionId, sequence, eventName, timestamp);
    if (Number.isInteger(resolved) && resolved !== 0) return resolved;
  }
  const seq = Math.trunc(sequence);
  return seq === 0 ? 0 : seq;
}

/**
 * reference L21691 `resolveReplyId`.
 *
 * Diverges from {@link applyMessageIdResolver} on purpose (header, point C): a
 * non-integer resolver answer THROWS here and is ignored there.
 */
async function resolveReplyId(
  isGroup: boolean,
  sessionId: number,
  sequence: number,
  resolver: MessageIdResolver | null | undefined,
  eventName: string,
  timestamp: number,
  replyElements: readonly MessageSegment[] | undefined,
  excludedMessage: CurrentMessage | undefined,
): Promise<number> {
  const seq = Math.trunc(sequence);
  if (seq === 0) return 0;
  if (resolver) {
    const resolved = await resolver(
      isGroup,
      sessionId,
      seq,
      eventName,
      timestamp,
      replyElements,
      excludedMessage,
    );
    if (Number.isInteger(resolved)) return resolved;
    throw new Error("reply resolver returned an invalid message id");
  }
  return seq;
}

/** reference L21742 `isInlineMediaSource`. */
function isInlineMediaSource(value: string): boolean {
  return /^(base64:\/\/|data:)/i.test(value);
}

/**
 * `element.url` for the record/video/file codecs.
 *
 * The reference reads `element.url` on all three; this port's decoded segment types
 * declare it on none of them (`msg-push.ts`'s `RecordSegment` / `VideoSegment` /
 * `FileSegment` carry no `url`), because the QQ decoder fills `imageUrl` for images
 * and leaves records/videos to the media resolver. Reading it defensively keeps the
 * codec's own logic intact for a segment that DOES arrive with one (a hand-built
 * fixture, or a future decoder), and yields `""` otherwise — which is what the
 * reference produces for a decoded element too.
 */
function elementUrl(element: MessageSegment): string {
  const value = (element as { url?: unknown }).url;
  return typeof value === "string" ? value : "";
}

/**
 * `element.replyMessageId` — the PRE-RESOLVED quote id.
 *
 * Written by `backfillReplyTarget` (reference:38064) before conversion, so the reply
 * codec can use it instead of re-hashing. This port's `ReplySegment` does not declare
 * it (`msg-push.ts:174`), and this port has no backfill pass, so the defensive read
 * always misses today — the codec then falls through to {@link resolveReplyId}, which
 * is the reference's own `??` ordering. Typed rather than assumed because a caller
 * that DOES pre-resolve (a history path, a fixture) must be able to supply it.
 */
function elementReplyMessageId(element: MessageSegment): number | undefined {
  const value = (element as { replyMessageId?: unknown }).replyMessageId;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ===========================================================================
// Element → OneBot segment (reference:21698-22156 `ELEMENT_CODECS.toSegment`)
// ===========================================================================
//
// Every branch below is one `toSegment` entry. The `fromSegment` half of the
// reference's table lives in `onebot/actions/message-parser.ts` and is NOT
// duplicated here — these are two directions of one mapping, and putting both in one
// file would invite a "fix" that changes the send path.

/** reference L21755 `text`. */
function textSegment(element: MessageSegment): OneBotSegment | null {
  if (element.type !== "text") return null;
  return { type: "text", data: { text: element.text ?? "" } };
}

/** reference L21770 `face`. `resultId` is omitted when absent, not sent as `null`. */
function faceSegment(element: MessageSegment): OneBotSegment | null {
  if (element.type !== "face") return null;
  return {
    type: "face",
    data: {
      id: String(element.faceId ?? 0),
      ...(element.resultId !== undefined ? { resultId: element.resultId } : {}),
    },
  };
}

/** reference L21796 `at`. `targetUin === 0` AND `uid === "all"` both mean @全体成员. */
function atSegment(element: MessageSegment): OneBotSegment | null {
  if (element.type !== "at") return null;
  return {
    type: "at",
    data: {
      qq: element.uid === "all" || element.targetUin === 0 ? "all" : String(element.targetUin ?? 0),
    },
  };
}

/**
 * reference L21825 `reply`.
 *
 * Two things a reader gets wrong here:
 *
 *   * the private event NAME depends on whether the QUOTED message was sent by the
 *     bot (`replySenderUin === selfId`), not on the carrier message;
 *   * an unresolved quote yields `id: "0"`, and `elementsToOneBotSegments`
 *     (L22985) then DROPS the segment — a `[CQ:reply,id=0]` would point at nothing.
 */
async function replySegment(element: MessageSegment, ctx: SegmentContext): Promise<OneBotSegment | null> {
  if (element.type !== "reply") return null;
  const sentBySelf = !ctx.isGroup && ctx.selfId > 0 && element.replySenderUin === ctx.selfId;
  const eventName = ctx.isGroup ? GROUP_MESSAGE_EVENT : privateMessageEventName(sentBySelf, false);
  const id =
    elementReplyMessageId(element) ??
    (await resolveReplyId(
      ctx.isGroup,
      ctx.sessionId,
      element.replySeq ?? 0,
      ctx.messageIdResolver,
      eventName,
      element.replyTime !== undefined && element.replyTime > 0 ? element.replyTime : Number.MAX_SAFE_INTEGER,
      element.replyElements,
      ctx.currentMessage,
    ));
  return { type: "reply", data: { id: String(id) } };
}

/** reference L21878 `image`. The `file` fallback order is load-bearing: see the comment. */
async function imageSegment(element: MessageSegment, ctx: SegmentContext): Promise<OneBotSegment | null> {
  if (element.type !== "image") return null;
  const source = (element.imageUrl || elementUrl(element)).trim();
  const inline = isInlineMediaSource(source);
  // The reference re-spreads with `imageUrl: source` when the source came from
  // `url`, so a resolver sees one field either way (L21881).
  const resolved: MessageSegment =
    !inline && source && !element.imageUrl ? ({ ...element, imageUrl: source } as MessageSegment) : element;
  const data: Record<string, unknown> = {
    url: inline
      ? ""
      : ctx.imageUrlResolver
        ? await ctx.imageUrlResolver(resolved, ctx.isGroup)
        : source,
    // `file` degrades fileId -> `<md5>.png` -> the raw source. A client sends this
    // string back, so an empty one is the "no identity" answer, not an error.
    file:
      element.fileId ||
      (element.md5Hex ? `${element.md5Hex.toLowerCase()}.png` : "") ||
      (inline ? "" : source),
    sub_type: element.subType ?? 0,
    summary: element.summary ?? "",
  };
  if (element.flash) data["type"] = "flash";
  return { type: "image", data };
}

/** reference L21913 `record`. `file` prefers `fileName`, then `fileId`. */
async function recordSegment(element: MessageSegment, ctx: SegmentContext): Promise<OneBotSegment | null> {
  if (element.type !== "record") return null;
  const rawUrl = ctx.mediaUrlResolver
    ? await ctx.mediaUrlResolver(element, ctx.isGroup, ctx.sessionId)
    : elementUrl(element);
  const url = isInlineMediaSource(rawUrl) ? "" : rawUrl;
  return { type: "record", data: { file: element.fileName ?? element.fileId ?? "", url } };
}

/** reference L21936 `video` — the same projection as `record`, deliberately. */
async function videoSegment(element: MessageSegment, ctx: SegmentContext): Promise<OneBotSegment | null> {
  if (element.type !== "video") return null;
  const rawUrl = ctx.mediaUrlResolver
    ? await ctx.mediaUrlResolver(element, ctx.isGroup, ctx.sessionId)
    : elementUrl(element);
  const url = isInlineMediaSource(rawUrl) ? "" : rawUrl;
  return { type: "video", data: { file: element.fileName ?? element.fileId ?? "", url } };
}

/** reference L21969 `json`. The segment field is `data.data`, not `data`. */
function jsonSegment(element: MessageSegment): OneBotSegment | null {
  if (element.type !== "json") return null;
  return { type: "json", data: { data: element.text ?? "" } };
}

/** reference L21985 `xml`. `resid` defaults to 35 — the "structure card" service id. */
function xmlSegment(element: MessageSegment): OneBotSegment | null {
  if (element.type !== "xml") return null;
  return { type: "xml", data: { data: element.text ?? "", resid: element.subType ?? 35 } };
}

/**
 * reference L21994 `file`.
 *
 * Eight keys, and the redundant trio (`file`/`name`, `file_size`/`size`,
 * `file_id`/`id`) is the reference's own aliasing — clients disagree about which
 * spelling they read, so both are always written.
 */
async function fileSegment(element: MessageSegment, ctx: SegmentContext): Promise<OneBotSegment | null> {
  if (element.type !== "file") return null;
  const url = ctx.mediaUrlResolver
    ? await ctx.mediaUrlResolver(element, ctx.isGroup, ctx.sessionId)
    : elementUrl(element);
  const fileName = element.fileName ?? "";
  const fileSize = element.fileSize ?? 0;
  const fileId = element.fileId ?? "";
  return {
    type: "file",
    data: {
      file: fileName,
      file_id: fileId,
      file_size: fileSize,
      name: fileName,
      size: fileSize,
      id: fileId,
      url,
      file_hash: element.fileHash ?? "",
    },
  };
}

/**
 * reference L22049 `mface` — a market face is emitted as an IMAGE segment carrying
 * `emoji_id`.
 *
 * The URL is derived from the emoji GUID: its first two characters are the parcel
 * directory. That shape is the reference's (`gxh.vip.qq.com/club/item/parcel/item/
 * ${dir}/${emojiId}/raw300.gif`), not a documented API.
 */
function mfaceSegment(element: MessageSegment): OneBotSegment | null {
  if (element.type !== "mface") return null;
  const emojiId = element.emojiId ?? "";
  const dir = emojiId.slice(0, 2);
  const url = emojiId
    ? `https://gxh.vip.qq.com/club/item/parcel/item/${dir}/${emojiId}/raw300.gif`
    : "";
  return {
    type: "image",
    data: {
      file: emojiId ? `${dir}-${emojiId}.gif` : "",
      url,
      summary: element.text ?? "",
      sub_type: 0,
      emoji_id: emojiId,
      emoji_package_id: element.emojiPackageId ?? 0,
      key: element.emojiKey ?? "",
    },
  };
}

/** reference L22082 `poke`. */
function pokeSegment(element: MessageSegment): OneBotSegment | null {
  if (element.type !== "poke") return null;
  return { type: "poke", data: { type: element.subType ?? 0 } };
}

/** reference L22102 `flash_file`. Receive-only: it has no `fromSegment` half. */
function flashFileSegment(element: MessageSegment): OneBotSegment | null {
  if (element.type !== "flash_file") return null;
  return {
    type: "flash_file",
    data: {
      title: element.fileName ?? "",
      file_set_id: element.filesetId ?? "",
      scene_type: element.sceneType ?? 0,
      thumb: element.thumbUrl ?? "",
    },
  };
}

/** reference L22113 `forward`. */
function forwardSegment(element: MessageSegment): OneBotSegment | null {
  if (element.type !== "forward") return null;
  return { type: "forward", data: { id: element.resId ?? "" } };
}

/**
 * reference L22121 `markdown`.
 *
 * The segment carries `content`, and `elementsToOneBotSegments` then ALSO appends a
 * `text` segment with the same body (L22908) — a markdown message reaches an OneBot
 * client as two segments, which is what makes the raw text searchable.
 */
function markdownSegment(element: MessageSegment): OneBotSegment | null {
  if (element.type !== "markdown") return null;
  return { type: "markdown", data: { content: element.text } };
}

/**
 * `elementToSegment` (reference:22939).
 *
 * The unknown-type fallback is `{type: element.type, data: {}}` plus a warning, NOT
 * a skipped element: the reference wants the client to see that something was there.
 *
 * `inline_keyboard` has a `toSegment` in the reference's table (L22138) but is
 * unreachable from a decoded event — `msg-push.ts`'s `MessageSegment` union has no
 * such member, and nothing decodes one — so it falls into this fallback. Stated
 * rather than emulated: emitting the reference's 13-field button projection would be
 * code no input can exercise.
 */
async function elementToSegment(element: MessageSegment, ctx: SegmentContext): Promise<OneBotSegment> {
  const built =
    textSegment(element) ??
    faceSegment(element) ??
    atSegment(element) ??
    (await replySegment(element, ctx)) ??
    (await imageSegment(element, ctx)) ??
    (await recordSegment(element, ctx)) ??
    (await videoSegment(element, ctx)) ??
    jsonSegment(element) ??
    xmlSegment(element) ??
    (await fileSegment(element, ctx)) ??
    mfaceSegment(element) ??
    pokeSegment(element) ??
    flashFileSegment(element) ??
    forwardSegment(element) ??
    markdownSegment(element);
  if (built) return built;
  log.warn("segment convert fallback type=%s reason=no receive-side codec", element.type);
  return { type: element.type, data: {} };
}

// ===========================================================================
// Element list → segment list (reference:22969 `elementsToOneBotSegments`)
// ===========================================================================

/**
 * reference L22969 `elementsToOneBotSegments`.
 *
 * A per-element failure is a SKIP, not a throw: a message whose sticker no longer
 * resolves still has to reach the client with the rest of its content. The one
 * non-error skip is a `reply` whose id did not resolve (see {@link replySegment}).
 */
export async function elementsToOneBotSegments(
  ctx: ConverterContext,
  elements: readonly MessageSegment[],
  isGroup: boolean,
  sessionId: number,
  options: { currentMessage?: CurrentMessage | undefined; includeReplyContent?: boolean } = {},
): Promise<OneBotSegment[]> {
  const segmentCtx: SegmentContext = {
    ...ctx,
    isGroup,
    sessionId,
    // The `MediaIndexer` write the reference does here is unavailable — see the
    // file header. Pinning it to `null` keeps every codec's `if (ctx.mediaSegmentSink)`
    // test meaning what it means in the reference.
    mediaSegmentSink: null,
    currentMessage: options.currentMessage,
  };
  const result: OneBotSegment[] = [];
  for (const element of elements) {
    let segment: OneBotSegment;
    try {
      segment = await elementToSegment(element, segmentCtx);
    } catch (err) {
      log.warn(
        "segment convert skipped type=%s (%s)",
        element.type,
        err instanceof Error ? err.message : String(err),
      );
      continue;
    }
    if (element.type === "reply" && segment.data["id"] === "0" && !options.includeReplyContent) {
      log.warn(
        "quote target unresolved: group=%s session=%d seq=%d time=%s; omitting reply id",
        String(isGroup),
        sessionId,
        element.replySeq,
        String(element.replyTime),
      );
      continue;
    }
    if (options.includeReplyContent && element.type === "reply" && element.replyElements?.length) {
      // `getForwardMsg`'s quote preview (reference:38723): the quoted body rides ON
      // the reply segment under `message`, with the sender/time/seq beside it.
      const quoted = await elementsToOneBotSegments(
        ctx,
        element.replyElements.filter((inner) => inner.type !== "reply"),
        isGroup,
        sessionId,
      );
      if (quoted.length > 0) {
        const data = segment.data;
        data["message"] = quoted;
        if (element.replySenderUin) data["qq"] = String(element.replySenderUin);
        if (element.replyTime !== undefined) data["time"] = String(element.replyTime);
        if (element.replySeq) data["seq"] = String(element.replySeq);
      }
    }
    result.push(segment);
    if (element.type === "markdown" && element.text) {
      result.push({ type: "text", data: { text: element.text } });
    }
  }
  return result;
}

/** reference L22592 `segmentsToRawMessage`, re-exported from the parser (one definition). */
function segmentsToRawMessage(segments: readonly OneBotSegment[]): string {
  return segments.map((seg) => segmentToCQ(seg)).join("");
}

// ===========================================================================
// Envelopes (reference:23018-23049 `envelope.ts`)
// ===========================================================================

/** reference L23020 `notice`: `{time, self_id, post_type: "notice", ...fields}`. */
function notice(ctx: ConverterContext, event: MsgPushEvent, fields: OneBotEvent): OneBotEvent {
  return { time: event.time, self_id: ctx.selfId, post_type: "notice", ...fields };
}

/** reference L23030 `request`: note `post_type: "request"`, and no message fields. */
function request(ctx: ConverterContext, event: MsgPushEvent, fields: OneBotEvent): OneBotEvent {
  return { time: event.time, self_id: ctx.selfId, post_type: "request", ...fields };
}

/**
 * reference L23040 `message`.
 *
 * `postType` is `"message"` or `"message_sent"` — decided by the CALLER, per
 * message, because a self-sent echo is a different `post_type` for the same shape.
 */
function message(
  ctx: ConverterContext,
  event: MsgPushEvent,
  postType: "message" | "message_sent",
  fields: OneBotEvent,
): OneBotEvent {
  return { time: event.time, self_id: ctx.selfId, post_type: postType, ...fields };
}

// ===========================================================================
// Message events (reference:23050-23128 `to-message.ts`)
// ===========================================================================

/**
 * reference L23059 `convertPrivateMessage` — the body `friend_message` and
 * `temp_message` share.
 *
 * `sessionId` is the CONVERSATION PEER, which is not `senderUin` on a self-sent
 * echo: the bot's own outgoing message arrives with `fromUin === selfUin`, and hashing
 * the message id against `selfUin` would file it as a conversation with itself.
 * `FriendMessageEvent.peerUin` is what distinguishes the two.
 */
async function convertPrivateMessage(
  ctx: ConverterContext,
  event: MsgPushEvent,
  subType: "friend" | "group",
): Promise<OneBotEvent> {
  if (event.kind !== "friend_message" && event.kind !== "temp_message") {
    throw new Error(`convertPrivateMessage called with ${event.kind}`);
  }
  const isSelf = event.senderUin === ctx.selfId;
  const postType = isSelf ? "message_sent" : "message";
  const sessionId =
    event.kind === "friend_message" && event.peerUin && event.peerUin > 0
      ? event.peerUin
      : event.senderUin;
  // A temp (group) message NEVER has a canonical NT sequence: its sequence is the
  // group's, so the conversation-wide namespace does not apply (L23064).
  const ntSequence = event.kind === "friend_message" ? event.ntMsgSeq ?? 0 : 0;
  const hasCanonicalNtSequence = ntSequence > 0 && event.sequenceAuthoritative !== false;
  const messageIdSequence = hasCanonicalNtSequence ? ntSequence : event.msgSeq;
  const eventName =
    event.kind === "friend_message"
      ? privateMessageEventName(isSelf, hasCanonicalNtSequence)
      : PRIVATE_MESSAGE_EVENT;
  const messageId = await applyMessageIdResolver(
    ctx.messageIdResolver,
    false,
    sessionId,
    messageIdSequence,
    eventName,
  );
  const segments = await elementsToOneBotSegments(ctx, event.elements, false, sessionId, {
    currentMessage: {
      id: messageId,
      sequence: hasCanonicalNtSequence ? ntSequence : 0,
      clientSequence: event.kind === "friend_message" ? event.clientSeq ?? event.msgSeq : event.msgSeq,
      timestamp: event.time,
      sentBySelf: isSelf,
    },
  });
  // NO `card`, NO `role`: a private chat has no member record to read them from.
  const sender: Record<string, unknown> = {
    user_id: event.senderUin,
    nickname: event.senderNick,
    sex: "unknown",
    age: 0,
  };
  if (subType === "group" && event.kind === "temp_message" && event.groupId > 0) {
    sender["group_id"] = event.groupId;
  }
  const fields: OneBotEvent = {
    message_type: "private",
    sub_type: subType,
    message_id: messageId,
    message_seq: event.msgSeq,
    user_id: event.senderUin,
    message: segments,
    raw_message: segmentsToRawMessage(segments),
    font: 0,
    sender,
  };
  // `target_id` names the peer on a self-sent echo, because `user_id` there is the
  // bot. Only when the peer is known and is not the bot itself.
  if (isSelf && sessionId > 0 && sessionId !== ctx.selfId) fields["target_id"] = sessionId;
  return message(ctx, event, postType, fields);
}

/** reference L23096 `convertFriendMessage`. */
export function convertFriendMessage(ctx: ConverterContext, event: MsgPushEvent): Promise<OneBotEvent> {
  return convertPrivateMessage(ctx, event, "friend");
}

/** reference L23099 `convertTempMessage` — same body, `sub_type: "group"`. */
export function convertTempMessage(ctx: ConverterContext, event: MsgPushEvent): Promise<OneBotEvent> {
  return convertPrivateMessage(ctx, event, "group");
}

/**
 * reference L23102 `convertGroupMessage`.
 *
 * `sender.role` falls back to `"member"` — the reference's `event.senderRole ||
 * "member"` — because a role of `""` reads as "not a member" to some clients.
 * `anonymous` is always `null`: real QQ anonymity has no field in this decoder, and
 * the reference emits the key so a client can test for it.
 */
export async function convertGroupMessage(
  ctx: ConverterContext,
  event: MsgPushEvent,
): Promise<OneBotEvent> {
  if (event.kind !== "group_message") throw new Error(`convertGroupMessage called with ${event.kind}`);
  const postType = event.senderUin === ctx.selfId ? "message_sent" : "message";
  const messageId = await applyMessageIdResolver(
    ctx.messageIdResolver,
    true,
    event.groupId,
    event.msgSeq,
    GROUP_MESSAGE_EVENT,
  );
  const segments = await elementsToOneBotSegments(ctx, event.elements, true, event.groupId);
  return message(ctx, event, postType, {
    message_type: "group",
    sub_type: "normal",
    message_id: messageId,
    message_seq: event.msgSeq,
    group_id: event.groupId,
    group_name: event.groupName,
    user_id: event.senderUin,
    message: segments,
    raw_message: segmentsToRawMessage(segments),
    font: 0,
    sender: {
      user_id: event.senderUin,
      nickname: event.senderNick,
      card: event.senderCard,
      role: event.senderRole || "member",
      sex: "unknown",
      age: 0,
    },
    anonymous: null,
  });
}

// ===========================================================================
// Notice events (reference:23129-23320 `to-notice.ts`)
// ===========================================================================

/**
 * reference L23130 `convertGroupMemberJoin`.
 *
 * `sub_type` is the wire `joinType` when the decoder filled it, and otherwise
 * INFERRED from whether operator and member are the same account — see the header,
 * point D, for why that inference is lossy on the self-join path.
 */
export function convertGroupMemberJoin(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "group_member_join") throw new Error(`wrong kind ${event.kind}`);
  return notice(ctx, event, {
    notice_type: "group_increase",
    sub_type:
      event.joinType ??
      (isSameActor(event.operatorUin, event.operatorUid, event.userUin, event.userUid)
        ? "approve"
        : "invite"),
    group_id: event.groupId,
    operator_id: event.operatorUin,
    user_id: event.userUin,
  });
}

/**
 * reference L23139 `convertGroupMemberLeave`.
 *
 * `kick_me` exists because a bot has to be able to tell "I was removed" from
 * "someone else was removed": the same `kick` leave is a `kick_me` when the target is
 * the bot itself. `disband` never names an operator.
 */
export function convertGroupMemberLeave(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "group_member_leave") throw new Error(`wrong kind ${event.kind}`);
  let subType: "disband" | "kick_me" | "kick" | "leave";
  switch (event.leaveType) {
    case "disband":
      subType = "disband";
      break;
    case "kick":
      subType = event.userUin === ctx.selfId ? "kick_me" : "kick";
      break;
    default:
      subType = "leave";
  }
  return notice(ctx, event, {
    notice_type: "group_decrease",
    sub_type: subType,
    group_id: event.groupId,
    operator_id: event.operatorUin,
    user_id: event.userUin,
  });
}

/**
 * reference L23158 `convertGroupMute`.
 *
 * `duration > 0` is `ban`, otherwise `lift_ban` — there is no third state, and a
 * duration of 0 means "unmuted", which is also why `duration` is echoed as 0.
 */
export function convertGroupMute(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "group_mute") throw new Error(`wrong kind ${event.kind}`);
  return notice(ctx, event, {
    notice_type: "group_ban",
    sub_type: event.duration > 0 ? "ban" : "lift_ban",
    group_id: event.groupId,
    operator_id: event.operatorUin,
    user_id: event.userUin,
    duration: event.duration,
  });
}

/**
 * reference L23168 `convertGroupAdmin`.
 *
 * No `operator_id`: the only actor a set/unset admin notice names is the member whose
 * status changed, and the reference does not report who changed it.
 */
export function convertGroupAdmin(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "group_admin") throw new Error(`wrong kind ${event.kind}`);
  return notice(ctx, event, {
    notice_type: "group_admin",
    sub_type: event.set ? "set" : "unset",
    group_id: event.groupId,
    user_id: event.userUin,
  });
}

/**
 * reference L23176 `convertFriendRecall`.
 *
 * The message id namespace comes from `privateMessageEventName(recalledBySelf, false)`
 * — note the hardcoded `false`: a recall has NO canonical NT sequence, so the
 * private-message id here is a SENDER-LOCAL one, and its `timestamp` is passed to the
 * resolver (which the store uses to disambiguate a reused client sequence). This is
 * the one message-id call in the file that passes a timestamp.
 */
export async function convertFriendRecall(
  ctx: ConverterContext,
  event: MsgPushEvent,
): Promise<OneBotEvent> {
  if (event.kind !== "friend_recall") throw new Error(`wrong kind ${event.kind}`);
  const messageId = await applyMessageIdResolver(
    ctx.messageIdResolver,
    false,
    event.userUin,
    event.msgSeq,
    privateMessageEventName(event.recalledBySelf === true, false),
    event.time,
  );
  return notice(ctx, event, {
    notice_type: "friend_recall",
    user_id: event.userUin,
    message_id: messageId,
  });
}

/**
 * reference L23184 `convertGroupRecall`.
 *
 * `operator_id` is the RECALLER; `user_id` is the message's AUTHOR. They differ
 * whenever an admin recalls someone else's message, and a client that reads
 * `user_id` as "who recalled" misattributes the action. There is also no
 * `message_seq` here, unlike `group_essence` — the reference does not emit one.
 */
export async function convertGroupRecall(
  ctx: ConverterContext,
  event: MsgPushEvent,
): Promise<OneBotEvent> {
  if (event.kind !== "group_recall") throw new Error(`wrong kind ${event.kind}`);
  const messageId = await applyMessageIdResolver(
    ctx.messageIdResolver,
    true,
    event.groupId,
    event.msgSeq,
    GROUP_MESSAGE_EVENT,
  );
  return notice(ctx, event, {
    notice_type: "group_recall",
    group_id: event.groupId,
    operator_id: event.operatorUin,
    user_id: event.authorUin,
    message_id: messageId,
  });
}

/**
 * reference L23194 `convertFriendPoke`.
 *
 * A private poke names FOUR ids and they are not interchangeable: `user_id` is the
 * CONVERSATION PEER (`peerUin`), `sender_id` the poker, `target_id` the poked. An
 * image-poke carries `action_img_url`.
 */
export function convertFriendPoke(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "friend_poke") throw new Error(`wrong kind ${event.kind}`);
  return notice(ctx, event, {
    notice_type: "notify",
    sub_type: "poke",
    user_id: event.peerUin,
    sender_id: event.senderUin,
    target_id: event.targetUin,
    action: event.action,
    suffix: event.suffix,
    action_img_url: event.actionImgUrl,
  });
}

/**
 * reference L23206 `convertGroupPoke`.
 *
 * The group variant drops `sender_id` and carries `group_id` instead: a group poke is
 * attributed by membership, so `user_id` is already the poker.
 */
export function convertGroupPoke(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "group_poke") throw new Error(`wrong kind ${event.kind}`);
  return notice(ctx, event, {
    notice_type: "notify",
    sub_type: "poke",
    group_id: event.groupId,
    user_id: event.userUin,
    target_id: event.targetUin,
    action: event.action,
    suffix: event.suffix,
    action_img_url: event.actionImgUrl,
  });
}

/**
 * reference L23218 `convertGroupEssence`.
 *
 * `user_id` AND `sender_id` both carry the message's author (the reference writes
 * both), `operator_id` the actor who set/unset the essence, and `random` the wire
 * random that names the message together with `message_seq`.
 */
export async function convertGroupEssence(
  ctx: ConverterContext,
  event: MsgPushEvent,
): Promise<OneBotEvent> {
  if (event.kind !== "group_essence") throw new Error(`wrong kind ${event.kind}`);
  const messageId = await applyMessageIdResolver(
    ctx.messageIdResolver,
    true,
    event.groupId,
    event.msgSeq,
    GROUP_MESSAGE_EVENT,
  );
  return notice(ctx, event, {
    notice_type: "essence",
    sub_type: event.set ? "add" : "delete",
    group_id: event.groupId,
    user_id: event.senderUin,
    sender_id: event.senderUin,
    operator_id: event.operatorUin,
    message_id: messageId,
    message_seq: event.msgSeq,
    random: event.random,
  });
}

/**
 * reference L23232 `convertGroupFileUpload`.
 *
 * 🔴 No producer exists in the reference — see the header, point A. Ported so the
 * table is complete, and note `busid` (all lowercase) is the wire spelling, while the
 * event field is `busId`.
 */
export function convertGroupFileUpload(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "group_file_upload") throw new Error(`wrong kind ${event.kind}`);
  return notice(ctx, event, {
    notice_type: "group_upload",
    group_id: event.groupId,
    user_id: event.userUin,
    file: {
      id: event.fileId,
      name: event.fileName,
      size: event.fileSize,
      busid: event.busId,
    },
  });
}

/** reference L23245 `convertFriendAdd`. */
export function convertFriendAdd(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "friend_add") throw new Error(`wrong kind ${event.kind}`);
  return notice(ctx, event, { notice_type: "friend_add", user_id: event.userUin });
}

/**
 * reference L23251 `convertGroupCardChange`.
 *
 * A DERIVED event: the reference's packet pipeline emits it when a `group_message`
 * shows a known member's card changed (L347079), so it is never on the wire directly.
 */
export function convertGroupCardChange(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "group_card_change") throw new Error(`wrong kind ${event.kind}`);
  return notice(ctx, event, {
    notice_type: "group_card",
    group_id: event.groupId,
    user_id: event.userUin,
    card_new: event.cardNew,
    card_old: event.cardOld,
  });
}

/**
 * reference L23260 `convertBotOffline`.
 *
 * `user_id` is the BOT's own uin (`selfUin`), not a peer — this notice is about the
 * account the client is driving, and it is the only notice here that names itself.
 */
export function convertBotOffline(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "bot_offline") throw new Error(`wrong kind ${event.kind}`);
  return notice(ctx, event, {
    notice_type: "bot_offline",
    user_id: event.selfUin,
    tag: event.tag,
    message: event.message,
  });
}

/**
 * reference L23268 `convertFriendProfileLike`.
 *
 * `operator_id`/`operator_nick` (not `user_id`): the liker is the OPERATOR of a
 * mutual action, and `times` is the "how many times" the tip carried.
 */
export function convertFriendProfileLike(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "friend_profile_like") throw new Error(`wrong kind ${event.kind}`);
  return notice(ctx, event, {
    notice_type: "notify",
    sub_type: "profile_like",
    operator_id: event.operatorUin,
    operator_nick: event.operatorNick,
    times: event.times,
  });
}

/** reference L23277 `convertGroupTitleChange`. */
export function convertGroupTitleChange(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "group_title_change") throw new Error(`wrong kind ${event.kind}`);
  return notice(ctx, event, {
    notice_type: "notify",
    sub_type: "title",
    group_id: event.groupId,
    user_id: event.userUin,
    title: event.title,
  });
}

/**
 * reference L23286 `convertGroupNameChange`.
 *
 * `user_id` is the OPERATOR — the member who renamed the group — not the group
 * itself, and `name_new` (with no `name_old`: the wire notice carries only the new
 * name).
 */
export function convertGroupNameChange(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "group_name_change") throw new Error(`wrong kind ${event.kind}`);
  return notice(ctx, event, {
    notice_type: "notify",
    sub_type: "group_name",
    group_id: event.groupId,
    user_id: event.operatorUin,
    name_new: event.name,
  });
}

/**
 * reference L23295 `convertFriendInputStatus`.
 *
 * `event_type` is echoed raw beside the pre-rendered `status_text`, so a client can
 * branch on the number without parsing Chinese.
 */
export function convertFriendInputStatus(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "friend_input_status") throw new Error(`wrong kind ${event.kind}`);
  return notice(ctx, event, {
    notice_type: "notify",
    sub_type: "input_status",
    user_id: event.userUin,
    event_type: event.eventType,
    status_text: event.statusText,
  });
}

/**
 * reference L23304 `convertGroupMsgEmojiLike`.
 *
 * `likes` is a one-element ARRAY of `{emoji_id, count}`, not a bare count: the OneBot
 * extension is written for a multi-reaction future, and the wire push carries one
 * emoji at a time, so the reference wraps exactly one. `user_id` and `operator_id` are
 * the same account (both written); `message_id` and `message_seq` both identify the
 * reacted-to message.
 */
export async function convertGroupMsgEmojiLike(
  ctx: ConverterContext,
  event: MsgPushEvent,
): Promise<OneBotEvent> {
  if (event.kind !== "group_msg_emoji_like") throw new Error(`wrong kind ${event.kind}`);
  const messageId = await applyMessageIdResolver(
    ctx.messageIdResolver,
    true,
    event.groupId,
    event.msgSeq,
    GROUP_MESSAGE_EVENT,
  );
  return notice(ctx, event, {
    notice_type: "group_msg_emoji_like",
    sub_type: event.isAdd ? "add" : "remove",
    group_id: event.groupId,
    user_id: event.operatorUin,
    operator_id: event.operatorUin,
    message_id: messageId,
    message_seq: event.msgSeq,
    likes: [{ emoji_id: event.emojiId, count: event.count }],
  });
}

// ===========================================================================
// Request events (reference:23321-23342 `to-request.ts`)
// ===========================================================================

/**
 * reference L23322 `convertFriendRequest`.
 *
 * `flag` is the opaque string the CLIENT sends back to `set_friend_add_request`; it
 * is the request's `sourceUid`, which is why it must be echoed unchanged.
 */
export function convertFriendRequest(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "friend_request") throw new Error(`wrong kind ${event.kind}`);
  return request(ctx, event, {
    request_type: "friend",
    user_id: event.fromUin,
    comment: event.message,
    flag: event.flag,
  });
}

/**
 * reference L23330 `convertGroupInvite`.
 *
 * `invited_id` is CONDITIONAL — absent, not 0, when the decoder did not resolve an
 * invitee (the join-request path never does). A `0` there would name a user that does
 * not exist.
 */
export function convertGroupInvite(ctx: ConverterContext, event: MsgPushEvent): OneBotEvent {
  if (event.kind !== "group_invite") throw new Error(`wrong kind ${event.kind}`);
  const invitedId = event.invitedUin ?? 0;
  return request(ctx, event, {
    request_type: "group",
    sub_type: event.subType || "invite",
    group_id: event.groupId,
    user_id: event.fromUin,
    ...(invitedId > 0 ? { invited_id: invitedId } : {}),
    comment: event.message,
    flag: event.flag,
  });
}

// ===========================================================================
// The table and the dispatcher (reference:23343-23377 `index.ts`)
// ===========================================================================

/** One converter: the context plus one decoded event, out comes the OneBot JSON. */
export type Converter = (
  ctx: ConverterContext,
  event: MsgPushEvent,
) => OneBotEvent | Promise<OneBotEvent>;

/**
 * reference L23344 `CONVERTERS` — 23 converters and 3 explicit `null`s.
 *
 * `Record<MsgPushEvent["kind"], …>` makes the union the key set, so this table being
 * complete is a COMPILE-TIME fact rather than a review question. The three `null`s are
 * the reference's own (L23368-23370): a ptt-transcription result, an online-device
 * snapshot and a remark sync all decode to a real event, and none of them has an
 * OneBot notice — so each is deliberately NOT converted.
 */
export const CONVERTERS: Readonly<Record<MsgPushEvent["kind"], Converter | null>> = {
  friend_message: convertFriendMessage,
  group_message: convertGroupMessage,
  temp_message: convertTempMessage,
  group_member_join: convertGroupMemberJoin,
  group_member_leave: convertGroupMemberLeave,
  group_mute: convertGroupMute,
  group_admin: convertGroupAdmin,
  friend_recall: convertFriendRecall,
  group_recall: convertGroupRecall,
  friend_poke: convertFriendPoke,
  group_poke: convertGroupPoke,
  group_essence: convertGroupEssence,
  group_file_upload: convertGroupFileUpload,
  friend_add: convertFriendAdd,
  friend_input_status: convertFriendInputStatus,
  friend_profile_like: convertFriendProfileLike,
  bot_offline: convertBotOffline,
  group_name_change: convertGroupNameChange,
  group_title_change: convertGroupTitleChange,
  group_card_change: convertGroupCardChange,
  group_msg_emoji_like: convertGroupMsgEmojiLike,
  friend_request: convertFriendRequest,
  group_invite: convertGroupInvite,
  ptt_trans_result: null,
  online_devices_changed: null,
  friend_remark_changed: null,
};

/**
 * reference L23372 `convertEvent` — the dispatcher.
 *
 * `null` has one meaning here: "this kind produces no OneBot event". It never means
 * "unknown kind" — the table's key set IS the union, so an unknown kind is a compile
 * error at the call site, and a runtime object claiming a kind the union does not
 * have is data from outside this module.
 */
export async function convertEvent(
  ctx: ConverterContext,
  event: MsgPushEvent,
): Promise<OneBotEvent | null> {
  const converter = CONVERTERS[event.kind];
  if (!converter) return null;
  return converter(ctx, event);
}

/** The kinds that deliberately convert to nothing, for a caller that must say so. */
export const NON_CONVERTED_KINDS = Object.freeze(
  (Object.keys(CONVERTERS) as MsgPushEvent["kind"][]).filter((kind) => CONVERTERS[kind] === null),
);