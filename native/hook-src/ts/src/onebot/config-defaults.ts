// Factory defaults for the per-UIN OneBot config.
//
// Reference region: ../onebot/src/config.ts L5129-L5181 — the constant block plus
// `makeDefaultStatusCommand`, `generateAccessToken` and `makeDefaultOneBotConfig`.
//
// These are the values a fresh install is bootstrapped with, so they are also the
// values every merge falls back to (`parseStatusCommand` starts from
// `makeDefaultStatusCommand()`; `fromJson` injects the factory listeners only when
// *no* config file existed at all — spec §4.3).
//
// Two details that look like typos in the reference and are not:
//
//   * the HTTP factory listener is port **3000** (`3e3` in the bundle, kept as
//     `3000` here — the float literal is an artifact and only trips readers);
//     the WS factory listener is **3001**.
//   * each call to `makeDefaultOneBotConfig()` mints **two fresh** access tokens,
//     so two calls never compare equal. Anything that wants a deterministic
//     golden value has to stub tokens.

import { randomBytes } from "node:crypto";
import path from "node:path";

import type { OneBotConfig, StatusCommandConfig } from "./config-types.js";

/**
 * The directory every OneBot config file lives in, relative to the process CWD.
 *
 * The reference hardcodes the same relative string, which is why `loadOneBotConfig`
 * has a filesystem side effect on a read (`ensureConfigDir` — spec §4.1 step 1).
 * `config.ts` takes an explicit directory so tests do not have to `chdir`.
 */
export const CONFIG_DIR = "config";

/** L5129 — the **global** (all-account) overlay file. Read, never written here. */
export const DEFAULT_CONFIG_PATH = path.join(CONFIG_DIR, "onebot.json");

/** L5130 — entropy for factory access tokens: 32 bytes → 43 base64url chars. */
export const DEFAULT_ACCESS_TOKEN_BYTES = 32;

/** L5131 — the largest delay `setTimeout` accepts; upper bound for `timeoutMs`. */
export const NODE_TIMER_MAX_MS = 2_147_483_647;

/** L5135 — floor for a per-adapter inbound WebSocket frame cap. */
export const MAX_PAYLOAD_BYTES_MIN = 1024;

/**
 * L5136 — cap for the same. 2 GiB is several orders of magnitude past any real
 * OneBot frame; above that a sender has to split its payload instead of expecting
 * a single buffer to hold it.
 */
export const MAX_PAYLOAD_BYTES_MAX = 2 * 1024 * 1024 * 1024;

/**
 * L5137 — the `mode` value meaning "self-contained, do not merge the global file".
 * Per-UIN files written by `saveOneBotConfig` default to this (spec §3.3).
 */
export const PER_UIN_SNAPSHOT_MARKER = "snapshot";

/** L5145 — upper bound on the status-command cooldown: a year, "off but sane". */
export const STATUS_COMMAND_COOLDOWN_MAX = 31_536_000;

/** L5206 — the factory HTTP listener name; only this one takes an env port. */
export const HTTP_DEFAULT_SERVER = "http-default";

/** L5207 — the factory WS listener name; ditto. */
export const WS_DEFAULT_SERVER = "ws-default";

/** L5138 — the `#hz` status command defaults, before any file is merged in. */
export const DEFAULT_STATUS_COMMAND: Readonly<StatusCommandConfig> = Object.freeze({
  enabled: true,
  swallow: false,
  cooldownSeconds: 5,
  trigger: "#hz",
});

/** L5146 `makeDefaultStatusCommand` — a fresh copy, never the shared const. */
export function makeDefaultStatusCommand(): StatusCommandConfig {
  return { ...DEFAULT_STATUS_COMMAND };
}

/**
 * L5181 `generateAccessToken` — 32 random bytes, base64url, 43 characters.
 *
 * Also used by the Satori server factory (`network/satori-server-adapter.ts`), so
 * it is exported rather than private to the defaults.
 */
export function generateAccessToken(): string {
  return randomBytes(DEFAULT_ACCESS_TOKEN_BYTES).toString("base64url");
}

/**
 * L5149 `makeDefaultOneBotConfig` — the shape a fresh install starts from.
 *
 * `networks` carries one HTTP listener (3000) and one WS listener (3001), both
 * bound to loopback, both with a freshly minted token; `notifications` is present
 * with an empty channel list, which is why `toJsonObject` can always emit it.
 */
export function makeDefaultOneBotConfig(): OneBotConfig {
  return {
    networks: {
      httpServers: [
        {
          name: HTTP_DEFAULT_SERVER,
          host: "127.0.0.1",
          port: 3000,
          path: "/",
          enableWebSocket: false,
          enableSse: false,
          accessToken: generateAccessToken(),
          messageFormat: "array",
          reportSelfMessage: false,
        },
      ],
      httpClients: [],
      wsServers: [
        {
          name: WS_DEFAULT_SERVER,
          host: "127.0.0.1",
          port: 3001,
          path: "/",
          role: "Universal",
          accessToken: generateAccessToken(),
          messageFormat: "array",
          reportSelfMessage: false,
        },
      ],
      wsClients: [],
    },
    statusCommand: makeDefaultStatusCommand(),
    historySync: { enabled: false },
    notifications: { channelIds: [] },
  };
}
