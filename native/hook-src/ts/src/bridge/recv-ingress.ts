// recv-ingress — the isolated wire between `RecvClient`'s "packet" events and
// `Bridge.onPacket`.
//
// ---------------------------------------------------------------------------
// SCOPE: this proves PLUMBING, not a source
// ---------------------------------------------------------------------------
// Attaching this module does NOT give production QQ receive. There is still no
// verified production QQ receive source in this tree:
//
//   * the C++ side's `emit_packet` has exactly ONE caller today, and that caller is
//     a test wrapper — no production QQ receive callback is known to hand op 6
//     packets to the payload's recv socket (`PROGRESS.md`, "op6接收";
//     `MEMORY.md`'s "明确未完成" note);
//   * the QQ-build-specific callback/vtable ABI, its argument types and the body
//     ownership/lifetime rules are unproven, and guessing them is explicitly out of
//     bounds.
//
// So with this file attached and nothing else, the recv socket is silent. What the
// file does buy is that the moment a real source exists, the last mile — normalize,
// guard, order, feed — is already written and tested here rather than invented at
// the callsite.
//
// ---------------------------------------------------------------------------
// What it owns, and what it deliberately does not
// ---------------------------------------------------------------------------
// OWNS: one subscription on the client, the wire→`IncomingPacket` normalization,
// the bigint→number safety check, a single promise tail that preserves arrival
// order, per-packet error isolation, and one detach function.
//
// DOES NOT OWN: decoding. No handler map, no protobuf, no `MsgPush` import. The
// optional `setupDecoders` hook receives a bound `registerCmd` so the caller can
// register `MsgPush` (or anything else) without this module taking a dependency on
// it. It is invoked ONCE, before the subscription is installed, so no packet can
// arrive for a command whose parser is not registered yet.
//
// ---------------------------------------------------------------------------
// The three policies that are easy to get wrong
// ---------------------------------------------------------------------------
// 1. SEQUENCE IS A BIGINT ON THE WIRE. `Number(packet.sequence)` silently truncates
//    above 2^53, which would make two different packets carry the same `seq` and
//    quietly break every dedupe/diagnostic downstream. Unsafe values are DROPPED and
//    reported, never coerced.
// 2. ORDER IS THE CONTRACT. `onPacket` is async (it awaits identity
//    initialization), so calling it straight from the event handler lets packet 2
//    land before packet 1. Every call is appended to one promise tail, and the tail
//    is kept settled by catching each link — a rejected link that stayed rejected
//    would swallow every packet after it.
// 3. A LISTENER MUST NOT THROW. This handler runs inside `RecvClient`'s frame loop;
//    an exception here would propagate out of `emit` and corrupt the transport's
//    read loop. Normalization is wrapped, `onPacket` rejections are caught per
//    packet, and a throwing `onError` observer is swallowed.

import type { IncomingPacket, PacketHandler } from "./packet-pipeline.js";

/** The largest sequence `Number` represents exactly. Public for diagnostics/tests. */
export const RECV_INGRESS_MAX_SAFE_SEQUENCE = Number.MAX_SAFE_INTEGER;

const MAX_SAFE_SEQUENCE_BIGINT = BigInt(RECV_INGRESS_MAX_SAFE_SEQUENCE);

/**
 * The slice of `RecvPacket` this module reads.
 *
 * Structural on purpose: the real `RecvClient` emits a `RecvPacket` (whose `body`
 * is a `Buffer`, assignable to `Uint8Array`), and a test double can satisfy this
 * without pretending to be a socket client. `ts/test/recv-ingress.test.ts` pins the
 * real class against this interface at compile time.
 */
export interface RecvPacketLike {
  /** Signed status from the frame header; non-zero means QQ reported a failure. */
  status: number;
  /** Service command. */
  cmd: string;
  /** Decimal account identifier. */
  uin: string;
  /** Wire `value0`, a u64; may exceed `Number.MAX_SAFE_INTEGER`. */
  sequence: bigint | number;
  /** Frame body; copied immediately, so the caller may reuse its buffer. */
  body: Uint8Array;
}

export type RecvPacketListener = (packet: RecvPacketLike) => void;

/** The slice of `node:events`' `EventEmitter` used here (satisfied by `RecvClient`). */
export interface PacketEventSource {
  on(event: "packet", listener: RecvPacketListener): unknown;
  /** Preferred remover; `EventEmitter` provides it. */
  off?(event: "packet", listener: RecvPacketListener): unknown;
  /** Fallback remover for emitters that only expose the older alias. */
  removeListener?(event: "packet", listener: RecvPacketListener): unknown;
}

/** The slice of `Bridge` this module feeds (satisfied by the real `Bridge`). */
export interface RecvIngressBridge {
  /** Accept one normalized inbound packet. May return a promise. */
  onPacket(packet: IncomingPacket): void | Promise<void>;
  /**
   * Only read when `options.setupDecoders` is supplied: the hook exists so the
   * caller can hand decoding to the bridge without an import cycle.
   */
  registerCmd?(cmd: string, handler: PacketHandler): void;
}

/** Where an ingress failure happened. */
export type RecvIngressErrorPhase =
  /** The wire sequence was outside `Number`'s exact range (or not an integer at all). */
  | "sequence"
  /** Building the normalized packet threw (e.g. a body that is not array-like). */
  | "normalize"
  /** `bridge.onPacket` threw or rejected. */
  | "onPacket"
  /** `setupDecoders` threw, or could not be given a `registerCmd`. */
  | "decoders";

export interface RecvIngressErrorContext {
  phase: RecvIngressErrorPhase;
  /** The packet being processed; `null` before a packet exists (`sequence`/`normalize`/`decoders`). */
  packet: IncomingPacket | null;
  /** The wire sequence as received, even when unsafe; `null` when unreadable. */
  sequence: bigint | number | null;
}

/** Receives `registerCmd`-equivalent calls for the commands this ingress must parse. */
export type DecoderRegistrar = (cmd: string, handler: PacketHandler) => void;

export interface RecvIngressOptions {
  /**
   * Observer for dropped/failed packets. Throwing from it is swallowed: an error
   * sink must never be able to stop ingress. Default is to drop silently, because
   * this module is a library and must not decide where diagnostics go.
   */
  onError?: (error: unknown, context: RecvIngressErrorContext) => void;
  /**
   * Invoked exactly once at attach, before the `"packet"` subscription exists.
   *
   * The argument is a bound `bridge.registerCmd`, so the parent can plug in
   * `MsgPush` decoding (or any other parser) without this file importing it.
   * A throw here aborts the attach — a bridge with half its parsers registered is
   * worse than one that was never wired.
   */
  setupDecoders?: (register: DecoderRegistrar) => void;
}

/**
 * Detaches the ingress.
 *
 *  1. Unsubscribes SYNCHRONOUSLY — no `"packet"` listener remains once it returns,
 *     so no NEW packet is accepted after that point.
 *  2. DRAINS what was already accepted: packets that passed normalization and are
 *     sitting in the ordering tail are still delivered, in order, before the
 *     promise resolves. They were accepted while the ingress was live, so dropping
 *     them would lose real messages that `RecvClient` had already handed over — and
 *     would make the returned promise meaningless.
 *  3. Callers that want an immediate cut (a dead socket, a hard shutdown) simply do
 *     not await; the queue then drains without anyone watching, which is harmless
 *     because the bridge itself is idle.
 *
 * Idempotent: repeat calls return the same promise and never re-forward.
 */
export type RecvIngressDetach = () => Promise<void>;

/**
 * Subscribe `client`'s `"packet"` events to `bridge.onPacket` and return a detach
 * function. See this file's header for the scope and ordering/error policies.
 */
export function attachRecvIngress(
  bridge: RecvIngressBridge,
  client: PacketEventSource,
  options: RecvIngressOptions = {},
): RecvIngressDetach {
  const report = createReporter(options.onError);
  const unsubscribe = pickUnsubscriber(client);
  if (!unsubscribe) {
    const error = new Error(
      "attachRecvIngress needs the client to expose off() or removeListener(); " +
        "subscribing without a way to detach would leak the listener forever",
    );
    report(error, { phase: "decoders", packet: null, sequence: null });
    throw error;
  }

  const setupDecoders = options.setupDecoders;
  if (setupDecoders !== undefined) {
    const registerCmd = bridge.registerCmd;
    if (typeof registerCmd !== "function") {
      const error = new Error(
        "attachRecvIngress: options.setupDecoders requires bridge.registerCmd(cmd, handler)",
      );
      report(error, { phase: "decoders", packet: null, sequence: null });
      throw error;
    }
    const register: DecoderRegistrar = (cmd, handler) => {
      registerCmd.call(bridge, cmd, handler);
    };
    try {
      setupDecoders(register);
    } catch (error) {
      report(error, { phase: "decoders", packet: null, sequence: null });
      throw error;
    }
  }

  /** Stops accepting NEW packets; already-accepted ones still drain. */
  let accepting = true;
  /** The single ordering point: every `onPacket` call is appended here. */
  let tail: Promise<void> = Promise.resolve();
  let settled: Promise<void> | null = null;

  const enqueue = (packet: IncomingPacket): void => {
    // No `accepting` check inside the queued callback: a packet that made it this far
    // was accepted by a live ingress and must still be delivered, in order, by the
    // drain. The check lives in the listener, which is where acceptance happens.
    const run = tail.then(async (): Promise<void> => {
      try {
        await bridge.onPacket(packet);
      } catch (error) {
        report(error, { phase: "onPacket", packet, sequence: packet.seq });
      }
    });
    // Catching here — not just inside the callback — keeps `tail` fulfilled, so one
    // failure cannot skip every packet queued behind it.
    tail = run.catch(() => undefined);
  };

  const listener: RecvPacketListener = (wire) => {
    // Guards a listener that `EventEmitter` had already snapshotted into an `emit`
    // in progress when detach ran from inside another listener of the same emit.
    if (!accepting) return;
    try {
      const seq = sequenceToNumber(wire?.sequence);
      if (seq === null) {
        report(
          new Error(
            `recv ingress dropped a packet: sequence ${describeSequence(wire?.sequence)} ` +
              `is not a safe non-negative integer (max ${RECV_INGRESS_MAX_SAFE_SEQUENCE})`,
          ),
          { phase: "sequence", packet: null, sequence: asWireSequence(wire?.sequence) },
        );
        return;
      }
      // Snapshot now: the transport may reuse or mutate its read buffer, and a
      // packet queued behind others must not observe those later bytes.
      enqueue({
        seq,
        error: wire.status,
        cmd: wire.cmd,
        uin: wire.uin,
        body: new Uint8Array(wire.body),
      });
    } catch (error) {
      // Never let a handler exception escape into `RecvClient`'s frame loop.
      report(error, { phase: "normalize", packet: null, sequence: asWireSequence(wire?.sequence) });
    }
  };

  client.on("packet", listener);

  return (): Promise<void> => {
    if (accepting) {
      accepting = false;
      unsubscribe("packet", listener);
      settled = tail;
    }
    return settled ?? tail;
  };
}

/**
 * `Number`-exact view of a wire sequence, or `null` when it cannot be represented
 * exactly. Null is the caller's signal to drop the packet and report, never to
 * fall back to a truncated value.
 */
function sequenceToNumber(value: bigint | number | undefined): number | null {
  if (typeof value === "bigint") {
    if (value < 0n || value > MAX_SAFE_SEQUENCE_BIGINT) return null;
    return Number(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  return null;
}

function asWireSequence(value: bigint | number | undefined): bigint | number | null {
  return typeof value === "bigint" || typeof value === "number" ? value : null;
}

function describeSequence(value: bigint | number | undefined): string {
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (value === undefined) return "undefined";
  return `${String(value)} (${typeof value})`;
}

function pickUnsubscriber(
  client: PacketEventSource,
): ((event: "packet", listener: RecvPacketListener) => void) | null {
  if (typeof client.off === "function") {
    return (event, listener) => {
      client.off?.(event, listener);
    };
  }
  if (typeof client.removeListener === "function") {
    return (event, listener) => {
      client.removeListener?.(event, listener);
    };
  }
  return null;
}

function createReporter(
  onError: RecvIngressOptions["onError"],
): (error: unknown, context: RecvIngressErrorContext) => void {
  return (error, context) => {
    if (onError === undefined) return;
    try {
      onError(error, context);
    } catch {
      // An error observer must not be able to stop ingress.
    }
  };
}