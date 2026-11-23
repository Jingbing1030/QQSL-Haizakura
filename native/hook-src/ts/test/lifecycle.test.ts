// Lifecycle / supervision tests.
//
// Every test here exists because a naive supervisor passes it. The three failures this
// suite is built to catch, in the order they have actually bitten this port:
//
//   1. `status()` reports `running` for a child that is dead. (Tested from both
//      directions: a component that reports its own crash, and one that dies silently
//      and is only caught by the liveness probe.)
//   2. `stop()` hangs forever because one component never resolves. (Tested with a
//      component whose `stop()` returns a promise that never settles.)
//   3. The supervisor installs process-wide signal handlers just by existing, so the
//      test runner accumulates listeners. (Tested by counting `process` listeners
//      before and after.)
//
// Timers are the reference's own numbers, shrunk: the restart delay floor is
// `MIN_RESTART_DELAY_MS = 250` (reference L4502) and the drain bound is 50-80 ms here
// instead of 10 s (reference L344987). No test sleeps longer than the delay it is
// asserting on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  DEFAULT_DRAIN_TIMEOUT_MS,
  DEFAULT_MAX_RESTART_ATTEMPTS,
  DEFAULT_RESTART_DELAY_MS,
  IllegalTransitionError,
  LifecycleStateError,
  MAX_DRAIN_TIMEOUT_MS,
  MIN_RESTART_DELAY_MS,
  Supervisor,
  canTransition,
  createSupervisor,
  parseDrainTimeoutMs,
  processSignalSource,
  resolveDrainTimeoutMs,
  resolveRestartDelayMs,
  type LifecycleState,
  type SignalSource,
  type SupervisedComponent,
  type SupervisorOptions,
} from "../src/host/lifecycle.js";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** A component that records every call, in order, and is alive until told otherwise. */
class FakeComponent implements SupervisedComponent {
  readonly name: string;
  readonly calls: string[] = [];
  alive = false;
  started = 0;
  stopped = 0;
  forced = 0;
  /** When set, `start()` rejects with this error. Cleared by `start()` itself if it is a
   *  one-shot (see `failNextStart`). */
  startError: unknown = null;
  /** Remaining `start()` failures before it succeeds. `0` = never fail. */
  failStartTimes = 0;
  /** When set, `stop()` returns this instead of resolving. */
  stopPromise: Promise<void> | null = null;
  /** When set, `stop()` rejects with this. */
  stopError: unknown = null;
  /** Probe override; `null` means "use `alive`". */
  private aliveOverride: boolean | null = null;
  transient: boolean | null = null;

  constructor(name: string) {
    this.name = name;
  }

  async start(): Promise<void> {
    this.calls.push("start");
    this.started += 1;
    if (this.failStartTimes > 0) {
      this.failStartTimes -= 1;
      throw this.startError ?? new Error(`${this.name} failed to start`);
    }
    this.alive = true;
  }

  stop(): Promise<void> {
    this.calls.push("stop");
    this.stopped += 1;
    if (this.stopError !== null) return Promise.reject(this.stopError);
    if (this.stopPromise !== null) return this.stopPromise;
    this.alive = false;
    return Promise.resolve();
  }

  forceStop(): void {
    this.calls.push("forceStop");
    this.forced += 1;
    this.alive = false;
  }

  isAlive(): boolean {
    return this.aliveOverride ?? this.alive;
  }

  isTransient(): boolean {
    return this.transient ?? true;
  }

  /** Simulate a death the supervisor has to notice on its own (no `reportCrash`). */
  dieSilently(): void {
    this.alive = false;
  }

  /** Simulate a death the component reports through the crash channel. */
  crash(): void {
    this.alive = false;
  }

  /** Force `isAlive()` to lie in either direction, for probe tests. */
  setProbe(value: boolean | null): void {
    this.aliveOverride = value;
  }
}

/** A component whose `stop()` never settles, and which records whether it was forced. */
function makeHungComponent(name: string): FakeComponent {
  const component = new FakeComponent(name);
  component.stopPromise = new Promise<void>(() => {
    /* deliberately never resolves */
  });
  return component;
}

/** A signal source that records subscriptions and lets a test fire them. */
class FakeSignals implements SignalSource {
  readonly calls: string[] = [];
  private readonly listeners = new Map<"SIGINT" | "SIGTERM", Set<() => void>>();

  on(signal: "SIGINT" | "SIGTERM", listener: () => void): () => void {
    this.calls.push(`on:${signal}`);
    const set = this.listeners.get(signal) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(signal, set);
    return () => {
      this.calls.push(`off:${signal}`);
      set.delete(listener);
    };
  }

  emit(signal: "SIGINT" | "SIGTERM"): void {
    for (const listener of [...(this.listeners.get(signal) ?? [])]) listener();
  }

  get installed(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Per-test ceiling.
 *
 * Not decoration: two of this module's properties are "an unbounded wait must not happen
 * here", so the *absence* of a bound shows up as a hang rather than as an assertion. A
 * hang consumed the whole 4-minute suite budget during mutation testing, which is
 * strictly worse than a red test — it reports nothing and blocks everything else. Every
 * test is given this ceiling so a regression fails in 2 s naming itself.
 *
 * The slowest legitimate test waits out a 250 ms restart delay twice plus polling, so
 * 2000 ms leaves a 3x margin while staying far under the suite budget.
 */
const TEST_TIMEOUT_MS = 2_000;

/**
 * Poll until `predicate` holds. Refuses to spin forever, so a regression shows up as a
 * failed assertion in ~2 s instead of a hung suite.
 */
async function until(predicate: () => boolean, message: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await tick(5);
  }
  assert.fail(`timed out waiting for: ${message}`);
}

function build(options: SupervisorOptions = {}): { supervisor: Supervisor; components: FakeComponent[] } {
  const components = [
    new FakeComponent("hook"),
    new FakeComponent("bridge"),
    new FakeComponent("listener"),
  ];
  const supervisor = new Supervisor({ components, ...options });
  return { supervisor, components };
}

// ---------------------------------------------------------------------------
// Constants — the reference's numbers, not invented ones
// ---------------------------------------------------------------------------

test("supervision constants match the reference exactly", { timeout: TEST_TIMEOUT_MS }, () => {
  // L4675 AUTO_LOAD_MAX_ATTEMPTS = 3
  assert.equal(DEFAULT_MAX_RESTART_ATTEMPTS, 3);
  // L4501 DEFAULT_INTERVAL_MS = 1500
  assert.equal(DEFAULT_RESTART_DELAY_MS, 1_500);
  // L4502 MIN_INTERVAL_MS = 250
  assert.equal(MIN_RESTART_DELAY_MS, 250);
  // L344987 DEFAULT_SESSION_RELEASE_DEADLINE_MS = 1e4
  assert.equal(DEFAULT_DRAIN_TIMEOUT_MS, 10_000);
  // L344989 MAX_SESSION_RELEASE_DEADLINE_MS = 2147483647
  assert.equal(MAX_DRAIN_TIMEOUT_MS, 2_147_483_647);
});

test("restart delay is fixed and floored at MIN_RESTART_DELAY_MS, never exponential", { timeout: TEST_TIMEOUT_MS }, () => {
  // L4520 `Math.max(MIN_INTERVAL_MS, deps.intervalMs ?? DEFAULT_INTERVAL_MS)`
  assert.equal(resolveRestartDelayMs(undefined), 1_500);
  assert.equal(resolveRestartDelayMs(1), 250, "below the floor is clamped up");
  assert.equal(resolveRestartDelayMs(250), 250);
  assert.equal(resolveRestartDelayMs(800), 800);
  // A fixed delay means the same value every time — no doubling, no jitter.
  const samples = [1, 2, 3, 4].map(() => resolveRestartDelayMs(400));
  assert.deepEqual(samples, [400, 400, 400, 400]);
});

test("drain timeout parsing ignores unusable values instead of coercing them", { timeout: TEST_TIMEOUT_MS }, () => {
  // L344992-L344998: absent / empty / non-numeric / zero / negative / too large → undefined
  assert.equal(parseDrainTimeoutMs(undefined), undefined);
  assert.equal(parseDrainTimeoutMs(""), undefined);
  assert.equal(parseDrainTimeoutMs("   "), undefined);
  assert.equal(parseDrainTimeoutMs("0"), undefined);
  assert.equal(parseDrainTimeoutMs("-5"), undefined);
  assert.equal(parseDrainTimeoutMs("1.5"), undefined);
  assert.equal(parseDrainTimeoutMs("abc"), undefined);
  assert.equal(parseDrainTimeoutMs("99999999999999999999"), undefined);
  assert.equal(parseDrainTimeoutMs("> MAX"), undefined);
  assert.equal(parseDrainTimeoutMs(String(MAX_DRAIN_TIMEOUT_MS + 1)), undefined);
  // A usable value passes through.
  assert.equal(parseDrainTimeoutMs("250"), 250);
  assert.equal(parseDrainTimeoutMs(` ${MAX_DRAIN_TIMEOUT_MS} `), MAX_DRAIN_TIMEOUT_MS);
});

test("env wins over the configured drain bound; an unusable env falls back", { timeout: TEST_TIMEOUT_MS }, () => {
  // L345000-L345006 `resolveSessionReleaseDeadlineMs`
  assert.equal(resolveDrainTimeoutMs(500, "900"), 900, "env wins");
  assert.equal(resolveDrainTimeoutMs(500, "bogus"), 500, "unusable env ignored");
  assert.equal(resolveDrainTimeoutMs(500, undefined), 500);
  assert.equal(resolveDrainTimeoutMs(undefined, undefined), DEFAULT_DRAIN_TIMEOUT_MS);
  assert.equal(resolveDrainTimeoutMs(0, undefined), DEFAULT_DRAIN_TIMEOUT_MS, "0 is not usable");
  assert.equal(resolveDrainTimeoutMs(-1, undefined), DEFAULT_DRAIN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// The transition table
// ---------------------------------------------------------------------------

test("the transition table encodes exactly the legal edges", { timeout: TEST_TIMEOUT_MS }, () => {
  const states: LifecycleState[] = ["stopped", "starting", "running", "stopping", "failed"];
  const legal: Record<LifecycleState, LifecycleState[]> = {
    stopped: ["starting"],
    starting: ["running", "stopping", "failed"],
    running: ["stopping", "failed"],
    stopping: ["stopped"],
    failed: ["starting", "stopping"],
  };
  for (const from of states) {
    for (const to of states) {
      assert.equal(
        canTransition(from, to),
        legal[from].includes(to),
        `${from} -> ${to} should be ${legal[from].includes(to) ? "legal" : "illegal"}`,
      );
    }
  }
});

test("every illegal edge throws IllegalTransitionError naming both states", { timeout: TEST_TIMEOUT_MS }, () => {
  const illegal: Array<[LifecycleState, LifecycleState]> = [
    ["stopped", "running"],
    ["stopped", "stopping"],
    ["stopped", "failed"],
    ["running", "starting"],
    ["running", "stopped"],
    ["stopping", "running"],
    ["stopping", "starting"],
    ["stopping", "failed"],
    ["failed", "running"],
    ["failed", "stopped"],
    ["starting", "stopped"],
  ];
  for (const [from, to] of illegal) {
    const error = new IllegalTransitionError(from, to);
    assert.ok(error instanceof IllegalTransitionError);
    assert.equal(error.from, from);
    assert.equal(error.to, to);
    assert.match(error.message, new RegExp(`${from} -> ${to}`));
  }
});

test("the state machine — not an ad-hoc guard — is what refuses a double start", { timeout: TEST_TIMEOUT_MS }, async () => {
  // This test exists because of a survived mutation. `start()` used to pre-check
  // `current` with its own `if`, which made `transition()`'s throw unreachable and
  // therefore decorative: deleting the throw broke nothing. `start()` now calls
  // `transition("starting")` and only *translates* its error, so the machine is
  // load-bearing. Driving the refusal through two different public paths proves it.
  const component = new FakeComponent("slow-stop");
  const supervisor = new Supervisor({ components: [component], drainTimeoutMs: 5_000 });
  await supervisor.start();

  // (a) from `running`
  await assert.rejects(
    () => supervisor.start(),
    (error: unknown) => {
      assert.ok(error instanceof LifecycleStateError);
      assert.match(error.message, /already running/);
      return true;
    },
  );

  // (b) from `stopping` — a different edge, refilled by the same table lookup.
  let release: (() => void) | undefined;
  component.stopPromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stopping = supervisor.stop();
  assert.equal(supervisor.state, "stopping");

  await assert.rejects(
    () => supervisor.start(),
    (error: unknown) => {
      assert.ok(error instanceof LifecycleStateError);
      assert.match(error.message, /stopping/);
      return true;
    },
  );

  release?.();
  await stopping;
  assert.equal(supervisor.status().state, "stopped");
});

// ---------------------------------------------------------------------------
// 1. Normal start/stop
// ---------------------------------------------------------------------------

test("start brings components up in declaration order and reports running", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build({ drainTimeoutMs: 200 });

  assert.equal(supervisor.status().state, "stopped");

  const result = await supervisor.start();
  assert.equal(result.started, true);
  assert.deepEqual(result.errors, []);
  assert.equal(supervisor.status().state, "running");
  assert.equal(supervisor.state, "running");
  assert.equal(supervisor.accepting, true);

  // Declaration order is a dependency order: hook, then bridge, then listeners.
  assert.deepEqual(
    components.map((component) => component.calls),
    [["start"], ["start"], ["start"]],
  );
  assert.deepEqual(
    supervisor.status().components.map((component) => component.state),
    ["running", "running", "running"],
  );
  assert.ok(supervisor.status().components.every((component) => component.alive));
});

test("stop drains in reverse declaration order and reports stopped", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build({ drainTimeoutMs: 200 });
  await supervisor.start();

  const result = await supervisor.stop();
  assert.equal(result.stopped, true);
  assert.deepEqual(result.timedOut, [], "a cooperative drain forces nothing");
  assert.deepEqual(result.errors, []);
  assert.equal(supervisor.status().state, "stopped");
  assert.equal(supervisor.accepting, false);

  // Reverse order: the last listener up is the first one down.
  assert.deepEqual(
    components.map((component) => component.calls),
    [["start", "stop"], ["start", "stop"], ["start", "stop"]],
  );
  assert.ok(components.every((component) => component.stopped === 1));
  assert.ok(components.every((component) => component.forced === 0), "no force-close needed");
});

test("start-stop-start-stop works; the second cycle is not treated as a no-op", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build({ drainTimeoutMs: 200 });

  await supervisor.start();
  await supervisor.stop();
  await supervisor.start();
  assert.equal(supervisor.status().state, "running");
  await supervisor.stop();

  assert.equal(supervisor.status().state, "stopped");
  assert.ok(components.every((component) => component.started === 2));
  assert.ok(components.every((component) => component.stopped === 2));
});

// ---------------------------------------------------------------------------
// 2. Double start
// ---------------------------------------------------------------------------

test("double start rejects with LifecycleStateError and does not start twice", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build({ drainTimeoutMs: 200 });

  await supervisor.start();
  await assert.rejects(
    () => supervisor.start(),
    (error: unknown) => {
      assert.ok(error instanceof LifecycleStateError, `expected LifecycleStateError, got ${String(error)}`);
      assert.match(error.message, /already running/);
      return true;
    },
  );

  // The rejection must not have touched the components.
  assert.ok(components.every((component) => component.started === 1));
  assert.equal(supervisor.status().state, "running");
});

test("a concurrent start while starting is rejected, not queued", { timeout: TEST_TIMEOUT_MS }, async () => {
  const gate = new FakeComponent("slow");
  let release: (() => void) | undefined;
  const original = gate.start.bind(gate);
  gate.start = async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await original();
  };

  const supervisor = new Supervisor({ components: [gate], drainTimeoutMs: 200 });
  const first = supervisor.start();
  assert.equal(supervisor.status().state, "starting");

  await assert.rejects(
    () => supervisor.start(),
    (error: unknown) => {
      assert.ok(error instanceof LifecycleStateError);
      assert.match(error.message, /already starting/);
      return true;
    },
  );

  release?.();
  await first;
  assert.equal(gate.started, 1);
  await supervisor.stop();
});

// ---------------------------------------------------------------------------
// 3. Double stop (idempotent)
// ---------------------------------------------------------------------------

test("double stop resolves with the same result and stops components once", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build({ drainTimeoutMs: 200 });
  await supervisor.start();

  const first = supervisor.stop();
  const second = supervisor.stop();
  assert.equal(first, second, "a concurrent stop() must share the in-flight promise");

  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.stopped, true);
  assert.equal(b, a, "both callers see the same result object");

  // A third stop after the fact is a no-op that still reports success.
  const third = await supervisor.stop();
  assert.equal(third.stopped, true);
  assert.deepEqual(third.timedOut, []);

  assert.ok(components.every((component) => component.stopped === 1), "stop() must not run twice");
  assert.equal(supervisor.status().state, "stopped");
});

test("stop on a supervisor that never started resolves without touching components", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build();
  const result = await supervisor.stop();
  assert.equal(result.stopped, true);
  assert.deepEqual(result.timedOut, []);
  assert.deepEqual(result.errors, []);
  assert.equal(supervisor.status().state, "stopped");
  assert.ok(components.every((component) => component.calls.length === 0));
});

test("stop while stopping rejects a new start instead of racing the drain", { timeout: TEST_TIMEOUT_MS }, async () => {
  const component = new FakeComponent("slow-stop");
  const supervisor = new Supervisor({ components: [component], drainTimeoutMs: 5_000 });
  await supervisor.start();

  let release: (() => void) | undefined;
  component.stopPromise = new Promise<void>((resolve) => {
    release = resolve;
  });

  const stopping = supervisor.stop();
  assert.equal(supervisor.status().state, "stopping");

  await assert.rejects(
    () => supervisor.start(),
    (error: unknown) => {
      assert.ok(error instanceof LifecycleStateError);
      assert.match(error.message, /stopping/);
      return true;
    },
  );

  release?.();
  await stopping;
  assert.equal(supervisor.status().state, "stopped");
});

// ---------------------------------------------------------------------------
// 4. Stop during start
// ---------------------------------------------------------------------------

test("stop during start unwinds what came up and never reports running", { timeout: TEST_TIMEOUT_MS }, async () => {
  const first = new FakeComponent("hook");
  const second = new FakeComponent("bridge");
  let releaseGate: (() => void) | undefined;

  // The second component's start blocks until the test releases it, which is the window
  // where a stop() can arrive.
  const originalStart = second.start.bind(second);
  second.start = async () => {
    await new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    await originalStart();
  };

  const supervisor = new Supervisor({
    components: [first, second],
    drainTimeoutMs: 500,
  });

  const starting = supervisor.start();
  await until(() => releaseGate !== undefined, "the second component to reach its gate");

  const stopping = supervisor.stop();
  releaseGate?.();

  const startResult = await starting;
  assert.equal(startResult.started, false, "a cancelled start must not report success");

  const stopResult = await stopping;
  assert.equal(stopResult.stopped, true);
  assert.equal(supervisor.status().state, "stopped");

  // Whatever did come up must have been taken back down: no orphaned listener.
  assert.equal(first.stopped, 1, "the component that finished starting must be stopped");
  assert.equal(first.alive, false);
  assert.equal(second.alive, false);
});

test("stop during a start that never resolves still completes inside the drain bound", { timeout: TEST_TIMEOUT_MS }, async () => {
  const hung = new FakeComponent("hung-start");
  hung.start = () => new Promise<void>(() => { /* never resolves */ });

  const supervisor = new Supervisor({ components: [hung], drainTimeoutMs: 60 });

  void supervisor.start();
  await until(() => supervisor.status().state === "starting", "the supervisor to be starting");

  const startedAt = Date.now();
  const result = await supervisor.stop();
  const elapsed = Date.now() - startedAt;

  assert.equal(result.stopped, true);
  assert.deepEqual(result.timedOut, ["hung-start"], "the hung start must be forced");
  assert.ok(elapsed < 1_000, `stop() must be bounded by the drain timeout, took ${elapsed}ms`);
  assert.equal(hung.forced, 1, "forceStop is the escape hatch for a hung start");
  assert.equal(supervisor.status().state, "stopped");
});

// ---------------------------------------------------------------------------
// 5. Crash -> restart
// ---------------------------------------------------------------------------

test("a reported crash restarts the component after the fixed delay and returns to running", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build({ drainTimeoutMs: 200, restartDelayMs: MIN_RESTART_DELAY_MS });
  await supervisor.start();

  const bridge = components[1];
  assert.ok(bridge !== undefined);
  bridge.crash();
  supervisor.reportCrash("bridge", new Error("socket closed"));

  // Immediately after the crash the status must NOT claim running.
  assert.equal(supervisor.status().state, "failed");
  const failedStatus = supervisor.status();
  assert.equal(failedStatus.failure?.component, "bridge");
  assert.equal(failedStatus.failure?.message, "socket closed");
  assert.equal(failedStatus.failure?.exhausted, false);
  assert.equal(failedStatus.failure?.detectedBy, "crash");

  // Then the fixed-delay timer fires and the component comes back.
  await until(() => supervisor.status().state === "running", "the supervisor to recover");
  assert.equal(bridge.started, 2, "one initial start plus one restart");
  assert.equal(
    supervisor.status().components[1]?.restarts,
    1,
    "the component's restart counter is per-component",
  );
  assert.equal(supervisor.status().restarts, 1);
  assert.equal(supervisor.status().failure, undefined, "a recovered supervisor carries no failure");

  await supervisor.stop();
});

test("a restart takes the supervisor through starting, never straight back to running", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build({
    drainTimeoutMs: 200,
    restartDelayMs: MIN_RESTART_DELAY_MS,
  });
  await supervisor.start();

  // Deterministic observation: hook the component's own `start()` so we sample the
  // supervisor's state at the exact moment the restart begins. A polling loop would race
  // the (sub-millisecond) `starting -> running` edge and produce a flaky test.
  const hook = components[0];
  assert.ok(hook !== undefined);
  const originalStart = hook.start.bind(hook);
  const observed: LifecycleState[] = [];
  hook.start = async () => {
    observed.push(supervisor.status().state);
    await originalStart();
  };

  hook.crash();
  supervisor.reportCrash("hook", new Error("boom"));

  // The crash is reported synchronously, before any timer can fire.
  assert.equal(supervisor.status().state, "failed");

  await until(() => supervisor.status().state === "running", "recovery");
  assert.deepEqual(
    observed,
    ["starting"],
    "the restart must be reported as `starting`, not as `running` the whole time",
  );

  await supervisor.stop();
});

test("crash reports are deduplicated while a restart is pending", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build({ drainTimeoutMs: 200, restartDelayMs: 200 });
  await supervisor.start();

  const hook = components[0];
  assert.ok(hook !== undefined);
  hook.crash();
  supervisor.reportCrash("hook", new Error("first"));
  // A chatty component must not burn the budget twice for one death.
  supervisor.reportCrash("hook", new Error("second"));
  supervisor.reportCrash("hook", new Error("third"));

  const status = supervisor.status();
  assert.equal(status.state, "failed");
  assert.equal(status.components[0]?.attempts, 1, "one attempt, not three");

  await until(() => supervisor.status().state === "running", "recovery");
  assert.equal(hook.started, 2);

  await supervisor.stop();
});

test("reportCrash for an unknown component throws rather than silently doing nothing", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor } = build({ drainTimeoutMs: 200 });
  await supervisor.start();
  assert.throws(
    () => supervisor.reportCrash("nope"),
    (error: unknown) => {
      assert.ok(error instanceof LifecycleStateError);
      assert.match(error.message, /unknown supervised component: nope/);
      return true;
    },
  );
  await supervisor.stop();
});

test("a permanent failure abandons the restart budget immediately", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build({ drainTimeoutMs: 200, restartDelayMs: MIN_RESTART_DELAY_MS });
  await supervisor.start();

  const bridge = components[1];
  assert.ok(bridge !== undefined);
  // L4947 / L5029: not a transient libc-mapping error, so no retry at all.
  bridge.transient = false;
  bridge.crash();
  supervisor.reportCrash("bridge", new Error("target process does not map /lib/libc.so.6 while resolving mmap"));

  const status = supervisor.status();
  assert.equal(status.state, "failed");
  assert.equal(status.failure?.exhausted, false, "a permanent failure is not budget exhaustion");
  assert.match(status.failure?.message ?? "", /libc\.so\.6/);

  // No timer was armed: waiting longer than the restart delay changes nothing.
  await tick(MIN_RESTART_DELAY_MS + 60);
  assert.equal(bridge.started, 1, "a permanent failure must not be retried");
  assert.equal(supervisor.status().state, "failed");

  await supervisor.stop();
});

test("restartOnCrash: false reports the crash as failed without restarting", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build({
    drainTimeoutMs: 200,
    restartDelayMs: MIN_RESTART_DELAY_MS,
    restartOnCrash: false,
  });
  await supervisor.start();

  const hook = components[0];
  assert.ok(hook !== undefined);
  hook.crash();
  supervisor.reportCrash("hook", new Error("no restart wanted"));

  assert.equal(supervisor.status().state, "failed");
  await tick(MIN_RESTART_DELAY_MS + 60);
  assert.equal(hook.started, 1);
  assert.equal(supervisor.status().state, "failed");

  await supervisor.stop();
});

// ---------------------------------------------------------------------------
// 6. Restart-budget exhaustion -> failed
// ---------------------------------------------------------------------------

test("restart budget exhaustion ends in failed with exhausted: true after 3 attempts", { timeout: TEST_TIMEOUT_MS }, async () => {
  const flaky = new FakeComponent("flaky");
  // The initial start succeeds; every restart fails. That is the reference's
  // "attempts=3" — the initial start plus two restarts (L4919, L4952).
  flaky.failStartTimes = 0;
  const supervisor = new Supervisor({
    components: [flaky],
    drainTimeoutMs: 200,
    restartDelayMs: MIN_RESTART_DELAY_MS,
    maxRestartAttempts: DEFAULT_MAX_RESTART_ATTEMPTS,
  });
  await supervisor.start();
  assert.equal(flaky.started, 1);

  // From now on, start() always throws.
  flaky.failStartTimes = 99;
  flaky.crash();
  supervisor.reportCrash("flaky", new Error("crash 1"));

  await until(
    () => supervisor.status().failure?.exhausted === true,
    "the restart budget to run out",
  );

  const status = supervisor.status();
  assert.equal(status.state, "failed");
  assert.equal(status.failure?.exhausted, true);
  assert.equal(status.failure?.component, "flaky");
  assert.equal(
    flaky.started,
    1 + 2,
    "3 total attempts: the initial start plus two restarts",
  );

  // Exhaustion is terminal: nothing re-arms it.
  await tick(MIN_RESTART_DELAY_MS + 80);
  assert.equal(flaky.started, 3, "no further attempts after exhaustion");
  assert.equal(supervisor.status().state, "failed");

  // A failed supervisor still shuts down cleanly.
  const stopResult = await supervisor.stop();
  assert.equal(stopResult.stopped, true);
  assert.equal(supervisor.status().state, "stopped");
});

test("a recovered component earns a fresh budget", { timeout: TEST_TIMEOUT_MS }, async () => {
  const flaky = new FakeComponent("recovering");
  const supervisor = new Supervisor({
    components: [flaky],
    drainTimeoutMs: 200,
    restartDelayMs: MIN_RESTART_DELAY_MS,
    maxRestartAttempts: 3,
  });
  await supervisor.start();

  // Burn two attempts, then recover: L4930 deletes the record on success.
  for (let round = 1; round <= 2; round += 1) {
    flaky.failStartTimes = 1;
    flaky.crash();
    supervisor.reportCrash("recovering", new Error(`crash ${round}`));
    await until(() => supervisor.status().state === "running", `recovery ${round}`);
  }

  assert.equal(supervisor.status().state, "running");
  assert.equal(
    supervisor.status().components[0]?.restarts,
    2,
    "two restarts, and the budget was not exhausted",
  );

  // A third crash still gets a retry, because success reset the counter.
  flaky.failStartTimes = 1;
  flaky.crash();
  supervisor.reportCrash("recovering", new Error("crash 3"));
  await until(() => supervisor.status().state === "running", "recovery 3");
  assert.equal(supervisor.status().components[0]?.restarts, 3);

  await supervisor.stop();
});

// ---------------------------------------------------------------------------
// 7. Shutdown timeout — a hung component must never hang shutdown
// ---------------------------------------------------------------------------

test("a component whose stop() never resolves is force-closed at the drain deadline", { timeout: TEST_TIMEOUT_MS }, async () => {
  const healthy = new FakeComponent("hook");
  const hung = makeHungComponent("listener");

  const supervisor = new Supervisor({ components: [healthy, hung], drainTimeoutMs: 60 });
  await supervisor.start();
  assert.equal(supervisor.status().state, "running");

  const startedAt = Date.now();
  const result = await supervisor.stop();
  const elapsed = Date.now() - startedAt;

  assert.equal(result.stopped, true);
  assert.deepEqual(result.timedOut, ["listener"], "the hung component is named");
  assert.ok(elapsed >= 50, `stop() must actually wait for the deadline, took ${elapsed}ms`);
  assert.ok(elapsed < 1_000, `stop() must be bounded, took ${elapsed}ms`);

  // The escape hatch ran, and the supervisor still reached `stopped`.
  assert.equal(hung.forced, 1, "forceStop must be called on a timed-out component");
  assert.equal(healthy.forced, 0, "a component that drained cleanly is not force-closed");
  assert.equal(supervisor.status().state, "stopped");
});

test("a hung component with no forceStop still lets stop() finish", { timeout: TEST_TIMEOUT_MS }, async () => {
  const hung = new FakeComponent("no-escape-hatch");
  hung.stopPromise = new Promise<void>(() => { /* never */ });
  delete (hung as { forceStop?: unknown }).forceStop;

  const supervisor = new Supervisor({ components: [hung], drainTimeoutMs: 40 });
  await supervisor.start();

  const startedAt = Date.now();
  const result = await supervisor.stop();
  assert.equal(result.stopped, true);
  assert.ok(Date.now() - startedAt < 1_000, "stop() must never hang");
  assert.deepEqual(result.timedOut, ["no-escape-hatch"]);
  assert.equal(supervisor.status().state, "stopped");
});

test("a rejecting stop() is recorded, not rethrown, and the others still stop", { timeout: TEST_TIMEOUT_MS }, async () => {
  const a = new FakeComponent("a");
  const b = new FakeComponent("b");
  const c = new FakeComponent("c");
  b.stopError = new Error("listener close failed");

  const supervisor = new Supervisor({ components: [a, b, c], drainTimeoutMs: 300 });
  await supervisor.start();

  const result = await supervisor.stop();
  // L374244-L374288: each component is disposed in its own try/catch, so one failure
  // cannot skip the rest.
  assert.equal(result.stopped, true);
  assert.deepEqual(
    result.errors.map((error) => error.name),
    ["b"],
  );
  assert.match(result.errors[0]?.message ?? "", /listener close failed/);
  assert.equal(a.stopped, 1, "a stopped before b failed");
  assert.equal(c.stopped, 1, "c stopped despite b failing");
  assert.equal(supervisor.status().state, "stopped");
});

test("a forceStop that throws is recorded without aborting the rest of shutdown", { timeout: TEST_TIMEOUT_MS }, async () => {
  const hung = makeHungComponent("exploding-force");
  hung.forceStop = () => {
    throw new Error("forceStop exploded");
  };

  const supervisor = new Supervisor({ components: [hung], drainTimeoutMs: 40 });
  await supervisor.start();

  const result = await supervisor.stop();
  assert.equal(result.stopped, true);
  assert.deepEqual(result.timedOut, ["exploding-force"]);
  assert.match(result.errors[0]?.message ?? "", /forceStop exploded/);
  assert.equal(supervisor.status().state, "stopped");
});

// ---------------------------------------------------------------------------
// 8. status() honesty — never running while a child is dead
// ---------------------------------------------------------------------------

test("status() reports failed when a child dies silently and never calls reportCrash", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build({ drainTimeoutMs: 200 });
  await supervisor.start();
  assert.equal(supervisor.status().state, "running");

  // No crash report at all — the supervisor's own belief is still `running`.
  components[2]?.dieSilently();
  assert.equal(supervisor.state, "running", "internal state has not been told");

  const status = supervisor.status();
  assert.equal(status.state, "failed", "status() must not repeat the internal lie");
  assert.equal(status.failure?.component, "listener");
  assert.equal(status.failure?.detectedBy, "probe");
  assert.equal(status.failure?.message, "component is not alive");
  assert.equal(status.components[2]?.state, "failed");
  assert.equal(status.components[2]?.alive, false);
  assert.equal(status.components[2]?.error, "component is not alive");
  // The healthy components are still reported as running.
  assert.deepEqual(
    status.components.map((component) => component.state),
    ["running", "running", "failed"],
  );
  assert.equal(supervisor.isHealthy(), false);
});

test("reconcileHealth() notices a silent death and restarts it", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build({ drainTimeoutMs: 200, restartDelayMs: MIN_RESTART_DELAY_MS });
  await supervisor.start();

  const bridge = components[1];
  assert.ok(bridge !== undefined);
  bridge.dieSilently();

  supervisor.reconcileHealth();
  assert.equal(supervisor.status().state, "failed");
  assert.equal(supervisor.status().failure?.detectedBy, "probe");

  await until(() => supervisor.status().state === "running", "recovery after a silent death");
  assert.equal(bridge.started, 2);
  await supervisor.stop();
});

test("reconcileHealth() is inert unless the supervisor believes it is running", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build({ drainTimeoutMs: 200 });
  // Never started: every component is `pending`, so nothing is probed or restarted.
  supervisor.reconcileHealth();
  assert.equal(supervisor.status().state, "stopped");
  assert.ok(components.every((component) => component.calls.length === 0));
});

test("start() reports the failing component and leaves the others untouched", { timeout: TEST_TIMEOUT_MS }, async () => {
  const hook = new FakeComponent("hook");
  const bridge = new FakeComponent("bridge");
  const listener = new FakeComponent("listener");
  bridge.failStartTimes = 1;

  const supervisor = new Supervisor({ components: [hook, bridge, listener], drainTimeoutMs: 200 });
  const result = await supervisor.start();

  assert.equal(result.started, false);
  assert.deepEqual(result.errors.map((error) => error.name), ["bridge"]);

  const status = supervisor.status();
  assert.equal(status.state, "failed");
  assert.equal(status.failure?.component, "bridge");
  assert.equal(status.failure?.detectedBy, "start");
  assert.match(status.failure?.message ?? "", /bridge failed to start/);
  assert.equal(listener.started, 0, "a failed dependency must not be followed by its dependents");

  // The half-started supervisor still shuts down cleanly.
  const stopResult = await supervisor.stop();
  assert.equal(stopResult.stopped, true);
  assert.equal(hook.stopped, 1, "the component that did start is stopped");
  assert.equal(supervisor.status().state, "stopped");
});

test("a throwing liveness probe is treated as dead, not as healthy", { timeout: TEST_TIMEOUT_MS }, async () => {
  const component = new FakeComponent("liar");
  const supervisor = new Supervisor({ components: [component], drainTimeoutMs: 200 });
  await supervisor.start();
  assert.equal(supervisor.status().state, "running");

  component.isAlive = () => {
    throw new Error("probe exploded");
  };

  const status = supervisor.status();
  assert.equal(status.state, "failed", "an unreadable probe cannot be assumed healthy");
  assert.equal(status.components[0]?.alive, false);
  await supervisor.stop();
});

test("status() is a pure read — calling it does not change state or schedule work", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build({ drainTimeoutMs: 200 });
  await supervisor.start();
  components[0]?.dieSilently();

  const first = supervisor.status();
  const second = supervisor.status();
  assert.equal(first.state, "failed");
  assert.equal(second.state, "failed");
  assert.equal(supervisor.state, "running", "a read must not mutate the machine");
  assert.ok(components.every((component) => component.started === 1), "a read must not restart");
  await supervisor.stop();
});

// ---------------------------------------------------------------------------
// 9. Injectable signals — no real handler installed by tests
// ---------------------------------------------------------------------------

test("constructing and stopping a supervisor installs no real process signal handler", { timeout: TEST_TIMEOUT_MS }, async () => {
  // A real `process.on` call in a test is a leak: it survives the test, changes
  // `process.listenerCount` for the whole runner, and can fire during an unrelated test.
  const before = {
    SIGINT: process.listenerCount("SIGINT"),
    SIGTERM: process.listenerCount("SIGTERM"),
  };

  const { supervisor } = build({ drainTimeoutMs: 200 });
  await supervisor.start();
  await supervisor.stop();
  await supervisor.start();
  await supervisor.stop();

  assert.equal(process.listenerCount("SIGINT"), before.SIGINT, "SIGINT listeners must not change");
  assert.equal(process.listenerCount("SIGTERM"), before.SIGTERM, "SIGTERM listeners must not change");
});

test("no signals option means no subscription at all", { timeout: TEST_TIMEOUT_MS }, async () => {
  const signals = new FakeSignals();
  // Deliberately not passed: the supervisor must not reach for the real process.
  const supervisor = new Supervisor({ components: [new FakeComponent("hook")] });
  assert.deepEqual(signals.calls, []);
  await supervisor.start();
  await supervisor.stop();
  assert.deepEqual(signals.calls, []);
});

test("injected signal source receives SIGINT and SIGTERM, and is disposed on stop", { timeout: TEST_TIMEOUT_MS }, async () => {
  const signals = new FakeSignals();
  const { supervisor } = build({ drainTimeoutMs: 200, signals });

  assert.deepEqual(signals.calls, ["on:SIGINT", "on:SIGTERM"]);
  assert.equal(signals.installed, 2);

  await supervisor.start();
  assert.equal(supervisor.status().state, "running");

  signals.emit("SIGINT");
  await until(() => supervisor.status().state === "stopped", "SIGINT to trigger shutdown");

  assert.equal(signals.installed, 0, "handlers must be dropped once stopped");
  assert.deepEqual(signals.calls, ["on:SIGINT", "on:SIGTERM", "off:SIGINT", "off:SIGTERM"]);
});

test("SIGTERM and SIGINT both shut down, and a second signal is harmless", { timeout: TEST_TIMEOUT_MS }, async () => {
  const signals = new FakeSignals();
  const { supervisor } = build({ drainTimeoutMs: 200, signals });
  await supervisor.start();

  signals.emit("SIGTERM");
  signals.emit("SIGINT");
  signals.emit("SIGTERM");

  await until(() => supervisor.status().state === "stopped", "the first signal to win");
  // No unhandled rejection, no double stop.
  assert.equal(supervisor.status().state, "stopped");
});

test("processSignalSource wraps process.on and unsubscribes cleanly", { timeout: TEST_TIMEOUT_MS }, () => {
  // Uses a private emitter rather than `process`, so this test installs nothing global.
  const emitter = new EventEmitter();
  const source = processSignalSource(emitter);

  const seen: string[] = [];
  const dispose = source.on("SIGINT", () => seen.push("sigint"));
  assert.equal(emitter.listenerCount("SIGINT"), 1);
  emitter.emit("SIGINT");
  assert.deepEqual(seen, ["sigint"]);

  dispose();
  assert.equal(emitter.listenerCount("SIGINT"), 0);
  emitter.emit("SIGINT");
  assert.deepEqual(seen, ["sigint"], "a disposed handler must not fire");
});

// ---------------------------------------------------------------------------
// 10. Construction / factory
// ---------------------------------------------------------------------------

test("duplicate component names are rejected at construction", { timeout: TEST_TIMEOUT_MS }, () => {
  assert.throws(
    () => new Supervisor({ components: [new FakeComponent("same"), new FakeComponent("same")] }),
    (error: unknown) => {
      assert.ok(error instanceof LifecycleStateError);
      assert.match(error.message, /names must be unique/);
      return true;
    },
  );
});

test("createSupervisor builds a working supervisor with the same contract", { timeout: TEST_TIMEOUT_MS }, async () => {
  const supervisor = createSupervisor({
    components: [new FakeComponent("hook")],
    drainTimeoutMs: 200,
  });
  assert.equal(supervisor.status().state, "stopped");
  await supervisor.start();
  assert.equal(supervisor.status().state, "running");
  await supervisor.stop();
  assert.equal(supervisor.status().state, "stopped");
});

test("restartDelayMs below the reference floor is clamped, not honoured", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor } = build({ drainTimeoutMs: 200, restartDelayMs: 1 });
  // The clamp is what makes a 1 ms restart delay impossible: the reference's floor is
  // MIN_INTERVAL_MS = 250 (L4502), and a supervisor must not busy-loop.
  assert.equal(resolveRestartDelayMs(1), MIN_RESTART_DELAY_MS);
  await supervisor.start();
  await supervisor.stop();
});

test("supervisor status is serialisable — the WebUI can render it directly", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { supervisor, components } = build({ drainTimeoutMs: 200 });
  await supervisor.start();
  components[1]?.dieSilently();

  const status = supervisor.status();
  const round = JSON.parse(JSON.stringify(status)) as typeof status;
  assert.equal(round.state, "failed");
  assert.equal(round.components.length, 3);
  assert.equal(typeof round.since, "number");
  assert.equal(typeof round.restarts, "number");
  await supervisor.stop();
});
