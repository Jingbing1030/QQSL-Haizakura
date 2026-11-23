// `GroupAdminApi` — the 22 working group-admin actions' bridge surface.
//
// ---------------------------------------------------------------------------
// What this file is, relative to the reference
// ---------------------------------------------------------------------------
// Reference region `src/bridge/apis/group-admin.ts` (reference/index.mjs:234064-
// 234337, 273 lines). The reference class is *entirely* thin: twenty of its
// twenty-two members are a one-line `SomeOidbSpec.invoke(this.ctx, {...})`, and the
// two that are not (`getAdminSettings`, `setMemberPermissions`,
// `setMemberInvitePolicy`, `setNewMemberHistoryVisibility`) are read-back
// verification loops over those same specs.
//
// So the port's job is the adapter: `ActionGroupAdminApi`
// (`ts/src/onebot/actions/context.ts`) speaks `userId`, the specs speak
// `targetUid` / `uid`, and uid resolution is asynchronous — which `OidbSpec.serialize`
// deliberately is not. Every such hop goes through the spec's own
// `*Params` helper (`kickMemberParams`, `setMemberCardParams`, …) rather than
// re-deriving the call.
//
// ---------------------------------------------------------------------------
// The three verification loops, and why they are not paranoia
// ---------------------------------------------------------------------------
// `setMemberInvitePolicy`, `setMemberPermissions` and
// `setNewMemberHistoryVisibility` all:
//
//   1. read the current flag (`0x88d_0`),
//   2. write the new value (`0x89a_0`, which answers `OidbEmpty`),
//   3. read the flag AGAIN and compare the affected bits.
//
// That matters because `0x89a_0` returns nothing at all. A write that the server
// silently drops is indistinguishable from success without the read-back, and the
// action would answer `ok` for a setting the user did not get. Each of the three
// throws a distinct message naming the setting and the group.
//
// `setMemberPermissions` adds two more rules, both copied:
//   * QQ only accepts this write from the group OWNER (#411) — checked locally
//     when `selfUid` and the group's `ownerUid` are both known, and again on
//     `OidbError 1287` because the local check cannot see every case;
//   * the three permissions are written in THREE SEPARATE PACKETS with the flag
//     merged between them, because the command carries one privilege mask per
//     call. Batching them would silently drop two of three.
//
// ---------------------------------------------------------------------------
// What is NOT here, and why
// ---------------------------------------------------------------------------
// `setRobotAddOption` and `setRemark`/`getAtAllRemain` exist in the reference but
// no action in this port reaches them, so they are omitted rather than declared:
// `ActionGroupAdminApi` is the complete requirement list and adding surface no
// action calls would be inventing API. `setAddRequest` is likewise absent from
// `ActionGroupAdminApi` (it belongs to `set_group_add_request`, not in this batch)
// and is therefore also absent here.

import { createLogger } from "../../onebot/log.js";
import type { BridgeContext } from "../context.js";
import { oidbCaller } from "../oidb-invoke.js";
import { OidbError } from "../../oidb/envelope.js";
import type {
  GroupAdminPermissions,
  GroupAdminSettings,
  GroupCategoryTag,
  MemberInvitePolicy,
} from "../../onebot/actions/context.js";
import {
  // 0x8a7_0, 0xf16_0, 0x88d_0 — thin forwarders added with the method-level parity audit
  GetAtAllRemain,
  SetGroupRemark,
  // 0x8a0_1
  KickMember,
  KickMembers,
  kickMemberParams,
  kickMembersParams,
  // 0x1253_1
  MuteMember,
  // 0x89a_0
  SetGroupWholeBan,
    SetAddRequest,
    ModifyGroupExtInfo,
  SetGroupAddOption,
  SetGroupSearch,
  SetGroupMemberInvitePolicy,
  SetGroupNewMemberHistoryVisibility,
  SetGroupMemberPermissions,
  SetGroupName,
  MEMBER_INVITE_PRIVILEGE_MASK,
  GROUP_MEMBER_PERMISSION_MASKS,
  HISTORY_VISIBLE_FLAG,
  mergeMemberInvitePrivilegeFlag,
  mergeGroupMemberPermission,
  decodeMemberInvitePolicy,
  decodeGroupMemberPermissions,
  type GroupMemberPermission,
  // 0x1096_1 / 0x1097_1
  SetGroupAdmin,
  SetGroupLeave,
  setAdminParams,
  // 0x8fc_1 / 0x8fc_2
  SetMemberCard,
  SetSpecialTitle,
  setMemberCardParams,
  setSpecialTitleParams,
  // 0x9164_2 / 0x9c1c_1 / 0x904_1
  GetAdminPermissions,
  SetAdminPermissions,
  GetAdminReceiveVerify,
  SetAdminReceiveVerify,
  adminPermissionsSnapshot,
  receiveVerifyEnabled,
  confirmSetAdminReceiveVerify,
  // 0x967c_0 / 0x967d_0 / 0x967e_0
  GetGroupCategoryTags,
  AddGroupCategoryTag,
  DeleteGroupCategoryTag,
  // 0x88d_0 — NOTE: the barrel exposes 0x88d's spec ONLY under this alias.
  // `FetchGroupDetail` alone is 0xfe5_2's group-LIST spec, a different command
  // with a different params type; importing the unaliased name and renaming it
  // here would silently pick that one up (the compiler catches it only because
  // the params field is `groupId` there and `groupUin` here).
  FetchGroupDetailInfo,
  type GroupDetailResults,
  // 0xef0_1
  FetchGroupExtInfo,
} from "../../oidb/services/index.js";

const log = createLogger("Bridge.GroupAdmin");

/**
 * `MEMBER_PERMISSIONS_OWNER_ONLY` (reference/index.mjs:234072), verbatim.
 *
 * The wording is user-visible: `set_group_member_permissions` surfaces it as the
 * action's failure message, so it is copied rather than paraphrased.
 */
export const MEMBER_PERMISSIONS_OWNER_ONLY = "only the group owner can change group member permissions";

/** `OidbError 1287` is the server's own "you are not the owner" code (:234191). */
const OWNER_ONLY_OIDB_CODE = 1287;

/**
 * "New members can read history" out of `groupFlagExt4`.
 *
 * Reference `decodeGroupHistoryVisibility` (:226317). TWO ways to be visible, not
 * one: the field is either the legacy literal `1` or bit 2 of the modern flag. A
 * decoder that only tests the bit reports `false` for every group still on the old
 * encoding.
 */
export function decodeGroupHistoryVisibility(groupFlagExt4: number): boolean {
  if (!Number.isInteger(groupFlagExt4) || groupFlagExt4 < 0 || groupFlagExt4 > 4_294_967_295) {
    throw new Error("group history flag must be an unsigned 32-bit integer");
  }
  return groupFlagExt4 === 1 || (groupFlagExt4 & HISTORY_VISIBLE_FLAG) !== 0;
}

// The four live spec callables. Built once at module scope rather than per Bridge:
// `oidbCaller` is a pure closure over the spec object, so there is nothing
// per-session in it.
const kickMemberCall = oidbCaller(KickMember);
const kickMembersCall = oidbCaller(KickMembers);
const muteMemberCall = oidbCaller(MuteMember);
const muteAllCall = oidbCaller(SetGroupWholeBan);
const setAddRequestCall = oidbCaller(SetAddRequest);
const modifyGroupExtInfoCall = oidbCaller(ModifyGroupExtInfo);
const setAddOptionCall = oidbCaller(SetGroupAddOption);
const setSearchCall = oidbCaller(SetGroupSearch);
const setMemberInvitePolicyCall = oidbCaller(SetGroupMemberInvitePolicy);
const setNewMemberHistoryVisibilityCall = oidbCaller(SetGroupNewMemberHistoryVisibility);
const setMemberPermissionCall = oidbCaller(SetGroupMemberPermissions);
const setGroupNameCall = oidbCaller(SetGroupName);
const setAdminCall = oidbCaller(SetGroupAdmin);
const leaveGroupCall = oidbCaller(SetGroupLeave);
const setMemberCardCall = oidbCaller(SetMemberCard);
const setSpecialTitleCall = oidbCaller(SetSpecialTitle);
const getAdminPermissionsCall = oidbCaller(GetAdminPermissions);
const setAdminPermissionsCall = oidbCaller(SetAdminPermissions);
const getAdminReceiveVerifyCall = oidbCaller(GetAdminReceiveVerify);
const setAdminReceiveVerifyCall = oidbCaller(SetAdminReceiveVerify);
const listCategoryTagsCall = oidbCaller(GetGroupCategoryTags);
const addCategoryTagCall = oidbCaller(AddGroupCategoryTag);
const removeCategoryTagCall = oidbCaller(DeleteGroupCategoryTag);
const fetchGroupDetailCall = oidbCaller(FetchGroupDetailInfo);
const fetchGroupExtInfoCall = oidbCaller(FetchGroupExtInfo);

/**
 * The `resolveUid` adapter the specs' `*Params` helpers take.
 *
 * Their signature is `(userId: number | bigint, groupId?: number | bigint)` while
 * `BridgeContext.resolveUserUid` is `(uin: number | string, groupId?: number)`, so
 * the two `bigint` positions have to be narrowed. Both are QQ numbers below 2^32
 * in practice, and narrowing here — once — is better than five copies of the same
 * `typeof x === "bigint" ? Number(x) : x`.
 */
function resolveUidWith(ctx: BridgeContext) {
  return (uin: number | bigint, groupId?: number | bigint): Promise<string> =>
    ctx.resolveUserUid(
      typeof uin === "bigint" ? Number(uin) : uin,
      groupId === undefined ? undefined : typeof groupId === "bigint" ? Number(groupId) : groupId,
    );
}

/** The privilege-flag view `setMemberPermissions` / the two policy writes need. */
interface GroupPrivilegeState {
  privilegeFlag: number;
  ownerUid: string;
}

/**
 * The group-admin API.
 *
 * Reference `var GroupAdminApi = class` at reference/index.mjs:234073. Every public
 * method below has the reference's own signature; the two `#` helpers are the
 * reference's `fetchGroupPrivilegeFlag` / `fetchGroupPrivilegeState`, made private
 * because nothing outside the class calls them.
 */
const getAtAllRemainCall = oidbCaller(GetAtAllRemain);
const setGroupRemarkCall = oidbCaller(SetGroupRemark);

export class GroupAdminApi {
  readonly #ctx: BridgeContext;

  constructor(ctx: BridgeContext) {
    this.#ctx = ctx;
  }

  /**
   * `set_group_add_request` — approve or reject one pending join/invite request.
   *
   * Lives on `groupAdmin` (not `contacts`) because it is a WRITE on a group's request
   * inbox: reading the inbox is `contacts`, answering it is administration. The reference
   * draws the line the same way (`bridge.apis.groupAdmin.setAddRequest`,
   * reference:234212).
   *
   * `eventType` selects the operation semantics (an invite is answered differently from a
   * join), so it comes from the inbox row rather than from the caller's `sub_type` string —
   * the row is what the server sent. `filtered` picks the sub-command: the two inboxes are
   * two different queues and a request only exists in one of them.
   *
   * `reason` becomes the single-space placeholder when empty, so a rejection with no wording
   * still carries a message field (see `EMPTY_REASON_PLACEHOLDER`'s note in 0x10c8.ts).
   */
  async setAddRequest(
    groupId: number,
    sequence: number | bigint,
    eventType: number,
    approve: boolean,
    reason = "",
    filtered = false,
    operateTransInfo?: Uint8Array | undefined,
  ): Promise<void> {
    return setAddRequestCall.invoke(this.#ctx, {
      groupId,
      sequence,
      eventType,
      approve,
      reason,
      filtered,
      operateTransInfo,
    });
  }

  /**
   * `set_group_robot_add_option` — how the group treats bot invitations.
   *
   * Two independent switches ride one `0xf00_3` call:
   * `inviteRobotMemberSwitch` (whether a bot may be invited at all) and
   * `inviteRobotMemberExamine` (whether an invitation needs admin approval).
   *
   * ⚠️ An OMITTED switch is not the same as `0`. The encoder only writes a field when the
   * argument is not `undefined`, so passing `undefined` leaves that setting untouched while
   * passing `0` clears it. Deciding "unset" with `?? 0` would silently disable a switch the
   * caller never mentioned — that is the whole reason both are optional here.
   */
  async setRobotAddOption(
    groupId: number,
    robotMemberSwitch?: number | undefined,
    robotMemberExamine?: number | undefined,
  ): Promise<void> {
    return modifyGroupExtInfoCall.invoke(this.#ctx, {
      groupId,
      robotMemberSwitch,
      robotMemberExamine,
    });
  }

  // -------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------

  /** `set_group_kick`. Returns void; per-member codes are converted to an error by the spec. */
  async kickMember(groupId: number, userId: number, reject: boolean): Promise<void> {
    const params = await kickMemberParams({ groupId, userId, reject }, resolveUidWith(this.#ctx));
    await kickMemberCall.invoke(this.#ctx, params);
  }

  /** `set_group_kick_members` — one packet with the whole uid list. */
  async kickMembers(groupId: number, userIds: readonly number[], reject: boolean): Promise<void> {
    const params = await kickMembersParams({ groupId, userIds, reject }, resolveUidWith(this.#ctx));
    await kickMembersCall.invoke(this.#ctx, params);
  }

  /**
   * `set_group_ban`. `duration` is SECONDS and 0 lifts the mute.
   *
   * The reference passes `duration` straight through and the spec writes it as
   * `?? 0`, so 0 is a real value ("unmute"), not an omission.
   */
  async muteMember(groupId: number, userId: number, duration: number): Promise<void> {
    const targetUid = await this.#ctx.resolveUserUid(userId, groupId);
    if (!targetUid) throw new Error(`failed to resolve uid for ${String(userId)}`);
    await muteMemberCall.invoke(this.#ctx, { groupId, targetUid, duration });
  }

  /** `set_group_whole_ban` — `enable=true` writes 0xffffffff, not a duration. */
  async muteAll(groupId: number, enable: boolean): Promise<void> {
    await muteAllCall.invoke(this.#ctx, { groupId, enable });
  }

  // -------------------------------------------------------------------------
  // Join / search settings
  // -------------------------------------------------------------------------

  async setAddOption(
    groupId: number,
    addType: number,
    groupQuestion?: string | undefined,
    groupAnswer?: string | undefined,
  ): Promise<void> {
    // Built conditionally because `exactOptionalPropertyTypes` distinguishes
    // `{ groupQuestion: undefined }` from `{}`, and the spec's own `serialize`
    // tests `!== undefined` — so an explicit undefined and an absent key happen to
    // agree today, but writing the narrower object keeps them agreeing.
    const params: {
      groupId: number;
      addType: number;
      groupQuestion?: string | undefined;
      groupAnswer?: string | undefined;
    } = { groupId, addType };
    if (groupQuestion !== undefined) params.groupQuestion = groupQuestion;
    if (groupAnswer !== undefined) params.groupAnswer = groupAnswer;
    await setAddOptionCall.invoke(this.#ctx, params);
  }

  async setSearch(
    groupId: number,
    noFingerOpen?: number | undefined,
    noCodeFingerOpen?: number | undefined,
  ): Promise<void> {
    const params: { groupId: number; noFingerOpen?: number | undefined; noCodeFingerOpen?: number | undefined } = {
      groupId,
    };
    if (noFingerOpen !== undefined) params.noFingerOpen = noFingerOpen;
    if (noCodeFingerOpen !== undefined) params.noCodeFingerOpen = noCodeFingerOpen;
    await setSearchCall.invoke(this.#ctx, params);
  }

  /**
   * `set_group_member_invite_policy`, with read-back verification.
   *
   * The whole policy lives in three NON-ADJACENT bits of the privilege flag
   * (mask 0x6100000), so the write is "clear the mask, or in the new bits, leave
   * everything else alone". The read-back compares only the masked bits, which is
   * why it does not false-fail when the server also touches an unrelated flag.
   */
  async setMemberInvitePolicy(groupId: number, policy: MemberInvitePolicy): Promise<void> {
    const current = await this.#fetchGroupPrivilegeFlag(groupId, "group member invite policy", "before update");
    const expected = mergeMemberInvitePrivilegeFlag(current, policy);
    await setMemberInvitePolicyCall.invoke(this.#ctx, { groupId, currentPrivilegeFlag: current, policy });
    const actual = await this.#fetchGroupPrivilegeFlag(groupId, "group member invite policy", "after update");
    const mask = BigInt(MEMBER_INVITE_PRIVILEGE_MASK);
    if ((BigInt(actual) & mask) !== (BigInt(expected) & mask)) {
      throw new Error(`group member invite policy was not applied for group ${groupId}`);
    }
  }

  /**
   * `set_group_new_member_history_visibility`, with read-back verification.
   *
   * Compares the DECODED boolean, not the raw flag: `true` is expressible two ways
   * (`1` or bit 2), so a raw comparison would reject a server that normalises the
   * legacy form.
   */
  async setNewMemberHistoryVisibility(groupId: number, visible: boolean): Promise<void> {
    await setNewMemberHistoryVisibilityCall.invoke(this.#ctx, { groupId, visible });
    const after = await this.#fetchGroupFlagExt4(groupId, "after update");
    if (decodeGroupHistoryVisibility(after) !== visible) {
      throw new Error(`new-member history visibility was not applied for group ${groupId}`);
    }
  }

  /**
   * `set_group_member_permissions` — owner-only, one packet per permission.
   *
   * Read this together with `GROUP_MEMBER_PERMISSION_MASKS`'s comment: a SET bit
   * means the permission is DENIED, so `mergeGroupMemberPermission` clears the bit
   * to allow. The mask sent on the wire is the single permission's own mask, which
   * is why three permissions need three packets.
   */
  async setMemberPermissions(
    groupId: number,
    permissions: {
      allowMemberUploadAlbum?: boolean | undefined;
      allowMemberTemporarySession?: boolean | undefined;
      allowMemberCreateGroup?: boolean | undefined;
    },
  ): Promise<void> {
    const updates: readonly (readonly [GroupMemberPermission, boolean | undefined])[] = [
      ["upload_album", permissions.allowMemberUploadAlbum],
      ["temporary_session", permissions.allowMemberTemporarySession],
      ["create_group", permissions.allowMemberCreateGroup],
    ];
    if (!updates.some(([, allow]) => allow !== undefined)) {
      throw new Error("at least one member permission must be specified");
    }

    const before = await this.#fetchGroupPrivilegeState(groupId, "group member permissions", "before update");
    const selfUid = this.#ctx.identity.selfUid;
    // Local pre-check. A missing `selfUid` or a missing `ownerUid` SKIPS the check
    // rather than failing: both are roster data this layer does not own, and the
    // server-side 1287 path below still catches the real rejection.
    if (selfUid && before.ownerUid && selfUid !== before.ownerUid) {
      throw new Error(MEMBER_PERMISSIONS_OWNER_ONLY);
    }

    let expected = before.privilegeFlag;
    let combinedMask = 0n;
    for (const [permission, allow] of updates) {
      if (allow === undefined) continue;
      try {
        await setMemberPermissionCall.invoke(this.#ctx, {
          groupId,
          currentPrivilegeFlag: expected,
          permission,
          allow,
        });
      } catch (error) {
        if (error instanceof OidbError && error.code === OWNER_ONLY_OIDB_CODE) {
          throw new Error(MEMBER_PERMISSIONS_OWNER_ONLY);
        }
        throw error;
      }
      expected = mergeGroupMemberPermission(expected, permission, allow);
      combinedMask |= BigInt(GROUP_MEMBER_PERMISSION_MASKS[permission]);
    }

    const actual = await this.#fetchGroupPrivilegeFlag(groupId, "group member permissions", "after update");
    if ((BigInt(actual) & combinedMask) !== (BigInt(expected) & combinedMask)) {
      throw new Error(`group member permissions were not applied for group ${groupId}`);
    }
  }

  async #fetchGroupPrivilegeFlag(groupId: number, setting: string, phase: string): Promise<number> {
    return (await this.#fetchGroupPrivilegeState(groupId, setting, phase)).privilegeFlag;
  }

  async #fetchGroupPrivilegeState(
    groupId: number,
    setting: string,
    phase: string,
  ): Promise<GroupPrivilegeState> {
    const results = (await fetchGroupDetailCall.invoke(this.#ctx, { groupUin: groupId })).groupInfo?.results;
    if (!results) throw new Error(`unable to read ${setting} ${phase} for group ${groupId}`);
    return { privilegeFlag: results.privilegeFlag ?? 0, ownerUid: results.ownerUid };
  }

  async #fetchGroupFlagExt4(groupId: number, phase: string): Promise<number> {
    const results = (await fetchGroupDetailCall.invoke(this.#ctx, { groupUin: groupId })).groupInfo?.results;
    if (!results) {
      throw new Error(`unable to read new-member history visibility ${phase} for group ${groupId}`);
    }
    return results.groupFlagExt4 ?? 0;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * `get_group_admin_settings` — TWELVE fields, assembled from two commands.
   *
   * `0x88d_0` supplies eight (`add_type` … `no_code_finger_open` minus the two
   * robot ones); `0xef0_1` supplies `robot_member_switch` /
   * `robot_member_examine`. The two run CONCURRENTLY, and the key order below is
   * the reference's (:234087) because the action's response is `okResponse(settings)`
   * and a diagnostic diff of the JSON would otherwise reorder.
   *
   * The read is fatal when `0x88d_0` answers no `results` — there is no sensible
   * default for "the server does not know this group".
   */
  async getAdminSettings(groupId: number): Promise<GroupAdminSettings> {
    const [detail, robot] = await Promise.all([
      fetchGroupDetailCall.invoke(this.#ctx, { groupUin: groupId }),
      fetchGroupExtInfoCall.invoke(this.#ctx, { groupId }),
    ]);
    const results: GroupDetailResults | undefined = detail.groupInfo?.results;
    if (!results) throw new Error(`unable to read group admin settings for group ${groupId}`);
    const privilegeFlag = results.privilegeFlag ?? 0;
    const permissions = decodeGroupMemberPermissions(privilegeFlag);
    return {
      add_type: results.addType ?? 0,
      group_question: results.question ?? "",
      group_answer: results.answer ?? "",
      robot_member_switch: robot.robotMemberSwitch,
      robot_member_examine: robot.robotMemberExamine,
      member_invite_policy: decodeMemberInvitePolicy(privilegeFlag),
      allow_member_upload_album: permissions.upload_album,
      allow_member_temporary_session: permissions.temporary_session,
      allow_member_create_group: permissions.create_group,
      new_member_history_visible: decodeGroupHistoryVisibility(results.groupFlagExt4 ?? 0),
      no_finger_open: results.noFingerOpen ?? 0,
      no_code_finger_open: results.noCodeFingerOpen ?? 0,
    };
  }

  /** `get_group_tags` — the `{ tags }` wrapper is the reference's (:234149). */
  async listCategoryTags(groupClass: number): Promise<{ tags: GroupCategoryTag[] }> {
    return listCategoryTagsCall.invoke(this.#ctx, { groupClass });
  }

  /**
   * `add_group_tag` / `delete_group_tag`.
   *
   * `0x967d_0` / `0x967e_0`, keyed by `group_class` NOT `group_id` — QQ's tag
   * taxonomy is a small global enum, not per-group storage, which is why the three
   * tag actions take `group_class` and why `get_group_tags` takes no group at all in
   * the reference. Passing a group id here would still "work" (any uint32 encodes)
   * and would silently write a tag onto an unrelated class.
   */
  async addCategoryTag(groupClass: number, name: string): Promise<void> {
    await addCategoryTagCall.invoke(this.#ctx, { groupClass, name });
  }

  /** See `addCategoryTag` for the `group_class` warning. */
  async removeCategoryTag(groupClass: number, name: string): Promise<void> {
    await removeCategoryTagCall.invoke(this.#ctx, { groupClass, name });
  }

  /**
   * `get_group_admin_permissions` — two commands, merged.
   *
   * `0x9164_2` addresses the target by UIN and `0x9c1c_4` (the receive-verify read)
   * by UID, so this method resolves the uid once and passes both forms. The
   * receive-verify answer is **tri-state**: `null` means the server said nothing,
   * which is different from "off" — see `receiveVerifyEnabled`.
   */
  async getAdminPermissions(groupId: number, userId: number): Promise<GroupAdminPermissions> {
    const logger = log.child({ uin: Number(this.#ctx.identity.uin) });
    logger.debug("Reading administrator permissions group=%s user=%s", groupId, userId);
    const userUid = await this.#ctx.resolveUserUid(userId, groupId);
    if (!userUid) throw new Error(`failed to resolve uid for ${String(userId)}`);
    const [permissionsBody, verifyBody] = await Promise.all([
      getAdminPermissionsCall.invoke(this.#ctx, { groupId, userId }),
      getAdminReceiveVerifyCall.invoke(this.#ctx, { groupId, userUid }),
    ]);
    const snapshot = adminPermissionsSnapshot(permissionsBody, { groupId, userId });
    const receiveVerify = receiveVerifyEnabled(verifyBody, { groupId, userUid });
    logger.debug(
      "Administrator permissions received group=%s user=%s recall=%s kick=%s limit=%s receiveVerify=%s",
      groupId,
      userId,
      snapshot.recallMemberMessage,
      snapshot.kickMember,
      snapshot.kickMemberPerDay,
      receiveVerify,
    );
    return {
      group_id: groupId,
      user_id: userId,
      recall_member_message: snapshot.recallMemberMessage,
      kick_member: snapshot.kickMember,
      kick_member_per_day: snapshot.kickMemberPerDay,
      receive_verify: receiveVerify,
    };
  }

  // -------------------------------------------------------------------------
  // Administration
  // -------------------------------------------------------------------------

  async setAdmin(groupId: number, userId: number, enable: boolean): Promise<void> {
    const params = await setAdminParams({ groupId, userId, enable }, resolveUidWith(this.#ctx));
    await setAdminCall.invoke(this.#ctx, params);
  }

  /**
   * `set_group_admin_permissions`.
   *
   * The spec's own `serialize` enforces the three rules (at least one capability,
   * `kick_member=true` needs an allowed `kick_member_per_day`, and a per-day value
   * needs `kick_member=true`), so they are NOT re-checked here — a second copy is
   * how the two drift apart. The action layer has its own copy in `rules:` so the
   * failure arrives as 1400 before `run` is even entered; this layer's copy is the
   * one that protects a direct bridge caller.
   */
  async setAdminPermissions(
    groupId: number,
    userId: number,
    patch: {
      recallMemberMessage?: boolean | undefined;
      kickMember?: boolean | undefined;
      kickMemberPerDay?: number | undefined;
    },
  ): Promise<void> {
    const logger = log.child({ uin: Number(this.#ctx.identity.uin) });
    logger.debug(
      "Setting administrator permissions group=%s user=%s recall=%s kick=%s limit=%s",
      groupId,
      userId,
      patch.recallMemberMessage,
      patch.kickMember,
      patch.kickMemberPerDay,
    );
    const params: {
      groupId: number;
      userId: number;
      recallMemberMessage?: boolean | undefined;
      kickMember?: boolean | undefined;
      kickMemberPerDay?: number | undefined;
    } = { groupId, userId };
    if (patch.recallMemberMessage !== undefined) params.recallMemberMessage = patch.recallMemberMessage;
    if (patch.kickMember !== undefined) params.kickMember = patch.kickMember;
    if (patch.kickMemberPerDay !== undefined) params.kickMemberPerDay = patch.kickMemberPerDay;
    await setAdminPermissionsCall.invoke(this.#ctx, params);
    logger.debug("Administrator permissions acknowledged group=%s user=%s", groupId, userId);
  }

  /**
   * `set_group_admin_receive_verify`.
   *
   * The write answers an envelope whose result must CONFIRM the target, so the
   * body is checked rather than discarded: "acknowledged but not applied" is the
   * one outcome a caller must not read as success.
   */
  async setAdminReceiveVerify(groupId: number, userId: number, enable: boolean): Promise<void> {
    const logger = log.child({ uin: Number(this.#ctx.identity.uin) });
    logger.debug("Setting administrator receive-verify group=%s user=%s enable=%s", groupId, userId, enable);
    const params = { groupId, userId, enable };
    const body = await setAdminReceiveVerifyCall.invoke(this.#ctx, params);
    confirmSetAdminReceiveVerify(body, params);
    logger.debug("Administrator receive-verify confirmed group=%s user=%s", groupId, userId);
  }

  // -------------------------------------------------------------------------
  // Identity within the group
  // -------------------------------------------------------------------------

  async setCard(groupId: number, userId: number, card: string): Promise<void> {
    const params = await setMemberCardParams({ groupId, userId, card }, resolveUidWith(this.#ctx));
    await setMemberCardCall.invoke(this.#ctx, params);
  }

  async setName(groupId: number, name: string): Promise<void> {
    await setGroupNameCall.invoke(this.#ctx, { groupId, name });
  }

  /**
   * `set_group_leave`.
   *
   * Three steps, and the order is the reference's (:234247): send the packet, emit
   * `group_member_leave` (so every OneBot client learns the bot is gone BEFORE the
   * roster drops the group), then forget the group. Emitting after the forget would
   * still work, but a subscriber that re-reads the roster inside the handler would
   * already see the group missing — and the reference's own handlers do look it up.
   */
  async leave(groupId: number): Promise<void> {
    await leaveGroupCall.invoke(this.#ctx, { groupId });
    const selfUin = Number(this.#ctx.identity.uin) || 0;
    const selfUid = this.#ctx.identity.selfUid ?? "";
    await this.#ctx.events.emit({
      kind: "group_member_leave",
      time: Math.floor(Date.now() / 1_000),
      selfUin,
      groupId,
      userUin: selfUin,
      operatorUin: selfUin,
      userUid: selfUid,
      operatorUid: selfUid,
      leaveType: "leave",
    });
    this.#ctx.identity.forgetGroup(groupId);
  }

  async setSpecialTitle(groupId: number, userId: number, title: string): Promise<void> {
    const params = await setSpecialTitleParams({ groupId, userId, title }, resolveUidWith(this.#ctx));
    await setSpecialTitleCall.invoke(this.#ctx, params);
  }

  /**
   * `get_group_at_all_remain` — how many @-all mentions the group may still use today.
   *
   * `GetAtAllRemain` was ported with the rest of `0x8a7`; only this forwarder was absent,
   * so the live action answered "at-all remain is unavailable" for a spec that existed.
   */
  async getAtAllRemain(groupId: number): Promise<unknown> {
    // `selfUin` is required by the request and the action supplies only the group, so it is
    // read from the identity — the same rule the spec documents for `SendGroupSign`.
    return getAtAllRemainCall.invoke(this.#ctx, { groupId, selfUin: Number(this.#ctx.identity.uin) });
  }

  /**
   * `set_group_remark` — the group's remark as seen by the bot.
   *
   * Distinct from `set_group_card` (a per-member card) and `set_friend_remark`.
   */
  setRemark(groupId: number, remark: string): Promise<void> {
    return setGroupRemarkCall.invoke(this.#ctx, { groupId, remark });
  }

  /**
   * Read `groupFlagExt4` — the new-member history-visibility bitfield.
   *
   * `phase` is not decoration: it names the step in the caller's read-modify-write
   * ("read before" / "verify after"), and the reference puts it in the error message so a
   * failure says WHICH half of the operation broke. Dropping it would leave the two
   * failures indistinguishable.
   */
  async fetchGroupFlagExt4(groupId: number, phase: string): Promise<number> {
    const results = (await fetchGroupDetailCall.invoke(this.#ctx, { groupUin: groupId })).groupInfo
      ?.results;
    if (!results) {
      throw new Error(`unable to read new-member history visibility ${phase} for group ${groupId}`);
    }
    return results.groupFlagExt4 ?? 0;
  }

  /**
   * Read the privilege flag and owner uid together.
   *
   * One `FetchGroupDetail` answers both, which is why they are returned as a pair: two
   * separate reads could straddle a change and disagree.
   */
  async fetchGroupPrivilegeState(
    groupId: number,
    setting: string,
    phase: string,
  ): Promise<{ privilegeFlag: number; ownerUid: string | undefined }> {
    const results = (await fetchGroupDetailCall.invoke(this.#ctx, { groupUin: groupId })).groupInfo
      ?.results;
    if (!results) throw new Error(`unable to read ${setting} ${phase} for group ${groupId}`);
    return { privilegeFlag: results.privilegeFlag ?? 0, ownerUid: results.ownerUid };
  }

  /** Just the flag half of {@link fetchGroupPrivilegeState}. */
  async fetchGroupPrivilegeFlag(
    groupId: number,
    setting: string,
    phase: string,
  ): Promise<number> {
    return (await this.fetchGroupPrivilegeState(groupId, setting, phase)).privilegeFlag;
  }
}
