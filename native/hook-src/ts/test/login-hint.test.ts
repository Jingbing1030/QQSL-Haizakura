// Tests for the login identity hint and the keepalive window it drives.
//
// The bound is the part worth testing: value0 is a packed pair, and every wrong way to read it
// fails the same way (the hint is refused) without producing an error anyone would notice, so
// only an explicit boundary check catches a decode that is off by one or signed wrong.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  KeepaliveWindow,
  LOGIN_HINT_WINDOW_MS,
  accountReportRequestId,
  classifyLoginHint,
  decodeLoginHint,
  encodeLoginHint,
} from "../src/login-hint.js";

test("a hint packs and unpacks to the same pair", () => {
  for (const counter of [0, 1, 9999]) {
    const hint = { category: 1, counter };
    assert.deepEqual(decodeLoginHint(encodeLoginHint(hint)), hint);
  }
});

test("the packed value0 is the reference's shape, high word 1", () => {
  assert.equal(encodeLoginHint({ category: 1, counter: 0 }), 0x1_0000_0000n);
  assert.equal(encodeLoginHint({ category: 1, counter: 9999 }), 0x1_0000_270fn);
});

test("the counter limit is exclusive: 9999 is accepted and 10000 is not", () => {
  // 0x2710 == 10000. The reference compares `counter - base < 0x2710`, so the upper bound is
  // exclusive. An off-by-one here would refuse the last valid counter or accept one past it.
  assert.notEqual(decodeLoginHint(0x1_0000_270fn), null);
  assert.equal(decodeLoginHint(0x1_0000_2710n), null);
});

test("a bare uin is refused, which is why value0 is not a uin", () => {
  // 3083456343 is a real account number (~10^9), so its high word is 0. Sending it would look
  // like it worked -- the frame arrives -- while every hint was rejected and the keepalive
  // window never opened.
  assert.equal(decodeLoginHint(3083456343n), null);
});

test("values below the base are refused rather than wrapping in", () => {
  // The reference compares the difference as *unsigned*, so anything under the base wraps to a
  // huge counter and is rejected. A signed comparison would let the largest wrong values
  // through, which is the failure mode worth pinning.
  assert.equal(decodeLoginHint(0n), null);
  assert.equal(decodeLoginHint(0xffff_ffffn), null);
  assert.equal(decodeLoginHint(0x0_0000_0001n), null);
});

test("classify reports rejection with -EINVAL", () => {
  const outcome = classifyLoginHint(12345n);
  assert.equal(outcome.kind, "reject");
  if (outcome.kind === "reject") {
    assert.equal(outcome.status, -22);
  }
});

test("classify accepts a well-formed hint", () => {
  const outcome = classifyLoginHint(encodeLoginHint({ category: 1, counter: 42 }));
  assert.equal(outcome.kind, "accept");
  if (outcome.kind === "accept") {
    assert.deepEqual(outcome.hint, { category: 1, counter: 42 });
  }
});

test("the keepalive window opens only after a hint is accepted", () => {
  let now = 1000;
  const window = new KeepaliveWindow(() => now);
  assert.equal(window.isLive(), false);
  assert.equal(window.hasExpired(), false, "never-heard-from is not the same as expired");

  window.accept();
  assert.equal(window.isLive(), true);
  assert.equal(window.hasExpired(), false);
});

test("the window closes exactly at the deadline", () => {
  let now = 0;
  const window = new KeepaliveWindow(() => now);
  window.accept();

  now = LOGIN_HINT_WINDOW_MS - 1;
  assert.equal(window.isLive(), true);

  now = LOGIN_HINT_WINDOW_MS;
  assert.equal(window.isLive(), false, "the deadline itself is outside the window");
  assert.equal(window.hasExpired(), true);
});

test("a second hint extends the window from the new time", () => {
  let now = 0;
  const window = new KeepaliveWindow(() => now);
  window.accept();

  now = 30_000;
  window.accept();
  // 30s of the original window remained; the new one runs to 90s.
  now = 89_999;
  assert.equal(window.isLive(), true);
  now = 90_000;
  assert.equal(window.isLive(), false);
});

test("reset closes the window without waiting", () => {
  const window = new KeepaliveWindow(() => 0);
  window.accept();
  assert.equal(window.isLive(), true);
  window.reset();
  assert.equal(window.isLive(), false);
  assert.equal(window.hasExpired(), false, "a reset window has not expired, it is just closed");
});

test("remaining reports the time left and zero when closed", () => {
  let now = 0;
  const window = new KeepaliveWindow(() => now);
  assert.equal(window.remainingMs(), 0);
  window.accept();
  now = 15_000;
  assert.equal(window.remainingMs(), 45_000);
  now = 70_000;
  assert.equal(window.remainingMs(), 0);
});

test("the account report requestId is an inverted presence flag", () => {
  // (id == 0) ? 1 : 0 -- not a sequence number. Pinned because it reads like one.
  assert.equal(accountReportRequestId(0n), 1);
  assert.equal(accountReportRequestId(3083456343n), 0);
});
