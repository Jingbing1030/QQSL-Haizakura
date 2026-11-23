// Extras: AI voice (0x929b / 0x929d), group todo (0x0f90) and the group top-banner
// list (0x9474).  Four commands that sit in three different reference folders and
// share nothing except being small.
//
// ---------------------------------------------------------------------------
// What each one really is
// ---------------------------------------------------------------------------
//   FetchAiVoice     0x929b (37531) sub 0   "speak this text with voice X"
//   FetchAiVoiceList 0x929d (37533) sub 0   list the voices available
//   GroupTodo        0x0f90 (3984)  sub 1|2|3 set / complete / cancel a todo
//   GetGroupTodoList 0x9474 (38004) sub 0   list the banner-style todos
//
// ⚠️ **`GroupTodo` has NO `subCommand` constant.** Its sub-command comes from
// `resolveSubCommand: (p) => ACTION_TO_SUBCMD[p.action]`, so a bad `action` yields
// `undefined` and the envelope's subCommand field is then absent — not 0, not least
// bad. The three valid actions are the only values that produce a routable packet.
// That is the "one message, three sub-commands" shape, like `0xeac`/`0x9082` in the
// interaction family, and the opposite trap to `0xd69_0`'s "one sub-command, two
// messages".
//
// ⚠️ **`GroupTodo` and `GetGroupTodoList` are NOT the same feature** despite both
// saying "todo". 0x0f90 mutates a single todo keyed by `msgSeq`; 0x9474 reads a list
// of banner entries keyed by `groupUin`. The batch brief listed `GroupTodoList`
// alongside `GroupTodo`, and **`GroupTodoList` does not exist** — the real name is
// `GetGroupTodoList`, at a completely different command number. Nearby numbers
// predicted nothing here either (3984 vs 38004 are not adjacent in any sense).
//
// ---------------------------------------------------------------------------
// The banner identity check
// ---------------------------------------------------------------------------
// `GetGroupTodoList.deserialize` is the most defensive code in this batch: it
// cross-checks two independent encodings of the same message identity.
//
//   `msgId`      = UTF-8 bytes of `"<sequence>_<random>"`, parsed by SOURCE_ID_PATTERN
//   `jumpParam`  = UTF-8 bytes of `{"seq":<n>,"random":<r>}`, parsed as JSON
//
// and if the two disagree on `sequence` or `random` it throws
// `"group todo message identity mismatch"`. Both are required to be *absent or
// equal*: a missing `jumpParam` is fine (`parseJumpIdentity` returns null), a
// missing `msgId` is a hard error. Reproduced in full, including the pattern
// `^([1-9]\d*)_(-?\d+)$` — note the sequence must NOT lead with 0 and the random part
// MAY be negative.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

// ---------------------------------------------------------------------------
// Command numbers
// ---------------------------------------------------------------------------

export const AI_VOICE_COMMAND = 0x929b;
export const AI_VOICE_SUB_COMMAND = 0;
export const AI_VOICE_LIST_COMMAND = 0x929d;
export const AI_VOICE_LIST_SUB_COMMAND = 0;
export const GROUP_TODO_COMMAND = 0x0f90;
export const GROUP_TODO_LIST_COMMAND = 0x9474;
export const GROUP_TODO_LIST_SUB_COMMAND = 0;

/** `ACTION_TO_SUBCMD = { set: 1, complete: 2, cancel: 3 }` (reference :80149). */
export const GROUP_TODO_ACTION_TO_SUB_COMMAND = {
  set: 1,
  complete: 2,
  cancel: 3,
} as const;

export type GroupTodoAction = keyof typeof GROUP_TODO_ACTION_TO_SUB_COMMAND;

/** `TODO_BANNER_FLAG = 1` (reference :80111). */
export const TODO_BANNER_FLAG = 1;

// ---------------------------------------------------------------------------
// FetchAiVoice — 0x929b_0
// ---------------------------------------------------------------------------

export const OidbAiVoiceReqField = {
  groupUin: 1,
  voiceId: 2,
  text: 3,
  chatType: 4,
  session: 5,
} as const;
export const OidbAiVoiceSessionField = { sessionId: 1 } as const;

export interface OidbAiVoiceReq {
  groupUin: number | bigint;
  voiceId: string;
  text: string;
  chatType: number;
  session: { sessionId: number };
}

export function encodeOidbAiVoiceReq(req: OidbAiVoiceReq): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbAiVoiceReqField.groupUin, Number(req.groupUin))
    .string(OidbAiVoiceReqField.voiceId, req.voiceId)
    .string(OidbAiVoiceReqField.text, req.text)
    .uint32(OidbAiVoiceReqField.chatType, req.chatType)
    .message(
      OidbAiVoiceReqField.session,
      new ProtoWriter().uint32(OidbAiVoiceSessionField.sessionId, req.session.sessionId).finish(),
    )
    .finish();
}

export const OidbAiVoiceRespField = {
  statusCode: 1,
  field2: 2,
  field3: 3,
  msgInfo: 4,
} as const;
export const OidbAiVoiceMsgInfoField = { msgInfoBody: 1 } as const;
export const OidbAiVoiceMsgInfoBodyField = { index: 1 } as const;
export const OidbAiVoiceIndexNodeField = {
  info: 1,
  fileUuid: 2,
  storeId: 3,
  uploadTime: 4,
  ttl: 5,
  subType: 6,
} as const;
export const OidbAiVoiceFileInfoField = {
  fileSize: 1,
  fileHash: 2,
  fileSha1: 3,
  fileName: 4,
  type: 5,
  width: 6,
  height: 7,
  time: 8,
  original: 9,
} as const;
export const OidbAiVoiceFileTypeField = {
  type: 1,
  picFormat: 2,
  videoFormat: 3,
  voiceFormat: 4,
} as const;

export interface OidbAiVoiceFileType {
  type: number | null;
  picFormat: number | null;
  videoFormat: number | null;
  voiceFormat: number | null;
}

export interface OidbAiVoiceFileInfo {
  fileSize: number | null;
  fileHash: string | null;
  fileSha1: string | null;
  fileName: string | null;
  type: OidbAiVoiceFileType | null;
  width: number | null;
  height: number | null;
  time: number | null;
  original: number | null;
}

export interface OidbAiVoiceIndexNode {
  info: OidbAiVoiceFileInfo | null;
  fileUuid: string | null;
  storeId: number | null;
  uploadTime: number | null;
  ttl: number | null;
  subType: number | null;
}

export interface OidbAiVoiceMsgInfoBody {
  index: OidbAiVoiceIndexNode | null;
}

export interface OidbAiVoiceMsgInfo {
  msgInfoBody: OidbAiVoiceMsgInfoBody[];
}

export interface OidbAiVoiceResp {
  statusCode: number | null;
  field2: number | null;
  field3: number | null;
  msgInfo: OidbAiVoiceMsgInfo | null;
}

export function decodeOidbAiVoiceFileType(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbAiVoiceFileType {
  const reader = new ProtoReader(data, offset, end);
  const type: OidbAiVoiceFileType = {
    type: null,
    picFormat: null,
    videoFormat: null,
    voiceFormat: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbAiVoiceFileTypeField.type, WireType.varint):
        type.type = reader.uint32();
        break;
      case tagOf(OidbAiVoiceFileTypeField.picFormat, WireType.varint):
        type.picFormat = reader.uint32();
        break;
      case tagOf(OidbAiVoiceFileTypeField.videoFormat, WireType.varint):
        type.videoFormat = reader.uint32();
        break;
      case tagOf(OidbAiVoiceFileTypeField.voiceFormat, WireType.varint):
        type.voiceFormat = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return type;
}

export function decodeOidbAiVoiceFileInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbAiVoiceFileInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: OidbAiVoiceFileInfo = {
    fileSize: null,
    fileHash: null,
    fileSha1: null,
    fileName: null,
    type: null,
    width: null,
    height: null,
    time: null,
    original: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbAiVoiceFileInfoField.fileSize, WireType.varint):
        info.fileSize = reader.uint32();
        break;
      case tagOf(OidbAiVoiceFileInfoField.fileHash, WireType.lengthDelimited):
        info.fileHash = reader.string();
        break;
      case tagOf(OidbAiVoiceFileInfoField.fileSha1, WireType.lengthDelimited):
        info.fileSha1 = reader.string();
        break;
      case tagOf(OidbAiVoiceFileInfoField.fileName, WireType.lengthDelimited):
        info.fileName = reader.string();
        break;
      case tagOf(OidbAiVoiceFileInfoField.type, WireType.lengthDelimited):
        info.type = reader.message(decodeOidbAiVoiceFileType);
        break;
      case tagOf(OidbAiVoiceFileInfoField.width, WireType.varint):
        info.width = reader.uint32();
        break;
      case tagOf(OidbAiVoiceFileInfoField.height, WireType.varint):
        info.height = reader.uint32();
        break;
      case tagOf(OidbAiVoiceFileInfoField.time, WireType.varint):
        info.time = reader.uint32();
        break;
      case tagOf(OidbAiVoiceFileInfoField.original, WireType.varint):
        info.original = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return info;
}

export function decodeOidbAiVoiceIndexNode(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbAiVoiceIndexNode {
  const reader = new ProtoReader(data, offset, end);
  const node: OidbAiVoiceIndexNode = {
    info: null,
    fileUuid: null,
    storeId: null,
    uploadTime: null,
    ttl: null,
    subType: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbAiVoiceIndexNodeField.info, WireType.lengthDelimited):
        node.info = reader.message(decodeOidbAiVoiceFileInfo);
        break;
      case tagOf(OidbAiVoiceIndexNodeField.fileUuid, WireType.lengthDelimited):
        node.fileUuid = reader.string();
        break;
      case tagOf(OidbAiVoiceIndexNodeField.storeId, WireType.varint):
        node.storeId = reader.uint32();
        break;
      case tagOf(OidbAiVoiceIndexNodeField.uploadTime, WireType.varint):
        node.uploadTime = reader.uint32();
        break;
      case tagOf(OidbAiVoiceIndexNodeField.ttl, WireType.varint):
        node.ttl = reader.uint32();
        break;
      case tagOf(OidbAiVoiceIndexNodeField.subType, WireType.varint):
        node.subType = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return node;
}

export function decodeOidbAiVoiceMsgInfoBody(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbAiVoiceMsgInfoBody {
  const reader = new ProtoReader(data, offset, end);
  const body: OidbAiVoiceMsgInfoBody = { index: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(OidbAiVoiceMsgInfoBodyField.index, WireType.lengthDelimited)) {
      body.index = reader.message(decodeOidbAiVoiceIndexNode);
    } else {
      reader.skip(unknown);
    }
  }
  return body;
}

export function decodeOidbAiVoiceMsgInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbAiVoiceMsgInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: OidbAiVoiceMsgInfo = { msgInfoBody: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(OidbAiVoiceMsgInfoField.msgInfoBody, WireType.lengthDelimited)) {
      info.msgInfoBody.push(reader.message(decodeOidbAiVoiceMsgInfoBody));
    } else {
      reader.skip(unknown);
    }
  }
  return info;
}

export function decodeOidbAiVoiceResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbAiVoiceResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: OidbAiVoiceResp = { statusCode: null, field2: null, field3: null, msgInfo: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbAiVoiceRespField.statusCode, WireType.varint):
        resp.statusCode = reader.uint32();
        break;
      case tagOf(OidbAiVoiceRespField.field2, WireType.varint):
        resp.field2 = reader.uint32();
        break;
      case tagOf(OidbAiVoiceRespField.field3, WireType.varint):
        resp.field3 = reader.uint32();
        break;
      case tagOf(OidbAiVoiceRespField.msgInfo, WireType.lengthDelimited):
        resp.msgInfo = reader.message(decodeOidbAiVoiceMsgInfo);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

/**
 * `body.msgInfo?.msgInfoBody?.[0]?.index ?? null` — the first node only.
 *
 * ⚠️ The reference returns the whole `IndexNode`, not just an id, and it returns
 * `null` (not `undefined`) when the chain is short anywhere. `msgInfoBody` is a
 * REPEATED field but only element 0 is consulted: extra nodes are silently ignored
 * and there is no way for a caller to see them. Reproduced.
 */
export function toAiVoiceNode(resp: OidbAiVoiceResp): OidbAiVoiceIndexNode | null {
  return resp.msgInfo?.msgInfoBody?.[0]?.index ?? null;
}

export interface FetchAiVoiceParams {
  groupId: number | bigint;
  voiceId: string;
  text: string;
  chatType: number;
  sessionId: number;
}

export const FetchAiVoice: OidbSpec<
  FetchAiVoiceParams,
  OidbAiVoiceReq,
  OidbAiVoiceResp,
  OidbAiVoiceIndexNode | null
> = {
  command: AI_VOICE_COMMAND,
  subCommand: AI_VOICE_SUB_COMMAND,
  serialize: (params) => ({
    groupUin: params.groupId,
    voiceId: params.voiceId,
    text: params.text,
    chatType: params.chatType,
    session: { sessionId: params.sessionId },
  }),
  encodeBody: encodeOidbAiVoiceReq,
  decodeBody: decodeOidbAiVoiceResp,
  deserialize: toAiVoiceNode,
};

// ---------------------------------------------------------------------------
// FetchAiVoiceList — 0x929d_0
// ---------------------------------------------------------------------------

export const OidbAiVoiceListReqField = { groupUin: 1, chatType: 2 } as const;

export interface OidbAiVoiceListReq {
  groupUin: number | bigint;
  chatType: number;
}

export function encodeOidbAiVoiceListReq(req: OidbAiVoiceListReq): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbAiVoiceListReqField.groupUin, Number(req.groupUin))
    .uint32(OidbAiVoiceListReqField.chatType, req.chatType)
    .finish();
}

export const OidbAiVoiceListRespField = { content: 1 } as const;
export const OidbAiVoiceListCategoryField = { category: 1, voices: 2 } as const;
export const OidbAiVoiceListEntryField = {
  voiceId: 1,
  voiceDisplayName: 2,
  voiceExampleUrl: 3,
} as const;

export interface OidbAiVoiceListEntry {
  voiceId: string | null;
  voiceDisplayName: string | null;
  voiceExampleUrl: string | null;
}

export interface OidbAiVoiceListCategory {
  category: string | null;
  voices: OidbAiVoiceListEntry[];
}

export interface OidbAiVoiceListResp {
  content: OidbAiVoiceListCategory[];
}

export function decodeOidbAiVoiceListEntry(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbAiVoiceListEntry {
  const reader = new ProtoReader(data, offset, end);
  const entry: OidbAiVoiceListEntry = {
    voiceId: null,
    voiceDisplayName: null,
    voiceExampleUrl: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbAiVoiceListEntryField.voiceId, WireType.lengthDelimited):
        entry.voiceId = reader.string();
        break;
      case tagOf(OidbAiVoiceListEntryField.voiceDisplayName, WireType.lengthDelimited):
        entry.voiceDisplayName = reader.string();
        break;
      case tagOf(OidbAiVoiceListEntryField.voiceExampleUrl, WireType.lengthDelimited):
        entry.voiceExampleUrl = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return entry;
}

export function decodeOidbAiVoiceListCategory(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbAiVoiceListCategory {
  const reader = new ProtoReader(data, offset, end);
  const category: OidbAiVoiceListCategory = { category: null, voices: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbAiVoiceListCategoryField.category, WireType.lengthDelimited):
        category.category = reader.string();
        break;
      case tagOf(OidbAiVoiceListCategoryField.voices, WireType.lengthDelimited):
        category.voices.push(reader.message(decodeOidbAiVoiceListEntry));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return category;
}

export function decodeOidbAiVoiceListResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbAiVoiceListResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: OidbAiVoiceListResp = { content: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(OidbAiVoiceListRespField.content, WireType.lengthDelimited)) {
      resp.content.push(reader.message(decodeOidbAiVoiceListCategory));
    } else {
      reader.skip(unknown);
    }
  }
  return resp;
}

export interface FetchAiVoiceListParams {
  groupId: number | bigint;
  chatType: number;
}

export const FetchAiVoiceList: OidbSpec<
  FetchAiVoiceListParams,
  OidbAiVoiceListReq,
  OidbAiVoiceListResp,
  OidbAiVoiceListCategory[]
> = {
  command: AI_VOICE_LIST_COMMAND,
  subCommand: AI_VOICE_LIST_SUB_COMMAND,
  serialize: (params) => ({ groupUin: params.groupId, chatType: params.chatType }),
  encodeBody: encodeOidbAiVoiceListReq,
  decodeBody: decodeOidbAiVoiceListResp,
  deserialize: (body) => body.content ?? [],
};

// ---------------------------------------------------------------------------
// GroupTodo — 0x0f90 (no sub-command constant)
// ---------------------------------------------------------------------------

export const OidbGroupTodoField = { groupUin: 1, msgSeq: 2 } as const;

/** ⚠️ `msgSeq` is typed `bigint` on the wire but the reference passes the caller's
 *  value through **without** `BigInt(...)`, so a plain number reaches `.uint64` and
 *  throws `Cannot convert 7 to a BigInt` inside the encoder. Reproduced exactly:
 *  callers must supply a bigint (or a numeric string the encoder accepts). */
export interface OidbGroupTodo {
  groupUin: number;
  msgSeq: bigint;
}

export function encodeOidbGroupTodo(todo: OidbGroupTodo): Uint8Array {
  return new ProtoWriter()
    .uint32(OidbGroupTodoField.groupUin, todo.groupUin)
    .uint64(OidbGroupTodoField.msgSeq, todo.msgSeq)
    .finish();
}

export interface GroupTodoParams {
  groupId: number;
  /** Must be a `bigint`: the reference does not coerce, and `.uint64` throws on a number. */
  msgSeq: bigint;
  action: GroupTodoAction;
}

/**
 * `GroupTodo` — set / complete / cancel a single todo.
 *
 * ⚠️ `resolveSubCommand` has no `?? 0` fallback, so an `action` outside the three
 * keys yields `undefined` and the envelope's subCommand field is omitted entirely.
 * The port keeps that: a typo produces a malformed packet rather than a silently
 * wrong-but-well-formed one. `message: { msgSeq }` is uint64 while `groupUin` is
 * uint32 — that asymmetry is the reference's.
 *
 * The response is `OidbEmpty$27` and `deserialize` is `(_ctx, _) => {}` — the same
 * empty-block-body quirk as the flash family, so the result is `undefined`.
 */
export const GroupTodo: OidbSpec<GroupTodoParams, OidbGroupTodo, OidbEmptyLike, undefined> = {
  command: GROUP_TODO_COMMAND,
  resolveSubCommand: (params) => GROUP_TODO_ACTION_TO_SUB_COMMAND[params.action],
  serialize: (params) => ({
    groupUin: params.groupId,
    // No `BigInt(...)` here on purpose — see `OidbGroupTodo`. The reference's
    // `serialize` is a plain object literal, so a number-typed `msgSeq` throws at
    // encode time rather than being coerced. Adding the coercion would make the port
    // ACCEPT calls the reference rejects.
    msgSeq: params.msgSeq as bigint,
  }),
  encodeBody: encodeOidbGroupTodo,
  decodeBody: decodeOidbEmptyLike,
  deserialize: () => undefined,
};

// ---------------------------------------------------------------------------
// GetGroupTodoList — 0x9474_0
// ---------------------------------------------------------------------------

export const OidbQueryGroupTopBannersReqField = { groupId: 1, bannerFlag: 2 } as const;

export interface OidbQueryGroupTopBannersReq {
  groupId: bigint;
  bannerFlag: number;
}

export function encodeOidbQueryGroupTopBannersReq(
  req: OidbQueryGroupTopBannersReq,
): Uint8Array {
  return new ProtoWriter()
    .uint64(OidbQueryGroupTopBannersReqField.groupId, req.groupId)
    .uint32(OidbQueryGroupTopBannersReqField.bannerFlag, req.bannerFlag)
    .finish();
}

export const OidbQueryGroupTopBannersRespField = { banners: 1, newSeq: 3 } as const;
export const OidbOnlineBannerField = {
  bizType: 1,
  bannerType: 2,
  msgId: 3,
  isDisappear: 4,
  expireTime: 8,
  todoBanner: 12,
  commonBanner: 20,
  bannerPriority: 40,
  bizId: 41,
  priority: 42,
  leftShowTimes: 43,
  supportMultiBanners: 44,
  supportLongPress: 45,
} as const;
export const OidbGroupTopBannerCommonField = {
  ui: 1,
  jumpInfo: 2,
  createTime: 3,
  updateTime: 4,
} as const;
export const OidbGroupTopBannerUiField = {
  iconUrl: 1,
  preText: 2,
  text: 3,
  highText: 4,
  accessoryType: 5,
  iconColor: 6,
  needTranslation: 7,
} as const;
export const OidbGroupTopBannerJumpInfoField = {
  jumpType: 1,
  jumpUrl: 2,
  jumpParam: 3,
} as const;
/** ⚠️ Field 46 exists too (`noNeedReportShow`, bool) — 13 fields, not 12. */
export const OIDB_ONLINE_BANNER_NO_NEED_REPORT_SHOW = 46;
export const OidbGroupTodoLegacyBannerField = {
  redText: 1,
  text: 2,
  url: 3,
  isExposure: 4,
  isComplete: 5,
} as const;
export const OidbGroupTopBannerPriorityField = { categoryType: 1, priority: 2 } as const;

export interface OidbGroupTopBannerUi {
  iconUrl: string | null;
  preText: string | null;
  text: string | null;
  highText: string | null;
  accessoryType: number | null;
  iconColor: number | null;
  needTranslation: boolean | null;
}

/**
 * ⚠️ `jumpParam` is **bytes** (wire type 2, `data.slice`), even though it is named
 * like a scalar. An earlier pass of my extractor mislabelled it `uint32` because the
 * nested-message regex did not match `$`-suffixed helper names — the same class of
 * bug the rkey family hit. Verified directly at reference:79941 (`_f2 = data.slice`).
 */
export interface OidbGroupTopBannerJumpInfo {
  jumpType: number | null;
  jumpUrl: string | null;
  jumpParam: Uint8Array | null;
}

export interface OidbGroupTodoLegacyBanner {
  redText: string | null;
  text: string | null;
  url: string | null;
  isExposure: boolean | null;
  isComplete: boolean | null;
}

export interface OidbGroupTopBannerPriority {
  categoryType: number | null;
  priority: number | null;
}

export interface OidbGroupTopBannerCommon {
  ui: OidbGroupTopBannerUi | null;
  jumpInfo: OidbGroupTopBannerJumpInfo | null;
  createTime: bigint | null;
  updateTime: bigint | null;
}

export interface OidbOnlineBanner {
  bizType: number | null;
  bannerType: number | null;
  /** ⚠️ UTF-8 bytes, not a number, despite the `msgId` name and uint32-looking field. */
  msgId: Uint8Array | null;
  isDisappear: boolean | null;
  expireTime: bigint | null;
  todoBanner: OidbGroupTodoLegacyBanner | null;
  commonBanner: OidbGroupTopBannerCommon | null;
  bannerPriority: OidbGroupTopBannerPriority | null;
  bizId: number | null;
  priority: number | null;
  leftShowTimes: number | null;
  supportMultiBanners: boolean | null;
  supportLongPress: boolean | null;
  /** Field **46**, discovered only by dumping the decoder's case list. */
  noNeedReportShow: boolean | null;
}

export interface OidbQueryGroupTopBannersResp {
  banners: OidbOnlineBanner[];
  newSeq: bigint | null;
}

export function decodeOidbGroupTopBannerUi(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbGroupTopBannerUi {
  const reader = new ProtoReader(data, offset, end);
  const ui: OidbGroupTopBannerUi = {
    iconUrl: null,
    preText: null,
    text: null,
    highText: null,
    accessoryType: null,
    iconColor: null,
    needTranslation: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbGroupTopBannerUiField.iconUrl, WireType.lengthDelimited):
        ui.iconUrl = reader.string();
        break;
      case tagOf(OidbGroupTopBannerUiField.preText, WireType.lengthDelimited):
        ui.preText = reader.string();
        break;
      case tagOf(OidbGroupTopBannerUiField.text, WireType.lengthDelimited):
        ui.text = reader.string();
        break;
      case tagOf(OidbGroupTopBannerUiField.highText, WireType.lengthDelimited):
        ui.highText = reader.string();
        break;
      case tagOf(OidbGroupTopBannerUiField.accessoryType, WireType.varint):
        ui.accessoryType = reader.uint32();
        break;
      case tagOf(OidbGroupTopBannerUiField.iconColor, WireType.varint):
        ui.iconColor = reader.uint32();
        break;
      case tagOf(OidbGroupTopBannerUiField.needTranslation, WireType.varint):
        ui.needTranslation = reader.bool();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return ui;
}

export function decodeOidbGroupTopBannerJumpInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbGroupTopBannerJumpInfo {
  const reader = new ProtoReader(data, offset, end);
  const jump: OidbGroupTopBannerJumpInfo = { jumpType: null, jumpUrl: null, jumpParam: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbGroupTopBannerJumpInfoField.jumpType, WireType.varint):
        jump.jumpType = reader.uint32();
        break;
      case tagOf(OidbGroupTopBannerJumpInfoField.jumpUrl, WireType.lengthDelimited):
        jump.jumpUrl = reader.string();
        break;
      case tagOf(OidbGroupTopBannerJumpInfoField.jumpParam, WireType.lengthDelimited):
        jump.jumpParam = reader.bytes();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return jump;
}

export function decodeOidbGroupTodoLegacyBanner(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbGroupTodoLegacyBanner {
  const reader = new ProtoReader(data, offset, end);
  const banner: OidbGroupTodoLegacyBanner = {
    redText: null,
    text: null,
    url: null,
    isExposure: null,
    isComplete: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbGroupTodoLegacyBannerField.redText, WireType.lengthDelimited):
        banner.redText = reader.string();
        break;
      case tagOf(OidbGroupTodoLegacyBannerField.text, WireType.lengthDelimited):
        banner.text = reader.string();
        break;
      case tagOf(OidbGroupTodoLegacyBannerField.url, WireType.lengthDelimited):
        banner.url = reader.string();
        break;
      case tagOf(OidbGroupTodoLegacyBannerField.isExposure, WireType.varint):
        banner.isExposure = reader.bool();
        break;
      case tagOf(OidbGroupTodoLegacyBannerField.isComplete, WireType.varint):
        banner.isComplete = reader.bool();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return banner;
}

export function decodeOidbGroupTopBannerPriority(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbGroupTopBannerPriority {
  const reader = new ProtoReader(data, offset, end);
  const priority: OidbGroupTopBannerPriority = { categoryType: null, priority: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbGroupTopBannerPriorityField.categoryType, WireType.varint):
        priority.categoryType = reader.uint32();
        break;
      case tagOf(OidbGroupTopBannerPriorityField.priority, WireType.varint):
        priority.priority = reader.int32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return priority;
}

export function decodeOidbGroupTopBannerCommon(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbGroupTopBannerCommon {
  const reader = new ProtoReader(data, offset, end);
  const common: OidbGroupTopBannerCommon = {
    ui: null,
    jumpInfo: null,
    createTime: null,
    updateTime: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbGroupTopBannerCommonField.ui, WireType.lengthDelimited):
        common.ui = reader.message(decodeOidbGroupTopBannerUi);
        break;
      case tagOf(OidbGroupTopBannerCommonField.jumpInfo, WireType.lengthDelimited):
        common.jumpInfo = reader.message(decodeOidbGroupTopBannerJumpInfo);
        break;
      case tagOf(OidbGroupTopBannerCommonField.createTime, WireType.varint):
        common.createTime = reader.uint64();
        break;
      case tagOf(OidbGroupTopBannerCommonField.updateTime, WireType.varint):
        common.updateTime = reader.uint64();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return common;
}

export function decodeOidbOnlineBanner(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbOnlineBanner {
  const reader = new ProtoReader(data, offset, end);
  const banner: OidbOnlineBanner = {
    bizType: null,
    bannerType: null,
    msgId: null,
    isDisappear: null,
    expireTime: null,
    todoBanner: null,
    commonBanner: null,
    bannerPriority: null,
    bizId: null,
    priority: null,
    leftShowTimes: null,
    supportMultiBanners: null,
    supportLongPress: null,
    noNeedReportShow: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbOnlineBannerField.bizType, WireType.varint):
        banner.bizType = reader.uint32();
        break;
      case tagOf(OidbOnlineBannerField.bannerType, WireType.varint):
        banner.bannerType = reader.uint32();
        break;
      case tagOf(OidbOnlineBannerField.msgId, WireType.lengthDelimited):
        banner.msgId = reader.bytes();
        break;
      case tagOf(OidbOnlineBannerField.isDisappear, WireType.varint):
        banner.isDisappear = reader.bool();
        break;
      case tagOf(OidbOnlineBannerField.expireTime, WireType.varint):
        banner.expireTime = reader.uint64();
        break;
      case tagOf(OidbOnlineBannerField.todoBanner, WireType.lengthDelimited):
        banner.todoBanner = reader.message(decodeOidbGroupTodoLegacyBanner);
        break;
      case tagOf(OidbOnlineBannerField.commonBanner, WireType.lengthDelimited):
        banner.commonBanner = reader.message(decodeOidbGroupTopBannerCommon);
        break;
      case tagOf(OidbOnlineBannerField.bannerPriority, WireType.lengthDelimited):
        banner.bannerPriority = reader.message(decodeOidbGroupTopBannerPriority);
        break;
      case tagOf(OidbOnlineBannerField.bizId, WireType.varint):
        banner.bizId = reader.int32();
        break;
      case tagOf(OidbOnlineBannerField.priority, WireType.varint):
        banner.priority = reader.int32();
        break;
      case tagOf(OidbOnlineBannerField.leftShowTimes, WireType.varint):
        banner.leftShowTimes = reader.int32();
        break;
      case tagOf(OidbOnlineBannerField.supportMultiBanners, WireType.varint):
        banner.supportMultiBanners = reader.bool();
        break;
      case tagOf(OidbOnlineBannerField.supportLongPress, WireType.varint):
        banner.supportLongPress = reader.bool();
        break;
      case tagOf(OIDB_ONLINE_BANNER_NO_NEED_REPORT_SHOW, WireType.varint):
        banner.noNeedReportShow = reader.bool();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return banner;
}

export function decodeOidbQueryGroupTopBannersResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbQueryGroupTopBannersResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: OidbQueryGroupTopBannersResp = { banners: [], newSeq: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(OidbQueryGroupTopBannersRespField.banners, WireType.lengthDelimited):
        resp.banners.push(reader.message(decodeOidbOnlineBanner));
        break;
      case tagOf(OidbQueryGroupTopBannersRespField.newSeq, WireType.varint):
        resp.newSeq = reader.uint64();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

/** `^([1-9]\d*)_(-?\d+)$` (reference :80112) — sequence may not lead with 0. */
const SOURCE_ID_PATTERN = /^([1-9]\d*)_(-?\d+)$/;

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function decodeUtf8(bytes: Uint8Array, description: string): string {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    throw new Error(`invalid group todo ${description}`);
  }
}

function parseSafeInteger(value: unknown, description: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`invalid group todo ${description}`);
  }
  return value;
}

export interface GroupTodoSourceIdentity {
  sourceId: string;
  sequence: number;
  random: number;
}

export function parseSourceIdentity(bytes: Uint8Array | null): GroupTodoSourceIdentity {
  if (!bytes || bytes.length === 0) throw new Error("invalid group todo message identity");
  const sourceId = decodeUtf8(bytes, "message identity");
  const match = SOURCE_ID_PATTERN.exec(sourceId);
  if (!match) throw new Error("invalid group todo message identity");
  const sequence = Number(match[1]);
  const random = Number(match[2]);
  if (!Number.isSafeInteger(sequence) || sequence <= 0 || !Number.isSafeInteger(random)) {
    throw new Error("invalid group todo message identity");
  }
  return { sourceId, sequence, random };
}

export interface GroupTodoJumpIdentity {
  sequence: number;
  random: number;
}

/** `null` for an absent `jumpParam`; a throw for a present-but-broken one. */
export function parseJumpIdentity(bytes: Uint8Array | null): GroupTodoJumpIdentity | null {
  if (!bytes || bytes.length === 0) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeUtf8(bytes, "jump identity"));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("invalid group todo")) throw error;
    throw new Error("invalid group todo jump identity");
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("invalid group todo jump identity");
  }
  const record = decoded as Record<string, unknown>;
  const sequence = parseSafeInteger(record.seq, "jump identity");
  const random = parseSafeInteger(record.random, "jump identity");
  if (sequence <= 0) throw new Error("invalid group todo jump identity");
  return { sequence, random };
}

/** Absent → 0 (not null); a negative or non-integer → throw. */
export function parseTimestamp(value: bigint | number | null, description: string): number {
  if (value === null || value === undefined) return 0;
  const timestamp = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error(`invalid group todo ${description}`);
  }
  return timestamp;
}

export interface GroupTodoEntry {
  sourceId: string;
  sequence: number;
  random: number;
  text: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * One banner → one todo, with the two-encoding identity cross-check.
 *
 * The reference's `parseBanner`. Order matters: the identity is parsed (and can
 * throw) before the text is chosen, so a malformed `msgId` fails even when the
 * banner would otherwise be dropped by the `isDisappear` filter upstream.
 */
export function parseBanner(banner: OidbOnlineBanner): GroupTodoEntry {
  const source = parseSourceIdentity(banner.msgId);
  const jump = parseJumpIdentity(banner.commonBanner?.jumpInfo?.jumpParam ?? null);
  if (jump && (jump.sequence !== source.sequence || jump.random !== source.random)) {
    throw new Error("group todo message identity mismatch");
  }
  return {
    sourceId: source.sourceId,
    sequence: source.sequence,
    random: source.random,
    text: banner.commonBanner?.ui?.text ?? banner.todoBanner?.text ?? "",
    createdAt: parseTimestamp(banner.commonBanner?.createTime ?? null, "create time"),
    updatedAt: parseTimestamp(banner.commonBanner?.updateTime ?? null, "update time"),
  };
}

export interface GetGroupTodoListParams {
  groupId: number;
}

export const GetGroupTodoList: OidbSpec<
  GetGroupTodoListParams,
  OidbQueryGroupTopBannersReq,
  OidbQueryGroupTopBannersResp,
  GroupTodoEntry[]
> = {
  command: GROUP_TODO_LIST_COMMAND,
  subCommand: GROUP_TODO_LIST_SUB_COMMAND,
  serialize: (params) => {
    // `!Number.isSafeInteger(p.groupId) || p.groupId <= 0` — the reference checks
    // BEFORE converting, so a non-integer group id throws rather than truncating.
    if (!Number.isSafeInteger(params.groupId) || params.groupId <= 0) {
      throw new Error("invalid group id");
    }
    return { groupId: BigInt(params.groupId), bannerFlag: TODO_BANNER_FLAG };
  },
  encodeBody: encodeOidbQueryGroupTopBannersReq,
  decodeBody: decodeOidbQueryGroupTopBannersResp,
  // `isDisappear !== true` — an ABSENT flag does NOT drop the banner; only an
  // explicit `true` does. `< 0`/`undefined` both survive.
  deserialize: (body) =>
    (body.banners ?? [])
      .filter((banner) => banner.isDisappear !== true)
      .map((banner) => parseBanner(banner)),
};

// ---------------------------------------------------------------------------
// The empty response message
// ---------------------------------------------------------------------------

export interface OidbEmptyLike {
  readonly __empty?: never;
}

export function decodeOidbEmptyLike(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): OidbEmptyLike {
  const reader = new ProtoReader(data, offset, end);
  const unknown = new UnknownFieldCollector();
  while (reader.next()) reader.skip(unknown);
  return {};
}