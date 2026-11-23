// Isolated receive-side Unix socket transport for the hook protocol.
// This is a generic event source only: it does not create a production QQ source
// or connect to Bridge/the packet pipeline.

import { EventEmitter } from "node:events";
import net from "node:net";
import { FRAME_HEADER_SIZE, RecvOp, decodeFrame, encodeFrame } from "./protocol.js";
import type { Frame } from "./protocol.js";
import { readStartedSockets } from "./hook-client.js";

export const RECV_MAX_BODY_BYTES = 16 * 1024 * 1024;

export function recvSocketPath(runtimeDir: string, pid: number): string {
  const base = runtimeDir.endsWith("/") ? runtimeDir.slice(0, -1) : runtimeDir;
  return `${base}/mojo.${pid}.recv.sock`;
}

export interface RecvPacket {
  status: number;
  /**
   * The op 6 frame's `requestId`, which the payload copies from a `DSND` send it is answering.
   *
   * Zero means "not a reply to anything we sent", which is the case for pushes, other commands'
   * traffic and every frame produced by the reference payload. A non-zero value is a correlation
   * stamp: the payload sets it only for a reply to a send we originated, so the send path can
   * match the body to the request that is waiting for it.
   *
   * The reply travels here rather than as op 4 on the control socket because QQ's own receive
   * path delivers it; there is no op 4 to wait for.
   */
  requestId: number;
  /** Service command from cmd. */
  cmd: string;
  /** Decimal account identifier from msg. */
  uin: string;
  sequence: bigint;
  /** Owned copy, independent of the socket read buffer. */
  body: Buffer;
}

export interface RecvClientEvents {
  packet: [packet: RecvPacket];
  receipt: [frame: Frame];
  loginState: [frame: Frame];
  hello: [frame: Frame];
  frame: [frame: Frame];
  error: [error: Error];
  close: [];
}

/** Receives op 6 and emits op 21 receipts independently on the recv channel. */
export class RecvClient extends EventEmitter<RecvClientEvents> {
  readonly pid: number;
  readonly recvSocketPath: string;
  private readonly maxBodyBytes: number;
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private connecting: Promise<void> | null = null;
  private closed = false;

  constructor(options: { pid: number; runtimeDir?: string; recvSocketPath?: string; maxBodyBytes?: number }) {
    super();
    if (!Number.isSafeInteger(options.pid) || options.pid <= 0) {
      throw new Error(`RecvClient requires a positive pid, got ${String(options.pid)}`);
    }
    this.pid = options.pid;
    const runtimeDir = options.runtimeDir ?? "/tmp";
    // Same reasoning as HookClient.controlSocketPath: a payload that could not bind the derived
    // recv name publishes the one it did bind, and only that one carries our op 6 frames.
    const published = options.recvSocketPath === undefined ? readStartedSockets(runtimeDir, options.pid) : null;
    this.recvSocketPath =
      options.recvSocketPath ?? published?.recv ?? recvSocketPath(runtimeDir, options.pid);
    this.maxBodyBytes = options.maxBodyBytes ?? RECV_MAX_BODY_BYTES;
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  async connect(): Promise<void> {
    if (this.closed) throw new Error("recv client is closed");
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    const socket = net.createConnection(this.recvSocketPath);
    this.connecting = new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        socket.off("connect", onConnect);
        if (!this.socket) reject(error);
        else this.emit("error", error);
      };
      const onConnect = (): void => {
        socket.off("error", onError);
        if (this.closed) {
          socket.destroy();
          reject(new Error("recv client is closed"));
          return;
        }
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        socket.on("data", (chunk: Buffer) => this.feed(chunk));
        socket.on("error", (error) => this.emit("error", error));
        socket.on("close", () => {
          if (this.socket !== socket) return;
          this.socket = null;
          this.buffer = Buffer.alloc(0);
          this.emit("close");
        });
        socket.write(encodeFrame({
          op: RecvOp.hello,
          status: 2,
          msg: this.recvSocketPath,
          value0: BigInt(this.pid),
        }));
        resolve();
      };
      socket.once("error", onError);
      socket.once("connect", onConnect);
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const socket = this.socket;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    socket?.destroy();
  }

  private feed(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < FRAME_HEADER_SIZE) return;
      const bodyLength = this.buffer.readUInt32LE(28);
      if (bodyLength > this.maxBodyBytes) {
        this.fail(new Error(`frame claims ${bodyLength} body bytes, limit is ${this.maxBodyBytes}`));
        return;
      }
      const result = decodeFrame(this.buffer);
      if (!result.ok) {
        if (result.reason === "short header" || result.reason.startsWith("incomplete frame")) return;
        this.fail(new Error(result.reason));
        return;
      }
      this.buffer = this.buffer.subarray(result.bytesConsumed);
      this.handleFrame(result.frame);
      if (!this.socket) return;
    }
  }

  private handleFrame(frame: Frame): void {
    const { op, requestId, flags, status, value0 } = frame.header;
    if (op === RecvOp.packet) {
      // `requestId` is NOT required to be zero: it carries the correlation id tying a reply to
      // the injected send that asked for it. Rejecting a non-zero value made every correlated
      // reply look like a malformed frame, so the client tore the channel down and the caller
      // timed out even though the payload had written the packet successfully.
      //
      // `flags` is still reserved and must be zero -- nothing sets it, so a non-zero value means
      // the two sides disagree about the frame layout.
      if (flags !== 0) {
        this.fail(new Error(`invalid op 6 header: flags=${flags}`));
        return;
      }
      this.emit("packet", {
        status,
        requestId,
        cmd: frame.cmd,
        uin: frame.msg,
        sequence: value0,
        body: Buffer.from(frame.body),
      });
      return;
    }
    if (op === RecvOp.clientMessageReceipt) {
      this.emit("receipt", frame);
      return;
    }
    if (op === RecvOp.loginState) {
      this.emit("loginState", frame);
      return;
    }
    if (op === RecvOp.hello) {
      this.emit("hello", frame);
      return;
    }
    this.emit("frame", frame);
  }

  private fail(error: Error): void {
    this.emit("error", error);
    const socket = this.socket;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    socket?.destroy();
    this.emit("close");
  }
}
