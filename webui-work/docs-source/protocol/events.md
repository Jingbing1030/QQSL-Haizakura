# OneBot v11 事件参考（events）

> [!WARNING]
> 本内容完全由 AI 编写，请谨慎查看。

> 本文描述 Haizakura（原 SnowLuma）向客户端推送的 **OneBot v11 事件格式**：
> 信封结构、四类事件（meta / message / notice / request）的完整字段，
> 以及消息段（segment）的收发格式。
>
> **数据来源**：`packages/onebot/src/event-converter/*.ts`（各类事件转换器）、
> `packages/onebot/src/event-filter.ts`（格式分支）、
> `packages/onebot/src/instance.ts`（meta 事件的构造与心跳）。
>
> 字段名与取值全部由源码 `data` 字面量提取。

---

## 1. 事件信封

所有事件都是 JSON 对象，**公共字段**（源码 `event-converter/envelope.ts`）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `time` | integer | 事件发生时间（**Unix 秒**） |
| `self_id` | integer | 收到该事件的机器人 QQ 号 |
| `post_type` | string | 事件大类：`message` / `message_sent` / `notice` / `request` / `meta_event` |

三个构造器分别产出：

```js
// notice
{ time, self_id, post_type: "notice", ...fields }
// request
{ time, self_id, post_type: "request", ...fields }
// message / message_sent（由调用方决定 postType）
{ time, self_id, post_type, ...fields }
```

### 1.1 `post_type` 一览

| `post_type` | 含义 | 触发 |
| --- | --- | --- |
| `message` | 收到他人消息 | 私聊 / 群聊 / 临时会话 |
| `message_sent` | **自己**发出的消息（自回显） | 需 `reportSelfMessage: true` |
| `notice` | 通知类事件 | 13 种 `notice_type` |
| `request` | 请求类事件 | 加好友 / 加群 |
| `meta_event` | 元事件 | 生命周期 + 心跳 |

> ⚠️ `message_sent` 在适配器 `reportSelfMessage: false`（默认）时
> **整个事件被丢弃**，不会推送（源码 `shapeEventForAdapter`）。

### 1.2 事件类型 → 转换器映射

源码 `event-converter/index.ts` 的 `CONVERTERS` 表（**权威清单**）：

| 内部 `kind` | 产出事件 | 转换器 |
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
| `ptt_trans_result` | — | **`null`：显式不转换** |
| `online_devices_changed` | — | **`null`：显式不转换** |
| `friend_remark_changed` | — | **`null`：显式不转换** |

> 表中映射为 `null` 的三种内部事件**不会产生 OneBot 事件**
> （源码显式声明，非遗漏）。

---

## 2. 消息事件（`message` / `message_sent`）

### 2.1 群消息（`message_type: "group"`）

源码 `convertGroupMessage`：

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

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `message_type` | string | 恒为 `"group"` |
| `sub_type` | string | 恒为 `"normal"` |
| `message_id` | integer | **可为负值** |
| `message_seq` | integer | 原始消息序号 |
| `group_id` | integer | 群号 |
| `group_name` | string | 群名 |
| `user_id` | integer | 发送者 QQ 号 |
| `message` | array \| string | 消息段数组（或 CQ 码串，见 §6） |
| `raw_message` | string | CQ 码形式的原始消息 |
| `font` | integer | 恒为 `0` |
| `sender.role` | string | `owner` / `admin` / `member`，缺省为 `"member"` |
| `sender.card` | string | 群名片 |
| `sender.sex` | string | 恒为 `"unknown"`（本实现不提供） |
| `sender.age` | integer | 恒为 `0`（本实现不提供） |
| `anonymous` | null | 恒为 `null` |

> ⚠️ **`sender.sex` 与 `sender.age` 恒为占位值**（`"unknown"` / `0`），
> 不是真实资料。需要真实资料请调用 `get_stranger_info` / `get_group_member_info`。

### 2.2 私聊消息（`message_type: "private"`）

源码 `convertPrivateMessage`，`sub_type` 有两种：

| 场景 | `sub_type` | 来源 |
| --- | --- | --- |
| 好友私聊 | `"friend"` | `convertFriendMessage` |
| 临时会话（群临时） | `"group"` | `convertTempMessage` |

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

- 临时会话（`sub_type: "group"`）额外带 `sender.group_id`（来源群）。
- 私聊事件的 `sender` **没有** `card` / `role` 字段。
- **自己发出的私聊**（`message_sent`）且会话对象不是自己时，额外带
  `target_id`（接收方 QQ 号）。
- `message_id` 优先取 `ntMsgSeq`，缺失时回退 `msgSeq`（源码
  `hasCanonicalNtSequence`）。

---

## 3. 通知事件（`notice`）

共 **13 种 `notice_type`**（源码 `to-notice.ts`）。

### 3.1 群成员增加 — `group_increase`

```json
{
  "time": 1700000000, "self_id": <uin>,
  "post_type": "notice", "notice_type": "group_increase",
  "sub_type": "approve",
  "group_id": 20001, "operator_id": 10002, "user_id": 10001
}
```

`sub_type`：`"approve"`（管理员批准）/ `"invite"`（被邀请）/
其他来自事件的 `joinType`。判定：操作者与目标不同人 → `invite`，否则 `approve`。

### 3.2 群成员减少 — `group_decrease`

```json
{
  "post_type": "notice", "notice_type": "group_decrease",
  "sub_type": "kick",
  "group_id": 20001, "operator_id": 10002, "user_id": 10001
}
```

`sub_type` 取值：`"leave"`（主动退群）/ `"kick"`（被踢）/
`"kick_me"`（**机器人自己被踢**）/ `"disband"`（群解散）。

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
`duration` 单位为**秒**。

### 3.4 群管理员变动 — `group_admin`

```json
{
  "post_type": "notice", "notice_type": "group_admin",
  "sub_type": "set",
  "group_id": 20001, "user_id": 10001
}
```

`sub_type`：`"set"`（设为管理员）/ `"unset"`（取消）。

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

`operator_id` 为执行撤回者，`user_id` 为原消息作者。

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

| 字段 | 说明 |
| --- | --- |
| `action` | 动作文案，如 `戳了戳` |
| `suffix` | 后缀文案 |
| `action_img_url` | 动作图片 URL |

### 3.8 群精华消息 — `essence`

```json
{
  "post_type": "notice", "notice_type": "essence",
  "sub_type": "add",
  "group_id": 20001, "user_id": 10001, "sender_id": 10001,
  "operator_id": 10002, "message_id": -123456,
  "message_seq": 4567, "random": 123456789
}
```

`sub_type`：`"add"`（设为精华）/ `"delete"`（移出精华）。

### 3.9 群文件上传 — `group_upload`

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

### 3.11 群名片变更 — `group_card`

```json
{
  "post_type": "notice", "notice_type": "group_card",
  "group_id": 20001, "user_id": 10001,
  "card_new": "新名片", "card_old": "旧名片"
}
```

### 3.12 机器人离线 — `bot_offline`

```json
{
  "post_type": "notice", "notice_type": "bot_offline",
  "user_id": <uin>, "tag": "<tag>", "message": "<原因>"
}
```

> 这是**非标准**通知类型，用于告知连接断开。

### 3.13 群消息表态 — `group_msg_emoji_like`

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

### 3.14 `notify` 的其余 `sub_type`

源码 `to-notice.ts` 中出现的 `notify` 子类型共 **5 种**（`poke` 出现两次，
分为好友与群两个转换器）：

| `sub_type` | 附加字段 | 说明 |
| --- | --- | --- |
| `poke` | `user_id`, `target_id`, `action`, `suffix`, `action_img_url`（好友形态另含 `sender_id`） | 戳一戳 |
| `profile_like` | `operator_id`, `operator_nick`, `times` | 名片点赞 |
| `title` | `group_id`, `user_id`, `title` | 群专属头衔变更 |
| `group_name` | `group_id`, `user_id`, `name_new` | 群名变更 |
| `input_status` | `user_id`, `event_type`, `status_text` | 好友输入状态 |

### 3.15 机器人自身状态 — `bot_status`

```json
{
  "time": 1700000000, "self_id": <uin>,
  "post_type": "notice", "notice_type": "bot_status",
  "sub_type": "online", "user_id": <uin>
}
```

`sub_type`：`"online"`（登录成功）/ `"offline"`（下线）。
> 同样为**非标准**扩展类型（源码 `makeBotStatusEvent`）。

---

## 4. 请求事件（`request`）

### 4.1 加好友请求 — `request_type: "friend"`

```json
{
  "time": 1700000000, "self_id": <uin>,
  "post_type": "request", "request_type": "friend",
  "user_id": 10001,
  "comment": "我是...",
  "flag": "<flag>"
}
```

### 4.2 加群请求 / 邀请 — `request_type: "group"`

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

| 字段 | 说明 |
| --- | --- |
| `sub_type` | `"invite"`（邀请）/ `"add"`（申请加群），缺省 `"invite"` |
| `invited_id` | **仅当被邀请者 UIN > 0 时出现** |
| `comment` | 验证消息 |
| `flag` | 用于 `set_friend_add_request` / `set_group_add_request` 回传 |

---

## 5. 元事件（`meta_event`）

源码 `instance.ts`。

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

| `sub_type` | 触发时机 |
| --- | --- |
| `"connect"` | 网络适配器建立连接时推送 |
| `"enable"` | 适配器启用时推送 |
| `"disable"` | 适配器关闭（`closeConnections`）时推送 |

`status.online`：账号在线；`status.good`：`online && bridge.receiveHealthy`。

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

- **间隔 30000 ms（30 秒）**，源码 `OneBotInstance.HEARTBEAT_INTERVAL = 3e4`。
- `interval` 字段回显该间隔，便于客户端自检。
- 定时器调用 `unref()`，不会阻止进程退出。

### 5.3 连接建立时的 bootstrap

**事件类客户端（`Event` / `Universal`）在（重）连接后立刻收到 3 帧**
（源码 `adapter.ts` 的 `bootstrapMetaFrames`），顺序固定：

```
1. meta_event / lifecycle / sub_type: "connect"
2. meta_event / lifecycle / sub_type: "enable"
3. meta_event / heartbeat
```

- 服务器**关闭时**向非 `Api` 连接推送 `lifecycle` / `sub_type: "disable"`。
- SSE 连接同样先补发 bootstrap，再补发历史帧。
- 客户端**必须能容忍连接后立即收到 meta 事件**，不要把
  `lifecycle(connect)` 误判为业务事件。

> ⚠️ **无 `meta_event_type: "connect"` 写法**：连接类事件走的是
> `lifecycle` + `sub_type`，这是本实现的形态。

---

## 6. 消息段（segment）格式

### 6.1 基本结构

```json
{ "type": "text", "data": { "text": "你好" } }
```

`message` 字段（`messageFormat: "array"`）为**消息段数组**；
`messageFormat: "string"` 时替换为 CQ 码字符串 `raw_message`。

### 6.2 接收方向：16 种段类型

源码 `ELEMENT_CODECS`（`element-codecs.ts`），共 **16** 种：

| `type` | `data` 字段 | 说明 |
| --- | --- | --- |
| `text` | `text` | 纯文本 |
| `face` | `id`, `resultId?`, `large?` | QQ 表情 |
| `at` | `qq`（`"all"` 表示全体） | @某人 |
| `reply` | `id` | 引用回复 |
| `image` | `url`, `file`, `sub_type`, `summary`, `type?`, `emoji_id?`, `emoji_package_id?`, `key?` | 图片 / 表情包 |
| `record` | `file`, `url` | 语音 |
| `video` | `file`, `url` | 视频 |
| `json` | `data` | JSON 卡片 |
| `xml` | `data`, `resid`（默认 `35`） | XML 卡片 |
| `file` | `file`, `file_id`, `file_size`, `name`, `size`, `id`, `url`, `file_hash` | 文件 |
| `mface` | （转换为 `image`） | 市场表情 |
| `poke` | `type` | 戳一戳 |
| `flash_file` | `title`, `file_set_id`, `scene_type`, `thumb` | 闪传文件 |
| `forward` | `id` | 合并转发 |
| `markdown` | `content` | Markdown 消息 |
| `inline_keyboard` | `bot_appid`, `rows[].buttons[]` | 内联键盘 |

**要点**：

- `mface` 在接收方向**被合并进 `image`**，`data` 里带
  `emoji_id` / `emoji_package_id` / `key`，`url` 指向
  `https://gxh.vip.qq.com/club/item/parcel/item/<前2位>/<emoji_id>/raw300.gif`。
- `reply` 的 `id` 是**字符串**；解析不到目标消息时该段**被省略**
  （日志提示 `quote target unresolved ...; omitting reply id`）。
- `at` 的 `qq` 为 `"all"` 表示 @全体成员。
- `image` 的 `data.type` 为 `"flash"` 表示闪照。

### 6.3 发送方向：额外 9 种兼容段

源码 `message-parser.ts` 的 `segmentToElement` 额外接受：

| `type` | 必填字段 | 转换结果 |
| --- | --- | --- |
| `share` | `url`, `title`（`content`, `image` 可选） | → `json` 卡片（`com.tencent.structmsg` / `news`） |
| `music` | `type` + `id`，或 `custom` 类型 + `url`/`audio`/`title` | → `json` 卡片（需外链签名服务） |
| `location` | 见源码 | 位置卡片 |
| `contact` | 见源码 | 好友/群推荐卡片 |
| `rps` | — | 猜拳 |
| `dice` | — | 骰子 |
| `shake` | — | 窗口抖动 |
| `anonymous` | — | 匿名消息标记 |
| `node` | — | **仅允许在合并转发节点列表内** |

> `node` 出现在顶层会抛 `UNSENDABLE_TYPE`：
> `message segment "node" is only valid inside a forward node list`。
>
> `music` 的签名服务默认 `https://ss.xingzhige.com/music_card/card`，
> 需外网可达；失败时该段被跳过。

### 6.4 空文本占位符

段数组中 `text` 字段**恰为 `""`** 的 text 段被视为**兼容占位符**，
不计入「可发送段」：

```js
function isExplicitEmptyTextPlaceholder(segment) { /* text === "" 精确匹配 */ }
```

区别：

| 写法 | 行为 |
| --- | --- |
| `{ "type":"text", "data":{ "text":"" } }` | 兼容占位符，**忽略** |
| `{ "type":"text", "data":{} }` | 正常校验 → 报错 |
| `{ "type":"text", "data":{ "text":null } }` | 正常校验 → 报错 |
| `{ "type":"text", "data":{ "text":"  " } }` | 正常校验（仅空白也算内容） |

### 6.5 CQ 码

字符串形式使用 CQ 码，正则（`message-parser.ts`）：

```js
var CQ_REGEX = /\[CQ:([A-Za-z][A-Za-z0-9_]*)(?:,([^\]]*))?\]/g;
```

示例：`[CQ:face,id=1]`、`[CQ:at,qq=10001]`。
`auto_escape: true` 时字符串中的 CQ 码**不被解析**，按纯文本发送。

---

## 7. 消息 ID 说明

- `message_id` **可为负值**，这是正常现象，不要把负数当异常。
- 私聊 `message_id` 优先使用 `ntMsgSeq`；群聊使用 `msgSeq`
  （源码 `applyMessageIdResolver`）。
- 解析不到时回退为原始序号 `seq`；`seq === 0` 时返回 `0`。
- 对事件回传 `message_id`（如 `get_msg`、`delete_msg`）时，
  消息须在**当前账号的消息存储**中可查询，否则报
  `message not found`。

---

## 8. 客户端实现建议

| 场景 | 建议 |
| --- | --- |
| 连接后立即收到 meta 事件 | 正常，先忽略 `lifecycle(connect/enable)` 再处理业务 |
| 自己发的消息收不到 | 需要则开启 `reportSelfMessage: true` |
| `message` 是字符串不是数组 | 适配器 `messageFormat: "string"`；改配置或按 CQ 码解析 |
| 心跳判活 | 以 `interval`（30000ms）为准，容忍 2~3 次丢失 |
| 事件去重 | 断线重连会**重发 bootstrap**，且 SSE 支持 `Last-Event-ID` 补发，需按 `message_id` 去重 |
| 仅需动作不需事件 | 连接 `role` 用 `Api` |
| 仅需事件不需动作 | 连接 `role` 用 `Event` |

---

## 9. 与标准 OneBot v11 的差异

| 项目 | 差异 |
| --- | --- |
| `sender.sex` / `sender.age` | 恒为 `"unknown"` / `0`，非真实资料 |
| `bot_offline` | 非标准 `notice_type` |
| `bot_status` | 非标准 `notice_type`（`sub_type`: `online`/`offline`） |
| `message_sent` | 需 `reportSelfMessage` 才推送 |
| 三种内部事件 | `ptt_trans_result` / `online_devices_changed` / `friend_remark_changed` **显式不转换** |
| `get_supported_actions` | ❌ 未实现（见 `actions.md`） |
| 额外字段 | `message_seq`（消息与部分通知事件）、`group_name`（群消息）、`target_id`（自回显私聊）等扩展字段 |

---

## 10. 声明

| 项目 | 状态 |
| --- | --- |
| 信封三个构造器 | **已核实**：`envelope.ts` |
| 13 种 `notice_type` 与全部字段 | **已核实**：`to-notice.ts` 字面量 |
| 6 种 `notify` 子类型 | **已核实**：`to-notice.ts` |
| 2 种 `request_type` | **已核实**：`to-request.ts` |
| meta 事件的 `sub_type` 与 bootstrap 顺序 | **已核实**：`instance.ts` + `adapter.ts` |
| 心跳 30000ms | **已核实**：`HEARTBEAT_INTERVAL = 3e4` |
| 16 种接收段类型 | **已核实**：`ELEMENT_CODECS` |
| 9 种发送兼容段 | **已核实**：`segmentToElement` |
| 空文本占位符规则 | **已核实**：`isExplicitEmptyTextPlaceholder` |
| 各事件的实机 JSON | **未实测**：字段来自源码，未经真机抓包验证 |

> 本文**未**在真机抓取过事件流。所有字段名与取值均来自源码字面量提取，
> 结构可信；但**字段出现与否的条件**（如 `invited_id`、`target_id`）
> 建议在实际接入时以真实事件为准。
