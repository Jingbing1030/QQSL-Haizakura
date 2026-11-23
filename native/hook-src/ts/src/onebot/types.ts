// OneBot wire types, response envelopes and the report-option shaping that
// every transport shares.
//
// Reference regions (line numbers into reference/index.mjs):
//   ../onebot/src/types.ts        L6905-L6931   RETCODE + ok/failed envelopes
//   ../onebot/src/event-filter.ts L339445-L339484 resolveReportOptions,
//                                 buildDispatchPayload, pickDispatchJson,
//                                 shapeEventForAdapter
//   ../onebot/src/streaming.ts    L6932-L6996   STREAM_MARK, StreamStatus,
//                                 StreamTransportClosedError, wrapStreamFrame,
//                                 wrapStreamTerminal
//
// Nothing here is invented: every constant and every key order comes from those
// lines, and the key order is observable on the wire.

/** L6910 `RETCODE`. Note ACTION_FAILED is 100, not 1 — clients branch on it. */
export const RETCODE = {
  ACTION_FAILED: 100,
  INTERNAL_ERROR: 1200,
  BAD_REQUEST: 1400,
  UNKNOWN_ACTION: 1404,
} as const;

/** The OneBot 11 v11 response envelope. Key order matters: it is serialized. */
export interface ApiResponse {
  status: "ok" | "failed";
  retcode: number;
  data: unknown;
  wording?: string;
  /** Only present when the caller supplied one; the HTTP adapter mutates the
   *  response in place to attach it (reference L341760). */
  echo?: unknown;
}

/** L6916 `okResponse`. */
export function okResponse(data: unknown = null): ApiResponse {
  return { status: "ok", retcode: 0, data };
}

/** L6923 `failedResponse`. */
export function failedResponse(retcode: number, wording: string): ApiResponse {
  return { status: "failed", retcode, data: null, wording };
}

/** L6941 the streaming envelope marker. */
export const STREAM_MARK = "stream-action";

/** L6944 `StreamStatus`. The values are the wire strings, not the keys. */
export const StreamStatus = {
  Stream: "stream",
  Response: "response",
  Reset: "reset",
  Error: "error",
} as const;

/** L6961 `StreamTransportClosedError`. */
export class StreamTransportClosedError extends Error {
  constructor(message = "stream transport closed") {
    super(message);
    this.name = "StreamTransportClosedError";
  }
}

/** Sink handed to a stream action (L6971 `NOOP_SINK` is the fallback). */
export interface StreamSink {
  send(frame: unknown): Promise<void>;
}

export const NOOP_SINK: StreamSink = { send: async () => {} };

/**
 * L6982 `wrapStreamFrame`. The empty `message`/`wording` pair is deliberate —
 * mirroring NapCat so a client reading either key on an intermediate frame gets
 * `''`, never `undefined`. Field order is `status, retcode, data, message,
 * wording, stream` then `echo`, which is exactly what the reference emits.
 */
export function wrapStreamFrame(data: unknown, echo?: unknown): Record<string, unknown> {
  const frame: Record<string, unknown> = {
    status: "ok",
    retcode: 0,
    data,
    message: "",
    wording: "",
    stream: STREAM_MARK,
  };
  if (echo !== undefined) frame["echo"] = echo;
  return frame;
}

/**
 * L7005 `wrapStreamTerminal`. Spreads the action's response first (so `status`,
 * `retcode`, `data`, `wording` keep the action's order), then adds `stream`,
 * `echo`, the error packet substitution and finally `message`/`wording`.
 */
export function wrapStreamTerminal(response: ApiResponse, echo?: unknown): Record<string, unknown> {
  const frame: Record<string, unknown> = { ...response, stream: STREAM_MARK };
  if (echo !== undefined) frame["echo"] = echo;
  if (response.status === "failed") frame["data"] = { type: "error", data_type: "error" };
  frame["message"] = frame["wording"] ?? "";
  if (frame["wording"] === undefined) frame["wording"] = "";
  return frame;
}

export type MessageFormat = "array" | "string";

/** L339446 `resolveReportOptions`. */
export interface ReportOptions {
  messageFormat: MessageFormat;
  reportSelfMessage: boolean;
}

export function resolveReportOptions(network: {
  messageFormat?: MessageFormat | undefined;
  reportSelfMessage?: boolean | undefined;
}): ReportOptions {
  return {
    messageFormat: network.messageFormat ?? "array",
    reportSelfMessage: network.reportSelfMessage ?? false,
  };
}

/** The three pre-serialized forms of one event (L339452). */
export interface DispatchPayload {
  isSelfMessage: boolean;
  arrayJson: string;
  stringJson: string;
}

/**
 * L339452 `buildDispatchPayload`.
 *
 * Only `message` / `message_sent` events with an array `message` get the
 * `stringJson` variant, and that variant replaces `message` with
 * `raw_message`. When `raw_message` is missing the replacement is the empty
 * string — the reference does not fall back to rendering the segments.
 */
export function buildDispatchPayload(event: Record<string, unknown>): DispatchPayload {
  const isSelfMessage = event["post_type"] === "message_sent";
  const arrayJson = JSON.stringify(event);
  let stringJson = arrayJson;
  if ((event["post_type"] === "message" || event["post_type"] === "message_sent") && Array.isArray(event["message"])) {
    const raw = typeof event["raw_message"] === "string" ? (event["raw_message"] as string) : "";
    stringJson = JSON.stringify({ ...event, message: raw });
  }
  return { isSelfMessage, arrayJson, stringJson };
}

/** L339469 `pickDispatchJson`: `null` means "drop this event for this sink". */
export function pickDispatchJson(payload: DispatchPayload, options: ReportOptions): string | null {
  if (payload.isSelfMessage && !options.reportSelfMessage) return null;
  return options.messageFormat === "string" ? payload.stringJson : payload.arrayJson;
}

/** L339473 `shapeEventForAdapter`; `null` means "drop". */
export function shapeEventForAdapter(
  event: Record<string, unknown>,
  options: ReportOptions,
): Record<string, unknown> | null {
  if (event["post_type"] === "message_sent" && !options.reportSelfMessage) return null;
  if (
    options.messageFormat === "string" &&
    (event["post_type"] === "message" || event["post_type"] === "message_sent") &&
    Array.isArray(event["message"])
  ) {
    const raw = typeof event["raw_message"] === "string" ? (event["raw_message"] as string) : "";
    return { ...event, message: raw };
  }
  return event;
}

/**
 * The slice of `ApiHandler` the transports use. The reference's ApiHandler
 * (L21445) owns far more (registries, tracing, quiesce bookkeeping); the
 * transports only ever touch these six members, so the port takes them as an
 * interface and lets the business layer supply the real object.
 */
export interface OneBotApi {
  /** L21500 `get isAcceptingActions`: sticky instance-lifecycle gate. */
  readonly isAcceptingActions: boolean;
  /** L21518 `isStreamAction(action)` — decides chunked framing vs one body. */
  isStreamAction(action: string): boolean;
  /** L21539 `handle(action, params, sink)` — the envelope comes back as data. */
  handle(action: string, params: Record<string, unknown>, sink?: StreamSink): Promise<ApiResponse>;
  /** L21634 `processStreamRequest(raw, emit, isAlive)` — WS/Client path. */
  processStreamRequest(rawRequest: string, emit: (frame: string) => Promise<void> | void, isAlive?: () => boolean): Promise<void>;
  /** L21566 `traceQuiescedAction` — bookkeeping for a rejected request. */
  traceQuiescedAction?(action: string, params: Record<string, unknown>, response: ApiResponse): void;
  /** L21574 `traceQuiescedStreamRequest`. */
  traceQuiescedStreamRequest?(rawRequest: string): void;
}

/**
 * The network context an adapter needs (built by `OneBotInstance`, L343068).
 * Deliberately narrow: uin + api + the three meta-event builders.
 */
export interface OneBotNetworkContext {
  uin: string;
  api: OneBotApi;
  buildLifecycleEvent(subType: "connect" | "enable" | "disable"): Record<string, unknown>;
  buildHeartbeatEvent(): Record<string, unknown>;
}

/** The plain-JSON `ApiResponse` a caller can serialize. */
export function isFailed(response: ApiResponse): boolean {
  return response.status === "failed";
}
