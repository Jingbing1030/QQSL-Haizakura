// Group honour lists (群荣誉: 龙王 / 群聊之火 / 群聊炽焰 …) over `qun.qq.com`.
//
// Reference region: ../protocol/src/web/group-honor.ts
// (reference/index.mjs:8877, 41 lines). Small, but load-bearing: `apis/web.ts`'
// `getHonorInfo` fans out to four types of it and its shape is the OneBot
// `get_group_honor_info` payload.
//
// ---------------------------------------------------------------------------
// Why this reads HTML instead of JSON
// ---------------------------------------------------------------------------
// `qun.qq.com/interactive/honorlist` is a server-rendered page; the payload is
// embedded as `window.__INITIAL_STATE__={...};`. There is no JSON endpoint. The
// regex is non-greedy up to `;(` because the state object itself contains no
// `;(` sequence but is followed by an IIFE.
//
// ---------------------------------------------------------------------------
// Two different error policies in one module, both deliberate
// ---------------------------------------------------------------------------
//   * `fetchHonorData` PROPAGATES — it is the raw fetch, and the reference wraps
//     any failure in a Chinese-language message naming the group and type.
//   * `getHonorListWebAPI` SWALLOWS to `[]` — because `getHonorInfo` asks for up
//     to five lists at once and one unavailable type must not blank the other
//     four. This is the opposite of `getDaySignedListWebAPI`, where swallowing
//     would make an expired cookie look like "nobody signed in".
//
// Type ids: 1 = talkative (龙王), 2 = performer (群聊之火), 3 = legend (群聊炽焰),
// 6 = emotion (快乐源泉). There is no 4 or 5 in the OneBot surface.

import { RequestUtil, cookieToString } from "./request-util.js";
import { createLogger } from "../../onebot/log.js";

const log = createLogger("Bridge.Web");

/** The honour categories `apis/web.ts` exposes. Values are the wire ids as strings. */
export const WebHonorType = {
  TALKATIVE: "talkative",
  PERFORMER: "performer",
  LEGEND: "legend",
  EMOTION: "emotion",
  ALL: "all",
} as const;

export type WebHonorTypeValue = (typeof WebHonorType)[keyof typeof WebHonorType];

/** One honour-list row, in OneBot's naming. */
export interface HonorMember {
  user_id: number | null;
  nickname: string;
  avatar: string;
  description: string;
}

/** Raw honour payload; `talkativeList` for type 1, `actorList` otherwise. */
interface HonorState {
  talkativeList?: HonorActor[];
  actorList?: HonorActor[];
}

interface HonorActor {
  uin?: number;
  name?: string;
  avatar?: string;
  desc?: string;
}

/**
 * The raw fetch. Throws on transport failure or unparseable state — the caller
 * decides whether that is fatal.
 */
export async function fetchHonorData(
  cookieObject: Record<string, string>,
  groupCode: string,
  type: number,
): Promise<HonorActor[] | undefined> {
  let resJson: HonorState | undefined;
  try {
    const res = await RequestUtil.HttpGetText(
      `https://qun.qq.com/interactive/honorlist?${new URLSearchParams({
        gc: groupCode,
        type: type.toString(),
      }).toString()}`,
      "GET",
      "",
      { Cookie: cookieToString(cookieObject) },
    );
    const match = /window\.__INITIAL_STATE__=(.*?);/.exec(res);
    if (match?.[1]) resJson = JSON.parse(match[1].trim()) as HonorState;
    return type === 1 ? resJson?.talkativeList : resJson?.actorList;
  } catch (e) {
    throw new Error(`获取群 ${groupCode} 类型 ${type} 的荣誉信息失败: ${String(e)}`);
  }
}

/**
 * One honour list, normalised. Never throws: an unavailable type is an empty
 * list, so the other four types in one `getHonorInfo` call still answer.
 */
export async function getHonorListWebAPI(
  cookieObject: Record<string, string>,
  groupCode: string,
  type: number,
): Promise<HonorMember[]> {
  try {
    const data = await fetchHonorData(cookieObject, groupCode, type);
    if (!data) return [];
    return data.map((item) => ({
      user_id: item?.uin ?? null,
      nickname: item?.name ?? "",
      avatar: item?.avatar ?? "",
      description: item?.desc ?? "",
    }));
  } catch (e) {
    log.warn(
      "getHonorListWebAPI failed (group=%s type=%d): %s",
      groupCode,
      type,
      e instanceof Error
        ? (e.stack ?? e.message)
        : String(e),
    );
    return [];
  }
}