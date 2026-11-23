# OneBot config surface — `../onebot/src/config.ts`

API surface map of the reference region, extracted so it can be ported into
`ts/src/`. **Nothing here is production code**; it is a specification with
evidence grades.

Source: `reference/index.mjs`, 13,916,690 B / **374,326 lines**, md5
`aa573eba11688960282efa2e41e6661b` (`stat -c %s` and `wc -l` both agree with the
task statement).

Evidence grades used throughout:

| grade | meaning |
| --- | --- |
| 【实测】 | I ran the code (extracted region + stubbed deps, see §1.2) and observed the output |
| 【指令级】 | static reading of the bundle; quote given |
| 【推断】 | inferred from morphology / call shape, not directly observed |
| 【未确认】 | not verified |

---

## 1. Region bounds

### 1.1 Commands and output

```console
$ grep -n '^//#region \.\./onebot/src/config\.ts$' reference/index.mjs
5124://#region ../onebot/src/config.ts

$ awk 'NR>5124 && /^\/\/#region/ {print NR": "$0; exit}' reference/index.mjs
5932: //#region ../onebot/src/global-config.ts

$ awk 'NR>=5124 && NR<=5931' reference/index.mjs | wc -l
808

$ awk 'NR>=5124 && NR<=5931' reference/index.mjs | wc -c
35951
```

| fact | value |
| --- | --- |
| Start line (`//#region` marker) | **5124** |
| First code line | 5125 (`init_env();`) |
| Last code line | 5930 |
| End marker (`//#endregion`) | **5931** |
| Next region | 5932 `../onebot/src/global-config.ts` |
| Lines **inside the markers** (5125–5930) | **806** |
| Lines **including both markers** (5124–5931) | **808** |
| Bytes including markers | 35,951 |

The region is the **36th** of the bundle's regions
(`awk 'NR<=5124 && /^\/\/#region/ {n++} END{print n}'` → `36`). Its neighbours are
`../protocol/src/highway/upload-settings.ts` (5110–5123) and
`../onebot/src/global-config.ts` (5932–6083) — the latter is where
`musicSignUrl` / `rkey.fallbackServers` / `videoUploadConcurrency` live, i.e.
**global (all-account) settings are a separate region and a separate file**
(`config/snowluma.json`, `L5941`).

> Note: the file is 13,916,690 B — the figure in the task statement is exact.
> Line numbers here were all read from the file on disk and the region bounds
> were re-verified twice (§1.1). 【实测】

### 1.2 How the "实测" evidence was obtained

The region needs 4 host functions (`createLogger`, `positiveIntEnv`,
`isRealUin`, `init_env`/`init_logger` no-ops) and 5 Node built-ins
(`fs`, `path`, `node:net`'s `isIP`, `node:crypto`'s `randomBytes`). I copied
lines **5125–5930** verbatim into `/tmp/cfgtest/run/cfg.mjs`, prepended ~25
lines of stubs whose bodies were copied from the bundle (`createLogger` L1556,
`positiveIntEnv` L1664, `isRealUin` L1654), appended an `export {…}` line, and
ran probes `t1.mjs`…`t10.mjs` against it in a scratch `config/` directory.

**No file in the repo was modified.** `build/` was not touched; `npx tsc` and
`node --test` were never run. Every 【实测】 result below reproduces from that
harness.

---

## 2. Exported symbols

74 top-level declarations (enumerated by
`awk 'NR>=5124 && NR<=5931' … | grep -E '^(function|var|let|const|class)'` →
74 rows). Only **10** are consumed from outside the region 【实测】:

```console
$ for s in …; do printf '%-32s ' "$s"; grep -nP "(?<![\w\$])$s(?![\w\$])" reference/index.mjs | cut -d: -f1 | tr '\n' ' '; echo; done
makeDefaultOneBotConfig          5149 5689 344683
makeDefaultStatusCommand         5146 5176 5749
generateAccessToken              5159 5170 5181 344669
OneBotConfigValidationError      5186 5189 5575 345171 373763
loadOneBotConfig                 5192 345240 348813 373726 373752
saveOneBotConfig                 5203 5243 373760
assertValidOneBotConfig          5218 5244 5451 5704 341941 373748
prepareOneBotConfigForRestore    5254 358360
applyOneBotListenPortOverrides   5204 5209
cleanupInvalidPerUinConfigs      5589 374207
```

Everything else is region-private. Proof that the constants never escape:

```console
$ grep -nP '(?<![\w\$])(DEFAULT_CONFIG_PATH|CONFIG_DIR\$5|…|RESTORE_BASE_ADAPTER_KEYS)(?![\w\$])' reference/index.mjs \
    | awk -F: '$1<5124 || $1>5931'
344683:// ❌ v1 曾尝试 RESTORE_NETWORK_KEYS.add("satoriServers") + 猴补 makeDefaultOneBotConfig。
344685://      config.ts:222  for (const key of RESTORE_NETWORK_KEYS)
```

…and both hits are **comment text inside `src/network/satori-mount.ts`**, not
code. 【实测】

### 2.1 Defaults

| symbol | line | signature | returns | purpose |
| --- | --- | --- | --- | --- |
| `DEFAULT_CONFIG_PATH` | 5129 | `const string` | `"config/onebot.json"` | the **global** (all-account) config file |
| `DEFAULT_ACCESS_TOKEN_BYTES` | 5130 | `const 32` | — | entropy for factory access tokens |
| `NODE_TIMER_MAX_MS` | 5131 | `const 2147483647` | — | upper bound for `timeoutMs` / `reconnectIntervalMs` |
| `MAX_PAYLOAD_BYTES_MIN` | 5135 | `const 1024` | — | floor for per-adapter `maxPayloadBytes` |
| `MAX_PAYLOAD_BYTES_MAX` | 5136 | `const 2 * 1024 * 1024 * 1024` = `2147483648` | — | cap for the same |
| `PER_UIN_SNAPSHOT_MARKER` | 5137 | `const "snapshot"` | — | the `mode` value meaning "self-contained, do not merge global" |
| `DEFAULT_STATUS_COMMAND` | 5138 | `const {enabled,swallow,cooldownSeconds,trigger}` | `{true,false,5,"#hz"}` | the `#hz` status command defaults |
| `STATUS_COMMAND_COOLDOWN_MAX` | 5145 | `const 31536e3` = `31536000` | — | one year; "off but sane" |
| `makeDefaultStatusCommand()` | 5146 | `(): StatusCommandConfig` | fresh copy of the above | **exported** — do not hand out the shared const |
| `makeDefaultOneBotConfig()` | 5149 | `(): OneBotConfig` | full config incl. 2 factory adapters **with fresh random tokens** | **exported**; only non-comment external hit is `satori-mount.ts:344683` |
| `generateAccessToken()` | 5181 | `(): string` | 32 random bytes, base64url (43 chars) | **exported**; used by `satori-server-adapter.ts:344669` |
| `HTTP_DEFAULT_SERVER` | 5206 | `const "http-default"` | — | factory listener name; only these get env port overrides |
| `WS_DEFAULT_SERVER` | 5207 | `const "ws-default"` | — | ditto |
| `PER_UIN_CONFIG` | 5580 | `const /^onebot_(\d+)\.json$/` | — | matcher for `cleanupInvalidPerUinConfigs` |

`makeDefaultOneBotConfig()` verbatim (L5149–5180):

```js
function makeDefaultOneBotConfig() {
	return {
		networks: {
			httpServers: [{
				name: "http-default", host: "127.0.0.1", port: 3e3, path: "/",
				enableWebSocket: false, enableSse: false,
				accessToken: generateAccessToken(),
				messageFormat: "array", reportSelfMessage: false
			}],
			httpClients: [],
			wsServers: [{
				name: "ws-default", host: "127.0.0.1", port: 3001, path: "/",
				role: "Universal",
				accessToken: generateAccessToken(),
				messageFormat: "array", reportSelfMessage: false
			}],
			wsClients: []
		},
		statusCommand: makeDefaultStatusCommand(),
		historySync: { enabled: false },
		notifications: { channelIds: [] }
	};
}
```

Two behavioural details that matter for a port 【实测】:
* `port: 3e3` is **3000** (not 3001) and the factory WS listener is **3001**.
* each call mints **two new tokens**; a fresh install therefore writes two
  `base64url` strings, 43 chars each.

### 2.2 Loading

| symbol | line | signature | returns | purpose |
| --- | --- | --- | --- | --- |
| `loadOneBotConfig(uin, options?)` | 5192 | `(uin: string, options?: {persistDefaults?: boolean}) => OneBotConfig` | merged, validated, port-overridden config | **the entry point.** Reads global + per-UIN, merges, validates, optionally persists, applies env ports |
| `tryLoadJson(filePath, failOnCorrupt?)` | 5886 | `(string, boolean=false) => object \| null` | parsed object or `null` | per-file JSON read with the corrupt-file policy (§4) |
| `fromJson(sources, freshInstall)` | 5672 | `(sources: object[], freshInstall: boolean) => OneBotConfig` | canonical config | the merge+normalize engine; **pure**, no fs |
| `collectByName(sources, kind, parse, legacyKey?)` | 5760 | see below | `T[]` | merge adapter arrays **by `name`**, last-write-wins, order of first appearance |
| `pickAutoName(kind, used, counter)` | 5783 | `(kind, Map, number) => string` | `http-N` / `httppost-N` / `ws-N` / `wsclient-N` | names unnamed adapters |
| `parseHttpServer` / `parseHttpClient` / `parseWsServer` / `parseWsClient` | 5801/5817/5829/5842 | `(raw, defaults) => Adapter \| null` | `null` = "drop this entry" | per-kind lenient normalization |
| `parseBase(value, defaults)` | 5792 | `(raw, {messageFormat, reportSelfMessage}) => Base` | shared adapter fields | |
| `parseStatusCommand(sources)` | 5748 | `(sources) => StatusCommandConfig` | always complete | LWW + clamp |
| `parseHistorySync(sources)` | 5707 | `(sources) => {enabled: boolean}` | always complete | **strict, unlike the others** (§4.4) |
| `parseNotifications(sources)` | 5723 | `(sources) => {channelIds: string[]}` | always complete | **LWW, not union** (§3.5) |
| `normalizeChannelIds(value)` | 5732 | `(value: unknown) => string[]` | filtered, deduped, order-preserving | slug rule `^\w.-+$`, ≤64 chars |
| `hasLegacyTopLevel(raw)` | 5856 | `(raw) => boolean` | — | detects the pre-`networks` shape |
| `applyOneBotListenPortOverrides(config, env?)` | 5209 | `(OneBotConfig, env = process.env) => OneBotConfig` | config, possibly a clone with 2 ports changed | **exported**; `SNOWLUMA_ONEBOT_HTTP_PORT` / `SNOWLUMA_ONEBOT_WS_PORT` |
| `readListenPort(name, env)` | 5225 | `(string, env) => number \| undefined` | 1–65535 or undefined | |
| `assignFactoryPort(servers, name, port, envName)` | 5234 | `(servers, string, number, string) => boolean` | did it find the factory listener | warns when absent |
| `ensureConfigDir$4()` | 5577 | `() => void` | — | `mkdirSync("config", {recursive:true})` |
| `parseMessageFormat(value)` | 5859 | `(value) => "array" \| "string" \| undefined` | — | |
| `asRole(value, fallback)` | 5866 | `(value, "Universal") => "Api" \| "Event" \| "Universal"` | case-insensitive, fallback on garbage | |
| `asString$1(value, fallback="")` | 5873 | numbers/booleans are stringified | — | lenient |
| `asNumber(value, fallback=0)` | 5878 | finite → `Math.max(0, Math.trunc(n))`; numeric strings too | — | lenient, **clamps negatives to 0** |
| `clean(obj)` | 5862 | `(T) => T` | `obj` with `undefined`-valued keys deleted | keeps saved JSON free of `null` |
| `isObject$4(value)` | 5922 | `(unknown) => boolean` | non-null, non-array | |
| `isValidBindHost$1(value)` | 5925 | `(string) => boolean` | IP or DNS label check | **duplicate** of `isValidBindHost` at L357361 (webui) 【实测】 |

`collectByName` verbatim (L5760–5782) — this is the merge rule everything else
depends on:

```js
function collectByName(sources, kind, parse, legacyKey) {
	const byName = new Map(); const order = []; let counter = 0;
	const ingest = (rawArr) => {
		if (!Array.isArray(rawArr)) return;
		for (const raw of rawArr) {
			if (!isObject$4(raw)) continue;
			const parsed = parse(raw);
			if (!parsed) continue;
			const name = parsed.name && parsed.name.trim() ? parsed.name.trim() : pickAutoName(kind, byName, ++counter);
			parsed.name = name;
			if (!byName.has(name)) order.push(name);
			byName.set(name, parsed);
		}
	};
	for (const src of sources) {
		ingest(isObject$4(src.networks) ? src.networks[kind] : void 0);
		if (legacyKey) ingest(src[legacyKey]);          // httpPostEndpoints
		ingest(src[kind]);                              // legacy top-level
	}
	return order.map((n) => byName.get(n));
}
```

### 2.3 Saving

| symbol | line | signature | purpose |
| --- | --- | --- | --- |
| `saveOneBotConfig(uin, config, options?)` | 5243 | `(uin, OneBotConfig, {mode?: "snapshot"\|"overlay"}) => void` | **exported.** Validates *first*, then writes `config/onebot_<uin>.json` |
| `toJsonObject(config, mode)` | 5610 | `(OneBotConfig, mode) => object` | canonical serializer; always emits `mode` + all 4 network kinds + the 3 non-network sections |
| `applyBase(out, n)` | 5630 | `(out, adapter) => void` | shared fields; **omits `enabled` unless `false`**, omits empty token |
| `httpServerToJson` / `httpClientToJson` / `wsServerToJson` / `wsClientToJson` | 5638–5671 | `(adapter) => object` | per-kind; fill defaults (`host ?? "0.0.0.0"`, `path ?? "/"`, `role ?? "Universal"`) |
| `saveJson(filePath, json)` | 5900 | `(string, unknown) => void` | atomic write: temp → `fsync` → `rename`, mode `0o600`, cleans up on failure |

`saveOneBotConfig` verbatim (L5243–5247) — note the ordering:

```js
function saveOneBotConfig(uin, config, options = {}) {
	assertValidOneBotConfig(config);
	ensureConfigDir$4();
	saveJson(path$1.join(CONFIG_DIR$5, `onebot_${uin}.json`), toJsonObject(config, options.mode ?? "snapshot"));
}
```

`saveJson` verbatim (L5900–5921):

```js
function saveJson(filePath, json) {
	const dir = path$1.dirname(filePath);
	fs$1.mkdirSync(dir, { recursive: true });
	const tempPath = path$1.join(dir, `.${path$1.basename(filePath)}.${String(process.pid)}.${randomBytes$1(6).toString("hex")}.tmp`);
	let fd = null;
	try {
		fd = fs$1.openSync(tempPath, "wx", 384);          // 384 === 0o600
		fs$1.writeFileSync(fd, JSON.stringify(json, null, 2), "utf8");
		fs$1.fsyncSync(fd);
		fs$1.closeSync(fd);
		fd = null;
		fs$1.renameSync(tempPath, filePath);
	} catch (error) {
		if (fd !== null) try { fs$1.closeSync(fd); } catch {}
		try { fs$1.unlinkSync(tempPath); } catch {}
		throw error;
	}
}
```

【实测】 the written file is mode `600` and leaves no `.tmp` behind
(`S mode: 600`, `S no .tmp left: 0`).

### 2.4 Validation

| symbol | line | kind | purpose |
| --- | --- | --- | --- |
| `OneBotConfigValidationError` | 5186 | `class extends Error` | **exported.** `name = "OneBotConfigValidationError"`; the marker callers use to answer 4xx |
| `invalid(message)` | 5574 | `(msg) => never` | `throw new OneBotConfigValidationError(msg)` |
| `assertValidOneBotConfig(value)` | 5451 | `(unknown) => void` | **exported.** The **strict** validator: full shape, all networks lists present, cross-adapter name uniqueness, bind-conflict detection, `statusCommand`/`historySync` mandatory, `notifications` optional |
| `validateNetworkList(networks, kind, seen, validateSpecific)` | 5493 | — | array-ness, per-item object, base fields, duplicate-name detection |
| `validateNetworkBase(item, at)` | 5508 | — | `name` non-empty & trimmed, `messageFormat` ∈ {array,string}, `reportSelfMessage` boolean |
| `parseMaxPayloadBytes(value, at)` | 5517 | `(unknown, string) => number\|undefined` | 1024…2147483648, safe integer |
| `rejectHttpClientMaxPayloadBytes(item, at)` | 5522 | — | HTTP-client adapters may **not** set it |
| `validateServer(item, at)` | 5525 | — | port 1–65535, host valid bind host + trimmed, path normalized URL pathname |
| `validateServerBinding(item, at, bindings)` | 5542 | — | exact `host:port` and wildcard-port collision detection |
| `validateClient(item, at, protocols)` | 5559 | — | `url` string; when enabled must parse and match `http:`/`https:` or `ws:`/`wss:` |
| `validateRole(value, at)` | 5571 | — | `Api` \| `Event` \| `Universal` (title case only) |
| `validateOneBotRestoreSource(value)` | 5302 | — | **restore-only** strict walker; `rejectUnknownKeys` at every level |
| `validateRestoreAdapterArray(value, kind, at)` | 5339 | `(…) => number` | returns the raw count for the post-`fromJson` "nothing got dropped" check |
| `validateRestoreStatusCommand(value)` | 5394 | — | |
| `validateRestoreNotifications(value)` | 5414 | — | this is the strict gate for `channelIds` |
| `validateRestoreHistorySync(value)` | 5426 | — | |
| `rejectUnknownKeys(value, allowed, at)` | 5432 | — | `` invalid(`${at}.${unknown} is not supported`) `` |
| `parseRestoreInteger(value)` | 5436 | `(unknown) => number \| null` | numeric strings accepted |
| `isHttpUrlForRestore(value)` | 5440 | `(string) => boolean` | `http:`/`https:` **and** non-empty host |

`RESTORE_TOP_LEVEL_KEYS` (L5274), `RESTORE_NETWORK_KEYS` (L5289) and
`RESTORE_BASE_ADAPTER_KEYS` (L5295) are the allowlists:

```js
var RESTORE_TOP_LEVEL_KEYS = new Set([
	"mode","networks","statusCommand","historySync","notifications","musicSignUrl",
	"httpServers","httpClients","httpPostEndpoints","wsServers","wsClients",
	"messageFormat","reportSelfMessage"
]);
var RESTORE_NETWORK_KEYS = new Set(["httpServers","httpClients","wsServers","wsClients"]);
var RESTORE_BASE_ADAPTER_KEYS = [
	"name","enabled","accessToken","messageFormat","protocol","reportSelfMessage"
];
```

Note `musicSignUrl` is still in the **top-level allowlist** even though the
canonical shape no longer contains it — that is the deprecated-but-read rule
(§3.7).

### 2.5 Migration

| symbol | line | purpose |
| --- | --- | --- |
| `hasLegacyTopLevel(raw)` | 5856 | detects the pre-`networks` layout |
| `collectByName(..., legacyKey)` | 5760 | merges `httpPostEndpoints` into `httpClients` |
| `parseBase` / `parseHttpServer`… | 5792+ | absorb per-source `messageFormat`/`reportSelfMessage` as adapter defaults |
| `cleanupInvalidPerUinConfigs()` | 5589 | **exported.** Deletes `config/onebot_<n>.json` whose `<n>` fails `isRealUin` |
| `prepareOneBotConfigForRestore(value, scope, inheritedGlobal)` | 5254 | **exported.** Migrates an *on-disk backup payload* to canonical form without touching fs |

`hasLegacyTopLevel` verbatim (L5856–5858):

```js
function hasLegacyTopLevel(raw) {
	return Array.isArray(raw.httpServers) || Array.isArray(raw.httpPostEndpoints) || Array.isArray(raw.wsServers) || Array.isArray(raw.wsClients) || typeof raw.messageFormat === "string" || typeof raw.reportSelfMessage === "boolean";
}
```

`prepareOneBotConfigForRestore` verbatim (L5254–5273):

```js
function prepareOneBotConfigForRestore(value, scope, inheritedGlobal) {
	if (!isObject$4(value)) invalid("restore source must be an object");
	validateOneBotRestoreSource(value);
	let global = null;
	if (inheritedGlobal !== void 0 && inheritedGlobal !== null) {
		if (!isObject$4(inheritedGlobal)) invalid("inherited global restore source must be an object");
		validateOneBotRestoreSource(inheritedGlobal);
		global = inheritedGlobal;
	}
	if (scope === "global") return { value, migratedFields: [] };
	const canonical = toJsonObject(fromJson(value.mode !== PER_UIN_SNAPSHOT_MARKER && global ? [global, value] : [value], false), scope === "per-uin" && value.mode === PER_UIN_SNAPSHOT_MARKER ? "snapshot" : "overlay");
	if (Object.prototype.hasOwnProperty.call(value, "musicSignUrl")) canonical.musicSignUrl = value.musicSignUrl;
	return {
		value: canonical,
		migratedFields: JSON.stringify(value) === JSON.stringify(canonical) ? [] : ["$"]
	};
}
```

### 2.6 Helpers

All of them are listed in §2.2 (`asString$1`, `asNumber`, `asRole`, `clean`,
`isObject$4`, `parseMessageFormat`, `isValidBindHost$1`, `pickAutoName`). The one
worth flagging is `asNumber`, because it silently changes semantics:

```js
function asNumber(value, fallback = 0) {
	if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
	if (typeof value === "string" && value.trim()) {
		const n = Number(value);
		if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
	}
	return fallback;
}
```

`port: "6700"` (a string) therefore loads as `6700`; `port: -5` loads as `0`,
which the server parsers then reject as "not a server" and **drop the entry**
(§4.5). 【实测】

---

## 3. The config schema

Derived from `makeDefaultOneBotConfig()` (L5149) plus **every** read site of
every field (§5). Types are TypeScript; the bundle has no type annotations, so
types come from the validators.

```ts
/** `config/onebot_<uin>.json`, also `config/onebot.json` (global overlay). */
export interface OneBotConfig {
  networks: OneBotNetworks;
  /** Mandatory in the canonical shape — a config without it fails validation. */
  statusCommand: StatusCommandConfig;
  /** Mandatory in the canonical shape. */
  historySync: HistorySyncConfig;
  /** OPTIONAL: the only top-level section validation does not require. */
  notifications?: NotificationsConfig;
}

export interface OneBotNetworks {
  httpServers: HttpServerConfig[];   // always present in canonical output, may be []
  httpClients: HttpClientConfig[];
  wsServers: WsServerConfig[];
  wsClients: WsClientConfig[];
}

/** Fields every adapter shares. `name` is the merge key. */
export interface OneBotAdapterBase {
  /** Required & non-empty in the canonical shape; surrounding whitespace rejected.
   *  Unnamed entries on disk get an auto name (`http-1`, `wsclient-2`, …). */
  name: string;
  /** `false` disables the adapter. Absent === enabled.
   *  Omitted from saved JSON unless explicitly `false` (L5632). */
  enabled?: boolean;
  /** Bearer token / HMAC key. 43-char base64url when generated.
   *  Empty string is normalized away to `undefined` (L5796: `asString(...) || void 0`).
   *  Omitted from saved JSON when falsy (L5633). */
  accessToken?: string;
  /** Defaults to "array". Inherited from a legacy top-level `messageFormat`. */
  messageFormat?: "array" | "string";
  /** Defaults to false. Inherited from legacy top-level `reportSelfMessage`. */
  reportSelfMessage?: boolean;
  /** Only value ever produced: `"satori"` (L5797). Marks a `wsServers` entry as a
   *  Satori listener — the mount shim keys off `path === "/v1/events"` instead. */
  protocol?: "satori";
  /** Inbound frame cap. WS adapters only; HTTP clients must NOT set it. */
  maxPayloadBytes?: number;   // 1024 … 2147483648, safe integer
}

export interface HttpServerConfig extends OneBotAdapterBase {
  host?: string;    // default "0.0.0.0"; must be a valid TCP bind host
  port: number;     // 1..65535; entries with port<=0 are DROPPED on load
  path?: string;    // default "/"; must be a normalized URL pathname, no ? or #
  enableWebSocket?: boolean;  // default false
  enableSse?: boolean;        // default false
}

export interface HttpClientConfig extends OneBotAdapterBase {
  url?: string;     // entries without url are DROPPED unless enabled===false
  timeoutMs?: number;         // 1 … 2147483647
}

export interface WsServerConfig extends OneBotAdapterBase {
  host?: string;    // default "0.0.0.0"
  port: number;     // 1..65535; port<=0 entries DROPPED
  /** default "/" — except when `protocol === "satori"`, then "/v1/events" (L5837). */
  path?: string;
  role?: "Api" | "Event" | "Universal";   // default "Universal"; case-insensitive on read
}

export interface WsClientConfig extends OneBotAdapterBase {
  url?: string;     // entries without url are DROPPED unless enabled===false
  role?: "Api" | "Event" | "Universal";   // default "Universal"
  reconnectIntervalMs?: number;           // default 5000, floored to 1000
}

export interface StatusCommandConfig {
  enabled: boolean;          // default true
  swallow: boolean;          // default false — hide the trigger message from adapters
  cooldownSeconds: number;   // default 5; clamped to [0, 31536000] on load
  trigger: string;           // default "#hz"; non-empty, single-line, ≤32 chars
}

export interface HistorySyncConfig {
  enabled: boolean;          // default false
}

export interface NotificationsConfig {
  /** Slugs: `^[\w.-]+$`, 1…64 chars. Order preserved; duplicates dropped; invalid
   *  ids silently discarded on load and rejected on restore. */
  channelIds: string[];
}
```

### 3.1 Optionality, at a glance

| section / field | on disk | required by `assertValidOneBotConfig` | default when absent |
| --- | --- | --- | --- |
| `networks` | required | **required** | — |
| `networks.<4 kinds>` | required | **each must be an array** | `[]` on a fresh install (only `httpServers`+`wsServers` get factory entries) |
| `statusCommand` | required | **required** | `{true,false,5,"#hz"}` — but the *saved file* always has it because `toJsonObject` always writes it |
| `historySync` | required | **required** | `{enabled:false}` |
| `notifications` | **optional** | optional (guarded by `!== void 0`) | `{channelIds: []}` |
| adapter `name` | optional on disk | required after load (auto-named) | `pickAutoName` |
| `enabled` | optional | optional | enabled |
| `accessToken` | optional | optional | absent (no auth) |
| `messageFormat` | optional | **required after load** | `"array"` |
| `reportSelfMessage` | optional | **required after load** | `false` |
| `maxPayloadBytes` | optional | optional, bounded | absent = unlimited |
| `host` / `path` / `role` | optional | optional | `0.0.0.0` / `/` / `Universal` |

### 3.2 Which fields have defaults *and* are materialized on load

`fromJson` never leaves `messageFormat`/`reportSelfMessage` undefined: it calls
`assertValidOneBotConfig` on its own output at L5704, and that validator demands
both (`L5513`, `L5514`). So the **loaded** in-memory shape is stricter than the
**on-disk** shape. 【指令级】

### 3.3 Per-UIN vs global

| file | per-UIN? | written by | read by |
| --- | --- | --- | --- |
| `config/onebot.json` | **no** — global overlay for every account | *never written by this region* (only restore/backup path at `src/webui/backup.ts:358114`) | `tryLoadJson(DEFAULT_CONFIG_PATH)` L5195 |
| `config/onebot_<uin>.json` | **yes** | `saveOneBotConfig` L5246 | `tryLoadJson(perUinPath, true)` L5196 |

An `onebot_<uin>.json` carries a `mode` discriminator:

* `"snapshot"` — **self-contained**: the global file is *not* merged in
  (`if (globalRaw && !isCanonicalSnapshot) sources.push(globalRaw);` L5200).
* `"overlay"` — the global file **is** the first source; this file wins per
  adapter `name` / per section key.

【实测】
```
V httpServers: [["a",3000],["b",4001],["c",4002]]   // global a,b + per-uin b(override),c
W httpServers: [["only",5000]] wsClients: 0         // mode:"snapshot" → global ignored
```

### 3.4 Which fields are per-UIN *semantically*

`notifications.channelIds` is stored **per-UIN** even though it is not per-UIN in
nature — each account opts into a set of channels. `statusCommand` and
`historySync` are likewise per-UIN (per `OneBotInstance.ctx.config`, L342763 /
L343000). The only genuinely global settings are in the *other* region
(`global-config.ts` → `config/snowluma.json`).

### 3.5 `notifications.channelIds` is last-write-wins, **not** a union

Verbatim (L5723–5745):

```js
function parseNotifications(sources) {
	let channelIds = [];
	for (const src of sources) {
		const raw = src.notifications;
		if (!isObject$4(raw)) continue;
		if (Array.isArray(raw.channelIds)) channelIds = normalizeChannelIds(raw.channelIds);
	}
	return { channelIds };
}
function normalizeChannelIds(value) {
	if (!Array.isArray(value)) return [];
	const seen = new Set(); const out = [];
	for (const item of value) {
		if (typeof item !== "string") continue;
		const v = item.trim();
		if (!v || v.length > 64 || !/^[\w.-]+$/.test(v)) continue;
		if (seen.has(v)) continue;
		seen.add(v); out.push(v);
	}
	return out;
}
```

【实测】
```
AF per-uin w/o notifications: {"channelIds":["ops","dev"]}   // global survives
AG per-uin with []:           {"channelIds":[]}              // explicitly cleared
AH per-uin all-invalid:       {"channelIds":[]}              // normalize → [], no fallback
```

`AG` is the sharp edge for the port: a per-UIN file that contains
`"notifications": {"channelIds": []}` **wipes** the global list. Absence of the
key preserves it. A naive "merge arrays" port would break both cases.

The slug rule is deliberately duplicated from
`src/notifications/config.ts` (`CHANNEL_ID_RE = /^[\w.-]+$/`, `CHANNEL_ID_MAX =
64`) — the comment at L5719-5722 says so explicitly: *"core depends on onebot, so
onebot cannot import from core"*.

### 3.6 `statusCommand` merge, with clamping

```js
function parseStatusCommand(sources) {
	const out = makeDefaultStatusCommand();
	for (const src of sources) {
		const raw = src.statusCommand;
		if (!isObject$4(raw)) continue;
		if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
		if (typeof raw.swallow === "boolean") out.swallow = raw.swallow;
		if (raw.cooldownSeconds !== void 0) out.cooldownSeconds = Math.min(STATUS_COMMAND_COOLDOWN_MAX, asNumber(raw.cooldownSeconds, DEFAULT_STATUS_COMMAND.cooldownSeconds));
		if (typeof raw.trigger === "string" && raw.trigger.trim().length > 0 && !/[\r\n]/.test(raw.trigger)) out.trigger = raw.trigger.trim().slice(0, 32);
	}
	return out;
}
```

【实测】 `{trigger:"  Haizakura ", cooldownSeconds:99999999, swallow:"yes"}` →
`{"enabled":true,"swallow":false,"cooldownSeconds":31536000,"trigger":"Haizakura"}`
— the trigger is trimmed, the cooldown is clamped to exactly one year, and the
non-boolean `swallow` is ignored **silently** (no throw), unlike the strict
validator which would reject it.

### 3.7 Deprecated-but-still-read

| field | where read | status |
| --- | --- | --- |
| top-level `httpServers` / `wsServers` / `wsClients` | `collectByName` L5779 `ingest(src[kind])` | legacy; merged into `networks.*` |
| top-level `httpPostEndpoints` | `collectByName(..., "httpPostEndpoints")` L5685 + L5778 | legacy name for `httpClients`; **kept out of `toJsonObject`** so a save silently renames it |
| top-level `messageFormat` / `reportSelfMessage` | `fromJson` L5676-5678 | become the *defaults* for every adapter lacking its own |
| `musicSignUrl` (top level) | restore allowlist L5280, validated L5307, copied through L5268 | **removed from the canonical shape**; `toJsonObject` does not emit it; a one-shot migration in `global-config.ts` (`migrateGlobalSettings`, L6025) lifts it into `config/snowluma.json` |
| `protocol: "satori"` | `parseBase` L5797, `parseWsServer` L5837 | extension marker riding on `wsServers` |

【实测】 legacy migration end-to-end: an `onebot_10010.json` containing only
`{httpServers:[…], messageFormat:"string", reportSelfMessage:true}` loads as
`{"name":"old-http","accessToken":"tok","messageFormat":"string","reportSelfMessage":true,"host":"0.0.0.0","port":6700,"path":"/","enableWebSocket":false,"enableSse":false}`
and, with `persistDefaults:true`, is **rewritten** in canonical `mode:"snapshot"`
form.

---

## 4. Load/save semantics

### 4.1 `loadOneBotConfig` in full

```js
function loadOneBotConfig(uin, options = {}) {
	ensureConfigDir$4();
	const perUinPath = path$1.join(CONFIG_DIR$5, `onebot_${uin}.json`);
	const globalRaw = tryLoadJson(DEFAULT_CONFIG_PATH);
	const perUinRaw = tryLoadJson(perUinPath, true);
	const legacy = !!perUinRaw && hasLegacyTopLevel(perUinRaw);
	const sources = [];
	const isCanonicalSnapshot = perUinRaw?.mode === PER_UIN_SNAPSHOT_MARKER;
	if (globalRaw && !isCanonicalSnapshot) sources.push(globalRaw);
	if (perUinRaw) sources.push(perUinRaw);
	const config = fromJson(sources, !perUinRaw && !globalRaw);
	if (options.persistDefaults && (!perUinRaw || legacy)) saveOneBotConfig(uin, config, { mode: globalRaw ? "overlay" : "snapshot" });
	return applyOneBotListenPortOverrides(config);
}
```

Step by step:

1. **`mkdir -p config`** unconditionally, even for a read. (A `loadOneBotConfig`
   call has a filesystem side effect. 【实测】 `dir created: true`.)
2. Read `config/onebot.json` **leniently** (corrupt → warn + ignore, `failOnCorrupt=false`).
3. Read `config/onebot_<uin>.json` **strictly** (`failOnCorrupt=true` → **throw**).
4. Decide merge sources (§3.3).
5. `fromJson(sources, freshInstall)` — merge + normalize + strict-validate.
6. `persistDefaults` **only if** the per-UIN file is missing **or** legacy-shaped.
   Mode: `"overlay"` if a global file existed, else `"snapshot"`.
7. `applyOneBotListenPortOverrides` on the returned value — **after** the save, so
   **env port overrides are never persisted**. 【实测】
   ```
   AJ returned port: 3999 | persisted port: 3000
   ```

Does it read JSON? Yes. Merge with defaults? Yes, via `parseX`/`asX` fallbacks +
`makeDefaultStatusCommand()` + the fresh-install adapter defaults. Validate? Yes —
strictly, at the end of `fromJson` (L5704). Migrate old shapes? Yes (§2.5).

### 4.2 Malformed-file policy — the two files differ

`tryLoadJson` verbatim (L5886–5899):

```js
function tryLoadJson(filePath, failOnCorrupt = false) {
	if (!fs$1.existsSync(filePath)) return null;
	try {
		const raw = fs$1.readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw);
		if (!isObject$4(parsed)) throw new Error("configuration root must be an object");
		return parsed;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (failOnCorrupt) throw new Error(`config file ${filePath} is corrupt: ${message}`, { cause: err });
		log$67.warn("config file %s is corrupt and will be ignored: %s", filePath, message);
		return null;
	}
}
```

| file | policy | observed |
| --- | --- | --- |
| `config/onebot.json` (global) | **log-and-default** — `warn "config file … is corrupt and will be ignored: …"`, returns `null`, load proceeds | 【实测】`C ok, httpServers= 1 port= 3000` |
| `config/onebot_<uin>.json` (per-UIN) | **throw** — `Error: config file config/onebot_10003.json is corrupt: Expected property name or '}' …`, with `cause` = the `SyntaxError` | 【实测】`B threw: … \| cause: SyntaxError` |
| either, JSON root is an array/`null`/scalar | same split, message `configuration root must be an object` | 【实测】`X threw: config file config/onebot_10052.json is corrupt: configuration root must be an object` |

So: **never silently rewrites a corrupt file.** The per-UIN throw propagates out
of `OneBotManager.startSession` and `notifications/manager.ts` catches it and
skips the notification (L348641–348645) rather than crashing the process.

Semantic corruption *inside* well-formed JSON is a third policy: it throws
`OneBotConfigValidationError` (not a `"is corrupt"` error), e.g. 【实测】
`Z threw: OneBotConfigValidationError | historySync.enabled must be a boolean`.

### 4.3 `fromJson` — the merge engine

```js
function fromJson(sources, freshInstall) {
	let legacyFormat, legacyReport;
	for (const src of sources) {
		const mf = parseMessageFormat(src.messageFormat);
		if (mf) legacyFormat = mf;
		if (typeof src.reportSelfMessage === "boolean") legacyReport = src.reportSelfMessage;
	}
	const adapterDefaults = { messageFormat: legacyFormat ?? "array", reportSelfMessage: legacyReport ?? false };
	const httpServers = collectByName(sources, "httpServers", (raw) => parseHttpServer(raw, adapterDefaults));
	const httpClients = collectByName(sources, "httpClients", (raw) => parseHttpClient(raw, adapterDefaults), "httpPostEndpoints");
	const wsServers   = collectByName(sources, "wsServers",   (raw) => parseWsServer(raw, adapterDefaults));
	const wsClients   = collectByName(sources, "wsClients",   (raw) => parseWsClient(raw, adapterDefaults));
	if (freshInstall && httpServers.length === 0 && httpClients.length === 0 && wsServers.length === 0 && wsClients.length === 0) {
		const defaults = makeDefaultOneBotConfig().networks;
		httpServers.push(...defaults.httpServers);
		wsServers.push(...defaults.wsServers);
	}
	const config = { networks: {...}, statusCommand: parseStatusCommand(sources), historySync: parseHistorySync(sources), notifications: parseNotifications(sources) };
	assertValidOneBotConfig(config);
	return config;
}
```

The factory defaults are injected **only** when *no file existed at all*
(`freshInstall = !perUinRaw && !globalRaw`). An empty-but-present
`onebot_10022.json` yields **zero** adapters. 【实测】
`L notifications: {"channelIds":[]}` — and `networks.httpServers` was `[]`.

### 4.4 The lenient/strict asymmetry (a bug-for-bug decision for the port)

`parseStatusCommand` and `parseNotifications` **ignore** malformed values.
`parseHistorySync` **throws**:

```js
function parseHistorySync(sources) {
	let enabled = false;
	for (const source of sources) {
		if (!Object.prototype.hasOwnProperty.call(source, "historySync")) continue;
		const raw = source.historySync;
		if (!isObject$4(raw)) invalid("historySync must be an object");
		rejectUnknownKeys(raw, new Set(["enabled"]), "historySync");
		if (typeof raw.enabled !== "boolean") invalid("historySync.enabled must be a boolean");
		enabled = raw.enabled;
	}
	return { enabled };
}
```

Consequence: `{"statusCommand":{"enabled":"yes"}}` loads fine (default `true`),
but `{"historySync":{"enabled":"yes"}}` **fails the whole load**. 【实测】 Both
observed. Port this asymmetry or deliberately diverge — do not accidentally
"fix" it, because the WebUI save path (`assertValidOneBotConfig` L373748) rejects
the same input anyway.

### 4.5 Silent drops (not errors)

| input | outcome | evidence |
| --- | --- | --- |
| server adapter with `port <= 0` / missing / non-numeric | entry **dropped** (`parseHttpServer` L5806 `if (port <= 0) return null;`) | 【实测】`httpServers:[{port:0},{port:3002}]` → `[["http-1",3002]]` |
| client adapter with no `url` **and** `enabled !== false` | entry **dropped** (L5821, L5846) | 【实测】`wsClients:[{enabled:false},{url:"ws://x/y"}]` → `[["wsclient-1",""],["wsclient-2","ws://x/y"]]` |
| duplicate `name` within one kind, later source | **overwrites** the earlier, keeps the first position | 【实测】`V` |
| duplicate `name` across kinds | **throws** at `assertValidOneBotConfig` | 【实测】`J threw: OneBotConfigValidationError \| network adapter name "dup" is duplicated in httpServers and wsServers` |
| unknown top-level key in a normal load | **ignored** (no `rejectUnknownKeys` on the load path) | 【指令级】`fromJson` reads named fields only |
| unknown key in a **restore** payload | **throws** `$.bogusKey is not supported` | 【实测】`I1` |

Note the last two lines: **load is permissive about unknown keys, restore is
not.** That is deliberate — the doc comment at L5248-5253 says restore uses an
owner-provided seam *"so legacy layouts are migrated deliberately while
malformed values cannot disappear through the normal load path's permissive
compatibility parser."*

### 4.6 Validation error catalogue

All of these raise `OneBotConfigValidationError` 【实测】 unless noted. Quoted
from the strict validator (`assertValidOneBotConfig`, L5451–5492):

```
configuration must be an object
networks must be an object
networks.<kind> must be an array
networks.<kind>[i] must be an object
networks.<kind>[i].name must be a non-empty string
networks.<kind>[i].name must not have surrounding whitespace
networks.<kind>[i].enabled must be a boolean
networks.<kind>[i].accessToken must be a string
networks.<kind>[i].messageFormat must be "array" or "string"
networks.<kind>[i].reportSelfMessage must be a boolean
network adapter name "<n>" is duplicated in <kind> and <kind>
networks.<kind>[i].maxPayloadBytes must be an integer between 1024 and 2147483648
networks.<kind>[i].maxPayloadBytes is only supported by WebSocket adapters
networks.<kind>[i].port must be an integer between 1 and 65535
networks.<kind>[i].host must be a string
networks.<kind>[i].host must be a non-empty string when provided
networks.<kind>[i].host must not have surrounding whitespace
networks.<kind>[i].host must be a valid TCP bind host
networks.<kind>[i].path must be a string
networks.<kind>[i].path must not have surrounding whitespace
networks.<kind>[i].path must be empty or start with /
networks.<kind>[i].path must not include query or hash
networks.<kind>[i].path must already be a normalized URL pathname
networks.<kind>[i] conflicts with <other> on server binding <host:port>
networks.<kind>[i] conflicts with <other> on wildcard server port <port>
networks.<kind>[i].url must be a string
networks.<kind>[i].url must be non-empty while the adapter is enabled
networks.<kind>[i].url must be a valid absolute URL
networks.<kind>[i].url protocol must be one of http:, https:      (or ws:, wss:)
networks.<kind>[i].role must be Api, Event, or Universal
networks.<kind>[i].timeoutMs must be an integer between 1 and 2147483647
networks.<kind>[i].reconnectIntervalMs must be an integer between 1000 and 2147483647
statusCommand must be an object
statusCommand.enabled must be a boolean
statusCommand.swallow must be a boolean
statusCommand.cooldownSeconds must be a non-negative integer
statusCommand.trigger must be non-empty, single-line, and <= 32 characters
historySync must be an object
historySync.enabled must be a boolean
notifications.channelIds must be an array
notifications.channelIds[i] is invalid
```

Restore-only messages (`validateOneBotRestoreSource` and friends):

```
restore source must be an object
inherited global restore source must be an object
<at>.<unknown> is not supported
$.mode must be snapshot or overlay
$.messageFormat must be array or string
$.reportSelfMessage must be a boolean
$.musicSignUrl must be a string
$.musicSignUrl must be empty or an http(s) URL
$.networks must be an object
<at> must be an array
<at>[i] must be an object
<at>[i].name must be a string
<at>[i].enabled must be a boolean
<at>[i].accessToken must be a string
<at>[i].messageFormat must be array or string
<at>[i].reportSelfMessage must be a boolean
<at>[i].port must be an integer between 1 and 65535
<at>[i].host must be a string
<at>[i].path must be a string
<at>[i].url must be a string
<at>[i].url is required while the adapter is enabled
<at>[i].role must be Api, Event, or Universal
<at>[i].timeoutMs must be an integer between 1 and 2147483647
<at>[i].reconnectIntervalMs must be an integer between 1000 and 2147483647
$.notifications must be an object
$.notifications.channelIds must be an array
$.notifications.channelIds[i] must be a string
$.notifications.channelIds[i] is invalid
$.historySync must be an object
$.historySync.enabled must be a boolean
$.statusCommand must be an object
$.statusCommand.enabled must be a boolean
$.statusCommand.swallow must be a boolean
$.statusCommand.cooldownSeconds must be an integer between 0 and 31536000
$.statusCommand.trigger must be non-empty, single-line, and <= 32 characters
$.<kind> contains a duplicate or unusable adapter
```

That last message is the restore-only invariant: after canonicalization, each
kind's array length must equal the raw count, i.e. **restore may not silently
drop an adapter** — the thing the normal loader does freely. 【指令级 L5333-5337, 实测 I2】

---

## 5. Every consumer

Method: word-boundary `grep -nP "(?<![\w\$])SYMBOL(?![\w\$])"` over all 374,326
lines, then each hit mapped to its owning `//#region` with a script that tracks
marker positions. Lines inside 5124–5931 are the region's own; excluded below.

### 5.1 `loadOneBotConfig` — 4 external call sites

```console
$ grep -nP '(?<![\w\$])loadOneBotConfig(?![\w\$])' reference/index.mjs
5192:function loadOneBotConfig(uin, options = {}) {
5203:	if (options.persistDefaults && ...
345240:		const config = loadOneBotConfig(uin, { persistDefaults: true });
348813:		loadChannelIds: (uin) => loadOneBotConfig(uin).notifications?.channelIds ?? [],
373726:		const config = loadOneBotConfig(uin);
373752:				previousConfig = loadOneBotConfig(uin);
```

| # | module | line | call | notes |
| --- | --- | --- | --- | --- |
| 1 | `../onebot/src/manager.ts` | 345240 | `loadOneBotConfig(uin, { persistDefaults: true })` | inside `startSession(uin, bridge)`. **A throw here aborts the whole account start** — no try/catch around it |
| 2 | `src/notifications/manager.ts` | 348813 | `(uin) => loadOneBotConfig(uin).notifications?.channelIds ?? []` | **the porting target.** Wrapped in `try/catch` at the consumer (L348641) so a corrupt per-UIN file only skips the notification |
| 3 | `src/webui/server.ts` | 373726 | `const config = loadOneBotConfig(uin)` in `GET /api/config/:uin` | `uin` pre-validated against `UIN_REGEX = /^\d{5,10}$/` (L372536). **No try/catch** — a validation error becomes a 500 |
| 4 | `src/webui/server.ts` | 373752 | `previousConfig = loadOneBotConfig(uin)` before a save | **inside** a `try/catch` that only logs: `"could not read prior OneBot config for uin=%s before save: %s"` (L373754) |

The exact notification wiring (L348807–348818):

```js
function createNotificationManager(resolveProcess) {
	return new NotificationManager({
		loadConfig: loadNotificationsConfig,
		loadChannelIds: (uin) => loadOneBotConfig(uin).notifications?.channelIds ?? [],
		post: createDefaultPost(),
		sendMail: createDefaultSendMail(),
		now: () => Date.now(),
		resolveProcess
	});
}
```

…and the only place it is invoked (L348641), verbatim:

```js
	async notifyNow(uin, event, account) {
		if (this.disposed) return;
		let channels;
		try {
			channels = selectChannels(this.deps.loadConfig().channels, this.deps.loadChannelIds(uin));
		} catch (err) {
			log$15.warn("notify(%s, %s) skipped — config load failed: %s", uin, event, errorMessage(err));
			return;
		}
		if (channels.length === 0) return;
```

with the pure selector (L348552–348555):

```js
function selectChannels(channels, enabledIds) {
	const wanted = new Set(enabledIds);
	return channels.filter((c) => c.enabled && wanted.has(c.id));
}
```

**Port consequence:** `loadChannelIds` is called **twice per notification event**
once from `handleOffline` (for `debounceSeconds`) and once inside `notifyNow` —
so it is not hot but it is not once-per-lifetime either. Cheap caching is safe
because nothing rewrites the file except an explicit WebUI save.

### 5.2 `notifications` / `channelIds` — complete reference list

```console
$ grep -n 'channelIds' reference/index.mjs
5178, 5417, 5418, 5419, 5420, 5421, 5423, 5489, 5490, 5627, 5719, 5724, 5728, 5730, 348251(comment), 348813
```

| module | line(s) | what |
| --- | --- | --- |
| `config.ts` (this region) | 5178, 5417-5423, 5489-5490, 5627, 5724-5730 | default, restore validation, strict validation, serialization, LWW merge |
| `src/notifications/config.ts` | 348251-348253 | **comment only** — `CHANNEL_ID_RE` kept "in sync with `normalizeChannelIds` in packages/onebot/src/config.ts" |
| `src/notifications/manager.ts` | 348813 | the only consumer |
| `src/notifications/manager.ts` | 348641 | `selectChannels(channels, this.deps.loadChannelIds(uin))` |

```console
$ grep -c 'notifications\b' reference/index.mjs
32
$ grep -n 'notifications\b' reference/index.mjs | grep -vc '//#region'
28          # 28 rows outside region markers; the config.ts rows are above
348249  NOTIFICATIONS_CONFIG_PATH = path.join(CONFIG_DIR, "notifications.json")
348457  "failed to write initial notifications.json: %s"
348470  "failed to normalize notifications.json on disk: %s"
348475  "notifications.json unreadable; using defaults: %s"
358084  backup allowlist entry {name:"notifications.json", credential:true}
358331  restore: case "notifications.json": prepareNormalizedJson(…, normalizeNotificationsConfig)
373815  app.get("/api/notifications/config", …)
373816  app.post("/api/notifications/config", …)
373838  "save notifications config failed: %s"
373845  app.get("/api/notifications/recent", …)
373851  app.post("/api/notifications/test", …)
```

**There is no `notifications` key anywhere in `src/webui/server.ts`'s OneBot
config routes.** `GET/POST /api/config/:uin` pass the whole `OneBotConfig`
through, so `notifications.channelIds` is edited only by round-tripping the
per-UIN JSON — and `toJsonObject` **always** emits `notifications: {channelIds:
… ?? []}` (L5627). The consequence, confirmed by probe `t11.mjs`:

```
fetched channelIds:       {"channelIds":["ops","dev"]}   // from config/onebot.json
saved file notifications: {"channelIds":[]}              // body lacked the key
reloaded channelIds:      {"channelIds":[]}              // global list now shadowed
```

i.e. any `POST /api/config/:uin` whose body has no `notifications` key **writes
`channelIds: []` into the per-UIN file**, and because present-but-empty wins LWW
(§3.5 `AG`) it silently disables every notification for that account. 【实测】 —
pin this with a parity test before "fixing" it.

### 5.3 `historySync` — complete list

```console
$ grep -n 'historySync' reference/index.mjs
```

| module | line(s) | what |
| --- | --- | --- |
| `config.ts` | 5177, 5278, 5331, 5428-5430, 5486-5487, 5626, 5701, 5710-5714 | default, restore key, restore validation, strict validation, serialize, merge, `parseHistorySync` |
| `../onebot/src/history-sync.ts` | 339198-339215 (`LOGIN_HISTORY_SYNC_LIMITS`), … | the subsystem itself |
| `../onebot/src/instance.ts` | **342763** | `this.historySyncEnabledAtStartup = config.historySync.enabled;` in the constructor |
| `../onebot/src/instance.ts` | 342825 | `if (!this.historySyncEnabledAtStartup) { … }` — startup-only read, gated |
| `../onebot/src/instance.ts` | 342721-342724, 342823-342835, 342879, 342894 | the abort controller / task bookkeeping |

`historySync.enabled` is read **exactly once per instance, at construction**
(`L342763`) and **never re-read on `reloadConfig`** — `reloadConfig` replaces
`this.ctx.config` (L342847) but leaves `historySyncEnabledAtStartup` alone. So
toggling history sync needs a session restart. 【指令级】

### 5.4 `statusCommand` — complete list

| module | line(s) | what |
| --- | --- | --- |
| `config.ts` | 5176, 5277, 5330, 5394-5413, 5480-5485, 5620-5625, 5700, 5748-5759 | default, restore key, restore validation, strict validation, serialize, merge, `parseStatusCommand` |
| `../onebot/src/instance.ts` | **343000** | `const cfg = this.ctx.config.statusCommand;` in `handleStatusCommand(event)` |
| `../onebot/src/instance.ts` | 342712 | `statusCommandCooldown = new Map()` — per-conversation rate limiter |
| `../onebot/src/instance.ts` | 342951 | `if (source === "bridge" && this.handleStatusCommand(event)) { … return; }` — **the swallow point** |
| `../onebot/src/modules/status-command.ts` | 41262+ | `matchesStatusCommand` (41269), `statusCooldownElapsed` (41287), `buildStatusText` |

The read site verbatim (L342999–343015):

```js
	handleStatusCommand(event) {
		const cfg = this.ctx.config.statusCommand;
		if (!cfg.enabled) return false;
		const postType = event.post_type;
		if (postType !== "message" && postType !== "message_sent") return false;
		if (!matchesStatusCommand(event.message, cfg.trigger)) return false;
		const isGroup = event.message_type === "group";
		const sessionId = isGroup ? toInt(event.group_id) : toInt(event.user_id);
		if (sessionId === 0) return cfg.swallow;
		const key = `${isGroup ? "g" : "p"}:${sessionId}`;
		const now = Date.now();
		if (statusCooldownElapsed(this.statusCommandCooldown.get(key), now, cfg.cooldownSeconds)) {
			this.statusCommandCooldown.set(key, now);
			this.trackAction("status command reply", () => this.replyStatus(isGroup, sessionId));
		}
		return cfg.swallow;
	}
```

Unlike `historySync`, `statusCommand` **is** re-read live: `reloadConfig` swaps
`ctx.config` and `handleStatusCommand` dereferences `this.ctx.config` each call.
【指令级】

### 5.5 The other eight

| symbol | consumers (module:line) |
| --- | --- |
| `saveOneBotConfig` | `src/webui/server.ts:373760` — `POST /api/config/:uin`, after `assertValidOneBotConfig` + `validateOneBotAccessTokenChanges` |
| `assertValidOneBotConfig` | `../onebot/src/network/network-manager.ts:341941` (`compileDesiredPlan`, outside the FIFO queue); `src/webui/server.ts:373748`; internally 5218, 5244, 5704 |
| `OneBotConfigValidationError` | `../onebot/src/manager.ts:345171` — `const retryable = !(error instanceof OneBotConfigValidationError);` (a config error is **not retried**, the migration is marked permanently failed with "请修正配置后重启"); `src/webui/server.ts:373763` — the 400-vs-500 branch |
| `makeDefaultOneBotConfig` | `src/network/satori-mount.ts:344683` — **comment only**, warning that monkey-patching it breaks restore |
| `makeDefaultStatusCommand` | none outside (internal default factory) |
| `generateAccessToken` | `src/network/satori-server-adapter.ts:344669` — `makeDefaultSatoriServer()` mints a token for port 5600 |
| `applyOneBotListenPortOverrides` | none outside (called only by `loadOneBotConfig` L5204) |
| `cleanupInvalidPerUinConfigs` | `src/index.ts:374207` — `main()`, right after `migrateGlobalSettings()`, **once at startup**, before `BridgeManager`/`OneBotManager` exist |
| `prepareOneBotConfigForRestore` | `src/webui/backup.ts:358360` — inside `prepareOneBotOrThrow(name, value, scope, inheritedGlobal)`, which wraps every error in `RestorePreflightError` |

Startup order, verbatim from `src/index.ts` (L374204–374210):

```js
	log.info("Haizakura starting");
	logRuntimeIntegrity(await getRuntimeIntegrity());
	migrateGlobalSettings();
	cleanupInvalidPerUinConfigs();
	const bridgeManager = new BridgeManager();
```

`cleanupInvalidPerUinConfigs` verbatim (L5589–5609):

```js
function cleanupInvalidPerUinConfigs() {
	let entries;
	try { entries = fs$1.readdirSync(CONFIG_DIR$5); } catch { return []; }
	const removed = [];
	for (const name of entries) {
		const match = PER_UIN_CONFIG.exec(name);
		if (!match || isRealUin(match[1])) continue;
		try {
			fs$1.unlinkSync(path$1.join(CONFIG_DIR$5, name));
			removed.push(name);
			log$67.warn("removed phantom per-UIN config (invalid UIN): %s", name);
		} catch (err) {
			log$67.warn("failed to remove phantom config %s: %s", name, err instanceof Error ? err.message : String(err));
		}
	}
	return removed;
}
```

【实测】 `onebot_1759999999999.json` (13 digits) deleted;
`onebot_10012.json` (5 digits) kept; return `["onebot_1759999999999.json"]`.

### 5.6 Field-level readers outside the region (what the schema must satisfy)

| field | reader |
| --- | --- |
| `networks.httpServers/httpClients/wsServers/wsClients` | `network-manager.ts:341943,341948,341953,341958` (compile plan), `onebot-token-policy.ts:365066-365067` |
| `config.statusCommand` | `instance.ts:343000` |
| `config.historySync.enabled` | `instance.ts:342763` |
| `config.notifications.channelIds` | `notifications/manager.ts:348813` |
| `accessToken` | 27 sites; e.g. `http.ts` equivalent `339671` (`X-Signature` HMAC), `ws.ts` `342316` (`Authorization: Bearer`), `344323` (socket close on token change) |
| `maxPayloadBytes` | 28 sites; e.g. `341505`, `342291`, `344319` (the "adapter identity" strings that decide whether a reload can reuse a live socket) |
| `role` | `342291`, `342506`, `344319` (identity strings), `validateRole` |
| `messageFormat` / `reportSelfMessage` | `339448-339449`, `339470-339475`, `341224` |
| `enableWebSocket` / `enableSse` | `341494-341525`, `341632`, `341224` |
| `timeoutMs` | `339649`, `339672-339680` |
| `reconnectIntervalMs` | `342291`, `342371` |
| `protocol === "satori"` | `344714` |

---

## 6. Dependency inventory

The region imports **nothing** from any other region's *values* except four
helpers, and **no npm packages at all**:

```console
$ awk 'NR>=5124 && NR<=5931' reference/index.mjs | grep -nP 'require\(|from "'
(no output; exit 1)

$ awk 'NR>=5124 && NR<=5931' reference/index.mjs | grep -cP 'zod|semver|hono|ws\.|undici|node-fetch'
0
```

### 6.1 Host-language built-ins (bundle aliases from the header, L1–L45)

| used in region | alias | real module | uses |
| --- | --- | --- | --- |
| `fs$1` | `import fs$1, {…} from "fs"` | `node:fs` | 13 |
| `path$1` | `import path$1, {…} from "path"` | `node:path` | 6 |
| `randomBytes$1` | `import {…randomBytes as randomBytes$1…} from "crypto"` | `node:crypto` | 2 |
| `isIP` | `import net$1, { isIP } from "node:net"` | `node:net` | 2 |
| `URL` | global | — | 5 |
| `structuredClone` | global | — | 1 |
| `process` | global | — | 2 |
| `JSON`, `Math`, `Number`, `Object`, `Set`, `Map`, `Error` | globals | — | many |

### 6.2 Cross-region imports

| symbol | declared in | region | rewrite status |
| --- | --- | --- | --- |
| `createLogger(scope)` | `../common/src/logger.ts` L1556 | inits at 5126, used 5127 (`createLogger("OneBot.Config")`) + warn calls | ✅ **HAVE** — `ts/src/onebot/log.ts:185` `export function createLogger(scope: string): Logger` |
| `positiveIntEnv(name, fallback, {max, env})` | `../common/src/env.ts` L1664 | 5228 | ✅ **HAVE** — `ts/src/bridge/env.ts:25` (+ `MAX_POSITIVE_INT` at :18, `PositiveIntEnvOptions` at :20). Signature identical |
| `isRealUin(uin)` | `../common/src/uin.ts` L1654 | 5599 | ⚠️ **PARTIAL** — exists as a *private* `function isRealUin` in `ts/src/bridge/bridge.ts:665`, **not exported**, no shared module. `grep -rn 'export function isRealUin' ts/src` → exit 1 |
| `isValidBindHost(value)` | also declared locally at L5925 **and** at L357361 (`src/webui/listener-exposure.ts`) | 5531 | ⚠️ **PARTIAL** — `ts/src/host/runtime-config.ts:259` has a **private** `isValidBindHost` (identical body, plus a `host.trim() !== host` check the reference does separately). Not exported |
| `init_env` / `init_logger` | the rolldown `__esmMin` lazy-init wrappers | 5125, 5126 | n/a — an artifact of the bundler. In TypeScript these become normal imports; **drop them** |
| `URL` behaviour, `fs.mkdirSync`, `fs.renameSync`, `fs.fsyncSync`, `fs.openSync(…, 0o600)` | Node | throughout | ✅ available |

Confirmed by grep over the rewrite:

```console
$ find ts/src -name 'config*.ts'
(no output)

$ grep -rn "loadOneBotConfig" ts/src ;      echo rc=$?
rc=1
$ grep -rn "saveOneBotConfig" ts/src ;      echo rc=$?
rc=1
$ grep -rn "makeDefaultOneBotConfig" ts/src ; echo rc=$?
rc=1
$ grep -rn "channelIds" ts/src ;            echo rc=$?
rc=1
$ ls ts/src/notifications ts/src/webui
ls: cannot access 'ts/src/notifications': No such file or directory
ls: cannot access 'ts/src/webui': No such file or directory
```

The only mentions of the reference region inside `ts/src` are two comment
paragraphs in `ts/src/onebot/manager.ts:17-25` and `:86-90`, plus the constant
`L5451` written out in a doc comment. There is **no** `ts/src/onebot/config.ts`.

### 6.3 What the rewrite already has that the port can reuse

| need | existing file:line | fit |
| --- | --- | --- |
| adapter config *types* | `ts/src/onebot/adapter.ts:41` `NetworkBaseConfig`, `:393` `WsServerConfig`, `:390` `ForwardRole`, `:50` `NetworkKind` | **direct reuse.** Fields line up: `name/enabled/accessToken/messageFormat/reportSelfMessage/protocol`, plus `host/port/path/role/maxPayloadBytes` |
| `HttpServerConfig` | `ts/src/onebot/http.ts:321` (extends `WsServerConfig`, `SseConfig`) + `enableWebSocket`/`enableSse` | **direct reuse** |
| `HttpClientConfig` | `ts/src/onebot/http.ts:180` (`url`, `timeoutMs`) | **direct reuse** |
| `WsClientConfig` | `ts/src/onebot/ws.ts:64` (`url`, `role`, `reconnectIntervalMs`, `maxPayloadBytes`) | **direct reuse** |
| message-format normalization | `ts/src/onebot/types.ts:112` `resolveReportOptions` | overlaps `parseBase`; keep both or have `parseBase` produce exactly this shape |
| partial strict validation | `ts/src/onebot/manager.ts:105` `validateOneBotNetworks` | covers duplicate names + bind conflicts **only**; its doc comment (L86-90) explicitly defers `statusCommand`/`historySync`/`notifications`/per-kind field types to a `config.ts` that does not exist yet |
| logger, `errorMessage` | `ts/src/onebot/log.ts:185`, `:190` | ✅ |
| `positiveIntEnv` | `ts/src/bridge/env.ts:25` | ✅ |
| atomic temp+rename write | **absent** | `grep -rn "renameSync" ts/src` → **exit 1**, zero hits anywhere in the rewrite. `ts/src/host/runtime-config.ts` has no save function at all — its doc comment at `:33` and `:329` *mentions* a `saveRuntimeConfig` that was never ported. The only file writers are `ts/src/bridge/web/album-upload.ts:528,626,803,811`, all plain `writeFileSync` |

---

## 7. Porting order

Goal: get `loadOneBotConfig(uin).notifications.channelIds` working with the
smallest honest surface, then everything else. Files are named for
`ts/src/`; each step is independently testable.

### Step 0 — decide the module split first (no code)

Create **one** file, `ts/src/onebot/config.ts`, not five. Every symbol in the
region is entangled through `fromJson`/`toJsonObject`/the validators, and the
reference already has the region-private constant namespace. Splitting into
`config.defaults.ts` / `config.io.ts` / `config.validate.ts` costs import cycles
(`fromJson` needs the validators; the validators need `parseRestoreInteger` and
`invalid`) for no testability gain. Put `OneBotConfig` and friends in
`ts/src/onebot/config-types.ts` only if `adapter.ts` would otherwise have to
import `config.ts` — it would not: `config.ts` imports `adapter.ts`, never the
reverse.

### Step 1 — `ts/src/onebot/config-types.ts` (≈70 L)

1. `export interface OneBotConfig`, `OneBotNetworks`, `StatusCommandConfig`,
   `HistorySyncConfig`, `NotificationsConfig` per §3.
2. Re-export the adapter interfaces from `adapter.ts` / `http.ts` / `ws.ts`
   (`export type { HttpServerConfig } from "./http.js"` etc.) rather than
   redeclaring them.
3. Add `export type OneBotConfigMode = "snapshot" | "overlay";`.
4. Zero imports except `type` imports. This file must compile standalone.
5. **Do not** add `musicSignUrl` here — it is not part of the canonical shape.
   If restore needs it, it belongs in the restore types (step 8).

### Step 2 — `ts/src/onebot/config-defaults.ts` (≈45 L) — **unblocks nothing yet, but is the cheapest real test**

Port, in this order, from the line numbers given:

* `DEFAULT_CONFIG_PATH` (5129), `DEFAULT_ACCESS_TOKEN_BYTES` (5130),
  `NODE_TIMER_MAX_MS` (5131), `MAX_PAYLOAD_BYTES_MIN/MAX` (5135-5136),
  `PER_UIN_SNAPSHOT_MARKER` (5137), `STATUS_COMMAND_COOLDOWN_MAX` (5145),
  `HTTP_DEFAULT_SERVER`/`WS_DEFAULT_SERVER` (5206-5207),
  `DEFAULT_STATUS_COMMAND` (5138).
* `makeDefaultStatusCommand()` (5146) — must return a **copy**.
* `generateAccessToken()` (5181) — `randomBytes(32).toString("base64url")`.
* `makeDefaultOneBotConfig()` (5149) — port `3e3` as `3000` (write `3000`, not
  `3e3`; the literal is a float in the bundle and a reader will trip on it).

Test with `node --test`: defaults deep-equal a golden JSON, tokens are 43 chars
and distinct across calls.

### Step 3 — `ts/src/onebot/config-json.ts` (≈120 L) — **the `channelIds` milestone**

This is the minimum to answer `loadOneBotConfig(uin).notifications.channelIds`.

1. `tryLoadJson(filePath, failOnCorrupt = false)` (5886) — copy verbatim,
   including the `configuration root must be an object` check and both messages.
2. `saveJson(filePath, json)` (5900) — temp + `0o600` + `fsync` + `rename`,
   with the `unlink` cleanup. Use `node:fs` sync APIs; the reference is sync
   here and `startSession` depends on that.
3. `isObject`, `asString`, `asNumber`, `clean`, `parseMessageFormat` (5859-5885).
4. `normalizeChannelIds` (5732) + `parseNotifications` (5723) — **copy the LWW
   loop exactly**; do not union.
5. `parseStatusCommand` (5748) + `parseHistorySync` (5707) — keep the asymmetry
   (§4.4). Add a test asserting `historySync:{enabled:"yes"}` throws while
   `statusCommand:{enabled:"yes"}` does not.

### Step 4 — `ts/src/onebot/config-network.ts` (≈260 L)

1. `parseBase` (5792), `pickAutoName` (5783), `collectByName` (5760).
2. `parseHttpServer` (5801), `parseHttpClient` (5817), `parseWsServer` (5829),
   `parseWsClient` (5842) — including the `return null` drop rules and
   `path: value.protocol === "satori" ? "/v1/events" : "/"`.
3. `hasLegacyTopLevel` (5856), `asRole` (5866).

### Step 5 — `ts/src/onebot/config-validate.ts` (≈330 L)

`invalid` (5574), `OneBotConfigValidationError` (**reuse** the one at
`ts/src/onebot/manager.ts:93` if possible — two classes with the same `name`
would break every `instanceof`; prefer moving it here and re-exporting from
`manager.ts`), then `assertValidOneBotConfig` (5451) and its whole helper
family (5493-5573). Then add `parseMaxPayloadBytes`, `rejectHttpClientMaxPayloadBytes`,
`validateServer`, `validateServerBinding`, `validateClient`, `validateRole`.

For `isValidBindHost`: **do not duplicate a third copy.** Export the existing
private one from `ts/src/host/runtime-config.ts:259` (it is byte-identical apart
from a `host !== value` check the reference does at L5530) and import it — or, if
importing `host/` from `onebot/` is undesirable, move it to a tiny shared
`ts/src/net/host.ts` and have both call it. Note the reference itself has **two**
copies (L5925 and L357361), so a shared module is a deliberate, safe improvement.

`validateOneBotNetworks` in `ts/src/onebot/manager.ts:105` becomes redundant for
the two rules it covers, but keep it: it is the manager's default `validate`
option (L178) and its messages are fixture-asserted. Point its default at
`assertValidOneBotConfig` only after a test proves message parity.

### Step 6 — `ts/src/onebot/config.ts` (≈90 L) — **the entry point**

1. `fromJson` (5672) — this is the assembly point; it needs steps 3-5.
2. `loadOneBotConfig` (5192) — copy the ordering **exactly**:
   `ensureConfigDir` → read global (lenient) → read per-UIN (strict) → decide
   snapshot vs overlay → `fromJson(sources, freshInstall)` → conditional
   `saveOneBotConfig` → `applyOneBotListenPortOverrides` **last**.
3. **Add the one hardening the reference lacks:** validate `uin` before
   interpolating it into a filename. 【实测】 `loadOneBotConfig("../escape")`
   happily ran; the reference relies on every caller pre-validating
   (`UIN_REGEX` at 372536, `isRealUin` elsewhere). The port should refuse
   non-`isRealUin` UINs at the door, or at minimum `path.basename` the
   interpolation — and document the divergence.

### Step 7 — `ts/src/onebot/config-save.ts` → fold into step 6

`saveOneBotConfig` (5243), `toJsonObject` (5610), `applyBase` (5630), the four
`*ToJson` (5638-5671). Small; same file as step 6 is fine. Note that
`toJsonObject` **always** emits `notifications: {channelIds: … ?? []}` — the
behaviour that makes a WebUI save clear a global list (§5.2). Keep it, and pin
it with a test, or fix it deliberately.

### Step 8 — `ts/src/onebot/config-overrides.ts` (≈40 L)

`applyOneBotListenPortOverrides` (5209), `readListenPort` (5225),
`assignFactoryPort` (5234). Depends on `positiveIntEnv` — import from
`ts/src/bridge/env.ts:28`. Note the override is **not** persisted (实测 AJ) and
is validated against `assertValidOneBotConfig` with a warn-and-revert on
failure (L5217-5222).

### Step 9 — `ts/src/onebot/config-migrate.ts` (≈150 L)

`cleanupInvalidPerUinConfigs` (5589) + `PER_UIN_CONFIG` (5580). Needs `isRealUin`
— **first export it** (`ts/src/common/uin.ts` new file, 3 lines, moving the
private copy out of `bridge.ts:665`; update `bridge.ts` to import it). Call site
to add later: process startup, mirroring `src/index.ts:374207`.

### Step 10 — `ts/src/onebot/config-restore.ts` (≈320 L)

`prepareOneBotConfigForRestore` (5254), `validateOneBotRestoreSource` (5302),
`validateRestoreAdapterArray` (5339), `validateRestoreStatusCommand` (5394),
`validateRestoreNotifications` (5414), `validateRestoreHistorySync` (5426),
`rejectUnknownKeys` (5432), `parseRestoreInteger` (5436), `isHttpUrlForRestore`
(5440), and the three allowlist constants (5274-5301). Port **last**: nothing
that is not the backup/restore WebUI needs it, and it is the largest single
block.

### Step 11 — wire the consumer

`ts/src/notifications/manager.ts` does not exist yet. When it does, the
dependency is one line:

```ts
loadChannelIds: (uin: string) => loadOneBotConfig(uin).notifications?.channelIds ?? [],
```

Keep the `?.` and the `?? []`: `notifications` is the one optional section, and a
`OneBotConfig` built by hand (e.g. in a test) may omit it.

### Ordering summary

| # | file | LOC | unblocks |
| --- | --- | --- | --- |
| 1 | `ts/src/onebot/config-types.ts` | 70 | typechecking for everything below |
| 2 | `ts/src/onebot/config-defaults.ts` | 45 | first unit test |
| 3 | `ts/src/onebot/config-json.ts` | 120 | **`channelIds` parsing** |
| 4 | `ts/src/onebot/config-network.ts` | 260 | networks merge |
| 5 | `ts/src/onebot/config-validate.ts` | 330 | strict validation |
| 6 | `ts/src/onebot/config.ts` (`fromJson` + `loadOneBotConfig` + save) | 180 | **`loadOneBotConfig(uin)`** |
| 7 | `ts/src/onebot/config-overrides.ts` | 40 | env ports |
| 8 | `ts/src/common/uin.ts` + `config-migrate.ts` | 155 | startup cleanup |
| 9 | `ts/src/onebot/config-restore.ts` | 320 | backup/restore |

A pragmatic shortcut for the `channelIds` milestone only: steps 1 + 3 + a
degraded `loadOneBotConfig` that reads both files, picks sources by `mode`,
calls `parseNotifications`, and **throws** `OneBotConfigValidationError` for
everything else it does not understand. That is ~200 L and gets notifications
unblocked without pretending the validator exists. Mark it `// PARTIAL` and
replace it at step 6 — do not let it become the shipped loader, because
`OneBotManager.startSession` (345240) will eventually need the real one and a
partial loader would silently drop adapters.

### Testing notes for whoever implements

* Golden-file the two defaults: `makeDefaultOneBotConfig()` with tokens stubbed,
  and `toJsonObject(makeDefaultOneBotConfig(), "snapshot")`.
* The four behavioural cases that are easy to get wrong, each one line of
  fixture: overlay merge by name (`V`), `mode:"snapshot"` ignoring global (`W`),
  `channelIds: []` overriding a global list (`AG`), `port:0` dropping an
  adapter (`K`).
* Corrupt-file split (`B` throws / `C` warns) and the `configuration root must be
  an object` case (`X`).
* The lenient/strict asymmetry: `statusCommand.enabled:"yes"` loads,
  `historySync.enabled:"yes"` throws (`Y`, `Z`).
* File mode `0o600` + no leftover `.tmp` after a successful save (`S`).
* `cleanupInvalidPerUinConfigs` with an 11+-digit name and a 5-10-digit name (`G`).

---

## Appendix A — region declaration index

All 74 top-level declarations, in order, with the section of this document that
covers them.

| line | name | § |
| --- | --- | --- |
| 5127 | `log$67` | 2.2 |
| 5128 | `CONFIG_DIR$5` | 3.3 |
| 5129 | `DEFAULT_CONFIG_PATH` | 2.1 |
| 5130 | `DEFAULT_ACCESS_TOKEN_BYTES` | 2.1 |
| 5131 | `NODE_TIMER_MAX_MS` | 2.1 |
| 5135 | `MAX_PAYLOAD_BYTES_MIN` | 2.1 |
| 5136 | `MAX_PAYLOAD_BYTES_MAX` | 2.1 |
| 5137 | `PER_UIN_SNAPSHOT_MARKER` | 3.3 |
| 5138 | `DEFAULT_STATUS_COMMAND` | 2.1 |
| 5145 | `STATUS_COMMAND_COOLDOWN_MAX` | 2.1 |
| 5146 | `makeDefaultStatusCommand` | 2.1 |
| 5149 | `makeDefaultOneBotConfig` | 2.1 |
| 5181 | `generateAccessToken` | 2.1 |
| 5186 | `OneBotConfigValidationError` | 2.4 |
| 5192 | `loadOneBotConfig` | 4.1 |
| 5206 | `HTTP_DEFAULT_SERVER` | 2.1 |
| 5207 | `WS_DEFAULT_SERVER` | 2.1 |
| 5209 | `applyOneBotListenPortOverrides` | 2.2 |
| 5225 | `readListenPort` | 2.2 |
| 5234 | `assignFactoryPort` | 2.2 |
| 5243 | `saveOneBotConfig` | 2.3 |
| 5254 | `prepareOneBotConfigForRestore` | 2.5 |
| 5274 | `RESTORE_TOP_LEVEL_KEYS` | 2.4 |
| 5289 | `RESTORE_NETWORK_KEYS` | 2.4 |
| 5295 | `RESTORE_BASE_ADAPTER_KEYS` | 2.4 |
| 5302 | `validateOneBotRestoreSource` | 2.4 |
| 5339 | `validateRestoreAdapterArray` | 2.4 |
| 5394 | `validateRestoreStatusCommand` | 2.4 |
| 5414 | `validateRestoreNotifications` | 2.4 |
| 5426 | `validateRestoreHistorySync` | 2.4 |
| 5432 | `rejectUnknownKeys` | 2.4 |
| 5436 | `parseRestoreInteger` | 2.4 |
| 5440 | `isHttpUrlForRestore` | 2.4 |
| 5451 | `assertValidOneBotConfig` | 2.4 |
| 5493 | `validateNetworkList` | 2.4 |
| 5508 | `validateNetworkBase` | 2.4 |
| 5517 | `parseMaxPayloadBytes` | 2.4 |
| 5522 | `rejectHttpClientMaxPayloadBytes` | 2.4 |
| 5525 | `validateServer` | 2.4 |
| 5542 | `validateServerBinding` | 2.4 |
| 5559 | `validateClient` | 2.4 |
| 5571 | `validateRole` | 2.4 |
| 5574 | `invalid` | 2.4 |
| 5577 | `ensureConfigDir$4` | 2.2 |
| 5580 | `PER_UIN_CONFIG` | 2.1 |
| 5589 | `cleanupInvalidPerUinConfigs` | 5.5 |
| 5610 | `toJsonObject` | 2.3 |
| 5630 | `applyBase` | 2.3 |
| 5638 | `httpServerToJson` | 2.3 |
| 5648 | `httpClientToJson` | 2.3 |
| 5655 | `wsServerToJson` | 2.3 |
| 5664 | `wsClientToJson` | 2.3 |
| 5672 | `fromJson` | 4.3 |
| 5707 | `parseHistorySync` | 4.4 |
| 5723 | `parseNotifications` | 3.5 |
| 5732 | `normalizeChannelIds` | 3.5 |
| 5748 | `parseStatusCommand` | 3.6 |
| 5760 | `collectByName` | 2.2 |
| 5783 | `pickAutoName` | 2.2 |
| 5792 | `parseBase` | 2.2 |
| 5801 | `parseHttpServer` | 2.2 |
| 5817 | `parseHttpClient` | 2.2 |
| 5829 | `parseWsServer` | 2.2 |
| 5842 | `parseWsClient` | 2.2 |
| 5856 | `hasLegacyTopLevel` | 2.5 |
| 5859 | `parseMessageFormat` | 2.2 |
| 5862 | `clean` | 2.2 |
| 5866 | `asRole` | 2.2 |
| 5873 | `asString$1` | 2.2 |
| 5878 | `asNumber` | 2.6 |
| 5886 | `tryLoadJson` | 4.2 |
| 5900 | `saveJson` | 2.3 |
| 5922 | `isObject$4` | 2.2 |
| 5925 | `isValidBindHost$1` | 2.2 |

## Appendix B — things this document does *not* cover

* `config/onebot.json` is **read but never written** by this region. Whatever
  writes it lives in `src/webui/backup.ts` (restore) — so in the reference, the
  global overlay file is effectively operator-authored. 【指令级: `grep -n
  'onebot.json'` yields only read/backup sites】
* `validateOneBotAccessTokenChanges` (L365063, `src/webui/onebot-token-policy.ts`)
  is **not** in this region, but `POST /api/config/:uin` calls it between
  `assertValidOneBotConfig` and `saveOneBotConfig`. A port of the save path needs
  it too; it is out of scope here.
* `migrateGlobalSettings` / `loadGlobalSettings` (`global-config.ts`, 5932-6083)
  are the adjacent region and own `musicSignUrl`, `rkey.fallbackServers`,
  `videoUploadConcurrency`.
