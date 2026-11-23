/**
 * msg-push wire layer: protobuf field tables and decoders for inbound pushes.
 *
 * This is the *generated* half of the msg-push port. The hand-written half --
 * segment conversion, event decoding, the registry, dedup -- is `msg-push.ts`.
 *
 * ## Where the field numbers come from
 *
 * **Every field number, wire type and property name in this file is generated
 * from `reference/index.mjs`**, never inferred from protobuf convention:
 *
 *     python3 work/msgpush/generate-tables.py --interfaces > work/msgpush/gen-interfaces.ts
 *     python3 work/msgpush/generate-tables.py             > work/msgpush/gen-tables.ts
 *     python3 work/msgpush/assemble-fields.py            # rebuilds this file
 *
 * The generator parses three things per message and needs all three:
 *
 *   1. the `case <tag>:` label   -> field number = tag>>3, wire type = tag&7;
 *   2. the assignment RHS        -> the *narrowing*: `_val` uint32, `_val | 0`
 *                                   signed int32, `_val !== 0` boolean,
 *                                   `BigInt(..)` int64, `data.slice` bytes,
 *                                   `__utf8Read` string, `protobuf_decode_X`
 *                                   nested message, `.push(..)` repeated;
 *   3. the `const _result = {..}` -> the *property name*, keyed by slot index.
 *
 * Step 3 is why this is generated: `_result` is keyed by `_f0`, `_f1`, ... and
 * those slot indices do **not** always line up with field order. Hand-writing
 * the tables got four messages wrong that way (`ExtraInfo`, both
 * `NotOnlineImagePbReserve`s, `CustomFacePbReserve`) -- the numbers were right
 * and the names were not. Generating them removed that entire error class.
 * `work/msgpush/schema-msgpush.txt` is the same data as a readable table with a
 * line number per field.
 *
 * ## Field-number surprises (all verified against the running reference)
 *
 *   1. `Elem` skips field **7**: after field 6 `marketFace` comes field 8
 *      `customFace` (L123837). The slot is unused; do not "fix" it.
 *   2. `RichText.elems` is field **2**, not 1 (L123574). Field 1 is unused.
 *   3. `NotifyMessageBody` has `type` at field 1 but `groupUin` at field **4**
 *      (L147288); 2 and 3 carry something else.
 *   4. `FriendRequestInfo.newSource` is field **5** and `message` field **10**
 *      (L144783 / L144803); 3, 4 and 6..9 are absent.
 *   5. `GeneralFlags.uin` is field 3 int64, but `longTextFlag` is field **6**
 *      (L128464): 4 and 5 are unused.
 *   6. `Ptt.groupFileKey` is field **10**, `fileKey` field **14**
 *      (L129550 / L129570); 7..9 and 11..13 unused.
 *   7. `ContentHead` jumps 7 -> **11** for `ntMsgSeq` (L123354); 8, 9, 10 unused.
 *   8. `SrcMsg.origSeqs` accepts the same field number **both packed (wire 2)
 *      and unpacked (wire 0)** (L128601 / L128583).
 *   9. `VideoFile` jumps 19 -> **24** for `pbReserve` (L128302).
 *  10. `NotOnlineFile` jumps 12 -> **50** (L129276), then 50 -> 55 -> 56 -> 57.
 *  11. Three narrowing forms that are *not* interchangeable, and a wrong choice
 *      stays invisible until a negative or large value arrives:
 *      `_val` -> uint32; `_val | 0` -> **signed** int32 (`FaceElem.index`,
 *      `VideoFile.fileSize`, `PushMsg.status`); `_val !== 0` -> **boolean**
 *      (`VideoFile.supportProgressive`, `NotOnlineImage.oldPicMd5`).
 *
 * ## The lenient-varint trap
 *
 * The reference's generated decoders are lenient: a 10-byte varint is legal even
 * for a 32-bit field (that is how a negative int32 is encoded) and bits above 32
 * are **dropped rather than rejected**. A strict 5-byte reader rejects real
 * server traffic. We share the reader with the OIDB port (`oidb/wire.ts`) rather
 * than reimplementing it -- see `docs/oidb.md` §5.
 */

import { ProtoReader, WireType, tagOf } from "./oidb/wire.js";


export interface C2cSource {
  friendUid: string | null;
}

export interface CommonElem {
  serviceType: number | null;
  pbElem: Uint8Array | null;
  businessType: number | null;
}

export interface ContentHead {
  msgType: number | null;
  subType: number | null;
  c2cCmd: number | null;
  msgId: number | null;
  sequence: number | null;
  timestamp: number | null;
  field7: bigint | null;
  ntMsgSeq: number | null;
  newId: bigint | null;
}

export interface CustomFace {
  guid: Uint8Array | null;
  filePath: string | null;
  shortcut: string | null;
  buffer: Uint8Array | null;
  flag: Uint8Array | null;
  oldData: Uint8Array | null;
  fileId: number | null;
  serverIp: number | null;
  serverPort: number | null;
  fileType: number | null;
  signature: Uint8Array | null;
  useful: number | null;
  md5: Uint8Array | null;
  thumbUrl: string | null;
  bigUrl: string | null;
  origUrl: string | null;
  bizType: number | null;
  repeatIndex: number | null;
  repeatImage: number | null;
  imageType: number | null;
  index: number | null;
  width: number | null;
  height: number | null;
  source: number | null;
  size: number | null;
  origin: number | null;
  thumbWidth: number | null;
  thumbHeight: number | null;
  showLen: number | null;
  downloadLen: number | null;
  x400Url: string | null;
  x400Width: number | null;
  x400Height: number | null;
  pbRes: CustomFacePbReserve | null;
}

export interface CustomFacePbReserve {
  subType: number | null;
  summary: string | null;
}

export interface Elem {
  text: TextElem | null;
  face: FaceElem | null;
  onlineImage: OnlineImage | null;
  notOnlineImage: NotOnlineImage | null;
  transElem: TransElem | null;
  marketFace: MarketFace | null;
  customFace: CustomFace | null;
  richMsg: RichMsg | null;
  groupFile: GroupFileElem | null;
  extraInfo: ExtraInfo | null;
  videoFile: VideoFile | null;
  generalFlags: GeneralFlags | null;
  srcMsg: SrcMsg | null;
  lightApp: LightAppElem | null;
  commonElem: CommonElem | null;
}

export interface EssenceMessage {
  groupUin: number | null;
  msgSequence: number | null;
  random: number | null;
  setFlag: number | null;
  memberUin: number | null;
  operatorUin: number | null;
  timestamp: number | null;
  msgSequence2: number | null;
  operatorNickname: string | null;
  memberNickname: string | null;
  setFlag2: number | null;
}

export interface ExtBizInfo {
  pic: PicExtBizInfo | null;
  video: VideoExtBizInfo | null;
  ptt: PttExtBizInfo | null;
  busiType: number | null;
}

export interface ExtraInfo {
  nick: Uint8Array | null;
  groupCard: Uint8Array | null;
  level: number | null;
  flags: number | null;
  groupMask: number | null;
  msgTailId: number | null;
  senderTitle: Uint8Array | null;
  apnsTips: Uint8Array | null;
  uin: bigint | null;
  msgStateFlag: number | null;
  apnsSoundType: number | null;
  newGroupFlag: number | null;
}

export interface FaceElem {
  index: number | null;
  oldData: Uint8Array | null;
  buf: Uint8Array | null;
}

export interface FileExtra {
  file: NotOnlineFile | null;
  field6: PrivateFileExtra | null;
}

export interface FileInfo {
  fileSize: number | null;
  fileHash: string | null;
  fileSha1: string | null;
  fileName: string | null;
  type: FileType | null;
  width: number | null;
  height: number | null;
  time: number | null;
  original: number | null;
}

export interface FileType {
  type: number | null;
  picFormat: number | null;
  videoFormat: number | null;
  voiceFormat: number | null;
}

export interface FriendRecall {
  info: FriendRecallInfo | null;
  instId: number | null;
  appId: number | null;
  longMessageFlag: number | null;
  reserved: Uint8Array | null;
}

export interface FriendRecallInfo {
  fromUid: string | null;
  toUid: string | null;
  clientSequence: number | null;
  newId: bigint | null;
  time: number | null;
  random: number | null;
  pkgNum: number | null;
  pkgIndex: number | null;
  divSeq: number | null;
  tipInfo: FriendRecallTipInfo | null;
}

export interface FriendRecallTipInfo {
  tip: string | null;
}

export interface FriendRequest {
  info: FriendRequestInfo | null;
}

export interface FriendRequestInfo {
  targetUid: string | null;
  sourceUid: string | null;
  newSource: string | null;
  message: string | null;
  source: string | null;
}

export interface GeneralFlags {
  bubbleDiyTextId: number | null;
  groupFlagNew: number | null;
  uin: bigint | null;
  longTextFlag: number | null;
  longTextResId: string | null;
}

export interface GeneralGrayTipInfo {
  busiType: bigint | null;
  busiId: bigint | null;
  ctrlFlag: number | null;
  c2cType: number | null;
  serviceType: number | null;
  templId: bigint | null;
  msgTemplParam: TemplParam[];
  content: string | null;
}

export interface GroupAdmin {
  groupUin: number | null;
  flag: number | null;
  isPromote: boolean | null;
  body: GroupAdminBody | null;
}

export interface GroupAdminBody {
  extraDisable: GroupAdminExtra | null;
  extraEnable: GroupAdminExtra | null;
}

export interface GroupAdminExtra {
  adminUid: string | null;
  isPromote: boolean | null;
}

export interface GroupFileElem {
  filename: string | null;
  fileSize: bigint | null;
  fileId: string | null;
  batchId: string | null;
  fileKey: string | null;
  mark: Uint8Array | null;
  sequence: bigint | null;
  batchItemId: Uint8Array | null;
  feedMsgTime: number | null;
  pbReserve: Uint8Array | null;
}

export interface GroupFileExtra {
  field1: number | null;
  fileName: string | null;
  display: string | null;
  inner: GroupFileExtraInner | null;
}

export interface GroupFileExtraInner {
  info: GroupFileInfo | null;
}

export interface GroupFileInfo {
  busId: number | null;
  fileId: string | null;
  fileSize: bigint | null;
  fileName: string | null;
  field5: number | null;
  fileSha: Uint8Array | null;
  extInfoString: string | null;
  fileMd5: Uint8Array | null;
}

export interface GroupInvitation {
  cmd: number | null;
  info: InvitationInfo | null;
}

export interface GroupInvite {
  groupUin: number | null;
  field2: number | null;
  field3: number | null;
  field4: number | null;
  invitorUid: string | null;
  hashes: Uint8Array | null;
}

export interface GroupMute {
  groupUin: number | null;
  subType: number | null;
  field3: number | null;
  operatorUid: string | null;
  data: GroupMuteData | null;
}

export interface GroupMuteData {
  timestamp: number | null;
  type: number | null;
  state: GroupMuteState | null;
}

export interface GroupMuteState {
  targetUid: string | null;
  duration: number | null;
}

export interface GroupRecall {
  operatorUid: string | null;
  recallMessages: RecallMessage[];
  userDef: Uint8Array | null;
  groupType: number | null;
  opType: number | null;
  tipInfo: GroupRecallTipInfo | null;
}

export interface GroupRecallTipInfo {
  tip: string | null;
}

export interface HashSum {
  bytesPbReserveC2c: C2cSource | null;
  troopSource: TroopSource | null;
}

export interface IndexNode {
  info: FileInfo | null;
  fileUuid: string | null;
  storeId: number | null;
  uploadTime: number | null;
  ttl: number | null;
  subType: number | null;
}

export interface InlineKeyboardAction {
  type: number | null;
  permission: InlineKeyboardPermission | null;
  clickLimit: number | null;
  unsupportedTips: string | null;
  data: string | null;
  atBotShowChannelList: boolean | null;
  reply: boolean | null;
  enter: boolean | null;
  anchor: number | null;
}

export interface InlineKeyboardButton {
  id: string | null;
  renderData: InlineKeyboardRenderData | null;
  action: InlineKeyboardAction | null;
}

export interface InlineKeyboardData {
  rows: InlineKeyboardRow[];
  botAppid: bigint | null;
}

export interface InlineKeyboardExtra {
  keyboard: InlineKeyboardData | null;
}

export interface InlineKeyboardPermission {
  type: number | null;
  specifyRoleIds: number[];
  specifyUserIds: number[];
}

export interface InlineKeyboardRenderData {
  label: string | null;
  visitedLabel: string | null;
  style: number | null;
}

export interface InlineKeyboardRow {
  buttons: InlineKeyboardButton[];
}

export interface InvitationInfo {
  inner: InvitationInner | null;
}

export interface InvitationInner {
  groupUin: number | null;
  field2: number | null;
  field3: number | null;
  field4: number | null;
  targetUid: string | null;
  invitorUid: string | null;
  field7: number | null;
  field9: number | null;
  field10: Uint8Array | null;
  field11: number | null;
  field12: string | null;
}

export interface LightAppElem {
  data: Uint8Array | null;
  msgResid: Uint8Array | null;
}

export interface MarkdownData {
  content: string | null;
  field2: string | null;
  field3: Uint8Array | null;
  processMsg: string | null;
  summary: string | null;
  extType: number | null;
  extInfo: MarkdownFlashTransferExt | null;
}

export interface MarkdownFlashTransferExt {
  filesetId: string | null;
  name: string | null;
  fileSize: number | null;
  thumbnail: MarkdownFlashTransferThumb | null;
  expireTime: number | null;
}

export interface MarkdownFlashTransferThumb {
  fileId: string | null;
  download: MarkdownFlashTransferThumbUrl | null;
  sha1: string | null;
  field4: number | null;
}

export interface MarkdownFlashTransferThumbUrl {
  field1: number | null;
  downloadUrl: string | null;
}

export interface MarketFace {
  faceName: string | null;
  itemType: number | null;
  faceInfo: number | null;
  faceId: Uint8Array | null;
  tabId: number | null;
  subType: number | null;
  key: string | null;
  param: Uint8Array | null;
  mediaType: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  mobileParam: Uint8Array | null;
  pbReserve: Uint8Array | null;
}

export interface MentionExtra {
  type: number | null;
  uin: number | null;
  field5: number | null;
  uid: string | null;
}

export interface MessageBody {
  richText: RichText | null;
  msgContent: Uint8Array | null;
}

export interface MsgInfo {
  msgInfoBody: MsgInfoBody[];
  extBizInfo: ExtBizInfo | null;
}

export interface MsgInfoBody {
  index: IndexNode | null;
  picture: PictureInfo | null;
  fileExist: boolean | null;
  hashSum: HashSum | null;
}

export interface NewFriend {
  field1: number | null;
  info: NewFriendInfo | null;
}

export interface NewFriendInfo {
  uid: string | null;
  field2: number | null;
  time: number | null;
  message: string | null;
  nickName: string | null;
  field6: number | null;
  field7: number | null;
  toUid: string | null;
}

export interface NotOnlineFile {
  fileType: number | null;
  fileUuid: string | null;
  fileMd5: Uint8Array | null;
  fileName: string | null;
  fileSize: bigint | null;
  subcmd: number | null;
  downloadFlag: number | null;
  dangerEvel: number | null;
  expireTime: number | null;
  pbReserve: Uint8Array | null;
  fileHash: string | null;
}

export interface NotOnlineImage {
  filePath: string | null;
  fileLen: number | null;
  downloadPath: string | null;
  oldVerSendFile: Uint8Array | null;
  imgType: number | null;
  previewsImage: Uint8Array | null;
  picMd5: Uint8Array | null;
  picHeight: number | null;
  picWidth: number | null;
  resId: string | null;
  flag: Uint8Array | null;
  thumbUrl: string | null;
  original: number | null;
  bigUrl: string | null;
  origUrl: string | null;
  bizType: number | null;
  result: number | null;
  index: number | null;
  opFaceBuf: Uint8Array | null;
  oldPicMd5: boolean | null;
  thumbWidth: number | null;
  thumbHeight: number | null;
  fileId: number | null;
  showLen: number | null;
  downloadLen: number | null;
  x400Url: string | null;
  x400Width: number | null;
  x400Height: number | null;
  pbRes: NotOnlineImagePbReserve | null;
}

export interface NotOnlineImagePbReserve {
  subType: number | null;
  field3: number | null;
  field4: number | null;
  summary: string | null;
  field10: number | null;
  field20: NotOnlineImagePbReserve2 | null;
  url: string | null;
  md5Str: string | null;
}

export interface NotOnlineImagePbReserve2 {
  field1: number | null;
  field2: string | null;
  field3: number | null;
  field4: number | null;
  field5: number | null;
  field7: string | null;
}

export interface NotifyMessageBody {
  type: number | null;
  groupUin: number | null;
  eventParam: Uint8Array | null;
  recall: GroupRecall | null;
  field13: number | null;
  operatorUid: string | null;
  generalGrayTip: GeneralGrayTipInfo | null;
  essenceMessage: EssenceMessage | null;
  msgSequence: number | null;
  field39: number | null;
}

export interface OnlineImage {
  guid: Uint8Array | null;
  filePath: Uint8Array | null;
  oldVerSendFile: Uint8Array | null;
}

export interface OperatorField1 {
  uid: string | null;
  field2: number | null;
  field3: Uint8Array | null;
  field4: number | null;
  field5: Uint8Array | null;
}

export interface OperatorInfo {
  operatorField: OperatorField1 | null;
}

export interface PicExtBizInfo {
  bizType: number | null;
  textSummary: string | null;
  bytesPbReserveC2c: Uint8Array | null;
  extData: PicExtData | null;
  fromScene: number | null;
  toScene: number | null;
  oldFileId: number | null;
}

export interface PicExtData {
  subType: number | null;
  textSummary: string | null;
}

export interface PicUrlExtInfo {
  originalParameter: string | null;
  bigParameter: string | null;
  thumbParameter: string | null;
}

export interface PictureInfo {
  urlPath: string | null;
  ext: PicUrlExtInfo | null;
  domain: string | null;
}

export interface PrivateFileExtra {
  field2: PrivateFileExtraField2 | null;
}

export interface PrivateFileExtraField2 {
  field1: number | null;
  fileUuid: string | null;
  fileName: string | null;
  field6: number | null;
  field7: Uint8Array | null;
  field8: Uint8Array | null;
  timestamp1: number | null;
  fileHash: string | null;
  selfUid: string | null;
  destUid: string | null;
}

export interface Ptt {
  fileType: number | null;
  fileId: bigint | null;
  fileUuid: Uint8Array | null;
  fileMd5: Uint8Array | null;
  fileName: string | null;
  fileSize: number | null;
  groupFileKey: string | null;
  fileKey: Uint8Array | null;
  time: number | null;
  format: number | null;
}

export interface PttExtBizInfo {
  srcUin: bigint | null;
  pttScene: number | null;
  pttType: number | null;
  changeVoice: number | null;
  waveform: Uint8Array | null;
  autoConvertText: number | null;
  bytesReserve: Uint8Array | null;
  bytesPbReserve: Uint8Array | null;
  bytesGeneralFlags: Uint8Array | null;
}

export interface PushMsg {
  message: PushMsgBody | null;
  status: number | null;
}

export interface PushMsgBody {
  responseHead: ResponseHead | null;
  contentHead: ContentHead | null;
  body: MessageBody | null;
}

export interface QFaceExtra {
  packId: string | null;
  stickerId: string | null;
  qsid: number | null;
  sourceType: number | null;
  stickerType: number | null;
  resultId: string | null;
  text: string | null;
  randomType: number | null;
}

export interface QSmallFaceExtra {
  faceId: number | null;
  preview: string | null;
  preview2: string | null;
}

export interface RecallMessage {
  sequence: number | null;
  time: number | null;
  random: number | null;
  type: number | null;
  flag: number | null;
  authorUid: string | null;
}

export interface ResponseForward {
  tempGroupUin: number | null;
  friendName: string | null;
}

export interface ResponseGrp {
  groupUin: number | null;
  memberName: string | null;
  memberCard: string | null;
  groupName: string | null;
}

export interface ResponseHead {
  fromUin: number | null;
  fromUid: string | null;
  type: number | null;
  sigMap: number | null;
  toUin: number | null;
  toUid: string | null;
  forward: ResponseForward | null;
  grp: ResponseGrp | null;
}

export interface RichMsg {
  template1: Uint8Array | null;
  serviceId: number | null;
  msgResId: Uint8Array | null;
  rand: number | null;
  seq: number | null;
}

export interface RichText {
  elems: Elem[];
  notOnlineFile: NotOnlineFile | null;
  ptt: Ptt | null;
}

export interface SrcMsg {
  origSeqs: number[];
  senderUin: bigint | null;
  time: number | null;
  flag: number | null;
  elemsRaw: Uint8Array[];
  type: number | null;
  richMsg: Uint8Array | null;
  pbReserve: Uint8Array | null;
  sourceMsg: Uint8Array | null;
  toUin: bigint | null;
  troopName: Uint8Array | null;
}

export interface TemplParam {
  name: string | null;
  value: string | null;
}

export interface TextElem {
  str: string | null;
  link: string | null;
  attr6Buf: Uint8Array | null;
  attr7Buf: Uint8Array | null;
  buf: Uint8Array | null;
  pbReserve: Uint8Array | null;
}

export interface TransElem {
  elemType: number | null;
  elemValue: Uint8Array | null;
}

export interface TroopSource {
  groupUin: number | null;
}

export interface VideoExtBizInfo {
  fromScene: number | null;
  toScene: number | null;
  bytesPbReserve: Uint8Array | null;
}

export interface VideoFile {
  fileUuid: string | null;
  fileMd5: Uint8Array | null;
  fileName: string | null;
  fileFormat: number | null;
  fileTime: number | null;
  fileSize: number | null;
  thumbWidth: number | null;
  thumbHeight: number | null;
  thumbFileMd5: Uint8Array | null;
  source: Uint8Array | null;
  thumbFileSize: number | null;
  busiType: number | null;
  fromChatType: number | null;
  toChatType: number | null;
  supportProgressive: boolean | null;
  fileWidth: number | null;
  fileHeight: number | null;
  subBusiType: number | null;
  videoAttr: number | null;
  pbReserve: Uint8Array | null;
}


// ===========================================================================
// Field-table machinery
// ===========================================================================
//
// Writing ~90 decoders in the generated code's imperative style would be 30,000
// lines of near-identical switch bodies, each a fresh chance to mistype a field
// number. Instead each message declares its fields once as data, and one driver
// walks the wire.
//
// The driver reproduces the generated code's semantics, which are *not* stock
// protobuf:
//
//   * absent fields are `null` (not `undefined`, not the proto3 default);
//   * repeated fields are `[]`;
//   * 64-bit fields are `bigint`;
//   * a *known* field arriving with the wrong wire type falls through to the
//     unknown-field branch and is skipped -- not an error (the reference switches
//     on `field<<3|wire`, so the tag simply does not match);
//   * an unknown field is skipped and counted, never rejected.

type FieldKind =
  | "u32" | "i32" | "bool" | "i64" | "str" | "bytes"
  | "msg" | "repU32" | "repBytes" | "repMsg";

interface FieldSpec {
  readonly field: number;
  readonly name: string;
  readonly kind: FieldKind;
  /** For `msg`/`repMsg`: the nested decoder in `ProtoReader.message` form. */
  readonly decode?: (data: Uint8Array, offset: number, end: number) => unknown;
}

const u32 = (field: number, name: string): FieldSpec => ({ field, name, kind: "u32" });
const i32 = (field: number, name: string): FieldSpec => ({ field, name, kind: "i32" });
const i64 = (field: number, name: string): FieldSpec => ({ field, name, kind: "i64" });
const bool = (field: number, name: string): FieldSpec => ({ field, name, kind: "bool" });
const str = (field: number, name: string): FieldSpec => ({ field, name, kind: "str" });
const bytes = (field: number, name: string): FieldSpec => ({ field, name, kind: "bytes" });
const repU32 = (field: number, name: string): FieldSpec => ({ field, name, kind: "repU32" });
const repBytes = (field: number, name: string): FieldSpec => ({ field, name, kind: "repBytes" });
const msg = (
  field: number, name: string,
  decode: (data: Uint8Array, offset: number, end: number) => unknown,
): FieldSpec => ({ field, name, kind: "msg", decode });
const repMsg = (
  field: number, name: string,
  decode: (data: Uint8Array, offset: number, end: number) => unknown,
): FieldSpec => ({ field, name, kind: "repMsg", decode });

const WIRE_OF: Readonly<Record<FieldKind, number>> = {
  u32: WireType.varint, i32: WireType.varint, bool: WireType.varint, i64: WireType.varint,
  str: WireType.lengthDelimited, bytes: WireType.lengthDelimited,
  msg: WireType.lengthDelimited, repU32: WireType.lengthDelimited,
  repBytes: WireType.lengthDelimited, repMsg: WireType.lengthDelimited,
};

function decodeInto<T>(data: Uint8Array, offset: number, end: number, fields: readonly FieldSpec[]): T {
  return decodeFields<T>(new ProtoReader(data, offset, end), fields);
}

function decodeFields<T>(r: ProtoReader, fields: readonly FieldSpec[]): T {
  const byTag = new Map<number, FieldSpec>();
  for (const f of fields) {
    byTag.set(tagOf(f.field, WIRE_OF[f.kind]), f);
    // `repU32` is the one field accepting both forms on one number: the
    // reference reads packed (wire 2) and unpacked (wire 0) alike (L128601/L128583).
    if (f.kind === "repU32") byTag.set(tagOf(f.field, WireType.varint), f);
  }

  const out: Record<string, unknown> = {};
  for (const f of fields) {
    out[f.name] = f.kind === "repU32" || f.kind === "repBytes" || f.kind === "repMsg" ? [] : null;
  }

  while (r.next()) {
    const spec = byTag.get(r.tag);
    if (spec === undefined) {
      r.skip(); // unknown field, or a known one with an unexpected wire type
      continue;
    }
    switch (spec.kind) {
      case "u32": out[spec.name] = r.uint32(); break;
      case "i32": out[spec.name] = r.int32(); break;
      case "i64": out[spec.name] = r.uint64(); break;
      case "bool": out[spec.name] = r.bool(); break;
      case "str": out[spec.name] = r.string(); break;
      case "bytes": out[spec.name] = r.bytes(); break;
      case "msg": out[spec.name] = r.message(spec.decode!); break;
      case "repMsg": (out[spec.name] as unknown[]).push(r.message(spec.decode!)); break;
      case "repBytes": (out[spec.name] as Uint8Array[]).push(r.bytes()); break;
      case "repU32": {
        const list = out[spec.name] as number[];
        if (r.wireType === WireType.varint) list.push(r.uint32());
        else r.message((data, start, end) => {
          // Packed: varints back-to-back until the range is exhausted. Lenient,
          // like the reference's packed loop (L128601).
          for (let i = start; i < end; ) i = readVarintAt(data, i, end, list);
          return null;
        });
        break;
      }
    }
  }
  return out as T;
}

/** Read varints out of a packed run with the reference's leniency (L128601). */
function readVarintAt(data: Uint8Array, offset: number, end: number, list: number[]): number {
  let value = data[offset++]!;
  if ((value & 0x80) !== 0) {
    value &= 0x7f;
    let shift = 7;
    for (;;) {
      if (offset >= end) throw new Error("Truncated protobuf varint");
      const byte = data[offset++]!;
      if (shift === 63 && byte > 1) throw new Error("Invalid protobuf varint");
      if (shift < 32) value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    value >>>= 0;
  }
  list.push(value);
  return offset;
}


// PushMsg — reference L136028 — port decoder decodePushMsg
const PUSH_MSG_FIELDS: readonly FieldSpec[] = [
  msg(1, "message", decodePushMsgBody), // L136053
  i32(3, "status"), // L136073
];

// PushMsgBody — reference L122576 — port decoder decodePushMsgBody
const PUSH_MSG_BODY_FIELDS: readonly FieldSpec[] = [
  msg(1, "responseHead", decodeResponseHead), // L122602
  msg(2, "contentHead", decodeContentHead), // L122622
  msg(3, "body", decodeMessageBody), // L122642
];

// ResponseHead — reference L122707 — port decoder decodeResponseHead
const RESPONSE_HEAD_FIELDS: readonly FieldSpec[] = [
  u32(1, "fromUin"), // L122738
  str(2, "fromUid"), // L122756
  u32(3, "type"), // L122776
  u32(4, "sigMap"), // L122794
  u32(5, "toUin"), // L122812
  str(6, "toUid"), // L122830
  msg(7, "forward", decodeResponseForward), // L122850
  msg(8, "grp", decodeResponseGrp), // L122870
];

// ResponseForward — reference L122940 — port decoder decodeResponseForward
const RESPONSE_FORWARD_FIELDS: readonly FieldSpec[] = [
  u32(5, "tempGroupUin"), // L122965
  str(6, "friendName"), // L122983
];

// ResponseGrp — reference L123047 — port decoder decodeResponseGrp
const RESPONSE_GRP_FIELDS: readonly FieldSpec[] = [
  u32(1, "groupUin"), // L123074
  str(2, "memberName"), // L123092
  str(4, "memberCard"), // L123112
  str(7, "groupName"), // L123132
];

// ContentHead — reference L123198 — port decoder decodeContentHead
const CONTENT_HEAD_FIELDS: readonly FieldSpec[] = [
  u32(1, "msgType"), // L123230
  u32(2, "subType"), // L123248
  u32(3, "c2cCmd"), // L123266
  u32(4, "msgId"), // L123284
  u32(5, "sequence"), // L123302
  u32(6, "timestamp"), // L123320
  i64(7, "field7"), // L123338
  u32(11, "ntMsgSeq"), // L123354
  i64(12, "newId"), // L123372
];

// MessageBody — reference L123439 — port decoder decodeMessageBody
const MESSAGE_BODY_FIELDS: readonly FieldSpec[] = [
  msg(1, "richText", decodeRichText), // L123464
  bytes(2, "msgContent"), // L123484
];

// RichText — reference L123548 — port decoder decodeRichText
const RICH_TEXT_FIELDS: readonly FieldSpec[] = [
  repMsg(2, "elems", decodeElem), // L123574
  msg(3, "notOnlineFile", decodeNotOnlineFile), // L123594
  msg(4, "ptt", decodePtt), // L123614
];

// Elem — reference L123679 — port decoder decodeElem
const ELEM_FIELDS: readonly FieldSpec[] = [
  msg(1, "text", decodeTextElem), // L123717
  msg(2, "face", decodeFaceElem), // L123737
  msg(3, "onlineImage", decodeOnlineImage), // L123757
  msg(4, "notOnlineImage", decodeNotOnlineImage), // L123777
  msg(5, "transElem", decodeTransElem), // L123797
  msg(6, "marketFace", decodeMarketFace), // L123817
  msg(8, "customFace", decodeCustomFace), // L123837
  msg(12, "richMsg", decodeRichMsg), // L123857
  msg(13, "groupFile", decodeGroupFileElem), // L123877
  msg(16, "extraInfo", decodeExtraInfo), // L123897
  msg(19, "videoFile", decodeVideoFile), // L123917
  msg(37, "generalFlags", decodeGeneralFlags), // L123937
  msg(45, "srcMsg", decodeSrcMsg), // L123957
  msg(51, "lightApp", decodeLightAppElem), // L123977
  msg(53, "commonElem", decodeCommonElem), // L123997
];

// TextElem — reference L124280 — port decoder decodeTextElem
const TEXT_ELEM_FIELDS: readonly FieldSpec[] = [
  str(1, "str"), // L124309
  str(2, "link"), // L124329
  bytes(3, "attr6Buf"), // L124349
  bytes(4, "attr7Buf"), // L124369
  bytes(11, "buf"), // L124389
  bytes(12, "pbReserve"), // L124409
];

// FaceElem — reference L124477 — port decoder decodeFaceElem
const FACE_ELEM_FIELDS: readonly FieldSpec[] = [
  i32(1, "index"), // L124503
  bytes(2, "oldData"), // L124521
  bytes(11, "buf"), // L124541
];

// OnlineImage — reference L124606 — port decoder decodeOnlineImage
const ONLINE_IMAGE_FIELDS: readonly FieldSpec[] = [
  bytes(1, "guid"), // L124632
  bytes(2, "filePath"), // L124652
  bytes(3, "oldVerSendFile"), // L124672
];

// NotOnlineImage — reference L124737 — port decoder decodeNotOnlineImage
const NOT_ONLINE_IMAGE_FIELDS: readonly FieldSpec[] = [
  str(1, "filePath"), // L124789
  u32(2, "fileLen"), // L124809
  str(3, "downloadPath"), // L124827
  bytes(4, "oldVerSendFile"), // L124847
  i32(5, "imgType"), // L124867
  bytes(6, "previewsImage"), // L124885
  bytes(7, "picMd5"), // L124905
  u32(8, "picHeight"), // L124925
  u32(9, "picWidth"), // L124943
  str(10, "resId"), // L124961
  bytes(11, "flag"), // L124981
  str(12, "thumbUrl"), // L125001
  i32(13, "original"), // L125021
  str(14, "bigUrl"), // L125039
  str(15, "origUrl"), // L125059
  i32(16, "bizType"), // L125079
  i32(17, "result"), // L125097
  i32(18, "index"), // L125115
  bytes(19, "opFaceBuf"), // L125133
  bool(20, "oldPicMd5"), // L125153
  i32(21, "thumbWidth"), // L125171
  i32(22, "thumbHeight"), // L125189
  i32(23, "fileId"), // L125207
  u32(24, "showLen"), // L125225
  u32(25, "downloadLen"), // L125243
  str(26, "x400Url"), // L125261
  i32(27, "x400Width"), // L125281
  i32(28, "x400Height"), // L125299
  msg(29, "pbRes", decodeNotOnlineImagePbReserve), // L125317
];

// NotOnlineImagePbReserve — reference L125408 — port decoder decodeNotOnlineImagePbReserve
const NOT_ONLINE_IMAGE_PB_RESERVE_FIELDS: readonly FieldSpec[] = [
  i32(1, "subType"), // L125439
  i32(3, "field3"), // L125457
  i32(4, "field4"), // L125475
  str(8, "summary"), // L125493
  i32(10, "field10"), // L125513
  msg(20, "field20", decodeNotOnlineImagePbReserve2), // L125531
  str(30, "url"), // L125551
  str(31, "md5Str"), // L125571
];

// NotOnlineImagePbReserve2 — reference L125641 — port decoder decodeNotOnlineImagePbReserve2
const NOT_ONLINE_IMAGE_PB_RESERVE2_FIELDS: readonly FieldSpec[] = [
  i32(1, "field1"), // L125670
  str(2, "field2"), // L125688
  i32(3, "field3"), // L125708
  i32(4, "field4"), // L125726
  i32(5, "field5"), // L125744
  str(7, "field7"), // L125762
];

// TransElem — reference L125830 — port decoder decodeTransElem
const TRANS_ELEM_FIELDS: readonly FieldSpec[] = [
  i32(1, "elemType"), // L125855
  bytes(2, "elemValue"), // L125873
];

// MarketFace — reference L125937 — port decoder decodeMarketFace
const MARKET_FACE_FIELDS: readonly FieldSpec[] = [
  str(1, "faceName"), // L125973
  u32(2, "itemType"), // L125993
  u32(3, "faceInfo"), // L126011
  bytes(4, "faceId"), // L126029
  u32(5, "tabId"), // L126049
  u32(6, "subType"), // L126067
  str(7, "key"), // L126085
  bytes(8, "param"), // L126105
  u32(9, "mediaType"), // L126125
  u32(10, "imageWidth"), // L126143
  u32(11, "imageHeight"), // L126161
  bytes(12, "mobileParam"), // L126179
  bytes(13, "pbReserve"), // L126199
];

// CustomFace — reference L126274 — port decoder decodeCustomFace
const CUSTOM_FACE_FIELDS: readonly FieldSpec[] = [
  bytes(1, "guid"), // L126331
  str(2, "filePath"), // L126351
  str(3, "shortcut"), // L126371
  bytes(4, "buffer"), // L126391
  bytes(5, "flag"), // L126411
  bytes(6, "oldData"), // L126431
  u32(7, "fileId"), // L126451
  i32(8, "serverIp"), // L126469
  i32(9, "serverPort"), // L126487
  i32(10, "fileType"), // L126505
  bytes(11, "signature"), // L126523
  i32(12, "useful"), // L126543
  bytes(13, "md5"), // L126561
  str(14, "thumbUrl"), // L126581
  str(15, "bigUrl"), // L126601
  str(16, "origUrl"), // L126621
  i32(17, "bizType"), // L126641
  i32(18, "repeatIndex"), // L126659
  i32(19, "repeatImage"), // L126677
  i32(20, "imageType"), // L126695
  i32(21, "index"), // L126713
  i32(22, "width"), // L126731
  i32(23, "height"), // L126749
  i32(24, "source"), // L126767
  u32(25, "size"), // L126785
  i32(26, "origin"), // L126803
  i32(27, "thumbWidth"), // L126821
  i32(28, "thumbHeight"), // L126839
  i32(29, "showLen"), // L126857
  i32(30, "downloadLen"), // L126875
  str(31, "x400Url"), // L126893
  i32(32, "x400Width"), // L126913
  i32(33, "x400Height"), // L126931
  msg(34, "pbRes", decodeCustomFacePbReserve), // L126949
];

// CustomFacePbReserve — reference L127045 — port decoder decodeCustomFacePbReserve
const CUSTOM_FACE_PB_RESERVE_FIELDS: readonly FieldSpec[] = [
  i32(1, "subType"), // L127070
  str(9, "summary"), // L127088
];

// RichMsg — reference L127152 — port decoder decodeRichMsg
const RICH_MSG_FIELDS: readonly FieldSpec[] = [
  bytes(1, "template1"), // L127180
  i32(2, "serviceId"), // L127200
  bytes(3, "msgResId"), // L127218
  i32(4, "rand"), // L127238
  u32(5, "seq"), // L127256
];

// GroupFileElem — reference L127321 — port decoder decodeGroupFileElem
const GROUP_FILE_ELEM_FIELDS: readonly FieldSpec[] = [
  str(1, "filename"), // L127354
  i64(2, "fileSize"), // L127374
  str(3, "fileId"), // L127390
  str(4, "batchId"), // L127410
  str(5, "fileKey"), // L127430
  bytes(6, "mark"), // L127450
  i64(7, "sequence"), // L127470
  bytes(8, "batchItemId"), // L127486
  i32(9, "feedMsgTime"), // L127506
  bytes(10, "pbReserve"), // L127524
];

// ExtraInfo — reference L127596 — port decoder decodeExtraInfo
const EXTRA_INFO_FIELDS: readonly FieldSpec[] = [
  bytes(1, "nick"), // L127631
  bytes(2, "groupCard"), // L127651
  i32(3, "level"), // L127671
  i32(4, "flags"), // L127689
  i32(5, "groupMask"), // L127707
  i32(6, "msgTailId"), // L127725
  bytes(7, "senderTitle"), // L127743
  bytes(8, "apnsTips"), // L127763
  i64(9, "uin"), // L127783
  i32(10, "msgStateFlag"), // L127799
  i32(11, "apnsSoundType"), // L127817
  i32(12, "newGroupFlag"), // L127835
];

// VideoFile — reference L127907 — port decoder decodeVideoFile
const VIDEO_FILE_FIELDS: readonly FieldSpec[] = [
  str(1, "fileUuid"), // L127950
  bytes(2, "fileMd5"), // L127970
  str(3, "fileName"), // L127990
  i32(4, "fileFormat"), // L128010
  i32(5, "fileTime"), // L128028
  i32(6, "fileSize"), // L128046
  i32(7, "thumbWidth"), // L128064
  i32(8, "thumbHeight"), // L128082
  bytes(9, "thumbFileMd5"), // L128100
  bytes(10, "source"), // L128120
  i32(11, "thumbFileSize"), // L128140
  i32(12, "busiType"), // L128158
  i32(13, "fromChatType"), // L128176
  i32(14, "toChatType"), // L128194
  bool(15, "supportProgressive"), // L128212
  i32(16, "fileWidth"), // L128230
  i32(17, "fileHeight"), // L128248
  i32(18, "subBusiType"), // L128266
  i32(19, "videoAttr"), // L128284
  bytes(24, "pbReserve"), // L128302
];

// GeneralFlags — reference L128384 — port decoder decodeGeneralFlags
const GENERAL_FLAGS_FIELDS: readonly FieldSpec[] = [
  i32(1, "bubbleDiyTextId"), // L128412
  i32(2, "groupFlagNew"), // L128430
  i64(3, "uin"), // L128448
  i32(6, "longTextFlag"), // L128464
  str(7, "longTextResId"), // L128482
];

// SrcMsg — reference L128549 — port decoder decodeSrcMsg
const SRC_MSG_FIELDS: readonly FieldSpec[] = [
  repU32(1, "origSeqs"), // L128583
  repU32(1, "origSeqs"), // L128601
  i64(2, "senderUin"), // L128637
  i32(3, "time"), // L128653
  i32(4, "flag"), // L128671
  repBytes(5, "elemsRaw"), // L128689
  i32(6, "type"), // L128709
  bytes(7, "richMsg"), // L128727
  bytes(8, "pbReserve"), // L128747
  bytes(9, "sourceMsg"), // L128767
  i64(10, "toUin"), // L128787
  bytes(11, "troopName"), // L128803
];

// LightAppElem — reference L128876 — port decoder decodeLightAppElem
const LIGHT_APP_ELEM_FIELDS: readonly FieldSpec[] = [
  bytes(1, "data"), // L128901
  bytes(2, "msgResid"), // L128921
];

// CommonElem — reference L128985 — port decoder decodeCommonElem
const COMMON_ELEM_FIELDS: readonly FieldSpec[] = [
  i32(1, "serviceType"), // L129011
  bytes(2, "pbElem"), // L129029
  u32(3, "businessType"), // L129049
];

// NotOnlineFile — reference L129112 — port decoder decodeNotOnlineFile
const NOT_ONLINE_FILE_FIELDS: readonly FieldSpec[] = [
  u32(1, "fileType"), // L129146
  str(3, "fileUuid"), // L129164
  bytes(4, "fileMd5"), // L129184
  str(5, "fileName"), // L129204
  i64(6, "fileSize"), // L129224
  u32(9, "subcmd"), // L129240
  u32(12, "downloadFlag"), // L129258
  u32(50, "dangerEvel"), // L129276
  u32(55, "expireTime"), // L129294
  bytes(56, "pbReserve"), // L129312
  str(57, "fileHash"), // L129332
];

// Ptt — reference L129405 — port decoder decodePtt
const PTT_FIELDS: readonly FieldSpec[] = [
  u32(1, "fileType"), // L129438
  i64(2, "fileId"), // L129456
  bytes(3, "fileUuid"), // L129472
  bytes(4, "fileMd5"), // L129492
  str(5, "fileName"), // L129512
  u32(6, "fileSize"), // L129532
  str(10, "groupFileKey"), // L129550
  bytes(14, "fileKey"), // L129570
  u32(19, "time"), // L129590
  u32(29, "format"), // L129608
];

// MentionExtra — reference L133767 — port decoder decodeMentionExtra
const MENTION_EXTRA_FIELDS: readonly FieldSpec[] = [
  i32(3, "type"), // L133794
  u32(4, "uin"), // L133812
  i32(5, "field5"), // L133830
  str(9, "uid"), // L133848
];

// GroupFileExtra — reference L133914 — port decoder decodeGroupFileExtra
const GROUP_FILE_EXTRA_FIELDS: readonly FieldSpec[] = [
  u32(1, "field1"), // L133941
  str(2, "fileName"), // L133959
  str(3, "display"), // L133979
  msg(7, "inner", decodeGroupFileExtraInner), // L133999
];

// GroupFileExtraInner — reference L134065 — port decoder decodeGroupFileExtraInner
const GROUP_FILE_EXTRA_INNER_FIELDS: readonly FieldSpec[] = [
  msg(2, "info", decodeGroupFileInfo), // L134089
];

// GroupFileInfo — reference L134150 — port decoder decodeGroupFileInfo
const GROUP_FILE_INFO_FIELDS: readonly FieldSpec[] = [
  u32(1, "busId"), // L134181
  str(2, "fileId"), // L134199
  i64(3, "fileSize"), // L134219
  str(4, "fileName"), // L134235
  u32(5, "field5"), // L134255
  bytes(6, "fileSha"), // L134273
  str(7, "extInfoString"), // L134293
  bytes(8, "fileMd5"), // L134313
];

// QSmallFaceExtra — reference L134794 — port decoder decodeQSmallFaceExtra
const Q_SMALL_FACE_EXTRA_FIELDS: readonly FieldSpec[] = [
  u32(1, "faceId"), // L134820
  str(2, "preview"), // L134838
  str(3, "preview2"), // L134858
];

// QFaceExtra — reference L131973 — port decoder decodeQFaceExtra
const Q_FACE_EXTRA_FIELDS: readonly FieldSpec[] = [
  str(1, "packId"), // L132004
  str(2, "stickerId"), // L132024
  i32(3, "qsid"), // L132044
  i32(4, "sourceType"), // L132062
  i32(5, "stickerType"), // L132080
  str(6, "resultId"), // L132098
  str(7, "text"), // L132118
  i32(9, "randomType"), // L132138
];

// MsgInfo — reference L134383 — port decoder decodeMsgInfo
const MSG_INFO_FIELDS: readonly FieldSpec[] = [
  repMsg(1, "msgInfoBody", decodeMsgInfoBody), // L134408
  msg(2, "extBizInfo", decodeExtBizInfo), // L134428
];

// MsgInfoBody — reference L134492 — port decoder decodeMsgInfoBody
const MSG_INFO_BODY_FIELDS: readonly FieldSpec[] = [
  msg(1, "index", decodeIndexNode), // L134519
  msg(2, "picture", decodePictureInfo), // L134539
  bool(5, "fileExist"), // L134559
  msg(6, "hashSum", decodeHashSum), // L134577
];

// IndexNode — reference L130151 — port decoder decodeIndexNode
const INDEX_NODE_FIELDS: readonly FieldSpec[] = [
  msg(1, "info", decodeFileInfo), // L130180
  str(2, "fileUuid"), // L130200
  u32(3, "storeId"), // L130220
  u32(4, "uploadTime"), // L130238
  u32(5, "ttl"), // L130256
  u32(6, "subType"), // L130274
];

// HashSum — reference L131000 — port decoder decodeHashSum
const HASH_SUM_FIELDS: readonly FieldSpec[] = [
  msg(201, "bytesPbReserveC2c", decodeC2cSource), // L131025
  msg(202, "troopSource", decodeTroopSource), // L131045
];

// PictureInfo — reference L130738 — port decoder decodePictureInfo
const PICTURE_INFO_FIELDS: readonly FieldSpec[] = [
  str(1, "urlPath"), // L130764
  msg(2, "ext", decodePicUrlExtInfo), // L130784
  str(3, "domain"), // L130804
];

// PicUrlExtInfo — reference L130869 — port decoder decodePicUrlExtInfo
const PIC_URL_EXT_INFO_FIELDS: readonly FieldSpec[] = [
  str(1, "originalParameter"), // L130895
  str(2, "bigParameter"), // L130915
  str(3, "thumbParameter"), // L130935
];

// ExtBizInfo — reference L134643 — port decoder decodeExtBizInfo
const EXT_BIZ_INFO_FIELDS: readonly FieldSpec[] = [
  msg(1, "pic", decodePicExtBizInfo), // L134670
  msg(2, "video", decodeVideoExtBizInfo), // L134690
  msg(3, "ptt", decodePttExtBizInfo), // L134710
  u32(10, "busiType"), // L134730
];

// PicExtBizInfo — reference L131277 — port decoder decodePicExtBizInfo
const PIC_EXT_BIZ_INFO_FIELDS: readonly FieldSpec[] = [
  u32(1, "bizType"), // L131307
  str(2, "textSummary"), // L131325
  bytes(11, "bytesPbReserveC2c"), // L131345
  msg(12, "extData", decodePicExtData), // L131365
  u32(1001, "fromScene"), // L131385
  u32(1002, "toScene"), // L131403
  u32(1003, "oldFileId"), // L131421
];

// PttExtBizInfo — reference L131722 — port decoder decodePttExtBizInfo
const PTT_EXT_BIZ_INFO_FIELDS: readonly FieldSpec[] = [
  i64(1, "srcUin"), // L131754
  u32(2, "pttScene"), // L131770
  u32(3, "pttType"), // L131788
  u32(4, "changeVoice"), // L131806
  bytes(5, "waveform"), // L131824
  u32(6, "autoConvertText"), // L131844
  bytes(11, "bytesReserve"), // L131862
  bytes(12, "bytesPbReserve"), // L131882
  bytes(13, "bytesGeneralFlags"), // L131902
];

// VideoExtBizInfo — reference L131595 — port decoder decodeVideoExtBizInfo
const VIDEO_EXT_BIZ_INFO_FIELDS: readonly FieldSpec[] = [
  u32(1, "fromScene"), // L131621
  u32(2, "toScene"), // L131639
  bytes(3, "bytesPbReserve"), // L131657
];

// FileType — reference L130593 — port decoder decodeFileType
const FILE_TYPE_FIELDS: readonly FieldSpec[] = [
  u32(1, "type"), // L130620
  u32(2, "picFormat"), // L130638
  u32(3, "videoFormat"), // L130656
  u32(4, "voiceFormat"), // L130674
];

// MarkdownData — reference L132206 — port decoder decodeMarkdownData
const MARKDOWN_DATA_FIELDS: readonly FieldSpec[] = [
  str(1, "content"), // L132236
  str(2, "field2"), // L132256
  bytes(3, "field3"), // L132276
  str(4, "processMsg"), // L132296
  str(5, "summary"), // L132316
  u32(6, "extType"), // L132336
  msg(7, "extInfo", decodeMarkdownFlashTransferExt), // L132354
];

// InlineKeyboardExtra — reference L132852 — port decoder decodeInlineKeyboardExtra
const INLINE_KEYBOARD_EXTRA_FIELDS: readonly FieldSpec[] = [
  msg(1, "keyboard", decodeInlineKeyboardData), // L132876
];

// InlineKeyboardData — reference L132937 — port decoder decodeInlineKeyboardData
const INLINE_KEYBOARD_DATA_FIELDS: readonly FieldSpec[] = [
  repMsg(1, "rows", decodeInlineKeyboardRow), // L132962
  i64(2, "botAppid"), // L132982
];

// InlineKeyboardRow — reference L133042 — port decoder decodeInlineKeyboardRow
const INLINE_KEYBOARD_ROW_FIELDS: readonly FieldSpec[] = [
  repMsg(1, "buttons", decodeInlineKeyboardButton), // L133066
];

// InlineKeyboardButton — reference L133127 — port decoder decodeInlineKeyboardButton
const INLINE_KEYBOARD_BUTTON_FIELDS: readonly FieldSpec[] = [
  str(1, "id"), // L133153
  msg(2, "renderData", decodeInlineKeyboardRenderData), // L133173
  msg(3, "action", decodeInlineKeyboardAction), // L133193
];

// InlineKeyboardRenderData — reference L133258 — port decoder decodeInlineKeyboardRenderData
const INLINE_KEYBOARD_RENDER_FIELDS: readonly FieldSpec[] = [
  str(1, "label"), // L133284
  str(2, "visitedLabel"), // L133304
  u32(3, "style"), // L133324
];

// InlineKeyboardAction — reference L133387 — port decoder decodeInlineKeyboardAction
const INLINE_KEYBOARD_ACTION_FIELDS: readonly FieldSpec[] = [
  u32(1, "type"), // L133419
  msg(2, "permission", decodeInlineKeyboardPermission), // L133437
  u32(3, "clickLimit"), // L133457
  str(4, "unsupportedTips"), // L133475
  str(5, "data"), // L133495
  bool(6, "atBotShowChannelList"), // L133515
  bool(7, "reply"), // L133533
  bool(8, "enter"), // L133551
  u32(9, "anchor"), // L133569
];

// InlineKeyboardPermission — reference L133638 — port decoder decodeInlineKeyboardPermission
const INLINE_KEYBOARD_PERMISSION_FIELDS: readonly FieldSpec[] = [
  u32(1, "type"), // L133664
  repU32(2, "specifyRoleIds"), // L133682
  repU32(3, "specifyUserIds"), // L133702
];

// FileExtra — reference L129678 — port decoder decodeFileExtra
const FILE_EXTRA_FIELDS: readonly FieldSpec[] = [
  msg(1, "file", decodeNotOnlineFile), // L129703
  msg(6, "field6", decodePrivateFileExtra), // L129723
];

// GroupMute — reference L146834 — port decoder decodeGroupMute
const GROUP_MUTE_FIELDS: readonly FieldSpec[] = [
  u32(1, "groupUin"), // L146862
  u32(2, "subType"), // L146880
  u32(3, "field3"), // L146898
  str(4, "operatorUid"), // L146916
  msg(5, "data", decodeGroupMuteData), // L146936
];

// GroupMuteData — reference L147003 — port decoder decodeGroupMuteData
const GROUP_MUTE_DATA_FIELDS: readonly FieldSpec[] = [
  u32(1, "timestamp"), // L147029
  u32(2, "type"), // L147047
  msg(3, "state", decodeGroupMuteState), // L147065
];

// GroupMuteState — reference L147130 — port decoder decodeGroupMuteState
const GROUP_MUTE_STATE_FIELDS: readonly FieldSpec[] = [
  str(1, "targetUid"), // L147155
  u32(2, "duration"), // L147175
];

// NotifyMessageBody — reference L147237 — port decoder decodeNotifyMessageBody
const NOTIFY_MESSAGE_BODY_FIELDS: readonly FieldSpec[] = [
  u32(1, "type"), // L147270
  u32(4, "groupUin"), // L147288
  bytes(5, "eventParam"), // L147306
  msg(11, "recall", decodeGroupRecall), // L147326
  u32(13, "field13"), // L147346
  str(21, "operatorUid"), // L147364
  msg(26, "generalGrayTip", decodeGeneralGrayTipInfo), // L147384
  msg(33, "essenceMessage", decodeEssenceMessage), // L147404
  u32(37, "msgSequence"), // L147424
  u32(39, "field39"), // L147442
];

// GroupRecall — reference L147512 — port decoder decodeGroupRecall
const GROUP_RECALL_FIELDS: readonly FieldSpec[] = [
  str(1, "operatorUid"), // L147541
  repMsg(3, "recallMessages", decodeRecallMessage), // L147561
  bytes(5, "userDef"), // L147581
  i32(6, "groupType"), // L147601
  i32(7, "opType"), // L147619
  msg(9, "tipInfo", decodeGroupRecallTipInfo), // L147637
];

// RecallMessage — reference L147705 — port decoder decodeRecallMessage
const RECALL_MESSAGE_FIELDS: readonly FieldSpec[] = [
  u32(1, "sequence"), // L147734
  u32(2, "time"), // L147752
  u32(3, "random"), // L147770
  u32(4, "type"), // L147788
  u32(5, "flag"), // L147806
  str(6, "authorUid"), // L147824
];

// GeneralGrayTipInfo — reference L147977 — port decoder decodeGeneralGrayTipInfo
const GENERAL_GRAY_TIP_INFO_FIELDS: readonly FieldSpec[] = [
  i64(1, "busiType"), // L148008
  i64(2, "busiId"), // L148024
  u32(3, "ctrlFlag"), // L148040
  u32(4, "c2cType"), // L148058
  u32(5, "serviceType"), // L148076
  i64(6, "templId"), // L148094
  repMsg(7, "msgTemplParam", decodeTemplParam), // L148110
  str(8, "content"), // L148130
];

// TemplParam — reference L148200 — port decoder decodeTemplParam
const TEMPL_PARAM_FIELDS: readonly FieldSpec[] = [
  str(1, "name"), // L148225
  str(2, "value"), // L148245
];

// FriendRequest — reference L144630 — port decoder decodeFriendRequest
const FRIEND_REQUEST_FIELDS: readonly FieldSpec[] = [
  msg(1, "info", decodeFriendRequestInfo), // L144654
];

// FriendRequestInfo — reference L144715 — port decoder decodeFriendRequestInfo
const FRIEND_REQUEST_INFO_FIELDS: readonly FieldSpec[] = [
  str(1, "targetUid"), // L144743
  str(2, "sourceUid"), // L144763
  str(5, "newSource"), // L144783
  str(10, "message"), // L144803
  str(11, "source"), // L144823
];

// FriendRecall — reference L144890 — port decoder decodeFriendRecall
const FRIEND_RECALL_FIELDS: readonly FieldSpec[] = [
  msg(1, "info", decodeFriendRecallInfo), // L144918
  u32(2, "instId"), // L144938
  u32(3, "appId"), // L144956
  u32(4, "longMessageFlag"), // L144974
  bytes(5, "reserved"), // L144992
];

// FriendRecallInfo — reference L145059 — port decoder decodeFriendRecallInfo
const FRIEND_RECALL_INFO_FIELDS: readonly FieldSpec[] = [
  str(1, "fromUid"), // L145092
  str(2, "toUid"), // L145112
  u32(3, "clientSequence"), // L145132
  i64(4, "newId"), // L145150
  u32(5, "time"), // L145166
  u32(6, "random"), // L145184
  u32(7, "pkgNum"), // L145202
  u32(8, "pkgIndex"), // L145220
  u32(9, "divSeq"), // L145238
  msg(13, "tipInfo", decodeFriendRecallTipInfo), // L145256
];

// NewFriend — reference L145413 — port decoder decodeNewFriend
const NEW_FRIEND_FIELDS: readonly FieldSpec[] = [
  u32(1, "field1"), // L145438
  msg(2, "info", decodeNewFriendInfo), // L145456
];

// NewFriendInfo — reference L145520 — port decoder decodeNewFriendInfo
const NEW_FRIEND_INFO_FIELDS: readonly FieldSpec[] = [
  str(1, "uid"), // L145551
  u32(2, "field2"), // L145571
  u32(3, "time"), // L145589
  str(4, "message"), // L145607
  str(5, "nickName"), // L145627
  u32(6, "field6"), // L145647
  u32(7, "field7"), // L145665
  str(9, "toUid"), // L145683
];

// GroupAdmin — reference L151900 — port decoder decodeGroupAdmin
const GROUP_ADMIN_FIELDS: readonly FieldSpec[] = [
  u32(1, "groupUin"), // L151927
  u32(2, "flag"), // L151945
  bool(3, "isPromote"), // L151963
  msg(4, "body", decodeGroupAdminBody), // L151981
];

// GroupAdminExtra — reference L152156 — port decoder decodeGroupAdminExtra
const GROUP_ADMIN_EXTRA_FIELDS: readonly FieldSpec[] = [
  str(1, "adminUid"), // L152181
  bool(2, "isPromote"), // L152201
];

// GroupInvitation — reference L152620 — port decoder decodeGroupInvitation
const GROUP_INVITATION_FIELDS: readonly FieldSpec[] = [
  i32(1, "cmd"), // L152645
  msg(2, "info", decodeInvitationInfo), // L152663
];

// GroupInvite — reference L153105 — port decoder decodeGroupInvite
const GROUP_INVITE_FIELDS: readonly FieldSpec[] = [
  u32(1, "groupUin"), // L153134
  u32(2, "field2"), // L153152
  u32(3, "field3"), // L153170
  u32(4, "field4"), // L153188
  str(5, "invitorUid"), // L153206
  bytes(6, "hashes"), // L153226
];

// OperatorInfo — reference L121900 — port decoder decodeOperatorInfo
const OPERATOR_INFO_FIELDS: readonly FieldSpec[] = [
  msg(1, "operatorField", decodeOperatorField1), // L121924
];

// OperatorField1 — reference L121985 — port decoder decodeOperatorField1
const OPERATOR_FIELD1_FIELDS: readonly FieldSpec[] = [
  str(1, "uid"), // L122013
  u32(2, "field2"), // L122033
  bytes(3, "field3"), // L122051
  u32(4, "field4"), // L122071
  bytes(5, "field5"), // L122089
];

// EssenceMessage — reference L148309 — port decoder decodeEssenceMessage
const ESSENCE_MESSAGE_FIELDS: readonly FieldSpec[] = [
  u32(1, "groupUin"), // L148343
  u32(2, "msgSequence"), // L148361
  u32(3, "random"), // L148379
  u32(4, "setFlag"), // L148397
  u32(5, "memberUin"), // L148415
  u32(6, "operatorUin"), // L148433
  u32(7, "timestamp"), // L148451
  u32(8, "msgSequence2"), // L148469
  str(9, "operatorNickname"), // L148487
  str(10, "memberNickname"), // L148507
  u32(11, "setFlag2"), // L148527
];

// C2cSource — reference L131109 — port decoder decodeC2cSource
const C2C_SOURCE_FIELDS: readonly FieldSpec[] = [
  str(2, "friendUid"), // L131133
];

// FileInfo — reference L130340 — port decoder decodeFileInfo
const FILE_INFO_FIELDS: readonly FieldSpec[] = [
  u32(1, "fileSize"), // L130372
  str(2, "fileHash"), // L130390
  str(3, "fileSha1"), // L130410
  str(4, "fileName"), // L130430
  msg(5, "type", decodeFileType), // L130450
  u32(6, "width"), // L130470
  u32(7, "height"), // L130488
  u32(8, "time"), // L130506
  u32(9, "original"), // L130524
];

// FriendRecallTipInfo — reference L145328 — port decoder decodeFriendRecallTipInfo
const FRIEND_RECALL_TIP_INFO_FIELDS: readonly FieldSpec[] = [
  str(2, "tip"), // L145352
];

// GroupAdminBody — reference L152047 — port decoder decodeGroupAdminBody
const GROUP_ADMIN_BODY_FIELDS: readonly FieldSpec[] = [
  msg(1, "extraDisable", decodeGroupAdminExtra), // L152072
  msg(2, "extraEnable", decodeGroupAdminExtra), // L152092
];

// GroupRecallTipInfo — reference L147892 — port decoder decodeGroupRecallTipInfo
const GROUP_RECALL_TIP_INFO_FIELDS: readonly FieldSpec[] = [
  str(2, "tip"), // L147916
];

// InvitationInfo — reference L152727 — port decoder decodeInvitationInfo
const INVITATION_INFO_FIELDS: readonly FieldSpec[] = [
  msg(1, "inner", decodeInvitationInner), // L152751
];

// InvitationInner — reference L152812 — port decoder decodeInvitationInner
const INVITATION_INNER_FIELDS: readonly FieldSpec[] = [
  u32(1, "groupUin"), // L152846
  u32(2, "field2"), // L152864
  u32(3, "field3"), // L152882
  u32(4, "field4"), // L152900
  str(5, "targetUid"), // L152918
  str(6, "invitorUid"), // L152938
  u32(7, "field7"), // L152958
  u32(9, "field9"), // L152976
  bytes(10, "field10"), // L152994
  u32(11, "field11"), // L153014
  str(12, "field12"), // L153032
];

// MarkdownFlashTransferExt — reference L132423 — port decoder decodeMarkdownFlashTransferExt
const MARKDOWN_FLASH_TRANSFER_EXT_FIELDS: readonly FieldSpec[] = [
  str(1, "filesetId"), // L132451
  str(2, "name"), // L132471
  u32(3, "fileSize"), // L132491
  msg(4, "thumbnail", decodeMarkdownFlashTransferThumb), // L132509
  u32(6, "expireTime"), // L132529
];

// MarkdownFlashTransferThumb — reference L132594 — port decoder decodeMarkdownFlashTransferThumb
const MARKDOWN_FLASH_TRANSFER_THUMB_FIELDS: readonly FieldSpec[] = [
  str(1, "fileId"), // L132621
  msg(2, "download", decodeMarkdownFlashTransferThumbUrl), // L132641
  str(3, "sha1"), // L132661
  u32(4, "field4"), // L132681
];

// MarkdownFlashTransferThumbUrl — reference L132745 — port decoder decodeMarkdownFlashTransferThumbUrl
const MARKDOWN_FLASH_TRANSFER_THUMB_URL_FIELDS: readonly FieldSpec[] = [
  u32(1, "field1"), // L132770
  str(2, "downloadUrl"), // L132788
];

// PicExtData — reference L131488 — port decoder decodePicExtData
const PIC_EXT_DATA_FIELDS: readonly FieldSpec[] = [
  u32(1, "subType"), // L131513
  str(9, "textSummary"), // L131531
];

// PrivateFileExtra — reference L129787 — port decoder decodePrivateFileExtra
const PRIVATE_FILE_EXTRA_FIELDS: readonly FieldSpec[] = [
  msg(2, "field2", decodePrivateFileExtraField2), // L129811
];

// PrivateFileExtraField2 — reference L129872 — port decoder decodePrivateFileExtraField2
const PRIVATE_FILE_EXTRA_FIELD2_FIELDS: readonly FieldSpec[] = [
  u32(1, "field1"), // L129905
  str(4, "fileUuid"), // L129923
  str(5, "fileName"), // L129943
  u32(6, "field6"), // L129963
  bytes(7, "field7"), // L129981
  bytes(8, "field8"), // L130001
  u32(9, "timestamp1"), // L130021
  str(14, "fileHash"), // L130039
  str(15, "selfUid"), // L130059
  str(16, "destUid"), // L130079
];

// TroopSource — reference L131194 — port decoder decodeTroopSource
const TROOP_SOURCE_FIELDS: readonly FieldSpec[] = [
  u32(1, "groupUin"), // L131218
];

// ===========================================================================
// Decoders — one per table above
// ===========================================================================
//
// `function` declarations hoist, so the tables above can name these. Each is
// exported so the differential harness (`work/msgpush/compare.mjs`) can compare
// it field-by-field against the reference's own `protobuf_decode_*`.

export function decodePushMsg(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, PUSH_MSG_FIELDS);
}

export function decodePushMsgBody(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, PUSH_MSG_BODY_FIELDS);
}

export function decodeResponseHead(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, RESPONSE_HEAD_FIELDS);
}

export function decodeResponseForward(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, RESPONSE_FORWARD_FIELDS);
}

export function decodeResponseGrp(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, RESPONSE_GRP_FIELDS);
}

export function decodeContentHead(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, CONTENT_HEAD_FIELDS);
}

export function decodeMessageBody(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, MESSAGE_BODY_FIELDS);
}

export function decodeRichText(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, RICH_TEXT_FIELDS);
}

export function decodeElem(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, ELEM_FIELDS);
}

export function decodeTextElem(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, TEXT_ELEM_FIELDS);
}

export function decodeFaceElem(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, FACE_ELEM_FIELDS);
}

export function decodeOnlineImage(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, ONLINE_IMAGE_FIELDS);
}

export function decodeNotOnlineImage(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, NOT_ONLINE_IMAGE_FIELDS);
}

export function decodeNotOnlineImagePbReserve(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, NOT_ONLINE_IMAGE_PB_RESERVE_FIELDS);
}

export function decodeNotOnlineImagePbReserve2(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, NOT_ONLINE_IMAGE_PB_RESERVE2_FIELDS);
}

export function decodeTransElem(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, TRANS_ELEM_FIELDS);
}

export function decodeMarketFace(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, MARKET_FACE_FIELDS);
}

export function decodeCustomFace(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, CUSTOM_FACE_FIELDS);
}

export function decodeCustomFacePbReserve(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, CUSTOM_FACE_PB_RESERVE_FIELDS);
}

export function decodeRichMsg(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, RICH_MSG_FIELDS);
}

export function decodeGroupFileElem(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GROUP_FILE_ELEM_FIELDS);
}

export function decodeExtraInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, EXTRA_INFO_FIELDS);
}

export function decodeVideoFile(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, VIDEO_FILE_FIELDS);
}

export function decodeGeneralFlags(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GENERAL_FLAGS_FIELDS);
}

export function decodeSrcMsg(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, SRC_MSG_FIELDS);
}

export function decodeLightAppElem(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, LIGHT_APP_ELEM_FIELDS);
}

export function decodeCommonElem(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, COMMON_ELEM_FIELDS);
}

export function decodeNotOnlineFile(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, NOT_ONLINE_FILE_FIELDS);
}

export function decodePtt(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, PTT_FIELDS);
}

export function decodeMentionExtra(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, MENTION_EXTRA_FIELDS);
}

export function decodeGroupFileExtra(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GROUP_FILE_EXTRA_FIELDS);
}

export function decodeGroupFileExtraInner(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GROUP_FILE_EXTRA_INNER_FIELDS);
}

export function decodeGroupFileInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GROUP_FILE_INFO_FIELDS);
}

export function decodeQSmallFaceExtra(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, Q_SMALL_FACE_EXTRA_FIELDS);
}

export function decodeQFaceExtra(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, Q_FACE_EXTRA_FIELDS);
}

export function decodeMsgInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, MSG_INFO_FIELDS);
}

export function decodeMsgInfoBody(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, MSG_INFO_BODY_FIELDS);
}

export function decodeIndexNode(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, INDEX_NODE_FIELDS);
}

export function decodeHashSum(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, HASH_SUM_FIELDS);
}

export function decodePictureInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, PICTURE_INFO_FIELDS);
}

export function decodePicUrlExtInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, PIC_URL_EXT_INFO_FIELDS);
}

export function decodeExtBizInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, EXT_BIZ_INFO_FIELDS);
}

export function decodePicExtBizInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, PIC_EXT_BIZ_INFO_FIELDS);
}

export function decodePttExtBizInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, PTT_EXT_BIZ_INFO_FIELDS);
}

export function decodeVideoExtBizInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, VIDEO_EXT_BIZ_INFO_FIELDS);
}

export function decodeFileType(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, FILE_TYPE_FIELDS);
}

export function decodeMarkdownData(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, MARKDOWN_DATA_FIELDS);
}

export function decodeInlineKeyboardExtra(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, INLINE_KEYBOARD_EXTRA_FIELDS);
}

export function decodeInlineKeyboardData(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, INLINE_KEYBOARD_DATA_FIELDS);
}

export function decodeInlineKeyboardRow(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, INLINE_KEYBOARD_ROW_FIELDS);
}

export function decodeInlineKeyboardButton(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, INLINE_KEYBOARD_BUTTON_FIELDS);
}

export function decodeInlineKeyboardRenderData(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, INLINE_KEYBOARD_RENDER_FIELDS);
}

export function decodeInlineKeyboardAction(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, INLINE_KEYBOARD_ACTION_FIELDS);
}

export function decodeInlineKeyboardPermission(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, INLINE_KEYBOARD_PERMISSION_FIELDS);
}

export function decodeFileExtra(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, FILE_EXTRA_FIELDS);
}

export function decodeGroupMute(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GROUP_MUTE_FIELDS);
}

export function decodeGroupMuteData(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GROUP_MUTE_DATA_FIELDS);
}

export function decodeGroupMuteState(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GROUP_MUTE_STATE_FIELDS);
}

export function decodeNotifyMessageBody(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, NOTIFY_MESSAGE_BODY_FIELDS);
}

export function decodeGroupRecall(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GROUP_RECALL_FIELDS);
}

export function decodeRecallMessage(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, RECALL_MESSAGE_FIELDS);
}

export function decodeGeneralGrayTipInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GENERAL_GRAY_TIP_INFO_FIELDS);
}

export function decodeTemplParam(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, TEMPL_PARAM_FIELDS);
}

export function decodeFriendRequest(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, FRIEND_REQUEST_FIELDS);
}

export function decodeFriendRequestInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, FRIEND_REQUEST_INFO_FIELDS);
}

export function decodeFriendRecall(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, FRIEND_RECALL_FIELDS);
}

export function decodeFriendRecallInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, FRIEND_RECALL_INFO_FIELDS);
}

export function decodeNewFriend(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, NEW_FRIEND_FIELDS);
}

export function decodeNewFriendInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, NEW_FRIEND_INFO_FIELDS);
}

export function decodeGroupAdmin(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GROUP_ADMIN_FIELDS);
}

export function decodeGroupAdminExtra(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GROUP_ADMIN_EXTRA_FIELDS);
}

export function decodeGroupInvitation(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GROUP_INVITATION_FIELDS);
}

export function decodeGroupInvite(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GROUP_INVITE_FIELDS);
}

export function decodeOperatorInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, OPERATOR_INFO_FIELDS);
}

export function decodeOperatorField1(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, OPERATOR_FIELD1_FIELDS);
}

export function decodeEssenceMessage(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, ESSENCE_MESSAGE_FIELDS);
}

export function decodeC2cSource(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, C2C_SOURCE_FIELDS);
}

export function decodeFileInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, FILE_INFO_FIELDS);
}

export function decodeFriendRecallTipInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, FRIEND_RECALL_TIP_INFO_FIELDS);
}

export function decodeGroupAdminBody(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GROUP_ADMIN_BODY_FIELDS);
}

export function decodeGroupRecallTipInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, GROUP_RECALL_TIP_INFO_FIELDS);
}

export function decodeInvitationInfo(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, INVITATION_INFO_FIELDS);
}

export function decodeInvitationInner(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, INVITATION_INNER_FIELDS);
}

export function decodeMarkdownFlashTransferExt(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, MARKDOWN_FLASH_TRANSFER_EXT_FIELDS);
}

export function decodeMarkdownFlashTransferThumb(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, MARKDOWN_FLASH_TRANSFER_THUMB_FIELDS);
}

export function decodeMarkdownFlashTransferThumbUrl(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, MARKDOWN_FLASH_TRANSFER_THUMB_URL_FIELDS);
}

export function decodePicExtData(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, PIC_EXT_DATA_FIELDS);
}

export function decodePrivateFileExtra(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, PRIVATE_FILE_EXTRA_FIELDS);
}

export function decodePrivateFileExtraField2(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, PRIVATE_FILE_EXTRA_FIELD2_FIELDS);
}

export function decodeTroopSource(data: Uint8Array, offset = 0, end = data.length): unknown {
  return decodeInto<unknown>(data, offset, end, TROOP_SOURCE_FIELDS);
}
