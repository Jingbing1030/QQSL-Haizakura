# 完整配置说明

> **本章是文档的核心。** 所有字段、类型、默认值、取值范围均**从源码提取**
> （`packages/onebot/src/config.ts` 等），并标注了来源文件与行号。
>
> ⚠️ 本文**不包含任何真实令牌、密码或 QQ 号**。

---

## 0. 配置体系总览

### 0.1 六个配置文件

| 文件 | 路径 | 权限 | 作用域 | 源码 |
| --- | --- | --- | --- | --- |
| `onebot.json` | `config/onebot.json` | `644` | 全局（被所有账号继承） | `onebot/src/config.ts:17` |
| `onebot_<uin>.json` | `config/onebot_<uin>.json` | `600` | **每账号** | `onebot/src/config.ts:82` |
| `runtime.json` | `config/runtime.json` | — | 全局运行时 | `common/src/runtime.ts:193` |
| `snowluma.json` | `config/snowluma.json` | — | 全局设置 | `onebot/src/global-config.ts:14` |
| `notifications.json` | `config/notifications.json` | `600` | 通知渠道 | `core/src/notifications/config.ts:8` |
| `webui.json` | `config/webui.json` | `600` | WebUI 凭据 | `core/src/webui/auth.ts` |

> 路径都是**相对于工作目录**的。容器里的工作目录是 `/app/data`，
> 所以实际位置是 `/app/data/config/*.json`。

### 0.2 OneBot 配置的合并优先级 ★

【确证】`loadOneBotConfig()`（`config.ts:80-93`）：

```
读 config/onebot.json       （全局）
读 config/onebot_<uin>.json （每账号）

若 per-uin 的 mode === "snapshot"：
    → 【忽略全局】per-uin 独占
否则：
    → 全局先入，per-uin 后入 → 同名字段 per-uin 覆盖（last-write-wins）
```

**两种模式**：

| `mode` 值 | 含义 | 何时产生 |
| --- | --- | --- |
| `"overlay"` | 在全局基础上**叠加** | 未指定 `mode` 时，若有全局配置 |
| `"snapshot"` | **完整快照，不继承全局** | 显式写 `"mode": "snapshot"` |

> 💡 **实践建议**：如果只有单账号，把配置写在 `onebot_<uin>.json` 并**不写 `mode`**
> 或写 `"overlay"`，这样全局改动也能生效。
> 如果写了 `"snapshot"`，**全局文件对它就完全无效了** —— 这是常见的"改了配置不生效"的原因。

### 0.3 适配器按名字合并（不是按数组下标）

【确证】`collectByName()`（`config.ts:648-670`）：

- 每个适配器用 **`name`** 作为唯一键跨所有来源合并
- **后面的来源覆盖同名适配器**（整体覆盖，不是字段级合并）
- 没有 `name` 的会自动命名：`http-N` / `ws-N` / `httppost-N` / `wsclient-N`
- **4 类适配器共用同一个命名空间** —— 名字全局唯一，不能 `httpServers` 和 `wsServers` 各有一个 `default`

### 0.4 兼容旧版布局

【确证】为兼容老配置，支持把网络适配器写在**顶层**（不在 `networks` 里）：

```jsonc
// 旧写法（仍支持，会自动迁移）
{ "httpServers": [...], "wsServers": [...], "messageFormat": "array" }

// 新写法（推荐）
{ "networks": { "httpServers": [...], "wsServers": [...] } }
```

`httpPostEndpoints`（旧名）会被读作 `httpClients`。
顶层遗留的 `messageFormat` / `reportSelfMessage` 会作为**所有适配器的默认值**。

---

## 1. `networks` —— 网络适配器

四种适配器，**共 37 个字段**。

### 1.1 公共基础字段（5 个，所有适配器都有）

【确证】`RESTORE_BASE_ADAPTER_KEYS`（`config.ts:183-189`）

| 字段 | 类型 | 默认 | 约束与说明 |
| --- | --- | --- | --- |
| `name` | `string` | 自动生成 | **非空**、**不能有首尾空白**、**4 类全局限定唯一** |
| `enabled` | `boolean` | `true` | 省略 = 启用。写 `false` 可**保留配置但不监听** |
| `accessToken` | `string` | **随机 32 字节 base64url** | 见 §1.6 令牌策略 |
| `messageFormat` | `"array"` \| `"string"` | `"array"` | `"string"` = **CQ 码模式** |
| `reportSelfMessage` | `boolean` | `false` | 是否上报**自己发的**消息 |

**`messageFormat` 说明**：

| 值 | 消息格式 | 适用 |
| --- | --- | --- |
| `"array"`（默认） | 消息段数组 `[{"type":"text","data":{"text":"hi"}}]` | 现代框架（NoneBot2、Koishi） |
| `"string"` | CQ 码字符串 `"hi[Cat:face,id=1]"` | 老框架（CQHTTP 时代） |

**`reportSelfMessage` 说明**：

- `false`：只上报**别人**发的消息
- `true`：**自己**通过 API 发出的消息也会作为事件上报

### 1.2 `httpServers` —— HTTP 服务端（+6 = **11 字段**）

【确证】`validateRestoreAdapterArray` + `parseHttpServer`（`config.ts:689-704`）

| 字段 | 类型 | 默认 | 约束 |
| --- | --- | --- | --- |
| *(5 个公共字段)* | — | — | 见 §1.1 |
| `host` | `string` | **`0.0.0.0`** | TCP 绑定地址，非空、无首尾空白、DNS 标签或 IPv4/IPv6 |
| `port` | `integer` | **必填** | **1–65535**。**≤0 会让整个适配器被丢弃** |
| `path` | `string` | `"/"` | 必须以 `/` 开头；**不能含 `?` 或 `#`**；必须是规范化的 URL pathname |
| `enableWebSocket` | `boolean` | `false` | 在**同一个端口**上同时提供 WS 升级 |
| `enableSse` | `boolean` | `false` | 提供 SSE 事件流 |
| `maxPayloadBytes` | `integer` | 无上限 | **1024 ~ 2147483648**（2 GiB） |

**用途**：你主动用 HTTP 请求调用 API；`enableSse` 后可长连接收事件。

> 💡 `path` 的「必须规范化」含义：`new URL('http://127.0.0.1' + path).pathname === path`。
> 所以 `/api/` ✅、`//api` ❌、`/api?x=1` ❌、`/api#f` ❌。

> ### ⚠️ `host` 的「两个默认值」不是一回事（安全相关）
>
> 这里有个**容易踩的安全坑**，必须分清楚：
>
> | 场景 | `host` 实际值 | 源码依据 |
> | --- | --- | --- |
> | **全新安装**（生成工厂默认配置） | **`127.0.0.1`** | `makeDefaultOneBotConfig()`，`config.ts:42` / `:54` |
> | **你自己的配置里省略 `host`** | **`0.0.0.0`** ← ⚠️ **对外监听** | `asString$1(value.host, "0.0.0.0")`，`config.ts:697` / `:723` |
> | **存盘时省略 `host`** | `0.0.0.0` | `n.host ?? "0.0.0.0"`，`config.ts:529` / `:546` |
>
> **含义**：
>
> - 全新安装时它**只监听本机**（安全）✅
> - 但**你手写适配器时不写 `host`，它会监听所有网卡**（暴露）⚠️
> - **容器场景**：entrypoint 会**主动**把 loopback 的 `host` 改成
>   `SNOWLUMA_ONEBOT_HOST`（默认 `0.0.0.0`）—— 否则映射的宿主机端口连不上
>
> **结论**：**永远显式写 `host`**。
> 只想本机用就写 `"127.0.0.1"`；要对外就写 `"0.0.0.0"` 并**务必配强令牌**。

### 1.3 `wsServers` —— 正向 WebSocket（+5 = **10 字段**）

【确证】`parseWsServer`（`config.ts:717-729`）

| 字段 | 类型 | 默认 | 约束 |
| --- | --- | --- | --- |
| *(5 个公共字段)* | — | — | 见 §1.1 |
| `host` | `string` | **`0.0.0.0`** | 同 `httpServers` |
| `port` | `integer` | **必填** | 1–65535 |
| `path` | `string` | `"/"` | 同 `httpServers` |
| `role` | `"Api"` \| `"Event"` \| `"Universal"` | **`"Universal"`** | 见 §1.5 |
| `maxPayloadBytes` | `integer` | 无上限 | 1024 ~ 2 GiB |

**用途**：Haizakura 当 WS 服务端，你的程序连它。**双向**（调 API + 收事件）。

### 1.4 `httpClients` —— HTTP 上报 / Webhook（+2 = **7 字段**）

【确证】`parseHttpClient`（`config.ts:705-716`）

| 字段 | 类型 | 默认 | 约束 |
| --- | --- | --- | --- |
| *(5 个公共字段)* | — | — | 见 §1.1 |
| `url` | `string` | **必填** | 必须是**绝对 URL**，协议限 `http:` / `https:` |
| `timeoutMs` | `integer` | 无（用底层默认） | **1 ~ 2147483647** |

⚠️ **`httpClients` 不接受 `maxPayloadBytes`** —— 写了会直接报错：

```
networks.httpClients[0].maxPayloadBytes is only supported by WebSocket adapters
```

**`url` 必填但可以禁用**：若 `enabled: false`，`url` 可为空。

**用途**：Haizakura 把事件 **POST 到你的地址**。**只推事件，不能调 API**。

### 1.5 `wsClients` —— 反向 WebSocket（+4 = **9 字段**）

【确证】`parseWsClient`（`config.ts:730-743`）

| 字段 | 类型 | 默认 | 约束 |
| --- | --- | --- | --- |
| *(5 个公共字段)* | — | — | 见 §1.1 |
| `url` | `string` | **必填** | 绝对 URL，协议限 `ws:` / `wss:` |
| `role` | `"Api"` \| `"Event"` \| `"Universal"` | `"Universal"` | 见下 |
| `reconnectIntervalMs` | `integer` | **`5000`** | **1000 ~ 2147483647**（≥1 秒） |
| `maxPayloadBytes` | `integer` | 无上限 | 1024 ~ 2 GiB |

**用途**：**你先起 WS 服务端**，Haizakura 主动连你。**双向**。

> 💡 反向 WS 是**内网穿透场景的救星**：Haizakura 在云上，你的 bot 在家里，
> 由 Haizakura 主动连出去，不需要开放入站端口。

**`role` 语义**（【确证】`validateRole`，`config.ts:459-461`）：

| 值 | 含义 |
| --- | --- |
| `"Api"` | 只用于**调用 API**（不推事件） |
| `"Event"` | 只用于**接收事件**（不接 API 调用） |
| `"Universal"` | **两者都支持**（默认，推荐） |

> **大小写不敏感**：`parseWsServer` 用 `asRole()` 做 `.toLowerCase()` 归一化，
> 写 `"api"` / `"universal"` 也行，存盘时统一成 `Api` / `Event` / `Universal`。

### 1.6 令牌策略（重要安全机制）

【确证】`core/src/webui/onebot-token-policy.ts`

**入站适配器**（`httpServers` / `wsServers`）的令牌受额外限制：

| 规则 | 说明 |
| --- | --- |
| **非本机 IP 保存时不许留空** | 远程通过 WebUI 保存时，若 `host` 不是 loopback，**令牌必填**，否则报错 |
| **令牌 ≥ 16 字符** | 少于 16 字符报 `too-short` |
| **不能"容易被猜中"** | 会拿令牌和 `uin` / `name` / 类型 / `host` / `port` 做比较，命中则拒绝 |
| **本机保存可留空** | 从 loopback 访问且 `host` 是 loopback 时允许空令牌 |

报错原文示例：

```
节点“http-default”未绑定本机地址，远程保存必须填写令牌；请生成令牌或将主机改为 127.0.0.1。
节点“http-default”的令牌至少需要 16 个字符；请重新生成或继续补充。
节点“http-default”的令牌容易被猜中；请重新生成随机令牌。
```

**客户端认证方式**【确证】`onebot/src/network/utils.ts:21`：

```
Authorization: Bearer <token>     ← 标准写法
Authorization: <token>            ← 也接受裸令牌
```

> 🔒 **安全建议**：默认生成的 32 字节 base64url 令牌**已经足够强**，
> 不要为了方便改成 `123456`。WebUI 有「生成令牌」按钮。

### 1.7 端口冲突校验

【确证】`validateServerBinding`（`config.ts:430-446`）

| 规则 | 说明 |
| --- | --- |
| 精确查重 | `host:port` 不能重复 |
| 通配查重 | `0.0.0.0` / `::` / `[::]` 视为通配，**同端口只能有一个监听** |
| 通配 vs 具体 | `0.0.0.0:3000` 与 `127.0.0.1:3000` **冲突** |
| 跳过禁用 | `enabled: false` 的适配器不参与查重 |

报错原文：

```
networks.httpServers[1] conflicts with networks.wsServers[0] on wildcard server port 3000
```

---

## 2. `statusCommand` —— 状态指令

【确证】`DEFAULT_STATUS_COMMAND`（`config.ts:26-31`），**4 个字段**。

| 字段 | 类型 | 默认 | 约束 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | **`true`** | 是否启用 |
| `swallow` | `boolean` | `false` | 是否**吞掉**触发消息（不产生消息事件） |
| `cooldownSeconds` | `integer` | **`5`** | **0 ~ 31536000**（365 天）。**≤0 = 关闭冷却** |
| `trigger` | `string` | **`"#Haizakura"`** | 非空、**单行**（禁 `\r\n`）、**≤32 字符** |

> 📌 **改名说明**：本名 SnowLuma 时默认触发词是 **`#sl`**；
> 现名 Haizakura，默认改为 **`#Haizakura`**。
> **【实测】线上实例被手动改成了 `#hz`。**

### 2.1 匹配语义 ★

【确证】`matchesStatusCommand`（`packages/onebot/src/modules/status-command.ts`）：

```javascript
function normalize(s) { return s.trim().toLowerCase(); }

// 字符串消息：精确相等
if (typeof message === "string") return normalize(message) === normalize(trigger);

// 数组消息：必须【只有一段】且是 text
if (!Array.isArray(message) || message.length !== 1) return false;
const seg = message[0];
if (seg.type !== "text") return false;
return normalize(seg.data.text) === normalize(trigger);
```

| 特性 | 行为 |
| --- | --- |
| 大小写 | **不敏感**（`#HAIZAKURA` 也能触发） |
| 前后空格 | **自动 trim**（`" #hz "` 也能触发） |
| 匹配方式 | **精确相等**，**不是包含**（`"你好 #hz"` ❌ 不触发） |
| 混合消息 | **❌ 不触发**（`#hz` + 一张图片 = 两段 = 不匹配） |
| 长度上限 | `trigger` ≤ **32** 字符 |

> ⚠️ 「必须只有一段」这一条最容易踩坑：
> 很多客户端发文本时会附带一个空的 `text` 段或表情段，导致段数 > 1。
> **如果状态指令不响应，先检查消息是不是纯文本单段。**

### 2.2 冷却机制

【确证】`statusCooldownElapsed()`：

```javascript
if (lastRepliedAtMs === undefined) return true;   // 从没回过
if (cooldownSeconds <= 0) return true;            // 冷却关闭
return nowMs - lastRepliedAtMs >= cooldownSeconds * 1000;
```

> 冷却**按账号**记录（每个实例一个「上次回复时间」）。

### 2.3 回复文案

【确证】`buildStatusText()`：

```
Haizakura 状态
版本: 2.4.0
平台: linux-x64
运行时长: 3天 2小时 15分钟
```

运行时长格式化规则（`formatUptime`，中文）：

| 条件 | 输出格式 |
| --- | --- |
| ≥ 1 天 | `X天 Y小时 Z分钟` |
| ≥ 1 小时 | `X小时 Y分钟` |
| ≥ 1 分钟 | `X分钟 Y秒` |
| < 1 分钟 | `X秒` |

---

## 3. `historySync` —— 登录历史回填

【确证】`parseHistorySync`（`config.ts:595-606`），**只有 1 个字段**。

| 字段 | 类型 | 默认 | 约束 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | **`false`** | 开启后登录时自动回填历史消息 |

### 3.1 生效时机 ⚠️

【确证】`instance.ts:82`：`this.historySyncEnabledAtStartup = config.historySync.enabled;`

**该值在实例启动时读取一次**，之后改配置**不会热生效**。

> ⚠️ **这意味着改 `historySync.enabled` 需要重启 —— 而重启会丢 QQ 登录态**
> （见 [登录说明 §5](login.md)）。请权衡。

### 3.2 回填的硬限制

【确证】`LOGIN_HISTORY_SYNC_LIMITS`（`onebot/src/history-sync.ts:14-21`）
+ `LOGIN_HISTORY_SYNC_PROTOCOL_LIMITS`（`core/src/bridge/apis/message.ts:10247-10251`）：

| 参数 | 值 | 含义 |
| --- | ---: | --- |
| `startupDelayMs` | **30000** | 登录后等 30 秒才开始 |
| `maxGroups` | **3** | 最多回填 **3** 个群 |
| `maxPrivateUsers` | **3** | 最多回填 **3** 个私聊 |
| `messagesPerSession` | **20** | 每个会话最多 **20** 条 |
| `maxTargetsPerKind`（= `READ_REPORT_BATCH_SIZE`） | **100** | 目标列表扫描上限 |
| `minimumGapMs` | **2000** | 每次请求间隔 ≥ 2 秒 |

> 📌 **所以 `historySync` 不是"把全部历史同步过来"** ——
> 它是**登录后小批量的回填**（最多 3 群 + 3 私聊 × 20 条）。
> 别指望它能拉全量历史。这是**设计限制**，不是 bug。

回填目标超限时日志会警告：

```
login history sync roster truncated: UIN=... groups=100/250 private=100/180
```

---

## 4. `notifications` —— 通知渠道引用

【确证】`parseNotifications`（`config.ts:611-619`），**只有 1 个字段**。

| 字段 | 类型 | 默认 | 约束 |
| --- | --- | --- | --- |
| `channelIds` | `string[]` | `[]` | 每项是一个**渠道 ID（slug）** |

**slug 规则**（`normalizeChannelIds`）：`^[\w.-]+$`、非空、**≤64 字符**、自动去重。

> ⚠️ **这里填的是「渠道 ID」，不是 URL！**
> 实际的 webhook URL / SMTP 配置在 `notifications.json` 里（见 §6）。
> `channelIds` 只是**选择启用哪些渠道**。
>
> 填一个不存在的 ID 不会报错，只是**不会发通知**。

---

## 5. `runtime.json` —— 运行时配置

【确证】`normalizeRuntimeConfig`（`common/src/runtime.ts`），**8 个字段 + 1 个可选**。

| 字段 | 类型 | 默认 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `webuiPort` | `integer` | **`5099`** | 1–65535 | WebUI 端口 |
| `webuiHost` | `string` | **`127.0.0.1`** | 非空 | WebUI 绑定地址。`0.0.0.0` = 对外暴露 |
| `hookAutoLoad` | `boolean` | **`false`** | — | 启动时自动注入 hook |
| `webuiTls.enabled` | `boolean` | `false` | — | WebUI 是否用 TLS |
| `trustProxy` | `string` | `""` | — | 反向代理信任配置，影响客户端 IP 判定 |
| `logMaxTotalMb` | `integer` | **`1024`** | ≥1 | 日志总占用上限（MB） |
| `logRetainDays` | `integer` | **`7`** | ≥0 | 日志保留天数 |
| `logPerUin` | `boolean` | `false` | — | 日志是否按账号分文件 |
| `updateSource` | `object` | 见 §5.1 | 可选 | 更新源配置 |

> ⚠️ **`runtime.json` 的多数字段是启动时读取的。**
> WebUI 修改会写盘，但**部分字段需要重启才生效**（而重启会丢登录态）。
> 【待确认】具体哪些字段支持热生效，未逐一验证。

### 5.1 `updateSource` —— 更新源 ★ 接手必改

【确证】`common/src/update-source.ts` + `core/src/update/sources.ts`

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `mode` | `"auto"` \| `"direct"` \| `"mirror"` | ✅ | 缺失或非法值直接抛错 |
| `mirror` | `string` | `mode:"mirror"` 时必填 | HTTP(S) URL，**禁账号/密码/query/fragment**，≤2048 字符 |
| `mirrors` | `string[]` | ✅ | **≤16 项**，自动去重 |

**三种模式**（【确证】`sourceUrls()`）：

| `mode` | 行为 |
| --- | --- |
| `"direct"` | **只**用官方地址 |
| `"mirror"` | **只**用 `mirror` 指定地址 |
| `"auto"` | 官方地址 **+** 所有 `mirrors`（依次尝试） |

**默认 `mirrors`（10 个）**：

```
https://ghfast.top
https://ghproxy.net
https://gh-proxy.com
https://github.chenc.dev
https://fastgit.cc
https://gh.noki.icu
https://cors.isteed.cc
https://gh-proxy.org
https://githubproxy.gohj99.site
https://github.xxlab.tech
```

### ⚠️🚨 `RELEASE_ROOT` 已失效 —— 接手第一必改项

```javascript
var RELEASE_ROOT = "https://github.com/SnowLuma/SnowLuma/releases";
```

**上游仓库 `SnowLuma/SnowLuma` 已被删除 → 该地址必然 404。**

**后果**：

- 自动更新**永远失败**
- 如果配置了 `SNOWLUMA_UPDATE_CHECK`，会**持续报错**
- 所有镜像都是「代理 GitHub」的，源没了镜像也没用

**必须做的**：

```jsonc
// config/runtime.json
{
  "updateSource": {
    "mode": "direct",              // 或 mirror
    "mirror": "https://<你的发布地址>",
    "mirrors": ["https://<你的发布地址>"]
  }
}
```

**或直接关掉更新检查**：不设 `SNOWLUMA_UPDATE_CHECK`。
【待确认】完全禁用更新检查的官方方式 —— 建议同时把 `updateSource.mode` 指向你自己的发布点。

> 💡 源码里 `readUpdateSource()` 读的是 `readRuntimeConfig().updateSource`，
> 找不到时用 `DEFAULT_UPDATE_SOURCE`。WebUI 有 `/api/update/check`
> 与 `GET/POST /sources`、`POST /sources/test` 可测试源可用性。

---

## 6. `snowluma.json` —— 全局设置

【确证】`normalizeGlobalSettings`（`onebot/src/global-config.ts`），**3 个字段**。

| 字段 | 类型 | 默认 | 约束 |
| --- | --- | --- | --- |
| `rkey.fallbackServers` | `string[]` | `[]` | 每项必须是 http(s) URL 且有 host；自动去重 |
| `musicSignUrl` | `string` | `""` | 空，或合法的 http(s) URL |
| `videoUploadConcurrency` | `integer` | **`1`** | **1 ~ 4** |

**说明**：

| 字段 | 用途 |
| --- | --- |
| `rkey.fallbackServers` | **rkey 备用服务器**。rkey 是媒体下载密钥，主源失败时用这些 |
| `musicSignUrl` | 音乐签名地址（QQ 音乐卡片等） |
| `videoUploadConcurrency` | 视频上传并发数（NT QQ highway 上传） |

> 📌 **`musicSignUrl` 的历史**：它**原本在每账号配置里**，
> 现在迁移到全局。源码有一次性搬运逻辑（`migrateGlobalSettings`）：
> 若全局没有该键，会从 `onebot*.json` 里找第一个非空值搬过来。
> **幂等** —— 全局一旦有值就不再搬。

**保存是「按节合并」的**（`saveGlobalSettings`）：只覆盖 `incoming` 里
**实际出现的顶层节**，所以只存 `rkey` 不会清掉 `musicSignUrl`。

---

## 7. `notifications.json` —— 通知渠道

【确证】`core/src/notifications/config.ts`

### 7.1 顶层

| 字段 | 类型 | 默认 | 约束 |
| --- | --- | --- | --- |
| `version` | `integer` | `1` | 固定为 1 |
| `debounceSeconds` | `integer` | **`30`** | **0 ~ 3600** |
| `channels` | `object[]` | `[]` | 渠道定义数组 |

> `debounceSeconds` = 掉线通知的**防抖窗口**。
> 短时间反复上下线只通知一次。

### 7.2 渠道公共字段

| 字段 | 类型 | 默认 | 约束 |
| --- | --- | --- | --- |
| `id` | `string` | **必填** | slug：`^[\w.-]+$`、≤64；**重复 ID 会被丢弃** |
| `name` | `string` | 同 `id` | ≤128 |
| `type` | `"webhook"` \| `"email"` | `"webhook"` | 空/未填视为 `webhook`；其他值**整条丢弃** |
| `enabled` | `boolean` | `true` | — |
| `bodyTemplate` | `string` | 见 §7.5 | ≤**8192** 字符 |

### 7.3 webhook 类型

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `url` | `string` | **必须是合法 http(s) URL**，否则**整条丢弃** |
| `headers` | `object` | **≤16 个**；名 ≤128 且匹配 `^[!#$%&'*+.^\`\|~0-9A-Za-z-]+$`；值 ≤1024；**禁 CR/LF**；名**大小写不敏感去重** |

### 7.4 email 类型

| 字段 | 类型 | 默认 | 约束 |
| --- | --- | --- | --- |
| `smtpHost` | `string` | **必填** | ≤253；**禁空白、`/`、`://`** |
| `smtpPort` | `integer` | 见下 | 1–65535 |
| `smtpSecure` | `boolean` | 见下 | — |
| `smtpUser` | `string` | `""` | ≤256 |
| `smtpPass` | `string` | `""` | ≤256 |
| `from` | `string` | **必填** | ≤1024，必须是合法邮箱地址 |
| `to` | `string` | **必填** | ≤1024，多个收件人**逗号分隔** |
| `subjectTemplate` | `string` | `账号{event}：{nickname} ({uin})` | ≤256 |

**`smtpPort` / `smtpSecure` 的推导逻辑**（【确证】）：

```
若显式给了 smtpPort：
    用它
否则：
    若 smtpSecure 为 true → 465
    否则                  → 587
```

> ⚠️ `smtpHost` / `from` / `to` **任一缺失或非法 → 整条渠道被丢弃**（静默）。

### 7.5 模板变量与默认模板

**7 个可用变量**【确证】`notifications/manager.ts:112-120`：

| 变量 | 含义 | 示例 |
| --- | --- | --- |
| `{uin}` | QQ 号 | `123456789` |
| `{nickname}` | 昵称 | `我的机器人` |
| `{event}` | 事件类型 | **`online`** 或 **`offline`** |
| `{time}` | ISO 时间 | `2026-11-13T02:15:30.000Z` |
| `{status}` | 进程状态 | `connected` / `disconnected` |
| `{pid}` | 进程号 | `79` |
| `{error}` | 错误信息 | 通常为空 |

> 【确证】`event` 的取值**只有 `online` 和 `offline`** 两种
> （`notifications/debounce.ts` 里的状态机）。

**默认 webhook 模板**（`common/src/notification-templates.ts`）：

```json
{
  "title": "账号状态通知：{event}",
  "desp": "您的账号状态发生了改变。\n\n**昵称**：{nickname}\n**QQ号**：{uin}\n**当前状态**：{event}\n**进程状态**：{status}\n**时间**：{time}"
}
```

**默认邮件模板**：

```
账号状态发生了改变。

昵称：{nickname}
QQ号：{uin}
当前状态：{event}
进程状态：{status}
时间：{time}
```

**模板渲染规则**（【确证】`renderTemplate`）：

| 规则 | 说明 |
| --- | --- |
| 未知占位符 | **原样保留**（不会变空） |
| 模板是合法 JSON | 变量值会做 **JSON 转义**（去掉外层引号） |
| 模板不是 JSON | 直接字符串替换 |

> 💡 **webhook 默认模板是 JSON**（适配 OneBot 通知格式）——
> 所以如果把 `bodyTemplate` 改成非 JSON 文本，接收端就没法当 JSON 解析了。

**测试通知**：`POST /api/notifications/test`（WebUI 里有按钮）。

---

## 8. 环境变量全表（36 个）

【确证】`grep -oE 'SNOWLUMA_[A-Z0-9_]+' | sort -u` → **36 个**。

> ⚠️ **环境变量优先级高于 `runtime.json`**（对同名项）。
> 源码注释说明这是为「可信启动器（如桌面版）按次固定」设计的。
> 且 `updateRuntimeConfig` **只把补丁写到磁盘值上，不会把 env 值烤进文件**。

### 8.1 WebUI 相关（7 个）

| 变量 | 覆盖 | 说明 |
| --- | --- | --- |
| `SNOWLUMA_WEBUI_PORT` | `webuiPort` | 1–65535 |
| `SNOWLUMA_WEBUI_HOST` | `webuiHost` | 非空字符串 |
| `SNOWLUMA_WEBUI_TLS` | `webuiTls.enabled` | 布尔 |
| `SNOWLUMA_WEBUI_TRUST_PROXY` | `trustProxy` | 字符串 |
| `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD` | — | **首次注入 WebUI 密码，要求 ≥8 字符** |
| `SNOWLUMA_WEBUI_TARGET` | — | UI 主题预置，**唯一合法值 `maibot`** |
| `SNOWLUMA_DEV_WEBUI` | — | 开发模式 WebUI |

### 8.2 OneBot 相关（2 个）

| 变量 | 说明 |
| --- | --- |
| `SNOWLUMA_ONEBOT_HTTP_PORT` | 覆盖 **名为 `http-default`** 的监听端口（1–65535） |
| `SNOWLUMA_ONEBOT_WS_PORT` | 覆盖 **名为 `ws-default`** 的监听端口 |

> ⚠️ **只覆盖「工厂默认监听器」** —— 即名字恰好是 `http-default` / `ws-default` 的。
> 你自己改名或新增的适配器**不受影响**。
> 找不到该名字时日志警告：`SNOWLUMA_ONEBOT_HTTP_PORT is ignored; no http-default listener`。
> 覆盖后若配置校验失败，**整个覆盖被忽略**并警告。

### 8.3 hook / 注入（4 个）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SNOWLUMA_HOOK_AUTOLOAD` | — | 覆盖 `runtime.json` 的 `hookAutoLoad` |
| `SNOWLUMA_HOOK_AUTOLOAD_ALL` | — | **`=1` 时放行所有 PID 自动注入，绕过 zygote 过滤**（⚠️ 危险，见下） |
| `SNOWLUMA_HOOK_RUNTIME_DIR` | `/tmp/runtime-<uid>` | socket 目录 |
| `SNOWLUMA_HOOK_ACK_TIMEOUT_MS` | `5000` | 控制通道 ACK 超时 |

> ⚠️ **`SNOWLUMA_HOOK_AUTOLOAD_ALL=1` 是危险选项。**
> 正常流程会**过滤掉 Electron 的 zygote / 子进程**，只注入主进程。
> 开启它会注入 zygote —— 之后 Electron fork 的**每个 renderer 都会继承
> 那个线程和半初始化的 hook 状态**，直接**搞坏 QQ 的 IPC 和登录界面**。
> **除非你在排查问题，否则不要开。**

### 8.4 超时 / 包（3 个）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SNOWLUMA_PACKET_TIMEOUT_MS` | — | 业务请求（包）超时 |
| `SNOWLUMA_SESSION_RELEASE_DEADLINE_MS` | **`10000`** | 会话释放截止。源码注释：「Ten seconds covers a normal drain」 |
| `SNOWLUMA_DOWNLOAD_FILE_TIMEOUT_MS` | — | `download_file` 动作超时 |

### 8.5 下载 / 流式（4 个）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SNOWLUMA_STREAM_DIR` | `$TMPDIR/onebot-stream` | 流式下载落地目录；**非法时警告并回退默认** |
| `SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES` | — | 二进制下载大小上限 |
| `SNOWLUMA_HTTP_DOWNLOAD_TIMEOUT_MS` | **`60000`** | HTTP 媒体下载超时（单次尝试） |
| `SNOWLUMA_NOTIFICATION_HTTP_TIMEOUT_MS` | — | 通知 webhook 超时 |

### 8.6 日志（9 个）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SNOWLUMA_LOG_DIR` | `logs` | 日志目录 |
| `SNOWLUMA_LOG_FILE` | — | **`=0` 关闭文件日志** |
| `SNOWLUMA_LOG_LEVEL` | **`info`** | 控制台级别 |
| `SNOWLUMA_LOG_FILE_LEVEL` | **`debug`** | 文件级别 |
| `SNOWLUMA_LOG_MAX_MB` | **`50`** | **单文件**上限（MB） |
| `SNOWLUMA_LOG_MAX_TOTAL_MB` | **`1024`** | 总量上限（MB） |
| `SNOWLUMA_LOG_RETAIN_DAYS` | **`7`** | 保留天数 |
| `SNOWLUMA_LOG_PER_UIN` | `false` | 按账号分文件 |
| `SNOWLUMA_TRACE_BUFFER` | — | 追踪缓冲条数 |

**合法日志级别**（【确证】`logger.ts:229-236`）：

```
trace  debug  info  success  warn  error
```

> ⚠️ **文件日志级别不接受 `trace`** —— 只有
> `debug` / `info` / `success` / `warn` / `error`。
> 传 `trace` 会抛错：`SNOWLUMA_LOG_FILE_LEVEL must be one of: ...`

**日志文件命名**（【确证】`log-file-transport.ts:127-130`）：

```
snowluma-YYYY-MM-DD.log        当天
snowluma-YYYY-MM-DD.N.log      滚动（N 为序号）
按账号模式：snowluma-<uin>/…    （目录名为纯数字）
```

### 8.7 更新 / 其他（7 个）

| 变量 | 说明 |
| --- | --- |
| `SNOWLUMA_UPDATE_ROOT` | **更新根目录**（开发/测试更新流程用） |
| `SNOWLUMA_UPDATE_CHECK` | 是否检查更新 |
| `SNOWLUMA_VERBOSE_WARMUP` | `=1` 打印预热细节 |
| `SNOWLUMA_DEV_MODE` | `=1` 开发模式（**`=1` 时禁用 WebUI 改密码**） |
| `SNOWLUMA_DEV_NO_NATIVE` | `=1` 用 stub 替代原生 addon |
| `SNOWLUMA_ACCEPT_EULA` | 非交互接受 EULA |
| `SNOWLUMA_ACCEPT_PRIVACY` | 非交互接受隐私政策 |

> ⚠️ **`SNOWLUMA_DEV_MODE=1` 的副作用**（【确证】`auth.ts:245`）：
> 抛错「开发模式 (SNOWLUMA_DEV_MODE=1) 已禁用密码修改」。
> **生产环境绝对不要设。**

### 8.8 容器 entrypoint 专用（8 个，**非源码验证**）

以下变量由**容器入口脚本**消费，**不在 bundle 里**。
来源为容器内 `/root/start.sh`（368 行）—— **未经源码级验证**。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SNOWLUMA_ONEBOT_HOST` | `0.0.0.0` | 播种 `onebot.json` 时的 host（**只覆盖 loopback 的适配器**） |
| `SNOWLUMA_DATA` | `/app/data` | 数据根目录 |
| `SNOWLUMA_HOME` | `/app/runtime` | 运行时根目录 |
| `SNOWLUMA_UID` / `SNOWLUMA_GID` | `1000` / `1000` | `snowluma` 用户 uid/gid |
| `SNOWLUMA_SCREEN` | `1920x1080x24` | Xvfb 分辨率 |
| `SNOWLUMA_EXTRA_QQ_HOMES` | 空 | 额外 QQ 实例的 HOME（逗号分隔，**须在 `/app/` 下**） |
| `SNOWLUMA_QQ_FLAGS` | `--disable-gpu --disable-software-rasterizer --disable-gpu-compositing` | 传给 QQ 的参数 |
| `VNC_PASSWD` | 空（随机生成） | VNC 密码；默认值 `vncpasswd` 视为未设置 |

> 💡 **`SNOWLUMA_LOG_LEVEL` 与 `SNOWLUMA_HOOK_AUTOLOAD` 两个变量同时被
> entrypoint 和应用读取** —— entrypoint 把它们 `export` 给 supervisor，
> 再传给应用进程。所以它们既是「容器变量」也是「应用变量」。

---

## 9. 可直接复制的完整配置

### 9.1 最简：本机单 HTTP + 单 WS

适合**只在本机对接框架**（最安全）。

`config/onebot.json`：

```json
{
  "networks": {
    "httpServers": [
      {
        "name": "http-default",
        "host": "127.0.0.1",
        "port": 3000,
        "path": "/",
        "enableWebSocket": false,
        "enableSse": false,
        "accessToken": "<your-token-at-least-16-chars>",
        "messageFormat": "array",
        "reportSelfMessage": false
      }
    ],
    "wsServers": [
      {
        "name": "ws-default",
        "host": "127.0.0.1",
        "port": 3001,
        "path": "/",
        "role": "Universal",
        "accessToken": "<your-token-at-least-16-chars>",
        "messageFormat": "array",
        "reportSelfMessage": false
      }
    ],
    "httpClients": [],
    "wsClients": []
  }
}
```

### 9.2 生产：对外监听 + 强令牌 + 反代 + 状态指令 + 通知

`config/onebot_<uin>.json`（**注意 `mode`**）：

```json
{
  "mode": "overlay",
  "networks": {
    "httpServers": [
      {
        "name": "http-main",
        "enabled": true,
        "host": "0.0.0.0",
        "port": 3000,
        "path": "/",
        "enableWebSocket": false,
        "enableSse": true,
        "accessToken": "<your-strong-random-token>",
        "messageFormat": "array",
        "reportSelfMessage": false,
        "maxPayloadBytes": 8388608
      }
    ],
    "wsServers": [
      {
        "name": "ws-main",
        "enabled": true,
        "host": "0.0.0.0",
        "port": 3001,
        "path": "/onebot",
        "role": "Universal",
        "accessToken": "<your-strong-random-token>",
        "messageFormat": "array",
        "reportSelfMessage": true,
        "maxPayloadBytes": 8388608
      }
    ],
    "httpClients": [],
    "wsClients": []
  },
  "statusCommand": {
    "enabled": true,
    "swallow": false,
    "cooldownSeconds": 10,
    "trigger": "#Haizakura"
  },
  "historySync": {
    "enabled": false
  },
  "notifications": {
    "channelIds": ["ops-webhook"]
  }
}
```

配合 `config/notifications.json`：

```json
{
  "version": 1,
  "debounceSeconds": 30,
  "channels": [
    {
      "id": "ops-webhook",
      "name": "运维通知",
      "type": "webhook",
      "enabled": true,
      "url": "https://<your-webhook-endpoint>",
      "headers": {
        "Content-Type": "application/json"
      },
      "bodyTemplate": "{\n  \"title\": \"账号状态通知：{event}\",\n  \"desp\": \"昵称：{nickname}\\nQQ号：{uin}\\n状态：{event}\\n时间：{time}\"\n}"
    },
    {
      "id": "ops-email",
      "name": "邮件通知",
      "type": "email",
      "enabled": false,
      "smtpHost": "smtp.example.com",
      "smtpPort": 587,
      "smtpSecure": false,
      "smtpUser": "<your-smtp-user>",
      "smtpPass": "<your-smtp-password>",
      "from": "bot@example.com",
      "to": "ops@example.com,oncall@example.com",
      "subjectTemplate": "账号{event}：{nickname} ({uin})"
    }
  ]
}
```

配合 `config/runtime.json`：

```json
{
  "webuiPort": 5099,
  "webuiHost": "127.0.0.1",
  "hookAutoLoad": false,
  "webuiTls": { "enabled": false },
  "trustProxy": "127.0.0.1",
  "logMaxTotalMb": 1024,
  "logRetainDays": 7,
  "logPerUin": false,
  "updateSource": {
    "mode": "direct",
    "mirror": "",
    "mirrors": []
  }
}
```

> ⚠️ `trustProxy` 填**反向代理的地址**（如 `127.0.0.1`）。
> 它影响 WebUI 判定客户端 IP，进而影响令牌策略的「是否本机」判断。
> **【待确认】** 该字段接受的具体格式（IP 列表？CIDR？）未在源码中找到解析逻辑。

配合 `config/snowluma.json`：

```json
{
  "rkey": {
    "fallbackServers": []
  },
  "musicSignUrl": "",
  "videoUploadConcurrency": 1
}
```

### 9.3 反向 WS：对接 NoneBot2 / Koishi

**适用场景**：Haizakura 在云服务器，你的框架在内网/家里。
由 Haizakura **主动连出去**，不需要开放入站端口。

`config/onebot_<uin>.json`：

```json
{
  "mode": "overlay",
  "networks": {
    "httpServers": [],
    "wsServers": [],
    "httpClients": [],
    "wsClients": [
      {
        "name": "wsclient-nonebot",
        "enabled": true,
        "url": "ws://127.0.0.1:8080/onebot/v11/ws",
        "role": "Universal",
        "accessToken": "<your-token-at-least-16-chars>",
        "messageFormat": "array",
        "reportSelfMessage": true,
        "reconnectIntervalMs": 5000,
        "maxPayloadBytes": 8388608
      },
      {
        "name": "wsclient-koishi",
        "enabled": false,
        "url": "ws://127.0.0.1:5140/onebot",
        "role": "Universal",
        "accessToken": "<your-token-at-least-16-chars>",
        "messageFormat": "array",
        "reportSelfMessage": true,
        "reconnectIntervalMs": 5000
      }
    ]
  }
}
```

**框架侧对应地址**（这些路径是框架的约定，不是 Haizakura 的）：

| 框架 | 反向 WS 地址 |
| --- | --- |
| **NoneBot2** | `ws://<你的IP>:8080/onebot/v11/ws` |
| **Koishi**（`adapter-onebot`） | `ws://<你的IP>:5140/onebot` |

> 💡 **令牌必须两边一致**。NoneBot 的 `onebot` 适配器配置里也要填同样的 token。

---

## 10. 校验规则与常见报错

### 10.1 校验时机

【确证】配置在三个时机被校验：

| 时机 | 函数 | 行为 |
| --- | --- | --- |
| **加载时** | `fromJson` → `assertValidOneBotConfig` | 宽容解析 + 严格校验 |
| **保存时** | `saveOneBotConfig` | 严格校验，失败**不写盘** |
| **恢复时** | `prepareOneBotConfigForRestore` | 更严格（`rejectUnknownKeys` 拒绝未知字段） |

> ⚠️ **「恢复」路径会拒绝未知字段，普通加载不会。**
> 这意味着你手工往配置里加自定义字段：**普通启动能被容忍（忽略），
> 但从 WebUI 备份恢复时会报错。**

### 10.2 常见报错对照表

| 报错 | 原因 | 修复 |
| --- | --- | --- |
| `networks.httpServers[0].port must be an integer between 1 and 65535` | 端口非法或缺失 | 填 1–65535 |
| `network adapter name "x" is duplicated in httpServers and wsServers` | **4 类适配器名字重复** | 改成唯一名字 |
| `networks.httpServers[0].maxPayloadBytes is only supported by WebSocket adapters` | 给 `httpClients` 写了 `maxPayloadBytes` | 删掉 |
| `networks.httpServers[0].path must already be a normalized URL pathname` | 路径没规范化 | 用 `/api` 而不是 `/api/../api` |
| `networks.wsServers[0].role must be Api, Event, or Universal` | `role` 值非法 | 三选一 |
| `networks.wsClients[0].reconnectIntervalMs must be an integer between 1000 and ...` | 重连间隔 < 1000 | ≥ 1000 |
| `statusCommand.trigger must be non-empty, single-line, and <= 32 characters` | 触发词空/多行/超长 | 见 §2 |
| `notifications.channelIds[0] is invalid` | slug 非法 | 只用 `[\w.-]`，≤64 |
| `... conflicts with ... on wildcard server port 3000` | 端口冲突 | 见 §1.7 |
| `节点“x”未绑定本机地址，远程保存必须填写令牌` | 非 loopback 但令牌为空 | 生成令牌或改 `127.0.0.1` |
| `节点“x”的令牌至少需要 16 个字符` | 令牌太短 | ≥16 字符 |
| `节点“x”的令牌容易被猜中` | 令牌含 uin/name/host 等 | 用随机令牌 |
| `SNOWLUMA_LOG_FILE_LEVEL must be one of: debug, info, success, warn, error` | 传了 `trace` | 换合法值 |
| `Invalid SNOWLUMA_WEBUI_TARGET: "x". Expected maibot or an empty value.` | 主题值非法 | 用 `maibot` 或留空 |
| `videoUploadConcurrency must be an integer from 1 to 4` | 越界 | 1–4 |

### 10.3 配置文件损坏怎么办

【确证】`tryLoadJson()` 的行为**分两种情况**：

| 文件 | 损坏时行为 |
| --- | --- |
| `config/onebot.json`（全局） | **警告并忽略**，继续用每账号配置 |
| `config/onebot_<uin>.json`（每账号） | **直接抛错**：`config file ... is corrupt: ...` |

日志原文（全局文件损坏）：

```
config file config/onebot.json is corrupt and will be ignored: ...
```

**写盘是原子的**（【确证】`saveJson`）：写临时文件 → `fsync` → `rename`，
权限 `0600`。所以正常关闭不会写坏文件。

---

## 11. 热加载 vs 重启 ★

**这一节很重要** —— 因为**重启会丢 QQ 登录态**（见 [登录说明](login.md)）。

| 改动 | 热加载？ | 怎么做 |
| --- | --- | --- |
| `networks`（OneBot 网络） | ✅ **热加载** | WebUI 保存 / `POST /api/config/:uin` |
| `statusCommand` | ✅ **热加载** | 同上 |
| `notifications.channelIds` | ✅ 热加载 | 同上 |
| `notifications.json` 渠道定义 | ✅ 热加载 | `POST /api/notifications/config` |
| `snowluma.json` | ✅ 热加载 | `POST /api/global-config` |
| `ui.json` 外观 | ✅ 热加载 | `POST /api/ui` |
| 日志级别 | ✅ 热加载 | `POST /api/logs/level` |
| hook 加载 / 卸载 | ✅ 热加载 | `POST /api/processes/:pid/load` / `unload` |
| 存储清理设置 | ✅ 热加载 | `POST /api/system/storage/settings` |
| **`historySync.enabled`** | ❌ **仅启动时读** | ⚠️ 需重启 |
| **`runtime.json` 多数字段** | ⚠️ 【待确认】 | 从代码看启动时读 |
| **环境变量** | ❌ 需重建容器 | ⚠️ 会丢登录态 |
| **`index.mjs` 代码** | ❌ 需重启 | ⚠️ 会丢登录态 |

**源码依据**：

- 网络配置：`OneBotNetworkManager` 有 `reconcile()` 机制（"Every startup/reload/shutdown
  operation then runs through one FIFO"）→ 支持热重载
- `historySync`：`instance.ts:82` 存到 `historySyncEnabledAtStartup` → 仅启动时

> 💡 **实践原则**：
> 能走 WebUI/API 的**绝不动容器**。只有在改代码或改环境变量时才重启，
> 且**重启前确认能扫码**。

---

## 12. 快速参考：全部字段计数

| 配置节 | 字段数 | 来源 |
| --- | ---: | --- |
| 适配器公共字段 | 5 | `RESTORE_BASE_ADAPTER_KEYS` |
| `httpServers` 专属 | 6 | `validateRestoreAdapterArray` |
| `wsServers` 专属 | 5 | 同上 |
| `httpClients` 专属 | 2 | 同上 |
| `wsClients` 专属 | 4 | 同上 |
| **网络合计（去重）** | **37** | — |
| `statusCommand` | 4 | `config.ts:26-31` |
| `historySync` | 1 | `config.ts:595` |
| `notifications` | 1 | `config.ts:611` |
| `runtime.json` | 8 | `normalizeRuntimeConfig` |
| `updateSource` | 3 | `normalizeUpdateSourceConfig` |
| `snowluma.json` | 3 | `normalizeGlobalSettings` |
| `notifications.json` 顶层 | 3 | `normalizeNotificationsConfig` |
| webhook 渠道 | 6 | `normalizeChannel` |
| email 渠道 | 12 | `normalizeEmailChannel` |
| **环境变量** | **36** | 源码穷举 |
| 容器 entrypoint 变量 | 8 | `/root/start.sh`（非源码验证） |

---

## 13. 相关章节

- 网络接入方式详解 → [OneBot v11 接入](../protocol/onebot11.md)
- 状态指令的原理与扩展 → [动作清单](../protocol/actions.md)
- WebUI 上怎么改这些配置 → [WebUI 概览](../webui/overview.md)
- 配置改了不生效怎么查 → [常见问题](faq.md)
