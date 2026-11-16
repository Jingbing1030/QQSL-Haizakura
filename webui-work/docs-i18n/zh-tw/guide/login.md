# 登入說明

> [!WARNING]
> 本內容完全由 AI 撰寫，請謹慎檢視。

> **一句話**：Haizakura **沒有自己的登入流程**。你必須透過 **noVNC**
> 遠端操作容器裡的**官方 QQ 用戶端**完成登入，Haizakura 才能開始工作。

---

## 1. 為什麼是這樣

這是 Haizakura 的架構決定的，**不是缺陷**：

| 你可能期望的 | 實際情況 |
| --- | --- |
| `POST /api/login` 傳帳號密碼 | ❌ **不存在** |
| 二維碼登入 API | ❌ **不存在**（原始碼裡沒有任何 QR 登入實作） |
| 內建無頭快速登入 | ❌ 不支援 |

**原因**：Haizakura 寄生在**官方 QQ 已經建立的 MSF 會話**上。
它不實作登入協定、不加密密碼、不處理驗證碼 —— 這些**全部由騰訊自己的
QQ 用戶端負責**。所以它必須讓你有機會操作那個真實的 QQ 視窗。

【確證】原始碼裡保留的原始提示字串（來自被注入的 `.so`）：

```
"not logged in: wait until QQ completes login"
"logged-in MSF service instance is missing"
"QQ is not ready. Please finish signing in and try again."
```

**這三句話出現的時機**：你呼叫 OneBot 動作但 QQ 還沒登入。

---

## 2. 容器裡的遠端桌面堆疊

【實測】entrypoint 啟動的圖形堆疊（`/root/start.sh`）：

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

| 元件 | 連接埠 | 說明 |
| --- | ---: | --- |
| **noVNC** | `6081` | ✅ **用這個**（瀏覽器直接存取） |
| x11vnc | `5900` | 原始 VNC，可用任意 VNC 用戶端連 |
| Xvfb | `:1` | 虛擬螢幕，解析度由 `SNOWLUMA_SCREEN` 控制（預設 `1920x1080x24`） |

---

## 3. 登入步驟

### 3.1 找到 VNC 密碼

**方式一：看容器日誌**（首次啟動會列印）

```bash
docker logs haizakura 2>&1 | grep -i "远程桌面密码\|remote desktop password"
```

輸出形如：

```
远程桌面密码: <15字节随机串>
remote desktop password: <15字节随机串>
```

**方式二：讀檔案**（注意是 root-only）

```bash
docker exec haizakura cat /app/data/config/vnc-password
```

> ⚠️ **日誌只在「密碼是新產生」時列印**。如果密碼已存在，重新啟動不會再列印 ——
> 此時用方式二，或你自己設過的 `VNC_PASSWD`。

### 3.2 開啟 noVNC

瀏覽器存取：

```
http://<你的服务器IP>:6181
```

> ⚠️ **常見雷：瀏覽器把 http 強制升級成 https。**
> 如果你的瀏覽器之前存取過 https 站台，**HSTS** 可能把 `http://ip:6181`
> 自動改成 `https://ip:6181`，導致連線失敗。
>
> **解決**：用**純 IP**（不要網域名稱）、換瀏覽器、或清掉該 IP 的 HSTS 記錄。

點擊「連線」，輸入 §3.1 的密碼。

### 3.3 在 noVNC 裡登入 QQ

看到 QQ 登入視窗後：

1. 選擇 **掃碼登入** 或 **帳號密碼登入**（QQ 自己的介面，隨版本變化）
2. **手機 QQ 掃碼**是最穩的方式
3. 如有裝置驗證 / 簡訊驗證，按 QQ 提示完成
4. 等到 QQ **進入主介面**（能看到好友清單）

> 💡 **符號連結提示**：視窗可能很小或解析度不匹配。可以調整
> `SNOWLUMA_SCREEN`（如 `1440x900x24`）後重建容器 ——
> 但注意**重建/重新啟動會丟登入狀態**（見 §5）。

### 3.4 確認 Haizakura 已辨識帳號

**等幾十秒**（QQ 登入後 Haizakura 需要發現帳號並建立會話）。

**方式一：WebUI**

開啟 `http://<IP>:5199`，在「帳號」頁應看到你的 QQ 號。

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

**失敗**（說明 QQ 還沒登入完）：

```json
{ "status": "failed", "retcode": 1, "wording": "QQ is not ready. Please finish signing in and try again." }
```

**方式三：狀態指令**

給機器人發一則訊息（私聊或群裡）：

```
#Haizakura
```

正常會回覆：

```
Haizakura 状态
版本: 2.4.0
平台: linux-x64
运行时长: 3小时 12分钟
```

> 觸發詞可設定，見 [完整設定說明](configuration.md)。
> 本實例已被改為 `#hz`。

---

## 4. 多帳號

### 4.1 架構

Haizakura **原生支援多帳號**，每個帳號是獨立的一套：

| 維度 | 隔離方式 | 實測路徑 |
| --- | --- | --- |
| 設定 | 每帳號一個檔案 | `config/onebot_<uin>.json`（`600`） |
| 訊息庫 | 每帳號一個目錄 | `data/<uin>/messages.db` |
| 貼表情庫 | 同上 | `data/<uin>/reactions.db` |
| 網路配接器 | 每帳號獨立 | 各自的 `httpServers` / `wsServers` / … |

**共用**的（全域級）：

| 檔案 | 說明 |
| --- | --- |
| `config/onebot.json` | 全域 OneBot 設定（被每帳號繼承，除非該帳號是 `snapshot` 模式） |
| `config/snowluma.json` | `rkey.fallbackServers` / `musicSignUrl` / `videoUploadConcurrency` |
| `config/notifications.json` | 通知管道定義 |
| `config/runtime.json` | WebUI / 日誌 / hook 開關等執行環境設定 |

### 4.2 容器內起多個 QQ

【確證】用 `SNOWLUMA_EXTRA_QQ_HOMES` 指定額外的 QQ HOME（**逗號分隔**）：

```bash
docker run ... \
  -e SNOWLUMA_EXTRA_QQ_HOMES="/app/qq2,/app/qq3" \
  motricseven7/snowluma:latest
```

**entrypoint 的行為**（`/root/start.sh`）：

| 規則 | 說明 |
| --- | --- |
| 路徑必須在 `/app/` 下 | 否則**跳過並列印警告** |
| 字元限制 | 只允許 `A-Za-z0-9_@%+=:,./-`，否則跳過 |
| 自動建目錄 + 改擁有者 | `mkdir -p` + `chown snowluma` |
| **錯開啟動** | 第 N 個實例 `sleep (N-1)*10` 秒，避免同時搶資源 |
| 獨立 supervisor 程式 | `qq-extra-1`、`qq-extra-2`… |

**【實測】** 日誌裡會有：

```
Configured 2 extra QQ instance(s): /app/qq2,/app/qq3
```

**然後**：每個 QQ 實例都有自己的視窗嗎？

> ⚠️ **【待確認】** 多個 QQ 實例共用同一個 Xvfb `:1` 顯示。
> 它們會**在同一個 noVNC 桌面裡各自開一個視窗**，用 fluxbox 切換。
> 這一點我們**未實測**多實例情境，請以實際行為為準。

### 4.3 帳號是如何被發現的

【確證】這部分設計相當巧妙，**不需要 root**：

```
① 定位 QQ 的数据库文件
   Linux: ~/.config/QQ/<uid-hash>/nt_db/nt_msg.db
   注意 accountDirName(uid) 做了目录名映射

② 找出「谁持有这个库」
   Linux: 读 /proc/locks，按 <dev>:<inode> 匹配
          → 读 /proc/<pid>/comm → 用 isQqProcessName() 过滤（"qq" / "QQ.exe"）
   Windows: 走 addon 的 getFileHoldersAsync()（内核句柄枚举）
```

**從被 QQ 獨佔鎖住的資料庫檔案反查行程** —— 這比列舉行程名稱可靠得多。

### 4.4 登入狀態的維持

| 機制 | 常數 / 值 | 說明 |
| --- | --- | --- |
| 登入協商輪詢 | `LOGIN_RECONCILE_INTERVAL_MS = 3000` | 每 3 秒對齊一次 |
| 身分觀察 | `LOGIN_IDENTITY_OBSERVE_INTERVAL_MS = 30000` | 每 30 秒觀察 |
| 身分上報 | `op=17` 幀 | `sendAckOnly(17, BigInt(uin), …)` |

> **原始碼註解原文**：「This does not change login state;
> readiness still requires peer confirmation.」
> 意即：本機上報身分**不等於**登入成功，還要等對端確認。

【確證】QQ 資料目錄包含：

```
/app/.config/QQ/auth/login.enc          ← 登录凭据（加密）
/app/.config/QQ/global/nt_db/login.db   ← 登录数据库
```

---

## 5. ⚠️ 重大風險：重新啟動會丟登入狀態

**【實測】這是我們真實踩過的雷，導致生產 bot 停擺 8 小時。**

### 5.1 現象

**重新啟動容器後，QQ 需要重新掃碼登入。**

原因：`/app/.config/QQ/auth/login.enc` 裡的 `loginList` 會被清空。

### 5.2 後果

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

**而掃碼需要人工介入**（你得開啟 noVNC 用手機掃）——
**如果發生在半夜，就是 8 小時停擺。**

### 5.3 怎麼辦

| 原則 | 做法 |
| --- | --- |
| **非必要不重新啟動** | 改設定優先走 **WebUI / API 熱載入**，不要重新啟動容器 |
| 必須重新啟動時 | **安排有人能掃碼的時間窗** |
| 重新啟動前 | 確認你手邊有手機 QQ 可以掃碼 |
| 長期方案 | 【待確認】研究登入狀態持久化的穩定性；考慮避免 `docker restart` 而用不重建容器的方式 |

> ⚠️ **注意**：`docker restart` 和 `docker stop/start` 都可能觸發。
> 連 **`--restart unless-stopped` 原則下的實體主機重新啟動**也會。
> 如果你的業務不能接受停擺，**必須把「重新啟動後需重新掃碼」當成既定事實來設計預案**。

### 5.4 哪些改動是熱載入的

| 改動 | 是否熱載入 | 怎麼做 |
| --- | --- | --- |
| OneBot 網路設定 | ✅ **熱載入** | `POST /api/config/:uin`（WebUI 儲存即可） |
| `statusCommand` | ✅ **熱載入** | 同上 |
| `notifications` | ✅ **熱載入** | `POST /api/notifications/config` |
| `snowluma.json` 全域設定 | ✅ 熱載入 | `POST /api/global-config` |
| `ui.json` 外觀 | ✅ 熱載入 | `POST /api/ui` |
| **`historySync.enabled`** | ❌ **僅啟動時讀取** | ⚠️ 需重新啟動 → **會丟登入狀態** |
| **`runtime.json` 大部分** | ⚠️ 【待確認】 | 從程式碼看是啟動時讀取；`updateRuntimeConfig` 只寫盤 |
| **`.env` / 容器環境變數** | ❌ 需重建容器 | ⚠️ **會丟登入狀態** |
| **程式碼（`index.mjs`）** | ❌ 需重新啟動 | ⚠️ **會丟登入狀態** |
| 日誌等級 | ✅ 熱載入 | `POST /api/logs/level` |
| hook 載入/卸載 | ✅ 熱載入 | `POST /api/processes/:pid/load` / `unload` |

> 💡 **結論**：**絕大多數日常設定改動都不需要重新啟動**。
> 只有 `historySync` 和容器級改動需要 —— 而那些恰好是最痛的。

---

## 6. 登入相關的故障排查

| 現象 | 原因 | 解決 |
| --- | --- | --- |
| noVNC 頁面打不開 | HSTS 強制 https / 連接埠沒對應 | 用純 IP；確認 `-p 6181:6081` |
| noVNC 連上但黑畫面 | Xvfb 還沒起來 | 等幾秒；看日誌有無 `Timed out waiting for Xvfb` |
| VNC 密碼不對 | 看的是舊日誌 | 讀 `/app/data/config/vnc-password` |
| QQ 視窗出現但登入失敗 | 騰訊風控 / 需要裝置驗證 | 在 noVNC 裡按 QQ 提示完成驗證 |
| QQ 登入成功但 Haizakura 不認 | 還在協商（最長 30 秒） | 等 30 秒再試；看日誌 |
| **重新啟動後要重新掃碼** | **登入狀態丟失（已知問題）** | 見 §5 |
| 動作全返回 `not logged in` | QQ 沒登入 / 登入狀態丟了 | 重新登入 |
| hook 裝不上 | 缺 `SYS_PTRACE` / seccomp | 見 [快速開始 §2.3](quick-start.md) |
| 日誌裡有 `unresolved` | RTTI 解析失敗（QQ 版本變了？） | 見 [故障排查](../advanced/troubleshooting.md) |

### 6.1 診斷指令

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

### 6.2 「QQ 已登入但動作失敗」的檢查順序

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

| 風險 | 說明 | 建議 |
| --- | --- | --- |
| **noVNC 曝露 = 完全控制 QQ** | 能連上就能操作你的 QQ | **不要曝露公網**；用防火牆/內網/VPN |
| VNC 密碼是**唯一**屏障 | 無二次驗證 | 用強密碼（`VNC_PASSWD` 明確指定） |
| 登入憑證在卷裡 | `login.enc` 是敏感檔案 | 備份卷時注意加密 |
| WebUI 預設可能對外 | 見 [設定說明](configuration.md) | 改 `webuiHost` 為 `127.0.0.1` + 反代 |

**推薦做法**：

```bash
# 只在需要登录时临时暴露 noVNC 端口，登录完就关掉
docker run ... -p 6181:6081 ...   # 登录期间
# 登录完成后，重建容器时去掉 -p 6181:6081
```

> ⚠️ 但重建容器**會丟登入狀態**（§5）—— 所以要權衡。
> 更實際的做法是**用防火牆限制來源 IP**，而不是去掉連接埠對應。
