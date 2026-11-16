# OneBot action reference (all 222)


> **Source**: the official archive `packages/mcp/src/generated/catalog.json` (597,554 bytes).

> This is the catalog the authors **generated automatically** from the action definitions via `pnpm --filter @snowluma/mcp gen`,
> the data source behind the retired docs site `haizakura.github.io/zh/docs/api`. **Not AI-generated.**

**222 actions** in **12 categories**.

## Category index

| Category | Actions |
|---|---|
| Info | 5 |
| Messages | 6 |
| Friends | 3 |
| Group info | 7 |
| Group admin | 24 |
| Group files | 12 |
| Requests | 2 |
| Extensions | 115 |
| Group albums | 9 |
| Qzone | 29 |
| System emoji | 4 |
| Streaming | 6 |

## Info (5)

### `can_send_image`

**Attributes**: read-only

**Returns schema**: `{"type": "object", "properties": {"yes": {"type": "boolean", "description": "是否支持发送图片"}}, "required": ["yes"]}`

**Examples**:

```json
[
  {
    "summary": "基本调用",
    "params": {}
  }
]
```

### `can_send_record`

**Attributes**: read-only

**Returns schema**: `{"type": "object", "properties": {"yes": {"type": "boolean", "description": "是否支持发送语音"}}, "required": ["yes"]}`

**Examples**:

```json
[
  {
    "summary": "基本调用",
    "params": {}
  }
]
```

### `get_login_info`

**Attributes**: read-only

**Returns schema**: `{"type": "object", "properties": {"user_id": {"type": "integer", "description": "登录 QQ 号"}, "nickname": {"type": "string", "description": "登录昵称"}}, "required": ["user_id", "nickname"]}`

**Examples**:

```json
[
  {
    "summary": "基本调用",
    "params": {}
  }
]
```

### `get_status`

**Attributes**: read-only

**Returns schema**: `{"type": "object", "properties": {"online": {"type": "boolean", "description": "是否在线"}, "good": {"type": "boolean", "description": "收发链路健康状态；确认接收停滞或主动请求连接失效时为 false"}, "time": {"type": "integer", "des`

**Examples**:

```json
[
  {
    "summary": "基本调用",
    "params": {}
  }
]
```

### `get_version_info`

**Attributes**: read-only

**Returns schema**: `{"type": "object", "properties": {"app_name": {"type": "string", "description": "实现名称（Haizakura）"}, "app_version": {"type": "string", "description": "实现版本"}, "protocol_version": {"type": "string", "des`

**Examples**:

```json
[
  {
    "summary": "基本调用",
    "params": {}
  }
]
```

## Messages (6)

### `delete_msg`

Recall a message

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | messageId | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

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

Get a message

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | messageId | Yes |  |

**Returns schema**: `{"allOf": [{"type": "object", "properties": {"time": {"type": "integer", "description": "消息时间，Unix 秒"}, "message_type": {"type": "string", "enum": ["private", "group"]}, "sub_type": {"type": "string",`

**Examples**:

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

Send an account favorite emoji (emoji_id or MD5), preserving the emoji display style

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `emoji_id` | string | Yes |  |
| `group_id` | uint | No |  |
| `user_id` | uint | No |  |
| `reply_to` | messageId | No |  |

**Returns schema**: `{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**Examples**:

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

Send a group message

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `message` | message | Yes |  |
| `auto_escape` | bool | No |  |

**Returns schema**: `{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**Examples**:

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

Send a message (routing automatically to group or private chat by message_type/group number)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message` | message | Yes |  |
| `message_type` | string | No |  |
| `group_id` | uint | No |  |
| `user_id` | uint | No |  |
| `auto_escape` | bool | No |  |

**Returns schema**: `{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**Examples**:

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

Send a private message

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | Yes |  |
| `message` | message | Yes |  |
| `group_id` | int | No |  |
| `auto_escape` | bool | No |  |

**Returns schema**: `{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**Examples**:

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

## Friends (3)

### `delete_friend`

Delete a friend

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | Yes |  |
| `block` | bool | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

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

Get the friend list

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `with_profile` | bool | No |  |

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"user_id": {"type": "integer", "description": "好友 QQ 号"}, "nickname": {"type": "string", "description": "好友昵称"}, "remark": {"type": "string`

**Examples**:

```json
[
  {
    "summary": "获取好友列表",
    "params": {}
  }
]
```

### `get_stranger_info`

Get stranger info

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"long_nick": {"type": "string", "description": "个性签名"}, "sex": {"type": "string", "description": "性别（male/female/unknown）"}, "age": {"type": "integer", "description":`

**Examples**:

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

## Group info (7)

### `get_group_honor_info`

Get group honor info

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `type` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"group_id": {"type": "integer"}, "current_talkative": {"anyOf": [{"type": "object", "properties": {"user_id": {"type": ["number", "string", "null"]}, "nickname": {"ty`

**Examples**:

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

Get group info

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `no_cache` | bool | No |  |

**Returns schema**: `{"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名"}, "group_remark": {"type": "string", "description": "当前账号设置`

**Examples**:

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

Get the group list

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `no_cache` | bool | No |  |

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名"}, "group_remark": {"type": "stri`

**Examples**:

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

Get group member info

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `user_id` | uint | Yes |  |
| `no_cache` | bool | No |  |

**Returns schema**: `{"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "user_id": {"type": "integer", "description": "QQ 号"}, "nickname": {"type": "string", "description": "昵称"}, "car`

**Examples**:

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

Get the group member list

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `no_cache` | bool | No |  |

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "user_id": {"type": "integer", "description": "QQ 号"}, "nickname": {"type": "string",`

**Examples**:

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

Get a group share link

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `need_short_url` | bool | No |  |
| `src_id` | int | No |  |
| `additional_param` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"url": {"type": "string", "description": "加群分享链接"}}, "required": ["url"]}`

**Examples**:

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

Get group system messages

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | No |  |
| `only_pending` | bool | No |  |
| `count` | int | No |  |

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名称"}, "request_id": {"type": "integ`

**Examples**:

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

## Group admin (24)

### `add_group_tag`

Add a profile tag to a group category

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_class` | int | Yes |  |
| `name` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

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

Remove a profile tag from a group category

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_class` | int | Yes |  |
| `name` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

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

Read an administrator's recall, member removal, daily removal limit and receive-verification-message state

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `user_id` | uint | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"group_id": {"type": "integer"}, "user_id": {"type": "integer"}, "recall_member_message": {"type": ["boolean", "null"], "description": "撤回成员消息；null 表示服务器未指定"}, "kick_`

**Examples**:

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

Get the current group admin settings

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"add_type": {"type": "integer", "description": "加群选项（同 set_group_add_option.add_type）"}, "group_question": {"type": "string", "description": "加群问题（同 set_group_add_opt`

**Examples**:

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

Read the profile tags under a group category

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_class` | int | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"tags": {"type": "array", "description": "资料标签", "items": {"type": "object", "properties": {"id": {"type": "integer", "description": "标签编号"}, "name": {"type": "string`

**Examples**:

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

Set join-group options

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `add_type` | int | No |  |
| `group_question` | string | No |  |
| `group_answer` | string | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

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

Set or revoke administrator

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `user_id` | uint | Yes |  |
| `enable` | bool | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

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

Set an administrator's recall and member removal permissions

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `user_id` | uint | Yes |  |
| `recall_member_message` | bool | No |  |
| `kick_member` | bool | No |  |
| `kick_member_per_day` | int | No |  |

**Returns schema**: `{"type": "null", "description": "服务器确认请求后 data 为 null；不代表已经过客户端回读验证。可用 get_group_admin_permissions 查询。"}`

**Examples**:

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

**Constraints**: ["at least one of: recall_member_message, kick_member", "kick_member=true requires kick_member_per_day: 0, 5, 10, 20, 50, 100 or 200", "kick_member_per_day requires kick_member=true"]

### `set_group_admin_receive_verify`

Set whether an administrator receives join-verification messages

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `user_id` | uint | Yes |  |
| `enable` | bool | Yes |  |

**Returns schema**: `{"type": "null", "description": "服务器响应确认目标群和管理员后 data 为 null；未确认目标时返回错误。"}`

**Examples**:

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

