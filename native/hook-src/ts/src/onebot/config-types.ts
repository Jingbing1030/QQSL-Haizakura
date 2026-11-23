// The type tree of the per-UIN OneBot config file.
//
// Reference region: ../onebot/src/config.ts L5149-L5180 (`makeDefaultOneBotConfig`,
// the only place the canonical shape is written down) plus the strict validator at
// L5451-L5491, which is what turns the loose on-disk shape into this one.
//
// Three things about this shape are worth stating once, here, because every other
// `config-*` file depends on them:
//
//   1. The **on-disk** shape is looser than the **in-memory** shape. On disk an
//      adapter may omit `name`, `messageFormat` and `reportSelfMessage`; after
//      `fromJson` none of them can be missing (`assertValidOneBotConfig` runs on
//      `fromJson`'s own output, spec §3.2). The interfaces below describe the
//      post-load shape, so `name` is required and the two defaults are optional
//      only because the reference's own writer emits them unconditionally and
//      older files may not have them. `resolveReportOptions` in `types.ts` fills
//      them at read time either way.
//   2. `notifications` is the **only** optional top-level section. The consumer
//      that matters — `notifications/manager.ts` — loads it as
//      `loadOneBotConfig(uin).notifications?.channelIds ?? []`, so the `?.` and
//      the `?? []` are part of the contract, not defensive noise.
//   3. `musicSignUrl` is **not** part of this shape (spec §7 step 1.5): it was
//      lifted into the global config file (`config/snowluma.json`) and is only
//      read on the restore/backup path. Do not add it back.
//
// The adapter interfaces are re-exported rather than redeclared — they already
// exist and are used by the live transports, and a second structurally-identical
// declaration would drift.

import type { ForwardRole, NetworkBaseConfig, WsServerConfig } from "./adapter.js";
import type { HttpClientConfig, HttpServerConfig } from "./http.js";
import type { WsClientConfig } from "./ws.js";

export type { ForwardRole, HttpServerConfig, HttpClientConfig, WsClientConfig, WsServerConfig };

/**
 * §3 `OneBotAdapterBase` — the fields every adapter shares.
 *
 * `name` doubles as the merge key across config sources (`collectByName`) and as
 * the process-wide uniqueness key inside one account, so it is one namespace per
 * account, not four independent ones.
 */
export type OneBotAdapterBase = NetworkBaseConfig;

/** §3 `OneBotNetworks` — all four lists are always present and may be empty. */
export interface OneBotNetworks {
  httpServers: HttpServerConfig[];
  httpClients: HttpClientConfig[];
  wsServers: WsServerConfig[];
  wsClients: WsClientConfig[];
}

/**
 * §3 `StatusCommandConfig`.
 *
 * `cooldownSeconds` is clamped to `[0, STATUS_COMMAND_COOLDOWN_MAX]` on load
 * (spec §3.6) — a year is "off but sane" — and `trigger` is trimmed and cut to 32
 * characters. Both clamps happen in the merge, never in the validator.
 */
export interface StatusCommandConfig {
  enabled: boolean;
  /** Hide the trigger message from the adapters after replying. */
  swallow: boolean;
  cooldownSeconds: number;
  /** Non-empty, single-line, at most 32 characters. */
  trigger: string;
}

/**
 * §3 `HistorySyncConfig`.
 *
 * Read exactly once per `OneBotInstance`, at construction (L342763), and never
 * re-read on `reloadConfig` — toggling it needs a session restart. That is why
 * `parseHistorySync` is allowed to be strict while its neighbours are lenient
 * (spec §4.4): a typo here would be invisible for the life of the process.
 */
export interface HistorySyncConfig {
  enabled: boolean;
}

/**
 * §3 `NotificationsConfig`.
 *
 * Slugs: `^[\w.-]+$`, 1…64 characters, order preserved, duplicates dropped.
 * Invalid ids are **silently discarded** on load (they are rejected only on the
 * restore path), and the whole list is last-write-wins across sources — a
 * per-UIN file containing `channelIds: []` clears a global list (spec §3.5).
 */
export interface NotificationsConfig {
  channelIds: string[];
}

/** §3 the canonical config, as returned by `loadOneBotConfig` / `fromJson`. */
export interface OneBotConfig {
  networks: OneBotNetworks;
  statusCommand: StatusCommandConfig;
  historySync: HistorySyncConfig;
  /** The only top-level section the validator does not require. */
  notifications?: NotificationsConfig;
}

/**
 * The `mode` discriminator a `onebot_<uin>.json` carries (spec §3.3).
 *
 * `"snapshot"` is self-contained: the global `onebot.json` is *not* merged in.
 * `"overlay"` makes the global file the first source, with this file winning per
 * adapter name and per section key.
 */
export type OneBotConfigMode = "snapshot" | "overlay";
