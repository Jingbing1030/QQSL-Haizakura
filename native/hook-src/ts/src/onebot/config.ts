// The per-UIN OneBot config: load, merge, validate, save.
//
// Reference region: ../onebot/src/config.ts L5124-L5931 (806 lines, the desktop
// app's full config loader). This file ports the parts the rewrite needs to answer
//
//     loadOneBotConfig(uin).notifications?.channelIds ?? []
//
// and to keep `OneBotManager.startSession` (L345240) working: the merge engine
// (`fromJson`), the strict validator, the two file readers with their *different*
// corrupt-file policies, and the serializer the WebUI round-trips.
//
// Divergence from the spec's §7 file split: steps 3-8 all live here rather than in
// `config-json.ts` / `config-network.ts` / `config-validate.ts` /
// `config-overrides.ts`. §7 step 0 already argued for one file (every symbol is
// entangled through `fromJson`/`toJsonObject`/the validator, so splitting buys
// import cycles and no testability), and the parent's brief named three files.
// `config-types.ts` and `config-defaults.ts` are separate because they have no
// dependency on any of this.
//
// NOT ported here, deliberately (`docs/onebot-config-surface.md` §7 steps 9-10):
//
//   * `cleanupInvalidPerUinConfigs` (L5589) — startup housekeeping; needs no part
//     of the loader and would add a filesystem sweep to a module tests import.
//   * `prepareOneBotConfigForRestore` and the whole restore validator family
//     (L5254-L5449) — the backup/restore WebUI path, 320 lines, nothing else uses
//     it, and it is the only place `musicSignUrl` still exists.
//
// Both are additive later; neither changes anything below.
//
// ---------------------------------------------------------------------------
// The three policies that decide whether a config bug is visible
// ---------------------------------------------------------------------------
//
// 1. Corruption of the two files is NOT symmetric (§4.2). A broken
//    `config/onebot.json` (the global overlay an operator hand-edits) is logged
//    and ignored, so one bad character cannot lock every account out. A broken
//    `config/onebot_<uin>.json` throws: it is machine-written, so corruption there
//    means something real went wrong, and `notifications/manager.ts` catches the
//    throw and skips that account's notification rather than crashing.
//
// 2. Lenient merge vs strict validation (§4.4) is also not symmetric, on purpose.
//    `parseStatusCommand` ignores a malformed value (a typo in `enabled` keeps the
//    default `true`), while `parseHistorySync` throws. Ported as-is: the WebUI save
//    path validates the same input with the strict validator anyway, so "fixing"
//    the lenient half would only move the error, and the asymmetry is what the
//    reference's own tests pin.
//
// 3. `fromJson` validates its OWN output. That is what makes the in-memory shape
//    stricter than the on-disk shape (§3.2): a file may omit `messageFormat` and
//    `reportSelfMessage`, but a loaded config cannot.
//
// ---------------------------------------------------------------------------
// One hardening the reference lacks (§7 step 6.3)
// ---------------------------------------------------------------------------
//
// `loadOneBotConfig(uin)` interpolates `uin` straight into a filename. The
// reference relies on every caller pre-validating it (`UIN_REGEX` in the WebUI,
// `isRealUin` in the cleanup sweep), so `loadOneBotConfig("../escape")` walks out
// of `config/` and reads an arbitrary JSON file. This port refuses any uin that
// fails `isRealUin` before touching the filesystem — the same predicate the bridge
// uses, so both layers agree on which accounts exist. `saveOneBotConfig` gates the
// same way, because it interpolates the same string.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { positiveIntEnv } from "../bridge/env.js";
import { isRealUin } from "../bridge/bridge.js";
import { isValidBindHost } from "../host/runtime-config.js";
import { OneBotConfigValidationError, invalid } from "./config-error.js";
import {
  CONFIG_DIR,
  DEFAULT_STATUS_COMMAND,
  HTTP_DEFAULT_SERVER,
  MAX_PAYLOAD_BYTES_MAX,
  MAX_PAYLOAD_BYTES_MIN,
  NODE_TIMER_MAX_MS,
  PER_UIN_SNAPSHOT_MARKER,
  STATUS_COMMAND_COOLDOWN_MAX,
  WS_DEFAULT_SERVER,
  generateAccessToken,
  makeDefaultOneBotConfig,
  makeDefaultStatusCommand,
} from "./config-defaults.js";
import type {
  ForwardRole,
  HttpClientConfig,
  HttpServerConfig,
  HistorySyncConfig,
  NotificationsConfig,
  OneBotConfig,
  OneBotConfigMode,
  StatusCommandConfig,
  WsClientConfig,
  WsServerConfig,
} from "./config-types.js";
import { createLogger, errorMessage } from "./log.js";
import { readEnvAlias } from "../bridge/env.js";

const log = createLogger("OneBot.Config");

/**
 * The basename of the global overlay file. `config-defaults.ts` exports the whole
 * relative path (`DEFAULT_CONFIG_PATH`) for callers that use the default directory;
 * this module joins the basename onto whatever directory it was given, so the
 * `configDir` option cannot silently read a different file.
 */
const GLOBAL_CONFIG_BASENAME = "onebot.json";

/**
 * The strict validator, `assertValidOneBotConfig` (L5451), lives below with its
 * helper family. The validation error class and `invalid()` are in
 * `config-error.ts` so `manager.ts` can share the same class — two declarations
 * with the same `name` would make every `instanceof` depend on which module the
 * thrower imported. Re-exported here so a caller can keep importing the whole
 * config surface from one file.
 */
export { OneBotConfigValidationError };

/**
 * A parsed JSON object, keys untyped. Every function that reads a config file
 * consumes this and narrows field by field, exactly like the reference's untyped
 * `raw`.
 */
export type RawConfigObject = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Small total coercions (L5859-L5884)
// ---------------------------------------------------------------------------

/** L5922 `isObject` — non-null, non-array. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** L5859 `parseMessageFormat` — only the two literal values survive. */
function parseMessageFormat(value: unknown): "array" | "string" | undefined {
  if (value === "array" || value === "string") return value;
  return undefined;
}

/** L5862 `clean` — drop `undefined`-valued keys so a saved file has no `null`s. */
function clean<T extends object>(obj: T): T {
  for (const key of Object.keys(obj)) {
    if ((obj as Record<string, unknown>)[key] === undefined) delete (obj as Record<string, unknown>)[key];
  }
  return obj;
}

/** L5873 `asString` — numbers and booleans are stringified; everything else falls back. */
function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

/**
 * L5878 `asNumber` — lenient and lossy in a specific way: negatives clamp to `0`,
 * fractions truncate, and numeric strings are accepted. `port: "6700"` therefore
 * loads as `6700`, while `port: -5` becomes `0`, which the server parsers then
 * reject as "not a server" and drop the entry (§4.5).
 */
function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
  }
  return fallback;
}

/** L5866 `asRole` — case-insensitive read, fallback on garbage. */
function asRole(value: unknown, fallback: ForwardRole): ForwardRole {
  const text = asString(value, fallback).toLowerCase();
  if (text === "api") return "Api";
  if (text === "event") return "Event";
  if (text === "universal") return "Universal";
  return fallback;
}

// ---------------------------------------------------------------------------
// File I/O (L5886-L5921)
// ---------------------------------------------------------------------------

/**
 * L5886 `tryLoadJson` — read one config file with the caller's corruption policy.
 *
 * `failOnCorrupt = false` (the global overlay): warn and return `null`, so the
 * load proceeds from whatever else exists. `true` (the per-UIN file): throw with
 * the `cause` attached, because a machine-written file that no longer parses is a
 * real fault, not an operator typo.
 *
 * A JSON root that is not an object is corruption too — an array or a bare
 * number is not a config, and quietly treating it as `{}` would make the file look
 * empty instead of broken.
 */
export function tryLoadJson(filePath: string, failOnCorrupt = false): RawConfigObject | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) throw new Error("configuration root must be an object");
    return parsed;
  } catch (err) {
    const message = errorMessage(err);
    if (failOnCorrupt) throw new Error(`config file ${filePath} is corrupt: ${message}`, { cause: err });
    log.warn("config file %s is corrupt and will be ignored: %s", filePath, message);
    return null;
  }
}

/**
 * L5900 `saveJson` — atomic write: temp file in the same directory, `0o600`,
 * `fsync`, then `rename`.
 *
 * Sync, because `startSession` and the WebUI request handler both depend on the
 * file being complete when the call returns. The temp name carries the pid and six
 * random bytes so two accounts saving at once cannot collide, `wx` refuses to
 * reuse an existing temp file, and a failure unlinks the temp file rather than
 * leaving a half-written `.tmp` that the next operator would mistake for config.
 */
export function saveJson(filePath: string, json: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${String(process.pid)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  let fd: number | null = null;
  try {
    fd = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(json, null, 2), "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* the original error is the one worth reporting */
      }
    }
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* it may never have been created */
    }
    throw error;
  }
}

/** L5577 `ensureConfigDir` — the reference's unconditional `mkdir -p config`. */
function ensureConfigDir(configDir: string): void {
  fs.mkdirSync(configDir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Notifications / statusCommand / historySync (L5707-L5759)
// ---------------------------------------------------------------------------

/**
 * L5732 `normalizeChannelIds` — slug filter, order-preserving, deduped.
 *
 * The rule (`^[\w.-]+$`, 1…64 chars) is duplicated from
 * `src/notifications/config.ts` on purpose: core depends on onebot, so onebot
 * cannot import from core. Invalid ids are dropped **silently** here — the
 * restore path is the only place they are rejected.
 */
export function normalizeChannelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const v = item.trim();
    if (!v || v.length > 64 || !/^[\w.-]+$/.test(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * L5723 `parseNotifications` — last-write-wins, **not** a union.
 *
 * A source that has no `notifications` key leaves the list alone; a source with
 * `channelIds: []` *clears* it. That distinction is the whole point (§3.5): the
 * per-UIN file opts one account into a set of channels, and an empty array means
 * "none", not "inherit". A naive `concat` would make opting out impossible.
 */
export function parseNotifications(sources: readonly RawConfigObject[]): NotificationsConfig {
  let channelIds: string[] = [];
  for (const src of sources) {
    const raw = src["notifications"];
    if (!isObject(raw)) continue;
    if (Array.isArray(raw["channelIds"])) channelIds = normalizeChannelIds(raw["channelIds"]);
  }
  return { channelIds };
}

/**
 * L5748 `parseStatusCommand` — last-write-wins with defaults filled and the
 * cooldown clamped.
 *
 * Lenient by design (§4.4): a non-boolean `enabled` is ignored rather than
 * rejected, `cooldownSeconds` is clamped to `[0, one year]`, and `trigger` is
 * trimmed and cut to 32 characters. A trigger that is empty after trimming, or
 * that contains a newline, keeps the previous value — a multi-line trigger could
 * never match a message anyway.
 */
export function parseStatusCommand(sources: readonly RawConfigObject[]): StatusCommandConfig {
  const out = makeDefaultStatusCommand();
  for (const src of sources) {
    const raw = src["statusCommand"];
    if (!isObject(raw)) continue;
    if (typeof raw["enabled"] === "boolean") out.enabled = raw["enabled"];
    if (typeof raw["swallow"] === "boolean") out.swallow = raw["swallow"];
    if (raw["cooldownSeconds"] !== undefined) {
      out.cooldownSeconds = Math.min(
        STATUS_COMMAND_COOLDOWN_MAX,
        asNumber(raw["cooldownSeconds"], DEFAULT_STATUS_COMMAND.cooldownSeconds),
      );
    }
    const trigger = raw["trigger"];
    if (typeof trigger === "string" && trigger.trim().length > 0 && !/[\r\n]/.test(trigger)) {
      out.trigger = trigger.trim().slice(0, 32);
    }
  }
  return out;
}

/** L5432 `rejectUnknownKeys` — first offending key wins, message names it. */
function rejectUnknownKeys(value: RawConfigObject, allowed: ReadonlySet<string>, at: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown !== undefined) invalid(`${at}.${unknown} is not supported`);
}

const HISTORY_SYNC_KEYS: ReadonlySet<string> = new Set(["enabled"]);

/**
 * L5707 `parseHistorySync` — the strict one.
 *
 * Unlike its two neighbours this throws on anything malformed, including unknown
 * keys. That asymmetry is deliberate (§4.4): `historySync.enabled` is read once, at
 * instance construction, and never re-read on reload (`instance.ts:342763`), so a
 * silently-ignored typo would stay invisible for the life of the process.
 */
export function parseHistorySync(sources: readonly RawConfigObject[]): HistorySyncConfig {
  let enabled = false;
  for (const source of sources) {
    if (!Object.prototype.hasOwnProperty.call(source, "historySync")) continue;
    const raw = source["historySync"];
    if (!isObject(raw)) invalid("historySync must be an object");
    rejectUnknownKeys(raw, HISTORY_SYNC_KEYS, "historySync");
    if (typeof raw["enabled"] !== "boolean") invalid("historySync.enabled must be a boolean");
    enabled = raw["enabled"];
  }
  return { enabled };
}

// ---------------------------------------------------------------------------
// Network adapters: normalization (L5760-L5855)
// ---------------------------------------------------------------------------

/** What `parseBase` needs from `fromJson`: the legacy top-level defaults. */
interface AdapterDefaults {
  messageFormat: "array" | "string";
  reportSelfMessage: boolean;
}

/**
 * L5792 `parseBase` — the shared half of every adapter.
 *
 * `enabled` and `accessToken` are omitted (not `false`/`""`) when absent, because
 * the serializer re-adds them only when they mean something: `enabled` only when
 * `false`, a token only when non-empty.
 */
function parseBase(value: RawConfigObject, defaults: AdapterDefaults): OneBotAdapterFields {
  return {
    name: asString(value["name"]),
    enabled: typeof value["enabled"] === "boolean" ? value["enabled"] : undefined,
    accessToken: asString(value["accessToken"]) || undefined,
    protocol: value["protocol"] === "satori" ? "satori" : undefined,
    messageFormat: parseMessageFormat(value["messageFormat"]) ?? defaults.messageFormat,
    reportSelfMessage:
      typeof value["reportSelfMessage"] === "boolean" ? value["reportSelfMessage"] : defaults.reportSelfMessage,
  };
}

/** `parseBase`'s result, before the per-kind fields are added. */
interface OneBotAdapterFields {
  name: string;
  enabled?: boolean | undefined;
  accessToken?: string | undefined;
  protocol?: "satori" | undefined;
  messageFormat: "array" | "string";
  reportSelfMessage: boolean;
}

/**
 * L5517 `parseMaxPayloadBytes` — applied on load, on restore and on API writes, so
 * the three cannot disagree about what a legal frame cap is.
 *
 * `at` is the message prefix; on the load path the reference passes a human phrase
 * (`"websocket server"`), not a path, which is why the errors read
 * `websocket server.maxPayloadBytes must be …`.
 */
function parseMaxPayloadBytes(value: unknown, at: string): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < MAX_PAYLOAD_BYTES_MIN ||
    value > MAX_PAYLOAD_BYTES_MAX
  ) {
    invalid(`${at}.maxPayloadBytes must be an integer between ${String(MAX_PAYLOAD_BYTES_MIN)} and ${String(MAX_PAYLOAD_BYTES_MAX)}`);
  }
  return value;
}

/** L5522 — HTTP clients cannot set a frame cap; there is no frame to cap. */
function rejectHttpClientMaxPayloadBytes(item: RawConfigObject, at: string): void {
  if (item["maxPayloadBytes"] !== undefined) {
    invalid(`${at}.maxPayloadBytes is only supported by WebSocket adapters`);
  }
}

/**
 * L5801 `parseHttpServer` — returns `null` for an entry that must be dropped.
 *
 * `parseMaxPayloadBytes` runs **before** the port check, so a bad cap throws even
 * when the entry would have been dropped anyway. Also note the drop: a listener
 * with no usable port is a listener that cannot listen, and the reference removes
 * it instead of failing the load — an operator fixing a typo should not lose the
 * rest of the file.
 */
function parseHttpServer(value: RawConfigObject, defaults: AdapterDefaults): HttpServerConfig | null {
  const maxPayloadBytes = parseMaxPayloadBytes(value["maxPayloadBytes"], "http server");
  if (value["enableWebSocket"] !== undefined && typeof value["enableWebSocket"] !== "boolean") {
    invalid("http server enableWebSocket must be a boolean");
  }
  if (value["enableSse"] !== undefined && typeof value["enableSse"] !== "boolean") {
    invalid("http server enableSse must be a boolean");
  }
  const port = asNumber(value["port"], 0);
  if (port <= 0) return null;
  return clean({
    ...parseBase(value, defaults),
    host: asString(value["host"], "0.0.0.0"),
    port,
    path: asString(value["path"], "/"),
    enableWebSocket: value["enableWebSocket"] === true,
    enableSse: value["enableSse"] === true,
    maxPayloadBytes,
  }) as HttpServerConfig;
}

/**
 * L5817 `parseHttpClient` — a client with no URL is dropped unless it is
 * explicitly disabled.
 *
 * That exception is what lets an operator park an adapter without deleting its
 * token: `{enabled: false}` with no `url` survives a load, and the strict
 * validator accepts it because `validateClient` returns early for disabled
 * adapters.
 */
function parseHttpClient(value: RawConfigObject, defaults: AdapterDefaults): HttpClientConfig | null {
  rejectHttpClientMaxPayloadBytes(value, "http client");
  const url = asString(value["url"]);
  const base = parseBase(value, defaults);
  if (!url && base.enabled !== false) return null;
  const timeout = asNumber(value["timeoutMs"], 0);
  return clean({
    ...base,
    url,
    timeoutMs: timeout > 0 ? timeout : undefined,
  }) as HttpClientConfig;
}

/**
 * L5829 `parseWsServer`.
 *
 * The one surprising default: a listener marked `protocol: "satori"` defaults its
 * path to `/v1/events` instead of `/`, because the mount shim keys off that path
 * when deciding which listener is Satori.
 */
function parseWsServer(value: RawConfigObject, defaults: AdapterDefaults): WsServerConfig | null {
  const maxPayloadBytes = parseMaxPayloadBytes(value["maxPayloadBytes"], "websocket server");
  const port = asNumber(value["port"], 0);
  if (port <= 0) return null;
  return clean({
    ...parseBase(value, defaults),
    host: asString(value["host"], "0.0.0.0"),
    port,
    path: asString(value["path"], value["protocol"] === "satori" ? "/v1/events" : "/"),
    role: asRole(value["role"], "Universal"),
    maxPayloadBytes,
  }) as WsServerConfig;
}

/**
 * L5842 `parseWsClient` — same "no url is dropped unless disabled" rule as the
 * HTTP client, plus a reconnect floor: anything below one second is raised to it,
 * and a missing value means five seconds.
 */
function parseWsClient(value: RawConfigObject, defaults: AdapterDefaults): WsClientConfig | null {
  const maxPayloadBytes = parseMaxPayloadBytes(value["maxPayloadBytes"], "websocket client");
  const url = asString(value["url"]);
  const base = parseBase(value, defaults);
  if (!url && base.enabled !== false) return null;
  const reconnectIntervalMs = asNumber(value["reconnectIntervalMs"], 5_000);
  return clean({
    ...base,
    url,
    role: asRole(value["role"], "Universal"),
    reconnectIntervalMs: Math.max(1_000, reconnectIntervalMs),
    maxPayloadBytes,
  }) as WsClientConfig;
}

/** L5783 `pickAutoName` — `http-N` / `httppost-N` / `ws-N` / `wsclient-N`. */
function pickAutoName(kind: NetworkKindName, used: ReadonlyMap<string, unknown>, counter: number): string {
  const prefix =
    kind === "httpServers" ? "http" : kind === "httpClients" ? "httppost" : kind === "wsServers" ? "ws" : "wsclient";
  let candidate = `${prefix}-${String(counter)}`;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${prefix}-${String(counter)}`;
  }
  return candidate;
}

type NetworkKindName = "httpServers" | "httpClients" | "wsServers" | "wsClients";

/**
 * L5760 `collectByName` — the merge rule everything else depends on.
 *
 * Sources are ingested in order (global first, then per-UIN), and each list is
 * visited in three places: the canonical `networks.<kind>`, the legacy top-level
 * `<kind>`, and — for HTTP clients only — the legacy `httpPostEndpoints` key. Later
 * writes win by name but keep the position of the first appearance, so a per-UIN
 * override of the factory listener does not move it to the end of the list.
 *
 * Unnamed entries get an auto name derived from the ingestion counter, and the
 * counter is shared per kind across all sources, which is why the second unnamed
 * WS client is `wsclient-2` even if the first came from the global file.
 */
function collectByName<T extends { name: string }>(
  sources: readonly RawConfigObject[],
  kind: NetworkKindName,
  parse: (raw: RawConfigObject) => T | null,
  legacyKey?: string,
): T[] {
  const byName = new Map<string, T>();
  const order: string[] = [];
  let counter = 0;
  const ingest = (rawArr: unknown): void => {
    if (!Array.isArray(rawArr)) return;
    for (const raw of rawArr) {
      if (!isObject(raw)) continue;
      const parsed = parse(raw);
      if (!parsed) continue;
      const name = parsed.name && parsed.name.trim() ? parsed.name.trim() : pickAutoName(kind, byName, ++counter);
      // A cast, not a second interface: `T` is constrained to `{name: string}`, but
      // TS refuses a write through the generic parameter itself.
      (parsed as { name: string }).name = name;
      if (!byName.has(name)) order.push(name);
      byName.set(name, parsed);
    }
  };
  for (const src of sources) {
    const networks = src["networks"];
    ingest(isObject(networks) ? networks[kind] : undefined);
    if (legacyKey !== undefined) ingest(src[legacyKey]);
    ingest(src[kind]);
  }
  return order.map((name) => byName.get(name) as T);
}

/**
 * L5856 `hasLegacyTopLevel` — detects the pre-`networks` file layout.
 *
 * Only used to decide whether `persistDefaults` should rewrite a file: a legacy
 * file is migrated in place on the next load that persists, which is how an
 * install from before the `networks` wrapper ends up canonical.
 */
export function hasLegacyTopLevel(raw: RawConfigObject): boolean {
  return (
    Array.isArray(raw["httpServers"]) ||
    Array.isArray(raw["httpPostEndpoints"]) ||
    Array.isArray(raw["wsServers"]) ||
    Array.isArray(raw["wsClients"]) ||
    typeof raw["messageFormat"] === "string" ||
    typeof raw["reportSelfMessage"] === "boolean"
  );
}

// ---------------------------------------------------------------------------
// The merge engine (L5672)
// ---------------------------------------------------------------------------

/**
 * L5672 `fromJson` — merge every source into the canonical config, then validate.
 *
 * Order matters in three places:
 *
 *   1. The legacy top-level `messageFormat` / `reportSelfMessage` are resolved
 *      **first**, across all sources, and become the *default* for every adapter
 *      that lacks its own. A legacy file that says `messageFormat: "string"` must
 *      not turn adapters from a newer source into string adapters, so each adapter
 *      can still override.
 *   2. Factory adapters are injected only when `freshInstall` is true, i.e. when
 *      *no* config file existed at all. An empty-but-present file yields zero
 *      adapters (§4.3): someone deliberately emptied it.
 *   3. `assertValidOneBotConfig` runs on the merged output, so the loaded shape is
 *      stricter than the on-disk shape.
 *
 * There is no `rejectUnknownKeys` on this path: unknown top-level keys are ignored
 * here and only rejected on the restore path (§4.5). That asymmetry is deliberate
 * — the loader has to stay compatible with files written by older builds.
 */
export function fromJson(sources: readonly RawConfigObject[], freshInstall: boolean): OneBotConfig {
  let legacyFormat: "array" | "string" | undefined;
  let legacyReport: boolean | undefined;
  for (const src of sources) {
    const messageFormat = parseMessageFormat(src["messageFormat"]);
    if (messageFormat) legacyFormat = messageFormat;
    if (typeof src["reportSelfMessage"] === "boolean") legacyReport = src["reportSelfMessage"];
  }
  const adapterDefaults: AdapterDefaults = {
    messageFormat: legacyFormat ?? "array",
    reportSelfMessage: legacyReport ?? false,
  };

  const httpServers = collectByName(sources, "httpServers", (raw) => parseHttpServer(raw, adapterDefaults));
  const httpClients = collectByName(
    sources,
    "httpClients",
    (raw) => parseHttpClient(raw, adapterDefaults),
    "httpPostEndpoints",
  );
  const wsServers = collectByName(sources, "wsServers", (raw) => parseWsServer(raw, adapterDefaults));
  const wsClients = collectByName(sources, "wsClients", (raw) => parseWsClient(raw, adapterDefaults));

  if (freshInstall && httpServers.length === 0 && httpClients.length === 0 && wsServers.length === 0 && wsClients.length === 0) {
    const defaults = makeDefaultOneBotConfig().networks;
    httpServers.push(...defaults.httpServers);
    wsServers.push(...defaults.wsServers);
  }

  const config: OneBotConfig = {
    networks: { httpServers, httpClients, wsServers, wsClients },
    statusCommand: parseStatusCommand(sources),
    historySync: parseHistorySync(sources),
    notifications: parseNotifications(sources),
  };
  assertValidOneBotConfig(config);
  return config;
}

// ---------------------------------------------------------------------------
// The strict validator (L5451-L5573)
// ---------------------------------------------------------------------------

/**
 * L5451 `assertValidOneBotConfig` — the full shape check.
 *
 * Runs before a save, before a plan is compiled (`network-manager.ts:341941`, and
 * therefore on every WebUI write) and at the end of `fromJson`. Adapter names form
 * **one** namespace per account, not four: a `dup` HTTP server and a `dup` WS
 * client fail here even though they live in different lists, because the runtime
 * keys adapters by name.
 *
 * Messages are the reference's, verbatim, because fixtures assert on them.
 */
export function assertValidOneBotConfig(value: unknown): void {
  if (!isObject(value)) invalid("configuration must be an object");
  const root = value as RawConfigObject;
  const rawNetworks = root["networks"];
  if (!isObject(rawNetworks)) invalid("networks must be an object");
  const networks = rawNetworks as RawConfigObject;
  const seen = new Map<string, string>();
  const serverBindings = new Map<string, string>();

  validateNetworkList(networks, "httpServers", seen, (item, at) => {
    validateServer(item, at);
    parseMaxPayloadBytes(item["maxPayloadBytes"], at);
    if (item["enableWebSocket"] !== undefined && typeof item["enableWebSocket"] !== "boolean") {
      invalid(`${at}.enableWebSocket must be a boolean`);
    }
    if (item["enableSse"] !== undefined && typeof item["enableSse"] !== "boolean") {
      invalid(`${at}.enableSse must be a boolean`);
    }
    validateServerBinding(item, at, serverBindings);
  });

  validateNetworkList(networks, "httpClients", seen, (item, at) => {
    validateClient(item, at, HTTP_CLIENT_PROTOCOLS);
    rejectHttpClientMaxPayloadBytes(item, at);
    const timeoutMs = item["timeoutMs"];
    if (
      timeoutMs !== undefined &&
      (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > NODE_TIMER_MAX_MS)
    ) {
      invalid(`${at}.timeoutMs must be an integer between 1 and ${String(NODE_TIMER_MAX_MS)}`);
    }
  });

  validateNetworkList(networks, "wsServers", seen, (item, at) => {
    validateServer(item, at);
    validateServerBinding(item, at, serverBindings);
    validateRole(item["role"], `${at}.role`);
    parseMaxPayloadBytes(item["maxPayloadBytes"], at);
  });

  validateNetworkList(networks, "wsClients", seen, (item, at) => {
    validateClient(item, at, WS_CLIENT_PROTOCOLS);
    validateRole(item["role"], `${at}.role`);
    parseMaxPayloadBytes(item["maxPayloadBytes"], at);
    const reconnectIntervalMs = item["reconnectIntervalMs"];
    if (
      reconnectIntervalMs !== undefined &&
      (typeof reconnectIntervalMs !== "number" ||
        !Number.isSafeInteger(reconnectIntervalMs) ||
        reconnectIntervalMs < 1_000 ||
        reconnectIntervalMs > NODE_TIMER_MAX_MS)
    ) {
      invalid(`${at}.reconnectIntervalMs must be an integer between 1000 and ${String(NODE_TIMER_MAX_MS)}`);
    }
  });

  const rawStatus = root["statusCommand"];
  if (!isObject(rawStatus)) invalid("statusCommand must be an object");
  const status = rawStatus as RawConfigObject;
  if (typeof status["enabled"] !== "boolean") invalid("statusCommand.enabled must be a boolean");
  if (typeof status["swallow"] !== "boolean") invalid("statusCommand.swallow must be a boolean");
  const cooldownSeconds = status["cooldownSeconds"];
  if (
    typeof cooldownSeconds !== "number" ||
    !Number.isInteger(cooldownSeconds) ||
    cooldownSeconds < 0
  ) {
    invalid("statusCommand.cooldownSeconds must be a non-negative integer");
  }
  const trigger = status["trigger"];
  if (
    typeof trigger !== "string" ||
    !trigger.trim() ||
    trigger.length > 32 ||
    /[\r\n]/.test(trigger)
  ) {
    invalid("statusCommand.trigger must be non-empty, single-line, and <= 32 characters");
  }

  const rawHistorySync = root["historySync"];
  if (!isObject(rawHistorySync)) invalid("historySync must be an object");
  if (typeof rawHistorySync["enabled"] !== "boolean") invalid("historySync.enabled must be a boolean");

  const rawNotifications = root["notifications"];
  if (rawNotifications !== undefined) {
    if (!isObject(rawNotifications) || !Array.isArray(rawNotifications["channelIds"])) {
      invalid("notifications.channelIds must be an array");
    }
    for (const [index, channelId] of (rawNotifications["channelIds"] as unknown[]).entries()) {
      if (typeof channelId !== "string" || !channelId || channelId.length > 64 || !/^[\w.-]+$/.test(channelId)) {
        invalid(`notifications.channelIds[${String(index)}] is invalid`);
      }
    }
  }
}

const HTTP_CLIENT_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);
const WS_CLIENT_PROTOCOLS: ReadonlySet<string> = new Set(["ws:", "wss:"]);

/** L5493 `validateNetworkList` — array-ness, per-item object, unique names. */
function validateNetworkList(
  networks: RawConfigObject,
  kind: NetworkKindName,
  seen: Map<string, string>,
  validateSpecific: (item: RawConfigObject, at: string) => void,
): void {
  const list = networks[kind];
  if (!Array.isArray(list)) invalid(`networks.${kind} must be an array`);
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index] as unknown;
    const at = `networks.${kind}[${String(index)}]`;
    if (!isObject(entry)) invalid(`${at} must be an object`);
    const item = entry as RawConfigObject;
    validateNetworkBase(item, at);
    const name = item["name"] as string;
    const previousKind = seen.get(name);
    if (previousKind !== undefined) {
      invalid(`network adapter name "${name}" is duplicated in ${previousKind} and ${kind}`);
    }
    seen.set(name, kind);
    validateSpecific(item, at);
  }
}

/**
 * L5508 `validateNetworkBase` — the fields every adapter must have after a load.
 *
 * `messageFormat` and `reportSelfMessage` are required here but optional on disk;
 * `fromJson` materializes both, and this is the check that proves it did.
 */
function validateNetworkBase(item: RawConfigObject, at: string): void {
  const name = item["name"];
  if (typeof name !== "string" || !name.trim()) invalid(`${at}.name must be a non-empty string`);
  if (name !== name.trim()) invalid(`${at}.name must not have surrounding whitespace`);
  /* `name` is a `string` from here on: `invalid` returns `never`. */
  if (item["enabled"] !== undefined && typeof item["enabled"] !== "boolean") {
    invalid(`${at}.enabled must be a boolean`);
  }
  if (item["accessToken"] !== undefined && typeof item["accessToken"] !== "string") {
    invalid(`${at}.accessToken must be a string`);
  }
  if (item["messageFormat"] !== "array" && item["messageFormat"] !== "string") {
    invalid(`${at}.messageFormat must be "array" or "string"`);
  }
  if (typeof item["reportSelfMessage"] !== "boolean") invalid(`${at}.reportSelfMessage must be a boolean`);
}

/**
 * L5525 `validateServer` — port, bind host and path, in that order.
 *
 * The path rules exist because the path is concatenated into a URL and compared
 * against a role classifier: a query, a hash, or a non-normalized path (`.`, `..`,
 * duplicate slashes) would make two different request lines look like one adapter.
 */
function validateServer(item: RawConfigObject, at: string): void {
  const port = item["port"];
  if (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > 65535) {
    invalid(`${at}.port must be an integer between 1 and 65535`);
  }
  const host = item["host"];
  if (host !== undefined) {
    if (typeof host !== "string") invalid(`${at}.host must be a string`);
    if (!host.trim()) invalid(`${at}.host must be a non-empty string when provided`);
    if (host !== host.trim()) invalid(`${at}.host must not have surrounding whitespace`);
    if (!isValidBindHost(host)) invalid(`${at}.host must be a valid TCP bind host`);
  }
  const rawPath = item["path"];
  if (rawPath !== undefined) {
    if (typeof rawPath !== "string") invalid(`${at}.path must be a string`);
    if (rawPath !== rawPath.trim()) invalid(`${at}.path must not have surrounding whitespace`);
    const pathValue = rawPath || "/";
    if (!pathValue.startsWith("/")) invalid(`${at}.path must be empty or start with /`);
    if (pathValue.includes("?") || pathValue.includes("#")) invalid(`${at}.path must not include query or hash`);
    if (new URL(`http://127.0.0.1${pathValue}`).pathname !== pathValue) {
      invalid(`${at}.path must already be a normalized URL pathname`);
    }
  }
}

/**
 * L5542 `validateServerBinding` — two listeners cannot share a socket.
 *
 * Disabled listeners are exempt (`enabled === false` returns early), because a
 * parked adapter is not bound. A wildcard host reserves the port against every
 * other host, which is why the wildcard case scans all existing bindings rather
 * than looking up one key.
 */
function validateServerBinding(item: RawConfigObject, at: string, bindings: Map<string, string>): void {
  if (item["enabled"] === false) return;
  const rawHost = item["host"];
  const host = typeof rawHost === "string" && rawHost.trim() ? rawHost.trim().toLowerCase() : "0.0.0.0";
  const port = item["port"];
  const binding = `${host}:${String(port)}`;
  const exact = bindings.get(binding);
  if (exact !== undefined) invalid(`${at} conflicts with ${exact} on server binding ${binding}`);
  const wildcardKey = `*:${String(port)}`;
  const previousWildcard = bindings.get(wildcardKey);
  if (previousWildcard !== undefined) {
    invalid(`${at} conflicts with ${previousWildcard} on wildcard server port ${String(port)}`);
  }
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    const previousSamePort = [...bindings.entries()].find(([key]) => key.endsWith(`:${String(port)}`));
    if (previousSamePort !== undefined) {
      invalid(`${at} conflicts with ${previousSamePort[1]} on wildcard server port ${String(port)}`);
    }
    bindings.set(wildcardKey, at);
  }
  bindings.set(binding, at);
}

/**
 * L5559 `validateClient` — `url` must be a string even when the adapter is
 * disabled (a parked adapter keeps its shape), but only an *enabled* one has to be
 * a usable absolute URL with the right protocol.
 */
function validateClient(item: RawConfigObject, at: string, protocols: ReadonlySet<string>): void {
  const url = item["url"];
  if (typeof url !== "string") invalid(`${at}.url must be a string`);
  if (item["enabled"] === false) return;
  if (!url.trim()) invalid(`${at}.url must be non-empty while the adapter is enabled`);
  const parsed = newUrlOrInvalid(url, at);
  if (!protocols.has(parsed.protocol)) {
    invalid(`${at}.url protocol must be one of ${[...protocols].join(", ")}`);
  }
}

/** `new URL`, but a parse failure is a validation error rather than a `TypeError`. */
function newUrlOrInvalid(url: string, at: string): URL {
  try {
    return new URL(url);
  } catch {
    invalid(`${at}.url must be a valid absolute URL`);
  }
}

/** L5571 `validateRole` — title case only; the lenient reader lowercases, this does not. */
function validateRole(value: unknown, at: string): void {
  if (value !== undefined && value !== "Api" && value !== "Event" && value !== "Universal") {
    invalid(`${at} must be Api, Event, or Universal`);
  }
}

// ---------------------------------------------------------------------------
// Serialization (L5610-L5671)
// ---------------------------------------------------------------------------

/**
 * L5610 `toJsonObject` — the canonical on-disk shape.
 *
 * Always emits `mode`, all four network lists, and all three non-network sections.
 * Two consequences worth knowing:
 *
 *   * `notifications` is always written, with `[]` when absent. So a WebUI save of
 *     a body with no `notifications` key writes `channelIds: []` into the per-UIN
 *     file, and because present-but-empty wins the LWW merge, that silently
 *     disables every notification for the account (§5.2). Pinned, not fixed: the
 *     WebUI round-trips this function and the reference behaves this way.
 *   * legacy names are gone after one save: `httpPostEndpoints` is written back as
 *     `httpClients`, and top-level `messageFormat` is folded into each adapter.
 */
export function toJsonObject(config: OneBotConfig, mode: OneBotConfigMode): Record<string, unknown> {
  const nets = config.networks;
  return {
    mode,
    networks: {
      httpServers: nets.httpServers.map(httpServerToJson),
      httpClients: nets.httpClients.map(httpClientToJson),
      wsServers: nets.wsServers.map(wsServerToJson),
      wsClients: nets.wsClients.map(wsClientToJson),
    },
    statusCommand: {
      enabled: config.statusCommand.enabled,
      swallow: config.statusCommand.swallow,
      cooldownSeconds: config.statusCommand.cooldownSeconds,
      trigger: config.statusCommand.trigger,
    },
    historySync: { enabled: config.historySync.enabled },
    notifications: { channelIds: config.notifications?.channelIds ?? [] },
  };
}

/**
 * L5630 `applyBase` — shared fields.
 *
 * `enabled` is written only when `false` and the token only when non-empty, so a
 * saved file stays readable and a disabled adapter is the only one that carries the
 * flag. `maxPayloadBytes` is dropped when absent rather than written as `null`.
 */
function applyBase(out: Record<string, unknown>, n: SerializableAdapter): void {
  out["name"] = n.name;
  if (n.enabled === false) out["enabled"] = false;
  if (n.accessToken) out["accessToken"] = n.accessToken;
  out["messageFormat"] = n.messageFormat;
  out["reportSelfMessage"] = n.reportSelfMessage;
  if (n.maxPayloadBytes !== undefined) out["maxPayloadBytes"] = n.maxPayloadBytes;
}

/** The slice `applyBase` writes. Every adapter kind satisfies it structurally, so
 *  the four `*ToJson` functions need no cast and no shared base class. */
interface SerializableAdapter {
  name: string;
  enabled?: boolean | undefined;
  accessToken?: string | undefined;
  messageFormat?: "array" | "string" | undefined;
  reportSelfMessage?: boolean | undefined;
  maxPayloadBytes?: number | undefined;
}

function httpServerToJson(n: HttpServerConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  applyBase(out, n);
  out["host"] = n.host ?? "0.0.0.0";
  out["port"] = n.port;
  out["path"] = n.path ?? "/";
  out["enableWebSocket"] = n.enableWebSocket === true;
  out["enableSse"] = n.enableSse === true;
  return out;
}

function httpClientToJson(n: HttpClientConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  applyBase(out, n);
  out["url"] = n.url;
  if (typeof n.timeoutMs === "number" && n.timeoutMs > 0) out["timeoutMs"] = n.timeoutMs;
  return out;
}

function wsServerToJson(n: WsServerConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  applyBase(out, n);
  out["host"] = n.host ?? "0.0.0.0";
  out["port"] = n.port;
  out["path"] = n.path ?? "/";
  out["role"] = n.role ?? "Universal";
  if (n.protocol === "satori") out["protocol"] = "satori";
  return out;
}

function wsClientToJson(n: WsClientConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  applyBase(out, n);
  out["url"] = n.url;
  out["role"] = n.role ?? "Universal";
  out["reconnectIntervalMs"] =
    typeof n.reconnectIntervalMs === "number" && Number.isFinite(n.reconnectIntervalMs)
      ? Math.max(1_000, Math.trunc(n.reconnectIntervalMs))
      : 5_000;
  return out;
}

// ---------------------------------------------------------------------------
// Environment port overrides (L5209-L5242)
// ---------------------------------------------------------------------------

/**
 * L5209 `applyOneBotListenPortOverrides` — let a deployment move the two factory
 * listeners without editing a file.
 *
 * Only `http-default` and `ws-default` move; every other adapter keeps its saved
 * port, so an operator who renamed a listener keeps full control of it. The
 * override is applied to a clone, re-validated, and reverted with a warning if it
 * would produce an invalid config (e.g. the new port collides with another
 * listener) — a typo in an env file must not make the config unloadable.
 *
 * Called **after** the optional save in `loadOneBotConfig`, so an override is never
 * persisted (§4.1 step 7).
 */
export function applyOneBotListenPortOverrides(config: OneBotConfig, env: NodeJS.ProcessEnv = process.env): OneBotConfig {
  const httpPort = readListenPort("ONEBOT_HTTP_PORT", env);
  const wsPort = readListenPort("ONEBOT_WS_PORT", env);
  if (httpPort === undefined && wsPort === undefined) return config;
  const next = structuredClone(config);
  const httpApplied =
    httpPort !== undefined &&
    assignFactoryPort(next.networks.httpServers, HTTP_DEFAULT_SERVER, httpPort, "SNOWLUMA_ONEBOT_HTTP_PORT");
  const wsApplied =
    wsPort !== undefined &&
    assignFactoryPort(next.networks.wsServers, WS_DEFAULT_SERVER, wsPort, "SNOWLUMA_ONEBOT_WS_PORT");
  if (!httpApplied && !wsApplied) return config;
  try {
    assertValidOneBotConfig(next);
  } catch (error) {
    log.warn("OneBot listen port override ignored: %s", errorMessage(error));
    return config;
  }
  return next;
}

/** L5225 `readListenPort` — 1…65535, or `undefined` for absent/blank/invalid. */
function readListenPort(name: string, env: NodeJS.ProcessEnv): number | undefined {
  const raw = readEnvAlias(name, env);
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const port = positiveIntEnv(name, 0, { max: 65535, env });
  return port > 0 ? port : undefined;
}

/** L5234 `assignFactoryPort` — warn when the factory listener is missing. */
function assignFactoryPort(
  servers: Array<{ name: string; port?: number | undefined }>,
  name: string,
  port: number,
  envName: string,
): boolean {
  const server = servers.find((entry) => entry.name === name);
  if (!server) {
    log.warn("%s is ignored; no %s listener", envName, name);
    return false;
  }
  server.port = port;
  return true;
}

// ---------------------------------------------------------------------------
// The entry points (L5192, L5243)
// ---------------------------------------------------------------------------

export interface LoadOneBotConfigOptions {
  /** Rewrite the per-UIN file when it is missing or legacy-shaped (§4.1 step 6). */
  persistDefaults?: boolean;
  /**
   * Divergence: the directory both files live in. The reference hardcodes the
   * relative string `"config"`, which ties every call to the process CWD; the
   * default here is the same value, but tests and embedders can point elsewhere
   * without `process.chdir`.
   */
  configDir?: string;
}

export interface SaveOneBotConfigOptions {
  /** Defaults to `"snapshot"`: self-contained, the global file is not merged. */
  mode?: OneBotConfigMode;
  /** Divergence, same as `LoadOneBotConfigOptions.configDir`. */
  configDir?: string;
}

/**
 * L5192 `loadOneBotConfig` — the entry point.
 *
 * The order is the contract, and every step exists for a reason:
 *
 *   1. gate `uin` (divergence, see the file header) and `mkdir -p config`, even on
 *      a pure read — the reference does the same, and `saveOneBotConfig` below
 *      would fail later rather than here;
 *   2. read the global overlay **leniently** and the per-UIN file **strictly**
 *      (§4.2);
 *   3. pick sources: the global file is skipped when the per-UIN file is a
 *      canonical `"snapshot"` (§3.3);
 *   4. merge + validate with `fromJson`; `freshInstall` is true only when neither
 *      file exists;
 *   5. persist only when `persistDefaults` is set **and** the per-UIN file is
 *      missing or legacy-shaped — a corrupt or merely old-but-canonical file is
 *      left exactly as it is;
 *   6. apply env port overrides **last**, so they are never written to disk.
 */
export function loadOneBotConfig(uin: string, options: LoadOneBotConfigOptions = {}): OneBotConfig {
  assertRealUin(uin);
  const configDir = options.configDir ?? CONFIG_DIR;
  ensureConfigDir(configDir);
  const perUinPath = path.join(configDir, `onebot_${uin}.json`);
  const globalRaw = tryLoadJson(path.join(configDir, GLOBAL_CONFIG_BASENAME));
  const perUinRaw = tryLoadJson(perUinPath, true);
  const legacy = perUinRaw !== null && hasLegacyTopLevel(perUinRaw);
  const sources: RawConfigObject[] = [];
  const isCanonicalSnapshot = perUinRaw?.["mode"] === PER_UIN_SNAPSHOT_MARKER;
  if (globalRaw && !isCanonicalSnapshot) sources.push(globalRaw);
  if (perUinRaw) sources.push(perUinRaw);
  const config = fromJson(sources, !perUinRaw && !globalRaw);
  if (options.persistDefaults === true && (!perUinRaw || legacy)) {
    saveOneBotConfig(uin, config, { mode: globalRaw ? "overlay" : "snapshot", configDir });
  }
  return applyOneBotListenPortOverrides(config);
}

/**
 * L5243 `saveOneBotConfig` — validate **first**, then write.
 *
 * Validation before `mkdir`/write, so a rejected config never leaves a half-written
 * file or an empty `config/` directory behind. The default mode is `"snapshot"`,
 * which is what makes a per-UIN file self-contained; the loader passes
 * `"overlay"` only when it is also writing a file that inherited from the global
 * one.
 */
export function saveOneBotConfig(
  uin: string,
  config: OneBotConfig,
  options: SaveOneBotConfigOptions = {},
): void {
  assertRealUin(uin);
  assertValidOneBotConfig(config);
  const configDir = options.configDir ?? CONFIG_DIR;
  ensureConfigDir(configDir);
  saveJson(path.join(configDir, `onebot_${uin}.json`), toJsonObject(config, options.mode ?? "snapshot"));
}

/**
 * The path-traversal gate (§7 step 6.3). Throws the module's own error type so the
 * WebUI's 4xx branch and the manager's non-retryable branch both handle it, and
 * before any filesystem call so a bogus uin has no side effects.
 */
function assertRealUin(uin: string): void {
  if (!isRealUin(uin)) {
    invalid(`uin must be a 5-10 digit QQ number, got ${JSON.stringify(uin)}`);
  }
}

/** Re-exported so callers do not have to import the defaults module for a token. */
export { generateAccessToken };
