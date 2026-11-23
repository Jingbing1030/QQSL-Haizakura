// `ForwardApi` — merged-forward (合并转发) upload and download, plus its result cache.
//
// ---------------------------------------------------------------------------
// Reference region
// ---------------------------------------------------------------------------
//   `src/bridge/apis/forward.ts`          reference/index.mjs:194374-194906
//   `src/bridge/apis/forward-cache.ts`    reference/index.mjs:177271-177310
//     `ForwardResultCache`                reference/index.mjs:177280
//     `forwardCaches` (WeakMap by ctx)    reference/index.mjs:194374
//   `assertNoWindowShakeInForward`        reference/index.mjs:194519
//   `assertPrivateForwardFileCapacity`    reference/index.mjs:194513
//   `buildForwardPushBody`                reference/index.mjs:194386
//   `deriveInnerSource` / `previewLinesFromNodes` / `previewFromElements`
//                                         reference/index.mjs:194449-194480
//
// ---------------------------------------------------------------------------
// The transport is trpc long-msg, NOT OIDB 0xebc
// ---------------------------------------------------------------------------
// The task brief that commissioned this port described the upload as
// `SsoSendMultiOidbTrpc` (msgForward 0xebc) with per-chunk layering once the node
// count exceeds one packet. **Neither exists in the reference bundle**:
//
//   grep -c "SsoSendMultiOidbTrpc" reference/index.mjs   # 0
//   grep -n "msgForward"            reference/index.mjs   # no match
//
// What `uploadRecursive` actually sends is the trpc long-message service, and the
// only "chunking" in it is NESTING (`node.innerForward`), not node-count slicing:
//
//   upload   trpc.group.long_msg_interface.MsgService.SsoSendLongMsg
//   fetch    trpc.group.long_msg_interface.MsgService.SsoRecvLongMsg
//              (reference/index.mjs:194681 and :194720)
//
// The payload is ONE gzipped `LongMsgResult` however many nodes it holds, so a
// 200-node forward is one large packet, not two layers. Layers appear only where
// the *user* nested a forward inside a forward. This file implements what the
// reference does, and the test file pins the exact request bytes.
//
// ---------------------------------------------------------------------------
// The upload wire structure (all field numbers measured, not guessed)
// ---------------------------------------------------------------------------
// `protobuf_encode_SendLongMsgReq` (reference/index.mjs:193253):
//
//   SendLongMsgReq
//     field 2  info      SendLongMsgInfo
//     field 15 settings  LongMsgSettings
//
//   SendLongMsgInfo (193337 __size_SendLongMsgInfo)
//     field 1  type      uint32   3 = group, 1 = private
//     field 2  uid       LongMsgUid { field 2 uid: string }
//     field 3  groupUin  uint32   group id (group only)
//     field 4  payload   bytes    gzip(LongMsgResult)
//
//   LongMsgSettings (193516)  — all four are plain uint32, emitted when non-zero
//     field 1 field1 = 4     field 2 field2 = 1
//     field 3 field3 = 7     field 4 field4 = 0   (0 is dropped by the presence rule)
//
// `LongMsgResult` (192807) → `LongMsgAction` (192941) → `LongMsgContent` (193126):
//
//   LongMsgResult  field 2 action: repeated LongMsgAction
//   LongMsgAction  field 1 actionCommand: string      field 2 actionData: LongMsgContent
//   LongMsgContent field 1 msgBody: repeated PushMsgBody
//
// and `PushMsgBody` is the ordinary message envelope (`field 1 responseHead`,
// `field 2 contentHead`, `field 3 body`), i.e. the *receive* message type with
// `ContentHead`'s field numbering (msgType=1, subType=2, c2cCmd=3, msgId=4,
// sequence=5, timestamp=6) — NOT `SendContentHead`'s single `type=1`.
//
// ---------------------------------------------------------------------------
// The download wire structure, including one asymmetry worth knowing
// ---------------------------------------------------------------------------
//   RecvLongMsgReq (193986)
//     field 1  info      RecvLongMsgInfo
//                         field 1 uid     LongMsgUid
//                         field 2 resId   string
//                         field 3 acquire bool (emitted when true)
//     field 15 settings  LongMsgSettings { field1: 2, rest 0 }
//
//   RecvLongMsgResp (194153)
//     field 1  result    { field 3 resId: string, field 4 payload: bytes }  (gzip)
//     field 15 settings
//
//   SendLongMsgResp (193792)
//     field 2  result    { field 3 resId: string }
//     field 15 settings
//
// **The result submessage sits at field 1 in the recv reply and field 2 in the send
// reply**, and its `resId` is field 3 in both. Getting that wrong is silent: the
// decoder finds no `result`, and the only symptom is "missing res_id" after a
// successful upload. `resId` inside `RecvLongMsgRespResult` is likewise field 3 and
// the payload field 4 — not 1 and 2.
//
// ---------------------------------------------------------------------------
// What this port does NOT do, and why it says so instead of pretending
// ---------------------------------------------------------------------------
//   1. **No upload-result caching.** The reference also caches the layers it just
//      uploaded (`uploadRecursive` → `cachedLayers` → `cache.set`), so that a
//      `get_forward_msg` on a fresh resId never leaves the process. That cache
//      stores *send-side* node objects, and this port's send and receive segment
//      types are two different unions (`element-builder.ts`'s `Segment` vs
//      `msg-push.ts`'s `MessageSegment`), so keeping them would need a lossy
//      send→receive projection. Instead the cache holds DECODED layers only, and a
//      fetch of a resId this session just uploaded costs one `SsoRecvLongMsg`. The
//      answer is then byte-identical to what the server holds, which is the reason
//      the divergence is acceptable rather than merely convenient.
//
//   2. **`file` elements inside a forward need the Highway uploader.** A file that
//      is already usable in the target chat is passed through; one that is not
//      (different group, or private) is re-uploaded through
//      `groupFile.upload` / `groupFile.uploadPrivate`. Those two live in
//      `apis/group-file.ts` and are implemented, so the call is real — but the
//      Highway PUT they perform is only as available as that module is. A `file`
//      element whose scope does not match AND that cannot be re-uploaded throws with
//      the reference's own wording rather than sending a bubble that points at a
//      file the receiver cannot open.
//
//   3. **Media inside a forward node needs the Highway media uploader.** Images,
//      records and videos go through `createMediaUploader` exactly as `MessageApi`'s
//      send paths do, so they are as real as that module. A node with no media never
//      touches Highway at all.
//
//   4. **Sender-name enrichment is best-effort and bounded.** `enrichSenders` fills
//      a decoded node's nickname from the group roster (L3) and then from a
//      per-uin profile lookup (L4), capped at `FORWARD_PROFILE_MAX` uins with
//      `FORWARD_PROFILE_CONCURRENCY` in flight. A failed lookup keeps QQ's
//      `QQ用户` placeholder rather than failing the whole fetch.

import { gzipSync, gunzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";

import { createLogger } from "../../onebot/log.js";
import { assertWindowShakeSendPolicy } from "../../onebot/actions/message-parser.js";
import type { BridgeContext } from "../context.js";
import {
  MessageElementValidationError,
  buildSendElems,
  type Segment,
  type SendContext,
} from "../../element-builder.js";
import { createMediaUploader, type MediaUploadContext } from "../../highway/pipeline.js";
import { ProtoReader, ProtoWriter } from "../../oidb/wire.js";
import {
  buildContextFromMessage,
  decodePush,
  type Identity,
  type MessageSegment,
  type MsgPushEvent,
} from "../../msg-push.js";
import { decodePushMsgBody } from "../../msg-push-fields.js";
import { keepDecodedMessage } from "./history-fetch.js";

const log = createLogger("Bridge.Forward");

// ===========================================================================
// Constants (reference/index.mjs:194376-194385, :177274)
// ===========================================================================

/** `MAX_CACHED_FORWARDS` — cache entries, not layers. reference:177274. */
export const MAX_CACHED_FORWARDS = 512;

/**
 * The `maxOutputLength` handed to `gunzipSync`. A long-message payload is gzipped
 * protobuf; an unbounded inflate is a zip bomb from the server's own process.
 * reference/index.mjs:194376.
 */
export const FORWARD_LONG_MSG_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/** QQ's placeholder when it does not hand back a real sender name. reference:194379. */
export const FORWARD_NAME_PLACEHOLDER = "QQ用户";

/** Per-fetch caps on the L4 profile fallback. reference:194384-194385. */
export const FORWARD_PROFILE_MAX = 20;
export const FORWARD_PROFILE_CONCURRENCY = 4;

/** The two trpc long-message commands. reference/index.mjs:194681, :194720. */
export const SEND_LONG_MSG_CMD = "trpc.group.long_msg_interface.MsgService.SsoSendLongMsg";
export const RECV_LONG_MSG_CMD = "trpc.group.long_msg_interface.MsgService.SsoRecvLongMsg";

// ===========================================================================
// Node types
// ===========================================================================
//
// Two types rather than the reference's one, because this port genuinely has two
// segment unions: `Segment` (element-builder, what `buildSendContent` encodes) and
// `MessageSegment` (msg-push, what the wire decoder produces). The reference bundle
// unifies them into one untyped `MessageElement`; keeping that here would mean
// `as` casts at every field read, which is exactly the un-auditable shape this port
// exists to avoid.

/** One node as the UPLOAD path takes it: send-side elements, ready for `buildSendElems`. */
export interface ForwardNodeInput {
  userUin: number;
  nickname: string;
  elements: readonly Segment[];
  time?: number | undefined;
  msgId?: number | undefined;
  msgSeq?: number | undefined;
  groupId?: number | undefined;
  senderCard?: string | undefined;
  messageType?: "group" | "private" | undefined;
  news?: readonly { text: string }[] | undefined;
  title?: string | undefined;
  source?: string | undefined;
  summary?: string | undefined;
  prompt?: string | undefined;
  /** A nested forward: uploaded first, then replaced by a `forward` element. */
  innerForward?: readonly ForwardNodeInput[] | undefined;
}

/** One node as the DOWNLOAD path returns it: decoded elements, ready for the OneBot converter. */
export interface ForwardNodePayload {
  userUin: number;
  nickname: string;
  elements: readonly MessageSegment[];
  time?: number | undefined;
  msgId?: number | undefined;
  msgSeq?: number | undefined;
  groupId?: number | undefined;
  senderCard?: string | undefined;
  messageType?: "group" | "private" | undefined;
}

/**
 * What {@link ForwardApi.uploadRecursive} answers.
 *
 * `resId` is what a caller sends; `uuid`/`msgBody`/`innerActions` exist so a PARENT
 * layer can piggyback this layer's bodies into its own packet. `upload` deliberately
 * narrows this to `resId`, because a caller outside the recursion has nothing to do
 * with a uuid.
 */
export interface ForwardUploadResult {
  resId: string;
  /** The key the parent layer uses for this layer's action. */
  uuid: string;
  /** This layer's own encoded bodies. */
  msgBody: Uint8Array[];
  /** Every nested layer's bodies, already flattened, for the parent to append. */
  innerActions: { uuid: string; msgBody: Uint8Array[] }[];
}

/**
 * The fields `ForwardApi` reads back from the upload cache.
 *
 * `context.ts`'s `UploadedFileMeta` is `{ fileId, [field: string]: unknown }` — an
 * open dictionary, so every read is `unknown` and every use needs a narrowing. This
 * names the six fields the forward path actually consults, once, instead of casting
 * at each of a dozen call sites. `readCachedFileMeta` is the only place the
 * dictionary is touched.
 */
interface ForwardFileMeta {
  fileName?: string | undefined;
  fileSize?: number | undefined;
  fileMd5?: Uint8Array | undefined;
  fileHash?: string | undefined;
  scope?: unknown;
  groupId?: unknown;
  userId?: unknown;
}

/** Narrow the upload cache's open dictionary into the fields this module reads. */
function readCachedFileMeta(meta: { [field: string]: unknown } | undefined): ForwardFileMeta | undefined {
  if (meta === undefined) return undefined;
  const out: ForwardFileMeta = {};
  const fileName = meta["fileName"];
  if (typeof fileName === "string") out.fileName = fileName;
  const fileSize = meta["fileSize"];
  if (typeof fileSize === "number") out.fileSize = fileSize;
  const fileMd5 = meta["fileMd5"];
  if (fileMd5 instanceof Uint8Array) out.fileMd5 = fileMd5;
  const fileHash = meta["fileHash"];
  if (typeof fileHash === "string") out.fileHash = fileHash;
  out.scope = meta["scope"];
  out.groupId = meta["groupId"];
  out.userId = meta["userId"];
  return out;
}

/** One decoded forward layer, as `fetch` returns it. */
export interface ForwardFetchResult {
  nodes: ForwardNodePayload[];
  /** Every layer this fetch resolved, keyed by resId — the outer one included. */
  layers: Map<string, ForwardNodePayload[]>;
}

// ===========================================================================
// The two policy asserts (reference/index.mjs:194513, :194519)
// ===========================================================================

/**
 * A private forward node may hold at most ONE `file` element.
 *
 * The limit is QQ's, not this port's: a c2c long-message body carries a single
 * `msgContent` FileExtra, so a second file has nowhere to be encoded and would be
 * silently dropped server-side. Throwing here names the constraint; dropping would
 * produce a forward that is quietly missing a file.
 *
 * Recurses into `innerForward` for the same reason it exists per node: each nested
 * layer is uploaded as a fresh c2c payload.
 */
export function assertPrivateForwardFileCapacity(nodes: readonly ForwardNodeInput[]): void {
  for (const node of nodes) {
    const files = node.elements.filter((element) => element.type === "file").length;
    if (files > 1) {
      throw new MessageElementValidationError(
        "UNSENDABLE_TYPE",
        "a private forward node can contain at most one file element",
        "file",
      );
    }
    if (node.innerForward !== undefined && node.innerForward.length > 0) {
      assertPrivateForwardFileCapacity(node.innerForward);
    }
  }
}

/**
 * Window shake (戳一戳) is refused anywhere inside a forward.
 *
 * A cache-miss re-upload is not a user action, so a poke inside it would be a poke
 * nobody asked for — and QQ's own client never produces one, which is why the
 * reference refuses rather than tolerates. The per-message policy is
 * `assertWindowShakeSendPolicy` (`message-parser.ts:53`, reference:6377); this only
 * applies it with the `"forward"` scene label, recursing into nested layers.
 *
 * Imported from the action layer rather than re-spelled: the constant (`> 1` or
 * combined with anything else) is a policy number, and a second copy would be a
 * second, silently divergent definition.
 */
export function assertNoWindowShakeInForward(nodes: readonly ForwardNodeInput[]): void {
  for (const node of nodes) {
    assertWindowShakeSendPolicy(
      node.elements.filter((element) => element.type === "poke").length,
      node.elements.length,
      "forward",
    );
    if (node.innerForward !== undefined && node.innerForward.length > 0) {
      assertNoWindowShakeInForward(node.innerForward);
    }
  }
}

// ===========================================================================
// ForwardResultCache (reference/index.mjs:177280)
// ===========================================================================

/**
 * Bounded, recency-ordered store of decoded forward layers.
 *
 * Two facts drive the design, both from the reference:
 *
 *   * an entry is a WHOLE TREE (`rootId` → every layer that tree resolved), because
 *     NapCat hoists a nested forward's piggybacks onto the outermost action list —
 *     so one `SsoRecvLongMsg` can answer fetches for several resIds;
 *   * a hit on ANY layer refreshes the whole tree (`entries.delete` + `set`), so a
 *     `get_forward_msg` on an inner layer keeps its siblings alive. Evicting per
 *     layer instead would make a repeatedly-opened nested forward pay for a refetch
 *     of the outer level every time.
 */
export class ForwardResultCache {
  readonly #entries = new Map<string, Map<string, ForwardNodePayload[]>>();

  /** Every live root, outermost first-in-order. Exposed for tests and diagnostics. */
  get size(): number {
    return this.#entries.size;
  }

  /** Root ids currently held, in recency order (oldest first). */
  roots(): string[] {
    return [...this.#entries.keys()];
  }

  /**
   * Look one layer up by resId.
   *
   * The reference iterates every entry rather than keeping a resId→root index; with
   * `MAX_CACHED_FORWARDS` = 512 that is at most a few thousand map lookups, and an
   * index would be a second thing to keep consistent on eviction.
   */
  get(resId: string): { rootId: string; resId: string; layers: Map<string, ForwardNodePayload[]>; nodes: ForwardNodePayload[] } | undefined {
    let hit: { rootId: string; resId: string; layers: Map<string, ForwardNodePayload[]>; nodes: ForwardNodePayload[] } | undefined;
    for (const [rootId, layers] of this.#entries) {
      const nodes = layers.get(resId);
      if (nodes !== undefined) hit = { rootId, resId, layers, nodes };
    }
    if (hit !== undefined) {
      // Recency: re-insert so the oldest surviving root is the one evicted first.
      this.#entries.delete(hit.rootId);
      this.#entries.set(hit.rootId, hit.layers);
    }
    return hit;
  }

  /**
   * Store one tree.
   *
   * The outer result must be present: a layer set without its root would be
   * unreachable by any future `get` (the scan only looks *inside* entries) and would
   * hold memory until eviction. That is a caller bug, so it throws.
   */
  set(rootId: string, layers: Map<string, ForwardNodePayload[]>): void {
    if (!layers.has(rootId)) throw new Error("forward cache entry is missing its outer result");
    this.#entries.delete(rootId);
    this.#entries.set(rootId, new Map(layers));
    while (this.#entries.size > MAX_CACHED_FORWARDS) {
      const oldest = this.#entries.entries().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest[0]);
      log.trace("forward cache evicted: res_id=%s layers=%d remaining=%d", oldest[0], oldest[1].size, this.#entries.size);
    }
  }

  /**
   * Replace one layer's nodes in place, but only if the hit is still current.
   *
   * The identity checks are the point: between a `get` and an `update` the whole
   * tree may have been evicted and re-fetched, and writing into the stale map would
   * discard the newer data.
   */
  update(hit: { rootId: string; resId: string; layers: Map<string, ForwardNodePayload[]>; nodes: ForwardNodePayload[] }, nodes: ForwardNodePayload[]): void {
    if (this.#entries.get(hit.rootId) === hit.layers && hit.layers.get(hit.resId) === hit.nodes) {
      hit.layers.set(hit.resId, nodes);
    }
  }

  clear(): void {
    this.#entries.clear();
  }
}

/**
 * One cache per bridge context.
 *
 * A `WeakMap` and not a field on `ForwardApi`, because the reference keys it by the
 * whole `ctx` (reference:194374): several API objects can exist for one account
 * (the hub builds one, a test may build another), and they must share what was
 * fetched. Keying by ctx also means the cache dies with the session instead of being
 * carried into the next login.
 */
const forwardCaches = new WeakMap<object, ForwardResultCache>();

// ===========================================================================
// Wire codecs
// ===========================================================================
//
// Every function below mirrors one `__write_*` in the reference, including its
// presence rule. Where a field number is surprising it is called out, because the
// surprising ones are the ones that fail silently.

/** `LongMsgUid` (reference:193475): `uid` is FIELD 2, not 1. */
export function encodeLongMsgUid(uid: string): Uint8Array {
  return new ProtoWriter(32).string(2, uid).finish();
}

/** `SendLongMsgInfo` (reference:193337). */
export function encodeSendLongMsgInfo(info: {
  type: number;
  uid?: string | undefined;
  groupUin?: number | undefined;
  payload?: Uint8Array | undefined;
}): Uint8Array {
  const w = new ProtoWriter(64);
  w.uint32(1, info.type);
  if (info.uid !== undefined) w.message(2, encodeLongMsgUid(info.uid));
  w.uint32(3, info.groupUin);
  w.bytes(4, info.payload);
  return w.finish();
}

/** `LongMsgSettings` (reference:193516). Four opaque uint32s; `field4: 0` is dropped. */
export function encodeLongMsgSettings(settings: {
  field1?: number | undefined;
  field2?: number | undefined;
  field3?: number | undefined;
  field4?: number | undefined;
}): Uint8Array {
  const w = new ProtoWriter(16);
  w.uint32(1, settings.field1);
  w.uint32(2, settings.field2);
  w.uint32(3, settings.field3);
  w.uint32(4, settings.field4);
  return w.finish();
}

/** `SendLongMsgReq` (reference:193253): `info` at field 2, `settings` at field 15. */
export function encodeSendLongMsgReq(request: {
  info: Parameters<typeof encodeSendLongMsgInfo>[0];
  settings: Parameters<typeof encodeLongMsgSettings>[0];
}): Uint8Array {
  return new ProtoWriter(128)
    .message(2, encodeSendLongMsgInfo(request.info))
    .message(15, encodeLongMsgSettings(request.settings))
    .finish();
}

/** `RecvLongMsgInfo` (reference:194100 region). `acquire` is emitted only when `true`. */
export function encodeRecvLongMsgInfo(info: {
  uid?: string | undefined;
  resId?: string | undefined;
  acquire?: boolean | undefined;
}): Uint8Array {
  const w = new ProtoWriter(64);
  if (info.uid !== undefined) w.message(1, encodeLongMsgUid(info.uid));
  w.string(2, info.resId);
  w.bool(3, info.acquire);
  return w.finish();
}

/** `RecvLongMsgReq` (reference:193986): `info` at field 1, `settings` at field 15. */
export function encodeRecvLongMsgReq(request: {
  info: Parameters<typeof encodeRecvLongMsgInfo>[0];
  settings: Parameters<typeof encodeLongMsgSettings>[0];
}): Uint8Array {
  return new ProtoWriter(128)
    .message(1, encodeRecvLongMsgInfo(request.info))
    .message(15, encodeLongMsgSettings(request.settings))
    .finish();
}

/** `LongMsgContent` (reference:193126): `msgBody` is a REPEATED field 1. */
export function encodeLongMsgContent(msgBody: readonly Uint8Array[]): Uint8Array {
  return new ProtoWriter(256).repeatedMessage(1, msgBody).finish();
}

/** `LongMsgAction` (reference:192941): `actionCommand` field 1, `actionData` field 2. */
export function encodeLongMsgAction(action: {
  actionCommand: string;
  actionData: { msgBody: readonly Uint8Array[] };
}): Uint8Array {
  return new ProtoWriter(256)
    .string(1, action.actionCommand)
    .message(2, encodeLongMsgContent(action.actionData.msgBody))
    .finish();
}

/** `LongMsgResult` (reference:192807): `action` is REPEATED field 2. */
export function encodeLongMsgResult(result: {
  action: readonly Parameters<typeof encodeLongMsgAction>[0][];
}): Uint8Array {
  return new ProtoWriter(512)
    .repeatedMessage(2, result.action.map((action) => encodeLongMsgAction(action)))
    .finish();
}

/**
 * `ResponseForward` (reference:194420 region): `friendName` is FIELD 10.
 *
 * The jump from `ResponseHead` (1..8) to 10 is real, not a transcription slip: the
 * reference writes tag 40 for `tempGroupUin` and 50 for `friendName`.
 */
export function encodeResponseForward(forward: { tempGroupUin?: number | undefined; friendName?: string | undefined }): Uint8Array {
  const w = new ProtoWriter(32);
  w.uint32(5, forward.tempGroupUin);
  w.string(10, forward.friendName);
  return w.finish();
}

/** `ResponseHead` (reference:177930). Field 7 is `forward`, field 8 `grp`. */
export function encodeResponseHead(head: {
  fromUin?: number | undefined;
  fromUid?: string | undefined;
  type?: number | undefined;
  sigMap?: number | undefined;
  toUin?: number | undefined;
  toUid?: string | undefined;
  forward?: { tempGroupUin?: number | undefined; friendName?: string | undefined } | undefined;
}): Uint8Array {
  const w = new ProtoWriter(64);
  w.uint32(1, head.fromUin);
  w.string(2, head.fromUid);
  w.uint32(3, head.type);
  w.uint32(4, head.sigMap);
  w.uint32(5, head.toUin);
  w.string(6, head.toUid);
  if (head.forward !== undefined) w.message(7, encodeResponseForward(head.forward));
  return w.finish();
}

/**
 * `ContentHead` (reference:178892) — the RECEIVE numbering.
 *
 * Note this is a different message from `SendContentHead` (whose only field is
 * `type` at 1). A long-message body must use this one: the server stores an ordinary
 * inbound message envelope, and `msgType: 9 / subType: 4` is what makes the receiver
 * render it as a forward card.
 */
export function encodeContentHead(head: {
  msgType?: number | undefined;
  subType?: number | undefined;
  c2cCmd?: number | undefined;
  msgId?: number | undefined;
  sequence?: number | undefined;
  timestamp?: number | undefined;
}): Uint8Array {
  const w = new ProtoWriter(64);
  w.uint32(1, head.msgType);
  w.uint32(2, head.subType);
  w.uint32(3, head.c2cCmd);
  w.uint32(4, head.msgId);
  w.uint32(5, head.sequence);
  w.uint32(6, head.timestamp);
  return w.finish();
}

/** `RichText` (reference:179537): `elems` is REPEATED FIELD 2 (field 1 is unused). */
export function encodeReceiveRichText(elems: readonly Uint8Array[]): Uint8Array {
  return new ProtoWriter(256).repeatedMessage(2, elems).finish();
}

/** `MessageBody` (reference:179340): `richText` field 1, `msgContent` field 2. */
export function encodeMessageBody(body: {
  richText?: Uint8Array | undefined;
  msgContent?: Uint8Array | undefined;
}): Uint8Array {
  const w = new ProtoWriter(128);
  w.message(1, body.richText);
  w.bytes(2, body.msgContent);
  return w.finish();
}

/** `PushMsgBody` (reference:177658): responseHead 1, contentHead 2, body 3. */
export function encodePushMsgBody(body: {
  responseHead?: Uint8Array | undefined;
  contentHead?: Uint8Array | undefined;
  body?: Uint8Array | undefined;
}): Uint8Array {
  const w = new ProtoWriter(256);
  w.message(1, body.responseHead);
  w.message(2, body.contentHead);
  w.message(3, body.body);
  return w.finish();
}

/**
 * `NotOnlineFile` (reference:194400 region) — the private forward's `FileExtra.file`.
 *
 * Field 1 `fileType`, 3 `fileUuid`, 4 `fileMd5`, 5 `fileName`, 6 `fileSize`,
 * 9 `subcmd`, 50 `dangerEvel`, 55 `expireTime`, 57 `fileHash`. The two gaps (1→3,
 * 6→9, 9→50) are the reference's, and `expireTime` at 55 is why this is written out
 * rather than reused from an element encoder — `element-builder.ts` has no
 * `NotOnlineFile` writer at all (the send path uses `transElem(24)` instead).
 */
export function encodeNotOnlineFile(file: {
  fileType?: number | undefined;
  fileUuid?: string | undefined;
  fileMd5?: Uint8Array | undefined;
  fileName?: string | undefined;
  fileSize?: number | bigint | undefined;
  subcmd?: number | undefined;
  dangerEvel?: number | undefined;
  expireTime?: number | undefined;
  fileHash?: string | undefined;
}): Uint8Array {
  const w = new ProtoWriter(128);
  w.uint32(1, file.fileType);
  w.string(3, file.fileUuid);
  w.bytes(4, file.fileMd5);
  w.string(5, file.fileName);
  w.uint64(6, file.fileSize);
  w.uint32(9, file.subcmd);
  w.uint32(50, file.dangerEvel);
  w.uint32(55, file.expireTime);
  w.string(57, file.fileHash);
  return w.finish();
}

/** `FileExtra` (reference:194386's `msgContent`): `file` at field 1, `field6` at 6. */
export function encodeFileExtra(file: Uint8Array): Uint8Array {
  return new ProtoWriter(64).message(1, file).finish();
}

// --- response decoders -----------------------------------------------------

/** `SendLongMsgRespResult` (reference:193700 region): `resId` is FIELD 3 (tag 26). */
export interface SendLongMsgRespResult {
  resId: string;
}

/** `RecvLongMsgRespResult`: `resId` field 3 (tag 26), `payload` field 4 (tag 34). */
export interface RecvLongMsgRespResult {
  resId: string;
  payload: Uint8Array;
}

function decodeSendLongMsgRespResult(data: Uint8Array, offset = 0, end = data.length): SendLongMsgRespResult {
  const reader = new ProtoReader(data, offset, end);
  let resId = "";
  while (reader.next()) {
    if (reader.fieldNumber === 3 && reader.wireType === 2) resId = reader.string();
    else reader.skip();
  }
  return { resId };
}

function decodeRecvLongMsgRespResult(data: Uint8Array, offset = 0, end = data.length): RecvLongMsgRespResult {
  const reader = new ProtoReader(data, offset, end);
  let resId = "";
  let payload: Uint8Array = new Uint8Array(0);
  while (reader.next()) {
    if (reader.fieldNumber === 3 && reader.wireType === 2) resId = reader.string();
    else if (reader.fieldNumber === 4 && reader.wireType === 2) payload = reader.bytes();
    else reader.skip();
  }
  return { resId, payload };
}

/** `SendLongMsgResp`: the result submessage is FIELD 2 here (tag 18 → field 2). */
export function decodeSendLongMsgResp(data: Uint8Array): SendLongMsgRespResult | null {
  const reader = new ProtoReader(data);
  let result: SendLongMsgRespResult | null = null;
  while (reader.next()) {
    if (reader.fieldNumber === 2 && reader.wireType === 2) result = reader.message(decodeSendLongMsgRespResult);
    else reader.skip();
  }
  return result;
}

/** `RecvLongMsgResp`: the result submessage is FIELD 1 here (tag 10 → field 1). */
export function decodeRecvLongMsgResp(data: Uint8Array): RecvLongMsgRespResult | null {
  const reader = new ProtoReader(data);
  let result: RecvLongMsgRespResult | null = null;
  while (reader.next()) {
    if (reader.fieldNumber === 1 && reader.wireType === 2) result = reader.message(decodeRecvLongMsgRespResult);
    else reader.skip();
  }
  return result;
}

/** One `LongMsgAction` after decoding. */
export interface DecodedLongMsgAction {
  actionCommand: string;
  msgBody: Uint8Array[];
}

/** One `LongMsgContent` → its repeated `PushMsgBody` blobs, undecoded. */
function decodeLongMsgContent(data: Uint8Array, offset: number, end: number): Uint8Array[] {
  const reader = new ProtoReader(data, offset, end);
  const bodies: Uint8Array[] = [];
  while (reader.next()) {
    if (reader.fieldNumber === 1 && reader.wireType === 2) bodies.push(reader.bytes());
    else reader.skip();
  }
  return bodies;
}

function decodeLongMsgAction(data: Uint8Array): DecodedLongMsgAction {
  const reader = new ProtoReader(data);
  let actionCommand = "";
  let msgBody: Uint8Array[] = [];
  while (reader.next()) {
    if (reader.fieldNumber === 1 && reader.wireType === 2) actionCommand = reader.string();
    else if (reader.fieldNumber === 2 && reader.wireType === 2) msgBody = reader.message(decodeLongMsgContent);
    else reader.skip();
  }
  return { actionCommand, msgBody };
}

/** `LongMsgResult` → its `action` list. Field 2, repeated. */
export function decodeLongMsgResult(data: Uint8Array): DecodedLongMsgAction[] {
  const reader = new ProtoReader(data);
  const actions: DecodedLongMsgAction[] = [];
  while (reader.next()) {
    if (reader.fieldNumber === 2 && reader.wireType === 2) actions.push(reader.message((d, o, e) => decodeLongMsgAction(d.subarray(o, e))));
    else reader.skip();
  }
  return actions;
}

// ===========================================================================
// Small helpers
// ===========================================================================

/**
 * `resolveSelfUid` (reference/index.mjs:82652).
 *
 * A fourth copy of this six-line function, and deliberately so: `apis/message.ts` and
 * `apis/group-file.ts` each keep a private one (the latter documents why it does not
 * import the former), and hoisting it into `context.ts` would make a bridge module's
 * helper part of the layer contract.
 */
async function resolveSelfUid(ctx: BridgeContext): Promise<string> {
  const cached = ctx.identity.selfUid;
  if (typeof cached === "string" && cached.length > 0) return cached;
  const selfUin = Number(ctx.identity.uin);
  if (!Number.isFinite(selfUin) || selfUin <= 0) throw new Error("self uid is unavailable");
  return ctx.resolveUserUid(selfUin);
}

/**
 * `BridgeIdentity` → `msg-push.ts`'s `Identity`.
 *
 * The third copy of this adapter (`apis/history-fetch.ts:87` keeps one privately).
 * The two interfaces differ only in `null` vs `undefined` for a miss, which every
 * consumer treats alike — see the note on `asInboundIdentity` in that file.
 */
function asInboundIdentity(identity: BridgeContext["identity"]): Identity {
  return {
    findUinByUid: (uid, groupId) => identity.findUinByUid(uid, groupId) ?? undefined,
    findGroupMember: (groupId, uin) => identity.findGroupMember(groupId, uin) ?? undefined,
    findFriend: (uin) => identity.findFriend(uin) ?? undefined,
    findGroup: (groupId) => identity.findGroup(groupId) ?? undefined,
  };
}

/** `mapWithConcurrency` (reference:11011): batches, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        out[index] = await run(items[index]!, index);
      }
    }),
  );
  return out;
}

/** `hexToBytesLocal` (reference:194387). Odd-length input is truncated, not rejected. */
export function hexToBytesLocal(hex: string): Uint8Array {
  const s = hex.trim();
  if (!s) return new Uint8Array(0);
  const len = s.length >> 1;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = Number.parseInt(s.substr(i * 2, 2), 16);
  return out;
}

/** `isMessageMedia` (reference:22877). */
function isMessageMedia(element: Segment): boolean {
  return element.type === "image" || element.type === "record" || element.type === "video";
}

/** `cloneNodeWithElements` (reference:194481). */
function cloneInputNode(node: ForwardNodeInput, elements: readonly Segment[]): ForwardNodeInput {
  const next: ForwardNodeInput = { ...node, elements };
  if (node.news !== undefined) next.news = node.news.map((item) => ({ ...item }));
  return next;
}

/** `cloneNodes` (reference:194899) for the payload side. */
function clonePayloadNodes(nodes: readonly ForwardNodePayload[]): ForwardNodePayload[] {
  return nodes.map((node) => ({ ...node, elements: [...node.elements] }));
}

/** `stripFileSource` (reference:194486): drop `url` so the element is not re-uploaded. */
function stripFileSource(element: Segment): Segment {
  const next: Record<string, unknown> = { ...element };
  delete next["url"];
  return next as unknown as Segment;
}

/**
 * `isCachedFileUsableInTarget` (reference:194491).
 *
 * `undefined` cached metadata answers `true`: an uncached file id is not proof of a
 * wrong scope, and refusing it would break a caller that passed a `file_id` obtained
 * in the target chat by another process.
 */
function isCachedFileUsableInTarget(
  cached: ForwardFileMeta | undefined,
  groupId: number | undefined,
  userId: number | undefined,
): boolean {
  if (cached === undefined) return true;
  if (groupId !== undefined) return cached.scope === "group" && cached.groupId === groupId;
  if (userId !== undefined) return cached.scope === "private" && cached.userId === userId;
  return true;
}

/** `fileNameForUpload` (reference:194498). */
function fileNameForUpload(element: { fileName?: string | undefined }, cached?: ForwardFileMeta | undefined): string {
  return (element.fileName ?? cached?.fileName ?? "").trim();
}

// --- preview derivation (reference:194449-194480) ---------------------------

/** `previewFromElements`: the first renderable label, text truncated to 30 chars. */
function previewFromElements(elements: readonly Segment[]): string {
  for (const element of elements) {
    switch (element.type) {
      case "text":
        if (element.text) return element.text.slice(0, 30);
        break;
      case "image":
        return "[图片]";
      case "record":
        return "[语音]";
      case "video":
        return "[视频]";
      case "file":
        return "[文件]";
      case "forward":
        return "[聊天记录]";
      case "face":
        return "[表情]";
      default:
        break;
    }
  }
  return "";
}

/** `deriveInnerSource`: "<a>和<b>的聊天记录", capped at four distinct nicknames. */
function deriveInnerSource(nodes: readonly { nickname?: string | undefined }[], isGroup: boolean): string {
  const nicks: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const name = (node.nickname ?? "").trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      nicks.push(name);
    }
    if (nicks.length >= 4) break;
  }
  if (nicks.length === 0) return isGroup ? "群聊的聊天记录" : "聊天记录";
  return `${nicks.join("和")}的聊天记录`;
}

/** `previewLinesFromNodes`: at most four `name: text` lines for the ARK preview. */
function previewLinesFromNodes(nodes: readonly ForwardNodeInput[]): { text: string }[] {
  return nodes.slice(0, 4).map((node) => {
    const name = (node.nickname ?? "").trim() || String(node.userUin || FORWARD_NAME_PLACEHOLDER);
    const previewText = previewFromElements(node.elements);
    return { text: previewText ? `${name}: ${previewText}` : name };
  });
}

// ===========================================================================
// ForwardApi
// ===========================================================================

/**
 * The forward API. Reference `var ForwardApi = class` at reference/index.mjs:194525.
 *
 * Methods, in the reference's order:
 *
 *   upload                    nodes → res_id (plus the two policy asserts)
 *   downloadSourceFromCachedFile   cached file meta → a URL the uploader can read
 *   uploadForwardFileSource   a URL/path → a `file` element in the TARGET chat
 *   prepareForwardFileElement one element's scope fix-up
 *   prepareForwardFiles       all nodes' scope fix-ups
 *   uploadRecursive           the nesting-aware upload (piggyback + inner resIds)
 *   fetch                     res_id → decoded nodes (SsoRecvLongMsg)
 *   needsName / enrichSenders sender-name backfill
 *   decodeMsgBodiesToNodes    PushMsgBody → `ForwardNodePayload`
 *   collectForwardLayers      piggyback table → every reachable layer
 */
export class ForwardApi {
  readonly #ctx: BridgeContext;
  readonly #cache: ForwardResultCache;
  readonly #now: () => number;
  readonly #randomInt: (max: number) => number;
  readonly #uuid: () => string;
  #mediaSessionCache: Parameters<typeof createMediaUploader>[0]["sessionCache"];

  /**
   * `ForwardApiOptions` is a TEST SEAM, not a configuration surface.
   *
   * A forward upload embeds three non-deterministic values per node — `msgId`
   * (random), `sequence` (random), `timestamp` (now) — and the whole payload is
   * gzipped before it is sent. Without a seam, "the request bytes are exactly these"
   * is unassertable, and a byte-level test would have to fall back to decoding its
   * own output (which would not catch an encoder bug that the decoder shares).
   * Production construction passes nothing and gets `Date.now` / `Math.random` /
   * `randomUUID`, i.e. the reference's own sources.
   */
  constructor(
    ctx: BridgeContext,
    options: {
      cache?: ForwardResultCache | undefined;
      now?: (() => number) | undefined;
      randomInt?: ((max: number) => number) | undefined;
      uuid?: (() => string) | undefined;
    } = {},
  ) {
    this.#ctx = ctx;
    let cache = options.cache ?? forwardCaches.get(ctx as unknown as object);
    if (cache === undefined) {
      cache = new ForwardResultCache();
      forwardCaches.set(ctx as unknown as object, cache);
    }
    this.#cache = cache;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.#randomInt = options.randomInt ?? ((max: number) => Math.floor(Math.random() * max));
    this.#uuid = options.uuid ?? (() => randomUUID());
    this.#mediaSessionCache = undefined;
  }

  /** The cache this instance shares. Exposed for a host that wants to inspect or clear it. */
  get cache(): ForwardResultCache {
    return this.#cache;
  }

  // -------------------------------------------------------------------------
  // upload (reference:194532)
  // -------------------------------------------------------------------------

  /**
   * Upload a node list and answer its res_id.
   *
   * The two policy checks run BEFORE any packet is sent, in the reference's order:
   * window shake for every target, private file capacity only for a private target.
   * Order matters — a private forward with both a poke and two files must fail with
   * the shake error, which is what the reference produces.
   */
  async upload(nodes: readonly ForwardNodeInput[], groupId?: number, userId?: number): Promise<string> {
    assertNoWindowShakeInForward(nodes);
    if (groupId === undefined) assertPrivateForwardFileCapacity(nodes);
    const { resId } = await this.uploadRecursive(nodes, groupId, userId);
    return resId;
  }

  // -------------------------------------------------------------------------
  // forward file scope handling (reference:194546-194600)
  // -------------------------------------------------------------------------

  /**
   * Resolve a cached file id into a URL the uploader can read.
   *
   * The error wording is the reference's, and it names the real constraint: a
   * `file_id` is scoped to the chat it was uploaded in. There is no cross-scope id,
   * so a caller that has only an id from another chat must supply bytes instead.
   */
  async downloadSourceFromCachedFile(cached: ForwardFileMeta & { fileId?: string | undefined }): Promise<string> {
    const fileId = cached.fileId ?? "";
    if (cached.scope === "group" && typeof cached.groupId === "number") {
      return this.#groupFile().getUrl(cached.groupId, fileId);
    }
    if (cached.scope === "private" && typeof cached.userId === "number" && typeof cached.fileHash === "string" && cached.fileHash) {
      return this.#groupFile().getPrivateUrl(cached.userId, fileId, cached.fileHash);
    }
    throw new Error(
      "forward file_id belongs to another scope; pass file/base64/url so Haizakura can re-upload it",
    );
  }

  /**
   * Upload one file source into the TARGET chat and answer a `file` element for it.
   *
   * `publishFile: false` on both calls: the file is about to ride a forward body, so
   * publishing it as a standalone chat message would post it twice.
   */
  async uploadForwardFileSource(
    source: string,
    name: string,
    groupId?: number,
    userId?: number,
  ): Promise<Segment> {
    if (groupId !== undefined) {
      const uploaded = await this.#groupFile().upload(groupId, source, name, "/", true, false);
      if (!uploaded.fileId) throw new Error("forward group file upload returned no file_id");
      const cached = readCachedFileMeta(this.#ctx.recallUploadedFile(uploaded.fileId));
      const element: Segment = { type: "file", fileId: uploaded.fileId };
      const fileName = cached?.fileName || name;
      if (fileName) element.fileName = fileName;
      if (cached?.fileSize !== undefined) element.fileSize = cached.fileSize;
      return element;
    }
    if (userId !== undefined) {
      const uploaded = await this.#groupFile().uploadPrivate(userId, source, name, true, false);
      if (!uploaded.fileId) throw new Error("forward private file upload returned no file_id");
      const cached = readCachedFileMeta(this.#ctx.recallUploadedFile(uploaded.fileId));
      const element: Segment = { type: "file", fileId: uploaded.fileId };
      const fileName = cached?.fileName || name;
      const fileHash = uploaded.fileHash ?? cached?.fileHash ?? "";
      if (fileName) element.fileName = fileName;
      if (cached?.fileSize !== undefined) element.fileSize = cached.fileSize;
      if (fileHash) element.fileHash = fileHash;
      return element;
    }
    throw new Error("forward file source requires group_id or user_id");
  }

  /**
   * Make one `file` element usable in the target chat.
   *
   * Three cases, exactly as the reference splits them:
   *   * no `fileId` but a `url` → upload the URL into the target;
   *   * a `fileId` whose cached scope matches the target → pass through untouched
   *     (it is the target's own id, so nothing needs to move);
   *   * a `fileId` from another scope → download a fresh URL and re-upload.
   *
   * A `fileId` with NO cache entry passes through: see
   * {@link isCachedFileUsableInTarget} for why an unknown scope is not evidence of a
   * wrong one.
   */
  async prepareForwardFileElement(
    element: Segment,
    groupId: number | undefined,
    userId: number | undefined,
  ): Promise<Segment> {
    if (element.type !== "file") return element;
    const source = (element.url ?? "").trim();
    if (source && !element.fileId) {
      const uploaded = await this.uploadForwardFileSource(source, fileNameForUpload(element), groupId, userId);
      return { ...(stripFileSource(element) as Segment), ...uploaded };
    }
    if (element.fileId) {
      const cached = readCachedFileMeta(this.#ctx.recallUploadedFile(element.fileId));
      if (isCachedFileUsableInTarget(cached, groupId, userId)) return element;
      const sourceFromCache = await this.downloadSourceFromCachedFile({ ...cached, fileId: element.fileId });
      const uploaded = await this.uploadForwardFileSource(
        sourceFromCache,
        fileNameForUpload(element, cached),
        groupId,
        userId,
      );
      return { ...(stripFileSource(element) as Segment), ...uploaded };
    }
    return element;
  }

  /** Every node's file elements, fixed up in parallel (reference:194592). */
  async prepareForwardFiles(
    nodes: readonly ForwardNodeInput[],
    groupId: number | undefined,
    userId: number | undefined,
  ): Promise<ForwardNodeInput[]> {
    return await Promise.all(
      nodes.map(async (node) =>
        cloneInputNode(
          node,
          await Promise.all(node.elements.map((element) => this.prepareForwardFileElement(element, groupId, userId))),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // uploadRecursive (reference:194620)
  // -------------------------------------------------------------------------

  /**
   * The recursion, and the one place the word "chunk" could be misread.
   *
   * The reference's own comment calls this "NapCat-style piggyback", and that is what
   * it is:
   *
   *   1. every node with a nested `innerForward` is uploaded FIRST, recursively;
   *   2. that node's `elements` are replaced by ONE `forward` element pointing at the
   *      inner res_id, carrying the preview text/`tSum` the receiver renders;
   *   3. the inner layer's `{uuid, msgBody}` — plus every piggyback IT accumulated —
   *      is appended to this layer's action list, so the whole tree travels in one
   *      packet and a receiver can resolve nested layers without another fetch;
   *   4. this layer is gzipped and sent as ONE `SendLongMsgReq`.
   *
   * So the payload is `[MultiMsg + thisMsgBody, ...innerActions]`: one "MultiMsg"
   * action holding this layer's bodies, then one action per nested layer keyed by the
   * uuid the `forward` element names. `resId` comes back from the server; nothing is
   * cached here (see the file header for that divergence and why it is safe).
   */
  async uploadRecursive(
    nodes: readonly ForwardNodeInput[],
    groupId?: number,
    userId?: number,
  ): Promise<ForwardUploadResult> {
    if (!Array.isArray(nodes) || nodes.length === 0) throw new Error("forward nodes are required");

    // A private target needs its uid only when the body actually addresses it: a
    // nested forward or a media element. Text-only c2c nodes carry no uid, and
    // resolving one would add a network lookup to every plain text forward.
    let userUid: string | undefined;
    if (groupId === undefined && userId !== undefined && userId > 0) {
      const needsUid = nodes.some(
        (node) =>
          (node.innerForward !== undefined && node.innerForward.length > 0) ||
          node.elements.some((element: Segment) => isMessageMedia(element)),
      );
      if (needsUid) {
        const resolved = await this.#ctx.resolveUserUid(userId);
        if (resolved) userUid = resolved;
      }
    }

    const isGroup = groupId !== undefined;
    const innerActions: { uuid: string; msgBody: Uint8Array[] }[] = [];
    const processed: ForwardNodeInput[] = [];

    for (const node of nodes) {
      if (node.innerForward !== undefined && node.innerForward.length > 0) {
        const inner = await this.uploadRecursive(node.innerForward, groupId, userId);
        const innerNodes = node.innerForward;
        const preview: Segment = {
          type: "forward",
          resId: inner.resId,
          forwardUuid: inner.uuid,
          forwardSource:
            node.source !== undefined && node.source.length > 0
              ? node.source
              : deriveInnerSource(innerNodes, isGroup),
          forwardSummary:
            node.summary !== undefined && node.summary.length > 0
              ? node.summary
              : `查看${innerNodes.length}条转发消息`,
          forwardPrompt:
            node.prompt !== undefined && node.prompt.length > 0 ? node.prompt : "[聊天记录]",
          forwardNews:
            node.news !== undefined && node.news.length > 0 ? node.news : previewLinesFromNodes(innerNodes),
          forwardTSum: innerNodes.length,
        };
        innerActions.push({ uuid: inner.uuid, msgBody: inner.msgBody });
        innerActions.push(...inner.innerActions);
        const replacement = cloneInputNode(node, [preview]);
        delete(replacement as { innerForward?: unknown }).innerForward;
        processed.push(replacement);
      } else {
        processed.push(node);
      }
    }

    const uploadReady = await this.prepareForwardFiles(processed, groupId, userId);
    const msgBody = await Promise.all(
      uploadReady.map(async (node) => await this.buildForwardPushBody(node, groupId, userUid)),
    );

    const longMsgResult = encodeLongMsgResult({
      action: [
        { actionCommand: "MultiMsg", actionData: { msgBody } },
        ...innerActions.map((action) => ({ actionCommand: action.uuid, actionData: { msgBody: action.msgBody } })),
      ],
    });

    const selfUid = await resolveSelfUid(this.#ctx);
    const payload = new Uint8Array(gzipSync(Buffer.from(longMsgResult)));
    const request = encodeSendLongMsgReq({
      info: {
        // 3 = group, 1 = private. The `uid` is the GROUP id when there is one — the
        // long-message service keys a group's payloads by the group, not the sender.
        type: isGroup ? 3 : 1,
        uid: isGroup ? String(groupId) : selfUid,
        ...(isGroup ? { groupUin: groupId } : {}),
        payload,
      },
      settings: { field1: 4, field2: 1, field3: 7, field4: 0 },
    });

    const result = await this.#ctx.sendRawPacket(SEND_LONG_MSG_CMD, request);
    if (!result.success || !result.gotResponse || !result.responseData) {
      throw new Error(result.errorMessage || "upload forward message failed");
    }
    const resId = decodeSendLongMsgResp(result.responseData)?.resId ?? "";
    if (!resId) throw new Error("upload forward message response missing res_id");
    log.debug("forward uploaded: res_id=%s nodes=%d inner_layers=%d bytes=%d", resId, uploadReady.length, innerActions.length, payload.byteLength);
    // `uuid` is what the PARENT layer will key this action by. It is generated here
    // (the reference does the same) rather than derived from the res_id, because the
    // receiver matches on the `forwardUuid` field of the preview element.
    return { resId, uuid: this.#uuid(), msgBody, innerActions };
  }

  /**
   * One node → one `PushMsgBody` (reference:194386 `buildForwardPushBody`).
   *
   * The shape is a *received* private/group message, not an outbound one:
   * `responseHead.forward.friendName` carries the display name, `contentHead` is
   * `{msgType: 9, subType: 4}` (the "merged forward" pair), and the body is a normal
   * `richText`.
   *
   * `toUid` is the SELF uid even for a group node. That is the reference's choice and
   * it is deliberate: the long-message service stores the body verbatim and the
   * receiver reads `fromUin`, so a `toUid` naming the group would be a lie about a
   * message that was never sent.
   */
  private async buildForwardPushBody(
    node: ForwardNodeInput,
    groupId: number | undefined,
    userUid: string | undefined,
  ): Promise<Uint8Array> {
    const fromUin = node.userUin > 0 ? node.userUin : Number.parseInt(this.#ctx.identity.uin, 10) || 0;
    if (fromUin <= 0) throw new Error("forward node user uin is invalid");
    const nickname = node.nickname.trim() || String(fromUin);

    const sendCtx: SendContext = {
      ...(groupId !== undefined ? { groupId } : userUid !== undefined ? { userUid } : {}),
      forwardFake: true,
      scene: "forward",
      // The two `UploadedFileMeta` shapes are structurally different — `context.ts`'s
      // is `{fileId, ...unknown}` and `element-builder.ts`'s is
      // `{fileName, fileSize, fileMd5, fileSha1, fileHash}` — and the send side wants
      // the LATTER. The cache stores the former, which carries `fileId` plus whatever
      // the upload wrote. Passing the entry through as the send-side shape is what the
      // reference's single untyped `UploadedFile` object did; here the cast is at one
      // call site with the reason written down, rather than a widening of either
      // interface (which would let a `fileId`-only entry type-check as a media record).
      recallUploadedFile: (fileId: string) =>
        this.#ctx.recallUploadedFile(fileId) as unknown as
          | import("../../element-builder.js").UploadedFileMeta
          | undefined,
      ...(this.#needsMediaUpload(node)
        ? {
            uploadMedia: createMediaUploader({
              // The same structural cast `MessageApi` makes: the media uploader wants
              // the concrete `Bridge` (it reads `sendRawPacket` and the identity), and
              // every `BridgeContext` in this port is one.
              bridge: this.#ctx as unknown as MediaUploadContext["bridge"],
              isGroup: groupId !== undefined,
              targetIdOrUid: groupId !== undefined ? String(groupId) : (userUid ?? ""),
              ...(this.#mediaSessionCache !== undefined ? { sessionCache: this.#mediaSessionCache } : {}),
            }),
          }
        : {}),
    };

    const elems = await buildSendElems(node.elements, sendCtx);
    const now = this.#now();

    // A private forward's file rides `msgContent` as a `FileExtra`, because the c2c
    // richText has no file element the receiver would decode. Group files go through
    // `transElem(24)` inside richText instead (element-builder's `makeGroupFileElem`).
    let msgContent: Uint8Array | undefined;
    if (groupId === undefined) {
      const fileEl = node.elements.find((element) => element.type === "file" && element.fileId);
      if (fileEl !== undefined && fileEl.type === "file") {
        const cached = readCachedFileMeta(this.#ctx.recallUploadedFile(fileEl.fileId ?? ""));
        const fileMd5 = fileEl.md5Hex !== undefined ? hexToBytesLocal(fileEl.md5Hex) : (cached?.fileMd5 ?? new Uint8Array(0));
        const fileSize = fileEl.fileSize ?? cached?.fileSize ?? 0;
        const fileName = fileEl.fileName ?? cached?.fileName ?? "file";
        const fileHash = fileEl.fileHash ?? cached?.fileHash ?? "";
        msgContent = encodeFileExtra(
          encodeNotOnlineFile({
            fileType: 0,
            fileUuid: fileEl.fileId,
            fileMd5,
            fileName,
            fileSize: BigInt(fileSize),
            subcmd: 1,
            dangerEvel: 0,
            // The reference's own constant: now + 10080 minutes (seven days).
            expireTime: now + 10080 * 60,
            fileHash,
          }),
        );
      }
    }

    return encodePushMsgBody({
      responseHead: encodeResponseHead({
        fromUin,
        toUid: await resolveSelfUid(this.#ctx),
        forward: { friendName: nickname },
      }),
      contentHead: encodeContentHead({
        msgType: 9,
        subType: 4,
        msgId: this.#randomInt(2_147_483_647) >>> 0,
        sequence: this.#randomInt(9_000_000) + 1_000_000,
        timestamp: node.time !== undefined && node.time > 0 ? node.time : now,
        c2cCmd: 0,
      }),
      body: encodeMessageBody({
        richText: encodeReceiveRichText(elems.map((elem) => encodeElemForForward(elem))),
        ...(msgContent !== undefined ? { msgContent } : {}),
      }),
    });
  }

  #needsMediaUpload(node: ForwardNodeInput): boolean {
    return node.elements.some((element: Segment) => isMessageMedia(element));
  }

  // -------------------------------------------------------------------------
  // fetch (reference:194703)
  // -------------------------------------------------------------------------

  /**
   * Decode a res_id into nodes, caching every layer the payload carried.
   *
   * A res_id is **scope-scoped**: one issued for a group is not fetchable from a
   * private context, and the server answers with an empty payload rather than an
   * error. That is why `forwardSingleMessage` re-uploads instead of forwarding a
   * res_id it fetched from somewhere else (see `host/forward-send.ts`).
   *
   * `acquire: true` is not optional: without it the server returns the metadata but
   * not the payload, and the only symptom would be "payload is empty".
   */
  async fetch(resId: string): Promise<ForwardNodePayload[]> {
    return (await this.fetchWithLayers(resId)).nodes;
  }

  async fetchWithLayers(resId: string): Promise<ForwardFetchResult> {
    if (typeof resId !== "string" || resId.trim() === "") throw new Error("forward id is missing");

    const cached = this.#cache.get(resId);
    if (cached !== undefined) {
      const nodes = clonePayloadNodes(cached.nodes);
      if (await this.enrichSenders(nodes)) this.#cache.update(cached, clonePayloadNodes(nodes));
      return { nodes, layers: cached.layers };
    }

    const request = encodeRecvLongMsgReq({
      info: { uid: await resolveSelfUid(this.#ctx), resId, acquire: true },
      settings: { field1: 2, field2: 0, field3: 0, field4: 0 },
    });
    const result = await this.#ctx.sendRawPacket(RECV_LONG_MSG_CMD, request);
    if (!result.success || !result.gotResponse || !result.responseData) {
      throw new Error(result.errorMessage || "download forward message failed");
    }
    const decoded = decodeRecvLongMsgResp(result.responseData);
    const payload = decoded?.payload;
    if (!(payload instanceof Uint8Array) || payload.length === 0) {
      throw new Error("download forward message payload is empty");
    }

    let inflate: Uint8Array;
    try {
      inflate = new Uint8Array(
        gunzipSync(Buffer.from(payload), { maxOutputLength: FORWARD_LONG_MSG_MAX_OUTPUT_BYTES }),
      );
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      log.warn(
        "forward long-msg decompression failed: res_id=%s compressed_bytes=%d max_output_bytes=%d error=%s",
        resId,
        payload.byteLength,
        FORWARD_LONG_MSG_MAX_OUTPUT_BYTES,
        reason,
      );
      throw new Error(
        `download forward message decompression failed (res_id=${resId}, compressed_bytes=${payload.byteLength}, ` +
          `max_output_bytes=${FORWARD_LONG_MSG_MAX_OUTPUT_BYTES}): ${reason}`,
        { cause },
      );
    }

    const actions = decodeLongMsgResult(inflate);
    const mainAction = actions.find((action) => action.actionCommand === "MultiMsg");
    const msgBodyList = mainAction?.msgBody ?? [];
    const piggybackByUuid = new Map<string, Uint8Array[]>();
    for (const action of actions) {
      if (!action.actionCommand || action.actionCommand === "MultiMsg") continue;
      piggybackByUuid.set(action.actionCommand, action.msgBody);
    }

    const nodes = this.decodeMsgBodiesToNodes(msgBodyList);
    const layers = this.collectForwardLayers(resId, nodes, piggybackByUuid);
    await this.enrichSenders(nodes);
    if (nodes.length > 0) {
      layers.set(resId, clonePayloadNodes(nodes));
      this.#cache.set(resId, layers);
    }
    log.debug("forward fetched: res_id=%s nodes=%d layers=%d", resId, nodes.length, layers.size);
    return { nodes, layers };
  }

  // -------------------------------------------------------------------------
  // sender-name backfill (reference:194755)
  // -------------------------------------------------------------------------

  /** A node whose display name the server did not give us, but whose uin we know. */
  private needsName(node: ForwardNodePayload): boolean {
    return node.userUin > 0 && (!node.nickname || node.nickname === FORWARD_NAME_PLACEHOLDER);
  }

  /**
   * Best-effort nickname backfill, and it mutates the nodes it is given.
   *
   * Two levels, in the reference's order:
   *
   *   L3  one `fetchGroupMemberList` per group that still has nameless nodes —
   *       `ContactsApi` already caches member lists with inflight-joining, so a
   *       burst of forwards from the same group costs one fetch;
   *   L4  a per-uin profile lookup for the residue (private nodes, and group members
   *       the roster did not know), capped at `FORWARD_PROFILE_MAX` distinct uins
   *       with `FORWARD_PROFILE_CONCURRENCY` in flight.
   *
   * Failures are swallowed on purpose: a forward whose sender cannot be named still
   * renders, with QQ's own `QQ用户` placeholder. Returns whether anything changed, so
   * a caller can decide to persist the enriched copy.
   */
  async enrichSenders(nodes: ForwardNodePayload[]): Promise<boolean> {
    const pending = nodes.filter((node) => this.needsName(node));
    if (pending.length === 0) return false;
    let changed = false;

    const byGroup = new Map<number, ForwardNodePayload[]>();
    const residue: ForwardNodePayload[] = [];
    for (const node of pending) {
      if (node.messageType === "group" && node.groupId !== undefined && node.groupId > 0) {
        const list = byGroup.get(node.groupId) ?? [];
        list.push(node);
        byGroup.set(node.groupId, list);
      } else {
        residue.push(node);
      }
    }

    for (const [groupId, groupNodes] of byGroup) {
      let byUin: Map<number, { nickname: string; card: string }>;
      try {
        const members = await this.#contacts().fetchGroupMemberList(groupId);
        byUin = new Map(members.map((member) => [member.uin, { nickname: member.nickname, card: member.card }]));
      } catch {
        // A roster failure is not a forward failure: fall through to the profile level.
        continue;
      }
      for (const node of groupNodes) {
        const member = byUin.get(node.userUin);
        const name = member?.card || member?.nickname;
        if (name) {
          node.senderCard = member?.card || node.senderCard || "";
          node.nickname = name;
          changed = true;
        } else {
          residue.push(node);
        }
      }
    }

    const uins = [...new Set(residue.filter((node) => this.needsName(node)).map((node) => node.userUin))].slice(
      0,
      FORWARD_PROFILE_MAX,
    );
    if (uins.length > 0) {
      const results = await mapWithConcurrency(uins, FORWARD_PROFILE_CONCURRENCY, async (uin) => {
        try {
          return [uin, (await this.#contacts().fetchUserProfile(uin)).nickname] as const;
        } catch {
          return [uin, ""] as const;
        }
      });
      const nickByUin = new Map(results);
      for (const node of residue) {
        if (!this.needsName(node)) continue;
        const nick = nickByUin.get(node.userUin);
        if (nick) {
          node.nickname = nick;
          changed = true;
        }
      }
    }

    return changed;
  }

  // -------------------------------------------------------------------------
  // decode (reference:194830)
  // -------------------------------------------------------------------------

  /**
   * `PushMsgBody[]` → payloads, through the ORDINARY push pipeline.
   *
   * The reference wraps each body in a `PushMsg` and runs `parseMsgPush`, then picks
   * the first message event. This port does the same two steps without the wrapper:
   * `buildContextFromMessage` is the reference's `buildContext` for an
   * already-decoded body, and `decodePush` is the registry dispatch. Nothing about a
   * forward body is special-cased — which is the point, since a forward node is an
   * ordinary message that was never delivered.
   *
   * A body that decodes to no message event is SKIPPED (not an error): the reference
   * does the same, and a forward with one undecodable node still has to render the
   * rest. `keepDecodedMessage` applies the same survival filter the live path does.
   */
  decodeMsgBodiesToNodes(msgBodyList: readonly Uint8Array[]): ForwardNodePayload[] {
    const out: ForwardNodePayload[] = [];
    const identity = asInboundIdentity(this.#ctx.identity);
    const selfUin = Number.parseInt(this.#ctx.identity.uin, 10) || 0;
    for (const raw of msgBodyList) {
      let body: ReturnType<typeof decodePushMsgBody>;
      try {
        body = decodePushMsgBody(raw);
      } catch (error) {
        log.warn(
          "forward node body rejected (bytes=%d): %s",
          raw.byteLength,
          error instanceof Error ? error.message : String(error),
        );
        continue;
      }
      const ctx = buildContextFromMessage(body as never, selfUin, identity);
      if (!ctx) continue;
      let events: MsgPushEvent[];
      try {
        events = decodePush(ctx);
      } catch (error) {
        log.warn(
          "forward node decoder error (msgType=%d subType=%d): %s",
          ctx.head.msgType,
          ctx.head.subType,
          error instanceof Error ? error.message : String(error),
        );
        continue;
      }
      const event = events.find(
        (item) => item.kind === "friend_message" || item.kind === "group_message" || item.kind === "temp_message",
      );
      if (event === undefined) continue;
      if (!keepDecodedMessage(ctx.head, event.elements, ctx.body, event.kind, ctx.fromUin)) continue;

      if (event.kind === "group_message") {
        out.push({
          userUin: event.senderUin,
          nickname: event.senderCard || event.senderNick,
          elements: event.elements,
          time: event.time,
          msgId: event.msgId,
          msgSeq: event.msgSeq,
          groupId: event.groupId,
          senderCard: event.senderCard,
          messageType: "group",
        });
        continue;
      }
      if (event.kind === "friend_message") {
        out.push({
          userUin: event.senderUin,
          nickname: event.senderNick,
          elements: event.elements,
          time: event.time,
          msgId: event.msgId,
          msgSeq: event.msgSeq,
          messageType: "private",
        });
        continue;
      }
      // temp_message: the reference records it as `private` while keeping the source
      // group id, because the receiver renders it in the private column.
      out.push({
        userUin: event.senderUin,
        nickname: event.senderNick,
        elements: event.elements,
        time: event.time,
        msgSeq: event.msgSeq,
        groupId: event.groupId,
        messageType: "private",
      });
    }
    return out;
  }

  /**
   * Every layer reachable from the piggyback table (reference:194855).
   *
   * NapCat hoists the WHOLE tree's piggybacks onto the outermost action list, so one
   * fetch can resolve several layers. The walk starts from the outer layer and
   * descends through every `forward` element it finds, which is why a single
   * `get_forward_msg` on an outer res_id warms the cache for its inner res_ids too.
   *
   * The `MultiMsg_` prefix strip is the reference's: some senders key the piggyback
   * by `MultiMsg_<uuid>` rather than `<uuid>`.
   */
  collectForwardLayers(
    resId: string,
    nodes: readonly ForwardNodePayload[],
    piggybackByUuid: ReadonlyMap<string, readonly Uint8Array[]>,
  ): Map<string, ForwardNodePayload[]> {
    const layers = new Map<string, ForwardNodePayload[]>([[resId, clonePayloadNodes(nodes)]]);
    const decodedByUuid = new Map<string, ForwardNodePayload[]>();
    for (const chain of layers.values()) {
      for (const node of chain) {
        for (const elem of node.elements) {
          if (elem.type !== "forward") continue;
          const uuid = elem.forwardUuid;
          const innerResId = elem.resId;
          if (!uuid || !innerResId || layers.has(innerResId)) continue;
          const body =
            piggybackByUuid.get(uuid) ??
            (uuid.startsWith("MultiMsg_") ? piggybackByUuid.get(uuid.slice(9)) : undefined);
          if (body === undefined) continue;
          let innerNodes = decodedByUuid.get(uuid);
          if (innerNodes === undefined) {
            innerNodes = this.decodeMsgBodiesToNodes(body);
            decodedByUuid.set(uuid, innerNodes);
          }
          layers.set(innerResId, innerNodes);
        }
      }
    }
    return layers;
  }

  // -------------------------------------------------------------------------
  // Typed accessors for the two cross-API calls
  // -------------------------------------------------------------------------

  /**
   * `ctx.apis.groupFile`, narrowed to the signatures this module actually needs.
   *
   * The hub declares the slot as `GroupFileApiSlice`, whose `getPrivateUrl` takes TWO
   * arguments; the real `GroupFileApi.getPrivateUrl` takes THREE (`fileHash` is
   * required by `0xe37_1200`). `apis/index.ts` documents that mismatch as a defect in
   * `context.ts`'s slice and already widens the hub's own type; this is the same
   * widening at the second consumer, rather than a fourth opinion about the arity.
   */
  #groupFile(): ForwardGroupFileApi {
    const slice = this.#ctx.apis.groupFile;
    if (slice === undefined) {
      throw new Error("forward file handling requires apis.groupFile, which this bridge does not provide");
    }
    return slice as unknown as ForwardGroupFileApi;
  }

  #contacts(): ForwardContactsApi {
    const slice = this.#ctx.apis.contacts;
    if (slice === undefined) {
      throw new Error("forward sender enrichment requires apis.contacts, which this bridge does not provide");
    }
    return slice as unknown as ForwardContactsApi;
  }
}

/** The `groupFile` members `ForwardApi` calls. See {@link ForwardApi} `#groupFile`. */
interface ForwardGroupFileApi {
  getUrl(groupId: number, fileId: string): Promise<string>;
  getPrivateUrl(userId: number, fileId: string, fileHash: string): Promise<string>;
  upload(
    groupId: number,
    source: string,
    name: string,
    folderId: string,
    uploadFile: boolean,
    publishFile: boolean,
  ): Promise<{ fileId: string }>;
  uploadPrivate(
    userId: number,
    source: string,
    name: string,
    uploadFile: boolean,
    publishFile: boolean,
  ): Promise<{ fileId: string; fileHash?: string | null }>;
}

/** The `contacts` members `enrichSenders` calls. */
interface ForwardContactsApi {
  fetchGroupMemberList(groupId: number): Promise<readonly { uin: number; nickname: string; card: string }[]>;
  fetchUserProfile(uin: number): Promise<{ nickname: string }>;
}

function md5BytesOrEmpty(value: unknown): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(0);
}

/**
 * One element → the bytes a `RichText.elems` entry holds.
 *
 * `buildSendElems` returns `Elem` objects rather than bytes, and the long-message body
 * needs the encoded form. `encodeElem` is the one encoder for that (`Elem`'s field
 * numbers are identical on both sides — reference:112327 `__write_Elem` and
 * `__write_Elem$1` agree on every field this module emits), so there is no second
 * definition to drift.
 */
function encodeElemForForward(elem: import("../../element-builder.js").Elem): Uint8Array {
  return encodeElemCached(elem);
}

// Imported lazily-by-value through a named indirection so the module's public surface
// lists `encodeElem` only where it is used. (A plain import would be equivalent; keeping
// the alias makes the single call site greppable.)
import { encodeElem as encodeElemCached } from "../../element-builder.js";
