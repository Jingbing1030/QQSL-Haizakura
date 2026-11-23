// Satori is a different protocol; this file is the OneBot SSE endpoint
// (`GET <path>_events`).
//
// Reference region: ../onebot/src/network/http-sse-connections.ts
//                   L341198-L341369
//
// This is the ONLY Server-Sent-Events implementation in the OneBot layer. The
// reference does not stream OneBot events over SSE by re-labelling them; it
// keeps a bounded replay log per adapter and answers `Last-Event-ID` reconnects
// from it.
//
// Everything below is reproduced including the parts that look like bugs:
//   * ids are `<epoch-uuid>:<sequence>` and the epoch is regenerated on every
//     close(), so an `Last-Event-ID` from a previous generation is a 409;
//   * `droppedThrough` is the last *evicted* sequence, and the replay test is
//     `value < droppedThrough` — a client sitting exactly on the evicted id is
//     still served (it asks for everything after it, and nothing is left);
//   * the history bound is doubly enforced (256 frames OR 8 MB) and the byte
//     accounting subtracts the evicted frame's own size;
//   * `drop()` clears the heartbeat only when the last client goes away.

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createLogger, errorMessage } from "./log.js";
import { pickDispatchJson, resolveReportOptions, type DispatchPayload, type ReportOptions } from "./types.js";

/** L341199 limit on retained frames. */
const REPLAY_EVENTS = 256;
/** L341200 limit on retained bytes (whichever bound is hit first). */
const REPLAY_BYTES = 8 * 1024 * 1024;
/** L341201 cap on a single client's unsent backlog. */
const CLIENT_BYTES = 8 * 1024 * 1024;
/** L341202 SSE comment keepalive interval. */
const HEARTBEAT_MS = 15000;

/** L341206 the config slice this class reads. */
export interface SseConfig {
  name: string;
  enableSse?: boolean | undefined;
  accessToken?: string | undefined;
  messageFormat?: "array" | "string" | undefined;
  reportSelfMessage?: boolean | undefined;
}

interface SseFrame {
  sequence: number;
  text: string;
  bytes: number;
}

interface SseConnection {
  response: ServerResponse;
  queue: SseFrame[];
  bytes: number;
  blocked: boolean;
  dispose: () => void;
}

/**
 * L341204 `HttpSseConnections`. Per-adapter by construction: the history,
 * epoch and sequence counter are instance state, never shared between accounts.
 */
export class HttpSseConnections {
  private readonly log: ReturnType<typeof createLogger>;
  private readonly bootstrap: () => string[];
  private config: SseConfig;
  private epoch: string = randomUUID();
  private sequence = 0;
  private droppedThrough = 0;
  private history: SseFrame[] = [];
  private historyBytes = 0;
  private readonly connections = new Set<SseConnection>();
  private heartbeat: NodeJS.Timeout | undefined;

  constructor(config: SseConfig, log: ReturnType<typeof createLogger>, bootstrap: () => string[]) {
    this.log = log;
    this.bootstrap = bootstrap;
    this.config = structuredClone(config);
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  /** L341222 `updateConfig`: a change to anything an existing stream already
   *  reflects (enable flag, token, format, self-report) tears the stream down. */
  updateConfig(next: SseConfig): void {
    if (
      this.config.enableSse !== next.enableSse ||
      (this.config.accessToken ?? "") !== (next.accessToken ?? "") ||
      (this.config.messageFormat ?? "array") !== (next.messageFormat ?? "array") ||
      (this.config.reportSelfMessage ?? false) !== (next.reportSelfMessage ?? false)
    ) {
      this.close("configuration changed");
    }
    this.config = structuredClone(next);
  }

  /** L341230 `accept`: validate the cursor, then open the stream. */
  accept(request: IncomingMessage, response: ServerResponse): void {
    const cursor = request.headers["last-event-id"];
    let after = this.sequence;
    if (cursor !== undefined && cursor !== "") {
      const match = typeof cursor === "string" ? /^([0-9a-f-]{36}):(0|[1-9]\d{0,15})$/.exec(cursor) : null;
      const value = match ? Number(match[2]) : Number.NaN;
      if (!match || !Number.isSafeInteger(value)) {
        this.rejectCursor(response, 400, "invalid Last-Event-ID");
        return;
      }
      // Epoch mismatch, evicted, or from the future — all "resync" here.
      if (match[1] !== this.epoch || value < this.droppedThrough || value > this.sequence) {
        this.rejectCursor(response, 409, "SSE replay unavailable; resync and reconnect without Last-Event-ID");
        return;
      }
      after = value;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    });
    response.flushHeaders();
    // An event stream is idle by design; the socket read timeout must not fire.
    request.socket.setTimeout(0);
    const connection: SseConnection = {
      response,
      queue: [],
      bytes: 0,
      blocked: false,
      dispose: () => {
        response.off("drain", onDrain);
        response.off("close", onClose);
        response.off("error", onError);
      },
    };
    const onDrain = () => {
      connection.blocked = false;
      this.flush(connection);
    };
    const onError = (error: Error) => {
      this.log.warn("[%s] SSE connection failed: %s", this.config.name, errorMessage(error));
      this.drop(connection);
    };
    const onClose = () => this.drop(connection);
    response.on("drain", onDrain);
    response.once("close", onClose);
    response.on("error", onError);
    this.connections.add(connection);
    this.log.debug("[%s] SSE connected (%d clients)", this.config.name, this.connectionCount);
    // The first frame is the reconnect delay; clients honour it before retrying.
    this.enqueue(connection, this.frame("retry: 3000\n\n"));
    for (const frame of this.history) if (frame.sequence > after) this.enqueue(connection, frame);
    for (const json of this.bootstrap()) this.enqueue(connection, this.eventFrame(json));
    if (!this.heartbeat && this.connections.size > 0) {
      this.heartbeat = setInterval(() => {
        const frame = this.frame(": ping\n\n");
        for (const client of this.connections) this.enqueue(client, frame);
      }, HEARTBEAT_MS);
      this.heartbeat.unref();
    }
  }

  /** L341297 `onEvent`: append to the replay log, then fan out. */
  onEvent(payload: DispatchPayload): void {
    const json = pickDispatchJson(payload, resolveReportOptions(this.config));
    if (json === null) return;
    this.sequence += 1;
    const frame = this.eventFrame(json);
    this.history.push(frame);
    this.historyBytes += frame.bytes;
    while (this.history.length > REPLAY_EVENTS || this.historyBytes > REPLAY_BYTES) {
      const removed = this.history.shift() as SseFrame;
      this.historyBytes -= removed.bytes;
      this.droppedThrough = removed.sequence;
    }
    for (const connection of this.connections) this.enqueue(connection, frame);
  }

  /** L341313 `close`: tear every stream down and start a new epoch. */
  close(reason: string): void {
    if (this.connections.size > 0) this.log.debug("[%s] SSE closing: %s", this.config.name, reason);
    for (const connection of this.connections) this.drop(connection);
    this.history = [];
    this.historyBytes = 0;
    this.sequence = 0;
    this.droppedThrough = 0;
    this.epoch = randomUUID();
  }

  /** L341326 `eventFrame`: `id:` is the resume cursor, `data:` the event JSON. */
  private eventFrame(json: string): SseFrame {
    return this.frame(`id: ${this.epoch}:${this.sequence}\ndata: ${json}\n\n`);
  }

  private frame(text: string): SseFrame {
    return { sequence: this.sequence, text, bytes: Buffer.byteLength(text) };
  }

  /** L341338 `enqueue`: a client that cannot keep up is dropped, not buffered
   *  without bound. The `writableLength` term is what makes that honest. */
  private enqueue(connection: SseConnection, frame: SseFrame): void {
    if (!this.connections.has(connection)) return;
    if (connection.bytes + connection.response.writableLength + frame.bytes > CLIENT_BYTES) {
      this.log.warn("[%s] SSE client exceeded %d buffered bytes; disconnecting", this.config.name, CLIENT_BYTES);
      this.drop(connection);
      return;
    }
    connection.queue.push(frame);
    connection.bytes += frame.bytes;
    this.flush(connection);
  }

  /** L341352 `flush`: stop at the first write that reports backpressure. */
  private flush(connection: SseConnection): void {
    while (!connection.blocked && connection.queue.length > 0) {
      const frame = connection.queue.shift() as SseFrame;
      connection.bytes -= frame.bytes;
      try {
        connection.blocked = !connection.response.write(frame.text);
      } catch (error) {
        this.log.warn("[%s] SSE write failed: %s", this.config.name, errorMessage(error));
        this.drop(connection);
        return;
      }
    }
  }

  /** L341370 `drop`. */
  private drop(connection: SseConnection): void {
    if (!this.connections.delete(connection)) return;
    connection.queue = [];
    connection.bytes = 0;
    if (connection.response.destroyed) connection.dispose();
    else {
      connection.response.once("close", connection.dispose);
      connection.response.destroy();
    }
    if (this.connections.size === 0 && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
  }

  /** L341393 `rejectCursor`: note this writes the OneBot envelope, not Satori's
   *  `{ message }`, and maps 400→1400 / everything else→1409. */
  private rejectCursor(response: ServerResponse, status: number, wording: string): void {
    this.log.warn("[%s] rejected SSE reconnect: %s", this.config.name, wording);
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "failed", retcode: status === 400 ? 1400 : 1409, data: null, wording }));
  }
}

export { REPLAY_EVENTS, REPLAY_BYTES, CLIENT_BYTES, HEARTBEAT_MS };
export type { ReportOptions };