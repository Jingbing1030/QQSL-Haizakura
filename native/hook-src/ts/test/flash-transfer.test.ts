// `FlashTransferApi` — the read-only half, driven against a scripted OIDB server.
//
// ---------------------------------------------------------------------------
// What this file pins, and why each thing needs pinning
// ---------------------------------------------------------------------------
// The slice is thin (nearly every method is one `Spec.invoke`), so the failure modes
// are narrow and specific:
//
//   1. **The wrong command or sub-command.** `0x9427` is the ONE flash command with
//      sub-command **0** and `uinForm: true`; ten of the twelve neighbours are sub 1
//      with no `reserved` bit. A copy-paste that assumed "sub 1 everywhere" produces a
//      request the server routes somewhere plausible, so `wireName` is asserted for
//      every sending method.
//
//   2. **The wrong field number.** Every assertion here compares the request body to
//      bytes assembled by THIS FILE from `ProtoWriter` with **literal** field numbers
//      and literal comments — never to `spec.encodeBody(spec.serialize(...))`, which
//      would be the implementation asserting on itself. The one exception is the
//      module-scope sequence counter in `0x12a9`, which is pinned with
//      `resetFlashSequence` so the expected bytes are deterministic.
//
//   3. **A field the action layer renames.** `flashFileInfoToJson` maps
//      `filesetUuid` → `fileset_id`, `fileSize` → `size` (NOT `file_size`), etc. A
//      slice that answered `undefined` for any of those would still typecheck
//      (`FlashFileInfo` is all required) but would emit `undefined` into the OneBot
//      JSON. So the action layer's OWN helper is run over the slice's output here.
//
//   4. **`fileTypeCode`'s two numbers.** `typeCode` (card class, three possible
//      values) and `formatCode` (icon, ~26 values) disagree on nearly every
//      extension. Sharing one table would put a card class where an icon belongs,
//      which is invisible until a peer renders the wrong glyph.
//
// ---------------------------------------------------------------------------
// Why a fake client rather than a socket
// ---------------------------------------------------------------------------
// Nothing here may touch the network. The fake records `(wireName, body)` and answers
// canned bytes, which is what lets a test assert the exact request AND feed back a
// specific response.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { Bridge, MemoryIdentity } from "../src/bridge/bridge.js";
import type { PacketClient, PacketSendResult } from "../src/bridge/context.js";
import { FlashTransferApi } from "../src/bridge/apis/flash-transfer.js";
import { oidbWireName } from "../src/oidb/envelope.js";
import { ProtoReader, ProtoWriter } from "../src/oidb/wire.js";
import { resetFlashSequence } from "../src/oidb/services/0x12a9.js";
import { flashFileInfoToJson } from "../src/onebot/actions/extended-helpers.js";

const SELF_UIN = 10001;
const SELF_UID = "u_self0000000000000001";
const PEER_UIN = 20002;
const PEER_UID = "u_peer0000000000000002";

const FILESET_UUID = "11111111-2222-3333-4444-555555555555";
const FILE_UUID = "66666666-7777-8888-9999-aaaaaaaaaaaa";
const FILE_ID = "FILEID-BASE64URL-_abc";
const FILE_NAME = "报告.pdf";

/**
 * The URL as it appears INSIDE the `0x12a9` response blob.
 *
 * The blob is raw bytes, not a message; `parseFlashDownloadUrl` scans it with
 * `[\x20-\x7e]*` and appends `&${rkeyMatch}` — where the match already starts with
 * `rkey=`. So the value the caller receives ends `...&rkey=...` a second time, and
 * stripping the prefix would produce a signed-looking URL that does not work. Both
 * constants are kept so the quirk is visible rather than baked into one string.
 */
const BLOB_URL = "https://multimedia.qfile.qq.com/download?appid=14901&x=1&rkey=RRRR";
/** What `getFlashFileUrl` / `downloadFileset` actually answer: `BLOB_URL` + `&rkey=…`. */
const DOWNLOAD_URL = `${BLOB_URL}&rkey=RRRR`;

// ===========================================================================
// The fake transport
// ===========================================================================

interface SentPacket {
  wireName: string;
  body: Uint8Array;
}

/**
 * A scripted OIDB server.
 *
 * `answer` queues a raw response ENVELOPE for one wire name. An unqueued name is a
 * transport failure (`gotResponse: false`) rather than a synthetic success: a method
 * whose request this file forgot to script must fail loudly, not decode an empty body
 * into a plausible default.
 */
class FakePacketClient implements PacketClient {
  readonly sent: SentPacket[] = [];
  readonly #answers = new Map<string, Uint8Array>();

  answer(wireName: string, envelope: Uint8Array): void {
    this.#answers.set(wireName, envelope);
  }

  async sendPacket(wireName: string, body: Uint8Array): Promise<PacketSendResult> {
    // Normalise to a plain `Uint8Array` slice. `Bridge.sendRawPacket` copies the request
    // through `Buffer.from(body)` first, and `Buffer` is a `Uint8Array` SUBCLASS — so
    // `assert.deepEqual` against a plain `Uint8Array` fails on the prototype even when
    // every byte matches. The copy keeps the assertion about the bytes.
    this.sent.push({ wireName, body: Uint8Array.from(body) });
    const response = this.#answers.get(wireName);
    if (response === undefined) {
      return { success: false, gotResponse: false, errorMessage: `scripted: no answer for ${wireName}` };
    }
    return { success: true, gotResponse: true, errorCode: 0, responseData: response };
  }

  /** The single packet sent to `wireName`; throws if the count is not exactly one. */
  only(wireName: string): SentPacket {
    const matches = this.sent.filter((packet) => packet.wireName === wireName);
    assert.equal(matches.length, 1, `expected exactly one ${wireName}, saw ${matches.length}`);
    return matches[0] as SentPacket;
  }
}

function makeBridge(client: FakePacketClient): Bridge {
  const identity = new MemoryIdentity(String(SELF_UIN), "bot");
  identity.setSelfProfile({ uin: SELF_UIN, uid: SELF_UID, nickname: "bot" } as never);
  identity.rememberFriends([{ uin: PEER_UIN, uid: PEER_UID, nickname: "peer", remark: "" }]);
  const bridge = new Bridge(identity);
  bridge.bindPid(1, client);
  return bridge;
}

/**
 * Compare two byte sequences by VALUE.
 *
 * `assert.deepEqual` compares prototypes, and `Bridge.sendRawPacket` copies the request
 * through `Buffer.from(body)` before handing it to the client — so the recorded body is
 * a `Buffer` while the expected value is a plain `Uint8Array`. Both are correct; only
 * the container type differs, so normalising through `Buffer.from` keeps the assertion
 * about the bytes.
 */
function assertBytes(actual: Uint8Array, expected: Uint8Array, label?: string): void {
  assert.equal(Buffer.from(actual).toString("hex"), Buffer.from(expected).toString("hex"), label);
}

// ===========================================================================
// Independent protobuf assembly
// ===========================================================================
//
// Every number below is a LITERAL taken from the reference's `__write_*` tags, with
// the message it belongs to named in a comment. Deliberately not imported from
// `oidb/services/`: importing the spec's own constants would let a wrong field number
// agree with itself.

/** `OidbBase` envelope: 1 command, 2 subCommand, 3 errorCode, 4 body, 5 errorMsg, 12 reserved. */
function envelope(command: number, subCommand: number, body: Uint8Array, reserved = 0): Uint8Array {
  return new ProtoWriter()
    .uint32(1, command)
    .uint32(2, subCommand)
    .uint32(3, 0)
    .message(4, body)
    .string(5, "")
    .uint32(12, reserved)
    .finish();
}

/**
 * `FlashFileEntry` — what `0x93d3_1` repeats at field 1.
 *
 *   1 filesetUuid, 2 fileName, 3 origName, 4 fileType, 5 fileSize(u64),
 *   8 uploadUrlWrap{1 uploadUrl}, 9 fileIdWrap{1 fileId, 2 download{1 field1, 2 downloadUrl}}
 *
 * Fields 6 and 7 are unused; a port that read `fileSize` off 6 would get the
 * `uploadUrlWrap` length instead.
 */
function fileEntry(options: {
  filesetUuid?: string;
  fileName?: string;
  origName?: string;
  fileType?: number;
  fileSize?: bigint;
  uploadUrl?: string;
  fileId?: string;
  thumbnailUrl?: string;
}): Uint8Array {
  const download = new ProtoWriter()
    .uint32(1, 14903) // downloadInfo.field1 — the thumbnail appid
    .string(2, options.thumbnailUrl ?? "")
    .finish();
  const fileIdWrap = new ProtoWriter()
    .string(1, options.fileId ?? "")
    .message(2, download)
    .finish();
  const uploadUrlWrap = new ProtoWriter().string(1, options.uploadUrl ?? "").finish();
  return new ProtoWriter()
    .string(1, options.filesetUuid ?? "")
    .string(2, options.fileName ?? "")
    .string(3, options.origName ?? "")
    .uint32(4, options.fileType ?? 0)
    .uint64(5, options.fileSize ?? 0)
    .message(8, uploadUrlWrap)
    .message(9, fileIdWrap)
    .finish();
}

/** `FlashListFilesetsResp` / `FlashGetDetailResp`: `repeated FlashFileEntry entries = 1`. */
function entryList(entries: readonly Uint8Array[]): Uint8Array {
  return new ProtoWriter().repeatedMessage(1, [...entries]).finish();
}

/**
 * `FlashGetDownloadUrlResp`: `entry` at field 1 → `FlashDownloadEntry`.
 *
 *   FlashDownloadEntry       2 field2, 3 fileInfo(repeated), 4 field4, 5 field5
 *   FlashDownloadFileInfo    1 filesetUuid, 2 fileUuid, 5 field5, 6 field6(fileIndex),
 *                            7 field7, 8 fileName, 9 origName, 11 fileSize,
 *                            13 downloadInfo, 14 mainFile{1 fileId, 3 field3}
 *
 * Note `fileIndex` is field **6**, and `fileName` is field **8** — the message skips
 * 3, 4 and 10 entirely, so "the nth declared field" gives garbage.
 */
function downloadEntry(
  files: readonly {
    filesetUuid?: string;
    fileUuid?: string;
    fileIndex?: number;
    fileName?: string;
    fileSize?: bigint;
    fileId?: string;
    thumbnailUrl?: string;
  }[],
): Uint8Array {
  const fileInfos = files.map((file) => {
    const downloadInfo = new ProtoWriter()
      .string(1, "thumb-file-id")
      .message(
        2,
        new ProtoWriter()
          .uint32(1, 14903)
          .string(2, file.thumbnailUrl ?? "")
          .finish(),
      )
      .finish();
    const mainFile = new ProtoWriter()
      .string(1, file.fileId ?? "")
      .uint32(3, 0)
      .finish();
    return new ProtoWriter()
      .string(1, file.filesetUuid ?? "")
      .string(2, file.fileUuid ?? "")
      .uint32(5, 0)
      .uint32(6, file.fileIndex ?? 1)
      .uint32(7, 0)
      .string(8, file.fileName ?? "")
      .string(9, file.fileName ?? "")
      .uint64(11, file.fileSize ?? 0n)
      .message(13, downloadInfo)
      .message(14, mainFile)
      .finish();
  });
  return new ProtoWriter()
    .message(
      1,
      new ProtoWriter()
        .uint32(2, 0)
        .repeatedMessage(3, fileInfos)
        .string(4, "")
        .uint32(5, 0)
        .finish(),
    )
    .finish();
}

/**
 * `FlashDownloadResp`: `1 head -> FlashApplyHeadResp`, `3 body -> **bytes**`.
 *
 * The body is an opaque blob holding the URL as text, not a message — the spec's
 * `deserialize` scans it as latin1. Surrounding the URL with non-printable bytes is
 * deliberate: it proves the `[\x20-\x7e]` range in the path regex is load-bearing.
 */
function downloadResp(url: string): Uint8Array {
  const blob = new Uint8Array([0x00, 0x01, ...Buffer.from(url, "latin1"), 0x02]);
  const head = new ProtoWriter()
    .message(1, new ProtoWriter().uint32(1, 0).uint32(2, 200).finish())
    .string(3, "")
    .finish();
  return new ProtoWriter().message(1, head).bytes(3, blob).finish();
}

// ===========================================================================
// 1. `fileTypeCode` — the two tables
// ===========================================================================

test("fileTypeCode maps extensions onto TWO different numbers", () => {
  const api = FlashTransferApi;

  // A .png is `typeCode: 7` (the card's "media" class) but `formatCode: 26` (the
  // image icon). One table cannot serve both, and this is the assertion that proves
  // the two are not accidentally equal.
  assert.deepEqual(api.fileTypeCode("photo.png"), { typeCode: 7, formatCode: 26 });
  // zip is the one extension where `typeCode` is special-cased to 6.
  assert.deepEqual(api.fileTypeCode("bundle.zip"), { typeCode: 6, formatCode: 4 });
  // Every other archive is typeCode 2 / formatCode 4.
  assert.deepEqual(api.fileTypeCode("bundle.7z"), { typeCode: 2, formatCode: 4 });
  assert.deepEqual(api.fileTypeCode("bundle.tar"), { typeCode: 2, formatCode: 4 });

  // Non-archive, non-media: typeCode falls to 7, formatCode to its own entry.
  assert.deepEqual(api.fileTypeCode("doc.pdf"), { typeCode: 7, formatCode: 9 });
  assert.deepEqual(api.fileTypeCode("clip.mp4"), { typeCode: 7, formatCode: 2 });
  assert.deepEqual(api.fileTypeCode("song.flac"), { typeCode: 7, formatCode: 1 });
  assert.deepEqual(api.fileTypeCode("app.apk"), { typeCode: 7, formatCode: 5 });
  assert.deepEqual(api.fileTypeCode("model.onnx"), { typeCode: 7, formatCode: 15 });
  assert.deepEqual(api.fileTypeCode("font.ttf"), { typeCode: 7, formatCode: 16 });
  assert.deepEqual(api.fileTypeCode("installer.exe"), { typeCode: 7, formatCode: 27 });
});

test("fileTypeCode falls back to the unknown pair, not to zero", () => {
  // An extension nobody listed must still produce a VALID icon (11), because 0 is not
  // "unknown" — it is "no icon", which a client renders as nothing.
  for (const name of ["archive.unknownext", "no-dot-at-all", "trailingdot."]) {
    assert.deepEqual(
      FlashTransferApi.fileTypeCode(name),
      { typeCode: 7, formatCode: 11 },
      name,
    );
  }
});

test("fileTypeCode lower-cases and takes only the LAST dot segment", () => {
  // Upper case must not miss the table.
  assert.deepEqual(FlashTransferApi.fileTypeCode("PHOTO.PNG"), { typeCode: 7, formatCode: 26 });
  // `archive.tar.gz` → `gz`, because the regex is `/\.([^.]+)$/`. `gz` is in the
  // archive set, so this is typeCode 2 (not 6, which is zip-only) / formatCode 4.
  assert.deepEqual(FlashTransferApi.fileTypeCode("archive.tar.gz"), { typeCode: 2, formatCode: 4 });
  // A dotted directory is not the extension.
  assert.deepEqual(FlashTransferApi.fileTypeCode("dir.name/file.pdf"), { typeCode: 7, formatCode: 9 });
});

// ===========================================================================
// 2. getFilesetInfo / getFlashFileList — one command, two members
// ===========================================================================

test("getFilesetInfo sends 0x93d3_1 with the uuid and a constant field2=7", async () => {
  const client = new FakePacketClient();
  // The RESPONSE body is `repeated FlashFileEntry entries = 1`, not the request echoed
  // back — feeding the request body would make the entry decoder read `field2 = 7` as
  // an entry and fail on bounds.
  client.answer(
    "OidbSvcTrpcTcp.0x93d3_1",
    envelope(0x93d3, 1, entryList([fileEntry({ filesetUuid: FILESET_UUID })])),
  );
  const bridge = makeBridge(client);

  await new FlashTransferApi(bridge).getFilesetInfo(FILESET_UUID);

  // `FlashGetDetailReq`: 1 filesetUuid, 2 field2 = 7 (a CONSTANT, not a parameter).
  assert.deepEqual(
    client.only("OidbSvcTrpcTcp.0x93d3_1").body,
    envelope(0x93d3, 1, new ProtoWriter().string(1, FILESET_UUID).uint32(2, 7).finish()),
  );
});

test("getFilesetInfo flattens every entry field, including the nested wraps", async () => {
  const client = new FakePacketClient();
  client.answer(
    "OidbSvcTrpcTcp.0x93d3_1",
    envelope(
      0x93d3,
      1,
      entryList([
        fileEntry({
          filesetUuid: FILESET_UUID,
          fileName: FILE_NAME,
          origName: "original.pdf",
          fileType: 1,
          fileSize: 1234n,
          uploadUrl: "https://qfile.qq.com/q/SHARECODE",
          fileId: FILE_ID,
          thumbnailUrl: "https://thumb.example/14903",
        }),
      ]),
    ),
  );
  const bridge = makeBridge(client);

  const list = await new FlashTransferApi(bridge).getFilesetInfo(FILESET_UUID);

  assert.equal(list.length, 1);
  const row = list[0]!;
  assert.equal(row.filesetUuid, FILESET_UUID);
  assert.equal(row.fileName, FILE_NAME);
  assert.equal(row.origName, "original.pdf");
  // `Number(...)` on the u64, not a BigInt — the action layer declares `number`.
  assert.equal(row.fileSize, 1234);
  assert.equal(typeof row.fileSize, "number");
  assert.equal(row.shareUrl, "https://qfile.qq.com/q/SHARECODE");
  assert.equal(row.fileId, FILE_ID);
  // `downloadUrl` is the THUMBNAIL — the main file's link only comes from 0x12a9.
  assert.equal(row.downloadUrl, "https://thumb.example/14903");
});

test("getFilesetInfo defaults every absent field to \"\"/0, never undefined", async () => {
  // The decoder answers `null` for an absent field, and `entryToInfo` must convert
  // that. Emitting `undefined` would put a literal `undefined` in the OneBot JSON.
  const client = new FakePacketClient();
  client.answer("OidbSvcTrpcTcp.0x93d3_1", envelope(0x93d3, 1, entryList([new Uint8Array(0)])));
  const bridge = makeBridge(client);

  const [row] = await new FlashTransferApi(bridge).getFilesetInfo(FILESET_UUID);

  assert.deepEqual(row, {
    filesetUuid: "",
    fileName: "",
    origName: "",
    fileSize: 0,
    shareUrl: "",
    fileId: "",
    downloadUrl: "",
  });
});

test("getFlashFileList aliases getFilesetInfo — same command, same rows", async () => {
  const client = new FakePacketClient();
  client.answer(
    "OidbSvcTrpcTcp.0x93d3_1",
    envelope(0x93d3, 1, entryList([fileEntry({ filesetUuid: FILESET_UUID, fileName: FILE_NAME })])),
  );
  const bridge = makeBridge(client);

  const list = await new FlashTransferApi(bridge).getFlashFileList(FILESET_UUID);

  // Exactly one packet: the alias must not fan out into a second request.
  assert.equal(client.sent.length, 1);
  assert.equal(client.sent[0]!.wireName, "OidbSvcTrpcTcp.0x93d3_1");
  assert.equal(list[0]!.fileName, FILE_NAME);
});

// ===========================================================================
// 3. listFilesets — 0x93d2_1 with the reference's pagination defaults
// ===========================================================================

test("listFilesets sends 0x93d2_1 with field1=3 / field3=10 and an empty field2", async () => {
  const client = new FakePacketClient();
  client.answer("OidbSvcTrpcTcp.0x93d2_1", envelope(0x93d2, 1, entryList([])));
  const bridge = makeBridge(client);

  const list = await new FlashTransferApi(bridge).listFilesets();

  assert.deepEqual(list, []);
  // `field2` is the empty STRING, so its tag is dropped entirely — the body is exactly
  // two varint fields. A port that passed a page token through would change these bytes.
  assert.deepEqual(
    client.only("OidbSvcTrpcTcp.0x93d2_1").body,
    envelope(0x93d2, 1, new ProtoWriter().uint32(1, 3).uint32(3, 10).finish()),
  );
});

test("listFilesets maps every row through entryToInfo", async () => {
  const client = new FakePacketClient();
  client.answer(
    "OidbSvcTrpcTcp.0x93d2_1",
    envelope(
      0x93d2,
      1,
      entryList([
        fileEntry({ filesetUuid: "a", fileName: "a.pdf", fileSize: 1n }),
        fileEntry({ filesetUuid: "b", fileName: "b.pdf", fileSize: 2n }),
      ]),
    ),
  );
  const bridge = makeBridge(client);

  const list = await new FlashTransferApi(bridge).listFilesets();

  assert.deepEqual(
    list.map((row) => [row.filesetUuid, row.fileName, row.fileSize]),
    [
      ["a", "a.pdf", 1],
      ["b", "b.pdf", 2],
    ],
  );
});

// ===========================================================================
// 4. getShareLink — a string, read out of uploadUrlWrap
// ===========================================================================

test("getShareLink answers the uploadUrl STRING, not a wrapper object", async () => {
  // The declaration used to say `Record<string, unknown>`, which was a defect: the
  // reference's `returnsSchema` is `{type: "string"}` and `get_share_link` passes the
  // value straight through. A wrapper here would change the action's response.
  const client = new FakePacketClient();
  client.answer(
    "OidbSvcTrpcTcp.0x93d3_1",
    envelope(
      0x93d3,
      1,
      entryList([
        fileEntry({ filesetUuid: "a", uploadUrl: "" }),
        fileEntry({ filesetUuid: "b", uploadUrl: "https://qfile.qq.com/q/FIRST" }),
        fileEntry({ filesetUuid: "c", uploadUrl: "https://qfile.qq.com/q/SECOND" }),
      ]),
    ),
  );
  const bridge = makeBridge(client);

  const link = await new FlashTransferApi(bridge).getShareLink(FILESET_UUID);

  assert.equal(typeof link, "string");
  // `.find(entry => entry.uploadUrlWrap?.uploadUrl)` — the FIRST non-empty one, so the
  // empty first entry is skipped rather than answering "".
  assert.equal(link, "https://qfile.qq.com/q/FIRST");
});

test("getShareLink answers \"\" when no entry carries a share url", async () => {
  const client = new FakePacketClient();
  client.answer(
    "OidbSvcTrpcTcp.0x93d3_1",
    envelope(0x93d3, 1, entryList([fileEntry({ filesetUuid: "a" })])),
  );
  const bridge = makeBridge(client);

  assert.equal(await new FlashTransferApi(bridge).getShareLink(FILESET_UUID), "");
});

// ===========================================================================
// 5. deleteFlashFile / renameFlashFile — the two void writes
// ===========================================================================

test("deleteFlashFile sends 0x9407_1 with filesetUuid=1, field2=\"\", field3=7", async () => {
  const client = new FakePacketClient();
  client.answer("OidbSvcTrpcTcp.0x9407_1", envelope(0x9407, 1, new Uint8Array(0)));
  const bridge = makeBridge(client);

  const result = await new FlashTransferApi(bridge).deleteFlashFile(FILESET_UUID);

  assert.equal(result, undefined, "the response carries nothing, so the method answers void");
  assert.deepEqual(
    client.only("OidbSvcTrpcTcp.0x9407_1").body,
    envelope(
      0x9407,
      1,
      new ProtoWriter()
        .string(1, FILESET_UUID) // filesetUuid
        .string(2, "") // field2 — empty, so the tag is dropped
        .uint32(3, 7) // field3 — a constant
        .finish(),
    ),
  );
});

test("renameFlashFile sends 0x9427 SUB 0 with uinForm — the one-off in this family", async () => {
  // ⚠️ Sub-command **0** and `reserved: 1`. Every neighbouring flash command is sub 1
  // with no reserved bit, so "sub 1 everywhere" produces a request the server accepts
  // and routes to a different handler.
  const client = new FakePacketClient();
  client.answer("OidbSvcTrpcTcp.0x9427_0", envelope(0x9427, 0, new Uint8Array(0), 1));
  const bridge = makeBridge(client);

  const result = await new FlashTransferApi(bridge).renameFlashFile(FILESET_UUID, "新名字");

  assert.equal(result, undefined);
  const sent = client.only("OidbSvcTrpcTcp.0x9427_0");
  assert.deepEqual(
    sent.body,
    envelope(
      0x9427,
      0,
      new ProtoWriter()
        .string(1, FILESET_UUID) // filesetUuid
        .message(
          2, // name
          new ProtoWriter()
            .string(1, "新名字") // newName
            .string(2, "新名字") // displayName — the SAME value
            .finish(),
        )
        // `flag.field1 = 0` with the bare `!= null` guard: the message is PRESENT but
        // its only field is dropped, so the wire carries `1a 00`. Skipping the empty
        // message entirely would be a shorter request the server mis-parses.
        .message(3, new Uint8Array(0))
        .finish(),
      1, // uinForm -> reserved = 1
    ),
  );
  // The `1a 00` is 2 of the body's bytes; assert it directly so a future "skip empty
  // messages" optimisation fails here.
  assert.ok(
    Buffer.from(sent.body).includes(Buffer.from([0x1a, 0x00])),
    "the empty flag message must still be written as `1a 00`",
  );
});

// ===========================================================================
// 6. sendFlashMsg — group direct, private through uid resolution
// ===========================================================================

test("sendFlashMsg to a GROUP puts group_id at target.field3.field1 directly", async () => {
  const client = new FakePacketClient();
  client.answer("OidbSvcTrpcTcp.0x93d7_1", envelope(0x93d7, 1, new Uint8Array(0)));
  const bridge = makeBridge(client);

  const result = await new FlashTransferApi(bridge).sendFlashMsg(FILESET_UUID, { groupId: 987654321 });

  assert.equal(result, undefined);
  assert.deepEqual(
    client.only("OidbSvcTrpcTcp.0x93d7_1").body,
    envelope(
      0x93d7,
      1,
      new ProtoWriter()
        .message(
          1, // target
          new ProtoWriter()
            .uint32(1, 2) // field1 = FLASH_TARGET_GROUP
            .message(3, new ProtoWriter().uint32(1, 987654321).finish()) // targetGroup.groupId
            .finish(),
        )
        .string(2, FILESET_UUID) // filesetUuid
        .finish(),
    ),
  );
});

test("sendFlashMsg to a USER resolves the uin to a uid before sending", async () => {
  // `user_id` is a UIN; the wire wants a UID. Sending the uin produces a well-formed
  // request about a nonexistent peer, which the server accepts without complaint — a
  // silent no-op. The resolved string in field 2.2.1 is the only observable proof.
  const client = new FakePacketClient();
  client.answer("OidbSvcTrpcTcp.0x93d7_1", envelope(0x93d7, 1, new Uint8Array(0)));
  const bridge = makeBridge(client);

  await new FlashTransferApi(bridge).sendFlashMsg(FILESET_UUID, { userId: PEER_UIN });

  assert.deepEqual(
    client.only("OidbSvcTrpcTcp.0x93d7_1").body,
    envelope(
      0x93d7,
      1,
      new ProtoWriter()
        .message(
          1,
          new ProtoWriter()
            .uint32(1, 1) // field1 = FLASH_TARGET_PRIVATE
            .message(2, new ProtoWriter().string(1, PEER_UID).finish()) // targetUid.targetUid
            .finish(),
        )
        .string(2, FILESET_UUID)
        .finish(),
    ),
  );
});

test("sendFlashMsg prefers groupId when both targets are supplied", async () => {
  // The reference tests `groupId !== undefined` FIRST, so a stray `userId` alongside it
  // is silently ignored rather than rejected. Reproduced, not "fixed": inventing a throw
  // here would be a behaviour change.
  const client = new FakePacketClient();
  client.answer("OidbSvcTrpcTcp.0x93d7_1", envelope(0x93d7, 1, new Uint8Array(0)));
  const bridge = makeBridge(client);

  await new FlashTransferApi(bridge).sendFlashMsg(FILESET_UUID, { userId: PEER_UIN, groupId: 42 });

  // The group branch does not resolve a uid, so no extra packet is sent.
  const sent = client.only("OidbSvcTrpcTcp.0x93d7_1");
  assert.ok(
    Buffer.from(sent.body).includes(Buffer.from([0x08, 0x02])),
    "field1 must be 2 (group), not 1 (private)",
  );
});

test("sendFlashMsg refuses an empty target", async () => {
  const client = new FakePacketClient();
  const bridge = makeBridge(client);

  await assert.rejects(
    async () => await new FlashTransferApi(bridge).sendFlashMsg(FILESET_UUID, {}),
    /send_flash_msg: user_id or group_id is required/,
  );
  assert.equal(client.sent.length, 0, "no packet may be sent for an empty target");
});

// ===========================================================================
// 7. getFileDownload / getFlashFileUrl / downloadFileset — the two-hop
// ===========================================================================

/** Build the request bytes `0x12a9_200` produces, with `seq` pinned. */
function flashDownloadRequest(seq: number): Uint8Array {
  const head = new ProtoWriter()
    .message(
      1, // sub
      new ProtoWriter()
        .uint32(1, seq) // seq
        .uint32(2, 200) // sub = 200
        .finish(),
    )
    .message(
      2, // config
      new ProtoWriter()
        .uint32(101, 2)
        .uint32(102, 4)
        .uint32(103, 22)
        .uint32(200, 5)
        .finish(),
    )
    .message(3, new ProtoWriter().uint32(1, 1).finish()) // field3.field1 = 1
    .finish();
  const wrapper = new ProtoWriter()
    .message(
      1, // fileInfo
      new ProtoWriter()
        // field1 is 0 with the usual `!== 0` guard, so it vanishes.
        .string(4, FILE_NAME) // field4 = fileName
        // FlashApplyFileInfo5: all four use the bare `!= null` guard, so the zeros ARE
        // written as `08 00 10 00 18 00 20 00`.
        .message(5, new ProtoWriter().uint32Present(1, 0).uint32Present(2, 0).uint32Present(3, 0).uint32Present(4, 0).finish())
        .finish(),
    )
    .string(2, FILE_ID) // fileId
    .finish();
  const payload2 = new ProtoWriter()
    .message(
      2, // field2
      new ProtoWriter()
        .uint32(1, 4294967294) // uint32 sentinel, NOT int32 -2
        .uint32(3, 4294967295) // uint32 sentinel, NOT int32 -1
        .uint32(5, 111)
        .message(6, new ProtoWriter().uint32(1, 3403722988).finish())
        .finish(),
    )
    // field4 = `{field1: 0}` → present but empty, so `22 00`.
    .message(4, new Uint8Array(0))
    .message(
      10, // filesetWrap
      new ProtoWriter()
        .string(1, FILESET_UUID) // filesetUuid
        .string(2, FILE_UUID) // fileUuid
        .uint32(3, 26) // field3 = FLASH_FILESET_EXTRA_FIELD3
        .string(4, FILE_UUID) // field4 = fileUuid AGAIN
        .finish(),
    )
    .finish();
  const payload = new ProtoWriter()
    .message(1, wrapper) // wrapper
    .message(2, payload2) // field2
    .finish();
  return new ProtoWriter().message(1, head).message(3, payload).finish();
}

test("getFileDownload asks 0x93d4_1 then 0x12a9_200, in that order", async () => {
  resetFlashSequence(300);
  const client = new FakePacketClient();
  client.answer(
    "OidbSvcTrpcTcp.0x93d4_1",
    envelope(
      0x93d4,
      1,
      downloadEntry([
        // index 1 is a DIFFERENT file, so a wrong selector picks the wrong row.
        { filesetUuid: "other", fileUuid: "other", fileIndex: 2, fileName: "other.txt", fileId: "other-id" },
        { filesetUuid: FILESET_UUID, fileUuid: FILE_UUID, fileIndex: 1, fileName: FILE_NAME, fileSize: 4096n, fileId: FILE_ID },
      ]),
    ),
  );
  client.answer("OidbSvcTrpcTcp.0x12a9_200", envelope(0x12a9, 200, downloadResp(BLOB_URL), 1));
  const bridge = makeBridge(client);

  const result = await new FlashTransferApi(bridge).getFileDownload(FILESET_UUID, 1);

  assert.deepEqual(client.sent.map((packet) => packet.wireName), [
    "OidbSvcTrpcTcp.0x93d4_1",
    "OidbSvcTrpcTcp.0x12a9_200",
  ]);
  assert.deepEqual(result, { url: DOWNLOAD_URL, fileName: FILE_NAME, fileSize: 4096 });
});

test("getFileDownload's 0x93d4 request carries only filesetUuid plus constants", async () => {
  resetFlashSequence(300);
  const client = new FakePacketClient();
  client.answer(
    "OidbSvcTrpcTcp.0x93d4_1",
    envelope(
      0x93d4,
      1,
      downloadEntry([{ filesetUuid: FILESET_UUID, fileUuid: FILE_UUID, fileIndex: 1, fileName: FILE_NAME, fileId: FILE_ID }]),
    ),
  );
  client.answer("OidbSvcTrpcTcp.0x12a9_200", envelope(0x12a9, 200, downloadResp(BLOB_URL), 1));
  const bridge = makeBridge(client);

  await new FlashTransferApi(bridge).getFileDownload(FILESET_UUID, 1);

  // `FlashGetDownloadUrlReq`: 1 filesetUuid, 2 inner{1 "", 2 1, 3 18, 4 "", 5 {1:0},
  // 6 {1:0,2:0}}, 3 field3=7, 4 field4=1. Every value but the uuid is a constant.
  const inner = new ProtoWriter()
    // field1 is "" and field4 is "" — both tags dropped.
    .uint32(2, 1)
    .uint32(3, 18)
    // field5 = `{field1: 0}` and field6 = `{field1: 0, field2: 0}`: present, empty.
    .message(5, new Uint8Array(0))
    .message(6, new Uint8Array(0))
    .finish();
  assert.deepEqual(
    client.only("OidbSvcTrpcTcp.0x93d4_1").body,
    envelope(
      0x93d4,
      1,
      new ProtoWriter()
        .string(1, FILESET_UUID)
        .message(2, inner)
        .uint32(3, 7)
        .uint32(4, 1)
        .finish(),
    ),
  );
});

test("getFileDownload's 0x12a9_200 request matches the independently built bytes", async () => {
  resetFlashSequence(300);
  const client = new FakePacketClient();
  client.answer(
    "OidbSvcTrpcTcp.0x93d4_1",
    envelope(
      0x93d4,
      1,
      downloadEntry([{ filesetUuid: FILESET_UUID, fileUuid: FILE_UUID, fileIndex: 1, fileName: FILE_NAME, fileId: FILE_ID }]),
    ),
  );
  client.answer("OidbSvcTrpcTcp.0x12a9_200", envelope(0x12a9, 200, downloadResp(BLOB_URL), 1));
  const bridge = makeBridge(client);

  await new FlashTransferApi(bridge).getFileDownload(FILESET_UUID, 1);

  // The counter is consumed by `serialize`, so the first call after a reset uses 300.
  assert.deepEqual(
    client.only("OidbSvcTrpcTcp.0x12a9_200").body,
    envelope(0x12a9, 200, flashDownloadRequest(300), 1),
  );
});

test("getFileDownload selects by fileIndex, so a different index gets a different row", async () => {
  resetFlashSequence(300);
  const client = new FakePacketClient();
  client.answer(
    "OidbSvcTrpcTcp.0x93d4_1",
    envelope(
      0x93d4,
      1,
      downloadEntry([
        { filesetUuid: FILESET_UUID, fileUuid: FILE_UUID, fileIndex: 1, fileName: "first.pdf", fileId: "id-1" },
        { filesetUuid: FILESET_UUID, fileUuid: FILE_UUID, fileIndex: 2, fileName: "second.pdf", fileId: "id-2" },
      ]),
    ),
  );
  client.answer("OidbSvcTrpcTcp.0x12a9_200", envelope(0x12a9, 200, downloadResp(BLOB_URL), 1));
  const bridge = makeBridge(client);

  const result = await new FlashTransferApi(bridge).getFileDownload(FILESET_UUID, 2);

  assert.equal(result?.fileName, "second.pdf");
  // ... and the SECOND file's id is what reaches 0x12a9.
  assert.ok(Buffer.from(client.only("OidbSvcTrpcTcp.0x12a9_200").body).includes(Buffer.from("id-2")));
});

test("getFlashFileUrl answers the bare URL STRING", async () => {
  resetFlashSequence(300);
  const client = new FakePacketClient();
  client.answer(
    "OidbSvcTrpcTcp.0x93d4_1",
    envelope(
      0x93d4,
      1,
      downloadEntry([{ filesetUuid: FILESET_UUID, fileUuid: FILE_UUID, fileIndex: 1, fileName: FILE_NAME, fileId: FILE_ID }]),
    ),
  );
  client.answer("OidbSvcTrpcTcp.0x12a9_200", envelope(0x12a9, 200, downloadResp(BLOB_URL), 1));
  const bridge = makeBridge(client);

  const url = await new FlashTransferApi(bridge).getFlashFileUrl(FILESET_UUID);

  // The action's `returnsSchema` is `{url: string}`, so a row here would change it.
  assert.equal(typeof url, "string");
  assert.equal(url, DOWNLOAD_URL);
});

test("getFlashFileUrl THROWS rather than answering a falsy url", async () => {
  // `0x12a9` answering an empty blob means "no flash URL available". Answering `""`
  // would make the action report `ok` with an unusable link.
  resetFlashSequence(300);
  const client = new FakePacketClient();
  client.answer(
    "OidbSvcTrpcTcp.0x93d4_1",
    envelope(
      0x93d4,
      1,
      downloadEntry([{ filesetUuid: FILESET_UUID, fileUuid: FILE_UUID, fileIndex: 1, fileName: FILE_NAME, fileId: FILE_ID }]),
    ),
  );
  client.answer("OidbSvcTrpcTcp.0x12a9_200", envelope(0x12a9, 200, new Uint8Array(0), 1));
  const bridge = makeBridge(client);

  await assert.rejects(
    async () => await new FlashTransferApi(bridge).getFlashFileUrl(FILESET_UUID),
    /get_flash_file_url: no download url available/,
  );
});

test("downloadFileset answers {url, fileName, fileSize} and IGNORES fileName", async () => {
  // `opts.fileName` is accepted and ignored — only `fileIndex` selects. Wiring the name
  // would change which file a name-only caller receives.
  resetFlashSequence(300);
  const client = new FakePacketClient();
  client.answer(
    "OidbSvcTrpcTcp.0x93d4_1",
    envelope(
      0x93d4,
      1,
      downloadEntry([
        { filesetUuid: FILESET_UUID, fileUuid: FILE_UUID, fileIndex: 1, fileName: "first.pdf", fileSize: 11n, fileId: "id-1" },
      ]),
    ),
  );
  client.answer("OidbSvcTrpcTcp.0x12a9_200", envelope(0x12a9, 200, downloadResp(BLOB_URL), 1));
  const bridge = makeBridge(client);

  const target = await new FlashTransferApi(bridge).downloadFileset(FILESET_UUID, {
    fileName: "first.pdf",
    fileIndex: 1,
  });

  assert.deepEqual(target, { url: DOWNLOAD_URL, fileName: "first.pdf", fileSize: 11 });
});

test("downloadFileset THROWS with its own message when no url resolves", async () => {
  resetFlashSequence(300);
  const client = new FakePacketClient();
  client.answer(
    "OidbSvcTrpcTcp.0x93d4_1",
    envelope(
      0x93d4,
      1,
      downloadEntry([{ filesetUuid: FILESET_UUID, fileUuid: FILE_UUID, fileIndex: 1, fileName: FILE_NAME, fileId: FILE_ID }]),
    ),
  );
  client.answer("OidbSvcTrpcTcp.0x12a9_200", envelope(0x12a9, 200, new Uint8Array(0), 1));
  const bridge = makeBridge(client);

  // A DISTINCT message from `get_flash_file_url`'s: the two actions are named
  // separately so an operator can tell which one failed.
  await assert.rejects(
    async () => await new FlashTransferApi(bridge).downloadFileset(FILESET_UUID),
    /download_fileset: no download url available/,
  );
});

test("getFileDownload re-queries 0x93d4 while fileId is missing, then gives up", async () => {
  // ⚠️ #364: `0x93d4` can omit the main-file `fileId` for a few seconds after
  // `create`. The reference retries on FLASH_FILE_ID_RETRY_DELAYS_MS
  // ([1s, 2s, 4s, 4s]) after an immediate first attempt — five lookups, then `null`.
  //
  // This test really sleeps (11 s) because the schedule is a module constant and
  // faking the clock would assert on the fake rather than on the code. The CALL COUNT
  // is the load-bearing assertion: a port that retried forever, or not at all, gets a
  // different number here.
  const client = new FakePacketClient();
  client.answer("OidbSvcTrpcTcp.0x93d4_1", envelope(0x93d4, 1, downloadEntry([{ filesetUuid: FILESET_UUID, fileIndex: 1 }])));
  const bridge = makeBridge(client);

  const result = await new FlashTransferApi(bridge).getFileDownload(FILESET_UUID, 1);

  assert.equal(result, null, "an exhausted schedule answers null, not a throw");
  assert.equal(client.sent.filter((packet) => packet.wireName === "OidbSvcTrpcTcp.0x93d4_1").length, 5);
  // And 0x12a9 is never reached: without a fileId there is nothing to ask about.
  assert.equal(client.sent.filter((packet) => packet.wireName === "OidbSvcTrpcTcp.0x12a9_200").length, 0);
});

// ===========================================================================
// 8. The action layer's field names
// ===========================================================================

test("flashFileInfoToJson renames the slice's row onto fileset_id / size, not file_size", () => {
  // The slice answers `FlashFileInfo`; the action maps it with THIS helper. If the slice
  // answered `undefined` for any field, the JSON would carry `undefined` — so the
  // assertion is on the produced key NAMES, which is where a rename would hide.
  const json = flashFileInfoToJson({
    filesetUuid: FILESET_UUID,
    fileName: FILE_NAME,
    origName: "original.pdf",
    fileSize: 1234,
    shareUrl: "https://qfile.qq.com/q/SHARE",
    fileId: FILE_ID,
    downloadUrl: "https://thumb.example/14903",
  });

  assert.deepEqual(json, {
    fileset_id: FILESET_UUID,
    file_name: FILE_NAME,
    orig_name: "original.pdf",
    size: 1234, // NOT `file_size` — a NapCat compatibility choice
    share_url: "https://qfile.qq.com/q/SHARE",
    file_id: FILE_ID,
    download_url: "https://thumb.example/14903",
  });
  assert.equal("file_size" in json, false, "`size` is the field name, not `file_size`");
  assert.equal("filesetUuid" in json, false, "the camelCase wire name must not leak");
});

test("getFilesetInfo's rows survive the action layer's rename intact", async () => {
  const client = new FakePacketClient();
  client.answer(
    "OidbSvcTrpcTcp.0x93d3_1",
    envelope(
      0x93d3,
      1,
      entryList([
        fileEntry({
          filesetUuid: FILESET_UUID,
          fileName: FILE_NAME,
          origName: "original.pdf",
          fileSize: 4096n,
          uploadUrl: "https://qfile.qq.com/q/SHARE",
          fileId: FILE_ID,
        }),
      ]),
    ),
  );
  const bridge = makeBridge(client);

  const [row] = await new FlashTransferApi(bridge).getFilesetInfo(FILESET_UUID);
  const json = flashFileInfoToJson(row!);

  // `get_fileset_info` answers `{fileset_id, file_list: [...]}`; the inner rows are
  // this. Every value must be present — an `undefined` here is a JSON `null` on the
  // wire, which a client cannot distinguish from "the field was empty".
  for (const [key, value] of Object.entries(json)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
  }
  assert.equal(json["fileset_id"], FILESET_UUID);
  assert.equal(json["size"], 4096);
});

// ===========================================================================
// 9. createFlashTask — the uploader
// ===========================================================================
//
// These tests run the REAL pipeline against a real temp file: staging, the streaming
// hash (including the hand-written `Sha1Stream`), the protobuf slice body, the
// ordering of the five phases. The only fakes are the two network boundaries —
// `sendRawPacket` (canned envelopes) and `fetch` (the `sliceupload` POST).
//
// The `sliceupload` fake is what makes the ordering assertions possible at all:
// `fetch` is the only call in the uploader that is not an OIDB packet, so recording
// its call time against `client.sent.length` pins "was this sent before or after
// Publish" without a clock.

const STAGE_ROOT = path.join(os.tmpdir(), "media-stage");

/** Make a real temp file OUTSIDE the stage dir, since staging links/copies into it. */
async function tempSource(name: string, bytes: Uint8Array): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flash-src-"));
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, bytes);
  return filePath;
}

/** Answer every OIDB command the uploader issues, with the minimum valid bodies. */
function scriptUploader(client: FakePacketClient, filesetUuid = FILESET_UUID): void {
  client.answer(
    "OidbSvcTrpcTcp.0x93cf_1",
    envelope(
      0x93cf,
      1,
      // FlashApplyFilesetResp: 1 filesetUuid, 2 uploadKey, 3 uploadUrl, 4 expire, 5 ttl
      new ProtoWriter().string(1, filesetUuid).string(2, "key").string(3, "url").finish(),
    ),
  );
  // FlashCommitFileResp: `deserialize` returns the body, so an empty body is enough.
  client.answer("OidbSvcTrpcTcp.0x93d0_1", envelope(0x93d0, 1, new Uint8Array(0)));
  // CompleteFileset: the decoder skips everything and answers `undefined`.
  client.answer("OidbSvcTrpcTcp.0x93db_1", envelope(0x93db, 1, new Uint8Array(0)));
  // PrepareUpload: rkeyWrap{rkey}
  client.answer(
    "OidbSvcTrpcTcp.0x12a9_100",
    envelope(0x12a9, 100, new ProtoWriter().message(2, new ProtoWriter().string(1, "RKEY").finish()).finish()),
  );
  // ApplyUpload: the result is discarded, so any parseable body works.
  client.answer("OidbSvcTrpcTcp.0x12a9_103", envelope(0x12a9, 103, new Uint8Array(0)));
  client.answer("OidbSvcTrpcTcp.0x93d1_1", envelope(0x93d1, 1, new Uint8Array(0)));
}

/**
 * The OIDB body out of a recorded packet.
 *
 * Every assertion below wants the SPECIFIC body, not the envelope — and the envelope's
 * field 3 is `errorCode`, so scanning an envelope for "field 3" reads the error code
 * instead of `0x93cf`'s `typeCode`. Unwrapping first is what keeps those apart.
 */
function oidbBody(packet: SentPacket): Uint8Array {
  const reader = new ProtoReader(packet.body);
  let body: Uint8Array = new Uint8Array(0);
  while (reader.next()) {
    if (reader.fieldNumber === 4 && reader.wireType === 2) body = reader.bytes();
    else reader.skip();
  }
  return body;
}

/** A `sliceupload` fake that records each POST and answers `status: "success"`. */
function fakeSliceupload(): { calls: { body: Uint8Array; at: number }[]; restore: () => void } {
  const realFetch = globalThis.fetch;
  const calls: { body: Uint8Array; at: number }[] = [];
  let order = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    // `BodyInit` is a union (string | URLSearchParams | Blob | ArrayBuffer | …), so it has no
    // `byteLength`. The slice-upload POST always sends an `ArrayBuffer` view, which is what
    // the cast pins; `Uint8Array.from` then copies it as bytes.
    const body = Uint8Array.from(init?.body as ArrayBufferView as Uint8Array);
    calls.push({ body, at: order++ });
    // FlashSliceUploadResp: 5 status (tag 42). "success" is the only accepted value.
    const respBody = new ProtoWriter().string(5, "success").finish();
    // `BodyInit` is narrower than `Uint8Array<ArrayBufferLike>`; the bytes are the same.
    return new Response(respBody as unknown as BodyInit, { status: 200 });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => (globalThis.fetch = realFetch) };
}

test("createFlashTask numbers fileIndex from 1 and commits every entry in ONE request", async () => {
  const client = new FakePacketClient();
  scriptUploader(client);
  const slice = fakeSliceupload();
  try {
    const a = await tempSource("a.pdf", new Uint8Array([1, 2, 3, 4]));
    const b = await tempSource("b.png", new Uint8Array([5, 6, 7]));
    const c = await tempSource("c.txt", new Uint8Array([8]));

    const result = await new FlashTransferApi(makeBridge(client)).createFlashTask([
      { file: a },
      { file: b },
      { file: c },
    ]);
    assert.equal(result.filesetId, FILESET_UUID, "answers the server's uuid, not a fabricated one");

    // Exactly ONE CommitFile, carrying all three entries — not one call per file.
    const body = oidbBody(client.only("OidbSvcTrpcTcp.0x93d0_1"));
    const indexes: number[] = [];
    const names: string[] = [];
    const bodyReader = new ProtoReader(body);
    while (bodyReader.next()) {
      if (bodyReader.fieldNumber === 4 && bodyReader.wireType === 2) {
        // FlashCommitFileInfo: 6 = fileIndex, 8 = fileName
        bodyReader.message((data, offset, end) => {
          const info = new ProtoReader(data, offset, end);
          while (info.next()) {
            if (info.fieldNumber === 6 && info.wireType === 0) indexes.push(info.uint32());
            else if (info.fieldNumber === 8 && info.wireType === 2) names.push(info.string());
            else info.skip();
          }
          return null;
        });
      } else {
        bodyReader.skip();
      }
    }
    assert.deepEqual(indexes, [1, 2, 3], "fileIndex is 1-based and in input order");
    assert.deepEqual(names, ["a.pdf", "b.png", "c.txt"]);
  } finally {
    slice.restore();
  }
});

test("createFlashTask asks fileTypeCode TWICE for different purposes: per-file formatCode, fileset typeCode", async () => {
  // A .zip is formatCode 4 (its own icon) but typeCode 6 (the card's archive class).
  // A .png is formatCode 26 and typeCode 7. So if the two calls were collapsed, either
  // the commit's per-file codes or the fileset's field 3 would be visibly wrong.
  const client = new FakePacketClient();
  scriptUploader(client);
  const slice = fakeSliceupload();
  try {
    const zip = await tempSource("archive.zip", new Uint8Array([1]));
    const png = await tempSource("image.png", new Uint8Array([2]));

    await new FlashTransferApi(makeBridge(client)).createFlashTask([{ file: zip }, { file: png }]);

    // Fileset-level: 0x93cf field 3 = typeCode of the FIRST file (the .zip → 6).
    const typeCodes: number[] = [];
    const applyReader = new ProtoReader(oidbBody(client.only("OidbSvcTrpcTcp.0x93cf_1")));
    while (applyReader.next()) {
      if (applyReader.fieldNumber === 3 && applyReader.wireType === 0) typeCodes.push(applyReader.uint32());
      else applyReader.skip();
    }
    assert.deepEqual(typeCodes, [6], "0x93cf field 3 is the ZIP's typeCode, from the first file only");

    // Per-file: commit entries carry formatCode 4 (zip) then 26 (png) — NOT 6 and 7.
    const formatCodes: number[] = [];
    const reader = new ProtoReader(oidbBody(client.only("OidbSvcTrpcTcp.0x93d0_1")));
    while (reader.next()) {
      if (reader.fieldNumber === 4 && reader.wireType === 2) {
        reader.message((data, offset, end) => {
          const info = new ProtoReader(data, offset, end);
          while (info.next()) {
            if (info.fieldNumber === 7 && info.wireType === 0) formatCodes.push(info.uint32());
            else info.skip();
          }
          return null;
        });
      } else {
        reader.skip();
      }
    }
    assert.deepEqual(formatCodes, [4, 26], "0x93d0 field 7 is each file's own formatCode");
  } finally {
    slice.restore();
  }
});

test("createFlashTask rejects an empty file with its own message and cleans it up", async () => {
  const client = new FakePacketClient();
  scriptUploader(client);
  const slice = fakeSliceupload();
  const before = new Set(await fs.readdir(STAGE_ROOT).catch(() => [] as string[]));
  try {
    const empty = await tempSource("empty.pdf", new Uint8Array(0));
    await assert.rejects(
      async () => await new FlashTransferApi(makeBridge(client)).createFlashTask([{ file: empty }]),
      { message: "create_flash_task: file is empty" },
    );
    // Rejected BEFORE any OIDB call: the fileset is never created.
    assert.deepEqual(client.sent, [], "nothing may be sent for a fileset that cannot be completed");

    // And the staged copy is gone — `items` is populated before the throw, so the
    // `finally` sees it.
    const after = await fs.readdir(STAGE_ROOT).catch(() => [] as string[]);
    const leaked = after.filter((name) => !before.has(name));
    assert.deepEqual(leaked, [], "the staged temp file was unlinked");
  } finally {
    slice.restore();
  }
});

test("createFlashTask's fileset name defaults in three steps: explicit / single / multi-含等", async () => {
  const cases: { files: string[]; name?: string; expected: string }[] = [
    { files: ["one.pdf"], name: "  我的文件  ", expected: "我的文件" },
    { files: ["one.pdf"], expected: "one.pdf" },
    { files: ["one.pdf", "two.png", "three.txt"], expected: "one.pdf等3个文件" },
  ];
  for (const testCase of cases) {
    const client = new FakePacketClient();
    scriptUploader(client);
    const slice = fakeSliceupload();
    try {
      const sources: { file: string }[] = [];
      for (const fileName of testCase.files) sources.push({ file: await tempSource(fileName, new Uint8Array([1, 2])) });
      await new FlashTransferApi(makeBridge(client)).createFlashTask(
        sources,
        testCase.name,
        undefined,
      );
      // 0x93cf body: 2 fileInfo { 2 fileName, 3 origName }, 3 typeCode
      let cardName: string | null = null;
      const reader = new ProtoReader(oidbBody(client.only("OidbSvcTrpcTcp.0x93cf_1")));
      while (reader.next()) {
        if (reader.fieldNumber === 2 && reader.wireType === 2) {
          reader.message((data, offset, end) => {
            const info = new ProtoReader(data, offset, end);
            while (info.next()) {
              if (info.fieldNumber === 2 && info.wireType === 2) cardName = info.string();
              else info.skip();
            }
            return null;
          });
        } else {
          reader.skip();
        }
      }
      assert.equal(cardName, testCase.expected);
    } finally {
      slice.restore();
    }
  }
});

test("createFlashTask cleans up every staged file when a later step fails", async () => {
  // Fail at CompleteFileset — AFTER staging and after Apply, so `items` is full and the
  // `finally` has work to do. A cleanup that only ran on the early-return paths would
  // leak one temp file per input here.
  // CompleteFileset deliberately has NO scripted answer → a transport failure.
  const failing = new FakePacketClient();
  failing.answer(
    "OidbSvcTrpcTcp.0x93cf_1",
    envelope(0x93cf, 1, new ProtoWriter().string(1, FILESET_UUID).finish()),
  );
  failing.answer("OidbSvcTrpcTcp.0x93d0_1", envelope(0x93d0, 1, new Uint8Array(0)));
  // 0x93db_1 deliberately unscripted.

  const slice = fakeSliceupload();
  const before = new Set(await fs.readdir(STAGE_ROOT).catch(() => [] as string[]));
  try {
    const a = await tempSource("a.pdf", new Uint8Array([1]));
    const b = await tempSource("b.pdf", new Uint8Array([2]));
    await assert.rejects(
      async () => await new FlashTransferApi(makeBridge(failing)).createFlashTask([{ file: a }, { file: b }]),
      /no answer for OidbSvcTrpcTcp\.0x93db_1/,
    );
    const after = await fs.readdir(STAGE_ROOT).catch(() => [] as string[]);
    const leaked = after.filter((name) => !before.has(name));
    assert.deepEqual(leaked, [], "both staged files were unlinked");
    // No bytes were uploaded, because the failure is before the prepare phase.
    assert.deepEqual(slice.calls, []);
  } finally {
    slice.restore();
  }
});

test("createFlashTask orders ApplyFileset → CommitFile → CompleteFileset → upload → Publish", async () => {
  const client = new FakePacketClient();
  scriptUploader(client);
  // Record the packet order as a list of wire names.
  const order: string[] = [];
  const originalSend = client.sendPacket.bind(client);
  client.sendPacket = async (wireName, body) => {
    order.push(wireName);
    return await originalSend(wireName, body);
  };
  const slice = fakeSliceupload();
  try {
    const file = await tempSource("one.pdf", new Uint8Array([9, 9, 9]));
    await new FlashTransferApi(makeBridge(client)).createFlashTask([{ file }]);

    // Compress consecutive duplicates (the two thumbnails each do prepare+apply).
    const phases = order.filter((name, index) => name !== order[index - 1]);
    assert.deepEqual(
      phases.slice(0, 4),
      [
        "OidbSvcTrpcTcp.0x93cf_1", // ApplyFileset
        "OidbSvcTrpcTcp.0x93d0_1", // CommitFile
        "OidbSvcTrpcTcp.0x93db_1", // CompleteFileset
        "OidbSvcTrpcTcp.0x12a9_100", // PrepareUpload (first file)
      ],
      "the fileset is applied, committed and completed BEFORE anything is uploaded",
    );
    assert.equal(phases[phases.length - 1], "OidbSvcTrpcTcp.0x93d1_1", "Publish/SetStatus is LAST");

    // Main file + 2 thumbnails = 3 slice bodies; the main file is under 1 MiB, so one
    // slice for it.
    assert.equal(slice.calls.length, 3);
    // The main-file slice carries appid 14901 as `16 <varint>`, i.e. field 2.
    const mainBody = new ProtoReader(slice.calls[0]!.body);
    let appid = 0;
    while (mainBody.next()) {
      if (mainBody.fieldNumber === 2 && mainBody.wireType === 0) appid = mainBody.uint32();
      else mainBody.skip();
    }
    assert.equal(appid, 14901, "main file appid is 14901 (f14.f1 is where 0x93d4 reads it)");

    // Every upload happened BETWEEN CompleteFileset and Publish: the last PrepareUpload
    // index is below the Publish index. (The slice POSTs are not in `order`, which is
    // why the appids above pin them separately.)
    const publishIndex = order.lastIndexOf("OidbSvcTrpcTcp.0x93d1_1");
    const lastPrepareIndex = order.lastIndexOf("OidbSvcTrpcTcp.0x12a9_100");
    assert.ok(lastPrepareIndex < publishIndex, "all prepares precede the publish");
  } finally {
    slice.restore();
  }
});

test("createFlashTask answers the uuid ApplyFileset returned, and never a synthetic one", async () => {
  // A missing uuid is a hard failure: answering `""` or a made-up id would make
  // `create_flash_task` return `ok` for a fileset the server never created.
  const client = new FakePacketClient();
  client.answer("OidbSvcTrpcTcp.0x93cf_1", envelope(0x93cf, 1, new ProtoWriter().string(2, "key").finish()));
  const slice = fakeSliceupload();
  try {
    const file = await tempSource("x.pdf", new Uint8Array([1]));
    await assert.rejects(
      async () => await new FlashTransferApi(makeBridge(client)).createFlashTask([{ file }]),
      { message: "apply fileset failed: missing uuid" },
    );
    // And nothing was committed for a fileset that does not exist.
    assert.deepEqual(
      client.sent.filter((packet) => packet.wireName === "OidbSvcTrpcTcp.0x93d0_1"),
      [],
    );
  } finally {
    slice.restore();
  }
});

test("createFlashTask slices at 1 MiB and sends a sha1StateV the server can match to slices", async () => {
  // The 2.5 MiB size is chosen so there are TWO intermediate states, not zero or one:
  // at exactly N MiB the reference's `hashFileStreaming` emits an extra un-finalised
  // state, which is the trap `hashFlashFileStreaming` exists to avoid. Reading the
  // states back and checking the LAST one equals the whole-file sha1 is what proves the
  // list is "one state per slice, the last one finalised".
  const client = new FakePacketClient();
  scriptUploader(client);
  const slice = fakeSliceupload();
  try {
    const size = 2 * 1024 * 1024 + 512 * 1024;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i & 0xff;
    const file = await tempSource("big.bin", bytes);

    await new FlashTransferApi(makeBridge(client)).createFlashTask([{ file }]);

    // One POST per 1 MiB slice of the main file, plus the two thumbnails.
    assert.equal(slice.calls.length, 3 + 2, "three main-file slices then two thumbnails");

    // Each of the three main-file posts must be complete: 1 MiB, 1 MiB, 512 KiB.
    const expectedLengths = [1024 * 1024, 1024 * 1024, 512 * 1024];
    for (let i = 0; i < 3; i++) {
      const reader = new ProtoReader(slice.calls[i]!.body);
      let payloadBytes: Uint8Array = new Uint8Array(0);
      while (reader.next()) {
        if (reader.fieldNumber === 107 && reader.wireType === 2) payloadBytes = reader.bytes();
        else reader.skip();
      }
      const payload = new ProtoReader(payloadBytes);
      let chunk: Uint8Array = new Uint8Array(0);
      const startValues: number[] = [];
      const states: Uint8Array[] = [];
      while (payload.next()) {
        if (payload.fieldNumber === 3) startValues.push(payload.uint32());
        else if (payload.fieldNumber === 7) chunk = payload.bytes();
        else if (payload.fieldNumber === 6) {
          payload.message((data, offset, end) => {
            const inner = new ProtoReader(data, offset, end);
            while (inner.next()) {
              if (inner.fieldNumber === 1) states.push(inner.bytes());
              else inner.skip();
            }
            return null;
          });
        } else payload.skip();
      }
      assert.deepEqual(startValues, [i * 1024 * 1024], `slice ${i} starts at its own offset`);
      assert.equal(chunk.length, expectedLengths[i], `slice ${i} is ${expectedLengths[i]} bytes`);
      assert.equal(states.length, 3, "sha1StateV carries one state per slice, on EVERY slice");
      // The last state is the finalised whole-file SHA-1 — computed here independently.
      const whole = createHash("sha1").update(Buffer.from(bytes)).digest("hex");
      assert.equal(Buffer.from(states[2]!).toString("hex"), whole);
      // Intermediate states are 20 bytes each, like every SHA-1 state.
      assert.equal(states[0]!.length, 20);
      assert.equal(states[1]!.length, 20);
      // And they are NOT the whole-file digest (i.e. genuinely intermediate).
      assert.notEqual(Buffer.from(states[0]!).toString("hex"), whole);
    }
  } finally {
    slice.restore();
  }
});

test("createFlashTask rejects an empty file list before touching the network", async () => {
  const client = new FakePacketClient();
  await assert.rejects(
    async () => await new FlashTransferApi(makeBridge(client)).createFlashTask([]),
    { message: "create_flash_task: files is empty" },
  );
  assert.deepEqual(client.sent, []);
});
