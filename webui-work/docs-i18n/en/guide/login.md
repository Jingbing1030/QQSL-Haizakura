# Login guide

> [!WARNING]
> This content was written entirely by AI; review it with care.

> **In one sentence**: Haizakura **has no login flow of its own**. You must log in
> to the **official QQ client** inside the container remotely through **noVNC**
> before Haizakura can do any work.

---

## 1. Why it works this way

This follows from Haizakura's architecture and **is not a defect**:

| What you might expect | Reality |
| --- | --- |
| `POST /api/login` with username and password | ❌ **Does not exist** |
| A QR-code login API | ❌ **Does not exist** (the source contains no QR login implementation at all) |
| Built-in headless quick login | ❌ Not supported |

**Why**: Haizakura piggybacks on **the MSF session the official QQ has already established**.
It does not implement a login protocol, does not encrypt passwords and does not handle CAPTCHAs — **Tencent's own
QQ client handles all of that**. So it must give you a way to operate that real QQ window.

[Confirmed] The original prompt strings preserved in the source (from the injected `.so`):

```
"not logged in: wait until QQ completes login"
"logged-in MSF service instance is missing"
"QQ is not ready. Please finish signing in and try again."
```

**When these three appear**: you called an OneBot action, but QQ has not finished logging in.

---

## 2. The remote desktop stack in the container

[Measured] The graphical stack started by the entrypoint (`/root/start.sh`):

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

| Component | Port | Description |
| --- | ---: | --- |
| **noVNC** | `6081` | ✅ **Use this one** (browser access) |
| x11vnc | `5900` | Raw VNC; any VNC client can connect |
| Xvfb | `:1` | Virtual screen; resolution controlled by `SNOWLUMA_SCREEN` (default `1920x1080x24`) |

---

## 3. Login steps

### 3.1 Find the VNC password

**Option one: read the container log** (printed on first start)

```bash
docker logs haizakura 2>&1 | grep -i "远程桌面密码\|remote desktop password"
```

The output looks like:

```
远程桌面密码: <15字节随机串>
remote desktop password: <15字节随机串>
```

**Option two: read the file** (note that it is root-only)

```bash
docker exec haizakura cat /app/data/config/vnc-password
```

> ⚠️ **The log prints it only when the password is newly generated**. If a password already exists, a restart will not print it again —
> in that case use option two, or the `VNC_PASSWD` you set yourself.

### 3.2 Open noVNC

In a browser, go to:

```
http://<你的服务器IP>:6181
```

> ⚠️ **Common pitfall: the browser force-upgrades http to https.**
> If your browser has previously visited https sites, **HSTS** may rewrite `http://ip:6181`
> to `https://ip:6181` automatically, and the connection fails.
>
> **Fix**: use a **bare IP** (no domain name), switch browsers, or clear the HSTS record for that IP.

Click "Connect" and enter the password from §3.1.

### 3.3 Log in to QQ inside noVNC

Once the QQ login window appears:

1. Choose **QR-code login** or **account/password login** (QQ's own UI; it varies by version)
2. **Scanning with QQ on your phone** is the most reliable option
3. If device or SMS verification is requested, complete it as QQ prompts
4. Wait until QQ **reaches the main window** (you can see the contact list)

> 💡 **Note on symlinks**: the window may be tiny or the resolution may not match. You can adjust
> `SNOWLUMA_SCREEN` (e.g. `1440x900x24`) and rebuild the container —
> but note that **rebuilding/restarting loses the login session** (see §5).

### 3.4 Confirm Haizakura has detected the account

**Wait a few tens of seconds** (after QQ logs in, Haizakura needs to discover the account and establish a session).

**Option one: WebUI**

Open `http://<IP>:5199`; the "Accounts" page should show your QQ number.

**Option two: API**

```bash
curl -s http://127.0.0.1:3010/get_login_info
```

**Success**:

```json
{
  "status": "ok",
  "retcode": 0,
  "data": { "user_id": 123456789, "nickname": "你的昵称" }
}
```

**Failure** (QQ has not finished logging in):

```json
{ "status": "failed", "retcode": 1, "wording": "QQ is not ready. Please finish signing in and try again." }
```

**Option three: status command**

Send the bot a message (private or in a group):

```
#Haizakura
```

A normal reply looks like:

```
Haizakura 状态
版本: 0.2.4.2
平台: linux-x64
运行时长: 3小时 12分钟
```

> The trigger word is configurable; see the [full configuration guide](configuration.md).
> This instance has been changed to `#hz`.

---

## 4. Multiple accounts

### 4.1 Architecture

Haizakura **supports multiple accounts natively**, each with its own independent set:

| Dimension | Isolation | Measured path |
| --- | --- | --- |
| Configuration | One file per account | `config/onebot_<uin>.json` (`600`) |
| Message store | One directory per account | `data/<uin>/messages.db` |
| Reaction store | Same | `data/<uin>/reactions.db` |
| Network adapters | Independent per account | Each account's own `httpServers` / `wsServers` / … |

**Shared** (global) files:

| File | Description |
| --- | --- |
| `config/onebot.json` | Global OneBot configuration (inherited by every account unless that account is in `snapshot` mode) |
| `config/snowluma.json` | `rkey.fallbackServers` / `musicSignUrl` / `videoUploadConcurrency` |
| `config/notifications.json` | Notification channel definitions |
| `config/runtime.json` | Runtime settings such as WebUI / logging / hook toggles |

### 4.2 Running multiple QQ instances in one container

[Confirmed] Use `SNOWLUMA_EXTRA_QQ_HOMES` to specify additional QQ HOME directories (**comma-separated**):

```bash
docker run ... \
  -e SNOWLUMA_EXTRA_QQ_HOMES="/app/qq2,/app/qq3" \
  motricseven7/snowluma:latest
```

**Entrypoint behavior** (`/root/start.sh`):

| Rule | Description |
| --- | --- |
| The path must be under `/app/` | Otherwise it is **skipped with a warning** |
| Character restrictions | Only `A-Za-z0-9_@%+=:,./-` allowed; otherwise skipped |
| Creates directories and fixes ownership | `mkdir -p` + `chown snowluma` |
| **Staggered startup** | Instance N `sleep (N-1)*10` seconds to avoid contending for resources |
| Separate supervisor programs | `qq-extra-1`, `qq-extra-2`, … |

**[Measured]** The log will contain:

```
Configured 2 extra QQ instance(s): /app/qq2,/app/qq3
```

**And then**: does each QQ instance get its own window?

> ⚠️ **[To be confirmed]** Multiple QQ instances share the same Xvfb `:1` display.
> They **each open a window on the same noVNC desktop**, switchable through fluxbox.
> We **have not tested** the multi-instance scenario; trust the observed behavior.

### 4.3 How accounts are discovered

[Confirmed] This design is quite clever and **requires no root**:

```
① 定位 QQ 的数据库文件
   Linux: ~/.config/QQ/<uid-hash>/nt_db/nt_msg.db
   注意 accountDirName(uid) 做了目录名映射

② 找出「谁持有这个库」
   Linux: 读 /proc/locks，按 <dev>:<inode> 匹配
          → 读 /proc/<pid>/comm → 用 isQqProcessName() 过滤（"qq" / "QQ.exe"）
   Windows: 走 addon 的 getFileHoldersAsync()（内核句柄枚举）
```

**It works backwards from the database file exclusively locked by QQ to the process** — far more reliable than enumerating process names.

### 4.4 Maintaining the login session

| Mechanism | Constant / value | Description |
| --- | --- | --- |
| Login reconciliation polling | `LOGIN_RECONCILE_INTERVAL_MS = 3000` | Reconciles every 3 seconds |
| Identity observation | `LOGIN_IDENTITY_OBSERVE_INTERVAL_MS = 30000` | Observes every 30 seconds |
| Identity report | `op=17` frame | `sendAckOnly(17, BigInt(uin), …)` |

> **Source comment, verbatim**: “This does not change login state;
> readiness still requires peer confirmation.”
> That is: reporting identity locally **is not** the same as a successful login; peer confirmation is still required.

[Confirmed] The QQ data directory contains:

```
/app/.config/QQ/auth/login.enc          ← 登录凭据（加密）
/app/.config/QQ/global/nt_db/login.db   ← 登录数据库
```

---

## 5. ⚠️ Major risk: a restart loses the login session

**[Measured] This is a pitfall we actually hit; it took a production bot down for 8 hours.**

### 5.1 Symptom

**After restarting the container, QQ needs a fresh QR-code login.**

Cause: the `loginList` in `/app/.config/QQ/auth/login.enc` is emptied.

### 5.2 Consequence

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

**And scanning requires manual intervention** (you have to open noVNC and scan with a phone) —
**if it happens in the middle of the night, that is an 8-hour outage.**

### 5.3 What to do

| Principle | Practice |
| --- | --- |
| **Do not restart unless necessary** | For configuration changes, prefer **WebUI / API hot reload**; do not restart the container |
| When a restart is unavoidable | **Schedule a window when someone can scan the QR code** |
| Before restarting | Make sure a phone with QQ is at hand to scan |
| Long-term | [To be confirmed] Study how stable login-session persistence is; consider avoiding `docker restart` in favor of approaches that do not rebuild the container |

> ⚠️ **Note**: both `docker restart` and `docker stop/start` can trigger this.
> So can **a host reboot under the `--restart unless-stopped` policy**.
> If your service cannot tolerate downtime, **you must treat “a restart means scanning again” as a given and design a contingency plan**.

### 5.4 Which changes hot reload

| Change | Hot reload | How |
| --- | --- | --- |
| OneBot network configuration | ✅ **Hot reload** | `POST /api/config/:uin` (saving in the WebUI is enough) |
| `statusCommand` | ✅ **Hot reload** | Same as above |
| `notifications` | ✅ **Hot reload** | `POST /api/notifications/config` |
| Global `snowluma.json` settings | ✅ Hot reload | `POST /api/global-config` |
| `ui.json` appearance | ✅ Hot reload | `POST /api/ui` |
| **`historySync.enabled`** | ❌ **Read only at startup** | ⚠️ Requires a restart → **loses the login session** |
| **Most of `runtime.json`** | ⚠️ [To be confirmed] | From the code it is read at startup; `updateRuntimeConfig` only writes to disk |
| **`.env` / container environment variables** | ❌ Requires rebuilding the container | ⚠️ **Loses the login session** |
| **Code (`index.mjs`)** | ❌ Requires a restart | ⚠️ **Loses the login session** |
| Log level | ✅ Hot reload | `POST /api/logs/level` |
| Hook load/unload | ✅ Hot reload | `POST /api/processes/:pid/load` / `unload` |

> 💡 **Conclusion**: **the vast majority of day-to-day configuration changes need no restart**.
> Only `historySync` and container-level changes do — and those are exactly the painful ones.

---

## 6. Login-related troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| The noVNC page will not open | HSTS forcing https / port not mapped | Use a bare IP; confirm `-p 6181:6081` |
| noVNC connects but the screen is black | Xvfb has not started yet | Wait a few seconds; check the log for `Timed out waiting for Xvfb` |
| The VNC password is rejected | You are reading an old log | Read `/app/data/config/vnc-password` |
| The QQ window appears but login fails | Tencent risk control / device verification required | Complete verification in noVNC as QQ prompts |
| QQ logs in but Haizakura does not recognize it | Still reconciling (up to 30 seconds) | Wait 30 seconds and retry; check the log |
| **A new QR scan is required after a restart** | **Login session lost (known issue)** | See §5 |
| Every action returns `not logged in` | QQ is not logged in / the session was lost | Log in again |
| The hook will not install | Missing `SYS_PTRACE` / seccomp | See [Quick start §2.3](quick-start.md) |
| The log contains `unresolved` | RTTI resolution failed (did the QQ version change?) | See [Troubleshooting](../advanced/troubleshooting.md) |

### 6.1 Diagnostic commands

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

### 6.2 Check order for “QQ is logged in but actions fail”

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

## 7. Security notes

| Risk | Description | Recommendation |
| --- | --- | --- |
| **Exposed noVNC = full control of QQ** | Anyone who can connect can operate your QQ | **Do not expose it to the internet**; use a firewall / intranet / VPN |
| The VNC password is the **only** barrier | No second factor | Use a strong password (set `VNC_PASSWD` explicitly) |
| Login credentials live in the volume | `login.enc` is a sensitive file | Encrypt volume backups |
| The WebUI may be externally reachable by default | See the [configuration guide](configuration.md) | Set `webuiHost` to `127.0.0.1` plus a reverse proxy |

**Recommended approach**:

```bash
# 只在需要登录时临时暴露 noVNC 端口，登录完就关掉
docker run ... -p 6181:6081 ...   # 登录期间
# 登录完成后，重建容器时去掉 -p 6181:6081
```

> ⚠️ But rebuilding the container **loses the login session** (§5) — so weigh the tradeoff.
> A more practical approach is to **restrict source IPs with a firewall** rather than removing the port mapping.
