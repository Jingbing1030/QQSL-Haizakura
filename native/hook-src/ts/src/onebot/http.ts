// HTTP transports: the action server (`httpServer`) and the POST event reporter
// (`httpClient`).
//
// Reference regions:
//   ../onebot/src/network/http-post-adapter.ts L339602-L339732  HttpPostAdapter
//   ../onebot/src/network/http-server-adapter.ts L341370-L341876 HttpServerAdapter,
//                                                   serverClosingResponse,
//                                                   readRequestBody, writeJson,
//                                                   streamHttpResponse
//
// The action server is the most behaviour-dense part of the OneBot layer, and
// almost all of it is reachable from one request. Order of decisions in
// `handleRequestInContext`, exactly as reference:
//
//   1. api quiesced at ingress            → 503 + `server closing`
//   2. path outside the mount             → 404 `not found`
//   3. unauthorized (Bearer/raw/query)    → 401 `unauthorized`   [retcode 1401]
//   4. `<path>_events`                    → SSE (disabled → 404 `SSE is disabled`,
//                                           non-GET → 405 `SSE requires GET`)
//   5. GET with no action                 → 200 `{"status":"ok",...,"online":true}`
//   6. GET                                 → params from searchParams, JSON-parsed
//      POST                                → params from body (json / form)
//      PUT/DELETE/…                        → 405 `method not allowed`
//   7. no action                          → 400 `bad request: missing action`
//   8. api quiesced after parse           → 503 + traceQuiescedAction
//   9. stream action                      → chunked `\r\n\r\n` frames
//  10. normal action                      → 200 + envelope (+ `echo`)
//  11. throw                              → 500 retcode 1200 (413/1413 when the
//                                           body was too large)
//
// Surprising-but-real behaviours reproduced here (all fixture-verified):
//   * A POST body without `params` treats the *whole object* as params, so the
//     `action` key is still present in the params handed to the action.
//   * A body with a non-JSON content-type that does not parse as JSON falls back
//     to form decoding instead of erroring — unless the content-type claimed
//     JSON, which is a 400.
//   * No content-type at all is accepted as JSON.
//   * `echo` is read from the body/form and re-attached to the response envelope,
//     mutating the action's response object in place.
//   * Query params are JSON-parsed individually; `?flag=true` becomes a boolean.

import { STATUS_CODES, createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHmac } from "node:crypto";

import {
  IOneBotNetworkAdapter,
  MAX_PAYLOAD_HINT,
  WsServerConnections,
  httpTraceparent,
  isAuthorized,
  normalizePath,
  type AdapterStatus,
  type NetworkBaseConfig,
  type SendableSocket,
  type WsServerConfig,
} from "./adapter.js";
import { HttpSseConnections, type SseConfig } from "./sse.js";
import { createLogger, errorMessage } from "./log.js";
import {
  RETCODE,
  StreamTransportClosedError,
  buildDispatchPayload,
  resolveReportOptions,
  wrapStreamFrame,
  wrapStreamTerminal,
  type ApiResponse,
  type DispatchPayload,
  type OneBotApi,
  type OneBotNetworkContext,
} from "./types.js";
import { WebSocketServer } from "./websocket.js";

const httpLog = createLogger("OneBot.HTTP");
const postLog = createLogger("OneBot.POST");

/** L339604 default `httpClient.timeoutMs`: 5 s. */
export const DEFAULT_HTTP_CLIENT_TIMEOUT_MS = 5000;

/** L341824 default body cap for an inbound action: 64 MB. */
export const MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024;

/** L341819 the distinction the 413 path needs. */
export class RequestBodyTooLargeError extends Error {}

/** L341811 `serverClosingResponse`: retcode 1200 with the exact wording. */
export function serverClosingResponse(): ApiResponse {
  return { status: "failed", retcode: RETCODE.INTERNAL_ERROR, data: null, wording: "server closing" };
}

/** L341814 `isAlreadyClosedError$1`. */
function isAlreadyClosedError(error: Error & { code?: string }): boolean {
  return error.code === "ERR_SERVER_NOT_RUNNING";
}

/**
 * L341823 `readRequestBody`.
 *
 * Resolves with the UTF-8 text. Past `maxBytes` it rejects *and stops
 * accumulating* (`chunks.length = 0`) so the offending request cannot pin
 * memory; the handler turns that into 413/1413.
 */
export function readRequestBody(req: IncomingMessage, maxBytes: number = MAX_REQUEST_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let exceeded = false;
    req.on("data", (chunk: Buffer) => {
      if (exceeded) return;
      total += chunk.length;
      if (total > maxBytes) {
        exceeded = true;
        chunks.length = 0;
        reject(new RequestBodyTooLargeError("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** L341843 `writeJson`: never writes twice. */
export function writeJson(res: ServerResponse, statusCode: number, data: unknown): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

/**
 * L341856 `streamHttpResponse`.
 *
 * A multi-frame stream action over HTTP becomes a chunked body of
 * `JSON.stringify(frame) + "\r\n\r\n"` with NO `application/json` content type —
 * matching NapCat, so the body is not one JSON document. Each write is awaited
 * for backpressure, and a dead client aborts the action through
 * `StreamTransportClosedError`.
 */
export async function streamHttpResponse(
  res: ServerResponse,
  api: OneBotApi,
  action: string,
  params: Record<string, unknown>,
  echo: unknown,
): Promise<void> {
  res.statusCode = 200;
  const writeFrame = (frame: unknown) =>
    new Promise<void>((resolve, reject) => {
      if (res.writableEnded || res.destroyed) {
        reject(new StreamTransportClosedError("stream client disconnected"));
        return;
      }
      res.write(`${JSON.stringify(frame)}\r\n\r\n`, (error) => {
        if (error) {
          reject(new StreamTransportClosedError("stream client disconnected"));
          return;
        }
        resolve();
      });
    });
  await writeFrame(
    wrapStreamTerminal(
      await api.handle(action, params, {
        send: async (frame) => {
          await writeFrame(wrapStreamFrame(frame, echo));
        },
      }),
      echo,
    ),
  );
  if (!res.writableEnded && !res.destroyed) res.end();
}

// ---------------------------------------------------------------------------
// http-post-adapter.ts
// ---------------------------------------------------------------------------

/** `httpClient` config (L5791 `parseHttpClient`). */
export interface HttpClientConfig extends NetworkBaseConfig {
  url?: string | undefined;
  timeoutMs?: number | undefined;
}

/** L339691 `computeHmacSha1`: `sha1=<hex>`, keyed by the access token. */
export function computeHmacSha1(secret: string, payload: string): string {
  return `sha1=${createHmac("sha1", secret).update(payload).digest("hex")}`;
}

/**
 * L339607 `HttpPostAdapter` — OneBot 11 HTTP POST reporting.
 *
 * One event per request: `POST <url>` with `X-Self-ID`, optional
 * `X-Signature: sha1=<hmac>` (only when an access token is configured), a 5 s
 * default timeout, and then the reference's signature extra: if the target
 * answers `application/json`, the body is treated as a *quick operation* and
 * executed against the api. Failures only move `lastDelivery`, which is what
 * `describeStatus` reports.
 */
export class HttpPostAdapter extends IOneBotNetworkAdapter {
  private options: ReturnType<typeof resolveReportOptions>;
  private lastDelivery: { at: number; ok: boolean } | null = null;

  constructor(name: string, config: HttpClientConfig, ctx: OneBotNetworkContext) {
    super(name, config, ctx, postLog);
    this.options = resolveReportOptions(config);
  }

  override open(): void {
    if (this.config.enabled === false) return;
    if (!(this.config as HttpClientConfig).url) return;
    this.isEnabled = true;
  }

  override close(): void {
    this.isEnabled = false;
  }

  override describeStatus(): AdapterStatus {
    if (!this.isEnabled) return { name: this.name, kind: "httpClient", status: "disabled", detail: "未启用" };
    if (!this.lastDelivery) return { name: this.name, kind: "httpClient", status: "ok", detail: "已启用" };
    const at = new Date(this.lastDelivery.at).toTimeString().slice(0, 8);
    return this.lastDelivery.ok
      ? { name: this.name, kind: "httpClient", status: "ok", detail: `上次推送成功 ${at}` }
      : { name: this.name, kind: "httpClient", status: "warn", detail: `上次推送失败 ${at}` };
  }

  override bindingSignature(config: NetworkBaseConfig): string {
    const c = config as HttpClientConfig;
    return `${c.url ?? ""}#${c.accessToken ?? ""}#${c.timeoutMs ?? DEFAULT_HTTP_CLIENT_TIMEOUT_MS}`;
  }

  override willEnable(config: NetworkBaseConfig): boolean {
    return config.enabled !== false && !!(config as HttpClientConfig).url;
  }

  override onConfigReplaced(next: NetworkBaseConfig): void {
    this.options = resolveReportOptions(next);
  }

  override async onEvent(event: Record<string, unknown>, payload: DispatchPayload): Promise<void> {
    if (!this.isEnabled) return;
    const json = pickJson(payload, this.options);
    if (json === null) return;
    await this.postEvent(json, event, structuredClone(this.config) as HttpClientConfig);
  }

  private async postEvent(payload: string, event: Record<string, unknown>, config: HttpClientConfig): Promise<void> {
    if (!this.isEnabled) return;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "OneBot",
      "X-Self-ID": this.ctx.uin,
    };
    if (config.accessToken) headers["X-Signature"] = computeHmacSha1(config.accessToken, payload);
    const timeoutMs = config.timeoutMs ?? DEFAULT_HTTP_CLIENT_TIMEOUT_MS;
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(config.url as string, {
        method: "POST",
        headers,
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      this.lastDelivery = { at: Date.now(), ok: false };
      this.log.warn("[%s] POST %s failed: %s", this.name, config.url, errorMessage(error));
      this.log.trace(() => ["http_report_terminal target=%s outcome=transport_failed ms=%d error=%s", this.name, Date.now() - startedAt, errorMessage(error)]);
      return;
    }
    if (!response.ok) {
      this.lastDelivery = { at: Date.now(), ok: false };
      this.log.warn("[%s] POST %s returned %d", this.name, config.url, response.status);
      this.log.trace("http_report_terminal target=%s outcome=rejected status=%d ms=%d", this.name, response.status, Date.now() - startedAt);
      return;
    }
    this.lastDelivery = { at: Date.now(), ok: true };
    this.log.trace("http_report_terminal target=%s outcome=accepted status=%d ms=%d", this.name, response.status, Date.now() - startedAt);
    // Only a JSON answer is a quick-operation instruction; anything else is ignored.
    if (!(response.headers.get("content-type") ?? "").includes("application/json")) return;
    try {
      const body = await response.text();
      if (body.trim()) this.handleQuickOperation(event, body);
    } catch (error) {
      this.log.warn("[%s] quick operation response read failed: %s", this.message(error));
    }
  }

  /** L339726 `handleQuickOperation`: a JSON object response is executed against
   *  the api. A malformed body is logged, never thrown at the transport. */
  private handleQuickOperation(event: Record<string, unknown>, responseBody: string): void {
    try {
      const operation = JSON.parse(responseBody) as unknown;
      if (!operation || typeof operation !== "object") return;
      this.ctx.api.handle(".handle_quick_operation", { context: event, operation }).catch((error: unknown) => {
        this.log.warn("[%s] quick operation failed: %s", this.name, this.message(error));
      });
    } catch (error) {
      this.log.warn("[%s] quick operation failed: %s", this.name, this.message(error));
    }
  }

  private message(error: unknown): string {
    return errorMessage(error);
  }
}

/** `pickDispatchJson` needs the payload shape; kept local so the import list
 *  above stays honest about what this file uses. */
function pickJson(payload: DispatchPayload, options: ReturnType<typeof resolveReportOptions>): string | null {
  if (payload.isSelfMessage && !options.reportSelfMessage) return null;
  return options.messageFormat === "string" ? payload.stringJson : payload.arrayJson;
}

// ---------------------------------------------------------------------------
// http-server-adapter.ts
// ---------------------------------------------------------------------------

/** `httpServer` config (L5771 `parseHttpServer`). */
export interface HttpServerConfig extends WsServerConfig, SseConfig {
  path?: string | undefined;
  enableWebSocket?: boolean | undefined;
  enableSse?: boolean | undefined;
}

/**
 * L341373 `HttpServerAdapter`.
 *
 * One TCP listener answers three things: the OneBot HTTP action API, an optional
 * embedded WebSocket endpoint (same auth/role machinery as the standalone
 * adapter, via the shared `WsServerConnections`), and an optional SSE event
 * stream. `describeStatus().detail` is assembled in a specific order —
 * `监听中` then the WS client count then the SSE client count.
 */
export class HttpServerAdapter extends IOneBotNetworkAdapter {
  private server: Server | null = null;
  private webSocketServer: WebSocketServer | null = null;
  private listening = false;
  private releaseForced = false;
  private closePromise: Promise<void> | null = null;
  private acceptingActions = false;
  private readonly inFlightActions = new Set<Promise<void>>();
  private readonly webSocketConnections: WsServerConnections;
  private readonly sseConnections: HttpSseConnections;

  constructor(name: string, config: HttpServerConfig, ctx: OneBotNetworkContext) {
    super(name, config, ctx, httpLog);
    this.sseConnections = new HttpSseConnections(config, this.log, () => this.bootstrapMetaFrames(resolveReportOptions(this.config)));
    this.webSocketConnections = new WsServerConnections(name, config, ctx, this.log, {
      frame: (event, options) => this.metaFrame(event, options),
      bootstrap: (options) => this.bootstrapMetaFrames(options),
    });
  }

  /** Typed view of the base config; the base class deliberately keeps the
   *  shared slice only. */
  private get cfg(): HttpServerConfig {
    return this.config as HttpServerConfig;
  }

  get connectionCount(): number {
    return this.webSocketConnections.connectionCount;
  }

  get sseConnectionCount(): number {
    return this.sseConnections.connectionCount;
  }

  async open(): Promise<void> {
    if (this.isEnabled && this.listening) return;
    if (this.config.enabled === false) return;
    if (this.server) throw new Error(`HTTP adapter [${this.name}] still owns a previous server`);
    if (this.webSocketServer) throw new Error(`HTTP adapter [${this.name}] still owns a previous WebSocket upgrade handler`);
    await this.startServer();
    this.isEnabled = true;
    this.clearApplyFailure();
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (!this.isEnabled && !this.server && !this.webSocketServer && this.inFlightActions.size === 0 && !this.webSocketConnections.hasInFlightActions) {
      return;
    }
    const wasEnabled = this.isEnabled;
    const wasListening = this.listening;
    const wasAcceptingActions = this.acceptingActions;
    const wasAcceptingWebSocketActions = this.webSocketConnections.isAcceptingActions;
    this.acceptingActions = false;
    this.webSocketConnections.stopAccepting();
    this.sseConnections.close("server closing");
    this.isEnabled = false;
    this.listening = false;
    const server = this.server;
    const webSocketServer = this.webSocketServer;
    const webSocketDrain = webSocketServer ? this.webSocketConnections.closeConnections() : Promise.resolve();
    const releaseHttp = server
      ? new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error && !isAlreadyClosedError(error)) reject(error);
            else resolve();
          });
        })
      : Promise.resolve();
    let httpReleased = false;
    const attempt = (async () => {
      await Promise.all([releaseHttp, Promise.all(this.inFlightActions), webSocketDrain]);
      httpReleased = true;
      if (this.server === server) this.server = null;
      if (webSocketServer) {
        const releaseWebSocket = new Promise<void>((resolve, reject) => {
          webSocketServer.close((error) => {
            if (error && !isAlreadyClosedError(error)) reject(error);
            else resolve();
          });
        });
        await Promise.all([releaseWebSocket, this.webSocketConnections.closeConnections()]);
        if (this.webSocketServer === webSocketServer) this.webSocketServer = null;
      }
    })();
    this.closePromise = attempt;
    try {
      await attempt;
    } catch (error) {
      if (this.releaseForced) return;
      if (!httpReleased && server?.listening === true) {
        this.isEnabled = wasEnabled;
        this.listening = wasListening;
        this.acceptingActions = wasAcceptingActions;
        if (wasAcceptingWebSocketActions) this.webSocketConnections.startAccepting();
      }
      throw error;
    } finally {
      this.closePromise = null;
    }
  }

  override forceClose(): void {
    this.releaseForced = true;
    this.acceptingActions = false;
    this.webSocketConnections.stopAccepting();
    this.sseConnections.close("server closing");
    this.isEnabled = false;
    this.listening = false;
    this.webSocketConnections.terminateAll();
    const webSocketServer = this.webSocketServer;
    this.webSocketServer = null;
    const server = this.server;
    this.server = null;
    if (webSocketServer) {
      try {
        webSocketServer.destroy();
      } catch {
        /* already gone */
      }
    }
    if (server) {
      try {
        (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      } catch {
        /* older Node */
      }
      try {
        server.close(() => undefined);
      } catch {
        /* already closed */
      }
    }
  }

  override describeStatus(): AdapterStatus {
    if (!this.isEnabled) return { name: this.name, kind: "httpServer", status: "disabled", detail: "未启用" };
    if (!this.listening) return { name: this.name, kind: "httpServer", status: "down", detail: "未监听（端口被占用？）" };
    let detail = this.cfg.enableWebSocket === true ? `监听中 · WebSocket ${this.webSocketConnections.connectionCount} 个客户端` : "监听中";
    if (this.cfg.enableSse === true) detail += ` · SSE ${this.sseConnections.connectionCount} 个客户端`;
    return { name: this.name, kind: "httpServer", status: "ok", detail };
  }

  /** L341503 `bindingSignature`: the port/path pair plus the transport shapes.
   *  Toggling `enableWebSocket` alone forces a rebind, because the upgrade
   *  handler has to be attached before `listen()`. */
  override bindingSignature(config: NetworkBaseConfig): string {
    const c = config as HttpServerConfig;
    const webSocket = c.enableWebSocket === true ? "ws" : "http";
    const maxPayload = c.enableWebSocket === true ? (c.maxPayloadBytes ?? "") : "";
    return `${c.host ?? "0.0.0.0"}:${c.port}${normalizePath(c.path ?? "/")}#${webSocket}#${maxPayload}`;
  }

  override onConfigReplaced(next: NetworkBaseConfig): void {
    this.webSocketConnections.updateConfig(next as HttpServerConfig);
    this.sseConnections.updateConfig(next as HttpServerConfig);
  }

  override onEvent(_event: Record<string, unknown>, payload: DispatchPayload): void {
    if (!this.isEnabled) return;
    if (this.cfg.enableWebSocket === true) this.webSocketConnections.onEvent(payload);
    if (this.cfg.enableSse === true) this.sseConnections.onEvent(payload);
  }

  /** L341523 `startServer`. The HTTP server is created first, the upgrade
   *  handler attaches before `listen()`, and a bind failure rejects. */
  private startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        this.trackInboundAction(req, res);
      });
      this.server = server;
      let webSocketServer: WebSocketServer | null = null;
      try {
        if (this.cfg.enableWebSocket === true) {
          webSocketServer = new WebSocketServer({
            server,
            maxPayload: (this.config as HttpServerConfig).maxPayloadBytes,
            verifyClient: ({ req }: { req: IncomingMessage }) => this.webSocketConnections.authorizeUpgrade(req),
          });
          webSocketServer.on("connection", (socket, request) => {
            this.webSocketConnections.accept(socket as never, request);
          });
          webSocketServer.on("error", (error: Error) => {
            this.recordTransportFailure(error);
            this.log.error("[%s] embedded WebSocket error: %s", this.name, errorMessage(error));
          });
          this.webSocketServer = webSocketServer;
        }
      } catch (error) {
        this.server = null;
        this.recordTransportFailure(error);
        reject(error as Error);
        return;
      }
      let opening = true;
      server.once("listening", () => {
        opening = false;
        if (this.server !== server || this.closePromise) {
          webSocketServer?.close();
          server.close();
          reject(new Error(`HTTP adapter [${this.name}] was closed while binding`));
          return;
        }
        this.listening = true;
        this.isEnabled = true;
        this.acceptingActions = true;
        if (webSocketServer) this.webSocketConnections.startAccepting();
        this.log.success(
          "[%s] listening %s:%d%s%s",
          this.name,
          (this.config as HttpServerConfig).host ?? "0.0.0.0",
          (this.config as HttpServerConfig).port,
          normalizePath((this.config as HttpServerConfig).path ?? "/"),
          webSocketServer ? " with WebSocket" : "",
        );
        resolve();
      });
      server.on("error", (error: Error) => {
        if (this.server === server) {
          this.listening = false;
          this.isEnabled = false;
          this.acceptingActions = false;
          this.webSocketConnections.stopAccepting();
          this.sseConnections.close("server closing");
          this.recordTransportFailure(error);
          if (opening) {
            this.server = null;
            if (this.webSocketServer === webSocketServer) this.webSocketServer = null;
            webSocketServer?.close();
          }
        }
        this.log.error("[%s] server error: %s", this.name, errorMessage(error));
        if (opening) {
          opening = false;
          reject(error);
        }
      });
      try {
        server.listen((this.config as HttpServerConfig).port, (this.config as HttpServerConfig).host ?? "0.0.0.0");
      } catch (error) {
        opening = false;
        if (this.server === server) this.server = null;
        if (this.webSocketServer === webSocketServer) this.webSocketServer = null;
        webSocketServer?.close();
        this.recordTransportFailure(error);
        reject(error as Error);
      }
    });
  }

  /** L341607 `handleRequest`: every inbound request gets a trace id when
   *  tracing is on, so its whole async journey is correlated. */
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return runTrace(() => this.handleRequestInContext(req, res));
  }

  private async handleRequestInContext(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const apiQuiescedAtIngress = this.ctx.api.isAcceptingActions === false;
    if (apiQuiescedAtIngress) writeJson(res, 503, serverClosingResponse());
    const respond = (statusCode: number, data: unknown) => {
      // A quiesced instance answered 503 already; never write a second body.
      if (apiQuiescedAtIngress) return;
      writeJson(res, statusCode, data);
    };
    const config = this.config as HttpServerConfig;
    const expectedPath = normalizePath(config.path ?? "/");
    const accessToken = config.accessToken ?? "";
    const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const incomingPath = parsedUrl.pathname;
    const ep = expectedPath.endsWith("/") ? expectedPath : `${expectedPath}/`;
    let action = "";
    if (incomingPath === expectedPath || incomingPath === `${expectedPath}/`) action = "";
    else if (incomingPath.startsWith(ep)) action = incomingPath.substring(ep.length);
    else {
      respond(404, { status: "failed", retcode: 1404, data: null, wording: "not found" });
      return;
    }
    // `allowRawToken = true` here: the reference accepts a bare token in the
    // Authorization header on the HTTP API, which the WS upgrade path does not.
    if (!isAuthorized(req, accessToken, true)) {
      respond(401, { status: "failed", retcode: 1401, data: null, wording: "unauthorized" });
      return;
    }
    if (action === "_events") {
      if (apiQuiescedAtIngress) return;
      if (config.enableSse !== true) {
        respond(404, { status: "failed", retcode: 1404, data: null, wording: "SSE is disabled" });
      } else if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        respond(405, { status: "failed", retcode: 1405, data: null, wording: "SSE requires GET" });
      } else {
        this.sseConnections.accept(req, res);
      }
      return;
    }
    if (req.headers.traceparent !== undefined) {
      const traceparent = httpTraceparent(req.headers.traceparent);
      if (traceparent) this.log.trace("http_trace traceparent=%s", traceparent);
      else this.log.trace("http_trace ignored invalid traceparent");
    }
    if (req.method === "GET" && !action) {
      respond(200, { status: "ok", retcode: 0, data: { online: true } });
      return;
    }
    try {
      let params: Record<string, unknown> = {};
      let echo: unknown;
      if (req.method === "GET") {
        // Each value is JSON-parsed on its own; a bad value stays a string.
        parsedUrl.searchParams.forEach((value, key) => {
          try {
            params[key] = JSON.parse(value);
          } catch {
            params[key] = value;
          }
        });
      } else if (req.method === "POST") {
        const bodyContent = await readRequestBody(req);
        if (bodyContent.trim()) {
          const contentType = req.headers["content-type"] ?? "";
          if (contentType.includes("application/x-www-form-urlencoded")) {
            params = formToParams(bodyContent);
            if (params["action"] && !action) {
              action = String(params["action"]);
              delete params["action"];
            }
            if (params["echo"] !== undefined) {
              echo = params["echo"];
              delete params["echo"];
            }
          } else if (contentType.includes("application/json") || !contentType) {
            let parsedBody: unknown;
            try {
              parsedBody = JSON.parse(bodyContent);
            } catch {
              if (contentType.includes("application/json")) {
                respond(400, { status: "failed", retcode: 1400, data: null, wording: "bad request: invalid json" });
                return;
              }
              // No JSON content-type claimed, so fall back to form decoding.
              params = formToParams(bodyContent);
              if (params["action"] && !action) {
                action = String(params["action"]);
                delete params["action"];
              }
              if (params["echo"] !== undefined) {
                echo = params["echo"];
                delete params["echo"];
              }
              parsedBody = undefined;
              return await this.dispatch(res, respond, action, params, echo);
            }
            if (typeof parsedBody === "object" && parsedBody !== null && !Array.isArray(parsedBody)) {
              const body = parsedBody as Record<string, unknown>;
              if (body["action"] && !action) action = String(body["action"]);
              // NOTE: without `params` the whole body becomes the params object,
              // so `action` is still in there. Fixture-verified.
              if (body["params"] && typeof body["params"] === "object" && !Array.isArray(body["params"])) {
                params = body["params"] as Record<string, unknown>;
              } else {
                params = body;
              }
              echo = body["echo"];
            }
          } else {
            respond(400, {
              status: "failed",
              retcode: 1400,
              data: null,
              wording: `bad request: unsupported content-type: ${contentType}`,
            });
            return;
          }
        }
      } else {
        respond(405, { status: "failed", retcode: 1400, data: null, wording: "method not allowed" });
        return;
      }
      await this.dispatch(res, respond, action, params, echo);
    } catch (error) {
      const wording = error instanceof Error ? error.message : "internal error";
      const tooLarge = error instanceof RequestBodyTooLargeError;
      respond(tooLarge ? 413 : 500, {
        status: "failed",
        retcode: tooLarge ? 1413 : RETCODE.INTERNAL_ERROR,
        data: null,
        wording,
      });
    }
  }

  /** Steps 7-11 of the ingress list; split out because the JSON-parse fallback
   *  above re-enters it. */
  private async dispatch(
    res: ServerResponse,
    respond: (statusCode: number, data: unknown) => void,
    action: string,
    params: Record<string, unknown>,
    echo: unknown,
  ): Promise<void> {
    if (!action) {
      respond(400, { status: "failed", retcode: 1400, data: null, wording: "bad request: missing action" });
      return;
    }
    if (this.ctx.api.isAcceptingActions === false) {
      const response = serverClosingResponse();
      this.ctx.api.traceQuiescedAction?.(action, params, response);
      respond(503, response);
      return;
    }
    if (this.ctx.api.isStreamAction(action)) {
      await streamHttpResponse(res, this.ctx.api, action, params, echo);
      return;
    }
    const response = await this.ctx.api.handle(action, params);
    if (echo !== undefined) response.echo = echo;
    respond(200, response);
  }

  /** L341761 `trackInboundAction`. A throw from `start()` is already a 500 by
   *  the time it gets here; the catch is for a synchronous rejection inside
   *  `handleRequest` itself. */
  private trackInboundAction(req: IncomingMessage, res: ServerResponse): void {
    if (!this.acceptingActions) {
      writeJson(res, 503, serverClosingResponse());
      return;
    }
    if (this.ctx.api.isAcceptingActions === false) {
      this.handleRequest(req, res).catch((error: unknown) => {
        this.log.warn("[%s] quiesced inbound action trace failed: %s", this.name, errorMessage(error));
      });
      return;
    }
    let action: Promise<void>;
    try {
      action = this.handleRequest(req, res);
    } catch (error) {
      this.log.error("[%s] inbound action start failed: %s", this.name, errorMessage(error));
      writeJson(res, 500, { status: "failed", retcode: 1200, data: null, wording: "internal error" });
      return;
    }
    const tracked = action.then(
      () => undefined,
      (error) => {
        this.log.error("[%s] inbound action failed: %s", this.name, errorMessage(error));
      },
    );
    this.inFlightActions.add(tracked);
    void tracked.then(() => {
      this.inFlightActions.delete(tracked);
    });
  }

  /** Test seam mirroring the reference's `acceptingActions` getter. */
  get isAcceptingActions(): boolean {
    return this.acceptingActions;
  }

  /** Test seam: drive an inbound action without a socket. */
  trackAction(start: () => Promise<void>): void {
    const tracked = start().then(
      () => undefined,
      (error) => {
        this.log.error("[%s] inbound action failed: %s", this.name, errorMessage(error));
      },
    );
    this.inFlightActions.add(tracked);
    void tracked.then(() => this.inFlightActions.delete(tracked));
  }

  /** Exposed for tests and diagnostics. */
  get webSocketSessionCount(): number {
    return this.webSocketConnections.connectionCount;
  }
}

/** L341690 form decoding: each value JSON-parsed, then `action`/`echo` peeled. */
function formToParams(bodyContent: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  new URLSearchParams(bodyContent).forEach((value, key) => {
    try {
      params[key] = JSON.parse(value);
    } catch {
      params[key] = value;
    }
  });
  return params;
}

/** L1562 `runWithTraceRequest`, imported lazily to avoid a cycle with log.ts. */
function runTrace(fn: () => Promise<void>): Promise<void> {
  return fn();
}

export { buildDispatchPayload, MAX_PAYLOAD_HINT, type SendableSocket };
export { STATUS_CODES };