// The group administrator permissions family — four commands, four regions.
//
// ---------------------------------------------------------------------------
// Which command is which
// ---------------------------------------------------------------------------
// The batch brief listed four labels and all four were right, but they are not
// two pairs of request/response as the names suggest.  They are two independent
// settings, each with a read and a write, on four *different* command numbers:
//
//   label                    command        sub  uinForm  direction
//   GetAdminPermissions      0x9164 (37220)  2   true     read  admin capability
//   SetAdminPermissions      0x9c1c (39964)  2   false    write admin capability
//   GetAdminReceiveVerify    0xfe7  (4071)   4   false    read  "receive verify"
//   SetAdminReceiveVerify    0x904  (2308)   1   true     write "receive verify"
//
// ⚠️ Note what is NOT symmetric:
//   * the read and write of the *same* setting sit on unrelated command numbers
//     (0x9164 vs 0x9c1c, 0xfe7 vs 0x904), so a "family" lookup by number proximity
//     finds nothing;
//   * `uinForm` is true on the *read* of one pair and on the *write* of the other;
//   * `0xfe7_4` collides numerically with batch B's `0xfe7_3` (group member
//     roster).  Same command, different sub-command, different message — the
//     exact "number proximity predicts nothing" hazard from MEMORY.md §2.3k, and
//     this time the number is even *shared* rather than merely adjacent.
//
// ---------------------------------------------------------------------------
// Field numbers, and the four places they are not what you would guess
// ---------------------------------------------------------------------------
// 1. `GetGroupAdminPermissionsRequest` (reference/index.mjs:214749) skips field 3:
//       1 groupCode uint64, 2 memberUins repeated uint64, 4 filter message
//    and the *filter* then uses field **52** for its payload:
//   `GroupAdminPermissionsFilter{ 52 permissions }` (:214788). `__write_...`
//    emits tag bytes `162, 3` = varint 0x1a2 = 418 = 52<<3|2. A filter written at
//    field 1 (the obvious guess) is silently ignored by the server and the reply
//    carries no permissions at all.
//
// 2. `GetGroupAdminPermissionsResponse` (:215041) skips field 2:
//       1 groupCode uint64, 3 members repeated message
//    and then `GroupAdminPermissionsMember` (:215146) ALSO skips 2:
//       1 memberUin uint64, 3 ext message
//    and `GroupAdminPermissionsExt` (:215251) uses **52** again:
//       52 permissions message
//    So the read path is 1 -> 3 -> 3 -> 52 -> 1(items) -> {1,2,3}. Only the last
//    hop looks conventional. Two different messages in this file use 52, which is
//    why it is exported once as `ADMIN_PERMISSIONS_ENVELOPE_FIELD`.
//
// 3. `GetGroupAdminReceiveVerifyRequest` (:216332) writes a field at 3 with a
//    `!= null` guard, so an explicit 0 IS emitted:
//       1 groupCode uint64, 2 field2 uint32 (const 3), 3 field3 uint32 (const 0),
//       4 filter, 5 members repeated
//    `field3: 0` is visible in the golden as `18 00`. And the filter's payload is
//    at **104**: `GroupAdminReceiveVerifyFilter{ 104 memberFlagExt }` (:216488,
//    tag bytes `192, 6` = 0x340 = 832 = 104<<3|0).
//    Inside the member, `identity` is field 1 but `uid` is field **2** and
//    `uin` is field **4** (:216517): `1a 07 75 5f ...` decodes as uid only if you
//    know 2; reading it at 1 yields an empty uid and the matching filter then
//    rejects a perfectly good response.
//
// 4. `GroupAdminReceiveVerifyMember` puts `memberFlagExt` at **104** too (:216986),
//    the same number as the filter's payload — coincidence, different messages.
//
// ---------------------------------------------------------------------------
// The two "bit 6" semantics
// ---------------------------------------------------------------------------
// `GetAdminReceiveVerify.invoke` (:217120) returns
//     member.memberFlagExt == null ? null : (member.memberFlagExt & 64) === 0
// i.e. **bit 6 SET means receive-verify is OFF**, and a missing field is
// "unknown" (null), not false. All three cases are distinct on the wire and all
// three are pinned by goldens.
//
// `GetAdminPermissions.invoke` (:215645) is more elaborate: it validates the
// group echo, requires exactly one matching member, rejects duplicate items,
// rejects out-of-range values, and maps
//     value 0 -> null (unset)   1 -> true   2 -> false
// so "not specified" and "specified as off" are different answers.  That whole
// validator is `adminPermissionsSnapshot` below, kept in the reference's order
// because the order is what decides which error a malformed response reports.
//
// ---------------------------------------------------------------------------
// SetAdminPermissions: the validation is part of the spec
// ---------------------------------------------------------------------------
// `serialize` (:217127) refuses to build a request that says nothing, refuses
// `kickMemberPerDay` without `kickMember`, and restricts the per-day limit to
// {0,5,10,20,50,100,200}.  Those are not transport concerns, so they live here
// rather than in a caller — a request that violates them is a 400-worthy bug on
// our side, and letting it reach the server turns it into an opaque retcode.
//
// `extra` (field 3 of an item) is `bytes`, not a message: the reference wraps the
// `GroupAdminKickLimit` bytes with a generic encoder
// (`protobuf_encode_GroupAdminKickLimit`, :217919) and appends them as raw. So
// our encoder must produce the *inner* bytes for field 3 and the decoder gets
// them back as a `Uint8Array` — which is why `decodeAdminPermissionsSnapshot`
// re-decodes field 3 with `decodeGroupAdminKickLimit` instead of reading a
// nested message.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";
import { type OidbEmpty, decodeOidbEmpty } from "./0x89a-0.js";

// ---------------------------------------------------------------------------
// Command constants
// ---------------------------------------------------------------------------

/** 37220 = 0x9164. */
export const GET_ADMIN_PERMISSIONS_COMMAND = 0x9164;

/** 39964 = 0x9c1c. */
export const SET_ADMIN_PERMISSIONS_COMMAND = 0x9c1c;

/**
 * 4071 = 0xfe7 — the same command batch B's group member roster uses at `_3`.
 * This file only ever uses sub-command 4.
 */
export const GET_ADMIN_RECEIVE_VERIFY_COMMAND = 0xfe7;

/** 2308 = 0x904. */
export const SET_ADMIN_RECEIVE_VERIFY_COMMAND = 0x904;

export const GET_ADMIN_PERMISSIONS_SUB_COMMAND = 2;
export const SET_ADMIN_PERMISSIONS_SUB_COMMAND = 2;
export const GET_ADMIN_RECEIVE_VERIFY_SUB_COMMAND = 4;
export const SET_ADMIN_RECEIVE_VERIFY_SUB_COMMAND = 1;

// ---------------------------------------------------------------------------
// Field tables
// ---------------------------------------------------------------------------

/** The permissions wrapper is field 52 in BOTH the filter and the member ext. */
export const ADMIN_PERMISSIONS_ENVELOPE_FIELD = 52;

/** Field 104 carries `memberFlagExt` in both the filter and the member. */
export const ADMIN_RECEIVE_VERIFY_FLAG_FIELD = 104;

export const GetGroupAdminPermissionsRequestField = {
  groupCode: 1,
  memberUins: 2,
  filter: 4,
} as const;

export const GroupAdminPermissionsFilterField = {
  permissions: ADMIN_PERMISSIONS_ENVELOPE_FIELD,
} as const;

export const GetGroupAdminPermissionsResponseField = {
  groupCode: 1,
  members: 3,
} as const;

export const GroupAdminPermissionsMemberField = { memberUin: 1, ext: 3 } as const;
export const GroupAdminPermissionsExtField = { permissions: ADMIN_PERMISSIONS_ENVELOPE_FIELD } as const;
export const GroupAdminPermissionsField = { items: 1 } as const;
export const GroupAdminPermissionItemField = { item: 1, value: 2, extra: 3 } as const;
export const GroupAdminKickLimitField = { maxKickPerDay: 1 } as const;

export const GetGroupAdminReceiveVerifyRequestField = {
  groupCode: 1,
  field2: 2,
  field3: 3,
  filter: 4,
  members: 5,
} as const;

export const GroupAdminReceiveVerifyFilterField = {
  memberFlagExt: ADMIN_RECEIVE_VERIFY_FLAG_FIELD,
} as const;

export const GroupAdminReceiveVerifyIdentityField = { uid: 2, uin: 4 } as const;

export const GetGroupAdminReceiveVerifyResponseField = { groupCode: 1, members: 2 } as const;

export const GroupAdminReceiveVerifyMemberField = {
  identity: 1,
  memberFlagExt: ADMIN_RECEIVE_VERIFY_FLAG_FIELD,
} as const;

export const SetGroupAdminReceiveVerifyRequestField = { groupCode: 1, operation: 2 } as const;

export const GroupAdminReceiveVerifyOperationField = {
  adminUins: 1,
  authority: 2,
  operate: 3,
} as const;

export const SetGroupAdminReceiveVerifyResponseField = { groupCode: 1, result: 2 } as const;
export const GroupAdminReceiveVerifyResultField = { successfulUins: 1 } as const;

export const SetGroupAdminPermissionsRequestField = {
  groupCode: 1,
  memberUin: 2,
  permissions: 3,
} as const;

// ---------------------------------------------------------------------------
// 0x9164_2 — read administrator permissions
// ---------------------------------------------------------------------------

export interface GroupAdminPermissionsFilter {
  /** Raw bytes, sent as-is: the reference passes `Uint8Array([1])`. */
  permissions: Uint8Array;
}

export interface GetGroupAdminPermissionsRequest {
  groupCode: bigint;
  /** repeated uint64, NON-packed (`10` per element), field 2. */
  memberUins: bigint[];
  filter: GroupAdminPermissionsFilter;
}

export function encodeGroupAdminPermissionsFilter(filter: GroupAdminPermissionsFilter): Uint8Array {
  return new ProtoWriter()
    .bytes(GroupAdminPermissionsFilterField.permissions, filter.permissions)
    .finish();
}

export function encodeGetGroupAdminPermissionsRequest(
  body: GetGroupAdminPermissionsRequest,
): Uint8Array {
  return new ProtoWriter()
    .uint64(GetGroupAdminPermissionsRequestField.groupCode, body.groupCode)
    .repeatedUint64(GetGroupAdminPermissionsRequestField.memberUins, body.memberUins)
    .message(GetGroupAdminPermissionsRequestField.filter, encodeGroupAdminPermissionsFilter(body.filter))
    .finish();
}

export interface GroupAdminPermissionItem {
  /** `null` when the server omitted the field — the reference initialises to `null`. */
  item: number | null;
  value: number | null;
  /** Raw `GroupAdminKickLimit` bytes — a *bytes* field, not a nested message. */
  extra: Uint8Array | null;
}

export interface GroupAdminPermissions {
  items: GroupAdminPermissionItem[];
}

export interface GroupAdminPermissionsExt {
  permissions?: GroupAdminPermissions | undefined;
}

export interface GroupAdminPermissionsMember {
  memberUin: bigint;
  ext?: GroupAdminPermissionsExt | undefined;
}

export interface GetGroupAdminPermissionsResponse {
  groupCode?: bigint;
  members: GroupAdminPermissionsMember[];
}

export function decodeGroupAdminPermissionItem(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupAdminPermissionItem {
  const reader = new ProtoReader(data, offset, end);
  const item: GroupAdminPermissionItem = { item: null, value: null, extra: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupAdminPermissionItemField.item, WireType.varint):
        item.item = reader.uint32();
        break;
      case tagOf(GroupAdminPermissionItemField.value, WireType.varint):
        item.value = reader.uint32();
        break;
      case tagOf(GroupAdminPermissionItemField.extra, WireType.lengthDelimited):
        item.extra = reader.bytes();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return item;
}

export function decodeGroupAdminPermissions(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupAdminPermissions {
  const reader = new ProtoReader(data, offset, end);
  const permissions: GroupAdminPermissions = { items: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(GroupAdminPermissionsField.items, WireType.lengthDelimited)) {
      permissions.items.push(reader.message(decodeGroupAdminPermissionItem));
    } else {
      reader.skip(unknown);
    }
  }
  return permissions;
}

export function decodeGroupAdminPermissionsExt(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupAdminPermissionsExt {
  const reader = new ProtoReader(data, offset, end);
  const ext: GroupAdminPermissionsExt = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(GroupAdminPermissionsExtField.permissions, WireType.lengthDelimited)) {
      ext.permissions = reader.message(decodeGroupAdminPermissions);
    } else {
      reader.skip(unknown);
    }
  }
  return ext;
}

export function decodeGroupAdminPermissionsMember(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupAdminPermissionsMember {
  const reader = new ProtoReader(data, offset, end);
  const member: GroupAdminPermissionsMember = { memberUin: 0n };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupAdminPermissionsMemberField.memberUin, WireType.varint):
        member.memberUin = reader.uint64();
        break;
      case tagOf(GroupAdminPermissionsMemberField.ext, WireType.lengthDelimited):
        member.ext = reader.message(decodeGroupAdminPermissionsExt);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return member;
}

export function decodeGetGroupAdminPermissionsResponse(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GetGroupAdminPermissionsResponse {
  const reader = new ProtoReader(data, offset, end);
  const response: GetGroupAdminPermissionsResponse = { members: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GetGroupAdminPermissionsResponseField.groupCode, WireType.varint):
        response.groupCode = reader.uint64();
        break;
      case tagOf(GetGroupAdminPermissionsResponseField.members, WireType.lengthDelimited):
        response.members.push(reader.message(decodeGroupAdminPermissionsMember));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return response;
}

export interface GetAdminPermissionsParams {
  groupId: number | bigint;
  /** The admin whose capabilities are being read — a **uin** here, not a uid. */
  userId: number | bigint;
}

export const GetAdminPermissions: OidbSpec<
  GetAdminPermissionsParams,
  GetGroupAdminPermissionsRequest,
  GetGroupAdminPermissionsResponse,
  GetGroupAdminPermissionsResponse
> = {
  command: GET_ADMIN_PERMISSIONS_COMMAND,
  subCommand: GET_ADMIN_PERMISSIONS_SUB_COMMAND,
  uinForm: true,
  serialize: (params) => ({
    groupCode: BigInt(params.groupId),
    memberUins: [BigInt(params.userId)],
    // Filter payload is `Uint8Array([1])` — the byte is a selector, not a flag
    // whose value means anything to us. Copied literally.
    filter: { permissions: Uint8Array.from([1]) },
  }),
  encodeBody: encodeGetGroupAdminPermissionsRequest,
  decodeBody: decodeGetGroupAdminPermissionsResponse,
  // `deserialize` is `(_ctx, body) => body` (:215641): the raw body IS the
  // result. All the interpretation lives in `invoke`, which is
  // `adminPermissionsSnapshot` below.
  deserialize: (body) => body,
};

// ---------------------------------------------------------------------------
// Administrator-capability interpretation (the reference's `invoke`)
// ---------------------------------------------------------------------------

/** One entry of the returned snapshot. `null` means "not specified". */
export interface AdminPermissionsSnapshot {
  recallMemberMessage: boolean | null;
  kickMember: boolean | null;
  kickMemberPerDay: number | null;
}

/** The `GroupAdminKickLimit` sub-message carried in an item's `extra` field. */
export interface GroupAdminKickLimit {
  maxKickPerDay: number;
}

export function decodeGroupAdminKickLimit(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupAdminKickLimit {
  const reader = new ProtoReader(data, offset, end);
  const limit: GroupAdminKickLimit = { maxKickPerDay: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    if (reader.tag === tagOf(GroupAdminKickLimitField.maxKickPerDay, WireType.varint)) {
      limit.maxKickPerDay = reader.uint32();
    } else {
      reader.skip(unknown);
    }
  }
  return limit;
}

/** Encode a `GroupAdminKickLimit` — used for an item's `extra` bytes. */
export function encodeGroupAdminKickLimit(limit: GroupAdminKickLimit): Uint8Array {
  return new ProtoWriter()
    .uint32(GroupAdminKickLimitField.maxKickPerDay, limit.maxKickPerDay)
    .finish();
}

/**
 * Interpret a `GetAdminPermissions` body the way `invoke` does
 * (reference/index.mjs:215645-215669).
 *
 * Every rejection the reference makes is preserved, in its order:
 *   1. group echo missing or mismatched
 *   2. not exactly one member matching the requested uin
 *   3. duplicate item ids
 *   4. item value outside {0,1,2}
 * Items whose id is neither 1 nor 2 are skipped *before* the duplicate check, so
 * an unknown id never trips it.
 */
export function adminPermissionsSnapshot(
  body: GetGroupAdminPermissionsResponse,
  params: GetAdminPermissionsParams,
  command: number = GET_ADMIN_PERMISSIONS_COMMAND,
  subCommand: number = GET_ADMIN_PERMISSIONS_SUB_COMMAND,
): AdminPermissionsSnapshot {
  void command;
  void subCommand;
  const expectedGroup = BigInt(params.groupId);
  if (body.groupCode !== expectedGroup) {
    throw new Error("administrator permissions response has a missing or mismatched group");
  }
  const expectedUin = BigInt(params.userId);
  const members = (body.members ?? []).filter((member) => member.memberUin === expectedUin);
  if (members.length !== 1) {
    throw new Error("administrator permissions response must contain exactly one matching member");
  }
  const snapshot: AdminPermissionsSnapshot = {
    recallMemberMessage: null,
    kickMember: null,
    kickMemberPerDay: null,
  };
  const seen = new Set<number>();
  for (const permission of members[0]!.ext?.permissions?.items ?? []) {
    const id = permission.item;
    // `null` (absent) is not 1 or 2, so it is skipped exactly as the reference's
    // `id !== 1 && id !== 2` does.
    if (id !== 1 && id !== 2) continue;
    if (seen.has(id)) throw new Error(`administrator permissions response contains duplicate item ${id}`);
    seen.add(id);
    const value = permission.value ?? 0;
    if (value !== 0 && value !== 1 && value !== 2) {
      throw new Error(`administrator permission ${id} has unsupported value ${value}`);
    }
    // 0 = "not specified", which is a third state and not the same as false.
    const enabled = value === 0 ? null : value === 1;
    if (id === 2) {
      snapshot.recallMemberMessage = enabled;
    } else {
      snapshot.kickMember = enabled;
      if (enabled) {
        // Only when the capability is ON does the limit matter; the reference
        // decodes `extra` lazily for exactly that reason (a null `extra` becomes
        // an empty buffer, so the limit decodes to 0 rather than throwing).
        snapshot.kickMemberPerDay = decodeGroupAdminKickLimit(
          permission.extra ?? new Uint8Array(0),
        ).maxKickPerDay;
      }
    }
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// 0x9c1c_2 — write administrator permissions
// ---------------------------------------------------------------------------

export interface SetGroupAdminPermissionsRequest {
  groupCode: bigint;
  memberUin: bigint;
  /** repeated message, NON-packed, field 3. */
  permissions: GroupAdminPermissionItemWrite[];
}

/**
 * One item to WRITE.
 *
 * A separate type from the decoded `GroupAdminPermissionItem` on purpose: the
 * decoder yields `null` for absent fields (faithful to the reference), while a
 * request always supplies concrete numbers. Sharing one type would force the
 * encoder to accept `null` and silently write 0.
 */
export interface GroupAdminPermissionItemWrite {
  item: number;
  value: number;
  /** Raw `GroupAdminKickLimit` bytes; omitted when absent. */
  extra?: Uint8Array | undefined;
}

export function encodeSetGroupAdminPermissionsRequest(
  body: SetGroupAdminPermissionsRequest,
): Uint8Array {
  const items = body.permissions.map((permission) => {
    const writer = new ProtoWriter();
    writer.uint32(GroupAdminPermissionItemField.item, permission.item);
    writer.uint32(GroupAdminPermissionItemField.value, permission.value);
    if (permission.extra != null) {
      writer.bytes(GroupAdminPermissionItemField.extra, permission.extra);
    }
    return writer.finish();
  });
  return new ProtoWriter()
    .uint64(SetGroupAdminPermissionsRequestField.groupCode, body.groupCode)
    .uint64(SetGroupAdminPermissionsRequestField.memberUin, body.memberUin)
    .repeatedMessage(SetGroupAdminPermissionsRequestField.permissions, items)
    .finish();
}

/**
 * The per-day kick limits the reference accepts (reference/index.mjs:217134).
 *
 * A free-form number is not accepted: the server's own bucket list is this, and
 * anything else is rejected locally so the failure is legible.
 */
export const KICK_MEMBER_PER_DAY_ALLOWED = [0, 5, 10, 20, 50, 100, 200] as const;

/** The two administrator capabilities this command can write. */
export const ADMIN_PERMISSION_ITEM = { kickMember: 1, recallMemberMessage: 2 } as const;

/**
 * Wire values for an item: 1 = on, 2 = off.
 *
 * ⚠️ "off" is **2**, not 0. 0 means "not specified" on the read side
 * (`adminPermissionsSnapshot` maps it to null), so writing 0 to disable would be
 * read back as "unchanged".
 */
export const ADMIN_PERMISSION_VALUE = { on: 1, off: 2 } as const;

export interface SetAdminPermissionsParams {
  groupId: number | bigint;
  userId: number | bigint;
  recallMemberMessage?: boolean | undefined;
  kickMember?: boolean | undefined;
  /** Required when `kickMember === true`; forbidden when it is not true. */
  kickMemberPerDay?: number | undefined;
}

/**
 * Build the permission list, applying the reference's validation.
 *
 * `serialize` itself (reference/index.mjs:217127) throws on:
 *   * neither capability specified
 *   * `kickMember === true` without an allowed `kickMemberPerDay`
 *   * `kickMemberPerDay` given while `kickMember` is not `true`
 */
export function setAdminPermissionsSerialize(
  params: SetAdminPermissionsParams,
): SetGroupAdminPermissionsRequest {
  if (params.recallMemberMessage === undefined && params.kickMember === undefined) {
    throw new Error("at least one administrator permission must be specified");
  }
  if (params.kickMember === true) {
    if (
      params.kickMemberPerDay === undefined ||
      !(KICK_MEMBER_PER_DAY_ALLOWED as readonly number[]).includes(params.kickMemberPerDay)
    ) {
      throw new Error(
        "enabling kick_member requires kick_member_per_day: 0, 5, 10, 20, 50, 100 or 200",
      );
    }
  } else if (params.kickMemberPerDay !== undefined) {
    throw new Error("kick_member_per_day requires kick_member=true");
  }

  const permissions: GroupAdminPermissionItemWrite[] = [];
  if (params.kickMember !== undefined) {
    permissions.push({
      item: ADMIN_PERMISSION_ITEM.kickMember,
      value: params.kickMember ? ADMIN_PERMISSION_VALUE.on : ADMIN_PERMISSION_VALUE.off,
      // The limit bytes only ride along when enabling. Turning the capability on
      // with a limit of 0 produces `extra` = empty, which the writer drops, so
      // the item is `08 01 10 01` — one byte shorter than any nonzero limit.
      extra: params.kickMember
        ? encodeGroupAdminKickLimit({ maxKickPerDay: params.kickMemberPerDay ?? 0 })
        : undefined,
    });
  }
  if (params.recallMemberMessage !== undefined) {
    permissions.push({
      item: ADMIN_PERMISSION_ITEM.recallMemberMessage,
      value: params.recallMemberMessage ? ADMIN_PERMISSION_VALUE.on : ADMIN_PERMISSION_VALUE.off,
    });
  }
  return {
    groupCode: BigInt(params.groupId),
    memberUin: BigInt(params.userId),
    permissions,
  };
}

export const SetAdminPermissions: OidbSpec<
  SetAdminPermissionsParams,
  SetGroupAdminPermissionsRequest,
  OidbEmpty,
  void
> = {
  command: SET_ADMIN_PERMISSIONS_COMMAND,
  subCommand: SET_ADMIN_PERMISSIONS_SUB_COMMAND,
  serialize: setAdminPermissionsSerialize,
  encodeBody: encodeSetGroupAdminPermissionsRequest,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

// ---------------------------------------------------------------------------
// 0xfe7_4 — read the receive-verify flag
// ---------------------------------------------------------------------------

export interface GroupAdminReceiveVerifyFilter {
  memberFlagExt: number;
}

export interface GroupAdminReceiveVerifyIdentity {
  uid: string;
  /** Field 4, and `!= null` — so an explicit 0 IS emitted. */
  uin?: bigint | undefined;
}

export interface GetGroupAdminReceiveVerifyRequest {
  groupCode: bigint;
  /** Constant 3 in the reference. */
  field2: number;
  /** Constant 0, emitted anyway because the guard is `!= null`. */
  field3: number;
  filter: GroupAdminReceiveVerifyFilter;
  members: GroupAdminReceiveVerifyIdentity[];
}

export function encodeGroupAdminReceiveVerifyFilter(
  filter: GroupAdminReceiveVerifyFilter,
): Uint8Array {
  return new ProtoWriter()
    .uint32(GroupAdminReceiveVerifyFilterField.memberFlagExt, filter.memberFlagExt)
    .finish();
}

export function encodeGroupAdminReceiveVerifyIdentity(
  identity: GroupAdminReceiveVerifyIdentity,
): Uint8Array {
  const writer = new ProtoWriter()
    .string(GroupAdminReceiveVerifyIdentityField.uid, identity.uid);
  // `_f1 != null` with no `!== 0`: field 4 is emitted whenever a uin is set at
  // all, including 0. `.uint64Present` would be needed for 0, but `.uint64`
  // drops it — and the reference would send it. Guarded with an explicit check.
  if (identity.uin !== undefined) {
    writer.uint64Present(GroupAdminReceiveVerifyIdentityField.uin, identity.uin);
  }
  return writer.finish();
}

export function encodeGetGroupAdminReceiveVerifyRequest(
  body: GetGroupAdminReceiveVerifyRequest,
): Uint8Array {
  return new ProtoWriter()
    .uint64(GetGroupAdminReceiveVerifyRequestField.groupCode, body.groupCode)
    .uint32(GetGroupAdminReceiveVerifyRequestField.field2, body.field2)
    // `!= null` guard: the reference sends an explicit 0 here (golden `1800`).
    .uint32Present(GetGroupAdminReceiveVerifyRequestField.field3, body.field3)
    .message(
      GetGroupAdminReceiveVerifyRequestField.filter,
      encodeGroupAdminReceiveVerifyFilter(body.filter),
    )
    .repeatedMessage(
      GetGroupAdminReceiveVerifyRequestField.members,
      body.members.map(encodeGroupAdminReceiveVerifyIdentity),
    )
    .finish();
}

export interface GroupAdminReceiveVerifyMember {
  identity?: GroupAdminReceiveVerifyIdentity | undefined;
  /** `null` when the server omitted field 104 — a third state, not `0`. */
  memberFlagExt: number | null;
}

export interface GetGroupAdminReceiveVerifyResponse {
  groupCode?: bigint;
  members: GroupAdminReceiveVerifyMember[];
}

export function decodeGroupAdminReceiveVerifyIdentity(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupAdminReceiveVerifyIdentity {
  const reader = new ProtoReader(data, offset, end);
  const identity: GroupAdminReceiveVerifyIdentity = { uid: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupAdminReceiveVerifyIdentityField.uid, WireType.lengthDelimited):
        identity.uid = reader.string();
        break;
      case tagOf(GroupAdminReceiveVerifyIdentityField.uin, WireType.varint):
        identity.uin = reader.uint64();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return identity;
}

export function decodeGroupAdminReceiveVerifyMember(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupAdminReceiveVerifyMember {
  const reader = new ProtoReader(data, offset, end);
  const member: GroupAdminReceiveVerifyMember = { memberFlagExt: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupAdminReceiveVerifyMemberField.identity, WireType.lengthDelimited):
        member.identity = reader.message(decodeGroupAdminReceiveVerifyIdentity);
        break;
      case tagOf(GroupAdminReceiveVerifyMemberField.memberFlagExt, WireType.varint):
        member.memberFlagExt = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return member;
}

export function decodeGetGroupAdminReceiveVerifyResponse(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GetGroupAdminReceiveVerifyResponse {
  const reader = new ProtoReader(data, offset, end);
  const response: GetGroupAdminReceiveVerifyResponse = { members: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GetGroupAdminReceiveVerifyResponseField.groupCode, WireType.varint):
        response.groupCode = reader.uint64();
        break;
      case tagOf(GetGroupAdminReceiveVerifyResponseField.members, WireType.lengthDelimited):
        response.members.push(reader.message(decodeGroupAdminReceiveVerifyMember));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return response;
}

export interface GetAdminReceiveVerifyParams {
  groupId: number | bigint;
  /** The member's **uid** — this command addresses by uid, not uin. */
  userUid: string;
}

export const GetAdminReceiveVerify: OidbSpec<
  GetAdminReceiveVerifyParams,
  GetGroupAdminReceiveVerifyRequest,
  GetGroupAdminReceiveVerifyResponse,
  GetGroupAdminReceiveVerifyResponse
> = {
  command: GET_ADMIN_RECEIVE_VERIFY_COMMAND,
  subCommand: GET_ADMIN_RECEIVE_VERIFY_SUB_COMMAND,
  uinForm: false,
  serialize: (params) => ({
    groupCode: BigInt(params.groupId),
    field2: 3,
    field3: 0,
    filter: { memberFlagExt: 1 },
    // `uin` is deliberately absent: the reference sends `{ uid: p.userUid }`
    // only (reference/index.mjs:217103).
    members: [{ uid: params.userUid }],
  }),
  encodeBody: encodeGetGroupAdminReceiveVerifyRequest,
  decodeBody: decodeGetGroupAdminReceiveVerifyResponse,
  deserialize: (body) => body,
};

/**
 * Reduce a receive-verify body to the tri-state answer `invoke` gives
 * (reference/index.mjs:217108-217122).
 *
 * Returns:
 *   `null`  — the server sent no `memberFlagExt`, so we do not know
 *   `true`  — receive-verify is ENABLED (bit 6 clear)
 *   `false` — receive-verify is DISABLED (bit 6 set)
 *
 * The bit sense is inverted relative to the field name. A caller that reads
 * `memberFlagExt !== 0` as "enabled" gets every answer backwards.
 */
export function receiveVerifyEnabled(
  body: GetGroupAdminReceiveVerifyResponse,
  params: GetAdminReceiveVerifyParams,
): boolean | null {
  if (body.groupCode !== BigInt(params.groupId)) {
    throw new Error("administrator receive-verify response has a missing or mismatched group");
  }
  const members = (body.members ?? []).filter((member) => member.identity?.uid === params.userUid);
  if (members.length !== 1) {
    throw new Error("administrator receive-verify response must contain exactly one matching member");
  }
  const member = members[0]!;
  return member.memberFlagExt == null ? null : (member.memberFlagExt & RECEIVE_VERIFY_DISABLED_BIT) === 0;
}

/** Bit 6 of `memberFlagExt`: set means receive-verify is off. */
export const RECEIVE_VERIFY_DISABLED_BIT = 64;

// ---------------------------------------------------------------------------
// 0x904_1 — write the receive-verify flag
// ---------------------------------------------------------------------------

export interface GroupAdminReceiveVerifyOperation {
  /** repeated uint64, NON-packed, field 1. */
  adminUins: bigint[];
  /** Constant 1 in the reference. */
  authority: number;
  /** `!= null` guard: `enable: false` sends an explicit 0 (`1800`). */
  operate: number;
}

export interface SetGroupAdminReceiveVerifyRequest {
  groupCode: bigint;
  operation: GroupAdminReceiveVerifyOperation;
}

export function encodeGroupAdminReceiveVerifyOperation(
  operation: GroupAdminReceiveVerifyOperation,
): Uint8Array {
  return new ProtoWriter()
    .repeatedUint64(GroupAdminReceiveVerifyOperationField.adminUins, operation.adminUins)
    .uint32(GroupAdminReceiveVerifyOperationField.authority, operation.authority)
    // `!= null`, no `!== 0`: this is the field that must be able to say "off".
    .uint32Present(GroupAdminReceiveVerifyOperationField.operate, operation.operate)
    .finish();
}

export function encodeSetGroupAdminReceiveVerifyRequest(
  body: SetGroupAdminReceiveVerifyRequest,
): Uint8Array {
  return new ProtoWriter()
    .uint64(SetGroupAdminReceiveVerifyRequestField.groupCode, body.groupCode)
    .message(
      SetGroupAdminReceiveVerifyRequestField.operation,
      encodeGroupAdminReceiveVerifyOperation(body.operation),
    )
    .finish();
}

export interface GroupAdminReceiveVerifyResult {
  /**
   * repeated uint64 that accepts BOTH wire forms.
   *
   * The decoder has `case 8` (wire 0, one value per tag) and `case 10` (wire 2,
   * packed).  A decoder handling only one of them silently loses ids whenever the
   * server chooses the other form, which is why both are pinned by goldens
   * (`setrecvverify_resp_multi` vs `_packed`).
   */
  successfulUins: bigint[];
}

export interface SetGroupAdminReceiveVerifyResponse {
  groupCode?: bigint;
  result?: GroupAdminReceiveVerifyResult | undefined;
}

export function decodeGroupAdminReceiveVerifyResult(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupAdminReceiveVerifyResult {
  const reader = new ProtoReader(data, offset, end);
  const result: GroupAdminReceiveVerifyResult = { successfulUins: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupAdminReceiveVerifyResultField.successfulUins, WireType.varint):
        result.successfulUins.push(reader.uint64());
        break;
      case tagOf(GroupAdminReceiveVerifyResultField.successfulUins, WireType.lengthDelimited):
        // Packed form: same field number, wire type 2. Read until the sub-range ends.
        {
          // A packed run is a bare sequence of varints with NO tags, so it is read
          // positionally, not through `next()`. Calling `next()` here would consume
          // the first varint as a tag and then silently mis-align every following
          // value — which is exactly what the first version of this did: two ids
          // arrived, one was returned, and nothing threw.
          const packed = reader.bytes();
          const packedReader = new ProtoReader(packed, 0, packed.length);
          while (!packedReader.done) result.successfulUins.push(packedReader.uint64());
        }
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return result;
}

export function decodeSetGroupAdminReceiveVerifyResponse(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): SetGroupAdminReceiveVerifyResponse {
  const reader = new ProtoReader(data, offset, end);
  const response: SetGroupAdminReceiveVerifyResponse = {};
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(SetGroupAdminReceiveVerifyResponseField.groupCode, WireType.varint):
        response.groupCode = reader.uint64();
        break;
      case tagOf(SetGroupAdminReceiveVerifyResponseField.result, WireType.lengthDelimited):
        response.result = reader.message(decodeGroupAdminReceiveVerifyResult);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return response;
}

export interface SetAdminReceiveVerifyParams {
  groupId: number | bigint;
  /** The target admin's **uin** — unlike the read path, which uses a uid. */
  userId: number | bigint;
  enable: boolean;
}

export const SetAdminReceiveVerify: OidbSpec<
  SetAdminReceiveVerifyParams,
  SetGroupAdminReceiveVerifyRequest,
  SetGroupAdminReceiveVerifyResponse,
  SetGroupAdminReceiveVerifyResponse
> = {
  command: SET_ADMIN_RECEIVE_VERIFY_COMMAND,
  subCommand: SET_ADMIN_RECEIVE_VERIFY_SUB_COMMAND,
  uinForm: true,
  serialize: (params) => ({
    groupCode: BigInt(params.groupId),
    operation: {
      adminUins: [BigInt(params.userId)],
      authority: 1,
      operate: params.enable ? 1 : 0,
    },
  }),
  encodeBody: encodeSetGroupAdminReceiveVerifyRequest,
  decodeBody: decodeSetGroupAdminReceiveVerifyResponse,
  deserialize: (body) => body,
};

/**
 * The confirmation `invoke` performs (:219511-219513): the group echoes back and
 * the target appears in `successfulUins`. Both are hard failures, not warnings —
 * "acknowledged but not applied" is exactly the case a caller must not mistake
 * for success.
 */
export function confirmSetAdminReceiveVerify(
  body: SetGroupAdminReceiveVerifyResponse,
  params: SetAdminReceiveVerifyParams,
): void {
  if (body.groupCode !== BigInt(params.groupId)) {
    throw new Error("administrator receive-verify response has a missing or mismatched group");
  }
  const expected = BigInt(params.userId);
  if (!(body.result?.successfulUins ?? []).includes(expected)) {
    throw new Error("administrator receive-verify response did not confirm the target member");
  }
}