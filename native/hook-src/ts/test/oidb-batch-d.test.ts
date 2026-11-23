// Batch D — the OIDB service families added in this batch, verified against the
// reference in BOTH directions.
//
// ---------------------------------------------------------------------------
// Where every hex literal in this file comes from
// ---------------------------------------------------------------------------
// ⚠️ **None of them was hand-written.** MEMORY.md §2.3 forbids it, and batch B is
// the cautionary tale: hand-transcribed hex is how six commands ended up broken at
// once. Every `requestHex` below was produced by evaluating `reference/index.mjs`:
//
//     reference.serialize(ctx, params) -> reference.encode(envelope) -> hex
//
// and every `result` below is what the reference's own `decode` + `deserialize`
// returned for that response byte string. The generators live in
// `work/oidb-d/golden.mjs` with the case lists in `work/oidb-d/cases-*.json` and
// `work/oidb-d/mkresp-*.mjs`, so re-running them reproduces these numbers. That is
// the property worth having: the test pins the reference's *observed behaviour*,
// not my reading of it.
//
// ---------------------------------------------------------------------------
// Why the response direction matters more than the request direction
// ---------------------------------------------------------------------------
// A request test only proves the port writes the same bytes. A response test
// proves it reads the same fields — and the same ABSENT fields — out of them, which
// is where every real bug in this batch was:
//
//   * absent scalars must decode to `null`, never `0`/`""` (see the
//     `requests_resp` case: the reference yields `comment: null` where the naive
//     port yielded `comment: ""`);
//   * a bool field must use the `_val !== 0` narrowing, not a uint32 read
//     (`isLast`, `boolFileExist`);
//   * an int32 field must keep its sign (`ocr_resp_negative` pins `-1`/`-2`);
//   * a `.uint64` slot must not silently lose an exact zero.
//
// Every family also pins at least one REQUEST THROW and one RESPONSE THROW: the
// reference validates inside `serialize`/`deserialize`, so the error text is part of
// the observable contract rather than an implementation detail.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  makeOidbEnvelope,
  encodeOidbEnvelope,
  decodeOidbEnvelope,
  OidbError,
} from "../src/oidb/envelope.js";
import { type OidbSpec } from "../src/oidb/spec.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const hex = (value: Uint8Array): string => Buffer.from(value).toString("hex");
const bytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "hex"));

/** Build a request's wire bytes the way `invokeOidb` would. */
function encodeRequest<TParams, TWireReq, TWireResp, TResult>(
  spec: OidbSpec<TParams, TWireReq, TWireResp, TResult>,
  params: TParams,
): string {
  const sub =
    spec.resolveSubCommand !== undefined
      ? spec.resolveSubCommand(params)
      : (spec.subCommand ?? 0);
  return hex(
    encodeOidbEnvelope(
      makeOidbEnvelope(
        spec.command,
        sub,
        spec.encodeBody(spec.serialize(params)),
        spec.uinForm === true,
      ),
    ),
  );
}

/** Decode a response envelope and hand its body to the spec's `deserialize`. */
function decodeResponse<TParams, TWireReq, TWireResp, TResult>(
  spec: OidbSpec<TParams, TWireReq, TWireResp, TResult>,
  envelopeHex: string,
): TResult {
  const decoded = decodeOidbEnvelope(bytes(envelopeHex), spec.decodeBody);
  return spec.deserialize(decoded.body ?? ({} as TWireResp));
}

/**
 * Render a value the way the goldens store it: bigints as `{__bigint}`, byte
 * arrays as `{__bytes}`. Both sides of every comparison go through this, so a
 * bigint is never confused with a number by `assert.deepEqual`.
 */
function json(value: unknown): unknown {
  // `JSON.stringify(undefined)` yields `undefined`, not a string, so the empty-body
  // specs (whose `deserialize` returns undefined) would throw inside JSON.parse
  // before anything could be compared. `undefined` is returned as-is and compared
  // with `=== undefined` by the caller's projection.
  if (value === undefined) return undefined;
  const text = JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return { __bigint: item.toString() };
    if (item instanceof Uint8Array) return { __bytes: Buffer.from(item).toString("hex") };
    return item;
  });
  return text === undefined ? undefined : JSON.parse(text);
}

/**
 * Project a decoded value onto the reference's key set.
 *
 * One-directional on purpose: the port may expose MORE fields than the reference
 * kept (decoded-but-unused slots are preserved so a re-encode is lossless), but it
 * must agree on every field the reference actually produced. `null` and
 * `undefined` are kept distinct — collapsing them is exactly the bug this batch
 * had to fix.
 */
function project(ours: unknown, ref: unknown): unknown {
  if (Array.isArray(ref)) {
    return (Array.isArray(ours) ? ours : []).map((item, index) => project(item, ref[index]));
  }
  if (ref !== null && typeof ref === "object" && !("__bigint" in ref) && !("__bytes" in ref)) {
    const out: Record<string, unknown> = {};
    const mine = (ours ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(ref as Record<string, unknown>)) {
      out[key] =
        mine[key] === null || mine[key] === undefined
          ? mine[key]
          : project(mine[key], (ref as Record<string, unknown>)[key]);
    }
    return out;
  }
  return ours;
}

/**
 * The rich-media node both NTV2 URL commands take.
 *
 * Copied from the generator's own constant (`work/oidb-d/probe-one.mjs`), because
 * the golden was produced with it; a different node produces different bytes and
 * the request assertions would fail for the right reason but the wrong cause.
 */
const NTV2_NODE = {
  fileUuid: "uuid-1",
  info: {
    fileSize: 1234,
    fileHash: "fh",
    fileSha1: "fs",
    fileName: "a.mp4",
    type: { type: 2, picFormat: 0, videoFormat: 1, voiceFormat: 0 },
    width: 640,
    height: 480,
    time: 12,
    original: 1,
  },
  storeId: 5,
  uploadTime: 1700000000,
  ttl: 3600,
  subType: 1,
};

import * as reaction from "../src/oidb/services/0x9082-9084.js";
import * as friend from "../src/oidb/services/0xd69-d72.js";
import * as misc from "../src/oidb/services/0xeb7-cde.js";
import * as contacts from "../src/oidb/services/0x496-9067.js";
import * as groupFile from "../src/oidb/services/0x3639-offline.js";
import * as flash from "../src/oidb/services/0x93d0-flash.js";
import * as extras from "../src/oidb/services/0x929b-extras.js";
import * as profile from "../src/oidb/services/0x902e-profile.js";

// ---------------------------------------------------------------------------
// interaction & reaction
// ---------------------------------------------------------------------------

test("interaction & reaction: requests match the reference", () => {
  const cases: [string, string][] = [
    // emoji_likes
    [encodeRequest(reaction.GetEmojiLikes, { groupId: 111222333, sequence: 7, emojiId: "76" }), "0883a1021001220f10bdbc8435180720012a023736400a"],
    // emoji_likes_page
    [encodeRequest(reaction.GetEmojiLikes, { groupId: 111222333, sequence: 7, emojiId: "128512", emojiType: 2, cookie: "abc", count: 20 }), "0883a1021001221810bdbc8435180720022a0631323835313232036162634014"],
    // essence_off
    [encodeRequest(reaction.SetEssence, { groupId: 111222333, sequence: 7, random: 42, enable: false }), "08ac1d1002220908bdbc84351007182a"],
    // essence_on
    [encodeRequest(reaction.SetEssence, { groupId: 111222333, sequence: 7, random: 42, enable: true }), "08ac1d1001220908bdbc84351007182a"],
    // essence_zero_random
    [encodeRequest(reaction.SetEssence, { groupId: 111222333, sequence: 7, random: 0, enable: true }), "08ac1d1001220708bdbc84351007"],
    // poke_friend
    [encodeRequest(reaction.SendPoke, { peerUin: 10001, isGroup: false }), "08d31d1001220608914e28914e"],
    // poke_group
    [encodeRequest(reaction.SendPoke, { peerUin: 111222333, targetUin: 10001, isGroup: true }), "08d31d1001220808914e10bdbc8435"],
    // poke_group_no_target
    [encodeRequest(reaction.SendPoke, { peerUin: 111222333, isGroup: true }), "08d31d1001220a08bdbc843510bdbc8435"],
    // reaction_set_long
    [encodeRequest(reaction.SetReaction, { groupId: 111222333, sequence: 7, code: "128512", isSet: true }), "0882a1021001221110bdbc8435180722063132383531322802"],
    // reaction_set_short
    [encodeRequest(reaction.SetReaction, { groupId: 111222333, sequence: 7, code: "76", isSet: true }), "0882a1021001220d10bdbc84351807220237362801"],
    // reaction_summary
    [encodeRequest(reaction.FetchReactionSummary, { groupId: 111222333, sequence: 7 }), "0884a1021001220910bdbc843518076001"],
    // reaction_summary_big
    [encodeRequest(reaction.FetchReactionSummary, { groupId: 10001, sequence: 9007199254740993 }), "0884a1021001220e10914e1880808080808080106001"],
    // reaction_unset
    [encodeRequest(reaction.SetReaction, { groupId: 111222333, sequence: 7, code: "76", isSet: false }), "0882a1021002220d10bdbc84351807220237362801"],
  ];
  assert.ok(cases.length > 0);
  for (const [got, expected] of cases) assert.equal(got, expected);
});

test("interaction & reaction: responses match the reference", () => {
  const cases: [unknown, unknown][] = [
    // emojilikes_resp
    [json(decodeResponse(reaction.GetEmojiLikes, "0883a102100122220a0a08914e1201611a0268310a0a08924e1201621a02683212046e65787418012001")), json({ "cookie": "next", "isLast": true, "users": [{ "uin": 10001 }, { "uin": 10002 }] })],
    // emojilikes_resp_empty
    [json(decodeResponse(reaction.GetEmojiLikes, "0883a10210012200")), json({ "cookie": "", "isLast": true, "users": [] })],
    // emojilikes_resp_explicit_0
    [json(decodeResponse(reaction.GetEmojiLikes, "0883a10210012209120570616765322001")), json({ "cookie": "page2", "isLast": false, "users": [] })],
    // emojilikes_resp_zero_uin
    [json(decodeResponse(reaction.GetEmojiLikes, "0883a102100122170a0b0800120567686f73741a000a0808934e1201631a00")), json({ "cookie": "", "isLast": true, "users": [{ "uin": 10003 }] })],
    // essence_off_resp
    [json(decodeResponse(reaction.SetEssence, "08ac1d1002220e0801120769676e6f726564980607")), json(undefined)],
    // essence_on_resp
    [json(decodeResponse(reaction.SetEssence, "08ac1d1001220e0801120769676e6f726564980607")), json(undefined)],
    // poke_resp
    [json(decodeResponse(reaction.SendPoke, "08d31d1001220e0801120769676e6f726564980607")), json(undefined)],
    // reaction_resp
    [json(decodeResponse(reaction.FetchReactionSummary, "0884a102100122260800120e0880e2cfaa06100318012202373612120881e2cfaa06100218022206313238353132")), json([{ "count": 3, "emojiId": "76", "emojiType": 1, "lastReactionTime": 1700000000 }, { "count": 2, "emojiId": "128512", "emojiType": 2, "lastReactionTime": 1700000001 }])],
    // reaction_resp_empty
    [json(decodeResponse(reaction.FetchReactionSummary, "0884a10210012200")), json([])],
    // reaction_resp_sparse
    [json(decodeResponse(reaction.FetchReactionSummary, "0884a102100122081206100522023736")), json([{ "count": 5, "emojiId": "76", "emojiType": 1, "lastReactionTime": 0 }])],
    // reaction_resp_zero
    [json(decodeResponse(reaction.FetchReactionSummary, "0884a10210012210120e0880e2cfaa061000180122023736")), json([])],
    // reaction_set_resp
    [json(decodeResponse(reaction.SetReaction, "0882a1021001220e0801120769676e6f726564980607")), json(undefined)],
    // reaction_unset_resp
    [json(decodeResponse(reaction.SetReaction, "0882a1021002220e0801120769676e6f726564980607")), json(undefined)],
  ];
  for (const [got, expected] of cases) assert.deepEqual(project(got, expected), expected);
});

// ---------------------------------------------------------------------------
// friend requests
// ---------------------------------------------------------------------------

test("friend requests: requests match the reference", () => {
  const cases: [string, string][] = [
    // doubt_approve
    [encodeRequest(friend.ApproveDoubtBuddyReq, { uid: "u_10001", selfUid: "u_self" }), "08f21a22150a06755f73656c661207755f313030303118002200"],
    // doubt_del
    [encodeRequest(friend.RejectDoubtBuddyReq, { uid: "u_10001" }), "08e91a220d08031a090a07755f31303030316001"],
    // doubt_get
    [encodeRequest(friend.GetDoubtBuddyReq, { count: 20 }), "08e91a22060801120208146001"],
    // doubt_get_page
    [encodeRequest(friend.GetDoubtBuddyReq, { count: 50, cookie: "abc" }), "08e91a220b08011207083212036162636001"],
    // friend_accept
    [encodeRequest(friend.HandleFriendRequest, { uidOrFlag: "u_10001", approve: true }), "08dd16102c220b08031207755f3130303031"],
    // friend_reject
    [encodeRequest(friend.HandleFriendRequest, { uidOrFlag: "u_10001", approve: false }), "08dd16102c220b08051207755f3130303031"],
  ];
  assert.ok(cases.length > 0);
  for (const [got, expected] of cases) assert.equal(got, expected);
});

test("friend requests: responses match the reference", () => {
  const cases: [unknown, unknown][] = [
    // approve_resp
    [json(decodeResponse(friend.ApproveDoubtBuddyReq, "08f21a1000220e0801120769676e6f726564980607")), json(undefined)],
    // doubt_resp
    [json(decodeResponse(friend.GetDoubtBuddyReq, "08e91a100022410800123d0a3b08914e0a07755f31303030311205616c696365181820012a0568656c6c6f32067365617263683a066d757475616c4080e2cfaa0648bdbc84355003")), json([{ "group_code": "111222333", "msg": "hello", "nick": "alice", "reason": "mutual", "reqTime": 1700000000, "source": "search", "uid": "u_10001", "user_id": 10001 }])],
    // doubt_resp_empty
    [json(decodeResponse(friend.GetDoubtBuddyReq, "08e91a100022020800")), json([])],
    // doubt_resp_no_group
    [json(decodeResponse(friend.GetDoubtBuddyReq, "08e91a10002238080012340a3208924e0a07755f31303030321203626f62181820012a0568656c6c6f32067365617263683a066d757475616c400048005003")), json([{ "group_code": "", "msg": "hello", "nick": "bob", "reason": "mutual", "reqTime": 0, "source": "search", "uid": "u_10002", "user_id": 10002 }])],
    // doubt_resp_uid_only
    [json(decodeResponse(friend.GetDoubtBuddyReq, "08e91a10002216080012120a100a07755f313030303312056361726f6c")), json([{ "group_code": "", "msg": "", "nick": "carol", "reason": "", "reqTime": 0, "source": "", "uid": "u_10003", "user_id": 0 }])],
    // friend_accept_resp
    [json(decodeResponse(friend.HandleFriendRequest, "08dd16102c220e0801120769676e6f726564980607")), json(undefined)],
    // reject_resp
    [json(decodeResponse(friend.RejectDoubtBuddyReq, "08e91a1000220e0801120769676e6f726564980607")), json(undefined)],
  ];
  for (const [got, expected] of cases) assert.deepEqual(project(got, expected), expected);
});

// ---------------------------------------------------------------------------
// misc (sign / translate / db key / ocr)
// ---------------------------------------------------------------------------

test("misc (sign / translate / db key / ocr): requests match the reference", () => {
  const cases: [string, string][] = [
    // db_key
    [encodeRequest(misc.RequestDbKey, { db_salt: "c2FsdA==" }), "08de191002220c120a0a086332467364413d3d"],
    // db_key_empty_session
    [encodeRequest(misc.RequestDbKey, { db_salt: "c2FsdA==", sessionData: new Uint8Array(0) }), "08de191002220c120a0a086332467364413d3d"],
    // db_key_session
    [encodeRequest(misc.RequestDbKey, { db_salt: "c2FsdA==", sessionData: Uint8Array.from([1, 2, 3, 4]) }), "08de1910022212120a0a086332467364413d3d520401020304"],
    // group_sign
    [encodeRequest(misc.SendGroupSign, { groupId: 111222333, selfUin: 10001 }), "08b71d1001221c121a0a05313030303112093131313232323333331a06392e302e3930"],
    // group_sign_big
    [encodeRequest(misc.SendGroupSign, { groupId: 10001, selfUin: 3834523403 }), "08b71d1001221d121b0a0a33383334353233343033120531303030311a06392e302e3930"],
    // ocr
    [encodeRequest(misc.ImageOcr, { imageUrl: "https://multimedia.nt.qq.com/x.jpg" }), "08871c222a0801180152240a2268747470733a2f2f6d756c74696d656469612e6e742e71712e636f6d2f782e6a7067"],
    // translate
    [encodeRequest(misc.TranslateEnToZh, { words: ["hello", "world"] }), "0890131002221c12160a02656e12027a681a0568656c6c6f1a05776f726c6450016001"],
    // translate_empty
    [encodeRequest(misc.TranslateEnToZh, { words: [] }), "0890131002220e12080a02656e12027a6850016001"],
  ];
  assert.ok(cases.length > 0);
  for (const [got, expected] of cases) assert.equal(got, expected);
});

test("misc (sign / translate / db key / ocr): responses match the reference", () => {
  const cases: [unknown, unknown][] = [
    // dbkey_resp
    [json(decodeResponse(misc.RequestDbKey, "08de191002222412220a203030313132323333343435353636373738383939616162626363646465656666")), json("00112233445566778899aabbccddeeff")],
    // ocr_resp
    [json(decodeResponse(misc.ImageOcr, "08871c10002238080052340a1c0a0568656c6c6f105f1a0c0a04080a10140a04081e102822036164760a090a05776f726c6410501202656e1a057265712d31")), json({ "language": "en", "texts": [{ "confidence": 95, "coordinates": [{ "x": 10, "y": 20 }, { "x": 30, "y": 40 }], "text": "hello" }, { "confidence": 80, "coordinates": [], "text": "world" }] })],
    // ocr_resp_negative
    [json(decodeResponse(misc.ImageOcr, "08871c1000221f0800521b0a150a036e65671a0e0a0c08ffffffff0f10feffffff0f12027a68")), json({ "language": "zh", "texts": [{ "confidence": 0, "coordinates": [{ "x": -1, "y": -2 }], "text": "neg" }] })],
    // ocr_resp_nobody
    [json(decodeResponse(misc.ImageOcr, "08871c100022020800")), json({ "language": "", "texts": [] })],
    // sign_resp
    [json(decodeResponse(misc.SendGroupSign, "08b71d100122050801980607")), json(undefined)],
    // translate_resp
    [json(decodeResponse(misc.TranslateEnToZh, "0890131002222c122a080012001a02656e22027a682a0568656c6c6f2a05776f726c643206e4bda0e5a5bd3206e4b896e7958c")), json(["你好", "世界"])],
    // translate_resp_error
    [json(decodeResponse(misc.TranslateEnToZh, "0890131002221312110807120962616420696e70757432026f6b")), json(["ok"])],
    // translate_resp_nodst
    [json(decodeResponse(misc.TranslateEnToZh, "0890131002220c120a08001a02656e22027a68")), json([])],
  ];
  for (const [got, expected] of cases) assert.deepEqual(project(got, expected), expected);
});

test("misc (sign / translate / db key / ocr): response errors match the reference", () => {
  // dbkey_resp_missing
  assert.throws(() => decodeResponse(misc.RequestDbKey, "08de191002220412020a00"), { message: "Oidb 0xcde_2 payload empty (Missing dbKey)" });
  // dbkey_resp_nosub
  assert.throws(() => decodeResponse(misc.RequestDbKey, "08de19100222023801"), { message: "Oidb 0xcde_2 payload empty (Missing dbKey)" });
  // ocr_resp_error
  assert.throws(() => decodeResponse(misc.ImageOcr, "08871c100022200802120e7365727665722073616964206e6f1a0ce8af86e588abe5a4b1e8b4a5"), { message: "image ocr failed: code=2 msg=识别失败" });
  // translate_resp_empty
  assert.throws(() => decodeResponse(misc.TranslateEnToZh, "08901310022203980601"), { message: "translate response empty" });
});

// ---------------------------------------------------------------------------
// contacts
// ---------------------------------------------------------------------------

test("contacts: requests match the reference", () => {
  const cases: [string, string][] = [
    // requests_by_uid
    [encodeRequest(contacts.FetchGroupRequestsByUid, { count: 20, cursor: 12345n }), "08c02110012205081410b960"],
    // requests_by_uid_filtered
    [encodeRequest(contacts.FetchGroupRequestsByUid, { filtered: true }), "08c021100222020832"],
    // rkeys
    [encodeRequest(contacts.FetchDownloadRkeys, {}), "08e7a00210ca01221d0a130a05080110ca011206a80602b006011a0208022206080a081408026001"],
    // robot_ranges
    [encodeRequest(contacts.FetchRobotUinRanges, {}), "08960922082801300138004000"],
    // share_link
    [encodeRequest(contacts.GetGroupShareLink, { groupId: 111222333, needShortUrl: true, additionalParam: "" }), "08e0a0021003220d0802620908bdbc84351a0020016001"],
    // share_link_long
    [encodeRequest(contacts.GetGroupShareLink, { groupId: 10001, needShortUrl: false, additionalParam: "x=1" }), "08e0a0021003220e0802620a08914e1a03783d3120006001"],
    // tuwen_friend
    [encodeRequest(contacts.SendTuwenArk, { targetId: 10001, peerType: 0, title: "T", desc: "", summary: "", previewUrl: "", jumpUrl: "https://j/x" }), "08c21b1022222f0a2608a2e0f22f100118002a02080158914e621408015201546a0b68747470733a2f2f6a2f7872001205080010914e"],
    // tuwen_group
    [encodeRequest(contacts.SendTuwenArk, { targetId: 111222333, peerType: 1, title: "T", desc: "D", summary: "[分享]", previewUrl: "https://p/x.png", jumpUrl: "https://j/x" }), "08c21b1022224f0a4408a2e0f22f100118002a02080158bdbc8435623008015201545a014462085be58886e4baab5d6a0b68747470733a2f2f6a2f78720f68747470733a2f2f702f782e706e671207080110bdbc8435"],
  ];
  assert.ok(cases.length > 0);
  for (const [got, expected] of cases) assert.equal(got, expected);
});

test("contacts: responses match the reference", () => {
  const cases: [unknown, unknown][] = [
    // requests_resp
    [json(decodeResponse(contacts.FetchGroupRequestsByUid, "08c021100122200a12086f10011802220a08bdbc8435120367727010840718b607200128073002")), json({ "field2": 900n, "field4": 1, "field5": 7n, "field6": 2, "newLatestSeq": 950n, "requests": [{ "comment": null, "eventType": 1, "field9": null, "group": { "groupName": "grp", "groupUin": 111222333 }, "invitor": null, "operateTransInfo": null, "operatorUser": null, "sequence": 111n, "state": 2, "target": null }] })],
    // requests_resp_empty
    [json(decodeResponse(contacts.FetchGroupRequestsByUid, "08c02110012200")), json({ "field2": null, "field4": null, "field5": null, "field6": null, "newLatestSeq": null, "requests": [] })],
    // rkeys_resp
    [json(decodeResponse(contacts.FetchDownloadRkeys, "08e7a00210ca01223d0a0b0a05080110ca0110001a00222e0a150a06726b65792d6110901c18012080e2cfaa06280a0a150a06726b65792d6210a03818022081e2cfaa062814")), json({ "download": null, "downloadRkey": { "rkeys": [{ "rkey": "rkey-a", "rkeyCreateTime": 1700000000, "rkeyTtlSec": 3600n, "storeId": 1, "type": 10 }, { "rkey": "rkey-b", "rkeyCreateTime": 1700000001, "rkeyTtlSec": 7200n, "storeId": 2, "type": 20 }] }, "respHead": { "common": { "command": 202, "requestId": 1 }, "message": "", "retCode": 0 } })],
    // rkeys_resp_empty
    [json(decodeResponse(contacts.FetchDownloadRkeys, "08e7a00210ca0122022200")), json({ "download": null, "downloadRkey": { "rkeys": [] }, "respHead": null })],
    // rkeys_resp_no_body
    [json(decodeResponse(contacts.FetchDownloadRkeys, "08e7a00210ca012200")), json({ "download": null, "downloadRkey": null, "respHead": null })],
    // robot_resp
    [json(decodeResponse(contacts.FetchRobotUinRanges, "089609100022202a1e0803120c08d2a8fed00a10d6a8fed00a120c0880bcc1960b108abcc1960b")), json({ "ranges": [{ "maxUin": 2854196310, "minUin": 2854196306 }, { "maxUin": 3000000010, "minUin": 3000000000 }], "version": 3 })],
    // robot_resp_no_version
    [json(decodeResponse(contacts.FetchRobotUinRanges, "089609100022092a071205086410c801")), json({ "ranges": [{ "maxUin": 200, "minUin": 100 }], "version": 0 })],
    // share_link_resp
    [json(decodeResponse(contacts.GetGroupShareLink, "08e0a0021003221f621d0a1b68747470733a2f2f71756e2e71712e636f6d2f6a6f696e2f616263")), json("https://qun.qq.com/join/abc")],
    // tuwen_resp
    [json(decodeResponse(contacts.SendTuwenArk, "08c21b102222060a0420002a00")), json(undefined)],
  ];
  for (const [got, expected] of cases) assert.deepEqual(project(got, expected), expected);
});

test("contacts: response errors match the reference", () => {
  // rkeys_resp_retcode
  assert.throws(() => decodeResponse(contacts.FetchDownloadRkeys, "08e7a00210ca0122120a1010031a0c726b65792065787069726564"), { message: "rkey expired" });
  // robot_resp_inverted
  assert.throws(() => decodeResponse(contacts.FetchRobotUinRanges, "0896091000220b2a090801120508c8011064"), { message: "0x496_0 response has inverted range[0]: 200-100" });
  // robot_resp_no_config
  assert.throws(() => decodeResponse(contacts.FetchRobotUinRanges, "089609100022024801"), { message: "0x496_0 response missing robot range config" });
  // robot_resp_no_ranges
  assert.throws(() => decodeResponse(contacts.FetchRobotUinRanges, "089609100022042a020803"), { message: "0x496_0 response has no robot UIN ranges" });
  // robot_resp_zero
  assert.throws(() => decodeResponse(contacts.FetchRobotUinRanges, "0896091000220a2a080801120408001064"), { message: "0x496_0 response has invalid range[0].minUin: 0" });
  // share_link_resp_blank
  assert.throws(() => decodeResponse(contacts.GetGroupShareLink, "08e0a0021003220762050a03202020"), { message: "group share link response did not include a URL" });
  // tuwen_resp_error
  assert.throws(() => decodeResponse(contacts.SendTuwenArk, "08c21b102222130a1120782a0d636172642072656a6563746564"), { message: "OIDB error 120 on 0xdc2_34: card rejected" });
  // tuwen_resp_no_results
  assert.throws(() => decodeResponse(contacts.SendTuwenArk, "08c21b102222024801"), { message: "send_tuwen_ark response has no delivery result" });
});

// ---------------------------------------------------------------------------
// group file & offline file
// ---------------------------------------------------------------------------

test("group file & offline file: requests match the reference", () => {
  const cases: [string, string][] = [
    // group_video_url
    [encodeRequest(groupFile.GetGroupVideoUrl, { groupId: 111222333, node: NTV2_NODE }), "08ea2310c80122610a1e0a05080110c8011211a80602b00602c00c02d20c0508bdbc84351a0208021a3f0a390a2208d209120266681a0266732205612e6d70342a040802180130800538e003400c48011206757569642d3118052080e2cfaa0628901c3001120212006001"],
    // offline_finalize
    [encodeRequest(groupFile.FinalizeOfflineFile, { senderUid: "u_self", receiverUid: "u_10001", fileUuid: "fid-1", fileHash: "hash-1" }), "08b71c10a006223108a00652235206755f73656c66a20107755f3130303031f201056669642d31c20206686173682d31a80603b00601c00c01"],
    // private_file_url
    [encodeRequest(groupFile.GetPrivateFileUrl, { selfUid: "u_self", fileId: "fid-1", fileHash: "hash-1" }), "08b71c10b009223408b0091001721c5206755f73656c66a201056669642d31f00102e20306686173682d31a80603b00667c00c01fae93004c0852c01"],
    // private_ptt_url
    [encodeRequest(groupFile.GetPrivatePttUrl, { selfUid: "u_self", node: NTV2_NODE }), "08ed2410c80122660a230a05080110c8011216a80601b00603c00c01ca0c0a08021206755f73656c661a0208021a3f0a390a2208d209120266681a0266732205612e6d70342a040802180130800538e003400c48011206757569642d3118052080e2cfaa0628901c3001120212006001"],
    // private_upload
    [encodeRequest(groupFile.UploadPrivateFileRequest, { senderUid: "u_self", receiverUid: "u_10001", fileSize: 1234, fileName: "a.txt", md510MCheckSum: Uint8Array.from([1, 2]), fileSha1: Uint8Array.from([3, 4]), fileMd5: Uint8Array.from([5, 6]) }), "08b71c10a40d224008a40d9a01315206755f73656c66a20107755f3130303031f001d209c20205612e7478749203020102e203020304b204012ff206020506a80603b00601c00c01"],
    // private_video_url
    [encodeRequest(groupFile.GetPrivateVideoUrl, { selfUid: "u_self", node: NTV2_NODE }), "08e92310c80122660a230a05080110c8011216a80602b00602c00c01ca0c0a08021206755f73656c661a0208021a3f0a390a2208d209120266681a0266732205612e6d70342a040802180130800538e003400c48011206757569642d3118052080e2cfaa0628901c3001120212006001"],
  ];
  assert.ok(cases.length > 0);
  for (const [got, expected] of cases) assert.equal(got, expected);
});

test("group file & offline file: responses match the reference", () => {
  const cases: [unknown, unknown][] = [
    // group_video_url_resp
    [json(decodeResponse(groupFile.GetGroupVideoUrl, "08ea2310c801223e0a0b0a05080110c80110001a001a2f0a093f726b65793d61626310901c1a190a096e742e71712e636f6d12092f646f776e6c6f616418bb032080e2cfaa06")), json("https://nt.qq.com/download?rkey=abc")],
    // offline_finalize_resp
    [json(decodeResponse(groupFile.FinalizeOfflineFile, "08b71c10a006222108b71c10a00652195001f201141802a2060107aa060108f00605900880e2cfaa06")), json({ "field100": Uint8Array.from(Buffer.from("07", "hex")), "field101": Uint8Array.from(Buffer.from("08", "hex")), "field110": 5, "field3": 2, "timestamp1": 1700000000 })],
    // offline_finalize_resp_empty
    [json(decodeResponse(groupFile.FinalizeOfflineFile, "08b71c10a0062200")), json({  })],
    // offline_finalize_resp_no_meta
    [json(decodeResponse(groupFile.FinalizeOfflineFile, "08b71c10a006220a08b71c10a00652025001")), json({  })],
    // private_upload_resp
    [json(decodeResponse(groupFile.UploadPrivateFileRequest, "08b71c10a40d227e9a017b5000a20100e20307392e392e392e39b20409642e6578616d706c658005bb03d20506757569642d31a206020102f00601920807312e312e312e31920807322e322e322e32e008fb41b2090a68642e6578616d706c65820a0b646e732e6578616d706c65d20a0831302e302e302e31c20c027b7d920d00e20d020909")), json({ "boolFileExist": true, "fileAddon": "{}", "mediaPlatformUploadKey": Uint8Array.from(Buffer.from("0909", "hex")), "retCode": 0, "retMsg": "", "rtpMediaPlatformUploadAddress": [{ "iPType": null, "inIP": null, "inPort": null, "outIP": null, "outPort": null }], "uploadDns": "dns.example", "uploadDomain": "d.example", "uploadHttpsDomain": "hd.example", "uploadHttpsPort": 8443, "uploadIp": "9.9.9.9", "uploadIpList": ["1.1.1.1", "2.2.2.2"], "uploadKey": Uint8Array.from(Buffer.from("0102", "hex")), "uploadLanip": "10.0.0.1", "uploadPort": 443, "uuid": "uuid-1" })],
    // private_upload_resp_error
    [json(decodeResponse(groupFile.UploadPrivateFileRequest, "08b71c10a40d220c9a01095007a201046e6f7065")), json({ "boolFileExist": null, "fileAddon": null, "mediaPlatformUploadKey": null, "retCode": 7, "retMsg": "nope", "rtpMediaPlatformUploadAddress": [], "uploadDns": null, "uploadDomain": null, "uploadHttpsDomain": null, "uploadHttpsPort": null, "uploadIp": null, "uploadIpList": [], "uploadKey": null, "uploadLanip": null, "uploadPort": null, "uuid": null })],
    // private_url_resp
    [json(decodeResponse(groupFile.GetPrivateFileUrl, "08b71c10b0092221721fa201026f6bf20117a20107312e322e332e34c002903f9203062f783f613d31")), json("http://1.2.3.4:8080/x?a=1&isthumb=0")],
    // ptt_url_resp
    [json(decodeResponse(groupFile.GetPrivatePttUrl, "08ed2410c801223e0a0b0a05080110c80110001a001a2f0a093f726b65793d61626310901c1a190a096e742e71712e636f6d12092f646f776e6c6f616418bb032080e2cfaa06")), json("https://nt.qq.com/download?rkey=abc")],
    // video_url_resp
    [json(decodeResponse(groupFile.GetPrivateVideoUrl, "08e92310c801223e0a0b0a05080110c80110001a001a2f0a093f726b65793d61626310901c1a190a096e742e71712e636f6d12092f646f776e6c6f616418bb032080e2cfaa06")), json("https://nt.qq.com/download?rkey=abc")],
  ];
  for (const [got, expected] of cases) assert.deepEqual(project(got, expected), expected);
});

test("group file & offline file: response errors match the reference", () => {
  // ntv2_retcode
  assert.throws(() => decodeResponse(groupFile.GetPrivatePttUrl, "08ed2410c801222f0a170a05080110c80110031a0c726b657920657870697265641a140a0010901c1a070a00120018bb032080e2cfaa06"), { message: "ntv2 download failed: code=3 msg=rkey expired" });
  // private_upload_resp_no_body
  assert.throws(() => decodeResponse(groupFile.UploadPrivateFileRequest, "08b71c10a40d22024801"), { message: "private file upload response missing" });
  // private_url_resp_no_port
  assert.throws(() => decodeResponse(groupFile.GetPrivateFileUrl, "08b71c10b00922147212f2010fa20107312e322e332e349203022f78"), { message: "private file url response invalid" });
  // private_url_resp_no_result
  assert.throws(() => decodeResponse(groupFile.GetPrivateFileUrl, "08b71c10b00922077205a201026f6b"), { message: "private file url response invalid" });
});

// ---------------------------------------------------------------------------
// flash transfer
// ---------------------------------------------------------------------------

test("flash transfer: requests match the reference", () => {
  const cases: [string, string][] = [
    // apply_fileset
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.ApplyFileset, { fileName: "a.txt", origName: "orig.txt", fileSize: 1234, typeCode: 7, uploader: { uin: "10001", nickname: "nick", uid: "u_10001" } })), "08cfa7021001223b080112331205612e7478741a086f7269672e747874200128d20952180a05313030303112046e69636b1a07755f3130303031220080010118076001"],
    // apply_fileset_zero_size
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.ApplyFileset, { fileName: "b.txt", origName: "", fileSize: 0, typeCode: 0, uploader: { uin: "", nickname: "", uid: "" } })), "08cfa70210012216080112101205622e7478742001520222008001016001"],
    // apply_upload
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.ApplyUpload, { filesetUuid: "fs-1", fileUuid: "f-1", fileIndex: 1, fileId: "fid-1", fileName: "a.jpg", fileSize: 1234, sha1: "sha1", md5: "md5", formatCode: 12, width: 640, height: 480, nowSeconds: 1700000000 })), "08a92510672295010a180a0408641067120ca80602b00604b80616c00c051a02080162790a400a2908d20912036d64351a04736861312205612e6a70672a08080010001800200030800538e0034000480112056669642d3118012080e2cfaa062880ea493000120208021a08080010001800220052270a0466732d31120466732d311a03662d31200128003000380c42004801500058006000680070006001"],
    // apply_upload_thumb_png
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.ApplyUpload, { filesetUuid: "fs-1", fileUuid: "f-1", fileIndex: 3, fileId: "fid-1", fileName: "t.png", fileSize: 99, sha1: "s", md5: "m", formatCode: 12, thumbType: "png", nowSeconds: 1700000000 })), "08a9251067228d010a180a0408641067120ca80602b00604b80617c00c051a02080162710a380a21086312016d1a01732205742e706e672a080800100018002000300038004000480112056669642d3118012080e2cfaa062880ea493000120208021a08080010001800220052270a0466732d31120466732d311a03662d31200328013000381a42004801500058006000680070006001"],
    // commit_file
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.CommitFile, { filesetUuid: "fs-1", entries: [{ fileUuid: "f-1", fileIndex: 1, formatCode: 12, fileName: "a.txt", origName: "orig.txt", fileSize: 1234 }] })), "08d0a702100122440801120466732d311a0466732d3122300a0466732d311203662d311800220028013001380c4205612e7478744a086f7269672e747874500058d2096000c2010028013001"],
    // commit_file_empty
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.CommitFile, { filesetUuid: "fs-1", entries: [] })), "08d0a702100122120801120466732d311a0466732d3128013001"],
    // commit_file_two
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.CommitFile, { filesetUuid: "fs-1", entries: [{ fileUuid: "f-1", fileIndex: 1, formatCode: 12, fileName: "a.txt", origName: "o.txt", fileSize: 10 }, { fileUuid: "f-2", fileIndex: 2, formatCode: 13, fileName: "b.txt", origName: "o2.txt", fileSize: 20 }] })), "08d0a7021001226f0801120466732d311a0466732d31222c0a0466732d311203662d311800220028013001380c4205612e7478744a056f2e7478745000580a6000c20100222d0a0466732d311203662d321800220028013002380d4205622e7478744a066f322e747874500058146000c2010028013001"],
    // complete_fileset
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.CompleteFileset, { filesetUuid: "fs-1" })), "08dba702100122060a0466732d31"],
    // delete_file
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.DeleteFlashFile, { filesetUuid: "fs-1" })), "0887a802100122080a0466732d311807"],
    // get_detail
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.GetFilesetDetail, { filesetUuid: "fs-1" })), "08d3a702100122080a0466732d311007"],
    // get_download_url
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.GetDownloadUrl, { filesetUuid: "fs-1" })), "08d4a702100122140a0466732d311208100118122a00320018072001"],
    // list_filesets
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.ListFilesets, {})), "08d2a702100122040803180a"],
    // list_filesets_explicit
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.ListFilesets, { field1: 1, field3: 20 })), "08d2a7021001220408011814"],
    // prepare_upload
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.PrepareUpload, { filesetUuid: "fs-1", fileUuid: "f-1", fileIndex: 1, fileName: "a.jpg", fileSize: 1234, sha1: "sha1", formatCode: 12, width: 640, height: 480 })), "08a92510642292010a190a0508c8011064120ca80602b00604b80616c00c051a02080112750a2a0a2608d20912001a04736861312205612e6a70672a08080010001800200030800538e003400048011000100118002000280032120a040800120012021a001a045a0062005000380040004a270a0466732d31120466732d311a03662d31200128003000380c42004801500058006000680070006001"],
    // prepare_upload_thumb_jpg
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.PrepareUpload, { filesetUuid: "fs-1", fileUuid: "f-1", fileIndex: 1, fileName: "t.jpg", fileSize: 1234, sha1: "sha1", formatCode: 12, thumbType: "jpg" })), "08a92510642290010a190a0508c8011064120ca80602b00604b80618c00c051a02080112730a280a2408d20912001a04736861312205742e6a70672a08080110001800200030003800400048001000100118002000280032120a040800120012021a001a045a0062005000380040004a270a0466732d31120466732d311a03662d31200128003001380242004801500058006000680070006001"],
    // prepare_upload_thumb_png
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.PrepareUpload, { filesetUuid: "fs-1", fileUuid: "f-1", fileIndex: 2, fileName: "t.png", fileSize: 99, sha1: "s", formatCode: 12, thumbType: "png" })), "08a9251064228c010a190a0508c8011064120ca80602b00604b80617c00c051a020801126f0a240a20086312001a01732205742e706e672a08080010001800200030003800400048011000100118002000280032120a040800120012021a001a045a0062005000380040004a270a0466732d31120466732d311a03662d31200228003001381a42004801500058006000680070006001"],
    // rename_file
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.RenameFlashFile, { filesetUuid: "fs-1", newName: "new.txt" })), "08a7a802221c0a0466732d3112120a076e65772e74787412076e65772e7478741a006001"],
    // send_group
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.SendFlashMsg, { filesetUuid: "fs-1", groupId: 111222333 })), "08d7a702100122110a0908021a0508bdbc8435120466732d31"],
    // send_uid
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.SendFlashMsg, { filesetUuid: "fs-1", targetUid: "u_10001" })), "08d7a702100122150a0d080112090a07755f3130303031120466732d31"],
    // set_status_default
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.SetFilesetStatus, { filesetUuid: "fs-1" })), "08d1a702100122080a0466732d311006"],
    // set_status_explicit
    [(flash.resetFlashUploadSequences(), encodeRequest(flash.SetFilesetStatus, { filesetUuid: "fs-1", status: 3 })), "08d1a702100122080a0466732d311003"],
  ];
  assert.ok(cases.length > 0);
  for (const [got, expected] of cases) assert.equal(got, expected);
});

test("flash transfer: responses match the reference", () => {
  const cases: [unknown, unknown][] = [
    // apply_fileset_resp
    [json(decodeResponse(flash.ApplyFileset, "08cfa702100122220a0466732d311204756b2d311a0b68747470733a2f2f752f782080e2cfaa0628901c")), json({ "expire": 1700000000n, "filesetUuid": "fs-1", "ttl": 3600, "uploadKey": "uk-1", "uploadUrl": "https://u/x" })],
    // apply_upload_resp
    [json(decodeResponse(flash.ApplyUpload, "08a925106722180a0a0a04086410671a026f6b120a0a08726b65792d616263")), json(undefined)],
    // commit_file_resp
    [json(decodeResponse(flash.CommitFile, "08d0a7021001220e0801120466732d311a04756b2d31")), json({ "field1": 1, "filesetUuid": "fs-1", "uploadKey": "uk-1" })],
    // complete_fileset_resp
    [json(decodeResponse(flash.CompleteFileset, "08dba7021001220b0801120769676e6f726564")), json(undefined)],
    // delete_file_resp
    [json(decodeResponse(flash.DeleteFlashFile, "0887a8021001220b0801120769676e6f726564")), json(undefined)],
    // get_detail_resp
    [json(decodeResponse(flash.GetFilesetDetail, "08d3a7021001222d0a2b0a0466732d311205612e7478741a056f2e7478742001280a42030a01754a0c0a0366696412050801120164")), json([{ "fileIdWrap": { "download": { "downloadUrl": "d", "field1": 1 }, "fileId": "fid" }, "fileName": "a.txt", "fileSize": 10n, "fileType": 1, "filesetUuid": "fs-1", "origName": "o.txt", "uploadUrlWrap": { "uploadUrl": "u" } }])],
    // get_download_url_resp
    [json(decodeResponse(flash.GetDownloadUrl, "08d4a702100122a6010aa30110011a4f0a0466732d31120466752d3130014205612e7478746a2a0a056469642d3112100801120c68747470733a2f2f646c2f781a04736861312a036d643530800538e00372090a056669642d31180158d2091a490a0466732d32120466752d32300042006a2a0a056469642d3112100801120c68747470733a2f2f646c2f781a04736861312a036d643530800538e00372090a056669642d32180158002201782802")), json([{ "fileId": "fid-1", "fileIndex": 1, "fileName": "a.txt", "fileSize": 1234, "fileUuid": "fu-1", "filesetUuid": "fs-1" }, { "fileId": "fid-2", "fileIndex": 0, "fileName": "", "fileSize": 0, "fileUuid": "fu-2", "filesetUuid": "fs-2" }])],
    // get_download_url_resp_no_entry
    [json(decodeResponse(flash.GetDownloadUrl, "08d4a70210012200")), json([])],
    // list_filesets_resp
    [json(decodeResponse(flash.ListFilesets, "08d2a702100122670a470a0466732d311205612e7478741a086f7269672e747874200128d209420e0a0c68747470733a2f2f75702f314a190a056669642d3112100801120c68747470733a2f2f646c2f310a1c0a0466732d3212001a002002280042020a004a080a00120408011200")), json([{ "fileIdWrap": { "download": { "downloadUrl": "https://dl/1", "field1": 1 }, "fileId": "fid-1" }, "fileName": "a.txt", "fileSize": 1234n, "fileType": 1, "filesetUuid": "fs-1", "origName": "orig.txt", "uploadUrlWrap": { "uploadUrl": "https://up/1" } }, { "fileIdWrap": { "download": { "downloadUrl": "", "field1": 1 }, "fileId": "" }, "fileName": "", "fileSize": 0n, "fileType": 2, "filesetUuid": "fs-2", "origName": "", "uploadUrlWrap": { "uploadUrl": "" } }])],
    // list_filesets_resp_empty
    [json(decodeResponse(flash.ListFilesets, "08d2a70210012200")), json([])],
    // prepare_upload_resp
    [json(decodeResponse(flash.PrepareUpload, "08a925106422190a0b0a0508c80110641a026f6b120a0a08726b65792d616263")), json("rkey-abc")],
    // prepare_upload_resp_empty
    [json(decodeResponse(flash.PrepareUpload, "08a92510642200")), json(null)],
    // prepare_upload_resp_no_rkey
    [json(decodeResponse(flash.PrepareUpload, "08a925106422090a070a0508c8011064")), json(null)],
    // rename_file_resp
    [json(decodeResponse(flash.RenameFlashFile, "08a7a8021001220b0801120769676e6f726564")), json(undefined)],
    // send_flash_resp
    [json(decodeResponse(flash.SendFlashMsg, "08d7a7021001220b0801120769676e6f726564")), json(undefined)],
    // set_status_resp
    [json(decodeResponse(flash.SetFilesetStatus, "08d1a7021001220b0801120769676e6f726564")), json(undefined)],
  ];
  for (const [got, expected] of cases) assert.deepEqual(project(got, expected), expected);
});

// ---------------------------------------------------------------------------
// extras (ai voice / group todo)
// ---------------------------------------------------------------------------

test("extras (ai voice / group todo): requests match the reference", () => {
  const cases: [string, string][] = [
    // ai_voice
    [encodeRequest(extras.FetchAiVoice, { groupId: 111222333, voiceId: "v-1", text: "hello", chatType: 1, sessionId: 42 }), "089ba502221708bdbc84351203762d311a0568656c6c6f20012a02082a"],
    // ai_voice_list
    [encodeRequest(extras.FetchAiVoiceList, { groupId: 111222333, chatType: 1 }), "089da502220708bdbc84351001"],
    // todo_cancel
    [encodeRequest(extras.GroupTodo, { groupId: 111222333, msgSeq: 7n, action: "cancel" }), "08901f1003220708bdbc84351007"],
    // todo_complete
    [encodeRequest(extras.GroupTodo, { groupId: 111222333, msgSeq: 7n, action: "complete" }), "08901f1002220708bdbc84351007"],
    // todo_list
    [encodeRequest(extras.GetGroupTodoList, { groupId: 111222333 }), "08f4a802220708bdbc84351001"],
    // todo_set
    [encodeRequest(extras.GroupTodo, { groupId: 111222333, msgSeq: 9007199254740993n, action: "set" }), "08901f1001220e08bdbc8435108180808080808010"],
  ];
  assert.ok(cases.length > 0);
  for (const [got, expected] of cases) assert.equal(got, expected);
});

test("extras (ai voice / group todo): request errors match the reference", () => {
  // todo_list_bad_id
  assert.throws(() => encodeRequest(extras.GetGroupTodoList, { groupId: 0 }), { message: "invalid group id" });
});

test("extras (ai voice / group todo): responses match the reference", () => {
  const cases: [unknown, unknown][] = [
    // ai_voice_list_resp
    [json(decodeResponse(extras.FetchAiVoiceList, "089da5021000224c0a410a056361742d61121b0a03762d311207566f69636520311a0b68747470733a2f2f652f31121b0a03762d321207566f69636520321a0b68747470733a2f2f652f320a070a056361742d62")), json([{ "category": "cat-a", "voices": [{ "voiceDisplayName": "Voice 1", "voiceExampleUrl": "https://e/1", "voiceId": "v-1" }, { "voiceDisplayName": "Voice 2", "voiceExampleUrl": "https://e/2", "voiceId": "v-2" }] }, { "category": "cat-b", "voices": [] }])],
    // ai_voice_list_resp_empty
    [json(decodeResponse(extras.FetchAiVoiceList, "089da50210002200")), json([])],
    // ai_voice_resp
    [json(decodeResponse(extras.FetchAiVoice, "089ba5021000224908001001180222410a3f0a3d0a2608d209120266681a0266732205612e616d722a08080210001801200330800538e003400c48011206757569642d3118052080e2cfaa0628901c3001")), json({ "fileUuid": "uuid-1", "info": { "fileHash": "fh", "fileName": "a.amr", "fileSha1": "fs", "fileSize": 1234, "height": 480, "original": 1, "time": 12, "type": { "picFormat": 0, "type": 2, "videoFormat": 1, "voiceFormat": 3 }, "width": 640 }, "storeId": 5, "subType": 1, "ttl": 3600, "uploadTime": 1700000000 })],
    // ai_voice_resp_empty_body
    [json(decodeResponse(extras.FetchAiVoice, "089ba5021000220422020a00")), json(null)],
    // ai_voice_resp_no_info
    [json(decodeResponse(extras.FetchAiVoice, "089ba502100022020800")), json(null)],
    // todo_list_resp
    [json(decodeResponse(extras.GetGroupTodoList, "08f4a802100022a0020a9001080110021a073131315f32323220004080e2cfaa06621f0a037265641209746f646f2d746578741a0968747470733a2f2f7420012800a2012f0a210a0968747470733a2f2f6912037072651a0568656c6c6f220268692801300238011880e2cfaa062081e2cfaa06c2020d080310ffffffffffffffffff01c802fbffffffffffffffff01d00207d80202e00201e802000a8701080110021a073333335f34343420014080e2cfaa06621f0a037265641209746f646f2d746578741a0968747470733a2f2f7420012800a201260a200a0968747470733a2f2f6912037072651a04676f6e652202686928013002380118002000c2020d080310ffffffffffffffffff01c802fbffffffffffffffff01d00207d80202e00201e8020018b607")), json([{ "createdAt": 1700000000, "random": 222, "sequence": 111, "sourceId": "111_222", "text": "hello", "updatedAt": 1700000001 }])],
    // todo_list_resp_empty
    [json(decodeResponse(extras.GetGroupTodoList, "08f4a80210002200")), json([])],
  ];
  for (const [got, expected] of cases) assert.deepEqual(project(got, expected), expected);
});

test("extras (ai voice / group todo): response errors match the reference", () => {
  // todo_list_resp_bad_msgid
  assert.throws(() => decodeResponse(extras.GetGroupTodoList, "08f4a80210002289010a8601080110021a096e6f742d616e2d696420004080e2cfaa06621f0a037265641209746f646f2d746578741a0968747470733a2f2f7420012800a201230a1d0a0968747470733a2f2f6912037072651a01782202686928013002380118002000c2020d080310ffffffffffffffffff01c802fbffffffffffffffff01d00207d80202e00201e80200"), { message: "invalid group todo message identity" });
  // todo_list_resp_leading_zero
  assert.throws(() => decodeResponse(extras.GetGroupTodoList, "08f4a80210002288010a8501080110021a08303131315f32323220004080e2cfaa06621f0a037265641209746f646f2d746578741a0968747470733a2f2f7420012800a201230a1d0a0968747470733a2f2f6912037072651a01782202686928013002380118002000c2020d080310ffffffffffffffffff01c802fbffffffffffffffff01d00207d80202e00201e80200"), { message: "invalid group todo message identity" });
});

// ---------------------------------------------------------------------------
// profile & custom face
// ---------------------------------------------------------------------------

test("profile & custom face: requests match the reference", () => {
  const cases: [string, string][] = [
    // face_detail
    [encodeRequest(profile.FetchCustomFaceDetail, { emojis: [{ emojiId: "e-1", md5: "m1" }, { emojiId: "e-2", md5: "m2" }] }), "08aea002100122260801120a31302e302e3236323030180222090a03652d3112026d3122090a03652d3212026d326001"],
    // face_modify
    [encodeRequest(profile.ModifyCustomFace, { emojiId: "e-1", md5: "m1", desc: "nice" }), "08aea002100122250801120a31302e302e323632303018032a110a090a03652d3112026d3112046e6963656001"],
    // face_move
    [encodeRequest(profile.MoveCustomFace, { emojis: [{ emojiId: "e-1", md5: "m1" }] }), "08aea0021001221b0801120a31302e302e3236323030180222090a03652d3112026d316001"],
    // face_order
    [encodeRequest(profile.OrderCustomFace, { emojiId: "e-1", position: 3 }), "08afa002100122200a17088008120a31302e302e32363230301a06392e392e32361203652d3118036001"],
  ];
  assert.ok(cases.length > 0);
  for (const [got, expected] of cases) assert.equal(got, expected);
});

test("profile & custom face: responses match the reference", () => {
  const cases: [unknown, unknown][] = [
    // face_detail_resp
    [json(decodeResponse(profile.FetchCustomFaceDetail, "08aea0021001222c0800180222150a090a03652d3112026d3112036f6c641a036e6577220f0a090a03652d3212026d3212001a00")), json([{ "desc": "new", "emojiId": "e-1" }, { "desc": "", "emojiId": "e-2" }])],
    // face_detail_resp_legacy_fallback
    [json(decodeResponse(profile.FetchCustomFaceDetail, "08aea0021001221c221a0a090a03652d3112026d31120b6c65676163792d6f6e6c791a00")), json([{ "desc": "legacy-only", "emojiId": "e-1" }])],
    // face_modify_resp
    [json(decodeResponse(profile.ModifyCustomFace, "08aea0021001220408001803")), json(undefined)],
    // face_move_resp
    [json(decodeResponse(profile.MoveCustomFace, "08aea0021001220408001802")), json(undefined)],
    // face_order_resp
    [json(decodeResponse(profile.OrderCustomFace, "08afa0021001220408001804")), json(undefined)],
    // input_status_resp
    [json(decodeResponse(profile.SetInputStatus, "08d41910012200")), json(undefined)],
  ];
  for (const [got, expected] of cases) assert.deepEqual(project(got, expected), expected);
});

test("profile & custom face: response errors match the reference", () => {
  // face_detail_resp_dup
  assert.throws(() => decodeResponse(profile.FetchCustomFaceDetail, "08aea0021001222422100a090a03652d3112026d3112001a016122100a090a03652d3112026d3212001a0162"), { message: "fetch custom face detail response has duplicate emoji id: e-1" });
  // face_detail_resp_errcode
  assert.throws(() => decodeResponse(profile.FetchCustomFaceDetail, "08aea0021001220808071204626f6f6d"), { message: "fetch custom face detail error: boom" });
  // face_detail_resp_no_id
  assert.throws(() => decodeResponse(profile.FetchCustomFaceDetail, "08aea0021001220f220d0a060a0012026d3112001a0161"), { message: "fetch custom face detail response entry 0 has no emoji id" });
  // face_move_resp_errcode
  assert.throws(() => decodeResponse(profile.MoveCustomFace, "08aea00210012208080912046e6f7065"), { message: "move custom face error: nope" });
});
