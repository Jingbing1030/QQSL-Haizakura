# 介紹


Haizakura 是什麼、能做什麼，以及它的三種使用形態與發行結構

Haizakura 是一個面向 NTQQ（QQ 桌面用戶端）的**遠端協定框架**。它把 QQ 橋接到 OneBot v11 生態：一個 native addon 透過 ptrace 級注入把 hook 打進正在執行的 QQ 行程（Linux 行程名 `qq`，Windows `QQ.exe`），解析它的內部封包，再以 OneBot v11 的形式透過 HTTP / WebSocket / 反向 WS / HTTP 上報曝露出來。

圍繞這個核心，Haizakura 還提供：

- OneBot v11 配接器 —— HTTP API 服務、WebSocket 服務、反向 WebSocket、HTTP 事件上報，任意組合。

- NTQQ 橋接 —— 直接對接真實 QQ 用戶端，無需協定號、無需獨立登入。

- 多帳號 —— 一個 UIN 一個 OneBot 實例，自動偵測、自動接入，無需手動設定。

- 內建 WebUI —— 在瀏覽器裡管理帳號、設定、檢視狀態。

- TypeScript SDK —— `@snowluma/sdk`，寫型別完備的 OneBot 用戶端。

- MCP 服務 —— `@snowluma/mcp`，讓支援 MCP 的 AI 用戶端查詢並呼叫 OneBot action。

## 三種使用形態

| 你的目標 | 形態 | 入口 |
|---|---|---|
| 在伺服器上長期跑機器人 | Docker（推薦） | Docker 部署 |
| 讓 AI 用戶端呼叫 QQ | MCP | MCP 接入 |
| 在本機快速試一試 | 預編譯 tarball | 選擇部署方式 |

寫用戶端程式碼請看 TypeScript SDK。

## 發行結構

每個平台在 GitHub Releases 提供兩種 tarball：

| 套件名 | 是否含 Node.js | 適用 |
|---|---|---|
| `Haizakura---.tar.gz`（full） | 內建 Node.js 執行環境 | 機器上沒有 Node，開箱即用 |
| `Haizakura----lite.tar.gz`（lite） | 不含 Node.js（套件小很多） | 機器已裝 Node.js ≥ 22（推薦 Node 24 LTS） |

已發布的平台 / 架構：`linux-x64`、`linux-arm64`、`win-x64`。

Info

Haizakura 需要 **Node.js ≥ 22**。2026 年 **Node 24（"Krypton"）是 Active LTS**，22（"Jod"）已進入 Maintenance LTS，因此 lite 套件推薦安裝 **Node 24 LTS**（22 仍可用）。full 套件自帶執行環境，無需安裝。來源：nodejs.org。

解包後的 `dist/` 大致結構：

```
dist/
├── index.mjs          # 進入點：node ./index.mjs
├── launcher.bat       # Windows 啟動指令碼（node ./index.mjs + pause）
├── webui/             # 內建 WebUI 靜態資源
└── native/            # native addon + websocket 原生模組
    ├── snowluma-win32-x64.{node,dll}
    ├── snowluma-linux-x64.{node,so}
    ├── snowluma-linux-arm64.{node,so}
    └── websocket--.node
```

執行方式：解包後執行 `node ./index.mjs`；Windows 上也可以雙擊 `launcher.bat`。

## 預設服務

| 服務 | 預設監聽 | 說明 |
|---|---|---|
| OneBot HTTP | `0.0.0.0:3000` | OneBot v11 HTTP API |
| OneBot WS | `0.0.0.0:3001` | OneBot v11 WebSocket |
| WebUI | `0.0.0.0:5099` | 內建管理介面 |
| VNC | `5900` | 僅 Docker 內部：原生遠端桌面。官方範本不對外對應連接埠 |
| noVNC | `6081` | 僅 Docker：瀏覽器遠端桌面，掃碼登入 |

連接埠、監聽位址等可在設定裡改，詳見設定參考。

Warning

**不要**把 noVNC / WebUI / OneBot 連接埠裸暴露在公網。Docker 的遠端桌面**沒有**固定預設密碼，第一次啟動會隨機產生，只在容器日誌裡列印一次。

## 專案狀態

Warning

Haizakura 仍處於**早期開發階段**，介面、設定結構與發行佈局都可能在版本之間變化。生產環境請固定具體版本 tag，並在升級前閱讀更新說明。

## 下一步

- 快速開始 —— 不知道從哪開始？先看這裡。

- 選擇部署方式 —— 對比所有部署路徑，挑一條適合你的。

這篇文件有幫助嗎？

有幫助 / 沒幫助 · 最後更新於

快速開始

一頁弄清楚該走哪條部署路徑，並完成最常見的 Docker 上手
