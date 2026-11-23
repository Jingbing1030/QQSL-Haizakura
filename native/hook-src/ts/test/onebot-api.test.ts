// Tests that the action registry is actually reachable through `OneBotApi`.
//
// This exists because it was not: 42 actions were compiled and registry-tested while nothing
// constructed an `OneBotApi`, so every one of them was unreachable from a transport. A suite that
// only exercises the registry cannot tell the difference between "42 actions work" and "42 actions
// exist", and the second is worth very little.
//
// The assertions are deliberately about wiring, not about action semantics — the semantics have
// their own differential tests against the reference. What is checked here is that the seams are
// connected and that the two refusal gates answer for the right reason.
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import { createIdleOneBotApi, createOneBotApi } from "../src/onebot/api.js";
import { actionRegistry } from "../src/onebot/actions/index.js";
import type { ActionContext } from "../src/onebot/actions/context.js";
import { RETCODE } from "../src/onebot/types.js";

/** A context whose every provider throws, so an action cannot silently succeed. */
function unreachableContext(): ActionContext {
  const boom = () => {
    throw new Error("provider not supplied by this test");
  };
  return new Proxy(
    {},
    {
      get(_target, key) {
        // `bridge` and similar objects are probed for members; returning a throwing proxy keeps the
        // test from caring which ones exist.
        return new Proxy(boom, {
          get: () => boom,
          apply: boom,
        });
      },
      has: () => true,
    },
  ) as ActionContext;
}

describe("OneBotApi wiring", () => {
  it("exposes the reference-complete action registry", () => {
    assert.equal(actionRegistry.actions.length, 222);
    // 230 = 228 definition names (222 definitions + 6 aliases) + 2 raw reservations.
    // The raw pair (`.handle_quick_operation`, `.handle_quick_operation_async`) is
    // dispatchable, so it belongs in `executableNames`; excluding it made the v11
    // quick-operation path answer 1404.
    assert.equal(actionRegistry.executableNames.length, 230);
    assert.equal(actionRegistry.rawActions.length, 2);
    assert.equal(actionRegistry.categories.length, 12);
  });

  it("reaches the registry: an unknown action answers 1404, not a crash", async () => {
    const api = createOneBotApi({
      createContext: unreachableContext,
      isAcceptingActions: () => true,
    });
    const res = await api.handle("definitely_not_an_action", {});
    assert.equal(res.status, "failed");
    assert.equal(res.retcode, RETCODE.UNKNOWN_ACTION);
    // The wording matters: 1404 with a different message is a different contract.
    assert.match(String(res.wording ?? ""), /unknown action/i);
  });

  it("reaches a real action: get_login_info is dispatched, not reported unknown", async () => {
    const api = createOneBotApi({
      createContext: unreachableContext,
      isAcceptingActions: () => true,
    });
    const res = await api.handle("get_login_info", {});
    // It will fail because the context has no providers, but the failure must be the handler's,
    // not 1404. This is the assertion that proves the name was resolved and the handler ran.
    assert.notEqual(res.retcode, RETCODE.UNKNOWN_ACTION, "the action name must resolve");
  });

  it("refuses while not accepting actions, before resolving the name", async () => {
    const api = createOneBotApi({
      createContext: unreachableContext,
      isAcceptingActions: () => false,
    });
    // A name that does not exist, while quiescing: the gate must win, because answering
    // "unknown action" during shutdown names the wrong cause.
    const res = await api.handle("definitely_not_an_action", {});
    assert.equal(res.status, "failed");
    assert.notEqual(res.retcode, RETCODE.UNKNOWN_ACTION);
    assert.match(String(res.wording ?? ""), /not accepting/i);
  });

  it("binds the registry once, not per call", async () => {
    let built = 0;
    const api = createOneBotApi({
      createContext: () => {
        built += 1;
        return unreachableContext();
      },
      isAcceptingActions: () => true,
    });
    await api.handle("get_login_info", {});
    await api.handle("get_login_info", {});
    await api.handle("get_status", {});
    assert.equal(built, 1, "the context is created once per session, not per request");
  });

  it("dispatches registered stream actions through their sink", async () => {
    const api = createOneBotApi({ createContext: unreachableContext, isAcceptingActions: () => true });
    const frames: unknown[] = [];
    await api.handle("test_download_stream", { error: false }, {
      send: async (frame) => { frames.push(frame); },
    });
    assert.equal(frames.length, 10);
    assert.equal((frames[0] as { data_type?: string }).data_type, "data_chunk");
    assert.equal((frames[9] as { data_type?: string }).data_type, "data_chunk");
  });

  it("does not emit a chunk for a non-stream action", async () => {
    const api = createOneBotApi({
      createContext: unreachableContext,
      isAcceptingActions: () => true,
      isStreamAction: () => false,
    });
    const frames: unknown[] = [];
    await api.handle("get_login_info", {}, { send: async (f) => { frames.push(f); } });
    assert.equal(frames.length, 0);
  });

  it("processStreamRequest answers bad JSON with 1400 and echoes nothing", async () => {
    const api = createOneBotApi({
      createContext: unreachableContext,
      isAcceptingActions: () => true,
    });
    const out: string[] = [];
    await api.processStreamRequest("{not json", (f) => { out.push(f); });
    assert.equal(out.length, 1);
    const parsed = JSON.parse(out[0] as string) as { retcode: number };
    assert.equal(parsed.retcode, RETCODE.BAD_REQUEST);
  });

  it("processStreamRequest echoes the envelope echo field", async () => {
    const api = createOneBotApi({
      createContext: unreachableContext,
      isAcceptingActions: () => true,
    });
    const out: string[] = [];
    await api.processStreamRequest(
      JSON.stringify({ action: "get_login_info", params: {}, echo: "abc-123" }),
      (f) => { out.push(f); },
    );
    const parsed = JSON.parse(out[0] as string) as { echo?: string };
    assert.equal(parsed.echo, "abc-123", "a client correlating by echo must get it back");
  });

  it("processStreamRequest drops the emit when the caller is no longer alive", async () => {
    const api = createOneBotApi({
      createContext: unreachableContext,
      isAcceptingActions: () => true,
    });
    let emitted = 0;
    await api.processStreamRequest(
      JSON.stringify({ action: "get_login_info", params: {} }),
      () => { emitted += 1; },
      () => false,
    );
    assert.equal(emitted, 0, "writing to a dead connection is not useful");
  });

  it("the idle api refuses everything with the supplied reason", async () => {
    const api = createIdleOneBotApi("no session");
    assert.equal(api.isAcceptingActions, false);
    const res = await api.handle("get_login_info", {});
    assert.equal(res.status, "failed");
    assert.match(String(res.wording ?? ""), /no session/);
  });
});