// `getCollectionList` — the Weiyun collection listing with its pagination walk.
//
// Reference region: ../protocol/src/web/collection.ts, from `positiveUin` through
// `getCollectionList` (reference/index.mjs:42840-4394).
//
// ---------------------------------------------------------------------------
// What the loop actually guarantees
// ---------------------------------------------------------------------------
// Four independent bounds, and each one guards a different failure:
//
//   count         the caller's page size; the walk stops once it has `count`
//                 MATCHING items (or `count + 1` when filtering by category,
//                 so `hasMore` can be answered without a second request)
//   pages         <= 100, so a server that always says "more" cannot spin
//   operationDeadline  60 s wall clock across the WHOLE walk, not per page
//   per-page timeout    10 s, further clipped to whatever is left of the 60 s
//
// The cursor is the lowest `modifyTime` on the page just read, and the loop
// REQUIRES it to strictly decrease. A page that returns the same cursor means the
// server is handing back the same page; without that check the walk would issue
// 100 identical requests and then throw a generic "exceeded pages" error, which
// points at the wrong thing.
//
// ---------------------------------------------------------------------------
// `reachedBottom` reads backwards
// ---------------------------------------------------------------------------
// `serverHasMore = (page.reachedBottom ?? 0) === 0` — ZERO means more data. This
// is the reference's condition and it is not a typo; a non-zero `reachedBottom`
// is the "end of list" marker. Inverting it turns one page into the whole list.
//
// ---------------------------------------------------------------------------
// Dedupe is by `cid`, and it is needed
// ---------------------------------------------------------------------------
// Paging on `modifyTime` can repeat an item whose timestamp sits exactly on the
// boundary. Items are deduped by `cid:<id>` before the category filter, so a
// filtered result counts distinct items rather than delivered ones.
//
// ---------------------------------------------------------------------------
// `count` and `category` validation is strict on purpose
// ---------------------------------------------------------------------------
// A negative or non-safe-integer count would either be silently coerced by the
// server or produce an unbounded port-side allocation; both are worse than an
// error the caller can see.

import {
  COLLECTION_APP_ID,
  COLLECTION_ENDPOINT,
  COLLECTION_HOST,
  COLLECTION_INITIAL_TIMESTAMP,
  COLLECTION_MAX_COUNT,
  COLLECTION_MAX_PAGES,
  COLLECTION_OPERATION_ID,
  COLLECTION_OPERATION_TIMEOUT_MS,
  COLLECTION_PAGE_SIZE,
  COLLECTION_RESPONSE_LIMIT,
  COLLECTION_TICKET_TYPE,
  COLLECTION_TIMEOUT_MS,
  encodeCollectionEnvelope,
  encodeCollectionRequestBody,
  encodeCollectionRequestHead,
  decodeCollectionEnvelope,
  type CollectionItem,
  type GetCollectionListRequest,
} from "./collection-wire.js";

/** One request/response hop. Injectable so the walk can be tested without a network. */
export interface CollectionTransportRequest {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
  timeoutMs: number;
}

export type CollectionTransport = (request: CollectionTransportRequest) => Promise<Uint8Array>;

/** Input to `getCollectionList`. */
export interface GetCollectionListParams {
  uin: string;
  pskey: string;
  category?: number | undefined;
  count?: number | undefined;
  transport?: CollectionTransport | undefined;
}

/** A collection item after `mapItem`: bigints stringified, summaries JSON-safe. */
export interface MappedCollectionItem {
  cid: string;
  type: number;
  status: number;
  author: {
    type: number;
    numId: string;
    strId: string;
    groupId: string;
    groupName: string;
    uid: string;
  };
  bid: number;
  category: number;
  createTime: string;
  collectTime: string;
  modifyTime: string;
  sequence: string;
  shareUrl: string;
  customGroupId: number;
  securityBeat: boolean;
  summary: Record<string, unknown>;
}

/** The OneBot `get_collection_list` payload shape. */
export interface CollectionListResult {
  errCode: number;
  errMsg: string;
  collectionSearchList: {
    collectionItemList: MappedCollectionItem[];
    hasMore: boolean;
    bottomTimeStamp: string;
  };
}

function positiveUin(value: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new Error("collection uin must be a positive integer");
  const uin = BigInt(value);
  if (uin > COLLECTION_INITIAL_TIMESTAMP) throw new Error("collection uin exceeds uint64 range");
  return uin;
}

function positiveCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > COLLECTION_MAX_COUNT) {
    throw new Error(`collection count must be between 1 and ${String(COLLECTION_MAX_COUNT)}`);
  }
  return value;
}

function validCategory(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("collection category must be a non-negative safe integer");
  }
  return value;
}

/** Recursively convert a decoded value into JSON-safe data (bigint → string). */
export function collectionJsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("collection response contains a non-finite number");
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (Array.isArray(value)) return value.map(collectionJsonSafe);
  if (typeof value === "object") {
    // The five summary variants this port keeps structural (see
    // `OpaqueSummary`): hand back their raw bytes as base64 rather than a
    // half-decoded object with invented field names.
    if ("__opaque" in value) {
      return collectionJsonSafe((value as unknown as { bytes: Uint8Array }).bytes);
    }
    const output: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) output[key] = collectionJsonSafe(field);
    return output;
  }
  throw new Error(`collection response contains unsupported value type: ${typeof value}`);
}

/**
 * Wire item → the public item.
 *
 * Every field is given an explicit default rather than left `null`, because the
 * OneBot payload is consumed by clients that do not null-check.
 */
export function mapCollectionItem(item: CollectionItem): MappedCollectionItem {
  const author = item.author ?? { type: null, numId: null, strId: null, groupId: null, groupName: null, uid: null };
  const summary = item.summary;
  const textSummary = summary?.textSummary;
  const richMediaSummary = summary?.richMediaSummary;
  return {
    cid: item.cid ?? "",
    type: item.type ?? 0,
    status: item.status ?? 0,
    author: {
      type: author.type ?? 0,
      numId: (author.numId ?? 0n).toString(),
      strId: author.strId ?? "",
      groupId: (author.groupId ?? 0n).toString(),
      groupName: author.groupName ?? "",
      uid: author.uid ?? "",
    },
    bid: item.bid ?? 0,
    category: item.category ?? 0,
    createTime: (item.createTime ?? 0n).toString(),
    collectTime: (item.collectTime ?? 0n).toString(),
    modifyTime: (item.modifyTime ?? 0n).toString(),
    sequence: (item.sequence ?? 0n).toString(),
    shareUrl: item.shareUrl ?? "",
    customGroupId: item.customGroupId ?? 0,
    securityBeat: item.securityBeat ?? false,
    summary: {
      textSummary: textSummary
        ? { text: textSummary.text ?? "", truncated: textSummary.truncated ?? false }
        : null,
      linkSummary: collectionJsonSafe(summary?.linkSummary ?? null),
      gallerySummary: collectionJsonSafe(summary?.gallerySummary ?? null),
      audioSummary: collectionJsonSafe(summary?.audioSummary ?? null),
      videoSummary: collectionJsonSafe(summary?.videoSummary ?? null),
      fileSummary: collectionJsonSafe(summary?.fileSummary ?? null),
      locationSummary: collectionJsonSafe(summary?.locationSummary ?? null),
      richMediaSummary: richMediaSummary
        ? {
            title: richMediaSummary.title ?? "",
            subTitle: richMediaSummary.subTitle ?? "",
            brief: richMediaSummary.brief ?? "",
            picList: collectionJsonSafe(richMediaSummary.picList ?? []),
            contentType: richMediaSummary.contentType ?? 0,
            originalUri: richMediaSummary.originalUri ?? "",
            publisher: richMediaSummary.publisher ?? "",
            richMediaVersion: richMediaSummary.richMediaVersion ?? 0,
          }
        : null,
    },
  };
}

/**
 * Validate one wire item before mapping it.
 *
 * `modifyTime` is required because it IS the pagination cursor: an item without
 * one would be counted as "matched" and then silently break the next page's
 * cursor computation.
 */
export function validateCollectionItem(item: CollectionItem): void {
  if (!item.cid) throw new Error("collection item is missing cid");
  if (!item.author) throw new Error(`collection item ${item.cid} is missing author`);
  if (item.modifyTime === null || item.modifyTime === undefined || item.modifyTime <= 0n) {
    throw new Error(`collection item ${item.cid} is missing modifyTime`);
  }
}

async function failAfterCleanup(primaryError: Error, cleanup: (() => Promise<void>) | undefined): Promise<never> {
  if (cleanup) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [primaryError, cleanupError],
        `${primaryError.message}; response body cleanup also failed`,
      );
    }
  }
  throw primaryError;
}

/**
 * The default transport: a POST with a hard timeout and a streamed byte cap.
 *
 * The cap is enforced while streaming, not only from `content-length`, because a
 * server may omit the header and the whole point of the limit is to bound our own
 * allocation.
 */
export const defaultCollectionTransport: CollectionTransport = async (request) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: Buffer.from(request.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`collection HTTP request failed: ${String(response.status)} ${response.statusText}`);
      await failAfterCleanup(error, response.body ? async () => response.body?.cancel(error) : undefined);
    }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      if (!/^\d+$/.test(declaredLength)) {
        const error = new Error("collection response has invalid content-length");
        await failAfterCleanup(error, response.body ? async () => response.body?.cancel(error) : undefined);
      }
      if (Number(declaredLength) > COLLECTION_RESPONSE_LIMIT) {
        const error = new Error(`collection response exceeds ${String(COLLECTION_RESPONSE_LIMIT)} bytes`);
        await failAfterCleanup(error, response.body ? async () => response.body?.cancel(error) : undefined);
      }
    }
    if (!response.body) throw new Error("collection HTTP response has no body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > COLLECTION_RESPONSE_LIMIT) {
          const error = new Error(`collection response exceeds ${String(COLLECTION_RESPONSE_LIMIT)} bytes`);
          await failAfterCleanup(error, async () => reader.cancel(error));
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const output = Buffer.allocUnsafe(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`collection HTTP request timed out after ${String(request.timeoutMs)}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * The request bytes for one page.
 *
 * `sequence` starts at 1 and increments per page; `commandType: 1` and the fixed
 * `clientVersion` are constants of this API, and `field14: 8` / `field15: 9` are
 * unlabelled but always present.
 */
export function collectionRequestBytes(
  uin: string,
  pskey: string,
  sequence: number,
  timeStamp: bigint,
): Uint8Array {
  const head = encodeCollectionRequestHead({
    uin: positiveUin(uin),
    sequence,
    commandType: 1,
    operationId: COLLECTION_OPERATION_ID,
    clientVersion: 6_667_389_245_007n,
    platform: 4,
    ticketType: COLLECTION_TICKET_TYPE,
    reserved: 0,
    ticket: pskey,
    field14: 8,
    field15: 9,
  });
  const listRequest: GetCollectionListRequest = {
    field1: 0,
    field2: 0,
    field3: 0,
    timeStamp,
    orderType: 2,
    groupId: 0n,
    count: COLLECTION_PAGE_SIZE,
    searchDown: 1,
    field9: 0,
  };
  return encodeCollectionEnvelope(head, encodeCollectionRequestBody(listRequest));
}

/**
 * Walk the collection list.
 *
 * Note `count` is the number of items the CALLER wants, while
 * `COLLECTION_PAGE_SIZE` (50) is what one request asks for. They are deliberately
 * separate: the walk re-pages until it has enough matching items, and the final
 * result is sliced to `count`.
 */
export async function getCollectionList(params: GetCollectionListParams): Promise<CollectionListResult> {
  const uin = positiveUin(params.uin);
  if (params.pskey === "") throw new Error("collection p_skey is empty");
  const category = validCategory(params.category ?? 0);
  const count = positiveCount(params.count ?? COLLECTION_PAGE_SIZE);
  const targetMatchCount = category === 0 ? count : count + 1;
  const transport = params.transport ?? defaultCollectionTransport;
  const headers = {
    "Content-Type": "application/octet-stream",
    Cookie: `uin=${params.uin};vt=${String(COLLECTION_TICKET_TYPE)};vi=${params.pskey};appid=${String(COLLECTION_APP_ID)}`,
    Host: COLLECTION_HOST,
    Range: "bytes=0-",
  };
  const matched: MappedCollectionItem[] = [];
  const seen = new Set<string>();
  let sequence = 1;
  let timeStamp = COLLECTION_INITIAL_TIMESTAMP;
  let serverHasMore = true;
  let errMsg = "";
  let pages = 0;
  const operationDeadline = Date.now() + COLLECTION_OPERATION_TIMEOUT_MS;
  while (matched.length < targetMatchCount && serverHasMore) {
    if (pages >= COLLECTION_MAX_PAGES) {
      throw new Error(`collection pagination exceeded ${String(COLLECTION_MAX_PAGES)} pages`);
    }
    const remainingMs = operationDeadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`collection pagination exceeded ${String(COLLECTION_OPERATION_TIMEOUT_MS)}ms`);
    }
    pages += 1;
    const responseBytes = await transport({
      url: COLLECTION_ENDPOINT,
      headers,
      body: collectionRequestBytes(params.uin, params.pskey, sequence, timeStamp),
      timeoutMs: Math.min(COLLECTION_TIMEOUT_MS, remainingMs),
    });
    if (Date.now() >= operationDeadline) {
      throw new Error(`collection pagination exceeded ${String(COLLECTION_OPERATION_TIMEOUT_MS)}ms`);
    }
    const response = decodeCollectionEnvelope(responseBytes);
    const retCode = response.head.retCode ?? 0;
    if (retCode !== 0) {
      const message = response.head.retMsg || response.head.promptMsg || "unknown error";
      throw new Error(`collection service error ${String(retCode)}: ${message}`);
    }
    errMsg = response.head.retMsg ?? "";
    const page = response.body.operation;
    if (!page) throw new Error("collection response is missing operation 20000");
    const wireItems = page.items ?? [];
    serverHasMore = (page.reachedBottom ?? 0) === 0;
    let nextTimeStamp: bigint | null = null;
    for (const wireItem of wireItems) {
      validateCollectionItem(wireItem);
      const modifyTime = wireItem.modifyTime ?? 0n;
      if (nextTimeStamp === null || modifyTime < nextTimeStamp) nextTimeStamp = modifyTime;
      const item = mapCollectionItem(wireItem);
      const identity = `cid:${item.cid}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (category === 0 || item.category === category) matched.push(item);
    }
    if (matched.length >= targetMatchCount || !serverHasMore) break;
    if (wireItems.length === 0 || nextTimeStamp === null || nextTimeStamp === 0n) {
      throw new Error("collection pagination made no progress while more data was reported");
    }
    if (nextTimeStamp >= timeStamp) {
      throw new Error(`collection pagination cursor did not decrease: ${nextTimeStamp.toString()}`);
    }
    timeStamp = nextTimeStamp;
    sequence += 1;
  }
  const collectionItemList = matched.slice(0, count);
  let publicBottomTimeStamp = 0n;
  for (const item of collectionItemList) {
    const itemTime = BigInt(item.modifyTime);
    if (publicBottomTimeStamp === 0n || itemTime < publicBottomTimeStamp) publicBottomTimeStamp = itemTime;
  }
  return {
    errCode: 0,
    errMsg,
    collectionSearchList: {
      collectionItemList,
      hasMore:
        category === 0 ? serverHasMore || matched.length > count : matched.length > count,
      bottomTimeStamp: publicBottomTimeStamp.toString(),
    },
  };
}