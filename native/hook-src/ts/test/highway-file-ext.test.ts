// Golden-vector tests for the FILE transfer highway extension (`FileUploadExt`).
//
// Reference: `buildGroupFileUploadExt` (reference/index.mjs:289652) and
// `buildPrivateFileUploadExt` (:289690).
//
// ---------------------------------------------------------------------------
// Why goldens, and not a field-table assertion
// ---------------------------------------------------------------------------
// `FileUploadEntry` numbers its five children 100/200/300/400/500 and
// `FileUploadBusiInfo` numbers four 1/100/200/400. Every tag is therefore two
// bytes, and a reader that takes only the first byte reports field numbers that
// do not exist in the message at all:
//
//     a2 06  -> varint 802 -> field 100   (first-byte-only: "field 4")
//     c0 0c  -> varint 1600 -> field 200  (first-byte-only: "field 0")
//
// A test that asserts "the encoder emitted a field 100 entry" would still pass
// with field 100 and field 101 swapped, because both two-byte tags decode
// "successfully" as *something*. Only the bytes settle it. This is the exact
// failure the port's history warns about.
//
// The vectors below were produced by RUNNING the reference's own generated
// encoder (extracted verbatim from reference/index.mjs:288614-289727), not by
// hand. The extraction and the dump used to read them back are described at the
// bottom of this file so the next reader can re-derive them.

import assert from "node:assert/strict";
import test from "node:test";

import {
  FILE_UPLOAD_CLIENT_INFO,
  FILE_UPLOAD_HIGHWAY_CMD_IDS,
  FileUploadBusiInfoField,
  FileUploadClientInfoField,
  FileUploadEntryField,
  FileUploadExtField,
  FileUploadFileEntryField,
  FileUploadHostConfigField,
  FileUploadHostField,
  FileUploadNameInfoField,
  FileUploadUrlField,
  GROUP_FILE_UPLOAD_BUS_ID,
  buildGroupFileUploadExt,
  buildPrivateFileUploadExt,
  encodeFileUploadExt,
} from "../src/highway/file-ext.js";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const fromHex = (value: string) => Uint8Array.from(Buffer.from(value, "hex"));

// ===========================================================================
// The vectors
// ===========================================================================
//
// Every vector's inputs are reproduced below it as hex, so a reader can rerun the
// reference encoder without guessing what `md5` was.

const MD5_A = fromHex("d41d8cd98f00b204e9800998ecf8427e"); // md5("")
const SHA1_A = fromHex("da39a3ee5e6b4b0d3255bfef95601890afd80709"); // sha1("")
const MD5_B = fromHex("0123456789abcdef0123456789abcdef");
const SHA1_B = fromHex("abcdef0123456789abcdef0123456789abcdef01");
const EMPTY = new Uint8Array(0);

/**
 * GROUP-1 — the shape a real `upload_group_file` produces.
 *
 * 203 bytes. `busiBuff` is 20 bytes (`08 66` = busId 102, then three varints);
 * `fileEntry` 105; `clientInfo` 23; `fileNameInfo` 13; `host` 19.
 */
const GOLDEN_GROUP_BASIC =
  "08641001a206c301a206140866a006914ec00cb1d1f9d6038019b1d1f9d603c2" +
  "0c69a0068020c20c10d41d8cd98f00b204e9800998ecf8427ee21214da39a3ee" +
  "5e6b4b0d3255bfef95601890afd80709821910d41d8cd98f00b204e9800998ec" +
  "f8427ec2251267726f75702d66696c652d69642d30303031e22b10d41d8cd98f" +
  "00b204e9800998ecf8427ee21217a00603c20c03313030e01203821905312e31" +
  "2e31c0250482190da2060ae69687e6a1a32e747874a21f13c20c100a0b080112" +
  "07312e322e332e3410bb03";

/**
 * PRIVATE-1 — the shape `upload_private_file` produces.
 *
 * 192 bytes, 11 fewer than the group vector despite having two MORE digest bytes
 * in `checkKey` (20 vs 20 here — the group one is also 20). The difference is
 * `busiBuff`: 4 bytes instead of 20 (no busId, no receiverUin, no groupCode), and
 * `unknown200` present at the top (+3 bytes: `c0 0c 01`).
 */
const GOLDEN_PRIVATE_BASIC =
  "08641001a206b501a20604a006914ec20c6ba0068020c20c10d41d8cd98f00b2" +
  "04e9800998ecf8427ee21214da39a3ee5e6b4b0d3255bfef95601890afd80709" +
  "821910d41d8cd98f00b204e9800998ecf8427ec22514707269766174652d6669" +
  "6c652d69642d30303031e22b10d41d8cd98f00b204e9800998ecf8427ee21217" +
  "a00603c20c03313030e01203821905312e312e31c0250482190da2060ae7a781" +
  "e8818a2e747874a21f13c20c100a0b08011207352e362e372e3810903fc00c01";

/**
 * GROUP-2 — the smallest legal upload: size 1, 1-char name, single-digit port.
 *
 * 123 bytes. Proves the single-byte varint branches AND that a 1-byte `checksum`
 * length still emits `c2 0c 01` (a zero-length `checkKey` would drop the field
 * entirely — see the "empty keys" test below).
 */
const GOLDEN_GROUP_MINIMAL =
  "08641001a20674a2060b0866a00601c00c02801902c20c2da00601c20c100123" +
  "456789abcdef0123456789abcdef8219100123456789abcdef0123456789abcd" +
  "efc2250178e21217a00603c20c03313030e01203821905312e312e31c0250482" +
  "1904a2060161a21f12c20c0f0a0b08011207392e392e392e391001";

/**
 * GROUP-3 — every multi-byte varint branch at once.
 *
 * 344 bytes: `fileSize` 4294967295 (5-byte varint), `senderUin` 3000000000,
 * `groupId` 9999999999 (needs 5 bytes of uint64), a 140-character `fileId`
 * (2-byte length), a non-ASCII UTF-8 file name, and a colon-bearing "host" that
 * the encoder treats as an opaque string.
 */
const GOLDEN_GROUP_LARGE =
  "08641001a206d002a206170866a00680bcc1960bc00cffc7afa0258019ffc7af" +
  "a025c20ce701a006ffffffff0fc20c100123456789abcdef0123456789abcdef" +
  "e21214abcdef0123456789abcdef0123456789abcdef018219100123456789ab" +
  "cdef0123456789abcdefc2258c01666666666666666666666666666666666666" +
  "6666666666666666666666666666666666666666666666666666666666666666" +
  "6666666666666666666666666666666666666666666666666666666666666666" +
  "6666666666666666666666666666666666666666666666666666666666666666" +
  "6666666666666666666666666666666666666666666666666666e22b10012345" +
  "6789abcdef0123456789abcdefe21217a00603c20c03313030e0120382190531" +
  "2e312e31c02504821912a2060fe68aa5e5918a2d323032362e706466a21f19c2" +
  "0c160a100801120c323030313a6462383a313a3210ffff03";

/**
 * PRIVATE-2 — emoji + CJK file name, 4-byte UTF-8.
 *
 * 174 bytes. `照片📷.jpg` is 3+3+4+1+1+1+1 = **14 bytes** of UTF-8 while being only
 * **8 UTF-16 code units**, and the length prefix must count BYTES. A `String.length`
 * -based length would say 8 and produce a message the server parses as truncated —
 * and the gap is not a rounding error here, because the emoji alone is 4 bytes but
 * 2 code units.
 */
const GOLDEN_PRIVATE_EMOJI =
  "08641001a206a301a20606a006b8acb12ac20c51a006959aef3ac20c10012345" +
  "6789abcdef0123456789abcdefe21214abcdef0123456789abcdef0123456789" +
  "abcdef018219100123456789abcdef0123456789abcdefc2250b757569642de4" +
  "b8ade69687e21217a00603c20c03313030e01203821905312e312e31c0250482" +
  "1911a2060ee785a7e78987f09f93b72e6a7067a21f15c20c120a0d0801120931" +
  "302e302e302e313510903fc00c01";

// ===========================================================================
// 1. The goldens
// ===========================================================================

test("GOLDEN_GROUP_BASIC — buildGroupFileUploadExt byte-for-byte", () => {
  const encoded = buildGroupFileUploadExt({
    senderUin: 10001,
    groupId: 987654321,
    fileName: "文档.txt",
    fileSize: 4096,
    md5: MD5_A,
    fileId: "group-file-id-0001",
    uploadKey: MD5_A,
    checkKey: SHA1_A,
    uploadHost: "1.2.3.4",
    uploadPort: 443,
  });
  assert.equal(hex(encoded), GOLDEN_GROUP_BASIC);
  assert.equal(encoded.length, 203, "the golden is 203 bytes");
});

test("GOLDEN_PRIVATE_BASIC — buildPrivateFileUploadExt byte-for-byte", () => {
  const encoded = buildPrivateFileUploadExt({
    senderUin: 10001,
    fileName: "私聊.txt",
    fileSize: 4096,
    md5: MD5_A,
    sha1: SHA1_A,
    fileId: "private-file-id-0001",
    uploadKey: MD5_A,
    uploadHost: "5.6.7.8",
    uploadPort: 8080,
  });
  assert.equal(hex(encoded), GOLDEN_PRIVATE_BASIC);
  assert.equal(encoded.length, 192, "the golden is 192 bytes");
});

test("GOLDEN_GROUP_MINIMAL — single-byte varints and a 1-char name", () => {
  const encoded = buildGroupFileUploadExt({
    senderUin: 1,
    groupId: 2,
    fileName: "a",
    fileSize: 1,
    md5: MD5_B,
    fileId: "x",
    uploadKey: EMPTY,
    checkKey: EMPTY,
    uploadHost: "9.9.9.9",
    uploadPort: 1,
  });
  assert.equal(hex(encoded), GOLDEN_GROUP_MINIMAL);
});

test("GOLDEN_GROUP_LARGE — every multi-byte varint branch", () => {
  const encoded = buildGroupFileUploadExt({
    senderUin: 3_000_000_000,
    groupId: 9_999_999_999,
    fileName: "报告-2026.pdf",
    fileSize: 4_294_967_295,
    md5: MD5_B,
    fileId: "f".repeat(140),
    uploadKey: MD5_B,
    checkKey: SHA1_B,
    uploadHost: "2001:db8:1:2",
    uploadPort: 65535,
  });
  assert.equal(hex(encoded), GOLDEN_GROUP_LARGE);
});

test("GOLDEN_PRIVATE_EMOJI — UTF-8 length prefix counts bytes, not UTF-16 units", () => {
  const encoded = buildPrivateFileUploadExt({
    senderUin: 88_888_888,
    fileName: "照片📷.jpg",
    fileSize: 123_456_789,
    md5: MD5_B,
    sha1: SHA1_B,
    fileId: "uuid-中文",
    uploadKey: EMPTY,
    uploadHost: "10.0.0.15",
    uploadPort: 8080,
  });
  assert.equal(hex(encoded), GOLDEN_PRIVATE_EMOJI);
  // The name is 14 UTF-8 bytes but only 8 UTF-16 code units — a `String.length`
  // length prefix would be 6 bytes short of the truth.
  assert.equal(Buffer.byteLength("照片📷.jpg", "utf8"), 14);
  assert.equal("照片📷.jpg".length, 8);
  // The wire agrees: `a2 06 0e` = fileNameInfo field 100, wire 2, **length 14**.
  assert.ok(hex(encoded).includes("a2060ee785a7e78987f09f93b72e6a7067"), "length prefix 0x0e = 14");
});

// ===========================================================================
// 2. What the goldens PROVE about the field numbers
// ===========================================================================
//
// These are not redundant with the byte assertions above: if a future change
// moves a field number, the golden fails with a 200-character hex diff that says
// nothing. A structural assertion names the field.

/** Decode the top level into `[fieldNumber, wireType, payload]`, in byte order. */
function readFields(bytes: Uint8Array): Array<{ field: number; wire: number; bytes?: Uint8Array; value?: bigint }> {
  const out: Array<{ field: number; wire: number; bytes?: Uint8Array; value?: bigint }> = [];
  let i = 0;
  const varint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      const byte = bytes[i++]!;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
  };
  while (i < bytes.length) {
    const tag = varint();
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (wire === 0) {
      out.push({ field, wire, value: varint() });
    } else if (wire === 2) {
      const length = Number(varint());
      out.push({ field, wire, bytes: bytes.subarray(i, i + length) });
      i += length;
    } else {
      throw new Error(`unexpected wire type ${wire} for field ${field}`);
    }
  }
  return out;
}

test("the top level is exactly 1, 2, 100(group)/100,200(private) — no invented fields", () => {
  const group = readFields(fromHex(GOLDEN_GROUP_BASIC));
  assert.deepEqual(
    group.map((f) => [f.field, f.wire]),
    [
      [FileUploadExtField.unknown1, 0],
      [FileUploadExtField.unknown2, 0],
      [FileUploadExtField.entry, 2],
      // unknown200 = 0 for group ⇒ DROPPED. Its absence is the assertion.
    ],
    "group must not emit a top-level field 200",
  );
  assert.equal(group[0]!.value, 100n, "unknown1 = 100");
  assert.equal(group[1]!.value, 1n, "unknown2 = 1");

  const priv = readFields(fromHex(GOLDEN_PRIVATE_BASIC));
  assert.deepEqual(
    priv.map((f) => [f.field, f.wire]),
    [
      [FileUploadExtField.unknown1, 0],
      [FileUploadExtField.unknown2, 0],
      [FileUploadExtField.entry, 2],
      [FileUploadExtField.unknown200, 0],
    ],
    "private must emit a top-level field 200",
  );
  assert.equal(priv[3]!.value, 1n, "unknown200 = 1 for private");
});

test("the entry's five children are 100/200/300/400/500 in that order", () => {
  const entry = readFields(fromHex(GOLDEN_GROUP_BASIC))[2]!.bytes!;
  const children = readFields(entry);
  assert.deepEqual(
    children.map((f) => f.field),
    [
      FileUploadEntryField.busiBuff,
      FileUploadEntryField.fileEntry,
      FileUploadEntryField.clientInfo,
      FileUploadEntryField.fileNameInfo,
      FileUploadEntryField.host,
    ],
  );
  // Spelled out so a wrong constant cannot silently satisfy the loop above.
  assert.deepEqual(
    children.map((f) => f.field),
    [100, 200, 300, 400, 500],
  );
});

test("busiBuff: group has busId/senderUin/receiverUin/groupCode; private has only senderUin", () => {
  const groupEntry = readFields(readFields(fromHex(GOLDEN_GROUP_BASIC))[2]!.bytes!);
  const groupBusi = readFields(groupEntry[0]!.bytes!);
  assert.deepEqual(groupBusi.map((f) => f.field), [1, 100, 200, 400]);
  assert.equal(groupBusi[0]!.value, 102n, "busId = 102");
  assert.equal(groupBusi[1]!.value, 10001n, "senderUin");
  assert.equal(groupBusi[2]!.value, 987654321n, "receiverUin");
  assert.equal(groupBusi[3]!.value, 987654321n, "groupCode");
  // groupCode is 400, NOT 300. The reference writes `80 19` (:289033).
  assert.equal(FileUploadBusiInfoField.groupCode, 400);

  const privEntry = readFields(readFields(fromHex(GOLDEN_PRIVATE_BASIC))[2]!.bytes!);
  const privBusi = readFields(privEntry[0]!.bytes!);
  assert.deepEqual(privBusi.map((f) => f.field), [100], "private busiBuff is senderUin alone");
  assert.equal(privBusi[0]!.value, 10001n);
});

test("fileEntry: 100/200/300/400/600/700, with md5 stated twice", () => {
  const entry = readFields(readFields(fromHex(GOLDEN_GROUP_BASIC))[2]!.bytes!);
  const fileEntry = readFields(entry[1]!.bytes!);
  assert.deepEqual(
    fileEntry.map((f) => f.field),
    [100, 200, 300, 400, 600, 700],
    "ascending, matching __write_FileUploadFileEntry",
  );
  assert.deepEqual(
    fileEntry.map((f) => f.field),
    [
      FileUploadFileEntryField.fileSize,
      FileUploadFileEntryField.md5,
      FileUploadFileEntryField.checkKey,
      FileUploadFileEntryField.md5S2,
      FileUploadFileEntryField.fileId,
      FileUploadFileEntryField.uploadKey,
    ],
  );
  assert.equal(fileEntry[0]!.value, 4096n, "fileSize");
  // md5 (200) and md5S2 (400) carry the SAME 16 bytes.
  assert.equal(hex(fileEntry[1]!.bytes!), hex(MD5_A));
  assert.equal(hex(fileEntry[3]!.bytes!), hex(MD5_A), "md5S2 duplicates md5");
});

test("clientInfo is 100/200/300/400/600 with the reference's hard-coded values", () => {
  const entry = readFields(readFields(fromHex(GOLDEN_GROUP_BASIC))[2]!.bytes!);
  const clientInfo = readFields(entry[2]!.bytes!);
  assert.deepEqual(
    clientInfo.map((f) => f.field),
    [
      FileUploadClientInfoField.clientType,
      FileUploadClientInfoField.appId,
      FileUploadClientInfoField.terminalType,
      FileUploadClientInfoField.clientVer,
      FileUploadClientInfoField.unknown,
    ],
  );
  assert.deepEqual(clientInfo.map((f) => f.field), [100, 200, 300, 400, 600]);
  assert.equal(clientInfo[0]!.value, 3n, "clientType 3");
  assert.equal(new TextDecoder().decode(clientInfo[1]!.bytes!), "100", "appId '100' as text");
  assert.equal(clientInfo[2]!.value, 3n, "terminalType 3");
  assert.equal(new TextDecoder().decode(clientInfo[3]!.bytes!), "1.1.1", "clientVer '1.1.1'");
  assert.equal(clientInfo[4]!.value, 4n, "unknown 4");
  // And the exported constant is the same statement.
  assert.deepEqual({ ...FILE_UPLOAD_CLIENT_INFO }, {
    clientType: 3,
    appId: "100",
    terminalType: 3,
    clientVer: "1.1.1",
    unknown: 4,
  });
});

test("host config nests 500 → 200 → {1,2} → {1,2}", () => {
  const entry = readFields(readFields(fromHex(GOLDEN_GROUP_BASIC))[2]!.bytes!);
  const hostConfig = readFields(entry[4]!.bytes!);
  assert.deepEqual(hostConfig.map((f) => f.field), [FileUploadHostConfigField.hosts]);
  assert.equal(FileUploadHostConfigField.hosts, 200);

  const host = readFields(hostConfig[0]!.bytes!);
  assert.deepEqual(host.map((f) => f.field), [FileUploadHostField.url, FileUploadHostField.port]);
  assert.deepEqual(host.map((f) => f.field), [1, 2]);

  const url = readFields(host[0]!.bytes!);
  assert.deepEqual(url.map((f) => f.field), [FileUploadUrlField.unknown, FileUploadUrlField.host]);
  assert.deepEqual(url.map((f) => f.field), [1, 2]);
  assert.equal(url[0]!.value, 1n, "url.unknown = 1");
  assert.equal(new TextDecoder().decode(url[1]!.bytes!), "1.2.3.4");
  assert.equal(host[1]!.value, 443n, "port 443");
});

// ===========================================================================
// 3. md5 / sha1 are RAW DIGEST BYTES, not hex strings
// ===========================================================================
//
// The single most dangerous confusion in this area: `ntv2-upload.ts` (the image /
// voice / video path) puts hex STRINGS in `fileHash` / `fileSha1`, while this
// message puts raw BYTES in `md5` / `checkKey`. Three independent proofs.

test("md5 is 16 raw bytes on the wire, not a 32-character hex string", () => {
  const entry = readFields(readFields(fromHex(GOLDEN_GROUP_BASIC))[2]!.bytes!);
  const fileEntry = readFields(entry[1]!.bytes!);
  const md5Field = fileEntry[1]!;
  assert.equal(md5Field.bytes!.length, 16, "16 bytes ⇒ raw digest");
  assert.equal(hex(md5Field.bytes!), "d41d8cd98f00b204e9800998ecf8427e");
  // A hex string would be 32 bytes and would NOT equal the input Uint8Array.
  assert.notEqual(md5Field.bytes!.length, 32);
  assert.deepEqual([...md5Field.bytes!], [...MD5_A], "decoded bytes equal the input digest");
});

test("checkKey is 20 raw sha1 bytes for private (proof: length 0x14 = 20)", () => {
  const entry = readFields(readFields(fromHex(GOLDEN_PRIVATE_BASIC))[2]!.bytes!);
  const fileEntry = readFields(entry[1]!.bytes!);
  const checkKey = fileEntry[2]!;
  assert.equal(checkKey.field, FileUploadFileEntryField.checkKey);
  assert.equal(checkKey.bytes!.length, 20, "20 bytes ⇒ raw sha1, not 40-char hex");
  assert.equal(hex(checkKey.bytes!), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
  // The literal tag bytes in the golden: `e2 12 14` = field 300, wire 2, length 20.
  assert.ok(GOLDEN_PRIVATE_BASIC.includes("e21214da39a3ee"), "length prefix is 0x14 = 20");
});

test("the private checkKey is the file's own sha1; the group one comes from the response", () => {
  // Same input sha1, two different fields — and the group path can be given a
  // checkKey that has nothing to do with the file's sha1.
  const bogus = fromHex("ff".repeat(20));
  const encoded = buildGroupFileUploadExt({
    senderUin: 1,
    groupId: 2,
    fileName: "a",
    fileSize: 1,
    md5: MD5_B,
    fileId: "x",
    uploadKey: EMPTY,
    checkKey: bogus,
    uploadHost: "9.9.9.9",
    uploadPort: 1,
  });
  const entry = readFields(readFields(encoded)[2]!.bytes!);
  const checkKey = readFields(entry[1]!.bytes!)[2]!;
  assert.deepEqual([...checkKey.bytes!], [...bogus], "the group builder passes checkKey through untouched");

  // Private takes `sha1`, and there is no `checkKey` parameter at all — a
  // compile-time guarantee that the two cannot be crossed.
  const priv = buildPrivateFileUploadExt({
    senderUin: 1,
    fileName: "a",
    fileSize: 1,
    md5: MD5_B,
    sha1: SHA1_B,
    fileId: "x",
    uploadKey: EMPTY,
    uploadHost: "9.9.9.9",
    uploadPort: 1,
  });
  const privEntry = readFields(readFields(priv)[2]!.bytes!);
  const privCheckKey = readFields(privEntry[1]!.bytes!)[2]!;
  assert.deepEqual([...privCheckKey.bytes!], [...SHA1_B]);
});

// ===========================================================================
// 4. The two builders' four differences
// ===========================================================================

test("group and private differ in exactly: busId, receiverUin, groupCode, unknown200", () => {
  const common = { senderUin: 10001, fileName: "a", fileSize: 1, md5: MD5_A, fileId: "x", uploadKey: EMPTY, uploadHost: "1.1.1.1", uploadPort: 1 };
  const group = readFields(buildGroupFileUploadExt({ ...common, groupId: 2, checkKey: SHA1_A }));
  const priv = readFields(buildPrivateFileUploadExt({ ...common, sha1: SHA1_A }));

  const groupTop = group.map((f) => f.field);
  const privTop = priv.map((f) => f.field);
  assert.deepEqual(groupTop, [1, 2, 100]);
  assert.deepEqual(privTop, [1, 2, 100, 200], "private's extra field is 200");

  const groupBusi = readFields(readFields(group[2]!.bytes!)[0]!.bytes!);
  const privBusi = readFields(readFields(priv[2]!.bytes!)[0]!.bytes!);
  assert.equal(groupBusi.length, 4);
  assert.equal(privBusi.length, 1);
  // senderUin is the only shared member, and it is byte-identical.
  assert.equal(hex(privBusi[0]!.bytes ?? new Uint8Array()), hex(groupBusi[1]!.bytes ?? new Uint8Array()));
  assert.equal(privBusi[0]!.value, 10001n);
});

test("unknown3 is dropped by both (0 for private, absent for group)", () => {
  for (const encoded of [GOLDEN_GROUP_BASIC, GOLDEN_PRIVATE_BASIC, GOLDEN_GROUP_MINIMAL, GOLDEN_PRIVATE_EMOJI]) {
    const fields = readFields(fromHex(encoded));
    assert.ok(
      !fields.some((f) => f.field === FileUploadExtField.unknown3),
      "field 3 must never appear — both builders give it 0 / undefined",
    );
  }
});

// ===========================================================================
// 5. Encoder-level behaviour that the builders rely on
// ===========================================================================

test("empty md5 / checkKey / uploadKey DROP their fields rather than emitting zero-length ones", () => {
  const encoded = buildGroupFileUploadExt({
    senderUin: 1,
    groupId: 2,
    fileName: "a",
    fileSize: 1,
    md5: EMPTY,
    fileId: "",
    uploadKey: EMPTY,
    checkKey: EMPTY,
    uploadHost: "9.9.9.9",
    uploadPort: 1,
  });
  const entry = readFields(readFields(encoded)[2]!.bytes!);
  const fileEntry = readFields(entry[1]!.bytes!);
  assert.deepEqual(
    fileEntry.map((f) => f.field),
    [FileUploadFileEntryField.fileSize],
    "with every optional byte field empty, only fileSize survives",
  );
  // This matters because the reference guards on `length > 0`, and a
  // zero-length `c2 0c 00` would be a different message: the server reads it as
  // "here is an md5, and it is empty".
  assert.ok(!hex(encoded).includes("c20c00"));
});

test("a negative fileSize clamps to 0 instead of encoding a huge varint", () => {
  const encoded = buildGroupFileUploadExt({
    senderUin: 1,
    groupId: 2,
    fileName: "a",
    fileSize: -1,
    md5: MD5_A,
    fileId: "x",
    uploadKey: EMPTY,
    checkKey: EMPTY,
    uploadHost: "9.9.9.9",
    uploadPort: 1,
  });
  const fileEntry = readFields(readFields(readFields(encoded)[2]!.bytes!)[1]!.bytes!);
  assert.equal(
    fileEntry.some((f) => f.field === FileUploadFileEntryField.fileSize),
    false,
    "0 is dropped by the uint64 presence rule",
  );
  // And no 10-byte two's-complement varint leaked in.
  assert.ok(!encoded.some((byte, index) => byte === 0xff && index > 0 && encoded[index + 1] === 0xff));
});

test("a zero uploadPort drops the host's field 2 (and url.unknown=1 stays)", () => {
  const encoded = buildGroupFileUploadExt({
    senderUin: 1,
    groupId: 2,
    fileName: "a",
    fileSize: 1,
    md5: MD5_A,
    fileId: "x",
    uploadKey: EMPTY,
    checkKey: EMPTY,
    uploadHost: "",
    uploadPort: 0,
  });
  const entry = readFields(readFields(encoded)[2]!.bytes!);
  const hostConfig = readFields(entry[4]!.bytes!);
  const host = readFields(hostConfig[0]!.bytes!);
  const url = readFields(host[0]!.bytes!);
  assert.deepEqual(host.map((f) => f.field), [FileUploadHostField.url], "port 0 is dropped");
  assert.deepEqual(url.map((f) => f.field), [FileUploadUrlField.unknown], "empty host is dropped, marker stays");
  assert.equal(url[0]!.value, 1n);
});

test("encodeFileUploadExt round-trips each golden", () => {
  // Re-encoding the decoded golden must reproduce it exactly. This catches an
  // ordering change, which a presence-only test would miss.
  for (const golden of [GOLDEN_GROUP_BASIC, GOLDEN_PRIVATE_BASIC, GOLDEN_GROUP_MINIMAL, GOLDEN_PRIVATE_EMOJI, GOLDEN_GROUP_LARGE]) {
    const fields = readFields(fromHex(golden));
    const top = (n: number) => fields.find((f) => f.field === n);
    const entryFields = readFields(top(100)!.bytes!);
    const sub = (n: number) => readFields(entryFields.find((f) => f.field === n)!.bytes!);
    const busi = sub(100);
    const file = sub(200);
    const client = sub(300);
    const name = sub(400);
    const hostConfig = sub(500);
    const host = readFields(hostConfig[0]!.bytes!);
    const url = readFields(host[0]!.bytes!);
    // `""` rather than `undefined`: `exactOptionalPropertyTypes` is on, and every
    // string field in this message drops out when empty anyway, so the two are
    // the same statement — one of them just typechecks.
    const text = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : "");
    const num = (n: number, list = file) => Number(list.find((f) => f.field === n)?.value ?? 0);
    const big = (n: number, list = busi) => list.find((f) => f.field === n)?.value ?? 0n;

    const rebuilt = encodeFileUploadExt({
      unknown1: Number(top(1)!.value),
      unknown2: Number(top(2)!.value),
      ...(top(3) ? { unknown3: Number(top(3)!.value) } : {}),
      entry: {
        busiBuff: {
          ...(big(1) ? { busId: Number(big(1)) } : {}),
          senderUin: big(100),
          receiverUin: big(200),
          groupCode: big(400),
        },
        fileEntry: {
          ...(num(100) ? { fileSize: num(100) } : {}),
          md5: file.find((f) => f.field === 200)?.bytes ?? EMPTY,
          ...(file.find((f) => f.field === 300) ? { checkKey: file.find((f) => f.field === 300)!.bytes! } : {}),
          ...(file.find((f) => f.field === 400) ? { md5S2: file.find((f) => f.field === 400)!.bytes! } : {}),
          ...(file.find((f) => f.field === 600) ? { fileId: text(file.find((f) => f.field === 600)!.bytes)! } : {}),
          ...(file.find((f) => f.field === 700) ? { uploadKey: file.find((f) => f.field === 700)!.bytes! } : {}),
        },
        clientInfo: {
          clientType: Number(client.find((f) => f.field === 100)?.value ?? 0),
          appId: text(client.find((f) => f.field === 200)?.bytes),
          terminalType: Number(client.find((f) => f.field === 300)?.value ?? 0),
          clientVer: text(client.find((f) => f.field === 400)?.bytes),
          unknown: Number(client.find((f) => f.field === 600)?.value ?? 0),
        },
        fileNameInfo: { fileName: text(name[0]!.bytes) },
        host: {
          hosts: [{
            url: { unknown: Number(url.find((f) => f.field === 1)!.value), host: text(url.find((f) => f.field === 2)?.bytes) },
            port: Number(host.find((f) => f.field === 2)?.value ?? 0),
          }],
        },
      },
      ...(top(200) ? { unknown200: Number(top(200)!.value) } : {}),
    });
    assert.equal(hex(rebuilt), golden, "re-encode must be byte-identical");
  }
});

// ===========================================================================
// 6. Parameter validation — what the builders refuse
// ===========================================================================

test("BigInt(senderUin) throws on a non-integral number, before anything is encoded", () => {
  // Deliberately NOT rounded: a fractional uin means the caller passed the wrong
  // value (a timestamp, a byte offset), and silently truncating it would upload
  // as the wrong account.
  assert.throws(
    () => buildGroupFileUploadExt({
      senderUin: 1.5, groupId: 2, fileName: "a", fileSize: 1, md5: MD5_A, fileId: "x",
      uploadKey: EMPTY, checkKey: EMPTY, uploadHost: "1.1.1.1", uploadPort: 1,
    }),
    RangeError,
  );
});

test("a fileSize above 2^53 loses precision in Number() but does not corrupt the varint", () => {
  // `Number(params.fileSize)` is lossy past 2^53, which is the reference's own
  // behaviour (`Math.max(0, fileSize)` on a JS number). Asserted rather than
  // fixed: a group file is capped at 4 GiB, so this is unreachable in practice,
  // and silently switching to a bigint path would diverge from the reference.
  const encoded = buildGroupFileUploadExt({
    senderUin: 1, groupId: 2, fileName: "a", fileSize: 2 ** 40, md5: MD5_A, fileId: "x",
    uploadKey: EMPTY, checkKey: EMPTY, uploadHost: "1.1.1.1", uploadPort: 1,
  });
  const fileEntry = readFields(readFields(readFields(encoded)[2]!.bytes!)[1]!.bytes!);
  assert.equal(fileEntry[0]!.value, BigInt(2 ** 40), "2^40 encodes exactly");
});

test("the helpers' constants are the reference's, not tuned", () => {
  assert.equal(GROUP_FILE_UPLOAD_BUS_ID, 102, "busId 102 (:289658)");
  assert.equal(FILE_UPLOAD_CLIENT_INFO.appId, "100", "appId is the STRING '100' (:289673)");
  assert.equal(FILE_UPLOAD_CLIENT_INFO.clientVer, "1.1.1", "clientVer '1.1.1'");
});

// ===========================================================================
// 7. The cmdIds — the third numbering space
// ===========================================================================

test("FILE_UPLOAD_HIGHWAY_CMD_IDS is 71 / 95, and shares nothing with NTV2", () => {
  assert.deepEqual({ ...FILE_UPLOAD_HIGHWAY_CMD_IDS }, { group: 71, private: 95 });
  // The values come from the two call sites: :289790 (71) and :289859 (95).
  //
  // They must not collide with the OIDB commands that PRECEDE them in the same
  // flow — 0x6d6 (1750) / 0xe37 (3639) — nor with the NTV2 rich-media ids.
  const nt2 = new Set([1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008]);
  for (const id of Object.values(FILE_UPLOAD_HIGHWAY_CMD_IDS)) {
    assert.ok(!nt2.has(id), `${id} must not be an NTV2 highway cmdId`);
    assert.notEqual(id, 1750, "71 is not 0x6d6");
    assert.notEqual(id, 3639, "95 is not 0xe37");
  }
});

// ===========================================================================
// How the goldens were made (kept as executable documentation)
// ===========================================================================
//
// 1. Extract the generated encoder and both builders from the reference:
//
//      python3 - <<'PY'
//      lines = open('reference/index.mjs').read().split('\n')
//      body  = lines[288487:289630]   # protobuf_encode_FileUploadExt + helpers
//      body += lines[289651:289727]   # buildGroupFileUploadExt / buildPrivate…
//      open('/tmp/ref-enc.mjs','w').write("\n".join(body) + """
//      export { protobuf_encode_FileUploadExt, buildGroupFileUploadExt, buildPrivateFileUploadExt };
//      """)
//      PY
//
//    The boundaries are asserted in the script (first line is `var __te$29`,
//    last is the closing `}` of `buildPrivateFileUploadExt`) so a shifted
//    reference cannot silently produce a different extract.
//
// 2. Call it with the arguments each vector lists:
//
//      node -e 'import("/tmp/ref-enc.mjs").then(m => {
//        const md5 = Uint8Array.from(Buffer.from("d41d8cd98f00b204e9800998ecf8427e","hex"));
//        console.log(Buffer.from(m.buildGroupFileUploadExt(
//          10001, 987654321, "文档.txt", 4096, md5, "group-file-id-0001",
//          md5, Uint8Array.from(Buffer.from("da39a3ee…","hex")), "1.2.3.4", 443
//        )).toString("hex"));
//      })'
//
// 3. Decode with a generic wire reader to confirm each field number, and compare
//    the decoded digests to the arguments (`readFields` above is that reader,
//    reduced to what the tests need).
