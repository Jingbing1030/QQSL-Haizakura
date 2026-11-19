# 闭源载荷 `snowluma-linux-x64.so` 的 vtable hook 与进程侦察机制（x86-64 逆向）

> 目标：`/home/ubuntu/x64run/native/snowluma-linux-x64.so`
> 425,216 字节，ELF64 x86-64 共享库，**已 strip**（`.dynsym` 只剩 158 个动态符号）
> 方法：`objdump -d -M intel` + `readelf` + Python 直接解 `.data.rel.ro` / `.rodata`。
> 无 gdb / radare2 / Ghidra，全部结论来自静态反汇编。
> 口径：**【确认】** = 反汇编里直接看到；**【推断】** = 结构相似或邻近性推出；**【推测】** = 定不出来。

---

## 0. 结论摘要（先看这段）

| 问题 | 结论 | 证据等级 |
|---|---|---|
| `start_dynamic` 起几个线程 | **固定 4 个**：1 个管道写线程（`0x10800`）+ 2 个管道 client worker（`0xf5d0`，各由 `0x1d6c0` 包一层 `_State_impl`）+ 1 个 hook 安装/守护线程（`0xfcd0`）。**另有不定数量**的 collector worker（`0x11090`）由 client worker 按需 `pthread_create`，存 `vector<pthread_t>`@`0x68b68` | 【确认】 |
| 第三个线程有无条件 | 有。`[0x68c10]`（= `start_dynamic` 的 arg2）为 0 时**不**创建 → fork 出来的子进程不装 hook | 【确认】 |
| 写内存怎么写的 | **在进程内直接写**：`mprotect` 加 `PROT_WRITE` → `lock cmpxchg` 原子换槽 → `mprotect` 还原。**完全没有** `process_vm_writev`，也没有 `ptrace` | 【确认】 |
| 写哪块内存 | 目标模块 `.data.rel.ro` 里的 **RELRO 只读页**（`r--p`），页级 `mprotect` | 【确认】 |
| 槽地址怎么算 | `slot = [ctx+0x68] + [ctx+0x70] * 8`（vtable 基址 + 槽号×8），写前校验 8 字节对齐、落在 `r--p` 映射内、映射名匹配目标模块 | 【确认】 |
| `.data.rel.ro` 里有目标 vtable 吗 | **没有**。只有本库自己的 `std::thread` vtable/RTTI + 两张 `{len, ptr}` 名字表 | 【确认】 |
| 目标怎么定位 | 运行时：`/proc/self/maps` 找模块 → 解析目标模块 ELF → `__cxa_demangle` 拿真实类名 → **按名字表子串匹配** `MSF/Msf/SSO/Session/Wrapper/Kernel/NodeI/...` → 多级 RTTI 链走到具体 vtable 槽 | 【确认】+【推断】 |
| hook 的类与槽 | `nt::MSFService` 发包槽（aarch64 版 `docs/vtable-slots.md` 定位为**主表槽 36 = `this+0x120`**）；本载荷把槽号存成数据字段，不硬编码 | 【推断】 |
| hook 的新值哪来的 | 槽里换成「嵌入式 helper 模块」返回的函数指针；helper 本身是 `.rodata` 里 **0x3960 字节的加密 ELF**，运行期 `memfd_create` + `dlopen("/proc/self/fd/N")` + `dlsym` 拉起来 | 【确认】 |
| `fork`+`prctl`+`getppid` 干什么 | 孤儿守护 / 自杀开关，**不是**提权、**不是**注入。fork 出的子进程走 `start_dynamic(pid, 0)`（不装 hook），只做监控与清理 | 【确认】 |

一句话版本：

> 载荷自己就住在 QQ 里，所以 hook 就是「改自己的内存」——
> 先 `mprotect` 把自己模块的 RELRO 页放开写，再 `lock cmpxchg` 把 vtable 槽换成自己的函数，
> 最后把权限改回去。跨进程那一套（`process_vm_readv`）只用来**读**，而且读的是自己。

---

## 1. `start_dynamic`（`0xe1d0`）的完整控制流

### 1.1 导出桩 → 真身

```
e170  snowluma_linux_hook_is_loaded         mov al,[0x68c08]; and eax,1; ret
e180  snowluma_linux_hook_start_dynamic     push rax; call getpid; mov edi,eax
                                            mov esi,1; call 0xe1d0
e1a0  snowluma_linux_hook_stop_dynamic      call 0xd620; mov eax,1; ret
e1b0  snowluma_linux_hook_control_socket    mov rax,[0x684c8]; ret
e1c0  snowluma_linux_hook_recv_socket       mov rax,[0x684e8]; ret
```

`0xe180` 把 `getpid()` 当**第一个参数**传下去，`arg2 = 1`。这一点是整篇的钥匙：

**【确认】载荷不跨进程操作 —— 它把自己当目标。** 后面所有 `process_vm_readv`
的第一个参数都是 `getpid()`，读的是自己的地址空间。

### 1.2 状态机骨架（`0xe1d0` ~ `0xe24d`）

```
e1d0  push rbp / push rbx / sub rsp,0x58
e1d6  ebp = esi (arg2)        ; 1 = 主进程模式，0 = fork 子进程模式
e1d8  ebx = edi (arg1 pid)
e1da  pthread_mutex_lock(&0x68c60)                    ; 全局大锁
e1ee  cmp BYTE [0x68c0a],0                            ; 是否已注册 atexit
e1f7    lea rdi,[0xd620]                              ;   停机的函数指针
e1fe    call 0x56540                                  ;   __cxa_atexit(0xd620, 0, &0x68440)
e20b    [0x68c0a] = 1
e212  mov al,1; xchg BYTE [0x68c08],al                ; 原子置 is_loaded 的 bit0
e21a  test al,1; jne 0xe845                           ; 已经加载过 → 直接返回
e222  lock xadd QWORD [0x68c88],1; +1                  ; 会话代号（generation）自增
e234  [rsp+0x30] = generation
e239  [0x68c09] = 0                                   ; stop 请求标志
e240  [0x68c0c] = ebx                                 ; 记下 pid
e246  [0x68c10] = bpl                                 ; 记下 arg2（要不要装 hook）
e24d  [0x68c11] = 0
```

`0x56540` 就是一段 `endbr64; mov rdx,[0x68440]; xor esi,esi; jmp __cxa_atexit@plt`
—— 注册 `0xd620` 做退出清理。**即使宿主进程直接 `exit()`，hook 也会被还原。**

随后是一大段「把上一次会话的全部状态清零」：`0x68448/0x68450/0x68458…
0x68cb8/0x68cc0/0x68cc8/0x68cd0/0x68d00/0x68d20/0x68d28/0x68d38/0x68c12/
0x68c18/0x68c20/0x68c28/0x68c29/0x68d40/0x68d48/0x68d50`，每个都配一把
`pthread_mutex_lock/unlock`（`0x68c90`、`0x68cd8`、`0x68d58`、`0x68d80`）。
**【推断】** 这是为「重复 start_dynamic（QQ 重连/重载 wrapper.node）」做幂等准备。

### 1.3 线程模型（固定 4 个，另有按需创建的 collector）

`0xe1d0` 里只有 **1 处 `pthread_create`**（`0xd49c`，在构造函数路径里，见 §3），
`start_dynamic` 自己用的是 `std::thread`，创建点如下。

#### ① 管道写线程 —— `0x10800`，名字 `"snowluma-pipe-w"`【确认】

```
e63d  edi = 0x10;        call _Znwm                    ; new 0x10 字节
e647  rcx = 0x67b20+0x10                                ; std::thread::_State vtable
e655  rcx = 0x10800                                    ; 线程体
e660  [rsp+0x8] = 堆对象
e671  call _ZNSt6thread15_M_start_threadE...           ; std::thread 启动
e686  cmp QWORD [0x68c00],0; jne 0xe85f                ; 已存在 → std::terminate
e699  [0x68c00] = 线程对象                              ; 保存，供 0xd620 join
```

线程体 `0x10800` 开头：

```
1080e  call pthread_self
10813  lea rsi,[0x5710a]        ; "snowluma-pipe-w"
1081d  call pthread_setname_np
10822  r15 = 0x68db0 (mutex) / r12 = 0x68b80 (condvar)
10869  loop: pthread_mutex_lock(&0x68db0)
1088f        steady_clock::now() + 0x1dcd6500 ns（500ms）→ 定时等待
```

**【确认】** 这是「把 QQ 侧事件写回 SnowLuma」的管道写线程，500ms 超时轮询 + 条件变量唤醒。

#### ②③ 两个管道 client worker —— `0xf5d0`，由 `0x1d6c0` 封装【确认】

```
e6a0  cmp DWORD [0x68470],0 ; js 0xe6f1        ; control fd < 0 → 跳过
e6ae  rsi = 0xf5d0                              ; 线程体
e6b5  rdx = &0x68470                            ; fd
e6bc  r8  = 0x684c8                             ; socket 路径字符串
e6c8  rcx = &[rsp+0x28]                         ; 0（arg2 占位）
e6cd  r9  = &[rsp+0x30]                         ; generation
e6d2  call 0x1d6c0                              ; 造 _State_impl 并 start_thread
e6e5  [0x684b0] = 线程对象

e6f1  cmp DWORD [0x68474],0 ; js 0xe742        ; recv fd < 0 → 跳过
e6fa  [rsp+0x28] = 1                            ; arg2 = 1（recv 侧）
e6ff  rsi = 0xf5d0
e706  rdx = &0x68474
e70d  r8  = 0x684e8
e723  call 0x1d6c0
e73b  [0x684b8] = 线程对象
```

`0x1d6c0(rdi=out, rsi=fn, rdx=&fd, rcx=&flag, r8=&path, r9=&generation)` 干的事很干净：

```
1d6e9  edi = 0x40; call _Znwm                   ; _State 对象 0x40 字节
1d6f6  vtable = 0x67c28+0x10
1d704  [obj+0x08] = *r9                         ; generation
1d70b  [obj+0x10] = obj+0x20                    ; std::string（socket 路径）
1d790  [obj+0x30] = *rcx                        ; flag
1d796  [obj+0x34] = *rdx                        ; fd
1d79d  [obj+0x38] = r13 (=rsi)                  ; 线程体指针
1d7b0  call _ZNSt6thread15_M_start_threadE...
```

路径字符串的构造在 `0xe3f3`–`0xe5f2`，可完整读出【确认】：

```
e3f3  call 0xe8f0(&[rsp+0x38])         ; 解析运行时目录（读 env → 兜底）
e3fd  rdi = 目录串; esi = 0x1c0 (0700)
e407  call mkdir                        ; ★ 目录由载荷自己创建
e410  __errno_location; errno==0x11(EEXIST) 视为成功，否则 → 0xe823（失败退出）
e41e  call 0xeca0(&[rsp+8], "control")  ; ★ 拼 <runtimeDir>/mojo.<pid>.control.sock
e42f  [0x684c8] = 结果（std::string 赋值，含 SSO→堆 的搬迁分支）
e507  call 0xeca0(&[rsp+8], "recv")     ; ★ 独立拼 <runtimeDir>/mojo.<pid>.recv.sock
e518  [0x684e8] = 结果
e5f2  call 0xf4f0(&0x684c8)             ; 监听 control → fd 存 [0x68470]
e604  call 0xf4f0(&0x684e8)             ; 监听 recv   → fd 存 [0x68474]
```

`0xe8f0` 只做「`getenv(名字)` → `strlen` → 拼路径」三件事（`0xe91a` `getenv`、
`0xe94a` `strlen`、`0xe967` `_M_createERmm`），名字是加密串（`0x57bd9`）。
两条 socket 路径是**各自独立推导**的，不是「control 加后缀」——
这正是 `docs/socket-naming.md` 里记录的第二个坑，闭源载荷的实现是对的。

线程体 `0xf5d0` 的结构：

```
f5e2  test BYTE [0x68c09],1 ; jne 0xfbf1       ; 已请求停止 → 退出
f63e  cmp [0x68c88],r14 ; jne 0xfbf1           ; generation 变了 → 退出
f64e     pthread_mutex_lock(&0x68dd8)          ; 每个 fd 一把锁
        取队列里的任务 → 发出去 → 解锁
```

**【确认】** 每代 hook 会话各有 2 个 worker，`generation` 一换就自杀 ——
这就是「QQ 重载 wrapper.node 后旧 worker 自动退出」的实现方式。

#### ④ hook 安装/守护线程 —— `0xfcd0`【确认】

```
e742  cmp BYTE [0x68c10],0 ; je 0xe831         ; ★ arg2==0（fork 子进程）→ 不起这个线程
e758  edi = 0x20; call _Znwm                   ; new 0x20 字节
e762  rcx = 0x67c68+0x10                       ; _State vtable
e770  [rax+0x08] = generation
e779  [rax+0x10] = ebx                          ; pid
e77c  rcx = 0xfcd0
e783  [rax+0x18] = 0xfcd0
e798  call _ZNSt6thread15_M_start_threadE...
e7b5  cmp QWORD [0x684c0],0; jne 0xe85f
e7c0  [0x684c0] = 线程对象
```

线程体 `0xfcd0`（`sub rsp,0x6d8`，0x6d8 字节栈帧 —— 里面装的是整个「解析结果」结构）：

```
fcf2  test BYTE [0x68c09],1 ; jne 0x106b3      ; 停止 → 退出
fd20  cmp [0x68c88],[rsp+0x40] ; jne 0x106b3   ; generation 变了 → 退出
fd3d  cmp r15d,0x77 ; ja 0x106d2                ; 轮次上限 0x77 = 119
...
ff80  大量 [rsp+0x1xx] != 0 的链式检查          ; ← RTTI 链是否解析齐（见 §5）
100fc call 0x1f4e0(self=结构, r12)              ; 解析 / 校验
10112 call 0x16430(...)  → ebp                  ; ★ 安装/更新 vtable 槽（见 §4）
10221 call 0x16bf0(...)  → al                   ; 还原（restore）
10238 call 0x1b8a0(ctx, sil, dl)                ; ★ 安装判定/去重（见 §4）
102cb call 0x1b8a0(...)                         ; 第二个（recv 侧）
103fe call 0x17130(...)                         ; 第三处安装入口
105ae call 0x16bf0(...)                         ; 还原
1060b call 0x17130(...)                         ; 安装
```

**【确认】`0xfcd0` 就是「侦察 + 装 hook + 校验」的主循环**，
每轮用 generation 判活，最多 119 轮。

### 1.3.1 停机路径印证了这 4 个线程【确认】

`0xd620`（`stop_dynamic` → `__cxa_atexit` 注册的清理函数）把每个线程都收了：

```
d635  pthread_mutex_lock(&0x68c60)
d64a  xchg BYTE [0x68c08],0            ; 清 is_loaded
d652  [0x68c09] = 1                    ; 置 stop 请求
      lock add QWORD [0x68c88],1       ; ★ generation 自增 → 所有 worker 本轮自然退出
d671  shutdown(fd=0x68470, 2); close; fd = -1
d69a  shutdown(fd=0x68474, 2); close; fd = -1
d6bb  pthread_mutex_lock(&0x68e08)     ; 遍历 [0x68b10..0x68b18] 的 fd 向量
d6fd  shutdown / d73d shutdown / close 各一个，逐元素 [rax+5]=0
d750  rbp = [0x684b0]; [0x684b0] = 0   ; ★ 线程 ①
d767  rbx = [0x684b8]; [0x684b8] = 0   ; ★ 线程 ②
d77e  rax = [0x684c0]; [0x684c0] = 0   ; ★ 线程 ③
d79b  pthread_mutex_unlock
d7ac  call _ZNSt6thread4joinEv         ; ★ join ①（0x684b0 = control worker）
d7c2  call _ZNSt6thread4joinEv         ; ★ join ②（0x684b8 = recv worker）
d7d3  call _ZNSt6thread4joinEv         ; ★ join ③（0x684c0 = hook 线程）
d7df  pthread_mutex_lock(&0x68dd8)
d7ec  r12/r14 = [0x68b68] / [0x68b70]  ; ★ 一个 vector<pthread_t>（collector worker 池）
d816  pthread_mutex_unlock
d830  loop: pthread_join([rbx], 0)     ; ★ 逐个 join，长度 0..N，不是固定 1 个
d835       （循环体，退出条件是 rbx == r14）
d855  free(vector)
d878  call condition_variable::notify_all
d87d  cmp QWORD [0x68c00],0
d890  call _ZNSt6thread4joinEv         ; ★ join ④（pipe-writer，0x68c00）
d902  call 0x1bcd0                     ; 收尾（还原登记表）
d9c4  mprotect / d9e8 mprotect        ; ★ 最后把剩余 patch 回滚
```

**`start_dynamic` 直接起的是 4 个 `std::thread`（对象分别在 `0x684b0`、`0x684b8`、
`0x684c0`、`0x68c00`），停机时这 4 个逐个 `join`。
`0xd835` 那个 `pthread_join` 是另一个东西**：它遍历 `vector<pthread_t>`
（`0x68b68`/`0x68b70`/`0x68b78`），长度是运行期累积的 —— 对应 `.rodata` 里
`"reap client worker"`（`0x5711a`）与 `"join client worker"`（`0x57b80`）这对名字，
即**按需创建的 collector 工作线程池**（每个 client 连接一个）。**【推断】** 这部分线程数量不定，
不计入「`start_dynamic` 起几个线程」。

`0xd87d` 那条 `0x68c00` 就是 §1.3 ① 里 `0xe699` 写入的 pipe-writer 对象 ——
**两个不同文件偏移互相印证了「`0x68c00` = pipe-writer」这个判断。**

### 1.3.2 第 5 类线程：按需创建的 collector worker（`0x11090`）【确认】

`0xf5d0` 的 client worker 在需要时**自己再起一个 `pthread`**：

```
faea  [0x68b68] = r15                    ; vector.begin
faf1  [0x68b70] = rbp                    ; vector.end（已 +8，即已 push 一个槽）
faf8  [0x68b78] = r15 + rbx*8            ; vector.capacity
fb12  lock add DWORD [0x68e00],1         ; 活线程计数
fb1a  rdi = [0x68b70] - 8                ; ★ 取刚 push 进去的那个槽
fb2c  rdx = 0x11090                      ; ★ 线程体
fb33  call pthread_create
fb38  失败 → lock sub [0x68e00],1; [0x68b70] -= 8（回滚 push）
     成功 → 0xfbc0 unlock
```

线程体 `0x11090`（`sub rsp,0x588`）的循环头是同一套判活：

```
110a8  rax = *r13（ctx）
110b5  test BYTE [0x68c09],1  ; jne 0x13374   ; stop → 退出
110c3  cmp [0x68c88], r12                     ; generation 变了 → 退出
```

**【确认】线程总数不是固定的 4：** `start_dynamic` 固定起 4 个，
而 client worker（`0xf5d0`）每处理一路 client 就 `pthread_create` 一个 `0x11090`，
存进 `vector<pthread_t>`（`0x68b68`），停机时 `0xd830` 循环 `pthread_join` 全部收掉。
`0x68e00` 是这些线程的活计数（`fb12` 加、`fb40` 减）。
`.rodata` 的 `"reap client worker"`（`0x5711a`，xref `0xfc12`）就出现在这个
`pthread_create` 失败时构造的 `std::system_error` 里 —— 名字与行为完全对得上。

另外 `[0x68c09]=1` + `generation++` 的组合说明：**停机不是「杀线程」，而是「置标志 + 换代」，
让每个 worker 在自己的循环头看到就退出**（`0xf5e2`、`0xfcf2` 那两行）。
这是无强制取消（无 `pthread_cancel`）的优雅停机，也解释了为什么 `0xfcd0` 需要 generation 判活。

### 1.4 线程全景图

```
                    snowluma_linux_hook_start_dynamic (0xe180)
                                  │ getpid(), 1
                                  ▼
                          start_dynamic (0xe1d0)
                                  │
        ┌─────────────────────────┼──────────────────────────┐
        │                         │                          │
        ▼                         ▼                          ▼
 0x10800 pipe-writer      0xf5d0 worker ×2             0xfcd0 hook-thread
 "snowluma-pipe-w"     (control fd 0x68470,         (generation 判活,
  500ms 轮询回写         recv fd 0x68474)            最多 119 轮)
   [0x68c00]                 [0x684b0/0x684b8]           [0x684c0]
        │                         │                          │
        │                    ┌────┴─────┐        ┌───────────┼────────────┐
        │                    ▼          ▼        ▼           ▼            ▼
        │              0x11090 ×N   0x16bf0  0x16430     0x1b8a0      0x17130
        │           (按需 collector)  (还原)   (安装)    (判定/去重)  (另一路安装)
        │                    │                     │           │            │
        │             vector<pthread_t>            └───────────┴────────────┘
        │                @0x68b68                               │
        │              [0x68e00] 活计数                           ▼
        │                                          0x18f70 mprotect+cmpxchg+还原
        └──────── stop: 0x68c09=1 & generation++ → 所有 worker 自行退出
                 0xd620: join ×4 + 循环 join vector + mprotect 回滚
```

**固定 4 个 + 不定数量（collector）**，全部靠 `[0x68c09]`（stop）与
`[0x68c88]`（generation）两个变量统一收束，无 `pthread_cancel`。

---

## 2. 导入了什么、没导入什么（这决定了整个机制）

`readelf -d` / `.dynsym` 确认的关键导入，以及 PLT 地址：

| 功能 | PLT | 调用点数 | 用在哪 |
|---|---|---|---|
| `mprotect` | `0x4730` | **5** | `0xd9c4`、`0xd9e8`、`0xda3d`、`0x18fb1`、`0x18fee` |
| `process_vm_readv` | `0x45e0` | 20+ | 全用于**读**，pid 一律 `getpid()` |
| `fork` | `0x40b0` | **1** | `0xd567` |
| `prctl` | `0x4590` | **1** | `0xd57c` |
| `getppid` | `0x4670` | 2 | `0xd581`、`0xd5c8` |
| `dlopen` | `0x4640` | **1** | `0x51403`（`"/proc/self/fd/N"`，mode=2） |
| `dlsym` | `0x4400` | **1** | `0x5149d` |
| `__cxa_demangle` | `0x4390` | 1 | `0x3b66f` |
| `open` | `0x4330` | 2 | `0x49ac`（`/proc/<pid>/mem`，`O_RDONLY`）、`0x4b359` |
| `pread` | `0x4540` | 2 | `0x4a0c`、`0x4c72f` |
| `syscall` | `0x4040` | **1** | `0x50d05`，`syscall(0x13f, name, 1)` = **`memfd_create`** |
| `write` | `0x4150` | 1 | `0x50f87`（往 memfd 里灌解出来的 ELF） |
| `mkdir` | `0x41b0` | 1 | `0xe407`（建 socket 目录，mode `0x1c0`=0700） |
| `unlink` | `0x41c0` | 2 | `0xe808` `0xe81e`（停机时删 socket 文件） |
| `opendir`/`readdir` | `0x46c0`/`0x4700` | — | `/proc` 枚举 |

统计口径：`grep -c ptrace` 在 87,923 行反汇编与 4,549 行字符串里**均为 0**；
`process_vm_writev` 出现 **0** 次。

**没有 `process_vm_writev`，没有 `ptrace`，没有 `ptrace` 相关的 `PTRACE_*` 常量。**

**【确认】「写」这条路从来不需要跨进程。** 只有 `pread` 那一路才是跨进程读
（§6 的 `/proc/<pid>/mem` 兜底）。

---

## 3. `.data.rel.ro` 里到底有什么（决定性否定结论）

`readelf -S`：`.data.rel.ro` @ `0x67b20`（file `0x66b20`）size `0x268`。
按 8 字节逐个 dump 并回填字符串后，内容只有两类：

### 3.1 本库自己的 `std::thread` 机器（`0x67b20`–`0x67ca0`）

```
0x67b30  0x67b48                      ; vtable：offset-to-top=0
0x67b38  0x1ef90   0x1efb0            ;   ~_State_impl / _M_run
0x67b50  0x57dd9 "NSt6thread11_State_implINS_8_InvokerISt5tupl..."   ; type_info 名
0x67b70  0x25240   0x11010 0x11020 0x11040 0x11050                   ; 另一张表
0x67ba0  0x57c1b "St23_Sp_counted_ptr_inplaceIN12_GLOBAL__N_1..."
0x67bb8  0x57e48 "St11_Mutex_baseILN9__gnu_cxx12_Lock_policyE2..."
0x67be0  0x25240 0x25250 0x25260 0x25270 0x25280
0x67c18  0x57f79 "St23_Sp_counted_ptr_inplaceIKN7nnphook13linux_backend14RuntimeTargetsESaIv..."
0x67c38  0x292d0 0x29300 0x29340
0x67c58  0x58127 "NSt6thread11_State_implINS_8_InvokerISt5tupl..."
0x67c80  0x29410 0x29430
0x67c98  0x5819e "NSt6thread11_State_implINS_8_InvokerISt5tupl..."
```

`0x57f79` 的完整 demangle 是
`std::_Sp_counted_ptr_inplace<nnphook::linux_backend::RuntimeTargets const, std::allocator<void>, ...>`，
**这就是载荷内部对「解析出来的目标」的命名：`nnphook::linux_backend::RuntimeTargets`。**
`start_dynamic` 里 `0xe647 → 0x67b20+0x10`、`0xe762 → 0x67c68+0x10` 用的正是这些 `_State` vtable。

### 3.2 两张 `{len, char*}` 名字表（`0x67ca8`–`0x67d80`）

```
0x67ca8  3  → 0x58e47 "MSF"                  0x67d18 20 → 0x58e70 "CreateNTSessionShell"
0x67cb8  3  → 0x58e4b "Msf"                  0x67d28 22 → 0x58e85 "CreateGProSessionShell"
0x67cc8  3  → 0x58e4f "SSO"                  0x67d40 → "qq"
0x67cd8  7  → 0x58e53 "Session"              0x67d48 → "linuxqq"
0x67ce8  7  → 0x58e5b "Wrapper"              0x67d50 → "ntqq"
0x67cf8  6  → 0x58e63 "Kernel"               0x67d60 → "app_launcher.node"
0x67d08  5  → 0x58e6a "NodeI"                0x67d68 → "ntqq" 0x67d70 "qqnt"
                                             0x67d78 → "linuxqq" 0x67d80 → "libqq"
```

### 3.3 结论

**【确认】`.data.rel.ro` 里没有任何来自 QQ / `wrapper.node` 的 vtable。**
目标 vtable 不可能静态写死在载荷里 —— 它必须运行期在目标进程里现找。
这直接回答了一个常见误判：「载荷里带着一张准备好的假 vtable，指过去就行」→ **不成立**。

---

## 4. vtable hook 的确切做法

### 4.1 五个 `mprotect`，两处 `cmpxchg`【确认】

`0x18f70(expected, new)` 是**唯一的写入口**（由 `0x16ae9` 调用）：

```asm
18f70: push ...;  r14 = new(rsi);  r15 = expected(rdi)
18f7e: edi = 0x1e; call sysconf        ; _SC_PAGESIZE → 0x1000
18f8d: r12 = [0x68478]                 ; ★ 描述符：目标槽地址
18f94: edx = [0x68490]                 ; ★ 描述符：原始保护位
18f9a: test dl,2 ; jne 18fbe           ; 已有 PROT_WRITE → 直接写
18f9f: rbx = pagesize
18fa2: neg rax; r12 &= rax             ; 页对齐
18fa8: or  edx,2                       ; prot |= PROT_WRITE  ← 只加位，不覆盖
18fab: rdi = 页对齐地址; rsi = pagesize; 
18fb1: call mprotect                   ; ① 放开写
18fb6: test eax,eax ; jne 18fba         ; 失败 → ebp=0，返回失败
18fcf: rcx = [0x68478]
18fd6: rax = r15  (expected)
18fd9: lock cmpxchg QWORD PTR [rcx], r14   ; ② 原子写：只有等于 expected 才换成 new
18fe2: edx = [0x68490]                 ; 原始 prot
18fe8: rdi = 页对齐地址; rsi = pagesize
18fee: call mprotect                   ; ③ 恢复原权限
18ff8: [0x68494] = (恢复成功)          ; 描述符有效性
19001: return ebp = (②成功 && ③成功)
```

关键三点，和 `docs/vtable-hooking-notes.md` 里我们自己踩的坑逐条对上：

1. **必须 `mprotect`**：目标槽在 RELRO 页里（`r--p`），直接写会 `EFAULT`；
2. **权限用 `or 0x2` 而不是 `mov 3`**：保留原有 R/X 位（比我们现在的
   `mprotect(page, PROT_READ|PROT_WRITE)` 更稳，我们的写法会清掉 `PROT_EXEC`）；
3. **写完必须还原**，并置 `[0x68494]` 记录「还原过了」。

`0xd9c4`/`0xd9e8` 是同一个套路的一个更早拷贝（`0x68478` 描述符 + `or 0x2` + `cmpxchg`），
`0xda3d` 是它的还原腿，之后 `0xda4c` 用 `movups xmm0` 把 `0x68478..0x68494` 清零、`[0x68494]=1`。
`0x18fb1`/`0x18fee` 就是上面这段。**不存在第五种写法。**

### 4.2 描述符长什么样

```
0x68478  QWORD  槽地址（绝对地址，8 字节对齐）
0x68480  QWORD  expected（写之前槽里的旧函数指针）
0x68488  QWORD  new     （写进去的新函数指针）
0x68490  DWORD  原始保护位（1=PROT_READ，3=READ|WRITE）
0x68494  BYTE   有效标志（1=描述符有效 / 已还原）
```

写入者：`0x16ac1`–`0x16adc`；读取/校验者：`0x16625`、`0x16634`、`0x1664d`、
`0x186c1`、`0x186d0`、`0x18f8d`、`0x18f94`、`0xd96e`、`0xd981`、`0x16b01`。

其中 `0x1664d` 的用法最能说明字段含义：

```asm
1664a: mov rax,[rax]              ; rax = *槽地址（当前槽内容）
1664d: cmp [0x68488],rax          ; 与记录的 new 比较
16654: sete r13b                  ; → 槽里现在还是我们装的函数才算「状态正确」
```

### 4.3 槽地址怎么算出来 —— `0x1660d` ~ `0x16704`【确认】

```
16621  rbp = [ctx+0x68] + [ctx+0x70]*8        ; ★ slot = vtable_base + index*8
16625  rax = [0x68478]                        ; 已经有缓存的描述符吗
1662c    （有）→ 校验 [0x68494] && rbp==[0x68478] && [rbp]==[0x68488] → 命中
1665d  （无）→ call 0x17420 读 /proc/self/maps
16667  遍历 map 条目（stride 0x80）：
16684    entry.start <= rbp < entry.end        ; 槽必须在这个映射里
16699    call 0x18700(maps, &ctx+8, rbp)       ; 映射名必须等于 ctx+8 的模块名
166a2    [entry+0x18] == 4                     ; perms 字符串长度 4
166af    entry.perms[0] == 'r'                  ; ★
166b4    entry.perms[2] == '-'
166c0    entry.perms[3] == 'p'                  ;   → 必须落在 "r--p" 的 RELRO 页
166c8    (rbp & 7) == 0                         ; 8 字节对齐
166d7    entry.start <= rbp && rbp+7 < entry.end
166e1    call 0x18700(maps, ctx+8, [ctx+0x60])   ; 旧值也在同一模块里
166f3    r14 = [ctx+0x60]; rax = [rbp]
166fe    cmp rax,r14 ; je 0x16a0b                ; ★ 槽里现在正好是期望的旧值 → 去写
```

**这四行 `'r' '?' '-' 'p'` 是整个机制最硬的指纹：它专门找 RELRO 只读页。**
配上 `(rbp&7)==0`、8 字节读不越界、映射名必须匹配 —— 这是一个**带全量校验**的
vtable 槽写入器，不是「照着偏移瞎写」。

### 4.4 写之前还要做的三件事（`0x16a0b` – `0x16aee`）

```
16a0b  rcx = [ctx+0x60]                        ; 旧函数指针
16a1d  lock cmpxchg [0x68ee0], rcx              ; 全局「原始指针」只记一次（0→原值）
16a35  构造 std::string; call 0x50c30           ; ★ 返回 helper 模块的函数表
16a54  [0x68ee8] = rax                         ; 记下 helper 表
16a6b  call [rax+0x8](0, r14=[ctx+0x180], 0x187b0)  ; ★ 问 helper 要「替换函数」
16a76  rbx = 返回值；为 0 → 失败
16a7f  call 0x201e0(&[rsp+0x68], ctx)           ; 拷一份 ctx
16a93  call 0x20190(&0x68b58, &[rsp+0x68], 3)   ; 与全局登记表交换（shared_ptr）
16aad  rax = [r12+0x10]; rcx = 0
16ab4  cmp BYTE [rax+1], 'w'                    ; 映射是 rw- 还是 r-- ?
16abe  eax = (rcx? 2:0) + 1                     ; prot = 3 或 1
16ac1  [0x68478] = rbp                          ; 槽地址
16ac8  [0x68480] = r14                          ; expected = [ctx+0x180]
16acf  [0x68488] = rbx                          ; new = helper 给的函数
16ad6  [0x68490] = eax                          ; 原始 prot
16adc  [0x68494] = 1
16ae3  rdi = r14; rsi = rbx
16ae9  call 0x18f70                             ; ★ mprotect + cmpxchg + 还原
```

`0x16af5`–`0x16b1b` 是失败回滚：如果 `[rbp] != 原值` 且描述符有效，
就把描述符清空并置 `[0x68494]=1`。

所以「改成什么值」= `[ctx+0x180]` 换成「helper 模块返回的指针（`rbx`）」。
`expected` 是 `[ctx+0x180]`，`new` 是 `rbx`。
`0x166f7` 又拿 `[ctx+0x60]` 和槽比了一次 —— **【推测】** `ctx+0x60` 与 `ctx+0x180`
在解析阶段被填成同一个「原始函数指针」，一个用于查找校验、一个用于 cmpxchg 期望值。

### 4.5 `ctx` 是什么：`nnphook::linux_backend::RuntimeTargets`

`0x16430` / `0x1b8a0` / `0x16bf0` / `0x17130` 全部以同一个指针为 `rdi`，
字段用起来是这样（**【推断】** 由用法反推的布局）：

| 偏移 | 含义 | 证据 |
|---|---|---|
| `+0x08` | `std::string` 模块路径/名 | `0x164d6` `lea r13,[r15+8]`；`0x18700` 拿 `[rsi]`/`[rsi+8]` 做 `bcmp` |
| `+0x10` | 解析上下文指针（非 0 才继续） | `0x164cb` |
| `+0x60` | **原始**函数指针（槽里应然的值） | `0x166e1` `0x166f3` `0x16a0b` |
| `+0x68` | **vtable 基址** | `0x16621` |
| `+0x70` | **槽号 index** | `0x16621` |
| `+0x78` `+0x80` `+0x88` | 目标对象/其它槽链 | `0x1a850`–`0x1a884` |
| `+0xa0` | 「取 key」的可调用槽（`call rax` 后填 `[rsp]`） | `0x164ab` `0x1b8b0` `0x1adc8` `0x16c55` |
| `+0xd0`…`+0xd8` | 已装 hook 的地址向量（8 字节步长） | `0x1b8ea` `0x1ae0a` |
| `+0x110` | 另一个链的头 | `0x1649d` |
| `+0x180` | **替换后的目标**（helpers 的输入 / cmpxchg 的 expected） | `0x16950` `0x16ac8` |
| `+0x188` | 与之配对的第二个指针 | `0x16957` |
| `+0x1c8`…`+0x1d0` | 第二组「已装地址」向量 | `0x1b91e` `0x164f4` |

`0x1b8a0(ctx, sil, dl)`（安装判定/去重）的逻辑可以完整读出【确认】：

```
1b8b0  rax = [ctx+0xa0]
1b8b7  为 0 → 走 1ba29（纯解析路径）
1b8c0  call rax（rdi=rsp）                      ; 取当前目标的 key（16 字节）
1b8dd  call 0x17ba0(key, &zeros, 0)             ; 规范化
1b8ea  在 [ctx+0xd0..0xd8] 里找 [rsp+0x18]      ; 已装过？
1b91e  在 [ctx+0x1c8..0x1d0] 里找              ; 第二组
1b97f  命中 && sil → call 0x1a840(ctx, key)     ; 取/重建已装记录
1b995  [ctx+0x180]==0 && vectors 空 → 直接成功
1b9b2  pthread_mutex_lock(&0x68cd8)
1b9c6  compare [rsp] 与 [0x68d20]; r14b = (相等 && [0x68d38])
1b9d8  unlock
```

`0x1a840`（重装/校验）：先看 `[ctx+0x78]`、`[ctx+0x80]`、`[ctx+0x88]`、`rsi` 非空，
然后 `getpid()` + `process_vm_readv` 读 8 字节 —— **又一次自读**（`0x1a8a5`–`0x1a8e0`）。

### 4.6 「哪个类、哪个槽」—— 硬证据

载荷里**没有**单个硬编码的类名或槽号；它靠 `.data.rel.ro` 那张名字表（§3.2）+ 运行时 RTTI：

```
3b66f  call __cxa_demangle                      ; 把 _Z... 名字还原成可读类名
3b772  call free
3b777  test BYTE [0x69158],1 ; je 3bcd6         ; static 初始化（__cxa_guard_acquire）
3bcfa  call memcpy(dst, 0x67ca8, 0x90)          ; ★ 把 0x90 = 144 字节名字表拷成局部 set
3bd15  call 0x2c370(&0x69140, &set, 9)          ; 建索引/哈希
3bd37  call __cxa_atexit(0x40ca0, &0x69140, &0x68440)
3b785  rax = [0x69140]; rcx = [0x69148]         ; 遍历 9 个条目（stride 0x10）
3b823  cmp rbx,[rsp+0x38] ; ja 跳过             ; 只比对长度 ≤ demangle 结果的
3b84e  call memchr(demangled, 条目首字节, ...)   ; 先找首字符
3b864  call bcmp(demangled+pos, 条目串, len)     ; ★ 子串比较（不是全等！）
3b7ee  命中 → r14 -= base; cmp r14,-1; jne 3b957 ; 记录命中位置
```

**【确认】判定不是「类名 == "MSFService"」，而是「demangle 后的 RTTI 名里包含
`MSF` / `Msf` / `SSO` / `Session` / `Wrapper` / `Kernel` / `NodeI` /
`CreateNTSessionShell` / `CreateGProSessionShell` 之一」**，然后 `3b957` 继续
按位置/结构往下走（`3bd79` 又用 `0x58eaa`、`0x58ec0` 两张表继续筛）。

槽号的来源则在解析阶段填进 `ctx+0x68`/`ctx+0x70`，从错误串阶梯可以还原出解析顺序
（`0x70c0`–`0x7277`，每条失败串都是 `[rsp+0xNNN]==0` 的分支）：

| 失败串 | 地址 | 触发条件（rsp 偏移） |
|---|---|---|
| `"runtime service structures could not be read or resolved"` | `0x5826b` | `[rsp+0x198] | [rsp+0x290]` 全 0 |
| `"MSFService send features missing or ambiguous"` | `0x582a4` | `[0x198]!=0 && [0x1f8]==0` |
| `"MSFService receive anchor/TaskManager RTTI chain unresolved"` | `0x582d2` | `[0x198]!=0 && [0x150]==0` |
| `"NG session/receive ownership path unresolved"` | `0x5830e` | `[0x160]/[0x168]/[0x170]` 有 0 |
| `"MSFService SessionInit/RTTI chain unresolved"` | `0x5833b` | `[0x2b0]!=[0x2b8] && [0x268]==0` |
| `"MSFCoreService send features missing or ambiguous"` | `0x58368` | `[0x290]!=0 && [0x2e0]==0` |
| `"MSFCoreService packet-state callback/RTTI chain unresolved"` | `0x5839a` | `[0x350]==0` |
| `"MSFCoreService SessionInit/RTTI chain unresolved"` | `0x583d5` | `[0x360]==0` |
| `"MSFCoreService packet converter/native allocator unresolved"` | `0x58406` | `[0x370]/[0x378]` 有 0 |
| `"MSF live selector feature/RTTI chain missing or ambiguous"` | `0x58442` | `[0x198]!=0 && [0x188]==0` |

**这是「多阶段 RTTI 链 walk，每阶段一个具名特征」的直接证据**：
`MSFService` 的 send / receive / SessionInit 三条链，`MSFCoreService` 的
send / packet-state callback / SessionInit / converter 四条链，外加一个 live selector。
与 `docs/vtable-slots.md` 里 aarch64 的分析完全同构。

**关于「具体第几槽」：** 载荷本身不写死，槽号在 `ctx+0x70`，运行期由解析决定。
按 `docs/vtable-slots.md`（aarch64 `wrapper.node` 3.2.32）的结论，
`nt::MSFService` 的**发包槽 = 主表槽 36（`this+0x120`）**，槽 37（`this+0x128`）是无响应版；
`msfDidRecvResponseData` 在 TaskManager 表槽 5。
**【推断】** x86-64 版结构同构，槽号相同或相近 —— 但这是从「同一份 RTTI 名字表 + 同一套
错误串阶梯」推出来的，**没有在 x86-64 二进制里逐槽验过**。

另有两处旁证说明它 hook 的是**接收侧**：
`.rodata` 有 `"waiting for the selected receive session"`（`0x57b2b`，xref `0x10285`）
和 `"failed to install a resolved receive VTable"`（`0x57b54`，xref `0x1035d`），
而这两个 xref 都落在 `0xfcd0`（hook 线程）内部。

---

## 5. 嵌入式 helper 模块（这是本次最大的新发现）

`0x50c30` 不是普通函数，它做的是「**把自己的一个加密子模块跑起来**」：

```
50c41  pthread_mutex_lock(&0x69160)            ; 已被别的线程建过？
50c58  rbx = [0x69188]; 非 0 → 直接返回（缓存）
50c8f  构造 std::string，长度 0x15 = 21
50ca0  movabs rax,0x815b409f97c3e4f6 ; 写进 [rsp+8]（PRNG 种子）
50caf  rdi = 0x592c8; call 0x51ee0 / 0x52210 / 0x52530
                                       ; ★ 三段解码器：把 0x592c8/0x59341 处的密文解成字符串
50cf4  rsi = 解出的字符串(21 字节)
50cf9  edi = 0x13f (319 = memfd_create); edx = 1 (MFD_CLOEXEC)
50d05  call syscall                    ; ★ memfd_create(name, MFD_CLOEXEC)
50d21  检查返回值
50d34  rax = 0x5ccf0; r14 = [0x5ccf0]  ; ★ = 0x3960 → 嵌入模块长度 14,688 字节
50d4d  call _Znwm(r14)                 ; 分配缓冲区
50d65  r13d = 0x7f4a7c15 + [0x59380](=0x77ada66e)   ; PRNG 状态
50dac  for i in 0..len:
          xorshift32 三次（>>15 ^, *0x2c1b3c6d, >>12 ^, *0x297a2d39, >>15 ^）
          bpl ^= [0x59390 + i]          ; ★ 0x59390 起的 0x3960 字节密文
          buf[i] = bpl
50f73  write(fd, buf, len)              ; ★ 把解出来的 ELF 灌进 memfd
50fa6  转十进制字符串（fd 号）
51403  call dlopen("…/proc/self/fd/N", 2)   ; ★ RTLD_NOW
5149d  call dlsym(handle, symbol)            ; 只有一个符号
514c6  call rbx                              ; 调用它 → 返回函数表
514d0  cmp QWORD [rbx],0x38                  ; ★ 表大小必须 0x38 = 56 字节
514d6  [rbx+0x08] [rbx+0x10] [rbx+0x18] [rbx+0x20] [rbx+0x28] [rbx+0x30] 全部非 0
51500  [0x69188] = 表指针                     ; 缓存
```

所以：**`.rodata` 的 `0x59390`–`0x5ccf0` 是一段 0x3960 字节的加密 ELF**，
它就是 `0x50c30` 每次会话解密后 `dlopen` 起来的 helper 模块；
长度记录在紧邻其后的 `0x5ccf0`。

**边界算术自洽（强证据）：`0x59390 + 0x3960 = 0x5ccf0`**，
而 `.rodata` 的结束地址正是 `0x5ccf0 + 8 = 0x5ccf8`（`0x57000 + 0x5cf8`）。
即「密文体 + 长度字段」**正好塞满 `.rodata` 尾部，一个字节不剩** ——
长度字段不是巧合，它就是那段密文的长度。**【确认】**

memfd 名字也是个加密串：`0x592c8`、`0x50c94` `_M_constructEmc(len=0x15)`、
种子 `0x815b409f97c3e4f6`（`0x50ca0`）、三段解码器 `0x51ee0`/`0x52210`/`0x52530`
（`0x50cc0`/`0x50cd6`/`0x50cef`）→ 21 字节名字，`.rodata` 里看不到明文。

`0x68ee0` / `0x68ee8` / `0x68ef0` 三个全局是它的记账：

| 全局 | 含义 | 写入点 |
|---|---|---|
| `0x68ee0` | 原始函数指针（只记一次） | `0x16a1d` `lock cmpxchg [0x68ee0], rcx` |
| `0x68ee8` | helper 函数表指针 | `0x16a54` `0x125fe` `0x19534` |
| `0x68ef0` | 已安装的替换函数指针 | `0x168dc` `lock cmpxchg [0x68ef0], rbp`；`0xdca8` 清零 |

`0x19810(rdi, rsi, rdx)` 是「用 `[0x68ef0]` 做前后比对」的包装器：

```
1982d  rax = [0x68ef0]                   ; 当前已装替换函数
19834  call rax（rdi=r14）               ; 调它
1983f  真 → pthread_mutex_lock(&0x68cd8); 若 [0x68d20]==r14 → [0x68d28]=r15, [0x68d30]=1
```

**【确认】** hook 的「新值」不是硬编码在载荷里的某个函数地址，而是 helper 模块
在运行期算出来的（helper 自己也是 ELF，可以正常走 `.data.rel.ro`/重定位逻辑）。
**【推测】** helper 的职责是：给定原始函数指针，找到/生成对应的替换实现
（可能做了指令级跳转桩或等价重定位），这也解释了为什么载荷要往 memfd 里塞一个完整 ELF
——`.text` 段不可写、且载荷自己已被加载过，没法再挂一段可执行代码进去。

---

## 6. `fork` + `prctl` + `getppid` 到底在干什么

`fork` 只有一处（`0xd567`），上下文完整可读，是 `0xd4c0`（一个线程体）：

```
d4e0  loop: nanosleep(&{0,0})           ; 纯让出 CPU
d4fa  构造 std::string → rsi = 0x57bb5  ; 环境变量名（加密串，解码后是 SNOWLUMA_*）
d504  call 0x1cc40(rdi=rsp, rsi)        ; 解码
d510  getenv(name)
d42f  strcmp(env, "1") | strcmp(env, "true") | strcmp(env, "on")   ; 0xd42f/0xd445/0xd458
d47e  三个都不匹配 → 只 return；匹配 → 继续
d48c  pthread_create(&tid, 0, 0xd4c0, 0) ; ★ 重新起一个自己
d4aa  pthread_detach(tid)

d560  getpid(); ebp = pid
d567  call fork()                        ; ★ 唯一的 fork
d56c  test eax,eax ; jne 0xd5b3          ; 父进程 → 直接 return
d570  edi = 1; esi = 0xf (SIGTERM); xor eax,eax
d57c  call prctl(PR_SET_PDEATHSIG=1, SIGTERM=15)   ; ★ 父死即被 SIGTERM
d581  call getppid(); cmp eax,ebp
d588  jne 0xd601                         ; 父 pid 变了 → _exit(0)
d58a  edi = ebp; esi = 0
d58e  call 0xe1d0                        ; ★ start_dynamic(pid, 0)  ← arg2 = 0！
d593  test BYTE [0x68c09],1 ; jne 0xd5fc
d59d  rbx = rsp
d5c8  loop: getppid(); cmp eax,ebp ; jne 0xd5fc   ; 父没了 → 收摊
d5d1     nanosleep(0,0)
d5fc     call 0xd620                     ; stop：还原 vtable、关 socket
d601  _exit(0)

d5a2  （另一个分支）getpid(); edi=eax; esi=1; call 0xe1d0   ; start_dynamic(pid, 1)
```

**这是标准的「双 fork / 孤儿守护」写法，不是提权：**

1. `PR_SET_PDEATHSIG(SIGTERM)`：父（QQ）一死，子立刻收到 SIGTERM；
2. `getppid() != 原父 pid`：兜住「fork 到 prctl 之间父已死」的窗口；
3. 子进程 `nanosleep(0,0)` 轮询 `getppid()`，父没了就 `0xd620` 收摊再 `_exit(0)`。

**关键设计点【确认】：fork 出来的子进程调用的是 `start_dynamic(pid, 0)`
——arg2 = 0，于是 `0xe742` 的 `cmp BYTE [0x68c10],0; je 0xe831` 命中，
第 4 个线程（`0xfcd0` hook 线程）不会被创建。**
即：

| 进程 | `start_dynamic` 参数 | 起几个线程 | 装 vtable hook |
|---|---|---|---|
| 主进程（QQ 本体） | `(getpid(), 1)` | 4 | **是** |
| fork 子进程 | `(getpid(), 0)` | 3 | **否**，只监控 + 清理 |

**【推断】** 这样拆分的原因：vtable hook 必须由拥有那套 `std::thread`/socket
状态的进程持有（否则 `0xd620` 的 join/close 会打架）；子进程只当「看门狗」，
父死时负责把父进程里的 hook 状态标记清理（`[0x68c09]=1`）并退出。
**注意：子进程并不能真的改父进程内存**（它没有 `process_vm_writev`、没有 `ptrace`），
所以「守护」的实际作用是**在父进程被 SIGKILL 后让 socket 文件不残留**
（`0xe7f7`–`0xe81e` 的 `unlink` 那两条路）。

---

## 7. 跨进程读：`process_vm_readv` 与 `/proc/<pid>/mem`

### 7.1 `process_vm_readv` 全是自读

20+ 处，全部用 `getpid()` 或 `[0]` 当 pid。典型 `0xb242`：

```
b242  ebx = [[rsp+0x30]+8]        ; 从上下文里取 pid
      iovec：1 个远端 1 个本地（edx=1, r8d=1）
      call process_vm_readv
      失败 && errno == 0x26 (ENOENT) → call 0x4890   ; ★ 兜底
```

### 7.2 兜底就是 `open("/proc/<pid>/mem")` + `pread`

`0x4890` 的骨架（`0x48cc`–`0x4a3c`）：

```
48cc  lea rsi,[0x57ea0]        ; 加密格式串
48d6  call 0x1fcb0             ; ★ 解码器：解出 "/proc/%d/mem"
48db  rdx = 解出的格式串
48e4  rdi = 栈缓冲; esi = 0x40; ecx = ebx(pid)
48ed  call snprintf(buf, 0x40, "/proc/%d/mem", pid)
49ac  call open(buf, 0x80000)  ; ★ O_RDONLY | ...
49b3  test eax,eax; cmovs → 错误码
49fb  edi = fd; rsi/rdx/rcx = 调用方给的三参
4a0c  call pread(fd, buf, len, off)     ; ★ 真正的读
4a14  __errno_location; r13d = errno
4a1f  close(fd)
```

`.rodata` 里**没有任何明文 `/proc/<pid>/mem`** —— 它是 `0x1fcb0` 那种
「字节级 PRNG 解密」解出来的（`0x1fcc3` 起是 `xor/rol/add` 的逐字节生成器，
种子 `0x2cb51d7bce9725b2`）。这和全篇所有敏感串的处理方式一致。

**【确认】读的两条腿：`process_vm_readv`（首选，要求内核支持）→
`open("/proc/PID/mem")+pread`（兜底）；写只有一条腿：进程内 `mprotect`+`cmpxchg`。**

这也解释了为什么要 import `open`/`pread`/`close`：它为「读不了自己的内存
（seccomp 挡了 `process_vm_readv`、或 `ENOENT`）」准备了一条兼容路径。

### 7.3 侦察面（`/proc` 与 ELF 自检）

- `"/proc/self/maps"`（`0x5785e`，xref `0x17434`）= `0x17420`，用
  `std::ifstream` 解析地图（`0x1744b call _ZNSt14basic_ifstream...C1EPKc`），
  条目结构 stride `0x80`（`0x16673` `sub r12,-0x80`，`0x16716 add rbx,0x40`）。
- `"/opt/QQ/"`（`0x578b9`，xrefs `0x15751`、`0x2a5a4`）—— 找 QQ 安装目录。
- `"/proc/"`（`0x5847f`，5 处 xref：`0x297c7`、`0x3a940`、`0x48272`、`0x495c7`、`0x4ac00`）
  + `opendir`（`0x4805b`）+ `"cannot enumerate /proc: "`（`0x58ff6`，xref `0x4a0ea`）
  + `"/comm"`（`0x5901b`）、`"/exe"`（`0x59021`）、`"/cmdline"`（`0x59026`）
  → **枚举系统里所有进程并按名字识别 QQ**。
- `"/map_files/"`（`0x5926e`）、`"/proc/self/fd/"`（`0x592b9`，xref `0x5137e`）
  → 用 fd 反查已映射文件，配合 `dlopen` 那一路。
- ELF 完整性与一致性自检（这一串错误串就是它的检查项）：
  `"module not found in target process maps"`(`0x58d54`)、
  `"failed to read mapped ELF module: "`(`0x58d7c`)、`"ELF file is too small"`(`0x58d9f`)、
  `"not a little-endian ELF64 file"`(`0x58db5`)、`"ELF section table is missing"`(`0x58dd4`)、
  `"invalid ELF header"`(`0x590ff`)、`"missing or ambiguous GNU build ID"`(`0x59164`)、
  `"mapped file identity: "`(`0x5919d`)、
  **`"ELF metadata differs from live memory"`(`0x59248`)**。

  最后这条尤其能说明设计意图：它不是「读文件算符号」，而是
  **「读文件 + 读活内存 + 两者必须一致」**，一致了才敢按文件里的偏移去改内存。
  这也是 `docs/vtable-hooking-notes.md` 第三节（普通 PIE 的 `.data.rel.ro` 在文件里全零、
  只能从内存取槽值）在闭源实现里的解法：**元数据从文件拿，槽值从内存拿，然后交叉验证。**

---

## 8. `dlopen`/`dlsym`/`__cxa_demangle` 分别为了什么

| API | 唯一调用点 | 目的 |
|---|---|---|
| `syscall(0x13f)` = `memfd_create` | `0x50d05` | 造一个无名文件装解出来的 helper ELF |
| `dlopen` | `0x51403`（`"/proc/self/fd/N"`, `RTLD_NOW=2`） | 把 memfd 里的 ELF 当成共享库加载 |
| `dlsym` | `0x5149d` | 取那**一个**导出符号，返回 0x38 字节函数表（7 个函数指针全非空才算成功） |
| `__cxa_demangle` | `0x3b66f` | 把 `_Z...` 的 RTTI 名还原成可读类名，供 §4.6 的名字表子串匹配 |

`__cxa_demangle` 那一段完整形态：

```
3b66f  rdi=[rsp+0x18](mangled); rsi=0; rdx=0; rcx=&[rsp+0x1d8](status)
       call __cxa_demangle
3b772  call free
3b777  test BYTE [0x69158],1 ...              ; 单例初始化
3bcfa  memcpy(local, 0x67ca8, 0x90)           ; 144 字节名字表
```

`.rodata` 里连 RTTI 原始名都是明文（`0x57c1b`、`0x57dd9`、`0x57e14`、`0x57e48`、
`0x57f79`、`0x58127`、`0x5819e`），说明这些是**本库自己的**类型，不需要隐藏；
需要隐藏的是目标模块名、`/proc` 路径、环境变量名 —— 它们全部是加密串。

---

## 9. 与我们自己实现（`src/vtable_hook.cc`）的逐项对照

| 环节 | 我们 | 闭源载荷 | 结论 |
|---|---|---|---|
| 找 vtable | `list_vtables(image)` 读文件 | `/proc/self/maps` + 活内存 + 文件交叉验证 | **它的路子更通用**（对 RELA 型 PIE 也成立） |
| 找槽 | `find_slots_calling()` 扫调用图 | RTTI 链 + 名字表子串匹配 + 结构字段 | 它是「认名字」，我们是「认代码」 |
| 改权限 | `mprotect(page, R\|W)` | `mprotect(page, 原prot \| W)` | **它更安全**，我们要改成 `or` |
| 写入 | `memcpy` | `lock cmpxchg(期望值, 新值)` | **它更安全**，并发/重载下不会覆盖别人的改动 |
| 还原 | `restore_vtable_slot()` 再 mprotect | 同左 + 失败回滚 + `[0x68494]` 记录 | 语义等价，它多了回滚 |
| 执行 hook 代码 | 自己的 `.so` 里已有函数 | 从加密 ELF 解出、`memfd_create`+`dlopen` 起来 | **它必须这么做**：`.text` 不可写、ELF 已加载，无法再注入可执行段 |
| 并发模型 | 无 | generation + mutex + 上限 119 轮 | 我们缺这一层 |

**可以直接抄的三点：**
1. `mprotect` 用 `prot |= PROT_WRITE`，别用 `mov 3`；
2. 写入用 `lock cmpxchg`（期望值 = 写前读到的旧值），失败就放弃而不是覆盖；
3. 每个槽写之前三重校验：`(addr & 7) == 0`、`addr+8 <= mapping.end`、`mapping.perms == "r--p"`。

---

## 10. 未定项（明确标出）

| 项 | 状态 |
|---|---|
| x86-64 版 `nt::MSFService` 的**确切槽号** | **未验**。载荷把槽号存 `ctx+0x70`，我只能在 aarch64 文档（槽 36 / `+0x120`）和同构错误串之间做**推断** |
| helper 模块（0x3960 字节）的内部实现 | **未解**。它是加密的（PRNG 逐字节 XOR），我没解密运行；`0x50c30` 的解密算法已完整读出（`0x50dac`–`0x50de5`），但内容未展开 |
| `ctx+0x60` 与 `ctx+0x180` 是否恒等 | **推测**二者是同一个「原始函数指针」的两份拷贝（§4.4 末） |
| `ctx+0x188` 的用途 | **未知**。只看到它和 `ctx+0x180` 一起被塞进 `0x1695e` 那个 0x18 字节结构 |
| `0x68b40/0x68b48` 那个有序向量的语义 | **未定**。`0x19010` 对它做 stride 0x80 的二分查找（`cmp [rbx],rax` / `cmp [rbx+0x20],rax` / `BYTE [rbx+0x18]==3`），像「已解析目标登记表」 |
| `0x48d6` 解出的格式串是否为 `/proc/%d/mem` | **强推断**。`snprintf(buf,0x40,fmt,pid)` + `open(...,0x80000)` + `pread` + `__errno_location`，形态唯一；但密文未解，字符层面没有直接看到 |

---

## 11. 附录：`.bss` 关键全局一览

| 地址 | 类型 | 含义 | 主要引用 |
|---|---|---|---|
| `0x68478`–`0x68494` | 描述符 | 目标槽地址 / expected / new / prot / valid | `0x16ac1` `0x18f70` `0x16625` `0xd96e` |
| `0x68470` `0x68474` | int | control / recv 监听 fd | `0xe5f7` `0xe609` `0xe6a0` `0xe6f1` |
| `0x684c8` `0x684e8` | string | control / recv socket 路径 | `0xe1b0` `0xe1c0` `0xe6bc` `0xe70d` |
| `0x684b0` `0x684b8` `0x684c0` | thread | worker×2 / hook 线程 | `0xe6e5` `0xe73b` `0xe7c0` |
| `0x684d0` `0x684f0` | size | 两条路径字符串长度 | `0xe7f7` `0xe80d` |
| `0x68c08` | byte | `is_loaded`（bit0） | `0xe170` `0xe214` `0xe823` `0xd620` |
| `0x68c09` | byte | stop 请求 | `0xe239` `0xe82a` `0xfcf2` `0xf5e2` |
| `0x68c0a` | byte | atexit 已注册 | `0xe1ee` `0xe20b` |
| `0x68c0c` | dword | pid | `0xe240` `0xecb7` `0x13a4a` `0x1519b` |
| `0x68c10` | byte | **arg2：要不要装 hook** | `0xe246` `0xe742` |
| `0x68c11` | byte | 「hook 已装」标志 | `0x103ec` `0x105ed` `0x1192b` `0x11b7d` |
| `0x68c60` | mutex | 全局大锁 | `0xe1e1` `0x10130` `0xd620` |
| `0x68c88` | qword | **generation** | `0xe227` `0xfd20` `0xf63e` |
| `0x68d20` | qword | 当前活跃目标指针 | `0x169d0` `0x1b9c6` `0x187e5` |
| `0x68d28` `0x68d30` `0x68d38` | — | 目标切换记录 | `0x19858` `0x1b9d1` |
| `0x68ee0` | qword | 原始函数指针（只记一次） | `0x16a1d` `0xdc87` |
| `0x68ee8` | qword | helper 函数表 | `0x16a54` `0x125fe` `0x19534` |
| `0x68ef0` | qword | 已装替换函数 | `0x168dc` `0x1982d` `0xdca8` |
| `0x68ef8` | dword | 引用计数（异常安全） | `0x187c9` `0x19818` `0x18f54` |
| `0x69140`–`0x69158` | 容器 | demangle 名字集合及其 guard | `0x3b785` `0x3bcd6` `0x40ca0`(atexit) |
| `0x69188` | qword | `dlopen` 后的函数表缓存 | `0x50c58` `0x51500` |

---

*本文所有地址均为 `snowluma-linux-x64.so` 的链接期虚拟地址（VMA），
与 `objdump -d` 输出一致。原文反汇编留档在 `work/dis.txt`、`work/dis_raw.txt`、
`work/str.txt`、`work/funcs.txt`（`eh_frame_hdr` 还原的 435 个函数边界）。*