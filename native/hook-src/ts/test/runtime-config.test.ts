// Tests for the runtime configuration loader — the bottom of the process.
//
// Every assertion here is a claim about `reference/index.mjs`, and the line numbers are
// in the test names so a reviewer can check them without reading this file twice. The
// theme is that a *wrong* config must fail loudly at load time: a silent fallback binds
// the wrong port and nobody notices until an operator cannot reach the WebUI, and a
// silently-truncated unknown key destroys a newer build's settings on the next save.
//
// Nothing in this file prints, copies, or asserts on a real secret, and nothing in it reads
// a credential-bearing `config/webui.json` — those files are gitignored precisely because
// they carry material. The two leak tests build their own `webui.json` from *fake* hex in a
// throwaway `os.tmpdir()` directory and delete it again, which keeps the assertion real
// while leaving the checkout free of anything a reader could mistake for a credential.

import { after, afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_LOG_MAX_TOTAL_MB,
  DEFAULT_RUNTIME_CONFIG_PATH,
  DEFAULT_WEBUI_CONFIG_PATH,
  DEFAULT_WEBUI_HOST,
  DEFAULT_WEBUI_PORT,
  MAX_LISTEN_PORT,
  MAX_LOG_RETAIN_DAYS,
  MAX_LOG_TOTAL_MB,
  MIN_LISTEN_PORT,
  RuntimeConfigError,
  WebuiConfigError,
  loadRuntimeConfig,
  loadWebuiConfig,
  normalizeRuntimeConfig,
  summarizeWebuiAuthState,
  unknownRuntimeConfigKeys,
  validateRuntimeConfig,
} from "../src/host/runtime-config.js";

// `build/test/*.js` -> repo root.
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

// The live configs are gitignored (`.gitignore`: `config/*.json`, with
// `!config/*.example.json` passing the templates): a deployment generates
// `config/runtime.json` and `config/webui.json` on first run, and the WebUI one holds a
// real password hash and salt. The only config a checkout ships is the template pair, so
// that is what "the committed config" can mean here.
const TEMPLATE_RUNTIME_CONFIG = path.join(REPO_ROOT, "config", "runtime.example.json");
const TEMPLATE_WEBUI_CONFIG = path.join(REPO_ROOT, "config", "webui.example.json");

// Scratch space under `ts/build/`, never `/tmp` — that is tmpfs on this box and the
// whole 1.9GB of RAM is already spoken for.
const SCRATCH_ROOT = path.resolve(import.meta.dirname, "../tmp");

let scratchCounter = 0;
const scratchDirs: string[] = [];

// Every directory this file creates is removed when the suite ends. The box has 1.9GB of
// RAM and `ts/build` is on the real disk, but a suite that litters a checkout per run is
// still a suite that eventually fills it.
after(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** A fresh, empty directory under `ts/build/tmp`. */
function scratchDir(): string {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratchCounter += 1;
  const dir = fs.mkdtempSync(path.join(SCRATCH_ROOT, `runtime-config-${String(process.pid)}-${String(scratchCounter)}-`));
  scratchDirs.push(dir);
  return dir;
}

/** Write `contents` to a new scratch file and return its path. */
function writeConfigFile(contents: string, name = "runtime.json"): string {
  const file = path.join(scratchDir(), name);
  fs.writeFileSync(file, contents, "utf8");
  return file;
}

/** A path that is guaranteed not to exist. */
function missingPath(name = "runtime.json"): string {
  return path.join(scratchDir(), name);
}

/** Assert `fn` throws a {@link RuntimeConfigError} naming `field` and mentioning `reason`. */
function assertRejects(fn: () => unknown, field: string, reason: RegExp): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof RuntimeConfigError, `expected RuntimeConfigError, got ${String(error)}`);
    assert.equal(error.field, field, `wrong field on ${String(error.message)}`);
    assert.match(error.message, reason);
    return true;
  });
}

// ---------------------------------------------------------------------------
// The real committed file
// ---------------------------------------------------------------------------

test("the committed config/runtime.example.json parses and validates", () => {
  // Read-only: this test proves the shipped template is loadable, and must never rewrite it.
  const config = loadRuntimeConfig(TEMPLATE_RUNTIME_CONFIG);

  assert.equal(config.webuiPort, 5099);
  assert.equal(config.hookAutoLoad, false);
  assert.equal(config.webuiHost, "127.0.0.1");
  assert.deepEqual(config.webuiTls, { enabled: false });
  assert.equal(config.trustProxy, "");
  assert.equal(config.logMaxTotalMb, 1024);
  assert.equal(config.logRetainDays, 7);
  assert.equal(config.logPerUin, false);
});

test("the committed runtime template has no unknown keys and documents every known one", () => {
  const raw: unknown = JSON.parse(fs.readFileSync(TEMPLATE_RUNTIME_CONFIG, "utf8"));
  assert.deepEqual(unknownRuntimeConfigKeys(raw), []);

  // A template that dropped a field would hide a default instead of documenting it; one
  // that kept a retired field would hand a fresh deployment a config this build only
  // preserves by accident. `updateSource` is absent on purpose: it has no default, and
  // writing one here would pin an unset value to "auto" (see the `updateSource` tests).
  assert.deepEqual(Object.keys(raw as Record<string, unknown>).sort(), [
    "hookAutoLoad",
    "logMaxTotalMb",
    "logPerUin",
    "logRetainDays",
    "trustProxy",
    "webuiHost",
    "webuiPort",
    "webuiTls",
  ]);
});

test("loading the runtime template does not modify it", () => {
  // A loader that normalizes-in-place would corrupt user data; compare bytes across a load.
  const before = fs.readFileSync(TEMPLATE_RUNTIME_CONFIG);
  loadRuntimeConfig(TEMPLATE_RUNTIME_CONFIG);
  assert.deepEqual(fs.readFileSync(TEMPLATE_RUNTIME_CONFIG), before);
});

test("the default paths are the reference's paths (reference/index.mjs:403, 356820)", () => {
  assert.equal(DEFAULT_RUNTIME_CONFIG_PATH, path.join("config", "runtime.json"));
  assert.equal(DEFAULT_WEBUI_CONFIG_PATH, path.join("config", "webui.json"));
});

// ---------------------------------------------------------------------------
// Defaults — one per field, each citing its reference line
// ---------------------------------------------------------------------------

test("an empty object yields every default (reference/index.mjs:232-239)", () => {
  const config = validateRuntimeConfig({});

  assert.equal(config.webuiPort, DEFAULT_WEBUI_PORT); // :232
  assert.equal(config.hookAutoLoad, false); // :233
  assert.equal(config.webuiHost, DEFAULT_WEBUI_HOST); // :234
  assert.deepEqual(config.webuiTls, { enabled: false }); // :235
  assert.equal(config.trustProxy, ""); // :236
  assert.equal(config.logMaxTotalMb, DEFAULT_LOG_MAX_TOTAL_MB); // :237
  assert.equal(config.logRetainDays, 7); // :238
  assert.equal(config.logPerUin, false); // :239
});

test("the default constants are the reference's literals (reference/index.mjs:404-408)", () => {
  assert.equal(DEFAULT_WEBUI_PORT, 5099);
  assert.equal(DEFAULT_WEBUI_HOST, "127.0.0.1");
  assert.equal(DEFAULT_LOG_MAX_TOTAL_MB, 1024);
  assert.equal(MAX_LOG_TOTAL_MB, Math.floor(Number.MAX_SAFE_INTEGER / (1024 * 1024)));
  assert.equal(MAX_LOG_RETAIN_DAYS, Math.floor(Number.MAX_SAFE_INTEGER / (1440 * 60 * 1e3)));
  assert.equal(MIN_LISTEN_PORT, 1);
  assert.equal(MAX_LISTEN_PORT, 65535);
});

test("updateSource has NO default: an absent key stays absent (reference/index.mjs:231)", () => {
  // `...obj.updateSource === void 0 ? {} : {...}` — the property is omitted, not set to a
  // default. Filling it in would turn "unset" into "auto" for the updater.
  const config = validateRuntimeConfig({});
  assert.equal(Object.hasOwn(config, "updateSource"), false);
  assert.equal(config.updateSource, undefined);
});

test("a present updateSource is validated and normalized (reference/index.mjs:209-223)", () => {
  const config = validateRuntimeConfig({
    updateSource: {
      mode: "mirror",
      mirror: "https://mirror.example.com/",
      mirrors: ["https://a.example.com/", "https://a.example.com", "https://b.example.com"],
    },
  });
  assert.deepEqual(config.updateSource, {
    mode: "mirror",
    mirror: "https://mirror.example.com",
    mirrors: ["https://a.example.com", "https://b.example.com"],
  });
});

test("updateSource rejects a mirror mode with no mirror (reference/index.mjs:220)", () => {
  assertRejects(
    () => validateRuntimeConfig({ updateSource: { mode: "mirror", mirrors: [] } }),
    "updateSource",
    /请指定镜像地址/,
  );
});

test("updateSource rejects a non-http mirror URL (reference/index.mjs:192-202)", () => {
  assertRejects(
    () => validateRuntimeConfig({ updateSource: { mode: "auto", mirrors: ["ftp://x.example.com"] } }),
    "updateSource",
    /HTTP\(S\)/,
  );
});

test("updateSource rejects credentials in a mirror URL (reference/index.mjs:200-202)", () => {
  assertRejects(
    () =>
      validateRuntimeConfig({
        updateSource: { mode: "auto", mirrors: ["https://user:pass@x.example.com"] },
      }),
    "updateSource",
    /HTTP\(S\)/,
  );
});

test("updateSource rejects more than 16 mirrors (reference/index.mjs:217)", () => {
  const mirrors = Array.from({ length: 17 }, (_v, i) => `https://m${String(i)}.example.com`);
  assertRejects(
    () => validateRuntimeConfig({ updateSource: { mode: "auto", mirrors } }),
    "updateSource",
    /16/,
  );
});

test("updateSource rejects an unknown mode (reference/index.mjs:214)", () => {
  assertRejects(
    () => validateRuntimeConfig({ updateSource: { mode: "fastest", mirrors: [] } }),
    "updateSource",
    /模式无效/,
  );
});

// ---------------------------------------------------------------------------
// webuiPort — reference/index.mjs:357388-357394 (strict boundary)
// ---------------------------------------------------------------------------

test("webuiPort accepts the whole listen range and truncates nothing", () => {
  assert.equal(validateRuntimeConfig({ webuiPort: 1 }).webuiPort, 1);
  assert.equal(validateRuntimeConfig({ webuiPort: 5099 }).webuiPort, 5099);
  assert.equal(validateRuntimeConfig({ webuiPort: 65535 }).webuiPort, 65535);
});

test("webuiPort rejects 0 — `port > 0` (reference/index.mjs:340)", () => {
  // 0 is the classic "bind anything" port. Accepting it would silently expose the WebUI
  // on every interface, which is the opposite of the loopback default.
  assertRejects(() => validateRuntimeConfig({ webuiPort: 0 }), "webuiPort", /1\.\.65535/);
});

test("webuiPort rejects 65536 — `port <= 65535` (reference/index.mjs:340)", () => {
  assertRejects(() => validateRuntimeConfig({ webuiPort: 65536 }), "webuiPort", /1\.\.65535/);
});

test("webuiPort rejects a negative port", () => {
  assertRejects(() => validateRuntimeConfig({ webuiPort: -1 }), "webuiPort", /1\.\.65535/);
});

test("webuiPort rejects a fraction — a port is an integer", () => {
  assertRejects(() => validateRuntimeConfig({ webuiPort: 5099.5 }), "webuiPort", /integer/);
});

test("webuiPort rejects a string — the settings boundary does not coerce (reference/index.mjs:357389)", () => {
  // Unlike the log fields, `coerceSettingsPatch` demands `typeof p === 'number'`.
  assertRejects(() => validateRuntimeConfig({ webuiPort: "5099" }), "webuiPort", /integer/);
});

test("webuiPort rejects null and booleans with the type named", () => {
  assertRejects(() => validateRuntimeConfig({ webuiPort: null }), "webuiPort", /got null/);
  assertRejects(() => validateRuntimeConfig({ webuiPort: true }), "webuiPort", /got boolean/);
  assertRejects(() => validateRuntimeConfig({ webuiPort: [5099] }), "webuiPort", /got array/);
});

test("webuiPort rejects NaN and Infinity", () => {
  assertRejects(() => validateRuntimeConfig({ webuiPort: Number.NaN }), "webuiPort", /integer/);
  assertRejects(() => validateRuntimeConfig({ webuiPort: Number.POSITIVE_INFINITY }), "webuiPort", /integer/);
});

// ---------------------------------------------------------------------------
// webuiHost — reference/index.mjs:5517-5524 + isValidBindHost 357361
// ---------------------------------------------------------------------------

test("webuiHost accepts loopback, a wildcard, a v4 literal and a v6 literal", () => {
  assert.equal(validateRuntimeConfig({ webuiHost: "127.0.0.1" }).webuiHost, "127.0.0.1");
  assert.equal(validateRuntimeConfig({ webuiHost: "0.0.0.0" }).webuiHost, "0.0.0.0");
  assert.equal(validateRuntimeConfig({ webuiHost: "::1" }).webuiHost, "::1");
  assert.equal(validateRuntimeConfig({ webuiHost: "localhost" }).webuiHost, "localhost");
  assert.equal(validateRuntimeConfig({ webuiHost: "webui.example.com" }).webuiHost, "webui.example.com");
});

test("webuiHost rejects an empty string", () => {
  assertRejects(() => validateRuntimeConfig({ webuiHost: "" }), "webuiHost", /non-empty/);
});

test("webuiHost rejects surrounding whitespace (reference/index.mjs:5521)", () => {
  assertRejects(() => validateRuntimeConfig({ webuiHost: " 127.0.0.1" }), "webuiHost", /whitespace/);
});

test("webuiHost rejects a non-string", () => {
  assertRejects(() => validateRuntimeConfig({ webuiHost: 127 }), "webuiHost", /must be a string/);
});

test("webuiHost rejects a host with a scheme or path (reference/index.mjs:357363)", () => {
  assertRejects(() => validateRuntimeConfig({ webuiHost: "http://127.0.0.1" }), "webuiHost", /bind host/);
  assertRejects(() => validateRuntimeConfig({ webuiHost: "127.0.0.1/x" }), "webuiHost", /bind host/);
});

test("webuiHost rejects an out-of-range v4 literal (reference/index.mjs:357365)", () => {
  // `999.1.1.1` matches `^[\d.]+$` and is therefore checked as an IP, not as labels.
  assertRejects(() => validateRuntimeConfig({ webuiHost: "999.1.1.1" }), "webuiHost", /bind host/);
});

test("webuiHost rejects a label that starts or ends with a hyphen (reference/index.mjs:357366)", () => {
  assertRejects(() => validateRuntimeConfig({ webuiHost: "-bad.example.com" }), "webuiHost", /bind host/);
  assertRejects(() => validateRuntimeConfig({ webuiHost: "bad-.example.com" }), "webuiHost", /bind host/);
});

// ---------------------------------------------------------------------------
// webuiTls — reference/index.mjs:235
// ---------------------------------------------------------------------------

test("webuiTls defaults to disabled and only reads `enabled`", () => {
  assert.deepEqual(validateRuntimeConfig({ webuiTls: {} }).webuiTls, { enabled: false });
  assert.deepEqual(validateRuntimeConfig({ webuiTls: { enabled: true } }).webuiTls, { enabled: true });
  // Extra keys inside webuiTls are not part of the typed shape but must not throw.
  assert.deepEqual(validateRuntimeConfig({ webuiTls: { enabled: true, extra: 1 } }).webuiTls, {
    enabled: true,
  });
});

test("webuiTls rejects a non-object", () => {
  assertRejects(() => validateRuntimeConfig({ webuiTls: true }), "webuiTls", /must be an object/);
  assertRejects(() => validateRuntimeConfig({ webuiTls: "on" }), "webuiTls", /got string/);
  assertRejects(() => validateRuntimeConfig({ webuiTls: null }), "webuiTls", /got null/);
});

test("webuiTls.enabled rejects a non-boolean token", () => {
  assertRejects(
    () => validateRuntimeConfig({ webuiTls: { enabled: "maybe" } }),
    "webuiTls.enabled",
    /must be a boolean/,
  );
  assertRejects(() => validateRuntimeConfig({ webuiTls: { enabled: 2 } }), "webuiTls.enabled", /got number/);
});

test("webuiTls.enabled accepts the reference's bool tokens (reference/index.mjs:374-386)", () => {
  assert.equal(validateRuntimeConfig({ webuiTls: { enabled: 1 } }).webuiTls.enabled, true);
  assert.equal(validateRuntimeConfig({ webuiTls: { enabled: 0 } }).webuiTls.enabled, false);
  assert.equal(validateRuntimeConfig({ webuiTls: { enabled: "yes" } }).webuiTls.enabled, true);
  assert.equal(validateRuntimeConfig({ webuiTls: { enabled: "off" } }).webuiTls.enabled, false);
});

// ---------------------------------------------------------------------------
// hookAutoLoad / logPerUin — reference/index.mjs:233, 239
// ---------------------------------------------------------------------------

test("the boolean flags default to false", () => {
  const config = validateRuntimeConfig({});
  assert.equal(config.hookAutoLoad, false);
  assert.equal(config.logPerUin, false);
});

test("the boolean flags accept true", () => {
  const config = validateRuntimeConfig({ hookAutoLoad: true, logPerUin: true });
  assert.equal(config.hookAutoLoad, true);
  assert.equal(config.logPerUin, true);
});

test("the boolean flags reject a non-boolean", () => {
  assertRejects(() => validateRuntimeConfig({ hookAutoLoad: "maybe" }), "hookAutoLoad", /must be a boolean/);
  assertRejects(() => validateRuntimeConfig({ hookAutoLoad: null }), "hookAutoLoad", /got null/);
  assertRejects(() => validateRuntimeConfig({ logPerUin: 2 }), "logPerUin", /must be a boolean/);
  assertRejects(() => validateRuntimeConfig({ logPerUin: [] }), "logPerUin", /got array/);
});

// ---------------------------------------------------------------------------
// trustProxy — reference/index.mjs:236
// ---------------------------------------------------------------------------

test("trustProxy defaults to the empty string and keeps a real value verbatim", () => {
  assert.equal(validateRuntimeConfig({}).trustProxy, "");
  assert.equal(validateRuntimeConfig({ trustProxy: "127.0.0.1" }).trustProxy, "127.0.0.1");
  // No trimming: the value is a hop list, and mangling it would trust the wrong peer.
  assert.equal(validateRuntimeConfig({ trustProxy: " 10.0.0.0/8" }).trustProxy, " 10.0.0.0/8");
});

test("trustProxy rejects a non-string", () => {
  assertRejects(() => validateRuntimeConfig({ trustProxy: 1 }), "trustProxy", /must be a string/);
  assertRejects(() => validateRuntimeConfig({ trustProxy: null }), "trustProxy", /got null/);
});

// ---------------------------------------------------------------------------
// logMaxTotalMb — reference/index.mjs:237 (1..MAX)
// ---------------------------------------------------------------------------

test("logMaxTotalMb accepts the inclusive bounds", () => {
  assert.equal(validateRuntimeConfig({ logMaxTotalMb: 1 }).logMaxTotalMb, 1);
  assert.equal(validateRuntimeConfig({ logMaxTotalMb: MAX_LOG_TOTAL_MB }).logMaxTotalMb, MAX_LOG_TOTAL_MB);
});

test("logMaxTotalMb rejects 0 — the policy lower bound is 1 (reference/index.mjs:237)", () => {
  assertRejects(() => validateRuntimeConfig({ logMaxTotalMb: 0 }), "logMaxTotalMb", /integer in 1\.\./);
});

test("logMaxTotalMb rejects a negative limit and an over-max limit", () => {
  assertRejects(() => validateRuntimeConfig({ logMaxTotalMb: -5 }), "logMaxTotalMb", /integer in 1\.\./);
  assertRejects(
    () => validateRuntimeConfig({ logMaxTotalMb: MAX_LOG_TOTAL_MB + 1 }),
    "logMaxTotalMb",
    /integer in 1\.\./,
  );
});

test("logMaxTotalMb rejects a fraction and a non-numeric string", () => {
  assertRejects(() => validateRuntimeConfig({ logMaxTotalMb: 1.5 }), "logMaxTotalMb", /integer/);
  assertRejects(() => validateRuntimeConfig({ logMaxTotalMb: "lots" }), "logMaxTotalMb", /integer/);
});

test("logMaxTotalMb coerces a numeric string (reference/index.mjs:354)", () => {
  assert.equal(validateRuntimeConfig({ logMaxTotalMb: "512" }).logMaxTotalMb, 512);
  assert.equal(validateRuntimeConfig({ logMaxTotalMb: " 512 " }).logMaxTotalMb, 512);
});

// ---------------------------------------------------------------------------
// logRetainDays — reference/index.mjs:238 (0..MAX)
// ---------------------------------------------------------------------------

test("logRetainDays accepts 0 — retention is inclusive of zero (reference/index.mjs:238)", () => {
  // `normalizeRequiredInteger(..., 0, MAX_LOG_RETAIN_DAYS, ...)`: 0 means "keep nothing
  // older than today", which is legal. A `< 1` check here would reject a valid config.
  assert.equal(validateRuntimeConfig({ logRetainDays: 0 }).logRetainDays, 0);
});

test("logRetainDays rejects a negative retention", () => {
  assertRejects(() => validateRuntimeConfig({ logRetainDays: -1 }), "logRetainDays", /integer in 0\.\./);
});

test("logRetainDays rejects a fraction, an over-max value and a non-numeric string", () => {
  assertRejects(() => validateRuntimeConfig({ logRetainDays: 7.5 }), "logRetainDays", /integer/);
  assertRejects(
    () => validateRuntimeConfig({ logRetainDays: MAX_LOG_RETAIN_DAYS + 1 }),
    "logRetainDays",
    /integer in 0\.\./,
  );
  assertRejects(() => validateRuntimeConfig({ logRetainDays: "week" }), "logRetainDays", /integer/);
});

test("logRetainDays coerces a numeric string", () => {
  assert.equal(validateRuntimeConfig({ logRetainDays: "7" }).logRetainDays, 7);
});

// ---------------------------------------------------------------------------
// Structural rejections
// ---------------------------------------------------------------------------

test("a non-object top level is rejected, not coerced to defaults", () => {
  // `normalizeRuntimeConfig` guards with `isObject$5(parsed) ? parsed : {}` (line 229), so
  // the reference silently turns `[]` into an all-defaults config. The strict loader refuses
  // instead: a file that parses to an array is a bug, and defaults would hide it.
  for (const bad of [null, 42, "config", true, []]) {
    assertRejects(() => validateRuntimeConfig(bad), "$", /must be a JSON object/);
  }
});

test("the lenient normalizeRuntimeConfig collapses a non-object to defaults (line 229)", () => {
  assert.deepEqual(normalizeRuntimeConfig(null), normalizeRuntimeConfig({}));
  assert.deepEqual(normalizeRuntimeConfig(42), normalizeRuntimeConfig({}));
  assert.deepEqual(normalizeRuntimeConfig("nope"), normalizeRuntimeConfig({}));
  assert.deepEqual(normalizeRuntimeConfig([]), normalizeRuntimeConfig({}));
});

test("the lenient port falls back instead of throwing on a bad port (line 232, 337-351)", () => {
  // This is the reference's *load-time* behaviour, kept for faithfulness and for the
  // settings panel's merge. It is exactly why the strict door exists.
  assert.equal(normalizeRuntimeConfig({ webuiPort: 0 }).webuiPort, 5099);
  assert.equal(normalizeRuntimeConfig({ webuiPort: 65536 }).webuiPort, 5099);
  assert.equal(normalizeRuntimeConfig({ webuiPort: "5099" }).webuiPort, 5099);
  assert.equal(normalizeRuntimeConfig({ webuiPort: null }).webuiPort, 5099);
  assert.equal(normalizeRuntimeConfig({ webuiPort: 4444.9 }).webuiPort, 4444);
});

test("the lenient port still throws on the fields the reference throws on", () => {
  assert.throws(() => normalizeRuntimeConfig({ logMaxTotalMb: 0 }), RangeError);
  assert.throws(() => normalizeRuntimeConfig({ logRetainDays: -1 }), RangeError);
  assert.throws(() => normalizeRuntimeConfig({ logPerUin: "maybe" }), TypeError);
});

// ---------------------------------------------------------------------------
// Unknown keys — preserved, not truncated
// ---------------------------------------------------------------------------

test("a config with an unknown key does not throw", () => {
  assert.doesNotThrow(() => validateRuntimeConfig({ webuiPort: 5099, futureFeature: true }));
});

test("unknown keys survive validation verbatim", () => {
  // The whole point: a config written by a newer build must not lose its settings, because
  // the next `saveRuntimeConfig` would write the truncated object back to disk.
  const raw = { webuiPort: 5099, futureFeature: { nested: [1, 2] }, another: "x" };
  const config = validateRuntimeConfig(raw);
  assert.deepEqual(config.futureFeature, { nested: [1, 2] });
  assert.equal(config.another, "x");
});

test("unknown keys are reported, sorted, and known keys are not reported", () => {
  const raw = { webuiPort: 5099, zeta: 1, alpha: 2, hookAutoLoad: false };
  assert.deepEqual(unknownRuntimeConfigKeys(raw), ["alpha", "zeta"]);
  assert.deepEqual(unknownRuntimeConfigKeys({}), []);
  assert.deepEqual(unknownRuntimeConfigKeys(null), []);
});

test("a known key is never reported as unknown", () => {
  const all = {
    updateSource: { mode: "auto", mirrors: [] },
    webuiPort: 1,
    hookAutoLoad: true,
    webuiHost: "127.0.0.1",
    webuiTls: { enabled: false },
    trustProxy: "",
    logMaxTotalMb: 1,
    logRetainDays: 0,
    logPerUin: true,
  };
  assert.deepEqual(unknownRuntimeConfigKeys(all), []);
});

test("unknown keys are reported through a real file load too", () => {
  const file = writeConfigFile(JSON.stringify({ webuiPort: 5099, somethingNew: 1 }));
  const config = loadRuntimeConfig(file);
  assert.equal(config.somethingNew, 1);
  assert.deepEqual(unknownRuntimeConfigKeys(JSON.parse(fs.readFileSync(file, "utf8"))), ["somethingNew"]);
});

// ---------------------------------------------------------------------------
// File-level failures
// ---------------------------------------------------------------------------

test("a missing file is an error naming the path", () => {
  const missing = missingPath();
  assertRejects(() => loadRuntimeConfig(missing), "$", /not found/);
  // The message must actually say where it looked, or the operator cannot fix it.
  assert.throws(() => loadRuntimeConfig(missing), (error: Error) => error.message.includes(missing));
});

test("a malformed JSON file is an error mentioning JSON, never the content", () => {
  const file = writeConfigFile('{ "webuiPort": 5099, ');
  assertRejects(() => loadRuntimeConfig(file), "$", /not valid JSON/);
});

test("a JSON file with a trailing comma is rejected", () => {
  const file = writeConfigFile('{"webuiPort": 5099,}');
  assertRejects(() => loadRuntimeConfig(file), "$", /not valid JSON/);
});

test("an empty file is an error, not an all-defaults config", () => {
  const file = writeConfigFile("");
  assertRejects(() => loadRuntimeConfig(file), "$", /not valid JSON/);
});

test("a file containing a bare literal is rejected as a non-object", () => {
  const file = writeConfigFile("null");
  assertRejects(() => loadRuntimeConfig(file), "$", /must be a JSON object/);
});

test("a valid file with one bad field names that field", () => {
  const file = writeConfigFile(JSON.stringify({ webuiPort: 5099, logRetainDays: -3 }));
  assertRejects(() => loadRuntimeConfig(file), "logRetainDays", /integer in 0\.\./);
});

test("an unreadable path (a directory) is reported, not swallowed", () => {
  const dir = scratchDir();
  assertRejects(() => loadRuntimeConfig(dir), "$", /could not be read/);
});

test("the error type carries the field for programmatic handling", () => {
  try {
    validateRuntimeConfig({ webuiPort: 0 });
    assert.fail("expected a throw");
  } catch (error) {
    assert.ok(error instanceof RuntimeConfigError);
    assert.equal(error.field, "webuiPort");
    assert.equal(error.name, "RuntimeConfigError");
  }
});

test("the loader tolerates a config with every field present and correct", () => {
  const file = writeConfigFile(
    JSON.stringify({
      webuiPort: 8080,
      hookAutoLoad: true,
      webuiHost: "0.0.0.0",
      webuiTls: { enabled: true },
      trustProxy: "10.0.0.0/8",
      logMaxTotalMb: 512,
      logRetainDays: 14,
      logPerUin: true,
    }),
  );
  const config = loadRuntimeConfig(file);
  assert.deepEqual(
    { ...config },
    {
      webuiPort: 8080,
      hookAutoLoad: true,
      webuiHost: "0.0.0.0",
      webuiTls: { enabled: true },
      trustProxy: "10.0.0.0/8",
      logMaxTotalMb: 512,
      logRetainDays: 14,
      logPerUin: true,
    },
  );
});

test("whitespace and a BOM-free file load the same as a compact one", () => {
  const pretty = writeConfigFile(
    `{\n  "webuiPort": 5099,\n  "logMaxTotalMb": 1024\n}\n`,
  );
  assert.equal(loadRuntimeConfig(pretty).webuiPort, 5099);
});

test("a run writes nothing next to the file it reads", () => {
  // The loader must be read-only. A rewrite would race the process that owns the file.
  const dir = scratchDir();
  const file = path.join(dir, "runtime.json");
  fs.writeFileSync(file, JSON.stringify({ webuiPort: 5099 }), "utf8");
  const before = fs.readdirSync(dir).sort();
  loadRuntimeConfig(file);
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
});

// ---------------------------------------------------------------------------
// config/webui.json — secrets must not escape (fixture, never the checkout)
// ---------------------------------------------------------------------------

// The credential-bearing `config/webui.json` is gitignored, so there is no committed file
// to assert against — and manufacturing one in the checkout would defeat the scrub. These
// tests therefore supply their own: a fixture written into a fresh `os.tmpdir()` directory
// (the one place this file does not use `ts/build`), removed in `afterEach`.
//
// The hex is a repeated pattern, not anything derived from a password: it satisfies the
// loader's shape check (128 and 32 hex characters) so a summary *can* be computed, while
// being self-evidently synthetic. If the summary ever returned it, the assertions below
// would fail on a value that is impossible to confuse with a real credential.
const FAKE_HASH = "0123456789abcdef".repeat(8); // 128 hex chars
const FAKE_SALT = "fedcba9876543210".repeat(2); // 32 hex chars

describe("a deployment's webui.json (synthetic fixture outside the checkout)", () => {
  let fixtureDir = "";
  let fixtureFile = "";

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-config-webui-"));
    fixtureFile = path.join(fixtureDir, "webui.json");
    fs.writeFileSync(
      fixtureFile,
      JSON.stringify({
        passwordHash: FAKE_HASH,
        passwordSalt: FAKE_SALT,
        mustChangePassword: true,
        generatedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
      "utf8",
    );
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("the summary exposes mustChangePassword and passwordSet only", () => {
    const summary = loadWebuiConfig(fixtureFile);

    assert.equal(summary.mustChangePassword, true);
    assert.equal(summary.passwordSet, true);
    assert.deepEqual(Object.keys(summary).sort(), ["mustChangePassword", "passwordSet"]);
  });

  test("no property of the summary equals the hash or the salt", () => {
    // The contract, stated as an assertion over *every* value the loader returns. A future
    // field that leaks the material fails here even if it is named something new.
    const summary = loadWebuiConfig(fixtureFile);
    const values = Object.values(summary);

    assert.equal(values.includes(FAKE_HASH), false);
    assert.equal(values.includes(FAKE_SALT), false);

    // Nothing may even *contain* the secret as a substring (e.g. a truncated hash).
    const serialized = JSON.stringify(summary);
    assert.equal(serialized.includes(FAKE_HASH), false);
    assert.equal(serialized.includes(FAKE_SALT), false);
  });
});

test("the committed webui template carries no credential material", () => {
  // The property the scrub exists to guarantee, asserted against the *committed* file
  // rather than a fixture — no fake credential needed. `passwordHash` and `passwordSalt`
  // must be present and empty: present so the template documents the schema, empty so
  // nothing resembling a credential is ever in version control.
  const raw = JSON.parse(fs.readFileSync(TEMPLATE_WEBUI_CONFIG, "utf8")) as Record<string, unknown>;

  assert.equal(raw["passwordHash"], "", "the committed template must ship an empty passwordHash");
  assert.equal(raw["passwordSalt"], "", "the committed template must ship an empty passwordSalt");

  // Belt and braces: no other string in the template may look like key material either
  // (a hash smuggled into, say, `generatedAt` would otherwise slip past the checks above).
  for (const [field, value] of Object.entries(raw)) {
    if (typeof value !== "string") continue;
    assert.equal(/[0-9a-f]{32,}/i.test(value), false, `${field} looks like it holds hex key material`);
  }
});

test("a synthetic webui.json is summarized without leaking", () => {
  const hash = "a".repeat(128);
  const salt = "b".repeat(32);
  const file = writeConfigFile(
    JSON.stringify({
      passwordHash: hash,
      passwordSalt: salt,
      mustChangePassword: false,
      generatedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    }),
    "webui.json",
  );

  const summary = loadWebuiConfig(file);
  assert.deepEqual(summary, { mustChangePassword: false, passwordSet: true });
  assert.equal(JSON.stringify(summary).includes(hash), false);
  assert.equal(JSON.stringify(summary).includes(salt), false);
});

test("a missing webui.json is a fresh install, not an error", () => {
  // The reference generates a bootstrap password here (reference/index.mjs:357010-357016),
  // which writes to `config/`. This module never writes, so it reports "no password" and
  // leaves the decision upstream.
  assert.deepEqual(loadWebuiConfig(missingPath("webui.json")), {
    mustChangePassword: false,
    passwordSet: false,
  });
});

test("webui.json rejects a hash of the wrong length, naming the field", () => {
  const file = writeConfigFile(
    JSON.stringify({
      passwordHash: "abc",
      passwordSalt: "b".repeat(32),
      mustChangePassword: true,
      generatedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    "webui.json",
  );
  assert.throws(
    () => loadWebuiConfig(file),
    (error: unknown) => {
      assert.ok(error instanceof WebuiConfigError);
      assert.equal(error.field, "passwordHash");
      // The bad value must not appear in the message.
      assert.equal(error.message.includes("abc"), false);
      return true;
    },
  );
});

test("webui.json rejects a non-hex hash", () => {
  assert.throws(
    () => summarizeWebuiAuthState({ passwordHash: "z".repeat(128) }),
    (error: unknown) => error instanceof WebuiConfigError && error.field === "passwordHash",
  );
});

test("webui.json rejects a salt of the wrong length", () => {
  assert.throws(
    () =>
      summarizeWebuiAuthState({
        passwordHash: "a".repeat(128),
        passwordSalt: "short",
        mustChangePassword: true,
        generatedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    (error: unknown) => error instanceof WebuiConfigError && error.field === "passwordSalt",
  );
});

test("webui.json rejects a non-boolean mustChangePassword", () => {
  assert.throws(
    () =>
      summarizeWebuiAuthState({
        passwordHash: "a".repeat(128),
        passwordSalt: "b".repeat(32),
        mustChangePassword: "true",
        generatedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    (error: unknown) => error instanceof WebuiConfigError && error.field === "mustChangePassword",
  );
});

test("webui.json rejects an unparseable timestamp", () => {
  assert.throws(
    () =>
      summarizeWebuiAuthState({
        passwordHash: "a".repeat(128),
        passwordSalt: "b".repeat(32),
        mustChangePassword: true,
        generatedAt: "not-a-date",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    (error: unknown) => error instanceof WebuiConfigError && error.field === "generatedAt",
  );
});

test("webui.json rejects a non-object", () => {
  for (const bad of [null, [], 42, "x"]) {
    assert.throws(
      () => summarizeWebuiAuthState(bad),
      (error: unknown) => error instanceof WebuiConfigError && error.field === "$",
    );
  }
});

test("webui.json rejects an unknown field (reference/index.mjs:356905)", () => {
  assert.throws(
    () =>
      summarizeWebuiAuthState({
        passwordHash: "a".repeat(128),
        passwordSalt: "b".repeat(32),
        mustChangePassword: true,
        generatedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        surprise: 1,
      }),
    (error: unknown) => error instanceof WebuiConfigError && /unknown field surprise/.test(error.message),
  );
});

test("webui.json allows the totp key the reference allows", () => {
  // `totp` is in the reference's allowlist (line 356903). This module does not interpret it,
  // but it must not reject the file over it.
  const summary = summarizeWebuiAuthState({
    passwordHash: "a".repeat(128),
    passwordSalt: "b".repeat(32),
    mustChangePassword: true,
    generatedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    totp: { secret: "x" },
  });
  assert.deepEqual(summary, { mustChangePassword: true, passwordSet: true });
});

test("malformed webui.json JSON is an error, not a fresh install", () => {
  // Reporting "no password" for a corrupt file would silently open the WebUI. The reference
  // backs the file up and regenerates (line 357006-357008); refusing is the safe half.
  const file = writeConfigFile("{ not json", "webui.json");
  assert.throws(
    () => loadWebuiConfig(file),
    (error: unknown) => error instanceof WebuiConfigError && /not valid JSON/.test(error.message),
  );
});

// ---------------------------------------------------------------------------
// A temp dir per test, cleaned up by the OS — never `config/`
// ---------------------------------------------------------------------------

test("the scratch root is under ts/build, not /tmp", () => {
  // Guards the rule itself: `/tmp` is tmpfs on this box and the README forbids it.
  assert.equal(SCRATCH_ROOT.startsWith(path.join(REPO_ROOT, "ts", "build")), true);
  assert.notEqual(path.resolve(SCRATCH_ROOT), path.resolve(os.tmpdir()));
});
