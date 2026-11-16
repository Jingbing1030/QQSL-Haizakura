# Satori 協定接入指南

> [!WARNING]
> 本內容完全由 AI 撰寫，請謹慎檢視。

> 本文描述 Haizakura（原 SnowLuma）對 **Satori 協定**（`satori.chat`）的實作：
> 如何用 **path 哨兵**啟用伺服器、24 個 API、事件與資源對應、訊息元素收發，
> 以及與 LLBot 的差異。
>
> **資料來源**：`packages/onebot/src/network/satori-server-adapter.ts`（1445 行，傳輸層 + API 表）、
> `packages/onebot/src/network/satori-mount.ts`（95 行，掛載層）、
> `packages/onebot/src/config.ts`（`wsServers` 解析與驗證）、
> `scripts/tests/driver-protocol.mjs`（76 斷言）、`scripts/tests/driver-integration.mjs`（22 斷言）。
>
> **測試狀態**：`node scripts/tests/run-satori-tests.mjs` → **76/76 通過**；
> `node scripts/tests/run-satori-integration.mjs` → **22/22 通過**（合計 **98/98**，2026-11-13 實跑）。

---

## 1. 簡介

### 1.1 Satori 是什麼

Satori 是一套**跨平台聊天機器人協定**（<https://satori.chat>），由 Koishi 生態維護。
它把不同聊天平台（QQ、Discord、Telegram…）抽象成統一的一組**資源**
（`User` / `Channel` / `Guild` / `GuildMember` / `Message` / `Reaction`…），
應用層只面向這套資源撰寫程式：

| 通訊方式 | 用途 | 本文對應章節 |
| --- | --- | --- |
| **HTTP API** | 主動呼叫（傳訊息、查群、踢人…） | §3 / §4 |
| **WebSocket** | 被動接收事件串流 | §3 / §6 |
| WebHook | 另一種事件接收方式 | ❌ 本實作**未提供** |

### 1.2 為什麼 Haizakura 支援它

**因為 Satori 有現成的 SDK 生態，接進來就能直接用。** 支援 Satori 之後：

- **Koishi** 可透過 Satori 配接器直接連上 Haizakura，無需再寫 OneBot 橋接；
- **`@satorijs/satori`** 等官方 SDK 可直接對接，不必手寫 HTTP/WS 協定堆疊；
- 應用層程式可以**跨平台重用** —— 同一份邏輯既能跑在 QQ（Haizakura），也能跑在別的 Satori 實作上。

### 1.3 與 OneBot v11 的關係

**兩者並存，不互相取代，可同時啟用。**

| 維度 | OneBot v11 | Satori |
| --- | --- | --- |
| 定位 | QQ 生態事實標準 | 跨平台抽象 |
| 設定位置 | `networks.*`（4 類配接器） | **重用 `networks.wsServers[]`**（見 §2） |
| 連接埠 | 各自獨立 | 各自獨立，**可與 OneBot 同時監聽不同連接埠** |
| 事件/動作模型 | `post_type` + 222 個動作 | 12 類事件 + 24 個方法 |

同一個帳號可以同時開一個 OneBot WS 伺服器和一個 Satori 伺服器，`emitEventNow()`
會把每個事件**同時扇出**給兩邊（原始碼 `network-manager.ts`，整合測試
`manager-fed EVENT has channel+user promoted` 已斷言）。

> OneBot v11 的完整說明見 [`onebot11.md`](onebot11.md)、[`events.md`](events.md)、[`actions.md`](actions.md)。

---

## 2. ⚠️ 如何啟用（sentinel 機制）

> **本節是全文最重要的部分。** Haizakura 的 Satori 伺服器**沒有獨立設定項**，
> 而是**重用 OneBot 的 `wsServers[]` 清單**，靠 `path` 欄位識別。

### 2.1 識別規則

```
wsServers[] 中 path === "/v1/events" 的条目  =  Satori 服务器
```

判定邏輯（原始碼 `satori-mount.ts` 的 `satoriMountIsSatoriServer`）：

1. 取 `path` 欄位（非字串時按 `"/"` 處理）；
2. 去掉查詢串（`?` 之後）與**尾部斜線**；
3. 與 `"/v1/events"` **精確相等**才算 Satori。

因此以下各寫法識別結果如下：

| 設定的 `path` | 識別為 |
| --- | --- |
| `/v1/events` | ✅ Satori |
| `/v1/events/` | ✅ Satori（容忍尾部斜線） |
| `/v1/events?x=1` | ✅ Satori（容忍查詢串） |
| `/v1/eventsfoo` | ❌ 一般 OneBot WS |
| `/satori/v1/events` | ❌ **不匹配**（只認精確值，不是前綴匹配） |
| `/` | ❌ 一般 OneBot WS |

> 掛載方式是 patch `OneBotInstance.prototype.createNetworkAdapter`
> （原始碼 `satori-mount.ts`）：先判斷是不是 `kind === "wsServer"` 且 `path` 命中哨兵，
> 命中就回傳 `SatoriServerAdapter`，否則**原樣交回**原生實作。
> 整合測試已斷言一般 `/` 條目仍然得到 `WsServerAdapter`（`normal path -> WsServerAdapter (unchanged)`）。

### 2.2 完整設定範例（可直接複製）

`POST /api/config/:uin` 會**嚴格驗證整個設定物件**（`assertValidOneBotConfig`），
所以下面給出**完整可提交**的形狀（`statusCommand`、`historySync` 缺一不可）：

```json
{
  "networks": {
    "wsServers": [
      {
        "name": "satori-main",
        "host": "0.0.0.0",
        "port": 5600,
        "path": "/v1/events",
        "accessToken": "<your-token>",
        "messageFormat": "array",
        "reportSelfMessage": false
      }
    ],
    "httpServers": [],
    "httpClients": [],
    "wsClients": []
  },
  "statusCommand": { "enabled": false, "swallow": false, "cooldownSeconds": 5, "trigger": "#Haizakura" },
  "historySync": { "enabled": false },
  "notifications": { "channelIds": [] }
}
```

> ⚠️ 把 `accessToken` 原樣填成 `<your-token>` 佔位符會被**權杖強度原則拒絕**
> （少於 16 字元）：請換成真實隨機 token，例如
> `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`（43 字元）。
> 若從**本機回送位址**儲存、或把 `host` 綁回 `127.0.0.1`，才允許留空（= 不驗證）。

欄位說明（沿用 `wsServers` 語意）：

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `name` | 建議 | 配接器唯一名，**全域不可與其它 kind 重名** |
| `host` | — | 預設 `0.0.0.0`；要跨機存取需明確寫 `0.0.0.0` |
| `port` | **✔** | 1–65535，**> 0** 且不可與其它監聽條目衝突 |
| `path` | **✔** | 必須**精確等於** `/v1/events`，這是哨兵 |
| `accessToken` | 建議 | 留空 = **不驗證**（⚠️ 結合 §6.5 的未驗證視窗，等於完全開放） |
| `messageFormat` | — | ⚠️ **對 Satori 無效**（見 §9） |
| `reportSelfMessage` | — | ⚠️ **對 Satori 無效**（見 §9） |
| `role` | 可選 | 預設 `Universal`，**對 Satori 完全無意義、被忽略**（寫 `Api`/`Event` 也照常收發事件，實測確認） |
| `maxPayloadBytes` | 可選 | 入站 WS 訊框上限（`wsServers` 通用欄位） |
| `enabled` | 可選 | 設 `false` 則工廠仍回傳 Satori 配接器，但 `open()` 直接回傳、**不監聽** |

**只有 `wsServers` 一條也能通過檔案驗證**：若透過 `config/onebot_<uin>.json`
檔案設定，`fromJson` 會補齊 `statusCommand` / `historySync` / 其餘三個網路陣列的預設值，
所以設定檔裡可以只寫 `networks.wsServers`。**WebUI 的 POST 介面不接受省略**，請用上面的完整形狀。

> **不要往哨兵條目裡加 Satori 專屬欄位**：`wsServers` 的欄位集是固定的
> （`name` / `enabled` / `accessToken` / `messageFormat` / `reportSelfMessage` /
> `host` / `port` / `path` / `role` / `maxPayloadBytes`）。實測三種路徑的表現不同：
>
> | 路徑 | 未知欄位行為 |
> | --- | --- |
> | `POST /api/config/:uin`（儲存） | **靜默接受**，不報錯 |
> | `fromJson`（載入檔案） | **靜默丟棄**（產出物件裡沒有該欄位） |
> | 設定匯入/回復（`validateOneBotRestoreSource`） | **明確拒絕**：`$.networks.wsServers[0].xxx is not supported` |
>
> 也就是說 WebUI 儲存**不會報錯**，但欄位在下次載入時就消失了 —— 別指望它生效。
> 這也正是本配接器**必須自包含**（不依賴額外設定欄位）的原因。

### 2.3 為什麼用這種「哨兵」方式？（設計取捨）

Haizakura 的設定模組 `config.ts` 裡，
`fromJson` 與 `toJsonObject` **硬編碼了 4 個 kind**（`httpServers` / `httpClients` /
`wsServers` / `wsClients`），`RESTORE_NETWORK_KEYS` 也是固定集合。

想新增第 5 個 kind（如 `satoriServers`）必須改 `config.ts` 本體：

- `config.ts:222` 會走訪 `RESTORE_NETWORK_KEYS` 並讀 `parsed.networks[key].length` ——
  `fromJson` 的輸出裡沒有新 kind，於是 `undefined.length` 直接 **TypeError**，
  整個設定儲存/回復鏈路不可用；
- `validateRestoreAdapterArray` 對未知 kind 會要求 `url` 欄位，形狀對不上。

而 `config.ts` 是**現有 region**，改動需要**重新編號 432 個 region**（原始碼 `satori-mount.ts`
頂部註解明確記錄了這一結論：*「新增 kind 必須改 config.ts 本體，而那是現有 region
（改它要重編號 432 個 region）」*）。

**v2 方案（目前實作）**：重用現有 `wsServers[]`，只 patch **1 個原型方法**。收益：

- 設定管線 **100% 重用** —— 解析、驗證、序列化、熱重載、**連接埠衝突偵測**全部繼續生效；
- 不碰 `config.ts`，零 region 重新編號風險；
- 整合測試已斷言 `RESTORE_NETWORK_KEYS not polluted`（未被污染）、
  `compileDesiredPlan NOT patched (v2 minimal)`（只改了 1 個方法）。

**代價（必須知情）**：

- WebUI 的網路狀態清單裡，這條會顯示在**「WS 伺服器」分組**下；
  不過**狀態標籤（`kind`）仍然是 `satoriServer`**，`detail` 會顯示
  `Satori v1 · N 個事件用戶端`**（原始碼 `describeStatus()`，整合測試
  `Satori adapter describeStatus().kind` 已斷言）；
- 反過來，**`/v1/events` 這個 path 不能再分配給 OneBot WS 使用** ——
  誰寫 `path: "/v1/events"`，誰就變成 Satori 伺服器（見 §2.5）。

### 2.4 熱更新（不用重新啟動，不丟登入狀態）

設定可透過 WebUI 的 `POST /api/config/:uin` **熱更新**：

```bash
curl -X POST http://127.0.0.1:3080/api/config/10001 \
  -H 'Content-Type: application/json' \
  -d @satori-config.json
```

成功回應形如：

```json
{ "success": true, "saved": true, "applied": true, "online": true,
  "reloaded": true, "message": "配置保存成功，已热重载当前会话。", "errors": [], "adapters": [] }
```

- **不需要重新啟動行程，也不會遺失登入狀態**（走 `oneBotManager.reloadConfig`）；
- 會話不在線時儲存仍成功，但 `online: false`，**下次連線才生效**；
- 權杖輪換會**主動斷開已連線的事件用戶端**：`closeConnections(1008, "access token changed")`
  （原始碼 `onConfigReplaced`）—— 用戶端需重新 IDENTIFY。

> ⚠️ **遠端儲存的權杖原則**：`wsServers` 屬於入站節點（`INBOUND_KINDS`），
> 透過非回送位址儲存時，**`accessToken` 不能為空，且至少 16 個字元**，
> 還不能是易猜值（原始碼 `onebot-token-policy.ts`）。綁回 `127.0.0.1` 或從本機儲存才允許留空。

### 2.5 與 OneBot 同時啟用的寫法

```json
{
  "networks": {
    "wsServers": [
      { "name": "satori-main", "host": "0.0.0.0", "port": 5600, "path": "/v1/events",
        "accessToken": "<satori-token>", "messageFormat": "array", "reportSelfMessage": false },
      { "name": "ob-ws", "host": "0.0.0.0", "port": 3001, "path": "/",
        "role": "Universal", "accessToken": "<onebot-token>",
        "messageFormat": "array", "reportSelfMessage": false }
    ],
    "httpServers": [], "httpClients": [], "wsClients": []
  },
  "statusCommand": { "enabled": false, "swallow": false, "cooldownSeconds": 5, "trigger": "#Haizakura" },
  "historySync": { "enabled": false },
  "notifications": { "channelIds": [] }
}
```

- 兩條必須**連接埠不同**，否則驗證直接拒絕（`networks.wsServers[1] conflicts with networks.wsServers[0] on server binding ...`）；
- `name` 在**所有 kind 之間**唯一，重名報 `network adapter name "..." is duplicated in ... and ...`；
- Satori 可以開**多條**（不同連接埠），互不影響。

---

## 3. 接入方式

### 3.1 HTTP API

```
POST http://<host>:<port>/v1/{resource}.{method}
Content-Type: application/json
```

- 請求主體是 **JSON 物件**（陣列或純量會被拒：`请求体必须是 JSON 对象`）；
  空請求主體被當作 `{}` 處理（實測 `200`）；
- `Content-Type` **不做驗證**：`application/json` / `text/plain` / 完全不傳
  都能正常處理（實測均 `200`）。規範建議用 `application/json`，本實作只是不強制；
- 方法名就是**路徑剩餘部分**，例如 `POST /v1/login.get`、`POST /v1/message.create`；
  方法路徑**允許帶查詢串**（`/v1/login.get?x=1` 實測 `200`，查詢參數被忽略）；
- ⚠️ **不會再拼一層 `/v1`**。因為哨兵 `path` 本身就是 `/v1/events`，
  原始碼 `mountPrefix()` 對 `/` 和 `/v1/events` 都回傳空字串，
  所以端點是 `/v1/<method>`，**不是** `/v1/events/v1/<method>`
  （原始碼註解：*"must NOT append another `/v1`"*；測試斷言
  `route: POST /v1/login.get (no double /v1)`）。

### 3.2 WebSocket 事件串流

```
GET ws://<host>:<port>/v1/events      （HTTP Upgrade）
```

- 路徑必須**精確等於** `/v1/events`，否則升級被拒：`abortUpgrade(socket, 404, "Not Found")`；
- 用**一般 GET**（沒做 upgrade）存取該路徑 → `405` + `Allow: GET` + `please connect with WebSocket`。

### 3.3 必需請求標頭

| 標頭 | 值 | 必需性 |
| --- | --- | --- |
| `Satori-Platform` | **`haizakura`** | ⚠️ 見下 |
| `Satori-User-ID` | 帳號 uin | 可選（**若提供則必須匹配**） |
| `Authorization` | `Bearer <accessToken>` | 設定了 token 時必需 |

**`Satori-Platform` 的正確值是 `haizakura`，不是 `qq`！**

```bash
curl -X POST http://127.0.0.1:5600/v1/login.get \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <your-token>' \
  -H 'Satori-Platform: haizakura' \
  -H 'Satori-User-ID: 10001' \
  -d '{}'
```

實測行為（原始碼 `handleRequest` + 我實跑驗證）：

| 情況 | 結果 |
| --- | --- |
| `Satori-Platform: haizakura` | `200` ✅ |
| **`Satori-Platform: qq`** | **`403`** `{"message":"login not found"}` |
| **完全不傳** `Satori-Platform` | `200`（**缺失被容忍**） |
| `Satori-User-ID` 與目前帳號不符 | `403` `{"message":"login not found"}` |
| 完全不傳 `Satori-User-ID` | `200`（**缺失被容忍**） |

> 即：兩個標頭**只在「提供了但值不對」時拒絕**。SDK 預設都會帶上
> `Satori-Platform`，所以只要平台標識填對（`haizakura`）就沒問題；
> 若你手寫用戶端，**漏傳也能通**，但**傳 `qq` 一定 403**。

### 3.4 狀態碼表

| 碼 | 觸發條件 | 回應主體 |
| --- | --- | --- |
| `200` | 成功 | 方法回傳值（各方法不同，見 §4） |
| `400` | 參數缺失/非法、JSON 語法錯誤、請求主體非物件、下游動作失敗 | `{"message":"..."}` |
| `401` | 設定了 token 但**未帶** `Authorization` | `{"message":"authorization required"}` |
| `403` | token 不匹配 / `Satori-Platform` 或 `Satori-User-ID` 不符 | `{"message":"invalid token"}` 或 `"login not found"` |
| **`404`** | **方法不在 24 個白名單內**、路徑不在 `/v1/` 前綴下 | `{"message":"method not found"}` / `"not found"` |
| `405` | 對方法路徑用了非 POST；對 `/v1/events` 用了普通 GET | 帶 `Allow` 標頭 |
| `413` | 請求主體超過 **64 MiB**（`readRequestBody` 預設上限） | `{"message":"request body too large"}` |
| `503` | 服務正在關閉（`acceptingActions === false`） | `{"message":"server closing"}` |

> **重點：不支援的 API 回傳 `404`，不是 `501`。** 這符合 Satori 規範
>（*「平台不支援的 API 應回傳 404；只有平台支援但配接器未實作才回傳 501」*）。
> 原始碼註解亦明確：*"an unsupported API must answer 404, never 501"*。
>
> **注意**：Satori 的錯誤主體是**扁平的 `{message}`**，與 OneBot 的
> `{status, retcode, data, wording}` **完全不同**。別把兩套錯誤處理混用。

### 3.5 驗證順序（易踩雷）

HTTP 請求按以下順序處理，**驗證不是第一步**：

1. `acceptingActions` 為假 → `503`；
2. 路徑是 `/v1`（或 `/v1/`）→ `404 method not found`；
3. 路徑不以 `/v1/` 開頭 → `404 not found`；
4. 方法名是 `events` → `405`（提示用 WebSocket）；
5. 方法不是 `POST` → `405`；
6. **然後才驗證 `Authorization`**：無 → `401`，不匹配 → `403`；
7. 驗證 `Satori-User-ID`、`Satori-Platform` → 不符 `403`；
8. 方法不在 `SATORI_API` 白名單 → `404`。

> 因此：**未驗證的請求，`404`/`405` 會先於 `401` 回傳**。
> 另外，`accessToken` 留空時**整個驗證步驟被跳過** —— 連傳錯的 token 也會放行。

---

## 4. API 清單（24 個）

原始碼 `SATORI_API` 表**恰好 24 條**，與 `SATORI_FEATURES` 宣告的 26 個特性一致
（26 = 24 個方法 + `message.list.from` + `guild.plain`，後兩個是**能力標記**而非方法）。

**約定**：

- 所有方法都是 `POST`，參數放在 JSON 請求主體；
- ID 類參數在線上都是**字串**（`user_id`/`group_id` 傳數字也能被 `toInt` 容錯）；
- 失敗時拋錯 → HTTP `400` + `{"message":"..."}`。

### 4.1 登入

#### `login.get`

| 項 | 值 |
| --- | --- |
| 參數 | 無 |
| 轉發到 | `get_login_info` |
| 回傳 | `Login`：`{sn, adapter, platform, user, status, features}` |

```json
{
  "sn": 1,
  "adapter": "haizakura",
  "platform": "haizakura",
  "user": { "id": "10001", "avatar": "http://q.qlogo.cn/headimg_dl?dst_uin=10001&spec=640",
            "is_bot": false, "name": "HaizakuraBot", "nick": "HaizakuraBot" },
  "status": 1,
  "features": ["login.get", "message.create", "... 共 26 项"]
}
```

> `status`：`1` = ONLINE，`0` = OFFLINE。
> `get_login_info` 失敗時**不報錯**，會用 `ctx.uin` 兜底回傳一個 Login。

### 4.2 訊息

| 方法 | 轉發到 | 參數 | 回傳 |
| --- | --- | --- | --- |
| `message.create` | `send_msg` | `channel_id` **✔**, `content` **✔** | `Message[]`（長度 1） |
| `message.get` | `get_msg` | `message_id` **✔**（`channel_id` 未使用） | `Message` |
| `message.delete` | `delete_msg` | `message_id` **✔** | `null` |
| `message.list` | `get_group_msg_history` / `get_friend_msg_history` | `channel_id` **✔**, `limit`, `next`/`message_id`, `order` | `BidiList`：`{data, next?}` |

**`message.create`** —— Satori `content`（元素串）→ OneBot 訊息段：

- `channel_id` 為純數字 → 群聊，走 `{message_type:"group", group_id}`；
- `channel_id` 為 `private:<uin>` → 私聊，走 `{message_type:"private", user_id}`；
- `content` 解析後**沒有可傳送元素** → `400 content must contain at least one sendable element`；
- 回傳的 `Message.created_at` 用 `Date.now()`（**毫秒**），`id` 為 `send_msg` 回傳的
  `message_id` 的**字串**形式；
- 若本機 `get_msg` 查不到剛落庫的自發訊息，**退回為回顯提交的 content**，而不是讓已成功的傳送報錯。

```bash
curl -X POST http://127.0.0.1:5600/v1/message.create \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer <your-token>' \
  -H 'Satori-Platform: haizakura' -H 'Satori-User-ID: 10001' \
  -d '{"channel_id":"20001","content":"你好 <at id=\"30003\"/> <emoji id=\"1\"/> <img src=\"https://x/y.png\"/>"}'
```

**`message.list`** 的分頁語意（⚠️ **近似實作**，見 §9）：

- `limit` 缺省/≤0/>100 時**退回為 50**；
- `next`（或 `message_id`）作為錨點傳給 OneBot 的 `message_id`；
- `order: "asc"` → `reverse_order: false`；缺省或 `"desc"` → `reverse_order: true`；
- **僅當回傳行數 ≥ limit** 時才給 `next`，值是**本頁最後一條的 `id`** ——
  這是「用訊息 ID 當游標」的近似，不是協定要求的真游標；
- `prev` 與 `direction`（`before`/`after`/`around`）**均不支援**。

### 4.3 頻道（Channel）

| 方法 | 轉發到 | 參數 | 回傳 |
| --- | --- | --- | --- |
| `channel.get` | 群聊 → `get_group_info`；私聊 → `get_stranger_info` | `channel_id` **✔** | `Channel` |
| `channel.list` | `get_group_info` | `guild_id` **✔** | `{data:[Channel]}`（恆 1 條） |

- 群聊 `channel_id` = 群號字串，回傳 `type: 0`（TEXT）+ `name` = 群名；
- 私聊 `channel_id` = `private:<uin>`，回傳 `type: 1`（DIRECT），
  `name` 取陌生人暱稱（失敗則不帶 `name`）；
- `channel.list` 因為 **QQ 一群一頻道**（`guild.plain`），只回傳該群自身這一個頻道。

### 4.4 群組（Guild）

| 方法 | 轉發到 | 參數 | 回傳 |
| --- | --- | --- | --- |
| `guild.get` | `get_group_info` | `guild_id` **✔** | `Guild` |
| `guild.list` | `get_group_list` | 無 | `{data:[Guild]}` |
| `guild.approve` | `set_group_add_request`（`sub_type:"invite"`） | `message_id` **✔**（=flag）, `approve`, `comment` | `null` |

`Guild` 形狀：`{id, name, avatar}`，其中 `avatar` 是
`https://p.qlogo.cn/gh/{group_id}/{group_id}/640`。

> `guild.approve` 的 `message_id` 實際是**請求 flag** —— 取自
> `guild-request` 事件的 `message.id`。`approve` **缺省為 true**
> （`source.approve !== false`）。

### 4.5 群成員（GuildMember）

| 方法 | 轉發到 | 參數 | 備註 |
| --- | --- | --- | --- |
| `guild.member.get` | `get_group_member_info` | `guild_id` **✔**, `user_id` **✔** | 回傳單個 `GuildMember` |
| `guild.member.list` | `get_group_member_list` | `guild_id` **✔** | `{data:[GuildMember]}` |
| `guild.member.kick` | `set_group_kick` | `guild_id`, `user_id`, `permanent` | `permanent:true` → `reject_add_request:true` |
| `guild.member.mute` | `set_group_ban` | `guild_id`, `user_id`, `duration`（**毫秒**） | 換算見下 |
| `guild.member.role.set` | `set_group_admin` | `guild_id`, `user_id`, `role_id` | 只能表達「管理員/非管理員」 |
| `guild.member.approve` | `set_group_add_request`（`sub_type:"add"`） | `message_id`（=flag）, `approve`, `comment` | 入群申請 |

**`GuildMember` 形狀**：

```json
{
  "user": { "id": "30003", "avatar": "http://q.qlogo.cn/headimg_dl?dst_uin=30003&spec=640",
            "is_bot": false, "name": "群名片", "nick": "群名片" },
  "nick": "群名片",
  "avatar": "http://q.qlogo.cn/headimg_dl?dst_uin=30003&spec=640",
  "joined_at": 1600000000000,
  "roles": [ { "id": "3", "name": "admin" } ]
}
```

要點：

- `user.name` / `user.nick` 取 `card || nickname`（**群名片優先**）；
- **`joined_at` 是毫秒**：`join_time`（秒）× 1000；`join_time` ≤ 0 時**該欄位不出現**；
- `roles` **恆為長度 1 的陣列**（QQ 只有單角色階梯）；
- `member.avatar` 與 `user.avatar` 相同（QQ 無獨立群頭像）。

**`guild.member.mute` 的單位換算**（重要）：

```
Satori duration 是毫秒；OneBot set_group_ban 收秒。
seconds = duration <= 0 ? 0 : max(1, ceil(duration / 1000))
```

即 `duration: 60000` → `duration: 60`（測試已斷言 `ms->s (60000->60)`）；
`duration: 0` → 解禁。

**`guild.member.role.set` 的表達力限制**：

```
role_id ∈ {"3","admin"} → set_group_admin { enable: true }
role_id ∈ {"4","owner"} 或其它 → set_group_admin { enable: false }   ← 降级为普通成员
```

> 即 **QQ 的「轉讓群主」無法透過本方法表達**：傳 `role_id: "4"` 會被當作**取消管理員**。
> 設 `role_id: "3"` 是唯一有意義的呼叫（測試斷言 `role.set -> enable:true`）。

### 4.6 群組角色（GuildRole）

#### `guild.role.list`

| 項 | 值 |
| --- | --- |
| 參數 | `guild_id` **✔**（僅驗證 > 0） |
| 回傳 | **靜態** 3 條，**不存取網路** |

```json
{ "data": [
  { "id": "4", "name": "owner",  "position": 3 },
  { "id": "3", "name": "admin",  "position": 2 },
  { "id": "2", "name": "member", "position": 1 }
] }
```

> 測試斷言 `guild.role.list -> 3 static roles`。

### 4.7 表態（Reaction）

| 方法 | 轉發到 | 參數 | 回傳 |
| --- | --- | --- | --- |
| `reaction.create` | `set_msg_emoji_like`（`set:true`） | `message_id` **✔**, `emoji_id` **✔** | `null` |
| `reaction.delete` | `set_msg_emoji_like`（`set:false`） | `message_id` **✔**, `emoji_id` **✔** | `null` |
| `reaction.list` | `get_emoji_likes` | `message_id` **✔**, `emoji_id` **✔** | `{data:[User]}` |

- `emoji_id` 是**表情 ID 字串**（如 `"128077"` 表示 👍），非空驗證；
- `reaction.list` 回傳的是**點了該表情的使用者清單**（`User[]`），
  每個 `User` 的 `id` 來自 `emoji_like_list[].user_id`；
- 三者都**要求 `emoji_id`**，即使 `channel_id` 未提供也能運作
  （`satoriMethodParams` 對這三個方法只用於解析，不強制 channel）。

### 4.8 使用者與好友

| 方法 | 轉發到 | 參數 | 回傳 |
| --- | --- | --- | --- |
| `user.get` | `get_stranger_info` | `user_id` **✔** | `User` |
| `friend.list` | `get_friend_list` | 無 | `{data:[{user, nick}]}` |
| `friend.delete` | `delete_friend` | `user_id` **✔** | `null` |
| `friend.approve` | `set_friend_add_request` | `message_id` **✔**（=flag）, `approve` | `null` |

- `friend.list` 每項是 `{user: User, nick: 備註}`；`user.name` 取 `nickname ?? remark`，
  `nick` 取 `remark`；
- `friend.approve` 的 `message_id` 是**加好友請求的 flag**
  （來自 `friend-request` 事件的 `message.id`），`approve` 缺省 true。

---

## 5. 事件清單

### 5.1 支援的 12 種事件類型

原始碼 `satoriConvertOneBotEvent` 及其分支共產出 **12 種** Satori 事件類型：

| Satori 事件 | 觸發（OneBot） | 協定套件已斷言 |
| --- | --- | --- |
| `message-created` | `message` / `message_sent` | ✅ |
| `message-deleted` | `notice: group_recall` / `friend_recall` | ✅ |
| `guild-member-added` | `notice: group_increase` | ✅ |
| `guild-member-updated` | `notice: group_card` / `group_admin` | ⚠️ 未斷言（我實跑驗證 ✅） |
| `guild-member-removed` | `notice: group_decrease` | ✅ |
| `guild-member-request` | `request: group` + `sub_type != invite` | ✅ |
| `guild-request` | `request: group` + `sub_type: invite` | ✅ |
| `friend-request` | `request: friend` | ✅ |
| `reaction-added` | `notice: group_msg_emoji_like`（非 `remove`） | ✅ |
| `reaction-removed` | `notice: group_msg_emoji_like` + `sub_type: remove` | ✅ |
| `login-added` | `notice: bot_status`（非 `offline`） | ⚠️ 未斷言（我實跑驗證 ✅） |
| `login-removed` | `notice: bot_status` + `sub_type: offline` | ✅ |

> **12 種已實作**，其中協定套件斷言涵蓋 **10 種**；`guild-member-updated` 與
> `login-added` 在測試裡未被斷言，但我用同一套 harness 實跑確認它們**正常產出**
> （`group_card -> guild-member-updated`、`bot_status online -> login-added`）。
>
> ⚠️ **沒有對應的事件一律丟棄，不猜類型**：`meta_event`（含 `heartbeat`）、
> `notice: notify/poke`、`group_ban`、`essence`、`group_upload` 等
> **不會產生任何 Satori 事件**。測試斷言 `meta_event heartbeat -> no Satori event`。
> 原始碼註解：*"Returns null for events with no Satori equivalent; those are dropped
> rather than guessed at."*

### 5.2 事件信封

每個事件是一幀 `{op: 0, body: {...}}`，`body` 結構：

```json
{
  "id": 1,
  "sn": 1,
  "type": "message-created",
  "timestamp": 1794541191438,
  "login": { "sn": 1, "adapter": "haizakura", "platform": "haizakura",
             "user": { "id": "10001", "avatar": "...", "is_bot": false } },
  "message": { "...": "..." },
  "user": { "...": "..." },
  "member": { "...": "..." },
  "channel": { "...": "..." },
  "guild": { "...": "..." }
}
```

| 欄位 | 說明 |
| --- | --- |
| `id` / `sn` | **同一個遞增計數器**（`eventSeq`），每個事件 +1 |
| `timestamp` | **毫秒**（`Date.now()`） |
| `login` | 非登入事件只帶 `sn`/`adapter`/`platform`/`user`（**無 `status`/`features`**） |
| `type` | 見 §5.1 |
| 其餘 | 資源提升後的欄位 |

> `sn` 是**配接器級全域計數器**，跨所有連線共用 —— 不是每連線獨立編號。
> 登入事件（`login-added`/`login-removed`）的 `login` 是**完整物件**，
> 帶 `status`（`1`/`0`）與全部 `features`。

### 5.3 ⭐ 資源提升規則（Satori 規範要求）

Satori 規定：**嵌套的資源要提升到事件最外層，且 `message` 內部不再保留它們。**
規範原文：

> 當資源物件出現多級嵌套時，內層的資源將會被統一提升到最外層。例如，當接收到訊息事件時，
> 事件體中可以存取到 `message`, `member`, `user`, `channel` 等資源，
> 但 `message` 中就不再存在 `member` 和 `user` 欄位了。

本實作透過 `satoriPromoteResources()` 完成：把 `message.user` /
`message.member` / `message.channel` / `message.guild` **搬到 `body` 頂層並從
`message` 中 `delete`**。

**`message-created` 實際幀**（已刪減）：

```json
{
  "op": 0,
  "body": {
    "id": 1, "sn": 1, "type": "message-created", "timestamp": 1794541191438,
    "login": { "sn": 1, "adapter": "haizakura", "platform": "haizakura", "user": { "id": "10001", "..." : "..." } },
    "message": { "id": "777", "content": "hi <at id=\"30003\"/><emoji id=\"1\"/>",
                 "created_at": 1700000000000 },
    "user":    { "id": "30003", "name": "群名片", "nick": "群名片", "avatar": "...", "is_bot": false },
    "member":  { "user": { "id": "30003", "..." : "..." }, "nick": "群名片" },
    "channel": { "id": "20001", "type": 0, "name": "测试群" },
    "guild":   { "id": "20001", "name": "测试群", "avatar": "https://p.qlogo.cn/gh/20001/20001/640" }
  }
}
```

測試斷言：

- `EVENT promotes channel/guild/user/member` ✅
- `EVENT message stripped of user/member/channel/guild` ✅
- `EVENT channel.id = group_id` ✅

> ⚠️ **一處與嚴格規則的偏差**：`message-deleted` 與 `reaction-added` /
> `reaction-removed` 的 payload 是**手工建構**的（沒走 `satoriPromoteResources`），
> 它們的 `message` 裡**仍然帶一份嵌套 `channel`**，同時在頂層也有 `channel`：

```json
{ "message": { "id": "777", "channel": { "id": "20001", "type": 0 } },
  "channel": { "id": "20001", "type": 0 } }
```

> 這是**冗餘而非缺失**，SDK 讀頂層即可；但若你的程式嚴格驗證「`message` 內不得有
> `channel`」，需要放寬。其餘資源（`guild`/`user`/`member`/`operator`）都在頂層。

### 5.4 私聊事件

私聊 `message-created` **沒有 `guild`，也沒有 `member`**（QQ 私聊無群語意），
`channel` 是 `private:<uin>` 且 `type: 1`：

```json
{ "type": "message-created",
  "message": { "id": "778", "content": "dm", "created_at": 1700000001000 },
  "user": { "id": "30003", "name": "某人", "nick": "某人" },
  "channel": { "id": "private:30003", "type": 1 } }
```

### 5.5 事件 payload 速查

| 事件 | 頂層資源 |
| --- | --- |
| `message-created` | `message`, `user`, `channel`, `guild`（群聊）, `member`（群聊） |
| `message-deleted` | `message`, `channel`, `user`, `guild`（群撤回）, `operator`（若操作者≠傳送者） |
| `guild-member-added` / `-removed` | `guild`, `channel`, `user`, `member`, `operator`（若有） |
| `guild-member-updated` | `guild`, `channel`, `user`, `member`（`group_admin` 時含 `roles`） |
| `guild-request` / `guild-member-request` | `guild`, `channel`, `user`, `member`, `message`（`id`=flag, `content`=理由）, `operator` |
| `friend-request` | `user`, `message`（`id`=flag, `content`=驗證訊息） |
| `reaction-added` / `-removed` | `guild`, `channel`, `message`, `user`, `operator`, `emoji` |
| `login-added` / `login-removed` | `login`（完整，含 `status` + `features`） |

**請求 flag 怎麼取**（發起審批時要用）：

```
guild-request        → body.message.id  → guild.approve        { message_id }
guild-member-request → body.message.id  → guild.member.approve { message_id }
friend-request       → body.message.id  → friend.approve       { message_id }
```

**表情 ID 怎麼取**：`reaction-*` 事件的 `emoji.id`，回傳給
`reaction.create` / `.delete` / `.list` 的 `emoji_id`。

---

## 6. WebSocket 協定

### 6.1 Opcode

| 名稱 | 值 | 方向 | 本實作 |
| --- | --- | --- | --- |
| `EVENT` | `0` | 伺服器端 → 用戶端 | ✅ 推送事件 |
| `PING` | `1` | **用戶端 → 伺服器端** | ✅ 收到即回 `PONG` |
| `PONG` | `2` | 伺服器端 → 用戶端 | ✅ 僅作應答 |
| `IDENTIFY` | `3` | 用戶端 → 伺服器端 | ✅ 驗證 |
| `READY` | `4` | 伺服器端 → 用戶端 | ✅ 驗證成功 |
| `META` | `5` | 伺服器端 → 用戶端 | ❌ **未實作**（常數已宣告但從不送出） |

> ⚠️ **伺服器端不會主動發 `PING`。** 規範裡「每隔 10s 發 PING」是**應用（用戶端）**的職責；
> 本實作只**被動應答**：收到 `op:1` → 回 `{op:2, body:{}}`（測試斷言 `PING -> PONG`）。
> 其它未知 opcode 只記一條 debug 日誌，**不關閉連線**。

### 6.2 連線流程

```
1. 客户端连接 ws://host:port/v1/events          （路径不符 → HTTP 404 拒绝升级）
2. 客户端在 10 秒内发送 IDENTIFY：{ op:3, body:{ token, sn? } }
3. 服务端校验 token：
     失败 → close(4004, "invalid token")
     成功 → 回 READY：{ op:4, body:{ logins:[Login], proxy_urls:[] } }
4. 之后服务端持续推 EVENT：{ op:0, body:{...事件...} }
5. 客户端每 10s 发 PING，服务端回 PONG（可选）
```

**READY 幀實樣**：

```json
{
  "op": 4,
  "body": {
    "logins": [ { "sn": 1, "adapter": "haizakura", "platform": "haizakura",
                  "user": { "id": "10001", "name": "HaizakuraBot", "nick": "HaizakuraBot",
                            "avatar": "http://q.qlogo.cn/headimg_dl?dst_uin=10001&spec=640",
                            "is_bot": false },
                  "status": 1, "features": ["login.get", "... 共 26 项"] } ],
    "proxy_urls": []
  }
}
```

- `proxy_urls` **恆為空陣列**（本實作無代理路由）；
- `logins` 恆為長度 1 的陣列（單帳號）；
- 取 `get_login_info` 失敗時用 `ctx.uin` 兜底，仍會正常回 READY。

### 6.3 錯誤處理與關閉碼

| 關閉碼 | 原因 | 觸發 |
| --- | --- | --- |
| **`4004`** | `invalid token` | IDENTIFY 的 `body.token` 與設定不符 |
| **`4000`** | `invalid message` | 幀不是合法 JSON、或不是物件（非法幀） |
| **`4000`** | `IDENTIFY timeout` | 連線後 **10 秒內未發 IDENTIFY** |
| `1008` | `access token changed` | 熱更新輪換了權杖，舊用戶端被斷開 |
| `1012` | `server closing` | 停用時**尚未完成 IDENTIFY** 的連線 |
| `1001` | `server closing` | `close()` / `forceClose()` 關閉全部連線 |

測試斷言：`bad IDENTIFY token -> close 4004`、`invalid frame JSON -> close 4000`。

> 我另用 harness 實跑確認：不送出 IDENTIFY 時，**約 10 秒後收到
> `close(4000, "IDENTIFY timeout")`**，且連線從註冊表移除。

### 6.4 `sn` 會話恢復（⚠️ 未實作緩衝重播）

- `IDENTIFY.body.sn` 會被**接受並記錄**到該連線的 `lastSn`；
- 但**沒有任何事件緩衝與重播邏輯** —— 原始碼裡 `lastSn` 賦值之後**再未被讀取**。
- 因此：**斷線重連後，斷開期間的事件會永久遺失**，不會補發。

> 如需可靠補充歷史，請改用 HTTP 的 `message.list` 主動拉取。
> 規範的會話恢復語意（*重播 sn 之後的緩衝事件*）在本實作中**不成立**，請勿依賴。

### 6.5 ⚠️ IDENTIFY 之前的事件會被推送（安全相關）

`acceptConnection()` 會把連線**立即**登記進 `this.connections`，
而 `onEvent()` 的廣播條件是**只檢查連線數量，不檢查 `identified`**：

```js
onEvent(event, _payload) {
  if (!this.isEnabled || this.connections.size === 0) return;
  ...
  for (const connection of this.connections.values()) safeSend(connection.socket, frame);
}
```

**實測確認**：即使設定了 `accessToken`，一個**未攜帶任何憑證、也未送出 IDENTIFY**
的連線，在建立後的 **10 秒視窗內**依然會收到完整的 `EVENT` 幀（含訊息內容）；
10 秒後才被 `close(4000)` 踢掉。原因是 **upgrade 階段沒有呼叫
`authorizeUpgrade()`** —— 該方法在配接器上**有定義但從未被 `startServer()` 呼叫**
（對比：`ws-server-connections.ts` 裡它確實被使用了）。

> **影響**：未驗證者可短暫竊聽事件串流（每次連線最多 10 秒）。
> **緩解**：把 Satori 監聽綁在**受信網路/回送位址**，或在前置反代上做驗證；
> 不要直接曝露到公網。這是已知缺陷，已在 §9 如實標註。

---

## 7. 資源對應（QQ 語意 → Satori）

### 7.1 對照表

| Satori | Haizakura / QQ |
| --- | --- |
| `Guild.id` | `group_id` |
| `Guild.name` | 群名（`group_name`，退回 `group_remark`） |
| `Guild.avatar` | `https://p.qlogo.cn/gh/{group_id}/{group_id}/640` |
| `Channel.id` | 群聊 = `group_id`；私聊 = **`private:<uin>`** |
| `Channel.type` | `0` = TEXT（群聊）/ `1` = DIRECT（私聊） |
| `Channel.name` | 群聊 = 群名；私聊 = 陌生人暱稱 |
| `User.id` | **字串**形式的 QQ 號 |
| `User.name` / `User.nick` | **群語境**取 `card`（群名片）優先、否則 `nickname`；**私聊/`user.get`/`login.get`** 取 `nickname`（見下註） |
| `User.avatar` | `http://q.qlogo.cn/headimg_dl?dst_uin={uin}&spec=640` |
| `User.is_bot` | 由 QQ 號段推斷（見 §7.3） |
| `GuildMember.user` | 同 `User` |
| `GuildMember.nick` | `card \|\| nickname` |
| `GuildMember.joined_at` | `join_time`（秒）× 1000 → **毫秒** |
| `GuildMember.roles` | `owner=4` / `admin=3` / `member=2`（恆 1 條） |
| `Message.id` | `message_id`（**整數 → 字串**） |
| `Message.content` | OneBot 訊息段編碼成 Satori 元素串（§8） |
| `Message.created_at` | **毫秒**時間戳 |

> **關於 `User.name` 的取值脈絡**（原始碼 `satoriDecodeUser(uin, name)`）：
> `name` 與 `nick` **同時設定且值相同**，為空時**兩個欄位都不出現**。取什麼取決於呼叫點：
>
> | 情境 | 傳入的 `name` | 實測 `name` |
> | --- | --- | --- |
> | `message-created`（群聊/私聊）、`message.get`、`guild.member.get`/`.list` | `card \|\| nickname` | `"群名片"` |
> | `user.get`、`login.get`、`channel.get`（私聊）、`reaction.list` | 僅 `nickname` | `"陌生人暱稱"` |
> | `friend.list` | `nickname ?? remark`（另有 `nick` = `remark`） | `"好友暱稱"` |
> | **所有 `notice` / `request` 事件**（`message-deleted`、`guild-member-*`、`guild-request`、`friend-request`、`reaction-*`） | **不傳**（單參呼叫） | **`name` 欄位不存在** |
>
> 所以同一個使用者在**群訊息裡有名字、在 notice/request 事件裡沒有 `name`** —— 這是正常行為。
> 需要暱稱時請在 notice 事件裡按 `user.id` 回查 `user.get`，或直接依賴 `user.id`。

### 7.2 ⚠️ 時間戳單位是毫秒

**這是一條容易搞錯的慣例，務必看清：**

| 情境 | 單位 | 原始碼 |
| --- | --- | --- |
| 事件 `Message.created_at` | **毫秒** | `satoriToInt(event.time) * 1000` |
| `message.create` 回傳的 `created_at` | **毫秒** | `Date.now()` |
| 事件信封 `timestamp` | **毫秒** | `Date.now()` |
| `GuildMember.joined_at` | **毫秒** | `satoriToInt(row.join_time) * 1000` |
| `guild.member.mute` 的 `duration` | **毫秒**（換算成秒下發） | `ceil(duration / 1000)` |

OneBot 的 `event.time` 是**秒**，本實作**乘 1000** 轉成 Satori 的毫秒。
該裁定**對照 LLBot 實作**（`+msgTime * 1000`）做出，測試已斷言：

- `wire is snake_case: created_at in ms` → `created_at === 1700000000000` ✅
- `message.create created_at is ms` → `> 1e12` ✅
- `member joined_at is ms` → `1600000000000` ✅

> 判別技巧：**13 位是毫秒，10 位是秒**。`1e12` 以上的時間戳就是毫秒。

### 7.3 `is_bot` 的判定

QQ 不直接告訴用戶端「這是機器人」，本實作按**已知的機器人號段**推斷
（原始碼 `SATORI_BOT_UIN_RANGES`）：

| 號段起 | 號段止 |
| --- | --- |
| `3328144510` | `3328144510` |
| `2854196301` | `2854216399` |
| `66600000` | `66600000` |
| `3889000000` | `3889999999` |
| `4010000000` | `4019999999` |

不在號段內 → `is_bot: false`（測試斷言一般使用者 `is_bot === false`）。

### 7.4 ⚠️ 線上欄位是 snake_case

所有欄位名在**線上都是 snake_case**：`is_bot`、`created_at`、`joined_at`、
`user_id`、`channel_id`、`guild_id`、`emoji_id`、`proxy_urls`、`role_id`、
`parent_id`、`reply_to`…

**不存在 camelCase 版本**。測試明確斷言：

- `wire is snake_case: is_bot` → `is_bot === false && !("isBot" in user)` ✅
- `wire has no camelCase createdAt` → `!("createdAt" in message)` ✅

---

## 8. 訊息元素

Satori 用 **XML 風格元素串**編碼訊息（不是 OneBot 的訊息段陣列），
例如 `你好 <at id="30003"/> <emoji id="1"/>`。

### 8.1 接收方向（QQ → Satori）

OneBot 訊息段編碼為元素串（原始碼 `satoriEncodeSegments`）：

| OneBot 段 | Satori 元素 | 說明 |
| --- | --- | --- |
| `text` | 轉義後的純文字 | `& < > "` 會被轉義 |
| `at` | `<at id="..."/>` | `qq == "all"` → `<at type="all"/>` |
| `face` | `<emoji id="..." name="..."/>` | |
| `mface` | `<emoji id="..." name="..."/>` | 取 `emoji_id` / `summary` |
| `image` / `flash_file` | `<img src="..." title="..."/>` | |
| `record` | `<audio src="..."/>` | |
| `video` | `<video src="..." poster="..."/>` | `thumb` → `poster` |
| `file` | `<file src="..." title="..."/>` | `name` → `title` |
| `reply` | `<quote id="..."/>` | |
| `forward` | `<message id="..." forward/>` | 合併轉發 |
| `json` / `xml` | 轉義後的原文文字 | 不保留卡片結構 |
| `poke` | 純文字 `[戳一戳]` | |
| 其它未知段 | `data.text`（有則輸出）否則丟棄 | |

- 空值屬性會**省略**（`satoriAttr` 跳過 `undefined`/`null`/空串）；
- 段陣列裡非物件元素被跳過；
- `message` 不是陣列時按字串整體轉義。

### 8.2 發送方向（Satori → QQ）

Satori 元素串解析為 OneBot 訊息段（原始碼 `satoriParseFragment` + `satoriNodesToSegments`）。

**支援的元素**（實測輸出）：

| Satori 元素 | OneBot 段 | 實測 |
| --- | --- | --- |
| 純文字 | `text` | ✅ |
| `<br/>` | `text` `"\n"` | ✅ |
| `<p>…</p>` | 前後各補一個 `"\n"` | ✅ |
| `<at id="1"/>` | `at` `{qq:"1"}` | ✅ |
| `<at type="all"/>` | `at` `{qq:"all"}` | ✅ |
| `<sharp id="9"/>` | `text` `"#9"` | ✅ 降級為文字 |
| `<emoji id="1"/>` / `<face>` | `face` `{id:"1"}` | ✅ |
| `<img src/>` / `<image>` | `image` `{file:src}` | ✅ |
| `<audio src/>` | `record` `{file:src}` | ✅ |
| `<video src poster/>` | `video` `{file:src, thumb:poster}` | ✅ |
| `<file src title/>` | `file` `{file:src, name:title}` | ✅ |
| `<quote id="42"/>` | `reply` `{id:"42"}`（子元素繼續展開） | ✅ |
| `<a href="…">text</a>` | `text` `"text ( href )"` | ✅ 降級為 `文字 ( 連結 )` |
| `<author/>` | **忽略**（不產出段） | ✅ |
| `<message>` | 僅展開子元素 | ⚠️ 見下 |
| 未知元素 | **丟棄標籤、保留內部文字** | ✅ |

**修飾元素降級規則**：`b` / `strong` / `i` / `em` / `u` / `ins` / `s` / `del` /
`spl` / `code` / `sup` / `sub` **一律降級為純文字**（保留內部文字、丟棄標籤）。
實測 `<b>bold</b>` → `[{type:"text",data:{text:"bold"}}]`。

**轉義與容錯**：

- 支援 HTML 實體還原：`&lt; &gt; &quot; &apos; &amp;`，以及
  `&#65;`（十進位）、`&#x42;`（十六進位）；
- **未閉合標籤按文字處理**：`<b>oops` → 文字 `"oops"`；
- **游離的 `>` 按文字**：`a > b` → `"a > b"`；
- `<!-- 注释 -->` 被跳過；
- 解析是**刻意寬容**的，避免畸形 payload 變成 500。

**⚠️ 已知的發送限制**（實測）：

| 輸入 | 結果 |
| --- | --- |
| `<message id="1"/>`（頂層） | **`400`** —— 解析不出可傳送段 |
| `<author id="1">x</author>` | **`400`** —— `author` 被忽略，無剩餘段 |
| 純註解 / 空串 | **`400`** `content must contain at least one sendable element` |

> 即：**解析後段清單為空 → 400**（空文字段也會被過濾掉）。
> 合併轉發（`<message forward>` 嵌套）在本實作中**不具備發送能力** ——
> `<message>` 只被當作透明容器展開，`id` 屬性**不會**轉成 `forward` 段
> （對比接收方向的 `forward` → `<message .../>`，兩者**不對稱**）。

---

## 9. 已知限制（如實標註）

| # | 限制 | 細節 |
| --- | --- | --- |
| 1 | **分頁是近似實作** | `message.list` 的 `next` 用「本頁最後一條的 id」，且只在 `行數 ≥ limit` 時給出；`prev`/`direction` 不支援。不是協定要求的真游標。 |
| 2 | **`sn` 會話恢復未做緩衝重播** | `IDENTIFY.body.sn` 被記錄後**從不使用**；斷線期間事件永久遺失（§6.4）。 |
| 3 | **真實 WS 幀收發只在 arm64 驗證過** | 本機（x64）缺 `ws` 的 native addon（只有 arm64 二進位），協定狀態機用 **socket double** 驅動。**真實握手/分幀未被涵蓋**，需在 arm64 主機複驗。 |
| 4 | **未實作的 API 回傳 404** | 這是**規範要求**（不是缺陷），但意味著呼叫未列出的方法（如 `channel.update`、`channel.delete`、`channel.mute`、`user.channel.create`、`message.update`、`guild.member.role.create`、`interaction.*`）都會得到 404。 |
| 5 | **`private:` 頻道慣例跟隨 LLBot** | 為相容 SDK 生態而採用，非 Satori 強制；換實作時注意。 |
| 6 | **`messageFormat` 對 Satori 無效** | 配接器**不讀取**該欄位 —— Satori 永遠用元素串 `content`，無「array/string」之分。 |
| 7 | **`reportSelfMessage` 對 Satori 無效** | 配接器**不讀取**該欄位。即使設為 `false`，`message_sent`（自己發的訊息）**仍會被轉成 `message-created` 並推送**（我實跑確認）。 |
| 8 | **upgrade 階段未驗證，存在 10 秒事件視窗** | 未 IDENTIFY 的連線也收事件，10 秒後才被 `close(4000)`；`authorizeUpgrade()` 定義了但**從未被呼叫**（§6.5）。不要公網曝露。 |
| 9 | **`META`(op 5) 未實作** | 常數已宣告，但伺服器端從不送出；`proxy_urls` 恆為 `[]`。 |
| 10 | **伺服器端不發 PING** | 心跳方向是**用戶端 → 伺服器端**，伺服器端只被動回 PONG。 |
| 11 | **`message-deleted` / `reaction-*` 未做嚴格提升** | 這兩個 payload 的 `message` 內**仍帶一份 `channel`**（頂層也有），屬冗餘（§5.3）。 |
| 12 | **`guild.member.role.set` 無法轉讓群主** | `role_id: "4"`/`owner` 會被當作**取消管理員**（§4.5）。 |
| 13 | **`guild.member.mute` 存在單位換算與捨入** | 毫秒 → 秒，`ceil` 且下限 1 秒；`0` 表示解禁。 |
| 14 | **`<message>` 不能發送合併轉發** | 頂層 `<message>` 只展開子元素、`id` 被忽略（§8.2）。 |
| 15 | **無預設 Satori 監聽** | 全新安裝**不會**自動建立 Satori 伺服器。原始碼裡 `makeDefaultSatoriServer()` 已定義但**從未被呼叫**（死程式碼），預設設定的 `wsServers` 只有 `path: "/"` 的 `ws-default`。必須手動加哨兵條目。 |
| 16 | **`satoriHttpStatusForResponse` 是死程式碼** | 該函式能把 OneBot 的 `1404` 對應成 `404`、`1400` → `400`，但**從未被呼叫**；實際所有下游失敗都統一回傳 **`400`**。 |
| 17 | **`notice`/`request` 事件的 `User` 不帶 `name`/`nick`** | 只有 `message-created` 與各 API 回傳的 `User` 才帶名字（§7.1 註）。需要暱稱得按 `user.id` 回查 `user.get`。 |

> **關於第 3 條**：`README-satori-tests.md` 明確寫道 ——
> *"true wire-level WS handshake/framing is NOT covered here. Verify that on an arm64 host."*

---

## 10. 與 LLBot 的對比

| 項 | LLBot | Haizakura |
| --- | --- | --- |
| **接入方式** | 獨立 `satoriServers` 設定項 | **重用 `wsServers[]` + `path` 哨兵** |
| **平台標識** | `llonebot` | `haizakura` |
| **API 數** | **28 個 handler**（29 個 `api__*.ts` 檔案，含 `api__index.ts`） | **24 個** |
| **事件類型** | **11 種**（`guild-added` / `guild-removed` / `guild-request` / `guild-member-added` / `-removed` / `-request` / `message-created` / `-deleted` / `reaction-added` / `-removed` / `friend-request`） | **12 種**（見 §5.1） |
| 設定改動 | 需改 `config.ts`（新增 kind） | **零 `config.ts` 改動**（只 patch 1 個原型方法） |
| WebUI 分組 | 獨立的 Satori 分組 | 歸在「WS 伺服器」分組（狀態標籤仍為 Satori） |
| 傳輸實作 | Hono + `@hono/node-server` + 官方 `ws` | `node:http` + **自研 `WebSocketServer`** |
| 型別轉換 | `ts-case-convert` 的 `ObjectToSnake` | 手寫建構 snake_case 字面量 |
| 參考位置 | `reference/satori/*.ts` | `restored/packages/onebot/src/network/satori-*.ts` |

**API 差異（精確核對）**：Haizakura 的 **24 個是 LLBot 28 個的嚴格子集**，
差集恰好是 **4 個** —— LLBot 多出下列 4 個（Haizakura 未實作，呼叫回傳 `404`）：

```
channel.update        channel.delete        channel.mute
user.channel.create （创建私聊频道；LLBot 内部名 createDirectChannel）
```

> 核對方式：把兩邊方法名逐一對齊（`getChannel` → `channel.get`、
> `handleGuildRequest` → `guild.approve`、`setGuildMemberRole` → `guild.member.role.set`、
> `createDirectChannel` → `user.channel.create` 等，由 `api__index.ts` 的 import 路徑推定），
> 集合差恰為上述 4 項，故 **24 = 28 − 4** 完全吻合；
> Haizakura 側**沒有 LLBot 缺失的獨有方法**。
>
> 註：LLBot 按 `Universal.Methods` 查表（`server.ts` 的 `app.post('/v1/:name')`），
> 所以其**實際可呼叫面**取決於 `handlers` 的函式名與協定方法名的交集。

> **事件集合並不相同**（兩邊各 11/12 種，但不是包含關係）：
>
> - **LLBot 獨有**：`guild-added`、`guild-removed`（Haizakura 無對應事件，
>   群建立/解散不會產生 Satori 事件）；
> - **Haizakura 獨有**：`guild-member-updated`、`login-added`、`login-removed`
>   （LLBot 的 `event__*.ts` 中未見這三類）。
>
> ⚠️ 上表 LLBot 側的 handler 數與事件名由 `reference/satori/api__index.ts`
> 與 `event__*.ts` **靜態統計**得出，**未在 LLBot 執行實例上實測**；
> Haizakura 側數字均來自原始碼與本機實跑。

> Satori 的 `adapter` / `platform` 欄位標識**平台類型**，用於 SDK 側的差異化處理。
> 兩者取值不同（`llonebot` vs `haizakura`），**應用側的平台判斷邏輯需要相應適配**。

### 10.1 對 Satori 規範的覆蓋度

拿本倉已抓取的規範頁面（`reference/satori-spec/`）裡的方法名與本實作求差：

**規範裡有、本實作未實作**（呼叫回傳 `404`）：

```
channel.create      channel.update      channel.delete      channel.mute
user.channel.create （创建私聊频道）      message.update
```

**本實作有、規範資源頁未列出**（屬平台擴充，SDK 一般也能呼叫）：

```
login.get           guild.role.list     guild.member.role.set
reaction.create     reaction.delete     reaction.list
friend.list         friend.delete       friend.approve
```

> `*.md` 這類條目是抓取頁面裡的連結雜訊，已剔除。
> 上表由**靜態比對**得出，未逐個在真機調過；規範是否還有未抓取的頁面，
> 請以 <https://satori.chat> 為準。

---

## 11. 快速驗證

```bash
TOKEN=<your-token>          # 配置里的 accessToken
BASE=http://127.0.0.1:5600
H=(-H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
   -H 'Satori-Platform: haizakura' -H 'Satori-User-ID: 10001')

# 1) 登录信息（最基础的健康检查）
curl -s -X POST $BASE/v1/login.get "${H[@]}" -d '{}'

# 2) 群列表
curl -s -X POST $BASE/v1/guild.list "${H[@]}" -d '{}'

# 3) 发一条群消息
curl -s -X POST $BASE/v1/message.create "${H[@]}" \
  -d '{"channel_id":"20001","content":"hello <at id=\"30003\"/>"}'

# 4) 群成员（注意 joined_at 是毫秒）
curl -s -X POST $BASE/v1/guild.member.get "${H[@]}" \
  -d '{"guild_id":"20001","user_id":"30003"}'

# 5) 反向验证鉴权（预期 401）
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/v1/login.get \
  -H 'Content-Type: application/json' -d '{}'

# 6) 验证平台标识必须是 haizakura（预期 403）
curl -s -X POST $BASE/v1/login.get "${H[@]}" -H 'Satori-Platform: qq' -d '{}'

# 7) 验证不支持的 API 返回 404（预期 404，不是 501）
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/v1/channel.update "${H[@]}" -d '{}'
```

**WebSocket 事件串流**（需要 `websocat` 或 Node 指令碼）：

```bash
websocat ws://127.0.0.1:5600/v1/events
# 连上后立刻发送（10 秒内！）：
{"op":3,"body":{"token":"<your-token>"}}
# 预期收到：{"op":4,"body":{"logins":[...],"proxy_urls":[]}}
```

### 重現測試套件

```bash
cd restored
node scripts/build.mjs                          # 产出 dist/index.mjs
node scripts/tests/run-satori-tests.mjs         # 76 条协议/API 断言
node scripts/tests/run-satori-integration.mjs   # 22 条挂载/NetworkManager 断言
```

### 實測結果（2026-11-13，本機）

| 請求 | 結果 |
| --- | --- |
| `login.get`（正確標頭 + token） | `200`，`platform: "haizakura"`，26 個 features |
| `login.get`（`Satori-Platform: qq`） | **`403`** `login not found` ✅ |
| `login.get`（完全不帶標頭） | `200`（缺失被容忍） |
| `message.get`（下游動作失敗） | `400` `{"message":"unknown action"}` |
| `channel.update`（未實作） | **`404`** `method not found` ✅ |
| `GET /v1/login.get` | `405` + `Allow: POST` |
| `POST /v1/nonsense` | `404` `method not found` |
| WS：錯誤 token 的 IDENTIFY | `close(4004)` |
| WS：非法 JSON 幀 | `close(4000)` |
| WS：10 秒不發 IDENTIFY | `close(4000, "IDENTIFY timeout")` |
| WS：未 IDENTIFY 就收事件 | ⚠️ **收到了**（10 秒視窗，見 §9 第 8 條） |

---

## 12. 常見問題

| 現象 | 原因 | 處理 |
| --- | --- | --- |
| WebUI 裡看不到 Satori 分組 | 設計如此，重用 `wsServers[]` | 在「WS 伺服器」分組找，**狀態標籤是 Satori** |
| 配了 `path: "/v1/events"` 卻像 OneBot | 哨兵拼寫不符（如多了前綴） | `path` 必須**精確等於** `/v1/events` |
| OneBot WS 突然變了行為 | **`/v1/events` 被 OneBot 佔用了** | 給 OneBot 用別的 `path`（如 `/`） |
| `403 login not found` | `Satori-Platform` 傳了非 `haizakura`（如 `qq`），或 `Satori-User-ID` 不對 | 改正標頭；**`haizakura`** |
| `401 authorization required` | 設定了 token 但沒帶 `Authorization` | 加 `Authorization: Bearer <token>` |
| `404 method not found` | 方法不在 24 個白名單內 | 見 §4；這是規範行為，非故障 |
| 呼叫未實作方法想得到 501 | 規範要求 404 | 別依賴 501 |
| 收到的事件裡 `message` 沒有 `user` | **資源提升**，去頂層取 | 見 §5.3 |
| 時間比預期大 1000 倍 | 就是**毫秒** | 見 §7.2 |
| 欄位名對不上（`isBot`） | 線上欄位是 **snake_case** | 見 §7.4 |
| WS 連上沒反應 | 沒在 10 秒內發 IDENTIFY | 立即發 `{op:3,body:{token}}` |
| 重連後缺事件 | `sn` 恢復**未實作重播** | 用 `message.list` 補歷史 |
| 自己發的訊息也推來了 | `reportSelfMessage` **對 Satori 無效** | 應用側按 `user.id == 自己` 過濾 |
| `message.create` 回傳 400 | `content` 解析後無可傳送元素（空串/純註解/頂層 `<message>`） | 至少放一個文字或受支援元素 |
| 群成員 `joined_at` 缺失 | `join_time` ≤ 0 時該欄位**不出現** | 屬正常可選欄位語意 |
| 儲存設定報權杖錯誤 | 非回送位址必須 ≥ 16 字元且不易猜 | 用隨機 token 或綁 `127.0.0.1` |
| 儲存設定報 `statusCommand must be an object` | `POST /api/config/:uin` 要求**完整**設定 | 用 §2.2 的完整形狀 |
| `channel.list` 只有 1 條 | QQ **一群一頻道**（`guild.plain`） | 屬預期 |
| 轉讓群主失敗/被取消管理員 | `role.set` 只表達管理員開關 | 見 §9 第 12 條 |

---

## 13. 聲明

| 項目 | 狀態 |
| --- | --- |
| 哨兵識別規則、匹配容錯（尾部斜線/查詢串） | **已核實**：原始碼 + harness 實跑（6 種 path 形態） |
| 24 個 API 的轉發目標、參數、回傳值 | **已核實**：`SATORI_API` 表 + 逐個實跑 |
| 事件類型（12 種）與資源提升 | **已核實**：原始碼 + 實幀 dump；10 種有測試斷言 |
| 狀態碼、驗證標頭行為、404/405 分支 | **已核實**：原始碼 + 實跑 7 種請求 |
| WS opcode、關閉碼、10s IDENTIFY 逾時 | **已核實**：socket double 實跑 |
| 元素收發與降級規則 | **已核實**：22 組收發用例實跑 |
| `reportSelfMessage` / `messageFormat` 無效 | **已核實**：原始碼無引用 + 實跑重現 |
| 事件在 IDENTIFY 前被推送 | **已核實**：實跑重現（10 秒視窗） |
| 98/98 測試通過 | **已核實**：本機實跑 76 + 22 |
| 真實 WS 握手與分幀 | ⚠️ **未驗證**（x64 缺 native addon，需 arm64 複驗） |
| 本文範例的連接埠/群號/token | 範例值，**未**在你的環境實測 |

> 未實測項：**真實 WebSocket 幀級收發**（握手、遮罩、分片）未在本機驗證，
> 協定狀態機部分透過 socket double 涵蓋，結論來自原始碼閱讀 + 雙精度實跑。
