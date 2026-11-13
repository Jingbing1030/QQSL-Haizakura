# 登录说明

> **一句话**：Haizakura **没有自己的登录流程**。你必须通过 **noVNC**
> 远程操作容器里的**官方 QQ 客户端**完成登录，Haizakura 才能开始工作。

---

## 1. 为什么是这样

这是 Haizakura 的架构决定的，**不是缺陷**：

| 你可能期望的 | 实际情况 |
| --- | --- |
| `POST /api/login` 传账号密码 | ❌ **不存在** |
| 二维码登录 API | ❌ **不存在**（源码里没有任何 QR 登录实现） |
| 内置无头快速登录 | ❌ 不支持 |

**原因**：Haizakura 寄生在**官方 QQ 已经建立的 MSF 会话**上。
它不实现登录协议、不加密密码、不处理验证码 —— 这些**全部由腾讯自己的
QQ 客户端负责**。所以它必须让你有机会操作那个真实的 QQ 窗口。

【确证】源码里保留的原始提示串（来自被注入的 `.so`）：

```
"not logged in: wait until QQ completes login"
"logged-in MSF service instance is missing"
"QQ is not ready. Please finish signing in and try again."
```

**这三句话出现的时机**：你调用 OneBot 动作但 QQ 还没登录。

---

## 2. 容器里的远程桌面栈

【实测】entrypoint 启动的图形栈（`/root/start.sh`）：

```
Xvfb :1 (1920x1080x24)          ← 虚拟显示器
    ↓
fluxbox                         ← 窗口管理器
    ↓
x11vnc :5900                    ← VNC 服务（密码 /root/.vnc/passwd）
    ↓
noVNC websockify :6081          ← 把 VNC 转成浏览器可访问的 WebSocket
    ↓
你打开 http://<IP>:6181          ← 在浏览器里看到 QQ 窗口
```

| 组件 | 端口 | 说明 |
| --- | ---: | --- |
| **noVNC** | `6081` | ✅ **用这个**（浏览器直接访问） |
| x11vnc | `5900` | 原始 VNC，可用任意 VNC 客户端连 |
| Xvfb | `:1` | 虚拟屏，分辨率由 `SNOWLUMA_SCREEN` 控制（默认 `1920x1080x24`） |

---

## 3. 登录步骤

### 3.1 找到 VNC 密码

**方式一：看容器日志**（首次启动会打印）

```bash
docker logs haizakura 2>&1 | grep -i "远程桌面密码\|remote desktop password"
```

输出形如：

```
远程桌面密码: <15字节随机串>
remote desktop password: <15字节随机串>
```

**方式二：读文件**（注意是 root-only）

```bash
docker exec haizakura cat /app/data/config/vnc-password
```

> ⚠️ **日志只在「密码是新生成」时打印**。如果密码已存在，重启不会再打印 ——
> 此时用方式二，或你自己设过的 `VNC_PASSWD`。

### 3.2 打开 noVNC

浏览器访问：

```
http://<你的服务器IP>:6181
```

> ⚠️ **常见坑：浏览器把 http 强制升级成 https。**
> 如果你的浏览器之前访问过 https 站点，**HSTS** 可能把 `http://ip:6181`
> 自动改成 `https://ip:6181`，导致连接失败。
>
> **解决**：用**纯 IP**（不要域名）、换浏览器、或清掉该 IP 的 HSTS 记录。

点击「连接」，输入 §3.1 的密码。

### 3.3 在 noVNC 里登录 QQ

看到 QQ 登录窗口后：

1. 选择 **扫码登录** 或 **账号密码登录**（QQ 自己的界面，随版本变化）
2. **手机 QQ 扫码**是最稳的方式
3. 如有设备验证 / 短信验证，按 QQ 提示完成
4. 等到 QQ **进入主界面**（能看到好友列表）

> 💡 **符号链接提示**：窗口可能很小或分辨率不匹配。可以调整
> `SNOWLUMA_SCREEN`（如 `1440x900x24`）后重建容器 ——
> 但注意**重建/重启会丢登录态**（见 §5）。

### 3.4 确认 Haizakura 已识别账号

**等几十秒**（QQ 登录后 Haizakura 需要发现账号并建立会话）。

**方式一：WebUI**

打开 `http://<IP>:5199`，在「账号」页应看到你的 QQ 号。

**方式二：API**

```bash
curl -s http://127.0.0.1:3010/get_login_info
```

**成功**：

```json
{
  "status": "ok",
  "retcode": 0,
  "data": { "user_id": 123456789, "nickname": "你的昵称" }
}
```

**失败**（说明 QQ 还没登录完）：

```json
{ "status": "failed", "retcode": 1, "wording": "QQ is not ready. Please finish signing in and try again." }
```

**方式三：状态指令**

给机器人发一条消息（私聊或群里）：

```
#Haizakura
```

正常会回复：

```
Haizakura 状态
版本: 2.4.0
平台: linux-x64
运行时长: 3小时 12分钟
```

> 触发词可配置，见 [完整配置说明](configuration.md)。
> 本实例已被改为 `#hz`。

---

## 4. 多账号

### 4.1 架构

Haizakura **原生支持多账号**，每个账号是独立的一套：

| 维度 | 隔离方式 | 实测路径 |
| --- | --- | --- |
| 配置 | 每账号一个文件 | `config/onebot_<uin>.json`（`600`） |
| 消息库 | 每账号一个目录 | `data/<uin>/messages.db` |
| 贴表情库 | 同上 | `data/<uin>/reactions.db` |
| 网络适配器 | 每账号独立 | 各自的 `httpServers` / `wsServers` / … |

**共用**的（全局级）：

| 文件 | 说明 |
| --- | --- |
| `config/onebot.json` | 全局 OneBot 配置（被每账号继承，除非该账号是 `snapshot` 模式） |
| `config/snowluma.json` | `rkey.fallbackServers` / `musicSignUrl` / `videoUploadConcurrency` |
| `config/notifications.json` | 通知渠道定义 |
| `config/runtime.json` | WebUI / 日志 / hook 开关等运行时设置 |

### 4.2 容器内起多个 QQ

【确证】用 `SNOWLUMA_EXTRA_QQ_HOMES` 指定额外的 QQ HOME（**逗号分隔**）：

```bash
docker run ... \
  -e SNOWLUMA_EXTRA_QQ_HOMES="/app/qq2,/app/qq3" \
  motricseven7/snowluma:latest
```

**entrypoint 的行为**（`/root/start.sh`）：

| 规则 | 说明 |
| --- | --- |
| 路径必须在 `/app/` 下 | 否则**跳过并打印警告** |
| 字符限制 | 只允许 `A-Za-z0-9_@%+=:,./-`，否则跳过 |
| 自动建目录 + 改属主 | `mkdir -p` + `chown snowluma` |
| **错开启动** | 第 N 个实例 `sleep (N-1)*10` 秒，避免同时抢资源 |
| 独立 supervisor 程序 | `qq-extra-1`、`qq-extra-2`… |

**【实测】** 日志里会有：

```
Configured 2 extra QQ instance(s): /app/qq2,/app/qq3
```

**然后**：每个 QQ 实例都有自己的窗口吗？

> ⚠️ **【待确认】** 多个 QQ 实例共用同一个 Xvfb `:1` 显示。
> 它们会**在同一个 noVNC 桌面里各自开一个窗口**，用 fluxbox 切换。
> 这一点我们**未实测**多实例场景，请以实际行为为准。

### 4.3 账号是如何被发现的

【确证】这部分设计相当巧妙，**不需要 root**：

```
① 定位 QQ 的数据库文件
   Linux: ~/.config/QQ/<uid-hash>/nt_db/nt_msg.db
   注意 accountDirName(uid) 做了目录名映射

② 找出「谁持有这个库」
   Linux: 读 /proc/locks，按 <dev>:<inode> 匹配
          → 读 /proc/<pid>/comm → 用 isQqProcessName() 过滤（"qq" / "QQ.exe"）
   Windows: 走 addon 的 getFileHoldersAsync()（内核句柄枚举）
```

**从被 QQ 独占锁住的数据库文件反查进程** —— 这比枚举进程名可靠得多。

### 4.4 登录状态的维持

| 机制 | 常量 / 值 | 说明 |
| --- | --- | --- |
| 登录协商轮询 | `LOGIN_RECONCILE_INTERVAL_MS = 3000` | 每 3 秒对齐一次 |
| 身份观察 | `LOGIN_IDENTITY_OBSERVE_INTERVAL_MS = 30000` | 每 30 秒观察 |
| 身份上报 | `op=17` 帧 | `sendAckOnly(17, BigInt(uin), …)` |

> **源码注释原文**：「This does not change login state;
> readiness still requires peer confirmation.」
> 意即：本地上报身份**不等于**登录成功，还要等对端确认。

【确证】QQ 数据目录包含：

```
/app/.config/QQ/auth/login.enc          ← 登录凭据（加密）
/app/.config/QQ/global/nt_db/login.db   ← 登录数据库
```

---

## 5. ⚠️ 重大风险：重启会丢登录态

**【实测】这是我们真实踩过的坑，导致生产 bot 停摆 8 小时。**

### 5.1 现象

**重启容器后，QQ 需要重新扫码登录。**

原因：`/app/.config/QQ/auth/login.enc` 里的 `loginList` 会被清空。

### 5.2 后果

```
重启容器
   ↓
QQ 登录态丢失
   ↓
Haizakura 拿不到 MSF 会话
   ↓
所有 OneBot 动作返回 "not logged in"
   ↓
⛔ bot 完全不可用，直到有人重新扫码
```

**而扫码需要人工介入**（你得打开 noVNC 用手机扫）——
**如果发生在半夜，就是 8 小时停摆。**

### 5.3 怎么办

| 原则 | 做法 |
| --- | --- |
| **非必要不重启** | 改配置优先走 **WebUI / API 热加载**，不要重启容器 |
| 必须重启时 | **安排有人能扫码的时间窗口** |
| 重启前 | 确认你手边有手机 QQ 可以扫码 |
| 长期方案 | 【待确认】研究登录态持久化的稳定性；考虑避免 `docker restart` 而用不重建容器的方式 |

> ⚠️ **注意**：`docker restart` 和 `docker stop/start` 都可能触发。
> 连 **`--restart unless-stopped` 策略下的宿主机重启**也会。
> 如果你的业务不能接受停摆，**必须把「重启后需重新扫码」当成既定事实来设计预案**。

### 5.4 哪些改动是热加载的

| 改动 | 是否热加载 | 怎么做 |
| --- | --- | --- |
| OneBot 网络配置 | ✅ **热加载** | `POST /api/config/:uin`（WebUI 保存即可） |
| `statusCommand` | ✅ **热加载** | 同上 |
| `notifications` | ✅ **热加载** | `POST /api/notifications/config` |
| `snowluma.json` 全局设置 | ✅ 热加载 | `POST /api/global-config` |
| `ui.json` 外观 | ✅ 热加载 | `POST /api/ui` |
| **`historySync.enabled`** | ❌ **仅启动时读** | ⚠️ 需重启 → **会丢登录态** |
| **`runtime.json` 大部分** | ⚠️ 【待确认】 | 从代码看是启动时读；`updateRuntimeConfig` 只写盘 |
| **`.env` / 容器环境变量** | ❌ 需重建容器 | ⚠️ **会丢登录态** |
| **代码（`index.mjs`）** | ❌ 需重启 | ⚠️ **会丢登录态** |
| 日志级别 | ✅ 热加载 | `POST /api/logs/level` |
| hook 加载/卸载 | ✅ 热加载 | `POST /api/processes/:pid/load` / `unload` |

> 💡 **结论**：**绝大多数日常配置改动都不需要重启**。
> 只有 `historySync` 和容器级改动需要 —— 而那些恰好是最痛的。

---

## 6. 登录相关的故障排查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| noVNC 页面打不开 | HSTS 强制 https / 端口没映射 | 用纯 IP；确认 `-p 6181:6081` |
| noVNC 连上但黑屏 | Xvfb 还没起来 | 等几秒；看日志有无 `Timed out waiting for Xvfb` |
| VNC 密码不对 | 看的是旧日志 | 读 `/app/data/config/vnc-password` |
| QQ 窗口出现但登录失败 | 腾讯风控 / 需要设备验证 | 在 noVNC 里按 QQ 提示完成验证 |
| QQ 登录成功但 Haizakura 不认 | 还在协商（最长 30 秒） | 等 30 秒再试；看日志 |
| **重启后要重新扫码** | **登录态丢失（已知问题）** | 见 §5 |
| 动作全返回 `not logged in` | QQ 没登录 / 登录态丢了 | 重新登录 |
| hook 装不上 | 缺 `SYS_PTRACE` / seccomp | 见 [快速开始 §2.3](quick-start.md) |
| 日志里有 `unresolved` | RTTI 解析失败（QQ 版本变了？） | 见 [故障排查](../advanced/troubleshooting.md) |

### 6.1 诊断命令

```bash
# 图形栈是否在跑
docker exec haizakura ps -eo pid,comm | grep -E 'Xvfb|x11vnc|websockify|qq '

# 端口监听
docker exec haizakura ss -lntp | grep -E '5099|3000|3001|5900|6081'

# 登录态文件
docker exec haizakura ls -la /app/.config/QQ/auth/

# hook 健康度（0 = 健康）
docker exec haizakura grep -c unresolved /app/data/logs/*.log

# 账号是否被识别
curl -s -H "Authorization: Bearer <你的令牌>" http://127.0.0.1:3010/get_login_info
```

### 6.2 「QQ 已登录但动作失败」的检查顺序

```
① 等 30 秒（登录协商需要时间）
      ↓
② GET /get_login_info 看返回什么
      ↓
③ 返回 "QQ is not ready" → QQ 界面还没进主界面，回 noVNC 看
      ↓
④ 返回 "logged-in MSF service instance is missing" → hook 没装成功
      → 检查 SYS_PTRACE/seccomp → 检查日志 unresolved
      ↓
⑤ 返回 retcode 0 但某个具体动作失败 → 那是动作本身的问题，
      不是登录问题（见 ../protocol/actions.md）
```

---

## 7. 安全提醒

| 风险 | 说明 | 建议 |
| --- | --- | --- |
| **noVNC 暴露 = 完全控制 QQ** | 能连上就能操作你的 QQ | **不要暴露公网**；用防火墙/内网/VPN |
| VNC 密码是**唯一**屏障 | 无二次验证 | 用强密码（`VNC_PASSWD` 显式指定） |
| 登录凭据在卷里 | `login.enc` 是敏感文件 | 备份卷时注意加密 |
| WebUI 默认可能对外 | 见 [配置说明](configuration.md) | 改 `webuiHost` 为 `127.0.0.1` + 反代 |

**推荐做法**：

```bash
# 只在需要登录时临时暴露 noVNC 端口，登录完就关掉
docker run ... -p 6181:6081 ...   # 登录期间
# 登录完成后，重建容器时去掉 -p 6181:6081
```

> ⚠️ 但重建容器**会丢登录态**（§5）—— 所以要权衡。
> 更实际的做法是**用防火墙限制来源 IP**，而不是去掉端口映射。
