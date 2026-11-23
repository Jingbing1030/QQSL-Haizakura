// The `ctx` every action handler receives.
//
// Reference: `buildApiContext(ref)` at reference/index.mjs:40032
// (`../onebot/src/instance-context.ts`). The reference builds this object once per
// OneBot instance and hands the SAME object to every action's handler; the action
// modules never touch a Bridge directly except through `ctx.bridge`.
//
// ---------------------------------------------------------------------------
// Method names are the contract, so they are copied verbatim
// ---------------------------------------------------------------------------
// Two actions test for a provider's *presence* rather than calling it blindly:
//
//     if (ctx.getGroupList) return okResponse(await ctx.getGroupList(noCache));
//     return okResponse([]);
//
// (get_group_list, reference:8966; the same pattern appears in get_group_info,
// get_group_member_list, get_group_member_info, get_friend_list, get_stranger_info
// and get_group_system_msg). That presence test is load-bearing, and in
// `get_group_member_info` the two branches return **different objects** — the
// provider-absent fallback omits the three `qidian_*` flags that the
// provider-returned-null fallback includes. So every provider here is optional,
// and leaving one out is a behaviour change, not a shortcut.
//
// ---------------------------------------------------------------------------
// What is NOT in this interface, and why
// ---------------------------------------------------------------------------
// The reference's context also carries `sendGroupForwardMsg`, `sendPrivateForwardMsg`,
// `sendForwardMsg`, `getForwardMsg`, `forwardSingleMsg`, `setEssenceMsg`,
// `deleteEssenceMsg`, `setMsgEmojiLike`, `fetchEmojiLikeSummary`,
// `fetchEmojiLikeUsers`, `getImageInfo`, `getRecordInfo`, `fetchPttText`,
// `listReadSessions`, `cacheMessageMetas`, `getGroupFiles` and `handleGroupRequest`.
// None of those is reached by an action in this batch (4.1 / 4.2), so they are
// omitted rather than declared and left unimplemented — a declared-but-throwing
// member is worse than an absent one, because the presence test above would then
// take the happy branch.

import type { ApiResponse } from "../types.js";

/** The resource id `get_forward_msg` takes. */
export type ForwardResourceId = string;

/**
 * The `bridge` slice the actions in this batch reach.
 *
 * Only `apis` and `identity` are used, and only the members listed here:
 *
 *   get_login_info            identity: (none — via ctx.getLoginInfo)
 *   get_group_list/info/...   identity.findGroup / findGroupMember / groups
 *   the group-admin setters   apis.groupAdmin.*
 *   get_group_honor_info      apis.web.getHonorInfo
 *   get_group_share_link      apis.contacts.getGroupShareLink
 */
export interface ActionBridge {
  readonly identity: ActionIdentity;
  readonly apis: ActionApiHub;
  /**
   * `Bridge.receiveHealthy`, read by `get_status` as `online && receiveHealthy`.
   *
   * The reference's definition of this getter is in `src/bridge/bridge.ts`, outside
   * the regions this batch transcribed, so this port does not re-derive it: the
   * action reads whatever the host's bridge answers. A host without one satisfies
   * this interface by returning true.
   */
  readonly receiveHealthy: boolean;
  /**
   * `get_online_clients` — the reference reads `ctx.bridge.getOnlineClients()`, NOT a
   * `ctx.*` member (reference:40040 wires `getOnlineClients` straight off the Bridge).
   *
   * It answers `null` until a presence packet has been observed in this session — a
   * real distinction the action reports as
   * `online-client snapshot has not been observed in this session`, rather than as an
   * empty client list. Declared REQUIRED because the action calls it unguarded.
   */
  getOnlineClients(): OnlineClientSnapshot[] | null;
  /**
   * `send_packet` — the raw SSO escape hatch.
   *
   * Needed because `send_packet`'s `run` calls `ctx.bridge.sendRawPacket(cmd, body)`
   * and inspects `{success, errorMessage, responseData}` directly; it is the one action
   * in the batch that bypasses every codec. `OidbTransportResult`-shaped: an
   * unattached sender answers `errorCode: -1`, `success: false`.
   */
  sendRawPacket(
    wireName: string,
    request: Uint8Array,
    timeoutMs?: number,
  ): Promise<{ success: boolean; gotResponse: boolean; errorCode?: number; errorMessage?: string; responseData?: Uint8Array | null }>;
  /**
   * `upload_private_file` — the upload metadata read-back (4.3b).
   *
   * `recallUploadedFile(fileId)` is `Bridge.recallUploadedFile` (reference:347504),
   * which reads the bounded FIFO that `rememberUploadedFile` writes. The ACTION calls
   * it on the BRIDGE, not on `ctx`:
   *
   *     const uploaded = ctx.bridge.recallUploadedFile(result.fileId);   // L10404
   *
   * and then requires `uploaded.scope === "private" && uploaded.userId === p.user_id`
   * — a cache entry for a *different* chat counts as missing, which is why the shape
   * below has to carry `scope` and the per-scope owner rather than just the name.
   *
   * 🔴 **This port has the cache but never fills it.** `Bridge.rememberUploadedFile`
   * exists and is bounded exactly like the reference's; the only writer in the
   * reference is `GroupFileApi.upload` / `uploadPrivate`, and both are blocked on the
   * Highway channel here. So the read is declared for the action's sake and a host
   * that supplies real uploads gets the metadata path for free.
   *
   * Declared REQUIRED: the reference calls it unguarded inside `if (p.upload_file)`.
   */
  recallUploadedFile(fileId: string): ActionUploadedFileMeta | undefined;
}

/**
 * One row of the bounded upload-metadata cache — what `rememberUploadedFile` stores
 * and `recallUploadedFile` answers.
 *
 * The field list is transcribed from the reference's own two `rememberUploadedFile`
 * object literals, not inferred:
 *
 *     GroupFileApi.upload        (reference:289772)
 *       { fileId, scope: "group",   groupId, fileName, fileSize, fileMd5, fileSha1,
 *         rememberedAt }
 *     GroupFileApi.uploadPrivate (reference:289827)
 *       { fileId, scope: "private", userId,  fileName, fileSize, fileMd5, fileSha1,
 *         fileHash, rememberedAt }
 *
 * Two details that are easy to get wrong and are therefore stated here:
 *
 *   * `fileMd5` / `fileSha1` are RAW BYTES (`Uint8Array`), not hex — `hashFileStreaming`
 *     returns the digest buffers and the reference stores them unstringified
 *     (reference:37373-37416). The action re-encodes: `Buffer.from(uploaded.fileMd5)
 *     .toString("hex")`. Typing them as `string` would make the port emit the wrong
 *     `md5` in the uploaded-file message segment while still compiling.
 *   * `fileHash` exists ONLY on the private path, and defaults to `""` rather than
 *     being absent, which is why the action's fallback chain ends in `""`.
 *
 * 🔴 The bridge-side `UploadedFileMeta` (`ts/src/bridge/context.ts`) is typed as
 * `{fileId: string; [field: string]: unknown}`, so a host that writes a real upload
 * cache needs a narrowing adapter before it satisfies this interface. That file is
 * outside this batch's ownership; the gap is reported rather than papered over.
 */
export interface ActionUploadedFileMeta {
  fileId: string;
  /**
   * REQUIRED because the reference dereferences it UNGUARDED:
   *
   *     name:      uploaded.fileName,
   *     file_size: uploaded.fileSize,
   *     md5:       Buffer.from(uploaded.fileMd5).toString("hex"),
   *
   * Marking any of these optional would let a host compile a cache entry that the
   * action then turns into `Buffer.from(undefined)` — a runtime TypeError where the
   * reference has a plain read. Since both writers in the reference always set all
   * three, requiring them here states the true contract and moves the failure to
   * the host's type check.
   */
  fileName: string;
  fileSize: number;
  /** RAW digest bytes, not hex — see the header note. */
  fileMd5: Uint8Array;
  fileSha1?: Uint8Array | undefined;
  /** Present on both writers in the reference; not dereferenced by this action. */
  scope?: "group" | "private" | undefined;
  /** `scope === "group"` only. */
  groupId?: number | undefined;
  /** `scope === "private"` only — the field the action compares against `p.user_id`. */
  userId?: number | undefined;
  /** `scope === "private"` only; defaults to `""` in the reference's literal. */
  fileHash?: string | undefined;
  rememberedAt?: number | undefined;
}

/** One row of the `get_online_clients` snapshot. */
export interface OnlineClientSnapshot {
  appId: number | string;
  deviceName: string;
  deviceKind: "computer" | "pad" | "phone" | "unknown";
}

/**
 * The roster slice. Every member is one the batch's actions actually read; the
 * reference's IdentityService has 17 that the bridge layer touches, but the action
 * layer only sees these.
 */
export interface ActionIdentity {
  /** The bot's own QQ number, as a decimal string (reference: `IdentityService.uin_`). */
  readonly uin: string;
  nickname: string;
  readonly selfUid: string | null;
  readonly groups: readonly ActionGroupInfo[];
  findGroup(groupId: number): ActionGroupInfo | null;
  findGroupMember(groupId: number, uin: number): ActionGroupMemberInfo | null;
  findFriend(uin: number): ActionFriendInfo | null;
  findUserProfile(uin: number): ActionUserProfile | null;
  findUinByUid(uid: string, groupId?: number): number | null;
  forgetGroup(groupId: number): void;
  rememberGroups(groups: readonly ActionGroupInfo[]): void;
  rememberGroupMembers(groupId: number, members: readonly ActionGroupMemberInfo[]): void;
  rememberUserProfile(profile: ActionUserProfile): void;
}

/**
 * A group row, as the reference's ContactsApi builds it
 * (reference/index.mjs:74525 `fetchGroupList`).
 *
 * `level` is NOT part of that row — the reference adds it only through
 * `fetchGroupDetail`, which is why `getGroupList` reports `g.level ?? 0` (always 0)
 * while `getGroupInfo` calls `getGroupLevel()` first. Both are modelled here.
 */
export interface ActionGroupInfo {
  groupId: number;
  groupName: string;
  remark: string;
  memberCount: number;
  memberMax: number;
  createTime?: number | undefined;
  level?: number | undefined;
  memo?: string | undefined;
  description?: string | undefined;
  allMuted?: boolean | undefined;
  members?: Map<number, ActionGroupMemberInfo> | undefined;
}

/** A group member row. `role` is a STRING here — the 0/1/2 form lives at the wire only. */
export interface ActionGroupMemberInfo {
  uin: number;
  uid: string;
  nickname: string;
  card: string;
  role: "owner" | "admin" | "member";
  level: number;
  title: string;
  joinTime: number;
  lastSentTime: number;
  shutUpTime: number;
  /** `undefined` means "not classified yet"; `formatGroupMember` THROWS on that. */
  isRobot?: boolean | undefined;
}

export interface ActionFriendInfo {
  uin: number;
  uid: string;
  nickname: string;
  remark: string;
  categoryId?: number | undefined;
  profile?: Record<string, unknown> | undefined;
}

/** A user profile as `FetchUserProfile` deserializes it (oidb/services/0xfe1.ts). */
export interface ActionUserProfile {
  uin: number;
  uid: string;
  nickname: string;
  remark: string;
  qid: string;
  sex: string;
  age: number;
  sign: string;
  avatar: string;
  level: number;
  qidianMasterFlag: number;
  qidianCrewFlag: number;
  qidianCrewFlag2: number;
  status?: number | undefined;
  extStatus?: number | undefined;
  batteryStatus?: number | undefined;
  customStatus?: unknown;
  customStatusDesc?: string | undefined;
  regTime?: number | undefined;
  vipFlag?: boolean | undefined;
  yearVipFlag?: boolean | undefined;
  svipFlag?: boolean | undefined;
  vipLevel?: number | undefined;
  birthdayYear?: number | undefined;
  birthdayMonth?: number | undefined;
  birthdayDay?: number | undefined;
  profile?: Record<string, unknown> | undefined;
}

/**
 * The ApiHub slice the batch's actions call.
 *
 * Typed as the exact signatures the actions use, so a host can satisfy it
 * structurally with the real bridge APIs where they exist.
 */
export interface ActionApiHub {
  contacts: ActionContactsApi;
  groupAdmin: ActionGroupAdminApi;
  web: ActionWebApi;
  profile: ActionProfileApi;
  /**
   * 4.4 — all 29 qzone actions.
   *
   * This slice is NOT in the `ApiHub` shape declared on the bridge side, because
   * `ts/src/bridge/apis/qzone.ts` predates this batch and is typed against
   * `BridgeContext`. The structural type below is the *measured* member list: every
   * method name, parameter order and arity comes from the reference's 29 `run`
   * bodies (`reference/index.mjs:16226-17594`), not from `QzoneApi`'s own
   * signatures. The two are compatible — `QzoneApi` satisfies this interface
   * structurally, and a test binds a `QzoneApi`-shaped object to assert it.
   */
  qzone: ActionQzoneApi;
  /** 4.6 — the 3 friend actions. `delete`/`handleRequest` are the two mutators. */
  friend: ActionFriendApi;
  /** 4.6 — the 4 system-face actions. */
  systemFace: ActionSystemFaceApi;

  // -------------------------------------------------------------------------
  // 4.5 — the 擴展 family's remaining five slices
  // -------------------------------------------------------------------------
  // `interaction` is fully implemented (`ts/src/bridge/apis/interaction.ts`).
  // `misc`, `extras` and `groupFile` are now wired too — `extras` in this batch,
  // which is what unblocks `send_group_ai_record` (it was the last action in the
  // family marked `blocked`).
  //
  // `flashTransfer` is fully wired: all eleven of its actions reach a real method,
  // including `create_flash_task`, whose uploader (`createFlashTask`) lives in
  // `bridge/apis/flash-transfer.ts`. So the "declared but unimplemented" note that used
  // to sit here is gone: every member of this interface now has an implementation
  // behind it, and no flash action is reported as blocked.
  interaction: ActionInteractionApi;
  message: ActionMessageApi;
  collection: ActionCollectionApi;
  misc: ActionMiscApi;
  extras: ActionExtrasApi;
  flashTransfer: ActionFlashTransferApi;
  groupFile: ActionGroupFileApi;
  /**
   * 4.3b — the 群相册 family's nine actions.
   *
   * All nine are here and all nine are reachable: the module behind them
   * (`ts/src/bridge/apis/group-album.ts` — 9,288 reference lines, 8,390 of them a
   * generated protobuf codec) is already ported in full. So unlike `groupFile`,
   * nothing in this family is blocked on missing infrastructure.
   */
  groupAlbum: ActionGroupAlbumApi;
}

/**
 * `GroupAlbumApi` — the slice the nine 群相册 actions call.
 *
 * Measured from the nine `run` bodies at reference:15898, 15989, 16019, 16051,
 * 16087, 16142, 16169, 16196, 16221. Every one is a single call whose result is
 * either dropped (`upload` → `okResponse(null)`) or passed straight through
 * (`list`, `listQun`, `uploadVideo`, `getMediaList`, `comment`, `like`, `delete`).
 *
 * "Passed straight through" is the load-bearing property: seven of the nine do no
 * reshaping, so their response shape IS the API's shape and must not be
 * re-derived here. `get_qun_album_list` is the one that reshapes — it renames
 * `albumList`/`attachInfo`/`hasMore` into `album_list`/`attach_info`/`has_more` —
 * and that mapping belongs to the action, not to this slice.
 *
 * Opaque payloads stay opaque on purpose. The reference's `returnsSchema` for
 * `get_group_album_media_list` describes a media union with a dozen nullable
 * members; tightening it here would claim the server always sends fields it may
 * omit, and `like`'s own schema declares every field nullable.
 */
export interface ActionGroupAlbumApi {
  /** `list(groupId)` — the legacy albums array (`toLegacyAlbum` rows). */
  list(groupId: number): Promise<unknown[]>;
  /** `listQun(groupId, attachInfo)` — `{albumList, attachInfo, hasMore}`. */
  listQun(
    groupId: number,
    attachInfo: string,
  ): Promise<{ albumList: unknown[]; attachInfo: string; hasMore: boolean }>;
  /** `upload(groupId, albumId, albumName, file)` — HTTPS; resolves to nothing. */
  upload(groupId: number, albumId: string, albumName: string, file: string): Promise<void>;
  /** `uploadVideo(...)` — `{id}`. Needs a media probe (ffmpeg) on the bridge side. */
  uploadVideo(groupId: number, albumId: string, albumName: string, file: string): Promise<{ id: string }>;
  /** `getMediaList(groupId, albumId, attachInfo)` — `{mediaList, nextAttachInfo}`. */
  getMediaList(
    groupId: number,
    albumId: string,
    attachInfo: string,
  ): Promise<{ mediaList: unknown[]; nextAttachInfo: string }>;
  /** `comment(...)` — `{id, user, content, time, clientKey}`. */
  comment(groupId: number, albumId: string, lloc: string, content: string): Promise<unknown>;
  /**
   * `like(groupId, albumId, batchId, lloc, isLike)` — `{id, status}`, both nullable.
   *
   * `lloc` is `string | undefined` because the ACTION passes `p.lloc || void 0`
   * (reference:16169 / 16196): an absent `lloc` AND a present `""` both arrive as
   * `undefined`. Typing it `string` would let a port pass `""` and compile, which a
   * recording fake can tell apart even though `qunFeedCellId` truth-tests both the
   * same way.
   */
  like(
    groupId: number,
    albumId: string,
    batchId: string,
    lloc: string | undefined,
    isLike: boolean,
  ): Promise<unknown>;
  /** `delete(groupId, albumId, lloc)` — `{success: true}`. */
  delete(groupId: number, albumId: string, lloc: string): Promise<unknown>;
}

/** `InteractionApi` — implemented in full; four one-line spec calls. */
export interface ActionInteractionApi {
  sendPoke(isGroup: boolean, peerUin: number, targetUin?: number | undefined): Promise<void>;
  sendLike(userId: number, count: number): Promise<void>;
  setReaction(groupId: number, sequence: number, code: string, isSet: boolean): Promise<void>;
}

/** The three read-receipt writers the extended family uses. */
export interface ActionMessageApi {
  markGroupRead(groupId: number, messageId?: number | undefined): Promise<void>;
  markPrivateRead(userId: number, messageId?: number | undefined): Promise<void>;
  markAllRead(groupIds: readonly number[], privateUserIds: readonly number[]): Promise<void>;
}

/**
 * `CollectionApi` — reference:46969-46986, seventeen lines.
 *
 * 🔴 NOT implemented: `list` pages through `SsoGetCollectionList` over a bare
 * `sendOidbRaw` with a hand-built `CollectionReq` protobuf that has no port. The spec
 * `0x1c02` is not an OIDB command in `ts/src/oidb/services/` for the same reason
 * `Faceroam.OpReq` is not: it packs a nested hand-encoded struct.
 */
export interface ActionCollectionApi {
  list(category: number, count: number): Promise<Record<string, unknown>[]>;
}

/**
 * `MiscApi` — five of nine implemented; four do not exist yet.
 *
 * Implemented (`0xeb7` / `0xe07` codecs are both in `ts/src/oidb/services/`):
 *   translateEn2Zh   `0xeb7_1` TranslateEnToZh
 *   ocrImage         `0xe07_*` ImageOcr
 *   sendGroupSign    `0xeb7_1` SendGroupSign
 *   clickInlineKeyboardButton `0x112e_1` ClickInlineKeyboardButton
 *   getDecryptKey    — local: `RequestDbKey` is a pure function of the salt
 *
 * 🔴 NOT implemented:
 *   getMiniAppArk    — needs `protobuf_encode_MiniAppShareReq` /
 *                      `protobuf_decode_MiniAppShareResp` over the bare
 *                      `LightAppSvc.mini_app_share.AdaptShareInfo` packet. Both
 *                      codecs are generated-schema functions in the reference
 *                      (reference:316748 / 317042) with no port here, and the
 *                      command is not an OIDB service.
 */
export interface ActionMiscApi {
  translateEn2Zh(words: readonly string[]): Promise<string[]>;
  ocrImage(imageUrl: string): Promise<Record<string, unknown>>;
  sendGroupSign(groupId: number): Promise<void>;
  clickInlineKeyboardButton(
    groupId: number,
    botAppid: number,
    buttonId: string,
    callbackData: string,
    msgSeq: number,
  ): Promise<Record<string, unknown>>;
  getDecryptKey(dbSalt: string): Promise<string>;
  /** 🔴 NOT implemented — no `MiniAppShareReq`/`Resp` codec in this port. */
  getMiniAppArk(
    type: string,
    title: string,
    desc: string,
    picUrl: string,
    jumpUrl: string,
  ): Promise<Record<string, unknown>>;
}

/**
 * `ExtrasApi` — nine methods; eight implemented, one not.
 *
 * Implemented (specs in `0x929b-extras.ts` / `0xfe1.ts`; class in
 * `ts/src/bridge/apis/extras.ts`):
 *   getStrangerStatus  `0xfe1_*` GetStrangerStatus
 *   fetchAiVoiceList   `0x929d_*` FetchAiVoiceList
 *   fetchAiVoice       `0x929b_*` FetchAiVoice
 *   getGroupTodoList   `0x9474_0` GetGroupTodoList
 *   setGroupTodo / completeGroupTodo / cancelGroupTodo  `0x0f90` GroupTodo
 *   sendAiVoice        `0x929b_0` + a `group_message` receipt wait
 *
 * ✅ `sendAiVoice` is the interesting one and it is DONE. It is not a plain
 * `invoke`-and-return: the 0x929b response omits the group message sequence, so the
 * bridge subscribes to `ctx.events`' `group_message` channel BEFORE publishing,
 * correlates the echo by media UUID, and de-duplicates claims across calls
 * (reference:82496-82552). The events channel is reachable from here because
 * `Bridge` owns one and `BridgeContext` has exposed `events` all along — the earlier
 * note that it "is not wired into `ActionContext`" was wrong: the ACTION never
 * touches the bus, the BRIDGE slice does.
 *
 * 🔴 NOT implemented:
 *   convertRecord    — needs the bundled SILK-capable ffmpeg addon (`get_record
 *                      out_format`). `loadBinarySource` exists; `convertAudioBytes`
 *                      does not, and cannot without a native addon. The bridge method
 *                      exists and rejects with that wording, so `get_record` reports
 *                      `语音转码失败：…` rather than a TypeError.
 */
export interface ActionExtrasApi {
  getStrangerStatus(uin: number): Promise<Record<string, unknown> | null>;
  fetchAiVoiceList(groupId: number, chatType: number): Promise<AiVoiceCategory[]>;
  fetchAiVoice(groupId: number, voiceId: string, text: string, chatType: number): Promise<unknown>;
  getGroupTodoList(groupId: number): Promise<GroupTodoItem[]>;
  setGroupTodo(groupId: number, msgSeq: bigint): Promise<void>;
  completeGroupTodo(groupId: number, msgSeq: bigint): Promise<void>;
  cancelGroupTodo(groupId: number, msgSeq: bigint): Promise<void>;
  /** 🔴 NOT implemented — needs a native audio transcoder. */
  convertRecord(source: string, format: string): Promise<{ base64: string; fileSize: number }>;
  /**
   * Publish an AI voice and resolve with the SEQUENCE of QQ's self-message echo.
   *
   * Resolves only when a matching `group_message` receipt arrives; rejects on
   * timeout (`… no matching group-message receipt arrived within Nms …`), on
   * candidate overflow (`… receipt correlation overflowed after 64 …`), and on a
   * synthesis response with no media UUID (`… no exact media identifier …`). The
   * three are distinct on purpose — they call for different operator responses.
   */
  sendAiVoice(
    groupId: number,
    voiceId: string,
    text: string,
    chatType: number,
  ): Promise<{ sequence: number }>;
}

/**
 * One AI voice category row.
 *
 * ⚠️ Every member is nullable, and that is the WIRE's shape rather than laziness. The
 * `0x929d_0` decoder types `category`, `voiceId`, `voiceDisplayName` and
 * `voiceExampleUrl` as `string | null` (`body.content ?? []`, reference:77972), and
 * the reference's action passes them THROUGH unchanged (`type: cat.category`,
 * reference:14453). Declaring `string` here would let a caller do
 * `cat.category.length` on a row the server sent without a category and get a
 * TypeError the reference never produces — the same class of declaration defect as
 * `ActionWebApi.getCredentials` below. The action layer's `okResponse(...)` payload is
 * `unknown`, so nothing downstream breaks.
 */
export interface AiVoiceCategory {
  category: string | null;
  voices: {
    voiceId: string | null;
    voiceDisplayName: string | null;
    voiceExampleUrl: string | null;
  }[];
}

export interface GroupTodoItem {
  sequence: number;
  random: number;
  text: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * `FlashTransferApi` — all twelve members.
 *
 * Reference: `../bridge/src/apis/flash-transfer.ts` (reference:107728-108131, 404
 * lines over `0x93cf`/`0x93d0`/`0x93d1`/`0x93d2`/`0x93d3`/`0x93d4`/`0x93d7`/`0x93db`/
 * `0x9407`/`0x9427`). All ten specs ARE ported in `ts/src/oidb/services/0x93d0-flash.ts`,
 * and the class now exists at `ts/src/bridge/apis/flash-transfer.ts`.
 *
 * All eleven flash actions reach a real method. `create_flash_task` needs the local
 * **upload** pipeline, which `createFlashTask` now carries: it stages the sources,
 * streams MD5/sha1, applies + commits the fileset, slices each file into 1 MiB chunks
 * and POSTs them, then uploads two placeholder thumbnails. Every failure is a throw —
 * the method cannot answer a fabricated `fileset_id`.
 *
 * ⚠️ `getShareLink` used to be declared `Record<string, unknown>` here. That was a
 * declaration defect: the reference's `returnsSchema` is
 * `{type: "string", description: "生成的下载或分享 URL 字符串，不是含 url 字段的对象"}`
 * and `get_share_link` passes the value straight through, so the correct answer is a
 * bare string. Corrected to `string`.
 *
 * ⚠️ `file_index` is 1-based here, contradicting the reference action's own example
 * note ("file_index 从 0 开始"). `getFileDownload` defaults it to `1` and matches
 * `row.fileIndex`, which `toFlashDownloadRows` builds as `info.field6 ?? index + 1` —
 * a 1-based fallback. So the default and the wire agree on 1-based and only the prose
 * note says 0. The contradiction is the reference's; it is reported, not resolved by
 * guessing which half is right.
 */
export interface ActionFlashTransferApi {
  createFlashTask(
    files: { file: string; name?: string | undefined }[],
    name?: string | undefined,
    thumbPath?: string | undefined,
  ): Promise<{ filesetId: string }>;
  getFilesetInfo(filesetId: string): Promise<FlashFileInfo[]>;
  getFlashFileList(filesetId: string): Promise<FlashFileInfo[]>;
  listFilesets(): Promise<FlashFileInfo[]>;
  getFlashFileUrl(filesetId: string, fileIndex?: number | undefined): Promise<string>;
  getShareLink(filesetId: string): Promise<string>;
  deleteFlashFile(filesetId: string): Promise<void>;
  renameFlashFile(filesetId: string, newName: string): Promise<void>;
  downloadFileset(
    filesetId: string,
    options?: { fileName?: string | undefined; fileIndex?: number | undefined },
  ): Promise<{ url: string; fileName: string; fileSize: number }>;
  sendFlashMsg(filesetId: string, target: { userId?: number | undefined; groupId?: number | undefined }): Promise<void>;
  getFilesetIdByCode(shareCode: string): Promise<string>;
}

export interface FlashFileInfo {
  filesetUuid: string;
  fileName: string;
  origName: string;
  fileSize: number;
  shareUrl: string;
  fileId: string;
  downloadUrl: string;
}

/**
 * `GroupFileApi` — PARTIALLY implemented.
 *
 * Present on `ts/src/bridge/apis/group-file.ts` (built by the 4.3 batch):
 *   list / getUrl / getPrivateUrl / delete / move / rename / createFolder /
 *   deleteFolder / renameFolder / upload / uploadPrivate
 *
 * Missing the three the 擴展 family needs:
 *   getCount / getSpace  — `0x6d8_2` / `0x6d8_3` are ported as `GetGroupFileCount` /
 *                          `GetGroupFileSpace`; wiring only.
 *   trans                — `0x6d9_0` `TransGroupFile`; wiring only.
 *   getPttUrl            — `0x126e_200` `GetGroupPttUrl`; wiring only.
 */
export interface ActionGroupFileApi {
  getCount(groupId: number): Promise<{ fileCount: number; maxCount: number }>;
  getSpace(groupId: number): Promise<{ usedSpace: number; totalSpace: number }>;
  trans(groupId: number, fileId: string): Promise<void>;
  deleteFolder(groupId: number, folderId: string): Promise<void>;
  getPttUrl(groupId: number, node: unknown): Promise<string>;

  // ---------------------------------------------------------------------------
  // 4.3b — the members the 群文件 family's twelve actions call directly
  // ---------------------------------------------------------------------------
  // Measured from the twelve `run` bodies (reference:10345-10840). Ten of the
  // twelve reach `ctx.bridge.apis.groupFile.*`; the other two go through
  // `ctx.getGroupFiles`, which itself lands on `list`. So `list` is here as well,
  // even though no action body names it.
  //
  // 🔴 `list`'s parameters are NOT the action's. The action passes a FOLDER PATH
  // (`"/"` or `"/sub"`), and the bridge normalises it — which is why
  // `get_group_files_by_folder`'s `folder_id` can carry either a path or a name.

  /**
   * `list(groupId, folderId)` — the paginated directory read behind
   * `ctx.getGroupFiles`.
   *
   * Not called by any action body directly, but it IS the one interesting method
   * here: it answers the bridge's own CAMELCASE rows, and the snake_case rename the
   * actions need lives in the formatter, not here. That split is the reference's.
   */
  list(
    groupId: number,
    folderId?: string,
  ): Promise<{ files: ActionGroupFileRow[]; folders: ActionGroupFolderRow[] }>;

  /**
   * `getUrl(groupId, fileId, busId)` — `busidOr102`'s answer, passed through raw.
   *
   * The bridge's own default is `102`, which is NOT the same thing as the action's
   * `busidOr102`: the action coerces ANY input (`"abc"`, `-1`, `{}`) to `102`
   * before the call, so the bridge default is never exercised from here.
   */
  getUrl(groupId: number, fileId: string, busId: number): Promise<string>;

  /**
   * `getPrivateUrl(userId, fileId, fileHash)` — `userId` is IGNORED by the bridge.
   *
   * The reference's own comment says so: the request is addressed by the bot's own
   * uid, and the action still passes `p.user_id ?? 0`. Reproduced, not cleaned up —
   * a recording fake can tell the two apart.
   */
  getPrivateUrl(userId: number, fileId: string, fileHash: string): Promise<string>;

  delete(groupId: number, fileId: string): Promise<void>;
  move(groupId: number, fileId: string, parentDirectory: string, targetDirectory: string): Promise<void>;
  rename(groupId: number, fileId: string, parentDirectory: string, newFileName: string): Promise<void>;
  createFolder(groupId: number, name: string, parentId: string): Promise<ActionFolderInfo>;
  renameFolder(groupId: number, folderId: string, newFolderName: string): Promise<void>;

  /**
   * `upload` / `uploadPrivate` — the two file-transfer members.
   *
   * Both are implemented end to end: stage → hash → OIDB "request upload" →
   * Highway PUT (cmdId 71 group / 95 private) → publish. Failures surface as
   * retcode 100 with the bridge's own wording, so the action layer needs no
   * knowledge of the transport.
   *
   * `uploadFile: false` is a real mode (create the record, skip the bytes);
   * `publishFile` defaults to `uploadFile` but the action passes `false` for the
   * private path and posts the file itself, because the segment it sends carries
   * the `file_hash` from the response.
   */
  upload(
    groupId: number,
    file: string,
    name: string,
    folderId: string,
    uploadFile: boolean,
  ): Promise<{ fileId: string }>;
  uploadPrivate(
    userId: number,
    file: string,
    name: string,
    uploadFile: boolean,
    publishFile: boolean,
  ): Promise<{ fileId: string; fileHash: string | null }>;
}

/** One file row as `GroupFileApi.list` produces it — CAMELCASE, bridge-side. */
export interface ActionGroupFileRow {
  fileId: string;
  fileName: string;
  busId: number;
  fileSize: number;
  uploadTime: number;
  deadTime: number;
  modifyTime: number;
  downloadTimes: number;
  uploader: number;
  uploaderName: string;
}

/** One folder row as `GroupFileApi.list` produces it — CAMELCASE, bridge-side. */
export interface ActionGroupFolderRow {
  folderId: string;
  folderName: string;
  createTime: number;
  creator: number;
  creatorName: string;
  totalFileCount: number;
  lastUploadTime: number;
  lastUploader: number;
  lastUploaderName: string;
}

/**
 * `createFolder`'s answer — the folder row the server echoed.
 *
 * Seven fields, and the reference's `returnsSchema` requires ALL seven, which is
 * why this is a closed interface rather than `Record<string, unknown>`:
 * `create_group_file_folder` puts it verbatim under
 * `groupItem.folderInfo`, so a missing field would be a silently different
 * response. The bridge's own `FolderInfo` (`oidb/services/0x6d7.ts:206`) has
 * exactly these seven in a different order; this type states the action-visible
 * shape so the action layer does not import from `oidb/`.
 */
export interface ActionFolderInfo {
  folderId: string;
  folderName: string;
  folderPath: string;
  createTime: number;
  modifyTime: number;
  createUin: number;
  modifyUin: number;
}



/**
 * `QzoneApi` as the 29 qzone actions see it.
 *
 * Loose where the reference is loose: `getMsgList` returns a real interface, but the
 * public/feed methods return `Record<string, unknown>` because their payloads are
 * upstream cell objects whose value to the caller is precisely their unknown
 * fields. Tightening those would reject fields the server adds.
 */
export interface ActionQzoneApi {
  getProfile(targetUin?: number | string | undefined): Promise<{ name: string; description: string }>;
  setProfile(profile: { name?: string | undefined; description?: string | undefined }): Promise<void>;
  getMsgList(targetUin?: number | string | undefined, pos?: number, num?: number): Promise<Record<string, unknown>>;
  getMsgDetail(
    tid: string,
    targetUin?: number | string | undefined,
    pos?: number,
    num?: number,
  ): Promise<Record<string, unknown>>;
  getFeeds(pageNum?: number, count?: number, cursor?: string | undefined): Promise<Record<string, unknown>>;
  uploadImageFromSource(source: string): Promise<{ richval: string; url: string; [key: string]: unknown }>;
  publish(
    content: string,
    richType?: number | undefined,
    richval?: string | undefined,
    ugcRight?: number,
    targetUins?: string | undefined,
  ): Promise<{ tid: string; time: number }>;
  delete(tid: string): Promise<void>;
  updateRight(tid: string, ugcRight: number, targetUins?: string | undefined): Promise<{ ugc_right: number }>;
  like(tid: string, targetUin: number | string | undefined, like: boolean, abstime?: number): Promise<void>;
  comment(
    tid: string,
    content: string,
    targetUin?: number | string | undefined,
    richType?: number | undefined,
    richval?: string | undefined,
    reply?: {
      commentId: string;
      commentUin: string;
      replyTo?: { uin: string; name: string } | undefined;
    },
  ): Promise<Record<string, unknown>>;
  setBlack(targetUin: number | string | undefined, ban: boolean): Promise<void>;
  getHomeFeeds(targetUin?: number | string | undefined, cursor?: string | undefined): Promise<Record<string, unknown>>;
  getFeedDetail(tid: string): Promise<Record<string, unknown>>;
  getShareArk(feed: Record<string, unknown>): Promise<{
    ark: string;
    requires_confirmation: boolean;
    notice: string | null;
  }>;
  getPublicCapabilities(): Promise<Record<string, unknown>>;
  getPublicFeeds(cursor?: string | undefined): Promise<Record<string, unknown>>;
  getPublicFeedDetail(feed: Record<string, unknown>): Promise<Record<string, unknown>>;
  getPublicComments(feed: Record<string, unknown>, cursor: string): Promise<Record<string, unknown>>;
  getPublicReplies(
    feed: Record<string, unknown>,
    comment: Record<string, unknown>,
    cursor?: string,
    pageSize?: number,
  ): Promise<Record<string, unknown>>;
  setPublicUpvote(feed: Record<string, unknown>, enable?: boolean): Promise<Record<string, unknown>>;
  setPublicLike(feed: Record<string, unknown>, enable?: boolean): Promise<Record<string, unknown>>;
  setPublicCommentLike(
    feed: Record<string, unknown>,
    comment: Record<string, unknown>,
    enable?: boolean,
    reply?: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown>>;
  commentPublicFeed(
    feed: Record<string, unknown>,
    content: string | Record<string, unknown>[],
  ): Promise<Record<string, unknown>>;
  replyPublicFeed(
    feed: Record<string, unknown>,
    comment: Record<string, unknown>,
    content: string | Record<string, unknown>[],
    reply?: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown>>;
  deletePublicComment(
    feed: Record<string, unknown>,
    comment: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  deletePublicReply(
    feed: Record<string, unknown>,
    comment: Record<string, unknown>,
    reply: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  setPublicFollow(feed: Record<string, unknown>, enable?: boolean): Promise<Record<string, unknown>>;
  forwardPublicFeed(feed: Record<string, unknown>, reason?: string): Promise<Record<string, unknown>>;
}

/**
 * `FriendApi` members the 3 friend actions and the 2 request actions reach.
 *
 * Reference: `src/bridge/apis/friend.ts` (reference/index.mjs:203899, 82 lines).
 * Two members:
 *
 *   `delete(userId, block)` (203918) — throws `"this contact cannot be deleted"` for
 *   a dataline pseudo-contact BEFORE invoking `0x126b_0`, then refreshes the friend
 *   list and SWALLOWS that refresh failure. The swallow is observable: a
 *   `delete_friend` whose delete succeeded answers ok even when the roster refresh
 *   cannot be sent.
 *
 *   `handleRequest(uidOrFlag, approve)` (203909) — a thin
 *   `HandleFriendRequest.invoke`, which is `0xb5d_44`.
 *
 * `setRemark` and the four doubt-request members are NOT declared: no action in this
 * batch reads them. Declaring them would be surface with no caller.
 */
/** One doubtful friend-add row, after uid resolution. */
export interface DoubtFriendRequestRow {
  uid: string;
  user_id: number;
  nick: string;
  source: string;
  reason: string;
  msg: string;
  group_code: string;
  reqTime: number;
}

export interface ActionFriendApi {
  delete(userId: number, block?: boolean): Promise<void>;
  handleRequest(uidOrFlag: string, approve: boolean): Promise<void>;
  // 4.5 — the 擴展 family's four additional friend members. All implemented on
  // `ts/src/bridge/apis/friend.ts` (`getDoubtRequests` resolves each row's missing
  // uid, and `setRemark` routes an empty remark to `0x912f_0` rather than sending an
  // empty string to `0x912e_0`).
  getDoubtRequests(count: number): Promise<DoubtFriendRequestRow[]>;
  approveDoubtRequest(uidOrFlag: string): Promise<void>;
  rejectDoubtRequest(uidOrFlag: string): Promise<void>;
  setRemark(userId: number, remark: string): Promise<void>;
}

/**
 * One catalog entry, in the wire shape.
 *
 * `qSid` is a STRING — it is the emoji's Unicode escape for some faces and a decimal
 * id for others — while every other numeric field is `number | null`. That asymmetry
 * is what `isAddressableFaceId` (reference:109811) guards.
 */
export interface SystemFaceEntry {
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

export interface SystemFacePack {
  packName: string;
  emojis: SystemFaceEntry[];
}

/**
 * `SystemFaceApi` — all four members, exactly as the reference's class has them
 * (reference/index.mjs:339140).
 *
 * The store behind it is the substance, not this interface. `SysFaceStore`
 * (reference:109595) owns catalog indexing, refresh coalescing, persistence,
 * lookup caching and the `validateCatalog` invariants; it is ported in
 * `ts/src/bridge/apis/system-face.ts`.
 */
export interface ActionSystemFaceApi {
  fetchCatalog(refresh?: boolean): Promise<readonly SystemFacePack[]>;
  fetchFace(faceId: number, refresh?: boolean): Promise<SystemFaceEntry | null>;
  search(query: string): Promise<readonly SystemFaceEntry[]>;
  isSuper(faceId: number, refresh?: boolean): Promise<boolean>;
}

/**
 * `ProfileApi` members used by this batch.
 *
 * 🔴 **Neither is ported in `ts/src/bridge/apis/`.** Both are declared here because
 * `send_custom_face` and `set_group_portrait` are two of the 42 actions and their
 * `run` bodies call these two methods unconditionally; a host that cannot supply
 * them fails the action at the call site rather than silently answering `ok`.
 *
 * What each one needs, measured from the reference rather than guessed:
 *
 *   `resolveCustomFace` (reference:333469) — lists the saved stickers via the
 *   `Faceroam.OpReq` service, then matches `emoji_id` either exactly or, when the
 *   argument is 32 hex chars, by `md5FromEmojiId(emojiId)`. It THROWS
 *   `"custom face is not in the saved sticker list"` on a miss. Note that
 *   `ts/src/oidb/services/0x902e-profile.ts` documents `FetchCustomFaceList` as
 *   deliberately NOT ported (`Faceroam.OpReq` is not an OIDB command — it goes over a
 *   bare `sendRawPacket`, so it has no place in an `OidbSpec`). So the missing piece
 *   is the codec, not the spec.
 *
 *   `setGroupAvatar` (reference:333416) — `loadBinarySource` → `computeHashes` →
 *   `fetchHighwaySession` → `uploadHighwayHttp` with a hand-encoded
 *   `GroupAvatarExtra` blob (type=101, field3.field1=1, field5=3, field6=1). The
 *   highway uploader does not exist in this port, and `GroupAvatarExtra` has no
 *   encoder, so this is the largest single gap in the batch.
 */
export interface ActionProfileApi {
  resolveCustomFace(identifier: string): Promise<{ emojiId: string; url: string; md5: string }>;
  setGroupAvatar(groupId: number, source: string): Promise<void>;
  // 4.5 — the 擴展 family's profile-backed actions, all already implemented on
  // `ts/src/bridge/apis/profile.ts` EXCEPT the two marked below.
  setProfile(nickname?: string | undefined, personalNote?: string | undefined, sex?: number | undefined): Promise<void>;
  setSelfLongNick(longNick: string): Promise<void>;
  setInputStatus(userId: number, eventType: number): Promise<void>;
  setOnlineStatus(status: number, extStatus?: number, batteryStatus?: number): Promise<void>;
  setDiyOnlineStatus(faceId: number, wording: string, faceType: number): Promise<void>;
  fetchCustomFaceIds(count?: number): Promise<string[]>;
  fetchCustomFace(count?: number): Promise<string[]>;
  deleteCustomFace(emojiId: string): Promise<void>;
  getLike(userId?: number | undefined, start?: number, limit?: number): Promise<Record<string, unknown>>;
  /**
   * ✅ Implemented on `ProfileApi` (`ts/src/bridge/apis/profile.ts`).
   *
   * `add_custom_face` sends `ImgStore.BDHExpressionRoam` to fetch a highway
   * `serviceTicket`, then uploads ONE `FavEmojiHighwayHead` frame with
   * `commandId: 9` — the FOURTH highway cmdId namespace, distinct from NTV2 media
   * (1001-1008), file transfer (71/95) and the avatar id (90). It returns the
   * `emoji_id` it COMPUTED (`uin_0_0_0_<UPPERCASE-MD5>_0_0`), not one echoed by the
   * server. The three codecs are in `oidb/services/0x902e-profile.ts`.
   *
   * Still OPTIONAL here: a host may inject a narrower `ActionProfileApi`, and the
   * action then answers the reference's own failure rather than `{}`.
   */
  addCustomFace?(file: string): Promise<string>;
  /** ✅ Implemented — `0x902e_2` with `opType 3`. */
  modifyCustomFace?(emojiId: string, desc: string): Promise<void>;
  /** ✅ Implemented — `0x902f_1` with `position: 1`, after the list membership check. */
  moveCustomFaceToFront?(emojiId: string): Promise<void>;
  /** ✅ Implemented — `Faceroam.OpReq` list, then `0x902e_2` for the descriptions. */
  getUnidirectionalFriendList?(): Promise<Record<string, unknown>[]>;
  /** ✅ Implemented — the list gives the ids, `0x902e_2` gives the per-item `desc`. */
  fetchCustomFaceDetails?(count?: number): Promise<{ emojiId: string; url: string; md5: string; desc: string }[]>;
  /** ✅ Implemented — highway `commandId: 90` with an empty `extend` blob. */
  setAvatar?(file: string): Promise<void>;
}

/**
 * `ContactsApi` members used by 4.1 / 4.2.
 *
 * `fetchGroupMemberList` takes an optional `{force}` because the reference calls it
 * two ways: `fetchGroupMemberList(groupId)` (cached, 60 s TTL) from
 * get_group_member_list and `fetchGroupMemberList(groupId, {force})` from
 * get_group_member_info. The cache itself lives in the API, not in the action.
 */
export interface ActionContactsApi {
  fetchFriendList(options?: { withProfile?: boolean | undefined }): Promise<readonly ActionFriendInfo[]>;
  fetchGroupList(): Promise<readonly ActionGroupInfo[]>;
  fetchGroupDetail(groupId: number): Promise<ActionGroupInfo | null>;
  fetchGroupMemberList(groupId: number, options?: { force?: boolean | undefined }): Promise<readonly ActionGroupMemberInfo[]>;
  fetchUserProfile(uin: number): Promise<ActionUserProfile>;
  fetchUserProfileByUid(uid: string): Promise<ActionUserProfile>;
  getGroupShareLink(groupId: number, needShortUrl?: boolean, srcId?: number, additionalParam?: string): Promise<string>;
  getGroupRecommendArk(groupId: number): Promise<string>;
  getBuddyRecommendArk(userId: number, phoneNumber?: string): Promise<string>;
  fetchQidianCorpInfo(uin: number): Promise<{ name: string } | null>;
  fetchGroupRequests(filtered: boolean, count: number, cursor?: bigint): Promise<readonly ActionGroupRequest[]>;
  /**
   * The FLAT filtered inbox — see `FilteredGroupRequestRow`.
   *
   * Separate member rather than an option on the nested one because the two rows are
   * genuinely different records; the reference returns the flat one from
   * `fetchGroupRequests` and the 4.1 batch's nested view is derived from it elsewhere.
   */
  fetchFilteredGroupRequests?(count?: number): Promise<readonly FilteredGroupRequestRow[]>;
  /**
   * 🔴 NOT implemented — the friend-category roster.
   *
   * Reference: `getFriendCategories({withProfile})` (reference:74362-74730) runs
   * `FetchFriendCategory` (`0x1cfe_0`) for the category list, then `FetchFriendListCache`
   * and merges. Neither spec is ported and `contacts.ts`'s header records both as
   * deliberately absent.
   */
  fetchFriendCategories?(options?: { withProfile?: boolean | undefined }): Promise<readonly ActionFriendCategory[]>;
  /**
   * 🔴 NOT implemented — `SetFriendCategory` (`0x1d00_0`).
   *
   * `exactlyOneOf(categoryId, categoryName)` means the two are alternatives, so this
   * signature keeps both optional and the action enforces the exclusive-or.
   */
  setFriendCategory?(options: {
    uin: number;
    categoryId?: number | undefined;
    categoryName?: string | undefined;
  }): Promise<void>;
  /** 🔴 NOT implemented — `SendTuwenArk` spec exists in `0x496-9067.ts`; wiring only. */
  sendTuwenArk?(options: ActionTuwenArkOptions): Promise<void>;
}

/** One friend category, after the roster merge. */
export interface ActionFriendCategory {
  categoryId: number;
  categoryName: string;
  memberCount: number;
  friends: readonly ActionFriendInfo[];
}

/** `send_tuwen_ark`'s payload; `peerType` 1 = group, 0 = private. */
export interface ActionTuwenArkOptions {
  targetId: number;
  peerType: number;
  title: string;
  desc: string;
  summary: string;
  previewUrl: string;
  jumpUrl: string;
}

/** One row of the group-request inbox, after the reference's merge. */
export interface ActionGroupRequest {
  sequence: bigint;
  eventType: number;
  state: number;
  group?: { groupUin: number; groupName: string } | undefined;
  target: { uid: string; uin: number; name: string };
  invitor: { uid: string; uin: number; name: string };
  comment: string;
}

/**
 * The FLATTENED inbox row the 擴展 family's two projections read.
 *
 * ⚠️ This is a DIFFERENT shape from `ActionGroupRequest`, and the difference is the
 * whole reason both exist. `fetchGroupRequests` in the reference
 * (reference:74608-74648) merges the raw packet into a flat record — `groupId`,
 * `targetUin`, `invitorUin`, `operatorUin`, `targetName`, `invitorName` and so on — and
 * `formatGroupRequestFlag` reads `sequence`/`groupId`/`eventType`/`filtered` off THAT.
 * The 4.1 batch then introduced the nested `{group, target, invitor}` view for
 * `get_group_system_msg`, which is what `ActionGroupRequest` describes.
 *
 * A projection written against the nested shape compiles and answers plausible output
 * with the wrong values in every field (that is exactly what the differential test
 * caught), so the flat shape is declared here and the two inbox readers are separated.
 */
export interface FilteredGroupRequestRow {
  groupId: number;
  groupName: string;
  targetUid: string;
  targetUin: number;
  targetName: string;
  invitorUid: string;
  invitorUin: number;
  invitorName: string;
  operatorUid: string;
  operatorUin: number;
  operatorName: string;
  sequence: number;
  state: number;
  notifyType: number;
  eventType: number;
  comment: string;
  filtered: boolean;
}

/**
 * One UID-form inbox row — `FilteredGroupRequestRow` plus the opaque
 * `operateTransInfo` blob.
 *
 * ⚠️ `FilteredGroupRequestRow` deliberately has no `operateTransInfo`, yet
 * `applyGroupRequest` passes it through to `setAddRequest` (reference:39989
 * `live.operateTransInfo`). So the extra field is declared HERE rather than being
 * bolted onto the flat row, which would make every `fetchFilteredGroupRequests`
 * caller think the field is always present. It is `undefined` for a row that did not
 * carry one — which is what the reference's
 * `raw.operateTransInfo && raw.operateTransInfo.length > 0 ? ... : void 0` produces
 * (reference:74688).
 *
 * Both `ContactsApi.fetchGroupRequestsByUid` and `host/group-request.ts`'s
 * `fetchRequestInboxes` produce this shape; they share the declaration so the two
 * cannot drift.
 */
export interface GroupRequestInboxRow extends FilteredGroupRequestRow {
  operateTransInfo?: Uint8Array | undefined;
}

/**
 * `GroupAdminApi` members used by 4.2.
 *
 * Every one of these is a thin `SomeOidbSpec.invoke(ctx, {...})` in the reference
 * (reference/index.mjs:234064), so the interface is the whole dependency: an
 * implementation that maps these onto `ts/src/oidb/services/` is complete, and one
 * that does not fails at the call rather than silently.
 */
export interface ActionGroupAdminApi {
  kickMember(groupId: number, userId: number, reject: boolean): Promise<void>;
  /** `0xf16_0` `SetGroupRemark` — ported in `0xf16.ts`, wiring added for 4.5. */
  setRemark(groupId: number, remark: string): Promise<void>;
  /** 🔴 NOT wired — `GetAtAllRemain` IS ported (`0x90f5`/`0x8a7`); one call away. */
  getAtAllRemain?(groupId: number): Promise<Record<string, unknown>>;
  /** 🔴 NOT wired — `SetGroupRobotAddOption` spec absent. */
  setRobotAddOption?(
    groupId: number,
    robotMemberSwitch?: number | undefined,
    robotMemberExamine?: number | undefined,
  ): Promise<void>;
  kickMembers(groupId: number, userIds: readonly number[], reject: boolean): Promise<void>;
  muteMember(groupId: number, userId: number, duration: number): Promise<void>;
  muteAll(groupId: number, enable: boolean): Promise<void>;
  setAddOption(groupId: number, addType: number, groupQuestion?: string | undefined, groupAnswer?: string | undefined): Promise<void>;
  setSearch(groupId: number, noFingerOpen?: number | undefined, noCodeFingerOpen?: number | undefined): Promise<void>;
  setMemberInvitePolicy(groupId: number, policy: MemberInvitePolicy): Promise<void>;
  setNewMemberHistoryVisibility(groupId: number, visible: boolean): Promise<void>;
  setMemberPermissions(
    groupId: number,
    permissions: {
      allowMemberUploadAlbum?: boolean | undefined;
      allowMemberTemporarySession?: boolean | undefined;
      allowMemberCreateGroup?: boolean | undefined;
    },
  ): Promise<void>;
  getAdminSettings(groupId: number): Promise<GroupAdminSettings>;
  listCategoryTags(groupClass: number): Promise<{ tags: GroupCategoryTag[] }>;
  addCategoryTag(groupClass: number, name: string): Promise<void>;
  removeCategoryTag(groupClass: number, name: string): Promise<void>;
  setAdmin(groupId: number, userId: number, enable: boolean): Promise<void>;
  getAdminPermissions(groupId: number, userId: number): Promise<GroupAdminPermissions>;
  setAdminPermissions(
    groupId: number,
    userId: number,
    patch: {
      recallMemberMessage?: boolean | undefined;
      kickMember?: boolean | undefined;
      kickMemberPerDay?: number | undefined;
    },
  ): Promise<void>;
  setAdminReceiveVerify(groupId: number, userId: number, enable: boolean): Promise<void>;
  setCard(groupId: number, userId: number, card: string): Promise<void>;
  setName(groupId: number, name: string): Promise<void>;
  leave(groupId: number): Promise<void>;
  setSpecialTitle(groupId: number, userId: number, title: string): Promise<void>;
}

export type MemberInvitePolicy = "disabled" | "require_approval" | "no_approval" | "no_approval_under_100";

/** `getAdminSettings`' 12 fields, in the reference's key order (reference:234087). */
export interface GroupAdminSettings {
  add_type: number;
  group_question: string;
  group_answer: string;
  robot_member_switch: number;
  robot_member_examine: number;
  member_invite_policy: MemberInvitePolicy;
  allow_member_upload_album: boolean;
  allow_member_temporary_session: boolean;
  allow_member_create_group: boolean;
  new_member_history_visible: boolean;
  no_finger_open: number;
  no_code_finger_open: number;
}

/** `getAdminPermissions`' six fields; the three nullable ones stay null when unspecified. */
export interface GroupAdminPermissions {
  group_id: number;
  user_id: number;
  recall_member_message: boolean | null;
  kick_member: boolean | null;
  kick_member_per_day: number | null;
  receive_verify: boolean | null;
}

export interface GroupCategoryTag {
  id: number;
  name: string;
  type: number;
}

/** `WebApi` member used by 4.2 (`get_group_honor_info`). */
export interface ActionWebApi {
  getHonorInfo(groupId: number, type: string): Promise<GroupHonorInfo>;
  // 4.5 — the 擴展 family's web-backed actions. All ten are already implemented on
  // `ts/src/bridge/apis/web.ts`; they are declared here so the action layer needs no
  // cast, and a host that omits one fails at the call instead of answering `{}`.
  getCookiesStr(domain: string): Promise<string>;
  getCsrfToken(): Promise<number>;
  getCredentials(domain: string): Promise<{ cookies: string; bkn: string; skey: string; pskey: string; clientKey: string }>;
  getEssenceAll(groupId: number): Promise<EssencePageLike[]>;
  getSignedList(groupId: number): Promise<SignedMember[]>;
  sendNotice(
    groupId: number,
    content: string,
    options?: {
      image?: string | undefined;
      pinned?: number | undefined;
      type?: number | undefined;
      sendToNewMembers?: boolean | undefined;
      isShowEditCard?: number | undefined;
      tipWindowType?: number | undefined;
      confirmRequired?: number | undefined;
    },
  ): Promise<unknown>;
  getNotice(groupId: number): Promise<GroupNotice[]>;
  deleteNotice(groupId: number, fid: string): Promise<boolean>;
  forceFetchClientKey(): Promise<{ clientKey: string; keyIndex: string; expireTime: string }>;
  getFriendDress(targetUin: number): Promise<Record<string, unknown>>;
}

/**
 * One page of the group-essence web API.
 *
 * `msg_list` is `unknown[]` because the projection in `extended.ts` reads a dozen
 * snake_case fields off each row and validates every one of them itself
 * (`projectEssenceMessage`). Typing them here would duplicate that validation in a
 * place with no ability to throw the reference's specific messages.
 */
export interface EssencePageLike {
  retcode: number;
  retmsg?: string;
  data: { is_end: boolean; msg_list: unknown[]; [field: string]: unknown };
  [field: string]: unknown;
}

/** One row of `get_group_signed_list`; shape owned by `web/group-signin.ts`. */
export interface SignedMember {
  user_id: number;
  nick: string;
  time: number;
  rank: number;
}

/** One group announcement, after the feeds/inst merge. */
export interface GroupNotice {
  notice_id: string;
  sender_id: number;
  publish_time: number;
  message: { text: string; image: NoticeImage[]; images: NoticeImage[] };
  settings: unknown;
  read_num: number;
  type: number;
  pinned: number;
  send_to_new_members: boolean;
}

export interface NoticeImage {
  id: string;
  url: string;
  height: number;
  width: number;
}

export interface HonorMember {
  user_id: number | string | null;
  nickname: string;
  avatar: string;
  description: string;
}

export interface GroupHonorInfo {
  group_id: number;
  current_talkative: HonorMember | null;
  talkative_list: HonorMember[];
  performer_list: HonorMember[];
  legend_list: HonorMember[];
  emotion_list: HonorMember[];
  strong_newbie_list: HonorMember[];
}

/** The login identity `get_login_info` reports. */
export interface LoginInfo {
  userId: number;
  nickname: string;
}

/**
 * A stored message event plus the metadata needed to recall it.
 *
 * `findEvent` answers the OneBot event object that `get_msg` returns (minus
 * `post_type`/`self_id`, plus `real_id`); `findMeta` answers what `delete_msg`
 * needs. Both are separate calls in the reference because a message can be known
 * but not retractable, and vice versa.
 */
export interface StoredMessageMeta {
  isGroup: boolean;
  targetId: number;
  sequence: number;
  sequenceAuthoritative: boolean;
  clientSequence: number;
  random: number;
  timestamp: number;
}

/**
 * One row of `getGroupFiles(...).files` — the SNAKE_CASE OneBot shape.
 *
 * Field order is the reference's object-literal order (reference:39479-39491), not
 * an alphabetisation: `okResponse` serialises `data` as written, so a client that
 * diffs raw JSON sees field order. The same reason is why every field is REQUIRED
 * even though the bridge coerces missing numbers to `0` / missing strings to `""` —
 * the formatter always writes all eleven keys.
 *
 * `group_id` is per-row, not hoisted, because the reference repeats it into every
 * file and every folder (it maps over the list with `group_id: groupId` inside the
 * mapper). Hoisting it would change the response.
 */
export interface GroupFileEntry {
  group_id: number;
  file_id: string;
  file_name: string;
  busid: number;
  file_size: number;
  upload_time: number;
  dead_time: number;
  modify_time: number;
  download_times: number;
  uploader: number;
  uploader_name: string;
}

/**
 * One row of `getGroupFiles(...).folders`.
 *
 * Ten keys — note `create_name`, not `creator_name`: that asymmetry with
 * `last_uploader_name` is the reference's own (reference:39494-39504) and is copied
 * rather than normalised, because the field name is the wire contract.
 */
export interface GroupFolderEntry {
  group_id: number;
  folder_id: string;
  folder_name: string;
  create_time: number;
  creator: number;
  create_name: string;
  total_file_count: number;
  last_upload_time: number;
  last_uploader: number;
  last_uploader_name: string;
}

/**
 * Everything an action in this batch may call on its context.
 *
 * `bridge` is required because 26 of the 42 actions reach it; the rest are optional
 * and their absence selects a documented fallback (see the header).
 */
export interface ActionContext {
  readonly bridge: ActionBridge;

  getLoginInfo(): LoginInfo;
  isOnline(): boolean;
  getUptimeMs(): number;
  canSendImage?(): boolean;
  canSendRecord?(): boolean;

  // ---------------------------------------------------------------------
  // REQUIRED, not optional — the reference calls all six unconditionally
  // ---------------------------------------------------------------------
  // Measured, not assumed. `awk 'NR>=7869 && NR<=8058' reference/index.mjs | grep ctx.`
  // finds exactly these six, and none is behind a presence test:
  //
  //     const data = await ctx.getMessage(p.message_id);            // L8019
  //     await ctx.refreshMessageMedia(p.message_id, result);        // L8028
  //     const meta = await ctx.getMessageMeta(p.message_id);        // L8046
  //     await ctx.deleteMessage(p.message_id, meta);                // L8048
  //     (await ctx.sendPrivateMessage(...)).messageId               // L7976
  //     (await ctx.sendGroupMessage(...)).messageId                 // L8000
  //
  // Contrast with the guarded ones in the same batch — `ctx.getGroupList`,
  // `ctx.getGroupInfo`, `ctx.getGroupMemberList`, `ctx.getGroupMemberInfo`,
  // `ctx.handleGetGroupSystemMsg`, `ctx.getFriendList`, `ctx.getStrangerInfo` — each
  // of which IS wrapped in `if (ctx.X)`. So the distinction is the reference's, and
  // this port keeps it: marking these six optional would make a missing store answer
  // `100 message not found` instead of throwing the TypeError the reference throws.
  //
  // 🔴 **No message store and no send path exist in this port yet.** Declaring these
  // required pushes the obligation to the host at COMPILE time (see
  // `createActionDispatcher`), which is the honest failure mode: a host cannot wire
  // this up and silently get `{}` responses.

  /** Look up a stored message event. `null`/`undefined` ⇒ `get_msg` fails 100. */
  getMessage(messageId: number): Promise<Record<string, unknown> | null | undefined>;
  /** Refresh media URLs in place on the event. */
  refreshMessageMedia(messageId: number, event: Record<string, unknown>): Promise<void>;
  /** Recall metadata. Miss ⇒ `delete_msg` fails 100. */
  getMessageMeta(messageId: number): Promise<StoredMessageMeta | null | undefined>;
  deleteMessage(messageId: number, meta: StoredMessageMeta): Promise<void>;

  sendGroupMessage(groupId: number, message: unknown, autoEscape: boolean): Promise<{ messageId: number }>;
  sendPrivateMessage(
    userId: number,
    message: unknown,
    autoEscape: boolean,
    tempGroupId?: number | undefined,
  ): Promise<{ messageId: number }>;

  getFriendList?(withProfile: boolean): Promise<unknown[]>;
  getGroupList?(noCache: boolean): Promise<unknown[]>;
  getGroupInfo?(groupId: number, noCache: boolean): Promise<unknown | null>;
  getGroupMemberList?(groupId: number, noCache: boolean): Promise<unknown[]>;
  getGroupMemberInfo?(groupId: number, userId: number, noCache: boolean): Promise<unknown | null>;
  getStrangerInfo?(userId: number): Promise<unknown | null>;
  handleGetGroupSystemMsg?(query: {
    groupId?: number | undefined;
    onlyPending: boolean;
    count: number;
  }): Promise<unknown[]>;
  getForwardMsg?(resId: ForwardResourceId): Promise<unknown[]>;
  /**
   * Upload-only: `{ forwardId }`, NO `messageId` — see `ForwardUploadResult`.
   *
   * `uploadForwardMessage(ref, messages, groupId)` (reference:194654) resolves every
   * node through the group-file uploader, so the whole family is blocked on the Highway
   * upload path, not just on this member.
   */
  sendForwardMsg?(messages: unknown, groupId?: number | undefined): Promise<ForwardUploadResult>;
  /**
   * The two real forward senders.
   *
   * `meta` is the preview block from `readForwardPreviewMeta` — `undefined` when the
   * caller set none, which stops the send from carrying an empty preview.
   */
  sendGroupForwardMsg?(groupId: number, messages: unknown, meta: ForwardPreview | undefined): Promise<ForwardSendResult>;
  sendPrivateForwardMsg?(userId: number, messages: unknown, meta: ForwardPreview | undefined): Promise<ForwardSendResult>;
  /**
   * `forwardSingleMessage(ref, messageId, target, dispatch?)` (reference:194703).
   *
   * Re-sends one stored message to another session. Needs the message store (to read the
   * original's segments) AND the send path, so it is blocked on both.
   */
  forwardSingleMsg?(
    messageId: number,
    target: { userId?: number | undefined; groupId?: number | undefined },
  ): Promise<{ messageId: number }>;
  /**
   * `getGroupHistory(ref, groupId, messageId, count, reverseOrder)` — reference:40052.
   *
   * A thin wrapper over `bridge.apis.message`'s seq-window reader, but it reads the
   * MESSAGE STORE to translate an anchor `messageId` into a sequence. Absent store means
   * it cannot anchor, which is why it is a `ctx` member rather than a hub method.
   */
  getGroupMsgHistory?(groupId: number, messageId: number, count: number, reverseOrder: boolean): Promise<unknown[]>;
  getFriendMsgHistory?(userId: number, messageId: number, count: number, reverseOrder: boolean): Promise<unknown[]>;
  /**
   * `buildApiContext`'s `getImageInfo` (reference:40132) and `getRecordInfo`
   * (:40133) — the media-cache lookups `get_image` / `get_file` / `ocr_image` and the
   * three download streams resolve a cached id through.
   *
   * Both answer `null` for a cache miss, and BOTH PROVIDERS RETURN `file`/`url` as the
   * SAME value (the resolved URL) — so `download_file_stream` reconstructing
   * `file || file_id` from a cache hit gets the URL, which is why `resolveDownload`
   * tests the answer with `/^https?:\/\//` before fetching it.
   *
   * Declared OPTIONAL because the reference's providers are the only ones that can
   * exist: a host without a media store has no cached ids to resolve. Optionality is
   * not permission to ignore them — `resolveDownload` must still fail with
   * `"file not found (expected a stream-dir path, an http(s) URL, or a cached
   * image/voice id)"` rather than dereference nothing.
   */
  getImageInfo?(file: string): Promise<MediaInfo | null | undefined>;
  getRecordInfo?(file: string): Promise<MediaInfo | null | undefined>;
  /**
   * `buildApiContext`'s `handleGroupRequest` (reference:40057):
   *
   *     (flag, _subType, approve, reason) => handleGroupAddRequest(bridge, flag, approve, reason)
   *
   * Declared OPTIONAL because the reference's own `run` for `set_group_add_request`
   * calls it unguarded and therefore throws a TypeError when a host omits it — which
   * is precisely the failure this port reproduces, and making it required would push
   * that obligation onto every one of the ~40 unrelated actions' hosts instead.
   *
   * The `subType` argument is IGNORED by the reference's provider (`_subType`), but
   * the ACTION still computes and passes it, and a recording fake observes it — so
   * the signature carries it.
   */
  handleGroupRequest?(flag: string, subType: string, approve: boolean, reason: string): Promise<void>;
  /**
   * `get_group_root_files` / `get_group_files_by_folder` — 4.3b.
   *
   * `buildApiContext`'s provider (reference:40056):
   *
   *     getGroupFiles: (groupId, folderId) => getGroupFiles(bridge, groupId, folderId)
   *
   * and the free function it names lives at reference:39476 in
   * `../onebot/src/modules/contact-actions.ts`:
   *
   *     async function getGroupFiles(bridge, groupId, folderId) {
   *       const result = await bridge.apis.groupFile.list(groupId, folderId ?? "/");
   *       return {
   *         files:   result.files.map(file => ({ group_id, file_id, file_name, busid,
   *                                              file_size, upload_time, dead_time,
   *                                              modify_time, download_times, uploader,
   *                                              uploader_name })),
   *         folders: result.folders.map(folder => ({ group_id, folder_id, folder_name,
   *                                                  create_time, creator, create_name,
   *                                                  total_file_count, last_upload_time,
   *                                                  last_uploader, last_uploader_name })),
   *       };
   *     }
   *
   * 🔴 THAT RENAME IS THE WHOLE POINT OF THIS MEMBER. The bridge returns camelCase
   * rows (`GroupFileRow` / `GroupFolderRow`, `ts/src/bridge/apis/group-file.ts:137`),
   * and every OneBot client expects snake_case. An action that called
   * `bridge.apis.groupFile.list` directly would answer the bridge's own shape — a
   * different response for the same action name. So this port walks the reference's
   * path: the formatter is `formatGroupFiles` in `actions/group-file.ts`, and the
   * actions reach it through this member.
   *
   * `folderId` is `string | undefined` rather than `string`: the reference's `?? "/"`
   * is INSIDE the formatter, so passing `undefined` must be distinguishable from
   * passing `"/"` only in theory — it is not observable, but the parameter is typed
   * the way the reference wrote it (`folderId ?? "/"` on a possibly-undefined value).
   *
   * Declared OPTIONAL for the same measured reason as `handleGroupRequest`: the
   * reference's `run` bodies call it unguarded, so a host that omits it makes both
   * listing actions fail loudly. Making it required would impose an obligation on
   * every unrelated action's host.
   */
  getGroupFiles?(
    groupId: number,
    folderId: string | undefined,
  ): Promise<{ files: GroupFileEntry[]; folders: GroupFolderEntry[] }>;

  // ---------------------------------------------------------------------------
  // 4.5 — the 擴展 family's store-backed providers
  // ---------------------------------------------------------------------------
  // The reference's `buildApiContext` (reference:40032) wires each of these to
  // `messageStore` / `reactionStore` / `bridge`. This port has neither store, so
  // every member is declared here and NONE is implemented by the bridge — which is
  // exactly why they are `?`: a host that has not injected a store must fail the
  // action rather than answer an empty list.
  //
  // Each note gives the reference's presence semantics, taken from the action body.
  // Where the reference calls `ctx.X` UNGUARDED the port must throw, so the action
  // reproduces the reference's TypeError; where it guards (`if (ctx.X)`) the action
  // answers its own documented fallback. Both are stated per member.

  /**
   * `set_essence_msg` / `delete_essence_msg` — UNGUARDED in the reference.
   *
   * Resolves the message meta, requires `isGroup`, requires an authoritative
   * sequence, then calls `interaction.setEssence(targetId, sequence, random,
   * enable)`. Both actions are therefore correct-but-inert without a message store.
   */
  setEssenceMsg?(messageId: number): Promise<void>;
  deleteEssenceMsg?(messageId: number): Promise<void>;

  /**
   * `set_msg_emoji_like` — UNGUARDED.
   *
   * `setMsgEmojiLike(messageId, emojiId, set)` from `buildApiContext`: find the meta,
   * refuse non-group and non-authoritative messages, call
   * `interaction.setReaction(...)`, then record the reaction in the reaction store so
   * `get_msg_emoji_likes` can answer from cache before the server does.
   */
  setMsgEmojiLike?(messageId: number, emojiId: string, set: boolean): Promise<void>;

  /**
   * `get_emoji_likes` / `fetch_emoji_like` — UNGUARDED.
   *
   * Returns the reactor page plus the CACHED total (`cachedCount`), because
   * `fetch_emoji_like` decides `isLastPage` against the cache rather than the server
   * count. A provider that omits `cachedCount` makes that comparison `NaN >= x`,
   * which is why it is required rather than derived.
   */
  fetchEmojiLikeUsers?(
    messageId: number,
    emojiId: string,
    count: number,
    offset?: number,
  ): Promise<{ users: { uin: number; uid: string; setAt: number }[]; cachedCount: number }>;

  /**
   * `get_msg_emoji_likes` — the ONE guarded member in this block.
   *
   *     if (!ctx.fetchEmojiLikeSummary) return failedResponse(100, "emoji reaction summary is unavailable")
   *
   * That exact wording is reproduced by the action, so a host without a reaction
   * store gets a documented failure rather than `[]`.
   */
  fetchEmojiLikeSummary?(messageId: number): Promise<unknown[]>;

  /**
   * `get_essence_msg_list` / `get_group_todo_list` — UNGUARDED.
   *
   * Writes the derived `messageId → meta` pairs into the message store so a later
   * `get_msg` / `set_group_reaction` on an essence or todo message finds a real
   * sequence. Without it both actions throw at the call.
   */
  cacheMessageMetas?(entries: readonly { messageId: number; meta: StoredMessageMeta }[]): Promise<void>;

  /**
   * `_mark_all_as_read` — GUARDED (`if (ctx.listReadSessions)`).
   *
   * Answers the split the batched read-report needs. The action's own fallback is
   * `failedResponse` when it is absent — see `extended.ts`.
   */
  listReadSessions?(): Promise<ReadSessions>;

  /**
   * `get_rkey` / `get_rkey_server` — GUARDED (`ctx.getDownloadRKeys ? ... : failed`).
   *
   * `ContactsApi.fetchDownloadRKeys` is the reference's provider; it is NOT
   * implemented in `ts/src/bridge/apis/contacts.ts` (its header lists it as
   * deliberately absent). Wiring it is one spec call — `FetchDownloadRkeys`, which is
   * ported — so this is the cheapest remaining gap in the batch.
   */
  getDownloadRKeys?(): Promise<DownloadRKey[]>;

  /**
   * `fetch_ptt_text` / `get_ptt_text` / `get_record_text` — UNGUARDED.
   *
   * Server-side speech-to-text for a voice message. Not implemented: the reference's
   * provider posts the record to a Tencent ASR endpoint whose request shape is not in
   * any ported module.
   */
  fetchPttText?(messageId: number): Promise<string | null>;

  /**
   * `get_online_clients` — read as `ctx.bridge.getOnlineClients()`, a BRIDGE member.
   *
   * Answers `null` until the bridge has observed a presence packet in this session,
   * which the action turns into
   * `online-client snapshot has not been observed in this session`. Declared on
   * `ActionBridge` below rather than here because that is where the reference reads
   * it.
   */
}

// ===========================================================================
// 4.5 — the extended (擴展) family: what the 115 actions additionally reach
// ===========================================================================
//
// The 115 `extended.ts` action bodies are measured, not guessed: each of the four
// blocks below is the set of `ctx.X` names the region actually reads. Splitting them
// by *who provides them* is the point — it is the difference between "this port has
// not wired it yet" and "the reference computes this in a module that exists here".
//
//   A. reachable today (this file's `ActionContext` already had them or gets them
//      here): getImageInfo / getRecordInfo.
//   B. reachable today, but provider-shaped: getGroupMsgHistory / getFriendMsgHistory
//      / forwardSingleMsg / sendForwardMsg / sendGroupForwardMsg /
//      sendPrivateForwardMsg / getForwardMsg / sendRawPacket.
//   C. needs a message store + reaction store (host-supplied): setEssenceMsg /
//      deleteEssenceMsg / setMsgEmojiLike / fetchEmojiLikeUsers /
//      fetchEmojiLikeSummary / cacheMessageMetas / listReadSessions /
//      getDownloadRKeys / fetchPttText / getOnlineClients.
//
// Every one of B and C is declared here as a REQUIRED or OPTIONAL member exactly as
// the reference's own presence tests demand (see each field's note). Declaring one
// as optional when the reference calls it unconditionally would make a missing store
// answer a plausible-looking empty value instead of throwing — the `(_ctx,_body)=>{}`
// failure mode MEMORY §2.3ad describes.

/**
 * `get_image` / `get_file` / `ocr_image` answer from the media cache.
 *
 * Reference: `buildApiContext`'s `getImageInfo` (reference:40030) resolves a
 * `file`/`file_id` against the bridge's uploaded/downloaded media metadata. Returning
 * `null` means "not in the cache", which each action turns into its own failure
 * wording — `get_image` says `image not found in cache`, `get_file` says the long
 * `file_id not found in the image/voice cache…` sentence, and `ocr_image` says
 * `ocr_image needs an http(s) image url or a cached image file_id…`.
 */
export interface MediaInfo {
  file: string;
  url: string;
  file_size: number;
  file_name: string;
}

/** The `getDownloadRKeys` result row, verbatim from `ContactsApi.fetchDownloadRKeys`. */
export interface DownloadRKey {
  rkey: string;
  ttlSeconds: number;
  storeId: number;
  createTime: number;
  type: number;
}

/**
 * The forward send results, and the one asymmetry worth naming.
 *
 * `sendForwardMsg` (upload only) answers `{ forwardId }` with NO `messageId` — the
 * reference's `uploadForwardMessage` returns `resId` alone. The three real senders
 * answer both. `upload_forward_msg` therefore hard-codes `message_id: 0` at the call
 * site rather than reading a field that does not exist.
 */
export interface ForwardUploadResult {
  forwardId: string;
}

export interface ForwardSendResult {
  messageId: number;
  forwardId: string;
}

/**
 * The forward preview block — the reference's `ForwardMeta`.
 *
 * Declared here rather than in `extended-helpers.ts` because it crosses the
 * context/hub boundary: the action BUILDS it and the provider RECEIVES it.
 * `news` is `{text}[]` and not `string[]` because the wire format wraps each line.
 */
export interface ForwardPreview {
  source?: string | undefined;
  summary?: string | undefined;
  prompt?: string | undefined;
  news?: { text: string }[] | undefined;
}

/** The reaction/receipt shapes `fetchEmojiLike*` return in the reference. */
export interface EmojiLikeUser {
  uin: number;
  uid: string;
  setAt: number;
}

export interface EmojiLikePage {
  users: EmojiLikeUser[];
  cachedCount: number;
  serverCount: number;
}

export interface EmojiLikeSummaryEntry {
  emoji_id: string;
  emoji_type: number;
  count: number;
  last_reaction_time: number;
  users: unknown[];
}

/** The read-session split `_mark_all_as_read` needs. */
export interface ReadSessions {
  groupIds: number[];
  privateUserIds: number[];
}

/** A handler: coerced params + context in, wire response out. */
export type ActionHandler<C = ActionContext> = (
  params: Record<string, unknown>,
  ctx: C,
) => ApiResponse | Promise<ApiResponse>;