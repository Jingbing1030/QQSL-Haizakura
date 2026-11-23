import assert from "node:assert";
import assertStrict from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";
import type { IncomingPacket } from "../src/bridge/packet-pipeline.js";
import {
  attachRecvIngress,
  RECV_INGRESS_MAX_SAFE_SEQUENCE,
  type PacketEventSource,
  type RecvIngressBridge,
  type RecvIngressErrorContext,
  type RecvPacketLike,
} from "../src/bridge/recv-ingress.js";
import type { RecvClient, RecvPacket } from "../src/recv-client.js";

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/** A client with a manual `emit` — the same `EventEmitter` shape `RecvClient` has. */
class FakeClient extends EventEmitter {
  emitPacket(packet: RecvPacketLike): void {
    this.emit("packet", packet);
  }
  get packetListenerCount(): number {
    return this.listenerCount("packet");
  }
}

interface Recorded {
  packet: IncomingPacket;
  /** Resolved by the test to let one call finish, proving the queue is serial. */
  done?: () => void;
}

/** A bridge that captures packets and can be told to finish them by hand or throw. */
class FakeBridge implements RecvIngressBridge {
  readonly received: Recorded[] = [];
  readonly inFlight: IncomingPacket[] = [];
  maxConcurrent = 0;
  private concurrent = 0;
  /** seq values whose `onPacket` must reject. */
  readonly failSeqs = new Set<number>();
  /** When set, every call blocks until the matching `release` runs. */
  manual = false;
  readonly registered: { cmd: string; handler: unknown }[] = [];

  onPacket(packet: IncomingPacket): void | Promise<void> {
    const record: Recorded = { packet };
    this.received.push(record);
    if (this.failSeqs.has(packet.seq)) return Promise.reject(new Error(`boom ${packet.seq}`));
    if (!this.manual) return;
    return new Promise<void>((resolve) => {
      this.concurrent += 1;
      this.inFlight.push(packet);
      this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
      record.done = () => {
        this.concurrent -= 1;
        this.inFlight.splice(this.inFlight.indexOf(packet), 1);
        resolve();
      };
    });
  }

  registerCmd(cmd: string, handler: (packet: IncomingPacket) => readonly unknown[]): void {
    this.registered.push({ cmd, handler });
  }

  get seqs(): number[] {
    return this.received.map((entry) => entry.packet.seq);
  }
}

function wirePacket(sequence: bigint | number, overrides: Partial<RecvPacketLike> = {}): RecvPacketLike {
  return {
    status: 0,
    cmd: "MessageSvc.PbPushMsg",
    uin: "12345",
    sequence,
    body: new Uint8Array([1, 2, 3]),
    ...overrides,
  };
}

function collectErrors(): {
  onError: (error: unknown, context: RecvIngressErrorContext) => void;
  errors: unknown[];
  contexts: RecvIngressErrorContext[];
} {
  const errors: unknown[] = [];
  const contexts: RecvIngressErrorContext[] = [];
  return {
    errors,
    contexts,
    onError: (error, context) => {
      errors.push(error);
      contexts.push(context);
    },
  };
}

const BRIDGE_IDENTITY = {
  uin: 12345,
  uid: "self",
  nickname: "me",
  remark: "",
  qid: "",
  sex: "unknown",
  age: 0,
  sign: "",
  avatar: "",
  level: 0,
  qidianMasterFlag: 0,
  qidianCrewFlag: 0,
  qidianCrewFlag2: 0,
} as const;

// ---------------------------------------------------------------------------
// Compile-time conformance: the doubles and the real classes agree
// ---------------------------------------------------------------------------

// If `RecvClient` ever stops matching `PacketEventSource`, or `Bridge` stops
// matching `RecvIngressBridge`, this file fails to compile — which is the point of
// the interfaces being structural rather than vendored copies.
const recvClientAsSource: PacketEventSource | null = null as unknown as RecvClient | null;
const realBridgeAsIngress: RecvIngressBridge | null = null as unknown as Bridge | null;
const realPacketAsLike: RecvPacketLike = null as unknown as RecvPacket;
void recvClientAsSource;
void realBridgeAsIngress;
void realPacketAsLike;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

test("forwarding normalizes the wire packet into Bridge.onPacket shape", async () => {
  const client = new FakeClient();
  const bridge = new FakeBridge();
  const detach = attachRecvIngress(bridge, client);

  const body = new Uint8Array([9, 8, 7]);
  client.emitPacket({
    status: -11,
    cmd: "MessageSvc.PbPushMsg",
    uin: "10001",
    sequence: 42n,
    body,
  });
  await detach();

  assertStrict.equal(bridge.received.length, 1);
  const { packet } = bridge.received[0]!;
  assertStrict.deepEqual(packet, {
    seq: 42,
    error: -11,
    cmd: "MessageSvc.PbPushMsg",
    uin: "10001",
    body: new Uint8Array([9, 8, 7]),
  });
  // A copy, not the transport's buffer: a reused read buffer must not rewrite
  // bytes that are already queued for dispatch.
  assertStrict.notStrictEqual(packet.body, body);
  assertStrict.ok(packet.body instanceof Uint8Array);
  assertStrict.ok(!Buffer.isBuffer(packet.body), "body must be a plain Uint8Array");
  body[0] = 0;
  assertStrict.equal(packet.body[0], 9);
});

test("a large-but-exact sequence is forwarded without truncation", async () => {
  const client = new FakeClient();
  const bridge = new FakeBridge();
  const detach = attachRecvIngress(bridge, client);

  const exact = BigInt(RECV_INGRESS_MAX_SAFE_SEQUENCE);
  client.emitPacket(wirePacket(exact));
  client.emitPacket(wirePacket(BigInt("9007199254740991")));
  await detach();

  assertStrict.deepEqual(bridge.seqs, [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);
  assertStrict.equal(RECV_INGRESS_MAX_SAFE_SEQUENCE, Number.MAX_SAFE_INTEGER);
});

// ---------------------------------------------------------------------------
// Unsafe sequence
// ---------------------------------------------------------------------------

test("an unsafe bigint sequence is ignored and reported, never truncated", async () => {
  const client = new FakeClient();
  const bridge = new FakeBridge();
  const { onError, errors, contexts } = collectErrors();
  const detach = attachRecvIngress(bridge, client, { onError });

  // 2^53 + 1: `Number()` would collapse this onto 9007199254740992.
  client.emitPacket(wirePacket(BigInt(RECV_INGRESS_MAX_SAFE_SEQUENCE) + 1n));
  client.emitPacket(wirePacket(BigInt(RECV_INGRESS_MAX_SAFE_SEQUENCE) + 2n));
  // A legitimate packet after the bad ones must still get through.
  client.emitPacket(wirePacket(7n));
  await detach();

  assertStrict.deepEqual(bridge.seqs, [7], "unsafe sequences must be dropped entirely");
  assertStrict.equal(errors.length, 2);
  for (const context of contexts) assertStrict.equal(context.phase, "sequence");
  assertStrict.equal(contexts[0]!.sequence, BigInt(RECV_INGRESS_MAX_SAFE_SEQUENCE) + 1n);
  assertStrict.equal(contexts[0]!.packet, null);
  assertStrict.match(String(errors[0]), /not a safe non-negative integer/);
});

test("negative, non-integer and non-numeric sequences are ignored", async () => {
  const client = new FakeClient();
  const bridge = new FakeBridge();
  const { onError, contexts } = collectErrors();
  const detach = attachRecvIngress(bridge, client, { onError });

  client.emitPacket(wirePacket(-1n));
  client.emitPacket(wirePacket(1.5));
  client.emitPacket(wirePacket(0n as bigint | number));
  client.emitPacket({ ...wirePacket(0n), sequence: "12" as unknown as bigint });
  client.emitPacket(wirePacket(Number.NaN));
  await detach();

  assertStrict.deepEqual(bridge.seqs, [0], "only the safe zero sequence survives");
  assertStrict.equal(contexts.length, 4);
  assertStrict.deepEqual(
    contexts.map((context) => context.phase),
    ["sequence", "sequence", "sequence", "sequence"],
  );
});

test("a throwing onError observer cannot break ingress", async () => {
  const client = new FakeClient();
  const bridge = new FakeBridge();
  let calls = 0;
  const detach = attachRecvIngress(bridge, client, {
    onError: () => {
      calls += 1;
      throw new Error("observer exploded");
    },
  });

  // The observer throws, but it runs inside the listener's own try/catch — a packet
  // handler that escaped into `RecvClient`'s frame loop would corrupt the transport.
  assertStrict.doesNotThrow(() => client.emitPacket(wirePacket(BigInt(RECV_INGRESS_MAX_SAFE_SEQUENCE) + 5n)));
  client.emitPacket(wirePacket(3n));
  await detach();

  assertStrict.equal(calls, 1);
  assertStrict.deepEqual(bridge.seqs, [3]);
});

// ---------------------------------------------------------------------------
// Ordering under concurrent emits
// ---------------------------------------------------------------------------

test("concurrent emits arrive at onPacket in arrival order", async () => {
  const client = new FakeClient();
  const bridge = new FakeBridge();
  const detach = attachRecvIngress(bridge, client);

  // Ten packets emitted synchronously. A naive `void bridge.onPacket(...)` would
  // interleave them; the promise tail must not.
  for (let i = 0; i < 10; i += 1) client.emitPacket(wirePacket(BigInt(i)));
  await detach();

  assertStrict.deepEqual(bridge.seqs, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assertStrict.ok(true);
});

test("an async onPacket is never re-entered: at most one call is in flight", async () => {
  const client = new FakeClient();
  const bridge = new FakeBridge();
  bridge.manual = true;
  const detach = attachRecvIngress(bridge, client);

  for (let i = 0; i < 4; i += 1) client.emitPacket(wirePacket(BigInt(i)));
  // Only the head of the queue has started; the rest wait behind it.
  await Promise.resolve();
  assertStrict.deepEqual(bridge.received.map((entry) => entry.packet.seq), [0]);

  for (let i = 0; i < 4; i += 1) {
    const head = bridge.inFlight[0];
    assertStrict.ok(head, `packet ${i} should be in flight`);
    assertStrict.equal(head.seq, i, "packets must be dispatched in arrival order");
    assertStrict.equal(bridge.maxConcurrent, 1);
    bridge.received.find((entry) => entry.packet.seq === i)?.done?.();
    // Let the tail's microtask chain advance to the next packet.
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
  }
  await detach();

  assertStrict.equal(bridge.maxConcurrent, 1);
  assertStrict.deepEqual(bridge.seqs, [0, 1, 2, 3]);
});

// ---------------------------------------------------------------------------
// Error isolation
// ---------------------------------------------------------------------------

test("a failing onPacket is reported and does not stall or reorder later packets", async () => {
  const client = new FakeClient();
  const bridge = new FakeBridge();
  bridge.failSeqs.add(2);
  bridge.failSeqs.add(4);
  const { onError, errors, contexts } = collectErrors();
  const detach = attachRecvIngress(bridge, client, { onError });

  for (let i = 1; i <= 6; i += 1) client.emitPacket(wirePacket(BigInt(i)));
  // Detach must await quiescence, so every call — including the rejected ones —
  // has settled by the time it resolves.
  await detach();

  assertStrict.deepEqual(bridge.seqs, [1, 2, 3, 4, 5, 6]);
  assertStrict.deepEqual(
    contexts.map((context) => context.phase),
    ["onPacket", "onPacket"],
  );
  assertStrict.deepEqual(
    contexts.map((context) => context.packet?.seq),
    [2, 4],
  );
  assertStrict.match(String(errors[0]), /boom 2/);
  assertStrict.equal(bridge.received.length, 6, "a rejection must not delete later work");
});

test("a synchronous throw inside onPacket is isolated as well", async () => {
  const client = new FakeClient();
  const seen: number[] = [];
  const { onError, contexts } = collectErrors();
  const bridge: RecvIngressBridge = {
    onPacket: (packet) => {
      if (packet.seq === 1) throw new Error("sync boom");
      seen.push(packet.seq);
    },
  };
  const detach = attachRecvIngress(bridge, client, { onError });

  client.emitPacket(wirePacket(1n));
  client.emitPacket(wirePacket(2n));
  await detach();

  assertStrict.deepEqual(seen, [2]);
  assertStrict.equal(contexts.length, 1);
  assertStrict.equal(contexts[0]!.phase, "onPacket");
});

test("a malformed body is reported as a normalize failure and skipped", async () => {
  const client = new FakeClient();
  const bridge = new FakeBridge();
  const { onError, contexts } = collectErrors();
  const detach = attachRecvIngress(bridge, client, { onError });

  // A body that cannot be copied — the transport never produces this, but the
  // handler must not let such a throw reach `RecvClient`'s frame loop. A proxy that
  // throws on every property access makes `new Uint8Array(body)` itself throw.
  const poison = new Proxy({}, {
    get() {
      throw new Error("body is not readable");
    },
  });
  const broken = { ...wirePacket(1n), body: poison as Uint8Array };
  assertStrict.doesNotThrow(() => client.emitPacket(broken));
  client.emitPacket(wirePacket(2n));
  await detach();

  assertStrict.deepEqual(bridge.seqs, [2]);
  assertStrict.equal(contexts.length, 1);
  assertStrict.equal(contexts[0]!.phase, "normalize");
  assertStrict.equal(contexts[0]!.sequence, 1n);
});

// ---------------------------------------------------------------------------
// Detach
// ---------------------------------------------------------------------------

test("detach unsubscribes synchronously and stops all forwarding", async () => {
  const client = new FakeClient();
  const bridge = new FakeBridge();
  const detach = attachRecvIngress(bridge, client);
  assertStrict.equal(client.packetListenerCount, 1);

  client.emitPacket(wirePacket(1n));
  const settled = detach();
  assertStrict.equal(client.packetListenerCount, 0, "listener must be gone before the promise resolves");

  client.emitPacket(wirePacket(2n));
  await settled;
  client.emitPacket(wirePacket(3n));

  assertStrict.deepEqual(bridge.seqs, [1]);
});

test("packets accepted before detach still drain, in order, before it resolves", async () => {
  const client = new FakeClient();
  const bridge = new FakeBridge();
  bridge.manual = true;
  const detach = attachRecvIngress(bridge, client);

  client.emitPacket(wirePacket(1n));
  client.emitPacket(wirePacket(2n));
  await Promise.resolve();
  assertStrict.deepEqual(bridge.seqs, [1], "only the queue head has started");

  const settled = detach();
  // Both were accepted while the ingress was live, so detach owes both a delivery.
  // Neither is in flight any more, so finish them by hand and confirm the order.
  bridge.received[0]!.done?.();
  for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
  bridge.received[1]!.done?.();
  await settled;

  assertStrict.deepEqual(bridge.seqs, [1, 2]);
  assertStrict.equal(bridge.maxConcurrent, 1);

  // ...but nothing NEW is accepted after the synchronous unsubscribe.
  client.emitPacket(wirePacket(3n));
  assertStrict.deepEqual(bridge.seqs, [1, 2], "a post-detach emit must not be forwarded");
});

test("detach is idempotent and keeps the promise stable", async () => {
  const client = new FakeClient();
  const bridge = new FakeBridge();
  const detach = attachRecvIngress(bridge, client);

  client.emitPacket(wirePacket(1n));
  const first = detach();
  assertStrict.equal(first, detach());
  assertStrict.equal(await first, await detach());
  await first;

  client.emitPacket(wirePacket(2n));
  assertStrict.deepEqual(bridge.seqs, [1]);
  assertStrict.equal(client.packetListenerCount, 0);
});

test("detach falls back to removeListener for emitters without off()", async () => {
  const client = new FakeClient();
  // Strip `off` to model an EventEmitter-like object that only has the old alias.
  Object.defineProperty(client, "off", { value: undefined, configurable: true });
  const bridge = new FakeBridge();
  const detach = attachRecvIngress(bridge, client);

  client.emitPacket(wirePacket(1n));
  await detach();
  client.emitPacket(wirePacket(2n));

  assertStrict.equal(client.packetListenerCount, 0);
  assertStrict.deepEqual(bridge.seqs, [1]);
});

test("attaching without any way to unsubscribe throws instead of leaking a listener", () => {
  const bridge = new FakeBridge();
  const { onError, contexts } = collectErrors();
  const leaky: PacketEventSource = { on: () => undefined };

  assertStrict.throws(() => attachRecvIngress(bridge, leaky, { onError }), /off\(\) or removeListener\(\)/);
  assertStrict.equal(contexts.length, 1);
  assertStrict.equal(bridge.received.length, 0);
});

// ---------------------------------------------------------------------------
// Injected decoder registration
// ---------------------------------------------------------------------------

test("setupDecoders runs once, before the subscription, with a working registerCmd", async () => {
  const client = new FakeClient();
  const bridge = new FakeBridge();
  const setupCalls: string[] = [];
  const handler = (packet: IncomingPacket) => [packet.seq];

  const detach = attachRecvIngress(bridge, client, {
    setupDecoders: (register) => {
      // Bridge.registerCmd is passed through unbound, so the bound wrapper matters.
      setupCalls.push(`setup:${client.packetListenerCount}`);
      register("MessageSvc.PbPushMsg", handler);
    },
  });

  assertStrict.deepEqual(setupCalls, ["setup:0"], "decoders must be registered before subscribing");
  assertStrict.equal(client.packetListenerCount, 1);
  assertStrict.deepEqual(bridge.registered.map((entry) => entry.cmd), ["MessageSvc.PbPushMsg"]);
  assertStrict.equal(bridge.registered[0]!.handler, handler);
  await detach();
});

test("a throwing setupDecoders aborts the attach and leaves no listener", () => {
  const client = new FakeClient();
  const bridge = new FakeBridge();
  const { onError, contexts } = collectErrors();

  assertStrict.throws(
    () =>
      attachRecvIngress(bridge, client, {
        onError,
        setupDecoders: () => {
          throw new Error("bad decoder table");
        },
      }),
    /bad decoder table/,
  );
  assertStrict.equal(client.packetListenerCount, 0);
  assertStrict.equal(contexts.length, 1);
  assertStrict.equal(contexts[0]!.phase, "decoders");
});

test("setupDecoders without bridge.registerCmd is rejected", () => {
  const client = new FakeClient();
  const { onError } = collectErrors();
  const registerFree: RecvIngressBridge = { onPacket: () => undefined };

  assertStrict.throws(
    () => attachRecvIngress(registerFree, client, { onError, setupDecoders: () => undefined }),
    /requires bridge\.registerCmd/,
  );
  assertStrict.equal(client.packetListenerCount, 0);
});

// ---------------------------------------------------------------------------
// Real Bridge end-to-end (still no transport, still no QQ)
// ---------------------------------------------------------------------------

test("the real Bridge receives forwarded packets and dispatches registered decoders", async () => {
  const identity = new MemoryIdentity("12345");
  identity.setSelfProfile({ ...BRIDGE_IDENTITY });
  const bridge = new Bridge(identity);
  const seen: unknown[] = [];
  bridge.events.on("recv_ingress_test", (event) => {
    seen.push(event);
  });

  const client = new FakeClient();
  const detach = attachRecvIngress(bridge, client, {
    setupDecoders: (register) => {
      register("MessageSvc.PbPushMsg", (packet) => [
        { kind: "recv_ingress_test", seq: packet.seq, error: packet.error },
      ]);
    },
  });

  client.emitPacket(wirePacket(1n));
  client.emitPacket(wirePacket(2n));
  client.emitPacket(wirePacket(BigInt(RECV_INGRESS_MAX_SAFE_SEQUENCE) + 9n));
  await detach();

  assert.deepEqual(seen, [
    { kind: "recv_ingress_test", seq: 1, error: 0 },
    { kind: "recv_ingress_test", seq: 2, error: 0 },
  ]);
  await bridge.dispose();
});

test("the real Bridge drops packets whose uin is not this account", async () => {
  const identity = new MemoryIdentity("12345");
  identity.setSelfProfile({ ...BRIDGE_IDENTITY });
  const bridge = new Bridge(identity);
  const seen: unknown[] = [];
  bridge.events.on("recv_ingress_test", (event) => {
    seen.push(event);
  });

  const client = new FakeClient();
  const detach = attachRecvIngress(bridge, client, {
    setupDecoders: (register) => {
      register("MessageSvc.PbPushMsg", (packet) => [{ kind: "recv_ingress_test", seq: packet.seq }]);
    },
  });

  client.emitPacket(wirePacket(1n, { uin: "99999" }));
  client.emitPacket(wirePacket(2n));
  await detach();

  assert.deepEqual(seen, [{ kind: "recv_ingress_test", seq: 2 }]);
  await bridge.dispose();
});