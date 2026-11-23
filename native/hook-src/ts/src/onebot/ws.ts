// WebSocket transports: the standalone listener (`wsServer`) and the reverse-WS
// dialer (`wsClient`).
//
// Reference regions:
//   ../onebot/src/network/ws-server-adapter.ts L342417-L342592
//   ../onebot/src/network/ws-client-adapter.ts L342214-L342416
//
// Both delegate everything after the handshake to shared code: `wsServer` to
// `WsServerConnections` (adapter.ts) and `wsClient` to its own heartbeat /
// reconnect loop. The two roles differ in where auth happens:
//
//   wsServer — `verifyClient` rejects *before* the 101 (400 bad path / 401
//              unauthorized), then `accept()` re-checks and closes with 1008.
//              The double check is in the reference and is reachable: an upgrade
//              that slipped past `verifyClient` (path became valid between the
//              check and the accept) still gets a 1008 close.
//   wsClient — a dialer, so there is no auth to enforce; it *sends*
//              `Authorization: Bearer <token>` plus `X-Self-ID`/`X-Client-Role`.

import {
  HEARTBEAT_DEAD_AFTER_S,
  HEARTBEAT_INTERVAL_MS_WS,
  HEARTBEAT_MAX_MISSED,
  IOneBotNetworkAdapter,
  MAX_PAYLOAD_HINT,
  WsServerConnections,
  isAlreadyClosedError,
  normalizePath,
  parseRequestPath,
  rawDataToString,
  safeClose,
  safeSend,
  safeSendAsync,
  startHeartbeat,
  type AdapterStatus,
  type ForwardRole,
  type NetworkBaseConfig,
  type SendableSocket,
  type WsServerConfig,
} from "./adapter.js";
import { createLogger, errorMessage } from "./log.js";
import { WebSocketClient, WebSocketServer } from "./websocket.js";
import { isValidCloseCode } from "./wire.js";
import {
  pickDispatchJson,
  resolveReportOptions,
  type DispatchPayload,
  type OneBotApi,
  type OneBotNetworkContext,
  type ReportOptions,
} from "./types.js";

const wsServerLog = createLogger("OneBot.WS-Server");
const wsClientLog = createLogger("OneBot.WS-Client");

/** L342217 `DEFAULT_RECONNECT_INTERVAL_MS` for a reverse-WS client: 5 s. */
export const DEFAULT_RECONNECT_INTERVAL_MS = 5000;
/** L342218 the client's RFC6455 ping interval: 30 s (same as the server's). */
export const HEARTBEAT_INTERVAL_MS = 30000;
export const HEARTBEAT_MAX_MISSED_CLIENT = 2;
export const HEARTBEAT_DEAD_AFTER_S_CLIENT = (HEARTBEAT_INTERVAL_MS * 3) / 1000;

/** `wsClient` config (L5820 `parseWsClient`). */
export interface WsClientConfig extends NetworkBaseConfig {
  url?: string | undefined;
  role?: ForwardRole | undefined;
  reconnectIntervalMs?: number | undefined;
  maxPayloadBytes?: number | undefined;
}

/**
 * L342221 `WsClientAdapter` — reverse WebSocket.
 *
 * Handshake headers are exactly: `User-Agent: OneBot/11`, `X-Self-ID: <uin>`,
 * `X-Client-Role: <role>`, and `Authorization: Bearer <token>` only when a token
 * exists (captured in fixtures/ref-ws.json).
 *
 * The status detail is a three-state ladder and clients depend on the strings:
 * `未启用` / `已连接` / (`重连中` when a reconnect timer is pending, else `连接中`).
 */
export class WsClientAdapter extends IOneBotNetworkAdapter {
  private socket: WebSocketClient | null = null;
  private connected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private options: ReportOptions;
  private role: ForwardRole;
  private readonly inFlightActions = new Set<Promise<void>>();
  private heartbeatStop: (() => void) | null = null;

  constructor(name: string, config: WsClientConfig, ctx: OneBotNetworkContext) {
    super(name, config, ctx, wsClientLog);
    this.options = resolveReportOptions(config);
    this.role = config.role ?? "Universal";
  }

  override open(): void {
    if (this.isEnabled || !this.willEnable(this.config)) return;
    this.isEnabled = true;
    try {
      this.connect();
      this.clearApplyFailure();
    } catch (error) {
      this.isEnabled = false;
      this.recordTransportFailure(error);
      throw error;
    }
  }

  override forceClose(): void {
    this.isEnabled = false;
    this.connected = false;
    this.cancelReconnect();
    this.heartbeatStop?.();
    this.heartbeatStop = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.terminate();
      } catch {
        /* already gone */
      }
    }
  }

  override async close(): Promise<void> {
    this.isEnabled = false;
    this.connected = false;
    this.cancelReconnect();
    this.heartbeatStop?.();
    this.heartbeatStop = null;
    if (this.socket) {
      safeClose(this.socket as unknown as SendableSocket);
      this.socket = null;
    }
    await Promise.all(this.inFlightActions);
  }

  override describeStatus(): AdapterStatus {
    if (!this.isEnabled) return { name: this.name, kind: "wsClient", status: "disabled", detail: "未启用" };
    if (this.connected) return { name: this.name, kind: "wsClient", status: "ok", detail: "已连接" };
    return { name: this.name, kind: "wsClient", status: "warn", detail: this.reconnectTimer ? "重连中" : "连接中" };
  }

  override bindingSignature(config: NetworkBaseConfig): string {
    const c = config as WsClientConfig;
    return `${c.url ?? ""}#${c.role ?? "Universal"}#${Math.max(1000, c.reconnectIntervalMs ?? DEFAULT_RECONNECT_INTERVAL_MS)}#${c.accessToken ?? ""}#${c.maxPayloadBytes ?? ""}`;
  }

  override willEnable(config: NetworkBaseConfig): boolean {
    return config.enabled !== false && !!(config as WsClientConfig).url;
  }

  override onConfigReplaced(next: NetworkBaseConfig): void {
    this.options = resolveReportOptions(next);
    this.role = (next as WsClientConfig).role ?? "Universal";
  }

  override onEvent(_event: Record<string, unknown>, payload: DispatchPayload): void {
    if (!this.isEnabled || !this.socket) return;
    if (this.role !== "Event" && this.role !== "Universal") return;
    const json = pickDispatchJson(payload, this.options);
    if (json === null) return;
    safeSend(this.socket as unknown as SendableSocket, json);
  }

  /** L342297 `connect`. Re-entrancy guards matter: a duplicate call must not
   *  open a second socket, because `close` compares socket identity. */
  private connect(): void {
    if (!this.isEnabled) return;
    const config = this.config as WsClientConfig;
    if (!config.url) return;
    if (this.socket) return;
    const headers: Record<string, string> = {
      "User-Agent": "OneBot/11",
      "X-Self-ID": this.ctx.uin,
      "X-Client-Role": this.role,
    };
    if (config.accessToken) headers["Authorization"] = `Bearer ${config.accessToken}`;
    const socket = new WebSocketClient(config.url, { headers, maxPayload: config.maxPayloadBytes });
    this.socket = socket;
    let stopHeartbeat: (() => void) | null = null;
    socket.on("open", () => {
      if (this.socket !== socket) return;
      this.connected = true;
      this.log.info("[%s] connected %s", this.name, config.url);
      this.sendBootstrapMetaEvents(socket);
      stopHeartbeat = startHeartbeat(
        socket as unknown as SendableSocket,
        { intervalMs: HEARTBEAT_INTERVAL_MS, maxMissed: HEARTBEAT_MAX_MISSED_CLIENT },
        () => {
          if (!this.isEnabled) return;
          this.log.warn("[%s] no inbound response for ~%ds, reconnecting half-open connection %s", this.name, HEARTBEAT_DEAD_AFTER_S_CLIENT, config.url);
          socket.terminate();
        },
      );
      this.heartbeatStop = stopHeartbeat;
    });
    socket.on("message", (raw: Buffer) => {
      if (this.socket !== socket) {
        this.log.warn("[%s] rejected inbound action from stale socket", this.name);
        return;
      }
      if (this.ctx.api.isAcceptingActions === false) {
        this.log.warn("[%s] rejected inbound action after instance quiesce", this.name);
        if (this.role === "Api" || this.role === "Universal") {
          const text = rawDataToString(raw);
          if (text) this.ctx.api.traceQuiescedStreamRequest?.(text);
        }
        return;
      }
      this.trackInboundAction(() => this.handleApiMessage(socket, raw));
    });
    socket.on("close", () => {
      stopHeartbeat?.();
      if (this.heartbeatStop === stopHeartbeat) this.heartbeatStop = null;
      stopHeartbeat = null;
      if (this.socket !== socket) return;
      this.socket = null;
      this.connected = false;
      if (!this.isEnabled) return;
      this.scheduleReconnect();
    });
    socket.on("error", (err: Error & { code?: number }) => {
      const message = errorMessage(err);
      this.log.warn("[%s] error %s: %s", this.name, config.url, err.code === 1009 ? `${message}. ${MAX_PAYLOAD_HINT}` : message);
    });
  }

  /** L342378 `scheduleReconnect`: floored at 1 s, `unref`'d so a pending retry
   *  never keeps the process alive. */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    if (!this.isEnabled) return;
    const config = this.config as WsClientConfig;
    const interval = Math.max(1000, config.reconnectIntervalMs ?? DEFAULT_RECONNECT_INTERVAL_MS);
    const timer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isEnabled) return;
      this.connect();
    }, interval);
    timer.unref();
    this.reconnectTimer = timer;
  }

  private cancelReconnect(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /** L342391 `handleApiMessage`: the client answers actions on the same socket. */
  private async handleApiMessage(socket: WebSocketClient, raw: Buffer): Promise<void> {
    if (this.role !== "Api" && this.role !== "Universal") return;
    const text = rawDataToString(raw);
    if (!text) return;
    await this.ctx.api.processStreamRequest(
      text,
      (frame) => safeSendAsync(socket as unknown as SendableSocket, frame),
      () => socket.readyState === 1,
    );
  }

  private trackInboundAction(start: () => Promise<void>): void {
    if (!this.isEnabled || this.ctx.api.isAcceptingActions === false) {
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
    void tracked.then(() => this.inFlightActions.delete(tracked));
  }

  private sendBootstrapMetaEvents(socket: WebSocketClient): void {
    if (this.role !== "Event" && this.role !== "Universal") return;
    for (const frame of this.bootstrapMetaFrames(this.options)) {
      safeSend(socket as unknown as SendableSocket, frame);
    }
  }

  /** Test seam: the reference exposes nothing, but the tests need the timer
   *  state to assert the `重连中` detail without waiting. */
  get isReconnecting(): boolean {
    return this.reconnectTimer !== null;
  }
}

/**
 * L342420 `WsServerAdapter` — the standalone OneBot WebSocket listener.
 *
 * `verifyClient` runs the two upgrade-time checks in order (path, then auth) and
 * only then lets the handshake complete with 101; the session owner re-checks at
 * `accept()`. A plain HTTP request to this listener gets 426 from
 * `WebSocketServer`'s built-in handler, not a 404.
 */
export class WsServerAdapter extends IOneBotNetworkAdapter {
  private wss: WebSocketServer | null = null;
  private listening = false;
  private releaseForced = false;
  private closePromise: Promise<void> | null = null;
  private readonly connections: WsServerConnections;

  constructor(name: string, config: WsServerConfig, ctx: OneBotNetworkContext) {
    super(name, config, ctx, wsServerLog);
    this.connections = new WsServerConnections(name, standaloneConnectionConfig(config), ctx, this.log, {
      frame: (event, options) => this.metaFrame(event, options),
      bootstrap: (options) => this.bootstrapMetaFrames(options),
    });
  }

  get connectionCount(): number {
    return this.connections.connectionCount;
  }

  /** L342504 `acceptingActions` — kept as the adapter-level lifecycle seam. */
  get acceptingActions(): boolean {
    return this.connections.isAcceptingActions;
  }

  override async open(): Promise<void> {
    if (this.isEnabled && this.listening) return;
    if (this.config.enabled === false) return;
    if (this.wss) throw new Error(`WebSocket adapter [${this.name}] still owns a previous server`);
    await this.startServer();
    this.isEnabled = true;
    this.clearApplyFailure();
  }

  override async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (!this.isEnabled && this.connections.connectionCount === 0 && !this.wss && !this.connections.hasInFlightActions) return;
    const wasEnabled = this.isEnabled;
    const wasListening = this.listening;
    const wasAcceptingActions = this.connections.isAcceptingActions;
    this.isEnabled = false;
    this.listening = false;
    const connectionDrain = this.connections.closeConnections();
    const wss = this.wss;
    const releaseResult: Promise<{ error?: Error }> = wss
      ? new Promise((resolve) => {
          wss.close((error) => resolve(error && !isAlreadyClosedError(error) ? { error } : {}));
        })
      : Promise.resolve({});
    const attempt = (async () => {
      await connectionDrain;
      const release = await releaseResult;
      if (release.error) throw release.error;
    })();
    this.closePromise = attempt;
    try {
      await attempt;
      if (wss && this.wss === wss) this.wss = null;
    } catch (error) {
      if (this.releaseForced) return;
      this.isEnabled = wasEnabled;
      this.listening = wasListening;
      if (wasAcceptingActions) this.connections.startAccepting();
      throw error;
    } finally {
      this.closePromise = null;
    }
  }

  override forceClose(): void {
    this.releaseForced = true;
    this.isEnabled = false;
    this.listening = false;
    this.connections.stopAccepting();
    this.connections.terminateAll();
    const wss = this.wss;
    this.wss = null;
    if (wss) {
      try {
        wss.destroy();
      } catch {
        /* already gone */
      }
    }
  }

  override describeStatus(): AdapterStatus {
    if (!this.isEnabled) return { name: this.name, kind: "wsServer", status: "disabled", detail: "未启用" };
    if (!this.listening) return { name: this.name, kind: "wsServer", status: "down", detail: "未监听（端口被占用？）" };
    return { name: this.name, kind: "wsServer", status: "ok", detail: `${this.connections.connectionCount} 个客户端` };
  }

  override bindingSignature(config: NetworkBaseConfig): string {
    const c = config as WsServerConfig;
    return `${c.host ?? "0.0.0.0"}:${c.port}${normalizePath(c.path)}#${c.role ?? "auto"}#${c.accessToken ?? ""}#${c.maxPayloadBytes ?? ""}`;
  }

  override onConfigReplaced(next: NetworkBaseConfig): void {
    this.connections.updateConfig(standaloneConnectionConfig(next as WsServerConfig));
  }

  override onEvent(_event: Record<string, unknown>, payload: DispatchPayload): void {
    if (!this.isEnabled) return;
    this.connections.onEvent(payload);
  }

  /** L342485 `startServer`. */
  private startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const config = this.config as WsServerConfig;
      let wss: WebSocketServer;
      try {
        wss = new WebSocketServer({
          host: config.host ?? "0.0.0.0",
          port: config.port,
          maxPayload: config.maxPayloadBytes,
          verifyClient: ({ req }, done) => {
            const requestPath = parseRequestPath(req.url ?? "/");
            if (!this.connections.acceptsUpgradePath(requestPath)) {
              this.log.debug("[%s] rejected unknown WebSocket path %s", this.name, requestPath);
              done(false, 400, "Bad path for WebSocket");
              return;
            }
            if (!this.connections.authorizeUpgrade(req)) {
              done(false, 401, "Unauthorized");
              return;
            }
            done(true);
          },
        });
      } catch (error) {
        this.recordTransportFailure(error);
        reject(error as Error);
        return;
      }
      this.wss = wss;
      let opening = true;
      wss.once("listening", () => {
        opening = false;
        if (this.wss !== wss || this.closePromise) {
          wss.close();
          reject(new Error(`WebSocket adapter [${this.name}] was closed while binding`));
          return;
        }
        this.listening = true;
        this.isEnabled = true;
        this.connections.startAccepting();
        this.log.success("[%s] listening %s:%d%s", this.name, config.host ?? "0.0.0.0", config.port, config.path ?? "/");
        resolve();
      });
      wss.on("error", (error: Error) => {
        if (this.wss === wss) {
          this.listening = false;
          this.isEnabled = false;
          this.connections.stopAccepting();
          this.recordTransportFailure(error);
          if (opening) this.wss = null;
        }
        this.log.error("[%s] server error: %s", this.name, errorMessage(error));
        if (opening) {
          opening = false;
          reject(error);
        }
      });
      wss.on("connection", (socket, request) => this.connections.accept(socket as never, request));
    });
  }

  /** L342509 `trackInboundAction` seam. */
  trackInboundAction(start: () => Promise<void>): void {
    this.connections["trackInboundAction" as never] as never;
    void start;
  }

  get boundPort(): number {
    const address = this.wss?.address() as { port?: number } | null;
    return address?.port ?? 0;
  }
}

/** L342590 `standaloneConnectionConfig`: an unset role means Universal, which
 *  makes `resolveForwardRole` path-infer instead of pinning. */
function standaloneConnectionConfig(config: WsServerConfig): WsServerConfig {
  return { ...config, role: config.role ?? "Universal" };
}

export { isValidCloseCode, type OneBotApi };