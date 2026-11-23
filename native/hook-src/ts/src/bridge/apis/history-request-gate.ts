// The history request throttle: one process-wide gate for every roaming request.
//
// ---------------------------------------------------------------------------
// What this owns, and why it is not a debounce
// ---------------------------------------------------------------------------
// The gate serialises the *network operation*, not just a preceding delay. Two things
// follow from that, and both are load-bearing:
//
//   1. **Concurrent callers are serialised, not batched.** Every `run` appends to a
//      promise chain, so a second caller waits for the first one's operation to settle
//      before its own delay even begins. A debounce would let both fire.
//   2. **The spacing is enforced on both sides of the request.** `lastStartedAt` records
//      when the previous operation *started*, and `nextAllowedAt` when it started plus
//      the gap. So the wait is the max of "gap since the last start" and "gap after the
//      last start" — which for a zero-duration operation are the same thing, but for a
//      slow one means the *next* request is not measured from its own completion. QQ's
//      roaming endpoint is rate limited and a client that measures from completion
//      instead of start sends faster than it thinks it does.
//
// ---------------------------------------------------------------------------
// Cancellation, and the one non-obvious state
// ---------------------------------------------------------------------------
// An aborted signal has to fail the caller but must NOT break the chain, or every
// later caller inherits the rejection. The chain tail is therefore `result.then(noop,
// noop)`.
//
// `operationStarted` exists so an abort can distinguish two cases that share one code
// path:
//
//   * still queued  -> reject now, and the operation never runs;
//   * already started -> ignore the abort for rejection purposes, because the bytes are
//     on the wire and the server may still act on them.
//
// Returning the running promise in the second case is deliberate: the caller learns the
// real outcome rather than "aborted", which would be a lie about whether the request
// went out.
//
// Reference: `src/bridge/apis/history-request-gate.ts`, reference/index.mjs:298640
// (72 lines). Note that this region sits immediately *before* the message region, which
// is why `message.ts` sees `HistoryRequestGate` without importing it — one more instance
// of the "same name, different region" shape.

/** The clock the gate schedules against, injectable for tests. */
export interface GateClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

const SYSTEM_CLOCK: GateClock = {
  now: () => Date.now(),
  sleep: (ms, signal) => abortableSleep(ms, signal),
};

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("history request aborted");
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (signal === undefined) return new Promise((resolve) => setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new Error("history request aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Reject an abort that arrives while the caller is still queued.
 *
 * The listener stays attached until the result settles, because the abort can arrive
 * after `run` returns but before the queued operation begins — which is the whole window
 * this function is for.
 */
function rejectWhileQueuedOnAbort<T>(
  result: Promise<T>,
  signal: AbortSignal,
  hasStarted: () => boolean,
): Promise<T> {
  if (signal.aborted && !hasStarted()) {
    return Promise.reject(signal.reason ?? new Error("history request aborted"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      if (!hasStarted()) reject(signal.reason ?? new Error("history request aborted"));
    };
    signal.addEventListener("abort", onAbort);
    result.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

/**
 * Process-wide roaming-request gate.
 *
 * One instance is shared by every history caller (`historyRequestGate` in the
 * reference's message region), so group history, c2c history, the login sync probe and
 * the mark-read packets all queue behind each other. That is intentional: they hit the
 * same server-side limiter.
 */
export class HistoryRequestGate {
  readonly #clock: GateClock;
  #tail: Promise<void> = Promise.resolve();
  #lastStartedAt: number | null = null;
  #nextAllowedAt = 0;

  constructor(clock: GateClock = SYSTEM_CLOCK) {
    this.#clock = clock;
  }

  /**
   * Run `operation` no sooner than `minimumGapMs` after the previous start.
   *
   * The result is the operation's own promise once it has started, so a rejection from
   * the operation propagates to its caller and not to the queue.
   */
  run<T>(minimumGapMs: number, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!Number.isSafeInteger(minimumGapMs) || minimumGapMs < 0) {
      return Promise.reject(new Error(`history request gap is invalid: ${String(minimumGapMs)}`));
    }
    let operationStarted = false;
    const result = this.#tail.then(async () => {
      throwIfAborted(signal);
      const now = this.#clock.now();
      const requestedBoundary = this.#lastStartedAt === null ? now : this.#lastStartedAt + minimumGapMs;
      const wait = Math.max(this.#nextAllowedAt, requestedBoundary) - now;
      if (wait > 0) await this.#clock.sleep(wait, signal);
      throwIfAborted(signal);
      const startedAt = this.#clock.now();
      this.#lastStartedAt = startedAt;
      this.#nextAllowedAt = startedAt + minimumGapMs;
      operationStarted = true;
      return operation();
    });
    // Keep the chain alive past a rejection, or every later caller inherits it.
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return signal !== undefined ? rejectWhileQueuedOnAbort(result, signal, () => operationStarted) : result;
  }
}

/**
 * The shared instance.
 *
 * Exported as a value rather than created per caller: the rate limit is server-side and
 * per-account, so two gates would double the permitted rate. This is the same shape the
 * reference uses (`var historyRequestGate = new HistoryRequestGate()`, a module-scope
 * singleton in the message region).
 */
export const historyRequestGate = new HistoryRequestGate();