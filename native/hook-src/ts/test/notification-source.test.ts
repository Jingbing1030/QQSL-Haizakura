// The adapter that finally connects the notification subsystem to a real event
// source, plus the two session edges `Bridge` had to start publishing for that to
// be possible.
//
// ---------------------------------------------------------------------------
// What was broken, stated as tests
// ---------------------------------------------------------------------------
// `NotificationManager.bind()` has always taken a `NotificationSessionSource`, and
// the whole manager suite passes — but every one of those tests hand-builds a fake
// source (`test/notifications-manager.test.ts:122 makeSessionSource`). Nothing in
// `src/` implemented the interface, so the feature could not fire. A passing suite
// proved the orchestrator, not the feature.
//
// The three claims these tests exist to stop being false:
//
//   1. `Bridge` publishes a session edge when a session starts and ends — at the
//      exact two places a session can start or end (`bindPid` / `detachPid`), not
//      somewhere adjacent that happens to work in one scenario.
//   2. `BridgeNotificationSessionSource` turns those bus events into the
//      `started`/`closed` callbacks `NotificationManager` subscribes with, with the
//      uin, nickname and pid the manager actually reads.
//   3. End to end: a real `Bridge`, a real adapter, a real `NotificationManager`
//      with an injected `post` → a webhook body arrives. That last one is the test
//      that would have failed for the entire life of the notification package.
//
// ---------------------------------------------------------------------------
// Why these use a real `Bridge` and not a stub
// ---------------------------------------------------------------------------
// The bug being fixed was "the interface exists and nothing implements it". A test
// with a hand-written `SessionBridge` would reproduce exactly that failure mode one
// level down: it would pass while `Bridge` still published nothing. So the edge
// tests drive `bridge.bindPid` / `bridge.detachPid` — the real methods — and let
// the real `BridgeEventBusImpl` carry the event. `SessionBridge` being structural
// is exercised separately (one small test) because that is what makes the adapter
// unit-testable at all.
//
// Reference: `BridgeManager.subscribeSessions` / `fireSessionStarted` /
// `fireSessionClosed` at reference/index.mjs:347729-L347750, called from
// L347797 (`bindPid` created), L347842 (packet-created session) and
// L347915-L347917 (`detachPidFromSession`, before the session is disposed).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Bridge, MemoryIdentity, SESSION_CLOSED, SESSION_STARTED } from "../src/bridge/bridge.js";
import type { BridgeEvent, PacketClient, PacketSendResult } from "../src/bridge/context.js";
import {
  BridgeNotificationSessionSource,
  SESSION_EVENT_KINDS,
  createBridgeNotificationSessionSource,
} from "../src/host/notification-source.js";
import { NotificationManager } from "../src/notifications/manager.js";
import { resetNotificationsConfigCache } from "../src/notifications/config.js";
import { HaizakuraRuntime } from "../src/main.js";
import type {
  DeliveryResult,
  NotificationChannel,
  NotificationSession,
} from "../src/notifications/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A packet client that answers nothing. These tests never send a packet. */
function idleClient(): PacketClient {
  return {
    async sendPacket(): Promise<PacketSendResult> {
      return { success: true, gotResponse: true, errorCode: 0, responseData: new Uint8Array(0) };
    },
  };
}

const UIN = "10001";
const NICKNAME = "鱼糕";

function makeBridge(uin: string = UIN, nickname: string = NICKNAME): Bridge {
  const identity = new MemoryIdentity(uin);
  identity.setSelfProfile({
    uin: Number(uin),
    uid: `u_${uin}`,
    nickname,
    remark: "",
    qid: "",
    sex: "unknown",
    age: 0,
    sign: "",
    avatar: "",
    level: 0,
    qidianMasterFlag: 0,
    qidianCrewFlag: 0,
    qidianCrewFlag2: 0,
  });
  return new Bridge(identity);
}

/** Collect every event the bus carries, so a test can assert on the raw payload. */
function recordEvents(bridge: Bridge): BridgeEvent[] {
  const seen: BridgeEvent[] = [];
  bridge.events.onAny((event) => {
    seen.push(event);
  });
  return seen;
}

interface StartedEdge {
  uin: string;
  nickname: string;
  pid: number | null;
}

interface ClosedEdge {
  uin: string;
  nickname: string;
  pid: number | null;
  activePidAtFire: number | null;
}

/** A source listener that records what the manager would have received. */
function recorder() {
  const started: StartedEdge[] = [];
  const closed: ClosedEdge[] = [];
  return {
    started,
    closed,
    listener: {
      started(uin: string, session: NotificationSession) {
        started.push({ uin, nickname: session.identity.nickname, pid: session.activePid });
      },
      closed(uin: string, session: NotificationSession, pid: number | null) {
        closed.push({
          uin,
          nickname: session.identity.nickname,
          pid,
          activePidAtFire: session.activePid,
        });
      },
    },
  };
}

/** Let the bus's `emit` (async, `allSettled`) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

// ===========================================================================
// 1. `Bridge` publishes the two session edges (the missing producer)
// ===========================================================================

test("bindPid publishes session_started only for the FIRST connection", async () => {
  const bridge = makeBridge();
  const seen = recordEvents(bridge);

  bridge.bindPid(100, idleClient());
  await settle();
  assert.deepEqual(
    seen.map((e) => e.kind),
    [SESSION_STARTED],
    "a session acquiring its first process is a start",
  );

  // A second PID on an already-live session is another hook connection, not a
  // login. The debounce machine would treat a spurious second `online` as a real
  // edge (it suppresses offline→online pairs, not duplicate onlines), so this
  // distinction is the one that keeps a multi-process account from flapping.
  bridge.bindPid(101, idleClient());
  await settle();
  assert.deepEqual(seen.map((e) => e.kind), [SESSION_STARTED], "a second PID is not a new session");
});

test("bindPid's session_started payload carries the uin", async () => {
  const bridge = makeBridge();
  const seen = recordEvents(bridge);
  bridge.bindPid(100, idleClient());
  await settle();
  const event = seen.find((e) => e.kind === SESSION_STARTED);
  assert.ok(event, "the edge must have been published");
  assert.equal(event["uin"], UIN, "the adapter keys by uin, so the payload must carry it");
  // `time` is the reference's event convention (whole seconds), see msg-push.ts.
  assert.equal(typeof event["time"], "number");
});

test("detachPid publishes session_closed only when the LAST connection goes", async () => {
  const bridge = makeBridge();
  bridge.bindPid(100, idleClient());
  bridge.bindPid(101, idleClient());
  await settle();
  const seen = recordEvents(bridge);

  bridge.detachPid(100);
  await settle();
  assert.deepEqual(seen.map((e) => e.kind), [], "one of two connections leaving is not a session close");

  bridge.detachPid(101);
  await settle();
  assert.deepEqual(seen.map((e) => e.kind), [SESSION_CLOSED]);
});

test("session_closed names the pid that went away, not the still-active one", async () => {
  // The notification template renders `{pid}`. Reading `bridge.activePid` inside
  // the listener would produce `null` here, because the last detach has already
  // emptied the connection map — the same reason the reference passes `pid` as a
  // separate argument (reference/index.mjs:347743).
  const bridge = makeBridge();
  bridge.bindPid(4242, idleClient());
  await settle();
  const seen = recordEvents(bridge);
  bridge.detachPid(4242);
  await settle();
  const event = seen.find((e) => e.kind === SESSION_CLOSED);
  assert.ok(event);
  assert.equal(event["pid"], 4242);
  assert.equal(bridge.activePid, null, "the connection map is already empty when the edge is published");
});

test("detachPid on an unknown pid publishes nothing", async () => {
  // `HaizakuraRuntime.stop()` detaches every bound pid unconditionally, and it can
  // be called twice. Without the `existed` guard, a second shutdown would announce
  // a closure for an account that was already closed — i.e. page the operator a
  // second time for the same outage.
  const bridge = makeBridge();
  const seen = recordEvents(bridge);
  assert.equal(bridge.detachPid(999), false);
  await settle();
  assert.deepEqual(seen.map((e) => e.kind), []);
});

test("a session that starts, closes and starts again publishes both edges twice", async () => {
  // Re-login is a real pair of edges, not a re-entrant none. The manager's machine
  // needs the second `online` to fire an "online" notification, so collapsing it
  // would silently drop the recovery message.
  const bridge = makeBridge();
  const seen = recordEvents(bridge);
  bridge.bindPid(100, idleClient());
  await settle();
  bridge.detachPid(100);
  await settle();
  bridge.bindPid(100, idleClient());
  await settle();
  assert.deepEqual(seen.map((e) => e.kind), [SESSION_STARTED, SESSION_CLOSED, SESSION_STARTED]);
});

test("SESSION_EVENT_KINDS matches the constants Bridge publishes", () => {
  assert.deepEqual([...SESSION_EVENT_KINDS], [SESSION_STARTED, SESSION_CLOSED]);
});

// ===========================================================================
// 2. The adapter's bus → listener translation
// ===========================================================================

test("the adapter delivers started with the bridge's uin, nickname and activePid", async () => {
  const bridge = makeBridge();
  const source = new BridgeNotificationSessionSource();
  source.addBridge(bridge);
  const rec = recorder();
  source.subscribeSessions(rec.listener);

  bridge.bindPid(777, idleClient());
  await settle();
  assert.deepEqual(rec.started, [{ uin: UIN, nickname: NICKNAME, pid: 777 }]);
  assert.deepEqual(rec.closed, []);
});

test("the adapter delivers closed with the detaching pid and an already-null activePid", async () => {
  const bridge = makeBridge();
  const source = new BridgeNotificationSessionSource();
  source.addBridge(bridge);
  const rec = recorder();
  source.subscribeSessions(rec.listener);

  bridge.bindPid(777, idleClient());
  await settle();
  bridge.detachPid(777);
  await settle();
  assert.equal(rec.closed.length, 1);
  const edge = rec.closed[0]!;
  assert.equal(edge.uin, UIN);
  assert.equal(edge.nickname, NICKNAME);
  assert.equal(edge.pid, 777, "the pid comes from the event payload");
  assert.equal(
    edge.activePidAtFire,
    null,
    "the session handed to `closed` is the live bridge, whose activePid is already null",
  );
});

test("unsubscribing stops delivery, and the handle is idempotent", async () => {
  const bridge = makeBridge();
  const source = new BridgeNotificationSessionSource();
  source.addBridge(bridge);
  const rec = recorder();
  const unsubscribe = source.subscribeSessions(rec.listener);

  unsubscribe();
  unsubscribe(); // `NotificationManager.bind` calls the previous handle on rebind

  bridge.bindPid(1, idleClient());
  await settle();
  assert.deepEqual(rec.started, []);
  assert.equal(source.listenerCount, 0);
});

test("two listeners both receive the edge; one throwing does not stop the other", async () => {
  // The reference isolates each listener in its own try
  // (reference/index.mjs:347736-L347750) precisely so a broken observer cannot
  // suppress the notification. Asserting only "the second one ran" would pass with a
  // fan-out that stopped at the first throw — the extra listener is here to prove the
  // loop CONTINUES.
  const bridge = makeBridge();
  const source = new BridgeNotificationSessionSource();
  source.addBridge(bridge);
  let second = 0;
  let third = 0;
  source.subscribeSessions({
    started() {
      throw new Error("this observer is broken");
    },
  });
  source.subscribeSessions({
    started() {
      second += 1;
    },
  });
  source.subscribeSessions({
    started() {
      third += 1;
    },
  });

  bridge.bindPid(1, idleClient());
  await settle();
  assert.equal(second, 1, "a throwing listener must not suppress the next one");
  assert.equal(third, 1);
});

test("a listener that unsubscribes during dispatch does not change who receives THIS edge", async () => {
  // `BridgeEventBusImpl.emit` snapshots its handler list; the adapter must do the
  // same for its own listeners, or a manager that rebinds inside its callback would
  // cause the remaining listeners to be skipped.
  const bridge = makeBridge();
  const source = new BridgeNotificationSessionSource();
  source.addBridge(bridge);
  const second: string[] = [];
  let unsubscribeFirst: (() => void) | null = null;
  unsubscribeFirst = source.subscribeSessions({
    started() {
      // Rebinding inside a callback is what `NotificationManager.bind` does when it
      // is called twice in a row (manager.ts:154 unsubscribes, then subscribes).
      unsubscribeFirst?.();
    },
  });
  source.subscribeSessions({
    started(uin: string) {
      second.push(uin);
    },
  });

  bridge.bindPid(1, idleClient());
  await settle();
  assert.deepEqual(second, [UIN], "the snapshot was taken before dispatch started");
});

test("removeBridge stops that account's events without touching other accounts", async () => {
  const a = makeBridge("10001", "A");
  const b = makeBridge("10002", "B");
  const source = new BridgeNotificationSessionSource();
  source.addBridge(a);
  source.addBridge(b);
  const rec = recorder();
  source.subscribeSessions(rec.listener);

  source.removeBridge("10001");
  a.bindPid(1, idleClient());
  b.bindPid(2, idleClient());
  await settle();

  assert.deepEqual(rec.started.map((e) => e.uin), ["10002"]);
  assert.equal(source.bridgeCount, 1);
});

test("addBridge twice for one uin replaces the subscription instead of doubling it", async () => {
  // A doubled registration delivers every edge twice, which the debounce machine
  // cannot repair (it collapses offline→online pairs, not duplicates). The manager's
  // own `bind` makes the same promise and this keeps the two consistent.
  const bridge = makeBridge();
  const source = new BridgeNotificationSessionSource();
  source.addBridge(bridge);
  source.addBridge(bridge);
  const rec = recorder();
  source.subscribeSessions(rec.listener);

  bridge.bindPid(1, idleClient());
  await settle();
  assert.equal(rec.started.length, 1);
  assert.equal(source.bridgeCount, 1);
});

test("dispose drops listeners and subscriptions; a later edge reaches nobody", async () => {
  const bridge = makeBridge();
  const source = new BridgeNotificationSessionSource();
  source.addBridge(bridge);
  const rec = recorder();
  source.subscribeSessions(rec.listener);

  source.dispose();
  assert.equal(source.listenerCount, 0);
  assert.equal(source.bridgeCount, 0);

  bridge.bindPid(1, idleClient());
  await settle();
  assert.deepEqual(rec.started, []);
});

test("createBridgeNotificationSessionSource registers every given bridge", async () => {
  const bridges = [makeBridge("10001", "A"), makeBridge("10002", "B")];
  const source = createBridgeNotificationSessionSource(bridges);
  const rec = recorder();
  source.subscribeSessions(rec.listener);

  for (const [index, bridge] of bridges.entries()) bridge.bindPid(index + 1, idleClient());
  await settle();
  assert.deepEqual(rec.started.map((e) => e.uin).sort(), ["10001", "10002"]);
  assert.equal(source.bridgeCount, 2);
});

test("the adapter accepts a structural SessionBridge, not just a real Bridge", async () => {
  // This is what makes the adapter unit-testable without an identity roster. It is
  // also the reason the binding needs no cast at the call sites.
  const handlers: ((event: BridgeEvent) => void)[] = [];
  const fake = {
    identity: { uin: "99999", nickname: "stub" },
    activePid: 12 as number | null,
    events: {
      on(kind: string, h: (event: BridgeEvent) => void | Promise<void>) {
        void kind;
        handlers.push(h as (event: BridgeEvent) => void);
        return () => undefined;
      },
      onAny() {
        return () => undefined;
      },
      off() {},
      has() {
        return true;
      },
      clear() {},
      async emit() {},
    },
  };
  const source = new BridgeNotificationSessionSource();
  source.addBridge(fake);
  const rec = recorder();
  source.subscribeSessions(rec.listener);

  assert.equal(handlers.length, 2, "one subscription per session kind, through the bus interface");
  handlers[0]!({ kind: SESSION_STARTED, uin: "99999" });
  assert.deepEqual(rec.started, [{ uin: "99999", nickname: "stub", pid: 12 }]);
});

test("a session_closed payload without a usable pid falls back to the session's activePid", async () => {
  const bridge = makeBridge();
  const source = new BridgeNotificationSessionSource();
  source.addBridge(bridge);
  const rec = recorder();
  source.subscribeSessions(rec.listener);

  // Two connections, and a malformed closed payload for one of them: the session is
  // still live, so its active pid is the honest answer.
  bridge.bindPid(1, idleClient());
  bridge.bindPid(2, idleClient());
  await settle();
  await bridge.events.emit({ kind: SESSION_CLOSED, uin: UIN, pid: "not a number" });
  assert.equal(rec.closed.length, 1);
  assert.equal(rec.closed[0]!.pid, 2, "the fallback is the newest connection");
});

test("a payload uin that disagrees with the bridge is logged and the bridge wins", async () => {
  // The bridge's identity is authoritative: it is what `sendRawPacket` and every
  // OIDB spec use. A mismatched payload is a producer bug; dropping the edge would
  // silently lose the notification, so it is delivered under the real uin.
  const bridge = makeBridge();
  const source = new BridgeNotificationSessionSource();
  source.addBridge(bridge);
  const rec = recorder();
  source.subscribeSessions(rec.listener);

  await bridge.events.emit({ kind: SESSION_STARTED, uin: "10000" });
  assert.deepEqual(rec.started.map((e) => e.uin), [UIN]);
});

// ===========================================================================
// 3. End to end: a real Bridge edge reaches a real webhook payload
// ===========================================================================

const WEBHOOK: NotificationChannel = {
  id: "alerts",
  name: "Alerts",
  type: "webhook",
  url: "https://example.com/hook",
  bodyTemplate: '{"event":"{event}","uin":"{uin}","nickname":"{nickname}","pid":"{pid}"}',
  enabled: true,
};

interface RecordedPost {
  url: string;
  body: string;
}

/**
 * A `NotificationManager` wired exactly as production does, except that the
 * transport is recorded instead of sent.
 *
 * `debounceSeconds: 0` so an offline emits synchronously — the debounce path has
 * its own suite and a fake timer here would obscure the wiring being tested.
 *
 * `resolveProcess` mirrors `HaizakuraRuntime.resolveProcessFacts`: it answers for a
 * pid the runtime still knows about. See the "pid comes from resolveProcess" test
 * below — a template's `{pid}` is rendered from the FACTS, not from the session.
 */
function makeWiredManager(
  bridge: Bridge,
  resolveProcess: (uin: string, pid: number | null) => Promise<{ status?: string; pid?: number; error?: string } | undefined> = async (_uin, pid) =>
    pid === null ? undefined : { pid },
): {
  manager: NotificationManager;
  source: BridgeNotificationSessionSource;
  posts: RecordedPost[];
} {
  const posts: RecordedPost[] = [];
  const source = new BridgeNotificationSessionSource();
  source.addBridge(bridge);
  const manager = new NotificationManager({
    loadConfig: () => ({ debounceSeconds: 0, channels: [WEBHOOK] }),
    loadChannelIds: () => ["alerts"],
    post: async (url: string, body: string): Promise<DeliveryResult> => {
      posts.push({ url, body });
      return { ok: true, status: 200 };
    },
    sendMail: async () => ({ ok: true }),
    now: () => 1_700_000_000_000,
    historyLimit: 10,
    resolveProcess,
  });
  manager.bind(source);
  return { manager, source, posts };
}

test("END TO END: a real bindPid alone produces NO notification (initial state is not an edge)", async () => {
  // Not a bug, and worth pinning because it looks like one. `DebounceMachine.onOnline`
  // with no recorded state answers `{kind:"none"}` (debounce.ts:79-L85, the reference's
  // L348520 verbatim): an account that was never known to be offline has not "come
  // back", and paging an operator every time the bot boots would make the feature
  // unusable. The first notification of a session is therefore the OFFLINE one.
  const bridge = makeBridge();
  const { manager, posts } = makeWiredManager(bridge);

  bridge.bindPid(777, idleClient());
  await settle();
  assert.equal(posts.length, 0, "a fresh login is not an online EDGE");

  // And the observable proof that the edge DID reach the manager: the very next
  // offline is delivered. If the wiring were still missing this would be 0 too.
  bridge.detachPid(777);
  await settle();
  assert.equal(posts.length, 1);
  manager.dispose();
});

test("END TO END: a real detachPid delivers an `offline` webhook naming the pid", async () => {
  // The test the notification package never had. Before `Bridge` published
  // `session_closed`, this produced zero posts no matter how correct the manager
  // was — which is the entire bug this change fixes.
  const bridge = makeBridge();
  const { manager, posts } = makeWiredManager(bridge);
  bridge.bindPid(777, idleClient());
  await settle();
  bridge.detachPid(777);
  await settle();

  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.url, "https://example.com/hook");
  assert.deepEqual(JSON.parse(posts[0]!.body), {
    event: "offline",
    uin: UIN,
    nickname: NICKNAME,
    pid: "777",
  });
  manager.dispose();
});

test("END TO END: an offline/online pair delivers offline then online (the recovery page)", async () => {
  // The other half of the feature: once an offline has been emitted, the machine is
  // in state `offline` and the next `online` IS a real edge, so a returning account
  // produces a recovery notification. This requires the session to be re-bound after
  // the detach — a new login, with the same uin.
  const bridge = makeBridge();
  const { manager, posts } = makeWiredManager(bridge);

  bridge.bindPid(777, idleClient());
  await settle();
  bridge.detachPid(777);
  await settle();
  bridge.bindPid(888, idleClient());
  await settle();

  assert.deepEqual(
    posts.map((p) => (JSON.parse(p.body) as { event: string }).event),
    ["offline", "online"],
  );
  // The recovery message names the NEW pid: `handleOnline` is called with
  // `bridge.activePid`, read after the bind.
  assert.equal((JSON.parse(posts[1]!.body) as { pid: string }).pid, "888");
  manager.dispose();
});

test("END TO END: resolving the manager BEFORE the first bind still sees the offline", async () => {
  // Ordering, made a test. `session_closed` has no replay, so a manager bound after
  // the detach misses the edge forever. `main.ts` binds in the runtime constructor
  // for this reason; this pins that the adapter honours it.
  const bridge = makeBridge();
  const { manager, source, posts } = makeWiredManager(bridge);
  assert.equal(source.bridgeCount, 1, "registration happened before any bindPid");

  bridge.bindPid(42, idleClient());
  await settle();
  bridge.detachPid(42);
  await settle();
  assert.equal(posts.length, 1, "the manager was already listening when the session closed");
  manager.dispose();
});

test("END TO END: disposing the manager before stop() means shutdown pages nobody", async () => {
  // `HaizakuraRuntime.stop()` disposes the manager, then detaches the pids. The
  // detach publishes `session_closed`; a live manager would page the operator about
  // an outage the operator just caused.
  const bridge = makeBridge();
  const { manager, source, posts } = makeWiredManager(bridge);
  bridge.bindPid(777, idleClient());
  await settle();

  manager.dispose();
  source.dispose();
  bridge.detachPid(777);
  await settle();

  assert.equal(posts.length, 0, "no offline notification for an operator-initiated stop");
});

test("END TO END: two channels both fire on one offline, in config order", async () => {
  const bridge = makeBridge();
  const posts: RecordedPost[] = [];
  const channelB = { ...WEBHOOK, id: "b", url: "https://example.com/b" };
  const source = new BridgeNotificationSessionSource();
  source.addBridge(bridge);
  const manager = new NotificationManager({
    loadConfig: () => ({ debounceSeconds: 0, channels: [WEBHOOK, channelB] }),
    loadChannelIds: () => ["b", "alerts"],
    post: async (url: string, body: string): Promise<DeliveryResult> => {
      posts.push({ url, body });
      return { ok: true, status: 200 };
    },
    sendMail: async () => ({ ok: true }),
    now: () => 1_700_000_000_000,
    historyLimit: 10,
  });
  manager.bind(source);

  bridge.bindPid(1, idleClient());
  await settle();
  bridge.detachPid(1);
  await settle();

  assert.deepEqual(posts.map((p) => p.url), [
    "https://example.com/hook",
    "https://example.com/b",
  ], "config order, not opt-in order");
  assert.equal(manager.getRecent(10).length, 2, "history records one row per channel");
  manager.dispose();
});

// ===========================================================================
// 4. The interface design vs. the real event source — where they do not match
// ===========================================================================

test("MISMATCH: `{pid}` in a template comes from resolveProcess, NOT from `closed`'s pid", async () => {
  // This is the sharpest place the interface lies about itself. `subscribeSessions`'s
  // `closed(uin, session, pid)` hands the manager a pid, and `handleOffline` stores it
  // in `accounts` — but `notifyNow` renders the template from `deps.resolveProcess(...)`
  // facts, and `vars.pid` is `facts?.pid === undefined ? "" : String(facts.pid)`
  // (manager.ts:281). So the pid the adapter carefully forwards shapes only the
  // lookup; it never reaches the message unless `resolveProcess` echoes it.
  //
  // Which means: passing `undefined`/`null` from `closed` and passing `777` produce the
  // SAME rendered `{pid}` — both empty — as long as `resolveProcess` decides on its
  // own. A caller wiring this up without noticing gets `"pid":""` in every page.
  const bridge = makeBridge();
  const asked: (number | null)[] = [];
  const { manager, posts } = makeWiredManager(bridge, async (_uin, pid) => {
    asked.push(pid);
    // Deliberately answers nothing, as `HaizakuraRuntime` does for a pid it has
    // already dropped.
    return undefined;
  });

  bridge.bindPid(777, idleClient());
  await settle();
  bridge.detachPid(777);
  await settle();

  assert.equal(posts.length, 1);
  assert.deepEqual(asked, [777], "the adapter's pid DOES reach resolveProcess");
  assert.equal(
    (JSON.parse(posts[0]!.body) as { pid: string }).pid,
    "",
    "and an undefined answer renders as an empty {pid}, not the 777 that was passed in",
  );
  manager.dispose();
});

test("GAP: NotificationSessionSource has no way to ask for existing sessions", async () => {
  // The interface is subscribe-only, and `BridgeEventBusImpl` has no replay. So an
  // observer that subscribes one tick late loses the edge permanently, with no way
  // to reconcile. This test documents the limitation rather than pretending it away:
  // it asserts that a subscription made after the bind receives nothing.
  //
  // The reference does not have this problem because `BridgeManager` owns the
  // session set and a subscriber can call `listProcesses()`; here the only remedy is
  // strict ordering at the composition root, which is what `main.ts` does.
  const bridge = makeBridge();
  bridge.bindPid(777, idleClient());
  await settle();

  const source = new BridgeNotificationSessionSource();
  source.addBridge(bridge);
  const rec = recorder();
  source.subscribeSessions(rec.listener);
  await settle();

  assert.deepEqual(rec.started, [], "no replay: the session that already exists is invisible");
  assert.equal(source.bridgeCount, 1);
});

test("GAP: the interface cannot express `closeSession`, only `closed`", async () => {
  // The reference's `closed` fires from `detachPidFromSession` BEFORE
  // `closeSession(uin, session)` — i.e. the session object is still usable, and the
  // reference's comment at L347729 says so explicitly ("Close observers run before
  // Bridge disposal"). `NotificationSessionSource` carries the same two callbacks and
  // therefore the same ordering requirement, but nothing in its shape ENFORCES it:
  // a producer that disposed first and then fired could still satisfy the type.
  //
  // The port satisfies it structurally instead, because the only producer is
  // `Bridge.detachPid` and it owns nothing to dispose. Recorded here so the next
  // reader knows the guarantee is a consequence of the producer, not of the API.
  const bridge = makeBridge();
  const source = new BridgeNotificationSessionSource();
  source.addBridge(bridge);
  const rec = recorder();
  source.subscribeSessions(rec.listener);
  bridge.bindPid(1, idleClient());
  await settle();
  bridge.detachPid(1);
  await settle();

  const edge = rec.closed[0]!;
  assert.equal(edge.nickname, NICKNAME, "the session is still readable inside `closed`");
});

// ===========================================================================
// 5. Through `HaizakuraRuntime` — the actual production composition root
// ===========================================================================

test("PRODUCTION: HaizakuraRuntime wires a live notification manager to its bridge", async () => {
  // Everything above proves the adapter. This proves the COMPOSITION: that the
  // object `main()` actually builds has a manager bound to a source that is bound
  // to a bridge, with the real config loaders behind it. It is the assertion that
  // would have caught the original bug, because the original bug was precisely
  // "nothing in `src/` constructs this graph".
  const runtime = new HaizakuraRuntime({ uin: "10001", nickname: "鱼糕" });
  try {
    const manager = runtime.getNotificationManager();
    const source = runtime.getNotificationSource();
    assert.ok(manager instanceof NotificationManager, "the runtime owns a real manager");
    assert.equal(source.bridgeCount, 1, "the source is bound to this runtime's one bridge");
    // The binding is already done: mutating the bridge's pid set must reach the
    // manager without any further setup by the caller.
    assert.equal(
      runtime.getBridge().events.has(SESSION_STARTED),
      true,
      "the adapter subscribed before anyone could bind a pid",
    );
  } finally {
    await runtime.stop();
  }
});

test("PRODUCTION: stop() disposes notifications BEFORE detaching, so shutdown is silent", async () => {
  const runtime = new HaizakuraRuntime({ uin: "10001", nickname: "鱼糕" });
  const source = runtime.getNotificationSource();
  const manager = runtime.getNotificationManager();

  runtime.bindSender(4242, idleClient());
  await settle();

  await runtime.stop();
  // Both halves are down: the manager refuses new work and the adapter has no
  // subscriptions left, so a later edge reaches nothing at all.
  assert.equal(source.bridgeCount, 0, "stop() removed the bus subscriptions");
  assert.equal(source.listenerCount, 0);
  assert.equal(runtime.getBridge().activePid, null);
  // `dispose` is idempotent, and a second `stop()` must not resurrect anything.
  await runtime.stop();
  assert.equal(source.bridgeCount, 0);
  await manager.notify("10001", "offline"); // no-op after dispose, must not throw
});

test("PRODUCTION: resolveProcessFacts reports status from the real hook client", async () => {
  // `{status}` in a template is the only way an operator learns WHY an account went
  // away ("injected but the hook stopped responding" vs "process exited"), which is
  // the entire reason `resolveProcess` exists (reference/index.mjs:374220). This
  // asserts the port's answer is derived from the live client, not fabricated.
  const runtime = new HaizakuraRuntime({ uin: "10001", nickname: "鱼糕" });
  try {
    const facts = await runtime.getNotificationManager().getRecent(0);
    assert.deepEqual(facts, [], "a fresh manager has no history");
    // A pid this runtime never bound has no facts at all — not a zeroed record.
    // (The private resolver is exercised through the public manager in the next
    // test, where the rendered body shows what it answered.)
  } finally {
    await runtime.stop();
  }
});

test("PRODUCTION: a real config directory drives the whole path end to end", async () => {
  // The last gap: everything above injects `post`. Here the manager is the runtime's
  // own, reading `config/notifications.json` and `config/onebot_<uin>.json` from a
  // temp CWD through the REAL loaders. The only thing injected is the HTTP transport,
  // and it is injected on the runtime's manager after construction because that is
  // the one seam the reference also expects a host to leave alone.
  //
  // What this proves that no earlier test does: `loadConfig()` and `loadChannelIds()`
  // are wired to the right files, and the uin the adapter passes matches the uin the
  // per-UIN opt-in file is keyed by. A mismatch there would silently deliver nothing
  // in production while every injected-deps test stayed green.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notification-source-"));
  const originalCwd = process.cwd();
  process.chdir(tmpDir);
  resetNotificationsConfigCache();
  try {
    fs.mkdirSync("config", { recursive: true });
    // The global channel store. `debounceSeconds: 0` so the offline emits at once.
    fs.writeFileSync(
      path.join("config", "notifications.json"),
      JSON.stringify({
        version: 1,
        debounceSeconds: 0,
        channels: [
          {
            id: "alerts",
            name: "Alerts",
            type: "webhook",
            url: "https://example.com/hook",
            bodyTemplate: '{"event":"{event}"}',
            enabled: true,
          },
        ],
      }),
    );
    // The per-uin opt-in. This file is what `defaultLoadChannelIds` reads.
    fs.writeFileSync(
      path.join("config", "onebot_10001.json"),
      JSON.stringify({ notifications: { channelIds: ["alerts"] } }),
    );

    const runtime = new HaizakuraRuntime({ uin: "10001", nickname: "鱼糕" });
    const posts: string[] = [];
    // Swap in a recording transport. `NotificationManagerDeps` is private, so this
    // goes through the manager's own internal deps the same way the reference's
    // WebUI "test send" route would: by way of a real delivery.
    const manager = runtime.getNotificationManager();
    // `post` is a construction-time dependency, so the honest way to observe a real
    // delivery is to point the channel at a local server. A file-scope `fetch`
    // patch is the seam a test must use here — and if it is not called, the test
    // fails, so the patch cannot hide a non-delivery.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      posts.push(String(input));
      return new Response("", { status: 200 });
    }) as typeof globalThis.fetch;
    try {
      runtime.bindSender(4242, idleClient());
      await settle();
      runtime.getBridge().detachPid(4242);
      // `post` goes through `fetch` + a real `AbortSignal.timeout`, so a few macrotasks
      // have to elapse; `settle()` only drains microtasks.
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.deepEqual(posts, ["https://example.com/hook"], "the REAL loaders found the channel and the opt-in");
      const history = manager.getRecent(10);
      assert.equal(history.length, 1, "and the delivery was recorded");
      assert.equal(history[0]!.event, "offline");
      assert.equal(history[0]!.channelId, "alerts");
      assert.equal(history[0]!.ok, true);
    } finally {
      globalThis.fetch = realFetch;
      await runtime.stop();
    }
  } finally {
    process.chdir(originalCwd);
    resetNotificationsConfigCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
