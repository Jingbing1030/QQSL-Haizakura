// Protocol codec tests.
//
// The point of these is not "does encode/decode round-trip" -- that would pass even if
// both sides were wrong in the same way. It is cross-checking against the C++
// implementation that already produced `[Hook] pipe connected` in a real SnowLuma run,
// so the two must agree byte for byte on every field and on every rejection.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeFrame,
  encodeFrame,
  decodeLoginState,
  decodeRefusal,
  REFUSAL_MESSAGES,
  REFUSAL_FALLBACK,
  FRAME_HEADER_SIZE,
  PIPE_MAGIC,
  PIPE_VERSION,
  Op,
  RecvOp,
  Flag,
} from "../src/protocol.js";

test("header layout matches the C++ implementation", () => {
  const frame = encodeFrame({
    op: Op.request,
    requestId: 0x11223344,
    status: -5,
    flags: Flag.wantReply,
    cmd: "runtime",
    msg: "u_abc",
    body: Buffer.from([1, 2, 3]),
    value0: 0x0102030405060708n,
  });

  // Each offset is asserted separately rather than by comparing a golden buffer:
  // a golden buffer only says "this changed", and the useful question at 3am is
  // "which field moved".
  assert.equal(frame.readUInt32LE(0), PIPE_MAGIC, "magic @0");
  assert.equal(frame.readUInt16LE(4), PIPE_VERSION, "version @4");
  assert.equal(frame.readUInt16LE(6), Op.request, "op @6");
  assert.equal(frame.readUInt32LE(8), 0x11223344, "requestId @8");
  assert.equal(frame.readInt32LE(12), -5, "status @12");
  // flags is a u32 at @16, not a u16 followed by a reserved pair. The disassembly confirms
  // the serializer writes a full dword there, and the fields after it are already dwords, so
  // reading u16 would silently drop the high bits of any flag added above bit 15.
  assert.equal(frame.readUInt32LE(16), Flag.wantReply, "flags @16 (u32)");
  assert.equal(frame.readUInt32LE(20), 7, "cmdLen @20");
  assert.equal(frame.readUInt32LE(24), 5, "msgLen @24");
  assert.equal(frame.readUInt32LE(28), 3, "bodyLen @28");
  assert.equal(frame.readBigUInt64LE(32), 0x0102030405060708n, "value0 @32");
  assert.equal(frame.length, FRAME_HEADER_SIZE + 7 + 5 + 3);
});

test("spans are tightly packed in cmd, msg, body order", () => {
  const frame = encodeFrame({ op: RecvOp.packet, cmd: "AA", msg: "BBBB", body: Buffer.from([0xee]) });
  assert.equal(frame.toString("utf8", 40, 42), "AA");
  assert.equal(frame.toString("utf8", 42, 46), "BBBB");
  assert.deepEqual([...frame.subarray(46, 47)], [0xee]);
});

test("decoded body shares the input buffer rather than copying", () => {
  // A copy per frame would double the allocation rate on the packet path, and the
  // packet path runs per QQ message.
  const frame = encodeFrame({ op: RecvOp.packet, body: Buffer.from([9, 9, 9]) });
  const result = decodeFrame(frame);
  assert.ok(result.ok);
  assert.equal(result.frame.body.buffer, frame.buffer);
});

test("rejects a bad magic instead of decoding garbage", () => {
  const frame = encodeFrame({ op: Op.hello });
  frame.writeUInt32LE(0xdeadbeef, 0);
  const result = decodeFrame(frame);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /bad magic/);
});

test("flags above bit 15 survive the round trip", () => {
  // The concrete consequence of getting the width wrong: a flag added at bit 16 would be
  // silently discarded by a u16 reader, and the frame would look valid.
  const frame = encodeFrame({ op: Op.hello, flags: 0x10004 });
  const result = decodeFrame(frame);
  assert.ok(result.ok);
  assert.equal(result.frame.header.flags, 0x10004);
});

test("rejects a frame whose lengths exceed the bytes present", () => {
  // This is the one that matters: trusting cmdLen and slicing anyway is an
  // out-of-bounds read on input from a process we do not control.
  const frame = encodeFrame({ op: Op.request, cmd: "abc" });
  const truncated = frame.subarray(0, frame.length - 1);
  const result = decodeFrame(truncated);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /incomplete frame/);
});

test("rejects an absurd cmd length before allocating", () => {
  const frame = encodeFrame({ op: Op.request });
  frame.writeUInt32LE(0xffffffff, 20);
  const result = decodeFrame(frame);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /cmd too large/);
});

test("reports short header distinctly from a bad frame", () => {
  const result = decodeFrame(Buffer.alloc(10));
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /short header/);
});

test("drains back-to-back frames from one buffer", () => {
  // A single read() can carry a whole frame plus most of the next; the reader needs
  // to know how many bytes it consumed.
  const a = encodeFrame({ op: Op.hello, msg: "pipe", value0: 1234n });
  const b = encodeFrame({ op: Op.loginState, flags: Flag.loggedIn, msg: "3XXXXXXXXX" });
  const joined = Buffer.concat([a, b]);

  const first = decodeFrame(joined, 0);
  assert.ok(first.ok);
  assert.equal(first.bytesConsumed, a.length);
  assert.equal(first.frame.msg, "pipe");

  const second = decodeFrame(joined, first.bytesConsumed);
  assert.ok(second.ok);
  assert.equal(second.bytesConsumed, b.length);
  assert.equal(second.frame.header.op, Op.loginState);
});

test("login state: flags bit 2 alone means logged in", () => {
  const frame = encodeFrame({
    op: Op.loginState,
    flags: Flag.loggedIn,
    status: 0,
    msg: "3XXXXXXXXX",
    value0: 3XXXXXXXXXn,
  });
  const decoded = decodeFrame(frame);
  assert.ok(decoded.ok);
  assert.deepEqual(decodeLoginState(decoded.frame), { loggedIn: true, uin: "3XXXXXXXXX" });
});

test("login state: non-zero status alone means logged in", () => {
  // The two indicators were introduced at different payload versions; a receiver
  // that only checked flags would ignore a login from an older payload, and vice
  // versa. Both are accepted, ORed.
  const frame = encodeFrame({ op: Op.loginState, flags: 0, status: 1 });
  const decoded = decodeFrame(frame);
  assert.ok(decoded.ok);
  assert.equal(decodeLoginState(decoded.frame).loggedIn, true);
});

test("login state: uin falls back to value0 when msg is empty", () => {
  const frame = encodeFrame({ op: Op.loginState, flags: Flag.loggedIn, value0: 3XXXXXXXXXn });
  const decoded = decodeFrame(frame);
  assert.ok(decoded.ok);
  assert.deepEqual(decodeLoginState(decoded.frame), { loggedIn: true, uin: "3XXXXXXXXX" });
});

test("login state: uin is null, not zero, when the payload did not know it", () => {
  // The payload reports logged-in-without-a-number when it could not read the account
  // out of wrapper.node. Returning "0" here would make every subsequent message be
  // attributed to a nonexistent account.
  const frame = encodeFrame({ op: Op.loginState, flags: Flag.loggedIn, status: 1, value0: 0n });
  const decoded = decodeFrame(frame);
  assert.ok(decoded.ok);
  assert.deepEqual(decodeLoginState(decoded.frame), { loggedIn: true, uin: null });
});

test("login state: not logged in reports both fields empty", () => {
  const frame = encodeFrame({ op: Op.loginState, flags: 0, status: 0, msg: "3XXXXXXXXX" });
  const decoded = decodeFrame(frame);
  assert.ok(decoded.ok);
  // A uin is present but must not be reported, because the frame says not logged in.
  assert.deepEqual(decodeLoginState(decoded.frame), { loggedIn: false, uin: null });
});
test("refusal carries the payload's own message through", () => {
  const detail = "SnowLuma could not prepare the request. Please restart SnowLuma and try again.";
  const frame = encodeFrame({ op: Op.error, status: 3, msg: detail, requestId: 7 });
  const decoded = decodeFrame(frame);
  assert.ok(decoded.ok);
  assert.deepEqual(decodeRefusal(decoded.frame), { status: 3, message: detail });
});

test("an empty refusal message falls back to the documented text", () => {
  // An empty msg would render as nothing in a UI, which the reader interprets as "no error".
  // Substituting the documented string makes the failure visible.
  const frame = encodeFrame({ op: Op.error, status: 1 });
  const decoded = decodeFrame(frame);
  assert.ok(decoded.ok);
  assert.deepEqual(decodeRefusal(decoded.frame), {
    status: 1,
    message: REFUSAL_MESSAGES[1],
  });
});

test("an unknown status refuses to invent a message", () => {
  const frame = encodeFrame({ op: Op.error, status: -38 });
  const decoded = decodeFrame(frame);
  assert.ok(decoded.ok);
  const refusal = decodeRefusal(decoded.frame);
  assert.equal(refusal.status, -38);
  assert.equal(refusal.message, REFUSAL_FALLBACK);
});
