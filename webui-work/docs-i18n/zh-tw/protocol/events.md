# OneBot v11 事件參考（events）

> [!WARNING]
> 本內容完全由 AI 撰寫，請謹慎檢視。

> 本文描述 Haizakura（原 SnowLuma）向用戶端推送的 **OneBot v11 事件格式**：
> 信封結構、四類事件（meta / message / notice / request）的完整欄位，
> 以及訊息段（segment）的收發格式。
>
> **資料來源**：`packages/onebot/src/event-converter/*.ts`（各類事件轉換器）、
> `packages/onebot/src/event-filter.ts`（格式分支）、
> `packages/onebot/src/instance.ts`（meta 事件的建構與心跳）。
>
> 欄位名與取值全部由原始碼 `data` 字面量提取。

---

## 1. 事件信封

所有事件都是 JSON 物件，**公共欄位**（原始碼 `event-converter/envelope.ts`）：

| 欄位 | 類型 | 說明 |
| --- | --- | --- |
| `time` | integer | 事件發生時間（**Unix 秒**） |
| `self_id` | integer | 收到該事件的機器人 QQ 號 |
| `post_type` | string | 事件大類：`message` / `message_sent` / `notice` / `request` / `meta_event` |

三個建構器分別產出：

```js
// notice
{ time, self_id, post_type: "notice", ...fields }
// request
{ time, self_id, post_type: "request", ...fields }
// message / message_sent（由调用方决定 postType）
{ time, self_id, post_type, ...fields }
```

### 1.1 `post_type` 一覽

| `post_type` | 含義 | 觸發 |
| --- | --- | --- |
| `message` | 收到他人訊息 | 私聊 / 群聊 / 臨時會話 |
| `message_sent` | **自己**送出的訊息（自回顯） | 需 `reportSelfMessage: true` |
| `notice` | 通知類事件 | 13 種 `notice_type` |
| `request` | 請求類事件 | 加好友 / 加群 |
| `meta_event` | 元事件 | 生命週期 + 心跳 |

> ⚠️ `message_sent` 在配接器 `reportSelfMessage: false`（預設）時
> **整個事件被丟棄**，不會推送（原始碼 `shapeEventForAdapter`）。

### 1.2 事件類型 → 轉換器對應

原始碼 `event-converter/index.ts` 的 `CONVERTERS` 表（**權威清單**）：

| 內部 `kind` | 產出事件 | 轉換器 |
| --- | --- | --- |
| `friend_message` | `message` / `message_sent`（private/friend） | `convertFriendMessage` |
| `group_message` | `message` / `message_sent`（group/normal） | `convertGroupMessage` |
| `temp_message` | `message`（private/group） | `convertTempMessage` |
| `group_member_join` | `notice` / `group_increase` | ✔ |
| `group_member_leave` | `notice` / `group_decrease` | ✔ |
| `group_mute` | `notice` / `group_ban` | ✔ |
| `group_admin` | `notice` / `group_admin` | ✔ |
| `friend_recall` | `notice` / `friend_recall` | ✔ |
| `group_recall` | `notice` / `group_recall` | ✔ |
| `friend_poke` | `notice` / `notify` / `poke` | ✔ |
| `group_poke` | `notice` / `notify` / `poke` | ✔ |
| `group_essence` | `notice` / `essence` | ✔ |
| `group_file_upload` | `notice` / `group_upload` | ✔ |
| `friend_add` | `notice` / `friend_add` | ✔ |
| `friend_input_status` | `notice` / `notify` / `input_status` | ✔ |
| `friend_profile_like` | `notice` / `notify` / `profile_like` | ✔ |
| `bot_offline` | `notice` / `bot_offline` | ✔ |
| `group_name_change` | `notice` / `notify` / `group_name` | ✔ |
| `group_title_change` | `notice` / `notify` / `title` | ✔ |
| `group_card_change` | `notice` / `group_card` | ✔ |
| `group_msg_emoji_like` | `notice` / `group_msg_emoji_like` | ✔ |
| `friend_request` | `request` / `friend` | ✔ |
| `group_invite` | `request` / `group` | ✔ |
| `ptt_trans_result` | — | **`null`：明確不轉換** |
| `online_devices_changed` | — | **`null`：明確不轉換** |
| `friend_remark_changed` | — | **`null`：明確不轉換** |

> 表中對應為 `null` 的三種內部事件**不會產生 OneBot 事件**
> （原始碼明確宣告，非遺漏）。

---

## 2. 訊息事件（`message` / `message_sent`）

### 2.1 群訊息（`message_type: "group"`）

原始碼 `convertGroupMessage`：

```json
{
  "time": 1700000000,
  "self_id": <uin>,
  "post_type": "message",
  "message_type": "group",
  "sub_type": "normal",
  "message_id": -123456,
  "message_seq": 4567,
  "group_id": 20001,
  "group_name": "测试群",
  "user_id": 10001,
  "message": [ { "type": "text", "data": { "text": "你好" } } ],
  "raw_message": "你好",
  "font": 0,
  "sender": {
    "user_id": 10001,
    "nickname": "昵称",
    "card": "群名片",
    "role": "member",
    "sex": "unknown",
    "age": 0
  },
  "anonymous": null
}
```

| 欄位 | 類型 | 說明 |
| --- | --- | --- |
| `message_type` | string | 恆為 `"group"` |
| `sub_type` | string | 恆為 `"normal"` |
| `message_id` | integer | **可為負值** |
| `message_seq` | integer | 原始訊息序號 |
| `group_id` | integer | 群號 |
| `group_name` | string | 群名 |
| `user_id` | integer | 傳送者 QQ 號 |
| `message` | array \| string | 訊息段陣列（或 CQ 碼字串，見 §6） |
| `raw_message` | string | CQ 碼形式的原始訊息 |
| `font` | integer | 恆為 `0` |
| `sender.role` | string | `owner` / `admin` / `member`，缺省為 `"member"` |
| `sender.card` | string | 群名片 |
| `sender.sex` | string | 恆為 `"unknown"`（本實作不提供） |
| `sender.age` | integer | 恆為 `0`（本實作不提供） |
| `anonymous` | null | 恆為 `null` |

> ⚠️ **`sender.sex` 與 `sender.age` 恆為佔位值**（`"unknown"` / `0`），
> 不是真實資料。需要真實資料請呼叫 `get_stranger_info` / `get_group_member_info`。

### 2.2 私聊訊息（`message_type: "private"`）

原始碼 `convertPrivateMessage`，`sub_type` 有兩種：

| 情境 | `sub_type` | 來源 |
| --- | --- | --- |
| 好友私聊 | `"friend"` | `convertFriendMessage` |
| 臨時會話（群臨時） | `"group"` | `convertTempMessage` |

```json
{
  "time": 1700000000,
  "self_id": <uin>,
  "post_type": "message",
  "message_type": "private",
  "sub_type": "friend",
  "message_id": -123456,
  "message_seq": 4567,
  "user_id": 10001,
  "message": [ { "type": "text", "data": { "text": "在吗" } } ],
  "raw_message": "在吗",
  "font": 0,
  "sender": { "user_id": 10001, "nickname": "昵称", "sex": "unknown", "age": 0 }
}
```

- 臨時會話（`sub_type: "group"`）額外帶 `sender.group_id`（來源群）。
- 私聊事件的 `sender` **沒有** `card` / `role` 欄位。
- **自己送出的私聊**（`message_sent`）且會話對象不是自己時，額外帶
  `target_id`（接收方 QQ 號）。
- `message_id` 優先取 `ntMsgSeq`，缺失時退回 `msgSeq`（原始碼
  `hasCanonicalNtSequence`）。

---

## 3. 通知事件（`notice`）

共 **13 種 `notice_type`**（原始碼 `to-notice.ts`）。

### 3.1 群成員增加 — `group_increase`

```json
{
  "time": 1700000000, "self_id": <uin>,
  "post_type": "notice", "notice_type": "group_increase",
  "sub_type": "approve",
  "group_id": 20001, "operator_id": 10002, "user_id": 10001
}
```

`sub_type`：`"approve"`（管理員批准）/ `"invite"`（被邀請）/
其他來自事件的 `joinType`。判定：操作者與目標不同人 → `invite`，否則 `approve`。

### 3.2 群成員減少 — `group_decrease`

```json
{
  "post_type": "notice", "notice_type": "group_decrease",
  "sub_type": "kick",
  "group_id": 20001, "operator_id": 10002, "user_id": 10001
}
```

`sub_type` 取值：`"leave"`（主動退群）/ `"kick"`（被踢）/
`"kick_me"`（**機器人自己被踢**）/ `"disband"`（群解散）。

### 3.3 群禁言 — `group_ban`

```json
{
  "post_type": "notice", "notice_type": "group_ban",
  "sub_type": "ban",
  "group_id": 20001, "operator_id": 10002, "user_id": 10001,
  "duration": 600
}
```

`sub_type`：`duration > 0` → `"ban"`；`duration == 0` → `"lift_ban"`。
`duration` 單位為**秒**。

### 3.4 群管理員變動 — `group_admin`

```json
{
  "post_type": "notice", "notice_type": "group_admin",
  "sub_type": "set",
  "group_id": 20001, "user_id": 10001
}
```

`sub_type`：`"set"`（設為管理員）/ `"unset"`（取消）。

### 3.5 好友撤回 — `friend_recall`

```json
{
  "post_type": "notice", "notice_type": "friend_recall",
  "user_id": 10001, "message_id": -123456
}
```

### 3.6 群撤回 — `group_recall`

```json
{
  "post_type": "notice", "notice_type": "group_recall",
  "group_id": 20001, "operator_id": 10002,
  "user_id": 10001, "message_id": -123456
}
```

`operator_id` 為執行撤回者，`user_id` 為原訊息作者。

### 3.7 戳一戳 — `notify` / `poke`

**好友戳一戳**：

```json
{
  "post_type": "notice", "notice_type": "notify", "sub_type": "poke",
  "user_id": 10001, "sender_id": 10001, "target_id": <uin>,
  "action": "戳了戳", "suffix": "的脸", "action_img_url": "https://..."
}
```

**群戳一戳**：同上，但用 `group_id` + `user_id`（不含 `sender_id`）。

| 欄位 | 說明 |
| --- | --- |
| `action` | 動作文案，如 `戳了戳` |
| `suffix` | 後綴文案 |
| `action_img_url` | 動作圖片 URL |

### 3.8 群精華訊息 — `essence`

```json
{
  "post_type": "notice", "notice_type": "essence",
  "sub_type": "add",
  "group_id": 20001, "user_id": 10001, "sender_id": 10001,
  "operator_id": 10002, "message_id": -123456,
  "message_seq": 4567, "random": 123456789
}
```

`sub_type`：`"add"`（設為精華）/ `"delete"`（移出精華）。

### 3.9 群檔案上傳 — `group_upload`

```json
{
  "post_type": "notice", "notice_type": "group_upload",
  "group_id": 20001, "user_id": 10001,
  "file": { "id": "<file-id>", "name": "a.zip", "size": 1024, "busid": 102 }
}
```

### 3.10 好友新增 — `friend_add`

```json
{ "post_type": "notice", "notice_type": "friend_add", "user_id": 10001 }
```

### 3.11 群名片變更 — `group_card`

```json
{
  "post_type": "notice", "notice_type": "group_card",
  "group_id": 20001, "user_id": 10001,
  "card_new": "新名片", "card_old": "旧名片"
}
```

### 3.12 機器人離線 — `bot_offline`

```json
{
  "post_type": "notice", "notice_type": "bot_offline",
  "user_id": <uin>, "tag": "<tag>", "message": "<原因>"
}
```

> 這是**非標準**通知類型，用於告知連線斷開。

### 3.13 群訊息表態 — `group_msg_emoji_like`

```json
{
  "post_type": "notice", "notice_type": "group_msg_emoji_like",
  "sub_type": "add",
  "group_id": 20001, "user_id": 10002, "operator_id": 10002,
  "message_id": -123456, "message_seq": 4567,
  "likes": [ { "emoji_id": "128077", "count": 1 } ]
}
```

`sub_type`：`"add"`（新增）/ `"remove"`（取消）。

### 3.14 `notify` 的其餘 `sub_type`

原始碼 `to-notice.ts` 中出現的 `notify` 子類型共 **5 種**（`poke` 出現兩次，
分為好友與群兩個轉換器）：

| `sub_type` | 附加欄位 | 說明 |
| --- | --- | --- |
| `poke` | `user_id`, `target_id`, `action`, `suffix`, `action_img_url`（好友形態另含 `sender_id`） | 戳一戳 |
| `profile_like` | `operator_id`, `operator_nick`, `times` | 名片按讚 |
| `title` | `group_id`, `user_id`, `title` | 群專屬頭銜變更 |
| `group_name` | `group_id`, `user_id`, `name_new` | 群名變更 |
| `input_status` | `user_id`, `event_type`, `status_text` | 好友輸入狀態 |

### 3.15 機器人自身狀態 — `bot_status`

```json
{
  "time": 1700000000, "self_id": <uin>,
  "post_type": "notice", "notice_type": "bot_status",
  "sub_type": "online", "user_id": <uin>
}
```

`sub_type`：`"online"`（登入成功）/ `"offline"`（下線）。
> 同樣為**非標準**擴充類型（原始碼 `makeBotStatusEvent`）。

---

## 4. 請求事件（`request`）

### 4.1 加好友請求 — `request_type: "friend"`

```json
{
  "time": 1700000000, "self_id": <uin>,
  "post_type": "request", "request_type": "friend",
  "user_id": 10001,
  "comment": "我是...",
  "flag": "<flag>"
}
```

### 4.2 加群請求 / 邀請 — `request_type: "group"`

```json
{
  "post_type": "request", "request_type": "group",
  "sub_type": "invite",
  "group_id": 20001, "user_id": 10001,
  "invited_id": <uin>,
  "comment": "一起来玩",
  "flag": "<flag>"
}
```

| 欄位 | 說明 |
| --- | --- |
| `sub_type` | `"invite"`（邀請）/ `"add"`（申請加群），缺省 `"invite"` |
| `invited_id` | **僅當被邀請者 UIN > 0 時出現** |
| `comment` | 驗證訊息 |
| `flag` | 用於 `set_friend_add_request` / `set_group_add_request` 回傳 |

---

## 5. 元事件（`meta_event`）

原始碼 `instance.ts`。

### 5.1 生命週期 — `meta_event_type: "lifecycle"`

```json
{
  "time": 1700000000,
  "self_id": <uin>,
  "post_type": "meta_event",
  "meta_event_type": "lifecycle",
  "sub_type": "connect",
  "status": { "online": true, "good": true }
}
```

`sub_type` 取值：

| `sub_type` | 觸發時機 |
| --- | --- |
| `"connect"` | 網路配接器建立連線時推送 |
| `"enable"` | 配接器啟用時推送 |
| `"disable"` | 配接器關閉（`closeConnections`）時推送 |

`status.online`：帳號在線；`status.good`：`online && bridge.receiveHealthy`。

### 5.2 心跳 — `meta_event_type: "heartbeat"`

```json
{
  "time": 1700000000,
  "self_id": <uin>,
  "post_type": "meta_event",
  "meta_event_type": "heartbeat",
  "status": { "online": true, "good": true },
  "interval": 30000
}
```

- **間隔 30000 ms（30 秒）**，原始碼 `OneBotInstance.HEARTBEAT_INTERVAL = 3e4`。
- `interval` 欄位回顯該間隔，便於用戶端自檢。
- 計時器呼叫 `unref()`，不會阻止行程退出。

### 5.3 連線建立時的 bootstrap

**事件類用戶端（`Event` / `Universal`）在（重新）連線後立刻收到 3 幀**
（原始碼 `adapter.ts` 的 `bootstrapMetaFrames`），順序固定：

```
1. meta_event / lifecycle / sub_type: "connect"
2. meta_event / lifecycle / sub_type: "enable"
3. meta_event / heartbeat
```

- 伺服器**關閉時**向非 `Api` 連線推送 `lifecycle` / `sub_type: "disable"`。
- SSE 連線同樣先補發 bootstrap，再補發歷史幀。
- 用戶端**必須能容忍連線後立即收到 meta 事件**，不要把
  `lifecycle(connect)` 誤判為業務事件。

> ⚠️ **無 `meta_event_type: "connect"` 寫法**：連線類事件走的是
> `lifecycle` + `sub_type`，這是本實作的形態。

---

## 6. 訊息段（segment）格式

### 6.1 基本結構

```json
{ "type": "text", "data": { "text": "你好" } }
```

`message` 欄位（`messageFormat: "array"`）為**訊息段陣列**；
`messageFormat: "string"` 時替換為 CQ 碼字串 `raw_message`。

### 6.2 接收方向：16 種段類型

原始碼 `ELEMENT_CODECS`（`element-codecs.ts`），共 **16** 種：

| `type` | `data` 欄位 | 說明 |
| --- | --- | --- |
| `text` | `text` | 純文字 |
| `face` | `id`, `resultId?`, `large?` | QQ 表情 |
| `at` | `qq`（`"all"` 表示全體） | @某人 |
| `reply` | `id` | 引用回覆 |
| `image` | `url`, `file`, `sub_type`, `summary`, `type?`, `emoji_id?`, `emoji_package_id?`, `key?` | 圖片 / 表情包 |
| `record` | `file`, `url` | 語音 |
| `video` | `file`, `url` | 影片 |
| `json` | `data` | JSON 卡片 |
| `xml` | `data`, `resid`（預設 `35`） | XML 卡片 |
| `file` | `file`, `file_id`, `file_size`, `name`, `size`, `id`, `url`, `file_hash` | 檔案 |
| `mface` | （轉換為 `image`） | 市場表情 |
| `poke` | `type` | 戳一戳 |
| `flash_file` | `title`, `file_set_id`, `scene_type`, `thumb` | 閃傳檔案 |
| `forward` | `id` | 合併轉發 |
| `markdown` | `content` | Markdown 訊息 |
| `inline_keyboard` | `bot_appid`, `rows[].buttons[]` | 內嵌鍵盤 |

**要點**：

- `mface` 在接收方向**被合併進 `image`**，`data` 裡帶
  `emoji_id` / `emoji_package_id` / `key`，`url` 指向
  `https://gxh.vip.qq.com/club/item/parcel/item/<前2位>/<emoji_id>/raw300.gif`。
- `reply` 的 `id` 是**字串**；解析不到目標訊息時該段**被省略**
  （日誌提示 `quote target unresolved ...; omitting reply id`）。
- `at` 的 `qq` 為 `"all"` 表示 @全體成員。
- `image` 的 `data.type` 為 `"flash"` 表示閃照。

### 6.3 發送方向：額外 9 種相容段

原始碼 `message-parser.ts` 的 `segmentToElement` 額外接受：

| `type` | 必填欄位 | 轉換結果 |
| --- | --- | --- |
| `share` | `url`, `title`（`content`, `image` 可選） | → `json` 卡片（`com.tencent.structmsg` / `news`） |
| `music` | `type` + `id`，或 `custom` 類型 + `url`/`audio`/`title` | → `json` 卡片（需外鏈簽章服務） |
| `location` | 見原始碼 | 位置卡片 |
| `contact` | 見原始碼 | 好友/群推薦卡片 |
| `rps` | — | 猜拳 |
| `dice` | — | 骰子 |
| `shake` | — | 視窗抖動 |
| `anonymous` | — | 匿名訊息標記 |
| `node` | — | **僅允許在合併轉發節點清單內** |

> `node` 出現在頂層會拋 `UNSENDABLE_TYPE`：
> `message segment "node" is only valid inside a forward node list`。
>
> `music` 的簽章服務預設 `https://ss.xingzhige.com/music_card/card`，
> 需外網可達；失敗時該段被跳過。

### 6.4 空文字佔位符

段陣列中 `text` 欄位**恰為 `""`** 的 text 段被視為**相容佔位符**，
不計入「可傳送段」：

```js
function isExplicitEmptyTextPlaceholder(segment) { /* text === "" 精确匹配 */ }
```

區別：

| 寫法 | 行為 |
| --- | --- |
| `{ "type":"text", "data":{ "text":"" } }` | 相容佔位符，**忽略** |
| `{ "type":"text", "data":{} }` | 正常校驗 → 報錯 |
| `{ "type":"text", "data":{ "text":null } }` | 正常校驗 → 報錯 |
| `{ "type":"text", "data":{ "text":"  " } }` | 正常校驗（僅空白也算內容） |

### 6.5 CQ 碼

字串形式使用 CQ 碼，正規表示式（`message-parser.ts`）：

```js
var CQ_REGEX = /\[CQ:([A-Za-z][A-Za-z0-9_]*)(?:,([^\]]*))?\]/g;
```

範例：`[CQ:face,id=1]`、`[CQ:at,qq=10001]`。
`auto_escape: true` 時字串中的 CQ 碼**不被解析**，按純文字傳送。

---

## 7. 訊息 ID 說明

- `message_id` **可為負值**，這是正常現象，不要把負數當異常。
- 私聊 `message_id` 優先使用 `ntMsgSeq`；群聊使用 `msgSeq`
  （原始碼 `applyMessageIdResolver`）。
- 解析不到時退回原始序號 `seq`；`seq === 0` 時回傳 `0`。
- 對事件回傳 `message_id`（如 `get_msg`、`delete_msg`）時，
  訊息須在**目前帳號的訊息儲存**中可查詢，否則報
  `message not found`。

---

## 8. 用戶端實作建議

| 情境 | 建議 |
| --- | --- |
| 連線後立即收到 meta 事件 | 正常，先忽略 `lifecycle(connect/enable)` 再處理業務 |
| 自己發的訊息收不到 | 需要則開啟 `reportSelfMessage: true` |
| `message` 是字串不是陣列 | 配接器 `messageFormat: "string"`；改設定或按 CQ 碼解析 |
| 心跳判活 | 以 `interval`（30000ms）為準，容忍 2~3 次遺漏 |
| 事件去重 | 斷線重連會**重發 bootstrap**，且 SSE 支援 `Last-Event-ID` 補發，需按 `message_id` 去重 |
| 僅需動作不需事件 | 連線 `role` 用 `Api` |
| 僅需事件不需動作 | 連線 `role` 用 `Event` |

---

## 9. 與標準 OneBot v11 的差異

| 項目 | 差異 |
| --- | --- |
| `sender.sex` / `sender.age` | 恆為 `"unknown"` / `0`，非真實資料 |
| `bot_offline` | 非標準 `notice_type` |
| `bot_status` | 非標準 `notice_type`（`sub_type`: `online`/`offline`） |
| `message_sent` | 需 `reportSelfMessage` 才推送 |
| 三種內部事件 | `ptt_trans_result` / `online_devices_changed` / `friend_remark_changed` **明確不轉換** |
| `get_supported_actions` | ❌ 未實作（見 `actions.md`） |
| 額外欄位 | `message_seq`（訊息與部分通知事件）、`group_name`（群訊息）、`target_id`（自回顯私聊）等擴充欄位 |

---

## 10. 聲明

| 項目 | 狀態 |
| --- | --- |
| 信封三個建構器 | **已核實**：`envelope.ts` |
| 13 種 `notice_type` 與全部欄位 | **已核實**：`to-notice.ts` 字面量 |
| 6 種 `notify` 子類型 | **已核實**：`to-notice.ts` |
| 2 種 `request_type` | **已核實**：`to-request.ts` |
| meta 事件的 `sub_type` 與 bootstrap 順序 | **已核實**：`instance.ts` + `adapter.ts` |
| 心跳 30000ms | **已核實**：`HEARTBEAT_INTERVAL = 3e4` |
| 16 種接收段類型 | **已核實**：`ELEMENT_CODECS` |
| 9 種發送相容段 | **已核實**：`segmentToElement` |
| 空文字佔位符規則 | **已核實**：`isExplicitEmptyTextPlaceholder` |
| 各事件的實機 JSON | **未實測**：欄位來自原始碼，未經真機抓封包驗證 |

> 本文**未**在真機抓取過事件流。所有欄位名與取值均來自原始碼字面量提取，
> 結構可信；但**欄位出現與否的條件**（如 `invited_id`、`target_id`）
> 建議在實際接入時以真實事件為準。
