// Tests for the per-UIN OneBot config loader.
//
// The point of this module is one line —
//
//     loadOneBotConfig(uin).notifications?.channelIds ?? []
//
// — so the tests are organised around the ways that line can quietly go wrong,
// not around the module's internal shape:
//
//   1. `notifications.channelIds` is last-write-wins per **whole list**, not a
//      union (spec §3.5). A union looks like the obviously-correct choice and
//      breaks both real cases: a per-UIN file that omits the key must inherit, and
//      one that says `[]` must clear. Getting this wrong looks like "notifications
//      keep firing after I disabled them".
//   2. The two config files have **different** corruption policies (spec §4.2).
//      The global overlay warns and is ignored; the per-UIN file throws. Collapsing
//      them either lets one hand-edit lock every account out, or hides real
//      corruption in a machine-written file.
//   3. `statusCommand` is lenient while `historySync` is strict (spec §4.4). That
//      asymmetry is a deliberate bug-for-bug port: `historySync.enabled` is read
//      once at construction and never re-read, so a silently-ignored typo would
//      stay invisible for the life of the process.
//   4. Broken adapters are **dropped**, not rejected (§4.5), while a duplicate
//      name is **rejected** (§4.6) because the runtime keys adapters by name.
//
// Every test uses the module's `configDir` option — a documented divergence, since
// the reference hardcodes the relative string `"config"` and therefore depends on
// the process CWD. Nothing here reads or writes the repo's real `config/`
// directory, and no test prints a token.
//
// Line numbers in test names are `reference/index.mjs` positions.

import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  HTTP_DEFAULT_SERVER,
  MAX_PAYLOAD_BYTES_MAX,
  MAX_PAYLOAD_BYTES_MIN,
  PER_UIN_SNAPSHOT_MARKER,
  STATUS_COMMAND_COOLDOWN_MAX,
  WS_DEFAULT_SERVER,
  generateAccessToken,
  makeDefaultOneBotConfig,
  makeDefaultStatusCommand,
} from "../src/onebot/config-defaults.js";
import {
  OneBotConfigValidationError,
  applyOneBotListenPortOverrides,
  assertValidOneBotConfig,
  fromJson,
  hasLegacyTopLevel,
  loadOneBotConfig,
  normalizeChannelIds,
  saveOneBotConfig,
  toJsonObject,
  tryLoadJson,
} from "../src/onebot/config.js";
import { setLogSink, type LogEntry } from "../src/onebot/log.js";

// ---------------------------------------------------------------------------
// Scratch space
// ---------------------------------------------------------------------------

// Under `ts/build/tmp`, never `/tmp`: that is tmpfs on this box and the machine has
// 1.9GB of RAM in total. One directory per test; all removed when the file ends.
const SCRATCH_ROOT = path.resolve(import.meta.dirname, "../tmp");
const scratchDirs: string[] = [];
let counter = 0;

// The two env knobs `applyOneBotListenPortOverrides` reads. Cleared before every
// test so an assertion can never depend on the developer's shell.
const OVERRIDE_ENV = ["SNOWLUMA_ONEBOT_HTTP_PORT", "SNOWLUMA_ONEBOT_WS_PORT"] as const;

after(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
  setLogSink(null);
  for (const name of OVERRIDE_ENV) delete process.env[name];
});

beforeEach(() => {
  for (const name of OVERRIDE_ENV) delete process.env[name];
});

function scratchDir(): string {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  counter += 1;
  const dir = fs.mkdtempSync(path.join(SCRATCH_ROOT, `onebot-config-${String(process.pid)}-${String(counter)}-`));
  scratchDirs.push(dir);
  return dir;
}

/** Write `<dir>/<name>` with `contents`, creating `dir` if needed. */
function writeFile(dir: string, name: string, contents: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents, "utf8");
  return file;
}

/** Write `<dir>/onebot_<uin>.json` from a value. */
function writePerUin(dir: string, uin: string, value: unknown): string {
  return writeFile(dir, `onebot_${uin}.json`, JSON.stringify(value, null, 2));
}

/** Write `<dir>/onebot.json` (the global overlay) from a value. */
function writeGlobal(dir: string, value: unknown): string {
  return writeFile(dir, "onebot.json", JSON.stringify(value, null, 2));
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function perUinPath(dir: string, uin: string): string {
  return path.join(dir, `onebot_${uin}.json`);
}

/** The four network lists, for writing a minimal valid per-UIN file. */
const EMPTY_NETWORKS = { httpServers: [], httpClients: [], wsServers: [], wsClients: [] };

/** A valid UIN: `isRealUin` wants 5–10 digits. */
const UIN = "10001";

/** Run `fn` with every emitted log record captured, and return both. */
function withLogCapture<T>(fn: () => T): { value: T; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  setLogSink((entry) => entries.push(entry));
  try {
    return { value: fn(), entries };
  } finally {
    setLogSink(null);
  }
}

/** Same, for a call whose result the test does not need. */
function captureLog(fn: () => void): LogEntry[] {
  return withLogCapture(fn).entries;
}

// ---------------------------------------------------------------------------
// §2.1 Factory defaults
// ---------------------------------------------------------------------------

test("makeDefaultStatusCommand returns a fresh copy each call (§2.1 L5146)", () => {
  const first = makeDefaultStatusCommand();
  const second = makeDefaultStatusCommand();
  assert.deepEqual(first, { enabled: true, swallow: false, cooldownSeconds: 5, trigger: "#hz" });
  assert.notEqual(first, second);
  first.trigger = "#mutated";
  assert.equal(second.trigger, "#hz");
});

test("generateAccessToken mints 43 base64url chars, distinct per call (§2.1 L5181)", () => {
  const first = generateAccessToken();
  const second = generateAccessToken();
  assert.equal(first.length, 43);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("makeDefaultOneBotConfig: factory listeners on 3000/3001 with fresh tokens (§2.1 L5149)", () => {
  const config = makeDefaultOneBotConfig();

  assert.equal(config.networks.httpServers.length, 1);
  assert.equal(config.networks.wsServers.length, 1);
  assert.deepEqual(config.networks.httpClients, []);
  assert.deepEqual(config.networks.wsClients, []);

  const http = config.networks.httpServers[0]!;
  assert.equal(http.name, HTTP_DEFAULT_SERVER);
  assert.equal(http.host, "127.0.0.1");
  // `3e3` in the bundle is 3000, not 3001 — the WS listener is the 3001 one.
  assert.equal(http.port, 3000);
  assert.equal(http.path, "/");
  assert.equal(http.enableWebSocket, false);
  assert.equal(http.enableSse, false);
  assert.equal(http.messageFormat, "array");
  assert.equal(http.reportSelfMessage, false);
  assert.equal(http.accessToken?.length, 43);

  const ws = config.networks.wsServers[0]!;
  assert.equal(ws.name, WS_DEFAULT_SERVER);
  assert.equal(ws.host, "127.0.0.1");
  assert.equal(ws.port, 3001);
  assert.equal(ws.path, "/");
  assert.equal(ws.role, "Universal");
  assert.equal(ws.accessToken?.length, 43);

  // Two different tokens from one call, and different again on the next call.
  assert.notEqual(http.accessToken, ws.accessToken);
  assert.notEqual(makeDefaultOneBotConfig().networks.httpServers[0]!.accessToken, http.accessToken);

  assert.deepEqual(config.statusCommand, { enabled: true, swallow: false, cooldownSeconds: 5, trigger: "#hz" });
  assert.deepEqual(config.historySync, { enabled: false });
  assert.deepEqual(config.notifications, { channelIds: [] });
});

test("the factory config passes the strict validator (§2.4)", () => {
  assert.doesNotThrow(() => assertValidOneBotConfig(makeDefaultOneBotConfig()));
});

// ---------------------------------------------------------------------------
// §4.1 Loading: missing files, fresh install, the mkdir side effect
// ---------------------------------------------------------------------------

test("load with no files at all bootstraps the factory adapters and creates the dir (§4.1, §4.3)", () => {
  const dir = path.join(scratchDir(), "nested", "config");
  assert.equal(fs.existsSync(dir), false);

  const config = loadOneBotConfig(UIN, { configDir: dir });

  // A read has a filesystem side effect in the reference too (`mkdir -p config`).
  assert.equal(fs.existsSync(dir), true);
  assert.deepEqual(
    config.networks.httpServers.map((entry) => [entry.name, entry.port]),
    [[HTTP_DEFAULT_SERVER, 3000]],
  );
  assert.deepEqual(
    config.networks.wsServers.map((entry) => [entry.name, entry.port]),
    [[WS_DEFAULT_SERVER, 3001]],
  );
  assert.deepEqual(config.notifications, { channelIds: [] });
  assert.deepEqual(config.historySync, { enabled: false });
  assert.equal(config.statusCommand.trigger, "#hz");
});

test("persistDefaults writes the per-UIN file as a snapshot, tokens included (§4.1 step 6)", () => {
  const dir = scratchDir();
  const config = loadOneBotConfig(UIN, { persistDefaults: true, configDir: dir });

  const file = perUinPath(dir, UIN);
  assert.equal(fs.existsSync(file), true);
  const saved = readJson(file);
  // No global file existed, so the mode is `"snapshot"`, not `"overlay"`.
  assert.equal(saved["mode"], PER_UIN_SNAPSHOT_MARKER);

  const networks = saved["networks"] as Record<string, Record<string, unknown>[]>;
  assert.equal(networks["httpServers"]!.length, 1);
  assert.equal(networks["httpServers"]![0]!["accessToken"], config.networks.httpServers[0]!.accessToken);
});

test("persistDefaults does not rewrite an existing canonical file (§4.1 step 6)", () => {
  const dir = scratchDir();
  const file = writePerUin(dir, UIN, { mode: "snapshot", networks: {}, statusCommand: {}, historySync: {} });
  const before = fs.readFileSync(file, "utf8");

  // This file is canonical-shaped but semantically broken, so the load throws
  // rather than repairing it. What matters is that the bytes are untouched: the
  // reference only persists when the file is *missing* or *legacy*.
  assert.throws(() => loadOneBotConfig(UIN, { persistDefaults: true, configDir: dir }), OneBotConfigValidationError);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("an empty-but-present per-UIN file yields zero adapters, not the factory ones (§4.3)", () => {
  const dir = scratchDir();
  writePerUin(dir, UIN, { mode: "snapshot" });

  const config = loadOneBotConfig(UIN, { configDir: dir });
  // Someone emptied the file deliberately; the listener defaults do not come back.
  assert.deepEqual(config.networks.httpServers, []);
  assert.deepEqual(config.networks.wsServers, []);
});

test("fromJson injects the factory listeners only on a genuinely fresh install (§4.3)", () => {
  assert.deepEqual(
    fromJson([], true).networks.httpServers.map((entry) => entry.name),
    [HTTP_DEFAULT_SERVER],
  );
  // Present-but-empty sources: not a fresh install, so nothing is injected.
  assert.deepEqual(fromJson([{ mode: "snapshot" }], false).networks, EMPTY_NETWORKS);
});

// ---------------------------------------------------------------------------
// §4.2 Malformed files: the two policies differ
// ---------------------------------------------------------------------------

test("a corrupt GLOBAL file is ignored, not fatal (§4.2 L5886)", () => {
  const dir = scratchDir();
  const global = writeFile(dir, "onebot.json", "{ this is not json ");
  writePerUin(dir, UIN, { mode: "snapshot", networks: { httpServers: [{ name: "kept", port: 4000 }] } });

  const { value: config, entries } = withLogCapture(() =>
    loadOneBotConfig(UIN, { configDir: dir }),
  );

  assert.equal(config.networks.httpServers.length, 1);
  assert.equal(config.networks.httpServers[0]!.name, "kept");
  const warning = entries.find((entry) => entry.level === "warn");
  assert.ok(warning, "expected a warning for the unreadable global file");
  assert.match(warning.message, /is corrupt and will be ignored/);
  assert.ok(warning.message.includes(global), "the warning names the file");
});

test("a corrupt global file with NO per-UIN file still falls back to the defaults (§4.2)", () => {
  const dir = scratchDir();
  writeFile(dir, "onebot.json", "{ this is not json ");
  // Neither file is readable, so this counts as a fresh install.
  const config = loadOneBotConfig(UIN, { configDir: dir });
  assert.equal(config.networks.httpServers.length, 1);
  assert.equal(config.networks.httpServers[0]!.port, 3000);
});

test("a corrupt PER-UIN file throws, with the SyntaxError as cause (§4.2 L5886)", () => {
  const dir = scratchDir();
  writeFile(dir, `onebot_${UIN}.json`, '{ "mode": "snapshot", }');

  assert.throws(
    () => loadOneBotConfig(UIN, { configDir: dir }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^config file .*onebot_10001\.json is corrupt: /);
      assert.ok(error.cause instanceof SyntaxError, "the parse error is preserved as the cause");
      return true;
    },
  );
});

test("a JSON root that is not an object is corruption in both files (§4.2)", () => {
  const perUinDir = scratchDir();
  writeFile(perUinDir, `onebot_${UIN}.json`, "[1, 2, 3]");
  assert.throws(
    () => loadOneBotConfig(UIN, { configDir: perUinDir }),
    /configuration root must be an object/,
  );

  const globalDir = scratchDir();
  writeFile(globalDir, "onebot.json", "null");
  // The global file is lenient, so this loads with no sources at all.
  assert.deepEqual(loadOneBotConfig(UIN, { configDir: globalDir }).notifications, { channelIds: [] });
});

test("tryLoadJson returns null for a missing file instead of throwing", () => {
  assert.equal(tryLoadJson(path.join(scratchDir(), "nope.json")), null);
});

test("semantic corruption throws OneBotConfigValidationError, not a 'is corrupt' error (§4.2)", () => {
  const dir = scratchDir();
  writePerUin(dir, UIN, { mode: "snapshot", historySync: { enabled: "yes" } });

  assert.throws(
    () => loadOneBotConfig(UIN, { configDir: dir }),
    (error: unknown) => {
      // The distinction the WebUI's 4xx-vs-500 branch depends on.
      assert.ok(error instanceof OneBotConfigValidationError);
      assert.equal(error.message, "historySync.enabled must be a boolean");
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// §3.5 notifications.channelIds: last-write-wins, not a union
// ---------------------------------------------------------------------------

test("channelIds come from the per-UIN file", () => {
  const dir = scratchDir();
  writePerUin(dir, UIN, {
    mode: "snapshot",
    networks: EMPTY_NETWORKS,
    notifications: { channelIds: ["ops", "dev"] },
  });
  assert.deepEqual(loadOneBotConfig(UIN, { configDir: dir }).notifications, { channelIds: ["ops", "dev"] });
});

test("channelIds: a per-UIN file WITHOUT the key inherits the global list (§3.5 AF)", () => {
  const dir = scratchDir();
  writeGlobal(dir, { notifications: { channelIds: ["ops", "dev"] } });
  // No `mode`, so this is an overlay; and no `notifications`, so it inherits.
  writePerUin(dir, UIN, { networks: EMPTY_NETWORKS });

  assert.deepEqual(loadOneBotConfig(UIN, { configDir: dir }).notifications, { channelIds: ["ops", "dev"] });
});

test("channelIds: a per-UIN EMPTY list CLEARS the global list (§3.5 AG)", () => {
  const dir = scratchDir();
  writeGlobal(dir, { notifications: { channelIds: ["ops", "dev"] } });
  writePerUin(dir, UIN, { networks: EMPTY_NETWORKS, notifications: { channelIds: [] } });

  // Present-but-empty wins: `[]` is a deliberate opt-out, not "inherit". An
  // array-merge implementation gets exactly this case wrong.
  assert.deepEqual(loadOneBotConfig(UIN, { configDir: dir }).notifications, { channelIds: [] });
});

test("channelIds: a per-UIN list replaces, it does not union (§3.5)", () => {
  const dir = scratchDir();
  writeGlobal(dir, { notifications: { channelIds: ["ops", "dev"] } });
  writePerUin(dir, UIN, { networks: EMPTY_NETWORKS, notifications: { channelIds: ["alerts"] } });

  assert.deepEqual(loadOneBotConfig(UIN, { configDir: dir }).notifications, { channelIds: ["alerts"] });
});

test("channelIds: an all-invalid list normalizes to [], with no fallback to global (§3.5 AH)", () => {
  const dir = scratchDir();
  writeGlobal(dir, { notifications: { channelIds: ["ops"] } });
  writePerUin(dir, UIN, { networks: EMPTY_NETWORKS, notifications: { channelIds: ["bad id", "", "a/b"] } });

  assert.deepEqual(loadOneBotConfig(UIN, { configDir: dir }).notifications, { channelIds: [] });
});

test("mode: 'snapshot' ignores the global file entirely (§3.3)", () => {
  const dir = scratchDir();
  writeGlobal(dir, {
    notifications: { channelIds: ["ops"] },
    networks: { httpServers: [{ name: "global-only", port: 5000 }] },
  });
  writePerUin(dir, UIN, { mode: "snapshot", notifications: { channelIds: ["solo"] } });

  const config = loadOneBotConfig(UIN, { configDir: dir });
  assert.deepEqual(config.notifications, { channelIds: ["solo"] });
  assert.deepEqual(config.networks.httpServers, []);
});

test("normalizeChannelIds trims, dedupes, keeps order, drops non-slugs (§3.5 L5732)", () => {
  assert.deepEqual(
    normalizeChannelIds(["  ops  ", "dev", "ops", "a/b", "", 7, null, "x".repeat(65), "ok.slug-1_2"]),
    ["ops", "dev", "ok.slug-1_2"],
  );
  assert.deepEqual(normalizeChannelIds("not an array"), []);
  // The bound is inclusive at 64 and exclusive at 65.
  assert.deepEqual(normalizeChannelIds(["x".repeat(64)]), ["x".repeat(64)]);
  assert.deepEqual(normalizeChannelIds(["x".repeat(65)]), []);
});

// ---------------------------------------------------------------------------
// §3.6 statusCommand clamping
// ---------------------------------------------------------------------------

test("statusCommand: cooldown clamps to a year, trigger is trimmed, a bad swallow is ignored (§3.6)", () => {
  const dir = scratchDir();
  writePerUin(dir, UIN, {
    mode: "snapshot",
    statusCommand: { trigger: "  Haizakura ", cooldownSeconds: 99_999_999, swallow: "yes" },
  });

  const status = loadOneBotConfig(UIN, { configDir: dir }).statusCommand;
  // The non-boolean `swallow` is ignored silently here — the strict validator would
  // have rejected it. That is the lenient half of the §4.4 asymmetry.
  assert.deepEqual(status, {
    enabled: true,
    swallow: false,
    cooldownSeconds: STATUS_COMMAND_COOLDOWN_MAX,
    trigger: "Haizakura",
  });
  assert.equal(STATUS_COMMAND_COOLDOWN_MAX, 31_536_000);
});

test("statusCommand: the trigger is cut to 32 chars, and a multi-line or blank one keeps the default (§3.6)", () => {
  const long = fromJson([{ statusCommand: { trigger: "y".repeat(40) } }], false).statusCommand;
  assert.equal(long.trigger, "y".repeat(32));

  assert.equal(fromJson([{ statusCommand: { trigger: "a\nb" } }], false).statusCommand.trigger, "#hz");
  assert.equal(fromJson([{ statusCommand: { trigger: "   " } }], false).statusCommand.trigger, "#hz");
});

test("statusCommand: a negative cooldown floors at 0 and a numeric string is accepted (§3.6, L5878)", () => {
  assert.equal(fromJson([{ statusCommand: { cooldownSeconds: -30 } }], false).statusCommand.cooldownSeconds, 0);
  assert.equal(fromJson([{ statusCommand: { cooldownSeconds: "42" } }], false).statusCommand.cooldownSeconds, 42);
});

test("statusCommand: enabled/swallow are last-write-wins, and an absent key keeps its value (§3.6)", () => {
  const merged = fromJson(
    [{ statusCommand: { enabled: false, swallow: true } }, { statusCommand: { enabled: true } }],
    false,
  ).statusCommand;
  assert.equal(merged.enabled, true);
  assert.equal(merged.swallow, true);
});

// ---------------------------------------------------------------------------
// §4.4 The lenient/strict asymmetry
// ---------------------------------------------------------------------------

test("statusCommand:{enabled:'yes'} loads fine, historySync:{enabled:'yes'} throws (§4.4)", () => {
  // Lenient: the typo is ignored and the default `true` survives.
  assert.equal(fromJson([{ statusCommand: { enabled: "yes" } }], false).statusCommand.enabled, true);

  // Strict: the same class of typo fails the whole load.
  assert.throws(
    () => fromJson([{ historySync: { enabled: "yes" } }], false),
    (error: unknown) => {
      assert.ok(error instanceof OneBotConfigValidationError);
      assert.equal(error.message, "historySync.enabled must be a boolean");
      return true;
    },
  );
});

test("historySync rejects unknown keys on the load path; statusCommand ignores them (§4.4, L5432)", () => {
  assert.throws(
    () => fromJson([{ historySync: { enabled: true, extra: 1 } }], false),
    /historySync\.extra is not supported/,
  );
  // The load path is otherwise permissive about unknown keys (§4.5).
  assert.doesNotThrow(() => fromJson([{ statusCommand: { enabled: true, extra: 1 } }], false));
});

test("historySync is last-write-wins and defaults to disabled (§4.4)", () => {
  assert.deepEqual(fromJson([], false).historySync, { enabled: false });
  assert.deepEqual(
    fromJson([{ historySync: { enabled: true } }, { historySync: { enabled: false } }], false).historySync,
    { enabled: false },
  );
});

// ---------------------------------------------------------------------------
// §4.5 Adapter drop rules (silent, not errors)
// ---------------------------------------------------------------------------

test("server adapters with port <= 0 are dropped; the rest keep their order (§4.5 K)", () => {
  const config = fromJson(
    [
      {
        networks: {
          httpServers: [
            { name: "good", port: 3000 },
            { port: 0 },
            { port: -5 },
            // A numeric string is accepted (`asNumber`, L5878) and never dropped.
            { name: "named", port: "6700" },
          ],
        },
      },
    ],
    false,
  );

  // Port 0 means "any free port" to the OS, so a listener with it would silently
  // bind somewhere random instead of failing; `-5` clamps to 0 and is dropped too.
  // Dropped entries do not consume an auto-name number.
  assert.deepEqual(
    config.networks.httpServers.map((entry) => [entry.name, entry.port]),
    [
      ["good", 3000],
      ["named", 6700],
    ],
  );
});

test("an unnamed adapter gets http-N / ws-N style auto names in ingestion order (§4.5)", () => {
  const config = fromJson(
    [
      {
        networks: {
          httpServers: [{ port: 3000 }, { port: 3001 }],
          wsServers: [{ port: 3101 }],
        },
      },
    ],
    false,
  );
  assert.deepEqual(
    config.networks.httpServers.map((entry) => entry.name),
    ["http-1", "http-2"],
  );
  assert.deepEqual(
    config.networks.wsServers.map((entry) => entry.name),
    ["ws-1"],
  );
});

test("client adapters without a url are dropped unless explicitly disabled (§4.5)", () => {
  const config = fromJson(
    [
      {
        networks: {
          wsClients: [
            { enabled: false },
            { url: "ws://x/y" },
            // `enabled: true` with no url has nothing to connect to: a drop, same
            // rule as omitting `enabled` altogether.
            { enabled: true },
          ],
        },
      },
    ],
    false,
  );

  assert.deepEqual(
    config.networks.wsClients.map((entry) => [entry.name, entry.url]),
    [
      ["wsclient-1", ""],
      ["wsclient-2", "ws://x/y"],
    ],
  );
});

test("httpClients drop the same way, and the legacy httpPostEndpoints key still merges (§2.5)", () => {
  const config = fromJson([{ httpPostEndpoints: [{ url: "http://legacy/report" }, { name: "no-url" }] }], false);
  assert.deepEqual(
    config.networks.httpClients.map((entry) => [entry.name, entry.url]),
    [["httppost-1", "http://legacy/report"]],
  );
});

test("wsClient reconnectIntervalMs floors at 1000 and defaults to 5000 (§4.5, L5842)", () => {
  const config = fromJson(
    [{ networks: { wsClients: [{ url: "ws://a/1", reconnectIntervalMs: 10 }, { url: "ws://a/2" }] } }],
    false,
  );
  assert.equal(config.networks.wsClients[0]!.reconnectIntervalMs, 1000);
  assert.equal(config.networks.wsClients[1]!.reconnectIntervalMs, 5000);
});

test("a satori WS listener defaults its path to /v1/events (§3.7 L5837)", () => {
  const config = fromJson([{ networks: { wsServers: [{ port: 5600, protocol: "satori" }, { port: 5601 }] } }], false);
  assert.equal(config.networks.wsServers[0]!.path, "/v1/events");
  assert.equal(config.networks.wsServers[0]!.protocol, "satori");
  assert.equal(config.networks.wsServers[1]!.path, "/");
});

test("overlay merge is per name, and keeps the position of first appearance (§3.3 V)", () => {
  const dir = scratchDir();
  writeGlobal(dir, {
    networks: {
      httpServers: [
        { name: "a", port: 3000 },
        { name: "b", port: 4001 },
      ],
    },
  });
  writePerUin(dir, UIN, {
    networks: {
      httpServers: [
        { name: "b", port: 4001 },
        { name: "c", port: 4002 },
      ],
    },
  });

  assert.deepEqual(
    loadOneBotConfig(UIN, { configDir: dir }).networks.httpServers.map((entry) => [entry.name, entry.port]),
    [
      ["a", 3000],
      ["b", 4001],
      ["c", 4002],
    ],
  );
});

test("maxPayloadBytes below the floor throws instead of dropping the adapter (§2.4 L5517)", () => {
  assert.throws(
    () => fromJson([{ networks: { wsServers: [{ port: 3001, maxPayloadBytes: 100 }] } }], false),
    new RegExp(
      `websocket server\\.maxPayloadBytes must be an integer between ${String(MAX_PAYLOAD_BYTES_MIN)} and ${String(MAX_PAYLOAD_BYTES_MAX)}`,
    ),
  );
  assert.equal(
    fromJson([{ networks: { wsServers: [{ port: 3001, maxPayloadBytes: 65_536 }] } }], false).networks.wsServers[0]!
      .maxPayloadBytes,
    65_536,
  );
});

test("httpClients may not set maxPayloadBytes — it is a frame cap (§2.4 L5522)", () => {
  assert.throws(
    () => fromJson([{ networks: { httpClients: [{ url: "http://x/", maxPayloadBytes: 65_536 }] } }], false),
    /http client\.maxPayloadBytes is only supported by WebSocket adapters/,
  );
});

// ---------------------------------------------------------------------------
// §4.6 Validation errors the loader must surface
// ---------------------------------------------------------------------------

test("a duplicate adapter name ACROSS kinds is rejected (§4.5 J)", () => {
  assert.throws(
    () =>
      fromJson(
        [{ networks: { httpServers: [{ name: "dup", port: 3000 }], wsServers: [{ name: "dup", port: 3001 }] } }],
        false,
      ),
    (error: unknown) => {
      assert.ok(error instanceof OneBotConfigValidationError);
      assert.equal(error.message, 'network adapter name "dup" is duplicated in httpServers and wsServers');
      return true;
    },
  );
});

test("a duplicate adapter name WITHIN one kind is a merge, not an error (§4.5)", () => {
  const config = fromJson(
    [{ networks: { httpServers: [{ name: "same", port: 3000 }, { name: "same", port: 3001 }] } }],
    false,
  );
  assert.deepEqual(
    config.networks.httpServers.map((entry) => [entry.name, entry.port]),
    [["same", 3001]],
  );
});

test("two listeners on the same host:port are rejected (§4.6)", () => {
  assert.throws(
    () =>
      fromJson(
        [
          {
            networks: {
              httpServers: [{ name: "one", host: "127.0.0.1", port: 3000 }],
              wsServers: [{ name: "two", host: "127.0.0.1", port: 3000 }],
            },
          },
        ],
        false,
      ),
    /conflicts with .* on server binding 127\.0\.0\.1:3000/,
  );
});

test("names with surrounding whitespace are trimmed by the merge but rejected by the validator (§4.6)", () => {
  // A load never produces the invalid shape, because the merge trims.
  assert.equal(
    fromJson([{ networks: { httpServers: [{ name: "  padded  ", port: 3000 }] } }], false).networks.httpServers[0]!
      .name,
    "padded",
  );

  // Hand-built input still fails, which is what the WebUI save path relies on.
  const handBuilt = makeDefaultOneBotConfig();
  handBuilt.networks.httpServers[0]!.name = "  padded  ";
  assert.throws(() => assertValidOneBotConfig(handBuilt), /must not have surrounding whitespace/);
});

test("unknown top-level keys are ignored on the load path (§4.5)", () => {
  assert.doesNotThrow(() => fromJson([{ bogusKey: { anything: true }, musicSignUrl: "https://x/" }], false));
});

test("legacy top-level messageFormat/reportSelfMessage become per-adapter defaults (§3.7)", () => {
  const config = fromJson(
    [{ messageFormat: "string", reportSelfMessage: true, httpServers: [{ name: "old-http", port: 6700 }] }],
    false,
  );
  assert.equal(config.networks.httpServers[0]!.messageFormat, "string");
  assert.equal(config.networks.httpServers[0]!.reportSelfMessage, true);

  // An adapter that states its own value still wins over the legacy default.
  const overriding = fromJson(
    [{ messageFormat: "string", httpServers: [{ name: "own", port: 6700, messageFormat: "array" }] }],
    false,
  );
  assert.equal(overriding.networks.httpServers[0]!.messageFormat, "array");
});

test("hasLegacyTopLevel detects the pre-networks layout (§2.5 L5856)", () => {
  assert.equal(hasLegacyTopLevel({ httpServers: [] }), true);
  assert.equal(hasLegacyTopLevel({ httpPostEndpoints: [] }), true);
  assert.equal(hasLegacyTopLevel({ messageFormat: "string" }), true);
  assert.equal(hasLegacyTopLevel({ reportSelfMessage: false }), true);
  assert.equal(hasLegacyTopLevel({ mode: "snapshot", networks: {} }), false);
});

test("persistDefaults rewrites a legacy file into canonical snapshot form (§3.7)", () => {
  const dir = scratchDir();
  writePerUin(dir, UIN, {
    httpServers: [{ name: "old-http", port: 6700, accessToken: "tok" }],
    messageFormat: "string",
    reportSelfMessage: true,
  });

  loadOneBotConfig(UIN, { persistDefaults: true, configDir: dir });

  const saved = readJson(perUinPath(dir, UIN));
  assert.equal(saved["mode"], "snapshot");
  assert.equal(saved["httpServers"], undefined, "the legacy top-level key is gone");

  const httpServers = (saved["networks"] as { httpServers: Record<string, unknown>[] }).httpServers;
  assert.equal(httpServers.length, 1);
  assert.deepEqual(
    {
      name: httpServers[0]!["name"],
      accessToken: httpServers[0]!["accessToken"],
      messageFormat: httpServers[0]!["messageFormat"],
      reportSelfMessage: httpServers[0]!["reportSelfMessage"],
      host: httpServers[0]!["host"],
      port: httpServers[0]!["port"],
      path: httpServers[0]!["path"],
    },
    {
      name: "old-http",
      accessToken: "tok",
      messageFormat: "string",
      reportSelfMessage: true,
      host: "0.0.0.0",
      port: 6700,
      path: "/",
    },
  );
  // The factory listeners are NOT injected over a migrated file.
  assert.equal(httpServers.some((entry) => entry["name"] === HTTP_DEFAULT_SERVER), false);
});

// ---------------------------------------------------------------------------
// §2.3 Saving
// ---------------------------------------------------------------------------

test("save writes mode 0600, leaves no .tmp behind, and round-trips (§2.3 L5900)", () => {
  const dir = scratchDir();
  const config = makeDefaultOneBotConfig();
  config.notifications = { channelIds: ["ops", "dev"] };

  saveOneBotConfig(UIN, config, { configDir: dir });

  const file = perUinPath(dir, UIN);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => name.endsWith(".tmp")),
    [],
  );

  // Reloading with the same tokens is lossless.
  const reloaded = loadOneBotConfig(UIN, { configDir: dir });
  assert.deepEqual(reloaded.notifications, { channelIds: ["ops", "dev"] });
  assert.equal(reloaded.networks.httpServers[0]!.accessToken, config.networks.httpServers[0]!.accessToken);
  assert.equal(reloaded.networks.httpServers[0]!.port, 3000);
  assert.deepEqual(reloaded.statusCommand, config.statusCommand);
  assert.deepEqual(reloaded.historySync, config.historySync);
});

test("save validates BEFORE writing: a rejected config creates no file and no directory (§2.3)", () => {
  const dir = path.join(scratchDir(), "never-created");
  const config = makeDefaultOneBotConfig();
  config.statusCommand.trigger = "";

  assert.throws(() => saveOneBotConfig(UIN, config, { configDir: dir }), OneBotConfigValidationError);
  assert.equal(fs.existsSync(dir), false, "validation runs before mkdir");
});

test("save defaults to snapshot mode and honours an explicit overlay (§2.3, §3.3)", () => {
  const dir = scratchDir();
  saveOneBotConfig(UIN, makeDefaultOneBotConfig(), { configDir: dir });
  assert.equal(readJson(perUinPath(dir, UIN))["mode"], "snapshot");

  saveOneBotConfig(UIN, makeDefaultOneBotConfig(), { mode: "overlay", configDir: dir });
  assert.equal(readJson(perUinPath(dir, UIN))["mode"], "overlay");
});

test("toJsonObject always emits notifications, and omits enabled:true / empty tokens (§2.3 L5610)", () => {
  const config = makeDefaultOneBotConfig();
  delete config.notifications;

  const json = toJsonObject(config, "snapshot");
  // The §5.2 landmine, pinned: the key is always written, so an absent section
  // becomes `[]` and then wins the LWW merge on the next load.
  assert.deepEqual(json["notifications"], { channelIds: [] });

  type HttpList = { httpServers: Record<string, unknown>[] };
  const http = (json["networks"] as HttpList).httpServers[0]!;
  assert.equal("enabled" in http, false, "only `enabled: false` is written");

  const noToken = makeDefaultOneBotConfig();
  noToken.networks.httpServers[0]!.accessToken = "";
  assert.equal(
    "accessToken" in (toJsonObject(noToken, "snapshot")["networks"] as HttpList).httpServers[0]!,
    false,
  );

  const disabled = makeDefaultOneBotConfig();
  disabled.networks.httpServers[0]!.enabled = false;
  assert.equal((toJsonObject(disabled, "snapshot")["networks"] as HttpList).httpServers[0]!["enabled"], false);
});

test("a WebUI-style save whose body has no notifications key shadows the global list (§5.2)", () => {
  const dir = scratchDir();
  writeGlobal(dir, { notifications: { channelIds: ["ops", "dev"] } });
  writePerUin(dir, UIN, { networks: EMPTY_NETWORKS, notifications: { channelIds: ["ops", "dev"] } });
  assert.deepEqual(loadOneBotConfig(UIN, { configDir: dir }).notifications, { channelIds: ["ops", "dev"] });

  // The WebUI posts back what it fetched; a body without the section (the
  // documented bug) round-trips through `toJsonObject` into `[]`.
  const fetched = loadOneBotConfig(UIN, { configDir: dir });
  delete fetched.notifications;
  saveOneBotConfig(UIN, fetched, { mode: "overlay", configDir: dir });

  assert.deepEqual(loadOneBotConfig(UIN, { configDir: dir }).notifications, { channelIds: [] });
});

// ---------------------------------------------------------------------------
// §4.1 step 7 / §7 step 8: env port overrides apply last, and are never persisted
// ---------------------------------------------------------------------------

test("SNOWLUMA_ONEBOT_HTTP_PORT moves only the factory listener (§7 step 8)", () => {
  const config = makeDefaultOneBotConfig();
  const moved = applyOneBotListenPortOverrides(config, { SNOWLUMA_ONEBOT_HTTP_PORT: "3999" });

  assert.equal(moved.networks.httpServers[0]!.port, 3999);
  assert.equal(moved.networks.wsServers[0]!.port, 3001);
  assert.equal(config.networks.httpServers[0]!.port, 3000, "the input is not mutated");
});

test("a renamed listener does not take the override — it only warns (§7 step 8)", () => {
  const config = makeDefaultOneBotConfig();
  config.networks.httpServers[0]!.name = "renamed";

  const { value: moved, entries } = withLogCapture(() =>
    applyOneBotListenPortOverrides(config, { SNOWLUMA_ONEBOT_HTTP_PORT: "3999" }),
  );

  assert.equal(moved.networks.httpServers[0]!.port, 3000);
  assert.ok(entries.some((entry) => /is ignored; no http-default listener/.test(entry.message)));
});

test("env port overrides apply AFTER the save, so they are never persisted (§4.1 AJ)", () => {
  const dir = scratchDir();
  process.env["SNOWLUMA_ONEBOT_HTTP_PORT"] = "3999";
  try {
    const config = loadOneBotConfig(UIN, { persistDefaults: true, configDir: dir });
    assert.equal(config.networks.httpServers[0]!.port, 3999, "the returned config sees the override");

    const saved = readJson(perUinPath(dir, UIN));
    const savedHttp = (saved["networks"] as { httpServers: Record<string, unknown>[] }).httpServers[0]!;
    assert.equal(savedHttp["port"], 3000, "but the file keeps the real port");
  } finally {
    delete process.env["SNOWLUMA_ONEBOT_HTTP_PORT"];
  }
});

test("an override that would break validation is reverted with a warning (§7 step 8)", () => {
  const config = makeDefaultOneBotConfig();
  // The WS listener already owns 3002, so moving HTTP onto it would collide.
  config.networks.wsServers[0]!.port = 3002;

  const { value: moved, entries } = withLogCapture(() =>
    applyOneBotListenPortOverrides(config, { SNOWLUMA_ONEBOT_HTTP_PORT: "3002" }),
  );

  assert.equal(moved.networks.httpServers[0]!.port, 3000, "reverted to the saved port");
  assert.ok(entries.some((entry) => /listen port override ignored/.test(entry.message)));
});

// ---------------------------------------------------------------------------
// §7 step 6.3: the path-traversal gate (a deliberate divergence)
// ---------------------------------------------------------------------------

test("loadOneBotConfig refuses a uin that is not 5-10 digits, with no filesystem side effect", () => {
  const dir = path.join(scratchDir(), "untouched");
  for (const uin of ["../escape", "1001", "12345678901", "", "10 001"]) {
    assert.throws(
      () => loadOneBotConfig(uin, { configDir: dir }),
      (error: unknown) => {
        assert.ok(error instanceof OneBotConfigValidationError);
        assert.match(error.message, /uin must be a 5-10 digit QQ number/);
        return true;
      },
    );
  }
  assert.equal(fs.existsSync(dir), false, "the gate runs before mkdir");
});

test("saveOneBotConfig refuses the same uins, so nothing is written outside config/", () => {
  const dir = scratchDir();
  assert.throws(
    () => saveOneBotConfig("../escape", makeDefaultOneBotConfig(), { configDir: dir }),
    OneBotConfigValidationError,
  );
  assert.deepEqual(fs.readdirSync(dir), []);
});

// ---------------------------------------------------------------------------
// §3.2 The loaded shape is stricter than the on-disk shape
// ---------------------------------------------------------------------------

test("fromJson materializes messageFormat/reportSelfMessage and the server defaults (§3.2)", () => {
  // The file omits both; the result has both, plus host/path/enable* defaults.
  const adapter = fromJson([{ networks: { httpServers: [{ name: "bare", port: 3000 }] } }], false).networks
    .httpServers[0]!;
  assert.equal(adapter.messageFormat, "array");
  assert.equal(adapter.reportSelfMessage, false);
  assert.equal(adapter.host, "0.0.0.0");
  assert.equal(adapter.path, "/");
  assert.equal(adapter.enableWebSocket, false);
  assert.equal(adapter.enableSse, false);
  // And the merged result is valid by construction.
  assert.doesNotThrow(() => assertValidOneBotConfig(fromJson([{ networks: { httpServers: [{ name: "bare", port: 3000 }] } }], false)));
});
