# OneBot v11 接続ガイド

> [!WARNING]
> この内容は完全に AI によって作成されています。注意して閲覧してください。

> 本文は Haizakura（旧 SnowLuma）による **OneBot v11** プロトコルの実装を説明します：
> 4 種類のネットワーク接続方式、認証、メッセージ形式、イベントプッシュです。
>
> **データ出典**：`packages/onebot/src/config.ts`（設定構造と検証）、
> `packages/onebot/src/network/*.ts`（各アダプターの実装）、
> `packages/onebot/src/event-filter.ts`（形式分岐）、
> さらに実行インスタンスの `GET /api/config/:uin` で実際の設定と照合しています。

---

## 1. 接続方式の概要

実装は **4 種類のアダプター**を提供します（ソース `config.ts` の `networks` 構造）。
このうち HTTP サーバーは**追加で** WebSocket と SSE を有効にできます：

| 設定キー | 方向 | プロトコル | 接続を開始する側 | 典型的な用途 |
| --- | --- | --- | --- | --- |
| `httpServers` | 受信 | HTTP + 任意で WS + 任意で SSE | フレームワーク／クライアント → Haizakura | 最も一般的。1 ポートで 3 プロトコル |
| `httpClients` | 送信 | HTTP POST（逆方向 HTTP） | Haizakura → あなたの HTTP サービス | 公衆 IP がない場合のイベント報告 |
| `wsServers` | 受信 | 順方向 WebSocket | フレームワーク／クライアント → Haizakura | 低遅延の双方向通信 |
| `wsClients` | 送信 | 逆方向 WebSocket | Haizakura → あなたの WS サービス | **NapCat / go-cqhttp エコシステムで第一選択** |

補助スイッチ（いずれも `httpServers` のエントリに属します）：

| フィールド | 既定 | 役割 |
| --- | --- | --- |
| `enableWebSocket` | `false` | 同一ポートで追加的に WebSocket アップグレードを受け付けます |
| `enableSse` | `false` | `GET <path>/_events` の SSE イベントストリームを公開します |

> **「順方向」と「逆方向」の判定**：**Haizakura がサーバー側かクライアント側か**で決まります。
> `*Servers` = Haizakura が待ち受ける（順方向）、`*Clients` = Haizakura が外部へ接続する（逆方向）。

---

## 2. 設定ファイルと既定値

### 2.1 ファイルの場所

```
config/onebot.json            # 全局默认
config/onebot_<uin>.json      # 按账号覆盖（uin 纯数字）
```

- 読み込み順：`config/onebot.json` → `config/onebot_<uin>.json`。後者が前者を上書きします。
- 認識するのは `onebot_<digits>.json` のみです。`onebot_1700000000.json` のような
  **タイムスタンプ形式のファイル名は無視されます**（ソース `PER_UIN_CONFIG = /^onebot_(\d+)\.json$/`）。
- ファイルが存在しない場合は組み込みの既定値を使用します（下記参照）。

### 2.2 組み込みの既定設定

```json
{
  "networks": {
    "httpServers": [
      {
        "name": "http-default",
        "host": "127.0.0.1",
        "port": 3000,
        "path": "/",
        "enableWebSocket": false,
        "enableSse": false,
        "accessToken": "<随机 base64url>",
        "messageFormat": "array",
        "reportSelfMessage": false
      }
    ],
    "httpClients": [],
    "wsServers": [
      {
        "name": "ws-default",
        "host": "127.0.0.1",
        "port": 3001,
        "path": "/",
        "role": "Universal",
        "accessToken": "<随机 base64url>",
        "messageFormat": "array",
        "reportSelfMessage": false
      }
    ],
    "wsClients": []
  },
  "statusCommand": {
    "enabled": true,
    "swallow": false,
    "cooldownSeconds": 5,
    "trigger": "#Haizakura"
  },
  "historySync": { "enabled": false },
  "notifications": { "channelIds": [] }
}
```

> `accessToken` は `randomBytes(32).toString("base64url")` で生成され、**43 文字**です。
> 既定では `127.0.0.1` のみを待ち受けます。コンテナ外からアクセスするには明示的に `0.0.0.0` に変更する必要があります。

### 2.3 各アダプターのフィールド

**共通フィールド**（4 種類すべてに存在）

| フィールド | 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `name` | string | 自動生成 | アダプターの一意名。衝突すると読み込みが拒否されます |
| `enabled` | bool | `true` | `false` にすると設定を削除せずに無効化できます |
| `accessToken` | string | ランダム | 空欄 = **認証なし** |
| `messageFormat` | `"array"` \| `"string"` | `"array"` | メッセージフィールドの形式 |
| `reportSelfMessage` | bool | `false` | 自分が送信したメッセージを報告するか |

自動命名のプレフィックス：`httpServers` → `http-`、`httpClients` → `httppost-`、
`wsServers` → `ws-`、`wsClients` → `wsclient-`。

**`httpServers`** の追加フィールド：

| フィールド | 型 | 既定 | 説明 |
| --- | --- | --- | --- |
| `host` | string | `0.0.0.0` | 待ち受けアドレス |
| `port` | int | — | **必須かつ > 0**。そうでない場合そのエントリは破棄されます |
| `path` | string | `/` | ベースパス |
| `enableWebSocket` | bool | `false` | 同一ポートで WS を受け付けます |
| `enableSse` | bool | `false` | `_events` を公開します |
| `maxPayloadBytes` | int | 下記参照 | 受信 WS フレームの上限 |

**`wsServers`** の追加フィールド：`host`、`port`（必須 > 0）、`path`、
`role`（`Api` / `Event` / `Universal`、既定 `Universal`）、`maxPayloadBytes`。

**`httpClients`** の追加フィールド：`url`（必須。`enabled:false` の場合は不要）、`timeoutMs`（既定 `5000`）。

**`wsClients`** の追加フィールド：`url`（必須）、`role`（既定 `Universal`）、
`reconnectIntervalMs`（既定 `5000`、下限 `1000`）、`maxPayloadBytes`。

`maxPayloadBytes` の範囲は **1024 〜 2147483648**（2 GiB）です。
`httpClients` は `maxPayloadBytes` を**受け付けません**（設定エラーになります）。

---

## 3. 認証（accessToken）

### 3.1 判定ロジック

ソース `network/utils.ts`：

```js
function isAuthorized(request, token, allowRawToken = false) {
  if (!token) return true;                       // 未配置 token = 完全放行
  const auth = request.headers.authorization ?? "";
  if (auth === `Bearer ${token}` || (allowRawToken && auth === token)) return true;
  try {
    if (new URL(request.url ?? "/", "http://127.0.0.1")
          .searchParams.get("access_token") === token) return true;
  } catch {}
  return false;
}
```

### 3.2 3 種類の伝達方法

| 方法 | 書き方 | 適用範囲 | リスク |
| --- | --- | --- | --- |
| Bearer ヘッダー | `Authorization: Bearer <token>` | すべてのアダプター | ✅ 推奨 |
| 生の token ヘッダー | `Authorization: <token>` | **HTTP server のみ** | ⚠️ 非標準で、ミドルウェアに誤解されやすい |
| URL クエリパラメータ | `?access_token=<token>` | すべて（WS ハンドシェイクも対応） | 🔴 **token が URL に入る**：アクセスログ、ブラウザ履歴、Referer、プロキシログに残ります |

> **推奨**：本番環境では**Bearer ヘッダーのみ**を使用してください。`?access_token=` は旧クライアントとの互換のためにのみ残されています。
> どうしてもブラウザで使用する必要がある場合は、完全な URL を記録しないようにしてください。

### 3.3 未認証時の応答

```json
{ "status": "failed", "retcode": 1401, "data": null, "wording": "unauthorized" }
```

HTTP ステータスコードは `401` です。WS ハンドシェイク段階では `401 Unauthorized` でアップグレードを拒否します
（`verifyClient` コールバック、ソース `ws-server-adapter.ts`）。

### 3.4 逆方向接続の認証方向

| アダプター | 認証ヘッダー |
| --- | --- |
| `httpClients` | `X-Signature: sha1=<HMAC-SHA1(accessToken, body) 十六进制>` |
| `wsClients` | `Authorization: Bearer <accessToken>` |

`httpClients` は Bearer を**使用せず**、**リクエストボディに対して HMAC-SHA1 署名**を行います
（ソース `computeHmacSha1`）。受信側では同じアルゴリズムで検証する必要があります。

---

## 4. 設定例（そのままコピー可能）

### 4.1 HTTP + WS + SSE の単一ポート（推奨）

```json
{
  "networks": {
    "httpServers": [
      {
        "name": "main",
        "host": "0.0.0.0",
        "port": 3000,
        "path": "/",
        "enableWebSocket": true,
        "enableSse": true,
        "accessToken": "REPLACE_WITH_YOUR_TOKEN",
        "messageFormat": "array",
        "reportSelfMessage": false
      }
    ],
    "httpClients": [],
    "wsServers": [],
    "wsClients": []
  }
}
```

接続先：HTTP `http://<host>:3000/`、WS `ws://<host>:3000/`、
SSE `http://<host>:3000/_events`。

### 4.2 逆方向 WebSocket（NapCat エコシステム）

```json
{
  "networks": {
    "httpServers": [],
    "httpClients": [],
    "wsServers": [],
    "wsClients": [
      {
        "name": "to-framework",
        "url": "ws://127.0.0.1:8080/onebot/v11/ws",
        "role": "Universal",
        "accessToken": "REPLACE_WITH_YOUR_TOKEN",
        "messageFormat": "array",
        "reportSelfMessage": false,
        "reconnectIntervalMs": 5000
      }
    ]
  }
}
```

### 4.3 逆方向 HTTP 報告

```json
{
  "networks": {
    "httpServers": [],
    "httpClients": [
      {
        "name": "report",
        "url": "http://127.0.0.1:8080/onebot/events",
        "accessToken": "REPLACE_WITH_YOUR_SHARED_SECRET",
        "messageFormat": "array",
        "reportSelfMessage": false,
        "timeoutMs": 5000
      }
    ],
    "wsServers": [],
    "wsClients": []
  }
}
```

### 4.4 文字列メッセージ形式（旧フレームワーク互換）

```json
{
  "networks": {
    "httpServers": [
      {
        "name": "legacy",
        "host": "0.0.0.0",
        "port": 3000,
        "path": "/",
        "accessToken": "REPLACE_WITH_YOUR_TOKEN",
        "messageFormat": "string",
        "reportSelfMessage": true
      }
    ],
    "httpClients": [],
    "wsServers": [],
    "wsClients": []
  }
}
```

### 4.5 複数アカウント / 複数アダプターの併存

`networks` 配下の各配列には複数のエントリを置けます。**`name` はグローバルに一意でなければなりません**：

```json
{
  "networks": {
    "httpServers": [
      { "name": "api-a", "host": "0.0.0.0", "port": 3000, "accessToken": "TOKEN_A" },
      { "name": "api-b", "host": "0.0.0.0", "port": 3002, "accessToken": "TOKEN_B" }
    ],
    "wsClients": [
      { "name": "push-a", "url": "ws://127.0.0.1:9001/ws", "role": "Universal" },
      { "name": "push-b", "url": "ws://127.0.0.1:9002/ws", "role": "Event",
        "accessToken": "TOKEN_C" }
    ]
  }
}
```

---

## 5. HTTP 接続の詳細

### 5.1 パス → アクション名のマッピング

設定された `path` をプレフィックスとし、**パスの残りの部分がそのままアクション名**になります（ソース `http-server-adapter.ts`）：

| リクエストパス（`path: "/"`） | アクション |
| --- | --- |
| `GET /` | ヘルスプローブ。`{ "status":"ok","retcode":0,"data":{"online":true} }` を返します |
| `POST /send_group_msg` | `send_group_msg` |
| `POST /get_group_list` | `get_group_list` |
| `GET /_events` | SSE イベントストリーム（`enableSse: true` が必要） |

`path: "/onebot"` を設定した場合、アクションのパスは `/onebot/send_group_msg` になります。

このプレフィックスに属さないパスは次を返します：

```json
{ "status": "failed", "retcode": 1404, "data": null, "wording": "not found" }
```

### 5.2 3 種類のリクエスト記法

**① パスにアクション + JSON body（最も一般的）**

```bash
curl -X POST http://127.0.0.1:3000/send_group_msg \
  -H 'Authorization: Bearer REPLACE_WITH_YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"group_id":20001,"message":[{"type":"text","data":{"text":"你好"}}]}'
```

**② JSON body に `action` を埋め込む**

```bash
curl -X POST http://127.0.0.1:3000/ \
  -H 'Authorization: Bearer REPLACE_WITH_YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"action":"send_group_msg","params":{"group_id":20001,"message":"hi"},"echo":"req-1"}'
```

**③ GET + クエリパラメータ**

```bash
curl -G http://127.0.0.1:3000/get_group_member_info \
  -H 'Authorization: Bearer REPLACE_WITH_YOUR_TOKEN' \
  --data-urlencode 'group_id=20001' --data-urlencode 'user_id=10001'
```

`application/x-www-form-urlencoded` の POST にも対応しています。

クエリ／フォームのパラメータは**1 つずつ `JSON.parse` を試み**、失敗した場合は文字列のまま渡されます。
そのため `?user_id=10001` と `?user_id="10001"` はどちらも数値として解析されます。

### 5.3 `echo` のエコー

リクエストに `echo` が含まれる場合、レスポンスはそのフィールドを**そのままエコー**します（ソース `if (echo !== void 0) response.echo = echo;`）。
非同期の並行処理でリクエストとレスポンスを対応付けるのに便利です。

### 5.4 メソッドとエラー

> ⚠️ **アクション層の失敗でも HTTP `200` が返ります**。
> `retcode 100/1400/1404/1200` はいずれも **HTTP 200** のレスポンスボディに現れます。
> 成否は `retcode` で判定し、HTTP ステータスコードだけで判断しないでください。

| 状況 | HTTP | retcode | wording |
| --- | --- | --- | --- |
| アクション成功 | `200` | `0` | — |
| パラメータ検証失敗 | **`200`** | `1400` | 例：`group_id is required` |
| アクション実行失敗 | **`200`** | `100` | 具体的な原因 |
| アクションが存在しない | **`200`** | `1404` | `unknown action` |
| GET/POST 以外 | `405` | `1400` | `method not allowed` |
| `action` の欠落 | `400` | `1400` | `bad request: missing action` |
| JSON 構文エラー | `400` | `1400` | `bad request: invalid json` |
| 未対応の Content-Type | `400` | `1400` | `bad request: unsupported content-type: ...` |
| リクエストボディが過大 | `413` | `1413` | — |
| 内部例外 | `500` | `1200` | 例外情報 |
| サービスが終了処理中 | `503` | `1200` | `server closing` |
| 未認証 | `401` | `1401` | `unauthorized` |
| パスが `path` のプレフィックス外 | `404` | `1404` | `not found` |

---

## 6. WebSocket 接続の詳細

### 6.1 3 種類の role

`role` はその接続が**何を送受信するか**を決めます（ソース `ws-server-connections.ts` /
`ws-client-adapter.ts`）：

| role | イベント受信 | アクション要求の受け付け |
| --- | --- | --- |
| `Api` | ✗ | ✔ |
| `Event` | ✔ | ✗ |
| `Universal` | ✔ | ✔ |

- イベントは `Event` / `Universal` 接続にのみプッシュされます。
- アクション要求は `Api` / `Universal` 接続からの受信メッセージのみ受け付けます。
- `Event` 接続から送られたアクション要求は**無視されます**（エラーにはなりません）。

### 6.2 パスによる分類（順方向 WS）

`path` が `"/"` かつ `role` が `Universal` のとき、**サブパス**でロールを区別できます：

| パス | 解析される role |
| --- | --- |
| `/` | `Universal` |
| `/api` | `Api` |
| `/event` | `Event` |

`/api` で終わる → `Api`、`/event` で終わる → `Event`、それ以外 → `Universal`。
パスが設定に合致しない場合、ハンドシェイクは拒否されます（`400 Bad path for WebSocket`）。

### 6.3 順方向／逆方向ハンドシェイクのリクエストヘッダー

**逆方向 WS（`wsClients`、Haizakura がクライアント）** が送信するもの：

```
User-Agent: OneBot/11
X-Self-ID: <uin>
X-Client-Role: Universal | Api | Event
Authorization: Bearer <accessToken>     # 仅在配置了 token 时
```

**逆方向 HTTP（`httpClients`）** が送信するもの：

```
Content-Type: application/json
User-Agent: OneBot
X-Self-ID: <uin>
X-Signature: sha1=<HMAC-SHA1(accessToken, 原始body) 的 hex>
```

### 6.4 ハートビートと再接続

**サーバー → クライアント（meta イベント）**：`OneBotInstance.HEARTBEAT_INTERVAL = 30000` ms で、
30 秒ごとに `meta_event` / `heartbeat` をプッシュします（詳細は `events.md`）。

**逆方向 WS の死活監視**：`HEARTBEAT_INTERVAL_MS = 30000`、
`HEARTBEAT_MAX_MISSED = 2`。つまり約 **90 秒**受信応答がないとハーフオープン接続と判定して再接続します
（`HEARTBEAT_DEAD_AFTER_S = 30 * 3 / 1000`）。

**再接続間隔**：`reconnectIntervalMs`、既定 `5000`、下限 `1000`。

### 6.5 逆方向 WS は接続時にまず meta イベントを補完する

接続が確立すると、サーバーはすぐに bootstrap メタイベント（ライフサイクルなど）をプッシュし、
その後に増分イベントをプッシュします。クライアントは「接続直後に meta_event を受信する」ことを許容できる必要があります。

---

## 7. SSE 接続の詳細

### 7.1 有効化とアドレス

```json
{ "name": "main", "host": "0.0.0.0", "port": 3000, "enableSse": true }
```

イベントストリームのアドレス：**`GET <path>/_events`**（`path` が `/` の場合は `/_events`）。

有効化していない状態でアクセスすると次を返します：

```json
{ "status": "failed", "retcode": 1404, "data": null, "wording": "SSE is disabled" }
```

GET 以外のメソッドは `405` + `retcode 1405` + `wording: "SSE requires GET"` を返します。

### 7.2 レスポンスヘッダーとフレーム形式

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
Connection: keep-alive
```

接続確立後、まず `retry: 3000` を送信し、その後はフレームごとに次を送信します：

```
id: <epoch-uuid>:<sequence>
data: <事件 JSON>

```

**15 秒**ごとにコメント行 `: ping` を送信してキープアライブとします。

### 7.3 切断と再接続、`Last-Event-ID`

クライアントは再接続時に `Last-Event-ID: <epoch>:<sequence>` を返して補完を要求できます：

| 状況 | 応答 |
| --- | --- |
| 形式が不正 | `400` `invalid Last-Event-ID` |
| epoch の不一致 / 序号の範囲外 / すでに破棄済み | `409` `SSE replay unavailable; resync and reconnect without Last-Event-ID` |

`409` を受信した場合は**`Last-Event-ID` をクリアして再接続**し、現在の状態から再構築してください。

### 7.4 バッファ上限

単一接続の滞留が **8 MiB**（`CLIENT_BYTES = 8 * 1024 * 1024`）を超えると**能動的に切断**されます。
ログには `SSE client exceeded N buffered bytes; disconnecting` と出力されます。
低速なコンシューマーは WebSocket または分割取得に切り替えてください。

---

## 8. メッセージ形式：`array` と `string`

各アダプターの `messageFormat` が、**イベント内の `message` フィールド**の形態を決めます：

| 値 | `message` フィールド | 説明 |
| --- | --- | --- |
| `"array"`（既定） | メッセージセグメント配列 | 構造化されており推奨 |
| `"string"` | CQ コード文字列 | `raw_message` の値を取得します |

ソース `event-filter.ts`：

```js
function shapeEventForAdapter(event, options) {
  if (event.post_type === "message_sent" && !options.reportSelfMessage) return null;
  if (options.messageFormat === "string"
      && (event.post_type === "message" || event.post_type === "message_sent")
      && Array.isArray(event.message)) {
    const raw = typeof event.raw_message === "string" ? event.raw_message : "";
    return { ...event, message: raw };
  }
  return event;
}
```

注意：影響を受けるのは**メッセージ系イベントのみ**です。`message_sent`（自分が送ったメッセージ）は
`reportSelfMessage: false` のとき**イベント全体が破棄**されます。

**送信方向は `messageFormat` の制約を受けません**：`message` パラメータには配列、
CQ コード文字列（`[CQ:face,id=1]`）、またはオブジェクトを渡すことができ、`parseMessage` が解析します。
`auto_escape: true` のとき、文字列中の CQ コードは**解析されず**、プレーンテキストとして送信されます。

### 8.1 メッセージセグメントの種類

**受信方向**（要素 → セグメント、ソース `element-codecs.ts` の `ELEMENT_CODECS`、全部で **16** 種類）：

```
text  face  at  reply  image  record  video  json  xml
file  mface  poke  flash_file  forward  markdown  inline_keyboard
```

**送信方向**には別に 9 種類の**互換セグメント**があり、上記の要素に変換されます
（ソース `message-parser.ts` の `segmentToElement`）：

```
node  share  music  location  contact  rps  dice  shake  anonymous
```

> `node` は**結合転送**（forward node リスト）の内部でのみ使用できます。
> トップレベルで使用すると `UNSENDABLE_TYPE` をスローします。
> `share` / `music` は `json` カードに変換されます。`music` の `custom` タイプは
> 外部リンク署名サービスが必要です（既定 `https://ss.xingzhige.com/music_card/card`）。

**空テキストプレースホルダーの規則**（ソース `isExplicitEmptyTextPlaceholder`）：
セグメント配列内で `text` フィールドが**ちょうど空文字列 `""`** である text セグメントは**互換プレースホルダー**と見なされ、
「送信可能セグメント」に数えられません。一方、フィールドが**欠落 / `null` / 空白のみ**の場合は通常の検証が行われます。

---

## 9. 簡単な検証

```bash
TOKEN=REPLACE_WITH_YOUR_TOKEN
BASE=http://127.0.0.1:3000

# 健康探测（仍需鉴权，因为 accessToken 非空）
curl -s $BASE/ -H "Authorization: Bearer $TOKEN"

# 版本信息
curl -s -X POST $BASE/get_version_info \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'

# 群列表
curl -s -X POST $BASE/get_group_list \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'

# 反向验证鉴权确实生效（预期 401 / retcode 1401）
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/get_version_info \
  -H 'Content-Type: application/json' -d '{}'
```

> ⚠️ **`get_supported_actions` は未実装です**。これは OneBot v11 の標準アクションですが、
> 本実装では**提供していません**。呼び出すと次を返します：
>
> ```json
> { "status": "failed", "retcode": 1404, "data": null, "wording": "unknown action" }
> ```
>
> `_get_supported_actions` も存在しません。**アクション一覧が必要な場合は WebUI の
> `GET /api/debug/actions`** を使用してください（`webui/api.md` 参照）。これは全 222 個のアクションの
> 完全なドキュメントを返します。

### 実測結果（2026-11-13、実行インスタンス）

| リクエスト | 結果 |
| --- | --- |
| `POST /get_version_info` token なし | HTTP `401`、`retcode 1401`、`unauthorized` |
| `POST /get_version_info` token あり | `{"app_name":"Haizakura","app_version":"2.4.0-node","protocol_version":"v11"}` |
| `GET /` token あり | `{"status":"ok","retcode":0,"data":{"online":true}}` |
| `POST /get_supported_actions` | `retcode 1404`、`unknown action` ❌ |
| `POST /get_status` | `{"online":true,"good":true,"time":3793}` |
| `POST /can_send_image` | `{"yes":true}` |
| `POST /get_login_info` | `{"user_id":<uin>,"nickname":"HaizakuraBot"}` |

### SSE の検証

```bash
curl -N -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/_events
```

---

## 10. よくある問題

| 現象 | 原因 | 対処 |
| --- | --- | --- |
| `retcode 1401 unauthorized` | token の不一致または未送信 | `Authorization: Bearer` を確認します |
| `retcode 1404 not found` | パスが `path` のプレフィックス外 | `path` の設定を確認します |
| `1404` + `SSE is disabled` | `enableSse` が未設定 | スイッチを有効にして再読み込みします |
| WS ハンドシェイク `400 Bad path` | パスが `path`/role の規則に合致しない | §6.2 参照 |
| イベントを受信できない | 接続の role が `Api` | `Event` / `Universal` に変更します |
| 自分が送ったメッセージがプッシュされない | `reportSelfMessage: false` | `true` に設定します |
| ポートが反映されない | `port <= 0` のエントリが破棄されている | 有効なポート（1–65535）を設定します |
| 設定が反映されない | ファイル名が `onebot_<纯数字>.json` でない | §2.1 参照 |
| イベント内の `message` が文字列 | `messageFormat: "string"` | `"array"` に変更します |

---

## 11. 宣言

| 項目 | 状態 |
| --- | --- |
| 設定フィールド、既定値、検証範囲 | **検証済み**：`config.ts` のソース由来 |
| 認証の 3 方式と `1401` 応答 | **検証済み**：ソース + 実機検証 |
| HTTP の 3 種類の記法、`echo`、エラーコード | **検証済み**：`http-server-adapter.ts` |
| role の意味、パス分類、ハートビート間隔 | **検証済み**：WS アダプターのソース |
| SSE のフレーム形式、再接続、8 MiB 上限 | **検証済み**：`http-sse-connections.ts` |
| メッセージセグメント 16/9 種、空テキストプレースホルダー | **検証済み**：codec と parser のソース |
| 本文の例に登場する接続先／ポート | 例示値であり、**あなたの環境では未検証** |

> 未検証項目：逆方向 WS / 逆方向 HTTP / SSE の 3 方式は実機で接続を確立したことがなく、
> 上記の挙動はすべてソースコードの読解に基づくものです。