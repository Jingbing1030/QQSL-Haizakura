# Haizakura<picture><img align="right" src="./assets/readme/mascot.png" width="34%" alt="" /></picture>


**讓 QQ 原生會話，連接你的應用程式。**

QQ 用戶端的 TypeScript 互操作執行環境。<br>
OneBot v11 · WebUI · SDK · MCP

<p>
  <a href="https://github.com/Haizakura/Haizakura/releases"><img alt="最新版本" src="https://img.shields.io/github/v/release/Haizakura/Haizakura?label=release&style=flat-square"></a>
  <a href="https://github.com/Haizakura/Haizakura/actions/workflows/dev-build.yml"><img alt="建置狀態" src="https://img.shields.io/github/actions/workflow/status/Haizakura/Haizakura/dev-build.yml?branch=dev&style=flat-square&label=build"></a>
  <a href="https://www.npmjs.com/package/@snowluma/sdk"><img alt="Haizakura SDK 版本" src="https://img.shields.io/npm/v/%40snowluma%2Fsdk?style=flat-square&label=sdk&color=287fb8"></a>
  <a href="https://www.npmjs.com/package/@snowluma/mcp"><img alt="Haizakura MCP 版本" src="https://img.shields.io/npm/v/%40snowluma%2Fmcp?style=flat-square&label=mcp&color=7658c7"></a>
  <a href="https://hub.docker.com/r/motricseven7/snowluma"><img alt="Docker 拉取次數" src="https://img.shields.io/docker/pulls/motricseven7/snowluma?style=flat-square&label=docker%20pulls"></a>
  <a href="https://github.com/Haizakura/Haizakura/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/Haizakura/Haizakura?style=flat-square"></a>
</p>

將 QQ 原生會話轉換為 [OneBot v11](https://github.com/botuniverse/onebot-11) 動作與事件，並透過 WebSocket、HTTP、WebUI、SDK 與 MCP 提供統一入口。

多帳號會話、訊息與媒體、連線設定與即時日誌，都在同一個執行環境中管理。

**[下載發行版](https://github.com/Haizakura/Haizakura/releases)** · **[快速開始](#快速開始)**<br>
[部署指南](guide/deploy.md) · [動作參考](protocol/actions.md) · [問題回報](https://github.com/Haizakura/Haizakura/issues)

<sub>Windows x64 · Linux x64 / arm64</sub>

<br clear="both" />

> [!CAUTION]
> Haizakura 是獨立的第三方專案，與騰訊 / QQ 並無隸屬或授權關係。專案僅供學習與技術研究，請遵守《QQ 使用者條款》及適用法律；軟體按「現狀」提供，使用風險自負。

> **Disclaimer:** Haizakura is independent of Tencent / QQ and is provided for study and research only, “as is” and without warranty.

## 核心能力

| 場景 | 能力 |
| --- | --- |
| OneBot 接入 | OneBot v11 動作與事件；WebSocket 伺服器端 / 用戶端及 HTTP 伺服器端 / 上報 |
| 訊息與媒體 | 文字、圖片、語音、影片、檔案、回覆、提及、轉發及常見卡片 |
| 多帳號運作 | 各帳號獨立維護會話、身分對應、訊息儲存與網路設定 |
| WebUI 管理 | 帳號狀態、即時日誌、連線設定、動作偵錯與儲存管理 |
| 開發者工具 | [`@snowluma/sdk`](dev/sdk.md) 與 [`@snowluma/mcp`](dev/mcp.md) |

## 運作鏈路

<p align="center">
  <img src="./assets/readme/runtime-map.svg" width="100%" alt="QQ 會話經過協定橋接與 OneBot 標準化後連接到 WebSocket、HTTP、WebUI、SDK 和 MCP" />
</p>

會話接入、協定解析、身分對應、OneBot 轉換與網路配接保持獨立邊界；多個 QQ 帳號可平行運作。

## 快速開始

1. 從 [Releases](https://github.com/Haizakura/Haizakura/releases) 下載對應平台的完整發行包並解壓縮。Lite 版需 Node.js 24+。
2. Windows 執行 `launcher.bat`；Linux 執行：

   ```bash
   chmod +x launcher.sh
   ./launcher.sh
   ```

3. 開啟 [`http://localhost:5099`](http://localhost:5099)，使用啟動日誌中的初始密碼登入 WebUI，依引導接入 QQ 行程並設定 OneBot 連線。

帳號辨識由登入資料庫的檔案變化、行程與登入事件或手動操作觸發，不做週期性探測。未載入的 QQ 行程也不會持續呼叫 Windows Restart Manager；需要重查時可點擊 WebUI 行程列的重新整理/重新連線。

## 接入與文件

| 入口 | 文件 |
| --- | --- |
| WebSocket / HTTP | [OneBot 動作參考](protocol/actions.md) |
| 部署（Docker / Windows） | [部署指南](guide/deploy.md) |
| TypeScript SDK | [`dev/sdk.md`](dev/sdk.md) |
| MCP | [`dev/mcp.md`](dev/mcp.md) |

JSON 訊息段接受標準的 `data.data` 字串，也相容 `data.data` 非陣列物件與 `{ type: "json", data: "..." }` 簡寫；`data` 必填，最終內容必須是 JSON 物件。

## 開發

需要 Node.js 24+ 與 pnpm 11.25.0，日常開發基於 `dev` 分支：

```bash
git clone https://github.com/Haizakura/Haizakura.git
cd Haizakura
git checkout dev
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

貢獻流程見 [`CONTRIBUTING.md`](CONTRIBUTING.md)；開發方向見 [`RoadMap.md`](RoadMap.md)。

## 社群與致謝

- [提交問題](https://github.com/Haizakura/Haizakura/issues)
- [QQ 群](https://qm.qq.com/q/g3UMLpWALe)
- [Telegram](https://t.me/napcatqq)

專案參考了 [LagrangeV2](https://github.com/LagrangeDev/LagrangeV2) 的協定定義與 [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 的實作思路。

<p align="center">
  <a href="https://github.com/Haizakura/Haizakura/graphs/contributors"><img src="https://contrib.rocks/image?repo=Haizakura/Haizakura" alt="Haizakura 貢獻者" /></a>
</p>
