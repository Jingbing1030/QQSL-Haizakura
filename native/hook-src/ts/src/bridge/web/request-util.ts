// The HTTP plumbing every cookie-backed web API rides on.
//
// Reference region: ../protocol/src/web/request-util.ts
// (reference/index.mjs:8422, 455 lines). Only the three public entry points and
// the two cookie helpers are reachable from the bridge layer; the rest of the
// region is trace plumbing (`runWithTraceRequest`, `renderParamsVerbose`,
// `renderTraceBytes`) whose output is a log line, not a wire byte.
//
// ---------------------------------------------------------------------------
// Why this is a class with statics, and why the failure bookkeeping exists
// ---------------------------------------------------------------------------
// `RequestUtil` keeps a module-level `WeakMap` from Error instance to
// `{outcome, reason}` (`httpFailures`, reference/index.mjs:8446). It looks like
// dead weight in a port with no trace sink, but it is not: `HttpGetJson` reads
// the classification back out to decide `outcome=timeout` vs `outcome=failed`,
// and the reference's OneBot layer maps those to different retcodes. Attaching
// the reason to the Error object is also how a *rethrown* error keeps its
// classification after passing through a caller.
//
// ---------------------------------------------------------------------------
// The three behaviours that are easy to get wrong
// ---------------------------------------------------------------------------
// 1. `HttpsGetCookies` FAILS OPEN: it resolves with whatever cookies it managed
//    to collect even when the request errored or the redirect limit tripped
//    (reference/index.mjs:8477). `getCookies` in the bridge relies on this — a
//    missing p_skey is then detected and repaired by the `GetPskey` fallback
//    rather than by an exception here.
// 2. `HttpGetJson` FAILS CLOSED: a non-2xx, a redirect over the limit, an
//    oversized body and a JSON parse error all reject. A caller that wants "empty
//    on failure" has to say so (`getHonorListWebAPI` catches to `[]`).
// 3. A redirect drops `cookie`/`authorization`/`host`/`proxy-authorization` on a
//    cross-origin hop (reference/index.mjs:8460). Forwarding them would leak the
//    jar to a host the caller never named.
//
// ---------------------------------------------------------------------------
// Deliberate divergences
// ---------------------------------------------------------------------------
// * No `runWithTraceRequest` / trace records: those exist to feed the desktop
//   log viewer. The observable HTTP behaviour is identical without them.
// * `responseLimits.timeoutMs` is applied as an absolute deadline across redirect
//   hops, which is what the reference does (`deadlineAt` is computed once, before
//   the first hop, and subtracted per hop) — not as a per-hop timeout.

import { get as httpGet, request as httpRequest } from "node:http";
import { get as httpsGet, request as httpsRequest } from "node:https";
import type { IncomingMessage, ClientRequest } from "node:http";

/** Body/limit options a caller may impose on one request. */
export interface ResponseLimits {
  timeoutMs?: number | undefined;
  maxResponseBytes?: number | undefined;
}

/** One request, already resolved into everything `request()` needs. */
export interface RequestContext {
  url: string;
  method: string;
  data: unknown;
  headers: Record<string, string>;
  isJsonRet: boolean;
  isArgJson: boolean;
  maxRedirects: number;
  responseLimits: ResponseLimits;
  deadlineAt?: number | undefined;
}

/** `httpFailures` classification: what kind of failure an Error carries. */
export interface HttpFailure {
  outcome: "failed" | "timeout" | "cancelled";
  reason: string;
}

/**
 * Error → classification. A `WeakMap` so the Error stays collectable and no
 * property is added to a foreign object.
 */
const httpFailures = new WeakMap<Error, HttpFailure>();

function errorObject(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function fail(outcome: HttpFailure["outcome"], reason: string, error: unknown): Error {
  const result = errorObject(error);
  if (!httpFailures.has(result)) httpFailures.set(result, { outcome, reason });
  return result;
}

/** Read back the classification of an error produced by this module, if any. */
export function classifyHttpFailure(error: unknown): HttpFailure {
  const result = errorObject(error);
  return httpFailures.get(result) ?? { outcome: "failed", reason: "transport_failure" };
}

/**
 * `validateLimit` (reference/index.mjs:8424). A `timeoutMs` above the 32-bit
 * timer ceiling is rejected rather than clamped: `setTimeout` silently treats a
 * larger value as 1 ms, which would turn a one-hour timeout into an instant
 * failure that looks like a dead server.
 */
function validateLimit(name: string, value: number | undefined): void {
  if (value === undefined) return;
  const exceedsTimerRange = name === "timeoutMs" && value > 2_147_483_647;
  if (!Number.isSafeInteger(value) || value <= 0 || exceedsTimerRange) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

/** Headers stripped when a redirect crosses an origin (reference/index.mjs:8455). */
const SENSITIVE_REDIRECT_HEADERS = new Set([
  "authorization",
  "cookie",
  "cookie2",
  "host",
  "proxy-authorization",
]);

function headersForRedirect(headers: Record<string, string>, sameOrigin: boolean): Record<string, string> {
  if (sameOrigin) return headers;
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !SENSITIVE_REDIRECT_HEADERS.has(name.toLowerCase())),
  );
}

/** Cookie jar → the canonical `k=v; k=v` header form. */
export function cookieToString(cookieObject: Record<string, string>): string {
  return Object.entries(cookieObject)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

/**
 * The QQ `bkn` (a.k.a. `g_tk` / CSRF token) from a cookie jar.
 *
 * The same djb2-with-`charCodeAt` loop appears three times in the reference under
 * three names (`getBknFromCookie`, `calculateBkn` in group-notice, and
 * `getBknFromSKey` in `apis/web.ts`) and they are all the same function — the
 * only differences are which cookie they prefer and whether the result is a
 * string or a number. This one returns the string form, which is what every URL
 * query builder and form body wants.
 */
export function getBknFromCookie(cookieObject: Record<string, string>): string {
  const skey = cookieObject["p_skey"] || cookieObject["skey"] || "";
  let hash = 5381;
  for (let i = 0; i < skey.length; i++) hash += (hash << 5) + skey.charCodeAt(i);
  return String(hash & 2147483647);
}

/** The cookie timeout, in ms. Fixed at 8 s in the reference (reference/index.mjs:8531). */
const COOKIE_RESPONSE_TIMEOUT_MS = 8_000;

/** The redirect depth cap for `HttpsGetCookies` (reference/index.mjs:8516). */
const COOKIE_MAX_REDIRECTS = 5;

export class RequestUtil {
  /**
   * GET `url` and return every cookie the response chain set.
   *
   * Follows 301/302 for up to five hops accumulating cookies across hops, which
   * is what `ssl.ptlogin2.qq.com/jump` needs: the ticket cookies arrive on the
   * redirect target, not the first response. Always resolves.
   */
  static async HttpsGetCookies(url: string, depth = 0): Promise<Record<string, string>> {
    const cookies: Record<string, string> = {};
    await this.collectCookies(url, depth, cookies);
    return cookies;
  }

  private static collectCookies(
    url: string,
    depth: number,
    cookies: Record<string, string>,
  ): Promise<void> {
    const getFunction = url.startsWith("https") ? httpsGet : httpGet;
    return new Promise((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      let req: ClientRequest;
      try {
        req = getFunction(url, (res: IncomingMessage) => {
          const setCookie = res.headers["set-cookie"];
          if (setCookie !== undefined) this.extractCookies(setCookie, cookies);
          res.once("aborted", done);
          res.once("error", done);
          res.on("end", () => {
            const location = res.headers.location;
            if ((res.statusCode === 301 || res.statusCode === 302) && location !== undefined) {
              if (depth >= COOKIE_MAX_REDIRECTS) {
                done();
                return;
              }
              let redirectUrl: string;
              try {
                redirectUrl = new URL(location, url).href;
              } catch {
                done();
                return;
              }
              this.collectCookies(redirectUrl, depth + 1, cookies).then(() => done(), () => done());
              return;
            }
            done();
          });
          // Drain so the socket can be reused; the body of a jump response is
          // HTML we never inspect.
          res.resume();
        });
      } catch {
        done();
        return;
      }
      req.setTimeout(COOKIE_RESPONSE_TIMEOUT_MS, () => {
        req.destroy();
        done();
      });
      req.on("error", done);
    });
  }

  /**
   * Parse `Set-Cookie` headers into the jar.
   *
   * `split(";")[0]` keeps only the `name=value` pair and drops attributes, which
   * is correct here because the jar is consumed as a request `Cookie` header —
   * attributes like `Path`/`Secure`/`HttpOnly` would be meaningless.
   */
  static extractCookies(setCookieHeaders: string[], cookies: Record<string, string>): void {
    for (const cookie of setCookieHeaders) {
      const parts = cookie.split(";")[0]?.split("=");
      if (parts === undefined) continue;
      const key = parts[0];
      const value = parts[1];
      if (key !== undefined && value !== undefined && key.length > 0 && value.length > 0) {
        cookies[key] = value;
      }
    }
  }

  /** GET/POST JSON, rejecting on any transport, status, size or parse failure. */
  static async HttpGetJson(
    url: string,
    method = "GET",
    data: unknown = "",
    headers: Record<string, string> = {},
    isJsonRet = true,
    isArgJson = true,
    maxRedirects = 5,
    responseLimits: ResponseLimits = {},
  ): Promise<unknown> {
    const methodName = method.toUpperCase();
    validateLimit("timeoutMs", responseLimits.timeoutMs);
    validateLimit("maxResponseBytes", responseLimits.maxResponseBytes);
    return this.request({
      url,
      method: methodName,
      data,
      headers,
      isJsonRet,
      isArgJson,
      maxRedirects,
      responseLimits,
      deadlineAt: responseLimits.timeoutMs === undefined ? undefined : Date.now() + responseLimits.timeoutMs,
    });
  }

  /** Text variant; note it inherits the fixed 5-redirect budget. */
  static async HttpGetText(
    url: string,
    method = "GET",
    data: unknown = "",
    headers: Record<string, string> = {},
    responseLimits: ResponseLimits = {},
  ): Promise<string> {
    const value = await this.HttpGetJson(url, method, data, headers, false, false, 5, responseLimits);
    return value as string;
  }

  private static request(context: RequestContext): Promise<unknown> {
    let option: URL;
    try {
      option = new URL(context.url);
    } catch (error) {
      return Promise.reject(fail("failed", "request_invalid", error));
    }
    const protocol =
      option.protocol === "https:" ? httpsRequest : option.protocol === "http:" ? httpRequest : undefined;
    if (protocol === undefined) {
      return Promise.reject(
        fail("failed", "request_invalid", new Error(`unsupported request protocol: ${option.protocol}`)),
      );
    }
    const remainingTimeoutMs = context.deadlineAt === undefined ? undefined : context.deadlineAt - Date.now();
    if (remainingTimeoutMs !== undefined && remainingTimeoutMs <= 0) {
      return Promise.reject(
        fail(
          "timeout",
          "deadline",
          new Error(`request timed out after ${String(context.responseLimits.timeoutMs)} ms`),
        ),
      );
    }
    const options = {
      hostname: option.hostname,
      port: option.port,
      path: option.pathname + option.search,
      method: context.method,
      headers: context.headers,
    };
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: NodeJS.Timeout | undefined;
      const clearDeadline = (): void => {
        if (timeout !== undefined) clearTimeout(timeout);
      };
      const resolveOnce = (value: unknown): void => {
        if (settled) return;
        settled = true;
        clearDeadline();
        resolve(value);
      };
      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        clearDeadline();
        reject(error);
      };
      const handOff = (next: Promise<unknown>): void => {
        if (settled) return;
        settled = true;
        clearDeadline();
        next.then(resolve, reject);
      };
      let req: ClientRequest;
      try {
        req = protocol(options, (res: IncomingMessage) => {
          const statusCode = res.statusCode ?? 0;
          const closeCurrent = (): void => {
            res.destroy();
            req.destroy();
          };
          res.once("error", (error: Error) => rejectOnce(fail("failed", "transport_failure", error)));
          res.once("aborted", () =>
            rejectOnce(fail("cancelled", "response_aborted", new Error("response aborted before completion"))),
          );
          const redirectable =
            statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308;
          const location = res.headers.location;
          if (redirectable && location !== undefined) {
            if (context.maxRedirects <= 0) {
              rejectOnce(fail("failed", "redirect_failure", new Error("Too many redirects")));
              closeCurrent();
              return;
            }
            let redirectUrl: URL;
            try {
              redirectUrl = new URL(location, option);
            } catch (cause) {
              rejectOnce(fail("failed", "redirect_failure", new Error("invalid redirect location", { cause })));
              closeCurrent();
              return;
            }
            if (redirectUrl.protocol !== "http:" && redirectUrl.protocol !== "https:") {
              rejectOnce(
                fail(
                  "failed",
                  "redirect_failure",
                  new Error(`unsupported redirect protocol: ${redirectUrl.protocol}`),
                ),
              );
              closeCurrent();
              return;
            }
            const upperMethod = context.method.toUpperCase();
            if (option.origin !== redirectUrl.origin && upperMethod !== "GET" && upperMethod !== "HEAD") {
              rejectOnce(
                fail(
                  "failed",
                  "redirect_failure",
                  new Error(`cross-origin redirect cannot forward method ${upperMethod}`),
                ),
              );
              closeCurrent();
              return;
            }
            handOff(
              this.request({
                ...context,
                url: redirectUrl.href,
                headers: headersForRedirect(context.headers, option.origin === redirectUrl.origin),
                maxRedirects: context.maxRedirects - 1,
              }),
            );
            closeCurrent();
            return;
          }
          if (statusCode < 200 || statusCode >= 300) {
            rejectOnce(fail("failed", "non_2xx", new Error(`Unexpected status code: ${String(res.statusCode)}`)));
            closeCurrent();
            return;
          }
          const chunks: Buffer[] = [];
          let responseBytes = 0;
          res.on("data", (chunk: Buffer | string) => {
            if (settled) return;
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            responseBytes += bytes.length;
            chunks.push(bytes);
            const limit = context.responseLimits.maxResponseBytes;
            if (limit !== undefined && responseBytes > limit) {
              rejectOnce(
                fail(
                  "failed",
                  "response_too_large",
                  new Error(`response body exceeds ${String(limit)} bytes`),
                ),
              );
              closeCurrent();
            }
          });
          res.on("end", () => {
            if (settled) return;
            const responseBody = Buffer.concat(chunks, responseBytes).toString();
            if (!context.isJsonRet) {
              resolveOnce(responseBody);
              return;
            }
            try {
              resolveOnce(JSON.parse(responseBody));
            } catch (parseError) {
              rejectOnce(fail("failed", "parse_failure", parseError));
            }
          });
        });
      } catch (error) {
        rejectOnce(fail("failed", "request_invalid", error));
        return;
      }
      if (remainingTimeoutMs !== undefined) {
        timeout = setTimeout(() => {
          const error = new Error(`request timed out after ${String(context.responseLimits.timeoutMs)} ms`);
          rejectOnce(fail("timeout", "deadline", error));
          req.destroy();
        }, remainingTimeoutMs);
      }
      req.on("error", (error: Error) => rejectOnce(fail("failed", "transport_failure", error)));
      try {
        if (
          context.method === "POST" ||
          context.method === "PUT" ||
          context.method === "PATCH"
        ) {
          const requestBody = context.isArgJson
            ? JSON.stringify(context.data)
            : (context.data as string | Buffer | Uint8Array);
          req.write(requestBody);
        }
        req.end();
      } catch (error) {
        rejectOnce(fail("failed", "request_invalid", error));
        req.destroy();
      }
    });
  }
}