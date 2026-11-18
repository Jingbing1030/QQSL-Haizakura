# OneBot v11 接入指南

> [!WARNING]
> 本內容完全由 AI 撰寫，請謹慎檢視。

> 本文描述 Haizakura（原 SnowLuma）對 **OneBot v11** 協定的實作：
> 4 種網路接入方式、驗證、訊息格式與事件推送。
>
> **資料來源**：`packages/onebot/src/config.ts`（設定結構與驗證）、
> `packages/onebot/src/network/*.ts`（各配接器實作）、
> `packages/onebot/src/event-filter.ts`（格式分支），
> 並與執行實例 `GET /api/config/:uin` 的實際設定核對。

---

## 1. 接入方式總覽

實作提供 **4 類配接器**（原始碼 `config.ts` 的 `networks` 結構），
其中 HTTP 伺服器還可**額外**開啟 WebSocket 與 SSE：

| 設定鍵 | 方向 | 協定 | 誰主動連線 | 典型用途 |
| --- | --- | --- | --- | --- |
| `httpServers` | 入站 | HTTP + 可選 WS + 可選 SSE | 框架/用戶端 → Haizakura | 最常用；一連接埠三協定 |
| `httpClients` | 出站 | HTTP POST（反向 HTTP） | Haizakura → 你的 HTTP 服務 | 無公網 IP 時上報事件 |
| `wsServers` | 入站 | 正向 WebSocket | 框架/用戶端 → Haizakura | 低延遲雙向 |
| `wsClients` | 出站 | 反向 WebSocket | Haizakura → 你的 WS 服務 | **NapCat / go-cqhttp 生態首選** |

補充開關（都屬於 `httpServers` 條目）：

| 欄位 | 預設 | 作用 |
| --- | --- | --- |
| `enableWebSocket` | `false` | 在同一連接埠額外接受 WebSocket 升級 |
| `enableSse` | `false` | 開放 `GET <path>/_events` 的 SSE 事件串流 |

> **「正向」vs「反向」的判定**：以 **Haizakura 是伺服器端還是用戶端**為準。
> `*Servers` = Haizakura 監聽（正向）；`*Clients` = Haizakura 外連（反向）。

---

## 2. 設定檔與預設值

### 2.1 檔案位置

```
config/onebot.json            # 全局默认
config/onebot_<uin>.json      # 按账号覆盖（uin 纯数字）
```

- 讀取順序：`config/onebot.json` → `config/onebot_<uin>.json`，後者覆寫前者。
- 僅辨識 `onebot_<digits>.json`；形如 `onebot_1700000000.json` 的
  **時間戳式檔名會被忽略**（原始碼 `PER_UIN_CONFIG = /^onebot_(\d+)\.json$/`）。
- 檔案不存在時使用內建預設值（見下）。

### 2.2 內建預設設定

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

> `accessToken` 由 `randomBytes(32).toString("base64url")` 產生，**43 字元**。
> 預設只監聽 `127.0.0.1`；要讓容器外存取必須明確改成 `0.0.0.0`。

### 2.3 各配接器欄位

**通用欄位**（四類都有）

| 欄位 | 類型 | 預設 | 說明 |
| --- | --- | --- | --- |
| `name` | string | 自動產生 | 配接器唯一名，衝突會拒絕載入 |
| `enabled` | bool | `true` | 設 `false` 可停用而不刪設定 |
| `accessToken` | string | 隨機 | 留空 = **不驗證** |
| `messageFormat` | `"array"` \| `"string"` | `"array"` | 訊息欄位格式 |
| `reportSelfMessage` | bool | `false` | 是否上報自己發的訊息 |

自動命名前綴：`httpServers` → `http-`、`httpClients` → `httppost-`、
`wsServers` → `ws-`、`wsClients` → `wsclient-`。

**`httpServers`** 額外：

| 欄位 | 類型 | 預設 | 說明 |
| --- | --- | --- | --- |
| `host` | string | `0.0.0.0` | 監聽位址 |
| `port` | int | — | **必填且 > 0**，否則該條被丟棄 |
| `path` | string | `/` | 基礎路徑 |
| `enableWebSocket` | bool | `false` | 同連接埠接受 WS |
| `enableSse` | bool | `false` | 開放 `_events` |
| `maxPayloadBytes` | int | 見下 | 入站 WS 訊框上限 |

**`wsServers`** 額外：`host`、`port`（必填 > 0）、`path`、
`role`（`Api` / `Event` / `Universal`，預設 `Universal`）、`maxPayloadBytes`。

**`httpClients`** 額外：`url`（必填，除 `enabled:false`）、`timeoutMs`（預設 `5000`）。

**`wsClients`** 額外：`url`（必填）、`role`（預設 `Universal`）、
`reconnectIntervalMs`（預設 `5000`，下限 `1000`）、`maxPayloadBytes`。

`maxPayloadBytes` 取值範圍 **1024 ~ 2147483648**（2 GiB）。
`httpClients` **不接受** `maxPayloadBytes`（會報設定錯誤）。

---

## 3. 驗證（accessToken）

### 3.1 判定邏輯

原始碼 `network/utils.ts`：

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

| 方式 | 寫法 | 適用 | 風險 |
| --- | --- | --- | --- |
| Bearer 標頭 | `Authorization: Bearer <token>` | 全部配接器 | ✅ 推薦 |
| 裸 token 標頭 | `Authorization: <token>` | **僅 HTTP server** | ⚠️ 非標準，易被中介軟體誤解 |
| URL 查詢參數 | `?access_token=<token>` | 全部（WS 握手也支援） | 🔴 **token 進 URL**：會落入存取日誌、瀏覽器歷史、Referer、代理日誌 |

> **建議**：生產環境**只用 Bearer 標頭**。`?access_token=` 僅為相容舊用戶端保留，
> 若必須在瀏覽器中使用，請確保不記錄完整 URL。

### 3.3 未授權回應

```json
{ "status": "failed", "retcode": 1401, "data": null, "wording": "unauthorized" }
```

HTTP 狀態碼 `401`。WS 握手階段則以 `401 Unauthorized` 拒絕升級
（`verifyClient` 回呼，原始碼 `ws-server-adapter.ts`）。

### 3.4 反向連線的驗證方向

| 配接器 | 驗證標頭 |
| --- | --- |
| `httpClients` | `X-Signature: sha1=<HMAC-SHA1(accessToken, body) 十六进制>` |
| `wsClients` | `Authorization: Bearer <accessToken>` |

`httpClients` **不使用** Bearer，而是對**請求主體做 HMAC-SHA1 簽章**
（原始碼 `computeHmacSha1`）。你的接收端需要按同樣演算法校驗。

---

## 4. 設定範例（可直接複製）

### 4.1 HTTP + WS + SSE 單連接埠（推薦）

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

接入位址：HTTP `http://<host>:3000/`，WS `ws://<host>:3000/`，
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

### 4.4 字串訊息格式（相容舊框架）

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

### 4.5 多帳號 / 多配接器並存

`networks` 下每個陣列可放多條，**`name` 必須全域唯一**：

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

### 5.1 路徑 → 動作名對應

以設定的 `path` 為前綴，**路徑剩餘部分即動作名**（原始碼 `http-server-adapter.ts`）：

| 請求路徑（`path: "/"`） | 動作 |
| --- | --- |
| `GET /` | 健康探測，回傳 `{ "status":"ok","retcode":0,"data":{"online":true} }` |
| `POST /send_group_msg` | `send_group_msg` |
| `POST /get_group_list` | `get_group_list` |
| `GET /_events` | SSE 事件串流（需 `enableSse: true`） |

設定 `path: "/onebot"` 時，動作路徑變為 `/onebot/send_group_msg`。

不屬於該前綴的路徑回傳：

```json
{ "status": "failed", "retcode": 1404, "data": null, "wording": "not found" }
```

### 5.2 三種請求寫法

**① 路徑帶動作 + JSON body（最常見）**

```bash
curl -X POST http://127.0.0.1:3000/send_group_msg \
  -H 'Authorization: Bearer REPLACE_WITH_YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"group_id":20001,"message":[{"type":"text","data":{"text":"你好"}}]}'
```

**② JSON body 內嵌 `action`**

```bash
curl -X POST http://127.0.0.1:3000/ \
  -H 'Authorization: Bearer REPLACE_WITH_YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"action":"send_group_msg","params":{"group_id":20001,"message":"hi"},"echo":"req-1"}'
```

**③ GET + 查詢參數**

```bash
curl -G http://127.0.0.1:3000/get_group_member_info \
  -H 'Authorization: Bearer REPLACE_WITH_YOUR_TOKEN' \
  --data-urlencode 'group_id=20001' --data-urlencode 'user_id=10001'
```

也支援 `application/x-www-form-urlencoded` 的 POST。

查詢/表單參數會**逐個嘗試 `JSON.parse`**，失敗則按字串原樣傳入，
因此 `?user_id=10001` 與 `?user_id="10001"` 都能解析為數字。

### 5.3 `echo` 回顯

請求中帶 `echo` 時，回應會**原樣回顯**該欄位（原始碼 `if (echo !== void 0) response.echo = echo;`），
便於非同步並行匹配請求與回應。

### 5.4 方法與錯誤

> ⚠️ **動作層面的失敗仍回傳 HTTP `200`**。
> `retcode 100/1400/1404/1200` 都出現在 **HTTP 200** 的回應主體裡。
> 請按 `retcode` 判斷成敗，不要只看 HTTP 狀態碼。

| 情況 | HTTP | retcode | wording |
| --- | --- | --- | --- |
| 動作成功 | `200` | `0` | — |
| 參數驗證失敗 | **`200`** | `1400` | 如 `group_id is required` |
| 動作執行失敗 | **`200`** | `100` | 具體原因 |
| 動作不存在 | **`200`** | `1404` | `unknown action` |
| 非 GET/POST | `405` | `1400` | `method not allowed` |
| 缺 `action` | `400` | `1400` | `bad request: missing action` |
| JSON 語法錯誤 | `400` | `1400` | `bad request: invalid json` |
| 不支援的 Content-Type | `400` | `1400` | `bad request: unsupported content-type: ...` |
| 請求主體過大 | `413` | `1413` | — |
| 內部異常 | `500` | `1200` | 異常資訊 |
| 服務正在關閉 | `503` | `1200` | `server closing` |
| 未授權 | `401` | `1401` | `unauthorized` |
| 路徑不在 `path` 前綴下 | `404` | `1404` | `not found` |

---

## 6. WebSocket 接入詳解

### 6.1 三種 role

`role` 決定該連線**收發哪些內容**（原始碼 `ws-server-connections.ts` /
`ws-client-adapter.ts`）：

| role | 接收事件 | 接受動作請求 |
| --- | --- | --- |
| `Api` | ✗ | ✔ |
| `Event` | ✔ | ✗ |
| `Universal` | ✔ | ✔ |

- 事件只推給 `Event` / `Universal` 連線。
- 動作請求只接受來自 `Api` / `Universal` 連線的入站訊息。
- `Event` 連線發來的動作請求會被**忽略**（不報錯）。

### 6.2 路徑分類（正向 WS）

當 `path` 為 `"/"` 且 `role` 為 `Universal` 時，可按**子路徑**區分角色：

| 路徑 | 解析出的 role |
| --- | --- |
| `/` | `Universal` |
| `/api` | `Api` |
| `/event` | `Event` |

以 `/api` 結尾 → `Api`；以 `/event` 結尾 → `Event`；其餘 → `Universal`。
路徑不符合設定時握手被拒（`400 Bad path for WebSocket`）。

### 6.3 正反向握手的請求標頭

**反向 WS（`wsClients`，Haizakura 作為用戶端）** 送出：

```
User-Agent: OneBot/11
X-Self-ID: <uin>
X-Client-Role: Universal | Api | Event
Authorization: Bearer <accessToken>     # 仅在配置了 token 时
```

**反向 HTTP（`httpClients`）** 送出：

```
Content-Type: application/json
User-Agent: OneBot
X-Self-ID: <uin>
X-Signature: sha1=<HMAC-SHA1(accessToken, 原始body) 的 hex>
```

### 6.4 心跳與重新連線

**伺服器端 → 用戶端（meta 事件）**：`OneBotInstance.HEARTBEAT_INTERVAL = 30000` ms，
每 30 秒推送一次 `meta_event` / `heartbeat`（詳見 `events.md`）。

**反向 WS 的存活探測**：`HEARTBEAT_INTERVAL_MS = 30000`、
`HEARTBEAT_MAX_MISSED = 2`，即約 **90 秒**無入站回應即判定半開連線並重新連線
（`HEARTBEAT_DEAD_AFTER_S = 30 * 3 / 1000`）。

**重新連線間隔**：`reconnectIntervalMs`，預設 `5000`，下限 `1000`。

### 6.5 反向 WS 連線時先補發 meta 事件

連線建立後，伺服器端會立刻推送 bootstrap 元事件（生命週期等），
隨後才推送增量事件。用戶端應能容忍「連線後立即收到 meta_event」。

---

## 7. SSE 接入詳解

### 7.1 開啟與位址

```json
{ "name": "main", "host": "0.0.0.0", "port": 3000, "enableSse": true }
```

事件串流位址：**`GET <path>/_events`**（`path` 為 `/` 時即 `/_events`）。

未開啟時存取回傳：

```json
{ "status": "failed", "retcode": 1404, "data": null, "wording": "SSE is disabled" }
```

非 GET 方法回傳 `405` + `retcode 1405` + `wording: "SSE requires GET"`。

### 7.2 回應標頭與幀格式

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
Connection: keep-alive
```

建立連線後首先送出 `retry: 3000`，隨後每幀：

```
id: <epoch-uuid>:<sequence>
data: <事件 JSON>

```

每 **15 秒** 送出一次註解行 `: ping` 作為保活。

### 7.3 斷線重連與 `Last-Event-ID`

用戶端可在重連時回傳 `Last-Event-ID: <epoch>:<sequence>` 請求補發：

| 情況 | 回應 |
| --- | --- |
| 格式非法 | `400` `invalid Last-Event-ID` |
| epoch 不匹配 / 序號越界 / 已被丟棄 | `409` `SSE replay unavailable; resync and reconnect without Last-Event-ID` |

收到 `409` 時應**清空 `Last-Event-ID` 重新連線**並從目前狀態重建。

### 7.4 緩衝上限

單連線積壓超過 **8 MiB**（`CLIENT_BYTES = 8 * 1024 * 1024`）會被**主動斷開**，
日誌提示 `SSE client exceeded N buffered bytes; disconnecting`。
慢速消費者應改用 WebSocket 或分片拉取。

---

## 8. 訊息格式：`array` vs `string`

由每個配接器的 `messageFormat` 決定**事件中 `message` 欄位**的形態：

| 值 | `message` 欄位 | 說明 |
| --- | --- | --- |
| `"array"`（預設） | 訊息段陣列 | 結構化，推薦 |
| `"string"` | CQ 碼字串 | 取 `raw_message` 的值 |

原始碼 `event-filter.ts`：

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

注意：僅**訊息類事件**受影響；`message_sent`（自己發的訊息）在
`reportSelfMessage: false` 時**整個事件被丟棄**。

**發送方向不受 `messageFormat` 限制**：`message` 參數既可傳陣列，
也可傳 CQ 碼字串（`[CQ:face,id=1]`）或物件，由 `parseMessage` 解析。
`auto_escape: true` 時字串中的 CQ 碼**不被解析**，按純文字傳送。

### 8.1 訊息段類型

**接收方向**（元素 → 段，原始碼 `element-codecs.ts` 的 `ELEMENT_CODECS`，共 **16** 種）：

```
text  face  at  reply  image  record  video  json  xml
file  mface  poke  flash_file  forward  markdown  inline_keyboard
```

**發送方向**另有 9 種**相容段**會被轉換成上述元素
（原始碼 `message-parser.ts` 的 `segmentToElement`）：

```
node  share  music  location  contact  rps  dice  shake  anonymous
```

> `node` 只允許出現在**合併轉發**（forward node 清單）內部；
> 頂層使用會報 `UNSENDABLE_TYPE`。
> `share` / `music` 會被轉換為 `json` 卡片；`music` 的 `custom` 類型
> 需要外鏈簽章服務（預設 `https://ss.xingzhige.com/music_card/card`）。

**空文字佔位符規則**（原始碼 `isExplicitEmptyTextPlaceholder`）：
段陣列中 `text` 欄位**恰為空字串 `""`** 的 text 段視為**相容佔位符**，
不計入「可傳送段」；而欄位**缺失 / `null` / 僅空白**仍走正常校驗。

---

## 9. 快速驗證

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

> ⚠️ **`get_supported_actions` 未實作**。這是 OneBot v11 的標準動作，
> 但本實作**沒有提供**，呼叫回傳：
>
> ```json
> { "status": "failed", "retcode": 1404, "data": null, "wording": "unknown action" }
> ```
>
> `_get_supported_actions` 同樣不存在。**需要動作清單時請改用 WebUI 的
> `GET /api/debug/actions`**（見 `webui/api.md`），它回傳全部 222 個動作的
> 完整文件。

### 實測結果（2026-11-13，執行實例）

| 請求 | 結果 |
| --- | --- |
| `POST /get_version_info` 無 token | HTTP `401`，`retcode 1401`，`unauthorized` |
| `POST /get_version_info` 帶 token | `{"app_name":"Haizakura","app_version":"0.2.4.2-node","protocol_version":"v11"}` |
| `GET /` 帶 token | `{"status":"ok","retcode":0,"data":{"online":true}}` |
| `POST /get_supported_actions` | `retcode 1404`，`unknown action` ❌ |
| `POST /get_status` | `{"online":true,"good":true,"time":3793}` |
| `POST /can_send_image` | `{"yes":true}` |
| `POST /get_login_info` | `{"user_id":<uin>,"nickname":"HaizakuraBot"}` |

### SSE 驗證

```bash
curl -N -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/_events
```

---

## 10. 常見問題

| 現象 | 原因 | 處理 |
| --- | --- | --- |
| `retcode 1401 unauthorized` | token 不匹配或未傳 | 檢查 `Authorization: Bearer` |
| `retcode 1404 not found` | 路徑不在 `path` 前綴下 | 核對 `path` 設定 |
| `1404` + `SSE is disabled` | 未開 `enableSse` | 打開開關並重載 |
| WS 握手 `400 Bad path` | 路徑與 `path`/role 規則不符 | 見 §6.2 |
| 收不到事件 | 連線 role 為 `Api` | 改用 `Event` / `Universal` |
| 自己發的訊息不推送 | `reportSelfMessage: false` | 設 `true` |
| 連接埠不生效 | `port <= 0` 的條目被丟棄 | 設合法連接埠（1–65535） |
| 設定不生效 | 檔名不是 `onebot_<純數字>.json` | 見 §2.1 |
| 事件裡 `message` 是字串 | `messageFormat: "string"` | 改為 `"array"` |

---

## 11. 聲明

| 項目 | 狀態 |
| --- | --- |
| 設定欄位、預設值、驗證範圍 | **已核實**：來自 `config.ts` 原始碼 |
| 驗證三種方式與 `1401` 回應 | **已核實**：原始碼 + 實機驗證 |
| HTTP 三種請求寫法、`echo`、錯誤碼 | **已核實**：`http-server-adapter.ts` |
| role 語意、路徑分類、心跳間隔 | **已核實**：WS 配接器原始碼 |
| SSE 幀格式、重連、8 MiB 上限 | **已核實**：`http-sse-connections.ts` |
| 訊息段 16/9 種、空文字佔位符 | **已核實**：codec 與 parser 原始碼 |
| 本文範例的連線位址/連接埠 | 範例值，**未**在你的環境實測 |

> 未實測項：反向 WS / 反向 HTTP / SSE 三種方式未在真機建立過連線，
> 上述行為均來自原始碼閱讀。
