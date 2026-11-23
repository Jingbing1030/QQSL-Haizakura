// Shared helpers for the 擴展 (extended) family — the parts the 115 action bodies use
// but that are not actions themselves.
//
// Reference regions, all inside `../onebot/src/actions/extended.ts`
// (reference/index.mjs:11263-15686) except where noted:
//
//   essence* / degradeEssenceContent / essenceContentToSegment / projectEssenceMessage
//   fetchDownloadFile / saveDownloadBuffer / parseDownloadHeaders
//   optionalExactString / integerFromDecimalString / primitiveText
//   forwardMessagesField / forwardPreviewParams / readForwardPreviewMeta
//   groupTodoRun / parseFlashTaskFiles / flashFileInfoToJson
//   fetchFilteredGroupRequests
//
// ---------------------------------------------------------------------------
// Why these are not inline in `extended.ts`
// ---------------------------------------------------------------------------
// `extended.ts` is 115 definitions; the reference keeps them in one 4,424-line file.
// Splitting the pure helpers out keeps the action list readable and, more usefully,
// lets each helper be tested against a golden extracted from the reference's own
// function rather than through an action's side effects.
//
// ---------------------------------------------------------------------------
// The essence projection THROWS, and that is the contract
// ---------------------------------------------------------------------------
// `projectEssenceMessage` validates twelve snake_case fields and throws a specific
// message per field. The action catches the throw and answers
// `获取精华消息失败: ${e}`. So the throwing IS the observable behaviour — replacing a
// bad field with a default would turn a corrupt response into a plausible-looking
// message list. Every message below is copied verbatim.

import { FieldImpl, MISSING, RULES, type Ok, type Result } from "./kit.js";
import type { ForwardPreview } from "./context.js";
export type { ForwardPreview };
import { GROUP_MESSAGE_EVENT, hashMessageIdInt32 } from "./message-id.js";
import { readEnvAlias } from "../../bridge/env.js";

// ===========================================================================
// Essence-message field validation (reference:12000-12400)
// ===========================================================================

export function essenceNumber(value: unknown, field: string): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+$/.test(value))) {
    throw new Error(`invalid group essence field ${field}: ${String(value)}`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`invalid group essence field ${field}: ${String(value)}`);
  return parsed;
}

export function essencePositiveNumber(value: unknown, field: string): number {
  const parsed = essenceNumber(value, field);
  if (parsed <= 0) throw new Error(`group essence field ${field} must be positive: ${parsed}`);
  return parsed;
}

export function essenceNonNegativeNumber(value: unknown, field: string): number {
  const parsed = essenceNumber(value, field);
  if (parsed < 0) throw new Error(`group essence field ${field} must not be negative: ${parsed}`);
  return parsed;
}

export function essenceString(value: unknown, field: string, allowEmpty: boolean): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new Error(`invalid group essence field ${field}: ${String(value)}`);
  }
  return value;
}

export function optionalEssenceText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Unknown digest types (share cards, future `msg_type` values) degrade to text so one
 * unmapped item cannot fail the whole essence list.
 *
 * The join order is heading → title → summary → text → url, each only when it differs
 * from the ones already emitted. That `!==` chain is what stops a message whose brief
 * and title are identical from rendering the sentence twice.
 */
export function degradeEssenceContent(content: Record<string, unknown>): Record<string, unknown> {
  const brief = optionalEssenceText(content["share_brief"]);
  const title = optionalEssenceText(content["share_title"]);
  const summary = optionalEssenceText(content["share_summary"]);
  const url = optionalEssenceText(content["share_url"]);
  const text = optionalEssenceText(content["text"]);
  const heading = brief ?? title ?? summary ?? text;
  const parts: string[] = [];
  if (heading) parts.push(heading);
  if (title && title !== heading) parts.push(title);
  if (summary && summary !== heading && summary !== title) parts.push(summary);
  if (text && text !== heading) parts.push(text);
  if (url) parts.push(url);
  return {
    type: "text",
    data: { text: parts.length > 0 ? parts.join("\n") : `[essence type ${String(content["msg_type"])}]` },
  };
}

/**
 * One `msg_content` row → one OneBot segment.
 *
 * `msg_type` 1/2/3/4 are text/face/image/file. Everything else — including the share
 * cards that carry `share_*` fields — degrades, because a per-type decoder would have
 * to guess at every future type.
 */
export function essenceContentToSegment(content: unknown): Record<string, unknown> {
  const c = content as Record<string, unknown>;
  switch (c["msg_type"]) {
    case 1:
      return { type: "text", data: { text: essenceString(c["text"], "msg_content.text", true) } };
    case 2:
      return {
        type: "face",
        data: { id: String(essenceNonNegativeNumber(c["face_index"], "msg_content.face_index")) },
      };
    case 3:
      return {
        type: "image",
        data: { file: "", url: essenceString(c["image_url"], "msg_content.image_url", false) },
      };
    case 4: {
      const fileName = essenceString(c["file_name"], "msg_content.file_name", false);
      const fileId = essenceString(c["file_id"], "msg_content.file_id", false);
      const fileSize = essenceNonNegativeNumber(c["file_size"], "msg_content.file_size");
      return {
        type: "file",
        data: {
          file: fileName,
          file_id: fileId,
          file_size: fileSize,
          name: fileName,
          id: fileId,
          size: fileSize,
          busid: essenceNonNegativeNumber(c["file_bus_id"], "msg_content.file_bus_id"),
        },
      };
    }
    default:
      return degradeEssenceContent(c);
  }
}

/** What `get_essence_msg_list` writes to the message store, plus the row it returns. */
export interface EssenceProjection {
  messageId: number;
  meta: {
    isGroup: true;
    targetId: number;
    sequence: number;
    sequenceAuthoritative: true;
    eventName: string;
    clientSequence: 0;
    random: number;
    timestamp: number;
  };
  result: Record<string, unknown>;
}

/**
 * One essence row → `{ messageId, meta, result }`.
 *
 * ⚠️ The `group_code !== groupId` check is the security-relevant one: a page that
 * answers for another group would otherwise have its messages stamped with THIS
 * group's id, and a later `set_group_reaction` would then address the wrong session.
 * The reference throws rather than filtering, and the action reports the throw.
 */
export function projectEssenceMessage(message: Record<string, unknown>, groupId: number): EssenceProjection {
  const messageGroupId = essencePositiveNumber(message["group_code"], "group_code");
  if (messageGroupId !== groupId) {
    throw new Error(
      `group essence field group_code does not match requested group: ${messageGroupId} !== ${groupId}`,
    );
  }
  const sequence = essencePositiveNumber(message["msg_seq"], "msg_seq");
  const random = essenceNonNegativeNumber(message["msg_random"], "msg_random");
  const timestamp = essenceNonNegativeNumber(message["sender_time"], "sender_time");
  const senderId = essencePositiveNumber(message["sender_uin"], "sender_uin");
  const operatorId = essencePositiveNumber(message["add_digest_uin"], "add_digest_uin");
  const operatorTime = essenceNonNegativeNumber(message["add_digest_time"], "add_digest_time");
  const senderNick = essenceString(message["sender_nick"], "sender_nick", true);
  const operatorNick = essenceString(message["add_digest_nick"], "add_digest_nick", true);
  const rawContent = message["msg_content"];
  if (!Array.isArray(rawContent)) {
    throw new Error(`invalid group essence field msg_content: ${String(rawContent)}`);
  }
  const content = rawContent.map(essenceContentToSegment);
  const messageId = hashMessageIdInt32(sequence, groupId, GROUP_MESSAGE_EVENT);
  return {
    messageId,
    meta: {
      isGroup: true,
      targetId: groupId,
      sequence,
      sequenceAuthoritative: true,
      eventName: GROUP_MESSAGE_EVENT,
      clientSequence: 0,
      random,
      timestamp,
    },
    result: {
      msg_seq: sequence,
      msg_random: random,
      sender_id: senderId,
      sender_nick: senderNick,
      sender_time: timestamp,
      operator_id: operatorId,
      operator_nick: operatorNick,
      operator_time: operatorTime,
      message_id: messageId,
      content,
    },
  };
}

// ===========================================================================
// `download_file` (reference:217-264)
// ===========================================================================

/** 1 GiB — the reference's `DOWNLOAD_FILE_MAX_BYTES` (reference:11266). */
export const DOWNLOAD_FILE_MAX_BYTES = 1024 * 1024 * 1024;

/** 60 s — the reference's `DEFAULT_DOWNLOAD_FILE_TIMEOUT_MS` (reference:11267). */
export const DEFAULT_DOWNLOAD_FILE_TIMEOUT_MS = 60_000;

/**
 * `SNOWLUMA_DOWNLOAD_FILE_TIMEOUT_MS`, with a positive-integer guard.
 *
 * A misconfigured value falls back to the default rather than producing a zero
 * timeout, which would make every download fail instantly.
 */
export function downloadFileTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = readEnvAlias("DOWNLOAD_FILE_TIMEOUT_MS", env);
  if (raw === undefined || raw === "") return DEFAULT_DOWNLOAD_FILE_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && Number.isInteger(parsed)
    ? parsed
    : DEFAULT_DOWNLOAD_FILE_TIMEOUT_MS;
}

/**
 * Header lines → a plain object.
 *
 * Accepts `"A=1\r\nB=2"` or `["A=1","B=2"]`. The split is on the FIRST `=`, so a value
 * containing `=` survives; a line with no `=` (or a leading `=`, `idx === 0`) is
 * dropped rather than becoming an empty-named header.
 */
export function parseDownloadHeaders(headers: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  const headerList: string[] = [];
  if (typeof headers === "string") headerList.push(...headers.split(/\r?\n/).filter(Boolean));
  else if (Array.isArray(headers)) {
    for (const h of headers) if (typeof h === "string") headerList.push(h);
  }
  for (const line of headerList) {
    const idx = line.indexOf("=");
    if (idx > 0) result[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
  }
  return result;
}

/**
 * Fetch a URL into memory, refusing anything over `maxBytes`.
 *
 * Two size checks, and both are needed: `content-length` catches a well-behaved
 * server early, and the streaming accumulator catches a server that omits or lies
 * about the header. A `fetch` that cannot get a body reader (some test doubles) falls
 * back to `arrayBuffer()` with the same check.
 */
export async function fetchDownloadFile(
  url: string,
  headers: Record<string, string>,
  maxBytes: number,
  timeoutMs: number,
): Promise<Buffer> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`download failed: HTTP ${String(response.status)}`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`download too large: ${declared} > ${maxBytes}`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error(`download too large: ${bytes.length} > ${maxBytes}`);
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`download too large: ${total} > ${maxBytes}`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/**
 * Write a downloaded buffer under `data/downloads`.
 *
 * The traversal guard is the reference's: `path.basename` then a `relative` re-check.
 * `basename` alone is not enough on its own for a name like `..`, so both tests run and
 * both throw the same `invalid file name`.
 *
 * An absent name becomes the buffer's MD5, which makes a re-download of the same
 * content overwrite rather than accumulate.
 */
export async function saveDownloadBuffer(buf: Buffer, preferredName: string): Promise<string> {
  const fs = await import("node:fs");
  const pathMod = await import("node:path");
  const cryptoMod = await import("node:crypto");
  const tempDir = pathMod.resolve("data", "downloads");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const rawName = preferredName || cryptoMod.createHash("md5").update(buf).digest("hex");
  const safeName = pathMod.basename(rawName);
  if (!safeName || safeName === "." || safeName === ".." || /[\\/]/.test(safeName)) {
    throw new Error("invalid file name");
  }
  const resolved = pathMod.resolve(tempDir, safeName);
  const rel = pathMod.relative(tempDir, resolved);
  if (rel.startsWith("..") || pathMod.isAbsolute(rel)) throw new Error("invalid file name");
  await fs.promises.writeFile(resolved, buf);
  return resolved;
}

// ===========================================================================
// Small coercions (reference:265-315)
// ===========================================================================

/**
 * `longNick` / `long_nick`: `.optional()` but STRICTLY a string.
 *
 * `f.string()` alone accepts a number or a boolean and stringifies it, which the
 * reference explicitly does not want here — `set_self_longnick` treats a non-string as
 * `400 invalid longNick`. So the wrapper rejects numbers/booleans/null/objects with
 * `expected a string` while still allowing absence.
 */
export function optionalExactString(): FieldImpl<string | undefined> {
  // `Object.create(inner)` mirrors the reference's own construction: the wrapper
  // INHERITS `doc` (so `describe()` still reports a string field with no default
  // required) and overrides only the coercion entry point. A fresh `FieldImpl` would
  // have to re-state the doc and could drift from `f.string().optional()`.
  const inner = new FieldImpl<string | undefined>(
    (raw, field): Result<string | undefined> =>
      typeof raw === "string" ? ({ ok: true, value: raw } as Ok<string | undefined>) : { ok: false, field, reason: "expected a string" },
    { type: "string", required: false, default: undefined, schema: { type: "string" } },
  );
  void MISSING;
  return inner;
}

/** A decimal string (or blank) → integer, never throwing. `""` is 0, not NaN. */
export function integerFromDecimalString(value: string): number {
  if (value.trim() === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** A scalar → its string form; anything else → `""`. */
export function primitiveText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

// ===========================================================================
// Forward params (reference:286-315)
// ===========================================================================

/**
 * `readForwardPreviewMeta` — returns `undefined` when nothing is set.
 *
 * The `undefined` (rather than `{}`) matters: the senders branch on a present meta and
 * a `{}` would make every plain forward request carry an empty preview block.
 *
 * `news` accepts a bare string per entry or `{text}`; entries that yield no text are
 * dropped, and an all-empty list becomes `undefined` rather than `[]`.
 */
export function readForwardPreviewMeta(p: Record<string, unknown>): ForwardPreview | undefined {
  const source = (p["source"] as string | undefined) || undefined;
  const summary = (p["summary"] as string | undefined) || undefined;
  const prompt = (p["prompt"] as string | undefined) || undefined;
  let news: { text: string }[] | undefined;
  const rawNews = p["news"];
  if (Array.isArray(rawNews)) {
    const collected: { text: string }[] = [];
    for (const item of rawNews) {
      if (typeof item === "string") collected.push({ text: item });
      else if (item && typeof item === "object" && !Array.isArray(item)) {
        const text = primitiveText((item as Record<string, unknown>)["text"]);
        if (text) collected.push({ text });
      }
    }
    if (collected.length > 0) news = collected;
  }
  if (!source && !summary && !prompt && !news) return undefined;
  return { source, summary, prompt, news };
}

// ===========================================================================
// Group todo (reference:315-330)
// ===========================================================================

/**
 * The shared guard for the four todo actions.
 *
 * `message_id` must resolve to a GROUP meta in THIS group with an authoritative
 * sequence; only then may the operation run, and the sequence goes over the wire as a
 * `bigint` because `0x0f90`'s `msgSeq` is uint64 and its encoder throws on a number.
 */
export async function groupTodoRun(
  groupId: number,
  messageId: number,
  ctx: {
    getMessageMeta?(messageId: number): Promise<{ isGroup: boolean; targetId: number; sequence: number; sequenceAuthoritative: boolean } | null | undefined>;
  },
  op: (groupId: number, msgSeq: bigint) => Promise<unknown>,
): Promise<{ status: "ok" } | { status: "failed"; retcode: number; wording: string }> {
  const meta = await ctx.getMessageMeta?.(messageId);
  if (!meta) return { status: "failed", retcode: 100, wording: "message not found" };
  if (!meta.isGroup || meta.targetId !== groupId) {
    return { status: "failed", retcode: 100, wording: "message does not belong to this group" };
  }
  if (!(meta.sequenceAuthoritative === true && Number.isInteger(meta.sequence) && meta.sequence > 0)) {
    return { status: "failed", retcode: 100, wording: "message has no authoritative QQ sequence" };
  }
  await op(groupId, BigInt(meta.sequence));
  return { status: "ok" };
}

// ===========================================================================
// Flash-transfer file list (reference:331-360)
// ===========================================================================

export interface FlashTaskFile {
  file: string;
  name?: string | undefined;
}

/**
 * `create_flash_task`'s `files` — a path, `{file,name}`, or an array of either.
 *
 * Returns `{error}` rather than throwing, because the action turns it into a 1400 with
 * that exact text. Note the `""` string and `{file: ""}` both count as empty.
 */
export function parseFlashTaskFiles(raw: unknown): { files: FlashTaskFile[] } | { error: string } {
  const items = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
  if (items.length === 0) return { error: "files must not be empty" };
  const files: FlashTaskFile[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      if (item === "") return { error: "files must not be empty" };
      files.push({ file: item });
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      const file = rec["file"];
      const name = rec["name"];
      if (typeof file !== "string" || file === "") return { error: "files must not be empty" };
      if (name !== undefined && typeof name !== "string") return { error: "files[].name must be a string" };
      files.push(name === undefined ? { file } : { file, name: name as string });
      continue;
    }
    return { error: "files must be a path string, { file, name }, or an array of those" };
  }
  return { files };
}

/**
 * `FlashFileInfo` → the OneBot JSON row.
 *
 * The field name is `size`, not `file_size`, deliberately: it matches NapCat so a
 * client written against that implementation can drop Haizakura in unchanged. The
 * comment is the reference's own and is the only record of why the swap is not a bug.
 */
export function flashFileInfoToJson(f: {
  filesetUuid: string;
  fileName: string;
  origName: string;
  fileSize: number;
  shareUrl: string;
  fileId: string;
  downloadUrl: string;
}): Record<string, unknown> {
  return {
    fileset_id: f.filesetUuid,
    file_name: f.fileName,
    orig_name: f.origName,
    size: f.fileSize,
    share_url: f.shareUrl,
    file_id: f.fileId,
    download_url: f.downloadUrl,
  };
}

export { MISSING, RULES };