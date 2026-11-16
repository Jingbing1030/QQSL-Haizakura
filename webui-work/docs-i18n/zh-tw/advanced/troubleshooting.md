# 故障排除

> [!WARNING]
> 本內容完全由 AI 撰寫，請謹慎閱讀。

> **目標讀者**：正在部署或維運 Haizakura（原名 SnowLuma）的人。
> **本文是實戰手冊** —— 每條都來自**真實踩過的坑**，格式統一為
> **症狀 → 根因 → 解決 → 驗證**。
> 遇到問題先按第 1 節跑一遍健檢，再按症狀查表。

---

## 1. 三十秒健檢

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

**五項全過 = 系統健康。** 有異常 → 按 §3 的編號查。

---

## 2. 排查工具速查

### 2.1 行程與注入

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

### 2.2 WebUI API（維運最常用）

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

### 2.3 日誌檢索

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

## 3. 故障病歷

---

### T1 ★ 改了狀態指令的觸發詞，但機器人仍回應舊指令

**這是設定優先級問題，不是 bug。**

#### 症狀

```
- 我把代码里的默认触发词从 #sl 改成了 #Haizakura
  → 容器重启后才生效（但重启会丢登录态 ❌）
- 我直接改了 /app/data/config/onebot_<uin>.json 里的 trigger
  → 完全没生效 ❌
- 机器人还是只响应旧的触发词
```

#### 根因

**兩層原因疊加**：

```
原因一：配置优先级
        运行时配置（onebot_<uin>.json）  >  代码默认值（DEFAULT_STATUS_COMMAND）
        → 改代码默认值对已有账号无效

原因二：★ 改配置文件【不会热加载】
        运行时内存里保存的是【登录时读入】的那份配置。
        直接改 JSON 文件，进程不知道你改了 —— 必须走 API 或重启。
```

**目前值**（實測確認）：

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

#### 解決：走 WebUI API 熱改（不重啟，**保住登入狀態**）

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

#### 驗證

```bash
# 期望返回：{"success":true,"saved":true,"applied":true,...}
```

**回傳欄位的含義**：

| 回傳 | 含義 | 怎麼辦 |
|---|---|---|
| `"applied": true` | ✅ **已熱重載目前工作階段**，立即生效 | 完事 |
| `"applied": false` 且 `"online": false` | 帳號目前不在線上，**下次連線時生效** | 等它上線 |
| `"applied": false` 但 `online: true` | 部分網路節點未套用，舊節點已盡力還原 | 看回傳裡的 `errors` 詳情 |
| `"success": false` | 設定驗證失敗 | 看 `message` |

> 服務端原話（原始碼裡的三檔文案）：
> - `"配置保存成功，已热重载当前会话。"`
> - `"配置保存成功，当前会话未在线，将在下次连接时生效。"`
> - `"配置已保存，但部分网络节点未能应用；旧节点已尽力恢复，请查看错误详情。"`

#### ⚠️ 三條路線對比（我實際走過的路）

| 路線 | 結果 | 說明 |
|---|---|---|
| ① 改原始碼預設值 | 容器重啟後才生效 | **但重啟會丟登入狀態** ❌ |
| ② 改設定檔 `onebot_<uin>.json` | **不生效** | 無熱載入 ❌ |
| ③ **走 WebUI API POST 完整 config** | **生效**（`applied:true`） | ✅ **推薦** |

#### 附：觸發詞比對語意

```js
function normalize(s) { return s.trim().toLowerCase(); }

// 精确相等，不是包含匹配
return normalize(message) === normalize(trigger);
```

| 特性 | 行為 |
|---|---|
| 大小寫 | **不敏感**（`#HZ` = `#hz`） |
| 前後空格 | **自動 trim**（`" #hz "` 能比對） |
| **混合訊息** | ❌ **不比對**（`#hz` + 一張圖片 不觸發 —— 必須是單一 text 段） |
| 長度限制 | trigger **最長 32 字元**，不能含換行 |
| 冷卻 | `cooldownSeconds`（目前 5 秒） |

---

### T2 ★★★ 登入狀態遺失 —— 必須重新掃碼（血的教訓）

**這是破壞性最強、最容易誤踩的坑。**

#### 症狀

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

**`loginList` 不是持久化的登入憑證** —— 它是**行程內的工作階段狀態**。
QQ 行程一消失，這個狀態就消失了。

**連帶影響**：容器重啟會一併重啟 QQ 行程（supervisord 的 `[program:qq]`），
所以**重啟容器 = 遺失登入狀態**。

#### 解決：重新掃碼

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

#### 預防

> ⚠️ **做任何需要重啟 QQ / 容器的操作前，先想清楚「要不要重新掃碼」。**
>
> - 需要重啟時，**盡量在能掃碼的時候做**（人在電腦前）
> - **改設定優先走 WebUI API**（T1）—— 這是「不重啟」的唯一正道
> - 部署新 bundle 時**只需要重啟 runtime 行程，不需要重啟 QQ**（見 [build.md](../dev/build.md) §5）
> - **不要設 `--restart=always` 然後指望它自癒** —— 它能重啟，但登入狀態回不來

---

### T3 noVNC 打不開

#### 症狀

```
- 在浏览器里访问 https://<域名>:6181/vnc.html → 打不开 / 连接被拒绝 / 报证书错误
- 换成 http:// 也不行，浏览器自动跳到了 https://
```

#### 根因

```
浏览器 HSTS（HTTP Strict Transport Security）把该域名的 http 强制升级成 https。
noVNC 是明文 HTTP 服务，不支持 https → 连接失败。
```

HSTS 是**按網域**記住的，一旦某個網域被標記，後續所有 http 存取都被強制升級。

#### 解決：**用 IP 代替網域**

```
❌ https://example.com:6181/vnc.html     ← HSTS 强制升级，失败
❌ http://example.com:6181/vnc.html      ← 被浏览器跳到 https，失败
✅ http://<your-host>:6181/vnc.html    ← ★ 用 IP，绕过 HSTS
```

> **關鍵點**：HSTS 只對**網域**生效，對**裸 IP 位址不生效**。
> 所以同一個服務，網域打不開、IP 能打開。

#### 備援方案

```bash
# ① 换浏览器 profile / 无痕模式（HSTS 缓存不在里面）
# ② 清 HSTS：Chrome → chrome://net-internals/#hsts → Delete domain security policies
# ③ 直接端口转发到本地，用 localhost 访问
ssh -L 6181:127.0.0.1:6181 <user>@<服务器>
# 然后访问 http://127.0.0.1:6181/vnc.html
```

#### 驗證

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<服务器IP>:6181/vnc.html
# 期望：200
```

---

### T4 hook 失效（日誌出現 unresolved）

**這是最高優先級的故障** —— 它意味著 QQ 升級了，或者注入失敗。

#### 症狀

```
- OneBot 动作全部失败
- 日志里出现勾子失败串
- grep -c unresolved 返回非 0
```

#### 診斷：第一步永遠是數數

```bash
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'
# 0 = 健康
# >0 = 有问题，继续看下面
```

#### ★ 12 條 RTTI 失敗串 → 具體槽位對照表

**全部 12 條都出自同一個驗證閘門（`.so` 的 `0x5610`）**，
它們構成一個**全「與」關係**的檢查清單 —— **任一條失敗即整鏈失敗並拒絕注入**。

| # | 錯誤串（日誌原文） | 對應目標 | 位址 / 偏移 |
|---|---|---|---|
| 1 | `MSFService SessionInit/RTTI chain unresolved` | MSFService `SessionInit` | `0x137a48c`，**ap+0x98** |
| 2 | `MSFCoreService SessionInit/RTTI chain unresolved` | MSFCoreService `SessionInit` | `0x139d864`，**ap+0x98** |
| 3 | `MSFCoreService packet-state callback/RTTI chain unresolved` | MSFCoreService `onMSFPacketState` | `0x13a3e80`，**ap+0x178** |
| 4 | `MSFService receive anchor/TaskManager RTTI chain unresolved` | MSFService `operator()`（recv push）+ TaskManager 鏈 | `0x1383f14` / `0x1383ee4`，ap+0x100/+0x158 |
| 5 | `MSFService send features missing or ambiguous` | `SendSSORequestInternal` / `SendMsfRequest` | ap+0x120 / +0x130 |
| 6 | `MSFCoreService send features missing or ambiguous` | `SendSSORequest` / `SendMsfRequest` | ap+0x120 / +0x138 |
| 7 | `MSFCoreService packet converter/native allocator unresolved` | `onMsfPushForTesting` / `GetClientAddress` + 分配器 | ap+0x68 |
| 8 | `NG session/receive ownership path unresolved` | NG 工作階段/收包歸屬路徑 | — |
| 9 | `MSF live selector feature/RTTI chain missing or ambiguous` | live selector 特性 | — |
| 10 | `invalid pid` | 目標 PID 無效 | — |
| 11 | `failed to inspect wrapper.node` | 讀 `wrapper.node` 失敗 | — |
| 12 | `runtime service structures could not be read or resolved` | 執行期結構體讀取/解析失敗 | — |

**另外兩條相關串**（不同函式）：

| 錯誤串 | 所在函式 | 含義 |
|---|---|---|
| `missing or ambiguous GNU build ID` | `0x384cc`（模組身分驗證） | build-ID 缺失或不唯一 → **QQ 版本不符** |
| `ELF metadata differs from live memory` | `0x39b10`（磁碟/記憶體比對） | 磁碟檔案與記憶體對應不一致 → **被竄改或版本錯配** |
| `failed to install a resolved receive VTable` | `0xea00`（VTable 安裝） | 解析成功但安裝失敗 → 頁面保護改不動 |
| `QQ runtime cannot read process memory`<br>`[RUNTIME_MEMORY_UNAVAILABLE]` | `0x5610` | 讀取目標行程記憶體被拒 → **核心權限/seccomp 問題** |

#### 依錯誤串分診

| 你看到 | 根因 | 解決 |
|---|---|---|
| `missing or ambiguous GNU build ID` | **QQ 版本變了**，build-ID 不是 `89c36b52…` | 走 [compatibility.md §7](compatibility.md) 適配流程 |
| `…SessionInit/RTTI chain unresolved` | 類別名稱變了（→ 情況 2）或槽位變了（→ 情況 3） | 執行 `dump-vtable.py --diff` |
| `…features missing or ambiguous` | vtable 裡多個候選，無法消歧 | 同上，看 diff 的槽位表 |
| `ELF metadata differs from live memory` | 磁碟上的 `wrapper.node` 與記憶體不一致 | 確認 QQ 沒被外部改動；重新注入 |
| `[RUNTIME_MEMORY_UNAVAILABLE]` | 缺 `CAP_SYS_PTRACE` 或 seccomp 攔截 | 見 T5 |
| `invalid pid` / `module not found in target process maps` | 注錯了行程（注進 zygote 了） | 見 T11 |

#### 解決路徑

```bash
# ① 确认是否能自愈（瞬时错误会自动重试 3 次）
docker exec <容器> sh -c 'grep -oE "auto-load (retry pending|retry exhausted|recovered)[^\"]*" \
  /app/data/logs/$(date +%F).log | sort -u'
```

| 日誌 | 含義 | 處理 |
|---|---|---|
| `auto-load retry pending` | 瞬時錯誤，正在重試 | 等一下 |
| `auto-load recovered: PID=%d attempt=%d/3` | ✅ 自癒成功 | 完事 |
| `auto-load retry exhausted` | ❌ 3 次用盡 | 走下面的適配流程 |

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

> ⚠️ **重要認知**：錯誤訊息**只會說 `unresolved`**，拿不到更多細節。
> 想知道「到底哪裡變了」，**必須自己跑 dump 工具做 diff**。

#### 驗證

```bash
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'   # 应回到 0
# + 端到端：真的发一条消息、真的收一条消息
```

---

### T5 容器啟動失敗，ExitCode 126

#### 症狀

```
docker ps -a
  → Exited (126) X seconds ago

docker logs <容器>
  → /usr/local/bin/node: Operation not permitted
```

容器**立刻退出**，退出碼 **126**。

#### 根因

**缺少兩個必備的核心能力**：

```
① 缺 --cap-add SYS_PTRACE
   → 注入器无法 ptrace 附加到 QQ 进程

② 缺 --security-opt seccomp=unconfined
   → 默认 seccomp 白名单拦截 ptrace / process_vm_readv / process_vm_writev
   → node 启动某个系统调用被拒 → "Operation not permitted" → exit 126
```

退出碼 126 的語意是 **「命令找到了但無法執行」** —— 權限問題，不是「檔案不存在」（那是 127）。

#### 解決

```bash
docker run -d \
  --name snowluma-hz \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  -p 5199:5099 -p 3010:3000 -p 3011:3001 -p 6181:6081 \
  motricseven7/snowluma:latest
```

#### 驗證

```bash
# ① 确认容器起来了
docker ps --filter name=snowluma-hz --format '{{.Status}}'

# ② 确认这两个配置真的在（生产实例实测输出）
docker inspect snowluma-hz --format '{{json .HostConfig.CapAdd}} {{json .HostConfig.SecurityOpt}}'
# 期望：["CAP_SYS_PTRACE"] ["seccomp=unconfined"]
```

#### 排錯順序（退出碼速查）

| 退出碼 | 含義 | 常見原因 |
|---|---|---|
| **126** | 命令無法執行（權限） | **缺 `CAP_SYS_PTRACE` / seccomp** ← 最常見 |
| 127 | 命令不存在 | 映像檔損壞 / 路徑錯 |
| 137 | 被 SIGKILL（通常 OOM） | 記憶體不足 |
| 143 | 被 SIGTERM（正常停止） | 手動 stop |
| 0 | 正常退出 | 前台的行程結束了（正常應常駐） |

---

### T6 `/tmp` 裡的檔案突然消失

#### 症狀

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

**證據**：注入器把 `.so` 寫到 `/tmp/runtime-<uid>/orcexec.<rand6>` 後**立即 unlink**
（`/proc/<pid>/maps` 裡顯示 `(deleted)`）—— 這是設計行為，不是 bug。

#### 解決

| 情境 | 正確做法 |
|---|---|
| **截圖傳給使用者** | **走管道，不落地** —— 直接 base64 輸出，別寫 `/tmp/xxx.png` |
| 需要留存的匯出 | 寫到**掛載卷**（`/app/data/…`），不要寫 `/tmp` |
| 臨時中轉 | 用完立即讀走；或接受它會被清掉 |

```bash
# ✅ 截图走管道（不落盘）
docker exec <容器> sh -c 'import -window root png:-' | base64 -w0

# ✅ 需要留存的文件写到持久卷
docker exec <容器> sh -c '你的命令 > /app/data/export-$(date +%s).txt'

# ❌ 别这样
docker exec <容器> sh -c 'screenshot > /tmp/shot.png'   # 可能被清掉
```

---

### T7 連接埠不通

**這個坑有兩層：Docker 的網路鏈，以及測試方法本身的假陰性。**

#### 症狀

```
- 从宿主机访问容器端口，连不上
- 但容器内 curl 是通的（或者反之）
- 用 /dev/tcp 测试报不可达，但 curl 返回 200
```

#### 根因

**根因一：Docker 連接埠走 FORWARD 鏈，不是 INPUT**

```
宿主机 →（PREROUTING DNAT）→ FORWARD → 容器
                          ⚠️ 不是 INPUT 链
```

所以**按 INPUT 鏈設的防火牆規則不生效**：
你明明「放通了這個連接埠」，流量還是被 FORWARD 鏈預設原則攔掉。

**根因二：`/dev/tcp` 測試有假陰性**

```
同一个端口，/dev/tcp 报不可达，curl 却返回 200。
```

`/dev/tcp` 是 bash 內建，它的行為受**多種因素**影響（DNS 解析、IPv6 優先、
bash 編譯選項、逾時處理），**不適合做連通性判據**。

#### 解決

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

#### 驗證

```bash
# 期望：一个 2xx/3xx/4xx 的 HTTP 状态码（401/404 也算"通"，因为 TCP 层通了）
curl -s -o /dev/null -w '%{http_code}\n' http://<IP>:5199/
```

> **判讀提示**：`401` / `404` **都是「通」的證據** ——
> 說明 TCP 連上了、HTTP 服務在回應。只有 `000`（連線失敗）才是真的不通。

---

### T8 WebUI 密碼強度不足，無法設定

#### 症狀

```
- 设置 WebUI 密码时被拒
- 或者：设置了弱密码，登录后强制要求改密码
  （mustChangePassword 门禁：除白名单路由外全部返回 403 + mustChangePassword:true）
```

#### 根因

**密碼規則**（`packages/core/src/webui/auth.ts` 的 `PASSWORD_RULES`，原始碼原文）：

```js
var PASSWORD_RULES = [
  { id: "length",  label: "长度不少于 10 位",        test: (p) => p.length >= 10 },
  { id: "lower",   label: "包含小写字母",            test: (p) => /[a-z]/.test(p) },
  { id: "upper",   label: "包含大写字母",            test: (p) => /[A-Z]/.test(p) },
  { id: "special", label: "包含特殊符号 (!@#$%…)",   test: (p) => /[^A-Za-z0-9\s]/.test(p) },
  { id: "no-space",label: "不包含空格",              test: (p) => !/\s/.test(p) && p.length > 0 }
];
```

**五條全過才算強密碼**（`isStrongPassword` = `every()`）。

#### 解決

密碼必須**同時滿足**：

| 要求 | 說明 |
|---|---|
| **長度 ≥ 10** | 少於 10 位直接拒 |
| **含小寫字母** | `a-z` |
| **含大寫字母** | `A-Z` |
| **含特殊符號** | `!@#$%…`（任何非字母數字非空白字元） |
| **不含空格** | |

範例格式：`<Your-Password>`（≥10 位、含大小寫+數字+特殊符號、無空格）。

#### 相關介面與機制

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

| 機制 | 說明 |
|---|---|
| **雜湊演算法** | `crypto.scryptSync`，`N=16384` / `r=8` / `p=1` / `keylen=64` |
| **比對** | `timingSafeEqual`（防時序攻擊） |
| **強度評估** | `@zxcvbn-ts/core`（額外給出強度評分） |
| **2FA** | TOTP（RFC 4226/6238），路由 `/api/auth/totp/*` |
| **登入限速** | 同 IP 連續失敗會鎖定（回傳 429 + 剩餘秒數） |
| **首次啟動引導** | `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD`（**< 8 位會被忽略**） |

---

### T9 改了設定但沒生效

#### 症狀

```
- 改了配置文件 → 无变化
- 不确定该改哪个目录下的文件
```

#### 根因一：改的是「設定檔」，但執行時不熱載入它

這是 T1 的同源問題。**分類型處理**：

| 設定類型 | 改檔案生效嗎 | 正確做法 |
|---|---|---|
| `onebot_<uin>.json`（每帳號） | ❌ **不熱載入** | **走 WebUI API `POST /api/config/:uin`** |
| `runtime.json`（全域運作） | ⚠️ 部分欄位是**布林白名單**，可熱重載 | `hookAutoLoad` / `webuiTls.enabled` 在白名單裡；其他要重啟 |
| `ui.json`（WebUI 外觀） | ✅ 可透過 API | `POST /api/ui` |
| `webui.json`（密碼） | ✅ 走 API | `POST /api/auth/change-password` |

#### 根因二：改錯了目錄（**chatluna 是 `/data/instance/`，不是 `/app/`**）

**這是最容易搞混的一點** —— 容器裡存在**兩套完全不同的目錄前綴**：

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

> **判據**：你要改的是 **Haizakura 的行為** → 找 `/app/`；
> 你要改的是 **chatluna（外部對接的 bot 框架）** → 找 `/data/instance/`。
> **兩者不通。**

#### 根因三：容器不是你想的那個

```bash
# 确认你改的是正在运行的那个容器
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect <容器> --format '{{json .HostConfig.Binds}}'
```

> ⚠️ **特別注意**：可能存在**已停止的舊容器**（例如 `snowluma` 就是舊的，
> 設定裡是 `#sl`；目前生效的是 `snowluma-hz`，設定裡是 `#hz`）。
> **改對了檔案，但改在舊容器的卷裡 = 白改。**

#### 解決：先定位，再改

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

### T10 跨機傳檔案被截斷

#### 症狀

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

#### 解決

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

#### ★ 必須兩端校驗

```bash
# 本地
sha256sum local-file.tgz
# 远端
ssh <host> 'sha256sum /remote/path/file.tgz'

# 值必须【完全一致】
```

> **教訓**：
> - **檔案長度相同也可能內容不同** —— 別拿 `ls -l` 當校驗
> - **必須用 sha256/md5**，不要只看大小
> - 長傳輸用背景任務 + 輪詢日誌（`setsid nohup ... &`），SSH 閒置斷線會殺掉前台任務

---

### T11 注入進了 zygote，搞壞 QQ 的 IPC 和登入介面

#### 症狀

```
- QQ 界面白屏 / 登录界面异常 / QQ 的进程间通信失灵
- 日志里出现 "auto-load skip: PID=%d is an Electron child process (--type=%s)"
- 或者：hook 好像生效了但 QQ 本身坏掉了
```

#### 根因

**Electron 子行程會被誤判為「主 QQ 行程」**，原因有兩個疊加：

```
① 子进程（zygote / renderer / gpu / utility）的 cmdline 里也含 "qq"
② 它们通过 fork 的 copy-on-write 会【短暂继承 wrapper.node 映射】

→ .node 的进程枚举器把它们错认成"主 QQ"
```

**後果很嚴重**：

```
注进 zygote → 在 zygote 里启动 hook 的 resolver 线程
            → 之后 Electron fork 出的【每个 renderer 都会继承该线程
              + 半初始化的 hook 状态】
            → 【直接搞坏 QQ 的 IPC 和登录界面】
```

**原始碼註解原文**：

> *"Injecting into a zygote spawns the hook's resolver thread inside it;
> every renderer Electron later forks then inherits that thread + the
> partially-init'd hook state, which breaks QQ's IPC and login UI."*

#### 解決：過濾機制（已內建，預設開啟）

原始碼 `shouldAutoLoadPid()` 的邏輯：

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

**判別方法非常簡單有效**：讀 `/proc/<pid>/cmdline`，含 `--type=` 就跳過。
主 QQ 行程的 cmdline 是 `qq --no-sandbox --disable-gpu …`，**不含** `--type=`。

#### 三個開關

| 開關 | 作用 | 風險 |
|---|---|---|
| `shouldAutoLoadPid()`（預設行為） | 自動跳過 `--type=` 的行程 | ✅ 安全，保持預設 |
| `SNOWLUMA_HOOK_AUTOLOAD_ALL=1` | **放行所有 PID**（逃生艙） | ⚠️ **會注進 zygote，搞壞 QQ** |
| `POST /api/processes/:pid/load` | **手動載入，繞過閘門** | ⚠️ 操作員自負責任 |

#### 驗證

```bash
# ① 确认注的是主进程，不是子进程
docker exec <容器> sh -c 'ps -eo pid,args | grep -E "qq --" | grep -v -- --type='

# ② 确认跳过日志
docker exec <容器> sh -c 'grep -oE "auto-load skip: PID=[0-9]+ is an Electron child process[^\"]*" \
  /app/data/logs/$(date +%F).log | sort -u'

# ③ 确认 socket 的 pid 是主进程
docker exec <容器> sh -c 'ls /tmp/runtime-*/mojo.*.control.sock'
```

**旁證**：`.so` 裡還有另一層守衛 `isTransientLibcMappingError()`，
比對 `"target process does not map /libc.so.6 while resolving mmap"` ——
說明**注入器要求目標行程已對應 libc**（即已完成動態連結），
zygote 早期恰好不滿足。

---

### T12 自動更新必然失敗（404）

#### 症狀

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

**不是網路問題、不是映像檔問題 —— 是倉庫真的沒了。**

#### 解決

三種方式，選一：

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

**三種模式**（`update/sources.ts`）：

| 模式 | 行為 |
|---|---|
| `auto`（預設） | 先直連，再逐個映像檔回落（`mirrors` 最多 16 個） |
| `direct` | 只直連 |
| `mirror` | 只用自填映像檔 |

**預設映像檔清單**（**全部指向 GitHub，因此全部 404**）：

```
https://ghfast.top          https://ghproxy.net
https://gh-proxy.com        https://github.chenc.dev
https://fastgit.cc          https://gh.noki.icu
https://cors.isteed.cc      https://gh-proxy.org
https://githubproxy.gohj99.site   https://github.xxlab.tech
```

#### 驗證

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  https://api.github.com/repos/SnowLuma/SnowLuma/releases/
# 期望：404（确认仓库已删）
```

> ⚠️ **接手必做項**：`update/sources.ts` 是**必須改**的檔案之一。
> 相關 WebUI 路由：`GET /api/update/check`、`GET/POST /sources`、`POST /sources/test`、`POST /download`。

---

### T13 日誌佔用磁碟越來越大

#### 症狀

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

#### 解決

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

#### 驗證

```bash
docker exec <容器> sh -c 'du -sh /app/data/logs/; ls -la /app/data/logs/'
```

#### 相關：WebUI 儲存空間清理

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/system/storage
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/system/storage/cleanup
```

> **注意**：`messages.db` 會隨訊息累積（實測曾達 70.8 MB + 4 MB WAL）。
> 大流量情境要關注 `/app/data/data/<uin>/` 的總量。

---

### T14 WebUI 登入相關的其他坑

#### T14.1 登入被限速（429）

```
症状：返回 {"success":false,"message":"登录尝试过多，请 N 秒后重试"}
根因：同 IP 连续密码错误触发锁定（loginAttempts 按 IP 计数）
解决：等剩余秒数；或从另一个 IP 访问；或重启 runtime 清空计数
```

> **限速鍵**取決於 `trustProxy` 設定：預設按 **socket peer** 計。
> 走反向代理時若不設 `trustProxy`，所有使用者會被當成同一個 IP。

#### T14.2 登入成功後仍需同意協議 / 改密碼

```
症状：除白名单路由外，所有 API 返回 403
      {"status":"failed","message":"请先阅读并同意用户协议与隐私政策","consentRequired":true}
      {"status":"failed","message":"请先修改密码","mustChangePassword":true}
根因：两个独立门禁
解决：consentGatePending → POST /api/agreements/record-consent
      mustChangePassword → POST /api/auth/change-password
批量部署：SNOWLUMA_ACCEPT_EULA=1 SNOWLUMA_ACCEPT_PRIVACY=1
```

> `EULA.md` / `PRIVACY.md` 缺失時會警告：
> `[WebUI.Consent] agreement file not found (looked for EULA.md near the bundle and repo root)`

#### T14.3 走反向代理後拿不到真實用戶端 IP

```
症状：所有请求的「客户端 IP」都是反代的地址
根因：trustProxy 未配 / 配错
解决：runtime.json 的 trustProxy 设成：
      ""          关闭（默认，按 socket peer）
      "all"       信任任何 peer 的 X-Real-IP / X-Forwarded-For
      "loopback"  仅当 socket peer 是回环时信任
      "ip-list"   仅当 socket peer 在指定 IP 列表内时信任
```

#### T14.4 WebUI 連接埠被佔用

```
症状：WebUI 起不来
根因：端口冲突。注意容器映射后【容器内仍是 5099】，宿主机是 5199
解决：确认容器内监听 5099；换宿主机映射端口，而不是改容器内端口
相关源码：findAvailablePort(start, { maxTries: 50, host }) —— 会向上找 50 个可用端口
```

---

### T15 逆向/除錯腳本把自己的機器搞掛

**這不是執行期的坑，是維護期的坑** —— 但代價很大，值得單列。

#### 症狀

```
- 跑分析脚本时负载飙到 37
- 内存被吃到 2.7 GB
- 终端被吐 10 MB 文本
- 脚本 struct.error 崩掉
```

#### 根因（已知陷阱表）

| # | 陷阱 | 後果 | 正確做法 |
|---|---|---|---|
| **T1** | 拿「已定義匯出」子集當「全部符號」 | **得出「dynsym 裡沒有 RTTI」的錯誤結論**（實際有 397 個） | 永遠回到 `readelf -sW --dyn-syms` 原文 |
| **T2** | 按字面值 `"MSFService"` 搜 typeinfo | **0 命中**（`__type_name` 是 mangled `N2nt10MSFServiceE`） | 比對 `N<len><ns><len><Class>E` 模式；排除日誌 TAG / JS 屬性名 |
| **T3** | 把 `.data.rel.ro` 的 vaddr 當 file off | 全表偏移錯 `0x10000` | 從節表算 `Δ = vaddr − file_off`，**不要寫死** |
| **T4** | 對 `mmap` 切片做 `b[:z]` 而 `z == -1`（沒有 NUL） | **一次吐 10 MB 輸出** | 任何衍生字串前斷言 `z > 0` |
| **T5** | `.eh_frame_hdr` 編碼位元組解析錯（把 pcrel 當無號） | 得到 `fde_count=1.8e19` → **越界/無限迴圈 → OOM（2.7 GB）** | 按 `enc & 0x0f` / `enc & 0x70` 分別處理；**所有迴圈加上限** |
| **T6** | 取「第一個值 == typeinfo 的槽位」當 primary vtable | MSFService 有 **5 個**位址點，會選錯 | 必須按 **`offset_to_top == 0`** 過濾出 primary |
| **T7** | 只看「行程沒崩」就認為適配成功 | 槽位錯一位 → 靜默發錯路徑 → 使用者看到 `"The QQ connection changed…"` | 必須做**真實收發訊息**的端對端驗證 |

#### 附帶坑（工具使用層面）

| 坑 | 後果 | 正確做法 |
|---|---|---|
| bundle 裡有 NUL 位元組 | `grep -oE` 會截斷行（只得 147 個 region） | 用 `grep -a`；提取 region 用 **Python 正規表達式**（得 467 個） |
| `strings` 把 ARM64 機器碼誤當字串 | 4,519 行裡 ~3,600 行是雜訊 | 真字串集中在**第 1–176 行**和**第 3799–4050 行** |
| bundle 內嵌 330 KB 的 zxcvbn 密碼字典（單行） | `grep -C` 會把整個字典印到終端機 | 用 `grep -an` 只要行號；或先 `sed -n 'A,Bp'` 定位 |
| `grep -c <关键词>` 在 bundle 上會騙你 | `backoff`/`jitter`/`circuit` 的「命中」全是那一行字典 | **看行號分佈，不要看計數**。若計數 1~3 且都指向同一行 → 假陽性 |
| 長任務前台跑 | SSH 閒置 ~10 分鐘斷線，任務跟著死 | `setsid nohup … &` + 輪詢 `tail -c 800 log \| tr '\r' '\n' \| tail` |

#### 鐵律

> **執行逆向腳本時必須加計數上限。**
> 一次迴圈邊界寫錯就能把負載推到 37、記憶體吃到 2.7 GB。
> 所有 `struct.unpack_from` 帶明確 `cnt` 上限、`i < cnt` 前置檢查、
> **永不 stdout 大物件**（全寫檔案）。

---

## 4. 附錄 A：完整 `SNOWLUMA_*` 環境變數清單（36 個）

| 變數 | 用途 |
|---|---|
| `SNOWLUMA_HOOK_AUTOLOAD_ALL` | `=1` 放行所有 PID 自動注入，**繞過 zygote 過濾**（危險） |
| `SNOWLUMA_HOOK_AUTOLOAD` | 覆寫 `runtime.json` 的 `hookAutoLoad` |
| `SNOWLUMA_HOOK_RUNTIME_DIR` | 指定 `mojo.*.sock` 所在目錄 |
| `SNOWLUMA_HOOK_ACK_TIMEOUT_MS` | 控制通道 ACK 逾時（預設 5000） |
| `SNOWLUMA_PACKET_TIMEOUT_MS` | 業務包逾時 |
| `SNOWLUMA_SESSION_RELEASE_DEADLINE_MS` | 工作階段釋放截止時間 |
| `SNOWLUMA_STREAM_DIR` | 串流下載落地目錄（非法時 warn 並忽略） |
| `SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES` | 二進位下載大小上限 |
| `SNOWLUMA_HTTP_DOWNLOAD_TIMEOUT_MS` | HTTP 下載逾時 |
| `SNOWLUMA_DOWNLOAD_FILE_TIMEOUT_MS` | `download_file` 動作逾時（⚠️ 與上一個不同） |
| `SNOWLUMA_NOTIFICATION_HTTP_TIMEOUT_MS` | 通知 webhook 逾時 |
| `SNOWLUMA_UPDATE_ROOT` | 更新根目錄（開發/測試更新流程） |
| `SNOWLUMA_UPDATE_CHECK` | 是否檢查更新（**上游刪庫後建議設 0**） |
| `SNOWLUMA_WEBUI_PORT` | WebUI 連接埠（預設 5099） |
| `SNOWLUMA_WEBUI_HOST` | WebUI 綁定位址 |
| `SNOWLUMA_WEBUI_TARGET` | UI 主題預置，**唯一合法值 `maibot`** |
| `SNOWLUMA_WEBUI_TLS` | 覆寫 `webuiTls.enabled` |
| `SNOWLUMA_WEBUI_TRUST_PROXY` | 覆寫 `trustProxy` |
| `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD` | 首次啟動注入 WebUI 密碼（**< 8 位被忽略**） |
| `SNOWLUMA_ONEBOT_HTTP_PORT` | OneBot HTTP 連接埠 |
| `SNOWLUMA_ONEBOT_WS_PORT` | OneBot WS 連接埠 |
| `SNOWLUMA_ONEBOT_HOST` | OneBot 綁定位址（生產實例為 `0.0.0.0`） |
| `SNOWLUMA_LOG_DIR` | 日誌目錄（預設 `/app/data/logs`） |
| `SNOWLUMA_LOG_FILE` | `=0` 關閉檔案日誌 |
| `SNOWLUMA_LOG_LEVEL` | 主控台層級，預設 `info` |
| `SNOWLUMA_LOG_FILE_LEVEL` | 檔案層級，僅 `debug/info/success/warn/error` |
| `SNOWLUMA_LOG_MAX_MB` | 單一檔案上限 |
| `SNOWLUMA_LOG_MAX_TOTAL_MB` | 日誌總量上限（預設 1024） |
| `SNOWLUMA_LOG_RETAIN_DAYS` | 日誌保留天數（預設 7） |
| `SNOWLUMA_LOG_PER_UIN` | 按 uin 分檔案 |
| `SNOWLUMA_TRACE_BUFFER` | 追蹤緩衝條數 |
| `SNOWLUMA_VERBOSE_WARMUP` | `=1` 列印預熱細節 |
| `SNOWLUMA_DEV_MODE` | 開發模式（會用 `snowluma-dev` 固定密碼） |
| `SNOWLUMA_DEV_WEBUI` | 開發模式 WebUI |
| `SNOWLUMA_DEV_NO_NATIVE` | `=1` 用 stub 替代 native addon |
| `SNOWLUMA_ACCEPT_EULA` | 非互動接受 EULA |
| `SNOWLUMA_ACCEPT_PRIVACY` | 非互動接受隱私政策 |
| `SNOWLUMA_HOME` / `SNOWLUMA_DATA` | 執行目錄 / 資料目錄（生產：`/app/runtime` / `/app/data`） |
| `SNOWLUMA_UID` / `SNOWLUMA_GID` | 容器內執行身分（生產：1000/1000） |
| `SNOWLUMA_SCREEN` | Xvfb 螢幕尺寸（生產：`1920x1080x24`） |
| `SNOWLUMA_QQ_FLAGS` | 傳給 QQ 的啟動參數 |
| `SNOWLUMA_EXTRA_QQ_HOMES` | 額外的 QQ HOME 目錄 |
| `QQ_RECV_HEARTBEAT_CMD` | **【未查清】** 疑似 QQ 收包心跳命令名 |

> ⚠️ **`SNOWLUMA_HOOK_RUNTIME_DIR` 的跨行程路徑依賴 `/proc/<pid>/environ` 可讀** ——
> 同 uid 時可行，**跨 uid 會失敗**。【未查清】

---

## 5. 附錄 B：`runtime.json` 完整欄位

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

> **可熱重載的欄位**：`hookAutoLoad` / `webuiTls.enabled` 是**布林白名單**。
> 其他欄位改檔案後**需要重啟**。

---

## 6. 附錄 C：一句話排查口訣

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

## 7. 相關檔案

| 想了解 | 去看 |
|---|---|
| 它到底怎麼運作的 | [architecture.md](architecture.md) |
| 支援哪些版本 / 依賴什麼 | [compatibility.md](compatibility.md) |
| 怎麼從原始碼建置 | [build.md](../dev/build.md) |
| 怎麼參與開發 | [contributing.md](../dev/contributing.md) |

---

*本文所有命令與報錯均來自實測。證據等級保留原標註：
【確證】有直接證據 /【強推斷】多證據交叉 /【推斷】合理未驗證 /【未查清】明確的知識空白。*
