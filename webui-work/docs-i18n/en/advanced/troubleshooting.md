# Troubleshooting

> [!WARNING]
> This content was written entirely by AI; read it with caution.

> **Intended audience**: people who are deploying or operating Haizakura (formerly SnowLuma).
> **This document is a field manual** — every entry comes from a **pitfall actually stepped in**,
> and follows a uniform format: **symptom → root cause → fix → verification**.
> When you hit a problem, first run the checkup in Section 1, then look up your symptom in the table.

---

## 1. Thirty-Second Checkup

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

**All five passing = healthy system.** Anything abnormal → look it up by number in §3.

---

## 2. Troubleshooting Tools at a Glance

### 2.1 Processes and Injection

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

### 2.2 WebUI API (the one operations uses most)

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

### 2.3 Log Search

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

## 3. Failure Casebook

---

### T1 ★ Changed the trigger word for a status command, but the bot still responds to the old command

**This is a configuration-precedence problem, not a bug.**

#### Symptom

```
- 我把代码里的默认触发词从 #sl 改成了 #Haizakura
  → 容器重启后才生效（但重启会丢登录态 ❌）
- 我直接改了 /app/data/config/onebot_<uin>.json 里的 trigger
  → 完全没生效 ❌
- 机器人还是只响应旧的触发词
```

#### Root cause

**Two layers of cause stacking up**:

```
原因一：配置优先级
        运行时配置（onebot_<uin>.json）  >  代码默认值（DEFAULT_STATUS_COMMAND）
        → 改代码默认值对已有账号无效

原因二：★ 改配置文件【不会热加载】
        运行时内存里保存的是【登录时读入】的那份配置。
        直接改 JSON 文件，进程不知道你改了 —— 必须走 API 或重启。
```

**Current values** (confirmed by measurement):

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

#### Fix: hot-change it through the WebUI API (no restart, **keeping the login state**)

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

#### Verification

```bash
# 期望返回：{"success":true,"saved":true,"applied":true,...}
```

**Meaning of the returned fields**:

| Return | Meaning | What to do |
|---|---|---|
| `"applied": true` | ✅ **The current session has been hot-reloaded**; effective immediately | You are done |
| `"applied": false` and `"online": false` | The account is currently offline; **it takes effect on the next connection** | Wait for it to come online |
| `"applied": false` but `online: true` | Some network nodes did not apply it; the old nodes recovered as far as they could | Look at the `errors` details in the response |
| `"success": false` | Configuration validation failed | Look at `message` |

> The server's own wording (the three variants in the source code):
> - `"配置保存成功，已热重载当前会话。"`
> - `"配置保存成功，当前会话未在线，将在下次连接时生效。"`
> - `"配置已保存，但部分网络节点未能应用；旧节点已尽力恢复，请查看错误详情。"`

#### ⚠️ Comparison of the three routes (the ones I actually went through)

| Route | Result | Notes |
|---|---|---|
| ① Change the default value in the source code | Takes effect only after a container restart | **But a restart loses the login state** ❌ |
| ② Change the configuration file `onebot_<uin>.json` | **Does not take effect** | No hot reloading ❌ |
| ③ **POST the complete config through the WebUI API** | **Takes effect** (`applied:true`) | ✅ **Recommended** |

#### Appendix: trigger-word matching semantics

```js
function normalize(s) { return s.trim().toLowerCase(); }

// 精确相等，不是包含匹配
return normalize(message) === normalize(trigger);
```

| Property | Behavior |
|---|---|
| Case | **Insensitive** (`#HZ` = `#hz`) |
| Surrounding whitespace | **Trimmed automatically** (`" #hz "` matches) |
| **Mixed messages** | ❌ **No match** (a `#hz` + an image does not trigger — it must be a single text segment) |
| Length limit | The trigger may be **at most 32 characters** and cannot contain newlines |
| Cooldown | `cooldownSeconds` (currently 5 seconds) |

---

### T2 ★★★ Lost login state — you must scan the QR code again (a lesson paid in blood)

**This is the most destructive and the easiest pitfall to step into.**

#### Symptom

```
- 重启了 QQ 进程 / 重启了容器
- WebUI 显示未登录，OneBot 动作全部返回
  "QQ is not ready. Please finish signing in and try again."
- 检查发现 loginList 是空的
```

#### Root cause

```
QQ 进程重启 → loginList 被清空 → 必须重新扫码
```

**`loginList` is not a persistent login credential** — it is **in-process session state**.
Once the QQ process is gone, that state is gone too.

**Knock-on effect**: restarting the container restarts the QQ process along with it (supervisord's `[program:qq]`),
so **restarting the container = losing the login state**.

#### Fix: scan the QR code again

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

#### Prevention

> ⚠️ **Before any operation that requires restarting QQ / the container, first think through "will this need a fresh QR scan?"**
>
> - When a restart is unavoidable, **do it at a time when you can scan** (a person in front of the computer)
> - **Prefer the WebUI API for configuration changes** (T1) — it is the only proper "no restart" route
> - When deploying a new bundle, **you only need to restart the runtime process, not QQ** (see §5 of [build.md](../dev/build.md))
> - **Do not set `--restart=always` and then expect it to heal itself** — it can restart, but the login state will not come back

---

### T3 noVNC will not open

#### Symptom

```
- 在浏览器里访问 https://<域名>:6181/vnc.html → 打不开 / 连接被拒绝 / 报证书错误
- 换成 http:// 也不行，浏览器自动跳到了 https://
```

#### Root cause

```
浏览器 HSTS（HTTP Strict Transport Security）把该域名的 http 强制升级成 https。
noVNC 是明文 HTTP 服务，不支持 https → 连接失败。
```

HSTS is remembered **per domain name**; once a domain has been flagged, every subsequent http access is forcibly upgraded.

#### Fix: **use the IP instead of the domain name**

```
❌ https://example.com:6181/vnc.html     ← HSTS 强制升级，失败
❌ http://example.com:6181/vnc.html      ← 被浏览器跳到 https，失败
✅ http://<your-host>:6181/vnc.html    ← ★ 用 IP，绕过 HSTS
```

> **Key point**: HSTS applies only to **domain names** and does **not apply to a bare IP address**.
> So for the same service, the domain name fails to open while the IP works.

#### Alternative

```bash
# ① 换浏览器 profile / 无痕模式（HSTS 缓存不在里面）
# ② 清 HSTS：Chrome → chrome://net-internals/#hsts → Delete domain security policies
# ③ 直接端口转发到本地，用 localhost 访问
ssh -L 6181:127.0.0.1:6181 <user>@<服务器>
# 然后访问 http://127.0.0.1:6181/vnc.html
```

#### Verification

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<服务器IP>:6181/vnc.html
# 期望：200
```

---

### T4 Hook failure (unresolved appears in the log)

**This is the highest-priority failure** — it means QQ was upgraded, or the injection failed.

#### Symptom

```
- OneBot 动作全部失败
- 日志里出现勾子失败串
- grep -c unresolved 返回非 0
```

#### Diagnosis: the first step is always to count

```bash
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'
# 0 = 健康
# >0 = 有问题，继续看下面
```

#### ★ The 12 RTTI failure strings → specific slot cross-reference

**All 12 come out of the same verification gate (`0x5610` in the `.so`)**, and
they form an **all-AND** checklist — **if any one of them fails, the whole chain fails and injection is refused**.

| # | Error string (verbatim from the log) | Corresponding target | Address / offset |
|---|---|---|---|
| 1 | `MSFService SessionInit/RTTI chain unresolved` | MSFService `SessionInit` | `0x137a48c`, **ap+0x98** |
| 2 | `MSFCoreService SessionInit/RTTI chain unresolved` | MSFCoreService `SessionInit` | `0x139d864`, **ap+0x98** |
| 3 | `MSFCoreService packet-state callback/RTTI chain unresolved` | MSFCoreService `onMSFPacketState` | `0x13a3e80`, **ap+0x178** |
| 4 | `MSFService receive anchor/TaskManager RTTI chain unresolved` | MSFService `operator()` (recv push) + TaskManager chain | `0x1383f14` / `0x1383ee4`, ap+0x100/+0x158 |
| 5 | `MSFService send features missing or ambiguous` | `SendSSORequestInternal` / `SendMsfRequest` | ap+0x120 / +0x130 |
| 6 | `MSFCoreService send features missing or ambiguous` | `SendSSORequest` / `SendMsfRequest` | ap+0x120 / +0x138 |
| 7 | `MSFCoreService packet converter/native allocator unresolved` | `onMsfPushForTesting` / `GetClientAddress` + allocator | ap+0x68 |
| 8 | `NG session/receive ownership path unresolved` | NG session/receive ownership path | — |
| 9 | `MSF live selector feature/RTTI chain missing or ambiguous` | live selector feature | — |
| 10 | `invalid pid` | Target PID is invalid | — |
| 11 | `failed to inspect wrapper.node` | Failed to read `wrapper.node` | — |
| 12 | `runtime service structures could not be read or resolved` | Failed to read/resolve runtime structures | — |

**Two more related strings** (in different functions):

| Error string | Function it lives in | Meaning |
|---|---|---|
| `missing or ambiguous GNU build ID` | `0x384cc` (module identity check) | build-ID missing or not unique → **QQ version mismatch** |
| `ELF metadata differs from live memory` | `0x39b10` (disk/memory comparison) | The on-disk file and the memory mapping disagree → **tampered with or version mismatch** |
| `failed to install a resolved receive VTable` | `0xea00` (VTable installation) | Resolution succeeded but installation failed → page protection could not be changed |
| `QQ runtime cannot read process memory`<br>`[RUNTIME_MEMORY_UNAVAILABLE]` | `0x5610` | Reading the target process memory was denied → **kernel permission / seccomp problem** |

#### Triage by error string

| What you see | Root cause | Fix |
|---|---|---|
| `missing or ambiguous GNU build ID` | **The QQ version changed**; the build-ID is not `89c36b52…` | Follow the adaptation procedure in [compatibility.md §7](compatibility.md) |
| `…SessionInit/RTTI chain unresolved` | A class name changed (→ case 2) or a slot changed (→ case 3) | Run `dump-vtable.py --diff` |
| `…features missing or ambiguous` | Several candidates in the vtable; cannot disambiguate | Same as above; look at the slot table in the diff |
| `ELF metadata differs from live memory` | The on-disk `wrapper.node` disagrees with memory | Confirm QQ has not been modified externally; inject again |
| `[RUNTIME_MEMORY_UNAVAILABLE]` | Missing `CAP_SYS_PTRACE`, or seccomp is blocking it | See T5 |
| `invalid pid` / `module not found in target process maps` | You injected into the wrong process (you injected into zygote) | See T11 |

#### Resolution path

```bash
# ① 确认是否能自愈（瞬时错误会自动重试 3 次）
docker exec <容器> sh -c 'grep -oE "auto-load (retry pending|retry exhausted|recovered)[^\"]*" \
  /app/data/logs/$(date +%F).log | sort -u'
```

| Log | Meaning | What to do |
|---|---|---|
| `auto-load retry pending` | Transient error; retrying | Wait a moment |
| `auto-load recovered: PID=%d attempt=%d/3` | ✅ Self-healed successfully | You are done |
| `auto-load retry exhausted` | ❌ All 3 attempts used up | Follow the adaptation procedure below |

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

> ⚠️ **Important thing to understand**: the error message **only ever says `unresolved`**; you cannot get more detail out of it.
> To find out "what exactly changed", **you must run the dump tool yourself and diff the output**.

#### Verification

```bash
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'   # 应回到 0
# + 端到端：真的发一条消息、真的收一条消息
```

---

### T5 Container fails to start, ExitCode 126

#### Symptom

```
docker ps -a
  → Exited (126) X seconds ago

docker logs <容器>
  → /usr/local/bin/node: Operation not permitted
```

The container **exits immediately** with exit code **126**.

#### Root cause

**Two required kernel capabilities are missing**:

```
① 缺 --cap-add SYS_PTRACE
   → 注入器无法 ptrace 附加到 QQ 进程

② 缺 --security-opt seccomp=unconfined
   → 默认 seccomp 白名单拦截 ptrace / process_vm_readv / process_vm_writev
   → node 启动某个系统调用被拒 → "Operation not permitted" → exit 126
```

The semantics of exit code 126 are **"the command was found but cannot be executed"** — a permission problem, not "file not found" (that would be 127).

#### Fix

```bash
docker run -d \
  --name snowluma-hz \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  -p 5199:5099 -p 3010:3000 -p 3011:3001 -p 6181:6081 \
  motricseven7/snowluma:latest
```

#### Verification

```bash
# ① 确认容器起来了
docker ps --filter name=snowluma-hz --format '{{.Status}}'

# ② 确认这两个配置真的在（生产实例实测输出）
docker inspect snowluma-hz --format '{{json .HostConfig.CapAdd}} {{json .HostConfig.SecurityOpt}}'
# 期望：["CAP_SYS_PTRACE"] ["seccomp=unconfined"]
```

#### Troubleshooting order (exit code quick reference)

| Exit code | Meaning | Common cause |
|---|---|---|
| **126** | Command cannot be executed (permission) | **Missing `CAP_SYS_PTRACE` / seccomp** ← most common |
| 127 | Command not found | Corrupted image / wrong path |
| 137 | Killed by SIGKILL (usually OOM) | Out of memory |
| 143 | Killed by SIGTERM (normal stop) | Manual stop |
| 0 | Exited normally | The foreground process ended (it should normally stay resident) |

---

### T6 Files in `/tmp` suddenly disappear

#### Symptom

```
- 在容器 /tmp 下生成的截图/导出文件，几秒后就找不到了
- 或者：写到 /tmp 的文件读到 0 字节
```

#### Root cause

```
容器内 /tmp 会被定期清理（tmp 清理机制）。
注入器自己也用 /tmp（临时文件落地后立即 unlink）——
所以 /tmp 在这个容器里是【高周转区】，不适合放需要留存的东西。
```

**Evidence**: the injector writes the `.so` to `/tmp/runtime-<uid>/orcexec.<rand6>` and then **immediately unlinks it**
(it shows up as `(deleted)` in `/proc/<pid>/maps`) — this is by design, not a bug.

#### Fix

| Scenario | The right way |
|---|---|
| **Sending a screenshot to a user** | **Go through a pipe; do not write to disk** — emit base64 directly instead of writing `/tmp/xxx.png` |
| An export that must be kept | Write it to a **mounted volume** (`/app/data/…`), not to `/tmp` |
| Temporary staging | Read it out immediately after use; or accept that it will be cleaned up |

```bash
# ✅ 截图走管道（不落盘）
docker exec <容器> sh -c 'import -window root png:-' | base64 -w0

# ✅ 需要留存的文件写到持久卷
docker exec <容器> sh -c '你的命令 > /app/data/export-$(date +%s).txt'

# ❌ 别这样
docker exec <容器> sh -c 'screenshot > /tmp/shot.png'   # 可能被清掉
```

---

### T7 The port is unreachable

**This pitfall has two layers: Docker's network chain, and false negatives in the test method itself.**

#### Symptom

```
- 从宿主机访问容器端口，连不上
- 但容器内 curl 是通的（或者反之）
- 用 /dev/tcp 测试报不可达，但 curl 返回 200
```

#### Root cause

**Root cause one: Docker ports go through the FORWARD chain, not INPUT**

```
宿主机 →（PREROUTING DNAT）→ FORWARD → 容器
                          ⚠️ 不是 INPUT 链
```

So **firewall rules written against the INPUT chain do not take effect**:
you clearly "opened the port", yet the traffic is still dropped by the FORWARD chain's default policy.

**Root cause two: the `/dev/tcp` test produces false negatives**

```
同一个端口，/dev/tcp 报不可达，curl 却返回 200。
```

`/dev/tcp` is a bash built-in, and its behavior is affected by **many factors** (DNS resolution, IPv6 preference,
bash compile options, timeout handling), so it is **unsuitable as a connectivity criterion**.

#### Fix

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

#### Verification

```bash
# 期望：一个 2xx/3xx/4xx 的 HTTP 状态码（401/404 也算"通"，因为 TCP 层通了）
curl -s -o /dev/null -w '%{http_code}\n' http://<IP>:5199/
```

> **Reading the result**: both `401` and `404` **count as evidence that the port is open** —
> they show that TCP connected and an HTTP service responded. Only `000` (connection failed) means it is genuinely unreachable.

---

### T8 The WebUI password is not strong enough, so it cannot be set

#### Symptom

```
- 设置 WebUI 密码时被拒
- 或者：设置了弱密码，登录后强制要求改密码
  （mustChangePassword 门禁：除白名单路由外全部返回 403 + mustChangePassword:true）
```

#### Root cause

**The password rules** (`PASSWORD_RULES` in `packages/core/src/webui/auth.ts`, verbatim from the source):

```js
var PASSWORD_RULES = [
  { id: "length",  label: "长度不少于 10 位",        test: (p) => p.length >= 10 },
  { id: "lower",   label: "包含小写字母",            test: (p) => /[a-z]/.test(p) },
  { id: "upper",   label: "包含大写字母",            test: (p) => /[A-Z]/.test(p) },
  { id: "special", label: "包含特殊符号 (!@#$%…)",   test: (p) => /[^A-Za-z0-9\s]/.test(p) },
  { id: "no-space",label: "不包含空格",              test: (p) => !/\s/.test(p) && p.length > 0 }
];
```

**All five must pass for the password to count as strong** (`isStrongPassword` = `every()`).

#### Fix

The password must satisfy **all of** the following at the same time:

| Requirement | Notes |
|---|---|
| **Length ≥ 10** | Anything shorter than 10 characters is rejected outright |
| **Contains a lowercase letter** | `a-z` |
| **Contains an uppercase letter** | `A-Z` |
| **Contains a special character** | `!@#$%…` (any character that is not alphanumeric and not whitespace) |
| **Contains no spaces** | |

Example format: `<Your-Password>` (≥10 characters, upper- and lowercase plus digits plus a special character, no spaces).

#### Related endpoints and mechanisms

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

| Mechanism | Notes |
|---|---|
| **Hashing algorithm** | `crypto.scryptSync`, `N=16384` / `r=8` / `p=1` / `keylen=64` |
| **Comparison** | `timingSafeEqual` (defends against timing attacks) |
| **Strength estimation** | `@zxcvbn-ts/core` (additionally yields a strength score) |
| **2FA** | TOTP (RFC 4226/6238), routes `/api/auth/totp/*` |
| **Login rate limiting** | Consecutive failures from the same IP trigger a lockout (429 + seconds remaining) |
| **First-start bootstrap** | `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD` (**fewer than 8 characters is ignored**) |

---

### T9 Changed the configuration but it did not take effect

#### Symptom

```
- 改了配置文件 → 无变化
- 不确定该改哪个目录下的文件
```

#### Root cause one: you changed a "configuration file", but the runtime does not hot-load it

This is the same underlying problem as T1. **Handle it by configuration type**:

| Configuration type | Does editing the file take effect? | The right way |
|---|---|---|
| `onebot_<uin>.json` (per account) | ❌ **No hot loading** | **Use the WebUI API `POST /api/config/:uin`** |
| `runtime.json` (global runtime) | ⚠️ Some fields are on a **boolean allowlist** and can be hot-reloaded | `hookAutoLoad` / `webuiTls.enabled` are on the allowlist; everything else needs a restart |
| `ui.json` (WebUI appearance) | ✅ Available through the API | `POST /api/ui` |
| `webui.json` (password) | ✅ Go through the API | `POST /api/auth/change-password` |

#### Root cause two: you edited the wrong directory (**chatluna lives in `/data/instance/`, not `/app/`**)

**This is the easiest point to confuse** — the container contains **two completely different directory prefixes**:

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

> **How to decide**: if you want to change **Haizakura's behavior** → look under `/app/`;
> if you want to change **chatluna (the external bot framework it connects to)** → look under `/data/instance/`.
> **The two are not connected.**

#### Root cause three: the container is not the one you think it is

```bash
# 确认你改的是正在运行的那个容器
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect <容器> --format '{{json .HostConfig.Binds}}'
```

> ⚠️ **Pay special attention**: there may be **old stopped containers** (for example `snowluma` is the old one,
> whose configuration uses `#sl`; the active one is `snowluma-hz`, whose configuration uses `#hz`).
> **Editing the right file but in the old container's volume = wasted effort.**

#### Fix: locate first, then change

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

### T10 File transfers between machines get truncated

#### Symptom

```
- scp 传过去的文件大小不对（16 KB 的 tgz 变成 672 KB 或 0 字节）
- 或者：文件长度看起来正常，但内容是坏的
  （遇到过 262 字节 vs 262 字节，md5 不同）
```

#### Root cause

```
① 传输被中断（SSH 空闲断连、网络抖动）
② 二进制文件经过文本管道被改写（换行符转换、编码损坏）
③ ★ 文件长度相同 ≠ 内容相同
```

#### Fix

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

#### ★ You must verify on both ends

```bash
# 本地
sha256sum local-file.tgz
# 远端
ssh <host> 'sha256sum /remote/path/file.tgz'

# 值必须【完全一致】
```

> **Lessons**:
> - **Identical file length does not mean identical content** — do not treat `ls -l` as verification
> - **You must use sha256/md5**; do not go by size alone
> - For long transfers, use a background task plus log polling (`setsid nohup ... &`); an idle SSH disconnect will kill foreground tasks

---

### T11 Injected into zygote, breaking QQ's IPC and login UI

#### Symptom

```
- QQ 界面白屏 / 登录界面异常 / QQ 的进程间通信失灵
- 日志里出现 "auto-load skip: PID=%d is an Electron child process (--type=%s)"
- 或者：hook 好像生效了但 QQ 本身坏掉了
```

#### Root cause

**Electron child processes get misidentified as "the main QQ process"**, for two stacking reasons:

```
① 子进程（zygote / renderer / gpu / utility）的 cmdline 里也含 "qq"
② 它们通过 fork 的 copy-on-write 会【短暂继承 wrapper.node 映射】

→ .node 的进程枚举器把它们错认成"主 QQ"
```

**The consequences are severe**:

```
注进 zygote → 在 zygote 里启动 hook 的 resolver 线程
            → 之后 Electron fork 出的【每个 renderer 都会继承该线程
              + 半初始化的 hook 状态】
            → 【直接搞坏 QQ 的 IPC 和登录界面】
```

**Verbatim from the source comments**:

> *"Injecting into a zygote spawns the hook's resolver thread inside it;
> every renderer Electron later forks then inherits that thread + the
> partially-init'd hook state, which breaks QQ's IPC and login UI."*

#### Fix: the filter mechanism (built in, enabled by default)

The logic of `shouldAutoLoadPid()` in the source:

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

**The discriminator is very simple and very effective**: read `/proc/<pid>/cmdline` and skip anything containing `--type=`.
The main QQ process's cmdline is `qq --no-sandbox --disable-gpu …`, which does **not** contain `--type=`.

#### Three switches

| Switch | Effect | Risk |
|---|---|---|
| `shouldAutoLoadPid()` (default behavior) | Automatically skips processes with `--type=` | ✅ Safe; leave it at the default |
| `SNOWLUMA_HOOK_AUTOLOAD_ALL=1` | **Lets every PID through** (escape hatch) | ⚠️ **It will inject into zygote and break QQ** |
| `POST /api/processes/:pid/load` | **Manual load, bypassing the gate** | ⚠️ The operator owns the consequences |

#### Verification

```bash
# ① 确认注的是主进程，不是子进程
docker exec <容器> sh -c 'ps -eo pid,args | grep -E "qq --" | grep -v -- --type='

# ② 确认跳过日志
docker exec <容器> sh -c 'grep -oE "auto-load skip: PID=[0-9]+ is an Electron child process[^\"]*" \
  /app/data/logs/$(date +%F).log | sort -u'

# ③ 确认 socket 的 pid 是主进程
docker exec <容器> sh -c 'ls /tmp/runtime-*/mojo.*.control.sock'
```

**Corroborating evidence**: the `.so` contains another layer of guard, `isTransientLibcMappingError()`,
which matches `"target process does not map /libc.so.6 while resolving mmap"` —
showing that **the injector requires the target process to have libc mapped** (that is, dynamic linking already done),
which early zygote happens not to satisfy.

---

### T12 Automatic updates always fail (404)

#### Symptom

```
- 日志里反复出现更新检查失败
- GET /api/update/check 报 404 / 网络错误
```

#### Root cause

```
上游仓库已被删除：
  https://api.github.com/repos/SnowLuma/SnowLuma/releases/     → 404
  https://github.com/SnowLuma/SnowLuma/releases/download/v…    → 404
```

**It is not a network problem and not a mirror problem — the repository really is gone.**

#### Fix

Three ways; pick one:

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

**Three modes** (`update/sources.ts`):

| Mode | Behavior |
|---|---|
| `auto` (default) | Try direct first, then fall back through the mirrors one by one (`mirrors`, at most 16) |
| `direct` | Direct only |
| `mirror` | Only the mirrors you supply |

**The default mirror list** (**all of them point at GitHub, hence all 404**):

```
https://ghfast.top          https://ghproxy.net
https://gh-proxy.com        https://github.chenc.dev
https://fastgit.cc          https://gh.noki.icu
https://cors.isteed.cc      https://gh-proxy.org
https://githubproxy.gohj99.site   https://github.xxlab.tech
```

#### Verification

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  https://api.github.com/repos/SnowLuma/SnowLuma/releases/
# 期望：404（确认仓库已删）
```

> ⚠️ **Mandatory item for whoever takes over**: `update/sources.ts` is one of the files that **must** be changed.
> Related WebUI routes: `GET /api/update/check`, `GET/POST /sources`, `POST /sources/test`, `POST /download`.

---

### T13 Logs take up more and more disk space

#### Symptom

```
- 磁盘空间被日志吃掉
- 实测约 11 MB/天
```

#### Root cause

```
默认：logMaxTotalMb = 1024（总量上限 1 GB）
      logRetainDays = 7（保留 7 天）
      logPerUin    = false（不按账号分文件）

→ 稳态大约 80 MB 常驻（7 天 × 11 MB/天）
   —— 但如果流量大，会更快接近 1 GB 上限
```

#### Fix

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

#### Verification

```bash
docker exec <容器> sh -c 'du -sh /app/data/logs/; ls -la /app/data/logs/'
```

#### Related: WebUI storage cleanup

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/system/storage
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/system/storage/cleanup
```

> **Note**: `messages.db` grows with the message volume (measured at 70.8 MB + 4 MB WAL at one point).
> Under heavy traffic, keep an eye on the total size of `/app/data/data/<uin>/`.

---

### T14 Other WebUI login pitfalls

#### T14.1 Login is rate-limited (429)

```
症状：返回 {"success":false,"message":"登录尝试过多，请 N 秒后重试"}
根因：同 IP 连续密码错误触发锁定（loginAttempts 按 IP 计数）
解决：等剩余秒数；或从另一个 IP 访问；或重启 runtime 清空计数
```

> **The rate-limit key** depends on the `trustProxy` configuration: by default it counts by **socket peer**.
> If you are behind a reverse proxy and do not configure `trustProxy`, every user is treated as the same IP.

#### T14.2 After a successful login you still have to accept the agreement / change the password

```
症状：除白名单路由外，所有 API 返回 403
      {"status":"failed","message":"请先阅读并同意用户协议与隐私政策","consentRequired":true}
      {"status":"failed","message":"请先修改密码","mustChangePassword":true}
根因：两个独立门禁
解决：consentGatePending → POST /api/agreements/record-consent
      mustChangePassword → POST /api/auth/change-password
批量部署：SNOWLUMA_ACCEPT_EULA=1 SNOWLUMA_ACCEPT_PRIVACY=1
```

> When `EULA.md` / `PRIVACY.md` are missing, it warns:
> `[WebUI.Consent] agreement file not found (looked for EULA.md near the bundle and repo root)`

#### T14.3 You cannot get the real client IP behind a reverse proxy

```
症状：所有请求的「客户端 IP」都是反代的地址
根因：trustProxy 未配 / 配错
解决：runtime.json 的 trustProxy 设成：
      ""          关闭（默认，按 socket peer）
      "all"       信任任何 peer 的 X-Real-IP / X-Forwarded-For
      "loopback"  仅当 socket peer 是回环时信任
      "ip-list"   仅当 socket peer 在指定 IP 列表内时信任
```

#### T14.4 The WebUI port is already in use

```
症状：WebUI 起不来
根因：端口冲突。注意容器映射后【容器内仍是 5099】，宿主机是 5199
解决：确认容器内监听 5099；换宿主机映射端口，而不是改容器内端口
相关源码：findAvailablePort(start, { maxTries: 50, host }) —— 会向上找 50 个可用端口
```

---

### T15 Reverse-engineering / debugging scripts take down your own machine

**This is not a runtime pitfall but a maintenance-time pitfall** — the price, however, is steep enough to deserve its own entry.

#### Symptom

```
- 跑分析脚本时负载飙到 37
- 内存被吃到 2.7 GB
- 终端被吐 10 MB 文本
- 脚本 struct.error 崩掉
```

#### Root cause (table of known traps)

| # | Trap | Consequence | The right way |
|---|---|---|---|
| **T1** | Treating a subset of "defined exports" as "all symbols" | **Leads to the false conclusion that "there is no RTTI in dynsym"** (there are in fact 397) | Always go back to the raw `readelf -sW --dyn-syms` output |
| **T2** | Searching typeinfo by the literal `"MSFService"` | **0 hits** (`__type_name` is the mangled `N2nt10MSFServiceE`) | Match the `N<len><ns><len><Class>E` pattern; exclude log TAGs / JS property names |
| **T3** | Treating a `.data.rel.ro` vaddr as a file offset | The whole table is off by `0x10000` | Compute `Δ = vaddr − file_off` from the section table; **never hard-code it** |
| **T4** | Doing `b[:z]` on an `mmap` slice when `z == -1` (no NUL) | **10 MB of output in one go** | Assert `z > 0` before deriving any string |
| **T5** | Parsing `.eh_frame_hdr` encoding bytes incorrectly (reading pcrel as unsigned) | Yields `fde_count=1.8e19` → **out-of-bounds/infinite loop → OOM (2.7 GB)** | Handle `enc & 0x0f` and `enc & 0x70` separately; **put an upper bound on every loop** |
| **T6** | Taking "the first slot whose value equals the typeinfo" as the primary vtable | MSFService has **5** address points; you will pick the wrong one | You must filter for the primary by **`offset_to_top == 0`** |
| **T7** | Concluding the adaptation succeeded just because "the process did not crash" | A one-slot error → silently sends down the wrong path → the user sees `"The QQ connection changed…"` | You must run an end-to-end test that **actually sends and receives messages** |

#### Side traps (at the tooling level)

| Trap | Consequence | The right way |
|---|---|---|
| The bundle contains NUL bytes | `grep -oE` truncates lines (yields only 147 regions) | Use `grep -a`; extract regions with a **Python regex** (yields 467) |
| `strings` mistakes ARM64 machine code for text | Out of 4,519 lines, ~3,600 are noise | The real strings are concentrated in **lines 1–176** and **lines 3799–4050** |
| The bundle embeds a 330 KB zxcvbn password dictionary (a single line) | `grep -C` dumps the whole dictionary to the terminal | Use `grep -an` for line numbers only; or locate first with `sed -n 'A,Bp'` |
| `grep -c <keyword>` lies to you on the bundle | The `backoff`/`jitter`/`circuit` "hits" are all that one dictionary line | **Look at the line-number distribution, not the count.** If the count is 1–3 and all point at the same line → false positive |
| Running long tasks in the foreground | SSH disconnects after ~10 minutes idle and the task dies with it | `setsid nohup … &` + poll with `tail -c 800 log \| tr '\r' '\n' \| tail` |

#### Iron rules

> **You must put count limits on reverse-engineering scripts.**
> Getting a loop boundary wrong once can push the load average to 37 and memory to 2.7 GB.
> Give every `struct.unpack_from` an explicit `cnt` bound, check `i < cnt` up front,
> and **never send large objects to stdout** (write everything to files).

---

## 4. Appendix A: The complete list of `SNOWLUMA_*` environment variables (36)

| Variable | Purpose |
|---|---|
| `SNOWLUMA_HOOK_AUTOLOAD_ALL` | `=1` lets every PID be auto-injected, **bypassing the zygote filter** (dangerous) |
| `SNOWLUMA_HOOK_AUTOLOAD` | Overrides `hookAutoLoad` in `runtime.json` |
| `SNOWLUMA_HOOK_RUNTIME_DIR` | Specifies the directory containing `mojo.*.sock` |
| `SNOWLUMA_HOOK_ACK_TIMEOUT_MS` | Control-channel ACK timeout (default 5000) |
| `SNOWLUMA_PACKET_TIMEOUT_MS` | Business packet timeout |
| `SNOWLUMA_SESSION_RELEASE_DEADLINE_MS` | Session release deadline |
| `SNOWLUMA_STREAM_DIR` | Directory where streaming downloads land (warns and ignores if invalid) |
| `SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES` | Upper size limit for binary downloads |
| `SNOWLUMA_HTTP_DOWNLOAD_TIMEOUT_MS` | HTTP download timeout |
| `SNOWLUMA_DOWNLOAD_FILE_TIMEOUT_MS` | `download_file` action timeout (⚠️ different from the previous one) |
| `SNOWLUMA_NOTIFICATION_HTTP_TIMEOUT_MS` | Notification webhook timeout |
| `SNOWLUMA_UPDATE_ROOT` | Update root directory (development/testing update flow) |
| `SNOWLUMA_UPDATE_CHECK` | Whether to check for updates (**set to 0 is recommended now that upstream deleted the repository**) |
| `SNOWLUMA_WEBUI_PORT` | WebUI port (default 5099) |
| `SNOWLUMA_WEBUI_HOST` | WebUI bind address |
| `SNOWLUMA_WEBUI_TARGET` | UI theme preset; **the only legal value is `maibot`** |
| `SNOWLUMA_WEBUI_TLS` | Overrides `webuiTls.enabled` |
| `SNOWLUMA_WEBUI_TRUST_PROXY` | Overrides `trustProxy` |
| `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD` | Injects the WebUI password on first start (**fewer than 8 characters is ignored**) |
| `SNOWLUMA_ONEBOT_HTTP_PORT` | OneBot HTTP port |
| `SNOWLUMA_ONEBOT_WS_PORT` | OneBot WS port |
| `SNOWLUMA_ONEBOT_HOST` | OneBot bind address (the production instance uses `0.0.0.0`) |
| `SNOWLUMA_LOG_DIR` | Log directory (default `/app/data/logs`) |
| `SNOWLUMA_LOG_FILE` | `=0` disables file logging |
| `SNOWLUMA_LOG_LEVEL` | Console level; default `info` |
| `SNOWLUMA_LOG_FILE_LEVEL` | File level; only `debug/info/success/warn/error` |
| `SNOWLUMA_LOG_MAX_MB` | Per-file size limit |
| `SNOWLUMA_LOG_MAX_TOTAL_MB` | Total log size limit (default 1024) |
| `SNOWLUMA_LOG_RETAIN_DAYS` | Log retention in days (default 7) |
| `SNOWLUMA_LOG_PER_UIN` | Split files by uin |
| `SNOWLUMA_TRACE_BUFFER` | Number of trace buffer entries |
| `SNOWLUMA_VERBOSE_WARMUP` | `=1` prints warmup details |
| `SNOWLUMA_DEV_MODE` | Development mode (uses the fixed `snowluma-dev` password) |
| `SNOWLUMA_DEV_WEBUI` | Development-mode WebUI |
| `SNOWLUMA_DEV_NO_NATIVE` | `=1` replaces the native addon with a stub |
| `SNOWLUMA_ACCEPT_EULA` | Accept the EULA non-interactively |
| `SNOWLUMA_ACCEPT_PRIVACY` | Accept the privacy policy non-interactively |
| `SNOWLUMA_HOME` / `SNOWLUMA_DATA` | Runtime directory / data directory (production: `/app/runtime` / `/app/data`) |
| `SNOWLUMA_UID` / `SNOWLUMA_GID` | Runtime identity inside the container (production: 1000/1000) |
| `SNOWLUMA_SCREEN` | Xvfb screen size (production: `1920x1080x24`) |
| `SNOWLUMA_QQ_FLAGS` | Startup flags passed to QQ |
| `SNOWLUMA_EXTRA_QQ_HOMES` | Additional QQ HOME directories |
| `QQ_RECV_HEARTBEAT_CMD` | **【Not fully determined】** presumably the name of QQ's receive-heartbeat command |

> ⚠️ **The cross-process path of `SNOWLUMA_HOOK_RUNTIME_DIR` depends on `/proc/<pid>/environ` being readable** —
> that works within the same uid, but **fails across uids**. 【Not fully determined】

---

## 5. Appendix B: The complete set of `runtime.json` fields

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

> **Hot-reloadable fields**: `hookAutoLoad` / `webuiTls.enabled` are a **boolean allowlist**.
> The other fields **require a restart** after you edit the file.

---

## 6. Appendix C: One-line troubleshooting mnemonics

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

## 7. Related documents

| To learn about | Go to |
|---|---|
| How it actually works | [architecture.md](architecture.md) |
| Which versions are supported / what it depends on | [compatibility.md](compatibility.md) |
| How to build from source | [build.md](../dev/build.md) |
| How to contribute to development | [contributing.md](../dev/contributing.md) |

---

*Every command and error message in this document comes from measurement. The evidence levels keep their original labels:
【Confirmed】direct evidence / 【Strong inference】multiple lines of evidence cross-check / 【Inference】reasonable but unverified / 【Not fully determined】a clearly identified knowledge gap.*
