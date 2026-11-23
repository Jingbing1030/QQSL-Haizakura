// Process lifecycle / supervised-run layer.
//
// Reference regions (all in `../reference/index.mjs`):
//
//   L347697-L347760  `BridgeManager.dispose` / `disposeSessions` / `closeSession`
//                    — shutdown is single-shot, awaits every detached account, and
//                    collects failures into one `AggregateError` instead of throwing
//                    on the first one.
//   L345007-L345140  `OneBotManager.dispose` — quiesce first (stop accepting), then
//                    await in-flight work, then dispose adapters, then close stores.
//   L345302-L345318  `releaseRetiringInstance` — the ONLY place the reference bounds
//                    a drain: `Promise.race([instance.dispose(), timeout])`, and on
//                    timeout it logs and calls `forceRelease()` rather than hanging.
//   L344987        `DEFAULT_SESSION_RELEASE_DEADLINE_MS = 1e4` — the drain bound.
//   L374244-L374288  `main().shutdown` — `shutdownStarted` makes shutdown sticky and
//                    idempotent; each component is disposed in its own try/catch so one
//                    failure cannot skip the rest; the exit code is 1 if any failed.
//   L374138-L374142  `process.on("SIGINT"|"SIGTERM", ...)` — the whole signal surface.
//   L4675, L4912-L4960  `AUTO_LOAD_MAX_ATTEMPTS` / `runAutoLoad` — restart-on-crash.
//   L4501-L4502      `DEFAULT_INTERVAL_MS = 1500` / `MIN_INTERVAL_MS = 250` — the
//                    watcher tick that re-drives a failed auto-load. This is the
//                    reference's *actual* backoff: a FIXED delay, floored at 250 ms.
//
// ---------------------------------------------------------------------------
// The reference's restart/backoff policy, stated exactly (do not invent a better one)
// ---------------------------------------------------------------------------
//
// Restart-on-crash for a supervised component is `HookManager.runAutoLoad`
// (L4912-L4961), driven by `PipeWatcher`'s tick (L4504-L4622, interval constants at
// L4501-L4502). The policy is:
//
//   1. FIXED DELAY, not exponential. `runAutoLoad` owns no timer of its own; it is
//      re-entered by the watcher tick (`this.pipeWatcher.on("tick", ...)`, L4902),
//      whose period is `DEFAULT_INTERVAL_MS = 1500` (L4501) clamped up to
//      `MIN_INTERVAL_MS = 250` (L4502) by `Math.max(...)` at L4520. The gap between
//      attempts is therefore one fixed 1500 ms poll — there is no multiplier anywhere.
//   2. MAX 3 CONSECUTIVE ATTEMPTS, not 3 lifetime. `AUTO_LOAD_MAX_ATTEMPTS = 3`
//      (L4675), gated at L4918 (`state.attempts >= AUTO_LOAD_MAX_ATTEMPTS` → give up)
//      and declared exhausted at L4952 (`attempt >= AUTO_LOAD_MAX_ATTEMPTS`). The
//      counter is incremented before the attempt (L4919), so the sequence is 1, 2, 3 —
//      the initial start plus two restarts.
//   3. THE BUDGET RESETS ON SUCCESS. Success deletes the whole per-PID record
//      (`this.autoLoadAttempts.delete(session.pid)`, L4930) and logs
//      `auto-load recovered` (L4944), so a component that recovers earns a fresh 3.
//   4. ONLY TRANSIENT FAILURES ARE RETRIED. L4947 `if (!isTransientLibcMappingError(
//      info.error))` abandons the budget on a permanent error — no retry at all.
//      The classifier is L5029-L5031: `/^target process does not map .*\/libc\.so\.6
//      while resolving mmap$/`.
//   5. EXHAUSTION IS TERMINAL AND LOUD. L4953-L4955 logs
//      `auto-load retry exhausted: PID=%d attempts=%d err=%s` at warn level and leaves
//      the session in `error`; nothing re-arms it.
//
// The one place the reference *does* use a growing (3x) delay is login-identity
// reconciliation: `LOGIN_HINT_RETRY_DELAYS_MS = [3e3, 9e3]` (L3729) with
// `LOGIN_HINT_MAX_ATTEMPTS = 3` (L3728), consumed at L4387-L4389. That is a different
// subsystem (op-7 identity, not component supervision); it is recorded here only so the
// next reader can tell the two apart. This module implements (1)-(5), not that.
//
// ---------------------------------------------------------------------------
// Why this module exists at all
// ---------------------------------------------------------------------------
//
// The port has been repeatedly bitten by "started" meaning nothing: a component reports
// `running` while its socket is closed, or `stop()` returns while a listener still owns
// a port. So the two properties this file is built around are:
//
//   * Every state change goes through `transition()`, and an illegal one THROWS with
//     both states named. A silent no-op is the bug, not the fix.
//   * `status()` is derived, never remembered: a `running` supervisor whose child fails
//     its liveness probe reports `failed`. There is no code path that reports `running`
//     for a dead child, which is the only way to make that class of bug unrepresentable.
//
// Signal handling is injected (`SignalSource`) so a test can drive SIGINT/SIGTERM
// without installing a real handler on the test process.

import { createLogger, errorMessage } from "../onebot/log.js";
import { readEnvAlias } from "../bridge/env.js";

const log = createLogger("Host.Lifecycle");

// ---------------------------------------------------------------------------
// Reference constants (see the header for the line numbers)
// ---------------------------------------------------------------------------

/**
 * L344987 `DEFAULT_SESSION_RELEASE_DEADLINE_MS = 1e4`.
 *
 * How long `stop()` waits for in-flight work before force-closing. Ten seconds is the
 * reference's own number for the same decision ("Ten seconds covers a normal drain",
 * L344985), so it is reused rather than invented.
 */
export const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;

/**
 * L344988 `SESSION_RELEASE_DEADLINE_ENV` — the reference lets an operator override the
 * drain bound from the environment. Same name, same semantics: a value that is not a
 * positive safe integer is *ignored* (L344992-L344998), never coerced to 0.
 */
export const DRAIN_TIMEOUT_ENV = "HAIZAKURA_SESSION_RELEASE_DEADLINE_MS";
/** Legacy name, still honoured as a fallback so existing units keep working. */
export const DRAIN_TIMEOUT_ENV_LEGACY = "SNOWLUMA_SESSION_RELEASE_DEADLINE_MS";

/** L344989 `MAX_SESSION_RELEASE_DEADLINE_MS` — the ceiling `setTimeout` can hold. */
export const MAX_DRAIN_TIMEOUT_MS = 2_147_483_647;

/** L4675 `AUTO_LOAD_MAX_ATTEMPTS = 3` — total start attempts, initial included. */
export const DEFAULT_MAX_RESTART_ATTEMPTS = 3;

/** L4501 `DEFAULT_INTERVAL_MS = 1500` — the watcher tick, i.e. the restart delay. */
export const DEFAULT_RESTART_DELAY_MS = 1_500;

/** L4502 `MIN_INTERVAL_MS = 250` — the floor the watcher clamps its period to. */
export const MIN_RESTART_DELAY_MS = 250;

/**
 * L344992-L344998 `parseSessionReleaseDeadlineMs`: positive integer milliseconds, or
 * `undefined` when the raw value is absent or unusable. Callers pick the fallback.
 */
export function parseDrainTimeoutMs(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_DRAIN_TIMEOUT_MS) return undefined;
  return parsed;
}

/** L345000-L345006 `resolveSessionReleaseDeadlineMs`: env wins, unusable env ignored. */
export function resolveDrainTimeoutMs(
  configured: number | undefined,
  envRaw: string | undefined = readEnvAlias("SESSION_RELEASE_DEADLINE_MS"),
): number {
  const fromEnv = parseDrainTimeoutMs(envRaw);
  if (fromEnv !== undefined) return fromEnv;
  if (
    configured !== undefined &&
    Number.isSafeInteger(configured) &&
    configured > 0 &&
    configured <= MAX_DRAIN_TIMEOUT_MS
  ) {
    return configured;
  }
  return DEFAULT_DRAIN_TIMEOUT_MS;
}

/** L4520 `Math.max(MIN_INTERVAL_MS, deps.intervalMs ?? DEFAULT_INTERVAL_MS)`. */
export function resolveRestartDelayMs(configured: number | undefined): number {
  if (configured === undefined || !Number.isFinite(configured)) return DEFAULT_RESTART_DELAY_MS;
  return Math.max(MIN_RESTART_DELAY_MS, Math.floor(configured));
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * The five states. The vocabulary matches what the WebUI renders
 * (`AdapterStatus.status`) while adding the two the manager does not model
 * (`starting`/`stopping`), because "half up" and "half down" are exactly the
 * windows where this port's bugs live.
 */
export type LifecycleState = "stopped" | "starting" | "running" | "stopping" | "failed";

/**
 * THE TRANSITION TABLE. Every entry is a state `transition()` will accept as a target
 * from the key. Anything absent is illegal and throws.
 *
 *   stopped  -> starting                    first start, or start after failure
 *   starting -> running | stopping | failed  success / cancelled / start threw
 *   running  -> stopping | failed            operator stop / child died
 *   stopping -> stopped                      drain finished or was force-closed
 *   failed   -> starting | stopping          manual retry / clean up the survivors
 *
 * Note what is deliberately absent: `stopped -> stopped` and `running -> running`.
 * Those two are handled by the public methods as idempotent no-ops (double `stop()`
 * must not throw, and must not pretend to have done work either), which is a different
 * thing from a legal transition.
 *
 * Also absent: `failed -> running`. A restart re-enters through `starting`, so a
 * component that comes back is reported as having started rather than having been
 * running the whole time.
 */
const TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  stopped: ["starting"],
  starting: ["running", "stopping", "failed"],
  running: ["stopping", "failed"],
  stopping: ["stopped"],
  failed: ["starting", "stopping"],
};

/** Thrown for any transition the table above does not allow. Names both states. */
export class IllegalTransitionError extends Error {
  readonly from: LifecycleState;
  readonly to: LifecycleState;

  constructor(from: LifecycleState, to: LifecycleState, detail?: string) {
    super(
      `illegal lifecycle transition ${from} -> ${to}` + (detail === undefined ? "" : `: ${detail}`),
    );
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
  }
}

/** Thrown when a component is asked to do something that is a caller bug in this state. */
export class LifecycleStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleStateError";
  }
}

/** Whether `to` is a legal target from `from`, per the table. */
export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Per-component lifecycle, as far as the supervisor can observe it. */
export type ComponentState =
  | "pending"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

/**
 * One supervised piece: the hook client, the bridge, a network listener.
 *
 * `start`/`stop` may be sync or async. `stop` is the GRACEFUL path — stop accepting new
 * work, drain in-flight work, then resolve. If it does not resolve inside the
 * supervisor's drain deadline, the supervisor calls `forceStop` (sync, best effort) and
 * moves on; that is the reference's `Promise.race` + `forceRelease` at
 * L345304-L345318.
 */
export interface SupervisedComponent {
  /** Stable name; appears in `status()` and in every error message. */
  readonly name: string;
  start(): void | Promise<void>;
  /** Graceful: stop accepting, drain, resolve. Must eventually resolve in normal use. */
  stop(): void | Promise<void>;
  /**
   * Best-effort synchronous teardown, called only when `stop()` blew the drain deadline.
   * Optional because most components can `close()` inside `stop()`; a hung one cannot.
   */
  forceStop?(): void;
  /**
   * Liveness probe. `true` = up. Optional: a component with no probe is assumed alive
   * while the supervisor believes it is running.
   *
   * This is the safety net against the port's recurring bug. A component that dies
   * without calling `reportCrash` is still caught here, because `status()` consults this
   * probe on every read and downgrades `running` to `failed` rather than lying.
   */
  isAlive?(): boolean;
  /**
   * L5029 `isTransientLibcMappingError` seam. Return `false` for a permanent failure and
   * the supervisor abandons the restart budget immediately (L4947), exactly as the
   * reference does. Absent = every failure is retryable.
   */
  isTransient?(error: unknown): boolean;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface ComponentStatus {
  name: string;
  state: ComponentState;
  /** Probe result, or `true` while no probe is configured. */
  alive: boolean;
  /** Consecutive failed start attempts since the last clean run. */
  attempts: number;
  /** How many times this component has been restarted after a crash. */
  restarts: number;
  error: string | null;
  startedAt: number | null;
}

/** How a failure was observed. `probe` means the component never told us. */
export type FailureSource = "start" | "crash" | "probe";

export interface SupervisorFailure {
  component: string;
  message: string;
  at: number;
  /** True when the restart budget ran out; false for a permanent failure. */
  exhausted: boolean;
  detectedBy: FailureSource;
}

export interface SupervisorStatus {
  /**
   * The HONEST state. Equal to the internal state except that a `running` supervisor
   * with a dead child is reported as `failed`. Never `running` when a child is dead.
   */
  state: LifecycleState;
  /** `Date.now()` of the last successful transition. */
  since: number;
  components: readonly ComponentStatus[];
  /** Present iff `state === "failed"`. */
  failure?: SupervisorFailure | undefined;
  /** Total successful restarts across all components, for the WebUI. */
  restarts: number;
}

export interface StopResult {
  /** Always true: `stop()` resolves once the supervisor is quiescent. */
  stopped: boolean;
  /** Component names whose `stop()` missed the drain deadline and were force-closed. */
  timedOut: readonly string[];
  /** Components whose graceful stop rejected. Recorded, never rethrown (L374244-L374288). */
  errors: readonly { name: string; message: string }[];
}

export interface StartResult {
  started: boolean;
  /** Components that failed to start, in order. */
  errors: readonly { name: string; message: string }[];
}

// ---------------------------------------------------------------------------
// Signal source
// ---------------------------------------------------------------------------

/**
 * The injectable signal surface. Deliberately tiny: `process` satisfies it structurally,
 * and so does a three-line fake in a test.
 *
 * The reference touches signals exactly twice (L374138-L374142) and only to set a
 * `stopping` flag, so nothing richer is needed. `on` returns its own unsubscribe handle
 * (unlike `process.on`, which returns the emitter) so the supervisor can drop handlers
 * on `stop()` without knowing what it was given.
 */
export interface SignalSource {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): () => void;
}

/**
 * The real process, as a `SignalSource`.
 *
 * NOT used by default. A supervisor that installs process-wide handlers just by being
 * constructed is a leak in every test that builds one, so the caller has to ask for it
 * explicitly — see `SupervisorOptions.signals`.
 */
export function processSignalSource(target: NodeJS.EventEmitter = process): SignalSource {
  return {
    on(signal, listener) {
      target.on(signal, listener);
      return () => {
        target.off(signal, listener);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Supervisor
// ---------------------------------------------------------------------------

export interface SupervisorOptions {
  readonly components?: readonly SupervisedComponent[];
  /** Drain bound for `stop()`. Defaults to `resolveDrainTimeoutMs(undefined)`. */
  readonly drainTimeoutMs?: number | undefined;
  /** Total start attempts per component, initial included. L4675: default 3. */
  readonly maxRestartAttempts?: number | undefined;
  /** Fixed delay before a restart. L4501/L4502: default 1500, floored at 250. */
  readonly restartDelayMs?: number | undefined;
  /** Set false to report a crashed child as `failed` without restarting it. */
  readonly restartOnCrash?: boolean | undefined;
  /**
   * Signal source to wire `stop()` into. Absent = no handlers installed, which is what
   * every test and every embedding host wants.
   */
  readonly signals?: SignalSource | undefined;
  /** Injectable clock, so a test can assert `since`/`at` without depending on wall time. */
  readonly now?: (() => number) | undefined;
}

interface ComponentRecord {
  readonly spec: SupervisedComponent;
  state: ComponentState;
  attempts: number;
  restarts: number;
  error: string | null;
  startedAt: number | null;
  /** Pending restart timer, if any. Always cleared before a new one is set. */
  timer: ReturnType<typeof setTimeout> | null;
}

interface StopError {
  name: string;
  message: string;
}

export class Supervisor {
  private readonly records: ComponentRecord[];
  private readonly byName: Map<string, ComponentRecord>;
  private readonly drainTimeoutMs: number;
  private readonly maxRestartAttempts: number;
  private readonly restartDelayMs: number;
  private readonly restartOnCrash: boolean;
  private readonly now: () => number;
  private readonly signalDisposers: (() => void)[] = [];

  private current: LifecycleState = "stopped";
  private since: number;
  private failure: SupervisorFailure | null = null;
  private totalRestarts = 0;

  /** Set by `stop()`; the start loop checks it between components. */
  private stopRequested = false;
  /** The in-flight `start()`. Non-null for the duration of a start, even after failure. */
  private startPromise: Promise<StartResult> | null = null;
  /** Settles when the in-flight `start()` settles. Never rejects, so `stop()` can await it. */
  private startSettled: Promise<void> | null = null;
  private stopPromise: Promise<StopResult> | null = null;
  private lastStopResult: StopResult | null = null;
  /** Names whose graceful `stop()` has settled during the current drain. */
  private readonly stopSettled = new Set<string>();

  constructor(options: SupervisorOptions = {}) {
    this.records = (options.components ?? []).map((spec) => ({
      spec,
      state: "pending" as ComponentState,
      attempts: 0,
      restarts: 0,
      error: null,
      startedAt: null,
      timer: null,
    }));
    this.byName = new Map(this.records.map((record) => [record.spec.name, record]));
    if (this.byName.size !== this.records.length) {
      throw new LifecycleStateError("supervised component names must be unique");
    }
    this.drainTimeoutMs = resolveDrainTimeoutMs(options.drainTimeoutMs);
    this.maxRestartAttempts =
      options.maxRestartAttempts !== undefined &&
      Number.isSafeInteger(options.maxRestartAttempts) &&
      options.maxRestartAttempts > 0
        ? options.maxRestartAttempts
        : DEFAULT_MAX_RESTART_ATTEMPTS;
    this.restartDelayMs = resolveRestartDelayMs(options.restartDelayMs);
    this.restartOnCrash = options.restartOnCrash ?? true;
    this.now = options.now ?? (() => Date.now());
    this.since = this.now();

    if (options.signals !== undefined) {
      // L374138-L374142: SIGINT and SIGTERM both mean "shut down". `stop()` is already
      // idempotent, so two signals in a row are harmless.
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        this.signalDisposers.push(
          options.signals.on(signal, () => {
            log.warn("received %s, shutting down", signal);
            void this.stop().catch((error: unknown) => {
              log.error("shutdown after %s failed: %s", signal, errorMessage(error));
            });
          }),
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // State machine
  // -----------------------------------------------------------------------

  /** The internal state, without the honesty downgrade `status()` applies. */
  get state(): LifecycleState {
    return this.current;
  }

  /** Whether the supervisor is taking new work. The gate every caller should check. */
  get accepting(): boolean {
    return this.current === "running";
  }

  /**
   * The single transition point. Throws `IllegalTransitionError` for anything the table
   * does not allow — a silent no-op here would turn "double start" and "stop while
   * stopping" into indistinguishable successes.
   */
  private transition(to: LifecycleState): void {
    const from = this.current;
    if (!canTransition(from, to)) {
      throw new IllegalTransitionError(from, to, `component state: ${this.describeStates()}`);
    }
    this.current = to;
    this.since = this.now();
    if (to !== "failed") this.failure = null;
    log.debug("lifecycle %s -> %s", from, to);
  }

  private describeStates(): string {
    return this.records.map((record) => `${record.spec.name}=${record.state}`).join(", ") || "(none)";
  }

  /**
   * Enter `failed`, tolerating the case where we are already there.
   *
   * A failure observed while `stopping`/`stopped` is not a state change — a component
   * that rejects during shutdown must not resurrect `failed` — so the reason is logged
   * and dropped rather than thrown.
   */
  private markFailed(failure: SupervisorFailure): void {
    const from = this.current;
    if (from === "failed") {
      this.failure = failure;
      this.since = this.now();
      return;
    }
    if (from === "stopping" || from === "stopped") {
      log.warn(
        "component %s failed while %s; reason recorded in the log only: %s",
        failure.component,
        from,
        failure.message,
      );
      return;
    }
    if (!canTransition(from, "failed")) {
      log.warn(
        "component %s failed while %s; no legal failure transition: %s",
        failure.component,
        from,
        failure.message,
      );
      return;
    }
    this.transition("failed");
    this.failure = failure;
  }

  // -----------------------------------------------------------------------
  // start()
  // -----------------------------------------------------------------------

  /**
   * Bring every component up, in declaration order.
   *
   * The state machine is the ONLY gate: this method does not pre-check `current` with its
   * own conditionals, it calls `transition("starting")` and translates the resulting
   * `IllegalTransitionError` into the caller-facing `LifecycleStateError`. That is
   * deliberate — a second guard here would make `transition()` dead code that no test
   * can reach, which is exactly how a "state machine" ends up being decorative.
   *
   * A double start is a caller bug, and silently returning "ok" is how a duplicate
   * listener ends up owning a port, so both refuse.
   */
  start(): Promise<StartResult> {
    try {
      this.transition("starting");
    } catch (error) {
      if (!(error instanceof IllegalTransitionError)) throw error;
      const detail =
        error.from === "stopping"
          ? "supervisor is stopping; await stop() before starting again"
          : `supervisor is already ${error.from}; start() is not re-entrant`;
      return Promise.reject(new LifecycleStateError(detail));
    }
    this.stopRequested = false;
    this.stopPromise = null;
    this.lastStopResult = null;
    this.stopSettled.clear();
    for (const record of this.records) {
      record.state = "pending";
      record.error = null;
      record.attempts = 0;
      record.startedAt = null;
    }
    const attempt = this.runStart();
    this.startPromise = attempt;
    this.startSettled = attempt.then(
      () => undefined,
      () => undefined,
    );
    // Cleared on settle so a failed start can be retried (the table allows
    // `failed -> starting`) while `startSettled` still lets a concurrent `stop()` wait
    // for the whole attempt rather than racing it.
    void this.startSettled.then(() => {
      if (this.startPromise === attempt) this.startPromise = null;
    });
    return attempt;
  }

  private async runStart(): Promise<StartResult> {
    const errors: StopError[] = [];

    for (const record of this.records) {
      // A stop() that arrived mid-start wins: stop here and let `performStop` drain
      // whatever is already up. `current !== "starting"` also covers the case where the
      // drain already force-closed and finished while this component's `start()` hung.
      if (this.stopRequested || this.current !== "starting") break;

      record.state = "starting";
      try {
        await record.spec.start();
      } catch (error) {
        const message = errorMessage(error);
        record.state = "failed";
        record.error = message;
        record.attempts += 1;
        errors.push({ name: record.spec.name, message });
        log.error("component %s failed to start: %s", record.spec.name, message);
        // Declaration order is a dependency order (hook -> bridge -> listeners), so a
        // failed dependency makes the rest meaningless. Stop at the first failure.
        this.markFailed({
          component: record.spec.name,
          message,
          at: this.now(),
          exhausted: false,
          detectedBy: "start",
        });
        return { started: false, errors };
      }

      record.state = "running";
      record.startedAt = this.now();
      record.error = null;
      record.attempts = 0;
    }

    if (this.stopRequested || this.current === "stopping") {
      log.info("start cancelled by stop(); the drain will close what came up");
      const up = this.records.filter((record) => record.state === "running").length;
      return { started: false, errors: up === 0 ? errors : [...errors] };
    }

    this.transition("running");
    log.info("supervisor running with %d component(s)", this.records.length);
    return { started: true, errors };
  }

  // -----------------------------------------------------------------------
  // stop()
  // -----------------------------------------------------------------------

  /**
   * Graceful shutdown, and idempotent by contract.
   *
   * A second `stop()` resolves with the first one's result. A `stop()` on a supervisor
   * that never started resolves immediately with `stopped: true` — "already stopped" is
   * success, not an error.
   */
  stop(): Promise<StopResult> {
    if (this.stopPromise !== null) return this.stopPromise;
    if (this.current === "stopped") {
      return Promise.resolve(this.lastStopResult ?? { stopped: true, timedOut: [], errors: [] });
    }
    this.stopRequested = true;
    this.cancelRestartTimers();
    const attempt = this.performStop();
    this.stopPromise = attempt;
    void attempt.then(
      () => {
        this.startPromise = null;
      },
      () => {
        this.startPromise = null;
      },
    );
    return attempt;
  }

  private async performStop(): Promise<StopResult> {
    const from = this.current;
    if (from !== "stopping") this.transition("stopping");

    const errors: StopError[] = [];
    const timedOut: string[] = [];

    // 1. Stop accepting new work. The flag was set in `stop()` before this method was
    //    entered, so a crash callback arriving during the drain is not turned into a
    //    restart. `reconcileHealth()` also refuses to act once we are `stopping`.
    //
    // 2. Drain under a bounded deadline. `drainAll` awaits the in-flight start first, so
    //    a hung `start()` cannot hang `stop()` either — that is what the race bounds.
    const outcome = await this.withDeadline(this.drainAll(errors));

    if (outcome === "timeout") {
      const hung = this.records
        .filter((record) => !this.stopSettled.has(record.spec.name))
        .map((record) => record.spec.name);
      log.error(
        "drain did not finish within %dms; force-closing %s",
        this.drainTimeoutMs,
        hung.length === 0 ? "(none)" : hung.join(", "),
      );
      timedOut.push(...hung);
    }

    // 3. Force-close whatever missed the deadline. Reverse start order, because the last
    //    component up is the one holding the sockets the earlier ones use (L342026: "the
    //    last adapter opened goes down first"). A force-close failure is recorded, never
    //    thrown — a half-torn-down process that throws on the way out leaks a socket.
    for (const record of [...this.records].reverse()) {
      if (this.stopSettled.has(record.spec.name)) continue;
      const force = record.spec.forceStop;
      if (force === undefined) {
        record.state = "stopped";
        record.startedAt = null;
        continue;
      }
      try {
        force.call(record.spec);
      } catch (error) {
        errors.push({ name: record.spec.name, message: `forceStop: ${errorMessage(error)}` });
        log.error("forceStop for %s threw: %s", record.spec.name, errorMessage(error));
      }
      record.state = "stopped";
      record.startedAt = null;
    }

    for (const record of this.records) {
      record.state = "stopped";
      record.startedAt = null;
    }

    // 4. Drop the signal handlers — a stopped supervisor must not keep the process alive
    //    or pollute the test runner's listener count.
    this.disposeSignals();

    this.transition("stopped");
    this.stopPromise = null;
    const result: StopResult = { stopped: true, timedOut, errors };
    this.lastStopResult = result;
    log.info("supervisor stopped (forced=%d, errors=%d)", timedOut.length, errors.length);
    return result;
  }

  /**
   * Await the in-flight start (if any), then every component's graceful `stop()`.
   *
   * Two ordering decisions, both taken from the reference:
   *
   *   * `stop()` is *issued* in reverse declaration order, because the last component up
   *     is the one holding the sockets the earlier ones use (L342026: "the last adapter
   *     opened goes down first").
   *   * The stops are *awaited concurrently* (`Promise.allSettled`, L345112), not one
   *     after another. Sequential awaiting would give one hung component the power to
   *     starve every other component's drain and then force-close them all; concurrent
   *     awaiting means only the actually-hung one misses the deadline. It also keeps the
   *     bound at one `drainTimeoutMs` for the whole supervisor instead of N × that.
   *
   * Never rejects: failures are pushed into `errors`.
   */
  private async drainAll(errors: StopError[]): Promise<void> {
    if (this.startSettled !== null) await this.startSettled;

    const pending: Promise<void>[] = [];
    for (const record of [...this.records].reverse()) {
      if (record.state === "pending" || record.state === "stopped") {
        this.stopSettled.add(record.spec.name);
        continue;
      }
      record.state = "stopping";
      // Issued synchronously in reverse order, awaited together below.
      pending.push(
        (async (): Promise<void> => {
          try {
            await record.spec.stop();
          } catch (error) {
            const message = errorMessage(error);
            record.error = message;
            errors.push({ name: record.spec.name, message });
            log.error("graceful stop for %s threw: %s", record.spec.name, message);
          }
          record.state = "stopped";
          record.startedAt = null;
          this.stopSettled.add(record.spec.name);
        })(),
      );
    }

    await Promise.allSettled(pending);
  }

  /**
   * Race `work` against the drain deadline.
   *
   * Deliberate divergence from L345306, which `unref()`s the same timer: here the
   * deadline is the ONLY thing that can settle a hung drain, and an unref'd timer lets
   * Node exit the process mid-shutdown instead of force-closing. A bounded 10 s wait is
   * strictly better than a silent exit, so the timer stays ref'd — and `finally` clears
   * it, so it never outlives the race.
   */
  private withDeadline(work: Promise<void>): Promise<"done" | "timeout"> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.drainTimeoutMs);
    });
    return Promise.race([work.then(() => "done" as const), deadline]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  }

  // -----------------------------------------------------------------------
  // Restart-on-crash
  // -----------------------------------------------------------------------

  /**
   * A component died. This is the reference's `pipe-down` / `process-gone` path
   * (L4856-L4875) funnelled into `runAutoLoad` (L4912).
   *
   * Idempotent per component: a second crash report for a component that already has a
   * restart pending is ignored, so a chatty component cannot burn the budget twice for
   * one death.
   */
  reportCrash(name: string, error?: unknown): void {
    const record = this.byName.get(name);
    if (record === undefined) {
      throw new LifecycleStateError(`unknown supervised component: ${name}`);
    }
    if (this.current === "stopping" || this.current === "stopped") {
      log.warn("crash report for %s ignored: supervisor is %s", name, this.current);
      return;
    }
    if (record.timer !== null) return;
    this.handleFailure(record, error === undefined ? "component exited" : error, "crash");
  }

  /**
   * Probe every running component and fail fast on a silent death.
   *
   * `status()` performs the same read without side effects; this is the *reconciling*
   * version a host calls on its own tick (the reference's `PipeWatcher` tick,
   * L4902-L4909).
   */
  reconcileHealth(): void {
    if (this.current !== "running") return;
    for (const record of this.records) {
      if (record.state !== "running") continue;
      if (record.timer !== null) continue;
      if (this.probe(record)) continue;
      this.handleFailure(record, "component is not alive", "probe");
    }
  }

  private handleFailure(record: ComponentRecord, error: unknown, source: FailureSource): void {
    const name = record.spec.name;
    const message = typeof error === "string" ? error : errorMessage(error);
    // L4947: a permanent failure abandons the budget instead of retrying.
    const transient = record.spec.isTransient?.(error) ?? true;
    record.state = "failed";
    record.error = message;

    if (!transient) {
      log.error("component %s failed permanently: %s", name, message);
      this.markFailed({
        component: name,
        message,
        at: this.now(),
        exhausted: false,
        detectedBy: source,
      });
      return;
    }

    if (!this.restartOnCrash) {
      log.error("component %s crashed and restart is disabled: %s", name, message);
      this.markFailed({
        component: name,
        message,
        at: this.now(),
        exhausted: false,
        detectedBy: source,
      });
      return;
    }

    record.attempts += 1;

    // L4918 + L4952: the budget is spent when the attempt count reaches the maximum.
    // Counted the reference's way — attempts is incremented before the check, so the
    // third failure is the one that gives up (initial start + 2 restarts).
    if (record.attempts >= this.maxRestartAttempts) {
      log.warn(
        "restart budget exhausted for %s: attempts=%d error=%s",
        name,
        record.attempts,
        message,
      );
      this.markFailed({
        component: name,
        message,
        at: this.now(),
        exhausted: true,
        detectedBy: source,
      });
      return;
    }

    log.warn(
      "restart pending for %s: attempt=%d/%d in %dms error=%s",
      name,
      record.attempts,
      this.maxRestartAttempts,
      this.restartDelayMs,
      message,
    );
    // L4956: keep the reason visible while a retry is pending, without claiming healthy.
    this.markFailed({
      component: name,
      message,
      at: this.now(),
      exhausted: false,
      detectedBy: source,
    });
    this.scheduleRestart(record);
  }

  /**
   * One fixed-delay timer per component (L4501/L4502 — the watcher tick, not an
   * exponential backoff). Ref'd on purpose: the reference's `scheduleNext` (L4571-L4580)
   * uses a plain `setTimeout`, so a pending restart keeps the process alive the same way.
   */
  private scheduleRestart(record: ComponentRecord): void {
    if (record.timer !== null) clearTimeout(record.timer);
    record.timer = setTimeout(() => {
      record.timer = null;
      if (this.current === "stopping" || this.current === "stopped") return;
      void this.restartComponent(record);
    }, this.restartDelayMs);
  }

  private async restartComponent(record: ComponentRecord): Promise<void> {
    const name = record.spec.name;
    // `failed -> starting -> running` is the only legal way back, so a restart is
    // visible as a start rather than as "nothing ever happened".
    if (this.current === "failed") this.transition("starting");

    log.info("restarting component %s (attempt %d)", name, record.attempts + 1);
    record.state = "starting";
    try {
      await record.spec.start();
    } catch (error) {
      const message = errorMessage(error);
      record.state = "failed";
      record.error = message;
      record.attempts += 1;
      const exhausted = record.attempts >= this.maxRestartAttempts;
      log.warn(
        "restart of %s failed (attempt %d/%d): %s",
        name,
        record.attempts,
        this.maxRestartAttempts,
        message,
      );
      this.markFailed({
        component: name,
        message,
        at: this.now(),
        exhausted,
        detectedBy: "start",
      });
      if (!exhausted) this.scheduleRestart(record);
      return;
    }

    record.state = "running";
    record.error = null;
    record.startedAt = this.now();
    record.restarts += 1;
    this.totalRestarts += 1;
    // L4930: success deletes the whole record, i.e. the budget resets.
    record.attempts = 0;
    log.info("component %s restarted", name);
    // Every component must be healthy again before `running` is honest.
    if (this.current === "starting" && this.allRunning()) this.transition("running");
  }

  private allRunning(): boolean {
    return this.records.every((record) => record.state === "running" && this.probe(record));
  }

  private probe(record: ComponentRecord): boolean {
    const alive = record.spec.isAlive;
    if (alive === undefined) return true;
    try {
      return alive.call(record.spec);
    } catch (error) {
      log.warn("liveness probe for %s threw: %s", record.spec.name, errorMessage(error));
      return false;
    }
  }

  private cancelRestartTimers(): void {
    for (const record of this.records) {
      if (record.timer !== null) {
        clearTimeout(record.timer);
        record.timer = null;
      }
    }
  }

  private disposeSignals(): void {
    for (const dispose of this.signalDisposers.splice(0)) {
      try {
        dispose();
      } catch (error) {
        log.warn("signal handler disposal threw: %s", errorMessage(error));
      }
    }
  }

  // -----------------------------------------------------------------------
  // status()
  // -----------------------------------------------------------------------

  /**
   * The honest read.
   *
   * Pure: it does not mutate the machine, schedule anything, or await. It does consult
   * every component's `isAlive` probe, and if any of them is dead while we believe we are
   * `running`, it reports `failed` with the reason. That is the whole point — a status
   * that is remembered rather than derived is how this port ended up reporting `running`
   * for a child that had already exited.
   */
  status(): SupervisorStatus {
    const components: ComponentStatus[] = this.records.map((record) => {
      if (record.state !== "running") {
        return {
          name: record.spec.name,
          state: record.state,
          alive: record.state === "starting",
          attempts: record.attempts,
          restarts: record.restarts,
          error: record.error,
          startedAt: record.startedAt,
        };
      }
      const alive = this.probe(record);
      return {
        name: record.spec.name,
        state: alive ? "running" : "failed",
        alive,
        attempts: record.attempts,
        restarts: record.restarts,
        // A dead child that never called reportCrash still reports a reason.
        error: alive ? record.error : (record.error ?? "component is not alive"),
        startedAt: record.startedAt,
      };
    });

    let state = this.current;
    let failure = this.failure ?? undefined;

    if (state === "running" || state === "starting") {
      // The downgrade. First dead component wins, in declaration order, so the reason is
      // deterministic instead of depending on Map iteration.
      const dead = components.find((component) => component.state === "failed");
      if (dead !== undefined) {
        state = "failed";
        failure = {
          component: dead.name,
          message: dead.error ?? "component is not alive",
          at: failure?.at ?? this.since,
          exhausted: failure?.exhausted ?? false,
          detectedBy: failure?.detectedBy ?? "probe",
        };
      }
    }

    return {
      state,
      since: this.since,
      components,
      ...(failure === undefined ? {} : { failure }),
      restarts: this.totalRestarts,
    };
  }

  /** Convenience for the WebUI's "can I take traffic?" question. */
  isHealthy(): boolean {
    return this.status().state === "running";
  }
}

/**
 * Build a supervisor over `components`. Thin on purpose — the class is the API surface, so
 * an embedding host can also `new Supervisor(...)` directly and keep the options object.
 */
export function createSupervisor(options: SupervisorOptions = {}): Supervisor {
  return new Supervisor(options);
}
