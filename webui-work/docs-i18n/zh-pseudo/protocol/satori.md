# Satori 協議接入指南

> [!WARNING]
> 本内容全由 AI 編写、請慎読也。

> 本文記述 Haizakura（原 SnowLuma）対 **Satori 協議**（`satori.chat`）之実装：
> 如何以 **path 哨兵** 啓用伺服器、24 個 API、事件与資源対応、消息要素收発、
> 及与 LLBot 之差異也。
>
> **資料源**：`packages/onebot/src/network/satori-server-adapter.ts`（1445 行、伝輸層 + API 表）、
> `packages/onebot/src/network/satori-mount.ts`（95 行、挂載層）、
> `packages/onebot/src/config.ts`（`wsServers` 解析与校験）、
> `scripts/tests/driver-protocol.mjs`（76 断言）、`scripts/tests/driver-integration.mjs`（22 断言）也。
>
> **試験状態**：`node scripts/tests/run-satori-tests.mjs` → **76/76 通過**；
> `node scripts/tests/run-satori-integration.mjs` → **22/22 通過**（合計 **98/98**、2026-11-13 実走）。

---

## 1. 序論

### 1.1 Satori 為何物

Satori 者、**跨平台聊天機器人協議** 也（<https://satori.chat>）、由 Koishi 生態維護。
其将各異之聊天平台（QQ、Discord、Telegram…）抽象為統一之一組 **資源**
（`User` / `Channel` / `Guild` / `GuildMember` / `Message` / `Reaction`…）、
応用層唯対此組資源編程：

| 通信方式 | 用途 | 本文対応章 |
| --- | --- | --- |
| **HTTP API** | 主動呼出（発消息、査群、踢人…） | §3 / §4 |
| **WebSocket** | 被動受事件流 | §3 / §6 |
| WebHook | 他種事件受信方式 | ❌ 本実装 **未提供** |

### 1.2 Haizakura 何故支持之

**因 Satori 有既成之 SDK 生態、接入即可直用也。** 支持 Satori 之後：

- **Koishi** 可経 Satori 適配器直連 Haizakura、無需再写 OneBot 橋接；
- **`@satorijs/satori`** 等公式 SDK 可直接対接、不必手写 HTTP/WS 協議棧；
- 応用層之代码可 **跨平台復用** —— 同一論理既能行於 QQ（Haizakura）、亦能行於他 Satori 実装之上。

### 1.3 与 OneBot v11 之関係

**两者並存、不相替代、可同時有効也。**

| 維度 | OneBot v11 | Satori |
| --- | --- | --- |
| 定位 | QQ 生態之事実標準 | 跨平台抽象 |
| 設定位置 | `networks.*`（4 類適配器） | **復用 `networks.wsServers[]`**（見 §2） |
| 端口 | 各自独立 | 各自独立、**可与 OneBot 同時監聴不同端口** |
| 事件/動作模型 | `post_type` + 222 個動作 | 12 類事件 + 24 個方法 |

同一帳号可同時開一 OneBot WS 伺服器与一 Satori 伺服器、`emitEventNow()`
将毎個事件 **同時扇出** 与両側（源码 `network-manager.ts`、集成試験
`manager-fed EVENT has channel+user promoted` 已断言也）。

> OneBot v11 之完全説明見 [`onebot11.md`](onebot11.md)、[`events.md`](events.md)、[`actions.md`](actions.md) 也。

---

## 2. ⚠️ 如何啓用（sentinel 機制）

> **本節為全文最重要之部分也。** Haizakura 之 Satori 伺服器 **無独立設定項**、
> 而 **復用 OneBot 之 `wsServers[]` 列表**、依 `path` 欄位識別也。

### 2.1 識別規則

```
wsServers[] 中 path === "/v1/events" 的条目  =  Satori 服务器
```

判定論理（源码 `satori-mount.ts` 之 `satoriMountIsSatoriServer`）：

1. 取 `path` 欄位（非文字列之場合按 `"/"` 処理）；
2. 除査詢串（`?` 之後）与 **尾部斜杠**；
3. 与 `"/v1/events"` **精確相等** 方算 Satori 也。

故以下各写法之識別結果如次：

| 設定之 `path` | 識別為 |
| --- | --- |
| `/v1/events` | ✅ Satori |
| `/v1/events/` | ✅ Satori（容尾部斜杠） |
| `/v1/events?x=1` | ✅ Satori（容査詢串） |
| `/v1/eventsfoo` | ❌ 普通 OneBot WS |
| `/satori/v1/events` | ❌ **不匹配**（唯認精確値、非前綴匹配也） |
| `/` | ❌ 普通 OneBot WS |

> 挂載方式者、patch `OneBotInstance.prototype.createNetworkAdapter` 也
> （源码 `satori-mount.ts`）：先判定是否 `kind === "wsServer"` 且 `path` 命中哨兵、
> 命中則返 `SatoriServerAdapter`、否 **原様交回** 原生実装也。
> 集成試験已断言普通 `/` 条目仍得 `WsServerAdapter`（`normal path -> WsServerAdapter (unchanged)`）。

### 2.2 完全設定例（可直接複製）

`POST /api/config/:uin` 会 **厳格校験全体設定対象**（`assertValidOneBotConfig`）、
故以下給出 **完全可提交** 之形状（`statusCommand`、`historySync` 欠一不可也）：

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

> ⚠️ 将 `accessToken` 原様填為 `<your-token>` 占位符者、会遭 **令符強度方針拒絶**
>（少於 16 文字故也）：請換為真実随機 token、例如
> `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`（43 文字）。
> 若自 **本機回環** 保存、或将 `host` 綁回 `127.0.0.1`、方容留空（= 不鑑権）也。

欄位説明（沿 `wsServers` 之語義）：

| 欄位 | 必填 | 説明 |
| --- | --- | --- |
| `name` | 建議 | 適配器唯一名、**全局不可与他 kind 重名** |
| `host` | — | 既定 `0.0.0.0`；欲跨機接入需明写 `0.0.0.0` |
| `port` | **✔** | 1–65535、**> 0** 且不可与他監聴条目衝突 |
| `path` | **✔** | 必須 **精確等於** `/v1/events`、此為哨兵也 |
| `accessToken` | 建議 | 留空 = **不鑑権**（⚠️ 結合 §6.5 之未鑑権窗口、等於完全開放也） |
| `messageFormat` | — | ⚠️ **対 Satori 無効**（見 §9） |
| `reportSelfMessage` | — | ⚠️ **対 Satori 無効**（見 §9） |
| `role` | 任意 | 既定 `Universal`、**対 Satori 完全無義、被忽略**（写 `Api`/`Event` 亦照常收発事件、実測確認也） |
| `maxPayloadBytes` | 任意 | 入站 WS 幀上限（`wsServers` 通用欄位也） |
| `enabled` | 任意 | 置 `false` 則工場仍返 Satori 適配器、但 `open()` 直返、**不監聴** 也 |

**唯 `wsServers` 一条亦可通過文件校験**：若経 `config/onebot_<uin>.json`
文件設定、`fromJson` 会補 `statusCommand` / `historySync` / 其余三網陣列之既定値、
故設定文件之中可唯写 `networks.wsServers` 也。**WebUI 之 POST 接口不受省略**、請用上之完全形状也。

> **勿往哨兵条目加 Satori 専属欄位**：`wsServers` 之欄位集合固定也
>（`name` / `enabled` / `accessToken` / `messageFormat` / `reportSelfMessage` /
> `host` / `port` / `path` / `role` / `maxPayloadBytes`）。実測三路之挙動各異：
>
> | 路徑 | 未知欄位之挙動 |
> | --- | --- |
> | `POST /api/config/:uin`（保存） | **黙然受容**、不報錯 |
> | `fromJson`（載入文件） | **黙然棄之**（産出対象之中無此欄位） |
> | 設定導入/復元（`validateOneBotRestoreSource`） | **明確拒絶**：`$.networks.wsServers[0].xxx is not supported` |
>
> 即 WebUI 保存 **不報錯**、但欄位次回載入之時即消失矣 —— 勿望其有効也。
> 此亦本適配器 **必須自含**（不依追加設定欄位）之故也。

### 2.3 何故用此「哨兵」方式？（設計取舍）

Haizakura 之設定模組 `config.ts` 之中、
`fromJson` 与 `toJsonObject` **硬編碼 4 個 kind**（`httpServers` / `httpClients` /
`wsServers` / `wsClients`）、`RESTORE_NETWORK_KEYS` 亦固定集合也。

欲増第 5 個 kind（如 `satoriServers`）必須改 `config.ts` 本体：

- `config.ts:222` 会遍歴 `RESTORE_NETWORK_KEYS` 而読 `parsed.networks[key].length` ——
  `fromJson` 之輸出之中無新 kind、故 `undefined.length` 直成 **TypeError**、
  全設定保存/復元之鏈路不可用矣；
- `validateRestoreAdapterArray` 対未知 kind 会要求 `url` 欄位、形状不合也。

而 `config.ts` 者 **既存 region** 也、改之需 **重編号 432 個 region**（源码 `satori-mount.ts`
頂部注釈明確記此結論：*「新增 kind 必須改 config.ts 本体，而那是現有 region
（改它要重編号 432 個 region）」*）。

**v2 方案（当前実装）**：復用既存 `wsServers[]`、唯 patch **1 個原型方法**。收益：

- 設定管線 **100% 復用** —— 解析、校験、序列化、熱重載、**端口衝突検測** 皆仍有效也；
- 不触 `config.ts`、零 region 重編号之危；
- 集成試験已断言 `RESTORE_NETWORK_KEYS not polluted`（未被汚染）、
  `compileDesiredPlan NOT patched (v2 minimal)`（唯改 1 個方法也）。

**代価（必須知情）**：

- WebUI 之網状態列表之中、此条会示於 **「WS 伺服器」分組** 之下；
  但 **状態標籤（`kind`）仍為 `satoriServer`**、`detail` 会示
  `Satori v1 · N 个事件客户端`**（源码 `describeStatus()`、集成試験
  `Satori adapter describeStatus().kind` 已断言）；
- 反之、**`/v1/events` 此 path 不可再配与 OneBot WS 用之** ——
  誰写 `path: "/v1/events"`、誰即成 Satori 伺服器也（見 §2.5）。

### 2.4 熱更新（無需重啓、不失登録態）

設定可経 WebUI 之 `POST /api/config/:uin` **熱更新**：

```bash
curl -X POST http://127.0.0.1:3080/api/config/10001 \
  -H 'Content-Type: application/json' \
  -d @satori-config.json
```

成功応答之形如次：

```json
{ "success": true, "saved": true, "applied": true, "online": true,
  "reloaded": true, "message": "配置保存成功，已热重载当前会话。", "errors": [], "adapters": [] }
```

- **不需重啓工程、亦不失登録態**（経 `oneBotManager.reloadConfig`）；
- 会話不在線之時保存仍成功、但 `online: false`、**次回接続方有効**；
- 令符輪換会 **主動断開已接続之事件客端**：`closeConnections(1008, "access token changed")`
  （源码 `onConfigReplaced`）—— 客端需再 IDENTIFY 也。

> ⚠️ **遠程保存之令符方針**：`wsServers` 属入站節点（`INBOUND_KINDS`）、
> 経非回環地址保存之時、**`accessToken` 不可為空、且至少 16 個文字**、
> 亦不可為易猜之値（源码 `onebot-token-policy.ts`）。綁回 `127.0.0.1` 或自本機保存方容留空也。

### 2.5 与 OneBot 同時啓用之写法

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

- 両条必須 **端口不同**、否者校験直拒（`networks.wsServers[1] conflicts with networks.wsServers[0] on server binding ...`）；
- `name` 於 **凡 kind 之間** 唯一、重名則報 `network adapter name "..." is duplicated in ... and ...`；
- Satori 可開 **多条**（不同端口）、互不相妨也。

---

## 3. 接入之方式

### 3.1 HTTP API

```
POST http://<host>:<port>/v1/{resource}.{method}
Content-Type: application/json
```

- 請求体者 **JSON 対象** 也（陣列或標量会被拒：`请求体必须是 JSON 对象`）；
  空請求体作 `{}` 処理（実測 `200`）；
- `Content-Type` **不校験**：`application/json` / `text/plain` / 完全不伝
  皆能正常処理（実測皆 `200`）。規範建議用 `application/json`、本実装唯不強制耳；
- 方法名即 **路徑之余部**、例如 `POST /v1/login.get`、`POST /v1/message.create`；
  方法路徑 **容帯査詢串**（`/v1/login.get?x=1` 実測 `200`、査詢参數被忽略）；
- ⚠️ **不再拼一層 `/v1`**。因哨兵 `path` 自身即 `/v1/events`、
  源码 `mountPrefix()` 対 `/` 与 `/v1/events` 皆返空串、
  故端点為 `/v1/<method>`、**非** `/v1/events/v1/<method>`
  （源码注釈：*"must NOT append another `/v1`"*；試験断言
  `route: POST /v1/login.get (no double /v1)`）。

### 3.2 WebSocket 事件之流

```
GET ws://<host>:<port>/v1/events      （HTTP Upgrade）
```

- 路徑必須 **精確等於** `/v1/events`、否者升級被拒：`abortUpgrade(socket, 404, "Not Found")`；
- 以 **普通 GET**（未做 upgrade）訪此路徑 → `405` + `Allow: GET` + `please connect with WebSocket`。

### 3.3 必須請求頭

| 頭 | 値 | 必須性 |
| --- | --- | --- |
| `Satori-Platform` | **`haizakura`** | ⚠️ 見下 |
| `Satori-User-ID` | 帳号 uin | 任意（**若提供則必須匹配**） |
| `Authorization` | `Bearer <accessToken>` | 設定 token 之時必須 |

**`Satori-Platform` 之正値為 `haizakura`、非 `qq` 也！**

```bash
curl -X POST http://127.0.0.1:5600/v1/login.get \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <your-token>' \
  -H 'Satori-Platform: haizakura' \
  -H 'Satori-User-ID: 10001' \
  -d '{}'
```

実測挙動（源码 `handleRequest` + 実走検証）：

| 情況 | 結果 |
| --- | --- |
| `Satori-Platform: haizakura` | `200` ✅ |
| **`Satori-Platform: qq`** | **`403`** `{"message":"login not found"}` |
| **完全不伝** `Satori-Platform` | `200`（**缺失被容**） |
| `Satori-User-ID` 与当前帳号不符 | `403` `{"message":"login not found"}` |
| 完全不伝 `Satori-User-ID` | `200`（**缺失被容**） |

> 即：両頭 **唯於「提供而値不対」之時拒** 也。SDK 既定皆帯
> `Satori-Platform`、故唯須平台標識填対（`haizakura`）即無妨；
> 若汝手写客端、**漏伝亦能通**、但 **伝 `qq` 必 403** 也。

### 3.4 状態碼表

| 碼 | 触発条件 | 応答体 |
| --- | --- | --- |
| `200` | 成功 | 方法返却値（各方法不同、見 §4） |
| `400` | 参數缺失/非法、JSON 語法錯誤、請求体非対象、下流動作失敗 | `{"message":"..."}` |
| `401` | 設定 token 而未帯 `Authorization` | `{"message":"authorization required"}` |
| `403` | token 不匹配 / `Satori-Platform` 或 `Satori-User-ID` 不符 | `{"message":"invalid token"}` 或 `"login not found"` |
| **`404`** | **方法不在 24 個白名単之内**、路徑不在 `/v1/` 前綴之下 | `{"message":"method not found"}` / `"not found"` |
| `405` | 対方法路徑用非 POST；対 `/v1/events` 用普通 GET | 帯 `Allow` 頭 |
| `413` | 請求体超 **64 MiB**（`readRequestBody` 既定上限） | `{"message":"request body too large"}` |
| `503` | 服務正在関閉（`acceptingActions === false`） | `{"message":"server closing"}` |

> **重点：不支持之 API 返 `404`、非 `501` 也。** 此合 Satori 規範
>（*「平台不支持之 API 応返 404；唯平台支持而適配器未実装方返 501」*）。
> 源码注釈亦明：*"an unsupported API must answer 404, never 501"*。
>
> **注意**：Satori 之錯誤体為 **扁平之 `{message}`**、与 OneBot 之
> `{status, retcode, data, wording}` **完全不同** 也。勿混用両套錯誤処理。

### 3.5 鑑権順序（易踏坑）

HTTP 請求按以下順序処理、**鑑権非首歩** 也：

1. `acceptingActions` 為偽 → `503`；
2. 路徑為 `/v1`（或 `/v1/`）→ `404 method not found`；
3. 路徑不以 `/v1/` 起 → `404 not found`；
4. 方法名為 `events` → `405`（示用 WebSocket）；
5. 方法非 `POST` → `405`；
6. **然後方校 `Authorization`**：無 → `401`、不匹配 → `403`；
7. 校 `Satori-User-ID`、`Satori-Platform` → 不符 `403`；
8. 方法不在 `SATORI_API` 白名単 → `404`。

> 故：**未鑑権之請求、`404`/`405` 会先於 `401` 返也**。
> 加之、`accessToken` 留空之時 **全鑑権歩驟被跳** —— 連伝錯之 token 亦放行也。---

## 4. API 一覧（24 個）

源码 `SATORI_API` 表 **恰好 24 条**、与 `SATORI_FEATURES` 所宣言之 26 個特性一致
（26 = 24 個方法 + `message.list.from` + `guild.plain`、後二者為 **能力標記** 而非方法也）。

**約定**：

- 凡方法皆 `POST`、参數置 JSON 請求体；
- ID 類参數於線上皆為 **文字列**（`user_id`/`group_id` 伝数字亦可由 `toInt` 容錯）；
- 失敗之時投錯 → HTTP `400` + `{"message":"..."}`。

### 4.1 登録

#### `login.get`

| 項 | 値 |
| --- | --- |
| 参數 | 無 |
| 転発至 | `get_login_info` |
| 返却 | `Login`：`{sn, adapter, platform, user, status, features}` |

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

> `status`：`1` = ONLINE、`0` = OFFLINE 也。
> `get_login_info` 失敗之時 **不報錯**、会以 `ctx.uin` 兜底返一 Login 也。

### 4.2 消息之部

| 方法 | 転発至 | 参數 | 返却 |
| --- | --- | --- | --- |
| `message.create` | `send_msg` | `channel_id` **✔**、`content` **✔** | `Message[]`（長 1） |
| `message.get` | `get_msg` | `message_id` **✔**（`channel_id` 未使用） | `Message` |
| `message.delete` | `delete_msg` | `message_id` **✔** | `null` |
| `message.list` | `get_group_msg_history` / `get_friend_msg_history` | `channel_id` **✔**、`limit`、`next`/`message_id`、`order` | `BidiList`：`{data, next?}` |

**`message.create`** —— Satori 之 `content`（要素串）→ OneBot 消息段：

- `channel_id` 為純数字 → 群聊、走 `{message_type:"group", group_id}`；
- `channel_id` 為 `private:<uin>` → 私聊、走 `{message_type:"private", user_id}`；
- `content` 解析之後 **無可発送要素** → `400 content must contain at least one sendable element`；
- 返却之 `Message.created_at` 用 `Date.now()`（**毫秒**）、`id` 為 `send_msg` 所返
  `message_id` 之 **文字列** 形式；
- 若本地 `get_msg` 査不得剛入庫之自発消息、**退為回顕所提之 content**、而不令已成功之発送報錯也。

```bash
curl -X POST http://127.0.0.1:5600/v1/message.create \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer <your-token>' \
  -H 'Satori-Platform: haizakura' -H 'Satori-User-ID: 10001' \
  -d '{"channel_id":"20001","content":"你好 <at id=\"30003\"/> <emoji id=\"1\"/> <img src=\"https://x/y.png\"/>"}'
```

**`message.list`** 之分頁語義（⚠️ **近似実装**、見 §9）：

- `limit` 缺省/≤0/>100 之時 **退為 50**；
- `next`（或 `message_id`）作錨点伝与 OneBot 之 `message_id`；
- `order: "asc"` → `reverse_order: false`；缺省或 `"desc"` → `reverse_order: true`；
- **唯当返却行数 ≥ limit** 之時方給 `next`、其値為 **本頁最末一条之 `id`** ——
  此乃「以消息 ID 為遊標」之近似、非協議所要求之真遊標也；
- `prev` 与 `direction`（`before`/`after`/`around`）**皆不支持**。

### 4.3 頻道（Channel）

| 方法 | 転発至 | 参數 | 返却 |
| --- | --- | --- | --- |
| `channel.get` | 群聊 → `get_group_info`；私聊 → `get_stranger_info` | `channel_id` **✔** | `Channel` |
| `channel.list` | `get_group_info` | `guild_id` **✔** | `{data:[Channel]}`（恒 1 条） |

- 群聊之 `channel_id` = 群号文字列、返 `type: 0`（TEXT）+ `name` = 群名；
- 私聊之 `channel_id` = `private:<uin>`、返 `type: 1`（DIRECT）、
  `name` 取陌生人昵称（失敗則不帯 `name`）；
- `channel.list` 因 **QQ 一群一頻道**（`guild.plain`）、唯返該群自身此一頻道也。

### 4.4 群組（Guild）

| 方法 | 転発至 | 参數 | 返却 |
| --- | --- | --- | --- |
| `guild.get` | `get_group_info` | `guild_id` **✔** | `Guild` |
| `guild.list` | `get_group_list` | 無 | `{data:[Guild]}` |
| `guild.approve` | `set_group_add_request`（`sub_type:"invite"`） | `message_id` **✔**（=flag）、`approve`、`comment` | `null` |

`Guild` 之形状：`{id, name, avatar}`、其中 `avatar` 為
`https://p.qlogo.cn/gh/{group_id}/{group_id}/640` 也。

> `guild.approve` 之 `message_id` 実為 **請求 flag** —— 取自
> `guild-request` 事件之 `message.id`。`approve` **缺省為 true**
>（`source.approve !== false`）。

### 4.5 群成員（GuildMember）

| 方法 | 転発至 | 参數 | 備註 |
| --- | --- | --- | --- |
| `guild.member.get` | `get_group_member_info` | `guild_id` **✔**、`user_id` **✔** | 返単一 `GuildMember` |
| `guild.member.list` | `get_group_member_list` | `guild_id` **✔** | `{data:[GuildMember]}` |
| `guild.member.kick` | `set_group_kick` | `guild_id`、`user_id`、`permanent` | `permanent:true` → `reject_add_request:true` |
| `guild.member.mute` | `set_group_ban` | `guild_id`、`user_id`、`duration`（**毫秒**） | 換算見下 |
| `guild.member.role.set` | `set_group_admin` | `guild_id`、`user_id`、`role_id` | 唯能表「管理員/非管理員」 |
| `guild.member.approve` | `set_group_add_request`（`sub_type:"add"`） | `message_id`（=flag）、`approve`、`comment` | 入群申請 |

**`GuildMember` 形状**：

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

要点：

- `user.name` / `user.nick` 取 `card || nickname`（**群名片優先**）；
- **`joined_at` 為毫秒**：`join_time`（秒）× 1000；`join_time` ≤ 0 之時 **此欄位不現**；
- `roles` **恒為長 1 之陣列**（QQ 唯有単角色階梯）；
- `member.avatar` 与 `user.avatar` 相同（QQ 無独立群頭像也）。

**`guild.member.mute` 之単位換算**（重要）：

```
Satori duration 是毫秒；OneBot set_group_ban 收秒。
seconds = duration <= 0 ? 0 : max(1, ceil(duration / 1000))
```

即 `duration: 60000` → `duration: 60`（試験已断言 `ms->s (60000->60)`）；
`duration: 0` → 解禁也。

**`guild.member.role.set` 之表現力限制**：

```
role_id ∈ {"3","admin"} → set_group_admin { enable: true }
role_id ∈ {"4","owner"} 或其它 → set_group_admin { enable: false }   ← 降级为普通成员
```

> 即 **QQ 之「転譲群主」不可経本方法表之**：伝 `role_id: "4"` 会被当作 **取消管理員**。
> 設 `role_id: "3"` 乃唯一有意義之呼出（試験断言 `role.set -> enable:true`）。

### 4.6 群組角色（GuildRole）

#### `guild.role.list`

| 項 | 値 |
| --- | --- |
| 参數 | `guild_id` **✔**（唯校験 > 0） |
| 返却 | **静態** 3 条、**不訪網絡** |

```json
{ "data": [
  { "id": "4", "name": "owner",  "position": 3 },
  { "id": "3", "name": "admin",  "position": 2 },
  { "id": "2", "name": "member", "position": 1 }
] }
```

> 試験断言 `guild.role.list -> 3 static roles`。

### 4.7 表態（Reaction）

| 方法 | 転発至 | 参數 | 返却 |
| --- | --- | --- | --- |
| `reaction.create` | `set_msg_emoji_like`（`set:true`） | `message_id` **✔**、`emoji_id` **✔** | `null` |
| `reaction.delete` | `set_msg_emoji_like`（`set:false`） | `message_id` **✔**、`emoji_id` **✔** | `null` |
| `reaction.list` | `get_emoji_likes` | `message_id` **✔**、`emoji_id` **✔** | `{data:[User]}` |

- `emoji_id` 為 **表情 ID 文字列**（如 `"128077"` 表 👍）、有非空校験；
- `reaction.list` 所返者為 **点此表情之使用者列表**（`User[]`）、
  毎個 `User` 之 `id` 源自 `emoji_like_list[].user_id`；
- 三者皆 **要求 `emoji_id`**、即使 `channel_id` 未提供亦能動作
 （`satoriMethodParams` 対此三方法唯用於解析、不強制 channel 也）。

### 4.8 使用者与好友

| 方法 | 転発至 | 参數 | 返却 |
| --- | --- | --- | --- |
| `user.get` | `get_stranger_info` | `user_id` **✔** | `User` |
| `friend.list` | `get_friend_list` | 無 | `{data:[{user, nick}]}` |
| `friend.delete` | `delete_friend` | `user_id` **✔** | `null` |
| `friend.approve` | `set_friend_add_request` | `message_id` **✔**（=flag）、`approve` | `null` |

- `friend.list` 毎項為 `{user: User, nick: 备注}`；`user.name` 取 `nickname ?? remark`、
  `nick` 取 `remark`；
- `friend.approve` 之 `message_id` 為 **加好友請求之 flag**
 （源自 `friend-request` 事件之 `message.id`）、`approve` 缺省 true 也。

---

## 5. 事件一覧

### 5.1 支持之 12 種事件類型

源码 `satoriConvertOneBotEvent` 及其分枝共産出 **12 種** Satori 事件類型：

| Satori 事件 | 触発（OneBot） | 協議套件已断言 |
| --- | --- | --- |
| `message-created` | `message` / `message_sent` | ✅ |
| `message-deleted` | `notice: group_recall` / `friend_recall` | ✅ |
| `guild-member-added` | `notice: group_increase` | ✅ |
| `guild-member-updated` | `notice: group_card` / `group_admin` | ⚠️ 未断言（実走検証 ✅） |
| `guild-member-removed` | `notice: group_decrease` | ✅ |
| `guild-member-request` | `request: group` + `sub_type != invite` | ✅ |
| `guild-request` | `request: group` + `sub_type: invite` | ✅ |
| `friend-request` | `request: friend` | ✅ |
| `reaction-added` | `notice: group_msg_emoji_like`（非 `remove`） | ✅ |
| `reaction-removed` | `notice: group_msg_emoji_like` + `sub_type: remove` | ✅ |
| `login-added` | `notice: bot_status`（非 `offline`） | ⚠️ 未断言（実走検証 ✅） |
| `login-removed` | `notice: bot_status` + `sub_type: offline` | ✅ |

> **12 種皆已実装**、其中協議套件断言覆 **10 種**；`guild-member-updated` 与
> `login-added` 於試験之中未被断言、然以同一套 harness 実走確認其 **正常産出**
>（`group_card -> guild-member-updated`、`bot_status online -> login-added`）。
>
> ⚠️ **無対応之事件一律棄之、不猜類型**：`meta_event`（含 `heartbeat`）、
> `notice: notify/poke`、`group_ban`、`essence`、`group_upload` 等
> **不産生任何 Satori 事件**。試験断言 `meta_event heartbeat -> no Satori event`。
> 源码注釈：*"Returns null for events with no Satori equivalent; those are dropped
> rather than guessed at."*

### 5.2 事件封套

毎個事件為一幀 `{op: 0, body: {...}}`、`body` 之結構如次：

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

| 欄位 | 説明 |
| --- | --- |
| `id` / `sn` | **同一遞増計數器**（`eventSeq`）、毎事件 +1 |
| `timestamp` | **毫秒**（`Date.now()`） |
| `login` | 非登録事件唯帯 `sn`/`adapter`/`platform`/`user`（**無 `status`/`features`**） |
| `type` | 見 §5.1 |
| 其余 | 資源提升後之欄位 |

> `sn` 為 **適配器級全局計數器**、跨凡接続共享 —— 非毎接続独立編号也。
> 登録事件（`login-added`/`login-removed`）之 `login` 為 **完全対象**、
> 帯 `status`（`1`/`0`）与全 `features` 也。

### 5.3 ⭐ 資源提升規則（Satori 規範所要求）

Satori 規定：**嵌套之資源須提升至事件最外層、且 `message` 内部不再存之。**
規範原文：

> 当资源对象出现多级嵌套时，内层的资源将会被统一提升到最外层。例如，当接收到消息事件时，
> 事件体中可以访问到 `message`, `member`, `user`, `channel` 等资源，
> 但 `message` 中就不再存在 `member` 和 `user` 字段了。

本実装経 `satoriPromoteResources()` 成之：将 `message.user` /
`message.member` / `message.channel` / `message.guild` **搬至 `body` 頂層而自
`message` 之中 `delete`** 也。

**`message-created` 之実幀**（已削減）：

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

試験断言：

- `EVENT promotes channel/guild/user/member` ✅
- `EVENT message stripped of user/member/channel/guild` ✅
- `EVENT channel.id = group_id` ✅

> ⚠️ **一処与厳格規則之偏差**：`message-deleted` 与 `reaction-added` /
> `reaction-removed` 之 payload 為 **手工構築**（未経 `satoriPromoteResources`）、
> 其 `message` 之中 **仍帯一份嵌套 `channel`**、同時於頂層亦有 `channel`：

```json
{ "message": { "id": "777", "channel": { "id": "20001", "type": 0 } },
  "channel": { "id": "20001", "type": 0 } }
```

> 此乃 **冗而非缺**、SDK 読頂層即可；但若汝之代码厳格校験「`message` 之内不可有
> `channel`」、則須放寛。其余資源（`guild`/`user`/`member`/`operator`）皆在頂層也。

### 5.4 私聊事件之部

私聊 `message-created` **無 `guild`、亦無 `member`**（QQ 私聊無群語義）、
`channel` 為 `private:<uin>` 且 `type: 1`：

```json
{ "type": "message-created",
  "message": { "id": "778", "content": "dm", "created_at": 1700000001000 },
  "user": { "id": "30003", "name": "某人", "nick": "某人" },
  "channel": { "id": "private:30003", "type": 1 } }
```

### 5.5 事件 payload 速査

| 事件 | 頂層資源 |
| --- | --- |
| `message-created` | `message`、`user`、`channel`、`guild`（群聊）、`member`（群聊） |
| `message-deleted` | `message`、`channel`、`user`、`guild`（群撤回）、`operator`（若操作者≠発送者） |
| `guild-member-added` / `-removed` | `guild`、`channel`、`user`、`member`、`operator`（若有） |
| `guild-member-updated` | `guild`、`channel`、`user`、`member`（`group_admin` 之時含 `roles`） |
| `guild-request` / `guild-member-request` | `guild`、`channel`、`user`、`member`、`message`（`id`=flag、`content`=理由）、`operator` |
| `friend-request` | `user`、`message`（`id`=flag、`content`=検証消息） |
| `reaction-added` / `-removed` | `guild`、`channel`、`message`、`user`、`operator`、`emoji` |
| `login-added` / `login-removed` | `login`（完全、含 `status` + `features`） |

**請求 flag 如何取**（発起審批之時須用）：

```
guild-request        → body.message.id  → guild.approve        { message_id }
guild-member-request → body.message.id  → guild.member.approve { message_id }
friend-request       → body.message.id  → friend.approve       { message_id }
```

**表情 ID 如何取**：`reaction-*` 事件之 `emoji.id`、回伝与
`reaction.create` / `.delete` / `.list` 之 `emoji_id` 也。---

## 6. WebSocket 協議

### 6.1 Opcode

| 名称 | 値 | 方向 | 本実装 |
| --- | --- | --- | --- |
| `EVENT` | `0` | 服務端 → 客端 | ✅ 推送事件 |
| `PING` | `1` | **客端 → 服務端** | ✅ 受則回 `PONG` |
| `PONG` | `2` | 服務端 → 客端 | ✅ 唯作応答 |
| `IDENTIFY` | `3` | 客端 → 服務端 | ✅ 鑑権 |
| `READY` | `4` | 服務端 → 客端 | ✅ 鑑権成功 |
| `META` | `5` | 服務端 → 客端 | ❌ **未実装**（常量已宣言但従不発送） |

> ⚠️ **服務端不主動発 `PING` 也。** 規範之中「毎隔 10s 発 PING」乃 **応用（客端）** 之職責；
> 本実装唯 **被動応答**：受 `op:1` → 回 `{op:2, body:{}}`（試験断言 `PING -> PONG`）。
> 其余未知 opcode 唯記一条 debug 記録、**不関連接** 也。

### 6.2 接続流程

```
1. 客户端连接 ws://host:port/v1/events          （路径不符 → HTTP 404 拒绝升级）
2. 客户端在 10 秒内发送 IDENTIFY：{ op:3, body:{ token, sn? } }
3. 服务端校验 token：
      失败 → close(4004, "invalid token")
      成功 → 回 READY：{ op:4, body:{ logins:[Login], proxy_urls:[] } }
4. 之后服务端持续推 EVENT：{ op:0, body:{...事件...} }
5. 客户端每 10s 发 PING，服务端回 PONG（可选）
```

**READY 幀実様**：

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

- `proxy_urls` **恒為空陣列**（本実装無代理路由）；
- `logins` 恒為長 1 之陣列（単帳号）；
- 取 `get_login_info` 失敗之時以 `ctx.uin` 兜底、仍会正常回 READY 也。

### 6.3 錯誤処理与関閉碼

| 関閉碼 | 原因 | 触発 |
| --- | --- | --- |
| **`4004`** | `invalid token` | IDENTIFY 之 `body.token` 与設定不符 |
| **`4000`** | `invalid message` | 幀非合法 JSON、或非対象（非法幀） |
| **`4000`** | `IDENTIFY timeout` | 接続後 **10 秒之内未発 IDENTIFY** |
| `1008` | `access token changed` | 熱更新輪換令符、旧客端被断 |
| `1012` | `server closing` | 停用之時 **尚未完成 IDENTIFY** 之接続 |
| `1001` | `server closing` | `close()` / `forceClose()` 関閉凡接続 |

試験断言：`bad IDENTIFY token -> close 4004`、`invalid frame JSON -> close 4000`。

> 另以 harness 実走確認：不発 IDENTIFY 之時、**約 10 秒之後受
> `close(4000, "IDENTIFY timeout")`**、且接続自登記表除也。

### 6.4 `sn` 会話復元（⚠️ 未実装緩衝重放）

- `IDENTIFY.body.sn` 会被 **受容而記録** 於該接続之 `lastSn`；
- 但 **無任何事件緩衝与重放論理** —— 源码之中 `lastSn` 賦値之後 **再未被読**。
- 故：**断線重連之後、断開期間之事件永久失之**、不補発也。

> 若需可靠補史、請改用 HTTP 之 `message.list` 主動拉取也。
> 規範之会話復元語義（*重放 sn 之後之緩衝事件*）於本実装之中 **不成立**、勿依之。

### 6.5 ⚠️ IDENTIFY 之前之事件会被推送（安全関連）

`acceptConnection()` 会将接続 **直即** 登記入 `this.connections`、
而 `onEvent()` 之広播条件為 **唯査接続数、不査 `identified`**：

```js
onEvent(event, _payload) {
  if (!this.isEnabled || this.connections.size === 0) return;
  ...
  for (const connection of this.connections.values()) safeSend(connection.socket, frame);
}
```

**実測確認**：即使設定 `accessToken`、一 **不带任何憑據、亦未発 IDENTIFY**
之接続、於建立之後之 **10 秒窗口之内** 依然会受完全之 `EVENT` 幀（含消息内容）；
10 秒之後方被 `close(4000)` 逐去。原因者 **upgrade 階段未呼
`authorizeUpgrade()`** —— 該方法於適配器之上 **有定義但従未被 `startServer()` 呼**
（対比：`ws-server-connections.ts` 之中其実被用也）。

> **影響**：未鑑権者可暫窃事件流（毎接続最多 10 秒）。
> **緩和**：将 Satori 監聴綁於 **受信網絡/回環地址**、或於前置反代之上做鑑権；
> 勿直露於公網。此乃既知缺陷、已於 §9 如実標注也。

---

## 7. 資源対応（QQ 語義 → Satori）

### 7.1 対照表

| Satori | Haizakura / QQ |
| --- | --- |
| `Guild.id` | `group_id` |
| `Guild.name` | 群名（`group_name`、退 `group_remark`） |
| `Guild.avatar` | `https://p.qlogo.cn/gh/{group_id}/{group_id}/640` |
| `Channel.id` | 群聊 = `group_id`；私聊 = **`private:<uin>`** |
| `Channel.type` | `0` = TEXT（群聊）/ `1` = DIRECT（私聊） |
| `Channel.name` | 群聊 = 群名；私聊 = 陌生人昵称 |
| `User.id` | **文字列** 形式之 QQ 号 |
| `User.name` / `User.nick` | **群語境** 取 `card`（群名片）優先、否者 `nickname`；**私聊/`user.get`/`login.get`** 取 `nickname`（見下注） |
| `User.avatar` | `http://q.qlogo.cn/headimg_dl?dst_uin={uin}&spec=640` |
| `User.is_bot` | 由 QQ 号段推断（見 §7.3） |
| `GuildMember.user` | 同 `User` |
| `GuildMember.nick` | `card \|\| nickname` |
| `GuildMember.joined_at` | `join_time`（秒）× 1000 → **毫秒** |
| `GuildMember.roles` | `owner=4` / `admin=3` / `member=2`（恒 1 条） |
| `Message.id` | `message_id`（**整数 → 文字列**） |
| `Message.content` | OneBot 消息段編為 Satori 要素串（§8） |
| `Message.created_at` | **毫秒** 時間戳 |

> **関於 `User.name` 之取值語境**（源码 `satoriDecodeUser(uin, name)`）：
> `name` 与 `nick` **同時設定且値相同**、空之時 **両欄位皆不現**。取何者視呼出点：
>
> | 場景 | 所伝之 `name` | 実測 `name` |
> | --- | --- | --- |
> | `message-created`（群聊/私聊）、`message.get`、`guild.member.get`/`.list` | `card \|\| nickname` | `"群名片"` |
> | `user.get`、`login.get`、`channel.get`（私聊）、`reaction.list` | 唯 `nickname` | `"陌生人昵称"` |
> | `friend.list` | `nickname ?? remark`（另有 `nick` = `remark`） | `"好友昵称"` |
> | **凡 `notice` / `request` 事件**（`message-deleted`、`guild-member-*`、`guild-request`、`friend-request`、`reaction-*`） | **不伝**（単参呼出） | **`name` 欄位不存在** |
>
> 故同一使用者於 **群消息之中有名、於 notice/request 事件之中無 `name`** —— 此乃正常挙動也。
> 需昵称之時、請於 notice 事件之中按 `user.id` 回査 `user.get`、或直依 `user.id` 也。

### 7.2 ⚠️ 時間戳単位為毫秒

**此乃一条易錯之約定、務必看明：**

| 場景 | 単位 | 源码 |
| --- | --- | --- |
| 事件 `Message.created_at` | **毫秒** | `satoriToInt(event.time) * 1000` |
| `message.create` 返却之 `created_at` | **毫秒** | `Date.now()` |
| 事件封套 `timestamp` | **毫秒** | `Date.now()` |
| `GuildMember.joined_at` | **毫秒** | `satoriToInt(row.join_time) * 1000` |
| `guild.member.mute` 之 `duration` | **毫秒**（換為秒下発） | `ceil(duration / 1000)` |

OneBot 之 `event.time` 為 **秒**、本実装 **乗 1000** 転為 Satori 之毫秒也。
此裁定 **対照 LLBot 実装**（`+msgTime * 1000`）而定、試験已断言：

- `wire is snake_case: created_at in ms` → `created_at === 1700000000000` ✅
- `message.create created_at is ms` → `> 1e12` ✅
- `member joined_at is ms` → `1600000000000` ✅

> 判別之技：**13 位為毫秒、10 位為秒**。`1e12` 以上之時間戳即毫秒也。

### 7.3 `is_bot` 之判定

QQ 不直告客端「此為機器人」、本実装按 **既知之機器人号段** 推断
（源码 `SATORI_BOT_UIN_RANGES`）：

| 号段起 | 号段止 |
| --- | --- |
| `3328144510` | `3328144510` |
| `2854196301` | `2854216399` |
| `66600000` | `66600000` |
| `3889000000` | `3889999999` |
| `4010000000` | `4019999999` |

不在号段之内 → `is_bot: false`（試験断言普通使用者 `is_bot === false`）。

### 7.4 ⚠️ 線上欄位為 snake_case

凡欄位名於 **線上皆為 snake_case**：`is_bot`、`created_at`、`joined_at`、
`user_id`、`channel_id`、`guild_id`、`emoji_id`、`proxy_urls`、`role_id`、
`parent_id`、`reply_to`…

**不存在 camelCase 之版**。試験明確断言：

- `wire is snake_case: is_bot` → `is_bot === false && !("isBot" in user)` ✅
- `wire has no camelCase createdAt` → `!("createdAt" in message)` ✅

---

## 8. 消息要素

Satori 以 **XML 風之要素串** 編碼消息（非 OneBot 之消息段陣列）、
例如 `你好 <at id="30003"/> <emoji id="1"/>` 也。

### 8.1 受信方向（QQ → Satori）

OneBot 消息段編為要素串（源码 `satoriEncodeSegments`）：

| OneBot 段 | Satori 要素 | 説明 |
| --- | --- | --- |
| `text` | 転義後之純文本 | `& < > "` 会被転義 |
| `at` | `<at id="..."/>` | `qq == "all"` → `<at type="all"/>` |
| `face` | `<emoji id="..." name="..."/>` | |
| `mface` | `<emoji id="..." name="..."/>` | 取 `emoji_id` / `summary` |
| `image` / `flash_file` | `<img src="..." title="..."/>` | |
| `record` | `<audio src="..."/>` | |
| `video` | `<video src="..." poster="..."/>` | `thumb` → `poster` |
| `file` | `<file src="..." title="..."/>` | `name` → `title` |
| `reply` | `<quote id="..."/>` | |
| `forward` | `<message id="..." forward/>` | 合併転発 |
| `json` / `xml` | 転義後之原文文本 | 不存卡片結構 |
| `poke` | 純文本 `[戳一戳]` | |
| 其余未知段 | `data.text`（有則輸出）否者棄之 | |

- 空値属性会 **省略**（`satoriAttr` 跳 `undefined`/`null`/空串）；
- 段陣列之中非対象之要素被跳；
- `message` 非陣列之時按文字列全体転義也。

### 8.2 発送方向（Satori → QQ）

Satori 要素串解析為 OneBot 消息段（源码 `satoriParseFragment` + `satoriNodesToSegments`）。

**支持之要素**（実測輸出）：

| Satori 要素 | OneBot 段 | 実測 |
| --- | --- | --- |
| 純文本 | `text` | ✅ |
| `<br/>` | `text` `"\n"` | ✅ |
| `<p>…</p>` | 前後各補一 `"\n"` | ✅ |
| `<at id="1"/>` | `at` `{qq:"1"}` | ✅ |
| `<at type="all"/>` | `at` `{qq:"all"}` | ✅ |
| `<sharp id="9"/>` | `text` `"#9"` | ✅ 降為文本 |
| `<emoji id="1"/>` / `<face>` | `face` `{id:"1"}` | ✅ |
| `<img src/>` / `<image>` | `image` `{file:src}` | ✅ |
| `<audio src/>` | `record` `{file:src}` | ✅ |
| `<video src poster/>` | `video` `{file:src, thumb:poster}` | ✅ |
| `<file src title/>` | `file` `{file:src, name:title}` | ✅ |
| `<quote id="42"/>` | `reply` `{id:"42"}`（子要素続展開） | ✅ |
| `<a href="…">text</a>` | `text` `"text ( href )"` | ✅ 降為 `文本 ( 鏈接 )` |
| `<author/>` | **忽略**（不産段） | ✅ |
| `<message>` | 唯展開子要素 | ⚠️ 見下 |
| 未知要素 | **棄標籤、留内部文本** | ✅ |

**修飾要素降級規則**：`b` / `strong` / `i` / `em` / `u` / `ins` / `s` / `del` /
`spl` / `code` / `sup` / `sub` **一律降為純文本**（留内部文字、棄標籤）。
実測 `<b>bold</b>` → `[{type:"text",data:{text:"bold"}}]`。

**転義与容錯**：

- 支持 HTML 実体復元：`&lt; &gt; &quot; &apos; &amp;`、及
  `&#65;`（十進）、`&#x42;`（十六進）；
- **未閉標籤按文本処理**：`<b>oops` → 文本 `"oops"`；
- **遊離之 `>` 按文本**：`a > b` → `"a > b"`；
- `<!-- 注释 -->` 被跳；
- 解析 **刻意寛容**、避畸形 payload 成 500 也。

**⚠️ 既知之発送限制**（実測）：

| 輸入 | 結果 |
| --- | --- |
| `<message id="1"/>`（頂層） | **`400`** —— 解析不出可発段 |
| `<author id="1">x</author>` | **`400`** —— `author` 被忽略、無余段 |
| 純注釈 / 空串 | **`400`** `content must contain at least one sendable element` |

> 即：**解析後段列表為空 → 400**（空文本段亦会被濾去）。
> 合併転発（`<message forward>` 嵌套）於本実装之中 **不具発送能力** ——
> `<message>` 唯被当作透明容器展開、`id` 属性 **不会** 転為 `forward` 段
>（対比受信方向之 `forward` → `<message .../>`、两者 **不对称** 也）。---

## 9. 既知限制（如実標注）

| # | 限制 | 細節 |
| --- | --- | --- |
| 1 | **分頁為近似実装** | `message.list` 之 `next` 用「本頁最末一条之 id」、且唯於 `行数 ≥ limit` 之時給之；`prev`/`direction` 不支持。非協議所要求之真遊標也。 |
| 2 | **`sn` 会話復元未做緩衝重放** | `IDENTIFY.body.sn` 被記録之後 **従不使用**；断線期間事件永久失之（§6.4）。 |
| 3 | **真実 WS 幀收発唯於 arm64 検証過** | 本機（x64）缺 `ws` 之 native addon（唯有 arm64 二進制）、協議状態機以 **socket double** 駆動。**真実握手/分幀未被覆**、須於 arm64 主機復験也。 |
| 4 | **未実装之 API 返 404** | 此乃 **規範要求**（非缺陷）、但意味呼未列之方法（如 `channel.update`、`channel.delete`、`channel.mute`、`user.channel.create`、`message.update`、`guild.member.role.create`、`interaction.*`）皆得 404 也。 |
| 5 | **`private:` 頻道約定随 LLBot** | 為兼容 SDK 生態而採、非 Satori 強制；換実装之時注意也。 |
| 6 | **`messageFormat` 対 Satori 無効** | 適配器 **不読** 此欄位 —— Satori 永用要素串 `content`、無「array/string」之別也。 |
| 7 | **`reportSelfMessage` 対 Satori 無効** | 適配器 **不読** 此欄位。即使設為 `false`、`message_sent`（自己所発之消息）**仍会被転為 `message-created` 而推送**（実走確認）。 |
| 8 | **upgrade 階段未鑑権、存 10 秒事件窗口** | 未 IDENTIFY 之接続亦受事件、10 秒之後方被 `close(4000)`；`authorizeUpgrade()` 有定義但 **従未被呼**（§6.5）。勿露於公網也。 |
| 9 | **`META`(op 5) 未実装** | 常量已宣言、但服務端従不発送；`proxy_urls` 恒為 `[]`。 |
| 10 | **服務端不発 PING** | 心跳方向為 **客端 → 服務端**、服務端唯被動回 PONG 也。 |
| 11 | **`message-deleted` / `reaction-*` 未做厳格提升** | 此両 payload 之 `message` 之内 **仍帯一份 `channel`**（頂層亦有）、属冗也（§5.3）。 |
| 12 | **`guild.member.role.set` 不能転譲群主** | `role_id: "4"`/`owner` 会被当作 **取消管理員**（§4.5）。 |
| 13 | **`guild.member.mute` 存単位換算与舍入** | 毫秒 → 秒、`ceil` 且下限 1 秒；`0` 表解禁也。 |
| 14 | **`<message>` 不能発送合併転発** | 頂層 `<message>` 唯展開子要素、`id` 被忽略（§8.2）。 |
| 15 | **無既定 Satori 監聴** | 全新安裝 **不会** 自動創建 Satori 伺服器也。源码之中 `makeDefaultSatoriServer()` 已定義但 **従未被呼**（死代码）、既定設定之 `wsServers` 唯有 `path: "/"` 之 `ws-default`。必須手工加哨兵条目也。 |
| 16 | **`satoriHttpStatusForResponse` 為死代码** | 該関数能将 OneBot 之 `1404` 対応為 `404`、`1400` → `400`、但 **従未被呼**；実際凡下流失敗皆一律返 **`400`** 也。 |
| 17 | **`notice`/`request` 事件之 `User` 不帯 `name`/`nick`** | 唯有 `message-created` 与各 API 所返之 `User` 方帯名（§7.1 注）。需昵称須按 `user.id` 回査 `user.get` 也。 |

> **関於第 3 条**：`README-satori-tests.md` 明記 ——
> *"true wire-level WS handshake/framing is NOT covered here. Verify that on an arm64 host."*

---

## 10. 与 LLBot 之対比

| 項 | LLBot | Haizakura |
| --- | --- | --- |
| **接入方式** | 独立 `satoriServers` 設定項 | **復用 `wsServers[]` + `path` 哨兵** |
| **平台標識** | `llonebot` | `haizakura` |
| **API 数** | **28 個 handler**（29 個 `api__*.ts` 文件、含 `api__index.ts`） | **24 個** |
| **事件類型** | **11 種**（`guild-added` / `guild-removed` / `guild-request` / `guild-member-added` / `-removed` / `-request` / `message-created` / `-deleted` / `reaction-added` / `-removed` / `friend-request`） | **12 種**（見 §5.1） |
| 設定改動 | 需改 `config.ts`（新增 kind） | **零 `config.ts` 改動**（唯 patch 1 個原型方法） |
| WebUI 分組 | 独立之 Satori 分組 | 帰於「WS 伺服器」分組（状態標籤仍為 Satori） |
| 伝輸実装 | Hono + `@hono/node-server` + 公式 `ws` | `node:http` + **自研 `WebSocketServer`** |
| 類型転換 | `ts-case-convert` 之 `ObjectToSnake` | 手写構築 snake_case 字面量 |
| 参照位置 | `reference/satori/*.ts` | `restored/packages/onebot/src/network/satori-*.ts` |

**API 之差異（精確核対）**：Haizakura 之 **24 個乃 LLBot 28 個之厳格子集**、
差集恰為 **4 個** —— LLBot 多出下列 4 個（Haizakura 未実装、呼則返 `404`）：

```
channel.update        channel.delete        channel.mute
user.channel.create （创建私聊频道；LLBot 内部名 createDirectChannel）
```

> 核対方式：将両辺方法名逐一対斉（`getChannel` → `channel.get`、
> `handleGuildRequest` → `guild.approve`、`setGuildMemberRole` → `guild.member.role.set`、
> `createDirectChannel` → `user.channel.create` 等、由 `api__index.ts` 之 import 路徑推定）、
> 集合差恰為上述 4 項、故 **24 = 28 − 4** 完全吻合；
> Haizakura 側 **無 LLBot 所缺之独有方法** 也。
>
> 注：LLBot 按 `Universal.Methods` 査表（`server.ts` 之 `app.post('/v1/:name')`）、
> 故其 **実際可呼之面** 取决於 `handlers` 之関数名与協議方法名之交集也。

> **事件集合並不相同**（両辺各 11/12 種、但非包含関係）：
>
> - **LLBot 独有**：`guild-added`、`guild-removed`（Haizakura 無対応事件、
>   群創建/解散不産生 Satori 事件）；
> - **Haizakura 独有**：`guild-member-updated`、`login-added`、`login-removed`
>  （LLBot 之 `event__*.ts` 之中未見此三類）。
>
> ⚠️ 上表 LLBot 側之 handler 数与事件名由 `reference/satori/api__index.ts`
> 与 `event__*.ts` **静態統計** 而得、**未於 LLBot 運行実例之上実測**；
> Haizakura 側数字皆源自源码与本機実走也。

> Satori 之 `adapter` / `platform` 欄位標識 **平台類型**、用於 SDK 側之差異化処理。
> 两者取值不同（`llonebot` 与 `haizakura`）、**応用側之平台判断論理須相応適配** 也。

### 10.1 対 Satori 規範之覆蓋度

取本倉已抓之規範頁（`reference/satori-spec/`）中之方法名与本実装求差：

**規範有而本実装未実装**（呼則返 `404`）：

```
channel.create      channel.update      channel.delete      channel.mute
user.channel.create （创建私聊频道）      message.update
```

**本実装有而規範資源頁未列**（属平台拡張、SDK 一般亦能呼）：

```
login.get           guild.role.list     guild.member.role.set
reaction.create     reaction.delete     reaction.list
friend.list         friend.delete       friend.approve
```

> `*.md` 之類条目乃抓取頁中之鏈接噪聲、已除之也。
> 上表由 **静態比対** 而得、未逐個於真機呼過；規範是否尚有未抓之頁、
> 請以 <https://satori.chat> 為準也。

---

## 11. 快速検証

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

**WebSocket 事件流**（需 `websocat` 或 Node 脚本）：

```bash
websocat ws://127.0.0.1:5600/v1/events
# 连上后立刻发送（10 秒内！）：
{"op":3,"body":{"token":"<your-token>"}}
# 预期收到：{"op":4,"body":{"logins":[...],"proxy_urls":[]}}
```

### 復現試験套件

```bash
cd restored
node scripts/build.mjs                          # 产出 dist/index.mjs
node scripts/tests/run-satori-tests.mjs         # 76 条协议/API 断言
node scripts/tests/run-satori-integration.mjs   # 22 条挂载/NetworkManager 断言
```

### 実測結果（2026-11-13、本機）

| 請求 | 結果 |
| --- | --- |
| `login.get`（正頭 + token） | `200`、`platform: "haizakura"`、26 個 features |
| `login.get`（`Satori-Platform: qq`） | **`403`** `login not found` ✅ |
| `login.get`（完全不帯頭） | `200`（缺失被容） |
| `message.get`（下流動作失敗） | `400` `{"message":"unknown action"}` |
| `channel.update`（未実装） | **`404`** `method not found` ✅ |
| `GET /v1/login.get` | `405` + `Allow: POST` |
| `POST /v1/nonsense` | `404` `method not found` |
| WS：錯誤 token 之 IDENTIFY | `close(4004)` |
| WS：非法 JSON 幀 | `close(4000)` |
| WS：10 秒不発 IDENTIFY | `close(4000, "IDENTIFY timeout")` |
| WS：未 IDENTIFY 即受事件 | ⚠️ **受之**（10 秒窗口、見 §9 第 8 条） |

---

## 12. 常見質問

| 現象 | 原因 | 処理 |
| --- | --- | --- |
| WebUI 之中不見 Satori 分組 | 設計如此、復用 `wsServers[]` | 於「WS 伺服器」分組尋之、**状態標籤為 Satori** |
| 設 `path: "/v1/events"` 却似 OneBot | 哨兵拼写不符（如前綴多余） | `path` 必須 **精確等於** `/v1/events` |
| OneBot WS 忽変挙動 | **`/v1/events` 被 OneBot 占之** | 与 OneBot 用他 `path`（如 `/`） |
| `403 login not found` | `Satori-Platform` 伝非 `haizakura`（如 `qq`）、或 `Satori-User-ID` 不対 | 改頭；**`haizakura`** 也 |
| `401 authorization required` | 設定 token 而未帯 `Authorization` | 加 `Authorization: Bearer <token>` |
| `404 method not found` | 方法不在 24 個白名単之内 | 見 §4；此乃規範挙動、非故障也 |
| 呼未実装方法欲得 501 | 規範要求 404 | 勿依 501 |
| 所受事件之中 `message` 無 `user` | **資源提升**、去頂層取 | 見 §5.3 |
| 時間比所期大 1000 倍 | 即 **毫秒** 也 | 見 §7.2 |
| 欄位名不対（`isBot`） | 線上為 **snake_case** | 見 §7.4 |
| WS 連上無反応 | 未於 10 秒之内発 IDENTIFY | 直即発 `{op:3,body:{token}}` |
| 重連之後缺事件 | `sn` 復元 **未実装重放** | 用 `message.list` 補史 |
| 自己所発之消息亦被推来 | `reportSelfMessage` **対 Satori 無効** | 応用側按 `user.id == 自己` 濾之 |
| `message.create` 返 400 | `content` 解析後無可発要素（空串/純注釈/頂層 `<message>`） | 至少置一文本或支持之要素 |
| 群成員 `joined_at` 缺失 | `join_time` ≤ 0 之時此欄位 **不現** | 属正常任意欄位語義 |
| 保存設定報令符錯誤 | 非回環地址必須 ≥ 16 文字且不易猜 | 用随機 token 或綁 `127.0.0.1` |
| 保存設定報 `statusCommand must be an object` | `POST /api/config/:uin` 要求 **完全** 設定 | 用 §2.2 之完全形状 |
| `channel.list` 唯有 1 条 | QQ **一群一頻道**（`guild.plain`） | 属所期也 |
| 転譲群主失敗/被取消管理員 | `role.set` 唯表管理員開関 | 見 §9 第 12 条 |

---

## 13. 声明表

| 項目 | 状態 |
| --- | --- |
| 哨兵識別規則、匹配容錯（尾部斜杠/査詢串） | **已核実**：源码 + harness 実走（6 種 path 形态） |
| 24 個 API 之転発目標、参數、返却値 | **已核実**：`SATORI_API` 表 + 逐個実走 |
| 事件類型（12 種）与資源提升 | **已核実**：源码 + 実幀 dump；10 種有試験断言 |
| 状態碼、鑑権頭挙動、404/405 分枝 | **已核実**：源码 + 実走 7 種請求 |
| WS opcode、関閉碼、10s IDENTIFY 超時 | **已核実**：socket double 実走 |
| 要素收発与降級規則 | **已核実**：22 組收発用例実走 |
| `reportSelfMessage` / `messageFormat` 無効 | **已核実**：源码無参照 + 実走復現 |
| 事件於 IDENTIFY 之前被推送 | **已核実**：実走復現（10 秒窗口） |
| 98/98 試験通過 | **已核実**：本機実走 76 + 22 |
| 真実 WS 握手与分幀 | ⚠️ **未検証**（x64 缺 native addon、須 arm64 復験） |
| 本文例之端口/群号/token | 示例値、**未** 於汝之環境実測 |

> 未実測項：**真実 WebSocket 幀級收発**（握手、掩碼、分片）未於本機検証、
> 協議状態機之部分経 socket double 覆蓋、結論源自源码読解 + 双精度実走也。