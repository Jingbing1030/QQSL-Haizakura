import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { actionRegistry, ACTION_COUNTS, ACTION_GROUPS } from "../src/onebot/actions/index.js";
import type { ActionContext } from "../src/onebot/actions/context.js";
import { dispatchAction } from "../src/onebot/actions/index.js";
import { RETCODE } from "../src/onebot/types.js";

const restoredFamilyNames = [
  "get_friend_list",
  "get_stranger_info",
  "delete_friend",
  "set_friend_add_request",
  "set_group_add_request",
  "fetch_sys_faces",
  "fetch_face_entity",
  "search_sys_faces",
  "fetch_super_face_id",
] as const;
const qzoneAndStreamNames = ACTION_GROUPS.filter(({ category }) => category === "空间" || category === "流式接口")
  .flatMap(({ actions }) => actions.flatMap(({ names }) => names));

function unreachableContext(): ActionContext {
  const unavailable = () => {
    throw new Error("provider not supplied by this test");
  };
  return new Proxy({}, {
    get: () => new Proxy(unavailable, { get: () => unavailable, apply: unavailable }),
    has: () => true,
  }) as ActionContext;
}

describe("missing action registry families", () => {
  it("registers and dispatches all friend and system-face names", async () => {
    const handlers = actionRegistry.bind(unreachableContext());

    assert.equal(ACTION_COUNTS.friend, 3);
    assert.equal(ACTION_COUNTS.request, 2);
    assert.equal(ACTION_COUNTS.systemFace, 4);
    assert.equal(ACTION_COUNTS.space, 29);
    assert.equal(ACTION_COUNTS.stream, 6);
    assert.equal(ACTION_COUNTS.definitions, 222);
    // 230 = 228 definition names (222 definitions + 6 aliases) + 2 raw reservations
    // (`.handle_quick_operation`, `.handle_quick_operation_async`). The raw pair is
    // dispatchable, so excluding it from `executableNames` made `api.handle(...)`
    // answer 1404 on the v11 quick-operation path.
    assert.equal(actionRegistry.executableNames.length, 230);
    assert.equal(actionRegistry.rawActions.length, 2);
    assert.equal(actionRegistry.categories.length, 12);

    for (const name of [...restoredFamilyNames, ...qzoneAndStreamNames]) {
      assert.ok(actionRegistry.resolve(name), `${name} resolves`);
      const response = await dispatchAction(handlers, name, {});
      assert.notEqual(response.retcode, RETCODE.UNKNOWN_ACTION, `${name} dispatches`);
    }
  });
});
