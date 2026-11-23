// Raw upgrade-response bytes, replayed against the TypeScript listener.
//
// Fixtures: ref-ws-handshake.json, captured with a bare `net` socket in
// work/onebot-net/probe/harness-handshake.mjs — no HTTP client, no WebSocket
// library, so what is compared here is the exact byte sequence the reference
// wrote, including the abort heads built by `abortUpgrade` (L340457).
//
// Why this test exists at all: `abortUpgrade` in the reference is written from a
// multi-line template literal whose continuation lines end in a bare `\r`. Read
// as source it looks like it emits a malformed response
// (`Connection: close\r` + `\n`). The recorded `hex` fields prove the wire bytes
// are a well-formed `\r\n`. A port that copied the source literally would emit
// the malformed version, and reading the response back through any HTTP client
// would hide it — only the raw bytes show the difference.
//
// The 101 baseline also pins the header SET and ORDER: exactly
//   HTTP/1.1 101 Switching Protocols
//   Upgrade: websocket
//   Connection: Upgrade
//   Sec-WebSocket-Accept: <base64>
// with no `Sec-WebSocket-Protocol` echo (none configured) and no
// `Sec-WebSocket-Extensions` echo (permessage-deflate unset).

import { strict as assert } from "node:assert";
import { describe, test, after } from "node:test";
import net from "node:net";

import { WsServerAdapter } from "../src/onebot/ws.js";
import { WebSocketServer } from "../src/onebot/websocket.js";
import { RecordingApi, CONTRACTS, fixture, makeCtx } from "./onebot-harness.js";

interface HandshakeCase {
  name: string;
  note?: string;
  request: string;
  response: string;
  hex?: string;
}

const recorded = fixture<{ generatedBy: string; cases: HandshakeCase[] }>("ref-ws-handshake.json");

/** The fixed nonce the harness uses, so the 101 accept value is reproducible. */
const KEY = "dGhlIHNhbXBsZSBub25jZQ==";

/**
 * Send raw bytes and collect whatever comes back until the peer goes quiet.
 * `null` request means "open a socket and send nothing" (the plain-HTTP probe).
 */
function rawExchange(port: number, request: string | null, quietMs = 250): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const chunks: Buffer[] = [];
    let timer: NodeJS.Timeout;
    const done = () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(Buffer.concat(chunks));
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(done, quietMs);
    };
    socket.on("connect", () => {
      arm();
      if (request !== null) socket.write(request);
    });
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      arm();
    });
    socket.on("error", reject);
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
  });
}

/**
 * Compare bytes. The 426 responses are produced by Node's own
 * `writeHead(426)` path, which injects a `Date` header, so that one line is
 * normalized on both sides; everything else is compared literally.
 */
function normalize(text: string): string {
  return text.replace(/^Date: .*\r\n/m, "");
}

function assertBytes(actual: Buffer, expectedHex: string | undefined, expectedText: string, label: string): void {
  const got = normalize(actual.toString("binary"));
  if (expectedHex) {
    const want = normalize(Buffer.from(expectedHex, "hex").toString("binary"));
    assert.equal(got, want, `${label}: raw bytes`);
    return;
  }
  assert.equal(got, normalize(expectedText), `${label}: bytes`);
}

describe("onebot ws upgrade — raw response bytes", () => {
  let adapter: WsServerAdapter;
  let port: number;

  async function ensureServer(): Promise<void> {
    if (adapter) return;
    adapter = new WsServerAdapter(
      "ws-raw",
      {
        name: "ws-raw",
        host: "127.0.0.1",
        port: 0,
        path: "/",
        role: "Universal",
        accessToken: "tok",
        messageFormat: "array",
        reportSelfMessage: false,
      },
      makeCtx(new RecordingApi(CONTRACTS)),
    );
    await adapter.open();
    port = adapter.boundPort;
  }

  after(async () => {
    await adapter?.close();
  });

  for (const name of [
    "unauthorized",
    "bad_path",
    "method_post",
    "bad_key",
    "no_key",
    "wrong_version",
    "no_upgrade_header",
    "bad_connection_header",
  ]) {
    test(`${name}: abort head is byte-identical`, async () => {
      await ensureServer();
      const entry = recorded.cases.find((c) => c.name === name);
      assert.ok(entry, `fixture case ${name} missing`);
      const request = entry.request === "" ? null : entry.request.replace(/Host: 127\.0\.0\.1:\d+/, `Host: 127.0.0.1:${port}`);
      const actual = await rawExchange(port, request);
      assertBytes(actual, entry.hex, entry.response, name);
    });
  }

  for (const name of ["ok", "upgrade_case_insensitive", "protocol_offered_not_supported", "deflate_offered_not_accepted"]) {
    test(`${name}: 101 head is byte-identical and the frames follow`, async () => {
      await ensureServer();
      const entry = recorded.cases.find((c) => c.name === name);
      assert.ok(entry, `fixture case ${name} missing`);
      const request = entry.request.replace(/Host: 127\.0\.0\.1:\d+/, `Host: 127.0.0.1:${port}`);
      const actual = await rawExchange(port, request);
      const text = actual.toString("binary");
      const headEnd = text.indexOf("\r\n\r\n");
      assert.ok(headEnd > 0, `${name}: no head terminator`);
      const head = text.slice(0, headEnd + 4);
      const wantHead = (entry.response as string).slice(0, (entry.response as string).indexOf("\r\n\r\n") + 4);
      assert.equal(head, wantHead, `${name}: 101 head`);

      // The bytes after the head are unmasked server frames: opcode 1, FIN, and
      // a payload length that must line up exactly with the bootstrap frames.
      const frames = actual.subarray(Buffer.byteLength(head, "binary"));
      const json: string[] = [];
      let offset = 0;
      while (offset + 2 <= frames.length) {
        const first = frames[offset] as number;
        const second = frames[offset + 1] as number;
        assert.equal(first & 0x0f, 1, `${name}: expected a text frame`);
        assert.equal(first & 0x80, 0x80, `${name}: expected FIN`);
        assert.equal(second & 0x80, 0, `${name}: server frames must be unmasked`);
        // Bootstrap frames straddle 125 bytes, so both length forms appear:
        // 7-bit, then 126 + big-endian u16.
        const marker = second & 0x7f;
        let length = marker;
        offset += 2;
        if (marker === 126) {
          length = frames.readUInt16BE(offset);
          offset += 2;
        } else {
          assert.ok(marker < 126, `${name}: unexpected length marker ${marker}`);
        }
        json.push(frames.subarray(offset, offset + length).toString("utf8"));
        offset += length;
      }
      assert.equal(json.length, 3, `${name}: three bootstrap frames`);
      assert.deepEqual(
        json.map((line) => (JSON.parse(line) as { meta_event_type?: string }).meta_event_type),
        ["lifecycle", "lifecycle", "heartbeat"],
        `${name}: bootstrap order`,
      );
    });
  }

  test("a plain HTTP GET to a port-only listener answers 426 with a body", async () => {
    // The `WebSocketServer` class installs its own request handler when it owns
    // the port (L340560), so a non-upgrade request gets this fixed response
    // rather than the `http` module's default. Recorded as
    // `plain_http_to_ws_port`; note the Date header is Node's, not the port's.
    const entry = recorded.cases.find((c) => c.name === "plain_http_to_ws_port");
    assert.ok(entry, "fixture case plain_http_to_ws_port missing");
    const standalone = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => standalone.once("listening", resolve));
    const standalonePort = (standalone.address() as { port: number }).port;
    try {
      const request = ["GET / HTTP/1.1", `Host: 127.0.0.1:${standalonePort}`, "", ""].join("\r\n");
      const actual = await rawExchange(standalonePort, request);
      assertBytes(actual, entry.hex, entry.response, "plain_http_to_ws_port");
    } finally {
      await new Promise<void>((resolve) => standalone.close(() => resolve()));
    }
  });

  test("the 101 accept value equals base64(sha1(key + GUID))", async () => {
    await ensureServer();
    const request = `GET /?access_token=tok HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${KEY}\r\nSec-WebSocket-Version: 13\r\n\r\n`;
    const actual = await rawExchange(port, request);
    const text = actual.toString("binary");
    // The recorded value for this exact nonce is the RFC 6455 example value.
    assert.ok(
      text.includes("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="),
      `expected the RFC 6455 sample accept value, got:\n${text.slice(0, 300)}`,
    );
  });

  test("a request whose Sec-WebSocket-Key is the wrong shape is rejected before any accept", async () => {
    await ensureServer();
    for (const key of ["", "short", "dGhlIHNhbXBsZSBub25jZQ=", `${"A".repeat(24)}`]) {
      const request = `GET /?access_token=tok HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`;
      const actual = (await rawExchange(port, request)).toString("binary");
      assert.ok(actual.startsWith("HTTP/1.1 400 Bad Request\r\n"), `key ${JSON.stringify(key)} must be rejected`);
      assert.ok(actual.endsWith("Invalid Sec-WebSocket-Key"), "and with that exact wording");
    }
  });
});