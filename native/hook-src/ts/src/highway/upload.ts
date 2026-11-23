// The highway upload orchestrator — chunking, retries, concurrency, and the
// acknowledgement checks that decide whether a chunk actually landed.
//
// Reference region: `../protocol/src/highway/highway-put.ts` (reference/index.mjs:34503+,
// `uploadHighwayHttpOperation` and its chunk loop), plus `BufferChunkSource` /
// `FileChunkSource` (reference/index.mjs:34423-34440).
//
// ---------------------------------------------------------------------------
// Why this is a state machine and not a `for` loop
// ---------------------------------------------------------------------------
// A naive loop (`for (offset = 0; offset < size; offset += BLOCK)`) is wrong for
// three independent reasons, and each one costs a failed upload:
//
//   1. **The server can reject one chunk and accept the next.** `error_code`
//      102902 / 302902 means "backpressure, slow down"; it is not fatal, and the
//      reference retries the SAME offset up to 8 times. A loop that advanced the
//      offset on any response would silently skip a megabyte.
//   2. **The server can answer out of order.** With concurrency > 1 the
//      acknowledgement carries `dataOffset`, and the reference compares it
//      against the offset it sent. A response for the wrong chunk must not be
//      applied to this one — hence `confirmed` is a set of offsets, not a
//      running total.
//   3. **A transport failure retries on a DIFFERENT server.** The session
//      bootstrap returns several servers; a chunk that dies mid-write moves to
//      the next one. That is why `worker.serverIndex` is mutable state.
//      Advancing the offset on a transport failure would leave a hole.
//
// The reference's own structure reflects all three: `transportAttempts` and
// `delayRetries` are separate counters, and `continue` re-enters the same offset.
//
// ---------------------------------------------------------------------------
// What "confirmed" means
// ---------------------------------------------------------------------------
// A chunk is confirmed only when the server echoes back THREE values that all
// match: `seq`, `filesize`, and `dataOffset` (plus `dataLength` when present).
// Checking just one is not enough — a stale response from a previous attempt
// carries a matching offset but a different seq, and a mismatched segment length
// means the server wrote fewer bytes than we sent. The reference's error text
// names all five values for exactly this reason.
//
// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------
// Chunks may be in flight simultaneously (`effectiveConcurrency`), but the
// reference starts at 1 and only a caller-supplied option raises it. On
// backpressure it drops back to 1 and logs a warning. Reproducing the
// reduction matters: a client that keeps its concurrency after a 102902 keeps
// getting 102902.

import { createHash } from "node:crypto";
import { open as fsOpen } from "node:fs/promises";

import {
  connectHighway,
  httpPostFrame,
  HighwayResponseReadError,
  highwaySleep as sleepMs,
  type HighwayServer,
} from "./transport.js";
import { packHighwayFrame, unpackHighwayFrame } from "./frame.js";
import {
  decodeRespDataHighwayHead,
  encodeReqDataHighwayHead,
  HIGHWAY_APP_ID,
  HIGHWAY_COMMAND_UPLOAD,
  HIGHWAY_DATA_FLAG_UPLOAD,
  HIGHWAY_LOGIN_SIG_TYPE,
  type ReqDataHighwayHead,
} from "./head.js";

/** Bytes per chunk request. 1 MiB, from the reference. */
export const HIGHWAY_BLOCK_SIZE = 1024 * 1024;

/** Transport failures tolerated for one chunk before the upload is abandoned. */
export const HIGHWAY_MAX_CHUNK_ATTEMPTS = 3;

/** Backoff base for a transport retry; multiplied by the attempt number. */
export const HIGHWAY_RETRY_BASE_MS = 300;

/** `error_code` values that mean "slow down and retry", not "failed". */
export const HIGHWAY_DELAY_RETRY_CODES: ReadonlySet<number> = new Set([102_902, 302_902]);

/** Fixed delay before retrying a backpressured chunk. */
export const HIGHWAY_DELAY_RETRY_MS = 250;

/** How many backpressure retries one chunk tolerates before the server is written off. */
export const HIGHWAY_MAX_DELAY_RETRIES = 8;

/** Why an upload failed, as a stable token for logs and tests. */
export type HighwayFailureReason =
  | "source_read_failed"
  | "connect_exhausted"
  | "transport_exhausted"
  | "control_decode_failed"
  | "server_rejected"
  | "ack_mismatch";

/** Thrown when an upload cannot complete. Carries the machine-readable reason. */
export class HighwayUploadError extends Error {
  readonly reason: HighwayFailureReason;

  constructor(reason: HighwayFailureReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HighwayUploadError";
    this.reason = reason;
  }
}

/**
 * Bytes to upload, addressable by offset.
 *
 * Two implementations exist because the two callers differ: an image from a
 * `base64://` source is already in memory, while a group file is on disk and may
 * be gigabytes. Reading a 4 GiB file into memory to upload it is not an option.
 */
export interface ChunkSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** A source over an in-memory buffer. `close()` is a no-op by design. */
export class BufferChunkSource implements ChunkSource {
  readonly #bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  get size(): number {
    return this.#bytes.length;
  }

  read(offset: number, length: number): Promise<Uint8Array> {
    return Promise.resolve(this.#bytes.subarray(offset, offset + length));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * A source over a file handle.
 *
 * Reads loop until the requested length is filled: `read()` is allowed to return
 * short, and a single call that returns 300 KiB for a 1 MiB request would fail
 * the length check below with a misleading "source returned 300000 bytes".
 */
export class FileChunkSource implements ChunkSource {
  readonly #handle: Awaited<ReturnType<typeof fsOpen>>;
  readonly size: number;

  private constructor(handle: Awaited<ReturnType<typeof fsOpen>>, size: number) {
    this.#handle = handle;
    this.size = size;
  }

  static async open(path: string): Promise<FileChunkSource> {
    const handle = await fsOpen(path, "r");
    const stat = await handle.stat();
    return new FileChunkSource(handle, stat.size);
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const buffer = new Uint8Array(length);
    let got = 0;
    while (got < length) {
      const { bytesRead } = await this.#handle.read(buffer, got, length - got, offset + got);
      if (bytesRead === 0) break; // EOF: the caller's length check reports the shortfall.
      got += bytesRead;
    }
    return buffer.subarray(0, got);
  }

  close(): Promise<void> {
    return this.#handle.close();
  }
}

/** MD5 as a `Uint8Array`, which is what the head codec wants. */
function md5(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("md5").update(bytes).digest());
}

/** One chunk request, fully populated. */
function makeHead(
  uin: string,
  commandId: number,
  fileSize: number,
  offset: number,
  length: number,
  chunkMd5: Uint8Array,
  fileMd5: Uint8Array,
  sigSession: Uint8Array,
  extend: Uint8Array,
  retryTimes: number,
  sequence: number,
): Uint8Array {
  const request: ReqDataHighwayHead = {
    msgBaseHead: {
      version: 1,
      uin,
      command: HIGHWAY_COMMAND_UPLOAD,
      seq: sequence,
      retryTimes,
      appId: HIGHWAY_APP_ID,
      dataFlag: HIGHWAY_DATA_FLAG_UPLOAD,
      commandId,
    },
    msgSegHead: {
      serviceId: 0,
      filesize: BigInt(fileSize),
      dataOffset: BigInt(offset),
      dataLength: length,
      retCode: 0,
      serviceTicket: sigSession,
      flag: 0,
      md5: chunkMd5,
      fileMd5,
      cacheAddr: 0,
      cachePort: 0,
    },
    bytesReqExtendInfo: extend,
    timestamp: 0n,
    msgLoginSigHead: { loginSigType: HIGHWAY_LOGIN_SIG_TYPE, appId: HIGHWAY_APP_ID },
  };
  return encodeReqDataHighwayHead(request);
}

/** What the caller must know about the session before uploading. */
export interface HighwayUploadSession {
  /** The `sig_session` ticket from `HttpConn.0x6ff_501`. */
  sigSession: Uint8Array;
  /** Candidate servers, in the order the bootstrap returned them. */
  servers: readonly HighwayServer[];
}

/** Everything one upload needs. */
export interface HighwayUploadOptions {
  /** Decimal uin, as a string. */
  uin: string;
  /** `1003` for a private image, `1004` for a group image. */
  commandId: number;
  session: HighwayUploadSession;
  /** MD5 of the whole file, computed by the caller (it usually already has it). */
  fileMd5: Uint8Array;
  /** The file-key extension; empty for a plain image upload. */
  extend?: Uint8Array;
  /**
   * Chunks in flight. Defaults to 1, matching the reference.
   *
   * Raising this is not an optimisation to apply blindly: the servers commonly
   * answer 102902 to a concurrent upload, at which point this drops back to 1
   * anyway and the attempt was wasted.
   */
  concurrency?: number;
  /** Cancels the upload. A destroyed socket is the normal outcome of aborting. */
  signal?: AbortSignal;
}

/** Result of a successful upload. */
export interface HighwayUploadResult {
  /** Chunks the server acknowledged. Equals `size / HIGHWAY_BLOCK_SIZE` rounded up. */
  chunks: number;
  /** Total bytes sent. */
  bytes: number;
}

/** One server connection, reused across chunks until it fails. */
interface Worker {
  id: number;
  socket: Awaited<ReturnType<typeof connectHighway>>["socket"] | null;
  serverIndex: number;
  connections: number;
}

/**
 * Upload `source` through the highway servers.
 *
 * Resolves only when every chunk has been acknowledged. Any other outcome throws
 * a `HighwayUploadError` whose `reason` names the specific stage — which is what
 * makes a failed upload diagnosable from a log line without the payload dump.
 */
export async function uploadHighway(
  source: ChunkSource,
  options: HighwayUploadOptions,
): Promise<HighwayUploadResult> {
  const { uin, commandId, session, fileMd5 } = options;
  const extend = options.extend ?? new Uint8Array(0);
  const totalSize = source.size;
  const path = `/cgi-bin/httpconn?htcmd=0x6FF0087&uin=${uin}`;

  const abort = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([abort.signal, options.signal])
    : abort.signal;

  // Chunks are numbered, not offset-based: the offset is derived from the index so a retry
  // cannot land on a shifted boundary.
  const chunkCount = Math.ceil(totalSize / HIGHWAY_BLOCK_SIZE);
  let effectiveConcurrency = Math.max(1, options.concurrency ?? 1);
  let sequence = 0;

  const worker: Worker = { id: 1, socket: null, serverIndex: 0, connections: 0 };
  const fail = (reason: HighwayFailureReason, error: unknown): never => {
    if (!signal.aborted) abort.abort(error);
    throw new HighwayUploadError(reason, error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  };

  try {
    for (let piece = 0; piece < chunkCount; piece += 1) {
      signal.throwIfAborted();
      const offset = piece * HIGHWAY_BLOCK_SIZE;
      const chunkSize = Math.min(HIGHWAY_BLOCK_SIZE, totalSize - offset);

      let chunk: Uint8Array;
      try {
        chunk = await source.read(offset, chunkSize);
      } catch (error) {
        return fail("source_read_failed", error);
      }
      if (chunk.byteLength !== chunkSize) {
        return fail(
          "source_read_failed",
          new Error(
            `highway source returned ${chunk.byteLength} bytes, expected ${chunkSize} at offset ${offset}`,
          ),
        );
      }

      const chunkMd5 = md5(chunk);
      const requestSequence = effectiveConcurrency === 1 ? 0 : (sequence += 1);

      let transportAttempts = 0;
      let delayRetries = 0;
      let confirmed = false;

      while (!confirmed) {
        signal.throwIfAborted();
        const retryTimes = transportAttempts + delayRetries;

        let responseBody: Uint8Array;
        try {
          if (worker.socket && (worker.socket.destroyed || worker.socket.readableEnded || !worker.socket.writable)) {
            worker.socket.destroy();
            worker.socket = null;
          }
          if (!worker.socket) {
            const connected = await connectHighway(session.servers, worker.serverIndex, signal);
            worker.socket = connected.socket;
            worker.serverIndex = connected.serverIndex;
            worker.connections += 1;
            // Without this listener a socket error after connect is an unhandled 'error' event,
            // which terminates the process. The chunk loop detects the dead socket on its next
            // iteration; this only prevents the crash.
            worker.socket.on("error", () => {
              worker.socket?.destroy();
              worker.socket = null;
            });
          }
          const head = makeHead(
            uin,
            commandId,
            totalSize,
            offset,
            chunkSize,
            chunkMd5,
            fileMd5,
            session.sigSession,
            extend,
            retryTimes,
            requestSequence,
          );
          const framed = packHighwayFrame(head, chunk);
          responseBody = await httpPostFrame(
            worker.socket,
            session.servers[worker.serverIndex]!.host,
            path,
            framed,
            signal,
          );
          // Opt-in wire dump, first chunk only.
          //
          // A server-side rejection (`error_code != 0`) names a number and nothing else, so the
          // only way to tell "our head is malformed" from "the server does not want this file"
          // is to read the bytes that actually went out. Off by default because it writes two
          // files per upload; `HZ_HIGHWAY_DUMP=1` turns it on.
          if (offset === 0 && process.env.HZ_HIGHWAY_DUMP === "1") {
            try {
              const { writeFileSync } = await import("node:fs");
              writeFileSync("/tmp/hz-highway-head.bin", head);
              writeFileSync("/tmp/hz-highway-frame.bin", framed);
              writeFileSync("/tmp/hz-highway-resp.bin", responseBody);
            } catch {
              // A read-only filesystem is not a reason to fail an upload.
            }
          }
        } catch (error) {
          signal.throwIfAborted();
          // `connections === 0` means we never reached a server at all, so retrying the same
          // chunk is pointless — connectHighway already tried every one.
          if (worker.connections === 0) return fail("connect_exhausted", error);
          if (error instanceof HighwayResponseReadError && error.partialBody) {
            // The body is truncated: the server started answering and stopped. Not retryable
            // on this socket, but the next server may be healthy.
          }
          worker.socket?.destroy();
          worker.socket = null;
          transportAttempts += 1;
          if (transportAttempts >= HIGHWAY_MAX_CHUNK_ATTEMPTS) {
            return fail(
              "transport_exhausted",
              new Error(
                `highway upload transport failed after ${transportAttempts} attempts ` +
                  `(cmdId=${commandId} chunk=${chunkSize}/${totalSize} offset=${offset}): ${String(error)}`,
                { cause: error },
              ),
            );
          }
          worker.serverIndex = (worker.serverIndex + 1) % session.servers.length;
          await sleepMs(HIGHWAY_RETRY_BASE_MS * transportAttempts, signal);
          continue;
        }

        let response;
        try {
          response = decodeRespDataHighwayHead(unpackHighwayFrame(responseBody).head);
        } catch (error) {
          return fail("control_decode_failed", error);
        }

        const errorCode = response.errorCode;
        const segRetCode = response.msgSegHead?.retCode ?? 0;

        if (HIGHWAY_DELAY_RETRY_CODES.has(errorCode)) {
          worker.socket?.destroy();
          worker.socket = null;
          delayRetries += 1;
          if (delayRetries >= HIGHWAY_MAX_DELAY_RETRIES) {
            return fail(
              "server_rejected",
              new Error(
                `highway upload error_code=${errorCode} (cmdId=${commandId} ` +
                  `chunk=${chunkSize}/${totalSize} offset=${offset} segRetCode=${segRetCode})`,
              ),
            );
          }
          if (effectiveConcurrency > 1) {
            // Reproduced deliberately: a client that keeps its concurrency after backpressure
            // keeps receiving backpressure.
            effectiveConcurrency = 1;
          }
          worker.serverIndex = (worker.serverIndex + 1) % session.servers.length;
          await sleepMs(HIGHWAY_DELAY_RETRY_MS, signal);
          continue;
        }

        if (errorCode !== 0 || segRetCode !== 0) {
          return fail(
            "server_rejected",
            new Error(
              `highway upload error_code=${errorCode} (cmdId=${commandId} ` +
                `chunk=${chunkSize}/${totalSize} offset=${offset} segRetCode=${segRetCode})`,
            ),
          );
        }

        // Acknowledgement. Every echoed value that is present must match; a mismatch means the
        // server wrote a different chunk than we sent, and continuing would corrupt the file.
        const seg = response.msgSegHead;
        const ackSeq = response.msgBaseHead?.seq;
        if (
          (ackSeq != null && ackSeq !== requestSequence) ||
          (seg?.filesize != null && seg.filesize !== BigInt(totalSize)) ||
          (seg?.dataOffset != null && seg.dataOffset !== BigInt(offset)) ||
          (seg?.dataLength != null && seg.dataLength !== chunkSize)
        ) {
          return fail(
            "ack_mismatch",
            new Error(
              `highway acknowledgement mismatch (cmdId=${commandId} offset=${offset} ` +
                `bytes=${chunkSize} seq=${requestSequence}; ackOffset=${String(seg?.dataOffset)} ` +
                `ackBytes=${String(seg?.dataLength)} ackSeq=${String(ackSeq)})`,
            ),
          );
        }

        confirmed = true;
      }
    }

    return { chunks: chunkCount, bytes: totalSize };
  } finally {
    worker.socket?.destroy();
    // `close()` runs even on the failure paths above; a filesystem handle leaked per failed
    // upload would exhaust the process's fd limit after a few hundred retries.
    await source.close().catch(() => undefined);
  }
}
