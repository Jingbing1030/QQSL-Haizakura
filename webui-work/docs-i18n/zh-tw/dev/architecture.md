# 開發者文件


Monorepo 結構、核心啟動鏈路與貢獻注意事項

Haizakura 是 TypeScript + 原生模組混合專案。TypeScript 負責執行環境編排、OneBot 實作、協定橋接、SDK 與 WebUI；原生模組負責 Hook、注入與高效能 WebSocket 能力。

## Monorepo 結構

pnpm workspace，5 個套件：

```
Haizakura/
├─ packages/
│  ├─ core/        @snowluma/core       核心：Bridge / OneBot / Hook
│  ├─ websocket/   @snowluma/websocket  本仓内置 WS 实现（依赖原生 addon）
│  ├─ sdk/         @snowluma/sdk        外部消费者用的 TS OneBot 客户端
│  ├─ webui/       webui                React + Vite 控制台
│  └─ runtime/     运行时发行模板（启动脚本 / launcher / package.json）
├─ native/         平台原生产物（.node / .dll / .so）
├─ dist/           构建输出
├─ tools/          辅助脚本（version bump、release 等）
├─ docs/           ADR 等开发文档
└─ package.json
```

## 核心啟動鏈路

進入點在 `packages/core/src/index.ts`：

```
loadRuntimeConfig()           ← 读 config/runtime.json / env
  ↓
HookManager(autoLoadOnDiscovery)
  ↓
BridgeManager
  ↓
OneBotManager                 ← 按 UIN 拉起 OneBotInstance
  ↓
initWebUI(port=webuiPort)     ← 仅完整构建启用
```

啟動時建立：

- `HookManager` —— 發現 QQ 主行程並注入 native addon；`hookAutoLoad: true` 時每發現一個新 PID 自動注入。

- `BridgeManager` —— 把具名管道裡的 Hook 訊息解碼成橋接事件；快取 rkey / 聯絡人 / 群成員。

- `OneBotManager` —— 按 UIN 建立 `OneBotInstance`；持有 `MessageStore` / `MediaStore` / `NetworkManager`。

- `initWebUI` —— 在完整建置中啟動 WebUI，連接埠預設 `5099`（`runtime.json.webuiPort` 可改）。

## Hook 與原生模組

Hook 原生模組透過 `process.dlopen()` 載入。原始碼在 `dev/nnphook` 這個獨立儲存庫。

平台命名慣例：

```
snowluma-win32-x64.node    snowluma-win32-x64.dll
snowluma-linux-x64.node    snowluma-linux-x64.so
snowluma-linux-arm64.node  snowluma-linux-arm64.so
```

載入搜尋路徑：

```
native/
dist/native/
packages/runtime/native/
```

原生 addon 曝露：

- `getAllMainProcess` —— 列舉 QQ 主行程。

- `loadModuleManual` —— 向目標行程手動映射注入模組。

- `unloadModuleManual` —— 卸載已注入模組。

Windows 預設目標行程名 `QQ.exe`；Linux 是 `qq`。

## OneBot 生命週期

橋接層偵測到 QQ 會話啟動時：

- 載入 `config/onebot_.json`（缺則從全域複製）。

- 建構 `OneBotInstance`。

- 起 HTTP / WS / 反向 WS / HTTP POST 配接器（按 `networks.*` 設定）。

- 非同步預熱好友清單、群清單、群成員清單。

- 橋接事件 → OneBot 事件轉發。

會話關閉時對應實例釋放。

## WebSocket 套件

`@snowluma/websocket` 是專案自帶的 WebSocket 實作，介面盡量貼近 `ws`，但帶原生加速。

匯出：

- `WebSocket` —— 用戶端建構器。

- `WebSocketServer` —— 伺服器端建構器。

- `Server` —— `WebSocketServer` 別名。

- `InternalWebSocket` —— 內部連線實作。

相依平台原生 `.node`，同樣從 `native/` 搜尋路徑載入。

## SDK 套件

`@snowluma/sdk` 是面向第三方的型別完備 OneBot 用戶端，可獨立發布到 npm、不依賴 Haizakura 執行環境。它在 monorepo 裡建置（見下方 `pnpm build:sdk` / `build:all`），消費端用法見 SDK 文件。

## 開發指令

```
pnpm install
pnpm dev              # core 开发模式
pnpm dev:web          # WebUI 开发服务器
pnpm build            # 仅 core
pnpm build:webui      # 仅 WebUI
pnpm build:sdk        # 仅 SDK
pnpm build:all        # core + SDK + WebUI
pnpm test             # core 测试
pnpm typecheck        # 全仓类型检查
pnpm lint             # 全仓 lint
```

## 建置順序

完整發行版：

```
pnpm build:all
```

依序執行：

- `@snowluma/core` 完整建置

- `@snowluma/sdk`

- `webui`

產物統一輸出到 `dist/`。

## 文件站

文件站位於獨立儲存庫 `Haizakura/HaizakuraDocs`（本機一般 checkout 到 `dev/HaizakuraDocs/`，與主倉共存）。

技術堆疊：Rspress + React + TypeScript + MDX + KaTeX。

OneBot API 參考由文件倉的 `pnpm api:generate`（已掛到 `prebuild`）從 `docs/public/api/catalog.json` 產生 —— 每個動作一頁（外加分類概覽頁與可搜尋的目錄落地頁）。`catalog.json` 是主倉 `collectActionDocs()` 產出的 action 目錄（與 `@snowluma/mcp` 的 `CatalogAction` 同構），由主倉的 `sync-docs-catalog` workflow 在發布時用 Haizakura bot 自動提交到文件倉 —— 無需手動維護。

## 貢獻注意事項

- 不要繞過 BridgeManager：OneBot 層一律透過 `BridgeInterface` 呼叫 NTQQ 能力，便於解耦和測試。

- 保持設定可自動產生：新增欄位需向後相容；解析時正規化、寫回磁碟。

- 原生模組按平台分發：新加平台時同步 `.node` 與可注入函式庫。

- 優先補測試：核心 OneBot 行為透過 `vitest` 驗證，參考 `packages/core/tests/`。

- API 文件自動化：用 `defineAction` 新增動作（可選 `returnsSchema` 描述 `data`）即可 —— `catalog.json` 由 `sync-docs-catalog` workflow 自動同步，API 參考不會過時；本機預覽可手動 `pnpm api:generate`。

這篇文件有幫助嗎？

有幫助 / 沒幫助 · 最後更新於

國內網路

Docker Hub、GitHub、QQ 安裝包在中國大陸網路下怎麼走

MCP 使用

把 Haizakura 的 OneBot action 目錄和可選執行能力接入 MCP 用戶端
