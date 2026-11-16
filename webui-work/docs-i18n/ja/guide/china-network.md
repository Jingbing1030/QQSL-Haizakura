# 中国国内のネットワーク


Docker Hub、GitHub、QQ インストールパッケージを大陸のネットワークでどう扱うか

インストーラーはすでに失敗を「スキップ」として処理します。どこかで不通になればその区間を報告し、次の手を示します。同じことを手動で行うこともできます。

## Docker イメージ

公式イメージ：`motricseven7/snowluma`。

Hub がタイムアウトしたり制限がかかったりする場合は、プレフィックス経由で取得してからタグを付け直します。

```
docker pull docker.1ms.run/motricseven7/snowluma:latest
docker tag docker.1ms.run/motricseven7/snowluma:latest motricseven7/snowluma:latest
```

`docker.xuanyuan.me/`、`docker.m.daocloud.io/` も試せます。これらの公開プレフィックスは変化するため、唯一の取得元として固定しないでください。

クラウド事業者のマシンでは、コンソールのイメージアクセラレーションを優先してください。**1Panel / 宝塔**ではパネル上で設定し、スクリプトに `daemon.json` を書き換えさせないでください。

## Docker Engine のインストール

出所不明の Gitee ワンクリックスクリプトは使わないでください。

- Ubuntu/Debian：Alibaba Cloud / 清華の `docker-ce` リポジトリ

- インストーラーはこれらのリポジトリを使います。失敗した場合は `get.docker.com --mirror Aliyun` を試してください

- OpenCloudOS / openEuler では、リポジトリに同梱された極端に古い docker を使わないでください

## インストーラースクリプト

1 コマンドのうち `raw.githubusercontent.com` が開けない場合：

```
curl -fsSL https://ghfast.top/https://raw.githubusercontent.com/Haizakura/Haizakura.Docker.Framework/main/install.sh | bash
```

テンプレートファイルはさらに jsDelivr / ghfast を経由します。出所不明の Gitee ワンクリックスクリプトに置き換えないでください。

## GitHub Release（lite パッケージ、host モード）

`github.com` / `objects.githubusercontent.com` は非常に遅いことがあります。host モードのインストーラーは ghfast、gh-proxy、GitHub 直結を順に試し、ダウンロード後にハッシュを検証できる場合は検証します。

GitHub のアクセラレーションプレフィックスを Docker の `registry-mirrors` に書き込まないでください。

## Linux QQ インストールパッケージ

テンセントの CDN `qqdl.gtimg.cn` を使います。中国国内では通常そのまま接続できます。Docker イメージのビルドも、公式サイトの現在のファイル名と固定したバックアップアドレスを使い、`latest` には追従しません。

このドキュメントは役に立ちましたか？

役に立った役に立たなかった最終更新

トラブルシューティング

QR コード、パスワード、ポート、注入、イメージ取得のよくある失敗

開発者ドキュメント

Monorepo の構造、核心の起動経路、コントリビューションの注意事項