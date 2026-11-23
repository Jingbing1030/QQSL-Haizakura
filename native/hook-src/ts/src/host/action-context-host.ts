// The production `ActionContext` host: a live `Bridge` + `MessageStore` turned into the
// object every OneBot action handler receives as `ctx`.
//
// ===========================================================================
// Why this file exists
// ===========================================================================
//
// `src/onebot/actions/context.ts` declares `interface ActionContext` (53 members, 20 of
// them required). Until this file existed **nothing implemented it** — verified with
//
//     grep -rn "implements ActionContext" ts/src   # no matches
//
// so the 42 compiled 4.1/4.2 actions (and the 115 擴展 actions behind them) were
// registry-tested and *unreachable*: `createOneBotApi` needs a context factory, and the
// only thing anyone could pass it was a `Proxy` that threw. A green registry test cannot
// tell "42 actions work" from "42 actions exist".
//
// This file is the missing wiring, and it is deliberately *only* wiring. Every member
// below either
//
//   (a) delegates to a ported `Bridge`/`apis` member, or
//   (b) is composed from `createActionMessageProviders` + `MessageStore` (the message
//       slice), or
//   (c) THROWS a named `HostNotImplementedError` naming the bridge-layer method that is
//       missing.
//
// (c) is the whole point. `context.ts`'s header states the failure mode it is guarding
// against — "a silent `{}` or `0` is the failure mode that makes a broken host look
// healthy" — and every action in the batch has a *documented fallback* for an ABSENT
// provider (`get_group_list` → `[]`, `get_group_info` → a ten-field zero object, …).
// Omitting a member therefore does not produce an error; it produces a plausible wrong
// answer. Declaring it and throwing produces `retcode 100` plus a message that names the
// real gap, which is the honest shape of "this port cannot do that yet".
//
// ===========================================================================
// What is implemented, and from what
// ===========================================================================
//
//   session      getLoginInfo   `parseInt(bridge.identity.uin, 10)` + the roster nickname
//                               (reference:39321 `getLoginInfo`)
//                isOnline       the BRIDGE's own liveness: a bound packet client and a
//                               session that has not been disposed. NOT the reference's
//                               `() => true` constant, because a `Bridge` with no
//                               attached sender can neither send nor receive.
//                getUptimeMs    `Bridge.getUptimeMs()` — added to `bridge.ts` for this
//                               (reference:342790 `Date.now() - this.startedAt`)
//
//   message      getMessage / getMessageMeta / sendGroupMessage / sendPrivateMessage
//                               straight from `createActionMessageProviders`
//                deleteMessage  adapted: the provider answers `boolean`, the context
//                               declares `void` (see `#deleteMessage`)
//                refreshMessageMedia
//                               adapted: the provider answers `RefreshMediaResult`, the
//                               context declares `void`. Media/Highway is absent, so the
//                               result is inspected and an event that actually carries
//                               media THROWS `MEDIA_REFRESH_UNSUPPORTED_REASON` rather
//                               than answering the event with stale URLs.
//
//   roster       getFriendList / getGroupList / getGroupInfo / getGroupMemberList /
//                getGroupMemberInfo / getStrangerInfo
//                               the reference's own providers (reference:39337-39578),
//                               transcribed against `apis.contacts` + `identity`
//
//   files        getGroupFiles  `formatGroupFiles(bridge.apis.groupFile, …)`
//
//   essence      setEssenceMsg / deleteEssenceMsg
//                               `MessageStore.getMeta` + `apis.interaction.setEssence`
//                               (reference:38218 `setEssenceMessage`)
//
//   metas        cacheMessageMetas
//                               `MessageStore.insert(messageId, {meta})`
//
// ===========================================================================
// What is NOT implemented, and the exact missing dependency
// ===========================================================================
//
// Each of these throws. The list is the port's remaining action-layer debt, and every
// entry names a module that does not exist here — none is "hard", all are "absent":
//
//   getForwardMsg / sendForwardMsg / sendGroupForwardMsg / sendPrivateForwardMsg /
//   forwardSingleMsg
//       `bridge/apis/forward.ts` — the `SsoRecvLongMsg` decoder and the Highway forward
//       uploader. Media/Highway is not available in this port at all.
//
//   (getGroupMsgHistory / getFriendMsgHistory are now IMPLEMENTED — they delegate to
//   `host/msg-history.ts`, which converts through `bridge/event-converters.ts`.)
//
//   getImageInfo / getRecordInfo
//       `mediaStore` + `imageUrlResolver`. There is no image/voice cache, so there are
//       no cached file ids to resolve.
//
//   (handleGroupRequest / handleGetGroupSystemMsg are now IMPLEMENTED — they delegate
//   to `host/group-request.ts`.)
//
//   setMsgEmojiLike / fetchEmojiLikeUsers / fetchEmojiLikeSummary
//       `ReactionStore`. Without it `fetch_emoji_like`'s `isLastPage` comparison has no
//       cache to read and `set_msg_emoji_like` would send a reaction the summary can
//       never see. Sending half the operation and reporting success is the failure mode
//       `context.ts:1521` describes, so all three throw.
//
//   (listReadSessions is now IMPLEMENTED — `MessageStore.listReadSessions` derives the
//   session list by scanning the rows it holds.)
//
//   getDownloadRKeys
//       `ContactsApi.fetchDownloadRKeys`. The OIDB spec (`FetchDownloadRkeys`, 0x9067
//       sub 202) IS ported; the bridge-layer wiring is not.
//
//   fetchPttText
//       the Tencent ASR request shape. No ported module posts a record for transcription.
//
// ===========================================================================
// `canSendImage` / `canSendRecord` are deliberately ABSENT
// ===========================================================================
//
// The reference answers `true` for both (reference:40044-40045). This port cannot: an
// image/record/video segment needs `SendContext.uploadMedia`
// (`element-builder.ts:1905`, `:1932`, `:1952`), which is the NTV2 Highway uploader and
// does not exist here — so a `send_group_msg` with an image throws
// `'message element "image" requires SendContext'`. Declaring `canSendImage: () => true`
// would make the capability probe lie about the send path. The actions' own fallback is
// `ctx.canSendImage?.() ?? false`, which is the truthful answer, so the members are
// omitted rather than implemented as a constant.
//
// ===========================================================================
// `apis` is an explicit COMPOSITION, not a cast
// ===========================================================================
//
// `PortedApiHub` does not satisfy `ActionApiHub` (verified: `tsc` rejects the direct
// assignment on five slices). Three of those are real defects in `context.ts`'s declared
// contract, reported in this file's `#buildApiHub` rather than papered over with
// `as unknown as`, and two are void/array adaptations that compose exactly.

import { Bridge } from "../bridge/bridge.js";
import type { ClientKey } from "../bridge/context.js";
import { DATALINE_DEVICES, findDatalineDeviceByUin } from "../bridge/apis/dataline.js";
import type { PortedApiHub } from "../bridge/apis/index.js";
import type { RosterGroup, RosterMember, RosterProfile } from "../bridge/apis/contacts.js";
import { createLogger } from "../onebot/log.js";
import {
  forwardSingleMessage,
  getForwardMessage,
  sendGroupForwardMessage,
  sendPrivateForwardMessage,
  uploadForwardMessage,
  type ForwardOrchestrationContext,
  type SendReceipt,
} from "./forward-send.js";
import type {
  ActionApiHub,
  ActionBridge,
  ActionFriendInfo,
  ActionGroupInfo,
  ActionGroupMemberInfo,
  ActionIdentity,
  ActionUploadedFileMeta,
  ActionUserProfile,
  ActionContext,
  DownloadRKey,
  ForwardPreview,
  ForwardResourceId,
  ForwardSendResult,
  ForwardUploadResult,
  LoginInfo,
  MediaInfo,
  OnlineClientSnapshot,
  FilteredGroupRequestRow,
  ReadSessions,
  StoredMessageMeta,
} from "../onebot/actions/context.js";
import {
  formatFriend,
  formatGroupMember,
  formatStrangerInfo,
  cachedQidianProfile,
} from "../onebot/actions/format.js";
import { formatGroupFiles } from "../onebot/actions/group-file.js";
import { hasAuthoritativeSequence } from "../onebot/actions/message-id.js";
import {
  formatGroupRequestFlag,
  parseGroupRequestFlag,
} from "../oidb/services/index.js";
import { createOneBotApi, createIdleOneBotApi } from "../onebot/api.js";
import { OneBotNetworkManager, type OneBotConfigLike } from "../onebot/manager.js";
import type { OneBotApi, OneBotNetworkContext } from "../onebot/types.js";
import {
  createActionMessageProviders,
  MEDIA_REFRESH_UNSUPPORTED_REASON,
  type ActionMessageProviders,
} from "./action-message-providers.js";
import { MessageStore } from "./message-store.js";
import { MediaStore } from "./media-store.js";
import { resolveImageUrl, resolveRemoteMediaUrl, type ResolveImageUrl } from "./media-url-resolver.js";
import {
  createMessageIdResolver,
  getFriendHistory,
  getGroupHistory,
  type HistoryContext,
} from "./msg-history.js";
import type { ConverterContext } from "../bridge/event-converters.js";
import {
  getGroupSystemMessages,
  handleGroupAddRequest,
  type GroupRequestContext,
} from "./group-request.js";
import { ReactionStore, emojiTypeFor } from "./reaction-store.js";

const log = createLogger("Host.ActionContext");

/** Group detail (level / non-member info) TTL — reference:39371 `GROUP_LEVEL_TTL_MS`. */
const GROUP_LEVEL_TTL_MS = 300 * 1_000;
/** Non-member group cache TTL — reference:39386 `NON_MEMBER_GROUP_TTL_MS`. */
const NON_MEMBER_GROUP_TTL_MS = 300 * 1_000;
/** reference:343189 `OneBotInstance.HEARTBEAT_INTERVAL`. */
const HEARTBEAT_INTERVAL_MS = 30_000;

// ===========================================================================
// The two failure types
// ===========================================================================

/**
 * Thrown by a context member whose bridge-layer dependency does not exist in this port.
 *
 * A distinct class rather than a bare `Error` so a caller (and a test) can tell "this
 * host cannot do that yet" apart from "the server said no" without matching on wording.
 * `dispatchAction` maps it to `retcode 100` with the message intact, which is what an
 * OneBot client sees.
 */
export class HostNotImplementedError extends Error {
  /** The `ActionContext` member that threw. */
  readonly member: string;

  constructor(member: string, missing: string) {
    super(`${member} is not implemented by this host: ${missing}`);
    this.name = "HostNotImplementedError";
    this.member = member;
  }
}

/**
 * Thrown when the bridge/roster state exists but cannot be narrowed onto the action
 * layer's declared shape without inventing a value.
 *
 * Distinct from `HostNotImplementedError` on purpose: "the member is missing" and "the
 * member returned something that does not satisfy its contract" are different bugs, and
 * a silent coercion (a `0`, an `""`, an empty array) would hide the second.
 */
export class HostContractError extends Error {
  readonly member: string;

  constructor(member: string, detail: string) {
    super(`${member} cannot be satisfied by the current session state: ${detail}`);
    this.name = "HostContractError";
    this.member = member;
  }
}

function notImplemented(member: string, missing: string): never {
  throw new HostNotImplementedError(member, missing);
}

// ===========================================================================
// 1. The identity adapter
// ===========================================================================
//
// `BridgeIdentity` is NOT assignable to `ActionIdentity`, and the reason is worth stating
// rather than casting away: `ActionGroupInfo.members` is
// `Map<number, ActionGroupMemberInfo>` while `GroupInfo.members` is
// `Map<number, GroupMemberInfo>`, and `ActionGroupMemberInfo` additionally requires
// `level` and `title` — the two fields the 4.1 batch needs and the bridge roster row does
// not declare. (Verified: `Type 'GroupInfo' is not assignable to type 'ActionGroupInfo'`.)
//
// The rows `ContactsApi.fetchGroupMemberList` remembers ARE `RosterMember`s
// (`ActionGroupMemberInfo & GroupMemberInfo`), so `level`/`title` are present at runtime;
// they are simply not visible through `GroupMemberInfo`'s static type. `readNumberMember`
// reads them through `Reflect.get` — the honest form of "the row may carry this field" —
// with the same `0` / `""` defaults `contacts.ts:722`'s `toActionGroupMember` already
// uses. A hand-built roster row therefore degrades exactly as it does there.

function readMemberNumber(row: object, field: string): number {
  const value = Reflect.get(row, field);
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function readMemberText(row: object, field: string): string {
  const value = Reflect.get(row, field);
  return typeof value === "string" ? value : "";
}

function toActionGroupMember(row: ActionGroupMemberInfo): ActionGroupMemberInfo {
  // Already the action shape: this overload exists for `RosterMember` rows.
  return row;
}

function narrowGroupMember(row: import("../bridge/context.js").GroupMemberInfo): ActionGroupMemberInfo {
  return {
    uin: row.uin,
    uid: row.uid,
    nickname: row.nickname,
    card: row.card,
    role: row.role,
    level: readMemberNumber(row, "level"),
    title: readMemberText(row, "title"),
    joinTime: row.joinTime,
    lastSentTime: row.lastSentTime,
    shutUpTime: row.shutUpTime,
    isRobot: row.isRobot,
  };
}

/**
 * The five group fields `GroupInfo` does not declare, read with the reference's own
 * `??` defaults.
 *
 * `BridgeIdentity.groups` is typed `readonly GroupInfo[]`, and `GroupInfo` declares only
 * `groupId`/`groupName`/`remark`/`memberCount`/`memberMax`/`members`. The rows
 * `ContactsApi.fetchGroupList` actually remembers are `RosterGroup`s
 * (`contacts.ts:190` — an intersection that DOES carry these five), so the values exist
 * at runtime and are simply invisible through the bridge's static type.
 *
 * `Reflect.get` is the honest way to say "the row may carry this field": it neither
 * asserts a type nor fabricates one. Each default is copied from the reference's own
 * `??` (`getGroupList`, reference:39357), so a hand-built `MemoryIdentity` row — which
 * carries none of them — degrades to exactly the values the reference produces for the
 * same row: `0`, `0`, `""`, `""`, `false`.
 */
function groupExtras(group: import("../bridge/context.js").GroupInfo): {
  createTime: number;
  level: number;
  memo: string;
  description: string;
  allMuted: boolean;
} {
  const createTime = Reflect.get(group, "createTime");
  const level = Reflect.get(group, "level");
  const memo = Reflect.get(group, "memo");
  const description = Reflect.get(group, "description");
  const allMuted = Reflect.get(group, "allMuted");
  return {
    createTime: typeof createTime === "number" && Number.isFinite(createTime) ? createTime : 0,
    level: typeof level === "number" && Number.isFinite(level) ? level : 0,
    memo: typeof memo === "string" ? memo : "",
    description: typeof description === "string" ? description : "",
    allMuted: allMuted === true,
  };
}

function narrowGroup(group: import("../bridge/context.js").GroupInfo): ActionGroupInfo {
  return {
    groupId: group.groupId,
    groupName: group.groupName,
    remark: group.remark,
    memberCount: group.memberCount,
    memberMax: group.memberMax,
    ...groupExtras(group),
    // `exactOptionalPropertyTypes` distinguishes "absent" from "present but undefined",
    // and `GroupInfo.members` is optional, so an absent map stays absent rather than
    // becoming `undefined` by construction.
    ...(group.members === undefined
      ? {}
      : { members: new Map([...group.members].map(([uin, member]) => [uin, narrowGroupMember(member)])) }),
  };
}

/**
 * `ActionIdentity` over a live `BridgeIdentity`.
 *
 * A class with getters (not a spread) because `nickname` is MUTABLE on the action
 * interface — the roster's nickname changes when the profile is refreshed, and a snapshot
 * would freeze it at construction time.
 */
export class BridgeActionIdentity implements ActionIdentity {
  readonly #identity: Bridge["identity"];

  constructor(identity: Bridge["identity"]) {
    this.#identity = identity;
  }

  get uin(): string {
    return this.#identity.uin;
  }

  get nickname(): string {
    return this.#identity.nickname;
  }

  set nickname(value: string) {
    this.#identity.nickname = value;
  }

  get selfUid(): string | null {
    return this.#identity.selfUid;
  }

  get groups(): readonly ActionGroupInfo[] {
    return this.#identity.groups.map(narrowGroup);
  }

  findGroup(groupId: number): ActionGroupInfo | null {
    const group = this.#identity.findGroup(groupId);
    return group === null ? null : narrowGroup(group);
  }

  findGroupMember(groupId: number, uin: number): ActionGroupMemberInfo | null {
    const member = this.#identity.findGroupMember(groupId, uin);
    return member === null ? null : narrowGroupMember(member);
  }

  findFriend(uin: number): ActionFriendInfo | null {
    return this.#identity.findFriend(uin);
  }

  findUserProfile(uin: number): ActionUserProfile | null {
    const profile = this.#identity.findUserProfile(uin);
    if (profile === null) return null;
    // `UserProfile` extends `SelfProfile`; the action type additionally allows the
    // optional profile-extension fields, so the roster row is already a valid value.
    return { ...profile, sex: String(profile.sex) };
  }

  findUinByUid(uid: string, groupId?: number): number | null {
    return this.#identity.findUinByUid(uid, groupId);
  }

  forgetGroup(groupId: number): void {
    this.#identity.forgetGroup(groupId);
  }

  rememberGroups(groups: readonly ActionGroupInfo[]): void {
    // `ActionGroupInfo` → `GroupInfo` is NOT assignable: the action row's `members` is a
    // `Map<number, ActionGroupMemberInfo>` (whose `role` permits `"admin"` and whose
    // `isRobot` is optional), while the identity's is a `Map<number, GroupMemberInfo>`.
    // A cast here would be a lie the compiler could not check, so map explicitly and
    // drop the action-only knobs.
    this.#identity.rememberGroups(
      groups.map((group) => ({
        groupId: group.groupId,
        groupName: group.groupName,
        remark: group.remark,
        memberCount: group.memberCount,
        memberMax: group.memberMax,
        ...(group.members === undefined
          ? {}
          : {
              members: new Map(
                [...group.members].map(([uin, member]) => [
                  uin,
                  {
                    uin: member.uin,
                    uid: member.uid,
                    nickname: member.nickname,
                    card: member.card,
                    role: member.role,
                    joinTime: member.joinTime,
                    lastSentTime: member.lastSentTime,
                    shutUpTime: member.shutUpTime,
                    // `GroupMemberInfo.isRobot` is optional; forward it only when
                    // known, so "not classified" stays distinct from `false`.
                    ...(member.isRobot === undefined ? {} : { isRobot: member.isRobot }),
                  },
                ]),
              ),
            }),
      })),
    );
  }

  rememberGroupMembers(groupId: number, members: readonly ActionGroupMemberInfo[]): void {
    this.#identity.rememberGroupMembers(
      groupId,
      members.map((member) => ({
        uin: member.uin,
        uid: member.uid,
        nickname: member.nickname,
        card: member.card,
        role: member.role,
        joinTime: member.joinTime,
        lastSentTime: member.lastSentTime,
        shutUpTime: member.shutUpTime,
        ...(member.isRobot === undefined ? {} : { isRobot: member.isRobot }),
      })),
    );
  }

  rememberUserProfile(profile: ActionUserProfile): void {
    this.#identity.rememberUserProfile({
      uin: profile.uin,
      uid: profile.uid,
      nickname: profile.nickname,
      remark: profile.remark,
      qid: profile.qid,
      sex: profile.sex === "male" ? "male" : profile.sex === "female" ? "female" : "unknown",
      age: profile.age,
      sign: profile.sign,
      avatar: profile.avatar,
      level: profile.level,
      qidianMasterFlag: profile.qidianMasterFlag,
      qidianCrewFlag: profile.qidianCrewFlag,
      qidianCrewFlag2: profile.qidianCrewFlag2,
    });
  }
}

// ===========================================================================
// 2. The `apis` composition
// ===========================================================================

/**
 * `PortedApiHub` → `ActionApiHub`, explicitly.
 *
 * Five slices do not line up, and each is handled for its own reason:
 *
 *   groupAdmin  `setRemark` is declared on `ActionGroupAdminApi` but absent from
 *               `GroupAdminApi` (`group-admin.ts`'s header says so: "no action in this
 *               port reaches them, so they are omitted"). The `0xf16_1` `SetGroupRemark`
 *               spec IS ported, so this is one bridge-layer method away — but writing it
 *               here would put OIDB serialisation in the host, so it throws and is
 *               reported.
 *
 *   web         `ActionWebApi.getCredentials` declares a FIVE-field payload
 *               (`{cookies, bkn, skey, pskey, clientKey}`); `WebApi.getCredentials`
 *               returns the reference's THREE (`{cookies, token, csrf_token}`,
 *               reference:339034). This is a defect in `context.ts`'s declaration, not a
 *               missing implementation: every other member of the slice forwards
 *               unchanged. Throwing keeps `get_credentials` from answering a shape no
 *               client can read (`bkn` would be `undefined`) — see the report note.
 *
 *   profile     `setGroupAvatar` is required by `ActionProfileApi` and omitted from
 *               `ProfileApi` because it needs the Highway uploader AND a hand-encoded
 *               `GroupAvatarExtra` blob (`profile.ts` header). Throws.
 *
 *   collection  `ActionCollectionApi.list` declares `Promise<Record<string, unknown>[]>`;
 *               `CollectionApi.list` returns the reference's single
 *               `CollectionListResult` object (`{errCode, errMsg, collectionSearchList}`).
 *               Another declaration defect — the reference action passes the object
 *               through. Throws.
 *
 *   groupFile   `trans` returns `{saveBusId, saveFilePath}` where the context declares
 *               `void`. Adapted with an explicit `async` wrapper that AWAITS and discards,
 *               exactly like `deleteMessage` below: the packet is still sent, and the
 *               action's contract is genuinely `void` (`trans_group_file` answers
 *               `okResponse(await …)` with nothing meaningful).
 *
 *   qzone       `getMsgList` returns the `QzoneMsgList` interface, which has no index
 *               signature and is therefore not assignable to `Record<string, unknown>`.
 *               Re-spread into a fresh object literal: same fields, no information lost.
 */
function buildActionApiHub(hub: PortedApiHub): ActionApiHub {
  return {
    contacts: hub.contacts,

    // `Object.assign` onto a forwarding Proxy, NOT `{...hub.groupAdmin}`. A spread copies
    // only OWN properties, and every `GroupAdminApi` method lives on the prototype — so a
    // spread would silently produce a slice with exactly one member (`setRemark`) and
    // `ctx.bridge.apis.groupAdmin.kickMember` would be `undefined`. `delegate` forwards
    // every read to the real instance and overrides only the named members.
    groupAdmin: delegate<ActionApiHub["groupAdmin"]>(hub.groupAdmin, {
      // 🔴 `GroupAdminApi` does not declare this. The `0xf16_1` `SetGroupRemark` spec IS
      // ported (`oidb/services/0xf16.ts`), so this is one bridge-layer method away — but
      // writing the OIDB serialisation here would put protocol code in the host, so it
      // refuses with a name instead of answering.
      setRemark: (): Promise<void> =>
        Promise.reject(
          new HostNotImplementedError(
            "bridge.apis.groupAdmin.setRemark",
            "GroupAdminApi does not declare setRemark (the 0xf16_1 SetGroupRemark spec is " +
              "ported in oidb/services/0xf16.ts; the bridge-layer method was never added)",
          ),
        ),
    }),

    web: delegate<ActionApiHub["web"]>(hub.web, {
      // 🔴 A DECLARATION DEFECT, not a missing implementation. `ActionWebApi.getCredentials`
      // declares `{cookies, bkn, skey, pskey, clientKey}`; `WebApi.getCredentials` returns
      // the reference's `{cookies, token, csrf_token}` (reference:339034). Both cannot be
      // answered — a five-field object here would carry four `undefined`s, which is exactly
      // the "plausible-looking empty value" this file refuses. Reported, and refused.
      getCredentials: (): Promise<{
        cookies: string;
        bkn: string;
        skey: string;
        pskey: string;
        clientKey: string;
      }> =>
        Promise.reject(
          new HostContractError(
            "bridge.apis.web.getCredentials",
            "ActionWebApi declares {cookies, bkn, skey, pskey, clientKey} but " +
              "WebApi.getCredentials returns the reference's {cookies, token, csrf_token}; " +
              "answering the declared shape would report four undefined credentials",
          ),
        ),
    }),

    profile: delegate<ActionApiHub["profile"]>(hub.profile, {
      // 🔴 Needs the Highway uploader AND a hand-encoded `GroupAvatarExtra` blob; neither
      // exists in this port (profile.ts header).
      setGroupAvatar: (): Promise<void> =>
        Promise.reject(
          new HostNotImplementedError(
            "bridge.apis.profile.setGroupAvatar",
            "needs the Highway upload channel and a hand-encoded GroupAvatarExtra blob, " +
              "neither of which exists in this port (profile.ts header)",
          ),
        ),
    }),

    qzone: delegate<ActionApiHub["qzone"]>(hub.qzone, {
      // `QzoneMsgList` is an interface with no index signature, so it is not assignable to
      // the `Record<string, unknown>` the action layer declares. Re-spread into a fresh
      // literal: same own fields, nothing added or dropped.
      getMsgList: async (
        ...args: Parameters<PortedApiHub["qzone"]["getMsgList"]>
      ): Promise<Record<string, unknown>> => ({ ...(await hub.qzone.getMsgList(...args)) }),
    }),

    collection: delegate<ActionApiHub["collection"]>(hub.collection, {
      // 🔴 A DECLARATION DEFECT. `ActionCollectionApi.list` declares
      // `Record<string, unknown>[]`; `CollectionApi.list` returns the reference's single
      // `CollectionListResult` object (`{errCode, errMsg, collectionSearchList}`) and
      // `get_collection_list` passes it through. Returning an array here would change the
      // response, so the mismatch is refused.
      list: (): Promise<Record<string, unknown>[]> =>
        Promise.reject(
          new HostContractError(
            "bridge.apis.collection.list",
            "ActionCollectionApi declares Record<string, unknown>[] but CollectionApi.list " +
              "returns the reference's single CollectionListResult object; returning an " +
              "array would change the response get_collection_list produces",
          ),
        ),
    }),

    groupFile: delegate<ActionApiHub["groupFile"]>(hub.groupFile, {
      // EXPLICIT ADAPTATION, not a cast: the context declares `Promise<void>`, the bridge
      // answers the save location (`{saveBusId, saveFilePath}`). Awaiting and discarding
      // keeps the packet on the wire — which is what `trans_group_file` is for — without
      // claiming a value the action layer never reads. (`trans_group_file`'s body is
      // `okResponse(await ctx.bridge.apis.groupFile.trans(...))`, i.e. `data: undefined`.)
      trans: async (groupId: number, fileId: string): Promise<void> => {
        await hub.groupFile.trans(groupId, fileId);
      },
    }),

    groupAlbum: hub.groupAlbum,
    interaction: hub.interaction,
    friend: hub.friend,
    systemFace: hub.systemFace,
    message: hub.message,
    misc: notImplementedSlice<ActionApiHub["misc"]>(
      "misc",
      "OidbMiscApi — 4 of 9 members need codecs absent from oidb/services/",
    ),
    // `extras` is a REAL slice now: `ExtrasApi` implements every member
    // `ActionExtrasApi` declares except `convertRecord` (which rejects with a named
    // error, not a TypeError) — including `sendAiVoice`'s receipt wait, because the
    // BRIDGE owns the event bus and needs no host injection for it. Forwarded directly
    // rather than through `delegate`: nothing has to be overridden, and the old
    // throwing proxy would have made `send_group_ai_record` fail as "not implemented"
    // on a hub that works.
    extras: hub.extras,
    // `flashTransfer` is a REAL slice — all twelve members (`apis/flash-transfer.ts`).
    // Forwarded directly for the same reason `extras` is: the flash actions
    // (`get_fileset_info`, `list_filesets`, `get_share_link`, `create_flash_task`, …)
    // must reach the transport, not be reported as "not implemented" on a hub that
    // works.
    //
    // `createFlashTask` runs the whole uploader in the BRIDGE — staging, hashing,
    // apply/commit/complete, slice uploads and the two placeholder thumbnails — and
    // throws on any failure. Nothing is overridden here, so `create_flash_task` answers
    // the real `fileset_id` the server assigned.
    flashTransfer: hub.flashTransfer,
  };
}

/**
 * `BridgeIdentity` → `ActionMessageIdentity` — the reply/quote resolution slice.
 *
 * The two differ in ONE place, and it is a real distinction rather than a typing
 * accident: the provider's `findGroupMember`/`findFriend` answer `undefined` for "not in
 * the roster", while `BridgeIdentity` answers `null`. `undefined | X` and `null | X` are
 * not interchangeable under `exactOptionalPropertyTypes`, and the provider's own
 * `??`/truthiness checks would treat the two the same — but a `null` returned through a
 * `?:`-typed member is a different value to a caller that distinguishes them. Mapping at
 * the boundary keeps each side's contract intact rather than coercing one to the other.
 */
function toMessageIdentity(identity: Bridge["identity"]): import("./action-message-providers.js").ActionMessageIdentity {
  return {
    uin: identity.uin,
    findUidByUin: (uin, groupId) => identity.findUidByUin(uin, groupId),
    findGroupMember: (groupId, uin) => identity.findGroupMember(groupId, uin) ?? undefined,
    findFriend: (uin) => identity.findFriend(uin) ?? undefined,
    resolveUid: (uin, groupId) => identity.resolveUid(uin, groupId),
  };
}

/**
 * A hub slice that FORWARDS to a real API instance and overrides only the named members.
 *
 * The alternative — `{ ...hub.slice, override }` — is the bug this exists to prevent: a
 * spread copies own enumerable properties only, and every method on these API classes is
 * on the PROTOTYPE. The spread would type-check (`ActionApiHub`'s members are all methods,
 * and a partial object literal is not assignable… except that `GroupAdminApi`'s members
 * happen to make the error visible only because of the override) and then fail at the
 * first call with `undefined is not a function`.
 *
 * `get` forwards to the target, so a member this file does not mention keeps working, and
 * `has`/`ownKeys` are forwarded so `in` and `Object.keys` describe the real object.
 *
 * ---------------------------------------------------------------------------
 * Why a method is REBOUND to the target instead of returned verbatim
 * ---------------------------------------------------------------------------
 * A Proxy is a *distinct* object. `Reflect.get(target, "kickMember", receiver)` reads the
 * method off the prototype, but the caller then invokes it with `this === <the Proxy>`, and
 * every API class in `bridge/apis/` keeps its dependency in an ECMAScript **private** field:
 *
 *     export class GroupAdminApi { readonly #ctx: BridgeContext; … }   // group-admin.ts:205
 *     export class QzoneApi      { … this.#ctx … }                     // qzone.ts
 *     export class ProfileApi    { … this.#ctx … }                     // profile.ts
 *     export class GroupFileApi  { … this.#ctx … }                     // group-file.ts
 *
 * Private fields are BRAND-CHECKED, so the call dies before reaching any bridge code:
 *
 *     TypeError: Cannot read private member #ctx from an object whose class did not
 *                declare it
 *
 * (measured against `qzone.getFeeds`, `profile.fetchCustomFace` —
 * `TypeError: Receiver must be an instance of class QzoneApi` —, `groupFile.*` and every
 * `groupAdmin.*` method). That failure is invisible to `tsc` and to a test that only
 * asserts `typeof slice.method === "function"`, which is exactly what this file's own
 * test suite did before the fix: four of the six composed slices could not execute a
 * single method. `bound` is therefore load-bearing, not tidiness — it makes `this` the
 * real instance, so the brand check passes.
 *
 * `reflectGet` is the honest way to read a prototype method through a `ProxyHandler`: the
 * built-in `Reflect.get` is typed for the object overload, not for the receiver form, and
 * this repo's `strict` config rejects `Reflect.get(target, key, receiver)`.
 */
function delegate<T extends object>(target: object, overrides: Record<string, unknown>): T {
  const reflectGet = Reflect.get as (source: object, property: PropertyKey, receiver: unknown) => unknown;
  /** Bind every function found on the target, so `this` is the real instance. */
  const bound = (value: unknown): unknown =>
    typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  return new Proxy(target, {
    get(source, property, receiver) {
      if (Object.hasOwn(overrides, property)) return overrides[property as string];
      // Overrides above are this file's own arrow functions and must NOT be rebound: they
      // close over `hub` lexically and some are async wrappers that discard a value.
      return bound(reflectGet(source, property, receiver));
    },
    has: (source, property) => Object.hasOwn(overrides, property) || Reflect.has(source, property),
  }) as T;
}

/**
 * A hub slice whose *property read* throws.
 *
 * `ActionApiHub` declares `misc` as required, and the real hub routes it through this
 * proxy. Returning a Proxy keeps the compile-time obligation satisfied while making
 * `ctx.bridge.apis.misc.ocrImage(...)` fail with a name instead of
 * `Cannot read properties of undefined` — and, unlike a stub object, it cannot
 * accidentally answer.
 *
 * Two slices USED to be routed through here and no longer are:
 *
 *   `extras`         `ExtrasApi` exists and implements every member but
 *                    `convertRecord`, which rejects by name. Keeping the proxy would
 *                    have made `send_group_ai_record` — a working action — report
 *                    "not implemented".
 *   `flashTransfer`  `FlashTransferApi` exists (`apis/flash-transfer.ts`) with all
 *                    twelve members, the uploader included, so nothing in the slice is
 *                    missing — a proxy here would be a lie about a working slice.
 */
function notImplementedSlice<T extends object>(slice: string, missing: string): T {
  const boom = (): never => notImplemented(`bridge.apis.${slice}`, missing);
  return new Proxy({} as T, {
    get: (_target, property) => {
      // `then` must stay undefined so this is not mistaken for a thenable by `await`.
      if (property === "then") return undefined;
      return boom;
    },
    has: () => true,
  });
}

// ===========================================================================
// 3. The host
// ===========================================================================

/** What the host is built from. Every member is real session state. */
export interface BridgeActionContextHostOptions {
  /** The live bridge. Owns `identity`, `apis`, receive health and the packet transport. */
  readonly bridge: Bridge;
  /** The in-memory message table. Defaults to a fresh store. */
  readonly store?: MessageStore | undefined;
  /** The reaction cache. Defaults to a fresh store. */
  readonly reactionStore?: ReactionStore | undefined;
  /**
   * The durable media index behind `getImageInfo` / `getRecordInfo`.
   *
   * OPTIONAL, and absent means "no media cache": both members then answer `null`, which
   * every caller already reads as "not in the cache" — `get_image` says `image not found
   * in cache` and `download_file_stream` falls through to its not-found wording.
   *
   * Defaulting to a fresh `MediaStore(":memory:")` would be WRONG even though it would
   * make the members always answer: a `MediaStore` owns a database handle, and a host that
   * did not ask for one must not create state as a side effect. The production path is
   * `data/<uin>/messages.db` (reference:342767), which the caller supplies.
   */
  readonly mediaStore?: MediaStore | undefined;
  /**
   * The image-URL resolver — the reference's `converterCtx.imageUrlResolver`
   * (reference:342774), i.e. `(element, isGroup) => rkeyCache.resolveImageUrl(...)`.
   *
   * Absent is the NORMAL state in this port: there is no rkey cache, so a cached image
   * URL is answered verbatim. See `getImageInfo` for why a fabricated resolver would be
   * worse than none.
   */
  readonly imageUrlResolver?: ResolveImageUrl | null | undefined;
  /**
   * The message providers. Defaults to `createActionMessageProviders` over
   * `bridge.apis.message` + the store. Injectable so a test can record the exact
   * `Segment[]` handed to the transport.
   */
  readonly messageProviders?: ActionMessageProviders | undefined;
}

/**
 * The production `ActionContext`.
 *
 * Construct once per session; the object is stateless apart from the two TTL caches the
 * reference also keeps at module scope, so sharing it across the lifetime of a bridge is
 * the intended use (`buildApiContext(ref)` is likewise built once per instance,
 * reference:40032).
 */
export class BridgeActionContextHost implements ActionContext {
  readonly bridge: ActionBridge;
  readonly #session: Bridge;
  readonly #store: MessageStore;
  /**
   * The `message_id` hash the converter and every stored id are built on.
   *
   * Built once from `#store` because the resolver closes over the store and never over
   * the identity — `selfId` is a per-call argument. See `createMessageIdResolver`
   * (reference:41254) for the three-way rule it implements, including the
   * `private_message_sent` → `private_message_nt` remap that keeps a bot's own
   * outgoing message from hashing to two different ids.
   */
  readonly #messageIdResolver: NonNullable<ConverterContext["messageIdResolver"]>;
  /** Cached reactions. Volatile: see reaction-store.ts's header for what that costs. */
  readonly #reactions: ReactionStore;
  readonly #message: ActionMessageProviders;
  /** The durable media index, or `null` when the caller supplied none. */
  readonly #media: MediaStore | null;
  /** The image-URL resolver, or `null` — see `BridgeActionContextHostOptions`. */
  readonly #imageUrl: ResolveImageUrl | null;
  #disposed = false;

  constructor(options: BridgeActionContextHostOptions) {
    this.#session = options.bridge;
    this.#store = options.store ?? new MessageStore();
    this.#messageIdResolver = createMessageIdResolver(this.#store);
    this.#reactions = options.reactionStore ?? new ReactionStore();
    this.#media = options.mediaStore ?? null;
    this.#imageUrl = options.imageUrlResolver ?? null;
    this.#message =
      options.messageProviders ??
      createActionMessageProviders({
        messageApi: this.#session.apis.message,
        store: this.#store,
        identity: toMessageIdentity(this.#session.identity),
        // The upload-metadata cache, so a private `file` segment can be sent from an
        // id alone (reference:38422 — `fileEl.fileId` reads `recallUploadedFile`).
        // Bound to the SAME method `ActionBridge.recallUploadedFile` below uses, so
        // the two readers cannot disagree about a row's shape.
        recallUploadedFile: (fileId: string) => this.#recallUploadedFile(fileId),
        // No `resolveMedia`: media/Highway is absent. The provider then answers
        // `{status: "unsupported", reason: MEDIA_REFRESH_UNSUPPORTED_REASON}`, which
        // `#refreshMessageMedia` turns into a throw when there is media to refresh.
      });
    const identity = new BridgeActionIdentity(this.#session.identity);
    this.bridge = {
      identity,
      apis: buildActionApiHub(this.#session.apis),
      // Real liveness, not a constant: `Bridge.receiveHealthy` is true only while some
      // bound PID reports a healthy receive path.
      get receiveHealthy(): boolean {
        return options.bridge.receiveHealthy;
      },
      getOnlineClients: (): OnlineClientSnapshot[] | null => this.#onlineClients(),
      sendRawPacket: (wireName, request, timeoutMs) =>
        timeoutMs === undefined
          ? this.#session.sendRawPacket(wireName, request)
          : this.#session.sendRawPacket(wireName, request, timeoutMs),
      recallUploadedFile: (fileId) => this.#recallUploadedFile(fileId),
    };
  }

  /** The message table this host reads and writes. Exposed for a host that feeds it. */
  get store(): MessageStore {
    return this.#store;
  }

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  /**
   * reference:39321 `getLoginInfo`.
   *
   * `parseInt(uin, 10) || 0` and `nickname || uin` are the reference's own coercions: a
   * bridge with a non-numeric uin answers `userId: 0` rather than `NaN`, and an empty
   * nickname degrades to the uin rather than `""`.
   */
  getLoginInfo(): LoginInfo {
    const uin = this.#session.identity.uin;
    return {
      userId: Number.parseInt(uin, 10) || 0,
      nickname: this.#session.identity.nickname || uin,
    };
  }

  /**
   * Whether this session is online — a BRIDGE fact, not a constant.
   *
   * The reference hard-codes `() => true` (reference:40038) because its `OneBotInstance`
   * only exists for a logged-in account and flips `online = false` on quiesce
   * (reference:342877). The equivalent here is exactly those two conditions: the bridge
   * must still be open AND must have a bound packet client. A bridge with no connection
   * can neither send a packet nor receive one, so reporting online would make
   * `get_status`'s `good` flag claim a working link that does not exist.
   */
  isOnline(): boolean {
    return !this.#disposed && this.#session.stillOpen() && !this.#session.empty;
  }

  /** Uptime of the bridge session — `Bridge.getUptimeMs()` (reference:342790). */
  getUptimeMs(): number {
    return this.#session.getUptimeMs();
  }

  /** The sticky lifecycle gate `createOneBotApi` takes. Not a login check. */
  isAcceptingActions(): boolean {
    return !this.#disposed;
  }

  /** Stop accepting actions. Idempotent; the bridge itself is the caller's to dispose. */
  dispose(): void {
    this.#disposed = true;
  }

  // -------------------------------------------------------------------------
  // Message store reads
  // -------------------------------------------------------------------------

  /** A miss is `null`/`undefined`, which `get_msg` turns into `100 message not found`. */
  async getMessage(messageId: number): Promise<Record<string, unknown> | null | undefined> {
    return await this.#message.getMessage(messageId);
  }

  /** A miss (or a row with no authoritative sequence) makes `delete_msg` fail 100. */
  async getMessageMeta(messageId: number): Promise<StoredMessageMeta | null | undefined> {
    return await this.#message.getMessageMeta(messageId);
  }

  /**
   * EXPLICIT ADAPTATION — `ActionContext.deleteMessage` is `Promise<void>`, the provider
   * answers `Promise<boolean>` ("the recall packet was accepted").
   *
   * `Promise<boolean>` is not assignable to `Promise<void>` (verified under `--strict`),
   * and the two possible shims are not equivalent:
   *
   *   * dropping the boolean silently reports success for a recall that was refused —
   *     `delete_msg` would answer `retcode 0` while the message is still in the group,
   *     which is the false success `message-store.ts`'s header is written to prevent;
   *   * rethrowing turns a refusal into `retcode 100` with the wording below.
   *
   * The second is the reference's behaviour: its provider throws inside `deleteMessage`
   * (reference:38214). `meta` is unused because the provider re-derives the recall target
   * from the store (`getRecallMeta`), so passing it would be a second, unchecked source.
   */
  async deleteMessage(messageId: number, _meta: StoredMessageMeta): Promise<void> {
    const recalled = await this.#message.deleteMessage(messageId);
    if (!recalled) {
      throw new Error(
        `message ${String(messageId)} not found or not retractable: the stored row has no ` +
          "authoritative QQ sequence, so no recall packet was sent",
      );
    }
  }

  /**
   * EXPLICIT ADAPTATION — `ActionContext.refreshMessageMedia` is `Promise<void>`, the
   * provider answers a `RefreshMediaResult` union.
   *
   * Media/Highway is not available in this port, so `resolveMedia` is never injected and
   * the provider always answers `status: "unsupported"`. Returning quietly would be the
   * silent no-op `main.ts` warns about ("A silent empty result would be worse: it would
   * report success for work never done"), so:
   *
   *   * an event that carries NO image/record/video segment needs no refresh — the call is
   *     a faithful no-op and returns. This keeps `get_msg` working for text messages,
   *     which is the majority of them.
   *   * an event that DOES carry media throws `MEDIA_REFRESH_UNSUPPORTED_REASON`.
   *
   * The consequence is recorded rather than hidden: `get_msg` on a media-carrying stored
   * message answers `retcode 100` with that reason instead of returning stale URLs as if
   * they had been refreshed.
   */
  async refreshMessageMedia(messageId: number, event: Record<string, unknown>): Promise<void> {
    const result = await this.#message.refreshMessageMedia(messageId, event);
    if (result.status === "unsupported") {
      if (!carriesMedia(event)) return;
      throw new Error(result.reason);
    }
    if (result.status === "not-found") {
      // The event carries no segment array at all: nothing can be refreshed, and the
      // action still has a usable event, so this is not an error.
      log.debug("media refresh skipped for message %d: %s", messageId, result.reason);
    }
  }

  // -------------------------------------------------------------------------
  // Sends (straight from the provider)
  // -------------------------------------------------------------------------

  async sendGroupMessage(
    groupId: number,
    message: unknown,
    autoEscape: boolean,
  ): Promise<{ messageId: number }> {
    return await this.#message.sendGroupMessage(groupId, message, autoEscape);
  }

  async sendPrivateMessage(
    userId: number,
    message: unknown,
    autoEscape: boolean,
    tempGroupId?: number | undefined,
  ): Promise<{ messageId: number }> {
    return tempGroupId === undefined
      ? await this.#message.sendPrivateMessage(userId, message, autoEscape)
      : await this.#message.sendPrivateMessage(userId, message, autoEscape, tempGroupId);
  }

  // -------------------------------------------------------------------------
  // Roster readers — reference:39337-39578
  // -------------------------------------------------------------------------

  /**
   * reference:39337 `getFriendList`.
   *
   * The `withProfile` flag decides the failure policy, and the asymmetry is the
   * reference's: a profile-enrichment failure is RETHROWN (the caller asked for profiles
   * and did not get them), while a plain roster failure degrades to the cached identity
   * list. The my-device pseudo-contacts are appended afterwards, deduped by uin.
   */
  async getFriendList(withProfile: boolean): Promise<unknown[]> {
    let rows: Record<string, unknown>[];
    try {
      rows = (await this.#session.apis.contacts.fetchFriendList({ withProfile })).map((friend) => formatFriend(friend));
    } catch (error) {
      log.warn(
        "friend list refresh failed: withProfile=%s error=%s",
        String(withProfile),
        errorText(error),
      );
      if (withProfile) throw error;
      rows = this.#session.identity.friends.map((friend) => formatFriend(friend));
    }
    const occupied = new Set(rows.map((row) => Number(row["user_id"])));
    for (const extra of datalineFriendEntries()) {
      if (occupied.has(Number(extra["user_id"]))) continue;
      rows.push(extra);
    }
    return rows;
  }

  /**
   * reference:39357 `getGroupList`.
   *
   * A refresh failure is fatal only when `no_cache` was requested; otherwise the cached
   * roster answers. `group_level` is `g.level ?? 0`, which is why `get_group_list` reports
   * 0 for every group — `fetchGroupList` never fills `level` (see `ActionGroupInfo`).
   */
  async getGroupList(noCache: boolean): Promise<unknown[]> {
    try {
      if (noCache || this.#session.identity.groups.length === 0) {
        await this.#session.apis.contacts.fetchGroupList();
      }
    } catch (error) {
      if (noCache) throw error;
      log.warn(
        "group list refresh failed, using cached roster: uin=%s error=%s",
        this.#session.identity.uin,
        errorText(error),
      );
    }
    return this.#session.identity.groups.map((group) => ({
      group_id: group.groupId,
      group_name: group.groupName,
      group_remark: group.remark,
      member_count: group.memberCount,
      max_member_count: group.memberMax,
      group_create_time: groupExtras(group).createTime,
      // Always 0 here, and that is the reference's behaviour: `fetchGroupList` never
      // fills `level` — only `fetchGroupDetail` does — which is exactly why
      // `get_group_info` calls `#groupLevel` first and this does not.
      group_level: groupExtras(group).level,
      group_memo: groupExtras(group).memo,
      group_description: groupExtras(group).description,
      group_all_shut: groupExtras(group).allMuted ? -1 : 0,
    }));
  }

  /**
   * reference:39392 `getGroupInfo`.
   *
   * Two paths: a group the bot is IN answers from the roster (with the level fetched
   * separately and cached 5 minutes), and a group it is NOT in answers from
   * `fetchGroupDetail` (0x88d_0), cached per-uin. `null` means "no such group / not
   * visible", which the action turns into its ten-field zero object.
   */
  async getGroupInfo(groupId: number, noCache: boolean): Promise<unknown | null> {
    if (noCache || !this.#session.identity.findGroup(groupId)) {
      try {
        await this.#session.apis.contacts.fetchGroupList();
      } catch (error) {
        if (noCache) throw error;
        log.warn(
          "group list refresh failed, using cached roster: uin=%s group=%d error=%s",
          this.#session.identity.uin,
          groupId,
          errorText(error),
        );
      }
    }
    const group = this.#session.identity.findGroup(groupId);
    if (group) {
      const extras = groupExtras(group);
      return {
        group_id: group.groupId,
        group_name: group.groupName,
        group_remark: group.remark,
        member_count: group.memberCount,
        max_member_count: group.memberMax,
        group_create_time: extras.createTime,
        // The ONE field `get_group_info` fetches (reference:39392 `getGroupLevel`).
        group_level: await this.#groupLevel(groupId, noCache),
        group_memo: extras.memo,
        group_description: extras.description,
        group_all_shut: extras.allMuted ? -1 : 0,
      };
    }

    const cacheKey = `${this.#session.identity.uin}:${String(groupId)}`;
    if (!noCache) {
      const cached = nonMemberGroupCache.get(cacheKey);
      if (cached && Date.now() - cached.at < NON_MEMBER_GROUP_TTL_MS) return { ...cached.info };
    }
    try {
      const detail = await this.#session.apis.contacts.fetchGroupDetail(groupId);
      if (detail) {
        const info: Record<string, unknown> = {
          group_id: detail.groupId,
          group_name: detail.groupName,
          group_remark: detail.remark,
          member_count: detail.memberCount,
          max_member_count: detail.memberMax,
          group_create_time: detail.createTime ?? 0,
          group_level: detail.level ?? 0,
          group_memo: detail.memo ?? "",
          group_description: detail.description ?? "",
          group_all_shut: detail.allMuted ? -1 : 0,
        };
        nonMemberGroupCache.set(cacheKey, { info, at: Date.now() });
        return { ...info };
      }
    } catch (error) {
      if (noCache) throw error;
      log.warn(
        "non-member group lookup failed: uin=%s group=%d error=%s",
        this.#session.identity.uin,
        groupId,
        errorText(error),
      );
    }
    return null;
  }

  /**
   * reference:39433 `getGroupMemberList`.
   *
   * `no_cache` forces a single-flight refresh; the cached path falls back to the members
   * already remembered on the roster, and RETHROWS when that cache is empty (an empty list
   * would be indistinguishable from a group with no members).
   */
  async getGroupMemberList(groupId: number, noCache: boolean): Promise<unknown[]> {
    const identity = this.bridge.identity;
    if (noCache) {
      return (await this.#fetchSingleGroupMembers(groupId, true)).map((member) =>
        formatGroupMember(groupId, member, cachedQidianProfile(identity, member.uin)),
      );
    }
    try {
      return (await this.#session.apis.contacts.fetchGroupMemberList(groupId)).map((member) =>
        formatGroupMember(groupId, member, cachedQidianProfile(identity, member.uin)),
      );
    } catch (error) {
      log.warn(
        "group member fetch failed, using classified cache: uin=%s group=%d error=%s",
        this.#session.identity.uin,
        groupId,
        errorText(error),
      );
      const cached = this.#cachedGroupMembers(groupId);
      if (cached.length === 0) throw error;
      return cached;
    }
  }

  /**
   * reference:39444 `getGroupMemberInfo`.
   *
   * `null` means "the provider ran and the member is not there", which the action turns
   * into its 15-field object WITH the qidian flags — a different response from the
   * provider-absent fallback, which is why this returns `null` rather than throwing.
   *
   * The refetch condition is the reference's: an unclassified member (`isRobot ===
   * undefined`) forces a fetch because `formatGroupMember` throws on it.
   */
  async getGroupMemberInfo(groupId: number, userId: number, noCache: boolean): Promise<unknown | null> {
    const identity = this.bridge.identity;
    const cached = identity.findGroupMember(groupId, userId);
    if (noCache || !cached || cached.isRobot === undefined) {
      await this.#fetchSingleGroupMembers(groupId, noCache);
    }
    const member = identity.findGroupMember(groupId, userId);
    if (!member) return null;
    let profile = cachedQidianProfile(identity, userId);
    if (noCache || !profile) {
      try {
        profile = await this.#session.apis.contacts.fetchUserProfile(userId);
      } catch (error) {
        log.warn(
          "group member profile unavailable: group=%d member=%d error=%s",
          groupId,
          userId,
          errorText(error),
        );
      }
    }
    return formatGroupMember(groupId, member, profile ?? undefined);
  }

  /**
   * reference:39556 `getStrangerInfo`.
   *
   * Three degradations, in the reference's order: the my-device pseudo-contact answers a
   * minimal row; a profile fetch failure falls back to the cached profile and then to the
   * cached friend; `null` when nothing is known. The qidian corp card is best-effort and
   * only fetched for an account whose flags say it IS a qidian user.
   */
  async getStrangerInfo(userId: number): Promise<unknown | null> {
    const device = findDatalineDeviceByUin(userId);
    if (device) {
      return {
        user_id: device.uin,
        nickname: device.name,
        remark: device.name,
        sex: "unknown",
        age: 0,
        long_nick: "",
      };
    }
    const identity = this.bridge.identity;
    try {
      const profile = await this.#session.apis.contacts.fetchUserProfile(userId);
      return formatStrangerInfo(profile, await this.#strangerCorpInfo(profile));
    } catch (error) {
      log.warn(
        "user profile refresh failed, checking cached profile: user=%d error=%s",
        userId,
        errorText(error),
      );
      const cachedProfile = identity.findUserProfile(userId);
      if (cachedProfile) {
        const profile: ActionUserProfile = {
          ...cachedProfile,
          remark: cachedProfile.remark || identity.findFriend(userId)?.remark || "",
        };
        return formatStrangerInfo(profile, await this.#strangerCorpInfo(profile));
      }
      const friend = identity.findFriend(userId);
      if (!friend) return null;
      return {
        user_id: friend.uin,
        nickname: friend.nickname,
        remark: friend.remark,
        sex: "unknown",
        age: 0,
        long_nick: "",
      };
    }
  }

  // -------------------------------------------------------------------------
  // Group files
  // -------------------------------------------------------------------------

  /**
   * reference:39476 `getGroupFiles` — the camelCase → snake_case rename.
   *
   * Delegates to the ported `formatGroupFiles` rather than re-deriving the mapping: the
   * renames are not a uniform transform (`creatorName` → `create_name`), so a second copy
   * would drift. `folderId` stays `string | undefined` because the `?? "/"` lives inside
   * the formatter.
   */
  async getGroupFiles(
    groupId: number,
    folderId: string | undefined,
  ): Promise<{ files: import("../onebot/actions/context.js").GroupFileEntry[]; folders: import("../onebot/actions/context.js").GroupFolderEntry[] }> {
    return await formatGroupFiles(this.bridge.apis.groupFile, groupId, folderId);
  }

  // -------------------------------------------------------------------------
  // Essence (reference:38218 `setEssenceMessage`)
  // -------------------------------------------------------------------------

  /**
   * `set_essence_msg` / `delete_essence_msg`.
   *
   * UNGUARDED in the reference, and it must resolve the recall metadata first: `0xeac`
   * carries the message's OWN `random` beside the sequence, and a zero random is dropped
   * by the wire's presence rule — so a caller that guessed `random` would name a different
   * message. Both refusals are the reference's exact wordings.
   */
  async setEssenceMsg(messageId: number): Promise<void> {
    await this.#setEssence(messageId, true, "setEssenceMsg");
  }

  async deleteEssenceMsg(messageId: number): Promise<void> {
    await this.#setEssence(messageId, false, "deleteEssenceMsg");
  }

  async #setEssence(messageId: number, enable: boolean, member: string): Promise<void> {
    const meta = this.#store.getMeta(messageId);
    if (!meta || !meta.isGroup) {
      throw new Error(`${member}: message not found or not a group message`);
    }
    if (!hasAuthoritativeSequence(meta)) {
      throw new Error(
        `${member}: message has no authoritative QQ sequence and cannot be marked as essence`,
      );
    }
    await this.#session.apis.interaction.setEssence(meta.targetId, meta.sequence, meta.random, enable);
  }

  // -------------------------------------------------------------------------
  // Message-metadata writes
  // -------------------------------------------------------------------------

  /**
   * reference:40049 region — `cacheMessageMetas`.
   *
   * Writes the derived `messageId → meta` pairs so a later `get_msg` / essence / reaction
   * call on an essence or todo message finds a real sequence and a target. Refuses an
   * unusable id rather than inserting a row nothing can address (the reference's
   * `cacheMessageMeta` does the same).
   */
  async cacheMessageMetas(entries: readonly { messageId: number; meta: StoredMessageMeta }[]): Promise<void> {
    for (const entry of entries) {
      if (!Number.isInteger(entry.messageId) || entry.messageId === 0) continue;
      this.#store.insert(entry.messageId, { meta: entry.meta });
    }
  }

  // -------------------------------------------------------------------------
  // NOT IMPLEMENTED — one method per missing bridge-layer module
  // -------------------------------------------------------------------------
  //
  // Every method below throws `HostNotImplementedError` naming the absent dependency.
  // They are declared (not omitted) because each action's presence test would otherwise
  // take a fallback branch that answers a plausible empty value — `[]`, `{}`, `ok` — for
  // work that was never done.

  // -------------------------------------------------------------------------
  // Forward (merged forward / 合并转发)
  // -------------------------------------------------------------------------
  //
  // These five were the last `notImplemented` members of the file. They are real now:
  // `bridge/apis/forward.ts` owns the long-message transport (SsoSendLongMsg /
  // SsoRecvLongMsg), and `host/forward-send.ts` owns the orchestration
  // (parseForwardNodes / preview / per-target regeneration).
  //
  // Two capabilities remain CONDITIONAL, and the conditions are real rather than
  // hypothetical:
  //
  //   * A node whose content carries a MEDIA element (image/voice/video) needs the
  //     Highway upload channel, reached through `createMediaUploader`. That module
  //     exists in this port; if it cannot upload, `buildSendElems` throws with
  //     Highway's own message and this host propagates it. Nothing here pretends the
  //     media was sent.
  //   * A node carrying a `file` element needs `apis.groupFile.upload` /
  //     `uploadPrivate`, also Highway-backed. Same treatment: a real call, and a real
  //     error when the upload cannot happen.
  //
  // Text/face/at/reply/json/xml/mface/forward nodes touch neither.

  async getForwardMsg(resId: ForwardResourceId): Promise<unknown[]> {
    return await getForwardMessage(this.#forwardContext(), resId);
  }

  async sendForwardMsg(messages: unknown, groupId?: number | undefined): Promise<ForwardUploadResult> {
    return await uploadForwardMessage(this.#forwardContext(), messages, groupId);
  }

  async sendGroupForwardMsg(
    groupId: number,
    messages: unknown,
    meta: ForwardPreview | undefined,
  ): Promise<ForwardSendResult> {
    return await sendGroupForwardMessage(this.#forwardContext(), groupId, messages, meta);
  }

  async sendPrivateForwardMsg(
    userId: number,
    messages: unknown,
    meta: ForwardPreview | undefined,
  ): Promise<ForwardSendResult> {
    return await sendPrivateForwardMessage(this.#forwardContext(), userId, messages, meta);
  }

  async forwardSingleMsg(
    messageId: number,
    target: { userId?: number | undefined; groupId?: number | undefined },
  ): Promise<{ messageId: number }> {
    return await forwardSingleMessage(this.#forwardContext(), messageId, target);
  }

  /**
   * The orchestration slice for the five forward members.
   *
   * Built per call, like `#historyContext`, and for the same reason: every member is a
   * stable reference off `#session`/`#store`, so this is a handful of property reads.
   *
   * `recordSent` delegates to the SAME `recordSend` path `sendGroupMessage` uses
   * (`#message`). Writing a second id-hashing implementation here would let a forward's
   * own message be unreachable by `recall`/`get_msg` while an ordinary send's is not —
   * the identical asymmetry this port's message-id module exists to prevent.
   */
  #forwardContext(): ForwardOrchestrationContext {
    return {
      selfId: Number.parseInt(this.#session.identity.uin, 10) || 0,
      forward: this.#session.apis.forward,
      message: {
        sendGroup: (groupId, elements) => this.#session.apis.message.sendGroup(groupId, elements),
        sendPrivate: (userUin, elements) => this.#session.apis.message.sendPrivate(userUin, elements),
      },
      store: {
        get: (messageId) => this.#store.get(messageId),
        getMedia: (messageId) => this.#store.getMedia(messageId),
        getMeta: (messageId) => this.#store.getMeta(messageId),
      },
      media: this.#media,
      converterCtx: this.#historyContext().converterCtx,
      selfNickname: this.#session.identity.nickname,
      recordSent: async (scene, targetId, segments, receipt: SendReceipt) => {
        return await this.#recordForwardSend(scene, targetId, segments, receipt);
      },
    };
  }

  /**
   * Store a forward send's own message under the id `MessageApi` returned.
   *
   * The credentials are the same ones `recordSend` in `action-message-providers.ts`
   * uses, computed the same way (`sequenceAuthoritative` is the receipt's own positive
   * sequence), because a client that later calls `get_msg` on the forward card must find
   * a row whose meta says whether that sequence may be sent back to QQ.
   *
   * The event body is deliberately NOT written here. `action-message-providers.ts`'s
   * `resolveMessageOut` is the single place that builds a stored outbound event, and no
   * `resolveMessageOut` is injected into this host's providers — so `recordSend` there
   * stores meta only, and this method matches it rather than inventing a second event
   * shape. The consequence, stated plainly: `get_msg` on a just-sent forward answers
   * `null` until the echo push arrives, exactly as it does for an ordinary send in this
   * host.
   */
  async #recordForwardSend(
    scene: "group" | "private",
    targetId: number,
    _segments: readonly unknown[],
    receipt: SendReceipt,
  ): Promise<number> {
    const messageId = receipt.messageId;
    if (!Number.isSafeInteger(messageId) || messageId === 0) {
      throw new Error(
        `forward send reached QQ but returned an unusable message id (${String(messageId)}); ` +
          `sequence=${String(receipt.sequence)} random=${String(receipt.random)}`,
      );
    }
    const stored = this.#store.insert(messageId, {
      meta: {
        isGroup: scene === "group",
        targetId,
        sequence: receipt.sequence,
        sequenceAuthoritative: Number.isInteger(receipt.sequence) && receipt.sequence > 0,
        clientSequence: receipt.clientSequence,
        random: receipt.random,
        timestamp: receipt.timestamp,
      },
    });
    if (!stored) throw new Error(`message store refused the row for forward message id ${String(messageId)}`);
    return messageId;
  }

  /**
   * reference:37950 / :37987 — see `host/msg-history.ts` for the two-tier design.
   *
   * `get_group_msg_history` calls THIS, and this calls `getGroupHistory`, which tries
   * the server (`SsoGetGroupMsg`) and falls back to the local store. The naming is the
   * reference's own and is genuinely confusing: the `…MsgHistory` member is the LOCAL
   * reader and the bare `…History` one is the server-plus-fallback wrapper. The action
   * reaches the wrapper, so a host method called `getGroupMsgHistory` that skipped
   * straight to the store would silently stop fetching from QQ.
   */
  async getGroupMsgHistory(
    groupId: number,
    messageId: number,
    count: number,
    reverseOrder: boolean,
  ): Promise<unknown[]> {
    return getGroupHistory(this.#historyContext(), groupId, messageId, count, reverseOrder);
  }

  /**
   * reference:37966 / :38026.
   *
   * Unlike the group reader this one PROPAGATES failures: an unresolvable peer uid
   * throws, and so does a failed `SsoGetRoamMsg`. The reference's reason (its own
   * header, L38022) is that a private conversation served from a stale local cache can
   * contain messages the peer has already recalled, while a group's local page is only
   * a subset of the truth. `get_friend_msg_history` turns a throw into a failed
   * response, which is the honest answer.
   */
  async getFriendMsgHistory(
    userId: number,
    messageId: number,
    count: number,
    reverseOrder: boolean,
  ): Promise<unknown[]> {
    return getFriendHistory(this.#historyContext(), userId, messageId, count, reverseOrder);
  }

  /**
   * The converter context every history read is built on.
   *
   * Reconstructed per call rather than cached: `selfId` is a live identity value that
   * changes on re-login, and both the store and `apis.message` are stable references
   * held by `#session`/`#store` anyway. Building it is five property reads.
   *
   * `messageIdResolver` is the one member that is NOT optional in practice. Without it
   * `applyMessageIdResolver` (event-converters.ts) returns the RAW SEQUENCE as
   * `message_id`, so a history page would carry sequence numbers where a client expects
   * ids, and `get_msg`/reply/reaction on any of them would fail. The reference always
   * supplies it (reference:23096 `converterCtx.messageIdResolver`), so the port must too.
   */
  #historyContext(): HistoryContext {
    // `identity.uin` is a STRING here (context.ts:145) and a NUMBER on the converter
    // context. The reference does the same coercion in one place (`parseInt(this.uin,
    // 10) || 0`, reference:342773) and relies on `|| 0` for an unparsable uin — an
    // identity that has not logged in yet. Copying it exactly: `Number.parseInt` alone
    // yields `NaN`, and `NaN` propagates into every `post_type` comparison.
    const selfId = Number.parseInt(this.#session.identity.uin, 10) || 0;
    const converterCtx: ConverterContext = {
      selfId,
      messageIdResolver: this.#messageIdResolver,
    };
    return {
      selfId,
      store: this.#store,
      messageApi: this.#session.apis.message,
      converterCtx,
      resolveUserUid: (userId) => this.#session.resolveUserUid(userId),
    };
  }


  // -------------------------------------------------------------------------
  // Media cache (reference:39884 `getImageInfo` / :39901 `getRecordInfo`)
  // -------------------------------------------------------------------------

  /**
   * `get_image` / `get_file` / `ocr_image` / `download_file_*_stream` — reference:39884.
   *
   * Answers `null` for a cache MISS, which each action turns into its own wording
   * (`image not found in cache`). That is deliberately NOT an exception: "the id is not
   * cached" is a normal answer to a client that made one up, and every caller already
   * handles it.
   *
   * **The URL refresh, and what its absence costs.** The reference tries
   * `resolveImageUrl(cached, imageUrlResolver)` and prefers the fresh answer, falling back
   * to `cached.url || cached.imageUrl`. In this port `imageUrlResolver` is usually
   * `undefined` (no rkey cache), in which case `resolveImageUrl` answers `null` and the
   * cached URL is returned unchanged — the reference's OWN fallback for an absent
   * resolver, not a substitute for it.
   *
   * What that means concretely: a cached CDN URL that requires an `rkey` query parameter
   * will 403 when the client fetches it. That is a real, diagnosable failure — and the
   * alternative (fabricating a resolver, or appending an empty `rkey=`) would produce a
   * URL that looks valid and still 403s, with no way to tell the two apart. So the member
   * is honest rather than complete, and the refresh path is a live injection point
   * (`BridgeActionContextHostOptions.imageUrlResolver`) for whoever ports the rkey cache.
   *
   * A throw from the resolver is swallowed to a WARNING, exactly as reference:39890-39893
   * does: the cached URL is still a usable answer, and denying the whole call because the
   * refresh failed would turn a degraded response into no response.
   */
  async getImageInfo(file: string): Promise<MediaInfo | null | undefined> {
    const cached = await this.#media?.findImage(file);
    if (!cached) return null;
    let url = cached.url || cached.imageUrl || "";
    try {
      const fresh = await resolveImageUrl(cached, this.#imageUrl);
      if (fresh) url = fresh;
    } catch (error) {
      log.warn(
        "get_image URL refresh failed: %s",
        error instanceof Error ? error.message : String(error),
      );
    }
    // ⚠️ DIVERGENCE, recorded rather than silently "fixed" in either direction.
    //
    // The reference answers `file_size: String(cached.fileSize ?? 0)` (:39897) — a DECIMAL
    // STRING. This port's `MediaInfo` (context.ts:1635) declares `file_size: number`, so
    // returning the string fails to compile (`TS2322`). Both are self-consistent; they
    // disagree with each other.
    //
    // The number is what this port returns, because `context.ts` is the declared contract
    // every consumer is typed against and `download_file_stream` already coerces with
    // `asNum(record["file_size"])` (`Number(...)`), so a number is accepted on the way back
    // in. The observable difference is the JSON type of one field on `get_image` /
    // `get_record` / `get_file`; a client that does `"5" === file_size` would notice.
    // Fixing it properly means changing `context.ts`'s declaration to `string`, which is a
    // cross-batch edit outside this task.
    return {
      file: url || cached.file || "",
      url,
      file_size: cached.fileSize ?? 0,
      file_name: cached.fileName || cached.file || "",
    };
  }

  /**
   * `get_record` / `get_file` / `download_file_record_stream` — reference:39901.
   *
   * Unlike `getImageInfo`, this one always asks QQ: a voice's download URL is short-lived
   * and the cached one is only useful for its `mediaNode`. Three consequences, all the
   * reference's:
   *
   *   * a missing `mediaNode` THROWS from `resolveRemoteMediaUrl` (the metadata exists but
   *     cannot be addressed — a store-integrity problem, not a cache miss);
   *   * the fresh URL is WRITTEN BACK through `updateRecordUrl`, so the next read has it
   *     — and `updateRecordUrl` refuses an over-long/inline URL, so a bad resolver answer
   *     cannot poison the row;
   *   * `file` and `url` are the same value, which `download_file_stream` relies on when it
   *     reconstructs `file || file_id`.
   *
   * `null` only for a cache miss, so `get_record`'s "record not found in cache" stays
   * reachable.
   */
  async getRecordInfo(file: string): Promise<MediaInfo | null | undefined> {
    const cached = await this.#media?.findRecord(file);
    if (!cached) return null;
    const url = await resolveRemoteMediaUrl(
      this.#session,
      "record",
      cached.mediaNode as Parameters<typeof resolveRemoteMediaUrl>[2],
      cached.isGroup === true,
      typeof cached.sessionId === "number" ? cached.sessionId : Number.parseInt(this.#session.identity.uin, 10) || 0,
    );
    await this.#media?.updateRecordUrl(file, url);
    return {
      file: url,
      url,
      // `cached.fileSize ?? 0` as a NUMBER — see `getImageInfo`'s divergence note. The
      // reference stringifies it here too (:39909); `MediaInfo.file_size` is typed `number`
      // in this port.
      file_size: cached.fileSize ?? 0,
      file_name: cached.fileName || cached.file || "",
    };
  }

  /**
   * Approve or reject a group join/invite request — reference:39984
   * `handleGroupAddRequest`, ported in `host/group-request.ts`.
   *
   * The delegation is not cosmetic. An earlier inline version of this method read ONE
   * inbox (`fetchFilteredGroupRequests(50, false)`) where the reference reads BOTH
   * through `fetchRequestInboxes` (reference:39952), and it had none of the reference's
   * failure aggregation — so a filtered-only request was reported as "not found", and a
   * transport failure was reported the same way. Four separate divergences were fixed
   * by moving the body out; see `group-request.ts`'s header for the failure policy and
   * for why the flat inbox row (not the nested one) is what every path here needs.
   *
   * `subType` is unused because the reference discards it (reference:40049
   * `(flag, _subType, approve, reason) =>`): the request type is recovered from the
   * flag's own `add`/`invite` prefix, so a client that sends `sub_type: "invite"` with
   * an `add:` flag gets `add` behaviour.
   */
  async handleGroupRequest(
    flag: string,
    subType: string,
    approve: boolean,
    reason: string,
  ): Promise<void> {
    await handleGroupAddRequest(this.#groupRequestContext(), flag, subType, approve, reason);
  }

  /**
   * `get_group_system_msg` — reference:39660 `getGroupSystemMessages`, ported in
   * `host/group-request.ts`.
   *
   * The previous inline body was close but wrong in three places, each of which produces
   * a plausible-looking row: `requester_nick` ignored the resolved profile name
   * (reference:39686 `resolved?.name || actor.name`), the ambiguity check compared only
   * `sequence` (reference:40042 compares `eventType` and `filtered` too), and a failed
   * profile lookup was swallowed where the reference wraps it with the uid and rethrows
   * (reference:39622). Those are why this is a delegation rather than a copy.
   */
  async handleGetGroupSystemMsg(query: {
    groupId?: number | undefined;
    onlyPending: boolean;
    count: number;
  }): Promise<unknown[]> {
    return getGroupSystemMessages(this.#groupRequestContext(), query, (uid, groupId) =>
      this.#session.identity.findUinByUid(uid, groupId),
    );
  }

  /**
   * What both request paths need from the session.
   *
   * `selfUin` is the NUMERIC identity (`identity.uin` is a string — context.ts:145) and
   * `selfUid` its uid form, because the legacy `invite:` matcher compares both: a row
   * with a `targetUin` must name the bot, and a row with a `targetUid` must name the
   * bot's uid. Comparing only one of the two lets another member's invitation through.
   *
   * `contacts` is narrowed to the two INBOX READERS plus the three resolvers rather than
   * the whole `ContactsApi`, so this file's dependency on the request path is the six
   * members it actually calls.
   */
  #groupRequestContext(): GroupRequestContext {
    return {
      selfUin: Number.parseInt(this.#session.identity.uin, 10) || 0,
      selfUid: this.#session.identity.selfUid,
      contacts: this.#session.apis.contacts,
      groupAdmin: {
        setAddRequest: (groupId, sequence, eventType, approve, reason, filtered, operateTransInfo) =>
          this.#session.apis.groupAdmin.setAddRequest(
            groupId,
            sequence,
            eventType,
            approve,
            reason,
            filtered,
            operateTransInfo,
          ),
      },
    };
  }

  /**
   * Resolve a `message_id` to the `(groupId, sequence)` pair a reaction needs.
   *
   * ⚠️ The reaction commands address a message by its GROUP SEQUENCE, not by its id — so
   * `findMeta` is the only way in. Three refusals, each mirroring the reference
   * (index.mjs:40068-40073) and each for a different reason:
   *
   * - not found: the id was never observed, so there is no sequence to name.
   * - private: QQ has no reaction command for c2c; the action would otherwise send a group
   *   packet with a friend's uin as the group number.
   * - no authoritative sequence: the id is known but the sequence came from a fallback
   *   rather than from QQ, so addressing it would name the wrong message.
   */
  #reactionTarget(messageId: number): { groupId: number; sequence: number } {
    const meta = this.#store.getMeta(messageId);
    if (meta === null) throw new Error("message not found");
    if (!meta.isGroup) throw new Error("emoji reactions are not supported on private messages");
    if (!hasAuthoritativeSequence(meta)) throw new Error("message has no authoritative QQ sequence");
    return { groupId: meta.targetId, sequence: meta.sequence };
  }

  async setMsgEmojiLike(messageId: number, emojiId: string, set: boolean): Promise<void> {
    const resolved = this.#reactionTarget(messageId);
    await this.#session.apis.interaction.setReaction(
      resolved.groupId, resolved.sequence, emojiId, set,
    );
    // The type is derived, not stored: see `emojiTypeFor`. A wrong type makes the server
    // reject the reaction, so it is computed at send time and reused for the cache entry.
    const emojiType = emojiTypeFor(emojiId);
    if (set) {
      this.#reactions.recordAdd(
        resolved.groupId, resolved.sequence, emojiId, emojiType,
        Number(this.#session.identity.uin), "", Math.floor(Date.now() / 1000),
      );
    } else {
      this.#reactions.recordRemove(
        resolved.groupId, resolved.sequence, emojiId, Number(this.#session.identity.uin),
      );
    }
  }

  async fetchEmojiLikeUsers(
    messageId: number,
    emojiId: string,
    count: number,
    offset = 0,
  ): Promise<{ users: { uin: number; uid: string; setAt: number }[]; cachedCount: number }> {
    const resolved = this.#reactionTarget(messageId);
    const cached = this.#reactions
      .listUsers(resolved.groupId, resolved.sequence, emojiId, count, offset)
      .map((row) => ({ uin: row.operatorUin, uid: row.operatorUid, setAt: row.setAt }));
    const cachedCount = this.#reactions.countUsers(resolved.groupId, resolved.sequence, emojiId);
    // The reference asks the server and prefers its list, falling back to the cache when the
    // server answers nobody (index.mjs:40108-40132). A transport failure inside `getEmojiLikes`
    // is already an empty page by design, so a remote miss and a dead network are
    // indistinguishable here — which is why the cache is the fallback rather than the reverse.
    try {
      const remote = await this.#session.apis.interaction.getEmojiLikes(
        resolved.groupId, resolved.sequence, emojiId, emojiTypeFor(emojiId), count,
      );
      if (remote.users.length > 0) {
        return {
          users: remote.users.map((row) => ({
            uin: row.uin, uid: "", setAt: 0,
          })),
          cachedCount,
        };
      }
    } catch {
      // Deliberately swallowed: a cache-only answer is better than failing the action.
    }
    return { users: cached, cachedCount };
  }

  async fetchEmojiLikeSummary(messageId: number): Promise<unknown[]> {
    const resolved = this.#reactionTarget(messageId);
    const summary = this.#reactions.summarizeMessage(resolved.groupId, resolved.sequence);
    const out: unknown[] = [];
    for (const entry of summary) {
      // The local cache only knows reactions this process observed, so it always undercounts.
      // The reference tries the server first and takes `Math.max(local, remote)`
      // (index.mjs:40084-40104): a server count smaller than the cache means the cache saw
      // reactions the server no longer reports, and the larger number is the honest one.
      let users = this.#reactions
        .listUsers(resolved.groupId, resolved.sequence, entry.emojiId, 1000, 0)
        .map((row) => ({ user_id: row.operatorUin }));
      try {
        const remote = await this.#session.apis.interaction.getEmojiLikes(
          resolved.groupId, resolved.sequence, entry.emojiId, entry.emojiType, 1000,
        );
        if (remote.users.length > 0) {
          users = remote.users.map((row) => ({ user_id: row.uin }));
        }
      } catch {
        // Same reasoning as fetchEmojiLikeUsers: the cached view is the fallback.
      }
      out.push({
        emoji_id: entry.emojiId,
        emoji_type: entry.emojiType,
        count: Math.max(entry.count, users.length),
        last_reaction_time: entry.lastSetAt,
        users,
      });
    }
    return out;
  }

  async listReadSessions(): Promise<ReadSessions> {
    // The group half comes from the roster, the private half from the message table. The
    // reference reads both out of one SQLite index (index.mjs:41149-41179); this port has no
    // such index, so each half is derived from the source that actually knows it.
    return this.#store.listReadSessions(
      this.#session.identity.groups.map((group) => group.groupId),
    );
  }

  /**
   * One-way friends — accounts that have the bot in their list but are not in its own.
   *
   * The blocks are the server's own JSON objects (`uint64_uin` as a string), passed through
   * unreshaped: the reference's action does the same (`okResponse(await
   * ctx.bridge.apis.profile.getUnidirectionalFriendList())`, reference:13712). Reshaping them
   * into friend objects would invent a `nickname` the response does not carry.
   */
  async getUnidirectionalFriendList(): Promise<Record<string, unknown>[]> {
    return this.#session.apis.profile.getUnidirectionalFriendList();
  }

  async getDownloadRKeys(): Promise<DownloadRKey[]> {
    // The 0x9067 sub-202 request takes no parameters and always asks for the same three rkey
    // types, so there is nothing to thread through from the action. A media-level failure
    // (expired credential, missing file) has already thrown inside the bridge by the time this
    // returns; an empty array here means the server genuinely had no keys.
    return this.#session.apis.contacts.fetchDownloadRKeys();
  }

  async fetchPttText(_messageId: number): Promise<string | null> {
    return notImplemented(
      "fetchPttText",
      "the Tencent ASR request shape is not in any ported module, so a record cannot be transcribed",
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** reference:39325 `fetchSingleGroupMembers` — log, then rethrow. */
  async #fetchSingleGroupMembers(groupId: number, force = false): Promise<readonly ActionGroupMemberInfo[]> {
    try {
      return await this.#session.apis.contacts.fetchGroupMemberList(groupId, { force });
    } catch (error) {
      log.warn(
        "group member refresh failed: uin=%s group=%d error=%s",
        this.#session.identity.uin,
        groupId,
        errorText(error),
      );
      throw error;
    }
  }

  /** reference:39641 `getCachedGroupMembers` — the classified rows already on the roster. */
  #cachedGroupMembers(groupId: number): Record<string, unknown>[] {
    const group = this.#session.identity.findGroup(groupId);
    if (!group) return [];
    const identity = this.bridge.identity;
    const rows: Record<string, unknown>[] = [];
    for (const member of group.members?.values() ?? []) {
      rows.push(formatGroupMember(groupId, narrowGroupMember(member), cachedQidianProfile(identity, member.uin)));
    }
    return rows;
  }

  /** reference:39371 `getGroupLevel` — 0 on failure unless `no_cache` asked for a throw. */
  async #groupLevel(groupId: number, noCache: boolean): Promise<number> {
    if (!noCache) {
      const cached = groupLevelCache.get(groupId);
      if (cached && Date.now() - cached.at < GROUP_LEVEL_TTL_MS) return cached.level;
    }
    try {
      const level = (await this.#session.apis.contacts.fetchGroupDetail(groupId))?.level ?? 0;
      groupLevelCache.set(groupId, { level, at: Date.now() });
      return level;
    } catch (error) {
      if (noCache) throw error;
      log.warn(
        "group detail refresh failed, using roster metadata: uin=%s group=%d error=%s",
        this.#session.identity.uin,
        groupId,
        errorText(error),
      );
      return 0;
    }
  }

  /** reference:39549 `strangerCorpInfo` — only for an account the profile flags as qidian. */
  async #strangerCorpInfo(profile: ActionUserProfile): Promise<{ name: string } | null> {
    if (profile.qidianMasterFlag === 0 && profile.qidianCrewFlag === 0) return null;
    try {
      return await this.#session.apis.contacts.fetchQidianCorpInfo(profile.uin);
    } catch {
      return null;
    }
  }

  /**
   * reference:347448 `getOnlineClients`.
   *
   * `null` means "no presence packet has been observed in this session", which the action
   * reports as exactly that — a different fact from "the device list is empty". The
   * projection is only reachable once a presence decoder emits
   * `online_devices_changed`; nothing in this port does yet, and the `null` branch is
   * therefore what a live session answers.
   */
  #onlineClients(): OnlineClientSnapshot[] | null {
    const snapshot = this.#session.getOnlineClients();
    if (snapshot === null) return null;
    return snapshot.map((device) => toOnlineClientSnapshot(device));
  }

  /**
   * `ActionBridge.recallUploadedFile` — the upload-metadata read-back.
   *
   * `UploadedFileMeta` is `{fileId: string; [field: string]: unknown}` on the bridge side,
   * while `ActionUploadedFileMeta` REQUIRES `fileName`/`fileSize`/`fileMd5` because the
   * action turns the md5 into hex UNGUARDED (`Buffer.from(uploaded.fileMd5)`). A row that
   * does not carry them therefore cannot satisfy the contract, and narrowing it to
   * defaults would produce that `Buffer.from(undefined)` TypeError one layer later — so
   * the mismatch is reported here instead.
   *
   * Reachable now: `GroupFileApi.upload` / `uploadPrivate` are implemented and both call
   * `rememberUploadedFile` after a successful OIDB request (reference:289772, :289827), so
   * an entry exists for every upload this process performed. It can still legitimately be
   * ABSENT — the cache is a bounded 1024-entry FIFO (`bridge.ts:473`), and an id from a
   * previous run was never in it. Both readers handle that: `upload_private_file` throws
   * its `metadata missing` wording, and the file-segment send falls back to the segment's
   * own name/size/md5 exactly as the reference's `??` chain does.
   */
  #recallUploadedFile(fileId: string): ActionUploadedFileMeta | undefined {
    const meta = this.#session.recallUploadedFile(fileId);
    if (meta === undefined) return undefined;
    const fileName = meta["fileName"];
    const fileSize = meta["fileSize"];
    const fileMd5 = meta["fileMd5"];
    if (typeof fileName !== "string" || typeof fileSize !== "number" || !(fileMd5 instanceof Uint8Array)) {
      throw new HostContractError(
        "bridge.recallUploadedFile",
        `the upload cache entry for file id ${JSON.stringify(fileId)} does not carry ` +
          "fileName/fileSize/fileMd5, so it cannot satisfy ActionUploadedFileMeta",
      );
    }
    const fileSha1 = meta["fileSha1"];
    const fileHash = meta["fileHash"];
    const scope = meta["scope"];
    return {
      fileId: meta.fileId,
      fileName,
      fileSize,
      fileMd5,
      ...(fileSha1 instanceof Uint8Array ? { fileSha1 } : {}),
      ...(scope === "group" || scope === "private" ? { scope } : {}),
      ...(typeof meta["groupId"] === "number" ? { groupId: meta["groupId"] } : {}),
      ...(typeof meta["userId"] === "number" ? { userId: meta["userId"] } : {}),
      ...(typeof fileHash === "string" ? { fileHash } : {}),
      ...(typeof meta["rememberedAt"] === "number" ? { rememberedAt: meta["rememberedAt"] } : {}),
    };
  }
}

// ===========================================================================
// 4. Module-level caches (the reference keeps these at module scope too)
// ===========================================================================

/** reference:39372 `groupLevelCache`. */
const groupLevelCache = new Map<number, { level: number; at: number }>();
/** reference:39388 `nonMemberGroupCache`, keyed `${uin}:${groupId}`. */
const nonMemberGroupCache = new Map<string, { info: Record<string, unknown>; at: number }>();

// ===========================================================================
// 5. Local projections
// ===========================================================================

/**
 * `{user_id, nickname, remark}` for the three my-device pseudo-contacts.
 * reference:23405 `datalineFriendListEntries` — note `remark` repeats `name`, which is the
 * reference's own choice (a device has no separate remark).
 */
function datalineFriendEntries(): Record<string, unknown>[] {
  return DATALINE_DEVICES.map((device) => ({
    user_id: device.uin,
    nickname: device.name,
    remark: device.name,
  }));
}

/** True when the event carries any segment `refreshMessageMedia` would have refreshed. */
function carriesMedia(event: Record<string, unknown>): boolean {
  const message = event["message"];
  if (!Array.isArray(message)) return false;
  return message.some((segment) => {
    if (typeof segment !== "object" || segment === null || Array.isArray(segment)) return false;
    const type = (segment as Record<string, unknown>)["type"];
    return type === "image" || type === "record" || type === "video";
  });
}

/**
 * One `online_devices_changed` device row, narrowed.
 *
 * The bridge stores the event's device objects as `unknown` (they arrive from a presence
 * decoder that is not ported), so the three fields the action reads are validated rather
 * than coerced: a malformed device is a contract failure, not a reason to report
 * `device_name: "undefined"`.
 */
function toOnlineClientSnapshot(device: unknown): OnlineClientSnapshot {
  if (typeof device !== "object" || device === null || Array.isArray(device)) {
    throw new HostContractError(
      "bridge.getOnlineClients",
      "the presence snapshot contains a non-object device entry",
    );
  }
  const record = device as Record<string, unknown>;
  const appId = record["appId"];
  const deviceName = record["deviceName"];
  const deviceKind = record["deviceKind"];
  if (typeof appId !== "number" && typeof appId !== "string") {
    throw new HostContractError("bridge.getOnlineClients", "a presence device carries no appId");
  }
  if (typeof deviceName !== "string") {
    throw new HostContractError("bridge.getOnlineClients", "a presence device carries no deviceName");
  }
  if (deviceKind !== "computer" && deviceKind !== "pad" && deviceKind !== "phone" && deviceKind !== "unknown") {
    throw new HostContractError(
      "bridge.getOnlineClients",
      `a presence device carries an unknown deviceKind: ${JSON.stringify(deviceKind)}`,
    );
  }
  return { appId, deviceName, deviceKind };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

// ===========================================================================
// 6. Starting a real server from config
// ===========================================================================

/**
 * The `OneBotNetworkContext` the network adapters need — reference:343064
 * `buildNetworkContext`.
 *
 * Two things are worth reading twice:
 *
 *   * `uin` is the bridge's own uin as a STRING. Several URL builders concatenate it, and
 *     `AdapterStatus` tagging parses it back to a number.
 *   * the meta events read LIVE state (`isOnline()`, `receiveHealthy`), so a heartbeat
 *     sent after the packet sender detaches reports `online: false` instead of replaying
 *     whatever was true when the context was built.
 *
 * `api` defaults to the live action API; pass one explicitly to share the bound registry
 * with another caller.
 */
export function createOneBotNetworkContext(
  host: BridgeActionContextHost,
  api: OneBotApi = createOneBotApi({
    createContext: () => host,
    isAcceptingActions: () => host.isAcceptingActions(),
  }),
): OneBotNetworkContext {
  const uin = host.bridge.identity.uin;
  const selfId = Number.parseInt(uin, 10) || 0;

  const status = (): Record<string, unknown> => {
    const online = host.isOnline();
    return {
      // `online && receiveHealthy` — NOT `receiveHealthy` alone. An offline instance must
      // report good:false even while its socket still answers (reference:343168).
      online,
      good: online && host.bridge.receiveHealthy,
    };
  };

  return {
    uin,
    api,
    buildLifecycleEvent: (subType) => ({
      time: Math.floor(Date.now() / 1_000),
      self_id: selfId,
      post_type: "meta_event",
      meta_event_type: "lifecycle",
      sub_type: subType,
      status: status(),
    }),
    buildHeartbeatEvent: () => ({
      time: Math.floor(Date.now() / 1_000),
      self_id: selfId,
      post_type: "meta_event",
      meta_event_type: "heartbeat",
      status: status(),
      interval: HEARTBEAT_INTERVAL_MS,
    }),
  };
}

/**
 * The `OneBotApi` a TRANSPORT should use for this host.
 *
 * `createIdleOneBotApi` is the not-logged-in answer (reference:40032's caller passes it
 * while the account has no session): every action, known or not, answers
 * `retcode 100` with a reason that names the state. Handing a transport the live API for
 * a session with no packet sender instead would make every action fail with a transport
 * error, which is a different — and much less useful — diagnosis.
 */
export function createSessionOneBotApi(
  host: BridgeActionContextHost,
  reason = "not logged in: no packet sender is attached to this bridge session",
): OneBotApi {
  if (!host.isOnline()) return createIdleOneBotApi(reason);
  return createOneBotApi({
    createContext: () => host,
    isAcceptingActions: () => host.isAcceptingActions(),
  });
}

/**
 * Build the network supervisor from config and open every configured adapter.
 *
 * This is the "start a real HTTP server" seam: `OneBotNetworkManager.reconcile` compiles
 * the plan (validating outside its FIFO queue), then opens each adapter against the
 * context above. Runtime failures are DATA in `OperationResult`, so a caller that wants a
 * hard failure has to ask for one — which this function does, by raising an
 * `AggregateError` naming every adapter that failed to open. A half-open topology is
 * never reported as success.
 *
 * The caller owns the returned manager and must `shutdown()` it.
 */
export async function startOneBotNetworks(
  host: BridgeActionContextHost,
  config: OneBotConfigLike,
): Promise<OneBotNetworkManager> {
  const ctx = createOneBotNetworkContext(host);
  const manager = new OneBotNetworkManager({ ctx });
  const result = await manager.reconcile(config);
  if (!result.applied) {
    // Close what DID open before reporting: leaving a listener bound would make the
    // failure look transient on the next attempt.
    await manager.shutdown().catch(() => undefined);
    throw new AggregateError(
      result.errors.map(
        (failure) =>
          new Error(`adapter ${failure.name} (${failure.kind}) failed during ${failure.phase}: ${failure.message}`),
      ),
      `OneBot network topology failed to open for uin ${host.bridge.identity.uin}`,
    );
  }
  return manager;
}

/** Re-exported so a caller does not have to import the provider module to test the reason. */
export { MEDIA_REFRESH_UNSUPPORTED_REASON };
