# 兼容性矩陣

> [!WARNING]
> 本内容完全由 AI 編写、請慎重閲覧也。

> **面向読者**：準備配備或昇級 Haizakura（原名 SnowLuma）之運維、以及要適配新 QQ 版本之維護者也。
> **本文回答**：它能跑於何環境之上？依存哪些精確版本？QQ 昇級後如何、要改什麼？
> **最重要之一条**：**QQ 版本必須釘死、勿自動昇級也。** 理由見 §7。

---

## 0. 快速自検

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

任何一項不符 → 去看相当之章節。

---

## 1. 版本基準（接手必記）

**此者一切偏移之参照系也。** 一切地址、槽位、結構布局皆基於此一組指紋也。

### 1.1 核心版本

| 項目 | 値 |
|---|---|
| **QQ 版本** | `3.2.32-52194`（Linux arm64） |
| `wrapper.node` 大小 | **144,561,472** 字節 |
| `wrapper.node` md5 | **`adeb40af26d859d41fcdb21bf38d9eb5`** |
| `wrapper.node` build-id | **`89c36b520f97c88081a9453bd6abb70c3452f156`** |
| SnowLuma / Haizakura runtime | **2.4.0** |
| hook stub 自述版本 | `snowluma-linux-hook-stub/0.2.0` |
| Node | **24.22.2** |
| 容器映像 | `motricseven7/snowluma:latest`（2.69 GB，arm64） |

### 1.2 native 産物 sha256

```bash
cf8183755e7b912149c045f93bd6010feeeaa170fff0580d7013d62b6347da00  snowluma-linux-arm64.node
238ff3c348d98a42e49662f58fbd4404f89b9a65a7fc6e56c1775e2740d3f13e  snowluma-linux-arm64.so
b705b7e2392a75cdde95a146f933a7d472b4c72709f35f707a0798f9fcdf9e19  websocket-linux-arm64.node
```

> ⚠️ **`wrapper.node` 之 build-id 者、跨版本区別之唯一可靠指紋也。**
> 其較文件大小更準（大小会変）、較 md5 更適運行時検証（md5 要読全 144 MB、
> build-id 僅読 `0x200` 処 36 字節也）。
> `89c36b52…` **正是 `.so` 内 `missing or ambiguous GNU build ID` 検証之該値也**。

### 1.3 wrapper.node 之關鍵節地址

```
[12] .text           PROGBITS  083d780   83d780   5e1ff10
[15] .rodata         PROGBITS  665d900   665d900   994a46    ← vaddr == file off ✅
[23] .data.rel.ro    PROGBITS  86acb60   869cb60   32e5a8    ← vaddr ≠ file off ⚠️
[24] .dynamic        DYNAMIC   89db108   89cb108   2c0

.note.gnu.build-id   @ vaddr 0x200 / file 0x200，段大小 0x24
                     NT_GNU_BUILD_ID 描述符 0x14 (20) 字节

Δ = .data.rel.ro 的 (vaddr − file_off) = 0x10000
```

> **Δ 自身不固定、換版本即変** —— 必須自節表算、不可硬編碼也。詳見
> [architecture.md §6.3](architecture.md)。

### 1.4 基準中之關鍵結構

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

## 2. 支持之平台

### 2.1 僅 Linux arm64

| 平台 | 支持状態 | 説明 |
|---|---|---|
| **Linux arm64 (aarch64)** | ✅ **唯一有建構産物之平台** | 全 5 個 native 産物皆 arm64 |
| Linux x86_64 | ❌ | 実測報錯：`No hook native addon found for linux-x64` |
| Windows | ⚠️ 有程式碼路径、**無産物** | 走命名管道 + `getFileHoldersAsync`；需 DLL、未発布 |
| macOS | ⚠️ 有程式碼路径、**無産物** | 走 `DYLD_INSERT_LIBRARIES`；需 dylib、未発布 |

**換架構需要全 5 個 native 産物** —— 此者極高工作量之操作也、**不推薦**。

### 2.2 Linux arm64 之実測環境

```
架构        aarch64
发行版      Debian GNU/Linux 12 (bookworm)（容器内）
Electron    40.0.0（QQ 自带）
X 显示      Xvfb :1 -screen 0 1920x1080x24
窗口管理    fluxbox
VNC         x11vnc + noVNC（6081 端口，扫码登录用）
```

### 2.3 必要之 Linux 内核能力

| 能力 | 為何需要 | 缺之則如何 |
|---|---|---|
| `ptrace` | 注入器附加至 QQ 工程 | 注入失敗 |
| `process_vm_readv` / `process_vm_writev` | 読写目標工程記憶 | 報 `QQ runtime cannot read process memory` |
| `/proc/<pid>/maps` 可読 | 找 `wrapper.node` 之載入基址 | 報 `module not found in target process maps` |
| `/proc/<pid>/environ` 可読 | 跨工程読 `SNOWLUMA_HOOK_RUNTIME_DIR` | **同 uid 可行、跨 uid 則失敗** 【未査清】 |
| `/proc/locks` 可読 | 定位帳号資料庫持有者（不需 root） | 帳号発見失敗 |

---

## 3. Node 版本要件

### 3.1 閘門邏輯

`/app/runtime/check-node-version.cjs` 之**原文邏輯**：

```js
const SUPPORTED_NODE_RANGE = '^24.22.1 || >=26.12.1';

function isSupportedNodeVersion(version) {
  const [major, minor, patch] = parseNodeVersion(version);
  if (major === 24) return minor > 22 || (minor === 22 && patch >= 1);
  if (major === 26) return minor > 12 || (minor === 12 && patch >= 1);
  return major > 26;
}
```

`package.json` 之 `engines`：

```json
{ "node": "^24.22.1 || >=26.12.1", "pnpm": "11.25.0" }
```

**語義展開**：

| Node 主版本 | 要求 | 説明 |
|---|---|---|
| 24 | `>= 24.22.1` | 24.22.0 及以下 ❌ |
| **25** | ❌ **非支持** | 落於 `^24` 与 `>=26.12.1` 之外 |
| 26 | `>= 26.12.1` | |
| > 26 | ✅ 放行 | |
| < 24 | ❌ | |

> ⚠️ **注意 Node 25 者空洞也** —— 其既不滿足 `^24.22.1` 亦不滿足 `>=26.12.1`。

### 3.2 実測

```
容器内实测：v24.22.2   ✅ 通过
```

### 3.3 為何不可随意換 Node 版本

| 原因 | 説明 |
|---|---|
| **N-API 版本約束** | `@appthreat/sqlite3` 要求 Node ≥24 且 **NAPI ≥10** |
| **閘門会攔** | 不滿足時 `check-node-version.cjs` 直接 `exitCode = 1` |

> **改 Node 版本 → 改 `check-node-version.cjs`**（🟢 低難度）、但須先確認 N-API 兼容性也。

---

## 4. 依存清単

### 4.1 運行時依存：15 個内聯第三方包

産物者**自包含単文件**也、`package.json` 明写
*"There are intentionally NO runtime npm dependencies; production artifacts are self-contained"*。

版本号**直接自 `.pnpm` region 路径読出**（如 `hono@4.13.13`）—— 此者**権威値也**。

| 包名 | **精確版本** | 帰属包 | 用途 |
|---|---|---|---|
| `hono` | **`4.13.13`** | core, protocol, onebot | HTTP 框架（WebUI 後端） |
| `@hono/node-server` | **`2.1.5`** | core | Hono 之 Node 適配 |
| `otpauth` | **`9.5.1`** | core | WebUI 登録 TOTP |
| `tar` | **`7.5.22`** | core | update 解包 |
| `fflate` | **`0.8.3`** | core | zlib 圧縮（update） |
| `semver` | **`7.7.4`** | core, common | 版本比較 |
| `@zxcvbn-ts/core` | **`4.1.2`** | core | 密碼強度（WebUI） |
| `@zxcvbn-ts/language-common` | **`4.1.3`** | core | zxcvbn 詞典 |
| `@zxcvbn-ts/dictionary-compression` | **`3.0.1`** | core | zxcvbn 詞典圧縮 |
| `fastest-levenshtein` | **`1.0.16`** | core | 字符串距離 |
| `htmlparser2` | **`10.0.0`** | protocol | HTML 解析（消息元素） |
| `entities` | **`6.0.1`** | protocol | 実体編解碼 |
| `domhandler` | **`5.0.3`** | protocol | htmlparser2 依存 |
| `domutils` | **`3.2.2`** | protocol | htmlparser2 依存 |
| `domelementtype` | **`2.3.0`** | protocol | htmlparser2 依存 |

**全部公開可取、無私有包、無需鑑権也。** 実測：

```bash
npm config set registry https://mirrors.tencentyun.com/npm
npm install
# → added 29 packages in 15s  ✅
```

### 4.2 ⚠️ ★ 版本必須精確鎖定 —— 勿用 `^`

**此者一次真実之踩坑也**：用 caret 範囲（`^4.13.13`）装了一回、
npm 解析之版本**与 bundle 内不一致** —— **6 個包発生漂移**：

| 包 | bundle 内 | `^` 会装到 | 判定 |
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

> **規則：写 `"hono": "4.13.13"`、勿写 `"hono": "^4.13.13"` 也。**
> 否則重建産物之挙動可能与線上不一致也。

> ⚠️ **還原工程当前之 `package.json` 中仍用 `^`** ——
> 此者既知待修項也、見 [contributing.md](../dev/contributing.md)。

### 4.3 建構期依存

| 包 | 版本要求 | 説明 |
|---|---|---|
| `typescript` | `5.9.x`（原為 `catalog:`、還原時写死） | 型検査 |
| `rolldown` | **`≤ 1.1.8`** | 僅此区間会出力 `//#region`（見 §4.4） |
| `pnpm` | `11.25.0` | workspace 管理 |

**建構期任意工具**（原工程有、未還原）：`eslint` / `prettier` / `vitest` 全家桶。

### 4.4 rolldown 版本矩陣

| rolldown | 出力 region 評論格式 | 能否用 |
|---|---|---|
| `1.0.0` | `//#region <path>` | ✅ |
| `1.1.0` / `1.1.4` / `1.1.8` | `//#region <path>` | ✅ **推薦 1.1.8** |
| `1.2.16` | `// <path>`（無 `#region`） | ❌ 格式既変 |
| `1.3.2` | `// <path>` | ❌ 且 `inlineDynamicImports` 既廃棄 |

> **原工程用之 rolldown 版本無法精確確定**（bundle 中無版本戳）、只能収斂至 **`≤1.1.8`** 也。

### 4.5 native 插件依存矩陣

bundle 者僅**載入器**也、真正之二進制不在其内。運行時依平台-架構拼文件名去找：

| 用途 | 文件名模式 | 探索位置 | 接口契約 |
|---|---|---|---|
| **Hook 注入 + hook 後端** | `snowluma-{platform}-{arch}.node`<br>`snowluma-{platform}-{arch}.so` | `<moduleDir>/native`<br>`<moduleDir>/../../runtime/native` | 6 個輸出関数（見 architecture.md §4.3） |
| WebSocket 加速 | `websocket-{platform}-{arch}.node` | 同上 | 第三方（`ws` 之 optional addon）；可用 `SNOWLUMA_DEV_NO_NATIVE=1` stub 之 |
| SQLite 驅動 | `@appthreat+sqlite3.{glibc,musl}.node` | `native/sqlite/prebuilds/{platform}-{arch}/` | **`NATIVE_INTERFACE_VERSION === 1`** + `Database` / `Statement` / `OPEN_READONLY=1` / `OPEN_READWRITE=2` / `OPEN_CREATE=4` / `OPEN_FULLMUTEX=65536` |
| 音声転碼 | `ffmpegAddon.{platform}.{arch}.node` | `native/ffmpeg/` | 3 個方法：`convertToNTSilkTct` / `decodeAudioToFmt` / `getDuration` |
| QQ 帳号庫解密 | `wrapper.node` / `wrapper.linux.node` | QQ 安裝目録 | 只読定位、不解密（`sqlcipher.ts` 自己実装解密） |

**路径解析邏輯**（`packages/common/src/native-path.ts`）：

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

**SQLite 之 libc 選択**：依運行時 libc 選 `glibc` 或 `musl` prebuild
（`runtimeLibc()`）、且用 `assertBinding()` 検証接口版本 ——
**替換 SQLite 版本時必須保持此接口不変也**。

> **`vendor-regions/`（99 個文件）僅作対比参考** —— 其者**既経 rolldown 扁平化後**之形態也、
> 非清浄之上流 ESM 源碼。正確做法者 `npm install` 拉真実包也。

---

## 5. 容器運行時要求

### 5.1 ★ 必需之内核能力（缺之則起動失敗）

```bash
docker run \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  ...
```

| 参數 | 為何必需 | 缺之之表現 |
|---|---|---|
| `--cap-add SYS_PTRACE` | 注入器要 `ptrace` 附加至 QQ 工程 | **注入失敗**（hook 静黙不生效） |
| `--security-opt seccomp=unconfined` | 既定 seccomp 白名単会攔 `ptrace` / `process_vm_*` | **`ExitCode=126`** + `/usr/local/bin/node: Operation not permitted` |

**生産実例実測確認**：

```
HostConfig.CapAdd        ["CAP_SYS_PTRACE"]
HostConfig.SecurityOpt   ["seccomp=unconfined"]
```

> **此者最常見之一次性起動失敗原因也。** 症状者容器即刻退出、退出碼 126 ——
> 詳見 [troubleshooting.md](troubleshooting.md) 之 T5。

### 5.2 端口映射（生産実例）

```
3000/tcp -> 0.0.0.0:3010    (OneBot HTTP)
3001/tcp -> 0.0.0.0:3011    (OneBot WS)
5099/tcp -> 0.0.0.0:5199    (WebUI)
6081/tcp -> 0.0.0.0:6181    (noVNC)
```

### 5.3 環境変数（生産実例実測）

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

> 完整之 36 個 `SNOWLUMA_*` 環境変数清単見 [troubleshooting.md](troubleshooting.md) 附録。

### 5.4 巻掛載（生産実例）

```
/app/data            ← 持久化：配置、数据库、日志（必须持久化！）
/app/.config         ← QQ 配置（含登录态 —— 重启容器会清空，见 T2）
/app/.local/share    ← QQ 数据
/app/runtime/index.mjs  ← bind mount 覆盖 bundle（部署改动用）
```

> ⚠️ **`/app/.config` 中存者 QQ 登録態也。** 其非「僅設定」 ——
> **QQ 工程再起動則清空 `loginList`、必須再度扫码也。** 詳見
> [troubleshooting.md](troubleshooting.md) 之 T2（**血之教訓**）。

---

## 6. 設定文件之版本耦合

| 文件 | 権限 | 内容 | 換版本会失効否 |
|---|---|---|---|
| `runtime.json` | 644 | `webuiPort` / `hookAutoLoad` / `webuiHost` / `webuiTls` / `trustProxy` / 記録輪転 | 否（結構安定） |
| `onebot.json` | 644 | **全域** OneBot 網設定 | 否 |
| `onebot_<uin>.json` | 600 | **毎帳号**設定（`mode: "snapshot"`）+ `statusCommand` / `historySync` / `notifications` | 否 |
| `webui.json` | 600 | `passwordHash` / `passwordSalt`（scrypt）/ `mustChangePassword` | 否 |
| `ui.json` | 644 | WebUI 外観与布局 | 否 |
| `consent.json` | 644 | `{ version, acceptedAt }` | ⚠️ **EULA/PRIVACY 更新会使 `version` 変化 → 再度要求同意** |
| `machine-id` | 644 | 32 位十六進機器標識 | 否 |
| `notifications.json` | 600 | `{ version: 1, debounceSeconds, channels }` | 否 |
| `vnc-password` | 600 root | noVNC 密碼（**与 Haizakura 邏輯無関**） | 否 |

**資料庫**（依帳号分目録 `/app/data/data/<uin>/`）：

| 文件 | 帰属 | 内容 |
|---|---|---|
| `messages.db` | `onebot/message-store.ts` | 消息履歴 / 媒体索引 / 遷移状態 |
| `reactions.db` | `onebot/reaction-store.ts` | 貼表情記録 |
| `snowluma_identity.db` | `bridge/apis/contacts.ts` | 用户/群/群成員身分映射 |
| `sys-face-catalog.json` | `core/sys-face-catalog.ts` | 系統表情目録緩存（在 `/app/data/data/` 根） |

> **schema 有版本化遷移**（`classification_version` 配合 `CLASSIFICATION_VERSION`、
> 用 `PRAGMA table_info` 逐列判断後 `ALTER TABLE`）。
> **改表結構務必写遷移**、参考既存 `prepare*Schema()` 模式也。

**批量配備時之 EULA 自動化**：

```bash
SNOWLUMA_ACCEPT_EULA=1
SNOWLUMA_ACCEPT_PRIVACY=1
```

---

## 7. QQ 版本耦合危険

### 7.1 為何強耦合

**hook 依存 `wrapper.node` 之四個内部特徴**：

```
① C++ RTTI 类名（mangled，如 "N2nt10MSFServiceE"）
② vtable 槽位顺序（如 SessionInit 在 v[pos] ap+0x98）
③ 结构体字段偏移（如 msfCoreCallbackOffset）
④ 用于定位的锚点字符串（如 "MSFService::SessionInit"）
```

**此四項任一変化、hook 即失効也。** 而失敗信息僅言 `unresolved`、不得更多細節也。

### 7.2 ★ 適配新 QQ 版本難度矩陣

前提：**汝保留 Haizakura 之 `.node`（含 `RuntimeTargets` 常量）与 `.so`（汎用引擎）也。**
工作量以**一人、熟悉本流程**估算也。

| # | 騰訊之改動 | 会壊於何処 | 需要改什麼 | 工作量 | 要重写 native 否 |
|---|---|---|---|---|---|
| **0** | **不発布新版本**（同 build） | — | 什麼都不用 | **0** | 否 |
| **1** | **僅改関数内部実装**（類名/vtable 布局/槽位順序皆不変） | **什麼都不壊**（RTTI 解析依名字+偏移找、不看実装） | **0 改動** | **0** | **否** |
| **2** | **改類名**（`nt::MSFService` → `nt::MSFServiceV2`） | `.node` 中 typeinfo 名匹配不到 → `MSFService SessionInit/RTTI chain unresolved` | 改 `.node` 中 typeinfo 名/片段常量（**字符串級**） | **2–6 小時** | **否** |
| **3** | **改 vtable 槽位順序**（中間挿入/削除虚関数） | 槽位偏移全錯 → 換錯関数指針 → **崩溃或静黙失効**（最危険） | 用「字符串→xref→槽位」脚本**重算全槽位偏移**、更新 `msfCoreCallbackOffset` 等 | **0.5–2 日** | **否**（改設定数字） |
| **4** | **加新虚関数、追加於末尾** | primary vtable `offset_to_top` 仍為 0、前面槽位不変 | **通常 0 改動**（只要目標関数仍於原槽位） | **小時級検証** | 否 |
| **5** | **給 MSFService 加多継承/虚基類**（→ `__vmi_class_type_info`） | `.so` 僅導入 `__cxxabiv117` 与 `120`、**不認 121** → 解析直接失敗 | **必須改 `.so` 支持 `__vmi_class_type_info` 布局** | **3–7 日** | **是** |
| **6** | **換 `.rodata` 布局 / 削 `"Xxx::SessionInit"` 錨点串** | 依字符串錨点定位之路径全断 | 為毎個目標重找**新安定錨点**（新記録串、`what()` 串、或 `.eh_frame` 結構） | **数日–2 週** | **是**（很可能） |
| **7** | **`wrapper.node` 被 strip**（削 `.shstrtab` / 節表） | `.so` 依**節名**解析節表 → `ELF section table is missing` | 改為依**程序頭**（`PT_LOAD`/`PT_DYNAMIC`）+ 硬編碼節布局 | **2–5 日** | **是** |
| **8** | **換 ABI/編譯器**（mangled 名規則変） | 名字匹配全断 | 改匹配規則（SnowLuma 既有 `NSt2Cr` = `std::__cxx11` 変体特徴） | **1–3 日** | 半是 |
| **9** | **換新架構 / 加殼** | 全断 | 重做 | **週級** | 是 |
| **10** | **QQ 改注入方式**（沙箱、`/proc` 権限、`process_vm_readv` 被攔） | `QQ runtime cannot read process memory` / `[RUNTIME_MEMORY_UNAVAILABLE]` | 改用 `ptrace(PTRACE_PEEKDATA)` 或 `/proc/pid/mem` | **2–4 日** | 是 |

### 7.3 結論（一語）

> **只要騰訊不動「類名 + 継承結構 + vtable 槽位順序」、適配成本 = 0~1 日、
> 且僅改字符串/数字設定、不必触 native 程式碼也。**
>
> **一旦 vtable 形変（多継承/虚基類）、則必須重写 native 解析器也。**

### 7.4 戦術建議：使「適配」成為「跑脚本」

因「錨点串 → xref site → 槽位」之法**完全機械化**也
（詳見 [architecture.md §6.4](architecture.md)）、**適配工作応成為跑一条命令 + 看 diff 也**：

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

**判読 diff 結果**：

| diff 現象 | 相当状況 | 該做什麼 |
|---|---|---|
| 僅関数地址変、方法名 + 槽位不変 | 状況 1 | **0 改動**、直接跑 |
| 方法名尚在但槽位変了 | 状況 3 | 改 `.node` 之数字 |
| 方法名皆無了 | 状況 2 / 6 | 改 `.node` 字符串 / 重找錨点 |
| 出現 `__vmi_class_type_info` | 状況 5 | **必須改 `.so`** |

> **自研 `.so` 之完全工作量約 20–36 人日（1–1.5 人月）**、
> 但**僅做「離線解析器 + 適配脚本」只需 5–10 人日**、即能覆蓋**最可能発生**之状況 2/3/4 也。
> **勿一上来即重写 `.so`。** 詳見 [contributing.md](../dev/contributing.md)。

### 7.5 ⚠️ 適配後必須行端到端検証

**VTable 替換者最脆弱之 hook 形式也。槽位錯一位不会即刻崩**、
而是**把消息発至錯誤之路径上** —— 表現為用户可見之：

```
"The QQ connection changed. Please restart QQ and try again."
```

> **不可僅見「工程未崩」即認適配成功也。**
> **毎次適配後必須行真実収発消息之端到端検証也。**

---

## 8. 版本昇級検査清単

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

> **完整 12 条 RTTI 失敗串 → 槽位対照表**見 [troubleshooting.md](troubleshooting.md) T4。

---

## 9. 既知之兼容性危険

| # | 危険 | 嚴重度 | 緩和 |
|---|---|---|---|
| 1 | **`wrapper.node` 結構変更致 hook 全失効** | 🔴 致命 | 釘死 QQ 版本；監控記録 `unresolved`；準備「降級為純通知」方案 |
| 2 | **native 層無源碼、無法修 bug** | 🔴 高 | ①完整備份当前可用二進制（sha256）②容器外帰档 ③勿軽易昇級 |
| 3 | **自動更新指向既削除之倉庫 ⇒ 必然 404** | 🟠 中 | 改 `update/sources.ts`、或用 `SNOWLUMA_UPDATE_CHECK` 閉 |
| 4 | **`webuiHost: 0.0.0.0` + 明文 HTTP（TLS 閉）** | 🟠 中 | 改 `127.0.0.1` + 反向代理、或啓用 TLS（`webui/tls.ts` 既就緒） |
| 5 | **`/api/debug/invoke` 等於遠隔任意動作実行** | 🟠 中 | 暴露公網時務必啓用 TOTP + 強密碼；考慮 IP 白名単 |
| 6 | **`onebot.json` 中 `accessToken` 明文（644 権限）** | 🟠 中 | token 改強随機；権限収緊至 600 |
| 7 | **`sqlcipher.ts` 依存 QQ 之庫格式** | 🟠 中 | 既做**12 種組合探測**、韌性不悪；QQ 改格式則需跟改 |
| 8 | **無退避/無熔断**、1.5 s 固定 tick | 🟡 低-中 | 保持 `AUTO_LOAD_MAX_ATTEMPTS=3`；改進時注意勿拖慢恢復 |
| 9 | **線程名 `snowluma-pipe-w` 直接暴露** | 🟡 低 | **native 層、改不了** —— 只能接受 |
| 10 | **EULA/PRIVACY 更新会再度要求同意** | 🟡 低 | 批量配備用 `SNOWLUMA_ACCEPT_EULA` / `_PRIVACY` |
| 11 | **単点：一 runtime 工程服務一切帳号** | 🟡 低 | 既為多 PID 設計（`Map<pid, HookSession>`）、問題不大 |
| 12 | **記録約 11 MB/日**、`logRetainDays=7` ⇒ 約 80 MB 常駐 | 🟢 低 | 既自動輪転、注意磁盤 |
| 13 | **`.so` strip 後無法為符号級除錯** | 🟡 低-中 | 靠 `dynsym` + 字符串 + 反編譯 |

---

## 10. 関連文档

| 欲知 | 去看 |
|---|---|
| 其究竟如何工作 | [architecture.md](architecture.md) |
| 出問題如何排查 | [troubleshooting.md](troubleshooting.md) |
| 如何自源碼建構 | [build.md](../dev/build.md) |
| 如何参加開発 | [contributing.md](../dev/contributing.md) |

---

*基準与指紋：2026-11-12。一切版本号皆実測値（来自 `.pnpm` region 路径与容器内文件）。
接手前請核対 md5。*