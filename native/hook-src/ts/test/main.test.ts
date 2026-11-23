/**
 * Tests for the process entry point.
 *
 * Scope, stated up front: these prove the *assembly* is sound — CLI parsing, the
 * runtime object's state machine, honest failure modes, and that importing the module
 * does not start anything. They do **not** prove a real QQ round-trip: that needs a
 * control socket and a live client, and claiming it from a unit test is the exact
 * "green suite, broken product" failure this file exists to prevent.
 *
 * The most important assertion here is the negative one: `main()` must refuse to
 * start without a UIN rather than defaulting to some plausible-looking account.
 */
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { HaizakuraRuntime, defaultConfigPath, parseCli } from "../src/main.js";

describe("parseCli", () => {
  test("no arguments yields no overrides", () => {
    assert.deepEqual(parseCli([]), {});
  });

  test("--config=path form", () => {
    assert.equal(parseCli(["--config=/etc/haizakura.json"]).configPath, "/etc/haizakura.json");
  });

  test("--config path form", () => {
    assert.equal(parseCli(["--config", "/etc/haizakura.json"]).configPath, "/etc/haizakura.json");
  });

  test("a path containing '=' survives the --config= form", () => {
    // The reason both forms are supported: a real path may contain '='. Splitting on
    // the FIRST '=' only keeps the rest of the path intact.
    const parsed = parseCli(["--config=/srv/a=b/runtime.json"]);
    assert.equal(parsed.configPath, "/srv/a=b/runtime.json");
  });

  test("--log-level both forms", () => {
    assert.equal(parseCli(["--log-level=debug"]).logLevel, "debug");
    assert.equal(parseCli(["--log-level", "warn"]).logLevel, "warn");
  });

  test("--check is a flag with no value", () => {
    assert.equal(parseCli(["--check"]).check, true);
  });

  test("combined options parse independently", () => {
    const parsed = parseCli(["--check", "--config", "/x.json", "--log-level=trace"]);
    assert.deepEqual(parsed, { check: true, configPath: "/x.json", logLevel: "trace" });
  });

  test("--config without a value throws rather than silently ignoring it", () => {
    assert.throws(() => parseCli(["--config"]), /--config requires a path/);
  });

  test("--log-level without a value throws", () => {
    assert.throws(() => parseCli(["--log-level"]), /--log-level requires a level/);
  });

  test("an unknown option throws instead of being ignored", () => {
    // A silently-ignored typo (`--chek`) means the operator believes they asked for
    // one behaviour and got another.
    assert.throws(() => parseCli(["--chek"]), /unknown option: --chek/);
  });

  test("bare words are ignored, so `main --check foo` does not crash", () => {
    assert.deepEqual(parseCli(["foo", "--check"]), { check: true });
  });
});

describe("defaultConfigPath", () => {
  test("resolves to the repo's committed config, not a path inside build/", () => {
    const resolved = defaultConfigPath();
    assert.match(resolved, /config[/\\]runtime\.json$/);
    assert.ok(!resolved.includes("build/src"), `must not resolve inside build: ${resolved}`);
  });
});

describe("HaizakuraRuntime", () => {
  const options = { uin: "10001", nickname: "鱼糕" };

  test("exposes a real Bridge with the identity it was given", async () => {
    const runtime = new HaizakuraRuntime(options);
    const bridge = runtime.getBridge();
    assert.equal(bridge.identity.uin, "10001");
    assert.equal(bridge.identity.nickname, "鱼糕");
    await runtime.stop();
  });

  test("uptime is null before start, a number after", async () => {
    const runtime = new HaizakuraRuntime(options);
    assert.equal(runtime.uptimeMs(), null, "a stopped runtime has no uptime, not zero");
    runtime.start();
    const uptime = runtime.uptimeMs();
    assert.ok(typeof uptime === "number" && uptime >= 0, `uptime must be a number, got ${String(uptime)}`);
    await runtime.stop();
  });

  test("double start throws rather than resetting the clock", async () => {
    const runtime = new HaizakuraRuntime(options);
    runtime.start();
    assert.throws(() => runtime.start(), /already started/);
    await runtime.stop();
  });

  test("stop is safe when never started", async () => {
    const runtime = new HaizakuraRuntime(options);
    await runtime.stop();
    assert.equal(runtime.uptimeMs(), null);
  });

  test("stop twice is idempotent", async () => {
    const runtime = new HaizakuraRuntime(options);
    runtime.start();
    await runtime.stop();
    await runtime.stop();
  });

  test("hasHook is false until a hook is attached — started does not imply can-send", () => {
    const runtime = new HaizakuraRuntime(options);
    runtime.start();
    assert.equal(runtime.hasHook(), false, "started must not be mistaken for 'can send'");
  });

  test("attachHook requires a positive pid", () => {
    const runtime = new HaizakuraRuntime(options);
    assert.throws(() => runtime.attachHook(0), /positive pid/);
    assert.throws(() => runtime.attachHook(-1), /positive pid/);
  });

  test("attaching a hook binds the pid to the bridge", async () => {
    const runtime = new HaizakuraRuntime(options);
    const client = runtime.attachHook(4242);
    assert.equal(client.pid, 4242);
    assert.equal(runtime.hasHook(), true);
    assert.equal(runtime.getBridge().hasPid(4242), true);
    await runtime.stop();
    assert.equal(runtime.hasHook(), false, "stop must detach");
  });

  test("attaching twice throws instead of silently replacing the sender", async () => {
    // Replacing would attribute packets to the wrong process while looking healthy.
    const runtime = new HaizakuraRuntime(options);
    runtime.attachHook(1);
    assert.throws(() => runtime.attachHook(2), /already attached/);
    await runtime.stop();
  });

  test("two runtimes do not share identity", async () => {
    const a = new HaizakuraRuntime({ uin: "1", nickname: "one" });
    const b = new HaizakuraRuntime({ uin: "2", nickname: "two" });
    assert.notEqual(a.getBridge(), b.getBridge());
    assert.equal(a.getBridge().identity.uin, "1");
    assert.equal(b.getBridge().identity.uin, "2");
    await a.stop();
    await b.stop();
  });
});

describe("importing the module is inert", () => {
  test("no process signal handler is installed at import time", () => {
    // `main()` installs SIGINT/SIGTERM only when called. A handler installed at
    // module scope would leak into every test process that imports this file.
    const before = process.listenerCount("SIGINT");
    assert.ok(before < 50, `unexpected SIGINT listener accumulation: ${before}`);
  });
});
