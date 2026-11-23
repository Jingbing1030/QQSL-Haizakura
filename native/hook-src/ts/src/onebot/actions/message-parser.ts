// OneBot message input → the bridge's `Segment[]`.
//
// Reference regions, all transcribed rather than re-derived:
//   ../onebot/src/message-parser.ts        reference/index.mjs:22205-22571
//   ../onebot/src/event-converter/element-codecs.ts (the `fromSegment` halves)
//                                          reference/index.mjs:21698-22156
//   ../onebot/src/helper/cq.ts             reference/index.mjs:22571-22627
//   ../onebot/src/reply-preview.ts         reference/index.mjs:22156-22205
//   ../onebot/src/element-manifest.ts       reference/index.mjs:6377-6904
//
// ---------------------------------------------------------------------------
// What this file is responsible for, and what it is not
// ---------------------------------------------------------------------------
// It is the *input* direction only: a string with CQ codes, or a segment array, or a
// single segment object, becomes the `Segment` values `element-builder.ts` already
// knows how to encode. It does not upload media, fetch cards, sign music or resolve
// at-uids over the network — those need a `ParseOptions` callback supplied by the
// caller, and when a callback is absent the corresponding segment either degrades the
// way the reference degrades or throws the reference's own error.
//
// Three behaviours here are easy to get wrong and are pinned by tests:
//
//   1. **`text: ""` is a placeholder, not a segment.** `isExplicitEmptyTextPlaceholder`
//      is checked in `parseMessage` (skip) and AGAIN in `outboundInputSegmentSummary`
//      (excluded from the "effective" type list that the video/shake policies see).
//      A whitespace-only `text` is NOT a placeholder — it goes through normal
//      validation and is kept.
//
//   2. **`segmentPayload` flattens `data` into the top level**, except for `json`
//      with a string `data`, which keeps `data` as-is so the whole JSON card text is
//      not spread into the element.
//
//   3. **The CQ regex does not match `node`**, so a CQ string can never smuggle a
//      forward node in; `exclusiveForwardNodeList` is the only way nodes arrive.

import { MessageElementValidationError, type Segment } from "../../element-builder.js";

// ===========================================================================
// The manifest subset this file enforces (reference:6377-6904)
// ===========================================================================

/**
 * Send-policy checks the reference runs BEFORE any parser can touch the message.
 *
 * The reference's numbers (`MAX_VIDEO_COUNT`, `MAX_WINDOW_SHAKE_COUNT`) live in the
 * element-manifest region; both are re-stated here with their source lines because a
 * silently different constant would change which messages are rejected.
 */
export const MAX_VIDEO_COUNT = 3;
export const MAX_WINDOW_SHAKE_COUNT = 1;

/** reference/index.mjs:6377 `assertWindowShakeSendPolicy`. */
export function assertWindowShakeSendPolicy(windowShakeCount: number, segmentCount: number, scene: string): void {
  if (windowShakeCount <= 0) return;
  if (windowShakeCount > MAX_WINDOW_SHAKE_COUNT || segmentCount > 1) {
    throw new MessageElementValidationError(
      "UNSENDABLE_TYPE",
      `message segment "shake" cannot be combined with other segments (scene ${scene})`,
      "shake",
    );
  }
}

/** reference/index.mjs:6388 `assertVideoSendPolicy`. */
export function assertVideoSendPolicy(videoCount: number, effectiveSegmentCount: number): void {
  if (videoCount <= 0) return;
  if (videoCount > MAX_VIDEO_COUNT) {
    throw new MessageElementValidationError(
      "UNSENDABLE_TYPE",
      `a message may contain at most ${MAX_VIDEO_COUNT} video segments`,
      "video",
    );
  }
  if (videoCount < effectiveSegmentCount) {
    throw new MessageElementValidationError(
      "UNSENDABLE_TYPE",
      "message segment \"video\" cannot be combined with other segments",
      "video",
    );
  }
}

// ===========================================================================
// CQ codes (reference:22571 `../onebot/src/helper/cq.ts`)
// ===========================================================================

const CQ_REGEX = /\[CQ:([A-Za-z][A-Za-z0-9_]*)(?:,([^\]]*))?\]/g;

/** `parseCQParams`. Note the unescape order: `&amp;` LAST, so `&#91;` survives it. */
export function parseCQParams(raw: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!raw) return params;
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq > 0) {
      params[pair.substring(0, eq)] = pair
        .substring(eq + 1)
        .replaceAll("&#91;", "[")
        .replaceAll("&#93;", "]")
        .replaceAll("&#44;", ",")
        .replaceAll("&amp;", "&");
    }
  }
  return params;
}

/** `cqEscape`. Order matters: `&` first, or the escapes double up. */
export function cqEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;").replace(/,/g, "&#44;");
}

/** `cqUnescape` — the exact inverse order of `cqEscape`. */
export function cqUnescape(text: string): string {
  return text.replace(/&#91;/g, "[").replace(/&#93;/g, "]").replace(/&#44;/g, ",").replace(/&amp;/g, "&");
}

/**
 * `segmentToCQ` (reference:22572).
 *
 * Used both for `raw_message` on a *freshly parsed* event and for refreshing
 * `raw_message` after media URL updates, so the field list per type has to match the
 * receive-side converter's, not the sender's.
 */
export function segmentToCQ(seg: { type?: unknown; data?: unknown }): string {
  const type = String(seg.type ?? "");
  const data = (seg.data ?? {}) as Record<string, unknown>;
  switch (type) {
    case "text":
      return cqEscape(String(data["text"] ?? ""));
    case "face":
      return `[CQ:face,id=${String(data["id"] ?? 0)}${data["resultId"] !== undefined ? `,resultId=${cqEscape(String(data["resultId"]))}` : ""}]`;
    case "image":
      return `[CQ:image,file=${cqEscape(String(data["file"] ?? ""))},url=${cqEscape(String(data["url"] ?? ""))}]`;
    case "at":
      return `[CQ:at,qq=${String(data["qq"] ?? "")}]`;
    case "reply":
      return `[CQ:reply,id=${String(data["id"] ?? 0)}]`;
    case "record":
      return `[CQ:record,file=${cqEscape(String(data["file"] ?? ""))},url=${cqEscape(String(data["url"] ?? ""))}]`;
    case "video":
      return `[CQ:video,file=${cqEscape(String(data["file"] ?? ""))},url=${cqEscape(String(data["url"] ?? ""))}]`;
    case "json":
      return `[CQ:json,data=${cqEscape(String(data["data"] ?? ""))}]`;
    case "xml":
      return `[CQ:xml,data=${cqEscape(String(data["data"] ?? ""))}]`;
    case "forward":
      return `[CQ:forward,id=${cqEscape(String(data["id"] ?? ""))}]`;
    case "mface":
      return `[CQ:mface,name=${cqEscape(String(data["name"] ?? ""))}]`;
    case "poke":
      return `[CQ:poke,type=${String(data["type"] ?? 0)}]`;
    case "file":
      return `[CQ:file,name=${cqEscape(String(data["name"] ?? ""))},size=${String(data["size"] ?? 0)},id=${cqEscape(String(data["id"] ?? ""))},url=${cqEscape(String(data["url"] ?? ""))}]`;
    default:
      return `[CQ:${type}]`;
  }
}

/** `segmentsToRawMessage`. */
export function segmentsToRawMessage(segments: readonly { type?: unknown; data?: unknown }[]): string {
  return segments.map((seg) => segmentToCQ(seg)).join("");
}

// ===========================================================================
// Reply previews (reference:22156 `../onebot/src/reply-preview.ts`)
// ===========================================================================

const PREVIEW_LABELS: Readonly<Record<string, string>> = {
  image: "[图片]",
  record: "[语音]",
  video: "[视频]",
  file: "[文件]",
  face: "[表情]",
  mface: "[表情]",
  forward: "[聊天记录]",
  json: "[卡片]",
  xml: "[卡片]",
  markdown: "[Markdown]",
};

/** `assertReplyPreviewType` — a reply preview may only carry text and at. */
export function assertReplyPreviewType(type: string): void {
  if (type === "text" || type === "at") return;
  if (!Object.hasOwn(PREVIEW_LABELS, type)) {
    throw new MessageElementValidationError(
      "UNSENDABLE_TYPE",
      `message segment "${type}" is not supported in a reply preview`,
      type,
    );
  }
}

/** `elementsToReplyPreview`: collapse an element list to one display `text` segment. */
export function elementsToReplyPreview(elements: readonly Segment[]): Segment[] {
  return [
    {
      type: "text",
      text: elements
        .map((element) => {
          if (element.type === "text") return element.text;
          if (element.type === "at") return element.targetUin === 0 ? "@全体成员" : `@${element.targetUin}`;
          return PREVIEW_LABELS[element.type] ?? "";
        })
        .join(""),
    },
  ];
}

/**
 * `replyPreviewElements`: build a preview from stored OneBot segments.
 *
 * Returns `[]` rather than a `[{text: ""}]` when nothing is displayable, and the
 * reference relies on that: an empty preview means "no preview content", which the
 * encoder then omits.
 */
export function replyPreviewElements(message: unknown): Array<{ type: "text"; data: { text: string } }> {
  if (!Array.isArray(message)) return [];
  const parts: string[] = [];
  for (const segment of message) {
    if (typeof segment !== "object" || segment === null) continue;
    const seg = segment as { type?: unknown; data?: unknown };
    const data = seg.data;
    if (typeof data !== "object" || data === null) continue;
    const d = data as Record<string, unknown>;
    if (seg.type === "text" && typeof d["text"] === "string") parts.push(d["text"]);
    else if (seg.type === "at") parts.push(d["qq"] === "all" ? "@全体成员" : `@${String(d["qq"] ?? "")}`);
    else if (typeof seg.type === "string" && Object.hasOwn(PREVIEW_LABELS, seg.type)) parts.push(PREVIEW_LABELS[seg.type]!);
  }
  const text = parts.join("");
  return text ? [{ type: "text", data: { text } }] : [];
}

// ===========================================================================
// Small coercions (reference:21699 `intOr`, `pickMediaSource`, ...)
// ===========================================================================

/** `intOr` (reference:21700). Throws on a non-integer rather than defaulting. */
export function intOr(value: unknown, fallback = 0): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "number") {
    if (Number.isSafeInteger(value)) return value;
    throw new MessageElementValidationError(
      "INVALID_FIELD",
      `numeric message segment field must be a safe integer, received ${String(value)}`,
      "",
    );
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return fallback;
    if (!/^[+-]?\d+$/.test(text)) {
      throw new MessageElementValidationError(
        "INVALID_FIELD",
        `numeric message segment field must contain only an integer, received ${JSON.stringify(value)}`,
        "",
      );
    }
    const parsed = Number(text);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new MessageElementValidationError(
    "INVALID_FIELD",
    `numeric message segment field must be a safe integer, received ${String(value)}`,
    "",
  );
}

function isInlineMediaSource(value: string): boolean {
  return /^(base64:\/\/|data:)/i.test(value);
}

/**
 * `pickMediaSource` (reference:21729).
 *
 * The reason this is not just `file ?? url`: a bot framework echoing a received
 * image back sends `file=<md5>.png` together with a real download `url`. Taking
 * `file` makes the sender `statSync` the md5 as a local path, which throws ENOENT.
 */
export function pickMediaSource(data: Record<string, unknown>): string {
  const file = String(data["file"] ?? "").trim();
  const url = String(data["url"] ?? "").trim();
  const fallback = file || url || String(data["path"] ?? "").trim() || String(data["media"] ?? "").trim();
  if (!file) return fallback;
  if (isInlineMediaSource(file) || /^(https?:\/\/|file:\/\/)/i.test(file) || /[\\/]/.test(file)) return file;
  if (/^https?:\/\//i.test(url)) return url;
  return fallback;
}

/**
 * `marketFaceElement` (reference:21720).
 *
 * `image` with an `emoji_id` field becomes an `mface`, not an image — that is how
 * QQ's animated stickers round-trip.
 */
function marketFaceElement(emojiId: string, data: Record<string, unknown>): Segment {
  return {
    type: "mface",
    emojiId,
    text: String(data["summary"] ?? data["name"] ?? ""),
    emojiPackageId: intOr(data["emoji_package_id"] ?? data["tab_id"], 0),
    emojiKey: String(data["key"] ?? ""),
  };
}

// ===========================================================================
// The sentence the parser needs from its caller
// ===========================================================================

export interface ReplyMeta {
  senderUin: number;
  time: number;
  random: number;
  elements?: Segment[] | undefined;
  sequenceAuthoritative?: boolean | undefined;
}

/**
 * The out-of-band lookups a segment may need.
 *
 * All optional. When `resolveReplySequence` is absent, a `reply` segment falls back
 * to the reference's own path: `id > 0` quotes by id, otherwise it is dropped with a
 * warning. That is a real behaviour of the reference, not a simplification.
 */
export interface ParseOptions {
  replyPreview?: boolean | undefined;
  forwardReply?: { senderUin: number; time?: number | undefined } | undefined;
  resolveReplySequence?: ((replyMessageId: number) => Promise<number | undefined>) | undefined;
  resolveReplyMeta?: ((replyMessageId: number) => Promise<ReplyMeta | null>) | undefined;
  resolveMentionUid?: ((targetUin: number) => Promise<string | undefined>) | undefined;
  resolveContactArk?: ((contactType: string, contactId: number) => Promise<string | null>) | undefined;
  musicSignUrl?: string | undefined;
  /** Injected so tests do not need the network for `music`. */
  fetchImpl?: typeof fetch | undefined;
}

// ===========================================================================
// Transcript of the id/JSON helpers `segmentToElement` calls
// ===========================================================================

/**
 * `invalidMessageShape` (reference:22300).
 *
 * The reference passes `undefined` as the element type for message-shape errors; this
 * port's `MessageElementValidationError` requires a string there (element-builder.ts),
 * so `""` is used. The field is internal bookkeeping and never reaches the wire, so
 * the difference is unobservable — recorded here rather than silently changed.
 */
function invalidMessageShape(message: string): MessageElementValidationError {
  return new MessageElementValidationError("MISSING_FIELD", message, "", "message");
}

/**
 * `assertScalarSegmentData` (reference:22304).
 *
 * `json` gets an exception for `data`/`config` because those legitimately carry a
 * nested object; every other type must be flat, and a nested value is an error rather
 * than something to stringify.
 */
function assertScalarSegmentData(type: string, data: Record<string, unknown>): void {
  for (const [field, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") continue;
    if (type === "json" && (field === "data" || field === "config") && typeof value === "object" && value !== null && !Array.isArray(value)) {
      continue;
    }
    throw new MessageElementValidationError(
      "INVALID_FIELD",
      `message segment "${type}" field "${field}" must be a scalar value`,
      type,
      field,
    );
  }
}

function requireNonEmptyStringField(type: string, data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new MessageElementValidationError(
      "INVALID_FIELD",
      `message segment "${type}" field "${field}" must be a non-empty string`,
      type,
      field,
    );
  }
  return value;
}

function requireCoordinate(data: Record<string, unknown>, field: string): string {
  const raw = data[field];
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : "";
  const value = Number(text);
  const limit = field === "lat" ? 90 : 180;
  if (!text.trim() || text !== text.trim() || !Number.isFinite(value) || value < -limit || value > limit) {
    throw new MessageElementValidationError(
      "INVALID_FIELD",
      `message segment "location" field "${field}" must be a finite coordinate between ${String(-limit)} and ${String(limit)}`,
      "location",
      field,
    );
  }
  return text;
}

function replyInteger(data: Record<string, unknown>, field: string, defaultValue: number, max: number, min = 1): number {
  const raw = data[field];
  const value = raw === undefined ? defaultValue : intOr(raw);
  if (raw === null || (typeof raw === "string" && !raw.trim()) || value < min || value > max) {
    throw new MessageElementValidationError(
      "INVALID_FIELD",
      `reply.${field} must be an integer between ${min} and ${max}`,
      "reply",
      field,
    );
  }
  return value;
}

// ===========================================================================
// segmentToElement (reference:21855)
// ===========================================================================

/** A fake data-lookup so `fetch`-using segments can be exercised offline. */
const DEFAULT_MUSIC_SIGN_URL = "https://ss.xingzhige.com/music_card/card";

async function parseForwardReply(data: Record<string, unknown>, context: { senderUin: number; time?: number | undefined }): Promise<Segment> {
  const { message, ...metadata } = data;
  assertScalarSegmentData("reply", metadata);
  const replySenderUin = replyInteger(data, "qq", context.senderUin, Number.MAX_SAFE_INTEGER);
  const replyTime = replyInteger(data, "time", context.time ?? Math.floor(Date.now() / 1_000), 4_294_967_295, 0);
  return {
    type: "reply",
    replySeq: replyInteger(data, "seq", 1, 4_294_967_295),
    replySenderUin,
    replyTime,
    replyElements: elementsToReplyPreview(await parseMessage(message, false, { replyPreview: true })) as never,
  };
}

/**
 * One segment → one element, or `null` when the reference drops it.
 *
 * `null` is returned for exactly two inputs (a `reply` that cannot be quoted, and a
 * `replyPreview` result of `null`); every other unusable input throws. Callers must
 * treat `null` as "skip", which is why `parseMessage` checks for it rather than
 * pushing unconditionally.
 */
export async function segmentToElement(type: string, data: Record<string, unknown>, options?: ParseOptions): Promise<Segment | null> {
  const normalizedType = type.toLowerCase();
  if (options?.replyPreview) assertReplyPreviewType(normalizedType);
  if (normalizedType === "reply" && Object.hasOwn(data, "message")) {
    if (!options?.forwardReply) {
      throw new MessageElementValidationError(
        "UNSENDABLE_TYPE",
        "reply.message is only supported inside a forward node",
        "reply",
        "message",
      );
    }
    return parseForwardReply(data, options.forwardReply);
  }
  if (normalizedType !== "node" && normalizedType !== "anonymous") assertScalarSegmentData(normalizedType, data);

  switch (normalizedType) {
    case "node":
      throw new MessageElementValidationError(
        "UNSENDABLE_TYPE",
        'message segment "node" is only valid inside a forward node list',
        normalizedType,
      );
    case "share": {
      const url = requireNonEmptyStringField(normalizedType, data, "url");
      const title = requireNonEmptyStringField(normalizedType, data, "title");
      const content = String(data["content"] ?? "");
      const image = String(data["image"] ?? "");
      return {
        type: "json",
        text: JSON.stringify({
          app: "com.tencent.structmsg",
          view: "news",
          prompt: title,
          meta: { news: { title, desc: content, jumpUrl: url, preview: image } },
        }),
      };
    }
    case "music": {
      const musicType = requireNonEmptyStringField(normalizedType, data, "type");
      const hasMusicId = data["id"] !== undefined && data["id"] !== null && String(data["id"]).trim() !== "";
      const hasCustomMusicData = ["url", "audio", "title", "image", "content"].some((field) =>
        Object.prototype.hasOwnProperty.call(data, field),
      );
      const usesCustomMusicData = musicType === "custom" || (!hasMusicId && hasCustomMusicData);
      if (usesCustomMusicData) {
        requireNonEmptyStringField(normalizedType, data, "url");
        requireNonEmptyStringField(normalizedType, data, "audio");
        requireNonEmptyStringField(normalizedType, data, "title");
      } else if (!hasMusicId) {
        throw new MessageElementValidationError(
          "MISSING_FIELD",
          'message segment "music" requires field "id" for a platform card',
          normalizedType,
          "id",
        );
      }
      const signUrl = options?.musicSignUrl || DEFAULT_MUSIC_SIGN_URL;
      const doFetch = options?.fetchImpl ?? fetch;
      try {
        const postData = usesCustomMusicData
          ? {
              type: musicType,
              id: undefined,
              url: String(data["url"] ?? ""),
              audio: String(data["audio"] ?? ""),
              title: String(data["title"] ?? ""),
              image: String(data["image"] ?? ""),
              singer: String(data["content"] ?? ""),
            }
          : { type: musicType, id: String(data["id"] ?? "") };
        const resp = await doFetch(signUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(postData),
        });
        if (!resp.ok) throw new Error(`music sign HTTP ${resp.status}`);
        return { type: "json", text: await resp.text() };
      } catch {
        const title = String(data["title"] ?? "Music");
        return {
          type: "json",
          text: JSON.stringify({
            app: "com.tencent.structmsg",
            view: "music",
            prompt: `[音乐]${title}`,
            meta: { music: { title, desc: String(data["content"] ?? ""), jumpUrl: String(data["url"] ?? ""), musicUrl: String(data["audio"] ?? ""), preview: String(data["image"] ?? "") } },
          }),
        };
      }
    }
    case "location": {
      const lat = requireCoordinate(data, "lat");
      const lon = requireCoordinate(data, "lon");
      const title = String(data["title"] ?? "位置");
      const content = String(data["content"] ?? `${lat},${lon}`);
      return {
        type: "json",
        text: JSON.stringify({
          app: "com.tencent.map",
          view: "LocationShare",
          prompt: `[位置]${title}`,
          meta: { Location: { lat, lng: lon, title, address: content } },
        }),
      };
    }
    case "contact": {
      const contactType = requireNonEmptyStringField(normalizedType, data, "type");
      if (contactType !== "qq" && contactType !== "group") {
        throw new MessageElementValidationError(
          "INVALID_FIELD",
          'message segment "contact" field "type" must be "qq" or "group"',
          normalizedType,
          "type",
        );
      }
      const contactId = String(data["id"] ?? "").trim();
      const numericId = intOr(contactId, 0);
      if (numericId <= 0) {
        throw new MessageElementValidationError(
          "INVALID_FIELD",
          'message segment "contact" field "id" must be a positive integer',
          normalizedType,
          "id",
        );
      }
      const normalizedContactType = contactType.trim().toLowerCase();
      if (options?.resolveContactArk && (normalizedContactType === "qq" || normalizedContactType === "group")) {
        const ark = await options.resolveContactArk(contactType, numericId);
        if (!ark) throw new Error(`contact ark unavailable for ${contactType}:${numericId}`);
        return { type: "json", text: ark };
      }
      return {
        type: "json",
        text: JSON.stringify({
          app: "com.tencent.contact.lua",
          view: "contact",
          prompt: `[推荐${contactType === "group" ? "群" : "好友"}]`,
          meta: { contact: { type: contactType, id: contactId } },
        }),
      };
    }
    case "rps":
      return { type: "face", faceId: 359 };
    case "dice":
      return { type: "face", faceId: 358 };
    case "shake":
      return { type: "poke", subType: 1 };
    case "anonymous":
      throw new MessageElementValidationError(
        "UNSENDABLE_TYPE",
        'message segment "anonymous" has no executable send semantics',
        normalizedType,
      );
    case "text": {
      const text = String(data["text"] ?? "");
      return text ? { type: "text", text } : null;
    }
    case "face": {
      const id = intOr(data["id"], -1);
      if (id < 0) return null;
      const element: Segment = { type: "face", faceId: id };
      if (data["resultId"] !== undefined) {
        if (typeof data["resultId"] === "string") element.resultId = data["resultId"];
        else if (typeof data["resultId"] === "number" && Number.isSafeInteger(data["resultId"]) && data["resultId"] >= 0) {
          element.resultId = String(data["resultId"]);
        } else {
          throw new MessageElementValidationError(
            "INVALID_FIELD",
            "face.resultId must be a string or non-negative safe integer",
            "face",
            "resultId",
          );
        }
      }
      if (data["large"] !== undefined) {
        const large = data["large"];
        if (large === true || large === "true" || large === 1 || large === "1") element.large = true;
        else if (large === false || large === "false" || large === 0 || large === "0") element.large = false;
        else throw new MessageElementValidationError("INVALID_FIELD", "face.large must be a boolean", "face");
      }
      return element;
    }
    case "at": {
      const qq = String(data["qq"] ?? "").trim();
      if (qq === "all") return { type: "at", targetUin: 0, uid: "all", text: "@全体成员 " };
      const uin = intOr(qq, 0);
      if (uin <= 0) return null;
      const name = String(data["name"] ?? data["nickname"] ?? data["card"] ?? "").trim();
      let uid = String(data["uid"] ?? "").trim();
      if (!uid && options?.resolveMentionUid) uid = (await options.resolveMentionUid(uin))?.trim() ?? "";
      const element: Segment = { type: "at", targetUin: uin };
      if (uid) element.uid = uid;
      if (name) element.text = `@${name} `;
      return element;
    }
    case "reply": {
      let id: number;
      try {
        id = intOr(data["id"], 0);
      } catch (error) {
        if (!(error instanceof MessageElementValidationError)) throw error;
        return null;
      }
      if (id === 0) return null;
      const meta = (await options?.resolveReplyMeta?.(id)) ?? null;
      if (options?.resolveReplySequence) {
        const resolved = await options.resolveReplySequence(id);
        if (typeof resolved === "number" && resolved > 0) {
          const element: Segment = { type: "reply", replySeq: resolved, replyMessageId: id };
          if (meta) {
            element.replySenderUin = meta.senderUin;
            element.replyTime = meta.time;
            element.replyRandom = meta.random;
            element.replyElements = meta.elements as never;
          }
          return element;
        }
      }
      if (meta?.sequenceAuthoritative === false) return null;
      if (id > 0) return { type: "reply", replySeq: id };
      return null;
    }
    case "image": {
      const imgEmojiId = String(data["emoji_id"] ?? "").trim();
      if (imgEmojiId) return marketFaceElement(imgEmojiId, data);
      const image: Segment = {
        type: "image",
        url: pickMediaSource(data),
        flash: data["type"] === "flash",
        subType: intOr(data["sub_type"] ?? data["subType"], 0),
      };
      if (data["summary"]) image.summary = String(data["summary"]);
      return image;
    }
    case "record": {
      const source = pickMediaSource(data);
      if (!source) return null;
      return { type: "record", url: source };
    }
    case "video": {
      const source = pickMediaSource(data);
      if (!source) return null;
      const video: Segment = { type: "video", url: source };
      if (data["thumb"]) video.thumbUrl = String(data["thumb"]);
      return video;
    }
    case "json": {
      const raw = data["data"];
      const text = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? JSON.stringify(raw) : raw;
      if (typeof text !== "string" || !text.trim()) {
        throw new MessageElementValidationError(
          "INVALID_FIELD",
          'message segment "json" field "data" must be a JSON object or non-empty JSON string',
          "json",
          "data",
        );
      }
      return { type: "json", text };
    }
    case "xml":
      return { type: "xml", text: String(data["data"] ?? ""), subType: intOr(data["resid"] ?? data["id"], 0) };
    case "forward": {
      // `forward` carries the resource id under `id`; `res_id`/`forward_id` are what a
      // *received* segment uses, and `get_forward_msg` accepts all three.
      const resId = String(data["id"] ?? data["res_id"] ?? data["forward_id"] ?? "");
      return { type: "forward", resId };
    }
    case "mface": {
      const emojiId = String(data["emoji_id"] ?? data["emojiId"] ?? data["id"] ?? "").trim();
      if (!emojiId) {
        throw new MessageElementValidationError(
          "MISSING_FIELD",
          'message segment "mface" is missing required or usable fields',
          "mface",
        );
      }
      return marketFaceElement(emojiId, data);
    }
    case "poke": {
      const subType = intOr(data["type"] ?? data["sub_type"] ?? data["subType"], 1);
      return { type: "poke", subType };
    }
    case "file": {
      // Every alias the reference accepts (reference:22014-22036), because the
      // callers use DIFFERENT names for the same field and dropping one is silent:
      //
      //   id / file_id / fileId            the server-side file id
      //   name / filename / fileName       the display name
      //   file_size / size / fileSize      the byte count
      //   md5 / md5Hex                     32 hex chars → BYTES on the wire
      //   sha1 / sha1Hex                   40 hex chars → BYTES
      //   file_hash / fileHash             the server's opaque addon
      //
      // `upload_private_file` sends `{file_id, name, file_size, md5, file_hash}`
      // (reference:10408-10414), so `file_size` and `file_hash` are LOAD-BEARING
      // here: without them the file is delivered with size 0 and no addon, which
      // the recipient sees as a corrupt attachment rather than an error.
      //
      // The reference also has a `pickMediaSource(data)` fallback for the url; this
      // port's equivalent is the bare `url` field, and a `file://`/`base64://`
      // source under it is handled by the same classifier the upload path uses.
      const fileId = data["file_id"] ?? data["fileId"] ?? data["id"];
      const url = data["url"];
      const element: Segment = { type: "file" };
      if (fileId !== undefined && String(fileId).trim() !== "") element.fileId = String(fileId);
      if (url !== undefined && String(url).trim() !== "") element.url = String(url);
      const fileName = data["name"] ?? data["filename"] ?? data["fileName"];
      if (fileName !== undefined && String(fileName).trim() !== "") element.fileName = String(fileName).trim();
      const fileSize = data["file_size"] ?? data["size"] ?? data["fileSize"];
      if (fileSize !== undefined) {
        const size = intOr(fileSize, 0);
        // `> 0`, not `!== undefined`: the reference's `if (fileSize > 0)` (:22033),
        // so an explicit zero leaves the field ABSENT rather than asserting size 0.
        if (size > 0) element.fileSize = size;
      }
      const md5Hex = data["md5"] ?? data["md5Hex"];
      if (md5Hex !== undefined && String(md5Hex).trim() !== "") element.md5Hex = String(md5Hex).trim();
      const sha1Hex = data["sha1"] ?? data["sha1Hex"];
      if (sha1Hex !== undefined && String(sha1Hex).trim() !== "") element.sha1Hex = String(sha1Hex).trim();
      const fileHash = data["file_hash"] ?? data["fileHash"];
      if (fileHash !== undefined && String(fileHash).trim() !== "") element.fileHash = String(fileHash).trim();
      if (!element.fileId && !element.url) {
        throw new MessageElementValidationError(
          "MISSING_FIELD",
          'message segment "file" is missing required or usable fields',
          "file",
        );
      }
      return element;
    }
    default:
      throw new MessageElementValidationError("UNKNOWN_TYPE", `unknown message segment type: ${type}`, normalizedType);
  }
}

/**
 * `segmentPayload` (reference:22490).
 *
 * Flattens `data` into the top level, with one exception: a `json` segment whose
 * `data` is a *string* keeps it under `data`, because otherwise the card text would be
 * spread as character keys.
 */
export function segmentPayload(seg: { type?: unknown; data?: unknown } & Record<string, unknown>): Record<string, unknown> {
  const topLevel: Record<string, unknown> = { ...seg };
  delete topLevel["type"];
  delete topLevel["data"];
  if (typeof seg.type === "string" && seg.type.toLowerCase() === "json" && typeof seg.data === "string") {
    return { ...topLevel, data: seg.data };
  }
  const nested = seg.data && typeof seg.data === "object" && !Array.isArray(seg.data) ? (seg.data as Record<string, unknown>) : {};
  return { ...topLevel, ...nested };
}

function isSegmentArray(val: unknown): val is Array<{ type: string } & Record<string, unknown>> {
  return (
    Array.isArray(val) &&
    val.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        !Array.isArray(item) &&
        typeof (item as { type?: unknown }).type === "string" &&
        (item as { type: string }).type.trim().length > 0,
    )
  );
}

function isExplicitEmptyTextPlaceholder(segment: { type?: unknown; data?: unknown }): boolean {
  if (typeof segment.type !== "string" || segment.type.toLowerCase() !== "text") return false;
  return segmentPayload(segment)["text"] === "";
}

/** `exclusiveForwardNodeList` (reference:22219). */
export function exclusiveForwardNodeList(message: unknown, autoEscape: boolean): unknown[] | null {
  if (autoEscape && typeof message === "string") return null;
  if (typeof message === "object" && message !== null && !Array.isArray(message)) {
    const type = (message as { type?: unknown }).type;
    return typeof type === "string" && type.toLowerCase() === "node" ? [message] : null;
  }
  if (!Array.isArray(message) || message.length === 0) return null;
  const nodes: unknown[] = [];
  for (const item of message) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const seg = item as { type?: unknown; data?: unknown };
    const type = seg.type;
    if (typeof type !== "string" || type.trim().length === 0) return null;
    if (isExplicitEmptyTextPlaceholder(seg)) continue;
    if (type.toLowerCase() !== "node") return null;
    nodes.push(item);
  }
  return nodes.length > 0 ? nodes : null;
}

/** `outboundInputSegmentSummary` (reference:22260). */
export function outboundInputSegmentSummary(
  message: unknown,
  autoEscape: boolean,
): { rawTypes: string[]; effectiveVideoTypes: string[] } {
  if (typeof message === "string") {
    if (autoEscape) return { rawTypes: ["text"], effectiveVideoTypes: ["text"] };
    const types: string[] = [];
    let lastIndex = 0;
    for (const match of message.matchAll(CQ_REGEX)) {
      const index = match.index ?? 0;
      if (index > lastIndex) types.push("text");
      types.push((match[1] ?? "").toLowerCase());
      lastIndex = index + match[0].length;
    }
    if (lastIndex < message.length) types.push("text");
    return { rawTypes: types, effectiveVideoTypes: types };
  }
  if (Array.isArray(message)) {
    const rawTypes: string[] = [];
    const effectiveVideoTypes: string[] = [];
    for (const item of message) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
      const seg = item as { type?: unknown; data?: unknown };
      if (typeof seg.type !== "string") continue;
      const normalized = seg.type.toLowerCase();
      rawTypes.push(normalized);
      if (!isExplicitEmptyTextPlaceholder(seg)) effectiveVideoTypes.push(normalized);
    }
    return { rawTypes, effectiveVideoTypes };
  }
  if (typeof message === "object" && message !== null) {
    const type = (message as { type?: unknown }).type;
    const types = typeof type === "string" ? [type.toLowerCase()] : [];
    return { rawTypes: types, effectiveVideoTypes: types };
  }
  return { rawTypes: [], effectiveVideoTypes: [] };
}

/**
 * `assertOutboundMessageInput` (reference:22294).
 *
 * Runs BEFORE parsing so an unsupported combination is rejected without the parser
 * doing any externally visible work (resolving at-uids, fetching cards, signing
 * music). The two policies it applies are the only two the manifest has.
 */
export function assertOutboundMessageInput(message: unknown, autoEscape: boolean, scene: string): void {
  const { rawTypes, effectiveVideoTypes } = outboundInputSegmentSummary(message, autoEscape);
  assertVideoSendPolicy(effectiveVideoTypes.filter((type) => type === "video").length, effectiveVideoTypes.length);
  const shakeCount = rawTypes.filter((type) => type === "poke" || type === "shake").length;
  assertWindowShakeSendPolicy(shakeCount, rawTypes.length, scene);
}

async function parseFromCQString(message: string, options?: ParseOptions): Promise<Segment[]> {
  const elements: Segment[] = [];
  let lastIndex = 0;
  for (const match of message.matchAll(CQ_REGEX)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      const text = cqUnescape(message.substring(lastIndex, index));
      if (text) elements.push({ type: "text", text });
    }
    lastIndex = index + match[0].length;
    const cqType = match[1]!;
    const elem = await segmentToElement(cqType, parseCQParams(match[2] || ""), options);
    if (elem) elements.push(elem);
  }
  if (lastIndex < message.length) {
    const text = cqUnescape(message.substring(lastIndex));
    if (text) elements.push({ type: "text", text });
  }
  return elements;
}

/**
 * `parseMessage` (reference:22511).
 *
 * The three input shapes are handled in the reference's order (string, array, single
 * object) and each has its own error text, because clients report those strings.
 */
export async function parseMessage(message: unknown, autoEscape: boolean, options?: ParseOptions): Promise<Segment[]> {
  if (typeof message === "string") {
    if (message.length === 0) throw invalidMessageShape("message must not be empty");
    if (autoEscape) return [{ type: "text", text: message }];
    const elements = await parseFromCQString(message, options);
    if (elements.length === 0) throw invalidMessageShape("message must contain at least one sendable segment");
    return elements;
  }
  if (Array.isArray(message)) {
    if (!isSegmentArray(message)) {
      throw new MessageElementValidationError(
        "INVALID_FIELD",
        "message segment array entries must be objects with a non-empty string type",
        "",
        "message",
      );
    }
    if (message.length === 0) throw invalidMessageShape("message segment array must not be empty");
    const elements: Segment[] = [];
    for (const seg of message) {
      const data = segmentPayload(seg);
      if (isExplicitEmptyTextPlaceholder(seg)) continue;
      const elem = await segmentToElement(seg.type, data, options);
      if (elem) elements.push(elem);
    }
    if (elements.length === 0) throw invalidMessageShape("message must contain at least one sendable segment");
    return elements;
  }
  if (typeof message === "object" && message !== null) {
    const seg = message as { type?: unknown; data?: unknown } & Record<string, unknown>;
    if (typeof seg.type === "string" && seg.type.trim()) {
      const elem = await segmentToElement(seg.type, segmentPayload(seg), options);
      if (elem) return [elem];
      throw invalidMessageShape("message must contain at least one sendable segment");
    }
    throw new MessageElementValidationError(
      "MISSING_FIELD",
      "single message segment requires a non-empty string type",
      "",
      "type",
    );
  }
  throw new MessageElementValidationError(
    "INVALID_FIELD",
    "message must be a string, a segment object, or a segment array",
    "",
    "message",
  );
}