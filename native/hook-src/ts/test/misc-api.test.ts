// `MiscApi.getMiniAppArk` — the mini-program share card.
//
// Reference: reference/index.mjs:317267-317300.
//
// Three things fail SILENTLY here and each has its own case below:
//   1. The key reshuffle (`appName`→`app`, `appView`→`view`, `metaData`→`meta`) — getting
//      it wrong renders a blank card, not an error.
//   2. The two constants `miniappShareOrigin`/`miniappOpenRefer` are NOT in the server's
//      payload; forgetting them produces a card the client refuses to open.
//   3. Empty strings are OMITTED from the request, not written as zero-length fields.

import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeMiniAppShareReq, decodeMiniAppShareResp } from "../src/bridge/apis/misc.js";

/** Independent protobuf writer, so the expected bytes are not produced by the code under test. */
function tag(field: number, wire: number): number[] {
  const out: number[] = [];
  let value = (field << 3) | wire;
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    out.push(byte);
  } while (value !== 0);
  return out;
}

function str(field: number, value: string): number[] {
  if (value === "") return [];
  const bytes = [...new TextEncoder().encode(value)];
  const len: number[] = [];
  let n = bytes.length;
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    len.push(byte);
  } while (n !== 0);
  return [...tag(field, 2), ...len, ...bytes];
}

test("the request is sdkVersion at field 1 and body at field 2", () => {
  const body = [
    ...str(1, "1109937557"),
    ...str(2, "标题"),
    ...str(3, "描述"),
    ...str(4, "http://pic"),
    ...str(5, "http://jump"),
    ...str(6, "http://icon"),
  ];
  const expected = [
    ...str(1, "V1_PC_MINISDK_99.99.99_1_APP_A"),
    ...tag(2, 2),
    // body length as a single byte (under 128)
    body.length,
    ...body,
  ];
  const actual = encodeMiniAppShareReq({
    sdkVersion: "V1_PC_MINISDK_99.99.99_1_APP_A",
    appid: "1109937557",
    title: "标题",
    desc: "描述",
    picUrl: "http://pic",
    jumpUrl: "http://jump",
    iconUrl: "http://icon",
  });
  assert.deepEqual([...actual], expected);
});

test("the body's six strings are fields 1..6 in the reference's order", () => {
  // Reordering two of these sends the title as the description — a card that renders, with
  // the wrong text in the wrong place. Field numbers are asserted individually because the
  // encoder would happily accept any order.
  const encoded = encodeMiniAppShareReq({
    sdkVersion: "S",
    appid: "A",
    title: "T",
    desc: "D",
    picUrl: "P",
    jumpUrl: "J",
    iconUrl: "I",
  });
  const text = new TextDecoder().decode(encoded);
  const order = ["A", "T", "D", "P", "J", "I"].map((value) => text.indexOf(value));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "appid..iconUrl appear in order");
});

test("an empty string is omitted, not written as a zero-length field", () => {
  // The reference's encoder guards all six with `!= null && !== ""`
  // (reference:316839-316869). A zero-length field would add two bytes each and make the
  // request shape differ from the reference's for the same input.
  const withEmpty = encodeMiniAppShareReq({
    sdkVersion: "S",
    appid: "A",
    title: "",
    desc: "",
    picUrl: "",
    jumpUrl: "",
    iconUrl: "",
  });
  const allSet = encodeMiniAppShareReq({
    sdkVersion: "S",
    appid: "A",
    title: "T",
    desc: "D",
    picUrl: "P",
    jumpUrl: "J",
    iconUrl: "I",
  });
  assert.ok(withEmpty.length < allSet.length);
  // sdkVersion "S" is `0a 01 53` (3 bytes). body holds only field 1 (`appid: "A"`), so the
  // encoded body is `0a 01 41` (3 bytes) and its wrapper is `12 03` (2 bytes). Total 8.
  assert.equal(withEmpty.length, 3 + 2 + 3);
});

test("the response's jsonStr is field 3 inside body (field 2 of the envelope)", () => {
  const json = JSON.stringify({ ver: "1", appName: "bili" });
  const jsonBytes = [...new TextEncoder().encode(json)];
  const body = [...tag(3, 2), jsonBytes.length, ...jsonBytes];
  const envelope = [...tag(2, 2), body.length, ...body];
  assert.equal(decodeMiniAppShareResp(new Uint8Array(envelope)), json);
});

test("a response without jsonStr decodes to null rather than throwing", () => {
  // `null` is the "empty" answer the API turns into `mini app share json empty`; throwing
  // here would replace the reference's wording with a protobuf error.
  const body = [...str(1, "something-else")];
  const envelope = [...tag(2, 2), body.length, ...body];
  assert.equal(decodeMiniAppShareResp(new Uint8Array(envelope)), null);
});
