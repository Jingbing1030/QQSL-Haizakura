# Frequently asked questions (FAQ)

> [!WARNING]
> This content was written entirely by AI; review it with care.

> This document contains two kinds of material: **general questions** (mirroring LLBot's FAQ topics)
> and **pitfalls we actually hit** (this part is more valuable than the general FAQ).

---

## 1. General questions

### 1.1 Why can I only reach it locally, and not from the LAN / internet?

**For security, the application listens only on `127.0.0.1` by default.**

[Confirmed] Source defaults:

| Setting | Default | Location |
| --- | --- | --- |
| `webuiHost` | `127.0.0.1` | `common/src/runtime.ts:194` |
| `httpServers[].host` | `127.0.0.1` | `onebot/src/config.ts:42` |
| `wsServers[].host` | `127.0.0.1` | `onebot/src/config.ts:54` |

**But containers are different**: a Docker container has its own network namespace,
so if it listens only on `127.0.0.1`, the **mapped host port can never be reached**.

That is why the container entrypoint seeds the configuration (`/root/start.sh`):

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

**How to fix it**:

| Goal | What to do |
| --- | --- |
| Reach the WebUI from the LAN / internet | Change the listen address to `0.0.0.0` in the WebUI, or edit `webuiHost` in `runtime.json` |
| Call OneBot from the LAN / internet | Change the adapter's `host` to `0.0.0.0` |
| Local access only | Keep `127.0.0.1` and use an SSH tunnel |

> ⚠️ **Two things are mandatory before exposing it to the internet**:
> ① OneBot adapters **must use a strong token** (the source enforces ≥16 characters and rejects weak tokens)
> ② The WebUI **should** sit behind a reverse proxy with `trustProxy` configured,
> because `/api/debug/invoke` **is equivalent to remote execution of arbitrary actions**.

**SSH tunnel approach (safest)**:

```bash
ssh -L 5199:127.0.0.1:5199 -L 3010:127.0.0.1:3010 用户@服务器
# 然后本地访问 http://127.0.0.1:5199
```

---

### 1.2 What if I forget the WebUI password?

WebUI credentials live in `config/webui.json` ([Confirmed] `core/src/webui/auth.ts`):

```json
{
  "passwordHash": "<128 位十六进制 scrypt 哈希>",
  "passwordSalt": "<32 位十六进制盐>",
  "mustChangePassword": false,
  "generatedAt": "...",
  "updatedAt": "..."
}
```

The hash uses **`scryptSync`** (`N=16384, r=8, p=1`, keylen 64) — **it is not reversible**.

**Three options**:

| Option | Steps | Risk |
| --- | --- | --- |
| **① Delete the credentials file and let the system rebuild it** | Stop the container → delete `config/webui.json` → start → set a new password through the onboarding flow | ⚠️ **Requires a restart → loses the QQ login session** |
| **② Inject an environment variable on first start** | Use `-e SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD='<strong password>'` (**requires ≥8 characters**) | Only takes effect on the first start |
| **③ Edit the hash directly** | Compute an scrypt hash with the same parameters and replace `passwordHash` | You must keep `N=16384, r=8, p=1, keylen=64` |

**Password strength requirements** ([Confirmed] `PASSWORD_RULES`; all five must hold):

| Rule | Requirement |
| --- | --- |
| `length` | **At least 10 characters** |
| `lower` | Contains a lowercase letter |
| `upper` | Contains an uppercase letter |
| `special` | Contains a special character (`!@#$%…`) |
| `no-space` | Contains no spaces |

> 💡 Note that `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD` only requires **≥8 characters**,
> while the WebUI strength check requires **≥10 characters plus all four character classes**. The two standards differ.

> ⚠️ Two related mechanisms also exist: **TOTP two-factor authentication** (`/api/auth/totp/*`, RFC 4226/6238)
> and **recovery codes** (`/api/auth/totp/recovery-codes`).
> If you enabled TOTP and lost it, you likewise have to delete the credentials file.
>
> ⚠️ With `SNOWLUMA_DEV_MODE=1` set, changing the password fails outright with
> “开发模式 (SNOWLUMA_DEV_MODE=1) 已禁用密码修改”.

---

### 1.3 Cannot send images / voice / video?

Troubleshoot in order:

| Check | Description |
| --- | --- |
| ① File permissions | The `snowluma` user in the container (uid 1000 by default) needs **write access** to `/app/data` |
| ② `SNOWLUMA_STREAM_DIR` | Staging directory for the streaming interface (default `$TMPDIR/onebot-stream`); invalid values are warned about and fall back |
| ③ Download size limit | `SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES` |
| ④ Download timeout | `SNOWLUMA_HTTP_DOWNLOAD_TIMEOUT_MS` (default 60000 ms) |
| ⑤ **Video upload concurrency** | `videoUploadConcurrency` in `snowluma.json` (1–4, default 1) |
| ⑥ Disk space | `docker exec haizakura df -h /app/data` |
| ⑦ Status command check | Send a status command first to confirm the path works |

> 💡 **Haizakura does not need a separate FFmpeg install** (unlike LLBot) —
> it ships `native/ffmpeg/ffmpegAddon.linux.arm64.node`.

**Fixing permissions**:

```bash
docker exec haizakura ls -la /app/data
docker exec haizakura chown -R 1000:1000 /app/data
```

---

### 1.4 How do I use CQ codes instead of the array format?

**Set `messageFormat` to `"string"`** ([Confirmed] `config.ts:747-749`; only `"array"` or `"string"` are accepted):

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

| Value | Format |
| --- | --- |
| `"array"` (default) | `[{"type":"text","data":{"text":"hi"}}]` |
| `"string"` | `"hi[Cat:face,id=1]"` |

> You can also set `messageFormat` at the top level as the **default for all adapters** (compatible with the old layout).

---

### 1.5 How do I reach the host machine from inside Docker?

**Do not use `127.0.0.1`** — that points at the container itself.

| Platform | Host address |
| --- | --- |
| Linux | `172.17.0.1` (the default bridge gateway) or `--add-host=host.docker.internal:host-gateway` |
| Docker Desktop (Mac/Win) | `host.docker.internal` |

**Recommended** (cross-platform):

```bash
docker run ... --add-host=host.docker.internal:host-gateway ...
```

Then use `http://host.docker.internal:8080` in your configuration.

> ⚠️ **Mac users take note**: community experience says **use OrbStack rather than Docker Desktop**,
> otherwise QQ may fail to start. This is a pitfall the LLBot community hit, and Haizakura is likewise an Electron QQ, so it **very likely applies here too**.

---

### 1.6 How do I configure everything before logging in?

**The container entrypoint already seeds it for you** ([Confirmed] `/root/start.sh`):

On the first start (when `onebot.json` does not exist) it generates:

```json
{
  "networks": {
    "httpServers": [{ "name": "http-default", "host": "<SNOWLUMA_ONEBOT_HOST>", "port": 3000, "path": "/", "accessToken": "<随机32字节>", "messageFormat": "array", "reportSelfMessage": false }],
    "wsServers":   [{ "name": "ws-default",   "host": "<SNOWLUMA_ONEBOT_HOST>", "port": 3001, "path": "/", "role": "Universal", "accessToken": "<随机32字节>", "messageFormat": "array", "reportSelfMessage": false }],
    "httpClients": [], "wsClients": []
  }
}
```

**Key design**: **it only skips recreation when you deleted the adapter yourself** —
if `httpServers` is an **existing empty array**, the entrypoint **will not** add it back.

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

**So to pre-configure**: **put `onebot.json` into the volume before starting the container**,
or copy it in with `docker cp`, and then start.

> 💡 **Correcting a notion carried over from the LLBot era**: Haizakura **has no `default_config.json` inheritance mechanism**.
> Its equivalent is **“global `onebot.json` merged with a per-account `onebot_<uin>.json` overlay”**
> (see [Configuration §0.2](configuration.md)).
> The global file is ignored only when `onebot_<uin>.json` sets `"mode": "snapshot"`.

---

### 1.7 Log files keep growing / logging suddenly stops

### Log rotation

[Confirmed] `log-file-transport.ts`:

| Parameter | Default | Environment variable |
| --- | ---: | --- |
| Per-file limit | **50 MB** | `SNOWLUMA_LOG_MAX_MB` |
| Total limit | **1024 MB** | `SNOWLUMA_LOG_MAX_TOTAL_MB` (or `logMaxTotalMb` in `runtime.json`) |
| Retention days | **7 days** | `SNOWLUMA_LOG_RETAIN_DAYS` (`logRetainDays`) |
| Per-account files | `false` | `SNOWLUMA_LOG_PER_UIN` (`logPerUin`) |

File naming:

```
snowluma-YYYY-MM-DD.log          当天
snowluma-YYYY-MM-DD.N.log        滚动分片
snowluma-<uin>/...               按账号模式（目录名为纯数字）
```

### ⚠️ Pitfall: logs are silently dropped once over quota

This is **a pitfall easily mistaken for “the program is stuck”**.

[Confirmed] `LogQuota.reserve()` (`log-file-transport.ts:198-221`):

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

**Behavior**:

| State | Symptom |
| --- | --- |
| Healthy | Writes normally |
| **Over quota / storage error** | Enters the `degraded` state → **log lines are silently dropped**, only the `droppedLines` counter increases |
| Retry | Retries every **5000 ms** (`QUOTA_RETRY_MS`) |

**Symptom**: the log file stops growing, but the program is in fact still running.
**Risk of misdiagnosis**: you conclude “the process died” when in fact **logs simply cannot be written**.

**How to check** ([Measured] the response shape of `GET /api/system/storage`):

```bash
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:5199/api/system/storage
```

Response:

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

> 🔍 **Two fields are enough**: `snapshot.logs.state` and `snapshot.logs.droppedLines`.
> If `droppedLines > 0` or `state != "healthy"`, **logs are being dropped**.

**Fixing it**:

| Measure | Command / location |
| --- | --- |
| Clean up from the WebUI | `POST /api/system/storage/cleanup` |
| Lower retention | `logRetainDays` / `SNOWLUMA_LOG_RETAIN_DAYS` |
| Raise the total limit | `logMaxTotalMb` / `SNOWLUMA_LOG_MAX_TOTAL_MB` |
| Disable file logging | `SNOWLUMA_LOG_FILE=0` |
| Lower the file level | `SNOWLUMA_LOG_FILE_LEVEL=warn` |

> ⚠️ **After deleting log files manually it may still be `degraded`**:
> the source contains this warning —
> `managed logs still use N bytes after manual cleanup, exceeding the M byte limit`.
> That means **it still exceeds the limit after recounting** (files it does not manage may be occupying space).

---

### 1.8 Container `ExitCode 126` / `Operation not permitted`

**This is the most common failure during deployment.**

**Symptom**:

```
ExitCode = 126
日志: /root/start.sh: line 161: /usr/local/bin/node: Operation not permitted
```

**Cause**: the injector needs `ptrace` + `process_vm_writev` to attach to the QQ process, but:

| What is missing | Consequence |
| --- | --- |
| `--cap-add SYS_PTRACE` | **The hook cannot be installed** |
| `--security-opt seccomp=unconfined` | **The container will not start** (the default seccomp profile blocks `ptrace`) |

**Fix**:

```bash
docker run ... \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  ...
```

**[Measured]** With these two options added, **it started successfully on the first try**.

> 📌 `--privileged` also works, but the privileges are far too broad; **not recommended**.

---

### 1.9 The hook will not install / the log contains `unresolved`

**Check hook health**:

```bash
docker exec haizakura grep -c unresolved /app/data/logs/*.log
```

| Result | Meaning |
| --- | --- |
| **`0`** | ✅ **Hook is healthy** |
| `>0` | ❌ RTTI chain resolution failed |

**What `unresolved` means**: the “single verification gate” inside the `.so` did not pass —
it locates `nt::MSFService` / `nt::MSFCoreService` using **RTTI structural matching**
(not string matching), and that failed.

**Common causes**:

| Cause | Description | What to do |
| --- | --- | --- |
| **The QQ version changed** | The RTTI / vtable layout of `wrapper.node` changed | Diff against the baseline with `dump-vtable.py`; see [Contributing](../dev/contributing.md) |
| Missing `SYS_PTRACE` | Injection never succeeded | See §1.8 |
| The zygote was injected | See §1.10 | Check `SNOWLUMA_HOOK_AUTOLOAD_ALL` |
| The kernel blocks `ptrace` | Hardened kernel (e.g. with Yama restrictions) | Check `kernel.yama.ptrace_scope` |

**Confirm whether the QQ version matches the baseline**:

```bash
docker exec haizakura md5sum /app/runtime/../.config/... # 定位 wrapper.node
# 期望 md5: adeb40af26d859d41fcdb21bf38d9eb5
```

---

### 1.10 ⚠️ Never turn on `SNOWLUMA_HOOK_AUTOLOAD_ALL` casually

**This is the item most in need of a warning in this documentation.**

The normal flow **filters out Electron's zygote and child processes** and injects only the main QQ process.
`SNOWLUMA_HOOK_AUTOLOAD_ALL=1` **bypasses that filter**.

**[Confirmed] Consequence**:

> Injecting into the zygote **starts the hook's resolver thread inside the zygote**;
> afterwards **every renderer forked by Electron inherits that thread plus half-initialized hook state**,
> which **breaks QQ's IPC and login UI** outright.

**Symptoms**: odd QQ UI behavior, inability to log in, assorted inexplicable problems.

**When to use it**: **temporarily, while diagnosing “why the main process was not injected”**.
Turn it off and restart immediately afterwards.

---

## 2. ⭐ Pitfalls we actually hit

> These are **lessons paid for in real cost**, more valuable than the general FAQ. Read all of them.

### Pitfall 1: 🔴 Restarting the container loses the QQ login session (the worst one)

**This is the biggest operational trap in this project.**

| Item | Description |
| --- | --- |
| **Symptom** | After a container restart, QQ needs **a fresh QR-code login** |
| **Cause** | The `loginList` in `/app/.config/QQ/auth/login.enc` is emptied |
| **Cost** | **We once had a production bot down for 8 hours because of this** |
| **Why it hurts** | Scanning a QR code requires **manual intervention** (open noVNC and scan with a phone) |

**Failure chain**:

```
重启容器 → 登录态丢失 → Haizakura 拿不到 MSF 会话
        → 所有动作返回 "not logged in" → ⛔ bot 完全不可用
```

**Conclusions**:

| Principle | Practice |
| --- | --- |
| **Do not restart unless necessary** | For configuration changes, **prefer WebUI / API hot reload** |
| When a restart is unavoidable | **Schedule a window when someone can scan the QR code** |
| Before restarting | Make sure a phone with QQ is at hand |
| Accept reality | Treat “a restart means scanning again” as **a given** and plan for it |

**Which operations hot reload (and do not lose the login session)**:

| Change | Hot reload |
| --- | --- |
| OneBot network configuration | ✅ |
| `statusCommand` | ✅ |
| `notifications` | ✅ |
| Log level | ✅ |
| Hook load / unload | ✅ |
| **`historySync.enabled`** | ❌ Read only at startup |
| **Environment variables / code** | ❌ Requires rebuilding the container |

See [Configuration §11](configuration.md) for details.

---

### Pitfall 2: noVNC force-upgraded to https by HSTS

| Item | Description |
| --- | --- |
| **Symptom** | `http://<IP>:6181` will not open; the browser jumps to https |
| **Cause** | The browser's **HSTS** policy force-upgrades that address to https, while noVNC is plain http |
| **Fix** | ① Use a **bare IP** (no domain name) ② Try another browser ③ Clear the HSTS record for that IP |

**Clearing HSTS in Chrome**: `chrome://net-internals/#hsts` → Delete domain security policies.

---

### Pitfall 3: Changes to settings such as `#hz` “do not take effect”

**There are two layers of cause; check both.**

**Cause A: configuration precedence / the `mode` problem**

[Confirmed] If `onebot_<uin>.json` sets `"mode": "snapshot"`,
**the global `onebot.json` has no effect on it at all**.

```
onebot.json（全局）
      ↓ 仅在非 snapshot 时叠加
onebot_<uin>.json（每账号）
```

| What you may have changed | What actually takes effect |
| --- | --- |
| `statusCommand` in the global `onebot.json` | ⚠️ **Overridden by the per-uin value** (see below) — not “the global file is unsupported”, but **precedence lost** |
| An adapter in `onebot.json` | The **same-named adapter** in the per-uin file replaces it wholesale |

> 📌 **Why editing the global `statusCommand` usually does nothing** ([Confirmed] two facts combined):
>
> **Fact 1**: `parseStatusCommand(sources)` **walks every source**, and later ones override earlier ones.
> Outside snapshot mode, `sources = [global, per-uin]` → **per-uin wins**.
>
> **Fact 2**: when saving a per-uin file, `toJsonObject()` (`config.ts:498-517`) **always** writes
> the `statusCommand` / `historySync` / `notifications` sections —
> **even if you never set them explicitly, it writes defaults**.
>
> **Combined conclusion**: the per-uin file **always contains** `statusCommand`,
> so **it always wins**. Changing `trigger` globally gets overwritten by the per-uin default (or an older value).
>
> **[Measured]** The observed global `onebot.json` indeed contains only a `networks` section —
> because it was seeded by the container entrypoint, and the seeding logic only writes `networks`.
>
> ✅ **Therefore: always change status commands / history backfill / notification channels in `onebot_<uin>.json`.**
> (Or rather: **change them through the WebUI / `POST /api/config/:uin`** rather than editing the global file by hand.)

**Cause B: no hot reload**

| Setting | Hot reload |
| --- | --- |
| `statusCommand` | ✅ Takes effect immediately (via WebUI / API) |
| `historySync.enabled` | ❌ Read only at startup |

**Self-check when a change does not take effect**:

```bash
# 1. 确认你改的是哪个文件
docker exec haizakura cat /app/data/config/onebot_<uin>.json | grep -A5 statusCommand

# 2. 确认 mode 是什么
docker exec haizakura grep '"mode"' /app/data/config/onebot_<uin>.json

# 3. 走 API 改（推荐），而不是手动改文件
```

> ⚠️ **`POST /api/config/:uin` requires the complete configuration, not a partial patch.**
>
> [Confirmed] `server.ts:1293-1297` takes the body and **immediately** runs `assertValidOneBotConfig(body)`,
> then saves the whole thing. Therefore:
>
> | Approach | Result |
> | --- | --- |
> | Send only `{"statusCommand":{...}}` | ❌ **Validation fails** (missing `networks` / `historySync`) |
> | `GET` the full config → edit fields → `POST` it back | ✅ **The correct approach** |
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
> **The response tells you whether it really hot reloaded** ([Confirmed] response shape):
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
> | `message` | Meaning |
> | --- | --- |
> | 配置保存成功，已热重载当前会话。 | ✅ Effective immediately |
> | 配置保存成功，当前会话未在线，将在下次连接时生效。 | ⚠️ The account is not online |
> | 配置已保存，但部分网络节点未能应用… | ⚠️ Partial failure; check `errors` |
>
> 💡 **`GET /api/config/:uin` returns the merged result** ([Confirmed] `loadOneBotConfig`
> merges global + per-uin and returns it, **without a `mode` field**).
>
> ⚠️ **So “GET → edit → POST” freezes the file into `snapshot` mode.**
>
> [Confirmed] The default mode of `saveOneBotConfig` is `"snapshot"`:
>
> ```javascript
> saveJson(..., toJsonObject(config, options.mode ?? "snapshot"));
> ```
>
> Consequence: **that account no longer inherits the global `onebot.json`**.
>
> | What you want | Correct approach |
> | --- | --- |
> | Apply only to this account, without inheriting the global file | ✅ GET → edit → POST (current behavior already does this) |
> | **Keep inheriting the global file** | ⚠️ **Manually add** `"mode": "overlay"` to the body before POSTing |
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

> 💡 **Also note the trigger matching semantics**: **exact equality, and exactly one text segment**.
> `#hz` + an image = two segments = **no trigger**. See [Configuration §2.1](configuration.md).

---

### Pitfall 4: Container `ExitCode 126`

See §1.8. The key point is that both `SYS_PTRACE` and `seccomp=unconfined` are required.

---

### Pitfall 5: Testing a port with `/dev/tcp` gives a false negative

**This pitfall misleads your troubleshooting.**

**Symptom**: the port is clearly open, yet `sh -c 'echo > /dev/tcp/...'` fails.

**[Measured]** Comparison inside the container:

```bash
$ docker exec haizakura sh -c '(echo > /dev/tcp/127.0.0.1/5099) && echo ok'
sh: 1: cannot create /dev/tcp/127.0.0.1/5099: Directory nonexistent   ← ❌ 假阴性
sh: FAILED

$ docker exec haizakura curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5099/
200                                                                   ← ✅ 真的通
```

**Cause**: `/dev/tcp` is a **bash feature**, **not POSIX**.
Inside the container, `docker exec ... sh` uses **dash** by default, which does not support `/dev/tcp`.

(`bash` does exist in the container: `/usr/bin/bash`.)

**Correct approaches**:

| Approach | Command |
| --- | --- |
| **Recommended** | `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5099/` |
| Use bash | `docker exec haizakura bash -c 'echo > /dev/tcp/127.0.0.1/5099'` |
| Inspect listeners | `docker exec haizakura ss -lntp` |

> 💡 **General lesson**: when troubleshooting network problems, **use curl rather than `/dev/tcp`** to test HTTP services —
> the former also shows the status code, which is far more informative.

---

### Pitfall 6: File transfers between machines get truncated

**Symptom**: after copying a large file (such as a 12 MB `index.mjs`) with `scp` / `docker cp`,
the size is wrong or the content is corrupted.

**Lesson**: **always verify the hash after transferring a file between machines.**

```bash
# 传之前
sha256sum index.mjs

# 传之后
sha256sum index.mjs   # 必须一致

# 或直接对比大小 + md5
md5sum index.mjs
```

**[Measured] Values for the currently running build** (useful for cross-checking):

```
index.mjs   12,338,442 字节
md5         bebdc7586f6e6586be80a85cc744ae5c
```

> 📌 **Note there are two distinct baselines; do not mix them up**:
>
> | Build | Bytes | MD5 |
> | --- | ---: | --- |
> | **Original bundle recorded in the recovery report** | 12,338,350 | `19bdfef05f6bebfb3986caf81dba37c3` |
> | **Currently running (after renaming)** | **12,338,442** | **`bebdc7586f6e6586be80a85cc744ae5c`** |
>
> The difference comes from the branding rename (`#sl` → `#Haizakura` and similar) plus later edits.
> **Cross-check against the copy you actually deployed** — inside the container, `dist/`,
> and the mounted `index.mjs` should all agree.

> 💡 **Why this pitfall matters**: if a corrupted `index.mjs` gets into the container,
> the symptoms are **wildly varied** (startup failure / one feature misbehaving),
> and you will not suspect “the file transfer went wrong”.
> **Verify right after copying; it saves hours.**

---

### Pitfall 7: A reverse-engineering script without a count limit will melt the machine

**Scope**: applies if you are running RTTI analysis / reverse-engineering scripts.

**Lesson**: **always add count limits when running reverse-engineering scripts.**

| Trap | Consequence |
| --- | --- |
| Python slice `b[:z]` when `z == -1` | Emits 10 MB of data |
| Decoding `.eh_frame_hdr`'s `pcrel` as unsigned | `fde_count` becomes 1.8e19 → out of bounds |
| Mis-decoding `cnt` in `for i in range(cnt)` | **Unbounded appends → 2.7 GB of memory** |

**[Measured]** On a 2-core machine running real production workloads at the time,
one wrong loop boundary **pushed load average to 37**.

**Another trap**: using the “defined exports” subset as if it were all symbols
leads to the **wrong conclusion** that “there is no RTTI in dynsym” (there are actually 397).

---

### Pitfall 8: `(deleted)` in `/proc/<pid>/maps` is normal

**Do not treat this as an anomaly.**

```
# 注入负载映射（注意 (deleted)）
$ docker exec haizakura cat /proc/<qq_pid>/maps | grep -i orcexec
... /tmp/runtime-1000/orcexec.abc123 (deleted)
```

**Cause**: after mapping the `.so`, the injector **deliberately `unlink`s the temporary file** —
this is **an anti-local-discovery design**, and not finding the file on disk is **expected behavior**.

**For the same reason, all of the following are normal**:

| Observation | Description |
| --- | --- |
| The `(deleted)` suffix | Deliberate unlink after injection |
| A socket named `mojo.<pid>.*.sock` | **Deliberately disguised as Chromium's mojo IPC** |
| `/tmp/runtime-<uid>/orcexec.<6 random digits>` | Random name; disappears after injection |
| Thread name `snowluma-pipe-w` | The injected pipe writer thread |

```bash
# 确认注入确实活着（这几个都应该有输出）
docker exec haizakura cat /proc/<qq_pid>/task/*/comm | grep snowluma
docker exec haizakura ss -xpn | grep mojo
```

---

## 3. Quick troubleshooting table

| Symptom | Most likely cause | Where to look |
| --- | --- | --- |
| Container `ExitCode 126` | Missing `SYS_PTRACE` / seccomp | §1.8 |
| Container starts but every action fails | QQ not logged in / login session lost | [Login](login.md) |
| **Needs a new QR scan after restart** | **Login session lost (known)** | §2 Pitfall 1 |
| Log contains `unresolved` | QQ version changed / injection failed | §1.9 |
| Log stops growing | **Silent drops over quota** | §1.7 |
| noVNC will not open | HSTS forcing https | §2 Pitfall 2 |
| noVNC shows a black screen | Xvfb not ready | Wait a few seconds / check the log |
| Status command does not respond | Not a single text segment / wrong trigger | [Configuration §2.1](configuration.md) |
| Status command change has no effect | Wrong file (global vs per-uin) | §2 Pitfall 3 |
| Port test fails | `/dev/tcp` false negative | §2 Pitfall 5 |
| LAN cannot connect | Bound to `127.0.0.1` | §1.1 |
| Odd QQ UI / cannot log in | `HOOK_AUTOLOAD_ALL` enabled | §1.10 |
| Cannot send media | Permissions / timeout / concurrency | §1.3 |
| Forgot the WebUI password | — | §1.2 |
| Updates always fail | **Upstream repository deleted (expected)** | [Configuration §5.1](configuration.md) |
| File transfer errors | Truncated transfer | §2 Pitfall 6 |

---

## 4. Collecting diagnostics (run these before asking)

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

> ⚠️ **Always redact before posting logs or configuration**: `accessToken`, `passwordHash`, `passwordSalt`,
> `smtpPass`, and QQ numbers. Do not post live tokens to public channels.

---

## 5. Still stuck?

In order:

1. Check [Troubleshooting](../advanced/troubleshooting.md) — a systematic diagnostic process
2. Check [Architecture and injection principles](../advanced/architecture.md) — you can only localize a problem once you understand the mechanism
3. Confirm against the [compatibility matrix](../advanced/compatibility.md) — whether your QQ version is supported
4. Collect the diagnostics from §4 before asking — **include the logs and the output of `grep -c unresolved`**
