// Group announcement (群公告) over `web.qun.qq.com`.
//
// Reference region: ../protocol/src/web/group-notice.ts
// (reference/index.mjs:338704, 204 lines). Ported because `apis/web.ts`'
// `sendNotice` / `getNotice` / `deleteNotice` are three of its twelve public
// methods and they need nothing from OIDB — only a cookie jar, which `web.ts`
// already knows how to mint from `GetPskey` + `ForceFetchClientKey`.
//
// ---------------------------------------------------------------------------
// The bkn trap: two different bkn values in the same request
// ---------------------------------------------------------------------------
// Every call here computes the bkn TWICE and the two are not interchangeable:
//
//     const bodyBkn = calculateBkn(skey)      -> form field `bkn`
//     const urlBkn  = calculateBkn(pskey)     -> ?bkn=... on the endpoint
//
// `web.qun.qq.com` validates the query-string token against `p_skey` and the form
// token against `skey`. Using one for both gets a silent `ec: 100` from the
// server. The fallback `pskey || skey` means a jar without `p_skey` works for the
// URL half, which is why the bug is invisible until a p_skey-expiring account
// hits it.
//
// ---------------------------------------------------------------------------
// Announcement ordering and the `inst` list
// ---------------------------------------------------------------------------
// `list_announce` answers with two collections — `feeds` (regular announcements)
// and `inst` (the auto-posted "new member" instructions) — and they can contain
// the same `fid`. The merge rule (`mapGroupNoticeResponse`) is that `inst` wins
// in place: a fid already present from `feeds` is REPLACED, not appended, so the
// list keeps one entry per announcement and reports it as `send_to_new_members`.
//
// ---------------------------------------------------------------------------
// Image upload is a manual multipart body, not a library call
// ---------------------------------------------------------------------------
// `upload_img` needs `bkn`, `source=troopNotice`, `m=0` and the file as
// `pic_up`. The response is JSON whose `id` field is itself &quot;-escaped JSON,
// so it needs a second parse. Both steps are reproduced literally; "cleaning up"
// either would break the upload.

import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";

import { RequestUtil, cookieToString } from "./request-util.js";

/** Public CDN base for a group-notice picture id. */
export const GROUP_NOTICE_IMAGE_CDN = "https://gdynamic.qpic.cn/gdynamic";

/** `getGroupNotice`'s public shape after the merge. */
export interface GroupNotice {
  notice_id: string;
  sender_id: number;
  publish_time: number;
  message: {
    text: string;
    image: GroupNoticeImage[];
    images: GroupNoticeImage[];
  };
  settings: unknown;
  read_num: number;
  type: number;
  pinned: number;
  send_to_new_members: boolean;
}

export interface GroupNoticeImage {
  id: string;
  url: string;
  height: number;
  width: number;
}

/** Options `sendNotice` accepts; all of them are optional and mapped in one place. */
export interface GroupNoticeOptions {
  image?: string | undefined;
  pinned?: number | undefined;
  type?: number | undefined;
  sendToNewMembers?: boolean | undefined;
  isShowEditCard?: number | undefined;
  tipWindowType?: number | undefined;
  confirmRequired?: number | undefined;
  /** Internal: filled by `sendGroupNotice` after an image upload. */
  picId?: string | undefined;
  imgWidth?: number | undefined;
  imgHeight?: number | undefined;
}

/** The fully resolved request mode; no optionality left. */
export interface ResolvedGroupNoticeOptions {
  pinned: number;
  type: number;
  sendToNewMembers: boolean;
  isShowEditCard: number;
  tipWindowType: number;
  confirmRequired: number;
  picId: string;
  imgWidth: number;
  imgHeight: number;
}

/** Public download URL for a group-notice picture id from `list_announce`. */
export function groupNoticeImageUrl(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) throw new Error("group notice image id is empty");
  if (/[/?#\s]/.test(trimmed)) throw new Error("group notice image id is malformed");
  return `${GROUP_NOTICE_IMAGE_CDN}/${encodeURIComponent(trimmed)}/0`;
}

/** The bkn loop again — same algorithm as `getBknFromCookie`, kept separate because
 *  this region has its own copy in the reference and the call sites pass `skey`. */
function calculateBkn(key: string): string {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = hash + (hash << 5) + key.charCodeAt(i);
  }
  return String(hash & 2147483647);
}

function binaryOption(name: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (resolved !== 0 && resolved !== 1) throw new RangeError(`${name} must be 0 or 1, received ${String(resolved)}`);
  return resolved;
}

/**
 * Resolve the public compatibility fields into the exact QQ request mode.
 *
 * Pure so the conflict check is testable without a network. The check that matters
 * is `sendToNewMembers` vs `type`: they are two spellings of one server field
 * (1 = regular, 20 = new-member), and a caller that passes `type: 1` together with
 * `sendToNewMembers: true` means two different things at once. The reference throws
 * rather than picking a winner.
 */
export function resolveGroupNoticeOptions(options: GroupNoticeOptions = {}): ResolvedGroupNoticeOptions {
  if (options.sendToNewMembers !== undefined && typeof options.sendToNewMembers !== "boolean") {
    throw new TypeError(`sendToNewMembers must be a boolean, received ${typeof options.sendToNewMembers}`);
  }
  if (options.type !== undefined && options.type !== 1 && options.type !== 20) {
    throw new RangeError(`type must be 1 (regular) or 20 (new members), received ${String(options.type)}`);
  }
  const semanticType =
    options.sendToNewMembers === undefined ? undefined : options.sendToNewMembers ? 20 : 1;
  if (options.type !== undefined && semanticType !== undefined && options.type !== semanticType) {
    throw new Error(`sendToNewMembers=${String(options.sendToNewMembers)} conflicts with type=${String(options.type)}`);
  }
  const type = options.type ?? semanticType ?? 1;
  const imgWidth = options.imgWidth ?? 540;
  const imgHeight = options.imgHeight ?? 300;
  if (
    !Number.isFinite(imgWidth) ||
    imgWidth <= 0 ||
    !Number.isFinite(imgHeight) ||
    imgHeight <= 0
  ) {
    throw new RangeError(
      `group notice image dimensions must be positive finite numbers, received ${String(imgWidth)}x${String(imgHeight)}`,
    );
  }
  return {
    pinned: binaryOption("pinned", options.pinned, 0),
    type,
    sendToNewMembers: type === 20,
    isShowEditCard: binaryOption("isShowEditCard", options.isShowEditCard, 1),
    tipWindowType: binaryOption("tipWindowType", options.tipWindowType, 1),
    confirmRequired: binaryOption("confirmRequired", options.confirmRequired, 1),
    picId: options.picId ?? "",
    imgWidth,
    imgHeight,
  };
}

/** Parse QQ's HTML-escaped JSON metadata returned by the image upload CGI. */
export function parseGroupNoticeImageUploadResponse(data: string): { id: string; width: number; height: number } {
  let result: { ec?: number; em?: string; id?: string };
  try {
    result = JSON.parse(data) as { ec?: number; em?: string; id?: string };
  } catch (cause) {
    throw new Error("group notice image upload returned invalid JSON", { cause });
  }
  if (result.ec !== 0 || !result.id) {
    throw new Error(
      `group notice image upload failed: ec=${String(result.ec ?? "missing")} em=${String(result.em ?? "missing")}`,
    );
  }
  let idObj: { id?: string; w?: unknown; h?: unknown };
  try {
    idObj = JSON.parse(result.id.replace(/&quot;/g, "\"")) as { id?: string; w?: unknown; h?: unknown };
  } catch (cause) {
    throw new Error("group notice image upload returned invalid image metadata JSON", { cause });
  }
  const width = Number(idObj.w);
  const height = Number(idObj.h);
  if (
    typeof idObj.id !== "string" ||
    idObj.id.length === 0 ||
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    throw new Error("group notice image upload returned malformed image metadata");
  }
  return { id: idObj.id, width, height };
}

/**
 * Publish a group announcement.
 *
 * Note the endpoint switch: `sendToNewMembers` selects `add_qun_instruction`
 * instead of `add_qun_notice`. They take the same form fields, so a caller cannot
 * tell from the response which one it hit — the visible difference is which list
 * the notice lands in.
 */
export async function setGroupNoticeWebAPI(
  cookieObject: Record<string, string>,
  groupCode: string,
  content: string,
  options: GroupNoticeOptions = {},
): Promise<{ ec?: number; em?: string }> {
  const resolved = resolveGroupNoticeOptions(options);
  const skey = cookieObject["skey"] || "";
  const pskey = cookieObject["p_skey"] || skey;
  const bodyBkn = calculateBkn(skey);
  const urlBkn = calculateBkn(pskey);
  const settings = JSON.stringify({
    is_show_edit_card: resolved.isShowEditCard,
    tip_window_type: resolved.tipWindowType,
    confirm_required: resolved.confirmRequired,
  });
  const bodyParams: Record<string, string> = {
    qid: groupCode,
    bkn: bodyBkn,
    text: content,
    pinned: resolved.pinned.toString(),
    type: resolved.type.toString(),
    settings,
  };
  if (resolved.picId !== "") {
    bodyParams["pic"] = resolved.picId;
    bodyParams["imgWidth"] = resolved.imgWidth.toString();
    bodyParams["imgHeight"] = resolved.imgHeight.toString();
  }
  const url = `https://web.qun.qq.com/cgi-bin/announce/${resolved.sendToNewMembers ? "add_qun_instruction" : "add_qun_notice"}?bkn=${urlBkn}`;
  const body = new URLSearchParams(bodyParams).toString();
  return (await RequestUtil.HttpGetJson(
    url,
    "POST",
    body,
    { Cookie: cookieToString(cookieObject), "Content-Type": "application/x-www-form-urlencoded" },
    true,
    false,
  )) as { ec?: number; em?: string };
}

/**
 * List group announcements. `start = -1` means "newest page".
 *
 * The `ft`/`i`/`ni` fields are unlabelled in the reference and are reproduced
 * verbatim; dropping either `i` or `ni` changes the response shape rather than
 * failing.
 */
export async function getGroupNoticeWebAPI(
  cookieObject: Record<string, string>,
  groupCode: string,
  start = -1,
  count = 20,
): Promise<{ ec?: number; em?: string; feeds?: unknown; inst?: unknown }> {
  const skey = cookieObject["skey"] || "";
  const pskey = cookieObject["p_skey"] || skey;
  const bodyBkn = calculateBkn(skey);
  const urlBkn = calculateBkn(pskey);
  const bodyParams = new URLSearchParams({
    qid: groupCode,
    bkn: bodyBkn,
    ft: "23",
    s: start.toString(),
    n: count.toString(),
    i: "1",
    ni: "1",
  }).toString();
  const url = `https://web.qun.qq.com/cgi-bin/announce/list_announce?bkn=${urlBkn}`;
  return (await RequestUtil.HttpGetJson(
    url,
    "POST",
    bodyParams,
    {
      Cookie: cookieToString(cookieObject),
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://web.qun.qq.com/mannounce/index.html?_wv=1031&_bid=148",
    },
    true,
    false,
  )) as { ec?: number; em?: string; feeds?: unknown; inst?: unknown };
}

/** Upload one image for a group announcement; returns the picture id and its size. */
export async function uploadGroupNoticeImage(
  cookieObject: Record<string, string>,
  imageBuffer: Uint8Array,
): Promise<{ id: string; width: number; height: number }> {
  const bkn = calculateBkn(cookieObject["skey"] || "");
  const boundary = `-----------------------------${String(Date.now())}`;
  const parts: Buffer[] = [];
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="bkn"\r\n\r\n${bkn}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="source"\r\n\r\ntroopNotice\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="m"\r\n\r\n0\r\n`));
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="pic_up"; filename="image.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
  );
  parts.push(Buffer.from(imageBuffer));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  const options = {
    hostname: "web.qun.qq.com",
    path: "/cgi-bin/announce/upload_img",
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
      Cookie: cookieToString(cookieObject),
    },
  };
  return await new Promise((resolve, reject) => {
    const req = httpsRequest(options, (res: IncomingMessage) => {
      let data = "";
      res.on("data", (chunk: Buffer | string) => {
        data += chunk.toString();
      });
      res.on("end", () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`group notice image upload returned HTTP ${String(res.statusCode ?? "unknown")}`));
          return;
        }
        try {
          resolve(parseGroupNoticeImageUploadResponse(data));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
    req.on("error", (error: Error) =>
      reject(new Error(`group notice image upload transport error: ${error.message}`, { cause: error })),
    );
    req.write(body);
    req.end();
  });
}

/**
 * Delete an announcement by fid. Returns `true` on success and `false` on ANY
 * failure — including a transport failure. That asymmetry with the rest of this
 * module is the reference's (`deleteGroupNotice` swallows to `false`), and the
 * OneBot action depends on it: "already gone" and "we could not ask" both mean
 * the caller should stop retrying.
 */
export async function deleteGroupNotice(
  cookieObject: Record<string, string>,
  groupCode: string,
  fid: string,
): Promise<boolean> {
  try {
    const skey = cookieObject["skey"] || "";
    const pskey = cookieObject["p_skey"] || skey;
    const bodyBkn = calculateBkn(skey);
    const urlBkn = calculateBkn(pskey);
    const params = new URLSearchParams({ bkn: bodyBkn, fid, qid: groupCode }).toString();
    const url = `https://web.qun.qq.com/cgi-bin/announce/del_feed?bkn=${urlBkn}`;
    const ret = (await RequestUtil.HttpGetJson(
      url,
      "POST",
      params,
      { Cookie: cookieToString(cookieObject), "Content-Type": "application/x-www-form-urlencoded" },
      true,
      false,
    )) as { ec?: number } | undefined;
    return ret?.ec === 0;
  } catch {
    return false;
  }
}