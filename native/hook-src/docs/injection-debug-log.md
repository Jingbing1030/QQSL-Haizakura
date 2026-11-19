# 注入调试记录

## 已确认的失败根因（按发现顺序）

### 1. `loadModuleManualAsync` 必须调用 `start_dynamic`

`.so` 的 `e_entry` 是 0（原版行为，用 `snowluma_linux_hook_start_dynamic` 兜底）。
但只跑 `.init_array` 不够：手写加载器必须**主动调用入口**，载荷才会创建
`mojo.<pid>.control.sock` / `recv.sock`。原版注入后 socket 立刻出现，证明它调用了。

### 2. `start_dynamic` 会创建线程，ptrace 等待必须能容忍

载荷在 `start_dynamic` 里 `pthread_create` 起监听线程。这些线程会各自产生
SIGTRAP。`waitpid(pid, __WALL)` 会收到**所有**线程的 stop。

- 不能把这些 stop 当崩溃（原先 `fail(...)` 直接报 "raised signal 5 at
  pc 0x..."，pc 落在离被调函数很远的地方）
- 也不能**无限**放行：QQ 上观察到同一个 `pc=0xb6a750b37624` 被 resume 了成千
  上万次，node 最终 exit 255，QQ 留下僵尸 tracer。有界（16 次）才是对的。

### 3. `PTRACE_ATTACH` vs `PTRACE_SEIZE`

`ATTACH` 受 yama `ptrace_scope` 约束；`SEIZE` 不要求父子关系。原版二进制里
有 `PTRACE_SEIZE failed` 字符串，确认它用 SEIZE。

**注意**：`EPERM` 也可能是"目标已有僵尸 tracer"——一个进程只能有一个 tracer，
`TracerPid` 指向已退出进程时，任何新 attach 都是 EPERM，只能重启目标清除。

### 4. detached 调用的 sled 必须是 `jmp $`，不能是 `int3`

`remote_call` 用 int3 sled 是对的：它保持 attach，能接住 SIGTRAP。
`remote_call_detached` 刻意放开 ptrace，此时返回进 int3 的 SIGTRAP 无人接手，
内核默认动作是**杀掉整个线程组**。

修法：sled 写 `EB FE`（`jmp $`）。返回后那个线程在已映射可执行页里永久自旋，
泄漏一个线程的 CPU，但不会崩、不会杀宿主。`hlt` 不行（ring 3 是 SIGSEGV）。

### 5. STT_GNU_IFUNC 必须解析

glibc 的 `strlen`/`strncpy`/`memset`/`memcmp` 都是 IFUNC：`st_value` 是
**resolver 地址**，不是实现地址。当函数直接给 payload 会导致
`strlen(control)` 返回一个指针值 → payload 的"路径太长"检查成立 →
`start_dynamic` 返回 -1 → socket 永不出现 → 表现为"hook 没启动"。

必须在**目标进程里**调 resolver（它会读目标自己的 auxv/CPU 特性），
且必须 guard `sym->is_ifunc`（否则连 `stdout` 这种数据符号都会被"调用"）。

## 关键尺寸（wrapper.node aarch64）

| 项 | 值 |
|---|---|
| `mappedEnd - base` | `0x89ed000` ← 用 `p_filesz`，不是 `p_memsz` |
| `execEnd - base` | `0x869a000` ← PT_LOAD `PF_X` 跨度 |
| `.bss` 独立匿名映射 | `0x32000`（`0x318F8` 页上取整） |
| `.dynsym` 已定义符号 | 883 |
| 原版 `dynamicSymbols` 返回 | 86 = muggle name 区分大小写含 9 关键字之一 |

`dynamicSymbols` 的 9 个关键字（原版 `.data.rel.ro` 里的字符串表）：
`MSF` `Msf` `SSO` `Session` `Wrapper` `Kernel` `NodeI`
`CreateNTSessionShell` `CreateGProSessionShell`
（`Session` 是隐藏的第 9 项，缺它只剩 82；区分大小写，改成不区分会多 11 个
`_Rb_tree_node`/`_Hash_node` 误命中）
