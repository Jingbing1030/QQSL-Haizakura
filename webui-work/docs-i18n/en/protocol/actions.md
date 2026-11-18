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

### `set_group_anonymous`

Anonymous toggle (not implemented, returns ok)

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "匿名开关（未实现，返回 ok）",
    "params": {},
    "notes": "兼容占位接口：当前返回成功但不会修改匿名设置。"
  }
]
```

### `set_group_anonymous_ban`

Anonymous mute (not implemented, returns ok)

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "匿名禁言（未实现，返回 ok）",
    "params": {},
    "notes": "兼容占位接口：当前返回成功但不会修改匿名设置。"
  }
]
```

### `set_group_ban`

Mute a group member (duration=0 lifts the mute)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `user_id` | uint | Yes |  |
| `duration` | int | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "禁言群成员（duration=0 解除）",
    "params": {
      "group_id": 20001,
      "user_id": 10001,
      "duration": 600
    },
    "notes": "替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。 duration 为秒，0 表示解除禁言。"
  }
]
```

### `set_group_card`

Set a group card (empty string clears it)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `user_id` | uint | Yes |  |
| `card` | string | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置群名片（空字符串清除）",
    "params": {
      "group_id": 20001,
      "user_id": 10001,
      "card": "示例群名片"
    },
    "notes": "替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。"
  }
]
```

### `set_group_kick`

Kick a group member

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `user_id` | uint | Yes |  |
| `reject_add_request` | bool | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "踢出群成员",
    "params": {
      "group_id": 20001,
      "user_id": 10001,
      "reject_add_request": false
    },
    "notes": "替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。"
  }
]
```

### `set_group_kick_members`

Kick group members in bulk

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `user_id` | uint[] | Yes |  |
| `reject_add_request` | bool | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "批量踢出群成员",
    "params": {
      "group_id": 20001,
      "user_id": [
        10001,
        10002
      ],
      "reject_add_request": false
    },
    "notes": "替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。"
  }
]
```

### `set_group_leave`

Leave a group

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "退群",
    "params": {
      "group_id": 20001
    },
    "notes": "会退出该群，请确认目标群号后调用。"
  }
]
```

### `set_group_member_invite_policy`

Set the group member invite policy

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `policy` | enum | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置群成员邀请策略",
    "params": {
      "group_id": 20001,
      "policy": "require_approval"
    },
    "notes": "替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。"
  }
]
```

### `set_group_member_permissions`

Set group member permissions (only the group owner can change them)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `allow_member_upload_album` | bool | No |  |
| `allow_member_temporary_session` | bool | No |  |
| `allow_member_create_group` | bool | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置群成员权限（仅群主可改）",
    "params": {
      "group_id": 20001,
      "allow_member_upload_album": false
    },
    "notes": "至少传一个权限字段；仅修改传入的权限，其余保持原样。"
  }
]
```

**Constraints**: ["at least one of: allow_member_upload_album, allow_member_temporary_session, allow_member_create_group"]

### `set_group_name`

Set the group name

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `group_name` | string | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置群名",
    "params": {
      "group_id": 20001,
      "group_name": "学习交流群"
    },
    "notes": "替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。"
  }
]
```

### `set_group_new_member_history_visibility`

Set whether new members can view message history

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `visible` | bool | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置新成员是否可查看历史消息",
    "params": {
      "group_id": 20001,
      "visible": true
    },
    "notes": "替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。"
  }
]
```

### `set_group_portrait`

Set the group avatar

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `file` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置群头像",
    "params": {
      "group_id": 20001,
      "file": "file:///path/to/avatar.png"
    },
    "notes": "示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。"
  }
]
```

### `set_group_search`

Set how the group can be searched (group fingerprint / group number search switch)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `no_finger_open` | int | No |  |
| `no_code_finger_open` | int | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置群被搜索方式（群指纹 / 群号搜索开关）",
    "params": {
      "group_id": 20001,
      "no_finger_open": 0,
      "no_code_finger_open": 0
    },
    "notes": "替换群号；数值含义以当前群设置为准。"
  }
]
```

### `set_group_special_title`

Set a group special title

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `user_id` | uint | Yes |  |
| `special_title` | string | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置群头衔",
    "params": {
      "group_id": 20001,
      "user_id": 10001,
      "special_title": "学习委员"
    },
    "notes": "替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。"
  }
]
```

### `set_group_whole_ban`

Whole-group mute toggle

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `enable` | bool | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "全员禁言开关",
    "params": {
      "group_id": 20001,
      "enable": true
    },
    "notes": "替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。"
  }
]
```

## Group files (12)

### `create_group_file_folder`

Create a group folder

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `name` | string | Yes |  |
| `parent_id` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"result": {"type": "object", "properties": {"retCode": {"const": 0}, "retMsg": {"const": "success"}}, "required": ["retCode", "retMsg"]}, "groupItem": {"type": "objec`

**Examples**:

```json
[
  {
    "summary": "创建群文件夹",
    "params": {
      "group_id": 20001,
      "name": "共享资料",
      "parent_id": "/"
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `delete_group_file`

Delete a group file

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `file_id` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "删除群文件",
    "params": {
      "group_id": 20001,
      "file_id": "<file-id-from-get_group_root_files>"
    },
    "notes": "替换群文件列表中的实际 file_id；需要对应文件操作权限。"
  }
]
```

### `delete_group_file_folder`

Delete a group folder

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `folder_id` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "删除群文件夹",
    "params": {
      "group_id": 20001,
      "folder_id": "<folder-id-from-get_group_root_files>"
    },
    "notes": "会删除指定群文件夹，确认资源后调用。"
  }
]
```

### `get_group_file_url`

Get a group file download link

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `file_id` | string | Yes |  |
| `busid` | raw | No |  |

**Returns schema**: `{"type": "object", "properties": {"url": {"type": "string", "description": "文件下载直链"}}, "required": ["url"]}`

**Examples**:

```json
[
  {
    "summary": "获取群文件下载链接",
    "params": {
      "group_id": 20001,
      "file_id": "<file-id-from-get_group_root_files>"
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_group_files_by_folder`

Get the file list of a group subfolder

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `folder_id` | string | No |  |
| `folder` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"files": {"type": "array", "description": "文件列表", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "file_id": {"type":`

**Examples**:

```json
[
  {
    "summary": "获取群子目录文件列表",
    "params": {
      "group_id": 20001,
      "folder_id": "<folder-id-from-get_group_root_files>"
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_group_root_files`

Get the file list of the group root folder

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"files": {"type": "array", "description": "文件列表", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "file_id": {"type":`

**Examples**:

```json
[
  {
    "summary": "获取群根目录文件列表",
    "params": {
      "group_id": 20001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_private_file_url`

Get a private file download link

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | No |  |
| `file_id` | string | Yes |  |
| `file_hash` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"url": {"type": "string", "description": "文件下载直链"}}, "required": ["url"]}`

**Examples**:

```json
[
  {
    "summary": "获取私聊文件下载链接",
    "params": {
      "user_id": 10001,
      "file_id": "<file-id-from-private-message>"
    },
    "notes": "使用私聊文件消息段中的 file_id，必要时原样传 file_hash。"
  }
]
```

### `move_group_file`

Move a group file

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `file_id` | string | Yes |  |
| `parent_directory` | string | Yes |  |
| `target_directory` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "移动群文件",
    "params": {
      "group_id": 20001,
      "file_id": "<file-id>",
      "parent_directory": "/",
      "target_directory": "<target-folder-id>"
    },
    "notes": "目录和文件标识均来自该群文件列表。"
  }
]
```

### `rename_group_file`

Rename a group file

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `file_id` | string | Yes |  |
| `current_parent_directory` | string | No |  |
| `new_name` | string | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"ok": {"const": true}}, "required": ["ok"]}`

**Examples**:

```json
[
  {
    "summary": "重命名群文件",
    "params": {
      "group_id": 20001,
      "file_id": "<file-id>",
      "current_parent_directory": "/",
      "new_name": "新文件名.pdf"
    },
    "notes": "file_id 来自群文件列表，目录必须是文件当前所在目录。"
  }
]
```

### `rename_group_file_folder`

Rename a group folder

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `folder_id` | string | Yes |  |
| `new_folder_name` | string | No |  |
| `name` | string | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "重命名群文件夹",
    "params": {
      "group_id": 20001,
      "folder_id": "<folder-id>",
      "new_folder_name": "课程资料"
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `upload_group_file`

Upload a group file

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `file` | string | Yes |  |
| `name` | string | No |  |
| `folder` | string | No |  |
| `folder_id` | string | No |  |
| `upload_file` | bool | No |  |

**Returns schema**: `{"type": "object", "properties": {"file_id": {"type": "string"}}, "required": ["file_id"]}`

**Examples**:

```json
[
  {
    "summary": "上传群文件",
    "params": {
      "group_id": 20001,
      "file": "file:///path/to/report.pdf",
      "name": "报告.pdf"
    },
    "notes": "示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。"
  }
]
```

### `upload_private_file`

Upload a private file

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | Yes |  |
| `file` | string | Yes |  |
| `name` | string | No |  |
| `upload_file` | bool | No |  |

**Returns schema**: `{"type": "object", "properties": {"file_id": {"type": "string"}}, "required": ["file_id"]}`

**Examples**:

```json
[
  {
    "summary": "上传私聊文件",
    "params": {
      "user_id": 10001,
      "file": "file:///path/to/report.pdf",
      "name": "报告.pdf"
    },
    "notes": "示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。 默认上传并发送给该好友。"
  }
]
```

## Requests (2)

### `set_friend_add_request`

Handle a friend add request

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `flag` | string | Yes |  |
| `approve` | bool | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "处理好友添加请求",
    "params": {
      "flag": "<flag-from-friend-request-event>",
      "approve": true
    },
    "notes": "flag 必须原样使用当前账号好友请求事件的 flag，不能根据 QQ 号构造。"
  }
]
```

### `set_group_add_request`

Handle a group join request

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `flag` | string | Yes |  |
| `sub_type` | string | No |  |
| `type` | string | No |  |
| `approve` | bool | No |  |
| `reason` | string | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "处理加群请求",
    "params": {
      "flag": "<flag-from-group-request-event>",
      "sub_type": "add",
      "approve": true
    },
    "notes": "flag 和 sub_type 原样取自同一条群请求事件；邀请事件使用 invite。"
  }
]
```

## Extensions (115)

### `_del_group_notice`

Delete a group notice (either fid or notice_id)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `fid` | string | No |  |
| `notice_id` | string | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "删除群公告（fid 或 notice_id 二选一）",
    "params": {
      "group_id": 20001,
      "notice_id": "<notice-id-from-_get_group_notice>"
    },
    "notes": "notice_id 来自 _get_group_notice；删除需要管理权限。"
  }
]
```

### `_get_friend_dress`

Get the personal decorations in use by a QQ number (charms, cards, incoming call, input status, etc.)

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"target_uin": {"type": "string"}, "is_svip": {"type": "boolean"}, "avatar_url": {"type": "string"}, "items": {"type": "array", "items": {"type": "object", "properties`

**Examples**:

```json
[
  {
    "summary": "获取指定 QQ 号正在使用的个性装扮（挂件/名片/来电/输入状态等）",
    "params": {
      "user_id": 10001
    },
    "notes": "替换为需要查询的 QQ 号。"
  }
]
```

### `_get_group_notice`

Get group notices

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"notice_id": {"type": "string"}, "sender_id": {"type": "number"}, "publish_time": {"type": "number"}, "message": {"type": "object", "proper`

**Examples**:

```json
[
  {
    "summary": "获取群公告",
    "params": {
      "group_id": 20001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `_get_model_show`

Get the device-model display (mock compatible)

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `model` | string | No |  |

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"variants": {"type": "object", "properties": {"model_show": {"type": "string", "description": "机型展示名（回显请求的 model，缺省 snowluma）"}, "need_pay"`

**Examples**:

```json
[
  {
    "summary": "获取机型展示（兼容 mock）",
    "params": {
      "model": "示例机型"
    },
    "notes": "兼容占位接口，仅将传入的 model（或默认值）放进展示结构，不查询设备机型。"
  }
]
```

### `_mark_all_as_read`

Mark everything as read

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "标记全部已读",
    "params": {},
    "notes": "会将当前账号的会话标记为已读。"
  }
]
```

### `_send_group_notice`

Send a group notice (supports pinning, popups, new members, and group nickname guidance and confirmation)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `content` | string | Yes |  |
| `image` | string | No |  |
| `pinned` | int | No |  |
| `type` | int | No |  |
| `send_to_new_members` | bool | No |  |
| `is_show_edit_card` | int | No |  |
| `tip_window_type` | int | No |  |
| `confirm_required` | int | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "发送群公告（支持置顶、弹窗、新成员、群昵称引导与确认）",
    "params": {
      "group_id": 20001,
      "content": "欢迎参加本周讨论",
      "type": 1,
      "pinned": 0
    },
    "notes": "需要群公告管理权限；普通公告 type=1，新成员公告 type=20。"
  }
]
```

**Constraints**: ["type must be 1 (regular) or 20 (new members)", "send_to_new_members conflicts with type"]

### `_set_model_show`

Set the device-model display (placeholder)

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置机型展示（占位）",
    "params": {},
    "notes": "兼容占位接口，当前返回成功但不修改机型展示。"
  }
]
```

### `.get_word_slices`

Word segmentation (not implemented)

**Attributes**: read-only

**Returns schema**: `{"not": {}, "description": "当前始终返回失败，没有成功 data；失败响应 data 为 null，原因见 wording"}`

**Examples**:

```json
[
  {
    "summary": "分词（未实现）",
    "params": {},
    "notes": "当前未实现，调用返回失败；不要将其当作可用能力。"
  }
]
```

### `add_custom_face`

Add a favorite emoji

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"emoji_id": {"type": "string"}}, "required": ["emoji_id"]}`

**Examples**:

```json
[
  {
    "summary": "添加收藏表情",
    "params": {
      "file": "file:///path/to/emoji.png"
    },
    "notes": "示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。"
  }
]
```

### `bot_exit`

Exit the bot

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "退出机器人",
    "params": {},
    "notes": "会退出 Haizakura 进程，仅在明确需要停止服务时调用。"
  }
]
```

### `cancel_group_todo`

Cancel a group to-do

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `message_id` | messageId | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "取消群待办",
    "params": {
      "group_id": 20001,
      "message_id": -123456
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。 必须是该群的消息。"
  }
]
```

### `check_url_safely`

Check link safety

**Attributes**: read-only

**Returns schema**: `{"type": "object", "properties": {"level": {"type": "integer", "description": "安全等级（占位，恒 1）"}}, "required": ["level"]}`

**Examples**:

```json
[
  {
    "summary": "检查链接安全性",
    "params": {},
    "notes": "兼容占位接口，当前固定返回 level=1，不能用来证明某个链接安全。"
  }
]
```

### `clean_cache`

Clean the cache

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "清理缓存",
    "params": {},
    "notes": "兼容占位接口，当前返回成功但不执行清理。流式临时文件清理请使用 clean_stream_temp_file。"
  }
]
```

### `click_inline_keyboard_button`

Click an inline keyboard button

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `bot_appid` | uint | Yes |  |
| `msg_seq` | uint | Yes |  |
| `button_id` | string | Yes |  |
| `callback_data` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"result": {"type": "number", "description": "按钮业务结果码，需单独检查"}, "errMsg": {"type": "string"}, "status": {"const": 0}, "promptText": {"type": "string"}, "promptType": {"`

**Examples**:

```json
[
  {
    "summary": "点击内联键盘按钮",
    "params": {
      "group_id": 20001,
      "bot_appid": 10001,
      "msg_seq": 42,
      "button_id": "<button-id>",
      "callback_data": "<callback-data>"
    },
    "notes": "参数必须来自同一条机器人按钮消息；msg_seq 是消息序号，不是 message_id。"
  }
]
```

### `complete_group_todo`

Complete a group to-do

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `message_id` | messageId | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "完成群待办",
    "params": {
      "group_id": 20001,
      "message_id": -123456
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。 必须是该群的消息。"
  }
]
```

### `create_collection`

Create a collection (not implemented)

**Returns schema**: `{"not": {}, "description": "当前始终返回失败，没有成功 data；失败响应 data 为 null，原因见 wording"}`

**Examples**:

```json
[
  {
    "summary": "创建收藏（未实现）",
    "params": {},
    "notes": "当前未实现，调用返回失败；不要将其当作可用能力。"
  }
]
```

### `create_flash_task`

Create a flash-transfer task

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `files` | raw | No |  |
| `name` | string | No |  |
| `thumb_path` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"fileset_id": {"type": "string"}, "task_id": {"type": "string", "description": "与 fileset_id 相同的兼容字段"}}, "required": ["fileset_id", "task_id"]}`

**Examples**:

```json
[
  {
    "summary": "创建闪传任务",
    "params": {
      "files": [
        {
          "file": "file:///path/to/report.pdf",
          "name": "报告.pdf"
        }
      ],
      "name": "资料包"
    },
    "notes": "示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。 files 不能为空。"
  }
]
```

### `delete_custom_face`

Delete a favorite emoji

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `emoji_id` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "删除收藏表情",
    "params": {
      "emoji_id": "<emoji-id-from-fetch_custom_face_detail>"
    },
    "notes": "emoji_id 来自 fetch_custom_face_detail。"
  }
]
```

### `delete_essence_msg`

Remove an essence message

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | messageId | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "移除精华消息",
    "params": {
      "message_id": -123456
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。"
  }
]
```

### `delete_flash_file`

Delete a flash-transfer file

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `fileset_id` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "删除闪传文件",
    "params": {
      "fileset_id": "<fileset-id>"
    },
    "notes": "fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。"
  }
]
```

### `delete_group_folder`

Delete a group folder

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `folder_id` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "删除群文件夹",
    "params": {
      "group_id": 20001,
      "folder_id": "<folder-id-from-get_group_root_files>"
    },
    "notes": "会删除指定群文件夹，确认资源后调用。"
  }
]
```

### `download_file`

Download a file (url or base64) to data/downloads

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | No |  |
| `base64` | string | No |  |
| `name` | string | No |  |
| `headers` | raw | No |  |

**Returns schema**: `{"type": "object", "properties": {"file": {"type": "string", "description": "保存到 Haizakura 服务端的本地文件路径"}}, "required": ["file"]}`

**Examples**:

```json
[
  {
    "summary": "下载文件（url 或 base64）到 data/downloads",
    "params": {
      "base64": "aGVsbG8=",
      "name": "hello.txt"
    },
    "notes": "保存到 Haizakura 服务端临时目录，返回服务端路径；不是 MCP 主机下载路径。"
  }
]
```

### `download_fileset`

Resolve a flash-transfer download direct link (no download; the caller implements it)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `fileset_id` | string | Yes |  |
| `file_name` | string | No |  |
| `file_index` | number | No |  |

**Returns schema**: `{"type": "object", "properties": {"url": {"type": "string"}, "file_name": {"type": "string"}, "file_size": {"type": "number"}}, "required": ["url", "file_name", "file_size"]}`

**Examples**:

```json
[
  {
    "summary": "解析闪传文件下载直链（不下载，由调用方实现下载）",
    "params": {
      "fileset_id": "<fileset-id>",
      "file_index": 0
    },
    "notes": "fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。 file_index 从 0 开始。"
  }
]
```

### `fetch_custom_face`

Get custom emoji

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `count` | int | No |  |
| `return_type` | string | No |  |

**Returns schema**: `{"type": "array", "items": {"type": "string", "description": "图片 URL 或 emoji_id（取决于 return_type）"}}`

**Examples**:

```json
[
  {
    "summary": "获取自定义表情",
    "params": {
      "count": 10,
      "return_type": "url"
    }
  }
]
```

### `fetch_custom_face_detail`

Get custom emoji details

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `count` | int | No |  |

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"emoji_id": {"type": "string", "description": "可传给 Haizakura 表情管理接口的资源标识"}, "resId": {"type": "string", "description": "兼容 NapCat 的资源标识"}, "`

**Examples**:

```json
[
  {
    "summary": "获取自定义表情详情",
    "params": {
      "count": 10
    }
  }
]
```

### `fetch_emoji_like`

Get the users who reacted with an emoji (NapCat pagination)

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | messageId | Yes |  |
| `emojiId` | string | Yes |  |
| `count` | int | No |  |
| `cookie` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"result": {"type": "integer", "description": "结果码（恒 0）"}, "errMsg": {"type": "string", "description": "错误信息（恒空串）"}, "emojiLikesList": {"type": "array", "description":`

**Examples**:

```json
[
  {
    "summary": "获取表情回应用户（NapCat 分页）",
    "params": {
      "message_id": -123456,
      "emojiId": "128077",
      "count": 10
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。 后续页原样传回上页 cookie。"
  }
]
```

### `fetch_ptt_text`

Get the speech-to-text result

**Aliases**: `get_ptt_text`, `get_record_text`

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | messageId | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"text": {"type": "string", "description": "语音转写文本"}}, "required": ["text"]}`

**Examples**:

```json
[
  {
    "summary": "获取语音转文字结果",
    "params": {
      "message_id": -123456
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。"
  }
]
```

### `forward_friend_single_msg`

Forward a single message to a friend

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | messageId | Yes |  |
| `user_id` | uint | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**Examples**:

```json
[
  {
    "summary": "转发单条消息给好友",
    "params": {
      "message_id": -123456,
      "user_id": 10001
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。"
  }
]
```

### `forward_group_single_msg`

Forward a single message to a group

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | messageId | Yes |  |
| `group_id` | uint | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**Examples**:

```json
[
  {
    "summary": "转发单条消息到群",
    "params": {
      "message_id": -123456,
      "group_id": 20001
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。"
  }
]
```

### `friend_poke`

Poke a friend

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | Yes |  |
| `target_id` | uint | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "好友拍一拍",
    "params": {
      "user_id": 10001
    },
    "notes": "戳一戳指定好友。"
  }
]
```

### `get_ai_characters`

Get AI voice characters

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `chat_type` | int | No |  |

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"type": {"type": "string", "description": "角色分类名"}, "characters": {"type": "array", "description": "该分类下的角色列表", "items": {"type": "object",`

**Examples**:

```json
[
  {
    "summary": "获取 AI 语音角色",
    "params": {
      "group_id": 20001,
      "chat_type": 1
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_ai_record`

Generate AI voice

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `character` | string | Yes |  |
| `text` | string | Yes |  |
| `chat_type` | int | No |  |

**Returns schema**: `{"type": "string", "description": "生成的下载或分享 URL 字符串，不是含 url 字段的对象"}`

**Examples**:

```json
[
  {
    "summary": "生成 AI 语音",
    "params": {
      "group_id": 20001,
      "character": "<character-id-from-get_ai_characters>",
      "text": "你好",
      "chat_type": 1
    },
    "notes": "character 原样使用 get_ai_characters 的 character_id；send_group_ai_record 会直接发送语音。"
  }
]
```

### `get_clientkey`

Get the clientkey

**Attributes**: read-only

**Returns schema**: `{"type": "object", "properties": {"clientKey": {"type": "string", "description": "clientkey"}, "expireTime": {"type": "string", "description": "过期时间"}, "keyIndex": {"type": "string", "description": "k`

**Examples**:

```json
[
  {
    "summary": "获取 clientkey",
    "params": {},
    "notes": "返回值可能包含凭据或临时下载密钥，请勿公开或记录到不受控日志。"
  }
]
```

### `get_collection_list`

Get the collection list

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `category` | int | No |  |
| `count` | int | No |  |

**Returns schema**: `{"type": "object", "properties": {"errCode": {"type": "integer"}, "errMsg": {"type": "string"}, "collectionSearchList": {"type": "object", "properties": {"collectionItemList": {"type": "array", "items`

**Examples**:

```json
[
  {
    "summary": "获取收藏列表",
    "params": {
      "category": 0,
      "count": 20
    }
  }
]
```

### `get_cookies`

Get cookies

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `domain` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"cookies": {"type": "string", "description": "该域名的 Cookie 字符串"}}, "required": ["cookies"]}`

**Examples**:

```json
[
  {
    "summary": "获取 Cookies",
    "params": {
      "domain": "qun.qq.com"
    },
    "notes": "返回登录凭据，仅在有明确用途时读取，请勿公开。"
  }
]
```

### `get_credentials`

Get credentials

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `domain` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"cookies": {"type": "string", "description": "该域名的 Cookie 字符串"}, "token": {"type": "integer", "description": "CSRF 令牌（bkn）"}, "csrf_token": {"type": "integer", "descr`

**Examples**:

```json
[
  {
    "summary": "获取凭证",
    "params": {
      "domain": "qun.qq.com"
    },
    "notes": "返回登录凭据，仅在有明确用途时读取，请勿公开。"
  }
]
```

### `get_csrf_token`

Get the CSRF token

**Attributes**: read-only

**Returns schema**: `{"type": "object", "properties": {"token": {"type": "integer", "description": "CSRF 令牌（bkn）"}}, "required": ["token"]}`

**Examples**:

```json
[
  {
    "summary": "获取 CSRF 令牌",
    "params": {}
  }
]
```

### `get_doubt_friends_add_request`

Get suspicious friend requests

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `count` | int | No |  |

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"uid": {"type": "string", "description": "申请人 uid（回传作 set_doubt_friends_add_request 的 flag）"}, "user_id": {"type": "integer", "description"`

**Examples**:

```json
[
  {
    "summary": "获取可疑好友申请",
    "params": {
      "count": 20
    }
  }
]
```

### `get_emoji_likes`

Get the users who reacted with an emoji

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | messageId | Yes |  |
| `emoji_id` | string | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"emoji_like_list": {"type": "array", "description": "回应用户列表", "items": {"type": "object", "properties": {"user_id": {"type": "string", "description": "用户 QQ 号（字符串）"},`

**Examples**:

```json
[
  {
    "summary": "获取表情回应用户",
    "params": {
      "message_id": -123456,
      "emoji_id": "128077"
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。"
  }
]
```

### `get_essence_msg_list`

Get the essence message list

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"msg_seq": {"type": "integer"}, "msg_random": {"type": "integer"}, "sender_id": {"type": "integer"}, "sender_nick": {"type": "string"}, "se`

**Examples**:

```json
[
  {
    "summary": "获取精华消息列表",
    "params": {
      "group_id": 20001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_file`

Get file info (image/voice cache only; use get_group_file_url for group files)

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file_id` | string | No |  |
| `file` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"file": {"type": "string", "description": "媒体地址；图片无地址时可为原文件标识"}, "url": {"type": "string", "description": "媒体下载地址，图片地址可能为空"}, "file_size": {"type": "string", "descrip`

**Examples**:

```json
[
  {
    "summary": "获取文件信息（仅图片/语音缓存；群文件请用 get_group_file_url）",
    "params": {
      "file_id": "<media-file-id-from-message>"
    },
    "notes": "仅查询已缓存的图片或语音，先尝试图片，再尝试语音。"
  }
]
```

### `get_fileset_id`

Get a fileset_id from a QQ flash-transfer share code or official share link

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `share_code` | string | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"fileset_id": {"type": "string", "description": "文件集 ID"}}, "required": ["fileset_id"]}`

**Examples**:

```json
[
  {
    "summary": "从 QQ 闪传分享码或官方分享链接获取 fileset_id",
    "params": {
      "share_code": "<share-link-or-code>"
    },
    "notes": "share_code 使用实际闪传分享链接或提取码。"
  }
]
```

### `get_fileset_info`

Get fileset info

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `fileset_id` | string | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"fileset_id": {"type": "string"}, "file_list": {"type": "array", "items": {"type": "object", "properties": {"fileset_id": {"type": "string"}, "file_name": {"type": "s`

**Examples**:

```json
[
  {
    "summary": "获取文件集信息",
    "params": {
      "fileset_id": "<fileset-id>"
    },
    "notes": "fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。"
  }
]
```

### `get_flash_file_list`

Get the flash-transfer file list

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `fileset_id` | string | Yes |  |

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"fileset_id": {"type": "string"}, "file_name": {"type": "string"}, "orig_name": {"type": "string"}, "size": {"type": "number", "description`

**Examples**:

```json
[
  {
    "summary": "获取闪传文件列表",
    "params": {
      "fileset_id": "<fileset-id>"
    },
    "notes": "fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。"
  }
]
```

### `get_flash_file_url`

Get a flash-transfer file link

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `fileset_id` | string | Yes |  |
| `file_name` | string | No |  |
| `file_index` | number | No |  |

**Returns schema**: `{"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}`

**Examples**:

```json
[
  {
    "summary": "获取闪传文件链接",
    "params": {
      "fileset_id": "<fileset-id>",
      "file_index": 0
    },
    "notes": "fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。 file_index 从 0 开始。"
  }
]
```

### `get_forward_msg`

Get a combined forward message (id or message_id)

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | No |  |
| `message_id` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"messages": {"type": "array", "description": "转发消息节点数组；节点标识与本地消息 ID 不是同一契约", "items": {"type": "object", "properties": {"time": {"type": "integer", "description": "消息`

**Examples**:

```json
[
  {
    "summary": "获取合并转发消息（id 或 message_id）",
    "params": {
      "id": "<res-id-from-forward-message>"
    },
    "notes": "id 是合并转发资源标识，通常来自转发消息段或上传结果 res_id，不是普通数值 message_id。"
  }
]
```

### `get_friend_msg_history`

Get a friend message history (without an anchor, fetch the latest bidirectional records from the server)

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | Yes |  |
| `message_id` | int | No |  |
| `count` | int | No |  |
| `reverse_order` | bool | No |  |

**Returns schema**: `{"type": "object", "properties": {"messages": {"type": "array", "description": "消息对象数组；去除 post_type/self_id，附带 real_id", "items": {"type": "object", "properties": {"time": {"type": "integer", "descrip`

**Examples**:

```json
[
  {
    "summary": "获取好友消息历史（无锚点时从服务器获取最新双向记录）",
    "params": {
      "user_id": 10001,
      "count": 20
    },
    "notes": "省略 message_id 从最新消息开始；只读取当前账号消息。"
  }
]
```

### `get_friends_with_category`

Get the friend list grouped by category

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `with_profile` | bool | No |  |

**Returns schema**: `{"type": "array", "description": "带分组的好友列表", "items": {"type": "object", "properties": {"categoryId": {"type": "integer", "description": "分组 ID"}, "categoryName": {"type": "string", "description": "分组`

**Examples**:

```json
[
  {
    "summary": "获取分组好友列表",
    "params": {}
  }
]
```

### `get_group_at_all_remain`

Get the remaining @all-member uses in a group

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"can_at_all": {"type": "boolean", "description": "当前是否可 @全体成员"}, "remain_at_all_count_for_group": {"type": "integer", "description": "本群今日剩余 @全体次数"}, "remain_at_all_c`

**Examples**:

```json
[
  {
    "summary": "获取群 @全体成员 剩余次数",
    "params": {
      "group_id": 20001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_group_detail_info`

Get detailed group info

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
    "summary": "获取群详细信息",
    "params": {
      "group_id": 20001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_group_file_system_info`

Get group file system info

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"file_count": {"type": "integer", "description": "当前文件数"}, "limit_count": {"type": "integer", "description": "文件数上限"}, "used_space": {"type": "integer", "description"`

**Examples**:

```json
[
  {
    "summary": "获取群文件系统信息",
    "params": {
      "group_id": 20001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_group_ignore_add_request`

Get ignored group join requests (NapCat)

**Attributes**: read-only

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"request_id": {"type": "integer", "description": "请求序列号"}, "invitor_uin": {"type": "integer", "description": "邀请人 QQ 号"}, "invitor_nick": {`

**Examples**:

```json
[
  {
    "summary": "获取被忽略的入群请求（NapCat）",
    "params": {}
  }
]
```

### `get_group_ignored_notifies`

Get filtered group join requests

**Attributes**: read-only

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名称"}, "request_id": {"type": "integ`

**Examples**:

```json
[
  {
    "summary": "获取被过滤的入群请求",
    "params": {}
  }
]
```

### `get_group_info_ex`

Get group info (extended)

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
    "summary": "获取群信息（扩展）",
    "params": {
      "group_id": 20001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_group_msg_history`

Get a group message history

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `message_id` | int | No |  |
| `count` | int | No |  |
| `reverse_order` | bool | No |  |

**Returns schema**: `{"type": "object", "properties": {"messages": {"type": "array", "description": "消息对象数组；去除 post_type/self_id，附带 real_id", "items": {"type": "object", "properties": {"time": {"type": "integer", "descrip`

**Examples**:

```json
[
  {
    "summary": "获取群消息历史",
    "params": {
      "group_id": 20001,
      "count": 20
    },
    "notes": "省略 message_id 从最新消息开始；翻页使用上一页实际 message_id，不要自行加减。"
  }
]
```

### `get_group_shut_list`

Get the group mute list

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"user_id": {"type": "integer", "description": "成员 QQ 号"}, "nickname": {"type": "string", "description": "成员昵称"}, "shut_up_time": {"type": "`

**Examples**:

```json
[
  {
    "summary": "获取群禁言列表",
    "params": {
      "group_id": 20001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_group_signed_list`

Get the group check-in list for today

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"user_id": {"type": "integer"}, "nick": {"type": "string"}, "time": {"type": "integer"}, "rank": {"type": "integer"}}, "required": ["user_i`

**Examples**:

```json
[
  {
    "summary": "获取群今日打卡列表",
    "params": {
      "group_id": 20001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_group_todo_list`

Get the group to-do list

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；`

**Examples**:

```json
[
  {
    "summary": "获取群待办列表",
    "params": {
      "group_id": 20001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_image`

Get image info

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | No |  |
| `file_id` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"file": {"type": "string", "description": "媒体地址；图片无地址时可为原文件标识"}, "url": {"type": "string", "description": "媒体下载地址，图片地址可能为空"}, "file_size": {"type": "string", "descrip`

**Examples**:

```json
[
  {
    "summary": "获取图片信息",
    "params": {
      "file": "<image-file-from-message>"
    },
    "notes": "file 或 file_id 原样取自图片消息段，须在当前账号媒体缓存中存在。"
  }
]
```

### `get_mini_app_ark`

Get a mini-app card ark

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `type` | string | No |  |
| `title` | string | No |  |
| `desc` | string | No |  |
| `picUrl` | string | No |  |
| `pic_url` | string | No |  |
| `jumpUrl` | string | No |  |
| `jump_url` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"data": {"type": "object", "properties": {"ver": {"description": "服务端卡片版本，原样透传"}, "prompt": {"description": "服务端提示文本，原样透传"}, "config": {"description": "服务端卡片配置，原样透传"}`

**Examples**:

```json
[
  {
    "summary": "获取小程序卡片 ark",
    "params": {
      "type": "bili",
      "title": "示例视频",
      "desc": "视频介绍",
      "pic_url": "https://example.com/cover.png",
      "jump_url": "https://www.bilibili.com/video/<video-id>"
    },
    "notes": "替换为实际分享地址；当前仅支持 bili 和 weibo。返回的 data 是卡片对象，不会自动发送。"
  }
]
```

### `get_msg_emoji_likes`

Get all emoji reactions on a message

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | messageId | Yes |  |

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"emoji_id": {"type": "string", "description": "表情编号"}, "emoji_type": {"type": "integer", "description": "表情类型"}, "count": {"type": "integer`

**Examples**:

```json
[
  {
    "summary": "获取一条消息的全部表情回应",
    "params": {
      "message_id": -123456
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。"
  }
]
```

### `get_online_clients`

Get online clients

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `no_cache` | bool | No |  |

**Returns schema**: `{"type": "object", "properties": {"clients": {"type": "array", "description": "在线设备列表", "items": {"type": "object", "properties": {"app_id": {"type": "integer", "description": "客户端 ID"}, "device_name"`

**Examples**:

```json
[
  {
    "summary": "获取在线客户端",
    "params": {
      "no_cache": false
    }
  }
]
```

### `get_profile_like`

Get profile likes

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | int | No |  |
| `start` | int | No |  |
| `count` | int | No |  |

**Returns schema**: `{"type": "object", "properties": {"uid": {"type": "string", "description": "用户 uid"}, "time": {"type": "integer", "description": "最近点赞时间戳"}, "favoriteInfo": {"type": "object", "description": "收藏统计", "`

**Examples**:

```json
[
  {
    "summary": "获取资料点赞",
    "params": {
      "user_id": 10001,
      "start": 0,
      "count": 10
    }
  }
]
```

### `get_recent_contact`

Get recent conversations (placeholder)

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `count` | int | No |  |

**Returns schema**: `{"type": "array", "description": "最近会话列表（占位，恒空）"}`

**Examples**:

```json
[
  {
    "summary": "获取最近会话（占位）",
    "notes": "兼容占位接口，当前始终返回空数组，不能据此判断真实会话列表。",
    "params": {
      "count": 10
    }
  }
]
```

### `get_record`

Get voice info; passing out_format makes the server transcode it and attach base64

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | No |  |
| `file_id` | string | No |  |
| `out_format` | enum | No |  |

**Returns schema**: `{"allOf": [{"type": "object", "properties": {"file": {"type": "string", "description": "媒体地址；图片无地址时可为原文件标识"}, "url": {"type": "string", "description": "媒体下载地址，图片地址可能为空"}, "file_size": {"type": "string`

**Examples**:

```json
[
  {
    "summary": "获取语音信息；传 out_format 则服务端转码并附带 base64",
    "params": {
      "file": "<record-file-from-message>",
      "out_format": "mp3"
    },
    "notes": "file 来自语音消息段；格式转换依赖服务端可用的转换工具，成功时增加 out_format 和 base64。"
  }
]
```

### `get_rkey`

Get the download rkey

**Aliases**: `nc_get_rkey`

**Attributes**: read-only

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"rkey": {"type": "string", "description": "下载密钥，敏感信息"}, "type": {"type": "integer"}, "ttl": {"type": "integer", "description": "有效时长，秒"}, "`

**Examples**:

```json
[
  {
    "summary": "获取下载 rkey",
    "params": {},
    "notes": "返回值可能包含凭据或临时下载密钥，请勿公开或记录到不受控日志。"
  }
]
```

### `get_rkey_server`

Get rkey server info

**Attributes**: read-only

**Returns schema**: `{"type": "object", "properties": {"expired_time": {"type": "integer", "description": "过期时间戳（秒）"}, "name": {"type": "string", "description": "服务器名（恒 Haizakura）"}, "private_rkey": {"type": "string", "des`

**Examples**:

```json
[
  {
    "summary": "获取 rkey 服务器信息",
    "params": {},
    "notes": "返回值可能包含凭据或临时下载密钥，请勿公开或记录到不受控日志。"
  }
]
```

### `get_share_link`

Get a file share link

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `fileset_id` | string | Yes |  |

**Returns schema**: `{"type": "string", "description": "生成的下载或分享 URL 字符串，不是含 url 字段的对象"}`

**Examples**:

```json
[
  {
    "summary": "获取文件分享链接",
    "params": {
      "fileset_id": "<fileset-id>"
    },
    "notes": "fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。"
  }
]
```

### `get_unidirectional_friend_list`

Get the one-way friend list

**Attributes**: read-only

**Returns schema**: `{"type": "array", "items": {"type": "object", "additionalProperties": true, "description": "服务端列表项原样透传，目前未归一化字段，不能假定与 get_friend_list 相同"}}`

**Examples**:

```json
[
  {
    "summary": "获取单向好友列表",
    "params": {}
  }
]
```

### `group_poke`

Poke in a group

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `user_id` | uint | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "群拍一拍",
    "params": {
      "group_id": 20001,
      "user_id": 10001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `list_filesets`

List all flash-transfer filesets of the current account

**Returns schema**: `{"type": "array", "items": {"type": "object", "properties": {"fileset_id": {"type": "string"}, "file_name": {"type": "string"}, "orig_name": {"type": "string"}, "size": {"type": "number", "description`

**Examples**:

```json
[
  {
    "summary": "列出当前账号的所有闪传文件集",
    "params": {}
  }
]
```

### `mark_group_msg_as_read`

Mark group messages as read

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | messageId | Yes |  |
| `group_id` | uint | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "标记群消息已读",
    "params": {
      "message_id": -123456,
      "group_id": 20001
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。"
  }
]
```

### `mark_msg_as_read`

Mark messages as read (routing automatically between group and private)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | messageId | Yes |  |
| `target_id` | uint | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "标记消息已读（群聊/私聊自动路由）",
    "params": {
      "message_id": -123456
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。"
  }
]
```

### `mark_private_msg_as_read`

Mark private messages as read

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | messageId | Yes |  |
| `user_id` | uint | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "标记私聊消息已读",
    "params": {
      "message_id": -123456,
      "user_id": 10001
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。"
  }
]
```

### `modify_custom_face`

Edit a favorite emoji note

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `emoji_id` | string | Yes |  |
| `desc` | string | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "修改收藏表情备注",
    "params": {
      "emoji_id": "<emoji-id>",
      "desc": "常用表情"
    },
    "notes": "emoji_id 来自 fetch_custom_face_detail。"
  }
]
```

### `move_custom_face_to_front`

Move a favorite emoji to the front

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `emoji_id` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "收藏表情移到最前",
    "params": {
      "emoji_id": "<emoji-id-from-fetch_custom_face_detail>"
    },
    "notes": "emoji_id 来自 fetch_custom_face_detail。"
  }
]
```

### `nc_get_packet_status`

Get packet status (placeholder)

**Attributes**: read-only

**Returns schema**: `{"type": "null", "description": "packet 状态（占位，恒 null）"}`

**Examples**:

```json
[
  {
    "summary": "获取 packet 状态（占位）",
    "notes": "兼容占位接口，当前始终返回 null，不提供实际收发统计。",
    "params": {}
  }
]
```

### `nc_get_user_status`

Get a user online/extended status

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"status": {"type": "integer", "description": "在线状态码"}, "ext_status": {"type": "integer", "description": "扩展状态码"}}, "required": ["status", "ext_status"]}`

**Examples**:

```json
[
  {
    "summary": "获取用户在线/扩展状态",
    "params": {
      "user_id": 10001
    },
    "notes": "替换为需要查询的 QQ 号。"
  }
]
```

### `ocr_image`

OCR an image (server-side; needs an image URL or a cached image file_id)

**Aliases**: `.ocr_image`

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `image` | string | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"texts": {"type": "array", "description": "识别出的文本块", "items": {"type": "object", "properties": {"text": {"type": "string", "description": "文本内容"}, "confidence": {"typ`

**Examples**:

```json
[
  {
    "summary": "OCR 图片（服务端，需图片 URL 或已缓存的图片 file_id）",
    "params": {
      "image": "https://example.com/image.png"
    },
    "notes": "替换为实际可访问的图片地址或已缓存图片标识；不支持本地路径和 base64。"
  }
]
```

### `rename_flash_file`

Rename a flash-transfer file

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `fileset_id` | string | Yes |  |
| `new_name` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "重命名闪传文件",
    "params": {
      "fileset_id": "<fileset-id>",
      "new_name": "新资料包"
    },
    "notes": "fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。"
  }
]
```

### `request_decrypt_key`

Request the database decryption key

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `db_path` | string | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"db_key": {"type": "string", "description": "数据库密钥，敏感信息"}}, "required": ["db_key"]}`

**Examples**:

```json
[
  {
    "summary": "请求数据库解密密钥",
    "params": {
      "db_path": "/path/to/account/nt_msg.db"
    },
    "notes": "路径位于 Haizakura 服务端，必须指向当前账号可用的数据库；返回值是敏感密钥。"
  }
]
```

### `send_ark_share`

Share a user/group Ark card (NapCat standard name)

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | No |  |
| `group_id` | uint | No |  |
| `phone_number` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"arkMsg": {"type": "string", "description": "Ark 卡片 JSON 字符串"}}, "required": ["arkMsg"]}`

**Examples**:

```json
[
  {
    "summary": "分享用户/群 Ark 卡片（NapCat 标准名）",
    "params": {
      "user_id": 10001
    },
    "notes": "生成联系人分享卡片；返回卡片数据，不等同于发送到聊天。"
  }
]
```

### `send_flash_msg`

Send a flash-transfer message (private or group; reference fileset_id so the peer can download)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `fileset_id` | string | Yes |  |
| `user_id` | uint | No |  |
| `group_id` | uint | No |  |

**Returns schema**: `{"type": "object", "properties": {"message_id": {"const": 0, "description": "闪传分享不返回普通消息 ID，0 是占位值，不能用于查询或撤回"}}, "required": ["message_id"]}`

**Examples**:

```json
[
  {
    "summary": "发送闪传消息（私聊或群聊，引用 fileset_id 让对端下载）",
    "params": {
      "fileset_id": "<fileset-id>",
      "user_id": 10001
    },
    "notes": "fileset_id 来自 create_flash_task、get_fileset_id 或 list_filesets，替换为当前账号可访问的文件集。 会发送分享消息；message_id=0 是占位值，不能用于撤回或查消息。"
  }
]
```

### `send_forward_msg`

Send a combined forward (routing automatically by message_type/group number)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `messages` | message | No |  |
| `message` | message | No |  |
| `message_type` | string | No |  |
| `group_id` | int | No |  |
| `user_id` | int | No |  |
| `source` | string | No |  |
| `summary` | string | No |  |
| `prompt` | string | No |  |
| `news` | raw | No |  |

**Returns schema**: `{"type": "object", "properties": {"message_id": {"anyOf": [{"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}, {"cons`

**Examples**:

```json
[
  {
    "summary": "发送合并转发（按 message_type/群号自动路由）",
    "params": {
      "group_id": 20001,
      "messages": [
        {
          "type": "node",
          "data": {
            "user_id": 10001,
            "nickname": "示例用户",
            "content": [
              {
                "type": "text",
                "data": {
                  "text": "转发内容"
                }
              }
            ]
          }
        }
      ]
    },
    "notes": "替换目标群号；nodes 是自定义转发节点数组。send_forward_msg 不提供目标时仅上传资源并返回 message_id=0。"
  }
]
```

### `send_group_ai_record`

Send AI voice to a group

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `character` | string | Yes |  |
| `text` | string | Yes |  |
| `chat_type` | int | No |  |

**Returns schema**: `{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**Examples**:

```json
[
  {
    "summary": "发送 AI 语音到群",
    "params": {
      "group_id": 20001,
      "character": "<character-id-from-get_ai_characters>",
      "text": "你好",
      "chat_type": 1
    },
    "notes": "character 原样使用 get_ai_characters 的 character_id；send_group_ai_record 会直接发送语音。"
  }
]
```

### `send_group_ark_share`

Share a group Ark card (NapCat standard name)

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |

**Returns schema**: `{"type": "string", "description": "群 Ark 卡片 JSON 字符串"}`

**Examples**:

```json
[
  {
    "summary": "分享群 Ark 卡片（NapCat 标准名）",
    "params": {
      "group_id": 20001
    },
    "notes": "生成群分享卡片；返回卡片数据，不等同于发送到聊天。"
  }
]
```

### `send_group_forward_msg`

Send a group combined forward

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `messages` | message | No |  |
| `message` | message | No |  |
| `source` | string | No |  |
| `summary` | string | No |  |
| `prompt` | string | No |  |
| `news` | raw | No |  |

**Returns schema**: `{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}, "res_id": {"type"`

**Examples**:

```json
[
  {
    "summary": "发送群合并转发",
    "params": {
      "group_id": 20001,
      "messages": [
        {
          "type": "node",
          "data": {
            "user_id": 10001,
            "nickname": "示例用户",
            "content": [
              {
                "type": "text",
                "data": {
                  "text": "转发内容"
                }
              }
            ]
          }
        }
      ]
    },
    "notes": "替换目标群号；nodes 是自定义转发节点数组。send_forward_msg 不提供目标时仅上传资源并返回 message_id=0。"
  }
]
```

### `send_like`

Send a like

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | Yes |  |
| `times` | int | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "点赞",
    "params": {
      "user_id": 10001,
      "times": 1
    }
  }
]
```

### `send_packet`

Send a raw SSO packet (cmd + hex data)

**Aliases**: `.send_packet`

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cmd` | string | Yes |  |
| `data` | string | No |  |
| `rsp` | bool | No |  |

**Returns schema**: `{"anyOf": [{"type": "string", "description": "rsp=true 时返回的十六进制响应正文"}, {"type": "null", "description": "rsp=false 时不等待响应，data 为 null"}]}`

**Examples**:

```json
[
  {
    "summary": "发送原始 SSO 包（cmd + hex data）",
    "params": {
      "cmd": "<command-from-validated-request>",
      "data": "<hex-encoded-request>",
      "rsp": true
    },
    "notes": "仅供有协议经验的调用方：cmd 和 data 必须成对替换为已验证的命令与十六进制请求；示例占位符不可直接发送。"
  }
]
```

### `send_poke`

Poke (routing automatically between group and private)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | Yes |  |
| `group_id` | uint | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "拍一拍（群聊/私聊自动路由）",
    "params": {
      "group_id": 20001,
      "user_id": 10001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `send_private_forward_msg`

Send a private combined forward

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | Yes |  |
| `messages` | message | No |  |
| `message` | message | No |  |
| `source` | string | No |  |
| `summary` | string | No |  |
| `prompt` | string | No |  |
| `news` | raw | No |  |

**Returns schema**: `{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}, "res_id": {"type"`

**Examples**:

```json
[
  {
    "summary": "发送私聊合并转发",
    "params": {
      "user_id": 10001,
      "messages": [
        {
          "type": "node",
          "data": {
            "user_id": 10001,
            "nickname": "示例用户",
            "content": [
              {
                "type": "text",
                "data": {
                  "text": "转发内容"
                }
              }
            ]
          }
        }
      ]
    },
    "notes": "替换目标好友 QQ 号。"
  }
]
```

### `send_tuwen_ark`

Send a text-with-images Ark card (private/group)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | No |  |
| `group_id` | uint | No |  |
| `title` | string | Yes |  |
| `desc` | string | Yes |  |
| `summary` | string | No |  |
| `preview_url` | string | No |  |
| `jump_url` | string | Yes |  |

**Returns schema**: `{"type": "null"}`

**Examples**:

```json
[
  {
    "summary": "发送图文 Ark 卡片（私聊/群聊）",
    "params": {
      "group_id": 20001,
      "title": "学习资料",
      "desc": "本周课程资料",
      "jump_url": "https://example.com/course",
      "preview_url": "https://example.com/cover.png"
    },
    "notes": "替换目标群号及实际链接；会发送分享卡片。"
  }
]
```

### `set_diy_online_status`

Set a custom online status

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `face_id` | int | Yes |  |
| `face_type` | int | No |  |
| `wording` | string | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置自定义在线状态",
    "params": {
      "face_id": 14,
      "face_type": 1,
      "wording": "学习中"
    }
  }
]
```

### `set_doubt_friends_add_request`

Handle a suspicious friend request

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `flag` | string | Yes |  |
| `approve` | bool | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "处理可疑好友申请",
    "params": {
      "flag": "<uid-from-doubt-request>",
      "approve": true
    },
    "notes": "flag 使用 get_doubt_friends_add_request 返回项的 uid。"
  }
]
```

### `set_essence_msg`

Set an essence message

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | messageId | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置精华消息",
    "params": {
      "message_id": -123456
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。"
  }
]
```

### `set_friend_remark`

Set a friend remark

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | Yes |  |
| `remark` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置好友备注",
    "params": {
      "user_id": 10001,
      "remark": "同学"
    }
  }
]
```

### `set_friends_category`

Move friends to a given category

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `uin` | uint | Yes |  |
| `categoryId` | int | No |  |
| `categoryName` | string | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "移动好友到指定分组",
    "params": {
      "uin": 10001,
      "categoryName": "同学"
    },
    "notes": "categoryId 与 categoryName 二选一。"
  }
]
```

**Constraints**: ["exactly one of: categoryId | categoryName"]

### `set_group_reaction`

Group chat emoji reaction

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | No |  |
| `message_id` | messageId | Yes |  |
| `code` | string | Yes |  |
| `is_set` | bool | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "群聊表情回应",
    "params": {
      "message_id": -123456,
      "group_id": 20001,
      "code": "128077",
      "is_set": true
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。"
  }
]
```

### `set_group_remark`

Set a group remark

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `remark` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置群备注",
    "params": {
      "group_id": 20001,
      "remark": "学习小组"
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `set_group_robot_add_option`

Set the group bot join options

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `robot_member_switch` | int | No |  |
| `robot_member_examine` | int | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置群机器人加群选项",
    "params": {
      "group_id": 20001,
      "robot_member_switch": 1,
      "robot_member_examine": 1
    },
    "notes": "替换群号和成员 QQ 号；操作是否允许取决于当前账号在该群的权限。"
  }
]
```

### `set_group_sign`

Group check-in

**Aliases**: `send_group_sign`

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |

**Returns schema**: `{"type": "object", "properties": {}, "additionalProperties": false, "description": "成功时为空对象 {}，不是 null"}`

**Examples**:

```json
[
  {
    "summary": "群签到",
    "params": {
      "group_id": 20001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `set_group_todo`

Set a group to-do

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `message_id` | messageId | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置群待办",
    "params": {
      "group_id": 20001,
      "message_id": -123456
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。 必须是该群的消息。"
  }
]
```

### `set_input_status`

Set the input status

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | Yes |  |
| `event_type` | int | No |  |

**Returns schema**: `{"type": "object", "properties": {}, "additionalProperties": false, "description": "成功时为空对象 {}，不是 null"}`

**Examples**:

```json
[
  {
    "summary": "设置输入状态",
    "params": {
      "user_id": 10001,
      "event_type": 0
    }
  }
]
```

### `set_msg_emoji_like`

Set a message emoji reaction

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `message_id` | messageId | Yes |  |
| `emoji_id` | string | Yes |  |
| `set` | bool | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置消息表情回应",
    "params": {
      "message_id": -123456,
      "emoji_id": "128077",
      "set": true
    },
    "notes": "使用消息事件或发送结果中的真实 message_id，负值合法；消息须在当前账号的消息存储中可查询。"
  }
]
```

### `set_online_status`

Set the online status

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `status` | int | Yes |  |
| `ext_status` | int | No |  |
| `battery_status` | int | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置在线状态",
    "params": {
      "status": 11,
      "ext_status": 0,
      "battery_status": 100
    },
    "notes": "修改当前账号状态；具体状态码须与目标状态对应。"
  }
]
```

### `set_qq_avatar`

Set the QQ avatar

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置 QQ 头像",
    "params": {
      "file": "file:///path/to/avatar.png"
    },
    "notes": "示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。"
  }
]
```

### `set_qq_profile`

Set the QQ profile

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `nickname` | string | No |  |
| `personal_note` | string | No |  |
| `sex` | int | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "设置 QQ 资料",
    "params": {
      "nickname": "示例昵称"
    },
    "notes": "会修改当前账号的资料；只传入需要修改的字段。"
  }
]
```

### `set_restart`

Restart (unsupported)

**Returns schema**: `{"not": {}, "description": "当前始终返回失败，没有成功 data；失败响应 data 为 null，原因见 wording"}`

**Examples**:

```json
[
  {
    "summary": "重启（不支持）",
    "params": {},
    "notes": "当前未实现，调用返回失败；不要将其当作可用能力。"
  }
]
```

### `set_self_longnick`

Set the personal signature (longNick/long_nick, strictly string)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `longNick` | string | No |  |
| `long_nick` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {}, "additionalProperties": false, "description": "成功时为空对象 {}，不是 null"}`

**Examples**:

```json
[
  {
    "summary": "设置个性签名（longNick/long_nick，严格 string）",
    "params": {
      "long_nick": "学习中"
    }
  }
]
```

### `share_group_ex`

Share a group Ark card

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |

**Returns schema**: `{"type": "string", "description": "群 Ark 卡片 JSON 字符串"}`

**Examples**:

```json
[
  {
    "summary": "分享群 Ark 卡片",
    "params": {
      "group_id": 20001
    },
    "notes": "生成群分享卡片；返回卡片数据，不等同于发送到聊天。"
  }
]
```

### `share_peer`

Share a user/group Ark card

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | No |  |
| `group_id` | uint | No |  |
| `phone_number` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"arkMsg": {"type": "string", "description": "Ark 卡片 JSON 字符串"}}, "required": ["arkMsg"]}`

**Examples**:

```json
[
  {
    "summary": "分享用户/群 Ark 卡片",
    "params": {
      "user_id": 10001
    },
    "notes": "生成联系人分享卡片；返回卡片数据，不等同于发送到聊天。"
  }
]
```

### `trans_group_file`

Save a copy of a group file

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `file_id` | string | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"ok": {"const": true}}, "required": ["ok"]}`

**Examples**:

```json
[
  {
    "summary": "转存群文件",
    "params": {
      "group_id": 20001,
      "file_id": "<file-id-from-get_group_root_files>"
    },
    "notes": "替换群文件列表中的实际 file_id；需要对应文件操作权限。"
  }
]
```

### `translate_en2zh`

Translate English to Chinese

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `words` | string[] | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"words": {"type": "array", "description": "译文数组", "items": {"type": "string"}}}, "required": ["words"]}`

**Examples**:

```json
[
  {
    "summary": "英译中",
    "params": {
      "words": [
        "Hello"
      ]
    }
  }
]
```

### `upload_forward_msg`

Upload a forward message

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `messages` | message | No |  |
| `message` | message | No |  |
| `group_id` | uint | No |  |

**Returns schema**: `{"type": "object", "properties": {"res_id": {"type": "string"}, "forward_id": {"type": "string"}, "message_id": {"const": 0, "description": "仅上传资源，不代表已发送消息；0 不能用于消息查询或撤回"}, "group_id": {"type": "integ`

**Examples**:

```json
[
  {
    "summary": "上传转发消息",
    "params": {
      "group_id": 20001,
      "messages": [
        {
          "type": "node",
          "data": {
            "user_id": 10001,
            "nickname": "示例用户",
            "content": [
              {
                "type": "text",
                "data": {
                  "text": "转发内容"
                }
              }
            ]
          }
        }
      ]
    },
    "notes": "仅上传合并转发资源，不发送聊天消息；message_id=0 是占位值，后续使用 res_id。"
  }
]
```

### `upload_foward_msg`

Upload a forward message (alias spelling)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `messages` | message | No |  |
| `message` | message | No |  |
| `group_id` | uint | No |  |

**Returns schema**: `{"type": "object", "properties": {"res_id": {"type": "string"}, "forward_id": {"type": "string"}, "message_id": {"const": 0, "description": "仅上传资源，不代表已发送消息；0 不能用于消息查询或撤回"}}, "required": ["res_id", "fo`

**Examples**:

```json
[
  {
    "summary": "上传转发消息（别名拼写）",
    "params": {
      "messages": [
        {
          "type": "node",
          "data": {
            "user_id": 10001,
            "nickname": "示例用户",
            "content": [
              {
                "type": "text",
                "data": {
                  "text": "转发内容"
                }
              }
            ]
          }
        }
      ]
    },
    "notes": "历史拼写兼容接口，仅上传资源；message_id=0，返回值没有 group_id。"
  }
]
```

## Group albums (9)

### `cancel_group_album_media_like`

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `album_id` | string | Yes |  |
| `batch_id` | string | Yes |  |
| `lloc` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"id": {"type": ["string", "null"]}, "status": {"type": ["integer", "null"]}}}`

**Examples**:

```json
[
  {
    "summary": "基本调用",
    "params": {
      "group_id": 20001,
      "album_id": "<album-id>",
      "batch_id": "1700000000"
    },
    "notes": "album_id 来自 get_group_album_list；lloc 或视频 id、batch_id 来自 get_group_album_media_list。替换群号及对应资源标识。 batch_id 必须是实际批次的十进制字符串。"
  }
]
```

### `del_group_album_media`

Delete a group album image or video

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `album_id` | string | Yes |  |
| `lloc` | string | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"success": {"const": true}}, "required": ["success"]}`

**Examples**:

```json
[
  {
    "summary": "删除群相册图片或视频",
    "params": {
      "group_id": 20001,
      "album_id": "<album-id>",
      "lloc": "<media-lloc-or-video-id>"
    },
    "notes": "album_id 来自 get_group_album_list；lloc 或视频 id、batch_id 来自 get_group_album_media_list。替换群号及对应资源标识。"
  }
]
```

### `do_group_album_comment`

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `album_id` | string | Yes |  |
| `lloc` | string | Yes |  |
| `content` | string | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"id": {"type": "string"}, "user": {"type": "object", "properties": {"uin": {"type": "string"}}, "required": ["uin"]}, "content": {"type": "array", "items": {"type": "`

**Examples**:

```json
[
  {
    "summary": "基本调用",
    "params": {
      "group_id": 20001,
      "album_id": "<album-id>",
      "lloc": "<media-lloc-or-video-id>",
      "content": "拍得很好"
    },
    "notes": "album_id 来自 get_group_album_list；lloc 或视频 id、batch_id 来自 get_group_album_media_list。替换群号及对应资源标识。"
  }
]
```

### `get_group_album_list`

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |

**Returns schema**: `{"type": "array", "description": "群相册列表", "items": {"type": "object", "properties": {"id": {"type": "string", "description": "相册 id"}, "name": {"type": "string", "description": "相册名称"}, "picNum": {"ty`

**Examples**:

```json
[
  {
    "summary": "基本调用",
    "params": {
      "group_id": 20001
    },
    "notes": "将 group_id 替换为当前账号可访问的群号。"
  }
]
```

### `get_group_album_media_list`

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `album_id` | string | Yes |  |
| `attach_info` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"mediaList": {"type": "array", "description": "相册图片或视频，未返回的字段可省略或为 null", "items": {"type": "object", "properties": {"type": {"type": ["integer", "null"]}, "image": {`

**Examples**:

```json
[
  {
    "summary": "基本调用",
    "params": {
      "group_id": 20001,
      "album_id": "<album-id>",
      "attach_info": ""
    },
    "notes": "album_id 来自 get_group_album_list；lloc 或视频 id、batch_id 来自 get_group_album_media_list。替换群号及对应资源标识。 下一页传回 nextAttachInfo。"
  }
]
```

### `get_qun_album_list`

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `attach_info` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"album_list": {"type": "array", "description": "相册列表", "items": {"type": "object", "properties": {"album_id": {"type": "string", "description": "相册 id"}, "name": {"ty`

**Examples**:

```json
[
  {
    "summary": "基本调用",
    "params": {
      "group_id": 20001,
      "attach_info": ""
    },
    "notes": "后续页原样传回上一页的 attach_info；has_more=false 表示结束。"
  }
]
```

### `set_group_album_media_like`

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `album_id` | string | Yes |  |
| `batch_id` | string | Yes |  |
| `lloc` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"id": {"type": ["string", "null"]}, "status": {"type": ["integer", "null"]}}}`

**Examples**:

```json
[
  {
    "summary": "基本调用",
    "params": {
      "group_id": 20001,
      "album_id": "<album-id>",
      "batch_id": "1700000000"
    },
    "notes": "album_id 来自 get_group_album_list；lloc 或视频 id、batch_id 来自 get_group_album_media_list。替换群号及对应资源标识。 batch_id 必须是实际批次的十进制字符串。"
  }
]
```

### `upload_image_to_qun_album`

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `album_id` | string | Yes |  |
| `album_name` | string | Yes |  |
| `file` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "基本调用",
    "params": {
      "group_id": 20001,
      "album_id": "<album-id>",
      "album_name": "活动照片",
      "file": "file:///path/to/photo.png"
    },
    "notes": "album_id 来自 get_group_album_list；lloc 或视频 id、batch_id 来自 get_group_album_media_list。替换群号及对应资源标识。 示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。"
  }
]
```

### `upload_video_to_qun_album`

Upload a video to a group album

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group_id` | uint | Yes |  |
| `album_id` | string | Yes |  |
| `album_name` | string | Yes |  |
| `file` | string | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"id": {"type": "string", "description": "视频 id"}}, "required": ["id"]}`

**Examples**:

```json
[
  {
    "summary": "上传视频到群相册",
    "params": {
      "group_id": 20001,
      "album_id": "<album-id>",
      "album_name": "活动视频",
      "file": "file:///path/to/video.mp4"
    },
    "notes": "album_id 来自 get_group_album_list；lloc 或视频 id、batch_id 来自 get_group_album_media_list。替换群号及对应资源标识。 示例路径位于 Haizakura 服务端，须替换为该服务可读取的实际文件。"
  }
]
```

## Qzone (29)

### `comment_qzone`

Comment on a post or reply to a given comment (plain comments may include images; nested replies are text only)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tid` | string | Yes |  |
| `content` | string | Yes |  |
| `target_uin` | uint | No |  |
| `comment_id` | string | No |  |
| `comment_uin` | uint | No |  |
| `reply_uin` | uint | No |  |
| `reply_name` | string | No |  |
| `images` | string[] | No |  |

**Returns schema**: `{"type": "object", "properties": {"comment_id": {"type": "string", "description": "新评论或新回复的 ID；普通评论未返回 ID 时为空串，楼中楼回复不会用父编号代替"}, "parent_comment_id": {"type": "string", "description": "仅楼中楼回复返回，所属一级评论 `

**Examples**:

```json
[
  {
    "summary": "评论一条说说（QQ 空间，支持纯文字或带图；传 images 自动上传）",
    "params": {
      "tid": "<tid-from-get_qzone_msg_list>",
      "target_uin": 10001,
      "content": "感谢分享"
    },
    "notes": "tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。"
  },
  {
    "summary": "回复指定一级评论，保留说说所属账号",
    "params": {
      "tid": "<tid-from-get_qzone_msg_detail>",
      "target_uin": 10001,
      "content": "感谢回复",
      "comment_id": "0",
      "comment_uin": 10002
    },
    "notes": "comment_id 和 comment_uin 分别取 get_qzone_msg_detail 的一级评论 comment_id 和 uin；编号 0 有效。楼中楼仅支持文字。"
  },
  {
    "summary": "回复楼中楼中的某位评论者",
    "params": {
      "tid": "<tid-from-get_qzone_msg_detail>",
      "target_uin": 10001,
      "content": "我也这么认为",
      "comment_id": "0",
      "comment_uin": 10002,
      "reply_uin": 10003
```

**Constraints**: ["all or none of: comment_id, comment_uin", "all or none of: reply_uin, reply_name", "reply_uin/reply_name require comment_id/comment_uin", "images are not supported for comment replies", "comment_id, reply_name and reply content must not be blank", "comment_uin and reply_uin must be safe integers"]

### `comment_qzone_public_feed`

Comment on a recommended feed (plain text or upstream rich-text items)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `feed` | object | Yes |  |
| `content` | string | object[] | 是 |  |

**Returns schema**: `{"type": "object", "additionalProperties": true}`

**Examples**:

```json
[
  {
    "summary": "评论推荐动态",
    "params": {
      "feed": {
        "cell_common": {
          "union_id": {
            "uf_key": "<uf_key-from-get_qzone_public_feeds>",
            "ugc_id": "<ugc_id>",
            "feed_id": "<feed_id>",
            "ext_ids": []
          },
          "cur_like_key": "<like-key>",
          "domain_type": 3
        },
        "cell_feed_transfer": {},
        "cell_user_info": {
          "user": {
            "uin": "10001",
            "uid": "<uid>",
            "nick": "<nick>"
          }
        }
      },
      "content": "感谢分享"
    },
    "notes": "feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。"
  }
]
```

### `delete_qzone_msg`

Delete one post (Qzone, by tid)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tid` | string | Yes |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "删除一条说说（QQ 空间，按 tid）",
    "params": {
      "tid": "<tid-from-get_qzone_msg_list>"
    },
    "notes": "tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。"
  }
]
```

### `delete_qzone_public_comment`

Delete one comment on a recommended feed (permission required)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `feed` | object | Yes |  |
| `comment` | object | Yes |  |

**Returns schema**: `{"type": "object", "additionalProperties": true}`

**Examples**:

```json
[
  {
    "summary": "删除一条评论",
    "params": {
      "feed": {
        "cell_common": {
          "union_id": {
            "uf_key": "<uf_key-from-get_qzone_public_feeds>",
            "ugc_id": "<ugc_id>",
            "feed_id": "<feed_id>",
            "ext_ids": []
          },
          "cur_like_key": "<like-key>",
          "domain_type": 3
        },
        "cell_feed_transfer": {},
        "cell_user_info": {
          "user": {
            "uin": "10001",
            "uid": "<uid>",
            "nick": "<nick>"
          }
        }
      },
      "comment": {
        "id": "<comment-id-from-detail-or-comments>",
        "user": {
          "uin": "<uin>",
          "uid": "<uid>",
          "nick": "<nick>"
        },
        "like": {
          "id": "<like-id-from-comment>",

```

### `delete_qzone_public_reply`

Delete one reply under a recommended feed comment (permission required)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `feed` | object | Yes |  |
| `comment` | object | Yes |  |
| `reply` | object | Yes |  |

**Returns schema**: `{"type": "object", "additionalProperties": true}`

**Examples**:

```json
[
  {
    "summary": "删除一条回复",
    "params": {
      "feed": {
        "cell_common": {
          "union_id": {
            "uf_key": "<uf_key-from-get_qzone_public_feeds>",
            "ugc_id": "<ugc_id>",
            "feed_id": "<feed_id>",
            "ext_ids": []
          },
          "cur_like_key": "<like-key>",
          "domain_type": 3
        },
        "cell_feed_transfer": {},
        "cell_user_info": {
          "user": {
            "uin": "10001",
            "uid": "<uid>",
            "nick": "<nick>"
          }
        }
      },
      "comment": {
        "id": "<comment-id-from-detail-or-comments>",
        "user": {
          "uin": "<uin>",
          "uid": "<uid>",
          "nick": "<nick>"
        },
        "like": {
          "id": "<like-id-from-comment>",

```

### `forward_qzone_public_feed`

Forward a recommended feed to the current account's Qzone

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `feed` | object | Yes |  |
| `reason` | string | No |  |

**Returns schema**: `{"type": "object", "additionalProperties": true}`

**Examples**:

```json
[
  {
    "summary": "转发推荐动态到我的空间",
    "params": {
      "feed": {
        "cell_common": {
          "union_id": {
            "uf_key": "<uf_key-from-get_qzone_public_feeds>",
            "ugc_id": "<ugc_id>",
            "feed_id": "<feed_id>",
            "ext_ids": []
          },
          "cur_like_key": "<like-key>",
          "domain_type": 3
        },
        "cell_feed_transfer": {},
        "cell_user_info": {
          "user": {
            "uin": "10001",
            "uid": "<uid>",
            "nick": "<nick>"
          }
        }
      },
      "reason": "分享这条动态"
    },
    "notes": "feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。 只转发，不同时评论或发送给 QQ 联系人。"
  }
]
```

### `get_qzone_feed_detail`

Read a full Qzone feed by post tid (usable for generating share cards)

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tid` | string | Yes |  |

**Returns schema**: `{"type": "object", "additionalProperties": true, "properties": {"feed": {"type": "object", "additionalProperties": true, "description": "去除上游包装后的完整动态，可原样传给 get_qzone_share_ark"}, "attach_info": {"type`

**Examples**:

```json
[
  {
    "summary": "按说说编号获取完整动态",
    "params": {
      "tid": "1127000000f1536501000000"
    },
    "notes": "将示例 tid 替换为 get_qzone_msg_list 或 send_qzone_msg 返回的 24 位十六进制说说编号。把结果的 feed 原样传给 get_qzone_share_ark；读取和分享均受空间权限限制。"
  }
]
```

**Constraints**: ["tid must be a 24-character hexadecimal post ID"]

### `get_qzone_feeds`

Get Qzone friend feeds (structured text and cursor pagination supported)

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `page_num` | int | No |  |
| `count` | int | No |  |
| `cursor` | string | No |  |

**Returns schema**: `{"type": "object", "properties": {"feeds": {"type": "array", "description": "本页好友动态数组", "items": {"type": "object", "properties": {"uin": {"type": "integer", "description": "动态作者 QQ 号"}, "nickname": {`

**Examples**:

```json
[
  {
    "summary": "获取 QQ 空间好友动态首页及结构化内容",
    "params": {
      "page_num": 1,
      "count": 10
    },
    "notes": "保留 html；content/images 为可提取的正文和图片，未知值为 null。续页使用 next_cursor。"
  },
  {
    "summary": "继续读取上一页之后的好友动态",
    "params": {
      "cursor": "<next_cursor-from-get_qzone_feeds>",
      "count": 10
    },
    "notes": "cursor 原样使用上次返回的 next_cursor，仅适用于同一账号；has_more=false 时停止。"
  }
]
```

### `get_qzone_home_feeds`

Read your own Qzone home feeds, or those you have access to, keeping full share info

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `target_uin` | uint | No |  |
| `cursor` | string | No |  |

**Returns schema**: `{"type": "object", "additionalProperties": true, "properties": {"feeds": {"type": "array", "items": {"type": "object", "additionalProperties": true}, "description": "完整动态，可原样传给 get_qzone_share_ark"}, `

**Examples**:

```json
[
  {
    "summary": "读取自己的主页动态",
    "params": {}
  },
  {
    "summary": "继续读取同一主页",
    "params": {
      "target_uin": 10001,
      "cursor": "<next_cursor-from-get_qzone_home_feeds>"
    }
  }
]
```

### `get_qzone_msg_detail`

Get Qzone post details and one page of comments (including server-side inline replies; access permission required)

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tid` | string | Yes |  |
| `target_uin` | uint | No |  |
| `pos` | int | No |  |
| `num` | int | No |  |

**Returns schema**: `{"type": "object", "properties": {"tid": {"type": "string", "description": "说说 ID"}, "content": {"type": "string", "description": "说说正文"}, "comment_num": {"type": "integer", "description": "服务端报告的评论总数`

**Examples**:

```json
[
  {
    "summary": "获取 QQ 空间说说详情与一页评论（含服务端内联回复，需有访问权限）",
    "params": {
      "tid": "<tid-from-get_qzone_msg_list>",
      "pos": 0,
      "num": 20
    },
    "notes": "tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。 replies 仅为服务端内联回复，不保证完整。"
  }
]
```

### `get_qzone_msg_list`

Get the Qzone post list (defaults to the bot's own Qzone)

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `target_uin` | uint | No |  |
| `pos` | int | No |  |
| `num` | int | No |  |

**Returns schema**: `{"type": "object", "properties": {"total": {"type": "integer", "description": "账号说说总数（非本页数量）"}, "msglist": {"type": "array", "description": "本页说说数组", "items": {"type": "object", "properties": {"tid": `

**Examples**:

```json
[
  {
    "summary": "获取 QQ 空间说说列表（默认机器人自己的空间）",
    "params": {
      "pos": 0,
      "num": 20
    },
    "notes": "默认读取当前账号；指定 target_uin 时需有访问权限。"
  }
]
```

### `get_qzone_profile`

Get the Qzone name and description (defaults to the current account)

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `target_uin` | uint | No |  |

**Returns schema**: `{"type": "object", "properties": {"name": {"type": "string", "description": "空间名称"}, "description": {"type": "string", "description": "空间说明"}}, "required": ["name", "description"]}`

**Examples**:

```json
[
  {
    "summary": "获取当前账号的空间名称和说明",
    "params": {}
  },
  {
    "summary": "获取指定账号的空间名称和说明",
    "params": {
      "target_uin": 10001
    },
    "notes": "需要有该空间的访问权限。"
  }
]
```

### `get_qzone_public_capabilities`

Read the current account’s Kongyou-aikan entry point and upvote permission

**Attributes**: read-only

**Returns schema**: `{"type": "object", "additionalProperties": true}`

**Examples**:

```json
[
  {
    "summary": "查询当前账号是否有空友爱看入口及推能力",
    "params": {}
  }
]
```

### `get_qzone_public_comments`

Continue reading recommended-feed comments

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `feed` | object | Yes |  |
| `cursor` | string | Yes |  |

**Returns schema**: `{"type": "object", "additionalProperties": true}`

**Examples**:

```json
[
  {
    "summary": "读取详情之后的下一页评论",
    "params": {
      "feed": {
        "cell_common": {
          "union_id": {
            "uf_key": "<uf_key-from-get_qzone_public_feeds>",
            "ugc_id": "<ugc_id>",
            "feed_id": "<feed_id>",
            "ext_ids": []
          },
          "cur_like_key": "<like-key>",
          "domain_type": 3
        },
        "cell_feed_transfer": {},
        "cell_user_info": {
          "user": {
            "uin": "10001",
            "uid": "<uid>",
            "nick": "<nick>"
          }
        }
      },
      "cursor": "<attach_info-from-detail-or-comments>"
    },
    "notes": "feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。 先读详情获取初始评论及 attach_info，再原样传入 cursor。"
  }
]
```

### `get_qzone_public_feed_detail`

Read the details and initial comments of a recommended feed

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `feed` | object | Yes |  |

**Returns schema**: `{"type": "object", "additionalProperties": true}`

**Examples**:

```json
[
  {
    "summary": "读取推荐动态详情",
    "params": {
      "feed": {
        "cell_common": {
          "union_id": {
            "uf_key": "<uf_key-from-get_qzone_public_feeds>",
            "ugc_id": "<ugc_id>",
            "feed_id": "<feed_id>",
            "ext_ids": []
          },
          "cur_like_key": "<like-key>",
          "domain_type": 3
        },
        "cell_feed_transfer": {},
        "cell_user_info": {
          "user": {
            "uin": "10001",
            "uid": "<uid>",
            "nick": "<nick>"
          }
        }
      }
    },
    "notes": "feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。"
  }
]
```

### `get_qzone_public_feeds`

Read Kongyou-aikan recommended feeds (independent cursor pagination supported)

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cursor` | string | No |  |

**Returns schema**: `{"type": "object", "additionalProperties": true, "properties": {"feeds": {"type": "array", "items": {"type": "object", "additionalProperties": true}, "description": "原始动态 cell 对象，后续详情和互动需原样传入"}, "has_`

**Examples**:

```json
[
  {
    "summary": "读取空友爱看推荐首页",
    "params": {}
  },
  {
    "summary": "继续读取推荐动态",
    "params": {
      "cursor": "<next_cursor-from-get_qzone_public_feeds>"
    },
    "notes": "cursor 原样使用上次返回的 next_cursor，仅适用于同一账号；has_more=false 时停止。"
  }
]
```

### `get_qzone_public_replies`

Continue reading replies to a given comment

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `feed` | object | Yes |  |
| `comment` | object | Yes |  |
| `cursor` | string | No |  |
| `page_size` | int | No |  |

**Returns schema**: `{"type": "object", "additionalProperties": true}`

**Examples**:

```json
[
  {
    "summary": "读取某条评论的后续回复",
    "params": {
      "feed": {
        "cell_common": {
          "union_id": {
            "uf_key": "<uf_key-from-get_qzone_public_feeds>",
            "ugc_id": "<ugc_id>",
            "feed_id": "<feed_id>",
            "ext_ids": []
          },
          "cur_like_key": "<like-key>",
          "domain_type": 3
        },
        "cell_feed_transfer": {},
        "cell_user_info": {
          "user": {
            "uin": "10001",
            "uid": "<uid>",
            "nick": "<nick>"
          }
        }
      },
      "comment": {
        "id": "<comment-id-from-detail-or-comments>",
        "user": {
          "uin": "<uin>",
          "uid": "<uid>",
          "nick": "<nick>"
        },
        "like": {
          "id": "<like-id-from-commen
```

### `get_qzone_share_ark`

Generate a Qzone feed share card and return the original text with a share hint

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `feed` | object | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"ark": {"type": "string", "description": "卡片原文，直接作为 JSON 消息的 data"}, "requires_confirmation": {"type": "boolean", "description": "上游要求发送前确认分享提示"}, "notice": {"type": `

**Examples**:

```json
[
  {
    "summary": "生成卡片后通过 JSON 消息发送",
    "params": {
      "feed": {
        "cell_common": {
          "union_id": {
            "uf_key": "<uf_key-from-get_qzone_public_feeds>",
            "ugc_id": "<ugc_id>",
            "feed_id": "<feed_id>",
            "ext_ids": []
          },
          "cur_like_key": "<like-key>",
          "domain_type": 3
        },
        "cell_feed_transfer": "<original-cell_feed_transfer>",
        "cell_user_info": {
          "user": {
            "uin": "10001",
            "uid": "<uid>",
            "nick": "<nick>"
          }
        },
        "cell_operation": {
          "share_outside": {
            "share_access_resource": {
              "busi_id": "<original-busi_id>",
              "resource_id": "<original-resource_id>"
            
```

### `like_qzone`

Like a post (Qzone)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tid` | string | Yes |  |
| `target_uin` | uint | No |  |
| `abstime` | int | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "给一条说说点赞（QQ 空间）",
    "params": {
      "tid": "<tid-from-get_qzone_msg_list>",
      "target_uin": 10001
    },
    "notes": "tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。"
  }
]
```

### `reply_qzone_public_feed`

Reply to a recommended feed comment or to one of its replies

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `feed` | object | Yes |  |
| `comment` | object | Yes |  |
| `content` | string | object[] | 是 |  |
| `reply` | object | No |  |

**Returns schema**: `{"type": "object", "additionalProperties": true}`

**Examples**:

```json
[
  {
    "summary": "回复一条评论",
    "params": {
      "feed": {
        "cell_common": {
          "union_id": {
            "uf_key": "<uf_key-from-get_qzone_public_feeds>",
            "ugc_id": "<ugc_id>",
            "feed_id": "<feed_id>",
            "ext_ids": []
          },
          "cur_like_key": "<like-key>",
          "domain_type": 3
        },
        "cell_feed_transfer": {},
        "cell_user_info": {
          "user": {
            "uin": "10001",
            "uid": "<uid>",
            "nick": "<nick>"
          }
        }
      },
      "comment": {
        "id": "<comment-id-from-detail-or-comments>",
        "user": {
          "uin": "<uin>",
          "uid": "<uid>",
          "nick": "<nick>"
        },
        "like": {
          "id": "<like-id-from-comment>",

```

### `send_qzone_msg`

Publish a post (Qzone; plain text or with images; passing images uploads them automatically; view permissions configurable)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `content` | string | Yes |  |
| `images` | string[] | No |  |
| `ugc_right` | int | No |  |
| `target_uins` | uint[] | No |  |

**Returns schema**: `{"type": "object", "properties": {"tid": {"type": "string"}, "time": {"type": "integer"}}, "required": ["tid", "time"]}`

**Examples**:

```json
[
  {
    "summary": "发表说说（QQ 空间，支持纯文字或带图；传 images 自动上传；可设置查看权限）",
    "params": {
      "content": "今天的学习记录",
      "ugc_right": 64
    },
    "notes": "会发布说说；ugc_right=64 仅自己可见。16/128 还必须提供 target_uins。"
  }
]
```

**Constraints**: ["ugc_right must be one of 1, 4, 16, 64, 128", "target_uins is required when ugc_right is 16 or 128"]

### `set_qzone_ban`

Block or unblock someone (modifies the bot's own Qzone blocklist; enable=true blocks, false unblocks)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user_id` | uint | Yes |  |
| `enable` | bool | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "拉黑或解除拉黑某人（修改机器人自身 QQ 空间黑名单；enable=true 拉黑，false 解除）",
    "params": {
      "user_id": 10001,
      "enable": true
    },
    "notes": "修改当前账号空间黑名单。"
  }
]
```

### `set_qzone_msg_right`

Change the view permission of a published post (Qzone, by tid)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tid` | string | Yes |  |
| `ugc_right` | int | Yes |  |
| `target_uins` | uint[] | No |  |

**Returns schema**: `{"type": "object", "properties": {"ugc_right": {"type": "integer", "description": "更新后的查看权限"}}, "required": ["ugc_right"]}`

**Examples**:

```json
[
  {
    "summary": "修改一条已发说说的查看权限（QQ 空间，按 tid）",
    "params": {
      "tid": "<tid-from-get_qzone_msg_list>",
      "ugc_right": 16,
      "target_uins": [
        10001
      ]
    },
    "notes": "tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。 16 表示仅所选好友可见。"
  }
]
```

**Constraints**: ["ugc_right must be one of 1, 4, 16, 64, 128", "target_uins is required when ugc_right is 16 or 128"]

### `set_qzone_profile`

Change the current account's Qzone name or description

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | No |  |
| `description` | string | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "修改当前账号的空间名称和说明",
    "params": {
      "name": "我的空间",
      "description": "记录日常"
    },
    "notes": "仅修改提供的字段；空字符串表示清空对应字段。"
  },
  {
    "summary": "清空当前账号的空间说明",
    "params": {
      "description": ""
    }
  }
]
```

**Constraints**: ["at least one of: name, description"]

### `set_qzone_public_comment_like`

Like or unlike a comment or reply in a recommended feed

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `feed` | object | Yes |  |
| `comment` | object | Yes |  |
| `enable` | bool | No |  |
| `reply` | object | No |  |

**Returns schema**: `{"type": "object", "additionalProperties": true}`

**Examples**:

```json
[
  {
    "summary": "点赞一条评论",
    "params": {
      "feed": {
        "cell_common": {
          "union_id": {
            "uf_key": "<uf_key-from-get_qzone_public_feeds>",
            "ugc_id": "<ugc_id>",
            "feed_id": "<feed_id>",
            "ext_ids": []
          },
          "cur_like_key": "<like-key>",
          "domain_type": 3
        },
        "cell_feed_transfer": {},
        "cell_user_info": {
          "user": {
            "uin": "10001",
            "uid": "<uid>",
            "nick": "<nick>"
          }
        }
      },
      "comment": {
        "id": "<comment-id-from-detail-or-comments>",
        "user": {
          "uin": "<uin>",
          "uid": "<uid>",
          "nick": "<nick>"
        },
        "like": {
          "id": "<like-id-from-comment>",

```

### `set_qzone_public_follow`

Follow or unfollow a recommended-feed author

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `feed` | object | Yes |  |
| `enable` | bool | No |  |

**Returns schema**: `{"type": "object", "additionalProperties": true}`

**Examples**:

```json
[
  {
    "summary": "蹲这条推荐动态的作者",
    "params": {
      "feed": {
        "cell_common": {
          "union_id": {
            "uf_key": "<uf_key-from-get_qzone_public_feeds>",
            "ugc_id": "<ugc_id>",
            "feed_id": "<feed_id>",
            "ext_ids": []
          },
          "cur_like_key": "<like-key>",
          "domain_type": 3
        },
        "cell_feed_transfer": {},
        "cell_user_info": {
          "user": {
            "uin": "10001",
            "uid": "<uid>",
            "nick": "<nick>"
          }
        }
      },
      "enable": true
    },
    "notes": "feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。 feed 需保留作者 cell_user_info。"
  }
]
```

### `set_qzone_public_like`

Like or unlike a recommended feed

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `feed` | object | Yes |  |
| `enable` | bool | No |  |

**Returns schema**: `{"type": "object", "additionalProperties": true}`

**Examples**:

```json
[
  {
    "summary": "点赞推荐动态",
    "params": {
      "feed": {
        "cell_common": {
          "union_id": {
            "uf_key": "<uf_key-from-get_qzone_public_feeds>",
            "ugc_id": "<ugc_id>",
            "feed_id": "<feed_id>",
            "ext_ids": []
          },
          "cur_like_key": "<like-key>",
          "domain_type": 3
        },
        "cell_feed_transfer": {},
        "cell_user_info": {
          "user": {
            "uin": "10001",
            "uid": "<uid>",
            "nick": "<nick>"
          }
        }
      },
      "enable": true
    },
    "notes": "feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。"
  }
]
```

### `set_qzone_public_upvote`

Upvote or un-upvote a Kongyou-aikan feed (independent of ordinary likes)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `feed` | object | Yes |  |
| `enable` | bool | No |  |

**Returns schema**: `{"type": "object", "additionalProperties": true}`

**Examples**:

```json
[
  {
    "summary": "推一条推荐动态",
    "params": {
      "feed": {
        "cell_common": {
          "union_id": {
            "uf_key": "<uf_key-from-get_qzone_public_feeds>",
            "ugc_id": "<ugc_id>",
            "feed_id": "<feed_id>",
            "ext_ids": []
          },
          "cur_like_key": "<like-key>",
          "domain_type": 3
        },
        "cell_feed_transfer": {},
        "cell_user_info": {
          "user": {
            "uin": "10001",
            "uid": "<uid>",
            "nick": "<nick>"
          }
        }
      },
      "enable": true
    },
    "notes": "feed 必须原样取自 get_qzone_public_feeds 的 feeds 数组，不能用旧说说 tid 拼造；示例中的占位字段须整体替换。"
  }
]
```

### `unlike_qzone`

Unlike a post (Qzone; the unlike endpoint awaits on-device verification)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tid` | string | Yes |  |
| `target_uin` | uint | No |  |
| `abstime` | int | No |  |

**Returns schema**: `{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**Examples**:

```json
[
  {
    "summary": "取消对一条说说的点赞（QQ 空间；取消赞端点待真机核实）",
    "params": {
      "tid": "<tid-from-get_qzone_msg_list>",
      "target_uin": 10001
    },
    "notes": "tid 来自 get_qzone_msg_list；操作需有该说说的访问或管理权限。"
  }
]
```

## System emoji (4)

### `fetch_face_entity`

Look up a QQ system emoji by number

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `face_id` | int | Yes |  |
| `refresh` | bool | No |  |

**Returns schema**: `{"anyOf": [{"type": "object", "properties": {"q_sid": {"type": "string", "description": "QQ 表情目录标识（部分 emoji 为 Unicode 表情字符串）"}, "q_des": {"type": "string", "description": "表情描述"}, "em_code": {"type": `

**Examples**:

```json
[
  {
    "summary": "按编号查询 QQ 系统表情",
    "params": {
      "face_id": 14
    }
  }
]
```

### `fetch_super_face_id`

Determine whether a QQ system emoji uses the super-emoji format

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `face_id` | int | Yes |  |
| `refresh` | bool | No |  |

**Returns schema**: `{"type": "object", "properties": {"is_super": {"type": "boolean"}}, "required": ["is_super"]}`

**Examples**:

```json
[
  {
    "summary": "判断 QQ 系统表情是否使用超级表情格式",
    "params": {
      "face_id": 14
    }
  }
]
```

### `fetch_sys_faces`

Get the QQ system emoji catalog

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `refresh` | bool | No |  |

**Returns schema**: `{"type": "object", "properties": {"packs": {"type": "array", "items": {"type": "object", "properties": {"pack_name": {"type": "string"}, "emojis": {"type": "array", "items": {"type": "object", "proper`

**Examples**:

```json
[
  {
    "summary": "获取 QQ 系统表情目录",
    "params": {
      "refresh": false
    }
  }
]
```

### `search_sys_faces`

Search QQ system emoji

**Attributes**: read-only

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes |  |

**Returns schema**: `{"type": "object", "properties": {"faces": {"type": "array", "items": {"type": "object", "properties": {"q_sid": {"type": "string", "description": "QQ 表情目录标识（部分 emoji 为 Unicode 表情字符串）"}, "q_des": {"ty`

**Examples**:

```json
[
  {
    "summary": "搜索 QQ 系统表情",
    "params": {
      "query": "微笑"
    }
  }
]
```

## Streaming (6)

### `clean_stream_temp_file`

Clean streaming temp files (only the stream upload/download directories)

**Returns schema**: `{"type": "object", "properties": {"message": {"const": "success"}, "removed": {"type": "integer"}, "freed_bytes": {"type": "integer"}, "skipped_active": {"type": "integer"}}, "required": ["message", "`

**Examples**:

```json
[
  {
    "summary": "清理流式传输临时文件(仅清理 stream 上传/下载目录)",
    "params": {},
    "notes": "清理未使用的流式临时文件；不会清理正在传输的项目。"
  }
]
```

### `download_file_image_stream`

Download an image as a stream (cached image id / URL / local file in the stream directory)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | No |  |
| `file_id` | string | No |  |
| `chunk_size` | int | No |  |

**Returns schema**: `{"oneOf": [{"type": "object", "properties": {"type": {"const": "stream"}, "data_type": {"const": "file_info"}, "file_name": {"type": "string"}, "file_size": {"type": "integer", "description": "字节数，0 可`

**Examples**:

```json
[
  {
    "summary": "以流式方式下载图片(缓存图片 id / URL / stream 目录本地文件)",
    "params": {
      "file_id": "<image-file-from-message>",
      "chunk_size": 65536
    },
    "notes": "file_id 来自当前账号图片消息；经 invoke_action 调用。"
  }
]
```

### `download_file_record_stream`

Download voice as a stream (cached voice id / URL / local file in the stream directory)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | No |  |
| `file_id` | string | No |  |
| `chunk_size` | int | No |  |

**Returns schema**: `{"oneOf": [{"type": "object", "properties": {"type": {"const": "stream"}, "data_type": {"const": "file_info"}, "file_name": {"type": "string"}, "file_size": {"type": "integer", "description": "字节数，0 可`

**Examples**:

```json
[
  {
    "summary": "以流式方式下载语音(缓存语音 id / URL / stream 目录本地文件)",
    "params": {
      "file_id": "<record-file-from-message>",
      "chunk_size": 65536
    },
    "notes": "file_id 来自当前账号语音消息；经 invoke_action 调用。"
  }
]
```

### `download_file_stream`

Download a file as a stream (local file in the stream directory / URL / cached media)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | No |  |
| `file_id` | string | No |  |
| `chunk_size` | int | No |  |

**Returns schema**: `{"oneOf": [{"type": "object", "properties": {"type": {"const": "stream"}, "data_type": {"const": "file_info"}, "file_name": {"type": "string"}, "file_size": {"type": "integer", "description": "字节数，0 可`

**Examples**:

```json
[
  {
    "summary": "以流式方式下载文件(stream 目录本地文件 / URL / 缓存媒体)",
    "params": {
      "file": "https://example.com/report.pdf",
      "chunk_size": 65536
    },
    "notes": "替换实际公开可访问地址；经 invoke_action 调用，文件保存到 MCP 下载目录。"
  }
]
```

### `test_download_stream`

Test the download stream (pushes 10 data frames to verify streaming; does not reach QQ)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `error` | bool | No |  |

**Returns schema**: `{"oneOf": [{"type": "object", "properties": {"type": {"const": "stream"}, "data_type": {"const": "data_chunk"}, "data": {"type": "string"}}, "required": ["type", "data_type", "data"]}, {"type": "objec`

**Examples**:

```json
[
  {
    "summary": "测试下载流(推送 10 个数据帧,验证流式传输,不触达 QQ)",
    "params": {
      "error": false
    },
    "notes": "经 invoke_action 调用，仅测试传输，不访问 QQ。"
  }
]
```

### `upload_file_stream`

Upload a file to the bot local storage in streaming chunks (returns a local path usable for sending)

**Parameters**:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `stream_id` | string | Yes |  |
| `chunk_data` | string | No |  |
| `chunk_index` | int | No |  |
| `total_chunks` | int | No |  |
| `file_size` | int | No |  |
| `expected_sha256` | string | No |  |
| `is_complete` | bool | No |  |
| `filename` | string | No |  |
| `reset` | bool | No |  |
| `verify_only` | bool | No |  |
| `file_retention` | int | No |  |

**Returns schema**: `{"oneOf": [{"type": "object", "properties": {"type": {"const": "stream"}, "stream_id": {"type": "string"}, "status": {"enum": ["file_created", "chunk_received"]}, "received_chunks": {"type": "integer"`

**Examples**:

```json
[
  {
    "summary": "上传分块",
    "params": {
      "stream_id": "example-upload-001",
      "filename": "hello.txt",
      "total_chunks": 1,
      "file_size": 5,
      "chunk_index": 0,
      "chunk_data": "aGVsbG8="
    },
    "notes": "第 1 步：每次上传生成新的 stream_id；这里上传 hello 的唯一分块。通过 invoke_action 调用，分块确认不等于整文件完成。"
  },
  {
    "summary": "完成同一上传",
    "params": {
      "stream_id": "example-upload-001",
      "is_complete": true
    },
    "notes": "第 2 步：等待全部分块确认后，用同一个 stream_id 单独请求完成；成功时返回 file_path。MCP 的 invoke_action 也可通过 execution.input_file 自动完成上传。"
  }
]
```
