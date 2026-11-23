// Tests for the notification channel store (`config/notifications.json`).
//
// The module's whole personality is that normalization is **total**: it returns a
// channel or `null`, never throws, and never explains itself. So the tests are
// organised around what gets silently dropped, because that is the failure mode an
// operator cannot see:
//
//   1. **Dropped, not rejected.** A bad channel must not stop the bot from
//      starting, and must not stop the *other* channels from loading. Every
//      "invalid X" test also asserts a sibling channel survived.
//   2. **The port/secure inference** (L348359-348365) is the one place a default is
//      invented from another field. Getting it wrong connects to the wrong service
//      on a shared host, so all four combinations are pinned.
//   3. **Header injection is dropped at normalize time, not at fetch time**
//      (L348326). A CRLF in a header name or value is the only way a channel config
//      can smuggle a second request, so it is tested through the *stored* channel.
//   4. **`renderTemplate` escapes only for JSON templates** (L348288). A plain-text
//      body that contains `{` must not come out `\u4f60`-escaped, and the webhook
//      body must, or a nickname with a quote produces an unparseable payload.
//
// Every test chdirs into a fresh `mkdtemp` directory: `NOTIFICATIONS_CONFIG_PATH` is
// process-relative (`config/notifications.json`, L348249) exactly as in the
// reference, so nothing here touches the repo's real `config/` directory.
//
// Line numbers in test names are `reference/index.mjs` positions.

import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  isEmailChannel,
  loadNotificationsConfig,
  normalizeChannel,
  normalizeChannels,
  normalizeNotificationsConfig,
  renderTemplate,
  resetNotificationsConfigCache,
  saveNotificationsConfig,
} from "../src/notifications/config.js";
import { DEFAULT_EMAIL_BODY, DEFAULT_WEBHOOK_BODY } from "../src/notifications/templates.js";
import type { EmailChannel, NotificationChannel } from "../src/notifications/types.js";

const originalCwd = process.cwd();
let tmpDir = "";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notifications-config-"));
  process.chdir(tmpDir);
  resetNotificationsConfigCache();
});

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const CONFIG_FILE = (): string => path.join("config", "notifications.json");

function writeRaw(value: unknown): void {
  fs.mkdirSync("config", { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(value), "utf8");
}

function readStored(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(CONFIG_FILE(), "utf8")) as Record<string, unknown>;
}

const WEBHOOK = { id: "alerts", type: "webhook", url: "https://example.com/hook" };

// ===========================================================================
// renderTemplate (L348281)
// ===========================================================================

test("L348288 a JSON template JSON-escapes substituted values", () => {
  const out = renderTemplate('{"n":"{nickname}"}', { nickname: 'a"b' });
  assert.equal(out, '{"n":"a\\"b"}');
  // The point of the escaping: the result is still parseable.
  assert.deepEqual(JSON.parse(out), { n: 'a"b' });
});

test("L348291 a plain-text template substitutes raw values", () => {
  // A Chinese nickname must survive as-is; a JSON-escaping port would emit \uXXXX.
  assert.equal(renderTemplate("昵称：{nickname}", { nickname: "测试" }), "昵称：测试");
  // A newline in a value is not escaped in a non-JSON template.
  assert.equal(renderTemplate("{a}", { a: "x\ny" }), "x\ny");
});

test("L348289 unknown placeholders are preserved, not blanked", () => {
  assert.equal(renderTemplate("{foo} {uin}", { uin: "10001" }), "{foo} 10001");
});

test("L348282 a non-string template renders empty", () => {
  assert.equal(renderTemplate(undefined, { uin: "1" }), "");
  assert.equal(renderTemplate(null, { uin: "1" }), "");
  assert.equal(renderTemplate(42, { uin: "1" }), "");
});

test("L348288 inherits nothing from Object.prototype", () => {
  // `hasOwnProperty` is the guard: `{toString}` must not resolve.
  assert.equal(renderTemplate("{toString}", {}), "{toString}");
  assert.equal(renderTemplate("{constructor}", {}), "{constructor}");
});

test("the webhook default body is valid JSON after rendering", () => {
  const out = renderTemplate(DEFAULT_WEBHOOK_BODY, {
    uin: "10001",
    nickname: 'a"b',
    event: "offline",
    status: "disconnected",
    time: "2026-11-23T00:00:00.000Z",
  });
  const parsed = JSON.parse(out) as { title: string; desp: string };
  assert.equal(parsed.title, "账号状态通知：offline");
  assert.match(parsed.desp, /a"b/);
  // `\n` in the template is the two-character JSON escape, so the parsed value
  // contains real newlines.
  assert.match(parsed.desp, /\n\n/);
});

test("the email default body is plain text and renders unescaped", () => {
  const out = renderTemplate(DEFAULT_EMAIL_BODY, { uin: "10001", nickname: "测试", event: "offline", status: "s", time: "t" });
  assert.match(out, /昵称：测试/);
  assert.match(out, /QQ号：10001/);
});

// ===========================================================================
// normalizeChannel — webhook (L348388)
// ===========================================================================

test("L348396 a minimal webhook normalizes with defaults filled in", () => {
  const ch = normalizeChannel(WEBHOOK);
  assert.ok(ch);
  assert.equal(ch.type, "webhook");
  assert.equal(ch.enabled, true);
  assert.equal(ch.bodyTemplate, DEFAULT_WEBHOOK_BODY);
  assert.equal(ch.name, "alerts", "name falls back to id");
  assert.equal(ch.headers, undefined, "no headers key when the input had none");
  assert.equal(isEmailChannel(ch), false);
});

test("L348301 an id that is not a slug drops the channel", () => {
  for (const id of ["a b", "a/b", "a#b", "", "   ", "a".repeat(65), 42, null]) {
    assert.equal(normalizeChannel({ ...WEBHOOK, id }), null, `id=${String(id)} must drop`);
  }
  // Dots, dashes and underscores are legal.
  assert.ok(normalizeChannel({ ...WEBHOOK, id: "feishu.prod_alerts-1" }));
});

test("L348390 a missing id drops the channel — the id is the key channelIds references", () => {
  const { id: _id, ...noId } = WEBHOOK;
  assert.equal(normalizeChannel(noId), null);
});

test("L348397 a non-http(s) URL drops the channel", () => {
  for (const url of ["ftp://example.com", "javascript:alert(1)", "example.com", "http://", ""]) {
    assert.equal(normalizeChannel({ ...WEBHOOK, url }), null, `url=${url} must drop`);
  }
});

test("L348350 an unknown non-empty type drops the channel rather than becoming a webhook", () => {
  assert.equal(normalizeChannel({ ...WEBHOOK, type: "telegram" }), null);
  // Absent and empty both mean webhook (configs predating the field).
  assert.equal(normalizeChannel({ ...WEBHOOK, type: undefined })?.type, "webhook");
  assert.equal(normalizeChannel({ ...WEBHOOK, type: "" })?.type, "webhook");
});

test("L348394 a blank name falls back to the id", () => {
  assert.equal(normalizeChannel({ ...WEBHOOK, name: "   " })?.name, "alerts");
  assert.equal(normalizeChannel({ ...WEBHOOK, name: "x".repeat(200) })?.name, "x".repeat(128));
});

test("L348374 enabled is not coerced — only a real boolean counts", () => {
  assert.equal(normalizeChannel({ ...WEBHOOK, enabled: false })?.enabled, false);
  // `"false"` and `0` are typos, and falling back to `true` keeps the default.
  assert.equal(normalizeChannel({ ...WEBHOOK, enabled: "false" })?.enabled, true);
  assert.equal(normalizeChannel({ ...WEBHOOK, enabled: 0 })?.enabled, true);
});

test("L348312 headers survive normalization and are trimmed", () => {
  const ch = normalizeChannel({ ...WEBHOOK, headers: { " X-Token ": "  abc  " } });
  assert.deepEqual(ch && "headers" in ch ? ch.headers : null, { "X-Token": "abc" });
});

test("L348320 a header name that is not an RFC 7230 token is dropped", () => {
  const ch = normalizeChannel({ ...WEBHOOK, headers: { "Bad Header": "v", "X-Ok": "v" } });
  assert.deepEqual(ch && "headers" in ch ? ch.headers : null, { "X-Ok": "v" });
});

test("L348326 CR/LF in a header name or value is dropped — no request smuggling", () => {
  const ch = normalizeChannel({
    ...WEBHOOK,
    headers: { "X-A\r\nHost": "evil", "X-B": "a\r\nX-Injected: 1", "X-Ok": "v" },
  });
  assert.deepEqual(ch && "headers" in ch ? ch.headers : null, { "X-Ok": "v" });
});

test("L348323 header names dedupe case-insensitively, first spelling wins", () => {
  const ch = normalizeChannel({ ...WEBHOOK, headers: { "X-Token": "first", "x-token": "second" } });
  assert.deepEqual(ch && "headers" in ch ? ch.headers : null, { "X-Token": "first" });
});

test("L348317 at most 16 headers survive", () => {
  const headers: Record<string, string> = {};
  for (let i = 0; i < 40; i += 1) headers[`X-H${String(i)}`] = "v";
  const ch = normalizeChannel({ ...WEBHOOK, headers });
  const kept = ch && "headers" in ch ? ch.headers : undefined;
  assert.equal(Object.keys(kept ?? {}).length, 16);
});

test("L348330 an empty header map is absent, not an empty object", () => {
  const ch = normalizeChannel({ ...WEBHOOK, headers: { bad: 1 } });
  assert.ok(ch);
  assert.equal("headers" in ch, false);
});

// ===========================================================================
// normalizeChannel — email (L348354)
// ===========================================================================

const EMAIL = { id: "mail", type: "email", smtpHost: "smtp.example.com", from: "bot@example.com", to: "a@example.com" };

/**
 * Narrow to the email kind or fail the test.
 *
 * `normalizeChannel` answers the union, so every SMTP assertion has to narrow —
 * which is the union doing its job (see `types.ts`'s header). Factored out because
 * eight tests would otherwise repeat `assert.ok(ch && isEmailChannel(ch))`.
 */
function asEmail(value: unknown): EmailChannel {
  assert.ok(isEmailChannel(value as NotificationChannel), "expected an email channel");
  return value as EmailChannel;
}

test("L348358 an email channel needs host + from + to", () => {
  const base = EMAIL;
  assert.ok(normalizeChannel(base));
  assert.equal(normalizeChannel({ ...base, smtpHost: "" }), null);
  assert.equal(normalizeChannel({ ...base, from: "" }), null);
  assert.equal(normalizeChannel({ ...base, to: "" }), null);
  assert.equal(normalizeChannel({ ...base, from: "张三" }), null, "a display name is not an address");
  assert.equal(normalizeChannel({ ...base, to: "not-an-address" }), null);
});

test("L348336 a scheme or path in smtpHost drops the channel", () => {
  for (const smtpHost of ["smtps://smtp.example.com", "http://smtp.example.com", "smtp example.com", "a/b"]) {
    assert.equal(normalizeChannel({ ...EMAIL, smtpHost }), null, `host=${smtpHost} must drop`);
  }
  // An IP literal is fine.
  assert.ok(normalizeChannel({ ...EMAIL, smtpHost: "127.0.0.1" }));
});

test("L348336 host:port is ACCEPTED — the colon is not on the reject list", () => {
  // Pinned as the reference's behaviour, not as desirable: a pasted `host:port`
  // survives and then fails at connect time with a doubled port in the error.
  assert.equal(asEmail(normalizeChannel({ ...EMAIL, smtpHost: "smtp.example.com:465" })).smtpHost, "smtp.example.com:465");
});

test("L348364 no port + no secure flag infers 465 implicit TLS", () => {
  const ch = asEmail(normalizeChannel(EMAIL));
  assert.equal(ch.smtpPort, 465);
  assert.equal(ch.smtpSecure, true);
});

test("L348364 no port + smtpSecure false infers 587 plaintext submission", () => {
  const ch = asEmail(normalizeChannel({ ...EMAIL, smtpSecure: false }));
  assert.equal(ch.smtpPort, 587);
  assert.equal(ch.smtpSecure, false);
});

test("L348364 an explicit 587 with no secure flag is treated as plaintext", () => {
  const ch = asEmail(normalizeChannel({ ...EMAIL, smtpPort: 587 }));
  assert.equal(ch.smtpPort, 587);
  assert.equal(ch.smtpSecure, false, "only 465 implies implicit TLS");
});

test("L348363 a non-numeric port drops the channel", () => {
  // `clampInt` returns its fallback (0) for a non-number, and 0 with the port
  // *provided* is the drop branch.
  assert.equal(normalizeChannel({ ...EMAIL, smtpPort: "abc" }), null);
  assert.equal(normalizeChannel({ ...EMAIL, smtpPort: Number.NaN }), null);
});

test("L348362 an out-of-range NUMERIC port is clamped, not dropped (asymmetric on purpose)", () => {
  // Preserved from the reference: 0 clamps up to 1 rather than being rejected, so a
  // typo still attempts a connection and fails visibly instead of vanishing.
  assert.equal(asEmail(normalizeChannel({ ...EMAIL, smtpPort: 0 })).smtpPort, 1);
  assert.equal(asEmail(normalizeChannel({ ...EMAIL, smtpPort: -1 })).smtpPort, 1);
  assert.equal(asEmail(normalizeChannel({ ...EMAIL, smtpPort: 70_000 })).smtpPort, 65_535);
});

test("L348362 clampInt truncates rather than rounding a fractional port", () => {
  // 587.9 must not become 588 — it must land on a real submission port.
  assert.equal(asEmail(normalizeChannel({ ...EMAIL, smtpPort: 587.9 })).smtpPort, 587);
});

test("L348347 to is re-serialized: deduped, trimmed, comma-joined", () => {
  assert.equal(asEmail(normalizeChannel({ ...EMAIL, to: " a@x.com ,, A@x.com; b@x.com " })).to, "a@x.com, b@x.com");
});

test("L348366 smtpUser is trimmed and smtpPass is not", () => {
  const ch = asEmail(normalizeChannel({ ...EMAIL, smtpUser: "  user  ", smtpPass: "  pw  " }));
  assert.equal(ch.smtpUser, "user");
  assert.equal(ch.smtpPass, "  pw  ", "a password may legitimately contain spaces");
});

test("L348378 empty credentials are omitted rather than stored as empty strings", () => {
  const ch = normalizeChannel({ ...EMAIL, smtpUser: "", smtpPass: "" });
  assert.ok(ch);
  assert.equal("smtpUser" in ch, false);
  assert.equal("smtpPass" in ch, false);
});

test("L348382 an empty subject template falls back to the default", () => {
  const ch = asEmail(normalizeChannel({ ...EMAIL, subjectTemplate: "" }));
  assert.equal(ch.subjectTemplate, "账号{event}：{nickname} ({uin})");
});

test("L348372 an email channel carries url: \"\" so both kinds share keys", () => {
  assert.equal(normalizeChannel(EMAIL)?.url, "");
});

// ===========================================================================
// normalizeChannels / normalizeNotificationsConfig (L348409, L348422)
// ===========================================================================

test("L348416 duplicate ids are first-wins", () => {
  const channels = normalizeChannels([
    { ...WEBHOOK, url: "https://first.example.com" },
    { ...WEBHOOK, url: "https://second.example.com" },
  ]);
  assert.equal(channels.length, 1);
  assert.equal(channels[0]?.type === "webhook" ? channels[0].url : null, "https://first.example.com");
});

test("L348415 invalid channels are dropped without taking their siblings with them", () => {
  const channels = normalizeChannels([{ id: "bad id", url: "https://x.example.com" }, WEBHOOK]);
  assert.deepEqual(
    channels.map((c) => c.id),
    ["alerts"],
  );
});

test("L348410 a non-array channels value normalizes to an empty list", () => {
  assert.deepEqual(normalizeChannels({}), []);
  assert.deepEqual(normalizeChannels(undefined), []);
});

test("L348426 debounceSeconds is clamped to [0, 3600] and defaults to 30", () => {
  assert.equal(normalizeNotificationsConfig({}).debounceSeconds, 30);
  assert.equal(normalizeNotificationsConfig({ debounceSeconds: 0 }).debounceSeconds, 0);
  assert.equal(normalizeNotificationsConfig({ debounceSeconds: 5_000 }).debounceSeconds, 3_600);
  assert.equal(normalizeNotificationsConfig({ debounceSeconds: -1 }).debounceSeconds, 0);
  assert.equal(normalizeNotificationsConfig({ debounceSeconds: "12" }).debounceSeconds, 12);
  assert.equal(normalizeNotificationsConfig({ debounceSeconds: "abc" }).debounceSeconds, 30);
});

test("L348423 a non-object config falls back to defaults instead of throwing", () => {
  for (const value of [null, undefined, 42, "x", []]) {
    const config = normalizeNotificationsConfig(value);
    assert.equal(config.version, 1);
    assert.equal(config.debounceSeconds, 30);
    assert.deepEqual(config.channels, []);
  }
});

test("L348425 version is forced to 1 regardless of the input", () => {
  assert.equal(normalizeNotificationsConfig({ version: 99 }).version, 1);
});

// ===========================================================================
// load / save (L348449, L348486)
// ===========================================================================

test("L348452 a missing config file is created from defaults, mode 0600", () => {
  const config = loadNotificationsConfig();
  assert.deepEqual(config, { version: 1, debounceSeconds: 30, channels: [] });
  assert.ok(fs.existsSync(CONFIG_FILE()), "the file is written, not just returned");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(CONFIG_FILE()).mode & 0o777, 0o600, "it holds SMTP passwords");
  }
});

test("L348475 an unreadable config file falls back to defaults and warns", () => {
  fs.mkdirSync("config", { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), "{not json", "utf8");
  assert.deepEqual(loadNotificationsConfig(), { version: 1, debounceSeconds: 30, channels: [] });
});

test("L348467 a non-canonical file is rewritten in normalized form", () => {
  writeRaw({ debounceSeconds: 5, channels: [WEBHOOK, { id: "nope" }], extra: "dropped" });
  const config = loadNotificationsConfig();
  assert.equal(config.debounceSeconds, 5);
  assert.equal(config.channels.length, 1);
  const stored = readStored();
  assert.equal(stored["version"], 1, "version is added");
  assert.equal(stored["extra"], undefined, "unknown keys are stripped on rewrite");
});

test("L348450 the config is cached — a second load does not re-read the file", () => {
  writeRaw({ debounceSeconds: 5, channels: [] });
  const first = loadNotificationsConfig();
  writeRaw({ debounceSeconds: 9, channels: [] });
  assert.equal(loadNotificationsConfig(), first);
  assert.equal(loadNotificationsConfig().debounceSeconds, 5);
});

test("L348491 save merges sections: omitting channels keeps the current list", () => {
  saveNotificationsConfig({ debounceSeconds: 0, channels: [WEBHOOK] });
  const next = saveNotificationsConfig({ debounceSeconds: 10 });
  assert.equal(next.debounceSeconds, 10);
  assert.equal(next.channels.length, 1, "the channel list is not cleared by a partial save");
});

test("L348492 save replaces the channel list wholesale — deletion must be possible", () => {
  saveNotificationsConfig({ channels: [WEBHOOK, { ...WEBHOOK, id: "other" }] });
  const next = saveNotificationsConfig({ channels: [] });
  assert.deepEqual(next.channels, []);
  assert.deepEqual(readStored()["channels"], []);
});

test("L348491 save normalizes what it stores, so the cache and the file agree", () => {
  const next = saveNotificationsConfig({ debounceSeconds: 5_000, channels: [{ id: "bad id" }] });
  assert.equal(next.debounceSeconds, 3_600);
  assert.deepEqual(next.channels, []);
  assert.deepEqual(readStored()["channels"], []);
});

test("L348491 a null debounceSeconds resets to the default, not to 0", () => {
  // `null !== undefined`, so it does not keep the current value — but `clampInt`
  // sees a non-number/non-string and returns its fallback, 30. To disable the
  // debounce a client must send the number 0.
  saveNotificationsConfig({ debounceSeconds: 5 });
  assert.equal(saveNotificationsConfig({ debounceSeconds: null }).debounceSeconds, 30);
  assert.equal(saveNotificationsConfig({ debounceSeconds: 0 }).debounceSeconds, 0);
});

test("save writes the password file without leaving a .tmp behind", () => {
  saveNotificationsConfig({ channels: [EMAIL] });
  assert.equal(fs.existsSync(`${CONFIG_FILE()}.tmp`), false);
  assert.ok(fs.existsSync(CONFIG_FILE()));
});
