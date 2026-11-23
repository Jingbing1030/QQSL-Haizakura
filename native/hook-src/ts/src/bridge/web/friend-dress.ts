// A friend's active dress-up items (好友装扮: 气泡 / 挂件 / 名片 / 来电 …) from the
// SSR page at `zb.vip.qq.com`.
//
// Reference region: ../protocol/src/web/friend-dress.ts
// (reference/index.mjs:11022, 155 lines). Needed by `apis/web.ts`'
// `getFriendDress`.
//
// ---------------------------------------------------------------------------
// The one genuinely surprising fact: three app ids are unreachable
// ---------------------------------------------------------------------------
// `UNRESOLVABLE_APPS = {2, 5, 23}` — 气泡 (bubble), 字体 (font) and 头像 (avatar).
// The server never returns the real item for these when queried by `targetUin`;
// it always answers the default. They can only be resolved if the CLIENT already
// knows the id and sends it, so a lookup will never find them. They are filtered
// out of the result rather than reported as "default", because "default" is a
// wrong answer, not a partial one.
//
// ---------------------------------------------------------------------------
// Typed failures, not generic ones
// ---------------------------------------------------------------------------
// `FriendDressError.kind` distinguishes four situations the caller must treat
// differently:
//   network       — transport failed; retry may work
//   parse         — the page loaded but has no `__INITIAL_ASYNCDATA__`
//                   (logged out / risk-controlled / page redesigned)
//   structure     — the JSON is valid but does not have the expected shape
//   uin_mismatch  — the page answered for a DIFFERENT account than requested
//
// `uin_mismatch` is the security-relevant one: a mis-routed request would
// otherwise report another user's dress as the target's.

import { RequestUtil, cookieToString } from "./request-util.js";

/** Distinguishes the four failure situations a caller must handle differently. */
export class FriendDressError extends Error {
  readonly kind: "network" | "parse" | "structure" | "uin_mismatch";

  constructor(
    kind: FriendDressError["kind"],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.kind = kind;
    this.name = "FriendDressError";
  }
}

/** appId → dress category label (from the dress page's own business-name / tab text). */
export const DRESS_APP_KIND: Record<number, string> = {
  2: "气泡",
  4: "挂件",
  5: "字体",
  15: "名片",
  17: "来电",
  22: "彩色屏保",
  23: "头像",
  47: "头像双击动作",
  352: "输入状态",
};

/** App ids the server never resolves truthfully when queried by `targetUin`. */
export const UNRESOLVABLE_APPS: ReadonlySet<number> = new Set([2, 5, 23]);

/**
 * The `traceDetail` query value: `base64({"appid":"toaio","page_id":"37",...})`.
 * Already encoded in the reference, including a line-fold `%0A`; re-encoding it
 * would double-escape and the page would answer with an empty shell.
 */
const TRACE_DETAIL =
  "base64-eyJhcHBpZCI6InRvYWlvIiwicGFnZV9pZCI6IjM3IiwiaXRlbV9pZCI6IiIsIml0ZW1fdHlwZSI6%0AIiJ9%0A";

/** The aio webview's mobile UA, copied from the HAR the reference was built from. */
const DRESS_UA =
  "Mozilla/5.0 (Linux; Android 13; 2109119BC Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/121.0.6167.71 MQQBrowser/6.2 TBS/047925 Mobile Safari/537.36 V1_AND_SQ_9.2.66_13188_YYB_D QQ/9.2.66.33870 NetType/WIFI WebP/0.3.0 AppId/537339358";

const DRESS_RESPONSE_LIMITS = { timeoutMs: 10_000, maxResponseBytes: 2 * 1024 * 1024 };

/** One dress item, in OneBot's naming. */
export interface FriendDressItem {
  app_id: number;
  kind: string;
  item_id: number;
  name: string;
  preview_url: string;
  video_url: string;
  price: number;
}

/** The public result of `getFriendDress`. */
export interface FriendDressResult {
  target_uin: string;
  is_svip: boolean;
  avatar_url: string;
  items: FriendDressItem[];
}

interface RawUsingItem {
  appId: number;
  itemId?: number;
  name?: string;
  image?: string;
  extraappinfo?: {
    extraInfo?: {
      immersiveMaterial?: string;
    };
  };
  extrainfo?: { price?: number };
}

interface AsyncData {
  targetUin: string;
  isSvip?: boolean;
  avatarImage?: string;
  rawUsingList: RawUsingItem[];
}

/** Build the dress-page URL for one target. Note the inner URL is itself a query param. */
export function buildDressUrl(targetUin: string): string {
  const inner = `https://zb.vip.qq.com/v2/pages/aioDressPage?fromPage=1&targetUin=${targetUin}&widgetId=0&fontEffectId=0&bgId=custom&chatId=${targetUin}&isGroup=0&traceDetail=${TRACE_DETAIL}`;
  return `https://zb.vip.qq.com/v2/pages/aioDressPage?${new URLSearchParams({
    fromPage: "1",
    enteranceId: "aio",
    url: inner,
    fontEffectId: "0",
    chatId: targetUin,
    widgetId: "0",
    targetUin,
    isGroup: "0",
    bgId: "custom",
  }).toString()}&traceDetail=${TRACE_DETAIL}`;
}

/** Extract `window.__INITIAL_ASYNCDATA__`'s JSON from the SSR HTML. */
export function parseAsyncData(html: string): unknown {
  const m = /window\.__INITIAL_ASYNCDATA__\s*=\s*(\{[\s\S]*?\});\(function/.exec(html);
  if (!m?.[1]) {
    throw new FriendDressError(
      "parse",
      "装扮页中未找到 __INITIAL_ASYNCDATA__（未登录态/风控/页面改版）",
    );
  }
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    throw new FriendDressError("parse", "__INITIAL_ASYNCDATA__ 不是合法 JSON", { cause: e });
  }
}

/**
 * Runtime structural validation. Throws `structure` rather than carrying
 * malformed data forward — the reference is explicit ("绝不带着畸形数据继续").
 */
export function validateAsyncData(data: unknown): AsyncData {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new FriendDressError("structure", "__INITIAL_ASYNCDATA__ 顶层不是对象");
  }
  const d = data as Record<string, unknown>;
  if (typeof d["targetUin"] !== "string" || d["targetUin"].length === 0) {
    throw new FriendDressError("structure", "targetUin 缺失或不是非空字符串");
  }
  if (d["isSvip"] !== undefined && typeof d["isSvip"] !== "boolean") {
    throw new FriendDressError("structure", "isSvip 不是布尔值");
  }
  if (d["avatarImage"] !== undefined && typeof d["avatarImage"] !== "string") {
    throw new FriendDressError("structure", "avatarImage 不是字符串");
  }
  if (!Array.isArray(d["rawUsingList"])) {
    throw new FriendDressError("structure", "rawUsingList 缺失或不是数组");
  }
  (d["rawUsingList"] as unknown[]).forEach((item, i) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new FriendDressError("structure", `rawUsingList[${String(i)}] 不是对象`);
    }
    const r = item as Record<string, unknown>;
    if (typeof r["appId"] !== "number") {
      throw new FriendDressError("structure", `rawUsingList[${String(i)}].appId 缺失或不是数字`);
    }
    if (r["itemId"] !== undefined && typeof r["itemId"] !== "number") {
      throw new FriendDressError("structure", `rawUsingList[${String(i)}].itemId 不是数字`);
    }
    if (r["name"] !== undefined && typeof r["name"] !== "string") {
      throw new FriendDressError("structure", `rawUsingList[${String(i)}].name 不是字符串`);
    }
    if (r["image"] !== undefined && typeof r["image"] !== "string") {
      throw new FriendDressError("structure", `rawUsingList[${String(i)}].image 不是字符串`);
    }
    if (r["extraappinfo"] !== undefined) {
      if (r["extraappinfo"] === null || typeof r["extraappinfo"] !== "object" || Array.isArray(r["extraappinfo"])) {
        throw new FriendDressError("structure", `rawUsingList[${String(i)}].extraappinfo 不是对象`);
      }
      const extraInfo = (r["extraappinfo"] as Record<string, unknown>)["extraInfo"];
      if (extraInfo !== undefined) {
        if (extraInfo === null || typeof extraInfo !== "object" || Array.isArray(extraInfo)) {
          throw new FriendDressError("structure", `rawUsingList[${String(i)}].extraappinfo.extraInfo 不是对象`);
        }
        const immersiveMaterial = (extraInfo as Record<string, unknown>)["immersiveMaterial"];
        if (immersiveMaterial !== undefined && typeof immersiveMaterial !== "string") {
          throw new FriendDressError(
            "structure",
            `rawUsingList[${String(i)}].extraappinfo.extraInfo.immersiveMaterial 不是字符串`,
          );
        }
      }
    }
  });
  return data as AsyncData;
}

/**
 * Pull one item's dynamic preview video url, or "" when it has none.
 *
 * Two unrelated mechanisms, one per app:
 *  - 名片 (appId 15): the video lives in `extraInfo.immersiveMaterial`, itself a
 *    JSON string, under `videoUrl`.
 *  - 来电 (appId 17): no dedicated field. The preview image sits at
 *    `funCall/item/{itemId}/(web_)image.jpg` and the video is its sibling
 *    `media.mp4`. The rename is only applied when the filename matches exactly;
 *    anything else returns "" rather than guessing a path.
 */
export function resolveVideoUrl(r: RawUsingItem): string {
  if (r.appId === 15) {
    const raw = r.extraappinfo?.extraInfo?.immersiveMaterial;
    if (raw === undefined) return "";
    let material: unknown;
    try {
      material = JSON.parse(raw);
    } catch (error) {
      throw new FriendDressError(
        "structure",
        `装扮 appId=${String(r.appId)} itemId=${String(r.itemId ?? 0)} 的 immersiveMaterial 不是合法 JSON`,
        { cause: error },
      );
    }
    if (material === null || typeof material !== "object" || Array.isArray(material)) {
      throw new FriendDressError(
        "structure",
        `装扮 appId=${String(r.appId)} itemId=${String(r.itemId ?? 0)} 的 immersiveMaterial 不是对象`,
      );
    }
    const videoUrl = (material as Record<string, unknown>)["videoUrl"];
    if (typeof videoUrl !== "string" || videoUrl.length === 0) {
      throw new FriendDressError(
        "structure",
        `装扮 appId=${String(r.appId)} itemId=${String(r.itemId ?? 0)} 的 immersiveMaterial.videoUrl 缺失或不是非空字符串`,
      );
    }
    return videoUrl;
  }
  if (r.appId === 17 && r.image && /\/(?:web_)?image\.jpg$/.test(r.image)) {
    return r.image.replace(/\/(?:web_)?image\.jpg$/, "/media.mp4");
  }
  return "";
}

function toItem(r: RawUsingItem): FriendDressItem {
  const price = r.extrainfo?.price;
  return {
    app_id: r.appId,
    kind: DRESS_APP_KIND[r.appId] ?? `appId=${String(r.appId)}`,
    item_id: r.itemId ?? 0,
    name: r.name ?? "",
    preview_url: r.image ?? "",
    video_url: resolveVideoUrl(r),
    price: typeof price === "number" ? price : 0,
  };
}

/**
 * Look up the dress items one friend is currently using.
 *
 * "No dress" is an empty `items` list. Anything that goes wrong in the fetch,
 * parse or validation throws a `FriendDressError` whose `kind` says which stage.
 */
export async function getFriendDressWebAPI(
  cookieObject: Record<string, string>,
  targetUin: string,
): Promise<FriendDressResult> {
  let html: string;
  try {
    html = await RequestUtil.HttpGetText(
      buildDressUrl(targetUin),
      "GET",
      "",
      {
        Cookie: cookieToString(cookieObject),
        "User-Agent": DRESS_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      DRESS_RESPONSE_LIMITS,
    );
  } catch (e) {
    throw new FriendDressError("network", `装扮页请求失败: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    });
  }
  const data = validateAsyncData(parseAsyncData(html));
  if (data.targetUin !== targetUin) {
    throw new FriendDressError(
      "uin_mismatch",
      `装扮页返回账号 ${data.targetUin} 与请求账号 ${targetUin} 不一致`,
    );
  }
   return {
    target_uin: data.targetUin,
    is_svip: data.isSvip ?? false,
    avatar_url: data.avatarImage ?? "",
    items: data.rawUsingList.filter((r) => !UNRESOLVABLE_APPS.has(r.appId)).map(toItem),
  };
}