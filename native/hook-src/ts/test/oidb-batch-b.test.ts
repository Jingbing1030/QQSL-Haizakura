// OIDB batch B service tests — friendship / profile / settings / misc.
//
// Same principle as oidb-services.test.ts: **every expected byte string was
// produced by evaluating the reference implementation**, never typed by hand.
// The two directions are produced differently, and the difference is deliberate:
//
//   request  — the reference has generated encoders, so the golden is what
//              `spec.serialize` + `spec.encode` emit for a given params object
//              (work/oidb-b/golden.mjs, mode `encode`).
//   response — the reference has decoders but no response encoders, so the input
//              bytes are wire literals built with work/oidb-b/pb.mjs and the
//              expected *value* is what the reference's own
//              `decode -> deserialize` produces from them (mode `decode`).
//
// Both directions are replayed by work/oidb-b/probe.mjs and probe_resp.mjs before
// being pasted here; the harness diff is what makes a mismatch findable.
import { test } from "node:test";
import assert from "node:assert/strict";

import { makeOidbEnvelope, encodeOidbEnvelope, decodeOidbEnvelope, oidbWireName, OidbError } from "../src/oidb/envelope.js";
import {
  // 0x88d_0
  FetchGroupDetailInfo,
  toGroupDetail,
  toGroupAdminSettings,
  isGroupDetailAllMuted,
  GROUP_DETAIL_REQUEST_FIELD1,
  // 0x10c8
  SetAddRequest,
  EMPTY_REASON_PLACEHOLDER,
  // 0x1253_1 / 0x1255_0 / 0x126b_0
  MuteMember,
  SetFriendCategory,
  FRIEND_CATEGORY_ALREADY_APPLIED,
  DeleteFriend,
  // 0x912e_0 / 0x912f_0
  SetFriendRemark,
  ClearFriendRemark,
  checkFriendRemarkResponse,
  confirmFriendRemark,
  // 0xfe1_2
  GetStrangerStatus,
  FetchUserProfile,
  FetchUserProfileByUid,
  withRequestedUin,
  PUBLIC_PROFILE_KEYS,
  STATUS_PROPERTY_KEY,
  unpackStatusWord,
  decodeMembership,
  decodeBirthday,
  // 0xfd4_1
  FetchFriendListPage,
  mapFriend,
  // 0xfe7_3
  FetchGroupMemberListPage,
  permissionToRole,
  // 0x126e_200
  GetGroupPttUrl,
  normalizeMediaNode,
  parseNtv2DownloadUrl,
  // 0x12a9_200
  GetFlashDownload,
  parseFlashDownloadUrl,
  resetFlashSequence,
  peekFlashSequence,
} from "../src/oidb/services/index.js";

const hex = (input: Uint8Array): string => Buffer.from(input).toString("hex");
const bytes = (source: string | Uint8Array): Uint8Array =>
  typeof source === "string" ? Uint8Array.from(Buffer.from(source, "hex")) : source;

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

/**
 * Decode a full response envelope through a spec, the way invokeOidb does.
 *
 * The golden hex below is the whole envelope (command / subCommand / body), because
 * that is what the reference's `spec.decode` consumes and what makes the envelope
 * field numbers part of the assertion too.
 */
function decodeResponse(spec: { decodeBody: (d: Uint8Array, o?: number, e?: number) => any }, envelopeHex: string) {
  return decodeOidbEnvelope(bytes(envelopeHex), spec.decodeBody).body;
}

// ===========================================================================
// 0x88d_0 — group detail: the only source of `group_level`
// ===========================================================================
//
// The reason this command was a gap: 0xfe5_2's group message has no level field,
// and the reference resolves `group_level` through a separate detail call
// (reference/index.mjs:74552 `fetchGroupDetail` -> this command).  The request is
// a constant apart from the group number, so the two goldens below differ only in
// the encoded groupUin.

test("0x88d_0 FetchGroupDetail request matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(FetchGroupDetailInfo, { groupUin: 111222333 });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x88d_0");
  assert.equal(
    hex(encoded),
    "088d11223908c5fd8d8002123108bdbc8435122a080110012801300138015001a80101b00101b80101c20100ca0100e80201c00301900501980501a80601",
  );
});

test("0x88d_0 the request flags are a fixed set, not a subset", () => {
  // Note the two zero-length fields `c2 01 00` / `ca 01 00`: `question` and `answer`
  // use the `!= null` presence rule, so the reference's explicit "" is written.  The
  // three other string slots (`name`, `noticePreview`, `maxAdminCount`) use the
  // ordinary "drop when empty" rule and do NOT appear.  A uniform rule changes the
  // request length by four bytes.
  const { bytes: encoded } = encodeRequest(FetchGroupDetailInfo, { groupUin: 111222333 });
  const body = decodeOidbEnvelope(encoded, (d, o, e) => d.slice(o, e)).body!;
  assert.ok(hex(body).includes("c20100ca0100"), "question/answer must be present as empty");
  assert.ok(!hex(body).includes("7a00"), "name must be absent when empty");
  assert.equal(GROUP_DETAIL_REQUEST_FIELD1, 537099973);
});

test("0x88d_0 a group number above 2^31 encodes as an unsigned varint", () => {
  const { bytes: encoded } = encodeRequest(FetchGroupDetailInfo, { groupUin: 10001 });
  assert.equal(
    hex(encoded),
    "088d11223708c5fd8d8002122f08914e122a080110012801300138015001a80101b00101b80101c20100ca0100e80201c00301900501980501a80601",
  );
});

test("0x88d_0 response decodes ownerUid as a string and level as a number", () => {
  // Field 1 of the results message is a **string** uid while field 21 is a uint64
  // uin; reading the uid as a varint yields 0 with no error, which would make the
  // owner check in set_group_member_permissions pass for everyone.
  const body = decodeResponse(FetchGroupDetailInfo, "088d1110002283010a800108bdbc84351a790a0b755f6f776e65725f7569641080a0f8fa0528f403302a380350187a0a546573742047726f757082010e6e6f746963652070726576696577a801bdbc8435b001b1d1f9d603b801fba0f8fa05c2010c77686f2061726520796f753fca01086120667269656e64e80103e80200c00305900501980500a80607");
  const results = body!.groupInfo!.results!;
  assert.equal(results.ownerUid, "u_owner_uid");
  assert.equal(results.level, 24n);
  assert.equal(results.memberCount, 42n);
  assert.equal(results.maxMemberCount, 500n);
  assert.equal(results.maxAdminCount, 3n); // uint64, not the string the flags field suggests
  assert.equal(results.name, "Test Group");
  assert.equal(results.addType, 3);
  assert.equal(results.shutUpAllTimestamp, 0);
  assert.equal(results.groupFlagExt4, 7);
});

test("0x88d_0 toGroupDetail returns null when the server sends no results", () => {
  // Golden gdetail_empty.  Returning an all-zero record instead of null would make
  // the non-member group path cache a bogus entry (reference/index.mjs:74553).
  const body = decodeResponse(FetchGroupDetailInfo, "088d11100022070a0508bdbc8435");
  assert.equal(body!.groupInfo!.uin, 111222333n);
  assert.equal(body!.groupInfo!.results, undefined);
  assert.equal(toGroupDetail(body!, 111222333), null);
});

test("0x88d_0 toGroupDetail projects the detail record", () => {
  const body = decodeResponse(FetchGroupDetailInfo, "088d1110002283010a800108bdbc84351a790a0b755f6f776e65725f7569641080a0f8fa0528f403302a380350187a0a546573742047726f757082010e6e6f746963652070726576696577a801bdbc8435b001b1d1f9d603b801fba0f8fa05c2010c77686f2061726520796f753fca01086120667269656e64e80103e80200c00305900501980500a80607");
  assert.deepEqual(toGroupDetail(body!, 111222333), {
    groupId: 111222333,
    groupName: "Test Group",
    remark: "",
    memberCount: 42,
    memberMax: 500,
    createTime: 1600000000,
    level: 24,
    memo: "notice preview",
    allMuted: false,
  });
});

test("0x88d_0 a shutUpAllTimestamp in the future means all-muted", () => {
  // Golden gdetail_muted: 4102444800 = 2100-01-01, so muted relative to now.
  const body = decodeResponse(FetchGroupDetailInfo, "088d11100022140a1208bdbc84351a0b30055001e80280ae99a40f");
  assert.equal(toGroupDetail(body!, 111222333)!.allMuted, true);
  assert.equal(isGroupDetailAllMuted(0), false);
  assert.equal(isGroupDetailAllMuted(4102444800), true);
  // A timestamp exactly "now" is not muted — the comparison is strictly greater.
  assert.equal(isGroupDetailAllMuted(1000, 1000), false);
});

test("0x88d_0 toGroupAdminSettings exposes the raw fields 0xef0_1 does not carry", () => {
  const body = decodeResponse(FetchGroupDetailInfo, "088d1110002283010a800108bdbc84351a790a0b755f6f776e65725f7569641080a0f8fa0528f403302a380350187a0a546573742047726f757082010e6e6f746963652070726576696577a801bdbc8435b001b1d1f9d603b801fba0f8fa05c2010c77686f2061726520796f753fca01086120667269656e64e80103e80200c00305900501980500a80607");
  assert.deepEqual(toGroupAdminSettings(body!.groupInfo!.results!), {
    addType: 3,
    question: "who are you?",
    answer: "a friend",
    privilegeFlag: 5,
    groupFlagExt4: 7,
    noFingerOpen: 1,
    noCodeFingerOpen: 0,
  });
});

// ===========================================================================
// 0x10c8_1 / _2 — approve or reject a group join request
// ===========================================================================
//
// The sub-command is 1 or 2 and never 0: `filtered` selects the bucket.  The label
// in ONEBOT-ACTION-SPEC.md ("0x10c8_0") is wrong, and `0x10c0` is the list call.

test("0x10c8_1 approval uses accept=1 and a single-space reason", () => {
  // `message` uses the `!= null` rule, and the reference substitutes " " for an
  // empty reason — `2201 20` is a one-byte field holding a space.
  const { wireName, bytes: encoded } = encodeRequest(SetAddRequest, {
    groupId: 987654321,
    sequence: 1234567890123n,
    eventType: 1,
    approve: true,
    reason: "",
    filtered: false,
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x10c8_1");
  assert.equal(hex(encoded), "08c821100122160801121208cb89ec8ff723100118b1d1f9d6032201206001");
  assert.equal(EMPTY_REASON_PLACEHOLDER, " ");
});

test("0x10c8_2 rejection uses accept=2 and selects the filtered bucket", () => {
  const { wireName, bytes: encoded } = encodeRequest(SetAddRequest, {
    groupId: 987654321,
    sequence: 7n,
    eventType: 2,
    approve: false,
    reason: "no thanks",
    filtered: true,
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x10c8_2");
  assert.equal(hex(encoded), "08c82110022219080212150807100218b1d1f9d60322096e6f207468616e6b736001");
});

test("0x10c8_1 operateTransInfo rides along as field 7 bytes", () => {
  const { bytes: encoded } = encodeRequest(SetAddRequest, {
    groupId: 111,
    sequence: 1n,
    eventType: 3,
    approve: true,
    reason: "ok",
    filtered: false,
    operateTransInfo: bytes("0a03aabbcc"),
  });
  assert.equal(hex(encoded), "08c821100122150801121108011003186f22026f6b3a050a03aabbcc6001");
});

test("0x10c8_1 the envelope sets reserved=1 (uinForm)", () => {
  const { bytes: encoded } = encodeRequest(SetAddRequest, {
    groupId: 1,
    sequence: 1n,
    eventType: 1,
    approve: true,
    reason: "x",
  });
  // `60 01` at the end is envelope field 12 (reserved) = 1.
  assert.ok(hex(encoded).endsWith("6001"), hex(encoded));
});

test("0x10c8_1 a number sequence is widened to uint64, not truncated", () => {
  const asNumber = encodeRequest(SetAddRequest, {
    groupId: 1,
    sequence: 1234567890123,
    eventType: 1,
    approve: true,
    reason: "x",
  });
  const asBigInt = encodeRequest(SetAddRequest, {
    groupId: 1,
    sequence: 1234567890123n,
    eventType: 1,
    approve: true,
    reason: "x",
  });
  assert.equal(hex(asNumber.bytes), hex(asBigInt.bytes));
});

test("0x10c8_1 deserialize yields undefined — the response is OidbEmpty", () => {
  const body = decodeResponse(SetAddRequest, "08c82110012200");
  assert.deepEqual(body, {});
  assert.equal(SetAddRequest.deserialize(body), undefined);
});

// ===========================================================================
// 0x1253_1 — mute one group member
// ===========================================================================

test("0x1253_1 MuteMember request matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(MuteMember, {
    groupId: 111222333,
    targetUid: "u_10001",
    duration: 600,
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x1253_1");
  assert.equal(hex(encoded), "08d3241001221508bdbc843510011a0c0a07755f313030303110d804");
});

test("0x1253_1 duration 0 is omitted, which is how a mute is lifted", () => {
  // The guard is `!= null && !== 0`.  Writing an explicit 0 (`10 00`) would change
  // the request's meaning from "no duration" to "zero-second mute".
  const { bytes: encoded } = encodeRequest(MuteMember, {
    groupId: 111222333,
    targetUid: "u_10001",
    duration: 0,
  });
  assert.equal(hex(encoded), "08d3241001221208bdbc843510011a090a07755f3130303031");
  assert.ok(!hex(encoded).includes("10d804"));
});

test("0x1253_1 the target is a uid string inside the body message", () => {
  // `1a 0c` = field 3 (body), length 12; inside, `0a 07` = field 1, length 7 = the uid.
  const { bytes: encoded } = encodeRequest(MuteMember, { groupId: 1, targetUid: "u_abc", duration: 60 });
  assert.ok(hex(encoded).includes("1a090a05755f616263103c"), hex(encoded));
});

// ===========================================================================
// 0x1255_0 — move a friend into a 分组
// ===========================================================================

test("0x1255_0 SetFriendCategory request matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(SetFriendCategory, {
    uid: "u_AbCdEfGh",
    categoryId: 3,
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x1255_0");
  assert.equal(hex(encoded), "08d524220e0a0a755f416243644566476810036001");
});

test("0x1255_0 accepts envelope code 2001002 (already in that category)", () => {
  // Treating this as a failure would make an idempotent move look broken.
  assert.deepEqual(SetFriendCategory.acceptedEnvelopeCodes, [FRIEND_CATEGORY_ALREADY_APPLIED]);
  assert.equal(FRIEND_CATEGORY_ALREADY_APPLIED, 2001002);
  assert.equal(SetFriendCategory.deserialize({ uid: "", categoryId: 0 }), undefined);
});

// ===========================================================================
// 0x126b_0 — delete a friend
// ===========================================================================

test("0x126b_0 DeleteFriend without block still writes block=0", () => {
  // `block` is one of the few fields with the bare `!= null` guard, and serialize
  // always supplies `?? false` — so `18 00` is on the wire.  Dropping it changes the
  // meaning from "do not block" to "block unspecified".
  const { wireName, bytes: encoded } = encodeRequest(DeleteFriend, { targetUid: "u_10001" });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x126b_0");
  assert.equal(
    hex(encoded),
    "08eb24221e0a1c0a07755f3130303031120d088201106d1a0608081008183218002001",
  );
});

test("0x126b_0 DeleteFriend with block=true writes block=1", () => {
  const { bytes: encoded } = encodeRequest(DeleteFriend, { targetUid: "u_10001", block: true });
  assert.equal(
    hex(encoded),
    "08eb24221e0a1c0a07755f3130303031120d088201106d1a0608081008183218012001",
  );
});

test("0x126b_0 the constant stamp is 130/109 and 8/8/50", () => {
  // No named constants exist for these in the bundle; they are `field2`/`field3`
  // literals.  `08 82 01` = field 1 varint 130, `10 6d` = field 2 varint 109,
  // `1a 06 08 08 10 08 18 32` = field 3 message {8, 8, 50}.
  const { bytes: encoded } = encodeRequest(DeleteFriend, { targetUid: "" });
  assert.ok(hex(encoded).includes("088201106d1a06080810081832"), hex(encoded));
});

// ===========================================================================
// 0x912e_0 / 0x912f_0 — friend remark
// ===========================================================================

test("0x912e_0 SetFriendRemark request uses target field 3 and 7, plus scene=0", () => {
  // The target submessage numbers `targetUin`=3 and `targetUid`=7 — neither is 1.
  // `10 00` at the end is `scene: 0`, written because its guard is `!= null`.
  const { wireName, bytes: encoded } = encodeRequest(SetFriendRemark, {
    targetUid: "u_10001",
    remark: "buddy",
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x912e_0");
  assert.equal(hex(encoded), "08aea20222160a120a093a07755f3130303031120562756464791000");
});

test("0x912f_0 ClearFriendRemark sends only the target", () => {
  const { wireName, bytes: encoded } = encodeRequest(ClearFriendRemark, { targetUid: "u_10001" });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x912f_0");
  assert.equal(hex(encoded), "08afa202220b0a093a07755f3130303031");
});

test("0x912e_0 a well-formed response confirms the remark", () => {
  const body = decodeResponse(SetFriendRemark, "08aea202100022170a150a0c18914e3a07755f313030303112056275646479");
  const result = checkFriendRemarkResponse(body);
  assert.deepEqual(result, { targetUid: "u_10001", targetUin: 10001, remark: "buddy" });
  // Matching values pass the confirmation silently.
  assert.equal(confirmFriendRemark(result, { targetUid: "u_10001", targetUin: 10001, remark: "buddy" }), undefined);
});

test("0x912e_0 a nonzero error code inside a successful envelope throws OidbError", () => {
  // Golden remark_err5: envelope errorCode is 0, but the body carries error.code=5.
  const body = decodeResponse(SetFriendRemark, "08aea2021000220c1a0a10051a0664656e696564");
  assert.throws(
    () => checkFriendRemarkResponse(body),
    (error: unknown) =>
      error instanceof OidbError &&
      error.code === 5 &&
      error.message === "OIDB error 5 on 0x912e_0: denied",
  );
});

test("0x912e_0 an error record with code 0 is a failure, not a success", () => {
  // Golden remark_err0.  `code === 0` must not be read as "no error".
  const body = decodeResponse(SetFriendRemark, "08aea2021000220d1a0b10001a076e6f20636f6465");
  assert.throws(() => checkFriendRemarkResponse(body), /error result has no failure code/);
});

test("0x912e_0 a result carrying only a targetUin still confirms", () => {
  // Golden remark_missing: `0a 05 0a 03 18 91 4e` is a Change whose *target* holds
  // only targetUin=10001 — no targetUid, no remark.  The reference does not throw:
  // it returns the empty strings, and `confirmFriendRemark` is what rejects the
  // mismatch.  A missing `result` (field 1 absent) is the case that throws.
  const body = decodeResponse(SetFriendRemark, "08aea202100022070a050a0318914e");
  const result = checkFriendRemarkResponse(body);
  assert.deepEqual(result, { targetUid: "", targetUin: 10001, remark: "" });
  assert.throws(
    () => confirmFriendRemark(result, { targetUid: "u_10001", targetUin: 10001, remark: "buddy" }),
    /target mismatch/,
  );
  // Now the genuinely missing-result shape.
  const empty = decodeOidbEnvelope(bytes("08aea20210002200"), SetFriendRemark.decodeBody).body;
  assert.throws(() => checkFriendRemarkResponse(empty!), /missing result/);
});

test("0x912e_0 confirmation rejects a remark the server did not actually apply", () => {
  const result = { targetUid: "u_10001", targetUin: 10001, remark: "buddy" };
  assert.throws(
    () => confirmFriendRemark(result, { targetUid: "u_10001", targetUin: 10001, remark: "other" }),
    /does not match/,
  );
  assert.throws(
    () => confirmFriendRemark(result, { targetUid: "u_99999", targetUin: 10001, remark: "buddy" }),
    /target mismatch/,
  );
  // A UIN the server omits is tolerated: QQ does not always echo it.
  assert.equal(confirmFriendRemark({ ...result, targetUin: 0 }, { targetUid: "u_10001", targetUin: 10001, remark: "buddy" }), undefined);
});

// ===========================================================================
// 0xfe1_2 — stranger status (one of three specs on this command)
// ===========================================================================

test("0xfe1_2 GetStrangerStatus requests exactly one property key", () => {
  const { wireName, bytes: encoded } = encodeRequest(GetStrangerStatus, { uin: 10001 });
  assert.equal(wireName, "OidbSvcTrpcTcp.0xfe1_2");
  assert.equal(hex(encoded), "08e11f1002220908914e1a0408ecd5016001");
  assert.equal(STATUS_PROPERTY_KEY, 27372);
});

test("0xfe1_2 a status word above 10 unpacks to status 10 plus an ext status", () => {
  const body = decodeResponse(GetStrangerStatus, "08e11f100222120a1008914e12080a0608ecd501100b18914e");
  assert.deepEqual(GetStrangerStatus.deserialize(body), { status: 10, ext_status: 0 });
});

test("0xfe1_2 the ext_status formula masks one byte and adds a shifted one", () => {
  // Golden stranger_packed: raw = 0x10203.  The reference computes
  // (raw & 0xff00) + (raw >> 16 & 0xff) = 0x200 + 1 = 513 — not raw >> 8 (= 258).
  const body = decodeResponse(GetStrangerStatus, "08e11f1002220e0a0c120a0a0808ecd50110838404");
  assert.deepEqual(GetStrangerStatus.deserialize(body), { status: 10, ext_status: 513 });
  assert.deepEqual(unpackStatusWord(0x10203n), { status: 10, ext_status: 513 });
  assert.deepEqual(unpackStatusWord(0n), { status: 0, ext_status: 0 });
  assert.deepEqual(unpackStatusWord(10n), { status: 100, ext_status: 0 });
});

test("0xfe1_2 an absent status property yields null, not zeros", () => {
  // Golden stranger_missing: the only entry has key 999.  Reporting {status:0} would
  // claim "offline" for an account the server said nothing about.
  const body = decodeResponse(GetStrangerStatus, "08e11f1002220b0a0912070a0508e7071007");
  assert.equal(GetStrangerStatus.deserialize(body), null);
});

// ===========================================================================
// 0xfe1_2 — user profile (two specs, different field-1 types)
// ===========================================================================

test("0xfe1_2 FetchUserProfile sends the deduplicated key list, in the reference order", () => {
  const { wireName, bytes: encoded } = encodeRequest(FetchUserProfile, { uin: 10001 });
  assert.equal(wireName, "OidbSvcTrpcTcp.0xfe1_2");
  assert.equal(
    hex(encoded),
    "08e11f100222890108914e1a0408a29c011a040882d6011a0408a99c011a0408bf9c011a0208651a0208671a0208661a0408b49c011a0408a39c011a0408ba9c011a0208691a0408ecd5011a04088ed6011a0408c59c011a04089cc6021a04089dc6021a040881ca021a0408dabb021a0408afc8021a02086b1a0408a49c011a0408ab9c011a0408b09c011a0408b59c016001",
  );
});

test("0xfe1_2 the key list is deduplicated: duplicates do not become extra fields", () => {
  // Nine codes appear twice in the reference's literal (once explicitly, once via
  // `...PUBLIC_PROFILE_KEYS`).  Sending them twice would add nine fields.
  const body = bytes("08914e1a0408a29c011a040882d6011a0408a99c011a0408bf9c011a0208651a0208671a0208661a0408b49c011a0408a39c011a0408ba9c011a0208691a0408ecd5011a04088ed6011a0408c59c011a04089cc6021a04089dc6021a040881ca021a0408dabb021a0408afc8021a02086b1a0408a49c011a0408ab9c011a0408b09c011a0408b59c01");
  // Uint8Array.toString ignores a radix argument, so go through Buffer for hex.
  const keys = [...Buffer.from(body).toString("hex").matchAll(/1a0208([0-9a-f]{2})/g)].map((m) =>
    parseInt(m[1]!, 16),
  );
  assert.equal(new Set(keys).size, keys.length, "keys must not repeat");
  assert.ok(PUBLIC_PROFILE_KEYS.includes(102));
});

test("0xfe1_2 FetchUserProfileByUid puts a string in field 1 under the same command", () => {
  // Field 1 is a uint32 uin in one spec and a string uid in the other, under the
  // same wire name.  Only the body distinguishes them.
  const { wireName, bytes: encoded } = encodeRequest(FetchUserProfileByUid, { uid: "u_AbCdEfGh" });
  assert.equal(wireName, "OidbSvcTrpcTcp.0xfe1_2");
  assert.equal(
    hex(encoded),
    "08e11f10022292010a0a755f41624364456647681a0408a29c011a040882d6011a0408a99c011a0408bf9c011a0208651a0208671a0208661a0408b49c011a0408a39c011a0408ba9c011a0208691a0408ecd5011a04088ed6011a0408c59c011a04089cc6021a04089dc6021a040881ca021a0408dabb021a0408afc8021a02086b1a0408a49c011a0408ab9c011a0408b09c011a0408b59c01",
  );
  // No `60 01` tail: this spec does not set uinForm.
  assert.ok(!hex(encoded).endsWith("6001"));
});

test("0xfe1_2 a full profile decodes nickname, status, membership and birthday", () => {
  const body = decodeResponse(FetchUserProfile, "08e11f100222c1010abe010a0d755f70726f66696c655f75696412a9010a0608a99c0110010a0608c59c0110190a04086910300a0a08ba9c011080dea0cb050a0608ecd50110150a07089cc6021081020a06089dc602100c120a08a29c0112044e69636b120a0867120652656d61726b120d086612097369676e6174757265120608a99c011200120a08bf9c01120407e6060f1212088ed601120c080512087374756479696e67121d086512192a1768747470733a2f2f6176617461722e6578616d706c652f18914e");
  const profile = FetchUserProfile.deserialize(body);
  assert.equal(profile.uid, "u_profile_uid");
  assert.equal(profile.nickname, "Nick");
  assert.equal(profile.remark, "Remark");
  assert.equal(profile.sign, "signature");
  assert.equal(profile.sex, "male");
  assert.equal(profile.age, 25);
  assert.equal(profile.level, 48);
  assert.equal(profile.status, 10);
  assert.equal(profile.extStatus, 0);
  assert.deepEqual(profile.customStatus, { faceId: 5, wording: "studying" });
  assert.equal(profile.regTime, 1500000000);
  assert.equal(profile.vipFlag, true);
  assert.equal(profile.svipFlag, true);
  assert.equal(profile.yearVipFlag, false);
  assert.equal(profile.birthdayYear, 2022);
  assert.equal(profile.birthdayMonth, 6);
  assert.equal(profile.birthdayDay, 15);
  // The avatar url lives at AvatarInfo field **5** and gets a "640" suffix.
  assert.equal(profile.avatar, "https://avatar.example/640");
});

test("0xfe1_2 a response with no body at all throws", () => {
  const body = decodeResponse(FetchUserProfile, "08e11f10022200");
  assert.throws(() => FetchUserProfile.deserialize(body), /body missing/);
});

test("0xfe1_2 the by-uin spec can cross-check the returned uin", () => {
  // Golden profile_baduinn: request was for 10001 but the body says 99999.
  const body = decodeResponse(FetchUserProfile, "08e11f1002220b0a090a03755f78189f8d06");
  assert.equal(FetchUserProfile.deserialize(body).uin, 99999);
  assert.throws(
    () => withRequestedUin(FetchUserProfile, 10001).deserialize(body),
    /does not match the requested account/,
  );
});

test("0xfe1_2 membership flags derive from packed bits, with the level fallback", () => {
  const noFlags = new Map<number, number>();
  assert.deepEqual(decodeMembership(noFlags), {});
  assert.deepEqual(decodeMembership(new Map([[41756, 0x101]])), {
    vipFlag: true,
    yearVipFlag: false,
    svipFlag: true,
  });
  // `vipLevel = 33 - Math.clz32(mask)` where mask = value & 4095.  The results are
  // one higher than the bit index because of the 33: clz32(1) = 31 -> 2, clz32(12)
  // = 28 -> 5.  These values were read off the reference's own decodeMembership:
  //   mask 1 -> 2, 2 -> 3, 3 -> 3, 4 -> 4, 8 -> 5, 12 -> 5, 4095 -> 13
  const levels: ReadonlyArray<readonly [number, number]> = [
    [1, 2],
    [2, 3],
    [3, 3],
    [4, 4],
    [8, 5],
    [0x0c, 5],
    [4095, 13],
  ];
  for (const [mask, level] of levels) {
    assert.equal(decodeMembership(new Map([[41757, mask]])).vipLevel, level, `mask ${mask}`);
  }
  // A zero mask alone yields no level at all (not zero).
  assert.deepEqual(decodeMembership(new Map([[41757, 0]])), {});
  // A zero mask with a vip flag yields level 1.
  assert.equal(decodeMembership(new Map([[41756, 1], [41757, 0]])).vipLevel, 1);
  // A zero mask with 42241 === 1 also yields 1 — that is the second arm.
  assert.equal(decodeMembership(new Map([[41756, 0], [41757, 0], [42241, 1]])).vipLevel, 1);
  // 42241 present but *not* 1 falls through to the third arm: level 0, not 1.
  // Verified against the reference: 42241 = 0 and 42241 = 2 both give 0.
  assert.equal(decodeMembership(new Map([[41756, 0], [41757, 0], [42241, 2]])).vipLevel, 0);
  // With no 42241 at all the third arm is unreachable and no level is produced.
  assert.deepEqual(decodeMembership(new Map([[41756, 0], [41757, 0]])), {
    vipFlag: false,
    yearVipFlag: false,
    svipFlag: false,
  });
});

test("0xfe1_2 birthday with a hidden year keeps month and day; 0/0 means unset", () => {
  // Year 0 is "not disclosed": the year key is absent, month/day remain.
  assert.deepEqual(decodeBirthday(Uint8Array.from([0, 0, 6, 15])), { birthdayMonth: 6, birthdayDay: 15 });
  // Month 0 and day 0 mean the whole birthday is unset.
  assert.deepEqual(decodeBirthday(Uint8Array.from([0x07, 0xe6, 0, 0])), {});
  assert.throws(() => decodeBirthday(Uint8Array.from([1, 2, 3])), /invalid birthday length/);
  assert.throws(() => decodeBirthday(Uint8Array.from([0x07, 0xe6, 2, 30])), /invalid date/);
});

// ===========================================================================
// 0xfd4_1 — friend roster page
// ===========================================================================

test("0xfd4_1 FetchFriendListPage request has no field 1 and no field 3", () => {
  // `friendCount` starts at field 2; `10 ac 02` is that field.  `field4: 0` is
  // *dropped* by the ordinary != 0 guard — it is not written as `20 00`.
  const { wireName, bytes: encoded } = encodeRequest(FetchFriendListPage, {});
  assert.equal(wireName, "OidbSvcTrpcTcp.0xfd4_1");
  assert.equal(
    hex(encoded),
    "08d41f1001227f10ac02300138ffffffff078af10444080112400867086608a29c010882d6010869086b08a39c0108a49c0108b49c0108a99c0108ab9c0108b09c0108b59c0108bf9c0108c59c01089cc602089dc6020881ca028af1040a0804120608640865086690f1048a6a90f1048b6a90f104856a90f104846a90f104806a98f104d31f",
  );
  assert.ok(!hex(encoded).includes("2000"), "field4 must be dropped, not sent as 0");
});

test("0xfd4_1 a page cookie goes into field 5 as bytes", () => {
  const { bytes: encoded } = encodeRequest(FetchFriendListPage, { cookie: Uint8Array.from([0x0a, 0x0b, 0x0c]) });
  assert.equal(
    hex(encoded),
    "08d41f100122840110ac022a030a0b0c300138ffffffff078af10444080112400867086608a29c010882d6010869086b08a39c0108a49c0108b49c0108a99c0108ab9c0108b09c0108b59c0108bf9c0108c59c01089cc602089dc6020881ca028af1040a0804120608640865086690f1048a6a90f1048b6a90f104856a90f104846a90f104806a98f104d31f",
  );
});

test("0xfd4_1 a full page decodes friends and categories", () => {
  const body = decodeResponse(FetchFriendListPage, "08d41f100122b201120301020318013080a0f8fa0538914e4007aa063e0a04755f6631100518a19c018af1042e0801122a0a0708a29c01108906121008a29c01120a467269656e64204f6e65120d0867120946312072656d61726baa063b0a04755f6632100018a29c018af1041608011212121008a29c01120a467269656e642054776f8af104110804120d120b08a29c01120557524f4e47b2060f0800120744656661756c7418022000b2060c08051204576f726b18012001");
  const page = FetchFriendListPage.deserialize(body);
  assert.equal(page.entries.length, 2);
  assert.equal(page.entries[0]!.friend.nickname, "Friend One");
  assert.equal(page.entries[0]!.friend.remark, "F1 remark");
  assert.equal(page.entries[0]!.friend.uin, 20001);
  assert.equal(page.entries[0]!.categoryId, 5);
  // The second friend's `additional` has a type-4 block whose nickname must be
  // ignored: only type 1 carries display properties.
  assert.equal(page.entries[1]!.friend.nickname, "Friend Two");
  assert.deepEqual(page.cookie, Uint8Array.from([1, 2, 3]));
  assert.deepEqual(page.categories, [
    { categoryId: 0, categoryName: "Default", memberCount: 2, sortId: 0 },
    { categoryId: 5, categoryName: "Work", memberCount: 1, sortId: 1 },
  ]);
});

test("0xfd4_1 a friend with no nickname property falls back to the uin string", () => {
  // The reference uses `String(uin)`, not "": a OneBot friend needs a non-empty name.
  const raw = mapFriend({ uid: "u_x", customGroup: 0, uin: 20003, additional: [] });
  assert.equal(raw.friend.nickname, "20003");
  assert.equal(raw.friend.profile, undefined);
});

test("0xfd4_1 an empty page decodes to empty lists and no cookie", () => {
  const page = FetchFriendListPage.deserialize(decodeResponse(FetchFriendListPage, "08d41f100122021801"));
  assert.deepEqual(page.entries, []);
  assert.deepEqual(page.categories, []);
  assert.equal(page.cookie, undefined);
});

// ===========================================================================
// 0xfe7_3 — group member roster page
// ===========================================================================

test("0xfe7_3 FetchGroupMemberListPage uses sub-command 3, not 4", () => {
  const { wireName, bytes: encoded } = encodeRequest(FetchGroupMemberListPage, { groupId: 111222333 });
  assert.equal(wireName, "OidbSvcTrpcTcp.0xfe7_3");
  assert.equal(
    hex(encoded),
    "08e71f1003224008bdbc84351005180222355001580160016801800101880101900101a00101a80101a00601a80601b00601b80601c00601c80601d00601d80601c00c01c80c01",
  );
});

test("0xfe7_3 the body starts at field 10 and jumps to 100 and 200", () => {
  // Nineteen `=== true` bools, each one tag+1 byte.  `50 01` is field 10, `a0 06 01`
  // is field 100.  A 1-based renumbering would still be 38 bytes but the wrong fields.
  const { bytes: encoded } = encodeRequest(FetchGroupMemberListPage, { groupId: 1 });
  assert.ok(hex(encoded).includes("22355001"), hex(encoded));
  assert.ok(hex(encoded).includes("c00c01c80c01"), hex(encoded));
});

test("0xfe7_3 a page token goes into field 15 as a string", () => {
  const { bytes: encoded } = encodeRequest(FetchGroupMemberListPage, { groupId: 111222333, token: "tok123" });
  assert.equal(
    hex(encoded),
    "08e71f1003224808bdbc84351005180222355001580160016801800101880101900101a00101a80101a00601a80601b00601b80601c00601c80601d00601d80601c00c01c80c017a06746f6b313233",
  );
});

test("0xfe7_3 a roster page decodes members, roles and the packed level", () => {
  const body = decodeResponse(FetchGroupMemberListPage, "08e71f100322860108bdbc843512390a0a1204755f6d3120b1ea015205416c6963655a051203616c69620210098a0104626f7373a00680a0f8fa05a806f4a3f8fa05b00600d80601122a0a0a1204755f6d3220b2ea015203426f6262070a030102031004a00681a0f8fa05a80600b00600d80602120720b3ea01d806001802280b300c7a096e6578742d70616765");
  const page = FetchGroupMemberListPage.deserialize(body);
  assert.equal(page.members.length, 3);
  assert.deepEqual(page.members[0], {
    uin: 30001,
    uid: "u_m1",
    nickname: "Alice",
    card: "ali",
    isRobot: false,
    role: "owner",
    level: 9,
    title: "boss",
    joinTime: 1600000000,
    lastSentTime: 1600000500,
    shutUpTime: 0,
  });
  // The second member's level infos arrive *packed*; level 4 is field 2.
  assert.equal(page.members[1]!.level, 4);
  assert.equal(page.members[1]!.role, "admin");
  // The third member has no `uin` wrapper at all — every field falls back to zero.
  assert.equal(page.members[2]!.uin, 0);
  assert.equal(page.members[2]!.role, "member");
  assert.equal(page.token, "next-page");
});

test("0xfe7_3 permission 1/2 map to owner/admin, everything else to member", () => {
  assert.equal(permissionToRole(1), "owner");
  assert.equal(permissionToRole(2), "admin");
  assert.equal(permissionToRole(0), "member");
  assert.equal(permissionToRole(3), "member");
  assert.equal(permissionToRole(107), "member");
});

test("0xfe7_3 isRobot is a constant false, never a decoded field", () => {
  const page = FetchGroupMemberListPage.deserialize(decodeResponse(FetchGroupMemberListPage, "08e71f100322020801"));
  assert.deepEqual(page.members, []);
  assert.equal(page.token, ""); // defaults to "", not undefined
});

// ===========================================================================
// 0x126e_200 — NTV2 group PTT download url
// ===========================================================================

test("0x126e_200 GetGroupPttUrl request matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(GetGroupPttUrl, {
    groupId: 111222333,
    node: {
      fileUuid: "uuid-1",
      storeId: 7,
      uploadTime: 1600000000,
      ttl: 3600,
      subType: 1,
      info: {
        fileSize: 4096,
        fileHash: "hash",
        fileSha1: "sha1",
        fileName: "a.amr",
        type: { type: 1, picFormat: 0, videoFormat: 0, voiceFormat: 1 },
      },
    },
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x126e_200");
  assert.equal(
    hex(encoded),
    "08ee2410c801225b0a1e0a05080410c8011211a80601b00603c00c02d20c0508bdbc84351a0208021a390a330a1c0880201204686173681a04736861312205612e616d722a04080120011206757569642d3118072080a0f8fa0528901c3001120212006001",
  );
});

test("0x126e_200 the scene numbers the group at 202, not 4", () => {
  // `d20c05 08bdbc8435` = field 202 (tag 0x0cd2), message, groupUin 111222333.
  const { bytes: encoded } = encodeRequest(GetGroupPttUrl, { groupId: 111222333, node: { fileUuid: "u" } });
  assert.ok(hex(encoded).includes("d20c0508bdbc8435"), hex(encoded));
});

test("0x126e_200 the download extension is a zero-length video message", () => {
  // `busiType: 0` / `sceneType: 0` are dropped by the != 0 guard, but `video` itself
  // uses `!= null`, so `12 00` is on the wire: present, empty.
  const { bytes: encoded } = encodeRequest(GetGroupPttUrl, { groupId: 1, node: { fileUuid: "u" } });
  assert.ok(hex(encoded).includes("12021200"), hex(encoded));
});

test("0x126e_200 normalizeMediaNode requires a fileUuid", () => {
  assert.throws(() => normalizeMediaNode({}), /fileUuid is required/);
  assert.throws(() => normalizeMediaNode({ fileUuid: 5 }), /fileUuid is required/);
  // Numeric strings and bigints are coerced; NaN yields 0.
  const node = normalizeMediaNode({
    fileUuid: "f",
    info: { fileSize: "4096", width: 10n, height: Number.NaN },
  });
  assert.equal(node.info!.fileSize, 4096);
  assert.equal(node.info!.width, 10);
  assert.equal(node.info!.height, 0);
});

test("0x126e_200 parseNtv2DownloadUrl assembles https + domain + path + rkey", () => {
  const body = decodeResponse(GetGroupPttUrl, "08ee2410c80122530a06120210001a001a490a0c26726b65793d4142435f2d3110901c1a300a176d756c74696d656469612e7166696c652e71712e636f6d12122f646f776e6c6f61643f66696c6569643d3118bb032080a0f8fa05");
  assert.equal(GetGroupPttUrl.deserialize(body), "https://multimedia.qfile.qq.com/download?fileid=1&rkey=ABC_-1");
  // httpsPort (443) is deliberately not in the URL — adding it breaks the signature.
  assert.ok(!GetGroupPttUrl.deserialize(body)!.includes(":443"));
});

test("0x126e_200 a nonzero retCode inside the body is a failure even with errorCode 0", () => {
  const body = decodeResponse(GetGroupPttUrl, "08ee2410c80122210a0b10071a07657870697265641a120a0726726b65793d581a070a016812022f70");
  assert.throws(() => parseNtv2DownloadUrl(body), /ntv2 download failed: code=7 msg=expired/);
});

test("0x126e_200 a response without a domain is invalid, not an empty url", () => {
  const body = decodeResponse(GetGroupPttUrl, "08ee2410c80122111a0f0a0726726b65793d581a0412022f70");
  assert.throws(() => parseNtv2DownloadUrl(body), /response invalid/);
});

// ===========================================================================
// 0x12a9_200 — flash transfer download url
// ===========================================================================

test("0x12a9_200 GetFlashDownload request matches the reference byte for byte", () => {
  resetFlashSequence(300);
  const { wireName, bytes: encoded } = encodeRequest(GetFlashDownload, {
    filesetUuid: "fs-uuid",
    fileUuid: "f-uuid",
    fileName: "doc.pdf",
    fileId: "file-id-1",
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x12a9_200");
  assert.equal(
    hex(encoded),
    "08a92510c80122790a1a0a0608ac0210c801120ca80602b00604b80616c00c051a0208011a5b0a200a132207646f632e7064662a080800100018002000120966696c652d69642d311237121608feffffff0f18ffffffff0f286f320608ece182d70c2200521b0a0766732d757569641206662d75756964181a2206662d757569646001",
  );
  assert.equal(peekFlashSequence(), 301);
});

test("0x12a9_200 the sequence counter starts at 300 and increments per call", () => {
  // `seqCounter$2` is module state in the reference too, so two identical calls do
  // NOT produce identical bytes.  The counter is the only variable part.
  resetFlashSequence();
  assert.equal(peekFlashSequence(), 300);
  const first = encodeRequest(GetFlashDownload, { filesetUuid: "a", fileUuid: "b", fileName: "c", fileId: "d" });
  const second = encodeRequest(GetFlashDownload, { filesetUuid: "a", fileUuid: "b", fileName: "c", fileId: "d" });
  assert.notEqual(hex(first.bytes), hex(second.bytes));
  assert.equal(peekFlashSequence(), 302);
});

test("0x12a9_200 the uint32 sentinels stay five-byte unsigned varints", () => {
  // `fe ff ff ff 0f` is uint32 4294967294.  Encoding through int32 would give the
  // ten-byte sign-extended form `fe ff ff ff ff ff ff ff ff 01`.
  resetFlashSequence(300);
  const { bytes: encoded } = encodeRequest(GetFlashDownload, { filesetUuid: "a", fileUuid: "b", fileName: "c", fileId: "d" });
  assert.ok(hex(encoded).includes("08feffffff0f18ffffffff0f"), hex(encoded));
});

test("0x12a9_200 the file-info-5 submessage writes all four zeros", () => {
  // The only place in this family with a bare `!= null` guard on every field, so the
  // zeros cost four bytes: `2a 08 08 00 10 00 18 00 20 00`.
  resetFlashSequence(300);
  const { bytes: encoded } = encodeRequest(GetFlashDownload, { filesetUuid: "a", fileUuid: "b", fileName: "c", fileId: "d" });
  assert.ok(hex(encoded).includes("2a080800100018002000"), hex(encoded));
});

test("0x12a9_200 the body blob is scanned as latin1 and yields a url", () => {
  const body = decodeResponse(GetFlashDownload, "08a92510c801225a0a0410001a001a522e2e2e68747470733a2f2f6d756c74696d656469612e7166696c652e71712e636f6d2f646f776e6c6f61643f61707069643d31343930312666696c6569643d393926726b65793d5a5a5f746f702d312e2e2e");
  // The rkey match is appended as `&${match[0]}`, where match[0] already starts
  // with `rkey=` — so the duplicate-looking tail is correct, not a bug.
  assert.equal(
    GetFlashDownload.deserialize(body),
    "https://multimedia.qfile.qq.com/download?appid=14901&fileid=99&rkey=ZZ_top-1...&rkey=ZZ_top-1",
  );
});

test("0x12a9_200 a blob without an rkey yields the bare url", () => {
  const body = decodeResponse(GetFlashDownload, "08a92510c801223f1a3d68747470733a2f2f6d756c74696d656469612e7166696c652e71712e636f6d2f646f776e6c6f61643f61707069643d31343930312666696c6569643d31");
  assert.equal(GetFlashDownload.deserialize(body), "https://multimedia.qfile.qq.com/download?appid=14901&fileid=1");
});

test("0x12a9_200 a blob without the host returns null, not a partial url", () => {
  assert.equal(
    GetFlashDownload.deserialize(decodeResponse(GetFlashDownload, "08a92510c801221e1a1c2f646f776e6c6f61643f61707069643d313439303126726b65793d41")),
    null,
  );
  assert.equal(GetFlashDownload.deserialize(decodeResponse(GetFlashDownload, "08a92510c8012200")), null);
  assert.equal(parseFlashDownloadUrl({}), null);
});

// ===========================================================================
// Empty-response commands — deserialize must not invent a result
// ===========================================================================

test("empty-response commands deserialize to undefined or {}", () => {
  assert.equal(SetFriendCategory.deserialize(decodeResponse(SetFriendCategory, "08d524100022070a03755f781003")), undefined);
  assert.equal(DeleteFriend.deserialize(decodeResponse(DeleteFriend, "08eb2410002200")), undefined);
  assert.equal(MuteMember.deserialize(decodeResponse(MuteMember, "08d32410012200")), undefined);
  assert.equal(ClearFriendRemark.deserialize(decodeResponse(ClearFriendRemark, "08afa20210002200")), undefined);
  assert.equal(SetAddRequest.deserialize(decodeResponse(SetAddRequest, "08c82110012200")), undefined);
});

test("the empty responses decode their envelope without throwing", () => {
  for (const [spec, golden] of [
    [DeleteFriend, "08eb2410002200"],
    [MuteMember, "08d32410012200"],
    [ClearFriendRemark, "08afa20210002200"],
  ] as const) {
    const envelope = decodeOidbEnvelope(bytes(golden), spec.decodeBody);
    assert.equal(envelope.command, spec.command);
    // An absent field and an explicit 0 are different wire states: these goldens
    // carry no errorCode at all, so it decodes to null (the reference's decoders
    // agree — see 0xfe5-2.ts / 0x10c0.ts for the same convention).
    assert.equal(envelope.errorCode, null);
    assert.deepEqual(envelope.body, {});
  }
});