// WebSocket transport (`../websocket/src/*`).
//
// Reference regions (1-based inclusive lines in reference/index.mjs):
//   ../websocket/src/extensions.ts L339804-L339940  permessage-deflate, close codes,
//                                                   Utf8Validator, scanOversizedFrame
//   ../websocket/src/native.ts     L339733-L339803  the prebuilt addon's surface
//   ../websocket/src/server.ts     L340453-L340667  WebSocketServer + abortUpgrade
//   ../websocket/src/client.ts     L340668-L340862  WebSocketClient handshake
//   ../websocket/src/index.ts      L340863-L340866  WebSocketClient.Server = WebSocketServer
//   (the WebSocket class itself is L340063-L340452, emitted between extensions.ts
//    and server.ts in the bundle)
//
// The reference's `WebSocket$1` is NOT the `ws` package: it is a hand-rolled class
// over a native addon that only exposes `Parser`, `buildFrame`,
// `computeAcceptKey` and `sha1Base64`. `wire.ts` re-implements the addon
// (verified byte-for-byte against the real .node binary); this file re-implements
// the class on top of it.
//
// Notable reference behaviours kept as-is:
//   * `abortUpgrade` in the source looks like it emits a malformed head (a bare
//     `\r` followed by a newline). The template's line continuations resolve to
//     `\r\n`, so the bytes on the wire are well-formed. Captured raw in
//     fixtures/ref-ws-handshake.json; reproduced literally here.
//   * A control frame with RSV1 set is rejected ("Control frame RSV bits must be
//     zero") even when permessage-deflate negotiated RSV1 for data frames.
//   * An oversized frame is reported with its byte size and opcode label,
//     recovered by re-walking retained bytes (`scanOversizedFrame`), because the
//     addon only says "Payload exceeds configured max".

import { EventEmitter } from "node:events";
import { STATUS_CODES, createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect as netConnect, isIP, type NetConnectOpts } from "node:net";
import { connect as tlsConnect } from "node:tls";
import type { Server as HttpServer, IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { URL as NodeURL } from "node:url";

import {
  FrameParser,
  Utf8Validator,
  acceptPerMessageDeflate,
  buildFrame,
  chooseSubprotocol,
  compressRaw,
  computeAcceptKey,
  decompressRaw,
  encodeClosePayload,
  isValidCloseCode,
  offerPerMessageDeflate,
  opcodeLabel,
  parseAcceptedPerMessageDeflate,
  randomMaskKey,
  randomWebSocketKey,
  scanOversizedFrame,
  type AcceptedPerMessageDeflate,
  type PerMessageDeflate,
  type WireFrame,
} from "./wire.js";

/** L339984 `DIAG_BUFFER_LIMIT` — budget for re-reading an oversized frame. */
const DIAG_BUFFER_LIMIT = 64 * 1024;

/** L340063 default `maxPayload` when the option is omitted: 100 MB. */
const DEFAULT_MAX_PAYLOAD = 104857600;

/** L340835 handshake response cap before the client gives up. */
const MAX_HANDSHAKE_BYTES = 16384;

export interface WebSocketOptions {
  isServer?: boolean | undefined;
  maxPayload?: number | undefined;
  readyState?: number | undefined;
  protocol?: string | undefined;
  extensions?: { perMessageDeflate?: AcceptedPerMessageDeflate } | undefined;
}

/**
 * L340063 `WebSocket$1`: one accepted socket, with message reassembly, UTF-8
 * validation, close handshake and the payload cap.
 */
export class WebSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  /** L340865: `WebSocketClient.Server = WebSocketServer` lives on the client. */
  static Server: unknown;

  readonly protocol: string;
  readonly extensions: string;

  private readonly _socket: Duplex;
  private readonly _isServer: boolean;
  private readonly _maxPayload: number;
  private _readyState: number;
  private readonly _perMessageDeflate: AcceptedPerMessageDeflate | undefined;
  private readonly _parser: FrameParser;
  private _msgOpcode = 0;
  private _msgChunks: Buffer[] = [];
  private _msgSize = 0;
  private _msgValidator: Utf8Validator | null = null;
  private _msgCompressed = false;
  private _diagChunks: Buffer[] = [];
  private _diagBytes = 0;
  private _diagOverflow = false;
  private _closeCodeSent: number | null = null;
  private _closeCodeReceived: number | null = null;
  private _closeReasonReceived = "";
  private _closeFrameSent = false;
  private _closeTimer: NodeJS.Timeout | null = null;

  constructor(socket: Duplex, options: WebSocketOptions = {}) {
    super();
    this._socket = socket;
    this._isServer = options.isServer === true;
    this._maxPayload = options.maxPayload ?? DEFAULT_MAX_PAYLOAD;
    this._readyState = options.readyState ?? 1;
    this._perMessageDeflate = options.extensions?.perMessageDeflate;
    this.protocol = options.protocol ?? "";
    this.extensions = this._perMessageDeflate ? "permessage-deflate" : "";
    this._parser = new FrameParser({
      isServer: this._isServer,
      maxPayload: this._maxPayload,
      allowedRsv: this._perMessageDeflate ? 64 : 0,
    });
    this._bindSocket();
  }

  get readyState(): number {
    return this._readyState;
  }

  get isServer(): boolean {
    return this._isServer;
  }

  private _bindSocket(): void {
    const sock = this._socket as Duplex & {
      setTimeout?: (ms: number) => unknown;
      setNoDelay?: (on: boolean) => unknown;
    };
    sock.on("data", (chunk: Buffer) => this._onData(chunk));
    sock.on("end", () => this._onEnd());
    sock.on("close", () => this._onSocketClose());
    sock.on("error", (err: Error) => this._onError(err));
  }

  /** L340149 `_onData`. Public in the reference (`@internal`) so a server can
   *  replay the bytes that arrived with the upgrade request. */
  _onData(chunk: Buffer): void {
    if (this._readyState === WebSocket.CLOSED) return;
    this._recordDiagnosticBytes(chunk);
    const res = this._parser.push(chunk);
    if (res.error) {
      this._failConnection(res.code ?? 1002, this._describeParseError(res));
      return;
    }
    for (const frame of res.frames) {
      this._consumeDiagnosticFrame(frame);
      this._handleFrame(frame);
      if (this._readyState === WebSocket.CLOSED) return;
    }
  }

  /** L340170 `_describeParseError`. */
  private _describeParseError(res: { code?: number; message?: string }): string {
    const message = res.message || "Protocol error";
    if (res.code !== 1009) return message;
    const info = this._scanDiagnosticBytes();
    this._resetDiagnosticBytes();
    const limit = `${this._maxPayload} byte limit (maxPayloadBytes)`;
    if (!info) return `${message}: an inbound frame exceeds the ${limit}`;
    return `${message}: ${info.payloadBytes} B ${opcodeLabel(info.opcode)} frame exceeds the ${limit}`;
  }

  /** L340182 `_recordDiagnosticBytes`. */
  private _recordDiagnosticBytes(chunk: Buffer): void {
    this._diagBytes += chunk.length;
    if (this._diagOverflow) return;
    if (this._diagBytes > DIAG_BUFFER_LIMIT) {
      this._diagOverflow = true;
      this._diagChunks = [];
      return;
    }
    this._diagChunks.push(chunk);
  }

  /** L340192 `_consumeDiagnosticFrame` — drop the bytes of a frame the parser
   *  already turned into an event, so the buffer starts at the first unparsed
   *  frame. The header length is recomputed from the payload size. */
  private _consumeDiagnosticFrame(frame: WireFrame): void {
    const payloadBytes = frame.payload.length;
    let remaining = 2 + (payloadBytes <= 125 ? 0 : payloadBytes <= 65535 ? 2 : 8) + (this._isServer ? 4 : 0) + payloadBytes;
    this._diagBytes -= remaining;
    if (this._diagBytes === 0) {
      this._resetDiagnosticBytes();
      return;
    }
    if (this._diagOverflow) return;
    let consumed = 0;
    while (remaining > 0) {
      const chunk = this._diagChunks[consumed] as Buffer;
      if (remaining < chunk.length) {
        this._diagChunks[consumed] = chunk.subarray(remaining);
        break;
      }
      remaining -= chunk.length;
      consumed += 1;
    }
    this._diagChunks.splice(0, consumed);
  }

  private _resetDiagnosticBytes(): void {
    this._diagChunks = [];
    this._diagBytes = 0;
    this._diagOverflow = false;
  }

  private _scanDiagnosticBytes(): { opcode: number; payloadBytes: number } | null {
    if (this._diagOverflow || this._diagChunks.length === 0) return null;
    return scanOversizedFrame(
      this._diagChunks.length === 1 ? (this._diagChunks[0] as Buffer) : Buffer.concat(this._diagChunks, this._diagBytes),
      this._maxPayload,
    );
  }

  /** L340221 `_onEnd`: a peer that ends without a close frame is 1006. */
  private _onEnd(): void {
    if (this._readyState !== WebSocket.CLOSED) {
      if (this._closeCodeReceived === null) {
        this._closeCodeReceived = 1006;
        this._closeReasonReceived = "";
      }
      this._destroySocket();
    }
  }

  /** L340230 `_onSocketClose`. */
  private _onSocketClose(): void {
    if (this._readyState === WebSocket.CLOSED) return;
    if (this._closeCodeReceived === null) this._closeCodeReceived = 1006;
    this._readyState = WebSocket.CLOSED;
    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }
    this.emit("close", this._closeCodeReceived, this._closeReasonReceived);
  }

  private _onError(err: Error): void {
    this.emit("error", err);
  }

  /** L340245 `_handleFrame`: ping/pong/close first, then data + continuation. */
  private _handleFrame(frame: WireFrame): void {
    const { fin, opcode, payload } = frame;
    const rsv = frame.rsv ?? 0;
    if (opcode === 9) {
      this.emit("ping", payload);
      if (this._readyState === WebSocket.OPEN) this._sendControl(10, payload);
      return;
    }
    if (opcode === 10) {
      this.emit("pong", payload);
      return;
    }
    if (opcode === 8) {
      this._handleCloseFrame(payload);
      return;
    }
    if (opcode === 1 || opcode === 2) {
      if (this._msgOpcode !== 0) {
        this._failConnection(1002, "New data frame started before previous fragmented message finished");
        return;
      }
      if ((rsv & 64) !== 0 && !this._perMessageDeflate) {
        this._failConnection(1002, "Compressed frame without negotiated permessage-deflate");
        return;
      }
      this._msgOpcode = opcode;
      this._msgChunks = [];
      this._msgSize = 0;
      this._msgCompressed = (rsv & 64) !== 0;
      this._msgValidator = opcode === 1 ? new Utf8Validator() : null;
    } else if (opcode === 0) {
      if (this._msgOpcode === 0) {
        this._failConnection(1002, "Continuation frame without active message");
        return;
      }
      if (rsv !== 0) {
        this._failConnection(1002, "RSV bits set on continuation frame");
        return;
      }
    }
    this._msgSize += payload.length;
    // Note: the class applies the cap to the *whole message* here, on top of the
    // parser's per-frame check.
    if (this._msgSize > this._maxPayload) {
      this._failConnection(
        1009,
        `Message too large: ${this._msgSize} B ${opcodeLabel(this._msgOpcode)} message exceeds the ${this._maxPayload} byte limit (maxPayloadBytes)`,
      );
      return;
    }
    if (payload.length > 0) this._msgChunks.push(payload);
    if (!fin) return;
    let data = this._msgChunks.length === 1 ? (this._msgChunks[0] as Buffer) : Buffer.concat(this._msgChunks, this._msgSize);
    if (this._msgCompressed) {
      try {
        data = decompressRaw(data, this._maxPayload);
      } catch (err) {
        const e = err as Error & { code?: number };
        this._failConnection(e.code || 1007, e.message || "Invalid compressed payload");
        return;
      }
    }
    if (this._msgValidator) {
      if (!this._msgValidator.push(data) || !this._msgValidator.done()) {
        this._failConnection(1007, "Invalid UTF-8");
        return;
      }
    }
    const isBinary = this._msgOpcode === 2;
    this._msgOpcode = 0;
    this._msgChunks = [];
    this._msgSize = 0;
    this._msgValidator = null;
    this._msgCompressed = false;
    this.emit("message", data, isBinary);
  }

  /** L340296 `_handleCloseFrame`: 1005 is "no code", 1-byte payload is illegal. */
  private _handleCloseFrame(payload: Buffer): void {
    let code = 1005;
    let reason = "";
    if (payload.length === 1) {
      this._failConnection(1002, "Close payload length 1");
      return;
    }
    if (payload.length >= 2) {
      code = payload.readUInt16BE(0);
      if (!isValidCloseCode(code)) {
        this._failConnection(1002, "Invalid close code");
        return;
      }
      if (payload.length > 2) {
        try {
          reason = new TextDecoder("utf-8", { fatal: true }).decode(payload.subarray(2));
        } catch {
          this._failConnection(1007, "Invalid UTF-8 in close reason");
          return;
        }
      }
    }
    this._closeCodeReceived = code;
    this._closeReasonReceived = reason;
    if (this._readyState === WebSocket.OPEN) {
      this._readyState = WebSocket.CLOSING;
      this._sendControl(8, encodeClosePayload(code === 1005 ? undefined : code, ""));
      this._closeFrameSent = true;
      this._endSocketSoon();
    } else if (this._readyState === WebSocket.CLOSING) {
      this._endSocketSoon();
    }
  }

  /** L340325 `_endSocketSoon`: graceful half-close then a 30 s destroy timer. */
  private _endSocketSoon(): void {
    try {
      this._socket.end();
    } catch {
      /* already gone */
    }
    if (this._closeTimer) clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => this._destroySocket(), 30000);
    this._closeTimer.unref?.();
  }

  private _destroySocket(): void {
    try {
      this._socket.destroy();
    } catch {
      /* already gone */
    }
  }

  /** L340340 `_failConnection`: emit `error` with the code attached, then a
   *  close frame and a 2 s destroy timer. */
  private _failConnection(code: number, reason: string): void {
    if (this._readyState === WebSocket.CLOSED) return;
    const payload = encodeClosePayload(code, reason);
    let frame: Buffer | null = null;
    try {
      frame = buildFrame(8, true, payload, this._isServer ? null : randomMaskKey(), 0);
    } catch {
      /* an unencodable reason must still fail the connection */
    }
    this._closeCodeSent = code;
    this._readyState = WebSocket.CLOSING;
    const err = new Error(`WebSocket protocol error: ${reason}`) as Error & { code?: number };
    err.code = code;
    this.emit("error", err);
    try {
      if (frame) this._socket.end(frame);
      else this._socket.end();
    } catch {
      /* already gone */
    }
    if (this._closeTimer) clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => this._destroySocket(), 2000);
    this._closeTimer.unref?.();
  }

  /** L340357 `_sendControl`. */
  private _sendControl(opcode: number, payload?: Buffer): void {
    const data = payload ?? Buffer.alloc(0);
    const frame = buildFrame(opcode, true, data, this._isServer ? null : randomMaskKey(), 0);
    this._socket.write(frame);
  }

  /** L340373 `send`. Strings are text unless `binary`; buffers are binary
   *  unless `binary: false`. Compression only above the negotiated threshold. */
  send(
    data: string | Buffer | Uint8Array | ArrayBuffer,
    options?: { binary?: boolean; compress?: boolean } | ((err?: Error) => void),
    cb?: (err?: Error) => void,
  ): void {
    let opts: { binary?: boolean; compress?: boolean };
    let callback = cb;
    if (typeof options === "function") {
      callback = options;
      opts = {};
    } else {
      opts = options ?? {};
    }
    if (this._readyState !== WebSocket.OPEN) {
      const err = new Error("WebSocket is not open");
      if (callback) {
        callback(err);
        return;
      }
      throw err;
    }
    let payload: Buffer;
    let opcode: number;
    if (typeof data === "string") {
      payload = Buffer.from(data, "utf8");
      opcode = opts.binary ? 2 : 1;
    } else if (Buffer.isBuffer(data)) {
      payload = data;
      opcode = opts.binary === false ? 1 : 2;
    } else if (data instanceof Uint8Array) {
      payload = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      opcode = opts.binary === false ? 1 : 2;
    } else if (data instanceof ArrayBuffer) {
      payload = Buffer.from(data);
      opcode = opts.binary === false ? 1 : 2;
    } else {
      const err = new TypeError("Unsupported data type for send()");
      if (callback) {
        callback(err);
        return;
      }
      throw err;
    }
    let rsv = 0;
    if (this._perMessageDeflate && opts.compress !== false && payload.length >= (this._perMessageDeflate.threshold ?? 1024)) {
      payload = compressRaw(payload);
      rsv = 64;
    }
    const frame = buildFrame(opcode, true, payload, this._isServer ? null : randomMaskKey(), rsv);
    this._socket.write(frame, callback as ((err?: Error | null) => void) | undefined);
  }

  ping(data?: Buffer | ((err?: Error) => void), _mask?: boolean, cb?: (err?: Error) => void): void {
    let payload: Buffer;
    let callback = cb;
    if (typeof data === "function") {
      callback = data;
      payload = Buffer.alloc(0);
    } else {
      payload = data ?? Buffer.alloc(0);
    }
    if (this._readyState !== WebSocket.OPEN) {
      const err = new Error("WebSocket is not open");
      if (callback) {
        callback(err);
        return;
      }
      throw err;
    }
    const frame = buildFrame(9, true, payload, this._isServer ? null : randomMaskKey(), 0);
    this._socket.write(frame, callback as ((err?: Error | null) => void) | undefined);
  }

  pong(data?: Buffer | ((err?: Error) => void), _mask?: boolean, cb?: (err?: Error) => void): void {
    let payload: Buffer;
    let callback = cb;
    if (typeof data === "function") {
      callback = data;
      payload = Buffer.alloc(0);
    } else {
      payload = data ?? Buffer.alloc(0);
    }
    if (this._readyState !== WebSocket.OPEN) {
      const err = new Error("WebSocket is not open");
      if (callback) {
        callback(err);
        return;
      }
      throw err;
    }
    const frame = buildFrame(10, true, payload, this._isServer ? null : randomMaskKey(), 0);
    this._socket.write(frame, callback as ((err?: Error | null) => void) | undefined);
  }

  /** L340415 `close`: rejects an invalid code and a >123-byte reason. */
  close(code?: number, reason?: string): void {
    if (this._readyState === WebSocket.CLOSED || this._readyState === WebSocket.CLOSING) return;
    if (code !== undefined && !isValidCloseCode(code)) throw new RangeError(`Invalid close code: ${code}`);
    if ((reason ? Buffer.from(String(reason), "utf8") : Buffer.alloc(0)).length > 123) {
      throw new RangeError("Close reason must be <=123 bytes");
    }
    const payload = encodeClosePayload(code, reason);
    const frame = buildFrame(8, true, payload, this._isServer ? null : randomMaskKey(), 0);
    this._readyState = WebSocket.CLOSING;
    this._closeCodeSent = code ?? null;
    this._socket.write(frame);
    this._closeFrameSent = true;
    this._endSocketSoon();
  }

  terminate(): void {
    this._readyState = WebSocket.CLOSING;
    this._destroySocket();
  }
}

/** Options accepted by `new WebSocketServer(...)`. */
export interface WebSocketServerOptions {
  port?: number | undefined;
  host?: string | undefined;
  server?: HttpServer | undefined;
  noServer?: boolean | undefined;
  path?: string | undefined;
  maxPayload?: number | undefined;
  verifyClient?:
    | ((
        info: { origin?: string | undefined; secure: boolean; req: IncomingMessage },
      ) => boolean)
    | ((
        info: { origin?: string | undefined; secure: boolean; req: IncomingMessage },
        cb: (allow: boolean, code?: number, message?: string) => void,
      ) => void)
    | undefined;
  protocols?: string | string[] | Set<string> | ((requested: string[]) => string | null | undefined) | undefined;
  perMessageDeflate?: PerMessageDeflate | boolean | undefined;
  backlog?: number | undefined;
  tls?: Record<string, unknown> | undefined;
}

/**
 * L340460 `abortUpgrade`.
 *
 * The reference writes this head from a multi-line template literal whose
 * continuation lines end in a bare `\r`, which reads like a malformed response.
 * The continuations contribute `\n`, so the bytes on the wire are the
 * well-formed `\r\n` sequence captured in fixtures/ref-ws-handshake.json
 * (e.g. 400 "Bad path for WebSocket" → 22-byte body). Written explicitly here
 * and asserted against those fixtures rather than copied literally.
 */
function abortUpgrade(socket: Duplex, status: number, message?: string): void {
  try {
    const body = message ? message : (STATUS_CODES[status] ?? "");
    const head = `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? "Error"}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\nContent-Type: text/plain\r\n\r\n`;
    socket.write(head + body);
  } catch {
    /* peer already gone */
  }
  try {
    socket.destroy();
  } catch {
    /* peer already gone */
  }
}

/** L340478 `TLS_OPTION_KEYS` + L340503 `getTlsOptions`. */
const TLS_OPTION_KEYS = [
  "ALPNProtocols",
  "SNICallback",
  "ca",
  "cert",
  "ciphers",
  "clientCertEngine",
  "crl",
  "dhparam",
  "ecdhCurve",
  "honorCipherOrder",
  "key",
  "maxVersion",
  "minVersion",
  "passphrase",
  "pfx",
  "privateKeyEngine",
  "privateKeyIdentifier",
  "requestCert",
  "rejectUnauthorized",
  "secureOptions",
  "secureProtocol",
  "sessionIdContext",
  "sigalgs",
  "ticketKeys",
] as const;

function getTlsOptions(options: Record<string, unknown>): Record<string, unknown> {
  const tlsOptions: Record<string, unknown> = {};
  for (const key of TLS_OPTION_KEYS) if (options[key] !== undefined) tlsOptions[key] = options[key];
  if (options["tls"] && typeof options["tls"] === "object") Object.assign(tlsOptions, options["tls"]);
  return tlsOptions;
}

/**
 * L340502 `WebSocketServer`.
 *
 * Two modes matter for the OneBot layer: `{ server }` for the HTTP adapter's
 * embedded listener (the adapter owns `createServer` and this class only adds an
 * `upgrade` handler), and `{ port, host }` for the standalone WS adapter.
 */
export class WebSocketServer extends EventEmitter {
  readonly options: WebSocketServerOptions;
  readonly clients = new Set<WebSocket>();
  private _server: HttpServer | null = null;
  private _externalServer: HttpServer | null = null;
  private _upgradeHandler: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null = null;

  constructor(options: WebSocketServerOptions = {}) {
    super();
    this.options = {
      port: options.port,
      host: options.host,
      server: options.server,
      noServer: options.noServer === true,
      path: options.path,
      maxPayload: options.maxPayload,
      verifyClient: options.verifyClient,
      protocols: options.protocols,
      perMessageDeflate: options.perMessageDeflate,
      backlog: options.backlog,
      tls: options.tls,
    };
    const tlsOptions = getTlsOptions(options as Record<string, unknown>);
    this.options.tls = Object.keys(tlsOptions).length > 0 ? tlsOptions : undefined;
    if (this.options.noServer) return;
    if (this.options.server) {
      this._externalServer = this.options.server;
      this._attachToServer(this._externalServer);
    } else if (this.options.port !== undefined) {
      // A plain HTTP request to a standalone WS listener answers 426, not 404.
      const requestHandler = (_req: IncomingMessage, res: ServerResponse) => {
        const body = STATUS_CODES[426] ?? "";
        res.writeHead(426, { "Content-Length": Buffer.byteLength(body), "Content-Type": "text/plain" });
        res.end(body);
      };
      this._server = this.options.tls
        ? (createHttpsServer(this.options.tls, requestHandler) as unknown as HttpServer)
        : createHttpServer(requestHandler);
      this._attachToServer(this._server);
      this._server.listen(this.options.port, this.options.host, this.options.backlog, () => this.emit("listening"));
      this._server.on("error", (err) => this.emit("error", err));
    } else {
      throw new Error("WebSocketServer requires { port } or { server } or { noServer: true }");
    }
  }

  address(): unknown {
    if (this._server) return this._server.address();
    if (this._externalServer?.address) return this._externalServer.address();
    return null;
  }

  /** L340540 `_attachToServer`. Note the `listenerCount === 1` guard: when the
   *  app installed its own upgrade handler, an off-path upgrade is left alone
   *  instead of being answered with 400. */
  private _attachToServer(server: HttpServer): void {
    const handler = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (this.options.path) {
        if ((req.url ?? "/").split("?")[0] !== this.options.path) {
          if (server.listenerCount("upgrade") === 1) abortUpgrade(socket, 400, "Bad path for WebSocket");
          return;
        }
      }
      this.handleUpgrade(req, socket, head, (ws) => {
        this.emit("connection", ws, req);
      });
    };
    this._upgradeHandler = handler;
    server.on("upgrade", handler);
  }

  /** L340555 `handleUpgrade`: the validation order is observable on the wire and
   *  is captured in fixtures/ref-ws-handshake.json. */
  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    cb: (ws: WebSocket, request: IncomingMessage) => void,
  ): void {
    const upgrade = String(request.headers["upgrade"] ?? "").toLowerCase();
    const rawConnection = request.headers["connection"];
    const connection = (Array.isArray(rawConnection) ? rawConnection.join(",") : (rawConnection ?? "")).toLowerCase();
    const version = request.headers["sec-websocket-version"];
    const key = request.headers["sec-websocket-key"];
    if (request.method !== "GET") return abortUpgrade(socket, 405, "Method not allowed");
    if (upgrade !== "websocket") return abortUpgrade(socket, 400, "Upgrade header must be websocket");
    if (!/\bupgrade\b/i.test(connection)) return abortUpgrade(socket, 400, 'Connection header must contain "upgrade"');
    if (version !== "13") {
      try {
        socket.write("HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\n\r\n");
      } catch {
        /* peer already gone */
      }
      try {
        socket.destroy();
      } catch {
        /* peer already gone */
      }
      return;
    }
    // The key charset check is strict: base64 of 16 bytes, then `==`.
    if (typeof key !== "string" || !/^[+/0-9A-Za-z]{22}==$/.test(key)) return abortUpgrade(socket, 400, "Invalid Sec-WebSocket-Key");
    const doAccept = () => {
      const accept = computeAcceptKey(key);
      const extension = acceptPerMessageDeflate(request.headers["sec-websocket-extensions"], this.options.perMessageDeflate);
      const protocol = chooseSubprotocol(request.headers["sec-websocket-protocol"], this.options.protocols);
      const responseHeaders = [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
      ];
      if (extension) responseHeaders.push(`Sec-WebSocket-Extensions: ${extension.header}`);
      if (protocol) responseHeaders.push(`Sec-WebSocket-Protocol: ${protocol}`);
      try {
        socket.write(`${responseHeaders.join("\r\n")}\r\n\r\n`);
      } catch {
        try {
          socket.destroy();
        } catch {
          /* peer already gone */
        }
        return;
      }
      const ns = socket as unknown as { setTimeout?: (ms: number) => unknown; setNoDelay?: (on: boolean) => unknown };
      ns.setTimeout?.(0);
      ns.setNoDelay?.(true);
      const ws = new WebSocket(socket, {
        isServer: true,
        maxPayload: this.options.maxPayload,
        extensions: extension ? { perMessageDeflate: extension.options } : undefined,
        protocol: protocol ?? "",
        readyState: 1,
      });
      this.clients.add(ws);
      ws.on("close", () => this.clients.delete(ws));
      if (head && head.length > 0) ws._onData(head);
      cb(ws, request);
    };
    const verify = this.options.verifyClient;
    if (typeof verify === "function") {
      const info = {
        origin: request.headers["origin"],
        secure: (socket as unknown as { encrypted?: boolean }).encrypted === true,
        req: request,
      };
      if (verify.length >= 2) {
        (verify as (i: typeof info, cb: (allow: boolean, code?: number, message?: string) => void) => void)(info, (allow, code, message) => {
          if (!allow) return abortUpgrade(socket, code || 401, message);
          doAccept();
        });
      } else {
        if (!(verify as (i: typeof info) => boolean)(info)) return abortUpgrade(socket, 401, "Unauthorized");
        doAccept();
      }
    } else {
      doAccept();
    }
  }

  close(cb?: (err?: Error) => void): void {
    if (this._externalServer && this._upgradeHandler) {
      this._externalServer.removeListener("upgrade", this._upgradeHandler);
      this._upgradeHandler = null;
    }
    for (const ws of this.clients) {
      try {
        ws.close(1001, "Server shutting down");
      } catch {
        /* already closed */
      }
    }
    if (this._server) this._server.close((err) => cb?.(err ?? undefined));
    else if (cb) setImmediate(cb);
  }

  destroy(): void {
    for (const ws of this.clients) {
      try {
        ws.terminate();
      } catch {
        /* already closed */
      }
    }
    if (this._externalServer && this._upgradeHandler) {
      this._externalServer.removeListener("upgrade", this._upgradeHandler);
      this._upgradeHandler = null;
    }
    if (this._server) {
      try {
        (this._server as HttpServer & { closeAllConnections?: () => void }).closeAllConnections?.();
      } catch {
        /* no such API on older Node */
      }
      try {
        this._server.close(() => undefined);
      } catch {
        /* already closed */
      }
      this._server = null;
    }
  }
}

/** L340669 `parseHeaders`: the client's handshake response parser. Rejects a
 *  status line that is not `HTTP/1.1 <code> <message>`. */
function parseHeaders(headerBlock: string): {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
} {
  const lines = headerBlock.split("\r\n");
  const status = lines.shift() as string;
  const m = /^HTTP\/1\.1\s+(\d+)\s*(.*)$/.exec(status);
  if (!m) throw new Error(`Bad HTTP status line: ${status}`);
  const headers: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const line of lines) {
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    headers[k] = line.slice(idx + 1).trim();
  }
  return { statusCode: Number(m[1]), statusMessage: m[2] ?? "", headers };
}

export interface WebSocketClientOptions {
  headers?: Record<string, string> | undefined;
  maxPayload?: number | undefined;
  perMessageDeflate?: PerMessageDeflate | boolean | undefined;
  socketOptions?: Record<string, unknown> | undefined;
}

/**
 * L340688 `WebSocketClient`: the reverse-WS handshake. Writes the upgrade
 * request by hand (no `ws` package), validates the response strictly, then
 * hands the socket to a `WebSocket` in client mode.
 *
 * Every failure path emits `error` with `WebSocket handshake failed: <reason>`
 * followed by `close` (1006, "") — the WsClientAdapter relies on that pair to
 * schedule a reconnect.
 */
export class WebSocketClient extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static Server = WebSocketServer;

  protocol = "";
  extensions = "";

  private readonly _url: NodeURL;
  private readonly _secure: boolean;
  private _readyState: number;
  private readonly _maxPayload: number | undefined;
  private _ws: WebSocket | null = null;
  private _pendingQueue: Array<{ data: unknown; options: unknown; cb: unknown }> = [];
  private readonly _perMessageDeflate: PerMessageDeflate | boolean | undefined;
  private readonly _protocols: string[] | undefined;
  private readonly _socket: Duplex;
  private _handshakeBuf: Buffer = Buffer.alloc(0);
  private readonly _wsKey: string;
  private readonly _expectedAccept: string;

  constructor(
    address: string,
    protocols?: string | string[] | WebSocketClientOptions,
    options?: WebSocketClientOptions,
  ) {
    super();
    let resolvedOptions = options;
    let resolvedProtocols: string | string[] | undefined;
    if (typeof protocols === "object" && !Array.isArray(protocols) && protocols !== null) {
      resolvedOptions = protocols;
      resolvedProtocols = undefined;
    } else {
      resolvedProtocols = protocols as string | string[] | undefined;
    }
    resolvedOptions = resolvedOptions ?? {};
    this._url = new NodeURL(address);
    if (this._url.protocol !== "ws:" && this._url.protocol !== "wss:") {
      throw new Error("Only ws: and wss: URLs are supported");
    }
    this._secure = this._url.protocol === "wss:";
    this._readyState = WebSocketClient.CONNECTING;
    this._maxPayload = resolvedOptions.maxPayload;
    this._perMessageDeflate = resolvedOptions.perMessageDeflate;
    this._protocols = Array.isArray(resolvedProtocols)
      ? resolvedProtocols.map(String)
      : typeof resolvedProtocols === "string"
        ? [resolvedProtocols]
        : undefined;
    const host = this._url.hostname;
    const port = this._url.port ? Number(this._url.port) : this._secure ? 443 : 80;
    this._wsKey = randomWebSocketKey();
    this._expectedAccept = computeAcceptKey(this._wsKey);
    const connectOpts: NetConnectOpts = { host, port, ...(resolvedOptions.socketOptions ?? {}) } as NetConnectOpts;
    const onConnect = () => {
      const pathAndQuery = (this._url.pathname || "/") + (this._url.search || "");
      const hostHeader =
        this._url.port && Number(this._url.port) !== (this._secure ? 443 : 80) ? `${host}:${this._url.port}` : host;
      const reqLines = [
        `GET ${pathAndQuery} HTTP/1.1`,
        `Host: ${hostHeader}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${this._wsKey}`,
        "Sec-WebSocket-Version: 13",
      ];
      if (this._protocols && this._protocols.length > 0) reqLines.push(`Sec-WebSocket-Protocol: ${this._protocols.join(", ")}`);
      const extensionOffer = offerPerMessageDeflate(this._perMessageDeflate);
      if (extensionOffer) reqLines.push(`Sec-WebSocket-Extensions: ${extensionOffer}`);
      if (resolvedOptions?.headers) {
        for (const [k, v] of Object.entries(resolvedOptions.headers)) reqLines.push(`${k}: ${v}`);
      }
      reqLines.push("", "");
      this._socket.write(reqLines.join("\r\n"));
    };
    const connectRecord = connectOpts as unknown as Record<string, unknown>;
    if (this._secure && connectRecord["servername"] === undefined && isIP(host) === 0) connectRecord["servername"] = host;
    this._socket = (
      this._secure ? tlsConnect(connectOpts, onConnect) : netConnect(connectOpts, onConnect)
    ) as unknown as Duplex;
    const sock = this._socket as Duplex & { setNoDelay?: (on: boolean) => unknown };
    sock.setNoDelay?.(true);
    sock.on("data", (chunk: Buffer) => this._onHandshakeData(chunk));
    sock.on("error", (err: Error) => this._onEarlyError(err));
    sock.on("close", () => this._onEarlyClose());
  }

  get readyState(): number {
    return this._ws ? this._ws.readyState : this._readyState;
  }

  /** L340760 `_onHandshakeData`. Every mismatch aborts with a specific message;
   *  the checks run in this order and each one is reachable. */
  private _onHandshakeData(chunk: Buffer): void {
    this._handshakeBuf = Buffer.concat([this._handshakeBuf, chunk]);
    const idx = this._handshakeBuf.indexOf("\r\n\r\n");
    if (idx < 0) {
      if (this._handshakeBuf.length > MAX_HANDSHAKE_BYTES) this._abort("Handshake response too large");
      return;
    }
    const headBlock = this._handshakeBuf.subarray(0, idx).toString("latin1");
    const rest = this._handshakeBuf.subarray(idx + 4);
    let parsed: ReturnType<typeof parseHeaders>;
    try {
      parsed = parseHeaders(headBlock);
    } catch (e) {
      return this._abort((e as Error).message);
    }
    if (parsed.statusCode !== 101) return this._abort(`Unexpected response status ${parsed.statusCode}`);
    if ((parsed.headers["upgrade"] ?? "").toLowerCase() !== "websocket") return this._abort("Missing/invalid Upgrade header");
    if (!/\bupgrade\b/i.test(parsed.headers["connection"] ?? "")) return this._abort("Missing Connection: Upgrade header");
    if (parsed.headers["sec-websocket-accept"] !== this._expectedAccept) return this._abort("Invalid Sec-WebSocket-Accept");
    let acceptedExtensions: AcceptedPerMessageDeflate | null;
    try {
      acceptedExtensions = parseAcceptedPerMessageDeflate(parsed.headers["sec-websocket-extensions"], this._perMessageDeflate);
    } catch (e) {
      return this._abort((e as Error).message);
    }
    if (parsed.headers["sec-websocket-extensions"] && !acceptedExtensions) return this._abort("Unexpected Sec-WebSocket-Extensions");
    const protocol = parsed.headers["sec-websocket-protocol"] ?? "";
    if (protocol && (!this._protocols || !this._protocols.includes(protocol))) return this._abort("Unexpected Sec-WebSocket-Protocol");
    this._socket.removeAllListeners("data");
    this._socket.removeAllListeners("error");
    this._socket.removeAllListeners("close");
    this._readyState = WebSocketClient.OPEN;
    this._ws = new WebSocket(this._socket, {
      isServer: false,
      maxPayload: this._maxPayload,
      extensions: acceptedExtensions ? { perMessageDeflate: acceptedExtensions } : undefined,
      protocol,
      readyState: 1,
    });
    this.protocol = protocol;
    this.extensions = acceptedExtensions ? "permessage-deflate" : "";
    this._ws.on("message", (d: Buffer, isBinary: boolean) => this.emit("message", d, isBinary));
    this._ws.on("ping", (d: Buffer) => this.emit("ping", d));
    this._ws.on("pong", (d: Buffer) => this.emit("pong", d));
    this._ws.on("close", (c: number, r: string) => this.emit("close", c, r));
    this._ws.on("error", (e: Error) => this.emit("error", e));
    this.emit("upgrade", parsed);
    this.emit("open");
    if (rest.length > 0) this._ws._onData(Buffer.from(rest));
    for (const entry of this._pendingQueue) this._ws.send(entry.data as string, entry.options as never, entry.cb as never);
    this._pendingQueue = [];
  }

  private _onEarlyError(err: Error): void {
    this.emit("error", err);
  }

  private _onEarlyClose(): void {
    if (!this._ws) {
      this._readyState = WebSocketClient.CLOSED;
      this.emit("close", 1006, "");
    }
  }

  private _abort(msg: string): void {
    const err = new Error(`WebSocket handshake failed: ${msg}`);
    try {
      this._socket.destroy();
    } catch {
      /* already gone */
    }
    this.emit("error", err);
    this._readyState = WebSocketClient.CLOSED;
    this.emit("close", 1006, "");
  }

  send(data: unknown, options?: unknown, cb?: unknown): void {
    if (this._ws) return this._ws.send(data as string, options as never, cb as never);
    let resolvedOptions = options;
    let callback = cb;
    if (typeof options === "function") {
      callback = options;
      resolvedOptions = undefined;
    }
    this._pendingQueue.push({ data, options: resolvedOptions, cb: callback });
  }

  ping(data?: Buffer, mask?: boolean, cb?: (err?: Error) => void): void {
    this._ws?.ping(data, mask, cb);
  }

  pong(data?: Buffer, mask?: boolean, cb?: (err?: Error) => void): void {
    this._ws?.pong(data, mask, cb);
  }

  close(code?: number, reason?: string): void {
    if (code !== undefined && !isValidCloseCode(code)) throw new RangeError(`Invalid close code: ${code}`);
    if (this._ws) return this._ws.close(code, reason);
    try {
      this._socket.destroy();
    } catch {
      /* already gone */
    }
  }

  terminate(): void {
    if (this._ws) return this._ws.terminate();
    try {
      this._socket.destroy();
    } catch {
      /* already gone */
    }
  }
}

/** L340863 `../websocket/src/index.ts`: `WebSocket.Server = WebSocketServer`. */
export const WebSocketFacade = Object.assign(WebSocket, { Server: WebSocketServer, Client: WebSocketClient });