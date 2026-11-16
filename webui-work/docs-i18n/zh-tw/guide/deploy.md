# 部署方式


部署
Haizakura 各部署方式的對比與選擇

Haizakura 可以在多種環境裡運作，但核心要求都一樣：能跑 QQ、能向 QQ 行程注入 hook、能掃碼登入。不同環境的難度差別很大，下面這張表幫你挑一條合適的路。

不知道選哪條？直接看快速開始的決策表，或者無腦選 **Docker on Linux**。

## 部署方式對比

| 方式 | 平台 | 難度 | 是否推薦 | 適用情境 |
|---|---|---|---|---|
| Docker | Linux | 低 | ✅ 最推薦 | 伺服器長期運作，開箱即用 |
| 一鍵安裝 | Linux | 低 | ⚠️ Alpha 實驗 | 一條指令裝 Docker / sidecar / 本機，仍在測試 |
| Windows 手動 | Windows | 中 | 可選 | Windows 本機，不想裝 Docker |
| Windows · Docker Desktop | Windows | 中 | 可選 | Windows 上想用容器隔離 |
| WSL2 | Windows + WSL | 中 | 可選 | 在 Windows 裡用 Linux 子系統跑容器 |
| Linux 手動 | Linux | 高 | ⚠️ 進階/非官方 | 想理解 Docker 映像內部，或不能用 Docker |
| 手機 | Android | 很高 | ⚠️ 進階/實驗性 | 只有安卓手機，資源吃緊，注入可能受限 |
| 寶塔面板 | Linux | 低 | 社群方案 | 已裝寶塔面板，透過 Docker 應用商店一鍵匯入 |

Tip

**Linux 上 Docker 是最推薦、最省事的方式** —— 映像把 QQ + Xvfb + VNC + noVNC + supervisord 全打包好了，主機只需要 Docker。

Warning

**Linux 手動**和**手機**部署屬於進階 / 非官方路徑：步驟多、坑多、注入在受限環境（如 proot）下可能不可用。除非你清楚自己在做什麼，否則優先走 Docker。

## 升級

升級方式按部署路徑不同而不同，且都以**不丟登入狀態和設定**為前提。統一見更新。

## 部署之後

- 設定參考 —— 配接器、連接埠、access token。

- MCP 接入 / SDK —— 接 AI 用戶端或寫程式碼。

這篇文件有幫助嗎？

有幫助 / 沒幫助 · 最後更新於

快速開始

一頁弄清楚該走哪條部署路徑，並完成最常見的 Docker 上手

Docker 部署

在 Linux 上用官方 Docker 映像執行 Haizakura
