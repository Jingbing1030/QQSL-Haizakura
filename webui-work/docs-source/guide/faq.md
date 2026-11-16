# 常见问题（FAQ）

> [!WARNING]
> 本内容完全由 AI 编写，请谨慎查看。

> 本文包含两类内容：**通用问题**（对标 LLBot 的 FAQ 场景）
> 和 **我们真实踩过的坑**（这部分比通用 FAQ 更有价值）。

---

## 1. 通用问题

### 1.1 为什么只能本机访问，局域网 / 公网连不上？

**出于安全考虑，应用默认只监听 `127.0.0.1`。**

【确证】源码默认值：

| 配置 | 默认值 | 位置 |
| --- | --- | --- |
| `webuiHost` | `127.0.0.1` | `common/src/runtime.ts:194` |
| `httpServers[].host` | `127.0.0.1` | `onebot/src/config.ts:42` |
| `wsServers[].host` | `127.0.0.1` | `onebot/src/config.ts:54` |

**但容器场景不一样**：Docker 容器有自己的网络命名空间，
如果只监听 `127.0.0.1`，那么**映射出来的宿主机端口永远连不上**。

所以容器 entrypoint 会做一次播种（`/root/start.sh`）：

```javascript
// 仅当 webuiHost 缺失或为空时
if (typeof runtimeConfig.webuiHost !== 'string' || !runtimeConfig.webuiHost.trim()) {
  runtimeConfig.webuiHost = '0.0.0.0';
}

// 把 host 是 loopback 的适配器改成对外 host
const bindPublishedHost = (adapter) => {
  if (!isLoopbackHost(adapter.host)) return false;
  adapter.host = onebotHost;   // SNOWLUMA_ONEBOT_HOST，默认 0.0.0.0
  return true;
};
```

**修复步骤**：

| 目标 | 怎么做 |
| --- | --- |
| 局域网 / 公网访问 WebUI | WebUI 里改监听地址为 `0.0.0.0`，或直接改 `runtime.json` 的 `webuiHost` |
| 局域网 / 公网调用 OneBot | 改适配器的 `host` 为 `0.0.0.0` |
| 只想本机访问 | 保持 `127.0.0.1`，用 SSH 隧道 |

> ⚠️ **暴露到公网前必须做两件事**：
> ① OneBot 适配器**必须设强令牌**（源码强制 ≥16 字符且不能弱）
> ② WebUI **建议**走反向代理 + 配 `trustProxy`，
> 因为 `/api/debug/invoke` **等于远程执行任意动作**。

**SSH 隧道方案（最安全）**：

```bash
ssh -L 5199:127.0.0.1:5199 -L 3010:127.0.0.1:3010 用户@服务器
# 然后本地访问 http://127.0.0.1:5199
```

---

### 1.2 忘记 WebUI 密码怎么办？

WebUI 凭据在 `config/webui.json`（【确证】`core/src/webui/auth.ts`）：

```json
{
  "passwordHash": "<128 位十六进制 scrypt 哈希>",
  "passwordSalt": "<32 位十六进制盐>",
  "mustChangePassword": false,
  "generatedAt": "...",
  "updatedAt": "..."
}
```

用的是 **`scryptSync`**（`N=16384, r=8, p=1`，keylen 64）——**哈希不可逆**。

**三个办法**：

| 办法 | 步骤 | 风险 |
| --- | --- | --- |
| **① 删掉凭据文件让系统重建** | 停容器 → 删 `config/webui.json` → 启动 → 用引导流程设新密码 | ⚠️ **需要重启 → 会丢 QQ 登录态** |
| **② 首次启动注入环境变量** | 用 `-e SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD='<强密码>'`（**要求 ≥8 字符**） | 仅首次生效 |
| **③ 直接改哈希** | 用同参数算出 scrypt 哈希，替换 `passwordHash` | 需保持 `N=16384, r=8, p=1, keylen=64` |

**密码强度要求**（【确证】`PASSWORD_RULES`，5 条全满足才算强）：

| 规则 | 要求 |
| --- | --- |
| `length` | **不少于 10 位** |
| `lower` | 含小写字母 |
| `upper` | 含大写字母 |
| `special` | 含特殊符号（`!@#$%…`） |
| `no-space` | 不含空格 |

> 💡 注意 `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD` 只要求 **≥8 字符**，
> 而 WebUI 的强度检查要求 **≥10 位 + 四类字符**。两者标准不同。

> ⚠️ 另有两个相关机制：**TOTP 两步验证**（`/api/auth/totp/*`，RFC 4226/6238）
> 和**恢复码**（`/api/auth/totp/recovery-codes`）。
> 如果开了 TOTP 又丢了，同样要删凭据文件。
>
> ⚠️ 若设了 `SNOWLUMA_DEV_MODE=1`，改密码会直接报错
> 「开发模式 (SNOWLUMA_DEV_MODE=1) 已禁用密码修改」。

---

### 1.3 发不了图片 / 语音 / 视频？

按顺序排查：

| 检查 | 说明 |
| --- | --- |
| ① 文件权限 | 容器内 `snowluma` 用户（uid 默认 1000）需要对 `/app/data` **有写权限** |
| ② `SNOWLUMA_STREAM_DIR` | 流式接口的落地目录（默认 `$TMPDIR/onebot-stream`）；非法值会被警告并回退 |
| ③ 下载大小上限 | `SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES` |
| ④ 下载超时 | `SNOWLUMA_HTTP_DOWNLOAD_TIMEOUT_MS`（默认 60000 ms） |
| ⑤ **视频上传并发** | `snowluma.json` 的 `videoUploadConcurrency`（1–4，默认 1） |
| ⑥ 磁盘空间 | `docker exec haizakura df -h /app/data` |
| ⑦ 状态指令验证 | 先发状态指令确认链路通 |

> 💡 **Haizakura 不需要单独装 FFmpeg**（与 LLBot 不同）——
> 它自带 `native/ffmpeg/ffmpegAddon.linux.arm64.node`。

**权限修复**：

```bash
docker exec haizakura ls -la /app/data
docker exec haizakura chown -R 1000:1000 /app/data
```

---

### 1.4 怎么用 CQ 码而不是数组格式？

**改 `messageFormat` 为 `"string"`**（【确证】`config.ts:747-749`，只接受 `"array"` 或 `"string"`）：

```json
{
  "networks": {
    "wsServers": [
      {
        "name": "ws-default",
        "messageFormat": "string"
      }
    ]
  }
}
```

| 值 | 格式 |
| --- | --- |
| `"array"`（默认） | `[{"type":"text","data":{"text":"hi"}}]` |
| `"string"` | `"hi[Cat:face,id=1]"` |

> 顶层也可以写 `messageFormat` 作为**所有适配器的默认值**（兼容旧布局）。

---

### 1.5 Docker 里怎么访问宿主机？

**不要用 `127.0.0.1`** —— 那指向容器自己。

| 平台 | 宿主机地址 |
| --- | --- |
| Linux | `172.17.0.1`（默认 bridge 网关）或 `--add-host=host.docker.internal:host-gateway` |
| Docker Desktop（Mac/Win） | `host.docker.internal` |

**推荐**（跨平台）：

```bash
docker run ... --add-host=host.docker.internal:host-gateway ...
```

然后配置里用 `http://host.docker.internal:8080`。

> ⚠️ **Mac 用户注意**：社区经验是**用 OrbStack 而不是 Docker Desktop**，
> 否则 QQ 可能起不来。这是 LLBot 社区踩的坑，Haizakura 同属 Electron QQ，**大概率同样适用**。

---

### 1.6 如何在登录之前就配好？

**容器 entrypoint 已经帮你做了播种**（【确证】`/root/start.sh`）：

首次启动（`onebot.json` 不存在）时，会自动生成：

```json
{
  "networks": {
    "httpServers": [{ "name": "http-default", "host": "<SNOWLUMA_ONEBOT_HOST>", "port": 3000, "path": "/", "accessToken": "<随机32字节>", "messageFormat": "array", "reportSelfMessage": false }],
    "wsServers":   [{ "name": "ws-default",   "host": "<SNOWLUMA_ONEBOT_HOST>", "port": 3001, "path": "/", "role": "Universal", "accessToken": "<随机32字节>", "messageFormat": "array", "reportSelfMessage": false }],
    "httpClients": [], "wsClients": []
  }
}
```

**关键设计**：**只在你删掉了适配器时才不重建** ——
如果 `httpServers` 是**存在的空数组**，entrypoint **不会**把它加回来。

```javascript
// 首次启动（文件不存在）才给默认监听；
// 已存在的空列表 = 操作者主动删掉了，不要每次重建容器又塞回来
const ensureServers = (key, fallback) => {
  if (!Array.isArray(nets[key])) {
    if (!existed) { nets[key] = [fallback]; changed = true; }
    return;
  }
  if (nets[key].length === 0) return;   // ← 空数组 = 尊重操作者
  // 把 loopback 的 host 改成对外 host
};
```

**所以想预配置**：起容器前**先把 `onebot.json` 放进卷里**，
或用 `docker cp` 放进去，再启动。

> 💡 **修正一个 LLBot 时代的概念**：Haizakura **没有 `default_config.json` 继承机制**。
> 它的等价物是**「全局 `onebot.json` + 每账号 `onebot_<uin>.json` 的 overlay 合并」**
> （见 [配置说明 §0.2](configuration.md)）。
> 只有 `onebot_<uin>.json` 写了 `"mode": "snapshot"` 才会忽略全局。

---

### 1.7 日志文件越来越大 / 日志突然不写了

### 日志滚动机制

【确证】`log-file-transport.ts`：

| 参数 | 默认 | 环境变量 |
| --- | ---: | --- |
| 单文件上限 | **50 MB** | `SNOWLUMA_LOG_MAX_MB` |
| 总量上限 | **1024 MB** | `SNOWLUMA_LOG_MAX_TOTAL_MB`（也可用 `runtime.json` 的 `logMaxTotalMb`） |
| 保留天数 | **7 天** | `SNOWLUMA_LOG_RETAIN_DAYS`（`logRetainDays`） |
| 按账号分文件 | `false` | `SNOWLUMA_LOG_PER_UIN`（`logPerUin`） |

文件命名：

```
snowluma-YYYY-MM-DD.log          当天
snowluma-YYYY-MM-DD.N.log        滚动分片
snowluma-<uin>/...               按账号模式（目录名为纯数字）
```

### ⚠️ 坑：超配额后日志会「静默丢弃」

这是**很容易被误判为「程序卡死了」的坑**。

【确证】`LogQuota.reserve()`（`log-file-transport.ts:198-221`）：

```javascript
reserve(filePath, bytes) {
  if (bytes <= 0) return true;
  if (this.degraded && !this.retry(false)) {
    this.droppedLines += 1;     // ← 悄悄丢一行
    return false;
  }
  if (!this.ensureCapacity(bytes)) {
    this.droppedLines += 1;     // ← 悄悄丢一行
    return false;
  }
  ...
}
```

**行为**：

| 状态 | 表现 |
| --- | --- |
| 健康 | 正常写 |
| **超配额 / 存储异常** | 进入 `degraded` 状态 → **日志行被静默丢弃**，只累加 `droppedLines` 计数 |
| 重试 | 每 **5000 ms**（`QUOTA_RETRY_MS`）重试一次 |

**症状**：日志文件不再增长，但程序其实还在跑。
**误判风险**：你会以为「进程挂了」，其实只是**日志写不进去**。

**怎么查**（【实测】`GET /api/system/storage` 的返回结构）：

```bash
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:5199/api/system/storage
```

返回：

```jsonc
{
  "settings": {
    "saved":     { "logMaxTotalMb": 1024, "logRetainDays": 7, "logPerUin": false },
    "effective": { "logMaxTotalMb": 1024, "logRetainDays": 7, "logPerUin": false },
    "envOverrides": []            // ← 哪些项被环境变量覆盖了
  },
  "snapshot": {
    "logs": {
      "state": "healthy",         // ← healthy | warning | degraded
      "totalBytes": 313412,
      "fileCount": 1,
      "activeFileCount": 1,
      "droppedLines": 0,          // ← ★ 被静默丢弃的行数
      "maxTotalBytes": 1073741824,
      "retainDays": 7,
      "perUinEnabled": false
    },
    "temporary": { ... },
    "accounts": [ ... ],
    "totals": { "logsBytes": ..., "temporaryBytes": ..., "accountDataBytes": ..., "managedBytes": ... }
  },
  "lastCleanup": null
}
```

> 🔍 **看两个字段就够**：`snapshot.logs.state` 和 `snapshot.logs.droppedLines`。
> `droppedLines > 0` 或 `state != "healthy"`，说明**日志正在被丢弃**。

**修复**：

| 手段 | 命令 / 位置 |
| --- | --- |
| WebUI 清理 | `POST /api/system/storage/cleanup` |
| 调小保留 | `logRetainDays` / `SNOWLUMA_LOG_RETAIN_DAYS` |
| 调大总量 | `logMaxTotalMb` / `SNOWLUMA_LOG_MAX_TOTAL_MB` |
| 关掉文件日志 | `SNOWLUMA_LOG_FILE=0` |
| 降文件级别 | `SNOWLUMA_LOG_FILE_LEVEL=warn` |

> ⚠️ **手动删日志文件后可能仍处于 `degraded`**：
> 源码里有这条告警 ——
> `managed logs still use N bytes after manual cleanup, exceeding the M byte limit`。
> 说明它**重新统计后仍然超限**（可能有它没管的文件占着空间）。

---

### 1.8 容器 `ExitCode 126` / `Operation not permitted`

**这是部署阶段最常见的失败。**

**症状**：

```
ExitCode = 126
日志: /root/start.sh: line 161: /usr/local/bin/node: Operation not permitted
```

**原因**：注入器需要 `ptrace` + `process_vm_writev` 附加到 QQ 进程，但：

| 缺什么 | 后果 |
| --- | --- |
| `--cap-add SYS_PTRACE` | **hook 装不上** |
| `--security-opt seccomp=unconfined` | **容器起不来**（默认 seccomp 拦截 `ptrace`） |

**修复**：

```bash
docker run ... \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  ...
```

**【实测】** 补上这两项后**一次启动成功**。

> 📌 `--privileged` 也能work，但权限过大，**不推荐**。

---

### 1.9 hook 装不上 / 日志里有 `unresolved`

**检查 hook 健康度**：

```bash
docker exec haizakura grep -c unresolved /app/data/logs/*.log
```

| 结果 | 含义 |
| --- | --- |
| **`0`** | ✅ **hook 健康** |
| `>0` | ❌ RTTI 链解析失败 |

**`unresolved` 意味着什么**：`.so` 里的「唯一验证闸门」没通过 ——
它用 **RTTI 结构匹配**（不是字符串匹配）去找 `nt::MSFService` /
`nt::MSFCoreService`，失败了。

**常见原因**：

| 原因 | 说明 | 怎么办 |
| --- | --- | --- |
| **QQ 版本变了** | `wrapper.node` 的 RTTI / vtable 布局变了 | 用 `dump-vtable.py` diff 基线，见 [参与开发](../dev/contributing.md) |
| 缺 `SYS_PTRACE` | 注入根本没成功 | 见 §1.8 |
| zygote 被注入了 | 见 §1.10 | 检查 `SNOWLUMA_HOOK_AUTOLOAD_ALL` |
| 内核禁 `ptrace` | 加固内核（如带 Yama 限制） | 检查 `kernel.yama.ptrace_scope` |

**确认 QQ 版本与基线是否一致**：

```bash
docker exec haizakura md5sum /app/runtime/../.config/... # 定位 wrapper.node
# 期望 md5: adeb40af26d859d41fcdb21bf38d9eb5
```

---

### 1.10 ⚠️ 千万不要随便开 `SNOWLUMA_HOOK_AUTOLOAD_ALL`

**这是文档里最需要警告的一项。**

正常流程会**过滤掉 Electron 的 zygote 与子进程**，只注入主 QQ 进程。
`SNOWLUMA_HOOK_AUTOLOAD_ALL=1` **绕过这个过滤**。

**【确证】后果**：

> 注入进 zygote 会**在 zygote 里启动 hook 的 resolver 线程**；
> 之后 Electron fork 出的**每个 renderer 都会继承该线程 + 半初始化的 hook 状态**，
> 直接**搞坏 QQ 的 IPC 和登录界面**。

**症状**：QQ 界面异常、登录不上、各种玄学问题。

**什么情况下才用它**：**排查「为什么主进程没被注入」时临时开**，
用完立刻关掉并重启。

---

## 2. ⭐ 我们真实踩过的坑

> 这些是**代价换来的经验**，比通用 FAQ 有价值。建议全读一遍。

### 坑 1：🔴 重启容器会丢 QQ 登录态（最痛）

**这是本项目最大的运维陷阱。**

| 项目 | 说明 |
| --- | --- |
| **现象** | 重启容器后 QQ 需要**重新扫码登录** |
| **原因** | `/app/.config/QQ/auth/login.enc` 的 `loginList` 被清空 |
| **代价** | **我们曾因此让生产 bot 停摆 8 小时** |
| **为什么痛** | 扫码需要**人工介入**（打开 noVNC 用手机扫） |

**故障链**：

```
重启容器 → 登录态丢失 → Haizakura 拿不到 MSF 会话
        → 所有动作返回 "not logged in" → ⛔ bot 完全不可用
```

**结论**：

| 原则 | 做法 |
| --- | --- |
| **非必要不重启** | 改配置**优先走 WebUI / API 热加载** |
| 必须重启时 | **安排有人能扫码的时间窗口** |
| 重启前 | 确认手边有手机 QQ |
| 接受现实 | 把「重启需重新扫码」当**既定事实**做预案 |

**哪些操作是热加载的（不会丢登录态）**：

| 改动 | 热加载 |
| --- | --- |
| OneBot 网络配置 | ✅ |
| `statusCommand` | ✅ |
| `notifications` | ✅ |
| 日志级别 | ✅ |
| hook 加载 / 卸载 | ✅ |
| **`historySync.enabled`** | ❌ 仅启动时读 |
| **环境变量 / 代码** | ❌ 需重建容器 |

详见 [配置说明 §11](configuration.md)。

---

### 坑 2：noVNC 被 HSTS 强制升级成 https

| 项目 | 说明 |
| --- | --- |
| **现象** | `http://<IP>:6181` 打不开，浏览器自动跳 https |
| **原因** | 浏览器 **HSTS** 策略把该地址强制升级为 https，而 noVNC 是纯 http |
| **修复** | ① 用**纯 IP**（不要域名）② 换浏览器 ③ 清该 IP 的 HSTS 记录 |

**Chrome 清 HSTS**：`chrome://net-internals/#hsts` → Delete domain security policies。

---

### 坑 3：改了 `#hz` 之类配置「不生效」

**两个层面的原因，都要查。**

**原因 A：配置优先级 / `mode` 问题**

【确证】`onebot_<uin>.json` 若写了 `"mode": "snapshot"`，
**全局 `onebot.json` 对它完全无效**。

```
onebot.json（全局）
      ↓ 仅在非 snapshot 时叠加
onebot_<uin>.json（每账号）
```

| 你可能改了 | 但实际生效的是 |
| --- | --- |
| 全局 `onebot.json` 的 `statusCommand` | ⚠️ **会被 per-uin 的值覆盖**（见下）—— 不是"全局不支持"，而是**优先级输了** |
| `onebot.json` 的某个适配器 | per-uin 里**同名适配器**会整体覆盖它 |

> 📌 **为什么改全局的 `statusCommand` 通常没用**（【确证】两条事实叠加）：
>
> **事实 1**：`parseStatusCommand(sources)` 会**遍历所有来源**，后面的覆盖前面的。
> 非 snapshot 时 `sources = [全局, per-uin]` → **per-uin 赢**。
>
> **事实 2**：`toJsonObject()`（`config.ts:498-517`）保存 per-uin 时**总是**写入
> `statusCommand` / `historySync` / `notifications` 三个节 ——
> **即使你没显式设过，它也会写入默认值**。
>
> **两者叠加的结论**：per-uin 文件里**永远有** `statusCommand`，
> 所以**它永远赢**。你在全局改 `trigger`，会被 per-uin 的默认值（或旧值）盖掉。
>
> **【实测】** 观察到的 `onebot.json`（全局）确实只有 `networks` 一节 ——
> 因为它是容器 entrypoint 播种生成的，而播种逻辑只写 `networks`。
>
> ✅ **所以：状态指令 / 历史回填 / 通知渠道请一律改在 `onebot_<uin>.json` 里。**
> （或者说：**用 WebUI / `POST /api/config/:uin` 改**，别手改全局文件。）

**原因 B：没有热加载**

| 配置 | 是否热加载 |
| --- | --- |
| `statusCommand` | ✅ 改完即生效（走 WebUI / API） |
| `historySync.enabled` | ❌ 仅启动时读 |

**改完没生效的自查**：

```bash
# 1. 确认你改的是哪个文件
docker exec haizakura cat /app/data/config/onebot_<uin>.json | grep -A5 statusCommand

# 2. 确认 mode 是什么
docker exec haizakura grep '"mode"' /app/data/config/onebot_<uin>.json

# 3. 走 API 改（推荐），而不是手动改文件
```

> ⚠️ **`POST /api/config/:uin` 要求提交「完整配置」，不是局部补丁。**
>
> 【确证】`server.ts:1293-1297` 拿到 body 后**直接**跑 `assertValidOneBotConfig(body)`，
> 然后整体存盘。所以：
>
> | 做法 | 结果 |
> | --- | --- |
> | 只发 `{"statusCommand":{...}}` | ❌ **校验失败**（缺 `networks` / `historySync`） |
> | 先 `GET` 拿全量 → 改字段 → `POST` 回去 | ✅ **正确做法** |
>
> ```bash
> BASE=http://127.0.0.1:5199
> TOK="<你的 WebUI 令牌>"
>
> # ① 先取全量
> curl -s -H "Authorization: Bearer $TOK" "$BASE/api/config/<uin>" \
>   | python3 -c 'import json,sys; json.dump(json.load(sys.stdin)["config"], open("/tmp/cfg.json","w"))'
>
> # ② 本地改字段
> python3 - <<'EOF'
> import json
> c = json.load(open('/tmp/cfg.json'))
> c.setdefault('statusCommand', {})['trigger'] = '#hz'
> json.dump(c, open('/tmp/cfg.new.json','w'))
> EOF
>
> # ③ 整体提交
> curl -s -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
>      --data @/tmp/cfg.new.json "$BASE/api/config/<uin>"
> ```
>
> **响应会告诉你是否真的热加载了**（【确证】返回结构）：
>
> ```jsonc
> {
>   "success": true,
>   "saved": true,          // 已写盘
>   "applied": true,        // 已应用到运行中的网络
>   "online": true,         // 该账号当前在线
>   "reloaded": true,       // online && applied  ← 真正热加载成功的标志
>   "errors": [],
>   "message": "配置保存成功，已热重载当前会话。"
> }
> ```
>
> | `message` | 含义 |
> | --- | --- |
> | 配置保存成功，已热重载当前会话。 | ✅ 立即生效 |
> | 配置保存成功，当前会话未在线，将在下次连接时生效。 | ⚠️ 账号没在线 |
> | 配置已保存，但部分网络节点未能应用… | ⚠️ 部分失败，看 `errors` |
>
> 💡 **`GET /api/config/:uin` 拿到的是「合并后」的结果**（【确证】`loadOneBotConfig`
> 把全局 + per-uin 合并后返回，**且不含 `mode` 字段**）。
>
> ⚠️ **所以「GET → 改 → POST」会把文件固化成 `snapshot` 模式。**
>
> 【确证】`saveOneBotConfig` 的默认 mode 是 `"snapshot"`：
>
> ```javascript
> saveJson(..., toJsonObject(config, options.mode ?? "snapshot"));
> ```
>
> 后果：**该账号从此不再继承全局 `onebot.json`**。
>
> | 你想要 | 正确做法 |
> | --- | --- |
> | 只让该账号生效，不继承全局 | ✅ GET → 改 → POST（当前行为正好） |
> | **继续继承全局** | ⚠️ POST 前**手动加** `"mode": "overlay"` 到 body 里 |
>
> ```bash
> # 想保持叠加模式，就显式指定
> python3 -c "
> import json
> c = json.load(open('/tmp/cfg.json'))
> c['mode'] = 'overlay'          # ← 关键
> json.dump(c, open('/tmp/cfg.new.json','w'))
> "
> ```

> 💡 **另注意触发词的匹配语义**：**精确相等、只有单个 text 段**。
> `#hz` + 图片 = 两段 = **不触发**。见 [配置说明 §2.1](configuration.md)。

---

### 坑 4：容器 `ExitCode 126`

见 §1.8。核心是 `SYS_PTRACE` + `seccomp=unconfined` 两项缺一不可。

---

### 坑 5：用 `/dev/tcp` 测试端口得到「假阴性」

**这个坑会误导你的排查方向。**

**现象**：明明端口是通的，但用 `sh -c 'echo > /dev/tcp/...'` 测试失败。

**【实测】** 容器内对比：

```bash
$ docker exec haizakura sh -c '(echo > /dev/tcp/127.0.0.1/5099) && echo ok'
sh: 1: cannot create /dev/tcp/127.0.0.1/5099: Directory nonexistent   ← ❌ 假阴性
sh: FAILED

$ docker exec haizakura curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5099/
200                                                                   ← ✅ 真的通
```

**原因**：`/dev/tcp` 是 **bash 的特性**，**不是 POSIX**。
容器里 `docker exec ... sh` 默认用的是 **dash**，不支持 `/dev/tcp`。

（容器里 `bash` 是存在的：`/usr/bin/bash`）

**正确做法**：

| 方式 | 命令 |
| --- | --- |
| **推荐** | `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5099/` |
| 用 bash | `docker exec haizakura bash -c 'echo > /dev/tcp/127.0.0.1/5099'` |
| 看监听 | `docker exec haizakura ss -lntp` |

> 💡 **通用教训**：排查网络问题时，**用 curl 而不是 `/dev/tcp`** 来测 HTTP 服务 ——
> 前者还能看到状态码，信息量更大。

---

### 坑 6：跨机传文件被截断

**现象**：`scp` / `docker cp` 传输大文件（如 12 MB 的 `index.mjs`）后，
文件大小不对或内容损坏。

**教训**：**跨机传文件后必须校验哈希。**

```bash
# 传之前
sha256sum index.mjs

# 传之后
sha256sum index.mjs   # 必须一致

# 或直接对比大小 + md5
md5sum index.mjs
```

**【实测】当前运行版本的值**（可用于核对）：

```
index.mjs   12,338,442 字节
md5         bebdc7586f6e6586be80a85cc744ae5c
```

> 📌 **注意两个不同的基线，别混**：
>
> | 版本 | 字节数 | MD5 |
> | --- | ---: | --- |
> | **还原报告记录的原始 bundle** | 12,338,350 | `19bdfef05f6bebfb3986caf81dba37c3` |
> | **当前运行中的（改名后）** | **12,338,442** | **`bebdc7586f6e6586be80a85cc744ae5c`** |
>
> 两者差异来自品牌改名（`#sl` → `#Haizakura` 等）与后续修改。
> **核对时以你实际部署的那份为准** —— 容器内、`dist/`、
> 以及挂载的 `index.mjs` 三者应当一致。

> 💡 **为什么这个坑重要**：如果传坏的 `index.mjs` 进了容器，
> 症状是**千奇百怪的**（启动失败 / 某个功能异常），
> 而你不会怀疑到「文件传输出错」上。
> **传完就校验，能省几个小时。**

---

### 坑 7：逆向脚本无计数上限会把机器打爆

**适用范围**：如果你在跑 RTTI 分析 / 逆向脚本。

**教训**：**运行逆向脚本必须加计数上限。**

| 陷阱 | 后果 |
| --- | --- |
| Python 切片 `b[:z]` 当 `z == -1` | 会吐出 10 MB 数据 |
| `.eh_frame_hdr` 的 `pcrel` 当无符号解码 | `fde_count` 变成 1.8e19 → 越界 |
| `for i in range(cnt)` 里 `cnt` 解错 | **无限 append → 2.7 GB 内存** |

**【实测】** 当时在一台 2 核、跑着真实业务的机器上，
一次循环边界写错就把**负载推到 37**。

**另一个陷阱**：用「已定义导出」子集当全部符号，
会得出「dynsym 里没有 RTTI」的**错误结论**（实际有 397 个）。

---

### 坑 8：`/proc/<pid>/maps` 里的 `(deleted)` 是正常的

**不要以为这是异常。**

```
# 注入负载映射（注意 (deleted)）
$ docker exec haizakura cat /proc/<qq_pid>/maps | grep -i orcexec
... /tmp/runtime-1000/orcexec.abc123 (deleted)
```

**原因**：注入器在映射完 `.so` 之后**主动 `unlink` 临时文件** ——
这是**反本地发现的设计**，磁盘上查不到该文件是**预期行为**。

**同理，以下都是正常的**：

| 现象 | 说明 |
| --- | --- |
| `(deleted)` 后缀 | 注入后主动 unlink |
| socket 名叫 `mojo.<pid>.*.sock` | **刻意伪装成 Chromium 的 mojo IPC** |
| `/tmp/runtime-<uid>/orcexec.<6位随机>` | 随机名，注入后消失 |
| 线程名 `snowluma-pipe-w` | 注入的管道写线程 |

```bash
# 确认注入确实活着（这几个都应该有输出）
docker exec haizakura cat /proc/<qq_pid>/task/*/comm | grep snowluma
docker exec haizakura ss -xpn | grep mojo
```

---

## 3. 故障速查表

| 症状 | 最可能的原因 | 去哪看 |
| --- | --- | --- |
| 容器 `ExitCode 126` | 缺 `SYS_PTRACE` / seccomp | §1.8 |
| 容器起来但动作全失败 | QQ 没登录 / 登录态丢了 | [登录说明](login.md) |
| **重启后要重新扫码** | **登录态丢失（已知）** | §2 坑 1 |
| 日志有 `unresolved` | QQ 版本变了 / 注入失败 | §1.9 |
| 日志不再增长 | **超配额静默丢弃** | §1.7 |
| noVNC 打不开 | HSTS 强制 https | §2 坑 2 |
| noVNC 黑屏 | Xvfb 未就绪 | 等几秒 / 看日志 |
| 状态指令不响应 | 非单段纯文本 / trigger 不对 | [配置 §2.1](configuration.md) |
| 状态指令改了不生效 | 改错文件（全局 vs per-uin） | §2 坑 3 |
| 端口测不通 | `/dev/tcp` 假阴性 | §2 坑 5 |
| 局域网连不上 | 绑了 `127.0.0.1` | §1.1 |
| QQ 界面异常 / 登录不上 | 开了 `HOOK_AUTOLOAD_ALL` | §1.10 |
| 发不了媒体 | 权限 / 超时 / 并发 | §1.3 |
| 忘了 WebUI 密码 | — | §1.2 |
| 更新总是失败 | **上游已删库（预期）** | [配置 §5.1](configuration.md) |
| 文件传输出错 | 传输截断 | §2 坑 6 |

---

## 4. 诊断信息收集（提问前先跑）

```bash
# ── 基础状态 ──────────────────────────────
docker ps --filter name=haizakura
docker exec haizakura ps -eo pid,ppid,comm,args --no-headers | head -30

# ── 端口监听 ──────────────────────────────
docker exec haizakura ss -lntp

# ── hook 健康度（0 = 健康）★ 最重要 ────────
docker exec haizakura grep -c unresolved /app/data/logs/*.log

# ── 注入证据 ──────────────────────────────
QQPID=$(docker exec haizakura pgrep -f '^qq ' | head -1)
docker exec haizakura cat /proc/$QQPID/task/*/comm 2>/dev/null | grep -i snowluma
docker exec haizakura ss -xpn 2>/dev/null | grep mojo

# ── 配置快照（脱敏后贴出来）────────────────
docker exec haizakura cat /app/data/config/runtime.json
docker exec haizakura cat /app/data/config/onebot.json

# ── 最近日志 ──────────────────────────────
docker exec haizakura tail -100 /app/data/logs/snowluma-$(date +%F).log

# ── 存储状态（看 droppedLines）─────────────
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:5199/api/system/storage

# ── 连通性（用 curl，不要用 /dev/tcp）──────
curl -s -o /dev/null -w 'webui  %{http_code}\n' http://127.0.0.1:5199/
curl -s -o /dev/null -w 'onebot %{http_code}\n' http://127.0.0.1:3010/get_login_info
```

> ⚠️ **贴日志/配置前务必脱敏**：`accessToken`、`passwordHash`、`passwordSalt`、
> `smtpPass`、QQ 号。别把线上令牌贴到公开渠道。

---

## 5. 还解决不了？

按顺序：

1. 查 [故障排查](../advanced/troubleshooting.md) —— 系统性排查流程
2. 查 [架构与注入原理](../advanced/architecture.md) —— 理解原理才能定位
3. 确认 [兼容性矩阵](../advanced/compatibility.md) —— 你的 QQ 版本是否受支持
4. 收集 §4 的诊断信息再提问 —— **带上日志和 `grep -c unresolved` 的结果**
