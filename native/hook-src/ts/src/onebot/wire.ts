// RFC 6455 wire codec — hand-written, zero dependencies.
//
// The reference gets this layer from a prebuilt native addon
// (`../websocket/src/native.ts`, reference/index.mjs L339733-L339803, loading
// `websocket-<platform>-<arch>.node`). A TypeScript port cannot ship that
// binary, so every decision the addon makes is reproduced here by hand.
//
// The addon is the *behavioural* specification, not the RFC: it rejects and
// accepts a few things differently from the book, and the reference's own
// WebSocket class (L340063) layers message reassembly, UTF-8 validation and
// close handling on top. Both layers are mirrored:
//
//   native addon  -> FrameParser        (frame boundary + verbatim error text)
//   WebSocket$1   -> WebSocketConnection (reassembly / UTF-8 / close / limits)
//
// The accept/reject matrix and every error string in this file were recovered
// by running the real addon: work/onebot-net/probe/native-frames*.mjs and
// native-order*.mjs, recorded in probe/native-frames.txt and friends.

import { createHash, randomBytes, randomFillSync } from "node:crypto";
import { deflateRawSync, inflateRawSync, constants as zlibConstants } from "node:zlib";

/** Opcodes the reference recognises. Anything else is "Unknown opcode". */
export const Opcode = {
  Continuation: 0x0,
  Text: 0x1,
  Binary: 0x2,
  Close: 0x8,
  Ping: 0x9,
  Pong: 0xa,
} as const;

/** RFC 6455 §5.5: a control frame's payload is at most 125 bytes. */
const MAX_CONTROL_PAYLOAD = 125;
/** Room left for a close reason once the 2-byte code is written. */
export const MAX_CLOSE_REASON_BYTES = 123;
const TRAILER = Buffer.from([0, 0, 0xff, 0xff]);

/** One frame as the addon reports it. `payload` is still masked-decoded. */
export interface WireFrame {
  fin: boolean;
  rsv: number;
  opcode: number;
  payload: Buffer;
}

/** Internal verdict: a frame, a protocol failure, or "need more bytes". */
type ParsedOne =
  | { kind: "frame"; frame: WireFrame }
  | { kind: "fail"; code: number; message: string }
  | { kind: "need-more" };

export interface FrameParserResult {
  frames: WireFrame[];
  error?: true;
  code?: number;
  message?: string;
}

/**
 * The prebuilt addon's frame parser.
 *
 * Check order is load-bearing and was measured, not guessed
 * (probe/native-order*.txt). One frame at a time, in this order:
 *
 *   1. RSV bits vs `allowedRsv`        → 1002 "Unexpected RSV bits"
 *   2. opcode ∈ {0,1,2,8,9,10}         → 1002 "Unknown opcode"
 *   3. control frame: rsv === 0        → 1002 "Control frame RSV bits must be zero"
 *   4. control frame: FIN must be set  → 1002 "Fragmented control frame"
 *   5. control frame: len7 < 126       → 1002 "Control frame too large"
 *   6. mask bit vs `isServer`          → 1002 "Expected masked frame from client"
 *                                          / "Server must not mask frames"
 *   7. 126: value >= 126               → 1002 "Non-minimal 16-bit length"
 *   8. 127: top bit clear              → 1002 "Payload length top bit set"
 *   9. 127: value >= 65536             → 1002 "Non-minimal 64-bit length"
 *  10. declared payload <= maxPayload  → 1009 "Payload exceeds configured max"
 *
 * Three orderings are surprising and all three were verified against the addon:
 * a control frame with RSV1 set is rejected even when `allowedRsv` allows RSV1
 * for data frames (step 3, so compression never applies to controls); step 5
 * fires *before* the mask check, so a masked oversized control frame still
 * reports the control-size error; and step 6 fires before the extended-length
 * checks, so an unmasked non-minimal frame reports the mask error.
 *
 * After an error the parser keeps returning the same error, i.e. the connection
 * is expected to be torn down; the reference's WebSocket class does exactly
 * that (it calls `_failConnection`, which ends the socket).
 */
export class FrameParser {
  private readonly isServer: boolean;
  private readonly maxPayload: number;
  private readonly allowedRsv: number;
  private buffer: Buffer = Buffer.alloc(0);
  private failed: { code: number; message: string } | null = null;

  constructor(options: { isServer?: boolean; maxPayload?: number; allowedRsv?: number } = {}) {
    this.isServer = options.isServer === true;
    this.maxPayload = options.maxPayload ?? Number.MAX_SAFE_INTEGER;
    this.allowedRsv = options.allowedRsv ?? 0;
  }

  /** Bytes held back because they did not complete a frame. */
  get pending(): number {
    return this.buffer.length;
  }

  push(chunk: Buffer): FrameParserResult {
    if (this.failed) return { frames: [], error: true, code: this.failed.code, message: this.failed.message };
    // The addon rejects a non-Buffer with `expected Buffer` before touching any
    // state; reproduce that message rather than failing later on `.length`.
    if (!Buffer.isBuffer(chunk)) throw new TypeError("expected Buffer");
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames: WireFrame[] = [];
    for (;;) {
      const verdict = this.parseOne();
      if (verdict === null || verdict.kind === "need-more") return { frames };
      if (verdict.kind === "fail") {
        this.failed = { code: verdict.code, message: verdict.message };
        return { frames, error: true, code: verdict.code, message: verdict.message };
      }
      frames.push(verdict.frame);
    }
  }

  private fail(code: number, message: string): ParsedOne {
    return { kind: "fail", code, message };
  }


  /** One frame, `null` when the buffer does not yet hold a whole frame. */
  private parseOne(): ParsedOne | null {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const first = buf[0] as number;
    const second = buf[1] as number;
    const fin = (first & 0x80) !== 0;
    const rsv = first & 0x70;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    const lengthCode = second & 0x7f;

    if ((rsv & ~this.allowedRsv) !== 0) return this.fail(1002, "Unexpected RSV bits");
    if (![0, 1, 2, 8, 9, 10].includes(opcode)) return this.fail(1002, "Unknown opcode");
    const isControl = opcode >= 8;
    if (isControl && rsv !== 0) return this.fail(1002, "Control frame RSV bits must be zero");
    if (isControl && !fin) return this.fail(1002, "Fragmented control frame");
    if (isControl && lengthCode >= 126) return this.fail(1002, "Control frame too large");
    if (this.isServer ? !masked : masked) {
      return this.fail(1002, this.isServer ? "Expected masked frame from client" : "Server must not mask frames");
    }

    // Extended length needs its own bytes before the value can be validated.
    let cursor = 2;
    let payloadLength: number;
    if (lengthCode === 126) {
      if (buf.length < cursor + 2) return null;
      payloadLength = buf.readUInt16BE(cursor);
      cursor += 2;
      if (payloadLength < 126) return this.fail(1002, "Non-minimal 16-bit length");
    } else if (lengthCode === 127) {
      if (buf.length < cursor + 8) return null;
      const high = buf.readUInt32BE(cursor);
      const low = buf.readUInt32BE(cursor + 4);
      cursor += 8;
      if ((high & 0x80000000) !== 0) return this.fail(1002, "Payload length top bit set");
      if (high > 0x1fffff) return this.fail(1009, "Payload exceeds configured max");
      payloadLength = high * 2 ** 32 + low;
      if (payloadLength < 65536) return this.fail(1002, "Non-minimal 64-bit length");
    } else {
      payloadLength = lengthCode;
    }

    if (payloadLength > this.maxPayload) return this.fail(1009, "Payload exceeds configured max");

    let maskKey: Buffer | null = null;
    if (masked) {
      if (buf.length < cursor + 4) return null;
      maskKey = buf.subarray(cursor, cursor + 4);
      cursor += 4;
    }
    if (buf.length < cursor + payloadLength) return null;

    // Copy rather than subarray: the parser buffer is replaced on every push.
    const payload = Buffer.allocUnsafe(payloadLength);
    buf.copy(payload, 0, cursor, cursor + payloadLength);
    if (maskKey) {
      for (let i = 0; i < payloadLength; i += 1) payload[i] = (payload[i] as number) ^ (maskKey[i & 3] as number);
    }
    this.buffer = buf.subarray(cursor + payloadLength);
    return { kind: "frame", frame: { fin, rsv, opcode, payload } };
  }
}

/** `native.buildFrame(opcode, fin, payload, maskKey, rsv)` (L339793). */
export function buildFrame(
  opcode: number,
  fin: boolean,
  payload: Buffer,
  maskKey: Buffer | null,
  rsv: number,
): Buffer {
  const length = payload.length;
  const head: number[] = [(fin ? 0x80 : 0) | (rsv & 0x70) | (opcode & 0x0f)];
  const maskBit = maskKey ? 0x80 : 0;
  if (length <= 125) {
    head.push(maskBit | length);
  } else if (length <= 0xffff) {
    head.push(maskBit | 126, (length >> 8) & 0xff, length & 0xff);
  } else {
    // 64-bit big-endian length: the 127 marker, then exactly EIGHT bytes, high
    // 32 bits then low 32. Measured against the native addon: it emits
    // `817f 00000000 00010000` for a 65536-byte payload and
    // `817f 00000000 00011170` for 70000. A nine-byte variant (one zero too
    // many) is what a literal reading of the C++ `>2^32` split produces, and
    // the addon would reject such a frame as "Non-minimal 64-bit length" — so
    // this is caught by the fixture, not by review.
    const high = Math.floor(length / 2 ** 32);
    const low = length % 2 ** 32;
    head.push(
      maskBit | 127,
      (high >>> 24) & 0xff,
      (high >> 16) & 0xff,
      (high >> 8) & 0xff,
      high & 0xff,
      (low >>> 24) & 0xff,
      (low >> 16) & 0xff,
      (low >> 8) & 0xff,
      low & 0xff,
    );
  }
  const header = Buffer.from(head);
  if (!maskKey) return Buffer.concat([header, payload]);
  const maskedPayload = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i += 1) maskedPayload[i] = (payload[i] as number) ^ (maskKey[i & 3] as number);
  return Buffer.concat([header, maskKey, maskedPayload]);
}

/** `native.computeAcceptKey(key)` — base64(sha1(key + GUID)). */
export function computeAcceptKey(key: string): string {
  return createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
}

/** A fresh 4-byte client mask. */
export function randomMaskKey(): Buffer {
  return randomFillSync(Buffer.allocUnsafe(4));
}

/** A fresh 16-byte base64 `Sec-WebSocket-Key`. */
export function randomWebSocketKey(): string {
  return randomBytes(16).toString("base64");
}

/**
 * The codes `isValidCloseCode` (L339941) accepts. Deliberately narrower than
 * RFC 6455: 1004/1005/1006 are rejected, 1012-1014 are rejected, and so is
 * everything in 1012..2999 — the reference only allows the ten it lists plus
 * the 3000-4999 application range.
 */
export function isValidCloseCode(code: number): boolean {
  return (
    code === 1000 ||
    code === 1001 ||
    code === 1002 ||
    code === 1003 ||
    code === 1007 ||
    code === 1008 ||
    code === 1009 ||
    code === 1010 ||
    code === 1011 ||
    (code >= 3000 && code <= 4999)
  );
}

/** `truncateCloseReason` (L339952): UTF-8 safe cut to 123 bytes. */
export function truncateCloseReason(reason: string | undefined): Buffer {
  if (!reason) return Buffer.alloc(0);
  const encoded = Buffer.from(String(reason), "utf8");
  if (encoded.length <= MAX_CLOSE_REASON_BYTES) return encoded;
  let end = MAX_CLOSE_REASON_BYTES;
  while (end > 0 && ((encoded[end] as number) & 192) === 128) end -= 1;
  return encoded.subarray(0, end);
}

/** `encodeClosePayload` (L339947). An empty buffer means "no code". */
export function encodeClosePayload(code: number | undefined, reason?: string): Buffer {
  const reasonBuf = truncateCloseReason(reason);
  if (code === undefined || code === null) {
    if (reasonBuf.length > 0) throw new Error("Cannot send close reason without a code");
    return Buffer.alloc(0);
  }
  const buf = Buffer.allocUnsafe(2 + reasonBuf.length);
  buf.writeUInt16BE(code & 0xffff, 0);
  reasonBuf.copy(buf, 2);
  return buf;
}

/** `opcodeLabel` (L339961). */
export function opcodeLabel(opcode: number): string {
  if (opcode === 1) return "text";
  if (opcode === 2) return "binary";
  return `opcode ${opcode}`;
}

/**
 * Incremental UTF-8 validator (`Utf8Validator`, L340020).
 *
 * The native parser does NOT validate UTF-8 — it hands bytes over untouched —
 * so the reference's WebSocket class validates a completed text message with
 * this state machine and fails the connection with 1007 "Invalid UTF-8".
 * Overlongs, surrogates, >U+10FFFF and code points above U+10FFFF are all
 * rejected here; the checks are ported statement for statement.
 */
export class Utf8Validator {
  private state = 0;
  private codepoint = 0;
  private minNext = 0;

  push(buf: Buffer): boolean {
    for (let i = 0; i < buf.length; i += 1) {
      const b = buf[i] as number;
      if (this.state === 0) {
        if ((b & 128) === 0) continue;
        if ((b & 224) === 192) {
          if (b < 194) return false;
          this.codepoint = b & 31;
          this.state = 1;
          this.minNext = 128;
        } else if ((b & 240) === 224) {
          this.codepoint = b & 15;
          this.state = 2;
          this.minNext = b === 224 ? 160 : 128;
        } else if ((b & 248) === 240) {
          if (b > 244) return false;
          this.codepoint = b & 7;
          this.state = 3;
          this.minNext = b === 240 ? 144 : 128;
        } else {
          return false;
        }
      } else {
        if (b < this.minNext || b > 191) return false;
        if (this.state === 2 && this.codepoint === 13 && b >= 160) return false;
        this.codepoint = (this.codepoint << 6) | (b & 63);
        this.state -= 1;
        this.minNext = 128;
      }
    }
    return true;
  }

  done(): boolean {
    return this.state === 0;
  }
}

/** permessage-deflate negotiation (extensions.ts L339804-L339940). */
export interface PerMessageDeflate {
  clientNoContextTakeover?: boolean;
  serverNoContextTakeover?: boolean;
  threshold?: number;
}

export interface AcceptedPerMessageDeflate {
  enabled: true;
  requestNoContextTakeover: boolean;
  responseNoContextTakeover: boolean;
  threshold: number;
}

interface HeaderOffer {
  name: string;
  params: Record<string, string | true>;
}

function parseHeader(header: string | string[] | undefined): HeaderOffer[] {
  const offers: HeaderOffer[] = [];
  if (!header) return offers;
  for (const rawOffer of (Array.isArray(header) ? header.join(",") : String(header)).split(",")) {
    const parts = rawOffer.split(";").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const name = (parts.shift() as string).toLowerCase();
    const params: Record<string, string | true> = Object.create(null) as Record<string, string | true>;
    for (const part of parts) {
      const eq = part.indexOf("=");
      if (eq === -1) params[part.toLowerCase()] = true;
      else {
        const key = part.slice(0, eq).trim().toLowerCase();
        let value = part.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        params[key] = value;
      }
    }
    offers.push({ name, params });
  }
  return offers;
}

function normalizePerMessageDeflateOptions(value: PerMessageDeflate | boolean | undefined): Required<Pick<PerMessageDeflate, "clientNoContextTakeover" | "serverNoContextTakeover">> & PerMessageDeflate | null {
  if (value === undefined || value === false || value === null) return null;
  if (value === true) return { clientNoContextTakeover: true, serverNoContextTakeover: true };
  if (typeof value === "object") return { clientNoContextTakeover: true, serverNoContextTakeover: true, ...value };
  return { clientNoContextTakeover: true, serverNoContextTakeover: true };
}

export function acceptPerMessageDeflate(
  requestHeader: string | string[] | undefined,
  options: PerMessageDeflate | boolean | undefined,
): { header: string; options: AcceptedPerMessageDeflate } | null {
  const config = normalizePerMessageDeflateOptions(options);
  if (!config) return null;
  const offer = parseHeader(requestHeader).find((item) => item.name === "permessage-deflate");
  if (!offer) return null;
  const responseParams: string[] = [];
  if (config.serverNoContextTakeover !== false || offer.params["server_no_context_takeover"]) responseParams.push("server_no_context_takeover");
  if (config.clientNoContextTakeover !== false || offer.params["client_no_context_takeover"]) responseParams.push("client_no_context_takeover");
  return {
    header: ["permessage-deflate", ...responseParams].join("; "),
    options: {
      enabled: true,
      requestNoContextTakeover: responseParams.includes("client_no_context_takeover"),
      responseNoContextTakeover: responseParams.includes("server_no_context_takeover"),
      threshold: config.threshold ?? 1024,
    },
  };
}

export function offerPerMessageDeflate(options: PerMessageDeflate | boolean | undefined): string | null {
  const config = normalizePerMessageDeflateOptions(options);
  if (!config) return null;
  const params = ["permessage-deflate"];
  if (config.clientNoContextTakeover !== false) params.push("client_no_context_takeover");
  if (config.serverNoContextTakeover !== false) params.push("server_no_context_takeover");
  return params.join("; ");
}

export function parseAcceptedPerMessageDeflate(
  responseHeader: string | string[] | undefined,
  requestedOptions: PerMessageDeflate | boolean | undefined,
): AcceptedPerMessageDeflate | null {
  const config = normalizePerMessageDeflateOptions(requestedOptions);
  if (!config) return null;
  const accepted = parseHeader(responseHeader).find((item) => item.name === "permessage-deflate");
  if (!accepted) return null;
  for (const key of Object.keys(accepted.params)) {
    if (key !== "client_no_context_takeover" && key !== "server_no_context_takeover") {
      throw new Error(`Unsupported permessage-deflate parameter: ${key}`);
    }
  }
  return {
    enabled: true,
    requestNoContextTakeover: !!accepted.params["server_no_context_takeover"],
    responseNoContextTakeover: !!accepted.params["client_no_context_takeover"],
    threshold: config.threshold ?? 1024,
  };
}

export function compressRaw(data: Buffer): Buffer {
  const compressed = deflateRawSync(data, { flush: zlibConstants.Z_SYNC_FLUSH });
  if (compressed.length >= 4 && compressed.subarray(compressed.length - 4).equals(TRAILER)) {
    return compressed.subarray(0, compressed.length - 4);
  }
  return compressed;
}

export function decompressRaw(data: Buffer, maxPayload: number | undefined): Buffer {
  let inflated: Buffer;
  try {
    inflated = inflateRawSync(Buffer.concat([data, TRAILER]), {
      finishFlush: zlibConstants.Z_SYNC_FLUSH,
      ...(maxPayload === undefined ? {} : { maxOutputLength: Math.max(1, maxPayload) }),
    });
  } catch (cause) {
    const code = (cause as { code?: string }).code;
    if (maxPayload !== undefined && code === "ERR_BUFFER_TOO_LARGE") {
      const err = new Error(`Message too large after inflate (maxPayload=${maxPayload})`, { cause });
      (err as Error & { code?: number }).code = 1009;
      throw err;
    }
    throw cause;
  }
  if (maxPayload !== undefined && inflated.length > maxPayload) {
    const err = new Error(`Message too large after inflate (maxPayload=${maxPayload})`);
    (err as Error & { code?: number }).code = 1009;
    throw err;
  }
  return inflated;
}

export function normalizeProtocolList(protocols: string | string[] | Set<string> | undefined): string[] {
  if (!protocols) return [];
  if (typeof protocols === "string") return protocols.split(",").map((p) => p.trim()).filter(Boolean);
  if (Array.isArray(protocols)) return protocols.map(String).map((p) => p.trim()).filter(Boolean);
  if (protocols instanceof Set) return Array.from(protocols).map(String).map((p) => p.trim()).filter(Boolean);
  return [];
}

export function chooseSubprotocol(
  requestHeader: string | string[] | undefined,
  protocols: string | string[] | Set<string> | ((requested: string[]) => string | null | undefined) | undefined,
): string | null {
  const requested = normalizeProtocolList(requestHeader);
  if (typeof protocols === "function") {
    const selected = protocols(requested);
    return selected && requested.includes(String(selected)) ? String(selected) : null;
  }
  const supported = normalizeProtocolList(protocols);
  if (requested.length === 0 || supported.length === 0) return null;
  for (const protocol of supported) if (requested.includes(protocol)) return protocol;
  return null;
}

/**
 * `scanOversizedFrame` (L339986): walk retained bytes from a frame boundary and
 * report the first data frame whose declared size exceeds the cap. Returns
 * `null` when the walk cannot reach a verdict — the caller then reports the cap
 * without a size rather than inventing one.
 */
export function scanOversizedFrame(bytes: Buffer, maxPayload: number): { opcode: number; payloadBytes: number } | null {
  let offset = 0;
  while (offset + 2 <= bytes.length) {
    const first = bytes[offset] as number;
    const second = bytes[offset + 1] as number;
    const opcode = first & 15;
    const masked = (second & 128) !== 0;
    const shortLength = second & 127;
    let payloadBytes: number;
    let headerBytes: number;
    if (shortLength === 126) {
      if (offset + 4 > bytes.length) return null;
      payloadBytes = bytes.readUInt16BE(offset + 2);
      headerBytes = 4;
    } else if (shortLength === 127) {
      if (offset + 10 > bytes.length) return null;
      const high = bytes.readUInt32BE(offset + 2);
      const low = bytes.readUInt32BE(offset + 6);
      if (high > 2097151) return null;
      payloadBytes = high * 2 ** 32 + low;
      headerBytes = 10;
    } else {
      payloadBytes = shortLength;
      headerBytes = 2;
    }
    if (masked) headerBytes += 4;
    if (payloadBytes > maxPayload) {
      return opcode === 1 || opcode === 2 ? { opcode, payloadBytes } : null;
    }
    offset += headerBytes + payloadBytes;
  }
  return null;
}