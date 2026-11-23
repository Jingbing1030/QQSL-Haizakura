// OneBot v11 quick operation: `.handle_quick_operation` and its NoneBot 1 alias.
//
// ---------------------------------------------------------------------------
// Why this file exists
// ---------------------------------------------------------------------------
// The v11 HTTP *reporter* path is: POST the event, and if the answer is JSON, apply
// that JSON object as an "operation" to the event that was just reported
// (`ts/src/onebot/http.ts` `handleQuickOperation`). The port shipped the caller and
// never registered the action, so every quick operation answered
// `1404 unknown action` — a dead code path, not a missing feature.
//
// The reference registers it as a **raw reservation** (reference:21367-21376), i.e.
// a name in the registry that is deliberately NOT an action definition: it has no
// params kit, no `describe()` metadata and no category, so it contributes nothing to
// the 222-definition / 228-name totals the parity suite measures. These tests pin
// both halves of that: the names resolve and dispatch, AND they stay out of
// `actions` / `categories`.
//
// ---------------------------------------------------------------------------
// What is compared against what
// ---------------------------------------------------------------------------
// `executeQuickOperation` is not in the oracle's sliced regions (the oracle evaluates
// action-definition regions only), so these assertions are not differential. They are
// instead pinned to the reference's *observable* contract: which action name each
// operation field dispatches, with which params, in which order. Every expectation
// below is a transcription of reference/index.mjs:21379-21443, and each one names the
// line it came from.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  actionRegistry,
  ACTION_GROUPS,
  compileActionRegistry,
} from "../src/onebot/actions/index.js";
import {
  HANDLE_QUICK_OPERATION_ACTION,
  HANDLE_QUICK_OPERATION_ASYNC_ACTION,
  createHandleQuickOperation,
  executeQuickOperation,
} from "../src/onebot/actions/quick-operation.js";
import { createOneBotApi } from "../src/onebot/api.js";
import type { ActionContext } from "../src/onebot/actions/context.js";
import { RETCODE, okResponse } from "../src/onebot/types.js";

/** One `api.handle` call, recorded. */
interface Call {
  readonly action: string;
  readonly params: Record<string, unknown>;
}

/**
 * A `QuickOperationApi` that records instead of dispatching.
 *
 * Recording rather than mocking the real actions keeps these tests about the QUICK
 * OPERATION's mapping (which name, which params) instead of about `send_group_msg`'s
 * own behaviour, which has its own differential tests.
 */
function recorder(): { api: { handle(a: string, p: Record<string, unknown>): Promise<ReturnType<typeof okResponse>> }; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    api: {
      async handle(action: string, params: Record<string, unknown>) {
        calls.push({ action, params });
        return okResponse();
      },
    },
  };
}

/** A v11 group message event, as the reporter would have posted it. */
function groupMessageEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    post_type: "message",
    message_type: "group",
    group_id: 20001,
    user_id: 10001,
    message_id: 4242,
    ...overrides,
  };
}

/** A v11 private message event. */
function privateMessageEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    post_type: "message",
    message_type: "private",
    user_id: 10001,
    message_id: 4242,
    ...overrides,
  };
}

const actionNames = (calls: readonly Call[]): string[] => calls.map((call) => call.action);

/** The bound handler for a name, with a context no action here reaches. */
function boundHandler(name: string): (params: Record<string, unknown>) => Promise<unknown> {
  const unreachable = (() => {
    throw new Error("provider not supplied by this test");
  }) as never;
  const ctx = new Proxy(
    {},
    { get: () => new Proxy(unreachable, { get: () => unreachable, apply: unreachable }), has: () => true },
  ) as ActionContext;
  const handler = actionRegistry.bind(ctx).get(name);
  assert.ok(handler, `expected a bound handler for "${name}"`);
  return handler.handler as (params: Record<string, unknown>) => Promise<unknown>;
}

// ===========================================================================
// 1. Registration — both names, as raw reservations
// ===========================================================================

describe("quick operation: registration", () => {
  it("reserves both names, and both resolve to the same canonical", () => {
    const canonical = actionRegistry.resolve(HANDLE_QUICK_OPERATION_ACTION);
    const alias = actionRegistry.resolve(HANDLE_QUICK_OPERATION_ASYNC_ACTION);

    assert.ok(canonical, `${HANDLE_QUICK_OPERATION_ACTION} must be registered`);
    assert.ok(alias, `${HANDLE_QUICK_OPERATION_ASYNC_ACTION} must be registered (NoneBot 1 alias)`);

    // The name strings themselves are the reference's (L21367, L21373). Asserted
    // literally because a leading dot is what makes them "hidden": a client that
    // lists actions must not see them, so a rename to `handle_quick_operation`
    // would silently publish a new public action.
    assert.equal(HANDLE_QUICK_OPERATION_ACTION, ".handle_quick_operation");
    assert.equal(HANDLE_QUICK_OPERATION_ASYNC_ACTION, ".handle_quick_operation_async");

    assert.equal(canonical.canonical, HANDLE_QUICK_OPERATION_ACTION);
    assert.equal(alias.canonical, HANDLE_QUICK_OPERATION_ACTION, "the _async name is an alias of the same canonical");
    assert.equal(canonical.kind, "raw");
    assert.equal(alias.kind, "raw");
    assert.equal(canonical.role, "raw");
    assert.equal(alias.role, "raw");
  });

  it("both names have a callable handler", () => {
    for (const name of [HANDLE_QUICK_OPERATION_ACTION, HANDLE_QUICK_OPERATION_ASYNC_ACTION]) {
      assert.equal(typeof boundHandler(name), "function", `${name} must bind to a handler`);
    }
  });

  it("stays OUT of the definition and category counts (a reservation is not a definition)", () => {
    // The 222/228/12 totals the parity suite measures are the reference's
    // ACTION_GROUPS numbers, and the reference's raw reservations are not in them.
    // Registering these names as normal actions would move both counts and make the
    // parity table wrong, so this is asserted here as well as in that suite.
    assert.equal(actionRegistry.actions.length, 222, "definitions must not grow");
    assert.equal(actionRegistry.categories.length, 12, "categories must not grow");
    assert.equal(
      actionRegistry.executableNames.length,
      230,
      "executable names = 228 ACTION_GROUPS names + 2 raw reservations",
    );
    assert.equal(actionRegistry.rawActions.length, 2);
    assert.deepStrictEqual(
      actionRegistry.rawActions.map((raw) => raw.name),
      [HANDLE_QUICK_OPERATION_ACTION, HANDLE_QUICK_OPERATION_ASYNC_ACTION],
    );
    for (const group of ACTION_GROUPS) {
      for (const spec of group.actions) {
        assert.ok(
          !spec.names.includes(HANDLE_QUICK_OPERATION_ACTION),
          "the quick operation must not be an ACTION_GROUPS definition",
        );
      }
    }
  });

  it("a raw reservation claims its name like any other, so a conflict still throws", () => {
    // The reservation goes through the SAME `claim` as a definition (reference:21293),
    // so registering `.handle_quick_operation` twice is a startup error naming both.
    assert.throws(
      () =>
        compileActionRegistry(ACTION_GROUPS, [
          { name: HANDLE_QUICK_OPERATION_ACTION, canonical: HANDLE_QUICK_OPERATION_ACTION },
          { name: HANDLE_QUICK_OPERATION_ACTION, canonical: HANDLE_QUICK_OPERATION_ACTION },
        ]),
      /Action registry conflict for executable name "\.handle_quick_operation"/,
    );
  });

  it("an empty raw name is a startup error, not a nameless reservation", () => {
    assert.throws(
      () => compileActionRegistry([], [{ name: "  ", canonical: HANDLE_QUICK_OPERATION_ACTION }]),
      /Action registry invalid raw action/,
    );
    assert.throws(
      () => compileActionRegistry([], [{ name: HANDLE_QUICK_OPERATION_ACTION, canonical: "" }]),
      /Action registry invalid raw action/,
    );
  });
});

// ===========================================================================
// 2. Mutation check — the registration is what makes the path live
// ===========================================================================
//
// Without this, every test above could pass while `actionRegistry` was compiled from
// `ACTION_GROUPS` alone: the assertions would be reading a registry that happens to be
// right for another reason. This compiles the SAME groups with no reservations and
// shows the names are gone — i.e. the `RAW_ACTION_RESERVATIONS` argument is
// load-bearing.

describe("quick operation: registration is load-bearing (mutation check)", () => {
  it("compiling without raw reservations drops both names", () => {
    const withoutRaw = compileActionRegistry(ACTION_GROUPS);
    assert.equal(withoutRaw.executableNames.length, 228, "the groups alone are 228 names");
    assert.equal(withoutRaw.resolve(HANDLE_QUICK_OPERATION_ACTION), undefined);
    assert.equal(withoutRaw.resolve(HANDLE_QUICK_OPERATION_ASYNC_ACTION), undefined);
    assert.equal(withoutRaw.rawActions.length, 0);
  });

  it("the real registry is the one with the reservations", () => {
    // Restates the link the mutation above breaks: `actionRegistry` is
    // `compileActionRegistry(ACTION_GROUPS, RAW_ACTION_RESERVATIONS)`.
    assert.equal(actionRegistry.executableNames.length, compileActionRegistry(ACTION_GROUPS).executableNames.length + 2);
  });

  it("the v11 caller's exact name resolves through the real ApiHandler", async () => {
    // `http.ts` calls `this.ctx.api.handle(".handle_quick_operation", {context, operation})`.
    // This drives that name through a real `OneBotApi` — not the bare registry — so a
    // wiring mistake in `api.ts` (binding before the api exists, say) fails here too.
    const api = createOneBotApi({
      createContext: () => ({}) as ActionContext,
      isAcceptingActions: () => true,
    });
    const response = await api.handle(HANDLE_QUICK_OPERATION_ACTION, {
      context: groupMessageEvent(),
      operation: {},
    });
    assert.notEqual(response.retcode, RETCODE.UNKNOWN_ACTION, "the name must not answer 1404");
    assert.deepStrictEqual(response, { status: "ok", retcode: 0, data: null });
  });
});

// ===========================================================================
// 3. `reply` actually sends
// ===========================================================================

describe("quick operation: reply", () => {
  it("sends a group message, at-ing the sender by default", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(groupMessageEvent(), { reply: "hello" }, api);

    assert.deepStrictEqual(actionNames(calls), ["send_group_msg"]);
    assert.deepStrictEqual(calls[0]!.params, {
      group_id: 20001,
      // A string reply with `at_sender` defaulting to true becomes an explicit
      // [at, text] segment pair (reference:21397-21403).
      message: [
        { type: "at", data: { qq: "10001" } },
        { type: "text", data: { text: "hello" } },
      ],
      // …and auto_escape is FORCED false: the text is now a segment, so escaping it
      // again would double-encode it (reference:21404).
      auto_escape: false,
    });
  });

  it("at_sender: false suppresses the at segment and keeps auto_escape", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(groupMessageEvent(), { reply: "hello", at_sender: false, auto_escape: true }, api);

    assert.deepStrictEqual(calls[0]!.params, {
      group_id: 20001,
      message: "hello",
      auto_escape: true,
    });
  });

  it("an absent user_id suppresses the at segment (a falsy id is not an at target)", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(groupMessageEvent({ user_id: 0 }), { reply: "hello" }, api);
    // `event.user_id` is tested for truthiness (reference:21395), so 0 produces no
    // `at` segment at all — not `at qq="0"`.
    assert.deepStrictEqual(calls[0]!.params, { group_id: 20001, message: "hello", auto_escape: false });
  });

  it("an array reply is spread after the at segment", async () => {
    const { api, calls } = recorder();
    const reply = [{ type: "text", data: { text: "seg" } }];
    await executeQuickOperation(groupMessageEvent(), { reply }, api);

    assert.deepStrictEqual(calls[0]!.params["message"], [{ type: "at", data: { qq: "10001" } }, ...reply]);
    // An array reply keeps the caller's auto_escape — only the string branch rewrites it.
    assert.equal(calls[0]!.params["auto_escape"], false);
  });

  it("an array reply with auto_escape: true keeps auto_escape true", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(
      groupMessageEvent(),
      { reply: [{ type: "text", data: { text: "seg" } }], auto_escape: true },
      api,
    );
    assert.equal(calls[0]!.params["auto_escape"], true);
  });

  it("sends a private message without any at segment", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(privateMessageEvent(), { reply: "hi" }, api);

    assert.deepStrictEqual(actionNames(calls), ["send_private_msg"]);
    assert.deepStrictEqual(calls[0]!.params, { user_id: 10001, message: "hi", auto_escape: false });
  });

  it("auto_escape is carried through to send_private_msg", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(privateMessageEvent(), { reply: "[CQ:face,id=1]", auto_escape: true }, api);
    assert.equal(calls[0]!.params["auto_escape"], true);
  });

  it("reply: \"\" is a no-op; reply: 0 is still sent", async () => {
    const empty = recorder();
    await executeQuickOperation(groupMessageEvent(), { reply: "" }, empty.api);
    assert.deepStrictEqual(empty.calls, [], 'reply: "" means "do not reply"');

    const zero = recorder();
    await executeQuickOperation(groupMessageEvent(), { reply: 0 }, zero.api);
    // Three separate tests (`!== void 0`, `!== null`, `!== ""`), so a falsy-but-present
    // reply IS dispatched (reference:21384).
    assert.deepStrictEqual(actionNames(zero.calls), ["send_group_msg"]);
  });

  it("reply: null is a no-op", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(groupMessageEvent(), { reply: null }, api);
    assert.deepStrictEqual(calls, []);
  });
});

// ===========================================================================
// 4. delete / kick / ban map to the right calls
// ===========================================================================

describe("quick operation: delete, kick, ban", () => {
  it("delete maps to delete_msg with the triggering message id", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(groupMessageEvent(), { delete: true }, api);

    assert.deepStrictEqual(actionNames(calls), ["delete_msg"]);
    assert.deepStrictEqual(calls[0]!.params, { message_id: 4242 });
  });

  it("delete works for a private message too", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(privateMessageEvent(), { delete: true }, api);
    assert.deepStrictEqual(actionNames(calls), ["delete_msg"]);
  });

  it("ban maps to set_group_ban with the default 1800s duration", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(groupMessageEvent(), { ban: true }, api);

    assert.deepStrictEqual(actionNames(calls), ["set_group_ban"]);
    assert.deepStrictEqual(calls[0]!.params, { group_id: 20001, user_id: 10001, duration: 1800 });
  });

  it("ban honours an explicit ban_duration", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(groupMessageEvent(), { ban: true, ban_duration: 600 }, api);
    assert.deepStrictEqual(calls[0]!.params, { group_id: 20001, user_id: 10001, duration: 600 });
  });

  it("a non-numeric ban_duration falls back to 1800", async () => {
    const { api, calls } = recorder();
    // `typeof operation.ban_duration === "number"` — a string does NOT coerce
    // (reference:21415). The action's own field kit would accept "600", so nothing
    // downstream hides this: the quick operation never dispatches the string.
    await executeQuickOperation(groupMessageEvent(), { ban: true, ban_duration: "600" }, api);
    assert.equal(calls[0]!.params["duration"], 1800);
  });

  it("ban is group-only", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(privateMessageEvent(), { ban: true }, api);
    assert.deepStrictEqual(calls, [], "a private message cannot be banned");
  });

  it("kick maps to set_group_kick with reject_add_request coerced to a boolean", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(groupMessageEvent(), { kick: true }, api);

    assert.deepStrictEqual(actionNames(calls), ["set_group_kick"]);
    // `!!operation.reject_add_request` — absent becomes literally `false`, not
    // `undefined` (reference:21422).
    assert.deepStrictEqual(calls[0]!.params, { group_id: 20001, user_id: 10001, reject_add_request: false });
  });

  it("kick honours reject_add_request: true", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(groupMessageEvent(), { kick: true, reject_add_request: true }, api);
    assert.deepStrictEqual(calls[0]!.params, { group_id: 20001, user_id: 10001, reject_add_request: true });
  });

  it("kick is group-only", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(privateMessageEvent(), { kick: true }, api);
    assert.deepStrictEqual(calls, []);
  });
});

// ===========================================================================
// 5. Ordering — the fields are applied sequentially
// ===========================================================================

describe("quick operation: field order", () => {
  it("applies reply, delete, ban and kick in the reference's statement order", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(
      groupMessageEvent(),
      { reply: "hi", delete: true, ban: true, kick: true },
      api,
    );
    // NOT the order the keys happen to appear in the operation object: the reference
    // writes four sequential `if`s (reference:21385-21424), so the dispatch order is
    // fixed and observable to a client that records action traffic.
    assert.deepStrictEqual(actionNames(calls), [
      "send_group_msg",
      "delete_msg",
      "set_group_ban",
      "set_group_kick",
    ]);
  });
});

// ===========================================================================
// 6. Request events — approve
// ===========================================================================

describe("quick operation: request approve", () => {
  it("maps a friend request to set_friend_add_request with remark defaulting to \"\"", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(
      { post_type: "request", request_type: "friend", flag: "flag-1" },
      { approve: true },
      api,
    );

    assert.deepStrictEqual(actionNames(calls), ["set_friend_add_request"]);
    assert.deepStrictEqual(calls[0]!.params, { flag: "flag-1", approve: true, remark: "" });
  });

  it("carries an explicit remark", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(
      { post_type: "request", request_type: "friend", flag: "flag-1" },
      { approve: false, remark: "who?" },
      api,
    );
    assert.deepStrictEqual(calls[0]!.params, { flag: "flag-1", approve: false, remark: "who?" });
  });

  it("maps a group request to set_group_add_request with sub_type and reason", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(
      { post_type: "request", request_type: "group", sub_type: "invite", flag: "flag-2" },
      { approve: true },
      api,
    );

    assert.deepStrictEqual(actionNames(calls), ["set_group_add_request"]);
    assert.deepStrictEqual(calls[0]!.params, {
      flag: "flag-2",
      sub_type: "invite",
      approve: true,
      reason: "",
    });
  });

  it("approve: null is PRESENT, so it is dispatched (the action decides it is invalid)", async () => {
    const { api, calls } = recorder();
    // `operation.approve !== void 0` (reference:21430) — null passes the quick
    // operation's own test. The receiving action's `f.bool()` is what answers 1400,
    // and swallowing it here would turn a client bug into silence.
    await executeQuickOperation(
      { post_type: "request", request_type: "friend", flag: "flag-1" },
      { approve: null },
      api,
    );
    assert.deepStrictEqual(actionNames(calls), ["set_friend_add_request"]);
    assert.equal(calls[0]!.params["approve"], null);
  });

  it("an unknown request_type is a no-op", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(
      { post_type: "request", request_type: "guild", flag: "flag-3" },
      { approve: true },
      api,
    );
    assert.deepStrictEqual(calls, []);
  });
});

// ===========================================================================
// 7. No-ops — never a throw
// ===========================================================================

describe("quick operation: no-ops", () => {
  it("an empty operation is a no-op that still answers ok", async () => {
    const api = createOneBotApi({ createContext: () => ({}) as ActionContext, isAcceptingActions: () => true });
    const response = await api.handle(HANDLE_QUICK_OPERATION_ACTION, {
      context: groupMessageEvent(),
      operation: {},
    });
    assert.deepStrictEqual(response, { status: "ok", retcode: 0, data: null });
  });

  it("unknown operation keys are ignored, not rejected", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(groupMessageEvent(), { not_a_v11_field: 1, reply: undefined }, api);
    assert.deepStrictEqual(calls, []);
  });

  it("an event whose post_type is neither message nor request is a no-op", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation(
      { post_type: "notice", notice_type: "group_increase", group_id: 20001, user_id: 10001 },
      { reply: "hi", delete: true, kick: true, ban: true, approve: true },
      api,
    );
    // v11 quick operation is defined for message and request events only; a notice
    // has no `message_id` to delete and no `reply` channel, so the reference's two
    // outer `if`s fall through.
    assert.deepStrictEqual(calls, []);
  });

  it("a message event with no message_type dispatches nothing for reply", async () => {
    const { api, calls } = recorder();
    await executeQuickOperation({ post_type: "message", group_id: 1, user_id: 2, message_id: 3 }, { reply: "hi" }, api);
    assert.deepStrictEqual(calls, []);
  });

  it("an absent operation answers 1400 with the reference's exact wording", async () => {
    const handler = createHandleQuickOperation(recorder().api);

    // Reference:21490 — `if (!opContext || !operation) return failedResponse(
    // RETCODE.BAD_REQUEST, "context and operation are required")`. Both are required
    // and both are truthiness-tested, so `{}` params and a nullish operation fail
    // identically. Wording asserted literally: it is what a client sees.
    for (const params of [{}, { context: groupMessageEvent() }, { operation: { reply: "x" } }]) {
      assert.deepStrictEqual(await handler(params), {
        status: "failed",
        retcode: RETCODE.BAD_REQUEST,
        data: null,
        wording: "context and operation are required",
      });
    }
  });

  it("a falsy operation is a 1400, not a silent ok", async () => {
    const handler = createHandleQuickOperation(recorder().api);
    for (const operation of [null, 0, "", false]) {
      const response = (await handler({ context: groupMessageEvent(), operation })) as { retcode: number };
      assert.equal(response.retcode, RETCODE.BAD_REQUEST, `operation ${JSON.stringify(operation)}`);
    }
  });

  it("the handler answers ok even when the inner action fails", async () => {
    // The reference discards every inner response (`await api.handle(...)` with no
    // assignment) and answers `okResponse()`. The reporter's HTTP response has already
    // been written, so a failed inner action can only be logged — and it is, by
    // `http.ts`'s caller.
    const api = {
      async handle() {
        return { status: "failed" as const, retcode: RETCODE.ACTION_FAILED, data: null, wording: "nope" };
      },
    };
    const handler = createHandleQuickOperation(api);
    assert.deepStrictEqual(await handler({ context: groupMessageEvent(), operation: { delete: true } }), {
      status: "ok",
      retcode: 0,
      data: null,
    });
  });

  it("a raw name bound without an api still answers ok, not a TypeError", async () => {
    // `actionRegistry.bind(ctx)` with no api is what every registry test does, so the
    // raw branch must not dereference `undefined`. The inner dispatch answers a legible
    // 1200 which — exactly as for a bound api — `createHandleQuickOperation` discards,
    // so the observable result is the reference's plain `okResponse()`.
    const handler = boundHandler(HANDLE_QUICK_OPERATION_ACTION);
    assert.deepStrictEqual(await handler({ context: groupMessageEvent(), operation: { delete: true } }), {
      status: "ok",
      retcode: 0,
      data: null,
    });
  });
});

// ===========================================================================
// 8. The alias is the same handler, not a second registration
// ===========================================================================

describe("quick operation: the NoneBot 1 alias", () => {
  it("dispatches through the same api and sends", async () => {
    const api = createOneBotApi({ createContext: () => ({}) as ActionContext, isAcceptingActions: () => true });
    const response = await api.handle(HANDLE_QUICK_OPERATION_ASYNC_ACTION, {
      context: groupMessageEvent(),
      operation: {},
    });
    assert.equal(response.status, "ok");
    assert.equal(response.retcode, 0);
  });
});
