import { test } from "node:test";
import assert from "node:assert/strict";

import { loadActionOracle, oracleFor } from "./helpers/actions-oracle.js";

test("action oracle exposes all registered family names", () => {
  const oracle = loadActionOracle();
  const families: Array<[keyof typeof oracle, string[]]> = [
    ["qzone", ["get_qzone_profile", "set_qzone_profile", "get_qzone_msg_list", "get_qzone_msg_detail", "get_qzone_feeds", "send_qzone_msg", "delete_qzone_msg", "set_qzone_msg_right", "like_qzone", "unlike_qzone", "comment_qzone", "set_qzone_ban"]],
    ["qzonePublic", ["get_qzone_home_feeds", "get_qzone_feed_detail", "get_qzone_share_ark", "get_qzone_public_capabilities", "get_qzone_public_feeds", "get_qzone_public_feed_detail", "get_qzone_public_comments", "get_qzone_public_replies", "set_qzone_public_upvote", "set_qzone_public_like", "set_qzone_public_comment_like", "comment_qzone_public_feed", "reply_qzone_public_feed", "delete_qzone_public_comment", "delete_qzone_public_reply", "set_qzone_public_follow", "forward_qzone_public_feed"]],
    ["streamFile", ["upload_file_stream", "clean_stream_temp_file"]],
    ["streamDownload", ["download_file_stream", "download_file_image_stream", "download_file_record_stream", "test_download_stream"]],
    ["systemFace", ["fetch_sys_faces", "fetch_face_entity", "search_sys_faces", "fetch_super_face_id"]],
  ];
  for (const [family, names] of families) {
    const actions = oracle[family] as Array<{ names: readonly string[] }>;
    assert.deepStrictEqual(actions.map((action) => action.names[0]), names, family);
    for (const name of names) assert.equal(oracle.byName.get(name), oracleFor(name));
  }
});

test("request oracle exposes both canonical actions and their documented projections", () => {
  const oracle = loadActionOracle();
  const names = ["set_friend_add_request", "set_group_add_request"];

  assert.deepStrictEqual(oracle.request.map((action) => action.names[0]), names);
  for (const name of names) {
    assert.equal(oracle.byName.get(name), oracleFor(name));
  }

  const friend = oracleFor(names[0]!).describe();
  assert.equal(friend.name, "set_friend_add_request");
  assert.deepStrictEqual(friend.examples, [{
    summary: "处理好友添加请求",
    params: { flag: "<flag-from-friend-request-event>", approve: true },
    notes: "flag 必须原样使用当前账号好友请求事件的 flag，不能根据 QQ 号构造。",
  }]);
  assert.deepStrictEqual(friend.returnsSchema, {
    type: "null",
    description: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording",
  });
  assert.deepStrictEqual(
    (friend.params as Array<{ name: string; type: string; required: boolean; default?: unknown }>).map(
      ({ name, type, required, default: defaultValue }) => ({ name, type, required, default: defaultValue }),
    ),
    [
      { name: "flag", type: "string", required: true, default: undefined },
      { name: "approve", type: "bool", required: false, default: true },
    ],
  );

  const group = oracleFor(names[1]!).describe();
  assert.equal(group.name, "set_group_add_request");
  assert.deepStrictEqual(group.examples, [{
    summary: "处理加群请求",
    params: {
      flag: "<flag-from-group-request-event>",
      sub_type: "add",
      approve: true,
    },
    notes: "flag 和 sub_type 原样取自同一条群请求事件；邀请事件使用 invite。",
  }]);
  assert.deepStrictEqual(group.returnsSchema, {
    type: "null",
    description: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording",
  });
  assert.deepStrictEqual(
    (group.params as Array<{ name: string; type: string; required: boolean; default?: unknown }>).map(
      ({ name, type, required, default: defaultValue }) => ({ name, type, required, default: defaultValue }),
    ),
    [
      { name: "flag", type: "string", required: true, default: undefined },
      { name: "sub_type", type: "string", required: false, default: undefined },
      { name: "type", type: "string", required: false, default: undefined },
      { name: "approve", type: "bool", required: false, default: true },
      { name: "reason", type: "string", required: false, default: "" },
    ],
  );
});
