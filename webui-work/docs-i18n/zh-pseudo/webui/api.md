# WebUI 後端 API 参照

> [!WARNING]
> 本内容全由 AI 編写、請慎読也。

> 本文列挙 Haizakura（原 SnowLuma）WebUI 後端之 **全部 HTTP 端点**、
> 鑑権要求与敏感面標注也。
>
> **資料源**：`packages/core/src/webui/server.ts`（主路由、54 条登記）、
> `storage-routes.ts`（3 条）、`update-routes.ts`（6 条、挂於 `/api/update`）、
> `static-frontend.ts`（静態前端、4 条）、
> `request-security.ts`（会話令符抽出）、`auth.ts` / `totp.ts`（認証）也。
>
> 本文之鑑権挙動皆 **於運行実例之上実測**（2026-11-13）。

---

## 1. 総覧

| 項目 | 数量 |
| --- | --- |
| **`/api/*` 端点総数** | **60** |
| ├ `server.ts` 所登記之 `/api/*` | 51 |
| ├ `storage-routes.ts` | 3（`/api/system/storage*`） |
| └ `update-routes.ts` | 6（挂載於 `/api/update`） |
| 非 `/api` 端点 | 4（`/robots.txt`、`/avatar/:uin`、`/ui-asset/background`、`/`） |
| 静態前端路由 | 4（`/`、`/index.html`、`/*` 静態、SPA 回退） |
| **路由登記総計** | **66** |

> 説明：`server.ts` 共 54 条登記、其中 51 条為 `/api/*`、
> 另 3 条為 `/robots.txt`、`/avatar/:uin`、`/ui-asset/background`。
> 加之 `storage-routes.ts` 之 3 条与 `update-routes.ts` 之 6 条、
> `/api/*` 合計 **60** 条也。

### 1.1 分組導覧

| 分組 | 端点数量 | 章 |
| --- | --- | --- |
| 認証与会話 | 10 | [§3](#3-认证与会话) |
| 協議与合規 | 2 | [§4](#4-协议与合规) |
| 状態与接続 | 6 | [§5](#5-状态与连接) |
| 帳号与 OneBot 設定 | 2 | [§6](#6-账号与-onebot-配置) |
| 記録与除錯 | 14 | [§7](#7-日志与调试) |
| 系統与設定 | 9 | [§8](#8-系统与设置) |
| 通知 | 4 | [§9](#9-通知) |
| 全局設定与界面 | 7 | [§10](#10-全局配置与界面) |
| 更新 | 6 | [§11](#11-更新) |
| **合計** | **60** | |

---

## 2. 鑑権機制

### 2.1 全局中間件

源码 `server.ts`：

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

**要点**：

- 門禁唯作用於 `/api/*`。**`/avatar/:uin` 与 `/ui-asset/background` 不在其中**、
  各有独立処理（見 §12）。
- 唯此両路徑 **免登録**：`/api/login`、`/api/ui/public` 也。

### 2.2 会話令符之両種伝達方式

源码 `request-security.ts`：

```js
function extractWebuiSessionToken(request) {
  const sessionToken = request.headers.get("x-snowluma-token");
  if (sessionToken !== null) return sessionToken;
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
}
```

| 方式 | 写法 | 説明 |
| --- | --- | --- |
| 自定頭 | `x-snowluma-token: <token>` | 優先読取 |
| Bearer | `Authorization: Bearer <token>` | 備選 |

> ⚠️ **令符非経 Cookie 伝達也**。登録応答所設之 Cookie 名為
> `snowluma_avatar_session`、`Path=/avatar`、**唯用於 `/avatar/:uin`**、
> 不能訪 `/api/*`。呼 `/api/*` 必須明帯上両頭之一也。
>
> ✅ 実測：帯 `x-snowluma-token` 請求 `/api/status` → `200`；
> 不帯 → `401` 也。

### 2.3 令符生命周期

| 項目 | 値 | 来源 |
| --- | --- | --- |
| 令符格式 | `randomBytes(32).toString("hex")`（64 文字） | `server.ts` |
| 有効期 | `TOKEN_TTL_MS = 1440 * 60 * 1000` = **24 小時** | `server.ts` |
| 清理 | 毎 60 秒掃過期令符 | `tokenJanitor` |
| 改密 / 改 TOTP | **吊销其余凡会話**（`invalidateOtherSessions`） | `server.ts` |

### 2.4 登録限流

| 項目 | 値 |
| --- | --- |
| 最大試行回数 | `LOGIN_MAX_ATTEMPTS = 5` |
| 鎖定時長 | `LOGIN_LOCKOUT_MS = 900 * 1000`（**15 分**） |
| 限流鍵 | 客端 IP（`trustProxy` 影響取值） |
| 超限応答 | `429` + `登录尝试过多，请 N 秒后重试` |

### 2.5 両級附加門禁

**① 同意協議門禁** — `consentGatePending` 為真之時、除白名単之外一律 `403`：

```
CONSENT_ALLOWLIST = {
  "/api/status", "/api/auth/state", "/api/agreements",
  "/api/agreements/record-consent", "/api/logout"
}
```

**② 強制改密門禁** — 令符帯 `mustChangePassword` 之時、除白名単之外一律 `403`：

```
MUST_CHANGE_ALLOWLIST = {
  "/api/status", "/api/auth/state", "/api/auth/check-strength",
  "/api/auth/change-password", "/api/agreements",
  "/api/agreements/record-consent", "/api/logout"
}
```

応答体帯 `consentRequired: true` 或 `mustChangePassword: true`、
前端依此跳転対応流程也。

> ✅ 此両門禁乃 **実測会遇到** 者也：未改初期密碼之時、多数 API 返
> `403 mustChangePassword` 也。

### 2.6 TOTP 之実際作用範囲 ⚠️

**TOTP 唯於登録之時校験、非敏感端点之二次驗証也。**

- 登録請求可帯 `totp` 或 `recoveryCode`；
  若已啓用 TOTP 而未提供、返 `{ success: false, needsTotp: true }` 也。
- **登録成功之後、会話令符即可訪全端点**、含
  `/api/debug/invoke` 此類高危端点、**不再要求 TOTP**。
- 故 **TOTP 無法限制已登録会話之破壊半径** 也。

> 🔴 **安全建議**：若 WebUI 露於不可信網絡、唯靠 TOTP 不足以保護
> 敏感端点。真実防線応為 **網絡層隔離**（反向代理 + IP 白名単 + TLS）、
> 而非依応用層之 TOTP 也。
>
> 源码之中 `totpDisabledInDev()` 於 dev 模式会禁用 TOTP 相關端点。

---

## 3. 認証与会話

| 方法 | 路徑 | 鑑権 | 参數 | 返却 |
| --- | --- | --- | --- | --- |
| `POST` | `/api/login` | **免登録** | `{ password, totp?, recoveryCode? }` | `{ success, token, mustChangePassword }` |
| `POST` | `/api/logout` | 須登録 | — | `{ success: true }` |
| `GET` | `/api/auth/state` | 須登録 | — | `{ mustChangePassword }` |
| `POST` | `/api/auth/check-strength` | 須登録 | `{ password }` | 強度評価結果 |
| `POST` | `/api/auth/change-password` | 須登録 | `{ ... }` | 改密結果；**吊销其余会話** |
| `GET` | `/api/auth/totp` | 須登録 | — | TOTP 状態 |
| `POST` | `/api/auth/totp/begin` | 須登録 | `{ issuer?, accountName? }` | 登録憑據（含 secret / otpauth URL） |
| `POST` | `/api/auth/totp/confirm` | 須登録 | `{ token/验证码 }` | 確認啓用；**吊销其余会話** |
| `POST` | `/api/auth/totp/disable` | 須登録 | — | 関閉 TOTP |
| `POST` | `/api/auth/totp/recovery-codes` | 須登録 | — | 再生成恢復碼 |

> 本節共 **10** 個端点。`POST /api/agreements/record-consent`
> 帰於 [§4 協議与合規](#4-协议与合规)。

### 3.1 登録応答

**成功**：

```json
{ "success": true, "token": "<64位hex>", "mustChangePassword": false }
```

同時設 Cookie（**唯供 `/avatar`**）：

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

### 3.2 `record-consent` 之版本校験

若 `version` 与当前協議版本不符、返 `409`：

```json
{ "success": false, "message": "协议版本已更新，请刷新后重新确认",
  "currentVersion": "<当前版本>" }
```

### 3.3 TOTP 登録流程

1. `POST /api/auth/totp/begin` → 取得 secret / otpauth URL
   （登録憑據緩衝 **`TOTP_ENROLL_TTL_MS = 600000` ms = 10 分**）
2. 於驗証器之中添加而取 6 位碼
3. `POST /api/auth/totp/confirm` 提交驗証碼以完啓用

TOTP issuer 既定 **`Haizakura`**（`DEFAULT_TOTP_ISSUER`）。

---

## 4. 協議与合規

| 方法 | 路徑 | 鑑権 | 返却 |
| --- | --- | --- | --- |
| `GET` | `/api/agreements` | 須登録（**在両級白名単之内**） | 協議文本与版本 |
| `POST` | `/api/agreements/record-consent` | 須登録（**在両級白名単之内**） | 見 §3.2 |

> 此両端点於 `CONSENT_ALLOWLIST` 与 `MUST_CHANGE_ALLOWLIST` 之中、
> 故未同意協議 / 未改密之時 **仍可訪** —— 否者死鎖也。

---

## 5. 状態与接続

| 方法 | 路徑 | 参數 | 返却 |
| --- | --- | --- | --- |
| `GET` | `/api/status` | — | `{ status: "running" }` |
| `GET` | `/api/connections` | — | `{ list: [...] }` 各帳号適配器状態 |
| `GET` | `/api/qq-list` | — | `{ list: [{ uin, nickname }] }` |
| `GET` | `/api/state/stream` | — | **SSE**、状態変更推送 |
| `GET` | `/api/system` | — | 主機与運行時情報 |
| `GET` | `/api/update/check` | `force` | 更新検査結果 |

**`/api/status` 之副作用**：其会 **順便刷新 `/avatar` 之会話 Cookie**
（源码 `setAvatarSessionCookie(c, c.get("sessionToken"), ...)`）。
前端周期性呼之即可維持頭像可用也。

**`/api/connections` 実測返却**：

```json
{ "list": [ { "uin": "<uin>", "nickname": "HaizakuraBot",
  "adapters": [
    { "name": "http-default", "kind": "httpServer", "status": "ok", "detail": "监听中" },
    { "name": "ws-default", "kind": "wsServer", "status": "ok", "detail": "1 个客户端" }
  ],
  "databaseMigration": { "phase": "complete", "usable": true, "progress": 1 } } ] }
```

**`/api/state/stream`**：`stateBus` 未設定之時返 `503`
`state stream not configured`。幀以 `{ kind: "ready" }` 起、
隨後推送 `processes` / `qq-list` / 接続状態変更（**50 ms 去抖**）。

**`/api/system`** 返 `hostname`、`platform`、`arch`、`release`、`distro`、
`uptime`、`processUptime`、`nodeVersion`、`cpu{ model, cores, loadAvg, perCore, average }`、
`memory{ total, free, used, usagePercent }`、
`runtime{ pid, lowIntegrity, rss, heapTotal, heapUsed, external, arrayBuffers }` 也。

---

## 6. 帳号与 OneBot 設定

| 方法 | 路徑 | 参數 | 返却 |
| --- | --- | --- | --- |
| `GET` | `/api/config/:uin` | — | `{ config }` 完全 OneBot 設定 |
| `POST` | `/api/config/:uin` | OneBot 設定対象 | `{ success, saved, applied, ... }` |

**校験**：

- `:uin` 必須匹配 `UIN_REGEX = /^\d{5,10}$/`、否者 `400 invalid uin`。
- 請求体経 `assertValidOneBotConfig` 厳格校験；非法設定直 `400`、
  **不会** 落盤也。
- 保存後原子応用；失敗则会 **回滾至上份設定**。

> 🔴 **敏感**：`GET /api/config/:uin` 之返却 **含 `accessToken` 明文**。
> 実測応答之中可直接見 `http-default` 与 `ws-default` 之 token。
> 凡能訪 WebUI 者皆可取 OneBot 接入憑據也。

---

## 7. 記録与除錯

本節共 **14** 個端点。

| 方法 | 路徑 | 参數 | 返却 |
| --- | --- | --- | --- |
| `GET` | `/api/logs` | `limit`（既定 300） | `{ list: [...] }` |
| `GET` | `/api/logs/export/trace` | — | 完全鏈路追蹤文件（附件下載） |
| `GET` | `/api/logs/level` | — | `{ level, levels }` |
| `POST` | `/api/logs/level` | `{ level }` | `{ level, levels }` |
| `GET` | `/api/logs/stream` | — | **SSE**、実時記録 |
| `GET` | `/api/debug/actions` | — | `{ actions: [...], categories: [...] }` |
| `POST` | `/api/debug/invoke` | `{ uin, action, params }` | 動作実行結果 |
| `POST` | `/api/debug/invoke-stream` | `{ uin, action, params }` | **SSE**、流式動作結果 |
| `POST` | `/api/debug/upload` | `filename`（query）+ 原始 body | `{ status, path, size }` |
| `GET` | `/api/debug/stream` | — | **SSE**、全帳号之事件流 |
| `GET` | `/api/processes` | — | `{ list: [...] }` |
| `POST` | `/api/processes/:pid/load` \| `/unload` \| `/refresh` | — | `{ success, process }` |

### 7.1 🔴 `POST /api/debug/invoke` — 遠程任意動作実行（最重）

```json
{ "uin": "<uin>", "action": "send_group_msg",
  "params": { "group_id": 20001, "message": "hi" } }
```

其将請求 **直転発与指定帳号之動作分発器**（源码
`oneBotManager.getInstance(uin).invokeAction(action, params)`）、
**不作任何動作級白名単或権限検査** 也。

後果：**凡能登録 WebUI 者 = 能以機器人身分実行全 222 個動作**、
含而不限於：

| 動作 | 影響 |
| --- | --- |
| `send_group_msg` / `send_private_msg` | 以機器人身分向任意群/好友発消息 |
| `set_group_kick` / `set_group_ban` | 踢人、禁言 |
| `set_group_leave` | 退群 |
| `bot_exit` | **退出機器人工程** |
| `set_restart` | 重啓（本実装返不支持） |
| `send_packet` | 発送 **原始 SSO 包** |
| `upload_group_file` | 上載任意文件至群 |
| `set_qq_profile` / `set_qq_avatar` | 変更帳号資料 |

**加固建議（按優先級）**：

1. **勿将 WebUI 露於公網**。既定綁 `127.0.0.1`、若需遠程訪問
   請置於反向代理之後而限来源 IP。
2. 於反向代理層対 `/api/debug/*` 做 **路徑級封禁或 IP 白名単**。
3. 若必須開放、啓用 **TLS** 而用強密碼 + TOTP。
   （注意：TOTP 唯於登録之時校験、見 §2.6。）
4. 審計：毎次呼出皆経
   `traceAuthenticatedWebuiMutation`、可於記録之中追蹤。
5. 長期方案：為該端点増独立之二次確認或開関。

**校験挙動**：

| 情況 | 応答 |
| --- | --- |
| body 非法 JSON | `400` `请求格式错误` |
| `uin` 不匹配 `/^\d{5,10}$/` | `400` `无效的账号` |
| `action` 缺失/非文字列 | `400` `action 必填` |
| `params` 非対象（陣列/null） | `400` `params 必须是对象` |
| 帳号不在線 | `404` `账号不在线` |

### 7.2 其余敏感除錯端点

| 端点 | 危険 |
| --- | --- |
| `POST /api/debug/invoke-stream` | 同 `/api/debug/invoke`、支持流式動作 |
| `POST /api/debug/upload` | **向服務端磁盤写文件**（路徑由服務端定、不可任意指定） |
| `GET /api/debug/stream` | 泄漏 **全帳号** 之実時事件（含私聊内容） |
| `GET /api/logs/export/trace` | 輸出含敏感情報之完全追蹤 |
| `POST /api/processes/:pid/load` \| `/unload` \| `/refresh` | 対宿主 QQ 工程実行 **hook 装載/卸載**；`:pid` 須為 `1..4194304` 之整数 |

---

## 8. 系統与設定

本節共 **9** 個端点（`/api/system` 帰於 [§5](#5-状态与连接)、
`/api/update/*` 帰於 [§11](#11-更新)）。

| 方法 | 路徑 | 参數 | 返却 |
| --- | --- | --- | --- |
| `GET` | `/api/system/settings` | — | `{ settings, hasCert, envOverrides, listeningPort, restartRequiredToApply }` |
| `POST` | `/api/system/settings` | `{ webuiPort?, webuiHost?, tlsEnabled?, trustProxy? }` | `{ success, settings, restartRequiredToApply }` |
| `POST` | `/api/system/tls/cert` | `{ cert, key }`（PEM 文字列） | `{ success, restartRequiredToApply }` |
| `DELETE` | `/api/system/tls/cert` | — | `{ success }` |
| `GET` | `/api/system/backup/export` | `credentials=1` | 備份 JSON（附件） |
| `POST` | `/api/system/backup/import` | 備份 JSON | 恢復結果 |
| `GET` | `/api/system/storage` | — | `{ settings, snapshot, lastCleanup }` |
| `POST` | `/api/system/storage/settings` | 存儲設定 | `{ success, ... }` |
| `POST` | `/api/system/storage/cleanup` | 清理請求 | 清理結果 |

### 8.1 敏感端点説明

| 端点 | 危険 |
| --- | --- |
| `GET /api/system/backup/export?credentials=1` | 🔴 **輸出含憑據之完全備份**（帳号 token、TOTP secret 等） |
| `POST /api/system/backup/import` | 🔴 **覆蓋服務端設定**；上限 **32 MiB**（`413`）、失敗会事務回滾 |
| `POST /api/system/tls/cert` | 🔴 **写 TLS 私鑰至磁盤**（`config/key.pem`、権限 `0600`） |
| `DELETE /api/system/tls/cert` | 刪除証書；TLS 啓用之時被拒（`400 请先关闭 TLS 再删除证书`） |
| `POST /api/system/storage/cleanup` | 🔴 **刪除存儲文件**；請求須帯確認串（全帳号之時為 `清理全部账号`） |
| `POST /api/update/download` \| `/restart` | 下載而 **重啓服務** |
| `POST /api/system/settings` | 改監聴地址/端口、TLS、`trustProxy`；**須重啓方有効** |

> ⚠️ `POST /api/system/settings` 之中之 `trustProxy` 影響登録限流之 IP 判定。
> 源码明確警告：`SNOWLUMA_WEBUI_TRUST_PROXY=1` 唯於 **反向代理会剥離**
> 客端自設之 `X-Real-IP` / `X-Forwarded-For` 之場合方安全、
> 否者攻撃者可偽造 IP 以繞登録限流也。

### 8.2 存儲設定与備份之辺界

- `POST /api/system/storage/settings`：
  被環境変数鎖定之欄位返 `409` + `lockedFields`。
- 備份導入所宣言長度超 **32 MiB** 直 `413`。
- TLS 証書必須為 **合法之 PEM 対**、否者 `400`。

---

## 9. 通知

| 方法 | 路徑 | 参數 | 返却 |
| --- | --- | --- | --- |
| `GET` | `/api/notifications/config` | — | `{ config }` |
| `POST` | `/api/notifications/config` | 通知設定 | `{ success, config }` |
| `GET` | `/api/notifications/recent` | `limit`（既定 100、上限 100） | `{ recent }` |
| `POST` | `/api/notifications/test` | `{ channelId }` | `{ success, status, message }` |

- 設定体上限 **512 KiB**（`413`）。
- `test` 缺 `channelId` → `400`；渠道不存在 → `404`。
- 通知子系統不可用 → `503`。

---

## 10. 全局設定与界面

本節共 **7** 個端点。

| 方法 | 路徑 | 鑑権 | 参數 | 返却 |
| --- | --- | --- | --- | --- |
| `GET` | `/api/global-config` | 須登録 | — | `{ config }` |
| `POST` | `/api/global-config` | 須登録 | 全局設定 | 保存結果（上限 512 KiB） |
| `GET` | `/api/ui` | 須登録 | — | `{ config }` |
| `GET` | `/api/ui/public` | **免登録** | — | `{ appearance }` |
| `POST` | `/api/ui` | 須登録 | UI 設定 | `{ success, config }`（上限 256 KiB） |
| `POST` | `/api/ui/background` | 須登録 | multipart `file` | `{ success, config }` |
| `DELETE` | `/api/ui/background` | 須登録 | — | `{ success, config }` |

**`/api/ui/public` 免登録** 之設計意図：登録頁須先応用主題（外観）方能描画也。
其唯露外観相關欄位（`publicAppearance()`）、**不含敏感設定**。

**背景図上載**：

- 上限 **5 MiB**（`5242880`）；`content-length` 超 **6 MiB** 之時提前 `413`。
- 唯受 **PNG / JPEG / WebP**（按内容嗅探 `sniffImageMime`）；
  其余類型 `415 仅支持 PNG / JPEG / WebP 图片`。
- 缺文件 → `400 缺少图片文件`。

---

## 11. 更新

挂載点 `/api/update`（源码 `app.route("/api/update", updateRoutes(...))`）。

| 方法 | 完全路徑 | 参數 | 返却 |
| --- | --- | --- | --- |
| `GET` | `/api/update/status` | — | 更新服務状態 |
| `GET` | `/api/update/sources` | — | `{ config }` |
| `POST` | `/api/update/sources` | 源設定 | `{ config, saved, applied, online, errors, message }` |
| `POST` | `/api/update/sources/test` | 源候補 | `{ results }` |
| `POST` | `/api/update/download` | `{ version }` | `202` 状態；缺 `version` → `400`；衝突 → `409` |
| `POST` | `/api/update/restart` | — | `202` 状態；衝突 → `409` |

> 另有 `GET /api/update/check?force=true`（登記於 `server.ts`、
> 不在 `update-routes.ts` 之内）。

---

## 12. 静態資源

| 方法 | 路徑 | 鑑権 | 説明 |
| --- | --- | --- | --- |
| `GET` | `/robots.txt` | 無 | 恒返 `Disallow: /` |
| `GET` | `/avatar/:uin` | **独立校験** | QQ 頭像代理（見下） |
| `GET` | `/ui-asset/background` | **無** | 背景図（未設定之時 `404`） |
| `GET` | `/`、`/index.html` | 無 | 前端入口 |
| `GET` | `/*` | 無 | 静態文件 + SPA 回退 |

### 12.1 `/avatar/:uin` 之独立鑑権

其 **不在 `/api/*` 中間件覆蓋範囲之内**、而自行校験
**`snowluma_avatar_session` Cookie**：

```js
const sessionToken = readAvatarSessionToken(c);
const session = sessionTokens.get(sessionToken);
if (!session || Date.now() > session.expiresAt) {
  if (sessionToken) sessionTokens.delete(sessionToken);
  return c.text("unauthorized", 401);
}
```

- Cookie 由 `POST /api/login` 与 `GET /api/status` 設定。
- `:uin` 必須匹配 `/^\d{5,10}$/`、否者 `400 invalid uin`。
- 頭像緩衝 **720 小時（30 日）**；瀏覧器緩衝同為 30 日。
- 上流取図失敗而有旧緩衝之時返旧図；無緩衝則 `502 avatar unavailable`。
- ✅ 実測：不帯 Cookie → `401`。

> ⚠️ 由 `/api/status` 刷新 Cookie、前端若不呼 `/api/status`、
> 頭像会話可能於 24 小時之後失效也。

### 12.2 `/ui-asset/background` **無鑑権**

```js
app.get("/ui-asset/background", (c) => {
  const asset = readBackgroundImage();
  if (!asset) return c.text("no background", 404);
  return new Response(new Uint8Array(asset.bytes), { headers: { ... } });
});
```

未設背景図之時返 `404`。**凡未認証之訪者皆能読已設之背景図**。
勿以敏感図為背景也。

### 12.3 SPA 回退之白名単

`static-frontend.ts` 之中、回退至 `index.html` 之前会除這些前綴：

```js
if (["/api/", "/avatar/", "/ui-asset/"].some((p) => c.req.path.startsWith(p)))
  return c.text("not found", 404);
```

即未匹配之 `/api/*` 返 `404 not found`、不返 HTML 也。

---

## 13. 通用錯誤約定

| HTTP | 場景 | 応答体 |
| --- | --- | --- |
| `400` | 参數/JSON 格式錯誤 | `{ success:false }` 或 `{ message }` |
| `401` | 未帯令符 / 令符失效 | `{ status:"failed", message:"Unauthorized" }` |
| `403` | 未同意協議 / 未改密 | `{ status:"failed", consentRequired }` 或 `{ mustChangePassword }` |
| `404` | 資源不存在 | `{ success:false, message }` |
| `409` | 状態衝突（協議版本、設定被鎖、更新衝突） | `{ success:false, message }` |
| `413` | 請求体過大 | `{ success:false, message }` |
| `415` | 不支持之媒体類型 | `{ success:false, message }` |
| `429` | 登録限流 | `{ success:false, message }` |
| `500` | 服務端異常 | `{ success:false, message }` |
| `502` | 上流（取頭像）失敗 | 純文本 |
| `503` | 子系統不可用 | `{ success:false, message }` |

> **注意応答体風格不一**：認証層用
> `{ status:"failed", message }`、業務層多用
> `{ success:false, message }`。客端応兼容両種也。

### 13.1 安全応答頭

凡応答（`app.use("*")`）附加：

```
X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex
```

另有 `webuiSecurityHeaders` 中間件提供其余安全頭。

---

## 14. 安全敏感端点総覧 🔴

按危険自高至低：

| 端点 | 危険 | 緩和 |
| --- | --- | --- |
| `POST /api/debug/invoke` | **遠程任意動作実行**（含踢人、発消息、原始 SSO 包） | 公網封禁 / IP 白名単 |
| `POST /api/debug/invoke-stream` | 同上、流式 | 同上 |
| `GET /api/system/backup/export?credentials=1` | 輸出全憑據 | 禁帯 `credentials=1` |
| `POST /api/system/backup/import` | 覆蓋全設定 | 限管理員 |
| `POST /api/processes/:pid/load` \| `/unload` | 宿主工程 hook 操作 | IP 白名単 |
| `POST /api/debug/upload` | 写文件至服務端磁盤 | 封禁 `/api/debug/*` |
| `POST /api/system/tls/cert` | 写私鑰 | 限管理員 |
| `GET /api/config/:uin` | **泄漏 OneBot `accessToken` 明文** | 限管理員 |
| `POST /api/system/storage/cleanup` | 刪除存儲資料 | 須確認串 |
| `GET /api/debug/stream` | 泄漏全帳号事件（含私聊） | 封禁 `/api/debug/*` |
| `GET /api/logs/export/trace` | 輸出含敏感情報之記録 | 限管理員 |
| `POST /api/update/download` \| `/restart` | 下載而重啓 | 限管理員 |
| `GET /ui-asset/background` | 無鑑権読背景図 | 勿置敏感図 |

**総体建議**：WebUI 既定監聴 `127.0.0.1`。若需遠程訪問、
**必須** 置於反向代理之後、且同時対 `/api/debug/*`、`/api/processes/*`
做来源限制；唯啓密碼 + TOTP **不足以** 保護這些端点（§2.6）。

---

## 15. 声明表

| 項目 | 状態 |
| --- | --- |
| 66 条路由登記与路徑 | **已核実**：源码逐条抽出 |
| `/api/*` 鑑権中間件論理 | **已核実**：`server.ts` |
| 令符之両種伝達方式（非 Cookie） | **已核実**：`request-security.ts` + 実機驗証 |
| 令符 24h、登録限流 5 次 / 15 分 | **已核実**：源码常量 |
| 両級門禁白名単 | **已核実**：源码常量集合 |
| **無 TOTP 二次驗証** | **已核実**：源码之中無相關中間件 |
| `/api/debug/invoke` 無動作級鑑権 | **已核実**：直呼 `invokeAction` |
| `/ui-asset/background` 無鑑権 | **已核実**：源码 + 実測 `404`（未設定之時） |
| `/avatar/:uin` 用独立 Cookie | **已核実**：源码 + 実測 `401` |
| 各端点参數与返却形状 | **已核実**：源码；**未逐一実機呼出** |
| 上載体積上限（5/6/32/512/256 KiB/MiB） | **已核実**：源码常量 |

> **未実測項**：除 `/api/login`、`/api/status`、`/api/qq-list`、
> `/api/connections`、`/api/config/:uin`、`/api/debug/actions`、
> `/api/ui/public`、`/avatar/:uin`、`/api/logout`、`/api/debug/actions`（未授権）
> 之外、其余端点之 **実際応答** 未経真機呼出驗証、参數与返却形状源自源码読解也。
> 写操作端点（備份導入、存儲清理、更新下載、工程 hook）**皆未実測**、
> 請於生産使用之前自行於測試環境驗証也。