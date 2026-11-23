// Tests for the highway session bootstrap and its cache.
//
// The transport is a one-method interface, so these tests use a fake rather than a
// socket: the interesting behaviour is the *classification* of failures (three
// distinct reasons that a log or a caller branches on) and the cache's
// in-flight-sharing, neither of which needs a real OIDB round trip.

import assert from "node:assert/strict";
import test from "node:test";

import {
  HighwaySessionCache,
  HighwaySessionError,
  fetchHighwaySession,
  type HighwaySessionTransport,
} from "../src/highway/session.js";
import { ProtoWriter } from "../src/oidb/wire.js";
import type { HighwaySession } from "../src/oidb/services/0x6ff.js";

/**
 * The four bytes of the fixed32 `ip` field.
 *
 * `httpConnAddrHost` renders the value low-byte-first (`value & 255` is the first
 * octet), so an address of `127.0.0.1` is the *number* `0x0100007f`. Writing that
 * number little-endian puts `7f 00 00 01` on the wire — the opposite of the
 * big-endian `0x7f000001` that the numeric form suggests. Getting this backwards
 * yields `1.0.0.127`, a valid-looking address that connects to nothing.
 */
function ipBytes(ip: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(ip >>> 0, 0);
  return buffer;
}

/** Encode an `HttpConn0x6FF501Response` with one serviceType-1 server. */
function sessionResponse(options: { sigSession?: Uint8Array; servers?: [number, number][] } = {}): Uint8Array {
  const { sigSession = new Uint8Array([9, 9, 9]), servers = [[0x0100007f, 8080]] } = options;

  const httpConn = new ProtoWriter();
  httpConn.bytes(1, sigSession);

  for (const [ip, port] of servers) {
    // `HttpConnServerAddr`: 1 type uint32, 2 ip **fixed32**, 3 port uint32, 4 area uint32.
    // `ip` is the only fixed32 field in this whole message family, so `ProtoWriter` has no
    // helper for it (the repo's writer is deliberately varint-only) and the five bytes are
    // emitted by hand: tag 0x15 = field 2, wire type 5.
    const addr = new ProtoWriter();
    addr.uint32(3, port);
    const addrBytes = Buffer.concat([Buffer.from(addr.finish()), Buffer.from([0x15]), ipBytes(ip)]);
    const info = new ProtoWriter();
    info.uint32(1, 1); // serviceType 1 = upload
    info.message(2, addrBytes);
    httpConn.message(3, info.finish());
  }

  // The response nests `httpConn` under OIDB field 1281 (the write-new-packet wrapper).
  const outer = new ProtoWriter();
  outer.message(1281, httpConn.finish());
  return outer.finish();
}

/** A transport that answers with `body` and reports success. */
function transportReturning(body: Uint8Array): HighwaySessionTransport & { calls: number } {
  const transport = {
    calls: 0,
    sendRawPacket: () => {
      transport.calls += 1;
      return Promise.resolve({ success: true, gotResponse: true, responseData: body });
    },
  };
  return transport;
}

test("a well-formed response yields a session with the sig_session and one server", async () => {
  const transport = transportReturning(sessionResponse());
  const session = await fetchHighwaySession(transport);
  assert.deepEqual([...session.sigSession], [9, 9, 9]);
  assert.equal(session.servers.length, 1);
  assert.equal(session.servers[0]?.host, "127.0.0.1");
  assert.equal(session.servers[0]?.port, 8080);
});

test("a failed OIDB call is reported as request_failed", async () => {
  const transport: HighwaySessionTransport = {
    sendRawPacket: () => Promise.resolve({ success: false, gotResponse: true, errorMessage: "nope" }),
  };
  await assert.rejects(fetchHighwaySession(transport), (error: unknown) => {
    assert.ok(error instanceof HighwaySessionError);
    assert.equal(error.reason, "request_failed");
    assert.equal(error.message, "nope");
    return true;
  });
});

test("a transport that throws is also request_failed, not a crash", async () => {
  const transport: HighwaySessionTransport = {
    sendRawPacket: () => Promise.reject(new Error("socket died")),
  };
  await assert.rejects(fetchHighwaySession(transport), (error: unknown) => {
    assert.ok(error instanceof HighwaySessionError);
    assert.equal(error.reason, "request_failed");
    assert.equal(error.message, "socket died");
    return true;
  });
});

test("undecodable bytes are response_decode_failed", async () => {
  // Truncated varint: the reader throws mid-tag.
  const transport = transportReturning(new Uint8Array([0xff, 0xff]));
  await assert.rejects(fetchHighwaySession(transport), (error: unknown) => {
    assert.ok(error instanceof HighwaySessionError);
    assert.equal(error.reason, "response_decode_failed");
    return true;
  });
});

test("a response with no sig_session is response_invalid, not decode failure", async () => {
  // The distinction matters: decode succeeded, so the bytes are fine and the server is
  // refusing the session. Collapsing this into decode_failed sends a debugger to the
  // codec when the problem is auth.
  const transport = transportReturning(sessionResponse({ sigSession: new Uint8Array(0) }));
  await assert.rejects(fetchHighwaySession(transport), (error: unknown) => {
    assert.ok(error instanceof HighwaySessionError);
    assert.equal(error.reason, "response_invalid");
    assert.match(error.message, /missing sig_session/);
    return true;
  });
});

test("a response with no usable servers is response_invalid", async () => {
  const transport = transportReturning(sessionResponse({ servers: [] }));
  await assert.rejects(fetchHighwaySession(transport), (error: unknown) => {
    assert.ok(error instanceof HighwaySessionError);
    assert.equal(error.reason, "response_invalid");
    assert.match(error.message, /no upload servers/);
    return true;
  });
});

test("duplicate host:port entries collapse to one server", async () => {
  // The real response repeats addresses across service-info entries; keeping them would
  // make the uploader's round-robin retry try the same dead server twice.
  const transport = transportReturning(
    sessionResponse({
      servers: [
        [0x0100007f, 8080],
        [0x0100007f, 8080],
        [0x0200007f, 9090],
      ],
    }),
  );
  const session = await fetchHighwaySession(transport);
  assert.equal(session.servers.length, 2);
  assert.deepEqual(
    session.servers.map((server) => `${server.host}:${server.port}`),
    ["127.0.0.1:8080", "127.0.0.2:9090"],
  );
});

test("the cache reuses a fresh session instead of re-bootstrapping", async () => {
  const transport = transportReturning(sessionResponse());
  const cache = new HighwaySessionCache(transport, 60_000);
  const first = await cache.get();
  const second = await cache.get();
  assert.equal(transport.calls, 1, "only one bootstrap");
  assert.equal(first, second, "the same session object is returned");
});

test("a session older than its TTL is refetched", async () => {
  const transport = transportReturning(sessionResponse());
  const cache = new HighwaySessionCache(transport, 0);
  await cache.get();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await cache.get();
  assert.equal(transport.calls, 2);
});

test("concurrent gets share one in-flight fetch", async () => {
  // Two images sent at once must not both bootstrap: the second ticket can invalidate
  // the first on some servers.
  let calls = 0;
  const transport: HighwaySessionTransport = {
    sendRawPacket: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { success: true, gotResponse: true, responseData: sessionResponse() };
    },
  };
  const cache = new HighwaySessionCache(transport);
  const [a, b, c] = await Promise.all([cache.get(), cache.get(), cache.get()]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(b, c);
});

test("a failed fetch does not poison the cache", async () => {
  // A transient OIDB timeout must be retryable; caching the rejection would break every
  // subsequent send for the process's lifetime.
  let calls = 0;
  const transport: HighwaySessionTransport = {
    sendRawPacket: async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return { success: true, gotResponse: true, responseData: sessionResponse() };
    },
  };
  const cache = new HighwaySessionCache(transport);
  await assert.rejects(cache.get(), /transient/);
  const session = await cache.get();
  assert.equal(calls, 2);
  assert.ok(session.sigSession.length > 0);
});

test("invalidate forces the next get to refetch", async () => {
  const transport = transportReturning(sessionResponse());
  const cache = new HighwaySessionCache(transport, 60_000);
  await cache.get();
  cache.invalidate();
  assert.equal(cache.peek(), null);
  await cache.get();
  assert.equal(transport.calls, 2);
});

test("peek does not fetch", () => {
  const transport = transportReturning(sessionResponse());
  const cache = new HighwaySessionCache(transport);
  assert.equal(cache.peek(), null);
  assert.equal(transport.calls, 0);
  assert.equal(cache.isFresh, false);
});

test("an aborted signal is honoured before the request is sent", async () => {
  const transport = transportReturning(sessionResponse());
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(fetchHighwaySession(transport, controller.signal), /cancelled/);
  assert.equal(transport.calls, 0);
});

test("the session type is re-exported for callers", () => {
  // Compile-time assertion: `HighwaySession` must be importable from session.js so an
  // uploader needs one import, not two.
  const session: HighwaySession = { sigSession: new Uint8Array(1), sessionKey: new Uint8Array(0), servers: [] };
  assert.equal(session.servers.length, 0);
});
