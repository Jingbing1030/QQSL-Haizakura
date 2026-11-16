# 紹介


Haizakura 者何物、何能為、及其之三種使用形態与発行結構

Haizakura 者 NTQQ（QQ 桌面客端）向之**遠隔協議框架**也。QQ 与 OneBot v11 生態橋渡：native addon 者 ptrace 級注入依、運行中 QQ 工程（Linux 工程名 `qq`、Windows `QQ.exe`）中 hook 打入、其内部資料包解析、更以 OneBot v11 之形、HTTP / WebSocket / 逆方向 WS / HTTP 上報経由暴露也。

此内核之周囲、Haizakura 尚提供：

- OneBot v11 適配器 —— HTTP API 服務、WebSocket 服務、逆方向 WebSocket、HTTP 事件上報、任意組合。

- NTQQ 橋渡 —— 真実 QQ 客端直接対接、協議号無需、独立登録無需。

- 複数帳号 —— 一 UIN 一 OneBot 実例、自動検測、自動接入、手動設定無需。

- 内蔵 WebUI —— 瀏覧器中帳号管理、設定、状態閲覧。

- TypeScript SDK —— `@snowluma/sdk`、類型完備之 OneBot 客端記述。

- MCP 服務 —— `@snowluma/mcp`、MCP 対応之 AI 客端、OneBot action 照会且呼出可能也。

## 三種使用形態

| 汝之目標 | 形態 | 入口 |
|---|---|---|
| 伺服器上長期機械人運行 | Docker（推奨） | Docker 配置 |
| AI 客端依 QQ 呼出 | MCP | MCP 接入 |
| 本機快速試行 | 既編訳 tarball | 配置方式選択 |

客端代碼記述者 TypeScript SDK 参照。

## 発行結構

各平台 GitHub Releases 中二種 tarball 提供：

| 包名 | Node.js 含否 | 適用 |
|---|---|---|
| `Haizakura---.tar.gz`（full） | Node.js 運行時内蔵 | 機上 Node 無、開箱即用 |
| `Haizakura----lite.tar.gz`（lite） | Node.js 不含（包甚小） | 機上 Node.js ≥ 22 既装（Node 24 LTS 推奨） |

既発行平台 / 架構：`linux-x64`、`linux-arm64`、`win-x64`。

Info

Haizakura 者 **Node.js ≥ 22** 必要也。2026 年 **Node 24（"Krypton"）Active LTS** 也、22（"Jod"）既 Maintenance LTS 入、故 lite 包者 **Node 24 LTS** 推奨（22 尚可用）。full 包者運行時同梱、安装無需。出処：nodejs.org。

解包後 `dist/` 概略結構：

```
dist/
├── index.mjs          # 入口：node ./index.mjs
├── launcher.bat       # Windows 起動脚本（node ./index.mjs + pause）
├── webui/             # 内蔵 WebUI 静的資源
└── native/            # native addon + websocket 原生模組
    ├── snowluma-win32-x64.{node,dll}
    ├── snowluma-linux-x64.{node,so}
    ├── snowluma-linux-arm64.{node,so}
    └── websocket--.node
```

運行方式：解包後 `node ./index.mjs` 実行。Windows 者 `launcher.bat` 双撃可也。

## 既定服務

| 服務 | 既定聴取 | 説明 |
|---|---|---|
| OneBot HTTP | `0.0.0.0:3000` | OneBot v11 HTTP API |
| OneBot WS | `0.0.0.0:3001` | OneBot v11 WebSocket |
| WebUI | `0.0.0.0:5099` | 内蔵管理画面 |
| VNC | `5900` | Docker 内部限定：原生遠隔桌面。公式模板対外映射無 |
| noVNC | `6081` | Docker 限定：瀏覧器遠隔桌面、扫码登録 |

端口、聴取地址等設定中変更可能、詳細設定参照。

Warning

noVNC / WebUI / OneBot 端口、**裸**公網暴露不可也。Docker 之遠隔桌面者固定既定密碼**無**、初回起動時随機生成、容器記録中一度仅打印也。

## 項目状態

Warning

Haizakura 尚**初期開発段階**中也、接口、設定結構、発行配置皆版本間変化可能性有。生産環境者具体版本 tag 固定、且升級前 更新説明 閲読必要。

## 次之段階

- 快速開始 —— 何処自始可不知者、先此参照。

- 配置方式選択 —— 全配置経路対比、適合之一条選択。
此文档有用乎？

有用無用最終更新

快速開始

何之配置経路可走、一頁明白、且最常見之 Docker 上手指南
