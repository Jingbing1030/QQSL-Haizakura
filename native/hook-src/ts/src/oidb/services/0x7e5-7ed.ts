// OidbSvcTrpcTcp.0x7e5_104 (`send_like`) and 0x7ed_12/_13 (`get_profile_like`).
//
// ---------------------------------------------------------------------------
// Two commands that look unrelated and share one subject: the "like" counter
// ---------------------------------------------------------------------------
//   0x7e5_104  send_like          -- "赞" someone; action `send_like`
//   0x7ed_12   get_profile_like  -- read someone ELSE's counters
//   0x7ed_13   get_profile_like  -- read YOUR OWN counters
//
// ---------------------------------------------------------------------------
// 0x7ed has NO sub-command 0 — the number in the task/action notes does not exist
// ---------------------------------------------------------------------------
// `_GetLike` never sets `subCommand`.  It sets `resolveSubCommand` instead
// (reference/index.mjs:328723):
//
//     const isSelfQuery = (ctx, p) => !p.userId || p.userId === Number(ctx.identity.uin);
//     _GetLike.resolveSubCommand = (p, ctx) => isSelfQuery(ctx, p) ? 13 : 12;
//
// So `0x7ed_0` is unroutable: the reference can only ever emit `_12` or `_13`,
// picked from whether the caller named someone else or left the target off (or
// named themselves).  `docs/oidb.md` §7.1 records the same class of mistake for
// `0x10c0` (documented as `_0`, actually `_1`/`_2`); this is a second instance,
// so it is called out here rather than silently "fixed" to sub-command 0.
//
// Two things follow from `isSelfQuery` that are easy to miss:
//   * `userId === 0` and `userId === undefined` BOTH mean "me" (falsy).
//   * A caller who passes their OWN uin gets `_13`, not `_12` — the comparison
//     is against `ctx.identity.uin`, so "read my likes" and "read my likes by
//     explicitly naming myself" are the same request.
//
// ---------------------------------------------------------------------------
// Field numbers
// ---------------------------------------------------------------------------
//   OidbLike (0x7e5_104 request)     reference/index.mjs:290993 .. 291041
//     11 targetUid  string   <-- 11, not 1; fields 1..10 are unused here
//     12 sourceId   uint32   hard-coded 71
//     13 count      uint32   how many likes to send
//
//   Oidb0x7edReq                     reference/index.mjs:327375 .. 327522
//     1   targetUids   repeated string   <-- repeated, and singular in practice
//     2   basic        uint32  hard-coded 1
//     3   vote         uint32  hard-coded 1
//     4   favorite     uint32  hard-coded 0 (so never written)
//     101 userProfile  uint32  hard-coded 1  <-- the 100-jump, all four below
//     102 start        uint32
//     103 limit        uint32
//
//   Oidb0x7edResp                    reference/index.mjs:327762 .. 327800
//     1   userLikeInfos  repeated Oidb0x7edUserLikeInfo
//     2   friendMaxVotes uint32
//     101 start          int32   <-- int32, not uint32
//
//   Oidb0x7edUserLikeInfo            reference/index.mjs:327890 .. 327948
//     1 uid           string
//     2 time          uint32
//     3 favoriteInfo  Oidb0x7edFavoriteInfo
//     4 voteInfo      Oidb0x7edVoteInfo
//
//   Oidb0x7edFavoriteInfo            reference/index.mjs:328041 .. 328095
//     1 totalCount uint32 / 2 lastTime uint32 / 3 todayCount uint32
//     4 userInfos  repeated Oidb0x7edUserInfo
//
//   Oidb0x7edVoteInfo                reference/index.mjs:328558 .. 328630
//     1 totalCount uint32 / 2 newCount uint32 / 3 newNearbyCount uint32
//     4 lastVisitTime uint32 / 5 userInfos repeated Oidb0x7edUserInfo
//
//   Oidb0x7edUserInfo                reference/index.mjs:328199 .. 328455
//     1  uid              string
//     2  src              uint32
//     3  latestTime       uint32
//     4  count            uint32
//     5  giftCount        uint32
//     6  customId         uint32
//     8  lastCharged      uint32   <-- 7 is skipped
//     21 availableCount   uint32   <-- 8 -> 21
//     22 todayVotedCount  uint32
//     101 nick            string   <-- second 100-jump
//     102 gender          uint32
//     103 age             uint32
//     104 isFriend        uint32   (a 0/1 number, NOT a bool field)
//     105 isVip           uint32
//     106 isSvip          uint32
//
// The 101..106 block is the interesting one: these are the *profile* fields
// bolted onto the counter message.  Note 104/105/106 are uint32 on the wire but
// the reference projects them to booleans (`isFriend: data.isFriend ?? false`),
// which is why the result type below has booleans where the wire type has
// numbers.
//
// ---------------------------------------------------------------------------
// uid resolution is the caller's job, not the codec's
// ---------------------------------------------------------------------------
// Both specs send a **uid**, not a uin: 0x7e5_104 puts one in field 11 and 0x7ed
// puts one in its `targetUids` list.  The reference resolves it inside
// `serialize` via `ctx.resolveUserUid`, and for the self case via
// `resolveSelfUid` (reference/index.mjs:19116, ../protocol/src/self-uid.ts).  The
// `OidbSpec` in this repo is deliberately ctx-free, so this file takes the
// already-resolved uid as a parameter and offers `sendLikeParams` /
// `getLikeParams` adapters for callers that do have a resolver.  Passing an
// empty uid is rejected by the reference in both specs; that check is kept.

import { ProtoReader, ProtoWriter, UnknownFieldCollector, tagOf, WireType } from "../wire.js";
import { type OidbSpec } from "../spec.js";
// The empty-body decoder is shared with the 0x89a family (same `OidbEmpty`).
import { type OidbEmpty, decodeOidbEmpty } from "./0x89a-0.js";

// ---------------------------------------------------------------------------
// 0x7e5_104 — send_like
// ---------------------------------------------------------------------------

/** 2021 = 0x7e5. */
export const SEND_LIKE_COMMAND = 0x7e5;

/** The only sub-command `send_like` uses. */
export const SEND_LIKE_SUB_COMMAND = 104;

/** `sourceId` the client sends (reference/index.mjs:291052). */
export const SEND_LIKE_SOURCE_ID = 71;

export const OidbLikeField = { targetUid: 11, sourceId: 12, count: 13 } as const;

export interface OidbLike {
  targetUid: string;
  sourceId: number;
  count: number;
}

export function encodeOidbLike(body: OidbLike): Uint8Array {
  return new ProtoWriter()
    .string(OidbLikeField.targetUid, body.targetUid)
    .uint32(OidbLikeField.sourceId, body.sourceId)
    .uint32(OidbLikeField.count, body.count)
    .finish();
}

export interface SendLikeParams {
  /** The target's uid — already resolved; see the header note. */
  targetUid: string;
  /** How many likes to send.  The OneBot `times` parameter, default 1. */
  count: number;
}

/**
 * `send_like`.
 *
 * The response body is `OidbEmpty` and `deserialize` returns nothing, so a
 * non-zero count cannot be verified from the reply — the server answers with an
 * envelope code only.  That is why the result type is `void`.
 */
export const SendLike: OidbSpec<SendLikeParams, OidbLike, OidbEmpty, void> = {
  command: SEND_LIKE_COMMAND,
  subCommand: SEND_LIKE_SUB_COMMAND,
  serialize: (params) => {
    // reference/index.mjs:291047 — an unresolved uid is a hard error, not an
    // empty-string request the server would reject obscurely.
    if (!params.targetUid) throw new Error(`failed to resolve uid for ${params.targetUid || "target"}`);
    return { targetUid: params.targetUid, sourceId: SEND_LIKE_SOURCE_ID, count: params.count };
  },
  encodeBody: encodeOidbLike,
  decodeBody: decodeOidbEmpty,
  deserialize: () => undefined,
};

// ---------------------------------------------------------------------------
// 0x7ed — get_profile_like
// ---------------------------------------------------------------------------

/** 2029 = 0x7ed. */
export const GET_LIKE_COMMAND = 0x7ed;

/** 12 = someone else's likes, 13 = my own.  There is no 0; see the header. */
export const GET_LIKE_SUB_COMMAND = { other: 12, self: 13 } as const;

/** The `limit` fallback (reference/index.mjs:328745). */
export const GET_LIKE_DEFAULT_LIMIT = 10;

export const Oidb0x7edReqField = {
  targetUids: 1,
  basic: 2,
  vote: 3,
  favorite: 4,
  userProfile: 101,
  start: 102,
  limit: 103,
} as const;

export const Oidb0x7edRespField = { userLikeInfos: 1, friendMaxVotes: 2, start: 101 } as const;

export const Oidb0x7edUserLikeInfoField = { uid: 1, time: 2, favoriteInfo: 3, voteInfo: 4 } as const;

export const Oidb0x7edFavoriteInfoField = {
  totalCount: 1,
  lastTime: 2,
  todayCount: 3,
  userInfos: 4,
} as const;

export const Oidb0x7edVoteInfoField = {
  totalCount: 1,
  newCount: 2,
  newNearbyCount: 3,
  lastVisitTime: 4,
  userInfos: 5,
} as const;

export const Oidb0x7edUserInfoField = {
  uid: 1,
  src: 2,
  latestTime: 3,
  count: 4,
  giftCount: 5,
  customId: 6,
  lastCharged: 8,
  availableCount: 21,
  todayVotedCount: 22,
  nick: 101,
  gender: 102,
  age: 103,
  isFriend: 104,
  isVip: 105,
  isSvip: 106,
} as const;

export interface Oidb0x7edReq {
  targetUids: string[];
  basic: number;
  vote: number;
  favorite: number;
  userProfile: number;
  start: number;
  limit: number;
}

export function encodeOidb0x7edReq(body: Oidb0x7edReq): Uint8Array {
  return new ProtoWriter()
    .repeatedString(Oidb0x7edReqField.targetUids, body.targetUids)
    .uint32(Oidb0x7edReqField.basic, body.basic)
    .uint32(Oidb0x7edReqField.vote, body.vote)
    .uint32(Oidb0x7edReqField.favorite, body.favorite)
    .uint32(Oidb0x7edReqField.userProfile, body.userProfile)
    .uint32(Oidb0x7edReqField.start, body.start)
    .uint32(Oidb0x7edReqField.limit, body.limit)
    .finish();
}

export interface Oidb0x7edUserInfo {
  uid: string;
  src: number;
  latestTime: number;
  count: number;
  giftCount: number;
  customId: number;
  lastCharged: number;
  availableCount: number;
  todayVotedCount: number;
  nick: string;
  gender: number;
  age: number;
  isFriend: number;
  isVip: number;
  isSvip: number;
}

export interface Oidb0x7edFavoriteInfo {
  totalCount: number;
  lastTime: number;
  todayCount: number;
  userInfos: Oidb0x7edUserInfo[];
}

export interface Oidb0x7edVoteInfo {
  totalCount: number;
  newCount: number;
  newNearbyCount: number;
  lastVisitTime: number;
  userInfos: Oidb0x7edUserInfo[];
}

export interface Oidb0x7edUserLikeInfo {
  uid: string;
  time: number;
  favoriteInfo: Oidb0x7edFavoriteInfo | null;
  voteInfo: Oidb0x7edVoteInfo | null;
}

export interface Oidb0x7edResp {
  userLikeInfos: Oidb0x7edUserLikeInfo[];
  friendMaxVotes: number;
  /** int32 on the wire. */
  start: number;
}

export function decodeOidb0x7edUserInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): Oidb0x7edUserInfo {
  const reader = new ProtoReader(data, offset, end);
  const user: Oidb0x7edUserInfo = {
    uid: "",
    src: 0,
    latestTime: 0,
    count: 0,
    giftCount: 0,
    customId: 0,
    lastCharged: 0,
    availableCount: 0,
    todayVotedCount: 0,
    nick: "",
    gender: 0,
    age: 0,
    isFriend: 0,
    isVip: 0,
    isSvip: 0,
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Oidb0x7edUserInfoField.uid, WireType.lengthDelimited):
        user.uid = reader.string();
        break;
      case tagOf(Oidb0x7edUserInfoField.src, WireType.varint):
        user.src = reader.uint32();
        break;
      case tagOf(Oidb0x7edUserInfoField.latestTime, WireType.varint):
        user.latestTime = reader.uint32();
        break;
      case tagOf(Oidb0x7edUserInfoField.count, WireType.varint):
        user.count = reader.uint32();
        break;
      case tagOf(Oidb0x7edUserInfoField.giftCount, WireType.varint):
        user.giftCount = reader.uint32();
        break;
      case tagOf(Oidb0x7edUserInfoField.customId, WireType.varint):
        user.customId = reader.uint32();
        break;
      case tagOf(Oidb0x7edUserInfoField.lastCharged, WireType.varint):
        user.lastCharged = reader.uint32();
        break;
      case tagOf(Oidb0x7edUserInfoField.availableCount, WireType.varint):
        user.availableCount = reader.uint32();
        break;
      case tagOf(Oidb0x7edUserInfoField.todayVotedCount, WireType.varint):
        user.todayVotedCount = reader.uint32();
        break;
      case tagOf(Oidb0x7edUserInfoField.nick, WireType.lengthDelimited):
        user.nick = reader.string();
        break;
      case tagOf(Oidb0x7edUserInfoField.gender, WireType.varint):
        user.gender = reader.uint32();
        break;
      case tagOf(Oidb0x7edUserInfoField.age, WireType.varint):
        user.age = reader.uint32();
        break;
      case tagOf(Oidb0x7edUserInfoField.isFriend, WireType.varint):
        user.isFriend = reader.uint32();
        break;
      case tagOf(Oidb0x7edUserInfoField.isVip, WireType.varint):
        user.isVip = reader.uint32();
        break;
      case tagOf(Oidb0x7edUserInfoField.isSvip, WireType.varint):
        user.isSvip = reader.uint32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return user;
}

export function decodeOidb0x7edFavoriteInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): Oidb0x7edFavoriteInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: Oidb0x7edFavoriteInfo = { totalCount: 0, lastTime: 0, todayCount: 0, userInfos: [] };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Oidb0x7edFavoriteInfoField.totalCount, WireType.varint):
        info.totalCount = reader.uint32();
        break;
      case tagOf(Oidb0x7edFavoriteInfoField.lastTime, WireType.varint):
        info.lastTime = reader.uint32();
        break;
      case tagOf(Oidb0x7edFavoriteInfoField.todayCount, WireType.varint):
        info.todayCount = reader.uint32();
        break;
      case tagOf(Oidb0x7edFavoriteInfoField.userInfos, WireType.lengthDelimited):
        info.userInfos.push(reader.message(decodeOidb0x7edUserInfo));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return info;
}

export function decodeOidb0x7edVoteInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): Oidb0x7edVoteInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: Oidb0x7edVoteInfo = {
    totalCount: 0,
    newCount: 0,
    newNearbyCount: 0,
    lastVisitTime: 0,
    userInfos: [],
  };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Oidb0x7edVoteInfoField.totalCount, WireType.varint):
        info.totalCount = reader.uint32();
        break;
      case tagOf(Oidb0x7edVoteInfoField.newCount, WireType.varint):
        info.newCount = reader.uint32();
        break;
      case tagOf(Oidb0x7edVoteInfoField.newNearbyCount, WireType.varint):
        info.newNearbyCount = reader.uint32();
        break;
      case tagOf(Oidb0x7edVoteInfoField.lastVisitTime, WireType.varint):
        info.lastVisitTime = reader.uint32();
        break;
      case tagOf(Oidb0x7edVoteInfoField.userInfos, WireType.lengthDelimited):
        info.userInfos.push(reader.message(decodeOidb0x7edUserInfo));
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return info;
}

export function decodeOidb0x7edUserLikeInfo(
  data: Uint8Array,
  offset = 0,
  end = data.length,
): Oidb0x7edUserLikeInfo {
  const reader = new ProtoReader(data, offset, end);
  const info: Oidb0x7edUserLikeInfo = { uid: "", time: 0, favoriteInfo: null, voteInfo: null };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Oidb0x7edUserLikeInfoField.uid, WireType.lengthDelimited):
        info.uid = reader.string();
        break;
      case tagOf(Oidb0x7edUserLikeInfoField.time, WireType.varint):
        info.time = reader.uint32();
        break;
      case tagOf(Oidb0x7edUserLikeInfoField.favoriteInfo, WireType.lengthDelimited):
        info.favoriteInfo = reader.message(decodeOidb0x7edFavoriteInfo);
        break;
      case tagOf(Oidb0x7edUserLikeInfoField.voteInfo, WireType.lengthDelimited):
        info.voteInfo = reader.message(decodeOidb0x7edVoteInfo);
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return info;
}

export function decodeOidb0x7edResp(data: Uint8Array, offset = 0, end = data.length): Oidb0x7edResp {
  const reader = new ProtoReader(data, offset, end);
  const resp: Oidb0x7edResp = { userLikeInfos: [], friendMaxVotes: 0, start: 0 };
  const unknown = new UnknownFieldCollector();
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Oidb0x7edRespField.userLikeInfos, WireType.lengthDelimited):
        resp.userLikeInfos.push(reader.message(decodeOidb0x7edUserLikeInfo));
        break;
      case tagOf(Oidb0x7edRespField.friendMaxVotes, WireType.varint):
        resp.friendMaxVotes = reader.uint32();
        break;
      case tagOf(Oidb0x7edRespField.start, WireType.varint):
        resp.start = reader.int32();
        break;
      default:
        reader.skip(unknown);
        break;
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// The business projection
// ---------------------------------------------------------------------------

/** One liker, as the action layer sees it. */
export interface ProfileLikeUser {
  uid: string;
  uin: number;
  src: number;
  latestTime: number;
  count: number;
  giftCount: number;
  customId: number;
  lastCharged: number;
  bAvailableCnt: number;
  bTodayVotedCnt: number;
  nick: string;
  gender: number;
  age: number;
  isFriend: boolean;
  /** The reference's field name keeps an inconsistent case: `isvip`, not `isVip`. */
  isvip: boolean;
  isSvip: boolean;
}

export interface ProfileLikeBucket<TUser = ProfileLikeUser> {
  total_count: number;
  userInfos: TUser[];
}

export interface ProfileLikeFavorite extends ProfileLikeBucket {
  last_time: number;
  today_count: number;
}

export interface ProfileLikeVote extends ProfileLikeBucket {
  new_count: number;
  new_nearby_count: number;
  last_visit_time: number;
}

export interface ProfileLikeInfo {
  uid: string;
  time: number;
  favoriteInfo: ProfileLikeFavorite;
  voteInfo: ProfileLikeVote;
}

/**
 * Project one wire user onto the action shape.
 *
 * `uin` is resolved by the caller (the reference fills it from
 * `ctx.identity.findUinByUid`, then repairs the misses with a batched
 * `resolveUin` pass — reference/index.mjs:328763 `fillUnresolvedLikeUins`).  A
 * uid with no known uin stays 0, which is what the reference's first pass does;
 * the batched repair is the caller's, because it needs the identity service.
 *
 * A missing uid throws: reference/index.mjs:328697 does the same.
 */
export function deserializeUserInfo(data: Oidb0x7edUserInfo, uinOf?: (uid: string) => number): ProfileLikeUser {
  const uid = data.uid;
  if (!uid) throw new Error("get profile like user uid missing");
  return {
    uid,
    uin: uinOf ? uinOf(uid) : 0,
    src: data.src ?? 0,
    latestTime: data.latestTime ?? 0,
    count: data.count ?? 0,
    giftCount: data.giftCount ?? 0,
    customId: data.customId ?? 0,
    lastCharged: data.lastCharged ?? 0,
    bAvailableCnt: data.availableCount ?? 0,
    bTodayVotedCnt: data.todayVotedCount ?? 0,
    nick: data.nick ?? "",
    gender: data.gender ?? 0,
    age: data.age ?? 0,
    // The wire fields are uint32 0/1; the reference projects them straight into
    // booleans (`?? false`), so a 0 arrives as `false` via the `??` default only
    // when the field was absent.  `!== 0` keeps a decoded 0 equal to `false`.
    isFriend: (data.isFriend ?? 0) !== 0,
    isvip: (data.isVip ?? 0) !== 0,
    isSvip: (data.isSvip ?? 0) !== 0,
  };
}

export interface GetLikeParams {
  /** `undefined`/`0` means "my own profile" — see `getLikeSubCommand`. */
  targetUid: string;
  /** The caller's own uin, for the self/other decision. */
  selfUin: number;
  /** The uin the caller passed, if any. */
  userId?: number | undefined;
  start?: number | undefined;
  limit?: number | undefined;
}

/**
 * Pick `_12` or `_13`.
 *
 * Reimplements `isSelfQuery` (reference/index.mjs:328721) exactly:
 * `!p.userId || p.userId === Number(ctx.identity.uin)`.
 */
/**
 * Adapt an action-shaped call (uin + resolver) onto the ctx-free `SendLike`.
 *
 * This is the seam the reference's `serialize(ctx, p)` hides: it calls
 * `ctx.resolveUserUid(p.userId)` inline.  Keeping the resolution here means the
 * spec stays a pure codec and the async identity lookup stays with the caller
 * that owns the identity service.
 */
export async function sendLikeParams(
  params: { userId: number | bigint; count?: number | undefined },
  resolveUid: (userId: number | bigint) => Promise<string> | string,
): Promise<SendLikeParams> {
  const targetUid = await resolveUid(params.userId);
  if (!targetUid) throw new Error(`failed to resolve uid for ${params.userId}`);
  // The reference's own parameter is `count`; there is no default in
  // `serialize` (reference/index.mjs:291047 passes `p.count` straight through),
  // so a missing value encodes as field 13 absent — NOT as 1.  Only the OneBot
  // action layer defaults `times` to 1, and that default belongs there.
  return { targetUid, count: params.count ?? 0 };
}

/**
 * Adapt an action-shaped call onto the ctx-free `GetLike`.
 *
 * Mirrors the reference exactly: the self/other decision is made FIRST (from the
 * uin alone), and only then is a uid resolved from whichever source that
 * decision implies — `resolveSelfUid` for self, `resolveUserUid` for other.
 */
export async function getLikeParams(
  params: { userId?: number | undefined; start?: number | undefined; limit?: number | undefined },
  ctx: {
    selfUin: number;
    resolveSelfUid: () => Promise<string> | string;
    resolveUserUid: (userId: number) => Promise<string> | string;
  },
): Promise<GetLikeParams> {
  const sub = getLikeSubCommand(ctx.selfUin, params.userId);
  const targetUid =
    sub === GET_LIKE_SUB_COMMAND.self
      ? await ctx.resolveSelfUid()
      : await ctx.resolveUserUid(params.userId as number);
  if (!targetUid) throw new Error("target uid not found");
  return {
    targetUid,
    selfUin: ctx.selfUin,
    userId: params.userId,
    start: params.start,
    limit: params.limit,
  };
}

export function getLikeSubCommand(selfUin: number, userId?: number | undefined): number {
  const isSelf = !userId || userId === Number(selfUin);
  return isSelf ? GET_LIKE_SUB_COMMAND.self : GET_LIKE_SUB_COMMAND.other;
}

/**
 * `get_profile_like`.
 *
 * The reference's `deserialize` reads only `userLikeInfos[0]` and throws when it
 * is absent, so a reply describing several uids silently reports the first.  The
 * request only ever asks for one uid (`targetUids` is a repeated field with one
 * element), so this is not a practical loss — but it is why the result type is a
 * single `ProfileLikeInfo` rather than a list.
 */
export const GetLike: OidbSpec<GetLikeParams, Oidb0x7edReq, Oidb0x7edResp, ProfileLikeInfo> = {
  command: GET_LIKE_COMMAND,
  resolveSubCommand: (params) => getLikeSubCommand(params.selfUin, params.userId),
  serialize: (params) => {
    if (!params.targetUid) throw new Error("target uid not found");
    return {
      targetUids: [params.targetUid],
      basic: 1,
      vote: 1,
      favorite: 0,
      userProfile: 1,
      start: params.start ?? 0,
      limit: params.limit ?? GET_LIKE_DEFAULT_LIMIT,
    };
  },
  encodeBody: encodeOidb0x7edReq,
  decodeBody: decodeOidb0x7edResp,
  deserialize: (body) => {
    const data = body.userLikeInfos?.[0];
    if (!data) throw new Error("get profile like info empty");
    return {
      uid: data.uid ?? "",
      time: Number(data.time ?? 0),
      favoriteInfo: {
        total_count: data.favoriteInfo?.totalCount ?? 0,
        last_time: data.favoriteInfo?.lastTime ?? 0,
        today_count: data.favoriteInfo?.todayCount ?? 0,
        userInfos: (data.favoriteInfo?.userInfos ?? []).map((user) => deserializeUserInfo(user)),
      },
      voteInfo: {
        total_count: data.voteInfo?.totalCount ?? 0,
        new_count: data.voteInfo?.newCount ?? 0,
        new_nearby_count: data.voteInfo?.newNearbyCount ?? 0,
        last_visit_time: data.voteInfo?.lastVisitTime ?? 0,
        userInfos: (data.voteInfo?.userInfos ?? []).map((user) => deserializeUserInfo(user)),
      },
    };
  },
};
