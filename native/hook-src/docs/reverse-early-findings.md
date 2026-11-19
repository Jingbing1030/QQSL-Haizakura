# 闭源载荷逆向：早期事实（我的勘察）

## 二进制概况
- `snowluma-linux-x64.so`，425,216 B，x86-64 ELF，**stripped，零 debug 符号**
- `.text` @0x4890 大小 0x51cc2（335 KB）
- `.rodata` @0x57000 大小 0x5cf8
- `.data.rel.ro` @0x67b20 大小 0x268（vtable/type_info 区）
- `.bss` @0x684a8 大小 0xce8
- init_array 3 项（0xcdd0/0xd230/0xd3d0），全是 C++ 静态析构样板，无功能代码

## 6 个导出全是跳转桩（0xe160–0xe1e0）
| 导出 | 地址 | 实现 |
|---|---|---|
| `backend_version` | 0xe160 | `lea 0x48f29(%rip)` → 0x57090 字符串 |
| `is_loaded` | 0xe170 | 读 bss 0x68c08 字节 bit0 |
| `start_dynamic` | 0xe180 | `getpid()` → `call 0xe1d0`，返回同一标志 |
| `stop_dynamic` | 0xe1a0 | 跳 0xe1d0 附近 |
| `control_socket` | 0xe1c0 | 读 bss |
| `recv_socket` | 0xe1d0 附近 | 读 bss |

真实实现入口 **0xe1d0**。

## 版本串（铁证）
地址 0x57090：`snowluma-linux-hook-stub/0.2.0`
内部命名空间（RTTI）：**`nnphook::linux_backend::RuntimeTargets`**
pipe 线程名：`snowluma-pipe-w`、worker 名 `reap client worker` / `join client worker`

## 关键：没有写内存的系统调用
导入表里：
- ✅ `process_vm_readv`（只读，GLIBC_2.15）
- ✅ `mprotect`
- ✅ `open` / `pread` / `readlink`
- ❌ **没有 `process_vm_writev`**
- ❌ **没有 `ptrace`**

`open()` 的 flags 是 `0x80000` = **O_CLOEXEC**（只读打开），两个调用点都在读 ELF/模块元数据路径上。

**结论**：闭源载荷自己**不写目标进程内存**。它只做「读 + 解析 + 上报」，真正的 vtable 写入由外部注入器（`.node`）完成，或通过它导出的 socket 把目标地址告诉 Node 侧。这解释了日志里 `failed to install a resolved receive VTable` 为什么是失败态而非动作。

## Socket 路径：无字面量
`mojo.`、`control.sock`、`recv.sock`、`snowluma-` 前缀在二进制里**全部找不到**。
只有两个短串 `control` 和 `recv`（0x570xx 附近），说明路径是**运行期拼装**的：
`<runtimeDir>/mojo.<pid>.<kind>.sock`，kind 取 `control` / `recv`。
runtimeDir 来自 `getenv`。

## 协议
`QHP1`（0x31504851）在文件偏移 0x11319 / 0x113c5 / 0x1167c / 0x1f19c 出现 4 次。

## 功能面（从 .rodata 日志字符串反推，371 条）
这不是一个简单 hook，而是一个**带完整错误处理的事务型实现**：

### 1. 目标解析（RTTI 链）
- `failed to inspect wrapper.node`
- `RuntimeTargets` / `MSFService SessionInit/RTTI chain unresolved`
- `MSFCoreService send features missing or ambiguous`
- `MSFService receive anchor/TaskManager RTTI chain unresolved`
- `MSF live selector feature/RTTI chain missing or ambiguous`
- `MSFCoreService packet converter/native allocator unresolved`
- `receipt mutex import missing or ambiguous`
- `ELF metadata differs from live memory`
→ 靠 **RTTI + ELF 节表**在运行期定位，不硬编码地址。用 `__cxa_demangle` 解类名。

### 2. 读内存的健壮性
- `QQ runtime cannot read process memory`
- `: kernel support is unavailable or the system call is blocked`
- `: access was denied by system policy`
- `: the read did not complete`
- `[RUNTIME_MEMORY_UNAVAILABLE]`
→ `process_vm_readv` 的错误分类：ENOSYS / EPERM / 短读，分别给不同提示。

### 3. 会话与身份校验（防串号）
- `session binding is empty` / `session identity changed`
- `session no longer identifies an account` / `session account identity changed`
- `native selected session changed` / `session kind unavailable`
- `session interface unavailable`
- `NG session/receive ownership path unresolved`
- `session NG send ownership changed`
→ 有**会话身份前后的比对**，防止 hook 到错误的会话实例。

### 4. 发送消息（事务型快照）
完整的「读快照 → 校验 → 发送 → 回执」流水线，错误码极细：
- `message snapshot address rejected` / `read failed` / `size rejected`
- `message snapshot type rejected` / `order rejected` / `field missing`
- `message snapshot UID type/size/bounds/character rejected`
- `message UID changed during snapshot`
- `message payload changed during snapshot`
- `message changed during snapshot`
- `client message task tree changed` / `queue changed` / `callback missing`
- `client message sequence missing`
- `MessageSvc.PbSendMsg` / `MessageSvc.PbSendMsg-`
→ **乐观并发校验**：读两遍对比，变了就重试。

### 5. 回执与私聊上报
- `client message receipt size rejected`
- `receipt pending operation changed or unreadable`
- `receipt pending members disagree or are out of bounds`
- `receipt worker missing or ambiguous`

### 6. 模块发现
- `/proc/self/maps`、`/map_files/`、`/proc/<pid>/`
- `/comm`、`/exe`、`/cmdline`
- 进程名匹配：`linuxqq` / `ntqq` / `qqnt` / `libqq`
- `app_launcher.node`
- ELF 校验全套：`ELF file is too small` / `not a little-endian ELF64 file` / `ELF section table is missing` / `missing or ambiguous GNU build ID` / `no mapped GNU build ID` / `truncated ELF note`
- `/opt/QQ/` 路径提示
→ 用 **GNU build ID + 活内存比对**确认模块是真身，防替换/防过期。

## 与我们实现的差异（要补的）
| 能力 | 闭源 | 我们 |
|---|---|---|
| 目标定位 | RTTI 链运行期解析 | 硬编码地址 + 人工确认 |
| 内存读取错误分类 | 3 类 errno + 专属日志 | 无 |
| 会话身份校验 | 前后比对 | 无 |
| 发送快照并发校验 | 读两遍对比重试 | 无 |
| 模块真身校验 | build ID + 活内存比对 | reloc_check 静态预检 |
| 多进程名识别 | linuxqq/ntqq/qqnt/libqq | 仅 `qq` |
