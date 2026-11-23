// Network-adapter base class + shared transport utilities.
//
// Reference regions:
//   ../onebot/src/network/adapter.ts L339485-L339601  IOneBotNetworkAdapter
//   ../onebot/src/network/utils.ts   L340867-L340986  isAuthorized, rawDataToString,
//                                                    safeSend(Async), safeClose,
//                                                    startHeartbeat, normalizePath,
//                                                    parseRequestPath
//   ../onebot/src/network/http-trace.ts L341189-L341197 httpTraceparent
//   ../onebot/src/network/ws-server-connections.ts L340987-L341188
//                                                    WsServerConnections
//
// `adapter.ts` is the lifecycle seam the network manager drives: open/close/
// reload plus the "apply failure" bookkeeping that makes a rolled-back config
// visible in the status list. Its `reload()` return code (0/1/2/3) is a real
// contract — the manager does not read it, but the reference documents it, so it
// is preserved.

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { createLogger, errorMessage, type Logger } from "./log.js";
import { StreamTransportClosedError } from "./types.js";
import {
  WebSocket,
  WebSocketServer,
  type WebSocketServerOptions,
} from "./websocket.js";
import {
  buildDispatchPayload,
  pickDispatchJson,
  resolveReportOptions,
  shapeEventForAdapter,
  type DispatchPayload,
  type OneBotApi,
  type OneBotNetworkContext,
  type ReportOptions,
} from "./types.js";

/** The config surface every adapter shares (L339487 base of each `*Config`). */
export interface NetworkBaseConfig {
  name: string;
  enabled?: boolean | undefined;
  accessToken?: string | undefined;
  messageFormat?: "array" | "string" | undefined;
  reportSelfMessage?: boolean | undefined;
  protocol?: "satori" | undefined;
}

export type NetworkKind = "httpServer" | "httpClient" | "wsServer" | "wsClient" | "satoriServer";

/** The status row the WebUI renders. `kind` comes from the adapter, not the plan. */
export interface AdapterStatus {
  name: string;
  kind: NetworkKind;
  status: "ok" | "warn" | "down" | "disabled" | "degraded";
  detail: string;
  lastError?: string | undefined;
  lastErrorAt?: number | undefined;
}

/**
 * L339488 `IOneBotNetworkAdapter`.
 *
 * Keep the two-phase failure bookkeeping intact: `markApplyFailure` is set by the
 * manager when reconciliation fails, and `clearApplyFailure` is called only after
 * a later reconcile reaches the desired state. A restored old binding therefore
 * stays visible (via `describeManagedStatus`) until the next success.
 */
export abstract class IOneBotNetworkAdapter {
  readonly name: string;
  protected config: NetworkBaseConfig;
  readonly ctx: OneBotNetworkContext;
  readonly log: Logger;
  isEnabled = false;
  private applyFailure: { message: string; at: number } | null = null;

  constructor(name: string, config: NetworkBaseConfig, ctx: OneBotNetworkContext, moduleLog?: Logger) {
    this.name = name;
    this.config = structuredClone(config);
    this.ctx = ctx;
    const base = moduleLog ?? createLogger("OneBot.Network");
    // The uin tag is a numeric child binding; a non-numeric uin gets no tag.
    const uinNum = Number.parseInt(ctx.uin, 10);
    this.log = Number.isFinite(uinNum) && uinNum > 0 ? base.child({ uin: uinNum }) : base;
  }

  get isActive(): boolean {
    return this.isEnabled;
  }

  get currentConfig(): NetworkBaseConfig {
    return this.config;
  }

  get hasApplyFailure(): boolean {
    return this.applyFailure !== null;
  }

  /** Drop sockets and listeners without waiting for a peer handshake. */
  forceClose(): void {}

  /** L339524 `describeManagedStatus`: overlay the manager's failure. */
  describeManagedStatus(): AdapterStatus {
    const status = this.describeStatus();
    if (!this.applyFailure) return status;
    return {
      ...status,
      status: "degraded",
      detail: `应用失败：${this.applyFailure.message}`,
      lastError: this.applyFailure.message,
      lastErrorAt: this.applyFailure.at,
    };
  }

  markApplyFailure(error: unknown, at: number = Date.now()): void {
    this.applyFailure = { message: errorMessage(error), at };
  }

  clearApplyFailure(): void {
    this.applyFailure = null;
  }

  recordTransportFailure(error: unknown, at: number = Date.now()): void {
    this.markApplyFailure(error, at);
  }

  /** L339546 `metaFrame`: shape one meta event, or `null` when the shaper drops
   *  it. `null` is meaningful — `bootstrapMetaFrames` omits those frames. */
  metaFrame(event: Record<string, unknown>, options: ReportOptions): string | null {
    const shaped = shapeEventForAdapter(event, options);
    return shaped === null ? null : JSON.stringify(shaped);
  }

  /** L339556 `bootstrapMetaFrames`: `connect`, `enable`, `heartbeat` — in that
   *  order, and only the frames the shaper keeps. */
  bootstrapMetaFrames(options: ReportOptions): string[] {
    const events = [
      this.ctx.buildLifecycleEvent("connect"),
      this.ctx.buildLifecycleEvent("enable"),
      this.ctx.buildHeartbeatEvent(),
    ];
    const frames: string[] = [];
    for (const event of events) {
      const frame = this.metaFrame(event, options);
      if (frame !== null) frames.push(frame);
    }
    return frames;
  }

  /** L339578 `willEnable`; client adapters override to also require a url. */
  willEnable(config: NetworkBaseConfig): boolean {
    return config.enabled !== false;
  }

  onConfigReplaced(_next: NetworkBaseConfig): void {}

  /**
   * L341064 / L341259: fan one event out to this adapter's live sessions. The
   * reference declares it on each concrete adapter rather than on the base; the
   * network manager calls it through the adapter reference, so a default no-op
   * here keeps that call site total (an adapter with no sessions, like a
   * disabled one, simply drops the event).
   */
  onEvent(_event: Record<string, unknown>, _payload: DispatchPayload): void {}

  /**
   * L339586 `reload`. Return codes: 0 nothing changed, 1 rebound, 2 disabled,
   * 3 newly enabled.
   */
  async reload(next: NetworkBaseConfig): Promise<0 | 1 | 2 | 3> {
    const prevSig = this.bindingSignature(this.config);
    const wasEnabled = this.isEnabled;
    const willEnable = this.willEnable(next);
    const sigChanged = prevSig !== this.bindingSignature(next);
    if (wasEnabled && (sigChanged || !willEnable)) {
      await this.close();
      this.replaceConfig(next);
      if (willEnable) {
        await this.open();
        return 1;
      }
      return 2;
    }
    this.replaceConfig(next);
    if (!wasEnabled && willEnable) {
      await this.open();
      return 3;
    }
    return 0;
  }

  protected replaceConfig(next: NetworkBaseConfig): void {
    this.config = structuredClone(next);
    this.onConfigReplaced(next);
  }

  abstract open(): Promise<void> | void;
  abstract close(): Promise<void> | void;
  abstract describeStatus(): AdapterStatus;
  /** The binding identity used to decide whether a reload must rebind. */
  abstract bindingSignature(config: NetworkBaseConfig): string;
}

// ---------------------------------------------------------------------------
// utils.ts
// ---------------------------------------------------------------------------

/**
 * L340875 appended to a 1009 (frame-over-cap) log line. Shared so the client and
 * server adapters cannot drift apart on the advice they give.
 */
export const MAX_PAYLOAD_HINT =
  "Raise this adapter's maxPayloadBytes, or have the peer send a smaller frame (a URL/file reference or SILK instead of inline PCM)";

/**
 * L340873 `isAuthorized`.
 *
 * Order matters: an empty token disables auth entirely. `Bearer <token>` always
 * works; a *raw* token only when `allowRawToken` (the HTTP adapter passes true,
 * the WS upgrade check passes false). Only after that does the `access_token`
 * query parameter get a chance — so a wrong query token next to a valid header
 * still authorizes.
 */
export function isAuthorized(request: IncomingMessage, token: string, allowRawToken = false): boolean {
  if (!token) return true;
  const auth = request.headers.authorization ?? "";
  if (auth === `Bearer ${token}` || (allowRawToken && auth === token)) return true;
  try {
    if (new URL(request.url ?? "/", "http://127.0.0.1").searchParams.get("access_token") === token) return true;
  } catch {
    /* a malformed url cannot carry a valid token */
  }
  return false;
}

/** L340883 `rawDataToString`: whatever the socket hands back → UTF-8 string. */
export function rawDataToString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw as Buffer[]).toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(new Uint8Array(raw)).toString("utf8");
  const view = raw as { buffer: ArrayBufferLike; byteOffset: number; byteLength: number };
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString("utf8");
}

/** The socket surface the helpers need — `WebSocket` satisfies it. */
export interface SendableSocket {
  readyState: number;
  send(payload: string, cb?: (err?: Error | null) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping?(data?: Buffer, mask?: boolean, cb?: (err?: Error) => void): void;
  on(event: string, listener: (...args: never[]) => void): void;
  off(event: string, listener: (...args: never[]) => void): void;
}

/** L340890 `safeSend`: drop the frame silently when the socket is not open. */
export function safeSend(socket: SendableSocket, payload: string, onError?: (error: Error) => void): void {
  if (socket.readyState !== 1) return;
  socket.send(payload, (error) => {
    if (error && onError) onError(error);
  });
}

/**
 * L340901 `safeSendAsync`: resolves only after `ws` flushed the payload. A
 * stream producer that awaits this cannot outrun a slow client. Any failure is
 * normalized to `StreamTransportClosedError` so the action boundary classifies a
 * cancelled stream, not a generic I/O error.
 */
export function safeSendAsync(socket: SendableSocket, payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== 1) {
      reject(new StreamTransportClosedError("stream client disconnected"));
      return;
    }
    try {
      socket.send(payload, (error) => {
        if (error) {
          reject(new StreamTransportClosedError("stream client disconnected"));
          return;
        }
        resolve();
      });
    } catch {
      reject(new StreamTransportClosedError("stream client disconnected"));
    }
  });
}

/** L340920 `safeClose`: no-op once the socket is closing or closed. */
export function safeClose(socket: SendableSocket, code = 1000, reason = "normal"): void {
  if (socket.readyState === 3 || socket.readyState === 2) return;
  socket.close(code, reason);
}

/** L340945 `startHeartbeat` options. */
export interface HeartbeatOptions {
  intervalMs: number;
  maxMissed: number;
}

/**
 * L340945 `startHeartbeat` — RFC6455 transport keepalive.
 *
 * The OneBot app-level `meta_event` heartbeat is one-way, so it cannot detect a
 * writable-but-dead link (a proxy/NAT half-open connection, issue #208). This
 * pings every `intervalMs` and counts silent intervals; *any* inbound activity
 * (pong or message) resets the counter. Death is declared once `maxMissed` pings
 * went unanswered — roughly `(maxMissed + 1) * intervalMs` of silence, because
 * the check happens at the top of a tick.
 *
 * Returns an idempotent stop function; the timer is `unref`'d.
 */
export function startHeartbeat(socket: SendableSocket, opts: HeartbeatOptions, onDead: () => void): () => void {
  let missed = 0;
  let stopped = false;
  const onActivity = () => {
    missed = 0;
  };
  socket.on("pong", onActivity);
  socket.on("message", onActivity);
  const timer = setInterval(() => {
    if (missed >= opts.maxMissed) {
      stop();
      onDead();
      return;
    }
    missed += 1;
    try {
      socket.ping?.();
    } catch {
      stop();
      onDead();
    }
  }, opts.intervalMs);
  timer.unref();
  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    socket.off("pong", onActivity);
    socket.off("message", onActivity);
  }
  return stop;
}

/** L342585 / L341814 `isAlreadyClosedError`: a close on an unbound server is not
 *  a failure — it happens when a bind failed and `close()` still runs. */
export function isAlreadyClosedError(error: Error & { code?: string }): boolean {
  return error.code === "ERR_SERVER_NOT_RUNNING";
}

/** L340977 `normalizePath`: trimmed, no trailing slash, `/` stays `/`. */
export function normalizePath(pathValue: string | undefined): string {
  const path = (pathValue ?? "/").trim() || "/";
  if (path === "/") return "/";
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

/** L340982 `parseRequestPath`: strip the query, keep everything else verbatim. */
export function parseRequestPath(urlValue: string): string {
  const queryIndex = urlValue.indexOf("?");
  return queryIndex === -1 ? urlValue : urlValue.slice(0, queryIndex);
}

/**
 * L341191 `httpTraceparent`: accept a W3C traceparent for logging without
 * letting caller-supplied ids become local request ids. The fixed shape is
 * `xx<32 hex>-<16 hex>-<2 hex>-<2 hex>` = `00-<32>-<16>-<2>-<2>`.
 */
export function httpTraceparent(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  return /^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i.test(raw.trim()) ? raw.trim() : null;
}

// ---------------------------------------------------------------------------
// ws-server-connections.ts
// ---------------------------------------------------------------------------

/** L340988 the RFC6455 ping interval for OneBot WS sessions: 30 s. */
export const HEARTBEAT_INTERVAL_MS_WS = 30000;
/** L340989 consecutive silent intervals tolerated: 2. */
export const HEARTBEAT_MAX_MISSED = 2;
/** L340990 the number quoted in the reap log line: 30*3/1000 = 90. */
export const HEARTBEAT_DEAD_AFTER_S = (HEARTBEAT_INTERVAL_MS_WS * 3) / 1000;

export type ForwardRole = "Api" | "Event" | "Universal";

/** The config slice a WS session owner reads. */
export interface WsServerConfig extends NetworkBaseConfig {
  host?: string | undefined;
  port?: number | undefined;
  path?: string | undefined;
  role?: ForwardRole | undefined;
  maxPayloadBytes?: number | undefined;
}

interface WsConnection {
  socket: WebSocket;
  role: ForwardRole;
  options: ReportOptions;
  stopHeartbeat: () => void;
}

/** The meta-event seam the session owner needs from the adapter. */
export interface MetaEventSource {
  frame(event: Record<string, unknown>, options: ReportOptions): string | null;
  bootstrap(options: ReportOptions): string[];
}

/**
 * L341000 `WsServerConnections` — the shared OneBot WebSocket session owner.
 *
 * Listener ownership deliberately stays with the adapter (standalone WS owns its
 * TCP listener; the HTTP adapter owns a shared listener and only attaches an
 * upgrade handler). This class owns everything after accept, so both transports
 * have identical auth, role, event, heartbeat, stream and shutdown semantics.
 */
export class WsServerConnections {
  readonly name: string;
  private readonly ctx: OneBotNetworkContext;
  private readonly log: Logger;
  private readonly meta: MetaEventSource;
  acceptingActions = false;
  readonly inFlightActions = new Set<Promise<void>>();
  readonly connections = new Map<WebSocket, WsConnection>();
  private config: WsServerConfig;
  private options: ReportOptions;

  constructor(name: string, config: WsServerConfig, ctx: OneBotNetworkContext, log: Logger, meta: MetaEventSource) {
    this.name = name;
    this.ctx = ctx;
    this.log = log;
    this.meta = meta;
    this.config = structuredClone(config);
    this.options = resolveReportOptions(config);
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  get isAcceptingActions(): boolean {
    return this.acceptingActions;
  }

  get hasInFlightActions(): boolean {
    return this.inFlightActions.size > 0;
  }

  startAccepting(): void {
    this.acceptingActions = true;
  }

  stopAccepting(): void {
    this.acceptingActions = false;
  }

  /** L341048 `updateConfig`: a rotated token kicks every live session (1008). */
  updateConfig(next: WsServerConfig): void {
    const tokenChanged = (this.config.accessToken ?? "") !== (next.accessToken ?? "");
    this.config = structuredClone(next);
    this.options = resolveReportOptions(next);
    for (const connection of this.connections.values()) connection.options = this.options;
    if (tokenChanged) this.disconnectAll(1008, "access token changed");
  }

  acceptsUpgradePath(requestPath: string): boolean {
    return resolveForwardRole(requestPath, this.config) !== null;
  }

  /** L341061 `onEvent`: only Event/Universal sessions receive events. */
  onEvent(payload: DispatchPayload): void {
    if (!this.acceptingActions || this.connections.size === 0) return;
    for (const connection of this.connections.values()) {
      if (connection.role !== "Event" && connection.role !== "Universal") continue;
      const json = pickDispatchJson(payload, connection.options);
      if (json === null) continue;
      safeSend(connection.socket as unknown as SendableSocket, json);
    }
  }

  /** L341072 `authorizeUpgrade`: authenticate BEFORE a socket object exists. */
  authorizeUpgrade(request: IncomingMessage): boolean {
    const authorized = isAuthorized(request, this.config.accessToken ?? "");
    if (!authorized) this.log.debug("[%s] rejected unauthorized WebSocket upgrade", this.name);
    return authorized;
  }

  /** L341077 `accept`: the post-upgrade gate. Every rejection is a close code,
   *  not an HTTP status, because the handshake already succeeded. */
  accept(socket: WebSocket, request: IncomingMessage): void {
    const sendable = socket as unknown as SendableSocket;
    if (!this.acceptingActions || this.ctx.api.isAcceptingActions === false) {
      safeClose(sendable, 1012, "server closing");
      return;
    }
    if (!this.authorizeUpgrade(request)) {
      safeClose(sendable, 1008, "invalid access token");
      return;
    }
    const role = resolveForwardRole(parseRequestPath(request.url ?? "/"), this.config);
    if (role === null) {
      this.log.warn("[%s] rejected WebSocket path after upgrade", this.name);
      safeClose(sendable, 1008, "invalid path");
      return;
    }
    const stopHeartbeat = startHeartbeat(
      sendable,
      { intervalMs: HEARTBEAT_INTERVAL_MS_WS, maxMissed: HEARTBEAT_MAX_MISSED },
      () => {
        this.log.warn("[%s] client silent for ~%ds, terminating half-open connection", this.name, HEARTBEAT_DEAD_AFTER_S);
        socket.terminate();
      },
    );
    const connection: WsConnection = { socket, role, options: this.options, stopHeartbeat };
    this.connections.set(socket, connection);
    socket.on("message", (raw: Buffer) => {
      if (!this.connections.has(socket)) return;
      if (this.ctx.api.isAcceptingActions === false) {
        this.log.warn("[%s] rejected inbound action after instance quiesce", this.name);
        if (role === "Api" || role === "Universal") {
          const text = rawDataToString(raw);
          if (text) this.ctx.api.traceQuiescedStreamRequest?.(text);
        }
        return;
      }
      this.trackInboundAction(() => this.handleApiMessage(socket, role, raw));
    });
    socket.on("close", () => {
      stopHeartbeat();
      this.connections.delete(socket);
    });
    socket.on("error", (error: Error & { code?: number }) => {
      const message = errorMessage(error);
      this.log.warn("[%s] socket error: %s", this.name, error.code === 1009 ? `${message}. ${MAX_PAYLOAD_HINT}` : message);
    });
    // Api-only sessions get no bootstrap: an action client has no event stream.
    if (role === "Event" || role === "Universal") {
      for (const frame of this.meta.bootstrap(this.options)) safeSend(sendable, frame);
    }
  }

  /** L341129 `closeConnections`: push `disable`, then close and drain. */
  async closeConnections(): Promise<void> {
    this.stopAccepting();
    const lifecycle = this.ctx.buildLifecycleEvent("disable");
    for (const connection of this.connections.values()) {
      if (connection.role === "Api") continue;
      const frame = this.meta.frame(lifecycle, connection.options);
      if (frame) safeSend(connection.socket as unknown as SendableSocket, frame);
    }
    this.disconnectAll();
    await Promise.all(this.inFlightActions);
  }

  disconnectAll(code = 1000, reason = "normal"): void {
    for (const connection of this.connections.values()) {
      connection.stopHeartbeat();
      safeClose(connection.socket as unknown as SendableSocket, code, reason);
    }
    this.connections.clear();
  }

  /** L341144 `terminateAll`: a graceful close frame can leave the listener
   *  waiting on a peer that will never answer. */
  terminateAll(): void {
    this.stopAccepting();
    for (const connection of this.connections.values()) {
      connection.stopHeartbeat();
      try {
        connection.socket.terminate();
      } catch {
        /* already gone */
      }
    }
    this.connections.clear();
  }

  /** L341156 `handleApiMessage`. */
  private async handleApiMessage(socket: WebSocket, role: ForwardRole, raw: Buffer): Promise<void> {
    const text = rawDataToString(raw);
    if (!text) {
      this.log.debug("[%s] ignored empty WebSocket frame", this.name);
      return;
    }
    if (role !== "Api" && role !== "Universal") {
      this.log.warn("[%s] rejected Action frame from Event-only connection", this.name);
      return;
    }
    await this.ctx.api.processStreamRequest(
      text,
      (frame) => safeSendAsync(socket as unknown as SendableSocket, frame),
      () => socket.readyState === 1 && this.connections.has(socket),
    );
  }

  /** L341176 `trackInboundAction`: track the promise so `close()` can drain it.
   *  Public because the standalone adapter re-exposes it as a lifecycle seam. */
  trackInboundAction(start: () => Promise<void>): void {
    if (!this.acceptingActions || this.ctx.api.isAcceptingActions === false) {
      this.log.warn("[%s] rejected inbound action while adapter is closing", this.name);
      return;
    }
    let action: Promise<void>;
    try {
      action = start();
    } catch (error) {
      this.log.error("[%s] inbound action start failed: %s", this.name, errorMessage(error));
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
}

/**
 * L341172 `resolveForwardRole`.
 *
 * A configured `role` pins the session type and also rejects a malformed path
 * (`not starting with /` or starting with `//`) so a proxy cannot smuggle a
 * cross-origin target. With no configured role the role is inferred from the
 * path suffix, and Universal additionally answers `/api` and `/event` beneath
 * a `/` base.
 */
export function resolveForwardRole(requestPath: string, config: WsServerConfig): ForwardRole | null {
  if (config.role !== undefined && (!requestPath.startsWith("/") || requestPath.startsWith("//"))) return null;
  const path = normalizePath(requestPath);
  if (config.role === undefined) return classifyForwardRole(path);
  const basePath = normalizePath(config.path);
  if (path === basePath) return config.role;
  if (config.role !== "Universal" || basePath !== "/") return null;
  if (path === "/api") return "Api";
  if (path === "/event") return "Event";
  return null;
}

/** L341183 `classifyForwardRole`. */
export function classifyForwardRole(path: string): ForwardRole {
  if (path.endsWith("/api")) return "Api";
  if (path.endsWith("/event")) return "Event";
  return "Universal";
}

export { WebSocket, WebSocketServer, buildDispatchPayload, type WebSocketServerOptions };