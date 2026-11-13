# 架构与注入原理

> [!WARNING]
> 本内容完全由 AI 编写，请谨慎查看。

> **面向读者**：技术用户、运维人员、接手维护者。
> **本文回答**：Haizakura（原名 SnowLuma）是怎么工作的？它凭什么能收发 QQ 消息？为什么它能扛住 ASLR？
> **前置知识**：Linux 进程模型、ELF 文件格式、C++ 虚函数与 RTTI 的基本概念。
> 如果你只是想把它跑起来，去看 `guide/`；本文讲"为什么"。

---

## 1. 一句话概括

**Haizakura 不实现 QQ 协议、不自己登录、不做加解密。它寄生在官方已登录的 QQ 进程里，
借 QQ 自己的 MSF 会话收发消息。**

```
              ┌─────────────────────────────────────────┐
              │  腾讯服务器                               │
              │  （它看到的：一个正常的官方 Linux QQ 客户端）│
              └────────────────┬────────────────────────┘
                               │  真实的 MSF 会话 / 官方加密 / 官方设备信息
   容器内 ═════════════════════▼══════════════════════════════════
              ┌─────────────────────────────────────────┐
              │  官方 QQ 进程（Electron，被注入）          │
              │  ├─ MSFService        ← 发消息入口        │
              │  └─ MSFCoreService    ← 收包/状态回调      │
              │         ▲                                │
              │         │ Hook：替换 C++ VTable           │
              └─────────┼───────────────────────────────┘
                        │ Unix socket（伪装成 Chromium Mojo）
              ┌─────────▼───────────────────────────────┐
              │  Haizakura runtime（独立 Node 进程）      │
              │  OneBot v11 · WebUI · MCP · SQLite       │
              └─────────────────────────────────────────┘
```

这个设计的**收益**在第 9 节讲（风控视角），**代价**在第 6 节讲（版本强耦合）。

---

## 2. 进程模型

容器内由 **supervisord 作 PID 1** 拉起两组进程。生产实例实测（`ps aux`）：

```
PID  1     supervisord -c /etc/supervisord.conf        ← 容器 init
│
├─ PID 55   Xvfb :1 -screen 0 1920x1080x24              ← 虚拟显示
├─ PID 60   fluxbox                                     ← 窗口管理器
├─ PID 61   x11vnc -display :1 ...                      ← VNC 服务
├─ PID 64   novnc_proxy --listen 6081                   ← noVNC（扫码登录用）
│
├─ [program:qq]  priority=10
│  ├─ PID 79   qq --no-sandbox --disable-gpu ...        ★ 主 QQ 进程（被注入）
│  │              └─ 注入线程 "snowluma-pipe-w"
│  ├─ PID 88/89/129   qq --type=zygote                  ← Electron 子进程（不注入）
│  ├─ PID 143         qq --type=utility --sub-type=network.mojom.NetworkService
│  └─ PID 6263        qq --type=utility --sub-type=audio.mojom.AudioService
│
└─ [program:snowluma]  priority=20                     ← priority 更大 = 后启动
   ├─ PID 80    node /app/runtime/index.mjs             ← runtime 主进程
   └─ PID 105   node /app/runtime/index.mjs             ← 实际监听端口的进程
                  ├─ 0.0.0.0:5099   WebUI
                  ├─ 0.0.0.0:3000   OneBot v11 HTTP
                  └─ 0.0.0.0:3001   OneBot v11 WebSocket
```

### 2.1 两组进程的关系

| | QQ 进程 | Haizakura runtime |
|---|---|---|
| 角色 | **被注入者**（宿主） | **控制方** |
| 语言 | C++ / Electron | Node.js（单文件 bundle） |
| 谁先启动 | 先（`priority=10`） | 后（`priority=20`） |
| 为什么是这个顺序 | runtime 启动时要 `ptrace` 附加到一个**已经存在**的 QQ 进程；反过来不行 | — |

> ⚠️ **`supervisord` 的 `priority` 是启动顺序，不是依赖关系。**
> runtime 每个 tick（默认 1500 ms）都会重新扫描 `/proc` 找 QQ 进程，
> 所以即使 QQ 比 runtime 晚起来，也会被自动接管（见 `pipe-watcher` 机制，§7.2）。

### 2.2 关于 PID 80 / 105 两个 runtime 进程

实测观察到 runtime 有**父子两个进程**，且**只有子进程真正持有监听端口**。
这**不是** `worker_threads`（线程在 `ps` 里不会显示为独立条目）。

> **【未查清】** 具体 fork 时机与用途。已知它**不影响维护**：
> 停止服务时 `stopasgroup=true` 会整组停掉；日志两条流都写同一个文件。
> 如果在排查端口占用，记得找**持有 socket 的那个 PID**，不要看主进程。

---

## 3. 通信通道：伪装成 Mojo 的 Unix Socket

runtime 与注入的 `.so` 之间走 **Unix domain socket**（Windows 上是命名管道）。

### 3.1 socket 路径与命名

```js
// index.mjs 中的路径构造函数
if (process.platform === "win32") return `\\\\.\\pipe\\mojo.${pid}.${suffix}`;
return path.join(runtimeDir, `mojo.${pid}.${suffix}.sock`);
```

实测产生的文件：

```bash
$ ls -la /tmp/runtime-1000/
srw------- 1 snowluma snowluma  mojo.79.control.sock    ← 控制通道
srw------- 1 snowluma snowluma  mojo.79.recv.sock       ← 收包通道
```

- **runtime 目录**：`/tmp/runtime-<uid>`，可用环境变量 `SNOWLUMA_HOOK_RUNTIME_DIR` 覆盖
- **权限 0600**，仅同 uid 可访问
- **为什么叫 `mojo`**：QQ 本体是 Electron，Mojo 是 Chromium 的 IPC 框架名。
  用这个名字，socket 出现在 `/proc/<pid>/fd` 或 `ss -xpn` 里时**看起来像 QQ 自己的 IPC** ——
  这是**反本地发现**设计，不是技术要求。**【确证】**

### 3.2 帧格式：40 字节头 + 三段 body

固定 **40 字节小端头**，后接 `cmdBuf ‖ msgBuf ‖ bodyBuf`。**【确证】**

| 偏移 | 类型 | 字段 | 说明 |
|---:|---|---|---|
| 0 | u32 | `PIPE_MAGIC` | `827344977` = `0x31504851`，按小端落盘即 ASCII **`"QHP1"`** |
| 4 | u16 | `version` | `1` |
| 6 | u16 | `op` | 操作码 |
| 8 | u32 | `requestId` | 请求关联 ID |
| 12 | i32 | `status` | 负数 = 错误码 |
| 16 | u32 | `flags` | `PipeFlagWantReply=1`、`PipeFlagLoggedIn=4` |
| 20 | u32 | `cmdBuf` 长度 | |
| 24 | u32 | `msgBuf` 长度 | |
| 28 | u32 | `bodyBuf` 长度 | |
| 32 | u64 | `value0` | 常用于携带 uin |
| 40… | — | `cmdBuf ‖ msgBuf ‖ bodyBuf` | 三段拼接 |

> **`QHP1` 的含义【推断】**：**Q**Q **H**ook **P**ipe v**1** —— 与 `mojo` 命名一样属内部标识。

**上限与超时【确证】**：

| 常量 | 值 | 含义 |
|---|---|---|
| `MAX_PIPE_CMD_BYTES` | 4096 | cmdBuf 上限 |
| `MAX_PIPE_MSG_BYTES` | 65536 | msgBuf 上限 |
| `MAX_PIPE_BODY_BYTES` | 16 MiB | bodyBuf 上限 |
| ACK 超时 | 5 s | 控制通道应答 |
| 回包超时 | 30 s | 业务请求 |
| 探活超时 | 250 ms | socket 连通性探测 |

### 3.3 已观测的操作码

| op / status | 用途 | 证据强度 |
|---|---|---|
| `op=17` | **登录身份提示**（`sendAckOnly(17, BigInt(uin), …)`） | 【确证】 |
| `op=1` | binary 传输 | 【确证】 |
| `status=1` | "客户端私聊上报可用" | 【确证】 |

> **【未查清】完整 op 码表** —— 它定义在 `.so` 内部，不在 bundle 里。
> 要完整还原需要逐函数反汇编 `.so` 的 `0xcf98` 一族（约 20 个内部函数），或用 `socat` 挂在 socket 上抓包。

### 3.4 帧编解码的位置

```
packages/bridge/src/hook-packet-client.ts   ← 帧的读写
packages/bridge/src/qq-hook-client.ts       ← 连接管理
packages/bridge/src/hook-runtime-dir.ts     ← runtime 目录解析
packages/bridge/src/packet-timeout.ts       ← 超时策略
```

---

## 4. 注入机制：两层，别混淆

这是最容易搞混的地方：**注入分成两个独立阶段、由两个不同的二进制完成**。

| 文件 | 大小 | 角色 | 运行在 | 关键技术 |
|---|---:|---|---|---|
| `snowluma-linux-arm64.node` | 318,640 B | **注入器** | Haizakura 进程内（N-API 插件） | `ptrace` + `process_vm_writev` + 手工 ELF 映射 |
| `snowluma-linux-arm64.so` | 335,040 B | **被注入的 payload** | **QQ 进程内** | 自定位 + RTTI 解析 + 替换 VTable + socket 服务 |

> 命名容易误导：`.node` 是 **Node 插件**（注入器），`.so` 是**注入目标**（payload）。
> **注入逻辑在 `.node` 里，hook 逻辑在 `.so` 里。**

### 4.1 注入链路（10 步，每步有证据）

```
① node /app/runtime/index.mjs                    【确证】ps
       │
② getNativeHookAddon()                           【确证】解析 native 插件路径
       │  搜索顺序：[<moduleDir>/native, <moduleDir>/../../runtime/native]
       ▼
③ loadNativeAddon() → process.dlopen(mod, path)  【确证】
       │  （不用 require()，因为 .node 不在 node_modules 里）
       ▼
④ listHookProcesses() → addon.getAllMainProcessAsync()
       │  在 .node 内枚举 /proc，按 cmdline/maps 启发式找出"主 QQ 进程"
       ▼
⑤ shouldAutoLoadPid(pid) 过滤 Electron 子进程     【确证】见 §7.1
       │  Windows 上改走 getFileHoldersAsync()（按文件锁定位）
       ▼
⑥ addon.loadModuleManualAsync(pid, ".../snowluma-linux-arm64.so")
       │  ★ 黑箱：ptrace + process_vm_writev + 手工 ELF 映射（见 §4.2）
       │  落地临时文件 /tmp/runtime-<uid>/orcexec.<6位随机>，随即 unlink
       ▼
⑦ .so 在 QQ 进程内启动，创建 control / recv 两个监听 socket
       │  → /tmp/runtime-1000/mojo.79.{control,recv}.sock
       ▼
⑧ .so 内 hook 引擎（nnphook::linux_backend）解析 wrapper.node 的
   MSFService / MSFCoreService，安装 VTable 替换
       ▼
⑨ runtime 用 net.createConnection(socketPath) 连上去
       │  PipeClient 走 40 字节帧协议
       ▼
⑩ 双向：
   OneBot 动作 → bridge/apis → protocol → 帧 → .so → QQ 内部 MSF 发包
   QQ 收到消息 → .so 拦截  → recv socket → 帧 → event-converter → OneBot 事件
```

**可卸载【确证】**：`unloadModuleManualAsync(pid, handle)` 存在，
WebUI 有 `POST /api/processes/:pid/unload` 路由。

### 4.2 手工 ELF 映射（`.node` 的核心黑箱）

**关键点：它不用目标进程的 `dlopen`。** 证据是 `.node` 的导入符号表里
**没有** `process_dlopen` 之类的符号，只有一整套手工映射需要的系统调用：

```
ptrace              process_vm_readv     process_vm_writev
mmap                munmap              mprotect
dlopen              dlsym               dladdr              dlerror
waitpid             pread               open                read
realpath            stat                fstat
syscall             __getauxval         getpid
```

**还原出的算法【强推断，由导入符号 + 错误串 + 动态取证交叉得出】**：

```
loadModuleManualAsync(pid, soPath):
  1. open/read(soPath)                      → 读入 .so 全量
  2. 解析自身 ELF：段表 / PT_DYNAMIC / RELATIVE 重定位 / .dynsym / .eh_frame
  3. 建临时文件 /tmp/runtime-<uid>/orcexec.<rand6>，把 .so 写进去
  4. mmap 该文件 → 让 injector 与 target "share the mapped file"
       （对应错误串 "target does not share the injector's mapped file"）
  5. unlink(临时文件)                        → 磁盘无痕
  6. ptrace(PTRACE_SEIZE, pid)               → 非侵入式 attach（不改 SIGSTOP 语义）
       （PRoot 兼容路径：PTRACE_ATTACH + 等待 SIGSTOP）
  7. PTRACE_GETREGSET 保存全部寄存器          → 保存现场
  8. 用 PTRACE_POKEDATA / process_vm_writev 写入一段 stub
  9. 远程调用 mmap(NULL, size, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANON, -1, 0)
       （改寄存器 → PTRACE_CONT 到 syscall 出口 → 读回 x0）
  10. 把 .so 的 PT_LOAD 段复制到远程 mmap 区
  11. 应用 relocations（RELATIVE + 解析依赖的 .dynsym）
  12. mprotect 分段改为 r-x
  13. 远程调用入口（entry），初始化 nnphook::linux_backend
  14. PTRACE_DETACH + 恢复寄存器
  15. 返回 {base, entry, size, exceptionTable}
```

**句柄契约【确证】**（`.node` 的字符串）：

```
"handle must be {base, entry, size, exceptionTable}"
"ManualMapHandle::base is 0"
结果字段名：injection / runtimeResolution / processDiscovery / moduleInspection
```

**动态实证【确证】** —— `/proc/<qq_pid>/maps` 里唯一的注入负载映射：

```
f99d4fda4000-f99d4fdb4000 rw-s 00000000 00:66 4270839  /tmp/runtime-1000/orcexec.bEkdOA (deleted)
f99d4fdb4000-f99d4fdc4000 r-xs 00000000 00:66 4270839  /tmp/runtime-1000/orcexec.bEkdOA (deleted)
```

三个细节值得注意：
1. **同一 inode 两段映射**：先 `rw-s` 写入，再 `r-xs` 执行 —— 教科书式的两段式注入
2. **`(deleted)` 标记**：落地后立刻 `unlink`，磁盘上查不到痕迹
3. **各 64 KB** —— 与 `.so` 的段布局对应

> **【确证】`orcexec.*` 这个字符串在 `.node` 和 `.so` 的字符串表里都搜不到**
> （`strings -a … | grep -i orcexec` 无输出）
> ⇒ 文件名是**运行期拼出来的**（前缀 + 随机后缀）。
> **【推断】** 前缀取自 "force exec" / "or exec" 片段；**【未查清】** 确切构造位置（疑在 stub shellcode 里）。

> **【未查清】`exceptionTable` 字段的作用**：**【推断】** 是为 C++ 异常展开注册 `.eh_frame`，
> 让 hook 函数内抛异常时不崩掉 QQ。

### 4.3 `.so` 的 ABI 契约：只有 6 个导出

`.so` **被 strip 过**（`nm` 报 `no symbols`），但 `.dynsym` 完整保留了 6 个导出。
`.dynsym` 共 161 项，非 `UND` 的只有 8 项（2 个 `SECTION LOCAL` + 这 6 个 `FUNC GLOBAL`）。

```c
0xcf1c  12 B  snowluma_linux_hook_backend_version   // 返回 .rodata 常量字符串
0xcf28  20 B  snowluma_linux_hook_is_loaded         // 原子读一个 bool 全局
0xcf3c  44 B  snowluma_linux_hook_start_dynamic     // getpid() → 初始化 socket 服务
0xcf68  24 B  snowluma_linux_hook_stop_dynamic      // teardown，无条件返回 1
0xcf80  12 B  snowluma_linux_hook_control_socket    // 返回 control fd
0xcf8c  12 B  snowluma_linux_hook_recv_socket       // 返回 recv fd
```

`backend_version` 返回的字符串（`.rodata` @ `0x437f0`）：

```
snowluma-linux-hook-stub/0.2.0
```

**这个自述名很关键**：`.so` 自称 **stub / backend**，**不做业务**。
它只是一个"给什么名字就解析什么"的**通用引擎** —— 这一事实决定了适配策略（见 §6.3）。

### 4.4 跨平台差异

| 平台 | 注入方式 | 证据 |
|---|---|---|
| **Linux** | `ptrace` + 手工 ELF 映射（`.so`） | §4.2 |
| **macOS** | **`DYLD_INSERT_LIBRARIES`**（dylib 注入），无枚举 addon | 源码注释："on macOS the DYLD_INSERT injection model means there is no native enumerate-QQ-processes addon; the existence of our dylib's listener socket IS the proof that a QQ process is hooked" |
| **Windows** | 命名管道 + `getFileHoldersAsync`（按文件占用定位 QQ 进程） | `\\\\.\\pipe\\mojo.<pid>.<suffix>` |

> 当前**只发布了 Linux arm64 产物**，另两个平台有代码路径但**无构建产物**。详见 [compatibility.md](compatibility.md)。

---

## 5. Hook 方式：替换 C++ VTable

**这不是 inline hook（不改指令流），而是把 QQ 对象里虚函数表的槽位指针换掉。**

### 5.1 怎么判断出来的【强推断，五条交叉证据】

1. 错误串：`failed to install a resolved receive VTable`
2. 错误串：`MSFService receive anchor/TaskManager RTTI chain unresolved`
3. 错误串：`MSFCoreService packet-state callback/RTTI chain unresolved`
4. 内部结构字段名全是 `msfServiceVtables` / `msfCoreCallbackVtables` / `msfCoreCallbackOffset`
5. bundle 里**没有** `detour` / `trampoline` / 改写代码段的意图；
   `.so` 虽导入 `mprotect`，但更可能用于自身重定位与 vtable 页写保护

> 也就是说：**hook = 在 QQ 的 C++ 对象里找到 `MSFService` 的 vtable，把特定槽位换成自己的函数指针。**

### 5.2 为什么选 VTable 替换而不是 inline hook

| 维度 | VTable 替换（本项目） | inline hook |
|---|---|---|
| 改动位置 | `.data.rel.ro` 数据段 | `.text` 代码段 |
| 需要改代码页权限吗 | 不需要（数据页本来可写/易改） | 需要 `mprotect` 代码页为 RWX |
| 对被 hook 函数的影响 | 零（原函数字节不动） | 要插跳转，易被完整性校验发现 |
| 对 anti-tamper 的友好度 | 较友好 | 较差 |
| 脆弱点 | **槽位顺序变了就错位** | 指令模式变了就失效 |

**结论：现有选择是对的。** 但代价是它**最怕 vtable 形状变化**（见 §6）。

### 5.3 nnphook 框架（`.so` 与 `.node` 内唯一暴露的 C++ 类型名）

demangle 后的三个类：

```cpp
std::_Sp_counted_ptr_inplace<nnphook::linux_backend::RuntimeTargets const, ...>
std::_Sp_counted_ptr_inplace<(anonymous namespace)::PipeClient, ...>
std::_Sp_counted_ptr_inplace<nnphook::addon::ProcessEnumerator, ...>
```

还原出的设计【强推断】：

```
nnphook/                          自研跨平台 hook 框架（命名空间 nnphook）
├── addon/                        N-API 侧（编进 .node）
│   └── ProcessEnumerator         枚举 /proc，识别"主 QQ 进程"
│       · hasWrapperNode            cmdline/maps 里是否有 wrapper.node
│       · hasMainRuntimeModule
│       · likelyMainProcess
└── linux_backend/                Linux 实现（编进 .so）
    ├── RuntimeTargets            ★ 核心：QQ 运行时结构体的地址集合
    │   · msfServiceTypeinfo          MSFService 的 typeinfo
    │   · msfServiceVtables           MSFService 的 vtable 地址
    │   · msfServiceTypeinfoName      typeinfo 名
    │   · msfServiceCandidates        候选（去重/消歧）
    │   · msfCoreTypeinfo             MSFCoreService 同上
    │   · msfCoreCallbackVtables
    │   · msfCoreCallbackOffset       回调在 vtable 内的偏移
    │   · msfGetStatus / msfDidRecvResponseData   目标函数的解析结果
    │   · wrapperBase                 wrapper.node 的加载基址
    │   · xrefFileOffsets / xrefRuntimeAddresses  交叉引用表
    │   · functionAddresses / functionRuntimeAddresses
    │   RuntimeTargets 用 shared_ptr<const> 共享（immutable 快照）
    └── PipeClient               匿名命名空间里的 socket 客户端
```

### 5.4 具体 hook 哪些函数【确证】目标名

```
MSFService        MSFCoreService       SessionInit
MessageSvc.PbSendMsg                     ← 发送消息的 SSO 命令 ★
selfInfoOnLoginSuccess                   ← 登录成功回调
sendSsoInternal                          ← SSO 发包总入口
msfDidRecvResponseData                   ← 收包回调
msfGetStatus
CreateNTSessionShell / CreateGProSessionShell   ← 会话壳创建
wtlogin. / trpc.login. / QrCode.         ← 登录相关命令前缀
```

### 5.5 一个重要的架构事实

**【确证】`.so` 里没有类名和锚点名** —— 它们全在 `.node` 里。逐字节验证：

| 字符串 | `wrapper.node` | **`.so`** | **`.node`** | `index.mjs` |
|---|---:|---:|---:|---:|
| `N2nt10MSFServiceE` | 6 | **0** | **0** | 0 |
| `N2nt14MSFCoreServiceE` | 7 | **0** | **0** | 0 |
| `msfDidRecvResponseData` | **0** | **0** | **1** | 0 |
| `msfGetStatus` | **0** | **0** | **1** | 0 |
| `selfInfoOnLoginSuccess` | **0** | **0** | **1** | 0 |
| `sendSsoInternal` | **0** | **0** | **1** | 0 |
| `msfServiceTypeinfo` | 0 | **0** | **2** | 0 |

⇒ **`RuntimeTargets` 是一个由 `.node` 填充、`.so` 消费的数据结构。**
**`.so` 是通用引擎；每个 QQ 版本要适配的东西 = `.node` 里的字符串常量 + 锚点表。**

`.so` 自己的 `.data.rel.ro` 里只有一张**通用筛选片段表**：

```
"MSF"  "Msf"  "SSO"  "Session"  "Wrapper"  "Kernel"  "NodeI"
"CreateNTSessionShell"  "CreateGProSessionShell"
--- 进程/模块发现用 ---
"linuxqq"  "ntqq"  "app_launcher.node"  "qqnt"  "libqq"
```

**这是整个逆向分析里适配价值最高的表** —— 它解释了为什么
`MSFService SessionInit/RTTI chain unresolved` 这类错误**只在运行时才报**：
**具体类名由 `.node` 传入，`.so` 只拿这组片段当通用筛选器。**

---

## 6. RTTI 解析链

这是理解"为什么抗 ASLR"和"怎么适配新版本"的核心。

### 6.1 完整链条

```
① RTTI 名（mangled，注意不是纯类名！）
   "N2nt10MSFServiceE"       @ .rodata 0x677ecaa   → nt::MSFService
   "N2nt14MSFCoreServiceE"   @ .rodata 0x67818e1   → nt::MSFCoreService
        ↓
② typeinfo  @ .data.rel.ro
   nt::MSFService       @ 0x87177e0
   nt::MSFCoreService   @ 0x87193f8
        ↓
③ vtable（address_point，注意不是 _ZTV 符号地址）
   MSFService       _ZTV @0x87173d8   address_point @0x87173e0   46 槽
   MSFCoreService   _ZTV @0x8718f50   address_point @0x8718f58   52 槽
        ↓
④ 虚函数槽位
   v[i] 的 vtable 字节偏移 = 8 × i
```

> 以上地址基于 `wrapper.node` md5 `adeb40af26d859d41fcdb21bf38d9eb5`（144,561,472 字节）。

### 6.2 ★ 第一个坑：`__type_name` 存的是 **mangled 名**

Itanium ABI 规定 `std::type_info::name()` 返回**完整 mangled 名**。
所以 `__type_name` 里是 **`"N2nt10MSFServiceE"`**，**不是** `"MSFService"`。

```bash
# ❌ 错误做法：按字面量 "MSFService" 搜 typeinfo
#    → 0 命中（"MSFServiceE" 在 wrapper.node 里出现 11 次，全是 mangled 名的尾巴）

# ✅ 正确做法：匹配 N<len><ns><len><Class>E 模式，并排除干扰项
```

**"裸类名"其实是别的用途**，逐条核实：

| 偏移 | 实际内容 | 真实用途 |
|---|---|---|
| `0x677e7b0` | `"MSFService"` + `../../wrapper/external/msf/msf_response_convert.cc` | **日志 TAG** |
| `0x677e54fe` | `"NodeIKernelMSFService"` + `userName` / `userPwd` / `proxyType` | JS↔native 桥的**属性名** |
| `0x6847424` | `"getMSFService"` + 断言文案 | N-API **JS 方法名** |
| `0x67591a8` | `"MSFService is null!"` | 断言文案 |
| **`0x677fb47`** | **`"MSFService::SessionInit"`** | ✅ **这才是真金**（见 §6.4） |

### 6.3 ★ 第二个坑：节地址换算有 Δ，不能写死

```
[15] .rodata         PROGBITS  665d900   665d900   994a46    ← vaddr == file off ✅
[23] .data.rel.ro    PROGBITS  86acb60   869cb60   32e5a8    ← vaddr ≠ file off ⚠️

DRR_VA, DRR_OFF = 0x86acb60, 0x869cb60
Δ = DRR_VA - DRR_OFF = 0x10000

file_off = vaddr - Δ      # 仅对 .data.rel.ro / .got / .data / .bss 成立
vaddr    = file_off + Δ
# .rodata / .text：vaddr == file_off
```

> **`0x10000` 这个 Δ 值本身不固定，换版本会变** —— 必须从节表算出来，不能硬编码。

### 6.4 ★ 虚函数名的还原方法（最有价值的技术）

问题：**目标虚函数在哪个槽位？**
答案：**靠槽位函数体内引用的字符串反查方法名。** 这不是猜测 —— 它给出的是**确定性**结果。

```
① 在 .rodata 里定位锚点串
   "MSFService::SessionInit"      @ file 0x677fb47
   "MSFCoreService::SessionInit"  @ file 0x6781f13
        ↓
② 扫 .text，找 adrp+add 指向它的指令位置（xref site）
   → site 0x137aa9c  /  site 0x139e0f0
        ↓
③ 用 .eh_frame_hdr 解出全部函数起点（本例 318,767 个）
        ↓
④ 判定 site 落在哪个函数区间内
   site 0x137aa9c ∈ [0x137a48c, 0x137b194)  → 函数 0x137a48c
   site 0x139e0f0 ∈ [0x139d864, 0x139e8e4)  → 函数 0x139d864
        ↓
⑤ 该函数指针在 vtable 里的槽位 = 要 hook 的槽位
   0x137a48c 是 nt::MSFService     的 v[19]（ap+0x98）✅
   0x139d864 是 nt::MSFCoreService 的 v[19]（ap+0x98）✅
```

**闭环验证（精确边界，非窗口包含）**：锚点、函数、槽位三者一致 —— **【确证】**。

> ⚠️ **不能用函数名匹配**：`wrapper.node` 无 `.symtab`，`nm` 报 `no symbols`。

### 6.5 关键槽位表

**`nt::MSFService`** —— `_ZTV` @ `0x87173d8`，地址点 @ `0x87173e0`，typeinfo @ `0x87177e0`

| 槽 | 字节偏移 | 函数 VA | 方法名 | 置信度 |
|---:|---|---|---|---|
| 17 | 0x88 | 0x137877c | `Initialize` | 强推断 |
| **19** | **0x98** | **0x137a48c** | ★ **`SessionInit`** | **确证** |
| 32 | 0x100 | 0x1383f14 | `operator()` **recv msf push** ★收包锚点 | 强推断 |
| 36 | 0x120 | 0x137cc80 | `SendSSORequestInternal` | 强推断 |
| 44 | 0x160 | 0x137b194 | `OnConnectivityChanged` | 强推断 |
| — | 0x168 | `0xfffffffffffffff8` | **不是函数指针 → vtable 结束** | — |

**`nt::MSFCoreService`** —— `_ZTV` @ `0x8718f50`，地址点 @ `0x8718f58`，typeinfo @ `0x87193f8`

| 槽 | 字节偏移 | 函数 VA | 方法名 | 置信度 |
|---:|---|---|---|---|
| 18 | 0x90 | 0x139c93c | `Initialize` | 强推断 |
| **19** | **0x98** | **0x139d864** | ★ **`SessionInit`** | **确证** |
| 36 | 0x120 | 0x139f488 | `SendSSORequest` | 强推断 |
| 47 | **0x178** | **0x13a3e80** | ★ **`onMSFPacketState`** | 强推断 |
| 52 | 0x1a0 | 0x13a46c4 | `OnConnectivityChanged` | 强推断 |

> **两个类的 `SessionInit` 都在字节偏移 `0x98`（槽位 19）** ——
> 这解释了为什么 `.so` 里 `MSFService` 和 `MSFCoreService` 各有一条**独立的**
> `"…SessionInit/RTTI chain unresolved"` 报错串。

> ⚠️ **方法名置信度说明（诚实标注）**：
> 只有 **`SessionInit`（v[19]）是【确证】**（靠 `.eh_frame_hdr` 精确函数边界闭环）；
> 其余槽位的方法名是**【强推断】** —— 来源是"该函数体内引用的 `Class::method` 字符串"，
> 但 0x1400 字节的扫描窗**可能跨入相邻函数**，个别条目可能偏移一位。
> **做版本适配时不要依赖方法名表**，要依赖 §6.4 的锚点判定 —— 那才是确定性的。

### 6.6 ⚠️ 多个 address point：必须按 `offset_to_top == 0` 过滤

一个 typeinfo 会对应**多个** address point（多继承/虚基类下类被嵌入不同基类子对象）：

```
nt::MSFService     ti=0x87177e0 → 5 个地址点：
    0x87173e0  offset_to_top=0     ← ★ primary（要用的）
    0x8717550  offset_to_top=-8
    0x8717748  offset_to_top=-16
    0x87177a0  offset_to_top=-24
    0x87177b8  offset_to_top=-32

nt::MSFCoreService ti=0x87193f8 → 6 个地址点：
    0x8718f58  offset_to_top=0     ← ★ primary
    0x8719108  offset_to_top=-8
    0x8719300  offset_to_top=-16
    0x8719358  offset_to_top=-24
    0x8719370  offset_to_top=-32
    0x87193a0  offset_to_top=-64
```

布局完全符合 Itanium ABI：`v[-1] = offset_to_top`，`v[0] = typeinfo`，`v[1..] = 虚函数`。
`_ZTV` 符号 = `address_point - 16`；`_ZTI` = typeinfo 地址；`_ZTS` = `__type_name`。

> ⚠️ **如果解析器只取"第一个找到的"，新版本里顺序一变就会选错。
> 必须按 `offset_to_top == 0` 过滤。**

### 6.7 RTTI 种类判定与它的边界

| 类 | `__vptr` | RTTI 种类 |
|---|---|---|
| `nt::MSFService` | `0x871e698` | `__class_type_info`（同族） |
| `nt::MSFCoreService` | `0x871e698` | 同上（与 MSFService **共用** ABI vtable） |
| `nt::IMSFInterface` | `0x871e698` | 同上 |
| `N3msf11IMSFServiceE` | `0x871e5e0` | 另一族 |
| `N2nt7wrapper17IKernelMSFServiceE` | `0x871e5e0` | 与 `msf::IMSFService` 同族 |

⇒ **`__vptr` 相同 = 同一 RTTI 种类**，解析器可用它做一致性校验。

**【确证】`.so` 导入了 `_ZTVN10__cxxabiv117__class_type_infoE` 与
`_ZTVN10__cxxabiv120__si_class_type_infoE`**（在 `.rela.dyn` 里可见，`+10` 加数 = 地址点），
证实它确实在做 RTTI 种类判定。

> ⚠️ **它只引用了 117 和 120，没有 121（`__vmi_class_type_info`）。**
> 这意味着：**如果腾讯给 `MSFService` 加了多继承/虚基类，解析器会直接不认。** —— 见 §8 情况 5。

### 6.8 为什么必须运行时解析（反向验证）

看似"符号表里找一下就行"，实际**不行**：

```bash
# 看似可行：dynsym 里确实有 RTTI 符号
$ readelf -sW --dyn-syms wrapper.node | awk '$8 ~ /_ZT[VIS]/' | wc -l
397                       # _ZTV=17  _ZTI=185  _ZTS=195

# 但 hook 目标类一个都没有
$ readelf -sW --dyn-syms wrapper.node | grep -E "MSFService|MSFCoreService" | grep -cE "_ZT[VIS]"
0
$ readelf -sW --dyn-syms wrapper.node | grep -cE "_ZN2nt10MSFService"
0
```

那 397 个属于 `vips::VOption`、`nt::tinyxml2::XMLUnknown`、`std::__function::__base<...>` 等**无关类型**。
再加上 **`wrapper.node` 没有 `.symtab`**（31 个节头里没有）：

⇒ **没有任何符号级途径拿到目标 vtable；唯一途径是数据级 RTTI 反查 + 字符串锚点。**
**上游做法无误。**

> ⚠️ **踩过的坑（写进核查清单）**：有一个中间产物 `all-exports.txt` 是
> **"已定义导出"的子集**（468 条），拿它当"全部符号"会得出
> **"dynsym 里没有 RTTI"的错误结论**（实际有 397 个）。
> **任何时候都要回到 `readelf -sW --dyn-syms` 原文。**

---

## 7. 数据流

### 7.1 出站：OneBot 动作 → QQ 发包

```
外部（HTTP / WS 客户端）
  │  POST /send_group_msg  {"group_id":…, "message":[…]}
  ▼
packages/onebot/src/network/*-adapter.ts     鉴权、解析、构造 Action 对象
  ▼
packages/onebot/src/api-handler.ts           动作分发
  ▼
packages/onebot/src/actions/message.ts       动作实现
  ▼
packages/core/src/bridge/apis/message.ts     bridge 层：把业务参数翻译成协议参数
  ▼
packages/protocol/src/oidb-services/**/      构造 OIDB 业务包
packages/protocol/src/element-builder.ts     消息元素 → wire 格式
  ▼
packages/bridge/src/hook-packet-client.ts    打成 40 字节帧（magic "QHP1"）
  ▼
Unix socket  /tmp/runtime-<uid>/mojo.<pid>.control.sock
  ▼
┌─────────────────── QQ 进程内 ───────────────────┐
│ .so 解帧                                        │
│   ▼                                             │
│ 调用被 hook 的 sendSsoInternal / SendSSORequest  │
│   ▼                                             │
│ MSFService::SendSSORequestInternal              │
└─────────────────┬───────────────────────────────┘
                  ▼
        官方 MSF 会话（已登录、已加密、官方设备指纹）
                  ▼
            腾讯服务器
```

### 7.2 入站：QQ 收包 → OneBot 事件

```
腾讯服务器
  ▼
官方 MSF 会话收包
  ▼
┌─────────────────── QQ 进程内 ───────────────────┐
│ MSFCoreService::onMSFPacketState   (v[47], ap+0x178)
│ MSFService::operator() recv push   (v[32], ap+0x100)
│   ▼ 被替换的 vtable 槽位先拿到数据                │
│ .so 写帧到 recv socket                          │
└─────────────────┬───────────────────────────────┘
                  ▼
Unix socket  /tmp/runtime-<uid>/mojo.<pid>.recv.sock
                  ▼
packages/bridge/src/hook-packet-client.ts     解帧
  ▼
packages/protocol/src/msg-push/{client,codec,registry}.ts   包分发
  ▼
packages/protocol/src/msg-push/decoders/*.ts  按类型解码
   event / friend / group-admin / group-join /
   group-member-change / group-message / temp-message
  ▼
packages/protocol/src/msg-push/rich-body-decoder.ts   富文本消息体（13,498 行）
  ▼
packages/onebot/src/event-converter/*         转成 OneBot v11 事件
  ▼
packages/onebot/src/network/*                 按配置上报
   ├─ HTTP 服务端     0.0.0.0:3000
   ├─ WS 服务端       0.0.0.0:3001
   ├─ HTTP 客户端（上报）
   ├─ WS 客户端（反向）
   └─ SSE
  ▼
外部（HTTP / WS 客户端）
```

### 7.3 稳定性设计：每条链路的重连策略

| 机制 | 参数 | 说明 |
|---|---|---|
| `HookManager` tick | `DEFAULT_INTERVAL_MS = 1500`（最小 250） | 每 tick 刷新账号 + 驱动 pipe-watcher |
| 自动加载重试 | `AUTO_LOAD_MAX_ATTEMPTS = 3` | **只对瞬时错误重试**，其他错误判永久失败立即放弃 |
| 探活 | `isConnectableUnixSocket()`，250 ms 超时 | **必须真 `connect()` 成功才算活** —— 避免被残留 socket 文件骗到 |
| 幂等重连 | `HookSession.onPipeUp/onPipeDown` | 可**接管已有 hook** —— framework 重启后不需重新注入 QQ |
| OneBot WS 客户端重连 | `DEFAULT_RECONNECT_INTERVAL_MS = 5000` | 校验范围 1000 ms ~ `NODE_TIMER_MAX_MS` |
| OneBot 心跳 | `HEARTBEAT_INTERVAL_MS = 30000` | |
| 进程回收 | `REAPER_INTERVAL_MS = 300000` | 5 分钟 |
| 日志 writer 恢复 | `degraded` 状态 + `retry(force)` | "log writer retry is rate-limited" |

> **【确证】没有指数退避、没有抖动、没有熔断。**
> `grep -c backoff index.mjs` → 1，但那**唯一命中在内嵌的 zxcvbn 密码字典里**
> （`"backoff"` 被当作弱密码收录），**与重连逻辑无关**。
> `jitter` / `circuit` 同理均为假阳性。
>
> **判据**：如果 `grep -c` 计数很小（1~3）且 `grep -an` 显示都指向同一行（字典行），就是假阳性。
> **要看行号分布，不要看计数。**

**稳定性设计总结**：**"watchdog 式轮询 + 幂等重连 + 有限重试"**。对接手者是个明确的改进点。

### 7.4 为什么不需要独立的 watchdog 进程

容器层靠 **supervisord**（PID 1）做存活性守护：
`[program:qq]` 和 `[program:snowluma]` 都是 `autostart=true` / `autorestart=true`。
runtime 内部不再需要第二层守护。

> **【确证】`watchdog` 在 bundle 里 3 次命中全是别的语义**
> （卡住请求的 idle watchdog、启动告警监控），**不是存活性守护进程**。

---

## 8. 为什么抗 ASLR（关键设计）

**QQ 每次启动的加载基址都不同（ASLR），但 Haizakura 的所有解析都不依赖固定地址。**
它靠的是**四层运行时自定位**：

### 8.1 第一层：GNU build-ID 做模块身份校验

```bash
$ readelf -n wrapper.node | head -6
Displaying notes found in: .note.gnu.build-id
  Owner                Data size    Description
  GNU                  0x00000014   NT_GNU_BUILD_ID (unique build ID bitstring)
    Build ID: 89c36b520f97c88081a9453bd6abb70c3452f156
```

```
位置：.note.gnu.build-id @ vaddr 0x200 / file 0x200
段大小：0x24，其中 NT_GNU_BUILD_ID 描述符 0x14 (20) 字节
```

**为什么用 build-ID 而不是 md5 / 文件大小**：

| 方式 | 要读多少 | 换版本会变吗 | 适合运行时校验吗 |
|---|---|---|---|
| 文件大小 | 全部 | 会 | 否 |
| md5 | **全部 144 MB** | 会 | ❌ 太慢 |
| **build-ID** | **0x200 处 36 字节** | 会（但这是它的用途） | ✅ **最优** |

> `89c36b52…` **就是 `.so` 里 `missing or ambiguous GNU build ID` 校验的那个值**。
> 它是**跨版本区分 `wrapper.node` 的唯一可靠指纹**。

### 8.2 第二层：按**节名**解析 ELF，运行时算 Δ

`.so` 依赖**节名**（`.rodata` / `.data.rel.ro` / `.text` / `.got`）而不是**节索引**：

```
0x24af4   ELF 节表解析（按节名）    证据：".data" / ".got" / ".text" 节名字符串
0x2b518   ELF 头 + 节表头校验       证据："ELF file is too small" /
                                        "not a little-endian ELF64 file" /
                                        "ELF section table is missing" /
                                        "ELF section entry is smaller than expected"
```

地址换算用**运行时从节表算出的 Δ = vaddr − file_off**，而不是硬编码 `0x10000`（见 §6.3）。

### 8.3 第三层：运行时 demangle + 结构匹配（不是字符串匹配）

**【确证】`__cxa_demangle` 全 `.so` 只调用 1 次**（位于 `0x2e0d8`，在 `0x2d6ac` 模块定位函数内的日志路径）。

⇒ **它不做名字解析，只做结构匹配** —— 按 `N<len><ns><len><Class>E` 的**模式**匹配，
而不是按字面量比对（比字符串匹配更稳）。demangle 只用于日志可读性。

### 8.4 第四层：磁盘 vs 内存双向比对

```
0x39b10   磁盘 vs 内存一致性校验
          证据："ELF metadata differs from live memory" /
                "read candidate" / "read mapped metadata" /
                "ELF metadata is outside the file or readable header mapping"
```

`.node` 的字段成对出现：

```
xrefFileOffsets / xrefRuntimeAddresses
functionAddresses / functionRuntimeAddresses
anchors[] : { address, fileOffset, size, flags, runtimeAddress, demangled, ... }
```

**最自洽的解释【强推断】**：

- **`xrefFileOffsets`** = 在 `wrapper.node` **磁盘文件**里记录的**文件偏移**列表
  （"这个引用点应该出现在文件偏移 X"）—— **静态指纹**
- **`xrefRuntimeAddresses`** = 同一批引用点**换算到运行时绝对地址**
  （`wrapperBase + 校正偏移`）—— **动态地址**

两者配对让 `.so` 能**双向校验**：既确认"内存里这个位置确实是预期的指令/指针"，
又确认"磁盘文件没被动过手脚"，从而在**版本错配**和**内存被篡改**两种情况下都**安全退出**而不是乱改 vtable。

### 8.5 第五层：失败即安全退出（防御性设计，值得称赞）

**【确证】唯一的验证闸门是 `0x5610`** —— 全部 12 条 RTTI 失败串都在这里，
它们构成一个**全"与"关系**的检查清单，**任一条失败即整链失败并要求拒绝注入**：

```
0x5610  ★ 验证闸门 + 提交
  证据串：invalid pid / failed to inspect wrapper.node /
         runtime service structures could not be read or resolved /
         全部 RTTI 失败串 / QQ runtime cannot read process memory /
         (errno=…) [RUNTIME_MEMORY_UNAVAILABLE]
```

反汇编 `0x6480-0x6678` 可见连续的 `cbz/cbnz` → 分支 → `adrp + add + bl <append>` 模式，
且 `0x5610` 结尾把所有错误串拼成一条用 `"; "` 分隔的总报错 ——
正好解释 `.so` 里那个孤立的 `"; "` 串 @ `0x44b63`。

### 8.6 小结：抗 ASLR 的完整链条

```
QQ 启动（ASLR，基址随机）
   ↓
read /proc/<pid>/maps  → 找 /opt/QQ/ 前缀的映射 → wrapper.node 的 base
   ↓
按节名解析 ELF → 运行时算 Δ = vaddr − file_off
   ↓
读 .note.gnu.build-id 校验身份（36 字节，唯一可靠指纹）
   ↓
读 .rela.dyn 的 R_AARCH64_RELATIVE → 建 slot_vaddr → addend 映射
   ↓
在映射里找 addend ∈ .rodata 且内容为 mangled 类名 → 得到 typeinfo
   ↓
在 .data.rel.ro 找 value == typeinfo 的位置 → 得到 address_point
   按 offset_to_top == 0 取 primary
   ↓
v[1..] 逐个查重定位表 → 得到全部槽位（运行时绝对地址）
   ↓
磁盘 vs 内存双向比对 → 一致才继续
   ↓
mprotect(RW) 改槽位 → 恢复 R → 安装完成
```

**全程零硬编码地址。** 这就是它能跨小版本存活的原因。

---

## 9. 为什么低风控（风控视角，诚实版）

> ⚠️ **先纠正一个常见误解**：下面多数机制是**反"被本地检测到"（隐蔽性）**，
> **不是**对抗腾讯服务端风控。真正与风控相关的是"协议行为像官方客户端"。

### 9.1 真正的优势：寄生官方已登录会话

```
✅ 复用一个【已登录】的官方 MSF 会话
✅ 通过 VTable hook 劫持 sendSsoInternal / msfDidRecvResponseData 借官方通道收发
✅ 上层用 OIDB 构造业务包
```

**从腾讯服务端看，流量就是官方客户端自己发的** ——
同一个 MSF 会话、同样的加密、同样的 TLS 指纹、同样的设备信息。

这是它能长期稳定运行（生产实例连续 9 天以上，日志约 11 MB/天）的**根本原因**。

### 9.2 隐蔽性措施（反本地发现）

| # | 措施 | 证据强度 |
|---|---|---|
| ① | **socket 命名伪装成 Chromium Mojo** —— 在 `/proc/<pid>/fd`、`ss -xpn` 里像 QQ 自己的 IPC | 【确证】 |
| ② | **注入后立刻 unlink，磁盘无痕** —— `maps` 里带 `(deleted)` | 【确证（动态）】 |
| ③ | **临时文件名随机化** —— `orcexec.bEkdOA`，6 位随机后缀 | 【确证（动态）】 |
| ④ | **环境变量清理** —— `.so` 导入了 `unsetenv`，但 `index.mjs` 没引用它 | 【推断】，**【未查清】** unset 了哪些 |
| ⑤ | **进程枚举启发式** —— `likelyMainProcess` / `hasWrapperNode` / `matchedHints` | 【确证】 |

> ⚠️ **⑤ 线程名没有伪装**：注入线程名直接叫 **`snowluma-pipe-w`**，暴露了自身。
> **【推断】** 作者认为线程名比进程行为更难被发现，或没在意。
> 这是 **native 层，改不了** —— 只能接受。

### 9.3 ⚠️ 它**没有**的东西（别去找不存在的东西）

| 缺失项 | 验证方式 | 结果 |
|---|---|---|
| 设备指纹伪造 | grep `device` 相关伪造 | ❌ 命中均为无关上下文 |
| 签名伪造 | grep `sign` | ❌ 命中的是 `signed_list`、`group-signed` 等业务动作 |
| 请求抖动 | grep `jitter` | ❌ 0 命中 |
| 指数退避 | grep `backoff` | ❌ 唯一命中在 zxcvbn 密码字典行 |
| 熔断 | grep `circuit` | ❌ 同上 |
| 请求频率伪装 | — | ❌ 除 `statusCommand.cooldownSeconds` 这类功能性的 |
| 代码混淆 | 统计平均行长 | ❌ 平均 32.6 字符，**未混淆** |
| license 校验绕过 | — | ❌ 无 |

### 9.4 项目刻意保持合规姿态【确证】

```
EULA.md        12,290 B
PRIVACY.md     10,510 B
consent.json   { version: "dcb31a7b03a0b64d", acceptedAt: … }
环境变量        SNOWLUMA_ACCEPT_EULA / SNOWLUMA_ACCEPT_PRIVACY
```

⇒ **项目没有隐藏/混淆自身存在的意图。** 许可状态见 [contributing.md](../dev/contributing.md) §7。

---

## 10. 模块地图

原 monorepo 是 **8 个包**，全部被内联进单个 `dist/index.mjs`（**467 个 `//#region` 标记**）。

| 包 | region 数 | 职责 |
|---|---:|---|
| `protocol` | 112（还原后 180 文件） | **最大**。OIDB 服务、Highway 上传、消息推送解码、Web/QZone API |
| `onebot` | 77 | OneBot v11 实现（动作、事件、网络适配器） |
| `core`（region 路径为 `src/`） | 33（还原后 65 文件） | 入口 + WebUI 后端 + update + bridge API 实现 |
| `common` | 20 | 日志脱敏、错误、coerce、runtime 路径 |
| `bridge` | 17 | **注入核心**：injector / hook-manager / pipe-watcher / qq-account |
| `websocket` | 5 | WebSocket 客户端/服务端封装 |
| `sqlite` | 3 | SQLite 驱动（native 加载、prebuild 选择） |
| `proton` | 1 | **【未查清】** 功能，region 名被截断 |
| 第三方 | ~200 | `hono` / `@hono/node-server` / `@zxcvbn-ts/*` / `semver` / `htmlparser2` / `domhandler` / `entities` |

> `core` 的 region 路径是 `src/...` 而非包名 —— 因为**构建时的 cwd 就是 `packages/core`**。

### 10.1 模块依赖图

```
                    ┌──────────────────────────┐
                    │  core/src/index.ts (入口)  │  解析 env / 选中 updateRoot
                    └────────────┬─────────────┘
                                 │
     ┌───────────────────────────┼───────────────────────────┐
     ▼                           ▼                           ▼
┌───────────────┐      ┌──────────────────┐        ┌─────────────────┐
│ core/webui/*  │      │ bridge/manager.ts│        │ core/update/*   │
│ :5099 WebUI   │◄────►│  HookManager     │        │ 自动更新         │
│ hono + SSE    │      │  ┌────────────┐  │        │ GitHub+镜像     │
└───────┬───────┘      │  │pipe-watcher│  │        └─────────────────┘
        │              │  └─────┬──────┘  │
        │              │  ┌─────▼──────┐  │   状态机：disconnected
        │              │  │HookSession │  │   → connecting → connected
        │              │  │  (每 PID)  │  │   → error
        │              │  └─────┬──────┘  │
        │              │  ┌─────▼──────┐  │
        │              │  │ injector.ts│──┼──► .node addon（宿主插件）
        │              │  └────────────┘  │     loadModuleManualAsync
        │              │  ┌────────────┐  │     unloadModuleManualAsync
        │              │  │qq-hook-    │──┼──► Unix socket (mojo.*.sock)
        │              │  │client.ts   │  │     ↕ 40B 帧协议
        │              │  └────────────┘  │
        │              └────────┬─────────┘
        ▼                       ▼
┌─────────────────────────────────────────────────────────────┐
│ core/bridge/apis/*  (19 个)  ←→  protocol/src/**  (112 个)   │
│  contacts / group-admin / group-file / message / profile /   │
│  qzone / collection / interaction / system-face / web …      │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ onebot/src/** (77)                                          │
│  actions/* (16)  event-converter/* (8)  network/* (11)       │
│  modules/* (7)   message-store / media-store / reaction-store│
│  → ：3000 HTTP   ：3001 WS  以及 wsClients 出站                │
└─────────────────────────────────────────────────────────────┘
```

### 10.2 网络端口

| 端口 | 用途 | 配置键 |
|---|---|---|
| 5099 | WebUI（hono + SSE） | `runtime.json` 的 `webuiPort` / `SNOWLUMA_WEBUI_PORT` |
| 3000 | OneBot v11 HTTP 服务端 | `onebot.json` 的 `networks.httpServers[]` |
| 3001 | OneBot v11 WS 服务端 | `onebot.json` 的 `networks.wsServers[]` |
| 6081 | noVNC（扫码登录用） | 容器 `supervisord.conf`（vnc-password / x11vnc） |

> 生产实例做了端口映射：`5099→5199`、`3000→3010`、`3001→3011`、`6081→6181`。

---

## 11. 一页速查

```
Haizakura = 一个"寄生"在官方 Linux QQ 客户端里的运行时

  进程:  qq (Electron)              ← 被注入
         node index.mjs             ← 控制方
  通道:  Unix socket /tmp/runtime-<uid>/mojo.<pid>.{control,recv}.sock
         （伪装成 Chromium Mojo），40 字节头 + 3 段 body，magic = "QHP1"

  注入:  .node 用 ptrace + process_vm_writev + 远程 mmap 手工映射 .so
         （不用目标进程的 dlopen），临时文件落地后立即 unlink

  挂钩:  不是 inline hook，而是替换 wrapper.node 里
         MSFService / MSFCoreService 的 C++ VTable
         → 借官方已登录会话收发消息
         目标：MessageSvc.PbSendMsg / sendSsoInternal /
              msfDidRecvResponseData / selfInfoOnLoginSuccess

  抗ASLR: build-ID 身份校验 + 按节名解析 + 运行时算 Δ
          + 运行时模式匹配（非硬编码）+ 磁盘/内存双向比对

  上游:  业务逻辑（OneBot / 协议 / WebUI）全在 index.mjs
         —— 未混淆，可读可改
         黑箱只有 654 KB 的两个 native 文件（注入器 + hook 后端）

  最大风险: QQ 升级 → VTable/RTTI 解析失败 → 全功能失效
```

---

## 12. 相关文档

| 想了解 | 去看 |
|---|---|
| 支持哪些 QQ 版本 / 依赖什么 | [compatibility.md](compatibility.md) |
| 出问题了怎么排查 | [troubleshooting.md](troubleshooting.md) |
| 怎么从源码构建 | [build.md](../dev/build.md) |
| 怎么参与开发 | [contributing.md](../dev/contributing.md) |

---

*本文所有地址/指纹基于 `wrapper.node` md5 `adeb40af26d859d41fcdb21bf38d9eb5`（144,561,472 字节）。
接手前请核对 md5。结论保留原有证据等级标注：【确证】/【强推断】/【推断】/【未查清】。*
