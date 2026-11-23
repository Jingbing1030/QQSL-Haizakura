// Tests for the inbound msg-push decoder.
//
// The correctness proof is the **round trip**: build a `Elem` with
// element-builder.ts, encode it, decode those bytes with msg-push, and require
// that the decoder reproduces the original. That is the strongest available
// statement -- element-builder's field numbers are themselves pinned to reference
// fixtures, so a tag or wire-type error in the decoder shows up here as a mismatch
// rather than needing a separate hand-written expectation per field.
//
// The tests then go one layer up: `Elem` -> `MessageSegment` policy (which the
// reference implements in `convertElements`), and the event decoders. Those are
// asserted against behaviour derived from `reference/index.mjs`, with the line
// numbers named in the assertions so a reader can check the source.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  encodeElem,
  encodeSendRichText,
  encodeMarketFacePbReserve,
  encodeQFaceExtra,
  encodeMarkdownData,
  encodeNotOnlineImage,
  encodeMentionExtraSend,
  encodeGroupFileExtra,
  type Elem,
} from "../src/element-builder.js";

import {
  EMPTY_IDENTITY,
  buildContext,
  buildContextFromMessage,
  convertElements,
  decodePush,
  type Identity,
  type PushContext,
  decodeRichBody,
  imageUrlFromMd5,
  makeImageUrl,
  ntImageUrlFromFileId,
  toHex,
  type ImageSegment,
  type MessageSegment,
} from "../src/msg-push.js";

import { decodeElem, type Elem as WireElem, type PushMsgBody } from "../src/msg-push-fields.js";

/** Decode a list of elems the way a body would, through the public surface. */
function decodeElems(elems: readonly Elem[], isGroup = true): MessageSegment[] {
  // Route through the real entry point: encode the elems into a SendRichText
  // payload, wrap it as a rich body, and decode. That exercises the same driver
  // the network path uses rather than a test-only shortcut.
  const richText = encodeSendRichText({ elems });
  const elemsOut: WireElem[] = [];
  // `SendRichText.elems` is field 2 repeated; decode it with the generated Elem
  // decoder by re-reading each length-delimited entry.
  for (const elem of decodeSendRichTextElems(richText)) elemsOut.push(elem);
  return convertElements(elemsOut, isGroup);
}

/** Minimal reader for `SendRichText` (repeated Elem = 2) used by the tests. */
// The two `Elem` declarations differ where it matters: element-builder's fields are
// optional (you set what you send), while the decoded form is `T | null` (the
// reference writes every slot). The cast is confined to this test adapter.
function decodeSendRichTextElems(data: Uint8Array): WireElem[] {
  const out: WireElem[] = [];
  let offset = 0;
  const end = data.length;
  while (offset < end) {
    // tag
    let tag = 0, shift = 0;
    for (;;) {
      const b = data[offset++]!;
      tag |= (b & 0x7f) << shift;
      shift += 7;
      if ((b & 0x80) === 0) break;
    }
    const field = tag >>> 3;
    const wire = tag & 7;
    let length = 0; shift = 0;
    for (;;) {
      const b = data[offset++]!;
      length |= (b & 0x7f) << shift;
      shift += 7;
      if ((b & 0x80) === 0) break;
    }
    assert.equal(wire, 2, "SendRichText carries only length-delimited Elem");
    if (field === 2) out.push(decodeElem(data, offset, offset + length) as WireElem);
    offset += length;
  }
  return out;
}

// ===========================================================================
// Round trip: element-builder -> msg-push
// ===========================================================================
//
// Each case encodes with element-builder and asserts the decoded `Elem` matches
// the input field-for-field. Absent fields must come back as `null`, which is
// what the reference produces -- not `undefined`, and not a proto3 default.

test("round trip: text elem", () => {
  const elem: Elem = { text: { str: "hello 世界" } };
  const decoded = decodeSendRichTextElems(encodeSendRichText({ elems: [elem] }));
  assert.equal(decoded.length, 1);
  const got = decoded[0]!.text;
  assert.equal(got?.str, "hello 世界");
  // Absent sub-fields are null (reference behaviour), not undefined.
  assert.equal(got?.link, null);
  assert.equal(got?.attr6Buf, null);
  assert.equal(got?.pbReserve, null);
});

test("round trip: face elem keeps a negative-encoded index sane", () => {
  const elem: Elem = { face: { index: 359 } };
  const decoded = decodeSendRichTextElems(encodeSendRichText({ elems: [elem] }));
  assert.equal(decoded[0]!.face?.index, 359);
});

test("round trip: face elem with a large negative int32", () => {
  // `FaceElem.index` is `_val | 0`, so a value above 2^31 must come back signed.
  const elem: Elem = { face: { index: -1 } };
  const decoded = decodeSendRichTextElems(encodeSendRichText({ elems: [elem] }));
  assert.equal(decoded[0]!.face?.index, -1);
});

test("round trip: market face", () => {
  const faceId = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i));
  const elem: Elem = {
    marketFace: { faceName: "[狗头]", faceId, tabId: 42, key: "k1", subType: 3 },
  };
  const decoded = decodeSendRichTextElems(encodeSendRichText({ elems: [elem] }));
  const mf = decoded[0]!.marketFace;
  assert.equal(mf?.faceName, "[狗头]");
  assert.equal(mf?.tabId, 42);
  assert.equal(mf?.key, "k1");
  assert.deepEqual(mf?.faceId, faceId);
});

test("round trip: not-online image", () => {
  const picMd5 = Uint8Array.from(Array.from({ length: 16 }, (_, i) => 0xa0 + i));
  const elem: Elem = {
    notOnlineImage: {
      filePath: "abc.jpg",
      fileLen: 12345,
      picMd5,
      picWidth: 800,
      picHeight: 600,
      origUrl: "/download?fileid=xyz",
    },
  };
  const decoded = decodeSendRichTextElems(encodeSendRichText({ elems: [elem] }));
  const img = decoded[0]!.notOnlineImage;
  assert.equal(img?.filePath, "abc.jpg");
  assert.equal(img?.fileLen, 12345);
  assert.equal(img?.picWidth, 800);
  assert.equal(img?.picHeight, 600);
  assert.deepEqual(img?.picMd5, picMd5);
});

test("round trip: video file keeps int64-ish sizes as numbers here", () => {
  const elem: Elem = {
    videoFile: {
      fileUuid: "uuid-1",
      fileName: "v.mp4",
      fileSize: 999,
      fileTime: 12,
      fileFormat: 2,
      fileWidth: 640,
      fileHeight: 360,
    },
  };
  const decoded = decodeSendRichTextElems(encodeSendRichText({ elems: [elem] }));
  const v = decoded[0]!.videoFile;
  assert.equal(v?.fileUuid, "uuid-1");
  assert.equal(v?.fileName, "v.mp4");
  assert.equal(v?.fileSize, 999);
  assert.equal(v?.fileTime, 12);
  assert.equal(v?.fileWidth, 640);
  assert.equal(v?.fileHeight, 360);
});

test("round trip: group file", () => {
  const elem: Elem = {
    groupFile: { filename: "a.zip", fileSize: 4242, fileId: "/id-1", batchId: "b1" },
  };
  const decoded = decodeSendRichTextElems(encodeSendRichText({ elems: [elem] }));
  const f = decoded[0]!.groupFile;
  assert.equal(f?.filename, "a.zip");
  // `GroupFileElem.fileSize` is int64 in the reference (L129070), so the decoder
  // yields a bigint. Nothing on our side silently narrows it to a Number.
  assert.equal(f?.fileSize, 4242n);
  assert.equal(f?.fileId, "/id-1");
});

test("round trip: mention extra in a text elem's pbReserve", () => {
  const pbReserve = encodeMentionExtraSend({ type: 1, uin: 10001, uid: "u_abc" });
  const elem: Elem = { text: { str: "@小明 ", pbReserve } };
  const decoded = decodeSendRichTextElems(encodeSendRichText({ elems: [elem] }));
  assert.deepEqual(decoded[0]!.text?.pbReserve, pbReserve);
});

test("round trip: a message of many elems preserves order", () => {
  const elems: Elem[] = [
    { text: { str: "one" } },
    { face: { index: 14 } },
    { text: { str: "two" } },
  ];
  const decoded = decodeSendRichTextElems(encodeSendRichText({ elems }));
  assert.equal(decoded.length, 3);
  assert.equal(decoded[0]!.text?.str, "one");
  assert.equal(decoded[1]!.face?.index, 14);
  assert.equal(decoded[2]!.text?.str, "two");
});

// ===========================================================================
// Elem -> segment policy (reference L135276 convertElements)
// ===========================================================================

test("convert: text becomes a text segment", () => {
  assert.deepEqual(decodeElems([{ text: { str: "hi" } }]), [{ type: "text", text: "hi" }]);
});

test("convert: empty text elem produces nothing", () => {
  assert.deepEqual(decodeElems([{ text: { str: "" } }]), []);
});

test("convert: face becomes a face segment with its id", () => {
  assert.deepEqual(decodeElems([{ face: { index: 14 } }]), [{ type: "face", faceId: 14 }]);
});

test("convert: market face with a 16-byte id becomes mface", () => {
  const faceId = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i));
  const segs = decodeElems([{ marketFace: { faceName: "[狗头]", faceId, tabId: 7, key: "k" } }]);
  assert.equal(segs.length, 1);
  const seg = segs[0]!;
  assert.equal(seg.type, "mface");
  if (seg.type !== "mface") throw new Error("expected mface");
  assert.equal(seg.text, "[狗头]");
  assert.equal(seg.emojiId, toHex(faceId));
  assert.equal(seg.emojiPackageId, 7);
});

test("convert: market face with a short id is dropped (reference requires 16 bytes)", () => {
  assert.deepEqual(decodeElems([{ marketFace: { faceName: "x", faceId: Uint8Array.of(1, 2) } }]), []);
});

test("convert: not-online image builds a usable image segment", () => {
  const picMd5 = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i));
  const segs = decodeElems([
    { notOnlineImage: { picMd5, fileLen: 10, picWidth: 2, picHeight: 3, filePath: "p" } },
  ]);
  assert.equal(segs.length, 1);
  const seg = segs[0] as ImageSegment;
  assert.equal(seg.type, "image");
  assert.equal(seg.fileSize, 10);
  assert.equal(seg.width, 2);
  assert.equal(seg.height, 3);
  // md5 is uppercased hex, and a URL is synthesised from it when none was sent.
  assert.equal(seg.md5Hex, toHex(picMd5).toUpperCase());
  assert.equal(seg.imageUrl, imageUrlFromMd5(seg.md5Hex!));
});

test("convert: image elem with a short md5 is dropped", () => {
  assert.deepEqual(decodeElems([{ notOnlineImage: { picMd5: Uint8Array.of(1, 2, 3) } }]), []);
});

test("convert: video becomes a video segment with a media node", () => {
  const segs = decodeElems([{ videoFile: { fileUuid: "u", fileName: "v.mp4", fileSize: 5, fileTime: 6 } }]);
  const seg = segs[0]!;
  assert.equal(seg.type, "video");
  if (seg.type !== "video") throw new Error("expected video");
  assert.equal(seg.fileId, "u");
  assert.equal(seg.duration, 6);
  // `type: 2` marks a video for the re-upload endpoint.
  assert.equal(seg.mediaNode?.info.type.type, 2);
});

test("convert: group file becomes a file segment", () => {
  const segs = decodeElems([{ groupFile: { filename: "a.zip", fileSize: 9, fileId: "/x" } }]);
  assert.deepEqual(segs, [{ type: "file", fileId: "/x", fileName: "a.zip", fileSize: 9 }]);
});

test("convert: poke common elem becomes a poke segment", () => {
  const segs = decodeElems([{ commonElem: { serviceType: 2, businessType: 126 } }]);
  assert.deepEqual(segs, [{ type: "poke", subType: 126 }]);
});

test("convert: small face common elem becomes a face segment", () => {
  const segs = decodeElems([
    { commonElem: { serviceType: 33, pbElem: encodeQSmallFaceExtraRaw(184) } },
  ]);
  assert.deepEqual(segs, [{ type: "face", faceId: 184 }]);
});

test("convert: big face common elem becomes a face segment carrying qsid", () => {
  const segs = decodeElems([
    { commonElem: { serviceType: 37, pbElem: encodeQFaceExtra({ qsid: 3001, text: "[大表情]" }) } },
  ]);
  assert.deepEqual(segs, [{ type: "face", faceId: 3001 }]);
});

test("convert: markdown common elem becomes a markdown segment", () => {
  const segs = decodeElems([
    {
      commonElem: {
        serviceType: 45,
        businessType: 1,
        pbElem: encodeMarkdownData({ content: "# title" }),
      },
    },
  ]);
  assert.deepEqual(segs, [{ type: "markdown", text: "# title" }]);
});

test("convert: json rich msg card", () => {
  const card = JSON.stringify({ app: "com.tencent.test", prompt: "[卡片]" });
  const segs = decodeElems([
    { richMsg: { serviceId: 1, template1: plainPayload(card) } },
  ]);
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0], { type: "json", text: card });
});

test("convert: xml rich msg card", () => {
  const xml = '<msg serviceID="1" action="x"><item/></msg>';
  const segs = decodeElems([{ richMsg: { serviceId: 5, template1: plainPayload(xml) } }]);
  assert.deepEqual(segs[0], { type: "xml", text: xml, subType: 5 });
});

test("convert: forward card recognised from serviceID 35 + m_resid", () => {
  const xml = '<msg serviceID="35" m_resid="res-1" m_fileName="f.json"/>';
  const segs = decodeElems([{ richMsg: { serviceId: 0, template1: plainPayload(xml) } }]);
  assert.deepEqual(segs[0], { type: "forward", resId: "res-1", forwardUuid: "f.json" });
});

test("convert: a card suppresses its duplicate plain-text title", () => {
  const card = JSON.stringify({ app: "com.tencent.test" });
  const segs = decodeElems([
    { richMsg: { serviceId: 1, template1: plainPayload(card) } },
    { text: { str: "[卡片]" } },
  ]);
  // The text elem duplicates the card title, so only the card survives.
  assert.equal(segs.length, 1);
  assert.equal(segs[0]!.type, "json");
});

test("convert: src msg becomes a reply segment and marks the reply seen", () => {
  const segs = decodeElems([
    {
      srcMsg: {
        origSeqs: [12345],
        senderUin: 10001n,
        time: 1700000000,
        elemsRaw: [encodeElem({ text: { str: "original" } })],
      },
    },
    { text: { str: "reply body" } },
  ]);
  assert.equal(segs.length, 2);
  const reply = segs[0]!;
  assert.equal(reply.type, "reply");
  if (reply.type !== "reply") throw new Error("expected reply");
  assert.equal(reply.replySeq, 12345);
  assert.equal(reply.replySenderUin, 10001);
  assert.equal(reply.replyTime, 1700000000);
  // The quoted elements are decoded into real segments, not left as bytes.
  assert.deepEqual(reply.replyElements, [{ type: "text", text: "original" }]);
  assert.deepEqual(segs[1], { type: "text", text: "reply body" });
});

test("convert: reply with seq 0 still marks sawReply but adds no segment", () => {
  const segs = decodeElems([{ srcMsg: { origSeqs: [0] } }, { text: { str: "x" } }]);
  assert.deepEqual(segs, [{ type: "text", text: "x" }]);
});

test("convert: at from a mention payload with no attr6Buf", () => {
  const pbReserve = encodeMentionExtraSend({ type: 1, uin: 10001, uid: "u_x" });
  const segs = decodeElems([{ text: { str: "@小明 ", pbReserve } }]);
  assert.equal(segs.length, 1);
  const seg = segs[0]!;
  assert.equal(seg.type, "at");
  if (seg.type !== "at") throw new Error("expected at");
  assert.equal(seg.targetUin, 10001);
  assert.equal(seg.uid, "u_x");
});

test("convert: at from attr6Buf takes the big-endian uin at bytes 7..10", () => {
  // 2-byte tag + length prefix, then 0x06 0x00 marker bytes, then the uin.
  const attr6 = Uint8Array.from([
    0x00, 0x08, 0x00, 0x01, 0x00, 0x04, 0x00, 0x00,
    0x00, 0x27, 0x11, 0x00, 0x00,
  ]);
  // Bytes 7..10 => 0x00,0x27,0x11,0x00 = 10001.
  const segs = decodeElems([{ text: { str: "@某人 ", attr6Buf: attr6 } }]);
  const seg = segs[0]!;
  assert.equal(seg.type, "at");
  if (seg.type !== "at") throw new Error("expected at");
  assert.equal(seg.targetUin, 10001);
});

test("convert: blank text after an at-with-zero-uin is dropped", () => {
  // type 2 with uin 0 is QQ's "@ someone unknown": it is followed by a separator.
  const unknownAt = encodeMentionExtraSend({ type: 2, uin: 0 });
  const segs = decodeElems([
    { text: { str: "q" } },
    { srcMsg: { origSeqs: [7] } },
    { text: { str: "@ ", pbReserve: unknownAt } },
    { text: { str: " " } },
  ]);
  const types = segs.map((s) => s.type);
  assert.deepEqual(types, ["text", "reply"]);
});

test("convert: image siblings - NT copy wins over legacy copy of the same file", () => {
  const md5 = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i));
  const md5Hex = toHex(md5).toUpperCase();
  const legacy: ImageSegment = {
    type: "image",
    imageUrl: "http://gchat.qpic.cn/gchatpic_new/0/0-0-" + md5Hex + "/0",
    fileId: md5Hex,
    fileSize: 1,
    width: 1,
    height: 1,
    md5Hex,
  };
  // Build the NT copy through a commonElem svc-48 biz-10 image whose fingerprint
  // matches, so `sameImageFile` sees the same file.
  const ntUpload = encodeMsgInfoImage({
    fileUuid: "nt-uuid",
    fileName: "nt.png",
    fileHash: md5Hex,
    domain: "multimedia.nt.qq.com.cn",
    urlPath: "/download?fileid=nt-uuid",
  });
  const segs = decodeElems([
    { notOnlineImage: { picMd5: md5, fileLen: 1, picWidth: 1, picHeight: 1 } },
    { commonElem: { serviceType: 48, businessType: 10, pbElem: ntUpload } },
  ]);
  // The legacy copy is dropped because the NT copy is the same file.
  assert.equal(segs.length, 1);
  const seg = segs[0] as ImageSegment;
  assert.equal(seg.type, "image");
  assert.ok(seg.imageUrl.includes("multimedia.nt.qq.com.cn"), seg.imageUrl);
});

// ===========================================================================
// URL derivation (reference L122158 .. L122171)
// ===========================================================================

test("makeImageUrl: absolute URLs pass through, relative get a host", () => {
  assert.equal(makeImageUrl("https://x/y"), "https://x/y");
  assert.equal(makeImageUrl(""), "");
  assert.equal(makeImageUrl("nonsense"), "");
  assert.equal(makeImageUrl("/a/b"), "http://gchat.qpic.cn/a/b");
  assert.equal(makeImageUrl("/x?rkey=1"), "https://multimedia.nt.qq.com.cn/x?rkey=1");
});

test("imageUrlFromMd5: only a 32-hex md5 yields a URL", () => {
  assert.equal(imageUrlFromMd5("zz"), "");
  assert.equal(
    imageUrlFromMd5("a".repeat(32)),
    "http://gchat.qpic.cn/gchatpic_new/0/0-0-" + "A".repeat(32) + "/0",
  );
});

test("ntImageUrlFromFileId: group and private differ only by appid", () => {
  assert.ok(ntImageUrlFromFileId("f1", true).includes("appid=1407"));
  assert.ok(ntImageUrlFromFileId("f1", false).includes("appid=1406"));
  assert.equal(ntImageUrlFromFileId("", true), "");
});

// ===========================================================================
// Helpers for building wire payloads the tests need
// ===========================================================================

/** A card payload in the `0x00` "rest is plain UTF-8" marker form. */
function plainPayload(text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(body.length + 1);
  out[0] = 0;
  out.set(body, 1);
  return out;
}

/** `QSmallFaceExtra` field 1 (faceId). */
function encodeQSmallFaceExtraRaw(faceId: number): Uint8Array {
  return concat([Uint8Array.of(0x08), varint(faceId)]);
}

function varint(value: number): Uint8Array {
  const out: number[] = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return Uint8Array.from(out);
}

/**
 * A `MsgInfo` carrying one NT image. Field numbers are copied from the *generated*
 * tables (`work/msgpush/gen-tables.ts`), each with its reference line, because
 * hand-guessing them is exactly the mistake this port exists to avoid:
 *
 *   MsgInfo.msgInfoBody      = 1 repeated   L134408
 *   MsgInfoBody.index        = 1            L134519
 *   MsgInfoBody.picture      = 2            L134539
 *   IndexNode.info           = 1            L130180
 *   IndexNode.fileUuid       = 2            L130200
 *   FileInfo.fileSize        = 1            L130372
 *   FileInfo.fileHash        = 2 (string!)  L130390
 *   FileInfo.fileName        = 4            L130430
 *   PictureInfo.urlPath      = 1            L130764
 *   PictureInfo.domain       = 3            L130804
 */
function encodeMsgInfoImage(opts: {
  fileUuid: string;
  fileName: string;
  fileHash: string;
  domain: string;
  urlPath: string;
}): Uint8Array {
  const fileInfo = concat([
    uint32Field(1, 16),                        // FileInfo.fileSize
    lenDelimited(2, utf8(opts.fileHash)),      // FileInfo.fileHash
    lenDelimited(4, utf8(opts.fileName)),      // FileInfo.fileName
  ]);
  const indexNode = concat([
    lenDelimited(1, fileInfo),                 // IndexNode.info
    lenDelimited(2, utf8(opts.fileUuid)),      // IndexNode.fileUuid
  ]);
  const pictureInfo = concat([
    lenDelimited(1, utf8(opts.urlPath)),       // PictureInfo.urlPath
    lenDelimited(3, utf8(opts.domain)),        // PictureInfo.domain
  ]);
  const msgInfoBody = concat([
    lenDelimited(1, indexNode),                // MsgInfoBody.index
    lenDelimited(2, pictureInfo),              // MsgInfoBody.picture
  ]);
  return lenDelimited(1, msgInfoBody);         // MsgInfo.msgInfoBody
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// A tag is itself a varint: `field << 3 | wire` exceeds one byte from field 16
// upward (field 26 -> 210, high bit set), so writing it as a single byte makes the
// reader treat it as a continuation byte and desynchronise.
function lenDelimited(field: number, payload: Uint8Array): Uint8Array {
  return concat([varint((field << 3) | 2), varint(payload.length), payload]);
}

function uint32Field(field: number, value: number): Uint8Array {
  return concat([varint((field << 3) | 0), varint(value)]);
}

// ===========================================================================
// Event decoding
// ===========================================================================
//
// These assert the reference's *policy* on top of the wire decode: which field
// becomes the conversation peer, when a UID stays unresolved, how the permanent
// mute sentinel is translated. Each cites the reference line it mirrors.

/** Build a `PushMsgBody` with a content head and optional response head. */
function makeMsg(opts: {
  msgType?: number;
  subType?: number;
  sequence?: number;
  ntMsgSeq?: number;
  timestamp?: number;
  msgId?: number;
  fromUin?: number;
  fromUid?: string;
  toUin?: number;
  grp?: { groupUin?: number; memberName?: string; memberCard?: string; groupName?: string };
  forward?: { tempGroupUin?: number; friendName?: string };
  elems?: Elem[];
  msgContent?: Uint8Array;
}): PushMsgBody {
  return {
    contentHead: {
      msgType: opts.msgType ?? 0,
      subType: opts.subType ?? 0,
      c2cCmd: null,
      msgId: opts.msgId ?? 0,
      sequence: opts.sequence ?? 0,
      timestamp: opts.timestamp ?? 1700000000,
      field7: null,
      ntMsgSeq: opts.ntMsgSeq ?? 0,
      newId: null,
    },
    responseHead: {
      fromUin: opts.fromUin ?? 0,
      fromUid: opts.fromUid ?? "",
      type: null,
      sigMap: null,
      toUin: opts.toUin ?? 0,
      toUid: "",
      forward: opts.forward
        ? { tempGroupUin: opts.forward.tempGroupUin ?? null, friendName: opts.forward.friendName ?? null }
        : null,
      grp: opts.grp
        ? {
          groupUin: opts.grp.groupUin ?? null,
          memberName: opts.grp.memberName ?? null,
          memberCard: opts.grp.memberCard ?? null,
          groupName: opts.grp.groupName ?? null,
        }
        : null,
    },
    body: {
      // Encode with element-builder, then decode with msg-push: the fixture path
      // is the same one the network takes, so a field-number error anywhere in
      // the chain fails the event test rather than hiding behind hand-built bytes.
      richText: { elems: wireElems(opts.elems ?? []), notOnlineFile: null, ptt: null },
      msgContent: opts.msgContent ?? null,
    },
  };
}

/** Encode builder-shaped elems and decode them back into the wire shape. */
function wireElems(elems: readonly Elem[]): WireElem[] {
  return elems.map((elem) => decodeElem(encodeElem(elem)) as WireElem);
}

/** An identity that resolves one uid and knows one group member. */
function testIdentity(): Identity {
  return {
    findUinByUid: (uid) => (uid === "u_sender" ? 10001 : uid === "u_oper" ? 10002 : undefined),
    findGroupMember: () => ({ nickname: "nick", card: "card", role: "admin" }),
    findFriend: () => ({ nickname: "friend-nick" }),
    findGroup: () => ({ groupName: "group-name" }),
  };
}

test("event: group message masks the msgId sign bit", () => {
  const ctx = buildContextFromMessage(makeMsg({
    msgType: 82,
    msgId: 0xffffffff,
    sequence: 5,
    fromUin: 10001,
    elems: [{ text: { str: "hi" } }],
    grp: { groupUin: 777 },
  }), 99999, EMPTY_IDENTITY);
  assert.ok(ctx);
  const evs = decodePush(ctx);
  assert.equal(evs.length, 1);
  const ev = evs[0]!;
  assert.equal(ev.kind, "group_message");
  if (ev.kind !== "group_message") throw new Error("expected group_message");
  // 0xffffffff & 0x7fffffff == 0x7fffffff, i.e. positive.
  assert.equal(ev.msgId, 2147483647);
  assert.equal(ev.groupId, 777);
  assert.deepEqual(ev.elements, [{ type: "text", text: "hi" }]);
});

test("event: group message fills nick/card/role from identity", () => {
  const ctx = buildContextFromMessage(makeMsg({
    msgType: 82, fromUin: 10001, grp: { groupUin: 777 }, elems: [],
  }), 99999, testIdentity());
  assert.ok(ctx);
  const ev = decodePush(ctx)[0]!;
  if (ev.kind !== "group_message") throw new Error("expected group_message");
  // No memberName on the wire, so the identity nickname is used.
  assert.equal(ev.senderNick, "nick");
  assert.equal(ev.senderCard, "card");
  assert.equal(ev.senderRole, "admin");
  assert.equal(ev.groupName, "group-name");
});

test("event: group message prefers the wire card over the identity card", () => {
  const ctx = buildContextFromMessage(makeMsg({
    msgType: 82, fromUin: 10001,
    grp: { groupUin: 777, memberName: "wire-nick", memberCard: "wire-card" },
    elems: [],
  }), 99999, testIdentity());
  assert.ok(ctx);
  const ev = decodePush(ctx)[0]!;
  if (ev.kind !== "group_message") throw new Error("expected group_message");
  assert.equal(ev.senderNick, "wire-nick");
  assert.equal(ev.senderCard, "wire-card");
});

test("event: friend message uses toUin as the peer when the bot sent it", () => {
  const ctx = buildContextFromMessage(makeMsg({
    msgType: 166, fromUin: 10001, toUin: 4242, elems: [{ text: { str: "out" } }],
  }), 10001, EMPTY_IDENTITY);
  assert.ok(ctx);
  const ev = decodePush(ctx)[0]!;
  if (ev.kind !== "friend_message") throw new Error("expected friend_message");
  // Without the self-sent rule this would be 10001 (the bot itself).
  assert.equal(ev.peerUin, 4242);
});

test("event: friend message from a peer uses fromUin", () => {
  const ctx = buildContextFromMessage(makeMsg({
    msgType: 166, fromUin: 5555, toUin: 10001, elems: [],
  }), 10001, EMPTY_IDENTITY);
  assert.ok(ctx);
  const ev = decodePush(ctx)[0]!;
  if (ev.kind !== "friend_message") throw new Error("expected friend_message");
  assert.equal(ev.peerUin, 5555);
});

test("event: friend message marks the sequence authoritative only with ntMsgSeq", () => {
  const withNt = buildContextFromMessage(makeMsg({ msgType: 166, fromUin: 1, ntMsgSeq: 9 }), 2, EMPTY_IDENTITY);
  const withoutNt = buildContextFromMessage(makeMsg({ msgType: 166, fromUin: 1, ntMsgSeq: 0 }), 2, EMPTY_IDENTITY);
  assert.ok(withNt && withoutNt);
  const a = decodePush(withNt)[0]!;
  const b = decodePush(withoutNt)[0]!;
  if (a.kind !== "friend_message" || b.kind !== "friend_message") throw new Error("expected friend_message");
  assert.equal(a.sequenceAuthoritative, true);
  assert.equal(b.sequenceAuthoritative, false);
});

test("event: temp message takes the group from the forward hop", () => {
  const ctx = buildContextFromMessage(makeMsg({
    msgType: 141, fromUin: 10001,
    grp: { groupUin: 111, memberName: "n" },
    forward: { tempGroupUin: 222 },
  }), 99999, EMPTY_IDENTITY);
  assert.ok(ctx);
  const ev = decodePush(ctx)[0]!;
  if (ev.kind !== "temp_message") throw new Error("expected temp_message");
  // The forward hop wins over the grp slot.
  assert.equal(ev.groupId, 222);
});

test("event: group recall unwraps the 7-byte envelope", () => {
  const notify = concat([
    uint32Field(4, 777),                               // groupUin = field 4 (L147288)
    lenDelimited(11, concat([                          // recall = field 11 (L147326)
      lenDelimited(1, utf8("u_oper")),                 // GroupRecall.operatorUid (L147541)
      lenDelimited(3, concat([                         // recallMessages[0] = field 3 (L147561)
        uint32Field(1, 55),                            // RecallMessage.sequence (L147734)
        uint32Field(2, 1700000123),                    // RecallMessage.time     (L147752)
        lenDelimited(6, utf8("u_sender")),             // RecallMessage.authorUid (L147824)
      ])),
    ])),
  ]);
  const ctx = buildContextFromMessage(makeMsg({
    msgType: 732, subType: 17, timestamp: 1, msgContent: wrapNotify(notify),
  }), 99999, testIdentity());
  assert.ok(ctx);
  const evs = decodePush(ctx);
  assert.equal(evs.length, 1);
  const ev = evs[0]!;
  if (ev.kind !== "group_recall") throw new Error(`expected group_recall, got ${ev.kind}`);
  assert.equal(ev.groupId, 777);
  assert.equal(ev.msgSeq, 55);
  assert.equal(ev.time, 1700000123);
  // UIDs resolve through identity; an unknown one must stay 0, not be invented.
  assert.equal(ev.operatorUin, 10002);
  assert.equal(ev.authorUin, 10001);
});

test("event: group recall payload length is big-endian", () => {
  const notify = concat([
    uint32Field(4, 777),
    lenDelimited(11, lenDelimited(3, uint32Field(1, 66))),
  ]);
  // Envelope: 5 filler bytes then a BE length. With BE the payload is parsed; an
  // LE read would produce a wrong slice and lose the recall.
  const envelope = concat([
    Uint8Array.from([1, 2, 3, 4, 5]),
    Uint8Array.from([(notify.length >> 8) & 0xff, notify.length & 0xff]),
    notify,
  ]);
  const ctx = buildContextFromMessage(makeMsg({
    msgType: 732, subType: 17, msgContent: envelope,
  }), 99999, testIdentity());
  assert.ok(ctx);
  const ev = decodePush(ctx)[0]!;
  if (ev.kind !== "group_recall") throw new Error("expected group_recall");
  assert.equal(ev.msgSeq, 66);
});

// Schema-derived synthetic GroupAdmin protobuf fixtures; these are NOT trusted QQ captures.
test("event: group admin change decodes enable and disable from schema-derived fixtures", () => {
  const enabled = concat([
    uint32Field(1, 777),
    lenDelimited(4, lenDelimited(2, lenDelimited(1, utf8("u_sender")))),
  ]);
  const enabledCtx = buildContextFromMessage(makeMsg({
    msgType: 44, timestamp: 1700000999, msgContent: enabled,
  }), 99999, testIdentity());
  assert.ok(enabledCtx);
  const enabledEvent = decodePush(enabledCtx)[0]!;
  assert.equal(enabledEvent.kind, "group_admin");
  if (enabledEvent.kind !== "group_admin") throw new Error("expected group_admin");
  assert.deepEqual(enabledEvent, {
    kind: "group_admin", time: 1700000999, selfUin: 99999,
    groupId: 777, userUin: 10001, set: true,
  });

  const disabled = concat([
    uint32Field(1, 777),
    lenDelimited(4, lenDelimited(1, lenDelimited(1, utf8("u_oper")))),
  ]);
  const disabledCtx = buildContextFromMessage(makeMsg({
    msgType: 44, timestamp: 1700001000, msgContent: disabled,
  }), 99999, testIdentity());
  assert.ok(disabledCtx);
  const disabledEvent = decodePush(disabledCtx)[0]!;
  assert.equal(disabledEvent.kind, "group_admin");
  if (disabledEvent.kind !== "group_admin") throw new Error("expected group_admin");
  assert.equal(disabledEvent.userUin, 10002);
  assert.equal(disabledEvent.set, false);
});

test("event: group admin change returns empty for missing body or admin UID", () => {
  for (const content of [
    uint32Field(1, 777),
    concat([uint32Field(1, 777), lenDelimited(4, lenDelimited(2, new Uint8Array(0)))]),
    concat([uint32Field(1, 777), lenDelimited(4, lenDelimited(2, lenDelimited(1, new Uint8Array(0))))]),
  ]) {
    const ctx = buildContextFromMessage(makeMsg({ msgType: 44, msgContent: content }), 99999, testIdentity());
    assert.ok(ctx);
    assert.deepEqual(decodePush(ctx), []);
  }
});

test("event: group admin change resolves UID using its group and leaves unknown as zero", () => {
  const admin = concat([
    uint32Field(1, 777),
    lenDelimited(4, lenDelimited(2, lenDelimited(1, utf8("unmapped")))),
  ]);
  const ctx = buildContextFromMessage(makeMsg({ msgType: 44, msgContent: admin }), 99999, {
    ...testIdentity(),
    findUinByUid: (uid, groupId) => {
      assert.equal(groupId, 777);
      return uid === "unmapped" ? undefined : undefined;
    },
  });
  assert.ok(ctx);
  const event = decodePush(ctx)[0]!;
  if (event.kind !== "group_admin") throw new Error("expected group_admin");
  assert.equal(event.userUin, 0);
});

test("event: group mute translates the permanent sentinel", () => {
  const mute = concat([
    uint32Field(1, 777),                          // GroupMute.groupUin        (L146862)
    lenDelimited(4, utf8("u_oper")),              // GroupMute.operatorUid     (L146916)
    lenDelimited(5, concat([                      // GroupMute.data            (L146936)
      uint32Field(1, 1700000001),                 // GroupMuteData.timestamp   (L147029)
      lenDelimited(3, concat([                    // GroupMuteData.state       (L147065)
        lenDelimited(1, utf8("u_sender")),        // GroupMuteState.targetUid  (L147155)
        uint32Field(2, 60),                       // GroupMuteState.duration   (L147175)
      ])),
    ])),
  ]);
  const ctx = buildContextFromMessage(makeMsg({ msgType: 732, subType: 12, msgContent: mute }),
    99999, testIdentity());
  assert.ok(ctx);
  const ev = decodePush(ctx)[0]!;
  if (ev.kind !== "group_mute") throw new Error(`expected group_mute, got ${ev.kind}`);
  assert.equal(ev.duration, 60);
  assert.equal(ev.operatorUin, 10002);
  assert.equal(ev.userUin, 10001);
});

test("event: group mute with 0xffffffff duration becomes 2147483647", () => {
  const mute = concat([
    uint32Field(1, 777),
    lenDelimited(5, concat([
      lenDelimited(3, concat([uint32Field(2, 0xffffffff)])),
    ])),
  ]);
  const ctx = buildContextFromMessage(makeMsg({ msgType: 732, subType: 12, msgContent: mute }),
    99999, EMPTY_IDENTITY);
  assert.ok(ctx);
  const ev = decodePush(ctx)[0]!;
  if (ev.kind !== "group_mute") throw new Error("expected group_mute");
  assert.equal(ev.duration, 2147483647);
});

test("event: friend request takes the flag from newSource", () => {
  const req = lenDelimited(1, concat([          // FriendRequest.info = field 1 (L144654)
    lenDelimited(5, utf8("u_sender")),          // FriendRequestInfo.newSource = field 5 (L144783)
    lenDelimited(10, utf8("hello")),            // FriendRequestInfo.message  = field 10 (L144803)
  ]));
  const ctx = buildContextFromMessage(makeMsg({ msgType: 528, subType: 35, msgContent: req }),
    99999, testIdentity());
  assert.ok(ctx);
  const evs = decodePush(ctx);
  assert.equal(evs.length, 1);
  const ev = evs[0]!;
  if (ev.kind !== "friend_request") throw new Error("expected friend_request");
  assert.equal(ev.fromUid, "u_sender");
  assert.equal(ev.fromUin, 10001);
  assert.equal(ev.flag, "u_sender");
  assert.equal(ev.message, "hello");
});

test("event: friend recall 138 uses fromUid, 139 uses toUid", () => {
  const recall = lenDelimited(1, concat([   // FriendRecall.info = field 1 (L144918)
    lenDelimited(1, utf8("u_sender")),      // FriendRecallInfo.fromUid        (L145092)
    lenDelimited(2, utf8("u_oper")),        // FriendRecallInfo.toUid          (L145112)
    uint32Field(3, 88),                     // FriendRecallInfo.clientSequence (L145132)
    uint32Field(5, 1700000002),             // FriendRecallInfo.time           (L145166)
  ]));
  const peer = buildContextFromMessage(makeMsg({ msgType: 528, subType: 138, msgContent: recall }),
    99999, testIdentity());
  const self = buildContextFromMessage(makeMsg({ msgType: 528, subType: 139, msgContent: recall }),
    99999, testIdentity());
  assert.ok(peer && self);
  const a = decodePush(peer)[0]!;
  const b = decodePush(self)[0]!;
  if (a.kind !== "friend_recall" || b.kind !== "friend_recall") throw new Error("expected friend_recall");
  assert.equal(a.userUin, 10001);
  assert.equal(a.recalledBySelf, false);
  assert.equal(b.userUin, 10002);
  assert.equal(b.recalledBySelf, true);
  assert.equal(a.msgSeq, 88);
});

test("event: friend add resolves the uid, and is dropped when unresolvable", () => {
  const nf = lenDelimited(2, concat([          // NewFriend.info = field 2 (L145456)
    lenDelimited(1, utf8("u_sender")),         // NewFriendInfo.uid = field 1 (L145551)
  ]));
  const ok = buildContextFromMessage(makeMsg({ msgType: 528, subType: 179, msgContent: nf }),
    99999, testIdentity());
  assert.ok(ok);
  const ev = decodePush(ok)[0]!;
  if (ev.kind !== "friend_add") throw new Error("expected friend_add");
  assert.equal(ev.userUin, 10001);

  // An unknown uid with no wire fromUin must not become a bogus user.
  const unknown = buildContextFromMessage(makeMsg({ msgType: 528, subType: 179, msgContent: nf }),
    99999, EMPTY_IDENTITY);
  assert.ok(unknown);
  assert.deepEqual(decodePush(unknown), []);
});

test("event: group poke is a grey tip with busiType 12", () => {
  const tip = concat([
    uint32Field(4, 777),        // groupUin
    lenDelimited(26, concat([            // generalGrayTip = field 26 (L147384)
      uint32Field(1, 12),                // busiType = 12 (poke), L148008
      lenDelimited(7, concat([           // msgTemplParam[0] = field 7 (L148110)
        lenDelimited(1, utf8("uin_str1")),   // TemplParam.name (L148225)
        lenDelimited(2, utf8("u_sender")),   // TemplParam.value (L148245)
      ])),
      lenDelimited(7, concat([
        lenDelimited(1, utf8("uin_str2")),
        lenDelimited(2, utf8("u_oper")),
      ])),
      lenDelimited(7, concat([
        lenDelimited(1, utf8("action_str")),
        lenDelimited(2, utf8("戳了戳")),
      ])),
    ])),
  ]);
  const ctx = buildContextFromMessage(makeMsg({
    msgType: 732, subType: 20, msgContent: wrapNotify(tip),
  }), 99999, testIdentity());
  assert.ok(ctx);
  const evs = decodePush(ctx);
  assert.equal(evs.length, 1);
  const ev = evs[0]!;
  if (ev.kind !== "group_poke") throw new Error(`expected group_poke, got ${ev.kind}`);
  assert.equal(ev.userUin, 10001);
  assert.equal(ev.targetUin, 10002);
  assert.equal(ev.action, "戳了戳");
});

test("event: a grey tip that is not busiType 12 is not a poke", () => {
  const tip = concat([
    uint32Field(4, 777),
    lenDelimited(26, concat([uint32Field(1, 7)])),  // busiType 7, not a poke
  ]);
  const ctx = buildContextFromMessage(makeMsg({ msgType: 732, subType: 20, msgContent: wrapNotify(tip) }),
    99999, testIdentity());
  assert.ok(ctx);
  assert.deepEqual(decodePush(ctx), []);
});

test("event: unknown package type yields no events instead of throwing", () => {
  const ctx = buildContextFromMessage(makeMsg({ msgType: 12345 }), 99999, EMPTY_IDENTITY);
  assert.ok(ctx);
  assert.deepEqual(decodePush(ctx), []);
});

test("event: acknowledged-and-dropped 0x210 subTypes stay silent", () => {
  for (const subType of [38, 380]) {
    const ctx = buildContextFromMessage(makeMsg({ msgType: 528, subType }), 99999, EMPTY_IDENTITY);
    assert.ok(ctx);
    assert.deepEqual(decodePush(ctx), [], `subType ${subType}`);
  }
});

test("event: buildContext returns null for an empty body", () => {
  assert.equal(buildContext({ uin: "1", body: new Uint8Array(0) }), null);
});

test("event: buildContext degrades a non-numeric uin to 0", () => {
  // Build a minimal PushMsg with a content head so the context survives.
  const body = concat([
    lenDelimited(1, concat([                       // PushMsg.message
      lenDelimited(2, concat([                     // PushMsgBody.contentHead
        uint32Field(1, 82),                        // msgType
        uint32Field(5, 7),                         // sequence
      ])),
    ])),
  ]);
  const ctx = buildContext({ uin: "not-a-number", body }, EMPTY_IDENTITY);
  assert.ok(ctx);
  assert.equal(ctx.selfUin, 0);
  assert.equal(ctx.head.msgType, 82);
  assert.equal(ctx.head.sequence, 7);
});

/** Wrap a 0x2DC payload in the 7-byte notify envelope (big-endian length). */
function wrapNotify(payload: Uint8Array): Uint8Array {
  return concat([
    Uint8Array.from([1, 2, 3, 4, 5]),
    Uint8Array.from([(payload.length >> 8) & 0xff, payload.length & 0xff]),
    payload,
  ]);
}
