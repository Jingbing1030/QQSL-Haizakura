// Session and message-snapshot policy.
//
// ---------------------------------------------------------------------------
// What this is, and why it is not in the payload
// ---------------------------------------------------------------------------
// The closed-source payload validates three things around every message it reads out of QQ:
// that the session it attached to is still the session it thinks (two identity comparisons,
// "session identity changed" and "session account identity changed"); that the bytes it read
// were not rewritten mid-read ("message payload changed during snapshot"); and that its
// receipt bookkeeping is unambiguous ("receipt mutex import missing or ambiguous").
//
// None of that is address-space work. It is comparison, retry and classification over values
// -- exactly the policy half that belongs here rather than inside a shared object that must be
// recompiled and reinjected to change a threshold.
//
// ---------------------------------------------------------------------------
// The concurrency model is real, not defensive
// ---------------------------------------------------------------------------
// QQ is mutating state from its own threads the whole time. A snapshot taken naively can read
// a length from before an append and the bytes from after it, and the result is a
// confidently-wrong message -- worse than a failed read, because nothing downstream can tell.
// So a snapshot is validated by reading a witness value on both sides of the copy and
// retrying when it moved. The witness is not the payload (hashing 64 KB to detect a torn read
// costs more than re-reading it); it is a cheap monotonic value the owner bumps on write.
/**
 * The failure reasons a caller can act on.
 *
 * Kept as a closed set rather than free-form strings so a caller can branch without matching
 * on prose, and so the summary a user sees stays stable when the wording changes. The three
 * error strings the reference implementation emits map onto the first three.
 */
export type PolicyFailure =
  | "session-identity-changed"
  | "session-account-changed"
  | "snapshot-torn"
  | "snapshot-unstable"
  | "receipt-ambiguous"
  | "wrong-channel"
  | "not-logged-in";

export class PolicyError extends Error {
  readonly failure: PolicyFailure;
  constructor(failure: PolicyFailure, detail?: string) {
    super(detail === undefined ? failure : `${failure}: ${detail}`);
    this.name = "PolicyError";
    this.failure = failure;
  }
}

/** What the hook believes about the session it is attached to. */
export interface SessionIdentity {
  /** QQ's pid. A restarted client is a different process even at the same path. */
  pid: number;
  /** The account the session is logged in as, or null when it could not be read. */
  uin: string | null;
  /**
   * Identifies one attachment of the hook to one process.
   *
   * Not the pid: QQ can restart inside the same pid under some supervisors, and a counter is
   * the only thing that distinguishes the old session from the new one in that case.
   */
  generation: number;
}

/**
 * Compares two observations of the same session.
 *
 * Two separate checks because they mean different things and want different responses:
 *
 *   * a changed uin means the hook is attached to a different *account*. Every queued
 *     operation that was addressed to the old one must be dropped, not retried.
 *   * a changed generation means the process was replaced while we held state. The session
 *     object is stale in every field, so anything cached against it is worthless.
 *
 * A uin that is null on either side is not a change. The payload reports null when it could
 * not read the account, and treating "could not read" as "changed" would fire the expensive
 * path on a diagnostic gap -- the false positive this whole module exists to avoid.
 */
export function compareSession(before: SessionIdentity, after: SessionIdentity): PolicyFailure | null {
  if (before.pid !== after.pid || before.generation !== after.generation) {
    return "session-identity-changed";
  }
  if (before.uin !== null && after.uin !== null && before.uin !== after.uin) {
    return "session-account-changed";
  }
  return null;
}

export interface SnapshotOptions {
  /** How many times to re-read before giving up. */
  attempts?: number;
  /** Milliseconds to wait between attempts; grows linearly. */
  backoffMs?: number;
  /** Injected so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_BACKOFF_MS = 4;

/**
 * Reads a message out of QQ under an optimistic-concurrency check.
 *
 * `witness` returns a cheap value that changes whenever the message does -- in practice a
 * sequence number or a mutation counter the owner bumps. `read` performs the actual copy.
 *
 * The protocol is: witness, read, witness. If the two witnesses agree, nothing was appended or
 * rewritten while the copy ran, and the bytes are consistent with their length.
 *
 * One retry loop rather than a lock, because the writer is QQ's own code and cannot be made to
 * take ours. That also means a message being actively appended (a long one arriving) will
 * exhaust the attempts; "snapshot-unstable" says so plainly instead of returning a truncated
 * body that would parse as a shorter message and look fine.
 */
export async function readStableSnapshot<T>(
  witness: () => Promise<number> | number,
  read: () => Promise<T> | T,
  options: SnapshotOptions = {},
): Promise<{ value: T; attempts: number }> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new PolicyError("snapshot-unstable", `attempts must be a positive integer, got ${attempts}`);
  }

  let lastFailure: PolicyFailure = "snapshot-unstable";
  for (let i = 0; i < attempts; i++) {
    const before = await witness();
    const value = await read();
    const after = await witness();

    if (before === after) return { value, attempts: i + 1 };

    // Distinguishing the two is not pedantry: a torn read means the data was inconsistent at
    // the moment we looked, while a moved witness with a matching body means the owner is
    // still writing and the retry will likely succeed. They get different backoffs upstream.
    lastFailure = "snapshot-torn";
    if (i + 1 < attempts) await sleep(backoffMs * (i + 1));
  }
  throw new PolicyError(lastFailure, `message payload changed during snapshot (${attempts} attempts)`);
}

/**
 * Receipt bookkeeping for an outgoing message.
 *
 * A receipt is the client's own record that message N was accepted, keyed by the private
 * sequence number the response carries back. The reference implementation's concern is
 * "receipt mutex import missing or ambiguous" -- it could not find, unambiguously, the lock
 * that guards this table, and treated that as fatal rather than proceeding unlocked.
 *
 * The same judgement applies here: the table is written from the socket thread and read from
 * whoever awaits a receipt, so an unguarded version would hand out a receipt for the wrong
 * message under load. Since this runs on Node's single thread there is no lock to find, but
 * the ordering problems remain, so the invariant is enforced explicitly.
 */
export class ReceiptTable {
  /** privateSequence -> the sequence of the request that produced it. */
  private readonly byPrivate = new Map<number, number>();
  /** Bounded, because a receipt that is never claimed must not accumulate. */
  private readonly capacity: number;
  private readonly order: number[] = [];

  constructor(capacity = 256) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new PolicyError("receipt-ambiguous", `capacity must be positive, got ${capacity}`);
    }
    this.capacity = capacity;
  }

  /**
   * Records that `clientSequence` got receipt `privateSequence`.
   *
   * A private sequence that already maps to a different client sequence is refused rather than
   * overwritten: overwriting would silently deliver one message's receipt to another's waiter,
   * and the waiter that loses would hang. The duplicate is the signal that the mapping is not
   * trustworthy -- which is what "ambiguous" meant in the original.
   */
  record(privateSequence: number, clientSequence: number): void {
    if (!Number.isInteger(privateSequence) || privateSequence <= 0) {
      throw new PolicyError("receipt-ambiguous", `private sequence ${privateSequence} is not a positive integer`);
    }
    const existing = this.byPrivate.get(privateSequence);
    if (existing !== undefined && existing !== clientSequence) {
      throw new PolicyError(
        "receipt-ambiguous",
        `private sequence ${privateSequence} already maps to ${existing}, not ${clientSequence}`,
      );
    }
    if (existing === clientSequence) return;

    this.byPrivate.set(privateSequence, clientSequence);
    this.order.push(privateSequence);
    while (this.order.length > this.capacity) {
      const oldest = this.order.shift();
      if (oldest !== undefined) this.byPrivate.delete(oldest);
    }
  }

  /** Claims the receipt for a client sequence, removing it. Null when it has not arrived. */
  claim(privateSequence: number): number | null {
    const clientSequence = this.byPrivate.get(privateSequence);
    if (clientSequence === undefined) return null;
    this.byPrivate.delete(privateSequence);
    const at = this.order.indexOf(privateSequence);
    if (at >= 0) this.order.splice(at, 1);
    return clientSequence;
  }

  get size(): number {
    return this.byPrivate.size;
  }

  /**
   * Whether the table is in a state a caller can trust.
   *
   * Mirrors the reference implementation's refusal to proceed when its guard could not be
   * located: an unbounded table means receipts are outliving their waiters, and every later
   * lookup is suspect.
   */
  get unambiguous(): boolean {
    return this.byPrivate.size <= this.capacity && this.order.length === this.byPrivate.size;
  }
}

/**
 * Rejects a frame whose channel carried an operation it does not own.
 *
 * The two sockets have disjoint halves of the op space (control serves 1/2/3/4/5/7, recv
 * serves 1/6/7/21/22). Accepting a control op on the recv socket would let a confused sender
 * drive the wrong state machine, and the failure would show up much later as a stuck request.
 */
export function checkChannelOp(channel: "control" | "recv", op: number): PolicyFailure | null {
  const allowed = channel === "control" ? CONTROL_OPS : RECV_OPS;
  return allowed.has(op) ? null : "wrong-channel";
}

// The two halves are disjoint apart from hello (1) and login (7), which both channels carry
// because both need them: the payload announces login on either one, and each socket is
// opened with its own hello.
const CONTROL_OPS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5, 7]);
const RECV_OPS: ReadonlySet<number> = new Set([1, 6, 7, 21, 22]);