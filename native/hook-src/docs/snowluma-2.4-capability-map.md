# 旧版 2.4.0 的真实能力地图（从生产容器取）

## 为什么写这份文档

此前所有逆向都基于 `/home/ubuntu/x64run/native/snowluma-linux-x64.so`（**425,216 字节，
2.4.2**）。但生产容器 `snowluma-hz` 实际跑的是
`/app/runtime/native/snowluma-linux-arm64.so`（**335,040 字节，2.4.0**）。

**两者不是同一版本**，能力不同。这导致一个判断错误：

| 结论 | 在 2.4.2 上 | 在 2.4.0（生产）上 |
| --- | --- | --- |
| op 2 白名单 4 条命令（`hb_pc_grab` 等） | 存在（`sub_27820`） | **不存在**，字符串出现 0 次 |
| `resident reply creation` | 无 | **有** |
| `logged-in MSF service instance` | 无 | **有** |

我在 `parity-table.md` 里写"旧版从不发送任何消息、op 2 白名单是空操作"，
**那个结论只对 2.4.2 成立，对生产在跑的 2.4.0 不成立。** 必须按 2.4.0 重新对齐。

## 生产版本（2.4.0）的能力证据

`/app/runtime/release.json`：`version 2.4.0`，`target linux-arm64`。

### 导出的 6 个函数

```
snowluma_linux_hook_start_dynamic
snowluma_linux_hook_stop_dynamic
snowluma_linux_hook_is_loaded
snowluma_linux_hook_control_socket
snowluma_linux_hook_recv_socket
snowluma_linux_hook_backend_version
```

### 决定性的错误字符串（每条对应一条能力）

```
Linux runtime targets are not resolved yet
Linux MSF service targets are missing
logged-in MSF service instance is missing
resident reply creation:
reply socket duplication:
body view construction failed
The QQ connection changed. Please restart QQ and try again.
MSFService send features missing or ambiguous
MSFService receive anchor/TaskManager RTTI chain unresolved
MSFService SessionInit/RTTI chain unresolved
MSFCoreService send features missing or ambiguous
MSFCoreService packet-state callback/RTTI chain unresolved
MSFCoreService SessionInit/RTTI chain unresolved
MSFCoreService packet converter/native allocator unresolved
```

**这张表就是旧版的能力清单。** 每条 `... unresolved` 都是一条它**已经实现、但可能
定位失败**的能力：

| 能力 | 对应字符串 | 说明 |
| --- | --- | --- |
| 运行时目标解析 | `Linux runtime targets are not resolved yet` | 找 QQ 的模块 |
| MSF 服务解析 | `Linux MSF service targets are missing` | 找服务对象 |
| **发送**（MSFService） | `MSFService send features missing or ambiguous` | 发送入口是一组"features" |
| **接收**（MSFService） | `MSFService receive anchor/TaskManager RTTI chain unresolved` | 接收靠 RTTI 链找 anchor |
| 会话初始化 | `MSFService SessionInit/RTTI chain unresolved` | |
| **发送**（MSFCoreService） | `MSFCoreService send features missing or ambiguous` | 第二套发送路径 |
| 收包状态回调 | `MSFCoreService packet-state callback/RTTI chain unresolved` | |
| 包转换/分配器 | `MSFCoreService packet converter/native allocator unresolved` | 构造 QQ 包 |
| resident 回复 | `resident reply creation:` | 创建回复对象 |
| fd 传递 | `reply socket duplication:` | dup 一个 fd 给 helper |

## 已知的 send@plt 调用点（**都不是** QQ 发送）

2.4.0 里 `send@plt` 只有 2 处，都是自己 socket 的写循环：

- `0xf7c8`：`w3 = 0x4040`（`MSG_NOSIGNAL|MSG_DONTWAIT` 一类），带 `steady_clock` 超时
- `0x12b64`：`w3 = 0x4000`（`MSG_NOSIGNAL`），`EINTR` 重试的完整写循环

**所以 QQ 消息的发送一定是通过函数指针调用完成的**，不是本进程直接 `send`。
这与 helper 不导入任何 I/O 符号（只有 `memcpy`/`mmap`/`mprotect`/`munmap`/`close`）吻合：
helper 是被动的，真正的 I/O 发生在 QQ 自己的代码里。

## 已解开的 helper（来自生产进程内存）

`.rodata` 尾部加密 ELF，运行期 `memfd_create` + `dlopen("/proc/self/fd/N")`，
在 QQ 地址空间显示为 `/memfd:nnp-resident-dispatch (deleted)`。
**直接从 `/proc/79/fd/118` dump 出来了**，14608 字节，`ET_EXEC`，aarch64，
SONAME `libsnowluma_linux_resident_dispatch.so`。

唯一导出 `nnp_resident_dispatch` @ `0xd04`，三条指令：

```
d04:  adrp x0, 0x12000
d08:  add  x0, x0, #0xd60
d0c:  ret
```

即 `return 0x12d60` —— **返回一张静态函数表**。表在 `.data.rel.ro`（文件偏移 `0x2d60`）：

```
0x12d60: 0x38       表大小 56 字节（= 7 个 qword，与主 .so 的 cmp [rbx],0x38 吻合）
0x12d68: 0xd10      槽 +0x08
0x12d70: 0xdf8      槽 +0x10
0x12d78: 0xecc      槽 +0x18
0x12d80: 0xf7c      槽 +0x20
0x12d88: 0x101c     槽 +0x28
0x12d90: 0x1040     槽 +0x30
```

`.rela.dyn` 里 12 条 `R_AARCH64_RELATIVE` 印证了这些 addend，
另有 `0x1154`/`0x1234`/`0x12fc`/`0x13dc` 是表外的独立函数。

### ★ helper 的真相：它是记账外壳，不是传输层

`.text`（0xbac–0x18d0，约 3.2KB）已 **100% 读完**，结论是颠覆性的：

| 我的假设 | 实际 |
| --- | --- |
| `nnp_resident_dispatch` 做 mmap+memcpy+mprotect | 只有 3 条指令，`return 0x12d60`（返回静态表） |
| `+0x30` 是主发送入口 | 它返回 `{manager, invoker}` 一对；`invoker` 内部 `blr` 调用**主 .so 传入的回调** |
| `__getauxval` 可能参与解密 | 读 `AT_HWCAP` bit8 = **LSE 原子指令检测**（`-moutline-atomics` 运行时派发） |
| helper 里有协议编解码 | **完全没有**。`.rodata` 只有 16 字节，就是引用计数初值 |

导入表里**没有** `write`/`send`/`sendmsg`/`recv`/`socket`/`connect`/`ioctl`/`open`/`read`/`dlsym`，
唯一的 fd 操作是 `close`。**结构上不可能发包。**

### 7 + 4 个指针的真实语义

两张表都在 `.data.rel.ro`（0x58 = 0x38 + 0x20，正好两张）：

```
第一张（有表头 0x38）：0x12d68=0xd10 0x12d70=0xdf8 0x12d78=0xecc
                      0x12d80=0xf7c 0x12d88=0x101c 0x12d90=0x1040
第二张（无表头，4 项）：0x1154 0x1234 0x12fc 0x13dc  ← 4 个 trampoline
```

| 槽 | 函数 | 语义 |
| --- | --- | --- |
| +0x08 | `0xd10` | 在 4 个 slot 里登记 `{state, A, B}`（步长 0x18），返回第二张表对应 trampoline |
| +0x10 | `0xdf8` | **mmap(NULL, n*8, RW) → memcpy → mprotect(PROT_READ)**，返回 `base+0x10`。只读内存快照，**不是代码注入** |
| +0x18 | `0xecc` | 关停：给 4 个 state 和链表节点 OR 上 bit63；in-flight==0 的才 `close(fd)` |
| +0x20 | `0xf7c` | 心跳：返回**在途请求总数**（非 0 = 有活） |
| +0x28 | `0x101c` | 把 0x28 字节缓冲初始化成**空 `std::function`**（三件套布局） |
| +0x30 | `0x1040` | 分配 0x30 节点 → 头插链表 `0x13138` → 出参写 `{node, manager=0x1508, invoker=0x168c}` |
| — | `0x1508` | manager：op0=move / op1=copy(ref++) / op2,3=destroy（引用归零才摘链+close+delete） |
| — | `0x168c` | invoker：`blr *(node+0x18)` = 调**调用方传入的回调**，前后做 in-flight ++/-- |
| 4× | `0x1154`/`0x1234`/`0x12fc`/`0x13dc` | trampoline：bit63 置位则尾跳 `*(slot+0x08)=A`（不计数）；否则 CAS in-flight++ → `blr *(slot+0x10)=B` → 减一 |

**`A`、`B` 都来自调用方 `x1`/`x2`，helper 自己没有任何实现。**

### 这意味着什么

**真正的消息收发在主 .so 传给 helper 的回调里，不在 helper 里。**
helper 只负责：登记、计数、引用管理、关停。

所以「旧版怎么收发消息」的答案必须回到**主 .so 2.4.0** 去找：

- 谁调用 `+0x08` 登记回调？登记的 A/B 指向哪个函数？
- 那个函数里是不是 `blr` 到从 QQ 解析出来的 `MSFService send features`？

**helper 是一条死胡同。** 我在它身上花的时间买到的是一条重要结论：
*不要指望这里藏着协议实现，它只是一层簿记。*

### 关于 ET_DYN vs ET_EXEC

先前记作 `ET_EXEC` 是读错了：`readelf -h` 显示 `DYN (Shared object file)`。
这也解释了为什么它靠 `R_AARCH64_RELATIVE` 重定位、且 `.init_array` 里有 LSE 派发初始化。

### `.comment`：GCC 12.3.0 + clang 14.0.0 混编

说明这个 helper 不是单次编译的产物，可能由两部分目标文件链接而成
（LSE 派发那七个原子封装像是 GCC 的 `libatomic` outline 风格，其余像 clang）。

## 下一步必须做的

1. 读完 helper 的 `.text`（仅 3KB），搞清 7 个槽 + 4 个表外函数
2. 搞清 `0x1508` / `0x168c` 两个回调做什么（最可能是真正的 I/O）
3. 在 2.4.0 主 .so 里找 **RTTI 链解析**代码：`MSFService receive anchor` 那条链怎么走的
4. 找到「把请求交给 QQ」的间接调用点（`blr` 到从 QQ 解析出来的函数指针）
5. **不要再拿 2.4.2 当对齐目标**——它是更新的版本，且白名单那套是它自己的历史包袱
