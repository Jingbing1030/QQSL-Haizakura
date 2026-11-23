import assert from "node:assert/strict";
import { test } from "node:test";

import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";
import { FriendApi } from "../src/bridge/apis/friend.js";
import { decodeOidbBaseMeta, decodeOidbEnvelope, encodeOidbEnvelope, makeOidbEnvelope } from "../src/oidb/envelope.js";
import {
  ClearFriendRemark,
  GetDoubtBuddyReq,
  SetFriendRemark,
  ApproveDoubtBuddyReq,
  RejectDoubtBuddyReq,
} from "../src/oidb/services/index.js";
import { encodeOidbDoubtGetReq } from "../src/oidb/services/0xd69-d72.js";
import {
  encodeClearFriendRemarkReq,
  encodeFriendRemarkTarget,
  encodeSetFriendRemarkReq,
  FriendRemarkTargetField,
  SetFriendRemarkChangeField,
  SetFriendRemarkField,
} from "../src/oidb/services/0x912e.js";
import { ProtoWriter } from "../src/oidb/wire.js";

const SELF_UIN = 10001;
const PEER_UIN = 20002;

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function response(command: number, subCommand: number, body: Uint8Array, uinForm = false): Uint8Array {
  return encodeOidbEnvelope(makeOidbEnvelope(command, subCommand, body, uinForm));
}

function setup(onPacket: (cmd: string, request: Uint8Array) => Uint8Array) {
  const identity = new MemoryIdentity(String(SELF_UIN), "bot");
  identity.rememberFriends([{ uin: PEER_UIN, uid: `uid-${PEER_UIN}`, nickname: "peer", remark: "" }]);
  const bridge = new Bridge(identity);
  bridge.bindPid(1, {
    sendPacket: async (cmd, request) => ({
      success: true,
      gotResponse: true,
      errorCode: 0,
      responseData: onPacket(cmd, request),
    }),
  });
  identity.setSelfProfile({ uin: SELF_UIN, uid: `uid-${SELF_UIN}`, nickname: "bot", remark: "", qid: "", sex: "unknown", age: 0, sign: "", avatar: "", level: 0, qidianMasterFlag: 0, qidianCrewFlag: 0, qidianCrewFlag2: 0 });
  return { identity, api: new FriendApi(bridge) };
}

test("setRemark resolves the friend UID and confirms the server echo", async () => {
  const { api } = setup((cmd, request) => {
    assert.equal(cmd, "OidbSvcTrpcTcp.0x912e_0");
    const env = decodeOidbEnvelope(request, SetFriendRemark.decodeBody);
    assert.equal(env.command, SetFriendRemark.command);
    assert.ok(env.body);
    assert.equal(hex(SetFriendRemark.encodeBody(SetFriendRemark.serialize({ targetUid: "uid-20002", remark: "work" }))), hex(encodeSetFriendRemarkReq({ change: { target: { targetUid: "uid-20002", targetUin: 0n }, remark: "work" }, scene: 0 })));
    const target = new ProtoWriter().string(FriendRemarkTargetField.targetUid, "uid-20002").uint64(FriendRemarkTargetField.targetUin, BigInt(PEER_UIN)).finish();
    const change = new ProtoWriter().message(SetFriendRemarkChangeField.target, target).string(SetFriendRemarkChangeField.remark, "work").finish();
    const body = new ProtoWriter().message(SetFriendRemarkField.change, change).finish();
    return response(SetFriendRemark.command, SetFriendRemark.subCommand ?? 0, new ProtoWriter().message(1, new ProtoWriter().message(1, target).string(2, "work").finish()).finish());
  });
  await api.setRemark(PEER_UIN, "work");
});

test("setRemark clears empty remarks and rejects dataline pseudo-contacts before sending", async () => {
  let packets = 0;
  const { api } = setup((cmd, request) => {
    packets++;
    assert.equal(cmd, "OidbSvcTrpcTcp.0x912f_0");
    const env = decodeOidbEnvelope(request, ClearFriendRemark.decodeBody);
    assert.equal(env.command, ClearFriendRemark.command);
    assert.ok(env.body);
    assert.equal(hex(encodeClearFriendRemarkReq(ClearFriendRemark.serialize({ targetUid: "uid-20002" }))), hex(encodeClearFriendRemarkReq({ target: { targetUid: "uid-20002", targetUin: 0n } })));
    return response(ClearFriendRemark.command, ClearFriendRemark.subCommand ?? 0, new Uint8Array(), false);
  });
  await api.setRemark(PEER_UIN, "");
  assert.equal(packets, 1);
  await assert.rejects(() => api.setRemark(2113929217, "x"), /this contact does not support remarks/);
  assert.equal(packets, 1);
});

test("getDoubtRequests requests the specified count and completes UIN/UID from identity", async () => {
  const { identity, api } = setup((cmd, request) => {
    assert.equal(cmd, "OidbSvcTrpcTcp.0xd69_0");
    const env = decodeOidbEnvelope(request, GetDoubtBuddyReq.decodeBody);
    assert.equal(env.command, GetDoubtBuddyReq.command);
    assert.ok(env.body);
    assert.equal(hex(encodeOidbDoubtGetReq(GetDoubtBuddyReq.serialize({ count: 7 }))), hex(encodeOidbDoubtGetReq({ field1: 1, inner: { num: 7, uk: "" } })));
    const item1 = new ProtoWriter().string(1, "uid-20002").string(2, "peer").uint64(8, 10n).finish();
    const item2 = new ProtoWriter().uint64(1, BigInt(PEER_UIN)).string(2, "new").finish();
    const getBody = new ProtoWriter().message(1, item1).message(1, item2).finish();
    const getResp = new ProtoWriter().uint32(1, 0).message(2, getBody).finish();
    const uinItems = new ProtoWriter().uint64(1, BigInt(PEER_UIN)).finish();
    const uinGetBody = new ProtoWriter().message(1, uinItems).message(1, new Uint8Array()).finish();
    const uinGetResp = new ProtoWriter().uint32(1, 0).message(2, uinGetBody).finish();
    return response(GetDoubtBuddyReq.command, GetDoubtBuddyReq.subCommand ?? 0, getResp, true);
  });
  identity.rememberFriends([{ uin: PEER_UIN, uid: "uid-20002", nickname: "peer", remark: "" }]);
  const rows = await api.getDoubtRequests(7);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.user_id, PEER_UIN);
  assert.equal(rows[1]?.uid, `uid-${PEER_UIN}`);
});

test("approve and reject resolve numeric flags and use their distinct OIDB specs", async () => {
  const seen: string[] = [];
  const { api } = setup((cmd, request) => {
    seen.push(cmd);
    if (cmd === "OidbSvcTrpcTcp.0xd72_0") {
      const env = decodeOidbEnvelope(request, ApproveDoubtBuddyReq.decodeBody);
      assert.equal(env.command, ApproveDoubtBuddyReq.command);
      assert.equal(decodeOidbBaseMeta(request).reserved, null);
      assert.ok(env.body);
      assert.equal(hex(ApproveDoubtBuddyReq.encodeBody(ApproveDoubtBuddyReq.serialize({ uid: `uid-${PEER_UIN}`, selfUid: `uid-${SELF_UIN}` }))), hex(ApproveDoubtBuddyReq.encodeBody({ selfUid: `uid-${SELF_UIN}`, targetUid: `uid-${PEER_UIN}`, field3: 0, field4: "" })));
      return response(ApproveDoubtBuddyReq.command, ApproveDoubtBuddyReq.subCommand ?? 0, new Uint8Array());
    }
    assert.equal(cmd, "OidbSvcTrpcTcp.0xd69_0");
    const env = decodeOidbEnvelope(request, RejectDoubtBuddyReq.decodeBody);
    assert.equal(env.command, RejectDoubtBuddyReq.command);
    assert.equal(decodeOidbBaseMeta(request).reserved, 1);
    assert.ok(env.body);
    assert.equal(hex(RejectDoubtBuddyReq.encodeBody(RejectDoubtBuddyReq.serialize({ uid: "already-a-uid" }))), hex(RejectDoubtBuddyReq.encodeBody({ field1: 3, inner: { uid: "already-a-uid" } })));
    return response(RejectDoubtBuddyReq.command, RejectDoubtBuddyReq.subCommand ?? 0, new Uint8Array());
  });
  await api.approveDoubtRequest(String(PEER_UIN));
  await api.rejectDoubtRequest("already-a-uid");
  assert.deepEqual(seen, ["OidbSvcTrpcTcp.0xd72_0", "OidbSvcTrpcTcp.0xd69_0"]);
});
