// OidbSvcTrpcTcp.0x89a_0 — the group-settings family (sub-commands 0 and 15).
//
// ---------------------------------------------------------------------------
// One command, seven request shapes
// ---------------------------------------------------------------------------
// 0x89a_0 is not one operation. The group-settings endpoint multiplexes by
// *which settings submessage you populate*, and the submessage carries the
// settings at field numbers in the 16..43 range.  Six OneBot actions share
// sub-command 0 and differ only in that submessage; a seventh
// (`set_group_name`) uses sub-command 15 with an entirely different body.
//
//   action                              sub  body
//   set_group_whole_ban                  0   muteState{17}
//   set_group_add_option                 0   settings{16,30,31}
//   set_group_search                     0   settings{35,36}
//   set_group_member_invite_policy       0   settings{23,24,29}
//   set_group_new_member_history_...     0   settings{42,43}
//   set_group_member_permissions         0   settings{23,24}
//   set_group_name                      15   body{3}
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   0x89a_0 common shape (all six settings variants):
//     1  groupUin  uint64
//     2  settings  message   (the variant submessage)
//     12 field12   uint32    always 0 in the reference, i.e. never emitted
//
//   MuteAll          reference/index.mjs:209521 / state at :209584
//     1 groupUin, 2 muteState{ 17 state uint32 }
//   AddOption        reference/index.mjs:211694 / :211777..:211829
//     1 groupUin, 2 settings{ 16 addType, 30 groupQuestion, 31 groupAnswer }, 12 field12
//   Search           reference/index.mjs:228418 / :228492
//     1 groupUin, 2 settings{ 35 noFingerOpen, 36 noCodeFingerOpen }, 12 field12
//   InvitePolicy     reference/index.mjs:225028 / :225109
//     1 groupUin, 2 settings{ 23 appPrivilegeFlag, 24 appPrivilegeMask, 29 allowMemberInvite }
//   HistoryVisibility reference/index.mjs:226187 / :226261
//     1 groupUin, 2 settings{ 42 groupFlagExt4, 43 groupFlagExt4Mask }
//   MemberPermission  reference/index.mjs:227295 / :227369
//     1 groupUin, 2 settings{ 23 appPrivilegeFlag, 24 appPrivilegeMask }
//
//   0x89a_15 set_group_name, reference/index.mjs:220472
//     1 groupUin  uint32
//     2 body      message { 3 targetName string }
//
// ---------------------------------------------------------------------------
// Two things that look like bugs and are not
// ---------------------------------------------------------------------------
// 1. `field12` is set to 0 by the reference in five of the six settings
//    variants.  Because proto3 drops zero-valued varints, it never reaches the
//    wire.  It is preserved in the types (and tested as absent on the wire) so a
//    future change cannot quietly start emitting it.
// 2. The settings field numbers start at 16, not 1.  They are sub-fields of the
//    `settings` submessage, so their numbers are independent of the envelope's —
//    17 here has nothing to do with the envelope's field 17 (which does not exist).

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 2202 = 0x89a. */
export const GROUP_SETTINGS_COMMAND = 0x89a;

/** Sub-command 0 — settings. Shared by six actions. */
export const GROUP_SETTINGS_SUB_COMMAND = 0;

/** Sub-command 15 — rename. */
export const RENAME_GROUP_SUB_COMMAND = 15;

/** The common wrapper every sub-command-0 variant uses. */
export const GroupSettingsEnvelopeField = { groupUin: 1, settings: 2, field12: 12 } as const;

// ---------------------------------------------------------------------------
// Variant submessages
// ---------------------------------------------------------------------------

export const MuteAllStateField = { state: 17 } as const;
export const AddOptionSettingsField = { addType: 16, groupQuestion: 30, groupAnswer: 31 } as const;
export const SearchSettingsField = { noFingerOpen: 35, noCodeFingerOpen: 36 } as const;
export const InvitePolicySettingsField = {
  appPrivilegeFlag: 23,
  appPrivilegeMask: 24,
  allowMemberInvite: 29,
} as const;
export const HistoryVisibilitySettingsField = { groupFlagExt4: 42, groupFlagExt4Mask: 43 } as const;
export const MemberPermissionSettingsField = { appPrivilegeFlag: 23, appPrivilegeMask: 24 } as const;

// The shared wrapper bodies (field 1 + field 2 + field 12), per variant.

export interface MuteAllBody {
  groupUin: bigint;
  muteState: { state: number };
}

export interface AddOptionBody {
  groupUin: bigint;
  settings: { addType: number; groupQuestion?: string; groupAnswer?: string };
  field12: number;
}

export interface SearchBody {
  groupUin: bigint;
  settings: { noFingerOpen?: number; noCodeFingerOpen?: number };
  field12: number;
}

export interface InvitePolicyBody {
  groupUin: bigint;
  settings: { appPrivilegeFlag: number; appPrivilegeMask: number; allowMemberInvite?: number };
  field12: number;
}

export interface HistoryVisibilityBody {
  groupUin: bigint;
  settings: { groupFlagExt4: number; groupFlagExt4Mask: number };
  field12: number;
}

export interface MemberPermissionBody {
  groupUin: bigint;
  settings: { appPrivilegeFlag: number; appPrivilegeMask: number };
  field12: number;
}

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

export function encodeMuteAll(body: MuteAllBody): Uint8Array {
  // `state` uses the `!= null` presence rule, so an explicit 0 IS sent: it is
  // the "turn whole-ban off" command and dropping it would be a no-op request.
  const state = new ProtoWriter().uint32Present(MuteAllStateField.state, body.muteState.state).finish();
  return new ProtoWriter().uint64(GroupSettingsEnvelopeField.groupUin, body.groupUin).message(GroupSettingsEnvelopeField.settings, state).finish();
}

export function encodeAddOption(body: AddOptionBody): Uint8Array {
  // `addType` is `!= null && !== 0`; the question and answer are `!= null`, so
  // an intentionally-cleared answer goes out as an empty string rather than
  // disappearing (reference/index.mjs:211777-211829).
  const settings = new ProtoWriter()
    .uint32(AddOptionSettingsField.addType, body.settings.addType)
    .stringPresent(AddOptionSettingsField.groupQuestion, body.settings.groupQuestion)
    .stringPresent(AddOptionSettingsField.groupAnswer, body.settings.groupAnswer)
    .finish();
  return new ProtoWriter()
    .uint64(GroupSettingsEnvelopeField.groupUin, body.groupUin)
    .message(GroupSettingsEnvelopeField.settings, settings)
    .uint32(GroupSettingsEnvelopeField.field12, body.field12)
    .finish();
}

export function encodeSearch(body: SearchBody): Uint8Array {
  // Both flags are `!= null`: an explicit 0 means "off" and must reach the
  // server. Only an *absent* parameter means "leave alone"
  // (reference/index.mjs:228492).
  const settings = new ProtoWriter()
    .uint32Present(SearchSettingsField.noFingerOpen, body.settings.noFingerOpen)
    .uint32Present(SearchSettingsField.noCodeFingerOpen, body.settings.noCodeFingerOpen)
    .finish();
  return new ProtoWriter()
    .uint64(GroupSettingsEnvelopeField.groupUin, body.groupUin)
    .message(GroupSettingsEnvelopeField.settings, settings)
    .uint32(GroupSettingsEnvelopeField.field12, body.field12)
    .finish();
}

export function encodeInvitePolicy(body: InvitePolicyBody): Uint8Array {
  // All three are `!= null` (reference/index.mjs:225109): sending a zero mask
  // would be a different request from omitting it, so zeros go out.
  const settings = new ProtoWriter()
    .uint32Present(InvitePolicySettingsField.appPrivilegeFlag, body.settings.appPrivilegeFlag)
    .uint32Present(InvitePolicySettingsField.appPrivilegeMask, body.settings.appPrivilegeMask)
    .uint32Present(InvitePolicySettingsField.allowMemberInvite, body.settings.allowMemberInvite)
    .finish();
  return new ProtoWriter()
    .uint64(GroupSettingsEnvelopeField.groupUin, body.groupUin)
    .message(GroupSettingsEnvelopeField.settings, settings)
    .uint32(GroupSettingsEnvelopeField.field12, body.field12)
    .finish();
}

export function encodeHistoryVisibility(body: HistoryVisibilityBody): Uint8Array {
  // `!= null` on both (reference/index.mjs:226261), which is what makes
  // "hide history" expressible: `groupFlagExt4: 0` with `mask: 0` must be sent,
  // whereas a defaulting writer would emit an empty settings message and the
  // server would read that as "no change".
  const settings = new ProtoWriter()
    .uint32Present(HistoryVisibilitySettingsField.groupFlagExt4, body.settings.groupFlagExt4)
    .uint32Present(HistoryVisibilitySettingsField.groupFlagExt4Mask, body.settings.groupFlagExt4Mask)
    .finish();
  return new ProtoWriter()
    .uint64(GroupSettingsEnvelopeField.groupUin, body.groupUin)
    .message(GroupSettingsEnvelopeField.settings, settings)
    .uint32(GroupSettingsEnvelopeField.field12, body.field12)
    .finish();
}

export function encodeMemberPermission(body: MemberPermissionBody): Uint8Array {
  // `!= null` on both (reference/index.mjs:227369).
  const settings = new ProtoWriter()
    .uint32Present(MemberPermissionSettingsField.appPrivilegeFlag, body.settings.appPrivilegeFlag)
    .uint32Present(MemberPermissionSettingsField.appPrivilegeMask, body.settings.appPrivilegeMask)
    .finish();
  return new ProtoWriter()
    .uint64(GroupSettingsEnvelopeField.groupUin, body.groupUin)
    .message(GroupSettingsEnvelopeField.settings, settings)
    .uint32(GroupSettingsEnvelopeField.field12, body.field12)
    .finish();
}

// ---------------------------------------------------------------------------
// 0x89a_15 — rename
// ---------------------------------------------------------------------------

export const RenameGroupField = { groupUin: 1, body: 2 } as const;
export const RenameGroupBodyField = { targetName: 3 } as const;

export interface RenameGroupBody {
  groupUin: number;
  body: { targetName: string };
}

export function encodeRenameGroup(body: RenameGroupBody): Uint8Array {
  const inner = new ProtoWriter().string(RenameGroupBodyField.targetName, body.body.targetName).finish();
  return new ProtoWriter()
    .uint32(RenameGroupField.groupUin, body.groupUin)
    .message(RenameGroupField.body, inner)
    .finish();
}

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------
//
// Every sub-command-0 variant is decoded by `OidbEmpty` in the reference — a
// message with no known fields whose decoder exists only to validate the frame
// (reference/index.mjs:211364 `protobuf_decode_OidbEmpty$18`).  Reproducing it
// honestly means returning `{}` and still walking the bytes, so trailing
// garbage is caught rather than ignored.

export interface OidbEmpty {
  readonly _empty?: never;
}

export function decodeOidbEmpty(data: Uint8Array, offset = 0, end = data.length): OidbEmpty {
  const reader = new ProtoReader(data, offset, end);
  const unknown = new UnknownFieldCollector();
  while (reader.next()) reader.skip(unknown);
  return {};
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

/** `addType` 4 is the "question + answer" mode; 55 is an alias of 5. */
export const ADD_OPTION_WITH_QUESTION = 4;

/**
 * Map the OneBot `add_type` onto the wire value.
 *
 * 55 is accepted as an alias of 5 and normalised, because the OneBot action
 * schema historically allowed both spellings for the same mode
 * (reference/index.mjs:211863).
 */
export function wireAddType(addType: number): number {
  return addType === 55 ? 5 : addType;
}

/**
 * Only these modes carry `groupQuestion`/`groupAnswer`; 55 is the alias of 5
 * (reference/index.mjs:211860).
 */
export function isQuestionAddType(addType: number): boolean {
  return addType === 4 || addType === 5 || addType === 55;
}

export interface GroupSettingsParams {
  groupId: number | bigint;
}

/** `set_group_whole_ban` — `enable=true` is 0xffffffff, which is "on", not "ban everyone for 136 years". */
export function muteAllState(enable: boolean): number {
  return enable ? 0xffffffff : 0;
}

export const SetGroupWholeBan: OidbSpec<
  GroupSettingsParams & { enable: boolean },
  MuteAllBody,
  OidbEmpty,
  void
> = {
  command: GROUP_SETTINGS_COMMAND,
  subCommand: GROUP_SETTINGS_SUB_COMMAND,
  serialize: (params) => ({
    groupUin: BigInt(params.groupId),
    muteState: { state: muteAllState(params.enable) },
  }),
  encodeBody: encodeMuteAll,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

export interface AddOptionParams extends GroupSettingsParams {
  addType: number;
  groupQuestion?: string | undefined;
  groupAnswer?: string | undefined;
}

export const SetGroupAddOption: OidbSpec<AddOptionParams, AddOptionBody, OidbEmpty, void> = {
  command: GROUP_SETTINGS_COMMAND,
  subCommand: GROUP_SETTINGS_SUB_COMMAND,
  serialize: (params) => {
    const addType = wireAddType(params.addType);
    const settings: AddOptionBody["settings"] = { addType };
    if (isQuestionAddType(params.addType)) {
      settings.groupQuestion = params.groupQuestion ?? "";
      // The answer is only meaningful for addType 4; the reference clears it
      // otherwise instead of dropping the field, so the server sees "".
      settings.groupAnswer = addType === ADD_OPTION_WITH_QUESTION ? (params.groupAnswer ?? "") : "";
    }
    return { groupUin: BigInt(params.groupId), settings, field12: 0 };
  },
  encodeBody: encodeAddOption,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

export interface SearchParams extends GroupSettingsParams {
  noFingerOpen?: number | undefined;
  noCodeFingerOpen?: number | undefined;
}

export const SetGroupSearch: OidbSpec<SearchParams, SearchBody, OidbEmpty, void> = {
  command: GROUP_SETTINGS_COMMAND,
  subCommand: GROUP_SETTINGS_SUB_COMMAND,
  serialize: (params) => {
    // Absent means "leave alone", which is why these are not defaulted to 0: a
    // zero here would actively switch the setting off.
    const settings: SearchBody["settings"] = {};
    if (params.noFingerOpen !== undefined) settings.noFingerOpen = params.noFingerOpen;
    if (params.noCodeFingerOpen !== undefined) settings.noCodeFingerOpen = params.noCodeFingerOpen;
    return { groupUin: BigInt(params.groupId), settings, field12: 0 };
  },
  encodeBody: encodeSearch,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

export type MemberInvitePolicy = "disabled" | "require_approval" | "no_approval" | "no_approval_under_100";

/**
 * The privilege bit layout for the invite policy, copied exactly from
 * reference/index.mjs:225187-225203.
 *
 * The bits are NOT adjacent: the mask is 0x6100000 and the four policies live in
 * bits 26, 20, and 25 of that field.  Guessing a tidy 0b11 mask here would look
 * plausible and silently corrupt the neighbouring privilege bits, which is why
 * the reference keeps a mask at all: `current & ~mask | requested & mask`
 * rewrites only the three policy bits and leaves the rest of the word alone.
 */
export const MEMBER_INVITE_PRIVILEGE_MASK = 101711872; // 0x6100000

export const POLICY_PRIVILEGE_BITS: Record<MemberInvitePolicy, number> = {
  disabled: 67108864, // 0x4000000
  require_approval: 0, // 0x0
  no_approval: 1048576, // 0x100000
  no_approval_under_100: 33554432, // 0x2000000
};

/** Merge the policy bits into the group's current flag, preserving unknown bits. */
export function mergeMemberInvitePrivilegeFlag(currentPrivilegeFlag: number, policy: MemberInvitePolicy): number {
  assertUint32(currentPrivilegeFlag, "current privilege flag");
  const current = BigInt(currentPrivilegeFlag);
  const mask = BigInt(MEMBER_INVITE_PRIVILEGE_MASK);
  return Number((current & ~mask) | (BigInt(POLICY_PRIVILEGE_BITS[policy]) & mask));
}

/**
 * Recover the policy from a privilege flag.  The order of the checks matters:
 * `disabled` wins over everything, then the two "no approval" variants
 * (reference/index.mjs:225204-225211).
 */
export function decodeMemberInvitePolicy(privilegeFlag: number): MemberInvitePolicy {
  assertUint32(privilegeFlag, "privilege flag");
  const bits = privilegeFlag & MEMBER_INVITE_PRIVILEGE_MASK;
  if ((bits & 67108864) !== 0) return "disabled";
  if ((bits & 33554432) !== 0) return "no_approval_under_100";
  if ((bits & 1048576) !== 0) return "no_approval";
  return "require_approval";
}

export interface InvitePolicyParams extends GroupSettingsParams {
  policy: MemberInvitePolicy;
  currentPrivilegeFlag?: number | undefined;
}

export const SetGroupMemberInvitePolicy: OidbSpec<InvitePolicyParams, InvitePolicyBody, OidbEmpty, void> = {
  command: GROUP_SETTINGS_COMMAND,
  subCommand: GROUP_SETTINGS_SUB_COMMAND,
  serialize: (params) => ({
    groupUin: BigInt(params.groupId),
    settings: {
      appPrivilegeFlag: mergeMemberInvitePrivilegeFlag(params.currentPrivilegeFlag ?? 0, params.policy),
      appPrivilegeMask: MEMBER_INVITE_PRIVILEGE_MASK,
      // The reference sends 0 only for "disabled" and 1 otherwise
      // (reference/index.mjs:225220); it is a redundant echo of the policy bits.
      allowMemberInvite: params.policy === "disabled" ? 0 : 1,
    },
    field12: 0,
  }),
  encodeBody: encodeInvitePolicy,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

/** Bit 2 of `groupFlagExt4` is the "new members can read history" switch. */
export const HISTORY_VISIBLE_FLAG = 0x4;

export interface HistoryVisibilityParams extends GroupSettingsParams {
  visible: boolean;
}

export const SetGroupNewMemberHistoryVisibility: OidbSpec<
  HistoryVisibilityParams,
  HistoryVisibilityBody,
  OidbEmpty,
  void
> = {
  command: GROUP_SETTINGS_COMMAND,
  subCommand: GROUP_SETTINGS_SUB_COMMAND,
  serialize: (params) => ({
    groupUin: BigInt(params.groupId),
    // When hiding, the reference sends `4` as the mask and `0` as the value: the
    // mask says "this bit is mine to write", the zero clears it. Sending 0/0
    // would be a request with no effect.
    settings: { groupFlagExt4: params.visible ? HISTORY_VISIBLE_FLAG : 0, groupFlagExt4Mask: HISTORY_VISIBLE_FLAG },
    field12: 0,
  }),
  encodeBody: encodeHistoryVisibility,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

/**
 * The three group-member permissions and their privilege bits, copied from
 * reference/index.mjs:227422.
 *
 * The sense is INVERTED: a set bit means the permission is *denied*.  See
 * `decodeGroupMemberPermissions`, where each accessor is `(flag & mask) === 0`.
 * `mergeGroupMemberPermission` therefore clears the bit to allow.
 */
export const GROUP_MEMBER_PERMISSION_MASKS = {
  upload_album: 1, // 0x1
  temporary_session: 65536, // 0x10000
  create_group: 32768, // 0x8000
} as const;

export type GroupMemberPermission = keyof typeof GROUP_MEMBER_PERMISSION_MASKS;

function assertUint32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 4294967295) {
    throw new Error(`${name} must be an unsigned 32-bit integer`);
  }
}

/**
 * Set or clear one permission bit while preserving the others.
 *
 * Clears the bit when `allow` — the reference's `allow ? current & ~mask :
 * current | mask` (reference/index.mjs:227430).  Kept in this inverted form
 * rather than "simplified", because the inverted sense is what the server reads.
 */
export function mergeGroupMemberPermission(
  currentPrivilegeFlag: number,
  permission: GroupMemberPermission,
  allow: boolean,
): number {
  assertUint32(currentPrivilegeFlag, "current privilege flag");
  const current = BigInt(currentPrivilegeFlag);
  const mask = BigInt(GROUP_MEMBER_PERMISSION_MASKS[permission]);
  return Number(allow ? current & ~mask : current | mask);
}

/** Read all three permissions out of a privilege flag (set bit == denied). */
export function decodeGroupMemberPermissions(privilegeFlag: number): Record<GroupMemberPermission, boolean> {
  assertUint32(privilegeFlag, "privilege flag");
  return {
    upload_album: (privilegeFlag & GROUP_MEMBER_PERMISSION_MASKS.upload_album) === 0,
    temporary_session: (privilegeFlag & GROUP_MEMBER_PERMISSION_MASKS.temporary_session) === 0,
    create_group: (privilegeFlag & GROUP_MEMBER_PERMISSION_MASKS.create_group) === 0,
  };
}

export interface MemberPermissionParams extends GroupSettingsParams {
  permission: GroupMemberPermission;
  allow: boolean;
  currentPrivilegeFlag?: number | undefined;
}

export const SetGroupMemberPermissions: OidbSpec<MemberPermissionParams, MemberPermissionBody, OidbEmpty, void> = {
  command: GROUP_SETTINGS_COMMAND,
  subCommand: GROUP_SETTINGS_SUB_COMMAND,
  serialize: (params) => ({
    groupUin: BigInt(params.groupId),
    settings: {
      appPrivilegeFlag: mergeGroupMemberPermission(params.currentPrivilegeFlag ?? 0, params.permission, params.allow),
      appPrivilegeMask: GROUP_MEMBER_PERMISSION_MASKS[params.permission],
    },
    field12: 0,
  }),
  encodeBody: encodeMemberPermission,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

export const SetGroupName: OidbSpec<
  GroupSettingsParams & { name: string },
  RenameGroupBody,
  OidbEmpty,
  void
> = {
  command: GROUP_SETTINGS_COMMAND,
  subCommand: RENAME_GROUP_SUB_COMMAND,
  serialize: (params) => ({
    // Field 1 of the rename body is a *uint32* (reference/index.mjs:220472),
    // unlike every other 0x89a body where groupUin is uint64. Both happen to
    // encode group numbers below 2^32 the same way, but the type is kept
    // faithful so a wrong type shows up as a compile error rather than as a
    // truncated group number.
    groupUin: Number(params.groupId),
    body: { targetName: params.name },
  }),
  encodeBody: encodeRenameGroup,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};