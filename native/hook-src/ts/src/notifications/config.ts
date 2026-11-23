// The notification channel store: `config/notifications.json`.
//
// Reference region: src/notifications/config.ts L348244-L348497 (255 lines).
//
// ---------------------------------------------------------------------------
// The one policy that decides everything below: normalize is TOTAL
// ---------------------------------------------------------------------------
// `normalizeChannel` never rejects, never throws, and never reports why. It returns
// a channel or `null`, and `normalizeChannels` drops the `null`s. That is the
// opposite of the OneBot config loader next door, which throws
// `OneBotConfigValidationError` on a bad adapter — and the difference is deliberate:
//
//   * `onebot_<uin>.json` is machine-written, so corruption there means a real bug
//     and refusing to start is the right signal.
//   * `notifications.json` is hand-edited by an operator wiring up a webhook. A
//     single mistyped header must drop *that channel*, not stop the whole bot from
//     starting — and there is no restart to lose, since the file is re-read on every
//     notification.
//
// The consequence to keep in mind when reading the normalizers: a `null` return is
// silent. `loadNotificationsConfig` logs once (at warn) when the *file* is
// unreadable, but a channel dropped by validation is invisible unless the operator
// notices it is missing from the WebUI list. That is the reference's behaviour
// (§348385-348387) and it is the trade the feature makes.
//
// ---------------------------------------------------------------------------
// Why a module-level cache, and why `saveNotificationsConfig` updates it
// ---------------------------------------------------------------------------
// `cached` is a plain module singleton (L348447). The WebUI's GET, the WebUI's POST,
// and every notification delivery all read the same object, so a save is visible to
// the very next delivery without a reload. The cache is *not* invalidated by an
// external edit of the file — an operator who edits `notifications.json` by hand has
// to restart, which is the same behaviour every other config file in this project
// has.
//
// `loadNotificationsConfig` also *rewrites* the file when the normalized form
// differs from what is on disk (L348467). That is not just housekeeping: it strips
// fields the normalizer dropped, so an image of the config directory never carries a
// stale `smtpPass` from a channel that no longer parses. The rewrite is idempotent
// and its failure is only a warning.
//
// ---------------------------------------------------------------------------
// Why the file is mode 0600 and written `.tmp` + `rename`
// ---------------------------------------------------------------------------
// It holds SMTP passwords. 0600 (`0o600` = 384, the reference's spelling at
// L348434) is the only reason the file is not world-readable, and `rename` is what
// makes the write atomic — a crash between `writeFile` and `rename` leaves the old
// file intact rather than a truncated one. `chmod` is applied to the tmp file
// *before* the rename because `rename` preserves the source's mode; applying it
// afterwards would leave a brief window where the password file is 0644.
//
// `process.platform !== "win32"` guards the chmod: Windows has no POSIX mode bits,
// and `chmodSync` there is a no-op that can still throw on some filesystems.

import fs from "node:fs";
import path from "node:path";

import { clampInt, boolOr, isObject } from "./coerce.js";
import { createLogger } from "../onebot/log.js";
import { CONFIG_DIR } from "../onebot/config-defaults.js";
import { DEFAULT_EMAIL_BODY, DEFAULT_SUBJECT_TEMPLATE, DEFAULT_WEBHOOK_BODY } from "./templates.js";
import type {
  EmailChannel,
  NotificationChannel,
  NotificationChannelType,
  NotificationsConfig,
  WebhookChannel,
} from "./types.js";
import { extractAddress, parseRecipients } from "./smtp.js";

const log = createLogger("Notifications.Config");

const NOTIFICATIONS_CONFIG_PATH = path.join(CONFIG_DIR, "notifications.json");

/** One hour. Above this a `debounceSeconds` typo (`300000`) silences the feature. */
const DEBOUNCE_SECONDS_MAX = 3_600;

/**
 * A channel id is a slug: it is referenced by per-UIN `channelIds`, so it must be
 * safe to use as a stable key. Kept in sync with `normalizeChannelIds` in
 * `onebot/config.ts` (cross-package; can't share without a circular dep — core
 * depends on onebot, not the reverse).
 *
 * `\w` includes `_`, and `.`/`-` are included because operators name channels
 * `feishu.prod` and `dingtalk-alerts`. Anything else (spaces, `/`, `#`) would need
 * escaping wherever the id is used as a key.
 */
const CHANNEL_ID_RE = /^[\w.-]+$/;
const CHANNEL_ID_MAX = 64;
const CHANNEL_NAME_MAX = 128;
const BODY_TEMPLATE_MAX = 8_192;
const HEADER_NAME_MAX = 128;
const HEADER_VALUE_MAX = 1_024;
const HEADERS_MAX = 16;
/**
 * RFC 7230 `token` — the only characters legal in a header field name.
 *
 * Validating this is what stops a channel config from smuggling a second header
 * (or a request line) into the POST: the names are operator-supplied, so
 * `{"X-Foo\r\nHost": "evil"}` must be dropped, not sent.
 */
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const SMTP_HOST_MAX = 253;
const SMTP_USER_MAX = 256;
const SMTP_PASS_MAX = 256;
const EMAIL_FIELD_MAX = 1_024;
const SUBJECT_TEMPLATE_MAX = 256;
const SMTP_PORT_MIN = 1;
const SMTP_PORT_MAX = 65_535;

/**
 * Narrow a channel to the email kind.
 *
 * The discriminant is `type`, and it is the *only* thing that decides — a webhook
 * with an `smtpHost` field is still a webhook. `deliver` and `normalizeChannel` both
 * go through this, so the two agree by construction.
 */
export function isEmailChannel(ch: NotificationChannel): ch is EmailChannel {
  return ch.type === "email";
}

function defaultNotificationsConfig(): NotificationsConfig {
  return { version: 1, debounceSeconds: 30, channels: [] };
}

/**
 * Substitute `{name}` placeholders, preserving unknown ones.
 *
 * Two behaviours are load-bearing:
 *
 *   * **Unknown placeholders survive.** A template with `{foo}` keeps `{foo}` rather
 *     than becoming `undefined` — the operator sees their typo in the delivered
 *     message instead of a silent gap.
 *   * **Values are JSON-escaped when the template parses as JSON.** The webhook
 *     default is a JSON object, so a nickname containing `"` or a newline would
 *     otherwise produce an unparseable payload. Detection is "does the whole
 *     template parse as JSON", not "does it look like JSON" — a plain-text body that
 *     happens to contain `{` must NOT be escaped, or the email would read
 *     `\u4f60\u597d` instead of 你好.
 *
 * `JSON.stringify(val).slice(1, -1)` strips the surrounding quotes to reinsert the
 * escaped *contents*; a template that quotes its placeholders (`"{uin}"`) relies on
 * that, and one that does not still gets valid JSON because the escaped value is
 * quote-free.
 */
export function renderTemplate(template: unknown, vars: Record<string, string>): string {
  if (typeof template !== "string") return "";
  let isJson = false;
  try {
    JSON.parse(template);
    isJson = true;
  } catch {
    // Not JSON: plain-text body, substitute raw values. Emphatically not an error —
    // the email template is not JSON.
  }
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return match;
    const val = vars[key] as string;
    return isJson ? (JSON.stringify(val).slice(1, -1) as string) : val;
  });
}

/** A string cut to `maxLen`, else the fallback. Used by every free-text field. */
function strOr(value: unknown, fallback: string, maxLen: number): string {
  return typeof value === "string" ? value.slice(0, maxLen) : fallback;
}

function normalizeChannelId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0 || v.length > CHANNEL_ID_MAX) return null;
  if (!CHANNEL_ID_RE.test(v)) return null;
  return v;
}

/**
 * `http:`/`https:` only.
 *
 * `new URL` rather than a regex because it normalizes as it parses, and it rejects
 * the inputs a regex cannot (`http://`, `http:///path`). `ftp:` and `javascript:`
 * are excluded here, not at fetch time — the latter would be a code-execution
 * surface if a webhook URL were ever rendered into a link.
 */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Sanitize the operator-supplied header map, or `undefined` when nothing survives.
 *
 * Every `continue` below is a security or correctness rule, not tidiness:
 *
 *   * the `HEADERS_MAX` break bounds the work a config can cause (and the header
 *     block size a receiver has to parse);
 *   * non-string values are dropped rather than stringified — `{"X-Retry": 3}` is
 *     ambiguous, and `String({})` would send `[object Object]`;
 *   * `HEADER_NAME_RE` blocks CRLF injection through the *name*;
 *   * dedupe is case-insensitive (header names are case-insensitive per RFC 7230) and
 *     the *first* spelling wins, so the map does not contain two keys a receiver
 *     would fold;
 *   * a CR/LF in the *value* is dropped for the same reason as the name.
 *
 * Returning `undefined` (not `{}`) for an empty result is what lets the channel
 * object omit the key entirely, which keeps `exactOptionalPropertyTypes` happy and
 * keeps the WebUI's JSON free of empty objects.
 */
function normalizeHeaders(value: unknown): Record<string, string> | undefined {
  if (!isObject(value)) return undefined;
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [rawName, rawValue] of Object.entries(value)) {
    if (Object.keys(out).length >= HEADERS_MAX) break;
    if (typeof rawValue !== "string") continue;
    const name = rawName.trim();
    if (name.length === 0 || name.length > HEADER_NAME_MAX) continue;
    if (!HEADER_NAME_RE.test(name)) continue;
    const folded = name.toLowerCase();
    if (seen.has(folded)) continue;
    const headerValue = rawValue.trim();
    if (headerValue.length === 0 || headerValue.length > HEADER_VALUE_MAX) continue;
    if (headerValue.includes("\r") || headerValue.includes("\n")) continue;
    seen.add(folded);
    out[name] = headerValue;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * A bare SMTP hostname, or `null`.
 *
 * Rejects whitespace, `/`, and a scheme prefix — all three are what an operator
 * pastes when they copy `https://smtp.example.com/` or `smtp example.com`, and
 * `net.connect` would then fail with a DNS error naming a string that looks valid.
 * An IP literal is allowed (it is just a string without spaces).
 *
 * **`host:port` is accepted, deliberately.** A colon is not on the reject list, so
 * `smtp.example.com:465` survives normalization and then fails at connect time with
 * `ENOTFOUND` — which `formatSmtpError` reports as "无法连接 SMTP：smtp.example.com:465:465"
 * (the port doubled). That is the reference's behaviour (§348336) and it is preserved:
 * "fixing" it here would silently reinterpret the operator's string, and the doubled
 * port in the error is a visible enough clue that they pasted the wrong field.
 */
function normalizeSmtpHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > SMTP_HOST_MAX) return null;
  if (/\s/.test(v) || v.includes("/") || v.includes("://")) return null;
  return v;
}

/**
 * The `From:` value, kept as the operator wrote it (display name included) but only
 * if it contains a usable address. `extractAddress` is the check, not the result.
 */
function normalizeFrom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().slice(0, EMAIL_FIELD_MAX);
  return extractAddress(v) ? v : null;
}

/**
 * The `To:` value, re-serialized from the parsed list.
 *
 * Storing `addrs.join(", ")` rather than the raw input is what strips comments,
 * duplicate addresses and stray separators: the delivered `RCPT TO` list comes from
 * `parseRecipients(mail.to)` again in `createDefaultSendMail`, but the *stored*
 * value is also what the WebUI shows, and `a@x.com,, a@x.com;` displayed verbatim
 * looks like a bug.
 */
function normalizeTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const addrs = parseRecipients(value.trim().slice(0, EMAIL_FIELD_MAX));
  return addrs.length > 0 ? addrs.join(", ") : null;
}

/**
 * Map `type` to the two kinds, defaulting to webhook.
 *
 * `undefined` and `""` both mean webhook (L348351): `type` is a fairly recent
 * addition to the file format, so every config written before it exists has no
 * `type` key, and those are all webhooks. An unrecognized non-empty value
 * (`"telegram"`) returns `null` — silently reinterpreting it as a webhook would
 * POST to whatever `url` happened to hold.
 */
function normalizeChannelType(value: unknown): NotificationChannelType | null {
  if (value === "email") return "email";
  if (value === "webhook" || value === undefined || value === "") return "webhook";
  return null;
}

/**
 * The email half of `normalizeChannel`.
 *
 * The port/secure interaction (§348359-348365) is the subtle part, and one branch is
 * surprising enough to spell out:
 *
 *   * Absent port → 465 when `smtpSecure` is true or absent, else 587. Those are
 *     the two IANA submission ports, and picking the right one from the `secure`
 *     flag is what makes `{smtpSecure: true}` alone a working config.
 *   * A **non-numeric** port (`"abc"`, `NaN`) → `clampInt` returns its fallback
 *     (`0`), and `portProvided && port === 0` drops the channel. A string the
 *     operator typed into the wrong field is a genuine mistake.
 *   * An **out-of-range numeric** port (`0`, `-1`, `70000`) is *clamped*, not
 *     dropped: `clampInt` lands it on 1 or 65535. This is the reference's behaviour
 *     and it is worth knowing it is asymmetric with the branch above — `smtpPort: 0`
 *     silently becomes port 1 rather than being rejected. Preserved rather than
 *     "fixed" because a rejected port would leave the operator with no channel and no
 *     error, while a clamped one at least attempts a connection and fails visibly.
 *   * Present port with no `smtpSecure` → `secure` is inferred from the port
 *     (`port === 465`), which is the only inference that is right more often than
 *     not.
 */
function normalizeEmailChannel(raw: Record<string, unknown>, id: string, name: string): EmailChannel | null {
  const smtpHost = normalizeSmtpHost(raw["smtpHost"]);
  const from = normalizeFrom(raw["from"]);
  const to = normalizeTo(raw["to"]);
  if (!smtpHost || !from || !to) return null;

  const portRaw = raw["smtpPort"];
  const portProvided = portRaw !== undefined && portRaw !== null && portRaw !== "";
  const secureProvided = typeof raw["smtpSecure"] === "boolean";
  const port = portProvided ? clampInt(portRaw, SMTP_PORT_MIN, SMTP_PORT_MAX, 0) : 0;
  if (portProvided && port === 0) return null;
  const smtpSecure = secureProvided ? Boolean(raw["smtpSecure"]) : port === 465 || port === 0;
  const smtpPort = port === 0 ? (smtpSecure ? 465 : 587) : port;

  const smtpUser = typeof raw["smtpUser"] === "string" ? raw["smtpUser"].trim().slice(0, SMTP_USER_MAX) : "";
  // Not trimmed: a password may legitimately start or end with a space, and trimming
  // it produces an authentication failure with no visible cause.
  const smtpPass = typeof raw["smtpPass"] === "string" ? raw["smtpPass"].slice(0, SMTP_PASS_MAX) : "";

  return {
    id,
    name,
    type: "email",
    url: "",
    bodyTemplate: strOr(raw["bodyTemplate"], DEFAULT_EMAIL_BODY, BODY_TEMPLATE_MAX),
    enabled: boolOr(raw["enabled"], true),
    smtpHost,
    smtpPort,
    smtpSecure,
    ...(smtpUser ? { smtpUser } : {}),
    ...(smtpPass ? { smtpPass } : {}),
    from,
    to,
    // An empty subject template is falsy, and `strOr` only guards the *type*, so the
    // `||` is what turns `""` back into the default. A message with no subject is
    // legal but reads as spam.
    subjectTemplate:
      strOr(raw["subjectTemplate"], DEFAULT_SUBJECT_TEMPLATE, SUBJECT_TEMPLATE_MAX) || DEFAULT_SUBJECT_TEMPLATE,
  };
}

/**
 * A channel is usable only with a valid id AND a deliverable target — http(s) URL
 * for webhooks, SMTP host + from/to for email. Anything else is dropped (total
 * normalize).
 *
 * `name` falls back to `id` because the WebUI renders it as the label and an empty
 * label is unclickable. The `.trim() || id` handles `name: "   "`.
 */
export function normalizeChannel(raw: unknown): NotificationChannel | null {
  if (!isObject(raw)) return null;
  const id = normalizeChannelId(raw["id"]);
  if (!id) return null;
  const type = normalizeChannelType(raw["type"]);
  if (!type) return null;
  const name = strOr(raw["name"], id, CHANNEL_NAME_MAX).trim() || id;
  if (type === "email") return normalizeEmailChannel(raw, id, name);

  const url = typeof raw["url"] === "string" ? raw["url"].trim() : "";
  if (!isHttpUrl(url)) return null;
  const headers = normalizeHeaders(raw["headers"]);
  const channel: WebhookChannel = {
    id,
    name,
    type: "webhook",
    url,
    bodyTemplate: strOr(raw["bodyTemplate"], DEFAULT_WEBHOOK_BODY, BODY_TEMPLATE_MAX),
    enabled: boolOr(raw["enabled"], true),
    ...(headers ? { headers } : {}),
  };
  return channel;
}

/**
 * Normalize a list, dropping invalid entries and duplicate ids.
 *
 * First-wins on a duplicate id (L348416): a config with two `alerts` channels
 * delivers to the first, and the second is invisible. That is deliberate — the id is
 * the key `channelIds` references, so a duplicate is ambiguous and "last wins" would
 * make a stale channel silently take over a live one.
 */
export function normalizeChannels(value: unknown): NotificationChannel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: NotificationChannel[] = [];
  for (const raw of value) {
    const ch = normalizeChannel(raw);
    if (!ch) continue;
    if (seen.has(ch.id)) continue;
    seen.add(ch.id);
    out.push(ch);
  }
  return out;
}

/**
 * Normalize a whole config.
 *
 * A non-object falls back to `{}` and therefore to defaults rather than throwing —
 * the total-normalize policy again. `version` is forced to `1` and never read from
 * the input: a file claiming `version: 2` is still normalized as v1, which is the
 * only behaviour that does not require a migration path for a format that has never
 * changed.
 */
export function normalizeNotificationsConfig(value: unknown): NotificationsConfig {
  const v = isObject(value) ? value : {};
  return {
    version: 1,
    debounceSeconds: clampInt(v["debounceSeconds"], 0, DEBOUNCE_SECONDS_MAX, 30),
    channels: normalizeChannels(v["channels"]),
  };
}

function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function enforceSensitiveFileMode(file: string): void {
  if (process.platform !== "win32") fs.chmodSync(file, 0o600);
}

/** `.tmp` + `chmod` + `rename` — see the file header for why the order matters. */
function atomicWrite(config: NotificationsConfig): void {
  ensureConfigDir();
  const tmp = `${NOTIFICATIONS_CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  enforceSensitiveFileMode(tmp);
  fs.renameSync(tmp, NOTIFICATIONS_CONFIG_PATH);
  enforceSensitiveFileMode(NOTIFICATIONS_CONFIG_PATH);
}

let cached: NotificationsConfig | null = null;

/**
 * Load + normalize the channel store, creating it from defaults if absent.
 *
 * The three `try` blocks fail differently on purpose:
 *
 *   * creating a missing file: warn, and still return the in-memory default — a
 *     read-only `config/` directory must not stop the bot;
 *   * re-writing a file that normalized differently: warn, and still return the
 *     normalized value — the in-memory config is correct even if the disk copy is
 *     stale;
 *   * reading an unreadable/corrupt file: warn, cache and return defaults. Note it
 *     caches the default, so a corrupt file is not re-read on every notification.
 */
export function loadNotificationsConfig(): NotificationsConfig {
  if (cached) return cached;
  ensureConfigDir();
  if (!fs.existsSync(NOTIFICATIONS_CONFIG_PATH)) {
    const fresh = defaultNotificationsConfig();
    try {
      atomicWrite(fresh);
    } catch (err) {
      log.warn("failed to write initial notifications.json: %s", err instanceof Error ? err.message : String(err));
    }
    cached = fresh;
    return fresh;
  }
  enforceSensitiveFileMode(NOTIFICATIONS_CONFIG_PATH);
  try {
    const raw = fs.readFileSync(NOTIFICATIONS_CONFIG_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const normalized = normalizeNotificationsConfig(parsed);
    // Compare against the *normalized* form, not the raw text: a file that differs
    // only in whitespace is already canonical, and rewriting it on every load would
    // touch mtime for no reason.
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      try {
        atomicWrite(normalized);
      } catch (err) {
        log.warn(
          "failed to normalize notifications.json on disk: %s",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    cached = normalized;
    return normalized;
  } catch (err) {
    log.warn("notifications.json unreadable; using defaults: %s", err instanceof Error ? err.message : String(err));
    const fresh = defaultNotificationsConfig();
    cached = fresh;
    return fresh;
  }
}

/**
 * Persist a (possibly partial) client-supplied config. A missing `channels` or
 * `debounceSeconds` keeps the current on-disk value — section-level merge, same
 * as `saveUiConfig`. Returns the stored, normalized config.
 *
 * The merge is per *section*, not per channel: sending `{debounceSeconds: 5}` keeps
 * the channel list, but sending `{channels: [...]}` replaces it wholesale. A per-
 * channel merge would make deletion impossible.
 *
 * `debounceSeconds: null` is *not* treated as absent — `v["debounceSeconds"] !==
 * undefined` is true for `null`. But the result is the clamp **fallback**, `30`, not
 * `0`: `clampInt(null, …)` sees `typeof null !== "number"` and `typeof null !==
 * "string"`, so `n` is `NaN` and the fallback wins. So a cleared WebUI input resets
 * the debounce to the default rather than disabling it — and to disable it the
 * client must send the number `0`.
 *
 * A read-only filesystem makes `atomicWrite` throw; that propagates, because unlike
 * a load there is no sane value to return — the caller (the WebUI route) reports it
 * as a 500.
 */
export function saveNotificationsConfig(incoming: unknown): NotificationsConfig {
  const current = loadNotificationsConfig();
  const v = isObject(incoming) ? incoming : {};
  const next: NotificationsConfig = {
    version: 1,
    debounceSeconds:
      v["debounceSeconds"] !== undefined
        ? clampInt(v["debounceSeconds"], 0, DEBOUNCE_SECONDS_MAX, 30)
        : current.debounceSeconds,
    channels: Array.isArray(v["channels"]) ? normalizeChannels(v["channels"]) : current.channels,
  };
  atomicWrite(next);
  cached = next;
  return next;
}

/**
 * Drop the memoized config.
 *
 * Not in the reference: it has no test suite that needs it, and the module
 * singleton there is process-lifetime by design. Here it is a test seam — every
 * test that writes a different `notifications.json` would otherwise see the first
 * one. Divergence, additive, no behaviour change for a running bot.
 */
export function resetNotificationsConfigCache(): void {
  cached = null;
}

/** The on-disk path, resolved through `CONFIG_DIR`. Exported for tests and diagnostics. */
export { NOTIFICATIONS_CONFIG_PATH };
