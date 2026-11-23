import { test } from "node:test";
import assert from "node:assert/strict";

import { qzoneActions, QZONE_ACTION_COUNT } from "../src/onebot/actions/qzone.js";
import { qzonePublicActions, QZONE_PUBLIC_ACTION_COUNT } from "../src/onebot/actions/qzone-public.js";
import type { ActionContext } from "../src/onebot/actions/context.js";

const legacyNames = [
  "get_qzone_profile",
  "set_qzone_profile",
  "get_qzone_msg_list",
  "get_qzone_msg_detail",
  "get_qzone_feeds",
  "send_qzone_msg",
  "delete_qzone_msg",
  "set_qzone_msg_right",
  "like_qzone",
  "unlike_qzone",
  "comment_qzone",
  "set_qzone_ban",
];

const publicNames = [
  "get_qzone_home_feeds",
  "get_qzone_feed_detail",
  "get_qzone_share_ark",
  "get_qzone_public_capabilities",
  "get_qzone_public_feeds",
  "get_qzone_public_feed_detail",
  "get_qzone_public_comments",
  "get_qzone_public_replies",
  "set_qzone_public_upvote",
  "set_qzone_public_like",
  "set_qzone_public_comment_like",
  "comment_qzone_public_feed",
  "reply_qzone_public_feed",
  "delete_qzone_public_comment",
  "delete_qzone_public_reply",
  "set_qzone_public_follow",
  "forward_qzone_public_feed",
];

function fakeContext(api: Record<string, (...args: unknown[]) => unknown>): ActionContext {
  return {
    bridge: { apis: { qzone: api } } as unknown as ActionContext["bridge"],
  } as ActionContext;
}

test("QZone sources contain exactly the reference's 12 + 17 definitions", () => {
  assert.equal(QZONE_ACTION_COUNT, 12);
  assert.equal(qzoneActions.length, 12);
  assert.equal(QZONE_PUBLIC_ACTION_COUNT, 17);
  assert.equal(qzonePublicActions.length, 17);
  assert.deepStrictEqual(qzoneActions.map((action) => action.names[0]), legacyNames);
  assert.deepStrictEqual(qzonePublicActions.map((action) => action.names[0]), publicNames);

  for (const action of [...qzoneActions, ...qzonePublicActions]) {
    assert.equal(action.names.length, 1, `${action.names[0]} has no aliases in reference`);
    const doc = action.describe();
    assert.equal(doc.name, action.names[0]);
    assert.deepStrictEqual(doc.aliases, []);
    assert.equal(doc.readOnly, new Set([
      "get_qzone_profile", "get_qzone_msg_list", "get_qzone_msg_detail", "get_qzone_feeds",
      "get_qzone_home_feeds", "get_qzone_feed_detail", "get_qzone_public_capabilities",
      "get_qzone_public_feeds", "get_qzone_public_feed_detail", "get_qzone_public_comments",
      "get_qzone_public_replies",
    ]).has(doc.name));
  }
});

test("QZone describe projections preserve field order and reference defaults", () => {
  const byName = new Map([...qzoneActions, ...qzonePublicActions].map((action) => [action.names[0]!, action.describe()]));
  const params = (name: string) => byName.get(name)!.params;
  const signature = (name: string) => params(name).map(({ name: field, required, default: value }) => [field, required, value]);

  assert.deepStrictEqual(signature("get_qzone_msg_list"), [["target_uin", false, undefined], ["pos", false, 0], ["num", false, 20]]);
  assert.deepStrictEqual(signature("get_qzone_msg_detail"), [["tid", true, undefined], ["target_uin", false, undefined], ["pos", false, 0], ["num", false, 20]]);
  assert.deepStrictEqual(signature("send_qzone_msg"), [["content", true, undefined], ["images", false, undefined], ["ugc_right", false, 1], ["target_uins", false, undefined]]);
  assert.deepStrictEqual(signature("get_qzone_public_replies"), [["feed", true, undefined], ["comment", true, undefined], ["cursor", false, ""], ["page_size", false, 20]]);
  assert.deepStrictEqual(signature("set_qzone_public_comment_like"), [["feed", true, undefined], ["comment", true, undefined], ["enable", false, true], ["reply", false, undefined]]);
  assert.deepStrictEqual(signature("forward_qzone_public_feed"), [["feed", true, undefined], ["reason", false, ""]]);
  assert.deepStrictEqual(params("get_qzone_feed_detail")[0]!.schema, { type: "string", minLength: 1, maxLength: 24 });
});

test("legacy QZone writes preserve upload joins, flags, targeting and response values", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const value = { marker: "result" };
  const record = (method: string) => async (...args: unknown[]) => {
    calls.push({ method, args });
    return value;
  };
  const api = {
    setProfile: record("setProfile"),
    uploadImageFromSource: async (source: unknown) => ({ richval: `rv:${source}`, url: `url:${source}` }),
    publish: record("publish"), delete: record("delete"), like: record("like"),
    comment: record("comment"), setBlack: record("setBlack"),
  };
  const ctx = fakeContext(api);
  const handle = (name: string) => [...qzoneActions].find((action) => action.names[0] === name)!.toHandler(ctx);

  assert.deepStrictEqual(await handle("send_qzone_msg")({ content: "hello", images: ["a", "b"], ugc_right: 16, target_uins: [10, 20] }), {
    status: "ok", retcode: 0, data: value,
  });
  assert.deepStrictEqual(calls.pop(), { method: "publish", args: ["hello", 1, "rv:a\trv:b", 16, "10|20"] });

  await handle("like_qzone")({ tid: "t", abstime: 123 });
  assert.deepStrictEqual(calls.pop(), { method: "like", args: ["t", undefined, true, 123] });
  await handle("unlike_qzone")({ tid: "t", abstime: 123 });
  assert.deepStrictEqual(calls.pop(), { method: "like", args: ["t", undefined, false, 123] });
  await handle("delete_qzone_msg")({ tid: "t" });
  assert.deepStrictEqual(calls.pop(), { method: "delete", args: ["t"] });
});

test("recommendation QZone actions pass complete upstream objects through unchanged", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const sentinel = { untouched: { nested: [1, "x"] } };
  const api = new Proxy({}, {
    get: (_target, property: string) => async (...args: unknown[]) => {
      calls.push({ method: property, args });
      return sentinel;
    },
  }) as Record<string, (...args: unknown[]) => unknown>;
  const ctx = fakeContext(api);
  const feed = { cell_common: { union_id: { feed_id: "f" } }, unknown_upstream_field: true };
  const comment = { id: "c", user: { uin: "10" }, unknown: [1] };

  const detail = qzonePublicActions.find((action) => action.names[0] === "get_qzone_public_feed_detail")!;
  const result = await detail.toHandler(ctx)({ feed });
  assert.deepStrictEqual(result, { status: "ok", retcode: 0, data: sentinel });
  assert.deepStrictEqual(calls.pop(), { method: "getPublicFeedDetail", args: [feed] });

  const replies = qzonePublicActions.find((action) => action.names[0] === "get_qzone_public_replies")!;
  await replies.toHandler(ctx)({ feed, comment });
  assert.deepStrictEqual(calls.pop(), { method: "getPublicReplies", args: [feed, comment, "", 20] });

  const commentLike = qzonePublicActions.find((action) => action.names[0] === "set_qzone_public_comment_like")!;
  await commentLike.toHandler(ctx)({ feed, comment });
  assert.deepStrictEqual(calls.pop(), { method: "setPublicCommentLike", args: [feed, comment, true, undefined] });
});
