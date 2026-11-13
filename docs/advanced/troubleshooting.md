# 故障排查

> **面向读者**：正在部署或运维 Haizakura（原名 SnowLuma）的人。
> **本文是实战手册** —— 每条都来自**真实踩过的坑**，格式统一为
> **症状 → 根因 → 解决 → 验证**。
> 遇到问题先按第 1 节跑一遍体检，再按症状查表。

---

## 1. 三十秒体检

```bash
# ── ① 容器活着吗 ──
docker ps --filter name=<容器> --format '{{.Names}} | {{.Status}}'
# 期望：Up … (healthy / Up X minutes)

# ── ② hook 健康度（★ 最重要的一条：0 = 健康）──
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'

# ── ③ 注入痕迹还在吗 ──
docker exec <容器> sh -c 'ls -la /tmp/runtime-*/mojo.*.sock'
# 期望：mojo.<pid>.control.sock + mojo.<pid>.recv.sock

# ── ④ 端口通吗（★ 必须用 curl，别用 /dev/tcp）──
curl -s -o /dev/null -w 'webui=%{http_code}\n' http://127.0.0.1:5099/
curl -s -o /dev/null -w 'onebot=%{http_code}\n' http://127.0.0.1:3000/

# ── ⑤ 基线指纹对不对 ──
docker exec <容器> sh -c 'grep -m1 -o "\"version\": \"[^\"]*\"" /opt/QQ/resources/app/package.json'
# 期望："version": "3.2.32-52194"
```

**五项全过 = 系统健康。** 有异常 → 按 §3 的编号查。

---

## 2. 排查工具速查

### 2.1 进程与注入

```bash
# QQ 主进程（过滤掉 --type= 的 Electron 子进程）
docker exec <容器> sh -c 'ps -eo pid,args | grep -E "^ *[0-9]+ qq " | grep -v -- --type='

# ★ 注入负载映射（注意 (deleted) 标记）
docker exec <容器> sh -c 'grep orcexec /proc/<qq_pid>/maps'

# ★ 注入线程（名字直接暴露为 snowluma-pipe-w）
docker exec <容器> sh -c 'ls /proc/<qq_pid>/task/*/comm | while read f; do
  printf "%s " "$(basename $(dirname $f))"; cat $f; done | grep -i snowluma'

# 通信 socket（持有者显示为 qq）
docker exec <容器> sh -c 'ss -xpn | grep mojo'
```

### 2.2 WebUI API（运维最常用）

```bash
# 登录拿 session token
TOKEN=$(curl -s -X POST http://127.0.0.1:5099/api/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"<你的密码>"}' | grep -oE '"token":"[^"]+"' | cut -d'"' -f4)

# 认证方式有两种（任选）：
#   Header:  Authorization: Bearer <token>
#   Header:  x-snowluma-token: <token>

# 状态类
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/status
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/processes
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/connections
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/qq-list
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/config/<uin>

# 进程 / hook 管理
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/processes/<pid>/load
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/processes/<pid>/unload
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/processes/<pid>/refresh

# 日志
curl -s -H "Authorization: Bearer $TOKEN" 'http://127.0.0.1:5099/api/logs?lines=200'
curl -N -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/logs/stream   # SSE 实时
```

### 2.3 日志检索

```bash
LOG=/app/data/logs/snowluma-$(date +%F).log

# hook 失败征兆（0 = 健康）
docker exec <容器> sh -c "grep -c unresolved $LOG"

# 12 条 RTTI 失败串（具体是哪些）
docker exec <容器> sh -c "grep -oE '[A-Za-z]+ (RTTI chain unresolved|features missing or ambiguous)[^\"]*' $LOG | sort -u"

# 自动注入的终态
docker exec <容器> sh -c "grep -oE 'hook_autoload_terminal[^\"]*' $LOG | sort -u"
```

---

## 3. 故障病历

---

### T1 ★ 改了状态指令的触发词，但机器人仍响应旧指令

**这是配置优先级问题，不是 bug。**

#### 症状

```
- 我把代码里的默认触发词从 #sl 改成了 #Haizakura
  → 容器重启后才生效（但重启会丢登录态 ❌）
- 我直接改了 /app/data/config/onebot_<uin>.json 里的 trigger
  → 完全没生效 ❌
- 机器人还是只响应旧的触发词
```

#### 根因

**两层原因叠加**：

```
原因一：配置优先级
        运行时配置（onebot_<uin>.json）  >  代码默认值（DEFAULT_STATUS_COMMAND）
        → 改代码默认值对已有账号无效

原因二：★ 改配置文件【不会热加载】
        运行时内存里保存的是【登录时读入】的那份配置。
        直接改 JSON 文件，进程不知道你改了 —— 必须走 API 或重启。
```

**当前值**（实测确认）：

```jsonc
// 代码默认值（packages/onebot/src/config.ts）
var DEFAULT_STATUS_COMMAND = {
  enabled: true,
  swallow: false,
  cooldownSeconds: 5,
  trigger: "#Haizakura"        // ← 代码默认
};

// 运行时实际生效（/app/data/config/onebot_<uin>.json）——  以这个为准
"statusCommand": {
  "enabled": true,
  "swallow": false,
  "cooldownSeconds": 5,
  "trigger": "#hz"            // ← ★ 实际生效值
}
```

#### 解决：走 WebUI API 热改（不重启，**保住登录态**）

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:5099/api/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"<密码>"}' | grep -oE '"token":"[^"]+"' | cut -d'"' -f4)

# ① 先把当前完整配置拉下来
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:5099/api/config/<uin> > /tmp/cfg.json

# ② 改 trigger（用 jq 精确修改，保留其它字段）
jq '.statusCommand.trigger = "#hz"' /tmp/cfg.json > /tmp/cfg.new.json

# ③ POST 完整 config body（★ 必须是完整配置，不能只发 statusCommand）
curl -s -X POST http://127.0.0.1:5099/api/config/<uin> \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/cfg.new.json
```

#### 验证

```bash
# 期望返回：{"success":true,"saved":true,"applied":true,...}
```

**返回字段的含义**：

| 返回 | 含义 | 怎么办 |
|---|---|---|
| `"applied": true` | ✅ **已热重载当前会话**，立即生效 | 完事 |
| `"applied": false` 且 `"online": false` | 账号当前不在线，**下次连接时生效** | 等它上线 |
| `"applied": false` 但 `online: true` | 部分网络节点未应用，旧节点已尽力恢复 | 看返回里的 `errors` 详情 |
| `"success": false` | 配置校验失败 | 看 `message` |

> 服务端原话（源码里的三档文案）：
> - `"配置保存成功，已热重载当前会话。"`
> - `"配置保存成功，当前会话未在线，将在下次连接时生效。"`
> - `"配置已保存，但部分网络节点未能应用；旧节点已尽力恢复，请查看错误详情。"`

#### ⚠️ 三条路线对比（我实际走过的路）

| 路线 | 结果 | 说明 |
|---|---|---|
| ① 改源码默认值 | 容器重启后才生效 | **但重启丢登录态** ❌ |
| ② 改配置文件 `onebot_<uin>.json` | **不生效** | 无热加载 ❌ |
| ③ **走 WebUI API POST 完整 config** | **生效**（`applied:true`） | ✅ **推荐** |

#### 附：触发词匹配语义

```js
function normalize(s) { return s.trim().toLowerCase(); }

// 精确相等，不是包含匹配
return normalize(message) === normalize(trigger);
```

| 特性 | 行为 |
|---|---|
| 大小写 | **不敏感**（`#HZ` = `#hz`） |
| 前后空格 | **自动 trim**（`" #hz "` 能匹配） |
| **混合消息** | ❌ **不匹配**（`#hz` + 一张图片 不触发 —— 必须是单一 text 段） |
| 长度限制 | trigger **最长 32 字符**，不能含换行 |
| 冷却 | `cooldownSeconds`（当前 5 秒） |

---

### T2 ★★★ 登录态丢失 —— 必须重新扫码（血的教训）

**这是破坏性最强、最容易误踩的坑。**

#### 症状

```
- 重启了 QQ 进程 / 重启了容器
- WebUI 显示未登录，OneBot 动作全部返回
  "QQ is not ready. Please finish signing in and try again."
- 检查发现 loginList 是空的
```

#### 根因

```
QQ 进程重启 → loginList 被清空 → 必须重新扫码
```

**`loginList` 不是持久化的登录凭据** —— 它是**进程内的会话状态**。
QQ 进程一没了，这个状态就没了。

**连带影响**：容器重启会一起重启 QQ 进程（supervisord 的 `[program:qq]`），
所以**重启容器 = 丢登录态**。

#### 解决：重新扫码

```bash
# ① 确认 noVNC 可达（走 IP，别用域名 —— 见 T3）
#    http://<服务器IP>:6181/vnc.html

# ② 确认 noVNC 进程活着
docker exec <容器> sh -c 'ps aux | grep -E "novnc|websockify|x11vnc"'

# ③ 打开 noVNC → 看到 QQ 登录界面 → 扫码
#    密码在容器内 /app/data/config/vnc-password
docker exec <容器> cat /app/data/config/vnc-password

# ④ 扫码成功后，确认 hook 自动接管
docker exec <容器> sh -c 'ls -la /tmp/runtime-*/mojo.*.sock'
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/qq-list
```

#### 预防

> ⚠️ **做任何需要重启 QQ / 容器的操作前，先想清楚"要不要重新扫码"。**
>
> - 需要重启时，**尽量在能扫码的时候做**（人在电脑前）
> - **改配置优先走 WebUI API**（T1）—— 这是"不重启"的唯一正道
> - 部署新 bundle 时**只需要重启 runtime 进程，不需要重启 QQ**（见 [build.md](../dev/build.md) §5）
> - **不要设 `--restart=always` 然后指望它自愈** —— 它能重启，但登录态回不来

---

### T3 noVNC 打不开

#### 症状

```
- 在浏览器里访问 https://<域名>:6181/vnc.html → 打不开 / 连接被拒绝 / 报证书错误
- 换成 http:// 也不行，浏览器自动跳到了 https://
```

#### 根因

```
浏览器 HSTS（HTTP Strict Transport Security）把该域名的 http 强制升级成 https。
noVNC 是明文 HTTP 服务，不支持 https → 连接失败。
```

HSTS 是**按域名**记住的，一旦某个域名被标记，后续所有 http 访问都被强制升级。

#### 解决：**用 IP 代替域名**

```
❌ https://example.com:6181/vnc.html     ← HSTS 强制升级，失败
❌ http://example.com:6181/vnc.html      ← 被浏览器跳到 https，失败
✅ http://<your-host>:6181/vnc.html    ← ★ 用 IP，绕过 HSTS
```

> **关键点**：HSTS 只对**域名**生效，对**裸 IP 地址不生效**。
> 所以同一个服务，域名打不开、IP 能打开。

#### 备选方案

```bash
# ① 换浏览器 profile / 无痕模式（HSTS 缓存不在里面）
# ② 清 HSTS：Chrome → chrome://net-internals/#hsts → Delete domain security policies
# ③ 直接端口转发到本地，用 localhost 访问
ssh -L 6181:127.0.0.1:6181 <user>@<服务器>
# 然后访问 http://127.0.0.1:6181/vnc.html
```

#### 验证

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<服务器IP>:6181/vnc.html
# 期望：200
```

---

### T4 hook 失效（日志出现 unresolved）

**这是最高优先级的故障** —— 它意味着 QQ 升级了，或者注入失败。

#### 症状

```
- OneBot 动作全部失败
- 日志里出现勾子失败串
- grep -c unresolved 返回非 0
```

#### 诊断：第一步永远是数数

```bash
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'
# 0 = 健康
# >0 = 有问题，继续看下面
```

#### ★ 12 条 RTTI 失败串 → 具体槽位对照表

**全部 12 条都出自同一个验证闸门（`.so` 的 `0x5610`）**，
它们构成一个**全"与"关系**的检查清单 —— **任一条失败即整链失败并拒绝注入**。

| # | 错误串（日志原文） | 对应目标 | 地址 / 偏移 |
|---|---|---|---|
| 1 | `MSFService SessionInit/RTTI chain unresolved` | MSFService `SessionInit` | `0x137a48c`，**ap+0x98** |
| 2 | `MSFCoreService SessionInit/RTTI chain unresolved` | MSFCoreService `SessionInit` | `0x139d864`，**ap+0x98** |
| 3 | `MSFCoreService packet-state callback/RTTI chain unresolved` | MSFCoreService `onMSFPacketState` | `0x13a3e80`，**ap+0x178** |
| 4 | `MSFService receive anchor/TaskManager RTTI chain unresolved` | MSFService `operator()`（recv push）+ TaskManager 链 | `0x1383f14` / `0x1383ee4`，ap+0x100/+0x158 |
| 5 | `MSFService send features missing or ambiguous` | `SendSSORequestInternal` / `SendMsfRequest` | ap+0x120 / +0x130 |
| 6 | `MSFCoreService send features missing or ambiguous` | `SendSSORequest` / `SendMsfRequest` | ap+0x120 / +0x138 |
| 7 | `MSFCoreService packet converter/native allocator unresolved` | `onMsfPushForTesting` / `GetClientAddress` + 分配器 | ap+0x68 |
| 8 | `NG session/receive ownership path unresolved` | NG 会话/收包归属路径 | — |
| 9 | `MSF live selector feature/RTTI chain missing or ambiguous` | live selector 特性 | — |
| 10 | `invalid pid` | 目标 PID 无效 | — |
| 11 | `failed to inspect wrapper.node` | 读 `wrapper.node` 失败 | — |
| 12 | `runtime service structures could not be read or resolved` | 运行期结构体读取/解析失败 | — |

**另外两条相关串**（不同函数）：

| 错误串 | 所在函数 | 含义 |
|---|---|---|
| `missing or ambiguous GNU build ID` | `0x384cc`（模块身份校验） | build-ID 缺失或不唯一 → **QQ 版本不匹配** |
| `ELF metadata differs from live memory` | `0x39b10`（磁盘/内存比对） | 磁盘文件与内存映射不一致 → **被篡改或版本错配** |
| `failed to install a resolved receive VTable` | `0xea00`（VTable 安装） | 解析成功但安装失败 → 页保护改不动 |
| `QQ runtime cannot read process memory`<br>`[RUNTIME_MEMORY_UNAVAILABLE]` | `0x5610` | 读目标进程内存被拒 → **内核权限/seccomp 问题** |

#### 按错误串分诊

| 你看到 | 根因 | 解决 |
|---|---|---|
| `missing or ambiguous GNU build ID` | **QQ 版本变了**，build-ID 不是 `89c36b52…` | 走 [compatibility.md §7](compatibility.md) 适配流程 |
| `…SessionInit/RTTI chain unresolved` | 类名变了（→ 情况 2）或槽位变了（→ 情况 3） | 跑 `dump-vtable.py --diff` |
| `…features missing or ambiguous` | vtable 里多个候选，无法消歧 | 同上，看 diff 的槽位表 |
| `ELF metadata differs from live memory` | 磁盘上的 `wrapper.node` 与内存不一致 | 确认 QQ 没被外部改动；重新注入 |
| `[RUNTIME_MEMORY_UNAVAILABLE]` | 缺 `CAP_SYS_PTRACE` 或 seccomp 拦截 | 见 T5 |
| `invalid pid` / `module not found in target process maps` | 注错了进程（注进 zygote 了） | 见 T11 |

#### 解决路径

```bash
# ① 确认是否能自愈（瞬时错误会自动重试 3 次）
docker exec <容器> sh -c 'grep -oE "auto-load (retry pending|retry exhausted|recovered)[^\"]*" \
  /app/data/logs/$(date +%F).log | sort -u'
```

| 日志 | 含义 | 处理 |
|---|---|---|
| `auto-load retry pending` | 瞬时错误，正在重试 | 等一下 |
| `auto-load recovered: PID=%d attempt=%d/3` | ✅ 自愈成功 | 完事 |
| `auto-load retry exhausted` | ❌ 3 次用尽 | 走下面的适配流程 |

```bash
# ② 手动重新注入（绕过自动闸门）
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:5099/api/processes/<qq主进程pid>/load
```

```bash
# ③ 若仍失败 → 判定 QQ 版本变化，走适配
md5sum wrapper.node
readelf -n wrapper.node | grep 'Build ID'
python3 tools/dump-vtable.py --wrapper wrapper.node --class 'nt::MSFService'
python3 tools/dump-vtable.py --wrapper wrapper.node --diff tools/baseline-vtable.json
```

> ⚠️ **重要认知**：错误信息**只会说 `unresolved`**，拿不到更多细节。
> 想知道"到底哪变了"，**必须自己跑 dump 工具做 diff**。

#### 验证

```bash
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'   # 应回到 0
# + 端到端：真的发一条消息、真的收一条消息
```

---

### T5 容器启动失败，ExitCode 126

#### 症状

```
docker ps -a
  → Exited (126) X seconds ago

docker logs <容器>
  → /usr/local/bin/node: Operation not permitted
```

容器**立刻退出**，退出码 **126**。

#### 根因

**缺少两个必需的内核能力**：

```
① 缺 --cap-add SYS_PTRACE
   → 注入器无法 ptrace 附加到 QQ 进程

② 缺 --security-opt seccomp=unconfined
   → 默认 seccomp 白名单拦截 ptrace / process_vm_readv / process_vm_writev
   → node 启动某个系统调用被拒 → "Operation not permitted" → exit 126
```

退出码 126 的语义是 **"命令找到了但无法执行"** —— 权限问题，不是"文件不存在"（那是 127）。

#### 解决

```bash
docker run -d \
  --name snowluma-hz \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  -p 5199:5099 -p 3010:3000 -p 3011:3001 -p 6181:6081 \
  motricseven7/snowluma:latest
```

#### 验证

```bash
# ① 确认容器起来了
docker ps --filter name=snowluma-hz --format '{{.Status}}'

# ② 确认这两个配置真的在（生产实例实测输出）
docker inspect snowluma-hz --format '{{json .HostConfig.CapAdd}} {{json .HostConfig.SecurityOpt}}'
# 期望：["CAP_SYS_PTRACE"] ["seccomp=unconfined"]
```

#### 排错顺序（退出码速查）

| 退出码 | 含义 | 常见原因 |
|---|---|---|
| **126** | 命令无法执行（权限） | **缺 `CAP_SYS_PTRACE` / seccomp** ← 最常见 |
| 127 | 命令不存在 | 镜像损坏 / 路径错 |
| 137 | 被 SIGKILL（通常 OOM） | 内存不足 |
| 143 | 被 SIGTERM（正常停止） | 手动 stop |
| 0 | 正常退出 | 前台的进程结束了（正常应常驻） |

---

### T6 `/tmp` 里的文件突然消失

#### 症状

```
- 在容器 /tmp 下生成的截图/导出文件，几秒后就找不到了
- 或者：写到 /tmp 的文件读到 0 字节
```

#### 根因

```
容器内 /tmp 会被定期清理（tmp 清理机制）。
注入器自己也用 /tmp（临时文件落地后立即 unlink）——
所以 /tmp 在这个容器里是【高周转区】，不适合放需要留存的东西。
```

**证据**：注入器把 `.so` 写到 `/tmp/runtime-<uid>/orcexec.<rand6>` 后**立即 unlink**
（`/proc/<pid>/maps` 里显示 `(deleted)`）—— 这是设计行为，不是 bug。

#### 解决

| 场景 | 正确做法 |
|---|---|
| **截图发给用户** | **走管道，不落盘** —— 直接 base64 输出，别写 `/tmp/xxx.png` |
| 需要留存的导出 | 写到**挂载卷**（`/app/data/…`），不要写 `/tmp` |
| 临时中转 | 用完立即读走；或接受它会被清掉 |

```bash
# ✅ 截图走管道（不落盘）
docker exec <容器> sh -c 'import -window root png:-' | base64 -w0

# ✅ 需要留存的文件写到持久卷
docker exec <容器> sh -c '你的命令 > /app/data/export-$(date +%s).txt'

# ❌ 别这样
docker exec <容器> sh -c 'screenshot > /tmp/shot.png'   # 可能被清掉
```

---

### T7 端口不通

**这个坑有两层：Docker 的网络链，以及测试方法本身的假阴性。**

#### 症状

```
- 从宿主机访问容器端口，连不上
- 但容器内 curl 是通的（或者反之）
- 用 /dev/tcp 测试报不可达，但 curl 返回 200
```

#### 根因

**根因一：Docker 端口走 FORWARD 链，不是 INPUT**

```
宿主机 →（PREROUTING DNAT）→ FORWARD → 容器
                          ⚠️ 不是 INPUT 链
```

所以**按 INPUT 链配的防火墙规则不生效**：
你明明"放通了这个端口"，流量还是被 FORWARD 链默认策略拦掉。

**根因二：`/dev/tcp` 测试有假阴性**

```
同一个端口，/dev/tcp 报不可达，curl 却返回 200。
```

`/dev/tcp` 是 bash 内建，它的行为受**多种因素**影响（DNS 解析、IPv6 优先、
bash 编译选项、超时处理），**不适合做连通性判据**。

#### 解决

```bash
# ① ★ 验证端口连通性【必须用 curl】
curl -s -o /dev/null -w '%{http_code}\n' http://<IP>:<PORT>/<path>

# ② 排查 Docker 端口映射
docker port <容器>

# ③ 检查 FORWARD 链（不是 INPUT！）
sudo iptables -L FORWARD -n -v --line-numbers
sudo iptables -t nat -L DOCKER -n -v          # 看 DNAT 规则

# ④ 检查宿主机内核转发开关
sysctl net.ipv4.ip_forward                     # 应为 1

# ⑤ 分层定位：容器内 → 宿主机 → 外网
docker exec <容器> curl -s -o /dev/null -w 'in-container=%{http_code}\n' http://127.0.0.1:5099/
```

#### 验证

```bash
# 期望：一个 2xx/3xx/4xx 的 HTTP 状态码（401/404 也算"通"，因为 TCP 层通了）
curl -s -o /dev/null -w '%{http_code}\n' http://<IP>:5199/
```

> **判读提示**：`401` / `404` **都是"通"的证据** ——
> 说明 TCP 连上了、HTTP 服务在响应。只有 `000`（连接失败）才是真不通。

---

### T8 WebUI 密码强度不足，无法设置

#### 症状

```
- 设置 WebUI 密码时被拒
- 或者：设置了弱密码，登录后强制要求改密码
  （mustChangePassword 门禁：除白名单路由外全部返回 403 + mustChangePassword:true）
```

#### 根因

**密码规则**（`packages/core/src/webui/auth.ts` 的 `PASSWORD_RULES`，源码原文）：

```js
var PASSWORD_RULES = [
  { id: "length",  label: "长度不少于 10 位",        test: (p) => p.length >= 10 },
  { id: "lower",   label: "包含小写字母",            test: (p) => /[a-z]/.test(p) },
  { id: "upper",   label: "包含大写字母",            test: (p) => /[A-Z]/.test(p) },
  { id: "special", label: "包含特殊符号 (!@#$%…)",   test: (p) => /[^A-Za-z0-9\s]/.test(p) },
  { id: "no-space",label: "不包含空格",              test: (p) => !/\s/.test(p) && p.length > 0 }
];
```

**五条全过才算强密码**（`isStrongPassword` = `every()`）。

#### 解决

密码必须**同时满足**：

| 要求 | 说明 |
|---|---|
| **长度 ≥ 10** | 少于 10 位直接拒 |
| **含小写字母** | `a-z` |
| **含大写字母** | `A-Z` |
| **含特殊符号** | `!@#$%…`（任何非字母数字非空白字符） |
| **不含空格** | |

示例格式：`<Your-Password>`（≥10 位、含大小写+数字+特殊符号、无空格）。

#### 相关接口与机制

```bash
# 校验强度（不需要登录）
curl -s -X POST http://127.0.0.1:5099/api/auth/check-strength \
  -H 'Content-Type: application/json' -d '{"password":"你的候选密码"}'

# 改密码
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:5099/api/auth/change-password \
  -H 'Content-Type: application/json' \
  -d '{"currentPassword":"...","newPassword":"..."}'
```

| 机制 | 说明 |
|---|---|
| **哈希算法** | `crypto.scryptSync`，`N=16384` / `r=8` / `p=1` / `keylen=64` |
| **比对** | `timingSafeEqual`（防时序攻击） |
| **强度评估** | `@zxcvbn-ts/core`（额外给出强度评分） |
| **2FA** | TOTP（RFC 4226/6238），路由 `/api/auth/totp/*` |
| **登录限速** | 同 IP 连续失败会锁定（返回 429 + 剩余秒数） |
| **首启引导** | `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD`（**< 8 位会被忽略**） |

---

### T9 改了配置但没生效

#### 症状

```
- 改了配置文件 → 无变化
- 不确定该改哪个目录下的文件
```

#### 根因一：改的是"配置文件"，但运行时不热加载它

这是 T1 的同源问题。**分类型处理**：

| 配置类型 | 改文件生效吗 | 正确做法 |
|---|---|---|
| `onebot_<uin>.json`（每账号） | ❌ **不热加载** | **走 WebUI API `POST /api/config/:uin`** |
| `runtime.json`（全局运行） | ⚠️ 部分字段是**布尔白名单**，可热重载 | `hookAutoLoad` / `webuiTls.enabled` 在白名单里；其他要重启 |
| `ui.json`（WebUI 外观） | ✅ 可通过 API | `POST /api/ui` |
| `webui.json`（密码） | ✅ 走 API | `POST /api/auth/change-password` |

#### 根因二：改错了目录（**chatluna 是 `/data/instance/`，不是 `/app/`**）

**这是最容易搞混的一点** —— 容器里存在**两套完全不同的目录前缀**：

```
/app/               ← Haizakura（SnowLuma）自己的目录
  /app/runtime/       bundle + native 产物
  /app/data/config/   ★ Haizakura 的配置文件在这里
  /app/data/logs/     日志
  /app/data/data/<uin>/  SQLite 数据库
  /app/.config/       QQ 的配置（含登录态）
  /app/.local/share/  QQ 的数据

/data/instance/     ← ★ chatluna 相关（不是 Haizakura！）
```

> **判据**：你要改的是 **Haizakura 的行为** → 找 `/app/`；
> 你要改的是 **chatluna（外部对接的 bot 框架）** → 找 `/data/instance/`。
> **两者不通。**

#### 根因三：容器不是你想的那个

```bash
# 确认你改的是正在运行的那个容器
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect <容器> --format '{{json .HostConfig.Binds}}'
```

> ⚠️ **特别注意**：可能存在**已停止的旧容器**（比如 `snowluma` 就是旧的，
> 配置里是 `#sl`；当前生效的是 `snowluma-hz`，配置里是 `#hz`）。
> **改对了文件，但改在了旧容器的卷里 = 白改。**

#### 解决：先定位，再改

```bash
# ① 我现在连的是哪个容器？
docker ps --format '{{.Names}} {{.Status}}'

# ② 这个容器的配置文件到底在哪？
docker inspect <容器> --format '{{json .HostConfig.Binds}}'
docker exec <容器> sh -c 'ls -la /app/data/config/'

# ③ 当前实际生效的值是什么？
docker exec <容器> sh -c 'cat /app/data/config/runtime.json'
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/status
```

---

### T10 跨机传文件被截断

#### 症状

```
- scp 传过去的文件大小不对（16 KB 的 tgz 变成 672 KB 或 0 字节）
- 或者：文件长度看起来正常，但内容是坏的
  （遇到过 262 字节 vs 262 字节，md5 不同）
```

#### 根因

```
① 传输被中断（SSH 空闲断连、网络抖动）
② 二进制文件经过文本管道被改写（换行符转换、编码损坏）
③ ★ 文件长度相同 ≠ 内容相同
```

#### 解决

```bash
# ✅ 首选：base64 编码 + 管道（避免二进制被文本层改写）
base64 -w0 local-file.tgz | ssh <host> 'base64 -d > /remote/path/file.tgz'

# ✅ 或者：cat 直通
cat local-file.tgz | ssh <host> 'cat > /remote/path/file.tgz'

# ✅ 大文件：分块（可断点续传）
split -b 8M local-file.tgz chunk-
for f in chunk-*; do
  scp "$f" <host>:/remote/path/ && echo "$f OK" || { echo "$f FAIL"; break; }
done
ssh <host> 'cat /remote/path/chunk-* > /remote/path/file.tgz'
```

#### ★ 必须两端校验

```bash
# 本地
sha256sum local-file.tgz
# 远端
ssh <host> 'sha256sum /remote/path/file.tgz'

# 值必须【完全一致】
```

> **教训**：
> - **文件长度相同也可能内容不同** —— 别拿 `ls -l` 当校验
> - **必须用 sha256/md5**，不要只看大小
> - 长传输用后台任务 + 轮询日志（`setsid nohup ... &`），SSH 空闲断连会杀掉前台任务

---

### T11 注入进了 zygote，搞坏 QQ 的 IPC 和登录界面

#### 症状

```
- QQ 界面白屏 / 登录界面异常 / QQ 的进程间通信失灵
- 日志里出现 "auto-load skip: PID=%d is an Electron child process (--type=%s)"
- 或者：hook 好像生效了但 QQ 本身坏掉了
```

#### 根因

**Electron 子进程会被误判为"主 QQ 进程"**，原因有两个叠加：

```
① 子进程（zygote / renderer / gpu / utility）的 cmdline 里也含 "qq"
② 它们通过 fork 的 copy-on-write 会【短暂继承 wrapper.node 映射】

→ .node 的进程枚举器把它们错认成"主 QQ"
```

**后果很严重**：

```
注进 zygote → 在 zygote 里启动 hook 的 resolver 线程
            → 之后 Electron fork 出的【每个 renderer 都会继承该线程
              + 半初始化的 hook 状态】
            → 【直接搞坏 QQ 的 IPC 和登录界面】
```

**源码注释原文**：

> *"Injecting into a zygote spawns the hook's resolver thread inside it;
> every renderer Electron later forks then inherits that thread + the
> partially-init'd hook state, which breaks QQ's IPC and login UI."*

#### 解决：过滤机制（已内置，默认开启）

源码 `shouldAutoLoadPid()` 的逻辑：

```js
function shouldAutoLoadPid(pid, log) {
  if (process.platform !== "linux") return true;
  if (process.env.SNOWLUMA_HOOK_AUTOLOAD_ALL === "1") return true;   // 逃生舱
  let cmdline;
  try { cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8"); }
  catch { return true; }
  if (cmdline.includes("--type=")) {                                  // ★ 判据
    const type = /--type=([^\0\s]+)/.exec(cmdline)?.[1] ?? "unknown";
    log.info("auto-load skip: PID=%d is an Electron child process (--type=%s)", pid, type);
    return false;
  }
  return true;
}
```

**判别方法非常简单有效**：读 `/proc/<pid>/cmdline`，含 `--type=` 就跳过。
主 QQ 进程的 cmdline 是 `qq --no-sandbox --disable-gpu …`，**不含** `--type=`。

#### 三个开关

| 开关 | 作用 | 风险 |
|---|---|---|
| `shouldAutoLoadPid()`（默认行为） | 自动跳过 `--type=` 的进程 | ✅ 安全，保持默认 |
| `SNOWLUMA_HOOK_AUTOLOAD_ALL=1` | **放行所有 PID**（逃生舱） | ⚠️ **会注进 zygote，搞坏 QQ** |
| `POST /api/processes/:pid/load` | **手动加载，绕过闸门** | ⚠️ 操作员自负责任 |

#### 验证

```bash
# ① 确认注的是主进程，不是子进程
docker exec <容器> sh -c 'ps -eo pid,args | grep -E "qq --" | grep -v -- --type='

# ② 确认跳过日志
docker exec <容器> sh -c 'grep -oE "auto-load skip: PID=[0-9]+ is an Electron child process[^\"]*" \
  /app/data/logs/$(date +%F).log | sort -u'

# ③ 确认 socket 的 pid 是主进程
docker exec <容器> sh -c 'ls /tmp/runtime-*/mojo.*.control.sock'
```

**旁证**：`.so` 里还有另一层守卫 `isTransientLibcMappingError()`，
匹配 `"target process does not map /libc.so.6 while resolving mmap"` ——
说明**注入器要求目标进程已映射 libc**（即已完成动态链接），
zygote 早期恰好不满足。

---

### T12 自动更新必然失败（404）

#### 症状

```
- 日志里反复出现更新检查失败
- GET /api/update/check 报 404 / 网络错误
```

#### 根因

```
上游仓库已被删除：
  https://api.github.com/repos/SnowLuma/SnowLuma/releases/     → 404
  https://github.com/SnowLuma/SnowLuma/releases/download/v…    → 404
```

**不是网络问题、不是镜像问题 —— 是仓库真的没了。**

#### 解决

三种方式，选一：

```bash
# 方案 A：关掉更新检查（最简单）
SNOWLUMA_UPDATE_CHECK=0

# 方案 B：指向你自己的 fork
#   改 packages/core/src/update/sources.ts 的 RELEASE_ROOT

# 方案 C：走 WebUI 配置更新源（不重启）
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:5099/sources \
  -H 'Content-Type: application/json' \
  -d '{"mode":"direct","mirror":"","mirrors":[]}'
```

**三种模式**（`update/sources.ts`）：

| 模式 | 行为 |
|---|---|
| `auto`（默认） | 先直连，再逐个镜像回落（`mirrors` 最多 16 个） |
| `direct` | 只直连 |
| `mirror` | 只用自填镜像 |

**默认镜像列表**（**全部指向 GitHub，因此全部 404**）：

```
https://ghfast.top          https://ghproxy.net
https://gh-proxy.com        https://github.chenc.dev
https://fastgit.cc          https://gh.noki.icu
https://cors.isteed.cc      https://gh-proxy.org
https://githubproxy.gohj99.site   https://github.xxlab.tech
```

#### 验证

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  https://api.github.com/repos/SnowLuma/SnowLuma/releases/
# 期望：404（确认仓库已删）
```

> ⚠️ **接手必做项**：`update/sources.ts` 是**必须改**的文件之一。
> 相关 WebUI 路由：`GET /api/update/check`、`GET/POST /sources`、`POST /sources/test`、`POST /download`。

---

### T13 日志占用磁盘越来越大

#### 症状

```
- 磁盘空间被日志吃掉
- 实测约 11 MB/天
```

#### 根因

```
默认：logMaxTotalMb = 1024（总量上限 1 GB）
      logRetainDays = 7（保留 7 天）
      logPerUin    = false（不按账号分文件）

→ 稳态大约 80 MB 常驻（7 天 × 11 MB/天）
   —— 但如果流量大，会更快接近 1 GB 上限
```

#### 解决

```bash
# 方式一：改 runtime.json（部分字段可热重载）
#   路径：/app/data/config/runtime.json
{
  "logMaxTotalMb": 512,
  "logRetainDays": 3,
  "logPerUin": false
}

# 方式二：环境变量
SNOWLUMA_LOG_DIR=/app/data/logs
SNOWLUMA_LOG_FILE=0            # 完全关闭文件日志（只留控制台）
SNOWLUMA_LOG_LEVEL=info
SNOWLUMA_LOG_FILE_LEVEL=warn   # 文件只记 warn 以上（省空间）
SNOWLUMA_LOG_MAX_MB=…          # 单文件上限
SNOWLUMA_LOG_MAX_TOTAL_MB=1024 # 总量上限
SNOWLUMA_LOG_RETAIN_DAYS=7     # 保留天数
SNOWLUMA_LOG_PER_UIN=0         # 是否按 uin 分文件
```

#### 验证

```bash
docker exec <容器> sh -c 'du -sh /app/data/logs/; ls -la /app/data/logs/'
```

#### 相关：WebUI 存储清理

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/system/storage
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/system/storage/cleanup
```

> **注意**：`messages.db` 会随消息累积（实测曾达 70.8 MB + 4 MB WAL）。
> 大流量场景要关注 `/app/data/data/<uin>/` 的总量。

---

### T14 WebUI 登录相关的其他坑

#### T14.1 登录被限速（429）

```
症状：返回 {"success":false,"message":"登录尝试过多，请 N 秒后重试"}
根因：同 IP 连续密码错误触发锁定（loginAttempts 按 IP 计数）
解决：等剩余秒数；或从另一个 IP 访问；或重启 runtime 清空计数
```

> **限速键**取决于 `trustProxy` 配置：默认按 **socket peer** 计。
> 走反代时若不配 `trustProxy`，所有用户会被当成同一个 IP。

#### T14.2 登录成功后仍需同意协议 / 改密码

```
症状：除白名单路由外，所有 API 返回 403
      {"status":"failed","message":"请先阅读并同意用户协议与隐私政策","consentRequired":true}
      {"status":"failed","message":"请先修改密码","mustChangePassword":true}
根因：两个独立门禁
解决：consentGatePending → POST /api/agreements/record-consent
      mustChangePassword → POST /api/auth/change-password
批量部署：SNOWLUMA_ACCEPT_EULA=1 SNOWLUMA_ACCEPT_PRIVACY=1
```

> `EULA.md` / `PRIVACY.md` 缺失时会警告：
> `[WebUI.Consent] agreement file not found (looked for EULA.md near the bundle and repo root)`

#### T14.3 走反代后拿不到真实客户端 IP

```
症状：所有请求的「客户端 IP」都是反代的地址
根因：trustProxy 未配 / 配错
解决：runtime.json 的 trustProxy 设成：
      ""          关闭（默认，按 socket peer）
      "all"       信任任何 peer 的 X-Real-IP / X-Forwarded-For
      "loopback"  仅当 socket peer 是回环时信任
      "ip-list"   仅当 socket peer 在指定 IP 列表内时信任
```

#### T14.4 WebUI 端口被占用

```
症状：WebUI 起不来
根因：端口冲突。注意容器映射后【容器内仍是 5099】，宿主机是 5199
解决：确认容器内监听 5099；换宿主机映射端口，而不是改容器内端口
相关源码：findAvailablePort(start, { maxTries: 50, host }) —— 会向上找 50 个可用端口
```

---

### T15 逆向/调试脚本把自己的机器搞挂

**这不是运行时的坑，是维护时的坑** —— 但代价很大，值得单列。

#### 症状

```
- 跑分析脚本时负载飙到 37
- 内存被吃到 2.7 GB
- 终端被吐 10 MB 文本
- 脚本 struct.error 崩掉
```

#### 根因（已知陷阱表）

| # | 陷阱 | 后果 | 正确做法 |
|---|---|---|---|
| **T1** | 拿"已定义导出"子集当"全部符号" | **得出"dynsym 里没有 RTTI"的错误结论**（实际有 397 个） | 永远回到 `readelf -sW --dyn-syms` 原文 |
| **T2** | 按字面量 `"MSFService"` 搜 typeinfo | **0 命中**（`__type_name` 是 mangled `N2nt10MSFServiceE`） | 匹配 `N<len><ns><len><Class>E` 模式；排除日志 TAG / JS 属性名 |
| **T3** | 把 `.data.rel.ro` 的 vaddr 当 file off | 全表偏移错 `0x10000` | 从节表算 `Δ = vaddr − file_off`，**不要写死** |
| **T4** | 对 `mmap` 切片做 `b[:z]` 而 `z == -1`（没有 NUL） | **一次吐 10 MB 输出** | 任何派生字符串前断言 `z > 0` |
| **T5** | `.eh_frame_hdr` 编码字节解析错（把 pcrel 当无符号） | 得到 `fde_count=1.8e19` → **越界/无限循环 → OOM（2.7 GB）** | 按 `enc & 0x0f` / `enc & 0x70` 分别处理；**所有循环加上限** |
| **T6** | 取"第一个值 == typeinfo 的槽位"当 primary vtable | MSFService 有 **5 个**地址点，会选错 | 必须按 **`offset_to_top == 0`** 过滤出 primary |
| **T7** | 只看"进程没崩"就认为适配成功 | 槽位错一位 → 静默发错路径 → 用户看到 `"The QQ connection changed…"` | 必须做**真实收发消息**的端到端验证 |

#### 附带坑（工具使用层面）

| 坑 | 后果 | 正确做法 |
|---|---|---|
| bundle 里有 NUL 字节 | `grep -oE` 会截断行（只得 147 个 region） | 用 `grep -a`；提取 region 用 **Python 正则**（得 467 个） |
| `strings` 把 ARM64 机器码误当字符串 | 4,519 行里 ~3,600 行是噪声 | 真字符串集中在**第 1–176 行**和**第 3799–4050 行** |
| bundle 内嵌 330 KB 的 zxcvbn 密码字典（单行） | `grep -C` 会把整个字典打印到终端 | 用 `grep -an` 只要行号；或先 `sed -n 'A,Bp'` 定位 |
| `grep -c <关键词>` 在 bundle 上会骗你 | `backoff`/`jitter`/`circuit` 的"命中"全是那一行字典 | **看行号分布，不要看计数**。若计数 1~3 且都指向同一行 → 假阳性 |
| 长任务前台跑 | SSH 空闲 ~10 分钟断连，任务跟着死 | `setsid nohup … &` + 轮询 `tail -c 800 log \| tr '\r' '\n' \| tail` |

#### 铁律

> **运行逆向脚本时必须加计数上限。**
> 一次循环边界写错就能把负载推到 37、内存吃到 2.7 GB。
> 所有 `struct.unpack_from` 带显式 `cnt` 上限、`i < cnt` 前置检查、
> **永不 stdout 大对象**（全写文件）。

---

## 4. 附录 A：完整 `SNOWLUMA_*` 环境变量清单（36 个）

| 变量 | 用途 |
|---|---|
| `SNOWLUMA_HOOK_AUTOLOAD_ALL` | `=1` 放行所有 PID 自动注入，**绕过 zygote 过滤**（危险） |
| `SNOWLUMA_HOOK_AUTOLOAD` | 覆盖 `runtime.json` 的 `hookAutoLoad` |
| `SNOWLUMA_HOOK_RUNTIME_DIR` | 指定 `mojo.*.sock` 所在目录 |
| `SNOWLUMA_HOOK_ACK_TIMEOUT_MS` | 控制通道 ACK 超时（默认 5000） |
| `SNOWLUMA_PACKET_TIMEOUT_MS` | 业务包超时 |
| `SNOWLUMA_SESSION_RELEASE_DEADLINE_MS` | 会话释放截止时间 |
| `SNOWLUMA_STREAM_DIR` | 流式下载落地目录（非法时 warn 并忽略） |
| `SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES` | 二进制下载大小上限 |
| `SNOWLUMA_HTTP_DOWNLOAD_TIMEOUT_MS` | HTTP 下载超时 |
| `SNOWLUMA_DOWNLOAD_FILE_TIMEOUT_MS` | `download_file` 动作超时（⚠️ 与上一个不同） |
| `SNOWLUMA_NOTIFICATION_HTTP_TIMEOUT_MS` | 通知 webhook 超时 |
| `SNOWLUMA_UPDATE_ROOT` | 更新根目录（开发/测试更新流程） |
| `SNOWLUMA_UPDATE_CHECK` | 是否检查更新（**上游删库后建议设 0**） |
| `SNOWLUMA_WEBUI_PORT` | WebUI 端口（默认 5099） |
| `SNOWLUMA_WEBUI_HOST` | WebUI 绑定地址 |
| `SNOWLUMA_WEBUI_TARGET` | UI 主题预置，**唯一合法值 `maibot`** |
| `SNOWLUMA_WEBUI_TLS` | 覆盖 `webuiTls.enabled` |
| `SNOWLUMA_WEBUI_TRUST_PROXY` | 覆盖 `trustProxy` |
| `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD` | 首次启动注入 WebUI 密码（**< 8 位被忽略**） |
| `SNOWLUMA_ONEBOT_HTTP_PORT` | OneBot HTTP 端口 |
| `SNOWLUMA_ONEBOT_WS_PORT` | OneBot WS 端口 |
| `SNOWLUMA_ONEBOT_HOST` | OneBot 绑定地址（生产实例为 `0.0.0.0`） |
| `SNOWLUMA_LOG_DIR` | 日志目录（默认 `/app/data/logs`） |
| `SNOWLUMA_LOG_FILE` | `=0` 关闭文件日志 |
| `SNOWLUMA_LOG_LEVEL` | 控制台级别，默认 `info` |
| `SNOWLUMA_LOG_FILE_LEVEL` | 文件级别，仅 `debug/info/success/warn/error` |
| `SNOWLUMA_LOG_MAX_MB` | 单文件上限 |
| `SNOWLUMA_LOG_MAX_TOTAL_MB` | 日志总量上限（默认 1024） |
| `SNOWLUMA_LOG_RETAIN_DAYS` | 日志保留天数（默认 7） |
| `SNOWLUMA_LOG_PER_UIN` | 按 uin 分文件 |
| `SNOWLUMA_TRACE_BUFFER` | 追踪缓冲条数 |
| `SNOWLUMA_VERBOSE_WARMUP` | `=1` 打印预热细节 |
| `SNOWLUMA_DEV_MODE` | 开发模式（会用 `snowluma-dev` 固定密码） |
| `SNOWLUMA_DEV_WEBUI` | 开发模式 WebUI |
| `SNOWLUMA_DEV_NO_NATIVE` | `=1` 用 stub 替代 native addon |
| `SNOWLUMA_ACCEPT_EULA` | 非交互接受 EULA |
| `SNOWLUMA_ACCEPT_PRIVACY` | 非交互接受隐私政策 |
| `SNOWLUMA_HOME` / `SNOWLUMA_DATA` | 运行目录 / 数据目录（生产：`/app/runtime` / `/app/data`） |
| `SNOWLUMA_UID` / `SNOWLUMA_GID` | 容器内运行身份（生产：1000/1000） |
| `SNOWLUMA_SCREEN` | Xvfb 屏幕尺寸（生产：`1920x1080x24`） |
| `SNOWLUMA_QQ_FLAGS` | 传给 QQ 的启动参数 |
| `SNOWLUMA_EXTRA_QQ_HOMES` | 额外的 QQ HOME 目录 |
| `QQ_RECV_HEARTBEAT_CMD` | **【未查清】** 疑似 QQ 收包心跳命令名 |

> ⚠️ **`SNOWLUMA_HOOK_RUNTIME_DIR` 的跨进程路径依赖 `/proc/<pid>/environ` 可读** ——
> 同 uid 时可行，**跨 uid 会失败**。【未查清】

---

## 5. 附录 B：`runtime.json` 完整字段

```jsonc
{
  "webuiPort": 5099,          // WebUI 端口
  "hookAutoLoad": false,      // ★ 自动注入开关（生产实例为 false）
  "webuiHost": "0.0.0.0",     // ★ 0.0.0.0 = 对外暴露，建议改 127.0.0.1 + 反代
  "webuiTls": { "enabled": false },   // TLS（src/webui/tls.ts 已就绪）
  "trustProxy": "",           // 反代时填，影响 client-ip 判定
  "logMaxTotalMb": 1024,
  "logRetainDays": 7,
  "logPerUin": false
}
```

> **可热重载的字段**：`hookAutoLoad` / `webuiTls.enabled` 是**布尔白名单**。
> 其他字段改文件后**需要重启**。

---

## 6. 附录 C：一句话排查口诀

```
① 先体检:      容器活着 → unresolved=0 → socket 在 → 端口通 → 指纹对
② 看日志:      grep -c unresolved     （0 = 健康）
③ 别重启:      重启 QQ = 丢登录态 = 重新扫码
④ 改配置:      走 WebUI API，不要改文件（不热加载）
⑤ 端口不通:    用 curl，不要用 /dev/tcp
⑥ 指纹变了:    QQ 升级了 → 跑 dump-vtable.py --diff
⑦ 适配完成:    必须真的收发一条消息，不能只看"进程没崩"
```

---

## 7. 相关文档

| 想了解 | 去看 |
|---|---|
| 它到底怎么工作的 | [architecture.md](architecture.md) |
| 支持哪些版本 / 依赖什么 | [compatibility.md](compatibility.md) |
| 怎么从源码构建 | [build.md](../dev/build.md) |
| 怎么参与开发 | [contributing.md](../dev/contributing.md) |

---

*本文所有命令与报错均来自实测。证据等级保留原标注：
【确证】有直接证据 /【强推断】多证据交叉 /【推断】合理未验证 /【未查清】明确的知识空白。*
