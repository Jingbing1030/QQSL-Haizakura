# OneBot 動作參考（完整 222 個）


> **來源**：官方歸檔 `packages/mcp/src/generated/catalog.json`（597,554 位元組）。

> 這是原作者用 `pnpm --filter @snowluma/mcp gen` 從動作定義**自動產生**的目錄，
> 也就是已下線文件站 `haizakura.github.io/zh/docs/api` 的資料來源。**非 AI 產生。**

共 **222 個動作**，分 **12 類**。

## 分類索引

| 分類 | 動作數 |
|---|---|
| 資訊 | 5 |
| 訊息 | 6 |
| 好友 | 3 |
| 群資訊 | 7 |
| 群管理 | 24 |
| 群檔案 | 12 |
| 請求 | 2 |
| 擴充 | 115 |
| 群相簿 | 9 |
| 空間 | 29 |
| 系統表情 | 4 |
| 串流介面 | 6 |

## 資訊（5 個）

### `can_send_image`

**屬性**：唯讀

**回傳 schema**：`{"type": "object", "properties": {"yes": {"type": "boolean", "description": "是否支持发送图片"}}, "required": ["yes"]}`

**範例**：

```json
[
  {
    "summary": "基本调用",
    "params": {}
  }
]
```

### `can_send_record`

**屬性**：唯讀

**回傳 schema**：`{"type": "object", "properties": {"yes": {"type": "boolean", "description": "是否支持发送语音"}}, "required": ["yes"]}`

**範例**：

```json
[
  {
    "summary": "基本调用",
    "params": {}
  }
]
```

### `get_login_info`

**屬性**：唯讀

**回傳 schema**：`{"type": "object", "properties": {"user_id": {"type": "integer", "description": "登录 QQ 号"}, "nickname": {"type": "string", "description": "登录昵称"}}, "required": ["user_id", "nickname"]}`

**範例**：

```json
[
  {
    "summary": "基本调用",
    "params": {}
  }
]
```

### `get_status`

**屬性**：唯讀

**回傳 schema**：`{"type": "object", "properties": {"online": {"type": "boolean", "description": "是否在线"}, "good": {"type": "boolean", "description": "收发链路健康状态；确认接收停滞或主动请求连接失效时为 false"}, "time": {"type": "integer", "des`

**範例**：

```json
[
  {
    "summary": "基本调用",
    "params": {}
  }
]
```

### `get_version_info`

**屬性**：唯讀

**回傳 schema**：`{"type": "object", "properties": {"app_name": {"type": "string", "description": "实现名称（Haizakura）"}, "app_version": {"type": "string", "description": "实现版本"}, "protocol_version": {"type": "string", "des`

**範例**：

```json
[
  {
    "summary": "基本调用",
    "params": {}
  }
]
```

## 訊息（6 個）

### `delete_msg`

撤回訊息

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |

**回傳 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**範例**：

```json
[
  {
    "summary": "撤回消息",
    "params": {
      "message_id": -123456
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。"
  }
]
```

### `get_msg`

取得訊息

**屬性**：唯讀

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |

**回傳 schema**：`{"allOf": [{"type": "object", "properties": {"time": {"type": "integer", "description": "消息时间，Unix 秒"}, "message_type": {"type": "string", "enum": ["private", "group"]}, "sub_type": {"type": "string",`

**範例**：

```json
[
  {
    "summary": "获取消息",
    "params": {
      "message_id": -123456
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。"
  }
]
```

### `send_custom_face`

傳送帳號收藏表情（emoji_id 或 MD5），保留表情顯示樣式

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `emoji_id` | string | 是 |  |
| `group_id` | uint | 否 |  |
| `user_id` | uint | 否 |  |
| `reply_to` | messageId | 否 |  |

**回傳 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**範例**：

```json
[
  {
    "summary": "发送账号收藏表情（emoji_id 或 MD5），保留表情显示样式",
    "params": {
      "group_id": 20001,
      "emoji_id": "<emoji-id-from-fetch_custom_face_detail>"
    },
    "notes": "群聊和私聊目标只能提供一个；emoji_id 来自 fetch_custom_face_detail。"
  }
]
```

### `send_group_msg`

傳送群訊息

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `message` | message | 是 |  |
| `auto_escape` | bool | 否 |  |

**回傳 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**範例**：

```json
[
  {
    "summary": "发送群消息",
    "params": {
      "group_id": 20001,
      "message": [
        {
          "type": "text",
          "data": {
            "text": "你好"
          }
        }
      ]
    },
    "notes": "替换目标群号；成功返回的 message_id 可为负值。"
  }
]
```

### `send_msg`

傳送訊息（按 message_type/群號自動路由群聊或私聊）

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `message` | message | 是 |  |
| `message_type` | string | 否 |  |
| `group_id` | uint | 否 |  |
| `user_id` | uint | 否 |  |
| `auto_escape` | bool | 否 |  |

**回傳 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**範例**：

```json
[
  {
    "summary": "发送消息（按 message_type/群号 自动路由群聊或私聊）",
    "params": {
      "message_type": "group",
      "group_id": 20001,
      "message": "你好"
    },
    "notes": "必须提供对应目标；私聊使用 message_type=private 和 user_id。"
  }
]
```

### `send_private_msg`

傳送私聊訊息

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |
| `message` | message | 是 |  |
| `group_id` | int | 否 |  |
| `auto_escape` | bool | 否 |  |

**回傳 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**範例**：

```json
[
  {
    "summary": "发送私聊消息",
    "params": {
      "user_id": 10001,
      "message": "你好"
    },
    "notes": "替换目标好友 QQ 号；临时会话需另传来源 group_id。"
  }
]
```

## 好友（3 個）

### `delete_friend`

刪除好友

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |
| `block` | bool | 否 |  |

**回傳 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**範例**：

```json
[
  {
    "summary": "删除好友",
    "params": {
      "user_id": 10001,
      "block": false
    },
    "notes": "会删除指定好友；仅在明确需要删除时调用。"
  }
]
```

### `get_friend_list`

取得好友清單

**屬性**：唯讀

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `with_profile` | bool | 否 |  |

**回傳 schema**：`{"type": "array", "items": {"type": "object", "properties": {"user_id": {"type": "integer", "description": "好友 QQ 号"}, "nickname": {"type": "string", "description": "好友昵称"}, "remark": {"type": "string`

**範例**：

```json
[
  {
    "summary": "获取好友列表",
    "params": {}
  }
]
```

### `get_stranger_info`

取得陌生人資訊

**屬性**：唯讀

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |

**回傳 schema**：`{"type": "object", "properties": {"long_nick": {"type": "string", "description": "个性签名"}, "sex": {"type": "string", "description": "性别（male/female/unknown）"}, "age": {"type": "integer", "description":`

**範例**：

```json
[
  {
    "summary": "获取陌生人信息",
    "params": {
      "user_id": 10001
    },
    "notes": "替换为需要查询的 QQ 号。"
  }
]
```

## 群資訊（7 個）

### `get_group_honor_info`

取得群榮譽資訊

**屬性**：唯讀

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `type` | string | 否 |  |

**回傳 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer"}, "current_talkative": {"anyOf": [{"type": "object", "properties": {"user_id": {"type": ["number", "string", "null"]}, "nickname": {"ty`

**範例**：

```json
[
  {
    "summary": "获取群荣誉信息",
    "params": {
      "group_id": 20001,
      "type": "all"
    },
    "notes": "未请求的分类仍返回空数组；当前龙王可能为 null。"
  }
]
```

### `get_group_info`

取得群資訊

**屬性**：唯讀

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `no_cache` | bool | 否 |  |

**回傳 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名"}, "group_remark": {"type": "string", "description": "当前账号设置`

**範例**：

```json
[
  {
    "summary": "获取群信息",
    "params": {
      "group_id": 20001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_group_list`

取得群清單

**屬性**：唯讀

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `no_cache` | bool | 否 |  |

**回傳 schema**：`{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名"}, "group_remark": {"type": "stri`

**範例**：

```json
[
  {
    "summary": "获取群列表",
    "params": {
      "no_cache": false
    }
  }
]
```

### `get_group_member_info`

取得群成員資訊

**屬性**：唯讀

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `no_cache` | bool | 否 |  |

**回傳 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "user_id": {"type": "integer", "description": "QQ 号"}, "nickname": {"type": "string", "description": "昵称"}, "car`

**範例**：

```json
[
  {
    "summary": "获取群成员信息",
    "params": {
      "group_id": 20001,
      "user_id": 10001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_group_member_list`

取得群成員清單

**屬性**：唯讀

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `no_cache` | bool | 否 |  |

**回傳 schema**：`{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "user_id": {"type": "integer", "description": "QQ 号"}, "nickname": {"type": "string",`

**範例**：

```json
[
  {
    "summary": "获取群成员列表",
    "params": {
      "group_id": 20001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_group_share_link`

取得群分享連結

**屬性**：唯讀

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `need_short_url` | bool | 否 |  |
| `src_id` | int | 否 |  |
| `additional_param` | string | 否 |  |

**回傳 schema**：`{"type": "object", "properties": {"url": {"type": "string", "description": "加群分享链接"}}, "required": ["url"]}`

**範例**：

```json
[
  {
    "summary": "获取群分享链接",
    "params": {
      "group_id": 20001,
      "need_short_url": true
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_group_system_msg`

取得群系統訊息

**屬性**：唯讀

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_id` | uint | 否 |  |
| `only_pending` | bool | 否 |  |
| `count` | int | 否 |  |

**回傳 schema**：`{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名称"}, "request_id": {"type": "integ`

**範例**：

```json
[
  {
    "summary": "获取群系统消息",
    "params": {
      "group_id": 20001,
      "only_pending": true,
      "count": 20
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

## 群管理（24 個）

### `add_group_tag`

向某個群分類新增資料標籤

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_class` | int | 是 |  |
| `name` | string | 是 |  |

**回傳 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**範例**：

```json
[
  {
    "summary": "向某个群分类添加资料标签",
    "params": {
      "group_class": 1,
      "name": "学习"
    },
    "notes": "替换实际群分类和标签；需要当前账号有管理权限。"
  }
]
```

### `delete_group_tag`

從某個群分類移除資料標籤

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_class` | int | 是 |  |
| `name` | string | 是 |  |

**回傳 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**範例**：

```json
[
  {
    "summary": "从某个群分类移除资料标签",
    "params": {
      "group_class": 1,
      "name": "学习"
    },
    "notes": "替换实际群分类和标签；需要当前账号有管理权限。"
  }
]
```

### `get_group_admin_permissions`

讀取指定管理員的撤回、移除成員、每日移除上限及接收驗證訊息狀態

**屬性**：唯讀

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |

**回傳 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer"}, "user_id": {"type": "integer"}, "recall_member_message": {"type": ["boolean", "null"], "description": "撤回成员消息；null 表示服务器未指定"}, "kick_`

**範例**：

```json
[
  {
    "summary": "读取管理员权限",
    "params": {
      "group_id": 20001,
      "user_id": 10001
    },
    "notes": "user_id 为目标管理员 QQ 号；包含接收加群验证消息状态。"
  }
]
```

### `get_group_admin_settings`

取得群管理設定的目前值

**屬性**：唯讀

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**回傳 schema**：`{"type": "object", "properties": {"add_type": {"type": "integer", "description": "加群选项（同 set_group_add_option.add_type）"}, "group_question": {"type": "string", "description": "加群问题（同 set_group_add_opt`

**範例**：

```json
[
  {
    "summary": "获取群管理设置的当前值",
    "params": {
      "group_id": 20001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_group_tags`

讀取某個群分類下的資料標籤

**屬性**：唯讀

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_class` | int | 是 |  |

**回傳 schema**：`{"type": "object", "properties": {"tags": {"type": "array", "description": "资料标签", "items": {"type": "object", "properties": {"id": {"type": "integer", "description": "标签编号"}, "name": {"type": "string`

**範例**：

```json
[
  {
    "summary": "读取某个群分类下的资料标签",
    "params": {
      "group_class": 1
    },
    "notes": "group_class 使用实际群分类编号。"
  }
]
```

### `set_group_add_option`

設定加群選項

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `add_type` | int | 否 |  |
| `group_question` | string | 否 |  |
| `group_answer` | string | 否 |  |

**回傳 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**範例**：

```json
[
  {
    "summary": "设置加群选项",
    "params": {
      "group_id": 20001,
      "add_type": 2,
      "group_question": "入群用途？",
      "group_answer": "学习交流"
    },
    "notes": "修改加群设置前先用 get_group_admin_settings 查看当前状态，并确认目标设置值。"
  }
]
```

### `set_group_admin`

設定/取消管理員

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `enable` | bool | 否 |  |

**回傳 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**範例**：

```json
[
  {
    "summary": "设置/取消管理员",
    "params": {
      "group_id": 20001,
      "user_id": 10001,
      "enable": true
    },
    "notes": "需要群主权限；会授予该成员管理员身份。"
  }
]
```

### `set_group_admin_permissions`

設定指定管理員的撤回和移除成員權限

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `recall_member_message` | bool | 否 |  |
| `kick_member` | bool | 否 |  |
| `kick_member_per_day` | int | 否 |  |

**回傳 schema**：`{"type": "null", "description": "服务器确认请求后 data 为 null；不代表已经过客户端回读验证。可用 get_group_admin_permissions 查询。"}`

**範例**：

```json
[
  {
    "summary": "允许管理员每日移除至多 10 人",
    "params": {
      "group_id": 20001,
      "user_id": 10001,
      "kick_member": true,
      "kick_member_per_day": 10
    },
    "notes": "需要当前账号具有修改权限；不会授予管理员角色。仅修改显式字段。开启移除必须提供上限，0 表示不限；修改上限需同时传 kick_member=true。"
  }
]
```

**約束**：["at least one of: recall_member_message, kick_member", "kick_member=true requires kick_member_per_day: 0, 5, 10, 20, 50, 100 or 200", "kick_member_per_day requires kick_member=true"]

### `set_group_admin_receive_verify`

設定指定管理員是否接收加群驗證訊息

**參數**：

| 參數 | 類型 | 必填 | 說明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `enable` | bool | 是 |  |

**回傳 schema**：`{"type": "null", "description": "服务器响应确认目标群和管理员后 data 为 null；未确认目标时返回错误。"}`

**範例**：

```json
[
  {
    "summary": "开启接收验证消息",
    "params": {
      "group_id": 20001,
      "user_id": 10001,
      "enable": true
    },
    "notes": "user_id 为目标管理员 QQ 号；需要当前账号具有修改权限。独立于撤回和移除成员权限。"
  }
]
```

