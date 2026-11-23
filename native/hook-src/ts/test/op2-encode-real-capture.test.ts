/**
 * op2 send encoding, pinned byte-for-byte against a REAL reference transmission.
 *
 * On 2026-11-22 the SnowLuma 2.4.0 reference (`hz-test`, UIN 10001) sent
 * `hz-op2-proof-r5-1447` to group 958146070 and its own hook trace recorded the
 * 50-byte `MessageSvc.PbSendMsg` request:
 *
 *   TRACE [QQHook.Packet] packet_send serviceCmd="MessageSvc.PbSendMsg" requestId=9
 *     length=50
 *     body=0a0812060896ccf0c803120208011a1c0a1a12180a160a14687a2d6f70
 *         322d70726f6f662d72352d313434372888ff948102
 *
 * This test feeds our own encoder the same logical message and asserts the output
 * is byte-identical. That is a much stronger claim than "the fields look right":
 * it pins field numbers, nesting, varint encoding, and — critically — the
 * `random` placement at field 5, which is what a receiver correlates against.
 *
 * See `docs/op2-real-send-proof.md` for the full four-line trace including the
 * correlated op4 reply.
 *
 * What this does NOT prove: that our send path can actually transmit. This is
 * pure encode parity. Transport (binding a PID, arming the injector, awaiting the
 * correlated op4) is unverified — see PROGRESS.md.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeSendMessageRequestRichText } from "../src/bridge/apis/message-wire.js";

/** The exact 50 bytes the reference put on the wire. */
const REFERENCE_REQUEST_HEX =
  "0a0812060896ccf0c803120208011a1c0a1a12180a160a14687a2d6f70322d70726f6f662d72352d313434372888ff948102";

const GROUP_ID = 958146070;
const RANDOM = 539312008;
const TEXT = "hz-op2-proof-r5-1447";

/** Minimal field writer, so the fixture does not depend on the code under test. */
function varint(value: number): number[] {
  const out: number[] = [];
  let v = value >>> 0;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return out;
}

function lengthDelimited(fieldNumber: number, bytes: readonly number[]): number[] {
  return [(fieldNumber << 3) | 2, ...varint(bytes.length), ...bytes];
}

test("our encoder reproduces the reference's 50-byte request exactly", () => {
  // Elem{ text: TextElem{ str } } is four levels of nesting; build it from the
  // outside in so a mistake in one level is visible rather than accidental.
  const textElem = lengthDelimited(1, [...Buffer.from(TEXT, "utf8")]);
  const elem = lengthDelimited(1, textElem);
  const richText = lengthDelimited(1, elem);

  const encoded = encodeSendMessageRequestRichText({
    routingHead: { grp: { groupCode: BigInt(GROUP_ID) } },
    contentHead: { type: 1 },
    messageBody: { richText: { elems: [Uint8Array.from(elem)] } },
    clientSequence: 0,
    random: RANDOM,
    syncCookie: new Uint8Array(0),
    via: 0,
    dataStatist: 0,
    multiSendSeq: 0,
  });

  const actual = Buffer.from(encoded).toString("hex");
  assert.equal(actual.length, 100, "50 bytes = 100 hex chars");
  assert.equal(actual, REFERENCE_REQUEST_HEX, "op2 request must be byte-identical to the reference");
});

test("the encoded request carries the message text and the random at field 5", () => {
  const encoded = encodeSendMessageRequestRichText({
    routingHead: { grp: { groupCode: BigInt(GROUP_ID) } },
    contentHead: { type: 1 },
    messageBody: {
      richText: { elems: [Uint8Array.from(lengthDelimited(1, lengthDelimited(1, [...Buffer.from(TEXT, "utf8")])))] },
    },
    clientSequence: 0,
    random: RANDOM,
    syncCookie: new Uint8Array(0),
    via: 0,
    dataStatist: 0,
    multiSendSeq: 0,
  });

  // The text must appear literally, so a future refactor that swaps encodings or
  // drops the elem body is caught.
  assert.ok(
    Buffer.from(encoded).toString("latin1").includes(TEXT),
    "the marked text must be present verbatim in the request",
  );

  // Field 5 varint must decode back to the random the caller passed — this is the
  // value QQ echoes into the receipt, so a shift here silently breaks recall.
  const tail = Buffer.from(encoded).toString("hex");
  assert.ok(tail.endsWith("2888ff948102"), `field 5 must encode random=${String(RANDOM)}`);
});

test("a different random changes only field 5 — the rest of the envelope is stable", () => {
  const build = (random: number) =>
    Buffer.from(
      encodeSendMessageRequestRichText({
        routingHead: { grp: { groupCode: BigInt(GROUP_ID) } },
        contentHead: { type: 1 },
        messageBody: {
          richText: { elems: [Uint8Array.from(lengthDelimited(1, lengthDelimited(1, [...Buffer.from(TEXT, "utf8")])))] },
        },
        clientSequence: 0,
        random,
        syncCookie: new Uint8Array(0),
        via: 0,
        dataStatist: 0,
        multiSendSeq: 0,
      }),
    ).toString("hex");

  const a = build(RANDOM);
  const b = build(RANDOM + 1);
  assert.notEqual(a, b);
  // Everything up to field 5 must be identical; only the trailing random differs.
  const prefix = a.indexOf("2888ff948102");
  assert.ok(prefix > 0);
  assert.equal(a.slice(0, prefix), b.slice(0, prefix));
});
