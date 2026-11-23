// Differential tests: the 群相册 (group-album) family vs the reference bundle.
//
// Same contract as `group-file-actions.test.ts` and `onebot-actions.test.ts`: the
// port's action and the bundle's own action run against the SAME fake context, and
// the two responses must be deep-equal.
//
// ---------------------------------------------------------------------------
// What is worth testing here, given that seven of nine are pass-throughs
// ---------------------------------------------------------------------------
// "Pass-through" is not "nothing to check". Three properties are invisible to the
// registry-wide schema loops in `onebot-actions.test.ts`:
//
//   1. **Argument order and the like flag.** `set_group_album_media_like` and
//      `cancel_group_album_media_like` are the same call with `true` / `false` in the
//      LAST position. Swapping them silently un-likes instead of liking, and both
//      still answer a plausible `{id, status}`. The test pins the recorded arguments,
//      not the response.
//
//   2. **`lloc || void 0`.** The two like actions rewrite a PRESENT `""` to
//      `undefined`, while `optional()` already maps absent to `undefined`. A port that
//      passed `""` would compile and answer the same thing (because `qunFeedCellId`
//      truth-tests both) — but a recording fake sees the difference, so this test
//      asserts the argument the reference actually sends.
//
//   3. **`get_qun_album_list`'s three renames.** The one action here that reshapes.
//      `album_list` / `attach_info` / `has_more` come from `albumList` / `attachInfo`
//      / `hasMore`, and the ITEMS are left untouched (they were already normalised by
//      the bridge). Re-mapping the items would double-normalise.
//
// The remaining jobs are the two "gotcha" assertions: that the seven pass-throughs
// really are pass-throughs (a sentinel object must survive unchanged, byte for byte,
// including key order), and that `upload_image_to_qun_album` answers `null` while
// calling the bridge exactly once.

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadActionOracle, oracleFor } from "./helpers/actions-oracle.js";
import { actionRegistry, dispatchAction } from "../src/onebot/actions/index.js";
import { groupAlbumActions, GROUP_ALBUM_ACTION_COUNT } from "../src/onebot/actions/group-album.js";
import type { ActionContext } from "../src/onebot/actions/context.js";

// ===========================================================================
// Fakes
// ===========================================================================

interface Call {
  path: string;
  args: unknown[];
}

/**
 * A recording `groupAlbum` slice.
 *
 * Each method answers a distinct sentinel so a test can tell WHICH method was called
 * from the RESPONSE alone — useful because a wrong method name often still produces a
 * well-formed envelope.
 */
function makeAlbumApi() {
  const calls: Call[] = [];
  const returning = (path: string, value: unknown) =>
    async (...args: unknown[]) => {
      calls.push({ path, args });
      return value;
    };

  // Deliberately camelCase keys: a port that "helpfully" renames them must fail.
  const mediaPage = {
    mediaList: [
      {
        type: 1,
        image: { name: "a.jpg", sloc: "s1", lloc: "l1", photoUrls: [{ spec: 1, url: { url: "u", width: 1, height: 2 } }], defaultUrl: null },
        video: null,
        uploader: "20002",
        batchId: "1700000000",
        uploadTime: "1700000001",
      },
    ],
    nextAttachInfo: "cursor-2",
  };
  const comment = {
    id: "c1",
    user: { uin: "20002" },
    content: [{ type: 1, content: "拍得很好" }],
    time: "1700000002",
    clientKey: "ck",
  };
  const likeResult = { id: "lk1", status: 0 };
  const albumPage = {
    albumList: [{ album_id: "al1", name: "活动照片", create_time: "1", last_upload_time: "2", upload_number: "3", cover: null }],
    attachInfo: "next-cursor",
    hasMore: true,
  };
  const legacyAlbums = [
    { id: "al1", name: "活动照片", picNum: 3, createTime: 1, desc: "", owner: "1", createuin: "1", createnickname: "n", last_upload_time: 2, cover: null },
  ];

  const api = {
    list: returning("list", legacyAlbums),
    listQun: returning("listQun", albumPage),
    upload: returning("upload", undefined),
    uploadVideo: returning("uploadVideo", { id: "video-1" }),
    getMediaList: returning("getMediaList", mediaPage),
    comment: returning("comment", comment),
    like: returning("like", likeResult),
    delete: returning("delete", { success: true }),
  };
  return { api, calls };
}

function makeCtx(albumApi: unknown, overrides: Partial<ActionContext> = {}): ActionContext {
  const base: ActionContext = {
    bridge: {
      identity: { uin: "10001", nickname: "bot", selfUid: "u_10001", groups: [] },
      apis: { groupAlbum: albumApi },
      receiveHealthy: true,
      getOnlineClients: () => null,
      sendRawPacket: async () => ({ success: true, gotResponse: true, responseData: null }),
      recallUploadedFile: () => undefined,
    } as unknown as ActionContext["bridge"],
    getLoginInfo: () => ({ userId: 10001, nickname: "bot" }),
    isOnline: () => true,
    getUptimeMs: () => 1,
    getMessage: async () => null,
    refreshMessageMedia: async () => {},
    getMessageMeta: async () => null,
    deleteMessage: async () => {},
    sendGroupMessage: async () => ({ messageId: 1 }),
    sendPrivateMessage: async () => ({ messageId: 1 }),
  };
  return { ...base, ...overrides } as ActionContext;
}

/** Run one action on both sides. */
async function both(
  name: string,
  params: Record<string, unknown>,
  ctx: ActionContext,
): Promise<{ mine: unknown; theirs: unknown; data: unknown }> {
  const spec = actionRegistry.resolve(name);
  assert.ok(spec?.action, `port has no action ${name}`);
  const mine = await spec.action.spec.toHandler(ctx)(params);
  const theirs = await oracleFor(name).toHandler(ctx as unknown as Record<string, unknown>)(params);
  assert.deepStrictEqual(mine, theirs, `${name}: response differs from the reference bundle`);
  return { mine, theirs, data: (mine as { data: unknown }).data };
}

// ===========================================================================
// 1. The family's shape
// ===========================================================================

test("group-album: 9 definitions, all registered, none an alias", () => {
  const oracle = loadActionOracle();
  assert.equal(GROUP_ALBUM_ACTION_COUNT, 9);
  assert.equal(groupAlbumActions.length, 9);
  assert.equal(oracle.groupAlbum.length, 9, "the bundle's actions$5 length");
  for (const spec of groupAlbumActions) {
    assert.equal(spec.names.length, 1, `${spec.names[0]}: must have no aliases`);
    assert.ok(actionRegistry.resolve(spec.names[0]!), `${spec.names[0]}: not registered`);
  }
  const registered = actionRegistry.actions.find((a) => a.canonical === "get_group_album_list");
  assert.equal(registered?.category, "群相册", "the reference's category string");
});

test("group-album: seven of nine declare no summary, and the port does not invent one", () => {
  // Measured against the bundle: only upload_video_to_qun_album and
  // del_group_album_media carry a summary.
  const withSummary = groupAlbumActions
    .map((s) => s.describe())
    .filter((d) => d.summary !== undefined)
    .map((d) => d.name)
    .sort();
  assert.deepStrictEqual(withSummary, ["del_group_album_media", "upload_video_to_qun_album"]);
  for (const spec of groupAlbumActions) {
    const mine = spec.describe();
    const theirs = oracleFor(mine.name).describe() as { summary?: string; returns?: string };
    assert.equal(mine.summary, theirs.summary, `${mine.name}: summary`);
    assert.equal(mine.returns, theirs.returns, `${mine.name}: returns`);
  }
});

// ===========================================================================
// 2. The two listings
// ===========================================================================

test("get_group_album_list: legacy array passes through untouched", async () => {
  const fake = makeAlbumApi();
  const ctx = makeCtx(fake.api);
  const { data } = await both("get_group_album_list", { group_id: 20001 }, ctx);
  // Same array contents AND same camel/mixed casing — the mixed casing is the
  // reference's `toLegacyAlbum` shape (`picNum` beside `createuin`), not a typo.
  assert.deepStrictEqual(data, [
    {
      id: "al1",
      name: "活动照片",
      picNum: 3,
      createTime: 1,
      desc: "",
      owner: "1",
      createuin: "1",
      createnickname: "n",
      last_upload_time: 2,
      cover: null,
    },
  ]);
  // Both sides called `list` with just the group id.
  const pair = fake.calls.slice(-2);
  assert.deepStrictEqual(pair, [
    { path: "list", args: [20001] },
    { path: "list", args: [20001] },
  ]);
});

test("get_qun_album_list: the three renames, with the ITEMS left alone", async () => {
  const fake = makeAlbumApi();
  const ctx = makeCtx(fake.api);
  const { data } = await both("get_qun_album_list", { group_id: 20001, attach_info: "c1" }, ctx);

  assert.deepStrictEqual(data, {
    album_list: [
      { album_id: "al1", name: "活动照片", create_time: "1", last_upload_time: "2", upload_number: "3", cover: null },
    ],
    attach_info: "next-cursor",
    has_more: true,
  });
  // The keys are exactly these three, in this order — no `albumList` left behind.
  assert.deepStrictEqual(Object.keys(data as object), ["album_list", "attach_info", "has_more"]);
  // The items are the SAME objects the API returned — no double normalisation. (The
  // sentinel comes from `makeAlbumApi`, so this compares against the API's own value
  // rather than against a second call, which would perturb the recorded call list.)
  const items = (data as { album_list: Record<string, unknown>[] }).album_list;
  assert.deepStrictEqual(Object.keys(items[0]!), [
    "album_id",
    "name",
    "create_time",
    "last_upload_time",
    "upload_number",
    "cover",
  ]);

  // And `attach_info` is forwarded verbatim, including the default "".
  const pair = fake.calls.slice(-2);
  assert.deepStrictEqual(pair.map((c) => c.args), [[20001, "c1"], [20001, "c1"]]);
  await both("get_qun_album_list", { group_id: 20001 }, ctx);
  assert.deepStrictEqual(fake.calls.slice(-2).map((c) => c.args), [[20001, ""], [20001, ""]]);
});

// ===========================================================================
// 3. The two uploads
// ===========================================================================

test("upload_image_to_qun_album: calls upload once and answers data null", async () => {
  const fake = makeAlbumApi();
  const ctx = makeCtx(fake.api);
  const { mine, data } = await both(
    "upload_image_to_qun_album",
    { group_id: 20001, album_id: "al1", album_name: "活动照片", file: "file:///p.png" },
    ctx,
  );
  assert.equal((mine as { status: string }).status, "ok");
  assert.equal(data, null, "the reference writes okResponse(null)");
  const pair = fake.calls.slice(-2);
  assert.deepStrictEqual(pair.map((c) => c.path), ["upload", "upload"]);
  assert.deepStrictEqual(pair[0]!.args, [20001, "al1", "活动照片", "file:///p.png"]);
  assert.deepStrictEqual(pair[0]!.args, pair[1]!.args);
});

test("upload_video_to_qun_album: {id} passes through, not renamed to video_id", async () => {
  const fake = makeAlbumApi();
  const ctx = makeCtx(fake.api);
  const { data } = await both(
    "upload_video_to_qun_album",
    { group_id: 20001, album_id: "al1", album_name: "活动视频", file: "file:///v.mp4" },
    ctx,
  );
  assert.deepStrictEqual(data, { id: "video-1" });
  assert.deepStrictEqual(Object.keys(data as object), ["id"], "the key is literally `id`");
  const pair = fake.calls.slice(-2);
  assert.deepStrictEqual(pair[0]!.args, [20001, "al1", "活动视频", "file:///v.mp4"]);
  assert.deepStrictEqual(pair[0]!.args, pair[1]!.args);
});

// ===========================================================================
// 4. The four pass-throughs
// ===========================================================================

test("get_group_album_media_list: {mediaList, nextAttachInfo} passes through in CAMELCASE", async () => {
  const fake = makeAlbumApi();
  const ctx = makeCtx(fake.api);
  const { data } = await both(
    "get_group_album_media_list",
    { group_id: 20001, album_id: "al1" },
    ctx,
  );
  // CamelCase here while the ALBUM list next door is snake_case. That inconsistency
  // is the reference's, and a "consistent" port would break clients reading
  // `nextAttachInfo`.
  assert.deepStrictEqual(Object.keys(data as object), ["mediaList", "nextAttachInfo"]);
  assert.equal((data as { nextAttachInfo: string }).nextAttachInfo, "cursor-2");
  const pair = fake.calls.slice(-2);
  assert.deepStrictEqual(pair[0]!.args, [20001, "al1", ""], "absent attach_info becomes \"\"");
  assert.deepStrictEqual(pair[0]!.args, pair[1]!.args);

  // A supplied cursor is forwarded verbatim.
  await both("get_group_album_media_list", { group_id: 20001, album_id: "al1", attach_info: "cur" }, ctx);
  assert.deepStrictEqual(fake.calls.slice(-2)[0]!.args, [20001, "al1", "cur"]);
});

test("do_group_album_comment: the comment object passes through untouched", async () => {
  const fake = makeAlbumApi();
  const ctx = makeCtx(fake.api);
  const { data } = await both(
    "do_group_album_comment",
    { group_id: 20001, album_id: "al1", lloc: "l1", content: "拍得很好" },
    ctx,
  );
  assert.deepStrictEqual(data, {
    id: "c1",
    user: { uin: "20002" },
    content: [{ type: 1, content: "拍得很好" }],
    time: "1700000002",
    clientKey: "ck",
  });
  const pair = fake.calls.slice(-2);
  assert.deepStrictEqual(pair[0]!.args, [20001, "al1", "l1", "拍得很好"]);
  assert.deepStrictEqual(pair[0]!.args, pair[1]!.args);
});

test("del_group_album_media: {success:true} passes through", async () => {
  const fake = makeAlbumApi();
  const ctx = makeCtx(fake.api);
  const { data } = await both("del_group_album_media", { group_id: 20001, album_id: "al1", lloc: "l1" }, ctx);
  assert.deepStrictEqual(data, { success: true });
  const pair = fake.calls.slice(-2);
  assert.deepStrictEqual(pair[0]!.args, [20001, "al1", "l1"]);
  assert.deepStrictEqual(pair[0]!.args, pair[1]!.args);
});

// ===========================================================================
// 5. The two likes — flag position and the `|| void 0` rewrite
// ===========================================================================

test("set_group_album_media_like passes isLike TRUE, cancel passes FALSE", async () => {
  const fake = makeAlbumApi();
  const ctx = makeCtx(fake.api);

  const set = await both("set_group_album_media_like", { group_id: 20001, album_id: "al1", batch_id: "1700000000", lloc: "l1" }, ctx);
  assert.deepStrictEqual(set.data, { id: "lk1", status: 0 });
  let pair = fake.calls.slice(-2);
  assert.equal(pair[0]!.path, "like");
  assert.equal(pair[0]!.path, pair[1]!.path);
  // Argument order: (group_id, album_id, batch_id, lloc, isLike)
  assert.deepStrictEqual(pair[0]!.args, [20001, "al1", "1700000000", "l1", true]);
  assert.deepStrictEqual(pair[0]!.args, pair[1]!.args, "the port and the bundle disagree on the like call");

  const cancel = await both("cancel_group_album_media_like", { group_id: 20001, album_id: "al1", batch_id: "1700000000", lloc: "l1" }, ctx);
  assert.deepStrictEqual(cancel.data, { id: "lk1", status: 0 });
  pair = fake.calls.slice(-2);
  assert.deepStrictEqual(pair[0]!.args, [20001, "al1", "1700000000", "l1", false]);
  assert.deepStrictEqual(pair[0]!.args, pair[1]!.args);

  // The ONE difference between the two actions is that last boolean. Assert it
  // directly so a swap is a named failure rather than a diff of two long arrays.
  assert.notEqual(
    (fake.calls.slice(-4)[0]!.args as unknown[])[4],
    (fake.calls.slice(-2)[0]!.args as unknown[])[4],
  );
});

test("the like actions rewrite a PRESENT empty lloc to undefined, as `lloc || void 0` does", async () => {
  const fake = makeAlbumApi();
  const ctx = makeCtx(fake.api);

  // Absent → undefined (via `optional()`).
  await both("set_group_album_media_like", { group_id: 20001, album_id: "al1", batch_id: "1" }, ctx);
  let pair = fake.calls.slice(-2);
  assert.equal(pair[0]!.args[3], undefined, "absent lloc must reach the bridge as undefined");

  // PRESENT but "" → ALSO undefined, because of the `||`. A port that passed the
  // empty string would still behave the same downstream (`qunFeedCellId` truth-tests
  // `!lloc`) but would disagree here, and that is the point of this assertion.
  await both("set_group_album_media_like", { group_id: 20001, album_id: "al1", batch_id: "1", lloc: "" }, ctx);
  pair = fake.calls.slice(-2);
  assert.equal(pair[0]!.args[3], undefined, "a present empty lloc must become undefined");
  assert.deepStrictEqual(pair[0]!.args, pair[1]!.args, "the port and the bundle disagree on lloc");

  // A real lloc survives.
  await both("set_group_album_media_like", { group_id: 20001, album_id: "al1", batch_id: "1", lloc: "L" }, ctx);
  assert.equal(fake.calls.slice(-2)[0]!.args[3], "L");

  // Same for the cancel twin.
  await both("cancel_group_album_media_like", { group_id: 20001, album_id: "al1", batch_id: "1", lloc: "" }, ctx);
  assert.equal(fake.calls.slice(-2)[0]!.args[3], undefined);
});

test("the like actions STRINGIFY a numeric batch_id rather than refusing it", async () => {
  const fake = makeAlbumApi();
  const ctx = makeCtx(fake.api);

  // 🔴 Measured, and the opposite of the obvious guess: `f.string()` does NOT reject a
  // number. The reference's `stringCore` is
  //
  //     if (typeof raw === "string") s = raw;
  //     else if (typeof raw === "number" || typeof raw === "boolean") s = String(raw);
  //     else return err(field, "expected a string");
  //
  // so `batch_id: 1700000000` becomes the STRING "1700000000" before `run` sees it,
  // and the bridge's `BigInt(batchId)` never has to parse a number. A port that
  // tightened this to strings-only would reject input the reference accepts.
  const { data } = await both(
    "set_group_album_media_like",
    { group_id: 20001, album_id: "al1", batch_id: 1700000000 },
    ctx,
  );
  assert.deepStrictEqual(data, { id: "lk1", status: 0 }, "a numeric batch_id must be ACCEPTED");
  let pair = fake.calls.slice(-2);
  assert.deepStrictEqual(pair[0]!.args, [20001, "al1", "1700000000", undefined, true]);
  assert.equal(typeof pair[0]!.args[2], "string", "the coerced value must be a string");
  assert.deepStrictEqual(pair[0]!.args, pair[1]!.args);

  // A numeric STRING reaches it unchanged.
  await both("set_group_album_media_like", { group_id: 20001, album_id: "al1", batch_id: "1700000000" }, ctx);
  pair = fake.calls.slice(-2);
  assert.equal(pair[0]!.args[2], "1700000000");
  assert.deepStrictEqual(pair[0]!.args, pair[1]!.args);

  // What IS refused: an empty string (`allowEmpty: false`) and a non-scalar.
  for (const bad of ["", {}, [], null]) {
    const mine = await actionRegistry.resolve("set_group_album_media_like")!.action!.spec.toHandler(ctx)({
      group_id: 20001,
      album_id: "al1",
      batch_id: bad,
    });
    const theirs = await oracleFor("set_group_album_media_like").toHandler(ctx as unknown as Record<string, unknown>)({
      group_id: 20001,
      album_id: "al1",
      batch_id: bad,
    });
    assert.deepStrictEqual(mine, theirs, `batch_id ${JSON.stringify(bad)}: rejection must match the bundle`);
    assert.equal((mine as { retcode: number }).retcode, 1400);
  }
});

// ===========================================================================
// 6. Required/empty validation, compared against the bundle
// ===========================================================================

test("the album mutators reject empty strings exactly where the bundle does", async () => {
  const fake = makeAlbumApi();
  const ctx = makeCtx(fake.api);

  // Every action whose params include one of these fields with allowEmpty:false.
  const cases: Array<{ name: string; params: Record<string, unknown>; field: string }> = [
    { name: "upload_image_to_qun_album", params: { group_id: 20001, album_id: "", album_name: "n", file: "f" }, field: "album_id" },
    { name: "upload_image_to_qun_album", params: { group_id: 20001, album_id: "a", album_name: "", file: "f" }, field: "album_name" },
    { name: "upload_video_to_qun_album", params: { group_id: 20001, album_id: "", album_name: "n", file: "f" }, field: "album_id" },
    { name: "get_group_album_media_list", params: { group_id: 20001, album_id: "" }, field: "album_id" },
    { name: "do_group_album_comment", params: { group_id: 20001, album_id: "a", lloc: "", content: "c" }, field: "lloc" },
    { name: "do_group_album_comment", params: { group_id: 20001, album_id: "a", lloc: "l", content: "" }, field: "content" },
    { name: "set_group_album_media_like", params: { group_id: 20001, album_id: "a", batch_id: "" }, field: "batch_id" },
    { name: "del_group_album_media", params: { group_id: 20001, album_id: "a", lloc: "" }, field: "lloc" },
  ];

  for (const c of cases) {
    const spec = actionRegistry.resolve(c.name)!.action!;
    const mine = await spec.spec.toHandler(ctx)(c.params);
    const theirs = await oracleFor(c.name).toHandler(ctx as unknown as Record<string, unknown>)(c.params);
    assert.deepStrictEqual(mine, theirs, `${c.name} / ${c.field}: validation must match the bundle`);
    assert.equal((mine as { retcode: number }).retcode, 1400, `${c.name} / ${c.field}: retcode`);
    assert.match(String((mine as { wording: string }).wording), new RegExp(c.field));
  }
  // None of the failures reached the bridge.
  assert.equal(fake.calls.length, 0, "a rejected parameter must not call the API");
});

// ===========================================================================
// 7. A bridge failure surfaces as retcode 100
// ===========================================================================

test("a throwing album API becomes retcode 100 with the API's own message", async () => {
  const message = "get group album list failed: result=1, error=nope";
  const ctx = makeCtx({
    list: async () => {
      throw new Error(message);
    },
  });
  const res = await dispatchAction(actionRegistry.bind(ctx), "get_group_album_list", { group_id: 20001 });
  assert.equal(res.status, "failed");
  assert.equal(res.retcode, 100, "an API throw is ACTION_FAILED, not BAD_REQUEST");
  assert.equal(res.wording, message, "the API's message must survive verbatim");
  assert.equal(res.data, null);
});