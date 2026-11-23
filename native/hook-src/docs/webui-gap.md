# `src/webui` — inventory and porting plan

Status as of 2026-11-23. Companion to `docs/src-layer-map.md` (§2.2, §3, §5, §6, §8 already
cover the subtree's size and graph; this document corrects two of its classifications and
turns them into a porting plan).

Everything below was produced by reading and grepping. **No build was run**: no `npx tsc`,
no `node --test` (other agents share `ts/build/`). One script was written, at
`/home/ubuntu/webui-scan/scan.mjs` (outside the repo, like the layer map's `work/` scripts);
it streams `reference/index.mjs` through `readline` and measures `//#region` spans. A second
throwaway script decoded the docs corpus with `node:zlib`.

`reference/index.mjs` was not modified. `PROGRESS.md` and `MEMORY.md` were not modified.

Evidence grades: 【实测】 I ran it · 【指令级】 static reading of the bundle · 【推断】 inferred
from shape/convention · 【未确认】 not verified.

---

## 0. Five findings that change the plan

Read these first; the rest of the document is the evidence.

1. **The "three generated regions" framing is wrong for `src/webui`.** §1 of the layer map
   groups `docs-corpus.ts`, `docs-mount.ts` and `cache-headers.ts` as generated because all
   three carry `@ts-nocheck`. Only **one** of them actually carries the `GENERATED FILE`
   banner: `docs-corpus.ts`. `grep -c 'GENERATED FILE' reference/index.mjs` → **1**, and it
   is at line 350396 inside `docs-corpus.ts`. `docs-mount.ts` and `cache-headers.ts` are
   100% hand-written prose-and-code patch files that happen to opt out of type-checking
   because they monkey-patch a function across a scope boundary. 【实测】
   Consequence: they are **in** the porting budget, not excluded from it.

2. **`docs-corpus.ts` is 23 non-data lines.** Of its 3,582 lines, **3,559** are continuation
   lines of one base64 string literal; the other 23 are a banner, a `var ... =` and a blank
   line. There is no logic to port at all. 【实测】

3. **`docs-mount.ts` registers only 3 routes, and about 104 of its 1,383 lines are
   unreachable — but the Markdown→HTML renderer is *live*, not dead.** The routes are
   `/api/docs/nav`, `/api/docs/doc` and `/docs/raw/*`. The renderer survives because
   `hzDocsJsonDoc` calls `hzDocsGetDoc` → `hzDocsRenderMarkdown` and ships the resulting
   `html` in its JSON body, so the SPA gets server-rendered HTML from a JSON endpoint rather
   than from a server-rendered page. What *is* unreachable is the standalone page layer:
   `hzDocsHandleIndex` (11 L), `hzDocsIndexPage` (48 L), `hzDocsDocPage` (28 L) and
   `hzDocsDirPage` (17 L) — **104 L / 7.5%** — because `hzDocsRegisterRoutes` deliberately
   does not register `/docs` itself (the file's own comment explains that the SPA owns that
   route). `hzDocsShell` (29 L), `hzDocsStyle` (65 L), `hzDocsNavHtml` and
   `hzDocsLangSwitcher` stay live through `hzDocsUnauthorized` (52 L) and `hzDocsErrorPage`.
   【指令级 + 实测】 — I computed this as a call graph from the three registered handlers,
   then hand-checked the `/docs/raw/*` branch (`docs-mount.ts:1204`), which short-circuits
   before the page `switch`. My first draft of this document claimed the whole renderer was
   dead; that was wrong and this paragraph replaces it.

4. **The SPA frontend is not in the bundle and is not in this repo.** `static-frontend.ts`
   serves `path.resolve(__dirname, "client")` and, when `index.html` is missing, returns
   `WebUI client bundle not found. Run \`pnpm --filter webui build\``. There is no `client/`
   directory anywhere in the repo (`find . -type d -name client` → nothing outside
   `reference/`), and no `webui` package (`find . -name package.json` → only `ts/package.json`).
   【实测】 A WebUI port therefore delivers an **API**, not a panel UI, unless the SPA is
   separately rebuilt.

5. **Our side already has three of the four MVP prerequisites**, under different names.
   `ts/src/host/runtime-config.ts` (725 L) already loads/validates `config/runtime.json` and
   `config/webui.json` including `webuiPort`/`webuiHost`/`webuiTls` and the
   `passwordHash`(128 hex)/`passwordSalt`(32 hex) schema. `ts/src/onebot/http.ts` (831 L) is a
   real `node:http` server. `ts/src/onebot/manager.ts` exposes `describeStatuses()`,
   `has()`, `get()`, `list()`. **What is missing is the scrypt verifier, the TOTP, the router,
   and the session-token table.** 【实测】

---

## 1. Module inventory

### 1.1 Totals, reproduced independently

My scanner re-derives the layer map's §2.2 figures exactly. 【实测】

```
regions=33  lines=10603  bytes=1691839
```

That is **2.83%** of the bundle's 374,326 lines and **12.16%** of its 13,916,690 bytes.
The layer map's §2.2 row for `src/webui` is therefore confirmed, and the file size
(13,916,690 B) and region count (33) match §9's identity check.

The task brief's headline — "33 modules / 10,603 lines / 1,691,839 B" — is correct as a
description of the **region text**. It is not the porting cost. Here is the split.

### 1.2 Generated vs. actually to be ported

Classification rule, applied mechanically to all 33 regions: a region is *generated* only if
it contains the literal banner line `GENERATED FILE`; a region is *patch/local* if it carries
`@ts-nocheck` without that banner; otherwise *hand-written*. 【实测】 (per-file grep loop over
all 33 extracted regions: exactly 3 files have any banner, 30 have neither.)

| class | modules | lines | bytes | share of subtree bytes |
| --- | ---: | ---: | ---: | ---: |
| **generated** (`docs-corpus.ts`) | 1 | 3,582 | 1,445,600 | **85.4%** |
| hand-written | 30 | 5,429 | 181,472 | 10.7% |
| patch / local-only (`docs-mount.ts`, `cache-headers.ts`) | 2 | 1,592 | 64,767 | 3.8% |
| **total** | **33** | **10,603** | **1,691,839** | 100% |

**Actually to be ported = 7,021 lines / 246,239 B** — i.e. the whole subtree **minus
`docs-corpus.ts`**, which is 1.77% of the bundle's bytes rather than 12.16%.

Two cross-checks on the "generated" call:

- The banner itself, quoted verbatim from `reference/index.mjs:350392-350406`: 【实测】

  ```
  //#region src/webui/docs-corpus.ts
  // @ts-nocheck
  /* eslint-disable */
  // ---------------------------------------------------------------------------
  // GENERATED FILE - do not edit by hand.
  //
  //   regenerate:  node scripts/gen-docs-corpus.mjs
  //   sources:     ../../../../tmp/corpus-real  +  ../docs-internals
  //   contents:    206 Markdown files, 2947696 bytes
  //   corpus sha256: b6d472f391a569f24420ac4d047af3eae64afa36ee6a01ef793a35f243fb47de
  ```

- The data is real and verifiable. I concatenated the 3,559 quoted continuation lines,
  base64-decoded, gunzipped, and hashed: 1,423,228 base64 chars → 1,067,419 gz bytes →
  **3,050,964 raw bytes**, sha256 **`b6d472f391a569f24420ac4d047af3eae64afa36ee6a01ef793a35f243fb47de`**
  — identical to the banner. It parses to a JSON object of **206 keys, all `.md`**. 【实测】

  Note the banner says `2947696 bytes` of Markdown but the decoded JSON is 3,050,964 B; the
  difference is the JSON wrapper (quotes, key separators, escaping), not corruption — the
  sha256 covers the JSON, not the concatenated sources. 【推断】

### 1.3 Every module

Sorted by bytes. "class" uses the rule above. `@ts-nocheck` is shown because it is the
signal the layer map used to over-classify.

| module | lines | bytes | class | `@ts-nocheck` |
| --- | ---: | ---: | --- | --- |
| `docs-corpus.ts` | 3,582 | 1,445,600 | **generated** | yes |
| `docs-mount.ts` | 1,383 | 56,777 | patch (local-only) | yes |
| `server.ts` | 1,591 | 52,289 | hand-written | no |
| `ui-config.ts` | 621 | 18,405 | hand-written | no |
| `backup.ts` | 460 | 16,562 | hand-written | no |
| `restore.ts` | 296 | 10,441 | hand-written | no |
| `auth.ts` | 292 | 9,576 | hand-written | no |
| `totp.ts` | 242 | 8,467 | hand-written | no |
| `cache-headers.ts` | 209 | 7,990 | patch (local-only) | yes |
| `mutation-trace.ts` | 182 | 7,843 | hand-written | no |
| `storage-routes.ts` | 228 | 7,423 | hand-written | no |
| `storage-settings.ts` | 177 | 6,837 | hand-written | no |
| `storage-management.ts` | 220 | 6,639 | hand-written | no |
| `consent.ts` | 157 | 5,690 | hand-written | no |
| `debug-tools.ts` | 124 | 4,871 | hand-written | no |
| `connection-diff-loop.ts` | 78 | 2,643 | hand-written | no |
| `onebot-token-policy.ts` | 47 | 2,228 | hand-written | no |
| `client-ip.ts` | 59 | 2,203 | hand-written | no |
| `request-security.ts` | 58 | 2,080 | hand-written | no |
| `update-routes.ts` | 67 | 1,962 | hand-written | no |
| `sse-response.ts` | 71 | 1,892 | hand-written | no |
| `system-settings.ts` | 66 | 1,767 | hand-written | no |
| `state-stream.ts` | 77 | 1,743 | hand-written | no |
| `tls.ts` | 65 | 1,648 | hand-written | no |
| `log-export.ts` | 36 | 1,367 | hand-written | no |
| `state-bus.ts` | 38 | 1,243 | hand-written | no |
| `webui-login.ts` | 29 | 1,064 | hand-written | no |
| `port.ts` | 38 | 1,038 | hand-written | no |
| `connection-snapshot.ts` | 24 | 873 | hand-written | no |
| `static-frontend.ts` | 22 | 837 | hand-written | no |
| `listener-exposure.ts` | 21 | 780 | hand-written | no |
| `debug-stream.ts` | 22 | 587 | hand-written | no |
| `state-wiring.ts` | 21 | 474 | hand-written | no |

### 1.4 The `docs-mount.ts` / `cache-headers.ts` origin, verified against the pristine bundle

The layer map §1 note 2 says these two (plus `docs-corpus.ts`) exist only in the local
bundles. I re-verified against `/sdcard/snowluma-restore/restored/dist/index.mjs`
(12,338,350 B): 【实测】

```
pristine src/webui: modules=30 lines=5429 bytes=181467
in reference but NOT pristine:
  cache-headers.ts
  docs-corpus.ts
  docs-mount.ts
in pristine but NOT reference: (none)
```

The pristine 30 modules total **5,429 L / 181,467 B** — which is exactly my "hand-written"
row above (5,429 L / 181,472 B; the 5-byte delta is one module's line-ending at the slice
boundary 【推断】). So the porting target splits cleanly:

- **5,429 L of original SnowLuma 2.4.0 WebUI**, present in every bundle.
- **1,592 L of local additions** (`docs-mount`, `cache-headers`) that a rewrite is free to
  design differently, and probably should.

---

## 2. Responsibilities of the hand-written modules

Grouped by job. Line counts are from §1.3. Every description below is 【指令级】 unless
marked.

### HTTP server, routing, listener

| module | responsibility |
| --- | --- |
| `server.ts` (1,591 L) | The entire WebUI. Exports `initWebUI(desiredPort, oneBotManager, hookManager, notificationManager, listener)` and `sessionTokens`. Builds one `Hono` app, installs the global middlewares, registers **58** route handlers, mounts `registerStorageRoutes`, `updateRoutes`, `registerStaticFrontend`, then binds with `@hono/node-server`'s `serve()` — optionally over TLS — and returns `{port, stop()}`. It is a star: out-degree 30 in the layer map's graph, the highest in `src/*`. |
| `port.ts` (38 L) | `findAvailablePort(start, {host})` — `net.createServer()` bind probe, walking upward from the requested port. Startup convenience only. |
| `static-frontend.ts` (22 L) | `registerStaticFrontend(app, root, target)` — serves `index.html` at `/` and `/index.html` with `Cache-Control: no-store` and a runtime-target injection (`injectWebuiTarget`), `serveStatic({root})` for assets, and a catch-all `app.get("*")` that returns 404 for `/api/`, `/avatar/`, `/ui-asset/` but the SPA shell for everything else. **Registers the catch-all last; route order matters for anything mounted after it.** |
| `listener-exposure.ts` (21 L) | `isValidBindHost` (IP-or-hostname syntax check) and `checkListenerExposure({webuiHost, tlsEnabled, pairOk})` — refuses to start when the bind host is malformed or TLS was enabled with an unusable cert/key pair. Called at boot from `server.ts:1156` and again from `system-settings.ts` and `backup.ts`. |
| `tls.ts` (65 L) | `validateTlsPair(cert, key)` via `tls.createSecureContext`, `resolveTlsContext(source)` / `requireTlsContext(...)` — reads the cert/key pair from `config/` and either reports why it is unusable or returns the `{cert, key}` object `serve()` needs. |
| `client-ip.ts` (59 L) | `parseTrustProxy(raw)` → `{kind: none|all|loopback|ip-list}` from `runtime.json`'s `trustProxy`; `makeClientIpResolver(mode, headerName)` → the `getClientIp(c)` used by the login rate limiter; `describeTrustProxy` for display. Backed by hono's `getConnInfo`. |

### Auth and session

| module | responsibility |
| --- | --- |
| `auth.ts` (292 L) | `WebuiAuth` — the credential store. `load()` reads `config/webui.json`, validates the live schema, and on corruption **backs the file up and regenerates**; supports `SNOWLUMA_DEV_MODE=1` (fixed dev password `snowluma-dev`) and `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD`. Hashing is **scrypt N=16384 r=8 p=1, 64-byte key, 16-byte salt**, hex-encoded into `passwordHash`/`passwordSalt`. Also `evaluatePasswordRules` / `isStrongPassword` (the `PASSWORD_RULES` table behind `/api/auth/check-strength`) and `prepareWebuiAuthStateForRestore` for backup import. Writes atomically via tmp+rename, mode `0600`. |
| `webui-login.ts` (29 L) | `completeWebuiLogin(auth, body, atMs)` — the pure decision function: verify password → `decideSecondFactorLogin` (TOTP / recovery code) → `{kind: ok|needs-totp|bad-password|bad-second-factor|bad-request}` plus `mustChangePassword` and any TOTP state to persist. Also `invalidateOtherSessions`. Kept separate from `server.ts` so the branching is testable without HTTP. |
| `totp.ts` (242 L) | RFC 6238 TOTP at **30 s period, 6 digits, window 1**, over the vendored `otpauth` (`Secret`/`HOTP`/`TOTP` classes) with `node:crypto` HMAC. Enrollment (`beginTotpEnrollment` → base32 secret + `otpauth://` URI, TTL 600 s), `confirmTotpEnrollment`, `disableTotp`, `regenerateRecoveryCodes` (8 codes over a 32-char ambiguity-free alphabet), and — the interesting part — `rewrapTotpSecret` / `prepareTotpStateForRestore`: the TOTP secret is **encrypted at rest with a key derived from the login password (scrypt + AES-GCM, 12-byte IV)**, so a password change has to re-wrap it and a restore-from-backup has to re-derive. `parseTotpStateLenient` tolerates a malformed `totp` field rather than failing the whole login. |
| `request-security.ts` (58 L) | `webuiSecurityHeaders` middleware (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'`); `registerLoginRequestSecurity` (hono `bodyLimit` 16 KiB on `/api/login` only, and a JSON content-type check); `extractWebuiSessionToken` (header `x-snowluma-token`, else `Authorization: Bearer …`); and the `snowluma_avatar_session` cookie helpers (`httpOnly`, `SameSite=Strict`, `path=/avatar`, `secure` when TLS). |
| `onebot-token-policy.ts` (47 L) | `validateOneBotAccessTokenChanges(previous, next)` — refuses to clear or duplicate the OneBot access token of a **non-loopback** inbound adapter, or to move a token onto a differently-named adapter. Raises `OneBotAccessTokenPolicyError`. Depends on `client-ip.ts`'s `isLoopbackClientIp`. |
| `consent.ts` (157 L) | EULA/privacy gate. `AGREEMENT_FILES` = `EULA.md` + `PRIVACY.md`; `loadAgreements()`/`getAgreementsPayload()` read them and expose a version; `recordConsent(version)` writes `config/consent.json`; `resolveEnvironmentConsent` honours `SNOWLUMA_ACCEPT_EULA` / `SNOWLUMA_ACCEPT_PRIVACY` (`1|true|0|false`, anything else throws). `server.ts` holds a mutable `consentGatePending` and 403s every `/api/*` route outside a 5-path allowlist until consent is recorded. |

### Config read/write

| module | responsibility |
| --- | --- |
| `ui-config.ts` (621 L) | `config/ui.json` + `config/ui-assets/background`. `loadUiConfig` / `saveUiConfig` / `normalizeStoredUiConfig`; a 5 MiB `MAX_BACKGROUND_BYTES` cap; `sniffImageMime` (magic-byte sniffing, not the client's `Content-Type`); `readBackgroundImage` / `writeBackgroundImage` / `clearBackgroundImage`; `publicAppearance()` — the **unauthenticated** subset served at `/api/ui/public`; and a `cached` wrapper for the hot path. Biggest hand-written module after `server.ts`. |
| `system-settings.ts` (66 L) | `coerceSettingsPatch(body)` — strict validator for `POST /api/system/settings` (`webuiPort` must be an integer 1..65535, etc.); `evaluateSettingsSave(patch, …)` decides whether a restart is needed; `tlsCertDeletionBlocked` prevents deleting a cert while TLS is on. The strict counterpart to `runtime-config.ts`'s lenient loader. |
| `storage-settings.ts` (177 L) | `LogStorageSettingsManager` — read persisted (`runtime.json`) vs. env-override vs. effective log-storage policy, and persist+apply a change under a lock. Three error types (`…InputError`, `…LockedError`, `…TransactionError`) mirror the three failure modes. |
| `storage-management.ts` (220 L) | `StorageManagementService` — snapshot/cleanup of the log directory and the OneBot stream-storage temp area, plus the list of online accounts. `publicLogStorageStatus` redacts the filesystem path out of the status before it leaves the process. |

### Backup / restore

| module | responsibility |
| --- | --- |
| `backup.ts` (460 L) | `buildBackup(readFile, listPerUin, …)` — assembles a versioned backup bundle (`BACKUP_APP = "snowluma"`) from a **static allowlist** of config files plus a pattern match for per-account `onebot_<uin>.json`, marking each entry binary/credential. Also `prepareRestorePlan(backup, …)` — validates the whole bundle *before* anything is written, and `RestorePreflightError`. 32 MiB decoded cap. |
| `restore.ts` (296 L) | `restoreBackup(plan, …)` — the transactional apply: snapshot the target dir, write, verify, and roll back on failure. `RestoreTransactionError` carries `phase`, `transactionId`, `rollbackSucceeded`, `snapshotDir`, `committed`, `failedFiles` — a deliberately rich error because a half-restored config directory is the worst outcome in the product. |

### Streaming / live state

| module | responsibility |
| --- | --- |
| `state-bus.ts` (38 L) | `StateBus` — a tiny pub/sub over a `Set` of listeners with one resource name per publish (`"qq-list"`, `"connections"`, `"processes"`). Frozen-snapshot iteration; a throwing subscriber cannot abort the fan-out; `dispose()` and idempotent unsubscribe handles. |
| `state-wiring.ts` (21 L) | `createStateWiring(bridgeManager)` — glues the bridge manager's `subscribeSessions({started, closed})` to the bus. Called once from `src/index.ts:31`, not from `server.ts`. |
| `state-stream.ts` (77 L) | `bindStateStream({bus, resources, …})` — turns a bus subscription into SSE frames for `/api/state/stream`, with per-resource filtering and a merged initial snapshot. |
| `connection-diff-loop.ts` (78 L) | `createConnectionPoller({intervalMs = 500, …})` — **one shared** poll loop for all `/api/connections` subscribers, publishing only when the serialized snapshot actually changed; ref-counted so the timer stops at zero subscribers. |
| `connection-snapshot.ts` (24 L) | `comparableConnectionSnapshot(snapshot)` — projects an account list down to the fields that matter (uin, nickname, adapter name/kind/status) so the poller's diff is not fooled by volatile fields. |
| `sse-response.ts` (71 L) | `sseResponse(requestSignal, start, shutdownSignal)` — the SSE plumbing: `ReadableStream`, `AbortSignal.any`, keep-alive timer, subscription teardown. |
| `debug-stream.ts` (22 L) | `createFramePusher({encode, desiredSize})` — returns a `push(payload)` that **drops** frames under backpressure and counts the drops, instead of buffering unboundedly. |
| `log-export.ts` (36 L) | `buildFullTraceDownload(entries, metadata)` — the `snowluma-trace-<ts>.log` attachment, prefixed with a `PRIVACY_WARNING` that the export may contain unredacted credentials. |
| `mutation-trace.ts` (182 L) | `traceAuthenticatedWebuiMutation(request, fn)` / `traceWebuiMutationRequestChunk` — request-scoped tracing of **state-changing** calls only (`READ_ONLY_METHODS` = GET/HEAD/OPTIONS skipped; `/api/debug/upload` special-cased as a streamed body), carrying a request id into the log summary. |

### Debug surface

| module | responsibility |
| --- | --- |
| `debug-tools.ts` (124 L) | `streamUploadToDisk` — browser→server file upload into `os.tmpdir()/webui-upload`, with `safeUploadName` reducing the client filename to a basename (never trusted for placement) and a 24 h sweep of old uploads. `buildStreamInvokeResponse` — the `/api/debug/invoke-stream` response framing. |

### Patch / local-only modules (not in SnowLuma 2.4.0)

| module | responsibility |
| --- | --- |
| `docs-mount.ts` (1,383 L) | Offline documentation. Two jobs: (a) an **in-SPA JSON API** — `/api/docs/nav`, `/api/docs/doc` — serving the decoded corpus with markdown rendered server-side to HTML, a 5-language switcher (`zh-cn`, `zh-tw`, `ja`, `zh-pseudo`, `en`), grouping and a heading/TOC index; (b) `/docs/raw/*` for raw `.md` download. It **does not** register `/docs` pages: the SPA owns that route, and the file's own comment says so. It installs itself by **reassigning the top-level `registerStaticFrontend`** (`registerStaticFrontend = function hzDocsPatched...`) so it can register before the SPA catch-all without editing `server.ts`. Contains a hand-written Markdown→HTML renderer (`hzDocsRenderMarkdown` 149 L + `hzDocsInline` 70 L + `hzDocsRenderList` 54 L + `hzDocsRenderTable` 30 L and helpers) which is **live** — it feeds `hzDocsJsonDoc`'s `html` field — while the standalone page layer above it is not (§0.3). |
| `cache-headers.ts` (209 L) | Fixes a real hono defect documented in its own header: `serveStatic` emits only `Last-Modified`, so browsers apply heuristic caching and changes are invisible until Ctrl+Shift+R, and conditional requests return 400. It wraps `registerStaticFrontend` the same way, adds `Cache-Control` (1 y `immutable` for content-hashed filenames, `no-cache` otherwise), a weak `ETag` derived from mtime+size, and synthesises `304` responses. Everything is inside `try/catch` — a header-rewrite failure logs a warning and must not break the response. |

---

## 3. Dependency direction

### 3.1 What the layer map's "lower layers" column actually measures

The column is built by `work/src-region-scan.mjs` from bare identifiers in a `src/webui`
region that are declared in a region **outside `src/`**, bucketed by the first two path
segments of the declaring region. 【指令级, read from the script at lines 331-356】

Aggregating the JSON for all 33 modules gives four buckets: 【实测】

| bucket | distinct names | meaning |
| --- | ---: | --- |
| `../common` | 29 | the shared package: logger, runtime config, log summary, coercion helpers |
| `../onebot` | 13 | the OneBot config/status/stream-storage layer |
| `../..` | 9 | `node_modules` — hono + its middleware |
| `../bridge` | 2 | the **native hook package** |

Per module:

```
docs-corpus.ts             —
server.ts                  common(15) ..(2) onebot(10) bridge(2)
docs-mount.ts              common(1) ..(2)
ui-config.ts               common(5)
backup.ts                  common(2) onebot(2)
restore.ts                 common(2)
auth.ts                    common(1)
totp.ts                    —
storage-routes.ts          common(2)
storage-management.ts      onebot(1) common(2)
cache-headers.ts           —
mutation-trace.ts          common(7)
storage-settings.ts        common(1)
consent.ts                 common(1)
debug-tools.ts             —
connection-diff-loop.ts    common(3)
state-stream.ts            common(2)
sse-response.ts            common(1)
update-routes.ts           ..(1) common(1)
system-settings.ts         common(1)
tls.ts                     common(1)
client-ip.ts               ..(1)
request-security.ts        ..(4)
onebot-token-policy.ts     ..(1)
state-bus.ts               common(1)
port.ts                    —
log-export.ts              —
webui-login.ts             —
connection-snapshot.ts     —
static-frontend.ts         common(1) ..(1)
debug-stream.ts            —
state-wiring.ts            —
listener-exposure.ts       —
```

### 3.2 The three claims worth verifying, and their verdicts

**(a) `src/webui` does not call `src/bridge`. — CONFIRMED, with one important correction.**

The layer map's §6.3 says zero edges in both directions. My own aggregation of the JSON's
`edges` array reproduces that: webui's outbound edges go 47→`src/webui`, 3→`src/update`,
2→`src/notifications`, and **0**→`src/bridge`. 【实测】

But `server.ts` **does** have a `bridge(2)` entry, and the layer map's §3 row says
`common(15), onebot(10), ..(2), bridge(2)`. Those two names are
`getRuntimeIntegrity` and `hasLowProcessIntegrity`, on a single line
(`server.ts:846`). I located their declaring region: **`//#region ../bridge/src/runtime-integrity.ts`**
at `reference/index.mjs:5062` — i.e. the `../bridge` *native hook package*, which is a
**different thing from `src/bridge`**. 【实测】

So the correct statement is: `src/webui` depends on `../bridge` (the hook runtime, which our
port covers as `ts/src/hook-client.ts`) but on **nothing** in `src/bridge` (the OIDB/API
layer). The layer map's prose in §6.3 is right; its §3 column name is ambiguous, because
`bridge(2)` there means `../bridge`, not `src/bridge`. Anyone reading the table as "webui
needs the bridge layer" would be wrong, and this is the single most consequential
misreading available in that document.

That one line is also the **only** coupling point, verified across all 33 modules:
`grep -rno 'getRuntimeIntegrity|hasLowProcessIntegrity|BridgeManager|buildApiHub|new Bridge'`
over the 33 extracted regions returns exactly two hits, both on `server.ts:846`. 【实测】

**(b) `server.ts`'s 10 `onebot` names are real. — CONFIRMED by static read.**

Occurrence counts in `server.ts` 【实测】: `loadOneBotConfig` 2, `saveOneBotConfig` 1,
`loadGlobalSettings` 2, `saveGlobalSettings` 1, `assertValidOneBotConfig` 1,
`publicStatus` 1, `collectActionDocs` 1, `collectCategories` 1, `snapshotStreamStorage` 1,
`clearInactiveStreamStorage` 1. These are the per-account `onebot_<uin>.json`, the global
`onebot.json`, the OneBot API-doc table used by `/api/debug/actions`, and the stream-storage
temp snapshot/clear used by the storage routes. All are `src/onebot` concerns.

**(c) The 9 `..` names are hono. — CONFIRMED.** `Hono` (7 uses across the subtree),
`serveStatic` 6, `setCookie` 3, `getCookie` 3, `contentType` 3, `getConnInfo` 2, `serve` 1,
`deleteCookie` 1, `bodyLimit` 1. Only `serve` and `serveStatic` are not pure middleware
helpers, and both are replaceable in a `node:http` port. 【实测】

### 3.3 Dependency direction, stated as a rule

```
src/index.ts  ──initWebUI(...)──┐
                                ├──▶ src/webui ──▶ src/update (5)──▶ src/notifications (3)
                                └──▶ src/bridge
                    src/webui ──▶ ../common, ../onebot, ../bridge (1 line), node_modules(hono, otplib)
                    src/webui ──▶ src/webui  (47 internal edges; server.ts owns 27 inbound)
```

`initWebUI` is the only entry point, called once from `src/index.ts:49` with five injected
collaborators and a `listener` options object. The options are `host`, `tlsEnabled`,
`trustProxy`, `stateBus`, `updateRoot`, `restart` — plus `oneBotManager`, `hookManager`,
`notificationManager` as positional arguments. 【实测, `reference/index.mjs:374183` region】

The managers' required surface, extracted by grep over `server.ts` — this is the whole
contract the WebUI needs from the rest of the process: 【实测】

| collaborator | methods actually called |
| --- | --- |
| `oneBotManager` | `getConnectionStatuses()` ×4, `getInstance()` ×3, `getInstances()` ×3, `reloadConfig()` ×1, `reloadGlobalSettings()` ×1 |
| `hookManager` | `listProcesses()` ×2, `loadProcess()` ×1, `refreshProcess()` ×1, `unloadProcess()` ×1 |
| `notificationManager` | `getRecent()` ×1, `testSend()` ×1 |
| `listener` | `host`, `tlsEnabled` ×6, `trustProxy`, `stateBus` ×5, `updateRoot`, `restart` ×2 |

That is a **small** contract: 5 + 4 + 2 = 11 methods. Note that `hookManager`'s four methods
are exactly the `src/bridge/manager.ts` surface the layer map §7 flags as ❌ MISS on our
side — so the `/api/processes/*` routes (4 of 58) are the one part of `server.ts` that
cannot be written against our current codebase without first building process enumeration.

---

## 4. Generated-file strategy for `docs-corpus.ts`

### 4.1 What it is, exactly

One top-level `var hzDocsCorpusGzipB64 = "<1,423,228 base64 chars>"` — 3,559 continuation
lines, 23 non-data lines. Decoded: a gzipped JSON object mapping 206 Markdown paths to their
full text (3,050,964 B of JSON). Languages present: 40 files each in `en`, `ja`,
`zh-pseudo`, `zh-tw`, plus 46 language-neutral files at the root and in
`guide/`, `protocol/`, `webui/`, `advanced/`, `dev/`, `internals/`. 【实测】

### 4.2 What the code actually does with it

There is exactly **one** consumer of the symbol and **one** decode site in the entire
13.9 MB bundle: 【实测】

```
350412:var hzDocsCorpusGzipB64 =
370908:		var raw = gunzipSync(Buffer.from(hzDocsCorpusGzipB64, "base64")).toString("utf8");
```

The decode is `hzDocsDecodeCorpus()` in `docs-mount.ts:45` — **lazy and memoised**: it
returns a module-level `hzDocsCorpusCache` if set, otherwise gunzips + `JSON.parse`s once,
and on failure logs and caches `{}` so a broken corpus degrades to empty documentation
rather than a crash. Ten call sites read from the resulting plain object by key
(`corpus[key]`, `Object.keys(corpus)`, `.filter(k => k.startsWith(prefix))`). 【实测】

Nothing else in the bundle touches docs: `hzDocsRenderMarkdown` (`docs-mount.ts:441`)
consumes the strings, and `docs-mount.ts`'s three routes are the only HTTP exposure.

### 4.3 Recommendation: **replace with a filesystem read, and do not port the corpus.**

Rationale, in order of weight:

1. **There is no logic in it to port.** 3,559/3,582 lines are one string literal. A
   "port" would be a data copy whose correctness is unverifiable except by re-checking a
   sha256 — which is exactly what the banner already does. It contributes 0 lines of
   behaviour and 85.4% of the subtree's bytes.
2. **The read pattern is already key→string.** The consuming code does `corpus[key]`,
   `Object.keys(corpus)`, and prefix filtering — i.e. it treats the corpus as a **flat
   read-only map of path→markdown**. A directory read reproduces that with no change to the
   consumers' logic: build the map once from `readdir`+`readFile` under a docs root, or read
   one file per request (the paths are already validated, see below).
3. **The path-traversal defence gets *stronger*, not weaker.** `hzDocsResolvePath`
   (`docs-mount.ts:77`) rejects NUL, backslashes, any `..` segment and any dot-leading
   segment, then — its own comment calls this the critical layer — **only accepts keys that
   exist in the corpus object**. With an embedded map that is trivially safe. With a
   filesystem read you must instead resolve, then `path.resolve` and verify the result is
   still under the docs root. That is a well-understood check, but it is *new code that must
   be written and tested*, and it is a security boundary. Budget for it explicitly rather
   than treating the swap as free.
4. **It keeps the port's diff honest.** 1.45 MB of base64 in a rewrite's history proves
   nothing and obscures review of the 246 KB that does.
5. **`docs-mount.ts` is itself local-only**, absent from the pristine 2.4.0 bundle (§1.4), so
   there is no compatibility obligation to reproduce it byte-for-byte.

If documentation content is wanted at parity, the concrete plan is: **regenerate at build
time from the real Markdown sources** (the banner names them:
`../../../../tmp/corpus-real` + `../docs-internals`) into a `docs/` data directory shipped
alongside the binary, and have the rewrite read that directory. That keeps the 206 files as
files, makes the corpus greppable and diffable, and drops the gzip step entirely.

**Do not omit documentation silently.** The routes are cheap and the auth gate is shared; the
honest options are "read from disk" (recommended) or "not implemented yet, route returns
404" (acceptable, but say so in the code).

---

## 5. Minimum viable slice

Goal: a WebUI that an operator can log into, read and write OneBot config with, and that
serves at least one feature that proves the wiring is real. Deliberately excluded: TOTP,
consent gate, backup/restore, docs, storage management, updates, notifications, debug tools,
the SPA.

### 5.0 The decision that comes first: routing

`server.ts` is 1,591 lines of hono. Our `ts/package.json` has `typescript` and
`@types/node` only, and `ts/src` has no router (`grep -rl 'URLPattern|matchRoute|router'`
→ one unrelated hit in `bridge/packet-pipeline.ts`). 【实测】 Our existing HTTP server
(`ts/src/onebot/http.ts`) does **not** route by path segment at all — it computes one
`action` suffix off a single configured prefix and dispatches on it. 【实测】

Two viable choices:

- **A. Hand-rolled dispatch table** (~150-200 L): `node:http` already gives us
  `req.method` + `new URL(req.url)`; a `Map<string, handler>` plus a `:param` matcher covers
  all 58 routes. **No new dependency.** Recommended.
- **B. Add hono** (~30 KB, 4 packages): buys `serveStatic`, `bodyLimit`, cookie helpers, and
  `getConnInfo` for free, and makes a later transliteration of `server.ts` mechanical.

Recommendation: **A for the MVP**, because the MVP needs 8 routes, not 58, and the hono
dependency would be pulled in before there is any code that needs it. Revisit at the point
the static frontend is ported (§0.4 says there is no frontend to serve yet anyway).

### 5.1 The steps, in order

Each step is independently testable and leaves the tree buildable.

| # | step | files to create | why this order |
| ---: | --- | --- | --- |
| 1 | **Password verifier** — scrypt N=16384/r=8/p=1, 64-byte key, 16-byte salt, hex in/out; constant-time compare. | `ts/src/webui/auth-hash.ts` | Pure function, zero deps beyond `node:crypto`, testable in isolation with a golden vector taken from the reference. Everything else needs it. |
| 2 | **Credential store** — load/validate `config/webui.json` (`passwordHash` 128 hex, `passwordSalt` 32 hex, `mustChangePassword`), atomic write, corrupt-file backup-and-regenerate, `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD`. **Reuse, do not rewrite:** `ts/src/host/runtime-config.ts:683 summarizeWebuiAuthState` already validates this exact schema. | `ts/src/webui/auth.ts` | This is the reference's `WebuiAuth.load()` minus TOTP. Wraps existing validation; no new schema work. |
| 3 | **Session tokens** — `Map<token, {expiresAt, mustChangePassword}>`, 32-byte hex tokens, 24 h TTL, a 60 s `unref`'d janitor. | `ts/src/webui/session.ts` | The reference keeps this inline in `server.ts` (`sessionTokens`, `purgeExpiredTokens`); extracting it makes step 5 a thin filter. Also the thing `docs-mount` would import later — in the reference it reaches into `server.ts` for it, which is a wart worth not copying. |
| 4 | **Login/logout + the auth filter** — `POST /api/login` (rate-limited by client IP: 5 attempts / 15 min), `POST /api/logout`, `GET /api/auth/state`; plus the `"*"`-equivalent middleware that 401s every `/api/*` except the allowlist. | `ts/src/webui/login.ts` (pure decision, mirrors `webui-login.ts` without TOTP), `ts/src/webui/middleware.ts` (token extraction + security headers) | The decision function is kept separate from HTTP so it can be unit-tested, exactly as the reference does it. Reuse the four headers from `request-security.ts:29-32` verbatim. |
| 5 | **The router + listener** — dispatch table, `node:http` `createServer`, bind to `webuiPort`/`webuiHost` from `runtime-config.ts`, port-in-use fallback. | `ts/src/webui/router.ts`, `ts/src/webui/server.ts` (`initWebUI`) | First point where the thing is reachable. `findAvailablePort` is ~20 L and can be inlined into `server.ts`. |
| 6 | **Config read/write** — `GET /api/status`, `GET|POST /api/config/:uin`, `GET|POST /api/global-config`. | `ts/src/webui/routes/config.ts` | The "one real feature". Needs the OneBot config load/save that `server.ts` gets from `src/onebot`; **our port does not have those functions yet** (grep for `loadOneBotConfig` / `saveOneBotConfig` in `ts/src` → 0 hits 【实测】), so this step also creates `ts/src/onebot/config-store.ts`. |
| 7 | **Static shell (optional, 20 L)** — serve `index.html` from a `client/` dir if present, else a plain-text "WebUI client not built" page. | extend `ts/src/webui/server.ts` | Makes the slice demo-able in a browser without pretending an SPA exists. |
| 8 | **Wire it** — call `initWebUI(...)` from the process entry point with the real manager and a `stop()` handle. | edit the composition root | Parity with `src/index.ts:49`. Without this nothing starts. |

Minimum honest delivery for "a working admin panel": **steps 1-6 + 8**, roughly **700-900
lines** of new TypeScript by comparison with the reference's 292 (`auth`) + 29
(`webui-login`) + 58 (`request-security`) + ~250 of `server.ts` that the MVP subset actually
needs. That is **≤15% of the subtree's 7,021 porting lines** for the majority of its value.

### 5.2 What the MVP deliberately does not prove

State this in the PR, not just here:

- **No TOTP.** `auth.ts`'s `WebuiAuth` couples password and second factor; the MVP takes the
  password half only and must leave `totp` absent from `config/webui.json` — which
  `parseLiveAuthState` already tolerates (it logs a warning and drops an invalid field). 【指令级】
- **No consent gate.** The reference 403s the panel until `/api/agreements/record-consent`
  is called. Skipping it means an MVP panel is *less* gated than production; if that is
  unacceptable, `consent.ts` (157 L, one `common` dependency) is a cheap step 4.5.
- **No `/api/processes/*`.** Four of the reference's 58 routes need
  `hookManager.listProcesses/loadProcess/refreshProcess/unloadProcess`, which we do not have
  (layer map §7). Either omit those routes or return an explicit "not implemented".
- **No backup/restore.** `backup.ts` + `restore.ts` are **756 lines** and the riskiest code
  in the subtree (transactional restore with rollback). They are also the feature most
  likely to destroy an operator's config if ported carelessly. Port last, with tests.

---

## 6. Verification of this document

- Subtree totals re-derived independently by `/home/ubuntu/webui-scan/scan.mjs`; the
  `33 / 10,603 / 1,691,839` triple matches `docs/src-layer-map.md` §2.2 exactly, and the
  bundle identity (13,916,690 B, 374,326 lines) matches its §9. 【实测】
- `GENERATED FILE` count in the whole bundle: **1** (line 350396). `@ts-nocheck` count:
  **5** (lines 343244, 344700, 350393, 370861, 372244 — three of them in `src/webui`).
  Both greps run directly against `reference/index.mjs`. 【实测】
- Corpus decoded with `node:zlib`; sha256 of the 3,050,964-byte JSON equals the banner's. 【实测】
- Region-set diff against `/sdcard/snowluma-restore/restored/dist/index.mjs` via `comm` on
  sorted region names: exactly `cache-headers.ts`, `docs-corpus.ts`, `docs-mount.ts` extra,
  none missing. Pristine subtree measured at 30 modules / 5,429 L / 181,467 B. 【实测】
- Dependency buckets come from `/home/ubuntu/src-regions.json` (the layer map's own
  intermediate), re-aggregated per module; the `../bridge` region identity was checked
  against the literal `//#region` banner at `reference/index.mjs:5062`. 【实测】
- Route counts come from `grep -cE 'app\.(get|post|...)\('` over the extracted regions:
  `server.ts` **58** (all 58 at registration indent, none inside comments),
  `update-routes.ts` 6, `static-frontend.ts` 4, `storage-routes.ts` 3, `docs-mount.ts` 5
  grep hits of which **3 are real registrations** — the other two are prose inside the
  header comment and inside a `/** */` block. 【实测】
- The reachability claim in §0.3 is a **call graph computed from the three registered
  handlers** over `docs-mount.ts`'s top-level function bodies, then hand-verified against
  the `/docs/raw/*` short-circuit at `docs-mount.ts:1204` and against
  `hzDocsUnauthorized`/`hzDocsErrorPage` keeping `hzDocsShell` alive. It is 【指令级】: it
  would be falsified by dynamic route registration on the `app` object. The only bracket
  access on `app` in the file is a boolean idempotency flag
  (`app[HZ_DOCS_ROUTE_FLAG]`, `docs-mount.ts:1271-1272`), not a registration. 【实测】 The
  104 L figure is the sum of the four page-layer functions' line spans, banner-inclusive.
  【未确认: whether any build-time transform injects a call to `hzDocsHandleIndex`; nothing
  in the bundle does】
- Adding a 9th `@ts-nocheck` module would not change the generated/hand-written split's
  conclusion, but note that `@ts-nocheck` on `docs-mount.ts` and `cache-headers.ts` means
  their 1,592 lines have **never been type-checked**. Porting them as-is would import
  latent type errors; porting them as real TypeScript is additional work this inventory's
  line counts do not capture.
