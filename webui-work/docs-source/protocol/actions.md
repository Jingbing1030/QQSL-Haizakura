# OneBot 动作参考（完整 222 个）


> **来源**：官方归档 `packages/mcp/src/generated/catalog.json`（597,554 字节）。

> 这是原作者用 `pnpm --filter @snowluma/mcp gen` 从动作定义**自动生成**的目录，
> 也就是已下线文档站 `haizakura.github.io/zh/docs/api` 的数据源。**非 AI 生成。**

共 **222 个动作**，分 **12 类**。

## 分类索引

| 分类 | 动作数 |
|---|---|
| 信息 | 5 |
| 消息 | 6 |
| 好友 | 3 |
| 群信息 | 7 |
| 群管理 | 24 |
| 群文件 | 12 |
| 请求 | 2 |
| 扩展 | 115 |
| 群相册 | 9 |
| 空间 | 29 |
| 系统表情 | 4 |
| 流式接口 | 6 |

## 信息（5 个）

### `can_send_image`

**属性**：只读

**返回 schema**：`{"type": "object", "properties": {"yes": {"type": "boolean", "description": "是否支持发送图片"}}, "required": ["yes"]}`

**示例**：

```json
[
  {
    "summary": "基本调用",
    "params": {}
  }
]
```

### `can_send_record`

**属性**：只读

**返回 schema**：`{"type": "object", "properties": {"yes": {"type": "boolean", "description": "是否支持发送语音"}}, "required": ["yes"]}`

**示例**：

```json
[
  {
    "summary": "基本调用",
    "params": {}
  }
]
```

### `get_login_info`

**属性**：只读

**返回 schema**：`{"type": "object", "properties": {"user_id": {"type": "integer", "description": "登录 QQ 号"}, "nickname": {"type": "string", "description": "登录昵称"}}, "required": ["user_id", "nickname"]}`

**示例**：

```json
[
  {
    "summary": "基本调用",
    "params": {}
  }
]
```

### `get_status`

**属性**：只读

**返回 schema**：`{"type": "object", "properties": {"online": {"type": "boolean", "description": "是否在线"}, "good": {"type": "boolean", "description": "收发链路健康状态；确认接收停滞或主动请求连接失效时为 false"}, "time": {"type": "integer", "des`

**示例**：

```json
[
  {
    "summary": "基本调用",
    "params": {}
  }
]
```

### `get_version_info`

**属性**：只读

**返回 schema**：`{"type": "object", "properties": {"app_name": {"type": "string", "description": "实现名称（Haizakura）"}, "app_version": {"type": "string", "description": "实现版本"}, "protocol_version": {"type": "string", "des`

**示例**：

```json
[
  {
    "summary": "基本调用",
    "params": {}
  }
]
```

## 消息（6 个）

### `delete_msg`

撤回消息

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

获取消息

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |

**返回 schema**：`{"allOf": [{"type": "object", "properties": {"time": {"type": "integer", "description": "消息时间，Unix 秒"}, "message_type": {"type": "string", "enum": ["private", "group"]}, "sub_type": {"type": "string",`

**示例**：

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

发送账号收藏表情（emoji_id 或 MD5），保留表情显示样式

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `emoji_id` | string | 是 |  |
| `group_id` | uint | 否 |  |
| `user_id` | uint | 否 |  |
| `reply_to` | messageId | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**示例**：

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

发送群消息

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `message` | message | 是 |  |
| `auto_escape` | bool | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**示例**：

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

发送消息（按 message_type/群号 自动路由群聊或私聊）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message` | message | 是 |  |
| `message_type` | string | 否 |  |
| `group_id` | uint | 否 |  |
| `user_id` | uint | 否 |  |
| `auto_escape` | bool | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**示例**：

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

发送私聊消息

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |
| `message` | message | 是 |  |
| `group_id` | int | 否 |  |
| `auto_escape` | bool | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**示例**：

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

## 好友（3 个）

### `delete_friend`

删除好友

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |
| `block` | bool | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

获取好友列表

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `with_profile` | bool | 否 |  |

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"user_id": {"type": "integer", "description": "好友 QQ 号"}, "nickname": {"type": "string", "description": "好友昵称"}, "remark": {"type": "string`

**示例**：

```json
[
  {
    "summary": "获取好友列表",
    "params": {}
  }
]
```

### `get_stranger_info`

获取陌生人信息

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"long_nick": {"type": "string", "description": "个性签名"}, "sex": {"type": "string", "description": "性别（male/female/unknown）"}, "age": {"type": "integer", "description":`

**示例**：

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

## 群信息（7 个）

### `get_group_honor_info`

获取群荣誉信息

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `type` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer"}, "current_talkative": {"anyOf": [{"type": "object", "properties": {"user_id": {"type": ["number", "string", "null"]}, "nickname": {"ty`

**示例**：

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

获取群信息

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `no_cache` | bool | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名"}, "group_remark": {"type": "string", "description": "当前账号设置`

**示例**：

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

获取群列表

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `no_cache` | bool | 否 |  |

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名"}, "group_remark": {"type": "stri`

**示例**：

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

获取群成员信息

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `no_cache` | bool | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "user_id": {"type": "integer", "description": "QQ 号"}, "nickname": {"type": "string", "description": "昵称"}, "car`

**示例**：

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

获取群成员列表

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `no_cache` | bool | 否 |  |

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "user_id": {"type": "integer", "description": "QQ 号"}, "nickname": {"type": "string",`

**示例**：

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

获取群分享链接

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `need_short_url` | bool | 否 |  |
| `src_id` | int | 否 |  |
| `additional_param` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"url": {"type": "string", "description": "加群分享链接"}}, "required": ["url"]}`

**示例**：

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

获取群系统消息

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 否 |  |
| `only_pending` | bool | 否 |  |
| `count` | int | 否 |  |

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名称"}, "request_id": {"type": "integ`

**示例**：

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

## 群管理（24 个）

### `add_group_tag`

向某个群分类添加资料标签

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_class` | int | 是 |  |
| `name` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

从某个群分类移除资料标签

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_class` | int | 是 |  |
| `name` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

读取指定管理员的撤回、移除成员、每日移除上限及接收验证消息状态

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer"}, "user_id": {"type": "integer"}, "recall_member_message": {"type": ["boolean", "null"], "description": "撤回成员消息；null 表示服务器未指定"}, "kick_`

**示例**：

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

获取群管理设置的当前值

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"add_type": {"type": "integer", "description": "加群选项（同 set_group_add_option.add_type）"}, "group_question": {"type": "string", "description": "加群问题（同 set_group_add_opt`

**示例**：

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

读取某个群分类下的资料标签

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_class` | int | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"tags": {"type": "array", "description": "资料标签", "items": {"type": "object", "properties": {"id": {"type": "integer", "description": "标签编号"}, "name": {"type": "string`

**示例**：

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

设置加群选项

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `add_type` | int | 否 |  |
| `group_question` | string | 否 |  |
| `group_answer` | string | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置/取消管理员

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `enable` | bool | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置指定管理员的撤回和移除成员权限

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `recall_member_message` | bool | 否 |  |
| `kick_member` | bool | 否 |  |
| `kick_member_per_day` | int | 否 |  |

**返回 schema**：`{"type": "null", "description": "服务器确认请求后 data 为 null；不代表已经过客户端回读验证。可用 get_group_admin_permissions 查询。"}`

**示例**：

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

**约束**：["at least one of: recall_member_message, kick_member", "kick_member=true requires kick_member_per_day: 0, 5, 10, 20, 50, 100 or 200", "kick_member_per_day requires kick_member=true"]

### `set_group_admin_receive_verify`

设置指定管理员是否接收加群验证消息

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `enable` | bool | 是 |  |

**返回 schema**：`{"type": "null", "description": "服务器响应确认目标群和管理员后 data 为 null；未确认目标时返回错误。"}`

**示例**：

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

匿名开关（未实现，返回 ok）

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

匿名禁言（未实现，返回 ok）

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

禁言群成员（duration=0 解除）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `duration` | int | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置群名片（空字符串清除）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `card` | string | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

踢出群成员

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `reject_add_request` | bool | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

批量踢出群成员

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint[] | 是 |  |
| `reject_add_request` | bool | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

退群

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置群成员邀请策略

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `policy` | enum | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置群成员权限（仅群主可改）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `allow_member_upload_album` | bool | 否 |  |
| `allow_member_temporary_session` | bool | 否 |  |
| `allow_member_create_group` | bool | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

**约束**：["at least one of: allow_member_upload_album, allow_member_temporary_session, allow_member_create_group"]

### `set_group_name`

设置群名

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `group_name` | string | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置新成员是否可查看历史消息

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `visible` | bool | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置群头像

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `file` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置群被搜索方式（群指纹 / 群号搜索开关）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `no_finger_open` | int | 否 |  |
| `no_code_finger_open` | int | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置群头衔

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `special_title` | string | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

全员禁言开关

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `enable` | bool | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

## 群文件（12 个）

### `create_group_file_folder`

创建群文件夹

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `name` | string | 是 |  |
| `parent_id` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"result": {"type": "object", "properties": {"retCode": {"const": 0}, "retMsg": {"const": "success"}}, "required": ["retCode", "retMsg"]}, "groupItem": {"type": "objec`

**示例**：

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

删除群文件

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `file_id` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

删除群文件夹

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `folder_id` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

获取群文件下载链接

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `file_id` | string | 是 |  |
| `busid` | raw | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"url": {"type": "string", "description": "文件下载直链"}}, "required": ["url"]}`

**示例**：

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

获取群子目录文件列表

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `folder_id` | string | 否 |  |
| `folder` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"files": {"type": "array", "description": "文件列表", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "file_id": {"type":`

**示例**：

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

获取群根目录文件列表

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"files": {"type": "array", "description": "文件列表", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "file_id": {"type":`

**示例**：

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

获取私聊文件下载链接

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 否 |  |
| `file_id` | string | 是 |  |
| `file_hash` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"url": {"type": "string", "description": "文件下载直链"}}, "required": ["url"]}`

**示例**：

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

移动群文件

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `file_id` | string | 是 |  |
| `parent_directory` | string | 是 |  |
| `target_directory` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

重命名群文件

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `file_id` | string | 是 |  |
| `current_parent_directory` | string | 否 |  |
| `new_name` | string | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"ok": {"const": true}}, "required": ["ok"]}`

**示例**：

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

重命名群文件夹

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `folder_id` | string | 是 |  |
| `new_folder_name` | string | 否 |  |
| `name` | string | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

上传群文件

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `file` | string | 是 |  |
| `name` | string | 否 |  |
| `folder` | string | 否 |  |
| `folder_id` | string | 否 |  |
| `upload_file` | bool | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"file_id": {"type": "string"}}, "required": ["file_id"]}`

**示例**：

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

上传私聊文件

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |
| `file` | string | 是 |  |
| `name` | string | 否 |  |
| `upload_file` | bool | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"file_id": {"type": "string"}}, "required": ["file_id"]}`

**示例**：

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

## 请求（2 个）

### `set_friend_add_request`

处理好友添加请求

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `flag` | string | 是 |  |
| `approve` | bool | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

处理加群请求

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `flag` | string | 是 |  |
| `sub_type` | string | 否 |  |
| `type` | string | 否 |  |
| `approve` | bool | 否 |  |
| `reason` | string | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

## 扩展（115 个）

### `_del_group_notice`

删除群公告（fid 或 notice_id 二选一）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `fid` | string | 否 |  |
| `notice_id` | string | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

获取指定 QQ 号正在使用的个性装扮（挂件/名片/来电/输入状态等）

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"target_uin": {"type": "string"}, "is_svip": {"type": "boolean"}, "avatar_url": {"type": "string"}, "items": {"type": "array", "items": {"type": "object", "properties`

**示例**：

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

获取群公告

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"notice_id": {"type": "string"}, "sender_id": {"type": "number"}, "publish_time": {"type": "number"}, "message": {"type": "object", "proper`

**示例**：

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

获取机型展示（兼容 mock）

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | 否 |  |

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"variants": {"type": "object", "properties": {"model_show": {"type": "string", "description": "机型展示名（回显请求的 model，缺省 snowluma）"}, "need_pay"`

**示例**：

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

标记全部已读

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

发送群公告（支持置顶、弹窗、新成员、群昵称引导与确认）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `content` | string | 是 |  |
| `image` | string | 否 |  |
| `pinned` | int | 否 |  |
| `type` | int | 否 |  |
| `send_to_new_members` | bool | 否 |  |
| `is_show_edit_card` | int | 否 |  |
| `tip_window_type` | int | 否 |  |
| `confirm_required` | int | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

**约束**：["type must be 1 (regular) or 20 (new members)", "send_to_new_members conflicts with type"]

### `_set_model_show`

设置机型展示（占位）

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

分词（未实现）

**属性**：只读

**返回 schema**：`{"not": {}, "description": "当前始终返回失败，没有成功 data；失败响应 data 为 null，原因见 wording"}`

**示例**：

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

添加收藏表情

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | string | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"emoji_id": {"type": "string"}}, "required": ["emoji_id"]}`

**示例**：

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

退出机器人

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

取消群待办

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `message_id` | messageId | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

检查链接安全性

**属性**：只读

**返回 schema**：`{"type": "object", "properties": {"level": {"type": "integer", "description": "安全等级（占位，恒 1）"}}, "required": ["level"]}`

**示例**：

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

清理缓存

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

点击内联键盘按钮

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `bot_appid` | uint | 是 |  |
| `msg_seq` | uint | 是 |  |
| `button_id` | string | 是 |  |
| `callback_data` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"result": {"type": "number", "description": "按钮业务结果码，需单独检查"}, "errMsg": {"type": "string"}, "status": {"const": 0}, "promptText": {"type": "string"}, "promptType": {"`

**示例**：

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

完成群待办

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `message_id` | messageId | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

创建收藏（未实现）

**返回 schema**：`{"not": {}, "description": "当前始终返回失败，没有成功 data；失败响应 data 为 null，原因见 wording"}`

**示例**：

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

创建闪传任务

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `files` | raw | 否 |  |
| `name` | string | 否 |  |
| `thumb_path` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"fileset_id": {"type": "string"}, "task_id": {"type": "string", "description": "与 fileset_id 相同的兼容字段"}}, "required": ["fileset_id", "task_id"]}`

**示例**：

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

删除收藏表情

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `emoji_id` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

移除精华消息

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

删除闪传文件

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fileset_id` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

删除群文件夹

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `folder_id` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

下载文件（url 或 base64）到 data/downloads

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | string | 否 |  |
| `base64` | string | 否 |  |
| `name` | string | 否 |  |
| `headers` | raw | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"file": {"type": "string", "description": "保存到 Haizakura 服务端的本地文件路径"}}, "required": ["file"]}`

**示例**：

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

解析闪传文件下载直链（不下载，由调用方实现下载）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fileset_id` | string | 是 |  |
| `file_name` | string | 否 |  |
| `file_index` | number | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"url": {"type": "string"}, "file_name": {"type": "string"}, "file_size": {"type": "number"}}, "required": ["url", "file_name", "file_size"]}`

**示例**：

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

获取自定义表情

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `count` | int | 否 |  |
| `return_type` | string | 否 |  |

**返回 schema**：`{"type": "array", "items": {"type": "string", "description": "图片 URL 或 emoji_id（取决于 return_type）"}}`

**示例**：

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

获取自定义表情详情

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `count` | int | 否 |  |

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"emoji_id": {"type": "string", "description": "可传给 Haizakura 表情管理接口的资源标识"}, "resId": {"type": "string", "description": "兼容 NapCat 的资源标识"}, "`

**示例**：

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

获取表情回应用户（NapCat 分页）

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |
| `emojiId` | string | 是 |  |
| `count` | int | 否 |  |
| `cookie` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"result": {"type": "integer", "description": "结果码（恒 0）"}, "errMsg": {"type": "string", "description": "错误信息（恒空串）"}, "emojiLikesList": {"type": "array", "description":`

**示例**：

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

获取语音转文字结果

**别名**：`get_ptt_text`, `get_record_text`

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"text": {"type": "string", "description": "语音转写文本"}}, "required": ["text"]}`

**示例**：

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

转发单条消息给好友

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |
| `user_id` | uint | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**示例**：

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

转发单条消息到群

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |
| `group_id` | uint | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**示例**：

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

好友拍一拍

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |
| `target_id` | uint | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

获取 AI 语音角色

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `chat_type` | int | 否 |  |

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"type": {"type": "string", "description": "角色分类名"}, "characters": {"type": "array", "description": "该分类下的角色列表", "items": {"type": "object",`

**示例**：

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

生成 AI 语音

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `character` | string | 是 |  |
| `text` | string | 是 |  |
| `chat_type` | int | 否 |  |

**返回 schema**：`{"type": "string", "description": "生成的下载或分享 URL 字符串，不是含 url 字段的对象"}`

**示例**：

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

获取 clientkey

**属性**：只读

**返回 schema**：`{"type": "object", "properties": {"clientKey": {"type": "string", "description": "clientkey"}, "expireTime": {"type": "string", "description": "过期时间"}, "keyIndex": {"type": "string", "description": "k`

**示例**：

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

获取收藏列表

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `category` | int | 否 |  |
| `count` | int | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"errCode": {"type": "integer"}, "errMsg": {"type": "string"}, "collectionSearchList": {"type": "object", "properties": {"collectionItemList": {"type": "array", "items`

**示例**：

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

获取 Cookies

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `domain` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"cookies": {"type": "string", "description": "该域名的 Cookie 字符串"}}, "required": ["cookies"]}`

**示例**：

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

获取凭证

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `domain` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"cookies": {"type": "string", "description": "该域名的 Cookie 字符串"}, "token": {"type": "integer", "description": "CSRF 令牌（bkn）"}, "csrf_token": {"type": "integer", "descr`

**示例**：

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

获取 CSRF 令牌

**属性**：只读

**返回 schema**：`{"type": "object", "properties": {"token": {"type": "integer", "description": "CSRF 令牌（bkn）"}}, "required": ["token"]}`

**示例**：

```json
[
  {
    "summary": "获取 CSRF 令牌",
    "params": {}
  }
]
```

### `get_doubt_friends_add_request`

获取可疑好友申请

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `count` | int | 否 |  |

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"uid": {"type": "string", "description": "申请人 uid（回传作 set_doubt_friends_add_request 的 flag）"}, "user_id": {"type": "integer", "description"`

**示例**：

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

获取表情回应用户

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |
| `emoji_id` | string | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"emoji_like_list": {"type": "array", "description": "回应用户列表", "items": {"type": "object", "properties": {"user_id": {"type": "string", "description": "用户 QQ 号（字符串）"},`

**示例**：

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

获取精华消息列表

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"msg_seq": {"type": "integer"}, "msg_random": {"type": "integer"}, "sender_id": {"type": "integer"}, "sender_nick": {"type": "string"}, "se`

**示例**：

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

获取文件信息（仅图片/语音缓存；群文件请用 get_group_file_url）

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file_id` | string | 否 |  |
| `file` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"file": {"type": "string", "description": "媒体地址；图片无地址时可为原文件标识"}, "url": {"type": "string", "description": "媒体下载地址，图片地址可能为空"}, "file_size": {"type": "string", "descrip`

**示例**：

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

从 QQ 闪传分享码或官方分享链接获取 fileset_id

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `share_code` | string | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"fileset_id": {"type": "string", "description": "文件集 ID"}}, "required": ["fileset_id"]}`

**示例**：

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

获取文件集信息

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fileset_id` | string | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"fileset_id": {"type": "string"}, "file_list": {"type": "array", "items": {"type": "object", "properties": {"fileset_id": {"type": "string"}, "file_name": {"type": "s`

**示例**：

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

获取闪传文件列表

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fileset_id` | string | 是 |  |

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"fileset_id": {"type": "string"}, "file_name": {"type": "string"}, "orig_name": {"type": "string"}, "size": {"type": "number", "description`

**示例**：

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

获取闪传文件链接

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fileset_id` | string | 是 |  |
| `file_name` | string | 否 |  |
| `file_index` | number | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}`

**示例**：

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

获取合并转发消息（id 或 message_id）

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 否 |  |
| `message_id` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"messages": {"type": "array", "description": "转发消息节点数组；节点标识与本地消息 ID 不是同一契约", "items": {"type": "object", "properties": {"time": {"type": "integer", "description": "消息`

**示例**：

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

获取好友消息历史（无锚点时从服务器获取最新双向记录）

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |
| `message_id` | int | 否 |  |
| `count` | int | 否 |  |
| `reverse_order` | bool | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"messages": {"type": "array", "description": "消息对象数组；去除 post_type/self_id，附带 real_id", "items": {"type": "object", "properties": {"time": {"type": "integer", "descrip`

**示例**：

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

获取分组好友列表

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `with_profile` | bool | 否 |  |

**返回 schema**：`{"type": "array", "description": "带分组的好友列表", "items": {"type": "object", "properties": {"categoryId": {"type": "integer", "description": "分组 ID"}, "categoryName": {"type": "string", "description": "分组`

**示例**：

```json
[
  {
    "summary": "获取分组好友列表",
    "params": {}
  }
]
```

### `get_group_at_all_remain`

获取群 @全体成员 剩余次数

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"can_at_all": {"type": "boolean", "description": "当前是否可 @全体成员"}, "remain_at_all_count_for_group": {"type": "integer", "description": "本群今日剩余 @全体次数"}, "remain_at_all_c`

**示例**：

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

获取群详细信息

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `no_cache` | bool | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名"}, "group_remark": {"type": "string", "description": "当前账号设置`

**示例**：

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

获取群文件系统信息

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"file_count": {"type": "integer", "description": "当前文件数"}, "limit_count": {"type": "integer", "description": "文件数上限"}, "used_space": {"type": "integer", "description"`

**示例**：

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

获取被忽略的入群请求（NapCat）

**属性**：只读

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"request_id": {"type": "integer", "description": "请求序列号"}, "invitor_uin": {"type": "integer", "description": "邀请人 QQ 号"}, "invitor_nick": {`

**示例**：

```json
[
  {
    "summary": "获取被忽略的入群请求（NapCat）",
    "params": {}
  }
]
```

### `get_group_ignored_notifies`

获取被过滤的入群请求

**属性**：只读

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名称"}, "request_id": {"type": "integ`

**示例**：

```json
[
  {
    "summary": "获取被过滤的入群请求",
    "params": {}
  }
]
```

### `get_group_info_ex`

获取群信息（扩展）

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `no_cache` | bool | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名"}, "group_remark": {"type": "string", "description": "当前账号设置`

**示例**：

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

获取群消息历史

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `message_id` | int | 否 |  |
| `count` | int | 否 |  |
| `reverse_order` | bool | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"messages": {"type": "array", "description": "消息对象数组；去除 post_type/self_id，附带 real_id", "items": {"type": "object", "properties": {"time": {"type": "integer", "descrip`

**示例**：

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

获取群禁言列表

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"user_id": {"type": "integer", "description": "成员 QQ 号"}, "nickname": {"type": "string", "description": "成员昵称"}, "shut_up_time": {"type": "`

**示例**：

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

获取群今日打卡列表

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"user_id": {"type": "integer"}, "nick": {"type": "string"}, "time": {"type": "integer"}, "rank": {"type": "integer"}}, "required": ["user_i`

**示例**：

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

获取群待办列表

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；`

**示例**：

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

获取图片信息

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | string | 否 |  |
| `file_id` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"file": {"type": "string", "description": "媒体地址；图片无地址时可为原文件标识"}, "url": {"type": "string", "description": "媒体下载地址，图片地址可能为空"}, "file_size": {"type": "string", "descrip`

**示例**：

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

获取小程序卡片 ark

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string | 否 |  |
| `title` | string | 否 |  |
| `desc` | string | 否 |  |
| `picUrl` | string | 否 |  |
| `pic_url` | string | 否 |  |
| `jumpUrl` | string | 否 |  |
| `jump_url` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"data": {"type": "object", "properties": {"ver": {"description": "服务端卡片版本，原样透传"}, "prompt": {"description": "服务端提示文本，原样透传"}, "config": {"description": "服务端卡片配置，原样透传"}`

**示例**：

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

获取一条消息的全部表情回应

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"emoji_id": {"type": "string", "description": "表情编号"}, "emoji_type": {"type": "integer", "description": "表情类型"}, "count": {"type": "integer`

**示例**：

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

获取在线客户端

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `no_cache` | bool | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"clients": {"type": "array", "description": "在线设备列表", "items": {"type": "object", "properties": {"app_id": {"type": "integer", "description": "客户端 ID"}, "device_name"`

**示例**：

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

获取资料点赞

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | int | 否 |  |
| `start` | int | 否 |  |
| `count` | int | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"uid": {"type": "string", "description": "用户 uid"}, "time": {"type": "integer", "description": "最近点赞时间戳"}, "favoriteInfo": {"type": "object", "description": "收藏统计", "`

**示例**：

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

获取最近会话（占位）

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `count` | int | 否 |  |

**返回 schema**：`{"type": "array", "description": "最近会话列表（占位，恒空）"}`

**示例**：

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

获取语音信息；传 out_format 则服务端转码并附带 base64

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | string | 否 |  |
| `file_id` | string | 否 |  |
| `out_format` | enum | 否 |  |

**返回 schema**：`{"allOf": [{"type": "object", "properties": {"file": {"type": "string", "description": "媒体地址；图片无地址时可为原文件标识"}, "url": {"type": "string", "description": "媒体下载地址，图片地址可能为空"}, "file_size": {"type": "string`

**示例**：

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

获取下载 rkey

**别名**：`nc_get_rkey`

**属性**：只读

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"rkey": {"type": "string", "description": "下载密钥，敏感信息"}, "type": {"type": "integer"}, "ttl": {"type": "integer", "description": "有效时长，秒"}, "`

**示例**：

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

获取 rkey 服务器信息

**属性**：只读

**返回 schema**：`{"type": "object", "properties": {"expired_time": {"type": "integer", "description": "过期时间戳（秒）"}, "name": {"type": "string", "description": "服务器名（恒 Haizakura）"}, "private_rkey": {"type": "string", "des`

**示例**：

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

获取文件分享链接

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fileset_id` | string | 是 |  |

**返回 schema**：`{"type": "string", "description": "生成的下载或分享 URL 字符串，不是含 url 字段的对象"}`

**示例**：

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

获取单向好友列表

**属性**：只读

**返回 schema**：`{"type": "array", "items": {"type": "object", "additionalProperties": true, "description": "服务端列表项原样透传，目前未归一化字段，不能假定与 get_friend_list 相同"}}`

**示例**：

```json
[
  {
    "summary": "获取单向好友列表",
    "params": {}
  }
]
```

### `group_poke`

群拍一拍

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

列出当前账号的所有闪传文件集

**返回 schema**：`{"type": "array", "items": {"type": "object", "properties": {"fileset_id": {"type": "string"}, "file_name": {"type": "string"}, "orig_name": {"type": "string"}, "size": {"type": "number", "description`

**示例**：

```json
[
  {
    "summary": "列出当前账号的所有闪传文件集",
    "params": {}
  }
]
```

### `mark_group_msg_as_read`

标记群消息已读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |
| `group_id` | uint | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

标记消息已读（群聊/私聊自动路由）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |
| `target_id` | uint | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

标记私聊消息已读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |
| `user_id` | uint | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

修改收藏表情备注

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `emoji_id` | string | 是 |  |
| `desc` | string | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

收藏表情移到最前

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `emoji_id` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

获取 packet 状态（占位）

**属性**：只读

**返回 schema**：`{"type": "null", "description": "packet 状态（占位，恒 null）"}`

**示例**：

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

获取用户在线/扩展状态

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"status": {"type": "integer", "description": "在线状态码"}, "ext_status": {"type": "integer", "description": "扩展状态码"}}, "required": ["status", "ext_status"]}`

**示例**：

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

OCR 图片（服务端，需图片 URL 或已缓存的图片 file_id）

**别名**：`.ocr_image`

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image` | string | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"texts": {"type": "array", "description": "识别出的文本块", "items": {"type": "object", "properties": {"text": {"type": "string", "description": "文本内容"}, "confidence": {"typ`

**示例**：

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

重命名闪传文件

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fileset_id` | string | 是 |  |
| `new_name` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

请求数据库解密密钥

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `db_path` | string | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"db_key": {"type": "string", "description": "数据库密钥，敏感信息"}}, "required": ["db_key"]}`

**示例**：

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

分享用户/群 Ark 卡片（NapCat 标准名）

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 否 |  |
| `group_id` | uint | 否 |  |
| `phone_number` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"arkMsg": {"type": "string", "description": "Ark 卡片 JSON 字符串"}}, "required": ["arkMsg"]}`

**示例**：

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

发送闪传消息（私聊或群聊，引用 fileset_id 让对端下载）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fileset_id` | string | 是 |  |
| `user_id` | uint | 否 |  |
| `group_id` | uint | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"message_id": {"const": 0, "description": "闪传分享不返回普通消息 ID，0 是占位值，不能用于查询或撤回"}}, "required": ["message_id"]}`

**示例**：

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

发送合并转发（按 message_type/群号自动路由）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `messages` | message | 否 |  |
| `message` | message | 否 |  |
| `message_type` | string | 否 |  |
| `group_id` | int | 否 |  |
| `user_id` | int | 否 |  |
| `source` | string | 否 |  |
| `summary` | string | 否 |  |
| `prompt` | string | 否 |  |
| `news` | raw | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"message_id": {"anyOf": [{"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}, {"cons`

**示例**：

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

发送 AI 语音到群

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `character` | string | 是 |  |
| `text` | string | 是 |  |
| `chat_type` | int | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**示例**：

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

分享群 Ark 卡片（NapCat 标准名）

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**返回 schema**：`{"type": "string", "description": "群 Ark 卡片 JSON 字符串"}`

**示例**：

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

发送群合并转发

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `messages` | message | 否 |  |
| `message` | message | 否 |  |
| `source` | string | 否 |  |
| `summary` | string | 否 |  |
| `prompt` | string | 否 |  |
| `news` | raw | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}, "res_id": {"type"`

**示例**：

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

点赞

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |
| `times` | int | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

发送原始 SSO 包（cmd + hex data）

**别名**：`.send_packet`

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cmd` | string | 是 |  |
| `data` | string | 否 |  |
| `rsp` | bool | 否 |  |

**返回 schema**：`{"anyOf": [{"type": "string", "description": "rsp=true 时返回的十六进制响应正文"}, {"type": "null", "description": "rsp=false 时不等待响应，data 为 null"}]}`

**示例**：

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

拍一拍（群聊/私聊自动路由）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |
| `group_id` | uint | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

发送私聊合并转发

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |
| `messages` | message | 否 |  |
| `message` | message | 否 |  |
| `source` | string | 否 |  |
| `summary` | string | 否 |  |
| `prompt` | string | 否 |  |
| `news` | raw | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}, "res_id": {"type"`

**示例**：

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

发送图文 Ark 卡片（私聊/群聊）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 否 |  |
| `group_id` | uint | 否 |  |
| `title` | string | 是 |  |
| `desc` | string | 是 |  |
| `summary` | string | 否 |  |
| `preview_url` | string | 否 |  |
| `jump_url` | string | 是 |  |

**返回 schema**：`{"type": "null"}`

**示例**：

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

设置自定义在线状态

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `face_id` | int | 是 |  |
| `face_type` | int | 否 |  |
| `wording` | string | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

处理可疑好友申请

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `flag` | string | 是 |  |
| `approve` | bool | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置精华消息

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置好友备注

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |
| `remark` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

移动好友到指定分组

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `uin` | uint | 是 |  |
| `categoryId` | int | 否 |  |
| `categoryName` | string | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

**约束**：["exactly one of: categoryId | categoryName"]

### `set_group_reaction`

群聊表情回应

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 否 |  |
| `message_id` | messageId | 是 |  |
| `code` | string | 是 |  |
| `is_set` | bool | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置群备注

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `remark` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置群机器人加群选项

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `robot_member_switch` | int | 否 |  |
| `robot_member_examine` | int | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

群签到

**别名**：`send_group_sign`

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**返回 schema**：`{"type": "object", "properties": {}, "additionalProperties": false, "description": "成功时为空对象 {}，不是 null"}`

**示例**：

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

设置群待办

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `message_id` | messageId | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置输入状态

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |
| `event_type` | int | 否 |  |

**返回 schema**：`{"type": "object", "properties": {}, "additionalProperties": false, "description": "成功时为空对象 {}，不是 null"}`

**示例**：

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

设置消息表情回应

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |
| `emoji_id` | string | 是 |  |
| `set` | bool | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置在线状态

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `status` | int | 是 |  |
| `ext_status` | int | 否 |  |
| `battery_status` | int | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置 QQ 头像

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

设置 QQ 资料

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `nickname` | string | 否 |  |
| `personal_note` | string | 否 |  |
| `sex` | int | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

重启（不支持）

**返回 schema**：`{"not": {}, "description": "当前始终返回失败，没有成功 data；失败响应 data 为 null，原因见 wording"}`

**示例**：

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

设置个性签名（longNick/long_nick，严格 string）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `longNick` | string | 否 |  |
| `long_nick` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {}, "additionalProperties": false, "description": "成功时为空对象 {}，不是 null"}`

**示例**：

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

分享群 Ark 卡片

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**返回 schema**：`{"type": "string", "description": "群 Ark 卡片 JSON 字符串"}`

**示例**：

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

分享用户/群 Ark 卡片

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 否 |  |
| `group_id` | uint | 否 |  |
| `phone_number` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"arkMsg": {"type": "string", "description": "Ark 卡片 JSON 字符串"}}, "required": ["arkMsg"]}`

**示例**：

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

转存群文件

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `file_id` | string | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"ok": {"const": true}}, "required": ["ok"]}`

**示例**：

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

英译中

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `words` | string[] | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"words": {"type": "array", "description": "译文数组", "items": {"type": "string"}}}, "required": ["words"]}`

**示例**：

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

上传转发消息

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `messages` | message | 否 |  |
| `message` | message | 否 |  |
| `group_id` | uint | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"res_id": {"type": "string"}, "forward_id": {"type": "string"}, "message_id": {"const": 0, "description": "仅上传资源，不代表已发送消息；0 不能用于消息查询或撤回"}, "group_id": {"type": "integ`

**示例**：

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

上传转发消息（别名拼写）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `messages` | message | 否 |  |
| `message` | message | 否 |  |
| `group_id` | uint | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"res_id": {"type": "string"}, "forward_id": {"type": "string"}, "message_id": {"const": 0, "description": "仅上传资源，不代表已发送消息；0 不能用于消息查询或撤回"}}, "required": ["res_id", "fo`

**示例**：

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

## 群相册（9 个）

### `cancel_group_album_media_like`

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `album_id` | string | 是 |  |
| `batch_id` | string | 是 |  |
| `lloc` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"id": {"type": ["string", "null"]}, "status": {"type": ["integer", "null"]}}}`

**示例**：

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

删除群相册图片或视频

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `album_id` | string | 是 |  |
| `lloc` | string | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"success": {"const": true}}, "required": ["success"]}`

**示例**：

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

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `album_id` | string | 是 |  |
| `lloc` | string | 是 |  |
| `content` | string | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"id": {"type": "string"}, "user": {"type": "object", "properties": {"uin": {"type": "string"}}, "required": ["uin"]}, "content": {"type": "array", "items": {"type": "`

**示例**：

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

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**返回 schema**：`{"type": "array", "description": "群相册列表", "items": {"type": "object", "properties": {"id": {"type": "string", "description": "相册 id"}, "name": {"type": "string", "description": "相册名称"}, "picNum": {"ty`

**示例**：

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

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `album_id` | string | 是 |  |
| `attach_info` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"mediaList": {"type": "array", "description": "相册图片或视频，未返回的字段可省略或为 null", "items": {"type": "object", "properties": {"type": {"type": ["integer", "null"]}, "image": {`

**示例**：

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

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `attach_info` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"album_list": {"type": "array", "description": "相册列表", "items": {"type": "object", "properties": {"album_id": {"type": "string", "description": "相册 id"}, "name": {"ty`

**示例**：

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

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `album_id` | string | 是 |  |
| `batch_id` | string | 是 |  |
| `lloc` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"id": {"type": ["string", "null"]}, "status": {"type": ["integer", "null"]}}}`

**示例**：

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

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `album_id` | string | 是 |  |
| `album_name` | string | 是 |  |
| `file` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

上传视频到群相册

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `album_id` | string | 是 |  |
| `album_name` | string | 是 |  |
| `file` | string | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"id": {"type": "string", "description": "视频 id"}}, "required": ["id"]}`

**示例**：

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

## 空间（29 个）

### `comment_qzone`

评论说说或回复指定评论（普通评论支持带图，楼中楼仅支持文字）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tid` | string | 是 |  |
| `content` | string | 是 |  |
| `target_uin` | uint | 否 |  |
| `comment_id` | string | 否 |  |
| `comment_uin` | uint | 否 |  |
| `reply_uin` | uint | 否 |  |
| `reply_name` | string | 否 |  |
| `images` | string[] | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"comment_id": {"type": "string", "description": "新评论或新回复的 ID；普通评论未返回 ID 时为空串，楼中楼回复不会用父编号代替"}, "parent_comment_id": {"type": "string", "description": "仅楼中楼回复返回，所属一级评论 `

**示例**：

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

**约束**：["all or none of: comment_id, comment_uin", "all or none of: reply_uin, reply_name", "reply_uin/reply_name require comment_id/comment_uin", "images are not supported for comment replies", "comment_id, reply_name and reply content must not be blank", "comment_uin and reply_uin must be safe integers"]

### `comment_qzone_public_feed`

评论推荐动态，支持文本或上游富文本条目

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `feed` | object | 是 |  |
| `content` | string | object[] | 是 |  |

**返回 schema**：`{"type": "object", "additionalProperties": true}`

**示例**：

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

删除一条说说（QQ 空间，按 tid）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tid` | string | 是 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

删除推荐动态的一条评论（需有权限）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `feed` | object | 是 |  |
| `comment` | object | 是 |  |

**返回 schema**：`{"type": "object", "additionalProperties": true}`

**示例**：

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

删除推荐动态评论下的一条回复（需有权限）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `feed` | object | 是 |  |
| `comment` | object | 是 |  |
| `reply` | object | 是 |  |

**返回 schema**：`{"type": "object", "additionalProperties": true}`

**示例**：

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

将推荐动态转发到当前账号空间

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `feed` | object | 是 |  |
| `reason` | string | 否 |  |

**返回 schema**：`{"type": "object", "additionalProperties": true}`

**示例**：

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

按说说 tid 读取完整空间动态，可用于生成分享卡片

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tid` | string | 是 |  |

**返回 schema**：`{"type": "object", "additionalProperties": true, "properties": {"feed": {"type": "object", "additionalProperties": true, "description": "去除上游包装后的完整动态，可原样传给 get_qzone_share_ark"}, "attach_info": {"type`

**示例**：

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

**约束**：["tid must be a 24-character hexadecimal post ID"]

### `get_qzone_feeds`

获取 QQ 空间好友动态，支持结构化正文与游标分页

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `page_num` | int | 否 |  |
| `count` | int | 否 |  |
| `cursor` | string | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"feeds": {"type": "array", "description": "本页好友动态数组", "items": {"type": "object", "properties": {"uin": {"type": "integer", "description": "动态作者 QQ 号"}, "nickname": {`

**示例**：

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

读取自己或有权访问的空间主页动态，保留完整分享信息

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `target_uin` | uint | 否 |  |
| `cursor` | string | 否 |  |

**返回 schema**：`{"type": "object", "additionalProperties": true, "properties": {"feeds": {"type": "array", "items": {"type": "object", "additionalProperties": true}, "description": "完整动态，可原样传给 get_qzone_share_ark"}, `

**示例**：

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

获取 QQ 空间说说详情与一页评论（含服务端内联回复，需有访问权限）

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tid` | string | 是 |  |
| `target_uin` | uint | 否 |  |
| `pos` | int | 否 |  |
| `num` | int | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"tid": {"type": "string", "description": "说说 ID"}, "content": {"type": "string", "description": "说说正文"}, "comment_num": {"type": "integer", "description": "服务端报告的评论总数`

**示例**：

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

获取 QQ 空间说说列表（默认机器人自己的空间）

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `target_uin` | uint | 否 |  |
| `pos` | int | 否 |  |
| `num` | int | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"total": {"type": "integer", "description": "账号说说总数（非本页数量）"}, "msglist": {"type": "array", "description": "本页说说数组", "items": {"type": "object", "properties": {"tid": `

**示例**：

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

获取 QQ 空间名称和说明（默认当前账号）

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `target_uin` | uint | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"name": {"type": "string", "description": "空间名称"}, "description": {"type": "string", "description": "空间说明"}}, "required": ["name", "description"]}`

**示例**：

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

读取当前账号的空友爱看入口与推权限

**属性**：只读

**返回 schema**：`{"type": "object", "additionalProperties": true}`

**示例**：

```json
[
  {
    "summary": "查询当前账号是否有空友爱看入口及推能力",
    "params": {}
  }
]
```

### `get_qzone_public_comments`

继续读取推荐动态评论

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `feed` | object | 是 |  |
| `cursor` | string | 是 |  |

**返回 schema**：`{"type": "object", "additionalProperties": true}`

**示例**：

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

读取推荐动态详情及初始评论

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `feed` | object | 是 |  |

**返回 schema**：`{"type": "object", "additionalProperties": true}`

**示例**：

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

读取空友爱看推荐动态，支持独立游标分页

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cursor` | string | 否 |  |

**返回 schema**：`{"type": "object", "additionalProperties": true, "properties": {"feeds": {"type": "array", "items": {"type": "object", "additionalProperties": true}, "description": "原始动态 cell 对象，后续详情和互动需原样传入"}, "has_`

**示例**：

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

继续读取指定评论的回复

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `feed` | object | 是 |  |
| `comment` | object | 是 |  |
| `cursor` | string | 否 |  |
| `page_size` | int | 否 |  |

**返回 schema**：`{"type": "object", "additionalProperties": true}`

**示例**：

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

生成空间动态分享卡片，返回原文及分享提示

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `feed` | object | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"ark": {"type": "string", "description": "卡片原文，直接作为 JSON 消息的 data"}, "requires_confirmation": {"type": "boolean", "description": "上游要求发送前确认分享提示"}, "notice": {"type": `

**示例**：

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

给一条说说点赞（QQ 空间）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tid` | string | 是 |  |
| `target_uin` | uint | 否 |  |
| `abstime` | int | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

回复推荐动态的评论或其中某条回复

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `feed` | object | 是 |  |
| `comment` | object | 是 |  |
| `content` | string | object[] | 是 |  |
| `reply` | object | 否 |  |

**返回 schema**：`{"type": "object", "additionalProperties": true}`

**示例**：

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

发表说说（QQ 空间，支持纯文字或带图；传 images 自动上传；可设置查看权限）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `content` | string | 是 |  |
| `images` | string[] | 否 |  |
| `ugc_right` | int | 否 |  |
| `target_uins` | uint[] | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"tid": {"type": "string"}, "time": {"type": "integer"}}, "required": ["tid", "time"]}`

**示例**：

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

**约束**：["ugc_right must be one of 1, 4, 16, 64, 128", "target_uins is required when ugc_right is 16 or 128"]

### `set_qzone_ban`

拉黑或解除拉黑某人（修改机器人自身 QQ 空间黑名单；enable=true 拉黑，false 解除）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |
| `enable` | bool | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

修改一条已发说说的查看权限（QQ 空间，按 tid）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tid` | string | 是 |  |
| `ugc_right` | int | 是 |  |
| `target_uins` | uint[] | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"ugc_right": {"type": "integer", "description": "更新后的查看权限"}}, "required": ["ugc_right"]}`

**示例**：

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

**约束**：["ugc_right must be one of 1, 4, 16, 64, 128", "target_uins is required when ugc_right is 16 or 128"]

### `set_qzone_profile`

修改当前账号的 QQ 空间名称或说明

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 否 |  |
| `description` | string | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

**约束**：["at least one of: name, description"]

### `set_qzone_public_comment_like`

点赞或取消赞推荐动态中的评论或回复

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `feed` | object | 是 |  |
| `comment` | object | 是 |  |
| `enable` | bool | 否 |  |
| `reply` | object | 否 |  |

**返回 schema**：`{"type": "object", "additionalProperties": true}`

**示例**：

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

蹲或取消蹲推荐动态作者

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `feed` | object | 是 |  |
| `enable` | bool | 否 |  |

**返回 schema**：`{"type": "object", "additionalProperties": true}`

**示例**：

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

点赞或取消赞推荐动态

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `feed` | object | 是 |  |
| `enable` | bool | 否 |  |

**返回 schema**：`{"type": "object", "additionalProperties": true}`

**示例**：

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

推或取消推空友爱看动态（独立于普通赞）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `feed` | object | 是 |  |
| `enable` | bool | 否 |  |

**返回 schema**：`{"type": "object", "additionalProperties": true}`

**示例**：

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

取消对一条说说的点赞（QQ 空间；取消赞端点待真机核实）

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tid` | string | 是 |  |
| `target_uin` | uint | 否 |  |
| `abstime` | int | 否 |  |

**返回 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

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

## 系统表情（4 个）

### `fetch_face_entity`

按编号查询 QQ 系统表情

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `face_id` | int | 是 |  |
| `refresh` | bool | 否 |  |

**返回 schema**：`{"anyOf": [{"type": "object", "properties": {"q_sid": {"type": "string", "description": "QQ 表情目录标识（部分 emoji 为 Unicode 表情字符串）"}, "q_des": {"type": "string", "description": "表情描述"}, "em_code": {"type": `

**示例**：

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

判断 QQ 系统表情是否使用超级表情格式

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `face_id` | int | 是 |  |
| `refresh` | bool | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"is_super": {"type": "boolean"}}, "required": ["is_super"]}`

**示例**：

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

获取 QQ 系统表情目录

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `refresh` | bool | 否 |  |

**返回 schema**：`{"type": "object", "properties": {"packs": {"type": "array", "items": {"type": "object", "properties": {"pack_name": {"type": "string"}, "emojis": {"type": "array", "items": {"type": "object", "proper`

**示例**：

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

搜索 QQ 系统表情

**属性**：只读

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` | string | 是 |  |

**返回 schema**：`{"type": "object", "properties": {"faces": {"type": "array", "items": {"type": "object", "properties": {"q_sid": {"type": "string", "description": "QQ 表情目录标识（部分 emoji 为 Unicode 表情字符串）"}, "q_des": {"ty`

**示例**：

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

## 流式接口（6 个）

### `clean_stream_temp_file`

清理流式传输临时文件(仅清理 stream 上传/下载目录)

**返回 schema**：`{"type": "object", "properties": {"message": {"const": "success"}, "removed": {"type": "integer"}, "freed_bytes": {"type": "integer"}, "skipped_active": {"type": "integer"}}, "required": ["message", "`

**示例**：

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

以流式方式下载图片(缓存图片 id / URL / stream 目录本地文件)

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | string | 否 |  |
| `file_id` | string | 否 |  |
| `chunk_size` | int | 否 |  |

**返回 schema**：`{"oneOf": [{"type": "object", "properties": {"type": {"const": "stream"}, "data_type": {"const": "file_info"}, "file_name": {"type": "string"}, "file_size": {"type": "integer", "description": "字节数，0 可`

**示例**：

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

以流式方式下载语音(缓存语音 id / URL / stream 目录本地文件)

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | string | 否 |  |
| `file_id` | string | 否 |  |
| `chunk_size` | int | 否 |  |

**返回 schema**：`{"oneOf": [{"type": "object", "properties": {"type": {"const": "stream"}, "data_type": {"const": "file_info"}, "file_name": {"type": "string"}, "file_size": {"type": "integer", "description": "字节数，0 可`

**示例**：

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

以流式方式下载文件(stream 目录本地文件 / URL / 缓存媒体)

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | string | 否 |  |
| `file_id` | string | 否 |  |
| `chunk_size` | int | 否 |  |

**返回 schema**：`{"oneOf": [{"type": "object", "properties": {"type": {"const": "stream"}, "data_type": {"const": "file_info"}, "file_name": {"type": "string"}, "file_size": {"type": "integer", "description": "字节数，0 可`

**示例**：

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

测试下载流(推送 10 个数据帧,验证流式传输,不触达 QQ)

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `error` | bool | 否 |  |

**返回 schema**：`{"oneOf": [{"type": "object", "properties": {"type": {"const": "stream"}, "data_type": {"const": "data_chunk"}, "data": {"type": "string"}}, "required": ["type", "data_type", "data"]}, {"type": "objec`

**示例**：

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

以流式分块方式上传文件到机器人本地(返回可用于发送的本地路径)

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `stream_id` | string | 是 |  |
| `chunk_data` | string | 否 |  |
| `chunk_index` | int | 否 |  |
| `total_chunks` | int | 否 |  |
| `file_size` | int | 否 |  |
| `expected_sha256` | string | 否 |  |
| `is_complete` | bool | 否 |  |
| `filename` | string | 否 |  |
| `reset` | bool | 否 |  |
| `verify_only` | bool | 否 |  |
| `file_retention` | int | 否 |  |

**返回 schema**：`{"oneOf": [{"type": "object", "properties": {"type": {"const": "stream"}, "stream_id": {"type": "string"}, "status": {"enum": ["file_created", "chunk_received"]}, "received_chunks": {"type": "integer"`

**示例**：

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
