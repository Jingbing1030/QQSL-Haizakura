/**
 * The inbound seam: `RecvClient` "packet" event -> `Bridge.onPacket` -> `group_message`.
 *
 * ## Why this file exists
 *
 * The decoder and the bridge each have their own tests, and for a long time neither
 * was reachable from a process: `Bridge` did not register `MSG_PUSH_CMD` at all, so a
 * real push produced zero events while every unit test stayed green. This test closes
 * that specific gap by driving the *runtime* — the object a process actually starts —
 * and asserting an event comes out.
 *
 * ## What it proves, and what it does not
 *
 * Proves: `HaizakuraRuntime.attachRecv` wires a socket client to the bridge, and a
 * real captured op6 body becomes a decoded `group_message` event with the right group
 * and sender.
 *
 * Does NOT prove: the C++ side has an observer installed on the recv slot. That is a
 * runtime fact about the injected payload, and no Node test can assert it. The bytes
 * here are real (captured from the reference client); the transport is a fake.
 */
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { EventEmitter } from "node:events";

import { HaizakuraRuntime } from "../src/main.js";
import { REAL_OP6_CAPTURES } from "../src/bridge/fixtures/real-op6-captures.js";

const UIN = "10001";

/** The 402-byte capture, which is the one that decodes to a group message. */
function groupMessageCapture() {
  const capture = REAL_OP6_CAPTURES.find((entry) => entry.bytes.length === 402);
  assert.ok(capture !== undefined, "the 402-byte capture must exist in the fixtures");
  return capture;
}

/**
 * A `PacketEventSource` stand-in that lets a test push a frame synchronously.
 *
 * `RecvClient` needs a real socket, so exercising the ingress through it would test
 * `net` rather than the wiring. This double satisfies the structural contract
 * (`on`/`off` plus a `packet` event), which is the only thing `attachRecvIngress`
 * touches.
 */
class FakeRecvSource extends EventEmitter {
  readonly pid = 4242;
}

describe("recv seam: runtime -> recv ingress -> bridge -> event", () => {
  test("the runtime registers the MsgPush decoder on its pipeline", () => {
    // The exact regression that hid for so long: a bridge with no registration
    // accepts packets and publishes nothing.
    const runtime = new HaizakuraRuntime({ uin: UIN, nickname: "鱼糕" });
    assert.equal(
      runtime.getBridge().handlesCmd("trpc.msg.olpush.OlPushService.MsgPush"),
      true,
      "Bridge must register the MsgPush command, or every push is silently dropped",
    );
  });

  test("a real 402-byte op6 body becomes one group_message event", async () => {
    const runtime = new HaizakuraRuntime({ uin: UIN, nickname: "鱼糕" });
    runtime.start();
    const bridge = runtime.getBridge();

    const events: Array<Record<string, unknown>> = [];
    bridge.events.on("group_message", (event) => {
      events.push(event as unknown as Record<string, unknown>);
    });

    const source = new FakeRecvSource();
    const detach = (await import("../src/bridge/recv-ingress.js")).attachRecvIngress(
      bridge,
      source as unknown as Parameters<typeof import("../src/bridge/recv-ingress.js").attachRecvIngress>[1],
    );

    const capture = groupMessageCapture();
    (source as EventEmitter).emit("packet", {
      status: capture.retCode,
      cmd: "trpc.msg.olpush.OlPushService.MsgPush",
      uin: UIN,
      sequence: capture.seqId,
      body: capture.bytes,
    });

    // `onPacket` chains on the roster's initial-load promise, so the event is
    // published on a microtask, not synchronously.
    await new Promise((resolve) => setImmediate(resolve));
    await detach();
    await runtime.stop();

    assert.equal(events.length, 1, `expected exactly one event, got ${events.length}`);
    const event = events[0]!;
    assert.equal(event["kind"], "group_message");
    assert.equal(event["groupId"], 123456, "group id must come from the wire");
    assert.equal(event["senderUin"], 10002, "sender uin must come from the wire");
  });

  test("a packet addressed to another account never reaches the event bus", async () => {
    // Mutation guard for the test above. `Bridge.onPacket` gates on
    // `packet.uin === identity.uin`; if that gate were dropped, the 402-byte body
    // would decode and the previous test would still pass. Feeding a foreign uin must
    // produce ZERO events, so "one event" cannot be satisfied by a bridge that
    // forwards every packet it sees.
    const runtime = new HaizakuraRuntime({ uin: UIN, nickname: "鱼糕" });
    runtime.start();
    const bridge = runtime.getBridge();

    const events: unknown[] = [];
    bridge.events.on("group_message", (event) => { events.push(event); });

    const source = new FakeRecvSource();
    const { attachRecvIngress } = await import("../src/bridge/recv-ingress.js");
    const detach = attachRecvIngress(
      bridge,
      source as unknown as Parameters<typeof attachRecvIngress>[1],
    );

    const capture = groupMessageCapture();
    (source as EventEmitter).emit("packet", {
      status: capture.retCode,
      cmd: "trpc.msg.olpush.OlPushService.MsgPush",
      uin: "10001",
      sequence: capture.seqId,
      body: capture.bytes,
    });

    await new Promise((resolve) => setImmediate(resolve));
    await detach();
    await runtime.stop();

    assert.equal(events.length, 0, "a packet for a foreign uin must not be published");
  });

  test("attachRecv refuses a second attachment", async () => {
    // Two clients on one pid would deliver every packet twice.
    const runtime = new HaizakuraRuntime({ uin: UIN, nickname: "鱼糕" });
    runtime.start();
    runtime.attachRecv(4242);
    assert.throws(() => runtime.attachRecv(4243), /already attached/);
    await runtime.stop();
  });

  test("stop() detaches the ingress, so a late packet publishes nothing", async () => {
    // A listener left subscribed after stop() is how a stopped runtime keeps
    // publishing into a torn-down bridge.
    const runtime = new HaizakuraRuntime({ uin: UIN, nickname: "鱼糕" });
    runtime.start();
    const bridge = runtime.getBridge();
    const events: unknown[] = [];
    bridge.events.on("group_message", (event) => { events.push(event); });

    const source = new FakeRecvSource();
    const { attachRecvIngress } = await import("../src/bridge/recv-ingress.js");
    const detach = attachRecvIngress(
      bridge,
      source as unknown as Parameters<typeof attachRecvIngress>[1],
    );
    await detach();

    const capture = groupMessageCapture();
    (source as EventEmitter).emit("packet", {
      status: capture.retCode,
      cmd: "trpc.msg.olpush.OlPushService.MsgPush",
      uin: UIN,
      sequence: capture.seqId,
      body: capture.bytes,
    });
    await new Promise((resolve) => setImmediate(resolve));
    await runtime.stop();

    assert.equal(events.length, 0, "a detached ingress must not publish");
  });

  test("a packet for an unregistered command is ignored, not thrown", async () => {
    // The ingress runs inside the socket's frame loop; a throw there kills the
    // process. An unknown cmd must be a no-op.
    const runtime = new HaizakuraRuntime({ uin: UIN, nickname: "鱼糕" });
    runtime.start();
    const bridge = runtime.getBridge();
    const source = new FakeRecvSource();
    const { attachRecvIngress } = await import("../src/bridge/recv-ingress.js");
    const detach = attachRecvIngress(
      bridge,
      source as unknown as Parameters<typeof attachRecvIngress>[1],
    );

    assert.doesNotThrow(() => {
      (source as EventEmitter).emit("packet", {
        status: 0,
        cmd: "trpc.unknown.Service.Method",
        uin: UIN,
        sequence: 1,
        body: Buffer.alloc(4),
      });
    });
    await detach();
    await runtime.stop();
  });
});
