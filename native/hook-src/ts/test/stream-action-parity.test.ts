import { test } from "node:test";
import assert from "node:assert/strict";

import { streamFileActions, STREAM_FILE_ACTION_COUNT } from "../src/onebot/actions/stream-file.js";
import { streamDownloadActions, STREAM_DOWNLOAD_ACTION_COUNT } from "../src/onebot/actions/stream-download.js";

const expectedNames = [
  "upload_file_stream",
  "clean_stream_temp_file",
  "download_file_stream",
  "download_file_image_stream",
  "download_file_record_stream",
  "test_download_stream",
];

const actions = [...streamFileActions, ...streamDownloadActions];
const byName = new Map(actions.map((action) => [action.names[0]!, action]));

test("stream action family has six definitions with reference names and kinds", () => {
  assert.equal(STREAM_FILE_ACTION_COUNT, 2);
  assert.equal(STREAM_DOWNLOAD_ACTION_COUNT, 4);
  assert.equal(actions.length, 6);
  assert.deepStrictEqual(actions.map((action) => action.names[0]), expectedNames);
  assert.ok(actions.every((action) => action.names.length === 1));
  assert.equal(streamFileActions[0]!.kind, "stream");
  assert.equal(streamFileActions[1]!.kind, "normal");
  assert.ok(streamDownloadActions.every((action) => action.kind === "stream"));
});

test("stream action descriptions preserve reference parameter order, defaults and readOnly", () => {
  const docs = new Map(actions.map((action) => [action.names[0]!, action.describe()]));
  const signature = (name: string) => docs.get(name)!.params.map(({ name: field, required, default: value }) => [field, required, value]);

  assert.deepStrictEqual(signature("upload_file_stream"), [
    ["stream_id", true, undefined],
    ["chunk_data", false, undefined],
    ["chunk_index", false, undefined],
    ["total_chunks", false, undefined],
    ["file_size", false, undefined],
    ["expected_sha256", false, undefined],
    ["is_complete", false, undefined],
    ["filename", false, undefined],
    ["reset", false, undefined],
    ["verify_only", false, undefined],
    ["file_retention", false, 300000],
  ]);
  assert.deepStrictEqual(signature("clean_stream_temp_file"), []);
  for (const name of expectedNames.slice(2, 5)) {
    assert.deepStrictEqual(signature(name), [
      ["file", false, undefined],
      ["file_id", false, undefined],
      ["chunk_size", false, undefined],
    ]);
  }
  assert.deepStrictEqual(signature("test_download_stream"), [["error", false, false]]);
  for (const name of expectedNames) {
    const doc = docs.get(name)!;
    assert.equal(doc.name, name);
    assert.deepStrictEqual(doc.aliases, []);
    assert.equal(doc.readOnly, false);
  }
});

test("test_download_stream emits ten reference frames and the terminal response", async () => {
  const spec = streamDownloadActions[3]!;
  assert.equal(spec.names[0], "test_download_stream");
  const sent: unknown[] = [];
  const response = await spec.toHandler({} as never)({}, { send: async (frame) => { sent.push(frame); } });
  assert.deepStrictEqual(sent.map((frame) => (frame as { data: unknown }).data), Array.from({ length: 10 }, (_, i) => `Index-> ${i + 1}`));
  assert.deepStrictEqual(response, {
    status: "ok",
    retcode: 0,
    data: { type: "response", data_type: "data_complete", data: "Stream transmission complete" },
  });
});
