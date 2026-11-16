# OneBot v11 接入指南

> [!WARNING]
> 本内容完全由 AI 編写，請謹慎閲覧。

> 本文述 Haizakura（原 SnowLuma）対 **OneBot v11** 協議之実装：
> 4 種網絡接入方式、鑑權、消息格式与事件推送。
>
> **資料来源**：`packages/onebot/src/config.ts`（設定結構与校験）、
> `packages/onebot/src/network/*.ts`（各適配器実装）、
> `packages/onebot/src/event-filter.ts`（格式分支），
> 並与運行実例 `GET /api/config/:uin` 之実際設定核対。

---

## 1. 接入方式総覧

実装提供 **4 類適配器**（源碼 `config.ts` 之 `networks` 結構），
其中 HTTP 伺服器尚可**额外**開啓 WebSocket 与 SSE：

| 設定鍵 | 方向 | 協議 | 誰主動接続 | 典型用途 |
| --- | --- | --- | --- | --- |
| `httpServers` | 入站 | HTTP + 可選 WS + 可選 SSE | 框架/客户端 → Haizakura | 最常用；一端口三協議 |
| `httpClients` | 出站 | HTTP POST（反向 HTTP） | Haizakura → 汝之 HTTP 服務 | 無公網 IP 時上報事件 |
| `wsServers` | 入站 | 正向 WebSocket | 框架/客户端 → Haizakura | 低延遲双方向 |
| `wsClients` | 出站 | 反向 WebSocket | Haizakura → 汝之 WS 服務 | **NapCat / go-cqhttp 生態首選** |

補充開関（皆属 `httpServers` 条目）：

| 字段 | 既定 | 作用 |
| --- | --- | --- |
| `enableWebSocket` | `false` | 於同一端口额外接受 WebSocket 昇級 |
| `enableSse` | `false` | 開放 `GET <path>/_events` 之 SSE 事件流 |

> **「正向」与「反向」之判定**：以 **Haizakura 為伺服器或客户端**為準。
> `*Servers` = Haizakura 監聽（正向）；`*Clients` = Haizakura 外接（反向）。

---

## 2. 設定文件与既定値

### 2.1 文件位置

```
config/onebot.json            # 全局默认
config/onebot_<uin>.json      # 按账号覆盖（uin 纯数字）
```

- 読取順：`config/onebot.json` → `config/onebot_<uin>.json`，後者覆蓋前者。
- 僅識別 `onebot_<digits>.json`；形如 `onebot_1700000000.json` 之
  **時間戳式文件名会被忽略**（源碼 `PER_UIN_CONFIG = /^onebot_(\d+)\.json$/`）。
- 文件不存在時使用内蔵既定値（見下）。

### 2.2 内蔵既定設定

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
> 既定只監聽 `127.0.0.1`；欲使容器外訪問必須明示改為 `0.0.0.0`。

### 2.3 各適配器字段

**通用字段**（四類皆有）

| 字段 | 類型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `name` | string | 自動生成 | 適配器唯一名，衝突則拒絶載入 |
| `enabled` | bool | `true` | 置 `false` 可停用而不刪設定 |
| `accessToken` | string | 随機 | 留空 = **不鑑權** |
| `messageFormat` | `"array"` \| `"string"` | `"array"` | 消息字段格式 |
| `reportSelfMessage` | bool | `false` | 是否上報自己發之消息 |

自動命名前綴：`httpServers` → `http-`、`httpClients` → `httppost-`、
`wsServers` → `ws-`、`wsClients` → `wsclient-`。

**`httpServers`** 额外：

| 字段 | 類型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `host` | string | `0.0.0.0` | 監聽地址 |
| `port` | int | — | **必填且 > 0**，否則該条被棄 |
| `path` | string | `/` | 基礎路径 |
| `enableWebSocket` | bool | `false` | 同端口接受 WS |
| `enableSse` | bool | `false` | 開放 `_events` |
| `maxPayloadBytes` | int | 見下 | 入站 WS 幀上限 |

**`wsServers`** 额外：`host`、`port`（必填 > 0）、`path`、
`role`（`Api` / `Event` / `Universal`，既定 `Universal`）、`maxPayloadBytes`。

**`httpClients`** 额外：`url`（必填，除 `enabled:false`）、`timeoutMs`（既定 `5000`）。

**`wsClients`** 额外：`url`（必填）、`role`（既定 `Universal`）、
`reconnectIntervalMs`（既定 `5000`，下限 `1000`）、`maxPayloadBytes`。

`maxPayloadBytes` 取值範囲 **1024 ~ 2147483648**（2 GiB）。
`httpClients` **不接受** `maxPayloadBytes`（会報設定錯誤）。

---

## 3. 鑑權（accessToken）

### 3.1 判定邏輯

源碼 `network/utils.ts`：

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

### 3.2 三種傳遞方式

| 方式 | 写法 | 適用 | 風險 |
| --- | --- | --- | --- |
| Bearer 頭 | `Authorization: Bearer <token>` | 全部適配器 | ✅ 推薦 |
| 裸 token 頭 | `Authorization: <token>` | **僅 HTTP server** | ⚠️ 非標準，易被中間件誤解 |
| URL 査詢参數 | `?access_token=<token>` | 全部（WS 握手亦支持） | 🔴 **token 入 URL**：会落入訪問日誌、瀏覧器歴史、Referer、代理日誌 |

> **建議**：生産環境**只用 Bearer 頭**。`?access_token=` 僅為兼容舊客户端而留，
> 若必須於瀏覧器中使用，請確保不記録完全 URL。

### 3.3 未授権応答

```json
{ "status": "failed", "retcode": 1401, "data": null, "wording": "unauthorized" }
```

HTTP 状態碼 `401`。WS 握手階段則以 `401 Unauthorized` 拒絶昇級
（`verifyClient` 回調，源碼 `ws-server-adapter.ts`）。

### 3.4 反向接続之鑑權方向

| 適配器 | 鑑權頭 |
| --- | --- |
| `httpClients` | `X-Signature: sha1=<HMAC-SHA1(accessToken, body) 十六进制>` |
| `wsClients` | `Authorization: Bearer <accessToken>` |

`httpClients` **不使用** Bearer，而対**請求体作 HMAC-SHA1 簽名**
（源碼 `computeHmacSha1`）。汝之接收端需按同様算法校験。

---

## 4. 設定示例（可直接複製）

### 4.1 HTTP + WS + SSE 単端口（推薦）

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

### 4.2 反向 WebSocket（NapCat 生態）

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

### 4.3 反向 HTTP 上報

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

### 4.4 字符串消息格式（兼容舊框架）

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

### 4.5 多帳号 / 多適配器並存

`networks` 下各数組可放多条，**`name` 必須全局唯一**：

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

## 5. HTTP 接入詳解

### 5.1 路径 → 動作名映射

以設定之 `path` 為前綴，**路径剩余部分即動作名**（源碼 `http-server-adapter.ts`）：

| 請求路径（`path: "/"`） | 動作 |
| --- | --- |
| `GET /` | 健康探測，返 `{ "status":"ok","retcode":0,"data":{"online":true} }` |
| `POST /send_group_msg` | `send_group_msg` |
| `POST /get_group_list` | `get_group_list` |
| `GET /_events` | SSE 事件流（需 `enableSse: true`） |

設定 `path: "/onebot"` 時，動作路径変為 `/onebot/send_group_msg`。

不属該前綴之路径返：

```json
{ "status": "failed", "retcode": 1404, "data": null, "wording": "not found" }
```

### 5.2 三種請求写法

**① 路径帯動作 + JSON body（最常見）**

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

**③ GET + 査詢参數**

```bash
curl -G http://127.0.0.1:3000/get_group_member_info \
  -H 'Authorization: Bearer REPLACE_WITH_YOUR_TOKEN' \
  --data-urlencode 'group_id=20001' --data-urlencode 'user_id=10001'
```

亦支持 `application/x-www-form-urlencoded` 之 POST。

査詢／表单参數会**逐个試 `JSON.parse`**，失敗則按字符串原様傳入，
故 `?user_id=10001` 与 `?user_id="10001"` 皆可解析為数字。

### 5.3 `echo` 回顕

請求中帯 `echo` 時，応答会**原様回顕**該字段（源碼 `if (echo !== void 0) response.echo = echo;`），
便於異歩並發匹配請求与応答。

### 5.4 方法与錯誤

> ⚠️ **動作層之失敗仍返 HTTP `200`**。
> `retcode 100/1400/1404/1200` 皆出現於 **HTTP 200** 之応答体内。
> 請按 `retcode` 判断成敗，勿只看 HTTP 状態碼。

| 情況 | HTTP | retcode | wording |
| --- | --- | --- | --- |
| 動作成功 | `200` | `0` | — |
| 参數校験失敗 | **`200`** | `1400` | 如 `group_id is required` |
| 動作執行失敗 | **`200`** | `100` | 具体原因 |
| 動作不存在 | **`200`** | `1404` | `unknown action` |
| 非 GET/POST | `405` | `1400` | `method not allowed` |
| 欠 `action` | `400` | `1400` | `bad request: missing action` |
| JSON 語法錯誤 | `400` | `1400` | `bad request: invalid json` |
| 不支持之 Content-Type | `400` | `1400` | `bad request: unsupported content-type: ...` |
| 請求体過大 | `413` | `1413` | — |
| 内部異常 | `500` | `1200` | 異常情報 |
| 服務正在関閉 | `503` | `1200` | `server closing` |
| 未授権 | `401` | `1401` | `unauthorized` |
| 路径不在 `path` 前綴下 | `404` | `1404` | `not found` |

---

## 6. WebSocket 接入詳解

### 6.1 三種 role

`role` 決定該接続**收發何内容**（源碼 `ws-server-connections.ts` /
`ws-client-adapter.ts`）：

| role | 接收事件 | 接受動作請求 |
| --- | --- | --- |
| `Api` | ✗ | ✔ |
| `Event` | ✔ | ✗ |
| `Universal` | ✔ | ✔ |

- 事件只推与 `Event` / `Universal` 接続。
- 動作請求只接受來自 `Api` / `Universal` 接続之入站消息。
- `Event` 接続發來之動作請求会被**忽略**（不報錯）。

### 6.2 路径分類（正向 WS）

当 `path` 為 `"/"` 且 `role` 為 `Universal` 時，可按**子路径**区別角色：

| 路径 | 解析出之 role |
| --- | --- |
| `/` | `Universal` |
| `/api` | `Api` |
| `/event` | `Event` |

以 `/api` 結尾 → `Api`；以 `/event` 結尾 → `Event`；其余 → `Universal`。
路径不合設定時握手被拒（`400 Bad path for WebSocket`）。

### 6.3 正反向握手之請求頭

**反向 WS（`wsClients`，Haizakura 作為客户端）** 送信：

```
User-Agent: OneBot/11
X-Self-ID: <uin>
X-Client-Role: Universal | Api | Event
Authorization: Bearer <accessToken>     # 仅在配置了 token 时
```

**反向 HTTP（`httpClients`）** 送信：

```
Content-Type: application/json
User-Agent: OneBot
X-Self-ID: <uin>
X-Signature: sha1=<HMAC-SHA1(accessToken, 原始body) 的 hex>
```

### 6.4 心搏与重連

**伺服器 → 客户端（meta 事件）**：`OneBotInstance.HEARTBEAT_INTERVAL = 30000` ms，
毎 30 秒推送一次 `meta_event` / `heartbeat`（詳見 `events.md`）。

**反向 WS 之存活探測**：`HEARTBEAT_INTERVAL_MS = 30000`、
`HEARTBEAT_MAX_MISSED = 2`，即約 **90 秒**無入站応答即判定半開接続並重連
（`HEARTBEAT_DEAD_AFTER_S = 30 * 3 / 1000`）。

**重連間隔**：`reconnectIntervalMs`，既定 `5000`，下限 `1000`。

### 6.5 反向 WS 接続時先補發 meta 事件

接続建立後，伺服器会即刻推送 bootstrap 元事件（生命周期等），
之後才推送増量事件。客户端応能容忍「接続後即刻収到 meta_event」。

---

## 7. SSE 接入詳解

### 7.1 開啓与地址

```json
{ "name": "main", "host": "0.0.0.0", "port": 3000, "enableSse": true }
```

事件流地址：**`GET <path>/_events`**（`path` 為 `/` 時即 `/_events`）。

未開啓時訪問返：

```json
{ "status": "failed", "retcode": 1404, "data": null, "wording": "SSE is disabled" }
```

非 GET 方法返 `405` + `retcode 1405` + `wording: "SSE requires GET"`。

### 7.2 応答頭与幀格式

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
Connection: keep-alive
```

接続建立後先送 `retry: 3000`，其後毎幀：

```
id: <epoch-uuid>:<sequence>
data: <事件 JSON>

```

毎 **15 秒** 送一次註釋行 `: ping` 作為保活。

### 7.3 断線重連与 `Last-Event-ID`

客户端可於重連時回傳 `Last-Event-ID: <epoch>:<sequence>` 請求補發：

| 情況 | 応答 |
| --- | --- |
| 格式非法 | `400` `invalid Last-Event-ID` |
| epoch 不匹配 / 序号越界 / 已被棄 | `409` `SSE replay unavailable; resync and reconnect without Last-Event-ID` |

収到 `409` 時応**清空 `Last-Event-ID` 重新接続**並自現在状態重建。

### 7.4 緩衝上限

単接続積圧超過 **8 MiB**（`CLIENT_BYTES = 8 * 1024 * 1024`）会被**主動断開**，
日誌提示 `SSE client exceeded N buffered bytes; disconnecting`。
慢消費者応改用 WebSocket 或分片拉取。

---

## 8. 消息格式：`array` vs `string`

由各適配器之 `messageFormat` 決定**事件中 `message` 字段**之形態：

| 値 | `message` 字段 | 説明 |
| --- | --- | --- |
| `"array"`（既定） | 消息段数組 | 結構化，推薦 |
| `"string"` | CQ 碼字符串 | 取 `raw_message` 之値 |

源碼 `event-filter.ts`：

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

注意：僅**消息類事件**受影響；`message_sent`（自己發之消息）於
`reportSelfMessage: false` 時**整個事件被棄**。

**送信方向不受 `messageFormat` 限制**：`message` 参數既可傳数組，
亦可傳 CQ 碼字符串（`[CQ:face,id=1]`）或対象，由 `parseMessage` 解析。
`auto_escape: true` 時字符串中之 CQ 碼**不被解析**，按純文本送信。

### 8.1 消息段類型

**接收方向**（元素 → 段，源碼 `element-codecs.ts` 之 `ELEMENT_CODECS`，共 **16** 種）：

```
text  face  at  reply  image  record  video  json  xml
file  mface  poke  flash_file  forward  markdown  inline_keyboard
```

**送信方向**另有 9 種**兼容段**会被変換成上述元素
（源碼 `message-parser.ts` 之 `segmentToElement`）：

```
node  share  music  location  contact  rps  dice  shake  anonymous
```

> `node` 只允許出現於**合併轉發**（forward node 列表）内部；
> 頂層使用会報 `UNSENDABLE_TYPE`。
> `share` / `music` 会被変換為 `json` 卡片；`music` 之 `custom` 類型
> 需外鏈簽名服務（既定 `https://ss.xingzhige.com/music_card/card`）。

**空文本占位符規則**（源碼 `isExplicitEmptyTextPlaceholder`）：
段数組中 `text` 字段**恰為空字符串 `""`** 之 text 段視為**兼容占位符**，
不計入「可送信段」；而字段**欠 / `null` / 僅空白**仍走正常校験。

---

## 9. 快速験証

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

> ⚠️ **`get_supported_actions` 未実装**。此為 OneBot v11 之標準動作，
> 但本実装**没有提供**，呼用返：
>
> ```json
> { "status": "failed", "retcode": 1404, "data": null, "wording": "unknown action" }
> ```
>
> `_get_supported_actions` 同様不存在。**需動作清単時請改用 WebUI 之
> `GET /api/debug/actions`**（見 `webui/api.md`），其返全部 222 個動作之
> 完全文档。

### 実測結果（2026-11-13，運行実例）

| 請求 | 結果 |
| --- | --- |
| `POST /get_version_info` 無 token | HTTP `401`，`retcode 1401`，`unauthorized` |
| `POST /get_version_info` 帯 token | `{"app_name":"Haizakura","app_version":"2.4.0-node","protocol_version":"v11"}` |
| `GET /` 帯 token | `{"status":"ok","retcode":0,"data":{"online":true}}` |
| `POST /get_supported_actions` | `retcode 1404`，`unknown action` ❌ |
| `POST /get_status` | `{"online":true,"good":true,"time":3793}` |
| `POST /can_send_image` | `{"yes":true}` |
| `POST /get_login_info` | `{"user_id":<uin>,"nickname":"HaizakuraBot"}` |

### SSE 験証

```bash
curl -N -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/_events
```

---

## 10. 常見問題

| 現象 | 原因 | 処理 |
| --- | --- | --- |
| `retcode 1401 unauthorized` | token 不匹配或未傳 | 検査 `Authorization: Bearer` |
| `retcode 1404 not found` | 路径不在 `path` 前綴下 | 核対 `path` 設定 |
| `1404` + `SSE is disabled` | 未開 `enableSse` | 打開開関並重載 |
| WS 握手 `400 Bad path` | 路径与 `path`/role 規則不符 | 見 §6.2 |
| 収不到事件 | 接続 role 為 `Api` | 改用 `Event` / `Universal` |
| 自己發之消息不推送 | `reportSelfMessage: false` | 置 `true` |
| 端口不生效 | `port <= 0` 之条目被棄 | 設合法端口（1–65535） |
| 設定不生效 | 文件名非 `onebot_<纯数字>.json` | 見 §2.1 |
| 事件里 `message` 為字符串 | `messageFormat: "string"` | 改為 `"array"` |

---

## 11. 声明

| 項目 | 状態 |
| --- | --- |
| 設定字段、既定値、校験範囲 | **已核実**：來自 `config.ts` 源碼 |
| 鑑權三種方式与 `1401` 応答 | **已核実**：源碼 + 実機験証 |
| HTTP 三種請求写法、`echo`、錯誤碼 | **已核実**：`http-server-adapter.ts` |
| role 語義、路径分類、心搏間隔 | **已核実**：WS 適配器源碼 |
| SSE 幀格式、重連、8 MiB 上限 | **已核実**：`http-sse-connections.ts` |
| 消息段 16/9 種、空文本占位符 | **已核実**：codec 与 parser 源碼 |
| 本文示例之接続地址/端口 | 示例値，**未**於汝之環境実測 |

> 未実測項：反向 WS / 反向 HTTP / SSE 三種方式未於真機建立過接続，
> 上述行為皆來自源碼閲読。
