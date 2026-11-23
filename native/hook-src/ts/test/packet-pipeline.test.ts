import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IncomingPacketPipeline,
  type IncomingPacket,
  type PacketEvent,
} from "../src/bridge/packet-pipeline.js";

function packet(cmd: string, seq: number, body = new Uint8Array([seq])): IncomingPacket {
  return { seq, error: 0, cmd, uin: "12345", body };
}

test("registered handlers publish events and unknown commands are ignored", async () => {
  const published: readonly PacketEvent[][] = [];
  const pipeline = new IncomingPacketPipeline({
    publish: (events) => { (published as PacketEvent[][]).push([...events]); },
  });
  pipeline.registerCmd("known", (pkt) => [{ seq: pkt.seq }]);

  await pipeline.process(packet("unknown", 1));
  await pipeline.process(packet("known", 2));

  assert.deepEqual(published, [[{ seq: 2 }]]);
  assert.equal(pipeline.handlesCmd("known"), true);
  assert.equal(pipeline.handlesCmd("unknown"), false);
});

test("packets dispatch sequentially, including asynchronous publication", async () => {
  const order: string[] = [];
  const pipeline = new IncomingPacketPipeline({
    publish: async (events) => {
      order.push(`start-${events[0]}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end-${events[0]}`);
    },
  });
  pipeline.registerCmd("x", (pkt) => [pkt.seq]);

  await Promise.all([pipeline.process(packet("x", 1)), pipeline.process(packet("x", 2))]);
  assert.deepEqual(order, ["start-1", "end-1", "start-2", "end-2"]);
});

test("handler errors are reported without blocking later handlers or packets", async () => {
  const results: number[] = [];
  const errors: unknown[] = [];
  const pipeline = new IncomingPacketPipeline({
    publish: (events) => { results.push(...events as number[]); },
    onError: (error) => { errors.push(error); },
  });
  pipeline.registerCmd("x", () => { throw new Error("bad decode"); });
  pipeline.registerCmd("x", (pkt) => [pkt.seq]);

  await pipeline.process(packet("x", 1));
  await pipeline.process(packet("x", 2));

  assert.deepEqual(results, [1, 2]);
  assert.equal(errors.length, 2);
  assert.match(String(errors[0]), /bad decode/);
});

test("unregister removes one handler or all handlers for a command", async () => {
  const published: PacketEvent[][] = [];
  const pipeline = new IncomingPacketPipeline({
    publish: (events) => { published.push([...events]); },
  });
  const first = () => ["first"];
  const second = () => ["second"];
  pipeline.registerCmd("x", first);
  pipeline.registerCmd("x", second);
  pipeline.unregisterCmd("x", first);
  await pipeline.process(packet("x", 1));
  assert.deepEqual(published, [["second"]]);

  pipeline.unregisterCmd("x");
  await pipeline.process(packet("x", 2));
  assert.deepEqual(published, [["second"]]);
  assert.equal(pipeline.handlesCmd("x"), false);
});

test("dispatch uses a body copy unaffected by caller mutations", async () => {
  let observed: Uint8Array | undefined;
  const pipeline = new IncomingPacketPipeline({
    publish: (_events, pkt) => { observed = pkt.body; },
  });
  pipeline.registerCmd("x", (pkt) => [{ byte: pkt.body[0] }]);
  const input = new Uint8Array([7]);
  const pending = pipeline.process(packet("x", 1, input));
  input[0] = 99;
  await pending;

  assert.deepEqual(observed, new Uint8Array([7]));
  assert.notEqual(observed, input);
});
