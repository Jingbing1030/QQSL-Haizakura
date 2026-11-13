# 快速开始

> 本文带你从零把 Haizakura 跑起来。**推荐用 Docker**。
>
> ⚠️ **先读**：本文的部署命令是**从运行中的容器反推**的（`docker inspect` + 容器内
> `start.sh`），**未经官方文档验证**。其中 `--cap-add` 与 `--security-opt`
> 两项**缺一不可**，理由见 §2.3。

---

## 1. 前置条件

### 1.1 硬件与系统

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| 架构 | **Linux x86_64 / arm64** | 原生组件按架构分发（已验证 arm64） |
| 内存 | **建议 ≥ 2 GB** | 要同时跑 Electron QQ + Xvfb + Node |
| 磁盘 | **建议 ≥ 10 GB** | QQ 客户端 + SQLite 消息库会持续增长 |
| Docker | 任意近期版本 | 需要能加 `CAP_SYS_PTRACE` |
| 内核 | 允许 `ptrace` | 部分加固内核需额外放行 |

> ⚠️ **仅 Linux**。注入器依赖 `ptrace` 与 `/proc`，**不支持 Windows / macOS 原生**。
> macOS 上若用 Docker Desktop，QQ 可能起不来 —— LLBot 社区的经验是改用 OrbStack。

### 1.2 端口规划

【实测】本实例的端口映射（`docker inspect`）：

| 容器内 | 用途 | 建议映射到 | 是否必须 |
| ---: | --- | ---: | --- |
| `3000` | OneBot HTTP | `3010` | ✅ 用 HTTP 接入时必需 |
| `3001` | OneBot WebSocket | `3011` | ✅ 用 WS 接入时必需 |
| `5099` | **WebUI** | `5199` | ✅ 必需 |
| `6081` | **noVNC**（登录用） | `6181` | ✅ 首次登录必需 |
| `5900` | 原始 VNC | 不映射 | ❌ 走 noVNC 即可 |

> 💡 容器内端口（`3000` / `3001` / `5099`）是 Haizakura 的默认值，
> 宿主机端口随便选。**下文一律用上表右列。**

---

## 2. 用 Docker 部署

### 2.1 创建数据卷

**必须用卷持久化**，否则重建容器会丢配置与登录态：

```bash
docker volume create hz_qq-client-config   # → /app/.config        （QQ 配置、登录态）
docker volume create hz_qq-gateway-data    # → /app/data           （Haizakura 配置/数据库/日志）
docker volume create hz_qq-client-data     # → /app/.local/share   （QQ 数据）
```

【实测】三个卷的挂载点：

| 卷 | 容器路径 | 存什么 |
| --- | --- | --- |
| `hz_qq-client-config` | `/app/.config` | QQ 自身配置，**含登录凭据** |
| `hz_qq-gateway-data` | `/app/data` | Haizakura 的 `config/` `data/` `logs/` |
| `hz_qq-client-data` | `/app/.local/share` | QQ 用户数据 |

### 2.2 启动容器

```bash
docker run -d \
  --name haizakura \
  --restart unless-stopped \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  -p 3010:3000 \
  -p 3011:3001 \
  -p 5199:5099 \
  -p 6181:6081 \
  -v hz_qq-client-config:/app/.config \
  -v hz_qq-gateway-data:/app/data \
  -v hz_qq-client-data:/app/.local/share \
  -e TZ=Asia/Shanghai \
  -e SNOWLUMA_WEBUI_PORT=5099 \
  -e SNOWLUMA_HOOK_AUTOLOAD=1 \
  -e SNOWLUMA_QQ_FLAGS="--disable-gpu --disable-software-rasterizer --disable-gpu-compositing" \
  motricseven7/snowluma:latest
```

### 2.3 ⚠️ 为什么必须加 `cap-add` 和 `seccomp`

这两项**不是可选项**：

| 选项 | 缺了会怎样 | 原因 |
| --- | --- | --- |
| `--cap-add SYS_PTRACE` | **hook 装不上** | 注入器需要 `ptrace` + `process_vm_writev` 附加到 QQ 进程 |
| `--security-opt seccomp=unconfined` | **容器起不来** | 默认 seccomp 会拦截 `ptrace` |

**【实测】故障复现**（缺少时）：

```
ExitCode = 126
日志: /root/start.sh: line 161: /usr/local/bin/node: Operation not permitted
```

补上这两项后**一次启动成功**。

> 📌 **替代方案**：`--privileged` 也能work，但权限过大，**不推荐**。
> 用最小权限（只加 `SYS_PTRACE`）更安全。

### 2.4 确认启动成功

```bash
docker logs -f haizakura
```

**关键日志线索**：

| 日志 | 含义 |
| --- | --- |
| `远程桌面密码: xxxxxxxx` | VNC 密码已生成（**首次启动才有**），记下来 |
| `Configured N extra QQ instance(s)` | 配置了多 QQ 实例（见 §4） |
| `Removing stale ... mojo.*.*.sock` | 清理上次残留的 socket（正常） |
| 无 `unresolved` 字样 | ✅ hook 健康 |
| 出现 `unresolved` | ❌ RTTI 链解析失败，见 [故障排查](../advanced/troubleshooting.md) |

**验证服务已监听**（宿主机上执行）：

```bash
curl -s -o /dev/null -w 'WebUI  %{http_code}\n' http://127.0.0.1:5199/
curl -s -o /dev/null -w 'OneBot %{http_code}\n' http://127.0.0.1:3010/get_login_info
```

【实测】对应端口上的真实监听进程：

```
0.0.0.0:5900   x11vnc
0.0.0.0:6081   websockify（noVNC）
0.0.0.0:5099   MainThread（Haizakura runtime，WebUI）
0.0.0.0:3000   MainThread（OneBot HTTP）
0.0.0.0:3001   MainThread（OneBot WS）
127.0.0.1:9210 qq
```

---

## 3. 首次启动：三个密码

Haizakura 容器里有**三个不同的密码**，别搞混：

| 密码 | 用途 | 初始值从哪来 | 存放位置 |
| --- | --- | --- | --- |
| **VNC 密码** | 连 noVNC 操作 QQ | **容器日志里打印**（随机生成） | `/app/data/config/vnc-password`（`600` root） |
| **WebUI 密码** | 登录管理控制台 | **容器日志里打印** / 或环境变量注入 | `config/webui.json`（scrypt 哈希） |
| QQ 账号密码 | 登录 QQ 自己 | 你自己的 | QQ 自己管理 |

> ✅ **容器不会自动生成并打印 WebUI 初始密码？**
> 【实测】本实例的 WebUI 是通过 `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD`
> 环境变量注入的（源码 `auth.ts:14` 读取，要求 ≥8 字符）。
> 若未注入，首次访问 WebUI 会引导设置密码（`mustChangePassword` 机制）。
>
> **建议**：用 `-e SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD='<你的强密码>'` 显式注入。
> 密码强度要求见 [WebUI 概览](../webui/overview.md)。

### 3.1 容器启动时自动做了什么

【实测】`/root/start.sh`（368 行）的关键行为 —— 理解这些能避免很多困惑：

| 行为 | 说明 |
| --- | --- |
| **写 `runtime.json` 的 `webuiPort`** | 用 `SNOWLUMA_WEBUI_PORT` **覆盖**（每次启动都写） |
| **首次把 `webuiHost` 设为 `0.0.0.0`** | 仅当该键缺失或为空时；**之后不再覆盖**你的改动 |
| **冻结 QQ 版本** | 把 `qqpatch.gtimg.cn` 写进 `/etc/hosts` → `0.0.0.0`，**阻止静默热更新** |
| **清理残留 socket** | 删除 `/tmp/runtime-<uid>/mojo.*.*.sock`，防 PID 复用造成假 hook |
| **首个启动播种 `onebot.json`** | 生成 `http-default` / `ws-default`，**令牌随机 32 字节** |
| **把 loopback 的 host 改成对外 host** | 只改 `host` 是 `127.0.0.1` / `localhost` / `::1` / 空 的适配器 |
| **生成 VNC 密码** | 若未提供 `VNC_PASSWD`，随机生成 15 字节 base64url 并打印 |
| **修正文件属主** | 应用 JSON 给 `snowluma` 用户；`vnc-password` 保持 root-only |
| **启动 Xvfb / fluxbox / x11vnc / noVNC** | 最后 `exec supervisord`（管理 `qq` 与 `snowluma`） |

> 🔑 **版本冻结是个重要设计**：QQ 有两条更新路径 —— 手动「立即更新」对话框
> （无头环境永远不会触发）和**静默热更新**（`hotUpdateApi` → `qqpatch.gtimg.cn`）。
> 只有后者能在你不知情的情况下替换 QQ 文件、破坏版本钉死的 hook。
> 所以 entrypoint 把那个域名黑洞掉。

---

## 4. 环境变量（容器入口层）

以下变量由**容器 entrypoint** 消费（**不在 12 MB 的 bundle 里**，
因此**未经源码级验证**，来源为容器内 `/root/start.sh`）。它们与
[配置说明](configuration.md)里的 36 个 `SNOWLUMA_*` **不是同一批**。

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `SNOWLUMA_ONEBOT_HOST` | `0.0.0.0` | 播种 `onebot.json` 时用的 host（**只覆盖 loopback 的适配器**） |
| `SNOWLUMA_DATA` | `/app/data` | 数据根目录 |
| `SNOWLUMA_HOME` | `/app/runtime` | 运行时根目录 |
| `SNOWLUMA_UID` / `SNOWLUMA_GID` | `1000` / `1000` | 容器内 `snowluma` 用户的 uid/gid |
| `SNOWLUMA_WEBUI_PORT` | `5099` | **写入 `runtime.json` 的 `webuiPort`** |
| `SNOWLUMA_LOG_LEVEL` | `info` | 透传给应用 |
| `SNOWLUMA_HOOK_AUTOLOAD` | **`1`** | **透传给应用**（容器里默认开启自动注入） |
| `SNOWLUMA_QQ_FLAGS` | `--disable-gpu --disable-software-rasterizer --disable-gpu-compositing` | 传给 QQ 的命令行参数 |
| `SNOWLUMA_SCREEN` | `1920x1080x24` | Xvfb 分辨率 |
| `SNOWLUMA_EXTRA_QQ_HOMES` | 空 | **多 QQ 实例**：逗号分隔的 HOME 路径（**必须在 `/app/` 下**），每个实例错开 10 秒启动 |
| `SNOWLUMA_HOOK_RUNTIME_DIR` | `/tmp/runtime-<uid>` | socket 目录 |
| `VNC_PASSWD` | 空（则随机生成） | 指定 VNC 密码；默认值 `vncpasswd` 会被视为「未设置」 |
| `TZ` | 容器默认 | 时区，**建议显式设 `Asia/Shanghai`** |

---

## 5. 数据目录结构

【实测】`/app/data` 下的布局：

```
/app/data/
├── config/                       配置（权限关键）
│   ├── onebot.json               全局 OneBot 网络配置
│   ├── onebot_<uin>.json         每账号配置（600）
│   ├── runtime.json              运行时配置
│   ├── snowluma.json             全局设置（rkey / musicSignUrl / 上传并发）
│   ├── notifications.json        通知渠道（600）
│   ├── webui.json                WebUI 凭据（600，scrypt 哈希）
│   ├── ui.json                   WebUI 外观与布局
│   ├── consent.json              EULA / 隐私政策接受记录
│   ├── machine-id                机器标识（entrypoint 持久化）
│   └── vnc-password              VNC 密码（600，**root-only**）
├── data/                         按账号分目录
│   ├── <uin>/
│   │   ├── messages.db           消息历史（含 WAL）
│   │   └── reactions.db          贴表情记录
│   └── sys-face-catalog.json     系统表情目录
└── logs/
    └── snowluma-YYYY-MM-DD.log   按天滚动；超限时 .1 .2 后缀
```

> **备份建议**：整个 `hz_qq-gateway-data` 卷 + `hz_qq-client-config` 卷
> （后者含登录态，**注意这是敏感数据**）。
> WebUI 也提供 `/api/system/backup/export`。

---

## 6. 接下来做什么

顺序很重要 —— **必须先登录 QQ，Haizakura 才能工作**：

```
① 启动容器  ✅（你刚做完）
     ↓
② 打开 noVNC，用官方 QQ 扫码登录          → [登录说明](login.md)
     ↓
③ 打开 WebUI，确认账号已识别
     ↓
④ 配置 OneBot 网络（改令牌 / 加反向 WS）   → [完整配置说明](configuration.md)
     ↓
⑤ 对接你的 bot 框架                       → [OneBot v11 接入](../protocol/onebot11.md)
     ↓
⑥ 用状态指令验证                          → 给它发 #Haizakura
```

### 验证清单

| 检查 | 命令 / 操作 | 期望 |
| --- | --- | --- |
| 容器在跑 | `docker ps` | `Up` |
| WebUI 可达 | 浏览器开 `:5199` | 登录页 |
| noVNC 可达 | 浏览器开 `:6181` | 看到 QQ 窗口 |
| QQ 已登录 | noVNC 里看 QQ 界面 | 已进主界面 |
| 账号被识别 | WebUI「账号」页 / `GET /api/qq-list` | 出现你的 QQ 号 |
| OneBot 通 | `curl http://127.0.0.1:3010/get_login_info` | 返回 `user_id` / `nickname` |
| hook 健康 | `docker exec haizakura grep -c unresolved /app/data/logs/*.log` | `0` |

> ⚠️ **`get_login_info` 返回失败是正常的 —— 如果你还没在 noVNC 里登录 QQ。**
> 这就是 §2 那句话的含义：`"not logged in: wait until QQ completes login"`。

---

## 7. 从源码构建（可选）

如果你不想用预构建镜像：

```bash
git clone <本还原工程>
cd restored
pnpm install
pnpm run build          # 产出 dist/index.mjs
```

详见 [从源码构建](../dev/build.md)。

---

## 8. 常见坑（部署阶段）

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| **`ExitCode 126` + `Operation not permitted`** | 缺 `SYS_PTRACE` 或 seccomp 限制 | 加上 §2.2 的两个选项 |
| 容器起来但 hook 没装 | 同上 / 内核禁 `ptrace` | 检查容器能力；`grep -c unresolved` 日志 |
| 改配置后重启，**登录态没了** | **重启会丢 QQ 登录态** | ⚠️ **非必要不重启**，见 [登录说明](login.md) |
| noVNC 打不开（浏览器强制 https） | HSTS 把 `http://ip:端口` 升级成 https | 用**纯 IP** 访问，或换浏览器 / 清 HSTS |
| OneBot 端口连不上 | 容器内绑 `127.0.0.1`，没对外 | 确认 `host` 是 `0.0.0.0`，且端口已 `-p` 映射 |
| 消息库越来越大 | 消息历史持久化 | WebUI「存储管理」清理，或调 `logMaxTotalMb` |

完整排查见 [故障排查](../advanced/troubleshooting.md)。
