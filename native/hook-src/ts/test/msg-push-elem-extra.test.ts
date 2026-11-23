import assert from "node:assert/strict";
import test from "node:test";

import {
  DOCUMENTED_ELEM_TAGS,
  ELEM_GENERAL_FLAGS_DECODED_FIELD_NUMBERS,
  classifyUnknownElemTag,
  describeDecodedGeneralFlagsFields,
  documentedElemTagDecision,
  isDocumentedElemTag,
  matchesObservedShape,
} from "../src/msg-push-elem-extra.js";
import { WireType } from "../src/oidb/wire.js";

// ===========================================================================
// The four tags from the real 2.4.0 logs, pinned one test per tag.
// ===========================================================================
//
// Each case quotes the wire shape actually logged at
// `path=elem.generalFlags` on 2026-11-22, so the test fails loudly if the
// documented decision ever silently flips to "decode" and thereby invents
// field numbers the reference does not have.

test("tag 10 (varint, 1 byte) is IGNORE — no schema in the reference", () => {
  const decision = classifyUnknownElemTag(10, WireType.varint, 1);
  assert.equal(decision.action, "ignore");
  assert.match(decision.note, /no schema/);
  // The reference's own GeneralFlags decoder is the cited authority.
  assert.match(decision.note, /128384/);
  // ...and it falls through to the skip-and-record branch.
  assert.match(decision.note, /128502/);
});

test("tag 12 (varint, 1 byte) is IGNORE — no schema in the reference", () => {
  const decision = classifyUnknownElemTag(12, WireType.varint, 1);
  assert.equal(decision.action, "ignore");
  assert.match(decision.note, /no schema/);
  assert.match(decision.note, /128384/);
  assert.match(decision.note, /128502/);
});

test("tag 13 (varint, 1 byte) is IGNORE — no schema in the reference", () => {
  const decision = classifyUnknownElemTag(13, WireType.varint, 1);
  assert.equal(decision.action, "ignore");
  assert.match(decision.note, /no schema/);
  assert.match(decision.note, /128384/);
  assert.match(decision.note, /128502/);
});

test("tag 19 (length-delimited, 96..111 bytes) is IGNORE — a nested blob, not a flag", () => {
  for (const byteLength of [96, 103, 110, 111]) {
    const decision = classifyUnknownElemTag(19, WireType.lengthDelimited, byteLength);
    assert.equal(decision.action, "ignore", `bytes=${byteLength}`);
    assert.match(decision.note, /no schema/);
    // Tag 19 must not be described as a mere flag: it is a length-delimited
    // blob the reference skips opaquely.
    assert.match(decision.note, /__skipUnknownField|opaquely/);
    // The payload-vs-value-length arithmetic is documented, because the log
    // excludes the tag byte.
    assert.match(decision.note, /bytes-1/);
  }
});

// ===========================================================================
// Fail-open: anything outside {10,12,13,19} must NOT be silently swallowed.
// ===========================================================================

test("a tag NOT in {10,12,13,19} is not silently swallowed (fail-open)", () => {
  // Every tag in a plausible neighbourhood that this study did not establish.
  // 16 and 17 really do appear at path=elem.generalFlags in the same logs, yet
  // carry no documented decision here, so they must come back as "decode".
  const unstudied = [
    4, 5, 8, 9, 11, 14, 15, 16, 17, 18, 20, 21, 37, 99, 1000,
  ];
  for (const tag of unstudied) {
    const decision = classifyUnknownElemTag(tag, WireType.varint, 1);
    assert.equal(decision.action, "decode", `tag ${tag} must fail open`);
    assert.match(decision.note, /FAIL-OPEN/);
    assert.match(decision.note, new RegExp(`tag ${tag}`));
    // The note names the tags that *are* documented, so the gap is legible.
    assert.match(decision.note, /10, 12, 13, 19/);
  }
});

test("fail-open covers every wire type, not just the observed ones", () => {
  for (let wireType = 0; wireType <= 5; wireType++) {
    assert.equal(
      classifyUnknownElemTag(21, wireType, 4).action,
      "decode",
      `wireType=${wireType}`,
    );
  }
});

test("only the four documented tags ever return ignore", () => {
  const ignored: number[] = [];
  for (let tag = 1; tag <= 64; tag++) {
    if (classifyUnknownElemTag(tag, WireType.varint, 1).action === "ignore") {
      ignored.push(tag);
    }
  }
  assert.deepEqual(ignored, [10, 12, 13, 19]);
});

// ===========================================================================
// No invented field numbers.
// ===========================================================================

test("the studied tags do not collide with any field the schema really decodes", () => {
  // If one of 10/12/13/19 were actually a known GeneralFlags field, "ignore"
  // would be wrong. The reference decodes exactly 1, 2, 3, 6, 7.
  assert.deepEqual(
    [...ELEM_GENERAL_FLAGS_DECODED_FIELD_NUMBERS].sort((a, b) => a - b),
    [1, 2, 3, 6, 7],
  );
  for (const tag of DOCUMENTED_ELEM_TAGS) {
    assert.equal(
      ELEM_GENERAL_FLAGS_DECODED_FIELD_NUMBERS.has(tag),
      false,
      `tag ${tag} must not be a decoded field`,
    );
  }
});

test("DOCUMENTED_ELEM_TAGS is exactly {10,12,13,19} in study order", () => {
  assert.deepEqual([...DOCUMENTED_ELEM_TAGS], [10, 12, 13, 19]);
  assert.ok(Object.isFrozen(DOCUMENTED_ELEM_TAGS));
});

test("every documented decision is ignore with a non-empty note", () => {
  for (const tag of DOCUMENTED_ELEM_TAGS) {
    const decision = documentedElemTagDecision(tag);
    assert.ok(decision, `tag ${tag} must have a decision`);
    assert.equal(decision.action, "ignore");
    assert.ok(decision.note.length > 40, `tag ${tag} note must be substantive`);
  }
  // Undocumented tags have no decision at all — distinct from "decode".
  assert.equal(documentedElemTagDecision(16), undefined);
  assert.equal(isDocumentedElemTag(16), false);
  assert.equal(isDocumentedElemTag(10), true);
  assert.equal(isDocumentedElemTag("10"), false);
});

// ===========================================================================
// Argument validation: garbage in must throw, never be silently classified.
// ===========================================================================

test("invalid field numbers are rejected", () => {
  for (const tag of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => classifyUnknownElemTag(tag, WireType.varint, 1), RangeError);
  }
  // Type-level garbage from a JS caller.
  assert.throws(
    () => classifyUnknownElemTag("10" as unknown as number, WireType.varint, 1),
    RangeError,
  );
});

test("invalid wire types are rejected (6 and 7 are not on the wire)", () => {
  for (const wireType of [-1, 6, 7, 1.5, Number.NaN]) {
    assert.throws(() => classifyUnknownElemTag(10, wireType, 1), RangeError);
  }
});

test("invalid byte lengths are rejected", () => {
  for (const byteLength of [-1, 0.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => classifyUnknownElemTag(10, WireType.varint, byteLength), RangeError);
  }
  // Zero is a legal (if unusual) empty value encoding.
  assert.equal(classifyUnknownElemTag(10, WireType.varint, 0).action, "ignore");
});

// ===========================================================================
// Wire type does not change the decision — the reference switches on
// field<<3|wireType, so a documented tag with a surprise wire type is still
// skipped, and the note records the deviation.
// ===========================================================================

test("a documented tag keeps its decision under an unexpected wire type, and says so", () => {
  const decision = classifyUnknownElemTag(10, WireType.lengthDelimited, 7);
  assert.equal(decision.action, "ignore");
  assert.match(decision.note, /Observed as wireType=2 bytes=7/);
});

// ===========================================================================
// Shape helper — recognises exactly the logged shapes.
// ===========================================================================

test("matchesObservedShape accepts the logged shapes and rejects others", () => {
  assert.equal(matchesObservedShape(10, WireType.varint, 1), true);
  assert.equal(matchesObservedShape(12, WireType.varint, 1), true);
  assert.equal(matchesObservedShape(13, WireType.varint, 1), true);
  assert.equal(matchesObservedShape(19, WireType.lengthDelimited, 96), true);
  assert.equal(matchesObservedShape(19, WireType.lengthDelimited, 111), true);
  // Out-of-range / wrong wire type / unstudied tag.
  assert.equal(matchesObservedShape(19, WireType.varint, 1), false);
  assert.equal(matchesObservedShape(10, WireType.lengthDelimited, 1), false);
  assert.equal(matchesObservedShape(16, WireType.varint, 1), false);
});

// ===========================================================================
// Contrast: the five fields the reference really does decode.
// ===========================================================================

test("describeDecodedGeneralFlagsFields names the five real fields and their lines", () => {
  const description = describeDecodedGeneralFlagsFields();
  for (const line of [128412, 128430, 128448, 128464, 128482]) {
    assert.match(description, new RegExp(`L${line}`));
  }
  assert.match(description, /tags 10, 12, 13, 19 are not among them/);
});

// ===========================================================================
// Cross-check against Haizakura's generated decoder: the study's premise is
// that these tags decode to nothing. Assert it rather than assume it.
// ===========================================================================

test("decodeGeneralFlags leaves all five fields null for the studied tags", async () => {
  const { decodeGeneralFlags } = await import("../src/msg-push-fields.js");

  const varint = (n: number): number[] => {
    const out: number[] = [];
    let value = n;
    do {
      let byte = value & 0x7f;
      value = Math.floor(value / 128);
      if (value !== 0) byte |= 0x80;
      out.push(byte);
    } while (value !== 0);
    return out;
  };
  const tag = (field: number, wireType: number): number[] => varint(field * 8 + wireType);
  const lengthDelimited = (field: number, payload: number[]): number[] => [
    ...tag(field, 2),
    ...varint(payload.length),
    ...payload,
  ];

  const body = new Uint8Array([
    ...tag(10, 0), 1,
    ...tag(12, 0), 1,
    ...tag(13, 0), 1,
    ...lengthDelimited(19, new Array<number>(110).fill(0x08)),
  ]);

  assert.deepEqual(decodeGeneralFlags(body), {
    bubbleDiyTextId: null,
    groupFlagNew: null,
    uin: null,
    longTextFlag: null,
    longTextResId: null,
  });
});

test("decodeGeneralFlags does decode the five real fields, so ignore is a real distinction", async () => {
  const { decodeGeneralFlags } = await import("../src/msg-push-fields.js");

  const varint = (n: number): number[] => {
    const out: number[] = [];
    let value = n;
    do {
      let byte = value & 0x7f;
      value = Math.floor(value / 128);
      if (value !== 0) byte |= 0x80;
      out.push(byte);
    } while (value !== 0);
    return out;
  };
  const tag = (field: number, wireType: number): number[] => varint(field * 8 + wireType);
  const lengthDelimited = (field: number, payload: number[]): number[] => [
    ...tag(field, 2),
    ...varint(payload.length),
    ...payload,
  ];

  const body = new Uint8Array([
    ...tag(1, 0), 7,
    ...tag(2, 0), 8,
    ...tag(3, 0), 9,
    ...tag(6, 0), 10,
    ...lengthDelimited(7, [...Buffer.from("rid", "utf8")]),
  ]);

  assert.deepEqual(decodeGeneralFlags(body), {
    bubbleDiyTextId: 7,
    groupFlagNew: 8,
    uin: 9n,
    longTextFlag: 10,
    longTextResId: "rid",
  });
});
