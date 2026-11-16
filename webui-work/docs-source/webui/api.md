# WebUI 后端 API 参考

> [!WARNING]
> 本内容完全由 AI 编写，请谨慎查看。

> 本文列出 Haizakura（原 SnowLuma）WebUI 后端的**全部 HTTP 端点**、
> 鉴权要求与敏感面标注。
>
> **数据来源**：`packages/core/src/webui/server.ts`（主路由，54 条注册）、
> `storage-routes.ts`（3 条）、`update-routes.ts`（6 条，挂在 `/api/update`）、
> `static-frontend.ts`（静态前端，4 条）、
> `request-security.ts`（会话令牌提取）、`auth.ts` / `totp.ts`（认证）。
>
> 本文的鉴权行为均**在运行实例上实测**（2026-11-13）。

---

## 1. 总览

| 项目 | 数量 |
| --- | --- |
| **`/api/*` 端点总数** | **60** |
| ├ `server.ts` 注册的 `/api/*` | 51 |
| ├ `storage-routes.ts` | 3（`/api/system/storage*`） |
| └ `update-routes.ts` | 6（挂载于 `/api/update`） |
| 非 `/api` 端点 | 4（`/robots.txt`、`/avatar/:uin`、`/ui-asset/background`、`/`） |
| 静态前端路由 | 4（`/`、`/index.html`、`/*` 静态、SPA 回退） |
| **路由注册总计** | **66** |

> 说明：`server.ts` 共 54 条注册，其中 51 条为 `/api/*`，
> 另 3 条为 `/robots.txt`、`/avatar/:uin`、`/ui-asset/background`。
> 加上 `storage-routes.ts` 的 3 条与 `update-routes.ts` 的 6 条，
> `/api/*` 合计 **60** 条。

### 1.1 分组导航

| 分组 | 端点数 | 章节 |
| --- | --- | --- |
| 认证与会话 | 10 | [§3](#3-认证与会话) |
| 协议与合规 | 2 | [§4](#4-协议与合规) |
| 状态与连接 | 6 | [§5](#5-状态与连接) |
| 账号与 OneBot 配置 | 2 | [§6](#6-账号与-onebot-配置) |
| 日志与调试 | 14 | [§7](#7-日志与调试) |
| 系统与设置 | 9 | [§8](#8-系统与设置) |
| 通知 | 4 | [§9](#9-通知) |
| 全局配置与界面 | 7 | [§10](#10-全局配置与界面) |
| 更新 | 6 | [§11](#11-更新) |
| **合计** | **60** | |

---

## 2. 鉴权机制

### 2.1 全局中间件

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

- 门禁只作用于 `/api/*`。**`/avatar/:uin` 与 `/ui-asset/background` 不在其中**，
  各自有独立处理（见 §12）。
- 只需这两个路径**免登录**：`/api/login`、`/api/ui/public`。

### 2.2 会话令牌的两种传递方式

源码 `request-security.ts`：

```js
function extractWebuiSessionToken(request) {
  const sessionToken = request.headers.get("x-snowluma-token");
  if (sessionToken !== null) return sessionToken;
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
}
```

| 方式 | 写法 | 说明 |
| --- | --- | --- |
| 自定义头 | `x-snowluma-token: <token>` | 优先读取 |
| Bearer | `Authorization: Bearer <token>` | 备选 |

> ⚠️ **令牌不是通过 Cookie 传递的**。登录响应设置的 Cookie 名为
> `snowluma_avatar_session`，`Path=/avatar`，**仅用于 `/avatar/:uin`**，
> 不能访问 `/api/*`。调用 `/api/*` 必须显式带上面两种头之一。
>
> ✅ 实测：带 `x-snowluma-token` 请求 `/api/status` → `200`；
> 不带 → `401`。

### 2.3 令牌生命周期

| 项目 | 值 | 来源 |
| --- | --- | --- |
| 令牌格式 | `randomBytes(32).toString("hex")`（64 字符） | `server.ts` |
| 有效期 | `TOKEN_TTL_MS = 1440 * 60 * 1000` = **24 小时** | `server.ts` |
| 清理 | 每 60 秒扫描过期令牌 | `tokenJanitor` |
| 改密 / 改 TOTP | **吊销其它所有会话**（`invalidateOtherSessions`） | `server.ts` |

### 2.4 登录限流

| 项目 | 值 |
| --- | --- |
| 最大尝试次数 | `LOGIN_MAX_ATTEMPTS = 5` |
| 锁定时长 | `LOGIN_LOCKOUT_MS = 900 * 1000`（**15 分钟**） |
| 限流键 | 客户端 IP（`trustProxy` 影响取值） |
| 超限响应 | `429` + `登录尝试过多，请 N 秒后重试` |

### 2.5 两级附加门禁

**① 同意协议门禁** — `consentGatePending` 为真时，除白名单外一律 `403`：

```
CONSENT_ALLOWLIST = {
  "/api/status", "/api/auth/state", "/api/agreements",
  "/api/agreements/record-consent", "/api/logout"
}
```

**② 强制改密门禁** — 令牌带 `mustChangePassword` 时，除白名单外一律 `403`：

```
MUST_CHANGE_ALLOWLIST = {
  "/api/status", "/api/auth/state", "/api/auth/check-strength",
  "/api/auth/change-password", "/api/agreements",
  "/api/agreements/record-consent", "/api/logout"
}
```

响应体带 `consentRequired: true` 或 `mustChangePassword: true`，
前端据此跳转对应流程。

> ✅ 这两个门禁是**实测会遇到**的：未改初始密码时，多数 API 返回
> `403 mustChangePassword`。

### 2.6 TOTP 的实际作用范围 ⚠️

**TOTP 只在登录时校验，不是敏感端点的二次验证。**

- 登录请求可带 `totp` 或 `recoveryCode`；
  若已启用 TOTP 而未提供，返回 `{ success: false, needsTotp: true }`。
- **登录成功后，会话令牌即可访问全部端点**，包括
  `/api/debug/invoke` 这类高危端点，**不再要求 TOTP**。
- 因此 **TOTP 无法限制已登录会话的破坏半径**。

> 🔴 **安全建议**：若 WebUI 暴露在不可信网络，仅靠 TOTP 不足以保护
> 敏感端点。真实防线应是**网络层隔离**（反向代理 + IP 白名单 + TLS），
> 而不是依赖应用层的 TOTP。
>
> 源码中 `totpDisabledInDev()` 在 dev 模式下会禁用 TOTP 相关端点。

---

## 3. 认证与会话

| 方法 | 路径 | 鉴权 | 参数 | 返回 |
| --- | --- | --- | --- | --- |
| `POST` | `/api/login` | **免登录** | `{ password, totp?, recoveryCode? }` | `{ success, token, mustChangePassword }` |
| `POST` | `/api/logout` | 需登录 | — | `{ success: true }` |
| `GET` | `/api/auth/state` | 需登录 | — | `{ mustChangePassword }` |
| `POST` | `/api/auth/check-strength` | 需登录 | `{ password }` | 强度评估结果 |
| `POST` | `/api/auth/change-password` | 需登录 | `{ ... }` | 改密结果；**吊销其它会话** |
| `GET` | `/api/auth/totp` | 需登录 | — | TOTP 状态 |
| `POST` | `/api/auth/totp/begin` | 需登录 | `{ issuer?, accountName? }` | 注册凭据（含 secret / otpauth URL） |
| `POST` | `/api/auth/totp/confirm` | 需登录 | `{ token/验证码 }` | 确认启用；**吊销其它会话** |
| `POST` | `/api/auth/totp/disable` | 需登录 | — | 关闭 TOTP |
| `POST` | `/api/auth/totp/recovery-codes` | 需登录 | — | 重新生成恢复码 |

> 本节共 **10** 个端点。`POST /api/agreements/record-consent`
> 归在 [§4 协议与合规](#4-协议与合规)。

### 3.1 登录响应

**成功**：

```json
{ "success": true, "token": "<64位hex>", "mustChangePassword": false }
```

同时设置 Cookie（**仅供 `/avatar`**）：

```
Set-Cookie: snowluma_avatar_session=<token>; Max-Age=86400;
            Path=/avatar; HttpOnly; SameSite=Strict
```

**需要 TOTP**：

```json
{ "success": false, "needsTotp": true }
```

**失败**（`401`）：`{ "success": false, "message": "密码错误" }`
或 `{ "success": false, "message": "验证码不正确" }`。

**限流**（`429`）：`{ "success": false, "message": "登录尝试过多，请 N 秒后重试" }`

### 3.2 `record-consent` 的版本校验

若 `version` 与当前协议版本不符，返回 `409`：

```json
{ "success": false, "message": "协议版本已更新，请刷新后重新确认",
  "currentVersion": "<当前版本>" }
```

### 3.3 TOTP 注册流程

1. `POST /api/auth/totp/begin` → 取得 secret / otpauth URL
   （注册凭据缓存 **`TOTP_ENROLL_TTL_MS = 600000` ms = 10 分钟**）
2. 在验证器中添加并取得 6 位码
3. `POST /api/auth/totp/confirm` 提交验证码完成启用

TOTP issuer 默认 **`Haizakura`**（`DEFAULT_TOTP_ISSUER`）。

---

## 4. 协议与合规

| 方法 | 路径 | 鉴权 | 返回 |
| --- | --- | --- | --- |
| `GET` | `/api/agreements` | 需登录（**在两级白名单内**） | 协议文本与版本 |
| `POST` | `/api/agreements/record-consent` | 需登录（**在两级白名单内**） | 见 §3.2 |

> 这两个端点在 `CONSENT_ALLOWLIST` 与 `MUST_CHANGE_ALLOWLIST` 中，
> 因此未同意协议 / 未改密时**仍可访问** —— 否则会死锁。

---

## 5. 状态与连接

| 方法 | 路径 | 参数 | 返回 |
| --- | --- | --- | --- |
| `GET` | `/api/status` | — | `{ status: "running" }` |
| `GET` | `/api/connections` | — | `{ list: [...] }` 各账号适配器状态 |
| `GET` | `/api/qq-list` | — | `{ list: [{ uin, nickname }] }` |
| `GET` | `/api/state/stream` | — | **SSE**，状态变更推送 |
| `GET` | `/api/system` | — | 主机与运行时信息 |
| `GET` | `/api/update/check` | `force` | 更新检查结果 |

**`/api/status` 的副作用**：它会**顺带刷新 `/avatar` 的会话 Cookie**
（源码 `setAvatarSessionCookie(c, c.get("sessionToken"), ...)`）。
前端周期性调用即可维持头像可用。

**`/api/connections` 实测返回**：

```json
{ "list": [ { "uin": "<uin>", "nickname": "HaizakuraBot",
  "adapters": [
    { "name": "http-default", "kind": "httpServer", "status": "ok", "detail": "监听中" },
    { "name": "ws-default", "kind": "wsServer", "status": "ok", "detail": "1 个客户端" }
  ],
  "databaseMigration": { "phase": "complete", "usable": true, "progress": 1 } } ] }
```

**`/api/state/stream`**：`stateBus` 未配置时返回 `503`
`state stream not configured`。帧以 `{ kind: "ready" }` 开头，
随后推送 `processes` / `qq-list` / 连接状态变更（**50 ms 去抖**）。

**`/api/system`** 返回 `hostname`、`platform`、`arch`、`release`、`distro`、
`uptime`、`processUptime`、`nodeVersion`、`cpu{ model, cores, loadAvg, perCore, average }`、
`memory{ total, free, used, usagePercent }`、
`runtime{ pid, lowIntegrity, rss, heapTotal, heapUsed, external, arrayBuffers }`。

---

## 6. 账号与 OneBot 配置

| 方法 | 路径 | 参数 | 返回 |
| --- | --- | --- | --- |
| `GET` | `/api/config/:uin` | — | `{ config }` 完整 OneBot 配置 |
| `POST` | `/api/config/:uin` | OneBot 配置对象 | `{ success, saved, applied, ... }` |

**校验**：

- `:uin` 必须匹配 `UIN_REGEX = /^\d{5,10}$/`，否则 `400 invalid uin`。
- 请求体经 `assertValidOneBotConfig` 严格校验；非法配置直接 `400`，
  **不会**落盘。
- 保存后原子应用；失败会**回滚到上一份配置**。

> 🔴 **敏感**：`GET /api/config/:uin` 的返回**包含 `accessToken` 明文**。
> 实测响应中可直接看到 `http-default` 与 `ws-default` 的 token。
> 任何能访问 WebUI 的人都能取得 OneBot 接入凭据。

---

## 7. 日志与调试

本节共 **14** 个端点。

| 方法 | 路径 | 参数 | 返回 |
| --- | --- | --- | --- |
| `GET` | `/api/logs` | `limit`（默认 300） | `{ list: [...] }` |
| `GET` | `/api/logs/export/trace` | — | 完整链路追踪文件（附件下载） |
| `GET` | `/api/logs/level` | — | `{ level, levels }` |
| `POST` | `/api/logs/level` | `{ level }` | `{ level, levels }` |
| `GET` | `/api/logs/stream` | — | **SSE**，实时日志 |
| `GET` | `/api/debug/actions` | — | `{ actions: [...], categories: [...] }` |
| `POST` | `/api/debug/invoke` | `{ uin, action, params }` | 动作执行结果 |
| `POST` | `/api/debug/invoke-stream` | `{ uin, action, params }` | **SSE**，流式动作结果 |
| `POST` | `/api/debug/upload` | `filename`（query）+ 原始 body | `{ status, path, size }` |
| `GET` | `/api/debug/stream` | — | **SSE**，全部账号的事件流 |
| `GET` | `/api/processes` | — | `{ list: [...] }` |
| `POST` | `/api/processes/:pid/load` \| `/unload` \| `/refresh` | — | `{ success, process }` |

### 7.1 🔴 `POST /api/debug/invoke` — 远程任意动作执行（最严重）

```json
{ "uin": "<uin>", "action": "send_group_msg",
  "params": { "group_id": 20001, "message": "hi" } }
```

它把请求**直接转发给指定账号的动作分发器**（源码
`oneBotManager.getInstance(uin).invokeAction(action, params)`），
**不做任何动作级白名单或权限检查**。

后果：**任何能登录 WebUI 的人 = 能以机器人身份执行全部 222 个动作**，
包括但不限于：

| 动作 | 影响 |
| --- | --- |
| `send_group_msg` / `send_private_msg` | 以机器人身份向任意群/好友发消息 |
| `set_group_kick` / `set_group_ban` | 踢人、禁言 |
| `set_group_leave` | 退群 |
| `bot_exit` | **退出机器人进程** |
| `set_restart` | 重启（本实现返回不支持） |
| `send_packet` | 发送**原始 SSO 包** |
| `upload_group_file` | 上传任意文件到群 |
| `set_qq_profile` / `set_qq_avatar` | 修改账号资料 |

**加固建议（按优先级）**：

1. **不要将 WebUI 暴露到公网**。默认绑定 `127.0.0.1`，如需远程访问
   请置于反向代理后并限制来源 IP。
2. 在反向代理层对 `/api/debug/*` 做**路径级封禁或 IP 白名单**。
3. 若必须开放，启用 **TLS** 并使用强密码 + TOTP。
   （注意：TOTP 只在登录时校验，见 §2.6。）
4. 审计：每次调用都会走
   `traceAuthenticatedWebuiMutation`，可在日志中追踪。
5. 长期方案：为该端点增加独立的二次确认或开关。

**校验行为**：

| 情况 | 响应 |
| --- | --- |
| body 非法 JSON | `400` `请求格式错误` |
| `uin` 不匹配 `/^\d{5,10}$/` | `400` `无效的账号` |
| `action` 缺失/非字符串 | `400` `action 必填` |
| `params` 非对象（数组/null） | `400` `params 必须是对象` |
| 账号不在线 | `404` `账号不在线` |

### 7.2 其余敏感调试端点

| 端点 | 风险 |
| --- | --- |
| `POST /api/debug/invoke-stream` | 同 `/api/debug/invoke`，支持流式动作 |
| `POST /api/debug/upload` | **向服务端磁盘写文件**（路径由服务端决定，不可任意指定） |
| `GET /api/debug/stream` | 泄漏**全部账号**的实时事件（含私聊内容） |
| `GET /api/logs/export/trace` | 导出含敏感信息的完整追踪 |
| `POST /api/processes/:pid/load` \| `/unload` \| `/refresh` | 对宿主 QQ 进程执行 **hook 装载/卸载**；`:pid` 需为 `1..4194304` 的整数 |

---

## 8. 系统与设置

本节共 **9** 个端点（`/api/system` 归在 [§5](#5-状态与连接)，
`/api/update/*` 归在 [§11](#11-更新)）。

| 方法 | 路径 | 参数 | 返回 |
| --- | --- | --- | --- |
| `GET` | `/api/system/settings` | — | `{ settings, hasCert, envOverrides, listeningPort, restartRequiredToApply }` |
| `POST` | `/api/system/settings` | `{ webuiPort?, webuiHost?, tlsEnabled?, trustProxy? }` | `{ success, settings, restartRequiredToApply }` |
| `POST` | `/api/system/tls/cert` | `{ cert, key }`（PEM 字符串） | `{ success, restartRequiredToApply }` |
| `DELETE` | `/api/system/tls/cert` | — | `{ success }` |
| `GET` | `/api/system/backup/export` | `credentials=1` | 备份 JSON（附件） |
| `POST` | `/api/system/backup/import` | 备份 JSON | 恢复结果 |
| `GET` | `/api/system/storage` | — | `{ settings, snapshot, lastCleanup }` |
| `POST` | `/api/system/storage/settings` | 存储设置 | `{ success, ... }` |
| `POST` | `/api/system/storage/cleanup` | 清理请求 | 清理结果 |

### 8.1 敏感端点说明

| 端点 | 风险 |
| --- | --- |
| `GET /api/system/backup/export?credentials=1` | 🔴 **导出包含凭据的完整备份**（账号 token、TOTP secret 等） |
| `POST /api/system/backup/import` | 🔴 **覆盖服务端配置**；上限 **32 MiB**（`413`），失败会事务回滚 |
| `POST /api/system/tls/cert` | 🔴 **写入 TLS 私钥到磁盘**（`config/key.pem`，权限 `0600`） |
| `DELETE /api/system/tls/cert` | 删除证书；TLS 启用时被拒（`400 请先关闭 TLS 再删除证书`） |
| `POST /api/system/storage/cleanup` | 🔴 **删除存储文件**；请求需带确认串（全部账号时为 `清理全部账号`） |
| `POST /api/update/download` \| `/restart` | 下载并**重启服务** |
| `POST /api/system/settings` | 改监听地址/端口、TLS、`trustProxy`；**需重启生效** |

> ⚠️ `POST /api/system/settings` 中的 `trustProxy` 影响登录限流的 IP 判定。
> 源码明确警告：`SNOWLUMA_WEBUI_TRUST_PROXY=1` 仅在**反向代理会剥离**
> 客户端自设的 `X-Real-IP` / `X-Forwarded-For` 时才安全，
> 否则攻击者可伪造 IP 绕过登录限流。

### 8.2 存储设置与备份的边界

- `POST /api/system/storage/settings`：
  被环境变量锁定的字段返回 `409` + `lockedFields`。
- 备份导入声明长度超过 **32 MiB** 直接 `413`。
- TLS 证书必须是**合法的 PEM 配对**，否则 `400`。

---

## 9. 通知

| 方法 | 路径 | 参数 | 返回 |
| --- | --- | --- | --- |
| `GET` | `/api/notifications/config` | — | `{ config }` |
| `POST` | `/api/notifications/config` | 通知配置 | `{ success, config }` |
| `GET` | `/api/notifications/recent` | `limit`（默认 100，上限 100） | `{ recent }` |
| `POST` | `/api/notifications/test` | `{ channelId }` | `{ success, status, message }` |

- 配置体上限 **512 KiB**（`413`）。
- `test` 缺少 `channelId` → `400`；渠道不存在 → `404`。
- 通知子系统不可用 → `503`。

---

## 10. 全局配置与界面

本节共 **7** 个端点。

| 方法 | 路径 | 鉴权 | 参数 | 返回 |
| --- | --- | --- | --- | --- |
| `GET` | `/api/global-config` | 需登录 | — | `{ config }` |
| `POST` | `/api/global-config` | 需登录 | 全局配置 | 保存结果（上限 512 KiB） |
| `GET` | `/api/ui` | 需登录 | — | `{ config }` |
| `GET` | `/api/ui/public` | **免登录** | — | `{ appearance }` |
| `POST` | `/api/ui` | 需登录 | UI 配置 | `{ success, config }`（上限 256 KiB） |
| `POST` | `/api/ui/background` | 需登录 | multipart `file` | `{ success, config }` |
| `DELETE` | `/api/ui/background` | 需登录 | — | `{ success, config }` |

**`/api/ui/public` 免登录**的设计意图：登录页需要应用主题（外观）后才能渲染。
它只暴露外观相关字段（`publicAppearance()`），**不含敏感配置**。

**背景图上传**：

- 上限 **5 MiB**（`5242880`）；`content-length` 超过 **6 MiB** 时提前 `413`。
- 仅接受 **PNG / JPEG / WebP**（按内容嗅探 `sniffImageMime`）；
  其它类型 `415 仅支持 PNG / JPEG / WebP 图片`。
- 缺少文件 → `400 缺少图片文件`。

---

## 11. 更新

挂载点 `/api/update`（源码 `app.route("/api/update", updateRoutes(...))`）。

| 方法 | 完整路径 | 参数 | 返回 |
| --- | --- | --- | --- |
| `GET` | `/api/update/status` | — | 更新服务状态 |
| `GET` | `/api/update/sources` | — | `{ config }` |
| `POST` | `/api/update/sources` | 源配置 | `{ config, saved, applied, online, errors, message }` |
| `POST` | `/api/update/sources/test` | 源候选 | `{ results }` |
| `POST` | `/api/update/download` | `{ version }` | `202` 状态；缺 `version` → `400`；冲突 → `409` |
| `POST` | `/api/update/restart` | — | `202` 状态；冲突 → `409` |

> 另有 `GET /api/update/check?force=true`（注册在 `server.ts`，
> 不在 `update-routes.ts` 内）。

---

## 12. 静态资源

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/robots.txt` | 无 | 恒返回 `Disallow: /` |
| `GET` | `/avatar/:uin` | **独立校验** | QQ 头像代理（见下） |
| `GET` | `/ui-asset/background` | **无** | 背景图（未设置时 `404`） |
| `GET` | `/`、`/index.html` | 无 | 前端入口 |
| `GET` | `/*` | 无 | 静态文件 + SPA 回退 |

### 12.1 `/avatar/:uin` 的独立鉴权

它**不在 `/api/*` 中间件覆盖范围内**，而是自行校验
**`snowluma_avatar_session` Cookie**：

```js
const sessionToken = readAvatarSessionToken(c);
const session = sessionTokens.get(sessionToken);
if (!session || Date.now() > session.expiresAt) {
  if (sessionToken) sessionTokens.delete(sessionToken);
  return c.text("unauthorized", 401);
}
```

- Cookie 由 `POST /api/login` 与 `GET /api/status` 设置。
- `:uin` 必须匹配 `/^\d{5,10}$/`，否则 `400 invalid uin`。
- 头像缓存 **720 小时（30 天）**；浏览器缓存同为 30 天。
- 上游取图失败且有旧缓存时返回旧图；无缓存则 `502 avatar unavailable`。
- ✅ 实测：不带 Cookie → `401`。

> ⚠️ 由 `/api/status` 刷新 Cookie，前端若不调用 `/api/status`，
> 头像会话可能在 24 小时后失效。

### 12.2 `/ui-asset/background` **无鉴权**

```js
app.get("/ui-asset/background", (c) => {
  const asset = readBackgroundImage();
  if (!asset) return c.text("no background", 404);
  return new Response(new Uint8Array(asset.bytes), { headers: { ... } });
});
```

未设置背景图时返回 `404`。**任何未认证访问者都能读取已设置的背景图**。
请勿把敏感图片用作背景。

### 12.3 SPA 回退的白名单

`static-frontend.ts` 中，回退到 `index.html` 前会排除这些前缀：

```js
if (["/api/", "/avatar/", "/ui-asset/"].some((p) => c.req.path.startsWith(p)))
  return c.text("not found", 404);
```

即未匹配的 `/api/*` 返回 `404 not found`，不会返回 HTML。

---

## 13. 通用错误约定

| HTTP | 场景 | 响应体 |
| --- | --- | --- |
| `400` | 参数/JSON 格式错误 | `{ success:false }` 或 `{ message }` |
| `401` | 未带令牌 / 令牌失效 | `{ status:"failed", message:"Unauthorized" }` |
| `403` | 未同意协议 / 未改密 | `{ status:"failed", consentRequired }` 或 `{ mustChangePassword }` |
| `404` | 资源不存在 | `{ success:false, message }` |
| `409` | 状态冲突（协议版本、设置被锁定、更新冲突） | `{ success:false, message }` |
| `413` | 请求体过大 | `{ success:false, message }` |
| `415` | 不支持的媒体类型 | `{ success:false, message }` |
| `429` | 登录限流 | `{ success:false, message }` |
| `500` | 服务端异常 | `{ success:false, message }` |
| `502` | 上游（取头像）失败 | 纯文本 |
| `503` | 子系统不可用 | `{ success:false, message }` |

> **注意响应体风格不一致**：认证层用
> `{ status:"failed", message }`，业务层多用
> `{ success:false, message }`。客户端应同时兼容两种。

### 13.1 安全响应头

所有响应（`app.use("*")`）附加：

```
X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex
```

另有 `webuiSecurityHeaders` 中间件提供其余安全头。

---

## 14. 安全敏感端点汇总 🔴

按风险从高到低：

| 端点 | 风险 | 缓解 |
| --- | --- | --- |
| `POST /api/debug/invoke` | **远程任意动作执行**（含踢人、发消息、原始 SSO 包） | 公网封禁 / IP 白名单 |
| `POST /api/debug/invoke-stream` | 同上，流式 | 同上 |
| `GET /api/system/backup/export?credentials=1` | 导出全部凭据 | 禁止带 `credentials=1` |
| `POST /api/system/backup/import` | 覆盖全部配置 | 限制管理员 |
| `POST /api/processes/:pid/load` \| `/unload` | 宿主进程 hook 操作 | IP 白名单 |
| `POST /api/debug/upload` | 写文件到服务端磁盘 | 封禁 `/api/debug/*` |
| `POST /api/system/tls/cert` | 写入私钥 | 限管理员 |
| `GET /api/config/:uin` | **泄漏 OneBot `accessToken` 明文** | 限管理员 |
| `POST /api/system/storage/cleanup` | 删除存储数据 | 需确认串 |
| `GET /api/debug/stream` | 泄漏全部账号事件（含私聊） | 封禁 `/api/debug/*` |
| `GET /api/logs/export/trace` | 导出含敏感信息的日志 | 限管理员 |
| `POST /api/update/download` \| `/restart` | 下载并重启 | 限管理员 |
| `GET /ui-asset/background` | 无鉴权读取背景图 | 勿放敏感图 |

**总体建议**：WebUI 默认监听 `127.0.0.1`。如需远程访问，
**必须**置于反向代理之后，并同时对 `/api/debug/*`、`/api/processes/*`
做来源限制；仅启用密码 + TOTP **不足以**保护这些端点（§2.6）。

---

## 15. 声明

| 项目 | 状态 |
| --- | --- |
| 66 条路由注册与路径 | **已核实**：源码逐条提取 |
| `/api/*` 鉴权中间件逻辑 | **已核实**：`server.ts` |
| 令牌的两种传递方式（非 Cookie） | **已核实**：`request-security.ts` + 实机验证 |
| 令牌 24h、登录限流 5 次 / 15 分钟 | **已核实**：源码常量 |
| 两级门禁白名单 | **已核实**：源码常量集合 |
| **无 TOTP 二次验证** | **已核实**：源码中无相关中间件 |
| `/api/debug/invoke` 无动作级鉴权 | **已核实**：直接调用 `invokeAction` |
| `/ui-asset/background` 无鉴权 | **已核实**：源码 + 实测 `404`（未设置时） |
| `/avatar/:uin` 用独立 Cookie | **已核实**：源码 + 实测 `401` |
| 各端点参数与返回形状 | **已核实**：源码；**未逐一实机调用** |
| 上传体积上限（5/6/32/512/256 KiB/MiB） | **已核实**：源码常量 |

> **未实测项**：除 `/api/login`、`/api/status`、`/api/qq-list`、
> `/api/connections`、`/api/config/:uin`、`/api/debug/actions`、
> `/api/ui/public`、`/avatar/:uin`、`/api/logout`、`/api/debug/actions`(未授权)
> 之外，其余端点的**实际响应**未经真机调用验证，参数与返回形状来自源码阅读。
> 写操作端点（备份导入、存储清理、更新下载、进程 hook）**均未实测**，
> 请在生产使用前自行在测试环境验证。
