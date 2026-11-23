// Golden-vector tests for the NTV2 rich-media upload request codec.
//
// ---------------------------------------------------------------------------
// Why EVERY assertion here is a literal hex string
// ---------------------------------------------------------------------------
// A structural round-trip test (encode → decode → compare) cannot catch a wrong
// field number, because the encoder and decoder share the mistake and agree with
// themselves. That is not hypothetical: this codec's first draft had
// `SegHead.cachePort` as field 11 where the reference uses 13, and
// `LoginSigHead.appId` as field 2 where the reference uses 3. Both passed every
// structural test.
//
// Worse, a wrong field number often produces a *plausible* message — the server
// accepts the upload and the bug shows up as a missing cache port or a message
// with no text summary. So the only meaningful assertion is against bytes the
// reference implementation itself produced.
//
// Vectors in `docs/ntv2-upload-codec.md` §1, extracted by running the reference's
// own generated encoders and then independently decoded with a generic wire
// dumper to confirm what each byte means.

import assert from "node:assert/strict";
import test from "node:test";

import {
  NTV2_AGENT_TYPE,
  NTV2_REQUEST_TYPE,
  NTV2_UPLOAD_SUB_COMMAND,
  Ntv2BusinessType,
  Ntv2MediaType,
  Ntv2PicFormat,
  Ntv2SceneType,
  NotOnlineImagePbReserveField,
  PicExtBizInfoField,
  PicExtDataField,
  PttExtBizInfoField,
  encodeNotOnlineImagePbReserve,
  encodeNtv2UploadEnvelope,
} from "../src/oidb/services/ntv2-upload.js";

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

test("GOLDEN_MINIMAL — the required spine only", () => {
  // 34 bytes. Note `12 00` for `upload`: present but empty, because `uploadInfo` is
  // empty and every bool/zero field elides.
  const encoded = encodeNtv2UploadEnvelope({
    command: 4548,
    subCommand: NTV2_UPLOAD_SUB_COMMAND,
    errorCode: 0,
    errorMsg: "",
    reserved: 1,
    body: {
      reqHead: {
        common: { requestId: 1, command: 100 },
        scene: { requestType: 2, businessType: 1, sceneType: 1 },
        client: { agentType: 2 },
      },
      upload: { uploadInfo: [], srvSendMsg: false, clientSeq: 0, noNeedCompatMsg: false },
    },
  });
  assert.equal(
    hex(encoded),
    "08c423106422190a150a04080110641209a80602b00601c00c011a02080212006001",
  );
  assert.equal(encoded.length, 34);
});

test("GOLDEN_GROUP_IMAGE — group scene with extData", () => {
  // 228 bytes. The scene block carries `group.groupUin` (field 202 = `d2 0c`) instead
  // of `c2c`, and `extBizInfo.pic.extData` (field 12) instead of `bytesPbReserveC2c`.
  const encoded = encodeNtv2UploadEnvelope({
    command: 4548,
    subCommand: NTV2_UPLOAD_SUB_COMMAND,
    errorCode: 0,
    errorMsg: "",
    reserved: 1,
    body: {
      reqHead: {
        common: { requestId: 1, command: 100 },
        scene: {
          requestType: 2,
          businessType: Ntv2BusinessType.image,
          sceneType: Ntv2SceneType.group,
          group: { groupUin: 987654321 },
        },
        client: { agentType: NTV2_AGENT_TYPE },
      },
      upload: {
        uploadInfo: [
          {
            fileInfo: {
              fileSize: 245760,
              // Hex STRINGS, 32 chars. Raw digests would be 16 bytes and get rejected.
              fileHash: "d41d8cd98f00b204e9800998ecf8427e",
              fileSha1: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
              fileName: "0123456789abcdef0123456789abcdef.jpg",
              type: { type: Ntv2MediaType.image, picFormat: Ntv2PicFormat.jpg },
              width: 1280,
              height: 720,
              original: 1,
            },
            subFileType: 0,
          },
        ],
        tryFastUploadCompleted: true,
        clientRandomId: 0x0123_4567_89ab_cdefn,
        compatQmsgSceneType: 2,
        extBizInfo: {
          pic: { textSummary: "[图片]", extData: { textSummary: "[图片]" } },
          video: { bytesPbReserve: new Uint8Array(0) },
          ptt: {
            bytesReserve: new Uint8Array(0),
            bytesPbReserve: new Uint8Array(0),
            bytesGeneralFlags: new Uint8Array(0),
          },
        },
      },
    },
  });
  assert.equal(
    hex(encoded),
    "08c423106422da010a1e0a04080110641212a80602b00601c00c02d20c0608b1d1f9d603" +
      "1a02080212b7010a88010a85010880800f122064343164386364393866303062323034" +
      "653938303039393865636638343237651a286461333961336565356536623462306433" +
      "3235356266656639353630313839306166643830373039222430313233343536373839" +
      "616263646566303132333435363738396162636465662e6a70672a05080110e80730800a" +
      "38d0054801100120ef9bafcdf8acd191012802321c0a1612085be59bbee789875d620a4a" +
      "085be59bbee789875d12001a006001",
  );
  assert.equal(encoded.length, 228);
});

test("GOLDEN_PRIVATE_IMAGE — c2c scene with bytesPbReserveC2c", () => {
  // 276 bytes. This is the arm the group test above cannot reach: `c2c.targetUid`
  // (field 201 = `ca 0c`) and the `bytesPbReserveC2c` sub-protobuf (field 11).
  const pbReserve = encodeNotOnlineImagePbReserve(1, "[动画表情]");
  const encoded = encodeNtv2UploadEnvelope({
    command: 4549,
    subCommand: NTV2_UPLOAD_SUB_COMMAND,
    errorCode: 0,
    errorMsg: "",
    reserved: 1,
    body: {
      reqHead: {
        common: { requestId: 1, command: 100 },
        scene: {
          requestType: NTV2_REQUEST_TYPE,
          businessType: Ntv2BusinessType.image,
          sceneType: Ntv2SceneType.c2c,
          c2c: { accountType: 2, targetUid: "u_AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
        },
        client: { agentType: NTV2_AGENT_TYPE },
      },
      upload: {
        uploadInfo: [
          {
            fileInfo: {
              fileSize: 51200,
              fileHash: "0cc175b9c0f1b6a831c399e269772661",
              fileSha1: "86f7e437faa5a7fce15d1ddcb9eaeaea377667b8",
              fileName: "ffffffffffffffffffffffffffffffff.png",
              type: { type: Ntv2MediaType.image, picFormat: Ntv2PicFormat.png },
              width: 256,
              height: 256,
              original: 1,
            },
            subFileType: 0,
          },
        ],
        tryFastUploadCompleted: true,
        clientRandomId: 0x7fff_ffff_ffff_ffffn,
        compatQmsgSceneType: 1,
        extBizInfo: {
          pic: { bizType: 1, textSummary: "[动画表情]", bytesPbReserveC2c: pbReserve },
          video: { bytesPbReserve: new Uint8Array(0) },
          ptt: {
            bytesReserve: new Uint8Array(0),
            bytesPbReserve: new Uint8Array(0),
            bytesGeneralFlags: new Uint8Array(0),
          },
        },
      },
    },
  });
  assert.equal(
    hex(encoded),
    "08c5231064228a020a3e0a04080110641232a80602b00601c00c01ca0c260802" +
    "1222755f4162436445664768496a4b6c4d6e4f705172537455765778597a3031" +
    "323334351a02080212c7010a88010a8501088090031220306363313735623963" +
    "30663162366138333163333939653236393737323636311a2838366637653433" +
    "3766616135613766636531356431646463623965616561656133373736363762" +
    "3822246666666666666666666666666666666666666666666666666666666666" +
    "6666662e706e672a05080110e9073080023880024801100120ffffffffffffff" +
    "ff7f2801322c0a260801120e5be58aa8e794bbe8a1a8e683855d5a120801420e" +
    "5be58aa8e794bbe8a1a8e683855d12001a006001",
  );
  assert.equal(encoded.length, 276);
});

test("GOLDEN_PB_RESERVE_C2C — field 8 is a string, not a varint", () => {
  // The 18-byte sub-protobuf. Field 8 is `summary` with wire type 2 (`0x42`); an
  // early reading of this message assumed a numeric flag, which produces a blob of
  // the right LENGTH and the wrong shape — the server accepts the upload and the
  // sticker renders with no label.
  const encoded = encodeNotOnlineImagePbReserve(1, "[动画表情]");
  assert.equal(hex(encoded), "0801420e5be58aa8e794bbe8a1a8e683855d");
  assert.equal(encoded.length, 18);
  assert.equal(encoded[2], 0x42, "field 8 wire type 2");
});

test("reserved must be 1 — every golden ends 60 01", () => {
  // `reserved` is the `uinForm` flag. Omitting it produces a message the server
  // parses but that is not what the client sends.
  const withReserved = encodeNtv2UploadEnvelope({
    command: 4548,
    subCommand: 100,
    body: {},
    reserved: 1,
  });
  assert.ok(hex(withReserved).endsWith("6001"), hex(withReserved));
  const without = encodeNtv2UploadEnvelope({ command: 4548, subCommand: 100, body: {} });
  assert.ok(!hex(without).endsWith("6001"));
});

test("the scene block is 100-based — multi-byte tags", () => {
  // This is the shape that broke the previous port. Field 101 is `a8 06`; a naive
  // first-byte reading calls it "field 21" and the scene names no target.
  const encoded = encodeNtv2UploadEnvelope({
    command: 4548,
    subCommand: 100,
    body: { reqHead: { scene: { requestType: 2 } } },
    reserved: 1,
  });
  assert.ok(
    hex(encoded).includes("a80602"),
    `requestType must encode as a8 06 02, got ${hex(encoded)}`,
  );
});

test("field-number constants match the reference", () => {
  // Wire facts, not tuning knobs. A change here breaks every upload.
  assert.equal(NotOnlineImagePbReserveField.summary, 8, "summary is field 8");
  assert.equal(PicExtBizInfoField.bytesPbReserveC2c, 11, "private arm is 11");
  assert.equal(PicExtBizInfoField.extData, 12, "group arm is 12");
  assert.equal(PicExtBizInfoField.fromScene, 1001, "hundred-based tail");
  assert.equal(PicExtDataField.textSummary, 9, "textSummary is 9, not 2");
  assert.equal(PttExtBizInfoField.bytesReserve, 11, "PttExtBizInfo skips 6-10");
  assert.equal(PttExtBizInfoField.bytesGeneralFlags, 13);
});
