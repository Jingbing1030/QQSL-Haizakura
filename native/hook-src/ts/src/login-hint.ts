// The login identity hint (op 17) and the keepalive window it controls.
//
// ---------------------------------------------------------------------------
// Why this is a policy module and not two comparisons in the transport
// ---------------------------------------------------------------------------
// The reference payload treats op 17 as the *inbound* signal that a client has told it who
// it is, and it does two things with it that are easy to get subtly wrong:
//
//   * it rejects any hint whose value0 does not have a specific shape, replying op 5 with
//     -EINVAL rather than silently dropping it; and
//   * accepting one resets a deadline 60 seconds out, and that deadline is what a background
//     path later reads to decide the client has gone quiet.
//
// Neither is address-space work, and both are the kind of rule that changes when the client
// changes -- so they live here, in the policy layer, where a change does not require
// rebuilding and reinjecting a shared object.
//
// ---------------------------------------------------------------------------
// The value0 encoding
// ---------------------------------------------------------------------------
// The reference accepts value0 only in [0x1_0000_0000, 0x1_0000_270F]. Read as two 32-bit
// halves that is "high word == 1, low word < 10000": a category/version of 1 paired with a
// counter that wraps well below 2^16. It is not an account number. A uin -- around 10^9 for a
// real account -- has a high word of 0 and would be rejected, which is why this module does
// not accept a bare uin: an implementation that sent one would appear to work (the frame
// arrives) while every hint was refused, and the keepalive window it was supposed to start
// would never open.
//
// The upper bound is expressed here as its parts rather than the packed constant so the
// shape is visible at the point of comparison.
const kHintCategory = 1n;
const kHintCounterLimit = 10000n;

/** How long an accepted hint keeps the client considered live. The reference uses 60s. */
export const LOGIN_HINT_WINDOW_MS = 60_000;

/**
 * The two halves the reference packs into value0, kept together so a caller cannot pass one
 * where the other is expected.
 */
export interface LoginHint {
  /** Category/version. The reference only ever sees 1. */
  category: number;
  /** Wrapping counter. Must be below 10000. */
  counter: number;
}

/** Packs a hint into the wire value0. */
export function encodeLoginHint(hint: LoginHint): bigint {
  return (BigInt(hint.category) << 32n) | BigInt(hint.counter >>> 0);
}

/**
 * Unpacks and validates value0.
 *
 * Returns null for anything outside the accepted shape, matching the reference's rejection of
 * value0 - 0x1_0000_0000 >= 0x2710. Deliberately unsigned: the reference compares the
 * difference as unsigned, so a value below the base wraps to a huge number and is rejected
 * rather than wrapping around into the accepted window.
 */
export function decodeLoginHint(value0: bigint): LoginHint | null {
  const base = kHintCategory << 32n;
  if (value0 < base) return null;
  const counter = value0 - base;
  if (counter >= kHintCounterLimit) return null;
  return { category: Number(kHintCategory), counter: Number(counter) };
}

/**
 * Tracks when the client was last known to be alive.
 *
 * A deadline rather than a boolean: the caller needs to ask "is this still valid now", and a
 * flag plus a separate timestamp invites the two to drift apart. Reading a deadline that has
 * passed is the same question as "has the client gone quiet", so there is one piece of state
 * instead of two.
 *
 * Not internally synchronised. The reference guards this with a mutex, but there the reader
 * and writer are both OS threads inside one process; here the writer is the frame handler and
 * the reader is a timer, both on the Node event loop, so an interleaving that observed a torn
 * value cannot arise. Adding a lock would suggest a concurrency the design does not have.
 */
export class KeepaliveWindow {
  private deadlineMs = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly windowMs: number = LOGIN_HINT_WINDOW_MS,
  ) {}

  /** Extends the window from now. Called when a hint is accepted. */
  accept(): void {
    this.deadlineMs = this.now() + this.windowMs;
  }

  /** True while the client is considered live. False before any hint has been accepted. */
  isLive(): boolean {
    return this.deadlineMs !== 0 && this.now() < this.deadlineMs;
  }

  /**
   * True once a window has been set and has since expired.
   *
   * Distinguished from `!isLive()` on purpose: "never heard from the client" and "the client
   * stopped talking" call for different responses, and collapsing them into one boolean is
   * how a client that never connected gets reported as having gone away.
   */
  hasExpired(): boolean {
    return this.deadlineMs !== 0 && this.now() >= this.deadlineMs;
  }

  /** Remaining milliseconds, or 0 when no window is open. */
  remainingMs(): number {
    if (this.deadlineMs === 0) return 0;
    return Math.max(0, this.deadlineMs - this.now());
  }

  /** Drops the window, so the next `isLive()` is false even if the deadline has not passed. */
  reset(): void {
    this.deadlineMs = 0;
  }
}

/** What the transport should do with an inbound op 17. */
export type LoginHintOutcome =
  | { kind: "accept"; hint: LoginHint }
  | { kind: "reject"; status: number; message: string };

/** -EINVAL, the status the reference replies with. */
const kInvalidArgument = -22;

/**
 * Classifies an inbound op 17 without touching any state.
 *
 * Separated from the state change so the decision can be tested on its own and so the caller
 * controls ordering: the reference replies op 5 on rejection and op 3 on acceptance, and doing
 * the state change first would mean an accepted-then-failed-reply had already extended the
 * window.
 */
export function classifyLoginHint(value0: bigint): LoginHintOutcome {
  const hint = decodeLoginHint(value0);
  if (hint === null) {
    return {
      kind: "reject",
      status: kInvalidArgument,
      message: "invalid login identity hint",
    };
  }
  return { kind: "accept", hint };
}

// ---------------------------------------------------------------------------
// The two outbound notifications the reference sends
// ---------------------------------------------------------------------------
// Both carry only a session identity in value0 and no command, message or body. They exist so
// a downstream consumer can tell which account a stream belongs to without correlating it
// against control traffic -- which is exactly what a private-message-reporting feed needs,
// since its payload says nothing about the account.
//
// The receipt op is the counterpart of op 6: the reference sends one before each packet it
// publishes, so a consumer that missed a packet can see the sequence advanced rather than
// waiting forever for something that was already sent.

/** Sequence for an outbound receipt, so the counterpart can be matched without a body. */
export interface ReceiptNotice {
  /** Sequence of the packet this acknowledges. */
  sequence: number;
  /** Session id at the time of publication. */
  value0: bigint;
}

/**
 * The requestId the reference puts on an op 22.
 *
 * It is `(id == 0) ? 1 : 0` -- an inverted presence flag, not a sequence number. Copied rather
 * than tidied because a consumer written against the reference may be reading it, and the cost
 * of matching is one expression.
 */
export function accountReportRequestId(id: bigint): number {
  return id === 0n ? 1 : 0;
}
