// `../protocol/src/web/qzone-feed-cursor.ts` (88 lines) — the pagination cursor.
//
// ---------------------------------------------------------------------------
// Why a cursor exists at all
// ---------------------------------------------------------------------------
// The CGI is stateful: each page's continuation lives in eleven fields of the
// previous response, and the legacy API takes a PAGE NUMBER with no way to jump
// straight to page 5 — a caller who wants page 5 must walk 1..5 in one request
// sequence. So a stateless OneBot call has to carry the server's opaque state
// between invocations, which is exactly what this module serialises.
//
// The encoding is base64url over `{version, uin, page, state}`, and the `uin` is
// bound in deliberately: a cursor minted for one account must not be usable
// against another, because the state names server-side cursors that belong to
// the first account's feed.
//
// ---------------------------------------------------------------------------
// Every decode step re-checks instead of trusting
// ---------------------------------------------------------------------------
// The cursor travels through the caller and can be hand-edited. Four
// independent gates:
//
//   1. shape  — non-empty, ≤ 64 KiB, base64url alphabet only;
//   2. canonical — `bytes.toString("base64url") !== cursor` rejects a
//      non-canonical encoding (padding, unused trailing bits), which would
//      otherwise let one state have several textual forms;
//   3. version/uin/page — `version === 1`, the uin matches, `page >= 2`;
//   4. state — exactly eleven keys, all strings, and re-normalising the state
//      must be a FIXED POINT (`fields.some(f => state[f] !== rawState[f])`).
//
// Gate 4 is the interesting one. `nextQzoneFeedState` runs every numeric field
// through `String(Number(value))`, so `"0007"` normalises to `"7"`. Comparing
// the normalised result back against the raw input means the canonical form is
// the only accepted one — otherwise `"1"` and `"01"` would be two cursors for
// the same position and a client could ping-pong between them.
//
// Reference: reference/index.mjs:335635 (`../protocol/src/web/qzone-feed-cursor.ts`).

/** The eight numeric state fields, in wire order. */
export const QZONE_FEED_NUMERIC_FIELDS = [
  "begintime",
  "dayspac",
  "pagenum",
  "aisortEndTime",
  "aisortOffset",
  "aisortBeginTime",
  "aisortNextTime",
  "icServerTime",
] as const;

/** The three string state fields. `uinlist` may legitimately be empty. */
export const QZONE_FEED_STRING_FIELDS = ["externparam", "daylist", "uinlist"] as const;

/** All eleven, in the reference's own order (numeric first). */
export const QZONE_FEED_STATE_FIELDS = [...QZONE_FEED_NUMERIC_FIELDS, ...QZONE_FEED_STRING_FIELDS];

/**
 * The pagination state carried between pages.
 *
 * Every value is a STRING because the server emits `icServerTime` as a string
 * on some responses and as a number on others, and normalising to text means
 * the fixed-point check above has one representation to compare.
 */
export interface QzoneFeedState {
  begintime: string;
  dayspac: string;
  pagenum: string;
  aisortEndTime: string;
  aisortOffset: string;
  aisortBeginTime: string;
  aisortNextTime: string;
  icServerTime: string;
  externparam: string;
  daylist: string;
  uinlist: string;
}

/** A decoded cursor: which page it points at, and the state to resume from. */
export interface DecodedFeedCursor {
  page: number;
  state: QzoneFeedState;
}

/** `initialQzoneFeedState` — all numeric fields `"0"`, `pagenum` `"1"`. */
export function initialQzoneFeedState(): QzoneFeedState {
  return {
    begintime: "0",
    dayspac: "0",
    pagenum: "1",
    aisortEndTime: "0",
    aisortOffset: "0",
    aisortBeginTime: "0",
    aisortNextTime: "0",
    icServerTime: "0",
    externparam: "",
    daylist: "",
    uinlist: "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The refused-field message, shared by both throw sites so they read alike. */
function fieldError(field: string): Error {
  return new Error(`空间好友动态分页字段异常: ${field}`);
}

/**
 * `nextQzoneFeedState` — carry the previous state forward, overwriting only the
 * fields the response actually supplies.
 *
 * `pagenum` gets an extra check (`>= 1`) because it is the one field the client
 * also writes; every other field is the server's to define. A `pagenum: 0` would
 * make the next request re-fetch page 0, which the server reads as page 1 — an
 * infinite first page.
 *
 * `uinlist` is the one string field that OVERWRITES with an empty value
 * (`value === "" && field !== "uinlist"` skips the rest): an empty `uinlist` is
 * how the server says "no more friends in this batch", and carrying the previous
 * non-empty list forward would repeat them.
 */
export function nextQzoneFeedState(
  main: Record<string, unknown>,
  previous: QzoneFeedState,
): QzoneFeedState {
  const next = { ...previous };
  for (const field of QZONE_FEED_NUMERIC_FIELDS) {
    const value = main[field];
    if (value === undefined || value === "") continue;
    const text = String(value);
    if (
      (typeof value !== "number" && typeof value !== "string") ||
      !/^\d+$/.test(text) ||
      !Number.isSafeInteger(Number(text)) ||
      (field === "pagenum" && Number(text) < 1)
    ) {
      throw fieldError(field);
    }
    next[field] = String(Number(text));
  }
  for (const field of QZONE_FEED_STRING_FIELDS) {
    const value = main[field];
    if (value === undefined || (value === "" && field !== "uinlist")) continue;
    if (typeof value !== "string" || value.length > 32_768) throw fieldError(field);
    next[field] = value;
  }
  return next;
}

/**
 * `qzoneFeedPosition` — the part of the state that actually advances.
 *
 * `icServerTime` is excluded on purpose: the server clock changes on every
 * request, so including it would make every page look like progress and a
 * non-advancing cursor would loop forever. What remains is the request-shaped
 * state, and if that is unchanged the cursor is stuck.
 */
export function qzoneFeedPosition(state: QzoneFeedState): string {
  return JSON.stringify(
    QZONE_FEED_STATE_FIELDS.filter((field) => field !== "icServerTime").map((field) => state[field]),
  );
}

/** The largest cursor we will emit or accept, in characters. */
export const QZONE_FEED_CURSOR_MAX_LENGTH = 65_536;

/**
 * `encodeQzoneFeedCursor` — base64url over the canonical JSON.
 *
 * `page < 2` is refused because page 1 has no cursor (it is the default), so a
 * cursor that claims page 1 could only be the result of a caller building one by
 * hand. The 64 KiB guard is against a `daylist` the server let grow unbounded.
 */
export function encodeQzoneFeedCursor(uin: string, page: number, state: QzoneFeedState): string {
  if (!Number.isSafeInteger(page) || page < 2) throw new Error("空间好友动态分页页码超出范围");
  const cursor = Buffer.from(JSON.stringify({ version: 1, uin, page, state })).toString("base64url");
  if (cursor.length > QZONE_FEED_CURSOR_MAX_LENGTH) throw new Error("空间好友动态分页游标过大");
  return cursor;
}

/**
 * `decodeQzoneFeedCursor`.
 *
 * The whole base64url+JSON block is wrapped in one `try` whose `catch` rethrows
 * a single message: a caller passing a mangled cursor should see one diagnostic,
 * not a Node `SyntaxError` about a JSON token offset they cannot act on.
 */
export function decodeQzoneFeedCursor(cursor: string, uin: string): DecodedFeedCursor {
  if (!cursor || cursor.length > QZONE_FEED_CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new Error("无效的空间好友动态 cursor");
  }
  let value: unknown;
  try {
    const bytes = Buffer.from(cursor, "base64url");
    // A non-canonical encoding would let the same position have several textual
    // forms, defeating the equality check `getQzoneFeeds` does on positions.
    if (bytes.toString("base64url") !== cursor) throw new Error("non-canonical encoding");
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("无效的空间好友动态 cursor");
  }
  if (
    !isRecord(value) ||
    value["version"] !== 1 ||
    value["uin"] !== uin ||
    typeof value["page"] !== "number" ||
    !Number.isSafeInteger(value["page"]) ||
    value["page"] < 2 ||
    !isRecord(value["state"])
  ) {
    throw new Error("空间好友动态 cursor 无效或不属于当前账号");
  }
  const rawState = value["state"];
  if (
    Object.keys(rawState).length !== QZONE_FEED_STATE_FIELDS.length ||
    !QZONE_FEED_STATE_FIELDS.every((field) => typeof rawState[field] === "string")
  ) {
    throw new Error("无效的空间好友动态 cursor 状态");
  }
  // Fixed-point check: `nextQzoneFeedState` normalises `"0007"` to `"7"`, so a
  // state that changes under normalisation was not written by the encoder.
  const state = nextQzoneFeedState(rawState, initialQzoneFeedState());
  if (QZONE_FEED_STATE_FIELDS.some((field) => state[field] !== rawState[field])) {
    throw new Error("无效的空间好友动态 cursor 状态");
  }
  return { page: value["page"], state };
}