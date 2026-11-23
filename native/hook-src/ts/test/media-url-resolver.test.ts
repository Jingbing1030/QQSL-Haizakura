// Tests for `ts/src/host/media-url-resolver.ts` — the four-arm media URL dispatch.
//
// ===========================================================================
// What these tests do and do not prove
// ===========================================================================
//
// **Do prove:** which OIDB arm each `(type, isGroup)` pair selects, that the group arms
// receive the session id while the private arms receive only the node, that a missing
// `mediaNode` is a named error rather than a silent empty URL, that `populateUrl` writes
// the URL back onto the caller's element, and that a failure to populate is logged and
// does NOT deny the answer.
//
// **Do NOT prove:** that QQ answers with a working URL. Every arm here is a fake; no
// packet, no container and no network is involved. A green run says the dispatch is
// wired, not that a voice will download.
//
// ===========================================================================
// Why the fakes record ARGUMENTS rather than just being called
// ===========================================================================
//
// The dispatch's whole content is the ARGUMENT SHAPE: `getPttUrl(sessionId, node)` vs
// `getPrivatePttUrl(node)`. A fake that only counted calls would pass even if the two
// were swapped, or if a private arm were handed a group id — and a group id sent as a
// `selfUid` produces a request the server answers with an opaque error, which is the
// worst kind of failure to debug. So each arm pushes its arguments and the tests assert
// them.

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  MediaUrlResolver,
  resolveImageUrl,
  resolveRemoteMediaUrl,
  type GroupFileUrlApi,
  type MediaUrlBridge,
  type MediaRKeyResolver,
} from "../src/host/media-url-resolver.js";
import type { MediaNodeLike } from "../src/oidb/services/0x126e.js";

// ===========================================================================
// Fixtures
// ===========================================================================

/** A media node with only the one field `normalizeMediaNode` requires. */
function node(uuid = "uuid-1"): MediaNodeLike {
  return { fileUuid: uuid };
}

interface Recorded {
  readonly arm: string;
  readonly args: readonly unknown[];
}

/**
 * A `groupFile` API whose every arm records its arguments and answers a distinct URL.
 *
 * `arms` is a MUTABLE `Record<string, unknown>` on purpose: several tests delete one arm to
 * prove the resolver names the missing method, and `exactOptionalPropertyTypes` refuses to
 * let a spread of `Partial<GroupFileUrlApi>` stay assignable to the interface (each
 * optional member would become `T[K] | undefined`, which is not what `?` means here). The
 * single cast below is therefore the honest form of "build a fake and then take a method
 * away", not a way around the type checker.
 */
function makeApi(arms: Record<string, unknown> = {}): {
  api: Record<string, unknown>;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const record = (arm: string, result: string) =>
    async (...args: unknown[]): Promise<string> => {
      calls.push({ arm, args });
      return result;
    };
  const api: Record<string, unknown> = {
    getPttUrl: record("getPttUrl", "https://cdn.example/group-ptt"),
    getPrivatePttUrl: record("getPrivatePttUrl", "https://cdn.example/private-ptt"),
    getVideoUrl: record("getVideoUrl", "https://cdn.example/group-video"),
    getPrivateVideoUrl: record("getPrivateVideoUrl", "https://cdn.example/private-video"),
    getUrl: record("getUrl", "https://cdn.example/file"),
    getPrivateUrl: record("getPrivateUrl", "https://cdn.example/private-file"),
    ...arms,
  };
  return { api, calls };
}

function makeBridge(api?: Record<string, unknown>): MediaUrlBridge {
  return { apis: { groupFile: (api ?? makeApi().api) as GroupFileUrlApi } };
}

const SESSION = 555;

// ===========================================================================
// 1. The four arms
// ===========================================================================

describe("resolveRemoteMediaUrl — the four-arm dispatch", () => {
  test("record + group calls getPttUrl(sessionId, node)", async () => {
    const { api, calls } = makeApi();
    const url = await resolveRemoteMediaUrl(makeBridge(api), "record", node(), true, SESSION);
    assert.equal(url, "https://cdn.example/group-ptt");
    assert.deepEqual(calls, [{ arm: "getPttUrl", args: [SESSION, node()] }]);
  });

  test("record + private calls getPrivatePttUrl(node) — NO session id", async () => {
    // `0x126d_200` is addressed by the bot's own uid (`resolveSelfUid`), so passing a
    // peer id here would be a parameter the command does not have. The arity assertion is
    // the point: `calls[0].args.length === 1`.
    const { api, calls } = makeApi();
    const url = await resolveRemoteMediaUrl(makeBridge(api), "record", node(), false, SESSION);
    assert.equal(url, "https://cdn.example/private-ptt");
    assert.deepEqual(calls, [{ arm: "getPrivatePttUrl", args: [node()] }]);
    assert.equal(calls[0]!.args.length, 1, "the private arm takes the node only");
  });

  test("video + group calls getVideoUrl(sessionId, node)", async () => {
    const { api, calls } = makeApi();
    const url = await resolveRemoteMediaUrl(makeBridge(api), "video", node(), true, SESSION);
    assert.equal(url, "https://cdn.example/group-video");
    assert.deepEqual(calls, [{ arm: "getVideoUrl", args: [SESSION, node()] }]);
  });

  test("video + private calls getPrivateVideoUrl(node) — NO session id", async () => {
    const { api, calls } = makeApi();
    const url = await resolveRemoteMediaUrl(makeBridge(api), "video", node(), false, SESSION);
    assert.equal(url, "https://cdn.example/private-video");
    assert.deepEqual(calls, [{ arm: "getPrivateVideoUrl", args: [node()] }]);
  });

  test("exactly ONE arm runs per call", async () => {
    // The dispatch is exclusive. A missing early return would run two commands and return
    // whichever resolved last, which is a real bug the argument assertions alone would not
    // catch (both arms would record a call).
    const { api, calls } = makeApi();
    await resolveRemoteMediaUrl(makeBridge(api), "record", node(), true, SESSION);
    assert.equal(calls.length, 1);
  });
});

// ===========================================================================
// 2. The refusals
// ===========================================================================

describe("resolveRemoteMediaUrl — a missing dependency is a NAMED error", () => {
  test("a missing mediaNode throws, naming the type", async () => {
    // Not an empty string: the metadata row exists but cannot be addressed, which is a
    // store-integrity problem the caller must see. `get_record` would otherwise answer a
    // URL-less record and report success.
    await assert.rejects(
      async () => await resolveRemoteMediaUrl(makeBridge(), "record", null, true, SESSION),
      /record media metadata is missing/,
    );
    await assert.rejects(
      async () => await resolveRemoteMediaUrl(makeBridge(), "video", undefined, false, SESSION),
      /video media metadata is missing/,
    );
  });

  test("a bridge with no groupFile slice throws a sentence naming the slice", async () => {
    // `TypeError: Cannot read properties of undefined` would read like a bug in this file
    // rather than the absence it is.
    await assert.rejects(
      async () => await resolveRemoteMediaUrl({ apis: {} }, "record", node(), true, SESSION),
      /the bridge exposes no groupFile API/,
    );
  });

  test("an arm the bridge does not implement throws, naming the METHOD", async () => {
    // A partially-ported `GroupFileApi` is the realistic failure: three of the four arms
    // were missing until this batch. Each must name itself so the next reader knows which
    // OIDB command to wire.
    const cases: readonly (readonly [string, "record" | "video", boolean, RegExp])[] = [
      ["getPttUrl", "record", true, /getPttUrl is not implemented/],
      ["getPrivatePttUrl", "record", false, /getPrivatePttUrl is not implemented/],
      ["getVideoUrl", "video", true, /getVideoUrl is not implemented/],
      ["getPrivateVideoUrl", "video", false, /getPrivateVideoUrl is not implemented/],
    ];
    for (const [arm, type, isGroup, pattern] of cases) {
      // `Record<string, unknown>` so a DELETED arm is representable: the interface marks
      // every member optional, which `exactOptionalPropertyTypes` will not let a spread
      // narrow to `undefined` incrementally.
      const api: Record<string, unknown> = { ...makeApi().api };
      delete api[arm];
      await assert.rejects(
        async () => await resolveRemoteMediaUrl(makeBridge(api), type, node(), isGroup, SESSION),
        pattern,
        `${arm} must refuse by name`,
      );
    }
  });

  test("a non-function arm (a getter answering undefined) still refuses by name", async () => {
    // `typeof !== "function"` rather than a truthiness check: an object whose property
    // exists but is `undefined` would slip past `if (api[arm])` in some shapes.
    const api = Object.create(makeApi().api) as Record<string, unknown>;
    Object.defineProperty(api, "getPttUrl", { value: undefined, enumerable: true });
    await assert.rejects(
      async () => await resolveRemoteMediaUrl(makeBridge(api), "record", node(), true, SESSION),
      /getPttUrl is not implemented/,
    );
  });
});

// ===========================================================================
// 3. `resolveImageUrl`
// ===========================================================================

describe("resolveImageUrl — null means 'keep what you have'", () => {
  test("null when there is no cached row", async () => {
    assert.equal(await resolveImageUrl(null, () => "https://fresh"), null);
    assert.equal(await resolveImageUrl(undefined, () => "https://fresh"), null);
  });

  test("null when the row carries no imageUrl", async () => {
    // A record/video row has no `imageUrl`; resolving it as an image would request the
    // wrong command.
    assert.equal(await resolveImageUrl({ subType: 0 }, () => "https://fresh"), null);
    assert.equal(await resolveImageUrl({ imageUrl: "" }, () => "https://fresh"), null);
  });

  test("null when no resolver is injected — the normal state in this port", async () => {
    assert.equal(await resolveImageUrl({ imageUrl: "https://cached" }, null), null);
    assert.equal(await resolveImageUrl({ imageUrl: "https://cached" }, undefined), null);
  });

  test("the resolver receives exactly the three fields the reference passes", async () => {
    // reference:39836-39839 — `{ type: "image", imageUrl, subType }, isGroup`.
    const seen: unknown[] = [];
    await resolveImageUrl(
      { imageUrl: "https://cached", subType: 7, isGroup: true },
      (request, isGroup) => {
        seen.push([request, isGroup]);
        return "https://fresh";
      },
    );
    assert.deepEqual(seen, [[{ type: "image", imageUrl: "https://cached", subType: 7 }, true]]);
  });

  test("an empty or null resolver answer degrades to null, not to ''", async () => {
    // `getImageInfo` tests `if (fresh)`, so both are equivalent there — but `null` is the
    // documented answer and a caller that string-concatenates benefits from it.
    assert.equal(await resolveImageUrl({ imageUrl: "https://cached" }, () => ""), null);
    assert.equal(await resolveImageUrl({ imageUrl: "https://cached" }, () => null), null);
    assert.equal(await resolveImageUrl({ imageUrl: "https://cached" }, () => undefined), null);
    assert.equal(await resolveImageUrl({ imageUrl: "https://cached" }, async () => "https://fresh"), "https://fresh");
  });

  test("a THROW propagates — the caller logs it", async () => {
    // `getImageInfo` catches and warns; `refreshMessageMedia` catches per segment. Neither
    // wants the failure swallowed here, because then nothing would be logged at all.
    await assert.rejects(
      async () =>
        await resolveImageUrl({ imageUrl: "https://cached" }, () => {
          throw new Error("rkey cache is empty");
        }),
      /rkey cache is empty/,
    );
  });
});

// ===========================================================================
// 4. `MediaUrlResolver`
// ===========================================================================

describe("MediaUrlResolver — populate, then rkey", () => {
  test("an element WITH a url is not populated", async () => {
    // The guard is `if (!element.url)`. Re-populating would refresh a URL the caller
    // deliberately supplied (a client-resolved one), which is a silent policy change.
    const { api, calls } = makeApi();
    const resolver = new MediaUrlResolver(makeBridge(api));
    const element = { type: "record", url: "https://already.example/x", mediaNode: node() };
    const url = await resolver.resolve(element, true, SESSION);
    assert.equal(url, "https://already.example/x");
    assert.deepEqual(calls, [], "no OIDB call for an element that already has a URL");
  });

  test("an element WITHOUT a url is populated through the dispatch", async () => {
    const { api, calls } = makeApi();
    const resolver = new MediaUrlResolver(makeBridge(api));
    const element: { type: string; url?: string; mediaNode?: MediaNodeLike } = {
      type: "record",
      mediaNode: node(),
    };
    const url = await resolver.resolve(element, true, SESSION);
    assert.equal(url, "https://cdn.example/group-ptt");
    assert.equal(element.url, "https://cdn.example/group-ptt", "populateUrl MUTATES the element");
    assert.equal(calls.length, 1);
  });

  test("a FILE element uses getUrl for a group", async () => {
    const { api, calls } = makeApi();
    const resolver = new MediaUrlResolver(makeBridge(api));
    const element = { type: "file", fileId: "fid-1" };
    const url = await resolver.resolve(element, true, SESSION);
    assert.equal(url, "https://cdn.example/file");
    assert.deepEqual(calls, [{ arm: "getUrl", args: [SESSION, "fid-1"] }]);
  });

  test("a PRIVATE file needs a fileHash; without one the URL becomes \"\" (a refusal)", async () => {
    // reference:39787-39789 — `else element.url = ""`. `0xe37_1200` cannot be requested
    // without the hash, and `""` is what every consumer reads as "no URL".
    const { api, calls } = makeApi();
    const resolver = new MediaUrlResolver(makeBridge(api));
    const element: { type: string; fileId?: string; fileHash?: string; url?: string } = {
      type: "file",
      fileId: "fid-1",
    };
    const url = await resolver.resolve(element, false, SESSION);
    assert.equal(url, "");
    assert.deepEqual(calls, [], "the private arm must not be called without a hash");
  });

  test("a PRIVATE file WITH a hash calls getPrivateUrl(sessionId, fileId, fileHash)", async () => {
    const { api, calls } = makeApi();
    const resolver = new MediaUrlResolver(makeBridge(api));
    const element = { type: "file", fileId: "fid-1", fileHash: "hash-1" };
    const url = await resolver.resolve(element, false, SESSION);
    assert.equal(url, "https://cdn.example/private-file");
    assert.deepEqual(calls, [{ arm: "getPrivateUrl", args: [SESSION, "fid-1", "hash-1"] }]);
  });

  test("a populate FAILURE is logged and does NOT deny the answer", async () => {
    // reference:39778-39780 — the try/catch exists so a voice whose node expired still
    // gets its rkey treatment and still answers. Propagating would turn a degraded
    // response into no response, which is a regression for every other segment.
    const api: Record<string, unknown> = {
      ...makeApi().api,
      getPttUrl: async () => {
        throw new Error("node expired");
      },
    };
    const resolver = new MediaUrlResolver(makeBridge(api));
    const element: { type: string; url?: string; mediaNode?: MediaNodeLike } = {
      type: "record",
      mediaNode: node(),
    };
    // Resolves, with no URL — not a rejection.
    assert.equal(await resolver.resolve(element, true, SESSION), "");
  });

  test("the rkey cache is consulted with the POPULATED element", async () => {
    // The order is the contract: `populateUrl` writes `element.url`, and the cache must
    // see the fresh value. A copy would hand the cache `undefined` and produce a bare URL.
    const { api } = makeApi();
    const seen: unknown[] = [];
    const rkeyCache: MediaRKeyResolver = {
      resolveMediaUrl: (_bridge, element, isGroup) => {
        seen.push([element.url, isGroup]);
        return `${String(element.url)}&rkey=abc`;
      },
    };
    const resolver = new MediaUrlResolver(makeBridge(api), rkeyCache);
    const element: { type: string; url?: string; mediaNode?: MediaNodeLike } = {
      type: "record",
      mediaNode: node(),
    };
    const url = await resolver.resolve(element, true, SESSION);
    assert.equal(url, "https://cdn.example/group-ptt&rkey=abc");
    assert.deepEqual(seen, [["https://cdn.example/group-ptt", true]]);
  });

  test("with NO rkey cache the URL is answered verbatim", async () => {
    // The port's normal state. A fabricated `rkey=` would produce a URL that looks signed
    // and still 403s — worse than an unsigned one, because the failure would blame the
    // CDN instead of this port.
    const { api } = makeApi();
    for (const cache of [null, undefined]) {
      const resolver = new MediaUrlResolver(makeBridge(api), cache);
      const element: { type: string; url?: string; mediaNode?: MediaNodeLike } = {
        type: "record",
        mediaNode: node(),
      };
      assert.equal(await resolver.resolve(element, true, SESSION), "https://cdn.example/group-ptt");
    }
  });

  test("an element with neither a fileId nor a mediaNode resolves to \"\" without a call", async () => {
    // `populateUrl` has no arm for it, so `url` stays absent and `resolve` answers `""`.
    // Asserting the absence of a call is the point: a `type`-based fallthrough (the
    // reference's `return isGroup ? getVideoUrl(...) : ...` after the record branch) would
    // send a VIDEO request for an unknown type.
    const { api, calls } = makeApi();
    const resolver = new MediaUrlResolver(makeBridge(api));
    assert.equal(await resolver.resolve({ type: "image" }, true, SESSION), "");
    assert.deepEqual(calls, []);
  });

  test("a VIDEO element populates through the video arms", async () => {
    const { api, calls } = makeApi();
    const resolver = new MediaUrlResolver(makeBridge(api));
    const element: { type: string; url?: string; mediaNode?: MediaNodeLike } = {
      type: "video",
      mediaNode: node("v-1"),
    };
    assert.equal(await resolver.resolve(element, false, SESSION), "https://cdn.example/private-video");
    assert.deepEqual(calls, [{ arm: "getPrivateVideoUrl", args: [node("v-1")] }]);
  });
});
