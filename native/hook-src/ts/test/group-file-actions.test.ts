// Differential tests: the 群文件 (group-file) family vs the reference bundle.
//
// Same contract as `onebot-actions.test.ts`: every assertion runs the port's action
// and the bundle's own action against the SAME fake context and requires the two
// responses to be deep-equal. A green test means "the port and the shipping
// implementation agree for this input".
//
// ---------------------------------------------------------------------------
// What the sibling file already covers, and what this one adds
// ---------------------------------------------------------------------------
// `onebot-actions.test.ts` is registry-wide: since the twelve actions are now in
// `ACTION_GROUPS`, its five loops already check every one of them for
//
//   * canonical name + aliases          (`describe()` vs the bundle)
//   * param list, order and required flags
//   * declared defaults
//   * readOnly
//   * invariants
//
// Those pass as a side effect of registration. What they do NOT check is `run`
// behaviour, which is the whole of this file. It is split out rather than appended
// because the family's two hardest properties are invisible to a schema diff:
//
//   1. the CAMELCASE → snake_case rename in `getGroupFiles`, which is a free
//      function in a DIFFERENT bundle region (`modules/contact-actions.ts`) and not
//      an action at all;
//   2. the two blocked uploads, whose contract is "throw naming the missing
//      infrastructure", i.e. retcode 100 with a specific wording.
//
// ---------------------------------------------------------------------------
// The formatter test is a real differential comparison
// ---------------------------------------------------------------------------
// `loadActionOracle().getGroupFiles` IS the bundle's function — the oracle pulls the
// whole `contact-actions.ts` region in and hands back the declaration. So the rename
// table is verified by running the reference's own twenty-one assignments against the
// port's, not by transcribing them into an expected literal. `assert.deepStrictEqual`
// compares key ORDER too, which is what a raw-JSON client sees.

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadActionOracle, oracleFor } from "./helpers/actions-oracle.js";
import { actionRegistry, dispatchAction } from "../src/onebot/actions/index.js";
import { formatGroupFiles, groupFileActions, GROUP_FILE_ACTION_COUNT } from "../src/onebot/actions/group-file.js";
import type { ActionContext } from "../src/onebot/actions/context.js";

// ===========================================================================
// Fakes
// ===========================================================================

interface Call {
  path: string;
  args: unknown[];
}

/**
 * A recording `groupFile` slice whose `list` answers canned rows.
 *
 * Both sides of every comparison get the SAME object, so the recorded call list can
 * be asserted too — that is how the `folder` / `folder_id` precedence swap is
 * checked independently of the response.
 */
function makeGroupFileApi(rows: { files: unknown[]; folders: unknown[] } = { files: [], folders: [] }) {
  const calls: Call[] = [];
  const returning = (path: string, value: unknown) =>
    async (...args: unknown[]) => {
      calls.push({ path, args });
      return value;
    };
  const api = {
    list: async (...args: unknown[]) => {
      calls.push({ path: "list", args });
      return { files: rows.files, folders: rows.folders };
    },
    getUrl: returning("getUrl", "https://example.invalid/dl/abc"),
    getPrivateUrl: returning("getPrivateUrl", "https://example.invalid/private/xyz"),
    delete: returning("delete", undefined),
    move: returning("move", undefined),
    rename: returning("rename", undefined),
    createFolder: returning("createFolder", {
      folderId: "folder-1",
      folderName: "共享资料",
      folderPath: "/",
      createTime: 1_700_000_000,
      modifyTime: 1_700_000_001,
      createUin: 10001,
      modifyUin: 10001,
    }),
    deleteFolder: returning("deleteFolder", undefined),
    renameFolder: returning("renameFolder", undefined),
    upload: returning("upload", { fileId: "uploaded-1" }),
    uploadPrivate: returning("uploadPrivate", { fileId: "priv-1", fileHash: "hash-1" }),
  };
  return { api, calls };
}

function makeCtx(
  overrides: Partial<ActionContext> & { groupFile?: unknown; recallUploadedFile?: unknown } = {},
): ActionContext {
  const base: ActionContext = {
    bridge: {
      identity: { uin: "10001", nickname: "bot", selfUid: "u_10001", groups: [] },
      apis: { groupFile: makeGroupFileApi().api },
      receiveHealthy: true,
      getOnlineClients: () => null,
      sendRawPacket: async () => ({ success: true, gotResponse: true, responseData: null }),
      // The upload cache. Every private-upload test overrides this.
      recallUploadedFile: () => undefined,
    } as unknown as ActionContext["bridge"],
    getLoginInfo: () => ({ userId: 10001, nickname: "bot" }),
    isOnline: () => true,
    getUptimeMs: () => 1,
    getMessage: async () => null,
    refreshMessageMedia: async () => {},
    getMessageMeta: async () => null,
    deleteMessage: async () => {},
    sendGroupMessage: async () => ({ messageId: 1 }),
    sendPrivateMessage: async () => ({ messageId: 1 }),
  };
  return { ...base, ...overrides } as ActionContext;
}

/** Run one action on both sides and return `{ mine, theirs }`. */
async function both(
  name: string,
  params: Record<string, unknown>,
  ctx: ActionContext,
): Promise<{ mine: unknown; theirs: unknown }> {
  const spec = actionRegistry.resolve(name);
  assert.ok(spec?.action, `port has no action ${name}`);
  const mine = await spec.action.spec.toHandler(ctx)(params);
  const theirs = await oracleFor(name).toHandler(ctx as unknown as Record<string, unknown>)(params);
  return { mine, theirs };
}

/**
 * Run both sides and capture the THROWN error message from each.
 *
 * Needed because several of the reference's bodies throw instead of answering
 * (a missing upload-metadata entry, a missing file_id), and "both sides answered the
 * same failure envelope" would not prove the port throws the same sentence —
 * `dispatchAction` is what turns a throw into retcode 100, and it is not in this path.
 */
async function throwBoth(ctx: ActionContext, params: Record<string, unknown>): Promise<[unknown, unknown]> {
  const spec = actionRegistry.resolve("upload_private_file");
  assert.ok(spec?.action);
  const run = (handler: (p: Record<string, unknown>) => Promise<unknown>) =>
    handler(params).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  return [
    await run(spec.action.spec.toHandler(ctx)),
    await run(oracleFor("upload_private_file").toHandler(ctx as unknown as Record<string, unknown>)),
  ];
}

/** Assert equality against the bundle and hand back the response for further checks. */
async function assertAgrees(
  name: string,
  params: Record<string, unknown>,
  ctx: ActionContext,
): Promise<{ response: { status: string; retcode: number; data: unknown; wording?: string } }> {
  const { mine, theirs } = await both(name, params, ctx);
  assert.deepStrictEqual(mine, theirs, `${name}: response differs from the reference bundle`);
  return { response: mine as { status: string; retcode: number; data: unknown; wording?: string } };
}

// A row set that exercises every field, including falsy values, so a rename that
// silently drops a key or reorders two of them fails.
const ROWS = {
  files: [
    {
      fileId: "file-a",
      fileName: "报告.pdf",
      busId: 102,
      fileSize: 4096,
      uploadTime: 1_700_000_000,
      deadTime: 1_700_100_000,
      modifyTime: 1_700_000_500,
      downloadTimes: 7,
      uploader: 20002,
      uploaderName: "上传者",
    },
    {
      // All-zero row: proves the formatter copies rather than truth-tests.
      fileId: "",
      fileName: "",
      busId: 0,
      fileSize: 0,
      uploadTime: 0,
      deadTime: 0,
      modifyTime: 0,
      downloadTimes: 0,
      uploader: 0,
      uploaderName: "",
    },
  ],
  folders: [
    {
      folderId: "folder-a",
      folderName: "课程资料",
      createTime: 1_699_000_000,
      creator: 20003,
      creatorName: "创建者",
      totalFileCount: 12,
      lastUploadTime: 1_700_200_000,
      lastUploader: 20004,
      lastUploaderName: "最后上传者",
    },
    {
      folderId: "",
      folderName: "",
      createTime: 0,
      creator: 0,
      creatorName: "",
      totalFileCount: 0,
      lastUploadTime: 0,
      lastUploader: 0,
      lastUploaderName: "",
    },
  ],
};

// ===========================================================================
// 1. The family's shape
// ===========================================================================

test("group-file: 12 definitions, all registered, none an alias", () => {
  const oracle = loadActionOracle();
  assert.equal(GROUP_FILE_ACTION_COUNT, 12);
  assert.equal(groupFileActions.length, 12);
  assert.equal(oracle.groupFile.length, 12, "the bundle's actions$8 length");
  for (const spec of groupFileActions) {
    assert.equal(spec.names.length, 1, `${spec.names[0]}: must have no aliases`);
    assert.ok(actionRegistry.resolve(spec.names[0]!), `${spec.names[0]}: not registered`);
  }
  // And the family is registered under the reference's category, 群文件.
  const group = actionRegistry.actions.find((a) => a.canonical === "get_group_root_files");
  assert.equal(group?.category, "群文件");
});

// ===========================================================================
// 2. The formatter — the reference's own getGroupFiles, run side by side
// ===========================================================================

test("formatter: get_group_root_files renames every field exactly as the bundle does", async () => {
  const fake = makeGroupFileApi(ROWS);
  const ctx = makeCtx({
    bridge: {
      identity: { uin: "10001", nickname: "bot", selfUid: "u_10001", groups: [] },
      apis: { groupFile: fake.api },
      receiveHealthy: true,
      getOnlineClients: () => null,
      sendRawPacket: async () => ({ success: true, gotResponse: true, responseData: null }),
      recallUploadedFile: () => undefined,
    } as unknown as ActionContext["bridge"],
    // The provider is the PORTED formatter, wired the way a host would wire it.
    getGroupFiles: (groupId, folderId) => formatGroupFiles(fake.api as never, groupId, folderId),
  });

  const { mine, theirs } = await both("get_group_root_files", { group_id: 20001 }, ctx);
  assert.deepStrictEqual(mine, theirs, "root listing differs from the reference bundle");

  // Independently of the action, compare the two FORMATTERS on the same rows: the
  // bundle's `getGroupFiles` and the port's. This is the assertion that would catch
  // a rename the action comparison could mask.
  const oracle = loadActionOracle();
  const referenceRows = await oracle.getGroupFiles(
    { apis: { groupFile: { list: async () => ROWS } } },
    20001,
    "/",
  );
  const portRows = await formatGroupFiles(fake.api as never, 20001, "/");
  assert.deepStrictEqual(portRows, referenceRows, "formatter output differs from the bundle's");

  // Spot-check the four renames a uniform camel→snake transform would get WRONG.
  const folders = (portRows as unknown as { folders: Record<string, unknown>[] }).folders;
  assert.equal(folders[0]!["create_name"], "创建者", "creatorName must become create_name");
  assert.equal(folders[0]!["last_upload_time"], 1_700_200_000, "lastUploadTime must keep its name");
  assert.equal(folders[0]!["creator"], 20003, "creator is not renamed to create_uin");
  const files = (portRows as unknown as { files: Record<string, unknown>[] }).files;
  assert.equal(files[0]!["busid"], 102, "busId must become lowercase busid");
  assert.equal(files[0]!["uploader_name"], "上传者");
  // `group_id` is stamped into EVERY row from the caller's argument.
  for (const row of [...files, ...folders]) assert.equal(row["group_id"], 20001);
});

test("formatter: folderId ?? \"/\" is nullish, so a present empty string survives", async () => {
  const oracle = loadActionOracle();
  const seen: (string | undefined)[] = [];
  const bridge = {
    apis: {
      groupFile: {
        list: async (_g: number, folderId: string) => {
          seen.push(folderId);
          return { files: [], folders: [] };
        },
      },
    },
  };
  // `undefined` → "/" via `??`. `""` → passed THROUGH (nullish, not falsy).
  await oracle.getGroupFiles(bridge, 1, undefined);
  await oracle.getGroupFiles(bridge, 1, "");
  await oracle.getGroupFiles(bridge, 1, "/sub");
  assert.deepStrictEqual(seen, ["/", "", "/sub"], "the bundle's getGroupFiles passes an empty folder through");

  // The port agrees.
  const portSeen: (string | undefined)[] = [];
  const portApi = {
    list: async (_g: number, folderId: string) => {
      portSeen.push(folderId);
      return { files: [], folders: [] };
    },
  };
  await formatGroupFiles(portApi as never, 1, undefined);
  await formatGroupFiles(portApi as never, 1, "");
  await formatGroupFiles(portApi as never, 1, "/sub");
  assert.deepStrictEqual(portSeen, seen, "the port's formatter must agree on ?? vs ||");
});

test("formatter: a host with no getGroupFiles provider fails loudly, not emptily", async () => {
  const ctx = makeCtx(); // no getGroupFiles
  const res = await dispatchAction(
    actionRegistry.bind(ctx),
    "get_group_root_files",
    { group_id: 20001 },
  );
  assert.equal(res.status, "failed");
  assert.equal(res.retcode, 100, "a missing provider must be an action failure, not a 1400");
  assert.match(String(res.wording ?? ""), /getGroupFiles provider is not attached/);
});

// ===========================================================================
// 3. The two listing actions' folder precedence — the swap
// ===========================================================================

test("get_group_files_by_folder: folder_id beats folder (the OPPOSITE of upload_group_file)", async () => {
  const fake = makeGroupFileApi({ files: [], folders: [] });
  const seen: unknown[][] = [];
  const ctx = makeCtx({
    bridge: {
      identity: { uin: "10001", nickname: "bot", selfUid: "u_10001", groups: [] },
      apis: { groupFile: fake.api },
      receiveHealthy: true,
      getOnlineClients: () => null,
      sendRawPacket: async () => ({ success: true, gotResponse: true, responseData: null }),
      recallUploadedFile: () => undefined,
    } as unknown as ActionContext["bridge"],
    getGroupFiles: async (groupId, folderId) => {
      seen.push([groupId, folderId]);
      return { files: [], folders: [] };
    },
  });

  // `both()` runs the action TWICE (port, then bundle) against this one context, so
  // every invocation pushes two identical entries. Asserting the pair is what proves
  // the port and the bundle passed the SAME folder id — comparing only the responses
  // would not, because a fake that ignores its argument answers the same either way.
  const expectNext = (expected: unknown[], label: string) => {
    const pair = seen.slice(-2);
    assert.equal(pair.length, 2, `${label}: expected two calls`);
    assert.deepStrictEqual(pair[0], expected, `${label}: the port's argument`);
    assert.deepStrictEqual(pair[1], expected, `${label}: the bundle's argument`);
  };

  // Both present: folder_id wins here.
  const { mine, theirs } = await both("get_group_files_by_folder", { group_id: 20001, folder_id: "/id", folder: "/name" }, ctx);
  assert.deepStrictEqual(mine, theirs);
  expectNext([20001, "/id"], "folder_id must win in get_group_files_by_folder");

  // Only `folder`: it is used.
  await both("get_group_files_by_folder", { group_id: 20001, folder: "/name" }, ctx);
  expectNext([20001, "/name"], "folder alone");

  // Neither: "/".
  await both("get_group_files_by_folder", { group_id: 20001 }, ctx);
  expectNext([20001, "/"], "neither");

  // Both empty strings: "/" — because `||`, not `??`, is used HERE.
  await both("get_group_files_by_folder", { group_id: 20001, folder_id: "", folder: "" }, ctx);
  expectNext([20001, "/"], "both empty");
});

// ===========================================================================
// 4. busidOr102 — measured, not guessed
// ===========================================================================

test("get_group_file_url: busidOr102 coerces every shape the reference coerces", async () => {
  const cases: [unknown, number][] = [
    [200, 200],
    ["200", 200],
    [102.9, 102],
    ["  200  ", 200],
    [0, 0],
    // Everything below falls back to 102:
    ["abc", 102],
    ["", 102],
    ["   ", 102],
    [-1, 102],
    [-1.5, 102],
    [null, 102],
    [{}, 102],
    [[], 102],
    [true, 102],
    [Infinity, 102],
    [NaN, 102],
  ];
  const fake = makeGroupFileApi();
  const seen: unknown[][] = [];
  const api = { ...fake.api, getUrl: async (...args: unknown[]) => { seen.push(args); return "https://example.invalid/x"; } };
  const ctx = makeCtx({
    bridge: {
      identity: { uin: "10001", nickname: "bot", selfUid: "u_10001", groups: [] },
      apis: { groupFile: api },
      receiveHealthy: true,
      getOnlineClients: () => null,
      sendRawPacket: async () => ({ success: true, gotResponse: true, responseData: null }),
      recallUploadedFile: () => undefined,
    } as unknown as ActionContext["bridge"],
  });
  for (const [input, expected] of cases) {
    await both("get_group_file_url", { group_id: 20001, file_id: "f1", busid: input }, ctx);
    const last = seen[seen.length - 1]!;
    assert.deepStrictEqual(last, [20001, "f1", expected], `busid ${JSON.stringify(input)}`);
  }
  // Absent entirely.
  await both("get_group_file_url", { group_id: 20001, file_id: "f1" }, ctx);
  assert.deepStrictEqual(seen[seen.length - 1], [20001, "f1", 102]);
});

// ===========================================================================
// 5. The unblocked mutators agree
// ===========================================================================

test("mutators: the seven reachable writes agree with the bundle, argument for argument", async () => {
  const fake = makeGroupFileApi();
  const ctx = makeCtx({
    bridge: {
      identity: { uin: "10001", nickname: "bot", selfUid: "u_10001", groups: [] },
      apis: { groupFile: fake.api },
      receiveHealthy: true,
      getOnlineClients: () => null,
      sendRawPacket: async () => ({ success: true, gotResponse: true, responseData: null }),
      recallUploadedFile: () => undefined,
    } as unknown as ActionContext["bridge"],
  });

  const plans: Array<{ name: string; params: Record<string, unknown>; path: string; args: unknown[] }> = [
    {
      name: "delete_group_file",
      params: { group_id: 20001, file_id: "f1" },
      path: "delete",
      args: [20001, "f1"],
    },
    {
      name: "move_group_file",
      params: { group_id: 20001, file_id: "f1", parent_directory: "/", target_directory: "/sub" },
      path: "move",
      args: [20001, "f1", "/", "/sub"],
    },
    {
      name: "rename_group_file",
      params: { group_id: 20001, file_id: "f1", current_parent_directory: "/sub", new_name: "new.pdf" },
      path: "rename",
      args: [20001, "f1", "/sub", "new.pdf"],
    },
    {
      // `current_parent_directory` omitted → the default "/" is passed, not "".
      name: "rename_group_file",
      params: { group_id: 20001, file_id: "f1", new_name: "new.pdf" },
      path: "rename",
      args: [20001, "f1", "/", "new.pdf"],
    },
    {
      name: "create_group_file_folder",
      params: { group_id: 20001, name: "资料" },
      path: "createFolder",
      args: [20001, "资料", "/"],
    },
    {
      name: "delete_group_file_folder",
      params: { group_id: 20001, folder_id: "d1" },
      path: "deleteFolder",
      args: [20001, "d1"],
    },
    {
      // `new_folder_name` wins over `name`.
      name: "rename_group_file_folder",
      params: { group_id: 20001, folder_id: "d1", new_folder_name: "A", name: "B" },
      path: "renameFolder",
      args: [20001, "d1", "A"],
    },
    {
      // `new_folder_name` empty → `name` is used.
      name: "rename_group_file_folder",
      params: { group_id: 20001, folder_id: "d1", name: "B" },
      path: "renameFolder",
      args: [20001, "d1", "B"],
    },
    {
      name: "get_private_file_url",
      params: { file_id: "pf1", file_hash: "h1" },
      path: "getPrivateUrl",
      args: [0, "pf1", "h1"],
    },
    {
      // A supplied user_id reaches the bridge unchanged, even though it ignores it.
      name: "get_private_file_url",
      params: { user_id: 20002, file_id: "pf1" },
      path: "getPrivateUrl",
      args: [20002, "pf1", ""],
    },
  ];

  for (const plan of plans) {
    const before = fake.calls.length;
    const { mine, theirs } = await both(plan.name, plan.params, ctx);
    assert.deepStrictEqual(mine, theirs, `${plan.name} ${JSON.stringify(plan.params)}: response`);
    const newCalls = fake.calls.slice(before);
    // TWO calls: one from the port, one from the bundle (both share this context).
    // Both must name the same bridge method and pass the same arguments — that is
    // the assertion that pins argument ORDER, which a response comparison cannot.
    assert.equal(newCalls.length, 2, `${plan.name}: expected one bridge call per side`);
    assert.equal(newCalls[0]!.path, plan.path, `${plan.name}: the port's bridge method`);
    assert.equal(newCalls[1]!.path, plan.path, `${plan.name}: the bundle's bridge method`);
    assert.deepStrictEqual(newCalls[0]!.args, plan.args, `${plan.name}: the port's bridge arguments`);
    assert.deepStrictEqual(newCalls[0]!.args, newCalls[1]!.args, `${plan.name}: the two sides disagree`);
  }
});

test("rename_group_file answers {ok:true}; its four siblings answer null", async () => {
  const fake = makeGroupFileApi();
  const ctx = makeCtx({
    bridge: {
      identity: { uin: "10001", nickname: "bot", selfUid: "u_10001", groups: [] },
      apis: { groupFile: fake.api },
      receiveHealthy: true,
      getOnlineClients: () => null,
      sendRawPacket: async () => ({ success: true, gotResponse: true, responseData: null }),
      recallUploadedFile: () => undefined,
    } as unknown as ActionContext["bridge"],
  });
  const { response } = await assertAgrees(
    "rename_group_file",
    { group_id: 20001, file_id: "f1", new_name: "n" },
    ctx,
  );
  assert.deepStrictEqual(response.data, { ok: true });
  for (const [name, params] of [
    ["delete_group_file", { group_id: 20001, file_id: "f1" }],
    ["delete_group_file_folder", { group_id: 20001, folder_id: "d1" }],
    ["rename_group_file_folder", { group_id: 20001, folder_id: "d1", new_folder_name: "A" }],
    ["move_group_file", { group_id: 20001, file_id: "f1", parent_directory: "/", target_directory: "/s" }],
  ] as const) {
    const r = await both(name, params, ctx);
    assert.deepStrictEqual(r.mine, r.theirs, `${name}: differs`);
    assert.equal((r.mine as { data: unknown }).data, null, `${name}: data must be null`);
  }
});

test("create_group_file_folder returns literal retCode 0 / retMsg success around the bridge row", async () => {
  const fake = makeGroupFileApi();
  const ctx = makeCtx({
    bridge: {
      identity: { uin: "10001", nickname: "bot", selfUid: "u_10001", groups: [] },
      apis: { groupFile: fake.api },
      receiveHealthy: true,
      getOnlineClients: () => null,
      sendRawPacket: async () => ({ success: true, gotResponse: true, responseData: null }),
      recallUploadedFile: () => undefined,
    } as unknown as ActionContext["bridge"],
  });
  const { mine, theirs } = await both("create_group_file_folder", { group_id: 20001, name: "资料", parent_id: "/sub" }, ctx);
  assert.deepStrictEqual(mine, theirs);
  assert.deepStrictEqual((mine as { data: unknown }).data, {
    // The literals are the reference's own, NOT the bridge's answer — a bridge that
    // returned a non-zero retcode on a successful create would be ignored, which is
    // what the bundle does.
    result: { retCode: 0, retMsg: "success" },
    groupItem: {
      folderInfo: {
        folderId: "folder-1",
        folderName: "共享资料",
        folderPath: "/",
        createTime: 1_700_000_000,
        modifyTime: 1_700_000_001,
        createUin: 10001,
        modifyUin: 10001,
      },
    },
  });
});

test("rename_group_file_folder: BOTH names empty is a 1400 with the bundle's own sentence", async () => {
  const fake = makeGroupFileApi();
  const ctx = makeCtx({
    bridge: {
      identity: { uin: "10001", nickname: "bot", selfUid: "u_10001", groups: [] },
      apis: { groupFile: fake.api },
      receiveHealthy: true,
      getOnlineClients: () => null,
      sendRawPacket: async () => ({ success: true, gotResponse: true, responseData: null }),
      recallUploadedFile: () => undefined,
    } as unknown as ActionContext["bridge"],
  });
  const before = fake.calls.length;
  const { mine, theirs } = await both("rename_group_file_folder", { group_id: 20001, folder_id: "d1" }, ctx);
  assert.deepStrictEqual(mine, theirs, "the 1400 must match the bundle's, wording included");
  assert.equal((mine as { retcode: number }).retcode, 1400);
  assert.equal(
    (mine as { wording: string }).wording,
    "group_id, folder_id and new_folder_name are required",
    "a rules: entry would word this differently — that is why there is none",
  );
  assert.equal(fake.calls.length, before, "a failed rename must not reach the bridge");
});

// ===========================================================================
// 6. The two BLOCKED uploads
// ===========================================================================

test("upload_group_file: folder beats folder_id, and both empty means root", async () => {
  const fake = makeGroupFileApi();
  const seen: unknown[][] = [];
  const api = {
    ...fake.api,
    upload: async (...args: unknown[]) => {
      seen.push(args);
      return { fileId: "uploaded-1" };
    },
  };
  const ctx = makeCtx({
    bridge: {
      identity: { uin: "10001", nickname: "bot", selfUid: "u_10001", groups: [] },
      apis: { groupFile: api },
      receiveHealthy: true,
      getOnlineClients: () => null,
      sendRawPacket: async () => ({ success: true, gotResponse: true, responseData: null }),
      recallUploadedFile: () => undefined,
    } as unknown as ActionContext["bridge"],
  });

  const expectNext = (expected: unknown[], label: string) => {
    const pair = seen.slice(-2);
    assert.equal(pair.length, 2, `${label}: expected two calls`);
    assert.deepStrictEqual(pair[0], expected, `${label}: the port's argument`);
    assert.deepStrictEqual(pair[1], expected, `${label}: the bundle's argument`);
  };

  // Both present: `folder` wins HERE (the opposite of get_group_files_by_folder).
  const { mine, theirs } = await both(
    "upload_group_file",
    { group_id: 20001, file: "file:///a", folder: "/name", folder_id: "/id" },
    ctx,
  );
  assert.deepStrictEqual(mine, theirs);
  expectNext([20001, "file:///a", "", "/name", true], "folder must win in upload_group_file");

  // Neither: "/". Both empty strings: also "/" (because `||`).
  await both("upload_group_file", { group_id: 20001, file: "file:///a" }, ctx);
  expectNext([20001, "file:///a", "", "/", true], "neither");
  await both("upload_group_file", { group_id: 20001, file: "file:///a", folder: "", folder_id: "" }, ctx);
  expectNext([20001, "file:///a", "", "/", true], "both empty");

  // `upload_file: false` reaches the bridge as false.
  await both("upload_group_file", { group_id: 20001, file: "file:///a", upload_file: false }, ctx);
  expectNext([20001, "file:///a", "", "/", false], "upload_file false");
});

test("upload_group_file: a bridge failure surfaces as retcode 100, not a fake success", async () => {
  // The upload is implemented now, so this asserts the FAILURE PLUMBING rather than
  // a hard-coded "not implemented" wording: whatever the bridge throws has to reach
  // the caller verbatim as a 100 with no invented file_id. The message below is a
  // realistic mid-transfer failure (the group-file host came back unusable), which
  // is exactly the kind that must not be swallowed.
  const message =
    "group file upload failed: code=130 msg=storage quota exceeded";
  const ctx = makeCtx({
    bridge: {
      identity: { uin: "10001", nickname: "bot", selfUid: "u_10001", groups: [] },
      apis: {
        groupFile: {
          upload: async () => {
            throw new Error(message);
          },
        },
      },
      receiveHealthy: true,
      getOnlineClients: () => null,
      sendRawPacket: async () => ({ success: true, gotResponse: true, responseData: null }),
      recallUploadedFile: () => undefined,
    } as unknown as ActionContext["bridge"],
  });
  const res = await dispatchAction(actionRegistry.bind(ctx), "upload_group_file", {
    group_id: 20001,
    file: "file:///a",
  });
  assert.equal(res.status, "failed");
  assert.equal(res.retcode, 100);
  assert.equal(res.wording, message, "the bridge's wording reaches the caller verbatim");
  // And it must NOT have invented a file_id.
  assert.equal(res.data, null);
});

test("upload_private_file: the upload-metadata read-back is required, and its 3 guards fire", async () => {
  const goodMeta = {
    fileId: "priv-1",
    scope: "private" as const,
    userId: 20002,
    fileName: "报告.pdf",
    fileSize: 4096,
    fileMd5: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    fileSha1: new Uint8Array([1, 2, 3]),
    fileHash: "hash-from-cache",
    rememberedAt: 1,
  };
  const mk = (recall: (id: string) => unknown, uploaded: { fileId: string; fileHash: string | null } = { fileId: "priv-1", fileHash: "hash-1" }) => {
    const sent: unknown[] = [];
    const ctx = makeCtx({
      bridge: {
        identity: { uin: "10001", nickname: "bot", selfUid: "u_10001", groups: [] },
        apis: { groupFile: { uploadPrivate: async () => uploaded } },
        receiveHealthy: true,
        getOnlineClients: () => null,
        sendRawPacket: async () => ({ success: true, gotResponse: true, responseData: null }),
        recallUploadedFile: recall,
      } as unknown as ActionContext["bridge"],
      sendPrivateMessage: async (...args: unknown[]) => {
        sent.push(args);
        return { messageId: 1 };
      },
    });
    return { ctx, sent };
  };

  // (a) The happy path sends ONE `file` segment carrying the cache's metadata,
  //     with md5 HEX-ENCODED from the raw digest bytes and file_hash taken from the
  //     upload result first, the cache second.
  {
    const { ctx, sent } = mk((id) => (id === "priv-1" ? goodMeta : undefined));
    const { mine, theirs } = await both("upload_private_file", { user_id: 20002, file: "file:///a", name: "报告.pdf" }, ctx);
    assert.deepStrictEqual(mine, theirs, "the private-upload response differs from the bundle");
    // Two sends: one from the port, one from the bundle. They must be IDENTICAL,
    // because the message segment is where the md5 hex-encoding and the file_hash
    // fallback chain become observable.
    assert.equal(sent.length, 2, "one send per side");
    assert.deepStrictEqual(sent[0], sent[1], "the two sides built different file segments");
    const [uid, segments, autoEscape] = sent[0] as [number, unknown[], boolean];
    assert.equal(uid, 20002);
    assert.equal(autoEscape, false, "the reference passes false explicitly");
    assert.deepStrictEqual(segments, [
      {
        type: "file",
        data: {
          file_id: "priv-1",
          name: "报告.pdf",
          file_size: 4096,
          md5: "deadbeef",
          file_hash: "hash-1",
        },
      },
    ]);
  }

  // (b) NO cache entry → the bundle throws, and the port must throw the same wording.
  {
    const { ctx } = mk(() => undefined);
    const [mine, theirs] = await throwBoth(ctx, { user_id: 20002, file: "file:///a" });
    assert.equal(mine, theirs, "missing metadata: wording must match the bundle's");
    assert.match(String(mine), /private file upload metadata missing for file_id priv-1/);
  }

  // (c) A cache entry for a DIFFERENT user is treated as missing — that is the
  //     guard's whole point, and it is why `userId` is compared, not just looked up.
  {
    const { ctx } = mk(() => ({ ...goodMeta, userId: 99999 }));
    const [mine, theirs] = await throwBoth(ctx, { user_id: 20002, file: "file:///a" });
    assert.equal(mine, theirs);
    assert.match(String(mine), /metadata missing/);
  }

  // (d) A cache entry with the WRONG SCOPE is also missing.
  {
    const { ctx } = mk(() => ({ ...goodMeta, scope: "group" }));
    const [mine, theirs] = await throwBoth(ctx, { user_id: 20002, file: "file:///a" });
    assert.equal(mine, theirs);
    assert.match(String(mine), /metadata missing/);
  }

  // (e) An upload that reports success but no file_id must fail, and must NOT
  //     send a message with an empty id.
  {
    const { ctx, sent } = mk(() => goodMeta, { fileId: "", fileHash: null });
    const [mine, theirs] = await throwBoth(ctx, { user_id: 20002, file: "file:///a" });
    assert.equal(mine, theirs);
    assert.match(String(mine), /private file upload returned no file_id/);
    assert.equal(sent.length, 0, "nothing must be sent when the upload reported no file_id");
  }

  // (f) `upload_file: false` skips the whole message path — no recall, no send.
  {
    let recalled = 0;
    const { ctx, sent } = mk(() => {
      recalled += 1;
      return goodMeta;
    });
    const { mine, theirs } = await both(
      "upload_private_file",
      { user_id: 20002, file: "file:///a", upload_file: false },
      ctx,
    );
    assert.deepStrictEqual(mine, theirs);
    assert.equal(recalled, 0, "with upload_file:false the cache must not be read");
    assert.equal(sent.length, 0, "and nothing is sent");
  }
});