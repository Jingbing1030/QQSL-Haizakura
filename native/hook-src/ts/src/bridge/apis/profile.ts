// `ProfileApi` — account-level reads and self-profile writes.
//
// ---------------------------------------------------------------------------
// Scope: what this batch actually asked for
// ---------------------------------------------------------------------------
// The task lists `profile` as *"`get_login_info`, `get_status` and similar
// account-level reads"*. The important finding is that **neither `get_login_info`
// nor `get_status` is a method on the reference's `ProfileApi`** — they are
// computed by the action layer from the bridge itself:
//
//   get_login_info  -> `parseInt(identity.uin, 10)` + `identity.nickname`
//                      (reference/index.mjs:39321 `getLoginInfo`)
//   get_status      -> `isOnline()` / `bridge.receiveHealthy` / `getUptimeMs()`
//                      (reference/index.mjs:7556)
//
// Neither sends a packet. Both are already implemented in
// `ts/src/onebot/actions/info.ts` against `ActionContext`. So porting them here
// would be a second, divergent copy of two pure functions — this slice does not do
// that, and `buildApiHub` does not pretend the slice exists for them.
//
// What IS here is the reference's real `ProfileApi` (reference/index.mjs:332559-
// 333544), minus the parts that cannot work in this port. See the bottom of this
// header.
//
// ---------------------------------------------------------------------------
// The four non-OIDB packets
// ---------------------------------------------------------------------------
// `setOnlineStatus` / `setDiyOnlineStatus` speak
// `trpc.qq_new_tech.status_svc.StatusService.SetStatus`, `fetchCustomFace*` /
// `deleteCustomFace` speak `Faceroam.OpReq`. Neither is an OIDB command, so neither
// can be an `OidbSpec`; the codecs live in `service-codecs.ts` and are pinned there
// against goldens extracted from the reference's own generated encoders.
//
// `dispatchSetStatus` has one subtlety worth naming: an EMPTY response body is a
// SUCCESS, and only a body whose `errMsg` is neither `""` nor the literal
// `"set status success"` fails. So it cannot "require a response".
//
// ---------------------------------------------------------------------------
// What is deliberately absent, and why
// ---------------------------------------------------------------------------
// `setGroupAvatar` — still absent. It uploads over the highway with a hand-encoded
// `GroupAvatarExtra` (type=101, field3.field1=1, field5=3, field6=1) that has no encoder
// here. OMITTED rather than stubbed: a `setGroupAvatar` that resolves without uploading
// anything would report success for an avatar that never changed.
//
// (`setAvatar` IS implemented below — `commandId: 90`, one `uploadHighway` call with an
// empty `extend`; the highway uploader exists.)
//
// `addCustomFace` — PORTED. `ImgStore.BDHExpressionRoam` (a bare `sendRawPacket`, not an
// OIDB envelope) yields a token, then ONE `FavEmojiHighwayHead` frame goes up with
// `commandId: 9`. The three codecs are in `0x902e-profile.ts`; the flow is below.
// `setGroupAvatar` is the only avatar path still absent (it needs `GroupAvatarExtra`).
//
// `getUnidirectionalFriendList` — speaks a bare
// `MQUpdateSvc_com_qq_ti.web.OidbSvc.0xe17_0` packet whose body is JSON inside a
// protobuf wrapper. `0x902e-profile.ts` documents it as a codec-only export with no
// `OidbSpec`, and no action in this port calls it.
//
// `fetchCustomFaceDetails`, `fetchCustomFace`, `moveCustomFaceToFront`,
// `modifyCustomFace`, `orderCustomFace` — reachable in the reference, but no action
// in this port calls any of them; their specs (`FetchCustomFaceDetail`,
// `MoveCustomFace`, `ModifyCustomFace`, `OrderCustomFace`) are already ported, so a
// future action can wire them in one line each.

import { createLogger } from "../../onebot/log.js";
import { ProtoWriter } from "../../oidb/wire.js";
import type { BridgeContext } from "../context.js";
import { oidbCaller } from "../oidb-invoke.js";
import {
  DIY_STATUS,
  FACEROAM_SERVICE,
  SET_STATUS_CMD,
  checkSetStatusResponse,
  decodeFaceroamOpResp,
  decodeSetStatusResp,
  encodeFaceroamOpReq,
  encodeSetStatusReq,
  makeInner,
  type FaceroamOpResp,
  type SetStatusReq,
  type SetStatusResp,
} from "./service-codecs.js";
import { requirePacketResponse } from "./history-fetch.js";
import { FileChunkSource, uploadHighway } from "../../highway/upload.js";
import {
  HighwaySessionCache,
  fetchHighwaySession,
  type HighwaySession,
} from "../../highway/session.js";
import { hashFileStreaming, stageSourceToDisk } from "../web/stage-source.js";
import { loadBinarySource } from "../web/binary-source.js";
import { createHash } from "node:crypto";
import { packHighwayFrame } from "../../highway/frame.js";
import { connectHighway, httpPostFrameWithStatus } from "../../highway/transport.js";
import {
  // 0x902e_2 — sticker details and description edits
  FetchCustomFaceDetail,
  ModifyCustomFace,
  OrderCustomFace,
  // 0x0e17_0 — a BARE packet, not an OIDB envelope; see getUnidirectionalFriendList
  UNIDIRECTIONAL_FRIEND_WIRE_NAME,
  buildUnidirectionalFriendRequest,
  decodeOidb0xe17Resp,
  encodeOidb0xe17Req,
  toUnidirectionalFriends,
  type UnidirectionalFriendBlock,
  // ImgStore.BDHExpressionRoam — NOT an OIDB command; see addCustomFace
  BDH_EXPRESSION_ROAM_SERVICE,
  buildBDHExpressionRoamReq,
  buildFavEmojiHighwayHead,
  customFaceHighwayPath,
  decodeBDHExpressionRoamResp,
  encodeBDHExpressionRoamReq,
  encodeFavEmojiHighwayHead,
  makeCustomFaceEmojiId,
  // 0x112a_0
  SetProfile,
  SetSelfLongNick,
  // 0x0cd4_1
  SetInputStatus,
  // 0x7e5_12 / 0x7e5_13 / 0x7e5_104
  GetLike,
  SendLike,
  getLikeParams,
  sendLikeParams,
  type ProfileLikeInfo,
} from "../../oidb/services/index.js";

const log = createLogger("Bridge.Profile");

/** `FACEROAM_OP.list` — the in-body selector for a sticker-list request. */
const FACEROAM_LIST_OP = 1;
/** `FACEROAM_OP.delete` (:322220 `DeleteCustomFace.serialize`). */
const FACEROAM_DELETE_OP = 2;

/**
 * highway cmdId for the account avatar — a FIFTH namespace, not one of the media ids.
 *
 * `reference/index.mjs:333404` sends literal `90`. It is nowhere near NTV2 media
 * (1001-1008), file transfer (71/95) or the custom-face upload (9); the number is just what
 * the avatar route uses.
 */
const AVATAR_HIGHWAY_CMD_ID = 90;

/**
 * Highway `cmdId` for a GROUP avatar — a different namespace entry from the personal one.
 *
 * 90 is the account avatar; 3000 is the group avatar, and the only route in this file that
 * carries an `extend` blob (`GroupAvatarExtra`). Using 90 here would upload a personal avatar
 * under a group request: the transfer succeeds and the group picture simply does not change.
 */
const GROUP_AVATAR_HIGHWAY_CMD_ID = 3000;

/** Group-avatar uploads are capped like personal ones; 10 MiB is the reference's limit. */
const GROUP_AVATAR_MAX_BYTES = 10 * 1024 * 1024;

/**
 * `GroupAvatarExtra` — the `extend` payload the group-avatar route requires.
 *
 * Hand-encoded because this message is NOT an `OidbSpec` and has no home among the service
 * codecs. Field numbers verified against the reference's own writer (reference:333128-333230):
 *
 *   type     f1 varint   always 101 on this route
 *   groupUin f2 varint   the target group
 *   field3   f3 message  a one-field submessage `{ field1: 1 }` — present but constant
 *   field5   f5 varint   always 3
 *   field6   f6 varint   always 1
 *
 * The three constants are the reference's, not derived from anything: a `type` other than
 * 101 makes the server treat the upload as a different asset class.
 */
export function encodeGroupAvatarExtra(groupUin: number): Uint8Array {
  return new ProtoWriter()
    .uint32(1, 101)
    .uint32(2, groupUin)
    .message(3, new ProtoWriter().uint32(1, 1).finish())
    .uint32(5, 3)
    .uint32(6, 1)
    .finish();
}

/**
 * Cap on an avatar upload. The reference does not state one; 10 MiB is chosen because an
 * avatar the client will downscale to a few KB has no legitimate reason to be larger, and
 * staging a multi-gigabyte file for this would exhaust the disk before any request.
 */
const AVATAR_MAX_BYTES = 10 * 1024 * 1024;

const setProfileCall = oidbCaller(SetProfile);
const setSelfLongNickCall = oidbCaller(SetSelfLongNick);
const fetchCustomFaceDetailCall = oidbCaller(FetchCustomFaceDetail);
const modifyCustomFaceCall = oidbCaller(ModifyCustomFace);
const orderCustomFaceCall = oidbCaller(OrderCustomFace);
const setInputStatusCall = oidbCaller(SetInputStatus);
const getLikeCall = oidbCaller(GetLike);
const sendLikeCall = oidbCaller(SendLike);

/**
 * Extract the content MD5 out of a custom-face (收藏表情) id.
 *
 * Reference `md5FromEmojiId` (:333539). The id is underscore-separated and field 4
 * is the MD5; anything else throws, because a face id that cannot yield an MD5
 * cannot be referenced in a message.
 */
export function md5FromEmojiId(emojiId: string): string {
  const md5 = emojiId.split("_")[4];
  if (!md5 || md5.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(md5)) {
    throw new Error(`invalid emoji_id (cannot extract md5): ${emojiId}`);
  }
  return md5.toUpperCase();
}

/**
 * The saved-sticker URL.
 *
 * `p.qpic.cn` + the account's uin + the emoji id + `/0`. Note the uin here is the
 * identity's STRING form, not parsed — the path segment is the raw uin.
 */
export function customFaceUrl(uin: string, emojiId: string): string {
  return `https://p.qpic.cn/qq_expression/${uin}/${emojiId}/0`;
}

/**
 * The account/profile API.
 *
 * Reference `var ProfileApi = class` at reference/index.mjs:333343.
 */
export class ProfileApi {
  readonly #ctx: BridgeContext;

  constructor(ctx: BridgeContext) {
    this.#ctx = ctx;
  }

  // -------------------------------------------------------------------------
  // Online status
  // -------------------------------------------------------------------------

  /**
   * `set_online_status`.
   *
   * Defaults are the reference's: `extStatus = 0`, `batteryStatus = 100`. The
   * battery default is not cosmetic — `encodeSetStatusReq` DROPS a zero
   * `batteryStatus`, so defaulting to 0 would send a structurally different
   * message than the reference for every plain status change.
   */
  async setOnlineStatus(status: number, extStatus = 0, batteryStatus = 100): Promise<void> {
    await this.#dispatchSetStatus({ status, extStatus, batteryStatus });
  }

  /**
   * `set_diy_online_status` — a custom status string plus a face.
   *
   * `status: 10, extStatus: 2000, batteryStatus: 0` are FIXED: they are the values
   * QQ uses to mean "I have a custom status", and the battery is deliberately 0 so
   * the field is omitted from the wire. They are not parameters.
   */
  async setDiyOnlineStatus(faceId: number, wording: string, faceType: number): Promise<void> {
    await this.#dispatchSetStatus({
      status: DIY_STATUS.status,
      extStatus: DIY_STATUS.extStatus,
      batteryStatus: 0,
      customExt: { faceId, text: wording, faceType },
    });
  }

  /**
   * Send a `SetStatus` request and interpret the acknowledgement.
   *
   * Three distinct failure shapes, all reproduced:
   *   * transport failure -> the transport's own message, or a generic fallback;
   *   * a body that will not decode -> the fallback message, NOT a decode error
   *     (the reference guards `if (!resp)` and treats it as transport failure);
   *   * a decoded body whose message is neither `""` nor `"set status success"` ->
   *     that message, verbatim, as the error text.
   *
   * An EMPTY body succeeds: `sendRawPacket` may answer with no payload and the
   * reference does not require one.
   */
  async #dispatchSetStatus(value: {
    status: number;
    extStatus: number;
    batteryStatus: number;
    customExt?: { faceId: number; text: string; faceType: number } | undefined;
  }): Promise<void> {
    const params: {
      status: number;
      extStatus: number;
      batteryStatus: number;
      customExt?: { faceId: number; text: string; faceType: number } | undefined;
    } = { status: value.status, extStatus: value.extStatus, batteryStatus: value.batteryStatus };
    if (value.customExt !== undefined) params.customExt = value.customExt;
    const result = await this.#ctx.sendRawPacket(SET_STATUS_CMD, encodeSetStatusReq(params));
    if (!result.success) throw new Error(result.errorMessage || "set online status failed (network/timeout)");
    if (result.responseData && result.responseData.length > 0) {
      const resp: SetStatusResp = decodeSetStatusResp(result.responseData);
      checkSetStatusResponse(resp);
    }
  }

  /**
   * `dispatchSetStatus` — the raw status write, without the battery/custom-ext defaults
   * `setOnlineStatus` layers on top.
   *
   * Kept separate because the two have different contracts: `setOnlineStatus` fills in
   * defaults and is what the actions use, while this one sends exactly the value it is
   * given. The response check is shared (`checkSetStatusResponse`) so the two cannot drift
   * on what counts as a failure.
   */
  async dispatchSetStatus(value: SetStatusReq): Promise<void> {
    const result = await this.#ctx.sendRawPacket(SET_STATUS_CMD, encodeSetStatusReq(value));
    if (!result.success) {
      throw new Error(result.errorMessage || "set online status failed (network/timeout)");
    }
    if (result.responseData && result.responseData.length > 0) {
      const resp: SetStatusResp = decodeSetStatusResp(result.responseData);
      checkSetStatusResponse(resp);
    }
  }

  /**
   * `customFaceUrl` — the public URL of one saved sticker.
   *
   * Pure string assembly with no request behind it, which is why it is synchronous in the
   * reference too. The `/0` suffix is not a variant selector: it is the only form the CDN
   * serves for this route.
   */
  customFaceUrl(emojiId: string): string {
    return `https://p.qpic.cn/qq_expression/${this.#ctx.identity.uin}/${emojiId}/0`;
  }

  // -------------------------------------------------------------------------
  // Self profile
  // -------------------------------------------------------------------------

  /**
   * `set_qq_profile`.
   *
   * The three fields are `0x112a_0`'s string/number profile items; the spec's
   * `serialize` builds the item lists and `hasProfileChanges` is the action's own
   * guard (this method does NOT re-check it — an all-absent call writes an empty
   * profile, which is what the reference does too).
   */
  setProfile(nickname?: string | undefined, personalNote?: string | undefined, sex?: number | undefined): Promise<void> {
    const params: { selfUin: number; nickname?: string | undefined; personalNote?: string | undefined; sex?: number | undefined } = {
      selfUin: Number(this.#ctx.identity.uin),
    };
    if (nickname !== undefined) params.nickname = nickname;
    if (personalNote !== undefined) params.personalNote = personalNote;
    if (sex !== undefined) params.sex = sex;
    return setProfileCall.invoke(this.#ctx, params);
  }

  /** `set_self_longnick` — the signature line, `0x112a_0`'s int-profile tag. */
  setSelfLongNick(longNick: string): Promise<void> {
    return setSelfLongNickCall.invoke(this.#ctx, { selfUin: Number(this.#ctx.identity.uin), longNick });
  }

  /**
   * `set_input_status` — the "typing…" indicator, `0x0cd4_1`.
   *
   * Takes a uid, not a uin, so the caller's `userId` is resolved first.
   */
  async setInputStatus(userId: number, eventType: number): Promise<void> {
    const uid = await this.#ctx.resolveUserUid(userId);
    if (!uid) throw new Error(`failed to resolve uid for ${String(userId)}`);
    await setInputStatusCall.invoke(this.#ctx, { uid, eventType });
  }

  // -------------------------------------------------------------------------
  // Likes
  // -------------------------------------------------------------------------

  /**
   * `send_like` — `0x7e5_104`.
   *
   * `count` is passed through with no default here; the action layer defaults
   * `times` to 1. `sendLikeParams` does the uid resolution and rejects an empty uid.
   */
  async sendLike(userId: number, count?: number | undefined): Promise<void> {
    const params = await sendLikeParams(
      count === undefined ? { userId } : { userId, count },
      (uin) => this.#ctx.resolveUserUid(typeof uin === "bigint" ? Number(uin) : uin),
    );
    await sendLikeCall.invoke(this.#ctx, params);
  }

  /**
   * `get_like_list` — `0x7e5_12` (someone else) or `0x7e5_13` (self).
   *
   * ⚠️ The sub-command is chosen from the PARAMS, not fixed: `getLikeParams` picks
   * `_13` when `userId` is absent/0/equal to the bot's own uin, `_12` otherwise. So
   * "my likes" and "their likes" are different OIDB commands, and hard-coding
   * either one produces a request the server answers with the wrong list.
   */
  async getLike(userId?: number | undefined, start = 0, limit = 10): Promise<ProfileLikeInfo> {
    const selfUin = Number(this.#ctx.identity.uin);
    const params = await getLikeParams(
      userId === undefined ? { start, limit } : { userId, start, limit },
      {
        selfUin,
        resolveSelfUid: () => this.#ctx.resolveUserUid(selfUin),
        resolveUserUid: (uin) => this.#ctx.resolveUserUid(uin),
      },
    );
    return getLikeCall.invoke(this.#ctx, params);
  }

  // -------------------------------------------------------------------------
  // Custom faces (收藏表情)
  // -------------------------------------------------------------------------

  /**
   * The saved-sticker ids, newest first, capped at `count`.
   *
   * `count` is validated (`>= 0` integer) and `0` short-circuits BEFORE any packet —
   * the reference says "must be a non-negative integer" and then returns `[]` for 0
   * without a request, so `count: 0` is a cheap probe rather than a wasted round
   * trip.
   */
  async fetchCustomFaceIds(count = 10): Promise<string[]> {
    if (!Number.isInteger(count) || count < 0) throw new Error("custom face count must be a non-negative integer");
    if (count === 0) return [];
    return (await this.#fetchCustomFaceList()).slice(0, count);
  }

  /** Saved-sticker URLs, in list order. */
  async fetchCustomFace(count = 10): Promise<string[]> {
    return (await this.fetchCustomFaceIds(count)).map((id) => customFaceUrl(this.#ctx.identity.uin, id));
  }

  /**
   * `resolveCustomFace` — find one saved sticker by emoji id OR by content MD5.
   *
   * The MD5 form is 32 hex characters and is matched case-insensitively against
   * `md5FromEmojiId(id)`. A miss throws
   * `"custom face is not in the saved sticker list"` — the wording is
   * user-visible, so it is copied.
   *
   * ⚠️ This is `send_custom_face`'s hard dependency. The list request needs the
   * `Faceroam.OpReq` codec, which `0x902e-profile.ts` documents as not ported; the
   * codec in `service-codecs.ts` closes that gap WITHOUT putting a fake
   * command/sub-command into an `OidbSpec`.
   */
  async resolveCustomFace(identifier: string): Promise<{ emojiId: string; url: string; md5: string }> {
    const wanted = identifier.trim();
    if (!wanted) throw new Error("custom face identifier is empty");
    const ids = await this.#fetchCustomFaceList();
    const byMd5 = /^[a-fA-F0-9]{32}$/.test(wanted);
    const emojiId = ids.find((id) =>
      byMd5 ? md5FromEmojiId(id).toLowerCase() === wanted.toLowerCase() : id === wanted,
    );
    if (!emojiId) throw new Error("custom face is not in the saved sticker list");
    return {
      emojiId,
      url: customFaceUrl(this.#ctx.identity.uin, emojiId),
      md5: md5FromEmojiId(emojiId),
    };
  }

  /**
   * `delete_custom_face` — remove one saved sticker.
   *
   * `FaceroamOpReq` with op 2 and a `body.emojiId`; `retCode !== 0` throws with the
   * server's message.
   *
   * ⚠️ No `field6` here, unlike the list request. The reference's
   * `DeleteCustomFace.serialize` (reference/index.mjs:319776) omits it while
   * `FetchCustomFaceList`'s sets `field6: 1`; adding it appends a stray `30 01`.
   */
  async deleteCustomFace(emojiId: string): Promise<void> {
    await this.#faceroamRaw(
      {
        inner: makeInner(false),
        uin: BigInt(this.#ctx.identity.uin),
        field3: FACEROAM_DELETE_OP,
        body: { emojiId },
      },
      "delete custom face",
    );
  }

  /**
   * The `Faceroam.OpReq` list call.
   *
   * Note `makeInner(true)`: the LIST request carries `qqVersion`, the DELETE does
   * not. That single boolean is the only structural difference between the two
   * inners (see `service-codecs.ts`).
   */
  async #fetchCustomFaceList(): Promise<string[]> {
    const resp = await this.#faceroamRaw(
      {
        inner: makeInner(true),
        uin: BigInt(this.#ctx.identity.uin),
        field3: FACEROAM_LIST_OP,
        field6: 1,
      },
      "fetch custom face list",
    );
    // `resp.item?.faceIds || []` — an absent item is an empty sticker list, not an
    // error. `retCode` 0 with no item is what a fresh account gets.
    return resp.item?.faceIds ?? [];
  }

  /**
   * `set_qq_avatar` — replace the account avatar.
   *
   * ⚠️ This is a **highway-only** operation: cmdId **90** with an EMPTY `extend` blob. There
   * is no OIDB request to make first and no response to decode — bytes on the CDN ARE the
   * whole operation. 90 is a fifth cmdId namespace, distinct from NTV2 media (1001-1008),
   * file transfer (71/95) and the custom-face upload (9).
   *
   * The empty-file rejection happens BEFORE the upload: staging a zero-byte avatar and
   * pushing it would send a request the server answers by clearing the avatar, which is a
   * destructive outcome for what is obviously a caller mistake.
   */
  async setAvatar(source: string): Promise<void> {
    const staged = await stageSourceToDisk(source, AVATAR_MAX_BYTES);
    let chunkSource: FileChunkSource | null = null;
    try {
      if (staged.fileSize === 0) throw new Error("avatar file is empty");
      const hashes = await hashFileStreaming(staged.filePath);
      chunkSource = await FileChunkSource.open(staged.filePath);
      const session = await this.#highwaySession();
      await uploadHighway(chunkSource, {
        uin: this.#ctx.identity.uin,
        commandId: AVATAR_HIGHWAY_CMD_ID,
        session,
        fileMd5: hashes.md5,
        // EMPTY on purpose — the avatar route carries no `extend` blob, unlike the group
        // avatar (cmdId 3000) which carries `GroupAvatarExtra`.
        extend: new Uint8Array(0),
      });
    } finally {
      // The chunk source holds an open file handle; closing it before the staged file is
      // removed keeps the removal legal on every platform.
      await chunkSource?.close();
      await staged.cleanup();
    }
  }

  /**
   * `set_group_portrait` — replace a group's picture.
   *
   * Deliberately parallel to {@link setAvatar} and NOT factored with it: the two differ in
   * the cmdId, the extend blob AND the empty-file wording, and a shared helper would need
   * three parameters to express that — more surface than the duplication it removes.
   */
  async setGroupAvatar(groupId: number, source: string): Promise<void> {
    const staged = await stageSourceToDisk(source, GROUP_AVATAR_MAX_BYTES);
    let chunkSource: FileChunkSource | null = null;
    try {
      if (staged.fileSize === 0) throw new Error("group avatar file is empty");
      const hashes = await hashFileStreaming(staged.filePath);
      chunkSource = await FileChunkSource.open(staged.filePath);
      const session = await this.#highwaySession();
      await uploadHighway(chunkSource, {
        uin: this.#ctx.identity.uin,
        commandId: GROUP_AVATAR_HIGHWAY_CMD_ID,
        session,
        fileMd5: hashes.md5,
        extend: encodeGroupAvatarExtra(groupId),
      });
    } finally {
      await chunkSource?.close();
      await staged.cleanup();
    }
  }

  #sessionCache: HighwaySessionCache | null = null;

  async #highwaySession(): Promise<HighwaySession> {
    this.#sessionCache ??= new HighwaySessionCache({
      sendRawPacket: (serviceCmd, body) => this.#ctx.sendRawPacket(serviceCmd, body),
    });
    return this.#sessionCache.get();
  }

  /**
   * Saved stickers WITH their descriptions — `fetch_custom_face_detail`.
   *
   * Two calls, in this order: the `Faceroam.OpReq` list to learn the ids, then `0x902e_2`
   * for the descriptions. The ids are the authority — the detail response is keyed back by
   * `emojiId` and a sticker missing from it still gets a row (with an empty `desc`), because
   * the reference maps over `emojis`, not over `details` (reference:333449-333456).
   *
   * `count === 0` returns `[]` WITHOUT a request: the reference short-circuits there, and
   * a zero-count call that still hit the network would be observable.
   */
  async fetchCustomFaceDetails(
    count = 10,
  ): Promise<{ emojiId: string; url: string; md5: string; desc: string }[]> {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error("custom face count must be a non-negative integer");
    }
    if (count === 0) return [];
    const emojiIds = (await this.#fetchCustomFaceList()).slice(0, count);
    if (emojiIds.length === 0) return [];
    const emojis = emojiIds.map((emojiId) => ({ emojiId, md5: md5FromEmojiId(emojiId) }));
    const details = await fetchCustomFaceDetailCall.invoke(this.#ctx, { emojis });
    const descriptions = new Map(details.map((detail) => [detail.emojiId, detail.desc]));
    return emojis.map(({ emojiId, md5 }) => ({
      emojiId,
      url: customFaceUrl(this.#ctx.identity.uin, emojiId),
      md5,
      // `?? ""` not `?? undefined`: the action's response schema requires the key.
      desc: descriptions.get(emojiId) ?? "",
    }));
  }

  /**
   * `modify_custom_face` — change a saved sticker's description.
   *
   * ⚠️ `ModifyCustomFace` is the ONE `0x902e_2` spec without `uinForm` (0x902e-profile.ts
   * header): this request carries no `uin`, so a caller that supplied one would be
   * describing a different account. The `md5` is not optional either — the server rewrites
   * the entry, and an absent md5 clears it.
   */
  async modifyCustomFace(emojiId: string, desc: string): Promise<void> {
    await modifyCustomFaceCall.invoke(this.#ctx, {
      emojiId,
      md5: md5FromEmojiId(emojiId),
      desc,
    });
  }

  /**
   * `move_custom_face_to_front` — reorder one saved sticker to the head of the list.
   *
   * The list read is NOT decoration: an id that is not in the list is a caller error, and
   * the reference refuses with `emoji_id not in list: …` (reference:333520) rather than
   * sending a reorder the server would apply to nothing. That refusal is the only thing
   * standing between a typo and a silent no-op.
   *
   * `position: 1` is 1-BASED — the head of the list is position 1, not 0.
   *
   * The 1000-item cap is the reference's own (`fetchCustomFaceIds(1e3)`): a larger list
   * cannot be reordered correctly in one call, and a smaller cap would report a present
   * sticker as missing.
   */
  async moveCustomFaceToFront(emojiId: string): Promise<void> {
    const ids = (await this.#fetchCustomFaceList()).slice(0, 1000);
    if (!ids.includes(emojiId)) {
      throw new Error(`emoji_id not in list: ${emojiId}`);
    }
    await orderCustomFaceCall.invoke(this.#ctx, { emojiId, position: 1 });
  }

  /**
   * The one-way (unidirectional) friend list — accounts that have you but you not them.
   *
   * ⚠️ Deliberately NOT `invokeOidb`. `0x0e17_0` is an OIDB command number with a
   * non-OIDB transport: the wire service is `MQUpdateSvc_com_qq_ti.web.OidbSvc.0xe17_0`
   * and the body is the request protobuf on its own, with no
   * `{cmd, svc, result, body}` envelope around it. Wrapping it the usual way emits a
   * frame the server rejects — the reference calls `sendRawPacket` directly
   * (reference:329232-329235), and so does this.
   *
   * The payload is itself JSON smuggled through protobuf fields 2/3, so the response
   * carries two independent error layers: a protobuf-level `errorCode` and, inside the
   * JSON, an `ActionStatus`/`ErrorCode` pair. `toUnidirectionalFriends` checks both — a
   * well-formed envelope wrapping `ActionStatus: "FAIL"` is an error, not an empty list.
   *
   * The returned blocks are passed through as the server shapes them (`uint64_uin` as a
   * string, because UINs exceed 2^53 as often as not). The reference does not walk them
   * into OneBot friend objects, so neither does this.
   */
  async getUnidirectionalFriendList(): Promise<UnidirectionalFriendBlock[]> {
    const body = encodeOidb0xe17Req(
      buildUnidirectionalFriendRequest(this.#ctx.identity.uin),
    );
    const result = await this.#ctx.sendRawPacket(UNIDIRECTIONAL_FRIEND_WIRE_NAME, body);
    return toUnidirectionalFriends(decodeOidb0xe17Resp(requirePacketResponse(result, UNIDIRECTIONAL_FRIEND_WIRE_NAME)));
  }

  /**
   * `add_custom_face` — upload an image and register it as a saved sticker.
   *
   * Reference `ProfileApi.addCustomFace` (reference/index.mjs:333493) plus
   * `AddCustomFace.invoke` (:319242). Five steps, in this exact order:
   *
   *   1. `loadBinarySource(imageSource, "custom-face")` → `bytes`. The reference's
   *      default size cap applies; no separate limit is imposed, because the
   *      reference imposes none.
   *   2. `md5 = md5(bytes)` — **raw bytes**, not hex. `emojiId` is then
   *      `${uin}_0_0_0_${HEX(md5).toUpperCase()}_0_0`.
   *   3. `sendRawPacket("ImgStore.BDHExpressionRoam", …)` → `inner.token` (field 8).
   *      A missing token is a hard error, and it is checked LAST — after
   *      `gotResponse` and `success` — because those two have their own messages.
   *   4. One highway POST of a `FavEmojiHighwayHead` frame (`commandId: 9`, a fourth
   *      highway namespace — see `0x902e-profile.ts`) to the FIRST server in the
   *      session, with the raw image as the body.
   *   5. Return `emojiId`. Note the reference returns the id it COMPUTED, not one
   *      echoed by the server; there is nothing to echo.
   *
   * ⚠️ The upload is a single frame — no chunk loop, no ack verification, no
   * `boolFileExist` short-circuit. Those belong to the media/file transfer paths,
   * which are different `commandId` families and different services. Using
   * `uploadHighway` here would chunk at 1 MiB and expect a `RespDataHighwayHead` the
   * emoji store does not send.
   *
   * ⚠️ `session.servers[0]` and nothing else, exactly as the reference writes it.
   * The media path's per-server retry is NOT applied: an emoji upload is one shot,
   * and a dead first server is a failure. Adding a retry would be a behaviour the
   * reference does not have.
   *
   * ⚠️ **The session is fetched BEFORE the roam packet, and it is NOT cached.** Both
   * halves are the reference's (`reference/index.mjs:319254`: the `await
   * fetchHighwaySession(deps)` sits above the `protobuf_encode_BDHExpressionRoamReq`
   * call). The ordering is observable — a server list that cannot be obtained fails
   * without consuming a roam token — and the absence of caching is deliberate: every
   * other highway caller in this port shares a `HighwaySessionCache`, and doing that
   * here would be a silent divergence.
   */
  async addCustomFace(imageSource: string): Promise<string> {
    const { bytes } = await loadBinarySource(imageSource, "custom-face");
    const md5 = new Uint8Array(createHash("md5").update(bytes).digest());
    const uin = this.#ctx.identity.uin;
    const emojiId = makeCustomFaceEmojiId(uin, md5);

    // Step order from the reference: session FIRST, then the roam request.
    //
    // ⚠️ Deliberately NOT `this.#highwaySession()`. That accessor returns the shared,
    // 5-minute `HighwaySessionCache`, and the reference's `fetchHighwaySession(deps)` here
    // takes NO cache: a fresh ticket per upload. A stale `sig_session` is worse than an
    // extra round trip, and reusing the cache would be a silent behavioural divergence —
    // `#highwaySession()` exists for `setAvatar`, which is a different call site.
    const session = await fetchHighwaySession({
      sendRawPacket: (serviceCmd, body) => this.#ctx.sendRawPacket(serviceCmd, body),
    });
    const server = session.servers[0];
    // Defensive, not in the reference (whose `[0]` would be `undefined` and throw a
    // TypeError on `.host`). `fetchHighwaySession` already rejects an empty list, so this
    // is unreachable through the normal path; it exists so a future refactor of the
    // session module fails with a message instead of a TypeError.
    if (!server) throw new Error("highway upload failed: no upload server");

    const requestBody = encodeBDHExpressionRoamReq(
      buildBDHExpressionRoamReq({ uin, md5, filesize: bytes.length }),
    );
    const result = await this.#ctx.sendRawPacket(BDH_EXPRESSION_ROAM_SERVICE, requestBody);
    if (!result.gotResponse) {
      throw new Error(result.errorMessage || "BDHExpressionRoam: no response");
    }
    if (!result.success) {
      throw new Error(result.errorMessage || "BDHExpressionRoam: send failed");
    }
    // `?? new Uint8Array(0)`: an absent body decodes to `{inner: null}`, so the token
    // check fails with the reference's own message rather than a decode error.
    const decoded = decodeBDHExpressionRoamResp(result.responseData ?? new Uint8Array(0));
    const token = decoded.inner?.token;
    // An EMPTY token counts as missing: the reference tests `!token`, which is true for
    // both `undefined` and a zero-length Uint8Array.
    if (!token || token.length === 0) {
      throw new Error("BDHExpressionRoam: response missing token (field8)");
    }

    const frame = packHighwayFrame(
      encodeFavEmojiHighwayHead(
        buildFavEmojiHighwayHead({
          uin,
          emojiId,
          md5,
          filesize: bytes.length,
          serviceTicket: token,
        }),
      ),
      bytes,
    );

    const signal = new AbortController().signal;
    const { socket } = await connectHighway([server], 0, signal);
    try {
      // The three extra headers are the reference's `fetch` headers, minus the ones
      // `httpPostFrameWithStatus` already fixes (`Connection`, `User-Agent`). `Host` and
      // `Content-Length` are computed by the transport.
      const response = await httpPostFrameWithStatus(
        socket,
        `${server.host}:${server.port}`,
        customFaceHighwayPath(uin),
        frame,
        signal,
        { extraHeaders: ["Accept: */*", "Cache-Control: no-cache", "Pragma: no-cache"] },
      );
      // `if (!httpResp.ok) throw …`. `ok` is 200-299; status `0` (no response line) lands
      // here too, which is correct — there was no HTTP answer to accept.
      if (response.status < 200 || response.status > 299) {
        throw new Error(`highway upload failed: HTTP ${response.status}`);
      }
    } finally {
      socket.destroy();
    }
    return emojiId;
  }

  /** Send a `Faceroam.OpReq` body, decode it, and enforce `retCode === 0`. */
  async #faceroamRaw(req: Parameters<typeof encodeFaceroamOpReq>[0], what: string): Promise<FaceroamOpResp> {
    const result = await this.#ctx.sendRawPacket(FACEROAM_SERVICE, encodeFaceroamOpReq(req));
    if (!result.success || !result.gotResponse || !result.responseData) {
      throw new Error(result.errorMessage || `${what} failed`);
    }
    const resp = decodeFaceroamOpResp(result.responseData);
    if ((resp.retCode ?? 0) !== 0) throw new Error(`${what} error: ${resp.message ?? "unknown"}`);
    return resp;
  }
}

// The like-list result is re-exported so the action layer can name it without
// reaching into `oidb/services` (a wire layer, not an API surface).
export type { ProfileLikeInfo } from "../../oidb/services/index.js";

// The reference keeps one logger per API. Nothing in this slice logs today; the
// symbol is retained because the upload paths (`setAvatar`, `addCustomFace`) are the
// ones that would report progress, and re-adding the logger later would silently move
// every other API's logger identity.
void log;