// `WebApi` — the cookie-minting layer every HTTP-backed OneBot action depends on.
//
// Reference region: src/bridge/apis/web.ts (reference/index.mjs:338908, 232 lines).
// This is the second of the two modules the dependency report marked READY, and it
// is the more consequential of the two: `getCookies(domain)` is the single entry
// point 41 of the 228 OneBot actions use to reach QQ's web endpoints.
//
// ---------------------------------------------------------------------------
// The mechanism is NOT OIDB, and the code says so loudly
// ---------------------------------------------------------------------------
// Only two of this module's operations are OIDB:
//
//     ForceFetchClientKey  0x102a_1   -> a clientkey + keyindex
//     GetPskey             0x102a_0   -> a p_skey for one domain
//
// Everything else is a plain HTTPS GET to `ssl.ptlogin2.qq.com/jump`, which answers
// with `Set-Cookie` headers. The shape of the whole thing is:
//
//     1. mint a clientkey over OIDB
//     2. GET the "jump" URL with that clientkey  -> a cookie jar
//     3. if the jar has no `p_skey`, ask OIDB for one and graft it in
//
// Step 3 is the interesting one and it is a FALLBACK, not a second attempt: the
// jump endpoint sometimes returns cookies without a p_skey (the account has no web
// session for that domain), and `GetPskey` can mint one directly. The fallback is
// wrapped in `try {} catch { return data }` — a failure there returns the PARTIAL
// jar rather than throwing, because a jar with `skey` alone still works for the
// endpoints that accept `skey`.
//
// Forcing either half into an `OidbSpec` would be a category error: the jump call
// has no command number, no protobuf body and no envelope, and its entire output is
// HTTP headers. They stay two mechanisms, and this module is where they meet.
//
// ---------------------------------------------------------------------------
// `getSKey` is a different jump URL, not a different ticket
// ---------------------------------------------------------------------------
// `getSKey` requests a Qzone-specific `u1` (`h5.qzone.qq.com/qqnt/qzoneinpcqq/friend`)
// and reads `skey` instead of `p_skey`. The URLs differ only in the `u1` query
// value and the two are NOT interchangeable: asking the group-notice `u1` for a
// `skey` yields no skey at all. Both URLs are reproduced byte-for-byte.
//
// ---------------------------------------------------------------------------
// The two bkn helpers differ in their return type, and that is deliberate
// ---------------------------------------------------------------------------
// `getBknFromSKey` returns a NUMBER and `getBknFromCookie` (in `web/request-util.ts`)
// returns a STRING. `getCredentials` publishes the number as `token` and
// `csrf_token`; every URL builder concatenates the string. A single helper would
// force one of the two call sites to stringify, which is precisely the kind of
// "cleanup" that changes the wire.

import { ForceFetchClientKey, GetPskey } from "../../oidb/services/index.js";
import type { BridgeContext, ClientKey, CookieJar } from "../context.js";
import { oidbCaller } from "../oidb-invoke.js";
import { RequestUtil, cookieToString } from "../web/request-util.js";
import { loadBinarySource } from "../web/binary-source.js";
import {
  deleteGroupNotice,
  getGroupNoticeWebAPI,
  setGroupNoticeWebAPI,
  uploadGroupNoticeImage,
  groupNoticeImageUrl,
  type GroupNotice,
  type GroupNoticeOptions,
} from "../web/group-notice.js";
import { WebHonorType, getHonorListWebAPI, type HonorMember, type WebHonorTypeValue } from "../web/group-honor.js";
import { getGroupEssenceMsg, getGroupEssenceMsgAll, type EssencePage } from "../web/group-essence.js";
import { getDaySignedListWebAPI, type SignedMember } from "../web/group-signin.js";
import { getFriendDressWebAPI, type FriendDressResult } from "../web/friend-dress.js";

/**
 * `ForceFetchClientKey.invoke` / `GetPskey.invoke`, rebuilt from the ported specs.
 *
 * Both are `0x102a` — see `ts/src/oidb/services/0x102a.ts`, which exists precisely
 * because these two mint the credentials for everything else.
 */
const ForceFetchClientKeyCaller = oidbCaller(ForceFetchClientKey);
const GetPskeyCaller = oidbCaller(GetPskey);

/**
 * The `ssl.ptlogin2.qq.com/jump` URL for a general `p_skey`.
 *
 * Assembled by concatenation, not `URLSearchParams`, on purpose: `u1` is
 * DOUBLE-encoded (`%2F` inside `%3A%2F%2F` inside `%2F`) and a query builder would
 * collapse it to a single encoding, which the endpoint answers with a redirect
 * loop instead of cookies.
 */
export function buildJumpUrl(uin: string, clientKey: string, keyIndex: string, domain: string): string {
  return (
    "https://ssl.ptlogin2.qq.com/jump?ptlang=1033&clientuin=" +
    uin +
    "&clientkey=" +
    clientKey +
    "&u1=https%3A%2F%2F" +
    domain +
    "%2F" +
    uin +
    "%2Finfocenter&keyindex=" +
    keyIndex
  );
}

/** The `u1` for `getSKey`; a different landing page and therefore a different cookie set. */
export const QZONE_SKEY_JUMP_URL_TAIL =
  "&u1=https%3A%2F%2Fh5.qzone.qq.com%2Fqqnt%2Fqzoneinpcqq%2Ffriend%3Frefresh%3D0%26clientuin%3D0%26darkMode%3D0";

/**
 * The QQ `bkn` (token / csrf_token) from an `skey` or `p_skey`: djb2 truncated to
 * 31 bits. Returns a NUMBER here; see the header for why.
 */
export function getBknFromSKey(skey: string): number {
  let hash = 5381;
  for (let i = 0; i < skey.length; i++) hash += (hash << 5) + skey.charCodeAt(i);
  return hash & 2147483647;
}

/** One honour-list response, in OneBot's `get_group_honor_info` shape. */
export interface GroupHonorInfo {
  group_id: number;
  current_talkative: HonorMember | null;
  talkative_list: HonorMember[];
  performer_list: HonorMember[];
  legend_list: HonorMember[];
  emotion_list: HonorMember[];
  strong_newbie_list: HonorMember[];
}

/** `get_credentials`' payload. `token` and `csrf_token` are the same number by design. */
export interface WebCredentials {
  cookies: string;
  token: number;
  csrf_token: number;
}

export class WebApi {
  readonly ctx: BridgeContext;

  constructor(ctx: BridgeContext) {
    this.ctx = ctx;
  }

  /** `ForceFetchClientKey` — the clientkey every jump URL needs. */
  async forceFetchClientKey(): Promise<ClientKey> {
    // `Record<string, never>` params: the request body has no fields at all
    // (`__size_OidbClientKeyReq` is 0 in the reference), so the argument is `{}`
    // rather than being omitted — the caller always passes a params object even
    // when the message has no fields.
    return ForceFetchClientKeyCaller.invoke(this.ctx, {});
  }

  /**
   * The cookie jar for one `qq.com` subdomain.
   *
   * Fails OPEN in one specific way: when the jump response carries no `p_skey` and
   * the `GetPskey` repair also fails, the partially-populated jar is returned rather
   * than an error thrown. Callers that truly need a p_skey detect its absence
   * themselves (see `CollectionApi.list`), so "no p_skey" stays distinguishable
   * from "the request failed".
   */
  async getCookies(domain: string): Promise<CookieJar> {
    const clientKeyData = await this.forceFetchClientKey();
    const requestUrl = buildJumpUrl(
      this.ctx.identity.uin,
      clientKeyData.clientKey,
      clientKeyData.keyIndex,
      domain,
    );
    const data = await RequestUtil.HttpsGetCookies(requestUrl);
    if (!data["p_skey"] || data["p_skey"].length === 0) {
      try {
        const pskey = (await GetPskeyCaller.invoke(this.ctx, { domainList: [domain] })).domainPskeyMap.get(domain);
        if (pskey) data["p_skey"] = pskey;
      } catch {
        // Deliberate: a jar with `skey` alone is still usable, so a failed repair
        // returns what we have instead of discarding it.
        return data;
      }
    }
    return data;
  }

  /** `getCookies` joined into the canonical `k=v; k=v` header form. */
  async getCookiesStr(domain: string): Promise<string> {
    return cookieToString(await this.getCookies(domain));
  }

  /**
   * The Qzone `skey`'s bkn.
   *
   * The `if (!skey)` re-check looks redundant after `getSKey` already throws on an
   * empty skey, and it is: the reference kept it, and keeping it means the port
   * reports the same error string if `getSKey`'s contract ever loosens.
   */
  async getCsrfToken(): Promise<number> {
    const skey = await this.getSKey();
    if (!skey) throw new Error("SKey is Empty");
    return getBknFromSKey(skey);
  }

  /** `get_credentials`' payload (cookie string + bkn in both token slots). */
  async getCredentials(domain: string): Promise<WebCredentials> {
    const cookieObject = await this.getCookies(domain);
    const cookiesStr = cookieToString(cookieObject);
    const skey = cookieObject["p_skey"] || cookieObject["skey"] || "";
    const token = skey ? getBknFromSKey(skey) : 0;
    return { cookies: cookiesStr, token, csrf_token: token };
  }

  /**
   * The Qzone `skey` itself.
   *
   * Note the DIFFERENT error message from `getCsrfToken`'s: this one names the
   * missing credential ("clientKey is empty") because that is the failure a caller
   * can act on — clientkey minting is OIDB and therefore retryable, while an empty
   * skey in a successful response is not.
   */
  async getSKey(): Promise<string> {
    const clientKeyData = await this.forceFetchClientKey();
    if (!clientKeyData.clientKey) throw new Error("getClientKey Error: clientKey is empty");
    const requestUrl =
      "https://ssl.ptlogin2.qq.com/jump?ptlang=1033&clientuin=" +
      this.ctx.identity.uin +
      "&clientkey=" +
      clientKeyData.clientKey +
      QZONE_SKEY_JUMP_URL_TAIL +
      "&keyindex=" +
      clientKeyData.keyIndex;
    const skey = (await RequestUtil.HttpsGetCookies(requestUrl))["skey"];
    if (!skey) throw new Error("SKey is Empty");
    return skey;
  }

  /** One page of group essence messages. `pageStart` is 0-indexed. */
  async getEssence(groupId: number, pageStart = 0, pageLimit = 50): Promise<EssencePage> {
    const groupCode = groupId.toString();
    return (
      (await getGroupEssenceMsg(await this.getCookies("qun.qq.com"), groupCode, pageStart, pageLimit)) || {
        retcode: -1,
        data: { is_end: true, msg_list: [] },
      }
    );
  }

  /** Walks every page (cap 20) and returns the pages in order. */
  async getEssenceAll(groupId: number): Promise<EssencePage[]> {
    const groupCode = groupId.toString();
    return await getGroupEssenceMsgAll(await this.getCookies("qun.qq.com"), groupCode);
  }

  /**
   * Honour lists for one group.
   *
   * `strong_newbie_list` is always `[]` and is never fetched — there is no web type
   * id for it in this endpoint. It is in the payload because OneBot's schema has it,
   * and omitting the key would break clients that iterate it.
   *
   * The talkative list is the only one that also populates `current_talkative`, and
   * only when it is non-empty — so "no talkative yet" is `null`, not a member with
   * empty fields.
   */
  async getHonorInfo(groupId: number, type: WebHonorTypeValue | string): Promise<GroupHonorInfo> {
    const groupCode = groupId.toString();
    const cookieObject = await this.getCookies("qun.qq.com");
    const honorInfo: GroupHonorInfo = {
      group_id: groupId,
      current_talkative: null,
      talkative_list: [],
      performer_list: [],
      legend_list: [],
      emotion_list: [],
      strong_newbie_list: [],
    };
    if (type === WebHonorType.TALKATIVE || type === WebHonorType.ALL) {
      const talkativeList = await getHonorListWebAPI(cookieObject, groupCode, 1);
      if (talkativeList.length > 0) {
        honorInfo.current_talkative = talkativeList[0] ?? null;
        honorInfo.talkative_list = talkativeList;
      }
    }
    if (type === WebHonorType.PERFORMER || type === WebHonorType.ALL) {
      honorInfo.performer_list = await getHonorListWebAPI(cookieObject, groupCode, 2);
    }
    if (type === WebHonorType.LEGEND || type === WebHonorType.ALL) {
      honorInfo.legend_list = await getHonorListWebAPI(cookieObject, groupCode, 3);
    }
    if (type === WebHonorType.EMOTION || type === WebHonorType.ALL) {
      honorInfo.emotion_list = await getHonorListWebAPI(cookieObject, groupCode, 6);
    }
    return honorInfo;
  }

  /**
   * Today's sign-in list. `[]` for a group with no sign-ins; THROWS on transport or
   * auth failure so the caller can tell the two apart.
   */
  async getSignedList(groupId: number): Promise<SignedMember[]> {
    return getDaySignedListWebAPI(
      await this.getCookies("qun.qq.com"),
      groupId.toString(),
      this.ctx.identity.uin.toString(),
    );
  }

  /**
   * Publish a group announcement, uploading an image first when one was given.
   *
   * The image path is worth reading closely: the uploaded picture id and the REAL
   * width/height come back from the upload and REPLACE the caller's 540x300
   * defaults. Sending the defaults with a real picture id makes the announcement
   * render distorted, which looks like a client bug and is not.
   */
  async sendNotice(
    groupId: number,
    content: string,
    options?: (GroupNoticeOptions & { image?: string }) | undefined,
  ): Promise<{ ec?: number; em?: string }> {
    const groupCode = groupId.toString();
    const cookieObject = await this.getCookies("qun.qq.com");
    let picId = "";
    let imgWidth = 540;
    let imgHeight = 300;
    if (options?.image) {
      const loaded = await loadBinarySource(options.image, "group-notice image");
      const picInfo = await uploadGroupNoticeImage(cookieObject, Buffer.from(loaded.bytes));
      picId = picInfo.id;
      imgWidth = picInfo.width;
      imgHeight = picInfo.height;
    }
    const ret = await setGroupNoticeWebAPI(cookieObject, groupCode, content, {
      ...options,
      picId,
      imgWidth,
      imgHeight,
    });
    if (ret.ec !== 0) {
      throw new Error(`设置群公告失败: ec=${String(ret.ec ?? "missing")}, em=${String(ret.em ?? "missing")}`);
    }
    return ret;
  }

  /** The merged announcement list (regular + new-member), deduped by fid. */
  async getNotice(groupId: number): Promise<GroupNotice[]> {
    const groupCode = groupId.toString();
    return mapGroupNoticeResponse(await getGroupNoticeWebAPI(await this.getCookies("qun.qq.com"), groupCode));
  }

  /** Delete one announcement. Returns `false` on any failure — see `deleteGroupNotice`. */
  async deleteNotice(groupId: number, fid: string): Promise<boolean> {
    const groupCode = groupId.toString();
    return await deleteGroupNotice(await this.getCookies("qun.qq.com"), groupCode, fid);
  }

  /**
   * A friend's currently-active dress items. Uses the `vip.qq.com` domain, not
   * `qun.qq.com` — the dress page is on the VIP host and will not authenticate
   * against a qun cookie.
   */
  async getFriendDress(targetUin: number): Promise<FriendDressResult> {
    return getFriendDressWebAPI(await this.getCookies("vip.qq.com"), targetUin.toString());
  }
}

// ---------------------------------------------------------------------------
// Group-notice response mapping
// ---------------------------------------------------------------------------

/**
 * Coerce one field to a finite number, or throw naming the field.
 *
 * The reference funnels every numeric field of a feed through this because the
 * endpoint returns them as MIXED strings and numbers (`read_num` is a string,
 * `pubt` is a number). A missing or non-numeric one is a malformed response, not a
 * zero — silently zeroing `sender_id` would attribute an announcement to QQ号 0.
 */
function finiteNumber(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid group notice response: ${field} must be a finite number`);
  }
  return parsed;
}

/**
 * `feeds`/`inst` as an array. The server sends an OBJECT keyed by index rather than
 * an array when a page is filtered down to a few entries, so both shapes must be
 * accepted — a caller that assumes `Array.isArray` sees an empty list.
 */
function collectionValues(collection: unknown, field: string): unknown[] {
  if (collection === undefined) return [];
  if (Array.isArray(collection)) return collection;
  if (collection === null || typeof collection !== "object") {
    throw new Error(`invalid group notice response: ${field} must be an array or object`);
  }
  return Object.values(collection);
}

/** One feed → one `GroupNotice`. Every field is validated; nothing is guessed. */
function mapGroupNoticeFeed(feed: unknown, sendToNewMembers: boolean): GroupNotice {
  if (!feed || typeof feed !== "object") {
    throw new Error("invalid group notice response: feed must be an object");
  }
  const f = feed as Record<string, unknown>;
  if (typeof f["fid"] !== "string" || f["fid"].length === 0) {
    throw new Error("invalid group notice response: feed.fid must be a non-empty string");
  }
  const fid = f["fid"];
  const msg = f["msg"];
  if (!msg || typeof msg !== "object" || typeof (msg as Record<string, unknown>)["text"] !== "string") {
    throw new Error(`invalid group notice response: feed ${fid} has no message text`);
  }
  if (f["settings"] === undefined) {
    throw new Error(`invalid group notice response: feed ${fid} has no settings`);
  }
  const pics = ((msg as Record<string, unknown>)["pics"] ?? []) as unknown;
  if (!Array.isArray(pics) && pics !== null && typeof pics === "object") {
    throw new Error(`invalid group notice response: feed ${fid} images must be an array`);
  }
  const image = (Array.isArray(pics) ? pics : []).map((pic, index) => {
    if (!pic || typeof pic !== "object" || typeof (pic as Record<string, unknown>)["id"] !== "string") {
      throw new Error(`invalid group notice response: feed ${fid} image ${String(index)} is malformed`);
    }
    const p = pic as Record<string, unknown>;
    return {
      id: p["id"] as string,
      url: groupNoticeImageUrl(p["id"] as string),
      height: finiteNumber(p["h"], `feed ${fid} image ${String(index)}.h`),
      width: finiteNumber(p["w"], `feed ${fid} image ${String(index)}.w`),
    };
  });
  const responseType =
    f["type"] === undefined ? (sendToNewMembers ? 20 : 1) : finiteNumber(f["type"], `feed ${fid}.type`);
  return {
    notice_id: fid,
    sender_id: finiteNumber(f["u"], `feed ${fid}.u`),
    publish_time: finiteNumber(f["pubt"], `feed ${fid}.pubt`),
    message: {
      text: (msg as Record<string, unknown>)["text"] as string,
      image,
      images: image,
    },
    settings: f["settings"],
    read_num: finiteNumber(f["read_num"], `feed ${fid}.read_num`),
    type: responseType,
    pinned: f["pinned"] === undefined ? 0 : finiteNumber(f["pinned"], `feed ${fid}.pinned`),
    send_to_new_members: sendToNewMembers || responseType === 20,
  };
}

/**
 * Merge QQ's regular (`feeds`) and new-member (`inst`) lists.
 *
 * `inst` is appended SECOND and WINS on a duplicate fid — it replaces in place, so
 * the output keeps one entry per announcement and its position reflects `feeds`
 * ordering. Getting this backwards (skip the duplicate) would report an
 * announcement as regular when it is also pinned for new members.
 */
export function mapGroupNoticeResponse(ret: {
  ec?: number;
  em?: string;
  feeds?: unknown;
  inst?: unknown;
}): GroupNotice[] {
  if (ret.ec !== 0) {
    throw new Error(`获取公告失败: ec=${String(ret.ec)}, em=${ret.em ?? "missing"}`);
  }
  const notices: GroupNotice[] = [];
  const indexByNoticeId = new Map<string, number>();
  const append = (collection: unknown, sendToNewMembers: boolean, field: string): void => {
    for (const feed of collectionValues(collection, field)) {
      const mapped = mapGroupNoticeFeed(feed, sendToNewMembers);
      const existingIndex = indexByNoticeId.get(mapped.notice_id);
      if (existingIndex === undefined) {
        indexByNoticeId.set(mapped.notice_id, notices.length);
        notices.push(mapped);
      } else if (sendToNewMembers) {
        notices[existingIndex] = mapped;
      }
    }
  };
  append(ret.feeds, false, "feeds");
  append(ret.inst, true, "inst");
  return notices;
}