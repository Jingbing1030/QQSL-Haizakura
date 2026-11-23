// The my-device (数据线 / dataline) message codec and the pseudo-contact table.
//
// ---------------------------------------------------------------------------
// What a "dataline" contact is
// ---------------------------------------------------------------------------
// QQ's 我的电脑 / 我的手机 / 我的Pad are not friends. They are three pseudo-contacts at
// fixed QQ numbers (`2113929217..19`) with fixed uids, and messages to them do not go
// through the c2c path at all — they go through `routingHead.trans0x211` with a
// `DatalineMsgBody`, the same routing slot the c2c *file* send uses with
// `ccCmd: 4` (dataline uses `ccCmd: 7`).
//
// So `MessageApi.sendPrivate` branches before it does anything else: if the target uin
// is one of the three, the message becomes text-only dataline traffic and the normal
// element machinery is never reached. That branch is why `sendPrivate` can throw "this
// contact only accepts text messages" on a segment type the c2c path would have been
// happy to encode.
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
// `DatalineMsgBody.generic` is field **6** (fields 3 is the *repeated* `ftn`, 4 and 5
// are unused). `DatalineMsgHeader` is 1..10 with `srcTerType`/`dstTerType` at 9/10 —
// the transport selects the destination device from those two, so an off-by-one there
// sends a text to the wrong device rather than failing.
//
// `DatalineFtnNotify.fileIndex` is a **string** field (3), while `sessionId` is uint64
// and `fileLen` uint64 — three different numeric treatments in one message.

import { ProtoReader, ProtoWriter, UnknownFieldCollector } from "../../oidb/wire.js";

// ===========================================================================
// The pseudo-contact table
// ===========================================================================

/**
 * One my-device contact.
 *
 * `terType` is the device class the header carries: 1 = PC, 2 = phone, 3 = Pad. The
 * uids are constants of the QQ client, not per-account.
 */
export interface DatalineDevice {
  readonly terType: number;
  readonly uid: string;
  readonly name: string;
  readonly uin: number;
}

/** reference/index.mjs:23372 `DATALINE_DEVICES`. */
export const DATALINE_DEVICES: readonly DatalineDevice[] = [
  { terType: 1, uid: "u_rK7NMsbv2ZjEGPdCuOiCfw", name: "我的电脑", uin: 2113929217 },
  { terType: 2, uid: "u_Wcc5rknRRqRO8y5gxMD6sA", name: "我的手机", uin: 2113929218 },
  { terType: 3, uid: "u_l7jpPIZxQo0mzJwoEt-SKw", name: "我的Pad", uin: 2113929219 },
];

const BY_UIN = new Map<number, DatalineDevice>(DATALINE_DEVICES.map((d) => [d.uin, d]));
const BY_TER = new Map<number, DatalineDevice>(DATALINE_DEVICES.map((d) => [d.terType, d]));

/** reference/index.mjs:23399 `findDatalineDeviceByUin`. Returns undefined for a normal friend. */
export function findDatalineDeviceByUin(uin: number): DatalineDevice | undefined {
  return BY_UIN.get(uin);
}

/** reference/index.mjs:23402 `findDatalineDeviceByTerType`. */
export function findDatalineDeviceByTerType(terType: number): DatalineDevice | undefined {
  return BY_TER.get(terType);
}

/**
 * reference/index.mjs:23443 `appIdForTerType`.
 *
 * PC is app id 1 and everything else is 1001 — a real asymmetry in the client, not a
 * simplification: a Pad message stamped with app id 1 is not delivered.
 */
export function appIdForTerType(terType: number): number {
  return terType === 1 ? 1 : 1001;
}

// ===========================================================================
// Messages
// ===========================================================================

/** `DatalineTextMsg` — `{items}` at field 1, repeated. */
export interface DatalineTextMsg {
  items?: readonly DatalineTextItem[] | null;
}

/** `DatalineTextItem` — `{type, text}` at fields 1 and 2. `text` is raw UTF-8 bytes. */
export interface DatalineTextItem {
  type?: number | null;
  text?: Uint8Array | null;
}

/** `DatalineMsgBody` — `subCmd` 1, `header` 2, `ftn` 3 (repeated), `generic` **6**. */
export interface DatalineMsgBody {
  subCmd?: number | null;
  header?: DatalineMsgHeader | null;
  ftn?: readonly DatalineFtnNotify[] | null;
  generic?: DatalineGenericSubCmd | null;
}

/** `DatalineMsgHeader` — fields 1..10. */
export interface DatalineMsgHeader {
  srcAppId?: number | null;
  srcInstId?: number | null;
  dstAppId?: number | null;
  dstInstId?: number | null;
  /** Field 5, uint64. */
  dstUin?: bigint | number | null;
  /** Field 6, uint64. */
  srcUin?: bigint | number | null;
  srcUinType?: number | null;
  dstUinType?: number | null;
  srcTerType?: number | null;
  dstTerType?: number | null;
}

/** `DatalineFtnNotify` — file-transfer notification, fields 1..6. */
export interface DatalineFtnNotify {
  /** Field 1, uint64. */
  sessionId?: bigint | number | null;
  /** Field 2. */
  fileName?: string | null;
  /** Field 3, a STRING despite the name. */
  fileIndex?: string | null;
  /** Field 4. */
  fileMd5?: Uint8Array | null;
  /** Field 5. */
  fileKey?: string | null;
  /** Field 6, uint64. */
  fileLen?: bigint | number | null;
}

/** `DatalineGenericSubCmd` — fields 1..5, `buf` a nested message's bytes. */
export interface DatalineGenericSubCmd {
  /** Field 1, uint64 — the reference uses `BigInt(Date.now())`. */
  sessionId?: bigint | number | null;
  /** Field 2. */
  size?: number | null;
  /** Field 3. */
  index?: number | null;
  /** Field 4. */
  type?: number | null;
  /** Field 5. */
  buf?: Uint8Array | null;
}

// ===========================================================================
// Constants
// ===========================================================================

/** reference/index.mjs:151612 `DATALINE_SUBCMD_FTN`. */
export const DATALINE_SUBCMD_FTN = 1;
/** reference/index.mjs:151613 `DATALINE_SUBCMD_GENERIC`. */
export const DATALINE_SUBCMD_GENERIC = 4;
/** reference/index.mjs:151614 `DATALINE_GENERIC_TEXT`. */
export const DATALINE_GENERIC_TEXT = 1;
/** reference/index.mjs:151615 `DATALINE_TEXT_ITEM`. */
export const DATALINE_TEXT_ITEM = 1;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function uint64Of(value: bigint | number): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

// ===========================================================================
// Encoders
// ===========================================================================

function encodeDatalineTextItem(obj: DatalineTextItem): Uint8Array {
  return new ProtoWriter(32).uint32(1, obj.type).bytes(2, obj.text).finish();
}

/** `DatalineTextMsg` — one tag per item, nothing at all when the list is empty. */
export function encodeDatalineTextMsg(obj: DatalineTextMsg): Uint8Array {
  const w = new ProtoWriter(64);
  if (obj.items != null) for (const item of obj.items) w.message(1, encodeDatalineTextItem(item));
  return w.finish();
}

function encodeDatalineMsgHeader(obj: DatalineMsgHeader): Uint8Array {
  return new ProtoWriter(64)
    .uint32(1, obj.srcAppId)
    .uint32(2, obj.srcInstId)
    .uint32(3, obj.dstAppId)
    .uint32(4, obj.dstInstId)
    .uint64(5, obj.dstUin == null ? undefined : uint64Of(obj.dstUin))
    .uint64(6, obj.srcUin == null ? undefined : uint64Of(obj.srcUin))
    .uint32(7, obj.srcUinType)
    .uint32(8, obj.dstUinType)
    .uint32(9, obj.srcTerType)
    .uint32(10, obj.dstTerType)
    .finish();
}

function encodeDatalineFtnNotify(obj: DatalineFtnNotify): Uint8Array {
  return new ProtoWriter(64)
    .uint64(1, obj.sessionId == null ? undefined : uint64Of(obj.sessionId))
    .string(2, obj.fileName)
    .string(3, obj.fileIndex)
    .bytes(4, obj.fileMd5)
    .string(5, obj.fileKey)
    .uint64(6, obj.fileLen == null ? undefined : uint64Of(obj.fileLen))
    .finish();
}

function encodeDatalineGenericSubCmd(obj: DatalineGenericSubCmd): Uint8Array {
  return new ProtoWriter(64)
    .uint64(1, obj.sessionId == null ? undefined : uint64Of(obj.sessionId))
    .uint32(2, obj.size)
    .uint32(3, obj.index)
    .uint32(4, obj.type)
    .bytes(5, obj.buf)
    .finish();
}

/** `DatalineMsgBody` — `generic` at field **6**, `ftn` repeated at 3. */
export function encodeDatalineMsgBody(obj: DatalineMsgBody): Uint8Array {
  const w = new ProtoWriter(128);
  w.uint32(1, obj.subCmd);
  if (obj.header != null) w.message(2, encodeDatalineMsgHeader(obj.header));
  if (obj.ftn != null) for (const notify of obj.ftn) w.message(3, encodeDatalineFtnNotify(notify));
  if (obj.generic != null) w.message(6, encodeDatalineGenericSubCmd(obj.generic));
  return w.finish();
}

// ===========================================================================
// Decoders -- the receive side, ported because `elementsFromDatalineBody` needs it
// ===========================================================================

export function decodeDatalineTextItem(data: Uint8Array, offset = 0, end = data.length): DatalineTextItem {
  const reader = new ProtoReader(data, offset, end);
  const out: DatalineTextItem = { type: null, text: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case 8:
        out.type = reader.uint32();
        break;
      case 18:
        out.text = reader.bytes();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return out;
}

export function decodeDatalineTextMsg(data: Uint8Array, offset = 0, end = data.length): DatalineTextMsg {
  const reader = new ProtoReader(data, offset, end);
  const out: { items: DatalineTextItem[] } = { items: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case 10:
        out.items.push(reader.message(decodeDatalineTextItem));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return out;
}

export function decodeDatalineMsgHeader(data: Uint8Array, offset = 0, end = data.length): DatalineMsgHeader {
  const reader = new ProtoReader(data, offset, end);
  const out: DatalineMsgHeader = {
    srcAppId: null,
    srcInstId: null,
    dstAppId: null,
    dstInstId: null,
    dstUin: null,
    srcUin: null,
    srcUinType: null,
    dstUinType: null,
    srcTerType: null,
    dstTerType: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case 8: out.srcAppId = reader.uint32(); break;
      case 16: out.srcInstId = reader.uint32(); break;
      case 24: out.dstAppId = reader.uint32(); break;
      case 32: out.dstInstId = reader.uint32(); break;
      case 40: out.dstUin = reader.uint64(); break;
      case 48: out.srcUin = reader.uint64(); break;
      case 56: out.srcUinType = reader.uint32(); break;
      case 64: out.dstUinType = reader.uint32(); break;
      case 72: out.srcTerType = reader.uint32(); break;
      case 80: out.dstTerType = reader.uint32(); break;
      default: reader.skip(unknown); break;
    }
  }
  return out;
}

export function decodeDatalineFtnNotify(data: Uint8Array, offset = 0, end = data.length): DatalineFtnNotify {
  const reader = new ProtoReader(data, offset, end);
  const out: DatalineFtnNotify = {
    sessionId: null,
    fileName: null,
    fileIndex: null,
    fileMd5: null,
    fileKey: null,
    fileLen: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case 8: out.sessionId = reader.uint64(); break;
      case 18: out.fileName = reader.string(); break;
      case 26: out.fileIndex = reader.string(); break;
      case 34: out.fileMd5 = reader.bytes(); break;
      case 42: out.fileKey = reader.string(); break;
      case 48: out.fileLen = reader.uint64(); break;
      default: reader.skip(unknown); break;
    }
  }
  return out;
}

export function decodeDatalineGenericSubCmd(data: Uint8Array, offset = 0, end = data.length): DatalineGenericSubCmd {
  const reader = new ProtoReader(data, offset, end);
  const out: DatalineGenericSubCmd = { sessionId: null, size: null, index: null, type: null, buf: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case 8: out.sessionId = reader.uint64(); break;
      case 16: out.size = reader.uint32(); break;
      case 24: out.index = reader.uint32(); break;
      case 32: out.type = reader.uint32(); break;
      case 42: out.buf = reader.bytes(); break;
      default: reader.skip(unknown); break;
    }
  }
  return out;
}

export function decodeDatalineMsgBody(data: Uint8Array, offset = 0, end = data.length): DatalineMsgBody {
  const reader = new ProtoReader(data, offset, end);
  const out: { subCmd: number | null; header: DatalineMsgHeader | null; ftn: DatalineFtnNotify[]; generic: DatalineGenericSubCmd | null } = {
    subCmd: null,
    header: null,
    ftn: [],
    generic: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case 8: out.subCmd = reader.uint32(); break;
      case 18: out.header = reader.message(decodeDatalineMsgHeader); break;
      case 26: out.ftn.push(reader.message(decodeDatalineFtnNotify)); break;
      case 50: out.generic = reader.message(decodeDatalineGenericSubCmd); break;
      default: reader.skip(unknown); break;
    }
  }
  return out;
}

// ===========================================================================
// The send-side body builder
// ===========================================================================

/** Parameters for {@link encodeDatalineText}. */
export interface DatalineTextParams {
  /** The bot's own uin. Both `srcUin` and `dstUin` carry it: the device is addressed by terType. */
  selfUin: number;
  /** Destination device class; see {@link DatalineDevice.terType}. */
  dstTerType: number;
  text: string;
}

/**
 * reference/index.mjs:151625 `encodeDatalineText`.
 *
 * Both `srcUin` and `dstUin` are the BOT's uin. That reads wrong and is not: the wire
 * addresses the device by `dstTerType`, and the device is a view of the same account, so
 * putting the bot's uin in `dstUin` is what the client does. Substituting the device's
 * pseudo-uin (2113929217…) produces a body the transport drops.
 *
 * `srcTerType` defaults to 1 (PC) in the reference.
 */
export function encodeDatalineText(params: DatalineTextParams): Uint8Array {
  const srcTerType = 1;
  const buf = encodeDatalineTextMsg({ items: [{ type: DATALINE_TEXT_ITEM, text: textEncoder.encode(params.text) }] });
  const selfUin = BigInt(params.selfUin);
  return encodeDatalineMsgBody({
    subCmd: DATALINE_SUBCMD_GENERIC,
    header: {
      srcAppId: appIdForTerType(srcTerType),
      srcInstId: 1,
      dstAppId: appIdForTerType(params.dstTerType),
      dstInstId: 1,
      dstUin: selfUin,
      srcUin: selfUin,
      srcTerType,
      dstTerType: params.dstTerType,
    },
    generic: {
      sessionId: BigInt(Date.now()),
      size: 1,
      index: 0,
      type: DATALINE_GENERIC_TEXT,
      buf,
    },
  });
}

// ===========================================================================
// Element conversion (the receive side)
// ===========================================================================

function decodeGenericText(buf: Uint8Array | null): string {
  if (!buf || buf.length === 0) return "";
  const parsed = decodeDatalineTextMsg(buf);
  const parts: string[] = [];
  for (const item of parsed.items ?? []) {
    if (!item.text || item.text.length === 0) continue;
    parts.push(textDecoder.decode(item.text));
  }
  return parts.join("");
}

/**
 * The message-segment shape this module produces on the receive side.
 *
 * Declared locally rather than imported from `msg-push.ts`: the reference's dataline
 * codec builds plain objects that its converter later reads, and importing the segment
 * union would make this module depend on the inbound layer's entire type surface.
 */
export type DatalineSegment =
  | { type: "text"; text: string }
  | { type: "file"; fileId?: string; fileName?: string; fileSize?: number; md5Hex?: string };

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * reference/index.mjs:151670 `elementsFromDatalineBody`.
 *
 * Two independent sources of content, and both can fire on the same body: the generic
 * text sub-command, and the file-transfer notifications. A body carrying only `ftn` is a
 * file received on another device, which is why the `ftn` branch does not require
 * `subCmd === DATALINE_SUBCMD_FTN`.
 */
export function elementsFromDatalineBody(body: DatalineMsgBody): DatalineSegment[] {
  const elements: DatalineSegment[] = [];
  if (body.subCmd === DATALINE_SUBCMD_GENERIC || body.generic) {
    const genericType = body.generic?.type ?? 0;
    if (genericType === 0 || genericType === DATALINE_GENERIC_TEXT) {
      const text = decodeGenericText(body.generic?.buf ?? null);
      if (text.length > 0) elements.push({ type: "text", text });
    }
  }
  if (body.subCmd === DATALINE_SUBCMD_FTN || (body.ftn != null && body.ftn.length > 0)) {
    for (const notify of body.ftn ?? []) {
      // A notification with no name and no identifier at all is a placeholder the other
      // device emitted while the transfer was still being accepted.
      const fileName = notify.fileName?.trim();
      if (!fileName && notify.fileIndex == null && notify.sessionId == null) continue;
      const fileSize = notify.fileLen != null ? Number(notify.fileLen) : undefined;
      elements.push({
        type: "file",
        ...(notify.fileIndex || notify.sessionId != null
          ? { fileId: notify.fileIndex || String(notify.sessionId) }
          : {}),
        ...(fileName ? { fileName } : {}),
        ...(fileSize != null && Number.isFinite(fileSize) ? { fileSize } : {}),
        ...(notify.fileMd5 && notify.fileMd5.length > 0 ? { md5Hex: toHex(notify.fileMd5) } : {}),
      });
    }
  }
  return elements;
}

/**
 * reference/index.mjs:151692 `datalineTextFromElements`.
 *
 * Text only, and `join("")` rather than `join(" ")`: a caller that sends three text
 * segments gets them concatenated, which is what the reference does and what the device
 * expects (it appends the strings it receives in one bubble).
 */
export function datalineTextFromElements(elements: readonly { type: string; text?: string }[]): string {
  if (elements.length === 0) throw new Error("message is empty");
  const unsupported = elements.find((element) => element.type !== "text");
  if (unsupported) throw new Error(`this contact only accepts text messages, got ${unsupported.type}`);
  const text = elements
    .filter((element) => element.type === "text")
    .map((element) => element.text ?? "")
    .join("");
  if (text.length === 0) throw new Error("message is empty");
  return text;
}