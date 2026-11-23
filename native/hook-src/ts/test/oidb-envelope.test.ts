// OIDB envelope codec tests.
//
// These are deliberately NOT round-trip tests.  A round-trip passes even when
// both sides are wrong in the same way, which is exactly the failure mode that
// matters here: a port that invents a field number still round-trips perfectly
// and still talks to the server in the wrong dialect.
//
// So the primary assertions are golden byte vectors extracted from the
// reference's own generated encoders.  work/oidb/probe/golden.mjs evaluates a
// `protobuf_encode_*` function out of reference/index.mjs together with every
// helper it closes over, runs a fixed input through it, and prints the hex.  The
// vectors below are those hex strings verbatim; if a field number, a presence
// rule or a length prefix in this port drifts, the hex stops matching.
//
// The remaining tests cover the decoder's adversarial side: bounds checks,
// unknown-field skipping, and the meta-only fast path used for error detection.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OidbBaseField,
  OidbPropertyField,
  makeOidbEnvelope,
  encodeOidbEnvelope,
  decodeOidbEnvelope,
  decodeOidbBaseMeta,
  decodeOidbResponse,
  encodeOidbProperty,
  decodeOidbProperty,
  oidbErrorCode,
  oidbWireName,
  OidbError,
} from "../src/oidb/envelope.js";
import {
  ProtoWriter,
  ProtoReader,
  UnknownFieldCollector,
  encodeUtf8,
  decodeUtf8,
  WireType,
  EMPTY_UNKNOWN_FIELD_METADATA,
} from "../src/oidb/wire.js";

const hex = (input: Uint8Array): string => Buffer.from(input).toString("hex");
const bytes = (source: string): Uint8Array => Uint8Array.from(Buffer.from(source, "hex"));

// ---------------------------------------------------------------------------
// Golden vectors
// ---------------------------------------------------------------------------

test("envelope with an empty body matches the reference byte for byte", () => {
  // reference/index.mjs:337990 protobuf_encode_OidbBase__OidbClientKeyReq with
  // body {} — command 4138 = 0x102a, subCommand 1, reserved 0.
  const env = makeOidbEnvelope(0x102a, 1, new Uint8Array(0), false);
  assert.equal(hex(encodeOidbEnvelope(env)), "08aa2010012200");
});

test("envelope reserved=1 (uinForm) puts 0x60 0x01 on the wire", () => {
  // groupark_0x8b7_5 from the probe: command 0x8b7, sub 5, reserved 1.
  const body = bytes("080110bdbc84352801"); // reqType=1, groupCode=111222333, flag=1
  const env = makeOidbEnvelope(0x8b7, 5, body, true);
  assert.equal(hex(encodeOidbEnvelope(env)), "08b71110052209" + "080110bdbc84352801" + "6001");
});

test("dropping reserved=0 costs no bytes (proto3 default is omitted)", () => {
  const env = makeOidbEnvelope(0x89a, 0, bytes("080110bdbc8435"), false);
  const encoded = encodeOidbEnvelope(env);
  // 0x89a = 2202, sub 0 is the default so field 2 is dropped as well.
  assert.equal(hex(encoded), "089a11" + "2210080110bdbc8435".replace("2210", "2207"));
  assert.ok(!encoded.includes(0x60), "field 12 must be absent when reserved is 0");
});

test("field numbers of the envelope are the ones the reference writes", () => {
  // Written as a table so a renumbering shows up as a diff, not as a mystery.
  assert.deepEqual(
    { ...OidbBaseField },
    { command: 1, subCommand: 2, errorCode: 3, body: 4, errorMsg: 5, properties: 11, reserved: 12 },
  );
  assert.deepEqual({ ...OidbPropertyField }, { key: 1, value: 2 });
});

// ---------------------------------------------------------------------------
// Status-field handling
// ---------------------------------------------------------------------------

test("a server error code survives the meta fast path and raises OidbError", () => {
  // Build a response by hand: command 0xfe5, sub 2, errorCode 1, errorMsg "x".
  const writer = new ProtoWriter()
    .uint32(OidbBaseField.command, 0xfe5)
    .uint32(OidbBaseField.subCommand, 2)
    .uint32(OidbBaseField.errorCode, 1)
    .string(OidbBaseField.errorMsg, "nope");
  const meta = decodeOidbBaseMeta(writer.finish());
  assert.equal(meta.command, 0xfe5);
  assert.equal(meta.subCommand, 2);
  assert.equal(meta.errorCode, 1);
  assert.equal(meta.errorMsg, "nope");
  assert.equal(oidbErrorCode(meta), 1);

  assert.throws(
    () => decodeOidbResponse({ command: 0xfe5, subCommand: 2 }, writer.finish(), () => ({})),
    (err) => {
      assert.ok(err instanceof OidbError);
      assert.equal(err.code, 1);
      assert.equal(err.serverMsg, "nope");
      assert.equal(err.command, 0xfe5);
      assert.equal(err.subCommand, 2);
      assert.match(err.message, /OIDB error 1 on 0xfe5_2: nope/);
      return true;
    },
  );
});

test("acceptedEnvelopeCodes lets a negative result through", () => {
  // 0x6d6_0 reports "file already exists" via the envelope, and the spec list
  // is how the reference keeps that from becoming a thrown error.
  const writer = new ProtoWriter()
    .uint32(OidbBaseField.command, 0x6d6)
    .uint32(OidbBaseField.errorCode, 0x11)
    .message(OidbBaseField.body, new Uint8Array(0))
    .uint32(OidbBaseField.reserved, 1);
  const decoded = decodeOidbResponse(
    { command: 0x6d6, subCommand: 0, acceptedEnvelopeCodes: [0x11] },
    writer.finish(),
    () => ({ ok: true }),
  );
  assert.equal(decoded.errorCode, 0x11);
  assert.deepEqual(decoded.body, { ok: true });
});

test("a zero error code is not an error", () => {
  assert.equal(oidbErrorCode({ errorCode: 0 }), null);
  assert.equal(oidbErrorCode({ errorCode: null }), null);
  assert.equal(oidbErrorCode({ errorCode: 7 }), 7);
});

test("a field-3 varint is decoded as uint32, not int32", () => {
  // Error codes are unsigned on the wire; a value above 2^31 must survive.
  const writer = new ProtoWriter().uint32(OidbBaseField.errorCode, 0xffffffff);
  assert.equal(decodeOidbBaseMeta(writer.finish()).errorCode, 0xffffffff);
});

test("reserved is decoded as a signed int32, matching the reference's `| 0`", () => {
  // reference/index.mjs:19047 uses `_f4 = _val | 0` for field 12 while the other
  // varint fields are left unsigned.  Preserved here because a port that quietly
  // "fixes" this is no longer byte-compatible with the reference.
  const writer = new ProtoWriter().uint32(OidbBaseField.reserved, 0xffffffff);
  assert.equal(decodeOidbBaseMeta(writer.finish()).reserved, -1);
});

// ---------------------------------------------------------------------------
// Body presence
// ---------------------------------------------------------------------------

test("absent body decodes to null, present-but-empty body decodes to a value", () => {
  const absent = new ProtoWriter().uint32(OidbBaseField.command, 1).finish();
  assert.equal(decodeOidbEnvelope(absent, () => ({ seen: true })).body, null);

  const present = new ProtoWriter().uint32(OidbBaseField.command, 1).message(OidbBaseField.body, new Uint8Array(0)).finish();
  assert.deepEqual(decodeOidbEnvelope(present, () => ({ seen: true })).body, { seen: true });
  // And the present-but-empty case really costs two bytes on the wire.
  assert.equal(present.length, absent.length + 2);
});

test("body decoder receives the exact sub-range", () => {
  const inner = bytes("0a03616263");
  const encoded = new ProtoWriter()
    .uint32(OidbBaseField.command, 7)
    .message(OidbBaseField.body, inner)
    .uint32(OidbBaseField.reserved, 1)
    .finish();
  let observed = null;
  decodeOidbEnvelope(encoded, (data, offset, end) => {
    observed = { offset, end, slice: Buffer.from(data.subarray(offset, end)).toString("hex") };
    return {};
  });
  assert.deepEqual(observed, { offset: encoded.indexOf(inner[0]!), end: encoded.length - 2, slice: "0a03616263" });
});

test("properties round-trip through field 11", () => {
  const property = { key: "k", value: bytes("0102") };
  const env = makeOidbEnvelope(1, 0, new Uint8Array(0));
  env.properties = [property];
  const decoded = decodeOidbEnvelope(encodeOidbEnvelope(env), () => ({}));
  assert.equal(decoded.properties.length, 1);
  const first = decoded.properties[0]!;
  assert.equal(first.key, "k");
  assert.equal(hex(first.value), "0102");
  assert.equal(hex(encodeOidbProperty(property)), "0a016b12020102");
  assert.deepEqual(decodeOidbProperty(encodeOidbProperty(property)), property);
});

// ---------------------------------------------------------------------------
// Unknown fields
// ---------------------------------------------------------------------------

test("unknown fields are skipped, counted, and never throw", () => {
  // Append every skippable wire type the server might send.
  const writer = new ProtoWriter()
    .uint32(OidbBaseField.command, 0x8b7)
    // field 60, varint
    .uint32(60, 5)
    // field 61, fixed64 (hand-encoded: tag 0xfd 0x03 -> not expressible via helpers)
    ;
  const base = writer.finish();
  const extra = Uint8Array.from([
    0xf9, 0x03, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, // field 63, fixed64
    0x82, 0x04, 0x02, 0xaa, 0xbb, // field 64, length-delimited
    0x9d, 0x04, 0x01, 0x02, 0x03, 0x04, // field 67, fixed32
  ]);
  const combined = new Uint8Array(base.length + extra.length);
  combined.set(base, 0);
  combined.set(extra, base.length);

  const decoded = decodeOidbEnvelope(combined, () => ({}));
  assert.equal(decoded.command, 0x8b7);
  assert.equal(decoded.unknown.totalOccurrences, 4);
  assert.deepEqual(
    decoded.unknown.fields.map((f: { fieldNumber: number; wireType: number; count: number }) => [f.fieldNumber, f.wireType, f.count]),
    [
      [60, WireType.varint, 1],
      [63, WireType.fixed64, 1],
      [64, WireType.lengthDelimited, 1],
      [67, WireType.fixed32, 1],
    ],
  );
});

test("an empty message reports the empty metadata singleton shape", () => {
  const decoded = decodeOidbEnvelope(new Uint8Array(0), () => ({}));
  assert.deepEqual(decoded.unknown, EMPTY_UNKNOWN_FIELD_METADATA);
  assert.equal(decoded.body, null);
});

test("the unknown-field list is capped at 64 entries, the rest are counted only", () => {
  const collector = new UnknownFieldCollector();
  for (let i = 0; i < 70; i++) collector.record(100 + i, WireType.varint, 2);
  const snapshot = collector.snapshot();
  assert.equal(snapshot.fields.length, 64);
  assert.equal(snapshot.totalOccurrences, 70);
  assert.equal(snapshot.omittedOccurrences, 6);
  assert.equal(snapshot.omittedByteLength, 12);
});

test("repeated occurrences of one unknown field collapse to a single entry", () => {
  const collector = new UnknownFieldCollector();
  collector.record(7, WireType.varint, 2);
  collector.record(7, WireType.varint, 3);
  const snapshot = collector.snapshot();
  assert.equal(snapshot.fields.length, 1);
  const only = snapshot.fields[0]!;
  assert.equal(only.count, 2);
  assert.equal(only.totalByteLength, 5);
  assert.equal(snapshot.totalOccurrences, 2);
});

// ---------------------------------------------------------------------------
// Adversarial input
// ---------------------------------------------------------------------------

test("a length that runs past the buffer throws instead of slicing", () => {
  // field 4, length 10, but only 2 bytes follow.
  const truncated = Uint8Array.from([0x22, 0x0a, 0x01, 0x02]);
  assert.throws(() => decodeOidbEnvelope(truncated, () => ({})), /exceeds parent bounds/);
});

test("a truncated varint throws", () => {
  const truncated = Uint8Array.from([0x08, 0x80]); // field 1, continuation with no next byte
  assert.throws(() => decodeOidbEnvelope(truncated, () => ({})), /Truncated protobuf varint/);
});

test("field number 0 is rejected", () => {
  assert.throws(() => decodeOidbEnvelope(Uint8Array.from([0x00]), () => ({})), /field number/);
});

test("an invalid wire type on an unknown field is rejected", () => {
  // tag = field 15, wire type 6 -> falls to the unknown branch, where wire type
  // 6 has no representation and must throw rather than silently consume bytes.
  // (Field 15 keeps the tag inside one byte: 15 << 3 | 6 === 126.)
  const bad = Uint8Array.from([15 * 8 + 6]);
  assert.throws(() => decodeOidbEnvelope(bad, () => ({})), /invalid wire type/);
});

test("a known field arriving with the wrong wire type is skipped, not misparsed", () => {
  // The reference switches on the whole tag, so field 4 as a varint is an
  // unknown field rather than a nested body. Following it here matters: a
  // server that sent this would otherwise have its body misread as a message.
  const wrong = new ProtoWriter().uint32(OidbBaseField.command, 7).uint32(OidbBaseField.body, 5).finish();
  const decoded = decodeOidbEnvelope(wrong, () => ({ seen: true }));
  assert.equal(decoded.command, 7);
  assert.equal(decoded.body, null);
  assert.equal(decoded.unknown.totalOccurrences, 1);
  assert.equal(decoded.unknown.fields[0]?.fieldNumber, OidbBaseField.body);
  assert.equal(decoded.unknown.fields[0]?.wireType, WireType.varint);
});

test("a varint wider than 32 bits is truncated to its low 32 bits, not rejected", () => {
  // The reference's generated decoders drop bits past the 32nd rather than
  // erroring (reference/index.mjs:248540: `if (_s < 32) _val |= ...`).  A wide
  // varint is exactly how a negative int32 reaches the wire, so rejecting it
  // would break every negative retCode.
  //
  // field 1 = ten-byte varint of -1 -> low 32 bits are 0xffffffff.
  const negative = Uint8Array.from([0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
  assert.equal(decodeOidbBaseMeta(negative).command, 0xffffffff);

  // field 1 with the value 0x1_0000_0001 -> truncated to 1.
  const wide = Uint8Array.from([0x08, 0x81, 0x80, 0x80, 0x80, 0x10]);
  assert.equal(decodeOidbBaseMeta(wide).command, 1);
});

test("an over-wide varint is still rejected when it exceeds 64 bits", () => {
  // Eleven continuation bytes cannot fit in a u64, so the tenth byte carries a
  // bit above 63 and the reference throws (`if (_s === 63 && _b > 1)`).
  const eleventh = Uint8Array.from([0x08, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x02]);
  assert.throws(() => decodeOidbBaseMeta(eleventh), /varint/);
});

test("out-of-range bounds are rejected before any read", () => {
  const data = new Uint8Array(4);
  assert.throws(() => new ProtoReader(data, 0, 5), /Invalid protobuf bounds/);
  assert.throws(() => new ProtoReader(data, -1, 4), /Invalid protobuf bounds/);
  assert.throws(() => new ProtoReader(data, 3, 1), /Invalid protobuf bounds/);
});

test("an unterminated group throws rather than looping", () => {
  // field 1 start-group, then the buffer just ends.
  const data = Uint8Array.from([0x0b]);
  const reader = new ProtoReader(data);
  assert.ok(reader.next());
  assert.throws(() => reader.skip(), /unterminated group/);
});

// ---------------------------------------------------------------------------
// Writer primitives
// ---------------------------------------------------------------------------

test("presence rules match the reference's per-type conditions", () => {
  const w = new ProtoWriter()
    .uint32(1, 0) // dropped
    .uint32(2, 1) // kept
    .bool(3, false) // dropped
    .bool(4, true) // kept
    .string(5, "") // dropped
    .string(6, "a") // kept
    .bytes(7, new Uint8Array(0)) // dropped
    .bytes(8, Uint8Array.from([9])) // kept
    .message(9, new Uint8Array(0)) // kept even when empty
    .message(10, null) // dropped
    .repeatedMessage(11, []); // dropped
  // field 1 uint32=0 dropped, field 2 uint32=1 kept (tag 0x10), field 3 bool=false
  // dropped, field 4 bool=true kept (tag 0x20), field 5 "" dropped, field 6 "a"
  // kept (tag 0x32), field 7 empty bytes dropped, field 8 [9] kept (tag 0x42),
  // field 9 empty message kept (tag 0x4a), fields 10/11 dropped.
  assert.equal(hex(w.finish()), "1001" + "2001" + "320161" + "420109" + "4a00");
});

test("a uint32 above the signed range still encodes as five bytes", () => {
  assert.equal(hex(new ProtoWriter().uint32(1, 0xffffffff).finish()), "08ffffffff0f");
});

test("a uint64 round-trips through the writer and reader", () => {
  const value = 0xdeadbeefcafebaben;
  const encoded = new ProtoWriter().uint64(3, value).finish();
  assert.equal(encoded[0], 0x18);
  const reader = new ProtoReader(encoded);
  assert.ok(reader.next());
  assert.equal(reader.uint64(), value);
});

test("int32 sign-extends a negative value to the 64-bit varint the reference writes", () => {
  // The reference does `BigInt.asUintN(64, ...)`, so -1 becomes ten bytes of 0xff.
  const encoded = new ProtoWriter().int32(1, -1).finish();
  assert.equal(hex(encoded), "08ffffffffffffffffff01");
});

test("UTF-8 encode/decode agrees with TextEncoder on multi-byte text", () => {
  const samples = ["", "ascii", "群号", "emoji 🎉", "\u0000null"];
  for (const s of samples) {
    assert.equal(decodeUtf8(encodeUtf8(s)), s);
    assert.deepEqual(Array.from(encodeUtf8(s)), Array.from(Buffer.from(s, "utf8")));
  }
});

test("malformed UTF-8 decodes to replacement characters instead of throwing", () => {
  assert.equal(decodeUtf8(Uint8Array.from([0xff, 0xfe])), Buffer.from([0xff, 0xfe]).toString("utf8"));
});

test("the writer grows past its initial capacity", () => {
  const w = new ProtoWriter(16);
  const big = new Uint8Array(1000).fill(0x41);
  w.bytes(1, big);
  const out = w.finish();
  assert.equal(out.length, 1003);
  assert.equal(out[out.length - 1], 0x41);
});

// ---------------------------------------------------------------------------
// Names and selection
// ---------------------------------------------------------------------------

test("wire names use lower-case unpadded hex", () => {
  assert.equal(oidbWireName(0x8b7, 5), "OidbSvcTrpcTcp.0x8b7_5");
  assert.equal(oidbWireName(0x102a, 0), "OidbSvcTrpcTcp.0x102a_0");
  assert.equal(oidbWireName(4098, 0), "OidbSvcTrpcTcp.0x1002_0");
  assert.equal(oidbWireName(0xfe5, 2), "OidbSvcTrpcTcp.0xfe5_2");
});