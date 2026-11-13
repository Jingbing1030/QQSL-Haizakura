# WebUI 使用说明

> 本文介绍 Haizakura（原 SnowLuma）**内置 Web 控制台**的访问方式、
> 首次登录流程、各功能页面与可配置项。
>
> **数据来源**：`packages/core/src/webui/server.ts`（服务与路由）、
> `ui-config.ts`（界面配置结构与默认值）、`auth.ts` / `totp.ts`（认证）、
> `consent.ts`（协议门槛）、`port.ts`（端口探测）、
> 并在运行实例（`http://<your-host>:5199`）上实测。

---

## 1. 概述

WebUI 是内置于进程的**单页应用 + JSON API**，用于：

- 查看账号在线状态与 OneBot 网络适配器连接情况
- **在线编辑每个账号的 OneBot 配置**（HTTP / WS / 反向 WS / SSE）
- 收发调试：直接调用任意 OneBot 动作、订阅实时事件流
- 查看实时日志、调整日志级别、导出链路追踪
- 管理宿主 QQ 进程的 hook（装载 / 卸载 / 刷新）
- 系统设置（监听地址、TLS 证书、`trustProxy`）、存储清理、备份导入导出
- 检查与执行在线更新
- 界面外观自定义（主题、配色、字体、背景图、布局）

---

## 2. 访问与端口

| 项目 | 值 |
| --- | --- |
| 默认端口 | **5099**（`initWebUI(desiredPort = 5099, ...)`） |
| 默认监听地址 | 由持久化配置 `webuiHost` 决定 |
| 端口占用处理 | 从目标端口起**向上探测最多 50 个**，取第一个可用端口 |
| 协议 | HTTP；启用 TLS 后为 HTTPS |

> ⚠️ **端口可能不是你配置的那个**。若 5099 被占用，服务会顺延并打日志：
> `port %d is in use, using %d instead`。
> 实际端口可查 `GET /api/system/settings` 的 `listeningPort` 字段。

### 2.1 实测环境

| 项目 | 实测值 |
| --- | --- |
| WebUI 地址 | `http://<your-host>:5199` |
| 容器内端口 | `5099` |
| 宿主映射 | `5199 -> 5099` |
| `webuiHost` | `0.0.0.0` |
| `tlsEnabled` | `false` |
| `hasCert` | `false` |
| `envOverrides` | `["webuiPort"]` |

> `envOverrides` 列出被**环境变量**锁定的设置项；这些项在 WebUI 中
> 修改无效（保存时会返回 `409 这些设置已由环境变量锁定`）。

---

## 3. 首次登录

### 3.1 初始凭据

凭据存放于 **`config/webui.json`**（scrypt 派生的 `passwordHash` + `passwordSalt`，
**不存明文**）。

首次启动时：

1. 若设置了环境变量 **`SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD`**（**至少 8 字符**，
   否则被忽略），用它作为初始密码，
   且**不要求改密**（日志：`webui credentials seeded from SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD`）。
2. 否则**随机生成**一个 **16 位 hex** 密码
   （`randomBytes(8).toString("hex")`），设置 `mustChangePassword: true`，
   并打印到日志：

```
════════════════════════════════════════════════════════════════
  ★ WebUI 初始登录凭据 / Initial WebUI Credentials ★
  请立即登录并修改密码 —— 关闭程序后此密码无法找回。
  若跳过初始改密，下次启动将自动生成新的随机密码。
  Log in and change the password now; it will not be shown again.
────────────────────────────────────────────────────────────────
```

**只能从日志读取，不会再次显示。**

> ⚠️ **跳过改密的后果**：若上次启动生成了随机密码但**一直没改**，
> 下次启动会**再生成一个新密码**并作废旧的
> （日志：`previous bootstrap password was never rotated; regenerated a new one`）。
> 所以拿到初始密码后请**立即改密**。
>
> 若 `config/webui.json` 损坏或 schema 非法，会被**备份**为
> `webui.json.bak.<时间戳>` 并重新生成凭据。
>
> 推荐做法：用 `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD` 预置一个已知密码，
> 避免翻日志。

> **dev 模式**（`SNOWLUMA_DEV_MODE=1`）下使用内置开发凭据
> （密码固定为 `snowluma-dev`），**跳过 `webui.json` 与密码轮换**，
> 并**禁用改密与 2FA**（尝试时分别报
> `开发模式 (SNOWLUMA_DEV_MODE=1) 已禁用密码修改` /
> `已禁用 2FA`）。**切勿在生产环境开启。**

### 3.2 强制改密门禁 ⚠️

初始密码登录后，会话令牌带 `mustChangePassword: true`。
此时**除白名单外的所有 API 都返回 `403`**：

```json
{ "status": "failed", "message": "请先修改密码", "mustChangePassword": true }
```

白名单（仍可访问）：

```
/api/status          /api/auth/state        /api/auth/check-strength
/api/auth/change-password                   /api/agreements
/api/agreements/record-consent              /api/logout
```

> ⚠️ **这是最常见的"什么都点不动"原因**。看到 `mustChangePassword`
> 请先去改密码，不要怀疑服务异常。

### 3.3 协议同意门禁

若尚未同意 EULA / 隐私政策，除白名单外一律 `403`：

```json
{ "status": "failed", "message": "请先阅读并同意用户协议与隐私政策",
  "consentRequired": true }
```

白名单：

```
/api/status   /api/auth/state   /api/agreements
/api/agreements/record-consent  /api/logout
```

**可通过环境变量预先接受**（两者必须同时设置，只设一个会被忽略并警告）：

```bash
SNOWLUMA_ACCEPT_EULA=1
SNOWLUMA_ACCEPT_PRIVACY=1
```

协议版本由文档内容哈希推导（**非**应用版本），因此升级应用不会
让一次性同意失效。

### 3.4 登录限流

| 项目 | 值 |
| --- | --- |
| 最大尝试 | **5 次** |
| 锁定时长 | **15 分钟**（900 秒） |
| 限流键 | 客户端 IP |
| 超限响应 | `429` + `登录尝试过多，请 N 秒后重试` |

### 3.5 两步验证（TOTP）

在 **设置 → 安全** 中启用。启用后登录需提供 6 位验证码或恢复码。

> 🔴 **重要限制**：TOTP **只在登录时校验**。
> 登录成功后，会话即可访问**全部**端点（包括远程动作执行），
> **不再要求 TOTP**。因此 TOTP 无法限制已登录会话的破坏半径。
> 真正的防线是**网络隔离**（见 §9）。

---

## 4. 页面结构

### 4.1 默认导航

源码 `ui-config.ts` 的 `DEFAULT_NAV_ITEMS`（顺序即默认顺序）：

| 序 | 路由 | 说明 |
| --- | --- | --- |
| 1 | `/` | 总览（Overview） |
| 2 | `/processes` | 进程（宿主 QQ 进程 hook 管理） |
| 3 | `/config` | 配置（各账号 OneBot 配置） |
| 4 | `/logs` | 日志 |
| 5 | `/settings` | 设置 |

默认路由 `defaultRoute: "/"`。

### 4.2 总览页（`/`）

由可配置的**区块**组成，默认全部可见：

| 区块 id | 内容 |
| --- | --- |
| `stats` | 统计概览 |
| `connections` | 各账号的网络适配器连接状态 |
| `alerts` | 告警 |
| `host` | 主机资源（CPU / 内存） |
| `sessions` | 会话 |

**移动端**使用独立的区块列表（`DEFAULT_OVERVIEW_MOBILE`），
粒度为单项统计：

```
stat:status  stat:accounts  stat:processes  stat:host  stat:uptime
connections  alerts  host  sessions
```

### 4.3 顶栏

`DEFAULT_TOPBAR_ITEMS`：`status`（状态指示）、`theme`（主题切换）、
`kiosk`（全屏/专注模式）。三者均可隐藏。

### 4.4 进程页（`/processes`）

列出宿主 QQ 进程并支持 **hook 装载 / 卸载 / 刷新**：

| 操作 | API |
| --- | --- |
| 列出 | `GET /api/processes` |
| 装载 | `POST /api/processes/:pid/load` |
| 卸载 | `POST /api/processes/:pid/unload` |
| 刷新 | `POST /api/processes/:pid/refresh` |

- `:pid` 必须为 `1 .. 4194304` 的整数，否则 `400 invalid pid`。
- hook manager 不可用时返回 `503`。
- 默认排序字段 `processesSort: "pid"`。

### 4.5 配置页（`/config`）

- 账号列表来自 `GET /api/qq-list`。
- 选中账号后读取 `GET /api/config/:uin`，编辑后
  `POST /api/config/:uin` 保存。
- 保存前经**严格 schema 校验**；非法配置 `400` 且**不会落盘**。
- 保存失败会**自动回滚**到上一份配置。
- 默认选中的标签页由 `configTab` 控制（默认空）。

> 🔴 `GET /api/config/:uin` 的返回**含 `accessToken` 明文**，
> 界面上会展示 OneBot 接入令牌。

### 4.6 日志页（`/logs`）

默认配置（`DEFAULT_PAGES.logs`）：

| 项 | 默认 |
| --- | --- |
| `visibleLevels` | 全部：`trace` `debug` `info` `success` `warn` `error` |
| `maxLines` | 1000 |
| `autoScroll` | `true` |
| `wrap` | `true` |
| `highlightRules` | `[]`（可自定义高亮） |
| `preset` | `custom` |

**6 个日志级别**，可在页面上切换，也可用
`GET` / `POST /api/logs/level` 读写。实时刷新的技术实现是
`GET /api/logs/stream`（SSE）。

### 4.7 设置页（`/settings`）

涵盖：系统设置（监听地址/端口、TLS、`trustProxy`）、安全（改密、TOTP）、
通知渠道、全局配置、存储管理、备份导入导出、在线更新，
以及外观自定义（见 §6）。

---

## 5. 认证方式（API 调用者须知）

浏览器端由前端自动处理。**脚本 / 第三方客户端**需注意：

```bash
TOKEN=$(curl -s -X POST http://<host>:5199/api/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"<你的密码>"}' | jq -r .token)

# 方式一：自定义头（推荐）
curl -H "x-snowluma-token: $TOKEN" http://<host>:5199/api/status

# 方式二：Bearer
curl -H "Authorization: Bearer $TOKEN" http://<host>:5199/api/status
```

| 项目 | 值 |
| --- | --- |
| 令牌格式 | 64 位 hex（`randomBytes(32)`） |
| 有效期 | **24 小时** |
| 传递方式 | `x-snowluma-token` 头 或 `Authorization: Bearer` |
| Cookie | **仅 `snowluma_avatar_session`，`Path=/avatar`**，不能访问 `/api/*` |

> ⚠️ **令牌不是 Cookie**。只带 Cookie 调 `/api/*` 会得到 `401`。
>
> ⚠️ 改密码或变更 TOTP 会**吊销其它所有会话**，需重新登录。

详见 [`webui/api.md`](api.md)。

---

## 6. 外观自定义

### 6.1 可配置项（`DEFAULT_APPEARANCE`）

| 分组 | 字段 | 默认值 |
| --- | --- | --- |
| 明暗 | `mode` | `system`（跟随系统） |
| 强调色 | `accentMode` | `preset` |
| | `accentPreset` | `lavender` |
| | `accentCustom` | `#8561bd` |
| | `accentScope` | `global` |
| 暗色 | `darkIntensity` | `soft` |
| | `palette` | `default` |
| 侧栏 | `sidebarStyle` | `follow` |
| | `sidebarPinned` | `false` |
| 背景 | `background.*` | 见 §6.2 |
| 字体 | `fontSans` / `fontMono` | `default` |
| | `fontSansCustom` / `fontMonoCustom` | `""` |
| 尺度 | `uiScale` | `1` |
| | `radius` | `0.75` |
| | `density` | `cozy` |
| 动效 | `reduceMotion` | `false` |
| | `disableMotion` | `false` |
| 交互 | `customPointerSystem` | `false` |
| | `customContextMenu` | `true` |
| 无障碍 | `highContrast` | `false` |
| 其他 | `timeFormat` | `24h` |
| | `pollInterval` | `3000`（毫秒） |
| | `customCss` | `""` |
| | `cssVars` | `{}` |

### 6.2 背景（`DEFAULT_BACKGROUND`）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `type` | `none` | 类型：`none` / 颜色 / 渐变 / 图片 |
| `color` | `#b99ae6` | 纯色背景 |
| `gradient` | `none` | 渐变预设 |
| `imageOpacity` | `0.15` | 背景图不透明度 |
| `imageBlur` | `0` | 背景图模糊 |
| `hasImage` | `false` | 是否已上传图片 |
| `imageMime` | `""` | 图片 MIME |
| `imageVersion` | `0` | 版本号（用于缓存失效） |

### 6.3 背景图上传限制

| 项目 | 限制 |
| --- | --- |
| 大小 | **5 MiB**（`5242880` 字节） |
| `content-length` 上限 | **6 MiB**（超出提前 `413`） |
| 格式 | **PNG / JPEG / WebP**（按**magic bytes 嗅探**，不信任文件名或 `Content-Type`） |
| 不合规响应 | `415 仅支持 PNG / JPEG / WebP 图片` |

### 6.4 自定义 CSS 变量白名单

`cssVars` 只接受白名单内的变量名，且值必须是合法颜色：

```
--background  --foreground  --card  --card-foreground
--popover  --popover-foreground  --primary  --primary-foreground
--secondary  --secondary-foreground  --muted  --muted-foreground
--accent  --accent-foreground  --destructive  --destructive-foreground
--success  --warning  --border  --input  --ring
--sidebar  --sidebar-foreground  --sidebar-primary  --sidebar-primary-foreground
--sidebar-accent  --sidebar-accent-foreground  --sidebar-border  --sidebar-ring
```

颜色接受 `#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA`、CSS 命名色，
以及 `rgb()` / `hsl()` / `oklch()` / `color-mix()` 等函数式写法。
**白名单外或非法值会被静默丢弃**（不会报错）。

### 6.5 公开外观接口

`GET /api/ui/public` **无需登录**，返回 `publicAppearance()` ——
即外观配置但**强制清空 `customCss`**：

```js
{ ...loadUiConfig().appearance, customCss: "" }
```

原因：登录页需先应用主题才能渲染。该端点**不泄漏**其它配置。

---

## 7. 配置文件

WebUI 相关配置位于工作目录的 `config/` 下：

| 文件 | 内容 |
| --- | --- |
| `config/webui.json` | **WebUI 凭据**（`passwordHash` / `passwordSalt` / `mustChangePassword` / TOTP 状态） |
| `config/ui.json` | 外观与页面布局（不存在时自动生成默认值） |
| `config/cert.pem` | TLS 证书（可选） |
| `config/key.pem` | TLS 私钥（可选，权限 `0600`） |
| `config/onebot.json` | OneBot 全局默认配置 |
| `config/onebot_<uin>.json` | 按账号覆盖 |
| `config/snowluma.json` | 全局设置 |

> 写入均为**原子写**（先写 `.tmp` 再 `rename`），避免断电损坏。
> `ui.json` 不可读或损坏时会**回退到默认值**并告警，
> 不会导致服务无法启动。

### 7.1 相关环境变量

| 变量 | 作用 |
| --- | --- |
| `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD` | 预置初始密码（不要求改密） |
| `SNOWLUMA_WEBUI_TRUST_PROXY` | `trustProxy` 行为（见 §8.3） |
| `SNOWLUMA_ACCEPT_EULA` | 预先接受用户协议 |
| `SNOWLUMA_ACCEPT_PRIVACY` | 预先接受隐私政策 |
| `SNOWLUMA_DEV_MODE` | 开发模式：跳过凭据文件与 TOTP |

> 被环境变量锁定的设置项会在 `GET /api/system/settings` 的
> `envOverrides` 中列出，并在 WebUI 中只读。

---

## 8. 安全建议

### 8.1 🔴 最严重：远程任意动作执行

`POST /api/debug/invoke` 等于**以机器人身份执行任意 OneBot 动作**
（发消息、踢人、退群、`bot_exit` 退出进程、`send_packet` 发原始 SSO 包）。

**任何能登录 WebUI 的人都能做到这些，且不要求 TOTP。**

### 8.2 加固清单

| 优先级 | 措施 |
| --- | --- |
| 1 | **不要把 WebUI 暴露到公网**（默认监听 `127.0.0.1`） |
| 2 | 必须远程访问时，置于**反向代理**后 + **IP 白名单** |
| 3 | 在反代层**封禁或限制 `/api/debug/*` 与 `/api/processes/*`** |
| 4 | 启用 **TLS**（`POST /api/system/tls/cert` 上传证书） |
| 5 | 使用**强密码**并启用 TOTP |
| 6 | 谨慎设置 `trustProxy`（见下） |
| 7 | 定期检查日志（所有认证后的写操作都经 `traceAuthenticatedWebuiMutation`） |

### 8.3 `trustProxy` 的陷阱 ⚠️

`trustProxy` 影响登录限流的 IP 判定：

| 取值 | 含义 |
| --- | --- |
| `all` | **信任任意来源**的 `X-Real-IP` / `X-Forwarded-For` |
| `loopback` | 仅当 socket 对端是回环时信任 |
| `ip-list` | 仅当 socket 对端在指定 IP 列表内时信任 |

> 🔴 设为 `all` **且**反向代理**没有剥离**客户端自设的
> `X-Real-IP` / `X-Forwarded-For` 时，攻击者可**伪造 IP 绕过登录限流**。
> 对应环境变量 `SNOWLUMA_WEBUI_TRUST_PROXY=1`，源码对此有明确警告。
>
> 正确做法：只在**确定反代会覆盖**这两个头时才启用。

### 8.4 其他敏感端点

| 端点 | 风险 |
| --- | --- |
| `GET /api/system/backup/export?credentials=1` | 导出含凭据的完整备份 |
| `POST /api/system/backup/import` | 覆盖全部配置 |
| `POST /api/system/storage/cleanup` | 删除存储数据 |
| `GET /api/config/:uin` | 泄漏 OneBot `accessToken` |
| `GET /ui-asset/background` | **无鉴权**，任何人可读取背景图 |
| `GET /api/debug/stream` | 泄漏全部账号事件（含私聊） |

完整清单见 [`webui/api.md` §14](api.md#14-安全敏感端点汇总-)。

---

## 9. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 密码不知道 | 初始密码只在首次启动日志里 | 查启动日志，或删除凭据文件让其重新生成 |
| 几乎所有 API 返回 `403` | **未改初始密码** | 先改密码 |
| API 返回 `403 consentRequired` | 未同意协议 | 在界面同意，或设环境变量 |
| 登录后立刻 `401` | 改密/改 TOTP 吊销了会话 | 重新登录 |
| 登录报 `429` | 触发限流（5 次 / 15 分钟） | 等待，或换 IP |
| 端口不是 5099 | 端口被占用后顺延 | 查 `listeningPort` |
| 写 `/api/*` 返回 `401` | 只带了 Cookie | 改用 `x-snowluma-token` 或 Bearer |
| 头像 401 | `snowluma_avatar_session` 过期 | 调用 `GET /api/status` 刷新 |
| 设置改完没生效 | 多数系统设置需重启 | `restartRequiredToApply: true` |
| 某设置改不动 | 被环境变量锁定 | 查 `envOverrides` |
| 背景图 404 | 尚未设置背景 | 上传后再访问 |
| 界面样式异常 | `ui.json` 损坏已回退默认 | 重新调整外观 |

---

## 10. 声明

| 项目 | 状态 |
| --- | --- |
| 默认端口 5099、端口顺延 50 次 | **已核实**：`initWebUI` + `port.ts` |
| 两级门禁白名单 | **已核实**：源码常量集合 |
| 登录限流 5 次 / 15 分钟、令牌 24h | **已核实**：源码常量 |
| TOTP 仅登录校验、无端点级二次验证 | **已核实**：源码无相关中间件 |
| 5 个导航路由、总览区块、日志默认值 | **已核实**：`ui-config.ts` 默认值 |
| 背景图 5 MiB / PNG-JPEG-WebP 嗅探 | **已核实**：`ui-config.ts` 源码 |
| CSS 变量白名单（29 项） | **已核实**：`CSS_VAR_WHITELIST` |
| `/api/ui/public` 免登录且清空 customCss | **已核实**：源码 + 实测 `200` |
| 实测环境（5199→5099、`0.0.0.0`） | **已核实**：`GET /api/system/settings` |
| 各页面的**视觉布局 / 交互细节** | **未核实**：源码中不含前端组件代码，本文只描述路由与配置 |

> **未核实项**：本文描述的是**后端提供的路由与配置结构**。
> 前端的实际渲染、按钮位置、交互流程由 `client/` 静态资源决定，
> 不在本次源码还原范围内，因此未作描述。
