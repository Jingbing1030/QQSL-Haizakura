# SnowLuma 内部结构与接手文档

> [!WARNING]
> 本内容完全由 AI 编写，请谨慎查看。

> **分析对象**：`@snowluma/runtime` v2.4.0（`linux-arm64`），容器 `snowluma`（镜像 `motricseven7/snowluma:latest`）
> **分析时间**：2026-11-12
> **分析方式**：纯静态逆向（objdump / readelf / strings）+ 运行中容器的只读取证
> **上游状态**：`https://github.com/SnowLuma/SnowLuma` 已删库

---

## 0. 证据等级约定

全文每条结论都标注等级，请务必区分：

| 标记 | 含义 |
| --- | --- |
| **【确证】** | 有直接证据：反汇编指令、字符串常量、源码片段（带行号）、运行中容器的实测输出 |
| **【强推断】** | 由多条确证交叉推出，但没有单一的"直接"证据（例如从导入符号表反推算法步骤） |
| **【推断】** | 合理推测，需后续验证 |
| **【未查清】** | 明确没搞明白，标出来给接手的你 |

**命令约定**：本文中 `/tmp/sl/index.mjs` 指主 bundle；`/tmp/sl/snowluma-linux-arm64.so` 指注入用共享库（以下简称 **`.so`**）；`/tmp/sl2/snowluma-linux-arm64.node` 指 N-API 宿主插件（以下简称 **`.node`**）。

---

## 1. 资产清单与元信息

### 1.1 文件清单（【确证】：`ls -la` + `docker exec snowluma ls -laR /app`）

| 路径（容器内） | 大小 | 作用 |
| --- | --- | --- |
| `/app/runtime/index.mjs` | 12,338,350 B / 367,423 行 | **主 bundle**，全部逻辑。**未压缩、未混淆**，可读 |
| `/app/runtime/package.json` | 602 B | 清单，`version: 2.4.0` |
| `/app/runtime/release.json` | 238 B | 发布元数据，`target: linux-arm64` |
| `/app/runtime/launcher.sh` | 448 B | 启动脚本 |
| `/app/runtime/check-node-version.cjs` | 858 B | Node 版本闸门 |
| `/app/runtime/native/snowluma-linux-arm64.node` | 318,640 B | **N-API 宿主插件**（进程枚举/注入/内存读取） |
| `/app/runtime/native/snowluma-linux-arm64.so` | 335,040 B | **注入到 QQ 进程内的共享库**（hook 后端） |
| `/app/runtime/native/websocket-linux-arm64.node` | 150,624 B | WebSocket 原生加速（ws 的 optional native addon） |
| `/app/runtime/native/ffmpeg/ffmpegAddon.linux.arm64.node` | 5,380,160 B | 语音转码（silk↔pcm/mp3），提供 `addon.convertToNTSilkTct` / `decodeAudioToFmt` / `getDuration` |
| `/app/runtime/native/sqlite/prebuilds/linux-arm64/@appthreat+sqlite3.{glibc,musl}.node` | 2.7 MB / 2.8 MB | SQLite 驱动（按 libc 选择，见 `runtimeLibc()`，index.mjs:2870） |
| `/app/runtime/client/` | — | **WebUI 前端静态资源**（`index.html` 6,210 B + `assets/` + `logo.png` 275 KB + `icons.svg`） |
| `/app/data/config/` | — | 配置目录（见 §C.4） |
| `/app/data/data/<uin>/*.db` | — | 每账号的 SQLite 数据库（messages/reactions/identity） |
| `/app/data/logs/snowluma-YYYY-MM-DD.log` | ~10 MB/天 | 按天轮转日志 |

**【确证】bundle 未做代码混淆**：`awk` 统计平均行长 32.6 字符、367,423 行 —— 是 esbuild/rolldown 打包后的**可读**产物，还保留了 `//#region <原文件路径>` 注释。这是本次逆向能如此彻底的根本原因。

### 1.2 版本与运行环境（【确证】`cat package.json` / `release.json` / `check-node-version.cjs`）

```
name: @snowluma/runtime   version: 2.4.0   type: module   main: index.mjs
engines.node: "^24.22.1 || >=26.12.1"      target: linux-arm64
```

`check-node-version.cjs` 的逻辑（Node 主版本 24 需 ≥24.22.1；26 需 ≥26.12.1；>26 放行）。

**【确证】`launcher.sh` 优先用同目录 `./node`**，否则回落 `$PATH` 并 `exec node ./index.mjs "$@"`。

---

## 2. A. 架构总览

### 2.1 进程模型（【确证】：容器内 `ps -eo pid,ppid,comm,args` + `ss -lntp`）

```
容器 snowluma (supervisord 作 PID 1)
│
├── PID 86   qq --no-sandbox --disable-gpu ...        ← QQ 本体（Electron）★ 被注入者
│    │        └─ 内含注入线程 TID 175 "snowluma-pipe-w"
│    ├── PID 95, 96          qq --type=zygote            ← Electron zygote
│    │    ├── PID 130        qq --type=zygote
│    │    ├── PID 9914       qq --type=zygote
│    │    ├── PID 9937       qq --type=zygote
│    │    ├── PID 9947       qq --type=zygote
│    │    └── PID 10004      qq --type=zygote
│    ├── PID 144             qq --type=utility --utility-sub-type=network.mojom.NetworkService
│    └── PID 9986            qq --type=utility --utility-sub-type=audio.mojom.AudioService
│
├── PID 87   node /app/runtime/index.mjs               ← SnowLuma runtime ★ 控制方
│    └── PID 116  node /app/runtime/index.mjs          ← worker 线程/进程，持有全部监听端口
│         ├── 0.0.0.0:5099   WebUI
│         ├── 0.0.0.0:3000   OneBot v11 HTTP
│         └── 0.0.0.0:3001   OneBot v11 WebSocket
```

> **值得注意**【确证】：runtime 的 **PID 87 与 116 是同一个可执行映像的父子关系**，且 116 才是真正监听端口的进程 —— 不是"worker_thread"（`ps` 里 worker_thread 不显示为独立条目）。**推断** 116 是 cluster/fork 出的子进程，或 `ps` 在容器内对线程的呈现方式；改用 runtime 内的 `worker_threads` 更可能。**【未查清】** 具体 fork 时机，但因 `SNOWLUMA_DEV_MODE` 与日志 writer 的存在，这不影响维护。

### 2.2 通信协议（【确证】：`index.mjs:1766-1990` 帧编码器 + `ss -xpn`）

**通道是 Unix domain socket**（Windows 上是对应的命名管道），命名刻意伪装成 Chromium Mojo：

```js
// index.mjs:1819-1820  【确证】
if (process.platform === "win32") return `\\\\.\\pipe\\mojo.${pid}.${suffix}`;
return path$1.join(runtimeDir, `mojo.${pid}.${suffix}.sock`);
```

- runtime 目录：`/tmp/runtime-<uid>`（本机 `/tmp/runtime-1000`）
- 实际文件【确证】：`/tmp/runtime-1000/mojo.86.control.sock`、`/tmp/runtime-1000/mojo.86.recv.sock`（各为 `srw-------`，权限 0600）
- 目录解析见 `resolveHookRuntimeDir()`（index.mjs:1721 起），可被 `SNOWLUMA_HOOK_RUNTIME_DIR` 覆盖

**为什么叫 `mojo`**【推断】：QQ 是 Electron 应用，本身就用 Chromium Mojo IPC。用这个名字，socket 出现在 `/proc/86/fd` 里时看起来像 QQ 自己的 IPC —— 这是**反检测设计**（呼应任务 D.14）。

**帧格式**【确证】`encodeFrame()` @ index.mjs:1941-1960，固定 **40 字节头** + 三段 body：

| 偏移 | 类型 | 字段 |
| --- | --- | --- |
| 0 | u32 LE | `PIPE_MAGIC` = **827344977** = `0x31504851`（按 `writeUInt32LE` 落盘即 ASCII **`"QHP1"`** —— **推断** 是 **Q**Q **H**ook **P**ipe v**1** 的缩写，与 `mojo` 命名一样属于内部标识） |
| 4 | u16 LE | version = 1 |
| 6 | u16 LE | `op`（操作码） |
| 8 | u32 LE | `requestId` |
| 12 | i32 LE | `status`（负数 = 错误码） |
| 16 | u32 LE | `flags`（`PipeFlagWantReply=1`、`PipeFlagLoggedIn=4`） |
| 20 | u32 LE | cmdBuf 长度 |
| 24 | u32 LE | msgBuf 长度 |
| 28 | u32 LE | bodyBuf 长度 |
| 32 | u64 LE | `value0`（常用于 uin） |
| 40… | — | cmdBuf ‖ msgBuf ‖ bodyBuf |

上限【确证】`MAX_PIPE_CMD_BYTES = 4096`、`MAX_PIPE_MSG_BYTES = 65536`、`MAX_PIPE_BODY_BYTES = 16 MiB`（index.mjs:1770-1772）。
超时【确证】：ACK 5 s / 回包 30 s / 探活 250 ms（index.mjs:1773-1775）。

**已观测的操作码**【确证/推断】：`op=17` 被用作"登录身份提示"（`sendAckOnly(17, BigInt(uin), ...)`，index.mjs:2106）——**推断**：op 空间是**手写枚举**，非 protobuf；`op=1` 用于 binary，`status===1` 表示"客户端私聊上报可用"（index.mjs:2619）。**【未查清】**完整 op 表 —— 定义在 `.so` 内部，不在 bundle 里。

### 2.3 bundle 模块结构（【确证】：467 个 `//#region` 标记，Python 提取）

```
python3 -c "import re;d=open('/tmp/sl/index.mjs','rb').read();\
print(len(re.findall(rb'//#region ([ -~\t]{1,200})',d)))"      → 467
```

原 monorepo 是 **8 个包**（region 数 = 源文件数）：

| 包 | region 数 | 职责 |
| --- | --- | --- |
| `../protocol/src` | 112 | **最大**。OIDB 服务、Highway 上传、消息推送解码、Web/QZone API |
| `../onebot/src` | 77 | OneBot v11 实现（动作、事件、网络适配器） |
| `src/`（DC 前缀为收件方自身 DSH 项目） | 33 | WebUI + update + runtime 主入口 |
| `../common/src` | 20 | 日志脱敏、错误、coerce、runtime 路径 |
| `../bridge/src` | 17 | **注入核心**：injector / hook-manager / pipe-watcher / qq-account |
| `../websocket/src` | 5 | WebSocket 客户端/服务端封装 |
| `../sqlite/src` | 3 | SQLite 驱动（native 加载、prebuild 选择） |
| `../proton/src` | 1 | 未展开（**【未查清】**功能，region 名被截断） |
| 第三方 | ~200 | `hono@4.13.13`、`@hono/node-server@2.1.5`、`@zxcvbn-ts/core@4.1.2`、`semver@7.7.4`、`htmlparser2@10`、`domhandler@5`、`entities@6` |

**完整 region 清单**已存于服务器 `/tmp/slx/regions_clean.txt`（467 行）。

### 2.4 模块依赖图（【确证】：region 路径 + 函数调用点）

```
                        ┌──────────────────────────┐
                        │  src/index.ts (入口)      │  index.mjs:367259 / 367414
                        │  解析 env / 选中 updateRoot│
                        └────────────┬─────────────┘
                                     │
        ┌────────────────────────────┼───────────────────────────────┐
        ▼                            ▼                               ▼
┌───────────────┐          ┌──────────────────┐            ┌─────────────────┐
│ src/webui/*   │          │ bridge/manager.ts│            │ src/update/*    │
│ :5099 WebUI   │◄────────►│  HookManager     │            │ 自动更新         │
│ hono + SSE    │          │  ┌────────────┐  │            │ GitHub+镜像     │
└───────┬───────┘          │  │pipe-watcher│  │            └─────────────────┘
        │                  │  └─────┬──────┘  │
        │                  │  ┌─────▼──────┐  │
        │                  │  │HookSession │  │  状态机: disconnected→connecting
        │                  │  │ (每 PID)   │  │         →connected→error
        │                  │  └─────┬──────┘  │
        │                  │  ┌─────▼──────┐  │
        │                  │  │ injector.ts│──┼──► .node addon (宿主插件)
        │                  │  └────────────┘  │      loadModuleManualAsync
        │                  │  ┌────────────┐  │      unloadModuleManualAsync
        │                  │  │qq-hook-    │──┼──► Unix socket (mojo.*.sock)
        │                  │  │client.ts   │  │      ↕ 40B 帧协议
        │                  │  └────────────┘  │
        │                  └────────┬─────────┘
        │                           │
        ▼                           ▼
┌─────────────────────────────────────────────────────────────┐
│ bridge/apis/*  (19 个)  ←→  protocol/src/**  (112 个)        │
│  contacts / group-admin / group-file / message / profile /   │
│  qzone / collection / interaction / system-face / web …      │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ onebot/src/** (77)                                           │
│  actions/* (16)  event-converter/* (8)  network/* (11)       │
│  modules/* (7)   message-store / media-store / reaction-store│
│  → ：3000 HTTP  ：3001 WS  以及 wsClients 出站               │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. B. 注入实现（最重要）

### 3.1 注入链路全步骤

**【确证】** `index.mjs:2754-2778`：

```js
async function injectHookProcess(pid) {                    // index.mjs:2763
	const addon = getNativeHookAddon();
	if (!addon) throw new Error(getNativeHookLoadError() ?? "hook native addon is not available");
	const injectableExt = platformInjectableExt();           // linux → "so"
	const dllPath = resolveHookNativePath(injectableExt);    // …/native/snowluma-linux-arm64.so
	if (!dllPath) throw new Error(`No hook ${injectableExt} found for ${process.platform}-${process.arch}`);
	return {
		method: "loadModuleManual",
		handle: await addon.loadModuleManualAsync(pid, dllPath)
	};
}
async function unloadHookProcess(pid, handle) {            // index.mjs:2774
	const addon = getNativeHookAddon();
	await addon.unloadModuleManualAsync(pid, handle);
}
```

完整链路（逐步，每步都有证据）：

```
① node /app/runtime/index.mjs                       【确证】ps: PID 87
        │
② getNativeHookAddon()                              【确证】index.mjs:2729
        │  resolveRuntimeNativePath("snowluma-linux-arm64.node")
        │  搜索 [<moduleDir>/native, <moduleDir>/../../runtime/native]   index.mjs:2696
        ▼
③ loadNativeAddon() → process.dlopen(mod, addonPath) 【确证】index.mjs:2717
        │  （不用 require()，因为 .node 不在 node_modules）
        ▼
④ listHookProcesses()  → addon.getAllMainProcessAsync()  【确证】index.mjs:2748-2762
        │  在 .node 内枚举 /proc，按 cmdline/heuristic 找出 "主 QQ 进程"
        ▼
⑤ shouldAutoLoadPid(pid)  过滤 Electron 子进程         【确证】index.mjs:5045
        │  Windows 上改走 getFileHoldersAsync()（按文件锁定位） index.mjs:2786
        ▼
⑥ addon.loadModuleManualAsync(pid, ".../snowluma-linux-arm64.so")  【确证】index.mjs:2771
        │  ★ 黑箱：ptrace + process_vm_writev + 手工 ELF 映射（见 §3.4）
        │  ★ 落地临时文件 /tmp/runtime-<uid>/orcexec.<6位随机>，随即 unlink
        ▼
⑦ .so 在 QQ 进程内被调用入口，启动 control/recv 两个监听 socket
        │  → /tmp/runtime-1000/mojo.86.{control,recv}.sock  【确证】ls -la
        ▼
⑧ .so 内 hook 引擎（nnphook::linux_backend）解析 wrapper.node 的
   MSFService / MSFCoreService，安装 VTable 替换       【确证】.so 字符串表 3912-3923
        ▼
⑨ runtime 用 net.createConnection(socketPath) 连上去  【确证】index.mjs:1825
        │  PipeClient 走 40 字节帧协议
        ▼
⑩ 双向：OneBot 动作 → bridge/apis → protocol → 帧 → .so → QQ 内部 MSF 发包
   QQ 收到消息 → .so 拦截 → recv socket → 帧 → onebot/event-converter → OneBot 事件
```

**可卸载**【确证】：`unloadModuleManualAsync(pid, handle)` 存在，WebUI 有 `/api/processes/:pid/unload` 路由（见 §C.3）。

### 3.2 native hook 模块的 6 个导出函数（【确证】：反汇编）

符号表（`readelf -sW --dyn-syms /tmp/sl/snowluma-linux-arm64.so`）——`.dynsym` 共 161 项，其中
**非 `UND` 的只有 8 项：2 个 `SECTION LOCAL`（`.init` / `.data`）+ 恰好 6 个 `FUNC GLOBAL DEFAULT`**，
即下面这 6 个就是**全部导出**：

```
0xcf1c  12 B  snowluma_linux_hook_backend_version
0xcf28  20 B  snowluma_linux_hook_is_loaded
0xcf3c  44 B  snowluma_linux_hook_start_dynamic
0xcf68  24 B  snowluma_linux_hook_stop_dynamic
0xcf80  12 B  snowluma_linux_hook_control_socket
0xcf8c  12 B  snowluma_linux_hook_recv_socket
```

**反汇编原文**（`objdump -d --start-address=0xcf1c --stop-address=0xcf68`）：

```asm
000000000000cf1c <snowluma_linux_hook_backend_version>:
    cf1c: adrp x0, 43000          ; 页基址 0x43000
    cf20: add  x0, x0, #0x7f0     ; → 0x437f0
    cf24: ret                     ; 返回 .rodata 中的字符串常量

000000000000cf28 <snowluma_linux_hook_is_loaded>:
    cf28: adrp x8, 61000
    cf2c: add  x8, x8, #0xc10     ; → 0x61c10
    cf30: ldarb w8, [x8]          ; LDARB = 带 acquire 语义的字节加载（原子读）
    cf34: and  w0, w8, #0x1       ; 取 bit0
    cf38: ret

000000000000cf3c <snowluma_linux_hook_start_dynamic>:
    cf3c: stp  x29, x30, [sp, #-16]!
    cf40: mov  x29, sp
    cf44: bl   3ef0 <getpid@plt>          ; 取自身 PID
    cf48: mov  w1, #0x1                   ; 第二参数 = 1
    cf4c: bl   cf98                       ; → 内部函数（socket 初始化）
    cf50: adrp x8, 61000
    cf54: add  x8, x8, #0xc10             ; 同一标志字节
    cf58: ldarb w8, [x8]
    cf5c: and  w0, w8, #0x1               ; 返回 "现在 is_loaded 吗"
    cf60: ldp  x29, x30, [sp], #16
    cf64: ret

000000000000cf68 <snowluma_linux_hook_stop_dynamic>:
    cf68: stp  x29, x30, [sp, #-16]!
    cf6c: mov  x29, sp
    cf70: bl   c3fc                       ; 内部 teardown 函数
    cf74: mov  w0, #0x1                   ; 恒定返回 1
    cf78: ldp  x29, x30, [sp], #16
    cf7c: ret

000000000000cf80 <snowluma_linux_hook_control_socket>:
    cf80: adrp x8, 61000
    cf84: ldr  x0, [x8, #1232]            ; → 0x614d0 : 全局 fd/句柄
    cf88: ret

000000000000cf8c <snowluma_linux_hook_recv_socket>:
    cf8c: adrp x8, 61000
    cf90: ldr  x0, [x8, #1264]            ; → 0x614f0 : 全局 fd/句柄
    cf94: ret
```

**结论**：

| 函数 | 实现思路 | 证据 |
| --- | --- | --- |
| `backend_version` | 返回 `.rodata` 常量指针，**零参数、无副作用** | `adrp/add 0x437f0` + `ret` |
| `is_loaded` | 原子读一个 **bool 全局**（`.bss` @ `0x61c10`）并取 bit0 | `ldarb` + `and #1` |
| `start_dynamic` | `getpid()` → 调用内部 `0xcf98(pid, 1)`（初始化 socket 服务）→ 返回新的 `is_loaded` 值 | `bl getpid@plt` / `bl cf98` / 再读同一 flag |
| `stop_dynamic` | 调用内部 teardown `0xc3fc`，**无条件返回 1** | `bl c3fc` + `mov w0,#1` |
| `control_socket` | 从 `.data`/`.bss` 读全局句柄返回（`0x614d0`） | 单条 `ldr x0,[x8,#1232]` |
| `recv_socket` | 同上，句柄在 `0x614f0` | 单条 `ldr x0,[x8,#1264]` |

**【确证】`backend_version` 的返回字符串**：

```bash
str=$(python3 -c "
d=open('/tmp/sl/snowluma-linux-arm64.so','rb').read()
# .rodata vaddr 0x437b0 == file off 0x437b0（本 ELF 同偏移）
print(d[0x437f0:0x437f0+40].split(b'\0')[0].decode())")
echo "$str"
# → snowluma-linux-hook-stub/0.2.0
```
（`.rodata` 段头：`PROGBITS 00000000000437b0 0437b0 005910 A 0 0 16`，vaddr==file offset，故 0x437f0 可直接按文件偏移读取。同串亦见 `strings` 第 3799 行。）

> ⚠️ **重要**：`.so` **被 strip 过**（`nm` 报 `no symbols`），但 **dynsym 完整保留**了这 6 个导出 —— 说明它们是**刻意的 ABI 契约**，`snowluma-linux-hook-stub` 这个自述名也印证：**`.so` 本身只是"stub/后端"，不做业务**。

### 3.3 `nnphook` 框架（【确证】：仅存于字符串/符号，无源码）

`.so` 与 `.node` 中唯一暴露出的 C++ 类型名（`strings` 第 3906、3894 行）：

```
St23_Sp_counted_ptr_inplaceIKN7nnphook13linux_backend14RuntimeTargetsESaIvELN9__gnu_cxx12_Lock_policyE2EE
St23_Sp_counted_ptr_inplaceIN12_GLOBAL__N_110PipeClientESaIvELN9__gnu_cxx12_Lock_policyE2EE
St23_Sp_counted_ptr_inplaceIN7nnphook5addon17ProcessEnumeratorESaIvELN9__gnu_cxx12_Lock_policyE2EE
```

demangle 后：

```cpp
std::_Sp_counted_ptr_inplace<nnphook::linux_backend::RuntimeTargets const, std::allocator<void>, __gnu_cxx::_Lock_policy::_S_atomic>
std::_Sp_counted_ptr_inplace<(anonymous namespace)::PipeClient, ...>
std::_Sp_counted_ptr_inplace<nnphook::addon::ProcessEnumerator, ...>
```

**还原出的 `nnphook` 设计**（【强推断】，依据 = 字符串表 + 导入符号 + 错误消息分层）：

```
nnphook/                        自研跨平台 hook 框架（命名空间 nnphook）
├── addon/                      N-API 侧（编进 .node）
│   └── ProcessEnumerator       枚举 /proc，识别"主 QQ 进程"
│       · hasWrapperNode        cmdline/maps 里是否有 wrapper.node
│       · hasMainRuntimeModule
│       · likelyMainProcess
└── linux_backend/              Linux 实现（编进 .so）
    ├── RuntimeTargets          ★ 核心：QQ 运行时结构体的地址集合
    │   · msfServiceTypeinfo        MSFService  的 typeinfo 名
    │   · msfServiceVtables         MSFService  的 vtable 地址
    │   · msfServiceTypeinfoName
    │   · msfServiceCandidates      候选（去重/消歧）
    │   · msfCoreTypeinfo           MSFCoreService 同上
    │   · msfCoreCallbackVtables
    │   · msfCoreCallbackOffset     回调在对象内的偏移
    │   · msfGetStatus / msfDidRecvResponseData   目标函数的解析结果
    │   · wrapperBase               wrapper.node 的加载基址
    │   · xrefFileOffsets / xrefRuntimeAddresses  交叉引用表
    │   · functionAddresses / functionRuntimeAddresses
    │   · RuntimeTargets 用 shared_ptr<const> 共享（immutable 快照）
    └── PipeClient              匿名命名空间里的 socket 客户端
```

**它 hook 哪些函数、怎么改指令** —— 【确证】目标名：

```
MSFService        MSFCoreService      SessionInit
MessageSvc.PbSendMsg                    ← 发送消息的 SSO 命令 ★
selfInfoOnLoginSuccess                  ← 登录成功回调
sendSsoInternal                         ← SSO 发包总入口
msfDidRecvResponseData                  ← 收包回调
msfGetStatus
CreateNTSessionShell / CreateGProSessionShell   ← 会话壳创建
wtlogin. / trpc.login. / QrCode.        ← 登录相关命令前缀
```

**机制**【强推断】：**不是 inline hook（不改指令流），而是 VTable 替换**。证据：

1. 错误串 `failed to install a resolved receive VTable`（strings 3890）
2. 错误串 `MSFService receive anchor/TaskManager RTTI chain unresolved`（3916）
3. `MSFCoreService packet-state callback/RTTI chain unresolved`（3920）
4. 字段名全是 `*Vtables` / `*Vtables` / `msfCoreCallbackOffset`
5. region 里没有 `detour`/`trampoline`/`mprotect`-改写代码段的意图；`.so` 虽导入 `mprotect`，但**更可能用于自身重定位**

> 也就是说：**hook = 在 QQ 的 C++ 对象里找到 MSFService 的 vtable，把特定槽位换成自己的函数指针**。
> 这是**最脆弱的一类 hook** —— 见 §E.3。

**跨平台设计差异**【确证】：

| 平台 | 注入方式 | 证据 |
| --- | --- | --- |
| **Linux** | `ptrace` + 手工 ELF 映射（`.so`） | §3.4 |
| **macOS** | **`DYLD_INSERT_LIBRARIES`**（dylib 注入），无枚举 addon | index.mjs:1789-1792 注释："on macOS the DYLD_INSERT injection model means there is no native enumerate-QQ-processes addon; the existence of our dylib's listener socket IS the proof that a QQ process is hooked"；index.mjs:2749 走 `listSnowlumaPipePidsSync()` |
| **Windows** | 命名管道 + `getFileHoldersAsync`（按文件占用定位 QQ 进程） | index.mjs:2779-2785、1819 `\\\\.\\pipe\\mojo.<pid>.<suffix>` |

### 3.4 注入技术：**ptrace + process_vm_writev + 手工 ELF 映射**（【确证】）

**证据链 1 —— `.node` 的导入符号**（`readelf -sW --dyn-syms`，`UND` 项）：

```
ptrace              process_vm_readv     process_vm_writev
mmap                munmap              mprotect
dlopen              dlsym               dladdr              dlerror
waitpid             pread               open                read
realpath            stat                fstat
syscall             __getauxval         getpid
```

**没有** `process_dlopen` / 目标进程内 `dlopen` 调用 —— 结合下述错误串，可断言**是手工映射**。

**证据链 2 —— `.node` 的错误消息（按调用顺序排列，等于把算法读出来了）**：

```
已确证的导入符号（.node）          对应的错误串
──────────────────────────────────────────────────────────────────
open/read/pread/fstat       →   "failed to open ELF file " / "failed to read ELF file "
                                "ELF file is too small" / "bad ELF magic"
                                "ELF header mapping is unavailable"
                                "failed to parse remote module "
realpath                    →   "/map_files/"  "mapped file identity: "
dladdr                      →   "dladdr failed for "
ptrace(PTRACE_SEIZE)        →   "PTRACE_SEIZE failed" / "PRoot PTRACE_ATTACH failed"
                                "PTRACE_SETOPTIONS failed"
ptrace(PTRACE_GETREGSET)    →   "PTRACE_GETREGSET failed" / "trace session has no saved registers"
ptrace(PTRACE_INTERRUPT)    →   "PTRACE_INTERRUPT failed"
ptrace(PTRACE_PEEKDATA)     →   "PTRACE_PEEKDATA failed"
ptrace(PTRACE_POKEDATA)     →   "PTRACE_POKEDATA failed"
process_vm_readv            →   "failed to read registers after remote call"
process_vm_writev           →   "QQ runtime cannot read process memory"
mmap (remote)               →   "remote mmap failed" / "failed to map ELF "
                                "target does not share the injector's mapped file "
ptrace(PTRACE_CONT)         →   "PTRACE_CONT failed" / "PTRACE_CONT failed after signal stop"
                                "PRoot syscall resume failed"
ptrace(PTRACE_DETACH)       →   "PTRACE_DETACH failed"
                                "ptrace register restore failed"
```

**证据链 3 —— 句柄契约**【确证】：

```
"handle must be {base, entry, size, exceptionTable}"   ← .node 字符串
"ManualMapHandle::base is 0"                           ← .node 字符串
"handle.base is 0"
"injection" / "runtimeResolution" / "processDiscovery" / "moduleInspection"  ← 结果字段名
```

**证据链 4 —— 动态实证（运行中容器，父 agent 采集，可复核）**：

```
# /proc/86/maps 中唯一的注入负载映射：
f99d4fda4000-f99d4fdb4000 rw-s 00000000 00:66 4270839  /tmp/runtime-1000/orcexec.bEkdOA (deleted)
f99d4fdb4000-f99d4fdc4000 r-xs 00000000 00:66 4270839  /tmp/runtime-1000/orcexec.bEkdOA (deleted)
```
- 同一 inode 两段映射：**先 `rw-s` 写入、再 `r-xs` 执行** —— 教科书式的两段式注入
- `(deleted)`：**落地后立刻 unlink，磁盘上查不到痕迹**
- 各 64 KB

**还原出的注入算法**【强推断，由证据链 1–4 交叉得出】：

```
loadModuleManualAsync(pid, soPath):
 1. open/read(soPath)                        → 读入 .so 全量
 2. 解析自身 ELF：段表/PT_DYNAMIC/RELATIVE 重定位/.dynsym/.eh_frame
 3. 建临时文件 /tmp/runtime-<uid>/orcexec.<rand6>，把 .so 写进去
 4. mmap 该文件 → 让 injector 与 target "share the mapped file"
    （对应错误串 "target does not share the injector's mapped file"）
 5. unlink(临时文件)                          → 磁盘无痕
 6. ptrace(PTRACE_SEIZE, pid)                 → 非侵入式 attach（不改 SIGSTOP 语义）
    （PRoot 兼容路径：PTRACE_ATTACH + 等待 SIGSTOP）
 7. PTRACE_GETREGSET 保存全部寄存器           → "trace session" 保存现场
 8. 用 PTRACE_POKEDATA / process_vm_writev 写入一段 stub
 9. 远程调用 mmap(NULL, size, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANON, -1, 0)
    （通过"远程系统调用"：改寄存器 → PTRACE_CONT 到 syscall 出口 → 读回 x0）
    ★ 错误串 "PRoot syscall resume failed" 就是这条路径
10. 把 .so 的 PT_LOAD 段复制到远程 mmap 区
11. 应用 relocations（RELATIVE + 解析依赖的 .dynsym）
    ★ 错误串 "dependency ELF dynamic table is invalid" 等一整套
12. mprotect 分段改为 r-x
13. 远程调用入口（entry），初始化 nnphook::linux_backend
14. PTRACE_DETACH + 恢复寄存器           → "ptrace register restore failed"
15. 返回 {base, entry, size, exceptionTable}
```

**【确证】`orcexec.*` 这个名字不在任何二进制的字符串表里**：

```bash
strings -a /tmp/sl2/snowluma-linux-arm64.node | grep -i orcexec   # 无输出
strings -a /tmp/sl/snowluma-linux-arm64.so   | grep -i orcexec   # 无输出
```
→ 说明文件名是**运行期拼出来的**（前缀 + 随机后缀）。**推断** 前缀取自 "force exec"/"or exec" 的片段，**未查清**确切构造位置（可能在 stub shellcode 里）。

**【未查清】**：`exceptionTable` 字段的作用（【推断】是给 C++ 异常展开用得 `.eh_frame` 注册，便于 hook 函数内抛异常不崩 QQ）。

---

## 4. C. 运行时功能

### 4.1 OneBot v11 实现（【确证】：`../onebot/src/**`，77 个 region）

**位置**：bundle 内 `../onebot/src/`，不在独立进程 —— 跑在 runtime 进程内。

**源文件结构**（region 清单）：

```
../onebot/src/
├── instance.ts / manager.ts / global-context.ts / instance-context.ts  实例与生命周期
├── api-handler.ts / action-kit.ts / types.ts / action-docs.ts
├── action-result-schemas.ts / action-args-schemas?          动作校验
├── actions/            (16)  contact-props, essentials, group-admin, group-album,
│                             group-info, info, index, message, qzone, qzone-public,
│                             request, stream-download, stream-*, system-*
├── event-converter/    (8)   element-codecs, envelope, index, to-message,
│                             to-notice, to-request, to-segment, utils
├── network/            (11)  adapter, http-post-adapter, http-server-adapter,
│                             http-sse-connections, http-trace, network-manager,
│                             quick-operation, utils, ws-client-adapter,
│                             ws-server-adapter, ws-server-connections
├── modules/            (7)   contact-actions, contact-props, media-actions,
│                             message-actions, ptt-trans-waiter, request-actions,
│                             status-command
└── 存储层: message-store, media-store(+migration), reaction-store,
            temp-session-store, stream-storage, history-persistence, history-sync,
            message-id(+resolver), reply-preview, instance-rkey, sqlite-open
```

**通信方式**【确证】：4 类，配置见 `onebot.json` / `onebot_<uin>.json`

| 类型 | 配置键 | 本机实际值 |
| --- | --- | --- |
| HTTP 服务端 | `networks.httpServers[]` | `0.0.0.0:3000`，path `/`，`messageFormat: "array"` |
| WS 服务端 | `networks.wsServers[]` | `0.0.0.0:3001`，role `Universal` |
| HTTP 客户端（上报） | `networks.httpClients[]` | 空 |
| WS 客户端（反向） | `networks.wsClients[]` | `ws://example.host:5028/onebot`，`reconnectIntervalMs: 5000` |
| SSE | `httpServers[].enableSse` | `false` |

**支持的动作**【确证】—— 从 `index.mjs` 抽出的字面量，共 **130+ 个**。分类摘录（完整表见服务器 `/tmp/slx/onebot-actions.txt`）：

- **系统/状态**：`get_status` `get_version_info` `get_login_info` `get_online_clients` `get_credentials` `get_cookies` `get_csrf_token` `get_clientkey` `get_rkey` `get_rkey_server` `can_send_image` `can_send_record` `can_at_all`
- **消息发送**：`send_msg` `send_private_msg` `send_group_msg` `send_group_forward_msg` `send_private_forward_msg` `send_forward_msg` `send_poke` `send_like` `send_ark_share` `send_group_ark_share` `send_tuwen_ark` `send_custom_face` `send_flash_msg` `send_qzone_msg` `send_group_ai_record` `send_group_sign` `send_to_new_members`
- **消息读取**：`get_msg` `get_forward_msg` `get_friend_msg_history` `get_group_msg_history` `get_record` `get_record_text` `get_image` `get_ptt_text` `get_emoji_likes` `get_msg_emoji_likes`
- **消息操作**：`delete_msg` `mark_msg_as_read` `mark_group_msg_as_read` `mark_private_msg_as_read` `set_essence_msg` `delete_essence_msg` `get_essence_msg_list`
- **好友**：`get_friend_list` `get_friends_with_category` `get_stranger_info` `delete_friend` `set_friend_remark` `set_friends_category` `get_unidirectional_friend_list` `set_friend_add_request` `get_doubt_friends_add_request` `set_doubt_friends_add_request`
- **群**：`get_group_list` `get_group_info` `get_group_info_ex` `get_group_detail_info` `get_group_member_list` `get_group_member_info` `get_group_honor_info` `get_group_at_all_remain` `get_group_shut_list` `get_group_system_msg` `get_recent_contact` `create_group` `get_group_tags` `delete_group_tag`
- **群管理（最大一类，26 个）**：`set_group_kick` `set_group_ban` `set_group_anonymous` `set_group_anonymous_ban` `set_group_card` `set_group_admin` `set_group_admin_permissions` `get_group_admin_permissions` `set_group_add_option` `set_group_add_request` `set_group_admin_receive_verify` `get_group_admin_settings` …
- **群文件**：`get_group_root_files` `get_group_files_by_folder` `create_group_file_folder` `delete_group_file` `delete_group_file_folder` `get_group_file_url` `get_group_file_system_info` `get_fileset_id` `get_fileset_info` `download_fileset` `upload_*`
- **媒体下载/流**：`download_file` `download_file_stream` `download_file_image_stream` `download_file_record_stream` `download_url` `download_fileset`
- **表情**：`fetch_custom_face_list` `add_custom_face` `delete_custom_face` `modify_custom_face` `move_custom_face` `order_custom_face` `fetch_custom_face_detail` `fetch_sys_face` `fetch_sys_faces`
- **资料**：`set_profile` `set_self_longnick` `set_input_status` `get_profile_like` `get_like` `set_diy_online_status`
- **收藏**：`create_collection` `get_collection_list`
- **QZone（一大类）**：`get_qzone_feeds` `get_qzone_home_feeds` `get_qzone_msg_list` `get_qzone_msg_detail` `get_qzone_profile` `get_qzone_feed_detail` `delete_qzone_msg` `get_qzone_public_feeds` `get_qzone_public_comments` `get_qzone_public_replies` `get_qzone_public_feed_detail` `get_qzone_public_capabilities` `delete_qzone_public_comment` `delete_qzone_public_reply` `get_qzone_share_ark`
- **其他**：`get_ai_characters` `get_ai_record` `get_group_todo_list` `send_packet` `get_mini_app_ark` `get_group_album_list` `get_group_album_media_list` `set_group_album_media_like` `get_group_share_link` `get_share_link` `get_group_signed_list`

**【确证】它明确对齐 NapCat 语义**（注释自述，说明作者以 NapCat 为兼容基准）：
- index.mjs:6958 `"stream marker (mirrors NapCat's OB11Response.ok(data, echo, true))"`
- index.mjs:6981 `"mirroring NapCat's BaseDownloadStream"`
- index.mjs:121355 `"mirror NapCat's PacketMsgMarkFaceElement.buildElement"`
- index.mjs:309231 `"mirrors NapCat"`
- index.mjs:345342 `"mirrors NapCat's parseCardChangedEvent"`

**额外特性**【确证】：`statusCommand`（`onebot_<uin>.json` 内）—— 群内触发 `#sl` 查询状态，`cooldownSeconds: 5`，`swallow: false`；`historySync`（默认关）；`notifications.channelIds`。

### 4.2 WebUI（【确证】）：端口 5099

**技术栈**【确证】：`hono@4.13.13` + `@hono/node-server@2.1.5`（region 里可见 `hono/dist` 的 7 个 + router 的 6 个）。
**前端**【确证】：`/app/runtime/client/` 静态文件，由 `src/webui/static-*.ts` 提供；`app.get("*")` 兜底 SPA。
**鉴权**【确证】：`webui.json` 存 `passwordHash` + `passwordSalt` + `mustChangePassword` + 时间戳；用 Node `crypto.scryptSync` + `timingSafeEqual`（index.mjs:20/22 的 import）。支持 **TOTP 两步验证**（`src/webui/totp.ts`，路由 `/api/auth/totp/*`，注释引用 RFC 4226/6238）。密码强度用 `@zxcvbn-ts/core`（`/api/auth/check-strength`）。

**全部 API 路由**【确证】（`grep -oE '(app)\.(get|post|delete)\(\s*"[^"]+"'`）：

```
GET   /                              GET   /status
GET   /sources                       GET   /robots.txt
GET   /index.html                    GET   /avatar/:uin
GET   /ui-asset/background
POST  /download                      POST  /restart
POST  /sources                       POST  /sources/test

认证
POST  /api/login                     POST  /api/logout
GET   /api/auth/state                GET   /api/auth/totp
POST  /api/auth/change-password      POST  /api/auth/check-strength
POST  /api/auth/totp/begin           POST  /api/auth/totp/confirm
POST  /api/auth/totp/disable         POST  /api/auth/totp/recovery-codes
GET   /api/agreements                POST  /api/agreements/record-consent

状态与配置
GET   /api/status                    GET   /api/system
GET   /api/connections               GET   /api/processes
GET   /api/qq-list                   GET   /api/config/:uin
POST  /api/config/:uin               GET   /api/global-config
POST  /api/global-config

进程/hook 管理  ★ 接手最常用
POST  /api/processes/:pid/load       POST  /api/processes/:pid/unload
POST  /api/processes/:pid/refresh

日志
GET   /api/logs                      GET   /api/logs/stream        (SSE)
GET   /api/logs/level                POST  /api/logs/level
GET   /api/logs/export/trace

UI 与流
GET   /api/ui                        POST  /api/ui
GET   /api/ui/public                 POST  /api/ui/background
DELETE /api/ui/background
GET   /api/state/stream              (SSE, state-bus.ts)

调试  ★ 极强，等于远程执行
GET   /api/debug/actions             POST  /api/debug/invoke
POST  /api/debug/invoke-stream       POST  /api/debug/upload
GET   /api/debug/stream

通知
GET   /api/notifications/config      GET   /api/notifications/recent
POST  /api/notifications/config      POST  /api/notifications/test

系统维护
GET   /api/system/settings           POST  /api/system/settings
GET   /api/system/storage            POST  /api/system/storage/cleanup
POST  /api/system/storage/settings
GET   /api/system/backup/export      POST  /api/system/backup/import
GET   /api/system/tls/cert           POST  /api/system/tls/cert
DELETE /api/system/tls/cert
GET   /api/update/check
```

**`SNOWLUMA_WEBUI_TARGET`**【确证】：index.mjs:348340，只认一个值 —— `maibot`（"麦麦 / 一键包"，默认样式 `millennium`）。用于一键包场景的 UI 主题预置。
**TLS**【确证】：`src/webui/tls.ts` + `webui.json` 的 `webuiTls.enabled`（当前 `false`）。
**反代信任**【确证】：`trustProxy` 配置 + `src/webui/client-ip.ts`。

### 4.3 数据库（【确证】：schema 原文 + 容器内文件）

**三类 SQLite 库**，按账号分目录 `/app/data/data/<uin>/`：

| 文件 | 大小（实测） | 归属 | 内容 |
| --- | --- | --- | --- |
| `messages.db` | 70.8 MB（+4 MB WAL） | `onebot/message-store.ts` | 消息历史 / 媒体索引 / 迁移状态 |
| `reactions.db` | 213 KB（+4 MB WAL） | `onebot/reaction-store.ts` | 贴表情记录 |
| `snowluma_identity.db` | 1.07 MB（+4 MB WAL） | `bridge/apis/contacts.ts` | 用户/群/群成员身份映射 |
| （另有）`sys-face-catalog.json` | 174 KB，在 `/app/data/data/` 根 | `src/sys-face-catalog.ts` | 系统表情目录缓存 |

> 全部开启 WAL（有 `-shm`/`-wal`）。驱动是 `@appthreat/sqlite3` prebuild，按 libc 选 glibc/musl（index.mjs:2860-2875）。

**`messages` 表**【确证】index.mjs:40633：

```sql
CREATE TABLE IF NOT EXISTS messages (
  message_hash            INTEGER PRIMARY KEY,
  is_group                INTEGER NOT NULL,
  session_id              INTEGER NOT NULL,
  sequence                INTEGER NOT NULL,
  sequence_authoritative  INTEGER NOT NULL DEFAULT 1,
  event_name              TEXT    NOT NULL,
  client_sequence         INTEGER NOT NULL DEFAULT 0,
  private_direction       INTEGER NOT NULL DEFAULT -1,
  random                  INTEGER NOT NULL DEFAULT 0,
  timestamp               INTEGER NOT NULL DEFAULT 0,
  data                    TEXT,
  classification_version  INTEGER NOT NULL DEFAULT 1
  -- 运行期 ALTER 追加： media_data TEXT
);
```
索引：`idx_messages_session_seq`、`idx_messages_session_authoritative_seq`、`idx_messages_private_client_seq`、`idx_messages_private_client_direction`。
迁移逻辑 `prepareMessageStoreSchema()`（index.mjs:40654）用 `PRAGMA table_info` 逐列判断后 `ALTER TABLE`，**有版本化迁移**（`classification_version` 配合 `CLASSIFICATION_VERSION`）。

**`media_entries` / `media_keys` / `media_migration_state` / `message_store_migration_state` / `private_recall_tombstones`** 同库（【确证】表名存在）。

**`users` / `groups` / `group_members`**【确证】index.mjs:344318：

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE, uin INTEGER UNIQUE,
  nickname TEXT NOT NULL DEFAULT '', remark TEXT NOT NULL DEFAULT '',
  is_friend INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_identity_users_uid ON users(uid);
CREATE INDEX idx_identity_users_uin ON users(uin);

CREATE TABLE IF NOT EXISTS groups (
  group_id INTEGER PRIMARY KEY, group_name TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '', member_count INTEGER NOT NULL DEFAULT 0,
  member_max INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (...)
CREATE INDEX idx_identity_group_members_group_active ...
CREATE INDEX idx_identity_group_members_group_uid ...
CREATE INDEX idx_identity_group_members_group_uin ...
```

**`reactions`**【确证】index.mjs:342496：

```sql
CREATE TABLE IF NOT EXISTS reactions (
  group_id INTEGER NOT NULL, msg_seq INTEGER NOT NULL,
  emoji_id TEXT NOT NULL, emoji_type INTEGER NOT NULL DEFAULT 1,
  operator_uin INTEGER NOT NULL, operator_uid TEXT NOT NULL DEFAULT '',
  set_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, msg_seq, emoji_id, operator_uin)
);
CREATE INDEX idx_reactions_msg_emoji ON reactions (group_id, msg_seq, emoji_id, set_at);
```

**驱动自检**【确证】`assertBinding()`（index.mjs:2850）：要求 `NATIVE_INTERFACE_VERSION === 1`，并校验 `OPEN_READONLY=1 / OPEN_READWRITE=2 / OPEN_CREATE=4 / OPEN_FULLMUTEX=65536` —— 说明**自研了一层薄封装**，替换 SQLite 版本时要保持这个接口。

### 4.4 登录 / 账号管理（【确证】+【强推断】）

**路径推导**【确证】index.mjs:3085、3128：

```js
var LOGIN_DB_SEGMENTS = ["nt_db", "login.db"];
if (process.platform === "win32") return path.join(root, account.uin, "nt_qq", "nt_db", "nt_msg.db");
return path.join(root, accountDirName(account.uid), "nt_db", "nt_msg.db");
```
即 Linux 下 QQ 数据在 `~/.config/QQ/<uid-hash>/nt_db/`（`accountDirName(uid)` 做了目录名映射）。

**★ sqlcipher.ts —— 解密 QQ 本地库拿 uin**【确证】index.mjs:3164-3300。这是最敏感也最关键的模块：

```js
var DATABASE_HEADER_SIZE = 1024;   // QQ NT 在 SQLCipher 流前加的客户端头
var PAGE_SIZE  = 4096;
var SALT_SIZE  = 16;
var IV_SIZE    = 16;
var KEY_SIZE   = 32;
var KDF_ITERATIONS       = 4e3;    // SQLCipher v4 PBKDF2 迭代数
var HMAC_KEY_ITERATIONS  = 2;
var HMAC_SALT_MASK       = 58;     // 0x3A，HMAC salt = page salt XOR 这个
var WAL_HEADER_SIZE = 32; var WAL_FRAME_HEADER_SIZE = 24;
var SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");
```

布局（源文件注释原文）：
```
[ 1024-byte client header ][ page 1 ][ page 2 ] ...
                            ^ KDF salt = page 1 前 16 字节
每页尾部 = IV(16B) || page HMAC，向上取整到 AES 块大小
page 1 的密文从 16 字节 salt 之后开始 —— salt 顶掉了明文 "SQLite format 3" 魔数
```

**关键设计**【确证】：`PAGE_HMAC_ALGORITHMS` —— 因为 page-HMAC 与 KDF-HMAC 的算法**跨客户端版本不固定**，代码**逐库探测 12 种组合**（先试 `cipher_use_hmac = OFF`，再逐个 digest），而不是写死。
验证函数 `verifyPageOne()`：HMAC 开启时在**密文**上重算 HMAC；关闭时解密后检查 SQLite 头部字段（`hasSqliteHeaderFields()`：pageSize 为 1 或 2 的幂、`body[5]===64`、`body[6]===32`、`body[7]===32`）。
密钥派生：`deriveKey()` = `pbkdf2Sync(passphrase, salt, 4000, 32, kdfHmac)`。
**WAL 特殊处理**【确证】：源文件注释 "A WAL is not wrapped in SQLCipher's envelope the way the main file is" —— 单独解析 WAL 帧。

**账号发现与持有者定位**【确证】：

```js
async function getDatabaseHolders(dbPath) {          // index.mjs:2781
	if (process.platform === "win32") return getWindowsHolders(dbPath);
	return process.platform === "linux" ? getLinuxHolders(dbPath) : [];
}
```
- **Windows**：走 addon 的 `getFileHoldersAsync(dbPath)`（内核文件句柄枚举）
- **Linux**：**读 `/proc/locks`**，按 `dev:inode` 匹配（`deviceInodeKey()`，index.mjs:2826），再读 `/proc/<pid>/comm` 拿进程名，并 `isQqProcessName()` 过滤（`"qq"` / `"QQ.exe"`）。**不需要 root** —— 这是很聪明的做法。

**多账号**【确证】：`/app/data/config/onebot_<uin>.json` 是**每账号独立配置**（实测 `onebot_<uin>.json` 存在）。`/app/data/data/<uin>/` 每账号独立库。WebUI 有 `/api/qq-list` 与 `/api/config/:uin`。
**账户监视**【确证】：`qq-account/watch.ts`；登录协商常量 `LOGIN_RECONCILE_INTERVAL_MS = 3000`、`LOGIN_IDENTITY_OBSERVE_INTERVAL_MS = 30000`（index.mjs:3726-3727）；`reconcileLoginIdentity(uin)` 通过 `op=17` 帧上报身份（index.mjs:2100-2106），注释强调"This does not change login state; readiness still requires peer confirmation"。

---

## 5. D. 稳定性与风控

### 5.1 zygote 过滤 `shouldAutoLoadPid`（【确证】：完整源码 index.mjs:5034-5059）

```js
/**
* Filter for auto-load only. Returns false for Linux Electron child
* processes (zygote/renderer/gpu/utility), which the native enumerator
* mis-classifies as "main QQ" because their cmdline contains "qq" and
* they transiently inherit wrapper.node via fork copy-on-write.
*
* Injecting into a zygote spawns the hook's resolver thread inside it;
* every renderer Electron later forks then inherits that thread + the
* partially-init'd hook state, which breaks QQ's IPC and login UI.
*
* Manual loadProcess() bypasses this gate — the operator is responsible
* for picking the right PID from WebUI.
*/
function shouldAutoLoadPid(pid, log) {
	if (process.platform !== "linux") return true;
	if (process.env.SNOWLUMA_HOOK_AUTOLOAD_ALL === "1") return true;
	let cmdline;
	try {
		cmdline = fs$1.readFileSync(`/proc/${pid}/cmdline`, "utf8");
	} catch {
		return true;
	}
	if (cmdline.includes("--type=")) {
		const type = /--type=([^\0\s]+)/.exec(cmdline)?.[1] ?? "unknown";
		log.info("auto-load skip: PID=%d is an Electron child process (--type=%s)", pid, type);
		return false;
	}
	return true;
}
```

**它在防什么**（源码注释已写得很清楚，逐条解释）：
1. **误判**：Electron 子进程（zygote/renderer/gpu/utility）的 **cmdline 里也含 `qq`**，而且**通过 fork 的 copy-on-write 短暂继承 `wrapper.node` 映射**，所以 `.node` 的枚举器会把它们错认成"主 QQ"。本机实测可验证这一点 —— `ps` 输出里 PID 95/96/9914/9937/9947/10004 全是 `qq --type=zygote`。
2. **后果**：注入进 zygote 会**在 zygote 里启动 hook 的 resolver 线程**；之后 Electron fork 出的**每个 renderer 都会继承该线程 + 半初始化的 hook 状态**，直接**搞坏 QQ 的 IPC 和登录界面**。
3. **判别方法**：读 `/proc/<pid>/cmdline`，含 `--type=` 就跳过。**简单且有效** —— 主进程 pid 86 的 cmdline 是 `qq --no-sandbox --disable-gpu ...`，不含 `--type=`。
4. **逃生舱**：`SNOWLUMA_HOOK_AUTOLOAD_ALL=1` 全局放行。
5. **手动加载绕过**：`/api/processes/:pid/load` 不走这个闸门 —— 由操作员自负责任。

**旁证**：`.so` 里也有 `zygote` 之外的守卫 —— `isTransientLibcMappingError()`（index.mjs:5033）匹配 `"target process does not map /libc.so.6 while resolving mmap"`，说明**注入器要求目标进程已映射 libc**（即已完成动态链接），zygote 早期恰好不满足。

### 5.2 崩溃恢复 / 重连（【确证】）

**核心：`pipe-watcher.ts` + `HookSession` 状态机**

- **`HookManager`** 以 1500 ms 为默认 tick（`DEFAULT_INTERVAL_MS = 1500`，`MIN_INTERVAL_MS = 250`，index.mjs:4501-4502）驱动 `pipe-watcher`。
- 每 tick 做的事【确证】index.mjs:4898-4907：
  ```js
  if (this.disposed) return;
  this.refreshAccounts();
  for (const session of this.sessions.values()) {
      const autoLoad = this.autoLoadAttempts.get(session.pid);
      if (autoLoad && !autoLoad.inFlight && session.status === "error"
          && isTransientLibcMappingError(session.error)) {
          this.runAutoLoad(session, autoLoad);  continue;
      }
      if ((session.status === "connecting" || session.status === "disconnected"
           || session.status === "error") && this.pipeWatcher.isPipeLive(session.pid))
          session.onPipeUp();
  }
  ```
  → **每个 tick 都会重试卡在 connecting 的会话**，并在管道复活时驱动重连。
- **探活机制**【确证】：`QqHookClient.listLivePipes(pids)` 扫描 runtime 目录里 `mojo.<pid>.control.sock`（index.mjs:1815 `listSnowlumaPipePidsSync` / `1855 listLiveLinuxPipePids`），且**必须真正 `connect()` 成功才算活**（`isConnectableUnixSocket()`，250 ms 超时）——避免被残留的 socket 文件骗到（index.mjs:2135 注释）。
- **自动加载重试上限**【确证】：`AUTO_LOAD_MAX_ATTEMPTS = 3`（index.mjs:4675）。策略是**只对瞬时错误重试**：
  - `isTransientLibcMappingError()` → 重试（可能在 3 次内"recovered"）
  - 其他错误 → **判定为永久失败，立即放弃**（`reason=permanent_failure`），避免无意义重试
  - 日志有两档：`auto-load retry pending`（warn）/ `auto-load retry exhausted`（warn）/ `auto-load recovered: PID=%d attempt=%d/3`（info）
- **幂等重连**【确证】：`HookSession.onPipeUp()` / `onPipeDown()` 带 `reconcilePipeUp/Down`，注释说明"幂等，可在 watcher 每次 tick 调用"，且能 **adopt pre-existing hooks** —— **SnowLuma 自己重启后能接管 QQ 里已有的 hook**，不需重新注入 QQ。这是很重要的运维性质。
- **无退避（no backoff）**【确证】：`grep -aic backoff /tmp/sl/index.mjs` → **1**，但该唯一命中位于
  **内嵌的 zxcvbn 密码字典**（index.mjs:359688，`"backoff"` 被当作弱密码收录），**与重连逻辑无关**。
  同理 `jitter`（1 次命中，同一字典行）与 `circuit`（1 次命中，同一字典行）也是**假阳性**。
  → **结论：没有任何退避 / 抖动 / 熔断实现**（**未查清**项：如需 100% 确认，可 `grep -an` 排除 359688 行后复查，
  但代码里 `AUTO_LOAD_MAX_ATTEMPTS=3` + 固定 tick 已足以说明设计意图）。重连策略就是
  **"固定 1.5 s tick + 上限 3 次的瞬时错误重试"**。
- **OneBot 侧重连**【确证】：只有 WS 客户端有 `reconnectIntervalMs`（默认 `DEFAULT_RECONNECT_INTERVAL_MS = 5000`，index.mjs:342082），校验范围 1000 ms ~ `NODE_TIMER_MAX_MS`（index.mjs:5389）。心跳 `HEARTBEAT_INTERVAL_MS = 30000`。
- **日志 writer 有自己的恢复**【确证】：index.mjs:599-698 有 `degraded` 状态 + `retry(force)`，注释"log writer retry is rate-limited"；还有 `recoverSharedWriterForWrite()`（index.mjs:1093）。
- **进程回收**【确证】：`REAPER_INTERVAL_MS = 300000`（5 分钟，index.mjs:37082）。
- **没有独立的 watchdog 进程**【确证】：`watchdog` 3 次命中全部是**别的语义**（卡住的请求的 idle watchdog、启动告警的监控），不是存活性守护进程。**容器层靠 supervisord**（PID 1）。

> **结论**：稳定性设计是**"watchdog 式轮询 + 幂等重连 + 有限重试"**，**没有指数退避、没有熔断**。这对接手是个明确的改进点（见 §E.4）。

### 5.3 风控对抗（【确证】）

> ⚠️ 严格说，以下多数是**反"被用户/QQ 检测到"**（隐蔽性），**不是**对抗腾讯服务端风控。真正与腾讯风控相关的是"协议行为像官方客户端"（走真实 MSF 通道，见 §6.3）。请勿过度解读。

**① socket 伪装成 Chromium Mojo**【确证】：命名 `mojo.<pid>.control.sock` / `mojo.<pid>.recv.sock`（index.mjs:1819-1820）。QQ 本体是 Electron，Mojo 是 Chromium 的 IPC 框架名 —— 在 `/proc/<pid>/fd`、`ss -xpn` 里看起来像 QQ 自己的 IPC。

**② 注入后立刻 unlink，磁盘无痕**【确证（动态）】：
```
/tmp/runtime-1000/orcexec.bEkdOA (deleted)
```
`maps` 里带 `(deleted)` 标记。**且 `orcexec` 这个字符串在两个二进制里都搜不到**（`strings | grep -i orcexec` 无输出）→ 运行期拼装。

**③ 临时文件名随机化**【确证（动态）】：`orcexec.bEkdOA` —— 6 位随机后缀。

**④ 环境变量清理**【推断】：`.so` 导入了 `unsetenv`（strings:11）与 `getenv`（12），但 `index.mjs` **没有引用 `unsetenv`** → **推断** 是 `.so` 在被注入后清理自己的环境变量痕迹。**【未查清】**具体 unset 了哪些。

**⑤ 线程名伪装/标识**：注入线程名 `snowluma-pipe-w`【确证（动态）】；`.so` 里有 `pthread_setname_np`（strings:73）。这里**没有伪装** —— 线程名直接暴露了 SnowLuma。**推断**：作者认为线程名比进程行为更难被发现，或没在意。

**⑥ 进程枚举里的 "likelyMainProcess" 启发式**【确证】：`.node` 字符串含 `likelyMainProcess`、`hasWrapperNode`、`hasMainRuntimeModule`、`matchedHints`、`linuxqq`、`ntqq`、`qqnt`、`libqq`、`app_launcher.node`、`/opt/QQ/`、`/map_files/`。→ 通过在 `/proc/*/maps` 里找特定模块名来识别 QQ。

**⑦ 明确的"非对抗"设计**【确证】：有 `EULA.md`（12,290 B）、`PRIVACY.md`（10,510 B）、`consent.json`（记录 `acceptedAt`）、`SNOWLUMA_ACCEPT_EULA` / `SNOWLUMA_ACCEPT_PRIVACY` 环境变量。→ **项目刻意保持合规姿态**，没有隐藏/混淆自身存在的意图。

**⑧ 无混淆、无加密、无 license 校验绕过**【确证】：bundle 未混淆（平均行长 32.6 字符）；`package.json` 只有 `license: "SEE LICENSE IN LICENSE"`。

> ### ⚠️ 没有找到的东西（重要，避免你去找不存在的东西）
> - **无 `jitter`**（grep 零命中）
> - **无 `anti-detect` / `anti-detection`**（零命中）
> - **无 `backoff` / `jitter` / `circuit breaker`**（代码中；唯一命中均在内嵌 zxcvbn 密码字典 index.mjs:359688 行）
> - **无设备指纹伪造 / `device` 相关伪造**（`device` 命中均为无关上下文）
> - **无 `sign` 签名伪造**（命中的是 `signed_list`、`group-signed` 等业务动作）
> - **无请求频率伪装**（除 `statusCommand.cooldownSeconds` 这类功能性的）

### 5.4 配置项完整清单（【确证】）

#### A) `SNOWLUMA_*` 环境变量（36 个，`grep -oE 'SNOWLUMA_[A-Z0-9_]+' | sort | uniq -c`）

| 变量 | 命中 | 用途（含证据行号） |
| --- | --- | --- |
| `SNOWLUMA_HOOK_AUTOLOAD_ALL` | 1 | `=1` 时放行所有 PID 自动注入，绕过 zygote 过滤（index.mjs:5047） |
| `SNOWLUMA_HOOK_AUTOLOAD` | 1 | 覆盖 `runtime.json` 的 `hookAutoLoad`（index.mjs:367403） |
| `SNOWLUMA_HOOK_RUNTIME_DIR` | 4 | 指定 `mojo.*.sock` 所在目录（index.mjs:1721；跨进程读取时另查目标进程 environ，1723-1744） |
| `SNOWLUMA_HOOK_ACK_TIMEOUT_MS` | 2 | 控制通道 ACK 超时（默认 5000，index.mjs:2078） |
| `SNOWLUMA_PACKET_TIMEOUT_MS` | 2 | 包（业务请求）超时（index.mjs:1687） |
| `SNOWLUMA_SESSION_RELEASE_DEADLINE_MS` | 2 | 会话释放截止时间（index.mjs:343257-343259） |
| `SNOWLUMA_STREAM_DIR` | 2 | 流式下载的落地目录（index.mjs:17568，非法时 warn 并忽略） |
| `SNOWLUMA_MAX_BINARY_DOWNLOAD_BYTES` | 1 | 二进制下载大小上限（index.mjs:17954） |
| `SNOWLUMA_HTTP_DOWNLOAD_TIMEOUT_MS` | 1 | HTTP 下载超时（index.mjs:17941） |
| `SNOWLUMA_DOWNLOAD_FILE_TIMEOUT_MS` | 2 | `download_file` 动作超时（⚠️ 与上一个不同，见 index.mjs:17937 注释） |
| `SNOWLUMA_NOTIFICATION_HTTP_TIMEOUT_MS` | 1 | 通知 webhook 超时（index.mjs:347029） |
| `SNOWLUMA_UPDATE_ROOT` | 2 | **更新根目录**（开发/测试更新流程，index.mjs:367259/367414） |
| `SNOWLUMA_UPDATE_CHECK` | 1 | 是否检查更新（index.mjs:360382） |
| `SNOWLUMA_WEBUI_PORT` | 2 | WebUI 端口（默认 5099） |
| `SNOWLUMA_WEBUI_HOST` | 1 | WebUI 绑定地址 |
| `SNOWLUMA_WEBUI_TARGET` | 2 | UI 主题预置，唯一合法值 `maibot`（index.mjs:348340-348349） |
| `SNOWLUMA_WEBUI_TLS` | 2 | 覆盖 `webuiTls.enabled` |
| `SNOWLUMA_WEBUI_TRUST_PROXY` | 2 | 覆盖 `trustProxy` |
| `SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD` | 2 | 首次启动注入 WebUI 密码（index.mjs:351519/351712） |
| `SNOWLUMA_ONEBOT_HTTP_PORT` | 2 | OneBot HTTP 端口 |
| `SNOWLUMA_ONEBOT_WS_PORT` | 2 | OneBot WS 端口 |
| `SNOWLUMA_LOG_DIR` | 1 | 日志目录（默认 `/app/data/logs`，index.mjs:918） |
| `SNOWLUMA_LOG_FILE` | 1 | `=0` 关闭文件日志（index.mjs:922） |
| `SNOWLUMA_LOG_LEVEL` | 1 | 控制台级别，默认 `info`（index.mjs:1432） |
| `SNOWLUMA_LOG_FILE_LEVEL` | 1 | 文件级别，仅 `debug/info/success/warn/error`（index.mjs:1437-1441） |
| `SNOWLUMA_LOG_MAX_MB` | 2 | 单文件上限（index.mjs:919） |
| `SNOWLUMA_LOG_MAX_TOTAL_MB` | 4 | 日志总量上限（默认 1024） |
| `SNOWLUMA_LOG_RETAIN_DAYS` | 4 | 日志保留天数（默认 7） |
| `SNOWLUMA_LOG_PER_UIN` | 4 | 按 uin 分文件 |
| `SNOWLUMA_TRACE_BUFFER` | 1 | 追踪缓冲条数（index.mjs:1428） |
| `SNOWLUMA_VERBOSE_WARMUP` | 1 | `=1` 打印预热细节（index.mjs:345596） |
| `SNOWLUMA_DEV_MODE` | 5 | 开发模式（index.mjs:351516） |
| `SNOWLUMA_DEV_WEBUI` | 1 | 开发模式 WebUI（index.mjs:6100 npm script） |
| `SNOWLUMA_DEV_NO_NATIVE` | 1 | `=1` 用 stub 替代 native addon（index.mjs:339629/339645） |
| `SNOWLUMA_ACCEPT_EULA` | 1 | 非交互接受 EULA（index.mjs:351839） |
| `SNOWLUMA_ACCEPT_PRIVACY` | 1 | 非交互接受隐私政策（index.mjs:351840） |
| `QQ_RECV_HEARTBEAT_CMD` | 2 | **【未查清】**疑似 QQ 收包心跳命令名 |

> **【未查清】**：`SNOWLUMA_HOOK_RUNTIME_DIR` 在"跨进程读取目标 QQ 的 environ"这条路径上（index.mjs:1744）依赖 `/proc/<pid>/environ` 可读 —— 同 uid 时可行，跨 uid 会失败。

#### B) `runtime.json`（全局运行配置，实测内容）

```json
{
  "webuiPort": 5099,          // WebUI 端口
  "hookAutoLoad": false,      // ★ 自动注入开关（本机为 false —— 靠手动/已有 hook）
  "webuiHost": "0.0.0.0",     // ★ 0.0.0.0 = 对外暴露，建议改 127.0.0.1 + 反代
  "webuiTls": { "enabled": false },
  "trustProxy": "",           // 反代时填，影响 client-ip 判定
  "logMaxTotalMb": 1024,
  "logRetainDays": 7,
  "logPerUin": false
}
```
（解析/规范化见 index.mjs:233、323。变更热重载的判定见 323。`hookAutoLoad` / `webuiTls.enabled` 是**布尔白名单**，见 index.mjs:353129。）

#### C) 其他配置文件（实测内容）

| 文件 | 权限 | 内容 |
| --- | --- | --- |
| `onebot.json` | 644 | **全局** OneBot 网络配置（结构见 §4.1） |
| `onebot_<uin>.json` | 600 | **每账号** OneBot 配置（`mode: "snapshot"`），含 `statusCommand` / `historySync` / `notifications` |
| `webui.json` | 600 | `passwordHash` / `passwordSalt`（scrypt）/ `mustChangePassword` / `generatedAt` / `updatedAt` |
| `ui.json` | 644 | WebUI 外观与布局（appearance / layout / pages），2,898 B |
| `consent.json` | 644 | `{ version: "dcb31a7b03a0b64d", acceptedAt: ... }` |
| `machine-id` | 644 | 32 位十六进制机器标识（`<machine-id>`） |
| `notifications.json` | 600 | `{ version: 1, debounceSeconds: 30, channels: [] }` |
| `vnc-password` | 600 root | **【未查清】**与 SnowLuma 逻辑无关，疑为容器内 VNC 服务 |

---

## 6. 关键子系统的额外发现

### 6.1 `src/update`（自动更新）—— 接手后你可能要改的地方

**【确证】** index.mjs:360170-360195：

```js
mirror: "",
mirrors: [
	"https://ghfast.top",
	"https://ghproxy.net",
	"https://gh-proxy.com",
	…
	"https://fastgit.cc",
	…
	"https://gh-proxy.org",
	…
],
…
if (config.mode === "mirror") return [`${config.mirror}/${url}`];
return [url, ...config.mirrors.map((mirror) => `${mirror}/${url}`)];
```

- 更新源 = **GitHub Releases**：`https://api.github.com/repos/SnowLuma/SnowLuma/releases/` + `https://github.com/SnowLuma/SnowLuma/releases/download/v<版本>`
- **三种模式**【确证】index.mjs:211-218：`auto`（直接 + 逐个镜像回落）/ `direct` / `mirror`（自填镜像，`mirrors` 最多 16 个）
- 其他 GitHub 代理也在字符串里：`https://cors.isteed.cc`、`https://github.chenc.dev`、`https://github.xxlab.tech`、`https://githubproxy.gohj99.site`、`https://gxh.vip.qq.com/...`
- 模块：`src/update/{check,download,files,release,service,sources}.ts`

> ⚠️ **接手必看**：`api.github.com/repos/SnowLuma/SnowLuma` **上游已删库**，所以
> **自动更新必然 404/失败**。要么指向你自己的 fork，要么关掉
> （`SNOWLUMA_UPDATE_CHECK`）。相关 WebUI 路由：`GET /api/update/check`、`GET/POST /sources`、`POST /sources/test`、`POST /download`。

### 6.2 协议栈深度（`../protocol/src`，112 region）—— 最大的模块

**OIDB 服务清单**【确证】：`oidb-services/` 下 15 个子目录：`group-admin`(26)、`group-file`(21)、`contacts`(15)、`flash-transfer`(13)、`custom-face`(8)、`friend`(7)、`extras`(5)、`misc`(5)、`profile`(5)、`reaction`(3)、`interaction`(3)、`sys-faces`(2)、`web`(2)、`highway`、`…`
**Highway 上传管线**(13)：`highway-client`、`image-upload`、`video-upload`、`ptt-upload`(+waveform)、`sha1-stream`、`hash-file`、`pipeline`、`stage`、`upload-settings`、`ffmpeg-addon`、`download`
**消息推送解码**(13 + 8 decoders)：`msg-push/{client,codec,decoders/*,registry,helpers,rich-body-decoder,sysmsg-dedup,xml-card,packet-response,fetch-{c2c,group}-history}`
  - decoders: `event, friend, group-admin, group-join, group-member-change, group-message, temp-message`
**Web/QZone API**(12)：`web/{collection,friend,group-*,group-album,group-essence,group-honor,group-sign,qzone,request-util}`
**其他**：`bridge-oidb.ts`、`oidb-service.ts`、`packet-pipeline.ts`、`qq-interface?`、`self-uid.ts`、`format.ts`、`dataline`(2)、`elem?`、`kick-*`、`services/qidian`、`sys-face-{storage,store}.ts`

### 6.3 它到底怎么"发消息"（这是理解风控的关键）

**【确证】`.so` 内的目标名**：
```
MessageSvc.PbSendMsg      ← SSO 命令：发消息
selfInfoOnLoginSuccess    ← 登录成功
sendSsoInternal           ← SSO 发包总入口
msfDidRecvResponseData    ← 收包回调
MSFService / MSFCoreService / SessionInit / NG session
CreateNTSessionShell / CreateGProSessionShell
wtlogin. / trpc.login. / QrCode.
```

**架构含义**【强推断】：SnowLuma **不自己实现 QQ 协议栈、不自己登录、不自己加密**。它**寄生在官方 QQ 客户端的 MSF（Message Service Framework）会话之上**：
- 复用一个**已登录**的官方会话（所以必须"先让 QQ 登录成功"，见 .so 字符串 `"not logged in: wait until QQ completes login"` / `"logged-in MSF service instance is missing"` / `"QQ is not ready. Please finish signing in and try again."`）
- 通过 VTable hook 劫持 `sendSsoInternal` / `msfDidRecvResponseData`，**借官方通道收发**
- 上层用 OIDB 构造业务包

**这对风控是决定性的**【推断】：从腾讯服务端看，流量就是**官方客户端自己发的**（同样的会话、同样的加密、同样的 TLS 指纹、同样的设备信息）—— 这是它能长期存活（本机已连续运行 9 天，日志 ~11 MB/天）的根本原因。**代价**是强依赖 QQ 内部结构，见 §E.3。

### 6.4 用户可见的错误文案（【确证】：`.so` 字符串）

这些是**面向用户**的文案（都写死在 `.so` 里）：
```
"This request is not valid. Please check it and try again."
"QQ is not ready. Please finish signing in and try again."
"The QQ connection changed. Please restart QQ and try again."
"SnowLuma could not prepare the request. Please restart SnowLuma and try again."
"SnowLuma could not send the request. Please try again."
```
以及内部诊断：
```
"not logged in: wait until QQ completes login"
"logged-in MSF service instance is missing"
"waiting for the selected receive session"
"QQ runtime cannot read process memory"
"(...) [RUNTIME_MEMORY_UNAVAILABLE]"
"failed to inspect wrapper.node"
"module not found in target process maps"
"Linux runtime targets are not resolved yet"
"Linux MSF service targets are missing"
"invalid login identity hint"   "session binding is empty"
"native selected session changed"   "session no longer identifies an account"
"session account identity changed"   "session kind unavailable"
"session interface unavailable"   "session NG send ownership changed"
"session identity changed"   "reply path changed"   "one-way path changed"
```
> ★ 这段"session … changed"系列**极有信息量**：说明 hook 内部**持续做一致性校验**（防止选错会话/会话漂移），是一个防御性设计。接手时如果 QQ 更新，**这里就是最先报错的地方**。

### 6.5 逆向工具链备注（给下一个接手的人）

本机（aarch64，无 r2/ghidra/rizin）**完全够用**：

```bash
# 反汇编指定范围（务必加 --no-show-raw-insn，输出干净）
objdump -d --no-show-raw-insn --start-address=0xcf1c --stop-address=0xcf68 snowluma-linux-arm64.so
# 导出符号（.so 被 strip，但 dynsym 保留）
readelf -sW --dyn-syms snowluma-linux-arm64.so | awk '$7!="UND"'
# 导入符号 = 能力清单（最快看出"它用了什么系统调用"）
readelf -sW --dyn-syms snowluma-linux-arm64.so | grep ' UND '
# 字符串表（.so 只有 30 KB，可以全看）
strings -a -n 4 snowluma-linux-arm64.so
# 直接按 vaddr 读 .rodata（本 ELF vaddr == file offset）
python3 -c "d=open('x.so','rb').read(); print(d[0x437f0:0x43830].split(b'\0')[0])"
```

**踩到的坑（避免重复）**：
1. **bundle 里有 NUL 字节** → `grep -oE` 会截断行。用 `grep -a`（binary-as-text），并用 `re` 而非 `grep` 提取 region（本机 `grep -oE '//#region [^\n]+'` 只得到 147 个，Python 正则得到 **467 个**）。
2. `strings` 输出 4,519 行，其中**~3,600 行是 ARM64 机器码被误当字符串**（形如 `?i(8`、`@9J`）—— 真字符串集中在 **第 1–176 行** 和 **第 3799–4050 行** 两段。
3. **`index.mjs` 里有一份内嵌的 zxcvbn 密码字典**（index.mjs:359688 到文件尾附近，约 330 KB 单行）—— **不要 `grep` 带上下文的模式**，会把整个字典打印到终端（我踩过一次，输出 330 KB）。用 `grep -an` 只要行号，或先用 `sed -n 'A,Bp'` 定位。
4. 长任务（`objdump` 12 MB bundle 等）用 `nohup ... &` + 轮询，SSH 会在空闲 ~10 分钟断连（实测踩到 `Connection timed out during banner exchange`）。
5. **`grep -c <关键词>` 在 `index.mjs` 上会骗你** —— 内嵌 zxcvbn 字典（359688 行那一条超长行）里含大量英文弱密码，
   `backoff` / `jitter` / `circuit` / `device` / `sign` 这类词的"命中"很可能**全是那 1 行**。
   **判据：如果 `-c` 的计数很小（1~3）且 `grep -an` 显示都指向 359688 行，就是假阳性。**
   要查代码里是否真有某机制，请看**行号分布**，不要看计数。
   （本任务中 `backoff` / `jitter` / `circuit` 三者**全部**命中该行 ⇒ 假阳性。）

---

## 7. E. 接手建议

### 7.1 可维护性评估：源码 vs 黑箱

| 组件 | 形态 | 可维护性 | 说明 |
| --- | --- | --- | --- |
| `index.mjs`（12.3 MB） | **未混淆的打包 JS** | ★★★★★ **完全可读可改** | 保留了 `//#region <原路径>`（467 个），等于**自带源码地图**。改业务逻辑、OneBot 动作、WebUI、协议栈 **都不需要反编译** |
| `native/snowluma-linux-arm64.node`（319 KB） | ELF N-API，**strip 但仍可读** | ★★★☆☆ **半黑箱** | dynsym 只剩 `napi_register_module_v1`；但**字符串表极其丰富**（~500 条有意义字符串，等于把流程写出来了）且**导入符号表完整**（ptrace/process_vm_*/mmap）。有效但不可改 |
| `native/snowluma-linux-arm64.so`（335 KB） | ELF，**strip 但导出 6 符号** | ★★☆☆☆ **黑箱（有 ABI 契约）** | 6 个导出是稳定 ABI。**内部逻辑不可改**；但因为它只是"后端 stub"，**理论上可整体重写**（见 §7.3） |
| `native/websocket-linux-arm64.node` | 第三方（ws 的 optional addon） | ★★★★☆ | 有 `SNOWLUMA_DEV_NO_NATIVE` 可 stub 掉（index.mjs:339629） |
| `native/ffmpeg/ffmpegAddon.linux.arm64.node`（5.4 MB） | 自研 FFmpeg 封装 | ★★★☆☆ | 只用 3 个方法（`convertToNTSilkTct` / `decodeAudioToFmt` / `getDuration`） |
| `native/sqlite/prebuilds/*` | 第三方 `@appthreat/sqlite3` | ★★★★☆ | 按 libc 选 glibc/musl，有 `assertBinding()` 接口校验 |
| `client/`（WebUI 前端） | **已构建的静态产物** | ★★☆☆☆ **前端源码缺失** | 只有 `index.html` + `assets/`。改 UI 只能改后端 `ui.json` / `cssVars` / `customCss`（index.mjs 有 `appearance.customCss`），**不能改组件** |
| `EULA.md` / `PRIVACY.md` | Markdown 原文 | ★★★★★ | 可直接编辑 |

**总结**：
- **业务逻辑 100% 有源码**（在 bundle 里）—— 这是最大的好消息。
- **注入 + hook 引擎是纯黑箱**（`.node` + `.so`，共 654 KB）—— 这是最大的风险。
- **前端无源码** —— 只能通过配置定制。

### 7.2 修改指南：想做什么 → 改哪里

> ⚠️ 所有 index.mjs 的"行号"在**重新打包后必然失效**，请用**函数名 / region 名**定位。

| 我想… | 改哪里 | 难度 | 备注 |
| --- | --- | --- | --- |
| 改 OneBot 动作行为 | `../onebot/src/actions/*.ts`、`modules/*.ts` | 🟢 低 | 纯 TS 逻辑，region 分得很细 |
| 加一个 OneBot 动作 | 新增 `actions/xxx.ts` + 注册进 `actions/index.ts` / `api-handler.ts` | 🟢 低 | 有 `action-kit.ts` / `action-result-schemas.ts` 做脚手架 |
| 改 OneBot 事件转换 | `../onebot/src/event-converter/*` | 🟡 中 | 要与 `protocol/src/msg-push/decoders/*` 对齐 |
| 改网络/端口/鉴权 | `../onebot/src/network/*`、`onebot.json` | 🟢 低 | 配置优先 |
| 改 WebUI 后端 API | `src/webui/server.ts` + 同目录模块 | 🟢 低 | hono 路由 |
| 改 WebUI 外观 | `ui.json` / `appearance.customCss` / `/api/ui` | 🟢 低 | **不用改代码** |
| 改 WebUI 前端组件 | ❌ **不可行**（无前端源码） | 🔴 高 | 需从零重写前端，或去找上游是否有 monorepo 残留 |
| 改日志/轮转策略 | `runtime.json` + `SNOWLUMA_LOG_*` | 🟢 低 | |
| **改自动更新源** | `src/update/sources.ts` 的 `mirrors` / `api.github.com/repos/SnowLuma/SnowLuma` | 🟢 低 | **必做**：上游已删库（见 §6.1） |
| 改 SQLite 表结构 | 各 `*-store.ts` 的 `CREATE TABLE` + `prepare*Schema()` 迁移 | 🟡 中 | **务必写迁移**（有 `PRAGMA table_info` 模式可抄） |
| 调注入行为（超时/重试） | `SNOWLUMA_HOOK_ACK_TIMEOUT_MS` / `AUTO_LOAD_MAX_ATTEMPTS`（index.mjs:4675）/ `DEFAULT_INTERVAL_MS`（4501） | 🟢 低 | |
| 改 zygote 过滤规则 | `shouldAutoLoadPid()`（index.mjs:5045） | 🟢 低 | 纯 JS |
| 改 *_hook 目标函数_ | ❌ 在 `.so` 里 | 🔴 **极高** | 必须重写 native 层 |
| **适配新 QQ 版本** | ❌ 主要在 `.so` / `.node` | 🔴 **极高** | 见 §7.3 |
| 改账号发现（uin 检测） | `bridge/src/qq-account/*`（含 `sqlcipher.ts`） | 🟡 中 | 纯 JS，但算法要对齐 QQ 的库格式 |
| 换 Node 版本 | `check-node-version.cjs` | 🟢 低 | 注意 N-API 版本约束（`sqlite` 要求 Node ≥24 且 NAPI ≥10） |
| 换架构（x64 等） | ❌ 需要**全部 5 个 native 产物**的对应构建 | 🔴 极高 | 见 §7.4 |

### 7.3 重建难度评估（诚实版）

**先说结论**：

| 目标 | 可行性 | 工作量估计 | 理由 |
| --- | --- | --- | --- |
| **维持现状运行**（不改代码，只运维） | ✅ **完全可行** | 极低 | 容器已经稳定跑了 9 天，日志正常 |
| **修业务 bug / 调 OneBot 行为** | ✅ **完全可行** | 低-中 | bundle 可读，重新打包即可 |
| **改 WebUI 前端** | ⚠️ 困难 | 高 | 只能重写前端 |
| **适配新 QQ 版本（hook 失效）** | ❌ **极困难** | **很高** | 必须逆向新版 `wrapper.node` 的 RTTI 布局 |
| **换 CPU 架构（如 x64）** | ❌ 不可行 | **极高** | 需重写全部 native |
| **脱离当前 QQ 版本做"协议独立"实现** | ❌ 不现实 | 极大 | 等于重写一个 QQ 客户端（NapCat/Lagrange 那条路） |

**为什么"适配新 QQ 版本"是极困难的**（这是最关键的风险判断）：

1. hook 依赖的是 **C++ RTTI 名字 + VTable 槽位 + 结构体字段偏移**：
   - 证据：`.so` 字符串 `"MSFCoreService SessionInit/RTTI chain unresolved"`、`"MSFService receive anchor/TaskManager RTTI chain unresolved"`、`"MSFCoreService packet converter/native allocator unresolved"`、`"msfCoreCallbackOffset"`、`"reference to wrapperBase"`、`"xrefFileOffsets"`。
2. 解析逻辑在 **`.node` 的 `resolveRuntimeTargetsAsync`** 里（【确证】`.node` 导出符号含此名 + `msfServiceCandidates` / `msfCoreCandidates`），流程是：读 `/proc/<pid>/maps` 找 `wrapper.node` → 读它的 ELF → 用 **`__cxa_demangle`** 解 RTTI 名匹配 → 多候选时消歧 → 算出运行时地址。
3. 一旦腾讯改类名、改 VTable 布局、改字段偏移、加 strip/混淆，**这套解析就会失败**，**且错误信息只会说 "unresolved"**，你拿不到更多信息。
4. **好消息**：`nnphook` 的 design 是"**运行时解析 + 显式错误码**"，不是硬编码地址 —— 这**大大提高了跨小版本的生存率**。字符串里的 `candidates` / `ambiguous` / `missing` 三级错误说明它**做了完备性检查**，失败时会**明确拒绝注入而不是崩掉 QQ**（防御性设计，值得称赞）。
5. **如果想提高适配能力**，唯一的路是**重写 `.so`**（见下）。

**能否重写 `.so`？** 这是接手项目最该评估的战略问题。

| 方案 | 可行性 | 说明 |
| --- | --- | --- |
| **A. 重写 hook 后端**，保留 bundle | 🟡 理论可行，工作量大 | `.so` 的 ABI 只有 6 个函数 + 41 字节不到的代码量（其余全是内部实现）。**契约极简**：`start_dynamic` / `stop_dynamic` / `is_loaded` / `control_socket` / `recv_socket` / `backend_version`。但要重写内部（MSF VTable 解析 + 管道服务）才是真正的工作量 |
| **B. 换成 inline hook 框架**（如 [Dobby](https://github.com/jmpews/Dobby)、[frida-gum](https://github.com/frida/frida-gum)、[plthook](https://github.com/kubo/plthook)） | 🟡 可行 | 但**要重新找到"hook 哪里"**——这是难点，不是框架问题。且 VTable 替换比 inline hook **更稳**（不破坏代码段、不需 mprotect 代码页、对 anti-tamper 友好）—— 现有选择是对的 |
| **C. 借鉴 NapCat / Lagrange.Core 的思路重做** | 🔴 大工程 | NapCat 走的是"官方 Electron 客户端 + 自己的协议实现"，与 SnowLuma 的"寄生官方会话"路线**不同**。参考价值在于**上层协议实现**（bundle 里的 `protocol/` 已很完整，也是 NapCat 对齐的） |
| **D. 纯运维，不碰 native** | ✅ **最现实** | 锁定一个**已知可用**的 QQ 版本（容器镜像固定），不要升级 QQ。只在上游 bundle 上做改进 |

> **强烈建议**：接手初期选 **D**。`package.json` 里 `description` 明确说 **"There are intentionally NO runtime npm dependencies; production artifacts are self-contained"** —— 说明上游很重视"可复现的单体产物"。**把 QQ 版本 + SnowLuma 版本一起钉死**，优先修业务层，把 native 层当**不动产**对待。

### 7.4 风险点清单（按严重度排序）

| # | 风险 | 严重度 | 证据 | 缓解建议 |
| --- | --- | --- | --- | --- |
| 1 | **`wrapper.node` 内部结构变更导致 hook 全失效** | 🔴 致命 | `.so`/`.node` 的 RTTI 解析链；`"…RTTI chain unresolved"` | 钉死 QQ 版本；监控日志里的 `unresolved` 关键字；提前准备"降级为纯通知"的方案 |
| 2 | **native 层无源码，无法修 bug** | 🔴 高 | `.so` `nm` = no symbols；`.node` 只有 `napi_register_module_v1` | ①完整备份**当前可用的二进制**（`sha256`）；②在容器外归档一份；③不要轻易升级 |
| 3 | **自动更新指向已删除的仓库 ⇒ 必然失败** | 🟠 中 | index.mjs:360170 附近的 `api.github.com/repos/SnowLuma/SnowLuma` | 改 `src/update/sources.ts`，或用 `SNOWLUMA_UPDATE_CHECK` 关闭；否则每次检查都产生错误日志 |
| 4 | **`webuiHost: 0.0.0.0` + 明文 HTTP（TLS 关闭）** | 🟠 中 | `runtime.json` 实测；`runtime.json` 的 `webuiTls.enabled=false` | 改 `127.0.0.1` + 反代（或启用 TLS，`src/webui/tls.ts` 已就绪） |
| 5 | **`/api/debug/invoke` 等于远程任意动作执行** | 🟠 中 | WebUI 路由表；`src/webui/debug-tools.ts` | 若暴露到公网，务必启用 TOTP + 强密码；考虑 `request-security.ts` 的 IP 白名单 |
| 6 | **配置/凭据以明文或弱散列落盘** | 🟠 中 | `onebot.json` 里 `accessToken` 明文（644 权限）；`webui.json` 是 scrypt（✅ 较好） | OneBot token 改强随机；`onebot.json` 权限收紧到 600 |
| 7 | **`sqlcipher.ts` 依赖 QQ 的库格式**（1024 B 头 / PBKDF2 4000 / HMAC salt XOR 0x3A） | 🟠 中 | index.mjs:3164-3300 | 已做**12 种组合探测**，韧性不错；QQ 若改格式需跟改。**注意这是敏感代码（能解密用户本地库）**，处理时遵守合规 |
| 8 | **无退避/无熔断**，1.5 s 固定 tick 重试 | 🟡 低-中 | 全文 `backoff` 零命中；`DEFAULT_INTERVAL_MS=1500`；`AUTO_LOAD_MAX_ATTEMPTS=3` | 保持 `AUTO_LOAD_MAX_ATTEMPTS` 小值即可；若要改进，加指数退避但注意别拖慢恢复 |
| 9 | **线程名 `snowluma-pipe-w` 直接暴露** | 🟡 低 | 容器内 `/proc/86/task/*/comm` | 若在意隐蔽性，可 `pthread_setname_np` 改成中性名（**但这是 native 层，改不了** —— 只能接受） |
| 10 | **eula/privacy 同意状态** | 🟡 低 | `consent.json` 有 `version` 字段（`dcb31a7b03a0b64d`）；EULA/PRIVACY 若更新，`version` 变化会**再次要求同意** | 批量部署时用 `SNOWLUMA_ACCEPT_EULA` / `SNOWLUMA_ACCEPT_PRIVACY` |
| 11 | **单点：一个 runtime 进程服务所有账号** | 🟡 低 | `HookManager.sessions: Map<pid, HookSession>` | 已是多 PID 设计，问题不大 |
| 12 | **日志 ~11 MB/天**，`logRetainDays=7` ⇒ 约 80 MB 常驻 | 🟢 低 | `/app/data/logs/` 实测 | 已自动轮转，注意磁盘 |
| 13 | **`.so` strip 后无法做符号级调试** | 🟡 低-中 | `nm` = no symbols | 需要时用**未 strip 的构建**，或靠 `dynsym` + 字符串 + 反汇编 |

### 7.5 接手第一步（Checklist）

```bash
# ① 立刻归档当前"已知可用"的二进制 + 版本指纹
sudo docker cp snowluma:/app/runtime /backup/snowluma-runtime-$(date +%F)
sha256sum /backup/.../native/*.so /backup/.../native/*.node   # ★ 必须做
sudo docker exec snowluma sh -c 'cat /opt/QQ/version 2>/dev/null || \
  ls /opt/QQ/resources/app/package.json && \
  grep -m1 version /opt/QQ/resources/app/package.json'         # 记下 QQ 版本

# ② 确认运行时状态
sudo docker exec snowluma sh -c 'ls -la /tmp/runtime-*/; ss -xpn | grep mojo'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5099/

# ③ 拿一份 bundle 到本地（12 MB，readable）
docker cp snowluma:/app/runtime/index.mjs ./index.mjs
python3 -c "
import re; d=open('index.mjs','rb').read()
open('regions.txt','w').write('\n'.join(sorted(set(
  m.decode() for m in re.findall(rb'//#region ([ -~\t]{1,200})', d)))))
print(open('regions.txt').read().count(chr(10)), 'regions')"

# ④ 检查是否已有 hook 失效征兆
sudo docker exec snowluma sh -c 'grep -c "unresolved" /app/data/logs/*.log'
sudo docker exec snowluma sh -c 'grep -oE "hook_autoload_terminal[^\"]*" /app/data/logs/$(date +%F).log | sort -u'
```

**运维命令速查**（只读，安全）：

```bash
# 当前 hook 的进程（看 mojo.*.sock）
sudo docker exec snowluma sh -c 'ls -la /tmp/runtime-1000/mojo.*.sock'
# 注入负载映射（orcexec.*）
sudo docker exec snowluma sh -c 'grep orcexec /proc/86/maps'
# 注入线程
sudo docker exec snowluma sh -c 'ls /proc/86/task/*/comm | while read f; do
  printf "%s " "$(basename $(dirname $f))"; cat $f; done | grep -i snowluma'
# 会话/账号状态
curl -s http://127.0.0.1:5099/api/processes | head -c 2000
curl -s http://127.0.0.1:5099/api/connections | head -c 2000
curl -s http://127.0.0.1:5099/api/status
```

### 7.6 还没查清的部分（诚实标注）

| 项 | 状态 | 为什么值得知道 |
| --- | --- | --- |
| **管道的完整 op 码表** | **【未查清】** | 定义在 `.so` 内。已知 `op=17`（登录身份）、`op=1`（binary）、`status=1`（私聊上报可用）。要完整还原需**逐函数反汇编 `.so` 的 `0xcf98` 一族**（约 20 个内部函数），或**抓包**：`socat`/`strace` 挂在 socket 上。**建议下一个接手者做这一步** —— 这是理解 hook 协议的关键 |
| **`nnphook` 具体 hook 的 VTable 槽位索引** | **【未查清】** | 需要把 `.so` 的 `wrapperBase` 解析逻辑逐条反汇编；或从 QQ 侧 `/proc/86/maps` + `gdb` 观察 VTable 被改的槽 |
| **`.eh_frame` / `exceptionTable` 的用途** | **【推断】** | 疑为注册 C++ 异常展开表，让 hook 函数内抛异常不崩 QQ |
| **`orcexec` 文件名构造点** | **【推断】** | 前缀 + 6 位随机；字符串不在两个二进制里，**疑在注入用的 stub shellcode 中**（`process_vm_writev` 写入的那段） |
| **`../proton/src` 是什么** | **【未查清】** | 只有 1 个 region，名字被截断。可能是个内部工具 |
| **`QQ_RECV_HEARTBEAT_CMD`（2 次命中）** | **【未查清】** | 疑似 QQ 收包心跳的命令名，可能与登录保持有关 |
| **PID 116 的来源** | **【未查清】** | 是 fork 的子进程还是 `ps` 的呈现；不影响维护 |
| **`vnc-password`（root, 600）** | **【未查清】** | 与 SnowLuma 逻辑无关，疑为容器内 VNC/noVNC 服务（一键包常见） |
| **WebUI 前端源码** | **缺失** | 只有构建产物；`index.html` 会引用 `assets/`，可从中提取 chunk 名推断组件结构 |
| **日志级别 `success`** | 已知但非标准 | `src/webui/state-*` 与 `SNOWLUMA_LOG_FILE_LEVEL` 支持 `success`（非 pino 标准），说明日志层是**自研的** |

---

## 8. 一页速查（TL;DR）

```
SnowLuma = 一个"寄生"在官方 Linux QQ 客户端里的运行时

  进程:  PID 86 (qq, Electron)  ←被注入    PID 87 (node index.mjs) ←控制方
  通道:  Unix socket /tmp/runtime-<uid>/mojo.<pid>.{control,recv}.sock
         （伪装成 Chromium Mojo），40 字节头 + 3 段 body，magic="QHP1"
  注入:  .node 用 ptrace + process_vm_writev + 远程 mmap
         手工映射 .so（不用目标进程的 dlopen），临时文件落地后立即 unlink
  挂钩:  不是 inline hook，而是 **替换 wrapper.node 里 MSFService /
         MSFCoreService 的 C++ VTable** → 借官方已登录会话收发消息
         目标: MessageSvc.PbSendMsg / sendSsoInternal /
               msfDidRecvResponseData / selfInfoOnStartLoginSuccess

  上游:  业务逻辑(OneBot/协议/WebUI) 全在 index.mjs —— 未混淆，可读可改
         黑箱只有 654 KB 的两个 native 文件（注入器 + hook 后端）

  最大风险: QQ 升级 => VTable/RTTI 解析失败 => 全功能失效
  最该做的事: ① 归档当前二进制 + sha256  ② 钉死 QQ 版本
              ③ 改掉指向已删库的自动更新源  ④ 别碰 native 层
```

**证据留存位置**（服务器上，供下一位接手者复核）：
```
/tmp/slx/regions_clean.txt     467 个 region（Python 精确提取）
/tmp/slx/hook.asm              .so 完整反汇编（2.4 MB）
/tmp/slx/hook.strings.txt      .so 全字符串（4,519 行）
/tmp/slx/hook.readelf.txt      .so 段表/符号表
/tmp/slx/napi.asm              .node 完整反汇编（2.3 MB）
/tmp/slx/napi.readelf.txt      .node 段表/符号表
/tmp/slx/config/               容器 /app/data/config 快照
/tmp/slx/runtime/              容器 /app/runtime 快照
/tmp/regions.txt               早期（不完整，147 个）— 以 regions_clean.txt 为准
```

---

*文档完。所有结论均标注了证据等级（确证 / 强推断 / 推断 / 未查清）；*
*未查清项已集中列于 §7.6，请勿把它们当作已结论。*
