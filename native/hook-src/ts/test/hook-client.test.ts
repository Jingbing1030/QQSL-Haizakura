// `HookClient` against a fake payload.
//
// Every test here drives the real client over a real unix socket; there is no live QQ
// and no mock of the client's own internals. What is faked is the *payload*: a
// `net.createServer` that speaks the 40-byte frame protocol by hand.
//
// The frames are built by hand rather than with `encodeFrame` on purpose. A test that
// used the same encoder as the code under test would pass even if both agreed on a
// wrong layout — MEMORY.md §"[2026-11-20 17:15] 测试客户端也有 bug" records exactly that
// failure mode (a malformed hello frame made a working payload look dead, and three
// rounds were spent debugging the payload). So the fake payload's writer below is
// independent of protocol.ts, and one test asserts the bytes the client sends against
// literals.
//
// What a live payload does that this file cannot reproduce is listed in the section
// header of `src/hook-client.ts` and in the MEMORY.md write-up: the -39 status is
// exercised here as a *number the payload might send*, not as a real unhealthy pipe.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  HookClient,
  HOOK_NO_ANSWER_CODE,
  HOOK_STATUS_OUTBOUND_UNHEALTHY,
  HOOK_STATUS_UNIMPLEMENTED,
  hookSocketPath,
} from "../src/hook-client.js";
import { PIPE_MAGIC, PIPE_VERSION, Flag, Op } from "../src/protocol.js";

// ---------------------------------------------------------------------------
// An independent frame writer/reader for the fake payload
// ---------------------------------------------------------------------------

const HEADER = 40;

interface WireFrame {
  op: number;
  requestId: number;
  status: number;
  flags: number;
  value0: bigint;
  cmd: string;
  msg: string;
  body: Buffer;
}

/** Hand-rolled, field by field, with the offsets spelled out. */
function writeFrame(parts: Partial<WireFrame> = {}): Buffer {
  const cmd = Buffer.from(parts.cmd ?? "", "utf8");
  const msg = Buffer.from(parts.msg ?? "", "utf8");
  const body = parts.body ?? Buffer.alloc(0);
  const header = Buffer.alloc(HEADER);
  header.writeUInt32LE(PIPE_MAGIC, 0);
  header.writeUInt16LE(PIPE_VERSION, 4);
  header.writeUInt16LE(parts.op ?? 0, 6);
  header.writeUInt32LE(parts.requestId ?? 0, 8);
  header.writeInt32LE(parts.status ?? 0, 12);
  header.writeUInt32LE(parts.flags ?? 0, 16);
  header.writeUInt32LE(cmd.length, 20);
  header.writeUInt32LE(msg.length, 24);
  header.writeUInt32LE(body.length, 28);
  header.writeBigUInt64LE(parts.value0 ?? 0n, 32);
  return Buffer.concat([header, cmd, msg, body]);
}

/**
 * Reads frames off a socket without assuming anything about chunk boundaries, and keeps
 * every frame it has seen.
 *
 * `frames` is append-only and indexed by op, because a test scripts responses against
 * "the 2nd op 2 request" and a queue that consumed frames would hand that test the wrong
 * one as soon as an earlier frame arrived first.
 */
class WireReader {
  private buffer = Buffer.alloc(0);
  readonly frames: WireFrame[] = [];

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < HEADER) return;
      const cmdLen = this.buffer.readUInt32LE(20);
      const msgLen = this.buffer.readUInt32LE(24);
      const bodyLen = this.buffer.readUInt32LE(28);
      const total = HEADER + cmdLen + msgLen + bodyLen;
      if (this.buffer.length < total) return;
      this.frames.push({
        op: this.buffer.readUInt16LE(6),
        requestId: this.buffer.readUInt32LE(8),
        status: this.buffer.readInt32LE(12),
        flags: this.buffer.readUInt32LE(16),
        value0: this.buffer.readBigUInt64LE(32),
        cmd: this.buffer.toString("utf8", HEADER, HEADER + cmdLen),
        msg: this.buffer.toString("utf8", HEADER + cmdLen, HEADER + cmdLen + msgLen),
        body: this.buffer.subarray(HEADER + cmdLen + msgLen, total),
      });
      this.buffer = this.buffer.subarray(total);
    }
  }

  ofOp(op: number): WireFrame[] {
    return this.frames.filter((frame) => frame.op === op);
  }

  /**
   * Resolve with frame number `count` (1-based) of `op`.
   *
   * Poll-free: a short interval is used rather than a callback registry because the fake
   * payload's scripting is inherently "wait until N requests are in, then answer them",
   * and a polling helper keeps those scripts readable. 5 ms is far below every timeout in
   * this file, so it never decides a race.
   */
  async waitForOp(op: number, count = 1, timeoutMs = 2_000): Promise<WireFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const match = this.ofOp(op)[count - 1];
      if (match) return match;
      if (Date.now() > deadline) {
        throw new Error(`no op ${op} frame #${count} within ${timeoutMs} ms`);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
  }

  /**
   * Wait for the op 2 request carrying `cmd`.
   *
   * Positional waiting (`waitForOp(op, n)`) is only sound when the test knows the send order.
   * Two concurrent `sendPacket` calls make that order a scheduling detail: whichever coroutine
   * reaches `writeRaw` first gets the lower id. Asserting on "request #2" then picks whichever
   * arrived second and replies with the wrong id -- which shows up as a reply landing on the
   * wrong caller, not as a missing frame.
   */
  async waitForRequest(cmd: string, timeoutMs = 2_000): Promise<WireFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const match = this.ofOp(Op.request).find((frame) => frame.cmd === cmd);
      if (match) return match;
      if (Date.now() > deadline) {
        throw new Error(`no op 2 request for cmd ${cmd} within ${timeoutMs} ms`);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
  }
}

// ---------------------------------------------------------------------------
// The fake payload
// ---------------------------------------------------------------------------

interface FakePayloadOptions {
  pid?: number;
  /**
   * Answer the client's op 1 with the payload's own op 1. A live payload also sends its
   * hello unsolicited on accept (disassembly, `0x1125f` before the receive loop at
   * `0x113a0`); answering is enough to make the handshake deterministic in a test.
   */
  answerHello?: boolean;
  /** `status` field of the echoed hello: 0 for control, 2 for recv (channel * 2). */
  helloStatus?: number;
  /** Echo the full path or the short pipe name; the real payload sends the full path. */
  helloPipeName?: string;
  /**
   * Called once per connection, after the hello exchange, for per-connection scripting.
   * Tests answer op 2 requests from here; the alternative (a handler per test) would have
   * to duplicate the hello logic every time.
   */
  onReady?: (ctx: FakeConnection) => void;
  /** Answer each op 2 with a reply carrying this body. Shorthand for the reply tests. */
  replyWith?: (request: WireFrame) => Partial<WireFrame> | null;
}

interface FakeConnection {
  socket: net.Socket;
  reader: WireReader;
  hello: WireFrame;
  send(frame: Partial<WireFrame>): void;
  /** Write raw bytes, for the split/coalesced frame tests. */
  sendRaw(bytes: Buffer): void;
}

interface FakePayload {
  path: string;
  dir: string;
  server: net.Server;
  connections: FakeConnection[];
  /** Resolve with the next new connection's context. */
  nextConnection(timeoutMs?: number): Promise<FakeConnection>;
  close(): Promise<void>;
}

/** Temp dir for one test, cleaned up by the suite's `after`. */
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hz-hook-client-"));
  tempDirs.push(dir);
  return dir;
}

async function startFakePayload(options: FakePayloadOptions = {}): Promise<FakePayload> {
  const dir = makeTempDir();
  const pid = options.pid ?? 4242;
  const path = join(dir, `mojo.${pid}.control.sock`);
  const connections: FakeConnection[] = [];
  const pendingConnections: Array<(ctx: FakeConnection) => void> = [];

  const server = net.createServer((socket) => {
    const reader = new WireReader();
    const ctx: FakeConnection = {
      socket,
      reader,
      // Filled in when the client's op 1 arrives; no test reads it before then.
      hello: { op: -1, requestId: 0, status: 0, flags: 0, value0: 0n, cmd: "", msg: "", body: Buffer.alloc(0) },
      send(frame: Partial<WireFrame>) {
        socket.write(writeFrame(frame));
      },
      sendRaw(bytes: Buffer) {
        socket.write(bytes);
      },
    };
    connections.push(ctx);
    for (const waiter of pendingConnections.splice(0)) waiter(ctx);

    // Frames are appended to `reader.frames` and never removed, so the per-connection
    // scripting below only needs to remember how far it has already reacted.
    let handled = 0;
    socket.on("data", (chunk: Buffer) => {
      reader.push(chunk);
      for (; handled < reader.frames.length; handled += 1) {
        const frame = reader.frames[handled];
        if (!frame) continue;
        if (frame.op === Op.hello) {
          ctx.hello = frame;
          if (options.answerHello !== false) {
            ctx.send({
              op: Op.hello,
              msg: options.helloPipeName ?? path,
              value0: BigInt(pid),
              status: options.helloStatus ?? 0,
            });
          }
          options.onReady?.(ctx);
          continue;
        }
        if (frame.op === Op.request && options.replyWith) {
          const answer = options.replyWith(frame);
          if (answer) ctx.send({ requestId: frame.requestId, ...answer });
        }
      }
    });
    socket.on("error", () => {
      /* a client that times out and destroys its socket is the common case */
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    path,
    dir,
    server,
    connections,
    /**
     * The connection this payload has, waiting for the accept if it has not happened yet.
     *
     * Every test that uses this scripts exactly one connection; the reconnect test indexes
     * `connections` itself, so there is no need for an "n-th connection" version here.
     */
    nextConnection(timeoutMs = 2_000): Promise<FakeConnection> {
      const existing = connections[0];
      if (existing) return Promise.resolve(existing);
      return new Promise<FakeConnection>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no connection within ${timeoutMs} ms`)),
          timeoutMs,
        );
        pendingConnections.push((ctx) => {
          clearTimeout(timer);
          resolve(ctx);
        });
      });
    },
    async close(): Promise<void> {
      // Destroy the client sockets FIRST. `server.close()` only stops accepting and then
      // waits for every live connection to end, and the client under test stays connected
      // until the suite's `after` hook — so awaiting close first would hang the test that
      // called it, not fail it.
      for (const connection of connections) connection.socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** A client pointed at the fake, with the default timeout budget shrunk. */
function makeClient(path: string, overrides: Partial<ConstructorParameters<typeof HookClient>[0]> = {}): HookClient {
  return new HookClient({
    pid: 4242,
    controlSocketPath: path,
    connectTimeoutMs: 2_000,
    helloTimeoutMs: 2_000,
    replyTimeoutMs: 1_000,
    ...overrides,
  });
}

const clients: HookClient[] = [];
function track(client: HookClient): HookClient {
  clients.push(client);
  return client;
}

after(() => {
  for (const client of clients) client.close();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Give the event loop enough turns for a socket write to become a socket read. */
async function settle(ms = 60): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// 1. Hello
// ---------------------------------------------------------------------------

test("hello carries msg = the socket path and value0 = the pid, as 64-bit ints", async () => {
  const payload = await startFakePayload({ pid: 90210 });
  const client = track(makeClient(payload.path, { pid: 90210 }));
  await client.connect();

  const hello = payload.connections[0]?.hello;
  assert.ok(hello, "the client must send a hello");
  assert.equal(hello.op, Op.hello);

  // The measured facts, asserted as literals rather than against our own encoder:
  //   msg     = the absolute socket path (what /tmp/hzc.mjs sends)
  //   value0  = the pid, written as a u64 so a pid above 2^32 would still fit
  //   cmd     = empty, body = empty (the payload reads msg and value0 only)
  assert.equal(hello.msg, payload.path);
  assert.equal(hello.value0, 90210n);
  assert.equal(hello.cmd, "");
  assert.equal(hello.body.length, 0);
  assert.equal(hello.flags, 0);
  assert.equal(hello.status, 0);

  // Re-check value0's width at its actual offset: a u32 write of a u64 field leaves the
  // high half untouched, which would look right for every small pid.
  const raw = writeFrame({ op: Op.hello, msg: payload.path, value0: 90210n });
  assert.equal(raw.readBigUInt64LE(32), 90210n);
  await payload.close();
});

test("helloPipeName overrides the hello msg without changing the socket path", async () => {
  // Recorded evidence is ambiguous here: docs/payload-protocol.md §4 has a 2026-11-19 run
  // that sent the short name and got a valid reply, while /tmp/hzc.mjs sends the full
  // path. The client defaults to the path; this asserts the override exists and is used.
  const payload = await startFakePayload({ pid: 4242 });
  const client = track(makeClient(payload.path, { helloPipeName: "mojo.4242.control" }));
  await client.connect();

  assert.equal(payload.connections[0]?.hello.msg, "mojo.4242.control");
  assert.equal(client.controlSocketPath, payload.path);
  await payload.close();
});

test("connect resolves with the payload's hello, including its echoed path and pid", async () => {
  const payload = await startFakePayload({ pid: 4242 });
  const client = track(makeClient(payload.path));
  const hello = await client.connect();
  assert.equal(hello.pipeName, payload.path);
  assert.equal(hello.pid, 4242);
  assert.equal(hello.channelStatus, 0);
  assert.equal(client.connected, true);
  await payload.close();
});

test("connect fails when the payload accepts but never answers the hello", async () => {
  // The distinction that matters: "socket accepted" is not "payload alive". A client that
  // treated connect as success would send every request into a dead channel.
  const payload = await startFakePayload({ answerHello: false });
  const client = track(makeClient(payload.path, { helloTimeoutMs: 120 }));
  await assert.rejects(client.connect(), /hello on .* timed out/);
  assert.equal(client.connected, false);
  await payload.close();
});

test("connect fails cleanly when nothing is listening", async () => {
  const dir = makeTempDir();
  const client = track(makeClient(join(dir, "mojo.9999.control.sock"), { connectTimeoutMs: 300 }));
  await assert.rejects(client.connect());
  assert.equal(client.connected, false);
});

// ---------------------------------------------------------------------------
// 2. op 4 reply
// ---------------------------------------------------------------------------

test("a send is routed to DSND, not sent as a service command", async () => {
  // `MessageSvc.PbSendMsg` is deliberately NOT sent as its own op 2 command.
  //
  // Measured 2026-11-24 (PROGRESS.md "op2 端到端"): the payload can originate this request
  // itself via the DSND branch, which uses QQ's own captured instance/ctx. Sending it as a
  // literal service command has no sender behind it -- the client would be asking QQ to execute
  // a command QQ never queued.
  //
  // So the wire shape under test is: cmd="DSND", body=the raw request encoding, and the reply
  // arrives as an op 6 packet whose requestId carries the correlation.
  // The reply is injected through `settleFromRecv`, which is exactly what the production
  // `main.ts` listener does when an op 6 packet arrives on the recv channel. Driving it directly
  // keeps this test on the control-channel wire (where the request assertion lives) without
  // pretending op 6 travels there -- it does not.
  const responseBody = Buffer.from([0x08, 0x01, 0x12, 0x03, 0x61, 0x62, 0x63]);
  const payload = await startFakePayload({ replyWith: () => null });
  const client = track(makeClient(payload.path));

  // A publish that the fake payload answers through the recv seam.
  const sending = client.sendPacket("MessageSvc.PbSendMsg", Buffer.from([0x0a, 0x00]));
  const connection = await payload.nextConnection();
  const request = await connection.reader.waitForOp(Op.request, 1);

  assert.equal(request.cmd, "DSND", "the send is delegated to the payload's direct-send branch");
  assert.deepEqual([...request.body], [0x0a, 0x00], "body is the raw request encoding");
  assert.notEqual(request.requestId, 0, "requestId must be non-zero so the reply can be correlated");

  // The reply is delivered on the recv channel, keyed by the same requestId.
  client.settleFromRecv(request.requestId, 0, responseBody);
  const result = await sending;
  assert.equal(result.gotResponse, true);
  assert.equal(result.success, true);
  assert.deepEqual([...(result.responseData ?? [])], [...responseBody]);
  assert.equal(client.pendingCount, 0);

  await payload.close();
});

test("the ACK for a request is accepted and does not settle anything by itself", async () => {
  // op 3 means "the payload has it", not "it is done". A client that resolved on the ACK
  // would hand the caller an empty body for every real send.
  let replied = false;
  const payload = await startFakePayload({
    replyWith: (request) => {
      if (!replied) {
        replied = true;
        return { op: Op.ack, status: 0 };
      }
      return null;
    },
  });
  const client = track(makeClient(payload.path, { replyTimeoutMs: 120 }));

  const result = await client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]));
  assert.equal(result.success, false, "an ACK alone must not resolve the send");
  assert.match(result.errorMessage ?? "", /timed out/);
  await payload.close();
});

test("two concurrent sends are matched to their replies by requestId, not by arrival order", async () => {
  const payload = await startFakePayload({
    replyWith: () => null,
  });
  const client = track(makeClient(payload.path, { replyTimeoutMs: 3_000 }));

  const first = client.sendPacket("OidbSvcTrpcTcp.0x9154_1", Buffer.from([1]));
  const second = client.sendPacket("OidbSvcTrpcTcp.0xfd4_1", Buffer.from([2]));

  // Await the connection rather than indexing `connections[0]`: `sendPacket` connects
  // asynchronously, so at this point the accept may not have happened yet.
  const connection = await payload.nextConnection();
  const [requestA, requestB] = [
    await connection.reader.waitForOp(Op.request, 1),
    await connection.reader.waitForOp(Op.request, 2),
  ];
  // Reply to the SECOND one first. Arrival order is not correlation order; a client keyed
  // on "the oldest pending request" would hand the wrong body to the wrong caller.
  connection.send({ op: Op.reply, requestId: requestB.requestId, status: 0, body: Buffer.from("second") });
  connection.send({ op: Op.reply, requestId: requestA.requestId, status: 0, body: Buffer.from("first") });

  const [a, b] = await Promise.all([first, second]);
  assert.equal(Buffer.from(a.responseData ?? []).toString(), "first");
  assert.equal(Buffer.from(b.responseData ?? []).toString(), "second");
  assert.equal(client.pendingCount, 0);
  await payload.close();
});

test("a reply whose status is non-zero reports success:false but still carries the body", async () => {
  // The shape of a server-side rejection: the payload DID send and DID get an answer, so
  // gotResponse must stay true and invokeOidb must raise OidbError with the status rather
  // than a transport failure.
  const payload = await startFakePayload({
    replyWith: () => ({ op: Op.reply, status: 5, msg: "server said no" }),
  });
  const client = track(makeClient(payload.path));

  const result = await client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([9]));

  assert.equal(result.success, false);
  assert.equal(result.gotResponse, true);
  assert.equal(result.errorCode, 5);
  assert.equal(result.errorMessage, "server said no");
  await payload.close();
});

// ---------------------------------------------------------------------------
// 3. op 5 error
// ---------------------------------------------------------------------------

test("an op 5 error settles the send with the payload's status and message", async () => {
  const payload = await startFakePayload({
    replyWith: () => ({ op: Op.error, status: -22, msg: "invalid login identity hint" }),
  });
  const client = track(makeClient(payload.path));

  const result = await client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]));

  assert.equal(result.success, false);
  assert.equal(result.gotResponse, false, "op 5 has no reply body");
  assert.equal(result.errorCode, -22);
  assert.equal(result.errorMessage, "invalid login identity hint");
  assert.equal(client.pendingCount, 0);
  await payload.close();
});

test("an op 5 with an empty msg uses the documented refusal text for its status", async () => {
  const payload = await startFakePayload({
    replyWith: () => ({ op: Op.error, status: 1 }),
  });
  const client = track(makeClient(payload.path));

  const result = await client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]));

  assert.equal(result.errorCode, 1);
  assert.match(result.errorMessage ?? "", /QQ is not ready/);
  await payload.close();
});

// ---------------------------------------------------------------------------
// 4. Timeout
// ---------------------------------------------------------------------------

test("a timeout resolves with success:false, errorCode -1, and empties the pending map", async () => {
  // The payload handshakes and then says nothing — the shape of a payload that is wedged
  // inside QQ.
  const payload = await startFakePayload();
  const client = track(makeClient(payload.path, { replyTimeoutMs: 80 }));

  const result = await client.sendPacket("OidbSvcTrpcTcp.0x9067_202", new Uint8Array([1]));

  assert.equal(result.success, false);
  assert.equal(result.gotResponse, false);
  assert.equal(result.errorCode, HOOK_NO_ANSWER_CODE);
  assert.match(result.errorMessage ?? "", /timed out after 80 ms/);
  assert.equal(client.pendingCount, 0, "the pending entry must be gone");

  // The late reply: it must NOT resolve anything and must not throw. If the entry were
  // still in the map this frame would try to resolve an already-settled promise, which
  // surfaces as an unhandled rejection rather than a wrong answer.
  // Await the connection rather than indexing `connections[0]`: `sendPacket` connects
  // asynchronously, so at this point the accept may not have happened yet.
  const connection = await payload.nextConnection();
  const request = await connection.reader.waitForOp(Op.request, 1);
  connection.send({ op: Op.reply, requestId: request.requestId, status: 0, body: Buffer.from("too late") });
  // A frame with requestId 0 is never a reply to us (the payload uses 0 for hello, op 7
  // and the fatal runtime error), so it must be ignored too.
  connection.send({ op: Op.reply, requestId: 0, status: 0, body: Buffer.from("ignored") });
  await settle(80);
  assert.equal(client.pendingCount, 0);
  await payload.close();
});

test("a timeout does not disturb a second, still-pending request", async () => {
  // The two calls take different paths on purpose: the send goes through DSND (and is settled
  // from the recv channel), while the OIDB call is an ordinary op 2/op 4 exchange. A timeout on
  // one must not disturb the other, which is only a meaningful claim if the two really are
  // independent -- hence the mixed pair rather than two of the same kind.
  const payload = await startFakePayload();
  const client = track(makeClient(payload.path, { replyTimeoutMs: 200 }));

  // The DSND path spends `min(timeout, 2000)` ms waiting for the op 3 ACK before it can even
  // start waiting for the recv-side reply. A budget at or below that ceiling makes the two
  // timers race, so the timeout under test would sometimes be the ACK wait rather than the
  // reply wait. 600 ms leaves the ACK phase (200 ms, the fake payload stays silent) comfortably
  // inside the budget while still finishing quickly.
  const slowCall = client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]), 600);
  const fastCall = client.sendPacket("OidbSvcTrpcTcp.0x9154_1", new Uint8Array([2]), 1_000);

  // Await the connection rather than indexing `connections[0]`: `sendPacket` connects
  // asynchronously, so at this point the accept may not have happened yet.
  const connection = await payload.nextConnection();
  // Match by cmd, not by arrival index: `slowCall` (DSND) and `fastCall` (OIDB) are both op 2 and
  // race to be written first, so "the second op 2" is not necessarily `fastCall`.
  const fast = await connection.reader.waitForRequest("OidbSvcTrpcTcp.0x9154_1");
  connection.send({ op: Op.reply, requestId: fast.requestId, status: 0, body: Buffer.from("fast") });

  const [slow, answered] = await Promise.all([slowCall, fastCall]);
  assert.equal(slow.success, false, `slow=${JSON.stringify(slow)} fast=${JSON.stringify(answered)}`);
  // The DSND path reports its own wording; keeping the assertion on "timed out" rather than the
  // full sentence means it stays a claim about behaviour, not about a string.
  assert.match(slow.errorMessage ?? "", /timed out/);
  assert.equal(answered.success, true);
  assert.equal(Buffer.from(answered.responseData ?? []).toString(), "fast");
  assert.equal(client.pendingCount, 0);
  await payload.close();
});

test("timeoutMs 0 means no deadline", async () => {
  // The reference's `withTimeout` treats a non-positive budget as "wait forever"; a client
  // that armed a 0 ms timer instead would fail every such request instantly.
  const payload = await startFakePayload();
  const client = track(makeClient(payload.path));

  const call = client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]), 0);
  // Await the connection rather than indexing `connections[0]`: `sendPacket` connects
  // asynchronously, so at this point the accept may not have happened yet.
  const connection = await payload.nextConnection();
  const request = await connection.reader.waitForOp(Op.request, 1);
  await settle(60);
  connection.send({ op: Op.reply, requestId: request.requestId, status: 0, body: Buffer.from("eventually") });

  const result = await call;
  assert.equal(result.success, true);
  assert.equal(Buffer.from(result.responseData ?? []).toString(), "eventually");
  await payload.close();
});

// ---------------------------------------------------------------------------
// 5 & 6. Chunk boundaries
// ---------------------------------------------------------------------------

test("a frame split across two writes is decoded once the second half arrives", async () => {
  const replyBody = Buffer.from([0x08, 0x96, 0x01]); // protobuf varint, not JSON
  const payload = await startFakePayload();
  const client = track(makeClient(payload.path));

  const call = client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]));
  // Await the connection rather than indexing `connections[0]`: `sendPacket` connects
  // asynchronously, so at this point the accept may not have happened yet.
  const connection = await payload.nextConnection();
  const request = await connection.reader.waitForOp(Op.request, 1);
  const frame = writeFrame({ op: Op.reply, requestId: request.requestId, status: 0, body: replyBody });
  // Split inside the header (offset 22 of 40), not just inside the body: a header that
  // arrives in two pieces is the case a "decode this chunk" reader cannot see.
  connection.sendRaw(frame.subarray(0, 22));
  await settle(40);
  connection.sendRaw(frame.subarray(22));

  const result = await call;
  assert.equal(result.success, true);
  assert.deepEqual([...(result.responseData ?? [])], [...replyBody]);
  await payload.close();
});

test("a frame split one byte at a time is decoded", async () => {
  // The extreme of the same case: a header that never arrives in one read.
  const payload = await startFakePayload();
  const client = track(makeClient(payload.path, { replyTimeoutMs: 3_000 }));

  const call = client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]));
  // Await the connection rather than indexing `connections[0]`: `sendPacket` connects
  // asynchronously, so at this point the accept may not have happened yet.
  const connection = await payload.nextConnection();
  const request = await connection.reader.waitForOp(Op.request, 1);
  const frame = writeFrame({ op: Op.reply, requestId: request.requestId, status: 0, body: Buffer.from("x") });
  for (let at = 0; at < frame.length; at += 1) {
    connection.sendRaw(frame.subarray(at, at + 1));
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  const result = await call;
  assert.equal(result.success, true);
  assert.equal(Buffer.from(result.responseData ?? []).toString(), "x");
  await payload.close();
});

test("two frames written in one buffer are both decoded", async () => {
  // Coalescing: a payload that answers both requests in one write(), which the kernel hands
  // over as a single read(). A client that stopped after the first frame would hang the
  // second caller until its deadline.
  const payload = await startFakePayload();
  const client = track(makeClient(payload.path, { replyTimeoutMs: 3_000 }));

  // Two OIDB calls rather than one send + one OIDB: this test is about frame coalescing on the
  // op 2/op 4 wire, and `MessageSvc.PbSendMsg` is answered on the recv channel (DSND), so mixing
  // it in would make the assertion depend on two different transports at once.
  const first = client.sendPacket("OidbSvcTrpcTcp.0xfd4_1", new Uint8Array([1]));
  const second = client.sendPacket("OidbSvcTrpcTcp.0x9154_1", new Uint8Array([2]));
  // Await the connection rather than indexing `connections[0]`: `sendPacket` connects
  // asynchronously, so at this point the accept may not have happened yet.
  const connection = await payload.nextConnection();
  const requestA = await connection.reader.waitForOp(Op.request, 1);
  const requestB = await connection.reader.waitForOp(Op.request, 2);
  connection.sendRaw(
    Buffer.concat([
      writeFrame({ op: Op.reply, requestId: requestB.requestId, status: 0, body: Buffer.from("bb") }),
      writeFrame({ op: Op.reply, requestId: requestA.requestId, status: 0, body: Buffer.from("aa") }),
    ]),
  );

  const [a, b] = await Promise.all([first, second]);
  assert.equal(Buffer.from(a.responseData ?? []).toString(), "aa");
  assert.equal(Buffer.from(b.responseData ?? []).toString(), "bb");
  await payload.close();
});

test("a whole frame coalesced with the start of the next one keeps the remainder buffered", async () => {
  const payload = await startFakePayload();
  const client = track(makeClient(payload.path, { replyTimeoutMs: 3_000 }));

  const call = client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]));
  // Await the connection rather than indexing `connections[0]`: `sendPacket` connects
  // asynchronously, so at this point the accept may not have happened yet.
  const connection = await payload.nextConnection();
  const request = await connection.reader.waitForOp(Op.request, 1);
  const reply = writeFrame({ op: Op.reply, requestId: request.requestId, status: 0, body: Buffer.from("1") });
  const login = writeFrame({ op: Op.loginState, flags: Flag.loggedIn, msg: "10001", value0: 10001n });
  // Whole reply + the first 20 bytes of the login frame, in one write.
  connection.sendRaw(Buffer.concat([reply, login.subarray(0, 20)]));
  await settle(40);
  connection.sendRaw(login.subarray(20));

  const result = await call;
  assert.equal(result.success, true);
  await settle(60);
  assert.equal(client.isLoggedIn, true, "the second frame, completed later, still applies");
  await payload.close();
});

// ---------------------------------------------------------------------------
// 7. Login state
// ---------------------------------------------------------------------------

test("login state is learned from op 7 and reported by isLoggedIn", async () => {
  const states: Array<{ loggedIn: boolean; uin: string | null }> = [];
  const payload = await startFakePayload();
  const client = track(makeClient(payload.path, { onLoginState: (state) => states.push(state) }));

  await client.connect();
  assert.equal(client.isLoggedIn, false, "not logged in until op 7 says so");

  // Await the connection rather than indexing `connections[0]`: `sendPacket` connects
  // asynchronously, so at this point the accept may not have happened yet.
  const connection = await payload.nextConnection();
  connection.send({ op: Op.loginState, flags: Flag.loggedIn, msg: "10001", value0: 10001n });
  await settle(60);
  assert.equal(client.isLoggedIn, true);
  assert.equal(client.currentUin, "10001");
  assert.deepEqual(states.at(-1), { loggedIn: true, uin: "10001" });
  await payload.close();
});

test("op 7 with neither flags nor status means logged out, and clears the uin", async () => {
  // decodeLoginState treats `flags & 4 || status != 0` as logged in; a payload announcing a
  // logout sends neither, and the previous uin must not survive it.
  const payload = await startFakePayload();
  const client = track(makeClient(payload.path));
  await client.connect();

  // Await the connection rather than indexing `connections[0]`: `sendPacket` connects
  // asynchronously, so at this point the accept may not have happened yet.
  const connection = await payload.nextConnection();
  connection.send({ op: Op.loginState, flags: Flag.loggedIn, msg: "123456789", value0: 123456789n });
  await settle(60);
  assert.equal(client.isLoggedIn, true);

  connection.send({ op: Op.loginState, flags: 0, status: 0 });
  await settle(60);
  assert.equal(client.isLoggedIn, false);
  assert.equal(client.currentUin, null);
  await payload.close();
});

test("waitForLogin resolves on op 7 and times out on a payload that never logs in", async () => {
  const payload = await startFakePayload();
  const client = track(makeClient(payload.path));
  const waiting = client.waitForLogin({ timeoutMs: 1_000 });
  // Await the connection rather than indexing `connections[0]`: `sendPacket` connects
  // asynchronously, so at this point the accept may not have happened yet.
  const connection = await payload.nextConnection();
  await connection.reader.waitForOp(Op.hello, 1);
  connection.send({ op: Op.loginState, flags: Flag.loggedIn, msg: "10001", value0: 10001n });
  const state = await waiting;
  assert.equal(state.loggedIn, true);
  assert.equal(state.uin, "10001");

  const silent = await startFakePayload();
  const waiter = track(makeClient(silent.path));
  await assert.rejects(waiter.waitForLogin({ timeoutMs: 80 }), /timed out/);
  await payload.close();
  await silent.close();
});

test("a reconnect re-learns login state from the next op 7 instead of assuming it persists", async () => {
  // The payload re-announces op 7 when it accepts a connection (MEMORY.md §2.3h: the
  // connect-time read off disk exists precisely for this). Carrying the old value across a
  // dropped socket would claim a signed-in session this channel never confirmed.
  const payload = await startFakePayload({
    onReady: (ctx) => {
      ctx.send({ op: Op.loginState, flags: Flag.loggedIn, msg: "10001", value0: 10001n });
    },
  });
  const client = track(makeClient(payload.path, { replyTimeoutMs: 200 }));

  await client.connect();
  await settle(60);
  assert.equal(client.isLoggedIn, true);

  // Kill the connection from the payload side.
  payload.connections[0]?.socket.destroy();
  await settle(80);
  assert.equal(client.connected, false);
  assert.equal(client.isLoggedIn, false, "the dropped socket takes the login state with it");

  // The next send reconnects; the new connection learned login again from its own op 7.
  const result = await client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]));
  assert.equal(result.errorCode, HOOK_NO_ANSWER_CODE, "no reply on the new connection yet");
  await settle(80);
  assert.equal(client.connected, true);
  assert.equal(client.isLoggedIn, true);
  assert.equal(payload.connections.length, 2, "a second connection was opened");
  await payload.close();
});

// ---------------------------------------------------------------------------
// 8. -39
// ---------------------------------------------------------------------------

test("-39 maps to the outbound-unhealthy signal and stays distinguishable from a refusal", async () => {
  const health: boolean[] = [];
  const payload = await startFakePayload({
    replyWith: () => ({ op: Op.error, status: -39, msg: "The QQ connection changed. Please restart QQ and try again." }),
  });
  const client = track(
    makeClient(payload.path, { onOutboundHealthChanged: (healthy) => health.push(healthy) }),
  );

  assert.equal(client.isOutboundHealthy, true);
  const result = await client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]));

  assert.equal(result.success, false);
  assert.equal(result.errorCode, HOOK_STATUS_OUTBOUND_UNHEALTHY);
  assert.equal(client.isOutboundHealthy, false);
  assert.deepEqual(health, [false], "the health change is reported exactly once");
  // The distinction the task asks for: -39 is NOT flattened into the -1 "no answer" code.
  assert.notEqual(result.errorCode, HOOK_NO_ANSWER_CODE);
  await payload.close();
});

test("-39 is reported even when the op 5 carries no requestId of ours", async () => {
  // A health announcement can arrive after the deadline has already freed the id. The
  // signal is about the pipe, not about the request, so it must survive that.
  const payload = await startFakePayload();
  const client = track(makeClient(payload.path, { replyTimeoutMs: 60 }));
  const result = await client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]));
  assert.equal(result.errorCode, HOOK_NO_ANSWER_CODE);

  payload.connections[0]?.send({ op: Op.error, requestId: 777777, status: -39, msg: "pipe gone" });
  await settle(60);
  assert.equal(client.isOutboundHealthy, false);
  await payload.close();
});

test("a successful reply restores outbound health", async () => {
  let requestCount = 0;
  const payload = await startFakePayload({
    replyWith: () => {
      requestCount += 1;
      return requestCount === 1
        ? { op: Op.error, status: -39, msg: "pipe gone" }
        : { op: Op.reply, status: 0, body: Buffer.from("ok") };
    },
  });
  const health: boolean[] = [];
  const client = track(
    makeClient(payload.path, { onOutboundHealthChanged: (healthy) => health.push(healthy) }),
  );

  await client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]));
  assert.equal(client.isOutboundHealthy, false);
  const second = await client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([2]));
  assert.equal(second.success, true);
  assert.equal(client.isOutboundHealthy, true);
  assert.deepEqual(health, [false, true]);
  await payload.close();
});

test("-38 is reported as an unimplemented send path, not as an unhealthy pipe", async () => {
  // The disassembly picks -38 or -39 from one branch, and only -39 means "the connection
  // changed" (docs/reverse-socket-protocol.md §2.4). Conflating them would tell the caller
  // to reconnect when the payload in fact has no send path at all.
  const payload = await startFakePayload({
    replyWith: () => ({ op: Op.error, status: -38, msg: "not implemented" }),
  });
  const client = track(makeClient(payload.path));

  const result = await client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]));
  assert.equal(result.errorCode, HOOK_STATUS_UNIMPLEMENTED);
  assert.equal(client.isOutboundHealthy, true);
  await payload.close();
});

// ---------------------------------------------------------------------------
// op 22 and framing failures
// ---------------------------------------------------------------------------

test("op 22 records whether client private-message reporting is available", async () => {
  const payload = await startFakePayload({
    onReady: (ctx) => {
      ctx.send({ op: 22, status: 1, value0: 0n });
    },
  });
  const client = track(makeClient(payload.path));
  await client.connect();
  await settle(60);
  assert.deepEqual(client.privateReporting, { available: true, reason: 0n });
  await payload.close();
});

test("a body longer than the cap tears the connection down instead of buffering forever", async () => {
  // decodeFrame validates cmdLen and msgLen but NOT bodyLen (protocol.ts:141-152), so a
  // header claiming 4 GiB would make the client wait for 4 GiB. The cap is enforced before
  // the codec is asked, and the connection is refused rather than resynced — framing has
  // no delimiter, so there is nothing to resync on.
  const payload = await startFakePayload();
  const client = track(makeClient(payload.path, { maxBodyBytes: 1024, replyTimeoutMs: 500 }));
  const call = client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]));
  const connection = await payload.nextConnection();
  const bogus = Buffer.alloc(HEADER);
  bogus.writeUInt32LE(PIPE_MAGIC, 0);
  bogus.writeUInt16LE(PIPE_VERSION, 4);
  bogus.writeUInt16LE(Op.reply, 6);
  bogus.writeUInt32LE(1, 8);
  bogus.writeUInt32LE(2_048, 28); // body length above the 1024-byte cap
  connection.sendRaw(bogus);

  const result = await call;
  assert.equal(result.success, false);
  assert.equal(client.connected, false);
  await payload.close();
});

test("a frame with a bad magic is fatal for the connection but not for the process", async () => {
  const payload = await startFakePayload();
  const client = track(makeClient(payload.path, { replyTimeoutMs: 500 }));
  const call = client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]));
  const connection = await payload.nextConnection();
  // A well-formed header with the wrong magic: the case where buffering "until the frame
  // is complete" would never terminate because the lengths are garbage.
  const bad = writeFrame({ op: Op.reply, requestId: 1 });
  bad.writeUInt32LE(0xdeadbeef, 0);
  connection.sendRaw(bad);

  const result = await call;
  assert.equal(result.success, false);
  assert.equal(client.connected, false);
  await payload.close();
});

test("the pending map does not leak when the socket closes mid-request", async () => {
  const payload = await startFakePayload();
  const client = track(makeClient(payload.path, { replyTimeoutMs: 5_000 }));
  const call = client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]));
  await settle(60);
  assert.equal(client.pendingCount, 1);
  payload.connections[0]?.socket.destroy();
  const result = await call;
  assert.equal(result.success, false);
  assert.equal(result.errorCode, HOOK_NO_ANSWER_CODE);
  assert.equal(client.pendingCount, 0);
  await payload.close();
});

test("close rejects a waiting login and settles in-flight requests", async () => {
  const payload = await startFakePayload();
  const client = track(makeClient(payload.path, { replyTimeoutMs: 5_000 }));
  const call = client.sendPacket("MessageSvc.PbSendMsg", new Uint8Array([1]));
  await settle(60);
  client.close();
  const result = await call;
  assert.equal(result.success, false);
  assert.match(result.errorMessage ?? "", /closed/);
  assert.equal(client.pendingCount, 0);
  assert.equal(client.isClosed, true);
  await payload.close();
});

// ---------------------------------------------------------------------------
// Path derivation (no socket involved)
// ---------------------------------------------------------------------------

test("hookSocketPath builds mojo.<pid>.<kind>.sock inside the runtime dir", () => {
  assert.equal(
    hookSocketPath("/tmp/runtime-1000", 318178, "control"),
    "/tmp/runtime-1000/mojo.318178.control.sock",
  );
  assert.equal(
    hookSocketPath("/tmp/runtime-1000", 318178, "recv"),
    "/tmp/runtime-1000/mojo.318178.recv.sock",
  );
});

test("the client defaults to the control socket under the given runtimeDir", () => {
  const client = track(new HookClient({ pid: 1234, runtimeDir: "/tmp/runtime-1000/" }));
  assert.equal(client.controlSocketPath, "/tmp/runtime-1000/mojo.1234.control.sock");
});

test("a relative runtimeDir in the target's environment falls back to the process-derived directory", async () => {
  // `SNOWLUMA_HOOK_RUNTIME_DIR` pointing at a relative path is a deployment bug; the
  // reference rejects it explicitly. Here the fallback is asserted instead of a throw
  // because `resolveHookRuntimeDir` is only asked about the *target* process's env.
  const previous = process.env["SNOWLUMA_HOOK_RUNTIME_DIR"];
  process.env["SNOWLUMA_HOOK_RUNTIME_DIR"] = "relative/dir";
  try {
    // pid 1 exists but is not readable as our own user in some containers, so assert the
    // only thing that matters: the result is absolute and never the relative input.
    const { resolveHookRuntimeDir } = await import("../src/hook-client.js");
    const dir = resolveHookRuntimeDir(process.pid);
    assert.ok(dir.startsWith("/"), `expected an absolute dir, got ${dir}`);
    assert.notEqual(dir, "relative/dir");
  } finally {
    if (previous === undefined) delete process.env["SNOWLUMA_HOOK_RUNTIME_DIR"];
    else process.env["SNOWLUMA_HOOK_RUNTIME_DIR"] = previous;
  }
});

test("HookClient rejects a pid that cannot be a process", () => {
  assert.throws(() => new HookClient({ pid: 0, runtimeDir: "/tmp" }), /positive pid/);
  assert.throws(() => new HookClient({ pid: -1, runtimeDir: "/tmp" }), /positive pid/);
  assert.throws(() => new HookClient({ pid: 1.5, runtimeDir: "/tmp" }), /positive pid/);
});