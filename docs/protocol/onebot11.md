# OneBot v11 接入指南

> 本文描述 Haizakura（原 SnowLuma）对 **OneBot v11** 协议的实现：
> 4 种网络接入方式、鉴权、消息格式与事件推送。
>
> **数据来源**：`packages/onebot/src/config.ts`（配置结构与校验）、
> `packages/onebot/src/network/*.ts`（各适配器实现）、
> `packages/onebot/src/event-filter.ts`（格式分支），
> 并与运行实例 `GET /api/config/:uin` 的实际配置核对。

---

## 1. 接入方式总览

实现提供 **4 类适配器**（源码 `config.ts` 的 `networks` 结构），
其中 HTTP 服务器还可**额外**开启 WebSocket 与 SSE：

| 配置键 | 方向 | 协议 | 谁主动连接 | 典型用途 |
| --- | --- | --- | --- | --- |
| `httpServers` | 入站 | HTTP + 可选 WS + 可选 SSE | 框架/客户端 → Haizakura | 最常用；一端口三协议 |
| `httpClients` | 出站 | HTTP POST（反向 HTTP） | Haizakura → 你的 HTTP 服务 | 无公网 IP 时上报事件 |
| `wsServers` | 入站 | 正向 WebSocket | 框架/客户端 → Haizakura | 低延迟双向 |
| `wsClients` | 出站 | 反向 WebSocket | Haizakura → 你的 WS 服务 | **NapCat / go-cqhttp 生态首选** |

补充开关（都属于 `httpServers` 条目）：

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `enableWebSocket` | `false` | 在同一端口额外接受 WebSocket 升级 |
| `enableSse` | `false` | 开放 `GET <path>/_events` 的 SSE 事件流 |

> **「正向」vs「反向」的判定**：以 **Haizakura 是服务端还是客户端**为准。
> `*Servers` = Haizakura 监听（正向）；`*Clients` = Haizakura 外连（反向）。

---

## 2. 配置文件与默认值

### 2.1 文件位置

```
config/onebot.json            # 全局默认
config/onebot_<uin>.json      # 按账号覆盖（uin 纯数字）
```

- 读取顺序：`config/onebot.json` → `config/onebot_<uin>.json`，后者覆盖前者。
- 仅识别 `onebot_<digits>.json`；形如 `onebot_1700000000.json` 的
  **时间戳式文件名会被忽略**（源码 `PER_UIN_CONFIG = /^onebot_(\d+)\.json$/`）。
- 文件不存在时使用内置默认值（见下）。

### 2.2 内置默认配置

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
        "accessToken": "<随机 base64url>",
        "messageFormat": "array",
        "reportSelfMessage": false
      }
    ],
    "httpClients": [],
    "wsServers": [
      {
        "name": "ws-default",
        "host": "127.0.0.1",
        "port": 3001,
        "path": "/",
        "role": "Universal",
        "accessToken": "<随机 base64url>",
        "messageFormat": "array",
        "reportSelfMessage": false
      }
    ],
    "wsClients": []
  },
  "statusCommand": {
    "enabled": true,
    "swallow": false,
    "cooldownSeconds": 5,
    "trigger": "#Haizakura"
  },
  "historySync": { "enabled": false },
  "notifications": { "channelIds": [] }
}
```

> `accessToken` 由 `randomBytes(32).toString("base64url")` 生成，**43 字符**。
> 默认只监听 `127.0.0.1`；要让容器外访问必须显式改成 `0.0.0.0`。

### 2.3 各适配器字段

**通用字段**（四类都有）

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 自动生成 | 适配器唯一名，冲突会拒绝加载 |
| `enabled` | bool | `true` | 置 `false` 可停用而不删配置 |
| `accessToken` | string | 随机 | 留空 = **不鉴权** |
| `messageFormat` | `"array"` \| `"string"` | `"array"` | 消息字段格式 |
| `reportSelfMessage` | bool | `false` | 是否上报自己发的消息 |

自动命名前缀：`httpServers` → `http-`、`httpClients` → `httppost-`、
`wsServers` → `ws-`、`wsClients` → `wsclient-`。

**`httpServers`** 额外：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `host` | string | `0.0.0.0` | 监听地址 |
| `port` | int | — | **必填且 > 0**，否则该条被丢弃 |
| `path` | string | `/` | 基础路径 |
| `enableWebSocket` | bool | `false` | 同端口接受 WS |
| `enableSse` | bool | `false` | 开放 `_events` |
| `maxPayloadBytes` | int | 见下 | 入站 WS 帧上限 |

**`wsServers`** 额外：`host`、`port`（必填 > 0）、`path`、
`role`（`Api` / `Event` / `Universal`，默认 `Universal`）、`maxPayloadBytes`。

**`httpClients`** 额外：`url`（必填，除 `enabled:false`）、`timeoutMs`（默认 `5000`）。

**`wsClients`** 额外：`url`（必填）、`role`（默认 `Universal`）、
`reconnectIntervalMs`（默认 `5000`，下限 `1000`）、`maxPayloadBytes`。

`maxPayloadBytes` 取值范围 **1024 ~ 2147483648**（2 GiB）。
`httpClients` **不接受** `maxPayloadBytes`（会报配置错误）。

---

## 3. 鉴权（accessToken）

### 3.1 判定逻辑

源码 `network/utils.ts`：

```js
function isAuthorized(request, token, allowRawToken = false) {
  if (!token) return true;                       // 未配置 token = 完全放行
  const auth = request.headers.authorization ?? "";
  if (auth === `Bearer ${token}` || (allowRawToken && auth === token)) return true;
  try {
    if (new URL(request.url ?? "/", "http://127.0.0.1")
          .searchParams.get("access_token") === token) return true;
  } catch {}
  return false;
}
```

### 3.2 三种传递方式

| 方式 | 写法 | 适用 | 风险 |
| --- | --- | --- | --- |
| Bearer 头 | `Authorization: Bearer <token>` | 全部适配器 | ✅ 推荐 |
| 裸 token 头 | `Authorization: <token>` | **仅 HTTP server** | ⚠️ 非标准，易被中间件误解 |
| URL 查询参数 | `?access_token=<token>` | 全部（WS 握手也支持） | 🔴 **token 进 URL**：会落入访问日志、浏览器历史、Referer、代理日志 |

> **建议**：生产环境**只用 Bearer 头**。`?access_token=` 仅为兼容旧客户端保留，
> 若必须在浏览器中使用，请确保不记录完整 URL。

### 3.3 未授权响应

```json
{ "status": "failed", "retcode": 1401, "data": null, "wording": "unauthorized" }
```

HTTP 状态码 `401`。WS 握手阶段则以 `401 Unauthorized` 拒绝升级
（`verifyClient` 回调，源码 `ws-server-adapter.ts`）。

### 3.4 反向连接的鉴权方向

| 适配器 | 鉴权头 |
| --- | --- |
| `httpClients` | `X-Signature: sha1=<HMAC-SHA1(accessToken, body) 十六进制>` |
| `wsClients` | `Authorization: Bearer <accessToken>` |

`httpClients` **不使用** Bearer，而是对**请求体做 HMAC-SHA1 签名**
（源码 `computeHmacSha1`）。你的接收端需要按同样算法校验。

---

## 4. 配置示例（可直接复制）

### 4.1 HTTP + WS + SSE 单端口（推荐）

```json
{
  "networks": {
    "httpServers": [
      {
        "name": "main",
        "host": "0.0.0.0",
        "port": 3000,
        "path": "/",
        "enableWebSocket": true,
        "enableSse": true,
        "accessToken": "REPLACE_WITH_YOUR_TOKEN",
        "messageFormat": "array",
        "reportSelfMessage": false
      }
    ],
    "httpClients": [],
    "wsServers": [],
    "wsClients": []
  }
}
```

接入地址：HTTP `http://<host>:3000/`，WS `ws://<host>:3000/`，
SSE `http://<host>:3000/_events`。

### 4.2 反向 WebSocket（NapCat 生态）

```json
{
  "networks": {
    "httpServers": [],
    "httpClients": [],
    "wsServers": [],
    "wsClients": [
      {
        "name": "to-framework",
        "url": "ws://127.0.0.1:8080/onebot/v11/ws",
        "role": "Universal",
        "accessToken": "REPLACE_WITH_YOUR_TOKEN",
        "messageFormat": "array",
        "reportSelfMessage": false,
        "reconnectIntervalMs": 5000
      }
    ]
  }
}
```

### 4.3 反向 HTTP 上报

```json
{
  "networks": {
    "httpServers": [],
    "httpClients": [
      {
        "name": "report",
        "url": "http://127.0.0.1:8080/onebot/events",
        "accessToken": "REPLACE_WITH_YOUR_SHARED_SECRET",
        "messageFormat": "array",
        "reportSelfMessage": false,
        "timeoutMs": 5000
      }
    ],
    "wsServers": [],
    "wsClients": []
  }
}
```

### 4.4 字符串消息格式（兼容旧框架）

```json
{
  "networks": {
    "httpServers": [
      {
        "name": "legacy",
        "host": "0.0.0.0",
        "port": 3000,
        "path": "/",
        "accessToken": "REPLACE_WITH_YOUR_TOKEN",
        "messageFormat": "string",
        "reportSelfMessage": true
      }
    ],
    "httpClients": [],
    "wsServers": [],
    "wsClients": []
  }
}
```

### 4.5 多账号 / 多适配器并存

`networks` 下每个数组可放多条，**`name` 必须全局唯一**：

```json
{
  "networks": {
    "httpServers": [
      { "name": "api-a", "host": "0.0.0.0", "port": 3000, "accessToken": "TOKEN_A" },
      { "name": "api-b", "host": "0.0.0.0", "port": 3002, "accessToken": "TOKEN_B" }
    ],
    "wsClients": [
      { "name": "push-a", "url": "ws://127.0.0.1:9001/ws", "role": "Universal" },
      { "name": "push-b", "url": "ws://127.0.0.1:9002/ws", "role": "Event",
        "accessToken": "TOKEN_C" }
    ]
  }
}
```

---

## 5. HTTP 接入详解

### 5.1 路径 → 动作名映射

以配置的 `path` 为前缀，**路径剩余部分即动作名**（源码 `http-server-adapter.ts`）：

| 请求路径（`path: "/"`） | 动作 |
| --- | --- |
| `GET /` | 健康探测，返回 `{ "status":"ok","retcode":0,"data":{"online":true} }` |
| `POST /send_group_msg` | `send_group_msg` |
| `POST /get_group_list` | `get_group_list` |
| `GET /_events` | SSE 事件流（需 `enableSse: true`） |

配置 `path: "/onebot"` 时，动作路径变为 `/onebot/send_group_msg`。

不属于该前缀的路径返回：

```json
{ "status": "failed", "retcode": 1404, "data": null, "wording": "not found" }
```

### 5.2 三种请求写法

**① 路径带动作 + JSON body（最常见）**

```bash
curl -X POST http://127.0.0.1:3000/send_group_msg \
  -H 'Authorization: Bearer REPLACE_WITH_YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"group_id":20001,"message":[{"type":"text","data":{"text":"你好"}}]}'
```

**② JSON body 内嵌 `action`**

```bash
curl -X POST http://127.0.0.1:3000/ \
  -H 'Authorization: Bearer REPLACE_WITH_YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"action":"send_group_msg","params":{"group_id":20001,"message":"hi"},"echo":"req-1"}'
```

**③ GET + 查询参数**

```bash
curl -G http://127.0.0.1:3000/get_group_member_info \
  -H 'Authorization: Bearer REPLACE_WITH_YOUR_TOKEN' \
  --data-urlencode 'group_id=20001' --data-urlencode 'user_id=10001'
```

也支持 `application/x-www-form-urlencoded` 的 POST。

查询/表单参数会**逐个尝试 `JSON.parse`**，失败则按字符串原样传入，
因此 `?user_id=10001` 与 `?user_id="10001"` 都能解析为数字。

### 5.3 `echo` 回显

请求中带 `echo` 时，响应会**原样回显**该字段（源码 `if (echo !== void 0) response.echo = echo;`），
便于异步并发匹配请求与响应。

### 5.4 方法与错误

> ⚠️ **动作层面的失败仍返回 HTTP `200`**。
> `retcode 100/1400/1404/1200` 都出现在 **HTTP 200** 的响应体里。
> 请按 `retcode` 判断成败，不要只看 HTTP 状态码。

| 情况 | HTTP | retcode | wording |
| --- | --- | --- | --- |
| 动作成功 | `200` | `0` | — |
| 参数校验失败 | **`200`** | `1400` | 如 `group_id is required` |
| 动作执行失败 | **`200`** | `100` | 具体原因 |
| 动作不存在 | **`200`** | `1404` | `unknown action` |
| 非 GET/POST | `405` | `1400` | `method not allowed` |
| 缺 `action` | `400` | `1400` | `bad request: missing action` |
| JSON 语法错误 | `400` | `1400` | `bad request: invalid json` |
| 不支持的 Content-Type | `400` | `1400` | `bad request: unsupported content-type: ...` |
| 请求体过大 | `413` | `1413` | — |
| 内部异常 | `500` | `1200` | 异常信息 |
| 服务正在关闭 | `503` | `1200` | `server closing` |
| 未授权 | `401` | `1401` | `unauthorized` |
| 路径不在 `path` 前缀下 | `404` | `1404` | `not found` |

---

## 6. WebSocket 接入详解

### 6.1 三种 role

`role` 决定该连接**收发哪些内容**（源码 `ws-server-connections.ts` /
`ws-client-adapter.ts`）：

| role | 接收事件 | 接受动作请求 |
| --- | --- | --- |
| `Api` | ✗ | ✔ |
| `Event` | ✔ | ✗ |
| `Universal` | ✔ | ✔ |

- 事件只推给 `Event` / `Universal` 连接。
- 动作请求只接受来自 `Api` / `Universal` 连接的入站消息。
- `Event` 连接发来的动作请求会被**忽略**（不报错）。

### 6.2 路径分类（正向 WS）

当 `path` 为 `"/"` 且 `role` 为 `Universal` 时，可按**子路径**区分角色：

| 路径 | 解析出的 role |
| --- | --- |
| `/` | `Universal` |
| `/api` | `Api` |
| `/event` | `Event` |

以 `/api` 结尾 → `Api`；以 `/event` 结尾 → `Event`；其余 → `Universal`。
路径不符合配置时握手被拒（`400 Bad path for WebSocket`）。

### 6.3 正反向握手的请求头

**反向 WS（`wsClients`，Haizakura 作为客户端）** 发送：

```
User-Agent: OneBot/11
X-Self-ID: <uin>
X-Client-Role: Universal | Api | Event
Authorization: Bearer <accessToken>     # 仅在配置了 token 时
```

**反向 HTTP（`httpClients`）** 发送：

```
Content-Type: application/json
User-Agent: OneBot
X-Self-ID: <uin>
X-Signature: sha1=<HMAC-SHA1(accessToken, 原始body) 的 hex>
```

### 6.4 心跳与重连

**服务端 → 客户端（meta 事件）**：`OneBotInstance.HEARTBEAT_INTERVAL = 30000` ms，
每 30 秒推送一次 `meta_event` / `heartbeat`（详见 `events.md`）。

**反向 WS 的存活探测**：`HEARTBEAT_INTERVAL_MS = 30000`、
`HEARTBEAT_MAX_MISSED = 2`，即约 **90 秒**无入站响应即判定半开连接并重连
（`HEARTBEAT_DEAD_AFTER_S = 30 * 3 / 1000`）。

**重连间隔**：`reconnectIntervalMs`，默认 `5000`，下限 `1000`。

### 6.5 反向 WS 连接时先补发 meta 事件

连接建立后，服务端会立刻推送 bootstrap 元事件（生命周期等），
随后才推送增量事件。客户端应能容忍「连接后立即收到 meta_event」。

---

## 7. SSE 接入详解

### 7.1 开启与地址

```json
{ "name": "main", "host": "0.0.0.0", "port": 3000, "enableSse": true }
```

事件流地址：**`GET <path>/_events`**（`path` 为 `/` 时即 `/_events`）。

未开启时访问返回：

```json
{ "status": "failed", "retcode": 1404, "data": null, "wording": "SSE is disabled" }
```

非 GET 方法返回 `405` + `retcode 1405` + `wording: "SSE requires GET"`。

### 7.2 响应头与帧格式

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
Connection: keep-alive
```

建立连接后首先发送 `retry: 3000`，随后每帧：

```
id: <epoch-uuid>:<sequence>
data: <事件 JSON>

```

每 **15 秒** 发送一次注释行 `: ping` 作为保活。

### 7.3 断线重连与 `Last-Event-ID`

客户端可在重连时回传 `Last-Event-ID: <epoch>:<sequence>` 请求补发：

| 情况 | 响应 |
| --- | --- |
| 格式非法 | `400` `invalid Last-Event-ID` |
| epoch 不匹配 / 序号越界 / 已被丢弃 | `409` `SSE replay unavailable; resync and reconnect without Last-Event-ID` |

收到 `409` 时应**清空 `Last-Event-ID` 重新连接**并从当前状态重建。

### 7.4 缓冲上限

单连接积压超过 **8 MiB**（`CLIENT_BYTES = 8 * 1024 * 1024`）会被**主动断开**，
日志提示 `SSE client exceeded N buffered bytes; disconnecting`。
慢消费者应改用 WebSocket 或分片拉取。

---

## 8. 消息格式：`array` vs `string`

由每个适配器的 `messageFormat` 决定**事件中 `message` 字段**的形态：

| 值 | `message` 字段 | 说明 |
| --- | --- | --- |
| `"array"`（默认） | 消息段数组 | 结构化，推荐 |
| `"string"` | CQ 码字符串 | 取 `raw_message` 的值 |

源码 `event-filter.ts`：

```js
function shapeEventForAdapter(event, options) {
  if (event.post_type === "message_sent" && !options.reportSelfMessage) return null;
  if (options.messageFormat === "string"
      && (event.post_type === "message" || event.post_type === "message_sent")
      && Array.isArray(event.message)) {
    const raw = typeof event.raw_message === "string" ? event.raw_message : "";
    return { ...event, message: raw };
  }
  return event;
}
```

注意：仅**消息类事件**受影响；`message_sent`（自己发的消息）在
`reportSelfMessage: false` 时**整个事件被丢弃**。

**发送方向不受 `messageFormat` 限制**：`message` 参数既可传数组，
也可传 CQ 码字符串（`[CQ:face,id=1]`）或对象，由 `parseMessage` 解析。
`auto_escape: true` 时字符串中的 CQ 码**不被解析**，按纯文本发送。

### 8.1 消息段类型

**接收方向**（元素 → 段，源码 `element-codecs.ts` 的 `ELEMENT_CODECS`，共 **16** 种）：

```
text  face  at  reply  image  record  video  json  xml
file  mface  poke  flash_file  forward  markdown  inline_keyboard
```

**发送方向**另有 9 种**兼容段**会被转换成上述元素
（源码 `message-parser.ts` 的 `segmentToElement`）：

```
node  share  music  location  contact  rps  dice  shake  anonymous
```

> `node` 只允许出现在**合并转发**（forward node 列表）内部；
> 顶层使用会报 `UNSENDABLE_TYPE`。
> `share` / `music` 会被转换为 `json` 卡片；`music` 的 `custom` 类型
> 需要外链签名服务（默认 `https://ss.xingzhige.com/music_card/card`）。

**空文本占位符规则**（源码 `isExplicitEmptyTextPlaceholder`）：
段数组中 `text` 字段**恰为空字符串 `""`** 的 text 段视为**兼容占位符**，
不计入「可发送段」；而字段**缺失 / `null` / 仅空白**仍走正常校验。

---

## 9. 快速验证

```bash
TOKEN=REPLACE_WITH_YOUR_TOKEN
BASE=http://127.0.0.1:3000

# 健康探测（仍需鉴权，因为 accessToken 非空）
curl -s $BASE/ -H "Authorization: Bearer $TOKEN"

# 版本信息
curl -s -X POST $BASE/get_version_info \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'

# 群列表
curl -s -X POST $BASE/get_group_list \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'

# 反向验证鉴权确实生效（预期 401 / retcode 1401）
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/get_version_info \
  -H 'Content-Type: application/json' -d '{}'
```

> ⚠️ **`get_supported_actions` 未实现**。这是 OneBot v11 的标准动作，
> 但本实现**没有提供**，调用返回：
>
> ```json
> { "status": "failed", "retcode": 1404, "data": null, "wording": "unknown action" }
> ```
>
> `_get_supported_actions` 同样不存在。**需要动作清单时请改用 WebUI 的
> `GET /api/debug/actions`**（见 `webui/api.md`），它返回全部 222 个动作的
> 完整文档。

### 实测结果（2026-11-13，运行实例）

| 请求 | 结果 |
| --- | --- |
| `POST /get_version_info` 无 token | HTTP `401`，`retcode 1401`，`unauthorized` |
| `POST /get_version_info` 带 token | `{"app_name":"Haizakura","app_version":"2.4.0-node","protocol_version":"v11"}` |
| `GET /` 带 token | `{"status":"ok","retcode":0,"data":{"online":true}}` |
| `POST /get_supported_actions` | `retcode 1404`，`unknown action` ❌ |
| `POST /get_status` | `{"online":true,"good":true,"time":3793}` |
| `POST /can_send_image` | `{"yes":true}` |
| `POST /get_login_info` | `{"user_id":<uin>,"nickname":"HaizakuraBot"}` |

### SSE 验证

```bash
curl -N -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/_events
```

---

## 10. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `retcode 1401 unauthorized` | token 不匹配或未传 | 检查 `Authorization: Bearer` |
| `retcode 1404 not found` | 路径不在 `path` 前缀下 | 核对 `path` 配置 |
| `1404` + `SSE is disabled` | 未开 `enableSse` | 打开开关并重载 |
| WS 握手 `400 Bad path` | 路径与 `path`/role 规则不符 | 见 §6.2 |
| 收不到事件 | 连接 role 为 `Api` | 改用 `Event` / `Universal` |
| 自己发的消息不推送 | `reportSelfMessage: false` | 置 `true` |
| 端口不生效 | `port <= 0` 的条目被丢弃 | 设合法端口（1–65535） |
| 配置不生效 | 文件名不是 `onebot_<纯数字>.json` | 见 §2.1 |
| 事件里 `message` 是字符串 | `messageFormat: "string"` | 改为 `"array"` |

---

## 11. 声明

| 项目 | 状态 |
| --- | --- |
| 配置字段、默认值、校验范围 | **已核实**：来自 `config.ts` 源码 |
| 鉴权三种方式与 `1401` 响应 | **已核实**：源码 + 实机验证 |
| HTTP 三种请求写法、`echo`、错误码 | **已核实**：`http-server-adapter.ts` |
| role 语义、路径分类、心跳间隔 | **已核实**：WS 适配器源码 |
| SSE 帧格式、重连、8 MiB 上限 | **已核实**：`http-sse-connections.ts` |
| 消息段 16/9 种、空文本占位符 | **已核实**：codec 与 parser 源码 |
| 本文示例的连接地址/端口 | 示例值，**未**在你的环境实测 |

> 未实测项：反向 WS / 反向 HTTP / SSE 三种方式未在真机建立过连接，
> 上述行为均来自源码阅读。
