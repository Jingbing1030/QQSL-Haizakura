# Haizakura<picture><img align="right" src="./assets/readme/mascot.png" width="34%" alt="" /></picture>


**QQ 原生会話、汝之応用与接続。**

QQ 客端向之 TypeScript 相互運用運行時也。<br>
OneBot v11 · WebUI · SDK · MCP

<p>
  <a href="https://github.com/Haizakura/Haizakura/releases"><img alt="最新版本" src="https://img.shields.io/github/v/release/Haizakura/Haizakura?label=release&style=flat-square"></a>
  <a href="https://github.com/Haizakura/Haizakura/actions/workflows/dev-build.yml"><img alt="建構状態" src="https://img.shields.io/github/actions/workflow/status/Haizakura/Haizakura/dev-build.yml?branch=dev&style=flat-square&label=build"></a>
  <a href="https://www.npmjs.com/package/@snowluma/sdk"><img alt="Haizakura SDK 版本" src="https://img.shields.io/npm/v/%40snowluma%2Fsdk?style=flat-square&label=sdk&color=287fb8"></a>
  <a href="https://www.npmjs.com/package/@snowluma/mcp"><img alt="Haizakura MCP 版本" src="https://img.shields.io/npm/v/%40snowluma%2Fmcp?style=flat-square&label=mcp&color=7658c7"></a>
  <a href="https://hub.docker.com/r/motricseven7/snowluma"><img alt="Docker 取得回数" src="https://img.shields.io/docker/pulls/motricseven7/snowluma?style=flat-square&label=docker%20pulls"></a>
  <a href="https://github.com/Haizakura/Haizakura/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/Haizakura/Haizakura?style=flat-square"></a>
</p>

QQ 原生会話、[OneBot v11](https://github.com/botuniverse/onebot-11) 之動作与事件変換、WebSocket、HTTP、WebUI、SDK、MCP 経由統一入口提供也。

複数帳号之会話、消息与媒体、接続設定、実時記録、一運行時中管理可能也。

**[発行版下載](https://github.com/Haizakura/Haizakura/releases)** · **[快速開始](#快速開始)**<br>
[配置指南](guide/deploy.md) · [動作参照](protocol/actions.md) · [問題報告](https://github.com/Haizakura/Haizakura/issues)

<sub>Windows x64 · Linux x64 / arm64</sub>

<br clear="both" />

> [!CAUTION]
> Haizakura 者独立之第三種項目也、与騰訊 / QQ 無隷属無授権関係。本項目学習与技術研究専用、『QQ 利用協議』及適用法遵守必要也。軟件「現状」提供、使用危険自負。

> **免責事項:** Haizakura is independent of Tencent / QQ and is provided for study and research only, “as is” and without warranty.

## 核心能力

| 場面 | 能力 |
| --- | --- |
| OneBot 接入 | OneBot v11 之動作与事件。WebSocket 伺服器 / 客端及 HTTP 伺服器 / 上報 |
| 消息与媒体 | 文本、図像、音声、動画、文件、返信、提及、転送及常見卡片 |
| 複数帳号運行 | 帳号毎会話、身分対応、消息保存、網設定独立管理 |
| WebUI 管理 | 帳号状態、実時記録、接続設定、動作除錯、保存管理 |
| 開発者工具 | [`@snowluma/sdk`](dev/sdk.md) 与 [`@snowluma/mcp`](dev/mcp.md) |

## 運行経路

<p align="center">
  <img src="./assets/readme/runtime-map.svg" width="100%" alt="QQ 会話、協議橋渡与 OneBot 標準化経由、WebSocket、HTTP、WebUI、SDK、MCP 接続" />
</p>

会話接入、協議解析、身分対応、OneBot 変換、網適応各自独立境界保持。複数 QQ 帳号並行運行可能也。

## 快速開始

1. [Releases](https://github.com/Haizakura/Haizakura/releases) 自各平台完全発行包下載解凍。Lite 版者 Node.js 24+ 必要也。
2. Windows 者 `launcher.bat` 実行。Linux 者以下実行：

   ```bash
   chmod +x launcher.sh
   ./launcher.sh
   ```

3. [`http://localhost:5099`](http://localhost:5099) 開、起動記録中之初期密碼依 WebUI 登録、案内従 QQ 工程接入且 OneBot 接続設定。

帳号識別者、登録資料庫之文件変化、工程与登録事件、或手動操作依触発、周期探測非行也。未載入 QQ 工程者 Windows Restart Manager 継続呼出無。再調査必要時、WebUI 工程行之更新 / 再接続押下可能。

## 接入与文書

| 入口 | 文書 |
| --- | --- |
| WebSocket / HTTP | [OneBot 動作参照](protocol/actions.md) |
| 配置（Docker / Windows） | [配置指南](guide/deploy.md) |
| TypeScript SDK | [`dev/sdk.md`](dev/sdk.md) |
| MCP | [`dev/mcp.md`](dev/mcp.md) |

JSON 消息段者標準 `data.data` 文字列受、`data.data` 非配列対象及 `{ type: "json", data: "..." }` 簡略形兼容也。`data` 必須、最終内容 JSON 対象必須。

## 開発

Node.js 24+ 与 pnpm 11.25.0 必要。日常開発者 `dev` 分支基盤也。

```bash
git clone https://github.com/Haizakura/Haizakura.git
cd Haizakura
git checkout dev
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

貢献流程者 [`CONTRIBUTING.md`](CONTRIBUTING.md) 参照、開発方向者 [`RoadMap.md`](RoadMap.md) 参照。

## 社区与鳴謝

- [問題提出](https://github.com/Haizakura/Haizakura/issues)
- [QQ 群](https://qm.qq.com/q/g3UMLpWALe)
- [Telegram](https://t.me/napcatqq)

本項目、[LagrangeV2](https://github.com/LagrangeDev/LagrangeV2) 之協議定義与 [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 之実装思路参考。

<p align="center">
  <a href="https://github.com/Haizakura/Haizakura/graphs/contributors"><img src="https://contrib.rocks/image?repo=Haizakura/Haizakura" alt="Haizakura 貢献者" /></a>
</p>
