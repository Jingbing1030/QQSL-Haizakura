// OIDB service codec tests.
//
// Same principle as the envelope tests: these assert against golden bytes taken
// from the reference's own generated encoders, not against self-consistent
// round-trips.  Every expected hex string below was produced by evaluating the
// named `protobuf_encode_*` function out of reference/index.mjs
// (see work/oidb/probe/golden.mjs) and is quoted verbatim.
//
// Where a test checks a *projection* (toGroupSummary, mergeRequestList), the
// oracle is the reference's own mapping function, cited in the service file.
import { test } from "node:test";
import assert from "node:assert/strict";

import { makeOidbEnvelope, encodeOidbEnvelope, decodeOidbEnvelope, oidbWireName } from "../src/oidb/envelope.js";
import { ProtoReader, ProtoWriter } from "../src/oidb/wire.js";
import {
  GetPskey,
  ForceFetchClientKey,
  GetGroupRecommendArk,
  GetBuddyRecommendArk,
  SetGroupWholeBan,
  SetGroupAddOption,
  SetGroupSearch,
  SetGroupMemberInvitePolicy,
  SetGroupNewMemberHistoryVisibility,
  SetGroupMemberPermissions,
  SetGroupName,
  UploadGroupFile,
  GetGroupFileUrl,
  DeleteGroupFile,
  RenameGroupFile,
  MoveGroupFile,
  FetchGroupList,
  FetchGroupDetail,
  FetchGroupRequests,
  GROUP_REQUESTS_SUB_COMMAND,
  MEMBER_INVITE_PRIVILEGE_MASK,
  POLICY_PRIVILEGE_BITS,
  GROUP_MEMBER_PERMISSION_MASKS,
  decodeMemberInvitePolicy,
  mergeMemberInvitePrivilegeFlag,
  mergeGroupMemberPermission,
  decodeGroupMemberPermissions,
  wireAddType,
  isQuestionAddType,
  muteAllState,
  toGroupSummary,
  isGroupAllMuted,
  formatGroupRequestFlag,
  parseGroupRequestFlag,
  normalizeGroupRequestSequence,
  mergeRequestList,
  groupRequestOperationType,
  GROUP_REQUEST_OPERATION_TYPE,
  decodeGroupRequestsByUin,
  decodeGroupRequestsByUid,
  GroupFileRetError,
  ensureRetCodeZero,
  buddyRecommendArkJumpUrl,
} from "../src/oidb/services/index.js";

const hex = (input: Uint8Array): string => Buffer.from(input).toString("hex");
const bytes = (source: string): Uint8Array => Uint8Array.from(Buffer.from(source, "hex"));

/** Encode a spec's request the way invokeOidb would, without a transport. */
function encodeRequest(
  spec: {
    command: number;
    subCommand?: number;
    resolveSubCommand?: (params: any) => number;
    uinForm?: boolean;
    serialize: (params: any) => any;
    encodeBody: (body: any) => Uint8Array;
  },
  params: any,
): { wireName: string; bytes: Uint8Array } {
  const body = spec.encodeBody(spec.serialize(params));
  const subCommand = spec.resolveSubCommand ? spec.resolveSubCommand(params) : (spec.subCommand ?? 0);
  return {
    wireName: oidbWireName(spec.command, subCommand),
    bytes: encodeOidbEnvelope(makeOidbEnvelope(spec.command, subCommand, body, spec.uinForm === true)),
  };
}

/**
 * Decode a response BODY through a spec, the way invokeOidb would.
 *
 * The bytes are wrapped in envelope field 4 first: passing a bare body to
 * `decodeOidbEnvelope` reads its field numbers as envelope fields, which is a
 * mistake that silently yields `null` rather than an error.
 */
function decodeResponse(spec: { decodeBody: (d: Uint8Array, o?: number, e?: number) => any }, bodyHex: string) {
  return decodeResponseBytes(spec, bytes(bodyHex));
}

function decodeResponseBytes(
  spec: { decodeBody: (d: Uint8Array, o?: number, e?: number) => any },
  body: Uint8Array,
) {
  const envelope = new ProtoWriter().bytes(4, body).finish();
  return decodeOidbEnvelope(envelope, spec.decodeBody).body;
}

// ===========================================================================
// 0x102a_0 / 0x102a_1 — pskey and clientkey
// ===========================================================================

test("0x102a_0 GetPskey request matches the reference byte for byte", () => {
  // Golden: protobuf_encode_OidbBase__OidbGetPskeyReq, domains qun.qq.com +
  // docs.qq.com. Field 1 is `repeated string`, so each domain is its own entry.
  const { wireName, bytes: encoded } = encodeRequest(GetPskey, { domainList: ["qun.qq.com", "docs.qq.com"] });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x102a_0");
  assert.equal(hex(encoded), "08aa2022190a0a71756e2e71712e636f6d0a0b646f63732e71712e636f6d");
});

test("0x102a_0 an empty domain list emits no field at all", () => {
  // Golden: pskey_empty. Note `22 00` — the body is present but zero-length.
  const { bytes: encoded } = encodeRequest(GetPskey, { domainList: [] });
  assert.equal(hex(encoded), "08aa202200");
});

test("0x102a_1 ForceFetchClientKey request matches the reference byte for byte", () => {
  // Golden: protobuf_encode_OidbBase__OidbClientKeyReq. Its body message exists
  // but declares no fields (`__size_OidbClientKeyReq` returns 0), hence `2200`.
  const { wireName, bytes: encoded } = encodeRequest(ForceFetchClientKey, {});
  assert.equal(wireName, "OidbSvcTrpcTcp.0x102a_1");
  assert.equal(hex(encoded), "08aa2010012200");
});

test("GetPskey maps domains to keys and drops empty pairs", () => {
  // Two items: one with a key, one the server declined to mint.
  // Two pskeyItems: qun.qq.com -> "abc" (expire 60), docs.qq.com with no pskey.
  const body = "0a130a0a71756e2e71712e636f6d1203616263183c0a0d0a0b646f63732e71712e636f6d";
  const decoded = decodeResponse(GetPskey, body);
  assert.equal(decoded.pskeyItems.length, 2);
  const result = GetPskey.deserialize(decoded);
  assert.equal(result.domainPskeyMap.get("qun.qq.com"), "abc");
  assert.equal(result.domainPskeyMap.has("docs.qq.com"), false, "an empty pskey must not enter the map");
});

test("ClientKey response uses fields 2/3/4, not 1/2/3", () => {
  // field 2 keyIndex=19, field 3 clientKey="k", field 4 expireTime=1800
  // keyIndex 19 = 0x13, clientKey "k", expireTime 1800 = varint 88 0e
  const decoded = decodeResponse(ForceFetchClientKey, "1013" + "1a016b" + "20880e");
  assert.deepEqual(decoded, { keyIndex: 19, clientKey: "k", expireTime: 1800 });
  assert.equal((decoded as { keyIndex: number }).keyIndex, 19, "field 2, not field 1");
  assert.deepEqual(ForceFetchClientKey.deserialize(decoded), {
    clientKey: "k",
    keyIndex: "19",
    expireTime: "1800",
  });
});

test("ClientKey uses the reference's defaults for absent fields", () => {
  const empty = new ProtoWriter().message(4, new Uint8Array(0)).finish();
  const decoded = decodeOidbEnvelope(empty, ForceFetchClientKey.decodeBody).body;
  assert.ok(decoded !== null);
  assert.deepEqual(ForceFetchClientKey.deserialize(decoded), {
    clientKey: "",
    keyIndex: "19",
    expireTime: "1800",
  });
});

test("reading the clientkey reply with the pskey schema yields nothing useful", () => {
  // Guards the field-number confusion directly: pskey's item is field 1 and its
  // expireTime is field 3, so a shared "field 3 is expireTime" assumption breaks
  // exactly one of the two.
  const clientKeyReply = "1013" + "1a016b" + "20880e";
  const asPskey = decodeResponse(GetPskey, clientKeyReply);
  assert.equal(asPskey.pskeyItems.length, 0, "field 1 is absent in the clientkey reply");
});

// ===========================================================================
// 0x8b7_5 / 0x12b6_0 — share cards
// ===========================================================================

test("0x8b7_5 group ark request matches the reference byte for byte", () => {
  // Golden: protobuf_encode_OidbBase__OidbGroupRecommendArkReq, groupId=111222333.
  // `6001` is reserved=1 (uinForm).
  const { wireName, bytes: encoded } = encodeRequest(GetGroupRecommendArk, { groupId: 111222333 });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x8b7_5");
  assert.equal(hex(encoded), "08b71110052209080110bdbc843528016001");
});

test("0x12b6_0 friend ark request matches the reference byte for byte", () => {
  // Golden: protobuf_encode_OidbBase__OidbBuddyRecommendArkReq, uin=10001.
  // No trailing 6001: this spec is uinForm=false.
  const { wireName, bytes: encoded } = encodeRequest(GetBuddyRecommendArk, { userId: 10001 });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x12b6_0");
  assert.equal(
    hex(encoded),
    "08b625225908914e12012d1a516d71716170693a2f2f636172642f73686f775f70736c636172643f7372635f747970653d696e7465726e616c26736f757263653d7368617265636172642676657273696f6e3d312675696e3d3130303031",
  );
});

test("the uinForm bit is the only structural difference between the two arks", () => {
  const group = encodeRequest(GetGroupRecommendArk, { groupId: 111222333 }).bytes;
  assert.equal(group[group.length - 2], 0x60, "0x8b7_5 must end with field 12 = 1");
  const buddy = encodeRequest(GetBuddyRecommendArk, { userId: 10001 }).bytes;
  assert.notEqual(buddy[buddy.length - 2], 0x60, "0x12b6_0 must not carry field 12");
});

test("the two ark responses read their card from different fields", () => {
  // 0x8b7_5: field 5 is the card (`2a`), field 1 (`08`) is an error code.
  assert.deepEqual(decodeResponse(GetGroupRecommendArk, "0800" + "2a0178"), { errCode: 0, arkJson: "x" });
  // 0x12b6_0: field 1 IS the card (`0a`).
  assert.deepEqual(decodeResponse(GetBuddyRecommendArk, "0a0179"), { ark: "y" });
});

test("the jump URL template interpolates the uin", () => {
  assert.equal(
    buddyRecommendArkJumpUrl(10001),
    "mqqapi://card/show_pslcard?src_type=internal&source=sharecard&version=1&uin=10001",
  );
  assert.match(buddyRecommendArkJumpUrl(42), /uin=42$/);
});

// ===========================================================================
// 0x89a_0 / 0x89a_15 — group settings
// ===========================================================================

test("0x89a_0 whole-ban ON matches the reference byte for byte", () => {
  // Golden: protobuf_encode_OidbBase__OidbMuteAll, state=0xffffffff.
  const on = encodeRequest(SetGroupWholeBan, { groupId: 987654321, enable: true });
  assert.equal(on.wireName, "OidbSvcTrpcTcp.0x89a_0");
  assert.equal(hex(on.bytes), "089a11220f08b1d1f9d60312078801ffffffff0f");
});

test("0x89a_0 whole-ban OFF still sends an explicit 0", () => {
  // Golden: muteall_off -> `88 01 00`. This is the presence rule that a default
  // writer would get wrong: `state` is `!= null`, so the zero IS on the wire.
  const off = encodeRequest(SetGroupWholeBan, { groupId: 987654321, enable: false });
  assert.equal(hex(off.bytes), "089a11220b08b1d1f9d6031203880100");
  assert.equal(muteAllState(true), 0xffffffff);
  assert.equal(muteAllState(false), 0);
});

test("0x89a_0 add-option with a question matches the reference byte for byte", () => {
  // Golden: `80 01 04` addType=4, `f2 01` field 30, `fa 01` field 31.
  const { bytes: encoded } = encodeRequest(SetGroupAddOption, {
    groupId: 987654321,
    addType: 4,
    groupQuestion: "q?",
    groupAnswer: "a!",
  });
  assert.equal(hex(encoded), "089a11221508b1d1f9d603120d800104f20102713ffa01026121");
});

test("0x89a_0 add-option without a question matches the reference byte for byte", () => {
  // Golden: addoption_plain -> only addType inside settings.
  const { bytes: encoded } = encodeRequest(SetGroupAddOption, { groupId: 987654321, addType: 2 });
  assert.equal(hex(encoded), "089a11220b08b1d1f9d6031203800102");
  assert.equal(isQuestionAddType(2), false);
  assert.equal(isQuestionAddType(4), true);
  assert.equal(isQuestionAddType(5), true);
  assert.equal(isQuestionAddType(55), true);
});

test("add-option normalises the 55 alias to 5 and clears a non-4 answer", () => {
  assert.equal(wireAddType(55), 5);
  assert.equal(wireAddType(4), 4);
  // Golden: addoption_55 -> `80 01 05` (alias mapped) plus `f2 01 00`/`fa 01 00`
  // (both question fields present but empty, because 5 IS a question mode).
  const { bytes: encoded } = encodeRequest(SetGroupAddOption, { groupId: 987654321, addType: 55 });
  assert.equal(hex(encoded), "089a11221108b1d1f9d6031209800105f20100fa0100");
  assert.equal(wireAddType(55), 5);
  // and 55 counts as a question mode, so its (empty) question pair is still sent
  assert.equal(isQuestionAddType(55), true);
});

test("0x89a_0 search matches the reference byte for byte, zeros included", () => {
  // Golden: `98 02 01` field 35 = 1, `a0 02 00` field 36 = 0. The trailing zero
  // is on the wire because these fields are `!= null`.
  const { bytes: encoded } = encodeRequest(SetGroupSearch, {
    groupId: 987654321,
    noFingerOpen: 1,
    noCodeFingerOpen: 0,
  });
  assert.equal(hex(encoded), "089a11220e08b1d1f9d6031206980201a00200");
});

test("search omits a setting that was never specified", () => {
  // Golden: search_finger_only. Absent means "leave alone"; 0 means "off".
  const { bytes: encoded } = encodeRequest(SetGroupSearch, { groupId: 987654321, noFingerOpen: 1 });
  assert.equal(hex(encoded), "089a11220b08b1d1f9d6031203980201");
  const bothUnset = encodeRequest(SetGroupSearch, { groupId: 987654321 });
  assert.equal(hex(bothUnset.bytes), "089a11220808b1d1f9d6031200", "an empty settings message is still sent");
});

test("0x89a_0 invite-policy matches the reference byte for byte", () => {
  // Golden: `b8 01` field 23, `c0 01` field 24 (255), `e8 01` field 29.
  const { bytes: encoded } = encodeRequest(SetGroupMemberInvitePolicy, {
    groupId: 987654321,
    policy: "require_approval",
    currentPrivilegeFlag: 16,
  });
  assert.equal(hex(encoded), "089a11221408b1d1f9d603120cb80110c0018080c030e80101");
});

test("the invite mask is the reference's 0x6100000, not a tidy low-bit mask", () => {
  assert.equal(MEMBER_INVITE_PRIVILEGE_MASK, 101711872);
  assert.equal(MEMBER_INVITE_PRIVILEGE_MASK.toString(16), "6100000");
  assert.deepEqual(
    { ...POLICY_PRIVILEGE_BITS },
    { disabled: 67108864, require_approval: 0, no_approval: 1048576, no_approval_under_100: 33554432 },
  );
});

test("invite-policy merge preserves bits outside the mask and round-trips", () => {
  const current = 0x00000010 | 0x4000000;
  const merged = mergeMemberInvitePrivilegeFlag(current, "no_approval_under_100");
  assert.equal(merged & 0x00000010, 0x00000010, "unrelated low bits must survive");
  assert.equal(merged & 0x2000000, 0x2000000);
  assert.equal(merged & 0x4000000, 0, "the previous policy bits must be cleared");
  assert.equal(decodeMemberInvitePolicy(merged), "no_approval_under_100");
  for (const policy of ["disabled", "require_approval", "no_approval", "no_approval_under_100"] as const) {
    assert.equal(decodeMemberInvitePolicy(mergeMemberInvitePrivilegeFlag(0, policy)), policy);
  }
  assert.equal(decodeMemberInvitePolicy(0), "require_approval", "zero is the default policy");
  assert.throws(() => mergeMemberInvitePrivilegeFlag(-1, "disabled"), /unsigned 32-bit/);
});

test("0x89a_0 history-visibility visible matches the reference byte for byte", () => {
  // Golden: `d0 02 04` field 42 = 4, `d8 02 04` field 43 = 4.
  const { bytes: encoded } = encodeRequest(SetGroupNewMemberHistoryVisibility, { groupId: 987654321, visible: true });
  assert.equal(hex(encoded), "089a11220e08b1d1f9d6031206d00204d80204");
});

test("history-visibility hidden clears the bit but keeps a zero value on the wire", () => {
  // Golden: historyvis_hidden -> `d0 02 00` + `d8 02 04`: value 0, mask 4.
  // The mask must stay 4 so the server knows the bit is ours to write.
  const hidden = encodeRequest(SetGroupNewMemberHistoryVisibility, { groupId: 987654321, visible: false });
  assert.equal(hex(hidden.bytes), "089a11220e08b1d1f9d6031206d00200d80204");
});

test("0x89a_0 member-permission matches the reference byte for byte", () => {
  // Golden: `b8 01 08` field 23 = 8, `c0 01 40` field 24 = 64.
  const { bytes: encoded } = encodeRequest(SetGroupMemberPermissions, {
    groupId: 987654321,
    permission: "upload_album",
    allow: true,
    currentPrivilegeFlag: 8,
  });
  assert.equal(hex(encoded), "089a11220e08b1d1f9d6031206b80108c00101");
});

test("member-permission bits are inverted: allowing clears the bit", () => {
  assert.deepEqual({ ...GROUP_MEMBER_PERMISSION_MASKS }, {
    upload_album: 1,
    temporary_session: 65536,
    create_group: 32768,
  });
  assert.equal(mergeGroupMemberPermission(1, "upload_album", true) & 1, 0, "allow clears");
  assert.equal(mergeGroupMemberPermission(0, "upload_album", false) & 1, 1, "deny sets");
  const allowed = mergeGroupMemberPermission(0, "create_group", true);
  assert.equal(decodeGroupMemberPermissions(allowed).create_group, true);
  const denied = mergeGroupMemberPermission(0, "create_group", false);
  assert.equal(decodeGroupMemberPermissions(denied).create_group, false);
  // Neighbours are untouched.
  const mixed = mergeGroupMemberPermission(0xffff, "temporary_session", true);
  assert.equal(decodeGroupMemberPermissions(mixed).temporary_session, true);
  assert.equal(decodeGroupMemberPermissions(mixed).upload_album, false);
});

test("0x89a_15 rename matches the reference byte for byte", () => {
  // Golden: sub-command 15 (`100f`), and field 1 is a uint32 here — unlike every
  // other 0x89a body, where groupUin is uint64.
  const { wireName, bytes: encoded } = encodeRequest(SetGroupName, { groupId: 987654321, name: "newname" });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x89a_15");
  assert.equal(hex(encoded), "089a11100f221108b1d1f9d60312091a076e65776e616d65");
});

test("every 0x89a action decodes an empty response without inventing fields", () => {
  for (const spec of [
    SetGroupWholeBan,
    SetGroupAddOption,
    SetGroupSearch,
    SetGroupMemberInvitePolicy,
    SetGroupNewMemberHistoryVisibility,
    SetGroupMemberPermissions,
    SetGroupName,
  ]) {
    const decoded = decodeResponse(spec, "12020801");
    assert.deepEqual(decoded, {});
    assert.equal(spec.deserialize(decoded), undefined);
  }
});

// ===========================================================================
// 0x6d6 — group files
// ===========================================================================

const uploadParams = {
  groupId: 123456789,
  fileName: "a.txt",
  fileSize: 1024n,
  fileSha1: bytes("010203"),
  fileMd5: bytes("0405"),
  folderId: "/",
};

test("0x6d6_0 upload request matches the reference byte for byte", () => {
  // Golden: fileSha3 is empty and therefore absent; `78 01` is field 15 = true.
  const { wireName, bytes: encoded } = encodeRequest(UploadGroupFile, uploadParams);
  assert.equal(wireName, "OidbSvcTrpcTcp.0x6d6_0");
  assert.equal(
    hex(encoded),
    "08d60d222d0a2b08959aef3a1004186620062a012f3205612e7478743a062f612e7478744080084a030102035a02040578016001",
  );
});

test("the upload body separates localDirectory from targetDirectory", () => {
  const inner = UploadGroupFile.serialize(uploadParams).file;
  assert.equal(inner.localDirectory, "/a.txt", "localDirectory is /<fileName>");
  assert.equal(inner.targetDirectory, "/", "targetDirectory is the caller's folder");
  assert.equal(inner.fileSha3.length, 0, "sha3 is sent empty");
  assert.equal(inner.field15, true);
});

test("0x6d6_2 get-url matches the reference byte for byte", () => {
  // Golden: file descriptor in outer field 3 (`1a`), appId 7.
  const { wireName, bytes: encoded } = encodeRequest(GetGroupFileUrl, {
    groupId: 123456789,
    fileId: "fid-1",
    busId: 102,
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x6d6_2");
  assert.equal(hex(encoded), "08d60d100222121a1008959aef3a1007186622056669642d316001");
});

test("0x6d6_3 delete matches the reference byte for byte, fileId in inner field 5", () => {
  // Golden: `22` = outer field 4, and fileId is INNER field 5 (`2a`), not 4.
  const { wireName, bytes: encoded } = encodeRequest(DeleteGroupFile, { groupId: 123456789, fileId: "fid-1" });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x6d6_3");
  assert.equal(hex(encoded), "08d60d10032210220e08959aef3a18662a056669642d316001");
});

test("0x6d6_4 rename matches the reference byte for byte", () => {
  // Golden: no appId field in the rename body; the parent is `parentFolder` (5).
  const { wireName, bytes: encoded } = encodeRequest(RenameGroupFile, {
    groupId: 123456789,
    fileId: "fid-1",
    parentDirectory: "/",
    newFileName: "b.txt",
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x6d6_4");
  assert.equal(hex(encoded), "08d60d1004221a2a1808959aef3a186622056669642d312a012f3205622e7478746001");
});

test("0x6d6_5 move matches the reference byte for byte", () => {
  const { wireName, bytes: encoded } = encodeRequest(MoveGroupFile, {
    groupId: 123456789,
    fileId: "fid-1",
    parentDirectory: "/",
    targetDirectory: "/sub",
  });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x6d6_5");
  assert.equal(hex(encoded), "08d60d1005221b321908959aef3a1007186622056669642d312a012f32042f7375626001");
});

test("the five 0x6d6 actions use five different outer slots", () => {
  const cases: Array<[any, any]> = [
    [UploadGroupFile, uploadParams],
    [GetGroupFileUrl, { groupId: 1, fileId: "f", busId: 102 }],
    [DeleteGroupFile, { groupId: 1, fileId: "f" }],
    [RenameGroupFile, { groupId: 1, fileId: "f", newFileName: "n" }],
    [MoveGroupFile, { groupId: 1, fileId: "f", parentDirectory: "/", targetDirectory: "/t" }],
  ];
  const observed = cases.map(([spec, params]) => {
    const body = spec.encodeBody(spec.serialize(params)) as Uint8Array;
    // The wrapper's FIRST field is the slot itself; each slot wraps an inner
    // message whose field 1 is groupUin. Reading the slot is therefore one tag,
    // and the inner message must start with the groupUin varint.
    const reader = new ProtoReader(body);
    assert.ok(reader.next());
    const slot = reader.fieldNumber;
    const inner = reader.bytes();
    const innerReader = new ProtoReader(inner);
    assert.ok(innerReader.next());
    assert.equal(innerReader.fieldNumber, 1, "the inner message must open with groupUin");
    return slot;
  });
  assert.deepEqual(observed, [1, 3, 4, 5, 6]);
});

test("the upload response decodes all eleven of its fields", () => {
  const writer = new ProtoWriter()
    .int32(1, 1) // retCode
    .string(2, "ok")
    .string(3, "done")
    .string(4, "1.2.3.4")
    .string(5, "dns")
    .int32(6, 102)
    .string(7, "fid")
    .bytes(8, bytes("aa"))
    .bytes(9, bytes("bb"))
    .uint32(10, 1)
    .uint32(14, 8080);
  // The reply nests the payload one level down, in outer field 1 (`0a`), so the
  // inner message is what carries fields 1..11.
  const reply = new ProtoWriter().message(1, writer.finish()).finish();
  const decoded = decodeResponseBytes(UploadGroupFile, reply);
  assert.equal(decoded.upload?.retCode, 1);
  assert.equal(decoded.upload?.retMsg, "ok");
  assert.equal(decoded.upload?.clientWording, "done");
  assert.equal(decoded.upload?.uploadIp, "1.2.3.4");
  assert.equal(decoded.upload?.serverDns, "dns");
  assert.equal(decoded.upload?.busId, 102);
  assert.equal(decoded.upload?.fileId, "fid");
  assert.equal(hex(decoded.upload!.checkKey), "aa");
  assert.equal(hex(decoded.upload!.fileKey), "bb");
  assert.equal(decoded.upload?.boolFileExist, 1);
  assert.equal(decoded.upload?.uploadPort, 8080);
});

test("upload throws when the reply has no upload slot", () => {
  // A well-formed but empty body: the envelope decodes to {} and the spec must
  // complain rather than report a silent success.
  const empty = new ProtoWriter().message(4, new Uint8Array(0)).finish();
  const decodedEmpty = decodeOidbEnvelope(empty, UploadGroupFile.decodeBody).body;
  assert.ok(decodedEmpty !== null);
  assert.throws(() => UploadGroupFile.deserialize(decodedEmpty), /missing/);
});

test("a body-level retCode failure raises GroupFileRetError", () => {
  assert.doesNotThrow(() => ensureRetCodeZero("op", 0, "ok", ""));
  assert.throws(
    () => ensureRetCodeZero("group file delete", -1, "nope", "文件不存在"),
    (err: unknown) => {
      assert.ok(err instanceof GroupFileRetError);
      assert.equal(err.retCode, -1);
      assert.equal(err.operation, "group file delete");
      assert.match(err.message, /文件不存在/);
      return true;
    },
  );
  assert.doesNotThrow(() => ensureRetCodeZero("op", undefined, undefined, undefined));
  // -1 is the encoding for a signed int32 retCode, so it must survive as -1.
  assert.throws(
    () => ensureRetCodeZero("op", -1, "", ""),
    (err: unknown) => err instanceof GroupFileRetError && err.retCode === -1,
  );
});

test("a delete response carrying a negative retCode fails through the spec", () => {
  // outer field 4 -> delete { 1: retCode = -1 as ten-byte varint }
  const inner = `08${"ff".repeat(9)}01`;
  const body = `22${(inner.length / 2).toString(16).padStart(2, "0")}${inner}`;
  assert.throws(() => DeleteGroupFile.deserialize(decodeResponse(DeleteGroupFile, body)), GroupFileRetError);
});

test("group file url decodes the url bytes to text", () => {
  // download { 4: "1.2.3.4", 6: "http://x/y", 11: "f.txt" }
  const url = Buffer.from("http://x/y").toString("hex");
  const inner = `2204312e322e` + `32${(url.length / 2).toString(16).padStart(2, "0")}${url}` + `5a05662e747874`;
  const body = `1a${(inner.length / 2).toString(16).padStart(2, "0")}${inner}`;
  const result = GetGroupFileUrl.deserialize(decodeResponse(GetGroupFileUrl, body));
  assert.equal(result.downloadUrl, "http://x/y");
  assert.equal(result.saveFileName, "f.txt");
});

// ===========================================================================
// 0xfe5_2 — group list
// ===========================================================================

test("0xfe5_2 group-list request matches the reference byte for byte", () => {
  // Golden: the trailing `c8b80201` is field 5001 = 1, a three-byte tag; 5002 and
  // 5003 are the two flags the reference leaves false.
  const { wireName, bytes: encoded } = encodeRequest(FetchGroupList, {});
  assert.equal(wireName, "OidbSvcTrpcTcp.0xfe5_2");
  assert.equal(
    hex(encoded),
    "08e51f1002225c0a5a0a4e0801100118012001280140014801500158016001680170017801800101880101900101980101a00101b00101b80101c00101c80101d00101d80101e00101e80101f00101f80101800201c8b80201120218011a04280130016001",
  );
});

test("the group-list config keeps the reference's two disabled flags off the wire", () => {
  const encoded = hex(FetchGroupList.encodeBody(FetchGroupList.serialize({})));
  assert.match(encoded, /c8b80201/, "5001 must be present");
  assert.doesNotMatch(encoded, /d0b802/, "5002 must be absent");
  assert.doesNotMatch(encoded, /d8b802/, "5003 must be absent");
});

test("the group list lives in response field 2, not field 1", () => {
  const info = "2a0167"; // field 5 groupName "g"
  const custom = "1a0172"; // field 3 remark "r"
  const group =
    "1801" + // field 3 groupUin = 1
    `22${(info.length / 2).toString(16).padStart(2, "0")}${info}` +
    `2a${(custom.length / 2).toString(16).padStart(2, "0")}${custom}`;
  const body = `12${(group.length / 2).toString(16).padStart(2, "0")}${group}`;
  const decoded = decodeResponse(FetchGroupList, body);
  assert.equal(decoded.groups.length, 1);
  assert.equal(decoded.groups[0].groupUin, 1);
  assert.equal(decoded.groups[0].info.groupName, "g");
  assert.equal(decoded.groups[0].customInfo.remark, "r");
  // The same payload under field 1 must yield no groups.
  const wrong = decodeResponse(FetchGroupList, `0a${(group.length / 2).toString(16).padStart(2, "0")}${group}`);
  assert.equal(wrong.groups.length, 0);
});

test("group summary maps remark from customInfo and memo from announcement||description", () => {
  const now = 1_700_000_000;
  const info = {
    createdTime: 100,
    memberMax: 200,
    memberCount: 3,
    groupName: "g",
    shutUpAllTimestamp: now + 60,
    description: "desc",
    question: "q",
    announcement: "ann",
  };
  assert.deepEqual(toGroupSummary({ groupUin: 42, info, customInfo: { remark: "r" } }, now), {
    group_id: 42,
    group_name: "g",
    group_remark: "r",
    member_count: 3,
    max_member_count: 200,
    group_create_time: 100,
    group_level: 0,
    group_memo: "ann",
    group_description: "desc",
    group_all_shut: -1,
  });
  // memo falls back to description when the announcement is empty.
  const noAnn = toGroupSummary({ groupUin: 1, info: { ...info, announcement: "" } }, now);
  assert.equal(noAnn.group_memo, "desc");
});

test("group_all_shut is a computed -1/0, not the raw mute timestamp", () => {
  const cases: Array<{ expireTs: number; now: number; expected: boolean; why: string }> = [
    { expireTs: 1_700_000_100, now: 1_700_000_000, expected: true, why: "expiry in the future" },
    { expireTs: 1_700_000_000, now: 1_700_000_000, expected: false, why: "expiry exactly now is over" },
    { expireTs: 1_699_999_000, now: 1_700_000_000, expected: false, why: "expiry in the past" },
    { expireTs: 0, now: 1_700_000_000, expected: false, why: "no expiry at all" },
  ];
  for (const c of cases) {
    assert.equal(isGroupAllMuted(c.expireTs, c.now), c.expected, c.why);
    const summary = toGroupSummary(
      {
        groupUin: 1,
        info: {
          createdTime: 0,
          memberMax: 0,
          memberCount: 0,
          groupName: "",
          shutUpAllTimestamp: c.expireTs,
          description: "",
          question: "",
          announcement: "",
        },
      },
      c.now,
    );
    assert.equal(summary.group_all_shut, c.expected ? -1 : 0, c.why);
  }
});

test("FetchGroupDetail returns the first populated group or null", () => {
  // groups[0] = { 3: groupUin=2, 4: info { 5: groupName="g" } }
  const withGroup = decodeResponse(FetchGroupDetail, "1207180222032a0167");
  assert.equal(FetchGroupDetail.deserialize(withGroup)?.group_id, 2);
  // An empty body carries no group; the spec reports null rather than throwing.
  const empty = new ProtoWriter().message(4, new Uint8Array(0)).finish();
  const noGroup = decodeOidbEnvelope(empty, FetchGroupDetail.decodeBody).body;
  assert.ok(noGroup !== null);
  assert.equal(FetchGroupDetail.deserialize(noGroup), null);
});

// ===========================================================================
// 0x10c0 — group join requests
// ===========================================================================

test("0x10c0 pending request uses sub-command 1 and matches the reference", () => {
  // Golden: groupreq_pending -> count 50 (0x32), no cursor.
  const { wireName, bytes: encoded } = encodeRequest(FetchGroupRequests, { filtered: false });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x10c0_1");
  assert.equal(hex(encoded), "08c0211001220208326001");
});

test("0x10c0 filtered requests use sub-command 2", () => {
  const { wireName } = encodeRequest(FetchGroupRequests, { filtered: true });
  assert.equal(wireName, "OidbSvcTrpcTcp.0x10c0_2");
  assert.equal(GROUP_REQUESTS_SUB_COMMAND.pending, 1);
  assert.equal(GROUP_REQUESTS_SUB_COMMAND.filtered, 2);
});

test("a non-zero cursor is sent as a uint64 in field 2", () => {
  // Golden: count=50, cursor=998877665544332211 (`b3c7dde69cbeaeee0d`).
  const { bytes: encoded } = encodeRequest(FetchGroupRequests, {
    filtered: false,
    cursor: 998877665544332211n,
  });
  assert.equal(hex(encoded), "08c0211001220c083210b3c7dde69cbeaeee0d6001");
});

test("a zero cursor is dropped and a custom count replaces the default 50", () => {
  // Golden: groupreq_default -> count 20 = 0x14, no field 2.
  const { bytes: encoded } = encodeRequest(FetchGroupRequests, { count: 20 });
  assert.equal(hex(encoded), "08c0211001220208146001");
});

test("the by-uin user has a numeric uin; the by-uid user has a string uid", () => {
  // item { 1 sequence=7, 5 target }: the same bytes under both schemas.
  const target = "0801"; // field 1 varint 1
  const item = "0807" + `2a${(target.length / 2).toString(16).padStart(2, "0")}${target}`;
  const page = `0a${(item.length / 2).toString(16).padStart(2, "0")}${item}`;
  const asUin = decodeGroupRequestsByUin(bytes(page));
  assert.equal(asUin.requests.length, 1);
  assert.equal(asUin.requests[0]!.target!.uin, 1);
  // Under the by-uid schema field 1 is length-delimited, so a varint tag is an
  // unknown field and `uid` stays empty — the reason both passes exist.
  const asUid = decodeGroupRequestsByUid(bytes(page));
  assert.equal(asUid.requests.length, 1);
  assert.equal(asUid.requests[0]!.target!.uid, "");
});

test("the merge reads uin from one decode and uid from the other", () => {
  // item { 1: sequence=7, 5: target { 1: ... } }. The by-uin target is a varint
  // (`08 01`); the by-uid target is a length-delimited string (`0a 03 "abc"`).
  const uinItem = bytes("0807" + "2a020801");
  const uidItem = bytes("0807" + "2a05" + "0a03616263");
  // `item` is bytes, so its length IS the protobuf length — do not halve it.
  const page = (item: Uint8Array): string =>
    `0a${item.length.toString(16).padStart(2, "0")}${hex(item)}`;
  const byUin = decodeGroupRequestsByUin(bytes(page(uinItem)));
  const byUid = decodeGroupRequestsByUid(bytes(page(uidItem)));
  assert.equal(byUin.requests[0]!.target!.uin, 1);
  assert.equal(byUid.requests[0]!.target!.uid, "abc");

  const merged = mergeRequestList(byUin, byUid);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.target.uin, 1, "uin from the by-uin decode");
  assert.equal(merged[0]!.target.uid, "abc", "uid from the by-uid decode");
  assert.equal(merged[0]!.sequence, 7n);
});

test("the merge pairs by index and prefers the by-uin name", () => {
  const emptyTail = { field2: 0n, newLatestSeq: 0n, field4: 0, field5: 0n, field6: 0 };
  const a = {
    requests: [{ sequence: 1n, eventType: 1, state: 1, field9: "", comment: "", operateTransInfo: new Uint8Array(0), target: { uin: 10, name: "a" } }],
    ...emptyTail,
  };
  const b = {
    requests: [{ sequence: 1n, eventType: 0, state: 0, field9: "", comment: "", operateTransInfo: new Uint8Array(0), target: { uid: "u", name: "b" } }],
    ...emptyTail,
  };
  const merged = mergeRequestList(a, b);
  assert.equal(merged[0]!.target.uin, 10);
  assert.equal(merged[0]!.target.uid, "u");
  assert.equal(merged[0]!.target.name, "a", "the by-uin name wins");

  // A longer second list must not be truncated.
  const longer = { requests: [b.requests[0]!, { ...b.requests[0]!, sequence: 2n }], ...emptyTail };
  assert.equal(mergeRequestList(a, longer).length, 2);
});

test("the canonical flag round-trips through its parser", () => {
  const flag = formatGroupRequestFlag({ sequence: 999n, groupId: 42, eventType: 1, filtered: false });
  assert.equal(flag, "slreq:1:999:42:1:0");
  assert.deepEqual(parseGroupRequestFlag(flag), {
    kind: "canonical",
    sequence: 999,
    groupId: 42,
    eventType: 1,
    filtered: false,
  });
  const filtered = formatGroupRequestFlag({ sequence: 1n, groupId: 2, eventType: 3, filtered: true });
  assert.equal(filtered, "slreq:1:1:2:3:1");
  const parsed = parseGroupRequestFlag(filtered);
  assert.equal(parsed.kind === "canonical" && parsed.filtered, true);
});

test("the parser also accepts a bare sequence and the legacy add/invite form", () => {
  assert.deepEqual(parseGroupRequestFlag("12345"), { kind: "sequence", sequence: 12345 });
  assert.deepEqual(parseGroupRequestFlag("add:42:uid-1"), {
    kind: "legacy",
    requestType: "add",
    groupId: 42,
    targetUid: "uid-1",
  });
  // A uid containing colons must survive: the tail is rejoined.
  assert.deepEqual(parseGroupRequestFlag("invite:42:u:1:2"), {
    kind: "legacy",
    requestType: "invite",
    groupId: 42,
    targetUid: "u:1:2",
  });
  assert.throws(() => parseGroupRequestFlag("slreq:2:1:2:3:0"), /unsupported canonical/);
  assert.throws(() => parseGroupRequestFlag("slreq:1:1:2:3:9"), /invalid filtered/);
  assert.throws(() => parseGroupRequestFlag("add:0:u"), /invalid group_id/);
  assert.throws(() => parseGroupRequestFlag("bogus:1:u"), /invalid group request flag/);
  assert.throws(() => parseGroupRequestFlag("0"), /invalid sequence/);
  assert.throws(() => parseGroupRequestFlag(""), /invalid group request flag/);
});

test("a request sequence of zero is rejected", () => {
  assert.equal(normalizeGroupRequestSequence(7n, 42), 7);
  assert.throws(() => normalizeGroupRequestSequence(0n, 42), /invalid group-request sequence: group=42/);
  assert.throws(() => normalizeGroupRequestSequence(undefined, 42), /invalid group-request sequence/);
});

test("notify-type mapping is a table with an identity fallback", () => {
  assert.equal(groupRequestOperationType(0), 0);
  assert.equal(groupRequestOperationType(1), 2);
  assert.equal(groupRequestOperationType(17), 100);
  // A key always wins over the identity fallback — the two ranges overlap
  // (2 is both a value and a key), so "output maps to itself" is only true for
  // values that are NOT also inputs. This is the reference's behaviour: the Map
  // lookup happens first.
  assert.equal(groupRequestOperationType(2), 10, "2 is a key, so it remaps");
  for (const value of GROUP_REQUEST_OPERATION_TYPE.values()) {
    const expected = GROUP_REQUEST_OPERATION_TYPE.get(value) ?? value;
    assert.equal(groupRequestOperationType(value), expected);
  }
  assert.equal(groupRequestOperationType(9999), null);
});