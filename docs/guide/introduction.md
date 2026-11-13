# 项目介绍

> [!WARNING]
> 本内容完全由 AI 编写，请谨慎查看。

> **Haizakura**（原名 **SnowLuma**）是一个运行在 Linux 上的**第三方 QQ 客户端运行时**。
> 它寄生在官方 QQ 进程内已登录的 MSF 会话之上，把 QQ 的能力通过
> **OneBot v11** 协议暴露出来，让你可以用编程的方式调用 QQ。

---

## 1. 它是什么

一句话：**它不是 QQ 协议的重新实现，而是官方 QQ 客户端的「外挂式」能力导出层。**

| 常见误解 | 实际情况 |
| --- | --- |
| 「它自己实现了 QQ 协议」 | ❌ 它**不实现协议、不登录、不加密** |
| 「它自己连腾讯服务器」 | ❌ 它复用**官方 QQ 已建立的 MSF 会话** |
| 「它需要账号密码 / 扫码接口」 | ❌ 登录由**官方 QQ 客户端自己**完成，你只是在操作那个 QQ 窗口 |
| 「它是一个独立的机器人程序」 | ❌ 它必须**先有官方 QQ 登录成功**才能工作 |

【确证】源码里保留的原始错误串直接说明了这个依赖关系：

```
"not logged in: wait until QQ completes login"
"logged-in MSF service instance is missing"
"QQ is not ready. Please finish signing in and try again."
```

---

## 2. 工作原理

### 2.1 进程模型

```
┌─────────────────────────────────────────────────────────┐
│ 容器（例如 snowluma-hz）                                  │
│                                                          │
│  ┌────────────────────┐      ┌──────────────────────┐   │
│  │  官方 QQ 客户端     │      │  Haizakura runtime   │   │
│  │  (Electron)        │      │  (Node 进程)          │   │
│  │                    │      │                      │   │
│  │  MSFService        │◀─────┤  OneBot v11 (222 动作)│   │
│  │  MSFCoreService    │ hook │  WebUI  (:5099)      │   │
│  │  ↑ VTable 被替换    │      │  SQLite              │   │
│  └────────────────────┘      └──────────────────────┘   │
│           ▲                            ▲                 │
│           │  unix socket               │                 │
│           │  /tmp/runtime-<uid>/       │                 │
│           │  mojo.<pid>.{control,recv}.sock              │
│           └────────────────────────────┘                 │
│                                                          │
│  ┌──────────┐  ┌─────────┐  ┌──────────┐                │
│  │ Xvfb :1  │  │ x11vnc  │  │ noVNC    │  ← 你在这里登录  │
│  │          │  │ :5900   │  │ :6081    │    官方 QQ       │
│  └──────────┘  └─────────┘  └──────────┘                │
└─────────────────────────────────────────────────────────┘
```

**【实测】** 容器内真实进程（`ps -eo pid,ppid,comm,args`）：

```
1   supervisord    /usr/bin/python3 /usr/bin/supervisord -c /etc/supervisord.conf
55  Xvfb           Xvfb :1 -screen 0 1920x1080x24
60  fluxbox        fluxbox
61  x11vnc         x11vnc -display :1 -noxrecord -noxfixes -noxdamage -forever -threads
64  bash           bash /opt/noVNC/utils/novnc_proxy --vnc localhost:5900 --listen 6081
73  python3        python3 -m websockify --file-only --web /opt/noVNC 6081 localhost:5900
79  qq             qq --no-sandbox --disable-gpu --disable-software-rasterizer ...
80  MainThread     /usr/local/bin/node /app/runtime/index.mjs
105 MainThread     /usr/local/bin/node /app/runtime/index.mjs
```

注意 **pid 79 是主 QQ 进程**，还有一堆 `--type=zygote` / `--type=utility` 的
Electron 子进程 —— Haizakura 的注入器会**主动过滤掉这些子进程**，
只注入主进程（详见 [架构与注入原理](../advanced/architecture.md)）。

### 2.2 注入方式：替换 C++ VTable（不是 inline hook）

Haizakura 通过 `ptrace` + `process_vm_writev` + 手工 ELF 映射，把一段 `.so`
写进 QQ 进程，然后：

1. 用 **RTTI** 定位 `nt::MSFService` 与 `nt::MSFCoreService` 两个类
2. 替换它们的 **C++ VTable** 中的关键槽位
3. 在 QQ 进程内启动 `snowluma-pipe-w` 线程，创建两个 unix socket
4. socket 命名刻意伪装成 Chromium 的 **mojo IPC**，混在 QQ 自己的 socket 里

【确证】关键槽位（地址基于 `wrapper.node` md5 `adeb40af...`）：

| 类 | 槽位 | 函数 | vtable 字节偏移 |
| --- | --- | --- | --- |
| `MSFService` | **v[19]** | **SessionInit** | **0x98** |
| `MSFService` | v[36] | SendSSORequestInternal | 0x120 |
| `MSFCoreService` | **v[19]** | **SessionInit** | **0x98** |
| `MSFCoreService` | v[47] | onMSFPacketState | 0x178 |

> **两个类的 `SessionInit` 都在字节偏移 `0x98`** —— 这不是巧合，
> 说明它们来自同一个基类布局。

注入细节（RTTI 链、`.eh_frame_hdr` 函数边界恢复、如何适配新 QQ 版本）
见 [架构与注入原理](../advanced/architecture.md)。

### 2.3 为什么这样做（风控视角）

**从腾讯的服务端看，流量就是官方客户端发出的**：

- 同一个 **MSF 会话**（不是新建连接）
- 同一套**官方加密实现**
- 同一个**设备指纹**

**【实测】** 这是它能连续稳定运行多天的根本原因。

⚠️ **但要诚实说明它「有」和「没有」什么**：

| ✅ 它有的 | ❌ 它没有的 |
| --- | --- |
| 反**本地**发现：mojo 命名伪装 | 设备指纹伪造 |
| 注入后 `unlink`（`/proc/<pid>/maps` 显示 `(deleted)`） | 签名伪造 |
| 临时文件随机名（`orcexec.<6位随机>`） | 请求抖动 / 退避 / 熔断 |

**它的真实优势完全依赖「hook 不被察觉」**，而 hook 依赖 QQ 内部布局不变。
**这不是零风险方案**，只是风险低于自实现协议。

---

## 3. 能做什么

### 3.1 OneBot v11：222 个动作

【确证】实测 `GET /api/debug/actions` 返回 `222` 个动作，分 **12 类**：

| 分类 | 数量 | 典型动作 |
| --- | ---: | --- |
| 信息 | 5 | `get_login_info`、`get_status` |
| 消息 | 6 | `send_msg`、`delete_msg`、`get_msg` |
| 好友 | 3 | `get_friend_list`、`set_friend_add_request` |
| 群信息 | 7 | `get_group_list`、`get_group_member_list` |
| **群管理** | **24** | `set_group_kick`、`set_group_ban`、`set_group_admin` |
| 群文件 | 12 | `upload_group_file`、`get_group_file_list` |
| 请求 | 2 | `set_friend_add_request`、`set_group_add_request` |
| **扩展** | **115** | 大量 NT QQ 专有能力（收藏、贴表情、语音转文字…） |
| 群相册 | 9 | `upload_image_to_qun_album`、`do_group_album_comment` |
| 空间 | 29 | QQ 空间相关（说说、相册） |
| 系统表情 | 4 | 系统表情目录与转换 |
| 流式接口 | 6 | 大文件流式上传 / 下载 |
| **合计** | **222** | 其中 **5 个流式**、**5 个带别名** |

> **可执行名字总数 = 228**（222 canonical + 6 个别名）。
> 例如 `fetch_ptt_text` 同时接受 `get_ptt_text` / `get_record_text`。

**2 个动作当前未实现**（调用返回失败，请勿当可用能力）：

| 动作 | 说明 |
| --- | --- |
| `create_collection` | 创建收藏 |
| `.get_word_slices` | 分词 |

完整清单见 [动作清单](../protocol/actions.md)。

### 3.2 五种接入方式

| 方式 | 谁做服务端 | 配置字段 | 适用 |
| --- | --- | --- | --- |
| HTTP | Haizakura | `httpServers` | 主动调用 API |
| 正向 WebSocket | Haizakura | `wsServers` | 双向实时（推荐） |
| 反向 WebSocket | **你的程序** | `wsClients` | 内网穿透 / 框架主连 |
| HTTP POST | **你的程序** | `httpClients` | 只收事件（webhook） |
| SSE | Haizakura | `httpServers.enableSse` | 只收事件（HTTP 流） |

详见 [OneBot v11 接入](../protocol/onebot11.md)。

### 3.3 WebUI 控制台

【确证】`hono` + `@hono/node-server` 后端，React 前端（**前端无源码，仅有构建产物**）。

| 能力 | 说明 |
| --- | --- |
| 可视化配置 | OneBot 网络、状态指令、全局设置，**改完热加载** |
| 多账号管理 | `/api/qq-list`、每账号独立配置 |
| 进程 / hook 管理 | 手动 load / unload / refresh hook |
| 实时日志 | 日志流 + SSE 推送 + 级别切换 + 导出 |
| 状态监控 | 连接数、进程列表、存储占用 |
| 调试工具 | ★ 动作调试面板（**等于远程执行任意动作**，见风险章） |
| 安全 | scrypt 密码哈希 + **TOTP 两步验证** + 密码强度检查 |
| 通知 | 账号上线 / 掉线通知（webhook / 邮件 SMTP） |
| 系统维护 | 备份导出 / 导入、TLS 证书、存储清理 |

详见 [WebUI 概览](../webui/overview.md)。

### 3.4 其他

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 多账号 | ✅ | 每账号独立配置 + 独立 SQLite 库 |
| 消息历史持久化 | ✅ | SQLite（`messages.db`） |
| 贴表情记录 | ✅ | SQLite（`reactions.db`） |
| 历史消息回填 | ✅ | `historySync`（**默认关闭，仅启动时读**） |
| 账号上线/掉线通知 | ✅ | webhook / 邮件 |
| 自动更新 | ⚠️ | **上游已删库，默认源必然 404 —— 接手第一必改项** |
| MCP | ❌ | 原版有 MCP 包，但**还原工程中不含**，见下 |

> **⚠️ 关于 MCP**：原始发行版的构建脚本里残留了 `@snowluma/mcp` 包名，
> 且部分动作描述提到「MCP 下载目录」。但**还原出的 8 个包中没有任何 MCP 实现**
> （`packages/` 下只有 `bridge` / `common` / `core` / `onebot` / `protocol` / `proton` / `sqlite` / `websocket`）。
> **结论：当前版本不提供 MCP 服务，请勿依赖。**

---

## 4. 与 LLBot 的对比

两者都是「把 QQ 能力通过标准协议暴露」的框架，但路线完全不同。

| 维度 | **Haizakura（本项目）** | **LLBot（幸运莉莉娅）** |
| --- | --- | --- |
| 底层路线 | **寄生官方 QQ 已登录会话**（注入 hook） | 基于 NTQQ 的独立框架 |
| 平台 | **仅 Linux**（Docker 为主） | Windows / macOS / Linux |
| 安装方式 | Docker（另有源码构建） | Desktop / CLI / Docker |
| **协议** | **OneBot v11** | **OneBot 11 + Milky + Satori** |
| 动作数 | 222 | 见其官方 API 站 |
| 配置方式 | **WebUI + JSON 文件** | WebUI / GUI（强调「无需编辑配置文件」） |
| 登录 | **必须先用官方 QQ 完成登录**（noVNC） | 内置登录流程（含无头快速登录） |
| 卖点 | 从服务端看流量即官方客户端；NT QQ 专有能力多 | 协议多、跨平台、开箱即用 |
| 通用性 | 低（强依赖 QQ 版本） | 高 |

**诚实结论**：

- 你要**跨平台、多协议、开箱即用** → LLBot 更合适
- 你要**最大程度复用官方客户端行为**、需要 NT QQ 专有能力 → Haizakura 有价值
- 但请记住：**Haizakura 的风险与维护成本都更高**（QQ 版本耦合 + 上游删库）

---

## 5. 已知限制与风险

### 5.1 技术限制

| 限制 | 说明 | 缓解 |
| --- | --- | --- |
| **QQ 版本强耦合** | hook 依赖 `wrapper.node` 的 RTTI / vtable 布局 | **钉死版本，不要自动升级**；升级前用 `dump-vtable.py` diff |
| **仅 Linux** | 注入器只有 `linux-arm64` / 依赖 `ptrace` | 需要 Linux 宿主机 + `CAP_SYS_PTRACE` |
| **WebUI 前端无源码** | 只有构建产物，不能改组件 | 只能改配置（主题 / CSS / 布局） |
| **上游已删库** | 无法拉取更新 | 本工程已完整还原，可自行维护 |
| **原生组件是黑箱** | `.so` 被 strip，仅 6 个导出 | 行为可观察，逻辑不可读 |

### 5.2 安全风险

| 风险 | 说明 | 建议 |
| --- | --- | --- |
| **`/api/debug/invoke`** | 等于**远程执行任意动作**（含 `send_packet` 发送原始 SSO 包） | **生产环境必须关闭或加鉴权**；不要暴露到公网 |
| **WebUI 可能绑到 `0.0.0.0`** | 源码默认是 `127.0.0.1`，但**实测某实例被改成了 `0.0.0.0`**（对外暴露） | 确认 `webuiHost`；如需外网走反代（配 `trustProxy`） |
| **OneBot 监听可能绑到 `0.0.0.0`** | 源码默认 `host: "127.0.0.1"`，实测某实例为 `0.0.0.0` | 令牌必须 ≥16 字符且随机（源码会校验）；非本机 IP 保存时**不许留空令牌** |
| **noVNC 暴露** | `6081` 端口可直接操作 QQ | 不要暴露公网；VNC 密码在容器内 |
| **通知 Webhook** | 会把账号状态外发到你填的地址 | 确认地址可信 |

### 5.3 账号风险

**【确证】** 原发行包 EULA 第 3.6 条原文：

> 您理解，使用非官方协议工具接入第三方平台**可能违反该平台条款并导致账号风险**，
> 您**自愿承担**该等风险。

**用前请自己判断**。不建议在主力账号上使用。

### 5.4 许可与法律

**【确证】** 原发行包 `EULA.md`（v1.1，生效 2026-07-21）关键条款：

| 条款 | 内容 |
| --- | --- |
| 2.1 | 源代码依 **SnowLuma Source-Available Non-Commercial License**（源码可见非商业许可） |
| 2.2 | **任何商业使用、公开发布修改版或衍生版，均须事先取得著作权人书面授权** |
| 3.1 | 与腾讯 / QQ **无任何隶属、合作、授权或背书关系** |
| 3.4 | 按 **AS-IS** 提供，无任何担保 |
| 5.1 / 5.2 | `snowluma-*.node` / `*.so` 为**专有组件**，不属于源码许可范围，**不授予源代码权利** |
| 5.3 | **不得对专有组件逆向工程、反编译、反汇编**，不得绕过其授权/激活机制 |
| 5.4 | 不得复制、修改、单独再分发专有组件；**并入第三方安装包或 Docker 镜像、自动化脚本部署、商业用途均需书面授权** |
| 7 | 适用**中华人民共和国大陆地区法律** |

> **⚠️ 重要矛盾声明**：本项目的分析工作**已经对专有组件做过逆向分析**
> （这是还原工程的事实基础）。EULA 5.3 条明确禁止此类行为。
> 本套文档**如实记录**这一事实与相关条款，**不暗示该行为已获授权或合法**。
>
> **后续贡献者请注意**：继续分发专有组件、或将其打包进镜像，
> 可能触及 EULA 5.4 条。**分发源码（本还原工程）与分发专有二进制是两件事**，
> 法律风险不同，请自行评估。

**【待确认】** 本项目以何种许可分发「还原后的源码」，尚无定论 ——
原 `LICENSE` 文件**并未包含在发行包或还原工程中**（只有 `EULA.md`），
`package.json` 里写的是 `"license": "SEE LICENSE IN LICENSE"` 但该文件缺失。
**在明确之前，请勿对外发布衍生版本。**

---

## 6. 版本基线（接手必记）

**【实测】** 本文档所有结论基于以下版本：

```
QQ 客户端              3.2.32-52194 (Linux arm64)
wrapper.node           144,561,472 字节
                       md5     adeb40af26d859d41fcdb21bf38d9eb5
                       build-id 89c36b520f97c88081a9453bd6abb70c3452f156
Haizakura runtime      2.4.0
hook stub              snowluma-linux-hook-stub/0.2.0
Node                   24.22.2
容器镜像               motricseven7/snowluma:latest
```

原生产物 sha256 见 `archive/SHA256SUMS.txt`。

> **接手第一天建议做**：
> ```bash
> md5sum wrapper.node                     # 应为 adeb40af26d859d41fcdb21bf38d9eb5
> grep -c unresolved /app/data/logs/*.log  # 应为 0（0 = hook 健康）
> ```

---

## 7. 下一步

- **想赶紧跑起来** → [快速开始](quick-start.md)
- **卡在登录** → [登录说明](login.md)
- **要改配置** → [完整配置说明](configuration.md)
- **出问题了** → [常见问题](faq.md) / [故障排查](../advanced/troubleshooting.md)
- **想改代码** → [参与开发](../dev/contributing.md)
