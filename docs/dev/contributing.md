# 参与开发指南

> **面向读者**：要接手维护 Haizakura（原名 SnowLuma）的开发者。
> **本文回答**：代码在哪、想改某功能该动哪个文件、怎么验证、有哪些坑和限制。

---

## 1. 先读这三条

```
① 业务逻辑 100% 有源码（在 bundle 里，未混淆）
   → 改 OneBot / 协议 / WebUI 后端 / 日志，都不需要反编译

② 但 native 层（注入器 + hook 后端，共 654 KB）是纯黑箱
   → 改 hook 目标 = 重写 native，极高工作量

③ WebUI 前端源码缺失（只有构建产物）
   → 改 UI 组件不可行；只能通过配置定制外观
```

**这三条决定了一切**：能用 JS 解决的都容易，需要碰 native 的都很难。

---

## 2. 代码结构

### 2.1 8 个包

原 monorepo 名为 **`snowluma-monorepo`**（`packageManager: pnpm@11.25.0`），
8 个 workspace 包全部被内联进单个 `dist/index.mjs`。

| 包 | 文件数 | 正文行数 | 职责 |
|---|---:|---:|---|
| **`protocol`** | 180 | **269,936** | **最大**。OIDB 服务、Highway 上传、消息推送解码、Web/QZone API |
| **`core`** | 65 | 53,487 | 入口 + WebUI 后端 + update + bridge API 实现 |
| **`onebot`** | 77 | 20,986 | OneBot v11 实现（动作、事件、网络适配器） |
| `bridge` | 17 | 3,146 | **注入核心**：injector / hook-manager / pipe-watcher / qq-account |
| `common` | 20 | 1,806 | 日志脱敏、错误、coerce、runtime 路径、版本 |
| `websocket` | 5 | 1,124 | WebSocket 客户端/服务端封装 |
| `sqlite` | 3 | 226 | SQLite 驱动（native 加载、prebuild 选择） |
| `proton` | 1 | 26 | **【未查清】** 功能，region 名被截断 |
| *第三方（vendored）* | 99 | 15,668 | 15 个 npm 包 |
| `rolldown/runtime.js` | 1 | 38 | 打包器互操作运行时（`__esmMin` 等） |
| | **467** | **366,443** | |

> **正文行数**是 region 内的行数（不含还原时加的注释头）。
> 加上注释头后本地文件会更多，属正常。

### 2.2 目录树

```
restored/
├── package.json                     # 根 workspace 清单
├── pnpm-workspace.yaml              # 8 个 packages/*
├── tsconfig.json                    # 基础 TS 配置
├── rolldown.config.ts               # 复现单文件形态的打包配置
├── manifest.json                    # ★ 467 个 region 的完整索引（行号/字节数）
├── scripts/
│   ├── merge.mjs                    # ★ 构建：region 切片 → dist/index.mjs
│   ├── split.mjs                    # ★ 切分（bundle → 467 个切片 + manifest）
│   └── check.mjs                    # ★ 完整性校验
├── dist/
│   └── index.mjs                    # 重建产物
├── packages/                        # ★ 源码在这里
│   ├── core/        65 个 .ts  ── src/index.ts、src/webui/(30)、src/update/(6)、src/bridge/apis/(20)
│   ├── protocol/   180 个 .ts  ── src/oidb-services/(117)、src/msg-push/(21)、src/highway/(13)、src/web/(12)
│   ├── onebot/      77 个 .ts  ── src/actions/、src/event-converter/、src/modules/、src/network/
│   ├── common/      20 个 .ts
│   ├── bridge/      17 个 .ts  ── src/qq-account/(6)、injector.ts、hook-*.ts
│   ├── websocket/    5 个 .ts
│   ├── sqlite/       3 个 .ts
│   └── proton/       1 个 .ts
├── vendor-regions/                  # 99 个第三方 region 切片（只读参考）
│   └── node_modules/.pnpm/…
└── _unassigned/
    └── loose-lines.txt              # region 外的 47 行（顶部 import 序言，逐行带原始行号）
```

### 2.3 模块依赖图

```
                    ┌──────────────────────────┐
                    │  core/src/index.ts (入口)  │
                    └────────────┬─────────────┘
                                 │
     ┌───────────────────────────┼───────────────────────────┐
     ▼                           ▼                           ▼
┌───────────────┐      ┌──────────────────┐        ┌─────────────────┐
│ core/webui/*  │      │ bridge/manager.ts│        │ core/update/*   │
│ :5099 WebUI   │◄────►│  HookManager     │        │ 自动更新         │
│ hono + SSE    │      │  ├ pipe-watcher  │        │ GitHub+镜像     │
└───────┬───────┘      │  ├ HookSession   │        └─────────────────┘
        │              │  ├ injector.ts ──┼──► .node addon（宿主插件）
        │              │  └ qq-hook-      │
        │              │     client.ts ───┼──► Unix socket (mojo.*.sock)
        │              └────────┬─────────┘      ↕ 40B 帧协议
        ▼                       ▼
┌─────────────────────────────────────────────────────────────┐
│ core/bridge/apis/*  (19 个)  ←→  protocol/src/**  (180 个)   │
│  contacts / group-admin / group-file / message / profile /   │
│  qzone / collection / interaction / system-face / web …      │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ onebot/src/** (77)                                          │
│  actions/* (16)  event-converter/* (8)  network/* (11)       │
│  modules/* (7)   message-store / media-store / reaction-store│
│  → ：3000 HTTP   ：3001 WS  以及 wsClients 出站                │
└─────────────────────────────────────────────────────────────┘
```

> ⚠️ **注意**：因为所有包被内联进单一作用域，
> 还原出的文件**互相看不见**（没有真正的 import/export 边）。
> 它们**是精确的 JS，不是可独立编译的模块**。详见 §6.4。

---

## 3. ★ 修改指南：想改什么 → 改哪个文件

### 3.1 业务逻辑（🟢 容易，改完重新构建即可）

| 想改什么 | 改哪个文件 | 难度 |
|---|---|---|
| **启动流程 / 生命周期 / 信号处理** | `packages/core/src/index.ts` | 🟢 |
| **OneBot 动作行为** | `packages/onebot/src/actions/*.ts`、`modules/*.ts` | 🟢 |
| **加一个 OneBot 动作** | 新增 `actions/xxx.ts` + 注册进 `actions/index.ts` / `api-handler.ts` | 🟢 |
| **OneBot 事件转换** | `packages/onebot/src/event-converter/*` | 🟡 要与 `protocol/msg-push/decoders/*` 对齐 |
| **OneBot 消息段构造** | `packages/onebot/src/message-parser.ts`、`message-id.ts` | 🟡 |
| **网络 / 端口 / 鉴权** | `packages/onebot/src/network/*`、`onebot.json` | 🟢 配置优先 |
| **状态指令（`#hz` 等）** | `packages/onebot/src/modules/status-command.ts`、`config.ts` | 🟢 |
| **事件过滤** | `packages/onebot/src/event-filter.ts` | 🟢 |
| **历史同步** | `packages/onebot/src/history-sync.ts`、`history-persistence.ts` | 🟡 |
| **消息/媒体/表情存储** | `packages/onebot/src/message-store.ts`、`media-store.ts`、`reaction-store.ts` | 🟡 |

### 3.2 WebUI（🟢 后端容易，🔴 前端不可行）

| 想改什么 | 改哪个文件 | 难度 |
|---|---|---|
| **WebUI 后端路由、鉴权、TOTP** | `packages/core/src/webui/server.ts`、`auth.ts`、`totp.ts`、`webui-login.ts` | 🟢 |
| **状态推送 / SSE** | `packages/core/src/webui/state-bus.ts`、`state-stream.ts`、`sse-response.ts` | 🟢 |
| **存储 / 备份 / 恢复** | `packages/core/src/webui/storage-*.ts`、`backup.ts`、`restore.ts` | 🟢 |
| **UI 配置 API** | `packages/core/src/webui/ui-config.ts` | 🟢 |
| **TLS** | `packages/core/src/webui/tls.ts` | 🟢 |
| **反代信任 / 客户端 IP** | `packages/core/src/webui/client-ip.ts`、`request-security.ts` | 🟢 |
| **日志导出** | `packages/core/src/webui/log-export.ts`、`debug-tools.ts` | 🟢 |
| **★ WebUI 外观（不用改代码）** | `ui.json` / `appearance.customCss` / `POST /api/ui` | 🟢 |
| ❌ **WebUI 前端组件** | **无源码** | 🔴 **不可行** |

### 3.3 协议栈（🟡 中等）

| 想改什么 | 改哪个文件 | 难度 |
|---|---|---|
| **OIDB 协议（某类操作）** | `packages/protocol/src/oidb-services/<分类>/` | 🟡 |
| **消息推送解码** | `packages/protocol/src/msg-push/`（`context.ts`、`decoders/`） | 🟡 |
| **消息元素构造 / HTML** | `packages/protocol/src/element-builder.ts`（10,832 行）、`format.ts` | 🟡 |
| **Highway 大文件上传下载** | `packages/protocol/src/highway/`（`highway-client.ts`、`ntv2-upload-request.ts`） | 🟡 |
| **Web / QZone API** | `packages/protocol/src/web/` | 🟡 |
| **消息推送分发** | `packages/protocol/src/msg-push/{client,codec,registry}.ts` | 🟡 |

**OIDB 服务分类**（`oidb-services/` 下的子目录）：

```
contacts(15)        group-admin(26)     group-file(21)
friend(7)           profile(5)          reaction(3)
interaction(3)      custom-face(8)      sys-faces(2)
flash-transfer(13)  web(2)              extras(5)
misc(5)             highway             shared.ts
```

### 3.4 bridge / 注入（🟢 改策略容易，🔴 改 hook 目标不可行）

| 想改什么 | 改哪个文件 | 难度 |
|---|---|---|
| **注入行为 / 超时 / 重试** | `packages/bridge/src/injector.ts`、`packet-timeout.ts` | 🟢 |
| **Hook 会话 / 状态机** | `packages/bridge/src/hook-session.ts`、`hook-status.ts`、`hook-manager.ts` | 🟢 |
| **zygote 过滤规则** | `shouldAutoLoadPid()`（`injector.ts`） | 🟢 纯 JS |
| **转账 / 账号发现（uin 检测）** | `packages/bridge/src/qq-account/`（含 `sqlcipher.ts`） | 🟡 纯 JS，但算法要对齐 QQ 的库格式 |
| **QQ 数据库路径推导** | `packages/bridge/src/qq-account/paths.ts`、`login-db.ts` | 🟡 |
| **native 运行时完整性校验** | `packages/bridge/src/runtime-integrity.ts` | 🟡 |
| ❌ **hook 目标函数** | **在 `.so` 里** | 🔴 **极高** |
| ❌ **适配新 QQ 版本** | 主要在 `.so` / `.node` | 🔴 **极高**（见 §3.6） |

### 3.5 基础设施（🟢）

| 想改什么 | 改哪个文件 | 难度 |
|---|---|---|
| **★ 自动更新源** | `packages/core/src/update/sources.ts` | 🟢 **必做**（上游已删库） |
| **更新检查 / 下载 / 替换** | `packages/core/src/update/{check,download,files,service,release}.ts` | 🟢 |
| **日志 / 脱敏 / 环境变量** | `packages/common/src/{logger,log-sanitize,env,coerce}.ts` | 🟢 |
| **日志轮转策略** | `runtime.json` + `SNOWLUMA_LOG_*` | 🟢 |
| **通知（webhook）** | `packages/core/src/notifications/`、`common/notification-templates.ts` | 🟢 |
| **SQLite 表结构** | 各 `*-store.ts` 的 `CREATE TABLE` + `prepare*Schema()` | 🟡 **务必写迁移** |
| **SQLite 驱动封装** | `packages/sqlite/src/{native,driver,index}.ts` | 🟡 保持 `NATIVE_INTERFACE_VERSION===1` |
| **WebSocket 原生封装** | `packages/websocket/src/{native,server,client,extensions}.ts` | 🟡 |
| **换 Node 版本** | `check-node-version.cjs` | 🟢 注意 N-API 约束 |
| ❌ **换 CPU 架构（x64 等）** | 需要**全部 5 个 native 产物** | 🔴 极高 |

### 3.6 适配新 QQ 版本

**不在"改文件"的范畴里** —— 它的工作方式是**跑脚本 + 看 diff**。

```
腾讯改动 → 对应情况 → 工作量 → 要重写 native 吗
─────────────────────────────────────────────────
只改函数实现     情况 1    0              否
改类名          情况 2    2–6 小时       否（只改字符串）
改槽位顺序      情况 3    0.5–2 天       否（改数字）
末尾加虚函数    情况 4    小时级验证      否
多继承/虚基类   情况 5    3–7 天         ★ 是
删了锚点串      情况 6    数天–2 周       ★ 是
wrapper 被 strip 情况 7   2–5 天         ★ 是
换 ABI/编译器   情况 8    1–3 天         半
```

**结论**：

> **只要腾讯不动「类名 + 继承结构 + vtable 槽位顺序」，适配成本 = 0~1 天，
> 只改字符串/数字，不用碰 native 代码。**
> **一旦 vtable 形状变了（多继承/虚基类），就必须重写 native 解析器。**

**完整难度矩阵与操作流程见 [compatibility.md §7](../advanced/compatibility.md)。**

---

## 4. 开发流程

### 4.1 标准循环

```bash
# ── ① 改代码 ──
# ★ 只改 region【内部】的代码
# ★ 不要增删 region，不要动 manifest.json 的行号
cd <工程根>

# ── ② 构建 ──
npm run build                # 拼装 + 语法检查

# ── ③ 校验 ──
node scripts/check.mjs /path/to/reference/index.mjs
md5sum dist/index.mjs        # 与已知 good 值对比

# ── ④ 冒烟（隔离环境，不碰生产）──
cd dist && SNOWLUMA_DEV_NO_NATIVE=1 SNOWLUMA_DEV_MODE=1 node index.mjs
# 期望日志：INFO [WebUI] listening http://127.0.0.1:<port>
#           WARN [Hook] … No hook native addon found for linux-x64  ← 预期（本机非 arm64）

# ── ⑤ 部署（★ 注意登录态）──
docker exec <容器> supervisorctl restart snowluma      # 只重启 runtime

# ── ⑥ ★ 端到端验证 ──
#    真的发一条消息、真的收一条消息
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'   # 0 = 健康
```

**详细的构建/部署说明见 [build.md](build.md)。**

### 4.2 ★ 一条铁律：不能只看"进程没崩"

**VTable 替换是最脆弱的 hook 形式。槽位错一位不会立刻崩**，
而是**把消息发到错误的路径上** —— 表现为用户可见的：

```
"The QQ connection changed. Please restart QQ and try again."
```

> **每次改动（尤其是涉及 protocol / bridge 的改动）都必须做
> 真实收发消息的端到端验证。**

### 4.3 加一个新 OneBot 动作

**已有的脚手架**：

```
packages/onebot/src/
├── action-kit.ts               动作构造工具
├── action-args-schemas.ts      参数校验
├── action-result-schemas.ts    返回值校验
├── action-docs.ts              动作文档
├── api-handler.ts              ★ 动作分发（要在这里注册）
└── actions/
    ├── index.ts                ★ 动作注册表
    ├── message.ts
    ├── friend.ts
    ├── group-admin.ts
    ├── group-info.ts
    ├── group-file.ts
    ├── group-album.ts
    ├── request.ts
    ├── info.ts
    ├── extended.ts
    ├── qzone.ts / qzone-public.ts
    ├── system-face.ts
    ├── stream-download.ts / stream-file.ts
    └── contact-profile-schema.ts
```

**步骤**：

```
① 在合适的 actions/*.ts 里加动作实现
   （或新建 actions/xxx.ts —— 但见下方警告）
② 在 actions/index.ts 注册进动作表
③ 若有参数/返回值校验，在 *-schemas.ts 里补 schema
④ 若调用新协议，在 packages/protocol/src/ 里加对应的 OIDB 服务
⑤ 在 action-docs.ts 补文档（可选）
⑥ npm run build → 部署 → 端到端测试
```

> ⚠️ **新建文件的警告**：`merge.mjs` 是按 `manifest.json` 的**行号**拼装的。
> **新建一个 `.ts` 文件不会自动进入产物** ——
> 你必须**扩展 `manifest.json`** 并**同步平移后续所有 region 的行号**。
>
> **更省事的做法**：把新动作写进**现有的** `actions/*.ts` 内部
> （选语义最接近的那个文件）。这样行号只在文件内部变化，
> **但注意：文件内部增删行同样会让该 region 的长度与 `body_lines` 不符** ——
> 好在这个字段不参与拼装（只用于校验），所以**只要不改变 region 的起止行号语义即可**。
> 具体约束见 [build.md §2.4](build.md)。

### 4.4 调试技巧

```bash
# ── 开发模式（固定密码 snowluma-dev，跳过部分鉴权）──
SNOWLUMA_DEV_MODE=1 SNOWLUMA_DEV_WEBUI=1 node dist/index.mjs

# ── 无 native 模式（在没有 native 产物的平台上跑）──
SNOWLUMA_DEV_NO_NATIVE=1 node dist/index.mjs

# ── 调日志级别 ──
SNOWLUMA_LOG_LEVEL=debug SNOWLUMA_LOG_FILE_LEVEL=debug node dist/index.mjs

# ── 实时看日志（SSE）──
curl -N -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/logs/stream

# ── 调试 API（★ 等于远程任意动作执行，生产环境应关闭/加鉴权）──
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/debug/actions
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:5099/api/debug/invoke \
  -H 'Content-Type: application/json' \
  -d '{"action":"get_status","params":{}}'
```

### 4.5 逆向/分析脚本的注意事项

如果你要分析 `wrapper.node` 或 `.so`，**先读
[troubleshooting.md T15](../advanced/troubleshooting.md)** —— 那里列了 7 个
"亲自踩过的坑"，每一条都能让脚本崩掉或把机器搞挂。

**最关键的三个**：

```
① 不能把"已定义导出"子集当"全部符号" → 会得出错误结论
   永远回到 readelf -sW --dyn-syms 原文

② __type_name 存的是 mangled 名（N2nt10MSFServiceE），不是 "MSFService"
   按字面量搜 → 0 命中

③ 所有循环必须加计数上限
   一次边界写错就能把负载推到 37、内存吃到 2.7 GB
```

---

## 5. 接手必做项（按优先级）

| # | 事项 | 位置 | 为什么必须做 |
|---|---|---|---|
| **1** | **改自动更新源** | `packages/core/src/update/sources.ts` | 上游 `api.github.com/repos/SnowLuma/SnowLuma` **已删库，必然 404** |
| **2** | **归档版本基线** | 保留 `wrapper.node` 的 md5 / build-id + native 产物 sha256 | 出问题时唯一能回退的参照系 |
| **3** | **做 `dump-vtable.py`** | 新工具 | 把 RTTI 分析机械化 → 适配从"逆向工程"变成"跑脚本看 diff" |
| **4** | **钉死 QQ 版本** | 部署策略 | 别自动升级，等确认兼容性 |
| **5** | **检查 hook 健康度** | `grep -c unresolved` 日志 | 0 = 健康 |

**第 3 项的工作量估算**（1 名熟悉 AArch64 + C++ ABI 的工程师）：

| 阶段 | 内容 | 人日 |
|---|---|---|
| P0 | 复现离线解析器（Python，跑在 `wrapper.node` 上出 vtable 表） | **1–2 天** |
| P1 | 进程/模块定位 + ELF 解析 + 重定位表 | 3–5 天 |
| P2 | 模块身份校验（build-id + 磁盘/内存比对） | 1–2 天 |
| P3 | RTTI 链（含 `__vmi_class_type_info` 布局） | 3–5 天 |
| P4 | 锚点/函数名反查（指令解码器约 200 行） | 2–4 天 |
| P5 | VTable 替换 + 一致性校验 + 回滚 | 3–5 天 |
| P6 | 与 `.node` 的 `RuntimeTargets` 对接 | 2–3 天 |
| P7 | 真机验证 + 线程安全 | 5–10 天 |
| | **从零重写 `.so` 总计** | **约 20–36 人日 ≈ 1–1.5 人月** |
| | **★ 只做「离线解析器 + 适配脚本」（P0+P3+P4）** | **约 5–10 人日** ← **强烈建议先做这个** |

> **重要建议：不要一上来重写 `.so`。**
> 先做 P0 —— 它就能覆盖难度矩阵里**最可能发生的**情况 2/3/4，
> 成本 5–10 人日而不是 1 人月。

---

## 6. 已知限制

### 6.1 ⚠️ WebUI 前端无源码

| 项 | 情况 |
|---|---|
| **现状** | 只有构建产物 `client/`（`index.html` 6,210 B + `assets/` + `logo.png` + `icons.svg`） |
| **证据** | bundle 内 **0 处** `<!DOCTYPE html>` / `ReactDOM` / `createRoot` / `jsx(` |
| **加载方式** | `packages/core/src/webui/static-frontend.ts` 从磁盘读 `client/index.html` |
| **找不到时** | `"WebUI client bundle not found. Run \`pnpm --filter webui build\`"` |
| **原始构建** | 独立的 **Vite** 构建（dev server 端口 **:5178**） |
| **影响** | **能改配置，不能改组件** |
| **可行替代** | 改 `ui.json` / `appearance.customCss` / `POST /api/ui`（外观与布局） |
| **要改组件** | 需从零重写前端，或找上游 monorepo 残留 |

**从根 `package.json` 能看出的缺失包**：

| 包名 | 在 bundle 里？ | 作用 |
|---|---|---|
| `@snowluma/core` | ✅ 就是本 bundle | 运行时主体 |
| `@snowluma/common` | ✅ | 公共库 |
| `webui` | ❌ 只有后端 | WebUI **前端**（React + Vite） |
| `@snowluma/sdk` | ❌ | 客户端 SDK |
| `@snowluma/ui` | ❌ | 共享 UI 组件 |
| `@snowluma/mcp` | ❌ | MCP 服务端 |

### 6.2 ⚠️ native 层是黑箱

| 组件 | 形态 | 可维护性 | 说明 |
|---|---|---|---|
| `snowluma-linux-arm64.node`（319 KB） | ELF N-API，**strip 但仍可读** | ★★★☆☆ **半黑箱** | dynsym 只剩 `napi_register_module_v1`；但**字符串表极丰富**（~500 条有意义串，等于把流程写出来了）+ **导入符号表完整**。**有效但不可改** |
| `snowluma-linux-arm64.so`（335 KB） | ELF，**strip 但导出 6 符号** | ★★☆☆☆ **黑箱（有 ABI 契约）** | 6 个导出是稳定 ABI。**内部逻辑不可改**；但它只是"后端 stub"，**理论上可整体重写** |

**能否重写 `.so`？** —— 这是最该评估的战略问题：

| 方案 | 可行性 | 说明 |
|---|---|---|
| **A. 重写 hook 后端**，保留 bundle | 🟡 理论可行，工作量大 | ABI 只有 6 个函数（契约极简），但要重写内部（MSF VTable 解析 + 管道服务）才是真正的工作量 |
| **B. 换成 inline hook 框架**（Dobby / frida-gum / plthook） | 🟡 可行 | 但**要重新找到"hook 哪里"** —— 这是难点，不是框架问题。且 VTable 替换比 inline hook **更稳**（不破坏代码段、不需 mprotect 代码页、对 anti-tamper 友好）—— **现有选择是对的** |
| **C. 借鉴 NapCat / Lagrange.Core 重做** | 🔴 大工程 | NapCat 走的是"官方 Electron 客户端 + 自己的协议实现"，与"寄生官方会话"路线**不同**。参考价值在上层协议实现（bundle 里的 `protocol/` 已很完整） |
| **D. 纯运维，不碰 native** | ✅ **最现实** | 锁定一个**已知可用**的 QQ 版本，不升级。只在上游 bundle 上做改进 |

> **强烈建议：接手初期选 D。**
> `package.json` 的 `description` 明确说
> *"There are intentionally NO runtime npm dependencies; production artifacts are self-contained"*
> —— 上游很重视"可复现的单体产物"。
> **把 QQ 版本 + 运行时版本一起钉死**，优先修业务层，**把 native 层当不动产对待**。

### 6.3 ⚠️ 仅 arm64

**只有 Linux arm64 有构建产物**（5 个 native 文件全是 arm64）。
x86_64 / Windows / macOS 有代码路径但无产物。

> 实测：在 x64 上跑会报
> `No hook native addon found for linux-x64`。
> **换架构需要重写全部 5 个 native 产物** —— 极高工作量，不推荐。

### 6.4 ⚠️ TS 类型已擦除 + import/export 边缺失

**类型擦除**（TS → JS 编译的必然结果）：

| | 状态 |
|---|---|
| ✅ **保留** | 变量/函数名、类结构、注释、字符串、逻辑 |
| ❌ **丢失** | `interface` / `type` / 泛型参数、参数与返回类型、`private` 等修饰符、`async` 之外的 TS 特性、枚举（编译成了对象字面量） |

所以每个还原文件都加了 `// @ts-nocheck` 与说明头 ——
**它们是精确的 JS，不是原版 TS。**

**import/export 边缺失**（更严重的限制）：

```
原 bundle：0 个 export，所有 import 被提升到文件顶部
→ 模块间依赖关系【不可恢复】

后果：packages/*/src/*.ts 是【扁平化的 fragment】
      · 每个文件能单独通过 node --check ✅
      · 但互相看不见，编译不了 ❌
```

**这是"能跑"与"能改"之间最大的缺口。**

**重建路线**（进阶，按包逐步迁移）：

```
① 重建 import 图
   · 从 init_xxx() 调用序反推（已验证：15 个 init_* 定义与 15 个调用完全配对）
   · 从标识符命名规律反推（rolldown 给重名符号加 $1/$2，如 fs$1、logger$2）
② 给每个文件补 export
③ 替换 init_xxx() 为真正的 import 副作用
④ 用 npm run build:rolldown 试打包，比对行为

迁移顺序（依赖从少到多）：
common(20) → sqlite(3) → websocket(5) → bridge(17)
  → onebot(77) → protocol(180) → core(64)

★ 每迁完一个包就跑一次重建做回归
```

### 6.5 ⚠️ 构建期工具链缺失

以下**都不在 bundle 里，无法还原**：

```
tools/bump-version.mjs  tools/release.mjs  tools/ci-check.mjs
tools/check-release-layout.mjs  tools/coverage.mjs
.github/scripts/*.test.cjs
eslint / prettier 配置文件
LICENSE / EULA.md / PRIVACY.md
```

> 根 `package.json` 的 `scripts` 字段是唯一线索。
> **替代方案**：`LICENSE.md` / `EULA.md` / `PRIVACY.md` 可从
> 归档包 `archive/snowluma-archive-core.tgz` 里取到（实测存在）。

---

## 7. 开源许可注意事项

> ⚠️ **重要提示：许可状态不明确。以下仅为事实陈述，不构成法律意见。
> 使用者请自行判断并承担相应风险。**

### 7.1 现状

| 项 | 状态 |
|---|---|
| 上游仓库 | **已删库**（`github.com/SnowLuma/SnowLuma`） |
| `package.json` 的 `license` 字段 | `"SEE LICENSE IN LICENSE"` |
| **`LICENSE` 文件本身** | ⚠️ **未随任何素材提供** —— 已随上游删库丢失 |
| `EULA.md` | ✅ 已归档（12,290 B） |
| `PRIVACY.md` | ✅ 已归档（10,510 B） |
| 运行时行为 | 启动时会检查 `EULA.md` / `PRIVACY.md`，缺失则警告 |

**关键问题**：`EULA.md` 多处**引用 `LICENSE`**（"依 `LICENSE` 授权"、
"以 `LICENSE` 为准"），**但 `LICENSE` 的内容我们拿不到**。
⇒ **完整的许可条款无法确定。**

### 7.2 EULA 里与本项目直接相关的条款

**第 5 条「专有组件」** —— 这是最需要注意的一条：

> **5.1** 本软件可能包含或依赖**专有组件**，包括但不限于原生附加组件
> （如 `snowluma-*.node`、`snowluma-*.dll`、`snowluma-*.so`），
> 以及其中可能包含的授权、激活或技术保护措施。
>
> **5.2** 此类专有组件**不属于 `LICENSE` 所授权的源代码与资源**，
> 仅以随本软件提供的**预编译形式**按本条款授权使用；
> 本协议**不授予其源代码权利**。
>
> **5.3** 除适用法律强制性规定明确允许外，
> 您**不得对专有组件进行逆向工程、反编译或反汇编**，
> 亦不得规避、破解或绕过其授权或激活机制。
>
> **5.4** 除事先取得著作权人的书面授权外，您仅可为 `LICENSE` 允许的
> **非商业用途**，以专有组件随本软件提供的**形式**运行该组件；
> 不得复制、修改、单独再分发或再许可该组件。
> **将其并入第三方安装包或 Docker 镜像、通过自动化脚本部署，
> 或者将其用于任何商业用途，均须事先取得书面授权。**

**第 2 条「授权范围」**：

> **2.1** 本软件的源代码与资源依据随附的 `LICENSE` ——
> **SnowLuma 源码可见非商业许可（SnowLuma Source-Available Non-Commercial License）** —— 授权。
>
> **2.2** `LICENSE` 仅授予其中明确列明的权利，包括**查看、学习、
> 个人或其他非商业使用、非商业自托管**，以及在规定条件下进行修改或再分发。
> **任何商业使用，以及公开发布修改版或衍生版，均须事先取得著作权人的书面授权。**
>
> **2.4** 专有组件（见第 5 条）不属于源码许可范围。

**第 3 条「免责声明」**（要点）：

> **3.1** 本软件是**独立的第三方互操作性项目**，
> 与腾讯公司及 QQ **无任何隶属、合作、授权或背书关系**。
>
> **3.2** 除非事先取得书面商业授权，本软件仅供 `LICENSE` 允许的
> **个人或其他非商业用途**使用。
>
> **3.4** 按"**现状（AS-IS）**"及"**现有（AS-AVAILABLE）**"提供，不附带任何担保。
>
> **3.5** 在适用法律允许的最大范围内，对于因使用或无法使用本软件而导致的
> 任何损害（**包括但不限于账号封禁或限制、数据丢失**），
> **SnowLumaDevs 概不承担责任**。
>
> **3.6** 您理解，使用非官方协议工具接入第三方平台
> **可能违反该平台条款并导致账号风险**，您**自愿承担**该等风险。

### 7.3 ⚠️ 事实层面的张力（如实标注）

**需要使用者自行判断的事实**：

```
① 本项目的接手维护工作，其前提是【对 native 组件做了逆向分析】
   —— 这与 EULA §5.3 的表述存在张力。

② 实际部署形态是【Docker 镜像 / 自动化脚本部署】
   —— 这与 EULA §5.4 的表述存在张力。

③ EULA 提到的 "LICENSE" 文件本身已随上游删库丢失，
   ⇒ 完整的许可条款【无法确定】，无法据此判断"被授权了什么"。

④ EULA §2.2 保留"规定条件下进行修改或再分发"的权利，
   但具体条件在被引用的 LICENSE 里 —— 而它不可得。
```

> **本文档不对上述张力做法律判断。**
> **立场声明**：本项目以**接手维护、非商业用途**为前提推进。
> **使用者需自行判断合规性并承担风险。**
> 如需商业使用或公开发布衍生版，**应设法联系原著作权人取得书面授权**。

### 7.4 实践中的注意事项

| 事项 | 建议 |
|---|---|
| **凭据** | **绝不入库** —— 密码、`accessToken`、`webui.json`、`machine-id`、`vnc-password` 全部排除 |
| **`onebot.json` 的 token** | 明文存储（644 权限）→ 生产环境改强随机 + 权限收紧到 600 |
| **WebUI 密码** | 必须 ≥10 位 + 大小写 + 数字 + 特殊符号（见 [troubleshooting.md T8](../advanced/troubleshooting.md)） |
| **`/api/debug/invoke`** | 等于远程任意动作执行 → 暴露公网时务必启用 TOTP + 强密码 |
| **`sqlcipher.ts`** | 敏感代码（能解密用户本地库）→ 处理时遵守合规 |
| **`webuiHost: 0.0.0.0` + TLS 关闭** | 建议改 `127.0.0.1` + 反代，或启用 TLS |
| **上游归属** | EULA/PRIVACY 里引用了原项目名；改名（→ Haizakura）**不改变许可约束** |

### 7.5 归档资产说明

```
archive/snowluma-archive-core.tgz     原始二进制资产（含 sha256 清单）
  ├── index.mjs                       12 MB bundle
  ├── EULA.md / PRIVACY.md            ✅ 许可文本
  ├── native/                         5 个 native 产物 + sqlite LICENSE.sqlite3
  ├── client/                         WebUI 前端构建产物
  └── release.json / launcher.sh / check-node-version.cjs
```

> **建议**：这个归档是**上游删库后唯一的来源**，请**多地备份**。

---

## 8. 尚未查清的部分（诚实标注）

| 项 | 状态 | 为什么值得知道 |
|---|---|---|
| **管道的完整 op 码表** | **【未查清】** | 定义在 `.so` 内。已知 `op=17`（登录身份）、`op=1`（binary）、`status=1`（私聊上报可用）。要完整还原需逐函数反汇编 `.so` 的 `0xcf98` 一族（约 20 个内部函数），或抓包 |
| **`RuntimeTargets` 的完整内存布局（字段顺序/大小）** | **【未查清】** | ★ **适配工作最高优先级的待办**。已知字段名，但没 dump 出真实结构体数组 |
| **`nnphook` 具体 hook 的 VTable 槽位索引** | **【未查清】** | 需把 `.so` 的 `wrapperBase` 解析逻辑逐条反汇编 |
| **4 个锚点名在 `wrapper.node` 里字节级 0 命中** | **【未查清】** | `sendSsoInternal` / `msfDidRecvResponseData` / `msfGetStatus` / `selfInfoOnLoginSuccess` —— 它们是**跨版本 ABI 指纹**，但**取值来源未定**（可能是别的平台构建或更老/更新版本的特征名） |
| **`xrefFileOffsets` / `xrefRuntimeAddresses` 的确切语义** | **【强推断】** | 疑为"静态指纹 + 动态地址"配对，用于版本错配/内存篡改的双向校验 |
| **`msfCoreCallbackOffset` 的精确含义** | **【强推断】** | 强烈倾向"vtable 内字节偏移 0x178"，但没有直接读到赋值点 |
| **`.eh_frame` / `exceptionTable` 的用途** | **【推断】** | 疑为注册 C++ 异常展开表，让 hook 函数内抛异常不崩 QQ |
| **`orcexec` 文件名构造点** | **【推断】** | 前缀 + 6 位随机；字符串不在两个二进制里，**疑在注入用的 stub shellcode 中** |
| **PID 80 / 105 双进程的来源** | **【未查清】** | 是 fork 的子进程还是 `ps` 的呈现；不影响维护 |
| **`../proton/src` 是什么** | **【未查清】** | 只有 1 个 region，名字被截断 |
| **`QQ_RECV_HEARTBEAT_CMD`** | **【未查清】** | 疑似 QQ 收包心跳的命令名，可能与登录保持有关 |
| **`vnc-password`（root, 600）** | **【未查清】** | 与运行时逻辑无关，疑为容器内 noVNC 服务 |
| **WebUI 前端源码** | **缺失** | 只有构建产物；可从 `assets/` chunk 名推断组件结构 |
| **日志级别 `success`** | 已知但非标准 | `SNOWLUMA_LOG_FILE_LEVEL` 支持 `success`（非 pino 标准）→ **日志层是自研的** |
| **`.so` 的 `0xfd4c` 内部 15+ 个 `0x36xxx` 子函数** | **【未查清】** | 只按字符串归了类；要完全重写 `.so` 需补齐 |

### 8.1 方法名表的置信度说明

| 槽位 | 置信度 | 依据 |
|---|---|---|
| **`SessionInit`（v[19]）** | **【确证】** | 锚点串 xref site **精确落在** `.eh_frame_hdr` 解出的函数边界内 —— 闭环 |
| `Initialize`（v[17]/v[18]） | 【确证】 | 同上 |
| **其余槽位** | **【强推断】** | 来源是"该函数体内引用的 `Class::method` 字符串"，但 **0x1400 字节扫描窗可能跨入相邻函数**，个别条目可能偏移一位 |

> **做版本适配时的正确做法**：
> **不要依赖方法名表**（它只是"辅助理解"），
> 而要依赖 **"锚点串 → xref site 精确落在哪个 vtable 槽位函数内"** 的判定 —— **那是确定性的**。

---

## 9. 相关文档

| 想了解 | 去看 |
|---|---|
| 它到底怎么工作的 | [architecture.md](../advanced/architecture.md) |
| 支持哪些版本 / 依赖什么 | [compatibility.md](../advanced/compatibility.md) |
| 出问题怎么排查 | [troubleshooting.md](../advanced/troubleshooting.md) |
| 怎么从源码构建 | [build.md](build.md) |

---

*本文档的"修改指南"综合了源码 region 路径、`bridge/apis` 目录结构与
`RESTORE-REPORT.md` 的映射表，并已与还原工程的实际文件列表核对。
许可部分为 EULA 条款的**原文摘录**，不对其做法律解释。*
