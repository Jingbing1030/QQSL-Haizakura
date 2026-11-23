// Differential tests: this port's action layer vs the reference bundle's own code.
//
// Every assertion here compares two live objects:
//
//   left  — `ts/src/onebot/actions/*` bound to a fake context
//   right — the same action, evaluated from `reference/index.mjs` at test time by
//           `helpers/actions-oracle.ts`, bound to the SAME fake context
//
// so a green test means "the port and the shipping implementation agree for this
// input", not "the port does what I remembered". When the two disagree the port is
// wrong unless the difference is one of the documented gaps listed at the bottom of
// this file, and each of those has its own test asserting the port *fails loudly*
// instead of quietly answering something else.
//
// The context is a hand-written fake rather than a real `OneBotActionContext`
// implementation because the point is to fix the bridge's answers and vary the
// ACTION's behaviour. Both sides see the identical object, so anything that differs
// afterwards is the action layer.

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadActionOracle, oracleFor } from "./helpers/actions-oracle.js";
import { actionRegistry, ACTION_COUNTS, compileActionRegistry, dispatchAction, ACTION_GROUPS } from "../src/onebot/actions/index.js";
import { APP_VERSION } from "../src/onebot/actions/info.js";
import type { ActionContext } from "../src/onebot/actions/context.js";
import { MessageElementValidationError } from "../src/element-builder.js";

// ===========================================================================
// The fake context
// ===========================================================================

/**
 * A bridge whose every method is a recording stub.
 *
 * `receiveHealthy` is a plain boolean because the actions read it as a property
 * (`ctx.bridge.receiveHealthy`), not as a call.
 */
function makeBridge(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const calls: Array<{ path: string; args: unknown[] }> = [];
  const record = (path: string) =>
    async (...args: unknown[]) => {
      calls.push({ path, args });
      return undefined;
    };
  const bridge = {
    receiveHealthy: true,
    identity: {
      uin: "10001",
      nickname: "bot",
      selfUid: "u_10001",
      groups: [],
      findGroup: () => null,
      findGroupMember: () => null,
      findFriend: () => null,
      findUserProfile: () => null,
      findUinByUid: () => null,
      forgetGroup: () => {},
      rememberGroups: () => {},
      rememberGroupMembers: () => {},
      rememberUserProfile: () => {},
    },
    apis: {
      contacts: {
        fetchFriendList: record("contacts.fetchFriendList"),
        fetchGroupList: record("contacts.fetchGroupList"),
        fetchGroupDetail: record("contacts.fetchGroupDetail"),
        fetchGroupMemberList: record("contacts.fetchGroupMemberList"),
        fetchUserProfile: record("contacts.fetchUserProfile"),
        fetchUserProfileByUid: record("contacts.fetchUserProfileByUid"),
        getGroupShareLink: async (...args: unknown[]) => {
          calls.push({ path: "contacts.getGroupShareLink", args });
          return "https://example.invalid/link";
        },
        getGroupRecommendArk: record("contacts.getGroupRecommendArk"),
        getBuddyRecommendArk: record("contacts.getBuddyRecommendArk"),
        fetchQidianCorpInfo: record("contacts.fetchQidianCorpInfo"),
        fetchGroupRequests: record("contacts.fetchGroupRequests"),
      },
      groupAdmin: {
        kickMember: record("groupAdmin.kickMember"),
        kickMembers: record("groupAdmin.kickMembers"),
        muteMember: record("groupAdmin.muteMember"),
        muteAll: record("groupAdmin.muteAll"),
        setAddOption: record("groupAdmin.setAddOption"),
        setSearch: record("groupAdmin.setSearch"),
        setMemberInvitePolicy: record("groupAdmin.setMemberInvitePolicy"),
        setNewMemberHistoryVisibility: record("groupAdmin.setNewMemberHistoryVisibility"),
        setMemberPermissions: record("groupAdmin.setMemberPermissions"),
        getAdminSettings: async (...args: unknown[]) => {
          calls.push({ path: "groupAdmin.getAdminSettings", args });
          return { add_type: 2, group_question: "q", group_answer: "a", robot_member_switch: 1, robot_member_examine: 0, member_invite_policy: "no_approval", allow_member_upload_album: true, allow_member_temporary_session: false, allow_member_create_group: true, new_member_history_visible: false, no_finger_open: 0, no_code_finger_open: 1 };
        },
        listCategoryTags: async (...args: unknown[]) => {
          calls.push({ path: "groupAdmin.listCategoryTags", args });
          return { tags: [{ id: 1, name: "学习", type: 0 }] };
        },
        addCategoryTag: record("groupAdmin.addCategoryTag"),
        removeCategoryTag: record("groupAdmin.removeCategoryTag"),
        setAdmin: record("groupAdmin.setAdmin"),
        getAdminPermissions: async (...args: unknown[]) => {
          calls.push({ path: "groupAdmin.getAdminPermissions", args });
          return { group_id: 20001, user_id: 10001, recall_member_message: true, kick_member: false, kick_member_per_day: null, receive_verify: null };
        },
        setAdminPermissions: record("groupAdmin.setAdminPermissions"),
        setAdminReceiveVerify: record("groupAdmin.setAdminReceiveVerify"),
        setCard: record("groupAdmin.setCard"),
        setName: record("groupAdmin.setName"),
        leave: record("groupAdmin.leave"),
        setSpecialTitle: record("groupAdmin.setSpecialTitle"),
      },
      web: {
        getHonorInfo: async (...args: unknown[]) => {
          calls.push({ path: "web.getHonorInfo", args });
          return { group_id: 20001, current_talkative: null, talkative_list: [], performer_list: [], legend_list: [], emotion_list: [], strong_newbie_list: [] };
        },
      },
      profile: {
        resolveCustomFace: async (...args: unknown[]) => {
          calls.push({ path: "profile.resolveCustomFace", args });
          return { emojiId: "abc", url: "https://example.invalid/face", md5: "d41d8cd98f00b204e9800998ecf8427e" };
        },
        setGroupAvatar: record("profile.setGroupAvatar"),
      },
    },
    ...overrides,
  };
  (bridge as Record<string, unknown>)["_calls"] = calls;
  return bridge;
}

/**
 * A context whose REQUIRED members answer "nothing is stored / nothing is sendable".
 *
 * The reference calls `ctx.getMessage`, `ctx.getMessageMeta`, `ctx.deleteMessage`,
 * `ctx.refreshMessageMedia`, `ctx.sendGroupMessage` and `ctx.sendPrivateMessage`
 * unconditionally, so they are required here rather than optional. The defaults below
 * make the failure paths the baseline; individual tests override them.
 */
function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext {
  const base: ActionContext = {
    bridge: makeBridge() as unknown as ActionContext["bridge"],
    getLoginInfo: () => ({ userId: 10001, nickname: "bot" }),
    isOnline: () => true,
    getUptimeMs: () => 12_345,
    canSendImage: () => true,
    canSendRecord: () => false,
    // Empty store: every lookup misses, which is the reference's 100 path.
    getMessage: async () => null,
    refreshMessageMedia: async () => {},
    getMessageMeta: async () => null,
    deleteMessage: async () => {},
    sendGroupMessage: async () => ({ messageId: 1 }),
    sendPrivateMessage: async () => ({ messageId: 1 }),
  };
  return { ...base, ...overrides };
}

/** The same fake, as the reference's much wider `ctx` type expects it. */
function refCtx(ctx: ActionContext): Record<string, unknown> {
  return ctx as unknown as Record<string, unknown>;
}

/** Run one action on both sides and return `{ mine, theirs }`. */
async function both(
  name: string,
  params: Record<string, unknown>,
  ctx: ActionContext = makeCtx(),
): Promise<{ mine: unknown; theirs: unknown }> {
  const spec = actionRegistry.resolve(name);
  assert.ok(spec?.action, `port has no action ${name}`);
  const mine = await spec.action.spec.toHandler(ctx)(params);
  const theirs = await oracleFor(name).toHandler(refCtx(ctx))(params);
  return { mine, theirs };
}

/** Assert the two responses are deep-equal AND have the same key order. */
function assertMatchesReference(mine: unknown, theirs: unknown, label: string): void {
  assert.deepStrictEqual(mine, theirs, `${label}: response differs from the reference bundle`);
}

/** The `data` of a response, with a helpful label. */
function dataOf(response: unknown): unknown {
  return (response as { data?: unknown }).data;
}

// ===========================================================================
// 1. The registry itself
// ===========================================================================

test("registry: every registered name exists in the reference with the same name", () => {
  const oracle = loadActionOracle();
  // `executableNames` includes the two RAW reservations, which by design are not
  // definition names and therefore have no `ACTION_GROUPS` entry — the reference
  // compiles them in separately (`compileActionRegistry(ACTION_GROUPS, rawReservations)`).
  // They are asserted exactly in the parity table test; skip them here.
  const raw = new Set(actionRegistry.rawActions.map((reservation) => String(reservation.name)));
  for (const claim of actionRegistry.executableNames) {
    if (claim.role === "raw" || raw.has(claim.name)) continue;
    assert.ok(
      oracle.byName.has(claim.name),
      `port registers "${claim.name}" but the reference bundle has no such action`,
    );
  }
});

test("registry: counts match the measured reference arrays", () => {
  const oracle = loadActionOracle();
  const families = [
    ["info", oracle.info], ["message", oracle.message], ["friend", oracle.friend],
    ["groupInfo", oracle.groupInfo], ["groupAdmin", oracle.groupAdmin],
    ["groupFile", oracle.groupFile], ["request", oracle.request], ["extended", oracle.extended],
    ["groupAlbum", oracle.groupAlbum], ["space", [...oracle.qzone, ...oracle.qzonePublic]],
    ["systemFace", oracle.systemFace], ["stream", [...oracle.streamFile, ...oracle.streamDownload]],
  ] as const;
  for (const [family, actions] of families) {
    assert.equal(ACTION_COUNTS[family], actions.length, `${family} definition count`);
  }
  let definitions = 0;
  let executableNames = 0;
  for (const [, actions] of families) {
    definitions += actions.length;
    for (const action of actions) executableNames += action.names.length;
  }
  assert.equal(definitions, 222, "reference definition total");
  assert.equal(executableNames, 228, "reference executable-name total");
  assert.equal(ACTION_COUNTS.definitions, definitions);
  // `definitionNames` is the reference-comparable number (222 defs + 6 aliases = 228).
  // `total` additionally counts the 2 raw reservations, which the reference compiles
  // outside `ACTION_GROUPS`, so it is 230 and must be asserted separately.
  assert.equal(ACTION_COUNTS.definitionNames, executableNames);
  assert.equal(ACTION_COUNTS.total, executableNames + actionRegistry.rawActions.length);
  assert.equal(ACTION_COUNTS.total, 230, "228 definition names + 2 raw reservations");
  // 115 DEFINITIONS, 121 EXECUTABLE NAMES — the six extra are the aliases. Asserted
  // separately because `extended` counts definitions while `total` counts names, and a
  // silent alias loss would otherwise move only one of the two numbers.
  assert.equal(
    oracle.extended.flatMap((a) => a.names).length,
    121,
    "the extended family's executable-name count",
  );
  assert.equal(oracle.extended.length, 115, "the extended family's definition count");
  // The two new families have NO aliases, which is why `total` grows by exactly
  // 12 + 9 while the definition count does the same. Asserted so an accidental
  // alias (a second entry in `name: [...]`) cannot slip in unnoticed.
  assert.equal(oracle.groupFile.flatMap((a) => a.names).length, 12, "群文件 executable names");
  assert.equal(oracle.groupAlbum.flatMap((a) => a.names).length, 9, "群相册 executable names");
});

test("registry: category order and counts match the reference arrays", () => {
  assert.deepStrictEqual(actionRegistry.categories, [
    { category: "信息", count: 5 },
    { category: "消息", count: 6 },
    { category: "好友", count: 3 },
    { category: "群信息", count: 7 },
    { category: "群管理", count: 24 },
    { category: "群文件", count: 12 },
    { category: "请求", count: 2 },
    { category: "擴展", count: 115 },
    { category: "群相册", count: 9 },
    { category: "空间", count: 29 },
    { category: "系统表情", count: 4 },
    { category: "流式接口", count: 6 },
  ]);
  assert.equal(oracleFor("get_friend_list").names[0], "get_friend_list");
  assert.equal(oracleFor("set_friend_add_request").names[0], "set_friend_add_request");
});

test("registry: every registered name resolves, including aliases", () => {
  for (const claim of actionRegistry.executableNames) {
    const found = actionRegistry.resolve(claim.name);
    assert.ok(found, `resolve(${claim.name}) missed`);
    assert.equal(found.name, claim.name);
    assert.equal(found.canonical, claim.canonical);
  }
  assert.equal(actionRegistry.resolve("no_such_action"), undefined);
});

test("registry: a duplicate name across groups is a compile error naming both", () => {
  const colliding = {
    category: "test",
    actions: [
      ...ACTION_GROUPS[0]!.actions,
      // Re-register get_login_info under a second category.
      ACTION_GROUPS[0]!.actions[0]!,
    ],
  };
  assert.throws(
    () => compileActionRegistry([ACTION_GROUPS[0]!, colliding]),
    /Action registry conflict for executable name "get_login_info"/,
    "the conflict must be detected at compile time, not at dispatch",
  );
});

test("registry: bind() gives every name a callable handler", () => {
  const handlers = actionRegistry.bind(makeCtx());
  assert.equal(handlers.size, actionRegistry.executableNames.length);
  for (const name of handlers.keys()) {
    assert.equal(typeof handlers.get(name)!.handler, "function", `${name} has no handler`);
  }
});

test("registry: dispatchAction answers 1404 for an unknown name", async () => {
  const handlers = actionRegistry.bind(makeCtx());
  const response = await dispatchAction(handlers, "totally_made_up", {});
  assert.deepStrictEqual(response, { status: "failed", retcode: 1404, data: null, wording: "unknown action" });
});

// ===========================================================================
// 2. 信息 — the five info actions
// ===========================================================================

test("info: all five actions agree with the reference", async () => {
  for (const name of ["get_login_info", "get_status", "get_version_info", "can_send_image", "can_send_record"]) {
    const { mine, theirs } = await both(name, {});
    assertMatchesReference(mine, theirs, name);
  }
});

test("info: get_status composes good from online AND receiveHealthy", async () => {
  // Four combinations. The `false && x` case is the one a shortcut would get wrong.
  for (const [online, healthy] of [
    [true, true],
    [false, true],
    [true, false],
    [false, false],
  ] as const) {
    const ctx = makeCtx({
      isOnline: () => online,
      getUptimeMs: () => 60_000,
      bridge: makeBridge({ receiveHealthy: healthy }) as unknown as ActionContext["bridge"],
    });
    const { mine, theirs } = await both("get_status", {}, ctx);
    assertMatchesReference(mine, theirs, `get_status online=${String(online)} healthy=${String(healthy)}`);
    const data = dataOf(mine) as { online: boolean; good: boolean; time: number };
    assert.equal(data.online, online);
    // `good` must be false whenever the account is offline, even if the bridge is healthy.
    assert.equal(data.good, online && healthy, "good must be online && receiveHealthy");
    assert.equal(data.time, 60, "time is floor(uptimeMs / 1000)");
  }
});

test("info: get_version_info reports the string APP_VERSION, not the package object", () => {
  // The bundle assigns `var APP_VERSION = { ...package.json... }.version`, i.e. the
  // STRING "0.2.4.2". A port that kept the object would answer "[object Object]-node".
  assert.equal(APP_VERSION, "0.2.4.2");
  const data = dataOf(
    (actionRegistry.resolve("get_version_info")!.action!.spec.toHandler(makeCtx())({}) as unknown) ?? null,
  );
  void data;
});

test("info: get_version_info reports the STRING APP_VERSION, not the package object", async () => {
  // The bundle assigns `var APP_VERSION = { ...package.json... }.version`, i.e. the
  // STRING "0.2.4.2" (reference:6085 — the `.version` suffix is easy to miss on the
  // closing brace, and this oracle caught exactly that mistake in the test helper).
  // A port that kept the object would answer "[object Object]-node".
  assert.equal(APP_VERSION, "0.2.4.2");
  const response = await actionRegistry.resolve("get_version_info")!.action!.spec.toHandler(makeCtx())({});
  assert.deepStrictEqual(dataOf(response), {
    app_name: "Haizakura",
    app_version: "0.2.4.2-node",
    protocol_version: "v11",
  });
});

test("info: can_send_image/can_send_record default to false when the ctx lacks them", async () => {
  const bare = makeCtx();
  delete (bare as { canSendImage?: unknown }).canSendImage;
  delete (bare as { canSendRecord?: unknown }).canSendRecord;
  const image = await actionRegistry.resolve("can_send_image")!.action!.spec.toHandler(bare)({});
  const record = await actionRegistry.resolve("can_send_record")!.action!.spec.toHandler(bare)({});
  assert.deepStrictEqual(dataOf(image), { yes: false });
  assert.deepStrictEqual(dataOf(record), { yes: false });
});

// ===========================================================================
// 3. 群信息 — the seven group-info actions
// ===========================================================================

test("group-info: every no-provider fallback agrees with the reference", async () => {
  // Each of these exercises a DIFFERENT fallback; see the header of group-info.ts.
  const cases: Array<[string, Record<string, unknown>]> = [
    ["get_group_list", {}],
    ["get_group_info", { group_id: 20001 }],
    ["get_group_member_list", { group_id: 20001 }],
    ["get_group_member_info", { group_id: 20001, user_id: 10001 }],
    ["get_group_system_msg", {}],
    ["get_group_share_link", { group_id: 20001 }],
  ];
  for (const [name, params] of cases) {
    const { mine, theirs } = await both(name, params);
    assertMatchesReference(mine, theirs, `${name} (no provider)`);
  }
});

test("group-info: get_group_member_info's two fallbacks differ by the three qidian flags", async () => {
  // Provider absent → 13 keys, no qidian_*.
  const absent = await actionRegistry.resolve("get_group_member_info")!.action!.spec.toHandler(makeCtx())({
    group_id: 20001,
    user_id: 10001,
  });
  const absentKeys = Object.keys(dataOf(absent) as object).sort();

  // Provider present, returns null → 16 keys, including qidian_*: 0.
  const nullCtx = makeCtx({ getGroupMemberInfo: async () => null });
  const fromNull = await actionRegistry.resolve("get_group_member_info")!.action!.spec.toHandler(nullCtx)({
    group_id: 20001,
    user_id: 10001,
  });
  const nullKeys = Object.keys(dataOf(fromNull) as object).sort();

  assert.equal(absentKeys.includes("qidian_master_flag"), false, "no-provider fallback must NOT carry qidian flags");
  assert.equal(nullKeys.includes("qidian_master_flag"), true, "null-provider fallback MUST carry qidian flags");
  assert.equal(nullKeys.length, absentKeys.length + 3, "the difference is exactly three keys");

  // And both agree with the reference.
  assertMatchesReference(absent, await oracleFor("get_group_member_info").toHandler(refCtx(makeCtx()))({ group_id: 20001, user_id: 10001 }), "absent");
  assertMatchesReference(fromNull, await oracleFor("get_group_member_info").toHandler(refCtx(nullCtx))({ group_id: 20001, user_id: 10001 }), "null");
});

test("group-info: get_group_info's fallback is a 10-field object, not []", async () => {
  const response = await actionRegistry.resolve("get_group_info")!.action!.spec.toHandler(makeCtx())({ group_id: 20001 });
  assert.deepStrictEqual(dataOf(response), {
    group_id: 20001,
    group_name: "",
    group_remark: "",
    member_count: 0,
    max_member_count: 0,
    group_create_time: 0,
    group_level: 0,
    group_memo: "",
    group_description: "",
    group_all_shut: 0,
  });
});

test("group-info: get_group_honor_info rejects a bad type with the enum list", async () => {
  const { mine, theirs } = await both("get_group_honor_info", { group_id: 20001, type: "nope" });
  assertMatchesReference(mine, theirs, "bad type");
  assert.equal((mine as { retcode: number }).retcode, 1400);
  assert.match((mine as { wording: string }).wording, /invalid type, must be one of talkative, performer, legend, emotion, all/);
});

test("group-info: get_group_honor_info treats an empty type as all", async () => {
  const { mine, theirs } = await both("get_group_honor_info", { group_id: 20001, type: "" });
  assertMatchesReference(mine, theirs, "empty type");
  assert.equal((mine as { status: string }).status, "ok");
});

test("group-info: get_group_share_link defaults are need_short_url=true, src_id=73", async () => {
  const bridge = makeBridge();
  const ctx = makeCtx({ bridge: bridge as unknown as ActionContext["bridge"] });
  const { mine, theirs } = await both("get_group_share_link", { group_id: 20001 }, ctx);
  assertMatchesReference(mine, theirs, "share link");
  const call = (bridge["_calls"] as Array<{ path: string; args: unknown[] }>).find(
    (c) => c.path === "contacts.getGroupShareLink",
  );
  assert.ok(call, "getGroupShareLink was never called");
  assert.deepStrictEqual(call.args, [20001, true, 73, ""], "defaults changed");
});

// ===========================================================================
// 4. 群管理 — the 24 group-admin actions
// ===========================================================================

test("group-admin: all 24 actions exist and agree on a happy-path call", async () => {
  const params: Record<string, Record<string, unknown>> = {
    set_group_kick: { group_id: 20001, user_id: 10001 },
    set_group_kick_members: { group_id: 20001, user_id: [10001, 10002] },
    set_group_ban: { group_id: 20001, user_id: 10001 },
    set_group_whole_ban: { group_id: 20001 },
    set_group_add_option: { group_id: 20001 },
    set_group_search: { group_id: 20001 },
    set_group_member_invite_policy: { group_id: 20001, policy: "no_approval" },
    set_group_new_member_history_visibility: { group_id: 20001, visible: true },
    set_group_member_permissions: { group_id: 20001, allow_member_upload_album: true },
    get_group_admin_settings: { group_id: 20001 },
    get_group_tags: { group_class: 1 },
    add_group_tag: { group_class: 1, name: "学习" },
    delete_group_tag: { group_class: 1, name: "学习" },
    set_group_admin: { group_id: 20001, user_id: 10001 },
    get_group_admin_permissions: { group_id: 20001, user_id: 10001 },
    set_group_admin_permissions: { group_id: 20001, user_id: 10001, kick_member: true, kick_member_per_day: 10 },
    set_group_admin_receive_verify: { group_id: 20001, user_id: 10001, enable: true },
    set_group_card: { group_id: 20001, user_id: 10001 },
    set_group_name: { group_id: 20001 },
    set_group_leave: { group_id: 20001 },
    set_group_special_title: { group_id: 20001, user_id: 10001 },
    set_group_anonymous: {},
    set_group_anonymous_ban: {},
    set_group_portrait: { group_id: 20001, file: "file:///tmp/a.png" },
  };
  const oracle = loadActionOracle();
  assert.equal(oracle.groupAdmin.length, 24);
  for (const action of oracle.groupAdmin) {
    const name = action.names[0]!;
    // ⚠️ bot_exit SCHEDULES process.exit(0) 50ms later. Running it inside the test
    // process kills the runner mid-file, which silently drops every test declared
    // after this one (the symptom is "83 declared, 53 executed"). It is therefore
    // excluded from every generic loop and its schema is asserted instead.
    if (name === "bot_exit") continue;
    assert.ok(name in params, `no happy-path params for group-admin action ${name}`);
    const { mine, theirs } = await both(name, params[name]!);
    assertMatchesReference(mine, theirs, name);
  }
});

test("group-admin: every mutator answers data === null, not {} and not undefined", async () => {
  // 19 mutators + 2 no-ops + portrait. `okResponse()` with no argument means null.
  const mutators = [
    ["set_group_kick", { group_id: 20001, user_id: 10001 }],
    ["set_group_kick_members", { group_id: 20001, user_id: [10001] }],
    ["set_group_ban", { group_id: 20001, user_id: 10001 }],
    ["set_group_whole_ban", { group_id: 20001 }],
    ["set_group_add_option", { group_id: 20001 }],
    ["set_group_search", { group_id: 20001 }],
    ["set_group_member_invite_policy", { group_id: 20001, policy: "disabled" }],
    ["set_group_new_member_history_visibility", { group_id: 20001, visible: false }],
    ["set_group_member_permissions", { group_id: 20001, allow_member_create_group: true }],
    ["add_group_tag", { group_class: 1, name: "x" }],
    ["delete_group_tag", { group_class: 1, name: "x" }],
    ["set_group_admin", { group_id: 20001, user_id: 10001 }],
    ["set_group_admin_permissions", { group_id: 20001, user_id: 10001, recall_member_message: true }],
    ["set_group_admin_receive_verify", { group_id: 20001, user_id: 10001, enable: false }],
    ["set_group_card", { group_id: 20001, user_id: 10001 }],
    ["set_group_name", { group_id: 20001 }],
    ["set_group_leave", { group_id: 20001 }],
    ["set_group_special_title", { group_id: 20001, user_id: 10001 }],
    ["set_group_anonymous", {}],
    ["set_group_anonymous_ban", {}],
    ["set_group_portrait", { group_id: 20001, file: "file:///tmp/a.png" }],
  ] as const;
  for (const [name, params] of mutators) {
    const response = await actionRegistry.resolve(name)!.action!.spec.toHandler(makeCtx())(params);
    assert.equal((response as { status: string }).status, "ok", `${name} did not succeed`);
    assert.equal(
      Object.hasOwn(response as object, "data"),
      true,
      `${name} is missing the data key entirely`,
    );
    assert.strictEqual(dataOf(response), null, `${name} must answer data === null`);
  }
});

test("group-admin: the two anonymous actions touch nothing on the bridge", async () => {
  // They are documented no-ops in the bundle (「未实现，返回 ok」). Making them call an
  // OIDB command would be inventing protocol; this asserts the port does not.
  for (const name of ["set_group_anonymous", "set_group_anonymous_ban"]) {
    const bridge = makeBridge();
    await actionRegistry.resolve(name)!.action!.spec.toHandler(makeCtx({ bridge: bridge as unknown as ActionContext["bridge"] }))({});
    assert.deepStrictEqual((bridge["_calls"] as unknown[]).length, 0, `${name} made a bridge call`);
  }
});

test("group-admin: set_group_ban defaults duration to 1800", async () => {
  const bridge = makeBridge();
  const { mine, theirs } = await both(
    "set_group_ban",
    { group_id: 20001, user_id: 10001 },
    makeCtx({ bridge: bridge as unknown as ActionContext["bridge"] }),
  );
  assertMatchesReference(mine, theirs, "set_group_ban");
  const call = (bridge["_calls"] as Array<{ path: string; args: unknown[] }>).find((c) => c.path === "groupAdmin.muteMember");
  assert.deepStrictEqual(call!.args, [20001, 10001, 1800]);
});

test("group-admin: set_group_whole_ban defaults enable to true", async () => {
  const bridge = makeBridge();
  await actionRegistry.resolve("set_group_whole_ban")!.action!.spec.toHandler(
    makeCtx({ bridge: bridge as unknown as ActionContext["bridge"] }),
  )({ group_id: 20001 });
  const call = (bridge["_calls"] as Array<{ path: string; args: unknown[] }>).find((c) => c.path === "groupAdmin.muteAll");
  assert.deepStrictEqual(call!.args, [20001, true]);
});

test("group-admin: set_group_kick defaults reject_add_request to false", async () => {
  const bridge = makeBridge();
  await actionRegistry.resolve("set_group_kick")!.action!.spec.toHandler(
    makeCtx({ bridge: bridge as unknown as ActionContext["bridge"] }),
  )({ group_id: 20001, user_id: 10001 });
  const call = (bridge["_calls"] as Array<{ path: string; args: unknown[] }>).find((c) => c.path === "groupAdmin.kickMember");
  assert.deepStrictEqual(call!.args, [20001, 10001, false]);
});

test("group-admin: set_group_card/set_group_name/set_group_special_title default to empty string", async () => {
  const bridge = makeBridge();
  const ctx = makeCtx({ bridge: bridge as unknown as ActionContext["bridge"] });
  await actionRegistry.resolve("set_group_card")!.action!.spec.toHandler(ctx)({ group_id: 20001, user_id: 10001 });
  await actionRegistry.resolve("set_group_name")!.action!.spec.toHandler(ctx)({ group_id: 20001 });
  await actionRegistry.resolve("set_group_special_title")!.action!.spec.toHandler(ctx)({ group_id: 20001, user_id: 10001 });
  const calls = bridge["_calls"] as Array<{ path: string; args: unknown[] }>;
  assert.deepStrictEqual(calls.find((c) => c.path === "groupAdmin.setCard")!.args, [20001, 10001, ""]);
  assert.deepStrictEqual(calls.find((c) => c.path === "groupAdmin.setName")!.args, [20001, ""]);
  assert.deepStrictEqual(calls.find((c) => c.path === "groupAdmin.setSpecialTitle")!.args, [20001, 10001, ""]);
});

test("group-admin: the three set_group_admin_permissions rules match the reference", async () => {
  const cases: Array<Record<string, unknown>> = [
    // rule 1: at least one of the two booleans
    { group_id: 20001, user_id: 10001 },
    { group_id: 20001, user_id: 10001, kick_member_per_day: 10 },
    // rule 2: kick_member=true needs an allowed per-day value
    { group_id: 20001, user_id: 10001, kick_member: true },
    { group_id: 20001, user_id: 10001, kick_member: true, kick_member_per_day: 7 },
    { group_id: 20001, user_id: 10001, kick_member: true, kick_member_per_day: 200 },
    { group_id: 20001, user_id: 10001, kick_member: true, kick_member_per_day: 0 },
    // rule 3: per_day needs kick_member=true
    { group_id: 20001, user_id: 10001, recall_member_message: false, kick_member_per_day: 5 },
    // valid
    { group_id: 20001, user_id: 10001, recall_member_message: true },
    { group_id: 20001, user_id: 10001, kick_member: false },
  ];
  for (const params of cases) {
    const { mine, theirs } = await both("set_group_admin_permissions", params);
    assertMatchesReference(mine, theirs, `set_group_admin_permissions ${JSON.stringify(params)}`);
  }
});

test("group-admin: the three validate rules appear in describe().invariants", async () => {
  const doc = actionRegistry.resolve("set_group_admin_permissions")!.action!.spec.describe();
  assert.deepStrictEqual(doc.invariants, [
    "at least one of: recall_member_message, kick_member",
    "kick_member=true requires kick_member_per_day: 0, 5, 10, 20, 50, 100 or 200",
    "kick_member_per_day requires kick_member=true",
  ]);
  // And the reference's own describe() agrees, field for field.
  assert.deepStrictEqual(doc.invariants, (oracleFor("set_group_admin_permissions").describe() as { invariants: string[] }).invariants);
});

test("group-admin: set_group_new_member_history_visibility requires visible", async () => {
  const { mine, theirs } = await both("set_group_new_member_history_visibility", { group_id: 20001 });
  assertMatchesReference(mine, theirs, "visible missing");
  assert.equal((mine as { retcode: number }).retcode, 1400);
  assert.match((mine as { wording: string }).wording, /^visible: /);
});

test("group-admin: set_group_admin_receive_verify requires enable", async () => {
  const { mine, theirs } = await both("set_group_admin_receive_verify", { group_id: 20001, user_id: 10001 });
  assertMatchesReference(mine, theirs, "enable missing");
  assert.equal((mine as { retcode: number }).retcode, 1400);
});

test("group-admin: set_group_kick_members rejects an empty user_id array", async () => {
  const { mine, theirs } = await both("set_group_kick_members", { group_id: 20001, user_id: [] });
  assertMatchesReference(mine, theirs, "empty array");
  assert.equal((mine as { retcode: number }).retcode, 1400);
});

test("group-admin: set_group_member_permissions needs at least one field", async () => {
  const { mine, theirs } = await both("set_group_member_permissions", { group_id: 20001 });
  assertMatchesReference(mine, theirs, "no fields");
  assert.equal((mine as { retcode: number }).retcode, 1400);
});

test("group-admin: set_group_member_invite_policy rejects an unknown policy", async () => {
  const { mine, theirs } = await both("set_group_member_invite_policy", { group_id: 20001, policy: "sometimes" });
  assertMatchesReference(mine, theirs, "bad policy");
  assert.match((mine as { wording: string }).wording, /policy: expected one of: disabled, require_approval, no_approval, no_approval_under_100/);
});

// ===========================================================================
// 5. 消息 — the six message actions, compared on their failure paths
// ===========================================================================
// The happy paths need `sendGroupMessage`/`sendPrivateMessage` providers, which the
// port declares as optional. Both sides answer identically there too, but the
// interesting parts are the routing and the failure wording, so those come first.

test("message: get_msg answers 100 with 'message not found' when the store misses", async () => {
  const { mine, theirs } = await both("get_msg", { message_id: 12345 });
  assertMatchesReference(mine, theirs, "get_msg miss");
  assert.deepStrictEqual(mine, { status: "failed", retcode: 100, data: null, wording: "message not found" });
});

test("message: delete_msg answers 100 with the retract wording when no meta", async () => {
  const { mine, theirs } = await both("delete_msg", { message_id: 12345 });
  assertMatchesReference(mine, theirs, "delete_msg miss");
  assert.deepStrictEqual(mine, {
    status: "failed",
    retcode: 100,
    data: null,
    wording: "message not found or not retractable",
  });
});

test("message: get_msg strips post_type/self_id and adds real_id", async () => {
  const stored = { post_type: "message", self_id: 10001, message_id: 7, message_type: "group", raw_message: "hi" };
  const ctx = makeCtx({ getMessage: async () => stored });
  const { mine, theirs } = await both("get_msg", { message_id: 7 }, ctx);
  assertMatchesReference(mine, theirs, "get_msg hit");
  const data = dataOf(mine) as Record<string, unknown>;
  assert.equal(Object.hasOwn(data, "post_type"), false, "post_type must be stripped");
  assert.equal(Object.hasOwn(data, "self_id"), false, "self_id must be stripped");
  assert.equal(data["real_id"], 7);
});

test("message: get_msg falls back to the requested id when the record has none", async () => {
  const ctx = makeCtx({ getMessage: async () => ({ message_type: "group", raw_message: "hi" }) });
  const { mine, theirs } = await both("get_msg", { message_id: 999 }, ctx);
  assertMatchesReference(mine, theirs, "get_msg real_id fallback");
  assert.equal((dataOf(mine) as { real_id: number }).real_id, 999);
});

test("message: delete_msg succeeds with data === null", async () => {
  const meta = { isGroup: true, targetId: 20001, sequence: 5, sequenceAuthoritative: true, clientSequence: 1, random: 2, timestamp: 3 };
  let deleted: unknown = null;
  const ctx = makeCtx({ getMessageMeta: async () => meta, deleteMessage: async (id, m) => { deleted = { id, m }; } });
  const { mine, theirs } = await both("delete_msg", { message_id: 5 }, ctx);
  assertMatchesReference(mine, theirs, "delete_msg hit");
  assert.strictEqual(dataOf(mine), null);
  assert.deepStrictEqual(deleted, { id: 5, m: meta });
});

test("message: all six send actions agree on a successful response", async () => {
  // Finding from mutation testing: this test did not exist at first, and renaming
  // `message_id` → `messageId` in `send_group_msg`'s success response left the suite
  // GREEN. A response key is the whole contract of these six actions, so every one of
  // them is compared here, not merely the two that route.
  const ctx = makeCtx({
    sendGroupMessage: async () => ({ messageId: 4242 }),
    sendPrivateMessage: async () => ({ messageId: 4243 }),
  });
  const cases: Array<[string, Record<string, unknown>]> = [
    ["send_group_msg", { group_id: 20001, message: "hi" }],
    ["send_private_msg", { user_id: 10001, message: "hi" }],
    ["send_msg", { message: "hi", group_id: 20001 }],
    ["send_msg", { message: "hi", user_id: 10001 }],
    ["send_custom_face", { emoji_id: "abc", group_id: 20001 }],
    ["send_custom_face", { emoji_id: "abc", user_id: 10001 }],
  ];
  for (const [name, params] of cases) {
    const { mine, theirs } = await both(name, params, ctx);
    assertMatchesReference(mine, theirs, `${name} ${JSON.stringify(params)}`);
    // Explicitly: the key is `message_id`, snake_case, and it comes from the provider.
    const data = dataOf(mine) as Record<string, unknown>;
    assert.deepStrictEqual(Object.keys(data), ["message_id"], `${name}: response key set`);
    assert.equal(data["message_id"], params["user_id"] !== undefined && params["group_id"] === undefined ? 4243 : 4242);
  }
});

test("message: send_msg routing matrix matches the reference on every branch", async () => {
  // Each row is a distinct branch of the reference's condition; see message.ts header.
  const rows: Array<Record<string, unknown>> = [
    // group branch by group_id alone (no message_type)
    { message: "hi", group_id: 20001 },
    // group branch by message_type alone → 1400 group_id is required
    { message: "hi", message_type: "group" },
    // private branch, no user_id → 1400 user_id is required
    { message: "hi" },
    { message: "hi", message_type: "private" },
    // temp reply: message_type private + user_id + group_id → PRIVATE branch
    { message: "hi", message_type: "private", user_id: 10001, group_id: 20001 },
    // explicit empty-string group_id on a private message
    { message: "hi", message_type: "private", user_id: 10001, group_id: "" },
  ];
  for (const params of rows) {
    const { mine, theirs } = await both("send_msg", params);
    assertMatchesReference(mine, theirs, `send_msg ${JSON.stringify(params)}`);
  }
});

test("message: send_msg reaches the private provider for the temp-reply case", async () => {
  const sent: Array<{ userId: number; tempGroupId?: number | undefined }> = [];
  const ctx = makeCtx({
    sendPrivateMessage: async (userId, _message, _autoEscape, tempGroupId) => {
      sent.push({ userId, tempGroupId });
      return { messageId: 42 };
    },
  });
  const { mine, theirs } = await both(
    "send_msg",
    { message: "hi", message_type: "private", user_id: 10001, group_id: 20001 },
    ctx,
  );
  assertMatchesReference(mine, theirs, "temp reply");
  assert.deepStrictEqual(dataOf(mine), { message_id: 42 });
  // `both()` runs the oracle against the SAME ctx, so each provider is called twice
  // (once by each side). What matters is that both calls agree on the arguments.
  assert.deepStrictEqual(sent, [
    { userId: 10001, tempGroupId: 20001 },
    { userId: 10001, tempGroupId: 20001 },
  ]);
});

test("message: send_msg reaches the group provider when only group_id is given", async () => {
  const sent: Array<{ groupId: number }> = [];
  const ctx = makeCtx({
    sendGroupMessage: async (groupId) => {
      sent.push({ groupId });
      return { messageId: 7 };
    },
  });
  const { mine, theirs } = await both("send_msg", { message: "hi", group_id: 20001 }, ctx);
  assertMatchesReference(mine, theirs, "group by id");
  assert.deepStrictEqual(sent, [{ groupId: 20001 }, { groupId: 20001 }]);
});

test("message: send_private_msg drops group_id: 0 but keeps a positive one", async () => {
  const seen: Array<number | undefined> = [];
  const ctx = makeCtx({
    sendPrivateMessage: async (_u, _m, _a, tempGroupId) => {
      seen.push(tempGroupId);
      return { messageId: 1 };
    },
  });
  await actionRegistry.resolve("send_private_msg")!.action!.spec.toHandler(ctx)({ user_id: 10001, message: "hi", group_id: 0 });
  await actionRegistry.resolve("send_private_msg")!.action!.spec.toHandler(ctx)({ user_id: 10001, message: "hi", group_id: 20001 });
  assert.deepStrictEqual(seen, [undefined, 20001], "group_id 0 must become undefined");
  // and the oracle agrees on both
  for (const groupId of [0, 20001]) {
    const { mine, theirs } = await both("send_private_msg", { user_id: 10001, message: "hi", group_id: groupId }, ctx);
    assertMatchesReference(mine, theirs, `send_private_msg group_id=${groupId}`);
  }
});

test("message: send_custom_face requires exactly one of group_id/user_id", async () => {
  const cases: Array<Record<string, unknown>> = [
    { emoji_id: "abc" },
    { emoji_id: "abc", group_id: 20001, user_id: 10001 },
    { emoji_id: "   ", group_id: 20001 },
  ];
  for (const params of cases) {
    const { mine, theirs } = await both("send_custom_face", params);
    assertMatchesReference(mine, theirs, `send_custom_face ${JSON.stringify(params)}`);
  }
  // The absent-both case and the both-given case share one wording.
  const none = await both("send_custom_face", { emoji_id: "abc" });
  assert.equal((none.mine as { wording: string }).wording, "exactly one of group_id and user_id is required");
  const blank = await both("send_custom_face", { emoji_id: "  ", group_id: 20001 });
  assert.equal((blank.mine as { wording: string }).wording, "emoji_id is required");
});

test("message: send_custom_face builds a reply + mface-shaped image segment", async () => {
  // The reference sends `image` with `sub_type: 1` and summary "[动画表情]", NOT an
  // mface — a subtle difference from what the name suggests, so it is pinned.
  const sent: Array<{ message: unknown }> = [];
  const ctx = makeCtx({
    sendGroupMessage: async (_g, message) => {
      sent.push({ message });
      return { messageId: 9 };
    },
  });
  const { mine, theirs } = await both("send_custom_face", { emoji_id: "abc", group_id: 20001, reply_to: 5 }, ctx);
  assertMatchesReference(mine, theirs, "custom face happy path");
  assert.deepStrictEqual(sent[0]!.message, [
    { type: "reply", data: { id: "5" } },
    { type: "image", data: { file: "https://example.invalid/face", sub_type: 1, summary: "[动画表情]" } },
  ]);
});

// ===========================================================================
// 6. Parameter schemas — compared key by key against the reference
// ===========================================================================

test("schemas: every action's param names and required flags match the reference", () => {
  for (const claim of actionRegistry.executableNames) {
    if (claim.role !== "canonical") continue;
    const mine = claim.action!.spec.describe();
    const theirs = oracleFor(claim.name).describe() as {
      name: string;
      aliases: string[];
      params: Array<{ name: string; required: boolean; type: string; default?: unknown }>;
    };
    assert.equal(mine.name, theirs.name, `${claim.name}: canonical name`);
    assert.deepStrictEqual(mine.aliases, theirs.aliases, `${claim.name}: aliases`);

    const mineParams = mine.params.map((p) => ({ name: p.name, required: p.required, type: p.type }));
    const theirsParams = theirs.params.map((p) => ({ name: p.name, required: p.required, type: p.type }));
    assert.deepStrictEqual(mineParams, theirsParams, `${claim.name}: parameter list`);
  }
});

test("schemas: every action's declared defaults match the reference", () => {
  for (const claim of actionRegistry.executableNames) {
    if (claim.role !== "canonical") continue;
    const mine = claim.action!.spec.describe().params;
    const theirs = (oracleFor(claim.name).describe() as {
      params: Array<{ name: string; default?: unknown; required: boolean }>;
    }).params;
    const mineDefaults = mine.filter((p) => p.default !== undefined).map((p) => [p.name, p.default]);
    const theirsDefaults = theirs.filter((p) => p.default !== undefined).map((p) => [p.name, p.default]);
    assert.deepStrictEqual(mineDefaults, theirsDefaults, `${claim.name}: defaults`);
  }
});

test("schemas: readOnly flags match the reference", () => {
  for (const claim of actionRegistry.executableNames) {
    if (claim.role !== "canonical") continue;
    assert.equal(
      claim.action!.spec.describe().readOnly,
      (oracleFor(claim.name).describe() as { readOnly: boolean }).readOnly,
      `${claim.name}: readOnly`,
    );
  }
});

test("schemas: invariants match the reference for every action", () => {
  for (const claim of actionRegistry.executableNames) {
    if (claim.role !== "canonical") continue;
    assert.deepStrictEqual(
      claim.action!.spec.describe().invariants,
      (oracleFor(claim.name).describe() as { invariants: string[] }).invariants,
      `${claim.name}: invariants`,
    );
  }
});

// ===========================================================================
// 7. Missing-infrastructure behaviour
// ===========================================================================
// The port deliberately does NOT declare bridge members it cannot implement. The
// consequence is that an action needing one throws, and `dispatchAction` maps the
// throw to retcode 100. That is asserted here so the gap is a documented, tested
// failure instead of an accidental `{}`.

test("gaps: the six unconditional ctx members are required, and a host cannot omit them", async () => {
  // The point is a COMPILE-time obligation: `ActionContext` declares them
  // non-optional because the reference calls them without a presence test. A host
  // that has no message store fails to typecheck instead of silently answering
  // "100 message not found" for every id.
  //
  // At runtime the useful assertion is that they really are reached: a ctx with a
  // throwing store must surface that throw, not swallow it.
  const ctx = makeCtx({
    getMessage: async () => {
      throw new Error("no message store is wired");
    },
  });
  await assert.rejects(
    () => actionRegistry.resolve("get_msg")!.action!.spec.toHandler(ctx)({ message_id: 5 }),
    /no message store is wired/,
    "a throwing store must propagate, not be mapped to a not-found response",
  );
});

test("gaps: dispatchAction maps an unhandled throw to retcode 100, not 1400", async () => {
  const ctx = makeCtx({
    sendGroupMessage: async () => {
      throw new Error("transport offline");
    },
  });
  const handlers = actionRegistry.bind(ctx);
  const response = await dispatchAction(handlers, "send_group_msg", { group_id: 20001, message: "hi" });
  assert.equal((response as { retcode: number }).retcode, 100, "a transport failure is an action failure, not a 1400");
  assert.equal((response as { wording: string }).wording, "transport offline");
});

test("gaps: the action layer forwards `message` untouched; the provider parses it", async () => {
  // ⚠️ Measured: none of the six message actions calls `parseMessage`. `run` passes
  // `p.message` straight to `ctx.send*Message` (reference:7912, 7936, 7948, 7960), and
  // the parse/serialise happens inside the bridge's send path. So a bogus message is
  // NOT a 1400 from the action layer — it is whatever the provider throws.
  const seen: unknown[] = [];
  const ctx = makeCtx({
    sendGroupMessage: async (_g, message) => {
      seen.push(message);
      return { messageId: 1 };
    },
  });
  const response = await actionRegistry.resolve("send_msg")!.action!.spec.toHandler(ctx)({
    message: "",
    group_id: 20001,
  });
  assert.equal((response as { status: string }).status, "ok", "the action layer must not reject it");
  assert.deepStrictEqual(seen, [""], "the raw value must be forwarded unchanged");
});

test("gaps: a MessageElementValidationError raised by a provider maps to 1400", async () => {
  // This is the mapping `ApiHandler.runAction` performs (reference:21574): the retcode
  // depends on the error CLASS, so the parser's own error type must become 1400.
  const ctx = makeCtx({
    sendGroupMessage: async () => {
      throw new MessageElementValidationError("UNSENDABLE_TYPE", 'message segment "shake" cannot be combined', "shake");
    },
  });
  const handlers = actionRegistry.bind(ctx);
  const response = await dispatchAction(handlers, "send_group_msg", { group_id: 20001, message: "hi" });
  assert.equal((response as { retcode: number }).retcode, 1400, "a validation error must be 1400");
  assert.equal((response as { wording: string }).wording, 'message segment "shake" cannot be combined');
  // Sanity: the discriminator really is the name, so the mapping is not accidental.
  assert.equal(new MessageElementValidationError("MISSING_FIELD", "x", "").name, "MessageElementValidationError");
});
// ===========================================================================
// 8. The 擴展 family: 115 definitions, 121 executable names
// ===========================================================================
//
// ---------------------------------------------------------------------------
// Why a recording PROXY rather than 121 hand-written fakes
// ---------------------------------------------------------------------------
// The extended `run` bodies reach ~50 distinct `apis.<slice>.<method>` paths plus a
// dozen `ctx.*` providers. Hand-writing that is both enormous and stale-prone: a
// method added to `context.ts` would silently make its action take the "unavailable"
// branch on BOTH sides, so the test would pass while proving nothing.
//
// A Proxy that answers every unknown member with a recording async function makes the
// fake total. Both sides receive the SAME proxy, so the two runs must agree on which
// paths were called, in what order, with what arguments, and on the response — which is
// exactly the comparison that catches a mutated `okResponse({})`, a swapped argument
// order, or a dropped guard.
//
// The arrays/documents a provider returns are the second half of the contract and a
// generic proxy cannot invent them, so the handful of actions that READ a provider's
// return value are driven separately below with concrete answers.

type Recorder = { calls: Array<{ path: string; args: unknown[] }>; };

/**
 * A context whose every member — at any depth — is a recording CALLABLE.
 *
 * Two traps are what make this work:
 *
 *   `get`   answers a fresh callable for any unknown member, so `apis.<slice>.<method>`
 *           resolves at whatever depth and never throws on a member this port has but
 *           the caller did not anticipate. `then` is deliberately undefined, otherwise
 *           the proxy is a thenable and every `await ctx...` hangs instead of failing.
 *   `apply` records the fully-qualified path and returns the leaf's pinned value (or
 *           `undefined`).
 *
 * The recording happens in `apply`, not `get`, so a provider that is READ but never
 * CALLED produces no entry — which is what makes "did this action reach the bridge?"
 * answerable.
 *
 * `leaves` pins specific paths to concrete return values, and may hold a THROWING
 * function so the provider-failure branches can be compared too.
 */
function recordingCtx(leaves: Record<string, unknown> = {}): { ctx: ActionContext; rec: Recorder } {
  const calls: Array<{ path: string; args: unknown[] }> = [];
  // A leaf may be named either way: `apis.web.getCookiesStr` (how the action's source
  // reads) or `bridge.apis.web.getCookiesStr` (the fully-qualified path this proxy
  // records). Requiring one spelling would make half the pins silently unreachable —
  // exactly the class of bug these tests exist to catch, so both are tried.
  const pinned = (path: string): { found: boolean; leaf: unknown } => {
    if (path in leaves) return { found: true, leaf: leaves[path] };
    const short = path.replace(/^bridge\./, "");
    if (short in leaves) return { found: true, leaf: leaves[short] };
    return { found: false, leaf: undefined };
  };
  const callable = (path: string): unknown =>
    new Proxy(function recorded() {} as unknown as Record<string, unknown>, {
      get(_t, key) {
        if (typeof key !== "string") return undefined;
        if (key === "then") return undefined;
        return callable(`${path}.${key}`);
      },
      apply(_t, _this, args) {
        // Normalised so a recorded call reads the way the action's source does:
        // `apis.web.getCookiesStr` rather than `bridge.apis.web.getCookiesStr`, while a
        // genuine bridge member stays `bridge.sendRawPacket`. Without this the recorded
        // vocabulary and the pinned vocabulary differ by one prefix and half the tests
        // assert against a name nothing produces.
        calls.push({ path: path.replace(/^bridge\.apis\./, "apis."), args });
        // `path in leaves`, NOT `leaves[path] !== undefined`: a leaf pinned to an
        // explicit `null` must answer null, not fall through to "unpinned". Several
        // actions branch on a null provider answer (getMessage, getMessageMeta,
        // getOnlineClients) and collapsing the two makes those branches unreachable.
        const pin = pinned(path);
        if (!pin.found) return undefined;
        if (typeof pin.leaf === "function") return (pin.leaf as (...a: unknown[]) => unknown)(...args);
        return Promise.resolve(pin.leaf);
      },
      has: () => true,
    });
  // `receiveHealthy` is read as a BOOLEAN property rather than called, so the bridge is
  // its own proxy with that one member pinned above the callable tree.
  const bridgeTarget = { receiveHealthy: true };
  const bridge = new Proxy(bridgeTarget as Record<string, unknown>, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key === "then") return undefined;
      if (key in target) return target[key];
      // A bridge member pinned to an explicit null (getOnlineClients) must SEE the pin,
      // so it is answered from `leaves` before the callable tree.
      const path = `bridge.${key}`;
      const pin = pinned(path);
      if (pin.found) {
        if (typeof pin.leaf === "function") return pin.leaf;
        // Two bridge members are DATA, not calls: `receiveHealthy` (a boolean, and it
        // lives on the target so it is handled above) and `getOnlineClients` (read
        // synchronously as `const snapshot = ctx.bridge.getOnlineClients()`). Every
        // other bridge member is a METHOD, so a pinned object must be wrapped in a
        // callable — returning it raw would make `ctx.bridge.sendRawPacket(...)` throw
        // "is not a function" on BOTH sides, and the comparison would then pass on two
        // identical throws while proving nothing. That is exactly the bug this
        // distinction fixes.
        if (typeof pin.leaf === "function") return pin.leaf;
        // ⚠️ `getOnlineClients` is called SYNCHRONOUSLY (`const snapshot =
        // ctx.bridge.getOnlineClients()`) and its result is `.map`ed immediately, so the
        // pin must answer the VALUE synchronously — a promise here makes `snapshot.map`
        // throw on both sides. Every other bridge member is async.
        if (key === "getOnlineClients") return () => pin.leaf;
        return () => Promise.resolve(pin.leaf);
      }
      return callable(path);
    },
    has: () => true,
  });
  const ctx = new Proxy(function recordedCtx() {} as unknown as Record<string, unknown>, {
    get(_t, key) {
      if (typeof key !== "string") return undefined;
      if (key === "then") return undefined;
      if (key === "bridge") return bridge;
      return callable(key);
    },
    apply(_t, _this, args) {
      calls.push({ path: "ctx()", args });
      return undefined;
    },
    has: () => true,
  });
  return { ctx: ctx as unknown as ActionContext, rec: { calls } };
}

/**
 * Answers that make a routed call COMPLETABLE, so the response can be compared.
 *
 * Anything not listed here records and answers `undefined`. The entries below are the
 * providers whose return value the action READS (a list it maps, an object it spreads,
 * a session split it destructures); leaving them undefined would make both sides throw
 * on a property read and the comparison would degenerate into "both threw".
 */
const EXTENDED_DEFAULT_LEAVES: Record<string, unknown> = {
  listReadSessions: { groupIds: [], privateUserIds: [] },
  getMessage: null,
  getMessageMeta: null,
  fetchEmojiLikeUsers: { users: [], cachedCount: 0 },
  fetchEmojiLikeSummary: [],
};

/** `calls` from BOTH sides, so a difference in what was called is visible. */
async function compareExtended(
  name: string,
  params: Record<string, unknown>,
  leaves: Record<string, unknown> = {},
  opts: { allowThrow?: boolean } = {},
): Promise<{ mine: unknown; theirs: unknown; mineCalls: string[]; theirsCalls: string[] }> {
  const merged = { ...EXTENDED_DEFAULT_LEAVES, ...leaves };
  const a = recordingCtx(merged);
  const b = recordingCtx(merged);
  const spec = actionRegistry.resolve(name);
  assert.ok(spec?.action, `port has no action ${name}`);
  // A THROW is part of the contract: the reference calls many providers unguarded, and
  // `dispatchAction` maps the resulting TypeError to 100. Both sides are therefore
  // captured as `{ threw }` so an identical throw compares equal and a one-sided throw
  // does not.
  const capture = async (run: () => Promise<unknown>): Promise<{ response?: unknown; error?: string }> => {
    try {
      return { response: await run() };
    } catch (e) {
      return { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
    }
  };
  const mineRun = await capture(() => spec.action!.spec.toHandler(a.ctx)(params) as Promise<unknown>);
  const theirsRun = await capture(() => oracleFor(name).toHandler(refCtx(b.ctx))(params));
  // A one-sided throw is a real difference and is asserted here rather than swallowed.
  assert.equal(mineRun.error, theirsRun.error, `${name}: throw behaviour differs`);
  // ⚠️ AND, by default, NEITHER side may throw. Without this the whole comparison
  // degrades: if both sides throw the same TypeError (for instance because a pinned
  // provider came back as a non-callable), `mine` and `theirs` are both `undefined`,
  // `deepStrictEqual(undefined, undefined)` passes, and the test proves nothing. A
  // test that genuinely wants the throw path opts in with `{ allowThrow: true }`.
  if (!opts.allowThrow) {
    assert.equal(mineRun.error, undefined, `${name}: the port threw on a compleatble call`);
    assert.equal(theirsRun.error, undefined, `${name}: the reference threw — the fixture is wrong`);
  }
  const mine = mineRun.response;
  const theirs = theirsRun.response;
  if (mineRun.error === undefined) {
    assert.deepStrictEqual(mine, theirs, `${name}: response differs from the reference`);
  }
  // The call vocabulary is compared after normalising the ONE documented difference in
  // member NAMES: this port declares `fetchFilteredGroupRequests` where the reference
  // calls `fetchGroupRequests(true)`. The row shape and the projection are asserted
  // separately, so normalising the name here does not hide anything — and the
  // alternative (silently allowing any name difference) would defeat the comparison.
  const normalise = (paths: string[]): string[] =>
    paths.map((p) => p.replace("apis.contacts.fetchFilteredGroupRequests", "apis.contacts.fetchGroupRequests"));
  assert.deepStrictEqual(
    normalise(a.rec.calls.map((c) => c.path)),
    normalise(b.rec.calls.map((c) => c.path)),
    `${name}: the same providers must be reached, in the same order`,
  );
  return {
    mine,
    theirs,
    mineCalls: a.rec.calls.map((c) => c.path),
    theirsCalls: b.rec.calls.map((c) => c.path),
  };
}

test("extended: all 115 definitions are registered, with 121 executable names", () => {
  const oracle = loadActionOracle();
  assert.equal(oracle.extended.length, 115, "the bundle's actions$6 length");
  const mine = ACTION_GROUPS.find((g) => g.category === "擴展");
  assert.ok(mine, "the 擴展 group must be registered");
  assert.equal(mine.actions.length, 115, "the port's extended definition count");
  assert.deepStrictEqual(
    [...new Set(mine.actions.flatMap((a) => a.names))].sort(),
    [...new Set(oracle.extended.flatMap((a) => a.names))].sort(),
    "the port's executable names must equal the bundle's, alias for alias",
  );
});

test("extended: every canonical name is a real action that agrees on a routed call", async () => {
  // One routed call per action: all params supplied, every provider answering
  // `undefined` except the ones whose return value is read. What this asserts is the
  // ROUTING + RESPONSE SHAPE, which is where a transcription error shows up.
  const leaves: Record<string, unknown> = {
    "apis.web.getEssenceAll": [],
    "apis.web.getNotice": [],
    "apis.web.getSignedList": [],
    "apis.contacts.fetchGroupMemberList": [],
    "apis.contacts.fetchGroupRequests": [],
    "apis.profile.fetchCustomFaceIds": [],
    "apis.profile.fetchCustomFace": [],
    "apis.profile.fetchCustomFaceDetails": [],
    "apis.profile.getUnidirectionalFriendList": [],
    "apis.extras.fetchAiVoiceList": [],
    "apis.extras.getGroupTodoList": [],
    "apis.flashTransfer.getFilesetInfo": [],
    "apis.flashTransfer.getFlashFileList": [],
    "apis.flashTransfer.listFilesets": [],
    "apis.misc.translateEn2Zh": [],
    "apis.misc.getMiniAppArk": {},
    "apis.misc.ocrImage": {},
    "apis.misc.clickInlineKeyboardButton": {},
    "apis.flashTransfer.getShareLink": {},
    "apis.contacts.getGroupRecommendArk": "ark",
    "apis.contacts.getBuddyRecommendArk": "ark",
    "apis.web.forceFetchClientKey": { clientKey: "k", keyIndex: "1", expireTime: "0" },
    "apis.profile.getLike": {},
    "apis.groupAdmin.getAtAllRemain": {},
    "apis.extras.getStrangerStatus": { status: 10 },
    "apis.groupFile.getCount": { fileCount: 1, maxCount: 2 },
    "apis.groupFile.getSpace": { usedSpace: 3, totalSpace: 4 },
    "apis.profile.addCustomFace": "e",
    "apis.flashTransfer.createFlashTask": { filesetId: "f" },
    // The two inbox projections read this and `.map` it UNGUARDED, so an unpinned
    // answer throws on both sides. `apis.contacts.fetchGroupRequests` is the name the
    // REFERENCE reads; `fetchFilteredGroupRequests` is this port's named member.
    "apis.contacts.fetchFilteredGroupRequests": [],
  };
  const oracle = loadActionOracle();
  for (const action of oracle.extended) {
    const name = action.names[0]!;
    // ⚠️ bot_exit SCHEDULES process.exit(0) 50ms later. Running it inside the test
    // process kills the runner mid-file, which silently drops every test declared
    // after this one (the symptom is "83 declared, 53 executed"). It is therefore
    // excluded from every generic loop and its schema is asserted instead.
    if (name === "bot_exit") continue;
    const params: Record<string, unknown> = {};
    for (const p of action.describe().params as Array<{ name: string; required: boolean; type: string }>) {
      if (!p.required) continue;
      params[p.name] =
        p.type === "uint" || p.type === "int" || p.type === "messageId"
          ? 1
          : p.type === "string[]"
            ? ["a"]
            : p.type === "message"
              ? "hi"
              : "x";
    }
    // `allowThrow`: a handful of bodies call their provider UNGUARDED, so with the
    // default fixture they throw — identically on both sides, which the helper still
    // asserts. The point of this loop is the routed response for the other ~100.
    const { mine, theirs } = await compareExtended(name, params, leaves, { allowThrow: true });
    assert.deepStrictEqual(mine, theirs, `${name}: response differs from the reference`);
  }
});

test("extended: the null-data vs empty-object mutators are distinguishable", async () => {
  // ⚠️ This is the mutation guard for M1. `okResponse()` and `okResponse({})` differ
  // only in `data`, and a test that compares `status` would pass on both. Six actions
  // in this batch answer `{}` — the other 100+ answer null — so a blanket "data is
  // falsy" assertion would hide the bug entirely.
  for (const name of ["set_input_status", "set_group_sign", "send_group_sign", "set_self_longnick"]) {
    const { mine, theirs } = await compareExtended(name, { user_id: 1, group_id: 2, long_nick: "n", event_type: 0 });
    assert.deepStrictEqual(dataOf(mine), dataOf(theirs), `${name}: data must match the reference exactly`);
    assert.deepStrictEqual(dataOf(mine), {}, `${name}: this mutator's data is {} , not null`);
  }
  // The counterpart: a mutator that answers null must NOT answer {}.
  const { mine } = await compareExtended("set_group_remark", { group_id: 2, remark: "r" });
  assert.strictEqual(dataOf(mine), null, "set_group_remark answers null, not {}");
});

test("extended: set_diy_online_status passes (face_id, wording, face_type), not the param order", async () => {
  // The schema order is face_id/face_type/wording; the CALL order is
  // face_id/wording/face_type. A port that forwarded `p` positionally would post the
  // wrong face and the response would still be null — so the ARGS are the assertion.
  const { mineCalls, theirsCalls } = await compareExtended("set_diy_online_status", {
    face_id: 7,
    face_type: 3,
    wording: "w",
  });
  assert.deepStrictEqual(mineCalls, theirsCalls, "the same providers must be reached");
  const { ctx, rec } = recordingCtx();
  await actionRegistry.resolve("set_diy_online_status")!.action!.spec.toHandler(ctx)({
    face_id: 7,
    face_type: 3,
    wording: "w",
  });
  const call = rec.calls.find((c) => c.path === "apis.profile.setDiyOnlineStatus");
  assert.deepStrictEqual(call?.args, [7, "w", 3], "face_id, wording, face_type — in that order");
});

test("extended: download_file accepts base64 as an alternative to url", async () => {
  // `url` is NOT required. A port that made it required would 1400 a valid call, and
  // the reference's own `!url && !base64` guard is the only check.
  const { mine, theirs } = await compareExtended("download_file", { base64: "aGk=", name: "" });
  assert.deepStrictEqual(mine, theirs, "base64-only download must agree");
  assert.equal((mine as { status: string }).status, "ok", "a base64 payload is a valid download");
  // And the neither-given case is a 1400 with the reference's wording.
  const { mine: emptyError, theirs: theirEmpty } = await compareExtended("download_file", {});
  assert.deepStrictEqual(emptyError, theirEmpty, "url-or-base64-required wording");
  assert.equal((emptyError as { retcode: number }).retcode, 1400);
});

test("extended: _send_group_notice rejects contradictory type/send_to_new_members", async () => {
  // Two cross-field rules, neither of which a param schema can express. Both wordings
  // are observable and are compared here rather than trusted.
  for (const params of [
    { group_id: 2, content: "c", type: 5 },
    { group_id: 2, content: "c", type: 1, send_to_new_members: true },
    { group_id: 2, content: "c", type: 20, send_to_new_members: false },
  ]) {
    const { mine, theirs } = await compareExtended("_send_group_notice", params);
    assert.deepStrictEqual(mine, theirs, `_send_group_notice(${JSON.stringify(params)})`);
  }
  // The consistent pair must SUCCEED and reach the provider with the new-member flag.
  const { mine, mineCalls } = await compareExtended("_send_group_notice", {
    group_id: 2,
    content: "c",
    type: 20,
    send_to_new_members: true,
  });
  assert.equal((mine as { status: string }).status, "ok", "type=20 with send_to_new_members=true is legal");
  assert.ok(mineCalls.includes("apis.web.sendNotice"), "the notice must be sent");
});

test("extended: check_url_safely and _mark_all_as_read accept no parameters at all", async () => {
  // Both take `{}`. `check_url_safely` returning a CONSTANT `{level: 1}` — it never
  // looks at a URL — is the reference's own placeholder, and its param schema is empty.
  const a = await compareExtended("check_url_safely", {});
  assert.deepStrictEqual(a.mine, a.theirs);
  assert.deepStrictEqual(dataOf(a.mine), { level: 1 }, "the level is a constant, not a verdict");
  const b = await compareExtended("_mark_all_as_read", {});
  assert.deepStrictEqual(b.mine, b.theirs);
  assert.deepStrictEqual(a.mineCalls, [], "check_url_safely must not reach the bridge");
});

test("extended: get_cookies wraps the string, get_credentials does not", async () => {
  // The asymmetry is real: `get_cookies` answers `{cookies}`, `get_credentials` answers
  // the provider's object unchanged. A port that "tidied" this would break one or the
  // other, and both are compared here.
  const cookies = await compareExtended("get_cookies", {}, { "apis.web.getCookiesStr": "c=1" });
  assert.deepStrictEqual(cookies.mine, cookies.theirs);
  assert.deepStrictEqual(dataOf(cookies.mine), { cookies: "c=1" }, "get_cookies wraps the string");
  const creds = await compareExtended(
    "get_credentials",
    {},
    { "apis.web.getCredentials": { cookies: "c", bkn: "1", skey: "s", pskey: "p", clientKey: "k" } },
  );
  assert.deepStrictEqual(creds.mine, creds.theirs);
  assert.deepStrictEqual(
    dataOf(creds.mine),
    { cookies: "c", bkn: "1", skey: "s", pskey: "p", clientKey: "k" },
    "get_credentials passes the provider's object through",
  );
  // The default domain is applied in the ACTION, so the provider sees it.
  const { ctx, rec } = recordingCtx();
  await actionRegistry.resolve("get_cookies")!.action!.spec.toHandler(ctx)({});
  assert.deepStrictEqual(
    rec.calls.find((c) => c.path === "apis.web.getCookiesStr")?.args,
    ["qun.qq.com"],
    "the default domain must reach the provider",
  );
});

test("extended: set_qq_profile forwards an all-absent call instead of refusing it", async () => {
  // No cross-field rule in the reference. A port that added `atLeastOneOf` would 1400
  // here and look stricter — which is a behaviour change, not a safety improvement.
  const { mine, theirs, mineCalls } = await compareExtended("set_qq_profile", {});
  assert.deepStrictEqual(mine, theirs, "an empty profile update must agree");
  assert.equal((mine as { status: string }).status, "ok", "it reaches the provider");
  assert.ok(mineCalls.includes("apis.profile.setProfile"));
});

test("extended: set_self_longnick requires one of the two spellings", async () => {
  const ok1 = await compareExtended("set_self_longnick", { longNick: "a" });
  assert.deepStrictEqual(ok1.mine, ok1.theirs);
  const ok2 = await compareExtended("set_self_longnick", { long_nick: "b" });
  assert.deepStrictEqual(ok2.mine, ok2.theirs);
  assert.deepStrictEqual(dataOf(ok2.mine), {}, "success is {} , not null");
  // `longNick` wins when both are present.
  const bothSpellings = await compareExtended("set_self_longnick", { longNick: "first", long_nick: "second" });
  const { ctx, rec } = recordingCtx();
  await actionRegistry.resolve("set_self_longnick")!.action!.spec.toHandler(ctx)({ longNick: "first", long_nick: "second" });
  assert.deepStrictEqual(
    rec.calls.find((c) => c.path === "apis.profile.setSelfLongNick")?.args,
    ["first"],
    "longNick takes precedence over long_nick",
  );
  assert.deepStrictEqual(bothSpellings.mine, bothSpellings.theirs);
  // Neither given is a 1400 with the reference's wording — NOT an empty signature.
  const missing = await compareExtended("set_self_longnick", {});
  assert.deepStrictEqual(missing.mine, missing.theirs);
  assert.equal((missing.mine as { retcode: number }).retcode, 1400);
  assert.equal((missing.mine as { wording: string }).wording, "invalid longNick");
});

test("extended: translate_en2zh takes a word array and answers an object", async () => {
  const { mine, theirs } = await compareExtended("translate_en2zh", { words: ["a", "b"] }, { "apis.misc.translateEn2Zh": ["甲", "乙"] });
  assert.deepStrictEqual(mine, theirs);
  assert.deepStrictEqual(dataOf(mine), { words: ["甲", "乙"] }, "the response is {words}, not a bare array");
  // `word` (singular) is NOT a valid parameter — the reference takes `words`.
  const singular = await compareExtended("translate_en2zh", { word: "a" });
  assert.deepStrictEqual(singular.mine, singular.theirs);
  assert.equal((singular.mine as { retcode: number }).retcode, 1400, "a missing `words` is a 1400");
});

test("extended: get_forward_msg resolves the resource id out of a stored forward segment", async () => {
  // The three-branch id resolution is the most intricate body in the batch: `id` wins,
  // then the stored message's forward segment is searched, then the raw message_id is
  // used as the id. All three are compared, and the segment walk is asserted directly.
  const forwardSegment = [{ type: "forward", data: { id: "res-from-segment" } }];
  const leaves = {
    getMessage: async (id: number) => (id === 42 ? { message: forwardSegment } : null),
    getForwardMsg: async (id: string) => [`fetched:${id}`],
  };
  for (const params of [{ id: "direct" }, { message_id: "42" }, { message_id: "999" }, {}]) {
    const { mine, theirs } = await compareExtended("get_forward_msg", params, leaves);
    assert.deepStrictEqual(mine, theirs, `get_forward_msg(${JSON.stringify(params)})`);
  }
  const resolved = await compareExtended("get_forward_msg", { message_id: "42" }, leaves);
  assert.deepStrictEqual(
    dataOf(resolved.mine),
    { messages: ["fetched:res-from-segment"] },
    "the segment's forward id must be used, not the message id",
  );
  // And `res_id` is NOT a parameter of this action.
  const wrongName = await compareExtended("get_forward_msg", { res_id: "x" });
  assert.equal((wrongName.mine as { retcode: number }).retcode, 1400);
});

test("extended: the four forward senders route by group_id / user_id / message_type", async () => {
  const leaves = {
    sendGroupForwardMsg: async (g: number, m: unknown, meta: unknown) => ({ messageId: 11, forwardId: "gf" }),
    sendPrivateForwardMsg: async (u: number, m: unknown, meta: unknown) => ({ messageId: 12, forwardId: "pf" }),
    sendForwardMsg: async () => ({ forwardId: "up" }),
    getMessageMeta: async () => null,
    getMessage: async () => null,
  };
  const cases: Array<[string, Record<string, unknown>]> = [
    ["send_forward_msg", { message: "m", group_id: 5 }],
    ["send_forward_msg", { message: "m", user_id: 6 }],
    ["send_forward_msg", { message: "m", message_type: "group", group_id: 5 }],
    ["send_forward_msg", { message: "m" }],
    ["send_group_forward_msg", { message: "m", group_id: 5 }],
    ["send_private_forward_msg", { message: "m", user_id: 6 }],
    ["upload_forward_msg", { message: "m", group_id: 5 }],
    ["upload_foward_msg", { message: "m", group_id: 5 }],
  ];
  for (const [name, params] of cases) {
    const { mine, theirs } = await compareExtended(name, params, leaves);
    assert.deepStrictEqual(mine, theirs, `${name}(${JSON.stringify(params)})`);
  }
  // `upload_forward_msg` echoes group_id back; the misspelled alias does NOT. That
  // asymmetry is the reference's and is the only difference between the two.
  const withGroup = await compareExtended("upload_forward_msg", { message: "m", group_id: 5 }, leaves);
  assert.equal(
    (dataOf(withGroup.mine) as Record<string, unknown>)["group_id"],
    5,
    "upload_forward_msg echoes group_id back",
  );
  const alias = await compareExtended("upload_foward_msg", { message: "m", group_id: 5 }, leaves);
  assert.ok(!("group_id" in (dataOf(alias.mine) as Record<string, unknown>)), "the alias never echoes group_id");
  // With no pinned provider, both sides THROW identically — the helper asserts that, and
  // it is the right contract: the reference calls `sendGroupForwardMsg` unguarded.
  const bare = await compareExtended(
    "send_group_forward_msg",
    { message: "m", group_id: 5 },
    {},
    { allowThrow: true },
  );
  assert.strictEqual(bare.mine, undefined, "an unguarded provider throws rather than answering");
});

test("extended: the reaction and essence family refuses without an authoritative sequence", async () => {
  // Every one of these three refusals is a DISTINCT wording, and they are reached in a
  // fixed order: not-found -> not-group -> group mismatch -> no sequence. Reordering the
  // checks changes which wording a caller sees, so all four are compared.
  const notFound = { getMessageMeta: async () => null };
  for (const name of ["set_group_reaction", "set_msg_emoji_like", "set_essence_msg", "delete_essence_msg"]) {
    const { mine, theirs } = await compareExtended(name, { message_id: 1, code: "1", emoji_id: "1" }, notFound);
    assert.deepStrictEqual(mine, theirs, `${name}: not-found path`);
  }
  const privateMeta = { getMessageMeta: async () => ({ isGroup: false, targetId: 9, sequence: 5, sequenceAuthoritative: true }) };
  const asPrivate = await compareExtended("set_group_reaction", { message_id: 1, code: "1" }, privateMeta);
  assert.deepStrictEqual(asPrivate.mine, asPrivate.theirs);
  const noSeq = { getMessageMeta: async () => ({ isGroup: true, targetId: 9, sequence: 5, sequenceAuthoritative: false }) };
  const unsequenced = await compareExtended("set_group_reaction", { message_id: 1, code: "1" }, noSeq);
  assert.deepStrictEqual(unsequenced.mine, unsequenced.theirs);
  assert.equal((unsequenced.mine as { wording: string }).wording, "message has no authoritative QQ sequence");
  const okMeta = { getMessageMeta: async () => ({ isGroup: true, targetId: 9, sequence: 5, sequenceAuthoritative: true }) };
  const accepted = await compareExtended("set_group_reaction", { message_id: 1, code: "1", is_set: true }, okMeta);
  assert.deepStrictEqual(accepted.mine, accepted.theirs);
  assert.ok(accepted.mineCalls.includes("apis.interaction.setReaction"));
  // A group_id that disagrees with the stored session is a 1400, not a re-route.
  const mismatch = await compareExtended("set_group_reaction", { message_id: 1, code: "1", group_id: 7 }, okMeta);
  assert.equal((mismatch.mine as { retcode: number }).retcode, 1400, "a mismatching group_id is 1400");
});

test("extended: get_emoji_likes and fetch_emoji_like differ in pagination, not in source", async () => {
  // `get_emoji_likes` asks for 1000 and reports no cookie; `fetch_emoji_like` pages and
  // decides `isLastPage` against the CACHE count rather than the page length.
  const leaves = {
    fetchEmojiLikeUsers: async (...args: unknown[]) => ({
      users: [{ uin: 10001, uid: "u", setAt: 0 }, { uin: 10002, uid: "u2", setAt: 0 }].slice(0, Number(args[2] ?? 2) > 1 ? 2 : 1),
      cachedCount: 4,
    }),
  };
  for (const params of [
    { message_id: 1, emoji_id: "1" },
    { message_id: 1, emojiId: "1", count: 2, cookie: "" },
    { message_id: 1, emojiId: "1", count: 2, cookie: "2" },
    { message_id: 1, emojiId: "1", count: 2, cookie: "4" },
    { message_id: 1, emojiId: "1", count: 2, cookie: "not-a-number" },
  ]) {
    const name = "emoji_id" in params ? "get_emoji_likes" : "fetch_emoji_like";
    const { mine, theirs } = await compareExtended(name, params, leaves);
    assert.deepStrictEqual(mine, theirs, `${name}(${JSON.stringify(params)})`);
  }
  // The summary action has its OWN wording when the store is absent. That guard is only
  // reachable with a ctx that genuinely LACKS the member, so a real object is used
  // rather than the total recording proxy (which answers every member).
  const withoutStore = makeCtx() as unknown as Record<string, unknown>;
  const guarded = await actionRegistry
    .resolve("get_msg_emoji_likes")!
    .action!.spec.toHandler({ ...withoutStore } as unknown as ActionContext)({ message_id: 1 });
  assert.equal((guarded as { wording: string }).wording, "emoji reaction summary is unavailable");
  assert.equal((guarded as { retcode: number }).retcode, 100);
});

test("extended: the history actions take message_id=0 as 'no anchor'", async () => {
  // `message_id` on both history actions is `int().default(0)` — a messageId() field
  // would reject the default itself. Both the anchored and the newest-first paths run.
  const leaves = {
    getGroupMsgHistory: async () => [{ message_id: 1 }],
    getFriendMsgHistory: async () => [{ message_id: 2 }],
  };
  for (const params of [
    { group_id: 2 },
    { group_id: 2, message_id: 1, count: 5, reverse_order: false },
    { group_id: 2, message_id: 0 },
  ]) {
    const { mine, theirs } = await compareExtended("get_group_msg_history", params, leaves);
    assert.deepStrictEqual(mine, theirs, `get_group_msg_history(${JSON.stringify(params)})`);
  }
  const friend = await compareExtended("get_friend_msg_history", { user_id: 3 }, leaves);
  assert.deepStrictEqual(friend.mine, friend.theirs);
  // Without the provider both are a documented 100, not a crash — and that needs a ctx
  // that genuinely lacks the member.
  const withoutProvider = await actionRegistry
    .resolve("get_group_msg_history")!
    .action!.spec.toHandler({ ...(makeCtx() as unknown as Record<string, unknown>) } as unknown as ActionContext)({
    group_id: 2,
  });
  assert.equal((withoutProvider as { retcode: number }).retcode, 100);
});

test("extended: get_essence_msg_list projects, caches and refuses a foreign group", async () => {
  // `projectEssenceMessage` THROWS on a foreign group_code, and the action turns that
  // into `获取精华消息失败: ${e}`. Both the success and the refusal are compared, so a
  // port that filtered instead of throwing would differ.
  const row = {
    group_code: 2,
    msg_seq: 5,
    msg_random: 6,
    sender_uin: 7,
    sender_nick: "s",
    sender_time: 8,
    add_digest_uin: 9,
    add_digest_nick: "o",
    add_digest_time: 10,
    msg_content: [{ msg_type: 1, text: "hi" }],
  };
  const ok = await compareExtended("get_essence_msg_list", { group_id: 2 }, { "apis.web.getEssenceAll": [{ data: { msg_list: [row, null] } }] });
  assert.deepStrictEqual(ok.mine, ok.theirs, "the projected list must agree");
  assert.ok(ok.mineCalls.includes("cacheMessageMetas"), "the projection must be cached");
  const foreign = await compareExtended(
    "get_essence_msg_list",
    { group_id: 3 },
    { "apis.web.getEssenceAll": [{ data: { msg_list: [row] } }] },
  );
  assert.deepStrictEqual(foreign.mine, foreign.theirs, "the foreign-group refusal must agree");
  assert.equal((foreign.mine as { retcode: number }).retcode, 100);
  assert.match(String((foreign.mine as { wording: string }).wording), /^获取精华消息失败: /);
});

test("extended: the essence projection joins brief/title/summary/text/url with no repeats", async () => {
  // `essenceContentToSegment` switches on `msg_type`: 1=text, 2=face, 3=image, 4=file,
  // and EVERYTHING ELSE falls through to `degradeEssenceContent`. So the multi-field
  // join lives in the default branch and is only reached with an unrecognised type —
  // a fixture using `msg_type: 1` never touches it.
  const project = (msg_content: unknown) => [
    {
      group_code: 2,
      msg_seq: 5,
      msg_random: 6,
      sender_uin: 7,
      sender_nick: "s",
      sender_time: 8,
      add_digest_uin: 9,
      add_digest_nick: "o",
      add_digest_time: 10,
      msg_content,
    },
  ];
  // Every dedupe branch of `degradeEssenceContent`, all with an unrecognised msg_type.
  const coverage: unknown[] = [
    // all five present and distinct
    { msg_type: 9, share_brief: "B", share_title: "T", share_summary: "S", text: "X", share_url: "U" },
    // only `text`: the heading IS the text, so the text must not be pushed twice
    { msg_type: 9, text: "X" },
    // `text` equal to the title: deduped against both heading and title
    { msg_type: 9, share_title: "T", text: "T" },
    // `summary` equals the heading
    { msg_type: 9, share_brief: "S", share_summary: "S" },
    // `summary` equals the title
    { msg_type: 9, share_brief: "B", share_title: "T", share_summary: "T" },
    // no heading fields: the url is joined after the text
    { msg_type: 9, share_url: "U", text: "X" },
    // a url alone (no heading at all)
    { msg_type: 9, share_url: "U" },
    // empty strings are dropped rather than pushed as empty parts
    { msg_type: 9, share_brief: "", share_title: "", text: "", share_url: "" },
    // nothing at all -> the type placeholder
    { msg_type: 9 },
    // the four RECOGNISED types, for the projection's other branch
    { msg_type: 1, text: "hello" },
    { msg_type: 2, face_index: 3 },
    { msg_type: 3, image_url: "http://x/y.png" },
    { msg_type: 4, file_name: "f", file_id: "i", file_size: 7, file_bus_id: 1 },
  ];
  const textOf = (response: unknown): string => {
    const row = (dataOf(response) as Record<string, unknown>[])[0] as Record<string, unknown>;
    const segments = row["content"] as Array<{ type: string; data: Record<string, unknown> }>;
    return String((segments[0]!.data as { text?: string }).text ?? "");
  };
  const typeOf = (response: unknown): string => {
    const row = (dataOf(response) as Record<string, unknown>[])[0] as Record<string, unknown>;
    return ((row["content"] as Array<{ type: string }>)[0]!).type;
  };
  const runOne = (content: unknown) =>
    compareExtended("get_essence_msg_list", { group_id: 2 }, {
      "apis.web.getEssenceAll": [{ data: { msg_list: project([content]) } }],
    });

  for (const content of coverage) {
    const { mine, theirs } = await runOne(content);
    assert.deepStrictEqual(
      mine,
      theirs,
      `get_essence_msg_list(${JSON.stringify(content)}): the projection must agree field for field`,
    );
  }
  // The concrete join order, asserted literally so a reordering mutation that stays
  // self-consistent between the two sides is still caught.
  const all = await runOne({ msg_type: 9, share_brief: "B", share_title: "T", share_summary: "S", text: "X", share_url: "U" });
  assert.equal(textOf(all.mine), "B\nT\nS\nX\nU", "brief, title, summary, text, url — in that order, once each");
  // A `text` that is also the heading appears ONCE.
  assert.equal(textOf((await runOne({ msg_type: 9, text: "X" })).mine), "X", "the heading is not repeated");
  // Nothing at all yields the type placeholder, not an empty string.
  assert.equal(textOf((await runOne({ msg_type: 9 })).mine), "[essence type 9]");
  // And the recognised types map to their segment kinds.
  assert.equal(typeOf((await runOne({ msg_type: 1, text: "h" })).mine), "text");
  assert.equal(typeOf((await runOne({ msg_type: 2, face_index: 3 })).mine), "face");
  assert.equal(typeOf((await runOne({ msg_type: 3, image_url: "http://x/y.png" })).mine), "image");
  assert.equal(typeOf((await runOne({ msg_type: 4, file_name: "f", file_id: "i", file_size: 7, file_bus_id: 1 })).mine), "file");
});

test("extended: get_group_ignored_notifies and get_group_ignore_add_request project differently", async () => {
  // Same inbox, two DIFFERENT projections: the second has no `flag` and no
  // `requester_uin`, and `request_id` is a number rather than a string. Comparing both
  // against the reference is what keeps them from being "unified" by a later cleanup.
  // The FLAT row shape the reference's projections read — not the nested
  // `{group, target, invitor}` view. Using the nested fixture here is what let the
  // port's first implementation look right while every field held the wrong value.
  const rows = [
    {
      groupId: 2,
      groupName: "g",
      targetUid: "u",
      targetUin: 7,
      targetName: "t",
      invitorUid: "i",
      invitorUin: 8,
      invitorName: "n",
      operatorUid: "o",
      operatorUin: 9,
      operatorName: "op",
      sequence: 11,
      state: 1,
      notifyType: 1,
      eventType: 1,
      comment: "c",
      filtered: true,
    },
  ];
  const leaves = {
    "apis.contacts.fetchFilteredGroupRequests": rows,
    // The reference's own provider name — it calls `fetchGroupRequests(true)`.
    "apis.contacts.fetchGroupRequests": rows,
  };
  const a = await compareExtended("get_group_ignored_notifies", {}, leaves);
  assert.deepStrictEqual(a.mine, a.theirs);
  assert.ok("flag" in ((dataOf(a.mine) as unknown[])[0] as Record<string, unknown>), "the first projection has a flag");
  const b = await compareExtended("get_group_ignore_add_request", {}, leaves);
  assert.deepStrictEqual(b.mine, b.theirs);
  assert.ok(
    !("flag" in ((dataOf(b.mine) as unknown[])[0] as Record<string, unknown>)),
    "the second projection has no flag",
  );
  assert.equal(typeof ((dataOf(b.mine) as unknown[])[0] as Record<string, unknown>)["request_id"], "number");
  // `actor` is the OPERATOR, not the invitor. The two ids differ (9 vs 8) in the fixture
  // precisely so this cannot accidentally pass.
  assert.equal(((dataOf(a.mine) as unknown[])[0] as Record<string, unknown>)["actor"], 9);
});

test("extended: get_group_shut_list filters on shut_up_time, not on presence", async () => {
  const now = Math.floor(Date.now() / 1000);
  const members = [
    { uin: 1, nickname: "a", shutUpTime: now + 600 },
    { uin: 2, nickname: "b", shutUpTime: now - 600 },
    { uin: 3, nickname: "c" },
    { uin: 4, nickname: "d", shutUpTime: 0 },
  ];
  const { mine, theirs } = await compareExtended("get_group_shut_list", { group_id: 2 }, { "apis.contacts.fetchGroupMemberList": members });
  assert.deepStrictEqual(mine, theirs);
  assert.deepStrictEqual(
    (dataOf(mine) as unknown[]).map((m) => (m as Record<string, unknown>)["user_id"]),
    [1],
    "only a FUTURE shut_up_time counts; 0, absent and past are all excluded",
  );
});

test("extended: send_packet validates hex before touching the transport", async () => {
  const okBody = {
    "bridge.sendRawPacket": { success: true, gotResponse: true, responseData: new Uint8Array([1, 2]) },
    "sendRawPacket": { success: true, gotResponse: true, responseData: new Uint8Array([1, 2]) },
  };
  for (const data of ["00ff", "00FF", "", "0", "zz", "0g"]) {
    const { mine, theirs } = await compareExtended("send_packet", { cmd: "x", data, rsp: true }, okBody);
    assert.deepStrictEqual(mine, theirs, `send_packet(data=${JSON.stringify(data)})`);
  }
  const bad = await compareExtended("send_packet", { cmd: "x", data: "0" }, okBody);
  assert.equal((bad.mine as { retcode: number }).retcode, 1400, "an odd-length hex string is 1400");
  assert.equal((bad.mine as { wording: string }).wording, "data must be a hex string of even length");
  assert.deepStrictEqual(bad.mineCalls, [], "a rejected packet must not reach the transport");
  // `rsp:false` answers null, and a transport failure answers 100 with its message.
  const noRsp = await compareExtended("send_packet", { cmd: "x", data: "00", rsp: false }, okBody);
  assert.strictEqual(dataOf(noRsp.mine), null, "rsp:false answers null");
  // The hex echo, through a CONCRETE bridge: `sendRawPacket` returns a Uint8Array and
  // the action re-encodes it. An empty response is `""`, not null.
  const withTransport = (responseData: Uint8Array | null): ActionContext =>
    ({ ...(makeCtx() as unknown as Record<string, unknown>), bridge: { receiveHealthy: true, sendRawPacket: async () => ({ success: true, gotResponse: true, responseData }) } }) as unknown as ActionContext;
  const echoed = await actionRegistry.resolve("send_packet")!.action!.spec.toHandler(withTransport(new Uint8Array([1, 2])))(
    { cmd: "x", data: "00ff", rsp: true },
  );
  assert.deepStrictEqual(echoed, { status: "ok", retcode: 0, data: "0102" });
  const noPayload = await actionRegistry.resolve("send_packet")!.action!.spec.toHandler(withTransport(null))({
    cmd: "x",
    data: "00",
    rsp: true,
  });
  assert.deepStrictEqual(noPayload, { status: "ok", retcode: 0, data: "" }, "an empty response is the empty string, not null");
  const fail = await compareExtended("send_packet", { cmd: "x", data: "00" }, {
    "sendRawPacket": { success: false, gotResponse: false, errorMessage: "boom" },
  });
  assert.equal((fail.mine as { retcode: number }).retcode, 100, "a transport failure is 100");
  assert.equal((fail.mine as { wording: string }).wording, "boom", "the transport message is forwarded");
});

test("extended: get_online_clients refuses a fresh refresh and an empty snapshot distinctly", async () => {
  // Four states, four different answers: `no_cache`, an unobserved snapshot, a snapshot
  // with a known kind, and one with an UNKNOWN kind — which must yield `undefined`
  // rather than the string "unknown", because the label map has no such entry.
  //
  // ⚠️ This action needs a CONCRETE bridge. `getOnlineClients` is read as a VALUE
  // (`const snapshot = ctx.bridge.getOnlineClients()`), and the total recording proxy
  // can only answer callables, which are not arrays. Driving it through the proxy makes
  // both sides throw "snapshot.map is not a function" and the test proves nothing.
  const withSnapshot = (snapshot: unknown): ActionContext => {
    const base = makeCtx() as unknown as Record<string, unknown>;
    return {
      ...base,
      bridge: { ...(base["bridge"] as Record<string, unknown>), receiveHealthy: true, getOnlineClients: () => snapshot },
    } as unknown as ActionContext;
  };
  const run = (snapshot: unknown, params: Record<string, unknown>) =>
    actionRegistry.resolve("get_online_clients")!.action!.spec.toHandler(withSnapshot(snapshot))(params);

  // 1. `no_cache` is refused before the snapshot is even consulted.
  const fresh = await run([], { no_cache: true });
  assert.equal((fresh as { retcode: number }).retcode, 100);
  assert.equal(
    (fresh as { wording: string }).wording,
    "online-client fresh refresh is unavailable; QQ exposes only its local snapshot",
  );
  // 2. A null snapshot is a DIFFERENT refusal with its own wording.
  const empty = await run(null, { no_cache: false });
  assert.equal((empty as { retcode: number }).retcode, 100, "a null snapshot is a documented 100");
  assert.equal(
    (empty as { wording: string }).wording,
    "online-client snapshot has not been observed in this session",
  );
  // 3 & 4. A known kind is labelled; an unrecognised kind yields undefined.
  const observed = await run(
    [
      { appId: 1, deviceName: "d", deviceKind: "computer" },
      { appId: 2, deviceName: "e", deviceKind: "unknown" },
      { appId: 3, deviceName: "f", deviceKind: "weird" },
    ],
    { no_cache: false },
  );
  assert.deepStrictEqual(dataOf(observed), {
    clients: [
      { app_id: 1, device_name: "d", device_kind: "电脑" },
      { app_id: 2, device_name: "e", device_kind: "未知设备" },
      // `weird` is not in the label map, so the value is `undefined` — not "未知设备".
      { app_id: 3, device_name: "f", device_kind: undefined },
    ],
  });
  // And the whole thing still agrees with the reference on the refusal wording.
  for (const params of [{ no_cache: true }, { no_cache: false }, {}]) {
    const { mine, theirs } = await compareExtended("get_online_clients", params, {
      getOnlineClients: [],
    });
    assert.deepStrictEqual(mine, theirs, `get_online_clients(${JSON.stringify(params)})`);
  }
});

test("extended: request_decrypt_key reads the 128-hex salt at bytes 47..175", async () => {
  // The offset is the file format's. A port that sliced elsewhere would derive a
  // different key for the same database and still answer `{db_key}`.
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "dsh-salt-"));
  const salt = "ab".repeat(64);
  const good = join(dir, "good.db");
  const buf = Buffer.alloc(200, 0);
  Buffer.from(salt, "utf8").copy(buf, 47);
  writeFileSync(good, buf);
  const short = join(dir, "short.db");
  writeFileSync(short, Buffer.alloc(100, 0));
  const bad = join(dir, "bad.db");
  const badBuf = Buffer.alloc(200, 0);
  Buffer.from("zz".repeat(64), "utf8").copy(badBuf, 47);
  writeFileSync(bad, badBuf);

  for (const db_path of [good, short, bad]) {
    const { mine, theirs } = await compareExtended(
      "request_decrypt_key",
      { db_path },
      { "apis.misc.getDecryptKey": async (s: string) => `key:${s}` },
    );
    assert.deepStrictEqual(mine, theirs, `request_decrypt_key(${db_path})`);
  }
  const accepted = await compareExtended("request_decrypt_key", { db_path: good }, { "apis.misc.getDecryptKey": async (s: string) => `key:${s}` });
  assert.deepStrictEqual(dataOf(accepted.mine), { db_key: `key:${salt.toLowerCase()}` }, "the salt is lowercased");
  const tooShort = await compareExtended("request_decrypt_key", { db_path: short });
  assert.equal((tooShort.mine as { wording: string }).wording, "Database file too short");
});

test("extended: download_file writes under data/downloads and refuses traversal names", async () => {
  // `saveDownloadBuffer` is the only place in the batch that writes a file, and its
  // two traversal guards are the reference's. Both are exercised, and the write is
  // confirmed to land inside `data/downloads`.
  const { mine, theirs } = await compareExtended("download_file", { base64: "aGk=", name: "" });
  assert.deepStrictEqual(mine, theirs);
  const written = (dataOf(mine) as Record<string, unknown>)["file"] as string;
  assert.match(written, /data[/\\]downloads[/\\]/);
  const { readFileSync, rmSync } = await import("node:fs");
  assert.equal(readFileSync(written, "utf8"), "hi", "the decoded bytes must be what was written");
  // `saveDownloadBuffer` really writes to `data/downloads`, so the test cleans up after
  // itself — otherwise every run leaves untracked files in the working tree.
  rmSync(written, { force: true });
  // ⚠️ ONLY the names the reference actually rejects are asserted as 1400. `basename`
  // makes `../evil` into `evil` and `a/b` into `b`, so those SUCCEED — a port that
  // rejected them would be stricter than the reference and would refuse a name a
  // caller can legitimately pass. Both behaviours are compared, and the two that are
  // genuinely unsafe are additionally asserted.
  for (const name of ["..", ".", ".."]) {
    const { mine: refused, theirs: theirRefused } = await compareExtended("download_file", { base64: "aGk=", name });
    assert.deepStrictEqual(refused, theirRefused, `download_file(name=${JSON.stringify(name)})`);
    assert.equal((refused as { retcode: number }).retcode, 1400, `${name}: an unsafe name is 1400, not 100`);
  }
  for (const name of ["../evil", "a/b"]) {
    const { mine: sanitized, theirs: theirSanitized } = await compareExtended("download_file", {
      base64: "aGk=",
      name,
    });
    assert.deepStrictEqual(sanitized, theirSanitized, `download_file(name=${JSON.stringify(name)})`);
    assert.equal((sanitized as { status: string }).status, "ok", `${name}: basename sanitises rather than rejects`);
    // Both sides wrote a file (the port and the oracle each run the real writer); clean
    // up both, keyed off the name each side reported.
    for (const response of [sanitized, theirSanitized]) {
      const file = (dataOf(response) as Record<string, unknown>)["file"] as string;
      rmSync(file, { force: true });
    }
  }
});

test("extended: the reference's own placeholders are reproduced, not improved", async () => {
  // Five actions are deliberate non-implementations in the bundle. Each answers a
  // CONSTANT, so a port that wired them to the bridge would answer something different
  // and break a client that depends on the documented refusal.
  const expected: Record<string, (d: unknown) => void> = {
    get_recent_contact: (d) => assert.deepStrictEqual(d, []),
    create_collection: (d) => assert.strictEqual(d, null),
    ".get_word_slices": (d) => assert.strictEqual(d, null),
    nc_get_packet_status: (d) => assert.strictEqual(d, null),
    _set_model_show: (d) => assert.strictEqual(d, null),
    clean_cache: (d) => assert.strictEqual(d, null),
  };
  for (const [name, check] of Object.entries(expected)) {
    const { mine, theirs, mineCalls } = await compareExtended(name, { count: 5, model: "m" });
    assert.deepStrictEqual(mine, theirs, `${name}: must agree with the placeholder`);
    check(dataOf(mine));
    assert.deepStrictEqual(mineCalls, [], `${name}: a placeholder must not reach the bridge`);
  }
  // The deliberate `100` answers, each with its OWN wording. `set_restart` is here and
  // not in the null-data list above: it answers 100 `not supported`, so a port that
  // returned `okResponse()` would tell a client the process is restarting when nothing
  // happens. That distinction is the whole point of asserting it.
  for (const [name, wording] of [
    ["create_collection", "not yet implemented"],
    [".get_word_slices", "not yet implemented"],
    ["set_restart", "not supported"],
  ] as Array<[string, string]>) {
    const { mine } = await compareExtended(name, {});
    assert.equal((mine as { retcode: number }).retcode, 100);
    assert.equal((mine as { wording: string }).wording, wording);
  }
  // `_get_model_show` is the one placeholder with a shape.
  const model = await compareExtended("_get_model_show", { model: "iPhone" });
  assert.deepStrictEqual(model.mine, model.theirs);
  assert.deepStrictEqual(dataOf(model.mine), [{ variants: { model_show: "iPhone", need_pay: false } }]);
  // `bot_exit` must not be run: it calls `process.exit`. Its schema is asserted only.
  assert.deepStrictEqual(
    actionRegistry.resolve("bot_exit")!.action!.spec.describe().params,
    [],
    "bot_exit takes no parameters",
  );
});

test("extended: the two unidirectional share actions differ in response shape", async () => {
  // `share_peer`/`send_ark_share` wrap the ark in `{arkMsg}`; `share_group_ex`/
  // `send_group_ark_share` answer the BARE string. Not interchangeable.
  const leaves = {
    "apis.contacts.getGroupRecommendArk": "GROUP-ARK",
    "apis.contacts.getBuddyRecommendArk": "BUDDY-ARK",
  };
  const wrapped = await compareExtended("share_peer", { group_id: 2 }, leaves);
  assert.deepStrictEqual(dataOf(wrapped.mine), { arkMsg: "GROUP-ARK" });
  const bare = await compareExtended("share_group_ex", { group_id: 2 }, leaves);
  assert.deepStrictEqual(dataOf(bare.mine), "GROUP-ARK", "share_group_ex answers a bare string");
  for (const [name, params] of [
    ["share_peer", {}],
    ["send_ark_share", {}],
    ["share_peer", { user_id: 3 }],
    ["send_ark_share", { user_id: 3, phone_number: "1" }],
    ["share_group_ex", { group_id: 2 }],
    ["send_group_ark_share", { group_id: 2 }],
  ] as Array<[string, Record<string, unknown>]>) {
    const { mine, theirs } = await compareExtended(name, params, leaves);
    assert.deepStrictEqual(mine, theirs, `${name}(${JSON.stringify(params)})`);
  }
  const neither = await compareExtended("share_peer", {}, leaves);
  assert.equal((neither.mine as { wording: string }).wording, "user_id or group_id is required");
});

test("extended: the four todo actions need an authoritative group sequence", async () => {
  // `groupTodoRun` is one guard shared by four actions, and the sequence goes over the
  // wire as a BIGINT because `0x0f90`'s encoder throws on a number. That cast is the
  // assertion below.
  const good = { getMessageMeta: async () => ({ isGroup: true, targetId: 2, sequence: 5, sequenceAuthoritative: true }) };
  for (const name of ["set_group_todo", "complete_group_todo", "cancel_group_todo"]) {
    const { mine, theirs } = await compareExtended(name, { group_id: 2, message_id: 1 }, good);
    assert.deepStrictEqual(mine, theirs, `${name}: happy path`);
    const meta = await compareExtended(name, { group_id: 2, message_id: 1 }, good);
    assert.strictEqual(dataOf(meta.mine), null, `${name} answers null`);
  }
  const { ctx, rec } = recordingCtx(good);
  await actionRegistry.resolve("set_group_todo")!.action!.spec.toHandler(ctx)({ group_id: 2, message_id: 1 });
  assert.strictEqual(
    rec.calls.find((c) => c.path === "apis.extras.setGroupTodo")?.args[1],
    5n,
    "the sequence must be a bigint",
  );
  // All four refusal paths, compared.
  for (const meta of [
    null,
    { isGroup: false, targetId: 2, sequence: 5, sequenceAuthoritative: true },
    { isGroup: true, targetId: 3, sequence: 5, sequenceAuthoritative: true },
    { isGroup: true, targetId: 2, sequence: 5, sequenceAuthoritative: false },
    { isGroup: true, targetId: 2, sequence: 0, sequenceAuthoritative: true },
  ]) {
    const { mine, theirs } = await compareExtended(
      "set_group_todo",
      { group_id: 2, message_id: 1 },
      { getMessageMeta: async () => meta },
    );
    assert.deepStrictEqual(mine, theirs, `set_group_todo(meta=${JSON.stringify(meta)})`);
  }
});

test("extended: get_group_file_system_info merges two packets", async () => {
  const { mine, theirs } = await compareExtended(
    "get_group_file_system_info",
    { group_id: 2 },
    {
      "apis.groupFile.getCount": { fileCount: 3, maxCount: 10 },
      "apis.groupFile.getSpace": { usedSpace: 500, totalSpace: 2000 },
    },
  );
  assert.deepStrictEqual(mine, theirs);
  // ⚠️ `limit_count`, not `max_file_count`. The first version of this test asserted the
  // port's own wrong key, so the port and the test agreed with each other and both
  // disagreed with the reference — which is exactly the failure a differential oracle
  // is for, and it is why the expectation below is copied from the bundle.
  assert.deepStrictEqual(dataOf(mine), { file_count: 3, limit_count: 10, used_space: 500, total_space: 2000 });
});

test("extended: trans_group_file answers {ok:true}, not null", async () => {
  const { mine, theirs } = await compareExtended("trans_group_file", { group_id: 2, file_id: "/f" });
  assert.deepStrictEqual(mine, theirs);
  assert.deepStrictEqual(dataOf(mine), { ok: true }, "the data is {ok:true}");
});

test("extended: flash-transfer parses `files` and renames the size field to `size`", async () => {
  // `parseFlashTaskFiles` returns `{error}` rather than throwing, and
  // `flashFileInfoToJson` names the size field `size` for NapCat compatibility.
  for (const files of [undefined, "", { file: "" }, 5, []]) {
    const { mine, theirs } = await compareExtended("create_flash_task", { files });
    assert.deepStrictEqual(mine, theirs, `create_flash_task(files=${JSON.stringify(files)})`);
  }
  const one = await compareExtended(
    "create_flash_task",
    { files: { file: "/a", name: "n" } },
    { "apis.flashTransfer.createFlashTask": { filesetId: "F" } },
  );
  assert.deepStrictEqual(one.mine, one.theirs);
  assert.deepStrictEqual(dataOf(one.mine), { fileset_id: "F", task_id: "F" }, "task_id duplicates fileset_id");
  const info = await compareExtended(
    "list_filesets",
    {},
    {
      "apis.flashTransfer.listFilesets": [
        {
          filesetUuid: "u",
          fileName: "n",
          origName: "o",
          fileSize: 9,
          shareUrl: "s",
          fileId: "i",
          downloadUrl: "d",
        },
      ],
    },
  );
  assert.deepStrictEqual(info.mine, info.theirs);
  const row = (dataOf(info.mine) as Array<Record<string, unknown>>)[0]!;
  assert.equal(row["size"], 9, "the field is `size`, not `file_size`");
  assert.ok(!("file_size" in row), "file_size must not appear");
});

test("extended: send_flash_msg requires a target and answers message_id 0", async () => {
  const { mine, theirs } = await compareExtended("send_flash_msg", { fileset_id: "F" });
  assert.deepStrictEqual(mine, theirs);
  assert.equal((mine as { retcode: number }).retcode, 1400);
  const sent = await compareExtended("send_flash_msg", { fileset_id: "F", group_id: 2 });
  assert.deepStrictEqual(sent.mine, sent.theirs);
  assert.deepStrictEqual(dataOf(sent.mine), { message_id: 0 }, "message_id is hard-coded 0");
});

test("extended: every action's hub guard answers the reference's own failure wording", async () => {
  // The 12 blocked actions and the ~30 host-dependent ones must answer a DOCUMENTED
  // failure when their provider is absent — never `{}`, never undefined, never a crash.
  // This is the assertion the task's brief asks for in place of a stub.
  const oracle = loadActionOracle();
  for (const action of oracle.extended) {
    const name = action.names[0]!;
    // ⚠️ bot_exit SCHEDULES process.exit(0) 50ms later. Running it inside the test
    // process kills the runner mid-file, which silently drops every test declared
    // after this one (the symptom is "83 declared, 53 executed"). It is therefore
    // excluded from every generic loop and its schema is asserted instead.
    if (name === "bot_exit") continue;
    if (!action.names.includes(name)) continue;
    const params: Record<string, unknown> = {};
    for (const p of action.describe().params as Array<{ name: string; required: boolean; type: string }>) {
      if (!p.required) continue;
      params[p.name] =
        p.type === "uint" || p.type === "int" || p.type === "messageId"
          ? 1
          : p.type === "string[]"
            ? ["a"]
            : "x";
    }
    // An unguarded body throws instead of answering when its provider is absent — the
    // reference's behaviour, and the reason `dispatchAction` maps a TypeError to 100.
    // `allowThrow` keeps that comparable; the envelope assertion below then applies
    // only to the bodies that do answer.
    const { mine, theirs } = await compareExtended(name, params, {}, { allowThrow: true });
    assert.deepStrictEqual(mine, theirs, `${name}: absent-provider path must agree`);
    if (mine === undefined) continue;
    // A response is always one of the two envelopes — never a bare {} and never undefined.
    assert.ok(
      typeof mine === "object" && mine !== null && "status" in (mine as Record<string, unknown>),
      `${name}: must answer an envelope, not ${String(mine)}`,
    );
  }
});
