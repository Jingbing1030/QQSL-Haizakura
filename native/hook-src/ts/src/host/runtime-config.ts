/**
 * Typed, validated loader for `config/runtime.json` and `config/webui.json`.
 *
 * This is the bottom of the process: `main.ts` refuses to build the object graph
 * until these two files have been read and proven sound. Everything here is a
 * *port* of the reference implementation (`reference/index.mjs`), so every rule
 * and every default carries the line number it came from. If a number here and a
 * number there ever disagree, the reference is right.
 *
 * ## Two layers, on purpose
 *
 * The reference does not validate in one place. It has three boundaries:
 *
 * | boundary | reference | behaviour |
 * | --- | --- | --- |
 * | load  | `normalizeRuntimeConfig` 228-241 | lenient: a bad `webuiPort` *falls back* to 5099 |
 * | write | `coerceSettingsPatch` 357387-357394 | strict: `webuiPort must be an integer in 1..65535` |
 * | restore | `assertNoLossyNormalization` 358428-358466 | strict: rejects anything that would change |
 *
 * The port inherits the *strict* boundary, because a lenient loader is how a
 * typo silently binds 5099 and nobody notices. {@link normalizeRuntimeConfig}
 * is kept as the faithful lenient port (so the fallback semantics stay testable
 * and available), and {@link loadRuntimeConfig} is the strict door the process
 * actually walks through.
 *
 * ## Unknown keys are preserved, never truncated
 *
 * A config written by a newer build must survive a round-trip through this
 * module. {@link loadRuntimeConfig} therefore spreads unknown keys back into its
 * result and reports them via {@link unknownRuntimeConfigKeys}, instead of
 * quietly dropping them the way `normalizeRuntimeConfig` does (that function
 * rebuilds a fixed-shape object, which is right for the reference's own
 * `saveRuntimeConfig` but wrong for a first read).
 *
 * ## Secrets
 *
 * `config/webui.json` holds a password hash and salt. They are validated here
 * and then *deliberately forgotten*: {@link loadWebuiConfig} returns a boolean
 * "is a password set", never the material. No error message in this file
 * includes a hash, a salt, or any file content — only field names and reasons,
 * because these messages end up in logs and bug reports.
 */
import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

// ---------------------------------------------------------------------------
// Defaults, straight out of the reference
// ---------------------------------------------------------------------------

/** `DEFAULT_WEBUI_PORT` — reference/index.mjs:404. */
export const DEFAULT_WEBUI_PORT = 5099;

/** `DEFAULT_WEBUI_HOST` — reference/index.mjs:405. */
export const DEFAULT_WEBUI_HOST = "127.0.0.1";

/** `DEFAULT_LOG_MAX_TOTAL_MB` — reference/index.mjs:406. */
export const DEFAULT_LOG_MAX_TOTAL_MB = 1024;

/** `MAX_LOG_TOTAL_MB` — reference/index.mjs:407. */
export const MAX_LOG_TOTAL_MB = Math.floor(Number.MAX_SAFE_INTEGER / (1024 * 1024));

/** `MAX_LOG_RETAIN_DAYS` — reference/index.mjs:408. */
export const MAX_LOG_RETAIN_DAYS = Math.floor(Number.MAX_SAFE_INTEGER / (1440 * 60 * 1e3));

/** Smallest listen port the reference accepts: `port > 0` at reference/index.mjs:340. */
export const MIN_LISTEN_PORT = 1;

/** Largest listen port the reference accepts: `port <= 65535` at reference/index.mjs:340. */
export const MAX_LISTEN_PORT = 65535;

/** `RUNTIME_CONFIG_PATH` — reference/index.mjs:403. */
export const DEFAULT_RUNTIME_CONFIG_PATH = path.join("config", "runtime.json");

/** `WEBUI_CONFIG_PATH` — reference/index.mjs:356820. */
export const DEFAULT_WEBUI_CONFIG_PATH = path.join("config", "webui.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** `updateSource` — reference/index.mjs:209-223. Absent unless the file has it. */
export interface UpdateSourceConfig {
  readonly mode: "auto" | "direct" | "mirror";
  readonly mirror: string;
  readonly mirrors: readonly string[];
}

/** `webuiTls` — reference/index.mjs:235. Only `enabled` is read. */
export interface RuntimeTlsConfig {
  readonly enabled: boolean;
}

/**
 * The normalized runtime config. Field order and optionality mirror
 * `normalizeRuntimeConfig` (reference/index.mjs:228-241) exactly.
 */
export interface RuntimeConfig {
  /** reference/index.mjs:232 — default {@link DEFAULT_WEBUI_PORT}. */
  readonly webuiPort: number;
  /** reference/index.mjs:233 — default `false`. */
  readonly hookAutoLoad: boolean;
  /** reference/index.mjs:234 — default {@link DEFAULT_WEBUI_HOST}. */
  readonly webuiHost: string;
  /** reference/index.mjs:235 — default `{ enabled: false }`. */
  readonly webuiTls: RuntimeTlsConfig;
  /** reference/index.mjs:236 — default `""`. */
  readonly trustProxy: string;
  /** reference/index.mjs:237 — default {@link DEFAULT_LOG_MAX_TOTAL_MB}. */
  readonly logMaxTotalMb: number;
  /** reference/index.mjs:238 — default `7`. */
  readonly logRetainDays: number;
  /** reference/index.mjs:239 — default `false`. */
  readonly logPerUin: boolean;
  /**
   * reference/index.mjs:231 — no default. When the key is absent the property
   * is absent too; it is never filled in, because "unset" and "auto" are
   * different states upstream.
   */
  readonly updateSource?: UpdateSourceConfig;
}

/**
 * A loaded config: the known, typed fields plus whatever else was in the file,
 * untouched. Indexing an unknown key yields `unknown`, so a consumer must
 * narrow before trusting a value.
 */
export type LoadedRuntimeConfig = RuntimeConfig & {
  readonly [key: string]: unknown;
};

/**
 * What `config/webui.json` is allowed to expose.
 *
 * There is no hash field and no salt field, by construction — not a redacted
 * copy, a different type. A caller that wants the material has to go around
 * this module, which is the point.
 */
export interface WebuiCredentialSummary {
  /** reference/index.mjs:356894 — `mustChangePassword must be a boolean`. */
  readonly mustChangePassword: boolean;
  /**
   * Whether a password is set. `false` only for a missing file (fresh install);
   * after validation a present file always carries a 128-hex hash, so this is
   * `true` — the reference treats that hash as the credential
   * (reference/index.mjs:356892).
   */
  readonly passwordSet: boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A config file was present but unusable. The message never contains file content. */
export class RuntimeConfigError extends Error {
  readonly field: string;

  constructor(field: string, reason: string, options?: { cause?: unknown }) {
    super(`${field} ${reason}`, options);
    this.name = "RuntimeConfigError";
    this.field = field;
  }
}

/** A `config/webui.json` was present but unusable. The message never contains secrets. */
export class WebuiConfigError extends Error {
  readonly field: string;

  constructor(field: string, reason: string, options?: { cause?: unknown }) {
    super(`${field} ${reason}`, options);
    this.name = "WebuiConfigError";
    this.field = field;
  }
}

// ---------------------------------------------------------------------------
// Coercion helpers — faithful ports
// ---------------------------------------------------------------------------

/** True only for a plain, non-null, non-array object. reference/index.mjs:176. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** reference/index.mjs:374-386. Returns `undefined` when the value is not a bool token. */
function parseBoolValue(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  if (raw === 1) return true;
  if (raw === 0) return false;
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes" || value === "on") return true;
  if (value === "false" || value === "0" || value === "no" || value === "off") return false;
  return undefined;
}

/** reference/index.mjs:364-373. Lenient: `1` is true, junk falls back. */
function normalizeBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
    if (v === "false" || v === "0" || v === "no" || v === "off" || v === "") return false;
  }
  return fallback;
}

/** reference/index.mjs:333-336. */
function normalizeHost(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return DEFAULT_WEBUI_HOST;
}

/** reference/index.mjs:337-351. Falls back instead of throwing — that is the reference. */
function normalizePort(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.trunc(value);
    if (n > 0 && n <= 65535) return n;
    return fallback;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      const port = Math.trunc(n);
      if (port > 0 && port <= 65535) return port;
    }
  }
  return fallback;
}

/** reference/index.mjs:352-357. Throws `RangeError` with the reference's wording. */
function normalizeRequiredInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number {
  if (value === undefined) return fallback;
  const n = typeof value === "string" && value.trim() ? Number(value.trim()) : value;
  if (typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max) return n;
  throw new RangeError(`${field} must be an integer in ${String(min)}..${String(max)}`);
}

/** reference/index.mjs:358-363. Throws `TypeError` with the reference's wording. */
function normalizeRequiredBool(value: unknown, fallback: boolean, field: string): boolean {
  if (value === undefined) return fallback;
  const parsed = parseBoolValue(value);
  if (parsed !== undefined) return parsed;
  throw new TypeError(`${field} must be a boolean`);
}

/**
 * TCP bind host accepted by WebUI Listener Exposure.
 * reference/index.mjs:357361-357367, character for character.
 */
export function isValidBindHost(value: string): boolean {
  const host = value.trim();
  if (!host || host !== value || host.length > 253 || /[\s/?#@]/u.test(host)) return false;
  if (host.includes(":")) return isIP(host) === 6;
  if (/^[\d.]+$/.test(host)) return isIP(host) === 4;
  return (host.endsWith(".") ? host.slice(0, -1) : host)
    .split(".")
    .every((label) => /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/.test(label));
}

/** reference/index.mjs:192-202. */
function normalizeMirrorUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("镜像地址必须是 HTTP(S) URL");
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("镜像地址必须是 HTTP(S) URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("镜像地址仅支持 HTTP(S)，不能包含账号、密码、查询参数或片段");
  }
  return url.href.replace(/\/+$/, "");
}

/** reference/index.mjs:209-223. */
function normalizeUpdateSourceConfig(value: unknown): UpdateSourceConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("更新来源必须是对象");
  }
  const record = value as Record<string, unknown>;
  if (
    !("mode" in record) ||
    (record["mode"] !== "auto" && record["mode"] !== "direct" && record["mode"] !== "mirror")
  ) {
    throw new Error("更新来源模式无效");
  }
  if (!("mirrors" in record) || !Array.isArray(record["mirrors"]) || record["mirrors"].length > 16) {
    throw new Error("自动筛选最多支持 16 个镜像");
  }
  const mirror =
    "mirror" in record && record["mirror"] !== "" ? normalizeMirrorUrl(record["mirror"]) : "";
  if (record["mode"] === "mirror" && !mirror) throw new Error("请指定镜像地址");
  const mirrors: string[] = (record["mirrors"] as unknown[]).map((item) => normalizeMirrorUrl(item));
  return {
    mode: record["mode"],
    mirror,
    mirrors: [...new Set(mirrors)],
  };
}

// ---------------------------------------------------------------------------
// Layer 1 — the faithful lenient port
// ---------------------------------------------------------------------------

/**
 * Pure on-disk-object → typed config normalization (defaults + validation, no
 * fs, no env). A faithful port of `normalizeRuntimeConfig`
 * (reference/index.mjs:228-241), including its one sharp edge: an out-of-range
 * `webuiPort` is *replaced by the default*, not rejected.
 *
 * It also drops unknown keys, exactly as the reference does, because the
 * reference feeds this straight into `saveRuntimeConfig` and a rewritten file
 * must not carry fields the running build cannot reason about. Use
 * {@link loadRuntimeConfig} for a first read.
 *
 * @throws {RangeError} when `logMaxTotalMb` / `logRetainDays` are not integers
 *   in range, or `updateSource` is malformed.
 * @throws {TypeError} when `logPerUin` is not a boolean token.
 */
export function normalizeRuntimeConfig(parsed: unknown): RuntimeConfig {
  const obj: Record<string, unknown> = isPlainObject(parsed) ? parsed : {};
  const base: RuntimeConfig = {
    // reference/index.mjs:232 — `obj.webuiPort ?? DEFAULT_WEBUI_PORT`, so `null` also defaults.
    webuiPort: normalizePort(obj["webuiPort"] ?? DEFAULT_WEBUI_PORT, DEFAULT_WEBUI_PORT),
    hookAutoLoad: normalizeBool(obj["hookAutoLoad"], false), // reference/index.mjs:233
    webuiHost: normalizeHost(obj["webuiHost"]), // reference/index.mjs:234
    webuiTls: {
      // reference/index.mjs:235 — a non-object `webuiTls` collapses to `{ enabled: false }`.
      enabled: isPlainObject(obj["webuiTls"])
        ? normalizeBool(obj["webuiTls"]["enabled"], false)
        : false,
    },
    trustProxy: typeof obj["trustProxy"] === "string" ? obj["trustProxy"] : "", // reference/index.mjs:236
    logMaxTotalMb: normalizeRequiredInteger(
      obj["logMaxTotalMb"],
      DEFAULT_LOG_MAX_TOTAL_MB,
      1,
      MAX_LOG_TOTAL_MB,
      "logMaxTotalMb",
    ), // reference/index.mjs:237
    logRetainDays: normalizeRequiredInteger(
      obj["logRetainDays"],
      7,
      0,
      MAX_LOG_RETAIN_DAYS,
      "logRetainDays",
    ), // reference/index.mjs:238
    logPerUin: normalizeRequiredBool(obj["logPerUin"], false, "logPerUin"), // reference/index.mjs:239
  };
  // reference/index.mjs:231 — no default: the key is present only when the file has it.
  if (obj["updateSource"] === undefined) return base;
  return { ...base, updateSource: normalizeUpdateSourceConfig(obj["updateSource"]) };
}

// ---------------------------------------------------------------------------
// Layer 2 — the strict door
// ---------------------------------------------------------------------------

/** Every key `normalizeRuntimeConfig` understands. reference/index.mjs:231-239. */
const KNOWN_RUNTIME_KEYS: ReadonlySet<string> = new Set([
  "updateSource",
  "webuiPort",
  "hookAutoLoad",
  "webuiHost",
  "webuiTls",
  "trustProxy",
  "logMaxTotalMb",
  "logRetainDays",
  "logPerUin",
]);

/**
 * Strict validation: same defaults as the reference, but an out-of-range or
 * wrongly-typed value is an error instead of a silent fallback.
 *
 * Per-field rules come from whichever reference boundary owns the field:
 *
 * - `webuiPort` — `coerceSettingsPatch` (reference/index.mjs:357388-357394):
 *   a real integer, `1..65535`. Numeric strings are *not* accepted here, unlike
 *   the log fields; port `0` and `65536` are both rejected.
 * - `webuiHost` — `validateServer` (reference/index.mjs:5517-5524): a non-empty
 *   string with no surrounding whitespace that passes `isValidBindHost`
 *   (reference/index.mjs:357361).
 * - `hookAutoLoad`, `logPerUin`, `webuiTls.enabled` — `normalizeRequiredBool`
 *   (reference/index.mjs:358-363) / `coerceLogStorageSettingsPatch`
 *   (reference/index.mjs:370324-370329): must be a boolean token.
 * - `logMaxTotalMb`, `logRetainDays` — `normalizeRequiredInteger`
 *   (reference/index.mjs:352-357): an integer in `1..MAX` / `0..MAX`.
 * - `trustProxy` — must be a string; the reference's `""` default
 *   (reference/index.mjs:236) applies only when the key is absent.
 *
 * Unknown keys are preserved in the result.
 *
 * @throws {RuntimeConfigError} naming the field and the reason.
 */
export function validateRuntimeConfig(parsed: unknown): LoadedRuntimeConfig {
  if (!isPlainObject(parsed)) {
    throw new RuntimeConfigError("$", "must be a JSON object");
  }
  const obj = parsed;

  const webuiPort = validatePortField(obj);
  const hookAutoLoad = validateBooleanField(obj, "hookAutoLoad", false);
  const webuiHost = validateHostField(obj);
  const webuiTls = validateTlsField(obj);
  const trustProxy = validateTrustProxyField(obj);
  const logMaxTotalMb = validateIntegerField(
    obj,
    "logMaxTotalMb",
    DEFAULT_LOG_MAX_TOTAL_MB,
    1,
    MAX_LOG_TOTAL_MB,
  );
  const logRetainDays = validateIntegerField(obj, "logRetainDays", 7, 0, MAX_LOG_RETAIN_DAYS);
  const logPerUin = validateBooleanField(obj, "logPerUin", false);
  const updateSource = validateUpdateSourceField(obj);

  // Spread the raw object first so a newer build's keys survive, then overwrite
  // every known field with its validated value. Unknown keys are therefore kept
  // bit-for-bit while known ones cannot disagree with their validation.
  return {
    ...obj,
    ...(updateSource === undefined ? {} : { updateSource }),
    webuiPort,
    hookAutoLoad,
    webuiHost,
    webuiTls,
    trustProxy,
    logMaxTotalMb,
    logRetainDays,
    logPerUin,
  };
}

function validatePortField(obj: Record<string, unknown>): number {
  const raw = obj["webuiPort"];
  if (raw === undefined) return DEFAULT_WEBUI_PORT; // reference/index.mjs:232
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new RuntimeConfigError(
      "webuiPort",
      `must be an integer in ${String(MIN_LISTEN_PORT)}..${String(MAX_LISTEN_PORT)} (got ${describeType(raw)})`,
    );
  }
  // reference/index.mjs:340 — `port > 0 && port <= 65535`, so 0 and 65536 are both out.
  if (raw < MIN_LISTEN_PORT || raw > MAX_LISTEN_PORT) {
    throw new RuntimeConfigError(
      "webuiPort",
      `must be an integer in ${String(MIN_LISTEN_PORT)}..${String(MAX_LISTEN_PORT)} (got ${String(raw)})`,
    );
  }
  return raw;
}

function validateBooleanField(
  obj: Record<string, unknown>,
  field: string,
  fallback: boolean,
): boolean {
  return validateBooleanValue(obj[field], field, fallback);
}

/**
 * The nested-field form. `field` is the *dotted* name used in the error message, while
 * `raw` is the value from whichever object owns it — `webuiTls.enabled` lives one level
 * down, so a lookup by name would silently always miss and always return the default.
 */
function validateBooleanValue(raw: unknown, field: string, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const parsed = parseBoolValue(raw);
  if (parsed !== undefined) return parsed;
  throw new RuntimeConfigError(field, `must be a boolean (got ${describeType(raw)})`);
}

function validateHostField(obj: Record<string, unknown>): string {
  const raw = obj["webuiHost"];
  if (raw === undefined) return DEFAULT_WEBUI_HOST; // reference/index.mjs:234
  if (typeof raw !== "string") {
    throw new RuntimeConfigError("webuiHost", `must be a string (got ${describeType(raw)})`);
  }
  if (!raw.trim()) throw new RuntimeConfigError("webuiHost", "must be a non-empty string");
  if (raw !== raw.trim()) {
    throw new RuntimeConfigError("webuiHost", "must not have surrounding whitespace");
  }
  if (!isValidBindHost(raw)) {
    throw new RuntimeConfigError("webuiHost", "must be a valid TCP bind host");
  }
  return raw;
}

function validateTlsField(obj: Record<string, unknown>): RuntimeTlsConfig {
  const raw = obj["webuiTls"];
  if (raw === undefined) return { enabled: false }; // reference/index.mjs:235
  if (!isPlainObject(raw)) {
    throw new RuntimeConfigError("webuiTls", `must be an object (got ${describeType(raw)})`);
  }
  return { enabled: validateBooleanValue(raw["enabled"], "webuiTls.enabled", false) };
}

function validateTrustProxyField(obj: Record<string, unknown>): string {
  const raw = obj["trustProxy"];
  if (raw === undefined) return ""; // reference/index.mjs:236
  if (typeof raw !== "string") {
    throw new RuntimeConfigError("trustProxy", `must be a string (got ${describeType(raw)})`);
  }
  return raw;
}

function validateIntegerField(
  obj: Record<string, unknown>,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = obj[field];
  if (raw === undefined) return fallback;
  // reference/index.mjs:354 — numeric strings are coerced, everything else is not.
  const n = typeof raw === "string" && raw.trim() ? Number(raw.trim()) : raw;
  if (typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max) return n;
  throw new RuntimeConfigError(
    field,
    `must be an integer in ${String(min)}..${String(max)} (got ${describeType(raw)})`,
  );
}

function validateUpdateSourceField(obj: Record<string, unknown>): UpdateSourceConfig | undefined {
  if (obj["updateSource"] === undefined) return undefined; // reference/index.mjs:231
  try {
    return normalizeUpdateSourceConfig(obj["updateSource"]);
  } catch (error) {
    throw new RuntimeConfigError("updateSource", error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
}

/** A type name safe to put in a log line: never the value itself. */
function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Keys in the raw object that this build does not know about, sorted.
 *
 * The reference only ever reports these while restoring a backup
 * (`unknown field $.foo`, reference/index.mjs:356906; `$.foo is unsupported or
 * would be discarded`, reference/index.mjs:358434). A first read has no such
 * report, which is why the loader preserves them and this function exists: the
 * caller can warn without the config being destroyed.
 */
export function unknownRuntimeConfigKeys(parsed: unknown): string[] {
  if (!isPlainObject(parsed)) return [];
  return Object.keys(parsed)
    .filter((key) => !KNOWN_RUNTIME_KEYS.has(key))
    .sort();
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/**
 * Read, parse and validate `config/runtime.json`.
 *
 * Synchronous on purpose: the reference reads sync (reference/index.mjs:299)
 * and a process entry point has nothing useful to do while waiting. `await`
 * works anyway.
 *
 * @param configPath defaults to `config/runtime.json` relative to the process
 *   working directory, exactly like `RUNTIME_CONFIG_PATH`
 *   (reference/index.mjs:403). Tests pass an absolute temp path.
 * @throws {RuntimeConfigError} when the file is missing, is not JSON, is not an
 *   object, or holds an invalid value.
 */
export function loadRuntimeConfig(
  configPath: string = DEFAULT_RUNTIME_CONFIG_PATH,
): LoadedRuntimeConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new RuntimeConfigError("$", `runtime config not found at ${configPath}`, { cause: error });
    }
    throw new RuntimeConfigError(
      "$",
      `runtime config at ${configPath} could not be read (${code ?? "unknown error"})`,
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // The parser's own message names the offset and never echoes content.
    throw new RuntimeConfigError(
      "$",
      `runtime config at ${configPath} is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }

  return validateRuntimeConfig(parsed);
}

/**
 * Read `config/webui.json` and return only what a caller may see:
 * `mustChangePassword` and whether a password is set.
 *
 * Validation mirrors `prepareWebuiAuthStateForRestore`
 * (reference/index.mjs:356889-356917): 128 hex chars for the hash, 32 for the
 * salt, boolean `mustChangePassword`, parseable timestamps, and no unknown
 * keys. A missing file is *not* an error — the reference treats that as a fresh
 * install and generates a bootstrap password (reference/index.mjs:356993-357016),
 * but generating one means writing to `config/`, which this module must never
 * do. So a missing file yields `{ mustChangePassword: false, passwordSet: false }`
 * and leaves the decision to the caller.
 *
 * A file that exists but is corrupt or fails the schema *is* an error. Silently
 * reporting "no password" for an unreadable file would open the WebUI, which is
 * exactly the failure the reference's backup-and-regenerate dance exists to
 * avoid.
 *
 * @throws {WebuiConfigError} naming the field and the reason — never a value.
 */
export function loadWebuiConfig(
  configPath: string = DEFAULT_WEBUI_CONFIG_PATH,
): WebuiCredentialSummary {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { mustChangePassword: false, passwordSet: false };
    throw new WebuiConfigError(
      "$",
      `webui config at ${configPath} could not be read (${code ?? "unknown error"})`,
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new WebuiConfigError(
      "$",
      `webui config at ${configPath} is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }

  return summarizeWebuiAuthState(parsed);
}

/**
 * Pure half of {@link loadWebuiConfig}: validate credential state and keep only
 * the two non-secret facts. Exported so the schema can be tested without a file.
 *
 * @throws {WebuiConfigError} naming the field — never a value.
 */
export function summarizeWebuiAuthState(value: unknown): WebuiCredentialSummary {
  if (!isPlainObject(value)) {
    throw new WebuiConfigError("$", "credential state must be an object");
  }
  const v = value;

  if (typeof v["passwordHash"] !== "string" || !/^[0-9a-f]{128}$/i.test(v["passwordHash"])) {
    throw new WebuiConfigError("passwordHash", "must be exactly 128 hexadecimal characters");
  }
  if (typeof v["passwordSalt"] !== "string" || !/^[0-9a-f]{32}$/i.test(v["passwordSalt"])) {
    throw new WebuiConfigError("passwordSalt", "must be exactly 32 hexadecimal characters");
  }
  if (typeof v["mustChangePassword"] !== "boolean") {
    throw new WebuiConfigError("mustChangePassword", "must be a boolean");
  }
  if (typeof v["generatedAt"] !== "string" || !Number.isFinite(Date.parse(v["generatedAt"]))) {
    throw new WebuiConfigError("generatedAt", "must be a valid timestamp");
  }
  if (typeof v["updatedAt"] !== "string" || !Number.isFinite(Date.parse(v["updatedAt"]))) {
    throw new WebuiConfigError("updatedAt", "must be a valid timestamp");
  }

  // reference/index.mjs:356897-356906 — an unknown key means the file was
  // written by a build whose schema this one does not share, so refuse rather
  // than guess. `totp` is allowed by the reference but not interpreted here.
  const allowed = new Set([
    "passwordHash",
    "passwordSalt",
    "mustChangePassword",
    "generatedAt",
    "updatedAt",
    "totp",
  ]);
  const unknown = Object.keys(v).find((key) => !allowed.has(key));
  if (unknown !== undefined) throw new WebuiConfigError("$", `unknown field ${unknown}`);

  // Only booleans leave this function. The hash and salt are read, checked, and
  // dropped here — there is no code path that returns them.
  return {
    mustChangePassword: v["mustChangePassword"],
    passwordSet: typeof v["passwordHash"] === "string" && v["passwordHash"].length > 0,
  };
}
