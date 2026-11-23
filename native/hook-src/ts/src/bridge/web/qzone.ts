// `../protocol/src/web/qzone.ts` (1,072 lines) — the personal Qzone CGI surface:
// 说说 (feeds), likes, comments, replies, permissions, profile and image upload.
//
// ---------------------------------------------------------------------------
// One transport, sixteen endpoints
// ---------------------------------------------------------------------------
// Every function here is `h5.qzone.qq.com/proxy/domain/<origin-host>/cgi-bin/<cgi>`
// over HTTPS with `Cookie:` + `Content-Type: application/x-www-form-urlencoded`
// and `g_tk` in the query. There is no protobuf, no OIDB and no packet channel —
// this module is entirely cookie-backed, which is why it was a natural pair with
// the group-album upload half.
//
// The `g_tk` is `getBknFromCookie`, which prefers `p_skey` over `skey`. Note the
// proxy indirection: the ORIGIN host differs per endpoint (`taotao.qzone.qq.com`,
// `taotao.qq.com`, `w.qzone.qq.com`, `base.qzone.qq.com`, `up.qzone.qq.com`) but
// the URL always starts at `h5.qzone.qq.com/proxy/domain/`. The one exception is
// the image upload, which goes straight to `up.qzone.qq.com`.
//
// ---------------------------------------------------------------------------
// Two parsers, and why there are two
// ---------------------------------------------------------------------------
// `parseQzoneJson` handles the ordinary case: raw JSON, or JSONP wrapped as
// `_Callback({...});`, with three fallback layers.
//
// `parseJsLiteral` handles `feeds3_html_more` specifically. That CGI returns a
// JS OBJECT LITERAL, not JSON: unquoted keys, single-quoted strings, `\xNN`
// escapes and literal `undefined`. It cannot be `JSON.parse`d, and the reference
// deliberately does not `eval` it — a `vm` sandbox is not a security boundary,
// and the payload is remote-controlled. So it is parsed by recursive descent into
// values, which is why it has its own section below.
//
// ---------------------------------------------------------------------------
// `-10000` is a rate limit, not an auth failure
// ---------------------------------------------------------------------------
// `getQzoneMsgList` retries once via a second host pair when it sees `code:
// -10000`. The two routes differ in more than the host: the legacy one asks for
// `format=jsonp` with a `callback` and includes `replynum`/`need_private_comment`,
// while the fallback asks for `format=json` and adds a `Referer`. Both then go
// through the same `parseQzoneJson`, which tolerates either shape. Reproducing
// only one route would make a rate-limited account look broken.
//
// Reference: reference/index.mjs:335723 (`../protocol/src/web/qzone.ts`).

import { createHash } from "node:crypto";

import { createLogger } from "../../onebot/log.js";
import { loadBinarySource } from "./binary-source.js";
import { parseQzoneFeedContent, type QzoneFeedContent } from "./qzone-feed-content.js";
import {
  decodeQzoneFeedCursor,
  encodeQzoneFeedCursor,
  initialQzoneFeedState,
  nextQzoneFeedState,
  qzoneFeedPosition,
  type QzoneFeedState,
} from "./qzone-feed-cursor.js";
import { RequestUtil, cookieToString, getBknFromCookie } from "./request-util.js";

const log = createLogger("Bridge.Web");

/** The `h5.qzone.qq.com` proxy prefix every CGI but the image upload goes through. */
const PROXY = "https://h5.qzone.qq.com/proxy/domain";

// ===========================================================================
// JSON / JSONP parsing
// ===========================================================================

/**
 * `parseQzoneJson` — raw JSON or a JSONP callback wrapper.
 *
 * Three layers because the CGIs disagree. In order:
 *
 *   1. `JSON.parse` from the first `{` to the last `}` — this alone handles both
 *      raw JSON and `_Callback({...});`, because the slice excludes the wrapper.
 *      It fails when the body has trailing junk after the object.
 *   2. The `back({` … `})` pattern, which is the historical shape.
 *   3. `back(` … `);` then the braces inside — which also covers a callback with
 *      a different name whose argument has surrounding whitespace.
 *
 * An HTML error page has no `back(` at all and reaches the `throw`. That is the
 * intended outcome: an anti-bot or login page must not be reported as an empty
 * successful result.
 */
export function parseQzoneJson(text: string): Record<string, unknown> {
  const s = text.trim();
  try {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
    }
  } catch {
    // Fall through to the JSONP shapes.
  }
  try {
    const start = s.indexOf("back({");
    const end = s.lastIndexOf("})");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(s.slice(start + 5, end + 1)) as Record<string, unknown>;
    }
  } catch {
    // Fall through to the unwrapped shape.
  }
  const backStart = s.lastIndexOf("back(");
  if (backStart === -1) throw new Error("invalid response from qzone api");
  const callEnd = s.indexOf(");", backStart);
  if (callEnd === -1) throw new Error("invalid response from qzone api");
  const inner = s.slice(backStart + 5, callEnd).trim();
  const braceStart = inner.indexOf("{");
  const braceEnd = inner.lastIndexOf("}");
  if (braceStart === -1 || braceEnd === -1 || braceEnd < braceStart) {
    throw new Error("invalid response from qzone api");
  }
  return JSON.parse(inner.slice(braceStart, braceEnd + 1)) as Record<string, unknown>;
}

/** The escape-table lookup for `\n`, `\t` and friends. */
const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
};

/**
 * `parseJsLiteral` — parse a JS object literal as DATA, never executing it.
 *
 * `feeds3_html_more` wraps its payload in `_preloadCallback({ … })` where the
 * object uses unquoted keys, single-quoted strings, `\xNN`/`\uNNNN` escapes and
 * literal `undefined`. JSON.parse rejects all four, and the reference's own
 * comment records that no parameter combination makes that CGI emit real JSON.
 *
 * Executing it is not an option: the payload is remote-controlled, and a `vm`
 * context is not a security boundary (a tampered body escapes it to RCE). So this
 * is a recursive descent that can only ever produce a value.
 *
 * The subset covered is exactly what the CGI emits: objects (unquoted or quoted
 * keys), arrays including `undefined` and elided holes, single/double-quoted
 * strings with the JS escape set, numbers, `true`/`false`/`null`/`undefined`.
 * An elided hole becomes `undefined`, so a sparse array keeps its indices rather
 * than collapsing — `mapFeeds` filters `item != null`, which is what makes the
 * gap harmless.
 *
 * `__proto__` keys are DROPPED. Assigning `obj["__proto__"]` on a plain object
 * would set the prototype rather than an own property even in a literal parser,
 * so the drop is not paranoia — it is the only correct way to keep the result a
 * plain data tree.
 */
export function parseJsLiteral(src: string): unknown {
  let i = 0;
  const n = src.length;
  const isWs = (c: string | undefined): boolean =>
    c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
  const skipWs = (): void => {
    while (i < n && isWs(src[i])) i += 1;
  };

  function parseString(quote: string): string {
    i += 1;
    let out = "";
    while (i < n) {
      const c = src[i]!;
      if (c === "\\") {
        const e = src[i + 1];
        if (e === "x") {
          out += String.fromCharCode(Number.parseInt(src.slice(i + 2, i + 4), 16));
          i += 4;
          continue;
        }
        if (e === "u") {
          out += String.fromCharCode(Number.parseInt(src.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        // A line continuation (`\<newline>`) contributes nothing; the reference
        // maps an unknown escape to the character itself, so `\a` is `a`.
        out += e === undefined ? "" : (SIMPLE_ESCAPES[e] ?? e);
        i += 2;
        continue;
      }
      if (c === quote) {
        i += 1;
        return out;
      }
      out += c;
      i += 1;
    }
    throw new Error("unterminated string in qzone feeds payload");
  }

  function parseKey(): string {
    skipWs();
    const c = src[i];
    if (c === '"' || c === "'") return parseString(c);
    let key = "";
    while (i < n && /[A-Za-z0-9_$]/.test(src[i]!)) {
      key += src[i];
      i += 1;
    }
    if (!key) throw new Error("expected object key in qzone feeds payload");
    return key;
  }

  function parseObject(): Record<string, unknown> {
    i += 1;
    const obj: Record<string, unknown> = {};
    skipWs();
    if (src[i] === "}") {
      i += 1;
      return obj;
    }
    for (;;) {
      const key = parseKey();
      skipWs();
      if (src[i] !== ":") throw new Error('expected ":" in qzone feeds payload');
      i += 1;
      const value = parseValue();
      // See the doc comment: an own `__proto__` key is not expressible this way.
      if (key !== "__proto__") obj[key] = value;
      skipWs();
      const ch = src[i];
      if (ch === ",") {
        i += 1;
        skipWs();
        if (src[i] === "}") {
          i += 1;
          return obj;
        }
        continue;
      }
      if (ch === "}") {
        i += 1;
        return obj;
      }
      throw new Error('expected "," or "}" in qzone feeds payload');
    }
  }

  function parseArray(): unknown[] {
    i += 1;
    const arr: unknown[] = [];
    for (;;) {
      skipWs();
      // An elided hole (`[1,,2]`) is a `,` where a value should be. It pushes
      // `undefined` so the following elements keep their indices — collapsing the
      // hole instead would silently shift every later element by one.
      if (src[i] === ",") {
        arr.push(undefined);
        i += 1;
        continue;
      }
      if (src[i] === "]") {
        i += 1;
        return arr;
      }
      arr.push(parseValue());
      skipWs();
      const ch = src[i];
      if (ch === ",") {
        i += 1;
        continue;
      }
      if (ch === "]") {
        i += 1;
        return arr;
      }
      throw new Error('expected "," or "]" in qzone feeds payload');
    }
  }

  function parseValue(): unknown {
    skipWs();
    const c = src[i];
    if (c === undefined) throw new Error("unexpected end of qzone feeds payload");
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"' || c === "'") return parseString(c);
    // A bare token runs to the next structural character. `Number(token)` on
    // something like `0x1f` yields 31, matching JS's own literal semantics; on
    // junk it yields NaN and the handler below rejects.
    let token = "";
    while (i < n && !/[,}\]:\s]/.test(src[i]!)) {
      token += src[i];
      i += 1;
    }
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    if (token === "undefined") return undefined;
    if (token !== "") {
      const num = Number(token);
      if (!Number.isNaN(num)) return num;
    }
    throw new Error(`unexpected token in qzone feeds payload: ${token.slice(0, 20)}`);
  }

  return parseValue();
}

/**
 * `parseQzoneCallback` — the object a feeds JSONP body hands to its callback.
 *
 * Sliced from the first `{` and parsed as one balanced value; a trailing `);` is
 * ignored because the recursive descent simply stops at the closing brace. The
 * result must be an object — a bare array would be a different response than the
 * one expected, and `mapFeeds` would then throw somewhere less informative.
 */
export function parseQzoneCallback(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("invalid feeds response from qzone api");
  const value = parseJsLiteral(text.slice(start));
  if (value === null || typeof value !== "object") throw new Error("invalid feeds response from qzone api");
  return value as Record<string, unknown>;
}

// ===========================================================================
// Rich-parameter and image validation
// ===========================================================================

/**
 * `assertRichParams` — `richType` and `richval` are both-or-neither.
 *
 * The expression in the reference is `richType !== undefined !== (richval !==
 * undefined && richval.trim() !== "")`, which relies on `!==` returning a boolean
 * before the second comparison. It reads as a typo and is not: a present-but-blank
 * `richval` counts as absent, so `richType=1, richval=""` is rejected rather than
 * sent as an image post with no image.
 */
export function assertRichParams(richType: number | undefined, richval: string | undefined): void {
  if (richType !== undefined !== (richval !== undefined && richval.trim() !== "")) {
    throw new Error("richType and richval must be provided together");
  }
  if (richType !== undefined && (!Number.isInteger(richType) || richType < 1)) {
    throw new Error("richType must be a positive integer");
  }
}

/**
 * `normalizeQzoneImageBase64` — validate and canonicalise a base64 image payload.
 *
 * Space becomes `+` because a form-urlencoded body may have delivered the
 * payload that way, and CR/LF/tab are stripped because a PEM-shaped paste
 * carries them. Padding is then stripped and RE-ADDED canonically, which makes
 * the length check meaningful: a remainder of 1 is not a possible base64 length,
 * so it can only be a truncated payload.
 */
export function normalizeQzoneImageBase64(input: string): string {
  let text = input.trim();
  if (/^base64:\/\//i.test(text)) text = text.slice(9).trim();
  if (/^data:/i.test(text)) {
    const comma = text.indexOf(",");
    if (comma === -1) throw new Error("imageBase64 data URI is missing base64 payload");
    text = text.slice(comma + 1);
  }
  const compact = text.replace(/ /g, "+").replace(/[\r\n\t]/g, "");
  if (!compact) throw new Error("imageBase64 is required");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw new Error("imageBase64 is not valid base64");
  const firstPadding = compact.indexOf("=");
  if (firstPadding !== -1 && /[^=]/.test(compact.slice(firstPadding))) {
    throw new Error("imageBase64 is not valid base64");
  }
  const unpadded = compact.replace(/=+$/, "");
  const remainder = unpadded.length % 4;
  if (remainder === 1) throw new Error("imageBase64 is not valid base64");
  const base64 = unpadded + "=".repeat((4 - remainder) % 4);
  if (Buffer.from(base64, "base64").length === 0) throw new Error("imageBase64 is empty");
  return base64;
}

// ===========================================================================
// 说说 list
// ===========================================================================

/** The five visibility rights Qzone accepts. */
export const QZONE_UGC_RIGHTS: ReadonlySet<number> = new Set([1, 4, 16, 64, 128]);

/** `normalizeQzoneUgcRight`. */
export function normalizeQzoneUgcRight(ugcRight: number): number {
  if (!QZONE_UGC_RIGHTS.has(ugcRight)) throw new Error("ugc_right must be one of 1, 4, 16, 64, 128");
  return ugcRight;
}

/**
 * `normalizeTargetUins` — `|`-separated uins, de-duplicated, order preserved.
 *
 * De-duplication matters because the raw string goes into `allow_uins` and a
 * repeated uin makes the server reject the whole request. Order is preserved so
 * a caller's list is not silently reordered in a support conversation.
 */
export function normalizeTargetUins(targetUins: string | undefined): string {
  const raw = (targetUins ?? "").trim();
  if (!raw) return "";
  const seen = new Set<string>();
  for (const part of raw.split("|")) {
    const uin = part.trim();
    if (!uin) continue;
    if (!/^\d+$/.test(uin)) throw new Error("target_uins must contain QQ numbers separated by |");
    seen.add(uin);
  }
  return [...seen].join("|");
}

/** One 说说 as the OneBot-shaped list reports it. */
export interface QzoneMsgSummary {
  tid: string;
  content: string;
  time: number;
  comment_num: number;
  is_private: boolean;
  images: string[];
}

/** A page of 说说. */
export interface QzoneMsgList {
  total: number;
  msglist: QzoneMsgSummary[];
}

/** `pickPicUrl` — the largest variant a feed picture offers. */
export function pickPicUrl(pic: Record<string, unknown>): string | undefined {
  // `url3` is the largest, then `url2`, `url1`, `smallurl`. Empty strings are
  // falsy and fall through, which is why this is `||` and not `??`.
  const url = pic["url3"] || pic["url2"] || pic["url1"] || pic["smallurl"];
  return typeof url === "string" && url !== "" ? url : undefined;
}

/** `mapMsgList` — pure transform from the raw CGI body. */
export function mapMsgList(data: Record<string, unknown>): QzoneMsgList {
  const list = Array.isArray(data["msglist"]) ? (data["msglist"] as Record<string, unknown>[]) : [];
  return {
    total: Number(data["total"] ?? list.length),
    msglist: list.map((entry) => {
      const pics = Array.isArray(entry["pic"]) ? (entry["pic"] as Record<string, unknown>[]) : [];
      return {
        tid: String(entry["tid"] ?? ""),
        content: typeof entry["content"] === "string" ? entry["content"] : "",
        time: Number(entry["created_time"] ?? 0),
        comment_num: Number(entry["cmtnum"] ?? 0),
        is_private: Number(entry["secret"] ?? 0) !== 0,
        images: pics.map(pickPicUrl).filter((url): url is string => url !== undefined),
      };
    }),
  };
}

/** One HTTP route: URL plus the headers the CGI wants. */
export interface QzoneRoute {
  url: string;
  headers: Record<string, string>;
}

/**
 * `legacyMsgListRoute` — the default route.
 *
 * `format=jsonp` with `callback=_preloadCallback` and `replynum=100`; the reply
 * count is fixed at 100 rather than a parameter because the list view does not
 * page comments.
 */
export function legacyMsgListRoute(
  cookieObject: Record<string, string>,
  targetUin: string,
  pos: number,
  num: number,
  bkn: string,
): QzoneRoute {
  return {
    url:
      `${PROXY}/taotao.qzone.qq.com/cgi-bin/emotion_cgi_msglist_v6?` +
      new URLSearchParams({
        uin: targetUin,
        ftype: "0",
        sort: "0",
        pos: String(pos),
        num: String(num),
        replynum: "100",
        g_tk: bkn,
        callback: "_preloadCallback",
        code_version: "1",
        format: "jsonp",
        need_private_comment: "1",
      }).toString(),
    headers: { Cookie: cookieToString(cookieObject) },
  };
}

/**
 * `userMsgListRoute` — the fallback for a `-10000` rate limit.
 *
 * Note the host: `taotao.qq.com`, NOT `taotao.qzone.qq.com`. The reference's
 * live captures show this pair is not rate-limited the same way, which is the
 * only reason it exists. `format=json` here and a `Referer` the legacy route
 * does not send.
 */
export function userMsgListRoute(
  cookieObject: Record<string, string>,
  targetUin: string,
  pos: number,
  num: number,
  bkn: string,
): QzoneRoute {
  return {
    url:
      `${PROXY}/user.qzone.qq.com/cgi-bin/emotion_cgi_msglist_v6?` +
      new URLSearchParams({
        uin: targetUin,
        ftype: "0",
        sort: "0",
        pos: String(pos),
        num: String(num),
        g_tk: bkn,
        code_version: "1",
        format: "json",
      }).toString(),
    headers: {
      Cookie: cookieToString(cookieObject),
      Referer: `https://user.qzone.qq.com/${targetUin}`,
    },
  };
}

/** `QZONE_MSG_LIST_RATE_LIMIT` — the code that triggers the route retry. */
export const QZONE_MSG_LIST_RATE_LIMIT = -10_000;

/**
 * `getQzoneMsgList` — one page of a space's 说说.
 *
 * Errors PROPAGATE rather than becoming an empty list. That distinction is the
 * whole contract: a broken cookie and a genuinely empty space both produce "no
 * posts", and reporting `{total: 0, msglist: []}` for the first makes the failure
 * indistinguishable from success. A real empty space returns `msglist: []` with
 * the correct `total`.
 */
export async function getQzoneMsgList(
  cookieObject: Record<string, string>,
  targetUin: string,
  pos = 0,
  num = 20,
): Promise<QzoneMsgList> {
  const bkn = getBknFromCookie(cookieObject);
  let payload = await requestMsgList(legacyMsgListRoute(cookieObject, targetUin, pos, num, bkn), targetUin);
  if (payload.data["code"] === QZONE_MSG_LIST_RATE_LIMIT) {
    log.warn("getQzoneMsgList: legacy route rate-limited (uin=%s), retrying via user.qzone route", targetUin);
    payload = await requestMsgList(userMsgListRoute(cookieObject, targetUin, pos, num, bkn), targetUin);
  }
  const code = payload.data["code"];
  if (typeof code === "number" && code !== 0) {
    log.warn("getQzoneMsgList: non-zero code (uin=%s) code=%d msg=%s", targetUin, code, payload.data["message"]);
    throw new Error(`qzone msglist failed: code=${String(code)} ${String(payload.data["message"] ?? "")}`.trim());
  }
  if (!Array.isArray(payload.data["msglist"])) {
    // The body head is logged because this is usually a login/anti-bot page and
    // the first 300 characters name which one.
    log.warn(
      "getQzoneMsgList: no msglist in response (uin=%s) — likely auth/cookie failure; body head=%s",
      targetUin,
      payload.text.slice(0, 300),
    );
    throw new Error(`无法获取空间说说列表（响应结构异常）: ${payload.text.slice(0, 200)}`);
  }
  return mapMsgList(payload.data);
}

async function requestMsgList(
  route: QzoneRoute,
  targetUin: string,
): Promise<{ data: Record<string, unknown>; text: string }> {
  const text = await RequestUtil.HttpGetText(route.url, "GET", "", route.headers);
  log.trace("getQzoneMsgList raw body (uin=%s): %s", targetUin, text);
  return { data: parseQzoneJson(text), text };
}

// ===========================================================================
// 好友动态 (feeds)
// ===========================================================================

/** One feed entry: the row metadata plus the extracted content. */
export interface QzoneFeed extends QzoneFeedContent {
  uin: number;
  nickname: string;
  time: number;
  appid: number;
  key: string;
  html: string;
}

/** A page of 好友动态. */
export interface QzoneFeedPage {
  feeds: QzoneFeed[];
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * `feedHasMore` — two different response shapes behind one flag.
 *
 * When `data.data.main` is absent the flag is `data.data.hasmore`; when present
 * it is `main.hasMoreFeeds`. Three truthy and three falsy spellings are accepted
 * (`true`/`1`/`"1"` and `false`/`0`/`"0"`). Anything else THROWS rather than
 * defaulting, because a wrong `has_more: false` silently truncates a caller's
 * view of their own feed.
 */
export function feedHasMore(data: Record<string, unknown>): boolean {
  const inner = data["data"];
  const holder = typeof inner === "object" && inner !== null && !Array.isArray(inner) ? (inner as Record<string, unknown>) : {};
  const value = holder["main"] === undefined ? holder["hasmore"] : (holder["main"] as Record<string, unknown>)["hasMoreFeeds"];
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  throw new Error("空间好友动态缺少有效的分页结束标志");
}

/**
 * `mapFeeds` — pure mapping of one page.
 *
 * Every numeric field is re-validated as a non-negative safe integer: the CGI
 * sends these as strings, and a `Number("")` that slipped through would report a
 * feed at time 0. A malformed ENTRY throws rather than being dropped, because
 * dropping one row shifts every subsequent `index` a caller might be using to
 * address it.
 */
export function mapFeeds(data: Record<string, unknown>): QzoneFeedPage {
  const inner = data["data"];
  const holder = typeof inner === "object" && inner !== null && !Array.isArray(inner) ? (inner as Record<string, unknown>) : {};
  if (!Array.isArray(holder["data"])) throw new Error("无法获取空间好友动态（响应结构异常）");
  return {
    feeds: (holder["data"] as unknown[])
      .filter((item): item is Record<string, unknown> => item !== null && item !== undefined)
      .map((item) => {
        if (typeof item !== "object" || Array.isArray(item)) throw new Error("空间好友动态条目结构异常");
        const entry = item as Record<string, unknown>;
        const base = {
          uin: Number(entry["uin"] ?? 0),
          nickname: typeof entry["nickname"] === "string" ? entry["nickname"] : "",
          time: Number(entry["abstime"] ?? 0),
          appid: Number(entry["appid"] ?? 0),
          key: String(entry["key"] ?? entry["feedskey"] ?? ""),
          html: typeof entry["html"] === "string" ? entry["html"] : "",
        };
        if (
          ![base.uin, base.time, base.appid].every((value) => Number.isSafeInteger(value) && value >= 0) ||
          typeof entry["nickname"] !== "string" ||
          typeof entry["html"] !== "string"
        ) {
          throw new Error("空间好友动态条目字段异常");
        }
        return {
          ...base,
          ...parseQzoneFeedContent(base.html, base.key, base.uin, base.appid, entry["likecnt"], entry["commentcnt"]),
        };
      }),
    has_more: feedHasMore(data),
    next_cursor: null,
  };
}

/** The largest page size the CGI accepts. */
export const QZONE_FEED_MAX_COUNT = 50;

/**
 * `getQzoneFeeds` — walk pages 1..`pageNum` (or resume from a cursor).
 *
 * The CGI's pagination is a chain: page N+1 needs page N's state, and there is no
 * way to ask for page 5 directly. So a `pageNum` request really sends 1..5 in one
 * call, and only the last page is returned. `cursor` exists to avoid re-walking:
 * it carries the state of the page BEFORE the one wanted.
 *
 * Two guards against a non-advancing server:
 *
 *   * `seen` starts with the initial state's position, and after each page the
 *     NEW position is checked against it. A cursor that does not move throws
 *     "分页游标未推进" instead of looping.
 *   * `pageNum !== 1 && pageNum !== start.page` throws when a cursor and an
 *     explicit page disagree — otherwise one of the two would be silently
 *     ignored.
 *
 * `aisortNextTime` is set as `getAisort` and then DELETED from the query, which
 * looks like a bug and is the server's contract: the field must be a query key
 * the client set (`getAisort`) but the CGI reads its own `aisortNextTime` param
 * from the state, and leaving the duplicate in produced a page-1 repeat in the
 * reference's captures.
 */
export async function getQzoneFeeds(
  cookieObject: Record<string, string>,
  selfUin: string,
  pageNum = 1,
  count = 10,
  cursor?: string,
): Promise<QzoneFeedPage> {
  if (!Number.isSafeInteger(pageNum) || pageNum < 1 || !Number.isSafeInteger(count) || count < 1 || count > QZONE_FEED_MAX_COUNT) {
    throw new Error("空间好友动态页码或数量无效");
  }
  const start =
    cursor === undefined
      ? { page: 1, state: initialQzoneFeedState() }
      : decodeQzoneFeedCursor(cursor, selfUin);
  if (cursor !== undefined && pageNum !== 1 && pageNum !== start.page) {
    throw new Error("page_num 与空间好友动态 cursor 不匹配");
  }
  const target = cursor === undefined ? pageNum : start.page;
  const bkn = getBknFromCookie(cookieObject);
  let state: QzoneFeedState = start.state;
  const seen = new Set<string>([qzoneFeedPosition(state)]);
  log.debug("getQzoneFeeds start (uin=%s page=%d count=%d cursor=%s)", selfUin, target, count, cursor !== undefined);

  for (let page = start.page; page <= target; page += 1) {
    const query = new URLSearchParams({
      uin: selfUin,
      scope: "0",
      view: "1",
      gid: "",
      flag: "1",
      filter: "all",
      applist: "all",
      refresh: "0",
      firstGetGroup: "0",
      mixnocache: "0",
      scene: "0",
      sidomain: "qzonestyle.gtimg.cn",
      count: String(count),
      ...state,
      getAisort: state.aisortNextTime,
      g_tk: bkn,
      callback: "_preloadCallback",
      format: "jsonp",
      useutf8: "1",
      outputhtmlfeed: "1",
      usertime: String(Date.now()),
      rd: String(Math.random()),
      windowId: String(Math.random()),
    });
    // See the doc comment: the client-set duplicate must not reach the CGI.
    query.delete("aisortNextTime");
    const url = `${PROXY}/ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more?${query.toString()}`;
    try {
      const data = parseQzoneCallback(
        await RequestUtil.HttpGetText(url, "GET", "", { Cookie: cookieToString(cookieObject) }),
      );
      const code = data["code"];
      const subcode = data["subcode"];
      if (code !== 0 || (subcode !== undefined && subcode !== 0)) {
        const message = typeof data["message"] === "string" ? data["message"] : "";
        throw new Error(`qzone feeds failed: code=${String(code)} subcode=${String(subcode ?? 0)} ${message}`.trim());
      }
      const inner = data["data"];
      const holder = typeof inner === "object" && inner !== null && !Array.isArray(inner) ? (inner as Record<string, unknown>) : {};
      const main = holder["main"];
      if (main !== undefined && (main === null || typeof main !== "object" || Array.isArray(main))) {
        throw new Error("空间好友动态分页信息结构异常");
      }
      const mainRecord = main as Record<string, unknown> | undefined;
      if (mainRecord?.["error"] !== undefined && mainRecord["error"] !== "") {
        throw new Error("空间好友动态服务端报告拉取失败");
      }
      const result = mapFeeds(data);
      if (result.has_more) {
        if (!mainRecord) throw new Error("空间好友动态缺少下一页游标");
        state = nextQzoneFeedState(mainRecord, state);
        const position = qzoneFeedPosition(state);
        if (seen.has(position)) throw new Error("空间好友动态分页游标未推进");
        seen.add(position);
        result.next_cursor = encodeQzoneFeedCursor(selfUin, page + 1, state);
      }
      const unavailable = result.feeds.filter((feed) => feed.appid === 311 && feed.content === null).length;
      if (unavailable) {
        log.warn("getQzoneFeeds content unavailable (uin=%s page=%d entries=%d)", selfUin, page, unavailable);
      }
      log.debug("getQzoneFeeds page (uin=%s page=%d entries=%d more=%s)", selfUin, page, result.feeds.length, result.has_more);
      if (page === target) return result;
      if (!result.has_more) return { feeds: [], has_more: false, next_cursor: null };
    } catch (error) {
      log.warn("getQzoneFeeds failed (uin=%s page=%d): %s", selfUin, page, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  throw new Error("空间好友动态分页未完成");
}

// ===========================================================================
// publish / delete / like
// ===========================================================================

/** A published 说说's identity. */
export interface PublishedQzoneMsg {
  tid: string;
  time: number;
}

/**
 * `publishQzoneMsg` — post a 说说 to the bot's own space.
 *
 * `hostuin` is the bot, never a target: Qzone can publish to a friend's space via
 * this CGI, and that is deliberately not exposed — a OneBot caller doing it would
 * be posting as the bot on someone else's wall.
 *
 * Three failure modes are separated on purpose:
 *   * a non-zero `code` is the server's own rejection (content filter, rate
 *     limit) and carries a `message`;
 *   * a success body WITHOUT a `tid` is the ambiguous case — the reference's
 *     comment records that the post is "likely rejected" — and it throws rather
 *     than reporting a publish with no id, because a caller would then be unable
 *     to delete or address what it just created.
 */
export async function publishQzoneMsg(
  cookieObject: Record<string, string>,
  hostUin: string,
  content: string,
  richType: number | undefined,
  richval: string | undefined,
  ugcRight = 1,
  targetUins?: string,
): Promise<PublishedQzoneMsg> {
  if (!content) throw new Error("content is required");
  assertRichParams(richType, richval);
  const right = normalizeQzoneUgcRight(ugcRight);
  const effectiveTargetUins = right === 16 || right === 128 ? normalizeTargetUins(targetUins) : "";
  if ((right === 16 || right === 128) && !effectiveTargetUins) {
    throw new Error("target_uins is required when ugc_right is 16 or 128");
  }
  const url = `${PROXY}/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6?g_tk=${getBknFromCookie(cookieObject)}`;
  const bodyParams = new URLSearchParams({
    syn_tweet_verson: "1",
    paramstr: "1",
    pic_template: "",
    richtype: richType !== undefined ? String(richType) : "",
    richval: richval ?? "",
    special_url: "",
    subrichtype: "",
    con: content,
    feedversion: "1",
    ver: "1",
    ugc_right: String(right),
    to_sign: "0",
    who: "1",
    hostuin: hostUin,
    code_version: "1",
    format: "json",
    qzreferrer: `https://user.qzone.qq.com/${hostUin}`,
  });
  if (effectiveTargetUins) bodyParams.set("allow_uins", effectiveTargetUins);
  const data = parseQzoneJson(
    await RequestUtil.HttpGetText(url, "POST", bodyParams.toString(), {
      Cookie: cookieToString(cookieObject),
      "Content-Type": "application/x-www-form-urlencoded",
    }),
  );
  const code = data["code"];
  if (typeof code === "number" && code !== 0) {
    log.warn("publishQzoneMsg: non-zero code (uin=%s) code=%d msg=%s", hostUin, code, data["message"]);
    throw new Error(`qzone publish failed: code=${String(code)} ${String(data["message"] ?? "")}`.trim());
  }
  const tid = data["t1_tid"] ?? data["tid"];
  if (!tid) {
    log.warn("publishQzoneMsg: no tid in response (uin=%s) — publish likely rejected", hostUin);
    throw new Error("发表说说失败：响应缺少 tid");
  }
  return { tid: String(tid), time: Number(data["t1_time"] ?? data["now"] ?? 0) };
}

/**
 * `deleteQzoneMsg` — delete one of the bot's OWN 说说 by tid.
 *
 * Only the bot's own feeds can be deleted; the server rejects a tid the `hostUin`
 * does not own, which is why there is no `targetUin` parameter to get wrong.
 */
export async function deleteQzoneMsg(
  cookieObject: Record<string, string>,
  hostUin: string,
  tid: string,
): Promise<void> {
  if (!tid) throw new Error("tid is required");
  const url = `${PROXY}/taotao.qzone.qq.com/cgi-bin/emotion_cgi_delete_v6?g_tk=${getBknFromCookie(cookieObject)}`;
  const body = new URLSearchParams({
    hostuin: hostUin,
    tid,
    t1_source: "1",
    code_version: "1",
    format: "fs",
    qzreferrer: `https://user.qzone.qq.com/${hostUin}`,
  }).toString();
  const data = parseQzoneJson(
    await RequestUtil.HttpGetText(url, "POST", body, {
      Cookie: cookieToString(cookieObject),
      "Content-Type": "application/x-www-form-urlencoded",
    }),
  );
  // Both a code and a subcode are reported, unlike most call sites here: the
  // delete CGI answers a foreign tid with `code: 0, subcode: -3000`.
  const code = data["code"];
  if (typeof code === "number" && code !== 0) {
    log.warn("deleteQzoneMsg: non-zero code (uin=%s tid=%s) code=%d msg=%s", hostUin, tid, code, data["message"]);
    throw new Error(`qzone delete failed: code=${String(code)} ${String(data["message"] ?? "")}`.trim());
  }
  const subcode = data["subcode"];
  if (typeof subcode === "number" && subcode !== 0) {
    log.warn("deleteQzoneMsg: non-zero subcode (uin=%s tid=%s) subcode=%d msg=%s", hostUin, tid, subcode, data["message"]);
    throw new Error(`qzone delete failed: subcode=${String(subcode)} ${String(data["message"] ?? "")}`.trim());
  }
}

/**
 * `setQzoneLike` — like or unlike a 说说 on `targetUin`'s wall, as the bot.
 *
 * The `unikey`/`curkey` pair is the same value twice. That is not a copy-paste
 * slip: `unikey` addresses the mood, `curkey` addresses the like action on it,
 * and the CGI expects both spellings of the same URL.
 *
 * `abstime` is the target feed's post time in seconds. A wrong value does not
 * fail the request but does change the notification the author receives, so the
 * default of 0 is a tolerated fallback rather than a good value.
 */
export async function setQzoneLike(
  cookieObject: Record<string, string>,
  opUin: string,
  targetUin: string,
  tid: string,
  like: boolean,
  abstime = 0,
): Promise<void> {
  if (!tid) throw new Error("tid is required");
  const bkn = getBknFromCookie(cookieObject);
  const verb = like ? "like" : "unlike";
  const action = like ? "internal_dolike_app" : "internal_unlike_app";
  const url = `${PROXY}/w.qzone.qq.com/cgi-bin/likes/${action}?g_tk=${bkn}`;
  const unikey = `http://user.qzone.qq.com/${targetUin}/mood/${tid}`;
  const body = new URLSearchParams({
    qzreferrer: `https://user.qzone.qq.com/${opUin}`,
    opuin: opUin,
    unikey,
    curkey: unikey,
    appid: "311",
    typeid: "0",
    abstime: String(abstime),
    fid: tid,
    from: "1",
    active: "0",
    fupdate: "1",
    format: "json",
  }).toString();
  const data = parseQzoneJson(
    await RequestUtil.HttpGetText(url, "POST", body, {
      Cookie: cookieToString(cookieObject),
      "Content-Type": "application/x-www-form-urlencoded",
    }),
  );
  const code = data["code"];
  if (typeof code === "number" && code !== 0) {
    log.warn("setQzoneLike(%s): non-zero code (tid=%s) code=%d msg=%s", verb, tid, code, data["message"]);
    throw new Error(`qzone ${verb} failed: code=${String(code)} ${String(data["message"] ?? "")}`.trim());
  }
  const subcode = data["subcode"];
  if (typeof subcode === "number" && subcode !== 0) {
    log.warn("setQzoneLike(%s): non-zero subcode (tid=%s) subcode=%d msg=%s", verb, tid, subcode, data["message"]);
    throw new Error(`qzone ${verb} failed: subcode=${String(subcode)} ${String(data["message"] ?? "")}`.trim());
  }
}

// ===========================================================================
// Image upload
// ===========================================================================

/** What `uploadQzoneImage` returns; `richval` is the publish-side token. */
export interface QzoneUploadedImage {
  richval: string;
  url: string;
  albumid: string;
  lloc: string;
  type: number;
  width: number;
  height: number;
}

/**
 * `uploadQzoneImage` — upload base64 image bytes to Qzone hosting.
 *
 * This is the ONE endpoint that goes to `up.qzone.qq.com` directly rather than
 * through the `h5.qzone.qq.com` proxy, because it is the photo service's own
 * upload host. The response is JSONP wrapped with the callback name `callback`,
 * and the wrapper is re-anchored (`jsonText.slice(indexOf("callback"))`) before
 * parsing because the body starts with a `<script>`-ish preamble.
 *
 * The `richval` format is fixed by the publish CGI:
 *
 *     ,<albumid>,<lloc>,<lloc>,<type>,<height>,<width>,,<height>,<width>
 *
 * Note the SLOC equals the LLOC (there is no separate "small" id), the two empty
 * slots, and that height precedes width twice — reversing them produces a post
 * whose image is the wrong shape, with no error from the server.
 *
 * `backUrls` doubles the `g_tk`-bearing URL after a comma-separated host list;
 * that is the upload service's `output_type=jsonhtml` retry protocol.
 */
export async function uploadQzoneImage(
  cookieObject: Record<string, string>,
  hostUin: string,
  imageBase64: string,
): Promise<QzoneUploadedImage> {
  if (!imageBase64) throw new Error("imageBase64 is required");
  const base64 = normalizeQzoneImageBase64(imageBase64);
  const skey = cookieObject["skey"] || "";
  const pskey = cookieObject["p_skey"] || "";
  const bkn = getBknFromCookie(cookieObject);
  const url = `https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image?g_tk=${bkn}`;
  const body = new URLSearchParams({
    filename: "filename",
    uin: hostUin,
    skey,
    zzpaneluin: hostUin,
    p_uin: hostUin,
    p_skey: pskey,
    uploadtype: "1",
    albumtype: "7",
    exttype: "0",
    refer: "shuoshuo",
    output_type: "jsonhtml",
    charset: "utf-8",
    output_charset: "utf-8",
    upload_hd: "1",
    hd_width: "2048",
    hd_height: "10000",
    hd_quality: "96",
    backUrls:
      "http://upbak.photo.qzone.qq.com/cgi-bin/upload/cgi_upload_image," +
      `http://119.147.64.75/cgi-bin/upload/cgi_upload_image&url=https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image?g_tk=${bkn}`,
    base64: "1",
    jsonhtml_callback: "callback",
    picfile: base64,
    qzreferrer: `https://user.qzone.qq.com/${hostUin}/main`,
  }).toString();
  let jsonText = (
    await RequestUtil.HttpGetText(url, "POST", body, {
      Cookie: cookieToString(cookieObject),
      "Content-Type": "application/x-www-form-urlencoded",
    })
  ).trim();
  const callbackStart = jsonText.indexOf("callback");
  if (callbackStart !== -1) jsonText = jsonText.slice(callbackStart);
  const data = parseQzoneJson(jsonText);
  const code = data["code"];
  if (typeof code === "number" && code !== 0) {
    log.warn("uploadQzoneImage: non-zero code (uin=%s) code=%d msg=%s", hostUin, code, data["message"]);
    throw new Error(`qzone upload image failed: code=${String(code)} ${String(data["message"] ?? "")}`.trim());
  }
  const subcode = data["subcode"];
  if (typeof subcode === "number" && subcode !== 0) {
    log.warn("uploadQzoneImage: non-zero subcode (uin=%s) subcode=%d msg=%s", hostUin, subcode, data["message"]);
    throw new Error(`qzone upload image failed: subcode=${String(subcode)} ${String(data["message"] ?? "")}`.trim());
  }
  const inner = data["data"];
  const payload = typeof inner === "object" && inner !== null && !Array.isArray(inner) ? (inner as Record<string, unknown>) : undefined;
  if (!payload?.["albumid"] || !payload["lloc"] || !payload["url"]) {
    log.warn("uploadQzoneImage: missing required fields in response (uin=%s)", hostUin);
    throw new Error("上传图片失败:响应缺少必要字段");
  }
  const albumid = String(payload["albumid"]);
  const lloc = String(payload["lloc"]);
  const imageUrl = String(payload["url"]);
  const type = Number(payload["type"] ?? 0);
  const height = Number(payload["height"] ?? 0);
  const width = Number(payload["width"] ?? 0);
  return {
    richval: `,${albumid},${lloc},${lloc},${String(type)},${String(height)},${String(width)},,${String(height)},${String(width)}`,
    url: imageUrl,
    albumid,
    lloc,
    type,
    width,
    height,
  };
}

/**
 * `uploadQzoneImageFromSource` — accept `file://`, `http(s)://` or `base64://`.
 *
 * The `base64://` case is passed through WITHOUT decoding and re-encoding (a
 * round-trip that would cost memory for no benefit); the other two go through
 * `loadBinarySource`, which handles the local-file and download cases.
 */
export async function uploadQzoneImageFromSource(
  cookieObject: Record<string, string>,
  hostUin: string,
  source: string,
): Promise<QzoneUploadedImage> {
  if (/^base64:\/\//i.test(source)) return uploadQzoneImage(cookieObject, hostUin, source);
  const loaded = await loadBinarySource(source, "qzone-image");
  return uploadQzoneImage(cookieObject, hostUin, Buffer.from(loaded.bytes).toString("base64"));
}

// ===========================================================================
// comment / reply
// ===========================================================================

/** A comment's id; empty when the server did not report one. */
export interface QzoneCommentResult {
  comment_id: string;
}

/**
 * `commentQzoneMsg` — comment on a 说说.
 *
 * `topicId` is `` `${hostUin}_${tid}__1` `` — the DOUBLE trailing underscore is
 * the CGI's own convention (the empty segment before the `1` is the reply id slot,
 * which is empty for a top-level comment). Building it as `${hostUin}_${tid}` and
 * appending `_1` gives a different string and silently comments on nothing.
 *
 * The returned id is best-effort: `data.commentid` is absent in some successful
 * responses, and the reference reports `""` rather than failing a comment that
 * was in fact posted.
 */
export async function commentQzoneMsg(
  cookieObject: Record<string, string>,
  selfUin: string,
  hostUin: string,
  tid: string,
  content: string,
  richType?: number,
  richval?: string,
): Promise<QzoneCommentResult> {
  if (!tid) throw new Error("tid is required");
  if (!content) throw new Error("content is required");
  assertRichParams(richType, richval);
  const url = `${PROXY}/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds?g_tk=${getBknFromCookie(cookieObject)}`;
  const body = new URLSearchParams({
    qzreferrer: `https://user.qzone.qq.com/${selfUin}`,
    inCharset: "utf-8",
    outCharset: "utf-8",
    hostUin,
    format: "json",
    ref: "feeds",
    topicId: `${hostUin}_${tid}__1`,
    feedsType: "100",
    private: "0",
    paramstr: "1",
    richtype: richType !== undefined ? String(richType) : "",
    richval: richval ?? "",
    isSignIn: "",
    uin: selfUin,
    content,
    plat: "qzone",
    source: "ic",
    platformid: "52",
  }).toString();
  const data = parseQzoneJson(
    await RequestUtil.HttpGetText(url, "POST", body, {
      Cookie: cookieToString(cookieObject),
      "Content-Type": "application/x-www-form-urlencoded",
    }),
  );
  const code = data["code"];
  if (typeof code === "number" && code !== 0) {
    log.warn("commentQzoneMsg: non-zero code (host=%s tid=%s) code=%d msg=%s", hostUin, tid, code, data["message"]);
    throw new Error(`qzone comment failed: code=${String(code)} ${String(data["message"] ?? "")}`.trim());
  }
  const subcode = data["subcode"];
  if (typeof subcode === "number" && subcode !== 0) {
    log.warn("commentQzoneMsg: non-zero subcode (host=%s tid=%s) subcode=%d msg=%s", hostUin, tid, subcode, data["message"]);
    throw new Error(`qzone comment failed: subcode=${String(subcode)} ${String(data["message"] ?? "")}`.trim());
  }
  const commentId = data["commentid"] ?? data["commentId"];
  return { comment_id: commentId !== undefined ? String(commentId) : "" };
}

/** The parent comment a reply hangs off, plus the optional author to mention. */
export interface QzoneReplyTarget {
  commentId: string;
  commentUin: string;
  replyTo?: { uin: string; name: string };
}

/** A posted reply's identity, plus its parent's. */
export interface QzoneReplyResult {
  comment_id: string;
  parent_comment_id: string;
  parent_comment_uin: number;
}

/**
 * `replyQzoneComment` — reply inside an existing comment thread.
 *
 * This is a DIFFERENT endpoint from commenting (`emotion_cgi_addreply_ugc`), not
 * a nesting flag on the comment one, and its `topicId` has no `__1` suffix.
 *
 * Images are unsupported here by the CGI's own contract, which is why
 * `QzodeApi.comment` refuses a `reply` combined with `richType`/`richval`.
 *
 * The mention is built into the CONTENT rather than sent as a reply field —
 * there is no such field — so the escaping is load-bearing: `%`, `,` and `}` are
 * percent-encoded because the `@{uin:N,nick:NAME,auto:1}` token is parsed by the
 * client, and a comma in a nickname would otherwise terminate the token early and
 * leave the rest as visible text.
 *
 * Response validation is unusually strict (integer `code`, integer-or-absent
 * `subcode`, non-empty string or non-negative integer id) because a reply is the
 * one write here with no idempotency: retrying a request whose outcome is unknown
 * posts the reply twice, so the error text tells the caller to check delivery
 * before retrying rather than implying a clean failure.
 */
export async function replyQzoneComment(
  cookieObject: Record<string, string>,
  selfUin: string,
  hostUin: string,
  tid: string,
  content: string,
  target: QzoneReplyTarget,
): Promise<QzoneReplyResult> {
  for (const [field, value] of Object.entries({ selfUin, hostUin, commentUin: target.commentUin })) {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new Error(`${field} must be a positive safe integer`);
    }
  }
  if (!tid.trim() || !content.trim() || !target.commentId.trim()) {
    throw new Error("tid, content and commentId must not be blank");
  }
  let replyContent = content;
  if (target.replyTo !== undefined) {
    const { uin, name } = target.replyTo;
    if (!/^[1-9]\d*$/.test(uin) || !Number.isSafeInteger(Number(uin)) || !name.trim()) {
      throw new Error("replyTo requires a positive safe integer uin and a non-blank name");
    }
    const escaped = name.trim().replace(/%/g, "%25").replace(/,/g, "%2C").replace(/}/g, "%7D");
    replyContent = `@{uin:${uin},nick:${escaped},auto:1} ${content}`;
  }
  const url = `${PROXY}/taotao.qzone.qq.com/cgi-bin/emotion_cgi_addreply_ugc?g_tk=${getBknFromCookie(cookieObject)}`;
  const body = new URLSearchParams({
    uin: selfUin,
    hostUin,
    // Two spellings, and they carry OPPOSITE values: `hostUin` is the wall owner,
    // `hostuin` is the actor. Dropping either makes the CGI answer `code: 0` while
    // posting the reply in the wrong space.
    hostuin: selfUin,
    topicId: `${hostUin}_${tid}`,
    commentId: target.commentId,
    commentUin: target.commentUin,
    content: replyContent,
    inCharset: "utf-8",
    outCharset: "utf-8",
    ref: "",
    code_version: "1",
    format: "fs",
    qzreferrer: `https://user.qzone.qq.com/${hostUin}`,
  }).toString();
  log.debug("replyQzoneComment: posting reply (host=%s tid=%s parent=%s)", hostUin, tid, target.commentId);
  const response = parseQzoneJson(
    await RequestUtil.HttpGetText(url, "POST", body, {
      Cookie: cookieToString(cookieObject),
      "Content-Type": "application/x-www-form-urlencoded",
    }),
  );
  if (!("code" in response) || typeof response["code"] !== "number" || !Number.isInteger(response["code"])) {
    throw new Error("invalid qzone reply response: missing or invalid code; check delivery before retrying");
  }
  const subcode = "subcode" in response ? response["subcode"] : undefined;
  if (subcode !== undefined && (typeof subcode !== "number" || !Number.isInteger(subcode))) {
    throw new Error("invalid qzone reply response: invalid subcode; check delivery before retrying");
  }
  const code = response["code"];
  if (code !== 0 || (subcode !== undefined && subcode !== 0)) {
    const message = typeof response["message"] === "string" ? response["message"] : "";
    log.warn("replyQzoneComment: rejected (host=%s tid=%s parent=%s) code=%s subcode=%s", hostUin, tid, target.commentId, code, subcode);
    throw new Error(`qzone reply failed: code=${String(code)} subcode=${String(subcode ?? 0)} ${message}`.trim());
  }
  const inner = response["data"];
  const id =
    inner !== null && typeof inner === "object" && !Array.isArray(inner) ? (inner as Record<string, unknown>)["id"] : undefined;
  const validId =
    (typeof id === "string" && id.trim() !== "") ||
    (typeof id === "number" && Number.isSafeInteger(id) && id >= 0);
  if (!validId) throw new Error("qzone reply accepted but returned an invalid reply ID; check delivery before retrying");
  log.debug("replyQzoneComment: accepted (host=%s tid=%s parent=%s reply=%s)", hostUin, tid, target.commentId, id);
  return {
    comment_id: String(id),
    parent_comment_id: target.commentId,
    parent_comment_uin: Number(target.commentUin),
  };
}

// ===========================================================================
// 说说 detail
// ===========================================================================

/** One comment, with its inline replies. */
export interface QzoneComment {
  comment_id: string;
  uin: number;
  name: string;
  time: number;
  content: string;
  parent_comment_id?: string;
  parent_comment_uin?: number;
}

/** A post and a page of its comments. */
export interface QzoneMsgDetail {
  tid: string;
  content: string;
  comment_num: number;
  comments: QzoneComment[];
}

function detailObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid qzone msg detail: ${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function detailString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`invalid qzone msg detail: ${field} must be a string`);
  return value;
}

/**
 * `detailInteger` — a non-negative integer from a number OR a digit string.
 *
 * The CGI sends `cmtnum` as a string on some responses and a number on others;
 * accepting only one shape would break on half the accounts.
 */
function detailInteger(value: unknown, field: string, min = 0): number {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < min) {
    throw new Error(`invalid qzone msg detail: ${field} must be an integer >= ${String(min)}`);
  }
  return number;
}

function detailList(value: unknown, field: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`invalid qzone msg detail: ${field} must be an array`);
  return value;
}

function mapQzoneComment(value: Record<string, unknown>, field: string): QzoneComment {
  const rawTid = value["tid"];
  const id = typeof rawTid === "number" ? String(detailInteger(rawTid, `${field}.tid`)) : detailString(rawTid, `${field}.tid`);
  if (!id) throw new Error(`invalid qzone msg detail: ${field}.tid is empty`);
  return {
    comment_id: id,
    uin: detailInteger(value["uin"], `${field}.uin`, 1),
    name: detailString(value["name"], `${field}.name`),
    time: detailInteger(value["create_time"], `${field}.create_time`),
    content: detailString(value["content"], `${field}.content`),
  };
}

/**
 * `buildQzoneUpdatePayload` — rebuild a full `emotion_cgi_update` body from a
 * `msgdetail_v6` response.
 *
 * `emotion_cgi_update` cannot change a permission alone; it replaces the whole
 * post, so the body has to carry the content, the richval strings and the `pic_bo`
 * token list back verbatim. Reconstructing them is what makes a permission change
 * possible without an edit.
 *
 * The two reconstruction rules that matter:
 *
 *   * `richval` is rebuilt from `pic[].pic_id`, which is itself a comma-joined
 *     record: `,albumid,lloc,sloc,type,height,width,,0,0`. Indices 1 and 2 are the
 *     album and the lloc; a `pic_id` without them is unusable and throws rather
 *     than producing a post with a broken image reference.
 *   * `pic_bo` comes from the `bo=` query parameter of any picture URL variant,
 *     and the reference TAB-DOUBLES it. A single copy is ignored by the update
 *     CGI, which then re-derives permissions from scratch.
 */
export function buildQzoneUpdatePayload(detail: Record<string, unknown>, selfUin: string): URLSearchParams {
  if (!detail["tid"]) throw new Error("qzone msg detail is missing tid");
  const pics = Array.isArray(detail["pic"]) ? (detail["pic"] as Record<string, unknown>[]) : [];
  const richtype =
    detail["richtype"] !== undefined ? Number(detail["richtype"]) : pics.length === 0 ? "" : 1;
  const richvals: string[] = [];
  const picBoItems: string[] = [];
  for (const pic of pics) {
    const picId = String(pic["pic_id"] ?? "");
    if (!picId) continue;
    const parts = picId.split(",");
    const albumId = parts[1] ?? "";
    const lloc = parts[2] ?? "";
    if (!albumId || !lloc) throw new Error("qzone msg detail has unsupported pic info");
    const picType = String(pic["pictype"] ?? pic["type"] ?? 22);
    const height = String(pic["height"] ?? pic["b_height"] ?? 0);
    const width = String(pic["width"] ?? pic["b_width"] ?? 0);
    richvals.push(`,${albumId},${lloc},${lloc},${picType},${height},${width},,0,0`);
    for (const urlKey of ["smallurl", "url1", "url2", "url3"]) {
      const picUrl = pic[urlKey];
      if (typeof picUrl !== "string" || !picUrl) continue;
      const match = /[?&]bo=([^&#]+)/.exec(picUrl);
      if (match?.[1] !== undefined) {
        picBoItems.push(decodeURIComponent(match[1]));
        // First variant that carries a `bo=` wins; the variants are the same
        // photo at different sizes and share one token.
        break;
      }
    }
  }
  if (richtype === 1 && richvals.length === 0) throw new Error("qzone image post detail is missing pic info");
  let content = typeof detail["content"] === "string" ? detail["content"] : "";
  const conParts = (Array.isArray(detail["conlist"]) ? (detail["conlist"] as Record<string, unknown>[]) : [])
    .map((part) => part["con"])
    .filter((part): part is string => typeof part === "string");
  if (conParts.length > 0) content = conParts.join("").trim();
  const subrichtype = detail["t1_subtype"] ?? detail["subrichtype"] ?? (richvals.length === 0 ? "" : 1);
  const boGroup = picBoItems.join(",");
  const picBo = boGroup ? `${boGroup}\t${boGroup}` : "";
  const hostuin = String(detail["uin"] ?? selfUin);
  const params = new URLSearchParams({
    syn_tweet_verson: "1",
    tid: String(detail["tid"]),
    paramstr: "1",
    pic_template: typeof detail["pic_template"] === "string" ? detail["pic_template"] : "",
    richtype: String(richtype),
    richval: richvals.length > 0 ? richvals.join("\t") : typeof detail["richval"] === "string" ? detail["richval"] : "",
    special_url: typeof detail["special_url"] === "string" ? detail["special_url"] : "",
    subrichtype: String(subrichtype),
    pic_bo: picBo,
    con: content,
    feedversion: String(detail["feedversion"] ?? 1),
    ver: String(detail["ver"] ?? 1),
    ugc_right: String(Number(detail["ugc_right"] ?? 1)),
    to_sign: String(Number(detail["to_sign"] ?? 0)),
    ugcright_id: String(detail["ugcright_id"] ?? detail["tid"]),
    hostuin,
    code_version: String(detail["code_version"] ?? 1),
    format: "fs",
    qzreferrer: `https://user.qzone.qq.com/${hostuin}`,
  });
  return params;
}

/**
 * `fetchQzoneMsgDetail` — the raw detail body, shared by the reader and the
 * permission update.
 *
 * `need_right=1` is required by the updater (it returns `ugc_right` and
 * `ugcright_id`) and harmless to the reader; `not_trunc_con=1` keeps a long post
 * from being abbreviated, which matters because the updater would otherwise write
 * the truncation back.
 *
 * The failure code is derived as `data.code !== 0 ? data.code : data.subcode ??
 * data.code ?? -1`. That reads oddly and is deliberate: this CGI reports a
 * legitimate "unknown tid" as `subcode: -3000` with NO `code`, so a `code ?? 0`
 * default would treat it as success.
 */
export async function fetchQzoneMsgDetail(
  cookieObject: Record<string, string>,
  targetUin: string,
  tid: string,
  page?: { pos: number; num: number },
): Promise<Record<string, unknown>> {
  const bkn = getBknFromCookie(cookieObject);
  const query = new URLSearchParams({
    tid,
    uin: targetUin,
    t1_source: "1",
    not_trunc_con: "1",
    need_right: "1",
    not_adapt_outpic: "1",
    g_tk: bkn,
    ...(page ? { pos: String(page.pos), num: String(page.num) } : {}),
  });
  const url = `${PROXY}/taotao.qq.com/cgi-bin/emotion_cgi_msgdetail_v6?${query.toString()}`;
  const data = parseQzoneJson(
    await RequestUtil.HttpGetText(url, "GET", "", { Cookie: cookieToString(cookieObject) }),
  );
  detailObject(data, "response");
  const code = data["code"] !== undefined && data["code"] !== 0 ? data["code"] : (data["subcode"] ?? data["code"] ?? -1);
  if (code !== 0) {
    log.warn("getQzoneMsgDetail: non-zero code (tid=%s) code=%s msg=%s", tid, String(code), data["message"] ?? data["msg"]);
    throw new Error(`qzone msg detail failed: code=${String(code)} ${String(data["message"] ?? data["msg"] ?? "")}`.trim());
  }
  return data;
}

/**
 * `getQzoneMsgDetail` — one post plus a page of comments with inline replies.
 *
 * Every field is type-checked and a mismatch THROWS. The alternative — coercing
 * a malformed body into an empty comment list — would report a broken response as
 * a post with no comments, which is indistinguishable from the truth.
 *
 * The `tid` echo is checked against the request: the CGI has been observed
 * answering a different post's detail, and returning it would let a caller delete
 * or comment on the wrong one.
 */
export async function getQzoneMsgDetail(
  cookieObject: Record<string, string>,
  targetUin: string,
  tid: string,
  pos = 0,
  num = 20,
): Promise<QzoneMsgDetail> {
  const data = await fetchQzoneMsgDetail(cookieObject, targetUin, tid, { pos, num });
  const resultTid = detailString(data["tid"], "tid");
  if (!resultTid || resultTid !== tid) {
    throw new Error("invalid qzone msg detail: tid does not match the requested post");
  }
  return {
    tid: resultTid,
    content: detailString(data["content"], "content"),
    comment_num: detailInteger(data["cmtnum"], "cmtnum"),
    comments: detailList(data["commentlist"], "commentlist").map((value, index) => {
      const field = `commentlist[${String(index)}]`;
      const comment = detailObject(value, field);
      const mapped = mapQzoneComment(comment, field);
      return {
        ...mapped,
        replies: detailList(comment["list_3"], `${field}.list_3`).map((reply, replyIndex) => {
          const replyField = `${field}.list_3[${String(replyIndex)}]`;
          return {
            ...mapQzoneComment(detailObject(reply, replyField), replyField),
            parent_comment_id: mapped.comment_id,
            parent_comment_uin: mapped.uin,
          };
        }),
      };
    }),
  };
}

/**
 * `updateQzoneMsgRight` — change a post's visibility via detail → update.
 *
 * Two round trips, and both can fail independently: the detail fetch fails for an
 * unknown or foreign tid, and the update fails on a rejected payload. Neither is
 * swallowed.
 */
export async function updateQzoneMsgRight(
  cookieObject: Record<string, string>,
  selfUin: string,
  tid: string,
  ugcRight: number,
  targetUins?: string,
): Promise<{ ugc_right: number }> {
  if (!tid) throw new Error("tid is required");
  const right = normalizeQzoneUgcRight(ugcRight);
  const effectiveTargetUins = right === 16 || right === 128 ? normalizeTargetUins(targetUins) : "";
  if ((right === 16 || right === 128) && !effectiveTargetUins) {
    throw new Error("target_uins is required when ugc_right is 16 or 128");
  }
  const bodyParams = buildQzoneUpdatePayload(await fetchQzoneMsgDetail(cookieObject, selfUin, tid), selfUin);
  bodyParams.set("ugc_right", String(right));
  if (effectiveTargetUins) bodyParams.set("allow_uins", effectiveTargetUins);
  const url = `${PROXY}/taotao.qzone.qq.com/cgi-bin/emotion_cgi_update?g_tk=${getBknFromCookie(cookieObject)}`;
  const data = parseQzoneJson(
    await RequestUtil.HttpGetText(url, "POST", bodyParams.toString(), {
      Cookie: cookieToString(cookieObject),
      "Content-Type": "application/x-www-form-urlencoded",
    }),
  );
  const subcode = data["subcode"];
  if (typeof subcode === "number" && subcode !== 0) {
    log.warn("updateQzoneMsgRight: non-zero subcode (tid=%s) subcode=%d msg=%s", tid, subcode, data["message"] ?? data["msg"]);
    throw new Error(`qzone update right failed: subcode=${String(subcode)} ${String(data["message"] ?? data["msg"] ?? "")}`.trim());
  }
  const code = data["code"];
  if (typeof code === "number" && code !== 0) {
    log.warn("updateQzoneMsgRight: non-zero code (tid=%s) code=%d msg=%s", tid, code, data["message"] ?? data["msg"]);
    throw new Error(`qzone update right failed: code=${String(code)} ${String(data["message"] ?? data["msg"] ?? "")}`.trim());
  }
  return { ugc_right: Number(data["ugc_right"] ?? right) };
}

/**
 * `setQzoneBlack` — add to or remove from the bot's own space blacklist.
 *
 * `action: 1` bans, `action: 2` unbans — the numbering is not a boolean, so this
 * is the one endpoint where "true means 1" happens to hold.
 *
 * The parse is wrapped because this CGI answers with a non-JSON-ish body on
 * failure: it emits `{name: ...}` (an UNQUOTED key) in some error envelopes, which
 * is why the text is rewritten before parsing. When even that fails the raw body
 * head is surfaced, because the server's message is the only useful diagnostic
 * and it is usually plain JSON at the front.
 */
export async function setQzoneBlack(
  cookieObject: Record<string, string>,
  selfUin: string,
  targetUin: string,
  ban: boolean,
): Promise<void> {
  if (!targetUin) throw new Error("targetUin is required");
  const verb = ban ? "ban" : "unban";
  const url = `${PROXY}/w.qzone.qq.com/cgi-bin/right/cgi_black_action_new?g_tk=${getBknFromCookie(cookieObject)}`;
  const body = new URLSearchParams({
    uin: selfUin,
    act_uin: targetUin,
    action: ban ? "1" : "2",
    fupdate: "1",
    qzreferrer: `https://user.qzone.qq.com/${selfUin}/main`,
  }).toString();
  const text = await RequestUtil.HttpGetText(url, "POST", body, {
    Cookie: cookieToString(cookieObject),
    "Content-Type": "application/x-www-form-urlencoded",
  });
  let data: Record<string, unknown>;
  try {
    // `{name:` with no quotes is not valid JSON; quote the key before parsing.
    data = parseQzoneJson(text.replace(/\{\s*name\s*:/, '{"name":'));
  } catch {
    const snippet = text.trim().slice(0, 300);
    throw new Error(`qzone ${verb} failed: ${snippet}${text.length > 300 ? "…" : ""}`);
  }
  const subcode = data["subcode"];
  if (typeof subcode === "number" && subcode !== 0) {
    const message = data["message"] ?? data["msg"] ?? "";
    log.warn("setQzoneBlack(%s): non-zero subcode (target=%s) subcode=%d msg=%s", verb, targetUin, subcode, message);
    throw new Error(`qzone ${verb} failed: subcode=${String(subcode)} ${String(message)}`.trim());
  }
  const code = data["code"];
  if (typeof code === "number" && code !== 0) {
    const message = data["message"] ?? data["msg"] ?? "";
    log.warn("setQzoneBlack(%s): non-zero code (target=%s) code=%d msg=%s", verb, targetUin, code, message);
    throw new Error(`qzone ${verb} failed: code=${String(code)} ${String(message)}`.trim());
  }
}

// ===========================================================================
// profile
// ===========================================================================

/** A space's name and description. */
export interface QzoneProfile {
  name: string;
  description: string;
}

/** `getQzoneProfile` — read a space's name/description. Defaults to the bot's own. */
export async function getQzoneProfile(
  cookieObject: Record<string, string>,
  selfUin: string,
  targetUin: string = selfUin,
): Promise<QzoneProfile> {
  const url =
    `${PROXY}/base.qzone.qq.com/cgi-bin/user/cgi_userinfo_get_all?` +
    new URLSearchParams({
      uin: targetUin,
      vuin: selfUin,
      fupdate: "1",
      rd: String(Math.random()),
      g_tk: getBknFromCookie(cookieObject),
    }).toString();
  const response = parseQzoneJson(
    await RequestUtil.HttpGetText(url, "GET", "", { Cookie: cookieToString(cookieObject) }),
  );
  const code = response["code"];
  const subcode = response["subcode"];
  if (code !== 0 || (subcode !== undefined && subcode !== 0)) {
    throw new Error(
      `qzone profile failed: code=${String(code)} subcode=${String(subcode ?? 0)} ${String(response["message"] ?? "")}`.trim(),
    );
  }
  const data = response["data"];
  const payload = typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
  if (typeof payload?.["spacename"] !== "string" || typeof payload["desc"] !== "string") {
    throw new Error("invalid qzone profile response");
  }
  return { name: payload["spacename"], description: payload["desc"] };
}

/**
 * `setQzoneProfile` — write a space's name and/or description.
 *
 * `mb` is a bitmask that says which fields the request intends to change:
 * 2048 for the name, 4096 for the description, OR-ed together when both are
 * given. It is not optional — the CGI ignores a field whose bit is absent, so a
 * name-only update with `mb=0` silently does nothing.
 *
 * `\r` is stripped from both values: a carriage return in a form field makes the
 * server truncate at it, and a name pasted from Windows would silently lose
 * everything after the first line.
 */
export async function setQzoneProfile(
  cookieObject: Record<string, string>,
  selfUin: string,
  profile: { name?: string; description?: string },
): Promise<void> {
  const params = new URLSearchParams({ uin: selfUin, pageindex: "3", fupdate: "1" });
  let bitmap = 0;
  if (profile.name !== undefined) {
    params.set("spacename", profile.name.replaceAll("\r", ""));
    bitmap |= 2048;
  }
  if (profile.description !== undefined) {
    params.set("desc", profile.description.replaceAll("\r", ""));
    bitmap |= 4096;
  }
  params.set("mb", String(bitmap));
  const url = `${PROXY}/w.qzone.qq.com/cgi-bin/user/cgi_apply_updateuserinfo_new?g_tk=${getBknFromCookie(cookieObject)}`;
  const response = parseQzoneJson(
    await RequestUtil.HttpGetText(url, "POST", params.toString(), {
      Cookie: cookieToString(cookieObject),
      "Content-Type": "application/x-www-form-urlencoded",
    }),
  );
  const code = response["code"];
  const subcode = response["subcode"];
  if (code !== 0 || (subcode !== undefined && subcode !== 0)) {
    throw new Error(
      `qzone profile update failed: code=${String(code)} subcode=${String(subcode ?? 0)} ${String(response["message"] ?? "")}`.trim(),
    );
  }
}

/**
 * A digest of an upload payload, exposed for a caller that wants to de-duplicate
 * before spending a round trip on `cgi_upload_image`.
 *
 * Not part of the reference. The upload CGI has no idempotency key, so this is the
 * only local way to recognise bytes already posted.
 */
export function qzoneUploadDigest(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}