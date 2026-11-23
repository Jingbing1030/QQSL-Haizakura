// The notification orchestrator: session edges → debounce → render → deliver →
// history.
//
// Reference region: src/notifications/manager.ts L348541-L348820 (280 lines).
//
// ---------------------------------------------------------------------------
// The design seam: `resolveProcess` is injected
// ---------------------------------------------------------------------------
// `createNotificationManager(resolveProcess)` takes the one piece of runtime
// knowledge this package must not have. The reference passes an async closure over
// `hookManager.listProcesses()` (L374221) so the notification can say *why* an
// account went away ("injected but the hook stopped responding" vs "process exited").
// A relative import of the hook manager here would make `notifications/` depend on
// the whole hook/process layer, so the dependency is a callback instead — the same
// reason `Bridge.identity` is injected.
//
// ---------------------------------------------------------------------------
// Three independent failure-containment rules
// ---------------------------------------------------------------------------
// A notification is a *side effect of a session edge*. It must never be able to
// break the edge itself, so:
//
// 1. **`notify` never rejects into its caller.** It returns the promise, but every
//    path inside `notifyNow` that can throw (config load, `resolveProcess`, per-channel
//    delivery) is caught and logged. `deliver` has a second `try` of its own, so even
//    a transport that violates its "never throws" contract (an injected test double)
//    is contained.
//
// 2. **Deliveries for one uin are serialized, and only one-at-a-time.** `deliveries`
//    holds the tail promise per uin, so a `schedule`-fired offline and a manual
//    `testSend` cannot interleave their `RCPT TO` exchanges. Note the chain is keyed
//    by uin, not global: one slow webhook does not delay a different account.
//
// 3. **`disposed` is checked at four points**, not one. `bind`, `handleOnline`,
//    `handleOffline`, `notify` and the per-channel loop all re-check it, because a
//    `dispose()` can land between any two of them — in particular between the config
//    read and the first POST, which is exactly when a shutdown is likely to arrive.
//
// ---------------------------------------------------------------------------
// Why the timers map and the debounce machine's state map are separate
// ---------------------------------------------------------------------------
// The machine answers "what should happen", the manager owns the `setTimeout`. The
// timer handle is removed from `timers` *before* `onTimerElapsed` is consulted
// (L348607), so `dispose()` cannot clear a timer that has already fired and the map
// does not retain a dead handle.
//
// `timer.unref()` is load-bearing: a pending debounce must not be the reason the
// process stays alive. Without it, a 30-second window on a single-event script would
// delay exit by up to 30 seconds.
//
// ---------------------------------------------------------------------------
// History is a ring buffer, and it is *not* persisted
// ---------------------------------------------------------------------------
// `history` is a plain array trimmed from the front at `historyLimit` (default 100).
// Deliberately in-memory only: it exists to answer the WebUI's "did my webhook
// fire?" panel, which is a diagnostic, and writing SMTP/HTTP results to disk would
// put recipient addresses in a log file the operator did not ask for.

import { DebounceMachine, type DebounceDecision } from "./debounce.js";
import { isEmailChannel, loadNotificationsConfig, renderTemplate } from "./config.js";
import { loadOneBotConfig } from "../onebot/config.js";
import {
  formatSmtpError,
  parseRecipients,
  sendSmtpMail,
  type SmtpMailMessage,
} from "./smtp.js";
import { createLogger, errorMessage } from "../onebot/log.js";
import { positiveIntEnv } from "../bridge/env.js";
import type {
  DeliveryRecord,
  DeliveryResult,
  EmailChannel,
  NotificationChannel,
  NotificationEvent,
  NotificationMail,
  NotificationPost,
  NotificationProcessFacts,
  NotificationSendMail,
  NotificationSessionSource,
  TestSendResult,
} from "./types.js";

const log = createLogger("Notifications");

const DEFAULT_HISTORY_LIMIT = 100;
const DEFAULT_POST_TIMEOUT_MS = 10_000;
const DEFAULT_SMTP_TIMEOUT_MS = 15_000;

/** What the manager needs from its owner. Every member is a seam a test can replace. */
export interface NotificationManagerDeps {
  /** `loadNotificationsConfig` in production. Called per notification, not cached here. */
  readonly loadConfig: () => { readonly debounceSeconds: number; readonly channels: readonly NotificationChannel[] };
  /** `loadOneBotConfig(uin).notifications?.channelIds ?? []` — the per-UIN opt-in. */
  readonly loadChannelIds: (uin: string) => readonly string[];
  readonly post: NotificationPost;
  /** Absent when email delivery is not wired up; `deliver` then reports "not configured". */
  readonly sendMail?: NotificationSendMail | undefined;
  readonly now: () => number;
  readonly resolveProcess?:
    | ((uin: string, pid: number | null) => Promise<NotificationProcessFacts | undefined>)
    | undefined;
  readonly historyLimit?: number | undefined;
}

/**
 * Pure: the channels a UIN should be notified through — globally enabled AND
 * opted into by the UIN — preserving config order. Exported for unit tests.
 *
 * Both conditions are required, and neither is a default: a channel that is enabled
 * but not listed in the UIN's `channelIds` is silent, and one that is listed but
 * disabled is silent too. That is what makes "disable this channel globally" a
 * safe kill switch without editing every account.
 *
 * Order is `channels`-config order, not `enabledIds` order, so a webhook and an
 * email channel always deliver in the same sequence regardless of how each account
 * listed them.
 */
export function selectChannels(
  channels: readonly NotificationChannel[],
  enabledIds: readonly string[],
): NotificationChannel[] {
  const wanted = new Set(enabledIds);
  return channels.filter((c) => c.enabled && wanted.has(c.id));
}

export class NotificationManager {
  private readonly deps: NotificationManagerDeps;
  private readonly machine = new DebounceMachine();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly accounts = new Map<string, { nickname: string; pid: number | null }>();
  private readonly history: DeliveryRecord[] = [];
  private readonly deliveries = new Map<string, Promise<void>>();
  private readonly historyLimit: number;
  private disposed = false;
  private unsubscribeSessions: (() => void) | null = null;

  constructor(deps: NotificationManagerDeps) {
    this.deps = deps;
    this.historyLimit = deps.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  }

  /**
   * Subscribe to the global session online/offline edges. Register AFTER
   * OneBotManager so the nickname fallback is already populated.
   *
   * Re-binding unsubscribes first (`?.()`) so a second `bind` does not double-
   * deliver every edge. `disposed` is checked before the unsubscribe so a
   * post-dispose `bind` is a complete no-op — re-subscribing a disposed manager
   * would leak a listener into a long-lived bus.
   */
  bind(bridgeManager: NotificationSessionSource): void {
    if (this.disposed) return;
    this.unsubscribeSessions?.();
    this.unsubscribeSessions = bridgeManager.subscribeSessions({
      started: (uin, bridge) => this.handleOnline(uin, bridge.identity.nickname, bridge.activePid),
      closed: (uin, bridge, pid) => this.handleOffline(uin, bridge.identity.nickname, pid),
    });
  }

  private handleOnline(uin: string, nickname: string, pid: number | null = null): void {
    if (this.disposed) return;
    this.accounts.set(uin, {
      // `nickname || cached || uin` — a session that has not resolved its profile yet
      // reports `""`, and falling back to the uin keeps the message renderable. The
      // cached value is preferred over the uin so a re-login that has not yet
      // resolved profile info keeps the name the operator recognizes.
      nickname: nickname || this.accounts.get(uin)?.nickname || uin,
      pid,
    });
    this.apply(uin, this.machine.onOnline(uin));
  }

  private handleOffline(uin: string, nickname: string, pid: number | null = null): void {
    if (this.disposed) return;
    let debounceSeconds: number;
    try {
      debounceSeconds = this.deps.loadConfig().debounceSeconds;
    } catch (err) {
      // A config that will not load is not a reason to guess a debounce window: the
      // machine would arm a timer against a value we do not have. Skip the edge.
      log.warn("offline(%s) skipped — config load failed: %s", uin, errorMessage(err));
      return;
    }
    this.accounts.set(uin, {
      nickname: nickname || this.accounts.get(uin)?.nickname || uin,
      pid,
    });
    this.apply(uin, this.machine.onOffline(uin, debounceSeconds));
  }

  /**
   * Translate one decision into a timer operation or a delivery.
   *
   * `void this.notify(...)` is deliberate: `apply` is called from a synchronous
   * session listener, and awaiting would make the listener async — which the
   * reference's `fireSessionStarted` does not do (it calls the listener
   * synchronously and only catches a *synchronous* throw). The delivery promise is
   * tracked in `deliveries` for serialization instead.
   */
  private apply(uin: string, decision: DebounceDecision): void {
    switch (decision.kind) {
      case "schedule": {
        const timer = setTimeout(() => {
          // Deleted before consulting the machine, so the map never holds a
          // fired handle — see the file header.
          this.timers.delete(uin);
          this.apply(uin, this.machine.onTimerElapsed(uin));
        }, decision.delayMs);
        timer.unref();
        this.timers.set(uin, timer);
        break;
      }
      case "cancel":
        clearTimeout(this.timers.get(uin));
        this.timers.delete(uin);
        break;
      case "emit":
        void this.notify(uin, decision.event);
        break;
      case "none":
        break;
    }
  }

  /**
   * Queue one transition; channel failures are recorded independently.
   *
   * The `.finally` compares the stored tail against this delivery before deleting,
   * so a *newer* queued delivery is not removed by an older one settling. Without
   * the identity check, two events in the same tick would drop the second from the
   * map and lose its serialization.
   */
  notify(uin: string, event: NotificationEvent): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const account = this.accounts.get(uin) ?? { nickname: uin, pid: null };
    const delivery = (this.deliveries.get(uin) ?? Promise.resolve())
      .then(() => this.notifyNow(uin, event, account))
      .finally(() => {
        if (this.deliveries.get(uin) === delivery) this.deliveries.delete(uin);
      });
    this.deliveries.set(uin, delivery);
    return delivery;
  }

  private async notifyNow(
    uin: string,
    event: NotificationEvent,
    account: { nickname: string; pid: number | null },
  ): Promise<void> {
    if (this.disposed) return;
    let channels: NotificationChannel[];
    try {
      channels = selectChannels(this.deps.loadConfig().channels, this.deps.loadChannelIds(uin));
    } catch (err) {
      // Both loads are guarded together because either one failing means we do not
      // know the target set. `loadChannelIds` throws on a corrupt per-UIN file.
      log.warn("notify(%s, %s) skipped — config load failed: %s", uin, event, errorMessage(err));
      return;
    }
    if (channels.length === 0) return;

    let facts: NotificationProcessFacts | undefined;
    try {
      facts = await this.deps.resolveProcess?.(uin, account.pid);
    } catch (err) {
      // Deliberately swallowed: the process facts are *decorative* (`{status}`,
      // `{pid}`, `{error}` in the template). A failed lookup must not suppress the
      // notification — the operator still needs to know the account went away.
      log.warn("resolveProcess(%s, %s) failed: %s", uin, account.pid, errorMessage(err));
    }

    const vars: Record<string, string> = {
      uin,
      nickname: account.nickname,
      event,
      time: new Date(this.deps.now()).toISOString(),
      status: facts?.status ?? "",
      // `undefined` becomes `""` rather than `"undefined"`: `String(undefined)` in a
      // template would be worse than an obviously-missing value.
      pid: facts?.pid === undefined ? "" : String(facts.pid),
      error: facts?.error ?? "",
    };

    for (const ch of channels) {
      if (this.disposed) return;
      const result = await this.deliver(ch, vars);
      this.record({
        time: this.deps.now(),
        uin,
        event,
        channelId: ch.id,
        ok: result.ok,
        status: result.status,
        // `undefined` on success (not `""`) so the WebUI can render "—" and a
        // truthiness check works. The fallback chain covers a transport that reports
        // neither `error` nor `status`.
        error: result.ok
          ? undefined
          : (result.error ?? (result.status ? `HTTP ${result.status}` : "delivery failed")),
      });
      if (!result.ok) {
        log.warn(
          "notify %s→%s channel=%s failed: %s",
          uin,
          event,
          ch.id,
          result.error ?? `HTTP ${result.status ?? "?"}`,
        );
      }
    }
  }

  /**
   * Render and send one channel. Never throws — a thrown transport becomes `{ok:false}`.
   *
   * The `try` wraps the *channel-type* branch too, not just the transport call, so a
   * malformed channel object (impossible through `normalizeChannel`, but a caller can
   * construct `NotificationManager` with its own config loader) cannot escape either.
   *
   * `renderTemplate` is called twice for email — subject and body — with the same
   * vars. Rendering once and reusing would be wrong: the two templates are separate
   * operator fields.
   */
  private async deliver(ch: NotificationChannel, vars: Record<string, string>): Promise<DeliveryResult> {
    try {
      if (isEmailChannel(ch)) return await this.deliverEmail(ch, vars);
      // Header merging for webhooks happens in `createDefaultPost`, which is where
      // `Content-Type` has to win over an operator header of the same name.
      return await this.deps.post(ch.url, renderTemplate(ch.bodyTemplate, vars), ch.headers);
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  private async deliverEmail(ch: EmailChannel, vars: Record<string, string>): Promise<DeliveryResult> {
    const send = this.deps.sendMail;
    if (!send) return { ok: false, error: "email delivery is not configured" };
    return await send({
      host: ch.smtpHost,
      port: ch.smtpPort,
      secure: ch.smtpSecure,
      user: ch.smtpUser,
      pass: ch.smtpPass,
      from: ch.from,
      to: ch.to,
      subject: renderTemplate(ch.subjectTemplate, vars),
      text: renderTemplate(ch.bodyTemplate, vars),
    });
  }

  /**
   * Send a one-off test to a single channel by id — ignores `enabled` and the
   * per-UIN opt-in (you test a channel before wiring it up), with sample
   * variables. Reuses the real render+deliver path; NOT recorded to history.
   * `found: false` means the channel id is unknown.
   *
   * Sample values are fixed (`uin: "10000"`, `nickname: "测试账号"`) so a test send
   * is recognizable in the receiving chat and identical across runs — an operator
   * checking a template against a real channel sees the same message twice.
   *
   * The config-load failure case returns `found: false` rather than `ok: false`
   * alone: the WebUI's 404 branch ("渠道不存在") is the honest answer when the store
   * cannot be read, because we cannot claim the channel exists.
   */
  async testSend(channelId: string): Promise<TestSendResult> {
    let channel: NotificationChannel | undefined;
    try {
      channel = this.deps.loadConfig().channels.find((c) => c.id === channelId);
    } catch (err) {
      return { ok: false, found: false, error: errorMessage(err) };
    }
    if (!channel) return { ok: false, found: false };
    const vars: Record<string, string> = {
      uin: "10000",
      nickname: "测试账号",
      event: "offline",
      time: new Date(this.deps.now()).toISOString(),
      status: "disconnected",
      pid: "1234",
      error: "",
    };
    return { ...(await this.deliver(channel, vars)), found: true };
  }

  private record(rec: DeliveryRecord): void {
    this.history.push(rec);
    // `splice` from the front rather than `shift()` in a loop: one call, and the
    // bound is exact even if the limit was lowered at construction.
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }
  }

  /**
   * Most-recent-first delivery history (capped at the buffer size).
   *
   * `Math.trunc(limit) || 0` maps a non-numeric or `0` limit to "nothing"; the
   * clamp to `history.length` is what stops `slice(-1000)` from silently returning
   * everything on a short buffer. A negative limit is clamped to `0` — `slice(-(-5))`
   * would otherwise be `slice(5)` and return from the wrong end.
   */
  getRecent(limit: number = this.historyLimit): DeliveryRecord[] {
    const n = Math.max(0, Math.min(Math.trunc(limit) || 0, this.history.length));
    return this.history.slice(this.history.length - n).reverse();
  }

  /**
   * Release timers and the session subscription. Idempotent.
   *
   * In-flight deliveries are NOT awaited: `dispose` is synchronous (the reference's
   * shutdown calls it without `await`, L374248) and a hung webhook would otherwise
   * block exit. The per-channel `disposed` check above is what stops a delivery from
   * continuing past the current channel.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeSessions?.();
    this.unsubscribeSessions = null;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

/**
 * Default outbound POST: a single attempt with a timeout, JSON content-type
 * (the common case for 钉钉/Discord/飞书). Never throws.
 *
 * One attempt only — no retry. A retry would double-post to the receivers listed
 * above (none of which are idempotent), and the history entry plus the warn line
 * are the operator's signal. `AbortSignal.timeout` is used rather than a
 * `setTimeout` + `controller.abort()` pair because it cannot leak a timer.
 *
 * The operator's headers are spread *after* `Content-Type`, so an explicit
 * `Content-Type` in the channel config wins. That is the reference's order (L348764)
 * and it is the useful one: a receiver that wants `application/vnd.api+json` must be
 * able to say so.
 */
export function createDefaultPost(
  timeoutMs: number = positiveIntEnv("SNOWLUMA_NOTIFICATION_HTTP_TIMEOUT_MS", DEFAULT_POST_TIMEOUT_MS),
): NotificationPost {
  return async (url, body, headers) => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { ok: res.ok, status: res.status, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err) {
      // Includes `TimeoutError` from the abort signal and `TypeError` from a bad URL.
      // `errorMessage` never throws, which matters here — this is the last frame
      // before the failure would reach the message path.
      return { ok: false, error: errorMessage(err) };
    }
  };
}

/**
 * Default SMTP send. Never throws.
 *
 * `mail.to` arrives as the operator's raw list and is re-parsed here rather than
 * trusted: `normalizeTo` already normalized it, but an injected `NotificationMail`
 * (a test, or a future caller) may carry a hand-built string.
 *
 * `formatSmtpError` is what turns a `535` into "SMTP 认证失败" and a self-signed
 * certificate into "证书不受信任" — the raw messages name neither the host nor the
 * actionable cause.
 */
export function createDefaultSendMail(timeoutMs: number = DEFAULT_SMTP_TIMEOUT_MS): NotificationSendMail {
  return async (mail: NotificationMail) => {
    try {
      const message: SmtpMailMessage = {
        host: mail.host,
        port: mail.port,
        secure: mail.secure,
        user: mail.user,
        pass: mail.pass,
        from: mail.from,
        to: parseRecipients(mail.to),
        subject: mail.subject,
        body: mail.text,
      };
      await sendSmtpMail(message, { timeoutMs });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: formatSmtpError(err, mail.host, mail.port) };
    }
  };
}

/**
 * The production per-UIN opt-in: `loadOneBotConfig(uin).notifications?.channelIds ?? []`.
 *
 * Wrapped rather than inlined so the whole `onebot/config` dependency is one
 * function. `loadOneBotConfig` *throws* on a corrupt per-UIN file (that file is
 * machine-written, so corruption is a real bug — see `onebot/config.ts`'s header),
 * and `notifyNow` catches it and skips the notification rather than crashing the
 * session edge.
 *
 * `configDir` is not threaded through: the reference hardcodes the process-relative
 * `"config"` directory and this port has the same default. A test that needs a
 * different directory injects `loadChannelIds` directly.
 */
function defaultLoadChannelIds(uin: string): readonly string[] {
  return loadOneBotConfig(uin).notifications?.channelIds ?? [];
}

/**
 * The real, fully-wired singleton. `resolveProcess` is supplied by the runtime —
 * this package deliberately knows nothing about HookManager.
 *
 * `loadChannelIds` is the one import that reaches outside this subtree, and it is
 * the *only* per-UIN knowledge the notification feature has: which channels an
 * account opted into lives in `config/onebot_<uin>.json`, next to the account it
 * belongs to, not in `notifications.json`. That split is what lets an operator wire
 * up a channel once and then opt accounts in one at a time.
 *
 * `loadOneBotConfig` is imported lazily by the caller in the reference (it is a
 * top-level `init_onebot_config()` there, i.e. eagerly). Here it is a static import
 * of `onebot/config.js`; the module has no import back into `notifications/`, so
 * there is no cycle to break.
 */
export function createNotificationManager(
  resolveProcess?: (uin: string, pid: number | null) => Promise<NotificationProcessFacts | undefined>,
  deps?: Partial<NotificationManagerDeps>,
): NotificationManager {
  return new NotificationManager({
    loadConfig: deps?.loadConfig ?? loadNotificationsConfig,
    loadChannelIds: deps?.loadChannelIds ?? defaultLoadChannelIds,
    post: deps?.post ?? createDefaultPost(),
    sendMail: deps?.sendMail ?? createDefaultSendMail(),
    now: deps?.now ?? (() => Date.now()),
    ...(resolveProcess === undefined ? {} : { resolveProcess }),
    ...(deps?.historyLimit === undefined ? {} : { historyLimit: deps.historyLimit }),
  });
}
