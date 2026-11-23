// The 个人空间 bridge API — `src/bridge/apis/qzone.ts` (158 lines).
//
// ---------------------------------------------------------------------------
// This class is a thin adapter, and that is the point
// ---------------------------------------------------------------------------
// Every method is `await this.ctx.apis.web.getCookies("qzone.qq.com")` followed by
// a call to one of the four web modules. There is no wire logic here at all, which
// is why the port was cheap: the behaviour lives in `web/qzone.ts` (the sixteen
// CGI endpoints), `web/qzone-public.ts` (the gotrpc JSON surface),
// `web/qzone-feed-content.ts` (HTML extraction) and `web/qzone-feed-cursor.ts`.
//
// The adapter's own responsibilities, and the only place to look for a bug after
// this file:
//
//   * which uin goes where — `targetUin` is normalised from a QQ number that may
//     arrive as 0 / NaN / a string, and the fallback is the BOT's own uin;
//   * that `like`/`comment` send the TARGET's uin as the feed owner but the BOT's
//     uin as the actor — swapping them likes the bot's own wall;
//   * that a reply refuses `richType`/`richval`, because the reply CGI has no image
//     support and ignoring them would silently drop the image.
//
// Reference: src/bridge/apis/qzone.ts, reference/index.mjs:337432.

import type { BridgeContext } from "../context.js";
import {
  commentQzoneMsg,
  deleteQzoneMsg,
  getQzoneFeeds,
  getQzoneMsgDetail,
  getQzoneMsgList,
  getQzoneProfile,
  publishQzoneMsg,
  replyQzoneComment,
  setQzoneBlack,
  setQzoneLike,
  setQzoneProfile,
  updateQzoneMsgRight,
  uploadQzoneImageFromSource,
  type PublishedQzoneMsg,
  type QzoneCommentResult,
  type QzoneFeedPage,
  type QzoneMsgDetail,
  type QzoneMsgList,
  type QzoneProfile,
  type QzoneReplyResult,
  type QzoneReplyTarget,
  type QzoneRoute,
  type QzoneUploadedImage,
} from "../web/qzone.js";
import {
  commentQzonePublicFeed,
  deleteQzonePublicComment,
  deleteQzonePublicReply,
  forwardQzonePublicFeed,
  getQzoneFeedDetail,
  getQzoneHomeFeeds,
  getQzonePublicCapabilities,
  getQzonePublicComments,
  getQzonePublicFeedDetail,
  getQzonePublicFeeds,
  getQzonePublicReplies,
  getQzoneShareArk,
  replyQzonePublicFeed,
  setQzonePublicCommentLike,
  setQzonePublicFollow,
  setQzonePublicLike,
  setQzonePublicUpvote,
  type QzoneShareArk,
} from "../web/qzone-public.js";

/** The cookie domain every method here reads. */
export const QZONE_COOKIE_DOMAIN = "qzone.qq.com";

/**
 * A uin argument as the reference's adapter accepts it.
 *
 * `targetUin > 0` is the test the reference uses, and it is why a `string` is
 * accepted: `"0" > 0` is `false` in JS, so a stringified zero correctly falls back
 * to the bot, while `Number(undefined) > 0` is `false` too. `NaN > 0` is likewise
 * `false`. Reproducing the coercion (rather than normalising up front) keeps
 * every call site's behaviour identical to the reference's.
 */
export type QzoneUin = number | string | undefined;

/** What `comment` takes as its reply target. */
export type QzoneReplyArgument = QzoneReplyTarget;

/**
 * The 个人空间 API.
 *
 * Methods mirror the reference one-for-one, including the parameter names, so a
 * caller being ported over does not have to relearn anything.
 */
export class QzoneApi {
  readonly #ctx: BridgeContext;

  constructor(ctx: BridgeContext) {
    this.#ctx = ctx;
  }

  /** One cookie fetch per call: the jar is not cached because a long-lived session outlives it. */
  #cookies(): Promise<Record<string, string>> {
    const web = this.#ctx.apis.web;
    if (!web) throw new Error("qzone api requires apis.web (cookie provider) to be attached");
    return web.getCookies(QZONE_COOKIE_DOMAIN);
  }

  /** `parseUin` — the reference's `uin && uin > 0 ? String(uin) : selfUin`. */
  #owner(targetUin: QzoneUin): string {
    return targetUin && Number(targetUin) > 0 ? String(targetUin) : this.#ctx.identity.uin;
  }

  // =========================================================================
  // Profile
  // =========================================================================

  /** Read a space's name/description; omitted `targetUin` means the bot's own. */
  async getProfile(targetUin?: QzoneUin): Promise<QzoneProfile> {
    return getQzoneProfile(await this.#cookies(), this.#ctx.identity.uin, this.#owner(targetUin));
  }

  /** Write the bot's own space name and/or description. */
  async setProfile(profile: { name?: string; description?: string }): Promise<void> {
    await setQzoneProfile(await this.#cookies(), this.#ctx.identity.uin, profile);
  }

  // =========================================================================
  // Public recommendations (空友)
  // =========================================================================

  async getPublicCapabilities(): Promise<Record<string, unknown>> {
    return getQzonePublicCapabilities(await this.#cookies(), this.#ctx.identity.uin);
  }

  async getPublicFeeds(cursor?: string): Promise<Record<string, unknown>> {
    return getQzonePublicFeeds(await this.#cookies(), this.#ctx.identity.uin, cursor);
  }

  async getHomeFeeds(targetUin?: QzoneUin, cursor?: string): Promise<Record<string, unknown>> {
    return getQzoneHomeFeeds(await this.#cookies(), this.#ctx.identity.uin, this.#owner(targetUin), cursor);
  }

  /** A 说说 by its 24-hex tid. */
  async getFeedDetail(tid: string): Promise<Record<string, unknown>> {
    return getQzoneFeedDetail(await this.#cookies(), tid);
  }

  async getShareArk(feed: Record<string, unknown>): Promise<QzoneShareArk> {
    return getQzoneShareArk(await this.#cookies(), feed);
  }

  async getPublicFeedDetail(feed: Record<string, unknown>): Promise<Record<string, unknown>> {
    return getQzonePublicFeedDetail(await this.#cookies(), feed);
  }

  async getPublicComments(feed: Record<string, unknown>, cursor: string): Promise<Record<string, unknown>> {
    return getQzonePublicComments(await this.#cookies(), feed, cursor);
  }

  async getPublicReplies(
    feed: Record<string, unknown>,
    comment: Record<string, unknown>,
    cursor = "",
    pageSize = 20,
  ): Promise<Record<string, unknown>> {
    return getQzonePublicReplies(await this.#cookies(), feed, comment, cursor, pageSize);
  }

  async setPublicUpvote(feed: Record<string, unknown>, enable = true): Promise<Record<string, unknown>> {
    return setQzonePublicUpvote(await this.#cookies(), feed, enable);
  }

  async setPublicLike(feed: Record<string, unknown>, enable = true): Promise<Record<string, unknown>> {
    return setQzonePublicLike(await this.#cookies(), feed, enable);
  }

  async setPublicCommentLike(
    feed: Record<string, unknown>,
    comment: Record<string, unknown>,
    enable = true,
    reply?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return setQzonePublicCommentLike(await this.#cookies(), feed, comment, enable, reply);
  }

  async commentPublicFeed(
    feed: Record<string, unknown>,
    content: string | unknown[],
  ): Promise<Record<string, unknown>> {
    return commentQzonePublicFeed(await this.#cookies(), feed, this.#self(), content);
  }

  async replyPublicFeed(
    feed: Record<string, unknown>,
    comment: Record<string, unknown>,
    content: string | unknown[],
    reply?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return replyQzonePublicFeed(await this.#cookies(), feed, this.#self(), comment, content, reply);
  }

  async deletePublicComment(
    feed: Record<string, unknown>,
    comment: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return deleteQzonePublicComment(await this.#cookies(), feed, comment);
  }

  async deletePublicReply(
    feed: Record<string, unknown>,
    comment: Record<string, unknown>,
    reply: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return deleteQzonePublicReply(await this.#cookies(), feed, comment, reply);
  }

  async setPublicFollow(feed: Record<string, unknown>, enable = true): Promise<Record<string, unknown>> {
    return setQzonePublicFollow(await this.#cookies(), feed, enable);
  }

  async forwardPublicFeed(feed: Record<string, unknown>, reason = ""): Promise<Record<string, unknown>> {
    return forwardQzonePublicFeed(await this.#cookies(), feed, reason);
  }

  /**
   * The author identity the public writers embed.
   *
   * `uid` is `selfUid ?? ""` rather than a throw: an un-warmed-up identity has no
   * uid yet, and the server accepts an empty one — it resolves the uid from the
   * uin. Throwing here would make every public comment fail for the first seconds
   * of a session.
   */
  #self(): Record<string, unknown> {
    return {
      uin: this.#ctx.identity.uin,
      uid: this.#ctx.identity.selfUid ?? "",
      nick: this.#ctx.identity.nickname,
    };
  }

  // =========================================================================
  // 说说
  // =========================================================================

  /** A page of 说说; `targetUin` omitted means the bot's own space. */
  async getMsgList(targetUin?: QzoneUin, pos = 0, num = 20): Promise<QzoneMsgList> {
    return getQzoneMsgList(await this.#cookies(), this.#owner(targetUin), pos, num);
  }

  /**
   * One 说说 and a page of comments.
   *
   * Note the DEFAULT differs from `getMsgList`: here an explicit `undefined`
   * means the bot's space while any other value (including `0`) is stringified
   * as-is. That asymmetry is the reference's, and it is why `0` reaches the CGI as
   * `"0"` rather than becoming the bot's uin.
   */
  async getMsgDetail(tid: string, targetUin?: QzoneUin, pos = 0, num = 20): Promise<QzoneMsgDetail> {
    const uin = targetUin === undefined ? this.#ctx.identity.uin : String(targetUin);
    return getQzoneMsgDetail(await this.#cookies(), uin, tid, pos, num);
  }

  /**
   * 好友动态.
   *
   * Always the BOT's own identity: this reads the bot's friends' updates, and a
   * `targetUin` would mean someone else's, which the CGI does not serve.
   */
  async getFeeds(pageNum = 1, count = 10, cursor?: string): Promise<QzoneFeedPage> {
    return getQzoneFeeds(await this.#cookies(), this.#ctx.identity.uin, pageNum, count, cursor);
  }

  /** Upload an image from `file://`, `http(s)://` or `base64://`. */
  async uploadImageFromSource(source: string): Promise<QzoneUploadedImage> {
    return uploadQzoneImageFromSource(await this.#cookies(), this.#ctx.identity.uin, source);
  }

  /**
   * 发表说说 to the bot's own space; returns the new tid.
   *
   * `richType`/`richval` are optional together (see `assertRichParams`); for a
   * multi-image post pass the `richval` strings from `uploadImageFromSource`
   * joined with `\t`.
   */
  async publish(
    content: string,
    richType?: number,
    richval?: string,
    ugcRight = 1,
    targetUins?: string,
  ): Promise<PublishedQzoneMsg> {
    return publishQzoneMsg(
      await this.#cookies(),
      this.#ctx.identity.uin,
      content,
      richType,
      richval,
      ugcRight,
      targetUins,
    );
  }

  /** Delete one of the bot's own 说说 by tid. */
  async delete(tid: string): Promise<void> {
    await deleteQzoneMsg(await this.#cookies(), this.#ctx.identity.uin, tid);
  }

  /** Change a 说说's view permission. */
  async updateRight(tid: string, ugcRight: number, targetUins?: string): Promise<{ ugc_right: number }> {
    return updateQzoneMsgRight(await this.#cookies(), this.#ctx.identity.uin, tid, ugcRight, targetUins);
  }

  /**
   * Like or unlike a 说说.
   *
   * The two uins have different roles and must not be swapped: `owner` is whose
   * wall the 说说 is on (used for the `unikey` URL), `selfUin` is the actor (used
   * for `opuin` and `qzreferrer`). Passing the bot as both likes the bot's own
   * wall instead of the friend's.
   */
  async like(tid: string, targetUin: QzoneUin, like: boolean, abstime = 0): Promise<void> {
    const selfUin = this.#ctx.identity.uin;
    await setQzoneLike(await this.#cookies(), selfUin, this.#owner(targetUin), tid, like, abstime);
  }

  /**
   * Comment on a 说说, or reply inside its comment thread.
   *
   * A `reply` and rich parameters are mutually exclusive: the reply CGI
   * (`emotion_cgi_addreply_ugc`) has no image support, and silently dropping a
   * supplied image would post a reply the caller believes had a picture.
   */
  async comment(
    tid: string,
    content: string,
    targetUin?: QzoneUin,
    richType?: number,
    richval?: string,
    reply?: QzoneReplyArgument,
  ): Promise<QzoneCommentResult | QzoneReplyResult> {
    if (reply !== undefined && (richType !== undefined || richval !== undefined)) {
      throw new Error("images are not supported for Qzone comment replies");
    }
    const selfUin = this.#ctx.identity.uin;
    const owner = this.#owner(targetUin);
    const cookieObject = await this.#cookies();
    if (reply !== undefined) {
      return replyQzoneComment(cookieObject, selfUin, owner, tid, content, reply);
    }
    return commentQzoneMsg(cookieObject, selfUin, owner, tid, content, richType, richval);
  }

  /** 拉黑/解除拉黑 a user in the bot's own space. */
  async setBlack(targetUin: QzoneUin, ban: boolean): Promise<void> {
    if (!targetUin || !Number(targetUin)) throw new Error("targetUin is required");
    await setQzoneBlack(await this.#cookies(), this.#ctx.identity.uin, String(targetUin), ban);
  }

  /**
   * The two HTTP routes `getMsgList` may use, exposed for diagnostics.
   *
   * Not in the reference. A caller debugging a `-10000` needs to see WHICH host
   * pair answered, and that fact is otherwise only in a log line.
   */
  async describeMsgListRoutes(targetUin: QzoneUin, pos = 0, num = 20): Promise<{ legacy: QzoneRoute; fallback: QzoneRoute }> {
    const cookies = await this.#cookies();
    const owner = this.#owner(targetUin);
    const [{ legacyMsgListRoute, userMsgListRoute }, { getBknFromCookie }] = await Promise.all([
      import("../web/qzone.js"),
      import("../web/request-util.js"),
    ]);
    const bkn = getBknFromCookie(cookies);
    return {
      legacy: legacyMsgListRoute(cookies, owner, pos, num, bkn),
      fallback: userMsgListRoute(cookies, owner, pos, num, bkn),
    };
  }
}