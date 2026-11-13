# 兼容性矩阵

> [!WARNING]
> 本内容完全由 AI 编写，请谨慎查看。

> **面向读者**：准备部署或升级 Haizakura（原名 SnowLuma）的运维、以及要适配新 QQ 版本的维护者。
> **本文回答**：它能跑在什么环境上？依赖哪些精确版本？QQ 升级了会怎样、要改什么？
> **最重要的一条**：**QQ 版本必须钉死，不要自动升级。** 理由见 §7。

---

## 0. 快速自检

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

任何一项不符 → 去看对应的章节。

---

## 1. 版本基线（接手必记）

**这是一切偏移的参照系。** 所有地址、槽位、结构布局都基于这一组指纹。

### 1.1 核心版本

| 项目 | 值 |
|---|---|
| **QQ 版本** | `3.2.32-52194`（Linux arm64） |
| `wrapper.node` 大小 | **144,561,472** 字节 |
| `wrapper.node` md5 | **`adeb40af26d859d41fcdb21bf38d9eb5`** |
| `wrapper.node` build-id | **`89c36b520f97c88081a9453bd6abb70c3452f156`** |
| SnowLuma / Haizakura runtime | **2.4.0** |
| hook stub 自述版本 | `snowluma-linux-hook-stub/0.2.0` |
| Node | **24.22.2** |
| 容器镜像 | `motricseven7/snowluma:latest`（2.69 GB，arm64） |

### 1.2 native 产物 sha256

```bash
cf8183755e7b912149c045f93bd6010feeeaa170fff0580d7013d62b6347da00  snowluma-linux-arm64.node
238ff3c348d98a42e49662f58fbd4404f89b9a65a7fc6e56c1775e2740d3f13e  snowluma-linux-arm64.so
b705b7e2392a75cdde95a146f933a7d472b4c72709f35f707a0798f9fcdf9e19  websocket-linux-arm64.node
```

> ⚠️ **`wrapper.node` 的 build-id 是跨版本区分的唯一可靠指纹。**
> 它比文件大小更准（大小会变），比 md5 更适合运行时校验（md5 要读全 144 MB，
> build-id 只需读 `0x200` 处 36 字节）。
> `89c36b52…` **正是 `.so` 里 `missing or ambiguous GNU build ID` 校验的那个值**。

### 1.3 wrapper.node 的关键节地址

```
[12] .text           PROGBITS  083d780   83d780   5e1ff10
[15] .rodata         PROGBITS  665d900   665d900   994a46    ← vaddr == file off ✅
[23] .data.rel.ro    PROGBITS  86acb60   869cb60   32e5a8    ← vaddr ≠ file off ⚠️
[24] .dynamic        DYNAMIC   89db108   89cb108   2c0

.note.gnu.build-id   @ vaddr 0x200 / file 0x200，段大小 0x24
                     NT_GNU_BUILD_ID 描述符 0x14 (20) 字节

Δ = .data.rel.ro 的 (vaddr − file_off) = 0x10000
```

> **Δ 本身不固定，换版本会变** —— 必须从节表算，不能硬编码。详见
> [architecture.md §6.3](architecture.md)。

### 1.4 基线中的关键结构

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

## 2. 支持的平台

### 2.1 只有 Linux arm64

| 平台 | 支持状态 | 说明 |
|---|---|---|
| **Linux arm64 (aarch64)** | ✅ **唯一有构建产物的平台** | 全部 5 个 native 产物都是 arm64 |
| Linux x86_64 | ❌ | 实测报错：`No hook native addon found for linux-x64` |
| Windows | ⚠️ 有代码路径，**无产物** | 走命名管道 + `getFileHoldersAsync`；需 DLL，未发布 |
| macOS | ⚠️ 有代码路径，**无产物** | 走 `DYLD_INSERT_LIBRARIES`；需 dylib，未发布 |

**换架构需要全部 5 个 native 产物** —— 这是极高工作量的操作，**不推荐**。

### 2.2 Linux arm64 的实测环境

```
架构        aarch64
发行版      Debian GNU/Linux 12 (bookworm)（容器内）
Electron    40.0.0（QQ 自带）
X 显示      Xvfb :1 -screen 0 1920x1080x24
窗口管理    fluxbox
VNC         x11vnc + noVNC（6081 端口，扫码登录用）
```

### 2.3 需要的 Linux 内核能力

| 能力 | 为什么需要 | 缺了会怎样 |
|---|---|---|
| `ptrace` | 注入器附加到 QQ 进程 | 注入失败 |
| `process_vm_readv` / `process_vm_writev` | 读写目标进程内存 | 报 `QQ runtime cannot read process memory` |
| `/proc/<pid>/maps` 可读 | 找 `wrapper.node` 的加载基址 | 报 `module not found in target process maps` |
| `/proc/<pid>/environ` 可读 | 跨进程读 `SNOWLUMA_HOOK_RUNTIME_DIR` | **同 uid 可行，跨 uid 会失败** 【未查清】 |
| `/proc/locks` 可读 | 定位账号数据库持有者（不需要 root） | 账号发现失败 |

---

## 3. Node 版本要求

### 3.1 闸门逻辑

`/app/runtime/check-node-version.cjs` 的**原文逻辑**：

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

**语义展开**：

| Node 主版本 | 要求 | 说明 |
|---|---|---|
| 24 | `>= 24.22.1` | 24.22.0 及以下 ❌ |
| **25** | ❌ **不支持** | 落在 `^24` 和 `>=26.12.1` 之外 |
| 26 | `>= 26.12.1` | |
| > 26 | ✅ 放行 | |
| < 24 | ❌ | |

> ⚠️ **注意 Node 25 是个空洞** —— 它既不满足 `^24.22.1` 也不满足 `>=26.12.1`。

### 3.2 实测

```
容器内实测：v24.22.2   ✅ 通过
```

### 3.3 为什么不能随便换 Node 版本

| 原因 | 说明 |
|---|---|
| **N-API 版本约束** | `@appthreat/sqlite3` 要求 Node ≥24 且 **NAPI ≥10** |
| **闸门会拦** | 不满足时 `check-node-version.cjs` 直接 `exitCode = 1` |

> **改 Node 版本 → 改 `check-node-version.cjs`**（🟢 低难度），但要先确认 N-API 兼容性。

---

## 4. 依赖清单

### 4.1 运行时依赖：15 个内联第三方包

产物是**自包含单文件**，`package.json` 明确写
*"There are intentionally NO runtime npm dependencies; production artifacts are self-contained"*。

版本号**直接从 `.pnpm` region 路径读出**（如 `hono@4.13.13`）—— 这是**权威值**。

| 包名 | **精确版本** | 归属包 | 用途 |
|---|---|---|---|
| `hono` | **`4.13.13`** | core, protocol, onebot | HTTP 框架（WebUI 后端） |
| `@hono/node-server` | **`2.1.5`** | core | Hono 的 Node 适配 |
| `otpauth` | **`9.5.1`** | core | WebUI 登录 TOTP |
| `tar` | **`7.5.22`** | core | update 解包 |
| `fflate` | **`0.8.3`** | core | zlib 压缩（update） |
| `semver` | **`7.7.4`** | core, common | 版本比较 |
| `@zxcvbn-ts/core` | **`4.1.2`** | core | 密码强度（WebUI） |
| `@zxcvbn-ts/language-common` | **`4.1.3`** | core | zxcvbn 词典 |
| `@zxcvbn-ts/dictionary-compression` | **`3.0.1`** | core | zxcvbn 词典压缩 |
| `fastest-levenshtein` | **`1.0.16`** | core | 字符串距离 |
| `htmlparser2` | **`10.0.0`** | protocol | HTML 解析（消息元素） |
| `entities` | **`6.0.1`** | protocol | 实体编解码 |
| `domhandler` | **`5.0.3`** | protocol | htmlparser2 依赖 |
| `domutils` | **`3.2.2`** | protocol | htmlparser2 依赖 |
| `domelementtype` | **`2.3.0`** | protocol | htmlparser2 依赖 |

**全部可公开获取，无私有包、无需鉴权。** 实测：

```bash
npm config set registry https://mirrors.tencentyun.com/npm
npm install
# → added 29 packages in 15s  ✅
```

### 4.2 ⚠️ ★ 版本必须精确锁定 —— 不要用 `^`

**这是一次真实的踩坑**：用 caret 范围（`^4.13.13`）装了一遍，
npm 解析出的版本**与 bundle 内的不一致** —— **6 个包发生漂移**：

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

> **规则：写 `"hono": "4.13.13"`，不要写 `"hono": "^4.13.13"`。**
> 否则重建产物的行为可能与线上不一致。

> ⚠️ **还原工程当前的 `package.json` 里用的仍是 `^`** ——
> 这是已知待修项，见 [contributing.md](../dev/contributing.md)。

### 4.3 构建期依赖

| 包 | 版本要求 | 说明 |
|---|---|---|
| `typescript` | `5.9.x`（原为 `catalog:`，还原时写死） | 类型检查 |
| `rolldown` | **`≤ 1.1.8`** | 只有这个区间会输出 `//#region`（见 §4.4） |
| `pnpm` | `11.25.0` | workspace 管理 |

**构建期可选工具**（原工程有，未还原）：`eslint` / `prettier` / `vitest` 全家桶。

### 4.4 rolldown 版本矩阵

| rolldown | 输出 region 注释格式 | 能否用 |
|---|---|---|
| `1.0.0` | `//#region <path>` | ✅ |
| `1.1.0` / `1.1.4` / `1.1.8` | `//#region <path>` | ✅ **推荐 1.1.8** |
| `1.2.16` | `// <path>`（无 `#region`） | ❌ 格式已变 |
| `1.3.2` | `// <path>` | ❌ 且 `inlineDynamicImports` 已弃用 |

> **原工程用的 rolldown 版本无法精确确定**（bundle 里没有版本戳），只能收敛到 **`≤1.1.8`**。

### 4.5 native 插件依赖矩阵

bundle 只是**加载器**，真正的二进制不在里面。运行时按平台-架构拼文件名去找：

| 用途 | 文件名模式 | 查找位置 | 接口契约 |
|---|---|---|---|
| **Hook 注入 + hook 后端** | `snowluma-{platform}-{arch}.node`<br>`snowluma-{platform}-{arch}.so` | `<moduleDir>/native`<br>`<moduleDir>/../../runtime/native` | 6 个导出函数（见 architecture.md §4.3） |
| WebSocket 加速 | `websocket-{platform}-{arch}.node` | 同上 | 第三方（`ws` 的 optional addon）；可用 `SNOWLUMA_DEV_NO_NATIVE=1` stub 掉 |
| SQLite 驱动 | `@appthreat+sqlite3.{glibc,musl}.node` | `native/sqlite/prebuilds/{platform}-{arch}/` | **`NATIVE_INTERFACE_VERSION === 1`** + `Database` / `Statement` / `OPEN_READONLY=1` / `OPEN_READWRITE=2` / `OPEN_CREATE=4` / `OPEN_FULLMUTEX=65536` |
| 语音转码 | `ffmpegAddon.{platform}.{arch}.node` | `native/ffmpeg/` | 3 个方法：`convertToNTSilkTct` / `decodeAudioToFmt` / `getDuration` |
| QQ 账号库解密 | `wrapper.node` / `wrapper.linux.node` | QQ 安装目录 | 只读定位，不解密（`sqlcipher.ts` 自己实现解密） |

**路径解析逻辑**（`packages/common/src/native-path.ts`）：

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

**SQLite 的 libc 选择**：按运行时 libc 选 `glibc` 或 `musl` prebuild
（`runtimeLibc()`），并用 `assertBinding()` 校验接口版本 ——
**替换 SQLite 版本时必须保持这个接口不变**。

> **`vendor-regions/`（99 个文件）仅作比对参考** —— 它们是**已被 rolldown 扁平化后**的形态，
> 不是干净的上游 ESM 源码。正确做法是 `npm install` 拉真实包。

---

## 5. 容器运行时要求

### 5.1 ★ 必需的内核能力（缺了启动失败）

```bash
docker run \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  ...
```

| 参数 | 为什么必需 | 缺了的表现 |
|---|---|---|
| `--cap-add SYS_PTRACE` | 注入器要 `ptrace` 附加到 QQ 进程 | **注入失败**（hook 静默不生效） |
| `--security-opt seccomp=unconfined` | 默认 seccomp 白名单会拦 `ptrace` / `process_vm_*` | **`ExitCode=126`** + `/usr/local/bin/node: Operation not permitted` |

**生产实例实测确认**：

```
HostConfig.CapAdd        ["CAP_SYS_PTRACE"]
HostConfig.SecurityOpt   ["seccomp=unconfined"]
```

> **这是最常见的一次性启动失败原因。** 症状是容器立刻退出、退出码 126 ——
> 详情见 [troubleshooting.md](troubleshooting.md) 的 T5。

### 5.2 端口映射（生产实例）

```
3000/tcp -> 0.0.0.0:3010    (OneBot HTTP)
3001/tcp -> 0.0.0.0:3011    (OneBot WS)
5099/tcp -> 0.0.0.0:5199    (WebUI)
6081/tcp -> 0.0.0.0:6181    (noVNC)
```

### 5.3 环境变量（生产实例实测）

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

> 完整的 36 个 `SNOWLUMA_*` 环境变量清单见 [troubleshooting.md](troubleshooting.md) 附录。

### 5.4 卷挂载（生产实例）

```
/app/data            ← 持久化：配置、数据库、日志（必须持久化！）
/app/.config         ← QQ 配置（含登录态 —— 重启容器会清空，见 T2）
/app/.local/share    ← QQ 数据
/app/runtime/index.mjs  ← bind mount 覆盖 bundle（部署改动用）
```

> ⚠️ **`/app/.config` 里存的是 QQ 登录态**。它不是"只是配置" ——
> **QQ 进程重启就会清空 `loginList`，必须重新扫码。** 详见
> [troubleshooting.md](troubleshooting.md) 的 T2（**血的教训**）。

---

## 6. 配置文件的版本耦合

| 文件 | 权限 | 内容 | 换版本会失效吗 |
|---|---|---|---|
| `runtime.json` | 644 | `webuiPort` / `hookAutoLoad` / `webuiHost` / `webuiTls` / `trustProxy` / 日志轮转 | 否（结构稳定） |
| `onebot.json` | 644 | **全局** OneBot 网络配置 | 否 |
| `onebot_<uin>.json` | 600 | **每账号**配置（`mode: "snapshot"`）+ `statusCommand` / `historySync` / `notifications` | 否 |
| `webui.json` | 600 | `passwordHash` / `passwordSalt`（scrypt）/ `mustChangePassword` | 否 |
| `ui.json` | 644 | WebUI 外观与布局 | 否 |
| `consent.json` | 644 | `{ version, acceptedAt }` | ⚠️ **EULA/PRIVACY 更新会使 `version` 变化 → 再次要求同意** |
| `machine-id` | 644 | 32 位十六进制机器标识 | 否 |
| `notifications.json` | 600 | `{ version: 1, debounceSeconds, channels }` | 否 |
| `vnc-password` | 600 root | noVNC 密码（**与 Haizakura 逻辑无关**） | 否 |

**数据库**（按账号分目录 `/app/data/data/<uin>/`）：

| 文件 | 归属 | 内容 |
|---|---|---|
| `messages.db` | `onebot/message-store.ts` | 消息历史 / 媒体索引 / 迁移状态 |
| `reactions.db` | `onebot/reaction-store.ts` | 贴表情记录 |
| `snowluma_identity.db` | `bridge/apis/contacts.ts` | 用户/群/群成员身份映射 |
| `sys-face-catalog.json` | `core/sys-face-catalog.ts` | 系统表情目录缓存（在 `/app/data/data/` 根） |

> **schema 有版本化迁移**（`classification_version` 配合 `CLASSIFICATION_VERSION`，
> 用 `PRAGMA table_info` 逐列判断后 `ALTER TABLE`）。
> **改表结构务必写迁移**，参考现有 `prepare*Schema()` 模式。

**批量部署时的 EULA 自动化**：

```bash
SNOWLUMA_ACCEPT_EULA=1
SNOWLUMA_ACCEPT_PRIVACY=1
```

---

## 7. QQ 版本耦合风险

### 7.1 为什么强耦合

**hook 依赖 `wrapper.node` 的四个内部特征**：

```
① C++ RTTI 类名（mangled，如 "N2nt10MSFServiceE"）
② vtable 槽位顺序（如 SessionInit 在 v[pos] ap+0x98）
③ 结构体字段偏移（如 msfCoreCallbackOffset）
④ 用于定位的锚点字符串（如 "MSFService::SessionInit"）
```

**这四项任一变化，hook 就失效。** 而失败信息只会说 `unresolved`，拿不到更多细节。

### 7.2 ★ 适配新 QQ 版本难度矩阵

前提：**你保留了 Haizakura 的 `.node`（含 `RuntimeTargets` 常量）与 `.so`（通用引擎）。**
工作量以**一个人、熟悉本流程**估算。

| # | 腾讯的改动 | 会坏在哪 | 需要改什么 | 工作量 | 要重写 native 吗 |
|---|---|---|---|---|---|
| **0** | **不发布新版本**（同 build） | — | 什么都不用 | **0** | 否 |
| **1** | **只改函数内部实现**（类名/vtable 布局/槽位顺序都不变） | **什么都不坏**（RTTI 解析按名字+偏移找，不看实现） | **0 改动** | **0** | **否** |
| **2** | **改了类名**（`nt::MSFService` → `nt::MSFServiceV2`） | `.node` 里 typeinfo 名匹配不到 → `MSFService SessionInit/RTTI chain unresolved` | 改 `.node` 里的 typeinfo 名/片段常量（**字符串级**） | **2–6 小时** | **否** |
| **3** | **改了 vtable 槽位顺序**（中间插入/删除虚函数） | 槽位偏移全错 → 换错函数指针 → **崩溃或静默失效**（最危险） | 用"字符串→xref→槽位"脚本**重算全部槽位偏移**，更新 `msfCoreCallbackOffset` 等 | **0.5–2 天** | **否**（改配置数字） |
| **4** | **加了新虚函数、追加在末尾** | primary vtable `offset_to_top` 仍为 0，前面槽位不变 | **通常 0 改动**（只要目标函数仍在原槽位） | **小时级验证** | 否 |
| **5** | **给 MSFService 加了多继承/虚基类**（→ `__vmi_class_type_info`） | `.so` 只导入 `__cxxabiv117` 和 `120`，**不认 121** → 解析直接失败 | **必须改 `.so` 支持 `__vmi_class_type_info` 布局** | **3–7 天** | **是** |
| **6** | **换了 `.rodata` 布局 / 删了 `"Xxx::SessionInit"` 锚点串** | 靠字符串锚点定位的路径全断 | 为每个目标重新找**新的稳定锚点**（新日志串、`what()` 串、或 `.eh_frame` 结构） | **数天–2 周** | **是**（很可能） |
| **7** | **`wrapper.node` 被 strip**（去掉 `.shstrtab` / 节表） | `.so` 按**节名**解析节表 → `ELF section table is missing` | 改为按**程序头**（`PT_LOAD`/`PT_DYNAMIC`）+ 硬编码节布局 | **2–5 天** | **是** |
| **8** | **换了 ABI/编译器**（mangled 名规则变） | 名字匹配全断 | 改匹配规则（SnowLuma 已有 `NSt2Cr` = `std::__cxx11` 变体特征） | **1–3 天** | 半是 |
| **9** | **换新架构 / 加壳** | 全断 | 重做 | **周级** | 是 |
| **10** | **QQ 改了注入方式**（沙箱、`/proc` 权限、`process_vm_readv` 被拦） | `QQ runtime cannot read process memory` / `[RUNTIME_MEMORY_UNAVAILABLE]` | 改用 `ptrace(PTRACE_PEEKDATA)` 或 `/proc/pid/mem` | **2–4 天** | 是 |

### 7.3 结论（一句话）

> **只要腾讯不动"类名 + 继承结构 + vtable 槽位顺序"，适配成本 = 0~1 天，
> 而且只改字符串/数字配置，不用碰 native 代码。**
>
> **一旦 vtable 形状变了（多继承/虚基类），就必须重写 native 解析器。**

### 7.4 战术建议：把"适配"变成"跑脚本"

因为"锚点串 → xref site → 槽位"的方法**完全机械化**
（详见 [architecture.md §6.4](architecture.md)），**适配工作应该变成跑一条命令 + 看 diff**：

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

**判读 diff 结果**：

| diff 现象 | 对应情况 | 该做什么 |
|---|---|---|
| 只有函数地址变，方法名 + 槽位不变 | 情况 1 | **0 改动**，直接跑 |
| 方法名还在但槽位变了 | 情况 3 | 改 `.node` 的数字 |
| 方法名都没了 | 情况 2 / 6 | 改 `.node` 字符串 / 重找锚点 |
| 出现 `__vmi_class_type_info` | 情况 5 | **必须改 `.so`** |

> **自研 `.so` 的完整工作量约 20–36 人日（1–1.5 人月）**，
> 但**只做"离线解析器 + 适配脚本"只需 5–10 人日**，就能覆盖**最可能发生的**情况 2/3/4。
> **不要一上来重写 `.so`。** 详见 [contributing.md](../dev/contributing.md)。

### 7.5 ⚠️ 适配后必须做端到端验证

**VTable 替换是最脆弱的 hook 形式。槽位错一位不会立刻崩**，
而是**把消息发到错误的路径上** —— 表现为用户可见的：

```
"The QQ connection changed. Please restart QQ and try again."
```

> **不能只看"进程没崩"就认为适配成功。**
> **每次适配后必须做真实收发消息的端到端验证。**

---

## 8. 版本升级检查清单

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

> **完整 12 条 RTTI 失败串 → 槽位对照表**见 [troubleshooting.md](troubleshooting.md) T4。

---

## 9. 已知的兼容性风险

| # | 风险 | 严重度 | 缓解 |
|---|---|---|---|
| 1 | **`wrapper.node` 结构变更导致 hook 全失效** | 🔴 致命 | 钉死 QQ 版本；监控日志 `unresolved`；准备"降级为纯通知"方案 |
| 2 | **native 层无源码，无法修 bug** | 🔴 高 | ①完整备份当前可用二进制（sha256）②容器外归档 ③不要轻易升级 |
| 3 | **自动更新指向已删除的仓库 ⇒ 必然 404** | 🟠 中 | 改 `update/sources.ts`，或用 `SNOWLUMA_UPDATE_CHECK` 关闭 |
| 4 | **`webuiHost: 0.0.0.0` + 明文 HTTP（TLS 关闭）** | 🟠 中 | 改 `127.0.0.1` + 反代，或启用 TLS（`webui/tls.ts` 已就绪） |
| 5 | **`/api/debug/invoke` 等于远程任意动作执行** | 🟠 中 | 暴露公网时务必启用 TOTP + 强密码；考虑 IP 白名单 |
| 6 | **`onebot.json` 里 `accessToken` 明文（644 权限）** | 🟠 中 | token 改强随机；权限收紧到 600 |
| 7 | **`sqlcipher.ts` 依赖 QQ 的库格式** | 🟠 中 | 已做**12 种组合探测**，韧性不错；QQ 改格式需跟改 |
| 8 | **无退避/无熔断**，1.5 s 固定 tick | 🟡 低-中 | 保持 `AUTO_LOAD_MAX_ATTEMPTS=3`；改进时注意别拖慢恢复 |
| 9 | **线程名 `snowluma-pipe-w` 直接暴露** | 🟡 低 | **native 层，改不了** —— 只能接受 |
| 10 | **EULA/PRIVACY 更新会再次要求同意** | 🟡 低 | 批量部署用 `SNOWLUMA_ACCEPT_EULA` / `_PRIVACY` |
| 11 | **单点：一个 runtime 进程服务所有账号** | 🟡 低 | 已是多 PID 设计（`Map<pid, HookSession>`），问题不大 |
| 12 | **日志 ~11 MB/天**，`logRetainDays=7` ⇒ 约 80 MB 常驻 | 🟢 低 | 已自动轮转，注意磁盘 |
| 13 | **`.so` strip 后无法做符号级调试** | 🟡 低-中 | 靠 `dynsym` + 字符串 + 反汇编 |

---

## 10. 相关文档

| 想了解 | 去看 |
|---|---|
| 它到底怎么工作的 | [architecture.md](architecture.md) |
| 出问题怎么排查 | [troubleshooting.md](troubleshooting.md) |
| 怎么从源码构建 | [build.md](../dev/build.md) |
| 怎么参与开发 | [contributing.md](../dev/contributing.md) |

---

*基线与指纹：2026-11-12。所有版本号均为实测值（来自 `.pnpm` region 路径与容器内文件）。
接手前请核对 md5。*
