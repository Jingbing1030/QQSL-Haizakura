// OidbSvcTrpcTcp.0x10c0_1 / _2 — group join-request list.
//
// ---------------------------------------------------------------------------
// The sub-command is not always 0
// ---------------------------------------------------------------------------
// The action spec (ONEBOT-ACTION-SPEC.md) lists this command as `0x10c0_0`, but
// the reference never sends sub-command 0.  `FetchGroupRequests.resolveSubCommand`
// (reference/index.mjs:61638) picks 1 or 2 depending on whether the caller wants
// the filtered bucket:
//
//     resolveSubCommand = (p) => (p.filtered ? 2 : 1)
//
//   _1  pending  join requests
//   _2  the requests the user filtered/ignored
//
// Both `get_group_system_msg` (which needs both buckets) and
// `get_group_ignored_notifies` (which needs only _2) go through this one spec and
// differ in that flag.  docs/oidb.md records the discrepancy rather than
// repeating the spec doc's `_0`.
//
// Note: `set_group_add_request` is a *different command*, 0x10c8, despite the
// action spec grouping it with 0x10c0.  Its body shape is unrelated; see the
// comment at the bottom of this file.
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   OidbGroupRequestList (request)     reference/index.mjs:59878 / 59902
//     1 count  uint32
//     2 field2 uint64    <- the paging cursor, a genuine bigint
//
//   Response, two variants with identical numbering but different user submessage:
//   OidbSvcTrpcTcp0x10C0ResponseByUin    reference/index.mjs:60149
//     1 requests, 2 field2 uint64, 3 newLatestSeq uint64, 4 field4,
//     5 field5 uint64, 6 field6
//   OidbSvcTrpcTcp0x10C0Response         reference/index.mjs:61032 (same, by-uid)
//   ...ResponseRequest(ByUin)            reference/index.mjs:60334 / 61217
//     1 sequence uint64, 2 eventType, 3 state, 4 group, 5 target, 6 invitor,
//     7 operatorUser, 9 field9 string, 10 comment string, 14 operateTransInfo bytes
//   ...ResponseGroup                     reference/index.mjs:60603
//     1 groupUin uint32, 2 groupName string
//   ...ResponseUserByUin                 reference/index.mjs:60710
//     1 uin uint32, 2 name string
//   ...ResponseUser                      reference/index.mjs:61486
//     1 uid string, 2 name string
//
// The two user submessages are the crux: field 1 is a *uint32 uin* in the by-uin
// variant and a *string uid* in the by-uid variant.  Decoding one as the other
// yields either 0 or a garbage uid, and because both variants can arrive for the
// same request the reference decodes the bytes **twice** and merges by index.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";

/** 4288 = 0x10c0. */
export const GROUP_REQUESTS_COMMAND = 0x10c0;

export const GROUP_REQUESTS_SUB_COMMAND = { pending: 1, filtered: 2 } as const;

export const GroupRequestListField = { count: 1, field2: 2 } as const;

export interface GroupRequestListReq {
  count: number;
  field2: bigint;
}

export function encodeGroupRequestList(body: GroupRequestListReq): Uint8Array {
  return new ProtoWriter()
    .uint32(GroupRequestListField.count, body.count)
    .uint64(GroupRequestListField.field2, body.field2)
    .finish();
}

// ---------------------------------------------------------------------------
// Response — by-uin variant
// ---------------------------------------------------------------------------

export const GroupRequestsRespField = {
  requests: 1,
  field2: 2,
  newLatestSeq: 3,
  field4: 4,
  field5: 5,
  field6: 6,
} as const;

export const GroupRequestItemField = {
  sequence: 1,
  eventType: 2,
  state: 3,
  group: 4,
  target: 5,
  invitor: 6,
  operatorUser: 7,
  field9: 9,
  comment: 10,
  operateTransInfo: 14,
} as const;

export const GroupRequestGroupField = { groupUin: 1, groupName: 2 } as const;
export const GroupRequestUserByUinField = { uin: 1, name: 2 } as const;
export const GroupRequestUserByUidField = { uid: 1, name: 2 } as const;

export interface GroupRequestGroup {
  groupUin: number;
  groupName: string;
}

/** The by-uin user submessage: field 1 is a numeric uin. */
export interface GroupRequestUserByUin {
  uin: number;
  name: string;
}

/** The by-uid user submessage: field 1 is a string uid. */
export interface GroupRequestUserByUid {
  uid: string;
  name: string;
}

export interface GroupRequestItemByUin {
  sequence: bigint;
  eventType: number;
  state: number;
  group?: GroupRequestGroup | undefined;
  target?: GroupRequestUserByUin | undefined;
  invitor?: GroupRequestUserByUin | undefined;
  operatorUser?: GroupRequestUserByUin | undefined;
  field9: string;
  comment: string;
  operateTransInfo: Uint8Array;
}

export interface GroupRequestItemByUid {
  sequence: bigint;
  eventType: number;
  state: number;
  group?: GroupRequestGroup | undefined;
  target?: GroupRequestUserByUid | undefined;
  invitor?: GroupRequestUserByUid | undefined;
  operatorUser?: GroupRequestUserByUid | undefined;
  field9: string;
  comment: string;
  operateTransInfo: Uint8Array;
}

/** The paging/metadata wrapper, identical in both variants. */
export interface GroupRequestsPage<Item> {
  requests: Item[];
  field2: bigint;
  newLatestSeq: bigint;
  field4: number;
  field5: bigint;
  field6: number;
}

export type GroupRequestsByUin = GroupRequestsPage<GroupRequestItemByUin>;
export type GroupRequestsByUid = GroupRequestsPage<GroupRequestItemByUid>;

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

export function decodeGroupRequestGroup(data: Uint8Array, offset = 0, end = data.length): GroupRequestGroup {
  const reader = new ProtoReader(data, offset, end);
  const group: GroupRequestGroup = { groupUin: 0, groupName: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupRequestGroupField.groupUin, WireType.varint):
        group.groupUin = reader.uint32();
        break;
      case tagOf(GroupRequestGroupField.groupName, WireType.lengthDelimited):
        group.groupName = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return group;
}

export function decodeGroupRequestUserByUin(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupRequestUserByUin {
  const reader = new ProtoReader(data, offset, end);
  const user: GroupRequestUserByUin = { uin: 0, name: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupRequestUserByUinField.uin, WireType.varint):
        user.uin = reader.uint32();
        break;
      case tagOf(GroupRequestUserByUinField.name, WireType.lengthDelimited):
        user.name = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return user;
}

export function decodeGroupRequestUserByUid(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupRequestUserByUid {
  const reader = new ProtoReader(data, offset, end);
  const user: GroupRequestUserByUid = { uid: "", name: "" };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupRequestUserByUidField.uid, WireType.lengthDelimited):
        user.uid = reader.string();
        break;
      case tagOf(GroupRequestUserByUidField.name, WireType.lengthDelimited):
        user.name = reader.string();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return user;
}

export function decodeGroupRequestItemByUin(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupRequestItemByUin {
  const reader = new ProtoReader(data, offset, end);
  const item: GroupRequestItemByUin = {
    sequence: 0n,
    eventType: 0,
    state: 0,
    field9: "",
    comment: "",
    operateTransInfo: new Uint8Array(0),
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupRequestItemField.sequence, WireType.varint):
        item.sequence = reader.uint64();
        break;
      case tagOf(GroupRequestItemField.eventType, WireType.varint):
        item.eventType = reader.uint32();
        break;
      case tagOf(GroupRequestItemField.state, WireType.varint):
        item.state = reader.uint32();
        break;
      case tagOf(GroupRequestItemField.group, WireType.lengthDelimited):
        item.group = reader.message(decodeGroupRequestGroup);
        break;
      case tagOf(GroupRequestItemField.target, WireType.lengthDelimited):
        item.target = reader.message(decodeGroupRequestUserByUin);
        break;
      case tagOf(GroupRequestItemField.invitor, WireType.lengthDelimited):
        item.invitor = reader.message(decodeGroupRequestUserByUin);
        break;
      case tagOf(GroupRequestItemField.operatorUser, WireType.lengthDelimited):
        item.operatorUser = reader.message(decodeGroupRequestUserByUin);
        break;
      case tagOf(GroupRequestItemField.field9, WireType.lengthDelimited):
        item.field9 = reader.string();
        break;
      case tagOf(GroupRequestItemField.comment, WireType.lengthDelimited):
        item.comment = reader.string();
        break;
      case tagOf(GroupRequestItemField.operateTransInfo, WireType.lengthDelimited):
        item.operateTransInfo = reader.bytes();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return item;
}

export function decodeGroupRequestItemByUid(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): GroupRequestItemByUid {
  const reader = new ProtoReader(data, offset, end);
  const item: GroupRequestItemByUid = {
    sequence: 0n,
    eventType: 0,
    state: 0,
    field9: "",
    comment: "",
    operateTransInfo: new Uint8Array(0),
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(GroupRequestItemField.sequence, WireType.varint):
        item.sequence = reader.uint64();
        break;
      case tagOf(GroupRequestItemField.eventType, WireType.varint):
        item.eventType = reader.uint32();
        break;
      case tagOf(GroupRequestItemField.state, WireType.varint):
        item.state = reader.uint32();
        break;
      case tagOf(GroupRequestItemField.group, WireType.lengthDelimited):
        item.group = reader.message(decodeGroupRequestGroup);
        break;
      case tagOf(GroupRequestItemField.target, WireType.lengthDelimited):
        item.target = reader.message(decodeGroupRequestUserByUid);
        break;
      case tagOf(GroupRequestItemField.invitor, WireType.lengthDelimited):
        item.invitor = reader.message(decodeGroupRequestUserByUid);
        break;
      case tagOf(GroupRequestItemField.operatorUser, WireType.lengthDelimited):
        item.operatorUser = reader.message(decodeGroupRequestUserByUid);
        break;
      case tagOf(GroupRequestItemField.field9, WireType.lengthDelimited):
        item.field9 = reader.string();
        break;
      case tagOf(GroupRequestItemField.comment, WireType.lengthDelimited):
        item.comment = reader.string();
        break;
      case tagOf(GroupRequestItemField.operateTransInfo, WireType.lengthDelimited):
        item.operateTransInfo = reader.bytes();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return item;
}

/** Decode the shared paging wrapper, delegating the item decoder. */
function decodePage<Item>(
  decodeItem: (data: Uint8Array, offset: number, end: number) => Item,
): (data: Uint8Array, offset?: number, end?: number) => GroupRequestsPage<Item> {
  return (data, offset = 0, end = data.length) => {
    const reader = new ProtoReader(data, offset, end);
    const page: GroupRequestsPage<Item> = {
      requests: [],
      field2: 0n,
      newLatestSeq: 0n,
      field4: 0,
      field5: 0n,
      field6: 0,
    };
    const unknown = new UnknownFieldCollector();
    while (reader.next()) {
      switch (reader.tag) {
        case tagOf(GroupRequestsRespField.requests, WireType.lengthDelimited):
          page.requests.push(reader.message(decodeItem));
          break;
        case tagOf(GroupRequestsRespField.field2, WireType.varint):
          page.field2 = reader.uint64();
          break;
        case tagOf(GroupRequestsRespField.newLatestSeq, WireType.varint):
          page.newLatestSeq = reader.uint64();
          break;
        case tagOf(GroupRequestsRespField.field4, WireType.varint):
          page.field4 = reader.uint32();
          break;
        case tagOf(GroupRequestsRespField.field5, WireType.varint):
          page.field5 = reader.uint64();
          break;
        case tagOf(GroupRequestsRespField.field6, WireType.varint):
          page.field6 = reader.uint32();
          break;
        default:
          reader.skip(unknown);
          break;
      }
    }
    return page;
  };
}

export const decodeGroupRequestsByUin = decodePage<GroupRequestItemByUin>(decodeGroupRequestItemByUin);
export const decodeGroupRequestsByUid = decodePage<GroupRequestItemByUid>(decodeGroupRequestItemByUid);

// ---------------------------------------------------------------------------
// The merge
// ---------------------------------------------------------------------------

/** A request with both identity forms folded together. */
export interface MergedGroupRequestUser {
  uid: string;
  uin: number;
  name: string;
}

export interface MergedGroupRequestItem {
  sequence: bigint;
  eventType: number;
  state: number;
  group?: GroupRequestGroup | undefined;
  target: MergedGroupRequestUser;
  invitor: MergedGroupRequestUser;
  operatorUser: MergedGroupRequestUser;
  comment: string;
  operateTransInfo: Uint8Array;
}

/** Merge the two user variants: uid from the by-uid decode, uin from the by-uin one. */
export function mergeRequestUser(
  byUin: GroupRequestUserByUin | undefined,
  byUid: GroupRequestUserByUid | undefined,
): MergedGroupRequestUser {
  return {
    uid: byUid?.uid ?? "",
    uin: byUin?.uin ?? 0,
    // Name is present in both; prefer the by-uin copy so the ordering matches
    // the reference exactly (reference/index.mjs:61595).
    name: byUin?.name || byUid?.name || "",
  };
}

/** Merge one request; the by-uin decode supplies the scalars, the by-uid one the uids. */
export function mergeRequestItem(
  byUin: GroupRequestItemByUin | undefined,
  byUid: GroupRequestItemByUid | undefined,
): MergedGroupRequestItem {
  const src = byUin ?? byUid;
  return {
    sequence: src?.sequence ?? 0n,
    eventType: src?.eventType ?? 0,
    state: src?.state ?? 0,
    group: src?.group,
    target: mergeRequestUser(byUin?.target, byUid?.target),
    invitor: mergeRequestUser(byUin?.invitor, byUid?.invitor),
    operatorUser: mergeRequestUser(byUin?.operatorUser, byUid?.operatorUser),
    comment: src?.comment ?? "",
    operateTransInfo: src?.operateTransInfo ?? new Uint8Array(0),
  };
}

/**
 * Merge two decoded pages item by item.
 *
 * The pairing is **by index**, not by sequence number: the two variants describe
 * the same list in the same order, and the reference indexes both arrays with the
 * same `i` (reference/index.mjs:61618).  A sequence-keyed merge would be more
 * robust in theory but would change behaviour when the server returns a
 * by-uin-only page whose sequences are zero.
 */
export function mergeRequestList(
  byUin: GroupRequestsByUin | undefined,
  byUid: GroupRequestsByUid | undefined,
): MergedGroupRequestItem[] {
  const uinItems = byUin?.requests ?? [];
  const uidItems = byUid?.requests ?? [];
  const count = Math.max(uinItems.length, uidItems.length);
  const requests: MergedGroupRequestItem[] = [];
  for (let i = 0; i < count; i++) requests.push(mergeRequestItem(uinItems[i], uidItems[i]));
  return requests;
}

// ---------------------------------------------------------------------------
// The OneBot projection
// ---------------------------------------------------------------------------

/**
 * `notifyType` -> OneBot `sub_type`/`type` numbering.
 *
 * Copied from `GROUP_REQUEST_OPERATION_TYPE` (reference/index.mjs:61570).  It is
 * deliberately a Map and not arithmetic: the mapping is not a function of the
 * value, and several inputs already carry an output value, which is why
 * `groupRequestOperationType` falls back to identity when the input is already
 * in the output set.
 */
export const GROUP_REQUEST_OPERATION_TYPE = new Map<number, number>([
  [0, 0],
  [1, 2],
  [2, 10],
  [3, 11],
  [4, 12],
  [5, 22],
  [6, 35],
  [7, 1],
  [8, 3],
  [9, 6],
  [10, 7],
  [11, 13],
  [12, 15],
  [13, 16],
  [14, 17],
  [15, 19],
  [16, 8],
  [17, 100],
]);

const GROUP_REQUEST_OPERATION_OUTPUT = new Set(GROUP_REQUEST_OPERATION_TYPE.values());

export function groupRequestOperationType(notifyType: number): number | null {
  const mapped = GROUP_REQUEST_OPERATION_TYPE.get(notifyType);
  if (mapped !== undefined) return mapped;
  if (GROUP_REQUEST_OPERATION_OUTPUT.has(notifyType)) return notifyType;
  return null;
}

/**
 * A join or invite notification — the only kinds `get_group_system_msg` keeps.
 *
 * ⚠️ A HARD-CODED whitelist, not `groupRequestOperationType(n) !== null`. The two are not
 * equivalent, and the difference is observable:
 *
 * - `undefined` — the reference KEEPS it (older records omit `notifyType`); a
 *   `number | null` mapping would reject it.
 * - `0, 3, 4, 6, 8, 9, 10, 35, 100` — the reference REJECTS them, but
 *   `GROUP_REQUEST_OPERATION_OUTPUT` accepts them, because it also contains the *output*
 *   (mapped) types, not just the input notify types. A request whose `notifyType` happens
 *   to equal a mapped output would be kept by the set-based version and dropped by the
 *   reference.
 *
 * The reference's own guard is the literal list below (reference/index.mjs:39645), and
 * `get_group_system_msg` filters on it before anything else. Deriving it from the mapping
 * table looked equivalent and is not, so the list is written out.
 */
const JOIN_OR_INVITE_NOTIFY_TYPES: ReadonlySet<number> = new Set([1, 2, 5, 7, 22]);

export function isJoinOrInviteNotify(notifyType: number | undefined): boolean {
  // `undefined` is a KEEP: a record that predates the field is still a join/invite.
  if (notifyType === undefined) return true;
  return JOIN_OR_INVITE_NOTIFY_TYPES.has(notifyType);
}

/**
 * `isSelfGroupInvitation` (reference/index.mjs:11180) — an invitation the BOT was
 * invited to, which the bot may answer itself, as opposed to one a member sent to
 * someone else.
 *
 * `eventType` here is the MAPPED operation type, not the raw notify type: the mapping
 * above (`groupRequestOperationType`) collapses several notify types into the two
 * approval discriminators, which is why 2 and 10 are the only values tested.
 *
 * ⚠️ Kept HERE, next to `formatGroupRequestFlag`, because both come from the same
 * reference region (`qq-info.ts`, :11174-11192) and because the two layers that need
 * it — `bridge/apis/contacts.ts` (`resolveGroupJoinRequest`) and
 * `host/group-request.ts` (`groupRequestActor`, `handleGroupAddRequest`) — already
 * depend on this barrel. Defining it in `host/` and importing it from `bridge/` would
 * invert the layering: `host/action-context-host.ts` builds ON the bridge, so the
 * bridge must not reach back into the host.
 */
export function isSelfGroupInvitation(request: { eventType: number }): boolean {
  return request.eventType === 2 || request.eventType === 10;
}

/**
 * Build the opaque `flag` the OneBot schema uses to refer back to one request.
 *
 * `set_group_add_request` takes this flag and pulls the sequence, group and
 * event type back out of it, so the format is a contract between two actions.
 * The reference's canonical form is five colon-separated fields with a literal
 * `slreq:1` prefix (reference/index.mjs:11184):
 *
 *     slreq:1:<sequence>:<groupId>:<eventType>:<filtered 0|1>
 *
 * `filtered` is part of the flag because the pending and filtered buckets are
 * different sub-commands: without it, approving a request fetched from the
 * filtered bucket would be indistinguishable from one in the main bucket.
 */
export function formatGroupRequestFlag(handle: {
  sequence: bigint | number;
  groupId: number;
  eventType: number;
  filtered: boolean;
}): string {
  return ["slreq", "1", handle.sequence, handle.groupId, handle.eventType, handle.filtered ? 1 : 0].join(":");
}

/** One of the three flag grammars; see `parseGroupRequestFlag`. */
export type GroupRequestFlag =
  | { kind: "sequence"; sequence: number }
  | { kind: "canonical"; sequence: number; groupId: number; eventType: number; filtered: boolean }
  | { kind: "legacy"; requestType: "add" | "invite"; groupId: number; targetUid: string };

function positiveSafeInteger(value: string, field: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`invalid ${field} in group request flag`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid ${field} in group request flag`);
  return parsed;
}

/**
 * Inverse of `formatGroupRequestFlag`, accepting all three grammars the
 * reference accepts (reference/index.mjs:39923):
 *
 *   1. a bare number                          -> { kind: "sequence" }
 *   2. `slreq:1:seq:group:event:filtered`      -> { kind: "canonical" }
 *   3. `add:<group>:<targetUid>` / `invite:…` -> { kind: "legacy" }
 *
 * The legacy form exists because older callers cached flags from a previous
 * protocol version, and the target uid may itself contain colons, so the legacy
 * branch rejoins the tail rather than splitting on every separator.
 */
export function parseGroupRequestFlag(flag: string): GroupRequestFlag {
  if (/^\d+$/.test(flag)) return { kind: "sequence", sequence: positiveSafeInteger(flag, "sequence") };

  const parts = flag.split(":");
  if (parts[0] === "slreq") {
    if (parts.length !== 6 || parts[1] !== "1") throw new Error("unsupported canonical group request flag");
    if (parts[5] !== "0" && parts[5] !== "1") throw new Error("invalid filtered value in group request flag");
    return {
      kind: "canonical",
      sequence: positiveSafeInteger(parts[2]!, "sequence"),
      groupId: positiveSafeInteger(parts[3]!, "group_id"),
      eventType: positiveSafeInteger(parts[4]!, "event_type"),
      filtered: parts[5] === "1",
    };
  }

  const requestType = parts[0];
  if ((requestType !== "add" && requestType !== "invite") || parts.length < 3) {
    throw new Error("invalid group request flag");
  }
  const groupId = positiveSafeInteger(parts[1]!, "group_id");
  const targetUid = parts.slice(2).join(":");
  if (!targetUid) throw new Error("invalid request target in flag");
  return { kind: "legacy", requestType, groupId, targetUid };
}

/**
 * Validate a request sequence before it is used as an identifier.
 *
 * A zero or negative sequence means the record is not actionable, and the
 * reference throws rather than passing it on (reference/index.mjs:74354) — a
 * silently accepted 0 would produce an approve call that targets nothing.
 */
export function normalizeGroupRequestSequence(rawSequence: bigint | number | undefined, groupId: number): number {
  const sequence = Number(rawSequence ?? 0);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error(`invalid group-request sequence: group=${groupId} sequence=${String(rawSequence ?? 0)}`);
  }
  return sequence;
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

export interface FetchGroupRequestsParams {
  /** `false` -> sub-command 1 (pending), `true` -> sub-command 2 (filtered). */
  filtered?: boolean | undefined;
  count?: number | undefined;
  cursor?: bigint | undefined;
}

export interface MergedGroupRequestsPage {
  requests: MergedGroupRequestItem[];
  field2: bigint;
  newLatestSeq: bigint;
  field4: number;
  field5: bigint;
  field6: number;
}

/**
 * FetchGroupRequests spec.
 *
 * `decodeBody` decodes the *same bytes twice*, once per variant, and merges.
 * That is not a workaround for a broken server: the reference does it because a
 * single response can carry both identity forms, and each is only readable under
 * its own schema.
 */
export const FetchGroupRequests: OidbSpec<
  FetchGroupRequestsParams,
  GroupRequestListReq,
  MergedGroupRequestsPage,
  MergedGroupRequestItem[]
> = {
  command: GROUP_REQUESTS_COMMAND,
  uinForm: true,
  resolveSubCommand: (params) => (params.filtered === true ? GROUP_REQUESTS_SUB_COMMAND.filtered : GROUP_REQUESTS_SUB_COMMAND.pending),
  serialize: (params) => ({ count: params.count ?? 50, field2: params.cursor ?? 0n }),
  encodeBody: encodeGroupRequestList,
  decodeBody: (data, offset = 0, end = data.length) => {
    const byUin = decodeGroupRequestsByUin(data, offset, end);
    const byUid = decodeGroupRequestsByUid(data, offset, end);
    const src = byUin.requests.length > 0 ? byUin : byUid;
    return {
      requests: mergeRequestList(byUin, byUid),
      field2: src.field2,
      newLatestSeq: src.newLatestSeq,
      field4: src.field4,
      field5: src.field5,
      field6: src.field6,
    };
  },
  deserialize: (body) => body.requests,
};

// ---------------------------------------------------------------------------
// The companion command: 0x10c8 set_group_add_request
// ---------------------------------------------------------------------------
//
// ONEBOT-ACTION-SPEC.md lists `set_group_add_request` under `0x10c0_0`, but the
// reference routes it through **0x10c8** (`_SetAddRequest.command = 4296`,
// reference/index.mjs:213041).  Its body is unrelated to the list above:
//
//   OidbGroupRequestAction   reference/index.mjs:212843
//     1 accept uint32            (1 = approve, 2 = reject)
//     2 body -> OidbGroupRequestBody
//          1 sequence        uint64
//          2 eventType       uint32
//          3 groupUin        uint32
//          4 message         string   (`!= null`, so "" still emits)
//          7 operateTransInfo bytes
//
// The codec lives here because these fields are what turn a `flag` from the list
// above back into an approve/reject call; the spec, the 1-vs-2 sub-command
// selection and the `uinForm` bit live in 0x10c8.ts, which re-exports this codec.
// Keeping one copy of the field table means the list and the action can never
// disagree about a number.
//
// ⚠️ `message` uses the `!= null` presence rule, not `!= null && !== ""`
// (reference/index.mjs:212983's guard is `_f3 != null`).  The reference always
// supplies a value — a single space when the caller has no reason — so in practice
// the field is never empty, but the rule still matters: encoding it with the
// ordinary "drop when empty" rule would send a request some server versions reject.

export const SET_ADD_REQUEST_COMMAND = 0x10c8;

export const GroupRequestActionField = { accept: 1, body: 2 } as const;
export const GroupRequestBodyField = {
  sequence: 1,
  eventType: 2,
  groupUin: 3,
  message: 4,
  operateTransInfo: 7,
} as const;

export interface GroupRequestActionReq {
  accept: number;
  body: {
    sequence: bigint;
    eventType: number;
    groupUin: number;
    message: string;
    operateTransInfo?: Uint8Array | undefined;
  };
}

export function encodeGroupRequestAction(body: GroupRequestActionReq): Uint8Array {
  const inner = new ProtoWriter()
    .uint64(GroupRequestBodyField.sequence, body.body.sequence)
    .uint32(GroupRequestBodyField.eventType, body.body.eventType)
    .uint32(GroupRequestBodyField.groupUin, body.body.groupUin)
    // `!= null` rule — an empty message still emits tag + zero length.
    .stringPresent(GroupRequestBodyField.message, body.body.message)
    .bytes(GroupRequestBodyField.operateTransInfo, body.body.operateTransInfo)
    .finish();
  return new ProtoWriter()
    .uint32(GroupRequestActionField.accept, body.accept)
    .message(GroupRequestActionField.body, inner)
    .finish();
}