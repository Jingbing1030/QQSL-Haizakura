// `../protocol/src/web/qzone-feed-content.ts` (94 lines) — pull one post's own
// content out of a QQ Zone feed's HTML blob.
//
// ---------------------------------------------------------------------------
// The input is a whole feed row, and only a slice of it is wanted
// ---------------------------------------------------------------------------
// `feeds3_html_more` returns each feed as `html`: a rendered `<li class="f-item">`
// containing the author, the post, the image grid, the like/comment buttons AND
// an arbitrary number of already-rendered comments. Reading `.textContent` of
// that would return the post glued to every comment on it. So the extraction is
// a series of exclusions, and each one exists because something got picked up
// that should not have:
//
//   * `isContentNode` rejects any node with a `mod-comments`, `comments-list`,
//     `f-item-passive` or `f-ct-video` ANCESTOR — comments, quoted forwards and
//     video cards are therefore invisible to every selector below.
//   * `text()` drops `data-cmd="qz_toggle"` and `.load_img` children, which are
//     the "全文"/"展开图片" affordances: their label ("全文") would otherwise be
//     appended to a truncated post's text and look like part of it.
//   * image selection skips any `.img-item` carrying `data-v_itemid` or
//     `data-videotype` — a video's cover lives in the same grid as photos, and
//     uploading its cover as a photo of the post is wrong.
//
// ---------------------------------------------------------------------------
// `content_complete` is three-valued in effect
// ---------------------------------------------------------------------------
// It is `null` when there is no content node at all, `true` when either a
// `.qz_info_complete` node was chosen or no `qz_toggle` remains inside the
// chosen node, and `false` when a `qz_toggle` is still there. That last case is
// the one the caller acts on: the post was truncated by the server and the
// caption is a prefix. `null` versus `false` must not be conflated — `null` says
// "no post text was found in this row", which for `appid === 311` means the row
// is a share card, not a truncated post.
//
// ---------------------------------------------------------------------------
// `tid` only for appid 311
// ---------------------------------------------------------------------------
// The `feed_data` metadata node carries the real tid, but only the 说说 appid
// (311) has one. For other appids `tid` stays `null` and the caller uses the
// feed `key` instead, so a photo-album row does not get a fake tid that would
// later be used in a delete call.
//
// Reference: reference/index.mjs:335541 (`../protocol/src/web/qzone-feed-content.ts`).

import { findAll, parseDocument, type HtmlNode } from "./html.js";

/** The four container classes whose subtree `isContentNode` excludes. */
const EXCLUDED_ANCESTOR_CLASSES = ["mod-comments", "comments-list", "f-item-passive", "f-ct-video"];

/** The 说说 appid; the only one whose feeds carry a usable `tid`. */
export const QZONE_APPID_SHUOSHUO = 311;

/** One parsed feed row's content. `null` means "the row did not have that part". */
export interface QzoneFeedContent {
  tid: string | null;
  content: string | null;
  content_complete: boolean | null;
  images: string[] | null;
  like_count: number | null;
  comment_count: number | null;
}

/** `hasClass` — a whole class token, not a substring. */
export function hasClass(node: HtmlNode, name: string): boolean {
  return (node.attribs["class"] ?? "").split(/\s+/).includes(name);
}

/**
 * `isContentNode` — true when no ancestor up to (but excluding) `root` is one of
 * the four excluded containers.
 *
 * Excluding `root` itself is what lets the caller pass the `f-item` as `root`:
 * the post's own subtree is walked, but a comment row nested inside it is not
 * visited, because the walk is filtered at each node rather than pruned at the
 * container.
 */
export function isContentNode(node: HtmlNode, root: HtmlNode): boolean {
  for (let parent = node.parent; parent && parent !== root; parent = parent.parent) {
    if (EXCLUDED_ANCESTOR_CLASSES.some((name) => hasClass(parent, name))) return false;
  }
  return true;
}

/**
 * `text` — structure-preserving text extraction.
 *
 * Three details that a `textContent` would get wrong:
 *
 *   * `div`/`p`/`li` contribute a NEWLINE before and after their content, which
 *     is how a multi-paragraph post keeps its paragraph breaks. The trailing
 *     "\n" is pushed as a stack item rather than appended, so it lands after the
 *     element's descendants instead of before them.
 *   * `<img>` contributes its `alt`, because QQ Zone puts emoji in `alt` and the
 *     emoji IS part of the post.
 *   * two trailing regex replaces then strip the spaces those newlines picked
 *     up and collapse three-or-more newlines to two, so paragraphs stay
 *     separated but a run of blank lines does not survive.
 */
export function text(node: HtmlNode): string {
  // The stack holds NODES and bare STRINGS. A string is a deferred chunk, and
  // the distinction from a text node is essential: a text node's data goes
  // through the `\\s+` -> " " collapse, which would turn this separator into a
  // space. That collapse is exactly why a `<div>`-per-paragraph post comes out
  // with blank lines between paragraphs only when the separators are raw.
  const chunks: string[] = [];
  const stack: (HtmlNode | string)[] = [...node.children].reverse();
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (typeof next === "string") {
      chunks.push(next);
      continue;
    }
    if (next.type === "text") {
      chunks.push(next.data.replace(/\s+/g, " "));
      continue;
    }
    if (next.type !== "tag") continue;
    if (next.attribs["data-cmd"] === "qz_toggle" || hasClass(next, "load_img")) continue;
    if (next.name === "br") {
      chunks.push("\n");
      continue;
    }
    if (next.name === "img") {
      chunks.push(next.attribs["alt"] ?? "");
      continue;
    }
    if (["div", "p", "li"].includes(next.name)) {
      // Prefix immediately, suffix deferred to AFTER the children: push the
      // separator first, then the children (which therefore pop before it).
      chunks.push("\n");
      stack.push("\n");
    }
    for (let i = next.children.length - 1; i >= 0; i -= 1) stack.push(next.children[i]!);
  }
  // Strip the padding those separators picked up, then keep at most one blank
  // line so two adjacent block elements read as a paragraph break.
  return chunks
    .join("")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `count` — a non-negative safe integer, or `null`. */
export function count(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

/**
 * `imageUrl` — normalise a feed image URL, or `null`.
 *
 * Protocol-relative (`//p.qpic.cn/…`) is the form QQ Zone actually emits, so it
 * is upgraded to `https:` rather than rejected. Only `http`/`https` survive: a
 * `javascript:` or `data:` URL in remote HTML would be handed to a OneBot
 * consumer that may well render it.
 */
export function imageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * `parseQzoneFeedContent` — the row's content, or an all-`null` result when the
 * row has no matching `f-item`.
 *
 * `key` is matched against `data-key`, not found by position: the CGI may return
 * rows whose `html` belongs to a different feed than the surrounding entry, and
 * the key is the only trustworthy join.
 */
export function parseQzoneFeedContent(
  html: string,
  key: string,
  uin: number,
  appid: number,
  likeCount: unknown,
  commentCount: unknown,
): QzoneFeedContent {
  const body = findAll(() => true, parseDocument(html).children).find(
    (node) => hasClass(node, "f-item") && node.attribs["data-key"] === key,
  );
  const result: QzoneFeedContent = {
    tid: null,
    content: null,
    content_complete: null,
    images: null,
    like_count: count(likeCount),
    comment_count: count(commentCount),
  };
  if (!body) return result;

  // The like button lives OUTSIDE the `f-item` but inside the enclosing
  // `f-single`, which is why this re-roots upward. When no `f-single` ancestor
  // exists the `f-item` is used, and the like search then usually finds nothing.
  let root = body;
  for (let parent = body.parent; parent; parent = parent.parent) {
    if (hasClass(parent, "f-single")) {
      root = parent;
      break;
    }
  }

  const bodyElements = findAll((node) => isContentNode(node, body), body.children);
  const metadata = bodyElements.find(
    (node) =>
      node.attribs["name"] === "feed_data" &&
      node.attribs["data-uin"] === String(uin) &&
      node.attribs["data-fkey"] === key,
  );
  if (appid === QZONE_APPID_SHUOSHUO && metadata?.attribs["data-tid"]) {
    result.tid = metadata.attribs["data-tid"];
  }

  const contentNodes = bodyElements.filter((node) => hasClass(node, "f-info"));
  // A complete post wins over an incomplete one even when the incomplete one
  // comes first: the CGI emits both for an edited post.
  const complete = contentNodes.find((node) => hasClass(node, "qz_info_complete") && text(node) !== "");
  const content = complete ?? contentNodes.find((node) => !hasClass(node, "qz_info_complete"));
  if (content) {
    result.content = text(content);
    result.content_complete =
      complete !== undefined ||
      findAll((node) => node.attribs["data-cmd"] === "qz_toggle", content.children).length === 0;
  }

  // A Set, so a photo offered under several URL variants is listed once; the
  // ORDER is first-seen, which preserves the post's own image order.
  const images = new Set<string>();
  for (const item of bodyElements.filter((node) => hasClass(node, "img-item"))) {
    // A video's cover is in the same grid and must not become a photo.
    if (item.attribs["data-v_itemid"] || item.attribs["data-videotype"]) continue;
    const full = imageUrl(item.attribs["data-originurl"] ?? item.attribs["data-url3"]);
    if (full) {
      images.add(full);
      continue;
    }
    // No data attribute: fall back to the rendered <img>, preferring the lazy
    // `truesrc` over the placeholder `src`.
    for (const image of findAll((node) => node.name === "img", item.children)) {
      const url = imageUrl(image.attribs["truesrc"] ?? image.attribs["src"]);
      if (url) images.add(url);
    }
  }
  result.images = [...images];

  const like = findAll((node) => hasClass(node, "qz_like_btn_v3") && isContentNode(node, root), root.children)[0];
  result.like_count ??= count(like?.attribs["data-likecnt"]);
  return result;
}