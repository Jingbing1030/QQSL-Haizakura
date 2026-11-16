# クイックスタート


どのデプロイ経路を選ぶべきかを 1 ページで把握し、最も一般的な Docker での導入を完了する

最初の一歩は何かをインストールすることではなく、**どの道を選ぶかを決めること**です。Haizakura の核心は hook を実際の QQ プロセスへ注入することにあるため、QQ + 注入 + QR コードログインを動かせる環境が必要です。次の表は、手元の環境に応じて推奨経路を直接示します。そのまま辿ってください。

## どの道を選ぶべきか

| あなたの状況 | 推奨経路 | リンク |
|---|---|---|
| Linux サーバーがある | Docker（最も推奨、最も手軽） | Docker デプロイ |
| Windows のローカルマシン | Windows 手動 / Docker Desktop | Windows デプロイ |
| WSL2 を使いたい | WSL2 上でコンテナを実行 | WSL2 デプロイ |
| Android スマートフォンしかない | Termux + proot（上級 / 実験的） | スマートフォンデプロイ |
| 宝塔パネルを導入済みの Linux サーバー | パネルの Docker アプリストアからワンクリックで取り込み | 宝塔パネルデプロイ |
| AI クライアントを接続したい | MCP サービス | MCP 接続 |
| クライアントコードを書きたい | TypeScript SDK | SDK |

判断に迷ったら **Docker on Linux** を選んでください。公式に推奨され、最も容易に起動できる方法です。完全な比較はデプロイ方法の選択を参照してください。

## 最速の導入（Docker）

Linux では公式イメージを自分で起動するのが公式の推奨です。3 ステップです。

**1. コンテナを起動する**

```
docker run -d \
  --name snowluma \
  --restart unless-stopped \
  --shm-size=1g \
  --cap-add=SYS_PTRACE \
  --security-opt seccomp=unconfined \
  -p 6081:6081 -p 5099:5099 -p 3000:3000 -p 3001:3001 \
  -v qq-gateway-data:/app/data \
  -v qq-client-config:/app/.config \
  -v qq-client-data:/app/.local/share \
  motricseven7/snowluma:latest
```

Danger

`--cap-add=SYS_PTRACE` と `--security-opt seccomp=unconfined` は**省略できません**。既定の seccomp は注入を遮断し、QQ（Chromium）には `--shm-size=1g` も必要です。リモートデスクトップのパスワードは初回起動時にランダム生成され、ログに一度だけ出力されます。

**2. QR コードでログインする**

ブラウザーで `http://:6081/`（noVNC）を開きます。パスワード：

```
docker logs snowluma 2>&1 | grep -E "远程桌面密码:|remote desktop password:" | tail -n 1
```

リモートデスクトップ内では QQ が自動起動済みです。スマートフォンの QQ で QR コードを読み取ってください。

**3. WebUI を開く**

ブラウザーで `http://:5099/` を開きます。完全な Compose や複数アカウントについては Docker デプロイを参照してください。

## 実験的：ワンクリックインストールスクリプト（Alpha）

Warning

**第一の推奨ではありません。** Alpha テスト中であり、コマンドと既定の挙動は変化する可能性があります。Docker を動かせる場合は前節を優先してください。進んで検証に協力していただける場合は、次を試せます。

```
curl -fsSL https://raw.githubusercontent.com/Haizakura/Haizakura.Docker.Framework/main/install.sh | bash
```

```
curl -fsSL https://raw.githubusercontent.com/Haizakura/Haizakura.Docker.Framework/main/install.sh | bash -s -- --mode docker --yes
```

対話形式でモードを尋ねられます。`--yes` を指定して `--mode` を書かない場合は docker が既定です。詳細、sidecar、ローカルモードについては ワンクリックインストール（実験的）を参照してください。

## ログインと初回アクセス

どの経路であっても、初回の導入で次の作業は避けられません。

- QR コードログイン：Haizakura は QR コードログインのみに対応し、CLI ログインはありません。ヘッドレス環境では VNC / noVNC 経由で QQ のウィンドウを表示してからでないと QR コードを読み取れません。

- WebUI の一時パスワードを探す：全新のデータディレクトリで初回起動した際、ログに一度限りの管理者パスワードが出力されます。Docker の場合：

```
docker logs snowluma 2>&1 | grep -E "临时密码|initial credentials" | tail -n 1
```

Info一時パスワードは全新のデータディレクトリでの初回起動時に一度だけ出力され、再起動や既存データの再利用では再生成されません。

- ポートを開放する：外部からアクセスするには、WebUI（`5099`）と使用する OneBot のポート（`3000` / `3001`）を開放してください。

Warning

noVNC / WebUI / OneBot のポートを**そのまま**公網へ公開しないでください。リモートデスクトップには固定の既定パスワードがなく、コンテナログを確認すれば十分です。

## パスワードレスログイン（URL token）

毎回パスワードを手入力するのは面倒ではありませんか。WebUI はアドレスに**ログインパスワード**を含めて直接入場できます。

```
http://:5099/?token=
```

- パラメーター名は `token` で、値は普段 WebUI へのログインに使うパスワードです。Haizakura はこれを使ってログインインターフェースを呼び出し、パスワードが正しければそのままホーム画面へ進みます。

- 使用後は即時消去：パスワードは読み取られると直ちにアドレスバーから除去され（`history.replaceState`）、ブラウザー履歴 / アクセスログ / Referer ヘッダー経由の漏洩を防ぎます。

- サーバー側は通常どおり検証し、パスワードが誤っていればログインページへ戻るだけで、回避は成立しません。

Warning

パスワードが URL に現れるのは**リスクが高く**（ブラウザー履歴に残り、中間機器 / プロキシに記録される可能性があります）、信頼できるローカル / イントラネット環境でのみ使用を推奨します。パスワード付きのリンクを共有したり、チャット / issue に貼り付けたり、公共の端末で使ったりしないでください。

## 次のステップ

- デプロイ方法の選択 —— 各経路の詳細な比較。

- 設定リファレンス —— ポート、access token、アダプターの変更。

- 更新 —— ログイン状態を失わずにアップグレードする。
このドキュメントは役に立ちましたか？

役に立った役に立たなかった最終更新

紹介

Haizakura とは何か、何ができるのか、そしてその 3 つの利用形態と配布構成

デプロイ

Haizakura の各デプロイ方式の比較と選択
