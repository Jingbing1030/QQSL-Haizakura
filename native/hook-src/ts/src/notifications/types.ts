// Shared types for the notification subsystem.
//
// Reference regions:
//   ../common/src/notification-templates.ts  L347941-L347953  the two body defaults
//   ../common/src/coerce.ts                  L174-L196       clampInt / boolOr / isObject
//   src/notifications/config.ts              L348244-L348497 channel + config types
//   src/notifications/manager.ts             L348541-L348820 manager deps and results
//
// The reference has no `types.ts`: every interface below is declared inline next to
// the function that consumes it, and the bundle flattens all four modules into one
// scope so nothing has to name a common home. A TypeScript port cannot flatten, so
// the shapes that cross a module boundary live here. Everything that does NOT cross
// a boundary stays in its own module deliberately — `SmtpMailMessage` and
// `SendSmtpMailOptions` (the SMTP client's own API) are in `smtp.ts`, because that
// module is the one thing in this subtree the reference describes as dependency-free
// and it should stay that way.
//
// ---------------------------------------------------------------------------
// Why `channel` is a discriminated union and not one wide interface
// ---------------------------------------------------------------------------
// The two channel kinds share `id`/`name`/`enabled`/`bodyTemplate` and nothing else
// that matters: a webhook has a URL and headers, an email has an SMTP endpoint and
// recipients. A single interface with nine optional fields would let
// `normalizeChannel` return an email channel with no `smtpHost` and still typecheck —
// and `deliver` would then POST to `undefined`. The reference narrows with
// `isEmailChannel()` (§348263); the union makes the same narrowing structural, so
// the runtime check and the type check cannot drift apart.
//
// `EmailChannel.url` is `""` rather than absent because `toJsonObject`-style
// round-tripping (`saveNotificationsConfig`) hands the object straight to the WebUI,
// which renders one row shape. The reference writes `url: ""` for email channels
// (L348372) and keeps the field, so a stored config has the same keys regardless of
// `type`. Kept as-is: dropping it would make the WebUI's generic table render
// `undefined`.
//
// ---------------------------------------------------------------------------
// Why `smtpUser` / `smtpPass` / `headers` / `error` are `x | undefined` and not
// just optional
// ---------------------------------------------------------------------------
// `exactOptionalPropertyTypes: true` makes `foo?: string` mean "may be absent, but
// never present-and-undefined". The reference builds these objects with a
// conditional spread (`...(smtpUser ? { smtpUser } : {})`, L348378) *and* assigns
// `undefined` explicitly elsewhere (`error: result.ok ? void 0 : ...`, L348672).
// Both spellings have to type, so the optional fields that are ever written as
// `undefined` carry the explicit `| undefined`. The ones only ever written by
// conditional spread do not need it, but keeping one convention across the file is
// worth more than the three characters it saves.

/** The two channel kinds. `type` is absent-means-webhook (L348349). */
export type NotificationChannelType = "email" | "webhook";

/**
 * The account-state transitions worth telling a human about.
 *
 * Not a session-state enum: it is the *edge*, which is why the debounce machine
 * answers with one of these rather than with `"pending"`/`"offline"`.
 */
export type NotificationEvent = "online" | "offline";

/** A webhook channel: one HTTP POST per event. */
export interface WebhookChannel {
  readonly id: string;
  readonly name: string;
  readonly type: "webhook";
  /** Normalized `http:`/`https:` URL — validated by `normalizeChannel`. */
  readonly url: string;
  readonly bodyTemplate: string;
  readonly enabled: boolean;
  /** Extra request headers. Absent when the config had none usable. */
  readonly headers?: Record<string, string> | undefined;
}

/** An email channel: one SMTP transaction per event. */
export interface EmailChannel {
  readonly id: string;
  readonly name: string;
  readonly type: "email";
  /**
   * Always `""`. Present so both channel kinds render with the same keys — see the
   * file header.
   */
  readonly url: string;
  readonly bodyTemplate: string;
  readonly enabled: boolean;
  readonly smtpHost: string;
  /** Resolved at normalize time: an absent port becomes 465 (implicit TLS) or 587. */
  readonly smtpPort: number;
  /** `true` for implicit TLS (`smtps`), `false` for plaintext + optional STARTTLS. */
  readonly smtpSecure: boolean;
  readonly smtpUser?: string | undefined;
  readonly smtpPass?: string | undefined;
  /** The `From:` header value, already validated to contain a usable address. */
  readonly from: string;
  /** Comma-joined, de-duplicated recipient list (L348347). */
  readonly to: string;
  readonly subjectTemplate: string;
}

export type NotificationChannel = WebhookChannel | EmailChannel;

/**
 * `config/notifications.json`.
 *
 * `version` is the literal `1` rather than `number` because the normalizer always
 * writes `1` and never reads the incoming value (L348425) — a future `version: 2`
 * must be a compile-time change, not a silently-accepted file.
 */
export interface NotificationsConfig {
  readonly version: 1;
  /** Seconds to wait before an offline event fires. `0` disables the debounce. */
  readonly debounceSeconds: number;
  readonly channels: readonly NotificationChannel[];
}

/** How one delivery attempt ended. Never thrown — see `manager.deliver`. */
export interface DeliveryResult {
  readonly ok: boolean;
  /** HTTP status for webhooks. Absent for the SMTP path. */
  readonly status?: number | undefined;
  /** Human-readable failure, already localized by `formatSmtpError` for SMTP. */
  readonly error?: string | undefined;
}

/** One row of the bounded, most-recent-first delivery history. */
export interface DeliveryRecord {
  /** Epoch ms, from `deps.now()`. */
  readonly time: number;
  readonly uin: string;
  readonly event: NotificationEvent;
  readonly channelId: string;
  readonly ok: boolean;
  readonly status?: number | undefined;
  /** Only set when `ok` is false: `undefined` on success, not `""`. */
  readonly error?: string | undefined;
}

/** `testSend`'s answer: `found: false` means the channel id is unknown. */
export interface TestSendResult extends DeliveryResult {
  readonly found: boolean;
}

/**
 * What the runtime's process registry says about the account behind a notification.
 *
 * A structural subset of the hook manager's process record. The reference passes
 * `{ status, pid, error }` out of `hookManager.listProcesses()` (L374221-374227);
 * modelling only those three fields is what keeps this package free of a
 * `HookManager` import.
 */
export interface NotificationProcessFacts {
  readonly status?: string | undefined;
  readonly pid?: number | undefined;
  readonly error?: string | undefined;
}

/**
 * A rendered mail, as `deps.sendMail` receives it.
 *
 * `to` is the raw comma/semicolon/newline list from the channel config, *not* a
 * parsed array: `createDefaultSendMail` runs it through `parseRecipients` so a
 * hand-edited `to` with a stray `;` still works, and an injected transport (a test,
 * a future SMTP pool) receives the operator's string unmodified.
 */
export interface NotificationMail {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user?: string | undefined;
  readonly pass?: string | undefined;
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** The outbound POST seam. Must never reject — `deliver` also guards, belt and braces. */
export type NotificationPost = (
  url: string,
  body: string,
  headers?: Record<string, string> | undefined,
) => Promise<DeliveryResult>;

/** The outbound SMTP seam. Must never reject, same reason. */
export type NotificationSendMail = (mail: NotificationMail) => Promise<DeliveryResult>;

/**
 * The session-lifecycle surface `NotificationManager.bind` needs.
 *
 * Deliberately *not* `BridgeManager`: on the reference side this is a two-callback
 * subscription living on the bridge manager (L347729), and in this rewrite
 * `BridgeManager` does not exist under that name — session creation, PID→UIN
 * mapping and shutdown draining are split between `Bridge` and `HaizakuraRuntime`.
 *
 * It IS implemented now: `BridgeNotificationSessionSource` in
 * `src/host/notification-source.ts` adapts `Bridge`'s event bus (which publishes
 * `session_started` / `session_closed` from `bindPid` / `detachPid`) to this
 * interface, and `HaizakuraRuntime`'s constructor wires the two together. That
 * wiring is the reason the subsystem stopped being dead code; see that file's
 * header for why the edge is published from the producer rather than inferred.
 */
export interface NotificationSessionSource {
  subscribeSessions(listener: {
    started?: (uin: string, bridge: NotificationSession) => void;
    closed?: (uin: string, bridge: NotificationSession, pid: number | null) => void;
  }): () => void;
}

/** The slice of a live session a notification needs. */
export interface NotificationSession {
  readonly identity: { readonly nickname: string };
  /** `null` while no hook process is bound; read at fire time, not at schedule time. */
  readonly activePid: number | null;
}
