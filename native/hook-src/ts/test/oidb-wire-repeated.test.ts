// Regression tests for two ProtoWriter behaviours that were latent bugs:
//   * a non-numeric initial capacity hung the grow loop instead of failing
//   * there was no way to write a repeated uint32 at all

import assert from "node:assert/strict";
import test from "node:test";

import { ProtoReader, ProtoWriter, WireType } from "../src/oidb/wire.js";

test("ProtoWriter survives a non-numeric initial capacity", () => {
  // The original code did `new Uint8Array(Math.max(16, NaN))`, which yields length 0, and
  // #ensure then looped `cap *= 2` on 0 forever. A writer built from an object where a length
  // was expected is the realistic way to hit this, and the symptom was a hang, not an error.
  const writer = new ProtoWriter(Number.NaN as unknown as number);
  writer.uint32(1, 300);
  const bytes = writer.finish();
  const reader = new ProtoReader(bytes);
  assert.equal(reader.next(), true);
  assert.equal(reader.uint32(), 300);
});

test("ProtoWriter starts from a usable floor when given zero capacity", () => {
  const writer = new ProtoWriter(0);
  writer.string(1, "haizakura");
  const bytes = writer.finish();
  const reader = new ProtoReader(bytes);
  assert.equal(reader.next(), true);
  assert.equal(reader.string(), "haizakura");
});

test("repeatedUint32 writes one tag per element, zeros included", () => {
  // Non-packed is deliberate: an element that is zero must still emit a tag, because the
  // reference's generated encoder does. Encoding 1,0,1 as packed would produce different bytes
  // for the same decoded value.
  const writer = new ProtoWriter();
  writer.repeatedUint32(7, [1, 0, 1]);
  const bytes = writer.finish();
  // tag(7,varint)=0x38 appears three times, each followed by its value
  const tags = [...bytes].filter((b) => b === 0x38).length;
  assert.equal(tags, 3, `expected three 0x38 tags, bytes=${[...bytes].join(",")}`);
});

test("repeatedUint32 round-trips through ProtoReader", () => {
  const writer = new ProtoWriter();
  writer.repeatedUint32(3, [5, 0, 4294967295]);
  const reader = new ProtoReader(writer.finish());
  const seen: number[] = [];
  while (reader.next()) {
    assert.equal(reader.wireType, WireType.varint);
    seen.push(reader.uint32());
  }
  assert.deepEqual(seen, [5, 0, 4294967295]);
});

test("repeatedUint32 emits nothing for an empty list", () => {
  const writer = new ProtoWriter();
  writer.repeatedUint32(9, []);
  assert.equal(writer.finish().length, 0);
});

test("packedUint32 uses one tag and a length prefix", () => {
  const writer = new ProtoWriter();
  writer.packedUint32(7, [1, 0, 1]);
  const bytes = writer.finish();
  // exactly one 0x3a tag (field 7, wire type 2), then len 3, then 01 00 01
  assert.equal([...bytes].filter((b) => b === 0x3a).length, 1);
  assert.deepEqual([...bytes], [0x3a, 3, 1, 0, 1]);
});
