// OidbSvcTrpcTcp.0x9154_1 and 0x9155_1 — the QQ system-face catalog and one-face lookup.
//
// ---------------------------------------------------------------------------
// Why the brief's suspicion was right, and what the actual hazard turned out to be
// ---------------------------------------------------------------------------
// The brief warned that `getUnidirectionalFriendList` was omitted as "bare
// `…0xe17_0` JSON-in-protobuf" and asked whether system-face has a similar edge
// case. Checked, not assumed — the answer is **no, and the real gap was elsewhere**:
//
//   * `0x9154` is 37204 decimal, sub-command 1; `0x9155` is 37205, sub-command 1
//     (reference/index.mjs:21034 `_FetchSysFaces.command = 37204`, :109560
//     `_FetchSysFace.command = 37205`). Both are ordinary OIDB commands with an
//     `OidbBase` envelope, a protobuf body at field 4 and generated encode/decode
//     pairs. Nothing like `0x0e17_0`'s bare `sendRawPacket` with no envelope.
//   * the two request bodies are small and fully specified (see below).
//
//   * The hazard is the STORE. `SysFaceStore` (reference:109595) owns catalog
//     indexing, refresh coalescing, persistence, lookups and the `validateCatalog`
//     invariants; the four actions are trivial mappings over it. Porting the codecs
//     without the store would leave four actions that cannot answer. Both are ported.
//
// ---------------------------------------------------------------------------
// The 0x9154 request body is TWO bytes, and the obvious reading gets it wrong
// ---------------------------------------------------------------------------
// `FetchSysFaces.serialize` (reference:21036) returns
// `{ field1: 0, field2: 7, field3: 0 }`. The generated writer guards each uint32 with
// `!= null && !== 0` (`__size_OidbFetchSysFacesReq`, reference:20223), so:
//
//   field1 = 0  → DROPPED
//   field2 = 7  → WRITTEN as tag `0x10` + value `0x07`
//   field3 = 0  → DROPPED
//
// ⇒ the body is exactly `10 07`. My first reading of this was "all three are zeros so
// the body is empty"; that is wrong, and `REFERENCE_FETCH_SYS_FACES_BODY` at the
// bottom pins `[0x10, 0x07]` so the mistake cannot come back. This is the same trap
// family as `0xfd4`'s `field4: 0`, but with the polarity reversed: there, a zero
// vanished; here, the ONE non-zero field is the whole body.
//
// ---------------------------------------------------------------------------
// `OidbFaceEmoji` — 12 fields, and the last two are NOT 11 and 12
// ---------------------------------------------------------------------------
// From `protobuf_decode_OidbFaceEmoji` (reference:109134), whose tag bytes are
// `10, 18, 26, 32, 40, 48, 56, 66, 74, 80, 104, 112`:
//
//     1  qSid              string    tag 10
//     2  qDes              string    tag 18
//     3  emCode            string    tag 26
//     4  qCid              int32     tag 32    (`_val | 0`)
//     5  aniStickerType    int32     tag 40
//     6  aniStickerPackId  int32     tag 48
//     7  aniStickerId      int32     tag 56
//     8  url               message   tag 66    -> OidbFaceResourceUrl
//     9  emojiNameAlias    repeated string  tag 74   (unpacked)
//    10  unknown10         int32     tag 80
//    13  aniStickerWidth   int32     tag 104   ← 104 >> 3 = 13
//    14  aniStickerHeight  int32     tag 112   ← 112 >> 3 = 14
//
// ⚠️ **Fields 11 and 12 do not exist.** After `unknown10` the numbering jumps to 13.
// Reading the last two as 11/12 — the natural guess — decodes the wrong bytes and
// leaves both null. Verified by tag arithmetic against the generated decoder.
//
// ⚠️ All six numeric fields are **int32** (`_val | 0`), not uint32. For `qCid` that
// matters in principle (a negative sentinel would become ~4e9 if read unsigned); for
// the sticker dimensions it matters for round-tripping.
//
// ---------------------------------------------------------------------------
// `OidbFetchSysFacesResp` — three sibling buckets, walked in a fixed order
// ---------------------------------------------------------------------------
// Reference:20610, tags `8, 18, 26, 34`:
//
//     1  field1            uint32   tag 8
//     2  commonFace        message  tag 18   -> OidbFaceContent
//     3  specialBigFace    message  tag 26
//     4  specialMagicFace  message  tag 34
//
// `OidbFaceContent` = `{ 1: emojiList repeated OidbFaceEmojiList, 2: resourceUrl }`;
// `OidbFaceEmojiList` = `{ 1: emojiPackName string, 2: emojiDetail repeated OidbFaceEmoji }`.
//
// `deserialize` flattens the three buckets in the order `common`, `special-big`,
// `magic`, one pack per `emojiList` entry — so pack order is bucket-major, and a
// nameless pack in the MAGIC bucket becomes the literal `"MagicFace"` while a nameless
// pack elsewhere stays `""`. That asymmetry is in the reference
// (`list.emojiPackName || (source === "magic" ? "MagicFace" : "")`) and is visible in
// `fetch_sys_faces`'s `pack_name`, so it is reproduced rather than smoothed over.
//
// ---------------------------------------------------------------------------
// `OidbFetchSysFaceResp` — and where the id check lives
// ---------------------------------------------------------------------------
// Tags `10, 16`: `{ 1: emoji message, 2: field2 uint32 }`. `deserialize` answers null
// when `emoji` is absent.
//
// ⚠️ The "does the response match the id I asked for" check is NOT here. It lives in
// `SysFaceStore.resolve` (`"system face lookup id mismatch"`), because the store's
// cache-hit path never decodes — putting the check in the decoder would make it
// unreachable for the case that matters most.

import { ProtoReader, ProtoWriter } from "../wire.js";
import type { OidbSpec } from "../spec.js";

// ===========================================================================
// Command numbers
// ===========================================================================

/** `_FetchSysFaces.command` — reference:21034. Decimal 37204 = 0x9154. */
export const FETCH_SYS_FACES_COMMAND = 0x9154;
export const FETCH_SYS_FACES_SUB_COMMAND = 1;
/** `_FetchSysFace.command` — reference:109560. Decimal 37205 = 0x9155. */
export const FETCH_SYS_FACE_COMMAND = 0x9155;
export const FETCH_SYS_FACE_SUB_COMMAND = 1;

// ===========================================================================
// Field numbers
// ===========================================================================

/**
 * `OidbFetchSysFacesReq` — reference:20223.
 *
 * All four are uint32 with the ordinary `!== 0` guard; `field4` is a message whose
 * purpose the bundle does not document, and `serialize` never sets it.
 */
export const FetchSysFacesReqField = { field1: 1, field2: 2, field3: 3, field4: 4 } as const;

/** `OidbFetchSysFacesResp` — reference:20610. */
export const FetchSysFacesRespField = { field1: 1, commonFace: 2, specialBigFace: 3, specialMagicFace: 4 } as const;

/** `OidbFaceContent` — reference:20761. */
export const FaceContentField = { emojiList: 1, resourceUrl: 2 } as const;

/** `OidbFaceEmojiList` — reference:20870. */
export const FaceEmojiListField = { emojiPackName: 1, emojiDetail: 2 } as const;

/**
 * `OidbFaceEmoji` — reference:109134.
 *
 * ⚠️ widths/heights are fields **13** and **14**, not 11 and 12. See the header.
 */
export const FaceEmojiField = {
  qSid: 1,
  qDes: 2,
  emCode: 3,
  qCid: 4,
  aniStickerType: 5,
  aniStickerPackId: 6,
  aniStickerId: 7,
  url: 8,
  emojiNameAlias: 9,
  unknown10: 10,
  aniStickerWidth: 13,
  aniStickerHeight: 14,
} as const;

/** `OidbFaceResourceUrl` — reference:109449. */
export const FaceResourceUrlField = { baseUrl: 1, advUrl: 2 } as const;

/** `OidbFetchSysFaceReq` — reference:108591. One string field. */
export const FetchSysFaceReqField = { qSid: 1 } as const;

/** `OidbFetchSysFaceResp` — the `emoji` message plus one uint32. */
export const FetchSysFaceRespField = { emoji: 1, field2: 2 } as const;

// ===========================================================================
// Wire shapes
// ===========================================================================

export interface FaceResourceUrl {
  baseUrl: string;
  advUrl: string;
}

export interface FaceEmoji {
  qSid: string;
  qDes: string;
  emCode: string;
  /** int32 — `_val | 0`. */
  qCid: number | null;
  aniStickerType: number | null;
  aniStickerPackId: number | null;
  aniStickerId: number | null;
  url: FaceResourceUrl | null;
  emojiNameAlias: string[];
  /** Field 10. Unnamed in the reference's own decode result, so the name is descriptive. */
  unknown10: number | null;
  /** Field 13 — NOT 11. */
  aniStickerWidth: number | null;
  /** Field 14 — NOT 12. */
  aniStickerHeight: number | null;
}

export interface FaceEmojiList {
  emojiPackName: string;
  emojiDetail: FaceEmoji[];
}

export interface FaceContent {
  emojiList: FaceEmojiList[];
  resourceUrl: FaceResourceUrl | null;
}

export interface FetchSysFacesResp {
  field1: number;
  commonFace: FaceContent | null;
  specialBigFace: FaceContent | null;
  specialMagicFace: FaceContent | null;
}

export interface FetchSysFaceResp {
  emoji: FaceEmoji | null;
  field2: number | null;
}

// ===========================================================================
// Decoders
// ===========================================================================

export function decodeFaceResourceUrl(data: Uint8Array, offset = 0, end = data.length): FaceResourceUrl {
  const reader = new ProtoReader(data, offset, end);
  const result: FaceResourceUrl = { baseUrl: "", advUrl: "" };
  while (reader.next()) {
    switch (reader.fieldNumber) {
      case FaceResourceUrlField.baseUrl:
        result.baseUrl = reader.string();
        break;
      case FaceResourceUrlField.advUrl:
        result.advUrl = reader.string();
        break;
      default:
        reader.skip();
    }
  }
  return result;
}

/**
 * `OidbFaceEmoji` decoder.
 *
 * `url` stays `null` when the field is absent, rather than becoming `{}` — the
 * mapping reads `e.url?.baseUrl ?? null`, so an empty object would yield `""` where
 * the OneBot response must say `null`.
 */
export function decodeFaceEmoji(data: Uint8Array, offset = 0, end = data.length): FaceEmoji {
  const reader = new ProtoReader(data, offset, end);
  const result: FaceEmoji = {
    qSid: "",
    qDes: "",
    emCode: "",
    qCid: null,
    aniStickerType: null,
    aniStickerPackId: null,
    aniStickerId: null,
    url: null,
    emojiNameAlias: [],
    unknown10: null,
    aniStickerWidth: null,
    aniStickerHeight: null,
  };
  while (reader.next()) {
    switch (reader.fieldNumber) {
      case FaceEmojiField.qSid:
        result.qSid = reader.string();
        break;
      case FaceEmojiField.qDes:
        result.qDes = reader.string();
        break;
      case FaceEmojiField.emCode:
        result.emCode = reader.string();
        break;
      case FaceEmojiField.qCid:
        result.qCid = reader.int32();
        break;
      case FaceEmojiField.aniStickerType:
        result.aniStickerType = reader.int32();
        break;
      case FaceEmojiField.aniStickerPackId:
        result.aniStickerPackId = reader.int32();
        break;
      case FaceEmojiField.aniStickerId:
        result.aniStickerId = reader.int32();
        break;
      case FaceEmojiField.url:
        result.url = reader.message(decodeFaceResourceUrl);
        break;
      case FaceEmojiField.emojiNameAlias:
        result.emojiNameAlias.push(reader.string());
        break;
      case FaceEmojiField.unknown10:
        result.unknown10 = reader.int32();
        break;
      case FaceEmojiField.aniStickerWidth:
        result.aniStickerWidth = reader.int32();
        break;
      case FaceEmojiField.aniStickerHeight:
        result.aniStickerHeight = reader.int32();
        break;
      default:
        reader.skip();
    }
  }
  return result;
}

export function decodeFaceEmojiList(data: Uint8Array, offset = 0, end = data.length): FaceEmojiList {
  const reader = new ProtoReader(data, offset, end);
  const result: FaceEmojiList = { emojiPackName: "", emojiDetail: [] };
  while (reader.next()) {
    switch (reader.fieldNumber) {
      case FaceEmojiListField.emojiPackName:
        result.emojiPackName = reader.string();
        break;
      case FaceEmojiListField.emojiDetail:
        result.emojiDetail.push(reader.message(decodeFaceEmoji));
        break;
      default:
        reader.skip();
    }
  }
  return result;
}

export function decodeFaceContent(data: Uint8Array, offset = 0, end = data.length): FaceContent {
  const reader = new ProtoReader(data, offset, end);
  const result: FaceContent = { emojiList: [], resourceUrl: null };
  while (reader.next()) {
    switch (reader.fieldNumber) {
      case FaceContentField.emojiList:
        result.emojiList.push(reader.message(decodeFaceEmojiList));
        break;
      case FaceContentField.resourceUrl:
        result.resourceUrl = reader.message(decodeFaceResourceUrl);
        break;
      default:
        reader.skip();
    }
  }
  return result;
}

export function decodeFetchSysFacesResp(data: Uint8Array, offset = 0, end = data.length): FetchSysFacesResp {
  const reader = new ProtoReader(data, offset, end);
  const result: FetchSysFacesResp = {
    field1: 0,
    commonFace: null,
    specialBigFace: null,
    specialMagicFace: null,
  };
  while (reader.next()) {
    switch (reader.fieldNumber) {
      case FetchSysFacesRespField.field1:
        result.field1 = reader.uint32();
        break;
      case FetchSysFacesRespField.commonFace:
        result.commonFace = reader.message(decodeFaceContent);
        break;
      case FetchSysFacesRespField.specialBigFace:
        result.specialBigFace = reader.message(decodeFaceContent);
        break;
      case FetchSysFacesRespField.specialMagicFace:
        result.specialMagicFace = reader.message(decodeFaceContent);
        break;
      default:
        reader.skip();
    }
  }
  return result;
}

export function decodeFetchSysFaceResp(data: Uint8Array, offset = 0, end = data.length): FetchSysFaceResp {
  const reader = new ProtoReader(data, offset, end);
  const result: FetchSysFaceResp = { emoji: null, field2: null };
  while (reader.next()) {
    switch (reader.fieldNumber) {
      case FetchSysFaceRespField.emoji:
        result.emoji = reader.message(decodeFaceEmoji);
        break;
      case FetchSysFaceRespField.field2:
        result.field2 = reader.uint32();
        break;
      default:
        reader.skip();
    }
  }
  return result;
}

// ===========================================================================
// Encoders
// ===========================================================================

/**
 * `FetchSysFaces` request — exactly `10 07`.
 *
 * `serialize` supplies `{ field1: 0, field2: 7, field3: 0 }`; the writer's `!== 0`
 * guard drops fields 1 and 3 and emits field 2. See the header for why that matters.
 *
 * `field4` (a message) is never set by `serialize` and is not accepted here: adding a
 * knob for a field with no recorded purpose would invite a caller to fill it.
 */
export function encodeFetchSysFacesReq(body: { field2?: number | undefined } = {}): Uint8Array {
  const writer = new ProtoWriter();
  writer.uint32(FetchSysFacesReqField.field2, body.field2 ?? 7);
  return writer.finish();
}

/**
 * `FetchSysFace` request — the single `qSid` string at field 1.
 *
 * `qSid` is a STRING even for a numeric face id, because some faces use a Unicode
 * emoji as their id. Sending a varint would be a different message.
 */
export function encodeFetchSysFaceReq(body: { qSid: string }): Uint8Array {
  const writer = new ProtoWriter();
  writer.string(FetchSysFaceReqField.qSid, body.qSid);
  return writer.finish();
}

/** The two golden request bodies, exported so a test asserts the bytes, not a claim. */
export const REFERENCE_FETCH_SYS_FACES_BODY: readonly number[] = [0x10, 0x07];
export function referenceFetchSysFaceBody(faceId: number | string): readonly number[] {
  const text = String(faceId);
  return [0x0a, text.length, ...Buffer.from(text, "utf8")];
}

// ===========================================================================
// emojiToEntry — the wire→catalog mapping
// ===========================================================================

/** Where an entry came from, for the diagnostic messages. */
export interface FaceLocation {
  source: "common" | "special-big" | "magic" | "single";
  packIndex: number;
  faceIndex: number;
}

/** The catalog entry `emojiToEntry` produces. Mirrors `SystemFaceEntry` in the action layer. */
export interface CatalogFaceEntry {
  qSid: string;
  qDes: string;
  emCode: string;
  qCid: number | null;
  aniStickerType: number | null;
  aniStickerPackId: number | null;
  aniStickerId: number | null;
  url: string | null;
  emojiNameAlias: string[];
  aniStickerWidth: number | null;
  aniStickerHeight: number | null;
}

/**
 * `emojiToEntry` — reference:20980.
 *
 * Three outcomes, and the difference is the reason this is a function:
 *
 *   * no id and no field-1 wire evidence → `null` (entry skipped). A pack with a
 *     header-only or incomplete entry is normal, and skipping is not data loss.
 *   * an id that is not a string → THROW
 *     `"system face id has invalid decoded type at source …"`.
 *
 * The reference ADDITIONALLY inspects the decoder's unknown-field metadata for any
 * field-1 occurrence whose wire type the decoder did not accept, and throws
 * `"system face id uses unsupported wire encoding …"`. This port's decoder is
 * hand-written and accepts field 1 as UTF-8 only, so a non-string field 1 lands in
 * `skip()` and is invisible here — a **measured gap**, stated rather than papered
 * over: a future protocol change that switched the id to, say, a fixed64 would be
 * silently skipped by this port where the reference reports it. Closing it needs the
 * `UnknownFieldCollector` plumbed into the emoji decoder; the observable difference is
 * confined to that error message, since the actual id would still be missing and the
 * entry still skipped.
 */
export function emojiToEntry(emoji: FaceEmoji, location: FaceLocation): CatalogFaceEntry | null {
  const qSid = emoji.qSid;
  if (qSid == null || qSid === "") return null;
  if (typeof qSid !== "string") {
    throw new Error(
      `system face id has invalid decoded type at source ${location.source}, pack ${location.packIndex}, face ${location.faceIndex}: ${typeof qSid}`,
    );
  }
  return {
    qSid,
    qDes: emoji.qDes ?? "",
    emCode: emoji.emCode ?? "",
    qCid: emoji.qCid ?? null,
    aniStickerType: emoji.aniStickerType ?? null,
    aniStickerPackId: emoji.aniStickerPackId ?? null,
    aniStickerId: emoji.aniStickerId ?? null,
    url: emoji.url?.baseUrl ?? null,
    emojiNameAlias: emoji.emojiNameAlias ?? [],
    aniStickerWidth: emoji.aniStickerWidth ?? null,
    aniStickerHeight: emoji.aniStickerHeight ?? null,
  };
}

/** `emojisToEntries` — reference:21004. Skips the nulls, keeps the order. */
export function emojisToEntries(
  emojis: readonly FaceEmoji[],
  source: FaceLocation["source"],
  packIndex: number,
): CatalogFaceEntry[] {
  const entries: CatalogFaceEntry[] = [];
  for (const [faceIndex, emoji] of emojis.entries()) {
    const entry = emojiToEntry(emoji, { source, packIndex, faceIndex });
    if (entry) entries.push(entry);
  }
  return entries;
}

// ===========================================================================
// The two specs
// ===========================================================================

export interface FetchSysFacesParams {
  /** Overrides the `7` the reference hard-codes; the action never does. */
  field2?: number | undefined;
}

export interface CatalogPack {
  packName: string;
  emojis: CatalogFaceEntry[];
}

/**
 * `FetchSysFaces` — 0x9154_1.
 *
 * `deserialize`'s `"MagicFace"` substitution for a nameless MAGIC pack is in the
 * reference and user-visible in `pack_name`, so it is kept.
 */
export const FetchSysFaces: OidbSpec<
  FetchSysFacesParams,
  { field2?: number | undefined },
  FetchSysFacesResp,
  CatalogPack[]
> = {
  command: FETCH_SYS_FACES_COMMAND,
  subCommand: FETCH_SYS_FACES_SUB_COMMAND,
  serialize: () => ({ field2: 7 }),
  encodeBody: encodeFetchSysFacesReq,
  decodeBody: decodeFetchSysFacesResp,
  deserialize: (body) => {
    const packs: CatalogPack[] = [];
    const buckets: Array<[FaceLocation["source"], FaceContent | null]> = [
      ["common", body.commonFace],
      ["special-big", body.specialBigFace],
      ["magic", body.specialMagicFace],
    ];
    for (const [source, content] of buckets) {
      for (const list of content?.emojiList ?? []) {
        const packIndex = packs.length;
        packs.push({
          packName: list.emojiPackName || (source === "magic" ? "MagicFace" : ""),
          emojis: emojisToEntries(list.emojiDetail ?? [], source, packIndex),
        });
      }
    }
    return packs;
  },
};

export interface FetchSysFaceParams {
  faceId: number;
}

/**
 * `FetchSysFace` — 0x9155_1.
 *
 * The id-equality check is the caller's (`SysFaceStore.resolve`). See the header.
 */
export const FetchSysFace: OidbSpec<
  FetchSysFaceParams,
  { qSid: string },
  FetchSysFaceResp,
  CatalogFaceEntry | null
> = {
  command: FETCH_SYS_FACE_COMMAND,
  subCommand: FETCH_SYS_FACE_SUB_COMMAND,
  serialize: (params) => ({ qSid: String(params.faceId) }),
  encodeBody: encodeFetchSysFaceReq,
  decodeBody: decodeFetchSysFaceResp,
  deserialize: (body) => {
    if (!body.emoji) return null;
    const entry = emojiToEntry(body.emoji, { source: "single", packIndex: 0, faceIndex: 0 });
    if (!entry) throw new Error("system face lookup response is missing its id");
    return entry;
  },
};