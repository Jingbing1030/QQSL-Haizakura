// `ContactsApi` — the roster, profiles and group metadata the actions read.
//
// ---------------------------------------------------------------------------
// What this file is, relative to the reference
// ---------------------------------------------------------------------------
// Reference region `src/bridge/apis/contacts.ts` (reference/index.mjs:74345-
// 74730, 385 lines). The reference class is 22 members; this port implements the
// eleven `ActionContactsApi` declares plus the two caches and the invite tracker
// they are built on, and omits the rest BY OMITTING THEM (see the bottom of this
// header).
//
// ---------------------------------------------------------------------------
// The two caches are not optimisations, they are anti-ban measures
// ---------------------------------------------------------------------------
// `memberListCache` (60 s TTLs) exists because a busy OneBot client — MaiBot calls
// `get_group_member_info` once per inbound chat message — otherwise issues one
// `0xfe7_3` per message: sustained >1k/h, which trips Tencent risk control and
// gets the account banned for 7 days. The reference says so in exactly those words
// (:74385). `fetchGroupMemberList(groupId, { force: true })` bypasses the TTL but
// STILL joins an in-flight load, which is why `SingleFlightCache` has a `force`
// that is not "start a second request".
//
// `friendProfiles` (300 s TTL, 4 concurrent) is a different guard: the friend
// roster's own page gives uin/uid/nickname/remark, and the per-friend public
// profile is a SEPARATE `0xfe1_2` each. Enriching 500 friends serially is minutes
// of wall clock; enriching them all at once is 500 concurrent packets, which the
// server treats as abuse. Hence a hard 4-at-a-time gate that also queues, so the
// 5th caller waits rather than failing.
//
// ---------------------------------------------------------------------------
// The friend-list paging loop's loop-exit condition
// ---------------------------------------------------------------------------
// `0xfd4_0` answers a continuation `cookie`, and the loop ends when the cookie is
// absent OR zero-length. It ALSO tracks every cookie it has seen and throws on a
// repeat — a server that echoes the same cookie forever would otherwise spin
// without bound, and "fetching the friend list hung" is a much worse failure than
// "the server sent a repeated cookie".
//
// ---------------------------------------------------------------------------
// `isRobot` is classification, not a decoded field
// ---------------------------------------------------------------------------
// `0xfe7_3`'s roster message has no robot flag at all (`toGroupMemberListPage`
// hard-codes `isRobot: false` and says why). Robot-ness comes from `0x496_0`'s
// uin RANGES, fetched once per Bridge and then applied to every member. That
// lookup is started BEFORE the first member page and awaited AFTER the last, so
// the range fetch overlaps the page walk instead of adding to it.
//
// A failure to fetch the ranges only logs: an unclassified member is better than
// a failed `get_group_member_list`, and the reference makes the same choice
// (:74395).
//
// ---------------------------------------------------------------------------
// Nothing on the reference class is absent any more
// ---------------------------------------------------------------------------
// `enrichFriendProfiles`, `fetchFriendCategories`, `setFriendCategory`,
// `fetchDownloadRKeys` and `fetchRobotUinRanges` are implemented below, and so is
// the last group:
//
//   `groupInvites`                  the `GroupInviteTracker` instance (its own module:
//                                   `group-invite-tracker.ts` — pure state, no network)
//   `rememberGroupInviteCardSequence` / `getGroupInviteCardSequence` /
//   `findGroupInviteCardGroupBySequence`   three one-line delegates onto it
//   `fetchGroupMemberListUncached`  the page walk behind `fetchGroupMemberList`'s cache
//   `loadFriendProfile`             the 4-wide gate behind the friend-profile cache
//   `fetchGroupRequestsByUid`       the uid-form twin of `fetchGroupRequests`
//   `resolveGroupJoinRequest`       the inbox search a `group_invite` push performs
//
// ⚠️ `sendTuwenArk` was once listed here as "not reached by an action". That was WRONG:
// `send_tuwen_ark` calls it from two places, so the action answered "tuwen ark is
// unavailable" against a spec (`SendTuwenArk`, 0xdc2_34) that had been ported all along.
//
// The tracker's three delegates are reached from `src/host/group-request.ts`
// (`findGroupInviteCardGroupBySequence` / `getSelfInviteNotice`), which is why they are
// PUBLIC rather than `#`-private: the reference's `groupInvites` field is public too, and
// a `#`-private member could not satisfy `GroupRequestContext.contacts`.
//
// `getBuddyRecommendArk` / `getGroupRecommendArk` ARE declared on
// `ActionContactsApi` but no action calls them either; they are implemented
// because they are one spec call each and leaving a declared member unimplemented
// would make the hub slice fail its own interface check.

import { createLogger } from "../../onebot/log.js";
import type {
  BridgeContext,
  FriendInfo,
  GroupInfo,
  GroupMemberInfo,
  UserProfile,
} from "../context.js";
import { createSingleFlightCache, type SingleFlightCache } from "../single-flight-cache.js";
import { GroupInviteTracker } from "./group-invite-tracker.js";
import { oidbCaller } from "../oidb-invoke.js";
import { toHex } from "../../msg-push.js";
import {
  QIDIAN_CORP_INFO_CMD,
  decodeQidianCorpInfo,
  encodeQidianCorpInfoRequest,
  type QidianCorpInfo,
} from "./service-codecs.js";
import {
  // 0xfd4_0
  FetchFriendListPage,
  type FriendListItem,
  type FriendCategory,
  // 0xfe5_2
  FetchGroupList,
  type GroupSummary,
  // 0x88d_0 (aliased in the barrel — see group-admin.ts's import comment)
  FetchGroupDetailInfo,
  // 0xfe7_3
  FetchGroupMemberListPage,
  // 0xfe1_2
  FetchUserProfile,
  FetchUserProfileByUid,
  type UserProfile as OidbUserProfile,
  // 0x9060_3
  GetGroupShareLink,
  // 0x8b7_5 / 0x12b6_0
  GetGroupRecommendArk,
  GetBuddyRecommendArk,
  // 0x10c0_1 / 0x10c0_2
  FetchGroupRequests,
  groupRequestOperationType,
  normalizeGroupRequestSequence,
  formatGroupRequestFlag,
  isSelfGroupInvitation,
  type MergedGroupRequestItem,
  // 0x496_0
  FetchRobotUinRanges,
  // 0x496_9067 (the uid-form twin of 0x10c0_1/0x10c0_2)
  FetchGroupRequestsByUid,
  // 0x1cfe_0
  SetFriendCategory,
  // 0x9067_202
  FetchDownloadRkeys,
  toDownloadRkeys,
  // 0xdc2_34
  SendTuwenArk,
} from "../../oidb/services/index.js";
import type { SendTuwenArkParams } from "../../oidb/services/index.js";
import type {
  ActionFriendInfo,
  ActionGroupInfo,
  ActionGroupMemberInfo,
  ActionFriendCategory,
  ActionGroupRequest,
  ActionUserProfile,
  FilteredGroupRequestRow,
  GroupRequestInboxRow,
} from "../../onebot/actions/context.js";

const log = createLogger("Bridge.Contacts");

/**
 * A robot-uin range. `0x496-9067.ts` declares it but the barrel does not re-export
 * the type (only the spec), so it is restated here — structurally identical, and
 * `FetchRobotUinRanges`'s result is assignable to it without a cast.
 */
export interface RobotUinRange {
  minUin: number;
  maxUin: number;
}

/** `MEMBER_LIST_TTL_MS` (reference/index.mjs:74350). */
export const MEMBER_LIST_TTL_MS = 6e4;
/** `FRIEND_PROFILE_TTL_MS` (:74351) — `5 * 6e4` = five minutes, written as a product. */
export const FRIEND_PROFILE_TTL_MS = 5 * 6e4;
/** `FRIEND_PROFILE_CONCURRENCY` (:74352). */
export const FRIEND_PROFILE_CONCURRENCY = 4;

/**
 * `isGroupAllMuted` (:74347).
 *
 * A group is "all muted" while the mute EXPIRY is still in the future — so the
 * field is a timestamp, not a boolean, and `0` means "not muted", not "muted
 * since the epoch". Note this is the reference's own private copy inside
 * `contacts.ts`; `0xfe5-2.ts` exports an identical one, and `isGroupAllMuted`
 * below is re-exported so callers can share it.
 */
export function isGroupAllMuted(expireTs: number | undefined, nowSec = Math.floor(Date.now() / 1_000)): boolean {
  return (expireTs ?? 0) > nowSec;
}

/** `isRobotUin` (:74350). */
export function isRobotUin(uin: number, ranges: readonly { minUin: number; maxUin: number }[]): boolean {
  return Number.isInteger(uin) && uin > 0 && ranges.some(({ minUin, maxUin }) => uin >= minUin && uin <= maxUin);
}

// ---------------------------------------------------------------------------
// Two shapes, one object: why these aliases exist
// ---------------------------------------------------------------------------
// Every row this API produces has to satisfy TWO declared types:
//
//   `ActionContactsApi`  (`src/onebot/actions/context.ts`) — what the actions read
//   `ContactsApiSlice`   (`src/bridge/context.ts`)          — what OTHER APIs read
//
// and under `exactOptionalPropertyTypes` they are not mutually assignable:
//
//   member `isRobot`   `boolean | undefined`  vs  `boolean`
//   group  `members`   `Map<number, ActionGroupMemberInfo>` vs `Map<number, GroupMemberInfo>`
//   profile `sex`      `string`  vs  `"male" | "female" | "unknown"`
//
// An INTERSECTION collapses each of those to the narrower side (`undefined & boolean`
// is `never`, `string & "male"|...` is the union), which is assignable to BOTH. That
// is not a trick — it is accurate: by the time these rows are returned, the
// classification has run and the sex word has been narrowed, so the intersection is
// the value's real type rather than a widening of it.
//
// `Omit` on `members` is required because two *optional* `members` properties with
// different types intersect to a `Map & Map` that is assignable to neither.

/** A member row that satisfies both the action shape and the bridge roster shape. */
export type RosterMember = ActionGroupMemberInfo & GroupMemberInfo;

/** A profile row that satisfies both. */
export type RosterProfile = ActionUserProfile & UserProfile;

/** A group row that satisfies both. */
export type RosterGroup = Omit<ActionGroupInfo, "members"> & Omit<GroupInfo, "members"> & {
  /**
   * Non-optional here even though both source types declare it optional.
   *
   * Under `exactOptionalPropertyTypes` an intersection of two optional `members`
   * properties is `Map & Map` — assignable to neither, because the *presence* of
   * the key is part of the type. Making it required in the intersection removes
   * that ambiguity, and every row this API produces really does carry a map: the
   * roster's member map exists from the moment the group is listed, exactly as the
   * reference's `fetchGroupList` does with `members: new Map()`.
   *
   * ⚠️ The consequence is that `get_group_list` reports `members` as an EMPTY map
   * until `fetchGroupMemberList` fills it. That is the reference's behaviour, not a
   * bug: `fetchGroupList` never populates it.
   */
  members: Map<number, RosterMember>;
};

const fetchFriendListPageCall = oidbCaller(FetchFriendListPage);
const fetchGroupListCall = oidbCaller(FetchGroupList);
const fetchGroupDetailCall = oidbCaller(FetchGroupDetailInfo);
const fetchGroupMemberListPageCall = oidbCaller(FetchGroupMemberListPage);
const fetchUserProfileCall = oidbCaller(FetchUserProfile);
const fetchUserProfileByUidCall = oidbCaller(FetchUserProfileByUid);
const getGroupShareLinkCall = oidbCaller(GetGroupShareLink);
const getGroupRecommendArkCall = oidbCaller(GetGroupRecommendArk);
const getBuddyRecommendArkCall = oidbCaller(GetBuddyRecommendArk);
const fetchGroupRequestsCall = oidbCaller(FetchGroupRequests);
const fetchGroupRequestsByUidCall = oidbCaller(FetchGroupRequestsByUid);
const fetchRobotUinRangesCall = oidbCaller(FetchRobotUinRanges);
const fetchDownloadRkeysCall = oidbCaller(FetchDownloadRkeys);
const setFriendCategoryCall = oidbCaller(SetFriendCategory);

/**
 * The `0xfe5_2` group row, mapped onto the action-facing shape.
 *
 * ⚠️ `FetchGroupList`'s `deserialize` is `toGroupSummary`, so what arrives is
 * already the ONEBOT projection (`group_id`, `group_member_count`, …) and NOT the
 * wire `GroupListResp { groups: GroupEntry[] }`. Reading `.groups` off it yields
 * `undefined` and an empty roster — with no error. So this maps the summary.
 *
 * `level` and `members` are added because `ActionGroupInfo` declares them and
 * because the reference's own `fetchGroupList` sets `members: new Map()`: the
 * roster's member map is filled by `fetchGroupMemberList`, never by the list.
 * `level` stays absent, which is exactly why `get_group_list` reports
 * `group_level: 0` for every group (see `ActionGroupInfo`'s comment).
 */
function toGroupInfo(summary: GroupSummary): RosterGroup {
  return {
    groupId: summary.group_id,
    groupName: summary.group_name,
    remark: summary.group_remark,
    memberCount: summary.member_count,
    memberMax: summary.max_member_count,
    members: new Map(),
    createTime: summary.group_create_time,
    memo: summary.group_memo,
    description: summary.group_description,
    allMuted: summary.group_all_shut === -1,
  };
}

/**
 * Narrow a `0xfe1_2` profile onto the action-facing shape.
 *
 * ⚠️ There are TWO `UserProfile` types in this port and they are not the same:
 *
 *   `oidb/services/0xfe1.ts`  UserProfile  30 fields, has `profile`/`status`/vip
 *   `bridge/context.ts`      UserProfile  extends `SelfProfile`: 13 fields
 *
 * The bridge one is the ROSTER row, so it deliberately carries only what a roster
 * entry keeps. The actions need the wide one. Converting between them is a real
 * narrowing/widening, not a cast:
 *   * `profile` goes from an interface to a `Record<string, unknown>`, because
 *     `formatPublicProfile` reads it by string key;
 *   * `sex` goes from the OIDB decoder's plain `string` to the action type's plain
 *     `string` (same), so nothing is re-derived from the raw 20009 code.
 */
function toActionUserProfile(info: OidbUserProfile): RosterProfile {
  const profile: Record<string, unknown> = { ...(info.profile ?? {}) };
  // The bridge roster type wants the three-word union and the action type wants a
  // plain string; the union is assignable to `string`, so narrowing once satisfies
  // both. The spec already mapped the raw 20009 code, so this only re-asserts it.
  const sex = info.sex === "male" ? "male" : info.sex === "female" ? "female" : "unknown";
  return { ...info, sex, profile };
}

/**
 * The roster / profile API.
 *
 * Reference `var ContactsApi = class` at reference/index.mjs:74359.
 */
const sendTuwenArkCall = oidbCaller(SendTuwenArk);

export class ContactsApi {
  readonly #ctx: BridgeContext;

  /**
   * Per-group TTL + single-flight cache for `fetchGroupMemberList`.
   *
   * Keyed by groupId for the lifetime of the Bridge. See the header for why this
   * is a correctness requirement and not a speed-up.
   */
  readonly #memberListCache: SingleFlightCache<number, readonly RosterMember[]>;

  /** In-flight or settled robot-uin ranges; cleared on failure so the next call retries. */
  #robotUinRangesPromise: Promise<{ version: number; ranges: RobotUinRange[] }> | null = null;

  /** The 4-at-a-time gate for friend-profile enrichment. */
  #activeProfiles = 0;
  readonly #profileWaiters: (() => void)[] = [];

  readonly #friendProfiles: SingleFlightCache<number, Record<string, unknown>>;

  /**
   * The invitation CARD ↔ NOTICE pairer (`group-invite-tracker.ts`).
   *
   * ⚠️ PUBLIC, not `#`-private. `src/host/group-request.ts` reaches it through
   * `GroupRequestContext.contacts.groupInvites`, and the reference's field is public
   * too (reference:74373 `groupInvites = new GroupInviteTracker()`), so a private
   * field would make the three delegates below unreachable from the one layer that
   * actually calls them.
   *
   * It is account-local STATE, not a cache: nothing here is derived from the server,
   * it is the record of two wire events that arrived separately. That is also why it
   * is not cleared by `clearCaches()` — a re-read of the roster does not un-pair an
   * invitation.
   */
  readonly groupInvites = new GroupInviteTracker();

  constructor(ctx: BridgeContext) {
    this.#ctx = ctx;
    this.#memberListCache = createSingleFlightCache<number, readonly RosterMember[]>({
      ttlMs: MEMBER_LIST_TTL_MS,
      load: (groupId) => this.fetchGroupMemberListUncached(groupId),
    });
    this.#friendProfiles = createSingleFlightCache<number, Record<string, unknown>>({
      ttlMs: FRIEND_PROFILE_TTL_MS,
      load: (uin) => this.loadFriendProfile(uin),
    });
  }

  // -------------------------------------------------------------------------
  // Robot uin ranges
  // -------------------------------------------------------------------------

  /**
   * Load the robot uin ranges, once.
   *
   * The rejection handler is attached in the same turn and clears
   * `#robotUinRangesPromise` BEFORE re-throwing, so a caller that awaits the
   * rejected promise sees the error and the NEXT call starts a fresh fetch. If the
   * clear were skipped, one transient failure would disable robot classification
   * for the rest of the session.
   */
  fetchRobotUinRanges(groupId: number): Promise<{ version: number; ranges: RobotUinRange[] }> {
    if (this.#robotUinRangesPromise) return this.#robotUinRangesPromise;
    const pending = fetchRobotUinRangesCall.invoke(this.#ctx, {}).then((snapshot) => {
      log.info(
        "loaded robot UIN ranges uin=%s version=%d count=%d",
        this.#ctx.identity.uin,
        snapshot.version,
        snapshot.ranges.length,
      );
      return snapshot;
    });
    this.#robotUinRangesPromise = pending;
    pending.catch((err: unknown) => {
      if (this.#robotUinRangesPromise === pending) this.#robotUinRangesPromise = null;
      log.error(
        "failed to load robot UIN ranges: uin=%s group=%d err=%s",
        this.#ctx.identity.uin,
        groupId,
        err instanceof Error ? (err.stack ?? err.message) : String(err),
      );
    });
    return pending;
  }

  // -------------------------------------------------------------------------
  // Friends
  // -------------------------------------------------------------------------

  /**
   * One friend-list walk: pages until the cookie stops, then optionally enriches.
   *
   * `entries` carries the categoryId, which `fetchFriendList` throws away — that is
   * the reference's split, and `formatFriend`'s second argument is where the
   * categoryId gets re-attached.
   */
  async fetchFriendRoster(options: { withProfile?: boolean | undefined } = {}): Promise<{
    entries: readonly FriendListItem[];
    categories: readonly FriendCategory[];
  }> {
    const entries: FriendListItem[] = [];
    const categories = new Map<number, FriendCategory>();
    const seenCookies = new Set<string>();
    let cookie: Uint8Array | undefined;
    for (;;) {
      // Built conditionally: `exactOptionalPropertyTypes` forbids `{cookie: undefined}`,
      // and the spec's `serialize` tests the key's presence.
      const page = await fetchFriendListPageCall.invoke(
        this.#ctx,
        cookie === undefined ? {} : { cookie },
      );
      entries.push(...page.entries);
      for (const category of page.categories) categories.set(category.categoryId, category);
      const next = page.cookie;
      if (!next || next.length === 0) break;
      const key = toHex(next);
      if (seenCookies.has(key)) throw new Error(`repeated friend-list cookie ${key}`);
      seenCookies.add(key);
      cookie = next;
    }
    if (options.withProfile === true) await this.enrichFriendProfiles(entries);
    this.#ctx.identity.rememberFriends(entries.map((entry) => entry.friend));
    return { entries, categories: [...categories.values()] };
  }

  /**
   * The roster grouped by category — `get_friends_with_category`.
   *
   * ⚠️ Not a separate `0x1cfe`/`0x1d00` walk. `fetchFriendRoster` already returns both
   * halves from one `0xfd4_0` page sequence, so grouping here costs no extra round trip;
   * the reference's two-command split exists because its provider caches them separately,
   * which this port does not need. A friend whose `categoryId` names no category in the
   * roster still gets a group, because dropping them would lose a friend from the list.
   *
   * `memberCount` is the server's own count, NOT `friends.length` — the two disagree when
   * a page was truncated, and reporting the local length would hide that.
   */
  async fetchFriendCategories(
    options: { withProfile?: boolean | undefined } = {},
  ): Promise<ActionFriendCategory[]> {
    const { entries, categories } = await this.fetchFriendRoster(options);
    // Built as mutable rows, narrowed to the readonly interface on return: `friends` is
    // `readonly` on `ActionFriendCategory`, so the grouping cannot push into it directly.
    const byId = new Map<number, {
      categoryId: number;
      categoryName: string;
      memberCount: number;
      friends: ActionFriendInfo[];
    }>();
    // Seed from the server's category list so an EMPTY category still appears: a group with
    // no friends is a real group, and omitting it makes the client think it was deleted.
    for (const category of categories) {
      byId.set(category.categoryId, {
        categoryId: category.categoryId,
        categoryName: category.categoryName,
        memberCount: category.memberCount,
        friends: [],
      });
    }
    for (const entry of entries) {
      let group = byId.get(entry.categoryId);
      if (group === undefined) {
        // A friend in an uncatalogued category: keep the friend, name the group by its id
        // rather than inventing a label or dropping the row.
        group = {
          categoryId: entry.categoryId,
          categoryName: String(entry.categoryId),
          memberCount: 0,
          friends: [],
        };
        byId.set(entry.categoryId, group);
      }
      group.friends.push(toActionFriend(entry.friend));
    }
    // A friend in a seeded (empty) category still needs the action-facing shape.
    return [...byId.values()];
  }

  /**
   * `set_friends_category` — move one friend into a category.
   *
   * Exactly one of `categoryId` / `categoryName` must be supplied (the action's `rules`
   * enforces it). A name is resolved against the roster's own category list rather than
   * sent to the server: the wire call takes an id, and a name that matches nothing is a
   * caller error worth reporting before a mutation.
   *
   * ⚠️ The wire takes the friend's **uid**, not the uin the action is given
   * (`SetFriendCategoryParams.uid`, 0x1255.ts:99). A uin sent in its place is a
   * well-formed request to a nonexistent friend, which the server accepts silently.
   */
  async setFriendCategory(params: {
    uin: number;
    categoryId?: number | undefined;
    categoryName?: string | undefined;
  }): Promise<void> {
    let categoryId = params.categoryId;
    if (categoryId === undefined) {
      const name = params.categoryName ?? "";
      const { categories } = await this.fetchFriendRoster();
      const match = categories.find((category) => category.categoryName === name);
      if (match === undefined) {
        throw new Error(`friend category not found: ${name}`);
      }
      categoryId = match.categoryId;
    }
    const uid = this.#ctx.identity.findUidByUin(params.uin);
    if (!uid) {
      throw new Error(`no uid known for friend ${params.uin}`);
    }
    await setFriendCategoryCall.invoke(this.#ctx, { uid, categoryId });
  }

  /** `fetchFriendList` — the roster without the categoryId. */
  async fetchFriendList(options: { withProfile?: boolean | undefined } = {}): Promise<readonly ActionFriendInfo[]> {
    return (await this.fetchFriendRoster(options)).entries.map((entry) => ({
      ...toActionFriend(entry.friend),
      categoryId: entry.categoryId,
    }));
  }

  /**
   * Fill in each friend's public profile, four at a time.
   *
   * `Promise.allSettled` is deliberate: one friend whose profile lookup fails must
   * not discard the other 499, but the failures are still reported — the reference
   * collects them and throws an `AggregateError` after the whole roster is done
   * (:74444). So "partial success" is NOT silently accepted: the caller gets every
   * friend enriched up to the failures AND an exception naming them.
   */
  async enrichFriendProfiles(entries: readonly FriendListItem[]): Promise<void> {
    for (let offset = 0; offset < entries.length; offset += FRIEND_PROFILE_CONCURRENCY) {
      const batch = entries.slice(offset, offset + FRIEND_PROFILE_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (entry) => {
          const extra = await this.#friendProfiles.get(entry.friend.uin);
          entry.friend.profile = { ...extra };
        }),
      );
      const errors = results.filter((result) => result.status === "rejected");
      if (errors.length > 0) {
        throw new AggregateError(
          errors.map((result) => (result as PromiseRejectedResult).reason),
          "friend profile enrichment failed",
        );
      }
    }
  }

  /** `loadFriendProfile` (:74404) — the concurrency gate around one lookup. */
  async loadFriendProfile(uin: number): Promise<Record<string, unknown>> {
    if (this.#activeProfiles >= FRIEND_PROFILE_CONCURRENCY) {
      await new Promise<void>((resolve) => this.#profileWaiters.push(resolve));
    } else {
      this.#activeProfiles++;
    }
    try {
      const info = await fetchUserProfileCall.invoke(this.#ctx, { uin });
      return { ...(info.profile ?? {}) };
    } catch (cause) {
      log.warn("friend profile query failed: user=%d error=%s", uin, cause instanceof Error ? cause.message : String(cause));
      throw new Error(`friend profile query failed for ${uin}`, { cause });
    } finally {
      // Hand the slot to the next waiter (which does NOT increment), or give it
      // back. Incrementing for a promoted waiter would leak a slot.
      const next = this.#profileWaiters.shift();
      if (next) next();
      else this.#activeProfiles--;
    }
  }

  // -------------------------------------------------------------------------
  // Groups
  // -------------------------------------------------------------------------

  /**
   * `0xfe5_2` group list, remembered into the roster.
   *
   * The SPEC's `deserialize` already produced OneBot field names, so this maps the
   * raw wire `GroupEntry` itself. Both are reachable; the wire one is used because
   * it carries `customInfo.remark` and `shutUpAllTimestamp`, which the OneBot
   * projection has already collapsed.
   */
  async fetchGroupList(): Promise<readonly RosterGroup[]> {
    const summaries = await fetchGroupListCall.invoke(this.#ctx, {});
    const groups = summaries.map((row) => toGroupInfo(row));
    this.#ctx.identity.rememberGroups(groups);
    return groups;
  }

  /**
   * One group's public detail via `0x88d_0`, working for a group the bot has NOT
   * joined (which is what makes it usable for resolving an invite's group name).
   *
   * Deliberately does NOT `rememberGroups` it: remembering a non-member group would
   * pollute `get_group_list`, which is the joined roster. Returns `null` when the
   * server has no such group or denies the lookup — that is a fact, not an error.
   */
  async fetchGroupDetail(groupId: number): Promise<ActionGroupInfo | null> {
    if (!(groupId > 0)) return null;
    const r = (await fetchGroupDetailCall.invoke(this.#ctx, { groupUin: groupId })).groupInfo?.results;
    if (!r) return null;
    return {
      groupId,
      groupName: r.name ?? "",
      remark: "",
      memberCount: Number(r.memberCount ?? 0n),
      memberMax: Number(r.maxMemberCount ?? 0n),
      members: new Map(),
      createTime: Number(r.createTime ?? 0n),
      level: Number(r.level ?? 0n),
      memo: r.noticePreview ?? "",
      allMuted: isGroupAllMuted(r.shutUpAllTimestamp),
    };
  }

  /**
   * The cached member list. `force` bypasses the TTL but still joins an in-flight
   * load — see `SingleFlightCache`.
   */
  fetchGroupMemberList(
    groupId: number,
    options: { force?: boolean | undefined } = {},
  ): Promise<readonly RosterMember[]> {
    return this.#memberListCache.get(groupId, options.force === true ? { force: true } : {});
  }

  /**
   * Walk every `0xfe7_3` page, then classify robots.
   *
   * The robot-range fetch is STARTED FIRST so it overlaps the page walk, and its
   * failure is swallowed (logged inside `fetchRobotUinRanges`) because an
   * unclassified member is better than no member list at all.
   */
  async fetchGroupMemberListUncached(groupId: number): Promise<readonly RosterMember[]> {
    const robotSnapshotPromise = this.fetchRobotUinRanges(groupId);
    const members: RosterMember[] = [];
    let token = "";
    while (true) {
      const page = await fetchGroupMemberListPageCall.invoke(
        this.#ctx,
        token ? { groupId, token } : { groupId },
      );
      members.push(...page.members.map(toActionGroupMember));
      token = page.token;
      if (!token) break;
    }
    let ranges: readonly RobotUinRange[] = [];
    try {
      ranges = (await robotSnapshotPromise).ranges;
    } catch {
      // Already logged by fetchRobotUinRanges's catch; classification degrades to
      // "unknown robot-ness" rather than failing the whole list.
      ranges = [];
    }
    for (const member of members) member.isRobot = isRobotUin(member.uin, ranges);
    this.#ctx.identity.rememberGroupMembers(groupId, members);
    return members;
  }

  // -------------------------------------------------------------------------
  // Profiles
  // -------------------------------------------------------------------------

  async fetchUserProfile(uin: number): Promise<RosterProfile> {
    const info = await fetchUserProfileCall.invoke(this.#ctx, { uin });
    const profile = toActionUserProfile(info);
    this.#ctx.identity.rememberUserProfile(asBridgeProfile(profile));
    return profile;
  }

  /**
   * Look a profile up by uid — the stranger path, used for a join request's
   * requester whose uin is not known yet.
   */
  async fetchUserProfileByUid(uid: string): Promise<RosterProfile> {
    const info = await fetchUserProfileByUidCall.invoke(this.#ctx, { uid });
    const profile = toActionUserProfile(info);
    // `> 0` guard, not `!== undefined`: a uid-only response carries uin 0, and
    // remembering that would create a friend at uin 0.
    if (profile.uin > 0) this.#ctx.identity.rememberUserProfile(asBridgeProfile(profile));
    return profile;
  }

  /**
   * 企点 (qidian) corp card, best-effort.
   *
   * Returns `null` for a non-qidian account rather than throwing: callers only
   * reach this after the profile's own flags said the account IS a qidian user, so
   * a null here means "the card did not resolve", not "not a qidian user". The
   * reference's `invoke` also returns null on a failed transport (see
   * `fetchCorpInfo`'s three null cases), so a network blip degrades the
   * `qidian_enterprise_name` field to `""` instead of failing `get_stranger_info`.
   */
  /**
   * Rich-media download keys (`get_rkey` / `get_rkey_server`).
   *
   * The request carries no parameters at all — `FetchDownloadRkeys.serialize` ignores its
   * input and always asks for the same three rkey types (10 private image, 20 group image,
   * 2 the old fallback). The response is the whole NTV2 envelope, so the keys are projected
   * out of `downloadRkey.rkeys`.
   *
   * ⚠️ The retCode lives INSIDE the media envelope (`respHead.retCode`), not on the OIDB
   * header: an expired credential or a missing file arrives as a *successful* OIDB call
   * whose body reports the failure. `assertRkeyRetCode` has already thrown for that case by
   * the time this returns, which is why a caller never sees a silent empty list.
   *
   * An empty list is therefore meaningful: the envelope succeeded and simply had no keys.
   */
  async fetchDownloadRKeys(): Promise<
    Array<{ rkey: string; ttlSeconds: number; storeId: number; createTime: number; type: number }>
  > {
    const resp = await fetchDownloadRkeysCall.invoke(this.#ctx, {});
    // `toDownloadRkeys` names the wire fields (`rkeyTtlSec`, `rkeyCreateTime`); the action
    // layer names them `ttlSeconds` / `createTime`. Renaming happens here so the boundary
    // has one translation instead of each caller inventing its own.
    return toDownloadRkeys(resp).map((key) => ({
      rkey: key.rkey,
      ttlSeconds: key.rkeyTtlSec,
      storeId: key.storeId,
      createTime: key.rkeyCreateTime,
      type: key.type,
    }));
  }

  async fetchQidianCorpInfo(uin: number): Promise<{ name: string } | null> {
    const result = await this.#ctx.sendRawPacket(QIDIAN_CORP_INFO_CMD, encodeQidianCorpInfoRequest(uin));
    if (!result.success || !result.gotResponse || !result.responseData || result.responseData.length === 0) {
      return null;
    }
    return decodeQidianCorpInfo(result.responseData);
  }

  // -------------------------------------------------------------------------
  // Links / ark cards
  // -------------------------------------------------------------------------

  /**
   * `get_group_share_link`.
   *
   * `srcId` is NOT on the wire: `0x9060_3`'s body carries `type`, `groupCode`,
   * `additionalParam` and `needShortUrl` only. The reference accepts `srcId` and
   * drops it (:71545). It is kept in the signature because the ACTION has a
   * `src_id` parameter with a default of 73 and changing the signature would mean
   * the action silently ignoring a documented field.
   */
  async getGroupShareLink(
    groupId: number,
    needShortUrl = true,
    srcId = 73,
    additionalParam = "",
  ): Promise<string> {
    void srcId;
    return getGroupShareLinkCall.invoke(this.#ctx, { groupId, needShortUrl, additionalParam });
  }

  /** Server-built ARK share card (a JSON string) recommending a group. */
  async getGroupRecommendArk(groupId: number): Promise<string> {
    return getGroupRecommendArkCall.invoke(this.#ctx, { groupId });
  }

  /** Server-built ARK share card recommending a friend. `phoneNumber` defaults to `""`. */
  async getBuddyRecommendArk(userId: number, phoneNumber = ""): Promise<string> {
    return getBuddyRecommendArkCall.invoke(this.#ctx, { userId, phoneNumber });
  }

  // -------------------------------------------------------------------------
  // Group requests
  // -------------------------------------------------------------------------

  /**
   * One page of the join-request inbox, projected onto `ActionGroupRequest`.
   *
   * Six resolutions per row, and every one is the reference's (:74640):
   *   * `targetUid` falls back from the by-uid decode to the roster by group, then
   *     the roster unscoped;
   *   * `targetUin` falls back the OTHER way (from the by-uin decode to a
   *     uid→uin lookup), because the two decode variants each carry only one half;
   *   * `eventType` is the MAPPED operation type, and an unmapped notify type
   *     becomes `0` after a warning rather than throwing — the row is still a real
   *     request the user may need to see.
   *
   * `normalizeGroupRequestSequence` turns a missing/zero sequence into an error:
   * a request with no sequence cannot be approved or rejected, and returning it
   * with `sequence: 0` would produce a `flag` that `set_group_add_request` cannot
   * parse.
   */
  async fetchGroupRequests(
    filtered = false,
    count = 50,
    cursor = 0n,
  ): Promise<readonly ActionGroupRequest[]> {
    const resp = await fetchGroupRequestsCall.invoke(this.#ctx, { filtered, count, cursor });
    const requests: ActionGroupRequest[] = [];
    for (const raw of resp) {
      const groupId = raw.group?.groupUin ?? 0;
      const targetUin = raw.target?.uin ?? 0;
      const invitorUin = raw.invitor?.uin ?? 0;
      const targetUid =
        raw.target?.uid ||
        this.#ctx.identity.findUidByUin(targetUin, groupId) ||
        this.#ctx.identity.findUidByUin(targetUin) ||
        "";
      const invitorUid =
        raw.invitor?.uid ||
        this.#ctx.identity.findUidByUin(invitorUin, groupId) ||
        this.#ctx.identity.findUidByUin(invitorUin) ||
        "";
      const notifyType = raw.eventType ?? 0;
      const operationType = groupRequestOperationType(notifyType);
      const sequence = normalizeGroupRequestSequence(raw.sequence, groupId);
      if (operationType === null) {
        log.warn(
          "unsupported group-request notification type: group=%d sequence=%s type=%d",
          groupId,
          String(raw.sequence ?? 0n),
          notifyType,
        );
      }
      requests.push({
        sequence: BigInt(sequence),
        eventType: operationType ?? 0,
        state: raw.state ?? 0,
        ...(raw.group === undefined
          ? {}
          : { group: { groupUin: groupId, groupName: raw.group.groupName ?? "" } }),
        target: {
          uid: targetUid,
          uin: targetUin || this.#ctx.identity.findUinByUid(targetUid, groupId) || this.#ctx.identity.findUinByUid(targetUid) || 0,
          name: raw.target?.name ?? "",
        },
        invitor: {
          uid: invitorUid,
          uin: invitorUin || this.#ctx.identity.findUinByUid(invitorUid, groupId) || this.#ctx.identity.findUinByUid(invitorUid) || 0,
          name: raw.invitor?.name ?? "",
        },
        comment: raw.comment ?? "",
      });
    }
    this.#ctx.identity.rememberGroupRequests(requests);
    return requests;
  }

  /**
   * The FLAT inbox rows — what `get_group_system_msg` and `set_group_add_request` read.
   *
   * ⚠️ Not a re-shaping of `fetchGroupRequests`. That one returns the nested
   * `{group, target, invitor}` view, which carries no `notifyType`, no `groupId` at the top
   * level and no `filtered` flag — the three fields this projection is asked for. The
   * reference keeps two separate readers for the two packet variants (`fetchGroupRequests`
   * for the nested view, `fetchFilteredGroupRequests` for this one,
   * reference:74608-74648), and a nested→flat adapter here would answer plausible values in
   * every field while being wrong in all of them. So this reads the same spec and projects
   * the flat shape directly.
   *
   * `filtered` selects the inbox: `true` asks for the already-filtered page. The row is
   * otherwise identical between the two.
   */
  async fetchFilteredGroupRequests(
    count = 50,
    filtered = false,
  ): Promise<readonly FilteredGroupRequestRow[]> {
    const resp = await fetchGroupRequestsCall.invoke(this.#ctx, { filtered, count, cursor: 0n });
    const rows: FilteredGroupRequestRow[] = [];
    for (const raw of resp) {
      const groupId = raw.group?.groupUin ?? 0;
      const targetUin = raw.target?.uin ?? 0;
      const invitorUin = raw.invitor?.uin ?? 0;
      const targetUid =
        raw.target?.uid ||
        this.#ctx.identity.findUidByUin(targetUin, groupId) ||
        this.#ctx.identity.findUidByUin(targetUin) ||
        "";
      const invitorUid =
        raw.invitor?.uid ||
        this.#ctx.identity.findUidByUin(invitorUin, groupId) ||
        this.#ctx.identity.findUidByUin(invitorUin) ||
        "";
      const notifyType = raw.eventType ?? 0;
      const operationType = groupRequestOperationType(notifyType);
      rows.push({
        groupId,
        groupName: raw.group?.groupName ?? "",
        targetUid,
        targetUin:
          targetUin ||
          this.#ctx.identity.findUinByUid(targetUid, groupId) ||
          this.#ctx.identity.findUinByUid(targetUid) ||
          0,
        targetName: raw.target?.name ?? "",
        invitorUid,
        invitorUin:
          invitorUin ||
          this.#ctx.identity.findUinByUid(invitorUid, groupId) ||
          this.#ctx.identity.findUinByUid(invitorUid) ||
          0,
        invitorName: raw.invitor?.name ?? "",
        // The 0x10c0 response carries no third party; an operator is filled in only when the
        // decoders surface one, so these stay empty rather than being invented.
        operatorUid: "",
        operatorUin: 0,
        operatorName: "",
        sequence: Number(raw.sequence ?? 0n),
        state: raw.state ?? 0,
        notifyType,
        eventType: operationType ?? 0,
        comment: raw.comment ?? "",
        filtered,
      });
    }
    return rows;
  }

  /**
   * The UID-form twin of `fetchGroupRequests` (:74654).
   *
   * ⚠️ A DIFFERENT SPEC, not a different projection. `FetchGroupRequests` (`0x10c0`)
   * decodes the response twice — once per identity form — and merges, because one
   * response can carry both. `FetchGroupRequestsByUid` (`0x496_9067`) sends the same
   * request bytes WITHOUT `uinForm` and decodes only the uid variant, whose every
   * scalar is `| null` rather than `0`/`""`. So a uid-form row can say "the target
   * uid is absent"; the merged row cannot.
   *
   * Every `?? ""` / `?? 0` below is that nullability, not a default: the reference
   * writes the same fallbacks (:74666). `findUinByUid` uses `??` rather than `||`
   * because the reference does, and the difference is visible: a lookup that answers
   * `0` is a known-absent uin, which `||` would replace with the next fallback.
   *
   * Retained for correlating incoming UID-only pushes — the explicit list/action
   * paths use `fetchGroupRequests`, which matches QQ's native numeric-account path
   * and needs no profile lookups.
   */
  async fetchGroupRequestsByUid(
    filtered = false,
    count = 50,
    cursor = 0n,
  ): Promise<readonly GroupRequestInboxRow[]> {
    const resp = await fetchGroupRequestsByUidCall.invoke(this.#ctx, { filtered, count, cursor });
    // `deserialize: (body) => body` — the page IS the result, so `.requests` is the
    // only wrapper field this reader needs (the cursor metadata is for a paginator
    // this API does not expose).
    const requests: GroupRequestInboxRow[] = [];
    for (const raw of resp.requests) {
      const groupId = raw.group?.groupUin ?? 0;
      const targetUid = raw.target?.uid ?? "";
      const invitorUid = raw.invitor?.uid ?? "";
      const operatorUid = raw.operatorUser?.uid ?? "";
      const notifyType = raw.eventType ?? 0;
      const operationType = groupRequestOperationType(notifyType);
      // ⚠️ `?? undefined`, not a bare `raw.sequence`: the uid-form decoder types every
      // scalar as `bigint | null` (each slot starts at `null`), while
      // `normalizeGroupRequestSequence` declares `bigint | number | undefined`. The two
      // are equivalent here — the helper's first act is `Number(rawSequence ?? 0)` — so
      // an absent sequence still throws the same "invalid group-request sequence" error.
      const sequence = normalizeGroupRequestSequence(raw.sequence ?? undefined, groupId);
      if (operationType === null) {
        // ⚠️ WARN, not an error: the row is still a real request the user may need to
        // see, so it is pushed with `eventType: 0` below.
        log.warn(
          "unsupported group-request notification type: group=%d sequence=%s type=%d",
          groupId,
          String(raw.sequence ?? 0n),
          notifyType,
        );
      }
      requests.push({
        groupId,
        groupName: raw.group?.groupName ?? "",
        targetUid,
        targetUin:
          this.#ctx.identity.findUinByUid(targetUid, groupId) ??
          this.#ctx.identity.findUinByUid(targetUid) ??
          0,
        targetName: raw.target?.name ?? "",
        invitorUid,
        invitorUin:
          this.#ctx.identity.findUinByUid(invitorUid, groupId) ??
          this.#ctx.identity.findUinByUid(invitorUid) ??
          0,
        invitorName: raw.invitor?.name ?? "",
        operatorUid,
        operatorUin:
          this.#ctx.identity.findUinByUid(operatorUid, groupId) ??
          this.#ctx.identity.findUinByUid(operatorUid) ??
          0,
        operatorName: raw.operatorUser?.name ?? "",
        sequence,
        state: raw.state ?? 0,
        notifyType,
        eventType: operationType ?? 0,
        comment: raw.comment ?? "",
        filtered,
        // `raw.operateTransInfo && raw.operateTransInfo.length > 0 ? ... : void 0` —
        // an EMPTY byte array is "absent", because `setAddRequest` serializes the
        // field only when it has content and a zero-length value is indistinguishable
        // from the omitted field on the wire.
        ...(raw.operateTransInfo !== null && raw.operateTransInfo.length > 0
          ? { operateTransInfo: raw.operateTransInfo }
          : {}),
      });
    }
    this.#ctx.identity.rememberGroupRequests(requests);
    return requests;
  }

  /**
   * Find the pending request a `group_invite` push refers to (:74694).
   *
   * ⚠️ `allSettled`, not `all`: the two inboxes are INDEPENDENT pages, and the
   * reference reads BOTH rejections before throwing either (`if (main…) throw` then
   * `if (filtered…) throw`). With `all`, whichever rejected first would win
   * non-deterministically; here the order is fixed, so two failures report `main`'s
   * reason.
   *
   * The two `subType` arms are different questions, not a fallback:
   *
   *   `add`    — an APPLICATION: the target IS the requester, and only `eventType` 1
   *              (a join request) counts.
   *   `invite` — an INVITATION: the bot was invited by `invitorUid` and the invitee is
   *              `invitedUid`. A self-invitation (`eventType` 2 or 10) is the bot
   *              being invited directly; `eventType` 22 is the "invite to group" notify
   *              type, which the mapping table sends to 22 unchanged and which QQ
   *              delivers without a preceding card.
   *
   * Returns `null` when neither page has it — "not in the inbox" is a fact here, not
   * an error, because the caller (`dispatchGroupInvite`) degrades by dropping the push.
   */
  async resolveGroupJoinRequest(
    groupId: number,
    uid: string,
    subType: string,
    invitedUid: string | undefined,
  ): Promise<GroupRequestInboxRow | null> {
    const [main, filtered] = await Promise.allSettled([
      this.fetchGroupRequestsByUid(false),
      this.fetchGroupRequestsByUid(true),
    ]);
    if (main.status === "rejected") throw main.reason;
    if (filtered.status === "rejected") throw filtered.reason;
    return (
      [...main.value, ...filtered.value].find((request) => {
        if (request.groupId !== groupId || request.state !== 1) return false;
        return subType === "add"
          ? request.eventType === 1 && request.targetUid === uid
          : (isSelfGroupInvitation(request) || request.eventType === 22) &&
              request.invitorUid === uid &&
              request.targetUid === invitedUid;
      }) ?? null
    );
  }

  /**
   * Whether this live card introduces a NEW approval sequence (:74705).
   *
   * `true` means "dispatch it yourself"; `false` means a notice already carried it —
   * see `GroupInviteTracker`'s header for why the return value is inverted.
   */
  rememberGroupInviteCardSequence(groupId: number, sequence: number): boolean {
    return this.groupInvites.receiveCard(groupId, sequence);
  }

  /** The newest card sequence for a group, or `undefined` if no card was seen (:74708). */
  getGroupInviteCardSequence(groupId: number): number | undefined {
    return this.groupInvites.getCardSequence(groupId);
  }

  /**
   * The group a bare-sequence flag belongs to (:74711).
   *
   * Throws when several groups match and no `groupId` was supplied — approving the
   * wrong group's invitation is not a recoverable guess.
   */
  findGroupInviteCardGroupBySequence(sequence: number, groupId?: number | undefined): number | undefined {
    return this.groupInvites.findCardGroup(sequence, groupId);
  }

  /** Drop both caches. Exposed for a session that must re-read the roster. */
  clearCaches(): void {
    this.#memberListCache.clear();
    this.#friendProfiles.clear();
  }

  /**
   * `send_tuwen_ark` — post a "graphic + text" card into a group or a private chat.
   *
   * `peerType` is the discriminator (1 = group, 0 = friend) and is NOT derivable from
   * `targetId`: a QQ number and a group number can collide numerically, so the caller must
   * say which one it means. The params object is forwarded whole — the spec's field mapping
   * is the only place that knows the wire shape.
   */
  sendTuwenArk(params: SendTuwenArkParams): Promise<void> {
    return sendTuwenArkCall.invoke(this.#ctx, params);
  }

}

/**
 * Narrow one `0xfd4_0` friend row onto the action-facing shape.
 *
 * `profile` stays a FRIEND-LEVEL field, unlike `ActionUserProfile.profile`, and is
 * absent (not `{}`) when the page carried no public-profile keys — because
 * `formatFriend` spreads `formatPublicProfile(friend.profile)` and an empty object
 * and an absent one produce identical output, while `{}` would make a caller's
 * `if (friend.profile)` test true for a friend with no profile.
 */
function toActionFriend(friend: FriendInfo & { profile?: unknown }): ActionFriendInfo {
  const profile = friend.profile as Record<string, unknown> | undefined;
  const out: ActionFriendInfo = {
    uin: friend.uin,
    uid: friend.uid,
    nickname: friend.nickname,
    remark: friend.remark,
  };
  if (profile !== undefined && Object.keys(profile).length > 0) out.profile = profile;
  return out;
}

/**
 * Narrow one `0xfe7_3` roster row. Level 0 / title "" are the wire defaults, kept.
 *
 * `isRobot` is OMITTED, not `undefined`: classification happens after the whole
 * page walk (the range fetch overlaps it), and `formatGroupMember` refuses to
 * print an unclassified member rather than defaulting it to "human".
 */
function toActionGroupMember(member: GroupMemberInfo): Omit<ActionGroupMemberInfo, "isRobot"> {
  return {
    uin: member.uin,
    uid: member.uid,
    nickname: member.nickname,
    card: member.card,
    role: member.role,
    level: 0,
    title: "",
    joinTime: member.joinTime,
    lastSentTime: member.lastSentTime,
    shutUpTime: member.shutUpTime,
  };
}

/**
 * Narrow the wide action profile onto the bridge's 13-field roster row.
 *
 * Spelled out field by field rather than spread: a spread would carry `status`,
 * `profile`, `vipFlag` and the other eleven fields INTO an object whose declared
 * type does not have them, and `exactOptionalPropertyTypes` rejects exactly that.
 * Listing the thirteen also documents the one thing worth knowing — the roster
 * drops the public-profile blob, the status word and every vip flag, so a caller
 * that wants them must call `fetchUserProfile` again (which the 300 s cache makes
 * cheap).
 */
function asBridgeProfile(profile: ActionUserProfile): UserProfile {
  return {
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
  };
}

