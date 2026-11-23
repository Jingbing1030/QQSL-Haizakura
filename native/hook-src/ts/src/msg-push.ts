/**
 * msg-push: the inbound direction — hand-written half.
 *
 * QQ pushes protobuf `PushMsg` frames on the OlPush service. `msg-push-fields.ts`
 * (generated) turns those bytes into typed message objects; this file turns
 * messages into the event shape the rest of the framework consumes.
 *
 * ## Scope, stated honestly
 *
 * Ported in full:
 *   - group message (`PkgType 82`), private message (166 plus the 9/208/529
 *     variants), group-temp message (141) -- all three decode through
 *     `decodeRichBody`;
 *   - the `Elem` -> segment converter (`convertElements`), which is the piece the
 *     OneBot layer actually reads: text, at, face, mface, image (legacy + NT),
 *     video, record, file, poke, reply, json, xml, forward, markdown;
 *   - group recall (0x2DC/17), group mute (0x2DC/12), group poke (0x2DC/20),
 *     friend recall (0x210/138+139), friend request (0x210/35), friend add
 *     (0x210/179+226), friend poke (0x210/290).
 *
 * The post-decode survival filter (reference L135849 .. L135903 and
 * L177190 .. L177282) is NOT defined in this file. `decodePush` here is the
 * unfiltered half — the ported twin of `MsgPushRegistry.decode` (L153988), which
 * is exactly what the reference filters *afterwards*.
 *
 * The filter lives in `bridge/apis/history-fetch.ts` as `isC2cControlPush` and
 * `keepDecodedMessage` (reference L135872 / L135905), ported for the history
 * fetchers that need the same decision. `bridge/msg-push-pipeline.ts` calls
 * `keepDecodedMessage` on the live OlPush path, so there is one implementation,
 * not two. A caller of `decodePush` directly gets unfiltered events and must
 * apply the filter itself to match reference behaviour.
 *
 * Skeletoned — returns `[]` with a debug log, which is exactly what the
 * reference does for an unhandled subType (never a crash):
 *   - inline_keyboard (svc 46/50/51) and flash_file (svc 45 biz 3): both need
 *     JSON-card plumbing that is not on the 228-action path;
 *   - group member join/leave, group join/invite requests,
 *     essence, emoji-like, group title/name change, online devices, remark
 *     changed, input status, profile like, ptt-trans result.
 *
 * ## Field numbers
 *
 * Not one field number is written in this file -- they all live in the generated
 * `msg-push-fields.ts`, each annotated with the `reference/index.mjs` line it was
 * read from. What *is* written here are the reference's **policy** decisions
 * (which element wins when two encode the same image, when a text is dropped,
 * which UID resolves through identity), because those are not derivable from a
 * field table.
 *
 * Verification: `ts/test/msg-push.test.ts` (round-trip against element-builder,
 * plus reference-derived fixtures) and `work/msgpush/compare.mjs` (field-by-field
 * differential against the running reference — 16/16 messages match).
 */

import { inflateSync } from "node:zlib";

import {
  decodeElem,
  decodeNotOnlineImage,
  decodeFriendRecall,
  decodeFriendRequest,
  decodeGeneralGrayTipInfo,
  decodeFileExtra,
  decodeGroupFileExtra,
  decodeGroupAdmin,
  decodeGroupMute,
  decodeMarkdownData,
  decodeMentionExtra,
  decodeMsgInfo,
  decodeNewFriend,
  decodeNotifyMessageBody,
  decodePushMsg,
  decodePushMsgBody,
  decodeQFaceExtra,
  decodeQSmallFaceExtra,
  decodeTemplParam,
  type CommonElem,
  type Elem,
  type PushMsgBody,
  type RichText,
} from "./msg-push-fields.js";

// ===========================================================================
// Segment model — what the OneBot layer consumes
// ===========================================================================

export interface TextSegment {
  type: "text";
  text: string;
}

export interface AtSegment {
  type: "at";
  /** 0 for @全体成员; otherwise from `attr6Buf` or the mention payload. */
  targetUin: number;
  /** The raw @ text, kept because OneBot echoes it back on send. */
  text: string;
  /** The UID form of the target, from `TextElem.pbReserve`. */
  uid?: string;
}

export interface FaceSegment {
  type: "face";
  faceId: number;
  resultId?: string;
}

export interface MfaceSegment {
  type: "mface";
  text: string;
  emojiId: string;
  emojiPackageId: number;
  emojiKey: string;
}

export interface ImageSegment {
  type: "image";
  imageUrl: string;
  fileId: string;
  fileSize: number;
  width: number;
  height: number;
  subType?: number;
  summary?: string;
  md5Hex?: string;
  sha1Hex?: string;
  picFormat?: number;
  /** Set on svc-3 "flash image" payloads. */
  flash?: boolean;
}

export interface RecordSegment {
  type: "record";
  fileName: string;
  fileId?: string;
  fileSize: number;
  duration: number;
  fileHash: string;
  voiceFormat?: number;
  /** Set by `assignValidFingerprints` when the wire md5 is well-formed. */
  md5Hex?: string;
  sha1Hex?: string;
  mediaNode?: MediaNode;
}

export interface VideoSegment {
  type: "video";
  fileId: string;
  fileName: string;
  fileSize: number;
  duration: number;
  fileHash: string;
  width?: number;
  height?: number;
  videoFormat?: number;
  /** Set by `assignValidFingerprints` when the wire md5 is well-formed. */
  md5Hex?: string;
  sha1Hex?: string;
  mediaNode?: MediaNode;
}

export interface FileSegment {
  type: "file";
  fileId: string;
  fileName: string;
  fileSize: number;
  fileHash?: string;
}

export interface PokeSegment {
  type: "poke";
  subType: number;
}

export interface ReplySegment {
  type: "reply";
  replySeq: number;
  replySenderUin?: number;
  replyTime?: number;
  replyElements?: MessageSegment[];
}

export interface JsonSegment {
  type: "json";
  text: string;
}

export interface XmlSegment {
  type: "xml";
  text: string;
  subType?: number;
}

export interface ForwardSegment {
  type: "forward";
  resId: string;
  forwardUuid?: string;
}

export interface MarkdownSegment {
  type: "markdown";
  text: string;
}

export interface FlashFileSegment {
  type: "flash_file";
  filesetId: string;
  fileName: string;
  sceneType: number;
  thumbUrl?: string;
}

export type MessageSegment =
  | TextSegment | AtSegment | FaceSegment | MfaceSegment | ImageSegment
  | RecordSegment | VideoSegment | FileSegment | PokeSegment | ReplySegment
  | JsonSegment | XmlSegment | ForwardSegment | MarkdownSegment | FlashFileSegment;

/**
 * The NT-media re-upload descriptor carried on record/video segments. Shape is
 * `buildMediaNode` (L135227): both types share one builder so a field added to
 * one never drifts from the other.
 */
export interface MediaNode {
  fileUuid: string;
  storeId?: number;
  uploadTime?: bigint;
  ttl?: number;
  subType?: number;
  info: {
    fileSize: number;
    fileHash: string;
    fileSha1?: string;
    fileName: string;
    width?: number;
    height?: number;
    time: number;
    original?: number;
    type: {
      type?: number;
      picFormat?: number;
      videoFormat?: number;
      voiceFormat?: number;
    };
  };
}

// ===========================================================================
// Identity — the reference's synchronous UID <-> UIN resolver
// ===========================================================================
//
// `resolveUidToUin` (L122224) is explicit that a miss means *unresolved* (0) and
// that the decoder must not invent a UIN. That matters: a fabricated UIN sends
// OneBot events to the wrong user. The port keeps the same contract -- 0 means
// "unknown to us", never a fallback to some unrelated field.

export interface GroupMemberInfo {
  nickname: string;
  card: string;
  role: string;
  uid?: string;
}

export interface Identity {
  findUinByUid(uid: string, groupId?: number): number | undefined;
  findGroupMember(groupId: number, uin: number): GroupMemberInfo | undefined;
  findFriend(uin: number): { nickname: string; uid?: string } | undefined;
  findGroup(groupId: number): { groupName: string } | undefined;
}

/** No-op identity: every lookup misses, so every UID stays unresolved (0). */
export const EMPTY_IDENTITY: Identity = {
  findUinByUid: () => undefined,
  findGroupMember: () => undefined,
  findFriend: () => undefined,
  findGroup: () => undefined,
};

/** reference L122224 `resolveUidToUin`. */
export function resolveUidToUin(identity: Identity, groupId: number, uid: string): number {
  if (!uid) return 0;
  return identity.findUinByUid(uid, groupId || undefined) ?? 0;
}

/**
 * reference L122232 `c2cRoutingUin`: prefer identity on the hop UID, else that
 * hop's own wire UIN. Explicitly *not* a fallback that assigns an unrelated
 * header UIN to a different UID.
 */
export function c2cRoutingUin(identity: Identity, uid: string, wireUin: number): number {
  const resolved = resolveUidToUin(identity, 0, uid);
  if (resolved > 0) return resolved;
  return wireUin > 0 ? wireUin : 0;
}

// ===========================================================================
// Byte / hex / URL helpers
// ===========================================================================

/** reference L10979 `toHex`, L10982 `toHexUpper`. */
export function toHex(data: Uint8Array): string {
  let out = "";
  for (const byte of data) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function toHexUpper(data: Uint8Array): string {
  return toHex(data).toUpperCase();
}

/** reference L122158 `makeImageUrl`. */
export function makeImageUrl(origUrl: string): string {
  if (!origUrl) return "";
  if (/^https?:\/\//i.test(origUrl)) return origUrl;
  if (!origUrl.startsWith("/")) return "";
  if (origUrl.includes("rkey") || origUrl.includes("fileid")) {
    return "https://multimedia.nt.qq.com.cn" + origUrl;
  }
  return "http://gchat.qpic.cn" + origUrl;
}

/** reference L122166 `imageUrlFromMd5`. */
export function imageUrlFromMd5(md5Hex: string): string {
  if (!/^[0-9a-fA-F]{32}$/.test(md5Hex)) return "";
  return `http://gchat.qpic.cn/gchatpic_new/0/0-0-${md5Hex.toUpperCase()}/0`;
}

/** reference L122171 `ntImageUrlFromFileId`. */
export function ntImageUrlFromFileId(fileId: string, isGroup: boolean): string {
  if (!fileId) return "";
  const appid = isGroup ? 1407 : 1406;
  return `https://multimedia.nt.qq.com.cn/download?appid=${appid}&fileid=${encodeURIComponent(fileId)}`;
}

/** reference L135215 `assignValidFingerprints`: only well-formed hex is accepted. */
function assignValidFingerprints(
  element: { md5Hex?: string; sha1Hex?: string },
  md5Hex: string | null | undefined,
  sha1Hex: string | null | undefined,
  _source: string,
): void {
  if (md5Hex && /^[0-9a-fA-F]{32}$/.test(md5Hex)) element.md5Hex = md5Hex;
  if (sha1Hex && /^[0-9a-fA-F]{40}$/.test(sha1Hex)) element.sha1Hex = sha1Hex;
}

interface NodeIndex {
  fileUuid?: string | null;
  storeId?: number | null;
  uploadTime?: bigint | null;
  ttl?: number | null;
  subType?: number | null;
}

interface NodeFileInfo {
  fileSize: number | null;
  fileHash: string | null;
  fileSha1: string | null;
  fileName: string | null;
  width: number | null;
  height: number | null;
  time: number | null;
  original: number | null;
  type: {
    type: number | null;
    picFormat: number | null;
    videoFormat: number | null;
    voiceFormat: number | null;
  } | null;
}

/** reference L135227 `buildMediaNode`. */
function buildMediaNode(idx: NodeIndex, fi: NodeFileInfo): MediaNode {
  const out: MediaNode = {
    fileUuid: idx.fileUuid ?? "",
    info: {
      fileSize: fi.fileSize ?? 0,
      fileHash: fi.fileHash ?? "",
      fileName: fi.fileName ?? "",
      time: fi.time ?? 0,
      // `exactOptionalPropertyTypes` forbids assigning an explicit `undefined`
      // to an optional field, so the absent case has to be an omission.
      type: {},
    },
  };
  if (fi.type?.type != null) out.info.type.type = fi.type.type;
  if (fi.type?.picFormat != null) out.info.type.picFormat = fi.type.picFormat;
  if (fi.type?.videoFormat != null) out.info.type.videoFormat = fi.type.videoFormat;
  if (fi.type?.voiceFormat != null) out.info.type.voiceFormat = fi.type.voiceFormat;
  if (idx.storeId != null) out.storeId = idx.storeId;
  if (idx.uploadTime != null) out.uploadTime = idx.uploadTime;
  if (idx.ttl != null) out.ttl = idx.ttl;
  if (idx.subType != null) out.subType = idx.subType;
  if (fi.fileSha1) out.info.fileSha1 = fi.fileSha1;
  if (fi.width != null) out.info.width = fi.width;
  if (fi.height != null) out.info.height = fi.height;
  if (fi.original != null) out.info.original = fi.original;
  return out;
}

// ===========================================================================
// Wire-field bookkeeping (reference L134924 / L134939)
// ===========================================================================
//
// Which `Elem` members this port actually turns into segments. Anything present
// but absent from this set is logged and dropped — the reference does the same,
// because dropping silently is how "my sticker vanished" becomes unfalsifiable.
const DECODED_WIRE_FIELDS: ReadonlySet<string> = new Set([
  "text", "face", "notOnlineImage", "transElem", "marketFace", "customFace",
  "richMsg", "groupFile", "videoFile", "srcMsg", "lightApp", "commonElem",
  "extraInfo", "generalFlags",
]);

const METADATA_WIRE_FIELDS: ReadonlySet<string> = new Set(["extraInfo", "generalFlags"]);

let unknownElementLog = { debug: (_msg: string, ..._args: unknown[]): void => {} };

/** Install a logger for dropped wire fields (pass a no-op to silence). */
export function setUnknownElementLogger(
  log: { debug(msg: string, ...args: unknown[]): void } | null,
): void {
  unknownElementLog = log ?? { debug: () => {} };
}

/** reference L135202 `BIG_FACE_COMPAT_SUFFIX`. */
const BIG_FACE_COMPAT_SUFFIX = "]请使用最新版手机QQ体验新功能";

/** reference L135203 `isValidBigFace`. */
function isValidBigFace(extra: { qsid?: number | null } | null): boolean {
  const qsid = extra?.qsid;
  return qsid != null && Number.isSafeInteger(qsid) && qsid >= 0;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}

/**
 * reference L135209 `isBigFaceCompatibilityText`.
 *
 * Old clients render a big face as the literal text `[表情名]请使用最新版...`.
 * Recognising it requires re-encoding `TextElem` with the suffix and comparing
 * bytes, because the compatibility payload is byte-identical to what an old
 * client would send — there is no marker field to test.
 */
function isBigFaceCompatibilityText(extra: { text?: string | null }, text: {
  str?: string | null;
  pbReserve?: Uint8Array | null;
}): boolean {
  const faceText = extra.text ?? "";
  const reserveData = text.pbReserve;
  if (!faceText || text.str !== faceText || !reserveData?.length) return false;
  const expected = encodeTextElem({ str: `[${faceText.slice(1)}${BIG_FACE_COMPAT_SUFFIX}` });
  return bytesEqual(reserveData, expected);
}

/** Encode a `TextElem` the way `element-builder.ts` does, for the byte compare above. */
function encodeTextElem(obj: { str: string }): Uint8Array {
  const bytes = encodeUtf8(obj.str);
  const out: number[] = [0x0a]; // field 1, wire 2
  writeVarint(out, bytes.length);
  for (const b of bytes) out.push(b);
  return Uint8Array.from(out);
}

function writeVarint(out: number[], value: number): void {
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// ===========================================================================
// Image identity policy (reference L135613 .. L135651)
// ===========================================================================
//
// A single QQ image can arrive twice: once as the legacy `notOnlineImage` /
// `customFace` elem, once as an NT `commonElem` (svc 48, biz 10/20). The legacy
// copy carries a `gchat.qpic.cn` URL that is frequently dead; the NT copy
// carries a `multimedia.nt.qq.com.cn` URL that works. The reference keeps the NT
// one and drops the legacy sibling — but only when it can prove they are the
// same file, so a *different* legacy image is never dropped by mistake.

/** reference L135613 `hasUsableImageIdentity`. */
function hasUsableImageIdentity(element: ImageSegment): boolean {
  if (element.fileId) return true;
  if (element.md5Hex && /^[0-9a-fA-F]{32}$/.test(element.md5Hex)) return true;
  return isUsableImageUrl(element.imageUrl ?? "");
}

/** reference L135620 `isNtImage`. */
function isNtImage(element: ImageSegment): boolean {
  if (!hasUsableImageIdentity(element)) return false;
  if (element.picFormat != null || element.sha1Hex) return true;
  return (element.imageUrl ?? "").includes("://multimedia.nt.qq.com.cn/");
}

/** reference L135626 `isUsableImageUrl`. */
function isUsableImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  // Both hosts are checked identically on purpose: the reference does not rank
  // gchat above nt, it only requires a non-empty path.
  return parsed.pathname.length > 1;
}

/** reference L135635 `sameImageFile`. */
function sameImageFile(left: ImageSegment, right: ImageSegment): boolean {
  if (left.fileId && right.fileId && left.fileId === right.fileId) return true;
  return Boolean(left.md5Hex && right.md5Hex && left.md5Hex === right.md5Hex);
}

/** reference L135640 `dropLegacyImageSiblings`. */
function dropLegacyImageSiblings(elements: MessageSegment[]): MessageSegment[] {
  const ntImages = elements.filter(
    (element): element is ImageSegment => element.type === "image" && isNtImage(element),
  );
  return elements.filter((element) => {
    if (element.type !== "image") return true;
    if (isNtImage(element)) return true;
    const url = element.imageUrl ?? "";
    if (!url || !isUsableImageUrl(url)) return false;
    return !ntImages.some((nt) => sameImageFile(nt, element));
  });
}

// ===========================================================================
// Card decoding — richMsg / lightApp (reference L134945 .. L135097)
// ===========================================================================
//
// Cards are the one place where a segment is *not* a protobuf message: the
// payload is (usually) compacted JSON or XML, and the reference caps output
// bytes so a hostile card cannot make the client allocate without bound.

/** reference L122156 / L122157. */
const MAX_RICH_CARD_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_RICH_CARD_MESSAGE_OUTPUT_BYTES = 8 * 1024 * 1024;

interface CardResult {
  element: MessageSegment | null;
  error: string | null;
  inputBytes: number;
  budgetBytes: number;
}

function invalidCard(inputBytes: number, error: string, budgetBytes = 0): CardResult {
  return { element: null, error, inputBytes, budgetBytes };
}

interface DecompressResult {
  ok: boolean;
  text?: string;
  /** Bytes the decompressed payload actually occupied, for budget accounting. */
  outputBytes?: number;
  reason?: string;
}

/**
 * reference L122175 `decompressData`.
 *
 * The format is a **one-byte marker**, not a zlib sniff: `0x01` means "rest is
 * zlib-deflated", `0x00` means "rest is plain UTF-8", anything else means "the
 * whole thing is plain UTF-8". Guessing from the zlib magic instead would work
 * on marker-1 payloads by luck and silently corrupt/unread a marker-0 card whose
 * first character happens to be 0x78.
 *
 * `maxOutputLength` is passed to zlib so an inflate bomb is refused by the
 * allocator rather than after allocating.
 */
function decompressData(data: Uint8Array, maxOutputBytes = MAX_RICH_CARD_OUTPUT_BYTES): DecompressResult {
  if (!data || data.length === 0) return { ok: false, reason: "empty_payload" };
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new Error(`invalid decompression output limit: ${maxOutputBytes}`);
  }
  const marker = data[0];
  if ((marker === 0 || marker === 1) && data.length === 1) {
    return { ok: false, reason: "marker_without_payload" };
  }
  if (marker === 1) {
    try {
      const inflated = inflateSync(Buffer.from(data.subarray(1)), { maxOutputLength: maxOutputBytes });
      return inflated.length > 0
        ? { ok: true, text: inflated.toString("utf8"), outputBytes: inflated.length }
        : { ok: false, reason: "empty_output" };
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      return {
        ok: false,
        reason: code === "ERR_BUFFER_TOO_LARGE"
          ? "output_limit_exceeded"
          : code ? `inflate_failed:${code}` : "inflate_failed",
      };
    }
  }
  if (marker === 0) {
    if (data.length - 1 > maxOutputBytes) return { ok: false, reason: "output_limit_exceeded" };
    return {
      ok: true,
      text: Buffer.from(data.subarray(1)).toString("utf8"),
      outputBytes: data.length - 1,
    };
  }
  if (data.length > maxOutputBytes) return { ok: false, reason: "output_limit_exceeded" };
  return { ok: true, text: Buffer.from(data).toString("utf8"), outputBytes: data.length };
}

function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

interface CardData {
  ok: boolean;
  reason?: string;
  text?: string;
  budgetBytes?: number;
}

/** reference L134949 `decodeCardData`. */
function decodeCardData(data: Uint8Array, remainingOutputBytes: number): CardData {
  if (remainingOutputBytes <= 0) {
    return { ok: false, reason: "message_output_budget_exceeded", budgetBytes: 0 };
  }
  const limit = Math.min(MAX_RICH_CARD_OUTPUT_BYTES, remainingOutputBytes);
  const decoded = decompressData(data, limit);
  if (!decoded.ok && decoded.reason === "output_limit_exceeded" && limit < MAX_RICH_CARD_OUTPUT_BYTES) {
    return { ok: false, reason: "message_output_budget_exceeded", budgetBytes: limit };
  }
  if (!decoded.ok || decoded.text === undefined) {
    const reason = decoded.reason ?? "inflate_failed";
    return {
      ok: false,
      reason,
      budgetBytes: reason === "output_limit_exceeded" ? limit : 0,
    };
  }
  return { ok: true, text: decoded.text, budgetBytes: decoded.outputBytes ?? 0 };
}

/** reference L122321 `decodeAttribute`. */
function decodeAttribute(value: string): string | undefined {
  let valid = true;
  const decoded = value
    .replace(/\r\n|[\t\r\n]/g, " ")
    .replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);|&/g, (_match, entity?: string) => {
      const named = entity === undefined ? undefined : ENTITIES.get(entity);
      if (named !== undefined) return named;
      if (entity?.startsWith("#")) {
        const code = entity.startsWith("#x")
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
        if (
          code === 9 || code === 10 || code === 13 ||
          (code >= 32 && code <= 55295) ||
          (code >= 57344 && code <= 65533) ||
          (code >= 65536 && code <= 1114111)
        ) return String.fromCodePoint(code);
      }
      valid = false;
      return "";
    });
  return valid ? decoded : undefined;
}

const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", "\""], ["apos", "'"],
]);

const NAME_START =
  ":A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF" +
  "\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD" +
  "\\u{10000}-\\u{EFFFF}";
const ATTRIBUTE = new RegExp(
  `([${NAME_START}][\\u0300-\\u036F${NAME_START}\\-.0-9\\u00B7\\u203F-\\u2040]*)[\\t\\r\\n ]*=` +
  `[\\t\\r\\n ]*(?:"([^"<]*)"|'([^'<]*)')`,
  "uy",
);
const SPACE = /[\t\r\n ]*/y;

/**
 * reference L122327 `readXmlMsgAttributes` — the first element's attributes only.
 *
 * Deliberately hand-rolled instead of using `DOMParser`: the reference refuses to
 * search into comments, attribute values or descendants, and `action="viewMultiMsg"`
 * must not be matched from a nested card.
 */
function readXmlMsgAttributes(content: string): Map<string, string> | undefined {
  let cursor = content.startsWith("\uFEFF") ? 1 : 0;
  for (;;) {
    SPACE.lastIndex = cursor;
    SPACE.exec(content);
    cursor = SPACE.lastIndex;
    const closing = content.startsWith("<!--", cursor)
      ? "-->"
      : content.startsWith("<?", cursor) ? "?>" : undefined;
    if (!closing) break;
    const end = content.indexOf(closing, cursor + (closing === "-->" ? 4 : 2));
    if (end < 0) return undefined;
    cursor = end + closing.length;
  }
  if (!content.startsWith("<msg", cursor)) return undefined;
  cursor += 4;
  const attributes = new Map<string, string>();
  for (;;) {
    const beforeSpace = cursor;
    SPACE.lastIndex = cursor;
    SPACE.exec(content);
    cursor = SPACE.lastIndex;
    if (content[cursor] === ">" || content.startsWith("/>", cursor)) return attributes;
    if (cursor === beforeSpace) return undefined;
    ATTRIBUTE.lastIndex = cursor;
    const match = ATTRIBUTE.exec(content);
    if (!match || attributes.has(match[1]!)) return undefined;
    const value = decodeAttribute(match[2] ?? match[3] ?? "");
    if (value === undefined) return undefined;
    attributes.set(match[1]!, value);
    cursor = ATTRIBUTE.lastIndex;
  }
}

/** reference L122994 `MULTI_MSG_FILE_NAME_PATTERN` / `isXmlCardContent`. */
const MULTI_MSG_FILE_NAME_PATTERN =
  /^MultiMsg_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isXmlCardContent(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">");
}

/** reference L134976 `decodeRichMsgCard`. */
function decodeRichMsgCard(elem: Elem, remainingOutputBytes: number): CardResult | undefined {
  const rm = elem.richMsg;
  const data = rm?.template1;
  if (!data || data.length === 0) return undefined;
  const decoded = decodeCardData(data, remainingOutputBytes);
  if (!decoded.ok || decoded.text === undefined) {
    return invalidCard(data.length, decoded.reason ?? "unknown", decoded.budgetBytes ?? 0);
  }
  const content = decoded.text;
  const svcId = rm?.serviceId ?? 0;
  if (svcId !== 1 && !isXmlCardContent(content)) {
    return invalidCard(data.length, "invalid_xml", decoded.budgetBytes ?? 0);
  }
  const rootAttributes = svcId === 0 || svcId === 35 ? readXmlMsgAttributes(content) : undefined;
  if (svcId === 35 || (svcId === 0 && rootAttributes?.get("serviceID") === "35")) {
    const resId = rootAttributes?.get("m_resid");
    const fileName = rootAttributes?.get("m_fileName") || undefined;
    const forwardId =
      resId ||
      (rootAttributes?.get("action") === "viewMultiMsg" &&
      fileName && MULTI_MSG_FILE_NAME_PATTERN.test(fileName)
        ? fileName
        : undefined);
    const element: ForwardSegment | XmlSegment = forwardId
      ? { type: "forward", resId: forwardId, ...(fileName ? { forwardUuid: fileName } : {}) }
      : { type: "xml", text: content, subType: svcId };
    return {
      element, error: null, inputBytes: data.length, budgetBytes: decoded.budgetBytes ?? 0,
    };
  }
  if (svcId === 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return invalidCard(data.length, "invalid_json", decoded.budgetBytes ?? 0);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return invalidCard(data.length, "invalid_json_object", decoded.budgetBytes ?? 0);
    }
    return {
      element: { type: "json", text: content },
      error: null, inputBytes: data.length, budgetBytes: decoded.budgetBytes ?? 0,
    };
  }
  return {
    element: { type: "xml", text: content, subType: svcId },
    error: null, inputBytes: data.length, budgetBytes: decoded.budgetBytes ?? 0,
  };
}

/** reference L135033 `decodeLightAppCard`. */
function decodeLightAppCard(elem: Elem, remainingOutputBytes: number): CardResult | undefined {
  const data = elem.lightApp?.data;
  if (!data || data.length === 0) return undefined;
  const decoded = decodeCardData(data, remainingOutputBytes);
  if (!decoded.ok || decoded.text === undefined) {
    return invalidCard(data.length, decoded.reason ?? "unknown", decoded.budgetBytes ?? 0);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.text);
  } catch {
    return invalidCard(data.length, "invalid_json", decoded.budgetBytes ?? 0);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return invalidCard(data.length, "invalid_json_object", decoded.budgetBytes ?? 0);
  }
  const card = parsed as {
    app?: string;
    meta?: { detail?: { resid?: unknown; uniseq?: unknown } };
  };
  if (card.app === "com.tencent.multimsg") {
    const detail = card.meta?.detail ?? {};
    const resId = typeof detail.resid === "string" ? detail.resid : "";
    const uniseq = typeof detail.uniseq === "string" ? detail.uniseq : "";
    if (resId) {
      return {
        element: { type: "forward", resId, ...(uniseq ? { forwardUuid: uniseq } : {}) },
        error: null, inputBytes: data.length, budgetBytes: decoded.budgetBytes ?? 0,
      };
    }
  }
  return {
    element: { type: "json", text: decoded.text },
    error: null, inputBytes: data.length, budgetBytes: decoded.budgetBytes ?? 0,
  };
}

// ===========================================================================
// Elem -> MessageSegment conversion (reference L135276 `convertElements`)
// ===========================================================================
//
// This is the piece the OneBot layer actually reads. The rules below are policy,
// not protocol, so they are spelled out rather than buried:
//
//   * `srcMsg` becomes a `reply` segment, decoded recursively so a reply's own
//     elements are real segments (a nested image is an image, not bytes).
//   * A `text` elem becomes `at` when it has a usable `attr6Buf` OR a mention
//     payload of type 1/2; otherwise `text`.
//   * A plain text elem is *suppressed* when the message also carries rich
//     content (a card, markdown, or flash transfer), because QQ duplicates the
//     card's title as a text elem and both would render.
//   * The blank text that follows an "at with zero uin" is dropped: QQ emits a
//     separator space there that would otherwise appear as a leading blank.
//   * An old-client big-face compatibility text is dropped in favour of the real
//     face, matched byte-exactly (see `isBigFaceCompatibilityText`).
//   * A legacy image is dropped when an NT copy of the same file is present.

interface DecodedCards { rich?: CardResult; light?: CardResult; }

/** The `NotOnlineImage` members the converter reads (reference L124953). */
interface NotOnlineImageLike {
  filePath?: string | null;
  fileLen?: number | null;
  picMd5?: Uint8Array | null;
  picHeight?: number | null;
  picWidth?: number | null;
  origUrl?: string | null;
  bigUrl?: string | null;
  pbRes?: { subType?: number | null; summary?: string | null } | null;
}

/** The `CustomFace` members the converter reads (reference L125735). */
interface CustomFaceLike {
  filePath?: string | null;
  size?: number | null;
  md5?: Uint8Array | null;
  height?: number | null;
  width?: number | null;
  origUrl?: string | null;
  pbRes?: { subType?: number | null; summary?: string | null } | null;
}

/** `MentionExtra` as used by the converter (reference L133767). */
interface MentionLike {
  type?: number | null;
  uin?: number | null;
  uid?: string | null;
}

/** The subset of `MsgInfo` the converter reads (reference L134383). */
interface MsgInfoLike {
  msgInfoBody?: Array<{
    index?: {
      fileUuid?: string | null;
      info?: NodeFileInfo | null;
    } | null;
    picture?: {
      domain?: string | null;
      urlPath?: string | null;
      ext?: { originalParameter?: string | null } | null;
    } | null;
  }>;
  extBizInfo?: {
    pic?: { bizType?: number | null; textSummary?: string | null } | null;
  } | null;
}

const MARKDOWN_BUSINESS_TYPES: ReadonlySet<number> = new Set([1, 3, 4]);
const INLINE_KEYBOARD_SERVICE_TYPES: ReadonlySet<number> = new Set([46, 50, 51]);

/** reference L135161 `decodeCardsOnce`. */
function decodeCardsOnce(elems: Elem[]): Map<Elem, DecodedCards> {
  const decoded = new Map<Elem, DecodedCards>();
  let remainingOutputBytes = MAX_RICH_CARD_MESSAGE_OUTPUT_BYTES;
  for (const elem of elems) {
    const cards: DecodedCards = {};
    const rich = decodeRichMsgCard(elem, remainingOutputBytes);
    if (rich) remainingOutputBytes = Math.max(0, remainingOutputBytes - rich.budgetBytes);
    const light = decodeLightAppCard(elem, remainingOutputBytes);
    if (light) remainingOutputBytes = Math.max(0, remainingOutputBytes - light.budgetBytes);
    if (rich) cards.rich = rich;
    if (light) cards.light = light;
    if (!rich && !light) continue;
    decoded.set(elem, cards);
    for (const [source, card] of Object.entries(cards)) {
      if (card?.error) {
        unknownElementLog.debug(
          "wire %s card ignored inputBytes=%d reason=%s", source, card.inputBytes, card.error,
        );
      }
    }
  }
  return decoded;
}

/** reference L135075 `decodeBigFacesOnce`. */
function decodeBigFacesOnce(elems: Elem[]): Map<Elem, { qsid?: number | null; text?: string | null; resultId?: string | null }> {
  const decoded = new Map<Elem, { qsid?: number | null; text?: string | null; resultId?: string | null }>();
  for (const elem of elems) {
    const ce = elem.commonElem;
    if (ce?.serviceType !== 37 || !ce.pbElem) continue;
    const payload = decodeProtobufPayload("commonElem.bigFace", ce.pbElem, () => decodeQFaceExtra(ce.pbElem!));
    decoded.set(elem, payload ?? {});
  }
  return decoded;
}

/** reference L135116 `decodeMarkdownElementsOnce`. */
function decodeMarkdownElementsOnce(elems: Elem[]): Map<Elem, MessageSegment | null> {
  const decoded = new Map<Elem, MessageSegment | null>();
  for (const elem of elems) {
    const ce = elem.commonElem;
    const businessType = ce?.businessType ?? 0;
    if (ce?.serviceType !== 45 || !MARKDOWN_BUSINESS_TYPES.has(businessType) || !ce.pbElem?.length) continue;
    decoded.set(elem, decodeMarkdownCommonElement(ce.pbElem, businessType));
  }
  return decoded;
}

/** reference L135101 `decodeMarkdownCommonElement`. */
function decodeMarkdownCommonElement(pbElem: Uint8Array, businessType: number): MessageSegment | null {
  const md = decodeProtobufPayload("commonElem.markdown", pbElem, () => decodeMarkdownData(pbElem)) as
    | { content?: string | null; summary?: string | null; extType?: number | null;
        extInfo?: { filesetId?: string | null; name?: string | null } | null }
    | undefined;
  const content = md?.content ?? "";
  // Flash-transfer markdown is *not* rendered as markdown: it carries a file
  // reference that the client must offer as a file card instead.
  if (md && businessType === 3 && isFlashTransferMarkdown(md, content)) {
    return decodeFlashTransfer(md);
  }
  if (!content) return null;
  return { type: "markdown", text: content };
}

/** reference L135674 `isFlashTransferMarkdown`. */
function isFlashTransferMarkdown(
  md: { extType?: number | null; extInfo?: { filesetId?: string | null } | null },
  content: string,
): boolean {
  if (md?.extType === 1 && md.extInfo?.filesetId) return true;
  return content.includes("FlashTransfer") || content.includes("flash_transfer");
}

/** reference L135676 `parseQueryValue`. */
function parseQueryValue(text: string, key: string): string {
  const m = text.match(new RegExp(`[?&]${key}=([^&\\s"']+)`));
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]!).trim();
  } catch {
    return m[1]!.trim();
  }
}

/** reference L135682 `deepFindValue`. */
function deepFindValue(obj: unknown, keys: string[], depth = 0): unknown {
  if (depth > 8 || obj === null || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, unknown>;
  for (const key of keys) {
    const v = rec[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  for (const v of Object.values(rec)) {
    const found = deepFindValue(v, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** reference L135706 `parseFlashTransferCard`. */
interface FlashCard { filesetId: string; fileName: string; sceneType?: number }

function parseFlashTransferCard(content: string): FlashCard | null {
  const m = content.match(/[?&]json=([^)\s]+)/);
  let obj: unknown;
  let decodedJson = "";
  if (m) {
    try {
      decodedJson = decodeURIComponent(m[1]!);
    } catch {
      decodedJson = m[1]!;
    }
    try {
      obj = JSON.parse(decodedJson);
    } catch {
      obj = undefined;
    }
  }
  const fromKeys = obj
    ? String(deepFindValue(obj, ["fileSetId", "filesetId", "fileset_id", "file_set_id"]) ?? "").trim()
    : "";
  const fromScheme = obj ? collectSchemeFields(obj) : { filesetId: "" };
  const fromRaw = {
    filesetId: parseQueryValue(decodedJson, "fileset_id"),
    sceneType: Number(parseQueryValue(decodedJson, "scene_type")),
  };
  const filesetId = fromKeys || fromScheme.filesetId || fromRaw.filesetId;
  if (
    !filesetId && obj &&
    deepFindValue(obj, ["busId"]) !== "FlashTransfer" &&
    !content.includes("flash_transfer")
  ) return null;
  // Flash transfer is skeletoned in this port; only the identity is decoded, so a
  // caller can at least tell that a file was sent.
  const card: FlashCard = { filesetId, fileName: "" };
  if (fromScheme.sceneType != null) card.sceneType = fromScheme.sceneType;
  return card;
}

/** reference L135693 `collectSchemeFields`. */
function collectSchemeFields(obj: unknown): { filesetId: string; sceneType?: number } {
  const schemes: string[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > 8 || value == null) return;
    if (typeof value === "string") {
      if (value.includes("fileset_id=") || value.includes("open_fileset")) schemes.push(value);
      return;
    }
    if (typeof value === "object") for (const child of Object.values(value)) walk(child, depth + 1);
  };
  walk(obj, 0);
  for (const scheme of schemes) {
    const filesetId = parseQueryValue(scheme, "fileset_id");
    if (!filesetId) continue;
    const rawScene = parseQueryValue(scheme, "scene_type");
    const n = Number(rawScene);
    if (rawScene && Number.isSafeInteger(n) && n >= 0) return { filesetId, sceneType: n };
    return { filesetId };
  }
  return { filesetId: "" };
}

/** reference L135741 `decodeFlashTransfer` — skeletoned to identity only. */
function decodeFlashTransfer(md: {
  content?: string | null;
  summary?: string | null;
  extType?: number | null;
  extInfo?: { filesetId?: string | null; name?: string | null } | null;
}): FlashFileSegment | null {
  const ext = md.extType === 1 ? md.extInfo : undefined;
  const card = parseFlashTransferCard(md.content ?? "");
  const filesetId = (ext?.filesetId ?? card?.filesetId ?? "").trim();
  if (!filesetId) return null;
  let fileName = (ext?.name ?? "").trim();
  if (!fileName) fileName = (card?.fileName ?? "").trim();
  if (!fileName && md.summary) fileName = md.summary.replace(/^\[QQ闪传\]\s*/, "").trim();
  return { type: "flash_file", filesetId, fileName, sceneType: card?.sceneType ?? 0 };
}

/**
 * reference L135192 `decodeProtobufPayload`: decode defensively and log instead
 * of throwing. A malformed sub-message must degrade to "no segment", otherwise
 * one corrupt card loses the whole message.
 */
function decodeProtobufPayload<T>(
  source: string,
  data: Uint8Array,
  decode: () => T,
): T | undefined {
  if (!data || data.length === 0) return undefined;
  try {
    return decode();
  } catch (error) {
    unknownElementLog.debug("wire %s ignored reason=%s", source, String(error));
    return undefined;
  }
}

/** reference L135276 `convertElements`. */
export function convertElements(
  elems: Elem[],
  isGroup: boolean,
  identity: Identity = EMPTY_IDENTITY,
): MessageSegment[] {
  const result: MessageSegment[] = [];
  const decodedCards = decodeCardsOnce(elems);
  const decodedBigFaces = decodeBigFacesOnce(elems);
  const decodedMarkdown = decodeMarkdownElementsOnce(elems);

  // Plain text is suppressed only when some *other* elem renders the same
  // content richly. Computed once, before the loop, because the decision must
  // not depend on element order.
  const hasRichContent =
    [...decodedCards.values()].some((cards) => Boolean(cards.rich?.element || cards.light?.element)) ||
    [...decodedMarkdown.values()].some(
      (element) => element?.type === "markdown" || element?.type === "flash_file",
    );

  let previousBigFace: { qsid?: number | null; text?: string | null; resultId?: string | null } | null = null;
  let sawReply = false;
  let dropNextBlankText = false;

  for (const elem of elems) {
    const resultCountBeforeElement = result.length;
    const precedingBigFace = previousBigFace;
    const decodedBigFace = decodedBigFaces.get(elem);
    previousBigFace = isValidBigFace(decodedBigFace ?? null) ? decodedBigFace! : null;

    const unsupportedFields = Object.entries(elem)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key]) => key)
      .filter((key) => !DECODED_WIRE_FIELDS.has(key));
    if (unsupportedFields.length > 0) {
      unknownElementLog.debug(
        "wire element ignored fields=%s reason=no MessageElement decoder", unsupportedFields.join(","),
      );
    }

    if (elem.srcMsg) {
      const src = elem.srcMsg;
      const replySeq = src.origSeqs?.[0] ?? 0;
      if (replySeq > 0) {
        const reply: ReplySegment = { type: "reply", replySeq };
        if (src.senderUin) reply.replySenderUin = Number(src.senderUin);
        if (src.time) reply.replyTime = src.time;
        if (src.elemsRaw?.length) {
          const decoded: Elem[] = [];
          for (const [index, raw] of src.elemsRaw.entries()) {
            const nested = decodeProtobufPayload(`srcMsg.elemsRaw[${index}]`, raw, () => decodeElem(raw));
            if (nested) decoded.push(nested as Elem);
          }
          if (decoded.length) reply.replyElements = convertElements(decoded, isGroup, identity);
        }
        // A reply to a *file* message carries the file name only in the source
        // message body, not in elemsRaw -- recover it or the reply looks empty.
        if (src.sourceMsg?.length && !reply.replyElements?.some((e) => e.type === "file")) {
          const nof = decodeProtobufPayload("srcMsg.sourceMsg", src.sourceMsg, () => {
            const body = decodeRichBodyFromBytes(src.sourceMsg!);
            return body?.notOnlineFile;
          });
          if (nof?.fileName) {
            const segs = reply.replyElements ?? (reply.replyElements = []);
            segs.push({
              type: "file",
              fileName: nof.fileName,
              fileSize: nof.fileSize !== undefined && nof.fileSize !== null ? Number(nof.fileSize) : 0,
              fileId: nof.fileUuid ?? "",
            });
          }
        }
        result.push(reply);
      }
      sawReply = true;
    }

    if (elem.text) {
      const t = elem.text;
      if (!(precedingBigFace ? isBigFaceCompatibilityText(precedingBigFace, t) : false)) {
        let mention: MentionLike | null = null;
        if (t.pbReserve && t.pbReserve.length > 0) {
          mention = (decodeProtobufPayload(
            "text.pbReserve", t.pbReserve, () => decodeMentionExtra(t.pbReserve!),
          ) ?? null) as MentionLike | null;
        }
        const hasAttr6 = Boolean(t.attr6Buf && t.attr6Buf.length > 11);
        const hasMention = Boolean(mention && (mention.type === 1 || mention.type === 2));
        // "@ someone" with no resolvable target: QQ emits this before a reply,
        // and the following blank text is only a separator.
        if (sawReply && mention && mention.type === 2 && (mention.uin ?? 0) === 0) {
          dropNextBlankText = true;
          continue;
        }
        if (dropNextBlankText) {
          dropNextBlankText = false;
          if (!hasMention && (t.str ?? "").trim() === "") continue;
        }
        if (hasAttr6 || hasMention) {
          const me: AtSegment = { type: "at", targetUin: 0, text: t.str ?? "" };
          if (hasAttr6) {
            // The target uin sits at bytes 7..10, **big-endian**, and the buffer
            // always has a leading 2-byte tag + length: hence the >11 length gate.
            const buf = t.attr6Buf!;
            me.targetUin = ((buf[7]! << 24) | (buf[8]! << 16) | (buf[9]! << 8) | buf[10]!) >>> 0;
          }
          if (hasMention && mention) {
            if (mention.uid) me.uid = mention.uid;
            if (!me.targetUin) me.targetUin = mention.uin ?? 0;
          }
          result.push(me);
        } else {
          const text = t.str ?? "";
          if (text && hasRichContent) continue;
          if (text) result.push({ type: "text", text });
        }
      }
    }

    if (elem.face) {
      const faceId = elem.face.index ?? 0;
      if (Number.isSafeInteger(faceId) && faceId >= 0) result.push({ type: "face", faceId });
    }

    if (elem.marketFace) {
      const mf = elem.marketFace;
      // A market face is only a sticker when its id is a 16-byte key; anything
      // else is a malformed elem and renders as nothing.
      if (mf.faceId?.length === 16) {
        result.push({
          type: "mface",
          text: mf.faceName ?? "",
          emojiId: toHex(mf.faceId),
          emojiPackageId: mf.tabId ?? 0,
          emojiKey: mf.key ?? "",
        });
      }
    }

    if (elem.notOnlineImage) {
      const img = elem.notOnlineImage as NotOnlineImageLike;
      if (img.picMd5?.length === 16) {
        const md5Hex = toHexUpper(img.picMd5);
        const urlPath = img.origUrl || img.bigUrl || "";
        const seg: ImageSegment = {
          type: "image",
          imageUrl: makeImageUrl(urlPath) || (!urlPath ? imageUrlFromMd5(md5Hex) : ""),
          fileId: img.filePath || md5Hex,
          fileSize: img.fileLen ?? 0,
          width: img.picWidth ?? 0,
          height: img.picHeight ?? 0,
          subType: img.pbRes?.subType ?? 0,
          summary: img.pbRes?.summary || (img.pbRes?.subType === 1 ? "[动画表情]" : "[图片]"),
          md5Hex,
        };
        result.push(seg);
      }
    }

    if (elem.customFace) {
      const img = elem.customFace as CustomFaceLike;
      if (img.md5?.length === 16) {
        const md5Hex = toHexUpper(img.md5);
        const origUrl = img.origUrl ?? "";
        result.push({
          type: "image",
          imageUrl: makeImageUrl(origUrl) || (!origUrl ? imageUrlFromMd5(md5Hex) : ""),
          fileId: img.filePath || md5Hex,
          fileSize: img.size ?? 0,
          width: img.width ?? 0,
          height: img.height ?? 0,
          subType: img.pbRes?.subType ?? 0,
          summary: img.pbRes?.summary || (img.pbRes?.subType === 1 ? "[动画表情]" : "[图片]"),
          md5Hex,
        });
      }
    }

    if (elem.videoFile) {
      const v = elem.videoFile;
      const fileHash = v.fileMd5 && v.fileMd5.length > 0 ? toHexUpper(v.fileMd5) : "";
      const seg: VideoSegment = {
        type: "video",
        fileId: v.fileUuid ?? "",
        fileName: v.fileName ?? "",
        fileSize: v.fileSize ?? 0,
        duration: v.fileTime ?? 0,
        fileHash,
        mediaNode: {
          fileUuid: v.fileUuid ?? "",
          info: {
            fileSize: v.fileSize ?? 0,
            fileHash,
            fileName: v.fileName ?? "",
            width: v.fileWidth ?? 0,
            height: v.fileHeight ?? 0,
            time: v.fileTime ?? 0,
            // `type: 2` marks this as a video for the re-upload endpoint.
            type: { type: 2, videoFormat: v.fileFormat ?? 0 },
          },
        },
      };
      result.push(seg);
    }

    if (elem.groupFile) {
      const f = elem.groupFile;
      result.push({
        type: "file",
        fileId: f.fileId ?? "",
        fileName: f.filename ?? "",
        fileSize: f.fileSize !== undefined && f.fileSize !== null ? Number(f.fileSize) : 0,
      });
    }

    if (elem.transElem) {
      const te = elem.transElem;
      const resultCountBeforeTrans = result.length;
      if ((te.elemType ?? 0) === 24 && te.elemValue && te.elemValue.length > 3) {
        const val = te.elemValue;
        // The 2-byte length after the elemType byte is **big-endian**.
        const len = (val[1]! << 8) | val[2]!;
        if (val.length >= 3 + len) {
          const payload = val.subarray(3, 3 + len);
          const extra = decodeProtobufPayload("transElem.groupFile", payload, () => decodeGroupFileExtra(payload)) as
            | { inner?: { info?: { fileName?: string | null; fileSize?: bigint | null; fileId?: string | null } | null } | null }
            | undefined;
          const info = extra?.inner?.info;
          if (info) {
            result.push({
              type: "file",
              fileName: info.fileName ?? "",
              fileSize: info.fileSize !== undefined && info.fileSize !== null ? Number(info.fileSize) : 0,
              fileId: info.fileId ?? "",
            });
          }
        }
      }
      if (result.length === resultCountBeforeTrans) {
        unknownElementLog.debug(
          "wire transElem ignored elemType=%d reason=no recognized MessageElement payload", te.elemType ?? 0,
        );
      }
    }

    const cards = decodedCards.get(elem);
    if (cards?.rich?.element) result.push(cards.rich.element);
    if (cards?.light?.element) result.push(cards.light.element);

    if (elem.commonElem) {
      const ce = elem.commonElem;
      const svcType = ce.serviceType ?? 0;
      const bizType = ce.businessType ?? 0;
      const resultCountBeforeCommon = result.length;

      if (svcType === 2) {
        result.push({ type: "poke", subType: bizType });
      } else if (svcType === 3 && ce.pbElem && ce.pbElem.length > 1) {
        const pb = ce.pbElem;
        // The payload is a varint length followed by a `NotOnlineImage`. Both the
        // varint and the length must be honoured or the image silently vanishes.
        let pos = 1;
        let length = 0, shift = 0;
        while (pos < pb.length) {
          const b = pb[pos++]!;
          length |= (b & 127) << shift;
          shift += 7;
          if ((b & 128) === 0) break;
        }
        if (pos + length <= pb.length) {
          const payload = pb.subarray(pos, pos + length);
          const img = decodeProtobufPayload("commonElem.flashImage", payload, () => decodeNotOnlineImage(payload)) as
            | NotOnlineImageLike | undefined;
          if (img) {
            const me: ImageSegment = {
              type: "image",
              fileId: img.filePath ?? "",
              fileSize: img.fileLen ?? 0,
              width: img.picWidth ?? 0,
              height: img.picHeight ?? 0,
              imageUrl: "",
              flash: true,
              summary: "[flash image]",
            };
            if (img.pbRes) me.subType = img.pbRes.subType ?? 0;
            if (img.picMd5 && img.picMd5.length > 0) {
              me.imageUrl = `http://gchat.qpic.cn/gchatpic_new/0/0-0-${toHexUpper(img.picMd5)}/0`;
            }
            result.push(me);
          }
        }
      } else if (
        ce.pbElem &&
        (svcType === 48 || bizType === 10 || bizType === 20 || bizType === 11 ||
          bizType === 21 || bizType === 12 || bizType === 22)
      ) {
        const info = decodeProtobufPayload("commonElem.msgInfo", ce.pbElem, () => decodeMsgInfo(ce.pbElem!)) as
          MsgInfoLike | undefined;
        const body = info?.msgInfoBody?.[0];
        const idx = body?.index;
        if (idx?.info) {
          const fi = idx.info;
          if (bizType === 10 || bizType === 20) {
            let url = "";
            if (body?.picture) {
              const domain = body.picture.domain ?? "multimedia.nt.qq.com.cn";
              const path = body.picture.urlPath ?? "";
              if (path) {
                url = `https://${domain}${path}`;
                if (body.picture.ext?.originalParameter) url += body.picture.ext.originalParameter;
              }
            }
            let fileId = fi.fileName || idx.fileUuid || "";
            if (!url && idx.fileUuid) url = ntImageUrlFromFileId(idx.fileUuid, isGroup);
            const me: ImageSegment = {
              type: "image",
              fileId,
              fileSize: fi.fileSize ?? 0,
              width: fi.width ?? 0,
              height: fi.height ?? 0,
              imageUrl: url,
            };
            assignValidFingerprints(me, fi.fileHash, fi.fileSha1, "commonElem image");
            // The NT image often has *only* a fingerprint, in which case the file
            // name and URL have to be synthesised from it.
            if (!fileId && me.md5Hex) fileId = `${me.md5Hex.toLowerCase()}.png`;
            if (!url && me.md5Hex) url = imageUrlFromMd5(me.md5Hex);
            me.fileId = fileId;
            me.imageUrl = url;
            if (fi.type?.picFormat) me.picFormat = fi.type.picFormat;
            if (info?.extBizInfo?.pic) {
              me.subType = info.extBizInfo.pic.bizType ?? 0;
              me.summary = info.extBizInfo.pic.textSummary ||
                (me.subType === 1 ? "[动画表情]" : "[图片]");
            }
            if (hasUsableImageIdentity(me)) result.push(me);
          } else if (bizType === 12 || bizType === 22) {
            const record: RecordSegment = {
              type: "record",
              fileName: fi.fileName ?? "",
              fileId: idx.fileUuid ?? "",
              duration: fi.time ?? 0,
              fileHash: fi.fileHash ?? "",
              fileSize: fi.fileSize ?? 0,
              voiceFormat: fi.type?.voiceFormat ?? 0,
              mediaNode: buildMediaNode(idx, fi),
            };
            assignValidFingerprints(record, fi.fileHash, fi.fileSha1, "commonElem record");
            result.push(record);
          } else if (bizType === 11 || bizType === 21) {
            const video: VideoSegment = {
              type: "video",
              fileName: fi.fileName ?? "",
              fileId: idx.fileUuid ?? "",
              fileSize: fi.fileSize ?? 0,
              duration: fi.time ?? 0,
              fileHash: fi.fileHash ?? "",
              width: fi.width ?? 0,
              height: fi.height ?? 0,
              videoFormat: fi.type?.videoFormat ?? 0,
              mediaNode: buildMediaNode(idx, fi),
            };
            assignValidFingerprints(video, fi.fileHash, fi.fileSha1, "commonElem video");
            result.push(video);
          }
        }
      } else if (svcType === 33 && ce.pbElem) {
        const smallFace = decodeProtobufPayload(
          "commonElem.smallFace", ce.pbElem, () => decodeQSmallFaceExtra(ce.pbElem!),
        ) as { faceId?: number | null } | undefined;
        const faceId = smallFace?.faceId ?? 0;
        if (Number.isSafeInteger(faceId) && faceId >= 0) result.push({ type: "face", faceId });
      } else if (svcType === 37 && ce.pbElem) {
        const extra = decodedBigFaces.get(elem);
        if (isValidBigFace(extra ?? null)) {
          const seg: FaceSegment = { type: "face", faceId: extra!.qsid! };
          if (extra!.resultId != null) seg.resultId = extra!.resultId;
          result.push(seg);
        }
      } else if (svcType === 45 && ce.pbElem && ce.pbElem.length > 0) {
        const markdown = decodedMarkdown.get(elem);
        if (markdown) result.push(markdown);
      } else if (INLINE_KEYBOARD_SERVICE_TYPES.has(svcType) && bizType === 1 && ce.pbElem?.length) {
        // Skeletoned: the keyboard renderer is not on the 228-action path.
        unknownElementLog.debug(
          "wire commonElem ignored serviceType=%d reason=inline_keyboard not ported", svcType,
        );
      }
      if (result.length === resultCountBeforeCommon) {
        unknownElementLog.debug(
          "wire commonElem ignored serviceType=%d businessType=%d reason=no recognized MessageElement payload",
          svcType, bizType,
        );
      }
    }

    if (result.length === resultCountBeforeElement) {
      const ignoredKnownFields = Object.entries(elem)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key]) => key)
        .filter((key) =>
          DECODED_WIRE_FIELDS.has(key) && !METADATA_WIRE_FIELDS.has(key) &&
          key !== "transElem" && key !== "commonElem");
      if (ignoredKnownFields.length > 0) {
        unknownElementLog.debug(
          "wire element ignored fields=%s reason=no recognized MessageElement payload",
          ignoredKnownFields.join(","),
        );
      }
    }
  }
  return dropLegacyImageSiblings(result);
}

// ===========================================================================
// Body -> elements (reference L135264 `decodeRichBody`)
// ===========================================================================

/** reference L135251 `hasDecodableContent`. */
export function hasDecodableContent(body: { richText?: RichText | null; msgContent?: Uint8Array | null } | null): boolean {
  const rt = body?.richText;
  if (rt) {
    if (rt.elems && rt.elems.length > 0) return true;
    if (rt.ptt || rt.notOnlineFile) return true;
  }
  return Boolean(body?.msgContent && body.msgContent.length > 0);
}

/** reference L135264 `decodeRichBody`. */
export function decodeRichBody(
  body: { richText?: RichText | null; msgContent?: Uint8Array | null } | null | undefined,
  isGroup: boolean,
  identity: Identity = EMPTY_IDENTITY,
): MessageSegment[] {
  const elements: MessageSegment[] = [];
  if (body?.richText) {
    const rt = body.richText;
    if (rt.elems) elements.push(...convertElements(rt.elems as Elem[], isGroup, identity));
    extractRichtextExtras(rt, elements, isGroup);
  }
  if (body?.msgContent && body.msgContent.length > 0) extractMsgContent(body.msgContent, elements);
  return elements;
}

/** Decode a serialized `PushMsgBody` into just its `richText`, for reply recovery. */
function decodeRichBodyFromBytes(data: Uint8Array): RichText | null {
  try {
    const decoded = decodePushMsgBody(data) as PushMsgBody | undefined;
    return (decoded?.body?.richText as RichText | undefined) ?? null;
  } catch {
    return null;
  }
}

/** reference L135779 `extractRichtextExtras`. */
function extractRichtextExtras(
  rt: RichText,
  elements: MessageSegment[],
  isGroup = false,
): void {
  // An NT voice already arrived as a `record` from `convertElements`; the `ptt`
  // slot then carries the same voice in legacy form, so adding it would double.
  const hasNtv2Record = elements.some((element) => element.type === "record");
  if (rt.ptt && !hasNtv2Record) {
    const p = rt.ptt;
    const md5Hex = p.fileMd5 && p.fileMd5.length > 0 ? toHexUpper(p.fileMd5) : undefined;
    const me: RecordSegment = {
      type: "record",
      fileName: p.fileName ?? "",
      fileSize: p.fileSize ?? 0,
      duration: p.time ?? 0,
      fileHash: md5Hex ?? "",
      voiceFormat: p.format ?? 0,
    };
    assignValidFingerprints(me, md5Hex, undefined, "ptt");
    // Group voices are keyed by `groupFileKey`; C2C voices by a raw uuid whose
    // bytes are the *ASCII* of the id, hence the Buffer->utf8 round trip.
    if (isGroup && (p.fileId ?? 0n) !== 0n) me.fileId = p.groupFileKey ?? "";
    else if (p.fileUuid && p.fileUuid.length > 0) me.fileId = Buffer.from(p.fileUuid).toString("utf8");
    me.mediaNode = {
      fileUuid: me.fileId ?? "",
      info: {
        fileSize: p.fileSize ?? 0,
        fileHash: p.fileMd5 && p.fileMd5.length > 0 ? toHexUpper(p.fileMd5) : "",
        fileName: p.fileName ?? "",
        time: p.time ?? 0,
        // `type: 3` marks this as a voice for the re-upload endpoint.
        type: { type: 3, voiceFormat: p.format ?? 0 },
      },
    };
    elements.push(me);
  }
  if (rt.notOnlineFile && !isOfflineFileReceiptMetadata(rt.notOnlineFile)) {
    const f = rt.notOnlineFile;
    elements.push({
      type: "file",
      fileId: f.fileUuid ?? "",
      fileName: f.fileName ?? "",
      fileSize: f.fileSize !== undefined && f.fileSize !== null ? Number(f.fileSize) : 0,
      fileHash: f.fileHash ?? "",
    });
  }
}

/** reference L135821 `extractMsgContent`. */
function extractMsgContent(msgContent: Uint8Array, elements: MessageSegment[]): void {
  const extra = decodeProtobufPayload("messageBody.msgContent", msgContent, () => decodeFileExtra(msgContent)) as
    | { file?: { fileUuid?: string | null; fileName?: string | null; fileSize?: bigint | null; fileHash?: string | null; downloadFlag?: number | null; fileType?: number | null; subcmd?: number | null } | null }
    | undefined;
  const f = extra?.file;
  if (!f) return;
  if (isOfflineFileReceiptMetadata(f)) return;
  if (!f.fileUuid) return;
  elements.push({
    type: "file",
    fileId: f.fileUuid,
    fileName: f.fileName ?? "",
    fileSize: f.fileSize !== undefined && f.fileSize !== null ? Number(f.fileSize) : 0,
    fileHash: f.fileHash ?? "",
  });
}

/**
 * reference L135841 `isOfflineFileReceiptMetadata`.
 *
 * A download *acknowledgement* looks exactly like a file message. Without this
 * check the client would re-announce every file a user downloads.
 */
function isOfflineFileReceiptMetadata(
  file: { downloadFlag?: number | null; fileType?: number | null; subcmd?: number | null } | null | undefined,
): boolean {
  if (!file) return false;
  return file.downloadFlag === 2 || (file.fileType === 1 && file.subcmd === 2);
}

/** True when this body is an offline-file download receipt, not a new file. */
export function isOfflineFileReceipt(
  body: { richText?: RichText | null; msgContent?: Uint8Array | null } | null | undefined,
): boolean {
  if (isOfflineFileReceiptMetadata(body?.richText?.notOnlineFile)) return true;
  if (!body?.msgContent || body.msgContent.length === 0) return false;
  const extra = decodeProtobufPayload("messageBody.msgContent", body.msgContent, () => decodeFileExtra(body.msgContent!)) as
    | { file?: { downloadFlag?: number | null; fileType?: number | null; subcmd?: number | null } | null }
    | undefined;
  return isOfflineFileReceiptMetadata(extra?.file);
}

// ===========================================================================
// Push context — the common shape every decoder receives
// ===========================================================================

/** `PkgType` (reference L143081). Values are the OlPush command numbers. */
export const PkgType = {
  ForwardFakePrivateMessage: 9,
  GroupAdminChangedNotice: 44,
  GroupMemberIncreaseNotice: 33,
  GroupMemberDecreaseNotice: 34,
  GroupMessage: 82,
  GroupRequestJoinNotice: 84,
  GroupSelfJoinedNotice: 85,
  GroupInviteNotice: 87,
  TempMessage: 141,
  PrivateMessage: 166,
  PrivateRecordMessage: 208,
  GroupRequestInvitationNotice: 525,
  Event0x210: 528,
  PrivateFileMessage: 529,
  Event0x2DC: 732,
} as const;

export type PkgTypeValue = (typeof PkgType)[keyof typeof PkgType];

/** `Event0x2DCSubType` (reference L143122). */
export const Event0x2DCSubType = {
  GroupMuteNotice: 12,
  GroupMsgEmojiLikeNotice: 16,
  GroupRecallNotice: 17,
  GroupGreyTipNotice: 20,
  GroupEssenceNotice: 21,
} as const;

/** `Event0x210SubType` (reference L143133). */
export const Event0x210SubType = {
  FriendRequestNotice: 35,
  GroupAppStatePush: 38,
  ProfileLikeNotice: 39,
  PttTransResult: 61,
  FriendRecallNotice: 138,
  FriendRecallSelfNotice: 139,
  NewFriendNotice: 179,
  NewFriendNoticeAlt: 226,
  InputStatusNotice: 277,
  FriendPokeNotice: 290,
  OnlineDevicesNotice: 349,
  FriendRemarkChangedNotice: 364,
  UnmappedClientState380: 380,
} as const;

export interface ContentHeadInfo {
  msgType: number;
  subType: number;
  c2cCmd: number;
  sequence: number;
  ntMsgSeq: number;
  timestamp: number;
  msgId: number;
}

export interface PushContext {
  head: ContentHeadInfo;
  fromUin: number;
  fromUid: string;
  selfUin: number;
  content: Uint8Array;
  body: PushMsgBody["body"] | undefined;
  responseHead: PushMsgBody["responseHead"] | undefined;
  identity: Identity;
  isHistorical: boolean;
}

/** reference L143047 `buildContextFromMessage`. */
export function buildContextFromMessage(
  msg: PushMsgBody,
  selfUin: number,
  identity: Identity,
  isHistorical = true,
): PushContext | null {
  if (!msg.contentHead) return null;
  const head: ContentHeadInfo = {
    msgType: msg.contentHead.msgType ?? 0,
    subType: msg.contentHead.subType ?? 0,
    c2cCmd: msg.contentHead.c2cCmd ?? 0,
    sequence: msg.contentHead.sequence ?? 0,
    ntMsgSeq: msg.contentHead.ntMsgSeq ?? 0,
    timestamp: msg.contentHead.timestamp ?? 0,
    msgId: msg.contentHead.msgId ?? 0,
  };
  let fromUin = 0;
  let fromUid = "";
  if (msg.responseHead) {
    fromUin = msg.responseHead.fromUin ?? 0;
    fromUid = msg.responseHead.fromUid ?? "";
  }
  return {
    head,
    fromUin,
    fromUid,
    selfUin,
    content: msg.body?.msgContent ?? new Uint8Array(0),
    body: msg.body ?? undefined,
    responseHead: msg.responseHead ?? undefined,
    identity,
    isHistorical,
  };
}

/**
 * reference L143031 `buildContext`: one OlPush packet -> one context.
 *
 * `pkt.uin` is the account the frame arrived on, so a malformed value must not
 * become `NaN` (that would poison every event's `selfUin`); it degrades to 0.
 */
export function buildContext(
  pkt: { uin?: string | null; body: Uint8Array },
  identity: Identity = EMPTY_IDENTITY,
): PushContext | null {
  if (pkt.body.length === 0) return null;
  const push = decodePushMsg(pkt.body) as { message?: PushMsgBody | null } | undefined;
  if (!push?.message) return null;
  let selfUin = 0;
  if (pkt.uin) {
    const n = Number.parseInt(pkt.uin, 10);
    if (!Number.isNaN(n)) selfUin = n;
  }
  return buildContextFromMessage(push.message, selfUin, identity, false);
}

/** reference L122280 `buildTemplateMap`. */
export function buildTemplateMap(
  params: ReadonlyArray<{ name?: string | null; value?: string | null }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of params) if (p.name !== undefined && p.name !== null) map.set(p.name, p.value ?? "");
  return map;
}

/** reference L122285 `findTemplateValue`. */
export function findTemplateValue(map: Map<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = map.get(k);
    if (v) return v;
  }
  return "";
}

/**
 * reference L122292 `unwrapGroupNotifyPayload`.
 *
 * The 0x2DC group-notify payload is wrapped in a 7-byte envelope whose length is
 * at bytes 5..6 — **big-endian**. A little-endian read is also attempted because
 * at least one observed payload was LE; the BE branch is tried first so a payload
 * that satisfies both cannot be truncated by the wrong guess.
 */
export function unwrapGroupNotifyPayload(content: Uint8Array): Uint8Array | null {
  if (content.length <= 7) return null;
  const lenBe = (content[5]! << 8) | content[6]!;
  const lenLe = content[5]! | (content[6]! << 8);
  if (7 + lenBe <= content.length) return content.subarray(7, 7 + lenBe);
  if (7 + lenLe <= content.length) return content.subarray(7, 7 + lenLe);
  return content.subarray(7);
}

// ===========================================================================
// Events
// ===========================================================================
//
// The variant set is exactly the reference's -- including the fields each one
// carries -- because the OneBot layer maps them one-to-one onto notices. Where the
// reference has no OneBot counterpart (a QQ-client UI state push), the decoder
// returns `[]` *silently* and the reason is recorded here rather than in a log, so
// a reader can tell "acknowledged and dropped" from "not implemented".

export interface GroupMessageEvent {
  kind: "group_message";
  time: number;
  selfUin: number;
  senderUin: number;
  msgSeq: number;
  msgId: number;
  elements: MessageSegment[];
  groupId: number;
  groupName: string;
  senderNick: string;
  senderCard: string;
  senderRole: string;
}

export interface FriendMessageEvent {
  kind: "friend_message";
  time: number;
  selfUin: number;
  senderUin: number;
  senderUid: string;
  peerUin?: number;
  msgSeq: number;
  ntMsgSeq: number;
  clientSeq: number;
  sequenceAuthoritative: boolean;
  msgId: number;
  elements: MessageSegment[];
  senderNick: string;
  inviteCardGroupUin?: number;
  inviteCardSequence?: number;
}

export interface TempMessageEvent {
  kind: "temp_message";
  time: number;
  selfUin: number;
  senderUin: number;
  msgSeq: number;
  ntMsgSeq: number;
  clientSeq: number;
  sequenceAuthoritative: boolean;
  elements: MessageSegment[];
  groupId: number;
  senderNick: string;
}

export interface GroupRecallEvent {
  kind: "group_recall";
  time: number;
  selfUin: number;
  groupId: number;
  operatorUin: number;
  authorUin: number;
  msgSeq: number;
}

export interface FriendRecallEvent {
  kind: "friend_recall";
  time: number;
  selfUin: number;
  userUin: number;
  msgSeq: number;
  clientSeq: number;
  recalledBySelf: boolean;
}

export interface GroupAdminChangedEvent {
  kind: "group_admin";
  time: number;
  selfUin: number;
  groupId: number;
  userUin: number;
  set: boolean;
}

export interface GroupMuteEvent {
  kind: "group_mute";
  time: number;
  selfUin: number;
  groupId: number;
  operatorUin: number;
  userUin: number;
  duration: number;
}

export interface FriendRequestEvent {
  kind: "friend_request";
  time: number;
  selfUin: number;
  fromUin: number;
  fromUid: string;
  message: string;
  flag: string;
}

export interface FriendAddEvent {
  kind: "friend_add";
  time: number;
  selfUin: number;
  userUin: number;
}

export interface GroupPokeEvent {
  kind: "group_poke";
  time: number;
  selfUin: number;
  groupId: number;
  userUin: number;
  targetUin: number;
  action: string;
  suffix: string;
  actionImgUrl: string;
}

export interface FriendPokeEvent {
  kind: "friend_poke";
  time: number;
  selfUin: number;
  peerUin: number;
  senderUin: number;
  targetUin: number;
  action: string;
  suffix: string;
  actionImgUrl: string;
}

// ---------------------------------------------------------------------------
// The remaining notice variants
// ---------------------------------------------------------------------------
//
// These 15 kinds complete the reference's `QQEventVariant` union. **No decoder in
// this port produces any of them yet** — `DECODERS` below is the whole dispatch
// table, and it covers 11 kinds. They are declared because the CONVERTER layer
// (`bridge/event-converters.ts`) must switch over the FULL union: a converter
// table that is only exhaustive over "the kinds some decoder happens to emit" would
// silently lack `group_member_join` and answer `null` for every join notice, which
// is exactly the "acknowledged vs not implemented" confusion this file's header
// argues against.
//
// Every field list below is transcribed from the reference's own object literal, at
// the line cited on each interface, so the converter for a kind reads the same
// fields the reference's converter reads. Declaring them is NOT a claim that the
// bytes decode: `DECODERS` is.
//
// Three of the 26 converter entries map to `null` on purpose (`ptt_trans_result`,
// `online_devices_changed`, `friend_remark_changed`), and one — `group_file_upload`
// — has a converter but no producer anywhere in the reference at all. See
// `event-converters.ts`'s header for the dead-code note.

/** reference L149528 `decodeGroupTitle`. */
export interface GroupTitleChangeEvent {
  kind: "group_title_change";
  time: number;
  selfUin: number;
  groupId: number;
  userUin: number;
  title: string;
}

/** reference L149552 `decodeGroupName`. */
export interface GroupNameChangeEvent {
  kind: "group_name_change";
  time: number;
  selfUin: number;
  groupId: number;
  operatorUin: number;
  name: string;
}

/** reference L347079 `emitGroupCardChange` (derived from a `group_message`). */
export interface GroupCardChangeEvent {
  kind: "group_card_change";
  time: number;
  selfUin: number;
  groupId: number;
  userUin: number;
  cardNew: string;
  cardOld: string;
}

/** reference L149494 `decodeGroupEssence`. */
export interface GroupEssenceEvent {
  kind: "group_essence";
  time: number;
  selfUin: number;
  groupId: number;
  senderUin: number;
  operatorUin: number;
  msgSeq: number;
  random: number;
  set: boolean;
}

/** reference L149578 `decodeGroupMsgEmojiLike`. */
export interface GroupMsgEmojiLikeEvent {
  kind: "group_msg_emoji_like";
  time: number;
  selfUin: number;
  groupId: number;
  operatorUin: number;
  operatorUid: string;
  msgSeq: number;
  emojiId: string;
  count: number;
  isAdd: boolean;
}

/** reference L153858 / L153913 `decodeGroupMemberJoin` / `decodeGroupSelfJoined`. */
export interface GroupMemberJoinEvent {
  kind: "group_member_join";
  time: number;
  selfUin: number;
  groupId: number;
  userUin: number;
  operatorUin: number;
  userUid: string;
  operatorUid: string;
  /**
   * Absent on the self-join path (L153913), which is why the converter falls back to
   * the `isSameActor` comparison rather than defaulting to a literal.
   */
  joinType?: "approve" | "invite";
}

/** reference L153895 `decodeGroupMemberLeave`. */
export interface GroupMemberLeaveEvent {
  kind: "group_member_leave";
  time: number;
  selfUin: number;
  groupId: number;
  userUin: number;
  operatorUin: number;
  userUid: string;
  operatorUid: string;
  leaveType: "disband" | "kick" | "leave";
}

/**
 * The group-file upload notice.
 *
 * 🔴 **Dead in the reference.** `convertGroupFileUpload` (L23232) is registered in
 * `CONVERTERS` and read by `formatEvent` (L6344), but NOTHING in
 * `reference/index.mjs` ever constructs a `kind: "group_file_upload"` event — there
 * is no decoder for it. The field list here is therefore read off the CONVERTER, not
 * off a producer, and a live session can never deliver one until a producer is
 * written. Recorded rather than silently "fixed".
 */
export interface GroupFileUploadEvent {
  kind: "group_file_upload";
  time: number;
  selfUin: number;
  groupId: number;
  userUin: number;
  fileId: string;
  fileName: string;
  fileSize: number;
  busId: number;
}

/** reference L153298 / L153314 / L153331 — three producers, one shape. */
export interface GroupInviteEvent {
  kind: "group_invite";
  time: number;
  selfUin: number;
  groupId: number;
  fromUin: number;
  fromUid: string;
  /**
   * Present on the two invitation paths, absent on the join-request path
   * (`decodeGroupJoinRequest`, L153298). The converter omits `invited_id` unless this
   * is a positive number, so `undefined` and `0` produce the same wire output.
   */
  invitedUin?: number;
  invitedUid?: string;
  subType: string;
  message: string;
  flag: string;
}

/** reference L146674 `decodeInputStatus`. */
export interface FriendInputStatusEvent {
  kind: "friend_input_status";
  time: number;
  selfUin: number;
  userUin: number;
  userUid: string;
  eventType: number;
  statusText: string;
}

/** reference L146695 `decodeProfileLike`. */
export interface FriendProfileLikeEvent {
  kind: "friend_profile_like";
  time: number;
  selfUin: number;
  operatorUin: number;
  operatorNick: string;
  times: number;
}

/** reference L346778 `parseKickNT`. */
export interface BotOfflineEvent {
  kind: "bot_offline";
  time: number;
  selfUin: number;
  tag: string;
  message: string;
}

/**
 * reference L146606 `decodeOnlineDevices` — **mapped to `null` by the converter.**
 *
 * A QQ-client presence snapshot, not a conversation event, so OneBot has no notice
 * for it. Declared because the decoder exists; `CONVERTERS` maps it to `null` and the
 * port copies that decision rather than inventing a notice.
 */
export interface OnlineDevicesChangedEvent {
  kind: "online_devices_changed";
  time: number;
  selfUin: number;
  devices: ReadonlyArray<{
    appId: number;
    instanceId: number;
    clientType: number;
    platform: number;
    deviceName: string;
    deviceKind: "computer" | "phone" | "pad" | "unknown";
  }>;
}

/**
 * reference L146619 `decodePttTransResult` — **mapped to `null` by the converter.**
 *
 * `msgId` is a `bigint` on the wire (`item.msgId ?? 0n`) and the decoder rejects a
 * zero id, so this is a real transcription rather than a guess.
 */
export interface PttTransResultEvent {
  kind: "ptt_trans_result";
  time: number;
  selfUin: number;
  msgId: bigint;
  text: string;
}

/**
 * reference L146545 `decodeFriendRemarkChanged` — **mapped to `null` by the converter.**
 *
 * A remark-sync push carries no OneBot notice of its own; the reference's own
 * converter table is `friend_remark_changed: null`.
 */
export interface FriendRemarkChangedEvent {
  kind: "friend_remark_changed";
  time: number;
  selfUin: number;
  userUid: string;
  userUin: number;
  remark: string;
}

export type MsgPushEvent =
  | GroupMessageEvent | FriendMessageEvent | TempMessageEvent
  | GroupRecallEvent | FriendRecallEvent | GroupAdminChangedEvent | GroupMuteEvent
  | FriendRequestEvent | FriendAddEvent | GroupPokeEvent | FriendPokeEvent
  | GroupTitleChangeEvent | GroupNameChangeEvent | GroupCardChangeEvent
  | GroupEssenceEvent | GroupMsgEmojiLikeEvent | GroupMemberJoinEvent
  | GroupMemberLeaveEvent | GroupFileUploadEvent | GroupInviteEvent
  | FriendInputStatusEvent | FriendProfileLikeEvent | BotOfflineEvent
  | OnlineDevicesChangedEvent | PttTransResultEvent | FriendRemarkChangedEvent;

// ---------------------------------------------------------------------------
// Message events
// ---------------------------------------------------------------------------

/** reference L153924 `decodeGroupMessage`. */
export function decodeGroupMessage(ctx: PushContext): MsgPushEvent[] {
  const ev: GroupMessageEvent = {
    kind: "group_message",
    time: ctx.head.timestamp,
    selfUin: ctx.selfUin,
    senderUin: ctx.fromUin,
    msgSeq: ctx.head.sequence,
    // The wire msgId is 32-bit signed; the reference masks the sign bit off so
    // OneBot's `message_id` stays a positive integer.
    msgId: ctx.head.msgId & 2147483647,
    elements: decodeRichBody(ctx.body, true, ctx.identity),
    groupId: 0,
    groupName: "",
    senderNick: "",
    senderCard: "",
    senderRole: "",
  };
  const grp = ctx.responseHead?.grp;
  if (grp) {
    ev.groupId = grp.groupUin ?? 0;
    ev.senderNick = grp.memberName ?? "";
  }
  const member = ctx.identity.findGroupMember(ev.groupId, ctx.fromUin);
  if (member) {
    if (!ev.senderNick) ev.senderNick = member.nickname;
    ev.senderCard = member.card;
    ev.senderRole = member.role;
    // The wire card wins when it differs from the *nickname* -- but only when a
    // member record exists, which is what this branch encodes.
    if (grp?.memberCard && grp.memberCard !== ev.senderNick) ev.senderCard = grp.memberCard;
  } else if (!ev.senderNick && grp?.memberCard) {
    ev.senderNick = grp.memberCard;
  }
  ev.groupName = grp?.groupName || ctx.identity.findGroup(ev.groupId)?.groupName || "";
  return [ev];
}

/** reference L151761 `parseGroupInviteCard`. */
export function parseGroupInviteCard(jsonText: string): { groupUin: number; sequence: number } | null {
  let card: unknown;
  try {
    card = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!card || typeof card !== "object" || !("app" in card)) return null;
  const rec = card as { app?: unknown; meta?: { news?: { jumpUrl?: unknown } } };
  if (rec.app !== "com.tencent.qun.invite" && rec.app !== "com.tencent.tuwen.lua") return null;
  const jumpUrl = rec.meta?.news?.jumpUrl;
  if (typeof jumpUrl !== "string") return null;
  let url: URL;
  try {
    url = new URL(jumpUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "mqqapi:" || url.hostname !== "group" || url.pathname !== "/invite_join") return null;
  const groupUin = Number(url.searchParams.get("groupcode"));
  const sequence = Number(url.searchParams.get("msgseq"));
  if (!Number.isSafeInteger(groupUin) || groupUin <= 0 ||
      !Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error("group invitation card has an invalid approval tuple");
  }
  return { groupUin, sequence };
}

/** reference L151773 `decodeFriendMessage`. */
export function decodeFriendMessage(ctx: PushContext): MsgPushEvent[] {
  const elements = decodeRichBody(ctx.body, false, ctx.identity);
  // A message the bot sent has `fromUin === selfUin`, so the *conversation* peer
  // is on the response head instead. Using `fromUin` there would file the bot's
  // own outgoing message as a conversation with itself.
  const peerUin =
    ctx.fromUin > 0 && ctx.fromUin === ctx.selfUin
      ? ctx.responseHead?.toUin ?? 0
      : ctx.fromUin;

  let inviteCard: { groupUin: number; sequence: number } | null = null;
  for (const el of elements) {
    if (el.type === "json" && typeof el.text === "string") {
      inviteCard = parseGroupInviteCard(el.text);
      if (inviteCard) break;
    }
  }

  const ev: FriendMessageEvent = {
    kind: "friend_message",
    time: ctx.head.timestamp,
    selfUin: ctx.selfUin,
    senderUin: ctx.fromUin,
    senderUid: ctx.fromUid,
    msgSeq: ctx.head.sequence,
    ntMsgSeq: ctx.head.ntMsgSeq,
    clientSeq: ctx.head.sequence,
    // NT carries an authoritative server sequence; the legacy path does not.
    sequenceAuthoritative: ctx.head.ntMsgSeq > 0,
    msgId: ctx.head.msgId & 2147483647,
    elements,
    senderNick: "",
  };
  if (peerUin > 0) ev.peerUin = peerUin;
  if (inviteCard) {
    ev.inviteCardGroupUin = inviteCard.groupUin;
    ev.inviteCardSequence = inviteCard.sequence;
  }
  if (ctx.responseHead?.forward?.friendName) ev.senderNick = ctx.responseHead.forward.friendName;
  const friend = ctx.identity.findFriend(ctx.fromUin);
  if (friend && !ev.senderNick) ev.senderNick = friend.nickname;
  return [ev];
}

/** reference L153956 `decodeTempMessage`. */
export function decodeTempMessage(ctx: PushContext): MsgPushEvent[] {
  const ev: TempMessageEvent = {
    kind: "temp_message",
    time: ctx.head.timestamp,
    selfUin: ctx.selfUin,
    senderUin: ctx.fromUin,
    msgSeq: ctx.head.sequence,
    ntMsgSeq: ctx.head.ntMsgSeq,
    clientSeq: ctx.head.sequence,
    sequenceAuthoritative: ctx.head.ntMsgSeq > 0,
    elements: decodeRichBody(ctx.body, false, ctx.identity),
    groupId: 0,
    senderNick: "",
  };
  if (ctx.responseHead?.grp) {
    ev.groupId = ctx.responseHead.grp.groupUin ?? 0;
    ev.senderNick = ctx.responseHead.grp.memberName ?? "";
  }
  // For a group-temp message the originating group is on the forward hop, and it
  // overrides the `grp` slot when both are present.
  if (ctx.responseHead?.forward?.tempGroupUin) ev.groupId = ctx.responseHead.forward.tempGroupUin;
  if (!ev.senderNick) {
    const friend = ctx.identity.findFriend(ctx.fromUin);
    if (friend) ev.senderNick = friend.nickname;
  }
  return [ev];
}

// ---------------------------------------------------------------------------
// Group notices
// ---------------------------------------------------------------------------

/** reference L152263 `decodeGroupAdminChangedNotice`. */
export function decodeGroupAdminChangedNotice(ctx: PushContext): MsgPushEvent[] {
  const admin = decodeGroupAdmin(ctx.content) as
    | { groupUin?: number | null; body?: {
        extraEnable?: { adminUid?: string | null } | null;
        extraDisable?: { adminUid?: string | null } | null;
      } | null }
    | undefined;
  const enableUid = admin?.body?.extraEnable?.adminUid ?? "";
  const disableUid = admin?.body?.extraDisable?.adminUid ?? "";
  const adminUid = enableUid || disableUid;
  if (!admin || !adminUid) return [];
  const groupId = admin.groupUin ?? 0;
  return [{
    kind: "group_admin",
    time: ctx.head.timestamp,
    selfUin: ctx.selfUin,
    groupId,
    userUin: resolveUidToUin(ctx.identity, groupId, adminUid),
    set: !!enableUid,
  }];
}

/** reference L149446 `decodeGroupMute`. */
export function decodeGroupMuteEvent(ctx: PushContext): MsgPushEvent[] {
  const mute = decodeGroupMute(ctx.content) as
    | { groupUin?: number | null; operatorUid?: string | null; data?: { timestamp?: number | null; state?: { duration?: number | null; targetUid?: string | null } | null } | null }
    | undefined;
  if (!mute?.data?.state) return [];
  const duration = mute.data.state.duration ?? 0;
  return [{
    kind: "group_mute",
    time: mute.data.timestamp ?? ctx.head.timestamp,
    selfUin: ctx.selfUin,
    groupId: mute.groupUin ?? 0,
    operatorUin: resolveUidToUin(ctx.identity, mute.groupUin ?? 0, mute.operatorUid ?? ""),
    userUin: resolveUidToUin(ctx.identity, mute.groupUin ?? 0, mute.data.state.targetUid ?? ""),
    // 4294967295 is QQ's "permanent" sentinel; OneBot uses 2147483647 for the
    // same meaning (the largest duration a 32-bit client can hold).
    duration: duration === 4294967295 ? 2147483647 : duration,
  }];
}

/** reference L149461 `decodeGroupRecall`. */
export function decodeGroupRecall(ctx: PushContext): MsgPushEvent[] {
  const payload = unwrapGroupNotifyPayload(ctx.content);
  if (!payload) return [];
  const notify = decodeNotifyMessageBody(payload) as
    | { groupUin?: number | null; operatorUid?: string | null; recall?: { operatorUid?: string | null; recallMessages?: Array<{ time?: number | null; authorUid?: string | null; sequence?: number | null }> | null } | null }
    | undefined;
  const recalled = notify?.recall?.recallMessages?.[0];
  if (!recalled) return [];
  return [{
    kind: "group_recall",
    time: recalled.time ?? ctx.head.timestamp,
    selfUin: ctx.selfUin,
    groupId: notify?.groupUin ?? 0,
    operatorUin: resolveUidToUin(
      ctx.identity,
      notify?.groupUin ?? 0,
      notify?.recall?.operatorUid || notify?.operatorUid || "",
    ),
    authorUin: resolveUidToUin(ctx.identity, notify?.groupUin ?? 0, recalled.authorUid ?? ""),
    msgSeq: recalled.sequence ?? 0,
  }];
}

/** reference L149479 `decodeGroupGreyTip` — this is where a group poke arrives. */
export function decodeGroupGreyTip(ctx: PushContext): MsgPushEvent[] {
  const payload = unwrapGroupNotifyPayload(ctx.content);
  if (!payload) return [];
  const notify = decodeNotifyMessageBody(payload) as
    | { groupUin?: number | null; generalGrayTip?: { busiType?: bigint | null; msgTemplParam?: Array<{ name?: string | null; value?: string | null }> | null } | null }
    | undefined;
  // busiType 12 is "poke / 戳一戳"; every other grey tip (a join notice, a title
  // change, …) has its own subType and must not be reported as a poke.
  if (!notify?.generalGrayTip || (notify.generalGrayTip.busiType ?? 0n) !== 12n) return [];
  const templates = buildTemplateMap(notify.generalGrayTip.msgTemplParam ?? []);
  return [{
    kind: "group_poke",
    time: ctx.head.timestamp,
    selfUin: ctx.selfUin,
    groupId: notify.groupUin ?? 0,
    userUin: resolveUidToUin(ctx.identity, notify.groupUin ?? 0, findTemplateValue(templates, "uin_str1")),
    targetUin: resolveUidToUin(ctx.identity, notify.groupUin ?? 0, findTemplateValue(templates, "uin_str2")),
    action: findTemplateValue(templates, "action_str", "alt_str1"),
    suffix: findTemplateValue(templates, "suffix_str"),
    actionImgUrl: findTemplateValue(templates, "action_img_url"),
  }];
}

/** reference L149425 `decodeEvent0x2DC`. */
export function decodeEvent0x2DC(ctx: PushContext): MsgPushEvent[] {
  switch (ctx.head.subType) {
    case Event0x2DCSubType.GroupMuteNotice: return decodeGroupMuteEvent(ctx);
    case Event0x2DCSubType.GroupRecallNotice: return decodeGroupRecall(ctx);
    case Event0x2DCSubType.GroupGreyTipNotice: return decodeGroupGreyTip(ctx);
    // Emoji-like (16) and essence (21) are skeletoned: neither is on the
    // 228-action path this port targets.
    case Event0x2DCSubType.GroupMsgEmojiLikeNotice:
    case Event0x2DCSubType.GroupEssenceNotice:
      return [];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Friend / C2C notices (0x210)
// ---------------------------------------------------------------------------

/** reference L146626 `decodeFriendRequest`. */
export function decodeFriendRequestEvent(ctx: PushContext): MsgPushEvent[] {
  const request = decodeFriendRequest(ctx.content) as
    | { info?: { newSource?: string | null; sourceUid?: string | null; message?: string | null } | null }
    | undefined;
  if (!request?.info) return [];
  // `newSource` is the newer field; `sourceUid` still appears in older pushes, and
  // whichever is present is the *whole* flag OneBot must echo back on approval.
  const sourceUid = request.info.newSource || request.info.sourceUid || "";
  return [{
    kind: "friend_request",
    time: ctx.head.timestamp,
    selfUin: ctx.selfUin,
    fromUin: resolveUidToUin(ctx.identity, 0, sourceUid),
    fromUid: sourceUid,
    message: request.info.message ?? "",
    flag: sourceUid,
  }];
}

/** reference L146640 `decodeFriendRecall`. */
export function decodeFriendRecallEvent(ctx: PushContext): MsgPushEvent[] {
  const recall = decodeFriendRecall(ctx.content) as
    | { info?: { fromUid?: string | null; toUid?: string | null; time?: number | null; clientSequence?: number | null } | null }
    | undefined;
  if (!recall?.info) return [];
  // 138 and 139 share one wire shape and differ only in direction: which side of
  // the pair is the peer flips with it.
  const isSelfRecall = ctx.head.subType === Event0x210SubType.FriendRecallSelfNotice;
  const peerUid = (isSelfRecall ? recall.info.toUid : recall.info.fromUid) ?? "";
  return [{
    kind: "friend_recall",
    time: recall.info.time ?? ctx.head.timestamp,
    selfUin: ctx.selfUin,
    userUin: resolveUidToUin(ctx.identity, 0, peerUid),
    msgSeq: recall.info.clientSequence ?? 0,
    clientSeq: recall.info.clientSequence ?? 0,
    recalledBySelf: isSelfRecall,
  }];
}

/** reference L146655 `decodeNewFriend`. */
export function decodeNewFriendEvent(ctx: PushContext): MsgPushEvent[] {
  const nf = decodeNewFriend(ctx.content) as
    | { info?: { uid?: string | null; time?: number | null } | null }
    | undefined;
  if (!nf?.info) return [];
  const newFriendUin = c2cRoutingUin(ctx.identity, nf.info.uid ?? "", ctx.fromUin);
  // Unresolvable is *not* zero-with-a-guess: an event with uin 0 would be routed
  // to nobody, so the reference drops it instead.
  if (newFriendUin <= 0) return [];
  return [{
    kind: "friend_add",
    time: nf.info.time && nf.info.time > 0 ? nf.info.time : ctx.head.timestamp,
    selfUin: ctx.selfUin,
    userUin: newFriendUin,
  }];
}

/** reference L146703 `decodeFriendPoke`. */
export function decodeFriendPokeEvent(ctx: PushContext): MsgPushEvent[] {
  const grayTip = decodeGeneralGrayTipInfo(ctx.content) as
    | { busiType?: bigint | null; msgTemplParam?: Array<{ name?: string | null; value?: string | null }> | null }
    | undefined;
  if (!grayTip || (grayTip.busiType ?? 0n) !== 12n) return [];
  const templates = buildTemplateMap(grayTip.msgTemplParam ?? []);
  const senderUin = resolveUidToUin(ctx.identity, 0, findTemplateValue(templates, "uin_str1"));
  const routeFromUin = c2cRoutingUin(ctx.identity, ctx.fromUid, ctx.fromUin);
  const sentBySelf = routeFromUin > 0 && routeFromUin === ctx.selfUin;
  // Same self-sent trap as `decodeFriendMessage`: the peer is on the head only
  // when the bot is the sender.
  const peerUin = sentBySelf
    ? c2cRoutingUin(ctx.identity, ctx.responseHead?.toUid ?? "", ctx.responseHead?.toUin ?? 0)
    : routeFromUin;
  if (peerUin <= 0) return [];
  return [{
    kind: "friend_poke",
    time: ctx.head.timestamp,
    selfUin: ctx.selfUin,
    peerUin,
    senderUin,
    targetUin: resolveUidToUin(ctx.identity, 0, findTemplateValue(templates, "uin_str2")),
    action: findTemplateValue(templates, "action_str", "alt_str1"),
    suffix: findTemplateValue(templates, "suffix_str"),
    actionImgUrl: findTemplateValue(templates, "action_img_url"),
  }];
}

/** reference L146516 `decodeEvent0x210`. */
export function decodeEvent0x210(ctx: PushContext): MsgPushEvent[] {
  switch (ctx.head.subType) {
    case Event0x210SubType.FriendRequestNotice: return decodeFriendRequestEvent(ctx);
    case Event0x210SubType.FriendRecallNotice:
    case Event0x210SubType.FriendRecallSelfNotice: return decodeFriendRecallEvent(ctx);
    case Event0x210SubType.FriendPokeNotice: return decodeFriendPokeEvent(ctx);
    case Event0x210SubType.NewFriendNotice:
    case Event0x210SubType.NewFriendNoticeAlt: return decodeNewFriendEvent(ctx);
    // Acknowledged and dropped on purpose, exactly like the reference: these are
    // QQ-client UI state pushes (unread badges, in-app tips, unknown NT state),
    // not conversation events, so no OneBot notice exists for them.
    case Event0x210SubType.GroupAppStatePush:
    case Event0x210SubType.UnmappedClientState380:
      return [];
    // Skeletoned: ptt-trans result (61), input status (277), online devices (349),
    // friend remark (364), profile like (39).
    default:
      return [];
  }
}

// ===========================================================================
// Dispatch by package type
// ===========================================================================

export type MsgPushDecoder = (ctx: PushContext) => MsgPushEvent[];

/** The decoder table: OlPush command number -> decoder. */
export const DECODERS: ReadonlyMap<number, MsgPushDecoder> = new Map<number, MsgPushDecoder>([
  [PkgType.GroupMessage, decodeGroupMessage],
  [PkgType.PrivateMessage, decodeFriendMessage],
  // The 9/208/529 variants are the same C2C conversation with a different payload
  // shape (forwarded-fake, voice, file), and all three decode through the friend
  // path because the envelope, not the body, is what differs.
  [PkgType.ForwardFakePrivateMessage, decodeFriendMessage],
  [PkgType.PrivateRecordMessage, decodeFriendMessage],
  [PkgType.PrivateFileMessage, decodeFriendMessage],
  [PkgType.TempMessage, decodeTempMessage],
  [PkgType.GroupAdminChangedNotice, decodeGroupAdminChangedNotice],
  [PkgType.Event0x210, decodeEvent0x210],
  [PkgType.Event0x2DC, decodeEvent0x2DC],
]);

/**
 * Dispatch one decoded push. Returns `[]` for a package type this port does not
 * handle — including group join/invite/member notices, which are skeletoned.
 */
export function decodePush(ctx: PushContext): MsgPushEvent[] {
  const decoder = DECODERS.get(ctx.head.msgType);
  if (!decoder) return [];
  return decoder(ctx);
}
