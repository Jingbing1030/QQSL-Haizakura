# OneBot v11 事件参考（events）

> [!WARNING]
> 本内容完全由 AI 編写，請謹慎閲覧。

> 本文述 Haizakura（原 SnowLuma）向客户端推送之 **OneBot v11 事件格式**：
> 信封結構、四類事件（meta / message / notice / request）之完全字段，
> 以及消息段（segment）之收發格式。
>
> **資料来源**：`packages/onebot/src/event-converter/*.ts`（各類事件変換器）、
> `packages/onebot/src/event-filter.ts`（格式分支）、
> `packages/onebot/src/instance.ts`（meta 事件之構築与心搏）。
>
> 字段名与取值全由源碼 `data` 字面量抽出。

---

## 1. 事件信封

所有事件皆為 JSON 対象，**公共字段**（源碼 `event-converter/envelope.ts`）：

| 字段 | 類型 | 説明 |
| --- | --- | --- |
| `time` | integer | 事件発生時間（**Unix 秒**） |
| `self_id` | integer | 収到該事件之機器人 QQ 号 |
| `post_type` | string | 事件大類：`message` / `message_sent` / `notice` / `request` / `meta_event` |

三個構築器分別産出：

```js
// notice
{ time, self_id, post_type: "notice", ...fields }
// request
{ time, self_id, post_type: "request", ...fields }
// message / message_sent（由调用方决定 postType）
{ time, self_id, post_type, ...fields }
```

### 1.1 `post_type` 一覧

| `post_type` | 含義 | 触發 |
| --- | --- | --- |
| `message` | 収到他人消息 | 私聊 / 群聊 / 臨時会話 |
| `message_sent` | **自己**發出之消息（自回顕） | 需 `reportSelfMessage: true` |
| `notice` | 通知類事件 | 13 種 `notice_type` |
| `request` | 請求類事件 | 加好友 / 加群 |
| `meta_event` | 元事件 | 生命周期 + 心搏 |

> ⚠️ `message_sent` 於適配器 `reportSelfMessage: false`（既定）時
> **整個事件被棄**，不会推送（源碼 `shapeEventForAdapter`）。

### 1.2 事件類型 → 変換器映射

源碼 `event-converter/index.ts` 之 `CONVERTERS` 表（**権威清単**）：

| 内部 `kind` | 産出事件 | 変換器 |
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
| `ptt_trans_result` | — | **`null`：明示不変換** |
| `online_devices_changed` | — | **`null`：明示不変換** |
| `friend_remark_changed` | — | **`null`：明示不変換** |

> 表中映射為 `null` 之三種内部事件**不産生 OneBot 事件**
> （源碼明示宣言，非遺漏也）。

---

## 2. 消息事件（`message` / `message_sent`）

### 2.1 群消息（`message_type: "group"`）

源碼 `convertGroupMessage`：

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

| 字段 | 類型 | 説明 |
| --- | --- | --- |
| `message_type` | string | 恒為 `"group"` |
| `sub_type` | string | 恒為 `"normal"` |
| `message_id` | integer | **可為負値** |
| `message_seq` | integer | 原始消息序号 |
| `group_id` | integer | 群号 |
| `group_name` | string | 群名 |
| `user_id` | integer | 送信者 QQ 号 |
| `message` | array \| string | 消息段数組（或 CQ 碼串，見 §6） |
| `raw_message` | string | CQ 碼形式之原始消息 |
| `font` | integer | 恒為 `0` |
| `sender.role` | string | `owner` / `admin` / `member`，既定為 `"member"` |
| `sender.card` | string | 群名片 |
| `sender.sex` | string | 恒為 `"unknown"`（本実装不提供） |
| `sender.age` | integer | 恒為 `0`（本実装不提供） |
| `anonymous` | null | 恒為 `null` |

> ⚠️ **`sender.sex` 与 `sender.age` 恒為占位値**（`"unknown"` / `0`），
> 非真実資料。需真実資料者請呼 `get_stranger_info` / `get_group_member_info` 也。

### 2.2 私聊消息（`message_type: "private"`）

源碼 `convertPrivateMessage`，`sub_type` 有二種：

| 場景 | `sub_type` | 来源 |
| --- | --- | --- |
| 好友私聊 | `"friend"` | `convertFriendMessage` |
| 臨時会話（群臨時） | `"group"` | `convertTempMessage` |

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

- 臨時会話（`sub_type: "group"`）额外帯 `sender.group_id`（来源群）。
- 私聊事件之 `sender` **無** `card` / `role` 字段。
- **自己發出之私聊**（`message_sent`）且会話対象非自己時，额外帯
  `target_id`（接收方 QQ 号）。
- `message_id` 優先取 `ntMsgSeq`，欠時退回 `msgSeq`（源碼
  `hasCanonicalNtSequence`）。

---

## 3. 通知事件（`notice`）

共 **13 種 `notice_type`**（源碼 `to-notice.ts`）。

### 3.1 群成員増加 — `group_increase`

```json
{
  "time": 1700000000, "self_id": <uin>,
  "post_type": "notice", "notice_type": "group_increase",
  "sub_type": "approve",
  "group_id": 20001, "operator_id": 10002, "user_id": 10001
}
```

`sub_type`：`"approve"`（管理者批准）/ `"invite"`（被邀請）/
其他來自事件之 `joinType`。判定：操作者与目標不同人 → `invite`，否則 `approve`。

### 3.2 群成員減少 — `group_decrease`

```json
{
  "post_type": "notice", "notice_type": "group_decrease",
  "sub_type": "kick",
  "group_id": 20001, "operator_id": 10002, "user_id": 10001
}
```

`sub_type` 取值：`"leave"`（主動退群）/ `"kick"`（被逐）/
`"kick_me"`（**機器人自己被逐**）/ `"disband"`（群解散）。

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
`duration` 単位為**秒**。

### 3.4 群管理者変動 — `group_admin`

```json
{
  "post_type": "notice", "notice_type": "group_admin",
  "sub_type": "set",
  "group_id": 20001, "user_id": 10001
}
```

`sub_type`：`"set"`（設為管理者）/ `"unset"`（取消）。

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

`operator_id` 為執行撤回者，`user_id` 為原消息作者。

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

| 字段 | 説明 |
| --- | --- |
| `action` | 動作文案，如 `戳了戳` |
| `suffix` | 後綴文案 |
| `action_img_url` | 動作図片 URL |

### 3.8 群精華消息 — `essence`

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

### 3.9 群文件上傳 — `group_upload`

```json
{
  "post_type": "notice", "notice_type": "group_upload",
  "group_id": 20001, "user_id": 10001,
  "file": { "id": "<file-id>", "name": "a.zip", "size": 1024, "busid": 102 }
}
```

### 3.10 好友添加 — `friend_add`

```json
{ "post_type": "notice", "notice_type": "friend_add", "user_id": 10001 }
```

### 3.11 群名片変更 — `group_card`

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

> 此為**非標準**通知類型，用於告知接続断絶。

### 3.13 群消息表態 — `group_msg_emoji_like`

```json
{
  "post_type": "notice", "notice_type": "group_msg_emoji_like",
  "sub_type": "add",
  "group_id": 20001, "user_id": 10002, "operator_id": 10002,
  "message_id": -123456, "message_seq": 4567,
  "likes": [ { "emoji_id": "128077", "count": 1 } ]
}
```

`sub_type`：`"add"`（添加）/ `"remove"`（取消）。

### 3.14 `notify` 之其余 `sub_type`

源碼 `to-notice.ts` 中出現之 `notify` 子類型共 **5 種**（`poke` 出現両次，
分為好友与群両個変換器）：

| `sub_type` | 附加字段 | 説明 |
| --- | --- | --- |
| `poke` | `user_id`, `target_id`, `action`, `suffix`, `action_img_url`（好友形態另含 `sender_id`） | 戳一戳 |
| `profile_like` | `operator_id`, `operator_nick`, `times` | 名片点賛 |
| `title` | `group_id`, `user_id`, `title` | 群専属頭銜変更 |
| `group_name` | `group_id`, `user_id`, `name_new` | 群名変更 |
| `input_status` | `user_id`, `event_type`, `status_text` | 好友輸入状態 |

### 3.15 機器人自身状態 — `bot_status`

```json
{
  "time": 1700000000, "self_id": <uin>,
  "post_type": "notice", "notice_type": "bot_status",
  "sub_type": "online", "user_id": <uin>
}
```

`sub_type`：`"online"`（登録成功）/ `"offline"`（離線）。
> 同為**非標準**拡張類型（源碼 `makeBotStatusEvent`）。

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

| 字段 | 説明 |
| --- | --- |
| `sub_type` | `"invite"`（邀請）/ `"add"`（申請加群），既定 `"invite"` |
| `invited_id` | **僅当被邀請者 UIN > 0 時出現** |
| `comment` | 検証消息 |
| `flag` | 用於 `set_friend_add_request` / `set_group_add_request` 回傳 |

---

## 5. 元事件（`meta_event`）

源碼 `instance.ts`。

### 5.1 生命周期 — `meta_event_type: "lifecycle"`

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

| `sub_type` | 触發時機 |
| --- | --- |
| `"connect"` | 網絡適配器建立接続時推送 |
| `"enable"` | 適配器啓用時推送 |
| `"disable"` | 適配器関閉（`closeConnections`）時推送 |

`status.online`：帳号在線；`status.good`：`online && bridge.receiveHealthy`。

### 5.2 心搏 — `meta_event_type: "heartbeat"`

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

- **間隔 30000 ms（30 秒）**，源碼 `OneBotInstance.HEARTBEAT_INTERVAL = 3e4`。
- `interval` 字段回顕該間隔，便於客户端自検。
- 定時器呼 `unref()`，不会阻止工程退出。

### 5.3 接続建立時之 bootstrap

**事件類客户端（`Event` / `Universal`）於（再）接続後立即収到 3 幀**
（源碼 `adapter.ts` 之 `bootstrapMetaFrames`），順序固定：

```
1. meta_event / lifecycle / sub_type: "connect"
2. meta_event / lifecycle / sub_type: "enable"
3. meta_event / heartbeat
```

- 伺服器**関閉時**向非 `Api` 接続推送 `lifecycle` / `sub_type: "disable"`。
- SSE 接続同様先補發 bootstrap，再補發歴史幀。
- 客户端**必須能容忍接続後立即収到 meta 事件**，勿将
  `lifecycle(connect)` 誤判為業務事件。

> ⚠️ **無 `meta_event_type: "connect"` 写法**：接続類事件走
> `lifecycle` + `sub_type`，此為本実装之形態。

---

## 6. 消息段（segment）格式

### 6.1 基本結構

```json
{ "type": "text", "data": { "text": "你好" } }
```

`message` 字段（`messageFormat: "array"`）為**消息段数組**；
`messageFormat: "string"` 時替換為 CQ 碼字符串 `raw_message`。

### 6.2 接收方向：16 種段類型

源碼 `ELEMENT_CODECS`（`element-codecs.ts`），共 **16** 種：

| `type` | `data` 字段 | 説明 |
| --- | --- | --- |
| `text` | `text` | 純文本 |
| `face` | `id`, `resultId?`, `large?` | QQ 表情 |
| `at` | `qq`（`"all"` 表示全体） | @某人 |
| `reply` | `id` | 引用回復 |
| `image` | `url`, `file`, `sub_type`, `summary`, `type?`, `emoji_id?`, `emoji_package_id?`, `key?` | 図片 / 表情包 |
| `record` | `file`, `url` | 語音 |
| `video` | `file`, `url` | 視頻 |
| `json` | `data` | JSON 卡片 |
| `xml` | `data`, `resid`（既定 `35`） | XML 卡片 |
| `file` | `file`, `file_id`, `file_size`, `name`, `size`, `id`, `url`, `file_hash` | 文件 |
| `mface` | （変換為 `image`） | 市場表情 |
| `poke` | `type` | 戳一戳 |
| `flash_file` | `title`, `file_set_id`, `scene_type`, `thumb` | 閃傳文件 |
| `forward` | `id` | 合併轉發 |
| `markdown` | `content` | Markdown 消息 |
| `inline_keyboard` | `bot_appid`, `rows[].buttons[]` | 内聯鍵盤 |

**要点**：

- `mface` 於接收方向**被合併入 `image`**，`data` 中帯
  `emoji_id` / `emoji_package_id` / `key`，`url` 指向
  `https://gxh.vip.qq.com/club/item/parcel/item/<前2位>/<emoji_id>/raw300.gif`。
- `reply` 之 `id` 為**字符串**；解析不到目標消息時該段**被省略**
  （日誌提示 `quote target unresolved ...; omitting reply id`）。
- `at` 之 `qq` 為 `"all"` 表示 @全体成員。
- `image` 之 `data.type` 為 `"flash"` 表示閃照。

### 6.3 送信方向：额外 9 種兼容段

源碼 `message-parser.ts` 之 `segmentToElement` 额外接受：

| `type` | 必填字段 | 変換結果 |
| --- | --- | --- |
| `share` | `url`, `title`（`content`, `image` 可選） | → `json` 卡片（`com.tencent.structmsg` / `news`） |
| `music` | `type` + `id`，或 `custom` 類型 + `url`/`audio`/`title` | → `json` 卡片（需外鏈簽名服務） |
| `location` | 見源碼 | 位置卡片 |
| `contact` | 見源碼 | 好友/群推薦卡片 |
| `rps` | — | 猜拳 |
| `dice` | — | 骰子 |
| `shake` | — | 窗口抖动 |
| `anonymous` | — | 匿名消息標記 |
| `node` | — | **僅允許於合併轉發節点列表内** |

> `node` 出現於頂層会抛 `UNSENDABLE_TYPE`：
> `message segment "node" is only valid inside a forward node list`。
>
> `music` 之簽名服務既定 `https://ss.xingzhige.com/music_card/card`，
> 需外網可達；失敗時該段被跳過。

### 6.4 空文本占位符

段数組中 `text` 字段**恰為 `""`** 之 text 段被視為**兼容占位符**，
不計入「可送信段」：

```js
function isExplicitEmptyTextPlaceholder(segment) { /* text === "" 精确匹配 */ }
```

区別：

| 写法 | 行為 |
| --- | --- |
| `{ "type":"text", "data":{ "text":"" } }` | 兼容占位符，**忽略** |
| `{ "type":"text", "data":{} }` | 正常校験 → 報錯 |
| `{ "type":"text", "data":{ "text":null } }` | 正常校験 → 報錯 |
| `{ "type":"text", "data":{ "text":"  " } }` | 正常校験（僅空白亦算内容） |

### 6.5 CQ 碼

字符串形式使用 CQ 碼，正則（`message-parser.ts`）：

```js
var CQ_REGEX = /\[CQ:([A-Za-z][A-Za-z0-9_]*)(?:,([^\]]*))?\]/g;
```

示例：`[CQ:face,id=1]`、`[CQ:at,qq=10001]`。
`auto_escape: true` 時字符串中之 CQ 碼**不被解析**，按純文本送信。

---

## 7. 消息 ID 説明

- `message_id` **可為負値**，此為正常現象，勿将負数当異常。
- 私聊 `message_id` 優先使用 `ntMsgSeq`；群聊使用 `msgSeq`
  （源碼 `applyMessageIdResolver`）。
- 解析不到時退回為原始序号 `seq`；`seq === 0` 時返 `0`。
- 対事件回傳 `message_id`（如 `get_msg`、`delete_msg`）時，
  消息須於**現在帳号之消息保存庫**中可査詢，否則報
  `message not found`。

---

## 8. 客户端実装建議

| 場景 | 建議 |
| --- | --- |
| 接続後立即収到 meta 事件 | 正常，先忽略 `lifecycle(connect/enable)` 再処理業務 |
| 自己發之消息収不到 | 需則開啓 `reportSelfMessage: true` |
| `message` 為字符串非数組 | 適配器 `messageFormat: "string"`；改設定或按 CQ 碼解析 |
| 心搏判活 | 以 `interval`（30000ms）為準，容忍 2~3 次遺失 |
| 事件去重 | 断線重連会**重發 bootstrap**，且 SSE 支持 `Last-Event-ID` 補發，需按 `message_id` 去重 |
| 僅需動作不需事件 | 接続 `role` 用 `Api` |
| 僅需事件不需動作 | 接続 `role` 用 `Event` |

---

## 9. 与標準 OneBot v11 之差異

| 項目 | 差異 |
| --- | --- |
| `sender.sex` / `sender.age` | 恒為 `"unknown"` / `0`，非真実資料 |
| `bot_offline` | 非標準 `notice_type` |
| `bot_status` | 非標準 `notice_type`（`sub_type`: `online`/`offline`） |
| `message_sent` | 需 `reportSelfMessage` 才推送 |
| 三種内部事件 | `ptt_trans_result` / `online_devices_changed` / `friend_remark_changed` **明示不変換** |
| `get_supported_actions` | ❌ 未実装（見 `actions.md`） |
| 额外字段 | `message_seq`（消息与部分通知事件）、`group_name`（群消息）、`target_id`（自回顕私聊）等拡張字段 |

---

## 10. 声明

| 項目 | 状態 |
| --- | --- |
| 信封三個構築器 | **已核実**：`envelope.ts` |
| 13 種 `notice_type` 与全部字段 | **已核実**：`to-notice.ts` 字面量 |
| 6 種 `notify` 子類型 | **已核実**：`to-notice.ts` |
| 2 種 `request_type` | **已核実**：`to-request.ts` |
| meta 事件之 `sub_type` 与 bootstrap 順序 | **已核実**：`instance.ts` + `adapter.ts` |
| 心搏 30000ms | **已核実**：`HEARTBEAT_INTERVAL = 3e4` |
| 16 種接收段類型 | **已核実**：`ELEMENT_CODECS` |
| 9 種送信兼容段 | **已核実**：`segmentToElement` |
| 空文本占位符規則 | **已核実**：`isExplicitEmptyTextPlaceholder` |
| 各事件之実機 JSON | **未実測**：字段來自源碼，未経真機抓包験証 |

> 本文**未**於真機抓取事件流。所有字段名与取值均來自源碼字面量抽出，
> 結構可信；但**字段出現与否之条件**（如 `invited_id`、`target_id`）
> 建議於実際接入時以真実事件為準也。
