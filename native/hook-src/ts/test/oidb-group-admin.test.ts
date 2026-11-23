// OIDB batch C service tests — group admin, group settings, category tags.
//
// Same principle as the other OIDB test files: **every expected byte string was
// produced by evaluating the reference implementation**, never typed by hand.
//
//   request  — the reference has generated encoders, so the golden is what its own
//              `serialize` + `encode` emitted for a params object
//              (work/oidb-c/cases.json -> goldens.json via work/oidb-c/golden.mjs).
//   response — the reference has decoders but no response encoders, so the input
//              bytes were built with work/oidb-c/pb.mjs and the expected *value* is
//              what its own `decode -> deserialize` produced
//              (work/oidb-c/mkresp.mjs -> resp_goldens.json).
//
// Both directions were replayed by work/oidb-c/probe.mjs against this port before
// being pasted here; the probe found two real bugs (a packed-varint loop that
// consumed its first value as a tag, and `undefined` where the reference yields
// `null`), which is the point of running it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { makeOidbEnvelope, encodeOidbEnvelope, decodeOidbEnvelope, oidbWireName } from "../src/oidb/envelope.js";
import {
  // 0x8a0
  KickMember,
  KickMembers,
  kickMemberParams,
  kickMembersParams,
  checkKickResults,
  // 0x8a7
  GetAtAllRemain,
  toAtAllRemain,
  // 0x9164 / 0x9c1c / 0xfe7_4 / 0x904
  GetAdminPermissions,
  SetAdminPermissions,
  GetAdminReceiveVerify,
  SetAdminReceiveVerify,
  adminPermissionsSnapshot,
  receiveVerifyEnabled,
  confirmSetAdminReceiveVerify,
  decodeGroupAdminKickLimit,
  RECEIVE_VERIFY_DISABLED_BIT,
  // 0xf16
  SetGroupRemark,
  // 0x8fc
  SetMemberCard,
  SetSpecialTitle,
  setMemberCardParams,
  setSpecialTitleParams,
  // 0xef0 / 0xf00
  FetchGroupExtInfo,
  ModifyGroupExtInfo,
  toGroupRobotAddOption,
  // 0x967c-0x967e
  GetGroupCategoryTags,
  AddGroupCategoryTag,
  DeleteGroupCategoryTag,
  toTag,
  // already-ported specs, re-exported under this batch's names
  LeaveGroup,
  MuteAll,
  SetAddOption,
  SetSearch,
  SetAdmin,
  SetMemberInvitePolicy,
  SetNewMemberHistoryVisibility,
  SetMemberPermission,
} from "../src/oidb/services/index.js";

const hex = (input: Uint8Array): string => Buffer.from(input).toString("hex");
const bytes = (source: string): Uint8Array => Uint8Array.from(Buffer.from(source, "hex"));

interface EncodeSpec {
  command: number;
  subCommand?: number;
  resolveSubCommand?: (params: any) => number;
  uinForm?: boolean;
  serialize: (params: any) => any;
  encodeBody: (body: any) => Uint8Array;
}

/** Encode a request exactly as invokeOidb does, minus the transport. */
function encodeRequest(spec: EncodeSpec, params: any): { wireName: string; bytes: Uint8Array } {
  const body = spec.encodeBody(spec.serialize(params));
  const subCommand = spec.resolveSubCommand ? spec.resolveSubCommand(params) : (spec.subCommand ?? 0);
  return {
    wireName: oidbWireName(spec.command, subCommand),
    bytes: encodeOidbEnvelope(makeOidbEnvelope(spec.command, subCommand, body, spec.uinForm === true)),
  };
}

/** Decode a full response envelope through a spec's body decoder, as invokeOidb does. */
function decodeResponse<T>(
  spec: { decodeBody: (d: Uint8Array, o?: number, e?: number) => T },
  envelopeHex: string,
): T {
  // `body` is optional on the envelope type, but every caller here passes an
  // envelope that has one; a missing body is a test bug, so assert it.
  const { body } = decodeOidbEnvelope(bytes(envelopeHex), spec.decodeBody);
  assert.notEqual(body, undefined, "response envelope carried no body");
  return body as T;
}

// ===========================================================================
// 0x8a0_1 — KickMember and KickMembers are ONE command with TWO messages
// ===========================================================================
//
// This is the batch's sharpest trap and worth stating at the top: both specs
// declare `command = 2208, subCommand = 1`, so they share a wire name, but the
// request bodies have nothing in common beyond the group number:
//
//   KickMember   field 1 uint32 groupUin, field 3 string uid,
//                field 4 bool, field 5 string reason
//   KickMembers  field 1 uint64 groupId, field 3 repeated string uids,
//                field 4 uint32, field 5 bytes, field 12 uint32
//
// Note field 1 is uint32 in one and uint64 in the other, and field 4 is a bool in
// one and a uint32 in the other. A shared struct would encode a small group id
// identically and diverge silently above 2^31.

test("0x8a0_1 KickMember request matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(KickMember, {
    groupId: 111222333, targetUid: "u_10001", reject: false, reason: "",
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x8a0_1");
  assert.equal(hex(encoded), "08a0111001220e08bdbc84351a07755f3130303031");
});

test("0x8a0_1 KickMember reject_add_request is a bool that is DROPPED when false", () => {
  // `reject: false` and `reject: true` differ by exactly `2001` — the field is
  // absent, not `2000`, because the generated writer's guard is `=== true`.
  const off = encodeRequest(KickMember, { groupId: 111222333, targetUid: "u_10001", reject: false });
  const on = encodeRequest(KickMember, { groupId: 111222333, targetUid: "u_10001", reject: true });
  assert.equal(hex(on.bytes), "08a0111001221008bdbc84351a07755f31303030312001");
  assert.ok(!hex(off.bytes).includes("2000"), "false must not be written as an explicit 0");
  // Omitting the parameter entirely must produce the same bytes as passing false.
  assert.equal(hex(encodeRequest(KickMember, { groupId: 111222333, targetUid: "u_10001" }).bytes), hex(off.bytes));
});

test("0x8a0_1 KickMember reason is field 5 and dropped when empty", () => {
  const { bytes: encoded } = encodeRequest(KickMember, {
    groupId: 111222333, targetUid: "u_10001", reject: true, reason: "spam",
  });
  // `2a 04 7370616d` = field 5, wire 2, "spam". Field 2 does not exist in this
  // message at all, so a reason at 2 would be an unknown field.
  assert.equal(hex(encoded), "08a0111001221608bdbc84351a07755f313030303120012a047370616d");
  assert.ok(hex(encoded).includes("2a047370616d"));
});

test("0x8a0_1 KickMembers encodes each uid as its own tag (non-packed)", () => {
  const { bytes: encoded } = encodeRequest(KickMembers, {
    groupId: 111222333, targetUids: ["u_10001", "u_10002"], reject: true,
  });
  // Two separate `1a` tags, NOT one length-delimited packed run.
  assert.equal(
    hex(encoded),
    "08a0111001221908bdbc84351a07755f31303030311a07755f31303030322001",
  );
  const body = hex(encoded);
  assert.equal(body.split("1a07").length - 1, 2, "one 1a tag per uid");
});

test("0x8a0_1 KickMembers group id is uint64, so a group above 2^31 keeps its bytes", () => {
  // The reference's batch form uses `__writeVarint64` for field 1 while the single
  // form uses an inline 32-bit varint. Both encode 111222333 identically; only a
  // large group id shows the difference, which is why this case exists.
  const { bytes: encoded } = encodeRequest(KickMembers, {
    groupId: 10001, targetUids: ["u_1"],
  });
  assert.ok(hex(encoded).includes("08914e"), "uint64 varint for the group id");
});

test("0x8a0_1 KickMember and KickMembers share a wire name and, for one uid, even the bytes", () => {
  const a = encodeRequest(KickMember, { groupId: 1, targetUid: "u_1" });
  const b = encodeRequest(KickMembers, { groupId: 1, targetUids: ["u_1"] });
  assert.equal(a.wireName, b.wireName);
  // ⚠️ These are DIFFERENT messages (uint32 vs uint64 group, bool vs uint32
  // reject, string vs bytes reason, plus a field 12 on one side only) and yet a
  // single small uid produces identical bytes on both:
  //   `0801` fits either width, `1a 03 75 5f 31` is one repeated element, and
  //   neither `2000` nor `1a00`/field 12 is emitted for the defaults.
  // This is exactly why the two must be kept as separate codecs even though a
  // quick check says "same shape" — the equality is accidental, not structural.
  assert.equal(hex(a.bytes), hex(b.bytes));

  // Two uids on the batch form has no single-form equivalent.
  const two = encodeRequest(KickMembers, { groupId: 1, targetUids: ["u_1", "u_2"] });
  assert.notEqual(hex(two.bytes), hex(a.bytes));
});

test("0x8a0_1 both kick responses throw on a nonzero per-member result", () => {
  // The reference converts a per-member failure into an exception rather than a
  // return value, and uses a DIFFERENT operation name in each message.
  const single = decodeResponse(KickMember, "08a0111001221208bdbc8435120b08051207755f3130303031");
  assert.throws(() => checkKickResults(single!, "kick member"), /kick member failed: result=5/);

  const batch = decodeResponse(KickMembers, "08a0111001221208bdbc8435120b08071207755f3130303032");
  assert.throws(() => checkKickResults(batch!, "kick members"), /kick members failed: result=7/);
});

test("0x8a0_1 a kick response with every result zero does not throw", () => {
  const body = decodeResponse(KickMembers, "08a0111001221f08bdbc8435120b08001207755f3130303031120b08001207755f3130303032");
  assert.equal(body!.groupUin, 111222333);
  assert.equal(body!.results.length, 2);
  assert.deepEqual(body!.results.map((r) => r.uid), ["u_10001", "u_10002"]);
  assert.doesNotThrow(() => checkKickResults(body!, "kick members"));
});

test("0x8a0_1 an empty results list is success, and results is never null", () => {
  const body = decodeResponse(KickMember, "08a0111001220508bdbc8435");
  assert.deepEqual(body!.results, []);
  assert.doesNotThrow(() => checkKickResults(body!, "kick member"));
});

test("0x8a0_1 kickMemberParams resolves a uin to a uid and keeps reject", async () => {
  const params = await kickMemberParams(
    { groupId: 111222333, userId: 10001, reject: true },
    async (uin) => `u_${uin}`,
  );
  assert.deepEqual(params, { groupId: 111222333, targetUid: "u_10001", reject: true, reason: "" });
  assert.equal(hex(encodeRequest(KickMember, params).bytes), "08a0111001221008bdbc84351a07755f31303030312001");
});

test("0x8a0_1 kickMemberParams rejects an unresolvable uid instead of sending an empty one", async () => {
  await assert.rejects(
    () => kickMemberParams({ groupId: 1, userId: 4242 }, () => ""),
    /failed to resolve uid for 4242/,
  );
});

test("0x8a0_1 kickMembersParams resolves the whole list in order", async () => {
  const params = await kickMembersParams(
    { groupId: 111222333, userIds: [10001, 10002], reject: true },
    async (uin) => `u_${uin}`,
  );
  assert.deepEqual(params.targetUids, ["u_10001", "u_10002"]);
  assert.equal(
    hex(encodeRequest(KickMembers, params).bytes),
    "08a0111001221908bdbc84351a07755f31303030311a07755f31303030322001",
  );
});

// ===========================================================================
// 0x8a7_0 — a request that is almost all constants
// ===========================================================================

test("0x8a7_0 GetAtAllRemain request matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(GetAtAllRemain, { groupId: 111222333, selfUin: 10001 });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x8a7_0");
  assert.equal(hex(encoded), "08a711220e08011002180120914e28bdbc8435");
});

test("0x8a7_0 the three basic constants are 1/2/1 at fields 1/2/3", () => {
  // Reading the tag bytes: 08 01 (field 1 = 1), 10 02 (field 2 = 2),
  // 18 01 (field 3 = 1), then 20 914e (field 4 = uin), 28 ... (field 5 = group).
  // Field 12 (type) is 0 and therefore absent.
  const body = hex(GetAtAllRemain.encodeBody(GetAtAllRemain.serialize({ groupId: 111222333, selfUin: 10001 })));
  assert.ok(body.startsWith("080110021801"), "fields 1..3 are the 1/2/1 stamp");
  assert.ok(body.includes("20914e"), "field 4 is the uin");
  assert.ok(body.includes("28bdbc8435"), "field 5 is the group id");
  // Nothing in the 6..11 range: no `32`/`3a`/`42`/`4a`/`52`/`5a` tag appears.
  assert.equal(body, "08011002180120914e28bdbc8435");
});

test("0x8a7_0 a group id above 2^31 and the uin are independent uint64s", () => {
  const { bytes: encoded } = encodeRequest(GetAtAllRemain, { groupId: 10001, selfUin: 10001 });
  assert.equal(hex(encoded), "08a711220f08011002180120914e28914e");
});

test("0x8a7_0 the response remaps field names and defaults the counters", () => {
  // Response fields: 2 uinRemain, 3 groupRemain, 4 msg, 6 canAtAll. Field 1 and 5
  // do not exist. A builder that packs the counters at 1/2 decodes to zeros.
  const body = decodeResponse(GetAtAllRemain, "08a7111000220a1005180a22026f6b3001");
  assert.deepEqual(toAtAllRemain(body!), {
    can_at_all: true,
    remain_at_all_count_for_group: 10,
    remain_at_all_count_for_uin: 5,
  });
});

test("0x8a7_0 a missing counter defaults to 0 and canAtAll 0 means false", () => {
  const body = decodeResponse(GetAtAllRemain, "08a71110002206100018003000");
  assert.deepEqual(toAtAllRemain(body!), {
    can_at_all: false,
    remain_at_all_count_for_group: 0,
    remain_at_all_count_for_uin: 0,
  });
  // An empty body must not throw: "cannot @ all" is a valid answer.
  assert.deepEqual(toAtAllRemain(decodeResponse(GetAtAllRemain, "08a71110002200")!), {
    can_at_all: false,
    remain_at_all_count_for_group: 0,
    remain_at_all_count_for_uin: 0,
  });
});

// ===========================================================================
// 0x9164_2 — read administrator permissions
// ===========================================================================

test("0x9164_2 GetAdminPermissions request matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(GetAdminPermissions, { groupId: 111222333, userId: 10001 });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x9164_2");
  assert.equal(hex(encoded), "08e4a2021002220e08bdbc843510914e2204a20301016001");
});

test("0x9164_2 the filter payload is field 52 and the request wrapper skips field 3", () => {
  const { bytes: encoded } = encodeRequest(GetAdminPermissions, { groupId: 111222333, userId: 10001 });
  const body = hex(encoded);
  // `a2 03` is the two-byte tag for 52<<3|2 = 418. A filter written at field 1 or
  // 2 is silently ignored by the server, which is the failure mode this pins.
  assert.ok(body.includes("a20301 01".replace(" ", "")), "field 52 carries the selector byte");
  assert.ok(body.includes("2204a2030101"), "filter is field 4 of the wrapper");
  assert.ok(!body.includes("1a00"), "field 3 of the wrapper does not exist");
});

test("0x9164_2 uinForm is true, so the envelope carries reserved=1", () => {
  const { bytes: encoded } = encodeRequest(GetAdminPermissions, { groupId: 111222333, userId: 10001 });
  assert.ok(hex(encoded).endsWith("6001"), "reserved (field 12) is 1");
});

test("0x9164_2 the response nests through 3 -> 3 -> 52, not 2 -> 2 -> 1", () => {
  const body = decodeResponse(
    GetAdminPermissions,
    "08e4a2021002221f08bdbc84351a1808914e1a13a203100a08080110011a0208140a0408021002",
  );
  assert.equal(body!.groupCode, 111222333n);
  assert.equal(body!.members.length, 1);
  assert.equal(body!.members[0]!.memberUin, 10001n);
  assert.deepEqual(
    body!.members[0]!.ext!.permissions!.items.map((i) => [i.item, i.value]),
    [[1, 1], [2, 2]],
  );
});

test("0x9164_2 adminPermissionsSnapshot maps 0/1/2 to null/true/false", () => {
  const params = { groupId: 111222333, userId: 10001 };
  const on = decodeResponse(
    GetAdminPermissions,
    "08e4a2021002221f08bdbc84351a1808914e1a13a203100a08080110011a0208140a0408021002",
  );
  // kickMember=1 with extra{maxKickPerDay:20}; recallMemberMessage=2 -> false.
  assert.deepEqual(adminPermissionsSnapshot(on!, params), {
    recallMemberMessage: false,
    kickMember: true,
    kickMemberPerDay: 20,
  });

  const off = decodeResponse(
    GetAdminPermissions,
    "08e4a2021002221b08bdbc84351a1408914e1a0fa2030c0a04080110020a0408021001",
  );
  assert.deepEqual(adminPermissionsSnapshot(off!, params), {
    recallMemberMessage: true,
    kickMember: false,
    kickMemberPerDay: null,
  });

  const unset = decodeResponse(
    GetAdminPermissions,
    "08e4a2021002221b08bdbc84351a1408914e1a0fa2030c0a04080110000a0408021000",
  );
  // 0 is a THIRD state: "not specified", not false.
  assert.deepEqual(adminPermissionsSnapshot(unset!, params), {
    recallMemberMessage: null,
    kickMember: null,
    kickMemberPerDay: null,
  });
});

test("0x9164_2 adminPermissionsSnapshot skips item ids other than 1 and 2", () => {
  const body = decodeResponse(
    GetAdminPermissions,
    "08e4a2021002221f08bdbc84351a1808914e1a13a203100a08080110011a0208050a0408091001",
  );
  const snapshot = adminPermissionsSnapshot(body!, { groupId: 111222333, userId: 10001 });
  // Item 9 is present in the body and simply ignored; no duplicate-id error.
  assert.equal(snapshot.kickMember, true);
  assert.equal(snapshot.kickMemberPerDay, 5);
  assert.equal(snapshot.recallMemberMessage, null);
});

test("0x9164_2 adminPermissionsSnapshot rejects a group mismatch and a wrong member count", () => {
  const body = decodeResponse(
    GetAdminPermissions,
    "08e4a2021002221f08bdbc84351a1808914e1a13a203100a08080110011a0208140a0408021002",
  );
  assert.throws(
    () => adminPermissionsSnapshot(body!, { groupId: 999, userId: 10001 }),
    /missing or mismatched group/,
  );
  assert.throws(
    () => adminPermissionsSnapshot(body!, { groupId: 111222333, userId: 10002 }),
    /exactly one matching member/,
  );
});

test("0x9164_2 decodeGroupAdminKickLimit reads the extra bytes as a nested message", () => {
  // `extra` is a *bytes* field, not a nested message, so the decoder gets raw
  // bytes and has to re-parse them. `08 14` = maxKickPerDay 20.
  assert.deepEqual(decodeGroupAdminKickLimit(bytes("0814")), { maxKickPerDay: 20 });
  assert.deepEqual(decodeGroupAdminKickLimit(new Uint8Array(0)), { maxKickPerDay: 0 });
});

// ===========================================================================
// 0x9c1c_2 — write administrator permissions
// ===========================================================================

test("0x9c1c_2 SetAdminPermissions request matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(SetAdminPermissions, {
    groupId: 111222333, userId: 10001, recallMemberMessage: true,
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x9c1c_2");
  assert.equal(hex(encoded), "089cb8021002220e08bdbc843510914e1a0408021001");
});

test("0x9c1c_2 'off' is value 2, never 0", () => {
  // On the read side 0 means "not specified", so writing 0 to disable would be read
  // back as unchanged. The write path therefore uses 2.
  const off = encodeRequest(SetAdminPermissions, { groupId: 111222333, userId: 10001, recallMemberMessage: false });
  assert.equal(hex(off.bytes), "089cb8021002220e08bdbc843510914e1a0408021002");
  assert.ok(hex(off.bytes).includes("08021002"), "item 2, value 2");
});

test("0x9c1c_2 enabling kick_member carries the per-day limit as field 3 bytes", () => {
  const { bytes: encoded } = encodeRequest(SetAdminPermissions, {
    groupId: 111222333, userId: 10001, kickMember: true, kickMemberPerDay: 20,
  });
  assert.equal(hex(encoded), "089cb8021002221208bdbc843510914e1a08080110011a020814");
  // `1a 02 0814` — field 3 is bytes holding an encoded GroupAdminKickLimit.
  assert.ok(hex(encoded).includes("1a020814"));
});

test("0x9c1c_2 a per-day limit of 0 produces a SHORTER item (empty extra is dropped)", () => {
  const zero = encodeRequest(SetAdminPermissions, {
    groupId: 111222333, userId: 10001, kickMember: true, kickMemberPerDay: 0,
  });
  assert.equal(hex(zero.bytes), "089cb8021002220e08bdbc843510914e1a0408011001");
  // The limit bytes are `08 00`, which the `!== 0` rule inside the limit message
  // drops, leaving an empty `extra` that the `length > 0` rule drops in turn.
  assert.ok(!hex(zero.bytes).includes("1a00"));
});

test("0x9c1c_2 both capabilities produce two items in a fixed order", () => {
  const { bytes: encoded } = encodeRequest(SetAdminPermissions, {
    groupId: 111222333, userId: 10001, kickMember: false, recallMemberMessage: true,
  });
  // kickMember first (item 1), then recallMemberMessage (item 2) — the reference's
  // push order, which is also the order the read side expects.
  assert.equal(hex(encoded), "089cb8021002221408bdbc843510914e1a04080110021a0408021001");
});

test("0x9c1c_2 an empty request is rejected locally, not sent", () => {
  assert.throws(
    () => SetAdminPermissions.serialize({ groupId: 1, userId: 2 }),
    /at least one administrator permission must be specified/,
  );
});

test("0x9c1c_2 kick_member_per_day is restricted to the server's bucket list", () => {
  assert.throws(
    () => SetAdminPermissions.serialize({ groupId: 1, userId: 2, kickMember: true }),
    /enabling kick_member requires kick_member_per_day/,
  );
  assert.throws(
    () => SetAdminPermissions.serialize({ groupId: 1, userId: 2, kickMember: true, kickMemberPerDay: 7 }),
    /improving|requires kick_member_per_day/,
  );
  // Every allowed value must be accepted.
  for (const limit of [0, 5, 10, 20, 50, 100, 200]) {
    assert.doesNotThrow(() =>
      SetAdminPermissions.serialize({ groupId: 1, userId: 2, kickMember: true, kickMemberPerDay: limit }),
    );
  }
});

test("0x9c1c_2 kick_member_per_day without kick_member is rejected — but only when a capability is set", () => {
  // Validation ORDER matters. With neither capability defined the reference hits
  // its "at least one" guard first, so this request is rejected for that reason,
  // not for the stray limit:
  assert.throws(
    () => SetAdminPermissions.serialize({ groupId: 1, userId: 2, kickMemberPerDay: 5 }),
    /at least one administrator permission must be specified/,
  );
  // Once `kickMember` IS defined (but not true), the second guard fires.
  assert.throws(
    () => SetAdminPermissions.serialize({ groupId: 1, userId: 2, kickMember: false, kickMemberPerDay: 5 }),
    /kick_member_per_day requires kick_member=true/,
  );
});

// ===========================================================================
// 0xfe7_4 — read the receive-verify flag (shares its command with batch B's _3)
// ===========================================================================

test("0xfe7_4 GetAdminReceiveVerify request matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(GetAdminReceiveVerify, {
    groupId: 111222333, userUid: "u_10001",
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0xfe7_4");
  assert.equal(hex(encoded), "08e71f1004221908bdbc8435100318002203c006012a091207755f3130303031");
});

test("0xfe7_4 field3 is 0 and IS emitted; the filter flag is field 104", () => {
  const body = hex(encodeRequest(GetAdminReceiveVerify, { groupId: 111222333, userUid: "u_10001" }).bytes);
  assert.ok(body.includes("1800"), "field 3 with an explicit 0 (`!= null` guard)");
  // `c0 06` = 832 = 104<<3|0.
  assert.ok(body.includes("c00601"), "filter payload at field 104");
  assert.ok(body.includes("2a091207755f3130303031"), "member uid at field 2 of the identity");
});

test("0xfe7_4 uinForm is FALSE here, unlike the SET side", () => {
  const get = encodeRequest(GetAdminReceiveVerify, { groupId: 111222333, userUid: "u_10001" });
  assert.ok(!hex(get.bytes).endsWith("6001"));
  const set = encodeRequest(SetAdminReceiveVerify, { groupId: 1, userId: 2, enable: true });
  assert.ok(hex(set.bytes).endsWith("6001"), "the write side sets reserved=1");
});

test("0xfe7_4 receiveVerifyEnabled INVERTS bit 6", () => {
  const params = { groupId: 111222333, userUid: "u_10001" };
  const clear = decodeResponse(GetAdminReceiveVerify, "08e71f1004221808bdbc843512110a0c1207755f313030303120914ec00600");
  assert.equal(receiveVerifyEnabled(clear!, params), true, "bit 6 clear = enabled");

  const set = decodeResponse(GetAdminReceiveVerify, "08e71f1004221808bdbc843512110a0c1207755f313030303120914ec00640");
  assert.equal(receiveVerifyEnabled(set!, params), false, "bit 6 set = DISABLED");
  assert.equal(64, RECEIVE_VERIFY_DISABLED_BIT);
});

test("0xfe7_4 a missing memberFlagExt is null (unknown), not false", () => {
  const body = decodeResponse(GetAdminReceiveVerify, "08e71f1004221508bdbc8435120e0a0c1207755f313030303120914e");
  assert.equal(body!.members[0]!.memberFlagExt, null);
  assert.equal(receiveVerifyEnabled(body!, { groupId: 111222333, userUid: "u_10001" }), null);
});

test("0xfe7_4 receiveVerifyEnabled rejects a mismatched member", () => {
  const body = decodeResponse(GetAdminReceiveVerify, "08e71f1004221808bdbc843512110a0c1207755f313030303120914ec00600");
  assert.throws(
    () => receiveVerifyEnabled(body!, { groupId: 111222333, userUid: "u_other" }),
    /exactly one matching member/,
  );
});

// ===========================================================================
// 0x904_1 — write the receive-verify flag
// ===========================================================================

test("0x904_1 SetAdminReceiveVerify request matches the reference byte for byte", () => {
  const on = encodeRequest(SetAdminReceiveVerify, { groupId: 111222333, userId: 10001, enable: true });
  assert.equal(on.wireName, "OidbSvcTrpcTcp.0x904_1");
  assert.equal(hex(on.bytes), "0884121001220e08bdbc8435120708914e100118016001");

  const off = encodeRequest(SetAdminReceiveVerify, { groupId: 111222333, userId: 10001, enable: false });
  assert.equal(hex(off.bytes), "0884121001220e08bdbc8435120708914e100118006001");
});

test("0x904_1 operate is emitted even when 0 — the two directions differ by one byte", () => {
  // `18 00` on the wire is the whole difference. With the ordinary uint32 rule the
  // "disable" request would have no operate field and read as "no change".
  const on = hex(encodeRequest(SetAdminReceiveVerify, { groupId: 1, userId: 2, enable: true }).bytes);
  const off = hex(encodeRequest(SetAdminReceiveVerify, { groupId: 1, userId: 2, enable: false }).bytes);
  assert.ok(on.includes("1801"));
  assert.ok(off.includes("1800"));
  assert.equal(on.length, off.length);
});

test("0x904_1 successfulUins accepts BOTH the unpacked and the packed wire form", () => {
  // Same field number, two wire types. A decoder handling only wire 0 loses every
  // id the server packs — and the first version of this port did exactly that,
  // returning one id out of two with no error.
  const unpacked = decodeResponse(SetAdminReceiveVerify, "0884121001220d08bdbc8435120608914e08924e");
  assert.deepEqual(unpacked!.result!.successfulUins, [10001n, 10002n]);

  const packed = decodeResponse(SetAdminReceiveVerify, "0884121001220d08bdbc843512060a04914e924e");
  assert.deepEqual(packed!.result!.successfulUins, [10001n, 10002n]);
});

test("0x904_1 confirmSetAdminReceiveVerify requires the target in successfulUins", () => {
  const body = decodeResponse(SetAdminReceiveVerify, "0884121001220a08bdbc8435120308914e");
  assert.doesNotThrow(() => confirmSetAdminReceiveVerify(body!, { groupId: 111222333, userId: 10001, enable: true }));
  // Acknowledged-but-not-applied is a hard failure, not a warning.
  assert.throws(
    () => confirmSetAdminReceiveVerify(body!, { groupId: 111222333, userId: 10002, enable: true }),
    /did not confirm the target member/,
  );
  assert.throws(
    () => confirmSetAdminReceiveVerify(body!, { groupId: 999, userId: 10001, enable: true }),
    /missing or mismatched group/,
  );
});

// ===========================================================================
// 0xf16_1 — the caller's own group remark
// ===========================================================================

test("0xf16_1 SetGroupRemark request matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(SetGroupRemark, { groupId: 111222333, remark: "my group" });
  assert.equal(wireName, "OidbSvcTrpcTcp.0xf16_1");
  assert.equal(hex(encoded), "08961e100122110a0f08bdbc84351a086d792067726f7570");
});

test("0xf16_1 the remark is field 3 of the inner message, not field 2", () => {
  const body = hex(encodeRequest(SetGroupRemark, { groupId: 111222333, remark: "x" }).bytes);
  // `1a 01 78` = field 3, wire 2, "x". Field 2 would be `12`.
  assert.ok(body.includes("1a0178"), "remark at field 3");
  assert.ok(!body.includes("1201 78".replace(" ", "")));
});

test("0xf16_1 an empty remark clears it by dropping field 3, not by sending a zero", () => {
  const { bytes: encoded } = encodeRequest(SetGroupRemark, { groupId: 111222333, remark: "" });
  assert.equal(hex(encoded), "08961e100122070a0508bdbc8435");
  // The inner message survives with only the group id — `0a 05 08 <group>`.
  assert.ok(hex(encoded).includes("0a0508bdbc8435"));
  assert.ok(!hex(encoded).includes("1a00"), "no explicit empty remark");
});

test("0xf16_1 the inner wrapper is field 1 and field12 is never emitted", () => {
  const { bytes: encoded } = encodeRequest(SetGroupRemark, { groupId: 111222333, remark: "my group" });
  assert.ok(hex(encoded).includes("0a0f08bdbc84351a086d792067726f7570"), "inner at field 1");
  // field12 = 0 -> `!== 0` rule drops it; the envelope's `60 01`? no — this command
  // has no uinForm, so nothing follows the inner message.
  assert.ok(!hex(encoded).endsWith("6001"));
});

test("0xf16_1 the response is empty and decodes to {}", () => {
  const body = decodeResponse(SetGroupRemark, "08961e10012200");
  assert.deepEqual(body, {});
});

// ===========================================================================
// 0x8fc — member card is _3, special title is _2
// ===========================================================================

test("0x8fc_3 SetMemberCard request matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(SetMemberCard, {
    groupId: 111222333, targetUid: "u_10001", card: "new card",
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x8fc_3");
  assert.equal(hex(encoded), "08fc111003221a08bdbc84351a130a07755f313030303142086e65772063617264");
});

test("0x8fc_3 the card text is field 8 of the body, and the body is field 3 of the wrapper", () => {
  const body = hex(encodeRequest(SetMemberCard, { groupId: 111222333, targetUid: "u_10001", card: "new card" }).bytes);
  // `1a` = field 3 (the body), `42` = field 8 (targetName). Not `12`/`12`.
  assert.ok(body.includes("221a"), "body at field 3 of the wrapper");
  assert.ok(body.includes("42086e65772063617264"), "card at field 8 of the body");
});

test("0x8fc_3 an empty card IS sent as an explicit empty string", () => {
  // `targetName` uses a bare `!= null` guard, so "" reaches the wire as `42 00` —
  // that is how "clear this member's card" is expressed, and dropping it would
  // turn a clear into a no-op.
  const { bytes: encoded } = encodeRequest(SetMemberCard, {
    groupId: 111222333, targetUid: "u_10001", card: "",
  });
  assert.equal(hex(encoded), "08fc111003221208bdbc84351a0b0a07755f31303030314200");
  assert.ok(hex(encoded).endsWith("4200"));
});

test("0x8fc_2 SetSpecialTitle request matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(SetSpecialTitle, {
    groupId: 111222333, targetUid: "u_10001", title: "MVP",
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x8fc_2");
  assert.equal(hex(encoded), "08fc111002222008bdbc84351a190a07755f31303030312a034d565030ffffffff0f3a034d5650");
});

test("0x8fc_2 the title is written TWICE, at fields 5 and 7", () => {
  const body = hex(encodeRequest(SetSpecialTitle, { groupId: 111222333, targetUid: "u_10001", title: "MVP" }).bytes);
  assert.ok(body.includes("2a034d5650"), "field 5 = specialTitle");
  assert.ok(body.includes("3a034d5650"), "field 7 = uinName, same text");
});

test("0x8fc_2 expire_time -1 is a 5-byte UNSIGNED varint, not a 10-byte signed one", () => {
  const body = hex(encodeRequest(SetSpecialTitle, { groupId: 1, targetUid: "u", title: "t" }).bytes);
  // `30 ffffffff0f` = field 6, uint32 4294967295. An int32 writer would emit
  // `30 ffffffffffffffffff01` (10 bytes) — same value, different bytes.
  assert.ok(body.includes("30ffffffff0f"));
  assert.ok(!body.includes("ffffffffffffffffff01"));
});

test("0x8fc_2 an empty title is sent as two explicit empty strings", () => {
  const { bytes: encoded } = encodeRequest(SetSpecialTitle, {
    groupId: 111222333, targetUid: "u_10001", title: "",
  });
  assert.equal(hex(encoded), "08fc111002221a08bdbc84351a130a07755f31303030312a0030ffffffff0f3a00");
  assert.ok(hex(encoded).includes("2a00"), "field 5 present and empty");
  assert.ok(hex(encoded).includes("3a00"), "field 7 present and empty");
});

test("0x8fc the two sub-commands are 2 and 3, and share one command number", () => {
  assert.equal(KickMember.command === 0x8a0, true);
  const card = encodeRequest(SetMemberCard, { groupId: 1, targetUid: "u", card: "c" });
  const title = encodeRequest(SetSpecialTitle, { groupId: 1, targetUid: "u", title: "t" });
  assert.equal(card.wireName, "OidbSvcTrpcTcp.0x8fc_3");
  assert.equal(title.wireName, "OidbSvcTrpcTcp.0x8fc_2");
});

test("0x8fc both responses are empty", () => {
  assert.deepEqual(decodeResponse(SetMemberCard, "08fc1110032200"), {});
  assert.deepEqual(decodeResponse(SetSpecialTitle, "08fc1110022200"), {});
});

test("0x8fc parameter adapters resolve uids for both commands", async () => {
  const card = await setMemberCardParams({ groupId: 1, userId: 10001, card: "c" }, async (u) => `u_${u}`);
  assert.deepEqual(card, { groupId: 1, targetUid: "u_10001", card: "c" });
  const title = await setSpecialTitleParams({ groupId: 1, userId: 10001, title: "t" }, async (u) => `u_${u}`);
  assert.deepEqual(title, { groupId: 1, targetUid: "u_10001", title: "t" });
});

// ===========================================================================
// 0xef0_1 — read the group robot-add option
// ===========================================================================

test("0xef0_1 FetchGroupExtInfo request matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(FetchGroupExtInfo, { groupId: 111222333 });
  assert.equal(wireName, "OidbSvcTrpcTcp.0xef0_1");
  assert.equal(hex(encoded), "08f01d1001220d08bdbc84351206e80101f001016001");
});

test("0xef0_1 the filter payload is at fields 29 and 30, not 1 and 2", () => {
  const body = hex(encodeRequest(FetchGroupExtInfo, { groupId: 111222333 }).bytes);
  // `e8 01` = 232 = 29<<3|0, `f0 01` = 240 = 30<<3|0 — two-byte tags.
  assert.ok(body.includes("e80101f00101"));
  assert.ok(!body.includes("120608011001"), "a filter at fields 1/2 would be 2 bytes shorter");
});

test("0xef0_1 uinForm is true", () => {
  assert.ok(hex(encodeRequest(FetchGroupExtInfo, { groupId: 111222333 }).bytes).endsWith("6001"));
});

test("0xef0_1 toGroupRobotAddOption flattens items[0] and defaults missing flags to 0", () => {
  const on = decodeResponse(FetchGroupExtInfo, "08f01d100122110a0f08bdbc843510001a06e80101f00101");
  assert.deepEqual(toGroupRobotAddOption(on!), { robotMemberSwitch: 1, robotMemberExamine: 1 });

  const off = decodeResponse(FetchGroupExtInfo, "08f01d100122110a0f08bdbc843510001a06e80100f00100");
  assert.deepEqual(toGroupRobotAddOption(off!), { robotMemberSwitch: 0, robotMemberExamine: 0 });
});

test("0xef0_1 a nonzero resultCode and a missing item are both hard failures", () => {
  const bad = decodeResponse(FetchGroupExtInfo, "08f01d1001220e0a0c08bdbc843510051a03e80101");
  assert.throws(() => toGroupRobotAddOption(bad!), /result=5/);

  const empty = decodeResponse(FetchGroupExtInfo, "08f01d10012200");
  assert.throws(() => toGroupRobotAddOption(empty!), /unable to read group robot-add option/);
});

// ===========================================================================
// 0xf00_3 — write the group robot-add option
// ===========================================================================

test("0xf00_3 ModifyGroupExtInfo request matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(ModifyGroupExtInfo, {
    groupId: 111222333, robotMemberSwitch: 1, robotMemberExamine: 1,
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0xf00_3");
  assert.equal(hex(encoded), "08801e1003221408bdbc8435120d08bdbc84351206e80101f001016001");
});

test("0xf00_3 the group number appears TWICE, nested at the same field number", () => {
  const body = hex(encodeRequest(ModifyGroupExtInfo, { groupId: 111222333, robotMemberSwitch: 1 }).bytes);
  // Outer `08 <group>`, then `12 <len> 08 <group> 12 <len> ...` — filling only the
  // outer one parses fine and is ignored.
  assert.ok(body.includes("08bdbc8435120a08bdbc8435"), "outer group, info, inner group");
  assert.equal(body.split("08bdbc8435").length - 1, 2, "the group id appears exactly twice");
});

test("0xf00_3 a supplied 0 IS written (this writer uses `!= null`, unlike the filter)", () => {
  const { bytes: encoded } = encodeRequest(ModifyGroupExtInfo, { groupId: 111222333, robotMemberSwitch: 0 });
  assert.equal(hex(encoded), "08801e1003221108bdbc8435120a08bdbc84351203e801006001");
  assert.ok(hex(encoded).includes("e80100"), "explicit 0 = turn the switch off");
});

test("0xf00_3 an empty ext still emits field 2 of info as an empty message", () => {
  const { bytes: encoded } = encodeRequest(ModifyGroupExtInfo, { groupId: 111222333 });
  assert.equal(hex(encoded), "08801e1003220e08bdbc8435120708bdbc843512006001");
  // `12 00` — a present but empty ext, which is a different request from omitting it.
  assert.ok(hex(encoded).endsWith("12006001"));
});

test("0xf00_3 the second flag costs exactly 6 bytes (2-byte tag + 1-byte value, x2 lengths)", () => {
  const one = hex(encodeRequest(ModifyGroupExtInfo, { groupId: 1, robotMemberSwitch: 1 }).bytes);
  const two = hex(encodeRequest(ModifyGroupExtInfo, { groupId: 1, robotMemberSwitch: 1, robotMemberExamine: 1 }).bytes);
  // Fields 29 and 30 need two-byte tags (`e8 01` / `f0 01`) — that is the whole
  // reason this is not a 2-byte-per-field increase. 3 bytes of payload propagate
  // through two enclosing length prefixes as +3 in hex characters each.
  assert.equal(two.length, one.length + 6, "3 payload bytes + 3 hex chars of length bookkeeping");
  assert.ok(!one.includes("f001"), "a single-flag write carries no field 30 at all");
});

test("0xf00_3 uinForm is true and a nonzero result throws a plain Error", () => {
  assert.ok(hex(encodeRequest(ModifyGroupExtInfo, { groupId: 1 }).bytes).endsWith("6001"));
  const bad = decodeResponse(ModifyGroupExtInfo, "08801e1003220708bdbc84351003");
  assert.throws(() => ModifyGroupExtInfo.deserialize(bad!), /modifyGroupExtInfo failed: result=3/);
  const ok = decodeResponse(ModifyGroupExtInfo, "08801e1003220708bdbc84351000");
  assert.doesNotThrow(() => ModifyGroupExtInfo.deserialize(ok!));
});

test("0xef0_1 and 0xf00_3 are different commands, not a request/response pair", () => {
  const read = encodeRequest(FetchGroupExtInfo, { groupId: 1 });
  const write = encodeRequest(ModifyGroupExtInfo, { groupId: 1 });
  assert.notEqual(read.wireName, write.wireName);
  assert.equal(read.wireName, "OidbSvcTrpcTcp.0xef0_1");
  assert.equal(write.wireName, "OidbSvcTrpcTcp.0xf00_3");
});

// ===========================================================================
// 0x967c_0 / 0x967d_0 / 0x967e_0 — a family whose adjacency IS real
// ===========================================================================

test("0x967c_0 GetGroupCategoryTags request matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(GetGroupCategoryTags, { groupClass: 8 });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x967c_0");
  assert.equal(hex(encoded), "08fcac0222020808");
});

test("0x967c_0 groupClass 0 IS emitted (bare `!= null` guard)", () => {
  // With the ordinary uint32 rule this request would have an EMPTY body, which the
  // server reads as "class unspecified" — a different query.
  const { bytes: encoded } = encodeRequest(GetGroupCategoryTags, { groupClass: 0 });
  assert.equal(hex(encoded), "08fcac0222020800");
  assert.ok(hex(encoded).endsWith("0800"));
});

test("0x967d_0 / 0x967e_0 add and delete differ only in the command byte", () => {
  const add = encodeRequest(AddGroupCategoryTag, { groupClass: 8, name: "玩机" });
  const del = encodeRequest(DeleteGroupCategoryTag, { groupClass: 8, name: "玩机" });
  assert.equal(add.wireName, "OidbSvcTrpcTcp.0x967d_0");
  assert.equal(del.wireName, "OidbSvcTrpcTcp.0x967e_0");
  assert.equal(hex(add.bytes), "08fdac02220a08081206e78ea9e69cba");
  assert.equal(hex(del.bytes), "08feac02220a08081206e78ea9e69cba");
});

test("0x967c-0x967e share one groupClass field and one validator", () => {
  assert.throws(() => GetGroupCategoryTags.serialize({ groupClass: -1 }), /group class -1 is out of range/);
  assert.throws(() => GetGroupCategoryTags.serialize({ groupClass: 4294967296 }), /out of range/);
  assert.throws(() => AddGroupCategoryTag.serialize({ groupClass: 1.5, name: "x" }), /out of range/);
  assert.throws(() => AddGroupCategoryTag.serialize({ groupClass: 1, name: "" }), /tag name must not be empty/);
  assert.throws(() => DeleteGroupCategoryTag.serialize({ groupClass: 1, name: "" }), /tag name must not be empty/);
  assert.doesNotThrow(() => AddGroupCategoryTag.serialize({ groupClass: 4294967295, name: "ok" }));
});

test("0x967c_0 the response tags decode and toTag defaults every field", () => {
  const body = decodeResponse(GetGroupCategoryTags,
    "08fcac021000221c0a0c08071206e78ea9e69cba18020a0c08091206e6b8b8e6888f1801");
  assert.deepEqual(body!.tags.map(toTag), [
    { id: 7, name: "玩机", type: 2 },
    { id: 9, name: "游戏", type: 1 },
  ]);
  // A tag message with no fields becomes a complete object, not `{}`.
  assert.deepEqual(toTag({ id: undefined as any, name: undefined as any, type: undefined as any }), {
    id: 0, name: "", type: 0,
  });
});

test("0x967c_0 an empty tag list is [] and not null", () => {
  const body = decodeResponse(GetGroupCategoryTags, "08fcac0210002200");
  assert.deepEqual(body!.tags, []);
});

test("0x967d_0 / 0x967e_0 the mutation responses are empty", () => {
  assert.deepEqual(decodeResponse(AddGroupCategoryTag, "08fdac0210002200"), {});
  assert.deepEqual(decodeResponse(DeleteGroupCategoryTag, "08feac0210002200"), {});
});

// ===========================================================================
// Specs the batch brief named that already existed — the re-exports must be the
// same codecs, not copies
// ===========================================================================

test("0x1097_1 LeaveGroup is the same spec as batch A's SetGroupLeave", () => {
  const { wireName, bytes: encoded } = encodeRequest(LeaveGroup, { groupId: 111222333 });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x1097_1");
  assert.equal(hex(encoded), "0897211001220508bdbc8435");
});

test("0x1096_1 SetAdmin revoke drops the isAdmin field entirely", () => {
  const on = encodeRequest(SetAdmin, { groupId: 111222333, uid: "u_10001", enable: true });
  assert.equal(hex(on.bytes), "0896211001221008bdbc84351207755f31303030311801");
  const off = encodeRequest(SetAdmin, { groupId: 111222333, uid: "u_10001", enable: false });
  assert.equal(hex(off.bytes), "0896211001220e08bdbc84351207755f3130303031");
});

test("0x89a_0 MuteAll true is 0xffffffff, not a duration", () => {
  const on = encodeRequest(MuteAll, { groupId: 111222333, enable: true });
  assert.equal(hex(on.bytes), "089a11220e08bdbc843512078801ffffffff0f");
  const off = encodeRequest(MuteAll, { groupId: 111222333, enable: false });
  assert.equal(hex(off.bytes), "089a11220a08bdbc84351203880100");
});

test("0x89a_0 SetAddOption aliases 55 to 5 and clears the answer for non-4", () => {
  const q4 = encodeRequest(SetAddOption, { groupId: 111222333, addType: 4, groupQuestion: "who?", groupAnswer: "me" });
  assert.equal(hex(q4.bytes), "089a11221608bdbc8435120f800104f2010477686f3ffa01026d65");

  // addType 5: the answer is cleared to "" but STILL emitted (`fa0100`).
  const a5 = encodeRequest(SetAddOption, { groupId: 111222333, addType: 5, groupQuestion: "who?", groupAnswer: "ignored" });
  assert.equal(hex(a5.bytes), "089a11221408bdbc8435120d800105f2010477686f3ffa0100");

  // 55 is the alias of 5, so identical to the above.
  const a55 = encodeRequest(SetAddOption, { groupId: 111222333, addType: 55, groupQuestion: "who?" });
  assert.equal(hex(a55.bytes), hex(a5.bytes));

  // addType 1 carries no question at all.
  const a1 = encodeRequest(SetAddOption, { groupId: 111222333, addType: 1 });
  assert.equal(hex(a1.bytes), "089a11220a08bdbc84351203800101");
});

test("0x89a_0 SetSearch emits an explicit 0 and can send an empty settings message", () => {
  const both = encodeRequest(SetSearch, { groupId: 111222333, noFingerOpen: 0, noCodeFingerOpen: 1 });
  assert.equal(hex(both.bytes), "089a11220d08bdbc84351206980200a00201");
  assert.ok(hex(both.bytes).includes("980200"), "noFingerOpen 0 is meaningful");

  const none = encodeRequest(SetSearch, { groupId: 111222333 });
  assert.equal(hex(none.bytes), "089a11220708bdbc84351200");
  assert.ok(hex(none.bytes).endsWith("1200"), "present but empty settings");
});

test("0x89a_0 the invite policy merges into the privilege flag without clobbering other bits", () => {
  const disabled = encodeRequest(SetMemberInvitePolicy, {
    groupId: 111222333, currentPrivilegeFlag: 5, policy: "disabled",
  });
  assert.equal(hex(disabled.bytes), "089a11221608bdbc8435120fb80185808020c0018080c030e80100");

  const noApproval = encodeRequest(SetMemberInvitePolicy, {
    groupId: 111222333, currentPrivilegeFlag: 0, policy: "no_approval",
  });
  assert.equal(hex(noApproval.bytes), "089a11221508bdbc8435120eb801808040c0018080c030e80101");
  // The low bit of the incoming flag (5 & 1) survives the merge.
  assert.ok(hex(disabled.bytes).includes("b80185808020"));
});

test("0x89a_0 history visibility sets a fixed mask", () => {
  const on = encodeRequest(SetNewMemberHistoryVisibility, { groupId: 111222333, visible: true });
  assert.equal(hex(on.bytes), "089a11220d08bdbc84351206d00204d80204");
  const off = encodeRequest(SetNewMemberHistoryVisibility, { groupId: 111222333, visible: false });
  assert.equal(hex(off.bytes), "089a11220d08bdbc84351206d00200d80204");
  // The flag goes to 0 but the MASK stays at 4 — otherwise "hide" would be "no change".
  assert.ok(hex(off.bytes).includes("d80204"));
});

test("0x89a_0 member permission writes a per-permission mask", () => {
  const album = encodeRequest(SetMemberPermission, {
    groupId: 111222333, currentPrivilegeFlag: 5, permission: "upload_album", allow: true,
  });
  assert.equal(hex(album.bytes), "089a11220d08bdbc84351206b80104c00101");

  const session = encodeRequest(SetMemberPermission, {
    groupId: 111222333, currentPrivilegeFlag: 5, permission: "temporary_session", allow: false,
  });
  assert.equal(hex(session.bytes), "089a11221108bdbc8435120ab801858004c001808004");
});

// ===========================================================================
// Cross-cutting: the five 0x89a_0 settings variants share a command, not a schema
// ===========================================================================

test("five labels collapse onto 0x89a_0 and are told apart only by their settings", () => {
  const specs: Array<[string, EncodeSpec, any]> = [
    ["muteAll", MuteAll, { groupId: 1, enable: true }],
    ["setAddOption", SetAddOption, { groupId: 1, addType: 1 }],
    ["setSearch", SetSearch, { groupId: 1 }],
    ["setMemberInvitePolicy", SetMemberInvitePolicy, { groupId: 1, policy: "disabled" }],
    ["setNewMemberHistoryVisibility", SetNewMemberHistoryVisibility, { groupId: 1, visible: true }],
    ["setMemberPermission", SetMemberPermission, { groupId: 1, permission: "upload_album", allow: true }],
  ];
  for (const [, spec, params] of specs) {
    assert.equal(encodeRequest(spec, params).wireName, "OidbSvcTrpcTcp.0x89a_0");
  }
  // All six bodies differ from each other despite sharing the wire name.
  const bodies = new Set(specs.map(([, spec, params]) => hex(encodeRequest(spec, params).bytes)));
  assert.equal(bodies.size, specs.length, "every settings variant has a distinct body");
});