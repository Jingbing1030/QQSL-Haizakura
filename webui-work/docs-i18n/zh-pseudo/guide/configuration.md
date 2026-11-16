# 設定参照


OneBot 実例設定与運行時設定文件結構

Haizakura 之設定者二塊分、皆 JSON 也：

- `config/onebot.json` + `config/onebot_.json` —— OneBot 網適配器（HTTP / WebSocket 聴取端、反向 WS、HTTP 上報）。

- `config/runtime.json` —— Haizakura 工程級運行時設定（WebUI 端口、自動注入開関）。

初回運行時二文件自動生成、且読込時字段正規化。

## OneBot 設定

### 文件位置

```
config/onebot.json          # 全局默认
config/onebot_.json    # 账号级覆盖
```

- 全局設定：`config/onebot.json`、全帳号之既定値也。

- 帳号設定：`config/onebot_.json`、全局設定覆上也。

- 自動生成：帳号設定缺失或 access token 欠時、Haizakura 者正規化後之既定設定書込也。

### 既定設定

適配器者類型毎分組、`networks` 対象下配置：

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

**旧格式自移行**：早期版本者 `httpServers` / `wsServers` 等配列直接頂層配置、`httpPostEndpoints` 者上報用也。Haizakura 者此結構検出時、自動新 `networks` 対象移行、且 `httpPostEndpoints` 改名 `httpClients`、磁盤書戻也。手動設定維持者直接新格式使用。

### 通用字段

全適配器以下字段（`NetworkBase`）共有：

| 字段 | 類型 | 既定値 | 説明 |
|---|---|---|---|
| `name` | string | 必須 | 同類型配列内唯一之標識、熱重載者 `(kind, name)` 依址定。 |
| `enabled` | bool | `true` | `false` 設定者設定保持而該適配器不起動。 |
| `accessToken` | string | 自動生成 | 鑑権令牌；OneBot Bearer / `?access_token=`。 |
| `messageFormat` | string | `array` | `array` 或 `string`、事件中 `message` 字段者段配列或文字列決定。 |
| `reportSelfMessage` | bool | `false` | `true` 時該適配器者 `post_type='message_sent'` 自身消息受。 |

### `httpServers`

OneBot HTTP API 服務起動。

| 字段 | 類型 | 既定値 | 説明 |
|---|---|---|---|
| `host` | string | `0.0.0.0` | 聴取地址。 |
| `port` | number | `3000` | 聴取端口。 |
| `path` | string | `/` | API 経路前綴。 |

### `httpClients`

能動事件外部端点 POST（旧名 `httpPostEndpoints`）。

| 字段 | 類型 | 既定値 | 説明 |
|---|---|---|---|
| `url` | string | 必須 | 上報地址。 |
| `timeoutMs` | number | `5000` | 請求超時。 |

### `wsServers`

OneBot WebSocket 服務起動。

| 字段 | 類型 | 既定値 | 説明 |
|---|---|---|---|
| `host` | string | `0.0.0.0` | 聴取地址。 |
| `port` | number | `3001` | 聴取端口。 |
| `path` | string | `/` | WebSocket 経路。 |
| `role` | string | `Universal` | `Api`、`Event` 或 `Universal`（大文字駝峰、旧小文字表記既廃止）。 |

### `wsClients`

能動反向 WebSocket 服務接続。

| 字段 | 類型 | 既定値 | 説明 |
|---|---|---|---|
| `url` | string | 必須 | 反向 WebSocket 地址。 |
| `role` | string | `Universal` | `wsServers.role` 同。 |
| `reconnectIntervalMs` | number | `5000` | 再接続間隔、最小値 `1000` 正規化。 |

### `musicSignUrl`

任意；自定義音楽卡片署名服務地址。空文字列者無効表也。

## 運行時設定（`runtime.json`）

`config/runtime.json` 者 Haizakura 工程級設定記録、**帳号別非也**。

```
{
  "webuiPort": 5099,
  "hookAutoLoad": false
}
```

| 字段 | 類型 | 既定値 | 説明 |
|---|---|---|---|
| `webuiPort` | number | `5099` | WebUI 聴取端口；`1-65535` 超出者既定値退回。 |
| `hookAutoLoad` | bool | `false` | 新発見 QQ 工程中 Hook 自動注入可否。Docker 鏡像既定有効。 |

## 環境変数

| 変数 | 説明 |
|---|---|
| `SNOWLUMA_HOOK_AUTOLOAD` | `1` / `true` 自動注入強制有効；`0` / `false` 無効。優先度 `runtime.json` 之上、Docker 中覆上便利也。 |
| `SNOWLUMA_LOG_LEVEL` | 記録級別設定（`error` / `warn` / `info` / `debug`）。 |
| `SNOWLUMA_VERBOSE_WARMUP=1` | 朋友、群、群成員預熱記録更詳細輸出。 |
| `SNOWLUMA_DEV_MODE=1` | 開発模式有効（WebUI 鑑権緩、本地除錯便利）。 |
| `SNOWLUMA_DEV_WEBUI=1` | dev mode 下内蔵 WebUI 強制有効。 |

## 端口衝突

`3000` / `3001` / `5099` 占有時、対応設定文件之 `port` / `webuiPort` 変更後 Haizakura 再起動。Docker 利用者者宿主機端口直接不同端口映射可能（Docker 配置参照）。

此文档有用乎？

有用無用最終更新

機械人対接

Haizakura 之 OneBot HTTP / WebSocket、MaiBot、AstrBot、NoneBot 接続

排障

扫码、密碼、端口、注入、鏡像取得之常見失敗