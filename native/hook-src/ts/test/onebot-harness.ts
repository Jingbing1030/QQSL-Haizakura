// Shared helpers for the OneBot network replay tests.
//
// The recordings under ./onebot-fixtures/ come from work/onebot-net/probe/,
// which runs the *reference bundle's own* adapters (sliced verbatim out of
// reference/index.mjs and loaded as an ES module) over real sockets:
//
//   harness-http.mjs        → ref-http.json         (47 cases)
//   harness-ws.mjs          → ref-ws.json           (28 cases)
//   harness-ws2.mjs         → ref-ws2.json          (25 cases)
//   harness-handshake.mjs   → ref-ws-handshake.json (13 cases)
//
// Regenerate with `node probe/harness-*.mjs` in work/onebot-net/. The tests
// below assert the TypeScript port answers byte-for-byte what the reference
// answered, so a fixture diff means a port divergence, not a stale expectation.

import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  RETCODE,
  StreamTransportClosedError,
  buildDispatchPayload,
  failedResponse,
  wrapStreamFrame,
  wrapStreamTerminal,
  type ApiResponse,
  type OneBotApi,
  type OneBotNetworkContext,
  type StreamSink,
} from "../src/onebot/types.js";

/**
 * The fixtures live in the *source* tree (`test/onebot-fixtures/`), not next to
 * the compiled output, so locate them by walking up to the package root instead
 * of resolving relative to `import.meta.url` — `build/test/` has no fixtures.
 */
function fixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i += 1) {
    const candidate = join(dir, "test", "onebot-fixtures");
    if (existsSync(candidate)) return candidate;
    const here = join(dir, "onebot-fixtures");
    if (existsSync(here)) return here;
    dir = dirname(dir);
  }
  throw new Error("test/onebot-fixtures not found");
}

const FIXTURES = fixturesDir();

/** Read a recorded fixture; a `.gz` suffix means the bytes are gzipped JSON. */
export function fixture<T = unknown>(name: string): T {
  const raw = readFileSync(join(FIXTURES, name));
  const text = name.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  return JSON.parse(text) as T;
}

export interface RecordedCase {
  name: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  params?: unknown[];
  logs?: string[];
  frames?: Array<Record<string, unknown>>;
  handshake?: Record<string, unknown>;
  reason?: { code: number; reason: string } | null;
  refused?: boolean;
  message?: string;
  [key: string]: unknown;
}

export interface FixtureFile {
  generatedBy: string;
  cases: RecordedCase[];
}

/**
 * One canned action, in the shape work/onebot-net/fixtures/contracts.json uses:
 * `kind` selects normal vs stream, `response`/`terminal` is the envelope, and
 * `throws`/`throwsValidation` reproduce the two failure classes the reference's
 * action boundary distinguishes.
 */
interface Contract {
  kind?: "normal" | "stream";
  response?: ApiResponse;
  throws?: string;
  throwsValidation?: string;
  frames?: Array<Record<string, unknown>>;
  terminal?: ApiResponse;
}

export interface ApiOptions {
  accepting?: boolean;
}

/**
 * A minimal `OneBotApi` that replays `contracts.json` the way the reference's
 * `ApiHandler` did, and records every `(action, params)` pair the transport
 * handed it. Reproducing the *params* is the point: the transport's decoding
 * (query JSON-parse, body/params split, form parse, echo extraction) is exactly
 * what the HTTP fixtures pin down.
 */
export class RecordingApi implements OneBotApi {
  isAcceptingActions = true;
  /** One record per API call, in order — the `call`/`action`/`params` triple the
   *  reference's `ApiHandler` trace produced, so a fixture can be compared
   *  structurally instead of by substring. */
  readonly trace: Array<{ call: string; action: string; params: Record<string, unknown>; response?: ApiResponse }> = [];
  readonly quiescedStreams: string[] = [];

  private readonly contracts: Record<string, Contract>;
  private readonly streamActions: Set<string>;

  constructor(contracts: Record<string, Contract>, options: ApiOptions = {}) {
    this.contracts = contracts;
    this.streamActions = new Set(
      Object.entries(contracts)
        .filter(([, contract]) => contract.kind === "stream")
        .map(([name]) => name),
    );
    this.isAcceptingActions = options.accepting !== false;
  }

  setAccepting(accepting: boolean): void {
    this.isAcceptingActions = accepting;
  }

  isStreamAction(action: string): boolean {
    return this.streamActions.has(action);
  }

  async handle(action: string, params: Record<string, unknown>, sink?: StreamSink): Promise<ApiResponse> {
    this.trace.push({ call: "handle", action, params });
    const contract = this.contracts[action];
    if (!contract) {
      // Exactly what the reference's ApiHandler answers for an unknown action.
      return { status: "failed", retcode: 1404, data: null, wording: "unknown action" };
    }
    if (contract.throwsValidation) {
      const error = new Error(contract.throwsValidation);
      error.name = "MessageElementValidationError";
      throw error;
    }
    if (contract.throws) throw new Error(contract.throws);
    if (contract.kind === "stream" && sink) {
      for (const frame of contract.frames ?? []) await sink.send(frame);
      return structuredClone(contract.terminal ?? { status: "ok", retcode: 0, data: null });
    }
    // Clone: the transport mutates the response to attach `echo` (reference
    // L341760 / L21640), so handing back the shared fixture object would leak
    // one test's echo into the next.
    return structuredClone(contract.response ?? { status: "ok", retcode: 0, data: null });
  }

  /**
   * L21613 `ApiHandler.processStreamRequest` — the WS/Client action path.
   *
   * Reproduced rather than simplified because every branch is observable on the
   * wire:
   *   * an empty or whitespace frame, unparseable JSON, a non-object, and a
   *     missing `action` all answer `retcode 1400 wording "bad request"` — note
   *     the wording, which is NOT the HTTP path's "bad request: invalid json";
   *   * `params` is replaced with `{}` unless it is a plain object;
   *   * a non-stream action emits one frame with `echo` attached;
   *   * a stream action emits each frame through `wrapStreamFrame` (so every
   *     intermediate frame carries `stream`, `message:""`, `wording:""` and the
   *     echo) and then `wrapStreamTerminal`;
   *   * `isAlive()` is checked before each stream frame only;
   *   * a throwing action propagates — nothing is emitted at all.
   */
  async processStreamRequest(
    rawRequest: string,
    emit: (frame: string) => Promise<void> | void,
    isAlive?: () => boolean,
  ): Promise<void> {
    const bad = async () => {
      await emit(JSON.stringify(failedResponse(RETCODE.BAD_REQUEST, "bad request")));
    };
    if (!rawRequest.trim()) return bad();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawRequest);
    } catch {
      return bad();
    }
    if (!isPlainObject(parsed)) return bad();
    const action = asString(parsed["action"]);
    if (!action) return bad();
    const params = isPlainObject(parsed["params"]) ? (parsed["params"] as Record<string, unknown>) : {};
    const echo = parsed["echo"] !== undefined ? toJsonValue(parsed["echo"]) : undefined;
    if (!this.isStreamAction(action)) {
      const response = await this.handle(action, params);
      if (echo !== undefined) response.echo = echo;
      await emit(JSON.stringify(response));
      return;
    }
    const response = await this.handle(action, params, {
      send: async (frame) => {
        if (isAlive && !isAlive()) throw new StreamTransportClosedError();
        await emit(JSON.stringify(wrapStreamFrame(frame, echo)));
      },
    });
    await emit(JSON.stringify(wrapStreamTerminal(response, echo)));
  }

  traceQuiescedAction(action: string, params: Record<string, unknown>, response: ApiResponse): void {
    this.trace.push({ call: "traceQuiescedAction", action, params, response });
  }

  traceQuiescedStreamRequest(rawRequest: string): void {
    this.quiescedStreams.push(rawRequest);
  }

  /** Drop recorded actions; used between cases. */
  reset(): void {
    this.trace.length = 0;
    this.quiescedStreams.length = 0;
  }
}

/** The `OneBotNetworkContext` the reference builds at L343068. */
export function makeCtx(api: OneBotApi, uin = "10001"): OneBotNetworkContext {
  const status = { online: true, good: true };
  return {
    uin,
    api,
    buildLifecycleEvent: (subType: "connect" | "enable" | "disable") => ({
      time: 1700000000,
      self_id: Number(uin),
      post_type: "meta_event",
      meta_event_type: "lifecycle",
      sub_type: subType,
      status,
    }),
    buildHeartbeatEvent: () => ({
      time: 1700000000,
      self_id: Number(uin),
      post_type: "meta_event",
      meta_event_type: "heartbeat",
      status,
      interval: 30000,
    }),
  };
}

/** Build the dispatch payload the network manager computes once per event. */
export function dispatch(event: Record<string, unknown>): ReturnType<typeof buildDispatchPayload> {
  return buildDispatchPayload(event);
}

export const CONTRACTS = fixture<Record<string, Contract>>("contracts.json");

/** Header keys that change per run and must never be compared. */
const VOLATILE_HEADERS = new Set(["date", "keep-alive", "connection"]);

export function stableHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (VOLATILE_HEADERS.has(key) || value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

/** A GET/HEAD-style body comparison that also tolerates chunk framing. */
export function bodyLines(text: string): string[] {
  return text.split("\r\n\r\n").filter((part) => part.length > 0);
}
/** L21670 `isJsonObject`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** L21674 `asString`: numbers and booleans stringify; everything else is "". */
function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

/** L21681 `toJsonValue`: coerce an echo to plain JSON. */
function toJsonValue(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = toJsonValue(item);
    return out;
  }
  return String(value);
}
