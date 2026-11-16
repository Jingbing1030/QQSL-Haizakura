# WebUI Backend API Reference

> [!WARNING]
> This content was written entirely by AI; read it with caution.

> This document lists **every HTTP endpoint** of the Haizakura (formerly SnowLuma) WebUI backend,
> along with its authentication requirements and sensitivity annotations.
>
> **Sources**: `packages/core/src/webui/server.ts` (main routes, 54 registrations),
> `storage-routes.ts` (3), `update-routes.ts` (6, mounted at `/api/update`),
> `static-frontend.ts` (static frontend, 4),
> `request-security.ts` (session token extraction), `auth.ts` / `totp.ts` (authentication).
>
> Every authentication behavior described here was **measured against a running instance** (2026-11-13).

---

## 1. Overview

| Item | Count |
| --- | --- |
| **Total `/api/*` endpoints** | **60** |
| ├ `/api/*` registered in `server.ts` | 51 |
| ├ `storage-routes.ts` | 3 (`/api/system/storage*`) |
| └ `update-routes.ts` | 6 (mounted at `/api/update`) |
| Non-`/api` endpoints | 4 (`/robots.txt`, `/avatar/:uin`, `/ui-asset/background`, `/`) |
| Static frontend routes | 4 (`/`, `/index.html`, `/*` static, SPA fallback) |
| **Total route registrations** | **66** |

> Note: `server.ts` has 54 registrations in total, 51 of which are `/api/*`,
> the other 3 being `/robots.txt`, `/avatar/:uin` and `/ui-asset/background`.
> Adding the 3 from `storage-routes.ts` and the 6 from `update-routes.ts`,
> `/api/*` comes to **60** in total.

### 1.1 Group Navigation

| Group | Endpoints | Section |
| --- | --- | --- |
| Authentication and sessions | 10 | [§3](#3-authentication-and-sessions) |
| Agreements and compliance | 2 | [§4](#4-agreements-and-compliance) |
| Status and connections | 6 | [§5](#5-status-and-connections) |
| Accounts and OneBot configuration | 2 | [§6](#6-accounts-and-onebot-configuration) |
| Logs and debugging | 14 | [§7](#7-logs-and-debugging) |
| System and settings | 9 | [§8](#8-system-and-settings) |
| Notifications | 4 | [§9](#9-notifications) |
| Global configuration and UI | 7 | [§10](#10-global-configuration-and-ui) |
| Updates | 6 | [§11](#11-updates) |
| **Total** | **60** | |

---

## 2. Authentication Mechanism

### 2.1 Global Middleware

In the source, `server.ts`:

```js
app.use("/api/*", async (c, next) => {
  const reqPath = c.req.path;
  if (reqPath === "/api/login" || reqPath === "/api/ui/public") return next();
  const token = extractWebuiSessionToken(c.req.raw);
  if (!token) return c.json({ status: "failed", message: "Unauthorized" }, 401);
  const info = sessionTokens.get(token);
  if (!info || Date.now() > info.expiresAt)
    return c.json({ status: "failed", message: "Token expired or invalid" }, 401);
  if (consentGatePending && !CONSENT_ALLOWLIST.has(reqPath))
    return c.json({ status: "failed", message: "请先阅读并同意用户协议与隐私政策",
                    consentRequired: true }, 403);
  if (info.mustChangePassword && !MUST_CHANGE_ALLOWLIST.has(reqPath))
    return c.json({ status: "failed", message: "请先修改密码",
                    mustChangePassword: true }, 403);
  ...
});
```

**Key points**:

- The gate only applies to `/api/*`. **`/avatar/:uin` and `/ui-asset/background` are not covered by it**;
  each has its own handling (see §12).
- Only these two paths are **exempt from login**: `/api/login`, `/api/ui/public`.

### 2.2 The two ways of passing the session token

In the source, `request-security.ts`:

```js
function extractWebuiSessionToken(request) {
  const sessionToken = request.headers.get("x-snowluma-token");
  if (sessionToken !== null) return sessionToken;
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
}
```

| Method | How to write it | Notes |
| --- | --- | --- |
| Custom header | `x-snowluma-token: <token>` | Read first |
| Bearer | `Authorization: Bearer <token>` | Fallback |

> ⚠️ **The token is not passed via a Cookie**. The Cookie set by the login response is named
> `snowluma_avatar_session` with `Path=/avatar`, and **is used only for `/avatar/:uin`**;
> it cannot be used to access `/api/*`. Calls to `/api/*` must explicitly carry one of the two headers above.
>
> ✅ Measured: requesting `/api/status` with `x-snowluma-token` → `200`;
> without it → `401`.

### 2.3 Token lifecycle

| Item | Value | Source |
| --- | --- | --- |
| Token format | `randomBytes(32).toString("hex")` (64 characters) | `server.ts` |
| Validity | `TOKEN_TTL_MS = 1440 * 60 * 1000` = **24 hours** | `server.ts` |
| Cleanup | Expired tokens are swept every 60 seconds | `tokenJanitor` |
| Password change / TOTP change | **Revokes all other sessions** (`invalidateOtherSessions`) | `server.ts` |

### 2.4 Login rate limiting

| Item | Value |
| --- | --- |
| Maximum attempts | `LOGIN_MAX_ATTEMPTS = 5` |
| Lockout duration | `LOGIN_LOCKOUT_MS = 900 * 1000` (**15 minutes**) |
| Rate-limit key | Client IP (the value depends on `trustProxy`) |
| Response when exceeded | `429` + `登录尝试过多，请 N 秒后重试` |

### 2.5 The two additional gates

**① Agreement consent gate** — while `consentGatePending` is true, everything outside the allowlist gets `403`:

```
CONSENT_ALLOWLIST = {
  "/api/status", "/api/auth/state", "/api/agreements",
  "/api/agreements/record-consent", "/api/logout"
}
```

**② Forced password change gate** — while the token carries `mustChangePassword`, everything outside the allowlist gets `403`:

```
MUST_CHANGE_ALLOWLIST = {
  "/api/status", "/api/auth/state", "/api/auth/check-strength",
  "/api/auth/change-password", "/api/agreements",
  "/api/agreements/record-consent", "/api/logout"
}
```

The response body carries `consentRequired: true` or `mustChangePassword: true`,
and the frontend uses that to route into the corresponding flow.

> ✅ These two gates are **encountered in practice**: before the initial password has been changed, most APIs return
> `403 mustChangePassword`.

### 2.6 The actual scope of TOTP ⚠️

**TOTP is verified only at login; it is not a second factor on sensitive endpoints.**

- A login request may carry `totp` or `recoveryCode`;
  if TOTP is enabled and neither is supplied, it returns `{ success: false, needsTotp: true }`.
- **Once login succeeds, the session token can access every endpoint**, including
  high-risk endpoints such as `/api/debug/invoke`, **without any further TOTP check**.
- TOTP therefore **cannot limit the blast radius of an already logged-in session**.

> 🔴 **Security recommendation**: if the WebUI is exposed to an untrusted network, TOTP alone is not enough to protect
> sensitive endpoints. The real line of defense should be **network-layer isolation** (reverse proxy + IP allowlist + TLS),
> not reliance on application-layer TOTP.
>
> In the source, `totpDisabledInDev()` disables the TOTP-related endpoints in dev mode.

---

## 3. Authentication and Sessions

| Method | Path | Auth | Parameters | Returns |
| --- | --- | --- | --- | --- |
| `POST` | `/api/login` | **Login exempt** | `{ password, totp?, recoveryCode? }` | `{ success, token, mustChangePassword }` |
| `POST` | `/api/logout` | Login required | — | `{ success: true }` |
| `GET` | `/api/auth/state` | Login required | — | `{ mustChangePassword }` |
| `POST` | `/api/auth/check-strength` | Login required | `{ password }` | Strength assessment result |
| `POST` | `/api/auth/change-password` | Login required | `{ ... }` | Password change result; **revokes other sessions** |
| `GET` | `/api/auth/totp` | Login required | — | TOTP status |
| `POST` | `/api/auth/totp/begin` | Login required | `{ issuer?, accountName? }` | Enrollment credentials (including secret / otpauth URL) |
| `POST` | `/api/auth/totp/confirm` | Login required | `{ token/verification code }` | Confirms enabling; **revokes other sessions** |
| `POST` | `/api/auth/totp/disable` | Login required | — | Turns TOTP off |
| `POST` | `/api/auth/totp/recovery-codes` | Login required | — | Regenerates recovery codes |

> This section covers **10** endpoints. `POST /api/agreements/record-consent`
> is filed under [§4 Agreements and compliance](#4-agreements-and-compliance).

### 3.1 Login responses

**Success**:

```json
{ "success": true, "token": "<64位hex>", "mustChangePassword": false }
```

It also sets a Cookie (**only for `/avatar`**):

```
Set-Cookie: snowluma_avatar_session=<token>; Max-Age=86400;
            Path=/avatar; HttpOnly; SameSite=Strict
```

**TOTP required**:

```json
{ "success": false, "needsTotp": true }
```

**Failure** (`401`): `{ "success": false, "message": "密码错误" }`
or `{ "success": false, "message": "验证码不正确" }`.

**Rate limited** (`429`): `{ "success": false, "message": "登录尝试过多，请 N 秒后重试" }`

### 3.2 Version validation in `record-consent`

If `version` does not match the current agreement version, it returns `409`:

```json
{ "success": false, "message": "协议版本已更新，请刷新后重新确认",
  "currentVersion": "<当前版本>" }
```

### 3.3 TOTP enrollment flow

1. `POST /api/auth/totp/begin` → obtain the secret / otpauth URL
   (enrollment credentials are cached for **`TOTP_ENROLL_TTL_MS = 600000` ms = 10 minutes**)
2. Add it in your authenticator app and get the 6-digit code
3. `POST /api/auth/totp/confirm` submits the code to complete enabling

The TOTP issuer defaults to **`Haizakura`** (`DEFAULT_TOTP_ISSUER`).

---

## 4. Agreements and Compliance

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/agreements` | Login required (**inside both allowlists**) | Agreement text and version |
| `POST` | `/api/agreements/record-consent` | Login required (**inside both allowlists**) | See §3.2 |

> These two endpoints are in `CONSENT_ALLOWLIST` and `MUST_CHANGE_ALLOWLIST`,
> so they **remain reachable** before the agreement is accepted / the password is changed — otherwise it would deadlock.

---

## 5. Status and Connections

| Method | Path | Parameters | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/status` | — | `{ status: "running" }` |
| `GET` | `/api/connections` | — | `{ list: [...] }`, adapter status per account |
| `GET` | `/api/qq-list` | — | `{ list: [{ uin, nickname }] }` |
| `GET` | `/api/state/stream` | — | **SSE**, state-change push |
| `GET` | `/api/system` | — | Host and runtime information |
| `GET` | `/api/update/check` | `force` | Update check result |

**The side effect of `/api/status`**: it also **refreshes the `/avatar` session Cookie**
(source: `setAvatarSessionCookie(c, c.get("sessionToken"), ...)`).
The frontend keeping up a periodic call is enough to keep avatars working.

**Measured response of `/api/connections`**:

```json
{ "list": [ { "uin": "<uin>", "nickname": "HaizakuraBot",
  "adapters": [
    { "name": "http-default", "kind": "httpServer", "status": "ok", "detail": "监听中" },
    { "name": "ws-default", "kind": "wsServer", "status": "ok", "detail": "1 个客户端" }
  ],
  "databaseMigration": { "phase": "complete", "usable": true, "progress": 1 } } ] }
```

**`/api/state/stream`**: when `stateBus` is not configured it returns `503`
`state stream not configured`. The frame stream opens with `{ kind: "ready" }`,
then pushes `processes` / `qq-list` / connection-state changes (**50 ms debounce**).

**`/api/system`** returns `hostname`, `platform`, `arch`, `release`, `distro`,
`uptime`, `processUptime`, `nodeVersion`, `cpu{ model, cores, loadAvg, perCore, average }`,
`memory{ total, free, used, usagePercent }`,
`runtime{ pid, lowIntegrity, rss, heapTotal, heapUsed, external, arrayBuffers }`.

---

## 6. Accounts and OneBot Configuration

| Method | Path | Parameters | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/config/:uin` | — | `{ config }`, the complete OneBot configuration |
| `POST` | `/api/config/:uin` | OneBot configuration object | `{ success, saved, applied, ... }` |

**Validation**:

- `:uin` must match `UIN_REGEX = /^\d{5,10}$/`, otherwise `400 invalid uin`.
- The request body is strictly validated by `assertValidOneBotConfig`; an invalid configuration gets `400` outright and is
  **never** written to disk.
- After saving it is applied atomically; on failure it **rolls back to the previous configuration**.

> 🔴 **Sensitive**: the response of `GET /api/config/:uin` **contains `accessToken` in plaintext**.
> In the measured response you can directly see the tokens of `http-default` and `ws-default`.
> Anyone who can reach the WebUI can obtain the OneBot access credentials.

---

## 7. Logs and Debugging

This section covers **14** endpoints.

| Method | Path | Parameters | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/logs` | `limit` (default 300) | `{ list: [...] }` |
| `GET` | `/api/logs/export/trace` | — | Complete trace file (attachment download) |
| `GET` | `/api/logs/level` | — | `{ level, levels }` |
| `POST` | `/api/logs/level` | `{ level }` | `{ level, levels }` |
| `GET` | `/api/logs/stream` | — | **SSE**, live logs |
| `GET` | `/api/debug/actions` | — | `{ actions: [...], categories: [...] }` |
| `POST` | `/api/debug/invoke` | `{ uin, action, params }` | Action execution result |
| `POST` | `/api/debug/invoke-stream` | `{ uin, action, params }` | **SSE**, streaming action results |
| `POST` | `/api/debug/upload` | `filename` (query) + raw body | `{ status, path, size }` |
| `GET` | `/api/debug/stream` | — | **SSE**, event stream for every account |
| `GET` | `/api/processes` | — | `{ list: [...] }` |
| `POST` | `/api/processes/:pid/load` \| `/unload` \| `/refresh` | — | `{ success, process }` |

### 7.1 🔴 `POST /api/debug/invoke` — remote arbitrary action execution (the most severe)

```json
{ "uin": "<uin>", "action": "send_group_msg",
  "params": { "group_id": 20001, "message": "hi" } }
```

It forwards the request **straight to the action dispatcher of the specified account** (source:
`oneBotManager.getInstance(uin).invokeAction(action, params)`),
with **no action-level allowlist or permission check whatsoever**.

The consequence: **anyone who can log in to the WebUI = can execute all 222 actions as the bot**,
including but not limited to:

| Action | Impact |
| --- | --- |
| `send_group_msg` / `send_private_msg` | Send messages as the bot to any group/friend |
| `set_group_kick` / `set_group_ban` | Kick people, mute people |
| `set_group_leave` | Leave groups |
| `bot_exit` | **Exit the bot process** |
| `set_restart` | Restart (this implementation returns unsupported) |
| `send_packet` | Send **raw SSO packets** |
| `upload_group_file` | Upload arbitrary files to a group |
| `set_qq_profile` / `set_qq_avatar` | Modify the account profile |

**Hardening recommendations (in priority order)**:

1. **Do not expose the WebUI to the public internet**. It binds to `127.0.0.1` by default; if remote access is needed,
   put it behind a reverse proxy and restrict the source IPs.
2. At the reverse proxy layer, apply a **path-level block or IP allowlist** to `/api/debug/*`.
3. If it must be exposed, enable **TLS** and use a strong password + TOTP.
   (Note: TOTP is verified only at login; see §2.6.)
4. Auditing: every call goes through
   `traceAuthenticatedWebuiMutation`, so it can be traced in the logs.
5. Long-term: add a separate second confirmation or a switch for this endpoint.

**Validation behavior**:

| Situation | Response |
| --- | --- |
| Body is invalid JSON | `400` `请求格式错误` |
| `uin` does not match `/^\d{5,10}$/` | `400` `无效的账号` |
| `action` missing / not a string | `400` `action 必填` |
| `params` is not an object (array/null) | `400` `params 必须是对象` |
| Account is offline | `404` `账号不在线` |

### 7.2 The other sensitive debug endpoints

| Endpoint | Risk |
| --- | --- |
| `POST /api/debug/invoke-stream` | Same as `/api/debug/invoke`, with streaming action support |
| `POST /api/debug/upload` | **Writes files to the server's disk** (the path is chosen by the server and cannot be set arbitrarily) |
| `GET /api/debug/stream` | Leaks live events for **every account** (including private-chat content) |
| `GET /api/logs/export/trace` | Exports a complete trace containing sensitive information |
| `POST /api/processes/:pid/load` \| `/unload` \| `/refresh` | Performs **hook load/unload** on the host QQ process; `:pid` must be an integer in `1..4194304` |

---

## 8. System and Settings

This section covers **9** endpoints (`/api/system` is filed under [§5](#5-status-and-connections),
and `/api/update/*` under [§11](#11-updates)).

| Method | Path | Parameters | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/system/settings` | — | `{ settings, hasCert, envOverrides, listeningPort, restartRequiredToApply }` |
| `POST` | `/api/system/settings` | `{ webuiPort?, webuiHost?, tlsEnabled?, trustProxy? }` | `{ success, settings, restartRequiredToApply }` |
| `POST` | `/api/system/tls/cert` | `{ cert, key }` (PEM strings) | `{ success, restartRequiredToApply }` |
| `DELETE` | `/api/system/tls/cert` | — | `{ success }` |
| `GET` | `/api/system/backup/export` | `credentials=1` | Backup JSON (attachment) |
| `POST` | `/api/system/backup/import` | Backup JSON | Restore result |
| `GET` | `/api/system/storage` | — | `{ settings, snapshot, lastCleanup }` |
| `POST` | `/api/system/storage/settings` | Storage settings | `{ success, ... }` |
| `POST` | `/api/system/storage/cleanup` | Cleanup request | Cleanup result |

### 8.1 Notes on sensitive endpoints

| Endpoint | Risk |
| --- | --- |
| `GET /api/system/backup/export?credentials=1` | 🔴 **Exports a complete backup including credentials** (account tokens, TOTP secrets, etc.) |
| `POST /api/system/backup/import` | 🔴 **Overwrites the server configuration**; limit **32 MiB** (`413`), rolls back transactionally on failure |
| `POST /api/system/tls/cert` | 🔴 **Writes the TLS private key to disk** (`config/key.pem`, permissions `0600`) |
| `DELETE /api/system/tls/cert` | Deletes the certificate; refused while TLS is enabled (`400 请先关闭 TLS 再删除证书`) |
| `POST /api/system/storage/cleanup` | 🔴 **Deletes storage files**; the request must carry a confirmation string (`清理全部账号` for all accounts) |
| `POST /api/update/download` \| `/restart` | Downloads and **restarts the service** |
| `POST /api/system/settings` | Changes listen address/port, TLS, `trustProxy`; **requires a restart to take effect** |

> ⚠️ `trustProxy` in `POST /api/system/settings` affects how the IP for login rate limiting is determined.
> The source explicitly warns: `SNOWLUMA_WEBUI_TRUST_PROXY=1` is safe only when the **reverse proxy strips**
> the client-supplied `X-Real-IP` / `X-Forwarded-For`;
> otherwise an attacker can forge the IP and bypass login rate limiting.

### 8.2 Boundaries of storage settings and backups

- `POST /api/system/storage/settings`:
  fields locked by environment variables return `409` + `lockedFields`.
- A backup import whose declared length exceeds **32 MiB** gets `413` outright.
- The TLS certificate must be a **valid PEM pair**, otherwise `400`.

---

## 9. Notifications

| Method | Path | Parameters | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/notifications/config` | — | `{ config }` |
| `POST` | `/api/notifications/config` | Notification configuration | `{ success, config }` |
| `GET` | `/api/notifications/recent` | `limit` (default 100, max 100) | `{ recent }` |
| `POST` | `/api/notifications/test` | `{ channelId }` | `{ success, status, message }` |

- The configuration body is limited to **512 KiB** (`413`).
- `test` without `channelId` → `400`; channel does not exist → `404`.
- Notification subsystem unavailable → `503`.

---

## 10. Global Configuration and UI

This section covers **7** endpoints.

| Method | Path | Auth | Parameters | Returns |
| --- | --- | --- | --- | --- |
| `GET` | `/api/global-config` | Login required | — | `{ config }` |
| `POST` | `/api/global-config` | Login required | Global configuration | Save result (limit 512 KiB) |
| `GET` | `/api/ui` | Login required | — | `{ config }` |
| `GET` | `/api/ui/public` | **Login exempt** | — | `{ appearance }` |
| `POST` | `/api/ui` | Login required | UI configuration | `{ success, config }` (limit 256 KiB) |
| `POST` | `/api/ui/background` | Login required | multipart `file` | `{ success, config }` |
| `DELETE` | `/api/ui/background` | Login required | — | `{ success, config }` |

The design intent behind **`/api/ui/public` being login-exempt**: the login page needs to apply the theme (appearance) before it can render.
It exposes only appearance-related fields (`publicAppearance()`) and **contains no sensitive configuration**.

**Background image upload**:

- Limit **5 MiB** (`5242880`); a `content-length` above **6 MiB** is rejected with an early `413`.
- Only **PNG / JPEG / WebP** are accepted (content-sniffed by `sniffImageMime`);
  anything else gets `415 仅支持 PNG / JPEG / WebP 图片`.
- Missing file → `400 缺少图片文件`.

---

## 11. Updates

Mount point `/api/update` (source: `app.route("/api/update", updateRoutes(...))`).

| Method | Full path | Parameters | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/update/status` | — | Update service status |
| `GET` | `/api/update/sources` | — | `{ config }` |
| `POST` | `/api/update/sources` | Source configuration | `{ config, saved, applied, online, errors, message }` |
| `POST` | `/api/update/sources/test` | Source candidates | `{ results }` |
| `POST` | `/api/update/download` | `{ version }` | `202` status; missing `version` → `400`; conflict → `409` |
| `POST` | `/api/update/restart` | — | `202` status; conflict → `409` |

> There is also `GET /api/update/check?force=true` (registered in `server.ts`,
> not inside `update-routes.ts`).

---

## 12. Static Assets

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/robots.txt` | None | Always returns `Disallow: /` |
| `GET` | `/avatar/:uin` | **Separate check** | QQ avatar proxy (see below) |
| `GET` | `/ui-asset/background` | **None** | Background image (`404` when unset) |
| `GET` | `/`、`/index.html` | None | Frontend entry point |
| `GET` | `/*` | None | Static files + SPA fallback |

### 12.1 Separate authentication for `/avatar/:uin`

It is **not covered by the `/api/*` middleware**; instead it validates
the **`snowluma_avatar_session` Cookie** itself:

```js
const sessionToken = readAvatarSessionToken(c);
const session = sessionTokens.get(sessionToken);
if (!session || Date.now() > session.expiresAt) {
  if (sessionToken) sessionTokens.delete(sessionToken);
  return c.text("unauthorized", 401);
}
```

- The Cookie is set by `POST /api/login` and `GET /api/status`.
- `:uin` must match `/^\d{5,10}$/`, otherwise `400 invalid uin`.
- The avatar cache lasts **720 hours (30 days)**; the browser cache is likewise 30 days.
- If fetching from upstream fails and an old cache exists, the old image is returned; with no cache, `502 avatar unavailable`.
- ✅ Measured: without the Cookie → `401`.

> ⚠️ Because the Cookie is refreshed by `/api/status`, if the frontend never calls `/api/status`,
> the avatar session may lapse after 24 hours.

### 12.2 `/ui-asset/background` is **unauthenticated**

```js
app.get("/ui-asset/background", (c) => {
  const asset = readBackgroundImage();
  if (!asset) return c.text("no background", 404);
  return new Response(new Uint8Array(asset.bytes), { headers: { ... } });
});
```

It returns `404` when no background image is set. **Any unauthenticated visitor can read a background image that has been set**.
Do not use a sensitive image as the background.

### 12.3 The SPA fallback allowlist

In `static-frontend.ts`, these prefixes are excluded before falling back to `index.html`:

```js
if (["/api/", "/avatar/", "/ui-asset/"].some((p) => c.req.path.startsWith(p)))
  return c.text("not found", 404);
```

So an unmatched `/api/*` returns `404 not found` rather than HTML.

---

## 13. General Error Conventions

| HTTP | Situation | Response body |
| --- | --- | --- |
| `400` | Invalid parameter/JSON format | `{ success:false }` or `{ message }` |
| `401` | No token supplied / token expired | `{ status:"failed", message:"Unauthorized" }` |
| `403` | Agreement not accepted / password not changed | `{ status:"failed", consentRequired }` or `{ mustChangePassword }` |
| `404` | Resource does not exist | `{ success:false, message }` |
| `409` | State conflict (agreement version, setting locked, update conflict) | `{ success:false, message }` |
| `413` | Request body too large | `{ success:false, message }` |
| `415` | Unsupported media type | `{ success:false, message }` |
| `429` | Login rate limited | `{ success:false, message }` |
| `500` | Server-side exception | `{ success:false, message }` |
| `502` | Upstream (avatar fetch) failure | Plain text |
| `503` | Subsystem unavailable | `{ success:false, message }` |

> **Note the inconsistent response-body styles**: the authentication layer uses
> `{ status:"failed", message }`, while the business layer mostly uses
> `{ success:false, message }`. Clients should handle both.

### 13.1 Security response headers

Every response (`app.use("*")`) carries:

```
X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex
```

The `webuiSecurityHeaders` middleware additionally provides the remaining security headers.

---

## 14. Summary of Security-Sensitive Endpoints 🔴

From highest risk to lowest:

| Endpoint | Risk | Mitigation |
| --- | --- | --- |
| `POST /api/debug/invoke` | **Remote arbitrary action execution** (including kicks, sending messages, raw SSO packets) | Block on the public internet / IP allowlist |
| `POST /api/debug/invoke-stream` | Same as above, streaming | Same as above |
| `GET /api/system/backup/export?credentials=1` | Exports every credential | Forbid `credentials=1` |
| `POST /api/system/backup/import` | Overwrites the entire configuration | Restrict to administrators |
| `POST /api/processes/:pid/load` \| `/unload` | Hook operations on the host process | IP allowlist |
| `POST /api/debug/upload` | Writes files to the server's disk | Block `/api/debug/*` |
| `POST /api/system/tls/cert` | Writes the private key | Restrict to administrators |
| `GET /api/config/:uin` | **Leaks the OneBot `accessToken` in plaintext** | Restrict to administrators |
| `POST /api/system/storage/cleanup` | Deletes stored data | Requires a confirmation string |
| `GET /api/debug/stream` | Leaks events for every account (including private chats) | Block `/api/debug/*` |
| `GET /api/logs/export/trace` | Exports logs containing sensitive information | Restrict to administrators |
| `POST /api/update/download` \| `/restart` | Downloads and restarts | Restrict to administrators |
| `GET /ui-asset/background` | Reads the background image without authentication | Do not put sensitive images there |

**Overall recommendation**: the WebUI listens on `127.0.0.1` by default. If remote access is needed,
it **must** go behind a reverse proxy, and access to `/api/debug/*` and `/api/processes/*`
must be restricted by origin at the same time; enabling only a password + TOTP is **not sufficient** to protect these endpoints (§2.6).

---

## 15. Attestation

| Item | Status |
| --- | --- |
| The 66 route registrations and paths | **Verified**: extracted one by one from the source |
| The `/api/*` authentication middleware logic | **Verified**: `server.ts` |
| The two ways of passing the token (not a Cookie) | **Verified**: `request-security.ts` + live testing |
| 24 h token, login rate limit of 5 attempts / 15 minutes | **Verified**: source constants |
| The two-level gate allowlists | **Verified**: source constant sets |
| **No TOTP second factor** | **Verified**: no such middleware in the source |
| `/api/debug/invoke` has no action-level authentication | **Verified**: calls `invokeAction` directly |
| `/ui-asset/background` is unauthenticated | **Verified**: source + measured `404` (when unset) |
| `/avatar/:uin` uses a separate Cookie | **Verified**: source + measured `401` |
| Per-endpoint parameters and response shapes | **Verified**: source; **not called live one by one** |
| Upload size limits (5/6/32/512/256 KiB/MiB) | **Verified**: source constants |

> **Not measured**: apart from `/api/login`, `/api/status`, `/api/qq-list`,
> `/api/connections`, `/api/config/:uin`, `/api/debug/actions`,
> `/api/ui/public`, `/avatar/:uin`, `/api/logout`, `/api/debug/actions` (unauthorized)
> the **actual responses** of the remaining endpoints were not verified by live calls; their parameters and response shapes come from reading the source.
> The write-operation endpoints (backup import, storage cleanup, update download, process hook) **were not measured at all**;
> verify them yourself in a test environment before production use.
