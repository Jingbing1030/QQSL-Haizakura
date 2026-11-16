# ボットとの接続


Haizakura の OneBot HTTP / WebSocket を MaiBot、AstrBot、NoneBot に接続する

Haizakura はプロトコル側であり、ボットフレームワークではありません。ボットのプロセスから接続すればよいだけです。

Docker イメージでは、OneBot は既定で `0.0.0.0` を待ち受けます。これにより同じ Docker ネットワーク内の他のコンテナから接続できます。Docker 以外のインストールでは既定で引き続きループバックです。

認証：`Authorization: Bearer ` または `?access_token=`。Token は WebUI か `config/onebot.json` / `onebot_.json` にあります。HTTP と WS でそれぞれ別の token を持てます。

## 正向：ボットが Haizakura に接続する

**MaiBot** に適しています（その Haizakura / NapCat アダプターはクライアント側です）。

|  |  |
|---|---|
| HTTP API | `http://snowluma:3000/` |
| WebSocket | `ws://snowluma:3001/` |

ボットのコンテナ内ではサービス名 `snowluma` を使ってください。`127.0.0.1` は使わないでください（それはボット自身のループバックです）。

ホスト上のクライアントは `http://127.0.0.1:3000/` を使います（ポートがマッピング済みの場合）。

## 反向：Haizakura がボットに接続する

**AstrBot**、**NoneBot2** に適しています。Haizakura の設定に `wsClients` を追加します（WebUI では「逆方向 WebSocket」）。

| フレームワーク | 一般的な URL |
|---|---|
| AstrBot | `ws://astrbot:6199/ws` |
| NoneBot2 | `ws://nonebot:8080/onebot/v11/ws` |

パスは相手側のドキュメントに従ってください。Haizakura は接続しに行く側です。

イベントの HTTP POST には `httpClients` を使い、同じく相手側のレポート先アドレスを記入します。

## sidecar インストール

すでに MaiBot / AstrBot の compose がある場合：

```
./install.sh --mode compose --network maim_bot --yes
```

`maim_bot` は `docker network ls` に表示される実際のネットワーク名に置き換えてください。インストーラーは相手側の yaml を**変更しません**。

その後、ボットのアダプターを `snowluma:3001` に向ける（正向）か、Haizakura 側に逆方向 URL を記入します。

## 複数アカウント

UIN ごとに 1 つの `onebot_.json` です。既定ではいずれも `3000` / `3001` を占有しようとするため、2 つ目のアカウントではポートを変更するか、逆方向 WS で別のボット入口を指定してください。

完全なフィールドは 設定リファレンスを参照してください。

このドキュメントは役に立ちましたか？

役に立った役に立たなかった最終更新

Docker 永続データの移行

既存の Docker データを現在の永続レイアウトへ安全に移行する

設定リファレンス

OneBot インスタンス設定とランタイム設定ファイルの構造