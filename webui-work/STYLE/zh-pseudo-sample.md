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
