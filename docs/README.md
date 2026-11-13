# Haizakura（原名 SnowLuma）文档

> **第三方 QQ 客户端运行时** —— 寄生在官方 QQ 进程内的 MSF 会话上，
> 把 QQ 的能力通过 **OneBot v11** 协议暴露出来。
>
> 本名 **SnowLuma**，现名 **Haizakura**。上游仓库已删除，本项目为**社区接手维护**。

---

## 这是什么

Haizakura 不是「另一个 QQ 协议实现」。它**不自己实现协议栈、不自己登录、不自己加密**，
而是把一段原生 hook 注入到**已经登录的官方 QQ 客户端进程**里，替换 C++ VTable，
借 QQ 自己的 MSF 会话收发消息。

```
官方 QQ（Electron，容器内独立进程）
    │  ← Haizakura 注入 hook（替换 C++ VTable）
    ├── MSFService        ← 发消息入口
    └── MSFCoreService    ← 收消息 / 包状态回调
            ↓
Haizakura runtime（独立 Node 进程）
    ├── OneBot v11（222 个动作）
    ├── WebUI（React 控制台，默认端口 5099）
    └── SQLite（配置 / 账号 / 消息 / 表情）
```

**为什么这样设计**：从腾讯服务端看，流量就是官方客户端发出的 —— 同一个 MSF 会话、
同样的加密、同样的设备指纹。

**代价**：与 QQ 版本**强耦合**。hook 依赖 `wrapper.node` 的类名与 vtable 布局。

---

## ⚠️ 先读这一段

| 事项 | 说明 |
| --- | --- |
| **非官方** | 与腾讯 / QQ 无任何隶属、合作、授权或背书关系 |
| **封号风险** | 使用非官方协议工具**可能违反平台条款并导致账号风险**，请自行评估 |
| **上游已删库** | 自动更新源 `github.com/SnowLuma/SnowLuma` 已失效，**接手后第一件事就是改源** |
| **版本强耦合** | 不要盲目升级 QQ 客户端，先在测试环境验证 hook 健康度 |
| **许可** | 源码可见**非商业**许可；原生组件（`snowluma-*.node` / `*.so`）为专有组件，**禁止逆向** |

> ⚠️ 我们**已对原发行包做过逆向分析**。原始 EULA 第 5.3 条明确禁止对专有组件
> 进行逆向工程。此历史事实在此**如实记录**，不代表本项目鼓励或授权此类行为。
> 详见 [兼容性与许可](advanced/compatibility.md)。

---

## 文档导航

### 🚀 入门（面向所有用户，不需要编程基础）

| 章节 | 内容 |
| --- | --- |
| [项目介绍](guide/introduction.md) | 它是什么、能做什么、工作原理、能力对比、免责声明 |
| [快速开始](guide/quick-start.md) | Docker 部署、端口映射、首次启动、验证清单 |
| [登录说明](guide/login.md) | 通过 noVNC 操作官方 QQ、多账号、**重启会丢登录态** |
| [**完整配置说明**](guide/configuration.md) | ★ 全部配置项逐字段说明 + 可直接复制的 JSON |
| [常见问题](guide/faq.md) | FAQ、我们踩过的坑、故障速查 |

### 📡 协议（面向开发者）

| 章节 | 内容 |
| --- | --- |
| [OneBot v11 接入](protocol/onebot11.md) | HTTP / 正向 WS / 反向 WS / HTTP POST / SSE 五种接入方式 |
| [动作清单](protocol/actions.md) | 222 个动作的完整清单与分类 |
| [Satori 协议](protocol/satori.md) | Satori 支持情况 |

### 🖥️ WebUI（面向使用者与二次开发）

| 章节 | 内容 |
| --- | --- |
| [WebUI 概览](webui/overview.md) | 控制台使用、配置管理、日志、调试 |
| [WebUI API](webui/api.md) | 后端 API 参考 |

### 🔧 进阶（面向技术用户与维护者）

| 章节 | 内容 |
| --- | --- |
| [架构与注入原理](advanced/architecture.md) | 注入链、RTTI 解析、进程模型 |
| [兼容性矩阵](advanced/compatibility.md) | QQ 版本、依赖、平台、许可 |
| [故障排查](advanced/troubleshooting.md) | 系统性排查流程 |

### 🛠️ 开发（面向贡献者）

| 章节 | 内容 |
| --- | --- |
| [从源码构建](dev/build.md) | 还原工程、构建流程 |
| [参与开发](dev/contributing.md) | 代码结构、改哪里、适配新 QQ 版本 |

---

## 三分钟快速开始

```bash
# 1. 准备三个数据卷
docker volume create hz_qq-client-config
docker volume create hz_qq-gateway-data
docker volume create hz_qq-client-data

# 2. 启动（⚠️ cap-add 与 seccomp 缺一不可，否则 hook 注入失败）
docker run -d --name haizakura \
  --restart unless-stopped \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  -p 3010:3000 -p 3011:3001 -p 5199:5099 -p 6181:6081 \
  -v hz_qq-client-config:/app/.config \
  -v hz_qq-gateway-data:/app/data \
  -v hz_qq-client-data:/app/.local/share \
  -e TZ=Asia/Shanghai \
  -e SNOWLUMA_HOOK_AUTOLOAD=1 \
  motricseven7/snowluma:latest

# 3. 看日志确认启动
docker logs -f haizakura
```

然后：

1. **打开 noVNC** → `http://<你的服务器IP>:6181` → 用官方 QQ 扫码登录
2. **打开 WebUI** → `http://<你的服务器IP>:5199` → 用日志里的初始密码登录
3. **对接你的 bot 框架** → OneBot HTTP `http://<IP>:3010` 或 WS `ws://<IP>:3011`

详细步骤见 [快速开始](guide/quick-start.md)。

---

## 关键数字（一页速查）

| 项目 | 值 | 来源 |
| --- | --- | --- |
| OneBot 动作数 | **222 个**（228 个可执行名，含 6 个别名） | `GET /api/debug/actions` 实测 |
| 动作分类 | 12 类 | 同上 |
| 网络适配器字段 | 37 个（4 种适配器） | `packages/onebot/src/config.ts` |
| 环境变量 | **36 个** `SNOWLUMA_*` | 源码穷举 |
| 配置文件 | 6 个（`onebot.json` / `onebot_<uin>.json` / `runtime.json` / `snowluma.json` / `notifications.json` / `webui.json`） | 源码 + 实测 |
| 默认 WebUI 端口 | 5099 | `common/src/runtime.ts` |
| 默认 OneBot HTTP / WS 端口 | 3000 / 3001 | `onebot/src/config.ts` |
| 默认状态指令 | `#Haizakura`（可改） | `config.ts:30` |
| 日志保留 | 7 天 / 单文件 50 MB / 总量 1024 MB | `log-file-transport.ts` |
| runtime 版本 | 2.4.0 | `release.json` |
| 已验证 QQ 版本 | 3.2.32-52194（Linux arm64） | 版本基线 |

---

## 文档约定

本套文档区分**证据等级**，请按需采信：

| 标记 | 含义 |
| --- | --- |
| **【确证】** | 有源码 / 命令输出直接支持，可复现 |
| **【实测】** | 在运行实例上验证过 |
| **【推断】** | 合理但未直接验证 |
| **【待确认】** | 明确的空白，请勿当作事实使用 |

版本基线（本文所有「实测」结论均基于此）：

```
QQ 客户端        3.2.32-52194 (Linux arm64)
wrapper.node     144,561,472 字节, md5 adeb40af26d859d41fcdb21bf38d9eb5
Haizakura runtime 2.4.0
Node             24.22.2
```

---

## 免责声明

本软件按「**现状（AS-IS）**」提供，不附带任何明示或默示担保。
在适用法律允许的最大范围内，对于因使用或无法使用本软件导致的任何损害
（**包括但不限于账号封禁或限制、数据丢失、利润或业务损失**），
作者与本项目维护者**概不承担责任**。

您须自行确保使用行为符合一切适用法律法规及所接入平台的规定
（包括《QQ 用户协议》及相关服务条款）。

**本项目仅供个人学习、研究与技术互操作等非商业用途。**
