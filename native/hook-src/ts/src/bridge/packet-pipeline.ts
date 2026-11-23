/** The normalized shape emitted for recv op 6 packets. */
export interface IncomingPacket {
  seq: number;
  error: number;
  cmd: string;
  uin: string;
  body: Uint8Array;
}

export type PacketEvent = unknown;
export type PacketHandler = (packet: IncomingPacket) => readonly PacketEvent[];

export interface IncomingPacketPipelineOptions {
  publish: (events: readonly PacketEvent[], packet: IncomingPacket) => void | Promise<void>;
  onError?: (error: unknown, packet: IncomingPacket, phase: "handler" | "publish") => void;
}

/** Pure command router; transport, decoding, and event delivery are injected. */
export class IncomingPacketPipeline {
  private readonly handlers = new Map<string, PacketHandler[]>();
  private dispatchTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: IncomingPacketPipelineOptions) {}

  registerCmd(cmd: string, handler: PacketHandler): void {
    const handlers = this.handlers.get(cmd) ?? [];
    handlers.push(handler);
    this.handlers.set(cmd, handlers);
  }

  unregisterCmd(cmd: string, handler?: PacketHandler): void {
    if (handler === undefined) {
      this.handlers.delete(cmd);
      return;
    }
    const handlers = this.handlers.get(cmd);
    if (!handlers) return;
    const index = handlers.indexOf(handler);
    if (index < 0) return;
    handlers.splice(index, 1);
    if (handlers.length === 0) this.handlers.delete(cmd);
  }

  handlesCmd(cmd: string): boolean {
    return this.handlers.has(cmd);
  }

  /** Queue dispatches so asynchronous publication cannot reorder packets. */
  process(packet: IncomingPacket): Promise<void> {
    const safePacket = { ...packet, body: packet.body.slice() };
    const dispatch = this.dispatchTail.then(() => this.dispatch(safePacket));
    this.dispatchTail = dispatch.catch(() => undefined);
    return dispatch;
  }

  private async dispatch(packet: IncomingPacket): Promise<void> {
    const handlers = this.handlers.get(packet.cmd);
    if (!handlers) return;

    for (const handler of [...handlers]) {
      let events: readonly PacketEvent[];
      try {
        events = handler(packet);
      } catch (error) {
        this.reportError(error, packet, "handler");
        continue;
      }
      if (events.length === 0) continue;
      try {
        await this.options.publish(events, packet);
      } catch (error) {
        this.reportError(error, packet, "publish");
      }
    }
  }

  private reportError(error: unknown, packet: IncomingPacket, phase: "handler" | "publish"): void {
    try {
      this.options.onError?.(error, packet, phase);
    } catch {
      // An error observer must not prevent later handlers or packets from running.
    }
  }
}
