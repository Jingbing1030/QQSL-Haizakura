import assert from "node:assert/strict";
import test from "node:test";

import { GroupFileApi } from "../src/bridge/apis/group-file.js";
import type { BridgeContext } from "../src/bridge/context.js";
import type { PacketSendResult } from "../src/bridge/context.js";
import { encodeOidbEnvelope, makeOidbEnvelope, oidbWireName } from "../src/oidb/envelope.js";
import { TransGroupFile } from "../src/oidb/services/0x6d9.js";
import { GetGroupPttUrl } from "../src/oidb/services/0x126e.js";

function context(responseBody: Uint8Array) {
  const calls: Array<{ command: string; body: Uint8Array }> = [];
  const ctx = {
    identity: { uin: 123456789 },
    resolveUserUid: async () => "",
    sendRawPacket: async (command: string, body: Uint8Array): Promise<PacketSendResult> => {
      calls.push({ command, body });
      const isPtt = command === oidbWireName(GetGroupPttUrl.command, GetGroupPttUrl.subCommand!);
      const spec = isPtt ? GetGroupPttUrl : TransGroupFile;
      return {
        success: true,
        gotResponse: true,
        errorCode: 0,
        responseData: encodeOidbEnvelope(makeOidbEnvelope(spec.command, spec.subCommand!, responseBody, spec.uinForm === true)),
      };
    },
  } as unknown as BridgeContext;
  return { ctx, calls };
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

// Reference-generated response bodies: trans_group_file success and 0x126e URL.
const TRANS_RESPONSE = Uint8Array.from(Buffer.from("0a22080012026f6b1a0ce8bdace5ad98e68890e58a9f20662a0a2f736176652f68657265", "hex"));
const PTT_RESPONSE = Uint8Array.from(Buffer.from(
  "0a06120210001a001a490a0c26726b65793d4142435f2d3110901c1a300a176d756c74696d656469612e7166696c652e71712e636f6d12122f646f776e6c6f61643f66696c6569643d3118bb032080a0f8fa05",
  "hex",
));

test("trans sends the reference 0x6d9_0 request and returns the decoded result", async () => {
  const { ctx, calls } = context(TRANS_RESPONSE);
  const result = await new GroupFileApi(ctx).trans(123456789, "file-1");
  assert.deepEqual(result, { saveBusId: 102, saveFilePath: "/save/here" });
  assert.equal(calls[0]?.command, "OidbSvcTrpcTcp.0x6d9_0");
  assert.equal(hex(calls[0]!.body), "08d90d22130a1108959aef3a10071866220666696c652d31");
});

test("trans rejects an empty file ID before sending", async () => {
  const { ctx, calls } = context(TRANS_RESPONSE);
  assert.throws(() => new GroupFileApi(ctx).trans(1, ""), { message: "trans requires fileId" });
  assert.equal(calls.length, 0);
});

test("getPttUrl sends the extended group-PTT request and returns the fixture URL", async () => {
  const { ctx, calls } = context(PTT_RESPONSE);
  const result = await new GroupFileApi(ctx).getPttUrl(111222333, {
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
  });
  assert.equal(result, "https://multimedia.qfile.qq.com/download?fileid=1&rkey=ABC_-1");
  assert.equal(calls[0]?.command, "OidbSvcTrpcTcp.0x126e_200");
  assert.equal(hex(calls[0]!.body), "08ee2410c801225b0a1e0a05080410c8011211a80601b00603c00c02d20c0508bdbc84351a0208021a390a330a1c0880201204686173681a04736861312205612e616d722a04080120011206757569642d3118072080a0f8fa0528901c3001120212006001");
});
