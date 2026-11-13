# Haizakura

> 公式 QQ 客端 MSF 会話寄生之第三国 OneBot / Satori 運行時也。

**版本 0.2.4.1** ・ Linux arm64 ・ Docker

---

## 是何物

Haizakura 者、**公式 QQ 客端登録済会話寄生型** 之機械人運行時也。
自前実装協議非行、公式客端既確立之通信路（MSF 会話）注入釣針、
其上提供機械人 API。

```
公式 QQ（登録済）
      ↓ VTable 釣針注入
   Haizakura 運行時（Node.js）
      ↓
   OneBot v11 / Satori / WebUI
```

此設計故、**伺服器側見之場合、通信宛然公式客端自身**也。
自実装協議型機械人、此点根本相異。

> **注意**：本項目非公式、与騰訊一切関係無。利用自己責任也。

---

## 主要機能

### 協議

| 協議 | 状態 | 内容 |
| --- | --- | --- |
| **OneBot v11** | 安定 | **222 個之動作**（228 個実行可能名）、12 分類 |
| **Satori** | 新規 | **24 個之 API**、12 種之事件、要素符牒化器内蔵 |

両協議**同時有効化可能**也。同一 QQ 会話、同時 OneBot 与 Satori 接続可能。

### 接続方法

OneBot v11 四通：

- **HTTP 伺服器** — `POST /{action}`
- **HTTP 客端** — 事件外部 POST
- **WebSocket 伺服器** — 標準接続方式
- **WebSocket 客端** — 外部 WS 能動接続（再接続有）

Satori 者 HTTP API + WebSocket 事件：

```
POST /v1/{resource}.{method}     # API
GET  /v1/events                  # 事件 (WebSocket upgrade)
```

### 管理画面（WebUI）

`http://<host>:5199` 開、以下操作可能。

- 帳号状態・工程監視
- OneBot / Satori 網設定
- 記録閲覧・輸出
- 除錯（動作実行・流式接口）
- 外観設定（配色、背景、遊標）
- 備份 / 復元
- TOTP 二要素認証

初回登録後、**密碼変更必須**（10 文字以上、大小英字・数字・記号含）。

### 其他

- **消息履歴資料庫** — SQLite 依本地保存
- **通知** — webhook / 郵件（SMTP）。`online` / `offline` 事件対応
- **複数帳号** — 帳号毎独立設定文件与資料庫
- **状態命令** — 既定触発語 `#Haizakura`（`statusCommand` 変更可能）
- **扫码登録接口無** — 公式 QQ 図形界面 noVNC 経由操作

---

## 導入

### 必要之物

- Linux **arm64**（x86_64 者 WebSocket 原生插件不可動）
- Docker
- 記憶 2GB 以上
- 公式 QQ 客端（容器映像同梱）

### 起動

```bash
docker run -d \
  --name haizakura \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  -p 3010:3000 \
  -p 3011:3001 \
  -p 5199:5099 \
  -p 6181:6081 \
  -v haizakura-config:/app/.config \
  -v haizakura-data:/app/data \
  -v haizakura-client:/app/.local/share \
  motricseven7/snowluma:latest
```

> **`--cap-add SYS_PTRACE` 与 `--security-opt seccomp=unconfined` 必須也。**
> 之無場合、注入失敗、`ExitCode 126` / `Operation not permitted` 終了。

### 端口

| 容器内 | 宿主側例 | 用途 |
| --- | --- | --- |
| 3000 | 3010 | OneBot HTTP |
| 3001 | 3011 | OneBot WebSocket |
| 5099 | 5199 | WebUI |
| 6081 | 6181 | noVNC（登録操作用） |
| — | 5600 | Satori（設定時任意公開） |

### 初期設定

1. **noVNC 依公式 QQ 登録**
   `http://<host>:6181/vnc.html` 開、VNC 密碼入力、QQ 登録画面操作。
   VNC 密碼者 `/app/data/config/vnc-password` 在。

2. **WebUI 登録** 且密碼変更
   `http://<host>:5199`

3. **協議設定**
   網設定、HTTP / WebSocket 各聴取器追加。

> ⚠️ **容器再起動者、QQ 登録状態喪失**（再登録必要）。
> 設定変更、WebUI 之 API 経由行、再起動不要反映可能。
>
> 但 **運行時之再起動**（`supervisorctl restart snowluma`）者、
> 既存釣針引継、登録状態維持也。

---

## 設定

主要設定文件（`/app/data/config/`）：

| 文件 | 内容 |
| --- | --- |
| `onebot.json` | 全体設定（網） |
| `onebot_<uin>.json` | 帳号別設定 |
| `runtime.json` | WebUI 端口、釣針自動載入、記録保持 |
| `snowluma.json` | rkey 退避、楽曲署名、動画同時実行数 |
| `notifications.json` | webhook / 郵件通知 |

### Satori 有効化

Satori 既存 `wsServers[]` 再利用、**`path` 依識別**。

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
    ]
  }
}
```

`path` 之 `/v1/events` 条目、**Satori 伺服器** 扱。

> 此方式採用理由：設定 schema 之 `fromJson` / `toJsonObject`、
> 4 種之網類型固定処理、新種追加者 467 個之 region 全部再番号必要故也。

詳細 [`docs/guide/configuration.md`](docs/guide/configuration.md) 参照。

---

## 制限事項

- **arm64 専用** — x86_64 者 WebSocket 原生插件不存在、
  WebSocket 機能（OneBot 自身之物含）利用不可。
- **QQ 版本依存** — 釣針 `wrapper.node` 内部構造依存。
  QQ 更新者、動作不能可能性有。
- **Satori 一部機能未実装** — `channel.create` / `.update` / `.delete` / `.mute`、
  `message.update` 未対応（未対応 API 者 404 返）。
- **自動更新無効化済** — 上流倉庫削除伴、更新検査停止。
- **分頁近似実装** — `message.list` 之 `next`、完全遊標非也。
- **許可不明** — 元 `LICENSE` 文件、配布物含無。

---

## 文書

| 内容 | 場所 |
| --- | --- |
| 初之意 | [`docs/guide/introduction.md`](docs/guide/introduction.md) |
| 快速開始 | [`docs/guide/quick-start.md`](docs/guide/quick-start.md) |
| 登録 | [`docs/guide/login.md`](docs/guide/login.md) |
| 設定参照 | [`docs/guide/configuration.md`](docs/guide/configuration.md) |
| 常見質問 | [`docs/guide/faq.md`](docs/guide/faq.md) |
| OneBot v11 | [`docs/protocol/onebot11.md`](docs/protocol/onebot11.md) |
| 動作一覧（222 個） | [`docs/protocol/actions.md`](docs/protocol/actions.md) |
| 事件 | [`docs/protocol/events.md`](docs/protocol/events.md) |
| Satori | [`docs/protocol/satori.md`](docs/protocol/satori.md) |
| WebUI | [`docs/webui/overview.md`](docs/webui/overview.md) |
| WebUI API | [`docs/webui/api.md`](docs/webui/api.md) |
| 構造 | [`docs/advanced/architecture.md`](docs/advanced/architecture.md) |
| 互換性 | [`docs/advanced/compatibility.md`](docs/advanced/compatibility.md) |
| 故障探査 | [`docs/advanced/troubleshooting.md`](docs/advanced/troubleshooting.md) |
| 建構 | [`docs/dev/build.md`](docs/dev/build.md) |
| 開発参加 | [`docs/dev/contributing.md`](docs/dev/contributing.md) |

技術内部資料（逆向工程記録）者 [`docs-internals/`](docs-internals/) 在。

---

## 構成

```
packages/
  bridge/      公式 QQ 与之橋渡、釣針、帳号資料庫
  common/      共通工具、記録器、運行時設定
  core/        入口、WebUI、更新、通知
  onebot/      OneBot v11 実装、網層、Satori 適配器
  protocol/    OIDB 服務、包処理（180 文件）
  sqlite/      SQLite 原生結合
  websocket/   WebSocket 実装（原生插件使用）
  proton/      協議定義
```

建構方法者 [`docs/dev/build.md`](docs/dev/build.md) 参照。

---

## 許可

**不明**。元上流倉庫削除済、`LICENSE` 文件、何等配布物含無。
`EULA.md` 複数箇所 `LICENSE` 参照、但其実体不存在。

本倉庫、**保守目的・非商業利用** 前提公開。
利用判断各自行。

---

*Haizakura — どんなにリアルな機械であっても、彼女は所詮機械であり、所詮人間ではない。*
