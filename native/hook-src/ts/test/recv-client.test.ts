import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecvClient, RECV_MAX_BODY_BYTES, recvSocketPath } from "../src/recv-client.js";
import { FRAME_HEADER_SIZE, PIPE_MAGIC, PIPE_VERSION, RecvOp, encodeFrame } from "../src/protocol.js";

const dirs: string[] = [];
const clients: RecvClient[] = [];
const servers: net.Server[] = [];
const settle = (ms = 35): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

after(async () => {
  for (const client of clients) client.close();
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function setup(options: { maxBodyBytes?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hz-recv-client-"));
  dirs.push(dir);
  const pid = 7654;
  const path = recvSocketPath(dir, pid);
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => sockets.push(socket));
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => { server.off("error", reject); resolve(); });
  });
  const client = new RecvClient({ pid, runtimeDir: dir, ...options });
  clients.push(client);
  const dataPromise = new Promise<Buffer>((resolve) => {
    server.once("connection", (socket) => socket.once("data", resolve));
  });
  await client.connect();
  const socket = await waitFor(() => sockets[0]);
  const hello = await dataPromise;
  return { client, socket, path, pid, hello };
}

async function waitFor<T>(read: () => T | undefined, timeoutMs = 1_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const result = read();
    if (result !== undefined) return result;
    await settle(5);
  }
  throw new Error("timed out waiting for socket state");
}

function malformedHeader(op: number, fieldOffset: number, value: number): Buffer {
  const frame = Buffer.alloc(FRAME_HEADER_SIZE);
  frame.writeUInt32LE(PIPE_MAGIC, 0);
  frame.writeUInt16LE(PIPE_VERSION, 4);
  frame.writeUInt16LE(op, 6);
  frame.writeUInt32LE(value, fieldOffset);
  return frame;
}

test("path and hello use recv socket, status 2, path and pid", async () => {
  const { hello, path, pid } = await setup();
  assert.equal(recvSocketPath(path.slice(0, path.lastIndexOf("/")), pid), path);
  assert.equal(hello.readUInt16LE(6), RecvOp.hello);
  assert.equal(hello.readInt32LE(12), 2);
  assert.equal(hello.toString("utf8", FRAME_HEADER_SIZE), path);
  assert.equal(hello.readBigUInt64LE(32), BigInt(pid));
});

test("hello wire fields and op 6 normalization; receipt remains a distinct event", async () => {
  const { client, socket } = await setup();
  const packets: unknown[] = [];
  const receipts: unknown[] = [];
  client.on("packet", (packet) => packets.push(packet));
  client.on("receipt", (frame) => receipts.push(frame));
  const payload = Buffer.from([0, 1, 0xfe, 0xff]);
  const packet = encodeFrame({ op: RecvOp.packet, status: -7, cmd: "MessageSvc.PushNotify", msg: "10001", value0: 0x1_0000_0001n, body: payload });
  socket.write(packet);
  await waitFor(() => packets[0]);
  assert.deepEqual(packets[0], {
    // `requestId` is part of the packet: it carries the correlation id the payload stamps onto a
    // reply so the caller that asked for the send can be settled. A frame with id 0 is ordinary
    // traffic (pushes, heartbeats); a non-zero id means "this answers an injected send".
    status: -7, requestId: 0, cmd: "MessageSvc.PushNotify", uin: "10001",
    sequence: 0x1_0000_0001n, body: Buffer.from(payload),
  });
  payload.fill(0);
  assert.deepEqual([...(packets[0] as { body: Buffer }).body], [0, 1, 254, 255]);

  socket.write(encodeFrame({ op: RecvOp.clientMessageReceipt, msg: "receipt" }));
  await waitFor(() => receipts[0]);
  assert.equal(receipts.length, 1);
  assert.equal(packets.length, 1);
  assert.equal((receipts[0] as { header: { op: number } }).header.op, RecvOp.clientMessageReceipt);
});

test("split and coalesced frames drain correctly", async () => {
  const { client, socket } = await setup();
  const packets: unknown[] = [];
  client.on("packet", (packet) => packets.push(packet));
  const a = encodeFrame({ op: RecvOp.packet, cmd: "a", msg: "1", body: Buffer.from("one") });
  const b = encodeFrame({ op: RecvOp.packet, cmd: "b", msg: "2", body: Buffer.from("two") });
  socket.write(a.subarray(0, 17));
  await settle();
  socket.write(Buffer.concat([a.subarray(17), b]));
  await waitFor(() => packets.length === 2 ? true : undefined);
  assert.deepEqual(packets.map((item) => (item as { cmd: string }).cmd), ["a", "b"]);
});

test("non-zero flags on op 6 rejects the frame and disconnects", async () => {
  // Only `flags` is reserved. `requestId` is NOT: it carries the correlation id that ties a reply
  // to the injected send waiting on it, so a non-zero value there is the normal case for exactly
  // the frames this channel exists to deliver.
  const { client, socket } = await setup();
  const errors: Error[] = [];
  client.on("error", (error) => errors.push(error));
  const closed = new Promise<void>((resolve) => client.once("close", resolve));
  socket.write(malformedHeader(RecvOp.packet, 16, 1));
  await closed;
  assert.equal(client.connected, false);
  assert.match(errors[0]?.message ?? "", /invalid op 6 header/);
});

test("a non-zero op 6 requestId is delivered, not rejected", async () => {
  // The regression this guards: rejecting non-zero requestIds silently broke every correlated
  // reply, and the symptom was a timeout on a send that had actually been delivered.
  const { client, socket } = await setup();
  const packets: Array<{ requestId: number; cmd: string }> = [];
  client.on("packet", (packet) => packets.push(packet as { requestId: number; cmd: string }));
  socket.write(
    encodeFrame({
      op: RecvOp.packet,
      requestId: 42,
      status: 0,
      cmd: "MessageSvc.PbSendMsg",
      body: Buffer.from([1, 2]),
    }),
  );
  await waitFor(() => packets[0]);
  assert.equal(packets[0]?.requestId, 42);
  assert.equal(packets[0]?.cmd, "MessageSvc.PbSendMsg");
});

test("bad magic, oversized codec spans, and body cap are fatal", async (t) => {
  const cases = [
    { name: "bad magic", frame: (() => { const b = malformedHeader(RecvOp.packet, 0, 0); b.writeUInt32LE(0, 0); return b; })(), limit: RECV_MAX_BODY_BYTES },
    { name: "command limit", frame: malformedHeader(RecvOp.packet, 20, 4097), limit: RECV_MAX_BODY_BYTES },
    { name: "message limit", frame: malformedHeader(RecvOp.packet, 24, 65537), limit: RECV_MAX_BODY_BYTES },
    { name: "body limit", frame: malformedHeader(RecvOp.packet, 28, 9), limit: 8 },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const { client, socket } = await setup({ maxBodyBytes: item.limit });
      const errors: Error[] = [];
      client.on("error", (error) => errors.push(error));
      const closed = new Promise<void>((resolve) => client.once("close", resolve));
      socket.write(item.frame);
      await closed;
      assert.equal(client.connected, false);
      assert.ok(errors.length > 0);
    });
  }
});

test("remote disconnect emits close; explicit close tears down the client", async () => {
  const { client, socket } = await setup();
  const closed = new Promise<void>((resolve) => client.once("close", resolve));
  socket.destroy();
  await closed;
  assert.equal(client.connected, false);

  const second = await setup();
  second.client.close();
  assert.equal(second.client.connected, false);
});
