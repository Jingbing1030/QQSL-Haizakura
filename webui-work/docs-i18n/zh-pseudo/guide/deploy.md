# 配置方式


配置
Haizakura 各配置方式之対比与選択

Haizakura 者多様環境中運行可能也、但核心要求皆同一：QQ 運行可能、QQ 工程中 hook 注入可能、扫码登録可能。環境毎難度差甚大、下表汝之適合之道選択助也。

何選択可不知者、直接 快速開始 之判断表参照、或無考 **Docker on Linux** 選択可也。

## 配置方式対比

| 方式 | 平台 | 難度 | 推奨 | 適場面 |
|---|---|---|---|---|
| Docker | Linux | 低 | ✅ 最推奨 | 伺服器長期運行、開箱即用 |
| 一鍵安装 | Linux | 低 | ⚠️ Alpha 実験 | 一命令 Docker / sidecar / 本機安装、尚測試中 |
| Windows 手動 | Windows | 中 | 任意 | Windows 本機、Docker 安装不望 |
| Windows · Docker Desktop | Windows | 中 | 任意 | Windows 上容器分離使用希望 |
| WSL2 | Windows + WSL | 中 | 任意 | Windows 中 Linux 子系統依容器運行 |
| Linux 手動 | Linux | 高 | ⚠️ 上級 / 非公式 | Docker 鏡像内部理解希望、或 Docker 使用不可 |
| 手機 | Android | 甚高 | ⚠️ 上級 / 実験的 | Android 手機限定、資源厳、注入制限可能性有 |
| 宝塔面板 | Linux | 低 | 社区方案 | 宝塔面板既装、Docker 応用商店経由一鍵導入 |

Tip

**Linux 上 Docker 者最推奨、最省事之方式也** —— 鏡像中 QQ + Xvfb + VNC + noVNC + supervisord 全部同梱済、宿主機者 Docker 仅必要也。

Warning

**Linux 手動**与**手機**配置者上級 / 非公式経路也：步驟多、坑多、制限環境（proot 等）中注入不可用可能性有。自何為明確不知者、Docker 優先也。

## 升級

升級方式者配置経路毎異也、且皆**登録状態与設定不失**前提也。統一 更新 参照。

## 配置之後

- 設定参照 —— 適配器、端口、access token。

- MCP 接入 / SDK —— AI 客端接続、或代碼記述。
此文档有用乎？

有用無用最終更新

快速開始

何之配置経路可走、一頁明白、且最常見之 Docker 上手指南

Docker 配置

Linux 上公式 Docker 鏡像依 Haizakura 運行