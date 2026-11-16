# 快速開始


何之配置経路可走、一頁明白、且最常見之 Docker 上手指南

第一歩者装物非也、**何之路可走決定**也。Haizakura 之核心者 hook 真実 QQ 工程注入也、故 QQ + 注入 + 扫码登録可能之環境必要也。下之表者、汝之手元環境依推奨経路直示、其儘辿可也。

## 何之路可走

| 汝之状況 | 推奨経路 | 鏈接 |
|---|---|---|
| Linux 伺服器有 | Docker（最推奨、最省事） | Docker 配置 |
| Windows 本機 | Windows 手動 / Docker Desktop | Windows 配置 |
| WSL2 使用希望 | WSL2 中容器運行 | WSL2 配置 |
| Android 手機限定 | Termux + proot（上級 / 実験的） | 手機配置 |
| 宝塔面板既装之 Linux 伺服器 | 面板 Docker 応用商店一鍵導入 | 宝塔面板配置 |
| AI 客端接続希望 | MCP 服務 | MCP 接入 |
| 客端代碼記述希望 | TypeScript SDK | SDK |

不確者 **Docker on Linux** 選択可也。公式推奨、最易起動之方式也。完全対比者配置方式選択参照。

## 最速上手（Docker）

Linux 上公式推奨者、公式鏡像自己起動也。三步：

**1. 容器起動**

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

`--cap-add=SYS_PTRACE` 与 `--security-opt seccomp=unconfined` **省略不可**：既定 seccomp 者注入遮断、QQ（Chromium）者 `--shm-size=1g` 亦必要也。遠隔桌面密碼者初回起動時随機生成、記録中一度仅打印。

**2. 扫码登録**

瀏覧器 `http://:6081/`（noVNC）開。密碼：

```
docker logs snowluma 2>&1 | grep -E "远程桌面密码:|remote desktop password:" | tail -n 1
```

遠隔桌面中 QQ 既自動起動、手機 QQ 依扫码。

**3. WebUI 開**

瀏覧器 `http://:5099/` 開。完全 Compose、複数帳号者 Docker 配置参照。

## 実験的：一鍵安装脚本（Alpha）

Warning

**首推非也。** Alpha 測試中、命令与既定挙動皆変化可能性有。Docker 可能者前節優先。進而検証協力願意者、以下試行可也：

```
curl -fsSL https://raw.githubusercontent.com/Haizakura/Haizakura.Docker.Framework/main/install.sh | bash
```

```
curl -fsSL https://raw.githubusercontent.com/Haizakura/Haizakura.Docker.Framework/main/install.sh | bash -s -- --mode docker --yes
```

対話形式模式尋問。`--yes` 且 `--mode` 不記時既定 docker。詳細、sidecar、本機模式者 一鍵安装（実験的）参照。

## 登録与初回訪問

何之経路也、初回上手時以下之事避不可：

- 扫码登録：Haizakura 者扫码登録対応仅、CLI 登録無。無頭環境中者 VNC / noVNC 経由 QQ 窓可見状態必須、然後扫码可能也。

- WebUI 臨時密碼探索：全新資料目録初回起動時、記録中一度性管理者密碼打印。Docker：

```
docker logs snowluma 2>&1 | grep -E "临时密码|initial credentials" | tail -n 1
```

Info臨時密碼者全新資料目録初回起動時一度仅輸出、再起動或旧資料再利用者再生成無也。

- 端口開放：外部自訪問者、WebUI（`5099`）及使用之 OneBot 端口（`3000` / `3001`）放行必要。

Warning

noVNC / WebUI / OneBot 端口、**裸**公網暴露不可也。遠隔桌面者固定既定密碼無、容器記録参照可也。

## 免密登録（URL token）

毎回密碼手入力者煩也。WebUI 者地址中**登録密碼**携帯直接入場対応：

```
http://:5099/?token=
```

- 参數名者 `token`、値者平常 WebUI 登録之密碼也。Haizakura 者之依登録接口経由、密碼正確者直達主頁。

- 用後即清：密碼読取後直地址欄自除去（`history.replaceState`）、瀏覧器歴史 / 訪問記録 / Referer 頭経由漏洩回避也。

- 伺服器側通常検証、密碼誤者登録頁退回而已、回避不存在也。

Warning

密碼 URL 中出現者**危険较高**（瀏覧器歴史入、中間機器 / 代理記録可能性有）。可信之本地 / 内網環境仅使用推奨。密碼付鏈接共享不可、聊天 / issue 貼付不可、公共設備使用不可。

## 次之段階

- 配置方式選択 —— 各経路詳細対比。

- 設定参照 —— 端口、access token、適配器変更。

- 更新 —— 登録状態不失而升級。
此文档有用乎？

有用無用最終更新

紹介

Haizakura 者何物、何能為、及其之三種使用形態与発行結構

配置

Haizakura 各配置方式之対比与選択
