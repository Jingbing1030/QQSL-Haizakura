# 常見問題（FAQ）

> [!WARNING]
> 本內容完全由 AI 撰寫，請謹慎檢視。

> 本文包含兩類內容：**通用問題**（對標 LLBot 的 FAQ 情境）
> 和 **我們真的踩過的雷**（這部分比通用 FAQ 更有價值）。

---

## 1. 通用問題

### 1.1 為什麼只能本機存取，區域網路 / 公網連不上？

**出於安全考量，應用程式預設只監聽 `127.0.0.1`。**

【確證】原始碼預設值：

| 設定 | 預設值 | 位置 |
| --- | --- | --- |
| `webuiHost` | `127.0.0.1` | `common/src/runtime.ts:194` |
| `httpServers[].host` | `127.0.0.1` | `onebot/src/config.ts:42` |
| `wsServers[].host` | `127.0.0.1` | `onebot/src/config.ts:54` |

**但容器情境不一樣**：Docker 容器有自己的網路命名空間，
如果只監聽 `127.0.0.1`，那麼**對應出來的實體主機連接埠永遠連不上**。

所以容器 entrypoint 會做一次播種（`/root/start.sh`）：

```javascript
// 仅在 webuiHost 缺失或为空时
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

| 目標 | 怎麼做 |
| --- | --- |
| 區域網路 / 公網存取 WebUI | 在 WebUI 裡把監聽位址改為 `0.0.0.0`，或直接改 `runtime.json` 的 `webuiHost` |
| 區域網路 / 公網呼叫 OneBot | 改配接器的 `host` 為 `0.0.0.0` |
| 只想本機存取 | 保持 `127.0.0.1`，用 SSH 通道 |

> ⚠️ **曝露到公網前必須做兩件事**：
> ① OneBot 配接器**必須設強權杖**（原始碼強制 ≥16 字元且不能是弱權杖）
> ② WebUI **建議**走反向代理 + 設 `trustProxy`，
> 因為 `/api/debug/invoke` **等於遠端執行任意動作**。

**SSH 通道方案（最安全）**：

```bash
ssh -L 5199:127.0.0.1:5199 -L 3010:127.0.0.1:3010 用户@服务器
# 然后本地访问 http://127.0.0.1:5199
```

---

### 1.2 忘記 WebUI 密碼怎麼辦？

WebUI 憑證在 `config/webui.json`（【確證】`core/src/webui/auth.ts`）：

```json
{
  "passwordHash": "<128 位十六进制 scrypt 哈希>",
  "passwordSalt": "<32 位十六进制盐>",
  "mustChangePassword": false,
  "generatedAt": "...",
  "updatedAt": "..."
}
```

用的是 **`scryptSync`**（`N=16384, r=8, p=1`，keylen 64）——**雜湊不可逆**。

**三個辦法**：

| 辦法 | 步驟 | 風險 |
| --- | --- | --- |
| **① 刪掉憑證檔案讓系統重建** | 停容器 → 刪 `config/webui.json` → 啟動 → 用引導流程設新密碼 | ⚠️ **需要重新啟動 → 會丟 QQ 登入狀態** |
| **② 首次啟動注入環境變數** | 用 `-e SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD='<強密碼>'`（**要求 ≥8 字元**） | 僅首次生效 |
| **③ 直接改雜湊** | 用同參數算出 scrypt 雜湊，替換 `passwordHash` | 需保持 `N=16384, r=8, p=1, keylen=64` |

**密碼強度要求**（【確證】`PASSWORD_RULES`，5 條全滿足才算強）：

| 規則 | 要求 |
| --- | --- |
| `length` | **不少於 10 位** |
| `lower` | 含小寫字母 |
| `upper` | 含大寫字母 |
| `special` | 含特殊符號（`!@#$%…`） |
| `no-space` | 不含空格 |

> 💡 注意 `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD` 只要求 **≥8 字元**，
> 而 WebUI 的強度檢查要求 **≥10 位 + 四類字元**。兩者標準不同。

> ⚠️ 另有兩個相關機制：**TOTP 兩步驟驗證**（`/api/auth/totp/*`，RFC 4226/6238）
> 和**復原碼**（`/api/auth/totp/recovery-codes`）。
> 如果開了 TOTP 又丟了，同樣要刪憑證檔案。
>
> ⚠️ 若設了 `SNOWLUMA_DEV_MODE=1`，改密碼會直接報錯
> 「开发模式 (SNOWLUMA_DEV_MODE=1) 已禁用密码修改」。

---

### 1.3 發不了圖片 / 語音 / 影片？

按順序排查：

| 檢查 | 說明 |
| --- | --- |
| ① 檔案權限 | 容器內 `snowluma` 使用者（uid 預設 1000）需要對 `/app/data` **有寫入權限** |
| ② `SNOWLUMA_STREAM_DIR` | 串流介面的落地目錄（預設 `$TMPDIR/onebot-stream`）；非法值會被警告並退回 |
| ③ 下載大小上限 | `SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES` |
| ④ 下載逾時 | `SNOWLUMA_HTTP_DOWNLOAD_TIMEOUT_MS`（預設 60000 ms） |
| ⑤ **影片上傳並行度** | `snowluma.json` 的 `videoUploadConcurrency`（1–4，預設 1） |
| ⑥ 磁碟空間 | `docker exec haizakura df -h /app/data` |
| ⑦ 狀態指令驗證 | 先發狀態指令確認鏈路通 |

> 💡 **Haizakura 不需要另外裝 FFmpeg**（與 LLBot 不同）——
> 它自帶 `native/ffmpeg/ffmpegAddon.linux.arm64.node`。

**權限修復**：

```bash
docker exec haizakura ls -la /app/data
docker exec haizakura chown -R 1000:1000 /app/data
```

---

### 1.4 怎麼用 CQ 碼而不是陣列格式？

**改 `messageFormat` 為 `"string"`**（【確證】`config.ts:747-749`，只接受 `"array"` 或 `"string"`）：

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
| `"array"`（預設） | `[{"type":"text","data":{"text":"hi"}}]` |
| `"string"` | `"hi[Cat:face,id=1]"` |

> 頂層也可以寫 `messageFormat` 作為**所有配接器的預設值**（相容舊佈局）。

---

### 1.5 Docker 裡怎麼存取實體主機？

**不要用 `127.0.0.1`** —— 那指向容器自己。

| 平台 | 實體主機位址 |
| --- | --- |
| Linux | `172.17.0.1`（預設 bridge 閘道）或 `--add-host=host.docker.internal:host-gateway` |
| Docker Desktop（Mac/Win） | `host.docker.internal` |

**推薦**（跨平台）：

```bash
docker run ... --add-host=host.docker.internal:host-gateway ...
```

然後設定裡用 `http://host.docker.internal:8080`。

> ⚠️ **Mac 使用者注意**：社群經驗是**用 OrbStack 而不是 Docker Desktop**，
> 否則 QQ 可能起不來。這是 LLBot 社群踩的雷，Haizakura 同屬 Electron QQ，**大概率同樣適用**。

---

### 1.6 如何在登入之前就先設定好？

**容器 entrypoint 已經幫你做了播種**（【確證】`/root/start.sh`）：

首次啟動（`onebot.json` 不存在）時，會自動產生：

```json
{
  "networks": {
    "httpServers": [{ "name": "http-default", "host": "<SNOWLUMA_ONEBOT_HOST>", "port": 3000, "path": "/", "accessToken": "<随机32字节>", "messageFormat": "array", "reportSelfMessage": false }],
    "wsServers":   [{ "name": "ws-default",   "host": "<SNOWLUMA_ONEBOT_HOST>", "port": 3001, "path": "/", "role": "Universal", "accessToken": "<随机32字节>", "messageFormat": "array", "reportSelfMessage": false }],
    "httpClients": [], "wsClients": []
  }
}
```

**關鍵設計**：**只在你刪掉了配接器時才不重建** ——
如果 `httpServers` 是**存在的空陣列**，entrypoint **不會**把它加回來。

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

**所以想預先設定**：起容器前**先把 `onebot.json` 放進卷裡**，
或用 `docker cp` 放進去，再啟動。

> 💡 **修正一個 LLBot 時代的概念**：Haizakura **沒有 `default_config.json` 繼承機制**。
> 它的等價物是**「全域 `onebot.json` + 每帳號 `onebot_<uin>.json` 的 overlay 合併」**
> （見 [設定說明 §0.2](configuration.md)）。
> 只有 `onebot_<uin>.json` 寫了 `"mode": "snapshot"` 才會忽略全域。

---

### 1.7 日誌檔案越來越大 / 日誌突然不寫了

### 日誌輪替機制

【確證】`log-file-transport.ts`：

| 參數 | 預設 | 環境變數 |
| --- | ---: | --- |
| 單檔上限 | **50 MB** | `SNOWLUMA_LOG_MAX_MB` |
| 總量上限 | **1024 MB** | `SNOWLUMA_LOG_MAX_TOTAL_MB`（也可用 `runtime.json` 的 `logMaxTotalMb`） |
| 保留天數 | **7 天** | `SNOWLUMA_LOG_RETAIN_DAYS`（`logRetainDays`） |
| 按帳號分檔 | `false` | `SNOWLUMA_LOG_PER_UIN`（`logPerUin`） |

檔案命名：

```
snowluma-YYYY-MM-DD.log          当天
snowluma-YYYY-MM-DD.N.log        滚动分片
snowluma-<uin>/...               按账号模式（目录名为纯数字）
```

### ⚠️ 雷：超配額後日誌會「靜默丟棄」

這是**很容易被誤判為「程式卡死了」的雷**。

【確證】`LogQuota.reserve()`（`log-file-transport.ts:198-221`）：

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

**行為**：

| 狀態 | 表現 |
| --- | --- |
| 健康 | 正常寫入 |
| **超配額 / 儲存異常** | 進入 `degraded` 狀態 → **日誌行被靜默丟棄**，只累加 `droppedLines` 計數 |
| 重試 | 每 **5000 ms**（`QUOTA_RETRY_MS`）重試一次 |

**症狀**：日誌檔案不再成長，但程式其實還在跑。
**誤判風險**：你會以為「行程掛了」，其實只是**日誌寫不進去**。

**怎麼查**（【實測】`GET /api/system/storage` 的回傳結構）：

```bash
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:5199/api/system/storage
```

回傳：

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

> 🔍 **看兩個欄位就夠**：`snapshot.logs.state` 和 `snapshot.logs.droppedLines`。
> `droppedLines > 0` 或 `state != "healthy"`，說明**日誌正在被丟棄**。

**修復**：

| 手段 | 指令 / 位置 |
| --- | --- |
| WebUI 清理 | `POST /api/system/storage/cleanup` |
| 調小保留 | `logRetainDays` / `SNOWLUMA_LOG_RETAIN_DAYS` |
| 調大總量 | `logMaxTotalMb` / `SNOWLUMA_LOG_MAX_TOTAL_MB` |
| 關掉檔案日誌 | `SNOWLUMA_LOG_FILE=0` |
| 降檔案等級 | `SNOWLUMA_LOG_FILE_LEVEL=warn` |

> ⚠️ **手動刪日誌檔案後可能仍處於 `degraded`**：
> 原始碼裡有這條告警 ——
> `managed logs still use N bytes after manual cleanup, exceeding the M byte limit`。
> 說明它**重新統計後仍然超限**（可能有它沒管的檔案佔著空間）。

---

### 1.8 容器 `ExitCode 126` / `Operation not permitted`

**這是部署階段最常見的失敗。**

**症狀**：

```
ExitCode = 126
日志: /root/start.sh: line 161: /usr/local/bin/node: Operation not permitted
```

**原因**：注入器需要 `ptrace` + `process_vm_writev` 附加到 QQ 行程，但：

| 缺什麼 | 後果 |
| --- | --- |
| `--cap-add SYS_PTRACE` | **hook 裝不上** |
| `--security-opt seccomp=unconfined` | **容器起不來**（預設 seccomp 攔截 `ptrace`） |

**修復**：

```bash
docker run ... \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  ...
```

**【實測】** 補上這兩項後**一次啟動成功**。

> 📌 `--privileged` 也能運作，但權限過大，**不推薦**。

---

### 1.9 hook 裝不上 / 日誌裡有 `unresolved`

**檢查 hook 健康度**：

```bash
docker exec haizakura grep -c unresolved /app/data/logs/*.log
```

| 結果 | 含義 |
| --- | --- |
| **`0`** | ✅ **hook 健康** |
| `>0` | ❌ RTTI 鏈解析失敗 |

**`unresolved` 意味著什麼**：`.so` 裡的「唯一驗證閘門」沒通過 ——
它用 **RTTI 結構比對**（不是字串比對）去找 `nt::MSFService` /
`nt::MSFCoreService`，失敗了。

**常見原因**：

| 原因 | 說明 | 怎麼辦 |
| --- | --- | --- |
| **QQ 版本變了** | `wrapper.node` 的 RTTI / vtable 佈局變了 | 用 `dump-vtable.py` diff 基線，見 [參與開發](../dev/contributing.md) |
| 缺 `SYS_PTRACE` | 注入根本沒成功 | 見 §1.8 |
| zygote 被注入了 | 見 §1.10 | 檢查 `SNOWLUMA_HOOK_AUTOLOAD_ALL` |
| 核心禁用 `ptrace` | 加固核心（如帶 Yama 限制） | 檢查 `kernel.yama.ptrace_scope` |

**確認 QQ 版本與基線是否一致**：

```bash
docker exec haizakura md5sum /app/runtime/../.config/... # 定位 wrapper.node
# 期望 md5: adeb40af26d859d41fcdb21bf38d9eb5
```

---

### 1.10 ⚠️ 千萬不要隨便開 `SNOWLUMA_HOOK_AUTOLOAD_ALL`

**這是文件裡最需要警告的一項。**

正常流程會**過濾掉 Electron 的 zygote 與子行程**，只注入主 QQ 行程。
`SNOWLUMA_HOOK_AUTOLOAD_ALL=1` **繞過這個過濾**。

**【確證】後果**：

> 注入進 zygote 會**在 zygote 裡啟動 hook 的 resolver 執行緒**；
> 之後 Electron fork 出的**每個 renderer 都會繼承該執行緒 + 半初始化的 hook 狀態**，
> 直接**搞壞 QQ 的 IPC 和登入介面**。

**症狀**：QQ 介面異常、登入不上、各種玄學問題。

**什麼情況下才用它**：**排查「為什麼主行程沒被注入」時臨時開**，
用完立刻關掉並重新啟動。

---

## 2. ⭐ 我們真的踩過的雷

> 這些是**用代價換來的經驗**，比通用 FAQ 有價值。建議全部讀一遍。

### 雷 1：🔴 重新啟動容器會丟 QQ 登入狀態（最痛）

**這是本專案最大的維運陷阱。**

| 項目 | 說明 |
| --- | --- |
| **現象** | 重新啟動容器後 QQ 需要**重新掃碼登入** |
| **原因** | `/app/.config/QQ/auth/login.enc` 的 `loginList` 被清空 |
| **代價** | **我們曾因此讓生產 bot 停擺 8 小時** |
| **為什麼痛** | 掃碼需要**人工介入**（開啟 noVNC 用手機掃） |

**故障鏈**：

```
重启容器 → 登录态丢失 → Haizakura 拿不到 MSF 会话
        → 所有动作返回 "not logged in" → ⛔ bot 完全不可用
```

**結論**：

| 原則 | 做法 |
| --- | --- |
| **非必要不重新啟動** | 改設定**優先走 WebUI / API 熱載入** |
| 必須重新啟動時 | **安排有人能掃碼的時間窗** |
| 重新啟動前 | 確認手邊有手機 QQ |
| 接受現實 | 把「重新啟動需重新掃碼」當**既定事實**做預案 |

**哪些操作是熱載入的（不會丟登入狀態）**：

| 改動 | 熱載入 |
| --- | --- |
| OneBot 網路設定 | ✅ |
| `statusCommand` | ✅ |
| `notifications` | ✅ |
| 日誌等級 | ✅ |
| hook 載入 / 卸載 | ✅ |
| **`historySync.enabled`** | ❌ 僅啟動時讀取 |
| **環境變數 / 程式碼** | ❌ 需重建容器 |

詳見 [設定說明 §11](configuration.md)。

---

### 雷 2：noVNC 被 HSTS 強制升級成 https

| 項目 | 說明 |
| --- | --- |
| **現象** | `http://<IP>:6181` 打不開，瀏覽器自動跳 https |
| **原因** | 瀏覽器 **HSTS** 原則把該位址強制升級為 https，而 noVNC 是純 http |
| **修復** | ① 用**純 IP**（不要網域名稱）② 換瀏覽器 ③ 清該 IP 的 HSTS 記錄 |

**Chrome 清 HSTS**：`chrome://net-internals/#hsts` → Delete domain security policies。

---

### 雷 3：改了 `#hz` 之類設定「不生效」

**兩個層面的原因，都要查。**

**原因 A：設定優先順序 / `mode` 問題**

【確證】`onebot_<uin>.json` 若寫了 `"mode": "snapshot"`，
**全域 `onebot.json` 對它完全無效**。

```
onebot.json（全局）
      ↓ 仅在非 snapshot 时叠加
onebot_<uin>.json（每账号）
```

| 你可能改了 | 但實際生效的是 |
| --- | --- |
| 全域 `onebot.json` 的 `statusCommand` | ⚠️ **會被 per-uin 的值覆寫**（見下）—— 不是「全域不支援」，而是**優先順序輸了** |
| `onebot.json` 的某個配接器 | per-uin 裡**同名配接器**會整體覆寫它 |

> 📌 **為什麼改全域的 `statusCommand` 通常沒用**（【確證】兩條事實疊加）：
>
> **事實 1**：`parseStatusCommand(sources)` 會**走訪所有來源**，後面的覆寫前面的。
> 非 snapshot 時 `sources = [全域, per-uin]` → **per-uin 贏**。
>
> **事實 2**：`toJsonObject()`（`config.ts:498-517`）儲存 per-uin 時**總是**寫入
> `statusCommand` / `historySync` / `notifications` 三個節 ——
> **即使你沒明確設過，它也會寫入預設值**。
>
> **兩者疊加的結論**：per-uin 檔案裡**永遠有** `statusCommand`，
> 所以**它永遠贏**。你在全域改 `trigger`，會被 per-uin 的預設值（或舊值）蓋掉。
>
> **【實測】** 觀察到的 `onebot.json`（全域）確實只有 `networks` 一節 ——
> 因為它是容器 entrypoint 播種產生的，而播種邏輯只寫 `networks`。
>
> ✅ **所以：狀態指令 / 歷史回填 / 通知管道請一律改在 `onebot_<uin>.json` 裡。**
> （或者說：**用 WebUI / `POST /api/config/:uin` 改**，別手改全域檔案。）

**原因 B：沒有熱載入**

| 設定 | 是否熱載入 |
| --- | --- |
| `statusCommand` | ✅ 改完即生效（走 WebUI / API） |
| `historySync.enabled` | ❌ 僅啟動時讀取 |

**改完沒生效的自查**：

```bash
# 1. 确认你改的是哪个文件
docker exec haizakura cat /app/data/config/onebot_<uin>.json | grep -A5 statusCommand

# 2. 确认 mode 是什么
docker exec haizakura grep '"mode"' /app/data/config/onebot_<uin>.json

# 3. 走 API 改（推荐），而不是手动改文件
```

> ⚠️ **`POST /api/config/:uin` 要求提交「完整設定」，不是局部修補。**
>
> 【確證】`server.ts:1293-1297` 拿到 body 後**直接**跑 `assertValidOneBotConfig(body)`，
> 然後整體存檔。所以：
>
> | 做法 | 結果 |
> | --- | --- |
> | 只發 `{"statusCommand":{...}}` | ❌ **驗證失敗**（缺 `networks` / `historySync`） |
> | 先 `GET` 拿全量 → 改欄位 → `POST` 回去 | ✅ **正確做法** |
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
> **回應會告訴你是否真的熱載入了**（【確證】回傳結構）：
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
> | `message` | 含義 |
> | --- | --- |
> | 配置保存成功，已热重载当前会话。 | ✅ 立即生效 |
> | 配置保存成功，当前会话未在线，将在下次连接时生效。 | ⚠️ 帳號沒在線上 |
> | 配置已保存，但部分网络节点未能应用… | ⚠️ 部分失敗，看 `errors` |
>
> 💡 **`GET /api/config/:uin` 拿到的是「合併後」的結果**（【確證】`loadOneBotConfig`
> 把全域 + per-uin 合併後回傳，**且不含 `mode` 欄位**）。
>
> ⚠️ **所以「GET → 改 → POST」會把檔案固化成 `snapshot` 模式。**
>
> 【確證】`saveOneBotConfig` 的預設 mode 是 `"snapshot"`：
>
> ```javascript
> saveJson(..., toJsonObject(config, options.mode ?? "snapshot"));
> ```
>
> 後果：**該帳號從此不再繼承全域 `onebot.json`**。
>
> | 你想要 | 正確做法 |
> | --- | --- |
> | 只讓該帳號生效，不繼承全域 | ✅ GET → 改 → POST（目前行為正好） |
> | **繼續繼承全域** | ⚠️ POST 前**手動加** `"mode": "overlay"` 到 body 裡 |
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

> 💡 **另注意觸發詞的比對語意**：**精確相等、只有單個 text 段**。
> `#hz` + 圖片 = 兩段 = **不觸發**。見 [設定說明 §2.1](configuration.md)。

---

### 雷 4：容器 `ExitCode 126`

見 §1.8。核心是 `SYS_PTRACE` + `seccomp=unconfined` 兩項缺一不可。

---

### 雷 5：用 `/dev/tcp` 測試連接埠得到「假陰性」

**這個雷會誤導你的排查方向。**

**現象**：明明連接埠是通的，但用 `sh -c 'echo > /dev/tcp/...'` 測試失敗。

**【實測】** 容器內對比：

```bash
$ docker exec haizakura sh -c '(echo > /dev/tcp/127.0.0.1/5099) && echo ok'
sh: 1: cannot create /dev/tcp/127.0.0.1/5099: Directory nonexistent   ← ❌ 假阴性
sh: FAILED

$ docker exec haizakura curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5099/
200                                                                   ← ✅ 真的通
```

**原因**：`/dev/tcp` 是 **bash 的特性**，**不是 POSIX**。
容器裡 `docker exec ... sh` 預設用的是 **dash**，不支援 `/dev/tcp`。

（容器裡 `bash` 是存在的：`/usr/bin/bash`）

**正確做法**：

| 方式 | 指令 |
| --- | --- |
| **推薦** | `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5099/` |
| 用 bash | `docker exec haizakura bash -c 'echo > /dev/tcp/127.0.0.1/5099'` |
| 看監聽 | `docker exec haizakura ss -lntp` |

> 💡 **通用教訓**：排查網路問題時，**用 curl 而不是 `/dev/tcp`** 來測 HTTP 服務 ——
> 前者還能看到狀態碼，資訊量更大。

---

### 雷 6：跨機傳檔案被截斷

**現象**：`scp` / `docker cp` 傳輸大檔案（如 12 MB 的 `index.mjs`）後，
檔案大小不對或內容損壞。

**教訓**：**跨機傳檔案後必須校驗雜湊。**

```bash
# 传之前
sha256sum index.mjs

# 传之后
sha256sum index.mjs   # 必须一致

# 或直接对比大小 + md5
md5sum index.mjs
```

**【實測】目前執行版本的值**（可用於核對）：

```
index.mjs   12,338,442 字节
md5         bebdc7586f6e6586be80a85cc744ae5c
```

> 📌 **注意兩個不同的基線，別混**：
>
> | 版本 | 位元組數 | MD5 |
> | --- | ---: | --- |
> | **還原報告記錄的原始 bundle** | 12,338,350 | `19bdfef05f6bebfb3986caf81dba37c3` |
> | **目前執行中的（改名後）** | **12,338,442** | **`bebdc7586f6e6586be80a85cc744ae5c`** |
>
> 兩者差異來自品牌改名（`#sl` → `#Haizakura` 等）與後續修改。
> **核對時以你實際部署的那份為準** —— 容器內、`dist/`、
> 以及掛載的 `index.mjs` 三者應當一致。

> 💡 **為什麼這個雷重要**：如果傳壞的 `index.mjs` 進了容器，
> 症狀是**千奇百怪的**（啟動失敗 / 某個功能異常），
> 而你不會懷疑到「檔案傳輸出錯」上。
> **傳完就校驗，能省幾個小時。**

---

### 雷 7：逆向腳本無計數上限會把機器打爆

**適用範圍**：如果你在跑 RTTI 分析 / 逆向腳本。

**教訓**：**執行逆向腳本必須加計數上限。**

| 陷阱 | 後果 |
| --- | --- |
| Python 切片 `b[:z]` 當 `z == -1` | 會吐出 10 MB 資料 |
| `.eh_frame_hdr` 的 `pcrel` 當無符號解碼 | `fde_count` 變成 1.8e19 → 越界 |
| `for i in range(cnt)` 裡 `cnt` 解錯 | **無限 append → 2.7 GB 記憶體** |

**【實測】** 當時在一台 2 核、跑著真實業務的機器上，
一次迴圈邊界寫錯就把**負載推到 37**。

**另一個陷阱**：用「已定義匯出」子集當全部符號，
會得出「dynsym 裡沒有 RTTI」的**錯誤結論**（實際有 397 個）。

---

### 雷 8：`/proc/<pid>/maps` 裡的 `(deleted)` 是正常的

**不要以為這是異常。**

```
# 注入负载映射（注意 (deleted)）
$ docker exec haizakura cat /proc/<qq_pid>/maps | grep -i orcexec
... /tmp/runtime-1000/orcexec.abc123 (deleted)
```

**原因**：注入器在映射完 `.so` 之後**主動 `unlink` 暫存檔** ——
這是**反本機發現的設計**，磁碟上查不到該檔案是**預期行為**。

**同理，以下都是正常的**：

| 現象 | 說明 |
| --- | --- |
| `(deleted)` 後綴 | 注入後主動 unlink |
| socket 名叫 `mojo.<pid>.*.sock` | **刻意偽裝成 Chromium 的 mojo IPC** |
| `/tmp/runtime-<uid>/orcexec.<6位随机>` | 隨機名稱，注入後消失 |
| 執行緒名 `snowluma-pipe-w` | 注入的管道寫入執行緒 |

```bash
# 确认注入确实活着（这几个都应该有输出）
docker exec haizakura cat /proc/<qq_pid>/task/*/comm | grep snowluma
docker exec haizakura ss -xpn | grep mojo
```

---

## 3. 故障速查表

| 症狀 | 最可能的原因 | 去哪看 |
| --- | --- | --- |
| 容器 `ExitCode 126` | 缺 `SYS_PTRACE` / seccomp | §1.8 |
| 容器起來但動作全失敗 | QQ 沒登入 / 登入狀態丟了 | [登入說明](login.md) |
| **重新啟動後要重新掃碼** | **登入狀態丟失（已知）** | §2 雷 1 |
| 日誌有 `unresolved` | QQ 版本變了 / 注入失敗 | §1.9 |
| 日誌不再成長 | **超配額靜默丟棄** | §1.7 |
| noVNC 打不開 | HSTS 強制 https | §2 雷 2 |
| noVNC 黑畫面 | Xvfb 未就緒 | 等幾秒 / 看日誌 |
| 狀態指令不回應 | 非單段純文字 / trigger 不對 | [設定 §2.1](configuration.md) |
| 狀態指令改了不生效 | 改錯檔案（全域 vs per-uin） | §2 雷 3 |
| 連接埠測不通 | `/dev/tcp` 假陰性 | §2 雷 5 |
| 區域網路連不上 | 綁了 `127.0.0.1` | §1.1 |
| QQ 介面異常 / 登入不上 | 開了 `HOOK_AUTOLOAD_ALL` | §1.10 |
| 發不了媒體 | 權限 / 逾時 / 並行度 | §1.3 |
| 忘了 WebUI 密碼 | — | §1.2 |
| 更新總是失敗 | **上游已刪庫（預期）** | [設定 §5.1](configuration.md) |
| 檔案傳輸出錯 | 傳輸截斷 | §2 雷 6 |

---

## 4. 診斷資訊收集（提問前先跑）

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

> ⚠️ **貼日誌/設定前務必去識別化**：`accessToken`、`passwordHash`、`passwordSalt`、
> `smtpPass`、QQ 號。別把線上權杖貼到公開管道。

---

## 5. 還是解決不了？

按順序：

1. 查 [故障排查](../advanced/troubleshooting.md) —— 系統性排查流程
2. 查 [架構與注入原理](../advanced/architecture.md) —— 理解原理才能定位
3. 確認 [相容性矩陣](../advanced/compatibility.md) —— 你的 QQ 版本是否受支援
4. 收集 §4 的診斷資訊再提問 —— **帶上日誌和 `grep -c unresolved` 的結果**
