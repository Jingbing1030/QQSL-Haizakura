// The `MessageSvc.PbSendMsg` wire layer: every request the send path builds and every
// response it reads, rebased onto the shared `ProtoWriter` / `ProtoReader`.
//
// ---------------------------------------------------------------------------
// Where this came from, and what "rebased" bought
// ---------------------------------------------------------------------------
// Reference region `src/bridge/apis/message.ts`, `reference/index.mjs:298712-309793`
// (11,081 lines). Of those, the codec closure reachable from this region's eight
// `MessageApi` call sites is **99 generated functions** — 24 messages' worth of
// `protobuf_encode_*` / `__size_*` / `__write_*` triples plus 5 `protobuf_decode_*`
// trees. Everything else in the region is the logic half (`MessageApi` plus its
// helpers), which lives in `message.ts`.
//
// The generated half is a size-pass/write-pass codec with a slot table, emitted three
// times per message (encode, size, write). Porting it verbatim would be ~6,900 lines.
// Against `ProtoWriter` it is the ~700 below, with **no message dropped and no field
// dropped** — every field of every message in the closure is written here, including
// the ones the reference writes as present-and-zero.
//
// **A `$N` selection problem that does not exist in this region.** MEMORY.md §2.3ab
// records that within one region the bare-name and `$N` copies of a message can differ
// in field NUMBERS, so the copy named by the spec's own call site is the only correct
// one. This region has 121 top-level functions and **zero `$`-suffixed ones** (measured,
// see `work/bridge-message/extract-enc.py`), so every name `MessageApi` calls resolves
// to exactly one definition. The satellite regions this file also draws from
// (`fetch-c2c-history.ts`, `fetch-group-history.ts`) DO have `$N` copies, and there the
// selection was made by call site: `protobuf_encode_SsoGetC2cMsg$1` and its response
// decoder `protobuf_decode_SsoGetC2cMsgResponse$1`, `protobuf_decode_PushMsgBody$1`
// (group history) and `$3` (c2c history). Those two `PushMsgBody` copies were verified
// field-for-field identical to the bare name before being aliased.
//
// ---------------------------------------------------------------------------
// The field numbers below are read off the writers, not from convention
// ---------------------------------------------------------------------------
// Three traps in this message family, each of which produces bytes that decode cleanly
// and mean something else:
//
//   1. **`RoutingHead.trans0x211` is field 15**, not 4. The writer emits tag `122`
//      (= 15<<3 | 2). Every other routing member is sequential 1..3, so 4 is the
//      guess, and the guess routes a dataline/file send into an empty field the
//      server ignores. Same family: `RoutingGrpTmp.groupUin` is field **3** and
//      `toUid` field **4** (1 and 2 unused), and `RoutingTrans0x211.uid` is field
//      **8** (3..7 unused).
//
//   2. **`MessageControl`'s envelope numbers are not 1..10.** The message's own
//      top-level fields are 1, 2, 3, 4, 5, 6, **8**, **9**, **12**, **14** — there is
//      no field 7, 10, 11 or 13. `via` is 8, `dataStatist` 9, `ctrl` 12,
//      `multiSendSeq` 14. (Tags 64/72/98/112 confirm.) `ctrl` at 66/field 8 is the
//      natural guess and it is wrong by four.
//
//   3. **`clientSequence` really is field 4.** An earlier port of the group request
//      (`ts/src/send-message-request.ts`) records it as field 4 in its code and field 3
//      in its header comment, which is the residue of the last disagreement. The writer
//      emits tag `32` = field 4. The comment's field 3 was wrong; the code was right.
//      This file writes 4, and the header/private/temp/dataline/file sends all share it.
//
// The presence rules are per-field and are copied with the field, because protobuf
// "absent" and "present and zero" are different on the wire and the reference is not
// uniform about which it means:
//
//   * `SendMessageRequest.*` top level: `!= null` for the three submessages and `ctrl`;
//     `!= null && !== 0` for the numbers; `!= null && length > 0` for `syncCookie`.
//     So an explicit `clientSequence: 0` is DROPPED, and `ctrl: {msgFlag: 0}` is
//     EMITTED as a zero-length submessage.
//   * `SendMessageBody__bytes.richText` is `!= null && _f0.length > 0` where the
//     sibling `SendMessageBody__SendRichText.richText` uses `!= null` only — so an
//     empty richText is dropped in the c2c-file path and emitted in the group path.
//   * `C2CRecallSettings` / `C2CRecallRequest.field6` use `=== true`, the strict form.
//   * `GroupRecallRequest.groupUin` is `!== 0` on a number, but
//     `RoutingGroup.groupCode` is `!== 0n` on a bigint. Both guard zero, differently.

import { ProtoReader, ProtoWriter, UnknownFieldCollector } from "../../oidb/wire.js";

// ===========================================================================
// Request messages
// ===========================================================================

/** `SendMessageRequest` — the envelope shared by every send path. */
export interface MessageControlFields {
  routingHead?: RoutingHead | null;
  contentHead?: SendContentHead | null;
  messageBody?: SendMessageBodySendRichText | SendMessageBodyBytes | null;
  /** Field 4. Dropped when 0. */
  clientSequence?: number | null;
  /** Field 5. Dropped when 0. */
  random?: number | null;
  /** Field 6. Dropped when empty — and every send path passes an empty one. */
  syncCookie?: Uint8Array | null;
  /** Field 8. Dropped when 0. */
  via?: number | null;
  /** Field 9. Dropped when 0. */
  dataStatist?: number | null;
  /** Field 12. Emitted whenever it is present, even with `msgFlag: 0`. */
  ctrl?: MessageControlFlags | null;
  /** Field 14. Dropped when 0. */
  multiSendSeq?: number | null;
}

/**
 * `MessageControl` — the envelope's single field.
 *
 * Named for the message that carries it; the outer request is `SendMessageRequest`.
 * Field 1, `!= null && !== 0`.
 */
export interface MessageControlFlags {
  msgFlag?: number | null;
}

export interface RoutingHead {
  /** Field 1. */
  c2c?: RoutingC2C | null;
  /** Field 2. */
  grp?: RoutingGroup | null;
  /** Field 3. */
  grpTmp?: RoutingGrpTmp | null;
  /** Field **15**. See the header. */
  trans0x211?: RoutingTrans0x211 | null;
}

export interface RoutingC2C {
  /** Field 1, uint32. */
  uin?: number | null;
  /** Field 2, dropped when empty. */
  uid?: string | null;
}

export interface RoutingGroup {
  /** Field 1, uint64. */
  groupCode?: bigint | number | null;
}

export interface RoutingGrpTmp {
  /** Field **3**, uint64. */
  groupUin?: bigint | number | null;
  /** Field **4**. */
  toUid?: string | null;
}

export interface RoutingTrans0x211 {
  /** Field 1, uint64. */
  toUin?: bigint | number | null;
  /** Field 2, uint32. */
  ccCmd?: number | null;
  /** Field **8**. */
  uid?: string | null;
}

export interface SendContentHead {
  /** Field 1. */
  type?: number | null;
  /** Field 2. */
  subType?: number | null;
  /** Field 3. */
  c2cCmd?: number | null;
}

/** `SendMessageBody` in its rich-text form: `{richText, msgContent}`, fields 1 and 2. */
export interface SendMessageBodySendRichText {
  /** Field 1, emitted whenever present (`!= null`), even when empty. */
  richText?: RichText | null;
  /** Field 2, dropped when empty. */
  msgContent?: Uint8Array | null;
}

/**
 * `SendMessageBody` in its bytes form.
 *
 * Byte-identical schema to the rich-text variant; the difference is the presence rule
 * on field 1 and that `richText` is already-encoded bytes here. Both are modelled
 * because the reference declares two messages and the guards are not the same.
 */
export interface SendMessageBodyBytes {
  /** Field 1, dropped when empty here (`!= null && length > 0`). */
  richText?: Uint8Array | null;
  /** Field 2, dropped when empty. */
  msgContent?: Uint8Array | null;
}

/** `SendRichText` — `{elems}`, field **2** (field 1 unused), repeated. */
export interface RichText {
  elems?: readonly Uint8Array[] | null;
}

/** `FileExtra` — `{file, field6}`, fields 1 and 6. */
export interface FileExtra {
  /** Field 1, `NotOnlineFile`. */
  file?: NotOnlineFile | null;
  /** Field 6, `PrivateFileExtra`. */
  field6?: PrivateFileExtra | null;
}

/**
 * `NotOnlineFile` — the c2c file metadata message.
 *
 * Field numbers cross-checked against `ts/src/msg-push-fields.ts`'s
 * `NOT_ONLINE_FILE_FIELDS` (the inbound decoder for the same message): 1, 3, 4, 5, 6,
 * 9, 12, 50, 55, 56, 57 — identical. That agreement is the strongest available
 * evidence, because the two tables were derived from separate regions by separate
 * passes.
 */
export interface NotOnlineFile {
  /** Field 1. */
  fileType?: number | null;
  /** Field 3. */
  fileUuid?: string | null;
  /** Field 4. */
  fileMd5?: Uint8Array | null;
  /** Field 5. */
  fileName?: string | null;
  /** Field 6, uint64. */
  fileSize?: bigint | number | null;
  /** Field 9. Required-on-send by the server's intake validator. */
  subcmd?: number | null;
  /** Field 12. */
  downloadFlag?: number | null;
  /** Field 50. Virus-scan severity, always 0 client-side. */
  dangerEvel?: number | null;
  /** Field 55. */
  expireTime?: number | null;
  /** Field 56. */
  pbReserve?: Uint8Array | null;
  /** Field 57. */
  fileHash?: string | null;
}

/** `PrivateFileExtra` — `{field2}`, field 2. */
export interface PrivateFileExtra {
  /** Field 2. */
  field2?: PrivateFileExtraField2 | null;
}

/**
 * `PrivateFileExtraField2` — the server-issued download routing from a 0xE37_800
 * finalize.
 *
 * `destUid` is field **16**, which needs a two-byte tag (`130` `1`). That is the only
 * field in the whole send path that does, and a one-byte tag there would alias field
 * 2's wire slot.
 */
export interface PrivateFileExtraField2 {
  /** Field 1. */
  field1?: number | null;
  /** Field 4. */
  fileUuid?: string | null;
  /** Field 5. */
  fileName?: string | null;
  /** Field 6. */
  field6?: number | null;
  /** Field 7. */
  field7?: Uint8Array | null;
  /** Field 8. */
  field8?: Uint8Array | null;
  /** Field 9. */
  timestamp1?: number | null;
  /** Field 14. */
  fileHash?: string | null;
  /** Field 15. */
  selfUid?: string | null;
  /** Field 16. */
  destUid?: string | null;
}

/** `GroupRecallRequest` — fields 1, 2, 3, 4. */
export interface GroupRecallRequest {
  /** Field 1. */
  type?: number | null;
  /** Field 2, `!== 0` on a NUMBER (not a bigint, unlike `RoutingGroup`). */
  groupUin?: number | null;
  /** Field 3. */
  info?: GroupRecallInfo | null;
  /** Field 4. */
  settings?: GroupRecallSettings | null;
}

export interface GroupRecallInfo {
  /** Field 1. */
  sequence?: number | null;
  /** Field 2. */
  random?: number | null;
  /** Field 3. */
  field3?: number | null;
}

export interface GroupRecallSettings {
  /** Field 1. */
  field1?: number | null;
}

/** `C2CRecallRequest` — fields 1, 3, 4, 5, 6. Field 2 is unused. */
export interface C2CRecallRequest {
  /** Field 1. */
  type?: number | null;
  /** Field **3**. */
  targetUid?: string | null;
  /** Field 4. */
  info?: C2CRecallInfo | null;
  /** Field 5. */
  settings?: C2CRecallSettings | null;
  /** Field 6, emitted only on strict `true`. */
  field6?: boolean | null;
}

export interface C2CRecallInfo {
  /** Field 1. */
  clientSequence?: number | null;
  /** Field 2. */
  random?: number | null;
  /** Field 3, uint64. */
  messageId?: bigint | number | null;
  /** Field 4. */
  timestamp?: number | null;
  /** Field 5. */
  field5?: number | null;
  /** Field 6. */
  messageSequence?: number | null;
}

export interface C2CRecallSettings {
  /** Field 1, strict `=== true`. */
  field1?: boolean | null;
  /** Field 2, strict `=== true`. */
  field2?: boolean | null;
}

/** `SsoReadedReportReq` — `{groupList, c2cList}`, fields 1 and 2, repeated. */
export interface SsoReadedReportReq {
  groupList?: readonly GroupReadedReportItem[] | null;
  c2cList?: readonly C2CReadedReportItem[] | null;
}

/** `GroupReadedReportItem` — `{groupUin, lastReadSeq}`, fields 1 and 2, both uint64. */
export interface GroupReadedReportItem {
  groupUin?: bigint | number | null;
  lastReadSeq?: bigint | number | null;
}

/**
 * `C2CReadedReportItem` — fields **2**, 3, 4. Field 1 is unused.
 *
 * `uid` at 2 rather than the natural 1 is the same off-by-one family as the routing
 * heads: a request with uid in field 1 sends a report for an unnamed session.
 */
export interface C2CReadedReportItem {
  /** Field **2**. */
  uid?: string | null;
  /** Field 3, uint64. */
  lastReadTime?: bigint | number | null;
  /** Field 4, uint64. */
  lastReadSeq?: bigint | number | null;
}

/**
 * `SsoGetGroupMsg` — group history request.
 *
 * `direction` is a BOOL via the strict `=== true` rule (the writer emits `if (_f1 ===
 * true)`), so `direction: 1` produces no field at all. The reference passes `true`.
 */
export interface SsoGetGroupMsgRequest {
  /** Field 1. */
  info?: SsoGetGroupMsgInfo | null;
  /** Field 2, strict `=== true`. */
  direction?: boolean | null;
}

/** `SsoGetGroupMsgInfo` — fields **3**, 4, 5. Fields 1 and 2 are unused. */
export interface SsoGetGroupMsgInfo {
  /** Field **3**, uint32. */
  groupUin?: number | null;
  /** Field 4, uint32. */
  startSequence?: number | null;
  /** Field 5, uint32. */
  endSequence?: number | null;
}

/** `SsoGetC2cMsg` — private history request. Fields **2**, 3, 4. Field 1 is unused. */
export interface SsoGetC2cMsgRequest {
  /** Field **2**. */
  friendUid?: string | null;
  /** Field 3. */
  startSequence?: number | null;
  /** Field 4. */
  endSequence?: number | null;
}

/** `SsoGetRoamMsg` — timestamp-cursor private history. Fields 1..5. */
export interface SsoGetRoamMsgRequest {
  /** Field 1. */
  friendUid?: string | null;
  /** Field 2. */
  time?: number | null;
  /** Field 3. */
  random?: number | null;
  /** Field 4. */
  count?: number | null;
  /** Field 5, strict `=== true`. */
  direction?: boolean | null;
}

// ===========================================================================
// Encoders
// ===========================================================================

function uint64Of(value: bigint | number): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function encodeRoutingC2C(obj: RoutingC2C): Uint8Array {
  return new ProtoWriter(24).uint32(1, obj.uin).string(2, obj.uid).finish();
}

function encodeRoutingGroup(obj: RoutingGroup): Uint8Array {
  return new ProtoWriter(16).uint64(1, obj.groupCode == null ? undefined : uint64Of(obj.groupCode)).finish();
}

function encodeRoutingGrpTmp(obj: RoutingGrpTmp): Uint8Array {
  return new ProtoWriter(40)
    .uint64(3, obj.groupUin == null ? undefined : uint64Of(obj.groupUin))
    .string(4, obj.toUid)
    .finish();
}

function encodeRoutingTrans0x211(obj: RoutingTrans0x211): Uint8Array {
  return new ProtoWriter(40)
    .uint64(1, obj.toUin == null ? undefined : uint64Of(obj.toUin))
    .uint32(2, obj.ccCmd)
    .string(8, obj.uid)
    .finish();
}

function encodeRoutingHead(obj: RoutingHead): Uint8Array {
  const w = new ProtoWriter(64);
  if (obj.c2c != null) w.message(1, encodeRoutingC2C(obj.c2c));
  if (obj.grp != null) w.message(2, encodeRoutingGroup(obj.grp));
  if (obj.grpTmp != null) w.message(3, encodeRoutingGrpTmp(obj.grpTmp));
  if (obj.trans0x211 != null) w.message(15, encodeRoutingTrans0x211(obj.trans0x211));
  return w.finish();
}

function encodeSendContentHead(obj: SendContentHead): Uint8Array {
  return new ProtoWriter(16).uint32(1, obj.type).uint32(2, obj.subType).uint32(3, obj.c2cCmd).finish();
}

function encodeMessageControlFlags(obj: MessageControlFlags): Uint8Array {
  return new ProtoWriter(8).uint32(1, obj.msgFlag).finish();
}

/** `SendRichText` — elems at field **2**, one tag per element, nothing when empty. */
export function encodeSendRichTextMessage(obj: RichText): Uint8Array {
  return new ProtoWriter(64).repeatedMessage(2, obj.elems).finish();
}

function encodeSendMessageBodySendRichText(obj: SendMessageBodySendRichText): Uint8Array {
  const w = new ProtoWriter(64);
  // `!= null` — an explicit empty richText is emitted as a zero-length field 1.
  if (obj.richText != null) w.message(1, encodeSendRichTextMessage(obj.richText));
  w.bytes(2, obj.msgContent);
  return w.finish();
}

function encodeSendMessageBodyBytes(obj: SendMessageBodyBytes): Uint8Array {
  return new ProtoWriter(64).bytes(1, obj.richText).bytes(2, obj.msgContent).finish();
}

/** `NotOnlineFile` — see the interface comment for the field-number cross-check. */
export function encodeNotOnlineFile(obj: NotOnlineFile): Uint8Array {
  return new ProtoWriter(64)
    .uint32(1, obj.fileType)
    .string(3, obj.fileUuid)
    .bytes(4, obj.fileMd5)
    .string(5, obj.fileName)
    .uint64(6, obj.fileSize == null ? undefined : uint64Of(obj.fileSize))
    .uint32(9, obj.subcmd)
    .uint32(12, obj.downloadFlag)
    .uint32(50, obj.dangerEvel)
    .uint32(55, obj.expireTime)
    .bytes(56, obj.pbReserve)
    .string(57, obj.fileHash)
    .finish();
}

function encodePrivateFileExtraField2(obj: PrivateFileExtraField2): Uint8Array {
  return new ProtoWriter(64)
    .uint32(1, obj.field1)
    .string(4, obj.fileUuid)
    .string(5, obj.fileName)
    .uint32(6, obj.field6)
    .bytes(7, obj.field7)
    .bytes(8, obj.field8)
    .uint32(9, obj.timestamp1)
    .string(14, obj.fileHash)
    .string(15, obj.selfUid)
    .string(16, obj.destUid)
    .finish();
}

function encodePrivateFileExtra(obj: PrivateFileExtra): Uint8Array {
  const w = new ProtoWriter(32);
  if (obj.field2 != null) w.message(2, encodePrivateFileExtraField2(obj.field2));
  return w.finish();
}

/** `FileExtra` — `file` at 1, `field6` at 6. */
export function encodeFileExtra(obj: FileExtra): Uint8Array {
  const w = new ProtoWriter(64);
  if (obj.file != null) w.message(1, encodeNotOnlineFile(obj.file));
  if (obj.field6 != null) w.message(6, encodePrivateFileExtra(obj.field6));
  return w.finish();
}

/**
 * The envelope fields shared by `SendMessageRequest__SendRichText` and
 * `SendMessageRequest__bytes`.
 *
 * The two generated messages have identical schemas at this level — fields 1, 2, 3, 4,
 * 5, 6, 8, 9, 12, 14 with the same guards — and differ only in how `messageBody` is
 * encoded. So the shared part is written once (`envelope`) and the body is handed in
 * already encoded. Duplicating ten presence rules across two functions is exactly how
 * the "field 3 vs field 4" drift in `send-message-request.ts`'s header happened.
 */
function envelope(obj: Omit<MessageControlFields, "messageBody">, body: Uint8Array | undefined): Uint8Array {
  const w = new ProtoWriter(256);
  if (obj.routingHead != null) w.message(1, encodeRoutingHead(obj.routingHead));
  if (obj.contentHead != null) w.message(2, encodeSendContentHead(obj.contentHead));
  if (body != null) w.message(3, body);
  w.uint32(4, obj.clientSequence);
  w.uint32(5, obj.random);
  w.bytes(6, obj.syncCookie);
  w.uint32(8, obj.via);
  w.uint32(9, obj.dataStatist);
  // `!= null` — an explicit `{msgFlag: 0}` is still emitted, as a zero-length field 12.
  if (obj.ctrl != null) w.message(12, encodeMessageControlFlags(obj.ctrl));
  w.uint32(14, obj.multiSendSeq);
  return w.finish();
}

/** `SendMessageRequest` with a rich-text body: group, private, temp, dataline. */
export function encodeSendMessageRequestRichText(obj: MessageControlFields & { messageBody?: SendMessageBodySendRichText }): Uint8Array {
  return envelope(obj, obj.messageBody == null ? undefined : encodeSendMessageBodySendRichText(obj.messageBody));
}

/** `SendMessageRequest` with a bytes body: the c2c file path only. */
export function encodeSendMessageRequestBytes(obj: MessageControlFields & { messageBody?: SendMessageBodyBytes }): Uint8Array {
  return envelope(obj, obj.messageBody == null ? undefined : encodeSendMessageBodyBytes(obj.messageBody));
}

function encodeGroupRecallInfo(obj: GroupRecallInfo): Uint8Array {
  return new ProtoWriter(24).uint32(1, obj.sequence).uint32(2, obj.random).uint32(3, obj.field3).finish();
}

function encodeGroupRecallSettings(obj: GroupRecallSettings): Uint8Array {
  return new ProtoWriter(8).uint32(1, obj.field1).finish();
}

/** `GroupRecallRequest` — `groupUin` is a NUMBER field here, so 0 is dropped by `!== 0`. */
export function encodeGroupRecallRequest(obj: GroupRecallRequest): Uint8Array {
  const w = new ProtoWriter(48);
  w.uint32(1, obj.type);
  w.uint32(2, obj.groupUin);
  if (obj.info != null) w.message(3, encodeGroupRecallInfo(obj.info));
  if (obj.settings != null) w.message(4, encodeGroupRecallSettings(obj.settings));
  return w.finish();
}

function encodeC2CRecallInfo(obj: C2CRecallInfo): Uint8Array {
  return new ProtoWriter(40)
    .uint32(1, obj.clientSequence)
    .uint32(2, obj.random)
    .uint64(3, obj.messageId == null ? undefined : uint64Of(obj.messageId))
    .uint32(4, obj.timestamp)
    .uint32(5, obj.field5)
    .uint32(6, obj.messageSequence)
    .finish();
}

function encodeC2CRecallSettings(obj: C2CRecallSettings): Uint8Array {
  return new ProtoWriter(8).bool(1, obj.field1).bool(2, obj.field2).finish();
}

/** `C2CRecallRequest` — `targetUid` at field **3**, `field6` on strict `true`. */
export function encodeC2CRecallRequest(obj: C2CRecallRequest): Uint8Array {
  const w = new ProtoWriter(64);
  w.uint32(1, obj.type);
  w.string(3, obj.targetUid);
  if (obj.info != null) w.message(4, encodeC2CRecallInfo(obj.info));
  if (obj.settings != null) w.message(5, encodeC2CRecallSettings(obj.settings));
  w.bool(6, obj.field6);
  return w.finish();
}

function encodeGroupReadedReportItem(obj: GroupReadedReportItem): Uint8Array {
  return new ProtoWriter(24)
    .uint64(1, obj.groupUin == null ? undefined : uint64Of(obj.groupUin))
    .uint64(2, obj.lastReadSeq == null ? undefined : uint64Of(obj.lastReadSeq))
    .finish();
}

function encodeC2CReadedReportItem(obj: C2CReadedReportItem): Uint8Array {
  return new ProtoWriter(40)
    .string(2, obj.uid)
    .uint64(3, obj.lastReadTime == null ? undefined : uint64Of(obj.lastReadTime))
    .uint64(4, obj.lastReadSeq == null ? undefined : uint64Of(obj.lastReadSeq))
    .finish();
}

/**
 * `SsoReadedReportReq` — repeated messages at fields 1 and 2.
 *
 * The zero values inside each item are omitted by protobuf, which is exactly what the
 * read-only probe relies on: `lastReadSeq: 0n` produces a bare `groupUin`, and the
 * server reads that as "report nothing, show me the cursor".
 */
export function encodeSsoReadedReportReq(obj: SsoReadedReportReq): Uint8Array {
  const w = new ProtoWriter(128);
  if (obj.groupList != null) for (const item of obj.groupList) w.message(1, encodeGroupReadedReportItem(item));
  if (obj.c2cList != null) for (const item of obj.c2cList) w.message(2, encodeC2CReadedReportItem(item));
  return w.finish();
}

/** `SsoGetGroupMsg` — `direction` is a strict bool, not a number. */
export function encodeSsoGetGroupMsgRequest(obj: SsoGetGroupMsgRequest): Uint8Array {
  const w = new ProtoWriter(32);
  if (obj.info != null) {
    w.message(
      1,
      new ProtoWriter(24).uint32(1, obj.info.groupUin).uint32(2, obj.info.startSequence).uint32(3, obj.info.endSequence).finish(),
    );
  }
  w.bool(2, obj.direction);
  return w.finish();
}

/** `SsoGetC2cMsg` — `friendUid` at field **2**. */
export function encodeSsoGetC2cMsgRequest(obj: SsoGetC2cMsgRequest): Uint8Array {
  return new ProtoWriter(48).string(2, obj.friendUid).uint32(3, obj.startSequence).uint32(4, obj.endSequence).finish();
}

/** `SsoGetRoamMsg` — fields 1..5, `direction` a strict bool. */
export function encodeSsoGetRoamMsgRequest(obj: SsoGetRoamMsgRequest): Uint8Array {
  return new ProtoWriter(56)
    .string(1, obj.friendUid)
    .uint32(2, obj.time)
    .uint32(3, obj.random)
    .uint32(4, obj.count)
    .bool(5, obj.direction)
    .finish();
}

// ===========================================================================
// Response messages
// ===========================================================================

/**
 * `SendMessageResponse` — the receipt the send path gates on.
 *
 * Field numbers: `result` 1, `errMsg` 2, `timestamp1` 3, `reviewResult` 6,
 * `serverResult` 7, `field10` 10, `groupSequence` 11, `timestamp2` 12,
 * `privateSequence` **14**. `result` and `reviewResult` are signed (`| 0`); the rest are
 * unsigned. `groupSequence`/`privateSequence` are separate fields, which is why a group
 * send reads 11 and a private send reads 14 out of the same decode.
 */
export interface SendMessageResponse {
  result: number | null;
  errMsg: string | null;
  timestamp1: number | null;
  reviewResult: number | null;
  serverResult: SendMessageServerResult | null;
  field10: number | null;
  groupSequence: number | null;
  timestamp2: number | null;
  privateSequence: number | null;
}

export interface SendMessageServerResult {
  type: number | null;
  code: number | null;
  message: string | null;
}

export function decodeSendMessageServerResult(data: Uint8Array, offset = 0, end = data.length): SendMessageServerResult {
  const reader = new ProtoReader(data, offset, end);
  const out: SendMessageServerResult = { type: null, code: null, message: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case 8:
        out.type = reader.int32();
        break;
      case 16:
        out.code = reader.int32();
        break;
      case 26:
        out.message = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return out;
}

export function decodeSendMessageResponse(data: Uint8Array, offset = 0, end = data.length): SendMessageResponse {
  const reader = new ProtoReader(data, offset, end);
  const out: SendMessageResponse = {
    result: null,
    errMsg: null,
    timestamp1: null,
    reviewResult: null,
    serverResult: null,
    field10: null,
    groupSequence: null,
    timestamp2: null,
    privateSequence: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case 8:
        out.result = reader.int32();
        break;
      case 18:
        out.errMsg = reader.string();
        break;
      case 24:
        out.timestamp1 = reader.uint32();
        break;
      case 48:
        out.reviewResult = reader.int32();
        break;
      case 58:
        out.serverResult = reader.message(decodeSendMessageServerResult);
        break;
      case 80:
        out.field10 = reader.uint32();
        break;
      case 88:
        out.groupSequence = reader.uint32();
        break;
      case 96:
        out.timestamp2 = reader.uint32();
        break;
      case 112:
        out.privateSequence = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return out;
}

/** `SsoReadedReportResp` — `{resultCode, errorMessage, groupList, c2cList}`. */
export interface SsoReadedReportResp {
  resultCode: number | null;
  errorMessage: string | null;
  groupList: GroupReadedReportResponseItem[];
  c2cList: C2CReadedReportResponseItem[];
}

/** `GroupReadedReportResponseItem` — fields 1..5; the three sequence fields are uint64. */
export interface GroupReadedReportResponseItem {
  resultCode: number | null;
  errorMessage: string | null;
  groupUin: bigint | null;
  readSeq: bigint | null;
  latestSeq: bigint | null;
}

/**
 * `C2CReadedReportResponseItem` — fields 1, 2, 3, 4, 5, 6, 7.
 *
 * `targetUin` is 3 and `uid` 4 — the reverse of what the request item does (`uid` 2,
 * `lastReadTime` 3, `lastReadSeq` 4). Two messages in the same pair of directions with
 * `uid` at different numbers; a copy-paste between them compiles and mismatches.
 */
export interface C2CReadedReportResponseItem {
  resultCode: number | null;
  errorMessage: string | null;
  targetUin: bigint | null;
  uid: string | null;
  readSeq: bigint | null;
  latestSeq: bigint | null;
  lastMsgTime: bigint | null;
}

export function decodeGroupReadedReportResponseItem(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupReadedReportResponseItem {
  const reader = new ProtoReader(data, offset, end);
  const out: GroupReadedReportResponseItem = {
    resultCode: null,
    errorMessage: null,
    groupUin: null,
    readSeq: null,
    latestSeq: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case 8:
        out.resultCode = reader.uint32();
        break;
      case 18:
        out.errorMessage = reader.string();
        break;
      case 24:
        out.groupUin = reader.uint64();
        break;
      case 32:
        out.readSeq = reader.uint64();
        break;
      case 40:
        out.latestSeq = reader.uint64();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return out;
}

export function decodeC2CReadedReportResponseItem(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): C2CReadedReportResponseItem {
  const reader = new ProtoReader(data, offset, end);
  const out: C2CReadedReportResponseItem = {
    resultCode: null,
    errorMessage: null,
    targetUin: null,
    uid: null,
    readSeq: null,
    latestSeq: null,
    lastMsgTime: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case 8:
        out.resultCode = reader.uint32();
        break;
      case 18:
        out.errorMessage = reader.string();
        break;
      case 24:
        out.targetUin = reader.uint64();
        break;
      case 34:
        out.uid = reader.string();
        break;
      case 40:
        out.readSeq = reader.uint64();
        break;
      case 48:
        out.latestSeq = reader.uint64();
        break;
      case 56:
        out.lastMsgTime = reader.uint64();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return out;
}

export function decodeSsoReadedReportResp(data: Uint8Array, offset = 0, end = data.length): SsoReadedReportResp {
  const reader = new ProtoReader(data, offset, end);
  const out: SsoReadedReportResp = { resultCode: null, errorMessage: null, groupList: [], c2cList: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case 8:
        out.resultCode = reader.uint32();
        break;
      case 18:
        out.errorMessage = reader.string();
        break;
      case 26:
        out.groupList.push(reader.message(decodeGroupReadedReportResponseItem));
        break;
      case 34:
        out.c2cList.push(reader.message(decodeC2CReadedReportResponseItem));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return out;
}

// ===========================================================================
// History responses
// ===========================================================================
//
// Both history commands answer with a repeated `PushMsgBody`. The inbound decoder for
// that message already exists (`ts/src/msg-push.ts` / `msg-push-fields.ts`); what this
// file adds is only the per-region copies of the wrapper messages, i.e. the envelope
// around the messages and the two commands' differing field layouts.

/**
 * `SsoGetGroupMsgResponse` — `{body}` at field **3**.
 *
 * The wrapper exists so the decoder can reach `body.messages`; the reference never
 * reads its other fields.
 */
export interface SsoGetGroupMsgResponse {
  body: SsoGetGroupMsgResponseBody | null;
}

/** `SsoGetGroupMsgResponseBody` — `groupUin` 3, `startSequence` 4, `endSequence` 5, `messages` 6. */
export interface SsoGetGroupMsgResponseBody {
  groupUin: number | null;
  startSequence: number | null;
  endSequence: number | null;
  /** Already-decoded `PushMsgBody` values, one per wire message. */
  messages: PushMsgBodyLike[];
}

/**
 * `SsoGetC2cMsgResponse` — `result` 1, `errorMessage` 2, `friendUid` 4, `messages` 7.
 *
 * `friendUid` at 4 and `messages` at 7: the gaps are real, not a numbering accident.
 * The reference compares the echoed `friendUid` against the request and throws on a
 * mismatch, so a decoder that reads field 3 (the natural guess, and the field the ROAM
 * response actually uses) silently sees `null` and the check never fires.
 */
export interface SsoGetC2cMsgResponse {
  result: number | null;
  errorMessage: string | null;
  friendUid: string | null;
  messages: PushMsgBodyLike[];
}

/**
 * `SsoGetRoamMsgResponse` — `result` 1, `errorMessage` 2, `friendUid` **3**,
 * `isComplete` 4, `timestamp` 5, `random` 6, `messages` 7.
 *
 * Compare with the C2C variant above: `friendUid` is 3 here and 4 there, and that pair
 * of messages is decoded by two functions 280 lines apart in the reference. This is the
 * concrete instance of MEMORY.md §2.3ab's rule inside the history family.
 */
export interface SsoGetRoamMsgResponse {
  result: number | null;
  errorMessage: string | null;
  friendUid: string | null;
  isComplete: boolean | null;
  timestamp: number | null;
  random: number | null;
  messages: PushMsgBodyLike[];
}

/**
 * What a history response carries per message.
 *
 * Structural, and deliberately looser than `PushMsgBody` in `msg-push.ts`: this file
 * only decodes the envelope, and the three fields below are the whole of what
 * `buildContextFromMessage` reads. The bridge's history fetcher needs nothing else, and
 * binding to the full interface would make this module depend on the inbound decoder's
 * type surface for no reason.
 */
export interface PushMsgBodyLike {
  responseHead: { fromUin?: number | null; fromUid?: string | null } | null;
  contentHead: {
    msgType?: number | null;
    subType?: number | null;
    c2cCmd?: number | null;
    sequence?: number | null;
    ntMsgSeq?: number | null;
    timestamp?: number | null;
    msgId?: number | null;
  } | null;
  body: unknown;
}

/** A `PushMsgBody` decoder: the inbound one is passed in rather than imported. */
export type PushMsgBodyDecoder = (data: Uint8Array, offset: number, end: number) => PushMsgBodyLike;

/**
 * Decode a history response's repeated messages.
 *
 * `decodeMessage` is supplied by the caller so this module does not import
 * `msg-push-fields.ts` (which is the inbound layer, and which would drag the whole
 * push decoder tree into the send path's dependency graph). The bridge passes
 * `decodePushMsgBody`.
 */
export function decodeSsoGetGroupMsgResponse(
  data: Uint8Array,
  decodeMessage: PushMsgBodyDecoder,
  offset = 0,
  end = data.length,
): SsoGetGroupMsgResponse {
  const reader = new ProtoReader(data, offset, end);
  const out: SsoGetGroupMsgResponse = { body: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case 26:
        out.body = reader.message((d, s, e) => decodeSsoGetGroupMsgResponseBody(d, s, e, decodeMessage));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return out;
}

function decodeSsoGetGroupMsgResponseBody(
  data: Uint8Array,
  offset: number,
  end: number,
  decodeMessage: PushMsgBodyDecoder,
): SsoGetGroupMsgResponseBody {
  const reader = new ProtoReader(data, offset, end);
  const out: SsoGetGroupMsgResponseBody = {
    groupUin: null,
    startSequence: null,
    endSequence: null,
    messages: [],
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case 24:
        out.groupUin = reader.uint32();
        break;
      case 32:
        out.startSequence = reader.uint32();
        break;
      case 40:
        out.endSequence = reader.uint32();
        break;
      case 50:
        out.messages.push(reader.message(decodeMessage));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return out;
}

/** `SsoGetC2cMsgResponse` — `friendUid` at **4**, `messages` at 7. */
export function decodeSsoGetC2cMsgResponse(
  data: Uint8Array,
  decodeMessage: PushMsgBodyDecoder,
  offset = 0,
  end = data.length,
): SsoGetC2cMsgResponse {
  const reader = new ProtoReader(data, offset, end);
  const out: SsoGetC2cMsgResponse = { result: null, errorMessage: null, friendUid: null, messages: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case 8:
        out.result = reader.int32();
        break;
      case 18:
        out.errorMessage = reader.string();
        break;
      case 34:
        out.friendUid = reader.string();
        break;
      case 58:
        out.messages.push(reader.message(decodeMessage));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return out;
}

/** `SsoGetRoamMsgResponse` — `friendUid` at **3**, `isComplete` a bool at 4. */
export function decodeSsoGetRoamMsgResponse(
  data: Uint8Array,
  decodeMessage: PushMsgBodyDecoder,
  offset = 0,
  end = data.length,
): SsoGetRoamMsgResponse {
  const reader = new ProtoReader(data, offset, end);
  const out: SsoGetRoamMsgResponse = {
    result: null,
    errorMessage: null,
    friendUid: null,
    isComplete: null,
    timestamp: null,
    random: null,
    messages: [],
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case 8:
        out.result = reader.uint32();
        break;
      case 18:
        out.errorMessage = reader.string();
        break;
      case 26:
        out.friendUid = reader.string();
        break;
      case 32:
        out.isComplete = reader.bool();
        break;
      case 40:
        out.timestamp = reader.uint32();
        break;
      case 48:
        out.random = reader.uint32();
        break;
      case 58:
        out.messages.push(reader.message(decodeMessage));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return out;
}