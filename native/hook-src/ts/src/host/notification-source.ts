// The adapter that makes the notification subsystem real: `Bridge.events` →
// `NotificationSessionSource`.
//
// ---------------------------------------------------------------------------
// Why this file exists
// ---------------------------------------------------------------------------
// `NotificationManager.bind()` (src/notifications/manager.ts:152) takes a
// `NotificationSessionSource` — an object with one method:
//
//     subscribeSessions(listener: { started?, closed? }): () => void
//
// In the reference that object is `BridgeManager` (reference/index.mjs:347729),
// which keeps a `Set` of subscriptions and calls `fireSessionStarted` /
// `fireSessionClosed` from its own PID bookkeeping (L347736-L347750). **This port
// has no `BridgeManager`.** The reference's manager does session creation,
// PID→UIN mapping, per-account `Bridge` construction, and shutdown draining; the
// port's `Bridge` is a single-account object and the runtime (`src/main.ts`) owns
// the PIDs. So `grep -rn subscribeSessions ts/src/` matched only the notification
// package itself, and nothing ever satisfied the interface: the whole 2,112-line
// subsystem was written, tested and dead.
//
// ---------------------------------------------------------------------------
// What the "event source" actually is, measured rather than assumed
// ---------------------------------------------------------------------------
// Before writing this adapter the bus was inventoried. What `Bridge.events`
// carries in this port:
//
//     online_devices_changed   consumed by Bridge itself (bridge.ts:176); emitted by
//                              NOTHING yet (no presence decoder — see
//                              action-context-host.ts:1516)
//     group_member_leave       emitted by `group-admin.ts:595` after a successful leave
//     group_message, friend_message, group_recall, group_admin, …   emitted by the
//                              MsgPush decoders (msg-push.ts:1828+)
//
// **None of those is a session edge**, and neither is anything in the reference's
// bus: the reference does not publish session lifecycle on its event bus at all
// (`grep -n 'events.emit(' reference/index.mjs` → two hits, both protocol events).
// It calls `fireSessionStarted`/`fireSessionClosed` directly.
//
// So an adapter over "the existing event stream" would have had nothing to adapt.
// The honest fix is two-sided, and that is what this change is:
//
//   1. `Bridge.bindPid` / `Bridge.detachPid` now PUBLISH the two edges onto their
//      own bus (`session_started` / `session_closed`). They are the only places a
//      session can begin or end, so publishing there cannot miss an edge — unlike
//      a subscription bolted on somewhere else, which is exactly how the port has
//      previously ended up with green tests and no wiring.
//   2. This adapter subscribes to those two kinds per bridge and fans them out to
//      `NotificationSessionSource` listeners, in the reference's order and with
//      the reference's error isolation.
//
// ---------------------------------------------------------------------------
// Where each field of the callback comes from, and why the payload carries `pid`
// ---------------------------------------------------------------------------
// `started(uin, bridge)`  uin = `bridge.identity.uin`; the session object is the
//                         `Bridge` itself, which already satisfies
//                         `NotificationSession` (`identity.nickname`, `activePid`).
// `closed(uin, bridge, pid)`  pid = the pid that went away, taken from the EVENT
//                         payload. It cannot be read off the bridge: by the time
//                         the last connection is gone, `bridge.activePid` is
//                         already `null`, and the notification wants to say which
//                         process disappeared. The reference has the same
//                         constraint and solves it the same way — it passes `pid`
//                         as a separate argument (L347743) because
//                         `detachPidFromSession` has already deleted the mapping.
//
// The reference fires `closed` *before* `closeSession(uin, session)`
// (L347919-L347920), which is why the session object is still readable inside the
// callback ("Close observers run before Bridge disposal"). This adapter keeps the
// same ordering for free: the bus event is emitted from `detachPid` *before* the
// caller disposes anything, and listeners run from that emission.
//
// ---------------------------------------------------------------------------
// Why subscribe per-bridge with `on(kind)` and not a global `onAny`
// ---------------------------------------------------------------------------
// `onAny` would run this handler for every `group_message` too — the bus is the
// same one carrying chat traffic, which on a busy account is hundreds of events a
// minute. Two `on(kind)` registrations per bridge cost nothing per chat event and
// make the subscription set exactly the two kinds this module understands.
//
// ---------------------------------------------------------------------------
// One adapter, N bridges
// ---------------------------------------------------------------------------
// The port runs one account per `Bridge`, so a multi-account deployment has N
// bridges and one notification manager (the manager keys everything by uin, which
// is what makes a single manager correct for a multi-account host). `addBridge`
// therefore keys the subscription by `identity.uin` and replaces any previous
// registration for that uin — a re-registration must not double-deliver, the same
// rule `NotificationManager.bind` follows for its own listener.

import type { BridgeEvent, BridgeEventBus } from "../bridge/context.js";
import { SESSION_CLOSED, SESSION_STARTED } from "../bridge/bridge.js";
import { createLogger, errorMessage } from "../onebot/log.js";
import type { NotificationSession, NotificationSessionSource } from "../notifications/types.js";

const log = createLogger("Host.Notifications");

/**
 * The two session-lifecycle kinds `Bridge` publishes, re-exported.
 *
 * The constants live in `bridge.ts` next to the code that emits them, so a
 * producer and this consumer cannot drift on a string literal. Re-exported here
 * because a caller wiring this adapter up should not have to import from the
 * bridge layer just to name the events it is subscribing to.
 */
export const SESSION_EVENT_KINDS = [SESSION_STARTED, SESSION_CLOSED] as const;

export type SessionEventKind = (typeof SESSION_EVENT_KINDS)[number];

/**
 * The slice of `Bridge` this adapter needs. Structural on purpose: `Bridge`
 * satisfies it, and so does a two-line fake in a test, so the adapter is testable
 * without a packet client, an identity roster, or a socket.
 */
export interface SessionBridge {
  /**
   * `uin` is what the manager keys by; `nickname` is what the template renders.
   * Both are read at fire time, not captured at registration, because a session
   * that has not resolved its profile yet reports `""` and later resolves.
   */
  readonly identity: { readonly nickname: string; readonly uin: string };
  /** `null` while no hook process is bound. Read at fire time. */
  readonly activePid: number | null;
  readonly events: BridgeEventBus;
}

/**
 * A registered observer. Same shape as the parameter of
 * `NotificationSessionSource.subscribeSessions`, restated here so this module does
 * not depend on that inline type's identity.
 *
 * The function types are `void`-returning: the manager's listeners are
 * synchronous and the reference's `fireSession*` does not await them.
 */
export interface SessionListener {
  started?: (uin: string, session: NotificationSession) => void;
  closed?: (uin: string, session: NotificationSession, pid: number | null) => void;
}

/** One bridge's registration, with the teardown that removes both subscriptions. */
interface Registration {
  readonly bridge: SessionBridge;
  readonly detach: () => void;
}

export class BridgeNotificationSessionSource implements NotificationSessionSource {
  private readonly listeners = new Set<SessionListener>();
  private readonly registrations = new Map<string, Registration>();

  /**
   * Start observing one bridge's session edges.
   *
   * Re-registering the same uin first drops the previous subscriptions: two live
   * registrations for one account would deliver every edge twice, and a doubled
   * offline/online pair is exactly what the debounce machine cannot fix (it
   * suppresses *pairs*, not duplicates).
   *
   * Call this BEFORE the first `bindPid`/`detachPid` on the bridge, or the edges
   * that happen in between are lost — the bus has no replay. `main.ts` does it in
   * the runtime's constructor for that reason.
   */
  addBridge(bridge: SessionBridge): void {
    const uin = bridge.identity.uin;
    this.removeBridge(uin);
    const detachStarted = bridge.events.on(SESSION_STARTED, (event) => {
      this.onSessionStarted(uin, bridge, event);
    });
    const detachClosed = bridge.events.on(SESSION_CLOSED, (event) => {
      this.onSessionClosed(uin, bridge, event);
    });
    this.registrations.set(uin, {
      bridge,
      detach: () => {
        detachStarted();
        detachClosed();
      },
    });
  }

  /** Stop observing one account. Unknown uins are a no-op, so shutdown can be unconditional. */
  removeBridge(uin: string): void {
    const registration = this.registrations.get(uin);
    if (!registration) return;
    registration.detach();
    this.registrations.delete(uin);
  }

  /**
   * The `NotificationSessionSource` method. The returned function removes exactly
   * this listener and is safe to call twice — `NotificationManager.bind` calls the
   * previous handle on every rebind (`manager.ts:154`) and `dispose` calls it again.
   */
  subscribeSessions(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** How many bridges are observed. Diagnostics and tests; no production caller. */
  get bridgeCount(): number {
    return this.registrations.size;
  }

  /** How many observers are registered. Diagnostics and tests. */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /**
   * Drop every observer and every subscription. Idempotent.
   *
   * Listeners go first so a shutdown cannot fan out into a manager that is already
   * disposed, then the bus subscriptions are removed so a `Bridge` outliving this
   * adapter does not keep dispatching into it.
   */
  dispose(): void {
    this.listeners.clear();
    for (const uin of [...this.registrations.keys()]) this.removeBridge(uin);
  }

  // -------------------------------------------------------------------------
  // Bus → listener translation
  // -------------------------------------------------------------------------

  private onSessionStarted(uin: string, bridge: SessionBridge, event: BridgeEvent): void {
    const fromEvent = readUin(event);
    if (fromEvent !== null && fromEvent !== uin) {
      // The bus event and the bridge disagree about which account this is. The
      // bridge's own identity is authoritative (it is what `sendRawPacket` and the
      // OIDB specs use); a mismatched payload means a producer bug, so it is logged
      // and the event is still delivered under the bridge's uin rather than
      // dropped — a notification about the wrong-but-real account is recoverable,
      // a silently missing one is not.
      log.warn(
        "session_started payload uin=%s disagrees with bridge uin=%s; using the bridge's",
        fromEvent,
        uin,
      );
    }
    const session: NotificationSession = sessionView(bridge);
    this.fanOut("started", (listener) => listener.started?.(uin, session));
  }

  private onSessionClosed(uin: string, bridge: SessionBridge, event: BridgeEvent): void {
    const pid = readPid(event, bridge);
    const session: NotificationSession = sessionView(bridge);
    this.fanOut("closed", (listener) => listener.closed?.(uin, session, pid));
  }

  /**
   * Call one method on every observer, isolating each one the way the reference's
   * `fireSessionStarted`/`fireSessionClosed` do (`try` per listener, log at warn).
   *
   * The snapshot matters: a listener that unsubscribes (or binds a second manager)
   * inside its own callback must not change who receives THIS edge — the same rule
   * `BridgeEventBusImpl.emit` follows.
   */
  private fanOut(kind: "started" | "closed", call: (listener: SessionListener) => void): void {
    for (const listener of [...this.listeners]) {
      try {
        call(listener);
      } catch (error) {
        log.warn("session-%s listener threw: %s", kind, errorMessage(error));
      }
    }
  }
}

/**
 * The session object handed to listeners: the bridge itself, narrowed.
 *
 * `Bridge` already satisfies `NotificationSession` (`identity.nickname` +
 * `activePid`), so this is a cast with no copy — deliberately. A snapshot copy
 * would freeze `activePid` at fire time, but the manager reads it once anyway; what
 * must NOT be frozen is `identity.nickname`, which the manager falls back on when a
 * session reports `""` (manager.ts:168 uses the cached value in that case, so a
 * stale copy would be indistinguishable — but a copy would also be a lie about
 * liveness).
 */
function sessionView(bridge: SessionBridge): NotificationSession {
  return bridge;
}

/** `event.uin` when it is a non-empty string; `null` otherwise. */
function readUin(event: BridgeEvent): string | null {
  const raw = event["uin"];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * `event.pid` when it is a positive safe integer; `null` otherwise.
 *
 * `null` is a legitimate answer — `NotificationSession.activePid` is `null` while
 * no hook process is bound, and the manager accepts `pid: number | null`
 * (manager.ts:157). A malformed payload therefore degrades to "unknown pid",
 * which renders as an empty `{pid}` in the template, instead of aborting the
 * notification the operator actually needs.
 */
function readPid(event: BridgeEvent, bridge: SessionBridge): number | null {
  const raw = event["pid"];
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0) return raw;
  // No usable payload pid: the bridge's own view is already `null` by now if this
  // was the last connection, so this is only the "another connection remains"
  // case, where reporting the active pid is accurate.
  return bridge.activePid;
}

/**
 * The production wiring, in one call: build the adapter, register the bridges,
 * hand it to a manager.
 *
 * `NotificationManager.bind` is called by the caller, not here, because the
 * reference's ordering comment (manager.ts:143) is load-bearing: register AFTER
 * the OneBot layer so the nickname fallback is populated. A helper that also bound
 * would make that ordering invisible and impossible to get wrong in the right
 * direction.
 */
export function createBridgeNotificationSessionSource(
  bridges: Iterable<SessionBridge> = [],
): BridgeNotificationSessionSource {
  const source = new BridgeNotificationSessionSource();
  for (const bridge of bridges) source.addBridge(bridge);
  return source;
}
