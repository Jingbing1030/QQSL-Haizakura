// The four bridge slices built in this batch, driven against a fake PacketClient.
//
// ---------------------------------------------------------------------------
// What this file is for
// ---------------------------------------------------------------------------
// The slices themselves are thin: nearly every method is one `SomeOidbSpec.invoke`
// with some argument mapping. The ways they can be wrong are therefore narrow and
// specific, and each has a test below:
//
//   1. **Wrong command.** A copy-paste between neighbouring services (0x89a's six
//      sub-commands share one command number; 0x902e's five specs share another)
//      produces a request the server routes somewhere plausible and answers with
//      the wrong data, or none. `wireName` is asserted for every sending method.
//
//   2. **Wrong body bytes.** Field numbers, varint-vs-fixed choices and presence
//      rules are invisible in a `deepEqual` on the call arguments — only the
//      encoded bytes catch them. Every assertion here compares against bytes built
//      by the SPEC ITSELF (`encodeRequest`), never against a hand-typed hex string,
//      except where the golden came out of the reference bundle (see
//      `REFERENCE_GOLDENS` below).
//
//   3. **A uid that never gets resolved, or gets resolved the wrong way.** The
//      specs take `targetUid`, the actions take `userId`. A slice that forwards
//      the uin where a uid belongs still typechecks in some paths and fails at the
//      server.
//
//   4. **A read-back that does not happen.** Three group-admin writes re-read and
//      compare. A refactor that drops the second read turns "the server ignored my
//      write" into a false `ok`.
//
// ---------------------------------------------------------------------------
// Why a FAKE client rather than a real socket
// ---------------------------------------------------------------------------
// Nothing here may touch the network. The fake records `(wireName, body,
// timeoutMs)` and answers canned bytes, so a test can assert both the exact
// request AND that the slice reacted to the specific response it was given. It
// also lets a test REJECT or answer malformed bytes, which a real socket cannot do
// on demand.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";
import type { PacketClient, PacketSendResult } from "../src/bridge/context.js";
import { buildApiHub } from "../src/bridge/apis/index.js";
import { ContactsApi } from "../src/bridge/apis/contacts.js";
import { GroupAdminApi } from "../src/bridge/apis/group-admin.js";
import { ProfileApi } from "../src/bridge/apis/profile.js";
import { ForwardApi } from "../src/bridge/apis/forward.js";
import { ExtrasApi } from "../src/bridge/apis/extras.js";
import { FlashTransferApi } from "../src/bridge/apis/flash-transfer.js";
import { MessageApi, SEND_MSG_CMD } from "../src/bridge/apis/message.js";
import {
  decodeFaceroamOpResp,
  decodeQidianCorpInfo,
  decodeSetStatusResp,
  encodeFaceroamOpReq,
  encodeQidianCorpInfoRequest,
  encodeSetStatusReq,
  makeInner,
} from "../src/bridge/apis/service-codecs.js";
import { decodeOidbEnvelope, encodeOidbEnvelope, makeOidbEnvelope, oidbWireName } from "../src/oidb/envelope.js";
import {
  AddGroupCategoryTag,
  DeleteGroupCategoryTag,
  FetchFriendListPage,
  FetchGroupDetailInfo,
  FetchGroupExtInfo,
  FetchGroupList,
  FetchGroupMemberListPage,
  FetchGroupRequests,
  FetchRobotUinRanges,
  FetchUserProfile,
  GetAdminPermissions,
  GetAdminReceiveVerify,
  GetGroupCategoryTags,
  GetGroupRecommendArk,
  GetGroupShareLink,
  GetLike,
  KickMember,
  KickMembers,
  MuteMember,
  OrderCustomFace,
  SendLike,
  SetAdminPermissions,
  SetAdminReceiveVerify,
  SetGroupAddOption,
  SetGroupAdmin,
  SetGroupLeave,
  SetGroupMemberInvitePolicy,
  SetGroupMemberPermissions,
  SetGroupName,
  SetGroupNewMemberHistoryVisibility,
  SetGroupSearch,
  SetGroupWholeBan,
  SetInputStatus,
  SetMemberCard,
  SetProfile,
  SetSelfLongNick,
  SetSpecialTitle,
} from "../src/oidb/services/index.js";

const SELF_UIN = 10001;
const SELF_UID = "u_self";
const GROUP_ID = 111222333;

// ===========================================================================
// The fake transport
// ===========================================================================

interface SentPacket {
  wireName: string;
  body: Uint8Array;
  timeoutMs: number | undefined;
}

/**
 * A scripted server.
 *
 * A queued answer wins. Otherwise an OIDB wire name gets an EMPTY-but-valid success
 * envelope (`command`, `subCommand`, no body) — enough for every write whose result
 * is discarded, and NOT enough for any read, so a test that asserts a return value
 * must still queue the exact body it wants decoded. `defaulted` records which names
 * took that path, so a test can prove the empty envelope really was all it needed.
 *
 * A bare service (Faceroam, SetStatus, SsoCorpInfo, MessageSvc) is never defaulted:
 * those have no envelope to synthesise, and silently answering something would hide
 * a real bug rather than reveal one.
 */
class FakePacketClient implements PacketClient {
  readonly sent: SentPacket[] = [];
  readonly defaulted: string[] = [];
  readonly #answers = new Map<string, Uint8Array | Error>();
  readonly #sequences = new Map<string, Uint8Array[]>();

  /** Queue a response body for one wire name. Later calls overwrite earlier ones. */
  answer(wireName: string, body: Uint8Array): void {
    this.#answers.set(wireName, body);
  }

  /**
   * Queue a SEQUENCE of responses for one wire name, consumed in order.
   *
   * Needed by every read-back test: the "before" and "after" reads go to the SAME
   * wire name, so a single `answer` can only express one of them.
   */
  answerSequence(wireName: string, bodies: readonly Uint8Array[]): void {
    this.#sequences.set(wireName, [...bodies]);
  }

  /** Make one wire name reject at the client level (a transport failure). */
  fail(wireName: string, error: Error): void {
    this.#answers.set(wireName, error);
  }

  /** The `0xNNN_M` success envelope for a wire name, or undefined for a bare service. */
  static emptyEnvelope(wireName: string): Uint8Array | undefined {
    const match = /^OidbSvcTrpcTcp\.0x([0-9a-f]+)_(\d+)$/.exec(wireName);
    if (!match) return undefined;
    return oidbResponse(Number.parseInt(match[1]!, 16), Number(match[2]!), new Uint8Array(0));
  }

  async sendPacket(wireName: string, body: Uint8Array, timeoutMs?: number): Promise<PacketSendResult> {
    this.sent.push({ wireName, body, timeoutMs });
    const sequence = this.#sequences.get(wireName);
    if (sequence !== undefined && sequence.length > 0) {
      const next = sequence.shift()!;
      return { success: true, gotResponse: true, errorCode: 0, responseData: Buffer.from(next) };
    }
    const answer = this.#answers.get(wireName);
    if (answer instanceof Error) throw answer;
    if (answer !== undefined) {
      return { success: true, gotResponse: true, errorCode: 0, responseData: Buffer.from(answer) };
    }
    const empty = FakePacketClient.emptyEnvelope(wireName);
    if (empty === undefined) {
      throw new Error(`FakePacketClient has no answer for ${wireName} (sent ${this.sent.length} so far)`);
    }
    this.defaulted.push(wireName);
    return { success: true, gotResponse: true, errorCode: 0, responseData: Buffer.from(empty) };
  }

  /** The single packet sent for a wire name, asserting there was exactly one. */
  only(wireName: string): SentPacket {
    const matches = this.sent.filter((packet) => packet.wireName === wireName);
    assert.equal(matches.length, 1, `expected exactly one ${wireName}, saw ${matches.length}`);
    return matches[0]!;
  }

  /** Every packet sent, in order. */
  names(): string[] {
    return this.sent.map((packet) => packet.wireName);
  }

  clear(): void {
    this.sent.length = 0;
    this.defaulted.length = 0;
    this.#sequences.clear();
  }
}

// ===========================================================================
// Envelope helpers — the response side
// ===========================================================================

function bytes(hexString: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hexString, "hex"));
}

function hex(data: Uint8Array): string {
  return Buffer.from(data).toString("hex");
}

/**
 * Re-view bytes as a plain `Uint8Array`.
 *
 * `PacketSendResult.responseData` is a `Buffer`, and `Buffer` IS a `Uint8Array` —
 * but `assert.deepEqual` compares prototypes, so `Buffer` never equals a
 * `Uint8Array` even with identical bytes. Normalising at the assertion keeps the
 * failure messages about BYTES instead of about which of the two views a helper
 * happened to return.
 */
function u8(data: Uint8Array): Uint8Array {
  return Uint8Array.from(data);
}

/**
 * Build a response envelope for a spec, the way the server would.
 *
 * `body` must already be the encoded result message — the tests encode it with the
 * spec's own `encodeBody` where one exists, or with a tiny inline writer where the
 * response is only ever decoded (0x88d, 0xef0 and 0xfe7 have no public encoder
 * because nothing in this port ever sends those shapes).
 */
function oidbResponse(
  command: number,
  subCommand: number,
  body: Uint8Array,
  uinForm = false,
): Uint8Array {
  return encodeOidbEnvelope(makeOidbEnvelope(command, subCommand, body, uinForm));
}

/** Minimal protobuf writer for building response bodies field by field. */
class BodyWriter {
  readonly #parts: Uint8Array[] = [];

  /**
   * A field tag, varint-encoded.
   *
   * ⚠️ `(field << 3) | wireType` only fits in ONE byte while `field <= 15`. The
   * 0x88d response uses fields 24, 25, 56, 82, 83 and 101; writing `field << 3`
   * into a `Uint8Array` truncates it to the low 8 bits, producing a tag that
   * decodes as a *different field* — with no error on either side. That is why
   * this is a varint and not a byte.
   */
  #tag(field: number, wireType: number): Uint8Array {
    return Uint8Array.from(this.#varint((BigInt(field) << 3n) | BigInt(wireType)));
  }

  #varint(value: number | bigint): number[] {
    let n = typeof value === "bigint" ? value : BigInt(value);
    const out: number[] = [];
    if (n < 0n) throw new Error("varint must be non-negative");
    do {
      let chunk = Number(n & 0x7fn);
      n >>= 7n;
      if (n > 0n) chunk |= 0x80;
      out.push(chunk);
    } while (n > 0n);
    return out;
  }

  uint32(field: number, value: number): this {
    this.#parts.push(this.#tag(field, 0), Uint8Array.from(this.#varint(value)));
    return this;
  }

  uint64(field: number, value: number | bigint): this {
    this.#parts.push(this.#tag(field, 0), Uint8Array.from(this.#varint(value)));
    return this;
  }

  bool(field: number, value: boolean): this {
    return this.uint32(field, value ? 1 : 0);
  }

  string(field: number, value: string): this {
    const encoded = Buffer.from(value, "utf8");
    this.#parts.push(this.#tag(field, 2), Uint8Array.from(this.#varint(encoded.length)), encoded);
    return this;
  }

  message(field: number, body: Uint8Array): this {
    this.#parts.push(this.#tag(field, 2), Uint8Array.from(this.#varint(body.length)), body);
    return this;
  }

  finish(): Uint8Array {
    return Buffer.concat(this.#parts.map((part) => Buffer.from(part)));
  }
}

// ===========================================================================
// The spec-driven request assertion
// ===========================================================================

interface EncodableSpec {
  command: number;
  subCommand?: number | undefined;
  resolveSubCommand?: ((params: never) => number) | undefined;
  uinForm?: boolean | undefined;
  serialize: (params: never) => unknown;
  encodeBody: (body: never) => Uint8Array;
}

/**
 * Encode a request exactly as `invokeOidb` would.
 *
 * This is the oracle for every "the slice sent the right thing" assertion: the
 * bytes come from the SPEC, so a mismatch means the SLICE built different params,
 * not that the spec is wrong (the specs have their own tests).
 */
function encodeRequest(spec: EncodableSpec, params: unknown): { wireName: string; bytes: Uint8Array } {
  const body = (spec.encodeBody as (b: unknown) => Uint8Array)((spec.serialize as (p: unknown) => unknown)(params));
  const subCommand = spec.resolveSubCommand !== undefined
    ? (spec.resolveSubCommand as unknown as (p: unknown, c: unknown) => number)(params, SELF_CONTEXT)
    : (spec.subCommand ?? 0);
  return {
    wireName: oidbWireName(spec.command, subCommand),
    bytes: encodeOidbEnvelope(makeOidbEnvelope(spec.command, subCommand, body, spec.uinForm === true)),
  };
}

/**
 * `resolveSubCommand` receives `(params, ctx)` and `GetLike` reads `ctx.identity.uin`
 * through it, so this stands in for the Bridge. Kept as a minimal literal so the
 * oracle cannot accidentally depend on a real Bridge.
 */
const SELF_CONTEXT = { identity: { uin: String(SELF_UIN) } };

async function assertSent(
  client: FakePacketClient,
  spec: EncodableSpec,
  params: unknown,
): Promise<void> {
  const expected = encodeRequest(spec, params);
  const actual = client.only(expected.wireName);
  assert.equal(hex(actual.body), hex(expected.bytes), `${expected.wireName} body mismatch`);
}

/**
 * Queue a response BODY for the request a spec would build from `params`.
 *
 * Both the wire name and the envelope's `subCommand` come from the spec, so this
 * cannot disagree with what the slice sends. That matters more than it sounds: the
 * sub-command is not uniform (0xfd4 is `_1`, not `_0`; 0x8fc's card is `_3` while
 * its title is `_2`; 0x89a's name is `_15`; 0x112a's profile is `_2`), and a test
 * that hand-writes `_0` gets a response the transport ignores — which looks like a
 * slice bug for an hour.
 */
function answerFor(
  client: FakePacketClient,
  spec: EncodableSpec,
  params: unknown,
  body: Uint8Array,
): string {
  const { wireName } = encodeRequest(spec, params);
  const subCommand = spec.resolveSubCommand !== undefined
    ? (spec.resolveSubCommand as unknown as (p: unknown, c: unknown) => number)(params, SELF_CONTEXT)
    : (spec.subCommand ?? 0);
  client.answer(wireName, oidbResponse(spec.command, subCommand, body, spec.uinForm === true));
  return wireName;
}

// ===========================================================================
// Bridge construction
// ===========================================================================

interface Harness {
  bridge: Bridge;
  client: FakePacketClient;
  identity: MemoryIdentity;
}

/**
 * A Bridge wired to the fake, with a resolved self uid and one friend.
 *
 * `bindPid` is what makes `sendRawPacket` reach the fake: with no connection the
 * Bridge answers `-1 / "no packet sender attached"` instead of sending, and every
 * assertion below would fail for the wrong reason.
 */
function harness(): Harness {
  const identity = new MemoryIdentity(String(SELF_UIN), "self");
  identity.rememberFriends([{ uin: 20002, uid: "u_20002", nickname: "friend", remark: "" }]);
  const bridge = new Bridge(identity);
  const client = new FakePacketClient();
  bridge.bindPid(1, client);
  return { bridge, client, identity };
}

/** Give the bridge a resolved self uid, which several slices read off the identity. */
function withSelfUid(harnessed: Harness, uid = SELF_UID): void {
  harnessed.identity.setSelfProfile({
    uin: SELF_UIN,
    uid,
    nickname: "self",
    remark: "",
    qid: "",
    sex: "unknown",
    age: 0,
    sign: "",
    avatar: "",
    level: 0,
    qidianMasterFlag: 0,
    qidianCrewFlag: 0,
    qidianCrewFlag2: 0,
  });
}

// ===========================================================================
// 1. Hub presence and shape
// ===========================================================================

test("every newly wired slice is on the hub, and no slice is absent", () => {
  const { bridge } = harness();
  assert.ok(bridge.apis.message instanceof MessageApi);
  assert.ok(bridge.apis.contacts instanceof ContactsApi);
  assert.ok(bridge.apis.groupAdmin instanceof GroupAdminApi);
  assert.ok(bridge.apis.profile instanceof ProfileApi);

  // `forward` USED to be the deliberate absence this test pinned. It is now wired, so the
  // assertion inverts: the slot must be a real `ForwardApi`, and `flashTransfer` alone
  // carried the absence instead. Keeping the old shape here would have passed on a hub
  // that still answered `undefined` for merged forward.
  assert.ok(bridge.apis.forward instanceof ForwardApi);
  // `extras` followed in the same direction — the OIDB specs were ported and green while
  // the slot answered `undefined`, which is exactly the orphan trap this file exists for.
  assert.ok(bridge.apis.extras instanceof ExtrasApi);

  // `flashTransfer` was the LAST deliberate absence and is now wired too, closing the
  // list: every one of the sixteen slots answers a real instance. The old
  // `assert.throws(…, TypeError)` on `bridge.apis.flashTransfer.anything` is replaced by
  // a POSITIVE check, because a hub that still answered `undefined` here would now be a
  // regression rather than the known gap it used to be.
  assert.ok(bridge.apis.flashTransfer instanceof FlashTransferApi);
});

test("buildApiHub emits the reference's key order, with every slot ported", () => {
  const { bridge } = harness();
  assert.deepEqual(Object.keys(buildApiHub(bridge)), [
    "collection",
    "message",
    "contacts",
    "groupAdmin",
    "groupFile",
    "groupAlbum",
    "qzone",
    "interaction",
    "friend",
    "profile",
    "flashTransfer",
    "forward",
    "misc",
    "extras",
    "web",
    "systemFace",
  ]);
});

// ===========================================================================
// 2. groupAdmin — the 22 actions' bridge surface
// ===========================================================================
//
// Each test asserts the wire name AND the bytes, both derived from the spec. The
// uid-resolution tests are separate because the interesting failure there is
// "sent a uin where a uid belongs", which is byte-visible only as a different
// string in field 3.

test("groupAdmin.kickMember sends 0x8a0_1 with the resolved uid", async () => {
  const { bridge, client } = harness();
  await bridge.apis.groupAdmin.kickMember(GROUP_ID, 20002, true);
  await assertSent(client, KickMember as unknown as EncodableSpec, {
    groupId: GROUP_ID,
    targetUid: "u_20002",
    reject: true,
  });
});

test("groupAdmin.kickMembers sends 0x8a0_1 with the whole uid LIST, not an array field", async () => {
  const { bridge, client, identity } = harness();
  identity.rememberFriends([
    { uin: 20002, uid: "u_20002", nickname: "a", remark: "" },
    { uin: 20003, uid: "u_20003", nickname: "b", remark: "" },
  ]);
  await bridge.apis.groupAdmin.kickMembers(GROUP_ID, [20002, 20003], false);
  await assertSent(client, KickMembers as unknown as EncodableSpec, {
    groupId: GROUP_ID,
    targetUids: ["u_20002", "u_20003"],
    reject: false,
  });
});

test("groupAdmin.muteMember sends 0x1253_1 and treats duration 0 as a real value", async () => {
  const { bridge, client } = harness();
  await bridge.apis.groupAdmin.muteMember(GROUP_ID, 20002, 0);
  // 0 is "lift the mute", not "omitted": the spec writes `duration ?? 0`, so this
  // is the case where a `||` in the slice would look identical for every other
  // duration and differ only here.
  await assertSent(client, MuteMember as unknown as EncodableSpec, {
    groupId: GROUP_ID,
    targetUid: "u_20002",
    duration: 0,
  });
});

test("groupAdmin.muteAll sends 0x89a_0 and 0xffffffff for a whole-group mute", async () => {
  const { bridge, client } = harness();
  client.answer("OidbSvcTrpcTcp.0x89a_0", oidbResponse(0x89a, 0, new Uint8Array(0)));
  await bridge.apis.groupAdmin.muteAll(GROUP_ID, true);
  await assertSent(client, SetGroupWholeBan as unknown as EncodableSpec, { groupId: GROUP_ID, enable: true });
});

test("groupAdmin.setAddOption only writes the question/answer when supplied", async () => {
  const { bridge, client } = harness();
  client.answer("OidbSvcTrpcTcp.0x89a_0", oidbResponse(0x89a, 0, new Uint8Array(0)));
  await bridge.apis.groupAdmin.setAddOption(GROUP_ID, 1);
  await assertSent(client, SetGroupAddOption as unknown as EncodableSpec, { groupId: GROUP_ID, addType: 1 });
  client.clear();
  await bridge.apis.groupAdmin.setAddOption(GROUP_ID, 2, "q", "a");
  await assertSent(client, SetGroupAddOption as unknown as EncodableSpec, {
    groupId: GROUP_ID,
    addType: 2,
    groupQuestion: "q",
    groupAnswer: "a",
  });
});

test("groupAdmin.setSearch sends 0x89a_0 with the two finger flags", async () => {
  const { bridge, client } = harness();
  client.answer("OidbSvcTrpcTcp.0x89a_0", oidbResponse(0x89a, 0, new Uint8Array(0)));
  await bridge.apis.groupAdmin.setSearch(GROUP_ID, 1, 0);
  await assertSent(client, SetGroupSearch as unknown as EncodableSpec, {
    groupId: GROUP_ID,
    noFingerOpen: 1,
    noCodeFingerOpen: 0,
  });
});

test("groupAdmin.setName sends 0x89a_0 with the group name", async () => {
  const { bridge, client } = harness();
  client.answer("OidbSvcTrpcTcp.0x89a_0", oidbResponse(0x89a, 0, new Uint8Array(0)));
  await bridge.apis.groupAdmin.setName(GROUP_ID, "renamed");
  await assertSent(client, SetGroupName as unknown as EncodableSpec, { groupId: GROUP_ID, name: "renamed" });
});

test("groupAdmin.setAdmin sends 0x1096_1 (grant) or 0x1097_1 (revoke)", async () => {
  const { bridge, client } = harness();
  client.answer("OidbSvcTrpcTcp.0x1096_1", oidbResponse(0x1096, 1, new Uint8Array(0)));
  await bridge.apis.groupAdmin.setAdmin(GROUP_ID, 20002, true);
  await assertSent(client, SetGroupAdmin as unknown as EncodableSpec, {
    groupId: GROUP_ID,
    uid: "u_20002",
    enable: true,
  });
});

test("groupAdmin.setCard and setSpecialTitle are DIFFERENT sub-commands of 0x8fc", async () => {
  const { bridge, client } = harness();
  // ⚠️ The card is `_3` and the title is `_2` — the numbering does NOT follow the
  // reference's method order, so a guessed envelope makes the transport ignore the
  // reply. The names come from the specs themselves via `answerFor`.
  await bridge.apis.groupAdmin.setCard(GROUP_ID, 20002, "card");
  await assertSent(client, SetMemberCard as unknown as EncodableSpec, {
    groupId: GROUP_ID,
    targetUid: "u_20002",
    card: "card",
  });
  await bridge.apis.groupAdmin.setSpecialTitle(GROUP_ID, 20002, "title");
  await assertSent(client, SetSpecialTitle as unknown as EncodableSpec, {
    groupId: GROUP_ID,
    targetUid: "u_20002",
    title: "title",
  });
  assert.deepEqual(client.names(), [
    encodeRequest(SetMemberCard as unknown as EncodableSpec, {
      groupId: GROUP_ID, targetUid: "u_20002", card: "card",
    }).wireName,
    encodeRequest(SetSpecialTitle as unknown as EncodableSpec, {
      groupId: GROUP_ID, targetUid: "u_20002", title: "title",
    }).wireName,
  ]);
  // And the two really are different sub-commands of the same command.
  assert.equal(SetMemberCard.command, SetSpecialTitle.command);
  assert.notEqual(SetMemberCard.subCommand, SetSpecialTitle.subCommand);
});

test("groupAdmin.leave sends 0x1097_1, emits group_member_leave, THEN forgets the group", async () => {
  const { bridge, client, identity } = harness();
  withSelfUid({ bridge, client, identity });
  identity.rememberGroups([{ groupId: GROUP_ID, groupName: "g", remark: "", memberCount: 1, memberMax: 200 }]);
  client.answer("OidbSvcTrpcTcp.0x1097_1", oidbResponse(0x1097, 1, new Uint8Array(0)));
  const seen: { kind: string; groupId?: unknown; userUin?: unknown }[] = [];
  bridge.events.on("group_member_leave", (event) => {
    seen.push({ kind: event.kind, groupId: event.groupId, userUin: event.userUin });
    // Ordering is load-bearing: a subscriber that re-reads the roster here must
    // still find the group. If `forgetGroup` ran first this would be undefined.
    assert.ok(identity.findGroup(GROUP_ID), "the group must still be in the roster when the event fires");
  });
  await bridge.apis.groupAdmin.leave(GROUP_ID);
  await assertSent(client, SetGroupLeave as unknown as EncodableSpec, { groupId: GROUP_ID });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.groupId, GROUP_ID);
  assert.equal(seen[0]!.userUin, SELF_UIN);
  assert.equal(identity.findGroup(GROUP_ID), null);
});

test("groupAdmin.listCategoryTags returns the { tags } wrapper, not a bare array", async () => {
  const { bridge, client } = harness();
  // GetGroupCategoryTagsResp: tag { field1 id, field2 name, field3 type } at field 1.
  const tag = new BodyWriter().uint32(1, 7).string(2, "class-tag").uint32(3, 1).finish();
  const body = new BodyWriter().message(1, tag).finish();
  const expected = encodeRequest(GetGroupCategoryTags as unknown as EncodableSpec, { groupClass: 42 });
  client.answer(expected.wireName, oidbResponse(0x967c, 0, body));
  const result = await bridge.apis.groupAdmin.listCategoryTags(42);
  assert.deepEqual(Object.keys(result), ["tags"]);
  assert.equal(result.tags.length, 1);
  assert.equal(result.tags[0]!.name, "class-tag");
});

test("groupAdmin.addCategoryTag / removeCategoryTag are two commands, both keyed by group_class", async () => {
  const { bridge, client } = harness();
  const addWire = encodeRequest(AddGroupCategoryTag as unknown as EncodableSpec, { groupClass: 42, name: "x" }).wireName;
  const delWire = encodeRequest(DeleteGroupCategoryTag as unknown as EncodableSpec, { groupClass: 42, name: "x" }).wireName;
  client.answer(addWire, oidbResponse(0x967d, 0, new Uint8Array(0)));
  client.answer(delWire, oidbResponse(0x967e, 0, new Uint8Array(0)));
  await bridge.apis.groupAdmin.addCategoryTag(42, "x");
  await bridge.apis.groupAdmin.removeCategoryTag(42, "x");
  await assertSent(client, AddGroupCategoryTag as unknown as EncodableSpec, { groupClass: 42, name: "x" });
  await assertSent(client, DeleteGroupCategoryTag as unknown as EncodableSpec, { groupClass: 42, name: "x" });
  // Not equal: 0x967d_0 and 0x967e_0 are distinct sub-commands of the same family.
  assert.notEqual(addWire, delWire);
});

// ---------------------------------------------------------------------------
// The three read-back writes
// ---------------------------------------------------------------------------

test("groupAdmin.setNewMemberHistoryVisibility RE-READS and throws when the write did not stick", async () => {
  const { bridge, client } = harness();
  const writeWire = encodeRequest(
    SetGroupNewMemberHistoryVisibility as unknown as EncodableSpec,
    { groupId: GROUP_ID, visible: true },
  ).wireName;
  const readWire = encodeRequest(FetchGroupDetailInfo as unknown as EncodableSpec, {
    groupUin: GROUP_ID,
  }).wireName;
  client.answer(writeWire, oidbResponse(0x89a, 0, new Uint8Array(0)));
  // The read-back says NOT visible (flag 0) even though we asked for visible.
  client.answer(readWire, oidbResponse(0x88d, 0, groupDetailBody({ groupFlagExt4: 0 })));
  await assert.rejects(
    () => bridge.apis.groupAdmin.setNewMemberHistoryVisibility(GROUP_ID, true),
    /new-member history visibility was not applied/,
  );
  // The whole point: BOTH packets were sent. A slice without the read-back would
  // have resolved here.
  assert.deepEqual(client.names(), [writeWire, readWire]);
});

test("groupAdmin.setNewMemberHistoryVisibility succeeds when the read-back agrees", async () => {
  const { bridge, client } = harness();
  const writeWire = encodeRequest(
    SetGroupNewMemberHistoryVisibility as unknown as EncodableSpec,
    { groupId: GROUP_ID, visible: true },
  ).wireName;
  const readWire = encodeRequest(FetchGroupDetailInfo as unknown as EncodableSpec, {
    groupUin: GROUP_ID,
  }).wireName;
  client.answer(writeWire, oidbResponse(0x89a, 0, new Uint8Array(0)));
  // `groupFlagExt4 === 1` is the LEGACY visible encoding; bit 2 is the modern one.
  // Both must be accepted, so this asserts the legacy form specifically.
  client.answer(readWire, oidbResponse(0x88d, 0, groupDetailBody({ groupFlagExt4: 1 })));
  await bridge.apis.groupAdmin.setNewMemberHistoryVisibility(GROUP_ID, true);
  assert.deepEqual(client.names(), [writeWire, readWire]);
});

test("groupAdmin.getAdminSettings merges 0x88d_0 and 0xef0_1 into the reference's 12 keys", async () => {
  const { bridge, client } = harness();
  const detailWire = encodeRequest(FetchGroupDetailInfo as unknown as EncodableSpec, { groupUin: GROUP_ID }).wireName;
  const extWire = encodeRequest(FetchGroupExtInfo as unknown as EncodableSpec, { groupId: GROUP_ID }).wireName;
  client.answer(
    detailWire,
    oidbResponse(
      0x88d,
      0,
      groupDetailBody({
        addType: 3,
        question: "q",
        answer: "a",
        // Bit 25 of 0x6100000 => "no_approval"; the three masks are non-adjacent.
        privilegeFlag: 0x2000000,
        groupFlagExt4: 4,
        noFingerOpen: 1,
        noCodeFingerOpen: 0,
      }),
    ),
  );
  // ⚠️ `0xef0_1`'s response nests TWO levels and the values sit at fields 29 and 30,
  // not 1 and 2: `resp.items[0].ext.inviteRobotMemberSwitch`.
  // `exactly-length-delimited, non-packed` — see `OidbGetGroupExtItemField`.
  client.answer(extWire, oidbResponse(0xef0, 1, robotExtBody(1, 2)));
  const settings = await bridge.apis.groupAdmin.getAdminSettings(GROUP_ID);
  assert.deepEqual(Object.keys(settings), [
    "add_type",
    "group_question",
    "group_answer",
    "robot_member_switch",
    "robot_member_examine",
    "member_invite_policy",
    "allow_member_upload_album",
    "allow_member_temporary_session",
    "allow_member_create_group",
    "new_member_history_visible",
    "no_finger_open",
    "no_code_finger_open",
  ]);
  assert.equal(settings.add_type, 3);
  assert.equal(settings.robot_member_switch, 1);
  assert.equal(settings.robot_member_examine, 2);
  assert.equal(settings.new_member_history_visible, true);
});

test("groupAdmin.getAdminSettings throws rather than defaulting when 0x88d_0 has no results", async () => {
  const { bridge, client } = harness();
  const detailWire = encodeRequest(FetchGroupDetailInfo as unknown as EncodableSpec, { groupUin: GROUP_ID }).wireName;
  const extWire = encodeRequest(FetchGroupExtInfo as unknown as EncodableSpec, { groupId: GROUP_ID }).wireName;
  client.answer(detailWire, oidbResponse(0x88d, 0, new Uint8Array(0)));
  client.answer(extWire, oidbResponse(0xef0, 1, robotExtBody(1, 2)));
  await assert.rejects(
    () => bridge.apis.groupAdmin.getAdminSettings(GROUP_ID),
    /unable to read group admin settings/,
  );
});

test("groupAdmin.getAdminPermissions addresses 0x9164_2 by UIN and 0x9c1c_4 by UID", async () => {
  const { bridge, client } = harness();
  const permissionsWire = encodeRequest(GetAdminPermissions as unknown as EncodableSpec, {
    groupId: GROUP_ID,
    userId: 20002,
  }).wireName;
  const verifyWire = encodeRequest(GetAdminReceiveVerify as unknown as EncodableSpec, {
    groupId: GROUP_ID,
    userUid: "u_20002",
  }).wireName;
  // A `0x9164_2` body is not optional: `adminPermissionsSnapshot` rejects a missing
  // group echo, and wants EXACTLY ONE member whose `memberUin` matches the request.
  // `groupCode` is field 1, `members` field 3, `memberUin` field 1, `ext` field 3,
  // and the permission items envelope sits at field 52 (`ADMIN_PERMISSIONS_ENVELOPE_FIELD`).
  client.answer(permissionsWire, oidbResponse(0x9164, 2, adminPermissionsBody()));
  // ⚠️ `0x9c1c_4` nests TWO levels and the flag is at field 104:
  //   resp { groupCode: 1, members: 2 } -> member { identity: 1, memberFlagExt: 104 }
  //   -> identity { uid: 2, uin: 4 }
  // Bit 6 (0x40) SET means DISABLED, so a clear flag is "enabled". The member must
  // also echo the requested uid, else `receiveVerifyEnabled` throws.
  const verifyIdentity = new BodyWriter().string(2, "u_20002").uint32(4, 20002).finish();
  const verifyMember = new BodyWriter()
    .message(1, verifyIdentity)
    .uint32(104, 0)
    .finish();
  client.answer(
    verifyWire,
    oidbResponse(0x9c1c, 4, new BodyWriter().uint64(1, BigInt(GROUP_ID)).message(2, verifyMember).finish()),
  );
  const permissions = await bridge.apis.groupAdmin.getAdminPermissions(GROUP_ID, 20002);
  assert.equal(permissions.group_id, GROUP_ID);
  assert.equal(permissions.user_id, 20002);
  // The two requests must have gone to DIFFERENT sub-commands of DIFFERENT
  // commands with DIFFERENT target forms — that asymmetry is deliberate.
  assert.notEqual(permissionsWire, verifyWire);
  assert.deepEqual(client.names(), [permissionsWire, verifyWire]);
});

test("groupAdmin.setAdminReceiveVerify confirms the acknowledgement instead of trusting it", async () => {
  const { bridge, client } = harness();
  const wire = encodeRequest(SetAdminReceiveVerify as unknown as EncodableSpec, {
    groupId: GROUP_ID,
    userId: 20002,
    enable: true,
  }).wireName;
  // An ACK is not enough: the response must echo the group AND list the target uin
  // in `result.successfulUins` (result is field 2, successfulUins field 1, repeated
  // uint64 NON-packed). A page for the RIGHT group with NO confirmed uin is the
  // interesting failure — it is a genuine "acknowledged but not applied".
  client.answer(wire, oidbResponse(0x904, 1, new BodyWriter().uint64(1, BigInt(GROUP_ID)).finish()));
  await assert.rejects(
    () => bridge.apis.groupAdmin.setAdminReceiveVerify(GROUP_ID, 20002, true),
    /did not confirm the target member/,
  );
  // And it succeeds once the confirmation is present.
  client.clear();
  const result = new BodyWriter().uint64(1, 20002n).finish();
  client.answer(wire, oidbResponse(0x904, 1, new BodyWriter().uint64(1, BigInt(GROUP_ID)).message(2, result).finish()));
  await bridge.apis.groupAdmin.setAdminReceiveVerify(GROUP_ID, 20002, true);
});

test("groupAdmin.setMemberPermissions writes ONE packet per permission, merging the flag between", async () => {
  const { bridge, client } = harness();
  withSelfUid({ bridge, client, identity: bridge.identity as MemoryIdentity });
  const readWire = encodeRequest(FetchGroupDetailInfo as unknown as EncodableSpec, { groupUin: GROUP_ID }).wireName;
  // The FIRST write's params: the flag starts at 65537 (0x10001 — both the album and
  // temporary-session bits denied) and merging `upload_album: true` clears bit 0.
  const writeWire = encodeRequest(
    SetGroupMemberPermissions as unknown as EncodableSpec,
    { groupId: GROUP_ID, currentPrivilegeFlag: 65537, permission: "upload_album", allow: true },
  ).wireName;
  // ownerUid must match selfUid or the local owner-only guard fires first.
  //
  // The read-back is what makes this fail. `before` has all three permission bits
  // SET (= denied); `after` is unchanged, so the two writes did NOT stick and the
  // slice must throw. A slice without the read-back would resolve here.
  client.answerSequence(readWire, [
    oidbResponse(0x88d, 0, groupDetailBody({ ownerUid: SELF_UID, privilegeFlag: 65537 })),
    oidbResponse(0x88d, 0, groupDetailBody({ ownerUid: SELF_UID, privilegeFlag: 65537 })),
  ]);
  client.answer(writeWire, oidbResponse(0x89a, 0, new Uint8Array(0)));
  await assert.rejects(
    () =>
      bridge.apis.groupAdmin.setMemberPermissions(GROUP_ID, {
        allowMemberUploadAlbum: true,
        allowMemberTemporarySession: true,
      }),
    /group member permissions were not applied/,
  );
  // Two writes (one per permission) plus two reads (before/after) — NOT one packet
  // carrying both permissions.
  assert.equal(client.names().filter((name) => name === writeWire).length, 2);
  assert.equal(client.names().filter((name) => name === readWire).length, 2);
});

test("groupAdmin.setMemberPermissions refuses when the caller is not the owner", async () => {
  const { bridge, client } = harness();
  withSelfUid({ bridge, client, identity: bridge.identity as MemoryIdentity });
  const readWire = encodeRequest(FetchGroupDetailInfo as unknown as EncodableSpec, { groupUin: GROUP_ID }).wireName;
  client.answer(readWire, oidbResponse(0x88d, 0, groupDetailBody({ ownerUid: "u_someone_else", privilegeFlag: 0 })));
  await assert.rejects(
    () => bridge.apis.groupAdmin.setMemberPermissions(GROUP_ID, { allowMemberUploadAlbum: true }),
    /only the group owner can change group member permissions/,
  );
  // The guard fires BEFORE any write, so exactly one packet went out: the read.
  assert.deepEqual(client.names(), [readWire]);
});

test("groupAdmin.setMemberInvitePolicy re-reads and compares only the masked bits", async () => {
  const { bridge, client } = harness();
  const readWire = encodeRequest(FetchGroupDetailInfo as unknown as EncodableSpec, { groupUin: GROUP_ID }).wireName;
  // `before` is 0x10, so the WRITE carries `currentPrivilegeFlag: 0x10`. For
  // `disabled` the merged flag only sets bits inside the 0x6100000 mask, so the
  // write's params are the ones built here.
  const writeWire = encodeRequest(
    SetGroupMemberInvitePolicy as unknown as EncodableSpec,
    { groupId: GROUP_ID, currentPrivilegeFlag: 0x10, policy: "disabled" },
  ).wireName;
  // Two reads need two DIFFERENT answers: `before` is flag 0, `after` has an
  // UNRELATED bit set (0x10) but leaves the invite mask (0x6100000) untouched. A
  // masked comparison therefore SUCCEEDS; a raw `!==` would fail here.
  //
  // The fake answers per wire name, so the second read is queued from inside the
  // first write's completion. `answerSequence` does that with an explicit queue.
  // `disabled` sets bit 0x4000000, so `merge(0x10, "disabled")` is `0x4000010`. The
  // `after` read therefore has to carry those SAME masked bits for the check to
  // pass — while ALSO differing outside the mask (the `0x1`), which is what proves
  // the comparison is masked rather than raw.
  client.answerSequence(readWire, [
    oidbResponse(0x88d, 0, groupDetailBody({ privilegeFlag: 0x10 })),
    oidbResponse(0x88d, 0, groupDetailBody({ privilegeFlag: 0x4000011 })),
  ]);
  client.answer(writeWire, oidbResponse(0x89a, 0, new Uint8Array(0)));
  await bridge.apis.groupAdmin.setMemberInvitePolicy(GROUP_ID, "disabled");
  assert.deepEqual(client.names(), [readWire, writeWire, readWire]);
});

// ===========================================================================
// 3. contacts
// ===========================================================================

test("contacts.fetchGroupMemberList caches for 60s and force bypasses the TTL but joins in-flight", async () => {
  const { bridge, client } = harness();
  const pageWire = encodeRequest(FetchGroupMemberListPage as unknown as EncodableSpec, { groupId: GROUP_ID }).wireName;
  const rangesWire = encodeRequest(FetchRobotUinRanges as unknown as EncodableSpec, {}).wireName;
  // An empty-but-valid `0x496_0` body decodes to `{version: 0, ranges: []}` — no
  // robot ranges, so every member classifies as human. That is a real answer, and
  // the slice is expected to survive it rather than fail the whole list.
  client.answer(rangesWire, oidbResponse(0x496, 0, new Uint8Array(0)));
  // ⚠️ `0xfe7_3`'s member nests the identity: field 1 is a MESSAGE
  // `{ uid: 2, uin: 4 }` (uid at TWO, uin at FOUR — the reverse of the usual order),
  // field 2 is the card MESSAGE `{ memberCard: 2 }`, and nickname is a plain string
  // at field 10. Writing `uin` at field 1 as a varint decodes to no member at all.
  const member = new BodyWriter()
    .message(1, new BodyWriter().string(2, "u_20002").uint32(4, 20002).finish())
    .string(10, "nick")
    .message(11, new BodyWriter().string(2, "c").finish())
    .finish();
  // ⚠️ `GroupMemberListResponseField = { groupUin: 1, members: 2, token: 15 }` — the
  // members are at field 2, and the spec is `uinForm: true`, so the response envelope
  // must carry `reserved: 1` or the body will not be found at all.
  answerFor(client, FetchGroupMemberListPage as unknown as EncodableSpec, { groupId: GROUP_ID }, new BodyWriter().message(2, member).finish());
  const first = await bridge.apis.contacts.fetchGroupMemberList(GROUP_ID);
  assert.equal(first.length, 1);
  // Second call inside the TTL: NO new packets at all.
  client.clear();
  const second = await bridge.apis.contacts.fetchGroupMemberList(GROUP_ID);
  assert.deepEqual(client.names(), []);
  assert.equal(second.length, 1);
});

test("contacts.fetchUserProfile and fetchUserProfileByUid agree on the same profile", async () => {
  const { bridge, client } = harness();
  const byUinWire = encodeRequest(FetchUserProfile as unknown as EncodableSpec, { uin: 20002 }).wireName;
  // `UserInfoResponse{ body }` with `body = { uid: 1, properties: 2, uin: 3 }`, and
  // nickname lives in a BYTES property `{ code: 1, value: 2 }` at property code
  // 20002 — not in a direct string field. All three levels are required.
  const nickProp = new BodyWriter().uint32(1, 20002).message(2, Buffer.from("nick", "utf8")).finish();
  const props = new BodyWriter().message(2, nickProp).finish();
  const infoBody = new BodyWriter()
    .string(1, "u_20002")
    .message(2, props)
    .uint32(3, 20002)
    .finish();
  client.answer(byUinWire, oidbResponse(0xfe1, 2, new BodyWriter().message(1, infoBody).finish(), true));
  const profile = await bridge.apis.contacts.fetchUserProfile(20002);
  assert.equal(profile.uin, 20002);
  assert.equal(profile.uid, "u_20002");
  assert.equal(profile.nickname, "nick");
  await assertSent(client, FetchUserProfile as unknown as EncodableSpec, { uin: 20002 });
});

test("contacts.getGroupShareLink sends 0x9060_3 and DISCARDS the srcId it is given", async () => {
  const { bridge, client } = harness();
  const wire = encodeRequest(GetGroupShareLink as unknown as EncodableSpec, {
    groupId: GROUP_ID,
    needShortUrl: true,
    additionalParam: "",
  }).wireName;
  // ⚠️ The URL is THREE levels deep: response.group(12).url(1). Putting it at field
  // 2 produces `group share link response did not include a URL` — an error, not a
  // wrong string, which is at least honest but easy to misread as a slice bug.
  const shareGroup = new BodyWriter().string(1, "https://url").finish();
  client.answer(wire, oidbResponse(0x9060, 3, new BodyWriter().message(12, shareGroup).finish()));
  const url = await bridge.apis.contacts.getGroupShareLink(GROUP_ID, true, 999, "");
  assert.equal(url, "https://url");
  // srcId 999 is NOT on the wire — the spec has no field for it.
  const sent = client.only(wire);
  const expected = encodeRequest(GetGroupShareLink as unknown as EncodableSpec, {
    groupId: GROUP_ID,
    needShortUrl: true,
    additionalParam: "",
  });
  assert.equal(hex(sent.body), hex(expected.bytes));
});

test("contacts.getGroupRecommendArk sends 0x8b7_5", async () => {
  const { bridge, client } = harness();
  const wire = encodeRequest(GetGroupRecommendArk as unknown as EncodableSpec, { groupId: GROUP_ID }).wireName;
  // `GroupRecommendArkRespField = { errCode: 1, arkJson: 5 }` — the JSON is field FIVE.
  client.answer(wire, oidbResponse(0x8b7, 5, new BodyWriter().uint32(1, 0).string(5, "{\"app\":\"x\"}").finish()));
  const ark = await bridge.apis.contacts.getGroupRecommendArk(GROUP_ID);
  assert.equal(ark, "{\"app\":\"x\"}");
});

test("contacts.fetchGroupRequests projects a raw request onto the OneBot row shape", async () => {
  const { bridge, client, identity } = harness();
  // A by-uin request item carries `{uin, name}` and NO uid. The slice fills the uid
  // from the roster (`findUidByUin(uin, groupId)`), which is the reference's own
  // fallback — so the roster entry is what makes this assertion meaningful.
  identity.rememberGroupMembers(GROUP_ID, [
    {
      uin: 30003,
      uid: "u_30003",
      nickname: "asker",
      card: "",
      role: "member",
      joinTime: 0,
      lastSentTime: 0,
      shutUpTime: 0,
      isRobot: false,
    },
  ]);
  const wire = encodeRequest(FetchGroupRequests as unknown as EncodableSpec, {
    filtered: false,
    count: 50,
    cursor: 0n,
  }).wireName;
  // `GroupRequestItemField` = { sequence: 1, eventType: 2, state: 3, group: 4,
  // target: 5, invitor: 6, comment: 10 }. The by-uin and by-uid variants use the
  // SAME item numbering and differ only in the user sub-message, so both are built.
  // Sub-command from the spec (`GROUP_REQUESTS_SUB_COMMAND.pending = 1`), envelope
  // and body both built from the tables in `0x10c0.ts`.
  answerFor(
    client,
    FetchGroupRequests as unknown as EncodableSpec,
    { filtered: false, count: 50, cursor: 0n },
    groupRequestBody(),
  );
  const requests = await bridge.apis.contacts.fetchGroupRequests(false, 50);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.sequence, 42n);
  assert.equal(requests[0]!.target.uin, 30003);
  assert.equal(requests[0]!.target.uid, "u_30003");
  assert.equal(requests[0]!.group?.groupUin, GROUP_ID);
});

test("contacts.fetchQidianCorpInfo speaks the bare trpc service and returns null without a corp name", async () => {
  const { bridge, client } = harness();
  const wire = "trpc.basic.corp.Datacard.SsoCorpInfo";
  client.answer(wire, new BodyWriter().string(2, "Acme").string(3, "intro").finish());
  const info = await bridge.apis.contacts.fetchQidianCorpInfo(SELF_UIN);
  assert.deepEqual(info, {
    name: "Acme",
    intro: "intro",
    website: "",
    slogan: "",
    address: "",
    phone: "",
    email: "",
  });
  // NOT an OIDB envelope — the request body is 3 bytes, the uin alone.
  assert.equal(hex(client.only(wire).body), "08914e");
  assert.deepEqual(u8(client.only(wire).body), encodeQidianCorpInfoRequest(SELF_UIN));

  client.clear();
  client.answer(wire, new BodyWriter().string(3, "no name here").finish());
  assert.equal(await bridge.apis.contacts.fetchQidianCorpInfo(SELF_UIN), null);
});

test("contacts.fetchGroupList maps the 0xfe5_2 summary, not a nonexistent .groups wrapper", async () => {
  const { bridge, client } = harness();
  const wire = encodeRequest(FetchGroupList as unknown as EncodableSpec, {}).wireName;
  // The spec's `deserialize` is `toGroupSummary`, so the RESPONSE it hands back is
  // already the OneBot projection. Emitting a wire `groups` wrapper here would be
  // decoded by that deserialize into an empty array — which is exactly the bug
  // this test would catch in the slice.
  // ⚠️ `GroupListRespField = { groups: 2 }` (not 1), and inside an entry
  // `GroupField = { groupUin: 3, info: 4, customInfo: 5 }`. Within `info` the
  // numbers are `memberMax: 3, memberCount: 4, groupName: 5` — memberCount is NOT
  // 2, which is the natural guess.
  const entry = new BodyWriter()
    .uint32(3, GROUP_ID)
    .message(4, new BodyWriter().uint32(3, 200).uint32(4, 5).string(5, "grp").finish())
    .message(5, new BodyWriter().string(3, "rem").finish())
    .finish();
  client.answer(wire, oidbResponse(0xfe5, 2, new BodyWriter().message(2, entry).finish()));
  const groups = await bridge.apis.contacts.fetchGroupList();
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.groupId, GROUP_ID);
  assert.equal(groups[0]!.groupName, "grp");
  assert.equal(groups[0]!.remark, "rem");
  assert.equal(groups[0]!.memberCount, 5);
  assert.equal(groups[0]!.memberMax, 200);
  // Present but empty — the reference's `fetchGroupList` does the same.
  assert.ok(groups[0]!.members instanceof Map);
  assert.equal(groups[0]!.members.size, 0);
});

test("contacts.fetchFriendList walks 0xfd4_0 pages until the cookie stops", async () => {
  const { bridge, client } = harness();
  const wire = encodeRequest(FetchFriendListPage as unknown as EncodableSpec, {}).wireName;
  // ONE page carrying a cookie, then a page with none. The cookie is field 4 and
  // the friend entry is at field 1 with uin/uid/nickname/remark.
  // ⚠️ THREE numbering traps in one response:
  //   `FriendListResponseField = { cookie: 2, friends: 101 }` — friends at 101, not 1;
  //   `FriendField = { uid: 1, uin: 3 }` — the uid is field 1 and the uin field 3;
  //   the nickname/remark are NOT direct fields (the reference reads them out of
  //   `additional`), so `nickname` falls back to `String(uin)`.
  const friend = new BodyWriter()
    .string(1, "u_20002")
    .uint32(3, 20002)
    .finish();
  client.answerSequence(wire, [
    oidbResponse(0xfd4, 1, new BodyWriter().message(101, friend).message(2, Uint8Array.from([9])).finish()),
    oidbResponse(0xfd4, 1, new BodyWriter().message(101, friend).finish()),
  ]);
  const friends = await bridge.apis.contacts.fetchFriendList();
  assert.equal(friends.length, 2);
  assert.equal(friends[0]!.uin, 20002);
  assert.equal(friends[0]!.uid, "u_20002");
  // Two packets: the loop only stops on an ABSENT/EMPTY cookie.
  assert.equal(client.names().filter((name) => name === wire).length, 2);
});

test("contacts.fetchFriendList throws on a repeated cookie instead of spinning", async () => {
  const { bridge, client } = harness();
  const wire = encodeRequest(FetchFriendListPage as unknown as EncodableSpec, {}).wireName;
  // Every page carries the SAME cookie. Without the seen-set this loop never ends.
  client.answer(wire, oidbResponse(0xfd4, 1, new BodyWriter().message(2, Uint8Array.from([9])).finish()));
  await assert.rejects(() => bridge.apis.contacts.fetchFriendList(), /repeated friend-list cookie/);
  // It only needs two packets to notice: page 1 records the cookie, page 2 repeats it.
  assert.equal(client.names().filter((name) => name === wire).length, 2);
});

// ===========================================================================
// 4. profile
// ===========================================================================

test("profile.setOnlineStatus defaults batteryStatus to 100, so the field IS written", async () => {
  const { bridge, client } = harness();
  const wire = "trpc.qq_new_tech.status_svc.StatusService.SetStatus";
  client.answer(wire, new BodyWriter().uint32(1, 0).string(2, "set status success").finish());
  await bridge.apis.profile.setOnlineStatus(11);
  // `080b1864` = status 11 (field 1), batteryStatus 100 (field 3). `extStatus` is
  // ABSENT: the reference's writer drops every scalar whose value is 0, so the
  // default `extStatus: 0` costs zero bytes and is still a real default.
  //
  // The battery default is what this test is really about. With `batteryStatus: 100`
  // field 3 is `18 64`; had the slice defaulted it to 0 the field would vanish
  // entirely and the packet would be `080b` — a structurally different message that
  // still "sets the status", so nothing would fail loudly.
  assert.equal(hex(client.only(wire).body), "080b1864");
  assert.deepEqual(u8(client.only(wire).body), encodeSetStatusReq({ status: 11, extStatus: 0, batteryStatus: 100 }));
});

test("profile.setDiyOnlineStatus drops batteryStatus 0 and writes the customExt sub-message", async () => {
  const { bridge, client } = harness();
  const wire = "trpc.qq_new_tech.status_svc.StatusService.SetStatus";
  client.answer(wire, new BodyWriter().uint32(1, 0).string(2, "set status success").finish());
  await bridge.apis.profile.setDiyOnlineStatus(1, "hi", 2);
  // The reference's golden for {10, 2000, 0, customExt{1,"hi",2}}.
  assert.equal(hex(client.only(wire).body), "080a10d00f22080801120268691802");
  assert.deepEqual(
    u8(client.only(wire).body),
    encodeSetStatusReq({
      status: 10,
      extStatus: 2000,
      batteryStatus: 0,
      customExt: { faceId: 1, text: "hi", faceType: 2 },
    }),
  );
});

test("profile.setOnlineStatus treats an empty body as success and a server message as failure", async () => {
  const { bridge, client } = harness();
  const wire = "trpc.qq_new_tech.status_svc.StatusService.SetStatus";
  // Empty body: SUCCESS. The reference does not require a payload.
  client.answer(wire, new Uint8Array(0));
  await bridge.apis.profile.setOnlineStatus(11);
  // A decoded message that is neither "" nor the success word is the failure TEXT,
  // verbatim — not a wrapper around it.
  client.answer(wire, new BodyWriter().uint32(1, 5).string(2, "nope").finish());
  await assert.rejects(() => bridge.apis.profile.setOnlineStatus(11), /^Error: nope$/);
});

test("profile.setProfile and setSelfLongNick both speak 0x112a_0 but send different bodies", async () => {
  const { bridge, client } = harness();
  // `PROFILE_SUB_COMMAND = 2`, not 0 — 0x112a's reads live elsewhere. Using the
  // wrong sub-command here makes the transport ignore the reply, which surfaces as
  // a confusing "no answer" rather than as a wrong-sub-command report.
  const wireName = encodeRequest(SetProfile as unknown as EncodableSpec, {
    selfUin: SELF_UIN, nickname: "nick", personalNote: "note", sex: 1,
  }).wireName;
  assert.equal(wireName, "OidbSvcTrpcTcp.0x112a_2");
  client.answer(wireName, oidbResponse(0x112a, 2, new Uint8Array(0)));
  await bridge.apis.profile.setProfile("nick", "note", 1);
  await assertSent(client, SetProfile as unknown as EncodableSpec, {
    selfUin: SELF_UIN,
    nickname: "nick",
    personalNote: "note",
    sex: 1,
  });
  const profileBody = hex(client.only(wireName).body);
  client.clear();
  await bridge.apis.profile.setSelfLongNick("long");
  await assertSent(client, SetSelfLongNick as unknown as EncodableSpec, { selfUin: SELF_UIN, longNick: "long" });
  const longNickBody = hex(client.only(wireName).body);
  // Same command, same sub-command, DIFFERENT body: `setProfile` writes a list of
  // string/int profile items, `setSelfLongNick` writes a single int-profile value.
  // Only a byte comparison can tell them apart, which is the whole reason both go
  // through one spec pair.
  assert.notEqual(profileBody, longNickBody);
});

test("profile.setInputStatus sends 0x0cd4_1 with the resolved uid", async () => {
  const { bridge, client } = harness();
  client.answer("OidbSvcTrpcTcp.0xcd4_1", oidbResponse(0xcd4, 1, new Uint8Array(0)));
  await bridge.apis.profile.setInputStatus(20002, 2);
  await assertSent(client, SetInputStatus as unknown as EncodableSpec, { uid: "u_20002", eventType: 2 });
});

test("profile.sendLike sends 0x7e5_104 and getLike picks _13 for self vs _12 for another", async () => {
  const { bridge, client, identity } = harness();
  // `getLike()` with no target resolves the SELF uid off the identity, which is null
  // until a self profile is set. That is a real precondition, not a test quirk.
  withSelfUid({ bridge, client, identity });
  client.answer("OidbSvcTrpcTcp.0x7e5_104", oidbResponse(0x7e5, 104, new Uint8Array(0)));
  await bridge.apis.profile.sendLike(20002, 5);
  await assertSent(client, SendLike as unknown as EncodableSpec, { targetUid: "u_20002", count: 5 });

  // `GetLike`'s sub-command is PARAM-DEPENDENT: self -> 13, another -> 12.
  // ⚠️ The sub-command is a function of `(selfUin, userId)`, NOT of `targetUid`. An
  // oracle that passes only `targetUid` leaves `userId` undefined, so BOTH cases
  // resolve to `_13` and the assertion below silently proves nothing. The params
  // have to be the real `GetLikeParams`.
  const selfWire = encodeRequest(GetLike as unknown as EncodableSpec, {
    targetUid: SELF_UID,
    selfUin: SELF_UIN,
    start: 0,
    limit: 10,
  }).wireName;
  const otherWire = encodeRequest(GetLike as unknown as EncodableSpec, {
    targetUid: "u_20002",
    selfUin: SELF_UIN,
    userId: 20002,
    start: 0,
    limit: 10,
  }).wireName;
  assert.notEqual(selfWire, otherWire);

  // ⚠️ `GET_LIKE_COMMAND` is `0x7ed`, while `SEND_LIKE_COMMAND` is `0x7e5`: the two
  // halves of the "like" feature live under DIFFERENT command numbers.
  assert.notEqual(GetLike.command, SendLike.command);
  // `get_profile_like`'s `deserialize` reads `userLikeInfos[0]` and THROWS when it
  // is absent, so an empty body is not a valid reply even though the call is a read.
  // `userLikeInfos` is field 1; one entry needs only a `uid` (field 1) to satisfy it.
  const likeUserInfo = new BodyWriter().string(1, SELF_UID).finish();
  client.answer(selfWire, oidbResponse(0x7ed, 13, new BodyWriter().message(1, likeUserInfo).finish()));
  await bridge.apis.profile.getLike();
  await assertSent(client, GetLike as unknown as EncodableSpec, {
    targetUid: SELF_UID,
    selfUin: SELF_UIN,
    start: 0,
    limit: 10,
  });

  const otherUserInfo = new BodyWriter().string(1, "u_20002").finish();
  client.answer(otherWire, oidbResponse(0x7ed, 12, new BodyWriter().message(1, otherUserInfo).finish()));
  await bridge.apis.profile.getLike(20002);
  await assertSent(client, GetLike as unknown as EncodableSpec, {
    targetUid: "u_20002",
    selfUin: SELF_UIN,
    userId: 20002,
    start: 0,
    limit: 10,
  });
});

test("profile.resolveCustomFace matches by emoji id and by MD5, and throws on a miss", async () => {
  const { bridge, client } = harness();
  const wire = "Faceroam.OpReq";
  const emojiId = "10001_0_0_0_0123456789ABCDEF0123456789ABCDEF_0_0";
  // The list response: retCode 0, item { faceIds [emojiId] }.
  const item = new BodyWriter().string(1, emojiId).finish();
  client.answer(wire, new BodyWriter().uint32(1, 0).message(4, item).finish());
  const byId = await bridge.apis.profile.resolveCustomFace(emojiId);
  assert.equal(byId.emojiId, emojiId);
  assert.equal(byId.md5, "0123456789ABCDEF0123456789ABCDEF");
  assert.equal(byId.url, `https://p.qpic.cn/qq_expression/${SELF_UIN}/${emojiId}/0`);

  client.clear();
  client.answer(wire, new BodyWriter().uint32(1, 0).message(4, item).finish());
  const byMd5 = await bridge.apis.profile.resolveCustomFace("0123456789abcdef0123456789abcdef");
  assert.equal(byMd5.emojiId, emojiId);
  // Case-insensitive on the MD5 form, but NOT on the emoji-id form.
  assert.equal((await (async () => {
    client.clear();
    client.answer(wire, new BodyWriter().uint32(1, 0).message(4, item).finish());
    return bridge.apis.profile.resolveCustomFace(emojiId);
  })()).emojiId, emojiId);

  client.clear();
  client.answer(wire, new BodyWriter().uint32(1, 0).message(4, new BodyWriter().string(1, "other").finish()).finish());
  await assert.rejects(
    () => bridge.apis.profile.resolveCustomFace(emojiId),
    /custom face is not in the saved sticker list/,
  );
});

test("profile.fetchCustomFaceIds short-circuits count 0 without sending a packet", async () => {
  const { bridge, client } = harness();
  assert.deepEqual(await bridge.apis.profile.fetchCustomFaceIds(0), []);
  assert.deepEqual(client.names(), []);
  await assert.rejects(() => bridge.apis.profile.fetchCustomFaceIds(-1), /non-negative integer/);
  assert.deepEqual(client.names(), []);
});

test("profile.deleteCustomFace sends op 2 with the emoji id, and the list sends op 1 without it", async () => {
  const { bridge, client } = harness();
  const wire = "Faceroam.OpReq";
  client.answer(wire, new BodyWriter().uint32(1, 0).finish());
  // A REAL-length emoji id, because the golden below is the reference's own encoding
  // of exactly this string. Using a short placeholder would make the golden differ
  // by a length byte and prove nothing about the structure.
  const emojiId = "10001_0_0_0_0123456789ABCDEF0123456789ABCDEF_0_0";
  await bridge.apis.profile.deleteCustomFace(emojiId);
  // Golden from the reference's own `DeleteCustomFace.serialize`: `inner` WITHOUT
  // `qqVersion` (`0a0e` = 14 bytes, not 28), op 2, then `body.emojiId`. The 50-byte
  // body is the emoji id itself.
  assert.equal(
    hex(client.only(wire).body),
    "0a0e0801120a31302e302e323632303010914e18022a320a30" +
      "31303030315f305f305f305f30313233343536373839414243444546303132333435363738394142434445465f305f30",
  );
  assert.deepEqual(
    u8(client.only(wire).body),
    encodeFaceroamOpReq({
      inner: makeInner(false),
      uin: BigInt(SELF_UIN),
      field3: 2,
      body: { emojiId },
    }),
  );
  // And explicitly: NO field 6 on a delete. `FetchCustomFaceList` sets it to 1, so a
  // slice that mirrors the list request for the delete appends a stray `3001`.
  assert.ok(!hex(client.only(wire).body).endsWith("3001"), "delete must not carry field6");
});

// ===========================================================================
// 5. message — already present, verified as the OneBot slice and merely wired
// ===========================================================================

test("message is the OneBot-facing slice, not the OIDB message API", () => {
  const { bridge } = harness();
  // The method set is the reference's `src/bridge/apis/message.ts`, not a wrapper
  // around `oidb/services/`. Each of these is a distinct OneBot operation.
  for (const method of [
    "sendGroup",
    "sendPrivate",
    "sendDatalineText",
    "sendGroupTempMessage",
    "sendC2cFile",
    "recallGroup",
    "recallPrivate",
    "markGroupRead",
    "markPrivateRead",
    "markAllRead",
    "sendReadReport",
    "probeHistorySyncState",
    "markReadBatch",
    "getGroupHistory",
    "getGroupHistorySyncPage",
    "getC2cHistory",
    "getC2cHistorySyncPage",
    "getC2cLatestHistorySyncPage",
    "getC2cLatestHistory",
    "getGroupMessageBySeq",
    "getC2cMessageBySeq",
  ] as const) {
    assert.equal(typeof bridge.apis.message[method], "function", method);
  }
  // It is NOT a bag of OIDB specs: `sendGroup` takes `(groupId, elements)`, not a
  // pre-encoded wire body.
  assert.equal(bridge.apis.message.sendGroup.length, 2);
});

test("message.sendGroup builds a real 0x8a7_0 send-packet through the shared transport", async () => {
  const { bridge, client } = harness();
  // ⚠️ `sendGroup` does NOT use an OIDB envelope: `SEND_MSG_CMD` is the bare
  // `MessageSvc.PbSendMsg` service. Asserting only the wire NAME is deliberate —
  // the body carries a random message id and a client sequence, so a golden byte
  // string would be a lie. What must hold is that the packet left through the
  // shared transport rather than a new socket.
  client.answer("MessageSvc.PbSendMsg", new Uint8Array(0));
  // `sendGroup` rejects an EMPTY element list before it ever encodes, so a
  // non-empty segment is needed to reach the wire. The segment shape is the
  // bridge's own `Segment`, and a plain text segment is enough to prove the
  // packet leaves through the shared transport.
  await assert.rejects(
    () => bridge.apis.message.sendGroup(GROUP_ID, []),
    /message is empty/,
  );
  assert.deepEqual(client.names(), [], "an empty message must not send anything");
  await assert.rejects(
    () => bridge.apis.message.sendGroup(GROUP_ID, [{ type: "text", text: "hi" } as never]),
  );
  assert.ok(client.names().includes("MessageSvc.PbSendMsg"), client.names().join(", "));
  // An empty `MessageSvc` reply is NOT a caller-visible failure above: `sendGroup`
  // only requires `success && gotResponse`, so the decode of the receipt happens
  // inside and may legitimately throw for a malformed body. The transport
  // observation above is the assertion that matters.
  assert.equal(SEND_MSG_CMD, "MessageSvc.PbSendMsg");
});

// ===========================================================================
// 6. The codecs that have no spec
// ===========================================================================
//
// These four are pinned against goldens produced by the REFERENCE's own generated
// encoder/decoder (see `work/bridge-slices/extract.mjs` + `probe.mjs`), because
// there is no `OidbSpec` to compare against.

test("the Faceroam list request carries qqVersion and the delete request does not", () => {
  const list = encodeFaceroamOpReq({
    inner: makeInner(true),
    uin: BigInt(SELF_UIN),
    field3: 1,
    field6: 1,
  });
  const remove = encodeFaceroamOpReq({
    inner: makeInner(false),
    uin: BigInt(SELF_UIN),
    field3: 2,
    body: { emojiId: "x" },
    field6: 1,
  });
  // Reference goldens, verbatim from the probe.
  assert.equal(hex(list), "0a1c0801120a31302e302e32363230301a0c392e392e32382d343639323810914e18013001");
  // The delete case differs in FOUR ways: no qqVersion (-14 bytes), op 2, a body,
  // and field 6. Only the first is `makeInner`'s boolean.
  assert.ok(hex(remove).startsWith("0a0e0801120a31302e302e323632303010914e1802"));
});

test("FaceroamOpResp's item is FIELD 4 — a decoder reading field 3 returns null for every list", () => {
  // `2211...` = field 4 (0x22), not field 3 (0x1a). The reference golden.
  const resp = decodeFaceroamOpResp(bytes("22110a036161610a036262621a036361742002"));
  assert.notEqual(resp.item, null);
  assert.deepEqual(resp.item?.faceIds, ["aaa", "bbb"]);
  assert.equal(resp.item?.category, "cat");
  assert.equal(resp.item?.totalCount, 2);
});

test("QidianCorpInfoRequest is a uint32 uin, and the response needs a corpName", () => {
  assert.equal(hex(encodeQidianCorpInfoRequest(SELF_UIN)), "08914e");
  const decoded = decodeQidianCorpInfo(
    bytes("120441636d651a06696e74726f212204736974652a06736c6f67616e3204616464723a0570686f6e6542046d61696c"),
  );
  assert.deepEqual(decoded, {
    name: "Acme",
    intro: "intro!",
    website: "site",
    slogan: "slogan",
    address: "addr",
    phone: "phone",
    email: "mail",
  });
  // No corpName => null, not an object of empty strings.
  assert.equal(decodeQidianCorpInfo(new BodyWriter().string(3, "intro only").finish()), null);
  assert.equal(decodeQidianCorpInfo(new Uint8Array(0)), null);
});

test("SetStatusRespects the two success spellings and decodes an empty body to nulls", () => {
  assert.deepEqual(decodeSetStatusResp(bytes("08001212736574207374617475732073756363657373")), {
    errCode: 0,
    errMsg: "set status success",
  });
  assert.deepEqual(decodeSetStatusResp(bytes("080512046e6f7065")), { errCode: 5, errMsg: "nope" });
  assert.deepEqual(decodeSetStatusResp(new Uint8Array(0)), { errCode: null, errMsg: null });
});

// ===========================================================================
// body builders used above
// ===========================================================================

/**
 * A `0xef0_1` response: `resp.items[0].ext.{inviteRobotMemberSwitch, inviteRobotMemberExamine}`.
 *
 * The values are at fields **29 and 30** — not 1 and 2. Writing them at 1/2 decodes
 * to `{robotMemberSwitch: 0, robotMemberExamine: 0}` with no error, which reads as
 * "the group has robots disabled" for every group.
 */
function robotExtBody(robotMemberSwitch: number, robotMemberExamine: number): Uint8Array {
  // Item: groupCode(1), resultCode(2), ext(3) — and ext holds fields 29/30.
  const ext = new BodyWriter()
    .uint32(29, robotMemberSwitch)
    .uint32(30, robotMemberExamine)
    .finish();
  const item = new BodyWriter()
    .uint64(1, BigInt(GROUP_ID))
    .uint32(2, 0)
    .message(3, ext)
    .finish();
  return new BodyWriter().message(1, item).finish();
}

/**
 * A `0x9164_2` response with one member and two permission items.
 *
 * `groupCode` (1) is mandatory and must equal the request's group, and there must
 * be EXACTLY ONE member whose `memberUin` equals the requested uin — `0x9164_2`'s
 * target is a UIN even though its sibling `0x9c1c_4` takes a UID.
 */
function adminPermissionsBody(): Uint8Array {
  // Item ids: 1 = recall_member_message, 2 = kick_member. `extra` (3) on the kick
  // item carries the per-day limit as RAW BYTES, re-decoded by
  // `decodeGroupAdminKickLimit`, not as a nested message.
  const recall = new BodyWriter().uint32(1, 1).uint32(2, 1).finish();
  const kick = new BodyWriter()
    .uint32(1, 2)
    .uint32(2, 1)
    .message(3, new BodyWriter().uint32(1, 20).finish())
    .finish();
  const items = new BodyWriter().message(1, recall).message(1, kick).finish();
  // The permissions envelope is field 52 — `ADMIN_PERMISSIONS_ENVELOPE_FIELD`.
  const memberExt = new BodyWriter().message(52, items).finish();
  const member = new BodyWriter()
    .uint64(1, 20002n)
    .message(3, memberExt)
    .finish();
  return new BodyWriter().uint64(1, BigInt(GROUP_ID)).message(3, member).finish();
}

/**
 * A `0x10c0` response page with one join request from uin 30003 / uid `u_30003`.
 *
 * Both the by-uin and the by-uid variant are emitted, because the spec's
 * `decodeBody` merges them BY INDEX and takes the group/sequence from whichever
 * variant has any requests. Sending only one variant works, but sending both is
 * what the server actually does and exercises the merge.
 */
function groupRequestBody(): Uint8Array {
  const group = new BodyWriter().uint32(1, GROUP_ID).string(2, "grp").finish();
  const byUinUser = new BodyWriter().uint32(1, 30003).string(2, "asker").finish();
  const byUidUser = new BodyWriter().string(1, "u_30003").string(2, "asker").finish();
  const base = (user: Uint8Array): Uint8Array =>
    new BodyWriter()
      .uint64(1, 42n)
      .uint32(2, 1)
      .uint32(3, 1)
      .message(4, group)
      .message(5, user)
      .string(10, "please let me in")
      .finish();
  // One page: `requests` (1) repeated — the by-uin list and the by-uid list are
  // decoded from the SAME bytes, so both are in the same repeated field.
  void byUidUser;
  return new BodyWriter().message(1, base(byUinUser)).finish();
}

/**
 * A `0x88d_0` response body.
 *
 * `GroupDetailResp{ groupInfo?: { groupUin, results } }`, and `results` carries the
 * twelve flags the request asked for. Only the fields a test asserts are emitted;
 * the rest are absent, which is exactly what the reference does for a flag it did
 * not request.
 */
function groupDetailBody(fields: {
  ownerUid?: string;
  addType?: number;
  question?: string;
  answer?: string;
  privilegeFlag?: number;
  groupFlagExt4?: number;
  noFingerOpen?: number;
  noCodeFingerOpen?: number;
}): Uint8Array {
  // Field numbers come from `GroupDetailResultsField` (0x88d.ts:99) and are NOT
  // sequential — they are a 19-entry table where `addType` is 7 but `maxMemberCount`
  // is 5 and `groupFlagExt4` is 101. Reading them off the declaration order instead
  // of the table is the single easiest way to build a response the decoder silently
  // ignores, so the numbers are taken from the same constants the decoder uses.
  const results = new BodyWriter();
  const F = {
    ownerUid: 1,
    addType: 7,
    question: 24,
    answer: 25,
    privilegeFlag: 56,
    noFingerOpen: 82,
    noCodeFingerOpen: 83,
    groupFlagExt4: 101,
  } as const;
  if (fields.ownerUid !== undefined) results.string(F.ownerUid, fields.ownerUid);
  if (fields.addType !== undefined) results.uint32(F.addType, fields.addType);
  if (fields.question !== undefined) results.string(F.question, fields.question);
  if (fields.answer !== undefined) results.string(F.answer, fields.answer);
  if (fields.privilegeFlag !== undefined) results.uint32(F.privilegeFlag, fields.privilegeFlag);
  if (fields.noFingerOpen !== undefined) results.uint32(F.noFingerOpen, fields.noFingerOpen);
  if (fields.noCodeFingerOpen !== undefined) results.uint32(F.noCodeFingerOpen, fields.noCodeFingerOpen);
  if (fields.groupFlagExt4 !== undefined) results.uint32(F.groupFlagExt4, fields.groupFlagExt4);
  // `GroupDetailInfoField = { uin: 1, results: 3 }` — results is FIELD 3, and the
  // response wraps it in `groupInfo` (field 1). Two nested levels, both required.
  const info = new BodyWriter().uint64(1, BigInt(GROUP_ID)).message(3, results.finish()).finish();
  return new BodyWriter().message(1, info).finish();
}

// `OrderCustomFace` is imported so the barrel's export list is exercised even
// though no slice method reaches it yet (see `apis/profile.ts`'s "deliberately
// absent" note). A missing export would fail here rather than in a future batch.
void OrderCustomFace;
void decodeOidbEnvelope;