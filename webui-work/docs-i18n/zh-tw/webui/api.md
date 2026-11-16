# WebUI 後端 API 參考

> [!WARNING]
> 本內容完全由 AI 撰寫，請謹慎閱讀。

> 本文列出 Haizakura（原 SnowLuma）WebUI 後端的**全部 HTTP 端點**、
> 驗證要求與敏感面標註。
>
> **資料來源**：`packages/core/src/webui/server.ts`（主路由，54 條註冊）、
> `storage-routes.ts`（3 條）、`update-routes.ts`（6 條，掛在 `/api/update`）、
> `static-frontend.ts`（靜態前端，4 條）、
> `request-security.ts`（工作階段權杖提取）、`auth.ts` / `totp.ts`（認證）。
>
> 本文的驗證行為均**在運行實例上實測**（2026-11-13）。

---

## 1. 總覽

| 項目 | 數量 |
| --- | --- |
| **`/api/*` 端點總數** | **60** |
| ├ `server.ts` 註冊的 `/api/*` | 51 |
| ├ `storage-routes.ts` | 3（`/api/system/storage*`） |
| └ `update-routes.ts` | 6（掛載於 `/api/update`） |
| 非 `/api` 端點 | 4（`/robots.txt`、`/avatar/:uin`、`/ui-asset/background`、`/`） |
| 靜態前端路由 | 4（`/`、`/index.html`、`/*` 靜態、SPA 回退） |
| **路由註冊總計** | **66** |

> 說明：`server.ts` 共 54 條註冊，其中 51 條為 `/api/*`，
> 另 3 條為 `/robots.txt`、`/avatar/:uin`、`/ui-asset/background`。
> 加上 `storage-routes.ts` 的 3 條與 `update-routes.ts` 的 6 條，
> `/api/*` 合計 **60** 條。

### 1.1 分組導覽

| 分組 | 端點數 | 章節 |
| --- | --- | --- |
| 認證與工作階段 | 10 | [§3](#3-認證與工作階段) |
| 協議與合規 | 2 | [§4](#4-協議與合規) |
| 狀態與連線 | 6 | [§5](#5-狀態與連線) |
| 帳號與 OneBot 設定 | 2 | [§6](#6-帳號與-onebot-設定) |
| 日誌與除錯 | 14 | [§7](#7-日誌與除錯) |
| 系統與設定 | 9 | [§8](#8-系統與設定) |
| 通知 | 4 | [§9](#9-通知) |
| 全域設定與介面 | 7 | [§10](#10-全域設定與介面) |
| 更新 | 6 | [§11](#11-更新) |
| **合計** | **60** | |

---

## 2. 驗證機制

### 2.1 全域中介軟體

原始碼 `server.ts`：

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

**要點**：

- 門禁只作用於 `/api/*`。**`/avatar/:uin` 與 `/ui-asset/background` 不在其中**，
  各自有獨立處理（見 §12）。
- 只有這兩個路徑**免登入**：`/api/login`、`/api/ui/public`。

### 2.2 工作階段權杖的兩種傳遞方式

原始碼 `request-security.ts`：

```js
function extractWebuiSessionToken(request) {
  const sessionToken = request.headers.get("x-snowluma-token");
  if (sessionToken !== null) return sessionToken;
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
}
```

| 方式 | 寫法 | 說明 |
| --- | --- | --- |
| 自訂標頭 | `x-snowluma-token: <token>` | 優先讀取 |
| Bearer | `Authorization: Bearer <token>` | 備選 |

> ⚠️ **權杖不是透過 Cookie 傳遞的**。登入回應設定的 Cookie 名為
> `snowluma_avatar_session`，`Path=/avatar`，**僅用於 `/avatar/:uin`**，
> 不能存取 `/api/*`。呼叫 `/api/*` 必須明確帶上上面兩種標頭之一。
>
> ✅ 實測：帶 `x-snowluma-token` 請求 `/api/status` → `200`；
> 不帶 → `401`。

### 2.3 權杖生命週期

| 項目 | 值 | 來源 |
| --- | --- | --- |
| 權杖格式 | `randomBytes(32).toString("hex")`（64 字元） | `server.ts` |
| 有效期 | `TOKEN_TTL_MS = 1440 * 60 * 1000` = **24 小時** | `server.ts` |
| 清理 | 每 60 秒掃描過期權杖 | `tokenJanitor` |
| 改密 / 改 TOTP | **撤銷其他所有工作階段**（`invalidateOtherSessions`） | `server.ts` |

### 2.4 登入限流

| 項目 | 值 |
| --- | --- |
| 最大嘗試次數 | `LOGIN_MAX_ATTEMPTS = 5` |
| 鎖定時長 | `LOGIN_LOCKOUT_MS = 900 * 1000`（**15 分鐘**） |
| 限流鍵 | 用戶端 IP（`trustProxy` 影響取值） |
| 超限回應 | `429` + `登录尝试过多，请 N 秒后重试` |

### 2.5 兩級附加門禁

**① 同意協議門禁** — `consentGatePending` 為真時，除白名單外一律 `403`：

```
CONSENT_ALLOWLIST = {
  "/api/status", "/api/auth/state", "/api/agreements",
  "/api/agreements/record-consent", "/api/logout"
}
```

**② 強制改密門禁** — 權杖帶 `mustChangePassword` 時，除白名單外一律 `403`：

```
MUST_CHANGE_ALLOWLIST = {
  "/api/status", "/api/auth/state", "/api/auth/check-strength",
  "/api/auth/change-password", "/api/agreements",
  "/api/agreements/record-consent", "/api/logout"
}
```

回應主體帶 `consentRequired: true` 或 `mustChangePassword: true`，
前端據此跳轉對應流程。

> ✅ 這兩個門禁是**實測會遇到**的：未改初始密碼時，多數 API 回傳
> `403 mustChangePassword`。

### 2.6 TOTP 的實際作用範圍 ⚠️

**TOTP 只在登入時驗證，不是敏感端點的第二道驗證。**

- 登入請求可帶 `totp` 或 `recoveryCode`；
  若已啟用 TOTP 而未提供，回傳 `{ success: false, needsTotp: true }`。
- **登入成功後，工作階段權杖即可存取全部端點**，包括
  `/api/debug/invoke` 這類高風險端點，**不再要求 TOTP**。
- 因此 **TOTP 無法限制已登入工作階段的破壞半徑**。

> 🔴 **安全建議**：若 WebUI 暴露在不可信任的網路，僅靠 TOTP 不足以保護
> 敏感端點。真正的防線應該是**網路層隔離**（反向代理 + IP 白名單 + TLS），
> 而不是依賴應用層的 TOTP。
>
> 原始碼中 `totpDisabledInDev()` 在 dev 模式下會停用 TOTP 相關端點。

---

## 3. 認證與工作階段

| 方法 | 路徑 | 驗證 | 參數 | 回傳 |
| --- | --- | --- | --- | --- |
| `POST` | `/api/login` | **免登入** | `{ password, totp?, recoveryCode? }` | `{ success, token, mustChangePassword }` |
| `POST` | `/api/logout` | 需登入 | — | `{ success: true }` |
| `GET` | `/api/auth/state` | 需登入 | — | `{ mustChangePassword }` |
| `POST` | `/api/auth/check-strength` | 需登入 | `{ password }` | 強度評估結果 |
| `POST` | `/api/auth/change-password` | 需登入 | `{ ... }` | 改密結果；**撤銷其他工作階段** |
| `GET` | `/api/auth/totp` | 需登入 | — | TOTP 狀態 |
| `POST` | `/api/auth/totp/begin` | 需登入 | `{ issuer?, accountName? }` | 註冊憑據（含 secret / otpauth URL） |
| `POST` | `/api/auth/totp/confirm` | 需登入 | `{ token/验证码 }` | 確認啟用；**撤銷其他工作階段** |
| `POST` | `/api/auth/totp/disable` | 需登入 | — | 關閉 TOTP |
| `POST` | `/api/auth/totp/recovery-codes` | 需登入 | — | 重新產生恢復碼 |

> 本節共 **10** 個端點。`POST /api/agreements/record-consent`
> 歸在 [§4 協議與合規](#4-協議與合規)。

### 3.1 登入回應

**成功**：

```json
{ "success": true, "token": "<64位hex>", "mustChangePassword": false }
```

同時設定 Cookie（**僅供 `/avatar`**）：

```
Set-Cookie: snowluma_avatar_session=<token>; Max-Age=86400;
            Path=/avatar; HttpOnly; SameSite=Strict
```

**需要 TOTP**：

```json
{ "success": false, "needsTotp": true }
```

**失敗**（`401`）：`{ "success": false, "message": "密码错误" }`
或 `{ "success": false, "message": "验证码不正确" }`。

**限流**（`429`）：`{ "success": false, "message": "登录尝试过多，请 N 秒后重试" }`

### 3.2 `record-consent` 的版本檢查

若 `version` 與目前協議版本不符，回傳 `409`：

```json
{ "success": false, "message": "协议版本已更新，请刷新后重新确认",
  "currentVersion": "<当前版本>" }
```

### 3.3 TOTP 註冊流程

1. `POST /api/auth/totp/begin` → 取得 secret / otpauth URL
   （註冊憑據快取 **`TOTP_ENROLL_TTL_MS = 600000` ms = 10 分鐘**）
2. 在驗證器中加入並取得 6 位碼
3. `POST /api/auth/totp/confirm` 提交驗證碼完成啟用

TOTP issuer 預設 **`Haizakura`**（`DEFAULT_TOTP_ISSUER`）。

---

## 4. 協議與合規

| 方法 | 路徑 | 驗證 | 回傳 |
| --- | --- | --- | --- |
| `GET` | `/api/agreements` | 需登入（**在兩級白名單內**） | 協議文字與版本 |
| `POST` | `/api/agreements/record-consent` | 需登入（**在兩級白名單內**） | 見 §3.2 |

> 這兩個端點在 `CONSENT_ALLOWLIST` 與 `MUST_CHANGE_ALLOWLIST` 中，
> 因此未同意協議 / 未改密時**仍可存取** —— 否則會死鎖。

---

## 5. 狀態與連線

| 方法 | 路徑 | 參數 | 回傳 |
| --- | --- | --- | --- |
| `GET` | `/api/status` | — | `{ status: "running" }` |
| `GET` | `/api/connections` | — | `{ list: [...] }` 各帳號配接器狀態 |
| `GET` | `/api/qq-list` | — | `{ list: [{ uin, nickname }] }` |
| `GET` | `/api/state/stream` | — | **SSE**，狀態變更推送 |
| `GET` | `/api/system` | — | 主機與執行環境資訊 |
| `GET` | `/api/update/check` | `force` | 更新檢查結果 |

**`/api/status` 的副作用**：它會**順帶刷新 `/avatar` 的工作階段 Cookie**
（原始碼 `setAvatarSessionCookie(c, c.get("sessionToken"), ...)`）。
前端週期性呼叫即可維持頭像可用。

**`/api/connections` 實測回傳**：

```json
{ "list": [ { "uin": "<uin>", "nickname": "HaizakuraBot",
  "adapters": [
    { "name": "http-default", "kind": "httpServer", "status": "ok", "detail": "监听中" },
    { "name": "ws-default", "kind": "wsServer", "status": "ok", "detail": "1 个客户端" }
  ],
  "databaseMigration": { "phase": "complete", "usable": true, "progress": 1 } } ] }
```

**`/api/state/stream`**：`stateBus` 未設定時回傳 `503`
`state stream not configured`。幀以 `{ kind: "ready" }` 開頭，
隨後推送 `processes` / `qq-list` / 連線狀態變更（**50 ms 去抖**）。

**`/api/system`** 回傳 `hostname`、`platform`、`arch`、`release`、`distro`、
`uptime`、`processUptime`、`nodeVersion`、`cpu{ model, cores, loadAvg, perCore, average }`、
`memory{ total, free, used, usagePercent }`、
`runtime{ pid, lowIntegrity, rss, heapTotal, heapUsed, external, arrayBuffers }`。

---

## 6. 帳號與 OneBot 設定

| 方法 | 路徑 | 參數 | 回傳 |
| --- | --- | --- | --- |
| `GET` | `/api/config/:uin` | — | `{ config }` 完整 OneBot 設定 |
| `POST` | `/api/config/:uin` | OneBot 設定物件 | `{ success, saved, applied, ... }` |

**檢查**：

- `:uin` 必須符合 `UIN_REGEX = /^\d{5,10}$/`，否則 `400 invalid uin`。
- 請求主體經 `assertValidOneBotConfig` 嚴格檢查；非法設定直接 `400`，
  **不會**落盤。
- 儲存後原子套用；失敗會**回滾到上一份設定**。

> 🔴 **敏感**：`GET /api/config/:uin` 的回傳**包含 `accessToken` 明文**。
> 實測回應中可直接看到 `http-default` 與 `ws-default` 的 token。
> 任何能存取 WebUI 的人都能取得 OneBot 接入憑據。

---

## 7. 日誌與除錯

本節共 **14** 個端點。

| 方法 | 路徑 | 參數 | 回傳 |
| --- | --- | --- | --- |
| `GET` | `/api/logs` | `limit`（預設 300） | `{ list: [...] }` |
| `GET` | `/api/logs/export/trace` | — | 完整鏈路追蹤檔案（附件下載） |
| `GET` | `/api/logs/level` | — | `{ level, levels }` |
| `POST` | `/api/logs/level` | `{ level }` | `{ level, levels }` |
| `GET` | `/api/logs/stream` | — | **SSE**，即時日誌 |
| `GET` | `/api/debug/actions` | — | `{ actions: [...], categories: [...] }` |
| `POST` | `/api/debug/invoke` | `{ uin, action, params }` | 動作執行結果 |
| `POST` | `/api/debug/invoke-stream` | `{ uin, action, params }` | **SSE**，串流動作結果 |
| `POST` | `/api/debug/upload` | `filename`（query）+ 原始 body | `{ status, path, size }` |
| `GET` | `/api/debug/stream` | — | **SSE**，全部帳號的事件串流 |
| `GET` | `/api/processes` | — | `{ list: [...] }` |
| `POST` | `/api/processes/:pid/load` \| `/unload` \| `/refresh` | — | `{ success, process }` |

### 7.1 🔴 `POST /api/debug/invoke` — 遠端任意動作執行（最嚴重）

```json
{ "uin": "<uin>", "action": "send_group_msg",
  "params": { "group_id": 20001, "message": "hi" } }
```

它把請求**直接轉發給指定帳號的動作分派器**（原始碼
`oneBotManager.getInstance(uin).invokeAction(action, params)`），
**不做任何動作級白名單或權限檢查**。

後果：**任何能登入 WebUI 的人 = 能以機器人身分執行全部 222 個動作**，
包括但不限於：

| 動作 | 影響 |
| --- | --- |
| `send_group_msg` / `send_private_msg` | 以機器人身分向任意群組/好友發訊息 |
| `set_group_kick` / `set_group_ban` | 踢人、禁言 |
| `set_group_leave` | 退出群組 |
| `bot_exit` | **退出機器人行程** |
| `set_restart` | 重啟（本實作回傳不支援） |
| `send_packet` | 傳送**原始 SSO 包** |
| `upload_group_file` | 上傳任意檔案到群組 |
| `set_qq_profile` / `set_qq_avatar` | 修改帳號資料 |

**加固建議（依優先級）**：

1. **不要將 WebUI 暴露到公網**。預設綁定 `127.0.0.1`，如需遠端存取
   請置於反向代理後並限制來源 IP。
2. 在反向代理層對 `/api/debug/*` 做**路徑級封鎖或 IP 白名單**。
3. 若必須開放，啟用 **TLS** 並使用強密碼 + TOTP。
   （注意：TOTP 只在登入時驗證，見 §2.6。）
4. 稽核：每次呼叫都會走
   `traceAuthenticatedWebuiMutation`，可在日誌中追蹤。
5. 長期方案：為該端點增加獨立的二次確認或開關。

**檢查行為**：

| 情況 | 回應 |
| --- | --- |
| body 非法 JSON | `400` `请求格式错误` |
| `uin` 不符合 `/^\d{5,10}$/` | `400` `无效的账号` |
| `action` 缺失/非字串 | `400` `action 必填` |
| `params` 非物件（陣列/null） | `400` `params 必须是对象` |
| 帳號不在線上 | `404` `账号不在线` |

### 7.2 其餘敏感除錯端點

| 端點 | 風險 |
| --- | --- |
| `POST /api/debug/invoke-stream` | 同 `/api/debug/invoke`，支援串流動作 |
| `POST /api/debug/upload` | **向服務端磁碟寫入檔案**（路徑由服務端決定，不可任意指定） |
| `GET /api/debug/stream` | 洩漏**全部帳號**的即時事件（含私聊內容） |
| `GET /api/logs/export/trace` | 匯出含敏感資訊的完整追蹤 |
| `POST /api/processes/:pid/load` \| `/unload` \| `/refresh` | 對宿主 QQ 行程執行 **hook 裝載/卸載**；`:pid` 需為 `1..4194304` 的整數 |

---

## 8. 系統與設定

本節共 **9** 個端點（`/api/system` 歸在 [§5](#5-狀態與連線)，
`/api/update/*` 歸在 [§11](#11-更新)）。

| 方法 | 路徑 | 參數 | 回傳 |
| --- | --- | --- | --- |
| `GET` | `/api/system/settings` | — | `{ settings, hasCert, envOverrides, listeningPort, restartRequiredToApply }` |
| `POST` | `/api/system/settings` | `{ webuiPort?, webuiHost?, tlsEnabled?, trustProxy? }` | `{ success, settings, restartRequiredToApply }` |
| `POST` | `/api/system/tls/cert` | `{ cert, key }`（PEM 字串） | `{ success, restartRequiredToApply }` |
| `DELETE` | `/api/system/tls/cert` | — | `{ success }` |
| `GET` | `/api/system/backup/export` | `credentials=1` | 備份 JSON（附件） |
| `POST` | `/api/system/backup/import` | 備份 JSON | 還原結果 |
| `GET` | `/api/system/storage` | — | `{ settings, snapshot, lastCleanup }` |
| `POST` | `/api/system/storage/settings` | 儲存設定 | `{ success, ... }` |
| `POST` | `/api/system/storage/cleanup` | 清理請求 | 清理結果 |

### 8.1 敏感端點說明

| 端點 | 風險 |
| --- | --- |
| `GET /api/system/backup/export?credentials=1` | 🔴 **匯出包含憑據的完整備份**（帳號 token、TOTP secret 等） |
| `POST /api/system/backup/import` | 🔴 **覆寫服務端設定**；上限 **32 MiB**（`413`），失敗會交易回滾 |
| `POST /api/system/tls/cert` | 🔴 **將 TLS 私鑰寫入磁碟**（`config/key.pem`，權限 `0600`） |
| `DELETE /api/system/tls/cert` | 刪除憑證；TLS 啟用時被拒（`400 请先关闭 TLS 再删除证书`） |
| `POST /api/system/storage/cleanup` | 🔴 **刪除儲存檔案**；請求需帶確認串（全部帳號時為 `清理全部账号`） |
| `POST /api/update/download` \| `/restart` | 下載並**重啟服務** |
| `POST /api/system/settings` | 改監聽位址/連接埠、TLS、`trustProxy`；**需重啟生效** |

> ⚠️ `POST /api/system/settings` 中的 `trustProxy` 影響登入限流的 IP 判定。
> 原始碼明確警告：`SNOWLUMA_WEBUI_TRUST_PROXY=1` 僅在**反向代理會剝離**
> 用戶端自設的 `X-Real-IP` / `X-Forwarded-For` 時才安全，
> 否則攻擊者可偽造 IP 繞過登入限流。

### 8.2 儲存設定與備份的邊界

- `POST /api/system/storage/settings`：
  被環境變數鎖定的欄位回傳 `409` + `lockedFields`。
- 備份匯入宣告長度超過 **32 MiB** 直接 `413`。
- TLS 憑證必須是**合法的 PEM 配對**，否則 `400`。

---

## 9. 通知

| 方法 | 路徑 | 參數 | 回傳 |
| --- | --- | --- | --- |
| `GET` | `/api/notifications/config` | — | `{ config }` |
| `POST` | `/api/notifications/config` | 通知設定 | `{ success, config }` |
| `GET` | `/api/notifications/recent` | `limit`（預設 100，上限 100） | `{ recent }` |
| `POST` | `/api/notifications/test` | `{ channelId }` | `{ success, status, message }` |

- 設定主體上限 **512 KiB**（`413`）。
- `test` 缺少 `channelId` → `400`；通道不存在 → `404`。
- 通知子系統不可用 → `503`。

---

## 10. 全域設定與介面

本節共 **7** 個端點。

| 方法 | 路徑 | 驗證 | 參數 | 回傳 |
| --- | --- | --- | --- | --- |
| `GET` | `/api/global-config` | 需登入 | — | `{ config }` |
| `POST` | `/api/global-config` | 需登入 | 全域設定 | 儲存結果（上限 512 KiB） |
| `GET` | `/api/ui` | 需登入 | — | `{ config }` |
| `GET` | `/api/ui/public` | **免登入** | — | `{ appearance }` |
| `POST` | `/api/ui` | 需登入 | UI 設定 | `{ success, config }`（上限 256 KiB） |
| `POST` | `/api/ui/background` | 需登入 | multipart `file` | `{ success, config }` |
| `DELETE` | `/api/ui/background` | 需登入 | — | `{ success, config }` |

**`/api/ui/public` 免登入**的設計意圖：登入頁需要套用主題（外觀）後才能呈現。
它只暴露外觀相關欄位（`publicAppearance()`），**不含敏感設定**。

**背景圖上傳**：

- 上限 **5 MiB**（`5242880`）；`content-length` 超過 **6 MiB** 時提前 `413`。
- 僅接受 **PNG / JPEG / WebP**（依內容嗅探 `sniffImageMime`）；
  其他類型 `415 仅支持 PNG / JPEG / WebP 图片`。
- 缺少檔案 → `400 缺少图片文件`。

---

## 11. 更新

掛載點 `/api/update`（原始碼 `app.route("/api/update", updateRoutes(...))`）。

| 方法 | 完整路徑 | 參數 | 回傳 |
| --- | --- | --- | --- |
| `GET` | `/api/update/status` | — | 更新服務狀態 |
| `GET` | `/api/update/sources` | — | `{ config }` |
| `POST` | `/api/update/sources` | 來源設定 | `{ config, saved, applied, online, errors, message }` |
| `POST` | `/api/update/sources/test` | 來源候選 | `{ results }` |
| `POST` | `/api/update/download` | `{ version }` | `202` 狀態；缺 `version` → `400`；衝突 → `409` |
| `POST` | `/api/update/restart` | — | `202` 狀態；衝突 → `409` |

> 另有 `GET /api/update/check?force=true`（註冊在 `server.ts`，
> 不在 `update-routes.ts` 內）。

---

## 12. 靜態資源

| 方法 | 路徑 | 驗證 | 說明 |
| --- | --- | --- | --- |
| `GET` | `/robots.txt` | 無 | 恆回傳 `Disallow: /` |
| `GET` | `/avatar/:uin` | **獨立驗證** | QQ 頭像代理（見下） |
| `GET` | `/ui-asset/background` | **無** | 背景圖（未設定時 `404`） |
| `GET` | `/`、`/index.html` | 無 | 前端入口 |
| `GET` | `/*` | 無 | 靜態檔案 + SPA 回退 |

### 12.1 `/avatar/:uin` 的獨立驗證

它**不在 `/api/*` 中介軟體涵蓋範圍內**，而是自行驗證
**`snowluma_avatar_session` Cookie**：

```js
const sessionToken = readAvatarSessionToken(c);
const session = sessionTokens.get(sessionToken);
if (!session || Date.now() > session.expiresAt) {
  if (sessionToken) sessionTokens.delete(sessionToken);
  return c.text("unauthorized", 401);
}
```

- Cookie 由 `POST /api/login` 與 `GET /api/status` 設定。
- `:uin` 必須符合 `/^\d{5,10}$/`，否則 `400 invalid uin`。
- 頭像快取 **720 小時（30 天）**；瀏覽器快取同為 30 天。
- 上游取圖失敗且有舊快取時回傳舊圖；無快取則 `502 avatar unavailable`。
- ✅ 實測：不帶 Cookie → `401`。

> ⚠️ 由 `/api/status` 刷新 Cookie，前端若不呼叫 `/api/status`，
> 頭像工作階段可能在 24 小時後失效。

### 12.2 `/ui-asset/background` **無驗證**

```js
app.get("/ui-asset/background", (c) => {
  const asset = readBackgroundImage();
  if (!asset) return c.text("no background", 404);
  return new Response(new Uint8Array(asset.bytes), { headers: { ... } });
});
```

未設定背景圖時回傳 `404`。**任何未認證的訪客都能讀取已設定的背景圖**。
請勿把敏感圖片用作背景。

### 12.3 SPA 回退的白名單

`static-frontend.ts` 中，回退到 `index.html` 前會排除這些前綴：

```js
if (["/api/", "/avatar/", "/ui-asset/"].some((p) => c.req.path.startsWith(p)))
  return c.text("not found", 404);
```

即未匹配的 `/api/*` 回傳 `404 not found`，不會回傳 HTML。

---

## 13. 通用錯誤約定

| HTTP | 情境 | 回應主體 |
| --- | --- | --- |
| `400` | 參數/JSON 格式錯誤 | `{ success:false }` 或 `{ message }` |
| `401` | 未帶權杖 / 權杖失效 | `{ status:"failed", message:"Unauthorized" }` |
| `403` | 未同意協議 / 未改密 | `{ status:"failed", consentRequired }` 或 `{ mustChangePassword }` |
| `404` | 資源不存在 | `{ success:false, message }` |
| `409` | 狀態衝突（協議版本、設定被鎖定、更新衝突） | `{ success:false, message }` |
| `413` | 請求主體過大 | `{ success:false, message }` |
| `415` | 不支援的媒體類型 | `{ success:false, message }` |
| `429` | 登入限流 | `{ success:false, message }` |
| `500` | 服務端異常 | `{ success:false, message }` |
| `502` | 上游（取頭像）失敗 | 純文字 |
| `503` | 子系統不可用 | `{ success:false, message }` |

> **注意回應主體風格不一致**：認證層用
> `{ status:"failed", message }`，業務層多用
> `{ success:false, message }`。用戶端應同時相容兩種。

### 13.1 安全回應標頭

所有回應（`app.use("*")`）附加：

```
X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex
```

另有 `webuiSecurityHeaders` 中介軟體提供其餘安全標頭。

---

## 14. 安全敏感端點彙總 🔴

按風險從高到低：

| 端點 | 風險 | 緩解 |
| --- | --- | --- |
| `POST /api/debug/invoke` | **遠端任意動作執行**（含踢人、發訊息、原始 SSO 包） | 公網封鎖 / IP 白名單 |
| `POST /api/debug/invoke-stream` | 同上，串流 | 同上 |
| `GET /api/system/backup/export?credentials=1` | 匯出全部憑據 | 禁止帶 `credentials=1` |
| `POST /api/system/backup/import` | 覆寫全部設定 | 限制管理員 |
| `POST /api/processes/:pid/load` \| `/unload` | 宿主行程 hook 操作 | IP 白名單 |
| `POST /api/debug/upload` | 寫檔案到服務端磁碟 | 封鎖 `/api/debug/*` |
| `POST /api/system/tls/cert` | 寫入私鑰 | 限管理員 |
| `GET /api/config/:uin` | **洩漏 OneBot `accessToken` 明文** | 限管理員 |
| `POST /api/system/storage/cleanup` | 刪除儲存資料 | 需確認串 |
| `GET /api/debug/stream` | 洩漏全部帳號事件（含私聊） | 封鎖 `/api/debug/*` |
| `GET /api/logs/export/trace` | 匯出含敏感資訊的日誌 | 限管理員 |
| `POST /api/update/download` \| `/restart` | 下載並重啟 | 限管理員 |
| `GET /ui-asset/background` | 無驗證讀取背景圖 | 勿放敏感圖 |

**整體建議**：WebUI 預設監聽 `127.0.0.1`。如需遠端存取，
**必須**置於反向代理之後，並同時對 `/api/debug/*`、`/api/processes/*`
做來源限制；僅啟用密碼 + TOTP **不足以**保護這些端點（§2.6）。

---

## 15. 聲明

| 項目 | 狀態 |
| --- | --- |
| 66 條路由註冊與路徑 | **已核實**：原始碼逐條提取 |
| `/api/*` 驗證中介軟體邏輯 | **已核實**：`server.ts` |
| 權杖的兩種傳遞方式（非 Cookie） | **已核實**：`request-security.ts` + 實機驗證 |
| 權杖 24h、登入限流 5 次 / 15 分鐘 | **已核實**：原始碼常數 |
| 兩級門禁白名單 | **已核實**：原始碼常數集合 |
| **無 TOTP 二次驗證** | **已核實**：原始碼中無相關中介軟體 |
| `/api/debug/invoke` 無動作級驗證 | **已核實**：直接呼叫 `invokeAction` |
| `/ui-asset/background` 無驗證 | **已核實**：原始碼 + 實測 `404`（未設定時） |
| `/avatar/:uin` 用獨立 Cookie | **已核實**：原始碼 + 實測 `401` |
| 各端點參數與回傳形狀 | **已核實**：原始碼；**未逐一實機呼叫** |
| 上傳體積上限（5/6/32/512/256 KiB/MiB） | **已核實**：原始碼常數 |

> **未實測項**：除 `/api/login`、`/api/status`、`/api/qq-list`、
> `/api/connections`、`/api/config/:uin`、`/api/debug/actions`、
> `/api/ui/public`、`/avatar/:uin`、`/api/logout`、`/api/debug/actions`(未授權)
> 之外，其餘端點的**實際回應**未經真機呼叫驗證，參數與回傳形狀來自原始碼閱讀。
> 寫入操作端點（備份匯入、儲存清理、更新下載、行程 hook）**均未實測**，
> 請在生產使用前自行在測試環境驗證。
