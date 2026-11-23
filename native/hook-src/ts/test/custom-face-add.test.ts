// `AddCustomFace` — the whole four-step flow, against a REAL TCP highway server.
//
// ---------------------------------------------------------------------------
// What is fake here, and what is not
// ---------------------------------------------------------------------------
// Three fakes, one per network boundary, and nothing else:
//
//   1. the packet sender  — a scripted `sendRawPacket` (BDHExpressionRoam + HttpConn)
//   2. the highway server — a real `net.Server` that speaks HTTP/1.1 and captures the
//                           exact bytes it was sent
//   3. the file system    — a real temp file, so `loadBinarySource` exercises its
//                           local-file path rather than a stub
//
// The md5, the emojiId formatting, all three protobuf encoders, the frame packer, the
// request path/headers and the status check are the production code.
//
// ---------------------------------------------------------------------------
// Why the field numbers are asserted against an INDEPENDENT writer
// ---------------------------------------------------------------------------
// The single most dangerous failure in this feature is a wrong FIELD NUMBER, and it is
// invisible to a round-trip test: an encoder and a decoder that share the mistake agree
// perfectly with each other and disagree with QQ. So:
//
//   * the expected request bytes are built here with `ProtoWriter` (the repo's raw
//     primitive) writing literal tags — not by calling the encoder under test;
//   * those literals are additionally pinned to goldens produced by the REFERENCE's own
//     generated encoders (see the `REFERENCE_GOLDENS` block);
//   * the frame head is decoded by an independent little reader in this file.
//
// `FavEmojiHighwayHead` gets the same treatment, and it needs it more: its
// `baseHead.filesize` sits at field 6, where the standard `DataHighwayHead` has
// `appId`. Sending the standard head here would put `appId: 25` on the wire and no size
// at all, and a round-trip against `head.ts` would never notice.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";
import { ProfileApi, md5FromEmojiId } from "../src/bridge/apis/profile.js";
import { ProtoWriter } from "../src/oidb/wire.js";
import {
  BDH_EXPRESSION_ROAM_SERVICE,
  buildBDHExpressionRoamReq,
  buildFavEmojiHighwayHead,
  customFaceHighwayPath,
  decodeBDHExpressionRoamResp,
  encodeBDHExpressionRoamReq,
  encodeFavEmojiHighwayHead,
  makeCustomFaceEmojiId,
} from "../src/oidb/services/index.js";

const SELF_UIN = "10001";

// The fixture image. Deliberately NOT a real PNG: nothing here decodes it, and a short
// deterministic blob makes the md5 and every byte assertion readable in a failure.
const IMAGE = Buffer.from("custom-face-fixture-bytes", "utf8");
const IMAGE_MD5 = new Uint8Array(createHash("md5").update(IMAGE).digest());
const IMAGE_MD5_HEX = Buffer.from(IMAGE_MD5).toString("hex").toUpperCase();
/** `D36A5CC491198B2E29C94E1D3F076750` for the fixture above. */
const EXPECTED_EMOJI_ID = `${SELF_UIN}_0_0_0_${IMAGE_MD5_HEX}_0_0`;
const TOKEN = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

// ===========================================================================
// Goldens, produced by the REFERENCE's own generated encoders
// ===========================================================================
//
// `reference/index.mjs`'s `protobuf_encode_BDHExpressionRoamReq` /
// `protobuf_encode_FavEmojiHighwayHead` are the authority, so these hex strings came out
// of THEM, not out of this port. They pin the field numbers below to a source that was
// never derived from the code under test.
//
// Regenerating them is a deliberate act: slice reference/index.mjs:317322-319241, feed
// the same uin/md5/size/token, and diff. A change here means the reference changed.
const REFERENCE_GOLDENS = {
  /** field1=3, field2=1, inner{...}, field7=9, tail{...} at field 1001. */
  reqBody:
    "080310011A2510914E2210D36A5CC491198B2E29C94E1D3F0767502819380248016A05312E302E308001013809CA3E070A031A01301001",
  /** baseHead(field 6 = filesize!) + segHead(field 4 = uint64) + emojiIdWrap + field8=9. */
  head:
    "0A1F0801120531303030311A0C50696355702E4461746155702001301938104009122E101920193204DEADBEEF4210D36A5CC491198B2E29C94E1D3F0767504A10D36A5CC491198B2E29C94E1D3F0767501A320A3031303030315F305F305F305F44333641354343343931313938423245323943393445314433463037363735305F305F304009",
} as const;

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex").toUpperCase();

// ===========================================================================
// An independent protobuf reader (deliberately not `ProtoReader`)
// ===========================================================================
//
// Using the repo's own reader here would let a shared tag convention hide a wrong field
// number. This one is 40 lines and shares no code with `src/oidb/wire.ts`.

interface Field {
  field: number;
  wire: number;
  /** varint value, when `wire === 0`. */
  varint?: bigint;
  /** raw payload, when `wire === 2`. */
  bytes?: Uint8Array;
}

function readFields(bytes: Uint8Array): Field[] {
  const fields: Field[] = [];
  let pos = 0;
  const varint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      const byte = bytes[pos];
      if (byte === undefined) throw new Error("truncated varint");
      pos += 1;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
  };
  while (pos < bytes.length) {
    const tag = Number(varint());
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire === 0) {
      fields.push({ field, wire, varint: varint() });
    } else if (wire === 2) {
      const length = Number(varint());
      if (pos + length > bytes.length) throw new Error(`truncated field ${field}`);
      fields.push({ field, wire, bytes: bytes.subarray(pos, pos + length) });
      pos += length;
    } else {
      throw new Error(`unexpected wire type ${wire} for field ${field}`);
    }
  }
  return fields;
}

const fieldNumbers = (bytes: Uint8Array): number[] => readFields(bytes).map((f) => f.field);
const onlyField = (bytes: Uint8Array, field: number): Field => {
  const matches = readFields(bytes).filter((f) => f.field === field);
  if (matches.length !== 1) throw new Error(`field ${field}: expected 1 occurrence, got ${matches.length}`);
  return matches[0]!;
};
const subMessage = (bytes: Uint8Array, field: number): Uint8Array => {
  const found = onlyField(bytes, field).bytes;
  if (!found) throw new Error(`field ${field} is not length-delimited`);
  return found;
};
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

// ===========================================================================
// The independent EXPECTED request encoder
// ===========================================================================
//
// Hand-written tags, literal numbers, no import from `0x902e-profile.ts`. The tail is the
// interesting one: its tag is TWO bytes (`CA 3E` = field 1001, wire type 2), and a
// one-byte-tag guess (`0x4A` = field 9) produces a request QQ parses as something else
// entirely.
function expectedRequestBytes(uin: bigint, md5: Uint8Array, filesize: number): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(1, 3); // field1
  w.uint32(2, 1); // field2
  // inner, field 3
  const inner = new ProtoWriter();
  inner.uint64(2, uin); //        uin         (field1 = 0, dropped)
  inner.bytes(4, md5); //         md5
  inner.uint32(5, filesize); //   filesize
  inner.uint32(7, 2); //          field7
  inner.uint32(9, 1); //          field9      (field3 = 0, field8 = 0 dropped)
  inner.string(13, "1.0.0"); //   ver         <-- 13, not 10 or 11
  inner.uint32(16, 1); //         field16     <-- two-byte tag `80 01`
  w.message(3, inner.finish());
  w.uint32(7, 9); // field7
  // tail, field 1001
  const tailInner = new ProtoWriter();
  tailInner.string(3, "0"); //    field3 = "0", fields 1 and 2 zero-dropped
  const tail = new ProtoWriter();
  tail.message(1, tailInner.finish());
  tail.uint32(2, 1);
  w.message(1001, tail.finish());
  return w.finish();
}

// ===========================================================================
// The fake highway server
// ===========================================================================

interface CapturedPost {
  requestLine: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

interface FakeHighway {
  host: string;
  port: number;
  posts: CapturedPost[];
  close: () => Promise<void>;
}

/**
 * A real TCP server that answers the first POST with `status`.
 *
 * `status` is a parameter because the `!ok` path is one of the things under test, and a
 * 4xx must be distinguishable from a transport failure: the reference throws
 * `highway upload failed: HTTP 403` for the former and the transport's own message for
 * the latter.
 */
async function startFakeHighway(status = 200): Promise<FakeHighway> {
  const posts: CapturedPost[] = [];
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const headerText = buffer.subarray(0, headerEnd).toString("ascii");
      const lines = headerText.split("\r\n");
      const requestLine = lines[0] ?? "";
      const headers: Record<string, string> = {};
      for (const line of lines.slice(1)) {
        const colon = line.indexOf(":");
        if (colon < 0) continue;
        headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
      }
      const contentLength = Number.parseInt(headers["content-length"] ?? "0", 10);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + contentLength) return;
      const body = Uint8Array.from(buffer.subarray(bodyStart, bodyStart + contentLength));
      buffer = buffer.subarray(bodyStart + contentLength);
      posts.push({ requestLine, headers, body });

      // The emoji store answers with an empty body — it is not a chunk protocol, so
      // there is no `RespDataHighwayHead` frame to echo. `Content-Length: 0` is what
      // makes `readHttpResponse` resolve on the header rather than wait for bytes.
      socket.write(Buffer.from(`HTTP/1.1 ${status} Whatever\r\nContent-Length: 0\r\n\r\n`, "ascii"));
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return {
    host: "127.0.0.1",
    port: address.port,
    posts,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

// ===========================================================================
// The fake packet sender
// ===========================================================================

/** Encode the `BDHExpressionRoam` response, with `token` at field 8 of `inner`. */
function roamResponse(options: { token?: Uint8Array | null } = {}): Uint8Array {
  const inner = new ProtoWriter();
  if (options.token !== null) inner.bytes(8, options.token ?? TOKEN);
  const outer = new ProtoWriter();
  outer.message(3, inner.finish());
  return outer.finish();
}

/** The `HttpConn.0x6ff_501` response naming the fake highway server. */
function sessionResponse(host: string, port: number): Uint8Array {
  const octets = host.split(".").map((part) => Number.parseInt(part, 10));
  const ipNumber =
    (octets[0]! | (octets[1]! << 8) | (octets[2]! << 16) | (octets[3]! << 24)) >>> 0;
  const ipBuffer = Buffer.alloc(4);
  ipBuffer.writeUInt32LE(ipNumber, 0);

  const httpConn = new ProtoWriter();
  httpConn.bytes(1, new Uint8Array([7, 7, 7, 7])); // sigSession
  const addr = new ProtoWriter();
  addr.uint32(3, port);
  // `ip` is **fixed32** (wire type 5) — the only non-varint field in this family, so the
  // five bytes are emitted by hand: tag `0x15` = (field 2 << 3) | 5.
  const addrBytes = Buffer.concat([Buffer.from(addr.finish()), Buffer.from([0x15]), ipBuffer]);
  const info = new ProtoWriter();
  info.uint32(1, 1); // serviceType 1 = upload
  info.message(2, addrBytes);
  httpConn.message(3, info.finish());

  const outer = new ProtoWriter();
  outer.message(1281, httpConn.finish()); // nested under OIDB field 1281
  return outer.finish();
}

interface SentPacket {
  wireName: string;
  body: Uint8Array;
}

type Responder = (wireName: string, body: Uint8Array) => Uint8Array | undefined | { failed: string };

function makeBridge(
  respond: Responder,
  sent: SentPacket[] = [],
): Bridge {
  const identity = new MemoryIdentity(SELF_UIN, "bot");
  const bridge = new Bridge(identity);
  bridge.bindPid(1, {
    sendPacket: async (wireName: string, body: Uint8Array) => {
      sent.push({ wireName, body });
      const response = respond(wireName, body);
      if (response === undefined) {
        return { success: false, gotResponse: false, errorMessage: "scripted: nothing to send" };
      }
      if (!(response instanceof Uint8Array)) {
        return { success: false, gotResponse: false, errorMessage: response.failed };
      }
      return { success: true, gotResponse: true, errorCode: 0, responseData: response };
    },
  });
  return bridge;
}

/** A temp file holding `IMAGE`, plus a `cleanup`. */
async function withImageFile<T>(run: (filePath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hz-customface-"));
  const filePath = path.join(dir, "emoji.bin");
  await writeFile(filePath, IMAGE);
  try {
    return await run(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The happy-path responder: a token, then a session naming `highway`. */
const happyResponder =
  (highway: { host: string; port: number }): Responder =>
  (wireName) => {
    if (wireName === BDH_EXPRESSION_ROAM_SERVICE) return roamResponse();
    if (wireName === "HttpConn.0x6ff_501") return sessionResponse(highway.host, highway.port);
    return undefined;
  };

// ===========================================================================
// 1. The emojiId format
// ===========================================================================

test("emojiId is uin_0_0_0_<UPPERCASE MD5>_0_0 with seven underscore segments", () => {
  const emojiId = makeCustomFaceEmojiId(SELF_UIN, IMAGE_MD5);
  assert.equal(emojiId, EXPECTED_EMOJI_ID);
  assert.equal(emojiId, "10001_0_0_0_D36A5CC491198B2E29C94E1D3F076750_0_0");

  const parts = emojiId.split("_");
  assert.equal(parts.length, 7, "the id is seven underscore-separated segments");
  assert.deepEqual(parts, ["10001", "0", "0", "0", IMAGE_MD5_HEX, "0", "0"]);

  // The MD5 segment is hex-uppercase, and it is the ONLY segment with letters.
  const md5Segment = parts[4]!;
  assert.equal(md5Segment.length, 32);
  assert.match(md5Segment, /^[0-9A-F]{32}$/);
  assert.equal(md5Segment, md5Segment.toUpperCase());
  assert.notEqual(md5Segment, md5Segment.toLowerCase(), "uppercase is asserted, not incidental");

  // Round-trips through the reader used by `resolveCustomFace`, which is what makes the
  // uploaded face findable in the saved-sticker list afterwards.
  assert.equal(md5FromEmojiId(emojiId), IMAGE_MD5_HEX);
});

test("a bigint uin renders without an exponent or a trailing n", () => {
  // 64-bit uins are real. `String(1n)` is "1", and template interpolation of a bigint
  // does NOT produce "1n" — asserting it keeps a future refactor honest.
  const emojiId = makeCustomFaceEmojiId(1094955843n, IMAGE_MD5);
  assert.ok(emojiId.startsWith("1094955843_0_0_0_"), emojiId);
  assert.equal(emojiId.split("_")[0], "1094955843");
});

// ===========================================================================
// 2. The request body, field by field
// ===========================================================================

test("the request body's field numbers and values match an independent assembly", () => {
  const built = encodeBDHExpressionRoamReq(
    buildBDHExpressionRoamReq({ uin: SELF_UIN, md5: IMAGE_MD5, filesize: IMAGE.length }),
  );

  // (a) Byte-for-byte against an independent writer.
  assert.equal(hex(built), hex(expectedRequestBytes(10001n, IMAGE_MD5, IMAGE.length)));

  // (b) And against the reference's own encoder output.
  assert.equal(hex(built), REFERENCE_GOLDENS.reqBody);

  // (c) Structure, so a failure names the offending field rather than a hex offset.
  assert.deepEqual(fieldNumbers(built), [1, 2, 3, 7, 1001]);
  assert.equal(onlyField(built, 1).varint, 3n);
  assert.equal(onlyField(built, 2).varint, 1n);
  assert.equal(onlyField(built, 7).varint, 9n);

  const inner = subMessage(built, 3);
  // `field1`, `field3` and `field8` are all ZERO in the reference's request, and the
  // generated encoder drops zero-valued scalars — so their tags are absent, not zero.
  assert.deepEqual(fieldNumbers(inner), [2, 4, 5, 7, 9, 13, 16]);
  assert.equal(onlyField(inner, 2).varint, 10001n, "inner.uin is field 2");
  assert.equal(hex(onlyField(inner, 4).bytes!), IMAGE_MD5_HEX, "inner.md5 is field 4");
  assert.equal(onlyField(inner, 5).varint, BigInt(IMAGE.length), "inner.filesize is field 5");
  assert.equal(onlyField(inner, 7).varint, 2n, "inner.field7 is 2");
  assert.equal(onlyField(inner, 9).varint, 1n, "inner.field9 is 1");
  assert.equal(text(onlyField(inner, 13).bytes!), "1.0.0", "inner.ver is field 13");
  assert.equal(onlyField(inner, 16).varint, 1n, "inner.field16 is 1");

  const tail = subMessage(built, 1001);
  assert.deepEqual(fieldNumbers(tail), [1, 2]);
  assert.equal(onlyField(tail, 2).varint, 1n, "tail.field2 is 1");
  assert.deepEqual(fieldNumbers(subMessage(tail, 1)), [3], "tail.inner carries only field3");
  assert.equal(text(onlyField(subMessage(tail, 1), 3).bytes!), "0");
});

test("the tail is at field 1001, which needs a two-byte tag", () => {
  const built = encodeBDHExpressionRoamReq(
    buildBDHExpressionRoamReq({ uin: SELF_UIN, md5: IMAGE_MD5, filesize: IMAGE.length }),
  );
  const bytes = Buffer.from(built);
  // `CA 3E` = varint 8010 = (1001 << 3) | 2. A field-9 guess would be the single byte
  // `0x4A`, which is a different message.
  assert.ok(bytes.includes(Buffer.from([0xca, 0x3e])), "the tail tag is CA 3E");
  assert.deepEqual(fieldNumbers(built).includes(1001), true);
});

test("the md5 in the request is RAW BYTES, not a hex string", () => {
  const built = encodeBDHExpressionRoamReq(
    buildBDHExpressionRoamReq({ uin: SELF_UIN, md5: IMAGE_MD5, filesize: IMAGE.length }),
  );
  const md5Field = onlyField(subMessage(built, 3), 4).bytes!;
  // 16 raw bytes, not 32 ASCII hex chars.
  assert.equal(md5Field.length, 16);
  assert.deepEqual([...md5Field], [...IMAGE_MD5]);
  assert.notEqual(text(md5Field), IMAGE_MD5_HEX);
  // A hex-string mistake would be 32 bytes and would appear in the wire bytes as ASCII.
  assert.ok(!Buffer.from(built).toString("latin1").includes(IMAGE_MD5_HEX));
});

// ===========================================================================
// 3. The highway head, field by field
// ===========================================================================

test("the highway head carries commandId 9, PicUp.DataUp and field8 9", () => {
  const head = encodeFavEmojiHighwayHead(
    buildFavEmojiHighwayHead({
      uin: SELF_UIN,
      emojiId: EXPECTED_EMOJI_ID,
      md5: IMAGE_MD5,
      filesize: IMAGE.length,
      serviceTicket: TOKEN,
    }),
  );
  assert.equal(hex(head), REFERENCE_GOLDENS.head);

  assert.deepEqual(fieldNumbers(head), [1, 2, 3, 8], "field4 is 0 and so is dropped");

  const base = subMessage(head, 1);
  // NO appId, NO loginSigHead — and `filesize` at field 6, where the standard
  // `DataHighwayHead` keeps `appId`.
  assert.deepEqual(fieldNumbers(base), [1, 2, 3, 4, 6, 7, 8]);
  assert.equal(onlyField(base, 1).varint, 1n, "version");
  assert.equal(text(onlyField(base, 2).bytes!), SELF_UIN, "uin is a STRING field");
  assert.equal(text(onlyField(base, 3).bytes!), "PicUp.DataUp", "command");
  assert.equal(onlyField(base, 4).varint, 1n, "seq");
  assert.equal(onlyField(base, 6).varint, BigInt(IMAGE.length), "filesize at field 6");
  assert.equal(onlyField(base, 7).varint, 16n, "dataFlag 16");
  assert.equal(onlyField(base, 8).varint, 9n, "commandId 9");

  const seg = subMessage(head, 2);
  assert.deepEqual(fieldNumbers(seg), [2, 4, 6, 8, 9], "serviceId 0 and dataOffset 0 are dropped");
  assert.equal(onlyField(seg, 2).varint, BigInt(IMAGE.length), "segHead.filesize");
  assert.equal(onlyField(seg, 4).varint, BigInt(IMAGE.length), "segHead.dataLength (uint64)");
  assert.deepEqual([...onlyField(seg, 6).bytes!], [...TOKEN], "serviceTicket is the token");
  assert.deepEqual([...onlyField(seg, 8).bytes!], [...IMAGE_MD5], "md5 is raw bytes");
  assert.deepEqual([...onlyField(seg, 9).bytes!], [...IMAGE_MD5], "fileMd5 is the same md5");

  assert.equal(text(onlyField(subMessage(head, 3), 1).bytes!), EXPECTED_EMOJI_ID);
  assert.equal(onlyField(head, 8).varint, 9n, "field8 duplicates commandId at the outer level");
});

test("a zero field4 and a zero dataOffset are dropped, not written as 0", () => {
  // Both are `!= null && !== 0` in the reference's generated encoder, so an explicit 0
  // is an ABSENT field. Writing `20 00` would add a byte and is not what QQ's client
  // sends.
  const head = encodeFavEmojiHighwayHead(
    buildFavEmojiHighwayHead({
      uin: SELF_UIN,
      emojiId: EXPECTED_EMOJI_ID,
      md5: IMAGE_MD5,
      filesize: IMAGE.length,
      serviceTicket: TOKEN,
    }),
  );
  const bytes = Buffer.from(head);
  assert.ok(!bytes.includes(Buffer.from([0x20, 0x00])), "no field4 = 0 on the wire");
  assert.deepEqual(fieldNumbers(subMessage(head, 2)), [2, 4, 6, 8, 9], "no dataOffset tag");
});

// ===========================================================================
// 4. The response decoder
// ===========================================================================

test("the decoder reads the token from field 8 of inner", () => {
  const decoded = decodeBDHExpressionRoamResp(roamResponse());
  assert.deepEqual([...decoded.inner!.token!], [...TOKEN]);
  assert.equal(decoded.inner!.field1, null);
});

test("the decoder accepts a packed field6/field7 as well as the unpacked form", () => {
  // The reference's generated decoder handles both tags (48/50 for f6, 56/58 for f7).
  // A decoder that only accepts one reports an empty list for the other, silently.
  const inner = new ProtoWriter();
  // `field6` packed: one length-delimited run of varints.
  inner.bytes(6, new Uint8Array([1, 2, 3]));
  // `field7` unpacked: one tag per value.
  inner.uint32(7, 4);
  inner.uint32(7, 5);
  // `field1` is a plain varint at field 1, which is what proves the sub-message parsed
  // as a message rather than as an opaque blob.
  inner.uint32(1, 7);
  const outer = new ProtoWriter();
  outer.message(3, inner.finish());
  const decoded = decodeBDHExpressionRoamResp(outer.finish());
  assert.deepEqual(decoded.inner!.field6, [1, 2, 3], "packed field6 decodes");
  assert.deepEqual(decoded.inner!.field7, [4, 5], "unpacked field7 decodes");
  assert.equal(decoded.inner!.field1, 7);
});

// ===========================================================================
// 5. The full flow against a real TCP server
// ===========================================================================

test("the happy path uploads one frame and returns the computed emojiId", async () => {
  const highway = await startFakeHighway();
  const sent: SentPacket[] = [];
  const bridge = makeBridge(happyResponder(highway), sent);
  const api = new ProfileApi(bridge);
  try {
    await withImageFile(async (filePath) => {
      const emojiId = await api.addCustomFace(filePath);
      assert.equal(emojiId, EXPECTED_EMOJI_ID);
    });

    // --- exactly two packets, in the REFERENCE's order ----------------------
    // `reference/index.mjs:319254` fetches the highway session BEFORE it builds the roam
    // request. The order is observable: an unobtainable server list fails without
    // spending a roam token.
    assert.equal(sent.length, 2);
    assert.equal(sent[0]!.wireName, "HttpConn.0x6ff_501");
    assert.equal(sent[1]!.wireName, "ImgStore.BDHExpressionRoam");
    // The roam request is the one built from the image; assert it carries the real md5.
    assert.equal(
      hex(sent[1]!.body),
      hex(expectedRequestBytes(10001n, IMAGE_MD5, IMAGE.length)),
    );

    // --- exactly one POST ---------------------------------------------------
    assert.equal(highway.posts.length, 1);
    const post = highway.posts[0]!;
    assert.equal(
      post.requestLine,
      `POST ${customFaceHighwayPath(SELF_UIN)} HTTP/1.1`,
      "the path is the cmdId-0x6FF0087 httpconn route with the uin",
    );
    assert.match(post.requestLine, /htcmd=0x6FF0087/);
    assert.match(post.requestLine, /uin=10001/);

    // --- headers, including the reference's IE user agent -------------------
    assert.equal(post.headers["user-agent"], "Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2)");
    assert.equal(post.headers["accept"], "*/*");
    assert.equal(post.headers["cache-control"], "no-cache");
    assert.equal(post.headers["pragma"], "no-cache");
    assert.equal(post.headers["connection"], "keep-alive");
    assert.equal(post.headers["host"], `${highway.host}:${highway.port}`);

    // --- the frame ----------------------------------------------------------
    // `packHighwayFrame`: `(` + BE32 headLen + BE32 bodyLen + head + body + `)`.
    const frame = post.body;
    assert.equal(frame[0], 0x28, "frame opens with '('");
    assert.equal(frame[frame.length - 1], 0x29, "frame closes with ')'");
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const headLength = view.getUint32(1, false);
    const bodyLength = view.getUint32(5, false);
    assert.equal(bodyLength, IMAGE.length, "the body is the raw image");
    const head = frame.subarray(9, 9 + headLength);
    const body = frame.subarray(9 + headLength, 9 + headLength + bodyLength);
    assert.deepEqual([...body], [...IMAGE], "the image bytes are sent verbatim, not re-encoded");
    assert.equal(hex(head), REFERENCE_GOLDENS.head);

    // `commandId: 9` and `field8: 9` INSIDE the frame that actually went out — read with
    // the independent reader, not with the encoder's own assumptions.
    const base = subMessage(head, 1);
    assert.equal(onlyField(base, 8).varint, 9n, "frame commandId is 9");
    assert.equal(text(onlyField(base, 3).bytes!), "PicUp.DataUp");
    assert.equal(onlyField(head, 8).varint, 9n, "frame field8 is 9");
  } finally {
    await bridge.dispose();
    await highway.close();
  }
});

test("a base64:// source works without touching the file system", async () => {
  const highway = await startFakeHighway();
  const bridge = makeBridge(happyResponder(highway));
  const api = new ProfileApi(bridge);
  try {
    const emojiId = await api.addCustomFace(`base64://${IMAGE.toString("base64")}`);
    assert.equal(emojiId, EXPECTED_EMOJI_ID);
    assert.equal(highway.posts.length, 1);
    // The frame's LAST byte is the `)` delimiter, so the body is not simply the frame's
    // tail — slice it out by the declared lengths.
    const frame = highway.posts[0]!.body;
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const headLength = view.getUint32(1, false);
    const bodyLength = view.getUint32(5, false);
    assert.equal(bodyLength, IMAGE.length);
    assert.deepEqual(
      [...frame.subarray(9 + headLength, 9 + headLength + bodyLength)],
      [...IMAGE],
    );
  } finally {
    await bridge.dispose();
    await highway.close();
  }
});

// ===========================================================================
// 6. The token check
// ===========================================================================

test("a response without a token throws the reference's exact message", async () => {
  const highway = await startFakeHighway();
  const bridge = makeBridge((wireName) => {
    if (wireName === BDH_EXPRESSION_ROAM_SERVICE) return roamResponse({ token: null });
    if (wireName === "HttpConn.0x6ff_501") return sessionResponse(highway.host, highway.port);
    return undefined;
  });
  const api = new ProfileApi(bridge);
  try {
    await withImageFile(async (filePath) => {
      await assert.rejects(() => api.addCustomFace(filePath), (error: Error) => {
        assert.equal(error.message, "BDHExpressionRoam: response missing token (field8)");
        return true;
      });
    });
    // The upload must NOT happen: no token, no POST.
    assert.equal(highway.posts.length, 0, "no highway POST is attempted without a token");
  } finally {
    await bridge.dispose();
    await highway.close();
  }
});

test("an EMPTY token counts as missing", async () => {
  // The reference tests `!token`, which is true for a zero-length Uint8Array. A
  // `typeof token === "undefined"` check would let an empty ticket through and the
  // server would reject the upload with nothing useful to say.
  const highway = await startFakeHighway();
  const bridge = makeBridge((wireName) => {
    if (wireName === BDH_EXPRESSION_ROAM_SERVICE) return roamResponse({ token: new Uint8Array(0) });
    if (wireName === "HttpConn.0x6ff_501") return sessionResponse(highway.host, highway.port);
    return undefined;
  });
  const api = new ProfileApi(bridge);
  try {
    await withImageFile(async (filePath) => {
      await assert.rejects(
        () => api.addCustomFace(filePath),
        /BDHExpressionRoam: response missing token \(field8\)/,
      );
    });
    assert.equal(highway.posts.length, 0);
  } finally {
    await bridge.dispose();
    await highway.close();
  }
});

test("no packet response at all reports the gotResponse message, not the token one", async () => {
  // The order of the three checks is observable: `gotResponse` has its own message, and
  // a caller debugging "no response" must not be told the token was missing.
  const sent: SentPacket[] = [];
  const bridge = makeBridge(() => undefined, sent);
  const api = new ProfileApi(bridge);
  try {
    await withImageFile(async (filePath) => {
      await assert.rejects(() => api.addCustomFace(filePath), (error: Error) => {
        assert.equal(error.message, "scripted: nothing to send");
        return true;
      });
    });
    assert.equal(sent.length, 1, "it fails on the first packet, before any session fetch");
  } finally {
    await bridge.dispose();
  }
});

// ===========================================================================
// 7. The !ok path
// ===========================================================================

test("a non-2xx highway response throws highway upload failed: HTTP <status>", async () => {
  const highway = await startFakeHighway(403);
  const bridge = makeBridge(happyResponder(highway));
  const api = new ProfileApi(bridge);
  try {
    await withImageFile(async (filePath) => {
      await assert.rejects(() => api.addCustomFace(filePath), (error: Error) => {
        assert.equal(error.message, "highway upload failed: HTTP 403");
        return true;
      });
    });
    assert.equal(highway.posts.length, 1, "the POST was attempted; the STATUS is what failed");
  } finally {
    await bridge.dispose();
    await highway.close();
  }
});

test("a 500 is likewise a failure, and the status is carried verbatim", async () => {
  const highway = await startFakeHighway(500);
  const bridge = makeBridge(happyResponder(highway));
  const api = new ProfileApi(bridge);
  try {
    await withImageFile(async (filePath) => {
      await assert.rejects(() => api.addCustomFace(filePath), /^Error: highway upload failed: HTTP 500$/);
    });
  } finally {
    await bridge.dispose();
    await highway.close();
  }
});

test("a 204 still counts as ok, because `ok` is 200-299", async () => {
  // The emoji store's success reply may legitimately carry no body (`204`). Treating
  // only `200` as success would fail a correct upload.
  const highway = await startFakeHighway(204);
  const bridge = makeBridge(happyResponder(highway));
  const api = new ProfileApi(bridge);
  try {
    await withImageFile(async (filePath) => {
      assert.equal(await api.addCustomFace(filePath), EXPECTED_EMOJI_ID);
    });
  } finally {
    await bridge.dispose();
    await highway.close();
  }
});

// ===========================================================================
// 8. The highway session is reused
// ===========================================================================

test("each upload fetches its OWN highway session, exactly as the reference does", async () => {
  // ⚠️ This is a FIDELITY assertion, not an efficiency one. Every other highway caller in
  // this port shares a `HighwaySessionCache` (5-minute TTL), and `ProfileApi` HAS one for
  // `setAvatar`. `addCustomFace` must NOT use it: the reference calls
  // `fetchHighwaySession(deps)` unconditionally at `reference/index.mjs:319254`, so a
  // second upload pays a second bootstrap. Caching here would be a silent divergence —
  // and worse, a stale `sig_session` fails the upload with an opaque server rejection.
  const highway = await startFakeHighway();
  const sent: SentPacket[] = [];
  const bridge = makeBridge(happyResponder(highway), sent);
  const api = new ProfileApi(bridge);
  try {
    await withImageFile(async (filePath) => {
      await api.addCustomFace(filePath);
      await api.addCustomFace(filePath);
    });
    const sessionFetches = sent.filter((packet) => packet.wireName === "HttpConn.0x6ff_501");
    assert.equal(sessionFetches.length, 2, "one bootstrap per upload, no cache");
    assert.equal(highway.posts.length, 2, "and one POST per upload");
    assert.equal(sent.length, 4, "2 x (session + roam)");
  } finally {
    await bridge.dispose();
    await highway.close();
  }
});

test("a failed session fetch never sends the roam packet", async () => {
  // The ordering assertion from the other side: `HttpConn` first means a session failure
  // aborts before a token is spent.
  const sent: SentPacket[] = [];
  const bridge = makeBridge((wireName) => {
    if (wireName === "HttpConn.0x6ff_501") return { failed: "HttpConn request failed" };
    return roamResponse();
  }, sent);
  const api = new ProfileApi(bridge);
  try {
    await withImageFile(async (filePath) => {
      await assert.rejects(() => api.addCustomFace(filePath), /HttpConn request failed/);
    });
    assert.deepEqual(sent.map((packet) => packet.wireName), ["HttpConn.0x6ff_501"]);
  } finally {
    await bridge.dispose();
  }
});
