// Group sign-in (群打卡) list over `qun.qq.com/v2/signin/trpc`.
//
// Reference region: ../protocol/src/web/group-signin.ts
// (reference/index.mjs:338647, 57 lines). `apis/web.ts`' `getSignedList` is this.
//
// ---------------------------------------------------------------------------
// The rank de-skew
// ---------------------------------------------------------------------------
// The server returns `signInRank` on a doubled-and-offset scale (1, 3, 5, …) so
// that ties can be interleaved. NapCat — and therefore this port — recovers the
// human 1-based rank with `(rank - 1) / 2 + 1`. Reading the raw value looks right
// on the first row and is off by a factor of two from the second onward, which is
// why it is worth a comment rather than a silent expression.
//
// ---------------------------------------------------------------------------
// Why errors PROPAGATE instead of mapping to `[]`
// ---------------------------------------------------------------------------
// A missing `response.page` is what this endpoint returns when the cookie is
// expired or the request was risk-controlled. Mapping that to "no one signed in"
// would make an auth failure indistinguishable from a genuinely empty group, and
// the OneBot action turns a throw into a failed response — which is the honest
// answer. A genuinely empty group still returns `page[0].infos` (empty), and that
// maps to `[]` without throwing.

import { RequestUtil, cookieToString, getBknFromCookie } from "./request-util.js";
import { createLogger } from "../../onebot/log.js";

const log = createLogger("Bridge.Web");

/** One sign-in row, in OneBot's naming. */
export interface SignedMember {
  user_id: number;
  nick: string;
  time: number;
  rank: number;
}

interface SignedInfo {
  uid?: string;
  uidGroupNick?: string;
  signedTimeStamp?: number | string;
  signInRank?: number | string;
}

interface SignedResponse {
  response?: {
    page?: Array<{ infos?: SignedInfo[] }>;
  };
}

/**
 * Pure transform from the endpoint's response into the OneBot list.
 *
 * Kept separate and exported so the de-skew is testable without a network, and so
 * a caller can reuse it on a cached payload.
 */
export function mapDaySignedList(data: SignedResponse): SignedMember[] {
  const infos = data.response?.page?.[0]?.infos;
  if (!infos) return [];
  return infos.map((info) => ({
    user_id: Number(info.uid),
    nick: info.uidGroupNick ?? "",
    time: Number(info.signedTimeStamp),
    rank: (Number(info.signInRank) - 1) / 2 + 1,
  }));
}

/** `YYYYMMDD` for the given Date (defaults to today) — the form the endpoint wants. */
export function yyyymmdd(d: Date = new Date()): string {
  return `${String(d.getFullYear())}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Today's sign-in list for one group.
 *
 * `day` exists because the reference carries it; the OneBot action never passes
 * one, so "today" is the only path exercised in practice.
 */
export async function getDaySignedListWebAPI(
  cookieObject: Record<string, string>,
  groupCode: string,
  selfUin: string,
  day?: Date,
): Promise<SignedMember[]> {
  const url = `https://qun.qq.com/v2/signin/trpc/GetDaySignedList?g_tk=${getBknFromCookie(cookieObject)}`;
  const body = {
    dayYmd: yyyymmdd(day),
    offset: 0,
    limit: 100,
    uid: selfUin,
    groupId: groupCode,
  };
  const data = (await RequestUtil.HttpGetJson(
    url,
    "POST",
    body,
    { Cookie: cookieToString(cookieObject), "Content-Type": "application/json" },
    true,
    true,
  )) as SignedResponse;
  if (!data.response?.page) {
    log.warn("getDaySignedList: no page in response (group=%s) — likely auth/cookie failure", groupCode);
    throw new Error("无法获取该群组打卡列表");
  }
  return mapDaySignedList(data);
}