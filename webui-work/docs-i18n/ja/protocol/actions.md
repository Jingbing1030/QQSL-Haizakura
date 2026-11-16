# OneBot アクションリファレンス（全 222 個）


> **出典**：公式アーカイブ `packages/mcp/src/generated/catalog.json`（597,554 バイト）。

> これは原作者が `pnpm --filter @snowluma/mcp gen` でアクション定義から**自動生成**したカタログであり、
> すでに公開を終了したドキュメントサイト `haizakura.github.io/zh/docs/api` のデータソースでもあります。**AI による生成ではありません。**

全 **222 個のアクション**、**12 分類**。

## 分類索引

| 分類 | アクション数 |
|---|---|
| 情報 | 5 |
| メッセージ | 6 |
| フレンド | 3 |
| グループ情報 | 7 |
| グループ管理 | 24 |
| グループファイル | 12 |
| リクエスト | 2 |
| 拡張 | 115 |
| グループアルバム | 9 |
| スペース | 29 |
| システム絵文字 | 4 |
| ストリーミングインターフェース | 6 |

## 情報（5 個）

### `can_send_image`

**属性**：読み取り専用

**返却 schema**：`{"type": "object", "properties": {"yes": {"type": "boolean", "description": "是否支持发送图片"}}, "required": ["yes"]}`

**例**：

```json
[
  {
    "summary": "基本的な呼び出し",
    "params": {}
  }
]
```

### `can_send_record`

**属性**：読み取り専用

**返却 schema**：`{"type": "object", "properties": {"yes": {"type": "boolean", "description": "是否支持发送语音"}}, "required": ["yes"]}`

**例**：

```json
[
  {
    "summary": "基本的な呼び出し",
    "params": {}
  }
]
```

### `get_login_info`

**属性**：読み取り専用

**返却 schema**：`{"type": "object", "properties": {"user_id": {"type": "integer", "description": "登录 QQ 号"}, "nickname": {"type": "string", "description": "登录昵称"}}, "required": ["user_id", "nickname"]}`

**例**：

```json
[
  {
    "summary": "基本的な呼び出し",
    "params": {}
  }
]
```

### `get_status`

**属性**：読み取り専用

**返却 schema**：`{"type": "object", "properties": {"online": {"type": "boolean", "description": "是否在线"}, "good": {"type": "boolean", "description": "收发链路健康状态；确认接收停滞或主动请求连接失效时为 false"}, "time": {"type": "integer", "des`

**例**：

```json
[
  {
    "summary": "基本的な呼び出し",
    "params": {}
  }
]
```

### `get_version_info`

**属性**：読み取り専用

**返却 schema**：`{"type": "object", "properties": {"app_name": {"type": "string", "description": "实现名称（Haizakura）"}, "app_version": {"type": "string", "description": "实现版本"}, "protocol_version": {"type": "string", "des`

**例**：

```json
[
  {
    "summary": "基本的な呼び出し",
    "params": {}
  }
]
```

## メッセージ（6 個）

### `delete_msg`

メッセージを撤回する

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `message_id` | messageId | はい |  |

**返却 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**例**：

```json
[
  {
    "summary": "メッセージを撤回する",
    "params": {
      "message_id": -123456
    },
    "notes": "メッセージイベントまたは送信結果に含まれる実際の message_id を使ってください。負の値は有効です。メッセージは現在のアカウントのメッセージストアから照会できる必要があります。"
  }
]
```

### `get_msg`

メッセージを取得する

**属性**：読み取り専用

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `message_id` | messageId | はい |  |

**返却 schema**：`{"allOf": [{"type": "object", "properties": {"time": {"type": "integer", "description": "消息时间，Unix 秒"}, "message_type": {"type": "string", "enum": ["private", "group"]}, "sub_type": {"type": "string",`

**例**：

```json
[
  {
    "summary": "メッセージを取得する",
    "params": {
      "message_id": -123456
    },
    "notes": "メッセージイベントまたは送信結果に含まれる実際の message_id を使ってください。負の値は有効です。メッセージは現在のアカウントのメッセージストアから照会できる必要があります。"
  }
]
```

### `send_custom_face`

アカウントのコレクション絵文字を送信する（emoji_id または MD5）。絵文字の表示スタイルを保持します

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `emoji_id` | string | はい |  |
| `group_id` | uint | いいえ |  |
| `user_id` | uint | いいえ |  |
| `reply_to` | messageId | いいえ |  |

**返却 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**例**：

```json
[
  {
    "summary": "アカウントのコレクション絵文字を送信する（emoji_id または MD5）。絵文字の表示スタイルを保持します",
    "params": {
      "group_id": 20001,
      "emoji_id": "<emoji-id-from-fetch_custom_face_detail>"
    },
    "notes": "グループチャットとプライベートチャットの送信先はどちらか一方のみ指定できます。emoji_id は fetch_custom_face_detail から取得します。"
  }
]
```

### `send_group_msg`

グループメッセージを送信する

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | はい |  |
| `message` | message | はい |  |
| `auto_escape` | bool | いいえ |  |

**返却 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**例**：

```json
[
  {
    "summary": "グループメッセージを送信する",
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
    "notes": "送信先のグループ番号に置き換えてください。成功時に返る message_id は負の値になることがあります。"
  }
]
```

### `send_msg`

メッセージを送信する（message_type / グループ番号によりグループチャットまたはプライベートチャットへ自動ルーティング）

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `message` | message | はい |  |
| `message_type` | string | いいえ |  |
| `group_id` | uint | いいえ |  |
| `user_id` | uint | いいえ |  |
| `auto_escape` | bool | いいえ |  |

**返却 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**例**：

```json
[
  {
    "summary": "メッセージを送信する（message_type / グループ番号によりグループチャットまたはプライベートチャットへ自動ルーティング）",
    "params": {
      "message_type": "group",
      "group_id": 20001,
      "message": "你好"
    },
    "notes": "対応する送信先を必ず指定してください。プライベートチャットでは message_type=private と user_id を使います。"
  }
]
```

### `send_private_msg`

プライベートメッセージを送信する

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `user_id` | uint | はい |  |
| `message` | message | はい |  |
| `group_id` | int | いいえ |  |
| `auto_escape` | bool | いいえ |  |

**返却 schema**：`{"type": "object", "properties": {"message_id": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647, "not": {"const": 0}, "description": "非零有符号 32 位消息 ID，负值合法；必须原样保留"}}, "required": ["me`

**例**：

```json
[
  {
    "summary": "プライベートメッセージを送信する",
    "params": {
      "user_id": 10001,
      "message": "你好"
    },
    "notes": "送信先のフレンド QQ 番号に置き換えてください。一時セッションでは送信元の group_id を別途渡す必要があります。"
  }
]
```

## フレンド（3 個）

### `delete_friend`

フレンドを削除する

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `user_id` | uint | はい |  |
| `block` | bool | いいえ |  |

**返却 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**例**：

```json
[
  {
    "summary": "フレンドを削除する",
    "params": {
      "user_id": 10001,
      "block": false
    },
    "notes": "指定したフレンドを削除します。明確に削除が必要な場合にのみ呼び出してください。"
  }
]
```

### `get_friend_list`

フレンドリストを取得する

**属性**：読み取り専用

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `with_profile` | bool | いいえ |  |

**返却 schema**：`{"type": "array", "items": {"type": "object", "properties": {"user_id": {"type": "integer", "description": "好友 QQ 号"}, "nickname": {"type": "string", "description": "好友昵称"}, "remark": {"type": "string`

**例**：

```json
[
  {
    "summary": "フレンドリストを取得する",
    "params": {}
  }
]
```

### `get_stranger_info`

見知らぬユーザーの情報を取得する

**属性**：読み取り専用

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `user_id` | uint | はい |  |

**返却 schema**：`{"type": "object", "properties": {"long_nick": {"type": "string", "description": "个性签名"}, "sex": {"type": "string", "description": "性别（male/female/unknown）"}, "age": {"type": "integer", "description":`

**例**：

```json
[
  {
    "summary": "見知らぬユーザーの情報を取得する",
    "params": {
      "user_id": 10001
    },
    "notes": "照会したい QQ 番号に置き換えてください。"
  }
]
```

## グループ情報（7 個）

### `get_group_honor_info`

グループの荣誉情報を取得する

**属性**：読み取り専用

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | はい |  |
| `type` | string | いいえ |  |

**返却 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer"}, "current_talkative": {"anyOf": [{"type": "object", "properties": {"user_id": {"type": ["number", "string", "null"]}, "nickname": {"ty`

**例**：

```json
[
  {
    "summary": "グループの荣誉情報を取得する",
    "params": {
      "group_id": 20001,
      "type": "all"
    },
    "notes": "要求していない分類も空配列として返ります。現在の龍王は null になることがあります。"
  }
]
```

### `get_group_info`

グループ情報を取得する

**属性**：読み取り専用

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | はい |  |
| `no_cache` | bool | いいえ |  |

**返却 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名"}, "group_remark": {"type": "string", "description": "当前账号设置`

**例**：

```json
[
  {
    "summary": "グループ情報を取得する",
    "params": {
      "group_id": 20001
    },
    "notes": "group_id は現在のアカウントがアクセスできるグループ番号に置き換えてください。"
  }
]
```

### `get_group_list`

グループリストを取得する

**属性**：読み取り専用

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `no_cache` | bool | いいえ |  |

**返却 schema**：`{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名"}, "group_remark": {"type": "stri`

**例**：

```json
[
  {
    "summary": "グループリストを取得する",
    "params": {
      "no_cache": false
    }
  }
]
```

### `get_group_member_info`

グループメンバーの情報を取得する

**属性**：読み取り専用

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | はい |  |
| `user_id` | uint | はい |  |
| `no_cache` | bool | いいえ |  |

**返却 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "user_id": {"type": "integer", "description": "QQ 号"}, "nickname": {"type": "string", "description": "昵称"}, "car`

**例**：

```json
[
  {
    "summary": "グループメンバーの情報を取得する",
    "params": {
      "group_id": 20001,
      "user_id": 10001
    },
    "notes": "group_id は現在のアカウントがアクセスできるグループ番号に置き換えてください。"
  }
]
```

### `get_group_member_list`

グループメンバーのリストを取得する

**属性**：読み取り専用

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | はい |  |
| `no_cache` | bool | いいえ |  |

**返却 schema**：`{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "user_id": {"type": "integer", "description": "QQ 号"}, "nickname": {"type": "string",`

**例**：

```json
[
  {
    "summary": "グループメンバーのリストを取得する",
    "params": {
      "group_id": 20001
    },
    "notes": "group_id は現在のアカウントがアクセスできるグループ番号に置き換えてください。"
  }
]
```

### `get_group_share_link`

グループの共有リンクを取得する

**属性**：読み取り専用

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | はい |  |
| `need_short_url` | bool | いいえ |  |
| `src_id` | int | いいえ |  |
| `additional_param` | string | いいえ |  |

**返却 schema**：`{"type": "object", "properties": {"url": {"type": "string", "description": "加群分享链接"}}, "required": ["url"]}`

**例**：

```json
[
  {
    "summary": "グループの共有リンクを取得する",
    "params": {
      "group_id": 20001,
      "need_short_url": true
    },
    "notes": "group_id は現在のアカウントがアクセスできるグループ番号に置き換えてください。"
  }
]
```

### `get_group_system_msg`

グループのシステムメッセージを取得する

**属性**：読み取り専用

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | いいえ |  |
| `only_pending` | bool | いいえ |  |
| `count` | int | いいえ |  |

**返却 schema**：`{"type": "array", "items": {"type": "object", "properties": {"group_id": {"type": "integer", "description": "群号"}, "group_name": {"type": "string", "description": "群名称"}, "request_id": {"type": "integ`

**例**：

```json
[
  {
    "summary": "グループのシステムメッセージを取得する",
    "params": {
      "group_id": 20001,
      "only_pending": true,
      "count": 20
    },
    "notes": "group_id は現在のアカウントがアクセスできるグループ番号に置き換えてください。"
  }
]
```

## グループ管理（24 個）

### `add_group_tag`

あるグループ分類にプロフィールタグを追加する

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_class` | int | はい |  |
| `name` | string | はい |  |

**返却 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**例**：

```json
[
  {
    "summary": "あるグループ分類にプロフィールタグを追加する",
    "params": {
      "group_class": 1,
      "name": "学习"
    },
    "notes": "実際のグループ分類とタグに置き換えてください。現在のアカウントに管理権限が必要です。"
  }
]
```

### `delete_group_tag`

あるグループ分類からプロフィールタグを削除する

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_class` | int | はい |  |
| `name` | string | はい |  |

**返却 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**例**：

```json
[
  {
    "summary": "あるグループ分類からプロフィールタグを削除する",
    "params": {
      "group_class": 1,
      "name": "学习"
    },
    "notes": "実際のグループ分類とタグに置き換えてください。現在のアカウントに管理権限が必要です。"
  }
]
```

### `get_group_admin_permissions`

指定した管理者の撤回、メンバー除去、1 日あたりの除去上限、および検証メッセージ受信の状態を読み取る

**属性**：読み取り専用

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | はい |  |
| `user_id` | uint | はい |  |

**返却 schema**：`{"type": "object", "properties": {"group_id": {"type": "integer"}, "user_id": {"type": "integer"}, "recall_member_message": {"type": ["boolean", "null"], "description": "撤回成员消息；null 表示服务器未指定"}, "kick_`

**例**：

```json
[
  {
    "summary": "管理者権限を読み取る",
    "params": {
      "group_id": 20001,
      "user_id": 10001
    },
    "notes": "user_id は対象管理者の QQ 番号です。グループ参加検証メッセージの受信状態を含みます。"
  }
]
```

### `get_group_admin_settings`

グループ管理設定の現在値を取得する

**属性**：読み取り専用

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | はい |  |

**返却 schema**：`{"type": "object", "properties": {"add_type": {"type": "integer", "description": "加群选项（同 set_group_add_option.add_type）"}, "group_question": {"type": "string", "description": "加群问题（同 set_group_add_opt`

**例**：

```json
[
  {
    "summary": "グループ管理設定の現在値を取得する",
    "params": {
      "group_id": 20001
    },
    "notes": "group_id は現在のアカウントがアクセスできるグループ番号に置き換えてください。"
  }
]
```

### `get_group_tags`

あるグループ分類のプロフィールタグを読み取る

**属性**：読み取り専用

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_class` | int | はい |  |

**返却 schema**：`{"type": "object", "properties": {"tags": {"type": "array", "description": "资料标签", "items": {"type": "object", "properties": {"id": {"type": "integer", "description": "标签编号"}, "name": {"type": "string`

**例**：

```json
[
  {
    "summary": "あるグループ分類のプロフィールタグを読み取る",
    "params": {
      "group_class": 1
    },
    "notes": "group_class には実際のグループ分類番号を使います。"
  }
]
```

### `set_group_add_option`

グループ参加オプションを設定する

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | はい |  |
| `add_type` | int | いいえ |  |
| `group_question` | string | いいえ |  |
| `group_answer` | string | いいえ |  |

**返却 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**例**：

```json
[
  {
    "summary": "グループ参加オプションを設定する",
    "params": {
      "group_id": 20001,
      "add_type": 2,
      "group_question": "入群用途？",
      "group_answer": "学习交流"
    },
    "notes": "グループ参加設定を変更する前に、get_group_admin_settings で現在の状態を確認し、設定したい値を確定してください。"
  }
]
```

### `set_group_admin`

管理者を設定 / 解除する

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | はい |  |
| `user_id` | uint | はい |  |
| `enable` | bool | いいえ |  |

**返却 schema**：`{"type": "null", "description": "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"}`

**例**：

```json
[
  {
    "summary": "管理者を設定 / 解除する",
    "params": {
      "group_id": 20001,
      "user_id": 10001,
      "enable": true
    },
    "notes": "グループ所有者の権限が必要です。そのメンバーに管理者の立場を付与します。"
  }
]
```

### `set_group_admin_permissions`

指定した管理者の撤回およびメンバー除去の権限を設定する

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | はい |  |
| `user_id` | uint | はい |  |
| `recall_member_message` | bool | いいえ |  |
| `kick_member` | bool | いいえ |  |
| `kick_member_per_day` | int | いいえ |  |

**返却 schema**：`{"type": "null", "description": "服务器确认请求后 data 为 null；不代表已经过客户端回读验证。可用 get_group_admin_permissions 查询。"}`

**例**：

```json
[
  {
    "summary": "管理者が 1 日に最大 10 人まで除去できるようにする",
    "params": {
      "group_id": 20001,
      "user_id": 10001,
      "kick_member": true,
      "kick_member_per_day": 10
    },
    "notes": "現在のアカウントに変更権限が必要です。管理者の役割は付与しません。明示したフィールドのみ変更します。除去を有効にするには上限の指定が必須で、0 は無制限を意味します。上限を変更するときは kick_member=true も同時に渡す必要があります。"
  }
]
```

**制約**：["at least one of: recall_member_message, kick_member", "kick_member=true requires kick_member_per_day: 0, 5, 10, 20, 50, 100 or 200", "kick_member_per_day requires kick_member=true"]

### `set_group_admin_receive_verify`

指定した管理者がグループ参加検証メッセージを受信するかどうかを設定する

**パラメーター**：

| パラメーター | 型 | 必須 | 説明 |
|---|---|---|---|
| `group_id` | uint | はい |  |
| `user_id` | uint | はい |  |
| `enable` | bool | はい |  |

**返却 schema**：`{"type": "null", "description": "服务器响应确认目标群和管理员后 data 为 null；未确认目标时返回错误。"}`

**例**：

```json
[
  {
    "summary": "検証メッセージの受信を有効にする",
    "params": {
      "group_id": 20001,
      "user_id": 10001,
      "enable": true
    },
    "notes": "user_id は対象管理者の QQ 番号です。現在のアカウントに変更権限が必要です。撤回およびメンバー除去の権限とは独立しています。"
  }
]
```
