// `resolveRemoteMediaUrl` + `MediaUrlResolver` — turning cached media metadata into a
// live download URL.
//
// ===========================================================================
// Where this comes from
// ===========================================================================
//
// Port of the reference's `../onebot/src/media-url-resolver.ts`:
//
//   * `resolveRemoteMediaUrl` — reference:39757-39764 (4 lines, and every one of them
//     matters);
//   * `MediaUrlResolver` — reference:39765-39791.
//
// `resolveRemoteMediaUrl` is the single dispatch that answers "which OIDB command asks
// QQ for this voice/video's URL today". It has four arms and the arms are chosen by TWO
// independent questions — what kind of media, and which scene:
//
//                  group                          private
//     record       `getPttUrl(sessionId, node)`   `getPrivatePttUrl(node)`
//     video        `getVideoUrl(sessionId, node)` `getPrivateVideoUrl(node)`
//
// Note `type !== "record"` falls through to the VIDEO arms. That is the reference's own
// shape (`return isGroup ? api.getVideoUrl(...) : api.getPrivateVideoUrl(...)` after the
// record branch), and it is reproduced rather than "fixed": the only callers pass
// `"record"` or `"video"`, so a hypothetical `"image"` reaching here is a caller bug the
// reference lets surface as a video request. Adding an explicit branch would change the
// failure into a different failure and make the two ports diverge.
//
// ===========================================================================
// Two things the reference has that this port does not
// ===========================================================================
//
//  1. **The rkey cache.** `MediaUrlResolver.resolve` ends with
//     `this.rkeyCache.resolveMediaUrl(bridge, element, isGroup)` (reference:39782), which
//     appends `?rkey=…` to a CDN URL that needs one. There is no rkey cache in this port
//     — `ContactsApi.fetchDownloadRKeys` exists (the OIDB read) but nothing caches,
//     classifies by type, or composes the query. Rather than invent one, the cache is an
//     INJECTED SEAM: `MediaUrlResolver` takes it as its second constructor argument and
//     accepts `null`/`undefined`, in which case `resolve` answers the populated URL
//     verbatim. That is the reference's own fallback for an absent resolver
//     (`event-converters.ts:112` records the same choice for `imageUrlResolver`), and it
//     is visible in the answer: the URL simply has no `rkey`, so a CDN that requires one
//     returns 403 — a failure a caller can diagnose, not a fabricated URL.
//
//  2. **`bridge.apis.groupFile`'s three private/video arms.** The port's `GroupFileApi`
//     has `getPttUrl` and `getUrl`/`getPrivateUrl`; `getPrivatePttUrl`, `getVideoUrl` and
//     `getPrivateVideoUrl` are added by this port's media work because the OIDB specs
//     (`0x126d_200` / `0x11ea_200` / `0x11e9_200`, already in
//     `oidb/services/0x3639-offline.ts`) were wired but never exposed. They are wired, not
//     reimplemented — see `group-file.ts`.
//
// A missing arm therefore cannot be silently tolerated: `resolveRemoteMediaUrl` checks
// each method it is about to call and throws a sentence naming it. Without that check the
// failure would be `TypeError: api.getPrivatePttUrl is not a function`, which reads like a
// bug in this file rather than the absence it is.

import { createLogger } from "../onebot/log.js";
import type { MediaNodeLike } from "../oidb/services/0x126e.js";

const log = createLogger("OneBot");

/** The media kinds `resolveRemoteMediaUrl` dispatches on. */
export type RemoteMediaType = "record" | "video";

/**
 * The four `GroupFileApi` arms the dispatch needs, plus the two file arms `populateUrl`
 * uses. Declared structurally (not imported from `apis/group-file.ts`) so a test can hand
 * the resolver a fake without constructing a bridge, and so this module does not depend
 * on the whole bridge context.
 */
export interface GroupFileUrlApi {
  getPttUrl?(groupId: number, node: MediaNodeLike): Promise<string>;
  getPrivatePttUrl?(node: MediaNodeLike): Promise<string>;
  getVideoUrl?(groupId: number, node: MediaNodeLike): Promise<string>;
  getPrivateVideoUrl?(node: MediaNodeLike): Promise<string>;
  getUrl?(groupId: number, fileId: string, busId?: number): Promise<string>;
  getPrivateUrl?(userId: number, fileId: string, fileHash: string): Promise<string>;
}

/** The slice of a bridge the resolver reads. */
export interface MediaUrlBridge {
  readonly apis: {
    readonly groupFile?: GroupFileUrlApi;
  };
}

/**
 * reference:22832 `element` in `populateUrl`, narrowed to the fields the function reads.
 *
 * `url` is WRITTEN by `populateUrl` — the reference mutates the caller's element in place
 * (reference:39777-39790), and `MediaUrlResolver` is documented as doing the same, because
 * the caller feeds the same object to `rkeyCache.resolveMediaUrl` afterwards.
 */
export interface MediaUrlElement {
  type: string;
  url?: string | undefined;
  fileId?: string | undefined;
  fileHash?: string | undefined;
  mediaNode?: MediaNodeLike | undefined;
}

/** What `rkeyCache.resolveMediaUrl` must answer. See divergence 1 above. */
export interface MediaRKeyResolver {
  resolveMediaUrl(bridge: MediaUrlBridge, element: MediaUrlElement, isGroup: boolean): Promise<string> | string;
}

/**
 * The image-URL arm of the reference's `RKeyCache.resolveImageUrl` (reference:40210),
 * expressed as the function the reference actually passes around:
 * `converterCtx.imageUrlResolver` (reference:342774) is exactly
 * `(element, isGroup) => rkeyCache.resolveImageUrl(bridge, element, isGroup)`.
 *
 * The request is narrower than the port's `MessageSegment` union: `resolveImageUrl`
 * (reference:39834) only ever constructs `{ type: "image", imageUrl, subType }`, and
 * `MessageSegment`'s `ImageSegment` additionally REQUIRES `fileId`/`fileSize`/`width`/
 * `height`. Declaring the three fields the reference passes is the honest shape; a caller
 * whose resolver needs more can read them off its own cache.
 */
export interface ImageUrlRequest {
  readonly type: "image";
  readonly imageUrl: string;
  readonly subType: number | undefined;
}

export type ResolveImageUrl = (
  request: ImageUrlRequest,
  isGroup: boolean,
) => Promise<string | null | undefined> | string | null | undefined;

/**
 * reference:39757 `resolveRemoteMediaUrl`.
 *
 * `node` is the NTV2 media node read out of the cached metadata. A missing one is a hard
 * error and NOT a null: the caller (`get_record`, `get_msg`) has metadata for a media
 * resource it cannot address, which is a store-integrity problem worth a message.
 * `sessionId` is the GROUP NUMBER for a group message and the PEER's uin for a private one
 * — for the private arms it is unused, because those requests are addressed by the bot's
 * own uid (`resolveSelfUid`), exactly as the reference's signature shows.
 */
export async function resolveRemoteMediaUrl(
  bridge: MediaUrlBridge,
  type: RemoteMediaType,
  node: MediaNodeLike | null | undefined,
  isGroup: boolean,
  sessionId: number,
): Promise<string> {
  if (!node) throw new Error(`${type} media metadata is missing`);
  const api = bridge.apis.groupFile;
  if (!api) throw new Error(`cannot resolve ${type} media URL: the bridge exposes no groupFile API`);
  if (type === "record") {
    if (isGroup) return groupArm(api, "getPttUrl", sessionId, node);
    const method = api.getPrivatePttUrl;
    if (typeof method !== "function") {
      throw new Error(
        "cannot resolve media URL: GroupFileApi.getPrivatePttUrl is not implemented by this bridge",
      );
    }
    return method.call(api, node);
  }
  if (isGroup) return groupArm(api, "getVideoUrl", sessionId, node);
  const method = api.getPrivateVideoUrl;
  if (typeof method !== "function") {
    throw new Error(
      "cannot resolve media URL: GroupFileApi.getPrivateVideoUrl is not implemented by this bridge",
    );
  }
  return method.call(api, node);
}

/**
 * The two group arms have the same signature `(groupId, node)`, so they share one check.
 *
 * `api[arm]` is read through the interface rather than assumed: a fake bridge that omits
 * the arm must produce the named error, and `typeof !== "function"` is the only test that
 * survives an object built with a getter that returns `undefined`.
 */
async function groupArm(
  api: GroupFileUrlApi,
  arm: "getPttUrl" | "getVideoUrl",
  groupId: number,
  node: MediaNodeLike,
): Promise<string> {
  const method = api[arm];
  if (typeof method !== "function") {
    throw new Error(`cannot resolve media URL: GroupFileApi.${arm} is not implemented by this bridge`);
  }
  return method.call(api, groupId, node);
}

/**
 * reference:39834 `resolveImageUrl`.
 *
 * `null` means "no fresher URL than the one you have", which is how both callers treat it:
 * `getImageInfo` keeps `cached.url || cached.imageUrl`, and `refreshMessageMedia` leaves
 * the segment alone. Two distinct causes, both `null`: no cached row (or no `imageUrl` in
 * it), and no resolver injected.
 */
export async function resolveImageUrl(
  cached: { imageUrl?: string | undefined; subType?: number | undefined; isGroup?: boolean | undefined } | null | undefined,
  resolver: ResolveImageUrl | null | undefined,
): Promise<string | null> {
  if (!cached?.imageUrl || !resolver) return null;
  // `cached.isGroup === true`, not `cached.isGroup`: the reference passes the field
  // straight through (reference:39837), and its row type makes it optional. Every row
  // this port's indexer writes carries a boolean, so the `=== true` is a total-function
  // guard for a shape the store cannot produce — not a policy choice about a missing
  // scene. A record that somehow lacks it degrades to the PRIVATE arm, which is the arm
  // that needs no group id and therefore fails on a missing identifier instead of on a
  // wrong one.
  const url = await resolver(
    { type: "image", imageUrl: cached.imageUrl, subType: cached.subType },
    cached.isGroup === true,
  );
  return url == null || url === "" ? null : url;
}

/**
 * reference:39765 `MediaUrlResolver`.
 *
 * `resolve` does two things and the ORDER is the contract:
 *
 *   1. if the element has no `url` at all, ask QQ for one (`populateUrl`);
 *   2. run the result through the rkey cache.
 *
 * Step 1 is wrapped in its own try/catch: a voice whose node has expired must still get
 * its rkey treatment (and still get published to the caller with whatever URL it has), so
 * the failure is logged, not propagated. Step 2 is NOT guarded — an rkey cache that cannot
 * answer is a different class of failure, and the reference lets it throw.
 *
 * MUTATES the element (divergence note in `MediaUrlElement`): the reference assigns
 * `element.url` and then hands the same object to `resolveMediaUrl`, so a resolver that
 * reads the URL back sees the fresh one. `MessageSegment`'s `url` is writable for the same
 * reason; a copy would silently drop the populate step.
 */
export class MediaUrlResolver {
  readonly bridge: MediaUrlBridge;
  /** `null`/`undefined` = no rkey cache in this port. See divergence 1. */
  readonly rkeyCache: MediaRKeyResolver | null | undefined;

  constructor(bridge: MediaUrlBridge, rkeyCache?: MediaRKeyResolver | null) {
    this.bridge = bridge;
    this.rkeyCache = rkeyCache;
  }

  async resolve(element: MediaUrlElement, isGroup: boolean, sessionId: number): Promise<string> {
    if (!element.url) {
      try {
        await this.populateUrl(element, isGroup, sessionId);
      } catch (error) {
        log.warn(
          "media URL resolution failed type=%s is_group=%s: %s",
          element.type,
          isGroup,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    const url = element.url ?? "";
    if (!this.rkeyCache) return url;
    return this.rkeyCache.resolveMediaUrl(this.bridge, element, isGroup);
  }

  /**
   * reference:39774 `populateUrl`.
   *
   * Two arms, both keyed on the element type:
   *
   *   * a `file` with a `fileId`: group → `getUrl(sessionId, fileId)`; private →
   *     `getPrivateUrl(sessionId, fileId, fileHash)` **only when it has a hash**, else the
   *     EMPTY STRING. The `""` is the reference's own (`element.url = ""`) and it is a
   *     refusal, not a result: `0xe37_1200` cannot be requested without the file hash, and
   *     a URL of `""` is what every consumer already reads as "no URL".
   *   * a `record`/`video` with a `mediaNode`: the remote dispatch above.
   *
   * Anything else leaves `url` untouched — including a `record` WITHOUT a node, which is
   * the case `resolve` then reports as unresolved rather than as an error.
   */
  async populateUrl(element: MediaUrlElement, isGroup: boolean, sessionId: number): Promise<void> {
    const api = this.bridge.apis.groupFile;
    if (element.type === "file" && element.fileId) {
      if (!api?.getUrl) {
        throw new Error("cannot resolve file URL: GroupFileApi.getUrl is not implemented by this bridge");
      }
      if (!isGroup && !api.getPrivateUrl) {
        throw new Error(
          "cannot resolve file URL: GroupFileApi.getPrivateUrl is not implemented by this bridge",
        );
      }
      if (isGroup) element.url = await api.getUrl(sessionId, element.fileId);
      else if (element.fileHash) element.url = await api.getPrivateUrl!(sessionId, element.fileId, element.fileHash);
      else element.url = "";
      return;
    }
    if ((element.type === "record" || element.type === "video") && element.mediaNode) {
      element.url = await resolveRemoteMediaUrl(
        this.bridge,
        element.type,
        element.mediaNode,
        isGroup,
        sessionId,
      );
    }
  }
}
