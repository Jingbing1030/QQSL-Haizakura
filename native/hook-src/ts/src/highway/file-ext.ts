// `FileUploadExt` / `PrivateFileUploadExt` — the `bytesReqExtendInfo` blob for the
// **file transfer** highway commands (71 = group, 95 = private).
//
// Reference region: `src/bridge/apis/group-file.ts` (reference/index.mjs:288485+):
//
//   generated codec    `protobuf_encode_FileUploadExt`   :288614
//                      `__size_/__write_FileUploadExt`    :288621 / :288658
//                      `__size_/__write_FileUploadEntry`  :288789 / :288838
//                      `…BusiInfo`                        :288976 / :288992
//                      `…FileEntry`                       :289038 / :289075
//                      `…ClientInfo`                      :289228 / :289264
//                      `…NameInfo`                        :289401 / :289412
//                      `…HostConfig`                      :289443 / :289456
//                      `…Host`                            :289486 / :289505
//                      `…Url`                             :289559 / :289576
//   builders           `buildGroupFileUploadExt`          :289652
//                      `buildPrivateFileUploadExt`        :289690
//   call sites         group `upload`                     :289788  (cmdId 71, :289790)
//                      private `uploadPrivate`            :289857  (cmdId 95, :289859)
//
// ---------------------------------------------------------------------------
// This is NOT `NTV2RichMediaHighwayExt`
// ---------------------------------------------------------------------------
// `ext.ts` next door encodes the rich-media extension used by images / voice /
// video: a nested `{fileUuid, uKey, network, msgInfoBody, blockSize, hash}` with
// per-block sha1s. A **file** upload uses a completely different, flat message.
// The only things the two share are the highway chunk head and the PUT loop; the
// extension is unrelated, and the two are never interchangeable.
//
// Concretely, neither shape carries the other's identifying field:
//
//   NTV2RichMediaHighwayExt   identifies the send by `uKey` + `msgInfoBody`
//   FileUploadExt             identifies it by `busiBuff` + `fileEntry`
//
// ---------------------------------------------------------------------------
// Two numbering spaces, again
// ---------------------------------------------------------------------------
// The cmdId in the chunk head (71 / 95) is neither the OIDB command:
//
//   OIDB   `0x6d6_0`  = 1750/0    group file "request upload"
//   OIDB   `0xe37_1700` = 3639/1700 private file "request upload"
//   highway 71        group file bytes   (:289790)
//   highway 95        private file bytes (:289859)
//
// …nor the NTV2 highway ids (1001/1003/1004/1005/…). Feeding any of those into
// this message produces a chunk the server acknowledges and stores nowhere.
//
// ---------------------------------------------------------------------------
// The hashes are RAW DIGEST BYTES here, not hex strings
// ---------------------------------------------------------------------------
// This is the opposite convention from `ntv2-upload.ts`, where `fileHash` /
// `fileSha1` are 32/40-character lowercase hex strings. Here `md5` (`:289665`),
// `md5S2` (`:289666`) and `checkKey` (`:289667` / `:289704`) are `Uint8Array`s
// straight from `hashFileStreaming` (`:37387` — `new Uint8Array(md5Digest)`).
//
// Verified two ways, both in `test/highway-file-ext.test.ts`:
//   * the golden bytes carry `c2 0c 10 <16 bytes>` / `e2 12 14 <20 bytes>` — a
//     length-delimited field of 16 / 20 bytes. A hex string would be 32 / 40.
//   * round-tripping the golden with a generic wire reader yields the same digest
//     bytes that were passed in, not their hex form.
//
// ---------------------------------------------------------------------------
// The field numbers are 100-based, and a naive tag read gets them wrong
// ---------------------------------------------------------------------------
// Five of the nine messages number their fields in the hundreds, so every tag is
// multi-byte. Reading only the first byte of `a2 06` (0x22) reports "field 4",
// which does not exist in this message at all. The full table — extracted from
// the `buf[offset++] = …` pairs in the generated writers and cross-checked
// against a decoded golden — is:
//
//   FileUploadExt       1, 2, 3, 100, 200      (`:288664-288782`)
//   FileUploadEntry     100, 200, 300, 400, 500 (`:288844-288972`)
//   …BusiInfo           1, 100, 200, 400       (`:288997-289035`)
//   …FileEntry          100, 200, 300, 400, 600, 700 (`:289082-289225`)
//   …ClientInfo         100, 200, 300, 400, 600 (`:289270-289398`)
//   …NameInfo           100                    (`:289414-289440`)
//   …HostConfig         200                    (`:289458-289483`)
//   …Host               1, 2                   (`:289508-289557`)
//   …Url                1, 2                   (`:289579-289618`)
//
// ---------------------------------------------------------------------------
// The two builders differ in exactly four places
// ---------------------------------------------------------------------------
// Everything else — the clientInfo block, the host block, `unknown1 = 100`,
// `unknown2 = 1` — is identical. The four differences:
//
//   field                 group                       private
//   busiBuff.busId        102                         absent (0 → dropped)
//   busiBuff.receiverUin  groupId                     0n → dropped
//   busiBuff.groupCode    groupId                     0n → dropped
//   fileEntry.checkKey    upload.checkKey  (sha1)     the file's own sha1
//   FileUploadExt.unknown3      absent (unset)         0 → dropped
//   FileUploadExt.unknown200    0 → dropped            1 (EMITTED)
//
// The last row is the one worth staring at: `unknown200` is the ONLY field whose
// presence differs at the top level, and it is zero for group / one for private.
// A copy-paste between the two builders therefore produces a message that is
// 3 bytes wrong on one side and silently accepted on the other.
//
// Note also that the group builder's `checkKey` and the private builder's `sha1`
// land in the SAME field (fileEntry field 300). They are different values: the
// group one comes from the `0x6d6_0` response, the private one is computed
// locally. Passing either into the other's position compiles and uploads.

import { ProtoWriter } from "../oidb/wire.js";

// ===========================================================================
// Field numbers
// ===========================================================================

/** `FileUploadExt` — the top-level message. */
export const FileUploadExtField = {
  unknown1: 1,
  unknown2: 2,
  unknown3: 3,
  /** The real payload. Tag `a2 06`. */
  entry: 100,
  /** `0` for group (dropped), `1` for private (emitted). Tag `c0 0c`. */
  unknown200: 200,
} as const;

/** `FileUploadEntry` — all five hundred-based. */
export const FileUploadEntryField = {
  busiBuff: 100,
  fileEntry: 200,
  clientInfo: 300,
  fileNameInfo: 400,
  host: 500,
} as const;

/**
 * `FileUploadBusiInfo` — note field 1 then a jump to 100.
 *
 * `busId` is the ONLY single-digit field in the whole message set, which is why
 * `a2 06 14 08 66` (entry → busiBuff len 20 → field 1 = 102) looks like a
 * mistake and is not.
 */
export const FileUploadBusiInfoField = {
  busId: 1,
  senderUin: 100,
  receiverUin: 200,
  /** 400, not 300 — the generated writer emits `80 19` (`:289033`). */
  groupCode: 400,
} as const;

/** `FileUploadFileEntry`. */
export const FileUploadFileEntryField = {
  fileSize: 100,
  md5: 200,
  checkKey: 300,
  md5S2: 400,
  fileId: 600,
  uploadKey: 700,
} as const;

/** `FileUploadClientInfo`. */
export const FileUploadClientInfoField = {
  clientType: 100,
  appId: 200,
  terminalType: 300,
  clientVer: 400,
  unknown: 600,
} as const;

/** `FileUploadNameInfo`. */
export const FileUploadNameInfoField = { fileName: 100 } as const;

/** `FileUploadHostConfig` — a repeated `FileUploadHost` under field 200. */
export const FileUploadHostConfigField = { hosts: 200 } as const;

/** `FileUploadHost`. */
export const FileUploadHostField = { url: 1, port: 2 } as const;

/** `FileUploadUrl` — field 1 first because `unknown` sorts before `host` in the writer. */
export const FileUploadUrlField = { unknown: 1, host: 2 } as const;

// ===========================================================================
// The constant block, in one place
// ===========================================================================

/**
 * The `clientInfo` the reference hard-codes for both file paths (`:289671`,
 * `:289708`). Not account data, not a build constant — literal values.
 */
export const FILE_UPLOAD_CLIENT_INFO = {
  clientType: 3,
  appId: "100",
  terminalType: 3,
  clientVer: "1.1.1",
  unknown: 4,
} as const;

/** `busId` for a group file upload. Private files omit `busiBuff.busId` entirely. */
export const GROUP_FILE_UPLOAD_BUS_ID = 102;

// ===========================================================================
// Types
// ===========================================================================

/** `FileUploadUrl` — field 1 is a marker, field 2 the address. */
export interface FileUploadUrl {
  /** Always `1` from both builders; `0` would drop the field. */
  unknown?: number;
  /** Dotted quad, or — for the private path — whatever the OIDB response said. */
  host?: string;
}

/** `FileUploadHost` — one address plus its port. */
export interface FileUploadHost {
  url?: FileUploadUrl;
  port?: number;
}

/** `FileUploadHostConfig`. */
export interface FileUploadHostConfig {
  hosts?: FileUploadHost[];
}

/** `FileUploadBusiInfo` — who is uploading what, and to which group. */
export interface FileUploadBusiInfo {
  busId?: number;
  senderUin?: bigint | number;
  receiverUin?: bigint | number;
  /**
   * The group number, in field **400**.
   *
   * Zero is dropped by the encoder, which is how the private builder gets a
   * `busiBuff` that is `{senderUin}` alone.
   */
  groupCode?: bigint | number;
}

/**
 * `FileUploadFileEntry` — the file's identity on the server.
 *
 * `md5` / `checkKey` / `md5S2` / `uploadKey` are **raw digest bytes**. See the
 * module comment.
 */
export interface FileUploadFileEntry {
  fileSize?: bigint | number;
  /** 16 raw md5 bytes. NOT a hex string. */
  md5?: Uint8Array;
  /** Group: the response's `checkKey`. Private: the file's own 20-byte sha1. */
  checkKey?: Uint8Array;
  /** The same 16 md5 bytes again — the server checks both slots. */
  md5S2?: Uint8Array;
  fileId?: string;
  uploadKey?: Uint8Array;
}

/** `FileUploadClientInfo`. */
export interface FileUploadClientInfo {
  clientType?: number;
  appId?: string;
  terminalType?: number;
  clientVer?: string;
  unknown?: number;
}

/** `FileUploadNameInfo`. */
export interface FileUploadNameInfo {
  fileName?: string;
}

/** `FileUploadEntry` — the one field `FileUploadExt` really carries. */
export interface FileUploadEntry {
  busiBuff?: FileUploadBusiInfo;
  fileEntry?: FileUploadFileEntry;
  clientInfo?: FileUploadClientInfo;
  fileNameInfo?: FileUploadNameInfo;
  host?: FileUploadHostConfig;
}

/** `FileUploadExt`. */
export interface FileUploadExt {
  unknown1?: number;
  unknown2?: number;
  unknown3?: number;
  entry?: FileUploadEntry;
  unknown200?: number;
}

// ===========================================================================
// Encoding
// ===========================================================================

function encodeBusiInfo(info: FileUploadBusiInfo): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(FileUploadBusiInfoField.busId, info.busId);
  w.uint64(FileUploadBusiInfoField.senderUin, info.senderUin);
  w.uint64(FileUploadBusiInfoField.receiverUin, info.receiverUin);
  // Order matters for byte-exactness: 1 → 100 → 200 → 400 is ascending, which is
  // what `__write_FileUploadBusiInfo` emits (`:288997-289035`).
  w.uint64(FileUploadBusiInfoField.groupCode, info.groupCode);
  return w.finish();
}

function encodeFileEntry(entry: FileUploadFileEntry): Uint8Array {
  const w = new ProtoWriter();
  w.uint64(FileUploadFileEntryField.fileSize, entry.fileSize);
  w.bytes(FileUploadFileEntryField.md5, entry.md5);
  w.bytes(FileUploadFileEntryField.checkKey, entry.checkKey);
  w.bytes(FileUploadFileEntryField.md5S2, entry.md5S2);
  w.string(FileUploadFileEntryField.fileId, entry.fileId);
  w.bytes(FileUploadFileEntryField.uploadKey, entry.uploadKey);
  return w.finish();
}

function encodeClientInfo(info: FileUploadClientInfo): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(FileUploadClientInfoField.clientType, info.clientType);
  w.string(FileUploadClientInfoField.appId, info.appId);
  w.uint32(FileUploadClientInfoField.terminalType, info.terminalType);
  w.string(FileUploadClientInfoField.clientVer, info.clientVer);
  w.uint32(FileUploadClientInfoField.unknown, info.unknown);
  return w.finish();
}

function encodeNameInfo(info: FileUploadNameInfo): Uint8Array {
  const w = new ProtoWriter();
  w.string(FileUploadNameInfoField.fileName, info.fileName);
  return w.finish();
}

function encodeUrl(url: FileUploadUrl): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(FileUploadUrlField.unknown, url.unknown);
  w.string(FileUploadUrlField.host, url.host);
  return w.finish();
}

function encodeHost(host: FileUploadHost): Uint8Array {
  const w = new ProtoWriter();
  // `_f0 != null` — an EMPTY `url` message is still emitted (`:289508`). `message()`
  // reproduces that; `bytes()` would drop it and change the length prefix chain.
  if (host.url) w.message(FileUploadHostField.url, encodeUrl(host.url));
  w.uint32(FileUploadHostField.port, host.port);
  return w.finish();
}

function encodeHostConfig(config: FileUploadHostConfig): Uint8Array {
  const w = new ProtoWriter();
  // Repeated message, non-packed, one tag per element (`:289458-289483`).
  for (const host of config.hosts ?? []) {
    w.message(FileUploadHostConfigField.hosts, encodeHost(host));
  }
  return w.finish();
}

function encodeEntry(entry: FileUploadEntry): Uint8Array {
  const w = new ProtoWriter();
  // All five use the `!= null` rule, so a present-but-empty nested message is
  // still emitted. Both builders always supply all five.
  if (entry.busiBuff) {
    w.message(FileUploadEntryField.busiBuff, encodeBusiInfo(entry.busiBuff));
  }
  if (entry.fileEntry) {
    w.message(FileUploadEntryField.fileEntry, encodeFileEntry(entry.fileEntry));
  }
  if (entry.clientInfo) {
    w.message(FileUploadEntryField.clientInfo, encodeClientInfo(entry.clientInfo));
  }
  if (entry.fileNameInfo) {
    w.message(FileUploadEntryField.fileNameInfo, encodeNameInfo(entry.fileNameInfo));
  }
  if (entry.host) {
    w.message(FileUploadEntryField.host, encodeHostConfig(entry.host));
  }
  return w.finish();
}

/** Encode a `FileUploadExt`. Field order is the generated writer's: 1, 2, 3, 100, 200. */
export function encodeFileUploadExt(ext: FileUploadExt): Uint8Array {
  const w = new ProtoWriter();
  w.uint32(FileUploadExtField.unknown1, ext.unknown1);
  w.uint32(FileUploadExtField.unknown2, ext.unknown2);
  w.uint32(FileUploadExtField.unknown3, ext.unknown3);
  if (ext.entry) w.message(FileUploadExtField.entry, encodeEntry(ext.entry));
  w.uint32(FileUploadExtField.unknown200, ext.unknown200);
  return w.finish();
}

// ===========================================================================
// The two builders
// ===========================================================================

/** Everything the group builder needs, after the `0x6d6_0` response. */
export interface GroupFileUploadExtParams {
  /** The bot's own QQ number. Field `busiBuff.senderUin` (100). */
  senderUin: number | bigint;
  /** The group number. Fills BOTH `receiverUin` (200) and `groupCode` (400). */
  groupId: number | bigint;
  fileName: string;
  fileSize: number | bigint;
  /** 16 raw md5 bytes. */
  md5: Uint8Array;
  /** `upload.fileId` from the `0x6d6_0` response. */
  fileId: string;
  /** `upload.fileKey` from the response; may be empty. */
  uploadKey: Uint8Array;
  /** `upload.checkKey` from the response; may be empty. */
  checkKey: Uint8Array;
  /** `upload.uploadIp || upload.serverDns`, resolved by the caller. */
  uploadHost: string;
  uploadPort: number;
}

/**
 * `buildGroupFileUploadExt` — reference/index.mjs:289652.
 *
 * Parameter order matches the reference's exactly, so a reader diffing the two
 * does not have to re-derive which argument is which. Note `checkKey` sits
 * between `uploadKey` and `uploadHost` — the reference's order, not the wire
 * order (the wire puts `checkKey` 300 before `md5S2` 400).
 */
export function buildGroupFileUploadExt(params: GroupFileUploadExtParams): Uint8Array {
  return encodeFileUploadExt({
    unknown1: 100,
    unknown2: 1,
    // `unknown3` is UNSET for the group path — the reference omits the key
    // entirely (`:289653-289688`), so the encoder drops the field.
    entry: {
      busiBuff: {
        busId: GROUP_FILE_UPLOAD_BUS_ID,
        senderUin: BigInt(params.senderUin),
        receiverUin: BigInt(params.groupId),
        groupCode: BigInt(params.groupId),
      },
      fileEntry: {
        // The reference clamps negatives to 0 (`:289664`). A negative file size
        // means the caller misread the stat, and 0 is what the server can accept;
        // throwing here would happen after the file record already exists.
        fileSize: BigInt(Math.max(0, Number(params.fileSize))),
        md5: params.md5,
        // md5 and md5S2 are the SAME bytes, both slots. Not a copy-paste bug.
        md5S2: params.md5,
        checkKey: params.checkKey,
        fileId: params.fileId,
        uploadKey: params.uploadKey,
      },
      clientInfo: { ...FILE_UPLOAD_CLIENT_INFO },
      fileNameInfo: { fileName: params.fileName },
      host: { hosts: [{ url: { host: params.uploadHost, unknown: 1 }, port: params.uploadPort }] },
    },
    unknown200: 0,
  });
}

/** Everything the private builder needs, after the `0xe37_1700` response. */
export interface PrivateFileUploadExtParams {
  senderUin: number | bigint;
  fileName: string;
  fileSize: number | bigint;
  /** 16 raw md5 bytes. */
  md5: Uint8Array;
  /** 20 raw sha1 bytes — computed locally, NOT taken from the response. */
  sha1: Uint8Array;
  /** `upload.uuid` from the `0xe37_1700` response. */
  fileId: string;
  /** `upload.mediaPlatformUploadKey ?? upload.uploadKey`; may be empty. */
  uploadKey: Uint8Array;
  uploadHost: string;
  uploadPort: number;
}

/**
 * `buildPrivateFileUploadExt` — reference/index.mjs:289690.
 *
 * Differs from the group builder in four places; see the module comment's table.
 * The two that bite:
 *
 *   1. `checkKey` is the file's own **sha1**, passed as the builder's `sha1`
 *      argument. The group path takes it from the server response instead.
 *   2. `unknown200` is **1** (emitted) and `busiBuff` carries only `senderUin` —
 *      `receiverUin` and `groupCode` are literal `0n` and drop out.
 */
export function buildPrivateFileUploadExt(params: PrivateFileUploadExtParams): Uint8Array {
  return encodeFileUploadExt({
    unknown1: 100,
    unknown2: 1,
    // `unknown3: 0` — present in the reference's object literal (`:289724`) but
    // dropped by the `!== 0` rule. Reproduced as an explicit 0 rather than left
    // out, so the two builders' shapes stay identical to the reference's.
    unknown3: 0,
    entry: {
      busiBuff: {
        // `busId` is NOT set for the private path — there is no group bus here.
        senderUin: BigInt(params.senderUin),
        receiverUin: 0n,
        groupCode: 0n,
      },
      fileEntry: {
        fileSize: BigInt(Math.max(0, Number(params.fileSize))),
        md5: params.md5,
        md5S2: params.md5,
        // The file's own sha1, not a server-issued key.
        checkKey: params.sha1,
        fileId: params.fileId,
        uploadKey: params.uploadKey,
      },
      clientInfo: { ...FILE_UPLOAD_CLIENT_INFO },
      fileNameInfo: { fileName: params.fileName },
      host: { hosts: [{ url: { host: params.uploadHost, unknown: 1 }, port: params.uploadPort }] },
    },
    unknown200: 1,
  });
}

// ===========================================================================
// The highway cmdIds, stated once
// ===========================================================================

/**
 * The highway `cmdId` for each file transfer, from the reference's call sites.
 *
 * Group is `:289790`, private is `:289859`. Both are in the chunk head's
 * `msgBaseHead.commandId`, NOT the OIDB envelope. They are also NOT the NTV2
 * rich-media ids in `pipeline.ts`'s `HIGHWAY_CMD_IDS`.
 */
export const FILE_UPLOAD_HIGHWAY_CMD_IDS = {
  group: 71,
  private: 95,
} as const;
