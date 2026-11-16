# 故障排查

> [!WARNING]
> 本内容完全由 AI 編写、請慎重閲覧。

> **対象読者**：Haizakura（原名 SnowLuma）之部署或運用者。
> **本文者実戦手冊也** —— 各条皆出自**実際踏過之坑**、格式統一為
> **症状 → 根因 → 解決 → 検証**。
> 遇問題先実行第 1 節之体検、再按症状査表。

---

## 1. 三十秒体検

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

**五項目全過 = 系統健康也。** 有異常 → 按 §3 之編号査。

---

## 2. 排查工具速査

### 2.1 工程与注入

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

### 2.2 WebUI API（運用最常用）

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

### 2.3 記録検索

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

## 3. 故障病歴

---

### T1 ★ 改状態指令之触発詞、然機械人仍応旧指令

**此者設定優先順位之問題、非 bug 也。**

#### 症状

```
- 我改代码里之既定触発詞、自 #sl 改為 #Haizakura
  → 容器再起動後方有効（然再起動会失登録態 ❌）
- 我直接改 /app/data/config/onebot_<uin>.json 之 trigger
  → 完全無効 ❌
- 機械人仍只応旧触発詞
```

#### 根因

**二層原因相重**：

```
原因一：設定優先順位
        運行時設定（onebot_<uin>.json）  >  代码既定値（DEFAULT_STATUS_COMMAND）
        → 改代码既定値対既存帳号無効

原因二：★ 改設定文件【非熱載】
        運行時記憶体内保存者、【登録時読入】之該設定也。
        直接改 JSON 文件、工程不知汝改 —— 必須経 API 或再起動。
```

**当前値**（実測確認）：

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

#### 解決：経 WebUI API 熱改（不再起動、**保住登録態**）

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

#### 検証

```bash
# 期望返回：{"success":true,"saved":true,"applied":true,...}
```

**返却字段之含义**：

| 返却 | 意味 | 対処 |
|---|---|---|
| `"applied": true` | ✅ **当前会話已熱重載**、即時有効 | 完事 |
| `"applied": false` 且 `"online": false` | 帳号当前不在線、**次回接続時有効** | 待其上線 |
| `"applied": false` 但 `online: true` | 一部網絡節点未適用、旧節点已尽力復旧 | 看返却中之 `errors` 詳情 |
| `"success": false` | 設定検証失敗 | 看 `message` |

> 伺服器側原話（源碼中之三档文案）：
> - `"配置保存成功，已热重载当前会话。"`
> - `"配置保存成功，当前会话未在线，将在下次连接时生效。"`
> - `"配置已保存，但部分网络节点未能应用；旧节点已尽力恢复，请查看错误详情。"`

#### ⚠️ 三路対比（我実際走過之路）

| 路 | 結果 | 説明 |
|---|---|---|
| ① 改源碼既定値 | 容器再起動後方有効 | **然再起動失登録態** ❌ |
| ② 改設定文件 `onebot_<uin>.json` | **無効** | 無熱載 ❌ |
| ③ **経 WebUI API POST 完全 config** | **有効**（`applied:true`） | ✅ **推薦** |

#### 附：触発詞匹配語義

```js
function normalize(s) { return s.trim().toLowerCase(); }

// 精确相等，不是包含匹配
return normalize(message) === normalize(trigger);
```

| 特性 | 挙動 |
|---|---|
| 大小写 | **不敏感**（`#HZ` = `#hz`） |
| 前後空格 | **自動 trim**（`" #hz "` 能匹配） |
| **混合消息** | ❌ **不匹配**（`#hz` + 一図片 不触発 —— 必須為単一 text 段） |
| 長度限制 | trigger **最長 32 文字**、不能含改行 |
| 冷却 | `cooldownSeconds`（当前 5 秒） |

---

### T2 ★★★ 登録態喪失 —— 必須再掃碼（血之教訓）

**此者破壊性最強、最易誤踏之坑也。**

#### 症状

```
- 重起了 QQ 工程 / 重起了容器
- WebUI 表示未登録、OneBot 動作全部返却
  "QQ is not ready. Please finish signing in and try again."
- 検査発見 loginList 為空
```

#### 根因

```
QQ 工程再起動 → loginList 被清空 → 必須再掃碼
```

**`loginList` 非持久化之登録凭拠也** —— 此者**工程内之会話状態**也。
QQ 工程一無、此状態亦無。

**連帯影響**：容器再起動会同時再起動 QQ 工程（supervisord 之 `[program:qq]`）、
故**再起動容器 = 失登録態**也。

#### 解決：再掃碼

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

#### 予防

> ⚠️ **凡需再起動 QQ / 容器之操作前、先想清「要不要再掃碼」也。**
>
> - 需再起動時、**尽量在能掃碼之時行**（人在電脳前）
> - **改設定優先経 WebUI API**（T1）—— 此者「不再起動」之唯一正道也
> - 部署新 bundle 時**只需再起動 runtime 工程、不需再起動 QQ**（見 [build.md](../dev/build.md) §5）
> - **勿設 `--restart=always` 而望其自愈** —— 其能再起動、然登録態不復也

---

### T3 noVNC 打不開

#### 症状

```
- 在瀏覧器里訪問 https://<域名>:6181/vnc.html → 打不開 / 連接被拒 / 報証書錯誤
- 換成 http:// 亦不行、瀏覧器自動跳至 https://
```

#### 根因

```
瀏覧器 HSTS（HTTP Strict Transport Security）将該域名之 http 強制昇格為 https。
noVNC 者明文 HTTP 服務、不支援 https → 連接失敗。
```

HSTS 者**按域名**記憶之、一旦某域名被標記、後続所有 http 訪問皆被強制昇格。

#### 解決：**以 IP 代域名**

```
❌ https://example.com:6181/vnc.html     ← HSTS 強制昇格、失敗
❌ http://example.com:6181/vnc.html      ← 被瀏覧器跳至 https、失敗
✅ http://<your-host>:6181/vnc.html    ← ★ 用 IP、繞過 HSTS
```

> **要点**：HSTS 只対**域名**有効、対**裸 IP 地址無効**。
> 故同一服務、域名打不開、IP 能打開。

#### 代替案

```bash
# ① 换浏览器 profile / 无痕模式（HSTS 缓存不在里面）
# ② 清 HSTS：Chrome → chrome://net-internals/#hsts → Delete domain security policies
# ③ 直接端口转发到本地，用 localhost 访问
ssh -L 6181:127.0.0.1:6181 <user>@<服务器>
# 然后访问 http://127.0.0.1:6181/vnc.html
```

#### 検証

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<服务器IP>:6181/vnc.html
# 期望：200
```

---

### T4 hook 失效（記録出現 unresolved）

**此者最高優先度之故障也** —— 其意味 QQ 已昇級、或注入失敗。

#### 症状

```
- OneBot 動作全部失敗
- 記録里出現釣針失敗串
- grep -c unresolved 返却非 0
```

#### 診断：第一步永遠為数数

```bash
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'
# 0 = 健康
# >0 = 有问题，继续看下面
```

#### ★ 12 条 RTTI 失敗串 → 具体槽位対照表

**全部 12 条皆出自同一検証閘門（`.so` 之 `0x5610`）**、
其等構成**全「与」関係**之検査表 —— **任一条失敗即全鏈失敗、拒絶注入**。

| # | 錯誤串（記録原文） | 対応目標 | 地址 / 偏移 |
|---|---|---|---|
| 1 | `MSFService SessionInit/RTTI chain unresolved` | MSFService `SessionInit` | `0x137a48c`、**ap+0x98** |
| 2 | `MSFCoreService SessionInit/RTTI chain unresolved` | MSFCoreService `SessionInit` | `0x139d864`、**ap+0x98** |
| 3 | `MSFCoreService packet-state callback/RTTI chain unresolved` | MSFCoreService `onMSFPacketState` | `0x13a3e80`、**ap+0x178** |
| 4 | `MSFService receive anchor/TaskManager RTTI chain unresolved` | MSFService `operator()`（recv push）+ TaskManager 鏈 | `0x1383f14` / `0x1383ee4`、ap+0x100/+0x158 |
| 5 | `MSFService send features missing or ambiguous` | `SendSSORequestInternal` / `SendMsfRequest` | ap+0x120 / +0x130 |
| 6 | `MSFCoreService send features missing or ambiguous` | `SendSSORequest` / `SendMsfRequest` | ap+0x120 / +0x138 |
| 7 | `MSFCoreService packet converter/native allocator unresolved` | `onMsfPushForTesting` / `GetClientAddress` + 分配器 | ap+0x68 |
| 8 | `NG session/receive ownership path unresolved` | NG 会話 / 収包帰属路 | — |
| 9 | `MSF live selector feature/RTTI chain missing or ambiguous` | live selector 特性 | — |
| 10 | `invalid pid` | 目標 PID 無効 | — |
| 11 | `failed to inspect wrapper.node` | 読 `wrapper.node` 失敗 | — |
| 12 | `runtime service structures could not be read or resolved` | 運行期構造体読取 / 解析失敗 | — |

**別二条関連串**（不同関数）：

| 錯誤串 | 所在関数 | 含义 |
|---|---|---|
| `missing or ambiguous GNU build ID` | `0x384cc`（模組身份検証） | build-ID 缺失或不唯一 → **QQ 版本不匹配** |
| `ELF metadata differs from live memory` | `0x39b10`（磁盤 / 記憶体比対） | 磁盤文件与記憶体映射不一致 → **被篡改或版本錯配** |
| `failed to install a resolved receive VTable` | `0xea00`（VTable 安裝） | 解析成功然安裝失敗 → 頁保護改不動 |
| `QQ runtime cannot read process memory`<br>`[RUNTIME_MEMORY_UNAVAILABLE]` | `0x5610` | 読目標工程記憶体被拒 → **内核権限 / seccomp 問題** |

#### 按錯誤串分診

| 汝見 | 根因 | 解決 |
|---|---|---|
| `missing or ambiguous GNU build ID` | **QQ 版本已変**、build-ID 非 `89c36b52…` | 経 [compatibility.md §7](compatibility.md) 適配流程 |
| `…SessionInit/RTTI chain unresolved` | 類名已変（→ 情況 2）或槽位已変（→ 情況 3） | 跑 `dump-vtable.py --diff` |
| `…features missing or ambiguous` | vtable 里多候補、無法消歧 | 同上、看 diff 之槽位表 |
| `ELF metadata differs from live memory` | 磁盤上之 `wrapper.node` 与記憶体不一致 | 確認 QQ 未被外部改動、再注入 |
| `[RUNTIME_MEMORY_UNAVAILABLE]` | 缺 `CAP_SYS_PTRACE` 或 seccomp 遮断 | 見 T5 |
| `invalid pid` / `module not found in target process maps` | 注錯工程（注入 zygote 也） | 見 T11 |

#### 解決路

```bash
# ① 确认是否能自愈（瞬时错误会自动重试 3 次）
docker exec <容器> sh -c 'grep -oE "auto-load (retry pending|retry exhausted|recovered)[^\"]*" \
  /app/data/logs/$(date +%F).log | sort -u'
```

| 記録 | 含义 | 処理 |
|---|---|---|
| `auto-load retry pending` | 瞬時錯誤、正在再試 | 待一会 |
| `auto-load recovered: PID=%d attempt=%d/3` | ✅ 自愈成功 | 完事 |
| `auto-load retry exhausted` | ❌ 3 次用尽 | 経下方之適配流程 |

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

> ⚠️ **重要認知**：錯誤信息**只言 `unresolved`**、不能得更多細節。
> 欲知「到底何変」、**必須自跑 dump 工具作 diff**。

#### 検証

```bash
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'   # 应回到 0
# + 端到端：真的发一条消息、真的收一条消息
```

---

### T5 容器起動失敗、ExitCode 126

#### 症状

```
docker ps -a
  → Exited (126) X seconds ago

docker logs <容器>
  → /usr/local/bin/node: Operation not permitted
```

容器**即刻退出**、退出码 **126**。

#### 根因

**缺二個必須之内核能力**：

```
① 缺 --cap-add SYS_PTRACE
   → 注入器無法 ptrace 附加至 QQ 工程

② 缺 --security-opt seccomp=unconfined
   → 既定 seccomp 白名单遮断 ptrace / process_vm_readv / process_vm_writev
   → node 起動某系統呼出被拒 → "Operation not permitted" → exit 126
```

退出码 126 之語義者 **「命令已見然不能実行」** —— 権限問題也、非「文件不存在」（彼者 127）。

#### 解決

```bash
docker run -d \
  --name snowluma-hz \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  -p 5199:5099 -p 3010:3000 -p 3011:3001 -p 6181:6081 \
  motricseven7/snowluma:latest
```

#### 検証

```bash
# ① 确认容器起来了
docker ps --filter name=snowluma-hz --format '{{.Status}}'

# ② 确认这两个配置真的在（生产实例实测输出）
docker inspect snowluma-hz --format '{{json .HostConfig.CapAdd}} {{json .HostConfig.SecurityOpt}}'
# 期望：["CAP_SYS_PTRACE"] ["seccomp=unconfined"]
```

#### 排錯順序（退出码速査）

| 退出码 | 含义 | 常見原因 |
|---|---|---|
| **126** | 命令不能実行（権限） | **缺 `CAP_SYS_PTRACE` / seccomp** ← 最常見 |
| 127 | 命令不存在 | 鏡像破損 / 路徑錯 |
| 137 | 被 SIGKILL（通常 OOM） | 記憶体不足 |
| 143 | 被 SIGTERM（正常停止） | 手動 stop |
| 0 | 正常退出 | 前台之工程已終（正常応常駐） |

---

### T6 `/tmp` 里之文件突然消失

#### 症状

```
- 在容器 /tmp 下生成之截図 / 輸出文件、数秒後即找不到
- 或者：写至 /tmp 之文件読到 0 字节
```

#### 根因

```
容器内 /tmp 会被定期清理（tmp 清理機制）。
注入器自身亦用 /tmp（臨時文件落地後即刻 unlink）——
故 /tmp 在此容器里為【高周転区】、不宜置需留存之物。
```

**証拠**：注入器将 `.so` 写至 `/tmp/runtime-<uid>/orcexec.<rand6>` 後**即刻 unlink**
（`/proc/<pid>/maps` 里表示 `(deleted)`）—— 此者設計行為也、非 bug。

#### 解決

| 場景 | 正確做法 |
|---|---|
| **截図発送至使用者** | **経管道、不落盤** —— 直接 base64 輸出、勿写 `/tmp/xxx.png` |
| 需留存之輸出 | 写至**掛載巻**（`/app/data/…`）、勿写 `/tmp` |
| 臨時中転 | 用畢即刻読走；或接受其会被清 |

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

**此坑有二層：Docker 之網絡鏈、及測試方法自身之偽陰性也。**

#### 症状

```
- 自宿主機訪問容器端口、連不上
- 然容器内 curl 是通的（或者反之）
- 用 /dev/tcp 測試報不可達、然 curl 返却 200
```

#### 根因

**根因一：Docker 端口走 FORWARD 鏈、非 INPUT**

```
宿主機 →（PREROUTING DNAT）→ FORWARD → 容器
                          ⚠️ 非 INPUT 鏈
```

故**按 INPUT 鏈配置之防火牆規則不有効**：
汝明明「放通此端口」、流量仍被 FORWARD 鏈既定策略遮断。

**根因二：`/dev/tcp` 測試有偽陰性**

```
同一端口、/dev/tcp 報不可達、curl 却返却 200。
```

`/dev/tcp` 者 bash 内建也、其行為受**多種因素**影響（DNS 解析、IPv6 優先、
bash 編譯選項、超時処理）、**不宜為連通性判拠**。

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

#### 検証

```bash
# 期望：一个 2xx/3xx/4xx 的 HTTP 状态码（401/404 也算"通"，因为 TCP 层通了）
curl -s -o /dev/null -w '%{http_code}\n' http://<IP>:5199/
```

> **判読提示**：`401` / `404` **皆為「通」之証拠** ——
> 説明 TCP 已連、HTTP 服務在応答。唯 `000`（連接失敗）者真不通也。

---

### T8 WebUI 密碼強度不足、不能設定

#### 症状

```
- 設定 WebUI 密碼時被拒
- 或者：設定了弱密碼、登録後強制要求改密碼
  （mustChangePassword 門禁：除白名单路徑外全部返却 403 + mustChangePassword:true）
```

#### 根因

**密碼規則**（`packages/core/src/webui/auth.ts` 之 `PASSWORD_RULES`、源碼原文）：

```js
var PASSWORD_RULES = [
  { id: "length",  label: "长度不少于 10 位",        test: (p) => p.length >= 10 },
  { id: "lower",   label: "包含小写字母",            test: (p) => /[a-z]/.test(p) },
  { id: "upper",   label: "包含大写字母",            test: (p) => /[A-Z]/.test(p) },
  { id: "special", label: "包含特殊符号 (!@#$%…)",   test: (p) => /[^A-Za-z0-9\s]/.test(p) },
  { id: "no-space",label: "不包含空格",              test: (p) => !/\s/.test(p) && p.length > 0 }
];
```

**五条全過方算強密碼**（`isStrongPassword` = `every()`）。

#### 解決

密碼必須**同時滿足**：

| 要求 | 説明 |
|---|---|
| **長度 ≥ 10** | 少於 10 位直接拒 |
| **含小写字母** | `a-z` |
| **含大写字母** | `A-Z` |
| **含特殊符号** | `!@#$%…`（任何非字母数字非空白字符） |
| **不含空格** | |

示範格式：`<Your-Password>`（≥10 位、含大小写+数字+特殊符号、無空格）。

#### 関連接口与機制

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

| 機制 | 説明 |
|---|---|
| **雑湊算法** | `crypto.scryptSync`、`N=16384` / `r=8` / `p=1` / `keylen=64` |
| **比対** | `timingSafeEqual`（防時序攻撃） |
| **強度評価** | `@zxcvbn-ts/core`（追加給出強度評分） |
| **2FA** | TOTP（RFC 4226/6238）、路徑 `/api/auth/totp/*` |
| **登録限速** | 同 IP 連續失敗会鎖定（返却 429 + 剩余秒数） |
| **首啓引導** | `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD`（**< 8 位会被忽略**） |

---

### T9 改設定然未生效

#### 症状

```
- 改了配置文件 → 无变化
- 不确定该改哪个目录下的文件
```

#### 根因一：所改者「設定文件」也、然運行時不熱載之

此者 T1 之同源問題也。**分類型処理**：

| 設定類型 | 改文件有効乎 | 正確做法 |
|---|---|---|
| `onebot_<uin>.json`（毎帳号） | ❌ **不熱載** | **経 WebUI API `POST /api/config/:uin`** |
| `runtime.json`（全局運行） | ⚠️ 一部字段為**布爾白名単**、可熱重載 | `hookAutoLoad` / `webuiTls.enabled` 在白名単内；其他需再起動 |
| `ui.json`（WebUI 外観） | ✅ 可経 API | `POST /api/ui` |
| `webui.json`（密碼） | ✅ 経 API | `POST /api/auth/change-password` |

#### 根因二：改錯目録（**chatluna 者 `/data/instance/`、非 `/app/`**）

**此者最易混之一點也** —— 容器里存在**二套完全不同之目録前綴**：

```
/app/               ← Haizakura（SnowLuma）自身之目録
  /app/runtime/       bundle + native 産物
  /app/data/config/   ★ Haizakura 之設定文件在此
  /app/data/logs/     記録
  /app/data/data/<uin>/  SQLite 資料庫
  /app/.config/       QQ 之設定（含登録態）
  /app/.local/share/  QQ 之資料

/data/instance/     ← ★ chatluna 関連（非 Haizakura！）
```

> **判拠**：汝欲改者為 **Haizakura 之行為** → 尋 `/app/`；
> 汝欲改者為 **chatluna（外部対接之 bot 框架）** → 尋 `/data/instance/`。
> **両者不通也。**

#### 根因三：容器非汝所想之物

```bash
# 确认你改的是正在运行的那个容器
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect <容器> --format '{{json .HostConfig.Binds}}'
```

> ⚠️ **特別注意**：可能存在**已停止之旧容器**（例 `snowluma` 即旧者也、
> 設定里為 `#sl`；当前有効者為 `snowluma-hz`、設定里為 `#hz`）。
> **改対了文件、然改在旧容器之巻里 = 白改也。**

#### 解決：先定位、再改

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

### T10 跨機伝文件被截断

#### 症状

```
- scp 传过去的文件大小不对（16 KB 的 tgz 变成 672 KB 或 0 字节）
- 或者：文件长度看起来正常，但内容是坏的
  （遇到过 262 字节 vs 262 字节，md5 不同）
```

#### 根因

```
① 伝送被中断（SSH 空閑断連、網絡抖動）
② 二進制文件経文本管道被改写（改行符転換、編碼破損）
③ ★ 文件長度相同 ≠ 内容相同
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

#### ★ 必須両端校験

```bash
# 本地
sha256sum local-file.tgz
# 远端
ssh <host> 'sha256sum /remote/path/file.tgz'

# 值必须【完全一致】
```

> **教訓**：
> - **文件長度相同亦可能内容不同** —— 勿以 `ls -l` 為校験
> - **必須用 sha256/md5**、勿只看大小
> - 長伝送用背景任務 + 輪詢記録（`setsid nohup ... &`）、SSH 空閑断連会殺前台任務

---

### T11 注入至 zygote、壊 QQ 之 IPC 与登録界面

#### 症状

```
- QQ 界面白屏 / 登录界面异常 / QQ 的进程间通信失灵
- 日志里出现 "auto-load skip: PID=%d is an Electron child process (--type=%s)"
- 或者：hook 好像生效了但 QQ 本身坏掉了
```

#### 根因

**Electron 子工程会被誤判為「主 QQ 工程」**、原因有二相重：

```
① 子工程（zygote / renderer / gpu / utility）之 cmdline 里亦含 "qq"
② 其等経 fork 之 copy-on-write 会【短暫継承 wrapper.node 映射】

→ .node 之工程列挙器誤認其等為「主 QQ」
```

**後果甚重**：

```
注入 zygote → 在 zygote 里起動 hook 之 resolver 線程
            → 之後 Electron fork 出之【毎個 renderer 皆会継承該線程
              + 半初期化之 hook 状態】
            → 【直接壊 QQ 之 IPC 与登録界面】
```

**源碼註釋原文**：

> *"Injecting into a zygote spawns the hook's resolver thread inside it;
> every renderer Electron later forks then inherits that thread + the
> partially-init'd hook state, which breaks QQ's IPC and login UI."*

#### 解決：濾過機制（已内蔵、既定開啓）

源碼 `shouldAutoLoadPid()` 之邏輯：

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

**判別方法甚簡而有效**：読 `/proc/<pid>/cmdline`、含 `--type=` 即跳過。
主 QQ 工程之 cmdline 者 `qq --no-sandbox --disable-gpu …`、**不含** `--type=`。

#### 三開關

| 開關 | 作用 | 危険 |
|---|---|---|
| `shouldAutoLoadPid()`（既定行為） | 自動跳過 `--type=` 之工程 | ✅ 安全、保持既定 |
| `SNOWLUMA_HOOK_AUTOLOAD_ALL=1` | **放行所有 PID**（脱出艙） | ⚠️ **会注入 zygote、壊 QQ** |
| `POST /api/processes/:pid/load` | **手動載入、繞過閘門** | ⚠️ 操作者自負其責 |

#### 検証

```bash
# ① 确认注的是主进程，不是子进程
docker exec <容器> sh -c 'ps -eo pid,args | grep -E "qq --" | grep -v -- --type='

# ② 确认跳过日志
docker exec <容器> sh -c 'grep -oE "auto-load skip: PID=[0-9]+ is an Electron child process[^\"]*" \
  /app/data/logs/$(date +%F).log | sort -u'

# ③ 确认 socket 的 pid 是主进程
docker exec <容器> sh -c 'ls /tmp/runtime-*/mojo.*.control.sock'
```

**旁証**：`.so` 里尚有另一層守衛 `isTransientLibcMappingError()`、
匹配 `"target process does not map /libc.so.6 while resolving mmap"` ——
説明**注入器要求目標工程已映射 libc**（即已完成動態鏈接）、
zygote 早期恰好不滿足。

---

### T12 自動更新必然失敗（404）

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

**非網絡問題、非鏡像問題 —— 倉庫真已無也。**

#### 解決

三法択一：

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
| `auto`（既定） | 先直連、再逐個鏡像回落（`mirrors` 最多 16 個） |
| `direct` | 只直連 |
| `mirror` | 只用自填鏡像 |

**既定鏡像表**（**全部指向 GitHub、故全部 404**）：

```
https://ghfast.top          https://ghproxy.net
https://gh-proxy.com        https://github.chenc.dev
https://fastgit.cc          https://gh.noki.icu
https://cors.isteed.cc      https://gh-proxy.org
https://githubproxy.gohj99.site   https://github.xxlab.tech
```

#### 検証

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  https://api.github.com/repos/SnowLuma/SnowLuma/releases/
# 期望：404（确认仓库已删）
```

> ⚠️ **接手必做項**：`update/sources.ts` 為**必須改**之文件之一。
> 関連 WebUI 路徑：`GET /api/update/check`、`GET/POST /sources`、`POST /sources/test`、`POST /download`。

---

### T13 記録占用磁盤益大

#### 症状

```
- 磁盘空间被日志吃掉
- 实测约 11 MB/天
```

#### 根因

```
既定：logMaxTotalMb = 1024（総量上限 1 GB）
      logRetainDays = 7（保留 7 天）
      logPerUin    = false（不按帳号分文件）

→ 稳态大約 80 MB 常駐（7 天 × 11 MB/天）
   —— 然若流量大、会更快接近 1 GB 上限
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

#### 検証

```bash
docker exec <容器> sh -c 'du -sh /app/data/logs/; ls -la /app/data/logs/'
```

#### 関連：WebUI 存儲清理

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/system/storage
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:5099/api/system/storage/cleanup
```

> **注意**：`messages.db` 会随消息累積（実測曾達 70.8 MB + 4 MB WAL）。
> 大流量場景須注意 `/app/data/data/<uin>/` 之総量。

---

### T14 WebUI 登録関連之其他坑

#### T14.1 登録被限速（429）

```
症状：返回 {"success":false,"message":"登录尝试过多，请 N 秒后重试"}
根因：同 IP 连续密码错误触发锁定（loginAttempts 按 IP 计数）
解决：等剩余秒数；或从另一个 IP 访问；或重启 runtime 清空计数
```

> **限速鍵**取决於 `trustProxy` 設定：既定按 **socket peer** 計。
> 経反代時若不配 `trustProxy`、所有使用者会被当作同一 IP。

#### T14.2 登録成功後仍需同意協議 / 改密碼

```
症状：除白名单路由外，所有 API 返回 403
      {"status":"failed","message":"请先阅读并同意用户协议与隐私政策","consentRequired":true}
      {"status":"failed","message":"请先修改密码","mustChangePassword":true}
根因：两个独立门禁
解决：consentGatePending → POST /api/agreements/record-consent
      mustChangePassword → POST /api/auth/change-password
批量部署：SNOWLUMA_ACCEPT_EULA=1 SNOWLUMA_ACCEPT_PRIVACY=1
```

> `EULA.md` / `PRIVACY.md` 缺失時会警告：
> `[WebUI.Consent] agreement file not found (looked for EULA.md near the bundle and repo root)`

#### T14.3 経反代後不能得真実客端 IP

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

### T15 逆向 / 除錯脚本壊自身之機

**此者非運行時之坑、乃維護時之坑也** —— 然代価甚大、値得単列。

#### 症状

```
- 跑分析脚本时负载飙到 37
- 内存被吃到 2.7 GB
- 终端被吐 10 MB 文本
- 脚本 struct.error 崩掉
```

#### 根因（已知陷阱表）

| # | 陷阱 | 後果 | 正確做法 |
|---|---|---|---|
| **T1** | 以「已定義輸出」之子集為「全部符号」 | **得出「dynsym 里無 RTTI」之錯誤結論**（実際有 397 個） | 永遠回至 `readelf -sW --dyn-syms` 原文 |
| **T2** | 按字面量 `"MSFService"` 搜 typeinfo | **0 命中**（`__type_name` 者 mangled `N2nt10MSFServiceE`） | 匹配 `N<len><ns><len><Class>E` 模式；排除記録 TAG / JS 属性名 |
| **T3** | 将 `.data.rel.ro` 之 vaddr 当作 file off | 全表偏移錯 `0x10000` | 自節表算 `Δ = vaddr − file_off`、**勿写死** |
| **T4** | 対 `mmap` 切片行 `b[:z]` 而 `z == -1`（無 NUL） | **一次吐 10 MB 輸出** | 任何派生文字列前断言 `z > 0` |
| **T5** | `.eh_frame_hdr` 編碼字節解析錯（将 pcrel 当作無符号） | 得 `fde_count=1.8e19` → **越界 / 無限循環 → OOM（2.7 GB）** | 按 `enc & 0x0f` / `enc & 0x70` 分別処理；**所有循環加上限** |
| **T6** | 取「第一個値 == typeinfo 之槽位」為 primary vtable | MSFService 有 **5 個**地址点、会選錯 | 必須按 **`offset_to_top == 0`** 濾出 primary |
| **T7** | 只看「工程未崩」即認為適配成功 | 槽位錯一位 → 静黙発錯路 → 使用者見 `"The QQ connection changed…"` | 必須作**真実収発消息**之端到端検証 |

#### 附帯坑（工具使用層面）

| 坑 | 後果 | 正確做法 |
|---|---|---|
| bundle 里有 NUL 字節 | `grep -oE` 会截断行（只得 147 個 region） | 用 `grep -a`；提取 region 用 **Python 正規表現**（得 467 個） |
| `strings` 将 ARM64 機械码誤当文字列 | 4,519 行里 ~3,600 行為噪声 | 真文字列集中於**第 1–176 行**与**第 3799–4050 行** |
| bundle 内嵌 330 KB 之 zxcvbn 密碼辞書（単行） | `grep -C` 会将全辞書打印至終端 | 用 `grep -an` 只要行号；或先 `sed -n 'A,Bp'` 定位 |
| `grep -c <関鍵詞>` 在 bundle 上会詐汝 | `backoff`/`jitter`/`circuit` 之「命中」全為該一行辞書 | **看行号分布、勿看計数**。若計数 1~3 且皆指同一行 → 偽陽性 |
| 長任務前台跑 | SSH 空閑 ~10 分断連、任務随之死 | `setsid nohup … &` + 輪詢 `tail -c 800 log \| tr '\r' '\n' \| tail` |

#### 鉄律

> **跑逆向脚本時必須加計数上限。**
> 一次循環辺界写錯即能把負載推至 37、記憶体吃至 2.7 GB。
> 所有 `struct.unpack_from` 帯明示 `cnt` 上限、`i < cnt` 前置検査、
> **永不 stdout 大対象**（全写文件）。

---

## 4. 附録 A：完全 `SNOWLUMA_*` 環境変数表（36 個）

| 変数 | 用途 |
|---|---|
| `SNOWLUMA_HOOK_AUTOLOAD_ALL` | `=1` 放行所有 PID 自動注入、**繞過 zygote 濾過**（危険） |
| `SNOWLUMA_HOOK_AUTOLOAD` | 覆蓋 `runtime.json` 之 `hookAutoLoad` |
| `SNOWLUMA_HOOK_RUNTIME_DIR` | 指定 `mojo.*.sock` 所在目録 |
| `SNOWLUMA_HOOK_ACK_TIMEOUT_MS` | 制御通道 ACK 超時（既定 5000） |
| `SNOWLUMA_PACKET_TIMEOUT_MS` | 業務包超時 |
| `SNOWLUMA_SESSION_RELEASE_DEADLINE_MS` | 会話解放截止時間 |
| `SNOWLUMA_STREAM_DIR` | 流式下載落地目録（非法時 warn 並忽略） |
| `SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES` | 二進制下載大小上限 |
| `SNOWLUMA_HTTP_DOWNLOAD_TIMEOUT_MS` | HTTP 下載超時 |
| `SNOWLUMA_DOWNLOAD_FILE_TIMEOUT_MS` | `download_file` 動作超時（⚠️ 与上一不同） |
| `SNOWLUMA_NOTIFICATION_HTTP_TIMEOUT_MS` | 通知 webhook 超時 |
| `SNOWLUMA_UPDATE_ROOT` | 更新根目録（開発 / 測試更新流程） |
| `SNOWLUMA_UPDATE_CHECK` | 是否検査更新（**上游刪庫後建議設 0**） |
| `SNOWLUMA_WEBUI_PORT` | WebUI 端口（既定 5099） |
| `SNOWLUMA_WEBUI_HOST` | WebUI 綁定地址 |
| `SNOWLUMA_WEBUI_TARGET` | UI 主題預置、**唯一合法値 `maibot`** |
| `SNOWLUMA_WEBUI_TLS` | 覆蓋 `webuiTls.enabled` |
| `SNOWLUMA_WEBUI_TRUST_PROXY` | 覆蓋 `trustProxy` |
| `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD` | 首啓注入 WebUI 密碼（**< 8 位被忽略**） |
| `SNOWLUMA_ONEBOT_HTTP_PORT` | OneBot HTTP 端口 |
| `SNOWLUMA_ONEBOT_WS_PORT` | OneBot WS 端口 |
| `SNOWLUMA_ONEBOT_HOST` | OneBot 綁定地址（生産実例為 `0.0.0.0`） |
| `SNOWLUMA_LOG_DIR` | 記録目録（既定 `/app/data/logs`） |
| `SNOWLUMA_LOG_FILE` | `=0` 關閉文件記録 |
| `SNOWLUMA_LOG_LEVEL` | 控制台級別、既定 `info` |
| `SNOWLUMA_LOG_FILE_LEVEL` | 文件級別、唯 `debug/info/success/warn/error` |
| `SNOWLUMA_LOG_MAX_MB` | 単文件上限 |
| `SNOWLUMA_LOG_MAX_TOTAL_MB` | 記録総量上限（既定 1024） |
| `SNOWLUMA_LOG_RETAIN_DAYS` | 記録保留天数（既定 7） |
| `SNOWLUMA_LOG_PER_UIN` | 按 uin 分文件 |
| `SNOWLUMA_TRACE_BUFFER` | 追跡緩衝条数 |
| `SNOWLUMA_VERBOSE_WARMUP` | `=1` 打印預熱細節 |
| `SNOWLUMA_DEV_MODE` | 開発模式（会用 `snowluma-dev` 固定密碼） |
| `SNOWLUMA_DEV_WEBUI` | 開発模式 WebUI |
| `SNOWLUMA_DEV_NO_NATIVE` | `=1` 用 stub 替代 native addon |
| `SNOWLUMA_ACCEPT_EULA` | 非対話接受 EULA |
| `SNOWLUMA_ACCEPT_PRIVACY` | 非対話接受隱私政策 |
| `SNOWLUMA_HOME` / `SNOWLUMA_DATA` | 運行目録 / 資料目録（生産：`/app/runtime` / `/app/data`） |
| `SNOWLUMA_UID` / `SNOWLUMA_GID` | 容器内運行身份（生産：1000/1000） |
| `SNOWLUMA_SCREEN` | Xvfb 畫面尺寸（生産：`1920x1080x24`） |
| `SNOWLUMA_QQ_FLAGS` | 伝至 QQ 之起動参數 |
| `SNOWLUMA_EXTRA_QQ_HOMES` | 追加之 QQ HOME 目録 |
| `QQ_RECV_HEARTBEAT_CMD` | **【未査清】** 疑似 QQ 収包心跳命令名 |

> ⚠️ **`SNOWLUMA_HOOK_RUNTIME_DIR` 之跨工程路徑依 `/proc/<pid>/environ` 可読** ——
> 同 uid 時可行、**跨 uid 会失敗**。【未査清】

---

## 5. 附録 B：`runtime.json` 完全字段

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

> **可熱重載之字段**：`hookAutoLoad` / `webuiTls.enabled` 者**布爾白名単**也。
> 其他字段改文件後**需再起動**。

---

## 6. 附録 C：一句排查口訣

```
① 先体検:      容器活着 → unresolved=0 → socket 在 → 端口通 → 指紋対
② 看記録:      grep -c unresolved     （0 = 健康）
③ 勿再起動:    再起動 QQ = 失登録態 = 再掃碼
④ 改設定:      経 WebUI API、勿改文件（不熱載）
⑤ 端口不通:    用 curl、勿用 /dev/tcp
⑥ 指紋已変:    QQ 已昇級 → 跑 dump-vtable.py --diff
⑦ 適配完成:    必須真実収発一条消息、勿只看「工程未崩」
```

---

## 7. 関連文書

| 欲知 | 去看 |
|---|---|
| 其究竟如何動作 | [architecture.md](architecture.md) |
| 支援何版本 / 依存何物 | [compatibility.md](compatibility.md) |
| 如何自源碼構築 | [build.md](../dev/build.md) |
| 如何参与開発 | [contributing.md](../dev/contributing.md) |

---

*本文所有命令与報錯皆出自実測。証拠等級保留原標注：
【確証】有直接証拠 /【強推断】多証拠交叉 /【推断】合理未験証 /【未査清】明確之知識空白。*
