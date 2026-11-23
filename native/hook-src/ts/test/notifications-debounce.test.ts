// Tests for the notification debounce state machine.
//
// The machine has no I/O and no clock, so these are exhaustive over the
// transition table rather than illustrative: every (state × input) pair is one
// test. What is worth pinning, and why:
//
//   1. **`debounceSeconds <= 0` emits synchronously.** A zero-delay `setTimeout`
//      would also "work", so a test that only checked the eventual outcome would
//      pass with the timer moved into the caller. The decision kind (`emit` vs
//      `schedule`) is the contract the manager switches on.
//   2. **A repeated offline collapses to one.** Two hook processes dying for one
//      account must not produce two notifications — that is the whole reason the
//      machine exists.
//   3. **`onTimerElapsed` is guarded on `pending`, not on the timer.** A reconnect
//      in the same tick as expiry must not emit an `offline` after the `online`;
//      `clearTimeout` cannot un-queue a callback that has already been scheduled.
//   4. **`onOnline` with no prior state is `none`.** A bot that starts online (the
//      common case — the first event is `started`) must not fire an "online"
//      notification at every boot.
//
// Line numbers in test names are `reference/index.mjs` positions.

import { test } from "node:test";
import assert from "node:assert/strict";

import { DebounceMachine } from "../src/notifications/debounce.js";

const UIN = "10001";

test("L348504 onOffline with no debounce emits immediately and records the state", () => {
  const machine = new DebounceMachine();
  assert.deepEqual(machine.onOffline(UIN, 0), { kind: "emit", event: "offline" });
  // The state matters: without it the next offline would emit a second notification.
  assert.deepEqual(machine.onOffline(UIN, 0), { kind: "none" });
});

test("L348506 a negative debounce behaves like zero (config clamp allows 0, not <0)", () => {
  const machine = new DebounceMachine();
  assert.deepEqual(machine.onOffline(UIN, -5), { kind: "emit", event: "offline" });
});

test("L348506 a non-finite debounce emits immediately rather than arming a NaN timer", () => {
  const machine = new DebounceMachine();
  assert.deepEqual(machine.onOffline(UIN, Number.NaN), { kind: "emit", event: "offline" });
  assert.deepEqual(machine.onOffline("10002", Number.POSITIVE_INFINITY), { kind: "emit", event: "offline" });
});

test("L348513 a positive debounce schedules the window in milliseconds", () => {
  const machine = new DebounceMachine();
  assert.deepEqual(machine.onOffline(UIN, 30), { kind: "schedule", delayMs: 30_000 });
  // A fractional window is legal (the config clamps to an int, but the machine is
  // not the clamp) and must convert to ms without rounding.
  assert.deepEqual(machine.onOffline("10002", 1.5), { kind: "schedule", delayMs: 1_500 });
});

test("L348505 a second offline while pending is a no-op — flapping collapses to one", () => {
  const machine = new DebounceMachine();
  machine.onOffline(UIN, 30);
  assert.deepEqual(machine.onOffline(UIN, 30), { kind: "none" });
  assert.deepEqual(machine.onOffline(UIN, 0), { kind: "none" });
});

test("L348523 online inside the window cancels the pending offline", () => {
  const machine = new DebounceMachine();
  machine.onOffline(UIN, 30);
  assert.deepEqual(machine.onOnline(UIN), { kind: "cancel" });
  // After the cancel the account is back to "no edge seen", so a later offline is a
  // fresh transition rather than a continuation.
  assert.deepEqual(machine.onOffline(UIN, 30), { kind: "schedule", delayMs: 30_000 });
});

test("L348526 online after a fired offline emits the online edge", () => {
  const machine = new DebounceMachine();
  machine.onOffline(UIN, 0);
  assert.deepEqual(machine.onOnline(UIN), { kind: "emit", event: "online" });
});

test("L348528 online with no prior edge is none — a boot must not notify", () => {
  const machine = new DebounceMachine();
  assert.deepEqual(machine.onOnline(UIN), { kind: "none" });
});

test("L348531 the timer fires the pending offline exactly once", () => {
  const machine = new DebounceMachine();
  machine.onOffline(UIN, 30);
  assert.deepEqual(machine.onTimerElapsed(UIN), { kind: "emit", event: "offline" });
  assert.deepEqual(machine.onTimerElapsed(UIN), { kind: "none" });
});

test("L348532 a timer that fires after a cancel is ignored (the clearTimeout race)", () => {
  const machine = new DebounceMachine();
  machine.onOffline(UIN, 30);
  machine.onOnline(UIN);
  // This is the callback that `clearTimeout` could not un-queue.
  assert.deepEqual(machine.onTimerElapsed(UIN), { kind: "none" });
});

test("L348532 a timer that fires for an account with no state is ignored", () => {
  const machine = new DebounceMachine();
  assert.deepEqual(machine.onTimerElapsed("99999"), { kind: "none" });
});

test("states are per-UIN — one account flapping does not silence another", () => {
  const machine = new DebounceMachine();
  machine.onOffline("10001", 30);
  assert.deepEqual(machine.onOffline("10002", 0), { kind: "emit", event: "offline" });
  assert.deepEqual(machine.onOnline("10002"), { kind: "emit", event: "online" });
  assert.deepEqual(machine.onTimerElapsed("10001"), { kind: "emit", event: "offline" });
});
