# OneBot v11 event reference (events)

> [!WARNING]
> This content was written entirely by AI; review it with care.

> This document describes the **OneBot v11 event format** Haizakura (formerly SnowLuma) pushes to clients:
> the envelope structure, the complete fields of the four event categories (meta / message / notice / request),
> and the send/receive format of message segments.
>
> **Data sources**: `packages/onebot/src/event-converter/*.ts` (the per-category event converters),
> `packages/onebot/src/event-filter.ts` (format branching) and
> `packages/onebot/src/instance.ts` (meta event construction and heartbeat).
>
> All field names and values were extracted from `data` literals in the source.

---

## 1. Event envelope

Every event is a JSON object, with these **common fields** (source `event-converter/envelope.ts`):

| Field | Type | Description |
| --- | --- | --- |
| `time` | integer | When the event occurred (**Unix seconds**) |
| `self_id` | integer | The QQ number of the bot that received this event |
| `post_type` | string | Event category: `message` / `message_sent` / `notice` / `request` / `meta_event` |

The three constructors produce:

```js
// notice
{ time, self_id, post_type: "notice", ...fields }
// request
{ time, self_id, post_type: "request", ...fields }
// message / message_sent（由调用方决定 postType）
{ time, self_id, post_type, ...fields }
```

### 1.1 `post_type` at a glance

| `post_type` | Meaning | Trigger |
| --- | --- | --- |
| `message` | A message from someone else | Private / group / temporary session |
| `message_sent` | A message **you** sent (self echo) | Requires `reportSelfMessage: true` |
| `notice` | Notice-category events | 13 `notice_type` values |
| `request` | Request-category events | Friend request / group request |
| `meta_event` | Meta events | Lifecycle + heartbeat |

> ⚠️ With the adapter's `reportSelfMessage: false` (the default),
> `message_sent` events are **dropped entirely** and never pushed (source `shapeEventForAdapter`).

### 1.2 Event kind → converter mapping

The `CONVERTERS` table in `event-converter/index.ts` (**the authoritative list**):

| Internal `kind` | Produced event | Converter |
| --- | --- | --- |
| `friend_message` | `message` / `message_sent` (private/friend) | `convertFriendMessage` |
| `group_message` | `message` / `message_sent` (group/normal) | `convertGroupMessage` |
| `temp_message` | `message` (private/group) | `convertTempMessage` |
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
| `ptt_trans_result` | — | **`null`: explicitly not converted** |
| `online_devices_changed` | — | **`null`: explicitly not converted** |
| `friend_remark_changed` | — | **`null`: explicitly not converted** |

> The three internal events mapped to `null` **produce no OneBot event**
> (declared explicitly in the source, not an oversight).

---

## 2. Message events (`message` / `message_sent`)

### 2.1 Group messages (`message_type: "group"`)

Source `convertGroupMessage`:

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

| Field | Type | Description |
| --- | --- | --- |
| `message_type` | string | Always `"group"` |
| `sub_type` | string | Always `"normal"` |
| `message_id` | integer | **May be negative** |
| `message_seq` | integer | Original message sequence number |
| `group_id` | integer | Group number |
| `group_name` | string | Group name |
| `user_id` | integer | Sender's QQ number |
| `message` | array \| string | Message segment array (or a CQ code string; see §6) |
| `raw_message` | string | The raw message in CQ code form |
| `font` | integer | Always `0` |
| `sender.role` | string | `owner` / `admin` / `member`, defaulting to `"member"` |
| `sender.card` | string | Group card |
| `sender.sex` | string | Always `"unknown"` (not provided by this implementation) |
| `sender.age` | integer | Always `0` (not provided by this implementation) |
| `anonymous` | null | Always `null` |

> ⚠️ **`sender.sex` and `sender.age` are always placeholders** (`"unknown"` / `0`),
> not real data. For real data call `get_stranger_info` / `get_group_member_info`.

### 2.2 Private messages (`message_type: "private"`)

Source `convertPrivateMessage`; `sub_type` has two values:

| Scenario | `sub_type` | Source |
| --- | --- | --- |
| Friend chat | `"friend"` | `convertFriendMessage` |
| Temporary session (group temporary) | `"group"` | `convertTempMessage` |

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

- A temporary session (`sub_type: "group"`) additionally carries `sender.group_id` (the originating group).
- The `sender` of a private event has **no** `card` / `role` fields.
- A **private message you sent** (`message_sent`) whose counterpart is not yourself additionally carries
  `target_id` (the recipient's QQ number).
- `message_id` prefers `ntMsgSeq` and falls back to `msgSeq` when missing (source
  `hasCanonicalNtSequence`).

---

## 3. Notice events (`notice`)

There are **13 `notice_type` values** (source `to-notice.ts`).

### 3.1 Group member increase — `group_increase`

```json
{
  "time": 1700000000, "self_id": <uin>,
  "post_type": "notice", "notice_type": "group_increase",
  "sub_type": "approve",
  "group_id": 20001, "operator_id": 10002, "user_id": 10001
}
```

`sub_type`: `"approve"` (approved by an administrator) / `"invite"` (was invited) /
other values taken from the event's `joinType`. Decision rule: if the operator and the target are different people → `invite`, otherwise `approve`.

### 3.2 Group member decrease — `group_decrease`

```json
{
  "post_type": "notice", "notice_type": "group_decrease",
  "sub_type": "kick",
  "group_id": 20001, "operator_id": 10002, "user_id": 10001
}
```

`sub_type` values: `"leave"` (left voluntarily) / `"kick"` (was kicked) /
`"kick_me"` (**the bot itself was kicked**) / `"disband"` (group dissolved).

### 3.3 Group mute — `group_ban`

```json
{
  "post_type": "notice", "notice_type": "group_ban",
  "sub_type": "ban",
  "group_id": 20001, "operator_id": 10002, "user_id": 10001,
  "duration": 600
}
```

`sub_type`: `duration > 0` → `"ban"`; `duration == 0` → `"lift_ban"`.
`duration` is in **seconds**.

### 3.4 Group administrator change — `group_admin`

```json
{
  "post_type": "notice", "notice_type": "group_admin",
  "sub_type": "set",
  "group_id": 20001, "user_id": 10001
}
```

`sub_type`: `"set"` (made administrator) / `"unset"` (revoked).

### 3.5 Friend recall — `friend_recall`

```json
{
  "post_type": "notice", "notice_type": "friend_recall",
  "user_id": 10001, "message_id": -123456
}
```

### 3.6 Group recall — `group_recall`

```json
{
  "post_type": "notice", "notice_type": "group_recall",
  "group_id": 20001, "operator_id": 10002,
  "user_id": 10001, "message_id": -123456
}
```

`operator_id` is whoever performed the recall, and `user_id` is the original message's author.

### 3.7 Poke — `notify` / `poke`

**Friend poke**:

```json
{
  "post_type": "notice", "notice_type": "notify", "sub_type": "poke",
  "user_id": 10001, "sender_id": 10001, "target_id": <uin>,
  "action": "戳了戳", "suffix": "的脸", "action_img_url": "https://..."
}
```

**Group poke**: the same, but with `group_id` + `user_id` (and no `sender_id`).

| Field | Description |
| --- | --- |
| `action` | Action text, such as `戳了戳` |
| `suffix` | Suffix text |
| `action_img_url` | Action image URL |

### 3.8 Group essence message — `essence`

```json
{
  "post_type": "notice", "notice_type": "essence",
  "sub_type": "add",
  "group_id": 20001, "user_id": 10001, "sender_id": 10001,
  "operator_id": 10002, "message_id": -123456,
  "message_seq": 4567, "random": 123456789
}
```

`sub_type`: `"add"` (set as essence) / `"delete"` (removed from essence).

### 3.9 Group file upload — `group_upload`

```json
{
  "post_type": "notice", "notice_type": "group_upload",
  "group_id": 20001, "user_id": 10001,
  "file": { "id": "<file-id>", "name": "a.zip", "size": 1024, "busid": 102 }
}
```

### 3.10 Friend added — `friend_add`

```json
{ "post_type": "notice", "notice_type": "friend_add", "user_id": 10001 }
```

### 3.11 Group card change — `group_card`

```json
{
  "post_type": "notice", "notice_type": "group_card",
  "group_id": 20001, "user_id": 10001,
  "card_new": "新名片", "card_old": "旧名片"
}
```

### 3.12 Bot offline — `bot_offline`

```json
{
  "post_type": "notice", "notice_type": "bot_offline",
  "user_id": <uin>, "tag": "<tag>", "message": "<原因>"
}
```

> This is a **non-standard** notice type used to report a dropped connection.

### 3.13 Group message reaction — `group_msg_emoji_like`

```json
{
  "post_type": "notice", "notice_type": "group_msg_emoji_like",
  "sub_type": "add",
  "group_id": 20001, "user_id": 10002, "operator_id": 10002,
  "message_id": -123456, "message_seq": 4567,
  "likes": [ { "emoji_id": "128077", "count": 1 } ]
}
```

`sub_type`: `"add"` (added) / `"remove"` (removed).

### 3.14 The remaining `notify` `sub_type` values

`to-notice.ts` contains **5** `notify` subtypes (`poke` appears twice,
for the friend and group converters):

| `sub_type` | Additional fields | Description |
| --- | --- | --- |
| `poke` | `user_id`, `target_id`, `action`, `suffix`, `action_img_url` (the friend form also has `sender_id`) | Poke |
| `profile_like` | `operator_id`, `operator_nick`, `times` | Profile card like |
| `title` | `group_id`, `user_id`, `title` | Group-specific title change |
| `group_name` | `group_id`, `user_id`, `name_new` | Group name change |
| `input_status` | `user_id`, `event_type`, `status_text` | Friend typing status |

### 3.15 Bot's own status — `bot_status`

```json
{
  "time": 1700000000, "self_id": <uin>,
  "post_type": "notice", "notice_type": "bot_status",
  "sub_type": "online", "user_id": <uin>
}
```

`sub_type`: `"online"` (login succeeded) / `"offline"` (went offline).
> Also a **non-standard** extension type (source `makeBotStatusEvent`).

---

## 4. Request events (`request`)

### 4.1 Friend request — `request_type: "friend"`

```json
{
  "time": 1700000000, "self_id": <uin>,
  "post_type": "request", "request_type": "friend",
  "user_id": 10001,
  "comment": "我是...",
  "flag": "<flag>"
}
```

### 4.2 Group join request / invitation — `request_type: "group"`

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

| Field | Description |
| --- | --- |
| `sub_type` | `"invite"` (invitation) / `"add"` (application to join), defaulting to `"invite"` |
| `invited_id` | **Present only when the invitee's UIN > 0** |
| `comment` | Verification message |
| `flag` | Passed back to `set_friend_add_request` / `set_group_add_request` |

---

## 5. Meta events (`meta_event`)

Source `instance.ts`.

### 5.1 Lifecycle — `meta_event_type: "lifecycle"`

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

`sub_type` values:

| `sub_type` | When it is pushed |
| --- | --- |
| `"connect"` | When a network adapter establishes a connection |
| `"enable"` | When the adapter is enabled |
| `"disable"` | When the adapter closes (`closeConnections`) |

`status.online`: the account is online; `status.good`: `online && bridge.receiveHealthy`.

### 5.2 Heartbeat — `meta_event_type: "heartbeat"`

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

- **Interval 30000 ms (30 seconds)**; source `OneBotInstance.HEARTBEAT_INTERVAL = 3e4`.
- The `interval` field echoes that interval so clients can self-check.
- The timer calls `unref()`, so it does not keep the process alive.

### 5.3 Bootstrap on connection

**Event-category clients (`Event` / `Universal`) receive 3 frames immediately after (re)connecting**
(source `bootstrapMetaFrames` in `adapter.ts`), in a fixed order:

```
1. meta_event / lifecycle / sub_type: "connect"
2. meta_event / lifecycle / sub_type: "enable"
3. meta_event / heartbeat
```

- When the **server shuts down**, it pushes `lifecycle` / `sub_type: "disable"` to non-`Api` connections.
- SSE connections likewise receive the bootstrap first and then the replayed historical frames.
- Clients **must tolerate receiving meta events immediately after connecting**; do not
  mistake `lifecycle(connect)` for a business event.

> ⚠️ **There is no `meta_event_type: "connect"` form**: connection events use
> `lifecycle` + `sub_type`, which is the shape of this implementation.

---

## 6. Message segment format

### 6.1 Basic structure

```json
{ "type": "text", "data": { "text": "你好" } }
```

The `message` field (with `messageFormat: "array"`) is a **message segment array**;
with `messageFormat: "string"` it is replaced by the CQ code string `raw_message`.

### 6.2 Receive direction: 16 segment types

Source `ELEMENT_CODECS` (`element-codecs.ts`), **16** in total:

| `type` | `data` fields | Description |
| --- | --- | --- |
| `text` | `text` | Plain text |
| `face` | `id`, `resultId?`, `large?` | QQ emoji |
| `at` | `qq` (`"all"` means everyone) | Mention someone |
| `reply` | `id` | Quoted reply |
| `image` | `url`, `file`, `sub_type`, `summary`, `type?`, `emoji_id?`, `emoji_package_id?`, `key?` | Image / sticker |
| `record` | `file`, `url` | Voice |
| `video` | `file`, `url` | Video |
| `json` | `data` | JSON card |
| `xml` | `data`, `resid` (default `35`) | XML card |
| `file` | `file`, `file_id`, `file_size`, `name`, `size`, `id`, `url`, `file_hash` | File |
| `mface` | (converted to `image`) | Market emoji |
| `poke` | `type` | Poke |
| `flash_file` | `title`, `file_set_id`, `scene_type`, `thumb` | Flash-transfer file |
| `forward` | `id` | Merged forward |
| `markdown` | `content` | Markdown message |
| `inline_keyboard` | `bot_appid`, `rows[].buttons[]` | Inline keyboard |

**Key points**:

- On the receive side, `mface` **is merged into `image`**, with `data` carrying
  `emoji_id` / `emoji_package_id` / `key`, and `url` pointing to
  `https://gxh.vip.qq.com/club/item/parcel/item/<first 2 chars>/<emoji_id>/raw300.gif`.
- `reply`'s `id` is a **string**; when the target message cannot be resolved, that segment **is omitted**
  (the log says `quote target unresolved ...; omitting reply id`).
- `at` with `qq` set to `"all"` mentions every member.
- `image` with `data.type` set to `"flash"` is a flash photo.

### 6.3 Send direction: 9 additional compatible segments

`segmentToElement` in `message-parser.ts` additionally accepts:

| `type` | Required fields | Conversion result |
| --- | --- | --- |
| `share` | `url`, `title` (`content`, `image` optional) | → `json` card (`com.tencent.structmsg` / `news`) |
| `music` | `type` + `id`, or type `custom` + `url`/`audio`/`title` | → `json` card (needs an external signing service) |
| `location` | See source | Location card |
| `contact` | See source | Friend/group recommendation card |
| `rps` | — | Rock-paper-scissors |
| `dice` | — | Dice |
| `shake` | — | Window shake |
| `anonymous` | — | Anonymous message marker |
| `node` | — | **Only allowed inside a merged-forward node list** |

> A top-level `node` throws `UNSENDABLE_TYPE`:
> `message segment "node" is only valid inside a forward node list`.
>
> `music`'s signing service defaults to `https://ss.xingzhige.com/music_card/card`,
> which must be reachable from the internet; on failure that segment is skipped.

### 6.4 Empty text placeholder

A text segment whose `text` field is **exactly `""`** is treated as a **compatibility placeholder**
and does not count as a "sendable segment":

```js
function isExplicitEmptyTextPlaceholder(segment) { /* text === "" 精确匹配 */ }
```

The differences:

| Form | Behavior |
| --- | --- |
| `{ "type":"text", "data":{ "text":"" } }` | Compatibility placeholder, **ignored** |
| `{ "type":"text", "data":{} }` | Normal validation → error |
| `{ "type":"text", "data":{ "text":null } }` | Normal validation → error |
| `{ "type":"text", "data":{ "text":"  " } }` | Normal validation (whitespace alone still counts as content) |

### 6.5 CQ codes

The string form uses CQ codes, with this regular expression (`message-parser.ts`):

```js
var CQ_REGEX = /\[CQ:([A-Za-z][A-Za-z0-9_]*)(?:,([^\]]*))?\]/g;
```

Examples: `[CQ:face,id=1]`, `[CQ:at,qq=10001]`.
With `auto_escape: true`, CQ codes in the string are **not parsed** and are sent as plain text.

---

## 7. About message IDs

- `message_id` **may be negative**; this is normal, and a negative number is not an anomaly.
- Private chat `message_id` prefers `ntMsgSeq`; group chat uses `msgSeq`
  (source `applyMessageIdResolver`).
- When it cannot be resolved it falls back to the raw sequence `seq`; when `seq === 0` it returns `0`.
- When passing a `message_id` back (as in `get_msg` or `delete_msg`), the message
  must be lookup-able in the **current account's message store**, otherwise it reports
  `message not found`.

---

## 8. Client implementation advice

| Scenario | Advice |
| --- | --- |
| Meta events arrive right after connecting | Normal; ignore `lifecycle(connect/enable)` before handling business events |
| Messages you sent are missing | Enable `reportSelfMessage: true` if you need them |
| `message` is a string, not an array | The adapter uses `messageFormat: "string"`; change the configuration or parse CQ codes |
| Liveness from heartbeats | Use `interval` (30000 ms) and tolerate 2–3 misses |
| Event deduplication | A reconnect **re-sends the bootstrap**, and SSE supports replay via `Last-Event-ID`, so deduplicate by `message_id` |
| Actions only, no events | Use role `Api` for the connection |
| Events only, no actions | Use role `Event` for the connection |

---

## 9. Differences from standard OneBot v11

| Item | Difference |
| --- | --- |
| `sender.sex` / `sender.age` | Always `"unknown"` / `0`; not real data |
| `bot_offline` | Non-standard `notice_type` |
| `bot_status` | Non-standard `notice_type` (`sub_type`: `online`/`offline`) |
| `message_sent` | Pushed only with `reportSelfMessage` |
| Three internal events | `ptt_trans_result` / `online_devices_changed` / `friend_remark_changed` are **explicitly not converted** |
| `get_supported_actions` | ❌ Not implemented (see `actions.md`) |
| Extra fields | Extensions such as `message_seq` (on messages and some notice events), `group_name` (group messages) and `target_id` (self-echo private messages) |

---

## 10. Declaration

| Item | Status |
| --- | --- |
| The three envelope constructors | **Verified**: `envelope.ts` |
| 13 `notice_type` values and all fields | **Verified**: literals in `to-notice.ts` |
| 6 `notify` subtypes | **Verified**: `to-notice.ts` |
| 2 `request_type` values | **Verified**: `to-request.ts` |
| Meta event `sub_type` and bootstrap order | **Verified**: `instance.ts` + `adapter.ts` |
| 30000 ms heartbeat | **Verified**: `HEARTBEAT_INTERVAL = 3e4` |
| 16 receive segment types | **Verified**: `ELEMENT_CODECS` |
| 9 send compatibility segments | **Verified**: `segmentToElement` |
| Empty text placeholder rule | **Verified**: `isExplicitEmptyTextPlaceholder` |
| Real-machine JSON for each event | **Not measured**: fields come from the source, not from verified packet captures |

> This document has **not** captured a live event stream. Every field name and value was extracted
> from source literals, so the structure is trustworthy; but the **conditions under which fields are present**
> (such as `invited_id` and `target_id`) should be confirmed against real events during integration.
