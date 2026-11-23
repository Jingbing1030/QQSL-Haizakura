// `HookClient` — the socket half of the hook: one control connection, the hello
// handshake, and requestId-correlated op 2 requests.
//
// Reference region: `../bridge/src/qq-hook-client.ts` (reference/index.mjs:2037,
// class `QqHookClient`, ~570 lines). What is ported here is the transport only:
//
//   connect / hello           op 1 out, op 1 back, both on the control socket
//   send                      op 2 request, op 3 ack, op 4 reply, op 5 error
//   login state               op 7 (and op 22's capability report)
//   pending bookkeeping       requestId allocator, per-request deadline, cleanup
//
// NOT ported, and deliberately so: the recv channel (op 6/21/22 packet delivery,
// `startRecv`/`handleRecvFrame`). That is a second socket with its own handshake and
// its own consumer (the packet pipeline), and mixing it in here would make this class
// impossible to test without a fake that speaks two channels. `resolveHookRuntimeDir`'s
// `/proc` probing is ported because the socket path is derived from it.
//
// ---------------------------------------------------------------------------
// What the hello handshake actually is (measured, and not what the docs say)
// ---------------------------------------------------------------------------
// The payload sends its own op 1 on accept, before reading anything — that is in the
// disassembly (`docs/reverse-socket-protocol.md` §2.5: both channels call the hello
// builder at `0x1125f`, before the receive loop at `0x113a0`) and it is why "connect and
// wait for hello" was enough for the reference Node client for months.
//
// The working test client on the oracle box (`/tmp/hzc.mjs`) does something extra: it
// writes op 1 itself, with `msg` = the absolute socket path and `value0` = the pid, and
// *then* reads. Both halves are therefore kept here: we write our hello and we wait for
// the payload's. Waiting is what makes the handshake meaningful (a socket that accepts
// but never answers is a dead payload, not a connected one), and writing is what the
// known-working client does, so a payload that ever starts requiring a client hello
// keeps working.
//
// `msg` is the full path, not the short pipe name. `docs/payload-protocol.md` §4 records
// a 2026-11-19 experiment that sent the short name `mojo.85885.control` and got a valid
// reply, while `/tmp/hzc.mjs` — the client that is known to work against the real
// payload — sends `/tmp/runtime-1000/mojo.85885.control.sock`. The payload does not
// appear to validate it (both forms were answered), so the path is used because it is
// the form with live-payload evidence behind it, and `helloPipeName` exists to override
// it if that ever turns out to be wrong.
//
// ---------------------------------------------------------------------------
// Why a request has ONE deadline instead of the reference's two
// ---------------------------------------------------------------------------
// The reference waits for op 3 with `ackTimeoutMs` and then, separately, for op 4 with
// `replyTimeoutMs`. That is two budgets for one `PacketClient.sendPacket` call, and the
// caller-facing `timeoutMs` in `PacketClient` is a single total budget — so a request
// that acks at 4.9 s and then never replies would hold a bridge call for 35 s against a
// 15 s contract. Here one timer covers ack+reply; op 3 is still tracked, but only as a
// trace-level fact ("the payload has the request"), never as a state the promise depends
// on. A late op 3 for an already-settled request is ignored, which is the same rule a
// late op 4 gets.
//
// ---------------------------------------------------------------------------
// -39 is a health signal, not a failure code (measured)
// ---------------------------------------------------------------------------
// The payload's op 5 status for a request it could not send is `-38` or `-39`, chosen by
// one branch (`docs/reverse-socket-protocol.md` §2.4, `0x1324a`–`0x1324f`: `0xffffffda`
// vs `0xffffffd9`, "depending on whether the state is 2" — and state 2 is the one whose
// message is "The QQ connection changed"). The reference client branches on exactly that
// number: `if (error.status === -39) this.setOutboundHealth(false)`
// (reference/index.mjs:2680). So -39 means "the pipe this session was using is gone",
// which is a different fact from "this request was refused" and must survive the
// request: it is exposed as `outboundHealthy` and via `onOutboundHealthChanged`.
//
// The raw status is returned as `errorCode` rather than being flattened to -1 the way the
// reference's `HookPacketClient` flattens it (reference/index.mjs:2679-2690). Flattening
// loses the only thing a caller can act on, and `decodeRefusal` in protocol.ts already
// knows how to turn each documented status into user-facing text.
//
// ---------------------------------------------------------------------------
// -1 keeps its meaning
// ---------------------------------------------------------------------------
// `-1` is reserved for "no frame answered this request" — a timeout, a closed socket, a
// connect failure. `Bridge.sendRawPacket` already documents `errorCode === -1` as its
// sentinel, so keeping the payload's own statuses out of that value is what keeps the
// two conditions distinguishable.

import { readFileSync } from "node:fs";
import net from "node:net";

import {
  Flag,
  FRAME_HEADER_SIZE,
  Op,
  decodeFrame,
  decodeLoginState,
  decodeRefusal,
  encodeFrame,
} from "./protocol.js";
import type { Frame } from "./protocol.js";
import type { PacketClient, PacketSendResult } from "./bridge/context.js";
import { packetTimeoutMs } from "./bridge/context.js";
import { createLogger, errorMessage } from "./onebot/log.js";
import { readEnvAlias } from "./bridge/env.js";

const log = createLogger("Hook.Client");

/** How long a `connect(2)` may take before the socket is written off. */
export const HOOK_CONNECT_TIMEOUT_MS = 5_000;

/**
 * How long the payload may take to answer our hello.
 *
 * Deliberately much shorter than the 60 s the reference Node client waits
 * (`INITIAL_CONNECTION_TIMEOUT_MS`; its log line is `initial connection timed out:
 * ... phase=handshake`, MEMORY.md §2.3d). This client reconnects eagerly — every
 * `sendPacket` retries — so a long wait buys nothing but makes the first request after a
 * dead payload take a minute to fail. A false negative costs one reconnect attempt, and
 * the payload answers on accept, so 5 s is already generous for a loopback unix socket.
 *
 * NOT measured against a live payload: the measurement above is of the reference's
 * *timeout*, not of how long the real payload actually takes to answer.
 */
export const HOOK_HELLO_TIMEOUT_MS = 5_000;

/**
 * The payload command that originates a send with no trigger.
 *
 * `DSND` is our own addition to the control protocol (test/payload.cc, the kOpRequest branch that
 * matches "DSND"). It calls QQ's real `sendSsoInternal` through the relay's replay stub, reusing
 * QQ's own instance and ctx, so the message leaves the client with nobody having typed anything.
 *
 * It is a four-byte command because the frame header carries the command name inline, and four
 * keeps it in the same shape as `INJ0` / `DUMP`.
 */
export const DIRECT_SEND_CMD = "DSND";

/**
 * The SSO command that sends a message.
 *
 * Named here because `sendPacket` has to recognise it in order to route it to the direct-send
 * path; every other command keeps going through the generic op-2 request.
 */
export const SEND_MSG_CMD = "MessageSvc.PbSendMsg";

/**
 * Explain a non-zero `DSND` ACK status.
 *
 * The numbers come from `hz_direct_send`'s return codes. Each one means the call never happened,
 * so no recv-side reply will ever arrive; saying which precondition failed is the difference
 * between a fixable report and "send failed".
 */
function directSendRefusal(status: number): string {
  switch (status) {
    case 1:
      return (
        "direct send refused: the payload has not captured QQ's send instance and ctx yet "
        + "(code 1). It needs to observe one real send first -- in a headless deployment, "
        + "restart the client once with the payload loaded and send anything from the phone, "
        + "or use the reference implementation for that one bootstrap message."
      );
    case 2:
      return "direct send refused: bad arguments (code 2)";
    case 3:
      return "direct send refused: the send entry is not hooked, install with which=24 first (code 3)";
    case 4:
      return "direct send refused: no replay stub for the send entry (code 4)";
    case 5:
      return "direct send refused: command name length out of range (code 5)";
    default:
      return `direct send refused with status ${String(status)}`;
  }
}

/**
 * Largest body a reply may claim.
 *
 * `decodeFrame` bounds `cmdLen` and `msgLen` but NOT `bodyLen` (protocol.ts:141-152), so
 * a corrupt or hostile header claiming a 4 GiB body would make this client buffer 4 GiB
 * before deciding anything. The reference caps body frames at 16 MiB
 * (`MAX_PIPE_BODY_BYTES`, reference/index.mjs:1864); the same cap is enforced here, before
 * `decodeFrame` is even called. This belongs in the client rather than in the codec
 * because the codec's contract is "decode one frame from a buffer that holds it".
 */
export const HOOK_MAX_BODY_BYTES = 16 * 1024 * 1024;

/** op 5 status: the outbound pipe this session used is unhealthy. See the header. */
export const HOOK_STATUS_OUTBOUND_UNHEALTHY = -39;

/** op 5 status: the payload has no send path at all (`ENOSYS`, -38). Not a health fact. */
export const HOOK_STATUS_UNIMPLEMENTED = -38;

/** `errorCode` used for "no frame answered": timeout, connect failure, closed socket. */
export const HOOK_NO_ANSWER_CODE = -1;

/** What the payload's hello told us about this channel. */
export interface HookHello {
  /**
   * The `msg` the payload echoed. Measured to be the absolute socket path, not the short
   * pipe name we send, so callers that compare it against their own path must expect that.
   */
  pipeName: string;
  /** `value0` — the pid, echoed. */
  pid: number;
  /**
   * `status` of the hello: `channelKind * 2` (`0` control, `2` recv), per the disassembly
   * at `0x13a30`. Kept because it is the only way to tell the two channels' hellos apart.
   */
  channelStatus: number;
}

/** The slice of op 7's meaning this client keeps. */
export interface HookLoginState {
  loggedIn: boolean;
  /**
   * Null when the payload reports "logged in" without being able to read the account
   * number out of wrapper.node. That is a legitimate report (protocol.ts:228-234) and is
   * not repaired here: an invented uin attributes every later message to a non-existent
   * account.
   */
  uin: string | null;
}

/** op 22: whether the payload can report private messages from QQ itself. */
export interface HookPrivateMessageReporting {
  /** `status === 1` means available; every other status means not. */
  available: boolean;
  /** `value0` — the payload's reason code when unavailable. */
  reason: bigint;
}

export interface HookClientOptions {
  /** The QQ process whose control socket we speak to. */
  pid: number;
  /**
   * Socket directory. Defaults to the target process's `SNOWLUMA_HOOK_RUNTIME_DIR`, and
   * that default is the interesting one — see `resolveHookRuntimeDir`.
   */
  runtimeDir?: string;
  /** Full control socket path; overrides `runtimeDir`. The only thing tests need. */
  controlSocketPath?: string;
  /**
   * `msg` of our hello. Defaults to `controlSocketPath`. Exists because the docs and the
   * working client disagree about path-vs-pipe-name (see the file header) and this is not
   * something a live payload can be asked about in a unit test.
   */
  helloPipeName?: string;
  connectTimeoutMs?: number;
  helloTimeoutMs?: number;
  /** Used when `sendPacket` is called without its own timeout. */
  replyTimeoutMs?: number;
  maxBodyBytes?: number;
  /**
   * Called whenever op 7 changes what we believe, including the reset to "not logged in"
   * that a dropped connection forces.
   */
  onLoginState?: (state: HookLoginState) => void;
  /** Called when -39 (or a reply) flips the outbound-health signal. */
  onOutboundHealthChanged?: (healthy: boolean) => void;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/**
 * A deferred whose rejection nobody is obliged to observe.
 *
 * The no-op `catch` is not cosmetic: the hello deferred is rejected when a connection
 * dies, and by then the `connect()` caller may already have timed out and moved on. An
 * unobserved rejection would surface as an unhandledRejection in the host process — the
 * reference attaches the same no-op for the same reason (reference/index.mjs:2208).
 */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/** `0` or a negative value means "no deadline", matching the reference's `withTimeout`. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** One in-flight op 2 request. */
interface PendingRequest {
  serviceCmd: string;
  /**
   * Set when op 3 arrives. Read by nothing but the trace line below it.
   *
   * Kept as a field rather than a local because the ACK and the request are different
   * frames on different ticks: the trace that reports "acked serviceCmd=X" runs in the
   * frame handler, and it has only the map entry to say which command this id belongs to.
   */
  acked: boolean;
  timer: NodeJS.Timeout | null;
  settle(result: PacketSendResult): void;
  /**
   * Called with the ACK's `value0` when op 3 arrives, if a caller is waiting for it.
   *
   * Only the direct-send path uses this: `DSND` reports a refusal on its ACK rather than by
   * omitting a reply, so the caller has to be able to see the status instead of only the fact
   * that an ACK happened. Cleared when the request settles so a late ACK cannot fire twice.
   */
  onAck?: ((status: number) => void) | null;
}

function failure(errorMessage: string, errorCode = HOOK_NO_ANSWER_CODE): PacketSendResult {
  return { success: false, gotResponse: false, errorCode, errorMessage };
}

/**
 * `mojo.<pid>.<kind>.sock` inside `runtimeDir`.
 *
 * A trailing slash on the directory is dropped rather than producing `/tmp/x//mojo...`:
 * the path is compared against the payload's echoed `msg`, and the payload reports exactly
 * one slash. Two paths that differ only in that respect would look like different sockets
 * in a log even though they are the same file.
 */
export function hookSocketPath(runtimeDir: string, pid: number, kind: "control" | "recv"): string {
  const base = runtimeDir.endsWith("/") ? runtimeDir.slice(0, -1) : runtimeDir;
  return `${base}/mojo.${pid}.${kind}.sock`;
}

/**
 * Read the socket paths the payload says it actually bound.
 *
 * The payload announces itself in `<runtimeDir>/hz-control.started` (written when its listener
 * thread comes up). Historically that file held only `pid=`/`tid=`; it now also carries
 * `control=` and `recv=` lines, because the derived name is not always the one in use.
 *
 * Why this exists: when another live listener already owns `mojo.<pid>.control.sock` -- which is
 * precisely the case while the reference implementation is running alongside this one -- the
 * payload binds `mojo.<pid>.hz.control.sock` instead. A client that derived the name would dial
 * the reference's socket, receive well-formed ACKs from it, and see every command it sent have no
 * effect. That is a silent, extremely convincing failure: the ACK says the request was accepted,
 * and nothing happens. Measured 2026-11-24 (two sockets on one pid, the derived one 56 s older).
 *
 * Returns only the keys the payload published; a missing or old-format file yields null and the
 * caller falls back to the derived path, which is the right answer when nothing else is running.
 */
export function readStartedSockets(
  runtimeDir: string,
  pid: number,
): { control: string; recv: string | null } | null {
  const base = runtimeDir.endsWith("/") ? runtimeDir.slice(0, -1) : runtimeDir;
  // The payload names the marker after the socket it bound: `<base>-control.started`, where
  // `<base>` is the socket path minus `.control.sock`. So the derived name gives
  // `mojo.<pid>-control.started` and the suffixed one gives `mojo.<pid>.hz-control.started`.
  // Both are tried, and the payload's own file is what decides -- there is no name to guess wrong.
  for (const name of [
    `mojo.${pid}.hz-control.started`,
    `mojo.${pid}-control.started`,
    "hz-control.started",
  ]) {
    let text: string;
    try {
      text = readFileSync(`${base}/${name}`, "utf8");
    } catch {
      continue;
    }
    let control: string | null = null;
    let recv: string | null = null;
    for (const line of text.split("\n")) {
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (value === "") continue;
      if (key === "control") control = value;
      else if (key === "recv") recv = value;
    }
    if (control !== null) return { control, recv };
  }
  return null;
}

/**
 * The socket directory for a target QQ process.
 *
 * Order, copied from the reference (`resolveHookRuntimeDir`, reference/index.mjs:1735)
 * because the order is the whole point:
 *
 *   1. target's `/proc/<pid>/environ` SNOWLUMA_HOOK_RUNTIME_DIR
 *   2. target's XDG_RUNTIME_DIR
 *   3. target's real uid from `/proc/<pid>/status` → `/tmp/snowluma-<uid>`
 *   4. (only when the process is gone) our own env, then our own uid
 *
 * **Our** environment is not authoritative: the supervisor that runs Node may be a
 * different user from QQ, and the deployment in MEMORY.md §"QQ 环境" sets
 * `SNOWLUMA_HOOK_RUNTIME_DIR=/tmp/runtime-1000` in *QQ's* environment. Reading it out of
 * the target is what makes the derived path the real one instead of a guess — the
 * task-briefed path `/tmp/runtime-1000/mojo.<pid>.control.sock` falls out of step 1.
 */
export function resolveHookRuntimeDir(pid: number, env: NodeJS.ProcessEnv = process.env): string {
  const ownUid = typeof process.geteuid === "function" ? process.geteuid() : 0;
  const own = (): string => {
    const explicit = absoluteDirectory(readEnvAlias("HOOK_RUNTIME_DIR", env));
    if (explicit) return explicit;
    const xdg = absoluteDirectory(env["XDG_RUNTIME_DIR"]);
    if (xdg) return xdg;
    return `/tmp/snowluma-${ownUid}`;
  };

  if (!Number.isSafeInteger(pid) || pid <= 0) return own();

  let environError: string;
  try {
    const targetEnv = parseEnviron(readFileSync(`/proc/${pid}/environ`, "utf8"));
    const explicit = absoluteDirectory(readEnvAlias("HOOK_RUNTIME_DIR", targetEnv));
    if (explicit) return explicit;
    const xdg = absoluteDirectory(targetEnv["XDG_RUNTIME_DIR"]);
    if (xdg) return xdg;
    environError = "HAIZAKURA_HOOK_RUNTIME_DIR (or SNOWLUMA_HOOK_RUNTIME_DIR) and XDG_RUNTIME_DIR are not set in the target";
  } catch (error) {
    environError = errorMessage(error);
  }

  try {
    const uid = parseRealUid(readFileSync(`/proc/${pid}/status`, "utf8"));
    if (uid !== null) return `/tmp/snowluma-${uid}`;
  } catch (error) {
    environError = `${environError}; /proc/${pid}/status: ${errorMessage(error)}`;
  }

  // Both probes failed. If the process is gone, its own env is all we have; if it exists
  // but we cannot read it, saying so is better than silently using a path that will not
  // have a socket file in it.
  if (!processAlive(pid)) return own();
  throw new Error(`cannot resolve hook runtime directory for PID ${String(pid)}: ${environError}`);
}

/** `/proc/<pid>/environ` is NUL-separated `K=V`. */
function parseEnviron(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of raw.split("\0")) {
    if (!entry) continue;
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    result[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return result;
}

function parseRealUid(status: string): number | null {
  const match = /^Uid:\s+(\d+)/m.exec(status);
  if (!match) return null;
  const uid = Number(match[1]);
  return Number.isSafeInteger(uid) && uid >= 0 ? uid : null;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and is not ours.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** An absolute path or nothing. A relative one is a configuration bug, not a default. */
function absoluteDirectory(raw: string | undefined): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  return value.startsWith("/") ? value.replace(/\/+$/, "") || "/" : null;
}

export class HookClient implements PacketClient {
  readonly pid: number;
  readonly controlSocketPath: string;
  private readonly helloPipeName: string;
  private readonly connectTimeoutMs: number;
  private readonly helloTimeoutMs: number;
  private readonly defaultReplyTimeoutMs: number;
  private readonly maxBodyBytes: number;
  private readonly onLoginState: ((state: HookLoginState) => void) | undefined;
  private readonly onOutboundHealthChanged: ((healthy: boolean) => void) | undefined;

  private socket: net.Socket | null = null;
  private hello: HookHello | null = null;
  private connectPromise: Promise<HookHello> | null = null;
  private helloDeferred: Deferred<HookHello> | null = null;

  /**
   * Bytes that arrived but do not yet form a whole frame.
   *
   * A read() carries whatever the kernel had: half a header, one frame, or three frames
   * plus half of a fourth. So decoding is always "drain the buffer", never "decode this
   * chunk".
   */
  private buffer: Buffer = Buffer.alloc(0);

  private readonly pending = new Map<number, PendingRequest>();

  /**
   * Tail of the direct-send queue.
   *
   * The payload holds one correlation slot, so two concurrent direct sends would have the second
   * reply attributed to the first. Chaining every call onto this promise makes "one at a time"
   * a property of the class rather than a rule callers have to remember.
   */
  private directSendQueue: Promise<void> = Promise.resolve();
  private nextRequestId = 1;

  /** Serialises writes so two concurrent requests cannot interleave their frames. */
  private writeChain: Promise<void> = Promise.resolve();

  private loginState: HookLoginState = { loggedIn: false, uin: null };
  private readonly loginWaiters = new Set<Deferred<HookLoginState>>();
  private outboundHealthy = true;
  private privateMessageReporting: HookPrivateMessageReporting | null = null;
  private runtimeFailure: { status: number; message: string } | null = null;
  private closed = false;
  /** Why the current socket was torn down, when we tore it down ourselves. */
  private socketFailure: string | null = null;

  constructor(options: HookClientOptions) {
    const { pid } = options;
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error(`HookClient requires a positive pid, got ${String(pid)}`);
    }
    this.pid = pid;
    const runtimeDir = options.runtimeDir ?? resolveHookRuntimeDir(pid);
    // Prefer the path the payload published over the one derived from the pid. They differ
    // whenever another live listener already owns the derived name (see readStartedSockets);
    // dialling the derived name in that case reaches a DIFFERENT payload that answers ACKs and
    // does nothing, which is the worst possible failure mode.
    const published = options.controlSocketPath === undefined ? readStartedSockets(runtimeDir, pid) : null;
    this.controlSocketPath =
      options.controlSocketPath ?? published?.control ?? hookSocketPath(runtimeDir, pid, "control");
    this.helloPipeName = options.helloPipeName ?? this.controlSocketPath;
    this.connectTimeoutMs = options.connectTimeoutMs ?? HOOK_CONNECT_TIMEOUT_MS;
    this.helloTimeoutMs = options.helloTimeoutMs ?? HOOK_HELLO_TIMEOUT_MS;
    this.defaultReplyTimeoutMs = options.replyTimeoutMs ?? packetTimeoutMs();
    this.maxBodyBytes = options.maxBodyBytes ?? HOOK_MAX_BODY_BYTES;
    this.onLoginState = options.onLoginState;
    this.onOutboundHealthChanged = options.onOutboundHealthChanged;
  }

  // -------------------------------------------------------------------------
  // Observers
  // -------------------------------------------------------------------------

  get isClosed(): boolean {
    return this.closed;
  }

  /** True only while a socket is connected AND its hello has been answered. */
  get connected(): boolean {
    return this.socket !== null && this.hello !== null;
  }

  get helloInfo(): HookHello | null {
    return this.hello;
  }

  get isLoggedIn(): boolean {
    return this.loginState.loggedIn;
  }

  get currentUin(): string | null {
    return this.loginState.uin;
  }

  get login(): HookLoginState {
    return { ...this.loginState };
  }

  get privateReporting(): HookPrivateMessageReporting | null {
    return this.privateMessageReporting;
  }

  /**
   * False once the payload has said -39, true again after any op 4.
   *
   * The bridge needs this to decide "re-attach" versus "retry the request": the reference
   * routes it to `Bridge`'s per-PID health (`setPidReceiveHealthy` is the receive half of
   * the same idea).
   */
  get isOutboundHealthy(): boolean {
    return this.outboundHealthy;
  }

  /** Number of requests still awaiting an op 4/op 5. Exposed so tests can assert cleanup. */
  get pendingCount(): number {
    return this.pending.size;
  }

  // -------------------------------------------------------------------------
  // Connect / hello
  // -------------------------------------------------------------------------

  /**
   * Connect, send hello, and wait for the payload's hello.
   *
   * Idempotent: concurrent callers share one attempt, and a connected client returns the
   * hello it already has. Every `sendPacket` goes through here, so a dropped connection
   * is re-established by the next send rather than needing an external supervisor.
   */
  async connect(): Promise<HookHello> {
    if (this.closed) throw new Error("hook client is closed");
    if (this.runtimeFailure) throw new Error(this.runtimeFailure.message);
    if (this.socket && this.hello) return this.hello;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.openControlSocket();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async openControlSocket(): Promise<HookHello> {
    const path = this.controlSocketPath;
    const socket = net.createConnection(path);
    const hello = createDeferred<HookHello>();
    this.helloDeferred = hello;
    this.socketFailure = null;

    const connected = createDeferred<void>();
    socket.once("error", (error) => connected.reject(error));
    socket.once("close", () => connected.reject(new Error("control socket closed before connecting")));
    socket.once("connect", () => {
      socket.off("close", connected.reject);
      socket.off("error", connected.reject);
      // Assign before writing: the payload's hello can arrive in the same read() batch as
      // something else, and the data handler checks `socket === this.socket`.
      this.socket = socket;
      this.buffer = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        if (socket !== this.socket) return;
        this.feed(chunk);
      });
      socket.on("error", (error: unknown) => {
        log.debug("control socket error: PID=%d %s", this.pid, errorMessage(error));
        if (socket === this.socket) this.socketFailure = errorMessage(error);
      });
      socket.on("close", () => this.handleSocketClose(socket));
      connected.resolve();
    });

    try {
      await withTimeout(
        connected.promise,
        this.connectTimeoutMs,
        `connect ${path}`,
      );
      await this.writeRaw(
        encodeFrame({
          op: Op.hello,
          msg: this.helloPipeName,
          value0: BigInt(this.pid),
        }),
      );
      const info = await withTimeout(hello.promise, this.helloTimeoutMs, `hello on ${path}`);
      this.hello = info;
      log.debug(
        "hook control channel up: PID=%d pipe=%s echoedPid=%d channelStatus=%d",
        this.pid,
        info.pipeName,
        info.pid,
        info.channelStatus,
      );
      return info;
    } catch (error) {
      this.socketFailure = errorMessage(error);
      socket.destroy();
      throw error;
    } finally {
      if (this.helloDeferred === hello) this.helloDeferred = null;
    }
  }

  // -------------------------------------------------------------------------
  // Send
  // -------------------------------------------------------------------------

  /**
   * Send one op 2 request and resolve with the payload's answer.
   *
   * The result never rejects. `invokeOidb` distinguishes `gotResponse: false` from a
   * server-side error, so a rejection would arrive at the bridge as an unhandled error
   * from a background task instead of a failed action with a message — the same reasoning
   * `Bridge.sendRawPacket` uses for its -1 sentinel.
   */
  async sendPacket(
    serviceCmd: string,
    body: Uint8Array,
    timeoutMs: number = this.defaultReplyTimeoutMs,
  ): Promise<PacketSendResult> {
    // A send is the one command the generic op-2 path cannot service: the payload's op-2 handler
    // has no success path for it (it ACKs with a fixed "not implemented" message), and
    // substituting into QQ's own send needs a send that a human already started. Route it here so
    // every caller -- Bridge.sendRawPacket, the OneBot actions, the tests -- gets a working send
    // without having to know which of the two mechanisms applies.
    if (serviceCmd === SEND_MSG_CMD) return this.sendViaDirectCall(body, timeoutMs);
    if (this.closed) return failure("hook client is closed");
    if (this.runtimeFailure) return failure(this.runtimeFailure.message, this.runtimeFailure.status);
    try {
      await this.connect();
    } catch (error) {
      return failure(`control channel unavailable: ${errorMessage(error)}`);
    }
    if (this.closed) return failure("hook client is closed");
    const socket = this.socket;
    if (!socket || !this.hello) return failure("control channel is not connected");

    const requestId = this.allocateRequestId();
    const reply = createDeferred<PacketSendResult>();
    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            // Delete before settling: the entry must be gone by the time the caller's
            // `await` resumes, or a late op 4 could resolve a promise nobody owns.
            this.settle(requestId, failure(`packet ${serviceCmd} timed out after ${timeoutMs} ms`));
          }, timeoutMs)
        : null;
    // NOT unref'd on purpose. An unref'd deadline is a promise the process is allowed to
    // break: if this request is the only thing keeping the event loop alive, an unref'd
    // timer lets Node exit instead of reporting the timeout, and the caller never learns
    // its request was abandoned. The timer is cleared in `settle`, so it never keeps a
    // completed request's process alive.

    this.pending.set(requestId, {
      serviceCmd,
      acked: false,
      timer,
      settle: reply.resolve,
    });

    try {
      // encodeFrame copies `body` into the frame buffer, so no alias of the caller's
      // array survives the call — nothing here needs its own copy.
      await this.writeRaw(
        encodeFrame({
          op: Op.request,
          requestId,
          flags: Flag.wantReply,
          cmd: serviceCmd,
          body: Buffer.from(body.buffer, body.byteOffset, body.byteLength),
        }),
      );
    } catch (error) {
      this.settle(requestId, failure(`could not write to the control channel: ${errorMessage(error)}`));
    }

    return reply.promise;
  }

  /**
   * Send `MessageSvc.PbSendMsg` through the payload's direct-send command.
   *
   * This is the only way to originate a message. Plain `sendPacket("MessageSvc.PbSendMsg", ...)`
   * cannot: the payload's generic op-2 handler has no success path for a send (it answers ACK plus
   * a fixed message -- `docs/op2-no-success-path.md`), and the body-substitution injector needs a
   * send that QQ was already making, which in a headless deployment never happens.
   *
   * `DSND` calls QQ's real send entry on our thread with our encoded request, so the message goes
   * out with no trigger at all. Verified end-to-end on live QQ 2026-11-24: the group received the
   * text this method was given, and the server's assigned sequence matched the reply.
   *
   * The reply arrives on the RECV socket as an ordinary op 6 packet, not as op 4 here, because it
   * comes back through QQ's own receive path. `settleFromRecv` is what resolves this promise; the
   * recv ingress calls it with the correlation id the payload stamps on the frame.
   *
   * One outstanding send at a time: the payload keeps a single correlation slot, so a second
   * concurrent call would have its reply attributed to the first. The queue keeps that honest
   * rather than leaving it to callers to remember.
   */
  async sendViaDirectCall(body: Uint8Array, timeoutMs: number = this.defaultReplyTimeoutMs): Promise<PacketSendResult> {
    if (this.closed) return failure("hook client is closed");
    if (this.runtimeFailure) return failure(this.runtimeFailure.message, this.runtimeFailure.status);
    try {
      await this.connect();
    } catch (error) {
      return failure(`control channel unavailable: ${errorMessage(error)}`);
    }
    if (this.closed) return failure("hook client is closed");
    const socket = this.socket;
    if (!socket || !this.hello) return failure("control channel is not connected");

    // Serialise: the payload correlates replies through a single slot.
    const previous = this.directSendQueue;
    let release!: () => void;
    this.directSendQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      return await this.sendViaDirectCallLocked(body, timeoutMs);
    } finally {
      release();
    }
  }

  private async sendViaDirectCallLocked(
    body: Uint8Array,
    timeoutMs: number,
  ): Promise<PacketSendResult> {
    const socket = this.socket;
    if (!socket) return failure("control channel is not connected");

    const requestId = this.allocateRequestId();
    const reply = createDeferred<PacketSendResult>();
    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            this.settle(
              requestId,
              failure(`direct send timed out after ${timeoutMs} ms (no op 6 on the recv channel)`),
            );
          }, timeoutMs)
        : null;

    this.pending.set(requestId, {
      serviceCmd: DIRECT_SEND_CMD,
      acked: false,
      timer,
      settle: reply.resolve,
    });

    try {
      await this.writeRaw(
        encodeFrame({
          op: Op.request,
          requestId,
          flags: Flag.wantReply,
          cmd: DIRECT_SEND_CMD,
          body: Buffer.from(body.buffer, body.byteOffset, body.byteLength),
        }),
      );
    } catch (error) {
      this.settle(requestId, failure(`could not write to the control channel: ${errorMessage(error)}`));
      return reply.promise;
    }

    // The op 3 ACK for DSND carries the payload's own status: non-zero means the call was refused
    // and no reply will ever arrive on the recv channel, so settle now rather than wait out the
    // timer. This is the only place the two channels' stories have to be reconciled.
    const ackStatus = await this.waitForAckStatus(requestId, Math.min(timeoutMs, 2000));
    if (ackStatus !== null && ackStatus !== 0) {
      this.settle(requestId, failure(directSendRefusal(ackStatus)));
    }

    return reply.promise;
  }

  /**
   * Wait for the op 3 ACK of one request and return its `value0`, or null if none arrived.
   *
   * Used only by the direct-send path, where a refusal is reported on the ACK instead of as a
   * reply. Returns null rather than throwing on timeout: the send may already have succeeded and
   * be waiting for its recv-side reply, and failing here would discard that.
   */
  private waitForAckStatus(requestId: number, timeoutMs: number): Promise<number | null> {
    const pending = this.pending.get(requestId);
    if (!pending) return Promise.resolve(null);
    return new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      pending.onAck = (status: number) => {
        clearTimeout(timer);
        pending.onAck = null;
        resolve(status);
      };
    });
  }

  /**
   * Next id for a request, skipping ids that are still in flight and 0.
   *
   * 0 is skipped because the payload uses `requestId == 0` for frames that are not
   * answers (hello, op 7, the fatal `runtime` error frame), so an op 4 with id 0 is never
   * a reply to us. In-flight ids are skipped for the obvious reason; with a 32-bit space
   * and this allocation rate that skip is nearly always a no-op.
   */
  private allocateRequestId(): number {
    let id = this.nextRequestId;
    while (id === 0 || this.pending.has(id)) {
      id = (id + 1) >>> 0;
      if (id === 0) id = 1;
    }
    this.nextRequestId = id + 1 > 0xffffffff ? 1 : id + 1;
    return id;
  }

  private settle(requestId: number, result: PacketSendResult): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    if (pending.timer) clearTimeout(pending.timer);
    pending.settle(result);
  }

  /**
   * Settle a request from a reply that arrived on a DIFFERENT socket.
   *
   * `MessageSvc.PbSendMsg` goes out over the payload's `DSND` command, which calls QQ's real send
   * entry directly. Its answer does not come back as op 4 on this channel: the response travels
   * QQ's own receive path, so it arrives as an ordinary op 6 packet on the recv socket (measured
   * 2026-11-24). The recv side therefore has to hand that body to the request it belongs to.
   *
   * Correlation is the `requestId` the payload stamps into the op 6 frame, copied from the DSND
   * request id, so exactly one pending entry is settled.
   *
   * Returns false when nothing is waiting -- the normal case for every packet that is not a reply
   * to us (pushes, heartbeats, other commands' traffic). It is not an error and must not throw:
   * this runs inside the recv data handler.
   */
  settleFromRecv(requestId: number, status: number, body: Uint8Array): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    // Status 0 with a body means the payload reported QQ's return code. The send path decodes the
    // body and decides whether the server accepted the message, so both halves are handed up
    // rather than pre-judged here.
    this.settle(requestId, {
      success: true,
      gotResponse: true,
      errorCode: status,
      errorMessage:
        status === 0 ? "" : `packet ${pending.serviceCmd} failed with status ${String(status)}`,
      responseData: Buffer.from(body),
    });
    return true;
  }

  /** Whether a request with this id is still waiting. For diagnostics and tests. */
  hasPending(requestId: number): boolean {
    return this.pending.has(requestId);
  }

  /**
   * Write one frame, one frame at a time.
   *
   * Chained rather than fire-and-forget so a slow write (large body, backpressure) delays
   * the next frame instead of letting two writes overlap on the same fd — and so a write
   * error is attributed to the request that caused it.
   */
  private writeRaw(payload: Buffer): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      return Promise.reject(new Error("control channel is not connected"));
    }
    const write = this.writeChain.then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (this.socket !== socket || socket.destroyed) {
            reject(new Error("control channel is not connected"));
            return;
          }
          socket.write(payload, (error?: Error | null) => {
            if (error) reject(error);
            else resolve();
          });
        }),
    );
    this.writeChain = write.catch(() => {});
    return write;
  }

  // -------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------

  private feed(chunk: Buffer): void {
    // Always concatenate, even when the buffer is empty: Node hands out `data` chunks that
    // are slices of its own pooled read buffer, and a partial frame retained across reads
    // would then point into memory the pool may hand to the next read. One copy per read on
    // a channel that carries small frames is cheaper than a frame corrupted once a month.
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  /** Decode every whole frame in the buffer; leave the partial tail for the next read. */
  private drain(): void {
    for (;;) {
      if (this.buffer.length < FRAME_HEADER_SIZE) return;

      // Bound the body BEFORE decodeFrame gets a chance to ask us to wait for it: the
      // codec validates cmdLen/msgLen but not bodyLen (its header says so), so "incomplete
      // frame, want 4 GiB" and "corrupt bodyLen" are indistinguishable from here.
      const claimedBody = this.buffer.readUInt32LE(28);
      if (claimedBody > this.maxBodyBytes) {
        this.failSocket(`frame claims ${claimedBody} body bytes, limit is ${this.maxBodyBytes}`);
        return;
      }

      const result = decodeFrame(this.buffer, 0);
      if (!result.ok) {
        if (needsMoreBytes(result.reason)) return;
        // No resync is possible: the framing has no delimiter, so the only way to find the
        // start of the next frame is a length from a header we already know is wrong.
        // Skipping bytes would parse payload as headers and deliver bogus ops.
        this.failSocket(result.reason);
        return;
      }

      this.buffer = this.buffer.subarray(result.bytesConsumed);
      try {
        this.handleFrame(result.frame);
      } catch (error) {
        // A handler bug must not take the process down; it also must not keep the
        // connection, because the frame it failed on is consumed either way.
        log.error("hook frame handler threw: PID=%d %s", this.pid, errorMessage(error));
        this.failSocket(`frame handler failed: ${errorMessage(error)}`);
        return;
      }
    }
  }

  private handleFrame(frame: Frame): void {
    const { op, requestId, status } = frame.header;
    switch (op) {
      case Op.hello: {
        // hello is sent by the payload on accept; its `msg` is the absolute path it
        // considers this channel to be, which is NOT the short name we send.
        const deferred = this.helloDeferred;
        this.helloDeferred = null;
        deferred?.resolve({
          pipeName: frame.msg,
          pid: Number(frame.header.value0),
          channelStatus: status,
        });
        return;
      }
      case Op.loginState:
        this.applyLoginState(frame);
        return;
      case Op.ack: {
        const pending = this.pending.get(requestId);
        if (!pending) {
          // A late ack for a request that already timed out. Nothing to do: the id is free
          // again, and whoever owns it now has its own pending entry.
          log.trace("ignored ack for unknown requestId=%d (PID=%d)", requestId, this.pid);
          return;
        }
        pending.acked = true;
        // The direct-send path waits for this: DSND reports a refusal on its ACK instead of by
        // dropping the reply, so the status has to be visible rather than just "an ACK happened".
        if (pending.onAck) {
          const onAck = pending.onAck;
          pending.onAck = null;
          onAck(Number(frame.header.value0));
        }
        log.trace(
          "packet ack: serviceCmd=%s requestId=%d value0=%s (PID=%d)",
          pending.serviceCmd,
          requestId,
          frame.header.value0.toString(),
          this.pid,
        );
        return;
      }
      case Op.reply: {
        const pending = this.pending.get(requestId);
        if (!pending) {
          log.trace("ignored reply for unknown requestId=%d (PID=%d)", requestId, this.pid);
          return;
        }
        // Any op 4 proves the outbound pipe just carried a request and a reply. The
        // reference resets health on the same condition (a send that did not throw),
        // including when the reply carries a non-zero status.
        this.setOutboundHealthy(true);
        // `decodeRefusal` is used for the failure text only, so that a reply whose body
        // says "server rejected this" still reaches the caller with the payload's own
        // wording; on success `msg` is empty in every measured reply, and the `?? ""`
        // below keeps the field present instead of dropping it (`exactOptionalPropertyTypes`
        // would forbid assigning `undefined` here, and the shape is easier to read flat).
        this.settle(requestId, {
          success: status === 0,
          gotResponse: true,
          errorCode: status,
          errorMessage: status === 0 ? frame.msg : decodeRefusal(frame).message,
          // Copy: `frame.body` aliases the read buffer, which also holds every other frame
          // that arrived in the same read().
          responseData: Buffer.from(frame.body),
        });
        return;
      }
      case Op.error: {
        // requestId 0 + cmd "runtime" is the payload's last word: it cannot keep working.
        // The reference latches this and refuses every later request
        // (reference/index.mjs:2586-2596; docs/payload-protocol.md §2).
        if (requestId === 0 && frame.cmd === "runtime") {
          const refusal = decodeRefusal(frame);
          this.runtimeFailure = { status, message: `hook runtime failure: ${refusal.message}` };
          log.error("hook runtime failure: PID=%d status=%d %s", this.pid, status, refusal.message);
          this.rejectAll(this.runtimeFailure.message);
          this.setOutboundHealthy(false);
          return;
        }
        if (status === HOOK_STATUS_OUTBOUND_UNHEALTHY) {
          // -39 is "the connection this session was using is gone", not "this request was
          // refused". See the file header for the disassembly + reference evidence.
          log.warn("hook outbound pipe unhealthy: PID=%d status=%d %s", this.pid, status, frame.msg);
          this.setOutboundHealthy(false);
        } else if (status === HOOK_STATUS_UNIMPLEMENTED) {
          log.warn("hook has no send path for this request: PID=%d %s", this.pid, frame.msg);
        }
        const pending = this.pending.get(requestId);
        if (!pending) {
          log.trace("ignored error frame for unknown requestId=%d (PID=%d)", requestId, this.pid);
          return;
        }
        // gotResponse stays false: no reply body exists. `invokeOidb` turns that into an
        // error naming the command plus our message, which is exactly the payload's text.
        this.settle(requestId, {
          success: false,
          gotResponse: false,
          errorCode: status,
          errorMessage: decodeRefusal(frame).message,
        });
        return;
      }
      case 22: {
        // op 22 reports whether QQ itself can report private messages. It arrives on the
        // recv channel in the reference's handler, but the payload also emits it from the
        // accept path (`0x13c08`, docs/reverse-socket-protocol.md §2.4), so a control
        // connection can see it and a client that treated it as a protocol violation
        // would drop a healthy connection over a pure capability announcement.
        this.privateMessageReporting = { available: status === 1, reason: frame.header.value0 };
        log.debug(
          "client private-message reporting: PID=%d %s status=%d reason=%s",
          this.pid,
          status === 1 ? "available" : "unavailable",
          status,
          frame.header.value0.toString(),
        );
        return;
      }
      default:
        // Unknown ops are ignored rather than fatal: the payload is versioned separately
        // from this client, and a new announcement must not kill the channel.
        log.trace("unhandled hook op=%d requestId=%d (PID=%d)", op, requestId, this.pid);
    }
  }

  private applyLoginState(frame: Frame): void {
    const next = decodeLoginState(frame);
    const previous = this.loginState;
    this.loginState = next;
    if (previous.loggedIn === next.loggedIn && previous.uin === next.uin) return;
    log.debug(
      "hook login state: PID=%d loggedIn=%s uin=%j (was loggedIn=%s uin=%j)",
      this.pid,
      String(next.loggedIn),
      next.uin,
      String(previous.loggedIn),
      previous.uin,
    );
    this.onLoginState?.({ ...next });
    if (next.loggedIn) {
      for (const waiter of this.loginWaiters) waiter.resolve({ ...next });
      this.loginWaiters.clear();
    }
  }

  /**
   * Wait until op 7 says logged in.
   *
   * `timeoutMs` 0 (the default) waits indefinitely, matching the reference's
   * `waitForLogin`; callers that can hang need to pass a budget.
   */
  async waitForLogin(options: { timeoutMs?: number } = {}): Promise<HookLoginState> {
    await this.connect();
    if (this.loginState.loggedIn) return { ...this.loginState };
    const deferred = createDeferred<HookLoginState>();
    this.loginWaiters.add(deferred);
    try {
      return await withTimeout(
        deferred.promise,
        options.timeoutMs ?? 0,
        `login on PID ${String(this.pid)}`,
      );
    } finally {
      this.loginWaiters.delete(deferred);
    }
  }

  private setOutboundHealthy(healthy: boolean): void {
    if (this.outboundHealthy === healthy) return;
    this.outboundHealthy = healthy;
    log.warn("outbound pipe health changed: PID=%d healthy=%s", this.pid, String(healthy));
    this.onOutboundHealthChanged?.(healthy);
  }

  private failSocket(reason: string): void {
    log.error("hook control channel failed: PID=%d %s", this.pid, reason);
    this.teardown(`control channel failed: ${reason}`);
  }

  /**
   * Drop every belief that belonged to the socket that just went away.
   *
   * The login state is included on purpose. The payload re-announces login (op 7) as soon
   * as a new connection is accepted — MEMORY.md §2.3h records the fix that made it read
   * the account off disk at connect time precisely so a reconnect does not wait for an
   * event. Keeping the old value across a reconnect would claim a signed-in session the
   * payload has never confirmed on this channel, which is the one error the rest of the
   * stack cannot detect.
   *
   * Both entry points go through here — the `close` event and a protocol-level failure
   * that destroys the socket itself — because in the second case `close` still fires but
   * by then `this.socket` is already null and the guard would skip the cleanup entirely.
   */
  private teardown(reason: string): void {
    const socket = this.socket;
    this.socket = null;
    this.hello = null;
    this.buffer = Buffer.alloc(0);
    this.writeChain = Promise.resolve();
    this.socketFailure = null;
    socket?.destroy();

    if (this.loginState.loggedIn) {
      this.loginState = { loggedIn: false, uin: null };
      log.debug("hook login state dropped with the connection: PID=%d", this.pid);
      this.onLoginState?.({ ...this.loginState });
    }
    this.rejectAll(reason);
  }

  private handleSocketClose(socket: net.Socket): void {
    // A socket from a previous connection: its close is not news about the current one.
    if (socket !== this.socket) return;
    this.teardown(this.socketFailure ?? "control channel closed");
  }

  /** Resolve the hello wait and every pending request with a failure naming `reason`. */
  private rejectAll(reason: string): void {
    this.helloDeferred?.reject(new Error(reason));
    this.helloDeferred = null;
    for (const requestId of [...this.pending.keys()]) {
      this.settle(requestId, failure(reason));
    }
  }

  // -------------------------------------------------------------------------
  // Shutdown
  // -------------------------------------------------------------------------

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Settle first, then destroy: `teardown` would reset the login state, and a closed
    // client has no business announcing "we logged out" to a host that is shutting down.
    this.rejectAll("hook client closed");
    for (const waiter of this.loginWaiters) {
      waiter.reject(new Error("hook client closed"));
    }
    this.loginWaiters.clear();
    const socket = this.socket;
    this.socket = null;
    this.hello = null;
    this.buffer = Buffer.alloc(0);
    socket?.destroy();
  }
}

/**
 * Whether a `decodeFrame` rejection just means "not yet whole".
 *
 * This matches on the codec's reason strings, which is exactly the kind of coupling that
 * breaks quietly. The alternative — having `decodeFrame` distinguish "need more bytes"
 * from "invalid" structurally — would change protocol.ts, which is measured and frozen, so
 * the matching lives here. Both branches are pinned indirectly: if either string were
 * reworded, the partial-header and partial-payload tests would tear the connection down
 * and fail instead of quietly passing, so the reword cannot turn a partial read into a
 * dropped connection without a red test.
 */
function needsMoreBytes(reason: string): boolean {
  return reason === "short header" || reason.startsWith("incomplete frame");
}