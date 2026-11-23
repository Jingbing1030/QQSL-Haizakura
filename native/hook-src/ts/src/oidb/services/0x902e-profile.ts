// Profile family: custom faces (0x902e / 0x902f), typing status (0x0cd4) and the
// one-way friend list (0x0e17).
//
// ---------------------------------------------------------------------------
// What is here, and what deliberately is NOT
// ---------------------------------------------------------------------------
//   FetchCustomFaceList    0x902e_1  uinForm   Faceroam.OpReq, op 1   → list
//   FetchCustomFaceDetail  0x902e_1  uinForm   CustomFaceMoveBody, op 2 → per-face desc
//   MoveCustomFace         0x902e_1  uinForm   CustomFaceMoveBody, op 2
//   ModifyCustomFace       0x902e_1  (NO uinForm)  CustomFaceModifyBody, op 3
//   OrderCustomFace        0x902f_1  uinForm   CustomFaceOrderBody
//   SetInputStatus         0x0cd4_1           typing indicator
//   GetUnidirectionalFriendList 0x0e17_0     JSON-in-protobuf
//
// ⚠️ **`AddCustomFace` is NOT an OIDB command, so it is still not an `OidbSpec` —
// but its three codecs ARE now ported here** (see "AddCustomFace" below). It speaks
// `ImgStore.BDHExpressionRoam` with a `google.protobuf.Any` envelope and uploads the
// image over the highway (`httpconn?htcmd=0x6FF0087`) before registering it. There is
// no command/sub-command pair to put in an `OidbSpec`, no `OidbBase` envelope, and
// nothing for `invokeOidb` to do. Forcing it into this interface would produce a spec
// whose `command` field is a lie.
//
// The three codecs exported for it are `encodeBDHExpressionRoamReq`,
// `decodeBDHExpressionRoamResp` and `encodeFavEmojiHighwayHead` — the last one is the
// **fourth** highway `commandId` namespace (9, "PicUp.DataUp" with a
// `FavEmojiHighwayHead` wrapper), distinct from the NTV2 media ids (1001-1008) and the
// file-transfer ids (71/95). The framing/transport half stays in
// `ts/src/highway/` because it is not protobuf-OIDB work at all; the flow that ties
// the three together is `ProfileApi.addCustomFace` in `ts/src/bridge/apis/profile.ts`.
//
// 🔴 **Three more are NOT `OidbSpec`s, for two different reasons:**
//
//   `DeleteCustomFace`, `FetchCustomFaceList` — no command number at all. They speak
//   the `Faceroam.OpReq` service with their own top-level messages
//   (`protobuf_encode_FaceroamOpReq[ $1 ]`) over a bare `sendRawPacket`. The earlier
//   survey printed `cmd=0xNaN` for both, which is the honest answer.
//
//   `GetUnidirectionalFriendList` — it DOES have a command (0x0e17/0) and a wire name,
//   but it **never sends an OIDB envelope**. Its transport is literally
//   `sendRawPacket(wireName(), encode(serialize(...)))` — no `OidbBase`, no body at
//   field 4, no `reserved`. `invokeOidb` always wraps with `makeOidbEnvelope`, so
//   declaring a spec for it would emit an envelope the reference does not and the
//   server does not expect. Verified by probing: the reference request bytes for
//   uin=10001 are exactly `10 00`, i.e. `{2: 0}` — there is not even a `jsonBody`
//   because that probe passed an empty params object.
//
// So this file exports **five `OidbSpec`s** plus the codec and mapping helpers for
// the ones that are not OIDB — including, since this batch, the three `AddCustomFace`
// codecs. Shipping a `command` field that no invocation honours would be the one
// thing worse than an honest gap.
//
// ---------------------------------------------------------------------------
// The `opType` multiplexing trap
// ---------------------------------------------------------------------------
// 0x902e_1 is **one command/sub with four different body schemas**, selected by the
// `opType` field *inside the body* (not by the sub-command):
//
//   opType 1 → `FaceroamOpReq`          (list, no entries)
//   opType 2 → `CustomFaceMoveBody`     (detail AND move — same bytes, different intent)
//   opType 3 → `CustomFaceModifyBody`
//
// Note that `FetchCustomFaceDetail` and `MoveCustomFace` send **byte-identical**
// requests for the same inputs. The server distinguishes them by... nothing in the
// request. They differ only in what the caller does with the reply. That is why they
// share `CustomFaceMoveBody` here rather than getting two near-copies.
//
// ⚠️ `uinForm` is NOT uniform across 0x902e_1: three of the four set it, but
// `ModifyCustomFace` does **not**. Same command, same sub-command, different wire
// variant. Getting this wrong changes the envelope's field 12, not the body, so it
// fails only against a real server.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { OidbError } from "../envelope.js";
import { type OidbSpec } from "../spec.js";

// ---------------------------------------------------------------------------
// Command numbers and shared constants
// ---------------------------------------------------------------------------

export const CUSTOM_FACE_COMMAND = 0x902e;
export const CUSTOM_FACE_DETAIL_SUB_COMMAND = 1;
export const CUSTOM_FACE_ORDER_COMMAND = 0x902f;
export const CUSTOM_FACE_ORDER_SUB_COMMAND = 1;
export const SET_INPUT_STATUS_COMMAND = 0x0cd4;
export const SET_INPUT_STATUS_SUB_COMMAND = 1;
export const UNIDIRECTIONAL_FRIEND_COMMAND = 0x0e17;
export const UNIDIRECTIONAL_FRIEND_SUB_COMMAND = 0;

/** `CLIENT_VERSION = "10.0.26200"` (reference :319331) — a string, sent as `osVersion`. */
export const CUSTOM_FACE_CLIENT_VERSION = "10.0.26200";
/** `BUILD_VERSION_SHORT = "9.9.26"` (reference :326630). */
export const CUSTOM_FACE_BUILD_VERSION = "9.9.26";

/** `CUSTOM_FACE_OP={list:1, detailOrMove:2, modify:3}` — the in-body discriminator. */
export const CUSTOM_FACE_OP = { list: 1, detailOrMove: 2, modify: 3 } as const;

/**
 * `GetUnidirectionalFriendList`'s wire service: `MQUpdateSvc_com_qq_ti.web`, not
 * `OidbSvcTrpcTcp`. Exported because it is still the name a raw-packet caller needs,
 * even though there is no spec to hang it on.
 */
export const UNIDIRECTIONAL_FRIEND_WIRE_NAME = "MQUpdateSvc_com_qq_ti.web.OidbSvc.0xe17_0";

// ---------------------------------------------------------------------------
// Custom face: request bodies
// ---------------------------------------------------------------------------

export const CustomFaceMoveBodyField = {
  field1: 1,
  osVersion: 2,
  opType: 3,
  emojis: 4,
} as const;
export const CustomFaceMoveEntryField = { emojiId: 1, md5: 2 } as const;

export interface CustomFaceEntry {
  emojiId: string;
  md5: string;
}

export interface CustomFaceMoveBody {
  field1: number;
  osVersion: string;
  opType: number;
  emojis: CustomFaceEntry[];
}

export function encodeCustomFaceMoveBody(body: CustomFaceMoveBody): Uint8Array {
  const writer = new ProtoWriter()
    .uint32(CustomFaceMoveBodyField.field1, body.field1)
    .string(CustomFaceMoveBodyField.osVersion, body.osVersion)
    .uint32(CustomFaceMoveBodyField.opType, body.opType);
  for (const emoji of body.emojis) {
    writer.message(
      CustomFaceMoveBodyField.emojis,
      new ProtoWriter()
        .string(CustomFaceMoveEntryField.emojiId, emoji.emojiId)
        .string(CustomFaceMoveEntryField.md5, emoji.md5)
        .finish(),
    );
  }
  return writer.finish();
}

export const CustomFaceModifyBodyField = {
  field1: 1,
  osVersion: 2,
  opType: 3,
  entry: 5,
  field12: 12,
} as const;
export const CustomFaceModifyEntryField = { emoji: 1, desc: 2 } as const;
export const CustomFaceOpEmojiEntryField = { emojiId: 1, md5: 2 } as const;

export interface CustomFaceModifyEntry {
  emoji: { emojiId: string; md5: string };
  desc: string;
}

export interface CustomFaceModifyBody {
  field1: number;
  osVersion: string;
  opType: number;
  entry: CustomFaceModifyEntry;
  field12: number;
}

export function encodeCustomFaceModifyBody(body: CustomFaceModifyBody): Uint8Array {
  return new ProtoWriter()
    .uint32(CustomFaceModifyBodyField.field1, body.field1)
    .string(CustomFaceModifyBodyField.osVersion, body.osVersion)
    .uint32(CustomFaceModifyBodyField.opType, body.opType)
    .message(
      CustomFaceModifyBodyField.entry,
      new ProtoWriter()
        .message(
          CustomFaceModifyEntryField.emoji,
          new ProtoWriter()
            .string(CustomFaceOpEmojiEntryField.emojiId, body.entry.emoji.emojiId)
            .string(CustomFaceOpEmojiEntryField.md5, body.entry.emoji.md5)
            .finish(),
        )
        .string(CustomFaceModifyEntryField.desc, body.entry.desc)
        .finish(),
    )
    .uint32(CustomFaceModifyBodyField.field12, body.field12)
    .finish();
}

export const CustomFaceOrderBodyField = { env: 1, emojiId: 2, position: 3 } as const;
export const CustomFaceOrderEnvField = { field1: 1, osVersion: 2, buildVersion: 3 } as const;

export interface CustomFaceOrderEnv {
  field1: number;
  osVersion: string;
  buildVersion: string;
}

export interface CustomFaceOrderBody {
  env: CustomFaceOrderEnv;
  emojiId: string;
  position: number;
}

export function encodeCustomFaceOrderBody(body: CustomFaceOrderBody): Uint8Array {
  return new ProtoWriter()
    .message(
      CustomFaceOrderBodyField.env,
      new ProtoWriter()
        .uint32(CustomFaceOrderEnvField.field1, body.env.field1)
        .string(CustomFaceOrderEnvField.osVersion, body.env.osVersion)
        .string(CustomFaceOrderEnvField.buildVersion, body.env.buildVersion)
        .finish(),
    )
    .string(CustomFaceOrderBodyField.emojiId, body.emojiId)
    .uint32(CustomFaceOrderBodyField.position, body.position)
    .finish();
}

// ---------------------------------------------------------------------------
// Custom face: response
// ---------------------------------------------------------------------------

export const CustomFaceModifyRespField = {
  retCode: 1,
  errMsg: 2,
  opType: 3,
  entries: 4,
} as const;
export const CustomFaceModifyRespEntryField = {
  emoji: 1,
  legacyDesc: 2,
  desc: 3,
} as const;

export interface CustomFaceRespEntry {
  emoji: { emojiId: string | null; md5: string | null } | null;
  legacyDesc: string | null;
  desc: string | null;
}

export interface CustomFaceModifyResp {
  retCode: number | null;
  errMsg: string | null;
  opType: number | null;
  entries: CustomFaceRespEntry[];
}

export function decodeCustomFaceOpEmojiEntry(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): { emojiId: string | null; md5: string | null } {
  const reader = new ProtoReader(data, offset, end);
  const emoji: { emojiId: string | null; md5: string | null } = { emojiId: null, md5: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(CustomFaceOpEmojiEntryField.emojiId, WireType.lengthDelimited):
        emoji.emojiId = reader.string();
        break;
      case tagOf(CustomFaceOpEmojiEntryField.md5, WireType.lengthDelimited):
        emoji.md5 = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return emoji;
}

export function decodeCustomFaceModifyRespEntry(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): CustomFaceRespEntry {
  const reader = new ProtoReader(data, offset, end);
  const entry: CustomFaceRespEntry = { emoji: null, legacyDesc: null, desc: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(CustomFaceModifyRespEntryField.emoji, WireType.lengthDelimited):
        entry.emoji = reader.message(decodeCustomFaceOpEmojiEntry);
        break;
      case tagOf(CustomFaceModifyRespEntryField.legacyDesc, WireType.lengthDelimited):
        entry.legacyDesc = reader.string();
        break;
      case tagOf(CustomFaceModifyRespEntryField.desc, WireType.lengthDelimited):
        entry.desc = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return entry;
}

export function decodeCustomFaceModifyResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): CustomFaceModifyResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: CustomFaceModifyResp = { retCode: null, errMsg: null, opType: null, entries: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(CustomFaceModifyRespField.retCode, WireType.varint):
        resp.retCode = reader.uint32();
        break;
      case tagOf(CustomFaceModifyRespField.errMsg, WireType.lengthDelimited):
        resp.errMsg = reader.string();
        break;
      case tagOf(CustomFaceModifyRespField.opType, WireType.varint):
        resp.opType = reader.uint32();
        break;
      case tagOf(CustomFaceModifyRespField.entries, WireType.lengthDelimited):
        resp.entries.push(reader.message(decodeCustomFaceModifyRespEntry));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

/**
 * `if (body.retCode && body.retCode !== 0) throw ...`
 *
 * ⚠️ Two-part guard, and the first part matters: `retCode` is `0` for success, so
 * `retCode && ...` is false for 0 AND for `null`. A decoder that leaves `retCode`
 * absent therefore counts as success. Only a non-zero code throws.
 */
function assertCustomFaceRetCode(resp: CustomFaceModifyResp, operation: string): void {
  if (resp.retCode && resp.retCode !== 0) {
    throw new Error(`${operation} error: ${resp.errMsg || resp.retCode}`);
  }
}

/**
 * The result type shared by `MoveCustomFace`, `ModifyCustomFace` and `OrderCustomFace`.
 *
 * ⚠️ **`undefined`, not the decoded body.** All three reference `deserialize`s are
 *
 *     (_ctx, body) => { if (body.retCode && body.retCode !== 0) throw ...; }
 *
 * which is an arrow with a BLOCK body and no `return` — so success yields `undefined`.
 * The bodies *are* decoded (and a non-zero `retCode` *does* throw); only the value is
 * discarded. Third appearance of this quirk in the batch, after the flash family's six
 * commands and `SetInputStatus`. Returning the body instead would look more useful and
 * be wrong.
 */
type CustomFaceAck = undefined;

export interface CustomFaceDescriptor {
  emojiId: string;
  desc: string;
}

/**
 * `FetchCustomFaceDetail` result mapping.
 *
 * ⚠️ Three independent failure modes the reference enforces, all reproduced:
 *   1. an entry with no `emojiId` → `"... response entry N has no emoji id"`
 *   2. a repeated `emojiId`       → `"... has duplicate emoji id: X"`
 *   3. `desc` falls back `entry.desc || entry.legacyDesc || ""` — note `||`, so an
 *      **empty-string `desc`** falls through to `legacyDesc`. `??` would not.
 */
export function toCustomFaceDescriptors(resp: CustomFaceModifyResp): CustomFaceDescriptor[] {
  assertCustomFaceRetCode(resp, "fetch custom face detail");
  const seen = new Set<string>();
  return (resp.entries ?? []).map((entry, index) => {
    const emojiId = entry.emoji?.emojiId;
    if (!emojiId) {
      throw new Error(`fetch custom face detail response entry ${index} has no emoji id`);
    }
    if (seen.has(emojiId)) {
      throw new Error(`fetch custom face detail response has duplicate emoji id: ${emojiId}`);
    }
    seen.add(emojiId);
    return { emojiId, desc: entry.desc || entry.legacyDesc || "" };
  });
}

export interface MoveCustomFaceParams {
  emojis: CustomFaceEntry[];
}

export const MoveCustomFace: OidbSpec<
  MoveCustomFaceParams,
  CustomFaceMoveBody,
  CustomFaceModifyResp,
  CustomFaceAck
> = {
  command: CUSTOM_FACE_COMMAND,
  subCommand: CUSTOM_FACE_DETAIL_SUB_COMMAND,
  uinForm: true,
  serialize: (params) => ({
    field1: 1,
    osVersion: CUSTOM_FACE_CLIENT_VERSION,
    opType: CUSTOM_FACE_OP.detailOrMove,
    emojis: params.emojis.map((emoji) => ({ emojiId: emoji.emojiId, md5: emoji.md5 })),
  }),
  encodeBody: encodeCustomFaceMoveBody,
  decodeBody: decodeCustomFaceModifyResp,
  deserialize: (body) => {
    assertCustomFaceRetCode(body, "move custom face");
  },
};

export interface FetchCustomFaceDetailParams {
  emojis: CustomFaceEntry[];
}

/**
 * Sends the **same bytes** as `MoveCustomFace` (`opType: 2`) and differs only in
 * `deserialize`. Kept as a separate spec because the caller-facing result differs;
 * the encoding is shared on purpose rather than duplicated.
 */
export const FetchCustomFaceDetail: OidbSpec<
  FetchCustomFaceDetailParams,
  CustomFaceMoveBody,
  CustomFaceModifyResp,
  CustomFaceDescriptor[]
> = {
  command: CUSTOM_FACE_COMMAND,
  subCommand: CUSTOM_FACE_DETAIL_SUB_COMMAND,
  uinForm: true,
  serialize: (params) => ({
    field1: 1,
    osVersion: CUSTOM_FACE_CLIENT_VERSION,
    opType: CUSTOM_FACE_OP.detailOrMove,
    emojis: params.emojis.map((emoji) => ({ emojiId: emoji.emojiId, md5: emoji.md5 })),
  }),
  encodeBody: encodeCustomFaceMoveBody,
  decodeBody: decodeCustomFaceModifyResp,
  deserialize: toCustomFaceDescriptors,
};

export interface ModifyCustomFaceParams {
  emojiId: string;
  md5: string;
  desc: string;
}

/** ⚠️ The one 0x902e_1 spec WITHOUT `uinForm`. See the header. */
export const ModifyCustomFace: OidbSpec<
  ModifyCustomFaceParams,
  CustomFaceModifyBody,
  CustomFaceModifyResp,
  CustomFaceAck
> = {
  command: CUSTOM_FACE_COMMAND,
  subCommand: CUSTOM_FACE_DETAIL_SUB_COMMAND,
  serialize: (params) => ({
    field1: 1,
    osVersion: CUSTOM_FACE_CLIENT_VERSION,
    opType: CUSTOM_FACE_OP.modify,
    entry: { emoji: { emojiId: params.emojiId, md5: params.md5 }, desc: params.desc },
    field12: 1,
  }),
  encodeBody: encodeCustomFaceModifyBody,
  decodeBody: decodeCustomFaceModifyResp,
  deserialize: (body) => {
    assertCustomFaceRetCode(body, "modify custom face");
  },
};

export interface OrderCustomFaceParams {
  emojiId: string;
  position: number;
}

export const OrderCustomFace: OidbSpec<
  OrderCustomFaceParams,
  CustomFaceOrderBody,
  CustomFaceModifyResp,
  CustomFaceAck
> = {
  command: CUSTOM_FACE_ORDER_COMMAND,
  subCommand: CUSTOM_FACE_ORDER_SUB_COMMAND,
  uinForm: true,
  serialize: (params) => ({
    // `field1: 1024` is a magic constant, not a caller input — it lands on the wire
    // as `08 80 08`.
    env: { field1: 1024, osVersion: CUSTOM_FACE_CLIENT_VERSION, buildVersion: CUSTOM_FACE_BUILD_VERSION },
    emojiId: params.emojiId,
    position: params.position,
  }),
  encodeBody: encodeCustomFaceOrderBody,
  decodeBody: decodeCustomFaceModifyResp,
  deserialize: (body) => {
    assertCustomFaceRetCode(body, "order custom face");
  },
};

// ---------------------------------------------------------------------------
// SetInputStatus — 0x0cd4_1
// ---------------------------------------------------------------------------

export const Oidb0xcd4ReqField = { reqBody: 1 } as const;
export const Oidb0xcd4ReqBodyField = { uid: 1, chatType: 2, eventType: 3 } as const;

export interface Oidb0xcd4ReqBody {
  uid: string;
  chatType: number;
  eventType: number;
}

export interface Oidb0xcd4Req {
  reqBody: Oidb0xcd4ReqBody;
}

export function encodeOidb0xcd4Req(req: Oidb0xcd4Req): Uint8Array {
  return new ProtoWriter()
    .message(
      Oidb0xcd4ReqField.reqBody,
      new ProtoWriter()
        .string(Oidb0xcd4ReqBodyField.uid, req.reqBody.uid)
        .uint32(Oidb0xcd4ReqBodyField.chatType, req.reqBody.chatType)
        .uint32(Oidb0xcd4ReqBodyField.eventType, req.reqBody.eventType)
        .finish(),
    )
    .finish();
}

export interface Oidb0xcd4Resp {
  readonly __empty?: never;
}

export function decodeOidb0xcd4Resp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): Oidb0xcd4Resp {
  const reader = new ProtoReader(data, offset, end);
  const unknown = new UnknownFieldCollector();
  while (reader.next()) reader.skip(unknown);
  return {};
}

export interface SetInputStatusParams {
  uid: string;
  eventType: number;
}

/**
 * Typing indicator. `chatType` is a hard-coded `0` in the reference's `serialize`.
 *
 * ⚠️ `serialize` is `async` because the real one resolves `p.userId → uid` through
 * `ctx.resolveUserUid`. That resolution belongs to the bridge, not the spec, so this
 * spec takes a ready-made `uid`; the caller-resolves-uid step is the bridge's job.
 *
 * The response decodes to an empty message and `deserialize` is `(_ctx, _) => {}` —
 * an empty BLOCK body, i.e. `undefined`. Same quirk as the flash family.
 */
export const SetInputStatus: OidbSpec<
  SetInputStatusParams,
  Oidb0xcd4Req,
  Oidb0xcd4Resp,
  undefined
> = {
  command: SET_INPUT_STATUS_COMMAND,
  subCommand: SET_INPUT_STATUS_SUB_COMMAND,
  serialize: (params) => ({
    reqBody: { uid: params.uid, chatType: 0, eventType: params.eventType },
  }),
  encodeBody: encodeOidb0xcd4Req,
  decodeBody: decodeOidb0xcd4Resp,
  deserialize: () => undefined,
};

// ---------------------------------------------------------------------------
// AddCustomFace — `ImgStore.BDHExpressionRoam` + a FOURTH highway cmdId space
// ---------------------------------------------------------------------------
//
// Reference: `custom-face/add-custom-face.ts` (reference/index.mjs:317322-319241 for
// the codecs, 319242-319308 for the `invoke` flow). Nothing here is an `OidbSpec`;
// these are codecs plus three constants the bridge API assembles by hand.
//
// The flow, in the order the reference does it (and the order the error messages
// imply — `gotResponse`, then `success`, then the token):
//
//   1. `loadBinarySource(imageSource, "custom-face")` → `imageBytes`
//   2. `md5 = md5(imageBytes)`; `emojiId = ${uin}_0_0_0_${HEX(md5)}_0_0`
//   3. `sendRawPacket("ImgStore.BDHExpressionRoam", reqBytes)` → `inner.token`
//   4. `packHighwayFrame(FavEmojiHighwayHead, imageBytes)` → POST to
//      `/cgi-bin/httpconn?htcmd=0x6FF0087&uin=${uin}`
//   5. return `emojiId`
//
// ---------------------------------------------------------------------------
// ⚠️ `commandId: 9` is a fourth highway namespace
// ---------------------------------------------------------------------------
// Three other `commandId` families already exist in this repo, and 9 belongs to
// none of them:
//
//   * NTV2 media (image/ptt/video, group and private): 1001-1008
//     (`HIGHWAY_CMD_IDS` in `ts/src/highway/pipeline.ts`)
//   * file transfer (group / private): 71 / 95 (`group-file.ts`)
//   * avatar: 90 (`ProfileApi.setAvatar` in the reference, not ported)
//   * **custom face: 9** — this one
//
// Reusing a media id here would put an image where the emoji store never looks, and
// the server would answer `error_code: 0` for a file that is never registered.
//
// ---------------------------------------------------------------------------
// ⚠️ `FavEmojiHighwayHead` is NOT `ReqDataHighwayHead`
// ---------------------------------------------------------------------------
// It is a flatter, differently-numbered head, so `ts/src/highway/head.ts`'s
// `encodeReqDataHighwayHead` cannot be reused. Two field numbers actually collide
// with the standard head, which is the trap:
//
//   FavEmojiHighwayHead                  ReqDataHighwayHead (head.ts)
//     1 baseHead     message               1 msgBaseHead      message
//     2 segHead      message               2 msgSegHead       message
//     3 emojiIdWrap  message               3 bytesReqExtendInfo  bytes
//     4 field4       uint32                4 timestamp        uint64
//     5 field5       bytes                 5 msgLoginSigHead  message
//     8 field8       uint32  <-- = 9
//
//   `FavEmojiHighwayBaseHead`             `DataHighwayHead`
//     1 version   uint32                   1 version   uint32
//     2 uin       STRING                   2 uin       STRING
//     3 command   string                   3 command   string
//     4 seq       uint32                   4 seq       uint32
//     5 retryTimes uint32                  5 retryTimes uint32
//     6 filesize  UINT64  <--             6 appId     uint32   <-- COLLISION
//     7 dataFlag  uint32                   7 dataFlag  uint32
//     8 commandId uint32                   8 commandId uint32
//
//   `FavEmojiHighwaySegHead`              `SegHead`
//     1 serviceId   uint32                 1 serviceId   uint32
//     2 filesize    uint64                 2 filesize    uint64
//     3 dataOffset  uint64                 3 dataOffset  uint64
//     4 dataLength  uint64  <--           4 dataLength  uint32   <-- WIDER HERE
//     6 serviceTicket bytes               6 serviceTicket bytes
//     8 md5         bytes                 8 md5         bytes
//     9 fileMd5     bytes                 9 fileMd5     bytes
//
// So: **no `appId`**, **no `loginSigHead`**, **no `extend`**, and the file size sits
// on field 6 where the standard head carries `appId`. Encoding this with the
// standard head would send `appId: 25` and no size.
//
// Also note `emojiIdWrap` rides INSIDE the head (field 3) rather than being a query
// parameter, and `field8: 9` duplicates the base head's `commandId` at the outer
// level. Both are sent; neither is optional.

/** `BDH_SERVICE` — the `sendRawPacket` service name (reference:319244). */
export const BDH_EXPRESSION_ROAM_SERVICE = "ImgStore.BDHExpressionRoam";

/** The custom face highway `commandId`. See the fourth-namespace note above. */
export const CUSTOM_FACE_HIGHWAY_COMMAND_ID = 9;

/**
 * The highway `command` string. Same value as a media upload (`PicUp.DataUp`), so it
 * carries no information — `commandId` is what distinguishes this transfer.
 */
export const CUSTOM_FACE_HIGHWAY_COMMAND = "PicUp.DataUp";

/**
 * The highway POST path. Identical to the media/files path: the `htcmd` is the
 * generic `0x6FF0087` and everything else is in the head.
 */
export function customFaceHighwayPath(uin: string | number | bigint): string {
  return `/cgi-bin/httpconn?htcmd=0x6FF0087&uin=${uin}`;
}

/** `google.protobuf.Any`-style request inner (`__size_BDHExpressionRoamInner`). */
export const BDHExpressionRoamInnerField = {
  field1: 1,
  uin: 2,
  field3: 3,
  md5: 4,
  filesize: 5,
  field7: 7,
  field8: 8,
  field9: 9,
  ver: 13,
  field16: 16,
} as const;

export interface BDHExpressionRoamInner {
  field1: number;
  uin: bigint;
  field3: number;
  md5: Uint8Array;
  /**
   * ⚠️ A **uint32** here, not a uint64 — `__size_BDHExpressionRoamInner` computes it
   * as `_f4 >>> 0`. The highway `segHead.filesize` (uint64) is the authoritative
   * length; this copy truncates above 4 GiB. The 1 GiB `loadBinarySource` cap means
   * the two agree for every input this port accepts.
   */
  filesize: number;
  field7: number;
  field8: number;
  field9: number;
  ver: string;
  field16: number;
}

/** The tail message, which lives at an unexpected field number — see below. */
export const BDHExpressionRoamTailField = { inner: 1, field2: 2 } as const;
export const BDHExpressionRoamTailInnerField = { field1: 1, field2: 2, field3: 3 } as const;

export interface BDHExpressionRoamTail {
  inner: { field1: number; field2: number; field3: string };
  field2: number;
}

/**
 * ⚠️ The tail is at field **1001**, not at a small number.
 *
 * `__write_BDHExpressionRoamReq` emits `CA 3E` — a two-byte tag — before the tail.
 * `0xCA 0x3E` decodes to `1001 << 3 | 2`, i.e. `8010`. Reading the reference's
 * `size += 2 + _len` as "field 9 or so" and then hunting for the right tag by eye is
 * how this gets mis-numbered; the golden bytes are the only reliable source.
 */
export const BDH_EXPRESSION_ROAM_TAIL_FIELD = 1001;

export const BDHExpressionRoamReqField = {
  field1: 1,
  field2: 2,
  inner: 3,
  field7: 7,
  tail: BDH_EXPRESSION_ROAM_TAIL_FIELD,
} as const;

export interface BDHExpressionRoamReq {
  field1: number;
  field2: number;
  inner: BDHExpressionRoamInner;
  field7: number;
  tail: BDHExpressionRoamTail;
}

function encodeBDHExpressionRoamInner(inner: BDHExpressionRoamInner): Uint8Array {
  const f = BDHExpressionRoamInnerField;
  return new ProtoWriter()
    .uint32(f.field1, inner.field1)
    .uint64(f.uin, inner.uin)
    .uint32(f.field3, inner.field3)
    // `bytes` drops an empty array, matching the reference's `_f3.length > 0` guard.
    .bytes(f.md5, inner.md5)
    .uint32(f.filesize, inner.filesize)
    .uint32(f.field7, inner.field7)
    .uint32(f.field8, inner.field8)
    .uint32(f.field9, inner.field9)
    .string(f.ver, inner.ver)
    .uint32(f.field16, inner.field16)
    .finish();
}

function encodeBDHExpressionRoamTail(tail: BDHExpressionRoamTail): Uint8Array {
  const t = BDHExpressionRoamTailField;
  const i = BDHExpressionRoamTailInnerField;
  return new ProtoWriter()
    .message(
      t.inner,
      new ProtoWriter()
        .uint32(i.field1, tail.inner.field1)
        .uint32(i.field2, tail.inner.field2)
        .string(i.field3, tail.inner.field3)
        .finish(),
    )
    .uint32(t.field2, tail.field2)
    .finish();
}

/**
 * Encode the `BDHExpressionRoam` request body.
 *
 * Field-presence follows the reference's generated encoder, so a caller that passes
 * the reference's own values produces byte-identical output (verified against the
 * reference's encoder — see `test/custom-face-add.test.ts`).
 */
export function encodeBDHExpressionRoamReq(req: BDHExpressionRoamReq): Uint8Array {
  const f = BDHExpressionRoamReqField;
  return new ProtoWriter()
    .uint32(f.field1, req.field1)
    .uint32(f.field2, req.field2)
    .message(f.inner, encodeBDHExpressionRoamInner(req.inner))
    .uint32(f.field7, req.field7)
    .message(f.tail, encodeBDHExpressionRoamTail(req.tail))
    .finish();
}

/** `BDHExpressionRoamResp` — three fields, of which only `inner.token` matters. */
export const BDHExpressionRoamRespField = { field1: 1, field2: 2, inner: 3 } as const;

/** `BDHExpressionRoamRespInner` — `token` is field **8**, and it is required. */
export const BDHExpressionRoamRespInnerField = {
  field1: 1,
  field2: 2,
  field3: 3,
  field4: 4,
  field6: 6,
  field7: 7,
  token: 8,
  field12: 12,
} as const;

export interface BDHExpressionRoamRespInner {
  field1: number | null;
  field2: number | null;
  field3: Uint8Array | null;
  field4: number | null;
  /** Repeated uint32, both packed and non-packed on the wire. */
  field6: number[];
  /** Repeated uint32, both packed and non-packed on the wire. */
  field7: number[];
  /** ⚠️ Field 8. The highway `serviceTicket` comes from here. */
  token: Uint8Array | null;
  field12: number | null;
}

export interface BDHExpressionRoamResp {
  field1: number | null;
  field2: number | null;
  inner: BDHExpressionRoamRespInner | null;
}

/**
 * Read a length-delimited blob as a run of varints.
 *
 * The reference accepts BOTH the packed (tag 50 / 58) and non-packed (tag 48 / 56)
 * forms of `field6`/`field7`, because a server may send either. `ProtoReader` has no
 * packed reader — the repo has never needed to DECODE packed repeated fields before —
 * so the inner run is walked here.
 */
function readPackedVarints(bytes: Uint8Array): number[] {
  const reader = new ProtoReader(bytes);
  const values: number[] = [];
  while (!reader.done) values.push(reader.uint32());
  return values;
}

export function decodeBDHExpressionRoamRespInner(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): BDHExpressionRoamRespInner {
  const f = BDHExpressionRoamRespInnerField;
  const reader = new ProtoReader(data, offset, end);
  const resp: BDHExpressionRoamRespInner = {
    field1: null,
    field2: null,
    field3: null,
    field4: null,
    field6: [],
    field7: [],
    token: null,
    field12: null,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(f.field1, WireType.varint):
        resp.field1 = reader.uint32();
        break;
      case tagOf(f.field2, WireType.varint):
        resp.field2 = reader.uint32();
        break;
      case tagOf(f.field3, WireType.lengthDelimited):
        resp.field3 = reader.bytes();
        break;
      case tagOf(f.field4, WireType.varint):
        resp.field4 = reader.uint32();
        break;
      // Non-packed, then packed. Both tags must be handled: a decoder that only
      // accepts one silently reports an empty list for the other.
      case tagOf(f.field6, WireType.varint):
        resp.field6.push(reader.uint32());
        break;
      case tagOf(f.field6, WireType.lengthDelimited):
        resp.field6.push(...readPackedVarints(reader.bytes()));
        break;
      case tagOf(f.field7, WireType.varint):
        resp.field7.push(reader.uint32());
        break;
      case tagOf(f.field7, WireType.lengthDelimited):
        resp.field7.push(...readPackedVarints(reader.bytes()));
        break;
      case tagOf(f.token, WireType.lengthDelimited):
        resp.token = reader.bytes();
        break;
      case tagOf(f.field12, WireType.varint):
        resp.field12 = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

export function decodeBDHExpressionRoamResp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): BDHExpressionRoamResp {
  const f = BDHExpressionRoamRespField;
  const reader = new ProtoReader(data, offset, end);
  const resp: BDHExpressionRoamResp = { field1: null, field2: null, inner: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(f.field1, WireType.varint):
        resp.field1 = reader.uint32();
        break;
      case tagOf(f.field2, WireType.varint):
        resp.field2 = reader.uint32();
        break;
      case tagOf(f.inner, WireType.lengthDelimited):
        resp.inner = reader.message(decodeBDHExpressionRoamRespInner);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

// --- the highway head -------------------------------------------------------

/** `FavEmojiHighwayHead` outer fields. */
export const FavEmojiHighwayHeadField = {
  baseHead: 1,
  segHead: 2,
  emojiIdWrap: 3,
  field4: 4,
  field5: 5,
  field8: 8,
} as const;

/** `FavEmojiHighwayBaseHead` — field 6 is `filesize`, NOT `appId`. */
export const FavEmojiHighwayBaseHeadField = {
  version: 1,
  uin: 2,
  command: 3,
  seq: 4,
  retryTimes: 5,
  filesize: 6,
  dataFlag: 7,
  commandId: 8,
} as const;

/** `FavEmojiHighwaySegHead` — field 4 is a **uint64** (wider than `SegHead`'s). */
export const FavEmojiHighwaySegHeadField = {
  serviceId: 1,
  filesize: 2,
  dataOffset: 3,
  dataLength: 4,
  serviceTicket: 6,
  md5: 8,
  fileMd5: 9,
} as const;

export const FavEmojiIdWrapField = { emojiId: 1 } as const;

export interface FavEmojiHighwayBaseHead {
  version: number;
  /** Decimal uin as a STRING, exactly like the standard highway base head. */
  uin: string;
  command: string;
  seq: number;
  retryTimes: number;
  /** ⚠️ uint64 on the wire, and at field **6** — where the standard head has `appId`. */
  filesize: bigint;
  dataFlag: number;
  commandId: number;
}

export interface FavEmojiHighwaySegHead {
  serviceId: number;
  filesize: bigint;
  /**
   * Always `0n` for a single-shot upload, so the reference's presence guard
   * (`!== 0n`) DROPS this field. Pass `0n`; a non-zero value is emitted.
   */
  dataOffset: bigint;
  /** uint64 here (`== filesize` for a whole-image upload), unlike `SegHead`'s uint32. */
  dataLength: bigint;
  /** The `inner.token` from `BDHExpressionRoam`. */
  serviceTicket: Uint8Array;
  /** Whole-image md5. */
  md5: Uint8Array;
  /** Whole-image md5 again — the server reads this one for the file-level check. */
  fileMd5: Uint8Array;
}

export interface FavEmojiHighwayHead {
  baseHead: FavEmojiHighwayBaseHead;
  segHead: FavEmojiHighwaySegHead;
  /** The `emojiId` this upload registers. Inside the head, not a query parameter. */
  emojiIdWrap: { emojiId: string };
  /** Emitted only when non-zero; the reference sends 0, i.e. drops it. */
  field4: number;
  /** Unused by `AddCustomFace`; present because the reference's encoder emits it. */
  field5?: Uint8Array | undefined;
  /** The commandId again, at the outer level. `AddCustomFace` sends 9. */
  field8: number;
}

/**
 * Encode `FavEmojiHighwayHead` for `packHighwayFrame`.
 *
 * Returns raw protobuf bytes; `ts/src/highway/frame.ts`'s `packHighwayFrame` adds the
 * `(`/`)` framing and the two big-endian lengths.
 */
export function encodeFavEmojiHighwayHead(head: FavEmojiHighwayHead): Uint8Array {
  const f = FavEmojiHighwayHeadField;
  const b = FavEmojiHighwayBaseHeadField;
  const s = FavEmojiHighwaySegHeadField;
  const baseHead = new ProtoWriter()
    .uint32(b.version, head.baseHead.version)
    .string(b.uin, head.baseHead.uin)
    .string(b.command, head.baseHead.command)
    .uint32(b.seq, head.baseHead.seq)
    .uint32(b.retryTimes, head.baseHead.retryTimes)
    .uint64(b.filesize, head.baseHead.filesize)
    .uint32(b.dataFlag, head.baseHead.dataFlag)
    .uint32(b.commandId, head.baseHead.commandId)
    .finish();
  const segHead = new ProtoWriter()
    .uint32(s.serviceId, head.segHead.serviceId)
    .uint64(s.filesize, head.segHead.filesize)
    .uint64(s.dataOffset, head.segHead.dataOffset)
    .uint64(s.dataLength, head.segHead.dataLength)
    .bytes(s.serviceTicket, head.segHead.serviceTicket)
    .bytes(s.md5, head.segHead.md5)
    .bytes(s.fileMd5, head.segHead.fileMd5)
    .finish();
  const emojiIdWrap = new ProtoWriter()
    .string(FavEmojiIdWrapField.emojiId, head.emojiIdWrap.emojiId)
    .finish();
  return new ProtoWriter()
    .message(f.baseHead, baseHead)
    .message(f.segHead, segHead)
    .message(f.emojiIdWrap, emojiIdWrap)
    .uint32(f.field4, head.field4)
    .bytes(f.field5, head.field5)
    .uint32(f.field8, head.field8)
    .finish();
}

/**
 * Build the `emojiId` for a new custom face: `${uin}_0_0_0_${MD5}_0_0`.
 *
 * ⚠️ The MD5 segment is **UPPERCASE** hex. `md5FromEmojiId` above already uppercases
 * on the way out, so the two halves agree — but a lowercase id here would produce a
 * face that `resolveCustomFace` cannot match back, since the server's list is
 * uppercase.
 */
export function makeCustomFaceEmojiId(uin: string | number | bigint, md5: Uint8Array): string {
  let hex = "";
  for (const byte of md5) hex += byte.toString(16).padStart(2, "0");
  return `${uin}_0_0_0_${hex.toUpperCase()}_0_0`;
}

/**
 * The reference's two-step request body for a given uin/md5/size.
 *
 * Kept here (rather than in the bridge API) so the exact `field1: 3, field2: 1,
 * field7: 9` + tail incantation is in one place and testable without a bridge.
 */
export function buildBDHExpressionRoamReq(params: {
  uin: string | number | bigint;
  md5: Uint8Array;
  filesize: number;
}): BDHExpressionRoamReq {
  return {
    field1: 3,
    field2: 1,
    inner: {
      field1: 0,
      uin: BigInt(params.uin),
      field3: 0,
      md5: params.md5,
      filesize: params.filesize,
      field7: 2,
      field8: 0,
      field9: 1,
      ver: "1.0.0",
      field16: 1,
    },
    field7: 9,
    tail: { inner: { field1: 0, field2: 0, field3: "0" }, field2: 1 },
  };
}

/** The reference's `FavEmojiHighwayHead` for a whole-image, single-shot upload. */
export function buildFavEmojiHighwayHead(params: {
  uin: string | number | bigint;
  emojiId: string;
  md5: Uint8Array;
  filesize: number;
  serviceTicket: Uint8Array;
}): FavEmojiHighwayHead {
  return {
    baseHead: {
      version: 1,
      uin: String(params.uin),
      command: CUSTOM_FACE_HIGHWAY_COMMAND,
      seq: 1,
      retryTimes: 0,
      filesize: BigInt(params.filesize),
      dataFlag: 16,
      commandId: CUSTOM_FACE_HIGHWAY_COMMAND_ID,
    },
    segHead: {
      serviceId: 0,
      filesize: BigInt(params.filesize),
      dataOffset: 0n,
      dataLength: BigInt(params.filesize),
      serviceTicket: params.serviceTicket,
      md5: params.md5,
      fileMd5: params.md5,
    },
    emojiIdWrap: { emojiId: params.emojiId },
    field4: 0,
    field8: CUSTOM_FACE_HIGHWAY_COMMAND_ID,
  };
}

// ---------------------------------------------------------------------------
// GetUnidirectionalFriendList — 0x0e17_0 (JSON inside protobuf)
// ---------------------------------------------------------------------------

export const Oidb0xe17ReqField = { subCommand: 2, jsonBody: 3 } as const;
export const Oidb0xe17RespField = { errorCode: 3, jsonBody: 4, errorMessage: 5 } as const;

export interface Oidb0xe17Req {
  subCommand: number;
  jsonBody: string;
}

export function encodeOidb0xe17Req(req: Oidb0xe17Req): Uint8Array {
  return new ProtoWriter()
    .uint32(Oidb0xe17ReqField.subCommand, req.subCommand)
    .string(Oidb0xe17ReqField.jsonBody, req.jsonBody)
    .finish();
}

export interface Oidb0xe17Resp {
  errorCode: number | null;
  jsonBody: string | null;
  errorMessage: string | null;
}

export function decodeOidb0xe17Resp(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): Oidb0xe17Resp {
  const reader = new ProtoReader(data, offset, end);
  const resp: Oidb0xe17Resp = { errorCode: null, jsonBody: null, errorMessage: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Oidb0xe17RespField.errorCode, WireType.varint):
        resp.errorCode = reader.uint32();
        break;
      case tagOf(Oidb0xe17RespField.jsonBody, WireType.lengthDelimited):
        resp.jsonBody = reader.string();
        break;
      case tagOf(Oidb0xe17FieldErrorMessage(), WireType.lengthDelimited):
        resp.errorMessage = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

function Oidb0xe17FieldErrorMessage(): number {
  return tagOf(Oidb0xe17RespField.errorMessage, WireType.lengthDelimited);
}

export interface UnidirectionalFriendRequest {
  uint64_uin: string;
  uint64_top: number;
  uint32_req_num: number;
  bytes_cookies: string;
}

export interface GetUnidirectionalFriendListParams {
  /** The requesting account's UIN, as a decimal string. */
  uin: string | number | bigint;
}

/**
 * ⚠️ **The request is a JSON document smuggled through protobuf fields 2 and 3**, not
 * a normal OIDB body. `subCommand` is duplicated: once in the envelope (from
 * `subCommand: 0`) and once as body field 2. The `jsonBody` at field 3 carries a
 * JSON object whose keys are proto-ish snake_case (`uint64_uin`, `uint32_req_num`,
 * `bytes_cookies` — where `bytes_cookies` is a *string*, not bytes).
 *
 * The numbers are strings on purpose: UINs exceed 2^53 as often as not.
 */
export function buildUnidirectionalFriendRequest(uin: string | number | bigint): Oidb0xe17Req {
  const request: UnidirectionalFriendRequest = {
    uint64_uin: String(uin),
    uint64_top: 0,
    uint32_req_num: 99,
    bytes_cookies: "",
  };
  return { subCommand: UNIDIRECTIONAL_FRIEND_SUB_COMMAND, jsonBody: JSON.stringify(request) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface UnidirectionalFriendBlock {
  [key: string]: unknown;
}

/**
 * `deserialize` for the one-way friend list.
 *
 * ⚠️ The reference's arrow function here is written with a **block body** and
 * explicit `return`s, so it genuinely returns the parsed list (unlike the empty
 * `=> {}` specs elsewhere). Four distinct failures:
 *   - `body.errorCode` truthy → `OidbError(...)` (the envelope's code already passed)
 *   - missing `jsonBody`      → `"get unidirectional friend list empty"`
 *   - bad JSON / not object   → `"… invalid response"`
 *   - `ActionStatus !== "OK"` → `"… failed: <code> <message>"` (code is `"missing"`
 *     when `ErrorCode` is not a number)
 * and a fifth on the block list shape: `"… invalid block list"`.
 */
export function toUnidirectionalFriends(resp: Oidb0xe17Resp): UnidirectionalFriendBlock[] {
  if (resp.errorCode) {
    throw new OidbError(
      resp.errorCode,
      resp.errorMessage ?? "",
      UNIDIRECTIONAL_FRIEND_COMMAND,
      UNIDIRECTIONAL_FRIEND_SUB_COMMAND,
    );
  }
  if (!resp.jsonBody) throw new Error("get unidirectional friend list empty");
  let parsed: unknown;
  try {
    parsed = JSON.parse(resp.jsonBody);
  } catch {
    throw new Error("get unidirectional friend list invalid response");
  }
  if (!isObject(parsed)) throw new Error("get unidirectional friend list invalid response");
  if (parsed.ActionStatus !== "OK" || parsed.ErrorCode !== 0) {
    const code = typeof parsed.ErrorCode === "number" ? parsed.ErrorCode : "missing";
    const message = typeof parsed.ErrorInfo === "string" ? parsed.ErrorInfo : "";
    throw new Error(`get unidirectional friend list failed: ${code} ${message}`.trim());
  }
  const blocks = parsed.rpt_block_list;
  if (!Array.isArray(blocks) || !blocks.every(isObject)) {
    throw new Error("get unidirectional friend list invalid block list");
  }
  return blocks as UnidirectionalFriendBlock[];
}

/**
 * NOT an `OidbSpec` — see the header. Everything a raw-packet caller needs lives in
 * `UNIDIRECTIONAL_FRIEND_WIRE_NAME` + `buildUnidirectionalFriendRequest` +
 * `encodeOidb0xe17Req` + `decodeOidb0xe17Resp` + `toUnidirectionalFriends`.
 */
export const UNIDIRECTIONAL_FRIEND_VIA_RAW_PACKET = true as const;