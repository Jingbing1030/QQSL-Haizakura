# 設定參考


OneBot 實例設定與執行環境設定檔結構

Haizakura 的設定分兩塊，都是 JSON：

- `config/onebot.json` + `config/onebot_.json` —— OneBot 網路配接器（HTTP / WebSocket 監聽端、反向 WS、HTTP 上報）。

- `config/runtime.json` —— Haizakura 行程級執行環境設定（WebUI 連接埠、自動注入開關）。

首次執行會自動產生兩個檔案，並在載入時正規化欄位。

## OneBot 設定

### 檔案位置

```
config/onebot.json          # 全域預設
config/onebot_.json    # 帳號級覆寫
```

- 全域設定：`config/onebot.json`，作為所有帳號的預設值。

- 帳號設定：`config/onebot_.json`，會覆寫全域設定。

- 自動產生：帳號設定缺失或缺 access token 時，Haizakura 會寫入正規化後的預設設定。

### 預設設定

配接器按類型分組放在 `networks` 物件下：

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

**從舊格式遷移**：早期版本把 `httpServers` / `wsServers` 等陣列直接放在頂層，`httpPostEndpoints` 用於上報。當 Haizakura 偵測到這種結構時會自動遷移到新的 `networks` 物件並把 `httpPostEndpoints` 改名為 `httpClients`，回寫到磁碟。手動維護設定請直接使用新格式。

### 通用欄位

所有配接器都共用下列欄位（`NetworkBase`）：

| 欄位 | 類型 | 預設值 | 說明 |
|---|---|---|---|
| `name` | string | 必填 | 同類型陣列內唯一的識別，熱重載按 `(kind, name)` 定址。 |
| `enabled` | bool | `true` | 設為 `false` 可保留設定但不啟動該配接器。 |
| `accessToken` | string | 自動產生 | 驗證權杖；OneBot Bearer / `?access_token=`。 |
| `messageFormat` | string | `array` | `array` 或 `string`，決定事件中 `message` 欄位是段陣列還是字串。 |
| `reportSelfMessage` | bool | `false` | 為 `true` 時該配接器會收到 `post_type='message_sent'` 自身訊息。 |

### `httpServers`

啟動 OneBot HTTP API 服務。

| 欄位 | 類型 | 預設值 | 說明 |
|---|---|---|---|
| `host` | string | `0.0.0.0` | 監聽位址。 |
| `port` | number | `3000` | 監聽連接埠。 |
| `path` | string | `/` | API 路徑前綴。 |

### `httpClients`

主動把事件 POST 到外部端點（舊名 `httpPostEndpoints`）。

| 欄位 | 類型 | 預設值 | 說明 |
|---|---|---|---|
| `url` | string | 必填 | 上報位址。 |
| `timeoutMs` | number | `5000` | 請求逾時。 |

### `wsServers`

啟動 OneBot WebSocket 服務。

| 欄位 | 類型 | 預設值 | 說明 |
|---|---|---|---|
| `host` | string | `0.0.0.0` | 監聽位址。 |
| `port` | number | `3001` | 監聽連接埠。 |
| `path` | string | `/` | WebSocket 路徑。 |
| `role` | string | `Universal` | `Api`、`Event` 或 `Universal`（大寫駝峰，舊的小寫寫法已廢棄）。 |

### `wsClients`

主動連線反向 WebSocket 服務。

| 欄位 | 類型 | 預設值 | 說明 |
|---|---|---|---|
| `url` | string | 必填 | 反向 WebSocket 位址。 |
| `role` | string | `Universal` | 同 `wsServers.role`。 |
| `reconnectIntervalMs` | number | `5000` | 重新連線間隔，最小值會被正規化為 `1000`。 |

### `musicSignUrl`

選用；自訂音樂卡片簽章服務位址。空字串表示停用。

## 執行環境設定（`runtime.json`）

`config/runtime.json` 記錄 Haizakura 行程級設定，**不分帳號**。

```
{
  "webuiPort": 5099,
  "hookAutoLoad": false
}
```

| 欄位 | 類型 | 預設值 | 說明 |
|---|---|---|---|
| `webuiPort` | number | `5099` | WebUI 監聽連接埠；超出 `1-65535` 會被退回預設值。 |
| `hookAutoLoad` | bool | `false` | 是否自動把 Hook 注入到新發現的 QQ 行程。Docker 映像預設開啟。 |

## 環境變數

| 變數 | 說明 |
|---|---|
| `SNOWLUMA_HOOK_AUTOLOAD` | `1` / `true` 強制開啟自動注入；`0` / `false` 關閉。優先順序高於 `runtime.json`，方便在 Docker 裡覆寫。 |
| `SNOWLUMA_LOG_LEVEL` | 設定日誌等級（`error` / `warn` / `info` / `debug`）。 |
| `SNOWLUMA_VERBOSE_WARMUP=1` | 輸出更詳細的好友、群、群成員預熱日誌。 |
| `SNOWLUMA_DEV_MODE=1` | 啟用開發模式（WebUI 驗證放寬，便於本機偵錯）。 |
| `SNOWLUMA_DEV_WEBUI=1` | 在 dev mode 下強制啟用內建 WebUI。 |

## 連接埠衝突

`3000` / `3001` / `5099` 被佔用時，修改對應設定檔的 `port` / `webuiPort` 後重新啟動 Haizakura。Docker 使用者也可以直接把主機連接埠對應到不同連接埠（見 Docker 部署）。

這篇文件有幫助嗎？

有幫助 / 沒幫助 · 最後更新於

對接機器人

把 Haizakura 的 OneBot HTTP / WebSocket 接到 MaiBot、AstrBot、NoneBot

排障

掃碼、密碼、連接埠、注入、映像拉取的常見失敗
