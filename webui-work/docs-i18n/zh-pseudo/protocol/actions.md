# OneBot 動作参照（完全 222 個）


> **来源**：公式歸档 `packages/mcp/src/generated/catalog.json`（597,554 字節）。

> 此原作者 `pnpm --filter @snowluma/mcp gen` 依動作定義**自動生成**之目録也、
> 即既下線文档站 `haizakura.github.io/zh/docs/api` 之資料源也。**AI 生成非也。**

共 **222 個之動作**、**12 類**分。

## 分類索引

| 分類 | 動作数 |
|---|---|
| 信息 | 5 |
| 消息 | 6 |
| 好友 | 3 |
| 群信息 | 7 |
| 群管理 | 24 |
| 群文件 | 12 |
| 請求 | 2 |
| 拡張 | 115 |
| 群相册 | 9 |
| 空間 | 29 |
| 系統表情 | 4 |
| 流式接口 | 6 |

## 信息（5 個）

### `can_send_image`

**属性**：只読

**返却 schema**：`{"type": "object", "properties": {"yes": {"type": "boolean", "description": "是否支持发送图片"}}, "required": ["yes"]}`

**示例**：

```json
[
  {
    "summary": "基本呼出",
    "params": {}
  }
]
```

### `can_send_record`

**属性**：只読

**返却 schema**：`{"type": "object", "properties": {"yes": {"type": "boolean", "description": "是否支持发送语音"}}, "required": ["yes"]}`

**示例**：

```json
[
  {
    "summary": "基本呼出",
    "params": {}
  }
]
```

### `get_login_info`

**属性**：只読

**返却 schema**：`{"type": "object", "properties": {"user_id": {"type": "integer", "description": "登录 QQ 号"}, "nickname": {"type": "string", "description": "登录昵称"}}, "required": ["user_id", "nickname"]}`

**示例**：

```json
[
  {
    "summary": "基本呼出",
    "params": {}
  }
]
```

### `get_status`

**属性**：只読

**返却 schema**：`{"type": "object", "properties": {"online": {"type": "boolean", "description": "是否在线"}, "good": {"type": "boolean", "description": "收发链路健康状态；确认接收停滞或主动请求连接失效时为 false"}, "time": {"type": "integer", "des`

**示例**：

```json
[
  {
    "summary": "基本呼出",
    "params": {}
  }
]
```

### `get_version_info`

**属性**：只読

**返却 schema**：`{"type": "object", "properties": {"app_name": {"type": "string", "description": "实现名称（Haizakura）"}, "app_version": {"type": "string", "description": "实现版本"}, "protocol_version": {"type": "string", "des`

**示例**：

```json
[
  {
    "summary": "基本呼出",
    "params": {}
  }
]
```

## 消息（6 個）

### `delete_msg`

消息撤回

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |

**返却 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

```json
[
  {
    "summary": "消息撤回",
    "params": {
      "message_id": -123456
    },
    "notes": "消息事件或送信結果中之真実 message_id 使用、負値合法也；消息者当前帳号之消息保存中照会可能必要也。"
  }
]
```

### `get_msg`

消息取得

**属性**：只読

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `message_id` | messageId | 是 |  |

**返却 schema**：`{"allOf": [{"type": "object", "properties": {"time": {"type": "integer", "description": "消息时间，Unix 秒"}, "message_type": {"type": "string", "enum": ["private", "group"]}, "sub_type": {"type": "string",`

**示例**：

```json
[
  {
    "summary": "消息取得",
    "params": {
      "message_id": -123456
    },
    "notes": "消息事件或送信結果中之真実 message_id 使用、負値合法也；消息者当前帳号之消息保存中照会可能必要也。"
  }
]
```

### `send_custom_face`

帳号収蔵表情送信（emoji_id 或 MD5）、表情表示様式保持

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `emoji_id` | string | 是 |  |
| `group_id` | uint | 否 |  |
| `user_id` | uint | 否 |  |
| `reply_to` | messageId | 否 |  |

**返却 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**示例**：

```json
[
  {
    "summary": "帳号収蔵表情送信（emoji_id 或 MD5）、表情表示様式保持",
    "params": {
      "group_id": 20001,
      "emoji_id": "<emoji-id-from-fetch_custom_face_detail>"
    },
    "notes": "群聊与私聊之目標者唯一提供可能也；emoji_id 者 fetch_custom_face_detail 由来也。"
  }
]
```

### `send_group_msg`

群消息送信

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `message` | message | 是 |  |
| `auto_escape` | bool | 否 |  |

**返却 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**示例**：

```json
[
  {
    "summary": "群消息送信",
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
    "notes": "目標群号置換；成功返却之 message_id 者負値可能性有也。"
  }
]
```

### `send_msg`

消息送信（message_type / 群号依群聊或私聊自動路由）

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `message` | message | 是 |  |
| `message_type` | string | 否 |  |
| `group_id` | uint | 否 |  |
| `user_id` | uint | 否 |  |
| `auto_escape` | bool | 否 |  |

**返却 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**示例**：

```json
[
  {
    "summary": "消息送信（message_type / 群号依群聊或私聊自動路由）",
    "params": {
      "message_type": "group",
      "group_id": 20001,
      "message": "你好"
    },
    "notes": "対応之目標必提供；私聊者 message_type=private 与 user_id 使用。"
  }
]
```

### `send_private_msg`

私聊消息送信

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |
| `message` | message | 是 |  |
| `group_id` | int | 否 |  |
| `auto_escape` | bool | 否 |  |

**返却 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**示例**：

```json
[
  {
    "summary": "私聊消息送信",
    "params": {
      "user_id": 10001,
      "message": "你好"
    },
    "notes": "目標好友 QQ 号置換；臨時会話者別途来源 group_id 伝必要也。"
  }
]
```

## 好友（3 個）

### `delete_friend`

好友削除

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |
| `block` | bool | 否 |  |

**返却 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

```json
[
  {
    "summary": "好友削除",
    "params": {
      "user_id": 10001,
      "block": false
    },
    "notes": "指定好友削除也；明確削除必要場合仅呼出也。"
  }
]
```

### `get_friend_list`

好友列表取得

**属性**：只読

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `with_profile` | bool | 否 |  |

**返却 schema**：`{"type": "array", "items": {"type": "object", "properties": {"user_id": {"type": "integer", "description": "好友 QQ 号"}, "nickname": {"type": "string", "description": "好友昵称"}, "remark": {"type": "string`

**示例**：

```json
[
  {
    "summary": "好友列表取得",
    "params": {}
  }
]
```

### `get_stranger_info`

陌生人信息取得

**属性**：只読

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `user_id` | uint | 是 |  |

**返却 schema**：`{"type": "object", "properties": {"long_nick": {"type": "string", "description": "个性签名"}, "sex": {"type": "string", "description": "性别（male/female/unknown）"}, "age": {"type": "integer", "description":`

**示例**：

```json
[
  {
    "summary": "陌生人信息取得",
    "params": {
      "user_id": 10001
    },
    "notes": "照会必要之 QQ 号置換。"
  }
]
```

## 群信息（7 個）

### `get_group_honor_info`

群荣誉信息取得

**属性**：只読

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `type` | string | 否 |  |

**返却 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer"}, "current_talkative": {"anyOf": [{"type": "object", "properties": {"user_id": {"type": ["number", "string", "null"]}, "nickname": {"ty`

**示例**：

```json
[
  {
    "summary": "群荣誉信息取得",
    "params": {
      "group_id": 20001,
      "type": "all"
    },
    "notes": "未請求之分類尚空配列返；当前龍王者 null 可能性有也。"
  }
]
```

### `get_group_info`

群信息取得

**属性**：只読

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `no_cache` | bool | 否 |  |

**返却 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名"}, "group_remark": {"type": "string", "description": "当前账号设置`

**示例**：

```json
[
  {
    "summary": "群信息取得",
    "params": {
      "group_id": 20001
    },
    "notes": "group_id 者当前帳号訪問可能之群号置換。"
  }
]
```

### `get_group_list`

群列表取得

**属性**：只読

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `no_cache` | bool | 否 |  |

**返却 schema**：`{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名"}, "group_remark": {"type": "stri`

**示例**：

```json
[
  {
    "summary": "群列表取得",
    "params": {
      "no_cache": false
    }
  }
]
```

### `get_group_member_info`

群成員信息取得

**属性**：只読

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `no_cache` | bool | 否 |  |

**返却 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "user_id": {"type": "integer", "description": "QQ 号"}, "nickname": {"type": "string", "description": "昵称"}, "car`

**示例**：

```json
[
  {
    "summary": "群成員信息取得",
    "params": {
      "group_id": 20001,
      "user_id": 10001
    },
    "notes": "group_id 者当前帳号訪問可能之群号置換。"
  }
]
```

### `get_group_member_list`

群成員列表取得

**属性**：只読

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `no_cache` | bool | 否 |  |

**返却 schema**：`{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "user_id": {"type": "integer", "description": "QQ 号"}, "nickname": {"type": "string",`

**示例**：

```json
[
  {
    "summary": "群成員列表取得",
    "params": {
      "group_id": 20001
    },
    "notes": "group_id 者当前帳号訪問可能之群号置換。"
  }
]
```

### `get_group_share_link`

群共有鏈接取得

**属性**：只読

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `need_short_url` | bool | 否 |  |
| `src_id` | int | 否 |  |
| `additional_param` | string | 否 |  |

**返却 schema**：`{"type": "object", "properties": {"url": {"type": "string", "description": "加群分享链接"}}, "required": ["url"]}`

**示例**：

```json
[
  {
    "summary": "群共有鏈接取得",
    "params": {
      "group_id": 20001,
      "need_short_url": true
    },
    "notes": "group_id 者当前帳号訪問可能之群号置換。"
  }
]
```

### `get_group_system_msg`

群系統消息取得

**属性**：只読

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | 否 |  |
| `only_pending` | bool | 否 |  |
| `count` | int | 否 |  |

**返却 schema**：`{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名称"}, "request_id": {"type": "integ`

**示例**：

```json
[
  {
    "summary": "群系統消息取得",
    "params": {
      "group_id": 20001,
      "only_pending": true,
      "count": 20
    },
    "notes": "group_id 者当前帳号訪問可能之群号置換。"
  }
]
```

## 群管理（24 個）

### `add_group_tag`

某群分類対資料標簽追加

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_class` | int | 是 |  |
| `name` | string | 是 |  |

**返却 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

```json
[
  {
    "summary": "某群分類対資料標簽追加",
    "params": {
      "group_class": 1,
      "name": "学习"
    },
    "notes": "実際之群分類与標簽置換；当前帳号管理権限必要也。"
  }
]
```

### `delete_group_tag`

某群分類自資料標簽削除

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_class` | int | 是 |  |
| `name` | string | 是 |  |

**返却 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

```json
[
  {
    "summary": "某群分類自資料標簽削除",
    "params": {
      "group_class": 1,
      "name": "学习"
    },
    "notes": "実際之群分類与標簽置換；当前帳号管理権限必要也。"
  }
]
```

### `get_group_admin_permissions`

指定管理者之撤回、成員除去、毎日除去上限及検証消息受信状態読取

**属性**：只読

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |

**返却 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer"}, "user_id": {"type": "integer"}, "recall_member_message": {"type": ["boolean", "null"], "description": "撤回成员消息；null 表示服务器未指定"}, "kick_`

**示例**：

```json
[
  {
    "summary": "管理者権限読取",
    "params": {
      "group_id": 20001,
      "user_id": 10001
    },
    "notes": "user_id 者目標管理者之 QQ 号也；加群検証消息受信状態含也。"
  }
]
```

### `get_group_admin_settings`

群管理設定之当前値取得

**属性**：只読

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |

**返却 schema**：`{"type": "object", "properties": {"add_type": {"type": "integer", "description": "加群选项（同 set_group_add_option.add_type）"}, "group_question": {"type": "string", "description": "加群问题（同 set_group_add_opt`

**示例**：

```json
[
  {
    "summary": "群管理設定之当前値取得",
    "params": {
      "group_id": 20001
    },
    "notes": "group_id 者当前帳号訪問可能之群号置換。"
  }
]
```

### `get_group_tags`

某群分類下之資料標簽読取

**属性**：只読

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_class` | int | 是 |  |

**返却 schema**：`{"type": "object", "properties": {"tags": {"type": "array", "description": "资料标签", "items": {"type": "object", "properties": {"id": {"type": "integer", "description": "标签编号"}, "name": {"type": "string`

**示例**：

```json
[
  {
    "summary": "某群分類下之資料標簽読取",
    "params": {
      "group_class": 1
    },
    "notes": "group_class 者実際之群分類番号使用也。"
  }
]
```

### `set_group_add_option`

加群選択肢設定

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `add_type` | int | 否 |  |
| `group_question` | string | 否 |  |
| `group_answer` | string | 否 |  |

**返却 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

```json
[
  {
    "summary": "加群選択肢設定",
    "params": {
      "group_id": 20001,
      "add_type": 2,
      "group_question": "入群用途？",
      "group_answer": "学习交流"
    },
    "notes": "加群設定変更前、先 get_group_admin_settings 依当前状態閲覧、且目標設定値確認必要也。"
  }
]
```

### `set_group_admin`

管理者設定 / 解除

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `enable` | bool | 否 |  |

**返却 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**示例**：

```json
[
  {
    "summary": "管理者設定 / 解除",
    "params": {
      "group_id": 20001,
      "user_id": 10001,
      "enable": true
    },
    "notes": "群主権限必要也；該成員対管理者身分授与也。"
  }
]
```

### `set_group_admin_permissions`

指定管理者之撤回与成員除去権限設定

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `recall_member_message` | bool | 否 |  |
| `kick_member` | bool | 否 |  |
| `kick_member_per_day` | int | 否 |  |

**返却 schema**：`{"type": "null", "description": "服务器确认请求后 data 为 null；不代表已经过客户端回读验证。可用 get_group_admin_permissions 查询。"}`

**示例**：

```json
[
  {
    "summary": "管理者毎日最大十人除去許可",
    "params": {
      "group_id": 20001,
      "user_id": 10001,
      "kick_member": true,
      "kick_member_per_day": 10
    },
    "notes": "当前帳号変更権限必要也；管理者役割授与無也。明示字段仅変更也。除去開者上限提供必須、0 者不限表也；上限変更者同時 kick_member=true 伝必要也。"
  }
]
```

**制約**：["at least one of: recall_member_message, kick_member", "kick_member=true requires kick_member_per_day: 0, 5, 10, 20, 50, 100 or 200", "kick_member_per_day requires kick_member=true"]

### `set_group_admin_receive_verify`

指定管理者之加群検証消息受信可否設定

**参數**：

| 参數 | 類型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | 是 |  |
| `user_id` | uint | 是 |  |
| `enable` | bool | 是 |  |

**返却 schema**：`{"type": "null", "description": "服务器响应确认目标群和管理员后 data 为 null；未确认目标时返回错误。"}`

**示例**：

```json
[
  {
    "summary": "検証消息受信開",
    "params": {
      "group_id": 20001,
      "user_id": 10001,
      "enable": true
    },
    "notes": "user_id 者目標管理者之 QQ 号也；当前帳号変更権限必要也。撤回与成員除去権限与独立也。"
  }
]
```