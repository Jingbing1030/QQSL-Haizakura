# 紹介


Haizakura とは何か、何ができるのか、そしてその 3 つの利用形態と配布構成

Haizakura は NTQQ（QQ デスクトップクライアント）向けの**リモートプロトコルフレームワーク**です。QQ を OneBot v11 エコシステムへ橋渡しします。native addon が ptrace レベルの注入によって、実行中の QQ プロセス（Linux ではプロセス名 `qq`、Windows では `QQ.exe`）へ hook を打ち込み、その内部データパケットを解析し、OneBot v11 の形式で HTTP / WebSocket / 逆方向 WS / HTTP レポートとして公開します。

このカーネルを中心に、Haizakura はさらに次を提供します。

- OneBot v11 アダプター —— HTTP API サービス、WebSocket サービス、逆方向 WebSocket、HTTP イベントレポートを任意に組み合わせ可能。

- NTQQ ブリッジ —— 実際の QQ クライアントへ直接接続し、プロトコル番号も独立したログインも不要。

- 複数アカウント —— 1 つの UIN に 1 つの OneBot インスタンス。自動検出・自動接続で、手動設定は不要。

- 内蔵 WebUI —— ブラウザー上でアカウントと設定を管理し、状態を確認。

- TypeScript SDK —— `@snowluma/sdk` で、型が完全な OneBot クライアントを記述。

- MCP サービス —— `@snowluma/mcp` で、MCP 対応の AI クライアントから OneBot action を照会・呼び出し。

## 3 つの利用形態

| あなたの目的 | 形態 | 入口 |
|---|---|---|
| サーバー上でボットを長期運用する | Docker（推奨） | Docker デプロイ |
| AI クライアントから QQ を呼び出す | MCP | MCP 接続 |
| 手元のマシンで手早く試す | ビルド済み tarball | デプロイ方法の選択 |

クライアントコードを書く場合は TypeScript SDK を参照してください。

## 配布構成

各プラットフォームには GitHub Releases で 2 種類の tarball が提供されます。

| パッケージ名 | Node.js 同梱 | 用途 |
|---|---|---|
| `Haizakura---.tar.gz`（full） | Node.js ランタイムを内蔵 | マシンに Node がなくてもすぐ使える |
| `Haizakura----lite.tar.gz`（lite） | Node.js を含まない（パッケージが大幅に小さい） | Node.js ≥ 22 が導入済みのマシン（Node 24 LTS を推奨） |

公開済みのプラットフォーム / アーキテクチャ：`linux-x64`、`linux-arm64`、`win-x64`。

Info

Haizakura には **Node.js ≥ 22** が必要です。2026 年時点で **Node 24（"Krypton"）は Active LTS**、22（"Jod"）は Maintenance LTS に入っているため、lite パッケージでは **Node 24 LTS** のインストールを推奨します（22 も引き続き利用可能）。full パッケージはランタイムを同梱するため、インストールは不要です。出典：nodejs.org。

展開後の `dist/` は概ね次の構成です。

```
dist/
├── index.mjs          # 入口：node ./index.mjs
├── launcher.bat       # Windows 起動スクリプト（node ./index.mjs + pause）
├── webui/             # 内蔵 WebUI の静的リソース
└── native/            # native addon + websocket ネイティブモジュール
    ├── snowluma-win32-x64.{node,dll}
    ├── snowluma-linux-x64.{node,so}
    ├── snowluma-linux-arm64.{node,so}
    └── websocket--.node
```

実行方法：展開後に `node ./index.mjs` を実行します。Windows では `launcher.bat` をダブルクリックすることもできます。

## 既定のサービス

| サービス | 既定の待ち受け | 説明 |
|---|---|---|
| OneBot HTTP | `0.0.0.0:3000` | OneBot v11 HTTP API |
| OneBot WS | `0.0.0.0:3001` | OneBot v11 WebSocket |
| WebUI | `0.0.0.0:5099` | 内蔵の管理画面 |
| VNC | `5900` | Docker 内部のみ：ネイティブリモートデスクトップ。公式テンプレートは外部へ公開しない |
| noVNC | `6081` | Docker のみ：ブラウザー経由のリモートデスクトップ、QR コードログイン |

ポートや待ち受けアドレスなどは設定で変更できます。詳しくは設定リファレンスを参照してください。

Warning

noVNC / WebUI / OneBot のポートを**そのまま**公網へ公開しないでください。Docker のリモートデスクトップには固定の既定パスワードが**なく**、初回起動時にランダムに生成され、コンテナログに一度だけ出力されます。

## プロジェクトの状態

Warning

Haizakura は現在も**初期開発段階**にあり、インターフェース、設定構造、配布レイアウトはいずれもバージョン間で変化する可能性があります。本番環境では具体的なバージョン tag を固定し、アップグレード前に 更新説明 を確認してください。

## 次のステップ

- クイックスタート —— どこから始めればよいか分からない場合は、まずこちらを参照してください。

- デプロイ方法の選択 —— すべてのデプロイ経路を比較し、自分に合ったものを選んでください。
このドキュメントは役に立ちましたか？

役に立った役に立たなかった最終更新

クイックスタート

どのデプロイ経路を選ぶべきかを 1 ページで把握し、最も一般的な Docker での導入を完了する
