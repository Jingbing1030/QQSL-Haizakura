// Session, snapshot and receipt policy tests.
//
// These lean on the failure cases rather than the happy path. Each module here exists because
// a naive version returns something that looks valid, so a test that only checks the success
// path would pass against an implementation with none of the checks.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareSession,
  readStableSnapshot,
  ReceiptTable,
  checkChannelOp,
  PolicyError,
  type SessionIdentity,
} from "../src/session.js";

const noSleep = { sleep: async () => {} };

test("an unchanged session compares equal", () => {
  const a: SessionIdentity = { pid: 100, uin: "3083456343", generation: 1 };
  assert.equal(compareSession(a, { ...a }), null);
});

test("a replaced process is reported as a new session, not a new account", () => {
  // A supervisor can restart QQ inside the same pid, so pid equality is not identity. The
  // generation is what distinguishes them, and the two failures want different handling:
  // every cached field is stale, versus every queued operation is misaddressed.
  const before: SessionIdentity = { pid: 100, uin: "3083456343", generation: 1 };
  assert.equal(compareSession(before, { pid: 100, uin: "3083456343", generation: 2 }),
    "session-identity-changed");
  assert.equal(compareSession(before, { pid: 101, uin: "3083456343", generation: 1 }),
    "session-identity-changed");
});

test("a different account is reported separately", () => {
  const before: SessionIdentity = { pid: 100, uin: "3083456343", generation: 1 };
  assert.equal(compareSession(before, { pid: 100, uin: "3254926145", generation: 1 }),
    "session-account-changed");
});

test("an unreadable account is not a change", () => {
  // The payload reports null when it could not read the uin. Treating "could not read" as
  // "changed" would fire the expensive path on a diagnostic gap -- exactly the false positive
  // the module exists to avoid.
  const known: SessionIdentity = { pid: 100, uin: "3083456343", generation: 1 };
  assert.equal(compareSession(known, { pid: 100, uin: null, generation: 1 }), null);
  assert.equal(compareSession({ pid: 100, uin: null, generation: 1 }, known), null);
  assert.equal(compareSession({ pid: 100, uin: null, generation: 1 }, { pid: 100, uin: null, generation: 1 }), null);
});

test("a stable snapshot is read once", async () => {
  let witnessValue = 7;
  const result = await readStableSnapshot(
    () => witnessValue,
    () => Buffer.from([1, 2, 3]),
    noSleep,
  );
  assert.equal(result.attempts, 1);
  assert.deepEqual([...result.value as Buffer], [1, 2, 3]);
});

test("a snapshot taken while the message moved is retried and then succeeds", async () => {
  // The witness moves during the first read and settles afterwards, which is what an append
  // in progress looks like from here.
  let calls = 0;
  const result = await readStableSnapshot(
    () => (calls++ < 1 ? 1 : 2),
    () => "body",
    noSleep,
  );
  assert.equal(result.value, "body");
  assert.ok(result.attempts >= 1);
});

test("a message that never settles fails instead of returning a torn body", async () => {
  // The important property: no value. A truncated body would parse as a shorter message and
  // look fine all the way downstream.
  let n = 0;
  await assert.rejects(
    () => readStableSnapshot(() => n++, () => "body", { attempts: 3, ...noSleep }),
    (err: unknown) => {
      assert.ok(err instanceof PolicyError);
      assert.equal(err.failure, "snapshot-torn");
      assert.match(err.message, /message payload changed during snapshot/);
      return true;
    },
  );
});

test("snapshot attempts must be a positive integer", async () => {
  await assert.rejects(
    () => readStableSnapshot(() => 0, () => "x", { attempts: 0, ...noSleep }),
    (err: unknown) => err instanceof PolicyError && err.failure === "snapshot-unstable",
  );
});

test("a receipt is claimed once and only once", () => {
  const table = new ReceiptTable(8);
  table.record(1001, 42);
  assert.equal(table.claim(1001), 42);
  // The second claim must not return it again: two waiters must not both be told they own the
  // same message.
  assert.equal(table.claim(1001), null);
  assert.equal(table.size, 0);
});

test("a re-recorded private sequence for the same client sequence is idempotent", () => {
  const table = new ReceiptTable(8);
  table.record(1001, 42);
  table.record(1001, 42);
  assert.equal(table.size, 1);
  assert.equal(table.claim(1001), 42);
});

test("the same private sequence for a different client sequence is refused", () => {
  // Overwriting would hand one message's receipt to another's waiter and leave the loser
  // waiting forever. Refusing surfaces the ambiguity at the point it appears.
  const table = new ReceiptTable(8);
  table.record(1001, 42);
  assert.throws(
    () => table.record(1001, 43),
    (err: unknown) => err instanceof PolicyError && err.failure === "receipt-ambiguous",
  );
});

test("a non-positive private sequence is refused", () => {
  const table = new ReceiptTable(8);
  for (const bad of [0, -1, 1.5, NaN]) {
    assert.throws(() => table.record(bad, 42),
      (err: unknown) => err instanceof PolicyError && err.failure === "receipt-ambiguous");
  }
});

test("the table is bounded and drops the oldest receipts", () => {
  // An unclaimed receipt must not accumulate: the sender gave up long ago and nothing will
  // ever claim it.
  const table = new ReceiptTable(3);
  for (let i = 1; i <= 5; i++) table.record(i, i * 10);
  assert.equal(table.size, 3);
  assert.equal(table.claim(1), null);
  assert.equal(table.claim(2), null);
  assert.equal(table.claim(5), 50);
  assert.equal(table.unambiguous, true);
});

test("channel op whitelists are enforced and disjoint apart from hello and login", () => {
  // A control op arriving on the recv socket would drive the wrong state machine, and the
  // damage would show up much later as a request that never completes.
  assert.equal(checkChannelOp("control", 2), null);
  assert.equal(checkChannelOp("control", 5), null);
  assert.equal(checkChannelOp("recv", 6), null);
  assert.equal(checkChannelOp("recv", 21), null);

  // Both channels carry hello and login.
  assert.equal(checkChannelOp("control", 1), null);
  assert.equal(checkChannelOp("recv", 1), null);
  assert.equal(checkChannelOp("control", 7), null);
  assert.equal(checkChannelOp("recv", 7), null);

  // Crossed halves.
  assert.equal(checkChannelOp("control", 6), "wrong-channel");
  assert.equal(checkChannelOp("control", 21), "wrong-channel");
  assert.equal(checkChannelOp("recv", 2), "wrong-channel");
  assert.equal(checkChannelOp("recv", 5), "wrong-channel");
});