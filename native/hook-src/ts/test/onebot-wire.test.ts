// The RFC 6455 codec, checked against the prebuilt native addon.
//
// The reference bundle never contains a frame parser: it `process.dlopen`s
// `websocket-<platform>-<arch>.node` (L339757) and calls into it for
// `Parser`, `buildFrame` and `computeAcceptKey` (L339786–339802). The port has
// to be pure TypeScript — no new dependencies, and a `.node` binary cannot be
// committed — so the addon's behaviour *is* the specification.
//
// Fixtures: onebot-fixtures/native-wire.json, produced by
// work/onebot-net/probe/record-wire.mjs, which loads the real addon and records
// its verdicts for a corpus covering every branch of the accept/reject ladder.
// probe/diff-frames.mjs is the exhaustive fuzzer used during development
// (6248/6248 randomised and hand-built cases identical); this file pins the
// representative corpus so regressions fail fast and deterministically.
//
// Two behaviours here are surprising enough that a naive port gets them wrong:
//
//   1. RSV validation is split. A *data* frame is checked against
//      `allowedRsv`; a *control* frame must have RSV == 0 regardless of
//      `allowedRsv` (recorded as `rsv/1-on-control`, which returns
//      "Control frame RSV bits must be zero"). The differential fuzzer found
//      this; reading the addon's disassembly would not have.
//   2. The check ORDER is observable, because the first failing rule names the
//      error. RSV before opcode, opcode before FIN, FIN before control size,
//      size before masking, masking before length minimality. Each ordering is
//      pinned by a case that violates two rules at once.
//
// `maxPayload` is per frame, not per message, and `0` means unlimited — an
// absent `maxPayload` also means unlimited. The parser never validates UTF-8
// (that is `Utf8Validator`'s job, separately) and never recovers from an error.

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { createHash } from "node:crypto";

import {
  FrameParser,
  buildFrame,
  computeAcceptKey,
  isValidCloseCode,
  truncateCloseReason,
  encodeClosePayload,
  opcodeLabel,
  Utf8Validator,
} from "../src/onebot/wire.js";
import { fixture } from "./onebot-harness.js";

interface FrameCase {
  opcode: number;
  fin: boolean;
  rsv: number;
  payloadLength: number;
  maskKeyHex: string | null;
  payloadHex: string;
  payloadFill: number | null;
  frameHex: string;
}

interface ParserCase {
  label: string;
  opts: { isServer?: boolean; maxPayload?: number; allowedRsv?: number };
  chunks: string[];
  results: Array<{ error?: true; code?: number; message?: string; frames?: Array<{ fin: boolean; rsv: number; opcode: number; payload: string }> }>;
  throws?: string | null;
}

const wire = fixture<{
  generatedBy: string;
  addon: string;
  frames: FrameCase[];
  accept: Array<{ key: string; accept: string; sha1: string }>;
  parser: ParserCase[];
}>("native-wire.json.gz");

const MASK = Buffer.from([0x11, 0x22, 0x33, 0x44]);
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Rebuild a recorded payload from its verbatim hex. */
function payloadOf(entry: { payloadHex: string }): Buffer {
  return Buffer.from(entry.payloadHex, "hex");
}

describe("onebot wire — buildFrame matches the native addon byte for byte", () => {
  test("every recorded frame encodes identically", () => {
    for (const entry of wire.frames) {
      const payload = payloadOf(entry);
      const maskKey = entry.maskKeyHex ? Buffer.from(entry.maskKeyHex, "hex") : null;
      const actual = buildFrame(entry.opcode, entry.fin, payload, maskKey, entry.rsv);
      assert.equal(actual.toString("hex"), entry.frameHex, `op=${entry.opcode} fin=${entry.fin} rsv=${entry.rsv} len=${entry.payloadLength}`);
      // Unmasked frames embed the payload verbatim; a masked one XORs it in
      // place, so only the unmasked cases can be checked this way.
      if (!entry.maskKeyHex) {
        assert.equal(sha256(actual.subarray(actual.length - entry.payloadLength)), sha256(payload), "payload bytes present");
      }
    }
  });

  test("length encoding switches at 125/126 and 65535/65536", () => {
    // [payload length, extra header bytes beyond opcode+marker, label]
    const cases: Array<[number, number, string]> = [
      [0, 0, "zero-length"],
      [125, 0, "7-bit max"],
      [126, 2, "16-bit marker"],
      [65535, 2, "16-bit max"],
      [65536, 8, "64-bit marker"],
    ];
    for (const [length, extraBytes, label] of cases) {
      const frame = buildFrame(1, true, Buffer.alloc(length, 0x61), null, 0);
      assert.equal(frame.length, 2 + extraBytes + length, `${label}: total`);
      assert.equal(frame[1], length <= 125 ? length : length <= 0xffff ? 126 : 127, `${label}: marker`);
    }
    // The 64-bit branch emits four zero bytes then a 32-bit value.
    const big = buildFrame(1, true, Buffer.alloc(65536, 0x61), null, 0);
    assert.deepEqual([...big.subarray(0, 10)], [0x81, 127, 0, 0, 0, 0, 0, 1, 0, 0], "64-bit length layout");
  });

  test("control frames echo their opcode and the FIN/RSV bits", () => {
    for (const opcode of [8, 9, 10]) {
      const frame = buildFrame(opcode, true, Buffer.from("x"), null, 0);
      assert.equal(frame[0], 0x80 | opcode, `opcode ${opcode}`);
    }
    const fragmented = buildFrame(1, false, Buffer.from("x"), null, 0);
    assert.equal(fragmented[0], 0x01, "FIN clear");
    const rsv1 = buildFrame(1, true, Buffer.from("x"), null, 0x40);
    assert.equal(rsv1[0], 0xc1, "RSV1 set");
  });

  test("a mask key is written verbatim before the masked payload", () => {
    const frame = buildFrame(1, true, Buffer.from("abcd"), MASK, 0);
    assert.equal(frame[1], 0x84, "mask bit + length");
    assert.deepEqual(frame.subarray(2, 6), MASK, "mask key bytes");
    // 0x61^0x11, 0x62^0x22, 0x63^0x33, 0x64^0x44
    assert.deepEqual(frame.subarray(6), Buffer.from([0x70, 0x40, 0x50, 0x20]), "masked payload");
  });
});

describe("onebot wire — accept key and sha1", () => {
  test("computeAcceptKey reproduces the addon", () => {
    for (const entry of wire.accept) {
      assert.equal(computeAcceptKey(entry.key), entry.accept, `key ${entry.key}`);
    }
  });

  test("the RFC 6455 sample vector holds", () => {
    assert.equal(computeAcceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });
});

describe("onebot wire — parser reproduces every addon verdict", () => {
  test("all recorded cases agree", () => {
    for (const entry of wire.parser) {
      const parser = new FrameParser(entry.opts);
      if (entry.throws) {
        assert.throws(
          () => parser.push(null as unknown as Buffer),
          (error: Error) => error.message === entry.throws,
          `${entry.label}: push(null) must throw`,
        );
        continue;
      }
      entry.chunks.forEach((chunk, index) => {
        const bytes = Buffer.from(chunk, "hex");
        const want = entry.results[index];
        assert.ok(want, `${entry.label}: no recorded result for chunk ${index}`);
        const got = parser.push(bytes);
        if (want.error) {
          assert.equal(got.error, true, `${entry.label}: chunk ${index} should have errored`);
          assert.equal(got.code, want.code, `${entry.label}: chunk ${index} code`);
          assert.equal(got.message, want.message, `${entry.label}: chunk ${index} message`);
        } else {
          assert.ok(!got.error, `${entry.label}: chunk ${index} should not have errored`);
          assert.deepEqual(
            got.frames.map((f) => ({ fin: f.fin, rsv: f.rsv, opcode: f.opcode, payload: f.payload.toString("hex") })),
            want.frames,
            `${entry.label}: chunk ${index} frames`,
          );
        }
      });
    }
  });

  test("the recorded ladder still names the surprising rules", () => {
    // Guard against the fixture being silently regenerated with a weaker corpus.
    const messages = new Set(wire.parser.filter((c) => c.results[0]?.message).map((c) => c.results[0]?.message as string));
    for (const message of [
      "Unexpected RSV bits",
      "Unknown opcode",
      "Control frame RSV bits must be zero",
      "Non-minimal 64-bit length",
      "Fragmented control frame",
      "Control frame too large",
      "Expected masked frame from client",
      "Server must not mask frames",
      "Non-minimal 16-bit length",
      "Non-minimal 64-bit length",
      "Payload length top bit set",
      "Payload exceeds configured max",
    ]) {
      assert.ok(messages.has(message), `fixture must cover: ${message}`);
    }
    const codes = new Set(wire.parser.filter((c) => c.results[0]?.code).map((c) => c.results[0]?.code as number));
    assert.deepEqual([...codes].sort(), [1002, 1009], "only 1002 and 1009 are used");
  });

  test("maxPayload is per frame, and only an ABSENT value means unlimited", () => {
    const parse = (opts: { isServer: boolean; maxPayload?: number }, length: number) =>
      new FrameParser(opts).push(buildFrame(1, true, Buffer.alloc(length, 0x61), MASK, 0));
    assert.ok(!parse({ isServer: true, maxPayload: 100 }, 100).error, "exactly max is allowed");
    assert.equal((parse({ isServer: true, maxPayload: 100 }, 101) as { code: number }).code, 1009);
    // 0 is a real zero-byte budget to the addon, not a sentinel: a 5-byte frame
    // under `maxPayload: 0` is rejected with 1009. The reference never passes 0
    // (L340094 defaults it to 104857600, config floors it at 1024), so this only
    // matters if someone hands the parser a raw options object.
    assert.equal((parse({ isServer: true, maxPayload: 0 }, 5) as { code: number }).code, 1009, "0 is a zero-byte limit");
    assert.ok(!parse({ isServer: true, maxPayload: 0 }, 0).error, "an empty frame still fits");
    assert.ok(!parse({ isServer: true }, 5).error, "absent means unlimited");
  });
});

describe("onebot wire — close codes and helpers", () => {
  test("isValidCloseCode matches the reference's allow-list", () => {
    // L339941 is a small explicit set plus the application range, and it is
    // NARROWER than RFC 6455: 1012/1013/1014 (the Service Restart / Try Again
    // Later / Bad Gateway codes) are rejected, as is everything in 1015..2999.
    // A port that "fixed" this to the RFC table would change observable
    // behaviour: `WebSocket.close(1012)` would start being accepted.
    for (const code of [1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 3000, 3999, 4999]) {
      assert.equal(isValidCloseCode(code), true, `code ${code}`);
    }
    for (const code of [999, 1004, 1005, 1006, 1012, 1013, 1014, 1015, 1999, 2999, 5000, 0, -1]) {
      assert.equal(isValidCloseCode(code), false, `code ${code}`);
    }
  });

  test("close reasons are truncated to 123 bytes, not 123 characters", () => {
    assert.equal(truncateCloseReason("hello").toString(), "hello");
    const ascii = "a".repeat(200);
    assert.equal(Buffer.byteLength(truncateCloseReason(ascii)), 123, "ASCII truncates at the byte budget");
    const cjk = "字".repeat(100);
    const truncated = truncateCloseReason(cjk).toString("utf8");
    assert.ok(Buffer.byteLength(truncated) <= 123, "never exceeds the budget");
    assert.ok(!truncated.endsWith("\uFFFD"), "never splits a code point");
    assert.equal(truncateCloseReason("").length, 0);
  });

  test("encodeClosePayload writes the code big-endian, bare when empty", () => {
    assert.deepEqual([...encodeClosePayload(1008)], [0x03, 0xf0]);
    assert.deepEqual([...encodeClosePayload(1000, "hi")], [0x03, 0xe8, 0x68, 0x69]);
    assert.deepEqual([...encodeClosePayload(undefined)], []);
    assert.deepEqual([...encodeClosePayload(undefined)], []);
  });

  test("opcodeLabel only names data frames, as the reference does", () => {
    // L339961 labels text and binary and nothing else — control frames come out
    // as `opcode 8` / `opcode 9` / `opcode 10`, and a continuation frame is
    // `opcode 0`. These strings reach log lines, so they are copied verbatim
    // rather than improved.
    assert.equal(opcodeLabel(1), "text");
    assert.equal(opcodeLabel(2), "binary");
    for (const opcode of [0, 3, 7, 8, 9, 10, 15]) {
      assert.equal(opcodeLabel(opcode), `opcode ${opcode}`, `opcode ${opcode}`);
    }
  });

  test("Utf8Validator rejects broken sequences and accepts split code points", () => {
    const good = new Utf8Validator();
    assert.equal(good.push(Buffer.from("héllo")), true);

    // A code point split across two chunks is legal.
    const bytes = Buffer.from("字", "utf8");
    const split = new Utf8Validator();
    assert.equal(split.push(bytes.subarray(0, 1)), true, "leading byte alone is pending, not invalid");
    assert.equal(split.push(bytes.subarray(1)), true, "completing the sequence is fine");

    for (const bad of [
      Buffer.from([0xff]),
      Buffer.from([0x80]),
      Buffer.from([0xe4, 0xbd]), // truncated at end without finish()
      Buffer.from("ab", "utf8").subarray(0, 1).length ? Buffer.concat([Buffer.from([0xe4]), Buffer.from("x")]) : Buffer.alloc(0),
    ]) {
      if (bad.length === 0) continue;
      const validator = new Utf8Validator();
      const ok = validator.push(bad) && validator.done();
      assert.equal(ok, false, `should reject ${bad.toString("hex")}`);
    }
  });
});