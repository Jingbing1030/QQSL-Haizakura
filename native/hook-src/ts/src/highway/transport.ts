// The highway transfer's wire transport: a raw TCP socket plus a minimal HTTP/1.1
// POST, because the highway servers speak HTTP but not `fetch`-compatible HTTP.
//
// Reference region: `../protocol/src/highway/utils.ts` (reference/index.mjs:34120-34422),
// functions `tcpConnect`, `connectHighway`, `socketWrite`, `readHttpResponseBody`,
// `httpPostFrame`.
//
// ---------------------------------------------------------------------------
// Why not `fetch`
// ---------------------------------------------------------------------------
// The highway servers require `Connection: keep-alive` and, critically, they are
// reached by **raw IP and port** from the upload session — there is no DNS name
// and often no valid TLS certificate for that address. `fetch` would either
// refuse (certificate mismatch) or silently re-resolve. The reference opens a
// plain TCP socket and writes the request line by hand, and so does this.
//
// The second reason is `signal`-driven cancellation. An upload is frequently
// abandoned (the user sends a second image, the group is left, QQ is closing),
// and the reference threads one `AbortSignal` through every layer so an abort
// destroys the socket immediately rather than after the current chunk. `fetch`
// supports that; a hand-rolled socket needs it written out, which is what the
// `onAbort`/`cleanup` dance below is for.
//
// ---------------------------------------------------------------------------
// The response reader is deliberately not a parser
// ---------------------------------------------------------------------------
// Only one header is needed from the response: `Content-Length`. There is no
// interest in chunked encoding, keep-alive accounting, or the other headers. So
// this reads until `Content-Length` bytes have arrived, and treats a short read as
// an error. That is why the error messages mention `received`/`need` byte counts:
// when a highway upload fails part-way it is almost always a truncated response,
// and the counts are what identify it.
//
// The ONE exception is the status line, and it exists for a single caller:
// `AddCustomFace` (reference:319313) checks `!httpResp.ok` and fails with
// `highway upload failed: HTTP <status>`, which a body-only reader cannot
// reproduce. `readHttpResponse` returns `{status, body}`; `readHttpResponseBody`
// and `httpPostFrame` keep the old body-only shape for the chunk loop, whose
// behaviour must not change (it reads the ack out of the frame and a 4xx carrying
// a valid ack is accepted by the reference too).

import net from "node:net";

/** Why a highway response could not be read. Carries whatever body did arrive. */
export class HighwayResponseReadError extends Error {
  /**
   * The partial body, present only when a header was already parsed.
   *
   * Typed `| undefined` rather than optional because `exactOptionalPropertyTypes` is on:
   * without the explicit `undefined` the assignment below is rejected, and silencing that
   * with a non-null assertion would claim the field is always present when it is not.
   */
  readonly partialBody: Uint8Array | undefined;

  constructor(message: string, partialBody?: Uint8Array) {
    super(message);
    this.name = "HighwayResponseReadError";
    this.partialBody = partialBody;
  }
}

/** How long a single `connect(2)` may take before the next server is tried. */
export const HIGHWAY_CONNECT_TIMEOUT_MS = 3_000;

/**
 * Total budget for finding *any* working server.
 *
 * Per-server timeout alone is not enough: with several dead servers in the list a
 * caller would wait `n * 3 s`. This caps the whole search.
 */
export const HIGHWAY_CONNECT_BUDGET_MS = 10_000;

/**
 * How long the peer may stay silent mid-response before the read is abandoned.
 *
 * A highway server that accepts the connection and then sends nothing is a real
 * failure mode (the session expired between the bootstrap and the chunk), and
 * without this the upload would hang until the caller's own timeout.
 */
export const HIGHWAY_READ_IDLE_MS = 30_000;

/** Reject as soon as `signal` aborts, without waiting for the timer. */
function sleepMs(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export { sleepMs as highwaySleep };

/** A highway server as the session bootstrap reports it. */
export interface HighwayServer {
  host: string;
  port: number;
}

/**
 * Open one TCP connection, honouring both the timeout and the abort signal.
 *
 * On any failure the socket is destroyed before the promise rejects: a leaked
 * half-open socket would hold an fd for the process lifetime, and an upload
 * attempts several servers in a row.
 */
export function tcpConnect(
  host: string,
  port: number,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<net.Socket> {
  signal.throwIfAborted();
  return new Promise<net.Socket>((resolve, reject) => {
    let settled = false;
    const socket = net.createConnection({ host, port });
    const cleanup = (): void => {
      socket.setTimeout(0);
      socket.removeListener("timeout", onTimeout);
      socket.removeListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };
    const onTimeout = (): void => fail(new Error("TCP connect timeout"));
    const onError = (error: Error): void => fail(error);
    const onAbort = (): void => fail(signal.reason);

    socket.once("connect", () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(socket);
    });
    socket.setTimeout(timeoutMs);
    socket.once("timeout", onTimeout);
    socket.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Rendered failure text for an aggregate error, preferring `message`. */
function highwayErrorText(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * Try each server in turn until one connects, then return it.
 *
 * `startIndex` lets the caller remember which server worked last so a multi-chunk
 * upload does not re-probe the dead ones — the reference does this per transfer,
 * not per chunk, because the list is short.
 *
 * Throws an `AggregateError` naming every server that failed: when all of them
 * are down, "connection failed" alone is useless and the operator needs the list.
 */
export async function connectHighway(
  servers: readonly HighwayServer[],
  startIndex: number,
  signal: AbortSignal,
): Promise<{ socket: net.Socket; server: HighwayServer; serverIndex: number }> {
  const deadline = Date.now() + HIGHWAY_CONNECT_BUDGET_MS;
  const errors: Error[] = [];
  for (let i = 0; i < servers.length; i += 1) {
    const serverIndex = (startIndex + i) % servers.length;
    const server = servers[serverIndex];
    if (!server) continue;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      return {
        socket: await tcpConnect(
          server.host,
          server.port,
          Math.min(HIGHWAY_CONNECT_TIMEOUT_MS, remaining),
          signal,
        ),
        server,
        serverIndex,
      };
    } catch (cause) {
      signal.throwIfAborted();
      errors.push(new Error(`${server.host}:${server.port}: ${highwayErrorText(cause)}`));
    }
  }
  throw new AggregateError(
    errors,
    `highway upload connection failed: ${errors.map((error) => error.message).join("; ")}`,
  );
}

/** `socket.write` as a promise, so a write error rejects the caller's await. */
export function socketWrite(socket: net.Socket, data: Uint8Array): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.write(data, (err) => (err ? reject(err) : resolve()));
  });
}

/** One HTTP response as read off a highway socket. */
export interface HighwayHttpResponse {
  /**
   * The numeric status from the response line, or `0` when no response line was
   * received at all (a connect/write failure rather than an HTTP answer).
   *
   * `0` is deliberately not `200`: a caller that treats a missing status as success
   * would accept a reply it never got. `AddCustomFace` is the reason this is exposed
   * at all — it must fail with `highway upload failed: HTTP <status>`, which is
   * `!fetch(...).ok` in the reference.
   */
  status: number;
  body: Uint8Array;
}

/** Parse the status code out of an HTTP/1.x response line. `0` if unparseable. */
function parseHttpStatus(headerBytes: Buffer): number {
  const text = headerBytes.toString("ascii");
  const lineEnd = text.indexOf("\r\n");
  const statusLine = lineEnd >= 0 ? text.slice(0, lineEnd) : text;
  const match = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/);
  return match?.[1] !== undefined ? Number.parseInt(match[1], 10) : 0;
}

/**
 * Read one HTTP/1.1 response off a raw socket, body AND status.
 *
 * Resolves once `Content-Length` bytes have arrived after the header terminator. The
 * headers are otherwise discarded — see the module comment for why only
 * `Content-Length` is inspected. The status line is the one exception: `httpPostFrame`
 * callers that mirror `fetch(...).ok` need it, and re-reading the socket for it is not
 * possible.
 */
export function readHttpResponse(
  socket: net.Socket,
  signal: AbortSignal,
): Promise<HighwayHttpResponse> {
  signal.throwIfAborted();
  return new Promise<HighwayHttpResponse>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let headerEnd = -1;
    let status = 0;
    let contentLength = 0;
    let totalNeeded = 0;
    let settled = false;

    // Attached to read errors only when a header was already seen: before that, the error
    // describes the connection rather than the response body.
    const partialResponseBody = (): Uint8Array | undefined => {
      if (headerEnd < 0) return undefined;
      return new Uint8Array(Buffer.concat(chunks).subarray(headerEnd));
    };

    let idleTimer: NodeJS.Timeout | null = null;
    const armIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        finish(() =>
          reject(
            new HighwayResponseReadError(
              "highway response read timeout (peer idle)",
              partialResponseBody(),
            ),
          ),
        );
      }, HIGHWAY_READ_IDLE_MS);
    };
    const detach = (): void => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      detach();
      fn();
    };

    const onData = (chunk: Buffer): void => {
      armIdle();
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      if (headerEnd < 0) {
        const idx = buf.indexOf("\r\n\r\n");
        if (idx >= 0) {
          headerEnd = idx + 4;
          status = parseHttpStatus(buf.subarray(0, headerEnd));
          // `content-length` is the only header that matters. Its absence means a
          // 204/304-style empty body, which resolves on close.
          const match = buf
            .subarray(0, headerEnd)
            .toString("ascii")
            .toLowerCase()
            .match(/content-length:\s*(\d+)/);
          contentLength = match?.[1] ? Number.parseInt(match[1], 10) : 0;
          totalNeeded = headerEnd + contentLength;
        }
      }
      if (headerEnd >= 0 && buf.length >= totalNeeded) {
        finish(() => resolve({ status, body: new Uint8Array(buf.subarray(headerEnd, totalNeeded)) }));
      }
    };
    const onAbort = (): void => finish(() => reject(signal.reason));
    const onError = (err: Error): void => {
      finish(() => {
        const body = partialResponseBody();
        reject(body === undefined ? err : new HighwayResponseReadError(err.message, body));
      });
    };
    const onClose = (): void => {
      finish(() => {
        const buf = Buffer.concat(chunks);
        if (headerEnd >= 0 && contentLength === 0) {
          // No body promised, connection closed cleanly.
          resolve({ status, body: new Uint8Array(buf.subarray(headerEnd)) });
          return;
        }
        reject(
          new HighwayResponseReadError(
            `connection closed before full response (received=${buf.length}B, headerSeen=${
              headerEnd >= 0
            }${headerEnd >= 0 ? `, need=${totalNeeded}` : ""})`,
            partialResponseBody(),
          ),
        );
      });
    };

    armIdle();
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Body-only variant of {@link readHttpResponse}, kept for the upload chunk loop.
 *
 * The chunk loop genuinely does not care about the status line: it reads the
 * acknowledgement out of the framed body and treats an unparseable head as a control
 * decode failure. Adding a status check there would be a behaviour change (a 4xx with
 * a valid ack frame is accepted today and by the reference).
 */
export async function readHttpResponseBody(
  socket: net.Socket,
  signal: AbortSignal,
): Promise<Uint8Array> {
  return (await readHttpResponse(socket, signal)).body;
}

/** Extra header lines a caller needs on top of the fixed highway set. */
export interface HttpPostFrameOptions {
  /**
   * Additional header lines, written verbatim after the standard four.
   *
   * `AddCustomFace` is the only caller that needs this: the reference uses `fetch`
   * and passes `Accept`/`Cache-Control`/`Pragma` explicitly. Nothing here can change
   * `Connection`/`User-Agent`/`Content-Length`, because those are what the highway
   * servers actually key on.
   */
  extraHeaders?: readonly string[] | undefined;
}

/**
 * POST one already-framed chunk to `path` and return the raw response body and status.
 *
 * `host` is the `Host:` header value (the bare IP:port the session reported), and
 * `path` is the URL from the session's server list. Both come from
 * `HttpConn.0x6ff_501`; neither is derived here.
 *
 * The write and the read run concurrently on purpose. The server may start
 * answering before the body is fully written, and awaiting the write first would
 * deadlock on a small response: the server blocks writing its answer while we
 * block writing the body, and neither proceeds.
 */
export async function httpPostFrameWithStatus(
  socket: net.Socket,
  host: string,
  path: string,
  body: Uint8Array,
  signal: AbortSignal,
  options?: HttpPostFrameOptions,
): Promise<HighwayHttpResponse> {
  // The UA is the reference's, verbatim. It is an ancient IE string, which is what the
  // highway servers were built to accept; changing it risks a silent behavioural difference.
  //
  // ⚠️ `Accept-Encoding: identity` is this port's addition, not the reference's. The
  // reference inherits whatever `fetch` sends (gzip) and lets undici decompress; a
  // hand-rolled reader cannot, so asking for identity is what keeps a compressed reply
  // from being mis-parsed as a frame. See the module comment.
  let header =
    `POST ${path} HTTP/1.1\r\n` +
    `Host: ${host}\r\n` +
    `Connection: keep-alive\r\n` +
    `Accept-Encoding: identity\r\n` +
    `User-Agent: Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2)\r\n`;
  for (const line of options?.extraHeaders ?? []) header += `${line}\r\n`;
  header += `Content-Length: ${body.length}\r\n\r\n`;

  const responseAbort = new AbortController();
  const onAbort = (): void => {
    responseAbort.abort(signal.reason);
    socket.destroy();
  };
  signal.throwIfAborted();
  signal.addEventListener("abort", onAbort, { once: true });

  const response = readHttpResponse(socket, responseAbort.signal);
  const write = (async (): Promise<void> => {
    await socketWrite(socket, Buffer.from(header, "ascii"));
    signal.throwIfAborted();
    if (body.length > 0) await socketWrite(socket, body);
  })();

  try {
    const [, result] = await Promise.all([write, response]);
    return result;
  } catch (error) {
    // Abort the read before awaiting it: `Promise.all` rejects on the first failure but
    // leaves the other branch running, and `finally` must not run while it still holds the
    // socket.
    responseAbort.abort(error);
    socket.destroy();
    await Promise.allSettled([write, response]);
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Body-only POST, the form every existing caller uses.
 *
 * Delegates to {@link httpPostFrameWithStatus} and throws the status away, so the
 * chunk loop's behaviour is byte-for-byte what it was.
 */
export async function httpPostFrame(
  socket: net.Socket,
  host: string,
  path: string,
  body: Uint8Array,
  signal: AbortSignal,
  options?: HttpPostFrameOptions,
): Promise<Uint8Array> {
  return (await httpPostFrameWithStatus(socket, host, path, body, signal, options)).body;
}
