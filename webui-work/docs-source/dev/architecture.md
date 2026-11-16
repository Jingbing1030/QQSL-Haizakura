# 开发者文档


Monorepo 结构、核心启动链路与贡献注意事项

Haizakura 是 TypeScript + 原生模块混合项目。TypeScript 负责运行时编排、OneBot 实现、协议桥接、SDK 和 WebUI；原生模块负责 Hook、注入和高性能 WebSocket 能力。

## Monorepo 结构

pnpm workspace，5 个包：

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

## 核心启动链路

入口在 `packages/core/src/index.ts`：

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

启动时创建：

- `HookManager` —— 发现 QQ 主进程并注入 native addon；`hookAutoLoad: true` 时每发现一个新 PID 自动注入。

- `BridgeManager` —— 把命名管道里的 Hook 消息解码成桥接事件；缓存 rkey / 联系人 / 群成员。

- `OneBotManager` —— 按 UIN 创建 `OneBotInstance`；持有 `MessageStore` / `MediaStore` / `NetworkManager`。

- `initWebUI` —— 完整构建中启动 WebUI，端口默认 `5099`（`runtime.json.webuiPort` 可改）。

## Hook 与原生模块

Hook 原生模块通过 `process.dlopen()` 加载。源码在 `dev/nnphook` 这个独立仓库。

平台命名约定：

```
snowluma-win32-x64.node    snowluma-win32-x64.dll
snowluma-linux-x64.node    snowluma-linux-x64.so
snowluma-linux-arm64.node  snowluma-linux-arm64.so
```

加载搜索路径：

```
native/
dist/native/
packages/runtime/native/
```

原生 addon 暴露：

- `getAllMainProcess` —— 枚举 QQ 主进程。

- `loadModuleManual` —— 向目标进程手动映射注入模块。

- `unloadModuleManual` —— 卸载已注入模块。

Windows 默认目标进程名 `QQ.exe`；Linux 是 `qq`。

## OneBot 生命周期

桥接层检测到 QQ 会话启动时：

- 加载 `config/onebot_.json`（缺则从全局复制）。

- 构造 `OneBotInstance`。

- 起 HTTP / WS / 反向 WS / HTTP POST 适配器（按 `networks.*` 配置）。

- 异步预热好友列表、群列表、群成员列表。

- 桥接事件 → OneBot 事件转发。

会话关闭时对应实例释放。

## WebSocket 包

`@snowluma/websocket` 是项目自带的 WebSocket 实现，接口尽量贴近 `ws`，但带原生加速。

导出：

- `WebSocket` —— 客户端构造器。

- `WebSocketServer` —— 服务端构造器。

- `Server` —— `WebSocketServer` 别名。

- `InternalWebSocket` —— 内部连接实现。

依赖平台原生 `.node`，同样从 `native/` 搜索路径加载。

## SDK 包

`@snowluma/sdk` 是面向第三方的类型完备 OneBot 客户端，可独立发布到 npm、不依赖 Haizakura 运行时。它在 monorepo 里构建（见下方 `pnpm build:sdk` / `build:all`），消费侧用法见 SDK 文档。

## 开发命令

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

## 构建顺序

完整发行版：

```
pnpm build:all
```

依次执行：

- `@snowluma/core` 完整构建

- `@snowluma/sdk`

- `webui`

产物统一输出到 `dist/`。

## 文档站

文档站在独立仓库 `Haizakura/HaizakuraDocs`（本地一般 checkout 到 `dev/HaizakuraDocs/`，与主仓共存）。

技术栈：Rspress + React + TypeScript + MDX + KaTeX。

OneBot API 参考由文档仓的 `pnpm api:generate`（已挂到 `prebuild`）从 `docs/public/api/catalog.json` 生成——每个动作一页（外加分类概览页与可搜索的目录落地页）。`catalog.json` 是主仓 `collectActionDocs()` 产出的 action 目录（与 `@snowluma/mcp` 的 `CatalogAction` 同构），由主仓的 `sync-docs-catalog` workflow 在发布时用 Haizakura bot 自动提交到文档仓——无需手动维护。

## 贡献注意事项

- 不要绕过 BridgeManager：OneBot 层一律通过 `BridgeInterface` 调用 NTQQ 能力，便于解耦和测试。

- 保持配置可自动生成：新增字段需向后兼容；解析时归一化、写回磁盘。

- 原生模块按平台分发：新加平台时同步 `.node` 与可注入库。

- 优先补测试：核心 OneBot 行为通过 `vitest` 验证，参考 `packages/core/tests/`。

- API 文档自动化：用 `defineAction` 新增动作（可选 `returnsSchema` 描述 `data`）即可——`catalog.json` 由 `sync-docs-catalog` workflow 自动同步，API 参考不会过时；本地预览可手动 `pnpm api:generate`。
这篇文档有帮助吗？

有帮助没帮助最后更新于

国内网络

Docker Hub、GitHub、QQ 安装包在大陆网络下怎么走

MCP 使用

把 Haizakura 的 OneBot action 目录和可选执行能力接入 MCP 客户端
