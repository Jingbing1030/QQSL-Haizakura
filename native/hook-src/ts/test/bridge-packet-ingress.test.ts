import assert from "node:assert/strict";
import { test } from "node:test";

import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";
import { IncomingPacketPipeline } from "../src/bridge/packet-pipeline.js";

function packet(seq: number, uin = "12345") {
  return { seq, error: 0, cmd: "test.packet", uin, body: new Uint8Array([seq]) };
}

test("Bridge ingress waits for initialization, gates login and UIN, then publishes in order", async () => {
  let resolveInitialization!: () => void;
  const identity = new MemoryIdentity("12345");
  Object.defineProperty(identity, "initialization", {
    configurable: true,
    value: new Promise<void>((resolve) => { resolveInitialization = resolve; }),
  });
  const bridge = new Bridge(identity);
  const seen: unknown[] = [];
  bridge.events.on("test_event", (event) => { seen.push(event); });
  bridge.registerCmd("test.packet", (pkt) => [{ kind: "test_event", seq: pkt.seq }]);

  const pending = bridge.onPacket(packet(1));
  await Promise.resolve();
  assert.deepEqual(seen, []);
  resolveInitialization();
  await pending;
  assert.deepEqual(seen, []); // no self profile means not logged in

  identity.setSelfProfile({
    uin: 12345, uid: "self", nickname: "me", remark: "", qid: "", sex: "unknown",
    age: 0, sign: "", avatar: "", level: 0, qidianMasterFlag: 0, qidianCrewFlag: 0,
    qidianCrewFlag2: 0,
  });
  await bridge.onPacket(packet(2, "1234"));
  await bridge.onPacket(packet(3, "54321"));
  assert.deepEqual(seen, []);

  await Promise.all([bridge.onPacket(packet(4)), bridge.onPacket(packet(5))]);
  assert.deepEqual(seen, [
    { kind: "test_event", seq: 4 },
    { kind: "test_event", seq: 5 },
  ]);
  await bridge.dispose();
});

test("Bridge ingress accepts an injectable pipeline and leaves untyped parser values unpublished", async () => {
  const identity = new MemoryIdentity("12345");
  identity.setSelfProfile({
    uin: 12345, uid: "self", nickname: "me", remark: "", qid: "", sex: "unknown",
    age: 0, sign: "", avatar: "", level: 0, qidianMasterFlag: 0, qidianCrewFlag: 0,
    qidianCrewFlag2: 0,
  });
  const published: unknown[][] = [];
  const pipeline = new IncomingPacketPipeline({ publish: (events) => { published.push([...events]); } });
  pipeline.registerCmd("test.packet", () => ["not a Bridge event"]);
  const bridge = new Bridge(identity, pipeline);

  await bridge.onPacket(packet(9));
  assert.deepEqual(published, [["not a Bridge event"]]);
  await bridge.dispose();
});
