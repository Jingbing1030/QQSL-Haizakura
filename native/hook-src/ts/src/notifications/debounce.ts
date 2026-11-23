// The notification debounce state machine: a pure 3-state automaton with no I/O.
//
// Reference region: src/notifications/debounce.ts L348499-L348540 (42 lines, ported
// verbatim).
//
// ---------------------------------------------------------------------------
// What it is for
// ---------------------------------------------------------------------------
// QQ accounts flap. A hook re-injects, the process restarts, the network blips —
// each of those produces an offline/online edge, and a notification channel that
// posts on every edge turns one restart into two messages plus a false alarm. The
// machine suppresses the pair: an account that reconnects inside `debounceSeconds`
// never fires at all.
//
// ---------------------------------------------------------------------------
// Why the decisions are returned rather than acted on
// ---------------------------------------------------------------------------
// The machine holds no timers. `onOffline` answers "schedule this in N ms" and the
// caller (`NotificationManager.apply`) owns the `setTimeout`. That split is what
// makes the machine testable without a clock, and it is why the state and the timer
// map are two separate structures in the manager — a single map holding
// `{state, timer}` would let them drift.
//
// ---------------------------------------------------------------------------
// The three states, and why `none` is not a fourth
// ---------------------------------------------------------------------------
//   * absent   — no edge seen for this uin (or the last one was already emitted)
//   * pending  — offline seen, timer armed, not yet fired
//   * offline  — the offline event was emitted; a later online is a real edge
//
// `onOffline` while already `pending` or `offline` is a no-op, which is what makes
// a repeated offline (two hook processes dying for one account) collapse to one
// notification. The `none` *decision* is the "nothing to do" answer; it is not a
// state.
//
// `debounceSeconds <= 0` (and non-finite, which is what a corrupt config produces)
// emits immediately instead of scheduling a zero-delay timer. A zero-delay timer
// would still be correct but would make the emit asynchronous, and the reference's
// `handleOffline` path is observably synchronous in that case.

/** What `apply` should do next. A discriminated union so the caller must handle all four. */
export type DebounceDecision =
  | { readonly kind: "emit"; readonly event: "offline" | "online" }
  | { readonly kind: "schedule"; readonly delayMs: number }
  | { readonly kind: "cancel" }
  | { readonly kind: "none" };

type DebounceState = "pending" | "offline";

export class DebounceMachine {
  private readonly states = new Map<string, DebounceState>();

  /**
   * Account went offline.
   *
   * `debounceSeconds` is passed in per call rather than captured at construction so
   * that a config reload takes effect on the next transition, without the manager
   * having to rebuild the machine (and lose the in-flight states).
   */
  onOffline(uin: string, debounceSeconds: number): DebounceDecision {
    if (this.states.has(uin)) return { kind: "none" };
    if (!Number.isFinite(debounceSeconds) || debounceSeconds <= 0) {
      // Explicitly record the state before emitting: without it, a second offline
      // edge for the same account would emit a second notification.
      this.states.set(uin, "offline");
      return { kind: "emit", event: "offline" };
    }
    this.states.set(uin, "pending");
    return { kind: "schedule", delayMs: debounceSeconds * 1_000 };
  }

  /**
   * Account came online.
   *
   * The state is deleted *before* the branch, not after: every branch below leaves
   * the account with no in-flight edge, so doing it first is the only way to keep
   * the three returns from each needing their own `delete`.
   */
  onOnline(uin: string): DebounceDecision {
    const state = this.states.get(uin);
    this.states.delete(uin);
    if (state === "pending") return { kind: "cancel" };
    if (state === "offline") return { kind: "emit", event: "online" };
    return { kind: "none" };
  }

  /**
   * The offline debounce window elapsed (the armed timer fired).
   *
   * Guarded on `pending` rather than on the timer alone, because a `cancel` and a
   * timer can race: `clearTimeout` on an already-queued callback does not un-queue
   * it, so a reconnect in the same tick as the expiry would otherwise emit a
   * spurious `offline` after the `online`.
   */
  onTimerElapsed(uin: string): DebounceDecision {
    if (this.states.get(uin) !== "pending") return { kind: "none" };
    this.states.set(uin, "offline");
    return { kind: "emit", event: "offline" };
  }
}
