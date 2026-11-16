# Compatibility matrix

> [!WARNING]
> This content was written entirely by AI; review it with care.

> **Audience**: operators about to deploy or upgrade Haizakura (formerly SnowLuma), and maintainers who need to adapt it to a new QQ version.
> **This document answers**: what environments can it run on? Which exact versions does it depend on? What happens when QQ upgrades, and what must change?
> **The single most important rule**: **pin the QQ version; never auto-upgrade it.** For why, see §7.

---

## 0. Quick self-check

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

If any item fails, go to the corresponding section.

---

## 1. Version baseline (must be memorized when taking over)

**This is the reference frame for every drift.** All addresses, slots and structural layouts are based on this set of fingerprints.

### 1.1 Core versions

| Item | Value |
|---|---|
| **QQ version** | `3.2.32-52194` (Linux arm64) |
| `wrapper.node` size | **144,561,472** bytes |
| `wrapper.node` md5 | **`adeb40af26d859d41fcdb21bf38d9eb5`** |
| `wrapper.node` build-id | **`89c36b520f97c88081a9453bd6abb70c3452f156`** |
| SnowLuma / Haizakura runtime | **2.4.0** |
| hook stub self-reported version | `snowluma-linux-hook-stub/0.2.0` |
| Node | **24.22.2** |
| Container image | `motricseven7/snowluma:latest` (2.69 GB, arm64) |

### 1.2 Native artifact sha256

```bash
cf8183755e7b912149c045f93bd6010feeeaa170fff0580d7013d62b6347da00  snowluma-linux-arm64.node
238ff3c348d98a42e49662f58fbd4404f89b9a65a7fc6e56c1775e2740d3f13e  snowluma-linux-arm64.so
b705b7e2392a75cdde95a146f933a7d472b4c72709f35f707a0798f9fcdf9e19  websocket-linux-arm64.node
```

> ⚠️ **A `wrapper.node` build-id is the only reliable fingerprint for distinguishing versions.**
> It is more accurate than the file size (which changes) and better suited to runtime verification than md5
> (md5 must read all 144 MB, while the build-id only needs 36 bytes at `0x200`).
> `89c36b52…` **is exactly the value the `.so` validates in `missing or ambiguous GNU build ID`**.

### 1.3 Key section addresses in wrapper.node

```
[12] .text           PROGBITS  083d780   83d780   5e1ff10
[15] .rodata         PROGBITS  665d900   665d900   994a46    ← vaddr == file off ✅
[23] .data.rel.ro    PROGBITS  86acb60   869cb60   32e5a8    ← vaddr ≠ file off ⚠️
[24] .dynamic        DYNAMIC   89db108   89cb108   2c0

.note.gnu.build-id   @ vaddr 0x200 / file 0x200，段大小 0x24
                     NT_GNU_BUILD_ID 描述符 0x14 (20) 字节

Δ = .data.rel.ro 的 (vaddr − file_off) = 0x10000
```

> **Δ itself is not fixed and changes between versions** — it must be computed from the section table, never hard-coded. See
> [architecture.md §6.3](architecture.md).

### 1.4 Key structures in the baseline

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

## 2. Supported platforms

### 2.1 Linux arm64 only

| Platform | Support status | Notes |
|---|---|---|
| **Linux arm64 (aarch64)** | ✅ **The only platform with build artifacts** | All 5 native artifacts are arm64 |
| Linux x86_64 | ❌ | Measured error: `No hook native addon found for linux-x64` |
| Windows | ⚠️ Code paths exist, **no artifacts** | Uses named pipes + `getFileHoldersAsync`; needs a DLL, not released |
| macOS | ⚠️ Code paths exist, **no artifacts** | Uses `DYLD_INSERT_LIBRARIES`; needs a dylib, not released |

**Changing architecture requires all 5 native artifacts** — an extremely high-effort operation, **not recommended**.

### 2.2 Measured environment on Linux arm64

```
架构        aarch64
发行版      Debian GNU/Linux 12 (bookworm)（容器内）
Electron    40.0.0（QQ 自带）
X 显示      Xvfb :1 -screen 0 1920x1080x24
窗口管理    fluxbox
VNC         x11vnc + noVNC（6081 端口，扫码登录用）
```

### 2.3 Required Linux kernel capabilities

| Capability | Why it is needed | What happens without it |
|---|---|---|
| `ptrace` | The injector attaches to the QQ process | Injection fails |
| `process_vm_readv` / `process_vm_writev` | Reading and writing the target process's memory | `QQ runtime cannot read process memory` |
| Readable `/proc/<pid>/maps` | Finding `wrapper.node`'s load base | `module not found in target process maps` |
| Readable `/proc/<pid>/environ` | Reading `SNOWLUMA_HOOK_RUNTIME_DIR` across processes | **Works within the same uid; fails across uids** [not fully determined] |
| Readable `/proc/locks` | Locating the account database holder (without root) | Account discovery fails |

---

## 3. Node version requirements

### 3.1 Gate logic

The **verbatim logic** of `/app/runtime/check-node-version.cjs`:

```js
const SUPPORTED_NODE_RANGE = '^24.22.1 || >=26.12.1';

function isSupportedNodeVersion(version) {
  const [major, minor, patch] = parseNodeVersion(version);
  if (major === 24) return minor > 22 || (minor === 22 && patch >= 1);
  if (major === 26) return minor > 12 || (minor === 12 && patch >= 1);
  return major > 26;
}
```

The `engines` field in `package.json`:

```json
{ "node": "^24.22.1 || >=26.12.1", "pnpm": "11.25.0" }
```

**Semantics expanded**:

| Node major | Requirement | Notes |
|---|---|---|
| 24 | `>= 24.22.1` | 24.22.0 and below ❌ |
| **25** | ❌ **Unsupported** | Falls outside both `^24` and `>=26.12.1` |
| 26 | `>= 26.12.1` | |
| > 26 | ✅ Allowed | |
| < 24 | ❌ | |

> ⚠️ **Note that Node 25 is a hole** — it satisfies neither `^24.22.1` nor `>=26.12.1`.

### 3.2 Measured

```
容器内实测：v24.22.2   ✅ 通过
```

### 3.3 Why you cannot just change the Node version

| Reason | Notes |
|---|---|
| **N-API version constraint** | `@appthreat/sqlite3` requires Node ≥24 and **NAPI ≥10** |
| **The gate blocks it** | When unsatisfied, `check-node-version.cjs` simply sets `exitCode = 1` |

> **Changing the Node version → change `check-node-version.cjs`** (🟢 low difficulty), but confirm N-API compatibility first.

---

## 4. Dependency list

### 4.1 Runtime dependencies: 15 inlined third-party packages

The artifact is a **self-contained single file**, and `package.json` states plainly:
*"There are intentionally NO runtime npm dependencies; production artifacts are self-contained"*.

The version numbers are **read directly from the `.pnpm` region paths** (such as `hono@4.13.13`) — these are the **authoritative values**.

| Package | **Exact version** | Owning package | Purpose |
|---|---|---|---|
| `hono` | **`4.13.13`** | core, protocol, onebot | HTTP framework (WebUI backend) |
| `@hono/node-server` | **`2.1.5`** | core | Hono's Node adapter |
| `otpauth` | **`9.5.1`** | core | WebUI login TOTP |
| `tar` | **`7.5.22`** | core | update extraction |
| `fflate` | **`0.8.3`** | core | zlib compression (update) |
| `semver` | **`7.7.4`** | core, common | Version comparison |
| `@zxcvbn-ts/core` | **`4.1.2`** | core | Password strength (WebUI) |
| `@zxcvbn-ts/language-common` | **`4.1.3`** | core | zxcvbn dictionaries |
| `@zxcvbn-ts/dictionary-compression` | **`3.0.1`** | core | zxcvbn dictionary compression |
| `fastest-levenshtein` | **`1.0.16`** | core | String distance |
| `htmlparser2` | **`10.0.0`** | protocol | HTML parsing (message elements) |
| `entities` | **`6.0.1`** | protocol | Entity encoding/decoding |
| `domhandler` | **`5.0.3`** | protocol | htmlparser2 dependency |
| `domutils` | **`3.2.2`** | protocol | htmlparser2 dependency |
| `domelementtype` | **`2.3.0`** | protocol | htmlparser2 dependency |

**All are publicly available — no private packages, no authentication needed.** Measured:

```bash
npm config set registry https://mirrors.tencentyun.com/npm
npm install
# → added 29 packages in 15s  ✅
```

### 4.2 ⚠️ ★ Versions must be pinned exactly — do not use `^`

**This is a pitfall we actually hit**: installing once with caret ranges (`^4.13.13`) produced versions
**that did not match those inside the bundle** — **6 packages drifted**:

| Package | In the bundle | What `^` installs | Verdict |
|---|---|---|---|
| `hono` | `4.13.13` | **`4.13.18`** | ❌ Drift |
| `@hono/node-server` | `2.1.5` | **`2.1.8`** | ❌ Drift |
| `otpauth` | `9.5.1` | **`9.6.0`** | ❌ Drift |
| `tar` | `7.5.22` | **`7.5.23`** | ❌ Drift |
| `@zxcvbn-ts/core` | `4.1.2` | **`4.2.0`** | ❌ Drift |
| `semver` | `7.7.4` | **`7.8.6`** | ❌ Drift |
| `htmlparser2` | `10.0.0` | **`10.1.0`** | ❌ Drift |
| `fflate` | `0.8.3` | `0.8.3` | ✅ |
| `@zxcvbn-ts/language-common` | `4.1.3` | `4.1.3` | ✅ |
| `@zxcvbn-ts/dictionary-compression` | `3.0.1` | `3.0.1` | ✅ |
| `fastest-levenshtein` | `1.0.16` | `1.0.16` | ✅ |
| `entities` | `6.0.1` | `6.0.1` | ✅ |

> **The rule: write `"hono": "4.13.13"`, not `"hono": "^4.13.13"`.**
> Otherwise the rebuilt artifact may behave differently from production.

> ⚠️ **The restored project's current `package.json` still uses `^`** —
> this is a known outstanding item; see [contributing.md](../dev/contributing.md).

### 4.3 Build-time dependencies

| Package | Version requirement | Notes |
|---|---|---|
| `typescript` | `5.9.x` (originally `catalog:`, hard-coded during restoration) | Type checking |
| `rolldown` | **`≤ 1.1.8`** | Only this range emits `//#region` (see §4.4) |
| `pnpm` | `11.25.0` | Workspace management |

**Optional build-time tooling** (present in the original project, not restored): the full `eslint` / `prettier` / `vitest` suite.

### 4.4 rolldown version matrix

| rolldown | Region comment format emitted | Usable |
|---|---|---|
| `1.0.0` | `//#region <path>` | ✅ |
| `1.1.0` / `1.1.4` / `1.1.8` | `//#region <path>` | ✅ **1.1.8 recommended** |
| `1.2.16` | `// <path>` (no `#region`) | ❌ Format changed |
| `1.3.2` | `// <path>` | ❌ And `inlineDynamicImports` is deprecated |

> **The rolldown version used by the original project cannot be pinned down exactly** (the bundle carries no version stamp), so it can only be narrowed to **`≤1.1.8`**.

### 4.5 Native addon dependency matrix

The bundle is only a **loader**; the actual binaries are not inside it. At runtime the filename is assembled from platform-arch:

| Purpose | Filename pattern | Search location | Interface contract |
|---|---|---|---|
| **Hook injection + hook backend** | `snowluma-{platform}-{arch}.node`<br>`snowluma-{platform}-{arch}.so` | `<moduleDir>/native`<br>`<moduleDir>/../../runtime/native` | 6 exported functions (see architecture.md §4.3) |
| WebSocket acceleration | `websocket-{platform}-{arch}.node` | Same as above | Third-party (`ws`'s optional addon); can be stubbed out with `SNOWLUMA_DEV_NO_NATIVE=1` |
| SQLite driver | `@appthreat+sqlite3.{glibc,musl}.node` | `native/sqlite/prebuilds/{platform}-{arch}/` | **`NATIVE_INTERFACE_VERSION === 1`** plus `Database` / `Statement` / `OPEN_READONLY=1` / `OPEN_READWRITE=2` / `OPEN_CREATE=4` / `OPEN_FULLMUTEX=65536` |
| Voice transcoding | `ffmpegAddon.{platform}.{arch}.node` | `native/ffmpeg/` | 3 methods: `convertToNTSilkTct` / `decodeAudioToFmt` / `getDuration` |
| QQ account DB decryption | `wrapper.node` / `wrapper.linux.node` | The QQ install directory | Read-only location; no decryption (`sqlcipher.ts` implements decryption itself) |

**Path resolution logic** (`packages/common/src/native-path.ts`):

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

**SQLite's libc selection**: it picks the `glibc` or `musl` prebuild according to the runtime libc
(`runtimeLibc()`) and validates the interface version with `assertBinding()` —
**replacing the SQLite version must keep this interface unchanged**.

> **`vendor-regions/` (99 files) is for comparison reference only** — those are the **already-flattened-by-rolldown** forms,
> not clean upstream ESM source. The correct approach is to `npm install` the real packages.

---

## 5. Container runtime requirements

### 5.1 ★ Required kernel capabilities (startup fails without them)

```bash
docker run \
  --cap-add SYS_PTRACE \
  --security-opt seccomp=unconfined \
  ...
```

| Option | Why it is required | Symptom without it |
|---|---|---|
| `--cap-add SYS_PTRACE` | The injector needs `ptrace` to attach to the QQ process | **Injection fails** (the hook silently does nothing) |
| `--security-opt seccomp=unconfined` | The default seccomp allowlist blocks `ptrace` / `process_vm_*` | **`ExitCode=126`** + `/usr/local/bin/node: Operation not permitted` |

**Confirmed on the production instance**:

```
HostConfig.CapAdd        ["CAP_SYS_PTRACE"]
HostConfig.SecurityOpt   ["seccomp=unconfined"]
```

> **This is the most common one-shot startup failure.** The symptom is the container exiting immediately with
> exit code 126 — for details see T5 in [troubleshooting.md](troubleshooting.md).

### 5.2 Port mapping (production instance)

```
3000/tcp -> 0.0.0.0:3010    (OneBot HTTP)
3001/tcp -> 0.0.0.0:3011    (OneBot WS)
5099/tcp -> 0.0.0.0:5199    (WebUI)
6081/tcp -> 0.0.0.0:6181    (noVNC)
```

### 5.3 Environment variables (measured on the production instance)

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

> For the complete list of 36 `SNOWLUMA_*` environment variables, see the appendix in [troubleshooting.md](troubleshooting.md).

### 5.4 Volume mounts (production instance)

```
/app/data            ← 持久化：配置、数据库、日志（必须持久化！）
/app/.config         ← QQ 配置（含登录态 —— 重启容器会清空，见 T2）
/app/.local/share    ← QQ 数据
/app/runtime/index.mjs  ← bind mount 覆盖 bundle（部署改动用）
```

> ⚠️ **`/app/.config` stores the QQ login session.** It is not "just configuration" —
> **restarting the QQ process empties `loginList`, and you must scan the QR code again.** For details see
> T2 in [troubleshooting.md](troubleshooting.md) (**a lesson paid for in blood**).

---

## 6. Version coupling of configuration files

| File | Permissions | Contents | Invalidated by a version change? |
|---|---|---|---|
| `runtime.json` | 644 | `webuiPort` / `hookAutoLoad` / `webuiHost` / `webuiTls` / `trustProxy` / log rotation | No (the structure is stable) |
| `onebot.json` | 644 | **Global** OneBot network configuration | No |
| `onebot_<uin>.json` | 600 | **Per-account** configuration (`mode: "snapshot"`) plus `statusCommand` / `historySync` / `notifications` | No |
| `webui.json` | 600 | `passwordHash` / `passwordSalt` (scrypt) / `mustChangePassword` | No |
| `ui.json` | 644 | WebUI appearance and layout | No |
| `consent.json` | 644 | `{ version, acceptedAt }` | ⚠️ **An EULA/PRIVACY update changes `version` → consent is requested again** |
| `machine-id` | 644 | A 32-character hexadecimal machine identity | No |
| `notifications.json` | 600 | `{ version: 1, debounceSeconds, channels }` | No |
| `vnc-password` | 600 root | The noVNC password (**unrelated to Haizakura's logic**) | No |

**Databases** (in per-account directories `/app/data/data/<uin>/`):

| File | Owner | Contents |
|---|---|---|
| `messages.db` | `onebot/message-store.ts` | Message history / media index / migration state |
| `reactions.db` | `onebot/reaction-store.ts` | Reaction records |
| `snowluma_identity.db` | `bridge/apis/contacts.ts` | User/group/group-member identity mapping |
| `sys-face-catalog.json` | `core/sys-face-catalog.ts` | System emoji catalog cache (at the `/app/data/data/` root) |

> **The schema has versioned migrations** (`classification_version` together with `CLASSIFICATION_VERSION`,
> checking column by column via `PRAGMA table_info` and then `ALTER TABLE`).
> **Always write a migration when changing table structure**; follow the existing `prepare*Schema()` pattern.

**EULA automation for bulk deployment**:

```bash
SNOWLUMA_ACCEPT_EULA=1
SNOWLUMA_ACCEPT_PRIVACY=1
```

---

## 7. QQ version coupling risk

### 7.1 Why the coupling is tight

**The hook depends on four internal features of `wrapper.node`**:

```
① C++ RTTI 类名（mangled，如 "N2nt10MSFServiceE"）
② vtable 槽位顺序（如 SessionInit 在 v[pos] ap+0x98）
③ 结构体字段偏移（如 msfCoreCallbackOffset）
④ 用于定位的锚点字符串（如 "MSFService::SessionInit"）
```

**A change to any of these four breaks the hook.** And the failure message says only `unresolved`, with no further detail.

### 7.2 ★ Difficulty matrix for adapting to a new QQ version

Precondition: **you have kept Haizakura's `.node` (with its `RuntimeTargets` constants) and `.so` (the generic engine).**
Effort is estimated for **one person already familiar with this process**.

| # | What Tencent changed | What breaks | What must change | Effort | Rewrite native? |
|---|---|---|---|---|---|
| **0** | **No new release** (same build) | — | Nothing | **0** | No |
| **1** | **Only function bodies changed** (class names / vtable layout / slot order unchanged) | **Nothing breaks** (RTTI resolution works by name + offset, not by implementation) | **Zero changes** | **0** | **No** |
| **2** | **Class renamed** (`nt::MSFService` → `nt::MSFServiceV2`) | The typeinfo name in `.node` no longer matches → `MSFService SessionInit/RTTI chain unresolved` | Change the typeinfo name/fragment constants in `.node` (**string level**) | **2–6 hours** | **No** |
| **3** | **vtable slot order changed** (a virtual function inserted/removed in the middle) | All slot offsets are wrong → the wrong function pointer is called → **crash or silent failure** (the most dangerous case) | Use a "string → xref → slot" script to **recompute all slot offsets** and update `msfCoreCallbackOffset` and friends | **0.5–2 days** | **No** (change configuration numbers) |
| **4** | **New virtual functions appended at the end** | The primary vtable's `offset_to_top` is still 0 and earlier slots are unchanged | **Usually zero changes** (as long as the target function is still in its original slot) | **Hours of verification** | No |
| **5** | **Multiple inheritance / virtual bases added to MSFService** (→ `__vmi_class_type_info`) | The `.so` imports only `__cxxabiv117` and `120`, **not 121** → resolution fails outright | **Must change the `.so` to support the `__vmi_class_type_info` layout** | **3–7 days** | **Yes** |
| **6** | **`.rodata` layout changed / the `"Xxx::SessionInit"` anchor string removed** | Every path relying on string anchors breaks | Find **new stable anchors** for each target (a new log string, a `what()` string, or `.eh_frame` structure) | **Days to 2 weeks** | **Yes** (very likely) |
| **7** | **`wrapper.node` stripped** (`.shstrtab` / section table removed) | The `.so` reads the section table **by section name** → `ELF section table is missing` | Switch to reading **program headers** (`PT_LOAD`/`PT_DYNAMIC`) plus a hard-coded section layout | **2–5 days** | **Yes** |
| **8** | **ABI/compiler changed** (mangling rules differ) | All name matching breaks | Change the matching rules (SnowLuma already has the `NSt2Cr` = `std::__cxx11` variant trait) | **1–3 days** | Half |
| **9** | **New architecture / packed** | Everything breaks | Redo from scratch | **Weeks** | Yes |
| **10** | **QQ changed its injection method** (sandbox, `/proc` permissions, `process_vm_readv` blocked) | `QQ runtime cannot read process memory` / `[RUNTIME_MEMORY_UNAVAILABLE]` | Switch to `ptrace(PTRACE_PEEKDATA)` or `/proc/pid/mem` | **2–4 days** | Yes |

### 7.3 Conclusion (in one sentence)

> **As long as Tencent does not touch "class names + inheritance structure + vtable slot order", adaptation costs
> 0–1 day, and only string/number configuration changes — no native code involved.**
>
> **Once the vtable shape changes (multiple inheritance/virtual bases), the native resolver must be rewritten.**

### 7.4 Tactical advice: turn "adaptation" into "running a script"

Because the "anchor string → xref site → slot" method is **fully mechanical**
(see [architecture.md §6.4](architecture.md)), **adaptation should become running one command and reading a diff**:

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

**Reading the diff result**:

| Diff observation | Corresponding case | What to do |
|---|---|---|
| Only function addresses changed; method names + slots unchanged | Case 1 | **Zero changes**; just run it |
| Method names still present but slots changed | Case 3 | Change the numbers in `.node` |
| Method names gone entirely | Case 2 / 6 | Change the strings in `.node` / find new anchors |
| `__vmi_class_type_info` appears | Case 5 | **The `.so` must be changed** |

> **Building your own `.so` in full is about 20–36 person-days (1–1.5 person-months)**,
> but **only the "offline resolver + adaptation scripts" takes 5–10 person-days** and covers the **most likely**
> cases 2/3/4. **Do not start by rewriting the `.so`.** See [contributing.md](../dev/contributing.md).

### 7.5 ⚠️ End-to-end verification is mandatory after adapting

**VTable replacement is the most fragile form of hook. A one-slot error does not crash immediately**;
instead it **sends messages down the wrong path** — which surfaces to users as:

```
"The QQ connection changed. Please restart QQ and try again."
```

> **Do not conclude adaptation succeeded just because "the process did not crash".**
> **After every adaptation you must do an end-to-end verification with real message send and receive.**

---

## 8. Version upgrade checklist

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

> For the **complete 12-entry RTTI failure string → slot mapping table**, see T4 in [troubleshooting.md](troubleshooting.md).

---

## 9. Known compatibility risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **A `wrapper.node` structural change breaks the hook entirely** | 🔴 Fatal | Pin the QQ version; monitor logs for `unresolved`; prepare a "degrade to notifications only" plan |
| 2 | **No source for the native layer, so bugs cannot be fixed** | 🔴 High | ① Fully back up the current working binaries (sha256) ② archive them outside the container ③ do not upgrade casually |
| 3 | **Auto-update points at a deleted repository ⇒ guaranteed 404** | 🟠 Medium | Edit `update/sources.ts`, or disable it with `SNOWLUMA_UPDATE_CHECK` |
| 4 | **`webuiHost: 0.0.0.0` + plaintext HTTP (TLS off)** | 🟠 Medium | Change to `127.0.0.1` + a reverse proxy, or enable TLS (`webui/tls.ts` is ready) |
| 5 | **`/api/debug/invoke` equals remote execution of arbitrary actions** | 🟠 Medium | Always enable TOTP + a strong password when exposing it publicly; consider an IP allowlist |
| 6 | **`accessToken` in `onebot.json` is plaintext (644 permissions)** | 🟠 Medium | Use a strong random token; tighten permissions to 600 |
| 7 | **`sqlcipher.ts` depends on QQ's library format** | 🟠 Medium | It already probes **12 combinations**, so resilience is decent; a QQ format change requires follow-up |
| 8 | **No backoff, no circuit breaker**, a fixed 1.5 s tick | 🟡 Low–medium | Keep `AUTO_LOAD_MAX_ATTEMPTS=3`; when improving it, do not slow down recovery |
| 9 | **The thread name `snowluma-pipe-w` is directly exposed** | 🟡 Low | **Native layer; cannot be changed** — just accept it |
| 10 | **An EULA/PRIVACY update requests consent again** | 🟡 Low | For bulk deployment use `SNOWLUMA_ACCEPT_EULA` / `_PRIVACY` |
| 11 | **Single point: one runtime process serves all accounts** | 🟡 Low | It is already a multi-PID design (`Map<pid, HookSession>`), so this is not a big problem |
| 12 | **Logs ~11 MB/day**; with `logRetainDays=7` that is ~80 MB resident | 🟢 Low | Rotation is automatic; watch the disk |
| 13 | **After stripping, the `.so` cannot be debugged at symbol level** | 🟡 Low–medium | Rely on `dynsym` + strings + disassembly |

---

## 10. Related documentation

| To learn about | Go to |
|---|---|
| How it actually works | [architecture.md](architecture.md) |
| How to troubleshoot problems | [troubleshooting.md](troubleshooting.md) |
| How to build from source | [build.md](../dev/build.md) |
| How to contribute | [contributing.md](../dev/contributing.md) |

---

*Baseline and fingerprints: 2026-11-12. All version numbers are measured values (from `.pnpm` region paths and files inside the container).
Verify the md5 before taking over.*
