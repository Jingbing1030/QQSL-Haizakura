// Tests for the highway transfer frame.
//
// The frame is 10 bytes of structure around two opaque blobs, which makes it easy
// to get *almost* right: the delimiters and the two lengths are independent, so a
// round-trip test alone passes even when a length is written with the wrong
// endianness, as long as the same wrongness is used on both sides. Every endian
// claim therefore gets an explicit expected-bytes assertion, not just a round trip.

import assert from "node:assert/strict";
import test from "node:test";

import {
  HIGHWAY_APP_ID,
  HIGHWAY_COMMAND_UPLOAD,
  HIGHWAY_DATA_FLAG_UPLOAD,
  HIGHWAY_LOGIN_SIG_TYPE,
  encodeLoginSigHead,
  encodeReqDataHighwayHead,
  encodeSegHead,
} from "../src/highway/head.js";
import {
  HIGHWAY_FRAME_CLOSE,
  HIGHWAY_FRAME_HEADER_SIZE,
  HIGHWAY_FRAME_MIN_SIZE,
  HIGHWAY_FRAME_OPEN,
  packHighwayFrame,
  unpackHighwayFrame,
} from "../src/highway/frame.js";

test("a frame is a paren pair around a 9-byte big-endian header", () => {
  const head = Uint8Array.from([0xaa, 0xbb, 0xcc]);
  const body = Uint8Array.from([0x01, 0x02]);

  const frame = packHighwayFrame(head, body);

  // Total = 9 header + 3 head + 2 body + 1 close.
  assert.equal(frame.length, 15);
  assert.equal(frame[0], HIGHWAY_FRAME_OPEN, "opens with '(' = 0x28");
  assert.equal(frame[14], HIGHWAY_FRAME_CLOSE, "closes with ')' = 0x29");

  // BIG-endian, asserted against literal bytes. A little-endian writer produces
  // `03000000` here, which round-trips but is rejected by every highway server.
  assert.deepEqual([...frame.subarray(1, 5)], [0x00, 0x00, 0x00, 0x03], "head length is BE");
  assert.deepEqual([...frame.subarray(5, 9)], [0x00, 0x00, 0x00, 0x02], "body length is BE");

  assert.deepEqual([...frame.subarray(9, 12)], [...head], "head follows the header");
  assert.deepEqual([...frame.subarray(12, 14)], [...body], "body follows the head");
});

test("a head longer than 255 still encodes its length big-endian", () => {
  // 300 = 0x012C, so the first two length bytes are non-zero. A one-byte-at-a-time
  // writer that reversed only the low bytes would pass the small case above.
  const head = new Uint8Array(300).fill(0x5a);
  const frame = packHighwayFrame(head, new Uint8Array(0));
  assert.deepEqual([...frame.subarray(1, 5)], [0x00, 0x00, 0x01, 0x2c]);
  assert.deepEqual([...frame.subarray(5, 9)], [0x00, 0x00, 0x00, 0x00], "empty body is zero");
});

test("pack/unpack round-trips both halves", () => {
  const head = Uint8Array.from([1, 2, 3, 4, 5]);
  const body = Uint8Array.from([9, 8, 7]);
  const { head: gotHead, body: gotBody } = unpackHighwayFrame(packHighwayFrame(head, body));
  assert.deepEqual([...gotHead], [...head]);
  assert.deepEqual([...gotBody], [...body]);
});

test("the final frame of an upload has an empty body", () => {
  // A completed upload is signalled by a frame whose body is empty, not by an
  // absent frame. Conflating the two leaves the server waiting for one more chunk.
  const { head, body } = unpackHighwayFrame(packHighwayFrame(Uint8Array.from([0xff]), new Uint8Array(0)));
  assert.deepEqual([...head], [0xff]);
  assert.equal(body.length, 0);
});

test("unpack returns views, not copies", () => {
  // Documented behaviour: the caller passes `head` straight to a decoder and the
  // chunk to a hasher, so copying a 1 MiB body per chunk would double peak memory.
  const head = Uint8Array.from([1, 2]);
  const body = Uint8Array.from([3, 4]);
  const frame = packHighwayFrame(head, body);
  const unpacked = unpackHighwayFrame(frame);
  assert.equal(unpacked.head.buffer, frame.buffer, "head is a view onto the frame");
  assert.equal(unpacked.body.buffer, frame.buffer, "body is a view onto the frame");
});

test("a frame with wrong delimiters is rejected with the reference's wording", () => {
  const good = packHighwayFrame(Uint8Array.from([1]), Uint8Array.from([2]));

  const badOpen = Uint8Array.from(good);
  badOpen[0] = 0x00;
  assert.throws(() => unpackHighwayFrame(badOpen), /invalid highway response frame/);

  const badClose = Uint8Array.from(good);
  badClose[badClose.length - 1] = 0x00;
  assert.throws(() => unpackHighwayFrame(badClose), /invalid highway response frame/);
});

test("a frame shorter than the minimum is rejected", () => {
  // An empty response body is the common case here (the server answered with a
  // close and no frame), and it must be an error rather than a zero-length result.
  assert.throws(() => unpackHighwayFrame(new Uint8Array(0)), /invalid highway response frame/);
  assert.throws(
    () => unpackHighwayFrame(new Uint8Array(HIGHWAY_FRAME_MIN_SIZE - 1)),
    /invalid highway response frame/,
  );
});

test("the frame constants match the reference", () => {
  // These are wire facts, not tuning knobs: 0x28/0x29 are the literal parens and 9
  // is 1 + 4 + 4. A change here would silently break every upload.
  assert.equal(HIGHWAY_FRAME_OPEN, 0x28);
  assert.equal(HIGHWAY_FRAME_CLOSE, 0x29);
  assert.equal(HIGHWAY_FRAME_HEADER_SIZE, 9);
  assert.equal(HIGHWAY_FRAME_MIN_SIZE, 10);
});

test("the head codec is byte-identical to the reference for a real upload", () => {
  // Golden bytes captured from `protobuf_encode_ReqDataHighwayHead` in
  // reference/index.mjs:32230, evaluated with the reference's own generated helpers.
  // A round-trip test cannot catch a wrong field NUMBER (encoder and decoder would
  // agree), so the only meaningful assertion is against these bytes.
  //
  // Two field numbers were wrong on the first attempt and both were caught here, not
  // by any structural test: `LoginSigHead.appId` is field 3 (not 2), and `uin` is a
  // string field (not a varint). Both produce a head the server rejects with a
  // generic parse error.
  const head = encodeReqDataHighwayHead({
    msgBaseHead: {
      version: 1,
      uin: "10001",
      command: HIGHWAY_COMMAND_UPLOAD,
      seq: 0,
      retryTimes: 0,
      appId: HIGHWAY_APP_ID,
      dataFlag: HIGHWAY_DATA_FLAG_UPLOAD,
      commandId: 1004,
    },
    msgSegHead: {
      serviceId: 0,
      filesize: 1048576n,
      dataOffset: 0n,
      dataLength: 1048576,
      retCode: 0,
      serviceTicket: new Uint8Array([1, 2, 3]),
      flag: 0,
      md5: new Uint8Array([0xaa, 0xbb]),
      fileMd5: new Uint8Array([0xcc, 0xdd]),
      cacheAddr: 0,
      cachePort: 0,
    },
    bytesReqExtendInfo: new Uint8Array(0),
    timestamp: 0n,
    msgLoginSigHead: { loginSigType: HIGHWAY_LOGIN_SIG_TYPE, appId: HIGHWAY_APP_ID },
  });
  assert.equal(
    Buffer.from(head).toString("hex"),
    "0a270801120a31303030311a0c50696355702e44617461557030c4acf8fa05381040ec07" +
      "1215108080402080804032030102034202aabb4a02ccdd2a08080818c4acf8fa05",
  );
});

test("cachePort is field 13 — a non-zero port proves it", () => {
  // This is the regression test for a latent bug: `cachePort` was written as field 11,
  // and because every NTV2 call site leaves it 0 (and `uint32` elides a zero), the
  // cachePort=0 golden in the test above matched either way.
  //
  // Golden from reference/index.mjs `__write_SegHead` with
  //   serviceTicket=[1,2,3,4], md5=16×0xaa, fileMd5=16×0xbb,
  //   cacheAddr=0x01020304, cachePort=8080
  // The decisive bytes are the trailing `68 90 3f` = tag 104 = field 13, value 8080.
  const seg = encodeSegHead({
    serviceId: 0,
    filesize: 1048576n,
    dataOffset: 0n,
    dataLength: 1048576,
    retCode: 0,
    serviceTicket: new Uint8Array([1, 2, 3, 4]),
    flag: 0,
    md5: new Uint8Array(16).fill(0xaa),
    fileMd5: new Uint8Array(16).fill(0xbb),
    cacheAddr: 0x01020304,
    cachePort: 8080,
  });
  assert.equal(
    Buffer.from(seg).toString("hex"),
    "10808040208080403204010203044210aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
      "4a10bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb508486880868903f",
  );
  // The tag byte for field 13 wire type 0 is 13*8 = 104 = 0x68. Field 11 would be 0x58.
  assert.ok(
    Buffer.from(seg).toString("hex").endsWith("68903f"),
    "trailing bytes must be field 13 (0x68), not field 11 (0x58)",
  );
});

test("LoginSigHead puts appId in field 3, skipping field 2", () => {
  // Same class of bug as cachePort above. Landing on field 2 produces
  // `10 c4acf8fa05`, which the server reads as an unknown field plus appId=0.
  const head = encodeLoginSigHead({ loginSigType: 8, appId: HIGHWAY_APP_ID });
  assert.equal(Buffer.from(head).toString("hex"), "080818c4acf8fa05");
});
