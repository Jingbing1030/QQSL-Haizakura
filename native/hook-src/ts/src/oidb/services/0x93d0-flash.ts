// Flash transfer — the WeChat-style "flash file" (`闪传`) family.
//
// ---------------------------------------------------------------------------
// Why one file
// ---------------------------------------------------------------------------
// Thirteen commands, thirteen separate reference regions
// (`../protocol/src/oidb-services/flash-transfer/*.ts`), and each region carries its
// own `$N` copy of the shared messages. They share a *protocol*, not code: the
// `head/config` triple, the `filesetWrap`, and the `FlashApplyFileInfo` block recur
// across six of them with the same field numbers. Keeping them together is what
// makes that visible; splitting them into thirteen files would hide the one fact
// worth knowing.
//
// ---------------------------------------------------------------------------
// Command map
// ---------------------------------------------------------------------------
//   0x93cf (37839) sub 1   ApplyFileset        create a fileset, get its upload url
//   0x93d0 (37840) sub 1   CommitFile          register the finished files
//   0x93d1 (37841) sub 1   SetFilesetStatus    publish / recall
//   0x93d2 (37842) sub 1   ListFilesets
//   0x93d3 (37843) sub 1   GetFilesetDetail
//   0x93d4 (37844) sub 1   GetDownloadUrl
//   0x93d7 (37847) sub 1   SendFlashMsg        post the fileset into a chat
//   0x93db (37851) sub 1   CompleteFileset
//   0x9407 (37895) sub 1   DeleteFlashFile
//   0x9427 (37927) sub 0   RenameFlashFile     ⚠️ sub **0**, and `uinForm: true`
//   0x12a9 (4777)  sub 100 PrepareUpload       ⚠️ same command as ApplyUpload
//   0x12a9 (4777)  sub 103 ApplyUpload         ⚠️ and same as GetFlashDownload
//   0x12a9 (4777)  sub 200 GetFlashDownload    (already ported in 0x12a9.ts)
//
// **0x12a9 carries three different sub-commands and three different schemas**, so
// `command` alone identifies nothing here. `RenameFlashFile` is the odd one in the
// other direction: sub-command 0, which the envelope can express (field 2 is written
// with an explicit-zero guard) but which is easy to get wrong by assuming "sub 1
// everywhere" — as ten of the twelve here do.
//
// ---------------------------------------------------------------------------
// Field-number surprises (all verified against the `__write_*` tag bytes)
// ---------------------------------------------------------------------------
// 1. **`FlashApplyFilesetReq.fileInfo` is field 2, but `fileInfo`'s own first field
//    is ALSO 2** (`fileName`), because `origName`/`fileName` are at 3/2 and 1 is
//    unused. Two different messages, two different meanings for "2".
// 2. **`FlashCommitFileInfo` skips 13–23**: `field12` then `field24`.
// 3. **`FlashDownloadEntry` starts at 2** — field 1 is unused, `fileInfo` is at 3.
// 4. **`FlashDownloadFileInfo` jumps 2→5→6→7→8→9→11→13→14**: no 1, no 3, no 4, no
//    10, no 12. Reading it as "the nth declared field" gives garbage.
// 5. **`FlashApplyUploadReq.payload` is at field 12**, while the almost-identical
//    `FlashPrepareUploadReq.payload` is at field 2. Same shape, different number.
// 6. **`FlashApplyHeadConfig` lives at 101/102/103/200** — hundred-based, like the
//    NTV2 `SceneInfo` and the private-file `OidbPrivateFileDownloadReq`.
// 7. **`FlashApplyFilesetWrap.field8`, `FlashPreparePayloadF6F1.field2` and
//    `FlashApplyPayloadField3.field4` are all *present-if-not-null, value-0-still-
//    written* empty messages** (the reference calls them `FlashEmpty$N`). They are
//    the `{}` placeholders in `serialize`, and they DO reach the wire as `xx 00`.
//    A port that skips empty messages produces shorter requests the server accepts
//    and then mis-parses — silent, not loud.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

// ---------------------------------------------------------------------------
// Command numbers
// ---------------------------------------------------------------------------

export const FLASH_APPLY_FILESET_COMMAND = 0x93cf;
export const FLASH_COMMIT_FILE_COMMAND = 0x93d0;
export const FLASH_SET_STATUS_COMMAND = 0x93d1;
export const FLASH_LIST_FILESETS_COMMAND = 0x93d2;
export const FLASH_GET_DETAIL_COMMAND = 0x93d3;
export const FLASH_GET_DOWNLOAD_URL_COMMAND = 0x93d4;
export const FLASH_SEND_COMMAND = 0x93d7;
export const FLASH_COMPLETE_FILESET_COMMAND = 0x93db;
export const FLASH_DELETE_FILE_COMMAND = 0x9407;
export const FLASH_RENAME_FILE_COMMAND = 0x9427;

/** 0x12a9 carries three sub-commands; `GetFlashDownload` (200) lives in 0x12a9.ts. */
export const FLASH_UPLOAD_COMMAND = 0x12a9;
export const FLASH_PREPARE_UPLOAD_SUB_COMMAND = 100;
export const FLASH_APPLY_UPLOAD_SUB_COMMAND = 103;

/**
 * `seqCounter` (reference/index.mjs:104744) and `seqCounter$1` (:101377).
 *
 * ⚠️ **Two separate counters, seeded 200 and 100.** They are not one counter and the
 * seeds are not the same: prepare-upload starts at 200, apply-upload at 100. Sharing
 * one would put wrong sequence numbers on a transfer the server orders by them.
 * `GetFlashDownload` has a *third* counter (`$2`, seeded 300) in `0x12a9.ts`.
 */
let prepareSequence = 200;
let applySequence = 100;

export function peekPrepareSequence(): number {
  return prepareSequence;
}

export function peekApplySequence(): number {
  return applySequence;
}

/** Test-only. Production must never reset these — they are monotonic. */
export function resetFlashUploadSequences(prepare = 200, apply = 100): void {
  prepareSequence = prepare;
  applySequence = apply;
}

// ---------------------------------------------------------------------------
// Shared request pieces
// ---------------------------------------------------------------------------

export const FlashApplyHeadField = { sub: 1, config: 2, field3: 3 } as const;
export const FlashApplyHeadSubField = { seq: 1, sub: 2 } as const;
export const FlashApplyHeadConfigField = {
  field101: 101,
  field102: 102,
  field103: 103,
  field200: 200,
} as const;
export const FlashApplyFlag2Field = { field1: 1 } as const;
export const FlashApplyFilesetWrapField = {
  filesetUuid: 1,
  uploadKey: 2,
  fileUuid: 3,
  field4: 4,
  field5: 5,
  field6: 6,
  field7: 7,
  field8: 8,
  field9: 9,
  field10: 10,
  field11: 11,
  field12: 12,
  field13: 13,
  field14: 14,
} as const;
export const FlashApplyFileInfoField = {
  fileSize: 1,
  md5: 2,
  sha1: 3,
  fileName: 4,
  field5: 5,
  field6: 6,
  field7: 7,
  field8: 8,
  field9: 9,
} as const;
export const FlashApplyFileInfo5Field = { field1: 1, field2: 2, field3: 3, field4: 4 } as const;

export interface FlashApplyHeadSub {
  seq: number;
  sub: number;
}

export interface FlashApplyHeadConfig {
  field101: number;
  field102: number;
  field103: number;
  field200: number;
}

export interface FlashApplyHead {
  sub: FlashApplyHeadSub;
  config: FlashApplyHeadConfig;
  field3: { field1: number };
}

export interface FlashApplyFilesetWrap {
  filesetUuid: string;
  uploadKey: string;
  fileUuid: string;
  field4: number;
  field5: number;
  field6: number;
  field7: number;
  field8: Record<string, never>;
  field9: number;
  field10: number;
  field11: number;
  field12: number;
  field13: number;
  field14: number;
}

export interface FlashApplyFileInfo5 {
  field1: number;
  field2: number;
  field3: number;
  field4: number;
}

export interface FlashApplyFileInfo {
  fileSize: number;
  md5: string;
  sha1: string;
  fileName: string;
  field5: FlashApplyFileInfo5;
  field6: number;
  field7: number;
  field8: number;
  field9: number;
}

export function encodeFlashApplyHeadSub(sub: FlashApplyHeadSub): Uint8Array {
  return new ProtoWriter()
    .uint32(FlashApplyHeadSubField.seq, sub.seq)
    .uint32(FlashApplyHeadSubField.sub, sub.sub)
    .finish();
}

export function encodeFlashApplyHeadConfig(config: FlashApplyHeadConfig): Uint8Array {
  return new ProtoWriter()
    .uint32(FlashApplyHeadConfigField.field101, config.field101)
    .uint32(FlashApplyHeadConfigField.field102, config.field102)
    .uint32(FlashApplyHeadConfigField.field103, config.field103)
    .uint32(FlashApplyHeadConfigField.field200, config.field200)
    .finish();
}

export function encodeFlashApplyHead(head: FlashApplyHead): Uint8Array {
  return new ProtoWriter()
    .message(FlashApplyHeadField.sub, encodeFlashApplyHeadSub(head.sub))
    .message(FlashApplyHeadField.config, encodeFlashApplyHeadConfig(head.config))
    .message(
      FlashApplyHeadField.field3,
      new ProtoWriter().uint32(FlashApplyFlag2Field.field1, head.field3.field1).finish(),
    )
    .finish();
}

/** See `encodeFlashApplyFileInfo5`: fourteen fields, all `!= null`, zeros included. */
export function encodeFlashApplyFilesetWrap(wrap: FlashApplyFilesetWrap): Uint8Array {
  return new ProtoWriter()
    .stringPresent(FlashApplyFilesetWrapField.filesetUuid, wrap.filesetUuid)
    .stringPresent(FlashApplyFilesetWrapField.uploadKey, wrap.uploadKey)
    .stringPresent(FlashApplyFilesetWrapField.fileUuid, wrap.fileUuid)
    .uint32Present(FlashApplyFilesetWrapField.field4, wrap.field4)
    .uint32Present(FlashApplyFilesetWrapField.field5, wrap.field5)
    .uint32Present(FlashApplyFilesetWrapField.field6, wrap.field6)
    .uint32Present(FlashApplyFilesetWrapField.field7, wrap.field7)
    // Empty message: presence is `!= null`, so `{}` still emits `42 00`.
    .message(FlashApplyFilesetWrapField.field8, new Uint8Array(0))
    .uint32Present(FlashApplyFilesetWrapField.field9, wrap.field9)
    .uint32Present(FlashApplyFilesetWrapField.field10, wrap.field10)
    .uint32Present(FlashApplyFilesetWrapField.field11, wrap.field11)
    .uint32Present(FlashApplyFilesetWrapField.field12, wrap.field12)
    .uint32Present(FlashApplyFilesetWrapField.field13, wrap.field13)
    .uint32Present(FlashApplyFilesetWrapField.field14, wrap.field14)
    .finish();
}

/**
 * ⚠️ **Every field here and in `encodeFlashApplyFileInfo` uses the bare `!= null`
 * guard, not `!== 0` / `!== ""`.** So an explicit `0` and an explicit `""` are both
 * WRITTEN — `0800 1000 1800 2000` for the four zeros, `1200` for an empty md5. The
 * reference's `serialize` passes those zeros deliberately (they are "no thumbnail"
 * flags, not absent values).
 *
 * Using `.uint32`/`.string` would drop them and produce a request that is 25 bytes
 * shorter and silently means something else: the server reads "field absent" as
 * "unspecified" rather than "zero", which for `field1` is the jpg/other
 * discriminator. This is the single most important guard rule in the flash family.
 */
export function encodeFlashApplyFileInfo5(five: FlashApplyFileInfo5): Uint8Array {
  return new ProtoWriter()
    .uint32Present(FlashApplyFileInfo5Field.field1, five.field1)
    .uint32Present(FlashApplyFileInfo5Field.field2, five.field2)
    .uint32Present(FlashApplyFileInfo5Field.field3, five.field3)
    .uint32Present(FlashApplyFileInfo5Field.field4, five.field4)
    .finish();
}

/** See `encodeFlashApplyFileInfo5`: all nine fields are `!= null`, zeros included. */
export function encodeFlashApplyFileInfo(info: FlashApplyFileInfo): Uint8Array {
  return new ProtoWriter()
    .uint32Present(FlashApplyFileInfoField.fileSize, info.fileSize)
    .stringPresent(FlashApplyFileInfoField.md5, info.md5)
    .stringPresent(FlashApplyFileInfoField.sha1, info.sha1)
    .stringPresent(FlashApplyFileInfoField.fileName, info.fileName)
    .message(FlashApplyFileInfoField.field5, encodeFlashApplyFileInfo5(info.field5))
    .uint32Present(FlashApplyFileInfoField.field6, info.field6)
    .uint32Present(FlashApplyFileInfoField.field7, info.field7)
    .uint32Present(FlashApplyFileInfoField.field8, info.field8)
    .uint32Present(FlashApplyFileInfoField.field9, info.field9)
    .finish();
}

// ---------------------------------------------------------------------------
// ApplyFileset — 0x93cf_1
// ---------------------------------------------------------------------------

export const FlashApplyFilesetReqField = { field1: 1, fileInfo: 2, typeCode: 3, field12: 12 } as const;

export const FlashUploadFileInfoField = {
  fileName: 2,
  origName: 3,
  fileType: 4,
  fileSize: 5,
  uploader: 10,
  field16: 16,
  field20: 20,
  field21: 21,
} as const;

export const FlashUploaderField = { uin: 1, nickname: 2, uid: 3, field4: 4 } as const;

export interface FlashUploader {
  uin: string;
  nickname: string;
  uid: string;
  field4: Record<string, never>;
}

export interface FlashUploadFileInfo {
  fileName: string;
  origName: string;
  fileType: number;
  fileSize: bigint;
  uploader: FlashUploader;
  field16: number;
  field20: number;
  field21: number;
}

export interface FlashApplyFilesetReq {
  field1: number;
  fileInfo: FlashUploadFileInfo;
  typeCode: number;
  field12: number;
}

export function encodeFlashUploader(uploader: FlashUploader): Uint8Array {
  return new ProtoWriter()
    .string(FlashUploaderField.uin, uploader.uin)
    .string(FlashUploaderField.nickname, uploader.nickname)
    .string(FlashUploaderField.uid, uploader.uid)
    .message(FlashUploaderField.field4, new Uint8Array(0))
    .finish();
}

export function encodeFlashUploadFileInfo(info: FlashUploadFileInfo): Uint8Array {
  return new ProtoWriter()
    .string(FlashUploadFileInfoField.fileName, info.fileName)
    .string(FlashUploadFileInfoField.origName, info.origName)
    .uint32(FlashUploadFileInfoField.fileType, info.fileType)
    // uint64: guard is `!== 0n`, so a 0 file size is DROPPED (see `fileSize: 0`).
    .uint64(FlashUploadFileInfoField.fileSize, info.fileSize)
    .message(FlashUploadFileInfoField.uploader, encodeFlashUploader(info.uploader))
    .uint32(FlashUploadFileInfoField.field16, info.field16)
    .uint32(FlashUploadFileInfoField.field20, info.field20)
    .uint32(FlashUploadFileInfoField.field21, info.field21)
    .finish();
}

export function encodeFlashApplyFilesetReq(req: FlashApplyFilesetReq): Uint8Array {
  return new ProtoWriter()
    .uint32(FlashApplyFilesetReqField.field1, req.field1)
    .message(FlashApplyFilesetReqField.fileInfo, encodeFlashUploadFileInfo(req.fileInfo))
    .uint32(FlashApplyFilesetReqField.typeCode, req.typeCode)
    .uint32(FlashApplyFilesetReqField.field12, req.field12)
    .finish();
}

export const FlashApplyFilesetRespField = {
  filesetUuid: 1,
  uploadKey: 2,
  uploadUrl: 3,
  expire: 4,
  ttl: 5,
} as const;

export interface FlashApplyFilesetResp {
  filesetUuid: string | null;
  uploadKey: string | null;
  uploadUrl: string | null;
  expire: bigint | null;
  ttl: number | null;
}

export function decodeFlashApplyFilesetResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashApplyFilesetResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: FlashApplyFilesetResp = {
    filesetUuid: null,
    uploadKey: null,
    uploadUrl: null,
    expire: null,
    ttl: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashApplyFilesetRespField.filesetUuid, WireType.lengthDelimited):
        resp.filesetUuid = reader.string();
        break;
      case tagOf(FlashApplyFilesetRespField.uploadKey, WireType.lengthDelimited):
        resp.uploadKey = reader.string();
        break;
      case tagOf(FlashApplyFilesetRespField.uploadUrl, WireType.lengthDelimited):
        resp.uploadUrl = reader.string();
        break;
      case tagOf(FlashApplyFilesetRespField.expire, WireType.varint):
        resp.expire = reader.uint64();
        break;
      case tagOf(FlashApplyFilesetRespField.ttl, WireType.varint):
        resp.ttl = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export interface FlashApplyFilesetParams {
  fileName: string;
  origName: string;
  fileSize: number | bigint;
  typeCode: number;
  uploader: { uin: string; nickname: string; uid: string };
}

export const ApplyFileset: OidbSpec<
  FlashApplyFilesetParams,
  FlashApplyFilesetReq,
  FlashApplyFilesetResp,
  FlashApplyFilesetResp
> = {
  command: FLASH_APPLY_FILESET_COMMAND,
  subCommand: 1,
  serialize: (params) => ({
    field1: 1,
    fileInfo: {
      fileName: params.fileName,
      origName: params.origName,
      fileType: 1,
      fileSize: BigInt(params.fileSize),
      uploader: {
        uin: params.uploader.uin,
        nickname: params.uploader.nickname,
        uid: params.uploader.uid,
        field4: {},
      },
      field16: 1,
      field20: 0,
      field21: 0,
    },
    typeCode: params.typeCode,
    field12: 1,
  }),
  encodeBody: encodeFlashApplyFilesetReq,
  decodeBody: decodeFlashApplyFilesetResp,
  deserialize: (body) => body,
};

// ---------------------------------------------------------------------------
// CommitFile — 0x93d0_1
// ---------------------------------------------------------------------------

export const FlashCommitFileReqField = {
  field1: 1,
  filesetUuid: 2,
  uploadKey: 3,
  commitInfo: 4,
  field5: 5,
  field6: 6,
} as const;

export const FlashCommitFileInfoField = {
  filesetUuid: 1,
  fileUuid: 2,
  field3: 3,
  field4: 4,
  field5: 5,
  field6: 6,
  formatCode: 7,
  fileName: 8,
  origName: 9,
  field10: 10,
  fileSize: 11,
  field12: 12,
  field24: 24,
} as const;

export interface FlashCommitFileInfo {
  filesetUuid: string;
  fileUuid: string;
  field3: number;
  field4: Record<string, never>;
  field5: number;
  field6: number;
  formatCode: number;
  fileName: string;
  origName: string;
  field10: number;
  fileSize: bigint;
  field12: number;
  field24: Record<string, never>;
}

export interface FlashCommitFileReq {
  field1: number;
  filesetUuid: string;
  uploadKey: string;
  commitInfo: FlashCommitFileInfo[];
  field5: number;
  field6: number;
}

export function encodeFlashCommitFileInfo(info: FlashCommitFileInfo): Uint8Array {
  const writer = new ProtoWriter()
    .string(FlashCommitFileInfoField.filesetUuid, info.filesetUuid)
    .string(FlashCommitFileInfoField.fileUuid, info.fileUuid);
  // ⚠️ These four use the bare `!= null` guard, so an explicit 0 IS emitted. They
  // are written with `uint32Present` because `.uint32` would drop the zero.
  const withZeros = writer
    .uint32Present(FlashCommitFileInfoField.field3, info.field3)
    .message(FlashCommitFileInfoField.field4, new Uint8Array(0))
    .uint32Present(FlashCommitFileInfoField.field5, info.field5)
    .uint32Present(FlashCommitFileInfoField.field6, info.field6);
  return withZeros
    .uint32(FlashCommitFileInfoField.formatCode, info.formatCode)
    .string(FlashCommitFileInfoField.fileName, info.fileName)
    .string(FlashCommitFileInfoField.origName, info.origName)
    .uint32Present(FlashCommitFileInfoField.field10, info.field10)
    .uint64(FlashCommitFileInfoField.fileSize, info.fileSize)
    .uint32Present(FlashCommitFileInfoField.field12, info.field12)
    .message(FlashCommitFileInfoField.field24, new Uint8Array(0))
    .finish();
}

export function encodeFlashCommitFileReq(req: FlashCommitFileReq): Uint8Array {
  let writer = new ProtoWriter()
    .uint32(FlashCommitFileReqField.field1, req.field1)
    .string(FlashCommitFileReqField.filesetUuid, req.filesetUuid)
    .string(FlashCommitFileReqField.uploadKey, req.uploadKey);
  for (const info of req.commitInfo) {
    writer = writer.message(FlashCommitFileReqField.commitInfo, encodeFlashCommitFileInfo(info));
  }
  return writer
    .uint32(FlashCommitFileReqField.field5, req.field5)
    .uint32(FlashCommitFileReqField.field6, req.field6)
    .finish();
}

export const FlashCommitFileRespField = { field1: 1, filesetUuid: 2, uploadKey: 3 } as const;

export interface FlashCommitFileResp {
  field1: number | null;
  filesetUuid: string | null;
  uploadKey: string | null;
}

export function decodeFlashCommitFileResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashCommitFileResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: FlashCommitFileResp = { field1: null, filesetUuid: null, uploadKey: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashCommitFileRespField.field1, WireType.varint):
        resp.field1 = reader.uint32();
        break;
      case tagOf(FlashCommitFileRespField.filesetUuid, WireType.lengthDelimited):
        resp.filesetUuid = reader.string();
        break;
      case tagOf(FlashCommitFileRespField.uploadKey, WireType.lengthDelimited):
        resp.uploadKey = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export interface FlashCommitEntry {
  fileUuid: string;
  fileIndex: number;
  formatCode: number;
  fileName: string;
  origName: string;
  fileSize: number | bigint;
}

export interface FlashCommitFileParams {
  filesetUuid: string;
  entries: FlashCommitEntry[];
}

export const CommitFile: OidbSpec<
  FlashCommitFileParams,
  FlashCommitFileReq,
  FlashCommitFileResp,
  FlashCommitFileResp
> = {
  command: FLASH_COMMIT_FILE_COMMAND,
  subCommand: 1,
  serialize: (params) => ({
    field1: 1,
    filesetUuid: params.filesetUuid,
    // ⚠️ `uploadKey` is the fileset uuid, not a separate key the caller supplies.
    uploadKey: params.filesetUuid,
    commitInfo: params.entries.map((entry) => ({
      filesetUuid: params.filesetUuid,
      fileUuid: entry.fileUuid,
      field3: 0,
      field4: {},
      field5: 1,
      field6: entry.fileIndex,
      formatCode: entry.formatCode,
      fileName: entry.fileName,
      origName: entry.origName,
      field10: 0,
      fileSize: BigInt(entry.fileSize),
      field12: 0,
      field24: {},
    })),
    field5: 1,
    field6: 1,
  }),
  encodeBody: encodeFlashCommitFileReq,
  decodeBody: decodeFlashCommitFileResp,
  deserialize: (body) => body,
};

// ---------------------------------------------------------------------------
// The five "one-shot, empty result" commands
// ---------------------------------------------------------------------------
//
// DeleteFlashFile / RenameFlashFile / CompleteFileset / SetFilesetStatus,
// SendFlashMsg and ApplyUpload all have `deserialize = (_ctx, _body) => {}`.
//
// ⚠️ **That returns `undefined`, not `{}`.** `=> {}` is an arrow function with an
// *empty block body*; `=> ({})` would be a parenthesised object literal. The
// reference has the block form, so every one of these six commands returns
// `undefined`. It is a genuine reference quirk (presumably unintended: `=> ({})`
// is what the author meant), but it is observable, so it is reproduced exactly —
// returning `{}` here would quietly disagree with the reference on six commands.
//
// Their response decoders also differ: four are genuinely empty (no recognised
// fields), `FlashSendResp` decodes `echo`, and `FlashApplyUploadResp` decodes
// `head`/`rkeyWrap`. Decoding is kept faithful in all six; only the *result* is
// discarded, by the reference's own choice.

export const FlashDeleteFileReqField = { filesetUuid: 1, field2: 2, field3: 3 } as const;

export interface FlashDeleteFileReq {
  filesetUuid: string;
  field2: string;
  field3: number;
}

export function encodeFlashDeleteFileReq(req: FlashDeleteFileReq): Uint8Array {
  return new ProtoWriter()
    .string(FlashDeleteFileReqField.filesetUuid, req.filesetUuid)
    .string(FlashDeleteFileReqField.field2, req.field2)
    .uint32(FlashDeleteFileReqField.field3, req.field3)
    .finish();
}

export interface FlashDeleteFileParams {
  filesetUuid: string;
}

export const DeleteFlashFile: OidbSpec<FlashDeleteFileParams, FlashDeleteFileReq, OidbEmptyLike, undefined> = {
  command: FLASH_DELETE_FILE_COMMAND,
  subCommand: 1,
  serialize: (params) => ({ filesetUuid: params.filesetUuid, field2: "", field3: 7 }),
  encodeBody: encodeFlashDeleteFileReq,
  decodeBody: decodeOidbEmptyLike,
  deserialize: () => undefined,
};

export const FlashCompleteFilesetReqField = { filesetUuid: 1, field2: 2 } as const;

export interface FlashCompleteFilesetReq {
  filesetUuid: string;
  field2: string;
}

export function encodeFlashCompleteFilesetReq(req: FlashCompleteFilesetReq): Uint8Array {
  return new ProtoWriter()
    .string(FlashCompleteFilesetReqField.filesetUuid, req.filesetUuid)
    .string(FlashCompleteFilesetReqField.field2, req.field2)
    .finish();
}

export const CompleteFileset: OidbSpec<
  FlashDeleteFileParams,
  FlashCompleteFilesetReq,
  OidbEmptyLike,
  undefined
> = {
  command: FLASH_COMPLETE_FILESET_COMMAND,
  subCommand: 1,
  serialize: (params) => ({ filesetUuid: params.filesetUuid, field2: "" }),
  encodeBody: encodeFlashCompleteFilesetReq,
  decodeBody: decodeOidbEmptyLike,
  deserialize: () => undefined,
};

export const FlashSetStatusReqField = { filesetUuid: 1, status: 2 } as const;

export interface FlashSetStatusReq {
  filesetUuid: string;
  status: number;
}

export function encodeFlashSetStatusReq(req: FlashSetStatusReq): Uint8Array {
  return new ProtoWriter()
    .string(FlashSetStatusReqField.filesetUuid, req.filesetUuid)
    .uint32(FlashSetStatusReqField.status, req.status)
    .finish();
}

export interface FlashSetStatusParams {
  filesetUuid: string;
  status?: number | undefined;
}

/** `status ?? 6` — 6 is the reference's default, presumably "publish". */
export const FLASH_DEFAULT_STATUS = 6;

export const SetFilesetStatus: OidbSpec<
  FlashSetStatusParams,
  FlashSetStatusReq,
  OidbEmptyLike,
  undefined
> = {
  command: FLASH_SET_STATUS_COMMAND,
  subCommand: 1,
  serialize: (params) => ({
    filesetUuid: params.filesetUuid,
    status: params.status ?? FLASH_DEFAULT_STATUS,
  }),
  encodeBody: encodeFlashSetStatusReq,
  decodeBody: decodeOidbEmptyLike,
  deserialize: () => undefined,
};

// ---------------------------------------------------------------------------
// RenameFlashFile — 0x9427_0  (⚠️ sub-command 0, uinForm true)
// ---------------------------------------------------------------------------

export const FlashRenameFileReqField = { filesetUuid: 1, name: 2, flag: 3 } as const;
export const FlashRenameFileReqNameField = { newName: 1, displayName: 2 } as const;
export const FlashRenameFileReqFlagField = { field1: 1 } as const;

export interface FlashRenameFileReq {
  filesetUuid: string;
  name: { newName: string; displayName: string };
  flag: { field1: number };
}

export function encodeFlashRenameFileReq(req: FlashRenameFileReq): Uint8Array {
  return new ProtoWriter()
    .string(FlashRenameFileReqField.filesetUuid, req.filesetUuid)
    .message(
      FlashRenameFileReqField.name,
      new ProtoWriter()
        .string(FlashRenameFileReqNameField.newName, req.name.newName)
        .string(FlashRenameFileReqNameField.displayName, req.name.displayName)
        .finish(),
    )
    // `flag.field1 = 0` with the `!== 0` guard: message present, inner field dropped,
    // so the wire carries `1a 00`.
    .message(
      FlashRenameFileReqField.flag,
      new ProtoWriter().uint32(FlashRenameFileReqFlagField.field1, req.flag.field1).finish(),
    )
    .finish();
}

export interface FlashRenameFileParams {
  filesetUuid: string;
  newName: string;
}

export const RenameFlashFile: OidbSpec<
  FlashRenameFileParams,
  FlashRenameFileReq,
  OidbEmptyLike,
  undefined
> = {
  command: FLASH_RENAME_FILE_COMMAND,
  subCommand: 0,
  uinForm: true,
  serialize: (params) => ({
    filesetUuid: params.filesetUuid,
    // Both names get the SAME value: there is no separate display name.
    name: { newName: params.newName, displayName: params.newName },
    flag: { field1: 0 },
  }),
  encodeBody: encodeFlashRenameFileReq,
  decodeBody: decodeOidbEmptyLike,
  deserialize: () => undefined,
};

// ---------------------------------------------------------------------------
// SendFlashMsg — 0x93d7_1
// ---------------------------------------------------------------------------

export const FlashSendReqField = { target: 1, filesetUuid: 2 } as const;
export const FlashSendTargetField = { field1: 1, targetUid: 2, targetGroup: 3 } as const;
export const FlashSendTargetUidField = { targetUid: 1 } as const;
export const FlashSendTargetGroupIdField = { groupId: 1 } as const;

/** `field1` is the discriminator: 1 = private (uid), 2 = group. */
export const FLASH_TARGET_PRIVATE = 1;
export const FLASH_TARGET_GROUP = 2;

export interface FlashSendTarget {
  field1: number;
  targetUid?: { targetUid: string } | undefined;
  targetGroup?: { groupId: number | bigint } | undefined;
}

export interface FlashSendReq {
  target: FlashSendTarget;
  filesetUuid: string;
}

export function encodeFlashSendTarget(target: FlashSendTarget): Uint8Array {
  return new ProtoWriter()
    .uint32(FlashSendTargetField.field1, target.field1)
    .message(
      FlashSendTargetField.targetUid,
      target.targetUid
        ? new ProtoWriter()
            .string(FlashSendTargetUidField.targetUid, target.targetUid.targetUid)
            .finish()
        : undefined,
    )
    .message(
      FlashSendTargetField.targetGroup,
      target.targetGroup
        ? new ProtoWriter()
            .uint32(FlashSendTargetGroupIdField.groupId, Number(target.targetGroup.groupId))
            .finish()
        : undefined,
    )
    .finish();
}

export function encodeFlashSendReq(req: FlashSendReq): Uint8Array {
  return new ProtoWriter()
    .message(FlashSendReqField.target, encodeFlashSendTarget(req.target))
    .string(FlashSendReqField.filesetUuid, req.filesetUuid)
    .finish();
}

export interface FlashSendParams {
  filesetUuid: string;
  groupId?: number | bigint | undefined;
  targetUid?: string | undefined;
}

/**
 * `groupId` wins if both are supplied — the reference tests `groupId !== undefined`
 * first, so a stray `targetUid` alongside it is silently ignored rather than
 * rejected. Reproduced rather than "fixed": a caller who passes both has a bug
 * upstream, and inventing a throw here would be a behaviour change.
 */
export const SendFlashMsg: OidbSpec<
  FlashSendParams,
  FlashSendReq,
  OidbEmptyLike,
  undefined
> = {
  command: FLASH_SEND_COMMAND,
  subCommand: 1,
  serialize: (params) => {
    if (params.groupId !== undefined) {
      return {
        target: {
          field1: FLASH_TARGET_GROUP,
          targetGroup: { groupId: params.groupId },
        },
        filesetUuid: params.filesetUuid,
      };
    }
    return {
      target: {
        field1: FLASH_TARGET_PRIVATE,
        targetUid: { targetUid: params.targetUid ?? "" },
      },
      filesetUuid: params.filesetUuid,
    };
  },
  encodeBody: encodeFlashSendReq,
  decodeBody: decodeOidbEmptyLike,
  deserialize: () => undefined,
};

// ---------------------------------------------------------------------------
// ListFilesets / GetFilesetDetail — 0x93d2_1 / 0x93d3_1
// ---------------------------------------------------------------------------

export const FlashListFilesetsReqField = { field1: 1, field2: 2, field3: 3 } as const;

export interface FlashListFilesetsReq {
  field1: number;
  field2: string;
  field3: number;
}

export function encodeFlashListFilesetsReq(req: FlashListFilesetsReq): Uint8Array {
  return new ProtoWriter()
    .uint32(FlashListFilesetsReqField.field1, req.field1)
    .string(FlashListFilesetsReqField.field2, req.field2)
    .uint32(FlashListFilesetsReqField.field3, req.field3)
    .finish();
}

/** `FlashFileEntry`: 1 filesetUuid, 2 fileName, 3 origName, 4 fileType, 5 fileSize(u64),
 *  8 uploadUrlWrap, 9 fileIdWrap.  Fields 6 and 7 are unused. */
export const FlashFileEntryField = {
  filesetUuid: 1,
  fileName: 2,
  origName: 3,
  fileType: 4,
  fileSize: 5,
  uploadUrlWrap: 8,
  fileIdWrap: 9,
} as const;
export const FlashFileUploadUrlField = { uploadUrl: 1 } as const;
export const FlashFileIdWrapField = { fileId: 1, download: 2 } as const;
export const FlashFileDownloadInfoField = { field1: 1, downloadUrl: 2 } as const;

export interface FlashFileDownloadInfo {
  field1: number | null;
  downloadUrl: string | null;
}

export interface FlashFileIdWrap {
  fileId: string | null;
  download: FlashFileDownloadInfo | null;
}

export interface FlashFileUploadUrl {
  uploadUrl: string | null;
}

export interface FlashFileEntry {
  filesetUuid: string | null;
  fileName: string | null;
  origName: string | null;
  fileType: number | null;
  fileSize: bigint | null;
  uploadUrlWrap: FlashFileUploadUrl | null;
  fileIdWrap: FlashFileIdWrap | null;
}

export function decodeFlashFileDownloadInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashFileDownloadInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: FlashFileDownloadInfo = { field1: null, downloadUrl: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashFileDownloadInfoField.field1, WireType.varint):
        info.field1 = reader.uint32();
        break;
      case tagOf(FlashFileDownloadInfoField.downloadUrl, WireType.lengthDelimited):
        info.downloadUrl = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return info;
}

export function decodeFlashFileIdWrap(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashFileIdWrap {
  const reader = new ProtoReader(data, offset, end);
  const wrap: FlashFileIdWrap = { fileId: null, download: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashFileIdWrapField.fileId, WireType.lengthDelimited):
        wrap.fileId = reader.string();
        break;
      case tagOf(FlashFileIdWrapField.download, WireType.lengthDelimited):
        wrap.download = reader.message(decodeFlashFileDownloadInfo);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return wrap;
}

export function decodeFlashFileUploadUrl(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashFileUploadUrl {
  const reader = new ProtoReader(data, offset, end);
  const wrap: FlashFileUploadUrl = { uploadUrl: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(FlashFileUploadUrlField.uploadUrl, WireType.lengthDelimited)) {
      wrap.uploadUrl = reader.string();
    } else {
      reader.skip(unknown);
    }
  }
  return wrap;
}

export function decodeFlashFileEntry(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashFileEntry {
  const reader = new ProtoReader(data, offset, end);
  const entry: FlashFileEntry = {
    filesetUuid: null,
    fileName: null,
    origName: null,
    fileType: null,
    fileSize: null,
    uploadUrlWrap: null,
    fileIdWrap: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashFileEntryField.filesetUuid, WireType.lengthDelimited):
        entry.filesetUuid = reader.string();
        break;
      case tagOf(FlashFileEntryField.fileName, WireType.lengthDelimited):
        entry.fileName = reader.string();
        break;
      case tagOf(FlashFileEntryField.origName, WireType.lengthDelimited):
        entry.origName = reader.string();
        break;
      case tagOf(FlashFileEntryField.fileType, WireType.varint):
        entry.fileType = reader.uint32();
        break;
      case tagOf(FlashFileEntryField.fileSize, WireType.varint):
        entry.fileSize = reader.uint64();
        break;
      case tagOf(FlashFileEntryField.uploadUrlWrap, WireType.lengthDelimited):
        entry.uploadUrlWrap = reader.message(decodeFlashFileUploadUrl);
        break;
      case tagOf(FlashFileEntryField.fileIdWrap, WireType.lengthDelimited):
        entry.fileIdWrap = reader.message(decodeFlashFileIdWrap);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return entry;
}

export const FlashListFilesetsRespField = { entries: 1 } as const;
export const FlashGetDetailRespField = { entries: 1 } as const;

export interface FlashListFilesetsResp {
  entries: FlashFileEntry[];
}

/** `deserialize` is `body.entries ?? []`, so an absent list and an empty list are
 *  identical to the caller. Wrapper needed because the decoder returns an object. */
export function toFlashEntries(body: FlashListFilesetsResp): FlashFileEntry[] {
  return body.entries ?? [];
}

export interface FlashListFilesetsParams {
  field1?: number | undefined;
  field3?: number | undefined;
}

/** `field1 ?? 3`, `field3 ?? 10` — the reference's pagination defaults. */
export const FLASH_LIST_DEFAULTS = { field1: 3, field3: 10 } as const;

export const ListFilesets: OidbSpec<
  FlashListFilesetsParams,
  FlashListFilesetsReq,
  FlashListFilesetsResp,
  FlashFileEntry[]
> = {
  command: FLASH_LIST_FILESETS_COMMAND,
  subCommand: 1,
  serialize: (params) => ({
    field1: params.field1 ?? FLASH_LIST_DEFAULTS.field1,
    field2: "",
    field3: params.field3 ?? FLASH_LIST_DEFAULTS.field3,
  }),
  encodeBody: encodeFlashListFilesetsReq,
  decodeBody: decodeFlashListFilesetsResp,
  deserialize: toFlashEntries,
};

export function decodeFlashListFilesetsResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashListFilesetsResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: FlashListFilesetsResp = { entries: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(FlashListFilesetsRespField.entries, WireType.lengthDelimited)) {
      resp.entries.push(reader.message(decodeFlashFileEntry));
    } else {
      reader.skip(unknown);
    }
  }
  return resp;
}

export function decodeFlashGetDetailResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashListFilesetsResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: FlashListFilesetsResp = { entries: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(FlashGetDetailRespField.entries, WireType.lengthDelimited)) {
      resp.entries.push(reader.message(decodeFlashFileEntry));
    } else {
      reader.skip(unknown);
    }
  }
  return resp;
}

export const FlashGetDetailReqField = { filesetUuid: 1, field2: 2 } as const;

export interface FlashGetDetailReq {
  filesetUuid: string;
  field2: number;
}

export function encodeFlashGetDetailReq(req: FlashGetDetailReq): Uint8Array {
  return new ProtoWriter()
    .string(FlashGetDetailReqField.filesetUuid, req.filesetUuid)
    .uint32(FlashGetDetailReqField.field2, req.field2)
    .finish();
}

export const GetFilesetDetail: OidbSpec<
  FlashDeleteFileParams,
  FlashGetDetailReq,
  FlashListFilesetsResp,
  FlashFileEntry[]
> = {
  command: FLASH_GET_DETAIL_COMMAND,
  subCommand: 1,
  // `field2: 7` is a constant here, not a parameter.
  serialize: (params) => ({ filesetUuid: params.filesetUuid, field2: 7 }),
  encodeBody: encodeFlashGetDetailReq,
  decodeBody: decodeFlashGetDetailResp,
  deserialize: toFlashEntries,
};

// ---------------------------------------------------------------------------
// GetDownloadUrl — 0x93d4_1
// ---------------------------------------------------------------------------

export const FlashGetDownloadUrlReqField = {
  filesetUuid: 1,
  inner: 2,
  field3: 3,
  field4: 4,
} as const;

export const FlashGetDownloadUrlReqInnerField = {
  field1: 1,
  field2: 2,
  field3: 3,
  field4: 4,
  field5: 5,
  field6: 6,
} as const;

export interface FlashGetDownloadUrlReq {
  filesetUuid: string;
  inner: {
    field1: string;
    field2: number;
    field3: number;
    field4: string;
    field5: { field1: number };
    field6: { field1: number; field2: number };
  };
  field3: number;
  field4: number;
}

export function encodeFlashGetDownloadUrlReq(req: FlashGetDownloadUrlReq): Uint8Array {
  return new ProtoWriter()
    .string(FlashGetDownloadUrlReqField.filesetUuid, req.filesetUuid)
    .message(
      FlashGetDownloadUrlReqField.inner,
      new ProtoWriter()
        .string(FlashGetDownloadUrlReqInnerField.field1, req.inner.field1)
        .uint32(FlashGetDownloadUrlReqInnerField.field2, req.inner.field2)
        .uint32(FlashGetDownloadUrlReqInnerField.field3, req.inner.field3)
        .string(FlashGetDownloadUrlReqInnerField.field4, req.inner.field4)
        .message(
          FlashGetDownloadUrlReqInnerField.field5,
          new ProtoWriter().uint32(1, req.inner.field5.field1).finish(),
        )
        .message(
          FlashGetDownloadUrlReqInnerField.field6,
          new ProtoWriter().uint32(1, req.inner.field6.field1).uint32(2, req.inner.field6.field2).finish(),
        )
        .finish(),
    )
    .uint32(FlashGetDownloadUrlReqField.field3, req.field3)
    .uint32(FlashGetDownloadUrlReqField.field4, req.field4)
    .finish();
}

export const FlashGetDownloadUrlRespField = { entry: 1 } as const;
export const FlashDownloadEntryField = { field2: 2, fileInfo: 3, field4: 4, field5: 5 } as const;
export const FlashDownloadFileInfoField = {
  filesetUuid: 1,
  fileUuid: 2,
  field5: 5,
  field6: 6,
  field7: 7,
  fileName: 8,
  origName: 9,
  fileSize: 11,
  downloadInfo: 13,
  mainFile: 14,
} as const;
export const FlashDownloadMainFileField = { fileId: 1, field3: 3 } as const;
export const FlashDownloadUrlInfoField = {
  fileId: 1,
  download: 2,
  sha1: 3,
  field4: 4,
  md5: 5,
  width: 6,
  height: 7,
} as const;
export const FlashDownloadUrlWrapField = { field1: 1, downloadUrl: 2 } as const;

export interface FlashDownloadUrlWrap {
  field1: number | null;
  downloadUrl: string | null;
}

export interface FlashDownloadUrlInfo {
  fileId: string | null;
  download: FlashDownloadUrlWrap | null;
  sha1: string | null;
  field4: number | null;
  md5: string | null;
  width: number | null;
  height: number | null;
}

export interface FlashDownloadMainFile {
  fileId: string | null;
  field3: number | null;
}

export interface FlashDownloadFileInfo {
  filesetUuid: string | null;
  fileUuid: string | null;
  field5: number | null;
  field6: number | null;
  field7: number | null;
  fileName: string | null;
  origName: string | null;
  fileSize: bigint | null;
  downloadInfo: FlashDownloadUrlInfo | null;
  mainFile: FlashDownloadMainFile | null;
}

export interface FlashDownloadEntry {
  field2: number | null;
  fileInfo: FlashDownloadFileInfo[];
  field4: string | null;
  field5: number | null;
}

export interface FlashGetDownloadUrlResp {
  entry: FlashDownloadEntry | null;
}

export function decodeFlashDownloadUrlWrap(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashDownloadUrlWrap {
  const reader = new ProtoReader(data, offset, end);
  const wrap: FlashDownloadUrlWrap = { field1: null, downloadUrl: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashDownloadUrlWrapField.field1, WireType.varint):
        wrap.field1 = reader.uint32();
        break;
      case tagOf(FlashDownloadUrlWrapField.downloadUrl, WireType.lengthDelimited):
        wrap.downloadUrl = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return wrap;
}

export function decodeFlashDownloadMainFile(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashDownloadMainFile {
  const reader = new ProtoReader(data, offset, end);
  const main: FlashDownloadMainFile = { fileId: null, field3: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashDownloadMainFileField.fileId, WireType.lengthDelimited):
        main.fileId = reader.string();
        break;
      case tagOf(FlashDownloadMainFileField.field3, WireType.varint):
        main.field3 = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return main;
}

export function decodeFlashDownloadUrlInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashDownloadUrlInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: FlashDownloadUrlInfo = {
    fileId: null,
    download: null,
    sha1: null,
    field4: null,
    md5: null,
    width: null,
    height: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashDownloadUrlInfoField.fileId, WireType.lengthDelimited):
        info.fileId = reader.string();
        break;
      case tagOf(FlashDownloadUrlInfoField.download, WireType.lengthDelimited):
        info.download = reader.message(decodeFlashDownloadUrlWrap);
        break;
      case tagOf(FlashDownloadUrlInfoField.sha1, WireType.lengthDelimited):
        info.sha1 = reader.string();
        break;
      case tagOf(FlashDownloadUrlInfoField.field4, WireType.varint):
        info.field4 = reader.uint32();
        break;
      case tagOf(FlashDownloadUrlInfoField.md5, WireType.lengthDelimited):
        info.md5 = reader.string();
        break;
      case tagOf(FlashDownloadUrlInfoField.width, WireType.varint):
        info.width = reader.uint32();
        break;
      case tagOf(FlashDownloadUrlInfoField.height, WireType.varint):
        info.height = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return info;
}

export function decodeFlashDownloadFileInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashDownloadFileInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: FlashDownloadFileInfo = {
    filesetUuid: null,
    fileUuid: null,
    field5: null,
    field6: null,
    field7: null,
    fileName: null,
    origName: null,
    fileSize: null,
    downloadInfo: null,
    mainFile: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashDownloadFileInfoField.filesetUuid, WireType.lengthDelimited):
        info.filesetUuid = reader.string();
        break;
      case tagOf(FlashDownloadFileInfoField.fileUuid, WireType.lengthDelimited):
        info.fileUuid = reader.string();
        break;
      case tagOf(FlashDownloadFileInfoField.field5, WireType.varint):
        info.field5 = reader.uint32();
        break;
      case tagOf(FlashDownloadFileInfoField.field6, WireType.varint):
        info.field6 = reader.uint32();
        break;
      case tagOf(FlashDownloadFileInfoField.field7, WireType.varint):
        info.field7 = reader.uint32();
        break;
      case tagOf(FlashDownloadFileInfoField.fileName, WireType.lengthDelimited):
        info.fileName = reader.string();
        break;
      case tagOf(FlashDownloadFileInfoField.origName, WireType.lengthDelimited):
        info.origName = reader.string();
        break;
      case tagOf(FlashDownloadFileInfoField.fileSize, WireType.varint):
        info.fileSize = reader.uint64();
        break;
      case tagOf(FlashDownloadFileInfoField.downloadInfo, WireType.lengthDelimited):
        info.downloadInfo = reader.message(decodeFlashDownloadUrlInfo);
        break;
      case tagOf(FlashDownloadFileInfoField.mainFile, WireType.lengthDelimited):
        info.mainFile = reader.message(decodeFlashDownloadMainFile);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return info;
}

export function decodeFlashDownloadEntry(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashDownloadEntry {
  const reader = new ProtoReader(data, offset, end);
  const entry: FlashDownloadEntry = { field2: null, fileInfo: [], field4: null, field5: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashDownloadEntryField.field2, WireType.varint):
        entry.field2 = reader.uint32();
        break;
      case tagOf(FlashDownloadEntryField.fileInfo, WireType.lengthDelimited):
        entry.fileInfo.push(reader.message(decodeFlashDownloadFileInfo));
        break;
      case tagOf(FlashDownloadEntryField.field4, WireType.lengthDelimited):
        entry.field4 = reader.string();
        break;
      case tagOf(FlashDownloadEntryField.field5, WireType.varint):
        entry.field5 = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return entry;
}

export function decodeFlashGetDownloadUrlResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashGetDownloadUrlResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: FlashGetDownloadUrlResp = { entry: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(FlashGetDownloadUrlRespField.entry, WireType.lengthDelimited)) {
      resp.entry = reader.message(decodeFlashDownloadEntry);
    } else {
      reader.skip(unknown);
    }
  }
  return resp;
}

/** One row per `entry.fileInfo`, flattened the way the reference flattens it. */
export interface FlashDownloadRow {
  fileIndex: number;
  fileId: string;
  filesetUuid: string;
  fileUuid: string;
  fileName: string;
  fileSize: number;
}

/**
 * `body.entry?.fileInfo ?? []`, with `fileIndex` falling back to `idx + 1`.
 *
 * ⚠️ `fileSize` goes through `Number(...)` and so loses precision above 2^53 — the
 * reference does the same. Reproduced, not repaired: a larger value is already
 * ambiguous in the wire's own `uint64` handling upstream, and silently returning a
 * BigInt where callers expect a number would break them.
 */
export function toFlashDownloadRows(resp: FlashGetDownloadUrlResp): FlashDownloadRow[] {
  return (resp.entry?.fileInfo ?? []).map((info, index) => ({
    fileIndex: info.field6 ?? index + 1,
    fileId: info.mainFile?.fileId ?? "",
    filesetUuid: info.filesetUuid ?? "",
    fileUuid: info.fileUuid ?? "",
    fileName: info.fileName ?? "",
    fileSize: Number(info.fileSize ?? 0),
  }));
}

export interface FlashGetDownloadUrlParams {
  filesetUuid: string;
}

export const GetDownloadUrl: OidbSpec<
  FlashGetDownloadUrlParams,
  FlashGetDownloadUrlReq,
  FlashGetDownloadUrlResp,
  FlashDownloadRow[]
> = {
  command: FLASH_GET_DOWNLOAD_URL_COMMAND,
  subCommand: 1,
  serialize: (params) => ({
    filesetUuid: params.filesetUuid,
    // Every value here is a constant; the reference takes no other input.
    inner: {
      field1: "",
      field2: 1,
      field3: 18,
      field4: "",
      field5: { field1: 0 },
      field6: { field1: 0, field2: 0 },
    },
    field3: 7,
    field4: 1,
  }),
  encodeBody: encodeFlashGetDownloadUrlReq,
  decodeBody: decodeFlashGetDownloadUrlResp,
  deserialize: toFlashDownloadRows,
};

// ---------------------------------------------------------------------------
// The upload pair — 0x12a9_100 and 0x12a9_103
// ---------------------------------------------------------------------------

export const FlashPrepareUploadReqField = { head: 1, payload: 2 } as const;
export const FlashPrepareUploadPayloadField = {
  wrapper: 1,
  field2: 2,
  field3: 3,
  field4: 4,
  field5: 5,
  field6: 6,
  field7: 7,
  field8: 8,
  filesetWrap: 9,
} as const;
export const FlashPrepareWrapperField = { fileInfo: 1, field2: 2 } as const;
export const FlashPreparePayloadF6Field = { field1: 1, field2: 2, field3: 3, field10: 10 } as const;
export const FlashPreparePayloadF6F1Field = { field1: 1, field2: 2 } as const;
export const FlashPreparePayloadF6F2Field = { field3: 3 } as const;
export const FlashPreparePayloadF6F3Field = { field11: 11, field12: 12 } as const;

/**
 * The chain of empty placeholder messages inside `prepareUpload.payload.field6`.
 *
 * ⚠️ **`field3` carries BOTH `field11` and `field12`**, each an empty message
 * (`5a 00 62 00`). Writing only `field11` shortens the request by 2 bytes; the
 * server then reads the whole trailing block as malformed. These are `{}` literals
 * in the reference's `serialize`, so they are structural, not conditional.
 */
export interface FlashPreparePayloadF6F1 {
  field1: number;
  field2: Record<string, never>;
}

export interface FlashPreparePayloadF6F2 {
  field3: Record<string, never>;
}

export interface FlashPreparePayloadF6F3 {
  field11: Record<string, never>;
  field12: Record<string, never>;
}

export interface FlashPreparePayloadF6 {
  field1: FlashPreparePayloadF6F1;
  field2: FlashPreparePayloadF6F2;
  field3: FlashPreparePayloadF6F3;
  field10: number;
}

export function encodeFlashPreparePayloadF6(f6: FlashPreparePayloadF6): Uint8Array {
  return new ProtoWriter()
    .message(
      FlashPreparePayloadF6Field.field1,
      new ProtoWriter()
        .uint32Present(FlashPreparePayloadF6F1Field.field1, f6.field1.field1)
        .message(FlashPreparePayloadF6F1Field.field2, new Uint8Array(0))
        .finish(),
    )
    .message(
      FlashPreparePayloadF6Field.field2,
      new ProtoWriter()
        .message(FlashPreparePayloadF6F2Field.field3, new Uint8Array(0))
        .finish(),
    )
    .message(
      FlashPreparePayloadF6Field.field3,
      new ProtoWriter()
        .message(FlashPreparePayloadF6F3Field.field11, new Uint8Array(0))
        .message(FlashPreparePayloadF6F3Field.field12, new Uint8Array(0))
        .finish(),
    )
    .uint32Present(FlashPreparePayloadF6Field.field10, f6.field10)
    .finish();
}

export interface FlashPrepareUploadPayload {
  wrapper: { fileInfo: FlashApplyFileInfo; field2: number };
  field2: number;
  field3: number;
  field4: number;
  field5: number;
  field6: FlashPreparePayloadF6;
  field7: number;
  field8: number;
  filesetWrap: FlashApplyFilesetWrap;
}

export interface FlashPrepareUploadReq {
  head: FlashApplyHead;
  payload: FlashPrepareUploadPayload;
}

export function encodeFlashPrepareUploadReq(req: FlashPrepareUploadReq): Uint8Array {
  const f6 = req.payload.field6;
  return new ProtoWriter()
    .message(FlashPrepareUploadReqField.head, encodeFlashApplyHead(req.head))
    .message(
      FlashPrepareUploadReqField.payload,
      new ProtoWriter()
        .message(
          FlashPrepareUploadPayloadField.wrapper,
          new ProtoWriter()
            .message(
              FlashPrepareWrapperField.fileInfo,
              encodeFlashApplyFileInfo(req.payload.wrapper.fileInfo),
            )
            // Bare `!= null`: 0 is emitted.
            .uint32Present(FlashPrepareWrapperField.field2, req.payload.wrapper.field2)
            .finish(),
        )
        .uint32Present(FlashPrepareUploadPayloadField.field2, req.payload.field2)
        .uint32Present(FlashPrepareUploadPayloadField.field3, req.payload.field3)
        .uint32Present(FlashPrepareUploadPayloadField.field4, req.payload.field4)
        .uint32Present(FlashPrepareUploadPayloadField.field5, req.payload.field5)
        .message(FlashPrepareUploadPayloadField.field6, encodeFlashPreparePayloadF6(f6))
        .uint32Present(FlashPrepareUploadPayloadField.field7, req.payload.field7)
        .uint32Present(FlashPrepareUploadPayloadField.field8, req.payload.field8)
        .message(
          FlashPrepareUploadPayloadField.filesetWrap,
          encodeFlashApplyFilesetWrap(req.payload.filesetWrap),
        )
        .finish(),
    )
    .finish();
}

export const FlashApplyUploadReqField = { head: 1, payload: 12 } as const;
export const FlashApplyUploadPayloadField = {
  wrapper: 1,
  flag2: 2,
  field3: 3,
  filesetWrap: 10,
} as const;
export const FlashApplyUploadWrapperField = {
  fileInfo: 1,
  fileId: 2,
  field3: 3,
  field4: 4,
  field5: 5,
  field6: 6,
} as const;
export const FlashApplyPayloadField3Field = { field1: 1, field2: 2, field3: 3, field4: 4 } as const;

export interface FlashApplyUploadWrapper {
  fileInfo: FlashApplyFileInfo;
  fileId: string;
  field3: number;
  field4: number;
  field5: number;
  field6: number;
}

export interface FlashApplyUploadPayload {
  wrapper: FlashApplyUploadWrapper;
  flag2: { field1: number };
  field3: { field1: number; field2: number; field3: number; field4: Record<string, never> };
  filesetWrap: FlashApplyFilesetWrap;
}

export interface FlashApplyUploadReq {
  head: FlashApplyHead;
  payload: FlashApplyUploadPayload;
}

export function encodeFlashApplyUploadReq(req: FlashApplyUploadReq): Uint8Array {
  return new ProtoWriter()
    .message(FlashApplyUploadReqField.head, encodeFlashApplyHead(req.head))
    .message(
      FlashApplyUploadReqField.payload,
      new ProtoWriter()
        .message(
          FlashApplyUploadPayloadField.wrapper,
          new ProtoWriter()
            .message(FlashApplyUploadWrapperField.fileInfo, encodeFlashApplyFileInfo(req.payload.wrapper.fileInfo))
            .stringPresent(FlashApplyUploadWrapperField.fileId, req.payload.wrapper.fileId)
            .uint32Present(FlashApplyUploadWrapperField.field3, req.payload.wrapper.field3)
            .uint32Present(FlashApplyUploadWrapperField.field4, req.payload.wrapper.field4)
            .uint32Present(FlashApplyUploadWrapperField.field5, req.payload.wrapper.field5)
            .uint32Present(FlashApplyUploadWrapperField.field6, req.payload.wrapper.field6)
            .finish(),
        )
        .message(
          FlashApplyUploadPayloadField.flag2,
          new ProtoWriter().uint32Present(1, req.payload.flag2.field1).finish(),
        )
        .message(
          FlashApplyUploadPayloadField.field3,
          new ProtoWriter()
            .uint32Present(FlashApplyPayloadField3Field.field1, req.payload.field3.field1)
            .uint32Present(FlashApplyPayloadField3Field.field2, req.payload.field3.field2)
            .uint32Present(FlashApplyPayloadField3Field.field3, req.payload.field3.field3)
            .message(FlashApplyPayloadField3Field.field4, new Uint8Array(0))
            .finish(),
        )
        .message(
          FlashApplyUploadPayloadField.filesetWrap,
          encodeFlashApplyFilesetWrap(req.payload.filesetWrap),
        )
        .finish(),
    )
    .finish();
}

// ---------------------------------------------------------------------------
// Upload responses
// ---------------------------------------------------------------------------

export const FlashPrepareUploadRespField = { head: 1, rkeyWrap: 2 } as const;
export const FlashApplyHeadRespField = { sub: 1, msg: 3 } as const;
export const FlashRkeyWrapField = { rkey: 1 } as const;

export interface FlashRkeyWrap {
  rkey: string | null;
}

export interface FlashApplyHeadResp {
  sub: { seq: number | null; sub: number | null } | null;
  msg: string | null;
}

export interface FlashPrepareUploadResp {
  head: FlashApplyHeadResp | null;
  rkeyWrap: FlashRkeyWrap | null;
}

export function decodeFlashRkeyWrap(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashRkeyWrap {
  const reader = new ProtoReader(data, offset, end);
  const wrap: FlashRkeyWrap = { rkey: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(FlashRkeyWrapField.rkey, WireType.lengthDelimited)) {
      wrap.rkey = reader.string();
    } else {
      reader.skip(unknown);
    }
  }
  return wrap;
}

function decodeFlashApplyHeadSub(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): { seq: number | null; sub: number | null } {
  const reader = new ProtoReader(data, offset, end);
  const sub: { seq: number | null; sub: number | null } = { seq: null, sub: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashApplyHeadSubField.seq, WireType.varint):
        sub.seq = reader.uint32();
        break;
      case tagOf(FlashApplyHeadSubField.sub, WireType.varint):
        sub.sub = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return sub;
}

export function decodeFlashApplyHeadResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashApplyHeadResp {
  const reader = new ProtoReader(data, offset, end);
  const head: FlashApplyHeadResp = { sub: null, msg: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashApplyHeadRespField.sub, WireType.lengthDelimited):
        head.sub = reader.message(decodeFlashApplyHeadSub);
        break;
      case tagOf(FlashApplyHeadRespField.msg, WireType.lengthDelimited):
        head.msg = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return head;
}

export function decodeFlashPrepareUploadResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): FlashPrepareUploadResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: FlashPrepareUploadResp = { head: null, rkeyWrap: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(FlashPrepareUploadRespField.head, WireType.lengthDelimited):
        resp.head = reader.message(decodeFlashApplyHeadResp);
        break;
      case tagOf(FlashPrepareUploadRespField.rkeyWrap, WireType.lengthDelimited):
        resp.rkeyWrap = reader.message(decodeFlashRkeyWrap);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

/** `body.rkeyWrap?.rkey ?? null` — a bare rkey, or null. */
export function toFlashRkey(resp: FlashPrepareUploadResp): string | null {
  return resp.rkeyWrap?.rkey ?? null;
}

export interface FlashUploadParams {
  filesetUuid: string;
  fileUuid: string;
  fileIndex: number;
  fileName: string;
  fileSize: number;
  sha1: string;
  md5?: string | undefined;
  formatCode: number;
  width?: number | undefined;
  height?: number | undefined;
  thumbType?: "jpg" | "png" | undefined;
}

/**
 * The thumbnail variant as three numbers the two commands agree on.
 *
 * `field103`: 22 = original, 24 = jpg thumb, 23 = png thumb.
 * `filesetWrap.field6`/`field7` and `fileInfo.field5.field1` change with it too.
 */
export function flashThumbVariant(thumbType: "jpg" | "png" | undefined): {
  field103: number;
  isThumb: boolean;
  isJpg: boolean;
} {
  const isThumb = thumbType !== undefined;
  const isJpg = thumbType === "jpg";
  return {
    field103: isThumb ? (isJpg ? 24 : 23) : 22,
    isThumb,
    isJpg,
  };
}

/**
 * `PrepareUpload` — 0x12a9_100.
 *
 * ⚠️ `serialize` **consumes `seqCounter`** (`reference:104756`). The counter is part
 * of the request and the server orders transfers by it, so this spec is not pure:
 * two identical calls produce different bytes. `peekPrepareSequence` exists so a
 * test can assert the current value instead of trying to pin a moving target.
 */
export const PrepareUpload: OidbSpec<
  FlashUploadParams,
  FlashPrepareUploadReq,
  FlashPrepareUploadResp,
  string | null
> = {
  command: FLASH_UPLOAD_COMMAND,
  subCommand: FLASH_PREPARE_UPLOAD_SUB_COMMAND,
  uinForm: true,
  serialize: (params) => {
    const variant = flashThumbVariant(params.thumbType);
    return {
      head: {
        sub: { seq: prepareSequence++, sub: FLASH_PREPARE_UPLOAD_SUB_COMMAND },
        config: { field101: 2, field102: 4, field103: variant.field103, field200: 5 },
        field3: { field1: 1 },
      },
      payload: {
        wrapper: {
          fileInfo: {
            fileSize: params.fileSize,
            // md5 is a LITERAL "" here (not params.md5), and the `!== ""` guard drops it.
            md5: "",
            sha1: params.sha1,
            fileName: params.fileName,
            field5: {
              field1: variant.isJpg ? 1 : 0,
              field2: 0,
              field3: 0,
              field4: 0,
            },
            field6: params.width ?? 0,
            field7: params.height ?? 0,
            field8: 0,
            field9: variant.isJpg ? 0 : 1,
          },
          field2: 0,
        },
        field2: 1,
        field3: 0,
        field4: 0,
        field5: 0,
        field6: {
          field1: { field1: 0, field2: {} },
          field2: { field3: {} },
          field3: { field11: {}, field12: {} },
          field10: 0,
        },
        field7: 0,
        field8: 0,
        filesetWrap: {
          filesetUuid: params.filesetUuid,
          uploadKey: params.filesetUuid,
          fileUuid: params.fileUuid,
          field4: params.fileIndex,
          field5: 0,
          field6: variant.isThumb ? 1 : 0,
          field7: variant.isThumb ? (variant.isJpg ? 2 : 26) : params.formatCode,
          field8: {},
          field9: 1,
          field10: 0,
          field11: 0,
          field12: 0,
          field13: 0,
          field14: 0,
        },
      },
    };
  },
  encodeBody: encodeFlashPrepareUploadReq,
  decodeBody: decodeFlashPrepareUploadResp,
  deserialize: toFlashRkey,
};

/**
 * `ApplyUpload` — 0x12a9_103.
 *
 * ⚠️ Two call-time values: `seqCounter$1` (a *different* counter, seeded 100) and
 * `Math.floor(Date.now() / 1e3)` in `wrapper.field4`. The latter makes the request
 * genuinely non-reproducible; `nowSeconds` is exposed as an optional parameter so a
 * test can pin it, and production leaves it undefined to get the real clock.
 */
export const ApplyUpload: OidbSpec<
  FlashUploadParams & { fileId: string; nowSeconds?: number | undefined },
  FlashApplyUploadReq,
  FlashPrepareUploadResp,
  undefined
> = {
  command: FLASH_UPLOAD_COMMAND,
  subCommand: FLASH_APPLY_UPLOAD_SUB_COMMAND,
  uinForm: true,
  serialize: (params) => {
    const variant = flashThumbVariant(params.thumbType);
    return {
      head: {
        sub: { seq: applySequence++, sub: FLASH_APPLY_UPLOAD_SUB_COMMAND },
        config: { field101: 2, field102: 4, field103: variant.field103, field200: 5 },
        field3: { field1: 1 },
      },
      payload: {
        wrapper: {
          fileInfo: {
            fileSize: params.fileSize,
            // Here md5 IS the caller's, unlike PrepareUpload.
            md5: params.md5 ?? "",
            sha1: params.sha1,
            fileName: params.fileName,
            field5: { field1: variant.isJpg ? 1 : 0, field2: 0, field3: 0, field4: 0 },
            field6: params.width ?? 0,
            field7: params.height ?? 0,
            field8: 0,
            field9: variant.isJpg ? 0 : 1,
          },
          fileId: params.fileId,
          field3: 1,
          field4: params.nowSeconds ?? Math.floor(Date.now() / 1000),
          // 1209600 = 14 days, the reference's own literal.
          field5: 1209600,
          field6: 0,
        },
        flag2: { field1: 2 },
        field3: { field1: 0, field2: 0, field3: 0, field4: {} },
        filesetWrap: {
          filesetUuid: params.filesetUuid,
          uploadKey: params.filesetUuid,
          fileUuid: params.fileUuid,
          field4: params.fileIndex,
          field5: variant.isThumb && !variant.isJpg ? 1 : 0,
          field6: variant.isThumb ? (variant.isJpg ? 1 : 0) : 0,
          field7: variant.isThumb ? (variant.isJpg ? 2 : 26) : params.formatCode,
          field8: {},
          field9: 1,
          field10: 0,
          field11: 0,
          field12: 0,
          field13: 0,
          field14: 0,
        },
      },
    };
  },
  encodeBody: encodeFlashApplyUploadReq,
  // ⚠️ `FlashApplyUploadResp` is NOT an empty message: it carries `head` (1) and
  // `rkeyWrap` (2) — the same shape as `FlashPrepareUploadResp`, verified at
  // :101183. What is empty is the *result*: the reference's `deserialize` is
  // `(_ctx, _body) => ({})`, so it throws the decoded fields away. Decoding them
  // anyway keeps the wire round-trippable while still matching the result.
  decodeBody: decodeFlashPrepareUploadResp,
  deserialize: () => undefined,
};

// ---------------------------------------------------------------------------
// The empty response message
// ---------------------------------------------------------------------------

/**
 * A message the reference decodes into `{}` — no recognised fields at all.
 *
 * Seven of the thirteen flash commands end here: their decode function is a switch
 * with no matching cases, so everything lands in the unknown-field collector and the
 * result is `{}`. Representing it as `OidbEmptyLike` (rather than reusing
 * `0x89a-0.ts`'s `OidbEmpty`) keeps the intent visible at the call site.
 */
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