# `src/notifications`, `src/update`, `src/network` — inventory and porting plan

Status as of 2026-11-23. Scope: the three `src/*` subtrees the rewrite does not have.
This document is **inventory + plan only**. No production code was written and no build
was run (other agents share `build/`).

---

## 0. Which bundle am I looking at?

**`reference/index.mjs` — 13,916,690 B, 374,326 lines, 472 `//#region` markers.**

```bash
$ cd /home/ubuntu/hook-rewrite && wc -c reference/index.mjs
13916690 reference/index.mjs
$ grep -c '//#region' reference/index.mjs
472
$ grep -c '//#endregion' reference/index.mjs
472
```

The comparison bundle is the "pristine" one named in `docs/src-layer-map.md` §1:

```bash
$ wc -l -c /sdcard/snowluma-restore/restored/dist/index.mjs
  367423 12338350 /sdcard/snowluma-restore/restored/dist/index.mjs
$ grep -c '//#region' /sdcard/snowluma-restore/restored/dist/index.mjs
467
```

### 0.1 The layer map's claim about `src/network` is correct — verified 【实测】

```bash
# pristine bundle: how many src/network regions?
$ grep -c '//#region src/network' /sdcard/snowluma-restore/restored/dist/index.mjs
0                                            # exit 1 — no match

# all src subtrees present in pristine:
$ grep -o '//#region src/[a-z-]*/' /sdcard/snowluma-restore/restored/dist/index.mjs \
    | sort | uniq -c | sort -rn
     30 //#region src/webui/
     21 //#region src/bridge/
      6 //#region src/update/
      4 //#region src/notifications/
```

So: **both `src/network/satori-server-adapter.ts` and `src/network/satori-mount.ts`
exist only in `reference/index.mjs`, not in the pristine 467-region bundle.** The
reference's own header comment says the same thing (【指令级】, `reference/index.mjs:343221-343225`):

> This file is NOT from the original bundle. It is declared in
> `manifest-extra.json` and spliced into `dist/index.mjs` by `scripts/build.mjs`,
> running in the SAME flat module scope as the other 467 regions

**Caveat for whoever reads the layer map next — two of its numbers are wrong.**

1. §1 says "everything else (470 regions) — **byte-identical**". **That is false.**
   I diffed all 467 shared regions by content:
   ```bash
   # /tmp/regdiff.mjs — splits both bundles on //#region, compares region bodies
   $ node /tmp/regdiff.mjs
   pristine regions: 467 reference regions: 472
   only in reference: [src/network/satori-server-adapter.ts, src/network/satori-mount.ts,
                       src/webui/docs-corpus.ts, src/webui/docs-mount.ts,
                       src/webui/cache-headers.ts]
   identical: 442 differs: 25
   ```
   **25 regions differ in content, not 2.** 24 of them are outside `node_modules`;
   10 are under `src/*` (`bridge/apis/extras`, `bridge/apis/forward`,
   `webui/backup`, `webui/log-export`, `webui/server`, `index`, and four of the
   six `src/update/*`). The deltas are small (0–3,730 B each, mostly
   `SnowLuma` → `Haizakura` renames plus injected comments) but they are not zero,
   which matters for §3 below.
2. §1 says "the *logic* of the layer did not change at all between the two files."
   True for `src/notifications` (all 4 regions byte-identical) and **false for
   `src/update`**, where the repo's copy has auto-update deliberately disabled.
   See §3.2.

---

## 1. Reproduction

Every number below is from one `awk` pass that measures a region from its
`//#region` banner through its closing `//#endregion`, inclusive of both marker
lines — the same convention `docs/src-layer-map.md` §0.1 uses.

```bash
cd /home/ubuntu/hook-rewrite
LC_ALL=C awk '
/^\/\/#region /{ name=$0; sub(/^\/\/#region /,"",name); inr=1; lc=0; bc=0; start=NR }
inr { lc++; bc += length($0)+1
      if ($0 ~ /^\/\/#endregion/) {
        printf "%-45s %5d L %6d B  L%d\n", name, lc, bc, start; inr=0 } }
' reference/index.mjs | grep -E ' src/(notifications|update|network)/'
```

Output (verbatim):

```
src/network/satori-server-adapter.ts           1458 L  56040 B  L343219
src/network/satori-mount.ts                      98 L   4225 B  L344677
src/notifications/smtp.ts                       290 L   9341 B  L347954
src/notifications/config.ts                     255 L   8893 B  L348244
src/notifications/debounce.ts                    42 L   1133 B  L348499
src/notifications/manager.ts                    280 L   8267 B  L348541
src/update/sources.ts                            92 L   2981 B  L365475
src/update/release.ts                           119 L   4627 B  L365567
src/update/check.ts                              96 L   2899 B  L365686
src/update/files.ts                             173 L   6166 B  L369517
src/update/download.ts                          112 L   4935 B  L369690
src/update/service.ts                            85 L   2508 B  L369802
```

Subtree totals — **these reproduce `docs/src-layer-map.md` §2.2 exactly** 【实测】:

| subtree | modules | lines | bytes |
| --- | ---: | ---: | ---: |
| `src/network` | 2 | 1,556 | 60,265 |
| `src/notifications` | 4 | 867 | 27,634 |
| `src/update` | 6 | 677 | 24,116 |

### 1.1 The three directories are absent from the rewrite 【实测】

```bash
$ ls ts/src/
bridge  element-builder.ts  hook-client.ts  host  login-hint.ts  main.ts
msg-push-elem-extra.ts  msg-push-fields.ts  msg-push.ts  oidb  onebot
protocol.ts  recv-client.ts  rtti.ts  send-message-request.ts  session.ts

$ ls -d ts/src/notifications ts/src/update ts/src/network
ls: cannot access 'ts/src/notifications': No such file or directory
ls: cannot access 'ts/src/update': No such file or directory
ls: cannot access 'ts/src/network': No such file or directory

# and no symbol from any of the three survives anywhere under ts/
$ grep -rn 'createNotificationManager\|DebounceMachine\|sendSmtpMail\|loadNotificationsConfig\|\
renderTemplate\|getUpdateInfo\|createUpdateService\|downloadUpdate\|applyPendingUpdate\|\
readUpdateSource' ts/src/
                                             # exit 1 — no match
```

Note the near-miss: **`ts/src/onebot/network/satori-server-adapter.ts` does exist**
(336 L). It is *not* the reference's 1,458-line region — it is a from-scratch
9-method port. §4.3 measures the gap. The layer map's §8.3 says this too; I
re-verified it rather than quoting it.

---

## 2. `src/notifications` — 4 modules, 867 L, 27,634 B

### 2.1 Module list

| module | lines | bytes | role |
| --- | ---: | ---: | --- |
| `src/notifications/smtp.ts` | 290 | 9,341 | hand-rolled SMTP/ESMTP client over `node:net`/`node:tls` |
| `src/notifications/manager.ts` | 280 | 8,267 | orchestrator: debounce → render → deliver → history |
| `src/notifications/config.ts` | 255 | 8,893 | `config/notifications.json` load/normalize/atomic-save |
| `src/notifications/debounce.ts` | 42 | 1,133 | pure 3-state machine (`none`/`pending`/`offline`) |

### 2.2 What each module does

**`smtp.ts`** — a complete SMTP client: MIME assembly, EHLO capability parse, optional
STARTTLS upgrade, `AUTH PLAIN` with `AUTH LOGIN` fallback, dot-stuffing, and
Chinese-language error mapping. Representative symbols: `buildMimeMessage`,
`parseCapabilities`, `sendSmtpMail`. Error text in Chinese:
`"无法连接 SMTP：${host}:${port}"`, `"SMTP 认证失败"` (`responseCode === 535`),
`"SMTP 证书不受信任：${host}"`. Zero lower-layer names — it touches only
`node:net`, `node:tls`, `Buffer` 【指令级】.

**`manager.ts`** — the `NotificationManager` class plus two default transports. It
subscribes to the bridge's session lifecycle, debounces offline events, renders
per-channel templates, POSTs JSON to webhooks or sends mail, and keeps a bounded
delivery history. Factory: `createNotificationManager(resolveProcess)`. The
`resolveProcess` injection is the design seam — the comment says it explicitly:
> `resolveProcess` is supplied by the runtime — this package deliberately knows nothing about HookManager.

**`config.ts`** — the channel store. A *total* normalizer (anything invalid is
dropped, not rejected), two channel kinds (`"email"` / `"webhook"`), atomic
write via `.tmp` + `rename` + `chmod 0600`, and a `cached` module singleton.
Representative symbols: `loadNotificationsConfig`, `saveNotificationsConfig`,
`normalizeChannel`, `renderTemplate` (`{uin}`-style substitution that
JSON-escapes when the template parses as JSON). Log strings:
`"failed to write initial notifications.json: %s"`, `"notifications.json unreadable; using defaults: %s"`.

**`debounce.ts`** — 42 lines, pure, no I/O. `DebounceMachine` with `onOffline` /
`onOnline` / `onTimerElapsed` returning discriminated decisions
(`{kind:"emit"|"schedule"|"cancel"|"none"}`). Suppresses flapping: an account that
reconnects inside `debounceSeconds` never fires.

### 2.3 Dependencies

From a per-region symbol-ownership scan (`/tmp/deps.mjs`, which maps every bare
identifier to the region that declares it):

| module | intra-`src` | below-layer |
| --- | --- | --- |
| `smtp.ts` | *(none)* | **none** — `node:net`, `node:tls`, `Buffer` only |
| `config.ts` | `extractAddress`, `parseRecipients` ← `smtp.ts` | `clampInt`, `boolOr`, `isObject` ← `common/coerce.ts`; `createLogger` ← `common/logger.ts`; `DEFAULT_EMAIL_BODY`, `DEFAULT_WEBHOOK_BODY` ← `common/notification-templates.ts`; `fs`, `path` |
| `debounce.ts` | *(none)* | **none** — pure |
| `manager.ts` | `loadNotificationsConfig`, `isEmailChannel`, `renderTemplate`, `normalizeNotificationsConfig` ← `config.ts`; `formatSmtpError`, `parseRecipients`, `sendSmtpMail` ← `smtp.ts`; `DebounceMachine` ← `debounce.ts` | `createLogger` ← `common/logger.ts`; `errorMessage` ← `common/errors.ts`; `positiveIntEnv` ← `common/env.ts`; **`loadOneBotConfig` ← `onebot/config.ts`**; `fetch` + `AbortSignal.timeout` |

**No `hono`, no `ws`, no OIDB, no highway, no cookies, no `node:sqlite`.** The
entire subtree is `node:` built-ins plus three tiny `common/` helpers.

The one hard coupling is `loadOneBotConfig(uin).notifications?.channelIds`
(`reference/index.mjs:348813`) — per-UIN channel opt-in lives in the *OneBot*
config file. The reference's `../onebot/src/config.ts` region (35,903 B) declares
`notifications: { channelIds: [] }` at `reference/index.mjs:5178`.

### 2.4 Is it needed for the goal?

**Yes — this is a genuine SnowLuma extension, but it is blocked, and it is not
reachable from any OneBot action.**

Three honest points:

- It is **not** an OneBot v11 action. Nothing in `ONEBOT-ACTION-SPEC.md` calls it.
  It listens to account online/offline and pushes to webhook/email.
- It **is** a user-facing SnowLuma feature: it has its own config file
  (`config/notifications.json`), its own per-UIN config key
  (`notifications.channelIds`), and three WebUI routes
  (`GET /api/notifications/config`, `GET /api/notifications/recent`,
  `POST /api/notifications/test` — `reference/index.mjs:373815-373878`).
- But its **entry point is `src/index.ts`**, not the OneBot dispatcher
  (`reference/index.mjs:374220`). Porting it does not add a single action.

So: **on the "all SnowLuma extensions" path, yes; on the "all OneBot v11 actions"
path, no.** It is cheap (867 L, zero missing capabilities) but it sits *downstream*
of three things the rewrite does not have (§2.5).

### 2.5 Minimum viable slice

Ordered, each step blocking the next:

1. **`debounce.ts` (42 L)** — zero deps. Land first, test in isolation. Nothing
   else in the layer can be exercised without it.
2. **`smtp.ts` (290 L)** — zero deps. Self-contained; testable against a socket
   pair without a network. This is the largest single chunk and the one with real
   bug surface (STARTTLS upgrade, `AUTH PLAIN` → `LOGIN` fallback, dot-stuffing).
3. **`config.ts` (255 L)** — needs `clampInt`/`boolOr` from `common/coerce.ts`,
   which **does not exist in the rewrite** (`grep -rn 'clampInt\|boolOr' ts/` →
   exit 1). Either port `coerce.ts` (23 L) or inline two helpers. Also needs the
   two template constants from `common/notification-templates.ts` (13 L).
4. **`manager.ts` (280 L)** — the blocker. It needs:
   - `BridgeManager.subscribeSessions({started, closed})` — **absent**
     (`grep -rn 'subscribeSessions' ts/` → exit 1). `ts/src/bridge/events.ts`
     gives you an event bus, but the reference's `subscribeSessions` is a
     *different* API: a two-callback session-lifecycle subscription that lives on
     `BridgeManager`, not on the bus.
   - `loadOneBotConfig(uin).notifications.channelIds` — **absent**
     (`grep -rn 'loadOneBotConfig' ts/src/` → exit 1). There is no
     `onebot/config.ts` at all (`find ts/src -name 'config*.ts'` → 0 hits).
   - `positiveIntEnv` — **present** (`ts/src/bridge/env.ts:25`).
   - `createLogger`, `errorMessage` — **present** (`ts/src/onebot/log.ts`).
5. **WebUI routes** — `ts/src/webui` does not exist. Without it the manager has no
   config editor and no "test send" button, i.e. the feature is unconfigurable by
   a user.

**Verdict: 4 of 5 steps are unblocked; step 4 needs two prerequisite modules
(`onebot/config.ts` and a session-subscription surface on `BridgeManager`) that are
outside this subtree.** Porting notifications before those two is a 867-line
orphan. Land `debounce` + `smtp` + `config` now (587 L, zero deps), defer
`manager` until `onebot/config.ts` exists.

---

## 3. `src/update` — 6 modules, 677 L, 24,116 B

### 3.1 Module list

| module | lines | bytes | role |
| --- | ---: | ---: | --- |
| `src/update/files.ts` | 173 | 6,166 | manifest read/validate + transactional apply/rollback |
| `src/update/release.ts` | 119 | 4,627 | GitHub release fetch (API → HTML fallback) |
| `src/update/download.ts` | 112 | 4,935 | resumable asset download + sha256 + unzip/untar |
| `src/update/check.ts` | 96 | 2,899 | cached "is there a newer version" probe |
| `src/update/sources.ts` | 92 | 2,981 | mirror list + per-mirror reachability probe |
| `src/update/service.ts` | 85 | 2,508 | phase state machine (`idle`/`downloading`/`ready`/`error`) |

### 3.2 It is a version checker **and a self-updater** — and in this bundle it is a no-op 【实测】

Both halves are real in the pristine bundle: `check.ts` asks "is there a newer
release", `service.ts`/`download.ts`/`files.ts` replace `index.mjs` on disk and
re-exec. That is more than a version checker.

**But in `reference/index.mjs` the whole thing is short-circuited.** Five sites,
all marked with the same comment:

```bash
$ grep -n 'AUTO-UPDATE DISABLED\|auto-update-disabled\|auto-update-off\|example.invalid' reference/index.mjs
365478:var RELEASE_ROOT = "https://example.invalid/auto-update-disabled"; /* AUTO-UPDATE DISABLED */
365621:			return false; /* AUTO-UPDATE DISABLED: upstream release paths removed */
365639:	const apiUrl = `https://api.example.invalid/auto-update-off/releases/${version ? `tags/v${version}` : "latest"}`;
365694:	/* AUTO-UPDATE DISABLED by Haizakura: upstream repo deleted */ return false;
369696:	const url = `https://example.invalid/auto-update-off/download/v${version}/${name}`;
```

Consequences, exactly:

- `check.ts:365693` — `isEnabled()` has its env read **overridden by an
  unconditional `return false`**:
  ```js
  function isEnabled() {
      const v = (process.env.SNOWLUMA_UPDATE_CHECK ?? "").trim().toLowerCase();
      /* AUTO-UPDATE DISABLED by Haizakura: upstream repo deleted */ return false;
  }
  ```
  So `getUpdateInfo()` always returns `{...emptyResult(current), error: "disabled"}`.
  **The update check can never report an update.**
- `release.ts:365639` — the primary API URL points at `api.example.invalid`.
- `release.ts:365621` — the HTML fallback's asset matcher returns a hard `false`,
  so `parseReleaseAssetsPage` can never find an asset and throws
  `"发布页面没有可验证的更新包"`.
- `download.ts:369696` — the download URL points at `example.invalid`.

`files.ts`, `download.ts` and `service.ts` **compile and run**, but
`downloadUpdate()` can never produce a payload because `releaseAsset()` throws
first. **The subtree is dead code in this bundle, by design.**

This is also why the pristine↔reference diff shows 4 of the 6 `src/update`
regions differing (§0.1): the repo's copy is the *disabled* variant, and it is
rebranded `SnowLuma-v…` → `Haizakura-v…`. The 22-line diff in `release.ts` is
almost entirely these two changes.

### 3.3 Dependencies

| module | intra-`update` | below-layer | external npm |
| --- | --- | --- | --- |
| `sources.ts` | — | `normalizeUpdateSourceConfig` ← `common/update-source.ts`; `readRuntimeConfig`, `updateRuntimeConfig` ← `common/runtime.ts`; `APP_VERSION` ← `common/version.ts` | `fetch`, `performance` |
| `release.ts` | `RELEASE_ROOT`, `sourceUrls` ← `sources.ts` | `parseVersion` ← `common/semver.ts` | — |
| `check.ts` | `fetchRelease` ← `release.ts`; `readUpdateSource` ← `sources.ts` | `parseVersion`, `compareVersions` ← `common/semver.ts`; `createSingleFlightCache` ← `common/single-flight-cache.ts`; `createLogger` ← `common/logger.ts`; `APP_VERSION` | — |
| `files.ts` | — | `parseVersion` ← `common/semver.ts` | `node:fs/promises`, `node:os`, `node:crypto`, `node:path` |
| `download.ts` | `assetName`, `fetchRelease` ← `release.ts`; `isRuntimeEntry`, `readManifest` ← `files.ts`; `readUpdateSource`, `sourceUrls` ← `sources.ts` | — | **`fflate` (`unzipSync`)**, **`tar` (`So`)**, `node:crypto`, `node:stream` |
| `service.ts` | `downloadUpdate` ← `download.ts`; `exists`, `readManifest`, `updateDirectory` ← `files.ts` | `parseVersion` ← `common/semver.ts`; `createLogger` ← `common/logger.ts` | — |

**`ts/package.json` has no runtime dependencies at all** — only
`typescript` and `@types/node` as devDependencies. `download.ts` needs *two*
(archive extractors); `check.ts` needs `semver`, which is also not a dependency.

What the rewrite already has: `createLogger` (`onebot/log.ts`),
`createSingleFlightCache` (`bridge/single-flight-cache.ts`), `APP_VERSION`
(`onebot/actions/info.ts:21`, value `"0.2.4.2"`), `loadRuntimeConfig`
(`host/runtime-config.ts:594`), and a private `normalizeUpdateSourceConfig`
(`host/runtime-config.ts:293` — **not exported**).

What it does not have: `parseVersion`/`compareVersions` (`grep -rn 'parseVersion\|compareVersions'
ts/src/` → exit 1; no `semver` dep), `updateRuntimeConfig`/`saveRuntimeConfig`
(exit 1), `unzipSync`/`tar` (exit 1), any `release.json` at the repo root.

### 3.4 Is it needed for the goal?

**No. Do not port it.**

The justification, in the order that actually decides it:

1. **It implements no OneBot action.** `ONEBOT-ACTION-SPEC.md` has zero entries
   for it; `grep -n 'update' ONEBOT-ACTION-SPEC.md` matches only the description
   text of `get_group_todo_list`.
2. **It is not a SnowLuma extension feature either** — it is the *installer* for
   the SnowLuma binary distribution. It has no config file of its own
   (`sources.ts` reads the `updateSource` key out of `runtime.json`, which the
   rewrite already models), no per-UIN key, and no user-facing surface outside
   the WebUI's `/api/update/*` routes.
3. **It is disabled in this bundle.** Even a perfect port would be a no-op: five
   sites hard-return `false` / point at `example.invalid` (§3.2). Porting it
   means porting a feature that was deliberately turned off.
4. **It costs two new npm dependencies** (`fflate`, `tar`) that the rewrite
   currently has zero of, plus `semver`. That is a dependency-budget decision, not
   a porting decision, and it buys nothing on the stated goal.
5. **Its only consumers do not exist.** `webui/update-routes.ts` (67 L) and
   `src/index.ts`'s restart path both need `ts/src/webui`, which is absent.

**What breaks without it:** nothing in the OneBot surface, nothing in the
SnowLuma extension surface. The only thing lost is the WebUI's "check for
updates" button — which, per §3.2, is already dead in the reference. A user
upgrades by replacing the directory, exactly as they do today.

**If it is ever wanted anyway**, the honest ordering is
`files.ts` → `sources.ts` → `release.ts` → `download.ts` → `service.ts` →
`check.ts`, with `semver` + `fflate` + `tar` added first. That is a 677-line
subtree plus three dependency decisions, to re-enable a feature that is currently
commented out. I recommend against spending the budget.

---

## 4. `src/network` — 2 modules, 1,556 L, 60,265 B

### 4.1 Module list

| module | lines | bytes | role |
| --- | ---: | ---: | --- |
| `src/network/satori-server-adapter.ts` | 1,458 | 56,040 | full Satori v1 protocol server (HTTP action + WS event stream) |
| `src/network/satori-mount.ts` | 98 | 4,225 | monkey-patch that routes `path: "/v1/events"` to the adapter |

Both carry `// @ts-nocheck` and a header explaining they are spliced in from
`manifest-extra.json` (【指令级】, `reference/index.mjs:343221`, `:344677`).

### 4.2 What each module does

**`satori-server-adapter.ts`** — a complete implementation of the Satori v1
protocol as a *fifth* network kind. Two transports on one port:
`POST /v1/<resource>.<method>` for actions, `GET /v1/events` (WebSocket upgrade)
for the event stream. Named symbols: `SatoriServerAdapter`, `SATORI_API` (24
handlers), `SATORI_FEATURES` (27 advertised methods), `satoriParseContent`,
`satoriEncodeSegments`, `satoriConvertOneBotEvent`. Log strings:
`"[%s] Satori listening %s:%d%s"`, `"Satori adapter mounted (sentinel path=%s, …)"`,
`"Satori v1 · %d 个事件客户端"`. Notable behaviours kept: unsupported methods
answer **404** (not 501), a 10-second `IDENTIFY` deadline, and — importantly — a
**security check that no un-identified socket ever receives an event frame**:
> SECURITY: only sockets that completed IDENTIFY may receive event frames.
> Without this check a connection that never authenticated would still receive
> full event payloads (message contents included) during the 10 s IDENTIFY grace window.

**`satori-mount.ts`** — 98 lines that replace
`OneBotInstance.prototype.createNetworkAdapter` with a wrapper, then call
themselves once at module tail (`reference/index.mjs:344772`). The path
`/v1/events` is a **sentinel** meaning "this `wsServers[]` entry is really a
Satori server". The header documents why: adding a real `satoriServers` kind
would require touching `config.ts`'s hard-coded 4-kind `fromJson`/`toJsonObject`
and would renumber 432 regions.

### 4.3 Dependencies — and how much of it the rewrite already has

The adapter is *deliberately* built only on names the OneBot layer already
exports, so it adds no new npm dependency. `grep -c 'Hono\|hono'` inside the
region → **0**; it uses `node:http` directly.

| dependency | declared in | present in rewrite? |
| --- | --- | --- |
| `IOneBotNetworkAdapter` | `../onebot/src/network/adapter.ts` | ✅ `ts/src/onebot/adapter.ts` |
| `isAuthorized`, `normalizePath`, `parseRequestPath`, `safeClose`, `safeSend`, `rawDataToString` | `../onebot/src/network/utils.ts` | ✅ `ts/src/onebot/adapter.ts` |
| `WebSocketServer`, `WebSocket`, `abortUpgrade` | `../websocket/src/server.ts` | ✅ `ts/src/onebot/websocket.ts` |
| `readRequestBody`, `writeJson`, `RequestBodyTooLargeError` | `../onebot/src/network/http-server-adapter.ts` | ✅ `ts/src/onebot/http.ts` |
| `RETCODE` | `../onebot/src/types.ts` | ✅ `ts/src/onebot/types.ts` |
| `createLogger` | `../common/src/logger.ts` | ✅ `ts/src/onebot/log.ts` |
| `generateAccessToken` | `../onebot/src/config.ts` | ❌ **absent** (exit 1) |
| `OneBotInstance` (prototype to patch) | `../onebot/src/instance.ts` | ❌ **absent** — `grep -rn 'class OneBotInstance' ts/src/` → exit 1 |

**The rewrite took a different, better route for the mount.**
`ts/src/onebot/manager.ts:550-565` inlines the sentinel test into the module-level
`createNetworkAdapter`, instead of monkey-patching a prototype:

```ts
case "wsServer": {
  const config = desired.config as WsServerConfig;
  const normalizedPath = (config.path ?? "?").split("?")[0]?.replace(/\/+$/, "") || "/";
  if (config.protocol === "satori" || normalizedPath === "/v1/events") {
    return new SatoriServerAdapter(desired.name, config, ctx);
  }
  return new WsServerAdapter(desired.name, config, ctx);
}
```

So **`satori-mount.ts` (98 L) is already superseded — do not port it.** The
rewrite's version is idempotent by construction, has no `__haizakuraSatoriMounted`
flag, and cannot be defeated by a `createNetworkAdapter` rename. `ts/test/onebot-satori-server.test.ts`
already asserts the sentinel routing works end-to-end 【实测 — the test exists; I
did not run it】.

### 4.4 The real gap: 15 of 24 methods 【实测】

```bash
$ n=$(grep -n '^var SATORI_API = {' reference/index.mjs | cut -d: -f1)   # 344176
$ awk -v s=$n 'NR>=s{ if($0 ~ /^};/) exit; if($0 ~ /^\t"/){ split($0,a,"\""); print a[2] } }' \
      reference/index.mjs | sort > /tmp/ref_api.txt
$ grep -o '^    "[a-z-]*\.[a-z.-]*":' ts/src/onebot/network/satori-server-adapter.ts \
    | tr -d ' :"' | sort > /tmp/our_api.txt
$ wc -l < /tmp/ref_api.txt   # 24
$ wc -l < /tmp/our_api.txt   # 9
$ comm -23 /tmp/ref_api.txt /tmp/our_api.txt
channel.get
friend.approve
friend.delete
guild.approve
guild.get
guild.member.approve
guild.member.get
guild.member.kick
guild.member.list
guild.member.mute
guild.member.role.set
guild.role.list
reaction.create
reaction.delete
reaction.list
$ comm -13 /tmp/ref_api.txt /tmp/our_api.txt      # extra methods we invented
                                                 # (empty — good, no divergence)
```

Missing: the whole `guild.*` family (12 methods) and the whole `reaction.*`
family (3 methods). Also absent:

- **`SATORI_FEATURES`** — the reference advertises 27 feature ids in `login.get`
  and `login-added`; the rewrite hard-codes `features: []` (3 sites: lines 58,
  208, 259). Satori clients that gate on `features` will think the bot supports
  nothing.
- **`satoriIsBotUin`** — the reference has a 5-range bot-UIN table
  (`3328144510`, `2854196301-2854216399`, `66600000`, `3889000000-3889999999`,
  `4010000000-4019999999`); the rewrite hard-codes `is_bot: false` (line 40).
- **`makeDefaultSatoriServer`** — a `127.0.0.1:5600` default listener with a
  random token. Dead code in the reference too (declared at `:344663`, never
  called), so its absence costs nothing.

### 4.5 Is it needed for the goal?

**Technically yes (it is a documented SnowLuma extension), practically no
(it is 85% done and adds no action parity).**

- It is a **5th `NetworkKind`** in the reference (`onebot-network.md` §一 lists it
  as `satoriServer`), and SnowLuma documents it. That puts it inside "all SnowLuma
  extensions".
- But **Satori is a different protocol from OneBot v11.** A Satori client cannot
  invoke OneBot actions through this adapter; it can only invoke the 24 Satori
  methods, which are a *subset* re-expressed. Porting the missing 15 methods
  therefore adds **zero** OneBot action coverage.
- The security-relevant surface (IDENTIFY gating, token rotation closing live
  sockets, `403 login not found` on `satori-user-id` mismatch) is **already
  ported** and already tested.

So the honest answer: **this is the cheapest of the three to *finish* and the
least valuable to finish.** 15 methods × ~15 lines each ≈ 225 lines, plus a
27-entry feature array and a bot-UIN table.

### 4.6 Minimum viable slice

If you want it complete, this order (each step independently testable, no step
blocks another):

1. **`SATORI_FEATURES` + `is_bot` table** (~45 L) — pure data, no behaviour
   change beyond what clients read. Fixes the "client sees no features" bug.
2. **`guild.get` / `guild.list` / `guild.role.list`** (~50 L) — read-only,
   maps to `get_group_info` / `get_group_list`, which the port already calls.
3. **`guild.member.get` / `guild.member.list`** (~60 L) — read-only, maps to
   `get_group_member_info` / `get_group_member_list`.
4. **`channel.get` / `channel.list`** (~45 L) — read-only.
5. **`guild.member.kick` / `.mute` / `.role.set`** (~70 L) — the first
   *mutating* methods. Note `satoriMuteGuildMember` converts ms → s
   (`Math.max(1, Math.ceil(durationMs / 1000))`); get that wrong and a 1-second
   mute becomes 1000 seconds.
6. **`reaction.create` / `.delete` / `.list`** (~60 L) — maps to
   `set_msg_emoji_like` / `get_emoji_likes`.
7. **`guild.member.approve` / `guild.approve` / `friend.approve` / `friend.delete`**
   (~70 L) — approval flows, maps to `set_group_add_request` /
   `set_friend_add_request` / `delete_friend`.

Total ≈ 400 lines. **This is a good "fill the empty afternoon" task, and a
medium-priority one at that.** Do not let it jump ahead of `src/notifications`,
which is a real feature.

---

## 5. Cross-cutting: prerequisites these three subtrees share

Three small `common/` helpers are needed by more than one subtree and **do not
exist in the rewrite**. Each is a file, not a project.

| helper | region | size | needed by |
| --- | --- | ---: | --- |
| `clampInt`, `boolOr`, `isObject` | `../common/src/coerce.ts` (`:174`) | 23 L | `notifications/config` |
| `parseVersion`, `compareVersions` | `../common/src/semver.ts` (`:365447`) | 28 L | `update/*` (4 modules) |
| `DEFAULT_EMAIL_BODY`, `DEFAULT_WEBHOOK_BODY` | `../common/src/notification-templates.ts` (`:347941`) | 13 L | `notifications/config` |

```bash
$ grep -rn 'clampInt\|boolOr' ts/                         # exit 1 — absent
$ grep -rn 'parseVersion\|compareVersions' ts/src/        # exit 1 — absent
$ grep -rn 'DEFAULT_EMAIL_BODY\|DEFAULT_WEBHOOK_BODY' ts/src/   # exit 1 — absent
```

`semver.ts` is the awkward one: it is a thin wrapper over the **npm `semver`
package** (`reference/index.mjs:365128` region `semver@7.7.4`), so porting it
verbatim means adding a dependency. A 40-line `x.y.z` parser + comparator is
sufficient for the only two callers (`update/check`, `update/files`) and stays
inside the rewrite's zero-dependency budget.

Already present, for reference: `createLogger` + `errorMessage`
(`ts/src/onebot/log.ts`), `positiveIntEnv` (`ts/src/bridge/env.ts`),
`createSingleFlightCache` (`ts/src/bridge/single-flight-cache.ts`), `isObject`
(`ts/src/bridge/web/qzone-public.ts:67` — exported, just from the wrong module),
`APP_VERSION` (`ts/src/onebot/actions/info.ts:21`), `loadRuntimeConfig`
(`ts/src/host/runtime-config.ts:594`).

---

## 6. Recommendation

| subtree | lines | verdict | why |
| --- | ---: | --- | --- |
| `src/update` | 677 | **DO NOT PORT** | installer, not a feature; **disabled at 5 sites in this bundle**; needs `fflate` + `tar` + `semver`; zero OneBot actions |
| `src/network` | 1,556 | **85% done — finish last** | `satori-mount.ts` already superseded by `manager.ts:550`; 15/24 methods missing; adds zero OneBot action coverage |
| `src/notifications` | 867 | **REAL FEATURE — but blocked** | genuine SnowLuma extension; 587 L unblocked now; `manager.ts` needs `onebot/config.ts` + `BridgeManager.subscribeSessions` |

If I had to pick one thing to do next from this document, it is **not** any of
the three: it is `ts/src/onebot/config.ts` (35,903 B), because it unblocks
`notifications/manager.ts` *and* it is the missing piece behind the
`notifications.channelIds` key the rewrite's own `OneBotConfigLike` comment
already admits it does not model (`ts/src/onebot/manager.ts:86-88`).

---

## 7. Corrections this document makes to `docs/src-layer-map.md`

1. **§1, "everything else (470 regions) — byte-identical" is wrong.** 24
   non-`node_modules` regions differ in content (10 under `src/*`). The numbers
   in §2.2 of that document still reproduce exactly — it is the *identity* claim,
   not the size claim, that is false.
2. **§1, "the *logic* of the layer did not change at all"** — false for
   `src/update`. The repo's copy is the `AUTO-UPDATE DISABLED` variant, and
   `check.ts`'s `isEnabled()` is hard-wired to `false`. This changes the
   recommendation in §8.2 item 1 of that document ("`src/update` — all 6 modules
   … It is the only subtree that can be landed end-to-end"): it can be landed,
   but landed *dead*.
3. **§8.2 item 2, "`notifications/manager.ts` … needs the bridge's event stream,
   which we have (`bridge/events.ts`)"** — misleading. `manager.ts` needs
   `BridgeManager.subscribeSessions({started, closed})`, which is a different
   API from the event bus and is **absent** (`grep -rn 'subscribeSessions' ts/`
   → exit 1). The dependency is on `bridge/manager.ts` (249 L), not
   `bridge/events.ts`.
