# 常見問題（FAQ）

> [!WARNING]
> 本内容完全 AI 編写、慎重閲覧求也。

> 本文二類内容包含：**通用問題**（LLBot 之 FAQ 場面対標）
> 与 **我等我等真実踏過之坑**（此部分者通用 FAQ 之上価値有）。

---

## 1. 通用問題

### 1.1 何故本機訪問仅可能、局域網 / 公網接続不可乎

**安全考慮故、応用既定 `127.0.0.1` 仅聴取也。**

【確証】源碼既定値：

| 設定 | 既定値 | 位置 |
| --- | --- | --- |
| `webuiHost` | `127.0.0.1` | `common/src/runtime.ts:194` |
| `httpServers[].host` | `127.0.0.1` | `onebot/src/config.ts:42` |
| `wsServers[].host` | `127.0.0.1` | `onebot/src/config.ts:54` |

**但容器場面異也**：Docker 容器自有網命名空間、
`127.0.0.1` 仅聴取場合、**映射出之宿主機端口永遠接続不可**。

故容器 entrypoint 一回播種行（`/root/start.sh`）：

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

**修復步驟**：

| 目標 | 如何為 |
| --- | --- |
| 局域網 / 公網自 WebUI 訪問 | WebUI 中聴取地址 `0.0.0.0` 変更、或直接 `runtime.json` 之 `webuiHost` 変更 |
| 局域網 / 公網自 OneBot 呼出 | 適配器之 `host` `0.0.0.0` 変更為 |
| 本機訪問仅希望 | `127.0.0.1` 保持、SSH 隧道使用 |

> ⚠️ **公網暴露前必二事行必要**：
> ① OneBot 適配器**必強令牌設定**（源碼強制 ≥16 文字且弱値不可）
> ② WebUI **反向代理 + `trustProxy` 設定**推奨。
> 何故者 `/api/debug/invoke` 者**任意動作之遠隔実行相当**也。

**SSH 隧道方案（最安全）**：

```bash
ssh -L 5199:127.0.0.1:5199 -L 3010:127.0.0.1:3010 用户@服务器
# 然后本地访问 http://127.0.0.1:5199
```

---

### 1.2 WebUI 密碼忘却時如何為

WebUI 憑据者 `config/webui.json` 中（【確証】`core/src/webui/auth.ts`）：

```json
{
  "passwordHash": "<128 位十六进制 scrypt 哈希>",
  "passwordSalt": "<32 位十六进制盐>",
  "mustChangePassword": false,
  "generatedAt": "...",
  "updatedAt": "..."
}
```

用者 **`scryptSync`**（`N=16384, r=8, p=1`、keylen 64）—— **哈希不可逆**也。

**三之法**：

| 法 | 步驟 | 危険 |
| --- | --- | --- |
| **① 憑据文件削除、系統再建委** | 容器停止 → `config/webui.json` 削除 → 起動 → 引導流程依新密碼設定 | ⚠️ **再起動必要 → QQ 登録態喪失** |
| **② 初回起動時環境変数注入** | `-e SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD='<强密码>'` 使用（**8 文字以上要求**） | 初回限定有効 |
| **③ 哈希直接変更** | 同参數依 scrypt 哈希算出、`passwordHash` 置換 | `N=16384, r=8, p=1, keylen=64` 保持必要 |

**密碼強度要求**（【確証】`PASSWORD_RULES`、五条全満足者強判定）：

| 規則 | 要求 |
| --- | --- |
| `length` | **10 位以上** |
| `lower` | 小写英字含 |
| `upper` | 大写英字含 |
| `special` | 特殊符号含（`!@#$%…`） |
| `no-space` | 空白不含 |

> 💡 注意 `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD` 者 **≥8 文字**仅要求、
> 而 WebUI 強度検査者 **≥10 位 + 四類文字**要求。両者標準異也。

> ⚠️ 別二機制関連有：**TOTP 二段階検証**（`/api/auth/totp/*`、RFC 4226/6238）
> 与**恢復碼**（`/api/auth/totp/recovery-codes`）。
> TOTP 開且失場合、同様憑据文件削除必要。
>
> ⚠️ 若 `SNOWLUMA_DEV_MODE=1` 設定済場合、密碼変更直接報錯
> 「開発模式 (SNOWLUMA_DEV_MODE=1) 已無効密碼変更」。

---

### 1.3 図像 / 音声 / 動画送信不可乎

順次排查：

| 検査 | 説明 |
| --- | --- |
| ① 文件権限 | 容器内 `snowluma` 帳号（uid 既定 1000）者 `/app/data` **書込権限必要** |
| ② `SNOWLUMA_STREAM_DIR` | 流式接口之落地目録（既定 `$TMPDIR/onebot-stream`）；非法値者警告且回退 |
| ③ 下載大小上限 | `SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES` |
| ④ 下載超時 | `SNOWLUMA_HTTP_DOWNLOAD_TIMEOUT_MS`（既定 60000 ms） |
| ⑤ **動画上伝並行** | `snowluma.json` 之 `videoUploadConcurrency`（1–4、既定 1） |
| ⑥ 磁盤空間 | `docker exec haizakura df -h /app/data` |
| ⑦ 状態指令検証 | 先状態指令送、链路通確認 |

> 💡 **Haizakura 者 FFmpeg 別途安装無需**（LLBot 与異也）——
> `native/ffmpeg/ffmpegAddon.linux.arm64.node` 自帯也。

**権限修復**：

```bash
docker exec haizakura ls -la /app/data
docker exec haizakura chown -R 1000:1000 /app/data
```

---

### 1.4 CQ 碼使用、配列格式非時如何為

**`messageFormat` `"string"` 変更為**（【確証】`config.ts:747-749`、`"array"` 或 `"string"` 仅受）：

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

| 値 | 格式 |
| --- | --- |
| `"array"`（既定） | `[{"type":"text","data":{"text":"hi"}}]` |
| `"string"` | `"hi[Cat:face,id=1]"` |

> 頂層亦 `messageFormat` 記可能、**全適配器之既定値**為（旧配置互換）。

---

### 1.5 Docker 中宿主機如何訪問

**`127.0.0.1` 使用不可** —— 彼者容器自身指也。

| 平台 | 宿主機地址 |
| --- | --- |
| Linux | `172.17.0.1`（既定 bridge 網関）或 `--add-host=host.docker.internal:host-gateway` |
| Docker Desktop（Mac/Win） | `host.docker.internal` |

**推奨**（跨平台）：

```bash
docker run ... --add-host=host.docker.internal:host-gateway ...
```

然後設定中 `http://host.docker.internal:8080` 使用。

> ⚠️ **Mac 利用者注意**：社区経験者 **Docker Desktop 而非 OrbStack 使用**、
> 否者 QQ 起動不可可能性有。此 LLBot 社区踏之坑也、Haizakura 同属 Electron QQ、**大概率同様適用**。

---

### 1.6 登録之前設定済如何為

**容器 entrypoint 既播種行済**（【確証】`/root/start.sh`）：

初回起動（`onebot.json` 不存在）時、自動生成：

```json
{
  "networks": {
    "httpServers": [{ "name": "http-default", "host": "<SNOWLUMA_ONEBOT_HOST>", "port": 3000, "path": "/", "accessToken": "<随机32字节>", "messageFormat": "array", "reportSelfMessage": false }],
    "wsServers":   [{ "name": "ws-default",   "host": "<SNOWLUMA_ONEBOT_HOST>", "port": 3001, "path": "/", "role": "Universal", "accessToken": "<随机32字节>", "messageFormat": "array", "reportSelfMessage": false }],
    "httpClients": [], "wsClients": []
  }
}
```

**重要設計**：**汝適配器削除時仅再建無** ——
`httpServers` **存在之空配列**場合、entrypoint 者之**戻無**也。

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

**故予設定希望場合**：容器起動**前 `onebot.json` 巻中入**、
或 `docker cp` 依入、然後起動。

> 💡 **LLBot 時代之概念一修正**：Haizakura 者 **`default_config.json` 継承機制無**也。
> 其等価物者**「全局 `onebot.json` + 毎帳号 `onebot_<uin>.json` 之 overlay 合併」**
> （[設定説明 §0.2](configuration.md) 参照）。
> `onebot_<uin>.json` 中 `"mode": "snapshot"` 記場合仅全局無視也。

---

### 1.7 記録文件漸大 / 記録突然不書

### 記録滾動機制

【確証】`log-file-transport.ts`：

| 参數 | 既定 | 環境変数 |
| --- | ---: | --- |
| 単文件上限 | **50 MB** | `SNOWLUMA_LOG_MAX_MB` |
| 総量上限 | **1024 MB** | `SNOWLUMA_LOG_MAX_TOTAL_MB`（`runtime.json` 之 `logMaxTotalMb` 亦用可） |
| 保持日数 | **7 日** | `SNOWLUMA_LOG_RETAIN_DAYS`（`logRetainDays`） |
| 帳号別文件 | `false` | `SNOWLUMA_LOG_PER_UIN`（`logPerUin`） |

文件命名：

```
snowluma-YYYY-MM-DD.log          当天
snowluma-YYYY-MM-DD.N.log        滚动分片
snowluma-<uin>/...               按账号模式（目录名为纯数字）
```

### ⚠️ 坑：配額超過後記録「静黙破棄」也

此**「程序卡死」誤判断易坑**也。

【確証】`LogQuota.reserve()`（`log-file-transport.ts:198-221`）：

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

**挙動**：

| 状態 | 表現 |
| --- | --- |
| 健康 | 正常書 |
| **配額超過 / 保存異常** | `degraded` 状態入 → **記録行静黙破棄**、`droppedLines` 計数仅累加 |
| 再試 | 毎 **5000 ms**（`QUOTA_RETRY_MS`）一回再試 |

**症状**：記録文件不再増、但程序実際尚走也。
**誤判断危険**：汝「工程落」思、実際**記録書込不可**仅也。

**如何検査**（【実測】`GET /api/system/storage` 之返却結構）：

```bash
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:5199/api/system/storage
```

返却：

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

> 🔍 **二字段見即可**：`snapshot.logs.state` 与 `snapshot.logs.droppedLines`。
> `droppedLines > 0` 或 `state != "healthy"` 者、**記録破棄中**示也。

**修復**：

| 手段 | 命令 / 位置 |
| --- | --- |
| WebUI 清理 | `POST /api/system/storage/cleanup` |
| 保持短縮 | `logRetainDays` / `SNOWLUMA_LOG_RETAIN_DAYS` |
| 総量拡大 | `logMaxTotalMb` / `SNOWLUMA_LOG_MAX_TOTAL_MB` |
| 文件記録無効 | `SNOWLUMA_LOG_FILE=0` |
| 文件級別降 | `SNOWLUMA_LOG_FILE_LEVEL=warn` |

> ⚠️ **手動記録文件削除後尚 `degraded` 可能性有**：
> 源碼中此警告有 ——
> `managed logs still use N bytes after manual cleanup, exceeding the M byte limit`。
> 是**再統計後尚超限**示（管理外之文件空間占有可能性有）。

---

### 1.8 容器 `ExitCode 126` / `Operation not permitted`

**此配置段階最常見之失敗也。**

**症状**：

```
ExitCode = 126
日志: /root/start.sh: line 161: /usr/local/bin/node: Operation not permitted
```

**原因**：注入器 `ptrace` + `process_vm_writev` 依 QQ 工程附加必要、但：

| 欠物 | 後果 |
| --- | --- |
| `--cap-add SYS_PTRACE` | **hook 装不可** |
| `--security-opt seccomp=unconfined` | **容器起不可**（既定 seccomp `ptrace` 遮断） |

**修復**：

```bash
docker run ... \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  ...
```

**【実測】** 此二項補後**一回起動成功**也。

> 📌 `--privileged` 亦 work 可能、但権限過大、**推奨不可**。

---

### 1.9 hook 装不可 / 記録中 `unresolved` 有

**hook 健康度検査**：

```bash
docker exec haizakura grep -c unresolved /app/data/logs/*.log
```

| 結果 | 意味 |
| --- | --- |
| **`0`** | ✅ **hook 健康** |
| `>0` | ❌ RTTI 鏈解析失敗 |

**`unresolved` 之意味**：`.so` 中「唯一検証閘門」不通 ——
**RTTI 結構匹配**（文字列匹配非）依 `nt::MSFService` /
`nt::MSFCoreService` 探索、失敗也。

**常見原因**：

| 原因 | 説明 | 如何為 |
| --- | --- | --- |
| **QQ 版本変化** | `wrapper.node` 之 RTTI / vtable 配置変化 | `dump-vtable.py` 依基線 diff、[開発参加](../dev/contributing.md) 参照 |
| `SYS_PTRACE` 欠 | 注入根本未成功 | §1.8 参照 |
| zygote 注入済 | §1.10 参照 | `SNOWLUMA_HOOK_AUTOLOAD_ALL` 検査 |
| 内核 `ptrace` 禁 | 加固内核（Yama 制限帯等） | `kernel.yama.ptrace_scope` 検査 |

**QQ 版本与基線一致確認**：

```bash
docker exec haizakura md5sum /app/runtime/../.config/... # 定位 wrapper.node
# 期望 md5: adeb40af26d859d41fcdb21bf38d9eb5
```

---

### 1.10 ⚠️ `SNOWLUMA_HOOK_AUTOLOAD_ALL` 随意開不可

**此文档中最警告必要之一項也。**

正常流程者**Electron 之 zygote 与子工程濾過**、主 QQ 工程仅注入也。
`SNOWLUMA_HOOK_AUTOLOAD_ALL=1` 者**此濾過迂回**也。

**【確証】後果**：

> zygote 中注入者**zygote 中 hook 之 resolver 線程起動**；
> 之後 Electron fork 出之**毎 renderer 皆該線程 + 半初期化 hook 状態継承**、
> 直接**QQ 之 IPC 与登録画面壊**也。

**症状**：QQ 画面異常、登録不可、各種玄学問題。

**如何場合仅使用**：**「何故主工程未注入」排查時一時開**、
用完直閉且再起動。

---

## 2. ⭐ 我等我等真実踏過之坑

> 此等者**代価換来之経験**也、通用 FAQ 之上価値有。全読一遍推奨。

### 坑 1：🔴 容器再起者 QQ 登録態喪失（最痛）

**此本項目最大之運維陷阱也。**

| 項目 | 説明 |
| --- | --- |
| **現象** | 容器再起後 QQ **再扫码登録**必要 |
| **原因** | `/app/.config/QQ/auth/login.enc` 之 `loginList` 清空為 |
| **代価** | **我等我等故生産 bot 八時間停摆招** |
| **何故痛** | 扫码者**人工介入**必要（noVNC 開、手機依扫） |

**故障鏈**：

```
重启容器 → 登录态丢失 → Haizakura 拿不到 MSF 会话
        → 所有动作返回 "not logged in" → ⛔ bot 完全不可用
```

**結論**：

| 原則 | 做法 |
| --- | --- |
| **非必要不重起** | 設定変更**WebUI / API 熱載優先** |
| 必重起時 | **扫码可能者之時間窓安排** |
| 重起前 | 手元手機 QQ 有確認 |
| 現実受入 | 「重起者再扫码必要」**既定之事実**為前提対策設計 |

**何之操作者熱載也（登録態不失）**：

| 改動 | 熱載 |
| --- | --- |
| OneBot 網設定 | ✅ |
| `statusCommand` | ✅ |
| `notifications` | ✅ |
| 記録級別 | ✅ |
| hook 載入 / 卸載 | ✅ |
| **`historySync.enabled`** | ❌ 起動時仅読 |
| **環境変数 / 代碼** | ❌ 容器再建必要 |

詳細 [設定説明 §11](configuration.md) 参照。

---

### 坑 2：noVNC HSTS 依 https 強制昇級

| 項目 | 説明 |
| --- | --- |
| **現象** | `http://<IP>:6181` 開不可、瀏覧器自動 https 跳 |
| **原因** | 瀏覧器 **HSTS** 策略該地址 https 強制昇級、而 noVNC 者純 http 也 |
| **修復** | ① **純 IP** 使用（域名不可）② 瀏覧器変更 ③ 該 IP 之 HSTS 記録清除 |

**Chrome HSTS 清除**：`chrome://net-internals/#hsts` → Delete domain security policies。

---

### 坑 3：`#hz` 等設定変更「不生效」

**二層面之原因有、皆検査必要。**

**原因 A：設定優先度 / `mode` 問題**

【確証】`onebot_<uin>.json` 若 `"mode": "snapshot"` 記場合、
**全局 `onebot.json` 之対完全無効**也。

```
onebot.json（全局）
      ↓ 仅在非 snapshot 时叠加
onebot_<uin>.json（每账号）
```

| 汝変更可能性有之物 | 但実際有効之物 |
| --- | --- |
| 全局 `onebot.json` 之 `statusCommand` | ⚠️ **per-uin 之値依覆上**（下見）—— 「全局非対応」非也、**優先度敗**也 |
| `onebot.json` 之某適配器 | per-uin 中**同名適配器**者之整体覆上 |

> 📌 **何故全局之 `statusCommand` 変更通常無用乎**（【確証】二事実重畳）：
>
> **事実 1**：`parseStatusCommand(sources)` 者**全来源遍歴**、後者前者覆上。
> 非 snapshot 時 `sources = [全局, per-uin]` → **per-uin 勝**。
>
> **事実 2**：`toJsonObject()`（`config.ts:498-517`）per-uin 保存時**常**写入
> `statusCommand` / `historySync` / `notifications` 三節 ——
> **汝明示設定無場合也、既定値写入**。
>
> **両者重畳之結論**：per-uin 文件中**永遠有** `statusCommand`、
> 故**其永遠勝**。汝全局中 `trigger` 変更、per-uin 之既定値（或旧値）依覆也。
>
> **【実測】** 観察之 `onebot.json`（全局）確実 `networks` 一節仅有 ——
> 何故者容器 entrypoint 播種生成之物也、而播種邏輯 `networks` 仅書也。
>
> ✅ **故：状態指令 / 歴史回填 / 通知渠道者一律 `onebot_<uin>.json` 中変更求也。**
> （或云：**WebUI / `POST /api/config/:uin` 依変更**、全局文件手改不可。）

**原因 B：熱載無**

| 設定 | 熱載可否 |
| --- | --- |
| `statusCommand` | ✅ 改完即生效（WebUI / API 経由） |
| `historySync.enabled` | ❌ 起動時仅読 |

**改完不生效之自查**：

```bash
# 1. 确认你改的是哪个文件
docker exec haizakura cat /app/data/config/onebot_<uin>.json | grep -A5 statusCommand

# 2. 确认 mode 是什么
docker exec haizakura grep '"mode"' /app/data/config/onebot_<uin>.json

# 3. 走 API 改（推荐），而不是手动改文件
```

> ⚠️ **`POST /api/config/:uin` 者「完全設定」提出要求也、局部補丁非也。**
>
> 【確証】`server.ts:1293-1297` body 取得後**直接** `assertValidOneBotConfig(body)` 走、
> 然後整体保存。故：
>
> | 做法 | 結果 |
> | --- | --- |
> | `{"statusCommand":{...}}` 仅送 | ❌ **検証失敗**（`networks` / `historySync` 欠） |
> | 先 `GET` 全量取得 → 字段変更 → `POST` 戻 | ✅ **正確之做法** |
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
> **応答者真実熱載済可否告**（【確証】返却結構）：
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
> | `message` | 意味 |
> | --- | --- |
> | 配置保存成功，已热重载当前会话。 | ✅ 即時生效 |
> | 配置保存成功，当前会话未在线，将在下次连接时生效。 | ⚠️ 帳号未在線 |
> | 配置已保存，但部分网络节点未能应用… | ⚠️ 部分失敗、`errors` 見 |
>
> 💡 **`GET /api/config/:uin` 取得者「合併後」之結果也**（【確証】`loadOneBotConfig`
> 全局 + per-uin 合併後返却、**且 `mode` 字段不含**）。
>
> ⚠️ **故「GET → 改 → POST」者文件 `snapshot` 模式固化也。**
>
> 【確証】`saveOneBotConfig` 之既定 mode 者 `"snapshot"`：
>
> ```javascript
> saveJson(..., toJsonObject(config, options.mode ?? "snapshot"));
> ```
>
> 後果：**該帳号従此全局 `onebot.json` 継承無**。
>
> | 汝之希望 | 正確做法 |
> | --- | --- |
> | 該帳号仅生效、全局継承無 | ✅ GET → 改 → POST（現在挙動正好） |
> | **継続全局継承** | ⚠️ POST 前**手動**体加 `"mode": "overlay"` |
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

> 💡 **別、触発語之匹配語義注意**：**精確相等、単一 text 段仅**。
> `#hz` + 図像 = 二段 = **不触発**。[設定説明 §2.1](configuration.md) 参照。

---

### 坑 4：容器 `ExitCode 126`

§1.8 参照。核心者 `SYS_PTRACE` + `seccomp=unconfined` 二項欠一不可也。

---

### 坑 5：`/dev/tcp` 依端口測試「偽陰性」得

**此坑汝之排查方向誤導也。**

**現象**：明明端口通、但 `sh -c 'echo > /dev/tcp/...'` 測試失敗。

**【実測】** 容器内対比：

```bash
$ docker exec haizakura sh -c '(echo > /dev/tcp/127.0.0.1/5099) && echo ok'
sh: 1: cannot create /dev/tcp/127.0.0.1/5099: Directory nonexistent   ← ❌ 假阴性
sh: FAILED

$ docker exec haizakura curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5099/
200                                                                   ← ✅ 真的通
```

**原因**：`/dev/tcp` 者 **bash 之特性**也、**POSIX 非也**。
容器中 `docker exec ... sh` 既定 **dash** 使用、`/dev/tcp` 非対応。

（容器中 `bash` 存在：`/usr/bin/bash`）

**正確做法**：

| 方式 | 命令 |
| --- | --- |
| **推奨** | `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5099/` |
| bash 使用 | `docker exec haizakura bash -c 'echo > /dev/tcp/127.0.0.1/5099'` |
| 聴取見 | `docker exec haizakura ss -lntp` |

> 💡 **通用教訓**：網問題排查時、**`/dev/tcp` 而非 curl 使用**、HTTP 服務測試 ——
> 前者尚状態碼見可能、信息量更大也。

---

### 坑 6：跨機文件伝送截断

**現象**：`scp` / `docker cp` 大文件（例 12 MB 之 `index.mjs`）伝送後、
文件大小不対或内容破損。

**教訓**：**跨機文件伝送後必哈希検証。**

```bash
# 传之前
sha256sum index.mjs

# 传之后
sha256sum index.mjs   # 必须一致

# 或直接对比大小 + md5
md5sum index.mjs
```

**【実測】現在運行版本之値**（照合可用）：

```
index.mjs   12,338,442 字节
md5         bebdc7586f6e6586be80a85cc744ae5c
```

> 📌 **注意二異基線、混不可**：
>
> | 版本 | 字節数 | MD5 |
> | --- | ---: | --- |
> | **還原報告記録之原始 bundle** | 12,338,350 | `19bdfef05f6bebfb3986caf81dba37c3` |
> | **現在運行中（改名後）** | **12,338,442** | **`bebdc7586f6e6586be80a85cc744ae5c`** |
>
> 両者差異者品牌改名（`#sl` → `#Haizakura` 等）与後続修正由来也。
> **照合時汝実際配置之物基準求** —— 容器内、`dist/`、
> 及掛載之 `index.mjs` 三者一致必然也。

> 💡 **何故此坑重要乎**：若壊 `index.mjs` 容器中入場合、
> 症状**千奇百怪**也（起動失敗 / 某機能異常）、
> 而汝「文件伝輸出錯」疑不至也。
> **伝完即検証、数時間節約可能也。**

---

### 坑 7：逆向脚本計数上限無者機器打爆

**適用範囲**：汝 RTTI 解析 / 逆向脚本走場合。

**教訓**：**逆向脚本実行時必計数上限加。**

| 陷阱 | 後果 |
| --- | --- |
| Python 切片 `b[:z]` 且 `z == -1` 時 | 10 MB 資料吐出 |
| `.eh_frame_hdr` 之 `pcrel` 符号無依解码 | `fde_count` 1.8e19 化 → 越界 |
| `for i in range(cnt)` 中 `cnt` 誤解 | **無限 append → 2.7 GB 記憶** |

**【実測】** 当時 2 核、真実業務走之機上、
一回循環边界誤写者**負載 37 押上**也。

**別一陷阱**：「定義済導出」子集全符号扱場合、
「dynsym 中 RTTI 無」之**錯誤結論**得（実際 397 個有）。

---

### 坑 8：`/proc/<pid>/maps` 中 `(deleted)` 正常也

**此異常思不可。**

```
# 注入负载映射（注意 (deleted)）
$ docker exec haizakura cat /proc/<qq_pid>/maps | grep -i orcexec
... /tmp/runtime-1000/orcexec.abc123 (deleted)
```

**原因**：注入器 `.so` 映射完後**主動 `unlink` 臨時文件** ——
此**反本地発見之設計**也、磁盤上該文件査不可者**預期挙動**也。

**同理、以下皆正常也**：

| 現象 | 説明 |
| --- | --- |
| `(deleted)` 接尾 | 注入後主動 unlink |
| socket 名 `mojo.<pid>.*.sock` | **刻意 Chromium 之 mojo IPC 偽装** |
| `/tmp/runtime-<uid>/orcexec.<6位随机>` | 随機名、注入後消失 |
| 線程名 `snowluma-pipe-w` | 注入之管道書線程 |

```bash
# 确认注入确实活着（这几个都应该有输出）
docker exec haizakura cat /proc/<qq_pid>/task/*/comm | grep snowluma
docker exec haizakura ss -xpn | grep mojo
```

---

## 3. 故障速査表

| 症状 | 最可能之原因 | 何処見 |
| --- | --- | --- |
| 容器 `ExitCode 126` | `SYS_PTRACE` / seccomp 欠 | §1.8 |
| 容器起但動作全失敗 | QQ 未登録 / 登録態失 | [登録説明](login.md) |
| **重起後再扫码必要** | **登録態喪失（既知）** | §2 坑 1 |
| 記録中 `unresolved` 有 | QQ 版本変化 / 注入失敗 | §1.9 |
| 記録不再増 | **配額超過静黙破棄** | §1.7 |
| noVNC 開不可 | HSTS https 強制 | §2 坑 2 |
| noVNC 黒屏 | Xvfb 未就緒 | 数秒待 / 記録見 |
| 状態指令不応 | 単段純文本非 / trigger 不対 | [設定 §2.1](configuration.md) |
| 状態指令変更不生效 | 文件誤改（全局 vs per-uin） | §2 坑 3 |
| 端口測試不通 | `/dev/tcp` 偽陰性 | §2 坑 5 |
| 局域網接続不可 | `127.0.0.1` 束縛 | §1.1 |
| QQ 画面異常 / 登録不可 | `HOOK_AUTOLOAD_ALL` 開 | §1.10 |
| 媒体送信不可 | 権限 / 超時 / 並行 | §1.3 |
| WebUI 密碼忘却 | — | §1.2 |
| 更新常時失敗 | **上流既庫削除（預期）** | [設定 §5.1](configuration.md) |
| 文件伝送出錯 | 伝送截断 | §2 坑 6 |

---

## 4. 診断信息収集（提問前先走）

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

> ⚠️ **記録/設定貼前必脱敏**：`accessToken`、`passwordHash`、`passwordSalt`、
> `smtpPass`、QQ 号。線上令牌公開渠道貼不可也。

---

## 5. 尚解決不可乎

順次：

1. [故障排查](../advanced/troubleshooting.md) 査 —— 系統性排查流程
2. [架構与注入原理](../advanced/architecture.md) 査 —— 原理理解然後定位可能
3. [互換性矩陣](../advanced/compatibility.md) 確認 —— 汝之 QQ 版本対応可否
4. §4 之診断信息収集然後提問 —— **記録与 `grep -c unresolved` 之結果携帯**
