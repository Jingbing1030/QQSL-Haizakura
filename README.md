| 日本語 | [`README.md`](README.md)
| 中國語 | [`README.zh.md`](README.zh.md)

# Haizakura

> 公式 QQ クライアントの MSF セッションに寄生する、サードパーティ製 OneBot / Satori ランタイム。

**バージョン 0.2.4.1** ・ Linux arm64 ・ Docker

---

## これは何か

Haizakura は、**公式 QQ クライアントのログイン済みセッションに乗る**タイプのボットランタイムです。
プロトコルを自前で実装するのではなく、公式クライアントが既に確立した通信路（MSF セッション）に
フックを差し込んで、その上でボット API を提供します。

```
公式 QQ (ログイン済み)
      ↓ VTable フック注入
   Haizakura ランタイム (Node.js)
      ↓
   OneBot v11 / Satori / WebUI
```

この設計により、**サーバ側から見ると通信は公式クライアントそのもの**になります。
独自プロトコル実装型のボットとは、この点が根本的に異なります。

> **注意**：本プロジェクトは非公式であり、Tencent とは一切関係ありません。
> 利用は自己責任で行ってください。

---

## 主な機能

### プロトコル

| プロトコル | 状態 | 内容 |
| --- | --- | --- |
| **OneBot v11** | 安定 | **222 個のアクション**（228 個の実行可能名）、12 分類 |
| **Satori** | 新規 | **24 個の API**、12 種のイベント、要素エンコーダ内蔵 |

両プロトコルは**同時に有効化できます**。同じ QQ セッションから OneBot と Satori の
両方に接続する、といった使い方が可能です。

### アクセス方法

OneBot v11 は 4 通り:

- **HTTP サーバ** — `POST /{action}`
- **HTTP クライアント** — イベントを外部へ POST
- **WebSocket サーバ** — 標準的な接続方式
- **WebSocket クライアント** — 外部 WS へ能動接続（再接続あり）

Satori は HTTP API + WebSocket イベント:

```
POST /v1/{resource}.{method}     # API
GET  /v1/events                  # イベント (WebSocket upgrade)
```

### 管理画面 (WebUI)

`http://<host>:5199` で以下を操作できます。

- アカウント状態・プロセスの監視
- OneBot / Satori のネットワーク設定
- ログ閲覧・エクスポート
- デバッグ（アクション実行・ストリーム）
- 外観設定（パレット、背景、カーソル）
- バックアップ / リストア
- TOTP 二要素認証

初回ログイン後は**パスワード変更が必須**です（10 文字以上、大小英字・数字・記号を含む）。

### その他

- **メッセージ履歴データベース** — SQLite によるローカル保存
- **通知** — webhook / メール（SMTP）。`online` / `offline` イベントに対応
- **マルチアカウント** — アカウントごとに独立した設定ファイルとデータベース
- **状態コマンド** — 既定のトリガは `#Haizakura`（`statusCommand` で変更可能）
- **オフラインログイン不要** — 公式 QQ の GUI を noVNC 経由で操作

---

## 導入

### 必要なもの

- Linux **arm64**（x86_64 では WebSocket のネイティブアドオンが動作しません）
- Docker
- メモリ 2GB 以上
- 公式 QQ クライアント（コンテナイメージに同梱）

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

> **`--cap-add SYS_PTRACE` と `--security-opt seccomp=unconfined` は必須です。**
> これが無いと注入に失敗し、`ExitCode 126` / `Operation not permitted` で終了します。

### ポート

| コンテナ内 | ホスト側の例 | 用途 |
| --- | --- | --- |
| 3000 | 3010 | OneBot HTTP |
| 3001 | 3011 | OneBot WebSocket |
| 5099 | 5199 | WebUI |
| 6081 | 6181 | noVNC（ログイン操作用） |
| — | 5600 | Satori（設定時に任意で公開） |

### 初期設定

1. **noVNC で公式 QQ にログイン**
   `http://<host>:6181/vnc.html` を開き、VNC パスワードを入力して QQ のログイン画面を操作します。
   VNC パスワードは `/app/data/config/vnc-password` にあります。

2. **WebUI にログイン**してパスワードを変更
   `http://<host>:5199`

3. **プロトコルを設定**
   ネットワーク設定で HTTP / WebSocket の各リスナーを追加します。

> ⚠️ **コンテナを再起動すると QQ のログイン状態が失われます**（再ログインが必要）。
> 設定変更は WebUI の API 経由で行えば、再起動せずに反映できます。
>
> ただし **ランタイムのみの再起動**（`supervisorctl restart snowluma`）は
> 既存のフックを引き継ぐため、ログイン状態は維持されます。

---

## 設定

主な設定ファイル（`/app/data/config/`）:

| ファイル | 内容 |
| --- | --- |
| `onebot.json` | 全体設定（ネットワーク） |
| `onebot_<uin>.json` | アカウント別設定 |
| `runtime.json` | WebUI ポート、フック自動ロード、ログ保持 |
| `snowluma.json` | rkey フォールバック、楽曲署名、動画同時実行数 |
| `notifications.json` | webhook / メール通知 |

### Satori の有効化

Satori は既存の `wsServers[]` を再利用し、**`path` で識別**します。

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

`path` が `/v1/events` の項目が **Satori サーバ**として扱われます。

> この方式を採る理由：設定スキーマの `fromJson` / `toJsonObject` が
> 4 種類のネットワーク種別を固定で扱っており、新しい種別を追加すると
> 467 個のリージョン全てを再採番する必要があるためです。

詳細は [`docs/guide/configuration.md`](docs/guide/configuration.md) を参照してください。

---

## 制限事項

- **arm64 専用** — x86_64 では WebSocket のネイティブアドオンが存在せず、
  WebSocket 機能（OneBot 自身のものを含む）が利用できません。
- **QQ バージョン依存** — フックは `wrapper.node` の内部構造に依存します。
  QQ が更新されると動作しなくなる可能性があります。
- **Satori の一部機能は未実装** — `channel.create` / `.update` / `.delete` / `.mute`、
  `message.update` は未対応です（未対応 API は 404 を返します）。
- **自動更新は無効化済み** — 上流リポジトリの削除に伴い、更新チェックを停止しています。
- **ページネーションは近似実装** — `message.list` の `next` は完全なカーソルではありません。
- **ライセンスは不明** — 元の `LICENSE` ファイルは配布物に含まれていません。

---

## ドキュメント

| 内容 | 場所 |
| --- | --- |
| はじめに | [`docs/guide/introduction.md`](docs/guide/introduction.md) |
| クイックスタート | [`docs/guide/quick-start.md`](docs/guide/quick-start.md) |
| ログイン | [`docs/guide/login.md`](docs/guide/login.md) |
| 設定リファレンス | [`docs/guide/configuration.md`](docs/guide/configuration.md) |
| よくある質問 | [`docs/guide/faq.md`](docs/guide/faq.md) |
| OneBot v11 | [`docs/protocol/onebot11.md`](docs/protocol/onebot11.md) |
| アクション一覧（222 個） | [`docs/protocol/actions.md`](docs/protocol/actions.md) |
| イベント | [`docs/protocol/events.md`](docs/protocol/events.md) |
| Satori | [`docs/protocol/satori.md`](docs/protocol/satori.md) |
| WebUI | [`docs/webui/overview.md`](docs/webui/overview.md) |
| WebUI API | [`docs/webui/api.md`](docs/webui/api.md) |
| アーキテクチャ | [`docs/advanced/architecture.md`](docs/advanced/architecture.md) |
| 互換性 | [`docs/advanced/compatibility.md`](docs/advanced/compatibility.md) |
| トラブルシューティング | [`docs/advanced/troubleshooting.md`](docs/advanced/troubleshooting.md) |
| ビルド | [`docs/dev/build.md`](docs/dev/build.md) |
| コントリビュート | [`docs/dev/contributing.md`](docs/dev/contributing.md) |

技術的な内部資料（リバースエンジニアリング記録）は [`docs-internals/`](docs-internals/) にあります。

---

## 構成

```
packages/
  bridge/      公式 QQ とのブリッジ、フック、アカウントデータベース
  common/      共通ユーティリティ、ロガー、ランタイム設定
  core/        エントリポイント、WebUI、更新、通知
  onebot/      OneBot v11 実装、ネットワーク層、Satori アダプタ
  protocol/    OIDB サービス、パケット処理（180 ファイル）
  sqlite/      SQLite ネイティブバインディング
  websocket/   WebSocket 実装（ネイティブアドオン使用）
  proton/      プロトコル定義
```

ビルド方法は [`docs/dev/build.md`](docs/dev/build.md) を参照してください。

---

## ライセンス

**不明**。元の上流リポジトリは削除されており、`LICENSE` ファイルは
いかなる配布物にも含まれていません。`EULA.md` は複数箇所で `LICENSE` を
参照していますが、その実体は存在しません。

本リポジトリは**保守目的・非商業利用**を前提として公開されています。
利用の判断は各自で行ってください。

---

*Haizakura — どんなにリアルな機械であっても、彼女は所詮機械であり、所詮人間ではない。*
