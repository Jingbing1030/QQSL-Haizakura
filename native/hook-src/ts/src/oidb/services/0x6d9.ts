// OidbSvcTrpcTcp.0x6d9_0 / _4 — group file transfer (转存) and publish.
//
// ---------------------------------------------------------------------------
// The file-tab trio, part 3 of 3
// ---------------------------------------------------------------------------
//   0x6d7_*  folder tree mutations
//   0x6d8_*  listing + quota
//   0x6d9_*  file transfer / publish      <- this file
//
// `_0` (`TransGroupFile`) moves a file into the group's own storage; `_4`
// (`PublishGroupFile`) publishes a file that is already uploaded.  Both wrap the
// same two-part body message and both answer with either a ret-friendly message
// or an empty one.
//
// ---------------------------------------------------------------------------
// Field numbers (read out of the reference)
// ---------------------------------------------------------------------------
//   OidbGroupSendFileReq             reference/index.mjs:282686 / 282711
//     1 transFile  message OidbGroupTransFileReq
//     5 body       message OidbGroupSendFileBody     <-- field 5, not 2
//
//   OidbGroupTransFileReq           reference/index.mjs:282747 .. 282821
//     1 groupUin  uint64   <-- uint64 here (0x6d7/0x6d8 use uint32 for it)
//     2 appId     uint32   hard-coded 7
//     3 busId     uint32   hard-coded 102
//     4 fileId    string
//
//   OidbGroupSendFileBody           reference/index.mjs:282876 .. 282925
//     1 groupUin  uint32   <-- the SAME group id, again, as a uint32
//     2 type      uint32   hard-coded 2
//     3 info      message OidbGroupSendFileInfo
//
//   OidbGroupSendFileInfo           reference/index.mjs:282989 .. 283069
//     1 busiType  uint32   hard-coded 102
//     2 fileId    string
//     3 field3    uint32   <- _4 puts a RANDOM number here; _0 leaves it 0
//     4 field4    string   <- _0 sends "" (so dropped); _4 sends ""
//     5 field5    bool     <- _4 sends true; _0 leaves it undefined
//
// The group id appears **twice in one request**, and in two different integer
// widths: field 1 of `transFile` is uint64 while field 1 of `body` is uint32.
// Sending only one of them produces a request the server rejects, and swapping
// the widths silently truncates large group numbers on one side.
//
// `field5` is a *bool*, so the reference's `=== true` presence rule applies: on
// `_0` it is left undefined and therefore never written, while `_4` sets it to
// true and it appears as a 2-byte field.  Setting it to `false` instead of
// `undefined` would be indistinguishable on the wire (both omitted) — which is
// fine here but was NOT fine in 0x89a's settings messages, where the value
// `0` carried meaning.
//
// ---------------------------------------------------------------------------
// The random field3
// ---------------------------------------------------------------------------
// `_4`'s serialize writes `Math.floor(Math.random() * 2147483647) >>> 0` into
// field 3 (reference/index.mjs:277353).  It is not a nonce the client can
// compute; it is a "freshness" marker the server uses to dedupe publishes.  The
// spec below therefore accepts a seeded value for tests and rolls its own
// otherwise, rather than reaching for `Math.random` from inside the encoder
// (which would make every test vector irreproducible).
//
// ---------------------------------------------------------------------------
// uinForm: none
// ---------------------------------------------------------------------------
// Neither `_0` nor `_4` sets `uinForm` (reference/index.mjs:283541 / 277347), so
// the envelope's `reserved` is 0 — unlike all three 0x6d7 sub-commands
// (`uinForm: true`) and unlike 0x6d8_1.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";
// The retcode check keeps the reference's exact wording; see 0x6d7.ts for why it
// is not the same helper 0x6d6.ts exports.
import { checkRetCodeZero } from "./0x6d7.js";
// The empty-body decoder is the same `OidbEmpty` the 0x89a family uses
// (reference/index.mjs:211364 and the several copies beside it).  Imported, not
// re-declared: three copies of "walk the bytes and return {}" is three places
// for the byte-walking to drift.
import { type OidbEmpty, decodeOidbEmpty } from "./0x89a-0.js";

/** 1753 = 0x6d9. */
export const GROUP_FILE_SEND_COMMAND = 0x6d9;

/** 0 = transfer, 4 = publish. */
export const GROUP_FILE_SEND_SUB_COMMAND = { trans: 0, publish: 4 } as const;

/** app id for both sub-commands (reference/index.mjs:282748). */
export const GROUP_FILE_SEND_APP_ID = 7;

/** busId for both sub-commands (reference/index.mjs:282772). */
export const GROUP_FILE_SEND_BUS_ID = 102;

/** The upper bound of the random freshness marker (reference/index.mjs:277353). */
export const PUBLISH_RANDOM_MAX = 2147483647;

export const GroupSendFileReqField = { transFile: 1, body: 5 } as const;

export const GroupTransFileReqField = { groupUin: 1, appId: 2, busId: 3, fileId: 4 } as const;

export const GroupSendFileBodyField = { groupUin: 1, type: 2, info: 3 } as const;

export const GroupSendFileInfoField = {
  busiType: 1,
  fileId: 2,
  field3: 3,
  field4: 4,
  field5: 5,
} as const;

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface GroupTransFileReq {
  /** uint64 — this is the copy that may exceed 32 bits. */
  groupUin: bigint;
  appId: number;
  busId: number;
  fileId: string;
}

export interface GroupSendFileInfo {
  busiType: number;
  fileId: string;
  field3: number;
  field4?: string | undefined;
  field5?: boolean | undefined;
}

export interface GroupSendFileBody {
  /** uint32 — the second copy of the same group id. */
  groupUin: number;
  type: number;
  info: GroupSendFileInfo;
}

export interface GroupSendFileReq {
  transFile?: GroupTransFileReq | undefined;
  body?: GroupSendFileBody | undefined;
}

export interface GroupSendFileTransReq {
  transFile: GroupTransFileReq;
}

export interface GroupSendFileBodyReq {
  body: GroupSendFileBody;
}

export function encodeGroupTransFileReq(body: GroupTransFileReq): Uint8Array {
  return new ProtoWriter()
    .uint64(GroupTransFileReqField.groupUin, body.groupUin)
    .uint32(GroupTransFileReqField.appId, body.appId)
    .uint32(GroupTransFileReqField.busId, body.busId)
    .string(GroupTransFileReqField.fileId, body.fileId)
    .finish();
}

export function encodeGroupSendFileInfo(body: GroupSendFileInfo): Uint8Array {
  return new ProtoWriter()
    .uint32(GroupSendFileInfoField.busiType, body.busiType)
    .string(GroupSendFileInfoField.fileId, body.fileId)
    .uint32(GroupSendFileInfoField.field3, body.field3)
    .string(GroupSendFileInfoField.field4, body.field4)
    .bool(GroupSendFileInfoField.field5, body.field5)
    .finish();
}

export function encodeGroupSendFileBody(body: GroupSendFileBody): Uint8Array {
  return new ProtoWriter()
    .uint32(GroupSendFileBodyField.groupUin, body.groupUin)
    .uint32(GroupSendFileBodyField.type, body.type)
    .message(GroupSendFileBodyField.info, encodeGroupSendFileInfo(body.info))
    .finish();
}

export function encodeGroupSendFileReq(body: GroupSendFileReq): Uint8Array {
  return new ProtoWriter()
    .message(GroupSendFileReqField.transFile, body.transFile ? encodeGroupTransFileReq(body.transFile) : null)
    .message(GroupSendFileReqField.body, body.body ? encodeGroupSendFileBody(body.body) : null)
    .finish();
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------
//
// `_0` answers with `OidbGroupSendFileResp{1 transFile}`, `_4` answers with an
// empty message (`OidbEmpty`).  The trans reply's `retCode` is an **int32**
// (`| 0`), not a uint32: the server sends negative codes for some transfer
// failures, and reading them as uint32 turns -1 into 4294967295.

export const GroupSendFileRespField = { transFile: 1 } as const;

export const GroupTransFileRespField = {
  retCode: 1,
  retMsg: 2,
  clientWording: 3,
  saveBusId: 4,
  saveFilePath: 5,
} as const;

export interface GroupTransFileResp {
  /** int32: negative values are real failure codes. */
  retCode: number;
  retMsg: string;
  clientWording: string;
  saveBusId: number;
  saveFilePath: string;
}

export interface GroupSendFileResp {
  transFile: GroupTransFileResp | null;
}

export function decodeGroupTransFileResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupTransFileResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: GroupTransFileResp = {
    retCode: 0,
    retMsg: "",
    clientWording: "",
    saveBusId: 0,
    saveFilePath: "",
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupTransFileRespField.retCode, WireType.varint):
        resp.retCode = reader.int32();
        break;
      case tagOf(GroupTransFileRespField.retMsg, WireType.lengthDelimited):
        resp.retMsg = reader.string();
        break;
      case tagOf(GroupTransFileRespField.clientWording, WireType.lengthDelimited):
        resp.clientWording = reader.string();
        break;
      case tagOf(GroupTransFileRespField.saveBusId, WireType.varint):
        resp.saveBusId = reader.uint32();
        break;
      case tagOf(GroupTransFileRespField.saveFilePath, WireType.lengthDelimited):
        resp.saveFilePath = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export function decodeGroupSendFileResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupSendFileResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: GroupSendFileResp = { transFile: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupSendFileRespField.transFile, WireType.lengthDelimited):
        resp.transFile = reader.message(decodeGroupTransFileResp);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export interface TransGroupFileParams {
  groupId: number | bigint;
  fileId: string;
}

export interface TransGroupFileResult {
  saveBusId: number;
  saveFilePath: string;
}

/** `trans_group_file` — move an existing file into the group's storage. */
export const TransGroupFile: OidbSpec<
  TransGroupFileParams,
  GroupSendFileTransReq,
  GroupSendFileResp,
  TransGroupFileResult
> = {
  command: GROUP_FILE_SEND_COMMAND,
  subCommand: GROUP_FILE_SEND_SUB_COMMAND.trans,
  serialize: (params) => {
    const groupUin = BigInt(params.groupId);
    return {
      transFile: {
        groupUin,
        appId: GROUP_FILE_SEND_APP_ID,
        busId: GROUP_FILE_SEND_BUS_ID,
        fileId: params.fileId,
      },
    };
  },
  encodeBody: encodeGroupSendFileReq,
  decodeBody: decodeGroupSendFileResp,
  deserialize: (body) => {
    const result = body.transFile;
    if (!result) throw new Error("group file transfer response missing");
    checkRetCodeZero("group file transfer", result.retCode, result.retMsg, result.clientWording);
    return { saveBusId: result.saveBusId ?? 0, saveFilePath: result.saveFilePath ?? "" };
  },
};

export interface PublishGroupFileParams {
  groupId: number | bigint;
  fileId: string;
  /**
   * The freshness marker for field 3.  Supplied by tests to keep vectors
   * reproducible; when absent a random value in `[0, PUBLISH_RANDOM_MAX]` is
   * used, exactly as the reference does.
   */
  random?: number | undefined;
}

/**
 * `publish_group_file`.
 *
 * `random` is a test seam, not an action parameter: the reference rolls
 * `Math.floor(Math.random() * 2147483647) >>> 0` inline.  Note the `>>> 0` — it
 * keeps the value from ever encoding as a negative int32, so a plain
 * `Math.floor(...)` result is already non-negative and the shift is a
 * belt-and-braces no-op.  Reproducing it is cheap and keeps the door shut.
 */
export const PublishGroupFile: OidbSpec<
  PublishGroupFileParams,
  GroupSendFileBodyReq,
  OidbEmpty,
  void
> = {
  command: GROUP_FILE_SEND_COMMAND,
  subCommand: GROUP_FILE_SEND_SUB_COMMAND.publish,
  serialize: (params) => {
    const fresh =
      params.random === undefined
        ? Math.floor(Math.random() * PUBLISH_RANDOM_MAX) >>> 0
        : params.random >>> 0;
    return {
      body: {
        groupUin: Number(params.groupId),
        type: 2,
        info: {
          busiType: GROUP_FILE_SEND_BUS_ID,
          fileId: params.fileId,
          field3: fresh,
          field4: "",
          field5: true,
        },
      },
    };
  },
  encodeBody: encodeGroupSendFileReq,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};