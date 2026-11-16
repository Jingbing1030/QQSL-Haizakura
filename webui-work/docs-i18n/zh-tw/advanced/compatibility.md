# 相容性矩陣

> [!WARNING]
> 本內容完全由 AI 撰寫，請謹慎檢視。

> **面向讀者**：準備部署或升級 Haizakura（原名 SnowLuma）的維運人員，以及要適配新 QQ 版本的維護者。
> **本文回答**：它能跑在什麼環境上？相依哪些精確版本？QQ 升級了會怎樣、要改什麼？
> **最重要的一條**：**QQ 版本必須釘死，不要自動升級。** 理由見 §7。

---

## 0. 快速自檢

```bash
# ① QQ 版本对不对
docker exec <容器> sh -c 'grep -m1 -o "\"version\": \"[^\"]*\"" /opt/QQ/resources/app/package.json'
# 期望： "version": "3.2.32-52194"

# ② wrapper.node 指纹对不对（最关键）
docker exec <容器> sh -c 'md5sum /opt/QQ/resources/app/wrapper.node'
# 期望： adeb40af26d859d41fcdb21bf38d9eb5

# ③ Node 版本过闸门
docker exec <容器> node -v
# 期望： v24.22.2（满足 ^24.22.1 || >=26.12.1）

# ④ hook 健康度（0 = 健康）
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'
```

任何一項不符 → 去看對應的章節。

---

## 1. 版本基線（接手必記）

**這是一切偏移的參照系。** 所有位址、槽位、結構佈局都基於這一組指紋。

### 1.1 核心版本

| 項目 | 值 |
|---|---|
| **QQ 版本** | `3.2.32-52194`（Linux arm64） |
| `wrapper.node` 大小 | **144,561,472** 位元組 |
| `wrapper.node` md5 | **`adeb40af26d859d41fcdb21bf38d9eb5`** |
| `wrapper.node` build-id | **`89c36b520f97c88081a9453bd6abb70c3452f156`** |
| SnowLuma / Haizakura runtime | **2.4.0** |
| hook stub 自述版本 | `snowluma-linux-hook-stub/0.2.0` |
| Node | **24.22.2** |
| 容器映像 | `motricseven7/snowluma:latest`（2.69 GB，arm64） |

### 1.2 native 產物 sha256

```bash
cf8183755e7b912149c045f93bd6010feeeaa170fff0580d7013d62b6347da00  snowluma-linux-arm64.node
238ff3c348d98a42e49662f58fbd4404f89b9a65a7fc6e56c1775e2740d3f13e  snowluma-linux-arm64.so
b705b7e2392a75cdde95a146f933a7d472b4c72709f35f707a0798f9fcdf9e19  websocket-linux-arm64.node
```

> ⚠️ **`wrapper.node` 的 build-id 是跨版本區分的唯一可靠指紋。**
> 它比檔案大小更準（大小會變），比 md5 更適合執行環境校驗（md5 要讀全 144 MB，
> build-id 只需讀 `0x200` 處 36 位元組）。
> `89c36b52…` **正是 `.so` 裡 `missing or ambiguous GNU build ID` 校驗的那個值**。

### 1.3 wrapper.node 的關鍵節位址

```
[12] .text           PROGBITS  083d780   83d780   5e1ff10
[15] .rodata         PROGBITS  665d900   665d900   994a46    ← vaddr == file off ✅
[23] .data.rel.ro    PROGBITS  86acb60   869cb60   32e5a8    ← vaddr ≠ file off ⚠️
[24] .dynamic        DYNAMIC   89db108   89cb108   2c0

.note.gnu.build-id   @ vaddr 0x200 / file 0x200，段大小 0x24
                     NT_GNU_BUILD_ID 描述符 0x14 (20) 字节

Δ = .data.rel.ro 的 (vaddr − file_off) = 0x10000
```

> **Δ 本身不固定，換版本會變** —— 必須從節表算，不能硬編碼。詳見
> [architecture.md §6.3](architecture.md)。

### 1.4 基線中的關鍵結構

```
nt::MSFService
  RTTI 名 (mangled) : N2nt10MSFServiceE       @ .rodata 0x677ecaa
  typeinfo          : 0x87177e0
  vtable            : 0x87173e0 (offset_to_top=0, 44 槽) + 4 套次 vtable
  SessionInit       : v[19] +0x098 → 0x137a48c
  SendSSOReqInternal: v[36] +0x120 → 0x137cc80

nt::MSFCoreService
  RTTI 名 (mangled) : N2nt14MSFCoreServiceE   @ .rodata 0x67818e1
  typeinfo          : 0x87193f8
  vtable            : 0x8718f58 (offset_to_top=0, 52 槽) + 5 套次 vtable
  SessionInit       : v[19] +0x098 → 0x139d864
  onMSFPacketState  : v[47] +0x178 → 0x13a3e80
```

---

## 2. 支援的平台

### 2.1 只有 Linux arm64

| 平台 | 支援狀態 | 說明 |
|---|---|---|
| **Linux arm64 (aarch64)** | ✅ **唯一有建置產物的平台** | 全部 5 個 native 產物都是 arm64 |
| Linux x86_64 | ❌ | 實測報錯：`No hook native addon found for linux-x64` |
| Windows | ⚠️ 有程式碼路徑，**無產物** | 走具名管道 + `getFileHoldersAsync`；需 DLL，未發布 |
| macOS | ⚠️ 有程式碼路徑，**無產物** | 走 `DYLD_INSERT_LIBRARIES`；需 dylib，未發布 |

**換架構需要全部 5 個 native 產物** —— 這是極高工作量的操作，**不推薦**。

### 2.2 Linux arm64 的實測環境

```
架构        aarch64
发行版      Debian GNU/Linux 12 (bookworm)（容器内）
Electron    40.0.0（QQ 自带）
X 显示      Xvfb :1 -screen 0 1920x1080x24
窗口管理    fluxbox
VNC         x11vnc + noVNC（6081 端口，扫码登录用）
```

### 2.3 需要的 Linux 核心能力

| 能力 | 為什麼需要 | 缺了會怎樣 |
|---|---|---|
| `ptrace` | 注入器附加到 QQ 行程 | 注入失敗 |
| `process_vm_readv` / `process_vm_writev` | 讀寫目標行程記憶體 | 報 `QQ runtime cannot read process memory` |
| `/proc/<pid>/maps` 可讀 | 找 `wrapper.node` 的載入基址 | 報 `module not found in target process maps` |
| `/proc/<pid>/environ` 可讀 | 跨行程讀 `SNOWLUMA_HOOK_RUNTIME_DIR` | **同 uid 可行，跨 uid 會失敗** 【未查清】 |
| `/proc/locks` 可讀 | 定位帳號資料庫持有者（不需要 root） | 帳號發現失敗 |

---

## 3. Node 版本要求

### 3.1 閘門邏輯

`/app/runtime/check-node-version.cjs` 的**原文邏輯**：

```js
const SUPPORTED_NODE_RANGE = '^24.22.1 || >=26.12.1';

function isSupportedNodeVersion(version) {
  const [major, minor, patch] = parseNodeVersion(version);
  if (major === 24) return minor > 22 || (minor === 22 && patch >= 1);
  if (major === 26) return minor > 12 || (minor === 12 && patch >= 1);
  return major > 26;
}
```

`package.json` 的 `engines`：

```json
{ "node": "^24.22.1 || >=26.12.1", "pnpm": "11.25.0" }
```

**語意展開**：

| Node 主版本 | 要求 | 說明 |
|---|---|---|
| 24 | `>= 24.22.1` | 24.22.0 及以下 ❌ |
| **25** | ❌ **不支援** | 落在 `^24` 和 `>=26.12.1` 之外 |
| 26 | `>= 26.12.1` | |
| > 26 | ✅ 放行 | |
| < 24 | ❌ | |

> ⚠️ **注意 Node 25 是個空洞** —— 它既不滿足 `^24.22.1` 也不滿足 `>=26.12.1`。

### 3.2 實測

```
容器内实测：v24.22.2   ✅ 通过
```

### 3.3 為什麼不能隨便換 Node 版本

| 原因 | 說明 |
|---|---|
| **N-API 版本限制** | `@appthreat/sqlite3` 要求 Node ≥24 且 **NAPI ≥10** |
| **閘門會攔** | 不滿足時 `check-node-version.cjs` 直接 `exitCode = 1` |

> **改 Node 版本 → 改 `check-node-version.cjs`**（🟢 低難度），但要先確認 N-API 相容性。

---

## 4. 相依清單

### 4.1 執行環境相依：15 個內聯第三方套件

產物是**自包含單檔**，`package.json` 明確寫
*"There are intentionally NO runtime npm dependencies; production artifacts are self-contained"*。

版本號**直接從 `.pnpm` region 路徑讀出**（如 `hono@4.13.13`）—— 這是**權威值**。

| 套件名 | **精確版本** | 歸屬套件 | 用途 |
|---|---|---|---|
| `hono` | **`4.13.13`** | core, protocol, onebot | HTTP 框架（WebUI 後端） |
| `@hono/node-server` | **`2.1.5`** | core | Hono 的 Node 配接 |
| `otpauth` | **`9.5.1`** | core | WebUI 登入 TOTP |
| `tar` | **`7.5.22`** | core | update 解包 |
| `fflate` | **`0.8.3`** | core | zlib 壓縮（update） |
| `semver` | **`7.7.4`** | core, common | 版本比較 |
| `@zxcvbn-ts/core` | **`4.1.2`** | core | 密碼強度（WebUI） |
| `@zxcvbn-ts/language-common` | **`4.1.3`** | core | zxcvbn 詞典 |
| `@zxcvbn-ts/dictionary-compression` | **`3.0.1`** | core | zxcvbn 詞典壓縮 |
| `fastest-levenshtein` | **`1.0.16`** | core | 字串距離 |
| `htmlparser2` | **`10.0.0`** | protocol | HTML 解析（訊息元素） |
| `entities` | **`6.0.1`** | protocol | 實體編解碼 |
| `domhandler` | **`5.0.3`** | protocol | htmlparser2 相依 |
| `domutils` | **`3.2.2`** | protocol | htmlparser2 相依 |
| `domelementtype` | **`2.3.0`** | protocol | htmlparser2 相依 |

**全部可公開取得，無私有套件、無需驗證。** 實測：

```bash
npm config set registry https://mirrors.tencentyun.com/npm
npm install
# → added 29 packages in 15s  ✅
```

### 4.2 ⚠️ ★ 版本必須精確鎖定 —— 不要用 `^`

**這是一次真實的踩雷**：用 caret 範圍（`^4.13.13`）裝了一遍，
npm 解析出的版本**與 bundle 內的不一致** —— **6 個套件發生漂移**：

| 套件 | bundle 內 | `^` 會裝到 | 判定 |
|---|---|---|---|
| `hono` | `4.13.13` | **`4.13.18`** | ❌ 漂移 |
| `@hono/node-server` | `2.1.5` | **`2.1.8`** | ❌ 漂移 |
| `otpauth` | `9.5.1` | **`9.6.0`** | ❌ 漂移 |
| `tar` | `7.5.22` | **`7.5.23`** | ❌ 漂移 |
| `@zxcvbn-ts/core` | `4.1.2` | **`4.2.0`** | ❌ 漂移 |
| `semver` | `7.7.4` | **`7.8.6`** | ❌ 漂移 |
| `htmlparser2` | `10.0.0` | **`10.1.0`** | ❌ 漂移 |
| `fflate` | `0.8.3` | `0.8.3` | ✅ |
| `@zxcvbn-ts/language-common` | `4.1.3` | `4.1.3` | ✅ |
| `@zxcvbn-ts/dictionary-compression` | `3.0.1` | `3.0.1` | ✅ |
| `fastest-levenshtein` | `1.0.16` | `1.0.16` | ✅ |
| `entities` | `6.0.1` | `6.0.1` | ✅ |

> **規則：寫 `"hono": "4.13.13"`，不要寫 `"hono": "^4.13.13"`。**
> 否則重建產物的行為可能與線上不一致。

> ⚠️ **還原工程目前的 `package.json` 裡用的仍是 `^`** ——
> 這是已知待修項，見 [contributing.md](../dev/contributing.md)。

### 4.3 建置期相依

| 套件 | 版本要求 | 說明 |
|---|---|---|
| `typescript` | `5.9.x`（原為 `catalog:`，還原時寫死） | 型別檢查 |
| `rolldown` | **`≤ 1.1.8`** | 只有這個區間會輸出 `//#region`（見 §4.4） |
| `pnpm` | `11.25.0` | workspace 管理 |

**建置期可選工具**（原工程有，未還原）：`eslint` / `prettier` / `vitest` 全家桶。

### 4.4 rolldown 版本矩陣

| rolldown | 輸出 region 註解格式 | 能否用 |
|---|---|---|
| `1.0.0` | `//#region <path>` | ✅ |
| `1.1.0` / `1.1.4` / `1.1.8` | `//#region <path>` | ✅ **推薦 1.1.8** |
| `1.2.16` | `// <path>`（無 `#region`） | ❌ 格式已變 |
| `1.3.2` | `// <path>` | ❌ 且 `inlineDynamicImports` 已棄用 |

> **原工程用的 rolldown 版本無法精確確定**（bundle 裡沒有版本戳），只能收斂到 **`≤1.1.8`**。

### 4.5 native 外掛相依矩陣

bundle 只是**載入器**，真正的二進位不在裡面。執行環境按平台-架構拼檔名去找：

| 用途 | 檔名模式 | 查找位置 | 介面契約 |
|---|---|---|---|
| **Hook 注入 + hook 後端** | `snowluma-{platform}-{arch}.node`<br>`snowluma-{platform}-{arch}.so` | `<moduleDir>/native`<br>`<moduleDir>/../../runtime/native` | 6 個匯出函式（見 architecture.md §4.3） |
| WebSocket 加速 | `websocket-{platform}-{arch}.node` | 同上 | 第三方（`ws` 的 optional addon）；可用 `SNOWLUMA_DEV_NO_NATIVE=1` stub 掉 |
| SQLite 驅動 | `@appthreat+sqlite3.{glibc,musl}.node` | `native/sqlite/prebuilds/{platform}-{arch}/` | **`NATIVE_INTERFACE_VERSION === 1`** + `Database` / `Statement` / `OPEN_READONLY=1` / `OPEN_READWRITE=2` / `OPEN_CREATE=4` / `OPEN_FULLMUTEX=65536` |
| 語音轉碼 | `ffmpegAddon.{platform}.{arch}.node` | `native/ffmpeg/` | 3 個方法：`convertToNTSilkTct` / `decodeAudioToFmt` / `getDuration` |
| QQ 帳號庫解密 | `wrapper.node` / `wrapper.linux.node` | QQ 安裝目錄 | 唯讀定位，不解密（`sqlcipher.ts` 自己實作解密） |

**路徑解析邏輯**（`packages/common/src/native-path.ts`）：

```js
function resolveRuntimeNativePath(fileName) {
  for (const directory of [
    path.join(moduleDir, "native"),
    path.resolve(moduleDir, "..", "..", "runtime", "native"),
  ]) {
    const candidate = path.join(directory, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
```

**SQLite 的 libc 選擇**：按執行環境 libc 選 `glibc` 或 `musl` prebuild
（`runtimeLibc()`），並用 `assertBinding()` 校驗介面版本 ——
**替換 SQLite 版本時必須保持這個介面不變**。

> **`vendor-regions/`（99 個檔案）僅作比對參考** —— 它們是**已被 rolldown 扁平化後**的形態，
> 不是乾淨的上游 ESM 原始碼。正確做法是 `npm install` 拉真實套件。

---

## 5. 容器執行環境要求

### 5.1 ★ 必需的核心能力（缺了啟動失敗）

```bash
docker run \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  ...
```

| 參數 | 為什麼必需 | 缺了的表現 |
|---|---|---|
| `--cap-add SYS_PTRACE` | 注入器要 `ptrace` 附加到 QQ 行程 | **注入失敗**（hook 靜默不生效） |
| `--security-opt seccomp=unconfined` | 預設 seccomp 白名單會攔 `ptrace` / `process_vm_*` | **`ExitCode=126`** + `/usr/local/bin/node: Operation not permitted` |

**生產實例實測確認**：

```
HostConfig.CapAdd        ["CAP_SYS_PTRACE"]
HostConfig.SecurityOpt   ["seccomp=unconfined"]
```

> **這是最常見的一次性啟動失敗原因。** 症狀是容器立刻退出、退出碼 126 ——
> 詳情見 [troubleshooting.md](troubleshooting.md) 的 T5。

### 5.2 連接埠對應（生產實例）

```
3000/tcp -> 0.0.0.0:3010    (OneBot HTTP)
3001/tcp -> 0.0.0.0:3011    (OneBot WS)
5099/tcp -> 0.0.0.0:5199    (WebUI)
6081/tcp -> 0.0.0.0:6181    (noVNC)
```

### 5.3 環境變數（生產實例實測）

```
NODE_VERSION=24.22.2              TZ=Asia/Shanghai
SNOWLUMA_ONEBOT_HOST=0.0.0.0      SNOWLUMA_HOME=/app/runtime
SNOWLUMA_DATA=/app/data           SNOWLUMA_WEBUI_PORT=5099
SNOWLUMA_UID=1000                 SNOWLUMA_GID=1000
SNOWLUMA_LOG_LEVEL=info           SNOWLUMA_SCREEN=1920x1080x24
SNOWLUMA_HOOK_AUTOLOAD=1          SNOWLUMA_EXTRA_QQ_HOMES=
SNOWLUMA_QQ_FLAGS=--disable-gpu --disable-software-rasterizer --disable-gpu-compositing
DISPLAY=:1
```

> 完整的 36 個 `SNOWLUMA_*` 環境變數清單見 [troubleshooting.md](troubleshooting.md) 附錄。

### 5.4 卷掛載（生產實例）

```
/app/data            ← 持久化：配置、数据库、日志（必须持久化！）
/app/.config         ← QQ 配置（含登录态 —— 重启容器会清空，见 T2）
/app/.local/share    ← QQ 数据
/app/runtime/index.mjs  ← bind mount 覆盖 bundle（部署改动用）
```

> ⚠️ **`/app/.config` 裡存的是 QQ 登入狀態**。它不是「只是設定」——
> **QQ 行程重新啟動就會清空 `loginList`，必須重新掃碼。** 詳見
> [troubleshooting.md](troubleshooting.md) 的 T2（**血的教訓**）。

---

## 6. 設定檔的版本耦合

| 檔案 | 權限 | 內容 | 換版本會失效嗎 |
|---|---|---|---|
| `runtime.json` | 644 | `webuiPort` / `hookAutoLoad` / `webuiHost` / `webuiTls` / `trustProxy` / 日誌輪替 | 否（結構穩定） |
| `onebot.json` | 644 | **全域** OneBot 網路設定 | 否 |
| `onebot_<uin>.json` | 600 | **每帳號**設定（`mode: "snapshot"`）+ `statusCommand` / `historySync` / `notifications` | 否 |
| `webui.json` | 600 | `passwordHash` / `passwordSalt`（scrypt）/ `mustChangePassword` | 否 |
| `ui.json` | 644 | WebUI 外觀與佈局 | 否 |
| `consent.json` | 644 | `{ version, acceptedAt }` | ⚠️ **EULA/PRIVACY 更新會使 `version` 變化 → 再次要求同意** |
| `machine-id` | 644 | 32 位十六進位機器標識 | 否 |
| `notifications.json` | 600 | `{ version: 1, debounceSeconds, channels }` | 否 |
| `vnc-password` | 600 root | noVNC 密碼（**與 Haizakura 邏輯無關**） | 否 |

**資料庫**（按帳號分目錄 `/app/data/data/<uin>/`）：

| 檔案 | 歸屬 | 內容 |
|---|---|---|
| `messages.db` | `onebot/message-store.ts` | 訊息歷史 / 媒體索引 / 遷移狀態 |
| `reactions.db` | `onebot/reaction-store.ts` | 貼表情記錄 |
| `snowluma_identity.db` | `bridge/apis/contacts.ts` | 使用者/群/群成員身分對應 |
| `sys-face-catalog.json` | `core/sys-face-catalog.ts` | 系統表情目錄快取（在 `/app/data/data/` 根） |

> **schema 有版本化遷移**（`classification_version` 配合 `CLASSIFICATION_VERSION`，
> 用 `PRAGMA table_info` 逐欄判斷後 `ALTER TABLE`）。
> **改表結構務必寫遷移**，參考現有 `prepare*Schema()` 模式。

**批次部署時的 EULA 自動化**：

```bash
SNOWLUMA_ACCEPT_EULA=1
SNOWLUMA_ACCEPT_PRIVACY=1
```

---

## 7. QQ 版本耦合風險

### 7.1 為什麼強耦合

**hook 相依 `wrapper.node` 的四個內部特徵**：

```
① C++ RTTI 类名（mangled，如 "N2nt10MSFServiceE"）
② vtable 槽位顺序（如 SessionInit 在 v[pos] ap+0x98）
③ 结构体字段偏移（如 msfCoreCallbackOffset）
④ 用于定位的锚点字符串（如 "MSFService::SessionInit"）
```

**這四項任一變化，hook 就失效。** 而失敗資訊只會說 `unresolved`，拿不到更多細節。

### 7.2 ★ 適配新 QQ 版本難度矩陣

前提：**你保留了 Haizakura 的 `.node`（含 `RuntimeTargets` 常數）與 `.so`（通用引擎）。**
工作量以**一個人、熟悉本流程**估算。

| # | 騰訊的改動 | 會壞在哪 | 需要改什麼 | 工作量 | 要重寫 native 嗎 |
|---|---|---|---|---|---|
| **0** | **不發布新版本**（同 build） | — | 什麼都不用 | **0** | 否 |
| **1** | **只改函式內部實作**（類名/vtable 佈局/槽位順序都不變） | **什麼都不壞**（RTTI 解析按名字+偏移找，不看實作） | **0 改動** | **0** | **否** |
| **2** | **改了類名**（`nt::MSFService` → `nt::MSFServiceV2`） | `.node` 裡 typeinfo 名匹配不到 → `MSFService SessionInit/RTTI chain unresolved` | 改 `.node` 裡的 typeinfo 名/片段常數（**字串級**） | **2–6 小時** | **否** |
| **3** | **改了 vtable 槽位順序**（中間插入/刪除虛擬函式） | 槽位偏移全錯 → 換錯函式指標 → **崩潰或靜默失效**（最危險） | 用「字串→xref→槽位」指令碼**重算全部槽位偏移**，更新 `msfCoreCallbackOffset` 等 | **0.5–2 天** | **否**（改設定數字） |
| **4** | **加了新虛擬函式、追加在末尾** | primary vtable `offset_to_top` 仍為 0，前面槽位不變 | **通常 0 改動**（只要目標函式仍在原槽位） | **小時級驗證** | 否 |
| **5** | **給 MSFService 加了多繼承/虛基類**（→ `__vmi_class_type_info`） | `.so` 只匯入 `__cxxabiv117` 和 `120`，**不認 121** → 解析直接失敗 | **必須改 `.so` 支援 `__vmi_class_type_info` 佈局** | **3–7 天** | **是** |
| **6** | **換了 `.rodata` 佈局 / 刪了 `"Xxx::SessionInit"` 錨點串** | 靠字串錨點定位的路徑全斷 | 為每個目標重新找**新的穩定錨點**（新日誌串、`what()` 串、或 `.eh_frame` 結構） | **數天–2 週** | **是**（很可能） |
| **7** | **`wrapper.node` 被 strip**（去掉 `.shstrtab` / 節表） | `.so` 按**節名**解析節表 → `ELF section table is missing` | 改為按**程式標頭**（`PT_LOAD`/`PT_DYNAMIC`）+ 硬編碼節佈局 | **2–5 天** | **是** |
| **8** | **換了 ABI/編譯器**（mangled 名規則變） | 名字匹配全斷 | 改匹配規則（SnowLuma 已有 `NSt2Cr` = `std::__cxx11` 變體特徵） | **1–3 天** | 半是 |
| **9** | **換新架構 / 加殼** | 全斷 | 重做 | **週級** | 是 |
| **10** | **QQ 改了注入方式**（沙箱、`/proc` 權限、`process_vm_readv` 被攔） | `QQ runtime cannot read process memory` / `[RUNTIME_MEMORY_UNAVAILABLE]` | 改用 `ptrace(PTRACE_PEEKDATA)` 或 `/proc/pid/mem` | **2–4 天** | 是 |

### 7.3 結論（一句話）

> **只要騰訊不動「類名 + 繼承結構 + vtable 槽位順序」，適配成本 = 0~1 天，
> 而且只改字串/數字設定，不用碰 native 程式碼。**
>
> **一旦 vtable 形狀變了（多繼承/虛基類），就必須重寫 native 解析器。**

### 7.4 戰術建議：把「適配」變成「跑指令碼」

因為「錨點串 → xref site → 槽位」的方法**完全機械化**
（詳見 [architecture.md §6.4](architecture.md)），**適配工作應該變成跑一條指令 + 看 diff**：

```bash
# ① 收集新版本的语言指纹
md5sum wrapper.node
readelf -n wrapper.node | grep -A2 'Build ID'
stat -c '%s %n' wrapper.node

# ② 跑离线解析器，与基线 diff
python3 tools/dump-vtable.py --wrapper wrapper.node --class 'nt::MSFService'
python3 tools/dump-vtable.py --wrapper wrapper.node --dump-all > new.json
python3 tools/dump-vtable.py --wrapper wrapper.node --diff tools/baseline-vtable.json
```

**判讀 diff 結果**：

| diff 現象 | 對應情況 | 該做什麼 |
|---|---|---|
| 只有函式位址變，方法名 + 槽位不變 | 情況 1 | **0 改動**，直接跑 |
| 方法名還在但槽位變了 | 情況 3 | 改 `.node` 的數字 |
| 方法名都沒了 | 情況 2 / 6 | 改 `.node` 字串 / 重找錨點 |
| 出現 `__vmi_class_type_info` | 情況 5 | **必須改 `.so`** |

> **自研 `.so` 的完整工作量約 20–36 人日（1–1.5 人月）**，
> 但**只做「離線解析器 + 適配指令碼」只需 5–10 人日**，就能涵蓋**最可能發生的**情況 2/3/4。
> **不要一上來重寫 `.so`。** 詳見 [contributing.md](../dev/contributing.md)。

### 7.5 ⚠️ 適配後必須做端對端驗證

**VTable 替換是最脆弱的 hook 形式。槽位錯一位不會立刻崩**，
而是**把訊息發到錯誤的路徑上** —— 表現為使用者可見的：

```
"The QQ connection changed. Please restart QQ and try again."
```

> **不能只看「行程沒崩」就認為適配成功。**
> **每次適配後必須做真實收發訊息的端對端驗證。**

---

## 8. 版本升級檢查清單

```bash
# ═══ 升级前：归档当前"已知可用"基线 ═══
docker cp <容器>:/app/runtime /backup/runtime-$(date +%F)
sha256sum /backup/runtime-*/native/*.so /backup/runtime-*/native/*.node   # ★ 必须
docker exec <容器> sh -c 'grep -m1 version /opt/QQ/resources/app/package.json'
md5sum wrapper.node ; readelf -n wrapper.node | grep 'Build ID'

# ═══ 升级后：逐项核对 ═══
# ① 版本指纹
md5sum wrapper.node                      # 变了 → 读 §7.2 难度矩阵
readelf -n wrapper.node | grep 'Build ID'

# ② RTTI 结构
python3 tools/dump-vtable.py --wrapper wrapper.node --class 'nt::MSFService'
python3 tools/dump-vtable.py --wrapper wrapper.node --diff tools/baseline-vtable.json

# ③ 运行期 hook 健康度（0 = 健康）
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'
docker exec <容器> sh -c 'grep -oE "hook_autoload_terminal[^\"]*" \
  /app/data/logs/$(date +%F).log | sort -u'

# ④ 端到端：真的发一条消息、真的收一条消息（★ 不可省）
```

> **完整 12 條 RTTI 失敗串 → 槽位對照表**見 [troubleshooting.md](troubleshooting.md) T4。

---

## 9. 已知的相容性風險

| # | 風險 | 嚴重度 | 緩解 |
|---|---|---|---|
| 1 | **`wrapper.node` 結構變更導致 hook 全失效** | 🔴 致命 | 釘死 QQ 版本；監控日誌 `unresolved`；準備「降級為純通知」方案 |
| 2 | **native 層無原始碼，無法修 bug** | 🔴 高 | ①完整備份目前可用的二進位（sha256）②容器外歸檔 ③不要輕易升級 |
| 3 | **自動更新指向已刪除的儲存庫 ⇒ 必然 404** | 🟠 中 | 改 `update/sources.ts`，或用 `SNOWLUMA_UPDATE_CHECK` 關閉 |
| 4 | **`webuiHost: 0.0.0.0` + 明文 HTTP（TLS 關閉）** | 🟠 中 | 改 `127.0.0.1` + 反代，或啟用 TLS（`webui/tls.ts` 已就緒） |
| 5 | **`/api/debug/invoke` 等於遠端任意動作執行** | 🟠 中 | 曝露公網時務必啟用 TOTP + 強密碼；考慮 IP 白名單 |
| 6 | **`onebot.json` 裡 `accessToken` 明文（644 權限）** | 🟠 中 | token 改強隨機；權限收緊到 600 |
| 7 | **`sqlcipher.ts` 相依 QQ 的庫格式** | 🟠 中 | 已做**12 種組合探測**，韌性不錯；QQ 改格式需跟改 |
| 8 | **無退避/無熔斷**，1.5 s 固定 tick | 🟡 低-中 | 保持 `AUTO_LOAD_MAX_ATTEMPTS=3`；改進時注意別拖慢恢復 |
| 9 | **執行緒名 `snowluma-pipe-w` 直接曝露** | 🟡 低 | **native 層，改不了** —— 只能接受 |
| 10 | **EULA/PRIVACY 更新會再次要求同意** | 🟡 低 | 批次部署用 `SNOWLUMA_ACCEPT_EULA` / `_PRIVACY` |
| 11 | **單點：一個 runtime 行程服務所有帳號** | 🟡 低 | 已是多 PID 設計（`Map<pid, HookSession>`），問題不大 |
| 12 | **日誌 ~11 MB/天**，`logRetainDays=7` ⇒ 約 80 MB 常駐 | 🟢 低 | 已自動輪替，注意磁碟 |
| 13 | **`.so` strip 後無法做符號級偵錯** | 🟡 低-中 | 靠 `dynsym` + 字串 + 反組譯 |

---

## 10. 相關文件

| 想了解 | 去看 |
|---|---|
| 它到底怎麼工作的 | [architecture.md](architecture.md) |
| 出問題怎麼排查 | [troubleshooting.md](troubleshooting.md) |
| 怎麼從原始碼建置 | [build.md](../dev/build.md) |
| 怎麼參與開發 | [contributing.md](../dev/contributing.md) |

---

*基線與指紋：2026-11-12。所有版本號均為實測值（來自 `.pnpm` region 路徑與容器內檔案）。
接手前請核對 md5。*
