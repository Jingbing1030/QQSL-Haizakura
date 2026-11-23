// Satori v1 API surface — every method, asserted on the OneBot action it dispatches to.
//
// The adapter's job is a translation: Satori JSON in, OneBot action out, Satori JSON back. A
// test that only checks "the handler exists" proves nothing, so each case below asserts the
// dispatched action name AND the parameters, then asserts the response shape the Satori
// client will actually read. The parameter assertions are the ones that matter: every bug
// found in this file so far was a wrong field name or a wrong unit, and both are invisible
// to an existence check.
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { SATORI_API_FOR_TEST } from "../src/onebot/network/satori-server-adapter.js";
import type { OneBotNetworkContext } from "../src/onebot/types.js";

interface Call {
  action: string;
  params: Record<string, unknown>;
}

/** A context whose `api.handle` records the dispatch and answers from a table. */
function makeCtx(answers: Record<string, unknown> = {}, uin = "10001"): {
  ctx: OneBotNetworkContext;
  calls: Call[];
} {
  const calls: Call[] = [];
  const ctx = {
    uin,
    api: {
      handle: async (action: string, params: Record<string, unknown>) => {
        calls.push({ action, params });
        const canned = answers[action];
        if (canned === undefined) return { status: "ok", retcode: 0, data: {} };
        if (typeof canned === "function") return (canned as (p: Record<string, unknown>) => unknown)(params);
        return { status: "ok", retcode: 0, data: canned };
      },
    },
  } as unknown as OneBotNetworkContext;
  return { ctx, calls };
}

/** Invoke a handler, failing loudly when the name is not registered. */
async function invoke(
  name: string,
  ctx: OneBotNetworkContext,
  body: Record<string, unknown> = {},
): Promise<unknown> {
  const handler = SATORI_API_FOR_TEST[name];
  assert.ok(handler, `handler ${name} is not registered`);
  return handler(ctx, body);
}

describe("Satori API: login.get", () => {
  test("advertises every method it actually serves", async () => {
    const { ctx } = makeCtx({ get_login_info: { user_id: 10001, nickname: "bot" } });
    const result = (await invoke("login.get", ctx)) as Record<string, unknown>;
    const features = result.features as string[];
    assert.ok(Array.isArray(features));
    // Every advertised feature must have a handler. The reference advertises two names it does
    // not serve (`message.list.from`, `guild.plain`), which makes a conforming client 404.
    for (const feature of features) {
      assert.ok(SATORI_API_FOR_TEST[feature], `advertised ${feature} but no handler exists`);
    }
    assert.equal(features.length, Object.keys(SATORI_API_FOR_TEST).length);
  });

  test("derives the user object from login info", async () => {
    const { ctx } = makeCtx({ get_login_info: { user_id: 10001, nickname: "鱼糕" } });
    const result = (await invoke("login.get", ctx)) as Record<string, unknown>;
    assert.equal((result.user as Record<string, unknown>).id, "10001");
    assert.equal((result.user as Record<string, unknown>).name, "鱼糕");
    assert.equal(result.status, 1);
  });
});

describe("Satori API: channel parsing", () => {
  test("a `private:` prefix selects the private action", async () => {
    const { ctx, calls } = makeCtx({ send_private_msg: { message_id: 7 } });
    await invoke("message.create", ctx, { channel_id: "private:12345", content: "hi" });
    assert.equal(calls[0]!.action, "send_private_msg");
    assert.equal(calls[0]!.params.user_id, 12345);
    assert.equal(calls[0]!.params.group_id, undefined);
  });

  test("a bare id selects the group action", async () => {
    const { ctx, calls } = makeCtx({ send_group_msg: { message_id: 7 } });
    await invoke("message.create", ctx, { channel_id: "123456", content: "hi" });
    assert.equal(calls[0]!.action, "send_group_msg");
    assert.equal(calls[0]!.params.group_id, 123456);
  });
});

describe("Satori API: message.create", () => {
  test("answers with an ARRAY, because Satori fans out", async () => {
    const { ctx } = makeCtx({ send_group_msg: { message_id: 9 } });
    const result = await invoke("message.create", ctx, { channel_id: "1", content: "hello" });
    // A bare object makes every conforming client read `[0]` and see `undefined`.
    assert.ok(Array.isArray(result), "message.create must answer with an array");
    assert.equal((result as unknown[]).length, 1);
  });

  test("carries created_at and the guild for a group channel", async () => {
    const { ctx } = makeCtx({ send_group_msg: { message_id: 9 } });
    const [created] = (await invoke("message.create", ctx, {
      channel_id: "123456",
      content: "hello",
    })) as Record<string, unknown>[];
    assert.equal(typeof created!.created_at, "number");
    assert.ok((created!.created_at as number) > 0);
    assert.equal((created!.guild as Record<string, unknown>).id, "123456");
  });

  test("omits the guild for a private channel", async () => {
    const { ctx } = makeCtx({ send_private_msg: { message_id: 9 } });
    const [created] = (await invoke("message.create", ctx, {
      channel_id: "private:12345",
      content: "hello",
    })) as Record<string, unknown>[];
    assert.equal(created!.guild, undefined);
  });

  test("refuses empty content instead of sending a blank message", async () => {
    const { ctx, calls } = makeCtx({});
    await assert.rejects(
      () => invoke("message.create", ctx, { channel_id: "1", content: "   " }),
      /content must contain at least one sendable element/,
    );
    assert.equal(calls.length, 0, "nothing may be sent for empty content");
  });
});

describe("Satori API: message.list", () => {
  test("unwraps the {messages} envelope", async () => {
    // `get_group_msg_history` answers `{ messages: [...] }`. Reading `res.data` directly
    // yields the wrapper, which `Array.isArray` rejects — the list then looked empty for
    // every request, which reads as "no history" rather than as a bug.
    const { ctx } = makeCtx({
      get_group_msg_history: {
        messages: [
          { message_id: 1, raw_message: "first", time: 1_700_000_000, sender: { user_id: 2 } },
          { message_id: 2, raw_message: "second", time: 1_700_000_001, sender: { user_id: 3 } },
        ],
      },
    });
    const result = (await invoke("message.list", ctx, { channel_id: "1" })) as Record<string, unknown>;
    const data = result.data as Record<string, unknown>[];
    assert.equal(data.length, 2);
    assert.equal(data[0]!.content, "first");
    assert.equal(data[1]!.content, "second");
  });

  test("defaults to 50 and clamps a nonsensical limit", async () => {
    const { ctx, calls } = makeCtx({ get_group_msg_history: { messages: [] } });
    await invoke("message.list", ctx, { channel_id: "1" });
    assert.equal(calls[0]!.params.count, 50);

    const over = makeCtx({ get_group_msg_history: { messages: [] } });
    await invoke("message.list", over.ctx, { channel_id: "1", limit: 5000 });
    assert.equal(over.calls[0]!.params.count, 50, "an over-limit page falls back to 50");

    const zero = makeCtx({ get_group_msg_history: { messages: [] } });
    await invoke("message.list", zero.ctx, { channel_id: "1", limit: 0 });
    assert.equal(zero.calls[0]!.params.count, 50);
  });

  test("`desc` asks for reverse order and the anchor is forwarded", async () => {
    const { ctx, calls } = makeCtx({ get_group_msg_history: { messages: [] } });
    await invoke("message.list", ctx, { channel_id: "1", order: "desc", message_id: 42 });
    assert.equal(calls[0]!.params.reverse_order, true);
    assert.equal(calls[0]!.params.message_id, 42);

    const asc = makeCtx({ get_group_msg_history: { messages: [] } });
    await invoke("message.list", asc.ctx, { channel_id: "1", order: "asc" });
    assert.equal(asc.calls[0]!.params.reverse_order, false);
    assert.equal(asc.calls[0]!.params.message_id, undefined);
  });

  test("only advertises `next` on a full page", async () => {
    // A `next` on a partial page points past the end and makes a client loop forever.
    const partial = makeCtx({
      get_group_msg_history: { messages: [{ message_id: 5, raw_message: "x" }] },
    });
    const result = (await invoke("message.list", partial.ctx, { channel_id: "1", limit: 10 })) as Record<string, unknown>;
    assert.equal(result.next, undefined);

    const rows = Array.from({ length: 10 }, (_, i) => ({ message_id: i + 1, raw_message: String(i) }));
    const full = makeCtx({ get_group_msg_history: { messages: rows } });
    const fullResult = (await invoke("message.list", full.ctx, { channel_id: "1", limit: 10 })) as Record<string, unknown>;
    assert.equal(fullResult.next, "10");
  });
});

describe("Satori API: guild.member.mute unit conversion", () => {
  test("milliseconds become seconds, rounded up", async () => {
    const { ctx, calls } = makeCtx({ set_group_ban: {} });
    await invoke("guild.member.mute", ctx, { guild_id: 1, user_id: 2, duration: 1500 });
    // 1500 ms is 1.5 s; `Math.floor` would unmute at 1000 ms.
    assert.equal(calls[0]!.params.duration, 2);
  });

  test("a sub-second mute still mutes", async () => {
    const { ctx, calls } = makeCtx({ set_group_ban: {} });
    await invoke("guild.member.mute", ctx, { guild_id: 1, user_id: 2, duration: 1 });
    assert.equal(calls[0]!.params.duration, 1);
  });

  test("zero or negative means unmute", async () => {
    for (const duration of [0, -1]) {
      const { ctx, calls } = makeCtx({ set_group_ban: {} });
      await invoke("guild.member.mute", ctx, { guild_id: 1, user_id: 2, duration });
      assert.equal(calls[0]!.params.duration, 0);
    }
  });
});

describe("Satori API: guild.member.role.set", () => {
  test("only the admin role enables the admin flag", async () => {
    // Satori ids 4/3/2 are owner/admin/member. OneBot's set_group_admin is a boolean, and
    // owner has no separate representation, so both owner and member mean "not admin".
    const cases: Array<[unknown, boolean]> = [
      ["3", true],
      ["admin", true],
      ["4", false],
      ["owner", false],
      ["2", false],
      ["member", false],
      ["garbage", false],
    ];
    for (const [roleId, expected] of cases) {
      const { ctx, calls } = makeCtx({ set_group_admin: {} });
      await invoke("guild.member.role.set", ctx, { guild_id: 1, user_id: 2, role_id: roleId });
      assert.equal(calls[0]!.params.enable, expected, `role_id=${String(roleId)}`);
    }
  });
});

describe("Satori API: guild.member decoding", () => {
  test("join_time converts seconds to milliseconds", async () => {
    const { ctx } = makeCtx({
      get_group_member_info: { user_id: 2, nickname: "n", card: "c", role: "admin", join_time: 1_700_000_000 },
    });
    const result = (await invoke("guild.member.get", ctx, { guild_id: 1, user_id: 2 })) as Record<string, unknown>;
    assert.equal(result.joined_at, 1_700_000_000_000);
  });

  test("a zero join_time is omitted rather than becoming 1970", async () => {
    const { ctx } = makeCtx({ get_group_member_info: { user_id: 2, nickname: "n" } });
    const result = (await invoke("guild.member.get", ctx, { guild_id: 1, user_id: 2 })) as Record<string, unknown>;
    assert.equal(result.joined_at, undefined);
  });

  test("card wins over nickname for `nick`, and roles is an array", async () => {
    const { ctx } = makeCtx({ get_group_member_info: { user_id: 2, nickname: "nick", card: "card", role: "owner" } });
    const result = (await invoke("guild.member.get", ctx, { guild_id: 1, user_id: 2 })) as Record<string, unknown>;
    assert.equal(result.nick, "card");
    assert.deepEqual(result.roles, ["owner"]);
  });
});

describe("Satori API: reaction", () => {
  test("create and delete are the same action with opposite `set`", async () => {
    const created = makeCtx({ set_msg_emoji_like: {} });
    await invoke("reaction.create", created.ctx, { message_id: 1, emoji_id: "128512" });
    assert.equal(created.calls[0]!.action, "set_msg_emoji_like");
    assert.equal(created.calls[0]!.params.set, true);

    const removed = makeCtx({ set_msg_emoji_like: {} });
    await invoke("reaction.delete", removed.ctx, { message_id: 1, emoji_id: "128512" });
    assert.equal(removed.calls[0]!.action, "set_msg_emoji_like");
    assert.equal(removed.calls[0]!.params.set, false);
  });

  test("rejects a missing message id or emoji id before dispatching", async () => {
    for (const body of [{ emoji_id: "1" }, { message_id: 0, emoji_id: "1" }]) {
      const { ctx, calls } = makeCtx({});
      await assert.rejects(() => invoke("reaction.create", ctx, body), /message_id is required/);
      assert.equal(calls.length, 0);
    }
    const { ctx, calls } = makeCtx({});
    await assert.rejects(() => invoke("reaction.create", ctx, { message_id: 1, emoji_id: "  " }), /emoji_id is required/);
    assert.equal(calls.length, 0);
  });

  test("list unwraps emoji_like_list into users", async () => {
    const { ctx } = makeCtx({
      get_emoji_likes: { emoji_like_list: [{ user_id: 5, nick_name: "n1" }, { user_id: 6, nick_name: "n2" }] },
    });
    const result = (await invoke("reaction.list", ctx, { message_id: 1 })) as Record<string, unknown>;
    const data = result.data as Record<string, unknown>[];
    assert.equal(data.length, 2);
    assert.equal(data[0]!.id, "5");
  });
});

describe("Satori API: enum-like results", () => {
  test("guild.role.list is static and never touches the network", async () => {
    const { ctx, calls } = makeCtx({});
    const result = (await invoke("guild.role.list", ctx)) as Record<string, unknown>;
    const data = result.data as Record<string, unknown>[];
    assert.deepEqual(
      data.map((role) => role.id),
      ["4", "3", "2"],
    );
    assert.equal(calls.length, 0, "guild.role.list must not dispatch");
  });
});

describe("Satori API: guild_id is mandatory", () => {
  const guildMethods = [
    "channel.list",
    "guild.get",
    "guild.member.get",
    "guild.member.list",
    "guild.member.kick",
    "guild.member.mute",
    "guild.member.role.set",
  ];

  for (const method of guildMethods) {
    test(`${method} refuses a missing guild_id`, async () => {
      const { ctx, calls } = makeCtx({});
      await assert.rejects(
        () => invoke(method, ctx, { user_id: 2 }),
        /guild_id is required/,
        `${method} must reject before dispatching`,
      );
      assert.equal(calls.length, 0);
    });
  }
});

describe("Satori API: friend", () => {
  test("approve carries the flag in the message_id field", async () => {
    // Satori has no `flag` field on this call; the value the request event carried is echoed
    // back as `message_id`.
    const { ctx, calls } = makeCtx({ set_friend_add_request: {} });
    await invoke("friend.approve", ctx, { message_id: "abc", approve: false });
    assert.equal(calls[0]!.action, "set_friend_add_request");
    assert.equal(calls[0]!.params.flag, "abc");
    assert.equal(calls[0]!.params.approve, false);
  });

  test("approve defaults to true when the client omits it", async () => {
    const { ctx, calls } = makeCtx({ set_friend_add_request: {} });
    await invoke("friend.approve", ctx, { message_id: "abc" });
    assert.equal(calls[0]!.params.approve, true);
  });

  test("delete requires a user id", async () => {
    const { ctx, calls } = makeCtx({});
    await assert.rejects(() => invoke("friend.delete", ctx, {}), /user_id is required/);
    assert.equal(calls.length, 0);

    const ok = makeCtx({ delete_friend: {} });
    await invoke("friend.delete", ok.ctx, { user_id: 5 });
    assert.equal(ok.calls[0]!.action, "delete_friend");
  });
});

describe("Satori API: guild.approve vs guild.member.approve", () => {
  test("differ only in sub_type", async () => {
    const invite = makeCtx({ set_group_add_request: {} });
    await invoke("guild.approve", invite.ctx, { message_id: "f" });
    assert.equal(invite.calls[0]!.params.sub_type, "invite");

    const join = makeCtx({ set_group_add_request: {} });
    await invoke("guild.member.approve", join.ctx, { message_id: "f" });
    assert.equal(join.calls[0]!.params.sub_type, "add");
  });
});

describe("Satori API: dispatch failures surface", () => {
  test("a non-ok status becomes a throw with the server wording", async () => {
    const { ctx } = makeCtx({});
    (ctx.api as unknown as { handle: unknown }).handle = async () => ({
      status: "failed",
      retcode: 100,
      wording: "server said no",
    });
    await assert.rejects(() => invoke("message.delete", ctx, { message_id: 1 }), /server said no/);
  });
});
