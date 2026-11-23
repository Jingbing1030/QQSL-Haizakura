import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createOneBotApi } from "../src/onebot/api.js";
import { actionRegistry } from "../src/onebot/actions/index.js";
import type { ActionContext } from "../src/onebot/actions/context.js";
import { STREAM_MARK } from "../src/onebot/types.js";

function unreachableContext(): ActionContext {
  const boom = () => { throw new Error("provider not supplied by this test"); };
  return new Proxy({}, {
    get: () => new Proxy(boom, { get: () => boom, apply: boom }),
    has: () => true,
  }) as ActionContext;
}

function api() {
  return createOneBotApi({ createContext: unreachableContext, isAcceptingActions: () => true });
}

describe("OneBot stream API dispatch", () => {
  it("binds stream kind and dispatches ten chunks plus one terminal frame", async () => {
    const instance = api();
    assert.equal(instance.isStreamAction("test_download_stream"), true);
    assert.equal(actionRegistry.resolve("test_download_stream")?.kind, "stream");

    const frames: Record<string, unknown>[] = [];
    await instance.processStreamRequest(
      JSON.stringify({ action: "test_download_stream", params: { error: false }, echo: "stream-test" }),
      (frame) => { frames.push(JSON.parse(frame) as Record<string, unknown>); },
    );

    assert.equal(frames.length, 11);
    for (let index = 0; index < 10; index += 1) {
      assert.equal(frames[index]?.stream, STREAM_MARK);
      assert.equal(frames[index]?.echo, "stream-test");
      assert.equal((frames[index]?.data as Record<string, unknown>).data, `Index-> ${index + 1}`);
    }
    assert.equal(frames[10]?.stream, STREAM_MARK);
    assert.equal(frames[10]?.echo, "stream-test");
    assert.equal((frames[10]?.data as Record<string, unknown>).data_type, "data_complete");
    assert.equal(frames.filter((frame) => (frame.data as Record<string, unknown>)?.data_type === "data_complete").length, 1);
  });

  it("leaves normal actions as a single ordinary response", async () => {
    const instance = api();
    assert.equal(instance.isStreamAction("get_login_info"), false);
    const frames: string[] = [];
    await instance.processStreamRequest(
      JSON.stringify({ action: "get_login_info", params: {}, echo: "normal-test" }),
      (frame) => { frames.push(frame); },
    );
    assert.equal(frames.length, 1);
    const response = JSON.parse(frames[0]!) as Record<string, unknown>;
    assert.equal(response.echo, "normal-test");
    assert.equal(response.stream, undefined);
  });
});
