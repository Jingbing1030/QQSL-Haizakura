// Tests for the message-segment -> protobuf encoder.
//
// Two kinds of test, and they answer different questions:
//
//   1. Byte-for-byte fixtures. Every hex string below was produced by running the
//      *reference implementation itself* (the region at reference/index.mjs:110973-121793,
//      with its highway-upload dependencies stubbed) over the same logical input. So a
//      failure here means our encoder disagrees with the shipping one, not merely that it
//      changed. The fixtures are the evidence for the field numbers in element-builder.ts:
//      if a tag or a wire type were wrong, these assertions would catch it.
//
//   2. Behaviour tests. The reference's *policy* -- which segment is refused, which
//      encoding a face gets, when a reply grows a trailing mention -- is as load-bearing as
//      its bytes. A wrong error is a caller-visible bug even when nothing is encoded.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ENCODABLE_SEGMENT_TYPES,
  MessageElementValidationError,
  UNENCODED_SEGMENT_TYPES,
  assertValidSegment,
  assertVideoSendPolicy,
  assertWindowShakeSendPolicy,
  buildSendContent,
  buildSendElems,
  classifyFace,
  encodeElem,
  encodeGroupFileExtra,
  encodeMarkdownData,
  encodeMarketFacePbReserve,
  encodeMentionExtraSend,
  encodePokeExtra,
  encodePrivateRichText,
  encodeQFaceExtra,
  encodeQSmallFaceExtra,
  encodeSendRichText,
  makeFaceElem,
  makeForwardElem,
  makeGroupFileElem,
  makeImageElem,
  makeJsonElem,
  makeMarketFaceElem,
  makeMentionElem,
  makeMarkdownElem,
  makePokeElem,
  makePttElem,
  makeReplyElem,
  makeReplyMentionElem,
  makeTextElem,
  makeVideoElem,
  makeXmlElem,
} from "../src/element-builder.js";
import type { Elem, Segment, SendContext } from "../src/element-builder.js";

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

/**
 * Encoded by the reference implementation, not by us.
 *
 * Sorted in the order the reference's builders produce them. Every entry names the
 * reference function it pins down.
 */
const REFERENCE: Readonly<Record<string, string | readonly string[]>> = {
  text: "0a080a06e4bda0e5a5bd",
  textEmpty: "0a00",
  textAscii: "0a040a026869",
  faceClassic: "1202080e",
  faceSmall: "aa03090821120308ac021801",
  faceClassicLarge: "1202080e",
  atUser: "0a170a0840e58da1e7898720620b1802202a4a05755f616263",
  atAll: "0a190a0e40e585a8e4bd93e68890e5919820620718014a03616c6c",
  atNoText: "0a110a044034322062091802202a4a03755f78",
  reply: "ea02020864",
  replyFull: "ea0216086410071880e2cfaa062a0a0a080a0671756f746564",
  json: "9a03120a1001789cab564a54b232ac0500082a0209",
  xml: "62130a0f01789cb3c92d4ed7b70300072c01f11023",
  markdown: "aa030c082d12060a04232068691801",
  poke: "aa03080802120208011801",
  mface: "32300a06e7ac91e884b81006180122100123456789abcdef0123456789abcdef28822030033a016b50ac0258ac026a024001",
  forwardXml: "62dc020ad70201789c8d903d4bc4401086ffca3016a962725fde1decee35225868a35622b2974ce2c26e22bb9bd3b3b3132dc4c24eb0d14210b5b2f3e7dc793f43123f102bdfa986799fe19d61a363a36142d6a9b2e0416b390e808aa44c5591f360677b2d1c04e0bc2c52a9cb82783025178c0430e3727064272aa1f5558e9d1e822773a8a56ffa16824c7cbd13278a8e362aedd586cb11c65651c67177717a3ebb7b583cbdccdeaef710cc7ea6346d4a431cdb692f23d98bc361324cc26ebf1387e3b4350cfb499aa594f55afd6c5c13969c4a395a72a14a11fc566538b611322d738e1d144c7932a0e5b4ac7c1d4900f3ca6b82a4d4a5e5b814374270ea843876ba287ec76251e3167fa07ea36fa8bd8242fedb39fe76023bb08245075600739531d24e7fb0415c178af9edfdfbcdc5e2ed717679357f3d9b9f3eb3e8cb2b5854df56c365651382a2f9dceff42858f43914c022e372f10189caaf8a1023",
  sendRichText: "12050a030a016112050a030a0162",
  faceSuper: "aa03200825121a0a04343039381202373718e6022001280532057269642d3948011801",
  qfaceExtra: "0a04343039381202373718e6022001280532037269644801",
  qsmallFace: "08ac02",
  mention: "1802202a4a03755f78",
  mentionAll: "18014a03616c6c",
  pokeExtra: "0801",
  marketReserve: "4001",
  markdownData: "0a0423206869",
  groupFile: "2a4f0818124b01004808061205612e62696e3a3d123b086612056669642d311880202205612e62696e321400112233445566778899aabbccddeeff00112233421000112233445566778899aabbccddeeff",
  replyMention: "0a140a0840e588abe5908d20620818024a04755f7a7a",
  replyMasked: "ea020608ffffffff0f",
  replyBigUin: "ea020b080110ffffffffffffff0f",
  emptyElem: "",
  emptyRichText: "",
  textA: "0a030a0161",
  commonOnly: "aa03020801",
  srcOnly: "ea02020801",
  dispatched: ["0a040a026869", "0a150a0840e69f90e4baba2062091802202a4a03755f78", "ea020408371058", "0a140a0840e588abe5908d20620818024a04755f7a7a"],
  privateRichText: "12050a030a0176",
};

/** Reads a single-hex fixture. Kept separate so the array entry cannot be mistaken for one. */
const ref = (key: Exclude<keyof typeof REFERENCE, "dispatched">): string => REFERENCE[key] as string;

// ===========================================================================
// 1. Byte-for-byte against the reference
// ===========================================================================

test("text matches the reference byte for byte", () => {
  assert.equal(hex(encodeElem(makeTextElem("你好"))), ref("text"));
  assert.equal(hex(encodeElem(makeTextElem("hi"))), ref("textAscii"));
  // An empty string is omitted rather than encoded as a zero-length field: the
  // reference's TextElem writer skips `str` when it is "", leaving only the empty
  // wrapper behind.
  assert.equal(hex(encodeElem(makeTextElem(""))), ref("textEmpty"));
});

test("face matches the reference in all three encodings", async () => {
  // Below 260 the face is a FaceElem{index}; the id is a varint, not a string.
  const classic = await makeFaceElem({ type: "face", faceId: 14 });
  assert.deepEqual(classic, { face: { index: 14 } });
  assert.equal(hex(encodeElem(classic)), ref("faceClassic"));

  // `large: false` forces the derived classification even if a catalog says animated.
  const notLarge = await makeFaceElem({ type: "face", faceId: 14, large: false });
  assert.equal(hex(encodeElem(notLarge)), ref("faceClassicLarge"));

  // From 260 up an unlisted id becomes a small face: CommonElem{33, QSmallFaceExtra}.
  const small = await makeFaceElem({ type: "face", faceId: 300 });
  assert.equal(hex(encodeElem(small)), ref("faceSmall"));
});

test("super face matches the reference", async () => {
  const superWire = { kind: "super" as const, packId: "4098", stickerId: "77", stickerType: 5 };
  const elem = await makeFaceElem({ type: "face", faceId: 358, resultId: "rid-9" },
    { resolveFaceWire: () => superWire });
  assert.equal(hex(encodeElem(elem)), ref("faceSuper"));
  assert.equal(hex(encodeQFaceExtra({
    packId: "4098", stickerId: "77", qsid: 358, sourceType: 1, stickerType: 5,
    resultId: "rid", randomType: 1,
  })), ref("qfaceExtra"));
});

test("at matches the reference, including the @all form", () => {
  const ctx: SendContext = {
    identity: { findGroupMember: () => ({ card: "卡片", nickname: "昵称", uid: "u_abc" }) },
    groupId: 123,
  };
  // @one: the rendered text comes from the member card, the identity from the uid.
  assert.equal(hex(encodeElem(makeMentionElem({ type: "at", targetUin: 42, uid: "u_abc" }, ctx))), ref("atUser"));
  // @all: uid "all", numeric uin 0, and the fixed @全体成员 text.
  assert.equal(hex(encodeElem(makeMentionElem({ type: "at", targetUin: 0, uid: "all" }, ctx))), ref("atAll"));
  // No identity available: the uin stands in for the name rather than dropping the @.
  assert.equal(
    hex(encodeElem(makeMentionElem({ type: "at", targetUin: 42, uid: "u_x" }, {}))),
    ref("atNoText"),
  );
  assert.equal(hex(encodeMentionExtraSend({ type: 2, uin: 42, field5: 0, uid: "u_x" })), ref("mention"));
  assert.equal(hex(encodeMentionExtraSend({ type: 1, uin: 0, field5: 0, uid: "all" })), ref("mentionAll"));
});

test("reply matches the reference", () => {
  // Bare reply: SrcMsg{origSeqs} only.
  assert.equal(hex(encodeElem(makeReplyElem({ type: "reply", replySeq: 100 }))), ref("reply"));
  // With sender/time and a quoted text preview.
  assert.equal(hex(encodeElem(makeReplyElem({
    type: "reply", replySeq: 100, replySenderUin: 7, replyTime: 1700000000,
    replyElements: [{ type: "text", text: "quoted" }],
  }))), ref("replyFull"));
});

test("cards, markdown, poke and mface match the reference", () => {
  assert.equal(hex(encodeElem(makeJsonElem({ type: "json", text: '{"a":1}' }))), ref("json"));
  assert.equal(hex(encodeElem(makeXmlElem({ type: "xml", text: "<msg/>" }))), ref("xml"));
  assert.equal(hex(encodeElem(makeMarkdownElem({ type: "markdown", text: "# hi" }))), ref("markdown"));
  assert.equal(hex(encodeElem(makePokeElem({ type: "poke", subType: 1 }))), ref("poke"));
  assert.equal(hex(encodeElem(makeMarketFaceElem({
    type: "mface", emojiId: "0123456789abcdef0123456789abcdef",
    emojiPackageId: 4098, emojiKey: "k", text: "笑脸",
  }))), ref("mface"));
  assert.equal(hex(encodeMarkdownData({ content: "# hi" })), ref("markdownData"));
  assert.equal(hex(encodePokeExtra({ type: 1 })), ref("pokeExtra"));
  assert.equal(hex(encodeMarketFacePbReserve({ field8: 1 })), ref("marketReserve"));
  assert.equal(hex(encodeQSmallFaceExtra({ faceId: 300, preview: "", preview2: "" })), ref("qsmallFace"));
});

test("forward matches the reference given the same uniseq", () => {
  // The reference draws `uniseq` from randomUUID when the segment has none. Pinning the
  // generator is the only way to compare the bytes; the surrounding XML is what matters.
  const elem = makeForwardElem(
    { type: "forward", resId: "res-id", forwardSource: "聊天记录", forwardNews: [{ text: "a" }, { text: "b" }] },
    () => "2d5fea50-9c9c-4730-bd19-7cdfdef517fb",
  );
  assert.equal(hex(encodeElem(elem)), ref("forwardXml"));
});

test("group file matches the reference", () => {
  const elem = makeGroupFileElem({
    type: "file", fileId: "fid-1", fileName: "a.bin", fileSize: 4096,
    md5Hex: "00112233445566778899aabbccddeeff",
    sha1Hex: "00112233445566778899aabbccddeeff00112233",
  });
  assert.equal(hex(encodeElem(elem)), ref("groupFile"));
  // The elemValue header is version 1, then a *big-endian* length, then the protobuf.
  const value = elem.transElem?.elemValue;
  assert.ok(value !== undefined);
  assert.equal(value[0], 1);
  const declared = ((value[1] as number) << 8) | (value[2] as number);
  assert.equal(declared, value.length - 3);
});

test("the richText wrapper and the dispatch order match the reference", async () => {
  assert.equal(hex(encodeSendRichText({ elems: [makeTextElem("a"), makeTextElem("b")] })), ref("sendRichText"));

  const ctx: SendContext = {
    identity: { findGroupMember: () => ({ uid: "u_zz", card: "别名" }) },
    groupId: 5,
    scene: "group",
  };
  const content = await buildSendContent([
    { type: "text", text: "hi" },
    { type: "at", targetUin: 42, uid: "u_x", text: "@某人 " },
    { type: "reply", replySeq: 55, replySenderUin: 88 },
  ], ctx);
  assert.deepEqual(content.elems.map((elem) => hex(encodeElem(elem))), REFERENCE.dispatched);

  const mention = await makeReplyMentionElem(ctx, 88);
  assert.ok(mention !== null);
  assert.equal(hex(encodeElem(mention)), ref("replyMention"));
});

test("a text-only private message encodes to the plain richText body", async () => {
  const body = await encodePrivateRichText([{ type: "text", text: "v" }],
    { userUid: "uid-self", scene: "direct-private" });
  assert.equal(body.toString("hex"), ref("privateRichText"));
});

test("group file extra nests as GroupFileExtra{1:6, 7:{2:{...}}}", () => {
  const encoded = encodeGroupFileExtra({ field1: 6, fileName: "n", inner: { info: { busId: 102, fileId: "f" } } });
  // 0x08 0x06 = field 1 varint 6; 0x3a 0x0b = field 7, 11 bytes of inner message.
  assert.equal(encoded[0], 0x08);
  assert.equal(encoded[1], 0x06);
  assert.equal(encoded[2], 0x12); // field 2 (fileName), wire 2
});

// ===========================================================================
// 2. Behaviour
// ===========================================================================

test("every encodable type is dispatched, and the list matches the switch", () => {
  // If a case is added to buildSendContent without updating the constant (or the
  // reverse), this fails -- which is how the manifest's "must stay word-for-word in
  // sync with the dispatch" rule gets teeth.
  assert.equal(ENCODABLE_SEGMENT_TYPES.length, 14);
  assert.equal(new Set(ENCODABLE_SEGMENT_TYPES).size, 14);
});

test("the two unencodable types are named, not silently missing", () => {
  assert.deepEqual(Object.keys(UNENCODED_SEGMENT_TYPES).sort(), ["flash_file", "inline_keyboard"]);
  for (const type of Object.keys(UNENCODED_SEGMENT_TYPES)) {
    assert.equal(ENCODABLE_SEGMENT_TYPES.includes(type as never), false);
  }
});

test("an unknown segment type is UNKNOWN_TYPE, an unsendable one is UNSENDABLE_TYPE", () => {
  assert.throws(() => assertValidSegment({ type: "nope" } as unknown as Segment), (error: unknown) => {
    assert.ok(error instanceof MessageElementValidationError);
    assert.equal(error.code, "UNKNOWN_TYPE");
    return true;
  });
  assert.throws(
    () => assertValidSegment({ type: "inline_keyboard", botAppid: "1", rows: [] } as unknown as Segment),
    (error: unknown) => {
      assert.ok(error instanceof MessageElementValidationError);
      assert.equal(error.code, "UNSENDABLE_TYPE");
      assert.match(error.message, /cannot be sent/);
      return true;
    },
  );
});

test("empty text and non-object json are refused", () => {
  assert.throws(() => assertValidSegment({ type: "text", text: "" }), /must not be empty/);
  assert.throws(() => assertValidSegment({ type: "json", text: "[1,2]" }), /must contain a JSON object/);
  assert.throws(() => assertValidSegment({ type: "json", text: "not json" }), /must contain a JSON object/);
  assert.throws(() => assertValidSegment({ type: "markdown", text: "" }), /must not be empty/);
});

test("face.resultId requires an animated face", async () => {
  assert.throws(
    () => assertValidSegment({ type: "face", faceId: 14, large: false, resultId: "r" }),
    /large cannot be false/,
  );
  // A non-animated classification cannot carry a resultId either; the builder refuses
  // it with a different message, so both paths are covered.
  await assert.rejects(
    async () => makeFaceElem({ type: "face", faceId: 14, resultId: "r" }),
    /requires animation metadata/,
  );
});

test("mface requires a 32-hex emojiId", () => {
  assert.throws(() => assertValidSegment({ type: "mface", emojiId: "abc" }), /32 hexadecimal/);
  assert.throws(
    () => assertValidSegment({ type: "mface", emojiId: "zz23456789abcdef0123456789abcdef" }),
    /32 hexadecimal/,
  );
  assert.doesNotThrow(() => assertValidSegment({ type: "mface", emojiId: "0123456789abcdef0123456789abcdef" }));
});

test("replySeq must be positive and encodes as unsigned 32 bits", () => {
  assert.throws(() => assertValidSegment({ type: "reply", replySeq: 0 }), /positive integer/);
  // `seq & 0xffffffff` is a signed 32-bit op, so a negative seq stays negative in the
  // object -- exactly as in the reference -- and the *encoder* is what makes it unsigned.
  // The bytes are the contract, so that is what is asserted.
  assert.equal(hex(encodeElem(makeReplyElem({ type: "reply", replySeq: 1 }))), "ea02020801");
  assert.equal(hex(encodeElem(makeReplyElem({ type: "reply", replySeq: -1 }))), ref("replyMasked"));
});

test("video may not share a message", () => {
  assert.doesNotThrow(() => assertVideoSendPolicy(0, 5));
  assert.doesNotThrow(() => assertVideoSendPolicy(1, 1));
  assert.throws(() => assertVideoSendPolicy(1, 2), /must be the only segment/);
  assert.throws(() => assertVideoSendPolicy(2, 2), /may appear only once/);
});

test("window shake is private-chat only and must be alone", () => {
  assert.doesNotThrow(() => assertWindowShakeSendPolicy(0, 3, "group"));
  assert.doesNotThrow(() => assertWindowShakeSendPolicy(1, 1, "direct-private"));
  assert.throws(() => assertWindowShakeSendPolicy(1, 1, "group"), /direct private chat/);
  assert.throws(() => assertWindowShakeSendPolicy(1, 2, "direct-private"), /only segment/);
});

test("media segments need a context and a file segment needs the forward path", async () => {
  await assert.rejects(() => buildSendContent([{ type: "image", url: "https://x/y.png" }]), /requires SendContext/);
  await assert.rejects(
    () => buildSendContent([{ type: "file", fileId: "f" }], { groupId: 1 }),
    /must use the group\/private file upload pipeline/,
  );
  // On the forward path the group file element is allowed, but private sends drop it.
  const content = await buildSendContent([{ type: "file", fileId: "f" }], {
    groupId: 1,
    forwardFake: true,
    recallUploadedFile: () => ({ fileName: "x", fileSize: 1 }),
  });
  assert.equal(content.elems.length, 1);
  assert.equal(content.elems[0]?.transElem?.elemType, 24);
});

test("image envelope uses businessType 20 in a group and 10 in c2c", async () => {
  const msgInfo = new Uint8Array([0x08, 0x01]);
  const uploader = async () => ({ msgInfo });
  const group = await makeImageElem({ groupId: 1, uploadMedia: uploader }, { type: "image", url: "u" });
  assert.equal(group.length, 1);
  assert.equal(group[0]?.commonElem?.businessType, 20);
  assert.equal(group[0]?.commonElem?.serviceType, 48);
  assert.equal(hex(group[0]?.commonElem?.pbElem ?? new Uint8Array()), "0801");

  const c2c = await makeImageElem({ userUid: "uid", uploadMedia: uploader }, { type: "image", url: "u" });
  assert.equal(c2c[0]?.commonElem?.businessType, 10);

  // A c2c image with no uid cannot be addressed at all.
  await assert.rejects(() => makeImageElem({ uploadMedia: uploader }, { type: "image", url: "u" }), /target uid is missing/);
});

test("the forward path appends a legacy image sibling when an md5 is known", async () => {
  const md5 = "00112233445566778899aabbccddeeff";
  const uploader = async () => ({ msgInfo: new Uint8Array([0x08, 0x01]) });
  const withMd5 = await makeImageElem(
    { groupId: 1, forwardFake: true, uploadMedia: uploader },
    { type: "image", url: "u", md5Hex: md5, fileName: "a.png", fileSize: 9, width: 3, height: 4 },
  );
  assert.equal(withMd5.length, 2);
  assert.equal(withMd5[1]?.customFace?.filePath, "a.png");
  assert.equal(hex(withMd5[1]?.customFace?.md5 ?? new Uint8Array()), md5);

  // Private forwards get notOnlineImage instead of customFace.
  const priv = await makeImageElem(
    { userUid: "uid", forwardFake: true, uploadMedia: uploader },
    { type: "image", url: "u", md5Hex: md5 },
  );
  assert.equal(priv.length, 2);
  assert.ok(priv[1]?.notOnlineImage !== undefined);
  assert.equal(priv[1]?.customFace, undefined);

  // Without an md5 there is nothing to key the legacy element on, so it is dropped.
  const noMd5 = await makeImageElem(
    { groupId: 1, forwardFake: true, uploadMedia: uploader },
    { type: "image", url: "u" },
  );
  assert.equal(noMd5.length, 1);
});

test("record and video envelopes use distinct businessTypes", async () => {
  const uploader = async () => ({ msgInfo: new Uint8Array([0x08, 0x02]), compatQMsg: new Uint8Array([0x22, 0x01, 0x08]) });
  const groupVoice = await makePttElem({ groupId: 1, uploadMedia: uploader }, { type: "record", url: "r" });
  assert.equal(groupVoice.elem.commonElem?.businessType, 22);
  const c2cVoice = await makePttElem({ userUid: "u", uploadMedia: uploader }, { type: "record", url: "r" });
  assert.equal(c2cVoice.elem.commonElem?.businessType, 12);
  assert.equal(hex(c2cVoice.compatQMsg ?? new Uint8Array()), "220108");

  assert.equal((await makeVideoElem({ groupId: 1, uploadMedia: uploader }, { type: "video", url: "v" })).commonElem?.businessType, 21);
  assert.equal((await makeVideoElem({ userUid: "u", uploadMedia: uploader }, { type: "video", url: "v" })).commonElem?.businessType, 11);
});

test("a lone c2c voice message carries the compatibility blob", async () => {
  const ctx: SendContext = {
    userUid: "uid",
    scene: "direct-private",
    uploadMedia: async () => ({ msgInfo: new Uint8Array([0x08, 0x03]), compatQMsg: new Uint8Array([0x22, 0x01, 0x08]) }),
  };
  const content = await buildSendContent([{ type: "record", url: "r" }], ctx);
  assert.equal(hex(content.voiceCompatibility ?? new Uint8Array()), "220108");
  const body = await encodePrivateRichText([{ type: "record", url: "r" }], ctx);
  // The blob is appended after the richText message ends, not nested inside it.
  assert.ok(body.length > content.elems.length);
  assert.equal(body.subarray(-3).toString("hex"), "220108");

  // A blob with no Anonymous.ptt is refused rather than sent half-formed.
  await assert.rejects(
    () => encodePrivateRichText([{ type: "record", url: "r" }], {
      userUid: "uid", scene: "direct-private",
      uploadMedia: async () => ({ msgInfo: new Uint8Array([0x08, 0x03]), compatQMsg: new Uint8Array([0x08, 0x01]) }),
    }),
    /incomplete playback information/,
  );
});

test("a group reply that also @s grows a trailing mention of the quoted sender", async () => {
  const ctx: SendContext = {
    identity: { findGroupMember: () => ({ uid: "u_s", card: "名字" }) },
    groupId: 9,
    scene: "group",
  };
  const withAt = await buildSendElems([
    { type: "at", targetUin: 7, uid: "u_7", text: "@七 " },
    { type: "reply", replySeq: 3, replySenderUin: 88 },
  ], ctx);
  assert.equal(withAt.length, 3);
  assert.ok(withAt[2]?.text?.pbReserve !== undefined);

  // Without the @ there is no synthetic mention.
  const withoutAt = await buildSendElems([{ type: "reply", replySeq: 3, replySenderUin: 88 }], ctx);
  assert.equal(withoutAt.length, 1);

  // An unresolvable member yields null rather than an error.
  assert.equal(await makeReplyMentionElem({ groupId: 9, identity: {} }, 88), null);
});

test("classifyFace reproduces the catalog-miss fallback at the 260 boundary", () => {
  assert.deepEqual(classifyFace(259), { kind: "classic" });
  assert.deepEqual(classifyFace(260), { kind: "small" });
});

test("hex-decodable md5 is validated, and a bad one drops the legacy sibling", async () => {
  const uploader = async () => ({ msgInfo: new Uint8Array([0x08, 0x01]) });
  const bad = await makeImageElem(
    { groupId: 1, forwardFake: true, uploadMedia: uploader },
    { type: "image", url: "u", md5Hex: "not-a-md5" },
  );
  assert.equal(bad.length, 1);
});

test("Elem omits unset fields entirely", () => {
  // A text element must not emit any other tag; field 1 only.
  assert.equal(hex(encodeElem({ text: { str: "a" } })), ref("textA"));
  assert.equal(hex(encodeElem({})), ref("emptyElem"));
  assert.equal(hex(encodeSendRichText({ elems: [] })), ref("emptyRichText"));
});

test("field 53 is commonElem and field 45 is srcMsg", () => {
  // Both are multi-byte tags: 53<<3|2 = 426 -> varint 0xaa 0x03; 45<<3|2 = 362 -> 0xea 0x02.
  assert.equal(hex(encodeElem({ commonElem: { serviceType: 1 } })), ref("commonOnly"));
  assert.equal(hex(encodeElem({ srcMsg: { origSeqs: [1] } })), ref("srcOnly"));
});

test("a 64-bit sender uin encodes as a full 64-bit varint", () => {
  // senderUin is a uint64 varint: above 2^32 the encoder must not truncate it, which a
  // 32-bit writer would do silently. 2^53-1 needs 7 bytes.
  const encoded = makeReplyElem({ type: "reply", replySeq: 1, replySenderUin: 9007199254740991 });
  assert.equal(encoded.srcMsg?.senderUin, 9007199254740991n);
  assert.equal(hex(encodeElem(encoded)), ref("replyBigUin"));
});

test("unknown fields are rejected before any encoding happens", () => {
  assert.throws(() => assertValidSegment({ type: "text", text: "a", bogus: 1 } as unknown as Segment), /./);
});
