# OneBot v11 イベントリファレンス（events）

> [!WARNING]
> この内容は完全に AI によって作成されています。注意して閲覧してください。

> 本文は Haizakura（旧 SnowLuma）がクライアントへプッシュする **OneBot v11 イベント形式**を説明します：
> エンベロープ構造、4 種類のイベント（meta / message / notice / request）の完全なフィールド、
> およびメッセージセグメント（segment）の送受信形式です。
>
> **データ出典**：`packages/onebot/src/event-converter/*.ts`（各種イベント変換器）、
> `packages/onebot/src/event-filter.ts`（形式分岐）、
> `packages/onebot/src/instance.ts`（meta イベントの構築とハートビート）。
>
> フィールド名と値はすべてソースコードの `data` リテラルから抽出しています。

---

## 1. イベントエンベロープ

すべてのイベントは JSON オブジェクトで、**共通フィールド**は以下のとおりです（ソース `event-converter/envelope.ts`）：

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `time` | integer | イベント発生時刻（**Unix 秒**） |
| `self_id` | integer | このイベントを受信したボットの QQ 番号 |
| `post_type` | string | イベントの大分類：`message` / `message_sent` / `notice` / `request` / `meta_event` |

3 つの構築器はそれぞれ次のものを生成します：

```js
// notice
{ time, self_id, post_type: "notice", ...fields }
// request
{ time, self_id, post_type: "request", ...fields }
// message / message_sent（由调用方决定 postType）
{ time, self_id, post_type, ...fields }
```

### 1.1 `post_type` 一覧

| `post_type` | 意味 | トリガー |
| --- | --- | --- |
| `message` | 他人のメッセージを受信 | 個人チャット / グループチャット / 臨時セッション |
| `message_sent` | **自分**が送信したメッセージ（自己エコー） | `reportSelfMessage: true` が必要 |
| `notice` | 通知系イベント | 13 種類の `notice_type` |
| `request` | リクエスト系イベント | フレンド追加 / グループ参加 |
| `meta_event` | メタイベント | ライフサイクル + ハートビート |

> ⚠️ `message_sent` はアダプターの `reportSelfMessage: false`（既定）のとき
> **イベント全体が破棄**され、プッシュされません（ソース `shapeEventForAdapter`）。

### 1.2 イベント型 → 変換器の対応

ソース `event-converter/index.ts` の `CONVERTERS` テーブル（**権威ある一覧**）：

| 内部 `kind` | 生成イベント | 変換器 |
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
| `ptt_trans_result` | — | **`null`：明示的に変換しない** |
| `online_devices_changed` | — | **`null`：明示的に変換しない** |
| `friend_remark_changed` | — | **`null`：明示的に変換しない** |

> 表中で `null` にマッピングされている 3 つの内部イベントは
> **OneBot イベントを生成しません**（ソースで明示的に宣言されており、漏れではありません）。

---

## 2. メッセージイベント（`message` / `message_sent`）

### 2.1 グループメッセージ（`message_type: "group"`）

ソース `convertGroupMessage`：

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

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `message_type` | string | 常に `"group"` |
| `sub_type` | string | 常に `"normal"` |
| `message_id` | integer | **負の値になり得ます** |
| `message_seq` | integer | 元のメッセージ連番 |
| `group_id` | integer | グループ番号 |
| `group_name` | string | グループ名 |
| `user_id` | integer | 送信者の QQ 番号 |
| `message` | array \| string | メッセージセグメント配列（または CQ コード文字列、§6 参照） |
| `raw_message` | string | CQ コード形式の元メッセージ |
| `font` | integer | 常に `0` |
| `sender.role` | string | `owner` / `admin` / `member`、既定は `"member"` |
| `sender.card` | string | グループ内の表示名 |
| `sender.sex` | string | 常に `"unknown"`（本実装では提供しません） |
| `sender.age` | integer | 常に `0`（本実装では提供しません） |
| `anonymous` | null | 常に `null` |

> ⚠️ **`sender.sex` と `sender.age` は常にプレースホルダー値**（`"unknown"` / `0`）であり、
> 実際のプロフィールではありません。実際のプロフィールが必要な場合は `get_stranger_info` / `get_group_member_info` を呼び出してください。

### 2.2 個人チャットメッセージ（`message_type: "private"`）

ソース `convertPrivateMessage`、`sub_type` は 2 種類あります：

| シナリオ | `sub_type` | 出所 |
| --- | --- | --- |
| フレンドとの個人チャット | `"friend"` | `convertFriendMessage` |
| 臨時セッション（グループ臨時） | `"group"` | `convertTempMessage` |

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

- 臨時セッション（`sub_type: "group"`）は追加で `sender.group_id`（出身グループ）を持ちます。
- 個人チャットイベントの `sender` には `card` / `role` フィールドが**ありません**。
- **自分が送信した個人チャット**（`message_sent`）で、会話相手が自分でない場合は、追加で
  `target_id`（受信者の QQ 番号）を持ちます。
- `message_id` は `ntMsgSeq` を優先して取り、欠けている場合は `msgSeq` にフォールバックします（ソース
  `hasCanonicalNtSequence`）。

---

## 3. 通知イベント（`notice`）

全部で **13 種類の `notice_type`** があります（ソース `to-notice.ts`）。

### 3.1 グループメンバー増加 — `group_increase`

```json
{
  "time": 1700000000, "self_id": <uin>,
  "post_type": "notice", "notice_type": "group_increase",
  "sub_type": "approve",
  "group_id": 20001, "operator_id": 10002, "user_id": 10001
}
```

`sub_type`：`"approve"`（管理者が承認）/ `"invite"`（招待された）/
その他はイベント由来の `joinType`。判定：操作者と対象が別人なら `invite`、そうでなければ `approve`。

### 3.2 グループメンバー減少 — `group_decrease`

```json
{
  "post_type": "notice", "notice_type": "group_decrease",
  "sub_type": "kick",
  "group_id": 20001, "operator_id": 10002, "user_id": 10001
}
```

`sub_type` の値：`"leave"`（自主退群）/ `"kick"`（キックされた）/
`"kick_me"`（**ボット自身がキックされた**）/ `"disband"`（グループ解散）。

### 3.3 グループミュート — `group_ban`

```json
{
  "post_type": "notice", "notice_type": "group_ban",
  "sub_type": "ban",
  "group_id": 20001, "operator_id": 10002, "user_id": 10001,
  "duration": 600
}
```

`sub_type`：`duration > 0` → `"ban"`；`duration == 0` → `"lift_ban"`。
`duration` の単位は**秒**です。

### 3.4 グループ管理者の変動 — `group_admin`

```json
{
  "post_type": "notice", "notice_type": "group_admin",
  "sub_type": "set",
  "group_id": 20001, "user_id": 10001
}
```

`sub_type`：`"set"`（管理者に設定）/ `"unset"`（解除）。

### 3.5 フレンドの撤回 — `friend_recall`

```json
{
  "post_type": "notice", "notice_type": "friend_recall",
  "user_id": 10001, "message_id": -123456
}
```

### 3.6 グループの撤回 — `group_recall`

```json
{
  "post_type": "notice", "notice_type": "group_recall",
  "group_id": 20001, "operator_id": 10002,
  "user_id": 10001, "message_id": -123456
}
```

`operator_id` は撤回を実行した者、`user_id` は元メッセージの作成者です。

### 3.7 つつき — `notify` / `poke`

**フレンドへのつつき**：

```json
{
  "post_type": "notice", "notice_type": "notify", "sub_type": "poke",
  "user_id": 10001, "sender_id": 10001, "target_id": <uin>,
  "action": "戳了戳", "suffix": "的脸", "action_img_url": "https://..."
}
```

**グループへのつつき**：上記と同様ですが、`group_id` + `user_id` を使います（`sender_id` は含みません）。

| フィールド | 説明 |
| --- | --- |
| `action` | 動作の文言。例：`戳了戳` |
| `suffix` | 接尾辞の文言 |
| `action_img_url` | 動作画像の URL |

### 3.8 グループのエッセンスメッセージ — `essence`

```json
{
  "post_type": "notice", "notice_type": "essence",
  "sub_type": "add",
  "group_id": 20001, "user_id": 10001, "sender_id": 10001,
  "operator_id": 10002, "message_id": -123456,
  "message_seq": 4567, "random": 123456789
}
```

`sub_type`：`"add"`（エッセンスに設定）/ `"delete"`（エッセンスから除外）。

### 3.9 グループファイルのアップロード — `group_upload`

```json
{
  "post_type": "notice", "notice_type": "group_upload",
  "group_id": 20001, "user_id": 10001,
  "file": { "id": "<file-id>", "name": "a.zip", "size": 1024, "busid": 102 }
}
```

### 3.10 フレンド追加 — `friend_add`

```json
{ "post_type": "notice", "notice_type": "friend_add", "user_id": 10001 }
```

### 3.11 グループ内表示名の変更 — `group_card`

```json
{
  "post_type": "notice", "notice_type": "group_card",
  "group_id": 20001, "user_id": 10001,
  "card_new": "新名片", "card_old": "旧名片"
}
```

### 3.12 ボットのオフライン — `bot_offline`

```json
{
  "post_type": "notice", "notice_type": "bot_offline",
  "user_id": <uin>, "tag": "<tag>", "message": "<原因>"
}
```

> これは**非標準**の通知タイプで、接続が切断されたことを伝えるために使われます。

### 3.13 グループメッセージへのリアクション — `group_msg_emoji_like`

```json
{
  "post_type": "notice", "notice_type": "group_msg_emoji_like",
  "sub_type": "add",
  "group_id": 20001, "user_id": 10002, "operator_id": 10002,
  "message_id": -123456, "message_seq": 4567,
  "likes": [ { "emoji_id": "128077", "count": 1 } ]
}
```

`sub_type`：`"add"`（追加）/ `"remove"`（取消）。

### 3.14 `notify` のその他の `sub_type`

ソース `to-notice.ts` に現れる `notify` のサブタイプは全部で **5 種類**です（`poke` は 2 回現れ、
フレンド用とグループ用の 2 つの変換器に分かれています）：

| `sub_type` | 追加フィールド | 説明 |
| --- | --- | --- |
| `poke` | `user_id`, `target_id`, `action`, `suffix`, `action_img_url`（フレンド形態はさらに `sender_id` を含む） | つつき |
| `profile_like` | `operator_id`, `operator_nick`, `times` | プロフィールへのいいね |
| `title` | `group_id`, `user_id`, `title` | グループ専用称号の変更 |
| `group_name` | `group_id`, `user_id`, `name_new` | グループ名の変更 |
| `input_status` | `user_id`, `event_type`, `status_text` | フレンドの入力状態 |

### 3.15 ボット自身の状態 — `bot_status`

```json
{
  "time": 1700000000, "self_id": <uin>,
  "post_type": "notice", "notice_type": "bot_status",
  "sub_type": "online", "user_id": <uin>
}
```

`sub_type`：`"online"`（ログイン成功）/ `"offline"`（オフライン）。
> 同じく**非標準**の拡張タイプです（ソース `makeBotStatusEvent`）。

---

## 4. リクエストイベント（`request`）

### 4.1 フレンド追加リクエスト — `request_type: "friend"`

```json
{
  "time": 1700000000, "self_id": <uin>,
  "post_type": "request", "request_type": "friend",
  "user_id": 10001,
  "comment": "我是...",
  "flag": "<flag>"
}
```

### 4.2 グループ参加リクエスト / 招待 — `request_type: "group"`

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

| フィールド | 説明 |
| --- | --- |
| `sub_type` | `"invite"`（招待）/ `"add"`（参加申請）、既定は `"invite"` |
| `invited_id` | **招待された者の UIN > 0 の場合にのみ出現** |
| `comment` | 検証メッセージ |
| `flag` | `set_friend_add_request` / `set_group_add_request` への返送に使用 |

---

## 5. メタイベント（`meta_event`）

ソース `instance.ts`。

### 5.1 ライフサイクル — `meta_event_type: "lifecycle"`

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

`sub_type` の値：

| `sub_type` | トリガーとなるタイミング |
| --- | --- |
| `"connect"` | ネットワークアダプターが接続を確立したときにプッシュ |
| `"enable"` | アダプターが有効化されたときにプッシュ |
| `"disable"` | アダプターが閉じられた（`closeConnections`）ときにプッシュ |

`status.online`：アカウントがオンライン；`status.good`：`online && bridge.receiveHealthy`。

### 5.2 ハートビート — `meta_event_type: "heartbeat"`

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

- **間隔は 30000 ms（30 秒）**、ソース `OneBotInstance.HEARTBEAT_INTERVAL = 3e4`。
- `interval` フィールドはその間隔をそのまま返し、クライアントの自己診断に便利です。
- タイマーは `unref()` を呼び出すため、プロセスの終了を妨げません。

### 5.3 接続確立時の bootstrap

**イベント系クライアント（`Event` / `Universal`）は（再）接続後すぐに 3 フレームを受信します**
（ソース `adapter.ts` の `bootstrapMetaFrames`）。順序は固定です：

```
1. meta_event / lifecycle / sub_type: "connect"
2. meta_event / lifecycle / sub_type: "enable"
3. meta_event / heartbeat
```

- サーバーは**閉じる際**に、`Api` 以外の接続へ `lifecycle` / `sub_type: "disable"` をプッシュします。
- SSE 接続も同様に、まず bootstrap を補完してから履歴フレームを補完します。
- クライアントは**接続直後に meta イベントを受信しても許容できなければなりません**。
  `lifecycle(connect)` を業務イベントと誤判定しないでください。

> ⚠️ **`meta_event_type: "connect"` という書き方はありません**：接続系イベントは
> `lifecycle` + `sub_type` で表現されます。これが本実装の形態です。

---

## 6. メッセージセグメント（segment）形式

### 6.1 基本構造

```json
{ "type": "text", "data": { "text": "你好" } }
```

`message` フィールド（`messageFormat: "array"`）は**メッセージセグメント配列**です。
`messageFormat: "string"` の場合は CQ コード文字列 `raw_message` に置き換わります。

### 6.2 受信方向：16 種類のセグメントタイプ

ソース `ELEMENT_CODECS`（`element-codecs.ts`）、全部で **16** 種類です：

| `type` | `data` フィールド | 説明 |
| --- | --- | --- |
| `text` | `text` | プレーンテキスト |
| `face` | `id`, `resultId?`, `large?` | QQ 絵文字 |
| `at` | `qq`（`"all"` は全体を表す） | @某人 |
| `reply` | `id` | 引用返信 |
| `image` | `url`, `file`, `sub_type`, `summary`, `type?`, `emoji_id?`, `emoji_package_id?`, `key?` | 画像 / スタンプ |
| `record` | `file`, `url` | 音声 |
| `video` | `file`, `url` | 動画 |
| `json` | `data` | JSON カード |
| `xml` | `data`, `resid`（既定 `35`） | XML カード |
| `file` | `file`, `file_id`, `file_size`, `name`, `size`, `id`, `url`, `file_hash` | ファイル |
| `mface` | （`image` に変換） | マーケット絵文字 |
| `poke` | `type` | つつき |
| `flash_file` | `title`, `file_set_id`, `scene_type`, `thumb` | フラッシュ転送ファイル |
| `forward` | `id` | 結合転送 |
| `markdown` | `content` | Markdown メッセージ |
| `inline_keyboard` | `bot_appid`, `rows[].buttons[]` | インラインキーボード |

**要点**：

- `mface` は受信方向では**`image` に統合され**、`data` に
  `emoji_id` / `emoji_package_id` / `key` を含み、`url` は
  `https://gxh.vip.qq.com/club/item/parcel/item/<前2位>/<emoji_id>/raw300.gif` を指します。
- `reply` の `id` は**文字列**です。対象メッセージを解決できない場合、そのセグメントは**省略されます**
  （ログには `quote target unresolved ...; omitting reply id` と出力されます）。
- `at` の `qq` が `"all"` の場合はメンバー全体への @ を表します。
- `image` の `data.type` が `"flash"` の場合は閃照を表します。

### 6.3 送信方向：追加の 9 種類の互換セグメント

ソース `message-parser.ts` の `segmentToElement` が追加で受け付けます：

| `type` | 必須フィールド | 変換結果 |
| --- | --- | --- |
| `share` | `url`, `title`（`content`, `image` は省略可） | → `json` カード（`com.tencent.structmsg` / `news`） |
| `music` | `type` + `id`、または `custom` タイプ + `url`/`audio`/`title` | → `json` カード（外部リンク署名サービスが必要） |
| `location` | ソース参照 | 位置カード |
| `contact` | ソース参照 | フレンド／グループ推薦カード |
| `rps` | — | じゃんけん |
| `dice` | — | サイコロ |
| `shake` | — | ウィンドウシェイク |
| `anonymous` | — | 匿名メッセージのマーク |
| `node` | — | **結合転送ノードリスト内でのみ許可** |

> `node` をトップレベルに置くと `UNSENDABLE_TYPE` をスローします：
> `message segment "node" is only valid inside a forward node list`。
>
> `music` の署名サービスは既定で `https://ss.xingzhige.com/music_card/card` で、
> 外部ネットワークから到達可能である必要があります。失敗した場合、そのセグメントはスキップされます。

### 6.4 空テキストプレースホルダー

セグメント配列内で `text` フィールドが**ちょうど `""`** である text セグメントは**互換プレースホルダー**と見なされ、
「送信可能セグメント」に数えられません：

```js
function isExplicitEmptyTextPlaceholder(segment) { /* text === "" 精确匹配 */ }
```

違い：

| 書き方 | 動作 |
| --- | --- |
| `{ "type":"text", "data":{ "text":"" } }` | 互換プレースホルダー、**無視** |
| `{ "type":"text", "data":{} }` | 通常の検証 → エラー |
| `{ "type":"text", "data":{ "text":null } }` | 通常の検証 → エラー |
| `{ "type":"text", "data":{ "text":"  " } }` | 通常の検証（空白のみでも内容と見なす） |

### 6.5 CQ コード

文字列形式では CQ コードを使用します。正規表現（`message-parser.ts`）：

```js
var CQ_REGEX = /\[CQ:([A-Za-z][A-Za-z0-9_]*)(?:,([^\]]*))?\]/g;
```

例：`[CQ:face,id=1]`、`[CQ:at,qq=10001]`。
`auto_escape: true` のとき、文字列中の CQ コードは**解析されず**、プレーンテキストとして送信されます。

---

## 7. メッセージ ID の説明

- `message_id` は**負の値になり得ます**。これは正常な挙動であり、負数を異常として扱わないでください。
- 個人チャットの `message_id` は `ntMsgSeq` を優先して使用します。グループチャットでは `msgSeq` を使用します
  （ソース `applyMessageIdResolver`）。
- 解決できない場合は元の連番 `seq` にフォールバックします。`seq === 0` の場合は `0` を返します。
- イベントに対して `message_id` を返す場合（`get_msg`、`delete_msg` など）、
  メッセージが**現在のアカウントのメッセージストア**で照会可能でなければ、
  `message not found` が返ります。

---

## 8. クライアント実装の推奨事項

| シナリオ | 推奨 |
| --- | --- |
| 接続直後に meta イベントを受信 | 正常です。まず `lifecycle(connect/enable)` を無視してから業務を処理します |
| 自分が送ったメッセージを受信できない | 必要なら `reportSelfMessage: true` を有効にします |
| `message` が配列でなく文字列 | アダプターの `messageFormat: "string"` です。設定を変更するか CQ コードとして解析します |
| ハートビートによる死活監視 | `interval`（30000ms）を基準にし、2〜3 回の欠落を許容します |
| イベントの重複排除 | 切断と再接続で **bootstrap が再送**され、SSE は `Last-Event-ID` による補完をサポートするため、`message_id` で重複排除する必要があります |
| イベント不要でアクションのみ | 接続の `role` に `Api` を使用 |
| アクション不要でイベントのみ | 接続の `role` に `Event` を使用 |

---

## 9. 標準 OneBot v11 との差異

| 項目 | 差異 |
| --- | --- |
| `sender.sex` / `sender.age` | 常に `"unknown"` / `0` で、実際のプロフィールではありません |
| `bot_offline` | 非標準の `notice_type` |
| `bot_status` | 非標準の `notice_type`（`sub_type`: `online`/`offline`） |
| `message_sent` | `reportSelfMessage` が必要でないとプッシュされません |
| 3 つの内部イベント | `ptt_trans_result` / `online_devices_changed` / `friend_remark_changed` は**明示的に変換しません** |
| `get_supported_actions` | ❌ 未実装（`actions.md` 参照） |
| 追加フィールド | `message_seq`（メッセージおよび一部の通知イベント）、`group_name`（グループメッセージ）、`target_id`（自己エコーの個人チャット）などの拡張フィールド |

---

## 10. 宣言

| 項目 | 状態 |
| --- | --- |
| エンベロープの 3 つの構築器 | **検証済み**：`envelope.ts` |
| 13 種類の `notice_type` と全フィールド | **検証済み**：`to-notice.ts` のリテラル |
| 6 種類の `notify` サブタイプ | **検証済み**：`to-notice.ts` |
| 2 種類の `request_type` | **検証済み**：`to-request.ts` |
| meta イベントの `sub_type` と bootstrap の順序 | **検証済み**：`instance.ts` + `adapter.ts` |
| ハートビート 30000ms | **検証済み**：`HEARTBEAT_INTERVAL = 3e4` |
| 16 種類の受信セグメントタイプ | **検証済み**：`ELEMENT_CODECS` |
| 9 種類の送信互換セグメント | **検証済み**：`segmentToElement` |
| 空テキストプレースホルダーの規則 | **検証済み**：`isExplicitEmptyTextPlaceholder` |
| 各イベントの実機 JSON | **未検証**：フィールドはソース由来で、実機でのパケットキャプチャ検証は未実施 |

> 本文は実機でイベントストリームをキャプチャしたものでは**ありません**。すべてのフィールド名と値はソースコードのリテラル抽出によるもので、
> 構造は信頼できます。ただし**フィールドが出現するかどうかの条件**（`invited_id`、`target_id` など）は、
> 実際に接続する際には実イベントを基準にすることをお勧めします。
