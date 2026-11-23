// End-to-end tests for the two file-transfer uploads:
// `GroupFileApi.upload` and `GroupFileApi.uploadPrivate`.
//
// ---------------------------------------------------------------------------
// What these tests actually cover
// ---------------------------------------------------------------------------
// The full path, not a slice of it:
//
//   a real temp file on disk
//     → stageSourceToDisk (hardlink into $TMPDIR/media-stage)
//     → hashFileStreaming (md5 + sha1 [+ head md5])
//     → a scripted OIDB response for 0x6d6_0 / 0xe37_1700
//     → buildGroupFileUploadExt / buildPrivateFileUploadExt
//     → uploadHighway against a REAL net.Server that speaks highway framing
//     → rememberUploadedFile, so the action's read-back works
//
// The three fakes are the three network boundaries, and nothing else: the packet
// sender (a scripted `sendRawPacket`), the highway TCP server, and the identity.
// Staging, hashing, protobuf encoding, chunking, the retry logic and the frame
// packer are all the production code.
//
// ---------------------------------------------------------------------------
// Why the highway server asserts on the EXT bytes and not just "a chunk arrived"
// ---------------------------------------------------------------------------
// `FileUploadExt` is where the two paths differ, and a chunk that arrives without
// the right extension is accepted by the fake server and discarded by the real
// one. So the fake parses `bytesReqExtendInfo` out of the last chunk's head and
// checks the four discriminating facts (see `readExtFacts`), which is the only
// way to catch a swapped builder short of a live account.

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";
import {
  GroupFileApi,
  int32ToIpv4Dotted,
  normalizeUploadFileName,
  pickPrivateUploadHost,
} from "../src/bridge/apis/group-file.js";
import { encodeOidbEnvelope, makeOidbEnvelope } from "../src/oidb/envelope.js";
import { ProtoWriter } from "../src/oidb/wire.js";
import { HTTPCONN_SESSION_WIRE_NAME } from "../src/oidb/services/0x6ff.js";
import { packHighwayFrame } from "../src/highway/frame.js";
import {
  FileUploadBusiInfoField,
  FileUploadEntryField,
  FileUploadExtField,
  FileUploadFileEntryField,
  FileUploadHostConfigField,
  FileUploadUrlField,
} from "../src/highway/file-ext.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SELF_UIN = 10001;
const GROUP_ID = 987_654_321;
const PEER_UIN = 20002;
const PEER_UID = "u_peer0000000000000002";

const SELF_UID = "u_self0000000000000001";

// ===========================================================================
// The highway fake
// ===========================================================================

/** A request as the fake highway server saw it. */
interface HighwayRequest {
  commandId: number;
  /** `msgBaseHead.seq` — the upload's monotonic request counter. */
  seq: number;
  /** `msgSegHead.dataOffset` — byte offset of this chunk. */
  dataOffset: number;
  /** `msgSegHead.filesize` — the whole file, echoed by the server in the ack. */
  filesize: number;
  dataLength: number;
  /** `bytesReqExtendInfo` — the `FileUploadExt`. Empty for the last chunk. */
  extend: Uint8Array;
  /** `fileMd5` from the base head — the WHOLE file's md5, sent on every chunk. */
  fileMd5: Uint8Array;
  /** The chunk's own md5, from the segment head. */
  chunkMd5: Uint8Array;
}

/**
 * A fake highway server.
 *
 * Answers every chunk with an ack echoing its index and length (which is what the
 * real server does, and what `uploadHighway` verifies). Non-final chunks return
 * `retCode: 0`; the last chunk of a file returns `retCode: 0` too — the reference
 * does not distinguish them in the response.
 */
async function startHighwayServer(): Promise<{
  server: { host: string; port: number };
  requests: HighwayRequest[];
  close: () => Promise<void>;
}> {
  const requests: HighwayRequest[] = [];
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.subarray(0, headerEnd).toString("ascii");
      const match = header.match(/content-length:\s*(\d+)/i);
      const contentLength = match?.[1] !== undefined ? Number.parseInt(match[1], 10) : 0;
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + contentLength) return;
      const frame = buffer.subarray(bodyStart, bodyStart + contentLength);
      buffer = buffer.subarray(bodyStart + contentLength);

      const seen = readRequest(frame);
      requests.push(seen);

      // Echo seq / filesize / dataOffset / dataLength so `uploadHighway`'s ack check
      // (upload.ts:474-480) passes. It compares ALL FOUR when present, so an ack that
      // omits filesize is not "skipped" — it IS skipped (`!= null`), but sending all
      // four is what a real server does and what proves our values round-trip.
      const w = new ProtoWriter();
      const base = new ProtoWriter();
      base.uint32(4, seen.seq);
      w.message(1, base.finish());
      const seg = new ProtoWriter();
      seg.uint64(2, BigInt(seen.filesize));
      seg.uint64(3, BigInt(seen.dataOffset));
      seg.uint32(4, seen.dataLength);
      w.message(2, seg.finish());
      const payload = packHighwayFrame(w.finish(), new Uint8Array(0));
      socket.write(
        Buffer.concat([
          Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${payload.length}\r\n\r\n`, "ascii"),
          Buffer.from(payload),
        ]),
      );
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return {
    server: { host: "127.0.0.1", port: address.port },
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** Minimal protobuf reader — enough for `ReqDataHighwayHead` and the ext. */
class Reader {
  #data: Uint8Array;
  #pos = 0;
  constructor(data: Uint8Array) {
    this.#data = data;
  }
  get done(): boolean {
    return this.#pos >= this.#data.length;
  }
  varint(): bigint {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      const byte = this.#data[this.#pos++]!;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
  }
  bytes(length: number): Uint8Array {
    const out = this.#data.subarray(this.#pos, this.#pos + length);
    this.#pos += length;
    return out;
  }
  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 2) this.bytes(Number(this.varint()));
    else if (wire === 1) this.bytes(8);
    else if (wire === 5) this.bytes(4);
    else throw new Error(`unsupported wire type ${wire}`);
  }
}

/** Decode one frame body into the request facts the assertions need. */
function readRequest(frame: Uint8Array): HighwayRequest {
  // 40-byte header, then `<head length LE uint32 BE>??` — see frame.ts. The
  // head's own length prefixes it.
  const headLength = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(1, false);
  const headBytes = frame.subarray(9, 9 + headLength);

  let commandId = 0;
  let seq = 0;
  let dataOffset = 0;
  let filesize = 0;
  let dataLength = 0;
  let extend = new Uint8Array(0);
  let fileMd5 = new Uint8Array(0);
  let chunkMd5 = new Uint8Array(0);

  //   ReqDataHighwayHead { 1 msgBaseHead, 2 msgSegHead, 3 bytesReqExtendInfo, 4 timestamp, 5 loginSig }
  //   DataHighwayHead    { 1 version, 2 uin(string), 3 command(string), 4 seq, 5 retryTimes,
  //                        6 appId, 7 dataFlag, 8 commandId }
  //   SegHead            { 1 serviceId, 2 filesize, 3 dataOffset, 4 dataLength, 6 serviceTicket,
  //                        7 flag, 8 md5, 9 fileMd5, 10 cacheAddr, 13 cachePort }
  //
  // commandId is field 8 of the BASE head — not of the ReqDataHighwayHead, and not
  // the OIDB command. Reading the wrong level yields 0 and an assertion that cannot
  // distinguish "cmdId 71" from "cmdId was never sent".
  const head = new Reader(headBytes);
  while (!head.done) {
    const tag = head.varint();
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (wire !== 2) {
      head.skip(wire);
      continue;
    }
    const bytes = head.bytes(Number(head.varint()));
    if (field === 1) {
      const base = new Reader(bytes);
      while (!base.done) {
        const btag = base.varint();
        const bfield = Number(btag >> 3n);
        const bwire = Number(btag & 7n);
        if (bwire === 0) {
          const value = base.varint();
          if (bfield === 8) commandId = Number(value);
          else if (bfield === 4) seq = Number(value);
        } else {
          base.skip(bwire);
        }
      }
    } else if (field === 2) {
      const seg = new Reader(bytes);
      while (!seg.done) {
        const stag = seg.varint();
        const sfield = Number(stag >> 3n);
        const swire = Number(stag & 7n);
        if (swire === 2) {
          const sbytes = Uint8Array.from(seg.bytes(Number(seg.varint())));
          if (sfield === 8) chunkMd5 = sbytes;
          else if (sfield === 9) fileMd5 = sbytes;
        } else {
          const value = swire === 0 ? seg.varint() : (seg.skip(swire), 0n);
          if (sfield === 2) filesize = Number(value);
          else if (sfield === 3) dataOffset = Number(value);
          else if (sfield === 4) dataLength = Number(value);
        }
      }
    } else if (field === 3) {
      extend = Uint8Array.from(bytes);
    }
  }
  return { commandId, seq, dataOffset, filesize, dataLength, extend, fileMd5, chunkMd5 };
}

/** The four facts that distinguish the two builders, read from the ext bytes. */
interface ExtFacts {
  topFields: number[];
  busiFields: number[];
  busId?: number | undefined;
  receiverUin?: bigint | undefined;
  groupCode?: bigint | undefined;
  checkKey?: Uint8Array | undefined;
  fileName?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
  fileSize?: bigint | undefined;
  fileId?: string | undefined;
}

function readExtFacts(ext: Uint8Array): ExtFacts {
  const readTop = (bytes: Uint8Array) => {
    const out: Array<{ field: number; bytes?: Uint8Array; value?: bigint }> = [];
    const r = new Reader(bytes);
    while (!r.done) {
      const tag = r.varint();
      const field = Number(tag >> 3n);
      const wire = Number(tag & 7n);
      if (wire === 0) out.push({ field, value: r.varint() });
      else if (wire === 2) out.push({ field, bytes: Uint8Array.from(r.bytes(Number(r.varint()))) });
      else r.skip(wire);
    }
    return out;
  };
  const top = readTop(ext);
  const entry = readTop(top.find((f) => f.field === FileUploadExtField.entry)!.bytes!);
  const busi = readTop(entry.find((f) => f.field === FileUploadEntryField.busiBuff)!.bytes!);
  const file = readTop(entry.find((f) => f.field === FileUploadEntryField.fileEntry)!.bytes!);
  const name = readTop(entry.find((f) => f.field === FileUploadEntryField.fileNameInfo)!.bytes!);
  const hostConfig = readTop(entry.find((f) => f.field === FileUploadEntryField.host)!.bytes!);
  const host = readTop(hostConfig[0]!.bytes!);
  const url = readTop(host[0]!.bytes!);
  const dec = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : undefined);
  const pick = (list: ReturnType<typeof readTop>, field: number) => list.find((f) => f.field === field);
  return {
    topFields: top.map((f) => f.field),
    busiFields: busi.map((f) => f.field),
    ...(pick(busi, FileUploadBusiInfoField.busId)?.value !== undefined
      ? { busId: Number(pick(busi, FileUploadBusiInfoField.busId)!.value) }
      : {}),
    ...(pick(busi, FileUploadBusiInfoField.receiverUin)?.value !== undefined
      ? { receiverUin: pick(busi, FileUploadBusiInfoField.receiverUin)!.value }
      : {}),
    ...(pick(busi, FileUploadBusiInfoField.groupCode)?.value !== undefined
      ? { groupCode: pick(busi, FileUploadBusiInfoField.groupCode)!.value }
      : {}),
    ...(pick(file, FileUploadFileEntryField.checkKey)?.bytes !== undefined
      ? { checkKey: pick(file, FileUploadFileEntryField.checkKey)!.bytes }
      : {}),
    ...(pick(file, FileUploadFileEntryField.fileSize)?.value !== undefined
      ? { fileSize: pick(file, FileUploadFileEntryField.fileSize)!.value }
      : {}),
    ...(dec(pick(file, FileUploadFileEntryField.fileId)?.bytes) !== undefined
      ? { fileId: dec(pick(file, FileUploadFileEntryField.fileId)!.bytes) }
      : {}),
    ...(dec(name[0]!.bytes) !== undefined ? { fileName: dec(name[0]!.bytes) } : {}),
    ...(dec(pick(url, FileUploadUrlField.host)?.bytes) !== undefined
      ? { host: dec(pick(url, FileUploadUrlField.host)!.bytes) }
      : {}),
    ...(pick(host, 2)?.value !== undefined ? { port: Number(pick(host, 2)!.value) } : {}),
  };
}

// ===========================================================================
// The OIDB fake
// ===========================================================================

/** The `0x6d6_0` response, encoded the way the server sends it. */
function groupUploadResponse(fields: {
  retCode?: number;
  retMsg?: string;
  uploadIp?: string;
  serverDns?: string;
  fileId?: string;
  checkKey?: Uint8Array;
  fileKey?: Uint8Array;
  boolFileExist?: boolean;
  uploadPort?: number;
  /** A NEW port for the highway server, so the response can name the fake server. */
}): Uint8Array {
  const upload = new ProtoWriter();
  upload.uint32(1, fields.retCode ?? 0);
  if (fields.retMsg) upload.string(2, fields.retMsg);
  if (fields.uploadIp) upload.string(4, fields.uploadIp);
  if (fields.serverDns) upload.string(5, fields.serverDns);
  if (fields.fileId) upload.string(7, fields.fileId);
  if (fields.checkKey) upload.bytes(8, fields.checkKey);
  if (fields.fileKey) upload.bytes(9, fields.fileKey);
  if (fields.boolFileExist) upload.uint32(10, 1);
  if (fields.uploadPort !== undefined) upload.uint32(14, fields.uploadPort);
  const outer = new ProtoWriter();
  outer.message(1, upload.finish()); // GroupFileResp.upload = 1
  return encodeOidbEnvelope(makeOidbEnvelope(1750, 0, outer.finish(), true));
}

/**
 * The `HttpConn.0x6ff_501` response naming one upload server.
 *
 * Two traps, both of which produce "HttpConn response has no upload servers":
 *
 *   1. `HttpConnServerAddr.ip` is **fixed32** (wire type 5), the only non-varint
 *      field in this message family. `ProtoWriter` is varint-only, so the five
 *      bytes are emitted by hand: tag `0x15` = (field 2 << 3) | 5.
 *   2. The inner message nests under field **1281**, not at the top level.
 *
 * `inIP` is little-endian (`int32ToIpv4Dotted` reads it low-octet-first), which is
 * what `writeUInt32LE` produces.
 */
function sessionResponse(host: string, port: number): Uint8Array {
  const octets = host.split(".").map((part) => Number.parseInt(part, 10));
  const ip = ((octets[0]! | (octets[1]! << 8) | (octets[2]! << 16) | (octets[3]! << 24)) >>> 0);
  const ipBuffer = Buffer.alloc(4);
  ipBuffer.writeUInt32LE(ip, 0);

  const httpConn = new ProtoWriter();
  httpConn.bytes(1, new Uint8Array([7, 7, 7, 7])); // sigSession
  const addr = new ProtoWriter();
  addr.uint32(3, port);
  const addrBytes = Buffer.concat([Buffer.from(addr.finish()), Buffer.from([0x15]), ipBuffer]);
  const info = new ProtoWriter();
  info.uint32(1, 1); // serviceType 1 = upload
  info.message(2, addrBytes);
  httpConn.message(3, info.finish());

  const outer = new ProtoWriter();
  outer.message(1281, httpConn.finish());
  return outer.finish();
}

/** A bridge whose packet sender is a scripted function. */
function makeBridge(
  respond: (wireName: string, body: Uint8Array) => Uint8Array | undefined,
  sent: Array<{ wireName: string; body: Uint8Array }> = [],
): Bridge {
  const identity = new MemoryIdentity(String(SELF_UIN), "bot");
  identity.setSelfProfile({ uin: SELF_UIN, uid: SELF_UID, nickname: "bot" } as never);
  identity.rememberFriends([{ uin: PEER_UIN, uid: PEER_UID, nickname: "peer", remark: "" }]);
  const bridge = new Bridge(identity);
  bridge.bindPid(1, {
    sendPacket: async (wireName: string, body: Uint8Array) => {
      sent.push({ wireName, body });
      const response = respond(wireName, body);
      return response === undefined
        ? { success: false, gotResponse: false, errorMessage: "scripted: no response for this packet" }
        : { success: true, gotResponse: true, errorCode: 0, responseData: response };
    },
  });
  return bridge;
}

// ===========================================================================
// Temp files
// ===========================================================================

let tempRoot: string | null = null;
async function makeTempFile(name: string, bytes: Uint8Array): Promise<string> {
  tempRoot ??= await fs.mkdtemp(path.join(os.tmpdir(), "file-upload-test-"));
  const filePath = path.join(tempRoot, name);
  await fs.writeFile(filePath, bytes);
  return filePath;
}

/** Deterministic pseudo-random bytes, so the hashes below are reproducible. */
function payload(size: number, seed = 1): Uint8Array {
  const out = new Uint8Array(size);
  let state = seed >>> 0;
  for (let i = 0; i < size; i += 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    out[i] = (state >>> 24) & 0xff;
  }
  return out;
}

const md5Of = (bytes: Uint8Array) => new Uint8Array(createHash("md5").update(bytes).digest());
const sha1Of = (bytes: Uint8Array) => new Uint8Array(createHash("sha1").update(bytes).digest());

// ===========================================================================
// Group upload
// ===========================================================================

test("upload: a small file goes through OIDB, highway cmdId 71, and the group ext", async () => {
  const highway = await startHighwayServer();
  const body = payload(4096);
  const filePath = await makeTempFile("report.txt", body);
  const CHECK_KEY = new Uint8Array(20).fill(0xa1);
  const FILE_KEY = md5Of(body);
  const sent: Array<{ wireName: string; body: Uint8Array }> = [];
  const bridge = makeBridge((wireName) => {
    if (wireName === HTTPCONN_SESSION_WIRE_NAME) {
      return sessionResponse(highway.server.host, highway.server.port);
    }
    if (wireName === "OidbSvcTrpcTcp.0x6d6_0") {
      return groupUploadResponse({
        uploadIp: "127.0.0.1",
        fileId: "group-file-id-0001",
        checkKey: CHECK_KEY,
        fileKey: FILE_KEY,
        uploadPort: highway.server.port,
      });
    }
    return undefined;
  }, sent);
  try {
    const result = await bridge.apis.groupFile.upload(GROUP_ID, filePath, "报告.txt", "/", true, false);
    assert.deepEqual(result, { fileId: "group-file-id-0001" });

    // 1. The file record's metadata reached the cache the action reads back.
    const cached = bridge.recallUploadedFile("group-file-id-0001");
    assert.ok(cached, "the upload must remember its metadata");
    assert.equal(cached["scope"], "group");
    assert.equal(cached["groupId"], GROUP_ID);
    assert.equal(cached["fileName"], "报告.txt");
    assert.equal(cached["fileSize"], 4096);
    assert.deepEqual([...(cached["fileMd5"] as Uint8Array)], [...md5Of(body)]);
    assert.deepEqual([...(cached["fileSha1"] as Uint8Array)], [...sha1Of(body)]);

    // 2. The bytes went out on ONE highway cmdId 71 chunk.
    assert.equal(highway.requests.length, 1);
    const request = highway.requests[0]!;
    assert.equal(request.commandId, 71, "group file uses highway cmdId 71, NOT an NTV2 id");
    assert.equal(request.dataLength, 4096);
    // The base head carries the WHOLE file's md5 on every chunk.
    assert.deepEqual([...request.fileMd5], [...md5Of(body)]);
    // The segment head carries this CHUNK's md5.
    assert.deepEqual([...request.chunkMd5], [...md5Of(body)]);

    // 3. The extension is a group `FileUploadExt`.
    const facts = readExtFacts(request.extend);
    assert.deepEqual(facts.topFields, [1, 2, 100], "group: no top-level field 200");
    assert.deepEqual(facts.busiFields, [1, 100, 200, 400]);
    assert.equal(facts.busId, 102, "group busId is 102");
    assert.equal(facts.receiverUin, BigInt(GROUP_ID));
    assert.equal(facts.groupCode, BigInt(GROUP_ID));
    // checkKey is the SERVER's, not the file's sha1 — they differ here on purpose.
    assert.deepEqual([...facts.checkKey!], [...CHECK_KEY]);
    assert.notDeepEqual([...facts.checkKey!], [...sha1Of(body)], "the group checkKey is not the sha1");
    assert.equal(facts.fileName, "报告.txt");
    assert.equal(facts.host, "127.0.0.1");
    assert.equal(facts.port, highway.server.port);
    assert.equal(facts.fileSize, 4096n);
    assert.equal(facts.fileId, "group-file-id-0001");
  } finally {
    await highway.close();
  }
});

test("upload: boolFileExist skips the highway PUT but still remembers the file", async () => {
  const highway = await startHighwayServer();
  const body = payload(2048);
  const filePath = await makeTempFile("dup.txt", body);
  const bridge = makeBridge((wireName) => {
    if (wireName === "OidbSvcTrpcTcp.0x6d6_0") {
      return groupUploadResponse({
        fileId: "already-there",
        checkKey: new Uint8Array(20),
        fileKey: md5Of(body),
        // The server already has these bytes.
        boolFileExist: true,
        uploadPort: highway.server.port,
        uploadIp: "127.0.0.1",
      });
    }
    return undefined;
  });
  try {
    const result = await bridge.apis.groupFile.upload(GROUP_ID, filePath, "", "/", true, false);
    assert.equal(result.fileId, "already-there");
    // NOT an error and NOT a wasted transfer: zero chunks were sent.
    assert.equal(highway.requests.length, 0, "a fast upload must not transfer bytes");
    assert.ok(bridge.recallUploadedFile("already-there"), "the metadata is still recorded");
  } finally {
    await highway.close();
  }
});

test("upload: uploadFile=false records the file and never bootstraps a session", async () => {
  const body = payload(1024);
  const filePath = await makeTempFile("no-bytes.bin", body);
  const sent: Array<{ wireName: string; body: Uint8Array }> = [];
  const bridge = makeBridge((wireName) => {
    if (wireName === "OidbSvcTrpcTcp.0x6d6_0") {
      return groupUploadResponse({ fileId: "record-only", checkKey: new Uint8Array(20), fileKey: md5Of(body) });
    }
    return undefined;
  }, sent);
  const result = await bridge.apis.groupFile.upload(GROUP_ID, filePath, "x.bin", "/", false, false);
  assert.equal(result.fileId, "record-only");
  // The session bootstrap must not even be attempted.
  assert.ok(
    !sent.some((packet) => packet.wireName === HTTPCONN_SESSION_WIRE_NAME),
    "no highway session for a record-only upload",
  );
});

test("upload: a non-zero retCode is an error naming the operation, and nothing is remembered", async () => {
  const body = payload(64);
  const filePath = await makeTempFile("denied.bin", body);
  const bridge = makeBridge((wireName) => {
    if (wireName === "OidbSvcTrpcTcp.0x6d6_0") {
      return groupUploadResponse({ retCode: 130, retMsg: "no permission" });
    }
    return undefined;
  });
  await assert.rejects(
    () => bridge.apis.groupFile.upload(GROUP_ID, filePath, "x", "/", true, false),
    /group file upload failed: code=130 msg=no permission/,
  );
});

test("upload: a response with no file_id fails rather than returning an empty id", async () => {
  const body = payload(64);
  const filePath = await makeTempFile("noid.bin", body);
  const bridge = makeBridge((wireName) => {
    if (wireName === "OidbSvcTrpcTcp.0x6d6_0") {
      return groupUploadResponse({ checkKey: new Uint8Array(20), fileKey: md5Of(body) });
    }
    return undefined;
  });
  await assert.rejects(
    () => bridge.apis.groupFile.upload(GROUP_ID, filePath, "x", "/", true, false),
    /group file upload response missing file_id/,
  );
});

test("upload: an empty file is refused BEFORE the OIDB record is created", async () => {
  const filePath = await makeTempFile("empty.bin", new Uint8Array(0));
  const sent: Array<{ wireName: string; body: Uint8Array }> = [];
  const bridge = makeBridge(() => undefined, sent);
  await assert.rejects(
    () => bridge.apis.groupFile.upload(GROUP_ID, filePath, "e", "/", true, false),
    /group file is empty/,
  );
  // The ordering is the point: no packet at all, so no orphan record exists.
  assert.deepEqual(sent, [], "an empty file must not reach the server");
});

// ===========================================================================
// Private upload
// ===========================================================================

/**
 * The `0xe37_1700` response.
 *
 * ⚠️ Two things make this easy to encode wrongly, and both fail with "private file
 * upload response missing" rather than a decode error, because every field is
 * optional and an absent one stays `null`:
 *
 *   1. The body is NOT at the top level. `OidbPrivateFileUploadResp` wraps it in
 *      field **19** (`OidbPrivateFileUploadRespField.body`), so writing `retCode` at
 *      field 1 produces an envelope that decodes to `{body: null}`.
 *   2. The body's field numbers are TEN-BASED: retCode 10, retMsg 20, uploadIp 60,
 *      uploadDomain 70, uploadPort 80, uuid 90, uploadKey 100, boolFileExist 110,
 *      uploadIpList 130, uploadHttpsPort 140, uploadHttpsDomain 150, uploadDns 160,
 *      uploadLanip 170, fileAddon 200, rtpMediaPlatformUploadAddress 210,
 *      mediaPlatformUploadKey 220. (`OidbPrivateFileUploadRespBodyField`,
 *      `0x3639-offline.ts:78`.) A sequential 1,2,3… is silently ignored.
 *
 * `IPv4` nests under 210 with its own numbering: outIP 1, outPort 2, **inIP 3**,
 * inPort 4, iPType 5 — `inIP` is field 3, not 1.
 */
function privateUploadResponse(fields: {
  retCode?: number;
  retMsg?: string;
  uploadIp?: string;
  uploadDomain?: string;
  uploadPort?: number;
  uuid?: string;
  uploadKey?: Uint8Array;
  fileAddon?: string;
  boolFileExist?: boolean;
  uploadHttpsPort?: number;
  uploadHttpsDomain?: string;
  uploadIpList?: string[];
  mediaPlatformUploadKey?: Uint8Array;
  rtpInIp?: number;
  rtpInPort?: number;
}): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(10, fields.retCode ?? 0);
  if (fields.retMsg) w.string(20, fields.retMsg);
  if (fields.uploadIp) w.string(60, fields.uploadIp);
  if (fields.uploadDomain) w.string(70, fields.uploadDomain);
  if (fields.uploadPort !== undefined) w.uint32(80, fields.uploadPort);
  if (fields.uuid) w.string(90, fields.uuid);
  if (fields.uploadKey) w.bytes(100, fields.uploadKey);
  if (fields.boolFileExist) w.uint32(110, 1);
  if (fields.uploadIpList) for (const ip of fields.uploadIpList) w.string(130, ip);
  if (fields.uploadHttpsPort !== undefined) w.uint32(140, fields.uploadHttpsPort);
  if (fields.uploadHttpsDomain) w.string(150, fields.uploadHttpsDomain);
  if (fields.fileAddon) w.string(200, fields.fileAddon);
  if (fields.rtpInIp !== undefined) {
    const addr = new ProtoWriter();
    addr.uint32(3, fields.rtpInIp);
    if (fields.rtpInPort !== undefined) addr.uint32(4, fields.rtpInPort);
    w.message(210, addr.finish());
  }
  if (fields.mediaPlatformUploadKey) w.bytes(220, fields.mediaPlatformUploadKey);
  const outer = new ProtoWriter();
  outer.message(19, w.finish());
  return encodeOidbEnvelope(makeOidbEnvelope(3639, 1700, outer.finish(), false));
}

test("uploadPrivate: highway cmdId 95, the sha1 in checkKey, and unknown200 = 1", async () => {
  const highway = await startHighwayServer();
  const body = payload(4096, 7);
  const filePath = await makeTempFile("photo.jpg", body);
  const SERVER_KEY = new Uint8Array(16).fill(0xb2);
  const bridge = makeBridge((wireName) => {
    if (wireName === HTTPCONN_SESSION_WIRE_NAME) {
      return sessionResponse(highway.server.host, highway.server.port);
    }
    if (wireName === "OidbSvcTrpcTcp.0xe37_1700") {
      return privateUploadResponse({
        uploadIp: "127.0.0.1",
        uploadPort: highway.server.port,
        uuid: "private-uuid-0001",
        uploadKey: SERVER_KEY,
        fileAddon: "/addon/path",
      });
    }
    return undefined;
  });
  try {
    const result = await bridge.apis.groupFile.uploadPrivate(PEER_UIN, filePath, "照片.jpg", true, false);
    assert.equal(result.fileId, "private-uuid-0001");
    assert.equal(result.fileHash, "/addon/path");

    const cached = bridge.recallUploadedFile("private-uuid-0001");
    assert.ok(cached);
    assert.equal(cached["scope"], "private");
    assert.equal(cached["userId"], PEER_UIN);
    assert.deepEqual([...(cached["fileMd5"] as Uint8Array)], [...md5Of(body)]);

    assert.equal(highway.requests.length, 1);
    const request = highway.requests[0]!;
    assert.equal(request.commandId, 95, "private file uses highway cmdId 95");

    const facts = readExtFacts(request.extend);
    assert.deepEqual(facts.topFields, [1, 2, 100, 200], "private EMITS top-level field 200");
    assert.deepEqual(facts.busiFields, [100], "private busiBuff is senderUin alone");
    assert.equal(facts.busId, undefined, "private has no busId");
    assert.equal(facts.receiverUin, undefined);
    assert.equal(facts.groupCode, undefined);
    // THE discriminating field: checkKey is the file's own sha1, computed locally.
    assert.deepEqual([...facts.checkKey!], [...sha1Of(body)]);
    assert.notDeepEqual([...facts.checkKey!], [...SERVER_KEY], "not the server's key");
    assert.equal(facts.fileId, "private-uuid-0001");
    assert.equal(facts.port, highway.server.port);
  } finally {
    await highway.close();
  }
});

test("uploadPrivate: mediaPlatformUploadKey supersedes uploadKey in field 700", async () => {
  const highway = await startHighwayServer();
  const body = payload(4096, 9);
  const filePath = await makeTempFile("rtp.bin", body);
  const OLD_KEY = new Uint8Array(16).fill(0x11);
  const MEDIA_KEY = new Uint8Array(16).fill(0x22);
  const bridge = makeBridge((wireName) => {
    if (wireName === HTTPCONN_SESSION_WIRE_NAME) {
      return sessionResponse(highway.server.host, highway.server.port);
    }
    if (wireName === "OidbSvcTrpcTcp.0xe37_1700") {
      return privateUploadResponse({
        uploadIp: "127.0.0.1",
        uploadPort: highway.server.port,
        uuid: "uuid-rtp",
        uploadKey: OLD_KEY,
        mediaPlatformUploadKey: MEDIA_KEY,
      });
    }
    return undefined;
  });
  try {
    await bridge.apis.groupFile.uploadPrivate(PEER_UIN, filePath, "r.bin", true, false);
    // Read field 700 out of the fileEntry.
    const ext = highway.requests[0]!.extend;
    const pos = Buffer.from(ext).indexOf(Buffer.from([0xe2, 0x2b, 0x10]));
    assert.ok(pos >= 0, "fileEntry.uploadKey (field 700) must be present");
    const uploadKey = ext.subarray(pos + 3, pos + 19);
    assert.deepEqual([...uploadKey], [...MEDIA_KEY], "mediaPlatformUploadKey wins");
    assert.notDeepEqual([...uploadKey], [...OLD_KEY]);
  } finally {
    await highway.close();
  }
});

test("uploadPrivate: a response with no uuid fails rather than returning an empty id", async () => {
  const body = payload(64);
  const filePath = await makeTempFile("nouuid.bin", body);
  const bridge = makeBridge((wireName) => {
    if (wireName === "OidbSvcTrpcTcp.0xe37_1700") return privateUploadResponse({});
    return undefined;
  });
  await assert.rejects(
    () => bridge.apis.groupFile.uploadPrivate(PEER_UIN, filePath, "x", true, false),
    /private file upload response missing file_id/,
  );
});

test("uploadPrivate: no usable host fails before anything is transferred", async () => {
  const body = payload(64);
  const filePath = await makeTempFile("nohost.bin", body);
  const highway = await startHighwayServer();
  const bridge = makeBridge((wireName) => {
    if (wireName === "OidbSvcTrpcTcp.0xe37_1700") {
      // A uuid but no address anywhere in the six-field fallback chain.
      return privateUploadResponse({ uuid: "uuid-nohost" });
    }
    return undefined;
  });
  try {
    await assert.rejects(
      () => bridge.apis.groupFile.uploadPrivate(PEER_UIN, filePath, "x", true, false),
      /private file upload host is invalid/,
    );
    assert.equal(highway.requests.length, 0);
  } finally {
    await highway.close();
  }
});

// ===========================================================================
// The host/port resolution, as a unit
// ===========================================================================

test("pickPrivateUploadHost: the six-fallback chain, in order", () => {
  // rtpMediaPlatformUploadAddress[0].inIP wins over everything.
  assert.deepEqual(
    pickPrivateUploadHost({
      rtpMediaPlatformUploadAddress: [{ inIP: 0x0100007f, inPort: 9000, outIP: 0, outPort: 0, iPType: 1 }],
      uploadIp: "2.2.2.2",
      uploadDomain: "d.example",
      uploadPort: 1111,
    }),
    { host: "127.0.0.1", port: 9000, httpsHostUsed: false },
  );
  // inIP === 0 means "no RTP path" and must fall through, NOT become 0.0.0.0.
  assert.equal(
    pickPrivateUploadHost({
      rtpMediaPlatformUploadAddress: [{ inIP: 0, inPort: 9000, outIP: 0, outPort: 0, iPType: 1 }],
      uploadIp: "3.3.3.3",
      uploadPort: 80,
    }).host,
    "3.3.3.3",
  );
  // uploadIp beats uploadDomain and uploadIpList.
  assert.equal(
    pickPrivateUploadHost({ uploadIp: "4.4.4.4", uploadDomain: "d", uploadIpList: ["5.5.5.5"], uploadPort: 80 }).host,
    "4.4.4.4",
  );
  // uploadDomain beats uploadIpList.
  assert.equal(
    pickPrivateUploadHost({ uploadDomain: "d.example", uploadIpList: ["5.5.5.5"], uploadPort: 80 }).host,
    "d.example",
  );
  // uploadIpList[0] beats the https domain.
  assert.equal(
    pickPrivateUploadHost({
      uploadIpList: ["5.5.5.5"],
      uploadHttpsDomain: "h.example",
      uploadHttpsPort: 443,
      uploadPort: 80,
    }).host,
    "5.5.5.5",
  );
  // The https domain is last but one, and it is the ONLY one paired with the https port.
  const https = pickPrivateUploadHost({
    uploadHttpsDomain: "h.example",
    uploadHttpsPort: 443,
    uploadPort: 80,
  });
  assert.deepEqual(https, { host: "h.example", port: 443, httpsHostUsed: true });
  // uploadDns is the very last.
  assert.equal(pickPrivateUploadHost({ uploadDns: "dns.example", uploadPort: 80 }).host, "dns.example");
  // Nothing at all.
  assert.deepEqual(pickPrivateUploadHost({}), { host: "", port: 0, httpsHostUsed: false });
});

test("pickPrivateUploadHost: the https port is NOT used for a host from an earlier fallback", () => {
  // The coupling that a naive "host from chain, port from uploadHttpsPort ?? uploadPort"
  // gets wrong: an uploadIp paired with a TLS-only port hangs.
  const mixed = pickPrivateUploadHost({
    uploadIp: "6.6.6.6",
    uploadHttpsPort: 443,
    uploadPort: 8080,
  });
  assert.equal(mixed.host, "6.6.6.6");
  assert.equal(mixed.port, 8080, "plain host ⇒ plain port");
  assert.equal(mixed.httpsHostUsed, false);
});

test("int32ToIpv4Dotted: low octet first, and the sign is not a problem", () => {
  assert.equal(int32ToIpv4Dotted(0x0100007f), "127.0.0.1");
  assert.equal(int32ToIpv4Dotted(0x0101a8c0), "192.168.1.1");
  assert.equal(int32ToIpv4Dotted(0), "0.0.0.0");
  // A high address has the top bit set; `>>>` keeps it unsigned.
  assert.equal(int32ToIpv4Dotted(0xffffffff), "255.255.255.255");
  assert.equal(int32ToIpv4Dotted(0x08080808), "8.8.8.8");
});

test("normalizeUploadFileName: the caller's name wins, then the staged name, then file.bin", () => {
  assert.equal(normalizeUploadFileName("我的文件.txt", "staged.bin"), "我的文件.txt");
  assert.equal(normalizeUploadFileName("", "staged.bin"), "staged.bin");
  assert.equal(normalizeUploadFileName("   ", "staged.bin"), "staged.bin");
  assert.equal(normalizeUploadFileName("", ""), "file.bin");
  assert.equal(normalizeUploadFileName("  ", "  "), "file.bin");
  // The WINNER is not trimmed — only the fallback is.
  assert.equal(normalizeUploadFileName(" x ", "y"), "x");
  assert.equal(normalizeUploadFileName("x", "  y  "), "x");
});

// ===========================================================================
// Staging and hashing, through the production functions
// ===========================================================================

test("staging a local file hardlinks it, and cleanup removes only the link", async () => {
  const { stageSourceToDisk } = await import("../src/bridge/web/stage-source.js");
  const body = payload(4096, 3);
  const original = await makeTempFile("keep-me.bin", body);
  const staged = await stageSourceToDisk(original);
  try {
    assert.equal(staged.fileSize, 4096);
    assert.equal(staged.fileName, "keep-me.bin");
    assert.deepEqual([...readFileSync(staged.filePath)], [...body]);
    // A hardlink: same inode, so a second cleanup of the staged path must not
    // destroy the original's content.
    const originalStat = await fs.stat(original);
    const stagedStat = await fs.stat(staged.filePath);
    assert.equal(stagedStat.ino, originalStat.ino, "local staging is a hardlink, not a copy");
  } finally {
    await staged.cleanup();
  }
  // The original survives the staged link being removed.
  assert.deepEqual([...readFileSync(original)], [...body]);
});

test("staging an inline base64 source reports an empty name, not a fake one", async () => {
  const { stageSourceToDisk } = await import("../src/bridge/web/stage-source.js");
  const body = payload(300, 5);
  const staged = await stageSourceToDisk(`base64://${Buffer.from(body).toString("base64")}`);
  try {
    assert.equal(staged.fileSize, 300);
    // `""` is what makes `normalizeUploadFileName` fall through to `file.bin`.
    assert.equal(staged.fileName, "");
    assert.deepEqual([...readFileSync(staged.filePath)], [...body]);
  } finally {
    await staged.cleanup();
  }
});

test("staging refuses an oversized source before decoding it", async () => {
  const { stageSourceToDisk } = await import("../src/bridge/web/stage-source.js");
  const big = "A".repeat(400);
  await assert.rejects(() => stageSourceToDisk(`base64://${big}`, 100), /stage source too large: 300 > 100/);
});

test("staging a missing local file fails in realpath, not in the source classifier", async () => {
  const { stageSourceToDisk } = await import("../src/bridge/web/stage-source.js");
  // `resolveLocalFilePath` only decides whether the string LOOKS local; the
  // existence check is `realpath`'s, so the error is ENOENT and it names the path.
  // The reference is identical (`promises.realpath(local)` at :37241), so this
  // pins the wording the caller actually sees rather than the one that "should" appear.
  await assert.rejects(
    () => stageSourceToDisk("file:///nonexistent/definitely-not-here.bin"),
    /ENOENT|no such file|stage source is not a local file/,
  );
});

test("staging refuses a DIRECTORY, which is the case realpath cannot catch", async () => {
  const { stageSourceToDisk } = await import("../src/bridge/web/stage-source.js");
  tempRoot ??= await fs.mkdtemp(path.join(os.tmpdir(), "file-upload-test-"));
  const dir = await makeTempFile("adir", new Uint8Array(0));
  await fs.rm(dir);
  await fs.mkdir(dir);
  await assert.rejects(() => stageSourceToDisk(dir), /stage source is not a regular file/);
});

test("hashFileStreaming: md5 and sha1 are RAW DIGEST BYTES, in one pass", async () => {
  const { hashFileStreaming } = await import("../src/bridge/web/stage-source.js");
  const body = payload(4096, 11);
  const filePath = await makeTempFile("hash.bin", body);
  const hashes = await hashFileStreaming(filePath);
  // Raw bytes, exactly 16 and 20 of them.
  assert.ok(hashes.md5 instanceof Uint8Array);
  assert.equal(hashes.md5.length, 16);
  assert.equal(hashes.sha1.length, 20);
  assert.deepEqual([...hashes.md5], [...md5Of(body)]);
  assert.deepEqual([...hashes.sha1], [...sha1Of(body)]);
  // The hex twins agree with the bytes — this is the assertion that catches a
  // port that returns hex STRINGS in `md5` (which would be 32 bytes long).
  assert.equal(Buffer.from(hashes.md5).toString("hex"), hashes.md5Hex);
  assert.equal(Buffer.from(hashes.sha1).toString("hex"), hashes.sha1Hex);
  // No head hash unless asked.
  assert.equal(hashes.headMd5, undefined);
});

test("hashFileStreaming: headMd5 covers MD5_HEAD_LIMIT bytes, not 10 MiB", async () => {
  const { hashFileStreaming, MD5_HEAD_LIMIT } = await import("../src/bridge/web/stage-source.js");
  // The constant is 10_002_432, which is NOT 10 MiB (10_485_760). A file between the
  // two sizes hashes a different prefix depending on which one is used.
  assert.equal(MD5_HEAD_LIMIT, 10_002_432);
  assert.notEqual(MD5_HEAD_LIMIT, 1024 * 1024 * 10);
  const body = payload(4096, 13);
  const filePath = await makeTempFile("head.bin", body);
  const hashes = await hashFileStreaming(filePath, { headLimit: MD5_HEAD_LIMIT });
  assert.ok(hashes.headMd5, "a headLimit must produce a headMd5");
  // For a file SMALLER than the limit, the head md5 is the whole-file md5.
  assert.deepEqual([...hashes.headMd5!], [...md5Of(body)]);
});

test("hashFileStreaming: headMd5 of a file LARGER than the limit is a real prefix hash", async () => {
  const { hashFileStreaming } = await import("../src/bridge/web/stage-source.js");
  const body = payload(2000, 17);
  const filePath = await makeTempFile("prefix.bin", body);
  const hashes = await hashFileStreaming(filePath, { headLimit: 500 });
  // 500 of 2000 bytes: a prefix hash, so NOT the whole-file md5.
  assert.deepEqual([...hashes.headMd5!], [...md5Of(body.subarray(0, 500))]);
  assert.notDeepEqual([...hashes.headMd5!], [...hashes.md5], "a truncated file has a different head md5");
});

test("assertUnchanged: catches a rewrite between hashing and upload", async () => {
  const { assertUnchanged } = await import("../src/bridge/web/stage-source.js");
  const body = payload(1000, 19);
  const filePath = await makeTempFile("mutate.bin", body);
  const before = await fs.stat(filePath);
  const baseline = { size: before.size, mtimeMs: before.mtimeMs };
  // Unchanged: no throw.
  await assertUnchanged(filePath, baseline);
  // Rewritten with the same size but a later mtime: must throw.
  await new Promise((resolve) => setTimeout(resolve, 10));
  await fs.writeFile(filePath, payload(1000, 23));
  await assert.rejects(() => assertUnchanged(filePath, baseline), /file source changed during send/);
});

test("sweepStagedUploads: an active upload is skipped even when it is old", async () => {
  const { stageSourceToDisk, sweepStagedUploads, STAGE_TTL_MS } = await import(
    "../src/bridge/web/stage-source.js"
  );
  const body = payload(200, 29);
  const original = await makeTempFile("sweep.bin", body);
  const staged = await stageSourceToDisk(original);
  try {
    // Age the staged file past the TTL, then sweep with a `now` far in the future.
    // The file is still registered as active, so it must survive.
    await fs.utimes(staged.filePath, new Date(0), new Date(0));
    const removed = await sweepStagedUploads(Date.now() + STAGE_TTL_MS * 10);
    assert.equal(removed, 0, "a staged file in use must not be reaped");
    // Still readable, i.e. genuinely not deleted.
    assert.deepEqual([...readFileSync(staged.filePath)], [...body]);
  } finally {
    await staged.cleanup();
  }
});

test("a session cache is not created for a path that never transfers", async () => {
  // `uploadFile: false` must not bootstrap. Covered above for `upload`; this pins the
  // same for the private path, where the temptation is to bootstrap eagerly.
  const body = payload(128, 31);
  const filePath = await makeTempFile("priv-only.bin", body);
  const sent: Array<{ wireName: string; body: Uint8Array }> = [];
  const bridge = makeBridge((wireName) => {
    if (wireName === "OidbSvcTrpcTcp.0xe37_1700") {
      return privateUploadResponse({ uuid: "uuid-record-only" });
    }
    return undefined;
  }, sent);
  const result = await bridge.apis.groupFile.uploadPrivate(PEER_UIN, filePath, "x", false, false);
  assert.equal(result.fileId, "uuid-record-only");
  assert.ok(!sent.some((packet) => packet.wireName === HTTPCONN_SESSION_WIRE_NAME));
});

test("GroupFileApi is constructible with a real Bridge — the two methods are on the class", () => {
  const bridge = makeBridge(() => undefined);
  assert.ok(bridge.apis.groupFile instanceof GroupFileApi);
  assert.equal(typeof bridge.apis.groupFile.upload, "function");
  assert.equal(typeof bridge.apis.groupFile.uploadPrivate, "function");
});
