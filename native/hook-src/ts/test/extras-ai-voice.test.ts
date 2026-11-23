// `ExtrasApi.sendAiVoice` — the request + receipt-wait composite.
//
// Reference: reference/index.mjs:82386-82552 (`ExtrasApi`, its three module
// constants, and `normalizeMediaUuid` / `matchesAiVoiceEvent` /
// `describeAiVoiceFingerprint`).
//
// ---------------------------------------------------------------------------
// Why this file is not just "the request goes out"
// ---------------------------------------------------------------------------
// `sendAiVoice` is the only bridge method in this port that does not finish when
// its packet does. The 0x929b completion response carries the media node but, on
// live QQ, omits the group message sequence — so the canonical sequence can only be
// read off the ECHO: QQ pushes the just-sent voice back as a `group_message` whose
// sender is the bot. Everything below therefore tests a property of the *state
// machine*, and each of the six has a failure mode that is invisible in a code
// review of the request bytes alone:
//
//   1. **The request itself** — command, sub-command, field numbers, the
//      `sessionId` submessage, and the fact that an all-zero `chatType` is
//      OMITTED rather than written as a zero byte. Bytes are assembled here by an
//      independent writer, never by the code under test.
//   2. **Subscription-before-publish.** An echo that wins the publish/response race
//      must be BUFFERED, not lost. Two tests cover the two paths: the buffered one
//      (echo arrives while the OIDB call is in flight) and the awaited one (echo
//      arrives after the node is known).
//   3. **Non-matching events do NOT resolve.** Four separate reasons, each
//      individually: another group, another sender, no `record` element, a record
//      with a different media UUID.
//   4. **Cross-call de-duplication.** One `groupId:msgSeq:msgId` belongs to exactly
//      one call. Two concurrent calls must not both claim the same echo.
//   5. **Three distinct failures**, not one: timeout, candidate overflow, and a
//      node with no media identifier. Their wording differs because an operator's
//      response differs.
//   6. **No leaked subscription.** A `finally` that is missing on ONE exit path
//      leaks a listener per call — after a few thousand sends the bus holds
//      thousands of dead handlers, each retaining its captured `candidates` array.
//      Every terminal path is asserted, including the throwing-publish one.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";
import type { BridgeEvent, PacketClient, PacketSendResult } from "../src/bridge/context.js";
import {
  AI_VOICE_CANDIDATE_LIMIT,
  AI_VOICE_CLAIM_LIMIT,
  AI_VOICE_RECEIPT_TIMEOUT_MS,
  ExtrasApi,
} from "../src/bridge/apis/extras.js";

const SELF_UIN = 10001;
const OTHER_UIN = 20002;
const GROUP_ID = 111222333;
const OTHER_GROUP_ID = 444555666;

/** The wire name the AI voice synthesis command resolves to. */
const AI_VOICE_WIRE = "OidbSvcTrpcTcp.0x929b_0";
const AI_VOICE_LIST_WIRE = "OidbSvcTrpcTcp.0x929d_0";

// ===========================================================================
// An independent protobuf writer
// ===========================================================================
//
// Deliberately NOT `ProtoWriter` from `oidb/wire.ts`: an assertion built with the
// same writer the encoder uses cannot distinguish "the field number is wrong" from
// "both sides are wrong the same way". This one is 20 lines and shares no code.

function varint(value: number | bigint): number[] {
  let n = typeof value === "bigint" ? value : BigInt(value);
  if (n < 0n) throw new Error("varint: negative");
  const out: number[] = [];
  do {
    let chunk = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) chunk |= 0x80;
    out.push(chunk);
  } while (n > 0n);
  return out;
}

function tag(field: number, wire: number): number[] {
  return varint((BigInt(field) << 3n) | BigInt(wire));
}

/** Length-delimited, and OMITTED when empty — the reference's `!= null && !== ""`. */
function str(field: number, value: string): number[] {
  if (value === "") return [];
  const bytes = [...new TextEncoder().encode(value)];
  return [...tag(field, 2), ...varint(bytes.length), ...bytes];
}

/** Varint, OMITTED when zero — the reference's `!= null && !== 0`. */
function u32(field: number, value: number): number[] {
  if (value === 0) return [];
  return [...tag(field, 0), ...varint(value)];
}

function msg(field: number, body: readonly number[]): number[] {
  return [...tag(field, 2), ...varint(body.length), ...body];
}

function bytesOf(parts: readonly number[]): Uint8Array {
  return Uint8Array.from(parts);
}

function hex(data: Uint8Array): string {
  return Buffer.from(data).toString("hex");
}

// ===========================================================================
// Response builders
// ===========================================================================

/**
 * `OidbAiVoiceIndexNode` with only `fileUuid` set.
 *
 * Field 2 is the UUID (reference:76283). Emitting just that field is enough for
 * `toAiVoiceNode` to answer a node, and enough for `describeAiVoiceFingerprint` to
 * answer `uuid:<last 12>` instead of `missing`.
 */
function indexNodeBody(fileUuid: string): number[] {
  return str(2, fileUuid);
}

/** A full 0x929b_0 BODY whose `msgInfoBody[0].index` carries `fileUuid`. */
function aiVoiceBodyWithUuid(fileUuid: string): Uint8Array {
  return bytesOf(
    msg(
      4, // OidbAiVoiceRespField.msgInfo
      msg(
        1, // OidbAiVoiceMsgInfoField.msgInfoBody (repeated)
        msg(
          1, // OidbAiVoiceMsgInfoBodyField.index
          indexNodeBody(fileUuid),
        ),
      ),
    ),
  );
}

/** A 0x929b_0 body that decodes to `null` — "the render is still in flight". */
function emptyAiVoiceBody(): Uint8Array {
  return new Uint8Array(0);
}

/** Wrap a command-specific body in the `OidbBase` envelope the transport echoes. */
function oidbResponse(command: number, subCommand: number, body: Uint8Array): Uint8Array {
  return bytesOf([
    ...u32(1, command), // command — never zero, always written
    ...u32(2, subCommand), // subCommand — omitted for _0
    // errorCode 3 is 0 → omitted
    ...msg(4, [...body]),
    // errorMsg 5 is "" → omitted
    // reserved 12 is 0 → omitted (FetchAiVoice sets no `uinForm`)
  ]);
}

// ===========================================================================
// The fake transport
// ===========================================================================

interface SentPacket {
  readonly wireName: string;
  readonly body: Uint8Array;
  readonly timeoutMs: number | undefined;
}

/**
 * A scripted server.
 *
 * `answers` is consumed in order and the last entry STICKS, so a 30-poll
 * `fetchAiVoice` loop can be driven with one `[empty, empty, node]` sequence and
 * then any number of `node` answers. `onSend` runs after the packet is recorded and
 * before the answer is produced, which is how the publish/echo race is simulated
 * deterministically: the test emits bus events from inside the OIDB call.
 */
class FakePacketClient implements PacketClient {
  readonly sent: SentPacket[] = [];
  #answers: Uint8Array[] = [];
  #sticky: Uint8Array | null = null;
  onSend: ((packet: SentPacket, index: number) => Promise<void> | void) | undefined;

  /** Queue bodies; the last one sticks. */
  answerWith(...bodies: Uint8Array[]): void {
    this.#answers = [...bodies];
  }

  /** Answer every request with the same body. */
  answerAlways(body: Uint8Array): void {
    this.#sticky = body;
  }

  async sendPacket(
    wireName: string,
    body: Uint8Array,
    timeoutMs?: number,
  ): Promise<PacketSendResult> {
    const packet: SentPacket = { wireName, body, timeoutMs };
    const index = this.sent.push(packet) - 1;
    if (this.onSend) await this.onSend(packet, index);
    let answer: Uint8Array;
    if (this.#answers.length > 1) {
      answer = this.#answers.shift()!;
    } else if (this.#answers.length === 1) {
      answer = this.#answers[0]!;
    } else {
      answer = this.#sticky ?? new Uint8Array(0);
    }
    return {
      success: true,
      gotResponse: true,
      errorCode: 0,
      responseData: Buffer.from(answer),
    };
  }
}

interface Harness {
  readonly bridge: Bridge;
  readonly client: FakePacketClient;
  readonly api: ExtrasApi;
}

function harness(): Harness {
  const bridge = new Bridge(new MemoryIdentity(String(SELF_UIN), "bot"));
  const client = new FakePacketClient();
  bridge.bindPid(1, client);
  return { bridge, client, api: bridge.apis.extras };
}

// ===========================================================================
// Bus events — the echo side
// ===========================================================================

interface EchoOptions {
  groupId?: number | undefined;
  senderUin?: number | undefined;
  selfUin?: number | undefined;
  msgSeq?: number | undefined;
  msgId?: number | undefined;
  /** Media UUID on the record element. `undefined` means "no record element". */
  fileUuid?: string | undefined;
  /** Also carried on `fileId`, which `matchesAiVoiceEvent` falls back to. */
  fileId?: string | undefined;
  /** Replace `elements` wholesale (for the "not an array" case). */
  elements?: readonly unknown[] | undefined;
}

/**
 * A `group_message` echo of a self-sent voice.
 *
 * Defaults describe the MATCHING case: the right group, sent by the bot itself,
 * carrying one `record` element whose `mediaNode.fileUuid` is the expected UUID.
 * Every test below overrides exactly one field, so a failure names the field.
 */
function echo(options: EchoOptions = {}): BridgeEvent {
  const fileUuid = "fileUuid" in options ? options.fileUuid : "uuid-target";
  const elements =
    options.elements ??
    (fileUuid === undefined
      ? [{ type: "text", text: "not a voice" }]
      : [
          {
            type: "record",
            fileName: "voice.amr",
            fileSize: 1024,
            duration: 3,
            fileHash: "hash",
            ...(options.fileId !== undefined ? { fileId: options.fileId } : {}),
            mediaNode: { fileUuid },
          },
        ]);
  return {
    kind: "group_message",
    time: 1_700_000_000,
    selfUin: options.selfUin ?? SELF_UIN,
    senderUin: options.senderUin ?? SELF_UIN,
    msgSeq: options.msgSeq ?? 4242,
    msgId: options.msgId ?? 777,
    elements,
    groupId: options.groupId ?? GROUP_ID,
    groupName: "group",
    senderNick: "bot",
    senderCard: "",
    senderRole: "member",
  };
}

// ===========================================================================
// Small async helpers
// ===========================================================================

/** Resolve after every pending microtask AND one macrotask has run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** `"resolved"` / `"rejected"` / `"pending"`, without letting a rejection escape. */
async function settleWithin(promise: Promise<unknown>, ms: number): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const outcome = await Promise.race([
    promise.then(
      () => "resolved",
      () => "rejected",
    ),
    new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve("pending"), ms);
    }),
  ]);
  if (timer) clearTimeout(timer);
  return outcome;
}

/** The rejection reason, asserting the promise actually rejected. */
/**
 * Await a rejection, keeping the event loop alive meanwhile.
 *
 * `sendAiVoice` calls `timeout.unref()` on its receipt timer, which is the reference's own
 * behaviour (reference:82537) and must not be "fixed": an unref'd timer lets the process
 * exit even while a send is parked. The consequence for a TEST is that a bare
 * `await promise` can end the event loop before the 30ms timer fires, so the promise is
 * reported as "still pending" instead of rejected. A long ref'd interval holds the loop
 * open for as long as the await needs and is cleared on every path.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  const keepAlive = setInterval(() => {}, 1_000);
  try {
    await promise;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (error) {
    assert.ok(error instanceof Error, `expected an Error, saw ${String(error)}`);
    return error;
  } finally {
    clearInterval(keepAlive);
  }
}

// ===========================================================================
// 1. The request
// ===========================================================================

test("the synthesis request is 0x929b_0 with fields 1..5 and the session submessage", async () => {
  // `sessionId` is `Math.floor(Math.random() * 4294967295) >>> 0`
  // (reference:82471). Pinned so the bytes are predictable; `Math.floor(0.5 * (2**32
  // - 1))` is exactly 0x7FFFFFFF.
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const { bridge, client, api } = harness();
    client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));

    const pending = api.sendAiVoice(GROUP_ID, "voice-1", "你好", 1, 5_000);
    await flush();
    await bridge.events.emit(echo());
    await pending;

    assert.equal(client.sent.length, 1, "one poll is enough when the first answer carries a node");
    const packet = client.sent[0]!;
    assert.equal(packet.wireName, AI_VOICE_WIRE);

    // OidbAiVoiceReq: 1 groupUin, 2 voiceId, 3 text, 4 chatType, 5 session.
    const body = [
      ...u32(1, GROUP_ID),
      ...str(2, "voice-1"),
      ...str(3, "你好"),
      ...u32(4, 1),
      // OidbAiVoiceSession: 1 sessionId
      ...msg(5, u32(1, 0x7fffffff)),
    ];
    // The envelope: command at 1, body at 4. subCommand/errorCode/errorMsg/reserved
    // are all zero-or-empty here and are therefore ABSENT, not written as zeros.
    const expected = bytesOf([...u32(1, 0x929b), ...msg(4, body)]);
    assert.equal(hex(packet.body), hex(expected));
    // Spelled out too, so a reader can check the field layout without decoding hex.
    assert.ok(hex(expected).startsWith("089ba502"), "field 1 must be the command, varint 0x929b");
    assert.ok(hex(expected).includes("22"), "field 4 (body) must be present");

    // The transport timeout is NOT the receipt timeout: the OIDB call uses the
    // bridge default (15 s), and `receiptTimeoutMs` only governs the echo wait.
    assert.equal(packet.timeoutMs, 15_000);
  } finally {
    Math.random = originalRandom;
  }
});

test("an absent chatType is omitted from the request, not written as a zero byte", async () => {
  const { bridge, client, api } = harness();
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));

  const pending = api.sendAiVoice(GROUP_ID, "v", "t", 0, 5_000);
  await flush();
  await bridge.events.emit(echo());
  await pending;

  const body = [...client.sent[0]!.body];
  // Field 4's tag is 0x20. With `chatType: 0` it must not appear at all — the
  // reference guards it with `!= null && !== 0` (reference:75494).
  assert.equal(body.includes(0x20), false, `body ${hex(Uint8Array.from(body))} must not carry field 4`);
});

test("fetchAiVoice polls until a node materialises, reusing ONE sessionId", async () => {
  // The server answers an empty msgInfo while the render is in flight. Thirty polls
  // is the reference's budget; this test uses three so the assertion is about the
  // loop, not the cap.
  const { client, api } = harness();
  client.answerWith(
    oidbResponse(0x929b, 0, emptyAiVoiceBody()),
    oidbResponse(0x929b, 0, emptyAiVoiceBody()),
    oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")),
  );

  const node = await api.fetchAiVoice(GROUP_ID, "v", "t", 1);
  assert.equal(node.fileUuid, "uuid-target");
  assert.equal(client.sent.length, 3);

  // Every poll must carry the SAME sessionId: the server correlates the polls of one
  // synthesis by it, so regenerating per iteration would start three syntheses.
  const sessionIds = client.sent.map((packet) => {
    // Field 5 (0x2a), then the submessage, then field 1 (0x08) and its varint. The
    // varint is the last byte for these small values.
    const bytes = [...packet.body];
    const at = bytes.indexOf(0x2a);
    assert.notEqual(at, -1, "every poll must carry the session submessage");
    return bytes.slice(at + 3); // skip 0x2a, length, 0x08
  });
  assert.deepEqual(sessionIds[1], sessionIds[0]);
  assert.deepEqual(sessionIds[2], sessionIds[0]);
});

test("fetchAiVoice throws the reference's wording when every poll answers empty", async () => {
  const { client, api } = harness();
  client.answerAlways(emptyAiVoiceBody());
  const error = await rejectionOf(api.fetchAiVoice(GROUP_ID, "v", "t", 1, 30));
  assert.equal(error.message, "AI voice synthesis did not complete after 30 polls");
  assert.equal(client.sent.length, 30);
});

test("fetchAiVoiceList sends 0x929d_0 with groupUin at 1 and chatType at 2", async () => {
  const { client, api } = harness();
  client.answerAlways(new Uint8Array(0));
  await api.fetchAiVoiceList(GROUP_ID, 1);

  const packet = client.sent[0]!;
  assert.equal(packet.wireName, AI_VOICE_LIST_WIRE);
  const body = [...u32(1, GROUP_ID), ...u32(2, 1)];
  assert.equal(hex(packet.body), hex(bytesOf([...u32(1, 0x929d), ...msg(4, body)])));
});

// ===========================================================================
// 2. The receipt — both paths
// ===========================================================================

test("an echo buffered DURING the publish resolves the call (the race the subscription order covers)", async () => {
  const { bridge, client, api } = harness();
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));
  // Emit from INSIDE the OIDB call, i.e. while `expectedNode` is still null. Only
  // the buffer can catch this; a subscription placed after the publish would lose it.
  client.onSend = async () => {
    await bridge.events.emit(echo({ msgSeq: 9001 }));
  };

  const receipt = await api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000);
  assert.deepEqual(receipt, { sequence: 9001 });
});

test("an echo arriving AFTER the publish resolves the call through the awaited race", async () => {
  const { bridge, client, api } = harness();
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));

  const pending = api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000);
  // Flush microtasks + one macrotask: the publish has returned and the method is
  // parked on `Promise.race([receiptPromise, …])`.
  await flush();
  await bridge.events.emit(echo({ msgSeq: 4242 }));

  assert.deepEqual(await pending, { sequence: 4242 });
});

test("a record whose media UUID matches only via `fileId` still resolves", async () => {
  // `matchesAiVoiceEvent` compares `element.mediaNode?.fileUuid || element.fileId`
  // (reference:82398). A node with no mediaNode but a matching `fileId` must match —
  // dropping the fallback silently loses receipts for one server variant.
  const { bridge, client, api } = harness();
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));

  const pending = api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000);
  await flush();
  await bridge.events.emit(echo({ elements: [{ type: "record", fileId: "uuid-target" }] }));

  assert.deepEqual(await pending, { sequence: 4242 });
});

// ===========================================================================
// 3. Non-matching events do NOT resolve
// ===========================================================================

/**
 * Start a call, let the publish settle, deliver `events`, and assert the call is
 * still PENDING — then deliver a matching echo so the call can finish cleanly.
 *
 * Asserting "still pending" rather than "rejects" is the whole point: a wrong
 * reason for not matching would still produce a timeout, so a test that only
 * awaited the outcome could not tell the two apart.
 */
async function assertIgnores(
  label: string,
  events: readonly BridgeEvent[],
): Promise<void> {
  const { bridge, client, api } = harness();
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));

  const pending = api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000);
  await flush();
  for (const event of events) await bridge.events.emit(event);

  assert.equal(await settleWithin(pending, 40), "pending", `${label} must NOT resolve the call`);

  // Clean finish, so the test cannot pass by leaking the subscription. The default
  // `echo()` carries `msgSeq: 4242`, and the receipt's `sequence` is exactly that value.
  await bridge.events.emit(echo());
  assert.deepEqual(await pending, { sequence: 4242 });
}

test("an echo from a DIFFERENT group does not resolve", async () => {
  await assertIgnores("wrong group", [echo({ groupId: OTHER_GROUP_ID })]);
});

test("an echo from ANOTHER sender does not resolve, even in the right group", async () => {
  await assertIgnores("another sender", [echo({ senderUin: OTHER_UIN })]);
});

test("an echo with no `record` element does not resolve", async () => {
  await assertIgnores("no record element", [
    echo({ elements: [{ type: "text", text: "hello" }] }),
  ]);
});

test("an echo whose record carries a DIFFERENT media UUID does not resolve", async () => {
  await assertIgnores("different media uuid", [echo({ fileUuid: "uuid-other" })]);
});

test("an echo with an EMPTY media UUID does not resolve", async () => {
  // `normalizeMediaUuid("")` is `""`, and `matchesAiVoiceEvent` refuses an empty
  // expected UUID — but an empty ELEMENT uuid must not match either.
  await assertIgnores("empty element uuid", [echo({ fileUuid: "   " })]);
});

// ===========================================================================
// 4. Cross-call de-duplication
// ===========================================================================

test("one echo cannot be claimed by two concurrent calls", async () => {
  const { bridge, client, api } = harness();
  // Both calls see the SAME media UUID, so the echo legitimately matches both.
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));

  // A subscribes first (it is called first), so it wins the claim.
  const first = api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000);
  const second = api.sendAiVoice(GROUP_ID, "v", "t", 1, 30);
  await flush();

  await bridge.events.emit(echo({ msgSeq: 555, msgId: 999 }));

  assert.deepEqual(await first, { sequence: 555 });
  // The second call must NOT also answer 555: the key is claimed, so it falls
  // through to `candidates` and then times out.
  const error = await rejectionOf(second);
  assert.equal(
    error.message,
    "AI voice was published but no matching group-message receipt arrived within 30ms " +
      "(group=111222333 media=uuid:uuid-target)",
  );
});

test("a receipt claimed by an earlier call is not claimable again", async () => {
  const { bridge, client, api } = harness();
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));
  const claimed = echo({ msgSeq: 1234, msgId: 5678 });

  const first = api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000);
  await flush();
  await bridge.events.emit(claimed);
  assert.deepEqual(await first, { sequence: 1234 });

  // The SAME event again, replayed on a fresh call. `receiptSettled` is per-call and
  // resets, so only the instance-wide set can stop this.
  const second = api.sendAiVoice(GROUP_ID, "v", "t", 1, 30);
  await flush();
  await bridge.events.emit(claimed);
  const error = await rejectionOf(second);
  assert.match(error.message, /no matching group-message receipt arrived within 30ms/);
});

test("the claim set is bounded at 256 and evicts in insertion order", async () => {
  const { bridge, client, api } = harness();
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));

  // `AI_VOICE_CLAIM_LIMIT` is the reference's 256 (reference:82389). Filling it via
  // real calls would take 257 publishes; seeding the set directly asserts the same
  // eviction rule without pretending to be an integration test.
  assert.equal(AI_VOICE_CLAIM_LIMIT, 256);
  for (let i = 1; i <= AI_VOICE_CLAIM_LIMIT; i += 1) {
    api.claimedAiVoiceReceiptKeys.add(`${GROUP_ID}:${i}:${i}`);
  }
  const oldest = api.claimedAiVoiceReceiptKeys.values().next().value;
  assert.equal(oldest, `${GROUP_ID}:1:1`);

  const pending = api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000);
  await flush();
  await bridge.events.emit(echo({ msgSeq: 3000, msgId: 3000 }));
  await pending;

  // One insert over the bound evicts exactly one entry, and it is the oldest.
  assert.equal(api.claimedAiVoiceReceiptKeys.size, AI_VOICE_CLAIM_LIMIT);
  assert.equal(api.claimedAiVoiceReceiptKeys.has(`${GROUP_ID}:1:1`), false);
  assert.equal(api.claimedAiVoiceReceiptKeys.has(`${GROUP_ID}:3000:3000`), true);
});

// ===========================================================================
// 5. The three distinct failures
// ===========================================================================

test("the default receipt timeout is the reference's 5000 ms", () => {
  // A seal on a constant the tests above pass explicitly: if the default drifted,
  // every production call would wait a different time and no test would notice.
  assert.equal(AI_VOICE_RECEIPT_TIMEOUT_MS, 5_000);
  assert.equal(AI_VOICE_CANDIDATE_LIMIT, 64);
});

test("a timeout rejects with the reference's wording, naming the media fingerprint", async () => {
  const { api, client } = harness();
  // A long, distinctive UUID so the 12-character tail is checkable.
  // `describeAiVoiceFingerprint` takes `uuid.slice(-12)`, so the tail of
  // "0123456789abcdef-target" is "bcdef-target" — NOT the middle of the string.
  const uuid = "0123456789abcdef-target";
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid(uuid)));
  const error = await rejectionOf(api.sendAiVoice(GROUP_ID, "v", "t", 1, 25));
  assert.equal(
    error.message,
    "AI voice was published but no matching group-message receipt arrived within 25ms " +
      `(group=111222333 media=uuid:${uuid.slice(-12)})`,
  );
});

test("candidate overflow is its OWN error, not a timeout", async () => {
  const { bridge, client, api } = harness();
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));
  // 65 self voice messages, none of them ours, all arriving while the publish is in
  // flight. `candidates` holds at most 64, so at least one is dropped and the
  // reference refuses to correlate rather than guessing.
  client.onSend = async () => {
    for (let i = 0; i < AI_VOICE_CANDIDATE_LIMIT + 1; i += 1) {
      await bridge.events.emit(echo({ fileUuid: `other-${i}`, msgSeq: 10_000 + i }));
    }
  };

  const error = await rejectionOf(api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000));
  assert.equal(
    error.message,
    "AI voice was published but receipt correlation overflowed after 64 unmatched self " +
      "voice messages (group=111222333 media=uuid:uuid-target)",
  );
  // The wording must not be mistakable for the timeout, which is the bug this
  // assertion exists to pin.
  assert.equal(/within \d+ms/.test(error.message), false);
});

test("an overflow that still has the wanted receipt buffered SUCCEEDS", async () => {
  // The reference checks `buffered` FIRST and only then the overflow flag
  // (reference:82537-82538), so an overflow is not fatal on its own — PROVIDED the wanted
  // echo is still in the buffer.
  //
  // ⚠️ The buffer is a FIFO capped at `AI_VOICE_CANDIDATE_LIMIT` and the wanted echo gets
  // evicted like any other: while `expectedNode` is null EVERY self voice message goes into
  // `candidates` (reference:82526 — the matching echo included, since the match cannot be
  // tested before the node exists). So the matching echo must be emitted just BEFORE the
  // overflow ends, not at the start. Emitting it first, then 69 others, evicts it and the
  // call correctly overflows.
  const { bridge, client, api } = harness();
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));
  client.onSend = async () => {
    // Fill the buffer close to the cap with messages that cannot match, then emit the
    // matching echo LAST so it survives.
    for (let i = 0; i < AI_VOICE_CANDIDATE_LIMIT - 1; i += 1) {
      await bridge.events.emit(echo({ fileUuid: `other-${i}`, msgSeq: 20_000 + i }));
    }
    await bridge.events.emit(echo({ msgSeq: 31337 }));
  };

  assert.deepEqual(await api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000), { sequence: 31337 });
});

test("an overflow evicts the wanted receipt too when it arrives too early", async () => {
  // The complement, and the reason the test above has to be ordered: the buffer is a FIFO,
  // so a matching echo buried under enough later ones is evicted. This is the reference's
  // behaviour, not a defect — the call cannot use a receipt whose node it has forgotten.
  const { bridge, client, api } = harness();
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));
  client.onSend = async () => {
    await bridge.events.emit(echo({ msgSeq: 31337 }));
    for (let i = 0; i < AI_VOICE_CANDIDATE_LIMIT + 5; i += 1) {
      await bridge.events.emit(echo({ fileUuid: `other-${i}`, msgSeq: 20_000 + i }));
    }
  };

  const error = await rejectionOf(api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000));
  assert.match(error.message, /receipt correlation overflowed after 64/);
});

test("a node with no media identifier is refused rather than guessed", async () => {
  // ONE harness: `api` and `client` must belong to the same Bridge. Two `harness()` calls
  // build two Bridges, so the scripted answer would land on a client the API never sends
  // through — and the failure surfaces as a 30-poll exhaustion, not as the missing-token
  // error this test is about.
  const { api, client } = harness();
  // An `index` with no `fileUuid` decodes to a node whose fingerprint is "missing",
  // which cannot be correlated by anything. The reference throws instead of falling
  // back to "the next voice in the group" (reference:82536).
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("")));
  const error = await rejectionOf(api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000));
  assert.equal(
    error.message,
    "AI voice was published but QQ returned no exact media identifier for receipt correlation",
  );
});

test("a receipt with a non-positive sequence is refused", async () => {
  const { bridge, client, api } = harness();
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));

  const pending = api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000);
  await flush();
  await bridge.events.emit(echo({ msgSeq: 0 }));
  const error = await rejectionOf(pending);
  assert.equal(error.message, "AI voice receipt carried invalid message sequence: 0");
});

// ===========================================================================
// 6. No leaked subscription
// ===========================================================================
//
// The four terminal paths below are the complete set: success, timeout, overflow,
// and a THROW from the publish. The last one is the one a `finally` is easy to
// forget, because the happy-path test never runs it.

test("no `group_message` subscription survives a successful call", async () => {
  const { bridge, client, api } = harness();
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));
  assert.equal(bridge.events.has("group_message"), false, "precondition: nothing subscribed");

  const pending = api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000);
  await flush();
  assert.equal(bridge.events.has("group_message"), true, "the call must subscribe before publishing");
  await bridge.events.emit(echo());
  await pending;

  assert.equal(bridge.events.has("group_message"), false, "the subscription must be released");
});

test("no subscription survives a TIMEOUT", async () => {
  const { bridge, api } = harness();
  await rejectionOf(api.sendAiVoice(GROUP_ID, "v", "t", 1, 20));
  assert.equal(bridge.events.has("group_message"), false);
});

test("no subscription survives a CANDIDATE OVERFLOW", async () => {
  const { bridge, client, api } = harness();
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));
  client.onSend = async () => {
    for (let i = 0; i < AI_VOICE_CANDIDATE_LIMIT + 1; i += 1) {
      await bridge.events.emit(echo({ fileUuid: `other-${i}` }));
    }
  };
  await rejectionOf(api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000));
  assert.equal(bridge.events.has("group_message"), false);
});

test("no subscription survives a THROWING publish, and the transport error propagates", async () => {
  const { bridge, api } = harness();
  // No bound client at all: `sendRawPacket` answers the `gotResponse: false` sentinel
  // and `invokeOidb` raises its own error naming the command. The subscription was
  // already made, so this path runs the `finally`.
  bridge.detachPid(1);
  const error = await rejectionOf(api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000));
  assert.match(error.message, /no packet sender attached|0x929b/);
  assert.equal(bridge.events.has("group_message"), false);
});

test("the subscription is not leaked across many calls", async () => {
  // A per-call `on` without its `unsubscribe` is invisible in a single-call test and
  // fatal in production: the bus would hold one dead handler per send. This pins the
  // aggregate rather than one path.
  const { bridge, client, api } = harness();
  client.answerAlways(oidbResponse(0x929b, 0, aiVoiceBodyWithUuid("uuid-target")));
  for (let i = 1; i <= 5; i += 1) {
    const pending = api.sendAiVoice(GROUP_ID, "v", "t", 1, 5_000);
    await flush();
    await bridge.events.emit(echo({ msgSeq: i, msgId: i }));
    await pending;
  }
  assert.equal(bridge.events.has("group_message"), false);
});
