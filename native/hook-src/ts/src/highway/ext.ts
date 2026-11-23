// `NTV2RichMediaHighwayExt` — the `bytesReqExtendInfo` blob that rides inside every
// highway chunk head.
//
// Reference region: `../protocol/src/oidb-services/highway/ntv2-common.ts` /
// `ntv2-upload-request.ts` (reference/index.mjs:33603+), plus `buildHighwayExtend`
// at `:34237`.
// Field tables: `docs/ntv2-upload-codec.md` §4.2–4.11.
//
// ---------------------------------------------------------------------------
// What this is for
// ---------------------------------------------------------------------------
// The upload request (see `ntv2-upload.ts`) asks the server to *open* a session and
// returns a description of what it is willing to store. This message is the
// client's acknowledgement of that description, and it must be sent with **every**
// 1 MiB chunk — the server does not remember it between chunks. So a 40 MiB video
// encodes this 40 times.
//
// That is also why `blockSize` is here: it tells the server how the client chunked
// the file, so it can validate that the chunks tile the file exactly.
//
// ---------------------------------------------------------------------------
// Why the sha1 list is per-block, not per-file
// ---------------------------------------------------------------------------
// `hash.fileSha1` is a **repeated** bytes field: one 20-byte digest per
// `HIGHWAY_BLOCK_SIZE` block, in order. It is not the whole-file sha1.
//
// This is the single most-missed part of the protocol: sending one hash for the
// whole file produces an upload that completes and then fails an integrity check
// server-side, with no indication that the per-block list was the problem. It is
// also why `ts/src/highway/` needs a streaming sha1 — see `blockHashes` below.
//
// ---------------------------------------------------------------------------
// The filter that silently drops servers
// ---------------------------------------------------------------------------
// `buildHighwayExtend` skips an `ipv4` whose `outIp` or `outPort` is zero. A zero
// IP is the server saying "no address for you"; emitting it puts a `0.0.0.0:0`
// entry in the list and the uploader wastes a connect attempt on it.

import { createHash } from "node:crypto";

import { ProtoWriter } from "../oidb/wire.js";
import { HIGHWAY_BLOCK_SIZE } from "./upload.js";
import type { Ntv2FileType } from "../oidb/services/ntv2-upload.js";

// ===========================================================================
// Field numbers
// ===========================================================================

/** `NTV2RichMediaHighwayExt`. Fields 3, 4, 7, 8, 9 are unused. */
export const RichMediaHighwayExtField = {
  fileUuid: 1,
  uKey: 2,
  network: 5,
  msgInfoBody: 6,
  blockSize: 10,
  hash: 11,
} as const;

/** `HighwayNetwork`. */
export const HighwayNetworkField = { ipv4s: 1 } as const;

/** `HighwayIPv4`. */
export const HighwayIPv4Field = { domain: 1, port: 2 } as const;

/** `HighwayDomain`. */
export const HighwayDomainField = { isEnable: 1, ip: 2 } as const;

/** `HighwayHash`. */
export const HighwayHashField = { fileSha1: 1 } as const;

/** `HighwayMsgInfoBody` — echoes the upload response's `msgInfoBody`. */
export const HighwayMsgInfoBodyField = {
  index: 1,
  picture: 2,
  fileExist: 5,
  hashSum: 6,
} as const;

/** `PictureInfo` — how to fetch the uploaded image back. */
export const HighwayPictureInfoField = { urlPath: 1, ext: 2, domain: 3 } as const;

/** `PicUrlExtInfo` — the three CDN parameter sets. */
export const HighwayPicUrlExtInfoField = {
  originalParameter: 1,
  bigParameter: 2,
  thumbParameter: 3,
} as const;

/**
 * `HashSum` — the per-block hash container.
 *
 * Field numbers are **201** and **202**, the same hundred-based shape as
 * `NTV2UploadSceneInfo`. Tag bytes are `ca 0c` and `d2 0c`.
 */
export const HighwayHashSumField = { bytesPbReserveC2c: 201, troopSource: 202 } as const;

/** `C2cSource`. Field 1 does not exist; `friendUid` is 2. */
export const HighwayC2cSourceField = { friendUid: 2 } as const;

/** `TroopSource`. */
export const HighwayTroopSourceField = { groupUin: 1 } as const;

/** `IndexNode`. */
export const HighwayIndexNodeField = {
  info: 1,
  fileUuid: 2,
  storeId: 3,
  uploadTime: 4,
  ttl: 5,
  subType: 6,
} as const;

// ===========================================================================
// Types
// ===========================================================================

/** `HighwayDomain` — one upload address. */
export interface HighwayDomain {
  /** Always `true` in practice; the field exists so the server can disable an address. */
  isEnable?: boolean;
  /** Dotted-quad, e.g. `"1.2.3.4"`. NOT a number — see `ipv4ToString`. */
  ip?: string;
}

/** `HighwayIPv4`. */
export interface HighwayIPv4 {
  domain?: HighwayDomain;
  port?: number;
}

/** `HighwayNetwork`. */
export interface HighwayNetwork {
  ipv4s?: HighwayIPv4[];
}

/** `HighwayHash` — one sha1 per block, in order. */
export interface HighwayHash {
  fileSha1?: Uint8Array[];
}

/** `IndexNode` — the server's description of one stored file. */
export interface HighwayIndexNode {
  info?: {
    fileSize?: number;
    fileHash?: string;
    fileSha1?: string;
    fileName?: string;
    type?: Ntv2FileType;
    width?: number;
    height?: number;
    time?: number;
    original?: number;
  };
  fileUuid?: string;
  storeId?: number;
  uploadTime?: number;
  ttl?: number;
  subType?: number;
}

/**
 * `HighwayMsgInfoBody` — the server's per-file description, echoed back.
 *
 * Both `index` (the stored-file description) and `hashSum` (the per-block hashes
 * the server computed) come from the upload response; this message sends them back
 * so the server can confirm the client received and agrees with them.
 */
export interface HighwayMsgInfoBody {
  index?: HighwayIndexNode;
  picture?: HighwayPictureInfo;
  fileExist?: boolean;
  hashSum?: HighwayHashSum;
}

/** `PicUrlExtInfo` — three opaque CDN parameter strings. */
export interface HighwayPicUrlExtInfo {
  originalParameter?: string;
  bigParameter?: string;
  thumbParameter?: string;
}

/** `PictureInfo` — the download path plus its CDN parameters and domain. */
export interface HighwayPictureInfo {
  urlPath?: string;
  ext?: HighwayPicUrlExtInfo;
  domain?: string;
}

/** `C2cSource` — the private-message arm of `HashSum`. */
export interface HighwayC2cSource {
  friendUid?: string;
}

/** `TroopSource` — the group arm of `HashSum`. */
export interface HighwayTroopSource {
  groupUin?: number;
}

/**
 * `HashSum` — carries the reserve blob and the source address.
 *
 * Both arms are hundred-based (201/202), the same trap as the upload scene block.
 */
export interface HighwayHashSum {
  bytesPbReserveC2c?: HighwayC2cSource;
  troopSource?: HighwayTroopSource;
}

/** `NTV2RichMediaHighwayExt` — the top-level extension. */
export interface RichMediaHighwayExt {
  fileUuid?: string;
  uKey?: string;
  network?: HighwayNetwork;
  msgInfoBody?: HighwayMsgInfoBody[];
  blockSize?: number;
  hash?: HighwayHash;
}

// ===========================================================================
// Encoding
// ===========================================================================

function encodeDomain(domain: HighwayDomain): Uint8Array {
  const w = new ProtoWriter();
  w.bool(HighwayDomainField.isEnable, domain.isEnable);
  w.string(HighwayDomainField.ip, domain.ip);
  return w.finish();
}

function encodeIPv4(ipv4: HighwayIPv4): Uint8Array {
  const w = new ProtoWriter();
  if (ipv4.domain) w.message(HighwayIPv4Field.domain, encodeDomain(ipv4.domain));
  w.uint32(HighwayIPv4Field.port, ipv4.port);
  return w.finish();
}

function encodeNetwork(network: HighwayNetwork): Uint8Array {
  const w = new ProtoWriter();
  for (const ipv4 of network.ipv4s ?? []) {
    w.message(HighwayNetworkField.ipv4s, encodeIPv4(ipv4));
  }
  return w.finish();
}

function encodeHash(hash: HighwayHash): Uint8Array {
  const w = new ProtoWriter();
  // Non-packed repeated bytes: one tag per element. `repeatedMessage` would be wrong
  // because these are raw bytes, not messages.
  for (const sha1 of hash.fileSha1 ?? []) {
    w.bytes(HighwayHashField.fileSha1, sha1);
  }
  return w.finish();
}

/**
 * Encode an `IndexNode`.
 *
 * `info` is re-encoded from the response's decoded fields. The response decoder in
 * `msg-push-fields.ts` produces the same shape, so this is a straight re-encode.
 */
function encodeIndexNode(node: HighwayIndexNode): Uint8Array {
  const w = new ProtoWriter();
  if (node.info) {
    // `info` is a `FileInfo` message. Its field numbers are the same as the request's
    // `NTV2FileInfo` (1..9), which is why this is written inline rather than importing
    // `encodeFileInfo` — the two messages are structurally identical but semantically
    // distinct (server-push vs upload), and coupling them would make a future divergence
    // invisible.
    const info = new ProtoWriter();
    info.uint32(1, node.info.fileSize);
    info.string(2, node.info.fileHash);
    info.string(3, node.info.fileSha1);
    info.string(4, node.info.fileName);
    if (node.info.type) {
      const type = new ProtoWriter();
      type.uint32(1, node.info.type.type);
      type.uint32(2, node.info.type.picFormat);
      type.uint32(3, node.info.type.videoFormat);
      type.uint32(4, node.info.type.voiceFormat);
      info.message(5, type.finish());
    }
    info.uint32(6, node.info.width);
    info.uint32(7, node.info.height);
    info.uint32(8, node.info.time);
    info.uint32(9, node.info.original);
    w.message(HighwayIndexNodeField.info, info.finish());
  }
  w.string(HighwayIndexNodeField.fileUuid, node.fileUuid);
  w.uint32(HighwayIndexNodeField.storeId, node.storeId);
  w.uint32(HighwayIndexNodeField.uploadTime, node.uploadTime);
  w.uint32(HighwayIndexNodeField.ttl, node.ttl);
  w.uint32(HighwayIndexNodeField.subType, node.subType);
  return w.finish();
}

function encodePicUrlExtInfo(ext: HighwayPicUrlExtInfo): Uint8Array {
  const w = new ProtoWriter();
  w.string(HighwayPicUrlExtInfoField.originalParameter, ext.originalParameter);
  w.string(HighwayPicUrlExtInfoField.bigParameter, ext.bigParameter);
  w.string(HighwayPicUrlExtInfoField.thumbParameter, ext.thumbParameter);
  return w.finish();
}

function encodePictureInfo(picture: HighwayPictureInfo): Uint8Array {
  const w = new ProtoWriter();
  w.string(HighwayPictureInfoField.urlPath, picture.urlPath);
  if (picture.ext) w.message(HighwayPictureInfoField.ext, encodePicUrlExtInfo(picture.ext));
  w.string(HighwayPictureInfoField.domain, picture.domain);
  return w.finish();
}

function encodeHashSum(hashSum: HighwayHashSum): Uint8Array {
  const w = new ProtoWriter();
  if (hashSum.bytesPbReserveC2c) {
    const c2c = new ProtoWriter();
    c2c.string(HighwayC2cSourceField.friendUid, hashSum.bytesPbReserveC2c.friendUid);
    // Field 201 — tag `ca 0c`. Same hundred-based trap as the upload scene block.
    w.message(HighwayHashSumField.bytesPbReserveC2c, c2c.finish());
  }
  if (hashSum.troopSource) {
    const troop = new ProtoWriter();
    troop.uint32(HighwayTroopSourceField.groupUin, hashSum.troopSource.groupUin);
    w.message(HighwayHashSumField.troopSource, troop.finish());
  }
  return w.finish();
}

function encodeMsgInfoBody(body: HighwayMsgInfoBody): Uint8Array {
  const w = new ProtoWriter();
  if (body.index) w.message(HighwayMsgInfoBodyField.index, encodeIndexNode(body.index));
  // `picture` and `hashSum` are real nested messages, not opaque blobs — an earlier
  // reading of this assumed bytes and would have produced a field of the wrong wire type.
  if (body.picture) w.message(HighwayMsgInfoBodyField.picture, encodePictureInfo(body.picture));
  w.bool(HighwayMsgInfoBodyField.fileExist, body.fileExist);
  if (body.hashSum) w.message(HighwayMsgInfoBodyField.hashSum, encodeHashSum(body.hashSum));
  return w.finish();
}

/** Encode a `NTV2RichMediaHighwayExt` into the bytes that go into `bytesReqExtendInfo`. */
export function encodeRichMediaHighwayExt(ext: RichMediaHighwayExt): Uint8Array {
  const w = new ProtoWriter();
  w.string(RichMediaHighwayExtField.fileUuid, ext.fileUuid);
  w.string(RichMediaHighwayExtField.uKey, ext.uKey);
  if (ext.network) w.message(RichMediaHighwayExtField.network, encodeNetwork(ext.network));
  for (const body of ext.msgInfoBody ?? []) {
    w.message(RichMediaHighwayExtField.msgInfoBody, encodeMsgInfoBody(body));
  }
  w.uint32(RichMediaHighwayExtField.blockSize, ext.blockSize);
  if (ext.hash) w.message(RichMediaHighwayExtField.hash, encodeHash(ext.hash));
  return w.finish();
}

// ===========================================================================
// Building the extension from an upload response
// ===========================================================================

/** One address the server offered for an upload. */
export interface UploadIPv4 {
  /** The raw fixed32. Rendered with `ipv4ToString`. */
  outIp?: number;
  outPort?: number;
}

/** The response fields `buildHighwayExtend` reads. */
export interface UploadResponseForExtend {
  msgInfoBody?: HighwayMsgInfoBody[];
}

/**
 * Render a raw `fixed32` IPv4 as a dotted quad, low byte first.
 *
 * The same trap as `HttpConnServerAddr.ip`: the numeric form is little-endian, so
 * `127.0.0.1` is the number `0x0100007f`. Rendering it big-endian yields
 * `1.0.0.127` — a valid-looking address that connects to nothing.
 *
 * Exported because `session.ts` needs the identical function and a divergence
 * between the two would be very hard to see.
 */
export function ipv4ToString(value: number): string {
  return `${value & 255}.${(value >> 8) & 255}.${(value >> 16) & 255}.${(value >> 24) & 255}`;
}

/**
 * Compute one sha1 per `HIGHWAY_BLOCK_SIZE` block.
 *
 * The wire contract wants a hash per block, not per file — see the module comment.
 * For a 40 MiB video this is 40 digests; for a 100 KiB sticker it is one.
 *
 * Streaming matters here: a caller with a 4 GiB group file must not buffer it. This
 * takes a reader callback rather than a `Uint8Array` for that reason.
 */
export async function blockHashes(
  size: number,
  read: (offset: number, length: number) => Promise<Uint8Array>,
): Promise<Uint8Array[]> {
  const hashes: Uint8Array[] = [];
  for (let offset = 0; offset < size; offset += HIGHWAY_BLOCK_SIZE) {
    const length = Math.min(HIGHWAY_BLOCK_SIZE, size - offset);
    const block = await read(offset, length);
    if (block.byteLength !== length) {
      throw new Error(
        `block read returned ${block.byteLength} bytes, expected ${length} at offset ${offset}`,
      );
    }
    hashes.push(new Uint8Array(createHash("sha1").update(block).digest()));
  }
  return hashes;
}

/**
 * Project an upload response into the extension payload.
 *
 * Mirrors `buildHighwayExtend` (`:34237`) including its two failure modes:
 *
 *   * an empty `msgInfoBody` throws `"upload response missing msg_info body"` —
 *     the server accepted the request but described no files, so there is nothing
 *     to acknowledge;
 *   * an `ipv4` with a zero `outIp` or `outPort` is **skipped**, not an error.
 *
 * `fileIndex` selects which `msgInfoBody` entry supplies `fileUuid` (video
 * thumbnails are a second entry); it falls back to the first, which is what makes
 * the single-file case work without the caller passing an index.
 */
export function buildHighwayExtend(
  uKey: string,
  response: UploadResponseForExtend,
  ipv4s: readonly UploadIPv4[],
  sha1: Uint8Array | Uint8Array[],
  fileIndex = 0,
): Uint8Array {
  const msgInfoBody = response.msgInfoBody ?? [];
  if (msgInfoBody.length === 0) {
    throw new Error("upload response missing msg_info body");
  }
  const selected = msgInfoBody[fileIndex] ?? msgInfoBody[0];

  const networkIpv4s: HighwayIPv4[] = [];
  for (const ipv4 of ipv4s) {
    const ip = ipv4.outIp ?? 0;
    const port = ipv4.outPort ?? 0;
    // Zero means "no address"; emitting it puts 0.0.0.0:0 in the list and the
    // uploader burns a connect attempt on it.
    if (ip && port) {
      networkIpv4s.push({ domain: { isEnable: true, ip: ipv4ToString(ip) }, port });
    }
  }

  return encodeRichMediaHighwayExt({
    fileUuid: selected?.index?.fileUuid ?? "",
    uKey,
    network: { ipv4s: networkIpv4s },
    // The response's per-file descriptions are echoed back verbatim, minus nothing —
    // `buildHighwayExtend` maps all four fields explicitly.
    // `exactOptionalPropertyTypes` is on, so an explicitly-`undefined` property is
    // rejected. Spreading keeps absent fields absent, which also keeps the encoder from
    // writing a zero-length `picture` where the response had none.
    msgInfoBody: msgInfoBody.map((body) => ({
      ...(body.index !== undefined ? { index: body.index } : {}),
      ...(body.picture !== undefined ? { picture: body.picture } : {}),
      ...(body.fileExist !== undefined ? { fileExist: body.fileExist } : {}),
      ...(body.hashSum !== undefined ? { hashSum: body.hashSum } : {}),
    })),
    blockSize: HIGHWAY_BLOCK_SIZE,
    hash: { fileSha1: Array.isArray(sha1) ? sha1 : [sha1] },
  });
}
