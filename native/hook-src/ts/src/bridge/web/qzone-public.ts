// `../protocol/src/web/qzone-public.ts` (637 lines) — 空友推荐 (public recommendations).
//
// ---------------------------------------------------------------------------
// This is NOT the cookie-CGI surface next door
// ---------------------------------------------------------------------------
// `web/qzone.ts` is sixteen `cgi-bin` endpoints over `GET`/`POST`
// form-urlencoded. This module is a single endpoint —
//
//   POST https://h5.qzone.qq.com/http2rpc/gotrpc/v1/<service>/<method>?g_tk=<bkn>
//
// — with a JSON body and an `x-oidb` HEADER naming a protobuf command. There is
// no protobuf on the wire despite the header: the request and the response are
// both JSON, and the only protobuf in the whole module is the 25-byte `ugc_id`
// blob `GetFeedDetail` wants base64'd into a JSON string. So this needs no
// `OidbSpec`, no packet channel and no `oidbCaller`: `OidbSpec` is shaped around
// a binary envelope plus a `toBody`/`fromBody` pair, and none of that exists here.
//
// ---------------------------------------------------------------------------
// `cell_feed_transfer` is a required opaque token, and it is easy to drop
// ---------------------------------------------------------------------------
// Every mutating call needs `union_id` (plus `cell_feed_transfer` when present).
// `feedParams` refuses a feed without a non-empty `union_id` rather than sending
// an under-specified request the server would answer with a generic failure. That
// is why the public list/detail functions return whole feed objects and not ids:
// a caller cannot reconstruct the params from a tid alone.
//
// ---------------------------------------------------------------------------
// The two cursors are different things with one encoder
// ---------------------------------------------------------------------------
// The recommendation list's cursor carries `refresh_id` + `attach_info` +
// `last_client_feed_union_id`; the home-page cursor carries `kind: "home"` +
// `host_uin` + `attach_info`. They share `encodeCursor`/`decodeCursor` but the
// home one is validated inline because its schema is `kind`-tagged. Both are
// base64url over JSON with the canonical-encoding re-check — same reasoning as
// `qzone-feed-cursor.ts`: without it one state has many textual forms.
//
// ---------------------------------------------------------------------------
// `operate_mask & (1 << 17)` blocks sharing, with the server's own message
// ---------------------------------------------------------------------------
// `getQzoneShareArk` checks the bit BEFORE requesting a card. Bit 17 means "this
// feed cannot be shared outside", and the server also sends a
// `share_out_button_toast` explaining why; throwing that text beats a generic
// "share failed" and beats a silent empty ark.
//
// Reference: reference/index.mjs:336795 (`../protocol/src/web/qzone-public.ts`).
// The `0x9741_0` / `0x97b1_1` / … command numbers are that module's wire contract.

import { ProtoWriter } from "../../oidb/wire.js";
import { createLogger } from "../../onebot/log.js";
import { RequestUtil, cookieToString, getBknFromCookie } from "./request-util.js";

const log = createLogger("Bridge.Web");

/** The four JSON-over-gotrpc services this module talks to. */
export const QZONE_FEEDS_READER = "trpc.qzone.feeds_reader.FeedsReader";
export const QZONE_FEEDS_WRITER = "trpc.qzone.feeds_writer.FeedsWriter";
export const QZONE_INTERACTION_WRITER = "trpc.qzone.interaction_writer.InteractionWriter";
export const QZONE_PUBLIC_UPVOTE = "trpc.public_qzone.interaction.UFOComment";
export const QZONE_PUBLIC_RELATION = "trpc.public_qzone.relation.RelationService";
export const QZONE_SHARE_SERVICE = "trpc.qq.share.Service";
export const QZONE_ENTRANCE_CTRL = "trpc.public_qzone.entrance_ctrl.EntranceCtrl";

/** The 说说 appid, whose tid is a 24-hex feed id. */
export const QZONE_SHUOSHUO_APPID = 311;

/** `isObject` — a plain record, not an array and not null. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The one POST the whole module rides on.
 *
 * `x-oidb` carries `uint32_command` / `uint32_service_type` as JSON — the pair
 * split from the module's own `"0x97b1_1"` spelling. `x-web-qua` is pinned: the
 * gateway rejects a request without a qua string, and this is the reference's
 * captured value.
 *
 * `retcode !== 0` or a non-object `data` throws with the server's `message`. A
 * transport failure propagates out of `HttpGetJson` unchanged.
 */
export async function qzonePublicRequest(
  cookies: Record<string, string>,
  service: string,
  method: string,
  oidb: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const [command, serviceType] = oidb.split("_");
  const result = (await RequestUtil.HttpGetJson(
    `https://h5.qzone.qq.com/http2rpc/gotrpc/v1/${service}/${method}?g_tk=${getBknFromCookie(cookies)}`,
    "POST",
    params,
    {
      Cookie: cookieToString(cookies),
      "Content-Type": "application/json",
      Referer: "https://h5.qzone.qq.com/pc-qzone/index.html",
      "x-web-qua": "V1_HT5_QZ_9.9.32_001_IDC_B",
      "x-oidb": JSON.stringify({ uint32_command: command, uint32_service_type: serviceType }),
    },
  )) as unknown;
  if (!isObject(result) || result["retcode"] !== 0 || !isObject(result["data"])) {
    const code = isObject(result) ? result["retcode"] : "invalid response";
    const message = isObject(result) && typeof result["message"] === "string" ? result["message"] : "";
    throw new Error(`qzone public ${method} failed: retcode=${String(code)} ${message}`.trim());
  }
  return result["data"] as Record<string, unknown>;
}

// ===========================================================================
// The one protobuf message
// ===========================================================================

/**
 * `QzoneEmotionUgcId` — the ugc id `GetFeedDetail` wants, base64'd into JSON.
 *
 * Built from the tid itself: a 24-hex 说说 tid IS a little-endian
 * `{uin: u32, publishTime: u32}` followed by eight bytes of sequence. So
 * `identity.readUInt32LE(0)` is the author's uin and `readUInt32LE(4)` the publish
 * time — the tid is not an opaque handle, and the uin/time fields are derived
 * rather than requested.
 *
 * Field numbers from the reference's writer: appId 1, uin 2, publishTime 3,
 * field4 4, field5 5, field6 6, tid 8 (NOT 7 — tag 66). `field4`/`field5` are
 * emitted even when empty (the `!= null` rule) which is why they produce `22 00`
 * and `2a 00`; `field6` and `tid` use `!= ""`.
 *
 * Reference: reference/index.mjs:336922.
 */
export function encodeQzoneEmotionUgcId(id: {
  appId: bigint;
  uin: bigint;
  publishTime: bigint;
  field4: string;
  field5: string;
  field6: string;
  tid: string;
}): Uint8Array {
  return new ProtoWriter(64)
    .uint64(1, id.appId)
    .uint64(2, id.uin)
    .uint64(3, id.publishTime)
    .stringPresent(4, id.field4)
    .stringPresent(5, id.field5)
    .string(6, id.field6)
    .string(8, id.tid)
    .finish();
}

// ===========================================================================
// Cursors
// ===========================================================================

/** The recommendation-list cursor. */
export interface QzonePublicCursorState {
  version: 1;
  uin: string;
  refresh_id: string;
  attach_info: string;
  last_client_feed_union_id: Record<string, unknown> | null;
}

/** The home-page cursor. A different schema behind the same encoder. */
export interface QzoneHomeCursorState {
  version: 1;
  kind: "home";
  uin: string;
  host_uin: string;
  attach_info: string;
}

/** Shared ceiling, for the same reason as `qzone-feed-cursor.ts`. */
export const QZONE_PUBLIC_CURSOR_MAX_LENGTH = 65_536;

/** `encodeCursor` — base64url over the exact JSON. */
export function encodeCursor(state: Record<string, unknown>): string {
  const cursor = Buffer.from(JSON.stringify(state)).toString("base64url");
  if (cursor.length > QZONE_PUBLIC_CURSOR_MAX_LENGTH) throw new Error("空友推荐分页游标过大");
  return cursor;
}

/**
 * `decodeCursor` — the recommendation cursor.
 *
 * The `last_client_feed_union_id` is validated as `null` OR an object, not as a
 * string: it is the whole `union_id` sub-message, which the next request sends
 * back verbatim. Reconstructing it from a string would lose `feed_id`/`uf_key`
 * and the follow-up page would be answered with page 1.
 */
export function decodeCursor(cursor: string, uin: string): QzonePublicCursorState {
  if (!cursor || cursor.length > QZONE_PUBLIC_CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new Error("无效的空友推荐 cursor");
  }
  let value: unknown;
  try {
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) throw new Error("non-canonical encoding");
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("无效的空友推荐 cursor");
  }
  if (
    !isObject(value) ||
    value["version"] !== 1 ||
    value["uin"] !== uin ||
    typeof value["refresh_id"] !== "string" ||
    !value["refresh_id"] ||
    typeof value["attach_info"] !== "string" ||
    !(value["last_client_feed_union_id"] === null || isObject(value["last_client_feed_union_id"]))
  ) {
    throw new Error("空友推荐 cursor 无效或不属于当前账号");
  }
  return {
    version: 1,
    uin,
    refresh_id: value["refresh_id"] as string,
    attach_info: value["attach_info"] as string,
    last_client_feed_union_id: value["last_client_feed_union_id"] as Record<string, unknown> | null,
  };
}

/**
 * `feedParams` — the `union_id` (+ optional transfer token) every call needs.
 *
 * Throws on a missing or empty `union_id` with the caller-facing reason: a
 * hand-built feed object (an id copied out of a message) cannot be used here, only
 * a whole feed from a list or detail response.
 */
export function feedParams(feed: Record<string, unknown>): { union_id: Record<string, unknown>; cell_feed_transfer?: unknown } {
  const common = feed["cell_common"];
  const unionId = isObject(common) ? common["union_id"] : undefined;
  if (!isObject(unionId) || Object.keys(unionId).length === 0) {
    throw new Error("空友动态缺少 cell_common.union_id，请使用推荐列表或详情返回的完整动态");
  }
  return {
    union_id: unionId,
    ...(feed["cell_feed_transfer"] === undefined ? {} : { cell_feed_transfer: feed["cell_feed_transfer"] }),
  };
}

// ===========================================================================
// Reads
// ===========================================================================

/**
 * `getQzonePublicCapabilities` — whether the account has 空友 at all.
 *
 * `entrance_types: [1, 15]` and the result is matched by `uin` as a STRING
 * because the server sends it as a number on some accounts and a string on
 * others. A missing entry throws rather than returning `{}`, since "no entrances"
 * and "this account is not whitelisted" are different answers.
 */
export async function getQzonePublicCapabilities(
  cookies: Record<string, string>,
  selfUin: string,
): Promise<Record<string, unknown>> {
  const data = await qzonePublicRequest(cookies, QZONE_ENTRANCE_CTRL, "BatchEntranceWhitelist", "0x9741_0", {
    uins: [selfUin],
    entrance_types: [1, 15],
  });
  const results = Array.isArray(data["results"]) ? (data["results"] as unknown[]) : undefined;
  const result = results?.find((entry) => isObject(entry) && String(entry["uin"]) === selfUin);
  if (!isObject(result) || !isObject(result["entrances"])) {
    throw new Error("qzone public BatchEntranceWhitelist 缺少当前账号的 entrances");
  }
  return result["entrances"] as Record<string, unknown>;
}

/**
 * `getQzoneHomeFeeds` — one space's 动态 via `GetMainPageFeeds`.
 *
 * `host_uid` is sent as `""` while `host_uin` carries the target; the pair is the
 * gateway's contract and swapping them (putting the uin in `host_uid`) is answered
 * with a generic error.
 *
 * `attach_info === attachInfo` on a `has_more: true` page throws: a non-advancing
 * cursor would make the caller page forever.
 */
export async function getQzoneHomeFeeds(
  cookies: Record<string, string>,
  selfUin: string,
  targetUin: string = selfUin,
  cursor?: string,
): Promise<Record<string, unknown> & { feeds: unknown[]; has_more: boolean; next_cursor: string | null }> {
  let attachInfo = "";
  if (cursor !== undefined) {
    if (!cursor || cursor.length > QZONE_PUBLIC_CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
      throw new Error("无效的空间主页 cursor");
    }
    const bytes = Buffer.from(cursor, "base64url");
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    if (
      bytes.toString("base64url") !== cursor ||
      !isObject(value) ||
      value["version"] !== 1 ||
      value["kind"] !== "home" ||
      value["uin"] !== selfUin ||
      value["host_uin"] !== targetUin ||
      typeof value["attach_info"] !== "string" ||
      !value["attach_info"]
    ) {
      throw new Error("空间主页 cursor 无效或不属于当前账号及主页");
    }
    attachInfo = value["attach_info"] as string;
  }
  const data = await qzonePublicRequest(cookies, QZONE_FEEDS_READER, "GetMainPageFeeds", "0x9794_2", {
    host_uid: "",
    host_uin: targetUin,
    attach_info: attachInfo,
    refresh_attach_info: "",
    feed_action_domain_type: 1,
  });
  if (!Array.isArray(data["feeds"]) || typeof data["has_more"] !== "boolean") {
    throw new Error("空间主页动态分页响应异常");
  }
  const feeds = (data["feeds"] as unknown[]).map((entry) => {
    if (!isObject(entry) || !isObject(entry["feed"])) throw new Error("空间主页动态响应异常");
    return entry["feed"];
  });
  let nextCursor: string | null = null;
  if (data["has_more"]) {
    const nextAttach = data["attach_info"];
    if (typeof nextAttach !== "string" || !nextAttach || nextAttach === attachInfo) {
      throw new Error("空间主页动态分页未推进");
    }
    const state: QzoneHomeCursorState = {
      version: 1,
      kind: "home",
      uin: selfUin,
      host_uin: targetUin,
      attach_info: nextAttach,
    };
    nextCursor = encodeCursor(state as unknown as Record<string, unknown>);
  }
  return { ...data, feeds, has_more: data["has_more"], next_cursor: nextCursor };
}

/**
 * `getQzoneFeedDetail` — a 说说 by its 24-hex tid.
 *
 * The tid is validated as exactly 24 hex characters before anything is sent: the
 * first eight bytes are read as two little-endian u32s, so a shorter string would
 * throw inside `readUInt32LE` with a message that names a buffer offset instead of
 * the caller's input.
 *
 * The response's own `feed_id` is compared back against the request, lowercased on
 * both sides — the server echoes uppercase for some feeds, and a mismatch means the
 * answer belongs to a different post.
 */
export async function getQzoneFeedDetail(
  cookies: Record<string, string>,
  tid: string,
): Promise<Record<string, unknown> & { feed: Record<string, unknown>; attach_info: string | null }> {
  if (tid.length !== 24 || !/^[0-9a-f]{24}$/i.test(tid)) {
    throw new Error("空间说说 tid 必须是 24 位十六进制编号");
  }
  const feedId = tid.toLowerCase();
  const identity = Buffer.from(feedId, "hex");
  const ugcId = encodeQzoneEmotionUgcId({
    appId: 311n,
    uin: BigInt(identity.readUInt32LE(0)),
    publishTime: BigInt(identity.readUInt32LE(4)),
    field4: "",
    field5: "",
    field6: "0",
    tid: feedId,
  });
  const data = await qzonePublicRequest(cookies, QZONE_FEEDS_READER, "GetFeedDetail", "0x97b1_1", {
    union_id: { feed_id: feedId, ugc_id: Buffer.from(ugcId).toString("base64"), adv_id: null },
    feed_action_domain_type: 1,
    from_page: 1,
  });
  const wrapper = data["feed"];
  if (!isObject(wrapper) || !isObject(wrapper["feed"])) {
    throw new Error("qzone GetFeedDetail 响应缺少完整动态 feed.feed");
  }
  const feed = wrapper["feed"];
  const common = feed["cell_common"];
  const unionId = isObject(common) ? common["union_id"] : undefined;
  if (!isObject(unionId) || typeof unionId["feed_id"] !== "string" || unionId["feed_id"].toLowerCase() !== feedId) {
    throw new Error("qzone GetFeedDetail 返回的动态编号与请求不符");
  }
  if (data["attach_info"] !== null && data["attach_info"] !== undefined && typeof data["attach_info"] !== "string") {
    throw new Error("qzone GetFeedDetail 评论游标格式异常");
  }
  return { ...data, feed, attach_info: (data["attach_info"] as string | undefined) ?? null };
}

/** A share card plus the confirmation the caller must surface first. */
export interface QzoneShareArk {
  ark: string;
  requires_confirmation: boolean;
  notice: string | null;
}

/**
 * `getQzoneShareArk` — build a share card for a feed.
 *
 * Four separate validations, each from a different server behaviour:
 *
 *   1. `operate_mask & (1 << 17)` — sharing is blocked. The server's own
 *      `share_out_button_toast` is the error, so the user sees why.
 *   2. `busi_id` / `resource_id` / `cell_feed_transfer` must all be non-empty, and
 *      the transfer token comes from `feed` directly (not `cell_common`) — a feed
 *      from a list response usually has it.
 *   3. `template_data` must be a non-empty JSON object string. Checking it parses
 *      catches a card the caller could not render.
 *   4. `info.busi_data` is a base64 JSON permission blob whose `need_break` asks
 *      for confirmation and whose `tips.content` explains what will be visible.
 *      The base64 is round-tripped through decode/re-encode before trusting it,
 *      and the decode is `fatal: true` so invalid UTF-8 is rejected rather than
 *      silently replaced — a replaced character could change `need_break`.
 */
export async function getQzoneShareArk(
  cookies: Record<string, string>,
  feed: Record<string, unknown>,
): Promise<QzoneShareArk> {
  const operation = feed["cell_operation"];
  const share = isObject(operation) ? operation["share_outside"] : undefined;
  const resource = isObject(share) ? share["share_access_resource"] : undefined;
  const common = feed["cell_common"];
  const mask = isObject(common) ? common["operate_mask"] : undefined;
  if (mask !== undefined && (typeof mask !== "number" || !Number.isSafeInteger(mask) || mask < 0)) {
    throw new Error("空间动态分享权限数据异常");
  }
  if (typeof mask === "number" && (mask & (1 << 17)) !== 0) {
    const reason =
      isObject(share) && typeof share["share_out_button_toast"] === "string"
        ? share["share_out_button_toast"]
        : "该空间动态暂不支持分享";
    throw new Error(reason);
  }
  if (
    !isObject(resource) ||
    typeof resource["busi_id"] !== "string" ||
    !resource["busi_id"] ||
    typeof resource["resource_id"] !== "string" ||
    !resource["resource_id"] ||
    typeof feed["cell_feed_transfer"] !== "string" ||
    !feed["cell_feed_transfer"]
  ) {
    throw new Error("空间动态缺少分享信息，请传入主页、详情或推荐列表返回的完整动态");
  }
  const data = await qzonePublicRequest(cookies, QZONE_SHARE_SERVICE, "CreateShare", "0x9409_1", {
    info: {
      busi_id: resource["busi_id"],
      resource_id: resource["resource_id"],
      template: "ark_busi_select",
      busi_data: feed["cell_feed_transfer"],
      plat: 1,
      target: 3,
    },
  });
  const err = data["err"];
  if (err !== undefined && err !== null) {
    if (!isObject(err) || (err["code"] !== undefined && typeof err["code"] !== "number")) {
      throw new Error("空间分享业务响应异常");
    }
    if (err["code"] !== undefined && err["code"] !== 0) {
      const message = typeof err["msg"] === "string" ? err["msg"] : "";
      throw new Error(`空间分享失败: ${String(err["code"])} ${message}`.trim());
    }
  }
  const templateData = data["template_data"];
  if (typeof templateData !== "string" || !templateData.trim()) throw new Error("空间分享未返回卡片");
  if (!isObject(JSON.parse(templateData) as unknown)) throw new Error("空间分享返回的卡片格式异常");

  let requiresConfirmation = false;
  let notice: string | null = null;
  if (data["info"] !== undefined) {
    if (!isObject(data["info"])) throw new Error("空间分享提示格式异常");
    const encoded = data["info"]["busi_data"];
    if (encoded !== undefined && encoded !== "") {
      if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
        throw new Error("空间分享提示编码异常");
      }
      const decoded = Buffer.from(encoded, "base64");
      if (decoded.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
        throw new Error("空间分享提示编码异常");
      }
      const permission = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded)) as unknown;
      if (permission !== null) {
        if (!isObject(permission) || (permission["need_break"] !== undefined && typeof permission["need_break"] !== "boolean")) {
          throw new Error("空间分享提示格式异常");
        }
        requiresConfirmation = permission["need_break"] === true;
        const tips = permission["tips"];
        if (isObject(tips) && typeof tips["content"] === "string" && tips["content"]) notice = tips["content"];
        // The default text is the reference's, and it exists because a
        // confirmation prompt with no body is unanswerable.
        if (requiresConfirmation && !notice) notice = "你的空间有权限，分享出去的页面所有人都可以看。";
      }
    }
  }
  return { ark: templateData, requires_confirmation: requiresConfirmation, notice };
}

/**
 * `getQzonePublicFeeds` — the recommendation feed, which is refresh-scoped.
 *
 * The `refresh_id` is `` `${selfUin}_${Date.now()}` `` on the first call: it is a
 * session marker, and every continuation must reuse the SAME one or the server
 * starts a new list.
 *
 * `last_client_feed_union_id` is updated from the LAST feed whose
 * `cell_common.feed_type !== 3` — type 3 is an advertisement card, and advancing
 * past one skips real content on the next page.
 */
export async function getQzonePublicFeeds(
  cookies: Record<string, string>,
  selfUin: string,
  cursor?: string,
): Promise<Record<string, unknown> & { feeds: unknown[]; has_more: boolean; next_cursor: string | null }> {
  const state: QzonePublicCursorState =
    cursor === undefined
      ? {
          version: 1,
          uin: selfUin,
          refresh_id: `${selfUin}_${String(Date.now())}`,
          attach_info: "",
          last_client_feed_union_id: null,
        }
      : decodeCursor(cursor, selfUin);
  const data = await qzonePublicRequest(cookies, QZONE_FEEDS_READER, "GetPublicRecomFeeds", "0x9a38_0", {
    refresh_id: state.refresh_id,
    ...(cursor === undefined
      ? {}
      : {
          attach_info: state.attach_info,
          ...(state.last_client_feed_union_id === null ? {} : { last_client_feed_union_id: state.last_client_feed_union_id }),
        }),
  });
  if (!Array.isArray(data["feeds"]) || typeof data["has_more"] !== "boolean") {
    throw new Error("qzone public GetPublicRecomFeeds 分页响应异常");
  }
  const feeds = (data["feeds"] as unknown[]).map((entry) => {
    if (!isObject(entry) || !isObject(entry["feed"])) {
      throw new Error("qzone public GetPublicRecomFeeds 动态响应异常");
    }
    return entry["feed"];
  });
  let lastUnion = state.last_client_feed_union_id;
  for (const item of feeds) {
    if (!isObject(item)) continue;
    const common = item["cell_common"];
    // `feed_type === 3` is an ad slot; see the doc comment above.
    if (isObject(common) && common["feed_type"] !== 3 && isObject(common["union_id"])) {
      lastUnion = common["union_id"];
    }
  }
  let nextCursor: string | null = null;
  if (data["has_more"]) {
    const attach = data["attach_info"];
    if (typeof attach !== "string") throw new Error("qzone public GetPublicRecomFeeds 缺少 attach_info");
    nextCursor = encodeCursor({ ...state, attach_info: attach, last_client_feed_union_id: lastUnion });
  }
  return { ...data, feeds, has_more: data["has_more"], next_cursor: nextCursor };
}

/** `getQzonePublicFeedDetail` — a feed detail in recommendation context (domain 3). */
export async function getQzonePublicFeedDetail(
  cookies: Record<string, string>,
  feed: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return qzonePublicRequest(cookies, QZONE_FEEDS_READER, "GetFeedDetail", "0x97b1_1", {
    ...feedParams(feed),
    feed_action_domain_type: 3,
    from_page: 1,
  });
}

/** `getQzonePublicComments` — one page of comments; `cursor` is the `attach_info`. */
export async function getQzonePublicComments(
  cookies: Record<string, string>,
  feed: Record<string, unknown>,
  cursor: string,
): Promise<Record<string, unknown>> {
  return qzonePublicRequest(cookies, QZONE_FEEDS_READER, "GetComment", "0x9bfd_1", {
    ...feedParams(feed),
    attach_info: cursor,
  });
}

/** `getQzonePublicReplies` — replies under one comment. */
export async function getQzonePublicReplies(
  cookies: Record<string, string>,
  feed: Record<string, unknown>,
  comment: Record<string, unknown>,
  cursor: string,
  pageSize = 20,
): Promise<Record<string, unknown>> {
  return qzonePublicRequest(cookies, QZONE_FEEDS_READER, "GetReplies", "0x9bfe_1", {
    ...feedParams(feed),
    cur_comment: comment,
    comment_attach_info: "",
    // Three-level fallback: the caller's cursor, then the comment's own cached
    // one, then "". A caller resuming a known thread passes nothing and still
    // gets the right position.
    reply_attach_info: cursor || (typeof comment["reply_attach_info"] === "string" ? comment["reply_attach_info"] : ""),
    page_size: pageSize,
  });
}

// ===========================================================================
// Writes
// ===========================================================================

/** `setQzonePublicUpvote` — 点赞/取消 at the post level (the "顶" action). */
export async function setQzonePublicUpvote(
  cookies: Record<string, string>,
  feed: Record<string, unknown>,
  enable = true,
): Promise<Record<string, unknown>> {
  const data = await qzonePublicRequest(
    cookies,
    QZONE_PUBLIC_UPVOTE,
    enable ? "Upvote" : "Downvote",
    enable ? "0x9d18_1" : "0x9d19_1",
    feedParams(feed),
  );
  if (!data["upvote"]) throw new Error("qzone public upvote 响应缺少 upvote");
  return data;
}

/**
 * `setLike` — the shared like/unlike call.
 *
 * `like_type` distinguishes the target: 1 = the feed, 2 = a comment, 3 = a reply.
 * The server tells the notification apart by it, so a comment-like sent as type 1
 * notifies the post author instead of the commenter.
 */
async function setLike(
  cookies: Record<string, string>,
  feed: Record<string, unknown>,
  likeKey: unknown,
  likeType: number,
  enable: boolean,
): Promise<Record<string, unknown>> {
  if (typeof likeKey !== "string" || !likeKey) throw new Error("空友点赞目标缺少 like_key");
  const data = await qzonePublicRequest(
    cookies,
    QZONE_INTERACTION_WRITER,
    enable ? "DoLike" : "UnLike",
    enable ? "0x9699_1" : "0x969c_1",
    { ...feedParams(feed), like_key: likeKey, like_type: likeType },
  );
  if (!data["like"]) throw new Error("qzone public like 响应缺少 like");
  return data;
}

/** `setQzonePublicLike` — like the feed, keyed by its own `cur_like_key`. */
export async function setQzonePublicLike(
  cookies: Record<string, string>,
  feed: Record<string, unknown>,
  enable = true,
): Promise<Record<string, unknown>> {
  const common = feed["cell_common"];
  return setLike(cookies, feed, isObject(common) ? common["cur_like_key"] : undefined, 1, enable);
}

/** `setQzonePublicCommentLike` — like a comment (2) or a reply (3). */
export async function setQzonePublicCommentLike(
  cookies: Record<string, string>,
  feed: Record<string, unknown>,
  comment: Record<string, unknown>,
  enable = true,
  reply?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const target = reply ?? comment;
  const like = target["like"];
  return setLike(cookies, feed, isObject(like) ? like["id"] : undefined, reply ? 3 : 2, enable);
}

/** `richContent` — a string becomes one `{type: 0}` part; anything else passes through. */
export function richContent(content: unknown): unknown {
  return typeof content === "string" ? [{ type: 0, content }] : content;
}

/** `commentQzonePublicFeed` — add a comment to a public feed. */
export async function commentQzonePublicFeed(
  cookies: Record<string, string>,
  feed: Record<string, unknown>,
  user: Record<string, unknown>,
  content: unknown,
): Promise<Record<string, unknown>> {
  const data = await qzonePublicRequest(cookies, QZONE_INTERACTION_WRITER, "AddComment", "0x9676_1", {
    ...feedParams(feed),
    comment: { user, content: richContent(content) },
  });
  if (!data["comment"]) throw new Error("qzone public AddComment 响应缺少 comment");
  return data;
}

/**
 * `replyQzonePublicFeed` — reply under a comment.
 *
 * The mention target is `reply.user` when a reply is passed and `comment.user`
 * otherwise: replying to a REPLY mentions that reply's author, not the parent
 * comment's. Using `comment.user` in both cases notifies the wrong person.
 */
export async function replyQzonePublicFeed(
  cookies: Record<string, string>,
  feed: Record<string, unknown>,
  user: Record<string, unknown>,
  comment: Record<string, unknown>,
  content: unknown,
  reply?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const targetUser = reply?.["user"] ?? comment["user"];
  if (!isObject(targetUser)) throw new Error("空友评论或回复缺少 user");
  const data = await qzonePublicRequest(cookies, QZONE_INTERACTION_WRITER, "AddReply", "0x9677_1", {
    ...feedParams(feed),
    comment,
    reply: { content: richContent(content), target_user: targetUser, user },
  });
  if (!data["reply"]) throw new Error("qzone public AddReply 响应缺少 reply");
  return data;
}

/** `deleteQzonePublicComment` — remove a comment. */
export async function deleteQzonePublicComment(
  cookies: Record<string, string>,
  feed: Record<string, unknown>,
  comment: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return qzonePublicRequest(cookies, QZONE_INTERACTION_WRITER, "DeleteComment", "0x9989_0", {
    ...feedParams(feed),
    comment,
  });
}

/** `deleteQzonePublicReply` — remove a reply, addressed by its parent comment. */
export async function deleteQzonePublicReply(
  cookies: Record<string, string>,
  feed: Record<string, unknown>,
  comment: Record<string, unknown>,
  reply: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return qzonePublicRequest(cookies, QZONE_INTERACTION_WRITER, "DeleteReply", "0x998a_0", {
    ...feedParams(feed),
    comment,
    reply,
  });
}

/**
 * `setQzonePublicFollow` — follow/unfollow a feed's author.
 *
 * The uid-or-uin choice is not symmetric and the expression shows it:
 *
 *     useUid = (domain_type === 3 && uid) || !uin
 *
 * A public-account feed (`domain_type === 3`) is addressed by uid when it has one,
 * and ANY feed with no uin falls back to uid. So a uid is used either because the
 * domain demands it or because there is no alternative — but an ordinary uin is
 * preferred over a uid when both exist.
 *
 * `ret_code` is compared against 0 AND "0": the server sends it as a number on
 * some paths and a string on others.
 */
export async function setQzonePublicFollow(
  cookies: Record<string, string>,
  feed: Record<string, unknown>,
  enable = true,
): Promise<Record<string, unknown>> {
  const params = feedParams(feed);
  const common = feed["cell_common"];
  const userInfo = feed["cell_user_info"];
  const user = isObject(userInfo) ? userInfo["user"] : undefined;
  const uid = isObject(user) && typeof user["uid"] === "string" ? user["uid"].trim() : "";
  const uin = isObject(user) && typeof user["uin"] === "string" ? user["uin"].trim() : "";
  const domainType = isObject(common) ? common["domain_type"] : undefined;
  const useUid = (domainType === 3 && !!uid) || !uin;
  if (useUid ? !uid : !uin) throw new Error("空友动态缺少作者 uid/uin");
  const data = await qzonePublicRequest(
    cookies,
    QZONE_PUBLIC_RELATION,
    enable ? "Follow" : "Unfollow",
    enable ? "0x9d1a_1" : "0x9d1b_1",
    {
      follow_from_type: 1,
      ...(useUid ? { target_uid: uid } : { target_uin: uin }),
      ...(typeof params.union_id["uf_key"] === "string" && params.union_id["uf_key"]
        ? { follow_feed_id: params.union_id["uf_key"] }
        : {}),
      ...(feed["cell_feed_transfer"] === undefined ? {} : { cell_feed_transfer: feed["cell_feed_transfer"] }),
    },
  );
  const retCode = data["ret_code"];
  if (retCode !== undefined && retCode !== null && retCode !== 0 && retCode !== "0") {
    throw new Error(`qzone public follow failed: ret_code=${String(retCode)} ${String(data["ret_msg"] ?? "")}`.trim());
  }
  return data;
}

/** `forwardQzonePublicFeed` — 转发 a feed, with an optional reason. */
export async function forwardQzonePublicFeed(
  cookies: Record<string, string>,
  feed: Record<string, unknown>,
  reason = "",
): Promise<Record<string, unknown>> {
  return qzonePublicRequest(cookies, QZONE_FEEDS_WRITER, "ForwardFeed", "0x969a_1", {
    ...feedParams(feed),
    reason,
  });
}

/** Log the module's presence once, so a missing-capability report is greppable. */
log.debug("qzone public surface ready (gotrpc JSON, %d services)", 7);