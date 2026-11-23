import assert from "node:assert/strict";
import test from "node:test";
import { defineAction, f, okResponse } from "../src/onebot/actions/kit.js";

test("action describe preserves supplied examples and returnsSchema metadata", () => {
  const examples = [{ input: { value: "sample" }, output: { result: "ok" } }];
  const returnsSchema = { type: "object", properties: { result: { type: "string" } } };
  const withMetadata = defineAction({
    name: "metadata_action",
    examples,
    returnsSchema,
    params: { value: f.string() },
    run: () => okResponse({}),
  });

  assert.deepStrictEqual(withMetadata.describe(), {
    name: "metadata_action",
    aliases: [],
    summary: undefined,
    returns: undefined,
    returnsSchema,
    examples,
    readOnly: false,
    params: [{ name: "value", type: "string", required: true, schema: { type: "string" } }],
    invariants: [],
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: true,
    },
  });

  const withoutMetadata = defineAction({
    name: "plain_action",
    params: {},
    run: () => okResponse({}),
  }).describe();
  assert.equal(Object.hasOwn(withoutMetadata, "examples"), false);
  assert.equal(Object.hasOwn(withoutMetadata, "returnsSchema"), true);
  assert.equal(withoutMetadata.returnsSchema, undefined);
});
