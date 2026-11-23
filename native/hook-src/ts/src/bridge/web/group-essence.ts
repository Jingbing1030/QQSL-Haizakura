// Group essence messages (群精华) over `qun.qq.com/cgi-bin/group_digest`.
//
// Reference region: ../protocol/src/web/group-essence.ts
// (reference/index.mjs:338591, 56 lines). Needed by `apis/web.ts`' `getEssence`
// and `getEssenceAll`.
//
// ---------------------------------------------------------------------------
// Why there is an explicit "normalise an empty page" branch
// ---------------------------------------------------------------------------
// When a group has no essence messages, the endpoint answers
// `{retcode: 0, data: {is_end: true}}` with `msg_list` ABSENT rather than `[]`.
// The strict validity check right after it would reject that as malformed, so the
// empty branch runs first and manufactures the missing `[]`. A caller iterating
// `getEssenceAll` then terminates on `is_end` instead of throwing on a group that
// simply has no essence — which is the common case, not the edge case.
//
// ---------------------------------------------------------------------------
// The 20-page cap is not the server's
// ---------------------------------------------------------------------------
// `MAX_ESSENCE_PAGES = 20` with `page_limit = 50` bounds one `get_essence_all` at
// 1000 messages. Above that the walk THROWS rather than truncating, so a caller
// never mistakes a truncated list for the complete one.

import { RequestUtil, cookieToString, getBknFromCookie } from "./request-util.js";
import { createLogger } from "../../onebot/log.js";

const log = createLogger("Bridge.Web");

/** Page cap for the "walk every page" helper. */
export const MAX_ESSENCE_PAGES = 20;

/** One page of essence messages, as the endpoint returns it. */
export interface EssencePage {
  retcode: number;
  retmsg?: string;
  data: {
    is_end: boolean;
    msg_list: unknown[];
    [field: string]: unknown;
  };
  [field: string]: unknown;
}

/**
 * Fetch one page of group essence messages.
 *
 * `pageStart` is 0-indexed and `pageLimit` is server-capped at 50; passing a
 * larger limit is not an error, the server just returns 50.
 */
export async function getGroupEssenceMsg(
  cookieObject: Record<string, string>,
  groupCode: string,
  pageStart = 0,
  pageLimit = 50,
): Promise<EssencePage> {
  const bkn = getBknFromCookie(cookieObject);
  const url = `https://qun.qq.com/cgi-bin/group_digest/digest_list?${new URLSearchParams({
    bkn,
    page_start: pageStart.toString(),
    page_limit: pageLimit.toString(),
    group_code: groupCode,
  }).toString()}`;
  try {
    const ret = (await RequestUtil.HttpGetJson(url, "GET", "", {
      Cookie: cookieToString(cookieObject),
    })) as EssencePage;
    if (ret.retcode !== 0) {
      throw new Error(
        `group essence request failed with retcode ${String(ret.retcode)}: ${ret.retmsg ?? "unknown error"}`,
      );
    }
    if (ret.data?.is_end === true && ret.data.msg_list == null) {
      log.debug(
        "normalized empty group essence response (group=%s page=%d/%d)",
        groupCode,
        pageStart,
        pageLimit,
      );
      return { ...ret, data: { ...ret.data, is_end: true, msg_list: [] } };
    }
    if (!ret.data || typeof ret.data.is_end !== "boolean" || !Array.isArray(ret.data.msg_list)) {
      throw new Error("invalid group essence response: data.is_end or data.msg_list is missing");
    }
    return { ...ret, data: { ...ret.data, is_end: ret.data.is_end, msg_list: ret.data.msg_list } };
  } catch (e) {
    log.warn(
      "getGroupEssenceMsg failed (group=%s page=%d/%d): %s",
      groupCode,
      pageStart,
      pageLimit,
      e instanceof Error ? (e.stack ?? e.message) : String(e),
    );
    throw e;
  }
}

/**
 * Walk every page and return the pages in order.
 *
 * Returns an ARRAY OF PAGES, not a flattened message list — that is the
 * reference's contract and `get_essence_msg_list` depends on it, because each page
 * carries its own `retcode`/`retmsg` for the caller to inspect.
 */
export async function getGroupEssenceMsgAll(
  cookieObject: Record<string, string>,
  groupCode: string,
): Promise<EssencePage[]> {
  const ret: EssencePage[] = [];
  for (let i = 0; i < MAX_ESSENCE_PAGES; i++) {
    const data = await getGroupEssenceMsg(cookieObject, groupCode, i, 50);
    ret.push(data);
    if (data.data.is_end) return ret;
  }
  throw new Error(`group essence pagination exceeded ${MAX_ESSENCE_PAGES} pages for group ${groupCode}`);
}