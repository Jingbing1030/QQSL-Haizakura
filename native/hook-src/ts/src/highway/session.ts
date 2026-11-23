// The highway upload session bootstrap — the one OIDB round trip that has to
// happen before any bytes can be uploaded.
//
// Reference region: `../protocol/src/highway/utils.ts` (reference/index.mjs:34138-34203),
// function `fetchHighwaySession`.
//
// ---------------------------------------------------------------------------
// Why a session at all
// ---------------------------------------------------------------------------
// Highway servers do not authenticate with the account's login state. They want a
// `sig_session` ticket, handed out by a separate OIDB service (`HttpConn.0x6ff_501`)
// together with the list of upload servers to use. So an image send is two round
// trips: this one, then the chunk POSTs. The ticket is short-lived (minutes), and
// a session fetched for a previous send is usually still valid — see
// `HighwaySessionCache` below.
//
// ---------------------------------------------------------------------------
// Why the server list is filtered and de-duplicated
// ---------------------------------------------------------------------------
// The response contains servers for several purposes (`serviceType` 1, 5, 10, 21
// were requested). Only **serviceType 1** is the upload path; the others are for
// download and for services this client does not use. Posting a chunk to one of
// them gets a connection that accepts bytes and never answers, which looks like a
// network hang rather than a wrong-server mistake.
//
// De-duplication is on `host:port` because the response routinely repeats an
// address across service-info entries, and the reference's `Map`-keyed collection
// collapses them. Keeping the first occurrence preserves the server's own
// preference order, which is what the uploader's round-robin retry relies on.

import type { Bridge } from "../bridge/bridge.js";
import {
  HttpConnSession,
  type HttpConnUploadServer,
  type HighwaySession,
} from "../oidb/services/0x6ff.js";

/** Stable, greppable reasons an upload session could not be established. */
export type HighwaySessionFailureReason =
  | "request_failed"
  | "response_decode_failed"
  | "response_invalid";

/** A session bootstrap failure, carrying which stage failed. */
export class HighwaySessionError extends Error {
  readonly reason: HighwaySessionFailureReason;

  constructor(reason: HighwaySessionFailureReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HighwaySessionError";
    this.reason = reason;
  }
}

/**
 * The transport surface this module needs.
 *
 * Narrowed to one method rather than taking `BridgeManager`: the bootstrap is
 * testable without a bridge, and the dependency is genuinely one call. It is also
 * the only thing an uploader needs from the account context.
 */
export interface HighwaySessionTransport {
  sendRawPacket(serviceCmd: string, body: Uint8Array): Promise<{
    success: boolean;
    gotResponse: boolean;
    errorCode?: number;
    errorMessage?: string;
    responseData?: Uint8Array;
  }>;
}

/** How long a fetched session is reused before another bootstrap. */
export const HIGHWAY_SESSION_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch a fresh upload session.
 *
 * The three `failureReason` assignments below mirror the reference exactly, and
 * they are the difference between "highway is broken" and "the server said no":
 * `request_failed` means the OIDB call itself failed, `response_decode_failed`
 * means it answered with bytes that are not a valid response, and
 * `response_invalid` means it decoded but lacked a ticket or any usable server.
 */
export async function fetchHighwaySession(
  transport: HighwaySessionTransport,
  signal?: AbortSignal,
): Promise<HighwaySession> {
  signal?.throwIfAborted();

  const request = HttpConnSession.encodeRequest({
    httpConn: {
      field1: 0,
      field2: 0,
      field3: 16,
      field4: 1,
      field6: 3,
      serviceTypes: [1, 5, 10, 21],
      field9: 2,
      field10: 9,
      field11: 8,
      ver: "1.0.1",
    },
  });

  let result;
  try {
    result = await transport.sendRawPacket(HttpConnSession.wireName, request);
  } catch (error) {
    throw new HighwaySessionError(
      "request_failed",
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }

  if (!result.success || !result.gotResponse || !result.responseData) {
    throw new HighwaySessionError(
      "request_failed",
      result.errorMessage || "HttpConn request failed",
    );
  }

  let response;
  try {
    response = HttpConnSession.decodeResponse(result.responseData);
  } catch (error) {
    throw new HighwaySessionError(
      "response_decode_failed",
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }

  try {
    // `toHighwaySession` already applies the serviceType-1 filter, the ip/port bounds
    // check, and the `host:port` de-duplication — including the reference's exact error
    // strings for a missing ticket or an empty server list.
    return HttpConnSession.toSession(response);
  } catch (error) {
    throw new HighwaySessionError(
      "response_invalid",
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}

/**
 * A cached session, refreshed on demand.
 *
 * Serialising an image send per image is not acceptable — a user sending five
 * pictures would do five bootstraps — but a *stale* ticket is worse, because the
 * chunk POST then fails with an opaque server-side rejection. Hence a TTL rather
 * than caching forever.
 *
 * In-flight fetches are shared: two concurrent image sends would otherwise both
 * bootstrap, and the second ticket invalidates the first on some servers.
 */
export class HighwaySessionCache {
  readonly #transport: HighwaySessionTransport;
  readonly #ttlMs: number;
  #session: HighwaySession | null = null;
  #fetchedAt = 0;
  #inFlight: Promise<HighwaySession> | null = null;

  constructor(transport: HighwaySessionTransport, ttlMs = HIGHWAY_SESSION_TTL_MS) {
    this.#transport = transport;
    this.#ttlMs = ttlMs;
  }

  /** Whether the cached session is still inside its TTL. */
  get isFresh(): boolean {
    return this.#session !== null && Date.now() - this.#fetchedAt < this.#ttlMs;
  }

  /** The cached session without fetching, or `null`. */
  peek(): HighwaySession | null {
    return this.isFresh ? this.#session : null;
  }

  /** Forget the cached session. Called after a chunk POST fails with an auth-style error. */
  invalidate(): void {
    this.#session = null;
    this.#fetchedAt = 0;
  }

  /**
   * The current session, fetching if needed.
   *
   * A failed fetch clears `#inFlight` so the next call retries rather than
   * rejecting forever — a transient OIDB timeout must not poison the cache.
   */
  async get(signal?: AbortSignal): Promise<HighwaySession> {
    const cached = this.peek();
    if (cached) return cached;
    if (this.#inFlight) return this.#inFlight;

    const promise = fetchHighwaySession(this.#transport, signal).then(
      (session) => {
        this.#session = session;
        this.#fetchedAt = Date.now();
        this.#inFlight = null;
        return session;
      },
      (error: unknown) => {
        this.#inFlight = null;
        throw error;
      },
    );
    this.#inFlight = promise;
    return promise;
  }
}

/** Re-exported so callers do not need two imports. */
export type { HighwaySession, HttpConnUploadServer };

/**
 * Adapt a `Bridge` to {@link HighwaySessionTransport}.
 *
 * Exists because `Bridge.sendRawPacket` has a third `timeoutMs` parameter
 * with a default, which satisfies the interface structurally — but going through
 * this function makes the dependency explicit and keeps the reverse import out of
 * the bridge layer.
 */
export function bridgeSessionTransport(bridge: Bridge): HighwaySessionTransport {
  return {
    sendRawPacket: (serviceCmd, body) => bridge.sendRawPacket(serviceCmd, body),
  };
}
