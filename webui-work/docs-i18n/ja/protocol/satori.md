# Satori プロトコル接続ガイド

> [!WARNING]
> 本内容は完全に AI が執筆したものです。注意して確認してください。

> 本文は Haizakura（旧 SnowLuma）による **Satori プロトコル**（`satori.chat`）の実装について説明します：
> **path センチネル**でサーバーを有効化する方法、24 個の API、イベントとリソースのマッピング、メッセージ要素の送受信、
> そして LLBot との差異です。
>
> **データソース**：`packages/onebot/src/network/satori-server-adapter.ts`（1445 行、トランスポート層 + API テーブル）、
> `packages/onebot/src/network/satori-mount.ts`（95 行、マウント層）、
> `packages/onebot/src/config.ts`（`wsServers` の解析と検証）、
> `scripts/tests/driver-protocol.mjs`（76 アサーション）、`scripts/tests/driver-integration.mjs`（22 アサーション）。
>
> **テスト状態**：`node scripts/tests/run-satori-tests.mjs` → **76/76 通過**；
> `node scripts/tests/run-satori-integration.mjs` → **22/22 通過**（合計 **98/98**、2026-11-13 実走）。

---

## 1. はじめに

### 1.1 Satori とは

Satori は **クロスプラットフォームなチャットボットプロトコル**（<https://satori.chat>）で、Koishi エコシステムが維持しています。
さまざまなチャットプラットフォーム（QQ、Discord、Telegram…）を統一された一組の**リソース**
（`User` / `Channel` / `Guild` / `GuildMember` / `Message` / `Reaction`…）として抽象化し、
アプリケーション層はこのリソース群だけを対象にプログラミングします：

| 通信方式 | 用途 | 本文の対応章 |
| --- | --- | --- |
| **HTTP API** | 主体的な呼び出し（メッセージ送信、グループ照会、キック…） | §3 / §4 |
| **WebSocket** | 受動的なイベントストリーム受信 | §3 / §6 |
| WebHook | もう一つのイベント受信方式 | ❌ 本実装では**未提供** |

### 1.2 Haizakura が対応している理由

**Satori には既成の SDK エコシステムがあり、接続すればそのまま使えるからです。** Satori に対応した結果：

- **Koishi** は Satori アダプター経由で Haizakura に直接接続でき、OneBot ブリッジを書く必要がありません；
- **`@satorijs/satori`** などの公式 SDK から直接接続でき、HTTP/WS プロトコルスタックを手書きする必要がありません；
- アプリケーション層のコードは**クロスプラットフォームで再利用**できます —— 同一のロジックが QQ（Haizakura）でも、他の Satori 実装でも動作します。

### 1.3 OneBot v11 との関係

**両者は併存し、互いを置き換えません。同時に有効化できます。**

| 次元 | OneBot v11 | Satori |
| --- | --- | --- |
| 位置づけ | QQ エコシステムの事実上の標準 | クロスプラットフォーム抽象化 |
| 設定位置 | `networks.*`（4 種類のアダプター） | **`networks.wsServers[]` を再利用**（§2 参照） |
| ポート | それぞれ独立 | それぞれ独立、**OneBot と同時に別ポートで待ち受け可能** |
| イベント／アクションモデル | `post_type` + 222 個のアクション | 12 種類のイベント + 24 個のメソッド |

同一のアカウントで OneBot WS サーバーと Satori サーバーを同時に開くことができ、`emitEventNow()`
は各イベントを**両方へ同時にファンアウト**します（ソース `network-manager.ts`、統合テスト
`manager-fed EVENT has channel+user promoted` でアサート済み）。

> OneBot v11 の完全な説明は [`onebot11.md`](onebot11.md)、[`events.md`](events.md)、[`actions.md`](actions.md) を参照してください。

---

## 2. ⚠️ 有効化の方法（sentinel 機構）

> **本節は全文で最も重要な部分です。** Haizakura の Satori サーバーには**独立した設定項目がなく**、
> **OneBot の `wsServers[]` リストを再利用**し、`path` フィールドで識別します。

### 2.1 識別ルール

```
wsServers[] 中 path === "/v1/events" 的条目  =  Satori 服务器
```

判定ロジック（ソース `satori-mount.ts` の `satoriMountIsSatoriServer`）：

1. `path` フィールドを取得します（文字列でない場合は `"/"` として扱います）；
2. クエリ文字列（`?` 以降）と**末尾のスラッシュ**を除去します；
3. `"/v1/events"` と**完全一致**した場合のみ Satori と判定します。

したがって以下の各記述の識別結果は次のとおりです：

| 設定された `path` | 識別結果 |
| --- | --- |
| `/v1/events` | ✅ Satori |
| `/v1/events/` | ✅ Satori（末尾スラッシュを許容） |
| `/v1/events?x=1` | ✅ Satori（クエリ文字列を許容） |
| `/v1/eventsfoo` | ❌ 通常の OneBot WS |
| `/satori/v1/events` | ❌ **不一致**（完全一致のみで、前方一致ではありません） |
| `/` | ❌ 通常の OneBot WS |

> マウント方式は `OneBotInstance.prototype.createNetworkAdapter` へのパッチです
> （ソース `satori-mount.ts`）：まず `kind === "wsServer"` かつ `path` がセンチネルに一致するかを判定し、
> 一致すれば `SatoriServerAdapter` を返し、そうでなければ**そのまま**ネイティブ実装に戻します。
> 統合テストでは、通常の `/` エントリが依然として `WsServerAdapter` になることをアサート済みです（`normal path -> WsServerAdapter (unchanged)`）。

### 2.2 完全な設定例（そのままコピー可能）

`POST /api/config/:uin` は**設定オブジェクト全体を厳格に検証**するため（`assertValidOneBotConfig`）、
以下に**そのまま送信できる**形を示します（`statusCommand`、`historySync` はどちらも必須です）：

```json
{
  "networks": {
    "wsServers": [
      {
        "name": "satori-main",
        "host": "0.0.0.0",
        "port": 5600,
        "path": "/v1/events",
        "accessToken": "<your-token>",
        "messageFormat": "array",
        "reportSelfMessage": false
      }
    ],
    "httpServers": [],
    "httpClients": [],
    "wsClients": []
  },
  "statusCommand": { "enabled": false, "swallow": false, "cooldownSeconds": 5, "trigger": "#Haizakura" },
  "historySync": { "enabled": false },
  "notifications": { "channelIds": [] }
}
```

> ⚠️ `accessToken` をそのまま `<your-token>` というプレースホルダーにすると、**トークン強度ポリシーで拒否**されます
> （16 文字未満のため）：実際のランダムな token に置き換えてください。たとえば
> `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`（43 文字）です。
> **ローカルループバック**から保存する場合、または `host` を `127.0.0.1` に戻す場合に限り、空のままにできます（= 認証なし）。

フィールド説明（`wsServers` の意味を踏襲）：

| フィールド | 必須 | 説明 |
| --- | --- | --- |
| `name` | 推奨 | アダプターの一意な名前。**他の kind とグローバルに重複不可** |
| `host` | — | 既定値は `0.0.0.0`。別マシンからアクセスするには明示的に `0.0.0.0` を書く必要があります |
| `port` | **✔** | 1〜65535、**> 0** かつ他の待ち受けエントリと衝突しないこと |
| `path` | **✔** | **完全に** `/v1/events` と等しいこと。これがセンチネルです |
| `accessToken` | 推奨 | 空 = **認証なし**（⚠️ §6.5 の未認証ウィンドウと組み合わさると、完全に開放されます） |
| `messageFormat` | — | ⚠️ **Satori には無効**（§9 参照） |
| `reportSelfMessage` | — | ⚠️ **Satori には無効**（§9 参照） |
| `role` | 任意 | 既定値は `Universal`。**Satori では完全に無意味で無視されます**（`Api`/`Event` を書いても通常どおりイベントを送受信します。実測で確認済み） |
| `maxPayloadBytes` | 任意 | 受信 WS フレームの上限（`wsServers` の共通フィールド） |
| `enabled` | 任意 | `false` にするとファクトリーは Satori アダプターを返しますが、`open()` は即座に戻り、**待ち受けません** |

**`wsServers` が 1 件だけでもファイル検証は通過します**：`config/onebot_<uin>.json`
ファイルで設定する場合、`fromJson` が `statusCommand` / `historySync` / 残り 3 つのネットワーク配列の既定値を補完するため、
設定ファイルには `networks.wsServers` だけを書いても構いません。**WebUI の POST インターフェースは省略を受け付けません**ので、上記の完全な形を使用してください。

> **センチネルのエントリに Satori 専用フィールドを追加しないでください**：`wsServers` のフィールド集合は固定です
> （`name` / `enabled` / `accessToken` / `messageFormat` / `reportSelfMessage` /
> `host` / `port` / `path` / `role` / `maxPayloadBytes`）。実測では 3 つの経路で挙動が異なります：
>
> | 経路 | 未知フィールドの挙動 |
> | --- | --- |
> | `POST /api/config/:uin`（保存） | **黙って受け入れる**。エラーになりません |
> | `fromJson`（ファイル読み込み） | **黙って破棄**（生成されたオブジェクトにそのフィールドはありません） |
> | 設定のインポート／復元（`validateOneBotRestoreSource`） | **明確に拒否**：`$.networks.wsServers[0].xxx is not supported` |
>
> つまり WebUI での保存は**エラーになりません**が、そのフィールドは次回の読み込み時には消えています —— 有効になることを期待しないでください。
> これこそが本アダプターが**自己完結していなければならない**（追加の設定フィールドに依存できない）理由です。

### 2.3 なぜこの「センチネル」方式なのか（設計上のトレードオフ）

Haizakura の設定モジュール `config.ts` では、
`fromJson` と `toJsonObject` が **4 つの kind**（`httpServers` / `httpClients` /
`wsServers` / `wsClients`）を**ハードコード**しており、`RESTORE_NETWORK_KEYS` も固定の集合です。

5 番目の kind（たとえば `satoriServers`）を追加するには `config.ts` 本体を変更する必要があります：

- `config.ts:222` は `RESTORE_NETWORK_KEYS` を走査して `parsed.networks[key].length` を読みます ——
  `fromJson` の出力に新しい kind は存在しないため、`undefined.length` で即座に **TypeError** となり、
  設定の保存／復元の経路全体が使用不能になります；
- `validateRestoreAdapterArray` は未知の kind に対して `url` フィールドを要求するため、形が合いません。

そして `config.ts` は**既存の region** であり、変更には**432 個の region の再番号付け**が必要です（ソース `satori-mount.ts`
冒頭のコメントがこの結論を明記しています：*「新增 kind 必須修改 config.ts 本体，而那是現有 region
（改它要重編号 432 個 region）」*）。

**v2 方式（現在の実装）**：既存の `wsServers[]` を再利用し、**プロトタイプメソッドを 1 個だけ**パッチします。利点：

- 設定パイプラインを **100% 再利用** —— 解析、検証、シリアライズ、ホットリロード、**ポート競合検出**がすべて引き続き有効です；
- `config.ts` に触れないため、region 再番号付けのリスクがゼロです；
- 統合テストで `RESTORE_NETWORK_KEYS not polluted`（汚染されていない）、
  `compileDesiredPlan NOT patched (v2 minimal)`（変更したのは 1 メソッドのみ）をアサート済みです。

**代償（承知しておく必要があります）**：

- WebUI のネットワーク状態一覧では、このエントリは**「WS サーバー」グループ**の下に表示されます；
  ただし**ステータスラベル（`kind`）は依然として `satoriServer`** であり、`detail` には
  `Satori v1 · N 个事件客户端` と表示されます**（ソース `describeStatus()`、統合テスト
  `Satori adapter describeStatus().kind` でアサート済み）；
- 逆に、**`/v1/events` という path は OneBot WS に割り当てられなくなります** ——
  `path: "/v1/events"` と書いた者が Satori サーバーになるからです（§2.5 参照）。

### 2.4 ホットアップデート（再起動不要、ログイン状態を失わない）

設定は WebUI の `POST /api/config/:uin` で**ホットアップデート**できます：

```bash
curl -X POST http://127.0.0.1:3080/api/config/10001 \
  -H 'Content-Type: application/json' \
  -d @satori-config.json
```

成功時のレスポンスは次のような形です：

```json
{ "success": true, "saved": true, "applied": true, "online": true,
  "reloaded": true, "message": "配置保存成功，已热重载当前会话。", "errors": [], "adapters": [] }
```

- **プロセスの再起動は不要で、ログイン状態も失われません**（`oneBotManager.reloadConfig` 経由）；
- セッションがオンラインでない場合も保存は成功しますが、`online: false` となり、**次回の接続時に反映されます**；
- トークンのローテーションは**接続済みのイベントクライアントを主体的に切断**します：`closeConnections(1008, "access token changed")`
  （ソース `onConfigReplaced`）—— クライアントは再度 IDENTIFY する必要があります。

> ⚠️ **リモート保存時のトークンポリシー**：`wsServers` は受信ノード（`INBOUND_KINDS`）に属するため、
> 非ループバックアドレス経由で保存する場合、**`accessToken` は空にできず、最低 16 文字**必要で、
> さらに推測されやすい値も使えません（ソース `onebot-token-policy.ts`）。`127.0.0.1` に戻すか、ローカルから保存する場合のみ空を許容します。

### 2.5 OneBot と同時に有効化する記述

```json
{
  "networks": {
    "wsServers": [
      { "name": "satori-main", "host": "0.0.0.0", "port": 5600, "path": "/v1/events",
        "accessToken": "<satori-token>", "messageFormat": "array", "reportSelfMessage": false },
      { "name": "ob-ws", "host": "0.0.0.0", "port": 3001, "path": "/",
        "role": "Universal", "accessToken": "<onebot-token>",
        "messageFormat": "array", "reportSelfMessage": false }
    ],
    "httpServers": [], "httpClients": [], "wsClients": []
  },
  "statusCommand": { "enabled": false, "swallow": false, "cooldownSeconds": 5, "trigger": "#Haizakura" },
  "historySync": { "enabled": false },
  "notifications": { "channelIds": [] }
}
```

- 2 件は**ポートが異なる**必要があり、そうでなければ検証が即座に拒否します（`networks.wsServers[1] conflicts with networks.wsServers[0] on server binding ...`）；
- `name` は**すべての kind の間**で一意である必要があり、重複すると `network adapter name "..." is duplicated in ... and ...` になります；
- Satori は**複数**開けます（異なるポート）。互いに影響しません。

---

## 3. 接続方式

### 3.1 HTTP API

```
POST http://<host>:<port>/v1/{resource}.{method}
Content-Type: application/json
```

- リクエストボディは **JSON オブジェクト**です（配列やスカラーは拒否されます：`请求体必须是 JSON 对象`）；
  空のリクエストボディは `{}` として扱われます（実測 `200`）；
- `Content-Type` は**検証しません**：`application/json` / `text/plain` / まったく付けない
  のいずれでも正常に処理されます（実測はいずれも `200`）。仕様としては `application/json` を推奨しますが、本実装は強制していません；
- メソッド名は**パスの残りの部分**です。たとえば `POST /v1/login.get`、`POST /v1/message.create`；
  メソッドパスは**クエリ文字列を伴えます**（`/v1/login.get?x=1` は実測 `200`、クエリパラメータは無視されます）；
- ⚠️ **`/v1` をさらに重ねません**。センチネルの `path` 自体が `/v1/events` であり、
  ソースの `mountPrefix()` は `/` と `/v1/events` のいずれに対しても空文字列を返すため、
  エンドポイントは `/v1/<method>` であり、**`/v1/events/v1/<method>` ではありません**
  （ソースコメント：*"must NOT append another `/v1`"*；テストのアサーション
  `route: POST /v1/login.get (no double /v1)`）。

### 3.2 WebSocket イベントストリーム

```
GET ws://<host>:<port>/v1/events      （HTTP Upgrade）
```

- パスは**完全に** `/v1/events` と等しい必要があり、そうでなければアップグレードは拒否されます：`abortUpgrade(socket, 404, "Not Found")`；
- **通常の GET**（upgrade なし）でこのパスにアクセスすると → `405` + `Allow: GET` + `please connect with WebSocket`。

### 3.3 必須リクエストヘッダー

| ヘッダー | 値 | 必須性 |
| --- | --- | --- |
| `Satori-Platform` | **`haizakura`** | ⚠️ 下記参照 |
| `Satori-User-ID` | アカウントの uin | 任意（**指定した場合は一致が必須**） |
| `Authorization` | `Bearer <accessToken>` | token を設定した場合は必須 |

**`Satori-Platform` の正しい値は `haizakura` であり、`qq` ではありません！**

```bash
curl -X POST http://127.0.0.1:5600/v1/login.get \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <your-token>' \
  -H 'Satori-Platform: haizakura' \
  -H 'Satori-User-ID: 10001' \
  -d '{}'
```

実測の挙動（ソース `handleRequest` + 実走検証）：

| 状況 | 結果 |
| --- | --- |
| `Satori-Platform: haizakura` | `200` ✅ |
| **`Satori-Platform: qq`** | **`403`** `{"message":"login not found"}` |
| `Satori-Platform` を**まったく付けない** | `200`（**欠落は許容**） |
| `Satori-User-ID` が現在のアカウントと一致しない | `403` `{"message":"login not found"}` |
| `Satori-User-ID` をまったく付けない | `200`（**欠落は許容**） |

> つまり、2 つのヘッダーは**「指定されたが値が違う」場合にのみ拒否**されます。SDK は既定で
> `Satori-Platform` を付けるため、プラットフォーム識別子を正しく（`haizakura`）設定すれば問題ありません；
> 手書きのクライアントでも**省略すれば通ります**が、**`qq` を渡すと必ず 403** になります。

### 3.4 ステータスコード表

| コード | 発生条件 | レスポンスボディ |
| --- | --- | --- |
| `200` | 成功 | メソッドの戻り値（メソッドごとに異なります。§4 参照） |
| `400` | パラメータの欠落／不正、JSON 構文エラー、リクエストボディがオブジェクトでない、下流アクションの失敗 | `{"message":"..."}` |
| `401` | token を設定したが `Authorization` を**付けていない** | `{"message":"authorization required"}` |
| `403` | token の不一致 / `Satori-Platform` または `Satori-User-ID` の不一致 | `{"message":"invalid token"}` または `"login not found"` |
| **`404`** | **メソッドが 24 個のホワイトリストにない**、パスが `/v1/` 前置の下にない | `{"message":"method not found"}` / `"not found"` |
| `405` | メソッドパスに POST 以外を使用；`/v1/events` に通常の GET を使用 | `Allow` ヘッダー付き |
| `413` | リクエストボディが **64 MiB** を超過（`readRequestBody` の既定上限） | `{"message":"request body too large"}` |
| `503` | サービスがシャットダウン中（`acceptingActions === false`） | `{"message":"server closing"}` |

> **重要：未対応の API は `404` を返し、`501` ではありません。** これは Satori 仕様に準拠しています
>（*「プラットフォームが未対応の API は 404 を返すべき；501 を返すのはプラットフォームが対応しているがアダプターが未実装の場合のみ」*）。
> ソースコメントも明記しています：*"an unsupported API must answer 404, never 501"*。
>
> **注意**：Satori のエラーボディは**フラットな `{message}`** であり、OneBot の
> `{status, retcode, data, wording}` とは**まったく異なります**。2 つのエラー処理を混用しないでください。

### 3.5 認証の順序（はまりやすい点）

HTTP リクエストは以下の順序で処理され、**認証は最初のステップではありません**：

1. `acceptingActions` が偽 → `503`；
2. パスが `/v1`（または `/v1/`）→ `404 method not found`；
3. パスが `/v1/` で始まらない → `404 not found`；
4. メソッド名が `events` → `405`（WebSocket を使うよう促します）；
5. メソッドが `POST` でない → `405`；
6. **その後に `Authorization` を検証**：なし → `401`、不一致 → `403`；
7. `Satori-User-ID`、`Satori-Platform` を検証 → 不一致は `403`；
8. メソッドが `SATORI_API` ホワイトリストにない → `404`。

> したがって：**未認証のリクエストでは、`404`/`405` が `401` より先に返ります**。
> また、`accessToken` が空のときは**認証ステップ全体がスキップ**されます —— 誤った token を渡しても通ります。---

## 4. API 一覧（24 個）

ソースの `SATORI_API` テーブルは**ちょうど 24 条**であり、`SATORI_FEATURES` が宣言する 26 個の機能と一致します
（26 = 24 個のメソッド + `message.list.from` + `guild.plain`。後者 2 つは**機能マーカー**でありメソッドではありません）。

**約束事**：

- すべてのメソッドは `POST` で、パラメータは JSON リクエストボディに置きます；
- ID 系のパラメータはオンラインではすべて**文字列**です（`user_id`/`group_id` に数値を渡しても `toInt` が寛容に扱います）；
- 失敗時はエラーを投げ → HTTP `400` + `{"message":"..."}`。

### 4.1 ログイン

#### `login.get`

| 項目 | 値 |
| --- | --- |
| パラメータ | なし |
| 転送先 | `get_login_info` |
| 返却 | `Login`：`{sn, adapter, platform, user, status, features}` |

```json
{
  "sn": 1,
  "adapter": "haizakura",
  "platform": "haizakura",
  "user": { "id": "10001", "avatar": "http://q.qlogo.cn/headimg_dl?dst_uin=10001&spec=640",
            "is_bot": false, "name": "HaizakuraBot", "nick": "HaizakuraBot" },
  "status": 1,
  "features": ["login.get", "message.create", "... 共 26 项"]
}
```

> `status`：`1` = ONLINE、`0` = OFFLINE。
> `get_login_info` が失敗しても**エラーにならず**、`ctx.uin` でフォールバックした Login を返します。

### 4.2 メッセージ

| メソッド | 転送先 | パラメータ | 返却 |
| --- | --- | --- | --- |
| `message.create` | `send_msg` | `channel_id` **✔**、`content` **✔** | `Message[]`（長さ 1） |
| `message.get` | `get_msg` | `message_id` **✔**（`channel_id` は未使用） | `Message` |
| `message.delete` | `delete_msg` | `message_id` **✔** | `null` |
| `message.list` | `get_group_msg_history` / `get_friend_msg_history` | `channel_id` **✔**、`limit`、`next`/`message_id`、`order` | `BidiList`：`{data, next?}` |

**`message.create`** —— Satori の `content`（要素列）→ OneBot のメッセージセグメント：

- `channel_id` が純粋な数字 → グループチャット。`{message_type:"group", group_id}` を使います；
- `channel_id` が `private:<uin>` → プライベートチャット。`{message_type:"private", user_id}` を使います；
- `content` を解析した結果**送信可能な要素がない** → `400 content must contain at least one sendable element`；
- 返却される `Message.created_at` は `Date.now()`（**ミリ秒**）、`id` は `send_msg` が返す
  `message_id` の**文字列**形式です；
- ローカルの `get_msg` で、たった今保存された自分のメッセージが見つからない場合、**送信済みの content をエコーバック**します。成功した送信をエラーにはしません。

```bash
curl -X POST http://127.0.0.1:5600/v1/message.create \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer <your-token>' \
  -H 'Satori-Platform: haizakura' -H 'Satori-User-ID: 10001' \
  -d '{"channel_id":"20001","content":"你好 <at id=\"30003\"/> <emoji id=\"1\"/> <img src=\"https://x/y.png\"/>"}'
```

**`message.list`** のページングセマンティクス（⚠️ **近似実装**、§9 参照）：

- `limit` が省略／≤0／>100 の場合は**50 にフォールバック**します；
- `next`（または `message_id`）をアンカーとして OneBot の `message_id` に渡します；
- `order: "asc"` → `reverse_order: false`；省略または `"desc"` → `reverse_order: true`；
- **返却行数が limit 以上の場合のみ** `next` を付け、その値は**このページの最後の 1 件の `id`** です ——
  これは「メッセージ ID をカーソルにする」近似であり、プロトコルが要求する真のカーソルではありません；
- `prev` と `direction`（`before`/`after`/`around`）は**いずれも未対応**です。

### 4.3 チャンネル（Channel）

| メソッド | 転送先 | パラメータ | 返却 |
| --- | --- | --- | --- |
| `channel.get` | グループチャット → `get_group_info`；プライベートチャット → `get_stranger_info` | `channel_id` **✔** | `Channel` |
| `channel.list` | `get_group_info` | `guild_id` **✔** | `{data:[Channel]}`（常に 1 件） |

- グループチャットの `channel_id` = グループ番号の文字列。返却は `type: 0`（TEXT）+ `name` = グループ名；
- プライベートチャットの `channel_id` = `private:<uin>`。返却は `type: 1`（DIRECT）、
  `name` は見知らぬ人のニックネームです（失敗時は `name` を付けません）；
- `channel.list` は **QQ が 1 グループ 1 チャンネル**（`guild.plain`）であるため、そのグループ自身の 1 チャンネルだけを返します。

### 4.4 グループ（Guild）

| メソッド | 転送先 | パラメータ | 返却 |
| --- | --- | --- | --- |
| `guild.get` | `get_group_info` | `guild_id` **✔** | `Guild` |
| `guild.list` | `get_group_list` | なし | `{data:[Guild]}` |
| `guild.approve` | `set_group_add_request`（`sub_type:"invite"`） | `message_id` **✔**（=flag）、`approve`、`comment` | `null` |

`Guild` の形：`{id, name, avatar}`。`avatar` は
`https://p.qlogo.cn/gh/{group_id}/{group_id}/640` です。

> `guild.approve` の `message_id` は実際には**リクエストの flag** です ——
> `guild-request` イベントの `message.id` から取得します。`approve` は**既定で true**
> （`source.approve !== false`）。

### 4.5 グループメンバー（GuildMember）

| メソッド | 転送先 | パラメータ | 備考 |
| --- | --- | --- | --- |
| `guild.member.get` | `get_group_member_info` | `guild_id` **✔**、`user_id` **✔** | 単一の `GuildMember` を返します |
| `guild.member.list` | `get_group_member_list` | `guild_id` **✔** | `{data:[GuildMember]}` |
| `guild.member.kick` | `set_group_kick` | `guild_id`、`user_id`、`permanent` | `permanent:true` → `reject_add_request:true` |
| `guild.member.mute` | `set_group_ban` | `guild_id`、`user_id`、`duration`（**ミリ秒**） | 換算は下記 |
| `guild.member.role.set` | `set_group_admin` | `guild_id`、`user_id`、`role_id` | 「管理者／非管理者」しか表現できません |
| `guild.member.approve` | `set_group_add_request`（`sub_type:"add"`） | `message_id`（=flag）、`approve`、`comment` | グループ参加申請 |

**`GuildMember` の形**：

```json
{
  "user": { "id": "30003", "avatar": "http://q.qlogo.cn/headimg_dl?dst_uin=30003&spec=640",
            "is_bot": false, "name": "群名片", "nick": "群名片" },
  "nick": "群名片",
  "avatar": "http://q.qlogo.cn/headimg_dl?dst_uin=30003&spec=640",
  "joined_at": 1600000000000,
  "roles": [ { "id": "3", "name": "admin" } ]
}
```

要点は次のとおりです：

- `user.name` / `user.nick` は `card || nickname` を取ります（**グループ名刺を優先**）；
- **`joined_at` はミリ秒**です：`join_time`（秒）× 1000。`join_time` ≤ 0 のときは**このフィールドは現れません**；
- `roles` は**常に長さ 1 の配列**です（QQ は単一ロールの階段しかありません）；
- `member.avatar` は `user.avatar` と同じです（QQ に独立したグループアバターはありません）。

**`guild.member.mute` の単位換算**（重要）：

```
Satori duration 是毫秒；OneBot set_group_ban 收秒。
seconds = duration <= 0 ? 0 : max(1, ceil(duration / 1000))
```

つまり `duration: 60000` → `duration: 60`（テストで `ms->s (60000->60)` をアサート済み）；
`duration: 0` → 解除。

**`guild.member.role.set` の表現力の制限**：

```
role_id ∈ {"3","admin"} → set_group_admin { enable: true }
role_id ∈ {"4","owner"} 或其它 → set_group_admin { enable: false }   ← 降级为普通成员
```

> つまり **QQ の「グループ所有者の譲渡」は本メソッドでは表現できません**：`role_id: "4"` を渡すと**管理者の解除**として扱われます。
> `role_id: "3"` の設定が唯一意味のある呼び出しです（テストで `role.set -> enable:true` をアサート済み）。

### 4.6 グループロール（GuildRole）

#### `guild.role.list`

| 項目 | 値 |
| --- | --- |
| パラメータ | `guild_id` **✔**（> 0 の検証のみ） |
| 返却 | **静的**な 3 件、**ネットワークにアクセスしません** |

```json
{ "data": [
  { "id": "4", "name": "owner",  "position": 3 },
  { "id": "3", "name": "admin",  "position": 2 },
  { "id": "2", "name": "member", "position": 1 }
] }
```

> テストで `guild.role.list -> 3 static roles` をアサート済み。

### 4.7 リアクション（Reaction）

| メソッド | 転送先 | パラメータ | 返却 |
| --- | --- | --- | --- |
| `reaction.create` | `set_msg_emoji_like`（`set:true`） | `message_id` **✔**、`emoji_id` **✔** | `null` |
| `reaction.delete` | `set_msg_emoji_like`（`set:false`） | `message_id` **✔**、`emoji_id` **✔** | `null` |
| `reaction.list` | `get_emoji_likes` | `message_id` **✔**、`emoji_id` **✔** | `{data:[User]}` |

- `emoji_id` は**表情 ID の文字列**です（たとえば `"128077"` は 👍）。非空検証があります；
- `reaction.list` が返すのは**その表情を付けたユーザーの一覧**（`User[]`）で、
  各 `User` の `id` は `emoji_like_list[].user_id` に由来します；
- 3 つとも **`emoji_id` を要求**し、`channel_id` がなくても動作します
  （`satoriMethodParams` はこれら 3 メソッドでは解析にのみ使い、channel を強制しません）。

### 4.8 ユーザーと友だち

| メソッド | 転送先 | パラメータ | 返却 |
| --- | --- | --- | --- |
| `user.get` | `get_stranger_info` | `user_id` **✔** | `User` |
| `friend.list` | `get_friend_list` | なし | `{data:[{user, nick}]}` |
| `friend.delete` | `delete_friend` | `user_id` **✔** | `null` |
| `friend.approve` | `set_friend_add_request` | `message_id` **✔**（=flag）、`approve` | `null` |

- `friend.list` の各項目は `{user: User, nick: 备注}` です。`user.name` は `nickname ?? remark` を取り、
  `nick` は `remark` を取ります；
- `friend.approve` の `message_id` は**友だち追加リクエストの flag**
  （`friend-request` イベントの `message.id` に由来）です。`approve` の既定値は true。

---

## 5. イベント一覧

### 5.1 対応する 12 種類のイベントタイプ

ソースの `satoriConvertOneBotEvent` とその分岐が生成する Satori イベントタイプは合計 **12 種類**です：

| Satori イベント | トリガー（OneBot） | プロトコルスイートでのアサート |
| --- | --- | --- |
| `message-created` | `message` / `message_sent` | ✅ |
| `message-deleted` | `notice: group_recall` / `friend_recall` | ✅ |
| `guild-member-added` | `notice: group_increase` | ✅ |
| `guild-member-updated` | `notice: group_card` / `group_admin` | ⚠️ 未アサート（実走で検証済み ✅） |
| `guild-member-removed` | `notice: group_decrease` | ✅ |
| `guild-member-request` | `request: group` + `sub_type != invite` | ✅ |
| `guild-request` | `request: group` + `sub_type: invite` | ✅ |
| `friend-request` | `request: friend` | ✅ |
| `reaction-added` | `notice: group_msg_emoji_like`（`remove` 以外） | ✅ |
| `reaction-removed` | `notice: group_msg_emoji_like` + `sub_type: remove` | ✅ |
| `login-added` | `notice: bot_status`（`offline` 以外） | ⚠️ 未アサート（実走で検証済み ✅） |
| `login-removed` | `notice: bot_status` + `sub_type: offline` | ✅ |

> **12 種類を実装済み**で、うちプロトコルスイートのアサーションがカバーするのは **10 種類**です。`guild-member-updated` と
> `login-added` はテストでアサートされていませんが、同じハーネスで実走し**正常に生成される**ことを確認しました
> （`group_card -> guild-member-updated`、`bot_status online -> login-added`）。
>
> ⚠️ **マッピングのないイベントは一律に破棄し、型を推測しません**：`meta_event`（`heartbeat` を含む）、
> `notice: notify/poke`、`group_ban`、`essence`、`group_upload` などは
> **Satori イベントを一切生成しません**。テストでは `meta_event heartbeat -> no Satori event` をアサート済み。
> ソースコメント：*"Returns null for events with no Satori equivalent; those are dropped
> rather than guessed at."*

### 5.2 イベントエンベロープ

各イベントは 1 フレームの `{op: 0, body: {...}}` で、`body` の構造は次のとおりです：

```json
{
  "id": 1,
  "sn": 1,
  "type": "message-created",
  "timestamp": 1794541191438,
  "login": { "sn": 1, "adapter": "haizakura", "platform": "haizakura",
             "user": { "id": "10001", "avatar": "...", "is_bot": false } },
  "message": { "...": "..." },
  "user": { "...": "..." },
  "member": { "...": "..." },
  "channel": { "...": "..." },
  "guild": { "...": "..." }
}
```

| フィールド | 説明 |
| --- | --- |
| `id` / `sn` | **同一のインクリメンタルカウンター**（`eventSeq`）。イベントごとに +1 |
| `timestamp` | **ミリ秒**（`Date.now()`） |
| `login` | ログイン以外のイベントでは `sn`/`adapter`/`platform`/`user` のみ（**`status`/`features` なし**） |
| `type` | §5.1 参照 |
| その他 | リソース昇格後のフィールド |

> `sn` は**アダプターレベルのグローバルカウンター**で、すべての接続で共有されます —— 接続ごとの独立した番号ではありません。
> ログインイベント（`login-added`/`login-removed`）の `login` は**完全なオブジェクト**で、
> `status`（`1`/`0`）とすべての `features` を含みます。

### 5.3 ⭐ リソース昇格ルール（Satori 仕様の要求）

Satori は次のように定めています：**ネストしたリソースはイベントの最外層に昇格させ、`message` の内部にはそれらを残さない。**
仕様の原文：

> 当资源对象出现多级嵌套时，内层的资源将会被统一提升到最外层。例如，当接收到消息事件时，
> 事件体中可以访问到 `message`, `member`, `user`, `channel` 等资源，
> 但 `message` 中就不再存在 `member` 和 `user` 字段了。

（訳：リソースオブジェクトが多段にネストする場合、内側のリソースは最外層へ一律に昇格されます。
たとえばメッセージイベントを受信したとき、イベント本体では `message`、`member`、`user`、`channel`
などのリソースにアクセスできますが、`message` の中には `member` と `user` のフィールドは
もはや存在しません。）

本実装は `satoriPromoteResources()` でこれを行います：`message.user` /
`message.member` / `message.channel` / `message.guild` を**`body` の最上位へ移動し、
`message` から `delete`** します。

**`message-created` の実際のフレーム**（削減済み）：

```json
{
  "op": 0,
  "body": {
    "id": 1, "sn": 1, "type": "message-created", "timestamp": 1794541191438,
    "login": { "sn": 1, "adapter": "haizakura", "platform": "haizakura", "user": { "id": "10001", "..." : "..." } },
    "message": { "id": "777", "content": "hi <at id=\"30003\"/><emoji id=\"1\"/>",
                 "created_at": 1700000000000 },
    "user":    { "id": "30003", "name": "群名片", "nick": "群名片", "avatar": "...", "is_bot": false },
    "member":  { "user": { "id": "30003", "..." : "..." }, "nick": "群名片" },
    "channel": { "id": "20001", "type": 0, "name": "测试群" },
    "guild":   { "id": "20001", "name": "测试群", "avatar": "https://p.qlogo.cn/gh/20001/20001/640" }
  }
}
```

テストのアサーション：

- `EVENT promotes channel/guild/user/member` ✅
- `EVENT message stripped of user/member/channel/guild` ✅
- `EVENT channel.id = group_id` ✅

> ⚠️ **厳格なルールからの逸脱が 1 箇所**：`message-deleted` と `reaction-added` /
> `reaction-removed` の payload は**手作業で構築**されており（`satoriPromoteResources` を通していません）、
> それらの `message` には**ネストした `channel` が残ったまま**で、同時に最上位にも `channel` があります：

```json
{ "message": { "id": "777", "channel": { "id": "20001", "type": 0 } },
  "channel": { "id": "20001", "type": 0 } }
```

> これは**欠落ではなく冗長**であり、SDK は最上位を読めば問題ありません。ただし「`message` 内に
> `channel` があってはならない」と厳格に検証するコードでは緩和が必要です。その他のリソース（`guild`/`user`/`member`/`operator`）はすべて最上位にあります。

### 5.4 プライベートチャットのイベント

プライベートチャットの `message-created` には **`guild` も `member` もありません**（QQ のプライベートチャットにグループの意味はありません）。
`channel` は `private:<uin>` で `type: 1` です：

```json
{ "type": "message-created",
  "message": { "id": "778", "content": "dm", "created_at": 1700000001000 },
  "user": { "id": "30003", "name": "某人", "nick": "某人" },
  "channel": { "id": "private:30003", "type": 1 } }
```

### 5.5 イベント payload 早見表

| イベント | 最上位のリソース |
| --- | --- |
| `message-created` | `message`、`user`、`channel`、`guild`（グループチャット）、`member`（グループチャット） |
| `message-deleted` | `message`、`channel`、`user`、`guild`（グループ撤回）、`operator`（実行者が送信者と異なる場合） |
| `guild-member-added` / `-removed` | `guild`、`channel`、`user`、`member`、`operator`（あれば） |
| `guild-member-updated` | `guild`、`channel`、`user`、`member`（`group_admin` の場合は `roles` を含む） |
| `guild-request` / `guild-member-request` | `guild`、`channel`、`user`、`member`、`message`（`id`=flag、`content`=理由）、`operator` |
| `friend-request` | `user`、`message`（`id`=flag、`content`=検証メッセージ） |
| `reaction-added` / `-removed` | `guild`、`channel`、`message`、`user`、`operator`、`emoji` |
| `login-added` / `login-removed` | `login`（完全。`status` + `features` を含む） |

**リクエスト flag の取得方法**（承認時に必要）：

```
guild-request        → body.message.id  → guild.approve        { message_id }
guild-member-request → body.message.id  → guild.member.approve { message_id }
friend-request       → body.message.id  → friend.approve       { message_id }
```

**表情 ID の取得方法**：`reaction-*` イベントの `emoji.id` を、
`reaction.create` / `.delete` / `.list` の `emoji_id` に返します。---

## 6. WebSocket プロトコル

### 6.1 Opcode

| 名称 | 値 | 方向 | 本実装 |
| --- | --- | --- | --- |
| `EVENT` | `0` | サーバー → クライアント | ✅ イベントをプッシュ |
| `PING` | `1` | **クライアント → サーバー** | ✅ 受信すると `PONG` を返す |
| `PONG` | `2` | サーバー → クライアント | ✅ 応答のみ |
| `IDENTIFY` | `3` | クライアント → サーバー | ✅ 認証 |
| `READY` | `4` | サーバー → クライアント | ✅ 認証成功 |
| `META` | `5` | サーバー → クライアント | ❌ **未実装**（定数は宣言済みだが決して送信しない） |

> ⚠️ **サーバーは主体的に `PING` を送りません。** 仕様にある「10 秒ごとに PING を送る」は**アプリケーション（クライアント）**の責務です；
> 本実装は**受動的に応答する**だけです：`op:1` を受信 → `{op:2, body:{}}` を返す（テストで `PING -> PONG` をアサート済み）。
> その他の未知の opcode は debug ログを 1 行記録するだけで、**接続は閉じません**。

### 6.2 接続フロー

```
1. 客户端连接 ws://host:port/v1/events          （路径不符 → HTTP 404 拒绝升级）
2. 客户端在 10 秒内发送 IDENTIFY：{ op:3, body:{ token, sn? } }
3. 服务端校验 token：
      失败 → close(4004, "invalid token")
      成功 → 回 READY：{ op:4, body:{ logins:[Login], proxy_urls:[] } }
4. 之后服务端持续推 EVENT：{ op:0, body:{...事件...} }
5. 客户端每 10s 发 PING，服务端回 PONG（可选）
```

**READY フレームの実例**：

```json
{
  "op": 4,
  "body": {
    "logins": [ { "sn": 1, "adapter": "haizakura", "platform": "haizakura",
                  "user": { "id": "10001", "name": "HaizakuraBot", "nick": "HaizakuraBot",
                            "avatar": "http://q.qlogo.cn/headimg_dl?dst_uin=10001&spec=640",
                            "is_bot": false },
                  "status": 1, "features": ["login.get", "... 共 26 项"] } ],
    "proxy_urls": []
  }
}
```

- `proxy_urls` は**常に空配列**です（本実装にプロキシルーティングはありません）；
- `logins` は常に長さ 1 の配列です（単一アカウント）；
- `get_login_info` の取得に失敗した場合は `ctx.uin` でフォールバックし、それでも正常に READY を返します。

### 6.3 エラー処理とクローズコード

| クローズコード | 理由 | 発生条件 |
| --- | --- | --- |
| **`4004`** | `invalid token` | IDENTIFY の `body.token` が設定と一致しない |
| **`4000`** | `invalid message` | フレームが正当な JSON でない、またはオブジェクトでない（不正フレーム） |
| **`4000`** | `IDENTIFY timeout` | 接続後 **10 秒以内に IDENTIFY を送っていない** |
| `1008` | `access token changed` | ホットアップデートでトークンがローテーションされ、旧クライアントが切断された |
| `1012` | `server closing` | 停止時に**まだ IDENTIFY を完了していない**接続 |
| `1001` | `server closing` | `close()` / `forceClose()` が全接続を閉じる |

テストのアサーション：`bad IDENTIFY token -> close 4004`、`invalid frame JSON -> close 4000`。

> 別途ハーネスで実走し、IDENTIFY を送らない場合は**約 10 秒後に
> `close(4000, "IDENTIFY timeout")` を受信し**、接続がレジストリから削除されることを確認しました。

### 6.4 `sn` セッション復元（⚠️ バッファリング再生は未実装）

- `IDENTIFY.body.sn` は**受け入れられ、その接続の `lastSn` に記録**されます；
- しかし**イベントのバッファリングと再生のロジックは一切ありません** —— ソースで `lastSn` は代入された後に**二度と読まれません**。
- したがって：**切断後の再接続では、切断期間中のイベントは永久に失われ**、補送されません。

> 履歴を確実に補完したい場合は、HTTP の `message.list` で主体的に取得してください。
> 仕様のセッション復元セマンティクス（*sn 以降のバッファ済みイベントを再生する*）は本実装では**成立しません**。依存しないでください。

### 6.5 ⚠️ IDENTIFY より前のイベントがプッシュされる（セキュリティ関連）

`acceptConnection()` は接続を**即座に** `this.connections` に登録します。
一方 `onEvent()` のブロードキャスト条件は**接続数のみを検査し、`identified` を検査しません**：

```js
onEvent(event, _payload) {
  if (!this.isEnabled || this.connections.size === 0) return;
  ...
  for (const connection of this.connections.values()) safeSend(connection.socket, frame);
}
```

**実測で確認**：`accessToken` を設定していても、**何の資格情報も持たず、IDENTIFY も送っていない**
接続が、確立後の **10 秒のウィンドウ内**に完全な `EVENT` フレーム（メッセージ内容を含む）を受信します；
10 秒後に `close(4000)` で切断されます。原因は **upgrade 段階で
`authorizeUpgrade()` を呼んでいない**ことです —— このメソッドはアダプター上に**定義されているが `startServer()` から一度も呼ばれていません**
（比較：`ws-server-connections.ts` では実際に使われています）。

> **影響**：未認証者が短時間だけイベントストリームを盗聴できます（1 接続あたり最大 10 秒）。
> **緩和策**：Satori の待ち受けを**信頼できるネットワーク／ループバックアドレス**にバインドするか、前置のリバースプロキシで認証を行ってください；
> 公網に直接公開しないでください。これは既知の欠陥であり、§9 に正直に記載しています。

---

## 7. リソースマッピング（QQ のセマンティクス → Satori）

### 7.1 対照表

| Satori | Haizakura / QQ |
| --- | --- |
| `Guild.id` | `group_id` |
| `Guild.name` | グループ名（`group_name`、なければ `group_remark`） |
| `Guild.avatar` | `https://p.qlogo.cn/gh/{group_id}/{group_id}/640` |
| `Channel.id` | グループチャット = `group_id`；プライベートチャット = **`private:<uin>`** |
| `Channel.type` | `0` = TEXT（グループチャット）/ `1` = DIRECT（プライベートチャット） |
| `Channel.name` | グループチャット = グループ名；プライベートチャット = 見知らぬ人のニックネーム |
| `User.id` | **文字列**形式の QQ 番号 |
| `User.name` / `User.nick` | **グループ文脈**では `card`（グループ名刺）を優先、なければ `nickname`；**プライベートチャット／`user.get`／`login.get`** では `nickname`（下表の注を参照） |
| `User.avatar` | `http://q.qlogo.cn/headimg_dl?dst_uin={uin}&spec=640` |
| `User.is_bot` | QQ 番号帯から推定（§7.3 参照） |
| `GuildMember.user` | `User` と同じ |
| `GuildMember.nick` | `card \|\| nickname` |
| `GuildMember.joined_at` | `join_time`（秒）× 1000 → **ミリ秒** |
| `GuildMember.roles` | `owner=4` / `admin=3` / `member=2`（常に 1 件） |
| `Message.id` | `message_id`（**整数 → 文字列**） |
| `Message.content` | OneBot のメッセージセグメントを Satori の要素列にエンコード（§8） |
| `Message.created_at` | **ミリ秒**のタイムスタンプ |

> **`User.name` の値の文脈について**（ソース `satoriDecodeUser(uin, name)`）：
> `name` と `nick` は**同時に設定され、値も同じ**です。空のときは**どちらのフィールドも現れません**。何を取るかは呼び出し箇所によります：
>
> | 場面 | 渡される `name` | 実測の `name` |
> | --- | --- | --- |
> | `message-created`（グループ／プライベートチャット）、`message.get`、`guild.member.get`/`.list` | `card \|\| nickname` | `"群名片"` |
> | `user.get`、`login.get`、`channel.get`（プライベートチャット）、`reaction.list` | `nickname` のみ | `"陌生人昵称"` |
> | `friend.list` | `nickname ?? remark`（別途 `nick` = `remark`） | `"好友昵称"` |
> | **すべての `notice` / `request` イベント**（`message-deleted`、`guild-member-*`、`guild-request`、`friend-request`、`reaction-*`） | **渡さない**（単一引数呼び出し） | **`name` フィールドが存在しません** |
>
> したがって同一のユーザーが、**グループメッセージでは名前を持ち、notice/request イベントでは `name` を持ちません** —— これは正常な挙動です。
> ニックネームが必要な場合は、notice イベントで `user.id` から `user.get` を引き直すか、`user.id` に直接依存してください。

### 7.2 ⚠️ タイムスタンプの単位はミリ秒

**これは間違えやすい約束事です。必ず確認してください：**

| 場面 | 単位 | ソース |
| --- | --- | --- |
| イベントの `Message.created_at` | **ミリ秒** | `satoriToInt(event.time) * 1000` |
| `message.create` が返す `created_at` | **ミリ秒** | `Date.now()` |
| イベントエンベロープの `timestamp` | **ミリ秒** | `Date.now()` |
| `GuildMember.joined_at` | **ミリ秒** | `satoriToInt(row.join_time) * 1000` |
| `guild.member.mute` の `duration` | **ミリ秒**（秒に換算して送出） | `ceil(duration / 1000)` |

OneBot の `event.time` は**秒**で、本実装は **1000 を掛けて** Satori のミリ秒に変換します。
この裁定は**LLBot の実装**（`+msgTime * 1000`）と突き合わせて行ったもので、テストでアサート済みです：

- `wire is snake_case: created_at in ms` → `created_at === 1700000000000` ✅
- `message.create created_at is ms` → `> 1e12` ✅
- `member joined_at is ms` → `1600000000000` ✅

> 見分け方：**13 桁はミリ秒、10 桁は秒**です。`1e12` 以上のタイムスタンプはミリ秒です。

### 7.3 `is_bot` の判定

QQ はクライアントに「これはボットだ」と直接伝えないため、本実装は**既知のボット番号帯**から推定します
（ソース `SATORI_BOT_UIN_RANGES`）：

| 番号帯の開始 | 番号帯の終了 |
| --- | --- |
| `3328144510` | `3328144510` |
| `2854196301` | `2854216399` |
| `66600000` | `66600000` |
| `3889000000` | `3889999999` |
| `4010000000` | `4019999999` |

番号帯に含まれない → `is_bot: false`（テストで通常ユーザーの `is_bot === false` をアサート済み）。

### 7.4 ⚠️ オンライン上のフィールドは snake_case

すべてのフィールド名は**オンライン上では snake_case** です：`is_bot`、`created_at`、`joined_at`、
`user_id`、`channel_id`、`guild_id`、`emoji_id`、`proxy_urls`、`role_id`、
`parent_id`、`reply_to`…

**camelCase 版は存在しません**。テストで明確にアサートしています：

- `wire is snake_case: is_bot` → `is_bot === false && !("isBot" in user)` ✅
- `wire has no camelCase createdAt` → `!("createdAt" in message)` ✅

---

## 8. メッセージ要素

Satori は **XML 風の要素列**でメッセージをエンコードします（OneBot のメッセージセグメント配列ではありません）。
たとえば `你好 <at id="30003"/> <emoji id="1"/>` です。

### 8.1 受信方向（QQ → Satori）

OneBot のメッセージセグメントを要素列にエンコードします（ソース `satoriEncodeSegments`）：

| OneBot セグメント | Satori 要素 | 説明 |
| --- | --- | --- |
| `text` | エスケープ後のプレーンテキスト | `& < > "` はエスケープされます |
| `at` | `<at id="..."/>` | `qq == "all"` → `<at type="all"/>` |
| `face` | `<emoji id="..." name="..."/>` | |
| `mface` | `<emoji id="..." name="..."/>` | `emoji_id` / `summary` を取ります |
| `image` / `flash_file` | `<img src="..." title="..."/>` | |
| `record` | `<audio src="..."/>` | |
| `video` | `<video src="..." poster="..."/>` | `thumb` → `poster` |
| `file` | `<file src="..." title="..."/>` | `name` → `title` |
| `reply` | `<quote id="..."/>` | |
| `forward` | `<message id="..." forward/>` | 結合転送 |
| `json` / `xml` | エスケープ後の原文テキスト | カード構造は保持しません |
| `poke` | プレーンテキスト `[戳一戳]` | |
| その他の未知セグメント | `data.text`（あれば出力）、なければ破棄 | |

- 空値の属性は**省略**されます（`satoriAttr` は `undefined`/`null`/空文字列をスキップ）；
- セグメント配列内のオブジェクトでない要素はスキップされます；
- `message` が配列でない場合は文字列全体としてエスケープされます。

### 8.2 送信方向（Satori → QQ）

Satori の要素列を OneBot のメッセージセグメントに解析します（ソース `satoriParseFragment` + `satoriNodesToSegments`）。

**対応する要素**（実測出力）：

| Satori 要素 | OneBot セグメント | 実測 |
| --- | --- | --- |
| 純粋なテキスト | `text` | ✅ |
| `<br/>` | `text` `"\n"` | ✅ |
| `<p>…</p>` | 前後にそれぞれ `"\n"` を補う | ✅ |
| `<at id="1"/>` | `at` `{qq:"1"}` | ✅ |
| `<at type="all"/>` | `at` `{qq:"all"}` | ✅ |
| `<sharp id="9"/>` | `text` `"#9"` | ✅ テキストに降格 |
| `<emoji id="1"/>` / `<face>` | `face` `{id:"1"}` | ✅ |
| `<img src/>` / `<image>` | `image` `{file:src}` | ✅ |
| `<audio src/>` | `record` `{file:src}` | ✅ |
| `<video src poster/>` | `video` `{file:src, thumb:poster}` | ✅ |
| `<file src title/>` | `file` `{file:src, name:title}` | ✅ |
| `<quote id="42"/>` | `reply` `{id:"42"}`（子要素は展開を継続） | ✅ |
| `<a href="…">text</a>` | `text` `"text ( href )"` | ✅ `テキスト ( リンク )` に降格 |
| `<author/>` | **無視**（セグメントを生成しない） | ✅ |
| `<message>` | 子要素を展開するのみ | ⚠️ 下記参照 |
| 未知の要素 | **タグを破棄し、内部のテキストは保持** | ✅ |

**修飾要素の降格ルール**：`b` / `strong` / `i` / `em` / `u` / `ins` / `s` / `del` /
`spl` / `code` / `sup` / `sub` は**一律にプレーンテキストへ降格**します（内部の文字は保持し、タグは破棄）。
実測で `<b>bold</b>` → `[{type:"text",data:{text:"bold"}}]`。

**エスケープと寛容な処理**：

- HTML エンティティの復元に対応：`&lt; &gt; &quot; &apos; &amp;`、および
  `&#65;`（十進）、`&#x42;`（十六進）；
- **閉じていないタグはテキストとして扱います**：`<b>oops` → テキスト `"oops"`；
- **浮いた `>` はテキストとして扱います**：`a > b` → `"a > b"`；
- `<!-- 注释 -->` はスキップされます；
- 解析は**意図的に寛容**で、畸形な payload が 500 になるのを避けています。

**⚠️ 既知の送信制限**（実測）：

| 入力 | 結果 |
| --- | --- |
| `<message id="1"/>`（最上位） | **`400`** —— 送信可能なセグメントを解析できない |
| `<author id="1">x</author>` | **`400`** —— `author` が無視され、残るセグメントがない |
| 純粋なコメント／空文字列 | **`400`** `content must contain at least one sendable element` |

> つまり：**解析後のセグメントリストが空 → 400**（空のテキストセグメントも除外されます）。
> 結合転送（`<message forward>` のネスト）は本実装では**送信能力を持ちません** ——
> `<message>` は透過的なコンテナとして展開されるだけで、`id` 属性は `forward` セグメントに**変換されません**
> （受信方向の `forward` → `<message .../>` と比べて、両者は**非対称**です）。---

## 9. 既知の制限（正直に記載）

| # | 制限 | 詳細 |
| --- | --- | --- |
| 1 | **ページングは近似実装** | `message.list` の `next` は「このページの最後の 1 件の id」を使い、`行数 ≥ limit` の場合にのみ返します；`prev`/`direction` は未対応です。プロトコルが要求する真のカーソルではありません。 |
| 2 | **`sn` セッション復元はバッファリング再生を行わない** | `IDENTIFY.body.sn` は記録されますが**一度も使われません**；切断期間中のイベントは永久に失われます（§6.4）。 |
| 3 | **実際の WS フレーム送受信は arm64 でのみ検証済み** | 本機（x64）には `ws` の native addon がありません（arm64 バイナリのみ）。プロトコル状態機械は **socket double** で駆動しています。**実際のハンドシェイク／フレーミングは未カバー**であり、arm64 ホストでの再検証が必要です。 |
| 4 | **未実装の API は 404 を返す** | これは**仕様の要求**（欠陥ではありません）ですが、リストにないメソッド（`channel.update`、`channel.delete`、`channel.mute`、`user.channel.create`、`message.update`、`guild.member.role.create`、`interaction.*`）を呼ぶとすべて 404 になります。 |
| 5 | **`private:` チャンネルの約束は LLBot に追随** | SDK エコシステムとの互換のために採用したもので、Satori の強制ではありません。実装を替えるときは注意してください。 |
| 6 | **`messageFormat` は Satori に無効** | アダプターはこのフィールドを**読みません** —— Satori は常に要素列の `content` を使い、「array/string」の区別がありません。 |
| 7 | **`reportSelfMessage` は Satori に無効** | アダプターはこのフィールドを**読みません**。`false` に設定しても `message_sent`（自分が送ったメッセージ）は**依然として `message-created` に変換されてプッシュされます**（実走で確認）。 |
| 8 | **upgrade 段階で認証せず、10 秒のイベントウィンドウが存在** | IDENTIFY していない接続もイベントを受信し、10 秒後に `close(4000)` されます；`authorizeUpgrade()` は定義されていますが**一度も呼ばれていません**（§6.5）。公網に公開しないでください。 |
| 9 | **`META`(op 5) は未実装** | 定数は宣言済みですが、サーバーは決して送信しません；`proxy_urls` は常に `[]` です。 |
| 10 | **サーバーは PING を送らない** | ハートビートの方向は**クライアント → サーバー**で、サーバーは受動的に PONG を返すだけです。 |
| 11 | **`message-deleted` / `reaction-*` は厳格な昇格を行っていない** | これらの payload の `message` 内に**依然として `channel` が残っています**（最上位にもあります）。冗長です（§5.3）。 |
| 12 | **`guild.member.role.set` はグループ所有者を譲渡できない** | `role_id: "4"`/`owner` は**管理者の解除**として扱われます（§4.5）。 |
| 13 | **`guild.member.mute` には単位換算と丸めがある** | ミリ秒 → 秒、`ceil` かつ下限 1 秒；`0` は解除を意味します。 |
| 14 | **`<message>` で結合転送を送信できない** | 最上位の `<message>` は子要素を展開するだけで、`id` は無視されます（§8.2）。 |
| 15 | **既定の Satori 待ち受けは存在しない** | 新規インストールでは Satori サーバーが**自動で作成されません**。ソースの `makeDefaultSatoriServer()` は定義済みですが**一度も呼ばれていません**（デッドコード）。既定設定の `wsServers` には `path: "/"` の `ws-default` しかありません。手作業でセンチネルエントリを追加する必要があります。 |
| 16 | **`satoriHttpStatusForResponse` はデッドコード** | この関数は OneBot の `1404` を `404`、`1400` を `400` にマッピングできますが、**一度も呼ばれていません**；実際には下流の失敗はすべて一律で **`400`** を返します。 |
| 17 | **`notice`/`request` イベントの `User` は `name`/`nick` を持たない** | 名前を持つのは `message-created` と各 API が返す `User` だけです（§7.1 の注）。ニックネームが必要なら `user.id` から `user.get` を引き直す必要があります。 |

> **第 3 条について**：`README-satori-tests.md` に明記されています ——
> *"true wire-level WS handshake/framing is NOT covered here. Verify that on an arm64 host."*

---

## 10. LLBot との比較

| 項目 | LLBot | Haizakura |
| --- | --- | --- |
| **接続方式** | 独立した `satoriServers` 設定項目 | **`wsServers[]` + `path` センチネルを再利用** |
| **プラットフォーム識別子** | `llonebot` | `haizakura` |
| **API 数** | **28 個の handler**（29 個の `api__*.ts` ファイル、`api__index.ts` を含む） | **24 個** |
| **イベントタイプ** | **11 種類**（`guild-added` / `guild-removed` / `guild-request` / `guild-member-added` / `-removed` / `-request` / `message-created` / `-deleted` / `reaction-added` / `-removed` / `friend-request`） | **12 種類**（§5.1 参照） |
| 設定の変更 | `config.ts` の変更が必要（kind の追加） | **`config.ts` の変更ゼロ**（プロトタイプメソッドを 1 個パッチするのみ） |
| WebUI のグループ | 独立した Satori グループ | 「WS サーバー」グループに入る（ステータスラベルは依然として Satori） |
| トランスポート実装 | Hono + `@hono/node-server` + 公式 `ws` | `node:http` + **自研の `WebSocketServer`** |
| 型変換 | `ts-case-convert` の `ObjectToSnake` | snake_case リテラルを手書きで構築 |
| 参照位置 | `reference/satori/*.ts` | `restored/packages/onebot/src/network/satori-*.ts` |

**API の差異（精密な突き合わせ）**：Haizakura の **24 個は LLBot の 28 個の厳密な部分集合**であり、
差集合はちょうど **4 個**です —— LLBot が以下 4 個を多く持ちます（Haizakura は未実装で、呼ぶと `404` を返します）：

```
channel.update        channel.delete        channel.mute
user.channel.create （创建私聊频道；LLBot 内部名 createDirectChannel）
```

> 突き合わせ方法：両側のメソッド名を 1 つずつ対応付け（`getChannel` → `channel.get`、
> `handleGuildRequest` → `guild.approve`、`setGuildMemberRole` → `guild.member.role.set`、
> `createDirectChannel` → `user.channel.create` など。`api__index.ts` の import パスから推定）、
> 集合差はちょうど上記 4 項目となり、**24 = 28 − 4** が完全に一致します；
> Haizakura 側に**LLBot が持たない独自メソッドはありません**。
>
> 注：LLBot は `Universal.Methods` で表を引くため（`server.ts` の `app.post('/v1/:name')`）、
> その**実際に呼び出せる範囲**は `handlers` の関数名とプロトコルメソッド名の積集合に依存します。

> **イベント集合は同一ではありません**（両側それぞれ 11/12 種類ですが、包含関係ではありません）：
>
> - **LLBot 独自**：`guild-added`、`guild-removed`（Haizakura に対応するイベントはなく、
>   グループの作成／解散は Satori イベントを生成しません）；
> - **Haizakura 独自**：`guild-member-updated`、`login-added`、`login-removed`
>   （LLBot の `event__*.ts` にはこの 3 種類が見当たりません）。
>
> ⚠️ 上表の LLBot 側の handler 数とイベント名は `reference/satori/api__index.ts`
> と `event__*.ts` の**静的集計**によるもので、**LLBot の実行インスタンスでは実測していません**；
> Haizakura 側の数値はすべてソースと本機の実走によるものです。

> Satori の `adapter` / `platform` フィールドは**プラットフォームの種類**を識別し、SDK 側の差異化処理に使われます。
> 両者の値は異なるため（`llonebot` と `haizakura`）、**アプリケーション側のプラットフォーム判定ロジックは相応の適応が必要**です。

### 10.1 Satori 仕様へのカバレッジ

本リポジトリが取得済みの仕様ページ（`reference/satori-spec/`）にあるメソッド名と本実装の差を求めます：

**仕様にあり、本実装が未実装**（呼ぶと `404` を返します）：

```
channel.create      channel.update      channel.delete      channel.mute
user.channel.create （创建私聊频道）      message.update
```

**本実装にあり、仕様のリソースページに列挙されていない**（プラットフォーム拡張に属し、SDK からも通常呼べます）：

```
login.get           guild.role.list     guild.member.role.set
reaction.create     reaction.delete     reaction.list
friend.list         friend.delete       friend.approve
```

> `*.md` のような項目は取得ページ内のリンクのノイズであり、除外済みです。
> 上表は**静的な比較**によるもので、1 つずつ実機で呼び出してはいません；仕様に未取得のページがまだあるかは
> <https://satori.chat> を正としてください。

---

## 11. 簡易検証

```bash
TOKEN=<your-token>          # 配置里的 accessToken
BASE=http://127.0.0.1:5600
H=(-H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
   -H 'Satori-Platform: haizakura' -H 'Satori-User-ID: 10001')

# 1) 登录信息（最基础的健康检查）
curl -s -X POST $BASE/v1/login.get "${H[@]}" -d '{}'

# 2) 群列表
curl -s -X POST $BASE/v1/guild.list "${H[@]}" -d '{}'

# 3) 发一条群消息
curl -s -X POST $BASE/v1/message.create "${H[@]}" \
  -d '{"channel_id":"20001","content":"hello <at id=\"30003\"/>"}'

# 4) 群成员（注意 joined_at 是毫秒）
curl -s -X POST $BASE/v1/guild.member.get "${H[@]}" \
  -d '{"guild_id":"20001","user_id":"30003"}'

# 5) 反向验证鉴权（预期 401）
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/v1/login.get \
  -H 'Content-Type: application/json' -d '{}'

# 6) 验证平台标识必须是 haizakura（预期 403）
curl -s -X POST $BASE/v1/login.get "${H[@]}" -H 'Satori-Platform: qq' -d '{}'

# 7) 验证不支持的 API 返回 404（预期 404，不是 501）
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/v1/channel.update "${H[@]}" -d '{}'
```

**WebSocket イベントストリーム**（`websocat` または Node スクリプトが必要）：

```bash
websocat ws://127.0.0.1:5600/v1/events
# 连上后立刻发送（10 秒内！）：
{"op":3,"body":{"token":"<your-token>"}}
# 预期收到：{"op":4,"body":{"logins":[...],"proxy_urls":[]}}
```

### テストスイートの再現

```bash
cd restored
node scripts/build.mjs                          # 产出 dist/index.mjs
node scripts/tests/run-satori-tests.mjs         # 76 条协议/API 断言
node scripts/tests/run-satori-integration.mjs   # 22 条挂载/NetworkManager 断言
```

### 実測結果（2026-11-13、本機）

| リクエスト | 結果 |
| --- | --- |
| `login.get`（正しいヘッダー + token） | `200`、`platform: "haizakura"`、26 個の features |
| `login.get`（`Satori-Platform: qq`） | **`403`** `login not found` ✅ |
| `login.get`（ヘッダーをまったく付けない） | `200`（欠落は許容） |
| `message.get`（下流アクションの失敗） | `400` `{"message":"unknown action"}` |
| `channel.update`（未実装） | **`404`** `method not found` ✅ |
| `GET /v1/login.get` | `405` + `Allow: POST` |
| `POST /v1/nonsense` | `404` `method not found` |
| WS：誤った token の IDENTIFY | `close(4004)` |
| WS：不正な JSON フレーム | `close(4000)` |
| WS：10 秒間 IDENTIFY を送らない | `close(4000, "IDENTIFY timeout")` |
| WS：IDENTIFY せずにイベントを受信 | ⚠️ **受信してしまう**（10 秒のウィンドウ、§9 の第 8 条参照） |

---

## 12. よくある質問

| 現象 | 原因 | 対処 |
| --- | --- | --- |
| WebUI に Satori グループが見えない | 設計どおりで、`wsServers[]` を再利用している | 「WS サーバー」グループで探してください。**ステータスラベルは Satori** です |
| `path: "/v1/events"` を設定したのに OneBot のように振る舞う | センチネルの綴りが違う（余分な前置があるなど） | `path` は**完全に** `/v1/events` と等しい必要があります |
| OneBot WS の挙動が突然変わった | **`/v1/events` が OneBot に占有された** | OneBot には別の `path`（たとえば `/`）を使ってください |
| `403 login not found` | `Satori-Platform` に `haizakura` 以外（たとえば `qq`）を渡した、または `Satori-User-ID` が違う | ヘッダーを修正してください。**`haizakura`** です |
| `401 authorization required` | token を設定したが `Authorization` を付けていない | `Authorization: Bearer <token>` を追加してください |
| `404 method not found` | メソッドが 24 個のホワイトリストにない | §4 参照。これは仕様どおりの挙動で、故障ではありません |
| 未実装メソッドの呼び出しで 501 が欲しい | 仕様は 404 を要求している | 501 に依存しないでください |
| 受信したイベントの `message` に `user` がない | **リソース昇格**です。最上位から取ってください | §5.3 参照 |
| 時刻が期待より 1000 倍大きい | それは**ミリ秒**です | §7.2 参照 |
| フィールド名が合わない（`isBot`） | オンライン上は **snake_case** です | §7.4 参照 |
| WS に接続しても反応がない | 10 秒以内に IDENTIFY を送っていない | 即座に `{op:3,body:{token}}` を送ってください |
| 再接続後にイベントが欠ける | `sn` 復元は**再生を未実装** | `message.list` で履歴を補完してください |
| 自分が送ったメッセージもプッシュされる | `reportSelfMessage` は**Satori に無効** | アプリケーション側で `user.id == 自分` によりフィルタしてください |
| `message.create` が 400 を返す | `content` を解析した結果、送信可能な要素がない（空文字列／コメントのみ／最上位 `<message>`） | テキストか対応要素を少なくとも 1 つ入れてください |
| グループメンバーの `joined_at` がない | `join_time` ≤ 0 のときはこのフィールドが**現れません** | 正常な任意フィールドのセマンティクスです |
| 設定保存時にトークンエラーになる | 非ループバックアドレスでは 16 文字以上かつ推測されにくいことが必須 | ランダムな token を使うか `127.0.0.1` にバインドしてください |
| 設定保存時に `statusCommand must be an object` になる | `POST /api/config/:uin` は**完全な**設定を要求します | §2.2 の完全な形を使ってください |
| `channel.list` が 1 件しかない | QQ は**1 グループ 1 チャンネル**（`guild.plain`） | 想定どおりです |
| グループ所有者の譲渡に失敗／管理者が解除される | `role.set` は管理者のオン／オフしか表現できない | §9 の第 12 条参照 |

---

## 13. 宣言

| 項目 | 状態 |
| --- | --- |
| センチネルの識別ルール、マッチングの寛容さ（末尾スラッシュ／クエリ文字列） | **検証済み**：ソース + ハーネス実走（6 種の path 形態） |
| 24 個の API の転送先、パラメータ、戻り値 | **検証済み**：`SATORI_API` テーブル + 1 つずつ実走 |
| イベントタイプ（12 種）とリソース昇格 | **検証済み**：ソース + 実フレームの dump。10 種にテストのアサーションあり |
| ステータスコード、認証ヘッダーの挙動、404/405 の分岐 | **検証済み**：ソース + 7 種のリクエストを実走 |
| WS opcode、クローズコード、10s IDENTIFY タイムアウト | **検証済み**：socket double で実走 |
| 要素の送受信と降格ルール | **検証済み**：22 組の送受信ケースを実走 |
| `reportSelfMessage` / `messageFormat` が無効 | **検証済み**：ソースに参照なし + 実走で再現 |
| イベントが IDENTIFY 前にプッシュされる | **検証済み**：実走で再現（10 秒のウィンドウ） |
| 98/98 テスト通過 | **検証済み**：本機で 76 + 22 を実走 |
| 実際の WS ハンドシェイクとフレーミング | ⚠️ **未検証**（x64 に native addon がなく、arm64 での再検証が必要） |
| 本文の例のポート／グループ番号／token | 例示値であり、あなたの環境では**実測していません** |

> 未実測項目：**実際の WebSocket フレームレベルの送受信**（ハンドシェイク、マスク、フラグメント）は本機で検証しておらず、
> プロトコル状態機械の部分は socket double でカバーしています。結論はソースの読解と二重の実走に基づきます。