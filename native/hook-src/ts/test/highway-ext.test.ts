// Golden-vector tests for the highway extension payload.
//
// `bytesReqExtendInfo` rides inside every highway chunk head, so a wrong field
// number here breaks the upload where the server validates the acknowledgement —
// at a point that names nothing about the codec.
//
// The 447-byte vector was extracted by running the reference's own encoder and
// then decoded with a generic wire dumper to confirm each field. Two shapes in it
// are easy to get wrong:
//
//   * `HashSum` is hundred-based (201/202), the same trap as the upload scene
//     block. Its tags are `ca 0c` / `d2 0c`.
//   * `picture` and `hashSum` are nested MESSAGES, not opaque bytes. Treating
//     them as bytes produces the right byte LENGTH and the wrong wire type.

import assert from "node:assert/strict";
import test from "node:test";

import {
  HighwayHashSumField,
  blockHashes,
  buildHighwayExtend,
  encodeRichMediaHighwayExt,
  ipv4ToString,
} from "../src/highway/ext.js";
import { HIGHWAY_BLOCK_SIZE } from "../src/highway/upload.js";

const GOLDEN_HIGHWAY_EXTEND =
    "0a20303132333435363738396162636465663031323334353637383961626364" +
    "6566122061316232633364346535663630373138323933613462356336643765" +
    "386639302a120a100a0b08011207312e322e332e3410bb0332c8020ab6010a85" +
    "010880800f122064343164386364393866303062323034653938303039393865" +
    "636638343237651a286461333961336565356536623462306433323535626665" +
    "6639353630313839306166643830373039222430313233343536373839616263" +
    "646566303132333435363738396162636465662e6a70672a05080110e8073080" +
    "0a38d00548011220303132333435363738396162636465663031323334353637" +
    "383961626364656618012080e2cfaa062880a30512590a2c2f646f776e6c6f61" +
    "643f61707069643d313430372666696c6569643d303132333435363738396162" +
    "6364656612100a043132303012033830301a033330301a176d756c74696d6564" +
    "69612e6e742e71712e636f6d2e636e28013230ca0c241222755f416243644566" +
    "4768496a4b6c4d6e4f705172537455765778597a303132333435d20c0608b1d1" +
    "f9d603508080405a160a14da39a3ee5e6b4b0d3255bfef95601890afd80709";
test("GOLDEN_HIGHWAY_EXTEND — the full extension payload", () => {
  const encoded = encodeRichMediaHighwayExt({
    fileUuid: "0123456789abcdef0123456789abcdef",
    uKey: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    network: { ipv4s: [{ domain: { isEnable: true, ip: "1.2.3.4" }, port: 443 }] },
    msgInfoBody: [
      {
        index: {
          info: {
            fileSize: 245760,
            fileHash: "d41d8cd98f00b204e9800998ecf8427e",
            fileSha1: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
            fileName: "0123456789abcdef0123456789abcdef.jpg",
            type: { type: 1, picFormat: 1000 },
            width: 1280,
            height: 720,
            original: 1,
          },
          fileUuid: "0123456789abcdef0123456789abcdef",
          storeId: 1,
          uploadTime: 1_700_000_000,
          ttl: 86400,
        },
        picture: {
          urlPath: "/download?appid=1407&fileid=0123456789abcdef",
          ext: { originalParameter: "1200", bigParameter: "800", thumbParameter: "300" },
          domain: "multimedia.nt.qq.com.cn",
        },
        fileExist: true,
        hashSum: {
          bytesPbReserveC2c: { friendUid: "u_AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
          troopSource: { groupUin: 987654321 },
        },
      },
    ],
    blockSize: HIGHWAY_BLOCK_SIZE,
    hash: {
      fileSha1: [
        new Uint8Array([
          0xda, 0x39, 0xa3, 0xee, 0x5e, 0x6b, 0x4b, 0x0d, 0x32, 0x55, 0xbf, 0xef, 0x95, 0x60,
          0x18, 0x90, 0xaf, 0xd8, 0x07, 0x09,
        ]),
      ],
    },
  });
  assert.equal(Buffer.from(encoded).toString("hex"), GOLDEN_HIGHWAY_EXTEND);
  assert.equal(encoded.length, 447);
});

test("HashSum is hundred-based — 201 and 202, not 1 and 2", () => {
  // Same trap as the upload scene block. Field 201 wire type 2 is `ca 0c`.
  assert.equal(HighwayHashSumField.bytesPbReserveC2c, 201);
  assert.equal(HighwayHashSumField.troopSource, 202);
  const encoded = encodeRichMediaHighwayExt({
    msgInfoBody: [{ hashSum: { troopSource: { groupUin: 1 } } }],
  });
  assert.ok(Buffer.from(encoded).toString("hex").includes("d20c020801"));
});

test("ipv4ToString renders low-byte-first", () => {
  // The numeric form is little-endian, so 127.0.0.1 is 0x0100007f. Rendering it
  // big-endian gives 1.0.0.127 — a valid-looking address that connects to nothing.
  assert.equal(ipv4ToString(0x0100007f), "127.0.0.1");
  assert.equal(ipv4ToString(0x04030201), "1.2.3.4");
});

test("buildHighwayExtend skips servers with a zero ip or port", () => {
  // A zero means "no address"; emitting 0.0.0.0:0 burns a connect attempt.
  const encoded = buildHighwayExtend(
    "ukey",
    { msgInfoBody: [{ fileExist: true }] },
    [
      { outIp: 0x0100007f, outPort: 443 },
      { outIp: 0, outPort: 443 },
      { outIp: 0x0100007f, outPort: 0 },
    ],
    new Uint8Array(20),
  );
  const hex = Buffer.from(encoded).toString("hex");
  // Exactly one ipv4 entry survives: `0a12 0a0d 0801 1209 3132372e302e302e31 10bb03`,
  // where `3132372e302e302e31` is the ASCII "127.0.0.1" and `10bb03` is port 443.
  assert.equal(hex.split("0a120a0d08011209").length - 1, 1, hex);
  assert.ok(hex.includes("3132372e302e302e31"), "kept the non-zero address");
});

test("buildHighwayExtend throws on an empty msgInfoBody", () => {
  // The server accepted the request but described no files, so there is nothing to
  // acknowledge. The reference's exact wording is reproduced.
  assert.throws(
    () => buildHighwayExtend("ukey", { msgInfoBody: [] }, [], new Uint8Array(20)),
    /upload response missing msg_info body/,
  );
});

test("blockHashes produces one sha1 per block, in order", async () => {
  // The wire contract is per-block, not per-file. A single whole-file hash produces an
  // upload that completes and then fails a server-side integrity check.
  const size = HIGHWAY_BLOCK_SIZE * 2 + 100;
  const source = new Uint8Array(size);
  // Position-dependent, not `i & 0xff`: that repeats every 256 bytes, so all blocks
  // would be identical and the "different blocks" assertion would be testing nothing.
  for (let i = 0; i < size; i += 1) source[i] = (i * 7 + (i >> 16)) & 0xff;
  const hashes = await blockHashes(size, (offset, length) =>
    Promise.resolve(source.subarray(offset, offset + length)),
  );
  assert.equal(hashes.length, 3);
  assert.ok(
    hashes.every((hash) => hash.length === 20),
    "sha1 is 20 bytes",
  );
  assert.notDeepEqual([...hashes[0]!], [...hashes[1]!], "different blocks hash differently");
});

test("blockHashes rejects a short read", async () => {
  // Reading past EOF is the common cause; blaming the transport would send whoever
  // debugs it to the wrong layer.
  await assert.rejects(
    blockHashes(1000, () => Promise.resolve(new Uint8Array(10))),
    /expected 1000 at offset 0/,
  );
});
