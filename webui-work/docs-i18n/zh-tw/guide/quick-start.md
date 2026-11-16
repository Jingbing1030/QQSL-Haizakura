# 快速開始


一頁弄清楚該走哪條部署路徑，並完成最常見的 Docker 上手

第一步不是裝東西，而是**決定走哪條路**。Haizakura 的核心是把 hook 注入真實 QQ 行程，因此你需要一個能跑 QQ + 注入 + 掃碼登入的環境。下面這張表按你手上的環境直接給出推薦路徑，照著點進去即可。

## 我該走哪條路？

| 你的情況 | 推薦路徑 | 連結 |
|---|---|---|
| 有一台 Linux 伺服器 | Docker（最推薦、最省事） | Docker 部署 |
| Windows 本機 | Windows 手動 / Docker Desktop | Windows 部署 |
| 想用 WSL2 | 在 WSL2 裡跑容器 | WSL2 部署 |
| 只有安卓手機 | Termux + proot（進階/實驗性） | 手機部署 |
| 已安裝寶塔面板的 Linux 伺服器 | 面板 Docker 應用商店一鍵匯入 | 寶塔面板部署 |
| 想接 AI 用戶端 | MCP 服務 | MCP 接入 |
| 想寫用戶端程式碼 | TypeScript SDK | SDK |

拿不準就選 **Docker on Linux**，這是官方推薦、最容易跑起來的方式。完整對比見選擇部署方式。

## 最快上手（Docker）

Linux 上官方推薦是自己起官方映像。三步：

**1. 拉起容器**

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

`--cap-add=SYS_PTRACE` 和 `--security-opt seccomp=unconfined` **不能省**：預設 seccomp 會攔住注入，QQ（Chromium）也需要 `--shm-size=1g`。遠端桌面密碼首次啟動會隨機產生，只在日誌裡打一次。

**2. 掃碼登入**

瀏覽器開啟 `http://:6081/`（noVNC）。密碼：

```
docker logs snowluma 2>&1 | grep -E "远程桌面密码:|remote desktop password:" | tail -n 1
```

遠端桌面裡 QQ 已自動啟動，用手機 QQ 掃碼。

**3. 開啟 WebUI**

瀏覽器開啟 `http://:5099/`。完整 Compose、多帳號見 Docker 部署。

## 實驗性：一鍵安裝指令碼（Alpha）

Warning

**不是首推。** 正在 Alpha 測試，指令和預設行為都可能變。能跑 Docker 的請優先使用上一節。願意幫忙踩坑的，可以試：

```
curl -fsSL https://raw.githubusercontent.com/Haizakura/Haizakura.Docker.Framework/main/install.sh | bash
```

```
curl -fsSL https://raw.githubusercontent.com/Haizakura/Haizakura.Docker.Framework/main/install.sh | bash -s -- --mode docker --yes
```

互動會問模式；`--yes` 且不寫 `--mode` 時預設 docker。細節、sidecar、本機模式見一鍵安裝（實驗性）。

## 登入與首次存取

無論哪條路徑，首次上手都繞不開這幾件事：

- 掃碼登入：Haizakura 只支援掃碼登入，沒有 CLI 登入。在無頭環境裡必須透過 VNC / noVNC 看到 QQ 視窗才能掃碼。

- 找 WebUI 臨時密碼：首次用全新資料目錄啟動時，日誌裡會列印一次性管理員密碼。Docker：

```
docker logs snowluma 2>&1 | grep -E "临时密码|initial credentials" | tail -n 1
```

Info臨時密碼只在全新資料目錄首次啟動時輸出一次，重啟或沿用舊資料不會重新產生。

- 開放連接埠：要從外部存取，放行 WebUI（`5099`）和你用到的 OneBot 連接埠（`3000` / `3001`）。

Warning

**不要**把 noVNC / WebUI / OneBot 連接埠裸暴露在公網。遠端桌面沒有固定預設密碼，看容器日誌即可。

## 免密登入（URL token）

每次手輸密碼很煩？WebUI 支援在位址裡帶上**登入密碼**直接進入：

```
http://:5099/?token=
```

- 參數名是 `token`，值就是你平時登入 WebUI 的密碼。Haizakura 會用它走登入介面，密碼正確即直達首頁。

- 用後即清：密碼讀取後會立即從網址列移除（`history.replaceState`），避免經瀏覽器歷史 / 存取日誌 / Referer 標頭洩漏。

- 伺服器端照常驗證，密碼錯誤只會退回登入頁，不存在繞過。

Warning

密碼出現在 URL 裡**風險較高**（會進瀏覽器歷史、可能被中介裝置 / 代理記錄）。僅建議在可信的本機 / 內網環境使用；不要分享帶密碼的連結、不要貼進聊天 / issue、不要在公共設備上使用。

## 接下來

- 選擇部署方式 —— 各路徑詳細對比。

- 設定參考 —— 改連接埠、access token、配接器。

- 更新 —— 升級而不丟登入狀態。

這篇文件有幫助嗎？

有幫助 / 沒幫助 · 最後更新於

介紹

Haizakura 是什麼、能做什麼，以及它的三種使用形態與發行結構

部署

Haizakura 各部署方式的對比與選擇
