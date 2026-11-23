// Tests for the media upload pipeline's orchestration.
//
// The wire encoders underneath this are covered by golden vectors elsewhere
// (`ntv2-upload.test.ts`, `highway-ext.test.ts`). What is tested HERE is the ordering
// and the two branches that decide whether bytes move at all:
//
//   1. Fast upload — an empty `uKey` in the response means the server already has the
//      file, so highway must NOT be contacted. Treating that as a failure makes
//      re-sending the same image fail, which is a common action.
//   2. The request actually carries the hashes as lowercase hex STRINGS and the file
//      size, because the server validates all three.
//
// A fake bridge that records its calls is enough: the pipeline's contract is "which
// packets, in which order, carrying what".

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  HIGHWAY_CMD_IDS,
  MEDIA_BUSINESS_TYPE,
  NTV2_REQUEST_IDS,
  NTV2_UPLOAD_COMMANDS,
  NTV2_UPLOAD_SERVICE_CMDS,
  decodeUploadResponse,
  encodeMsgInfo,
  uploadImage,
  uploadPtt,
  uploadVideo,
} from "../src/highway/pipeline.js";
import { ProtoReader, ProtoWriter, tagOf, WireType } from "../src/oidb/wire.js";

// ===========================================================================
// A minimal fake bridge
// ===========================================================================

interface RecordedPacket {
  serviceCmd: string;
  body: Uint8Array;
}

/**
 * Build a response body for `NTV2UploadRichMediaResp`.
 *
 * `uKey` empty means "fast upload succeeded". `ipv4s` omitted means no servers, which
 * is what a fast upload returns.
 */
function makeUploadResponse(options: {
  uKey: string;
  fileUuid?: string;
  ipv4s?: { outIp: number; outPort: number }[];
  /** Emit the legacy `compatQMsg` blob (field 8). Voice only, and c2c only in practice. */
  compatQMsg?: boolean;
}): Uint8Array {
  const body = new ProtoWriter();
  if (options.uKey !== "") body.string(1, options.uKey);

  for (const ipv4 of options.ipv4s ?? []) {
    const ipv4Writer = new ProtoWriter();
    ipv4Writer.uint32(1, ipv4.outIp);
    ipv4Writer.uint32(2, ipv4.outPort);
    body.message(3, ipv4Writer.finish());
  }

  // msgInfo { msgInfoBody { index { info { fileSize ... } fileUuid } picture {...} } }
  const info = new ProtoWriter();
  info.uint32(1, 3); // fileSize
  info.string(4, "a.jpg"); // fileName
  const index = new ProtoWriter();
  index.message(1, info.finish());
  if (options.fileUuid !== undefined) index.string(2, options.fileUuid);
  index.uint32(3, 1); // storeId
  const picture = new ProtoWriter();
  picture.string(1, "/download?fileid=x");
  picture.string(3, "multimedia.nt.qq.com.cn");
  const msgInfoBody = new ProtoWriter();
  msgInfoBody.message(1, index.finish());
  msgInfoBody.message(2, picture.finish());
  const msgInfo = new ProtoWriter();
  msgInfo.message(1, msgInfoBody.finish());
  body.message(6, msgInfo.finish());
  if (options.compatQMsg === true) body.bytes(8, new Uint8Array([1, 2, 3]));

  const response = new ProtoWriter();
  const respHead = new ProtoWriter();
  respHead.uint32(1, 0);
  response.message(1, respHead.finish());
  response.message(2, body.finish());
  return response.finish();
}

function makeFakeBridge(response: Uint8Array): {
  bridge: never;
  packets: RecordedPacket[];
  sessionFetches: () => number;
} {
  const packets: RecordedPacket[] = [];
  let sessionFetches = 0;
  const bridge = {
    identity: { uin: "10001" },
    sendRawPacket: async (serviceCmd: string, body: Uint8Array) => {
      packets.push({ serviceCmd, body });
      // The highway session bootstrap is a different wire command; count only that, so a
      // test can assert the fast-upload path never gets that far.
      const mediaCmds: string[] = Object.values(NTV2_UPLOAD_SERVICE_CMDS);
      if (!mediaCmds.includes(serviceCmd)) {
        sessionFetches += 1;
      }
      return {
        success: true,
        gotResponse: true,
        responseData: response,
        errorMessage: "",
      };
    },
  };
  return { bridge: bridge as never, packets, sessionFetches: () => sessionFetches };
}

// A 1x1 PNG. Small enough to inline, real enough that the magic-number sniffing and
// the dimension reader both take their real branches.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const baseSegment = {
  type: "image" as const,
  imageUrl: `base64://${PNG_1X1}`,
  summary: "[图片]",
};

test("a fast upload (empty uKey) never contacts highway", async () => {
  // The server already has the bytes. This is a SUCCESS path: the pipeline must skip
  // step 3 and still return a MsgInfo. A test that expects an error here would be
  // encoding the wrong contract.
  const { bridge, packets } = makeFakeBridge(makeUploadResponse({ uKey: "", fileUuid: "uuid-1" }));
  const result = await uploadImage(
    { bridge, isGroup: true, targetIdOrUid: "987654321" },
    baseSegment,
  );
  assert.equal(packets.length, 1, "exactly one packet: the upload request, no session bootstrap");
  assert.equal(packets[0]!.serviceCmd, NTV2_UPLOAD_SERVICE_CMDS.groupImage);
  assert.ok(result.msgInfo.length > 0, "MsgInfo is still produced");
});

test("the request carries the md5 and sha1 as lowercase hex strings", async () => {
  // Both are 32/40-character hex STRINGS on the wire, not raw digests. Sending raw
  // bytes makes the server reject the hash and the error names nothing useful.
  const { bridge, packets } = makeFakeBridge(makeUploadResponse({ uKey: "", fileUuid: "uuid-1" }));
  await uploadImage({ bridge, isGroup: true, targetIdOrUid: "987654321" }, baseSegment);

  // md5/sha1 of the actual 70-byte PNG above, as lowercase hex.
  const md5 = "1798dfee72ee01747e2ca57ff513e8ef";
  const sha1 = "9fb285daedf99a4dad5de09770de5fadf688d3ee";
  const hex = Buffer.from(packets[0]!.body).toString("hex");
  const asAsciiHex = (value: string) => Buffer.from(value, "utf8").toString("hex");

  // The load-bearing assertion: the hash appears as 32/40 ASCII CHARACTERS. If the
  // encoder had written the raw 16/20-byte digest the hex would differ, and the server
  // rejects the upload with nothing in the error naming the hash format.
  assert.ok(hex.includes(asAsciiHex(md5)), `md5 string not found in ${hex.slice(0, 160)}`);
  assert.ok(hex.includes(asAsciiHex(sha1)), "sha1 string not found");

  // And the file size is present as a varint: 70 = 0x46.
  const sizeTagged = tagOf(1, WireType.varint).toString(16).padStart(2, "0") + "46";
  assert.ok(hex.includes(sizeTagged), `fileSize varint ${sizeTagged} not found`);
});

test("group and private use different commands and business types", async () => {
  const group = makeFakeBridge(makeUploadResponse({ uKey: "", fileUuid: "u" }));
  await uploadImage({ bridge: group.bridge, isGroup: true, targetIdOrUid: "987654321" }, baseSegment);
  assert.equal(group.packets[0]!.serviceCmd, NTV2_UPLOAD_SERVICE_CMDS.groupImage);

  const priv = makeFakeBridge(makeUploadResponse({ uKey: "", fileUuid: "u" }));
  await uploadImage({ bridge: priv.bridge, isGroup: false, targetIdOrUid: "u_abc" }, baseSegment);
  assert.equal(priv.packets[0]!.serviceCmd, NTV2_UPLOAD_SERVICE_CMDS.privateImage);

  // The business types are a separate axis from the command ids.
  assert.equal(MEDIA_BUSINESS_TYPE.imageGroup, 20);
  assert.equal(MEDIA_BUSINESS_TYPE.imagePrivate, 10);
});

test("a transport failure is reported, not swallowed", async () => {
  const bridge = {
    identity: { uin: "1" },
    sendRawPacket: async () => ({
      success: false,
      gotResponse: false,
      responseData: null,
      errorMessage: "connection reset",
    }),
  };
  await assert.rejects(
    uploadImage({ bridge: bridge as never, isGroup: true, targetIdOrUid: "1" }, baseSegment),
    /connection reset/,
  );
});

test("a response with no upload body is rejected", async () => {
  // respHead only — the server replied but described nothing, so there is no uKey and
  // no MsgInfo. Sending an empty pbElem would produce a message the client cannot render.
  const response = new ProtoWriter();
  const head = new ProtoWriter();
  head.uint32(1, 0);
  response.message(1, head.finish());
  const { bridge } = makeFakeBridge(response.finish());
  await assert.rejects(
    uploadImage({ bridge, isGroup: true, targetIdOrUid: "1" }, baseSegment),
    /missing msgInfo/,
  );
});

test("decodeUploadResponse reads uKey, ipv4s and the file uuid", () => {
  // The field numbers here are the whole risk: 1 uKey, 3 ipv4s, 6 msgInfo. A decoder
  // that reads the right shape at the wrong number passes a round-trip test and fails
  // against the server, which is why this asserts the decoded VALUES.
  const decoded = decodeUploadResponse(
    makeUploadResponse({
      uKey: "ukey-abc",
      fileUuid: "uuid-xyz",
      ipv4s: [{ outIp: 0x0100007f, outPort: 443 }],
    }),
  );
  assert.equal(decoded.upload?.uKey, "ukey-abc");
  assert.equal(decoded.upload?.ipv4s?.[0]?.outIp, 0x0100007f);
  assert.equal(decoded.upload?.ipv4s?.[0]?.outPort, 443);
  assert.equal(decoded.upload?.msgInfo?.msgInfoBody?.[0]?.index?.fileUuid, "uuid-xyz");
  assert.equal(decoded.upload?.msgInfo?.msgInfoBody?.[0]?.picture?.domain, "multimedia.nt.qq.com.cn");
});

test("decodeUploadResponse skips unknown fields instead of rejecting them", () => {
  // The server adds fields over time. A strict decoder turns an addition into a broken
  // send, so unknown tags must be skipped.
  const body = new ProtoWriter();
  body.string(1, "ukey-abc");
  body.uint32(2, 3600); // uKeyTtl — known but unused
  body.uint32(5, 12345); // msgSeq — known but unused
  body.uint64(99, 7); // a field that does not exist yet
  const response = new ProtoWriter();
  response.message(2, body.finish());
  const decoded = decodeUploadResponse(response.finish());
  assert.equal(decoded.upload?.uKey, "ukey-abc");
});

test("encodeMsgInfo produces a decodable MsgInfo", () => {
  // Round-trip through the same decoder to prove the shape is well-formed protobuf.
  const msgInfo = encodeMsgInfo({
    msgInfo: {
      msgInfoBody: [
      {
        index: { fileUuid: "uuid-1", storeId: 1, uploadTime: 1_700_000_000, ttl: 86400 },
        picture: { urlPath: "/download?fileid=x", domain: "multimedia.nt.qq.com.cn" },
          fileExist: true,
        },
      ],
    },
  });
  assert.ok(msgInfo.length > 0);
  // Field 1 (msgInfoBody) must be present; field 5 (fileExist) must be the varint 1.
  const hex = Buffer.from(msgInfo).toString("hex");
  assert.ok(hex.startsWith("0a"), "field 1 first");
  assert.ok(hex.includes("2801"), "fileExist = true as uint32 1");
});

test("a segment with no source is rejected before any packet", async () => {
  const { bridge, packets } = makeFakeBridge(makeUploadResponse({ uKey: "", fileUuid: "u" }));
  await assert.rejects(
    uploadImage({ bridge, isGroup: true, targetIdOrUid: "1" }, { type: "image" }),
    /no file source/,
  );
  assert.equal(packets.length, 0, "no packet sent for an empty segment");
});

// ===========================================================================
// Voice (ptt) and video
// ===========================================================================
// The values asserted below are the ones where a plausible-looking alternative is wrong:
// `requestId` (4 for a private voice, 3 for video), the group-only `bytesGeneralFlags`,
// the private-video zeroed geometry, and the two `subFileType` entries. Each is quoted
// with its reference line in the source comments; a test that just re-derived the
// constant from the implementation would not catch a regression in any of them.

/** The `base64://` payload for a byte string — `resolveSegmentBytes` accepts it. */
function base64Source(bytes: Uint8Array): string {
  return `base64://${Buffer.from(bytes).toString("base64")}`;
}

function createHashHex(algorithm: "md5" | "sha1", bytes: Uint8Array): string {
  return createHash(algorithm).update(bytes).digest("hex");
}

/**
 * Pull `uKey` out of a `NTV2RichMediaHighwayExt` (field 2).
 *
 * This is what binds a PUT to a specific server-side upload slot. Reading it back from the
 * wire — rather than from the argument the pipeline passed — is the point: a mix-up between
 * the main body's `uKey` and the thumbnail's would otherwise go undetected.
 */
function readUKeyFromExtend(extend: Uint8Array): string {
  const r = new ProtoReader(extend);
  while (r.next()) {
    if (r.tag === tagOf(2, WireType.lengthDelimited)) return r.string();
    r.skip();
  }
  return "";
}

/**
 * Pull the extension's TOP-LEVEL `fileUuid` (field 1).
 *
 * `buildHighwayExtend` copies this from whichever `msgInfoBody` entry the caller selected
 * by index, so it is the observable proof that a PUT targets the right file — the main
 * video for PUT 0, the thumbnail for PUT 1.
 */
function readFileUuidFromExtend(extend: Uint8Array): string {
  const r = new ProtoReader(extend);
  while (r.next()) {
    if (r.tag === tagOf(1, WireType.lengthDelimited)) return r.string();
    r.skip();
  }
  return "";
}


/**
 * Decode an `extBizInfo` blob independently of the pipeline's own decoder.
 *
 * Field numbers come from `ntv2-upload.ts`'s tables (1/2/3 for the arms; ptt's
 * `bytesReserve` 11, `bytesPbReserve` 12, `bytesGeneralFlags` 13; pic's `bizType` 1,
 * `textSummary` 2; video's `bytesPbReserve` 3).
 */
function decodeExtBizInfoBytes(bytes: Uint8Array): {
  pic?: { bizType?: number; textSummary?: string };
  video?: { bytesPbReserve?: Uint8Array };
  ptt?: {
    waveform?: Uint8Array;
    bytesReserve?: Uint8Array;
    bytesPbReserve?: Uint8Array;
    bytesGeneralFlags?: Uint8Array;
  };
} {
  const out: ReturnType<typeof decodeExtBizInfoBytes> = {};
  const r = new ProtoReader(bytes);
  while (r.next()) {
    if (r.tag === tagOf(1, WireType.lengthDelimited)) {
      const pic: { bizType?: number; textSummary?: string } = {};
      const p = new ProtoReader(r.bytes());
      while (p.next()) {
        if (p.tag === tagOf(1, WireType.varint)) pic.bizType = p.uint32();
        else if (p.tag === tagOf(2, WireType.lengthDelimited)) pic.textSummary = p.string();
        else p.skip();
      }
      out.pic = pic;
    } else if (r.tag === tagOf(2, WireType.lengthDelimited)) {
      const video: { bytesPbReserve?: Uint8Array } = {};
      const v = new ProtoReader(r.bytes());
      while (v.next()) {
        if (v.tag === tagOf(3, WireType.lengthDelimited)) video.bytesPbReserve = v.bytes();
        else v.skip();
      }
      out.video = video;
    } else if (r.tag === tagOf(3, WireType.lengthDelimited)) {
      const ptt: NonNullable<ReturnType<typeof decodeExtBizInfoBytes>["ptt"]> = {};
      const q = new ProtoReader(r.bytes());
      while (q.next()) {
        if (q.tag === tagOf(5, WireType.lengthDelimited)) ptt.waveform = q.bytes();
        else if (q.tag === tagOf(11, WireType.lengthDelimited)) ptt.bytesReserve = q.bytes();
        else if (q.tag === tagOf(12, WireType.lengthDelimited)) ptt.bytesPbReserve = q.bytes();
        else if (q.tag === tagOf(13, WireType.lengthDelimited)) ptt.bytesGeneralFlags = q.bytes();
        else q.skip();
      }
      out.ptt = ptt;
    } else {
      r.skip();
    }
  }
  return out;
}

/**
 * Walk a request envelope far enough to read the fields the ptt/video tests care about.
 *
 * Deliberately hand-rolled rather than reusing a decoder from `src/`: a test that decodes
 * with the same code that encoded cannot detect an encoding bug.
 */
interface DecodedRequest {
  command: number;
  subCommand: number;
  reserved: number;
  requestId: number;
  headCommand: number;
  requestType: number;
  businessType: number;
  sceneType: number;
  groupUin?: number;
  targetUid?: string;
  uploadInfo: {
    fileInfo: {
      fileSize?: number;
      fileHash?: string;
      fileSha1?: string;
      fileName?: string;
      type?: { type?: number; picFormat?: number; videoFormat?: number; voiceFormat?: number };
      width?: number;
      height?: number;
      time?: number;
      original?: number;
    };
    subFileType?: number;
  }[];
  compatQmsgSceneType?: number;
  /** Raw `extBizInfo` bytes; decoded by the individual tests. */
  extBizInfo?: Uint8Array;
}

function decodeRequest(bytes: Uint8Array): DecodedRequest {
  const out: DecodedRequest = { command: 0, subCommand: 0, reserved: 0, requestId: 0, headCommand: 0, requestType: 0, businessType: 0, sceneType: 0, uploadInfo: [] };
  const envelope = new ProtoReader(bytes);
  let body: Uint8Array | undefined;
  while (envelope.next()) {
    if (envelope.tag === tagOf(1, WireType.varint)) out.command = envelope.uint32();
    else if (envelope.tag === tagOf(2, WireType.varint)) out.subCommand = envelope.uint32();
    else if (envelope.tag === tagOf(4, WireType.lengthDelimited)) body = envelope.bytes();
    else if (envelope.tag === tagOf(12, WireType.varint)) out.reserved = envelope.uint32();
    else envelope.skip();
  }
  assert.ok(body, "envelope body");
  const req = new ProtoReader(body);
  let head: Uint8Array | undefined;
  let upload: Uint8Array | undefined;
  while (req.next()) {
    if (req.tag === tagOf(1, WireType.lengthDelimited)) head = req.bytes();
    else if (req.tag === tagOf(2, WireType.lengthDelimited)) upload = req.bytes();
    else req.skip();
  }
  assert.ok(head, "reqHead");
  assert.ok(upload, "upload");
  const h = new ProtoReader(head);
  let common: Uint8Array | undefined;
  let scene: Uint8Array | undefined;
  while (h.next()) {
    if (h.tag === tagOf(1, WireType.lengthDelimited)) common = h.bytes();
    else if (h.tag === tagOf(2, WireType.lengthDelimited)) scene = h.bytes();
    else h.skip();
  }
  assert.ok(common && scene, "common + scene");
  const c = new ProtoReader(common);
  while (c.next()) {
    if (c.tag === tagOf(1, WireType.varint)) out.requestId = c.uint32();
    else if (c.tag === tagOf(2, WireType.varint)) out.headCommand = c.uint32();
    else c.skip();
  }
  const s = new ProtoReader(scene);
  let c2c: Uint8Array | undefined;
  let group: Uint8Array | undefined;
  while (s.next()) {
    if (s.tag === tagOf(101, WireType.varint)) out.requestType = s.uint32();
    else if (s.tag === tagOf(102, WireType.varint)) out.businessType = s.uint32();
    else if (s.tag === tagOf(200, WireType.varint)) out.sceneType = s.uint32();
    else if (s.tag === tagOf(201, WireType.lengthDelimited)) c2c = s.bytes();
    else if (s.tag === tagOf(202, WireType.lengthDelimited)) group = s.bytes();
    else s.skip();
  }
  if (group) {
    const g = new ProtoReader(group);
    while (g.next()) {
      if (g.tag === tagOf(1, WireType.varint)) out.groupUin = Number(g.uint64());
      else g.skip();
    }
  }
  if (c2c) {
    const cc = new ProtoReader(c2c);
    while (cc.next()) {
      if (cc.tag === tagOf(2, WireType.lengthDelimited)) out.targetUid = cc.string();
      else cc.skip();
    }
  }
  const u = new ProtoReader(upload);
  while (u.next()) {
    if (u.tag === tagOf(1, WireType.lengthDelimited)) {
      const info = new ProtoReader(u.bytes());
      const entry: DecodedRequest["uploadInfo"][number] = { fileInfo: {} };
      while (info.next()) {
        if (info.tag === tagOf(1, WireType.lengthDelimited)) {
          const f = new ProtoReader(info.bytes());
          while (f.next()) {
            if (f.tag === tagOf(1, WireType.varint)) entry.fileInfo.fileSize = f.uint32();
            else if (f.tag === tagOf(2, WireType.lengthDelimited)) entry.fileInfo.fileHash = f.string();
            else if (f.tag === tagOf(3, WireType.lengthDelimited)) entry.fileInfo.fileSha1 = f.string();
            else if (f.tag === tagOf(4, WireType.lengthDelimited)) entry.fileInfo.fileName = f.string();
            else if (f.tag === tagOf(5, WireType.lengthDelimited)) {
              const t = new ProtoReader(f.bytes());
              entry.fileInfo.type = {};
              while (t.next()) {
                if (t.tag === tagOf(1, WireType.varint)) entry.fileInfo.type.type = t.uint32();
                else if (t.tag === tagOf(2, WireType.varint)) entry.fileInfo.type.picFormat = t.uint32();
                else if (t.tag === tagOf(3, WireType.varint)) entry.fileInfo.type.videoFormat = t.uint32();
                else if (t.tag === tagOf(4, WireType.varint)) entry.fileInfo.type.voiceFormat = t.uint32();
                else t.skip();
              }
            }
            else if (f.tag === tagOf(6, WireType.varint)) entry.fileInfo.width = f.uint32();
            else if (f.tag === tagOf(7, WireType.varint)) entry.fileInfo.height = f.uint32();
            else if (f.tag === tagOf(8, WireType.varint)) entry.fileInfo.time = f.uint32();
            else if (f.tag === tagOf(9, WireType.varint)) entry.fileInfo.original = f.uint32();
            else f.skip();
          }
        } else if (info.tag === tagOf(2, WireType.varint)) entry.subFileType = info.uint32();
        else info.skip();
      }
      out.uploadInfo.push(entry);
    } else if (u.tag === tagOf(5, WireType.varint)) out.compatQmsgSceneType = u.uint32();
    else if (u.tag === tagOf(6, WireType.lengthDelimited)) out.extBizInfo = u.bytes();
    else u.skip();
  }
  return out;
}

/** A `subFileInfos` entry — what the server answers with for a video's thumbnail. */
function subFileInfo(options: { subType: number; uKey: string; outIp: number; outPort: number }): Uint8Array {
  const w = new ProtoWriter();
  // Field order matters here: **1 is `subType`**, 2 `uKey`, 3 `uKeyTtl`, 4 `ipv4s`.
  w.uint32(1, options.subType);
  w.string(2, options.uKey);
  const ipv4 = new ProtoWriter();
  ipv4.uint32(1, options.outIp);
  ipv4.uint32(2, options.outPort);
  w.message(4, ipv4.finish());
  return w.finish();
}

/**
 * The bytes the pipeline must PUT for a video: the main body carries `uKey` + servers, and
 * the thumbnail's `uKey` + servers arrive in `subFileInfos`, never in the main body.
 */
function makeVideoUploadResponse(options: {
  uKey: string;
  thumbUKey: string;
  bodyCount?: number;
}): Uint8Array {
  const body = new ProtoWriter();
  if (options.uKey !== "") body.string(1, options.uKey);

  const ipv4 = new ProtoWriter();
  ipv4.uint32(1, 0x0100007f);
  ipv4.uint32(2, 8080);
  body.message(3, ipv4.finish());

  // Two msgInfoBody entries: index 0 is the video, index 1 the thumbnail. `msgInfoBody`
  // is REPEATED field 1 of `msgInfo`, so each entry is written directly — nesting them one
  // level deeper decodes as a single entry with no `index`.
  const msgInfo = new ProtoWriter();
  for (let i = 0; i < (options.bodyCount ?? 2); i++) {
    const info = new ProtoWriter();
    info.uint32(1, 10);
    info.string(4, i === 0 ? "nya.mp4" : "nya.jpg");
    const index = new ProtoWriter();
    index.message(1, info.finish());
    index.string(2, `uuid-${i}`);
    index.uint32(3, 1);
    const entry = new ProtoWriter();
    entry.message(1, index.finish());
    msgInfo.message(1, entry.finish());
  }
  body.message(6, msgInfo.finish());

  if (options.thumbUKey !== "") {
    body.message(10, subFileInfo({ subType: 1, uKey: options.thumbUKey, outIp: 0x0100007f, outPort: 8080 }));
  }

  const response = new ProtoWriter();
  const head = new ProtoWriter();
  head.uint32(1, 0);
  response.message(1, head.finish());
  response.message(2, body.finish());
  return response.finish();
}

// A tiny "silk" payload. The pipeline does not transcode — it uploads whatever bytes it is
// given and declares `voiceFormat` separately — so the content is irrelevant; only the
// length and the hashes derived from it matter.
const SILK_BYTES = new Uint8Array([2, 35, 83, 73, 76, 75, 95, 86, 51, 10, 12, 13]);

test("private record uses requestId 4, OIDB 4717 and the 0x126d service", async () => {
  const { bridge, packets } = makeFakeBridge(makeUploadResponse({ uKey: "", fileUuid: "u" }));
  await uploadPtt(
    { bridge, isGroup: false, targetIdOrUid: "u_abc" },
    { type: "record", url: base64Source(SILK_BYTES), duration: 3 },
  );

  const request = decodeRequest(packets[0]!.body);
  assert.equal(packets[0]!.serviceCmd, "OidbSvcTrpcTcp.0x126d_100");
  assert.equal(request.command, NTV2_UPLOAD_COMMANDS.privateVoice);
  assert.equal(request.command, 4717);
  // The reference's private case is 4, NOT the image path's 1 (`:110898`).
  assert.equal(request.requestId, 4);
  assert.equal(request.requestId, NTV2_REQUEST_IDS.pttPrivate);
  assert.equal(request.businessType, 3);
  assert.equal(request.sceneType, 1, "c2c scene");
  assert.equal(request.compatQmsgSceneType, 1);
  assert.equal(request.targetUid, "u_abc");
});

test("group record uses requestId 1, OIDB 4718 and the 0x126e service", async () => {
  const { bridge, packets } = makeFakeBridge(makeUploadResponse({ uKey: "", fileUuid: "u" }));
  await uploadPtt(
    { bridge, isGroup: true, targetIdOrUid: "987654" },
    { type: "record", url: base64Source(SILK_BYTES), duration: 5 },
  );

  const request = decodeRequest(packets[0]!.body);
  assert.equal(packets[0]!.serviceCmd, "OidbSvcTrpcTcp.0x126e_100");
  assert.equal(request.command, 4718);
  // Group is 1. A "fix" that made both scenes 4 would still pass a naive round-trip test.
  assert.equal(request.requestId, 1);
  assert.equal(request.businessType, 3);
  assert.equal(request.sceneType, 2, "group scene");
  assert.equal(request.compatQmsgSceneType, 2);
  assert.equal(request.groupUin, 987654);
});

test("record file info carries type 3, the duration, and zeroed geometry", async () => {
  const { bridge, packets } = makeFakeBridge(makeUploadResponse({ uKey: "", fileUuid: "u" }));
  await uploadPtt(
    { bridge, isGroup: true, targetIdOrUid: "1" },
    { type: "record", url: base64Source(SILK_BYTES), duration: 7, voiceFormat: 1 },
  );

  const info = decodeRequest(packets[0]!.body).uploadInfo;
  assert.equal(info.length, 1, "a voice is a single file");
  // `subFileType: 0` is the primary discriminator, and the encoder elides zeros
  // (`__write_NTV2UploadInfo`, `:28183`) — an absent field IS 0 on the wire.
  assert.equal(info[0]!.subFileType, undefined);
  const file = info[0]!.fileInfo;
  assert.equal(file.type?.type, 3, "3 = voice");
  // `voiceFormat` 1 is the one non-zero discriminator, and the only one that says "voice".
  assert.equal(file.type?.voiceFormat, 1);
  // The two zeros are elided by the same presence rule as `subFileType` above, which is
  // also what the reference's encoder does — absence and 0 are the same thing on the wire.
  assert.equal(file.type?.picFormat, undefined);
  assert.equal(file.type?.videoFormat, undefined);
  // Zeroed on purpose: the reference sends 0/0/0 here (`:110912-110915`), and `original`
  // is 0 for voice while an image sends 1.
  assert.equal(file.width, undefined, "width 0 is dropped by the encoder");
  assert.equal(file.height, undefined);
  assert.equal(file.original, undefined, "original 0");
  assert.equal(file.time, 7);
  assert.equal(file.fileSize, SILK_BYTES.length);
  // Hashes are lowercase hex STRINGS, never raw digests.
  assert.equal(file.fileHash, createHashHex("md5", SILK_BYTES));
  assert.equal(file.fileSha1, createHashHex("sha1", SILK_BYTES));
  assert.match(file.fileHash!, /^[0-9a-f]{32}$/);
  assert.match(file.fileSha1!, /^[0-9a-f]{40}$/);
});

test("record extBizInfo has textSummary Nya~, empty pic bizType, and group-only flags", async () => {
  const group = makeFakeBridge(makeUploadResponse({ uKey: "", fileUuid: "u" }));
  await uploadPtt(
    { bridge: group.bridge, isGroup: true, targetIdOrUid: "1" },
    { type: "record", url: base64Source(SILK_BYTES) },
  );
  const groupExt = decodeExtBizInfoBytes(decodeRequest(group.packets[0]!.body).extBizInfo!);
  assert.equal(groupExt.pic?.textSummary, "Nya~");
  // `bizType` is ABSENT on the voice path; the image path always sets it.
  assert.equal(groupExt.pic?.bizType, undefined);
  assert.deepEqual([...(groupExt.ptt?.bytesReserve ?? [])], [8, 0, 56, 0]);
  assert.deepEqual(
    [...(groupExt.ptt?.bytesGeneralFlags ?? [])],
    [154, 1, 7, 170, 3, 4, 8, 8, 18, 0],
    "the ten-byte group-only flag blob",
  );

  const priv = makeFakeBridge(makeUploadResponse({ uKey: "", fileUuid: "u" }));
  await uploadPtt(
    { bridge: priv.bridge, isGroup: false, targetIdOrUid: "u_a" },
    { type: "record", url: base64Source(SILK_BYTES) },
  );
  const privExt = decodeExtBizInfoBytes(decodeRequest(priv.packets[0]!.body).extBizInfo!);
  assert.equal(privExt.pic?.textSummary, "Nya~");
  // A private voice OMITS the field rather than sending it empty.
  assert.equal(privExt.ptt?.bytesGeneralFlags, undefined);
  assert.deepEqual([...(privExt.ptt?.bytesReserve ?? [])], [8, 0, 56, 0]);
});

test("a record returns compatQMsg alongside msgInfo", async () => {
  const { bridge } = makeFakeBridge(makeUploadResponse({ uKey: "", fileUuid: "u", compatQMsg: true }));
  const result = await uploadPtt(
    { bridge, isGroup: false, targetIdOrUid: "u_a" },
    { type: "record", url: base64Source(SILK_BYTES) },
  );
  assert.ok(result.msgInfo.length > 0);
  // The legacy blob is what makes a single private voice playable; dropping it produces a
  // recording the client renders but cannot play (`:110963-110964`).
  assert.ok(result.compatQMsg !== undefined, "compatQMsg is returned for voice");
  assert.deepEqual([...result.compatQMsg!], [1, 2, 3]);
});

test("record fast upload skips highway entirely", async () => {
  const { bridge, packets, sessionFetches } = makeFakeBridge(
    makeUploadResponse({ uKey: "", fileUuid: "u" }),
  );
  const result = await uploadPtt(
    { bridge, isGroup: true, targetIdOrUid: "1" },
    { type: "record", url: base64Source(SILK_BYTES) },
  );
  assert.equal(sessionFetches(), 0, "no highway session for a fast upload");
  assert.equal(packets.length, 1, "only the OIDB request");
  assert.ok(result.msgInfo.length > 0);
});

test("a record with no source is rejected before any packet", async () => {
  const { bridge, packets } = makeFakeBridge(makeUploadResponse({ uKey: "", fileUuid: "u" }));
  await assert.rejects(
    uploadPtt({ bridge, isGroup: true, targetIdOrUid: "1" }, { type: "record" }),
    /no file source/,
  );
  assert.equal(packets.length, 0);
});

test("video uses OIDB 4586/4585, the 0x11ea/0x11e9 services, and requestId 3", async () => {
  const group = makeFakeBridge(makeVideoUploadResponse({ uKey: "", thumbUKey: "", bodyCount: 2 }));
  await uploadVideo(
    { bridge: group.bridge, isGroup: true, targetIdOrUid: "42" },
    { type: "video", url: base64Source(SILK_BYTES), duration: 9 },
  );
  const groupReq = decodeRequest(group.packets[0]!.body);
  assert.equal(group.packets[0]!.serviceCmd, "OidbSvcTrpcTcp.0x11ea_100");
  assert.equal(groupReq.command, 4586);
  assert.equal(groupReq.requestId, 3);
  assert.equal(groupReq.businessType, 2);
  // **2 in both scenes** for video, unlike image and voice (`:37697`).
  assert.equal(groupReq.compatQmsgSceneType, 2);

  const priv = makeFakeBridge(makeVideoUploadResponse({ uKey: "", thumbUKey: "", bodyCount: 2 }));
  await uploadVideo(
    { bridge: priv.bridge, isGroup: false, targetIdOrUid: "u_xyz" },
    { type: "video", url: base64Source(SILK_BYTES), duration: 9 },
  );
  const privReq = decodeRequest(priv.packets[0]!.body);
  // 0x11e9, not the 0x11da/0x11d9 pair a "video = image + 1" guess produces.
  assert.equal(priv.packets[0]!.serviceCmd, "OidbSvcTrpcTcp.0x11e9_100");
  assert.equal(privReq.command, 4585);
  assert.equal(privReq.requestId, 3);
  assert.equal(privReq.compatQmsgSceneType, 2, "also 2 in c2c");
});

test("video sends two uploadInfo entries: type 2 subFileType 0, and a type 1 thumb subFileType 100", async () => {
  const { bridge, packets } = makeFakeBridge(
    makeVideoUploadResponse({ uKey: "", thumbUKey: "", bodyCount: 2 }),
  );
  await uploadVideo(
    { bridge, isGroup: true, targetIdOrUid: "42" },
    { type: "video", url: base64Source(SILK_BYTES), duration: 12 },
  );

  const info = decodeRequest(packets[0]!.body).uploadInfo;
  assert.equal(info.length, 2, "video + thumbnail in ONE request");

  const main = info[0]!;
  // Elided zero — see the note in the record test.
  assert.equal(main.subFileType, undefined);
  assert.equal(main.fileInfo.type?.type, 2, "2 = video");
  assert.equal(main.fileInfo.fileName, "nya.mp4");
  assert.equal(main.fileInfo.time, 12);

  const thumb = info[1]!;
  // 100, not 1 — `subFileType` 1 is not the thumbnail discriminator.
  assert.equal(thumb.subFileType, 100);
  assert.equal(thumb.fileInfo.type?.type, 1, "the thumbnail is an IMAGE");
  assert.equal(thumb.fileInfo.fileName, "nya.jpg");
  assert.equal(thumb.fileInfo.time, undefined, "time 0");
  assert.match(thumb.fileInfo.fileHash!, /^[0-9a-f]{32}$/);
});

test("private video zeroes width and height; group video carries them", async () => {
  const group = makeFakeBridge(makeVideoUploadResponse({ uKey: "", thumbUKey: "", bodyCount: 2 }));
  await uploadVideo(
    { bridge: group.bridge, isGroup: true, targetIdOrUid: "42" },
    { type: "video", url: base64Source(SILK_BYTES), duration: 9, width: 640, height: 480 },
  );
  const groupMain = decodeRequest(group.packets[0]!.body).uploadInfo[0]!.fileInfo;
  assert.equal(groupMain.width, 640);
  assert.equal(groupMain.height, 480);

  const priv = makeFakeBridge(makeVideoUploadResponse({ uKey: "", thumbUKey: "", bodyCount: 2 }));
  await uploadVideo(
    { bridge: priv.bridge, isGroup: false, targetIdOrUid: "u_xyz" },
    { type: "video", url: base64Source(SILK_BYTES), duration: 9, width: 640, height: 480 },
  );
  const privMain = decodeRequest(priv.packets[0]!.body).uploadInfo[0]!.fileInfo;
  // Explicitly zeroed on the c2c path (`:37672-37673`), even though the caller supplied
  // them — a "harmless" bit of symmetry here is what breaks the private bubble layout.
  assert.equal(privMain.width, undefined, "width 0 omitted");
  assert.equal(privMain.height, undefined, "height 0 omitted");
});

test("video extBizInfo carries the 80 01 00 reserve and Nya~ summary", async () => {
  const { bridge, packets } = makeFakeBridge(
    makeVideoUploadResponse({ uKey: "", thumbUKey: "", bodyCount: 2 }),
  );
  await uploadVideo(
    { bridge, isGroup: true, targetIdOrUid: "42" },
    { type: "video", url: base64Source(SILK_BYTES) },
  );
  const ext = decodeExtBizInfoBytes(decodeRequest(packets[0]!.body).extBizInfo!);
  assert.equal(ext.pic?.textSummary, "Nya~");
  assert.equal(ext.pic?.bizType, undefined, "bizType 0 is dropped by the encoder");
  assert.deepEqual([...(ext.video?.bytesPbReserve ?? [])], [128, 1, 0]);
});

test("a video PUTs the thumbnail against subFileInfos[0], not the main body", async () => {
  const { bridge } = makeFakeBridge(
    makeVideoUploadResponse({ uKey: "main-uKey", thumbUKey: "thumb-uKey", bodyCount: 2 }),
  );

  // Record every PUT: which `cmdId`, which md5, and what `uKey` the extension names.
  const puts: { commandId: number; fileMd5Hex: string; uKey: string; size: number; fileUuid: string }[] = [];
  const session = {
    sigSession: new Uint8Array(4),
    sessionKey: new Uint8Array(4),
    servers: [{ host: "127.0.0.1", port: 8080 }],
  };
  const putChunks = (async (source: { size: number; read: (o: number, l: number) => Promise<Uint8Array> }, options: any) => {
    const bytes = await source.read(0, source.size);
    puts.push({
      commandId: options.commandId,
      fileMd5Hex: Buffer.from(options.fileMd5).toString("hex"),
      uKey: readUKeyFromExtend(options.extend),
      size: source.size,
      fileUuid: readFileUuidFromExtend(options.extend),
    });
    void bytes;
    return { chunks: 1, bytes: source.size };
  }) as never;

  await uploadVideo(
    {
      bridge,
      isGroup: true,
      targetIdOrUid: "42",
      sessionCache: { get: async () => session } as never,
      putChunks,
    },
    { type: "video", url: base64Source(SILK_BYTES), duration: 9 },
  );

  assert.equal(puts.length, 2, "the video and the thumbnail are two separate PUTs");

  // The main video: its own uKey, its own cmdId, and msgInfoBody entry 0.
  assert.equal(puts[0]!.uKey, "main-uKey");
  assert.equal(puts[0]!.commandId, HIGHWAY_CMD_IDS.groupVideo);
  assert.equal(puts[0]!.fileUuid, "uuid-0");
  assert.equal(puts[0]!.size, SILK_BYTES.length);
  assert.equal(puts[0]!.fileMd5Hex, createHashHex("md5", SILK_BYTES));

  // The thumbnail: uKey from subFileInfos[0], cmdId 1006, and msgInfoBody entry 1.
  assert.equal(puts[1]!.uKey, "thumb-uKey", "taken from subFileInfos[0], not the main body");
  assert.equal(puts[1]!.commandId, HIGHWAY_CMD_IDS.groupVideoThumb);
  assert.equal(puts[1]!.fileUuid, "uuid-1", "the extension must name the THUMBNAIL's file");
  // The thumbnail bytes are the bundled 5558-byte PNG when the caller supplies no `thumbUrl`.
  assert.equal(puts[1]!.size, 5558, "the reference FALLBACK_THUMB is 5558 bytes");
});

test("a caller supplied thumbUrl replaces the bundled fallback", async () => {
  const { bridge } = makeFakeBridge(
    makeVideoUploadResponse({ uKey: "main-uKey", thumbUKey: "thumb-uKey", bodyCount: 2 }),
  );
  const thumbs: { size: number; md5Hex: string }[] = [];
  const putChunks = (async (source: any, options: any) => {
    // PUT 1 is the thumbnail: capture its size and md5 as sent on the wire.
    if (thumbs.length === 1 || source.size !== SILK_BYTES.length) {
      thumbs.push({ size: source.size, md5Hex: Buffer.from(options.fileMd5).toString("hex") });
    }
    return { chunks: 1, bytes: source.size };
  }) as never;

  const customThumb = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  await uploadVideo(
    {
      bridge,
      isGroup: true,
      targetIdOrUid: "42",
      sessionCache: {
        get: async () => ({ sigSession: new Uint8Array(4), sessionKey: new Uint8Array(4), servers: [] }),
      } as never,
      putChunks,
    },
    {
      type: "video",
      url: base64Source(SILK_BYTES),
      thumbUrl: base64Source(customThumb),
    },
  );
  assert.equal(thumbs.length, 1);
  assert.equal(thumbs[0]!.size, customThumb.length, "the caller's bytes, not the 5558-byte fallback");
  assert.equal(thumbs[0]!.md5Hex, createHashHex("md5", customThumb));
});

test("a private video's thumbnail PUT uses cmdId 1002", async () => {
  const { bridge } = makeFakeBridge(
    makeVideoUploadResponse({ uKey: "main-uKey", thumbUKey: "thumb-uKey", bodyCount: 2 }),
  );
  const ids: number[] = [];
  const putChunks = (async (_source: unknown, options: any) => {
    ids.push(options.commandId);
    return { chunks: 1, bytes: 0 };
  }) as never;
  await uploadVideo(
    {
      bridge,
      isGroup: false,
      targetIdOrUid: "u_xyz",
      sessionCache: {
        get: async () => ({ sigSession: new Uint8Array(4), sessionKey: new Uint8Array(4), servers: [] }),
      } as never,
      putChunks,
    },
    { type: "video", url: base64Source(SILK_BYTES) },
  );
  assert.deepEqual(ids, [HIGHWAY_CMD_IDS.privateVideo, HIGHWAY_CMD_IDS.privateVideoThumb]);
  assert.deepEqual(ids, [1001, 1002]);
});

test("a video whose thumbnail fast-uploads skips only the thumb PUT", async () => {
  const { bridge } = makeFakeBridge(
    // Empty thumb uKey = the server already has this thumbnail.
    makeVideoUploadResponse({ uKey: "main-uKey", thumbUKey: "", bodyCount: 2 }),
  );
  const ids: number[] = [];
  const putChunks = (async (_source: unknown, options: any) => {
    ids.push(options.commandId);
    return { chunks: 1, bytes: 0 };
  }) as never;
  await uploadVideo(
    {
      bridge,
      isGroup: true,
      targetIdOrUid: "42",
      sessionCache: {
        get: async () => ({ sigSession: new Uint8Array(4), sessionKey: new Uint8Array(4), servers: [] }),
      } as never,
      putChunks,
    },
    { type: "video", url: base64Source(SILK_BYTES) },
  );
  // Each sub-file fast-uploads INDEPENDENTLY: 1 PUT, not 0 and not an error.
  assert.deepEqual(ids, [HIGHWAY_CMD_IDS.groupVideo]);
});

test("a record PUT uses cmdId 1008/1007 and one bootstrap for the whole upload", async () => {
  const group = makeFakeBridge(makeUploadResponse({ uKey: "u1", fileUuid: "u" }));
  const ids: number[] = [];
  let bootstraps = 0;
  const putChunks = (async (_source: unknown, options: any) => {
    ids.push(options.commandId);
    return { chunks: 1, bytes: 0 };
  }) as never;
  await uploadPtt(
    {
      bridge: group.bridge,
      isGroup: true,
      targetIdOrUid: "1",
      sessionCache: {
        get: async () => {
          bootstraps += 1;
          return { sigSession: new Uint8Array(4), sessionKey: new Uint8Array(4), servers: [] };
        },
      } as never,
      putChunks,
    },
    { type: "record", url: base64Source(SILK_BYTES) },
  );
  assert.deepEqual(ids, [HIGHWAY_CMD_IDS.groupPtt]);
  assert.deepEqual(ids, [1008]);
  assert.equal(bootstraps, 1);

  const priv = makeFakeBridge(makeUploadResponse({ uKey: "u1", fileUuid: "u" }));
  const privIds: number[] = [];
  await uploadPtt(
    {
      bridge: priv.bridge,
      isGroup: false,
      targetIdOrUid: "u_a",
      sessionCache: {
        get: async () => ({ sigSession: new Uint8Array(4), sessionKey: new Uint8Array(4), servers: [] }),
      } as never,
      putChunks: (async (_s: unknown, o: any) => {
        privIds.push(o.commandId);
        return { chunks: 1, bytes: 0 };
      }) as never,
    },
    { type: "record", url: base64Source(SILK_BYTES) },
  );
  assert.deepEqual(privIds, [HIGHWAY_CMD_IDS.privatePtt]);
  assert.deepEqual(privIds, [1007]);
});

test("createMediaUploader dispatches record and video instead of throwing", async () => {
  const { createMediaUploader } = await import("../src/highway/pipeline.js");
  const { bridge } = makeFakeBridge(makeUploadResponse({ uKey: "", fileUuid: "u" }));
  const upload = createMediaUploader({ bridge, isGroup: true, targetIdOrUid: "1" });
  const result = await upload({ type: "record", url: base64Source(SILK_BYTES) });
  assert.ok(result.msgInfo.length > 0);
});
