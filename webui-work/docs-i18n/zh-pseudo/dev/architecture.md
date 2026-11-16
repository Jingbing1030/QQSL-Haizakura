# 開発者文档


Monorepo 結構、核心起動鏈路与貢献注意事項也

Haizakura 者 TypeScript 与原生模块混合工程也。TypeScript 担当運行時編排、OneBot 実装、協議橋接、SDK 与 WebUI；原生模块担当釣針、注入与高性能 WebSocket 能力也。

## Monorepo 結構

pnpm workspace、5 個包也：

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

## 核心起動鏈路

入口在 `packages/core/src/index.ts` 也：

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

起動時生成之物：

- `HookManager` —— 発見 QQ 主工程且注入原生 addon；`hookAutoLoad: true` 之時毎発見一新 PID 自動注入也。

- `BridgeManager` —— 命名管道中之釣針消息解碼為橋接事件也；緩存 rkey / 連絡人 / 群成員也。

- `OneBotManager` —— 按 UIN 生成 `OneBotInstance`；保持 `MessageStore` / `MediaStore` / `NetworkManager` 也。

- `initWebUI` —— 完整構建中起動 WebUI、端口既定 `5099`（`runtime.json.webuiPort` 可改）也。

## 釣針与原生模块

釣針原生模块経由 `process.dlopen()` 載入也。源碼在 `dev/nnphook` 此独立倉庫中也。

平台命名約定：

```
snowluma-win32-x64.node    snowluma-win32-x64.dll
snowluma-linux-x64.node    snowluma-linux-x64.so
snowluma-linux-arm64.node  snowluma-linux-arm64.so
```

載入探索路径：

```
native/
dist/native/
packages/runtime/native/
```

原生 addon 暴露之物：

- `getAllMainProcess` —— 列挙 QQ 主工程也。

- `loadModuleManual` —— 向目標工程手動映射注入模块也。

- `unloadModuleManual` —— 卸載既注入模块也。

Windows 既定目標工程名 `QQ.exe`；Linux 者 `qq` 也。

## OneBot 生命周期

橋接層検測到 QQ 会話起動之時：

- 載入 `config/onebot_.json`（欠落者自全局複製）也。

- 構建 `OneBotInstance` 也。

- 起動 HTTP / WS / 反向 WS / HTTP POST 適配器（按 `networks.*` 設定）也。

- 非同期預熱好友列表、群列表、群成員列表也。

- 橋接事件 → OneBot 事件転送也。

会話閉合之時、対応実例解放也。

## WebSocket 包

`@snowluma/websocket` 者本工程自有之 WebSocket 実装也、接口尽力近 `ws`、但携原生加速也。

輸出：

- `WebSocket` —— 客端構建器也。

- `WebSocketServer` —— 伺服器端構建器也。

- `Server` —— `WebSocketServer` 別名也。

- `InternalWebSocket` —— 内部接続実装也。

依存平台原生 `.node`、同自 `native/` 探索路径載入也。

## SDK 包

`@snowluma/sdk` 者面向第三者之型完備 OneBot 客端也、可独立発布至 npm、不依存 Haizakura 運行時也。其於 monorepo 内構建（見下方 `pnpm build:sdk` / `build:all`）、消費側用法見 SDK 文档也。

## 開発命令

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

## 構建順序

完整発行版：

```
pnpm build:all
```

順次実行：

- `@snowluma/core` 完整構建

- `@snowluma/sdk`

- `webui`

産物統一輸出至 `dist/` 也。

## 文档站

文档站者独立倉庫 `Haizakura/HaizakuraDocs` 中也（本地通常 checkout 至 `dev/HaizakuraDocs/`、与主倉共存也）。

技術棧：Rspress + React + TypeScript + MDX + KaTeX。

OneBot API 参考者、文档倉之 `pnpm api:generate`（既掛於 `prebuild`）自 `docs/public/api/catalog.json` 生成 —— 毎動作一頁也（外加分類概覧頁与可検索目録之首頁也）。`catalog.json` 者主倉 `collectActionDocs()` 産出之 action 目録也（与 `@snowluma/mcp` 之 `CatalogAction` 同構）、主倉之 `sync-docs-catalog` workflow 於発布時以 Haizakura bot 自動提交至文档倉 —— 無需手動維護也。

## 貢献注意事項

- 勿迂回 BridgeManager：OneBot 層一律経由 `BridgeInterface` 呼出 NTQQ 能力、以便解耦与測試也。

- 保持設定可自動生成：新增字段需後方兼容；解析時正規化、写回磁盤也。

- 原生模块按平台分発：新加平台時同期 `.node` 与可注入庫也。

- 優先補測試：核心 OneBot 行為経由 `vitest` 検証、参考 `packages/core/tests/` 也。

- API 文档自動化：以 `defineAction` 新增動作（可選 `returnsSchema` 記述 `data`）即可 —— `catalog.json` 由 `sync-docs-catalog` workflow 自動同期、API 参考不会過時；本地預覧可手動 `pnpm api:generate` 也。
此文档有用乎？

有用無用最終更新

国内網絡

Docker Hub、GitHub、QQ 安装包於大陸網絡下如何経由

MCP 使用

把 Haizakura 之 OneBot action 目録与可選実行能力接入 MCP 客端也