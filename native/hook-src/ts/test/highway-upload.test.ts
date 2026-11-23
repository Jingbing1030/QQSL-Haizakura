// Tests for the highway upload orchestrator.
//
// The uploader talks to real TCP sockets, so these tests stand up a fake highway
// server: a `net.Server` that speaks just enough HTTP/1.1 to accept a POST and
// answer with a framed `RespDataHighwayHead`. That is more work than stubbing the
// transport, but the retry and concurrency logic *is* the protocol — a stub would
// test the stub.
//
// What is deliberately NOT tested: the byte layout of the frame or the head (see
// highway-frame.test.ts), and `FileChunkSource` (it is four lines over `fs`).

import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import {
  BufferChunkSource,
  HIGHWAY_BLOCK_SIZE,
  HIGHWAY_DELAY_RETRY_CODES,
  HighwayUploadError,
  uploadHighway,
  type ChunkSource,
} from "../src/highway/upload.js";
import { packHighwayFrame } from "../src/highway/frame.js";
import { ProtoWriter } from "../src/oidb/wire.js";
import type { HighwayServer } from "../src/highway/transport.js";

/** Encode a `RespDataHighwayHead` with only the fields the uploader reads. */
function respHead(fields: {
  errorCode?: number;
  seq?: number;
  retCode?: number;
  filesize?: bigint;
  dataOffset?: bigint;
  dataLength?: number;
}): Uint8Array {
  // Field numbers are the RESPONSE head's, which differ from the request head's:
  //   1 msgBaseHead (message) · 2 msgSegHead (message) · 3 errorCode (varint)
  // Using the request's layout (errorCode=1, base=2, seg=3) shifts everything by one, and the
  // acknowledgement then compares SegHead.dataLength against the base-head seq. That produced
  // a test suite that passed while the field numbers were wrong, and a live upload that failed
  // with `ackSeq=70` (= the chunk size) — the fixture was wrong in exactly the same way as the
  // codec, which is the one failure mode a round-trip test cannot catch.
  const w = new ProtoWriter();
  if (fields.seq !== undefined) {
    const base = new ProtoWriter();
    base.uint32(4, fields.seq);
    w.message(1, base.finish());
  }
  const seg = new ProtoWriter();
  // SegHead: 1 serviceId · 2 filesize · 3 dataOffset · 4 dataLength · 5 retCode
  if (fields.filesize !== undefined) seg.uint64(2, fields.filesize);
  if (fields.dataOffset !== undefined) seg.uint64(3, fields.dataOffset);
  if (fields.dataLength !== undefined) seg.uint32(4, fields.dataLength);
  if (fields.retCode) seg.uint32(5, fields.retCode);
  w.message(2, seg.finish());
  if (fields.errorCode) w.uint32(3, fields.errorCode);
  return w.finish();
}

/** One request as the fake server saw it. */
interface Seen {
  offset: number;
  dataLength: number;
  filesize: bigint;
  seq: number;
  retryTimes: number;
  chunkMd5: Uint8Array;
}

/**
 * A fake highway server.
 *
 * `respond` is called per request and may return a frame body, or throw to simulate
 * a transport failure (the socket is destroyed).
 */
async function startFakeHighway(
  respond: (seen: Seen, index: number) => Uint8Array | Promise<Uint8Array>,
): Promise<{ server: HighwayServer; close: () => Promise<void>; requests: Seen[] }> {
  const requests: Seen[] = [];
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.subarray(0, headerEnd).toString("ascii");
      const match = header.match(/content-length:\s*(\d+)/i);
      const contentLength = match?.[1] ? Number.parseInt(match[1], 10) : 0;
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + contentLength) return;

      const frame = buffer.subarray(bodyStart, bodyStart + contentLength);
      buffer = buffer.subarray(bodyStart + contentLength);

      // Unpack just enough of the head to know which chunk this is. The full
      // decode lives in head.ts; re-deriving it here would test the codec twice.
      const headLen = frame.readUInt32BE(1);
      const head = frame.subarray(9, 9 + headLen);
      const seen = readHead(head);
      requests.push(seen);

      void (async () => {
        let answer: Uint8Array;
        try {
          answer = await respond(seen, requests.length - 1);
        } catch {
          socket.destroy();
          return;
        }
        const payload = packHighwayFrame(answer, new Uint8Array(0));
        socket.write(
          Buffer.concat([
            Buffer.from(
              `HTTP/1.1 200 OK\r\nContent-Length: ${payload.length}\r\n\r\n`,
              "ascii",
            ),
            Buffer.from(payload),
          ]),
        );
      })();
    });
    socket.on("error", () => undefined);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return {
    server: { host: "127.0.0.1", port: address.port },
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** Minimal `ReqDataHighwayHead` reader — only the fields the assertions need. */
function readHead(bytes: Uint8Array): Seen {
  const out: Seen = {
    offset: 0,
    dataLength: 0,
    filesize: 0n,
    seq: 0,
    retryTimes: 0,
    chunkMd5: new Uint8Array(0),
  };
  let i = 0;
  const varint = (): bigint => {
    let value = 0n;
    let shift = 0n;
    for (;;) {
      const byte = bytes[i++]!;
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7n;
    }
  };
  while (i < bytes.length) {
    const tag = Number(varint());
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire === 0) {
      const value = varint();
      // ReqDataHighwayHead: 1=msgBaseHead, 2=msgSegHead are length-delimited; only the
      // nested messages carry what we need, and they are handled below.
      if (field === 4) out.seq = Number(value);
      continue;
    }
    if (wire === 2) {
      const length = Number(varint());
      const nested = bytes.subarray(i, i + length);
      i += length;
      if (field === 1) {
        // DataHighwayHead: 5 = retryTimes
        let j = 0;
        const inner = (): bigint => {
          let value = 0n;
          let shift = 0n;
          for (;;) {
            const byte = nested[j++]!;
            value |= BigInt(byte & 0x7f) << shift;
            if ((byte & 0x80) === 0) return value;
            shift += 7n;
          }
        };
        while (j < nested.length) {
          const t = Number(inner());
          const f = t >>> 3;
          const w = t & 7;
          if (w === 0) {
            const v = inner();
            if (f === 5) out.retryTimes = Number(v);
          } else if (w === 2) {
            const len = Number(inner());
            j += len;
          } else break;
        }
      } else if (field === 2) {
        // SegHead: 2=filesize, 3=dataOffset, 4=dataLength, 8=md5
        let j = 0;
        const inner = (): bigint => {
          let value = 0n;
          let shift = 0n;
          for (;;) {
            const byte = nested[j++]!;
            value |= BigInt(byte & 0x7f) << shift;
            if ((byte & 0x80) === 0) return value;
            shift += 7n;
          }
        };
        while (j < nested.length) {
          const t = Number(inner());
          const f = t >>> 3;
          const w = t & 7;
          if (w === 0) {
            const v = inner();
            if (f === 2) out.filesize = v;
            else if (f === 3) out.offset = Number(v);
            else if (f === 4) out.dataLength = Number(v);
          } else if (w === 2) {
            const len = Number(inner());
            if (f === 8) out.chunkMd5 = nested.subarray(j, j + len);
            j += len;
          } else break;
        }
      }
      continue;
    }
    break;
  }
  return out;
}

/** Acknowledge whatever was asked for, with matching echo values. */
function ackFor(seen: Seen): Uint8Array {
  return respHead({
    seq: seen.seq,
    filesize: seen.filesize,
    dataOffset: BigInt(seen.offset),
    dataLength: seen.dataLength,
  });
}

const SESSION = { sigSession: new Uint8Array([1, 2, 3, 4]), servers: [] as HighwayServer[] };
const FILE_MD5 = new Uint8Array(16).fill(0xab);

test("a single-chunk upload is acknowledged and reports its size", async () => {
  const fake = await startFakeHighway((seen) => ackFor(seen));
  try {
    const bytes = new Uint8Array(1000).fill(7);
    const result = await uploadHighway(new BufferChunkSource(bytes), {
      uin: "10001",
      commandId: 1004,
      session: { ...SESSION, servers: [fake.server] },
      fileMd5: FILE_MD5,
    });
    assert.equal(result.chunks, 1);
    assert.equal(result.bytes, 1000);
    assert.equal(fake.requests.length, 1);
    assert.equal(fake.requests[0]?.offset, 0);
    assert.equal(fake.requests[0]?.dataLength, 1000);
    assert.equal(fake.requests[0]?.filesize, 1000n);
  } finally {
    await fake.close();
  }
});

test("a multi-chunk upload walks offsets in block-sized steps", async () => {
  const fake = await startFakeHighway((seen) => ackFor(seen));
  try {
    const size = HIGHWAY_BLOCK_SIZE * 2 + 500;
    const result = await uploadHighway(new BufferChunkSource(new Uint8Array(size)), {
      uin: "1",
      commandId: 1004,
      session: { ...SESSION, servers: [fake.server] },
      fileMd5: FILE_MD5,
    });
    assert.equal(result.chunks, 3);
    assert.deepEqual(
      fake.requests.map((request) => [request.offset, request.dataLength]),
      [
        [0, HIGHWAY_BLOCK_SIZE],
        [HIGHWAY_BLOCK_SIZE, HIGHWAY_BLOCK_SIZE],
        [HIGHWAY_BLOCK_SIZE * 2, 500],
      ],
    );
  } finally {
    await fake.close();
  }
});

test("each chunk carries its own md5, not the file's", async () => {
  // A chunk hashed with the file md5 uploads successfully but produces a file the
  // receiver rejects on integrity check — a long way from the mistake.
  const fake = await startFakeHighway((seen) => ackFor(seen));
  try {
    const first = new Uint8Array(HIGHWAY_BLOCK_SIZE).fill(1);
    const second = new Uint8Array(HIGHWAY_BLOCK_SIZE).fill(2);
    const bytes = new Uint8Array(HIGHWAY_BLOCK_SIZE * 2);
    bytes.set(first, 0);
    bytes.set(second, HIGHWAY_BLOCK_SIZE);
    await uploadHighway(new BufferChunkSource(bytes), {
      uin: "1",
      commandId: 1004,
      session: { ...SESSION, servers: [fake.server] },
      fileMd5: FILE_MD5,
    });
    const [a, b] = fake.requests;
    assert.notDeepEqual([...a!.chunkMd5], [...b!.chunkMd5], "different chunks must hash differently");
    assert.notDeepEqual([...a!.chunkMd5], [...FILE_MD5], "the chunk md5 is not the file md5");
  } finally {
    await fake.close();
  }
});

test("a backpressure code retries the SAME offset rather than skipping it", async () => {
  // 102902 means "slow down", not "failed". A loop that advanced on any response
  // would silently drop a megabyte of the file.
  assert.ok(HIGHWAY_DELAY_RETRY_CODES.has(102_902));
  let calls = 0;
  const fake = await startFakeHighway((seen) => {
    calls += 1;
    if (calls === 1) return respHead({ errorCode: 102_902 });
    return ackFor(seen);
  });
  try {
    const result = await uploadHighway(new BufferChunkSource(new Uint8Array(100)), {
      uin: "1",
      commandId: 1004,
      session: { ...SESSION, servers: [fake.server] },
      fileMd5: FILE_MD5,
    });
    assert.equal(result.chunks, 1);
    assert.equal(fake.requests.length, 2, "the retry re-sent the same chunk");
    assert.equal(fake.requests[0]?.offset, fake.requests[1]?.offset, "offset did not advance");
    assert.equal(fake.requests[1]?.retryTimes, 1, "retryTimes counts both retry kinds");
  } finally {
    await fake.close();
  }
});

test("a transport failure retries and eventually succeeds", async () => {
  let calls = 0;
  const fake = await startFakeHighway((seen) => {
    calls += 1;
    if (calls === 1) throw new Error("simulated socket death");
    return ackFor(seen);
  });
  try {
    const result = await uploadHighway(new BufferChunkSource(new Uint8Array(64)), {
      uin: "1",
      commandId: 1004,
      session: { ...SESSION, servers: [fake.server] },
      fileMd5: FILE_MD5,
    });
    assert.equal(result.chunks, 1);
    assert.equal(fake.requests.length, 2);
  } finally {
    await fake.close();
  }
});

test("a non-zero error code with no retry meaning fails the upload", async () => {
  const fake = await startFakeHighway(() => respHead({ errorCode: 12345 }));
  try {
    await assert.rejects(
      uploadHighway(new BufferChunkSource(new Uint8Array(64)), {
        uin: "1",
        commandId: 1004,
        session: { ...SESSION, servers: [fake.server] },
        fileMd5: FILE_MD5,
      }),
      (error: unknown) => {
        assert.ok(error instanceof HighwayUploadError);
        assert.equal(error.reason, "server_rejected");
        return true;
      },
    );
  } finally {
    await fake.close();
  }
});

test("a mismatched acknowledgement is rejected, not accepted", async () => {
  // The server acknowledges a DIFFERENT offset: it wrote someone else's chunk.
  // Accepting it would corrupt the file silently.
  const fake = await startFakeHighway(() =>
    respHead({ seq: 0, filesize: 64n, dataOffset: 999n, dataLength: 64 }),
  );
  try {
    await assert.rejects(
      uploadHighway(new BufferChunkSource(new Uint8Array(64)), {
        uin: "1",
        commandId: 1004,
        session: { ...SESSION, servers: [fake.server] },
        fileMd5: FILE_MD5,
      }),
      (error: unknown) => {
        assert.ok(error instanceof HighwayUploadError);
        assert.equal(error.reason, "ack_mismatch");
        assert.match(error.message, /acknowledgement mismatch/);
        return true;
      },
    );
  } finally {
    await fake.close();
  }
});

test("a source that returns the wrong length is reported as a source failure", async () => {
  // Reading past EOF is the common cause, and blaming the transport would send
  // whoever debugs it to the wrong layer.
  const short: ChunkSource = {
    size: 100,
    read: () => Promise.resolve(new Uint8Array(50)),
    close: () => Promise.resolve(),
  };
  const fake = await startFakeHighway((seen) => ackFor(seen));
  try {
    await assert.rejects(
      uploadHighway(short, {
        uin: "1",
        commandId: 1004,
        session: { ...SESSION, servers: [fake.server] },
        fileMd5: FILE_MD5,
      }),
      (error: unknown) => {
        assert.ok(error instanceof HighwayUploadError);
        assert.equal(error.reason, "source_read_failed");
        return true;
      },
    );
  } finally {
    await fake.close();
  }
});

test("an unreachable server fails without retrying pointlessly", async () => {
  // `connect_exhausted`, not `transport_exhausted`: connectHighway already tried
  // every server, so re-entering the chunk loop would just repeat the attempt.
  await assert.rejects(
    uploadHighway(new BufferChunkSource(new Uint8Array(64)), {
      uin: "1",
      commandId: 1004,
      session: { ...SESSION, servers: [{ host: "127.0.0.1", port: 1 }] },
      fileMd5: FILE_MD5,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HighwayUploadError);
      assert.equal(error.reason, "connect_exhausted");
      return true;
    },
  );
});
