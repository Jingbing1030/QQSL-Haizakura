# Haizakura<picture><img align="right" src="./assets/readme/mascot.png" width="34%" alt="" /></picture>


**QQ ネイティブセッションを、あなたのアプリケーションへ。**

QQ クライアント向けの TypeScript 相互運用ランタイム。<br>
OneBot v11 · WebUI · SDK · MCP

<p>
  <a href="https://github.com/Haizakura/Haizakura/releases"><img alt="最新バージョン" src="https://img.shields.io/github/v/release/Haizakura/Haizakura?label=release&style=flat-square"></a>
  <a href="https://github.com/Haizakura/Haizakura/actions/workflows/dev-build.yml"><img alt="ビルド状況" src="https://img.shields.io/github/actions/workflow/status/Haizakura/Haizakura/dev-build.yml?branch=dev&style=flat-square&label=build"></a>
  <a href="https://www.npmjs.com/package/@snowluma/sdk"><img alt="Haizakura SDK バージョン" src="https://img.shields.io/npm/v/%40snowluma%2Fsdk?style=flat-square&label=sdk&color=287fb8"></a>
  <a href="https://www.npmjs.com/package/@snowluma/mcp"><img alt="Haizakura MCP バージョン" src="https://img.shields.io/npm/v/%40snowluma%2Fmcp?style=flat-square&label=mcp&color=7658c7"></a>
  <a href="https://hub.docker.com/r/motricseven7/snowluma"><img alt="Docker プル数" src="https://img.shields.io/docker/pulls/motricseven7/snowluma?style=flat-square&label=docker%20pulls"></a>
  <a href="https://github.com/Haizakura/Haizakura/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/Haizakura/Haizakura?style=flat-square"></a>
</p>

QQ ネイティブセッションを [OneBot v11](https://github.com/botuniverse/onebot-11) のアクションとイベントに変換し、WebSocket、HTTP、WebUI、SDK、MCP を通じて統一された入口を提供します。

複数アカウントのセッション、メッセージとメディア、接続設定、リアルタイムログを、ひとつのランタイムで管理できます。

**[リリースをダウンロード](https://github.com/Haizakura/Haizakura/releases)** · **[クイックスタート](#クイックスタート)**<br>
[デプロイガイド](guide/deploy.md) · [アクションリファレンス](protocol/actions.md) · [問題報告](https://github.com/Haizakura/Haizakura/issues)

<sub>Windows x64 · Linux x64 / arm64</sub>

<br clear="both" />

> [!CAUTION]
> Haizakura は独立したサードパーティプロジェクトであり、テンセント / QQ との提携や許諾関係はありません。本プロジェクトは学習および技術研究のみを目的としており、「QQ ユーザー契約」および適用法を遵守してください。ソフトウェアは「現状のまま」提供され、利用は自己責任となります。

> **免責事項:** Haizakura is independent of Tencent / QQ and is provided for study and research only, “as is” and without warranty.

## 主な機能

| 用途 | 機能 |
| --- | --- |
| OneBot 接続 | OneBot v11 のアクションとイベント。WebSocket サーバー / クライアント、HTTP サーバー / レポート |
| メッセージとメディア | テキスト、画像、音声、動画、ファイル、返信、メンション、転送、および一般的なカード |
| 複数アカウント運用 | アカウントごとにセッション、識別マッピング、メッセージ保存、ネットワーク設定を独立して管理 |
| WebUI 管理 | アカウント状態、リアルタイムログ、接続設定、アクションデバッグ、ストレージ管理 |
| 開発者ツール | [`@snowluma/sdk`](dev/sdk.md) と [`@snowluma/mcp`](dev/mcp.md) |

## 実行経路

<p align="center">
  <img src="./assets/readme/runtime-map.svg" width="100%" alt="QQ セッションはプロトコルブリッジと OneBot 標準化を経て WebSocket、HTTP、WebUI、SDK、MCP に接続される" />
</p>

セッション接続、プロトコル解析、識別マッピング、OneBot 変換、ネットワーク適応はそれぞれ独立した境界を保ちます。複数の QQ アカウントを並行して実行できます。

## クイックスタート

1. [Releases](https://github.com/Haizakura/Haizakura/releases) から対象プラットフォームの完全な配布パッケージをダウンロードして展開します。Lite 版には Node.js 24+ が必要です。
2. Windows では `launcher.bat` を実行します。Linux では次のとおりです。

   ```bash
   chmod +x launcher.sh
   ./launcher.sh
   ```

3. [`http://localhost:5099`](http://localhost:5099) を開き、起動ログに表示された初期パスワードで WebUI にログインし、ガイドに従って QQ プロセスを接続して OneBot 接続を設定します。

アカウントの識別は、ログインデータベースのファイル変更、プロセスとログインのイベント、または手動操作によってトリガーされ、周期的な検出は行いません。未ロードの QQ プロセスに対して Windows Restart Manager を継続的に呼び出すこともありません。再検出が必要な場合は、WebUI のプロセス行にある更新 / 再接続をクリックしてください。

## 接続とドキュメント

| 入口 | ドキュメント |
| --- | --- |
| WebSocket / HTTP | [OneBot アクションリファレンス](protocol/actions.md) |
| デプロイ（Docker / Windows） | [デプロイガイド](guide/deploy.md) |
| TypeScript SDK | [`dev/sdk.md`](dev/sdk.md) |
| MCP | [`dev/mcp.md`](dev/mcp.md) |

JSON メッセージセグメントは標準的な `data.data` 文字列を受け付け、`data.data` が配列以外のオブジェクトである形式や `{ type: "json", data: "..." }` という省略形にも対応します。`data` は必須で、最終的な内容は JSON オブジェクトでなければなりません。

## 開発

Node.js 24+ と pnpm 11.25.0 が必要です。日常的な開発は `dev` ブランチを基盤とします。

```bash
git clone https://github.com/Haizakura/Haizakura.git
cd Haizakura
git checkout dev
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

コントリビューションの流れは [`CONTRIBUTING.md`](CONTRIBUTING.md) を、開発の方向性は [`RoadMap.md`](RoadMap.md) を参照してください。

## コミュニティと謝辞

- [問題を報告](https://github.com/Haizakura/Haizakura/issues)
- [QQ グループ](https://qm.qq.com/q/g3UMLpWALe)
- [Telegram](https://t.me/napcatqq)

本プロジェクトは [LagrangeV2](https://github.com/LagrangeDev/LagrangeV2) のプロトコル定義と [NapCatQQ](https://github.com/NapNeko/NapCatQQ) の実装方針を参考にしています。

<p align="center">
  <a href="https://github.com/Haizakura/Haizakura/graphs/contributors"><img src="https://contrib.rocks/image?repo=Haizakura/Haizakura" alt="Haizakura コントリビューター" /></a>
</p>
