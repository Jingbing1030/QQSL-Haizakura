# 登録説明

> [!WARNING]
> 本内容完全 AI 編写、慎重閲覧求也。

> **一言**：Haizakura 者**自身之登録流程無**也。汝必 **noVNC** 経由
> 容器中**公式 QQ 客端**遠隔操作、登録完成、然後 Haizakura 動作開始可能也。

---

## 1. 何故此為

此 Haizakura 之架構決定也、**欠陥非也**：

| 汝期望可能性有之物 | 実際情況 |
| --- | --- |
| `POST /api/login` 帳号密碼伝 | ❌ **不存在** |
| 二次元碼登録 API | ❌ **不存在**（源碼中 QR 登録実装一切無） |
| 内蔵無頭快速登録 | ❌ 非対応 |

**原因**：Haizakura 者**公式 QQ 既確立之 MSF 会話**上寄生也。
登録協議非実装、密碼非暗号化、検証碼非処理 —— 此等**全部騰訊自身之
QQ 客端担当**也。故其真実 QQ 窓操作之機会、汝為用意必要也。

【確証】源碼中保留之原始提示串（注入 `.so` 由来）：

```
"not logged in: wait until QQ completes login"
"logged-in MSF service instance is missing"
"QQ is not ready. Please finish signing in and try again."
```

**此三句出現之機**：汝 OneBot 動作呼出、但 QQ 尚未登録時也。

---

## 2. 容器中之遠隔桌面堆

【実測】entrypoint 起動之図形堆（`/root/start.sh`）：

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

| 組件 | 端口 | 説明 |
| --- | ---: | --- |
| **noVNC** | `6081` | ✅ **之使用**（瀏覧器直接訪問） |
| x11vnc | `5900` | 原始 VNC、任意 VNC 客端接続可能 |
| Xvfb | `:1` | 仮想屏、解像度 `SNOWLUMA_SCREEN` 制御（既定 `1920x1080x24`） |

---

## 3. 登録步驟

### 3.1 VNC 密碼探索

**方式一：容器記録参照**（初回起動時打印）

```bash
docker logs haizakura 2>&1 | grep -i "远程桌面密码\|remote desktop password"
```

輸出形式如下：

```
远程桌面密码: <15字节随机串>
remote desktop password: <15字节随机串>
```

**方式二：文件読取**（root-only 注意）

```bash
docker exec haizakura cat /app/data/config/vnc-password
```

> ⚠️ **記録者「密碼新生成」時仅打印也**。密碼既存在場合、再起動亦不打印 ——
> 此時方式二使用、或汝自設定之 `VNC_PASSWD` 使用。

### 3.2 noVNC 開

瀏覧器訪問：

```
http://<你的服务器IP>:6181
```

> ⚠️ **常見坑：瀏覧器 http 強制 https 昇級也。**
> 汝之瀏覧器以前 https 站訪問有場合、**HSTS** 者 `http://ip:6181`
> 自動 `https://ip:6181` 変更、接続失敗招可能性有。
>
> **解決**：**純 IP** 使用（域名不可）、瀏覧器変更、或該 IP 之 HSTS 記録清除。

「接続」点击、§3.1 之密碼入力。

### 3.3 noVNC 中 QQ 登録

QQ 登録窓見後：

1. **扫码登録** 或 **帳号密碼登録** 選択（QQ 自身之画面、版本随変化）
2. **手機 QQ 扫码**最安定之方式也
3. 設備検証 / 短信検証有場合、QQ 提示従完成
4. QQ **主画面進入**待（朋友列表可見）

> 💡 **符号鏈接提示**：窓甚小或解像度不適合可能性有。`SNOWLUMA_SCREEN`
> （例 `1440x900x24`）調整後容器再建可能 ——
> 但**再建 / 再起動者登録態喪失**注意（§5 参照）。

### 3.4 Haizakura 帳号識別済確認

**数十秒待**（QQ 登録後 Haizakura 帳号発見且会話確立必要也）。

**方式一：WebUI**

`http://<IP>:5199` 開、「帳号」頁中汝之 QQ 号見可。

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

**失敗**（QQ 尚未登録完表示）：

```json
{ "status": "failed", "retcode": 1, "wording": "QQ is not ready. Please finish signing in and try again." }
```

**方式三：状態指令**

機械人宛消息一条送（私聊或群中）：

```
#Haizakura
```

正常者以下返信：

```
Haizakura 状态
版本: 2.4.0
平台: linux-x64
运行时长: 3小时 12分钟
```

> 触発語設定可能、[完全設定説明](configuration.md) 参照。
> 本実例既 `#hz` 変更済。

---

## 4. 複数帳号

### 4.1 架構

Haizakura **原生複数帳号対応**、各帳号独立之一套也：

| 維度 | 分離方式 | 実測経路 |
| --- | --- | --- |
| 設定 | 毎帳号一文件 | `config/onebot_<uin>.json`（`600`） |
| 消息庫 | 毎帳号一目録 | `data/<uin>/messages.db` |
| 貼表情庫 | 同上 | `data/<uin>/reactions.db` |
| 網適配器 | 毎帳号独立 | 各自之 `httpServers` / `wsServers` / … |

**共用**之物（全局級）：

| 文件 | 説明 |
| --- | --- |
| `config/onebot.json` | 全局 OneBot 設定（毎帳号継承、但該帳号 `snapshot` 模式場合除） |
| `config/snowluma.json` | `rkey.fallbackServers` / `musicSignUrl` / `videoUploadConcurrency` |
| `config/notifications.json` | 通知渠道定義 |
| `config/runtime.json` | WebUI / 記録 / hook 開関等運行時設定 |

### 4.2 容器内複数 QQ 起動

【確証】`SNOWLUMA_EXTRA_QQ_HOMES` 依追加 QQ HOME 指定（**逗号分離**）：

```bash
docker run ... \
  -e SNOWLUMA_EXTRA_QQ_HOMES="/app/qq2,/app/qq3" \
  motricseven7/snowluma:latest
```

**entrypoint 之挙動**（`/root/start.sh`）：

| 規則 | 説明 |
| --- | --- |
| 経路必 `/app/` 下 | 否者**跳過且警告打印** |
| 文字制限 | `A-Za-z0-9_@%+=:,./-` 仅許可、否者跳過 |
| 自動目録作成 + 属主変更 | `mkdir -p` + `chown snowluma` |
| **起動錯開** | 第 N 実例 `sleep (N-1)*10` 秒、同時資源争奪回避 |
| 独立 supervisor 程序 | `qq-extra-1`、`qq-extra-2`… |

**【実測】** 記録中以下有：

```
Configured 2 extra QQ instance(s): /app/qq2,/app/qq3
```

**然後**：各 QQ 実例各自之窓有乎？

> ⚠️ **【待確認】** 複数 QQ 実例者同一 Xvfb `:1` 显示器共用也。
> 彼等**同一 noVNC 桌面中各自一窓開**、fluxbox 依切替。
> 此点**複数実例場面未実測**、実際挙動準拠求也。

### 4.3 帳号如何被発見

【確証】此部分設計相当巧妙、**root 無需**：

```
① 定位 QQ 的数据库文件
   Linux: ~/.config/QQ/<uid-hash>/nt_db/nt_msg.db
   注意 accountDirName(uid) 做了目录名映射

② 找出「谁持有这个库」
   Linux: 读 /proc/locks，按 <dev>:<inode> 匹配
          → 读 /proc/<pid>/comm → 用 isQqProcessName() 过滤（"qq" / "QQ.exe"）
   Windows: 走 addon 的 getFileHoldersAsync()（内核句柄枚举）
```

**QQ 独占鎖之資料庫文件自工程逆查** —— 此工程名羅列依甚可靠也。

### 4.4 登録状態之維持

| 機制 | 常量 / 値 | 説明 |
| --- | --- | --- |
| 登録協商輪詢 | `LOGIN_RECONCILE_INTERVAL_MS = 3000` | 毎 3 秒一回整 |
| 身分観察 | `LOGIN_IDENTITY_OBSERVE_INTERVAL_MS = 30000` | 毎 30 秒観察 |
| 身分上報 | `op=17` 幀 | `sendAckOnly(17, BigInt(uin), …)` |

> **源碼注釈原文**：「This does not change login state;
> readiness still requires peer confirmation.」
> 意即：本地身分上報**登録成功非也**、尚対端確認待必要也。

【確証】QQ 資料目録包含：

```
/app/.config/QQ/auth/login.enc          ← 登录凭据（加密）
/app/.config/QQ/global/nt_db/login.db   ← 登录数据库
```

---

## 5. ⚠️ 重大危険：再起動者登録態喪失

**【実測】此我等我等真実踏過之坑也、生産 bot 八時間停摆招。**

### 5.1 現象

**容器再起動後、QQ 再扫码登録必要也。**

原因：`/app/.config/QQ/auth/login.enc` 中 `loginList` 清空為也。

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

**且扫码者人工介入必要**（汝 noVNC 開、手機依扫）——
**半夜発生場合、八時間停摆也。**

### 5.3 如何為

| 原則 | 做法 |
| --- | --- |
| **非必要不重起** | 設定変更者 **WebUI / API 熱載**優先、容器再起動不可 |
| 必重起時 | **扫码可能之時間窓安排** |
| 重起前 | 手元手機 QQ 扫码可能確認 |
| 長期方案 | 【待確認】登録態永続化之安定性研究；`docker restart` 回避、容器不再建之方式考慮 |

> ⚠️ **注意**：`docker restart` 与 `docker stop/start` 皆触発可能性有。
> 連 **`--restart unless-stopped` 策略下之宿主機再起**亦同。
> 汝之業務停摆受入不可場合、**「重起後再扫码必要」既定之事実為前提設計必**也。

### 5.4 何之改動者熱載也

| 改動 | 熱載可否 | 如何為 |
| --- | --- | --- |
| OneBot 網設定 | ✅ **熱載** | `POST /api/config/:uin`（WebUI 保存即可） |
| `statusCommand` | ✅ **熱載** | 同上 |
| `notifications` | ✅ **熱載** | `POST /api/notifications/config` |
| `snowluma.json` 全局設定 | ✅ 熱載 | `POST /api/global-config` |
| `ui.json` 外観 | ✅ 熱載 | `POST /api/ui` |
| **`historySync.enabled`** | ❌ **起動時仅読** | ⚠️ 再起動必要 → **登録態喪失** |
| **`runtime.json` 大部分** | ⚠️ 【待確認】 | 代碼見者起動時読；`updateRuntimeConfig` 者書盤仅 |
| **`.env` / 容器環境変数** | ❌ 容器再建必要 | ⚠️ **登録態喪失** |
| **代碼（`index.mjs`）** | ❌ 再起動必要 | ⚠️ **登録態喪失** |
| 記録級別 | ✅ 熱載 | `POST /api/logs/level` |
| hook 載入/卸載 | ✅ 熱載 | `POST /api/processes/:pid/load` / `unload` |

> 💡 **結論**：**日常設定改動之绝大多数者再起動不要也**。
> `historySync` 与容器級改動仅必要 —— 且彼等恰好最痛之物也。

---

## 6. 登録関連之故障排查

| 現象 | 原因 | 解決 |
| --- | --- | --- |
| noVNC 頁開不可 | HSTS https 強制 / 端口未映射 | 純 IP 使用；`-p 6181:6081` 確認 |
| noVNC 接続但黒屏 | Xvfb 尚未起 | 数秒待；記録中 `Timed out waiting for Xvfb` 有無見 |
| VNC 密碼不対 | 旧記録見也 | `/app/data/config/vnc-password` 読 |
| QQ 窓出現但登録失敗 | 騰訊風控 / 設備検証必要 | noVNC 中 QQ 提示従検証完成 |
| QQ 登録成功但 Haizakura 不認 | 尚協商中（最長 30 秒） | 30 秒待再試；記録見 |
| **重起後再扫码必要** | **登録態喪失（既知問題）** | §5 参照 |
| 動作全 `not logged in` 返 | QQ 未登録 / 登録態失 | 再登録 |
| hook 装不可 | `SYS_PTRACE` / seccomp 欠 | [快速開始 §2.3](quick-start.md) 参照 |
| 記録中 `unresolved` 有 | RTTI 解析失敗（QQ 版本変化？） | [故障排查](../advanced/troubleshooting.md) 参照 |

### 6.1 診断命令

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

### 6.2 「QQ 既登録但動作失敗」之検査順序

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

| 危険 | 説明 | 建議 |
| --- | --- | --- |
| **noVNC 暴露 = QQ 完全控制** | 接続可能者汝之 QQ 操作可能 | **公網暴露不可**；防火牆/内網/VPN 使用 |
| VNC 密碼者**唯一**屏障 | 二次検証無 | 強密碼使用（`VNC_PASSWD` 明示指定） |
| 登録憑据者巻中在 | `login.enc` 敏感文件也 | 巻備份時暗号化注意 |
| WebUI 既定対外可能性有 | [設定説明](configuration.md) 参照 | `webuiHost` `127.0.0.1` 変更 + 反向代理 |

**推奨做法**：

```bash
# 只在需要登录时临时暴露 noVNC 端口，登录完就关掉
docker run ... -p 6181:6081 ...   # 登录期间
# 登录完成后，重建容器时去掉 -p 6181:6081
```

> ⚠️ 但容器再建者**登録態喪失**（§5）—— 故権衡必要也。
> 更実際之做法者**防火牆依来源 IP 制限**也、端口映射除去非也。