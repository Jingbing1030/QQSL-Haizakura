import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { IdentityService } from "../src/bridge/identity-service.js";

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "identity-service-"));
}

test("UID/UIN mapping survives close and restart", async () => {
  const root = await temporaryDirectory();
  const databasePath = path.join(root, "identity.db");
  try {
    const first = new IdentityService("12345", databasePath);
    await first.initialization;
    await first.rememberUidUin("uid-alpha", 7654321);
    await first.flush();
    await first.close();

    const restarted = new IdentityService("12345", databasePath);
    await restarted.initialization;
    assert.equal(restarted.findUidByUin(7654321), "uid-alpha");
    assert.equal(restarted.findUinByUid("uid-alpha"), 7654321);
    await restarted.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("conflicting observations replace both sides of the mapping", async () => {
  const identity = IdentityService.memory("12345");
  await identity.rememberUidUin("uid-a", 1001);
  await identity.rememberUidUin("uid-a", 1002);
  assert.equal(identity.findUinByUid("uid-a"), 1002);
  assert.equal(identity.findUidByUin(1001), null);

  await identity.rememberUidUin("uid-b", 1002);
  assert.equal(identity.findUidByUin(1002), "uid-b");
  assert.equal(identity.findUinByUid("uid-a"), null);
  assert.equal(identity.findUinByUid("uid-b"), 1002);
  await identity.close();
});

test("missing database path is created and corrupt database fails explicitly", async () => {
  const root = await temporaryDirectory();
  try {
    const missing = new IdentityService("12345", path.join(root, "new", "identity.db"));
    await assert.doesNotReject(missing.initialization);
    await missing.close();

    const corruptPath = path.join(root, "corrupt.db");
    await writeFile(corruptPath, "not a sqlite database");
    const corrupt = new IdentityService("12345", corruptPath);
    await assert.rejects(corrupt.initialization, /IdentityService failed to initialize database/);
    assert.equal(corrupt.findUidByUin(1), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
