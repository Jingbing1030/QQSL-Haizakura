// The OIDB unified envelope (`OidbBase<T>`), in TypeScript.
//
// ---------------------------------------------------------------------------
// What the envelope is
// ---------------------------------------------------------------------------
// Every one of the 87 `OidbSvcTrpcTcp.0x<cmd>_<sub>` commands wraps its
// payload in the *same* protobuf message.  The command-specific body is field
// 4; everything around it is bookkeeping the client fills in and the server
// echoes back:
//
//   OidbBase<T> {
//     1  command      uint32     the 0xNNNN command id
//     2  subCommand   uint32     the _N suffix
//     3  errorCode    uint32     request: 0 — response: server retcode
//     4  body         T          command-specific payload
//     5  errorMsg     string     request: "" — response: server wording
//     11 properties   repeated OidbProperty   client metadata (usually absent)
//     12 reserved     uint32     the uin/uid variant selector, see below
//   }
//
// Reference: reference/index.mjs:18818 (`makeOidbEnvelope`),
// reference/index.mjs:18935 (`protobuf_decode_OidbBaseMeta`),
// reference/index.mjs:19988 and 20041 (a generated `__size_`/`__write_` pair,
// which is where the field numbers and presence rules above are actually
// readable; every one of the 87 specs uses the same 1/2/3/4/5/11/12 layout).
//
// ---------------------------------------------------------------------------
// The `reserved` field is a mode switch, not padding
// ---------------------------------------------------------------------------
// Field 12 is named `reserved` in the reference and carried on the spec as
// `uinForm`.  Setting it to 1 makes the server interpret the uin-shaped fields
// inside `body` as UINs; leaving it 0 makes it read the same slots as UIDs.
// The reference's own comment (reference/index.mjs:18810) is blunt about the
// naming being historical:
//
//     "The `isUid` flag sets the envelope `reserved` field to 1; despite the
//      name (kept for back-compat with the legacy API), `reserved = 1`
//      empirically signals the UIN-form variant of an OIDB call."
//
// So: `uinForm: true` -> `reserved: 1`.  Do not "clean up" the name here
// without checking every spec, because 0x8b7_5, 0x12b6_0 and 0x6d6_0 differ
// from each other on exactly this bit.
//
// ---------------------------------------------------------------------------
// Why one template, not 87 hand-written call sites
// ---------------------------------------------------------------------------
// The reference has one `invokeOidb` (reference/index.mjs:19136) and 87 thin
// specs that supply {command, subCommand, serialize, encode, decode,
// deserialize}.  Reproducing that shape means a new command is data, not code,
// and it means the error handling below is written once.

import {
  ProtoReader,
  ProtoWriter,
  UnknownFieldCollector,
  tagOf,
  WireType,
  type UnknownFieldMetadata,
} from "./wire.js";

/** Field numbers of the envelope. Named so the encoder and decoder cannot drift apart. */
export const OidbBaseField = {
  command: 1,
  subCommand: 2,
  errorCode: 3,
  body: 4,
  errorMsg: 5,
  properties: 11,
  reserved: 12,
} as const;

/**
 * `OidbProperty` — the only submessage the envelope itself defines.
 * Reference: reference/index.mjs:19390 (`__write_OidbProperty$108`) and
 * reference/index.mjs:19448 (`protobuf_decode_OidbProperty$108`).
 */
export const OidbPropertyField = { key: 1, value: 2 } as const;

export interface OidbProperty {
  key: string;
  value: Uint8Array;
}

/** Encode one `OidbProperty`. */
export function encodeOidbProperty(property: OidbProperty): Uint8Array {
  return new ProtoWriter()
    .string(OidbPropertyField.key, property.key)
    .bytes(OidbPropertyField.value, property.value)
    .finish();
}

/** Decode one `OidbProperty`. */
export function decodeOidbProperty(data: Uint8Array, offset = 0, end = data.length): OidbProperty {
  const reader = new ProtoReader(data, offset, end);
  let key = "";
  let value: Uint8Array = new Uint8Array(0);
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbPropertyField.key, WireType.lengthDelimited):
        key = reader.string();
        break;
      case tagOf(OidbPropertyField.value, WireType.lengthDelimited):
        value = reader.bytes();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return { key, value };
}

/**
 * The envelope as a plain value, before encoding.
 *
 * `body` is already-encoded bytes rather than a generic: it keeps this module
 * free of any knowledge of the 87 payload types, and it means a body can be
 * swapped in a test without a full spec.
 */
export interface OidbEnvelope {
  command: number;
  subCommand: number;
  errorCode: number;
  errorMsg: string;
  reserved: number;
  body: Uint8Array;
  properties?: OidbProperty[];
}

/**
 * Build a request envelope.
 *
 * `errorCode` is 0 and `errorMsg` is "" because protobuf's presence rules drop
 * both, so they cost no bytes on the wire; they are carried here only so that
 * the outbound value has the same shape as a decoded one.
 *
 * Reference: reference/index.mjs:18818.
 */
export function makeOidbEnvelope(
  command: number,
  subCommand: number,
  body: Uint8Array,
  uinForm = false,
): OidbEnvelope {
  return {
    command,
    subCommand,
    errorCode: 0,
    errorMsg: "",
    body,
    reserved: uinForm ? 1 : 0,
  };
}

/** Encode an `OidbBase<T>` envelope to wire bytes. */
export function encodeOidbEnvelope(envelope: OidbEnvelope): Uint8Array {
  const writer = new ProtoWriter(64 + envelope.body.length);
  writer.uint32(OidbBaseField.command, envelope.command);
  writer.uint32(OidbBaseField.subCommand, envelope.subCommand);
  writer.uint32(OidbBaseField.errorCode, envelope.errorCode);
  writer.message(OidbBaseField.body, envelope.body);
  writer.string(OidbBaseField.errorMsg, envelope.errorMsg);
  if (envelope.properties && envelope.properties.length > 0) {
    writer.repeatedMessage(
      OidbBaseField.properties,
      envelope.properties.map((p) => encodeOidbProperty(p)),
    );
  }
  writer.uint32(OidbBaseField.reserved, envelope.reserved);
  return writer.finish();
}

/**
 * Just the envelope's status fields — command, subCommand, errorCode, errorMsg,
 * reserved — without touching `body`.
 *
 * The reference uses this shape as its pre-decode validation step
 * (reference/index.mjs:18935 `protobuf_decode_OidbBaseMeta`, called from
 * `invokeOidb` at reference/index.mjs:19148): the server reports failures in
 * the envelope, so there is no point decoding a body that belongs to an error
 * response.  Skipping the body also means a truncated or unexpected body cannot
 * mask the real server error behind a parse exception.
 */
export interface OidbBaseMeta {
  command: number | null;
  subCommand: number | null;
  errorCode: number | null;
  errorMsg: string | null;
  reserved: number | null;
  unknown: UnknownFieldMetadata;
}

/**
 * Decode only the envelope's status fields, skipping `body` and `properties`.
 *
 * Reference: reference/index.mjs:18935.
 */
export function decodeOidbBaseMeta(data: Uint8Array, offset = 0, end = data.length): OidbBaseMeta {
  const reader = new ProtoReader(data, offset, end);
  let command: number | null = null;
  let subCommand: number | null = null;
  let errorCode: number | null = null;
  let errorMsg: string | null = null;
  let reserved: number | null = null;
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbBaseField.command, WireType.varint):
        command = reader.uint32();
        break;
      case tagOf(OidbBaseField.subCommand, WireType.varint):
        subCommand = reader.uint32();
        break;
      case tagOf(OidbBaseField.errorCode, WireType.varint):
        errorCode = reader.uint32();
        break;
      case tagOf(OidbBaseField.errorMsg, WireType.lengthDelimited):
        errorMsg = reader.string();
        break;
      case tagOf(OidbBaseField.reserved, WireType.varint):
        reserved = reader.int32();
        break;
      default:
        // `body` and `properties` land here; skipping is the point.
        reader.skip(unknown);
        break;
    }
  }
  return { command, subCommand, errorCode, errorMsg, reserved, unknown: unknown.snapshot() };
}

/**
 * A fully decoded envelope, with `body` already passed through the
 * command-specific decoder.
 */
export interface DecodedOidbEnvelope<T> {
  command: number | null;
  subCommand: number | null;
  errorCode: number | null;
  errorMsg: string | null;
  reserved: number | null;
  properties: OidbProperty[];
  /** `null` when the response carried no body at all. */
  body: T | null;
  unknown: UnknownFieldMetadata;
}

/**
 * Decode an envelope and its body.
 *
 * `decodeBody` receives the body's byte range.  When the response has no field
 * 4 at all, `body` comes back `null` rather than as a default-constructed
 * value: `invokeOidb` distinguishes "no body" from "empty body" when it falls
 * back to `{}`, and an empty message and an absent message are different wire
 * states (a present-but-empty field 4 still costs two bytes).
 *
 * Reference: reference/index.mjs:19136-19158, with `protobuf_decode_OidbBase__*`
 * generated pairs (e.g. reference/index.mjs:51976) doing the field walk.
 */
export function decodeOidbEnvelope<T>(
  data: Uint8Array,
  decodeBody: (data: Uint8Array, offset: number, end: number) => T,
  offset = 0,
  end = data.length,
): DecodedOidbEnvelope<T> {
  const reader = new ProtoReader(data, offset, end);
  let command: number | null = null;
  let subCommand: number | null = null;
  let errorCode: number | null = null;
  let errorMsg: string | null = null;
  let reserved: number | null = null;
  let body: T | null = null;
  const properties: OidbProperty[] = [];
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbBaseField.command, WireType.varint):
        command = reader.uint32();
        break;
      case tagOf(OidbBaseField.subCommand, WireType.varint):
        subCommand = reader.uint32();
        break;
      case tagOf(OidbBaseField.errorCode, WireType.varint):
        errorCode = reader.uint32();
        break;
      case tagOf(OidbBaseField.body, WireType.lengthDelimited):
        body = reader.message(decodeBody);
        break;
      case tagOf(OidbBaseField.errorMsg, WireType.lengthDelimited):
        errorMsg = reader.string();
        break;
      case tagOf(OidbBaseField.properties, WireType.lengthDelimited):
        properties.push(reader.message(decodeOidbProperty));
        break;
      case tagOf(OidbBaseField.reserved, WireType.varint):
        reserved = reader.int32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return {
    command,
    subCommand,
    errorCode,
    errorMsg,
    reserved,
    properties,
    body,
    unknown: unknown.snapshot(),
  };
}

/** Non-zero, non-null error code, i.e. the server rejected the call. */
export function oidbErrorCode(meta: { errorCode: number | null }): number | null {
  const code = meta.errorCode;
  return code != null && code !== 0 ? code : null;
}

/**
 * The wire command name for a call: `OidbSvcTrpcTcp.0x<hex>_<sub>`.
 *
 * Lower-case hex, no padding — that is what the server expects, and it is what
 * the reference produces (reference/index.mjs:19140).
 */
export function oidbWireName(command: number, subCommand: number): string {
  return `OidbSvcTrpcTcp.0x${command.toString(16)}_${subCommand}`;
}

/** Raised when the server returns a non-zero envelope error code. */
export class OidbError extends Error {
  readonly code: number;
  readonly serverMsg: string;
  readonly command: number;
  readonly subCommand: number;

  constructor(code: number, serverMsg: string, command: number, subCommand: number) {
    super(`OIDB error ${code} on 0x${command.toString(16)}_${subCommand}: ${serverMsg}`);
    this.name = "OidbError";
    this.code = code;
    this.serverMsg = serverMsg;
    this.command = command;
    this.subCommand = subCommand;
  }
}

/**
 * Decode a response envelope, raising `OidbError` for a non-zero status.
 *
 * `acceptedCodes` lets a spec declare codes it handles itself — the reference
 * has `acceptedEnvelopeCodes` for exactly that (reference/index.mjs:19112
 * `isAcceptedEnvelopeCode`), because a few endpoints report a "successful
 * negative" (e.g. "file does not exist") through field 3.
 *
 * Reference: reference/index.mjs:19145-19152.
 */
export function decodeOidbResponse<T>(
  spec: { command: number; subCommand: number; acceptedEnvelopeCodes?: readonly number[] },
  data: Uint8Array,
  decodeBody: (data: Uint8Array, offset: number, end: number) => T,
): DecodedOidbEnvelope<T> {
  const decoded = decodeOidbEnvelope(data, decodeBody);
  const code = oidbErrorCode(decoded);
  if (code !== null && spec.acceptedEnvelopeCodes?.includes(code) !== true) {
    throw new OidbError(code, decoded.errorMsg ?? "", spec.command, spec.subCommand);
  }
  return decoded;
}