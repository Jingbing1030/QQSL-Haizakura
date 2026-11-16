# 設定リファレンス


OneBot インスタンス設定とランタイム設定ファイルの構造

Haizakura の設定は 2 つに分かれ、いずれも JSON です。

- `config/onebot.json` + `config/onebot_.json` —— OneBot ネットワークアダプター（HTTP / WebSocket の待ち受け、逆方向 WS、HTTP レポート）。

- `config/runtime.json` —— Haizakura プロセスレベルのランタイム設定（WebUI ポート、自動注入のスイッチ）。

初回実行時に 2 つのファイルが自動生成され、読み込み時にフィールドが正規化されます。

## OneBot 設定

### ファイルの場所

```
config/onebot.json          # 全局默认
config/onebot_.json    # 账号级覆盖
```

- グローバル設定：`config/onebot.json`。すべてのアカウントの既定値となります。

- アカウント設定：`config/onebot_.json`。グローバル設定を上書きします。

- 自動生成：アカウント設定が存在しない、または access token が欠けている場合、Haizakura は正規化済みの既定設定を書き込みます。

### 既定設定

アダプターは種類ごとにまとめられ、`networks` オブジェクトの下に置かれます。

```
{
  "networks": {
    "httpServers": [
      {
        "name": "http-default",
        "enabled": true,
        "host": "0.0.0.0",
        "port": 3000,
        "path": "/",
        "accessToken": "自动生成",
        "messageFormat": "array",
        "reportSelfMessage": false
      }
    ],
    "httpClients": [],
    "wsServers": [
      {
        "name": "ws-default",
        "enabled": true,
        "host": "0.0.0.0",
        "port": 3001,
        "path": "/",
        "role": "Universal",
        "accessToken": "自动生成",
        "messageFormat": "array",
        "reportSelfMessage": false
      }
    ],
    "wsClients": []
  },
  "musicSignUrl": ""
}
```

Info

**旧形式からの移行**：初期のバージョンでは `httpServers` / `wsServers` などの配列がトップレベルに直接置かれ、レポートには `httpPostEndpoints` が使われていました。Haizakura はこの構造を検出すると、自動的に新しい `networks` オブジェクトへ移行し、`httpPostEndpoints` を `httpClients` に改名してディスクへ書き戻します。設定を手動で管理する場合は、新しい形式をそのまま使ってください。

### 共通フィールド

すべてのアダプターは次のフィールド（`NetworkBase`）を共有します。

| フィールド | 型 | 既定値 | 説明 |
|---|---|---|---|
| `name` | string | 必須 | 同種の配列内で一意な識別子。ホットリロードは `(kind, name)` でアドレス指定します。 |
| `enabled` | bool | `true` | `false` にすると設定は保持したままそのアダプターを起動しません。 |
| `accessToken` | string | 自動生成 | 認証トークン。OneBot の Bearer / `?access_token=`。 |
| `messageFormat` | string | `array` | `array` または `string`。イベントの `message` フィールドがセグメント配列か文字列かを決めます。 |
| `reportSelfMessage` | bool | `false` | `true` にするとそのアダプターは `post_type='message_sent'` の自己メッセージを受け取ります。 |

### `httpServers`

OneBot HTTP API サービスを起動します。

| フィールド | 型 | 既定値 | 説明 |
|---|---|---|---|
| `host` | string | `0.0.0.0` | 待ち受けアドレス。 |
| `port` | number | `3000` | 待ち受けポート。 |
| `path` | string | `/` | API のパスプレフィックス。 |

### `httpClients`

イベントを外部エンドポイントへ能動的に POST します（旧名 `httpPostEndpoints`）。

| フィールド | 型 | 既定値 | 説明 |
|---|---|---|---|
| `url` | string | 必須 | レポート先アドレス。 |
| `timeoutMs` | number | `5000` | リクエストのタイムアウト。 |

### `wsServers`

OneBot WebSocket サービスを起動します。

| フィールド | 型 | 既定値 | 説明 |
|---|---|---|---|
| `host` | string | `0.0.0.0` | 待ち受けアドレス。 |
| `port` | number | `3001` | 待ち受けポート。 |
| `path` | string | `/` | WebSocket のパス。 |
| `role` | string | `Universal` | `Api`、`Event`、`Universal` のいずれか（大文字始まりのキャメルケース。旧来の小文字表記は非推奨）。 |

### `wsClients`

逆方向 WebSocket サービスへ能動的に接続します。

| フィールド | 型 | 既定値 | 説明 |
|---|---|---|---|
| `url` | string | 必須 | 逆方向 WebSocket のアドレス。 |
| `role` | string | `Universal` | `wsServers.role` と同じ。 |
| `reconnectIntervalMs` | number | `5000` | 再接続の間隔。最小値は `1000` に正規化されます。 |

### `musicSignUrl`

任意。カスタムの音楽カード署名サービスアドレス。空文字列は無効を意味します。

## ランタイム設定（`runtime.json`）

`config/runtime.json` は Haizakura のプロセスレベル設定を記録し、**アカウント別ではありません**。

```
{
  "webuiPort": 5099,
  "hookAutoLoad": false
}
```

| フィールド | 型 | 既定値 | 説明 |
|---|---|---|---|
| `webuiPort` | number | `5099` | WebUI の待ち受けポート。`1-65535` の範囲外は既定値へ戻されます。 |
| `hookAutoLoad` | bool | `false` | 新たに検出した QQ プロセスへ Hook を自動注入するか。Docker イメージでは既定で有効です。 |

## 環境変数

| 変数 | 説明 |
|---|---|
| `SNOWLUMA_HOOK_AUTOLOAD` | `1` / `true` で自動注入を強制有効化、`0` / `false` で無効化。`runtime.json` より優先されるため、Docker 上での上書きに便利です。 |
| `SNOWLUMA_LOG_LEVEL` | ログレベルを設定（`error` / `warn` / `info` / `debug`）。 |
| `SNOWLUMA_VERBOSE_WARMUP=1` | フレンド、グループ、グループメンバーのウォームアップログをより詳細に出力します。 |
| `SNOWLUMA_DEV_MODE=1` | 開発モードを有効化（WebUI の認証を緩め、ローカルデバッグを容易にします）。 |
| `SNOWLUMA_DEV_WEBUI=1` | dev mode 下で内蔵 WebUI を強制的に有効化します。 |

## ポートの競合

`3000` / `3001` / `5099` が使用中の場合、該当する設定ファイルの `port` / `webuiPort` を変更して Haizakura を再起動してください。Docker 利用者は、ホスト側のポートを別のポートへマッピングする方法もあります（Docker デプロイ参照）。

このドキュメントは役に立ちましたか？

役に立った役に立たなかった最終更新

ボットとの接続

Haizakura の OneBot HTTP / WebSocket を MaiBot、AstrBot、NoneBot に接続する

トラブルシューティング

QR コード、パスワード、ポート、注入、イメージ取得のよくある失敗