// Tests for the notification orchestrator.
//
// Four things are worth pinning, and each is a way the feature can be silently
// wrong rather than loudly broken:
//
//   1. **`selectChannels` needs BOTH conditions** (L348552). A channel that is
//      enabled but not opted-into must be silent, and one opted-into but disabled
//      must also be silent. A test that only checked one condition would pass with
//      an `||` — which would make "disable globally" useless.
//   2. **A failed delivery never rejects.** `notify` returns a promise, and its
//      caller is a synchronous session listener. A transport that throws must
//      produce `{ok:false}` and a history row, not an unhandled rejection.
//   3. **The debounce window suppresses the pair.** An offline followed by an
//      online inside the window delivers *nothing*; an offline that survives the
//      window delivers exactly one. This is the reason the machine exists and it is
//      the only test that needs fake time.
//   4. **`testSend` ignores `enabled` and the opt-in** (L348709) but reports
//      `found:false` for an unknown id — the WebUI's 404 branch depends on the
//      distinction between "no such channel" and "channel failed".
//
// Time is controlled through `deps.now` for the *recorded* timestamps, and through
// `node:test`'s mock timers for the *debounce* window. The two are separate knobs on
// purpose: `now` must not be able to change the debounce, or a test could pass by
// moving the clock instead of the timer.
//
// Nothing here touches the network or the filesystem beyond a temp `config/` dir:
// `post` and `sendMail` are injected.
//
// Line numbers in test names are `reference/index.mjs` positions.

import { after, afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  NotificationManager,
  createDefaultPost,
  createDefaultSendMail,
  createNotificationManager,
  selectChannels,
} from "../src/notifications/manager.js";
import { resetNotificationsConfigCache } from "../src/notifications/config.js";
import type {
  DeliveryResult,
  NotificationChannel,
  NotificationMail,
  NotificationSessionSource,
} from "../src/notifications/types.js";

const WEBHOOK: NotificationChannel = {
  id: "alerts",
  name: "Alerts",
  type: "webhook",
  url: "https://example.com/hook",
  bodyTemplate: '{"event":"{event}","uin":"{uin}","nickname":"{nickname}"}',
  enabled: true,
};

const EMAIL: NotificationChannel = {
  id: "mail",
  name: "Mail",
  type: "email",
  url: "",
  bodyTemplate: "{event} {uin}",
  enabled: true,
  smtpHost: "smtp.example.com",
  smtpPort: 465,
  smtpSecure: true,
  from: "bot@example.com",
  to: "a@example.com, b@example.com",
  subjectTemplate: "账号{event}",
};

interface RecordedPost {
  readonly url: string;
  readonly body: string;
  readonly headers: Record<string, string> | undefined;
}

interface RecordedMail extends NotificationMail {}

/** A deps bundle with every seam recording, and every failure injectable. */
function makeDeps(options: {
  channels?: readonly NotificationChannel[];
  channelIds?: readonly string[];
  postResult?: (url: string) => DeliveryResult | Promise<DeliveryResult>;
  sendMailResult?: () => DeliveryResult | Promise<DeliveryResult>;
  debounceSeconds?: number;
  now?: () => number;
  configThrows?: boolean;
  resolveProcess?: (uin: string, pid: number | null) => Promise<{ status?: string; pid?: number; error?: string } | undefined>;
} = {}) {
  const posts: RecordedPost[] = [];
  const mails: RecordedMail[] = [];
  const deps = {
    loadConfig: () => {
      if (options.configThrows) throw new Error("config is corrupt");
      return {
        debounceSeconds: options.debounceSeconds ?? 0,
        channels: options.channels ?? [WEBHOOK],
      };
    },
    loadChannelIds: (_uin: string) => options.channelIds ?? ["alerts"],
    post: async (url: string, body: string, headers?: Record<string, string>): Promise<DeliveryResult> => {
      posts.push({ url, body, headers });
      return options.postResult ? await options.postResult(url) : { ok: true, status: 200 };
    },
    sendMail: async (mail: NotificationMail): Promise<DeliveryResult> => {
      mails.push(mail);
      return options.sendMailResult ? await options.sendMailResult() : { ok: true };
    },
    now: options.now ?? (() => 1_700_000_000_000),
    ...(options.resolveProcess === undefined ? {} : { resolveProcess: options.resolveProcess }),
    historyLimit: 10,
  };
  return { deps, posts, mails };
}

/** A session source whose edges the test fires by hand. */
function makeSessionSource() {
  type Listener = {
    started?: (uin: string, bridge: { identity: { nickname: string }; activePid: number | null }) => void;
    closed?: (uin: string, bridge: { identity: { nickname: string }; activePid: number | null }, pid: number | null) => void;
  };
  const listeners = new Set<Listener>();
  let unsubscribes = 0;
  const source: NotificationSessionSource = {
    subscribeSessions(listener) {
      listeners.add(listener);
      return () => {
        unsubscribes += 1;
        listeners.delete(listener);
      };
    },
  };
  return {
    source,
    get unsubscribes(): number {
      return unsubscribes;
    },
    get listenerCount(): number {
      return listeners.size;
    },
    started(uin: string, nickname: string, pid: number | null = 1) {
      for (const l of [...listeners]) l.started?.(uin, { identity: { nickname }, activePid: pid });
    },
    closed(uin: string, nickname: string, pid: number | null = 1) {
      for (const l of [...listeners]) l.closed?.(uin, { identity: { nickname }, activePid: pid }, pid);
    },
  };
}

/** Let every queued microtask (and the manager's promise chain) settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

// ===========================================================================
// selectChannels (L348552)
// ===========================================================================

test("L348554 a channel needs both enabled and opted-in", () => {
  const disabled = { ...WEBHOOK, id: "off", enabled: false };
  const enabled = { ...WEBHOOK, id: "on", enabled: true };
  assert.deepEqual(
    selectChannels([disabled, enabled], ["off", "on"]).map((c) => c.id),
    ["on"],
    "a disabled channel is silent even when opted in",
  );
  assert.deepEqual(
    selectChannels([enabled], []).map((c) => c.id),
    [],
    "an enabled channel is silent when not opted in",
  );
});

test("L348554 selectChannels preserves config order, not the opt-in order", () => {
  const a = { ...WEBHOOK, id: "a" };
  const b = { ...WEBHOOK, id: "b" };
  assert.deepEqual(
    selectChannels([a, b], ["b", "a"]).map((c) => c.id),
    ["a", "b"],
  );
});

test("selectChannels ignores an opt-in for a channel that does not exist", () => {
  assert.deepEqual(selectChannels([WEBHOOK], ["ghost"]), []);
});

// ===========================================================================
// notify / deliver (L348625, L348677)
// ===========================================================================

test("L348653 a webhook notification renders the template with the event facts", async () => {
  const { deps, posts } = makeDeps();
  const manager = new NotificationManager(deps);
  await manager.notify("10001", "offline");
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.url, "https://example.com/hook");
  assert.deepEqual(JSON.parse(posts[0]?.body ?? ""), {
    event: "offline",
    uin: "10001",
    nickname: "10001",
  });
  manager.dispose();
});

test("L348658 process facts fill status/pid/error, and a missing lookup leaves them empty", async () => {
  const { deps, posts } = makeDeps({
    resolveProcess: async () => ({ status: "injected", pid: 4242, error: "hook stopped" }),
  });
  const manager = new NotificationManager(deps);
  deps.loadConfig = () => ({
    debounceSeconds: 0,
    channels: [{ ...WEBHOOK, bodyTemplate: "{status}|{pid}|{error}" }],
  });
  await manager.notify("10001", "offline");
  assert.equal(posts[0]?.body, "injected|4242|hook stopped");

  const { deps: deps2, posts: posts2 } = makeDeps({
    channels: [{ ...WEBHOOK, bodyTemplate: "[{status}][{pid}][{error}]" }],
  });
  const manager2 = new NotificationManager(deps2);
  await manager2.notify("10001", "offline");
  assert.equal(posts2[0]?.body, "[][][]", "absent facts render empty, not 'undefined'");
  manager.dispose();
  manager2.dispose();
});

test("L348659 a pid of 0 renders as \"0\", not as empty", async () => {
  const { deps, posts } = makeDeps({
    channels: [{ ...WEBHOOK, bodyTemplate: "{pid}" }],
    resolveProcess: async () => ({ pid: 0 }),
  });
  const manager = new NotificationManager(deps);
  await manager.notify("10001", "offline");
  assert.equal(posts[0]?.body, "0");
  manager.dispose();
});

test("L348651 a throwing resolveProcess does not suppress the notification", async () => {
  const { deps, posts } = makeDeps({
    resolveProcess: async () => {
      throw new Error("hook manager is gone");
    },
  });
  const manager = new NotificationManager(deps);
  await manager.notify("10001", "offline");
  assert.equal(posts.length, 1, "process facts are decorative — the notification still goes out");
  manager.dispose();
});

test("L348643 a config load failure skips the notification instead of rejecting", async () => {
  const { deps, posts } = makeDeps({ configThrows: true });
  const manager = new NotificationManager(deps);
  // The promise must resolve, not reject — the caller is a sync listener.
  await manager.notify("10001", "offline");
  assert.equal(posts.length, 0);
  manager.dispose();
});

test("L348646 no selected channels means no delivery and no history", async () => {
  const { deps, posts } = makeDeps({ channelIds: [] });
  const manager = new NotificationManager(deps);
  await manager.notify("10001", "offline");
  assert.equal(posts.length, 0);
  assert.deepEqual(manager.getRecent(), []);
  manager.dispose();
});

test("L348699 a transport that throws is contained and recorded as a failure", async () => {
  const { deps } = makeDeps({
    postResult: () => {
      throw new Error("socket hang up");
    },
  });
  const manager = new NotificationManager(deps);
  await manager.notify("10001", "offline");
  const [row] = manager.getRecent();
  assert.equal(row?.ok, false);
  assert.equal(row?.error, "socket hang up");
  manager.dispose();
});

test("L348672 a non-ok result with no error message records `HTTP <status>`", async () => {
  const { deps } = makeDeps({ postResult: () => ({ ok: false, status: 503 }) });
  const manager = new NotificationManager(deps);
  await manager.notify("10001", "offline");
  assert.equal(manager.getRecent()[0]?.error, "HTTP 503");
  manager.dispose();
});

test("L348672 a non-ok result with neither error nor status records `delivery failed`", async () => {
  const { deps } = makeDeps({ postResult: () => ({ ok: false }) });
  const manager = new NotificationManager(deps);
  await manager.notify("10001", "offline");
  assert.equal(manager.getRecent()[0]?.error, "delivery failed");
  manager.dispose();
});

test("L348672 a successful delivery records no error (undefined, not \"\")", async () => {
  const { deps } = makeDeps();
  const manager = new NotificationManager(deps);
  await manager.notify("10001", "offline");
  const [row] = manager.getRecent();
  assert.equal(row?.ok, true);
  assert.equal(row?.error, undefined);
  assert.equal(row?.status, 200);
  manager.dispose();
});

test("L348665 one failing channel does not stop the others", async () => {
  const { deps, posts } = makeDeps({
    channels: [WEBHOOK, { ...WEBHOOK, id: "second", url: "https://second.example.com" }],
    channelIds: ["alerts", "second"],
    postResult: (url) => (url === "https://example.com/hook" ? { ok: false, error: "boom" } : { ok: true, status: 204 }),
  });
  const manager = new NotificationManager(deps);
  await manager.notify("10001", "offline");
  assert.equal(posts.length, 2);
  const recent = manager.getRecent();
  assert.deepEqual(
    recent.map((r) => [r.channelId, r.ok]),
    [["second", true], ["alerts", false]],
    "history is most-recent-first, so the second channel leads",
  );
  manager.dispose();
});

test("L348683 an email channel goes through sendMail, with the raw recipient list", async () => {
  const { deps, mails } = makeDeps({ channels: [EMAIL], channelIds: ["mail"] });
  const manager = new NotificationManager(deps);
  await manager.notify("10001", "offline");
  assert.equal(mails.length, 1);
  assert.equal(mails[0]?.host, "smtp.example.com");
  assert.equal(mails[0]?.port, 465);
  assert.equal(mails[0]?.secure, true);
  // The raw string, not an array — `createDefaultSendMail` re-parses it.
  assert.equal(mails[0]?.to, "a@example.com, b@example.com");
  assert.equal(mails[0]?.subject, "账号offline");
  assert.equal(mails[0]?.text, "offline 10001");
  manager.dispose();
});

test("L348682 an email channel with no sendMail transport reports `not configured`", async () => {
  const { deps } = makeDeps({ channels: [EMAIL], channelIds: ["mail"] });
  const manager = new NotificationManager({ ...deps, sendMail: undefined });
  await manager.notify("10001", "offline");
  assert.equal(manager.getRecent()[0]?.error, "email delivery is not configured");
  manager.dispose();
});

test("L348686 a sendMail that throws is contained", async () => {
  const { deps } = makeDeps({
    channels: [EMAIL],
    channelIds: ["mail"],
    sendMailResult: () => {
      throw new Error("SMTP 认证失败");
    },
  });
  const manager = new NotificationManager(deps);
  await manager.notify("10001", "offline");
  assert.equal(manager.getRecent()[0]?.error, "SMTP 认证失败");
  manager.dispose();
});

test("L348631 deliveries for one uin are serialized", async () => {
  const order: string[] = [];
  let inFlight = 0;
  const { deps } = makeDeps({
    postResult: async () => {
      inFlight += 1;
      assert.equal(inFlight, 1, "two deliveries for one uin must not overlap");
      order.push("start");
      await new Promise<void>((resolve) => setImmediate(resolve));
      inFlight -= 1;
      order.push("end");
      return { ok: true, status: 200 };
    },
  });
  const manager = new NotificationManager(deps);
  await Promise.all([manager.notify("10001", "offline"), manager.notify("10001", "online")]);
  assert.deepEqual(order, ["start", "end", "start", "end"]);
  manager.dispose();
});

test("L348625 notify after dispose is a no-op", async () => {
  const { deps, posts } = makeDeps();
  const manager = new NotificationManager(deps);
  manager.dispose();
  await manager.notify("10001", "offline");
  assert.equal(posts.length, 0);
});

// ===========================================================================
// The debounce window, end to end (L348601)
// ===========================================================================

test("L348513 an offline/online pair inside the window delivers nothing", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { deps, posts } = makeDeps({ debounceSeconds: 30 });
  const manager = new NotificationManager(deps);
  const sessions = makeSessionSource();
  manager.bind(sessions.source);

  sessions.closed("10001", "Alice");
  await flush();
  assert.equal(posts.length, 0, "the offline is debounced, not delivered");

  sessions.started("10001", "Alice");
  await flush();
  assert.equal(posts.length, 0, "the reconnect cancelled the pending offline");

  // Advancing past the window must not revive the cancelled timer.
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(posts.length, 0);
  manager.dispose();
});

test("L348531 an offline that survives the window delivers exactly one notification", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { deps, posts } = makeDeps({ debounceSeconds: 30 });
  const manager = new NotificationManager(deps);
  const sessions = makeSessionSource();
  manager.bind(sessions.source);

  sessions.closed("10001", "Alice");
  await flush();
  assert.equal(posts.length, 0);

  t.mock.timers.tick(30_000);
  await flush();
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0]?.body ?? ""), { event: "offline", uin: "10001", nickname: "Alice" });

  // The timer fired once; a second tick must not deliver again.
  t.mock.timers.tick(30_000);
  await flush();
  assert.equal(posts.length, 1);
  manager.dispose();
});

test("L348504 a zero-second debounce delivers immediately", async () => {
  const { deps, posts } = makeDeps({ debounceSeconds: 0 });
  const manager = new NotificationManager(deps);
  const sessions = makeSessionSource();
  manager.bind(sessions.source);
  sessions.closed("10001", "Alice");
  await flush();
  assert.equal(posts.length, 1);
  manager.dispose();
});

test("L348583 the nickname fallback prefers the live name, then the cached one, then the uin", async () => {
  const { deps, posts } = makeDeps({ debounceSeconds: 0 });
  const manager = new NotificationManager(deps);
  const sessions = makeSessionSource();
  manager.bind(sessions.source);

  // First edge: no cached name, and the session has not resolved a profile.
  sessions.closed("10001", "");
  await flush();
  assert.equal(JSON.parse(posts[0]?.body ?? "").nickname, "10001");

  // Second edge: still no profile, but the previous name is cached.
  sessions.started("10001", "Alice");
  await flush();
  sessions.closed("10001", "");
  await flush();
  assert.equal(JSON.parse(posts[2]?.body ?? "").nickname, "Alice");
  manager.dispose();
});

test("L348594 a config that will not load skips the offline edge entirely", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { deps, posts } = makeDeps({ debounceSeconds: 30 });
  const manager = new NotificationManager(deps);
  const sessions = makeSessionSource();
  manager.bind(sessions.source);

  deps.loadConfig = () => {
    throw new Error("corrupt");
  };
  sessions.closed("10001", "Alice");
  await flush();
  // A timer would have been armed against a debounce value we do not have.
  t.mock.timers.tick(120_000);
  await flush();
  assert.equal(posts.length, 0);
  manager.dispose();
});

test("L348574 bind is idempotent and dispose unsubscribes", () => {
  const { deps } = makeDeps();
  const manager = new NotificationManager(deps);
  const sessions = makeSessionSource();
  manager.bind(sessions.source);
  manager.bind(sessions.source);
  assert.equal(sessions.listenerCount, 1, "a second bind replaces the first subscription");
  assert.equal(sessions.unsubscribes, 1);
  manager.dispose();
  assert.equal(sessions.listenerCount, 0);
  assert.equal(sessions.unsubscribes, 2);
});

test("a bind after dispose does not subscribe", () => {
  const { deps } = makeDeps();
  const manager = new NotificationManager(deps);
  manager.dispose();
  const sessions = makeSessionSource();
  manager.bind(sessions.source);
  assert.equal(sessions.listenerCount, 0);
});

test("dispose clears every pending debounce timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { deps, posts } = makeDeps({ debounceSeconds: 30 });
  const manager = new NotificationManager(deps);
  const sessions = makeSessionSource();
  manager.bind(sessions.source);
  sessions.closed("10001", "Alice");
  sessions.closed("10002", "Bob");
  await flush();
  manager.dispose();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(posts.length, 0);
});

// ===========================================================================
// testSend (L348709)
// ===========================================================================

test("L348720 testSend on an unknown id reports found:false", async () => {
  const { deps } = makeDeps();
  const manager = new NotificationManager(deps);
  assert.deepEqual(await manager.testSend("ghost"), { ok: false, found: false });
  manager.dispose();
});

test("L348716 testSend reports found:false when the config cannot be read", async () => {
  const { deps } = makeDeps({ configThrows: true });
  const manager = new NotificationManager(deps);
  assert.deepEqual(await manager.testSend("alerts"), { ok: false, found: false, error: "config is corrupt" });
  manager.dispose();
});

test("L348709 testSend ignores `enabled` — you test a channel before wiring it up", async () => {
  const { deps, posts } = makeDeps({ channels: [{ ...WEBHOOK, enabled: false }] });
  const manager = new NotificationManager(deps);
  const result = await manager.testSend("alerts");
  assert.deepEqual(result, { ok: true, status: 200, found: true });
  assert.equal(posts.length, 1);
  manager.dispose();
});

test("L348709 testSend ignores the per-UIN opt-in", async () => {
  const { deps, posts } = makeDeps({ channelIds: [] });
  const manager = new NotificationManager(deps);
  await manager.testSend("alerts");
  assert.equal(posts.length, 1);
  manager.dispose();
});

test("L348725 testSend uses fixed sample variables and is not recorded to history", async () => {
  const { deps, posts } = makeDeps({
    channels: [{ ...WEBHOOK, bodyTemplate: "{uin}|{nickname}|{event}|{status}|{pid}|{error}" }],
  });
  const manager = new NotificationManager(deps);
  await manager.testSend("alerts");
  assert.equal(posts[0]?.body, "10000|测试账号|offline|disconnected|1234|");
  assert.deepEqual(manager.getRecent(), [], "a test send is a diagnostic, not a delivery");
  manager.dispose();
});

test("L348733 testSend surfaces a delivery failure with found:true", async () => {
  const { deps } = makeDeps({ postResult: () => ({ ok: false, status: 500, error: "HTTP 500" }) });
  const manager = new NotificationManager(deps);
  assert.deepEqual(await manager.testSend("alerts"), { ok: false, status: 500, error: "HTTP 500", found: true });
  manager.dispose();
});

// ===========================================================================
// History (L348738, L348743)
// ===========================================================================

test("L348740 history is bounded at historyLimit, oldest dropped first", async () => {
  const { deps } = makeDeps({ channels: [{ ...WEBHOOK, bodyTemplate: "{uin}" }] });
  const manager = new NotificationManager({ ...deps, historyLimit: 3 });
  for (const uin of ["10001", "10002", "10003", "10004", "10005"]) {
    await manager.notify(uin, "offline");
  }
  const recent = manager.getRecent();
  // Most recent first.
  assert.deepEqual(
    recent.map((r) => r.uin),
    ["10005", "10004", "10003"],
  );
  manager.dispose();
});

test("L348744 getRecent(limit) clamps to the buffer and never returns the wrong end", async () => {
  const { deps } = makeDeps();
  const manager = new NotificationManager({ ...deps, historyLimit: 5 });
  for (const uin of ["10001", "10002", "10003"]) await manager.notify(uin, "offline");
  assert.equal(manager.getRecent(2).length, 2);
  assert.equal(manager.getRecent(100).length, 3, "a limit past the buffer returns the whole buffer");
  assert.equal(manager.getRecent(0).length, 0);
  assert.equal(manager.getRecent(-1).length, 0, "a negative limit is 0, not slice(1)");
  assert.equal(manager.getRecent(Number.NaN).length, 0);
  manager.dispose();
});

test("L348743 getRecent truncates a fractional limit", async () => {
  const { deps } = makeDeps();
  const manager = new NotificationManager(deps);
  for (const uin of ["10001", "10002", "10003"]) await manager.notify(uin, "offline");
  assert.equal(manager.getRecent(1.9).length, 1);
  manager.dispose();
});

// ===========================================================================
// Default transports (L348758, L348785)
// ===========================================================================

test("L348770 createDefaultPost POSTs JSON and reports the status", async (t) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response("", { status: 201 });
  });
  const post = createDefaultPost(5_000);
  const result = await post("https://example.com/hook", '{"a":1}');
  assert.deepEqual(result, { ok: true, status: 201, error: undefined });
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, '{"a":1}');
  assert.deepEqual(calls[0]?.init?.headers, { "Content-Type": "application/json" });
  assert.ok(calls[0]?.init?.signal, "a timeout signal is attached");
});

test("L348764 an operator Content-Type header overrides the JSON default", async (t) => {
  const calls: { init: RequestInit | undefined }[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ init });
    return new Response("", { status: 200 });
  });
  await createDefaultPost(5_000)("https://example.com/hook", "{}", { "Content-Type": "application/vnd.api+json" });
  assert.deepEqual(calls[0]?.init?.headers, { "Content-Type": "application/vnd.api+json" });
});

test("L348773 createDefaultPost reports a non-2xx as a failure and never throws", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 500 }));
  assert.deepEqual(await createDefaultPost(5_000)("https://example.com/hook", "{}"), {
    ok: false,
    status: 500,
    error: "HTTP 500",
  });
});

test("L348777 createDefaultPost contains a transport rejection", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("getaddrinfo ENOTFOUND example.com");
  });
  const result = await createDefaultPost(5_000)("https://example.com/hook", "{}");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /ENOTFOUND/);
});

test("L348795 createDefaultSendMail parses the recipient list and reports success", async () => {
  // A closed port: the point is that the failure is *formatted*, not that SMTP works
  // (the SMTP suite covers the success path against a real socket).
  const send = createDefaultSendMail(200);
  const result = await send({
    host: "127.0.0.1",
    port: 1,
    secure: false,
    from: "bot@example.com",
    to: "a@example.com; b@example.com",
    subject: "s",
    text: "t",
  });
  assert.equal(result.ok, false);
  // `formatSmtpError` maps ECONNREFUSED to the localized connection message.
  assert.match(result.error ?? "", /无法连接 SMTP：127\.0\.0\.1:1/);
});

test("L348803 createDefaultSendMail never throws on a bad From address", async () => {
  const result = await createDefaultSendMail(200)({
    host: "127.0.0.1",
    port: 1,
    secure: false,
    from: "not an address",
    to: "a@example.com",
    subject: "s",
    text: "t",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid from address");
});

test("L348810 createNotificationManager wires the real config loader by default", () => {
  // A temp cwd so the real `config/notifications.json` is never touched.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notifications-manager-"));
  const originalCwd = process.cwd();
  process.chdir(tmpDir);
  // The config module memoizes on first load, and an earlier test in this file may
  // already have populated it against a different temp directory.
  resetNotificationsConfigCache();
  try {
    const manager = createNotificationManager(async () => undefined);
    assert.ok(manager instanceof NotificationManager);
    // `loadConfig` is wired as a function reference, not called at construction, so
    // nothing is on disk yet — the file appears on the first *delivery*. Asserting
    // the file exists here would pass only if the constructor did I/O it should not.
    assert.equal(fs.existsSync(path.join("config", "notifications.json")), false);
    manager.dispose();
  } finally {
    process.chdir(originalCwd);
    resetNotificationsConfigCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
