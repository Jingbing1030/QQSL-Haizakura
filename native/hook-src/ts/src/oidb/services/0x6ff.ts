// `HttpConn.0x6ff_501` — the highway upload session bootstrap.
//
// ---------------------------------------------------------------------------
// This is NOT an OIDB command, and it does not belong in this directory's
// registry of `OidbSpec`s
// ---------------------------------------------------------------------------
// Every other file here wraps an `OidbSvcTrpcTcp.0x<cmd>_<sub>` command sent
// through the OIDB envelope (command / sub-command / errorCode / body).  This one
// is different in three ways:
//
//   1. Its wire name is the literal `"HttpConn.0x6ff_501"`
//      (reference/index.mjs:34151 `bridge.sendRawPacket("HttpConn.0x6ff_501", ...)`).
//      There is no `OidbBase` envelope and therefore no command/sub-command
//      fields and no envelope error code.
//   2. The request's payload sits in field **1281**, not in field 4.  1281 is
//      outside the 15-bit field-number range, so the tag alone needs three bytes
//      — a region of the encoding no OIDB message in this repo reaches.
//   3. Its reply carries the **upload session** (sig_session + a server list),
//      which the highway transfer code then uses for every subsequent chunk.
//
// So it is modelled as a standalone codec pair plus a `HttpsSessionDescriptor`
// rather than an `OidbSpec`.  Writing it as an `OidbSpec` would require lying
// about the command id and would make `invokeOidb` produce an envelope the
// server will not accept.  The task brief called this command "group ark /
// share"; it is nothing of the kind — see the note at the bottom.
//
// ---------------------------------------------------------------------------
// Request field numbers            (reference/index.mjs:31405 .. 31772)
// ---------------------------------------------------------------------------
//   HttpConn0x6FF501Request
//     1281 httpConn message HttpConn
//
//   HttpConn
//     1  field1       uint32
//     2  field2       uint32
//     3  field3       uint32
//     4  field4       uint32
//     6  field6       uint32            <-- 5 is skipped
//     7  serviceTypes repeated uint32   <-- NON-PACKED repeated varint
//     9  field9       uint32            <-- 8 is skipped
//     10 field10      uint32
//     11 field11      uint32
//     15 ver          string            <-- 11 -> 15
//
// The hard-coded values the reference sends (reference/index.mjs:34142) are:
//
//     field1: 0   field2: 0   field3: 16  field4: 1   field6: 3
//     serviceTypes: [1, 5, 10, 21]
//     field9: 2   field10: 9  field11: 8  ver: "1.0.1"
//
// `serviceTypes` deserves a note: it is a repeated uint32 encoded **unpacked**
// (one tag `0x38` per element — the golden request shows `38013805380a3815`),
// which is the proto2 default and what the reference's generated encoder emits.
// A packed encoding (`3a 04 01 05 0a 15`) would be a different byte string that
// the same server may or may not accept; reproducing the reference's choice
// exactly is the only safe option.
//
// ---------------------------------------------------------------------------
// Response field numbers           (reference/index.mjs:31886 .. 32166)
// ---------------------------------------------------------------------------
//   HttpConn0x6FF501Response
//     1281 httpConn message HttpConnResponse
//
//   HttpConnResponse
//     1 sigSession   bytes      the upload session ticket
//     2 sessionKey   bytes
//     3 serverInfos  repeated HttpConnServerInfo
//
//   HttpConnServerInfo
//     1 serviceType uint32
//     2 serverAddrs repeated HttpConnServerAddr
//
//   HttpConnServerAddr
//     1 type  uint32
//     2 ip    **fixed32**       <-- the only fixed32 field in this whole family
//     3 port  uint32
//     4 area  uint32
//
// Field 2 is wire type **5**, not a varint.  It is also decode-only: there is no
// `__write_ServerAddr` in the reference (nothing ever sends this message), so the
// encoder below covers the request side only.
//
// The ip is stored host-endian-ish and rendered by `ipv4ToString`
// (reference/index.mjs:34124):
//
//     `${value & 255}.${value >> 8 & 255}.${value >> 16 & 255}.${value >> 24 & 255}`
//
// i.e. the FIRST octet is the LOW byte.  Read it the other way round and every
// upload goes to a reversed IP address.
//
// ---------------------------------------------------------------------------
// The filtering rules, which are easy to drop
// ---------------------------------------------------------------------------
// From reference/index.mjs:34168:
//
//   * only servers with `serviceType === 1` are used — the others are for
//     different transports and are silently ignored;
//   * a server with no addresses is skipped;
//   * an address needs `ip !== 0` AND `port > 0` AND `port <= 65535`;
//   * duplicates are collapsed on `host:port` (the reference keys a Map).
//
// Then two hard failures:
//
//   * an empty/missing `sigSession` throws `"HttpConn response missing sig_session"`;
//   * an empty resulting server list throws
//     `"HttpConn response has no upload servers"`.
//
// Both are reproduced verbatim: they are the errors operators see in the field,
// and paraphrasing them would break log-based diagnostics.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { decodeOidbEmpty, type OidbEmpty } from "./0x89a-0.js";

/** The literal wire name — not an `OidbSvcTrpcTcp` command. */
export const HTTPCONN_SESSION_WIRE_NAME = "HttpConn.0x6ff_501";

/** The outer field that carries the payload; 1281 exceeds the usual OIDB range. */
export const HTTPCONN_OUTER_FIELD = 1281;

export const HttpConnField = {
  field1: 1,
  field2: 2,
  field3: 3,
  field4: 4,
  field6: 6,
  serviceTypes: 7,
  field9: 9,
  field10: 10,
  field11: 11,
  ver: 15,
} as const;

export const HttpConnResponseField = { sigSession: 1, sessionKey: 2, serverInfos: 3 } as const;

export const HttpConnServerInfoField = { serviceType: 1, serverAddrs: 2 } as const;

export const HttpConnServerAddrField = { type: 1, ip: 2, port: 3, area: 4 } as const;

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface HttpConn {
  field1: number;
  field2: number;
  field3: number;
  field4: number;
  field6: number;
  /** Unpacked repeated uint32 (see the header). */
  serviceTypes: number[];
  field9: number;
  field10: number;
  field11: number;
  ver: string;
}

export interface HttpConn0x6FF501Request {
  httpConn: HttpConn;
}

/** The exact bootstrap request the reference sends (reference/index.mjs:34142). */
export const HTTPCONN_SESSION_REQUEST: HttpConn0x6FF501Request = {
  httpConn: {
    field1: 0,
    field2: 0,
    field3: 16,
    field4: 1,
    field6: 3,
    serviceTypes: [1, 5, 10, 21],
    field9: 2,
    field10: 9,
    field11: 8,
    ver: "1.0.1",
  },
};

/**
 * Unpacked repeated uint32: one tag+varint per element, emitted even for 0.
 *
 * `ProtoWriter` has no `repeatedUint32` (and `wire.ts` is not mine to extend), but
 * `uint32Present` is exactly the per-element behaviour the reference's generated
 * loop implements — reference/index.mjs's `__write_HttpConn` writes `buf[offset++]
 * = 56` (field 7, wire 0) inside an unconditional `for` over the array, so a
 * zero element still produces a field.  Composing it beats adding a ninth writer
 * method for one message.
 */
function repeatedUint32(
  writer: ProtoWriter,
  fieldNumber: number,
  values: readonly number[] | undefined | null,
): ProtoWriter {
  if (values == null) return writer;
  for (const value of values) writer.uint32Present(fieldNumber, value);
  return writer;
}

export function encodeHttpConn(body: HttpConn): Uint8Array {
  const writer = new ProtoWriter()
    .uint32(HttpConnField.field1, body.field1)
    .uint32(HttpConnField.field2, body.field2)
    .uint32(HttpConnField.field3, body.field3)
    .uint32(HttpConnField.field4, body.field4)
    .uint32(HttpConnField.field6, body.field6);
  // Unpacked: one tag+varint per element, NOT a length-delimited blob.  Emitted
  // between field 6 and field 9 because the encoder is sequential and the golden
  // request carries `3801 3805 380a 3815` in that slot.
  repeatedUint32(writer, HttpConnField.serviceTypes, body.serviceTypes);
  return writer
    .uint32(HttpConnField.field9, body.field9)
    .uint32(HttpConnField.field10, body.field10)
    .uint32(HttpConnField.field11, body.field11)
    .string(HttpConnField.ver, body.ver)
    .finish();
}

export function encodeHttpConn0x6FF501Request(body: HttpConn0x6FF501Request): Uint8Array {
  return new ProtoWriter()
    .message(HTTPCONN_OUTER_FIELD, encodeHttpConn(body.httpConn))
    .finish();
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface HttpConnServerAddr {
  type: number;
  /** The raw fixed32 as read; use `httpConnAddrHost` to render it. */
  ip: number;
  port: number;
  area: number;
}

export interface HttpConnServerInfo {
  serviceType: number;
  serverAddrs: HttpConnServerAddr[];
}

export interface HttpConnResponse {
  sigSession: Uint8Array;
  sessionKey: Uint8Array;
  serverInfos: HttpConnServerInfo[];
}

export interface HttpConn0x6FF501Response {
  httpConn: HttpConnResponse | null;
}

/**
 * Read one wire-type-5 field as an unsigned 32-bit integer.
 *
 * `ProtoReader` exposes no fixed32 accessor (only `skip`), and `wire.ts` is not
 * mine to extend, so this reads the four bytes at the reader's absolute position
 * and then advances via `skip`.  The bounds check is the same one the reader's
 * own fixed32 skip path performs (reference/index.mjs:32148).
 */
function readFixed32(reader: ProtoReader, data: Uint8Array, end: number): number {
  const at = reader.offset;
  if (at + 4 > end) throw new Error("protobuf truncated fixed32 field");
  const value =
    (data[at]! | (data[at + 1]! << 8) | (data[at + 2]! << 16) | (data[at + 3]! << 24)) >>> 0;
  // Advance past the payload we just read; `skip` also reports it to a collector.
  reader.skip();
  return value;
}

export function decodeHttpConnServerAddr(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): HttpConnServerAddr {
  const reader = new ProtoReader(data, offset, end);
  const addr: HttpConnServerAddr = { type: 0, ip: 0, port: 0, area: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(HttpConnServerAddrField.type, WireType.varint):
        addr.type = reader.uint32();
        break;
      case tagOf(HttpConnServerAddrField.ip, WireType.fixed32):
        addr.ip = readFixed32(reader, data, end);
        break;
      case tagOf(HttpConnServerAddrField.port, WireType.varint):
        addr.port = reader.uint32();
        break;
      case tagOf(HttpConnServerAddrField.area, WireType.varint):
        addr.area = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return addr;
}

export function decodeHttpConnServerInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): HttpConnServerInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: HttpConnServerInfo = { serviceType: 0, serverAddrs: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(HttpConnServerInfoField.serviceType, WireType.varint):
        info.serviceType = reader.uint32();
        break;
      case tagOf(HttpConnServerInfoField.serverAddrs, WireType.lengthDelimited):
        info.serverAddrs.push(reader.message(decodeHttpConnServerAddr));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return info;
}

export function decodeHttpConnResponse(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): HttpConnResponse {
  const reader = new ProtoReader(data, offset, end);
  const resp: HttpConnResponse = {
    sigSession: new Uint8Array(0),
    sessionKey: new Uint8Array(0),
    serverInfos: [],
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(HttpConnResponseField.sigSession, WireType.lengthDelimited):
        resp.sigSession = reader.bytes();
        break;
      case tagOf(HttpConnResponseField.sessionKey, WireType.lengthDelimited):
        resp.sessionKey = reader.bytes();
        break;
      case tagOf(HttpConnResponseField.serverInfos, WireType.lengthDelimited):
        resp.serverInfos.push(reader.message(decodeHttpConnServerInfo));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export function decodeHttpConn0x6FF501Response(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): HttpConn0x6FF501Response {
  const reader = new ProtoReader(data, offset, end);
  const resp: HttpConn0x6FF501Response = { httpConn: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(HTTPCONN_OUTER_FIELD, WireType.lengthDelimited):
        resp.httpConn = reader.message(decodeHttpConnResponse);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// The session projection
// ---------------------------------------------------------------------------

export interface HttpConnUploadServer {
  host: string;
  port: number;
}

export interface HighwaySession {
  sigSession: Uint8Array;
  sessionKey: Uint8Array;
  servers: HttpConnUploadServer[];
}

/** Render a fixed32 ip, low octet first (reference/index.mjs:34125). */
export function httpConnAddrHost(value: number): string {
  return `${value & 255}.${(value >> 8) & 255}.${(value >> 16) & 255}.${(value >> 24) & 255}`;
}

/** The service type whose servers carry uploads; every other type is ignored. */
export const HTTPCONN_UPLOAD_SERVICE_TYPE = 1;

/**
 * Turn a decoded reply into the session the transfer code needs.
 *
 * Reproduces the reference's filter chain and its two error messages exactly
 * (reference/index.mjs:34158 `fetchHighwaySession`).  Note that the `sessionKey`
 * falls back to an empty array rather than being required, while `sigSession` is
 * mandatory — an asymmetry the reference states explicitly.
 */
export function toHighwaySession(resp: HttpConn0x6FF501Response): HighwaySession {
  const httpConn = resp.httpConn;
  if (!httpConn) throw new Error("HttpConn response body missing");
  if (!httpConn.sigSession || httpConn.sigSession.length === 0) {
    throw new Error("HttpConn response missing sig_session");
  }
  // A Map, not an array: duplicates collapse on `host:port` and the first
  // insertion order is kept, matching the reference's Set-of-keys behaviour.
  const servers = new Map<string, HttpConnUploadServer>();
  for (const info of httpConn.serverInfos ?? []) {
    if ((info.serviceType ?? 0) !== HTTPCONN_UPLOAD_SERVICE_TYPE) continue;
    if (!info.serverAddrs || info.serverAddrs.length === 0) continue;
    for (const addr of info.serverAddrs) {
      const ip = addr.ip ?? 0;
      const port = addr.port ?? 0;
      if (!ip || !(port > 0) || !(port <= 65535)) continue;
      const host = httpConnAddrHost(ip);
      const key = `${host}:${port}`;
      if (!servers.has(key)) servers.set(key, { host, port });
    }
  }
  const list = [...servers.values()];
  if (list.length === 0) throw new Error("HttpConn response has no upload servers");
  return {
    sigSession: httpConn.sigSession,
    sessionKey: httpConn.sessionKey ?? new Uint8Array(0),
    servers: list,
  };
}

/**
 * A descriptor for the one non-envelope family in this batch.
 *
 * Deliberately a different shape from `OidbSpec`: `wireName` instead of
 * `command`/`subCommand`, and no `errorCode` because the transport reports
 * success/failure out of band (`result.success` / `result.gotResponse`).
 */
export interface HttpConnSessionDescriptor {
  /** Not an OIDB command id; see `HTTPCONN_SESSION_WIRE_NAME`. */
  wireName: string;
  /** The write-new-packet request builder (field 1281). */
  encodeRequest: (body: HttpConn0x6FF501Request) => Uint8Array;
  /** The raw response builder, before projection. */
  decodeResponse: (data: Uint8Array, offset?: number, end?: number) => HttpConn0x6FF501Response;
  /** The transport-level failures the caller must check before decoding. */
  requiresResponse: true;
  /** Projection to the upload session, with the reference's own error text. */
  toSession: (resp: HttpConn0x6FF501Response) => HighwaySession;
}

export const HttpConnSession: HttpConnSessionDescriptor = {
  wireName: HTTPCONN_SESSION_WIRE_NAME,
  encodeRequest: encodeHttpConn0x6FF501Request,
  decodeResponse: decodeHttpConn0x6FF501Response,
  requiresResponse: true,
  toSession: toHighwaySession,
};

// A `send_like`-style empty body decode helper is exported for symmetry with the
// rest of the directory; `HttpConn` has none, so this re-export exists purely so
// a caller importing this module has one import to reach for either way.
export { decodeOidbEmpty, type OidbEmpty };