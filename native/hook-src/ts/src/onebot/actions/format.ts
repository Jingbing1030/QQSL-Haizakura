// The response formatters: roster rows and profiles → the OneBot shapes.
//
// Reference regions:
//   ../onebot/src/modules/contact-profile.ts  reference/index.mjs:11208-11250
//                                            (formatPrivilege, formatPublicProfile, formatFriend)
//   ../onebot/src/modules/contact-actions.ts  reference/index.mjs:39458-39760
//                                            (formatStrangerInfo, formatGroupMember, accountAge,
//                                             getCachedGroupMembers, cachedQidianProfile)
//
// ---------------------------------------------------------------------------
// Omission is a response field, not a detail
// ---------------------------------------------------------------------------
// Every `{ ...cond ? {k: v} : {} }` below is load-bearing. Three examples a caller
// can observe and a later "cleanup" would break:
//
//   * `formatGroupMember` adds `qq_level` and `qage` only when a profile was found.
//     A member row fetched from the roster has neither key; the same member fetched
//     via `get_group_member_info` (which does a profile lookup) has both. A test that
//     only checks "fields present" would pass either way, so the tests compare the
//     full key set.
//
//   * `formatPublicProfile` maps `sign`→`long_nick`, `vipFlag`→`is_qq_vip` and
//     `svipFlag`→`is_vip` — and a *zero-length* value is kept, not dropped. The
//     rule is `!== undefined`, never truthiness, which is why `vipFlag: false`
//     appears as `is_qq_vip: false` rather than vanishing.
//
//   * `formatFriend` omits `category_id` when it is undefined but keeps it when it
//     is 0.
//
// ---------------------------------------------------------------------------
// `role` is a STRING here
// ---------------------------------------------------------------------------
// `formatGroupMember` copies `member.role` straight through, and the roster decoder
// (`ts/src/oidb/services/0xfe7.ts`, `GroupMemberRole`) already produces
// `"owner" | "admin" | "member"`. The numeric 0/1/2 encoding exists only at the
// 0xfe7 wire boundary. A previous batch established this and it is re-asserted here
// because `get_group_member_info` is the action most likely to be "fixed" back to a
// number by someone reading the wire codec.

import type { ActionFriendInfo, ActionGroupMemberInfo, ActionUserProfile } from "./context.js";

/** One business-icon entry. reference:11208 `formatPrivilege`. */
export function formatPrivilege(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, source: string): void => {
    if (value[source] !== undefined) out[key] = value[source];
  };
  set("type", "type");
  set("level", "level");
  set("flag", "flag");
  set("is_big", "isBig");
  set("jump_url", "jumpUrl");
  set("icon_url", "iconUrl");
  set("deluxe_icon_url", "deluxeIconUrl");
  return out;
}

/** The 16 profile→OneBot renames, in the reference's order. reference:11216. */
const PUBLIC_PROFILE_FIELDS: readonly (readonly [string, string])[] = [
  ["sign", "long_nick"],
  ["sex", "sex"],
  ["age", "age"],
  ["level", "level"],
  ["birthdayYear", "birthday_year"],
  ["birthdayMonth", "birthday_month"],
  ["birthdayDay", "birthday_day"],
  ["phoneNum", "phone_num"],
  ["email", "email"],
  ["country", "country"],
  ["province", "province"],
  ["city", "city"],
  ["college", "college"],
  ["vipFlag", "is_qq_vip"],
  ["svipFlag", "is_vip"],
  ["yearVipFlag", "is_years_vip"],
  ["vipLevel", "vip_level"],
];

/**
 * `formatPublicProfile` (reference:11216).
 *
 * `privilege_icons` keeps `jump_url` out of the object entirely when undefined but
 * always emits `open`/`closed` as arrays — "no icons" is `[]`, not a missing key.
 */
export function formatPublicProfile(profile: Record<string, unknown> | undefined): Record<string, unknown> {
  const source = profile ?? {};
  const result: Record<string, unknown> = {};
  for (const [from, to] of PUBLIC_PROFILE_FIELDS) {
    if (source[from] !== undefined) result[to] = source[from];
  }
  const icons = source["privilegeIcons"];
  if (icons !== undefined) {
    const icon = icons as { jumpUrl?: unknown; open?: unknown[]; closed?: unknown[] };
    const shaped: Record<string, unknown> = {};
    if (icon.jumpUrl !== undefined) shaped["jump_url"] = icon.jumpUrl;
    shaped["open"] = (icon.open ?? []).map((entry) => formatPrivilege(entry as Record<string, unknown>));
    shaped["closed"] = (icon.closed ?? []).map((entry) => formatPrivilege(entry as Record<string, unknown>));
    result["privilege_icons"] = shaped;
  }
  return result;
}

/** `formatFriend` (reference:11235). */
export function formatFriend(friend: ActionFriendInfo, categoryId = friend.categoryId): Record<string, unknown> {
  const out: Record<string, unknown> = {
    user_id: friend.uin,
    nickname: friend.nickname,
    remark: friend.remark,
  };
  if (categoryId !== undefined) out["category_id"] = categoryId;
  return { ...out, ...formatPublicProfile(friend.profile) };
}

/**
 * `formatStrangerInfo` (reference:39458).
 *
 * Note the three deliberate differences from `formatGroupMember`:
 *   * the level is duplicated three ways (`qq_level`, `qqLevel`, `level`) for client
 *     compatibility, and `formatPublicProfile` can then overwrite `level` with the
 *     profile's own value — the reference spreads `formatPublicProfile(p.profile)`
 *     AFTER the three, so a profile carrying `level` wins.
 *   * `status`/`extStatus`/`batteryStatus` fall back to 0, while
 *     `customStatus` falls back to `null` (the only nullable field).
 *   * `qidian_enterprise_name` is always present, empty string when not a qidian
 *     account.
 */
export function formatStrangerInfo(p: ActionUserProfile, corp: { name: string } | null): Record<string, unknown> {
  const out: Record<string, unknown> = {
    user_id: p.uin,
    uid: p.uid,
    qid: p.qid,
    nickname: p.nickname,
    remark: p.remark,
    sex: p.sex,
    age: p.age,
    long_nick: p.sign,
    qq_level: p.level,
    qqLevel: p.level,
    level: p.level,
  };
  if (p.regTime !== undefined) out["reg_time"] = p.regTime;
  if (p.birthdayYear !== undefined) out["birthday_year"] = p.birthdayYear;
  if (p.birthdayMonth !== undefined) out["birthday_month"] = p.birthdayMonth;
  if (p.birthdayDay !== undefined) out["birthday_day"] = p.birthdayDay;
  if (p.svipFlag !== undefined) out["is_vip"] = p.svipFlag;
  if (p.yearVipFlag !== undefined) out["is_years_vip"] = p.yearVipFlag;
  if (p.vipLevel !== undefined) out["vip_level"] = p.vipLevel;
  if (p.vipFlag !== undefined) out["is_qq_vip"] = p.vipFlag;
  Object.assign(out, formatPublicProfile(p.profile));
  out["status"] = p.status ?? 0;
  out["extStatus"] = p.extStatus ?? 0;
  out["ext_status"] = p.extStatus ?? 0;
  out["batteryStatus"] = p.batteryStatus ?? 0;
  out["customStatus"] = p.customStatus ?? null;
  out["customStatusDescInfo"] = p.customStatusDesc ?? "";
  out["qidian_master_flag"] = p.qidianMasterFlag ?? 0;
  out["qidian_crew_flag"] = p.qidianCrewFlag ?? 0;
  out["qidian_crew_flag_2"] = p.qidianCrewFlag2 ?? 0;
  out["qidian_enterprise_name"] = corp?.name ?? "";
  return out;
}

/** `accountAge` (reference:39742). Absent (undefined) when the date is unusable. */
export function accountAge(regTime: number | undefined, now = new Date()): number | undefined {
  if (regTime === undefined || !Number.isSafeInteger(regTime) || regTime <= 0) return undefined;
  const registered = new Date(regTime * 1_000);
  if (!Number.isFinite(registered.getTime()) || registered > now) return undefined;
  const years = now.getUTCFullYear() - registered.getUTCFullYear();
  registered.setUTCFullYear(now.getUTCFullYear());
  return years - (registered > now ? 1 : 0);
}

/**
 * `formatGroupMember` (reference:39713).
 *
 * THROWS when `isRobot` is undefined. That is the reference's behaviour and it is
 * reachable: the roster decoder leaves `isRobot` undefined for a member it has not
 * classified, and the reference's own comment on the 0xfe7 decoder says the flag
 * comes from a different command. Returning `false` instead would quietly report
 * every unclassified member as "not a robot", so the throw is kept and the
 * fallbacks in `get_group_member_info` (which refetch to force classification)
 * exist precisely to avoid it.
 */
export function formatGroupMember(
  groupId: number,
  member: ActionGroupMemberInfo,
  profile?: ActionUserProfile | undefined,
  now?: Date,
): Record<string, unknown> {
  if (member.isRobot === undefined) {
    throw new Error(`group member robot classification unavailable: group=${groupId} member=${member.uin}`);
  }
  const qage = accountAge(profile?.regTime, now);
  const out: Record<string, unknown> = {
    group_id: groupId,
    user_id: member.uin,
    nickname: member.nickname,
    card: member.card,
    is_robot: member.isRobot,
    sex: "unknown",
    age: 0,
    join_time: member.joinTime,
    last_sent_time: member.lastSentTime,
    shut_up_timestamp: member.shutUpTime,
    level: String(member.level),
  };
  if (profile) out["qq_level"] = profile.level;
  if (qage !== undefined) out["qage"] = qage;
  out["role"] = member.role;
  out["title"] = member.title;
  out["area"] = "";
  out["unfriendly"] = false;
  out["title_expire_time"] = 0;
  out["card_changeable"] = true;
  out["qidian_master_flag"] = profile?.qidianMasterFlag ?? 0;
  out["qidian_crew_flag"] = profile?.qidianCrewFlag ?? 0;
  out["qidian_crew_flag_2"] = profile?.qidianCrewFlag2 ?? 0;
  return out;
}

/**
 * `cachedQidianProfile` (reference:39754).
 *
 * Best-effort and cache-only: it must not trigger a fetch, or every member row would
 * cost a profile query. A host whose identity has no `findUserProfile` answers
 * `undefined`, which is why the guard is `typeof`, not a try/catch alone.
 */
export function cachedQidianProfile(
  identity: { findUserProfile?(uin: number): ActionUserProfile | null },
  uin: number,
): ActionUserProfile | undefined {
  try {
    if (typeof identity.findUserProfile === "function") return identity.findUserProfile(uin) ?? undefined;
  } catch {
    // A throwing cache lookup is "no cached profile", matching the reference's bare catch.
  }
  return undefined;
}

/**
 * `formatGroupRequestFlag` (reference:11184).
 *
 * The canonical flag is a colon-joined tuple, and `set_group_add_request` parses it
 * back — so the field order (`slreq:1:sequence:groupId:eventType:filtered`) is a wire
 * contract between two actions, not a display string.
 */
export function formatGroupRequestFlag(handle: {
  sequence: number | bigint;
  groupId: number;
  eventType: number;
  filtered: boolean;
}): string {
  return ["slreq", "1", String(handle.sequence), String(handle.groupId), String(handle.eventType), handle.filtered ? "1" : "0"].join(":");
}