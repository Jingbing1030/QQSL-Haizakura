# 原版 `probe.node` 逆向行为规格 —— attach / trampoline / 远程调用

> 逆向对象：`/tmp/probe.node`（oracle 容器 `hz-test` 内 `/tmp/probe.node`，与 oracle 主机副本 md5 一致）
> 318,640 字节 · `aarch64` ELF64 `ET_DYN` shared object · `stripped` · BuildID `b6d15708…4c72` · md5 `8786a929f11856db2f93a01d09916214`
> 本地副本：`~/probe.node`
> 分析日期：2026-11-19
> **未跑过任何注入、未 attach 过 QQ、未启动/重启 hz-test 容器内任何进程。**

## 0. 方法学与证据分级

### 工具
任务书说本机没有 `objdump`/`readelf`，**实际是有的**，而且装的是完整的 aarch64 交叉 binutils：

```
/usr/bin/aarch64-linux-gnu-objdump    # 可直接 -d 反汇编 aarch64
/usr/bin/aarch64-linux-gnu-readelf
/usr/bin/aarch64-linux-gnu-nm
```
（`/usr/bin/objdump` 是 x86 专用构建，`objdump -i` 不含 aarch64，对 probe.node 报 `can't disassemble for architecture UNKNOWN!`；用交叉版即可。）

### 我做了什么
1. `aarch64-linux-gnu-objdump -d --no-show-raw-insn ~/probe.node` → `~/probe.dis`（63,916 行，.text `0x4530–0x41da0`）。
2. 自写 `.eh_frame_hdr` 解析器（`~/rev/elf.py`）还原 436 个 FDE 起点。
3. 二进制的 `.eh_frame` FDE 被 C++ 异常着陆点切碎（一个真实函数对应多个 FDE）。因此另建**函数边界重建器**：合并 `{FDE 起点} ∪ {函数序言模式} ∪ {BL 目标}`，并用「上一条指令是 `ret`/`b`/`br`」校验，得到 **427 个函数**（`~/rev/fstarts4.json`）。
   > 序言模式必须包含两种：`stp x29,x30,[sp,#-N]!`（本身就是序言）和 `sub sp,sp,#N` + 3 条内 `stp x29,x30,[sp,#M]`。只匹配后者会漏掉一半函数（本人在 `0x26dec` 上踩过这个坑）。
4. 自写 ADRP+ADD 配对扫描器 → **762 个 ADRP+ADD 对**，其中 **600 个指向 `.rodata`**（`~/rev/pairs.json`，含「中间寄存器未被 clobber」校验）。
5. 生成带字符串注释的 `~/rev/annot.dis`（63,341 行），所有下列结论均可在其中逐行核对。
6. 对 2 个结论做了**本机动态实证**（只针对我自己 fork 的 `sleep` / `pthread` 测试进程，见 §2.6、§3.7）。

### 证据标记
- **【确认】** = 二进制里有直接证据（指令/常量/字符串 xref），我读到了。
- **【推断】** = 由多处【确认】拼出的语义，属于合理推断但无单条指令直接证明。
- **【未证实】** = 我没能从二进制证实，附我试过什么。

---

## 1. 符号地图（关键函数）

`.text` 全部 stripped，下面是**地址**，不是符号名。列「作用」是我的推断。

| 函数地址 | 大小 | 作用 |
|---|---|---|
| `0xbc4c` | 392 | **`napi_register_module_v1`**（唯一有名字的导出） |
| `0xccb0` | 1832 | N-API 方法注册表（含 `loadModuleManualAsync` 的 `napi_create_async_work`） |
| `0x10e44` | 288 | `loadModuleManualAsync` 的**异步 execute 回调** |
| `0x10f64` | 476 | 回调里把结果塞进 promise（异常转换 `runtime_error`） |
| **`0x1e258`** | 2972 | **`loadModuleManualAsync` 的真正主体**（`LoadModuleManual`） |
| `0x1eef0` | 2144 | **卸载**主体（`UnloadModuleManual`：`stop_dynamic` + `munmap`） |
| `0x21748` | 164 | TraceSession 构造（pid、deadline = now + 20 s） |
| **`0x21814`** | **1940** | **trampoline 线程选择 + attach 驱动**（两条核心报错都在这里） |
| `0x23a3c` | 732 | **单线程 attach**（SEIZE → 失败则 PRoot ATTACH → INTERRUPT） |
| `0x16bc4` | 1692 | **线程枚举**（`opendir("/proc/<pid>/task")`） |
| `0x16a14` | 432 | **线程打分**（读 `/wchan` 后按内核阻塞函数名打分） |
| `0x16330` | 1764 | `/wchan` 读取器（拼路径 + `open`/`read`） |
| `0x15218` | 1712 | `/proc/<pid>/maps` 地址映射器（PRoot 用） |
| `0x158c8` | 808 | **PRoot 符号地址转换器**（dladdr → maps → 目标文件偏移） |
| `0x24350` | 1512 | **PRoot 会话建立**（SETOPTIONS + 注入 `syscall()` + SIGSTOP） |
| `0x24420`–`0x248c0` | — | PRoot 收尾（等待 syscall 退出 + 恢复 + DETACH） |
| **`0x2034c`** | 2632 | **远程调用原语**（`PTRACE_CONT` + 等 stop + 读 x0） |
| `0x26fd4` | 120 | **远程调用参数块构造**（栈指针按 16 对齐下推 128 B） |
| `0x21628` | 148 | 远程内存写（`process_vm_writev` → 回退 `PTRACE_POKEDATA`） |
| `0x173d8` | 300 | 远程内存读（`process_vm_readv` → 回退 `PTRACE_PEEKDATA`） |
| `0x26e58` | 180 | `PTRACE_GETREGSET`(0x4204, NT_PRSTATUS, 272 B) |
| `0x26f0c` | 188 | `PTRACE_SETREGSET`(0x4205, NT_PRSTATUS, 272 B) |
| `0x220bc` | 384 | **DETACH**（`0x11`） |
| `0x22a1c` | 664 | 恢复报告器（输出 `; recovery: ` / `; stack restore: ` / `; register restore: `） |
| `0x23018` | 408 | 精确等待 SIGSTOP（`PRoot resume while awaiting SIGSTOP failed`） |
| `0x14e84` | 916 | 读 `/proc/self/status` 的 `TracerPid:` |
| `0x14cdc` | 368 | `TracerPid:` 行解析（`ifstream` + `getline` + `>>int`） |

---

## 2. attach 算法（核心）

### 2.1 入口与调用链【确认】

```
loadModuleManualAsync(pid, dylibPath)          // JS 可见
  └─ 0xccb0  napi_create_async_work(
        execute = 0x10e44, complete = 0x11024)   ← 0xd1f0/0xd1f8/0xd1fc
  └─ 0x10e44(env, data)                          // libuv 线程池里跑
        └─ 0x1e258(w0 = w19[16] /*pid*/, x1 = data+0x18 /*path*/,
                   x2 = sp /*out struct*/, x3 = sp+0x20 /*err*/)
```
> 也就是说：`loadModuleManualAsync` **不在 JS 主线程执行**，它在 libuv 的 worker 线程里同步跑完整个 attach + 手动加载 + 远程调用，结束时 resolve promise。**对 JS 是「异步」，对目标进程是一次性同步完成的操作。**

### 2.2 `0x1e258` 的执行顺序【确认，逐条对应指令】

| 顺序 | 指令地址 | 动作 |
|---|---|---|
| 1 | `0x1e2ac` | `0x14378` 读入 dylib 文件到内存（后续手动映射用） |
| 2 | `0x1e2c8` | `sysconf(_SC_PAGESIZE)`（`w0=0x1e`），校验是 2 的幂且 ≥ 0x1000 |
| 3 | `0x1e40c` | `0x18f58` — **ELF 解析/手工加载器 prepare** |
| 4 | `0x1e430` | `0x16124` — **远程符号解析器**（`mmap`/`mprotect`/`munmap`/`dlopen`/`dlsym`… 见 `0x42930` 起字符串） |
| 5 | `0x1e44c`–`0x1e45c` | `0x21748` **构造 TraceSession**（见 §2.3） |
| 6 | **`0x1e47c`** | **`0x21814` = 选 trampoline 线程并 attach** ← ★ |
| 7 | `0x1e4cc` / `0x1e4ec` / `0x1e50c` | 三次 **远程 `mmap`**：`len` = 未知 / `0x1000` / `0x10000` |
| 8 | `0x1e56c` | `0x1cdd8` — **手动映射主流程**（详见 `docs/` 其他文档） |
| 9 | `0x1cc7c` @ `0x1e5c0` | 远程解析 **`snowluma_linux_hook_start_dynamic`** → 写入 `x3 = sp+0xd0`（即 `[sp,#208]`） |
| 10 | `0x1cc7c` @ `0x1e5e8` | 远程解析 **`snowluma_linux_hook_stop_dynamic`** → 写入 `x3 = sp+0xc8`（即 `[sp,#200]`） |
| 11 | `0x1c20c` @ `0x1e618` / `0x1e624` | 远程解析 `__register_frame`（out = `sp+0xc0` = `[sp,#192]`）/ `__deregister_frame`（out = `sp+0xb8`） |
| 12 | `0x1e6f0` | `0x1e1bc` 把某个 `{init,fini}` 数组的 8 个地址对**清零**（memset） |
| 13 | `0x1e70c` | 远程写 `sp+704` 起的块 |
| 14 | **`0x1e714`–`0x1e778`** | **遍历 `sp+216` 的 `{init,fini}` 对数组，逐个远程调用 init**（stride = 0x10，`x1 = *(pair) + base`） |
| 15 | **`0x1e784`–`0x1e7b4`** | **远程调用 `snowluma_linux_hook_start_dynamic`**：`ldr x1,[sp,#192]` = 第 9 步存入的地址；`ldr x8,[sp,#152]` 再 `str x8,[sp,#16]` 作为实参 0；`x2 = sp+0x10` 为结果槽；`bl 0x2034c` |
| 16 | `0x1e7d0` | `0x1d72c` 收尾（`__register_frame` 等） |
| 17 | `0x1e87c` | `ldr x9,[sp,#208]` → `stp x8,x9,[x19]` 写进 out 结构（`handle.entry`）；`[x19,#16]=x10`、`[x19,#24]=len` |

**结论（回答子任务问题 5）：`loadModuleManualAsync` 确实同步调用 `start_dynamic`，而且是在 `init_array` 全部跑完之后。** 顺序是「先 init_array 每一个，再 start_dynamic」，不是反过来。
**并且这一步是同步阻塞的**（对 libuv worker 线程而言），不是 fire-and-forget —— 因为紧随其后 `0x1e870` 立刻读 `[sp,208]` 拿返回值。

### 2.3 TraceSession 内部布局【确认，从各访问点归纳】

`0x21748` 构造，`str w1,[x0]` 存 pid，`strb w9,[x0,#4]` 存「本进程是否已被 tracer」（由 `0x14e84` 得出），`stp x8,x0,[x19,#56]` 存 deadline（`now + 0x4a817c800` = **+20 秒**，纳秒）。

| 偏移 | 类型 | 含义 |
|---|---|---|
| `+0` | `int` | **目标 pid** |
| `+4` | `bool` | **`isTraced`** = 「注入器自己（node）当前是否被 ptrace」（由 `0x14e84` 读 `/proc/self/status` 的 `TracerPid` 得到；`0x21768 bl` / `0x2177c strb w9,[x19,#4]`） |
| `+8` | `ptr` | 保存的寄存器镜像（`0x26dec` 分配 512 B 并清零） |
| `+16..+32` | `std::vector<int>` | **已 attach 成功的 tid 列表**（capacity/end 在 `+24`/`+32`） |
| `+40` | `int` | **当前 trampoline tid**（0 = 无） |
| `+48` | `xregs` 缓冲 | `GETREGSET`/`SETREGSET` 的 272 B 结构 |
| `+56` | `time_point` | **deadline**（`steady_clock`，20 s） |
| `+64` | `std::string` | **错误信息**（失败时写这里，一路返回到 JS 的 reject） |
| `+96` | `bool` | `hasStopped` / 会话已启动 |
| `+97` | `bool` | `stoppedByCont`（当前 stop 是我们 `PTRACE_CONT` 打出来的） |
| `+98` | `bool` | `seized`（用了 SEIZE 而非 PRoot ATTACH） |
| `+99` | `bool` | `timedOut` |

### 2.4 `0x21814`：选 trampoline 线程【确认】

精确的伪代码（逐块对应指令地址）：

```c
// 0x21814(session* s, std::string* err) -> bool
bool select_trampoline(Session* s, std::string* err) {
    if (s->isTraced /* +4 */) {                // 0x21838: ldrb w8,[x0,#4] / cbz → 0x21880
        // ---- 本进程正被 trace（PRoot 环境）：不枚举线程，直接 attach 主线程 ----
        int tid = s->pid;                      // 0x21844: ldr w1,[x21]   ★ tid = pid
        if (!attach_one_thread(s, tid, err))   // 0x21850: bl 0x23a3c（走 PRoot ATTACH 分支）
            return false;
        if (!get_regs(s->curTid /*+40*/, s->xregs /*+48*/, err))  // 0x21864: bl 0x26e58
            return false;
        s->hasStopped = true;                  // 0x21870: strb w20,[x21,#96]
        return true;
    }

    // ---- 枚举线程 ----
    std::vector<int> tids;
    enumerate_threads(s->pid, &tids);          // 0x21888: bl 0x16bc4
    if (tids.empty()) {                        // 0x21890..0x21894
        *err = "target process has no task threads";   // 0x218fc
        return false;
    }

    // ---- 打分 + 过滤主线程 ----
    struct { int score; int tid; } scored[];   // 打包为 x24 = tid | (score<<32)
    for (int tid : tids) {
        if (tid == s->pid) continue;           // 0x21970..0x21978  ★ 跳过主线程
        int score = thread_score(tid);         // 0x21980: bl 0x16a14（读 /wchan）
        scored.push_back({score, tid});        // 0x21958: bfi x24,x25,#32,#7
    }

    // ---- 排序 ----
    if (scored.empty()) {
        scored.push_back({s->pid, s->pid});    // 0x21a7c/0x21a9c: 全被过滤则退回主线程
    }
    sort(scored);                              // 0x21a50: bl 0x23d18  +  0x21a60: bl 0x23f90
    //                           ↑ 排序键 = 32-bit 打包值 (score<<32|tid)
    //                             → 主键 = score（升序），次键 = tid

    // ---- 逐个尝试 ----
    for (auto& c : scored) {                   // 0x21aac..0x21af4
        int tid = c.tid;                       // 0x21ac0: ldr w1,[x20]
        if (attach_one_thread(s, tid, err)) {  // 0x21acc: bl 0x23a3c
            // attach 成功 → 立刻验证能读寄存器
            if (get_regs(s->curTid /*+40*/, s->xregs /*+48*/,
                         &tmpbuf, err)) {          // 0x21ad4/0x21ad8/0x21adc/0x21ae0
                s->hasStopped = true;          // 0x21c68/0x21c6c  strb w20,[x21,#96]
                return true;                   // → 0x21d20 → 0x21d48 mov w0,w20(=1)
            }
            // getregs 失败 → 先 DETACH 收拾干净
            if (detach_all(s, err))            // 0x21af0: bl 0x220bc（返回 1=成功）
                continue;                      // 0x21af4 tbnz → 0x21ab4 试下一个
            return false;                      // 0x21af8 → 0x21c74（detach 也失败）
        }
        // attach 失败 → 0x21afc
        if (!s->tids.empty())                  // 0x21afc/0x21b00: ldp x8,x9,[x21,#16]; cmp
            return false;                      // 0x21b04 b.ne → 0x21c20（带着已有 err 返回）
        if (steady_clock::now() >= s->deadline) {  // 0x21b08/0x21b0c/0x21b10
            s->timedOut = true;                // 0x21b20 strb w8,[x21,#99]
            break;
        }
        // 否则 0x21b14 b.gt → 0x21ab4 —— 继续试下一个
    }

    if (s->tids.empty()) {                     // 0x21b34..0x21b3c
        *err = "no thread could be attached as trampoline";  // 0x21bac
        return false;
    }
    return true;
}
```

> **注意（曾误读，已更正）**：`0x21af0 bl 0x220bc` 是 **GETREGSET 失败后的清理**，不是「成功后 DETACH」。
> 成功路径是 `0x21ae4 tbnz w0,#0 → 0x21c68`（置 `hasStopped=1`）→ `0x21d48` **直接 return true**，**不 detach**。
> 也就是说：**`0x21814` 成功返回时，目标线程仍处于 SEIZE + 已停（stopped）状态，会话一直持有它**，后续远程调用直接复用。
> （这也顺带解释了 `0x2034c` 为什么能假定 `s->hasStopped` 为真 —— attach 是在 `0x21814` 里一次性完成的。）

#### 线程选择的判据（回答问题 2）

1. **枚举**：`opendir("/proc/<pid>/task")` + `readdir` + `strtol(name,10)`。
   - 过滤：跳过 `.`/`..`（`0x16e5c` 的 `sub w8,w8,#0x3a; cmn w8,#0xa`），跳过非纯数字名（`0x16e6c`–`0x16e7c` 逐字节验 `'0'..'9'` 且必须以 NUL 结束）。
   - 保留 `tid > 0`（`0x16ecc`）。
   - 被过滤/解析失败则 `errno` 校验后继续。
2. **排除主线程**：`0x21974 cmp w24, w0` / `b.eq 21960` —— `w0 = [x21] = pid`，即 **`tid == pid` 的线程被跳过**。
   > 逻辑上这是「优先选辅助线程，避免把主线程（跑着 JS/事件循环的那个）停下」。
3. **打分**（`0x16a14`，读 `/proc/<tid>/wchan` 拿内核符号名，然后 `std::string::find` 子串匹配）：

| 分数 | 匹配的内核栈符号 | 语义 |
|---:|---|---|
| `0` | wchan 为空 | 当前在用户态空转/未知 |
| `100` | 含 `"syscall"` | 通用阻塞在 syscall |
| `90` | `"do_epoll"` / `"poll_schedule"` / `"do_sys_poll"` / `"do_select"` | **epoll/poll/select 等待**（事件循环线程） |
| `80` | `"hrtimer_nanosleep"` / `"nanosleep"` | 睡眠中 |
| `70` | `"futex_wait"` | 等锁 / condvar |
| `60` | `"schedule_timeout"`（`csel` 兜底） | 被调度超时 |
| （无匹配） | — | 沿用 `w19=0` |

   - 打分函数开头还有一次 `compare("0")`（`0x16a40` → `0x428f9` 附近）：**`/wchan` 内容为 `"0"` 直接给 0 分**（内核隐藏 wchan 时）。
   - 上述字符串全部在 `.rodata` `0x42930`–`0x429da`，**`ep_poll` 在 `0x42977` 没有 ADRP+ADD xref**（推测被 `do_epoll` 的 `find` 顺带覆盖，属【推断】）。
4. **排序**：把 `(tid, score)` 打包成 64 位 `tid | (score << 32)` —— **tid 在低 32 位（偏移 +0），score 在高 32 位（偏移 +4）**：
   ```
   0x2196c  ldr  w24, [x27]              ; w24 = tid        → 元素低 32 位
   0x21980  bl   0x16a14                 ; w0  = score
   0x21984  mov  w25, w0
   0x21958  bfi  x24, x25, #32, #7       ; 把 score 插到 bit32 → 高 32 位
   0x2195c  str  x24, [x22], #8          ; 8 字节元素 { tid(+0), score(+4) }
   ```
   然后 `std::sort`（`0x23d18` = `__introsort_loop`，`0x23f90` = `__final_insertion_sort`，两者 `comp` 参数都是 `0` → 默认 `operator<`）。

   **排序键是 `score`（高 32 位），方向是降序（分高的先试）。**

   【推断·强】证据：`0x23d18` 里所有参与比较的操作数都落在 8 字节元素的 **`+4`（高 32 位 = score）**：
   ```
   0x023d84  ldr w10, [x19, #12]         ; 第 2 个元素的 +4 = score
   0x023d90  ldr w11, [x9, #4]           ; 某元素 score
   0x023d94  ldur w9, [x20, #-4]         ; 前一元素 score
   0x023e24  ldr w8,  [x19, #4]          ; pivot score
   0x023e2c  ldr w9,  [x26, #12]         ; 下一个元素 score
   0x023e44  ldur w10,[x20, #-4]         ; 前一个元素 score
   ```
   方向来自插入排序内层循环（`0x23e44`–`0x23e50`）：
   ```
   0x023e4c  cmp w8, w10                 ; pivot.score ? prev.score
   0x023e50  b.gt 23e44                  ; 只要 pivot > prev 就继续往前挪
   ```
   「pivot 大于前驱时继续后移」= 大的排前面 = **降序**。

   **这与打分表的设计意图一致**：`ep_poll/do_epoll` = 100 分（最优先），所以它**先挑停在 epoll/poll/nanosleep 里的线程**，最后才挑分 0 的空闲线程。

   > 【未证实·方向】降序是我从上面那条 `b.gt` 推的，`__introsort_loop` 的 median-of-3 分支我没完整走通。**想立刻证实**：起一个 4 线程目标，让它们的 `/wchan` 分别是 `ep_poll` / `futex_wait` / `hrtimer_nanosleep` / 空，看它第一个 `SEIZE` 的是哪个 tid（`strace -f -e trace=ptrace` 一行就够）。

5. **重试**：对排序后的列表**顺序逐个尝试，没有次数上限**（= 线程数），但受 20 秒总 deadline 约束：
   - 只要 `s->tids` 还空且 `now < deadline` 就换下一个（`0x21afc`–`0x21b14`）；
   - 超时后停止尝试，最终 `tids` 仍空 → `"no thread could be attached as trampoline"`。
   - 注意 `0x21afc` 读的是 `[x21,#16]` 与 `[x21,#24]` **比较相等**（`ldp x8,x9` / `cmp` / `b.ne` → 说明 `+16`/`+24` 是 vector 的 `begin`/`end`）——即「`tids` 非空就不再看 deadline」。

6. **成功后「不」DETACH，会话一直持有该线程**：
   成功路径 `0x21ae4 tbnz w0,#0 → 0x21c68`（`strb w20,[x21,#96]` 置 `hasStopped=1`）→ `0x21d48`（`mov w0,w20` = 1）**直接返回**。
   `0x21af0 bl 0x220bc`（DETACH）**只出现在 `GETREGSET` 失败**的分支（`0x21ae4` 的 `tbnz` 不跳则落到 `0x21ae8`–`0x21af0`），是**清理**而非正常流程。
   → 所以 `0x21814` 返回 true 时，**目标线程处于 SEIZE + 已停（stopped）状态**，后续所有远程调用（`0x2034c`）都复用同一个 `s->curTid`，直到最后 `recover()` 里才统一 DETACH。

### 2.5 `0x23a3c`：单线程 attach【确认——这是最关键的一个函数】

```c
// 0x23a3c(Session* s, int tid /*w1*/, std::string* err)
bool attach_one_thread(Session* s, int tid, std::string* err) {
    // ---- 第一步：PTRACE_SEIZE（首选）----
    r = ptrace(PTRACE_SEIZE, tid, 0, 0);        // 0x23a60 mov w0,#0x4206
                                                // 0x23a64 x2=0, 0x23a68 x3=0
                                                // 0x23a70 bl ptrace@plt
    if (r == 0) goto success;                   // 0x23a74 cbz x0, 0x23b4c
                                                //   ★ x2=x3=0 → **不带任何 ptrace options**

    // SEIZE 失败。看 errno：
    if (s->isTraced /* +4 */ != 0) {            // 0x23a78 ldrb w8,[x19,#4]
        if (errno >= 0x5f /*95*/) goto seize_err;   // 0x23a88 cmp #0x5f / b.ge → 0x23adc(b.ne)
        if (errno == 3 /*ESRCH*/) goto proot_path;  // 0x23a90 cmp #3 / b.eq → 0x23ae0
    }
seize_err:
    *err = "PTRACE_SEIZE failed";               // 0x23aa0  (errno=95 等情形)
    return false;

    // ---- 第二步（PRoot 专用回退，仅当本进程已是 tracee 且 EPERM/ESRCH）----
proot_path:                                     // 0x23ae0
    // 用本进程自己的 libc "syscall" 符号做「远程 syscall 执行器」
    if (!resolve_local_syscall(s, &addr, err))  // 0x23afc bl 0x158c8
        return false;                           //   x2 = "syscall" (0x43871)
                                                //   x1 = GOT[3960] = libc 句柄
                                                //   x3 = &s->pid
    r = ptrace(PTRACE_ATTACH, tid, 0, 0);       // 0x23b04 mov w0,#0x10
                                                // 0x23b08 w1 = tid(w21)
                                                // 0x23b14 bl ptrace@plt
    if (r != 0) {
        *err = "PRoot PTRACE_ATTACH failed";    // 0x23b24
        return false;
    }

success:                                        // 0x23b4c
    s->tids.push_back(tid);                     // 0x23b58/0x23b5c（vector<int> @ +16）
    s->curTid = tid;                            // 0x23c00 str w21,[x19,#40]
    s->stoppedByCont = false;                   // 0x23c04 strb wzr,[x19,#97]
    if (s->regsSaved /* +8 */ == 0) {
        // 首次：用 INTERRUPT 拿到 stop
        r = ptrace(PTRACE_INTERRUPT, tid, 0, 0);   // 0x23c60 mov w0,#0x4207
                                                   // 0x23c70 bl ptrace@plt
        if (r != 0) { *err = "PTRACE_INTERRUPT failed";   // 0x23c80
                      detach(s, 0); return false; }        // 0x23cc0 bl 0x220bc
    }
    s->seized = true;                           // 0x23c20 strb w8,[x19,#98]
    // 进入「等待 stop 完成」流程
    rc = wait_for_stop(s, ...);                 // 0x23c24 bl 0x23018
    if (rc != 1) { /* 0x23c3c.. 回滚：清 tids/curTid/seized/hasStopped */ }
    return rc == 0;
}
```

**回答「PTRACE_ATTACH 还是 SEIZE、attach 谁」：**
- **首选 `PTRACE_SEIZE`（`0x4206`），payload 参数 `addr=0, data=0`，`pid = 单个 tid`，绝不是整个进程。**
- 明确**没有** `PTRACE_O_TRACECLONE`/`O_TRACEFORK` 等选项（`x3 = 0`）。也就是说它**不会自动接管新线程**，停在哪个线程就只操作那个线程。
- `PTRACE_ATTACH`（`0x10`）**只出现在 PRoot 回退路径**里，且是 `s->isTraced` 为真（本进程已经在被 trace）时才走。
- `PTRACE_O_EXITKILL`（`0x100000`）**全程没出现** —— 原版不设置 ExitKill。这是一个安全差异（见 §9）。

### 2.6 为什么「逐线程 SEIZE」能绕过残留 tracer —— 本机实证【确认】

我的父 agent 观察到：`PTRACE_ATTACH`/`PTRACE_SEIZE`(整进程) 因 `TracerPid` 指向僵尸 node 而 EPERM。**关键问题：TracerPid 是不是按线程独立的？** 我写了个多线程目标做实测（**不是 QQ**，是我自己 fork 的 `/tmp/tp`，4 线程）：

```
pid 2781456  threads [2781456, 2781457, 2781458, 2781459]
before:                       {main:0, t2:0, t3:0, t4:0}
SEIZE(t2=2781457) -> 0
after seize t2:               {main:0, t2:2781455, t3:0, t4:0}   ← 只有 t2 的 TracerPid 变了
SEIZE(t2) again -> -1 errno 1  (EPERM)
SEIZE(main=2781456) -> 0       ← 主线程照样能 seize
SEIZE(t3=2781458) -> 0         ← 另一个线程也照样能 seize
after detach:                 {main:0, t2:0, t3:0, t4:0}
```

**结论：【确认】`TracerPid` 是 per-thread 的。**
- 一个线程被（哪怕已死的）tracer 钉住，**只阻塞那个 tid**，同进程其它 tid 仍可被 SEIZE。
- 因此原版的「枚举线程 → 逐个 SEIZE」**天然免疫**「单线程僵尸 tracer」这种故障：它会跳过挂住的那个、试下一个。
- 但**如果整进程所有线程都被同一个僵尸 tracer 钉住**，逐个试也会全 EPERM → 最终 `"no thread could be attached as trampoline"`。

> 这也解释了父 agent 的实测：「改用 SEIZE 后一切正常」——`PTRACE_ATTACH` 走的是整进程/组语义（对一个**已被 trace 的线程**必然 EPERM 且不会自动换人），而 SEIZE 是按 tid 的。

另外实测顺带发现一个**二进制里看不到的行为**：SEIZE 成功但不去 continue/detach 时，进程/线程会停在僵持状态，`p.wait()` 会挂 —— 这也是原版为什么一定要 `INTERRUPT` + `wait` + `DETACH`。

---

## 3. 远程调用执行模型（回答问题 4）

### 3.1 谁在跑【确认】
**目标进程里被 SEIZE 的那个线程**在跑。原版不注入线程、不改 PC 到 shellcode 跑一段自造机器码 —— 它**直接调用目标进程里已有的函数**（`libc` 的 `mmap`/`munmap`，或手动映射后 `.so` 里的 `start_dynamic`）。所有「代码」都是目标进程里本来就有的合法代码。

### 3.2 参数块与栈【确认 —— `0x26fd4`】

```c
// 0x26fd4(insn_block* dst, const uint64_t* args, uint64_t fn, ..., out*)
memcpy(dst, fn_block, 512);              // 0x27008  bl memcpy  (512 B 寄存器块)
str    x22, [x20, #256]                  // 0x27010  → **pc = fn**（x22 = 目标函数地址）
ldr    q0, [x21] ; ldp q1,q2,[x21,#16]   // 0x27014/0x27024 取调用方给的 4 个参数
str    q2, [x20, #32]                    // 0x27028  → x[2],x[3]
stp    q0, q1, [x20]                     // 0x27038  → x[0],x[1]
sub    x8, x8, #0x80                     // 0x2701c  x8 原为 [x23,#248] = 保存的 sp
and    x8, x8, #~0xf                     // 0x27020  16 字节对齐
stp    xzr, x8, [x20, #240]              // 0x2702c  → **[240] = x30(LR) = 0**，[248] = 新 sp
str    xzr, [x19]                        // 0x27034  *out = 0
```
- 寄存器块 272 B（`0x110`）：`+0..+240` 是 `x0..x30`，**`+248` = `sp`**，**`+256` = `pc`**，`+264` = `pstate`。
- **`pc = fn`**（不是 `x30 = fn`！），**`x30`（LR）被显式置 0**。
- 栈：`(原 sp - 128) & ~15`，即**在目标线程原栈上就地向下让出 128 字节**，只够 16 个 8 字节槽（2 个 AArch64 栈帧 + 余量）。

> **【重要】这跟你们现在的实现不同。** 父 agent 描述「我们的做法：mmap 一块 scratch，前 64 字节放 `brk` sled 作返回地址，后面 128KB 作栈，调用完泄漏不释放」。
> 原版**不 mmap 栈、不放 brk sled、用完就还**（`pc=fn` + `x30=0` 自陷 + 128 B 临时栈 + `; stack restore:` 负责写回）。语义差别见 §9。

### 3.3 返回值怎么拿【确认 —— 机制已完整证实】

**没有任何 `brk`/`int3`/`hlt` 陷阱。** 全量扫 `.text`：`grep -c '\bbrk\b'` = **0**，`hlt` = **0**。

**真正的机制是「`LR = 0` + 空指针跳转自陷」：**

1. `0x26fd4` 把 **`x30`（LR）置 0**、**`pc` 置 `fn`**（§3.2）。
2. `PTRACE_CONT` 放行 → 目标线程从 `fn` 开始执行。
3. `fn` 里的 `ret`（或 `retaa`）取 `x30 = 0` → **跳转到地址 `0x0`** → 触发 **`SIGSEGV`**，且内核报的 `si_addr` / `pc` **落在 `0x0` 附近（< 0x1000）**。
4. 注入器在 wait 循环里识别「`SIGSEGV` 且 `pc < 0x1000`」→ 认定这是「调用返回」，于是 **`x0` 就是返回值**。

对应的判定代码（`0x2034c` 内）：

```c
// 0x02092c: GETREGSET(s->curTid, s->savedRegs, ...)  → 0x230? bl 0x26e58
// 0x020934: ldur w27,[x29,#-140]      ; w27 = 该线程的 (status >> 8) 之类
// 0x020938: ldur x0,[x29,#-136]       ; x0 = 寄存器块指针
// 0x02093c: bl 0x26fc0                ; ★ 0x26fc0 = `ldr x0,[x0,#256]` → 读 PC
// 0x020940: mov  x22, x0              ; x22 = 停下来的 PC
// 0x020944: ubfx w23, w27, #8, #8     ; w23 = 停止信号
// 0x020948: cmp  w23, #0xb            ; 0xb = SIGSEGV
// 0x02094c: b.ne 0x20958              ; 不是 SIGSEGV → 走「信号中止」路径
// 0x020950: cmp  x22, #0x1, lsl #12   ; PC < 0x1000 ?
// 0x020954: b.cc  0x20a64             ; ★ 是 → 认为是「正常返回」
...
// 0x020a64: cbz  x20, 0x20a74         ; 需要返回结果吗
// 0x020a68: ldur x0,[x29,#-136]       ; x0 = 寄存器块指针
// 0x020a6c: bl   0x26fc8              ; ★ 0x26fc8 = `ldr x0,[x0]` → 读 **x0**
// 0x020a70: str  x0,[x20]             ; *out = x0   ← 这就是返回值
```

**两个 getter（注意别混）：**

| 地址 | 指令 | 用途 |
|---|---|---|
| **`0x26fc0`** | `ldr x0,[x0,#256]` | 读 **pc** —— 只用于**判定**是不是 null-跳转自陷（`pc < 0x1000`） |
| **`0x26fc8`** | `ldr x0,[x0]` | 读 **x0** —— 用于**取返回值**（`*out = x0`） |

> 我上一版这里写错了（写成「返回值 = `pc` 槽」），实际 `pc` 槽只做判定、**返回值来自 `x0`**。已按 `0x20a68`–`0x20a70` 的实际代码更正。

**为什么这个设计很巧：** 不需要在目标里放任何自造指令（无 sled、无需 `mprotect` 可执行、无需找可写可执行页）；`x30=0` 只是把「返回点」指向一个必然 fault 的空地址，用**内核自己产生的 SIGSEGV** 当断点。而 `pc < 0x1000` 的检查刚好把「真正的空指针解引用崩溃」（一般 `si_addr` 也小，但 `pc` 会在正常代码段）与「我们制造的 `ret` 到 0」区分开 —— 严格说**这个区分不够强**（见下），但实践中够用。

**★ 本机实测验证（2026-11-19，甲骨文 aarch64 服务器，目标是我自己 fork 的进程，非 QQ）：**

我按 `0x26fd4` 的语义写了最小复现（`/tmp/rc.c`：父进程 `SEIZE` 子进程的一个 worker tid → `INTERRUPT` → `GETREGSET` 备份 → 按原版方式改写寄存器 → `SETREGSET` → `PTRACE_CONT`），结果：

```
child=1461382 tid=1461383 fn=0xc21d3c8d0de8
stopped status=0x80057f WSTOPSIG=5                     ← INTERRUPT 产生的 SIGTRAP
saved: pc=0xfc7008315aac sp=0xfc700827e820 x30=277558103933952
set: pc=0xc21d3c8d0de8 x30=0 sp=0xfc700827e7a0          ← pc=fn, LR=0, sp=(saved-0x80)&~0xF
after CONT: WIFSTOPPED=1 sig=11 (SIGSEGV=11)            ← ★ 果然是 SIGSEGV
si_addr=(nil) si_code=1                                 ← ★ si_addr 精确为 0
pc=(nil) x0=3735928859 (0xdeadc01b) expect 0xdeadc01b   ← ★ x0 = 返回值
>>> pc<0x1000? YES   VALUE MATCH
done
```

**结论**：
- `x30 = 0` → 函数 `ret` 跳到地址 `0` → 内核送 **`SIGSEGV`**，`si_addr == 0`、`pc == 0`。
- **`x0` 就是返回值**，与 `0xdeadbeef + 100 + 200` 完全吻合。
- 原版的 `pc < 0x1000` 判定等价于 `pc == 0`。
- `sp = (saved_sp - 0x80) & ~0xF` 对「只调用一层函数」确实够用（我这个测试函数的栈用量 < 128 B 成立）。
- **整条链路（`SEIZE` → `INTERRUPT` → `waitpid` → `GETREGSET` → `SETREGSET` → `CONT` → `SIGSEGV` → 取 `x0` → `DETACH`）在本机跑通，目标进程存活、干净退出。**

> 顺带证实：`PTRACE_SEIZE` 同一线程第二次会 `EPERM`，且**父进程不能 `SEIZE` 自己的线程**（必须 `fork` 出子进程再 `SEIZE` 它 —— 我第一次试就撞到 `SEIZE: Operation not permitted`）。这对我们的注入器没有影响（node 与 QQ 是两个进程），但如果写单进程自测会踩坑。

****可能的误判（原版的弱点，写在这里以免踩坑）：** 如果目标线程**自己**因为 `pc` 落在低地址（例如 JIT 的空指针、`mprotect` 后跳转到 0）而 `SIGSEGV`，也会被当成「正常返回」，返回一个垃圾 `x0` —— **静默错误**。原版没有额外的 sanity check（没有比对 `si_addr`、没有校验 `x30` 是否为 0）。我们实现时**建议加一条**：`si_addr < 0x1000 && pc < 0x1000`（而不是只看 `pc`），或者「返回值必须 = 调用前后 `sp` 已复原」。

### 3.4 现场恢复【确认】

- **`0x22a1c`** 负责输出/执行恢复报告，字符串拼接在 `0x43553`/`0x43560`/`0x43572`：
  ```c
  // 0x22a1c
  if (s->stoppedByCont /* +97 */ == 0) goto skip;         // 0x22a48
  sp = *(uint64_t*)(s->savedRegs);                        // 0x22a58
  st = s->savedRegs;                                      // 0x22a60
  // process_vm_writev(pid, &{savedSp, 8}, ...)            // 0x22a88 → 写回栈指针
  // 失败则 PTRACE_POKEDATA(pid, sp, savedSp)              // 0x22aa8 → 0x17260
  if (write failed)
      err += "; stack restore: " + <详情>;                // 0x22ac4
  if (regs->x0 == 0)
      err += "; recovery: " + <详情>;                     // 0x22bc8
  // 然后 "; register restore: "（0x22b34）走 SETREGSET 分支
  ```
  → **`; stack restore: ` 的含义：恢复目标线程栈指针（把原 `sp` 写回）失败时的诊断串。** 它不是方法论，是**失败报告**。
- 真正恢复：`0x22cb4`（`ptrace register restore failed` @ `0x22d70`）→ `0x26f0c` SETREGSET 写回整块 272 B；`0x22de0` 之前会用 `0x21628` 把原始指令字节写回（**指令修补的撤销**）。
- 最后 `0x220bc` DETACH（对 `s->tids` 里每个 tid 逐个 `ptrace(PTRACE_DETACH, tid)`，`0x2213c`–`0x22148`；`errno==ESRCH(3)` 视为成功，`0x22154`–`0x2215c`）。

### 3.5 `PRoot syscall resume failed` 说明什么【确认】

它不是「换个方式恢复」，而是 **PRoot 会话收尾失败**：
- `0x24350` 建立 PRoot 会话：`GETREGSET` → `s->hasStopped=1` → `ptrace(PTRACE_SETOPTIONS, tid, 0, 1)`（`0x24398 w0=0x4200`、`0x243a0 w3=1`）→ 构造一个调用 `libc.syscall` 的寄存器块（`0x24464 bl 0x26fd4`）→ `SETREGSET`（`0x24478 bl 0x26f0c`）→ `ptrace(PTRACE_CONT /*0x18*/ …)`（`0x24498 w0=0x18`，**0x18 是 `PTRACE_SYSCALL`**）→ deadline `now + 0x77359400` (= **2000 ms**)。
- `0x244b4` 的 `PRoot syscall resume failed` = 这次 `PTRACE_SYSCALL` 恢复失败。
- 随后 `0x244e8` `PRoot detach timed out`、`0x24608` `PRoot detach PTRACE_GETSIGINFO failed`、`0x24790` `PRoot detach probe stopped with signal `、`0x2486c` `PRoot detach did not observe getcwd exit` —— 一整套「**用 `getcwd` 当探针验证 syscall 真的执行了**」的收尾逻辑。
  → `PRoot` 就是它自己的「远程 syscall 执行器」子系统：在目标里跑一次 `syscall(SYS_getcwd, …)` 作为 liveness 探针。

### 3.6 PRoot 模块的完整职责【确认】

`0x15a88`–`0x15a98`（在 `0x158c8` 内）：
```c
*out = (addr_this - target_runtime_addr) + target_file_offset;   // 0x15a90/0x15a94/0x15a98
```
即 **PRoot = 运行时地址 → 文件偏移 → 目标进程地址 的转换器**，靠 `dladdr` 拿本进程符号（`0x42930` 的 `mmap`/`mprotect`/`munmap`/`dlopen`/`dlsym`/`dlclose`/`dlerror`/`dlvsym` 一共 8 个）和 `/proc/<pid>/maps`（`0x4284e`）里同 inode/handle 的段做换算。
用途：当目标进程（QQ）和注入器（node）**共享同一个 libc 映射**时，可以直接算出「本进程的 `libc.syscall` 在目标里的等价地址」，从而在目标里执行任意 syscall。这与我们无关（我们不共享映射），所以 `0x42887` 会报 `target does not share the injector's mapped file `。

### 3.7 `remote mmap failed` 附近【确认】

`0x19fe8` 是远程 `mmap` 包装：构造 AArch64 `mmap` 原型参数块 `[addr=0, len, prot=3, flags=0x22, fd=-1, off=0]`（常量块 `0x427f0` = `{0x22, -1}`，`0x42800` = `{8, "pid is 0..."}` 相邻），远程调用 `libc.mmap`，校验返回值 `+0x1000` 是否回绕（`0x1a044`–`0x1a04c`：`add x9,x8,#0x1,lsl#12; cmp x9,#0x1,lsl#12; b.hi` → 即「`ret` 是否 < -4096」）。
- 调用点的三次 mmap 长度：`0x1e4bc`（`x2` 来自 `sp+1120`，即 ELF 镜像大小）、`0x1e4e4`（`0x1000`）、`0x1e504`（`0x10000`）。
- **【确认】原版的 scratch/载荷缓冲区全部通过「远程 `libc.mmap`」分配，不是由注入器 `mmap` 后共享。**
- 载荷镜像本身的分配见 `0x1a148`（`0x1a5e4` 的 `w2=0x10000` 再次出现），scratch 大小下限由 `0x42a36` `remote scratch buffer is too small` / `0x42f04` `remote scratch buffer is too small for string` 校验（`0x177e8` 里 `cmp x23, x24`，`x23 = 对齐后长度 + 1`，`x24 = 缓冲容量`）。

**关于「用完泄漏不释放」：**
- **【确认】** `0x1eef0`（卸载）会远程调用 `stop_dynamic`，再**远程 `munmap` 手动映射镜像**（`0x1f2d8` 附近 `remote munmap failed for manual ELF image`），并检查 `ManualMapHandle::base is 0`（`0x1f060`）与 `ManualMapHandle::exceptionTable is 0`（`0x43340`）。
- **【未证实】** 那些远程 `mmap` 出来的 scratch（`0x1000`/`0x10000`）在手柄里有没有记录、`unload` 时是否一并 `munmap`。我只看到镜像基址被 `munmap`，**没找到**对 `0x10000` 那块 scratch 的 `munmap`。倾向于「scratch 确实泄漏」，但**没有确凿证据**。

---

## 4. `PRoot` 子系统是否存在独立模块

【确认】**存在，但是「命名空间」而非「独立二进制/线程」**。证据：
- `PRoot` 前缀的 8 条字符串全部落在 2 个函数里：`0x23a3c`（attach 回退）和 `0x24350`（会话建立），另有 `0x23018`（精确等 SIGSTOP）。它们是**同一套逻辑的入口与出口**，被 `s->isTraced`（Session `+4`）这个 bool 开关控制。
- 开关来源：`0x21748` 里 `0x21768 bl 0x14e84` → 该函数读 `/proc/self/status`（`0x4285f`）、解析 `TracerPid:`（`0x42854`，`0x14cdc` 里 `ifstream`+`getline`+`operator>>(int)`），返回 `TracerPid != 0`。
  → **`s->isTraced` = 「注入器自己（node）当前是否被调试」**。
- 所以 PRoot 分支的触发条件是：**「我自己正被 ptrace（例如跑在 PRoot/fakechroot/qemu-user 下），且对目标 SEIZE 失败了」**。
- 这与任务描述里「PRoot」名字的直觉一致：它就是为了在 PRoot 环境（注入器自身受 `ptrace` 管控）里仍能 attach 的降级路径。

---

## 5. 字符串 → `.rodata` 地址 → xref → 所属函数（完整表）

| 字符串 | `.rodata` | `ADRP+ADD` 指令 | 所属函数 |
|---|---|---|---|
| `target process has no task threads` | `0x0437e6` | `0x0218fc` | `0x21814` |
| `no thread could be attached as trampoline` | `0x043809` | `0x021bac` | `0x21814` |
| `PTRACE_SEIZE failed` | `0x04385d` | `0x023aa0` | `0x23a3c` |
| `syscall` | `0x043871` | `0x023af0` | `0x23a3c` |
| `PRoot PTRACE_ATTACH failed` | `0x043879` | `0x023b24` | `0x23a3c` |
| `PTRACE_INTERRUPT failed` | `0x043894` | `0x023c80` | `0x23a3c` |
| `PTRACE_DETACH failed` | `0x0438be` | `0x022168` | `0x220bc` |
| `PRoot PTRACE_SETOPTIONS failed` | `0x0438d3` | `0x0243b4` | `0x24350` |
| `PRoot syscall resume failed` | `0x0438f2` | `0x0244b4` | `0x24350` |
| `PRoot detach timed out` | `0x04390e` | `0x0244e8`, `0x024574` | `0x24350` |
| `PRoot detach PTRACE_GETSIGINFO failed` | `0x043925` | `0x024608` | `0x24350` |
| `PRoot detach probe stopped with signal ` | `0x04394b` | `0x024790` | `0x24350` |
| `PRoot detach did not observe getcwd exit` | `0x043973` | `0x02486c` | `0x24350` |
| `PRoot resume while awaiting SIGSTOP failed` | `0x0435be` | `0x02313c` | `0x23018` |
| `PTRACE_CONT failed` | `0x04349e` | `0x020498` | `0x2034c` |
| `PTRACE_CONT failed after signal stop` | `0x043506` | `0x020b88` | `0x2034c` |
| `remote call stopped with signal ` | `0x04352b` | `0x020ac0` | `0x2034c` |
| `remote function address is 0` | `0x043439` | `0x02058c` | `0x2034c` |
| `failed to read registers after remote call` | `0x0434db` | `0x020a50` | `0x2034c` |
| `target process ended` | `0x042a0e` | `0x0209f0` | `0x2034c` |
| `remote mmap failed` | `0x042ef1` | `0x01a07c` | `0x19fe8` |
| `; recovery: ` | `0x043553` | `0x022bc8` | `0x22a1c` |
| `; stack restore: ` | `0x043560` | `0x022ac4` | `0x22a1c` |
| `; register restore: ` | `0x043572` | `0x022b34` | `0x22a1c` |
| `ptrace register restore failed` | `0x043607` | `0x022d70` | `0x22cb4` |
| `component loading timed out` | `0x043254` | `0x01e440` | `0x1e258` |
| `snowluma_linux_hook_start_dynamic` | `0x043270` | `0x01e5b0` | `0x1e258` |
| `snowluma_linux_hook_stop_dynamic` | `0x0432b4` | `0x01e5d8` | `0x1e258` |
| `remote hook start returned 0` | `0x043308` | — | `0x1e258` |
| `/task`（枚举） | `0x0429da` | `0x016db0` | `0x16bc4` |
| `/task/`（wchan 路径） | `0x042969` | `0x016520` | `0x16330` |
| `/wchan` | `0x042970` | `0x01679c` | `0x16330` |
| `syscall`/`ep_poll`/`do_epoll`/`poll_schedule`/`do_sys_poll`/`do_select`/`hrtimer_nanosleep`/`nanosleep`/`futex_wait`/`schedule_timeout` | `0x042871`…`0x0429d7` | `0x016b78` 等 | `0x16a14` |
| `/maps` | `0x04284e` | `0x014790` 等 6 处 | `0x145a8` |
| `TracerPid:` | `0x042854` | `0x014d1c` | `0x14cdc` |
| `/proc/self/status` | `0x04285f` | `0x014ecc` | `0x14e84` |
| `PTRACE_GETREGSET failed` | `0x043b98` | `0x026ea0` | `0x26e58` |
| `PTRACE_SETREGSET failed` | `0x043bb0` | `0x026f54` | `0x26f0c` |
| `remote scratch buffer is too small` | `0x042a36` | `0x017870` | `0x177e8` |
| `target wait failed` | `0x042a23` | `0x017720` | `0x17504` |
| `was loaded but not visible in /proc/` | `0x04315f` | `0x01cff8` | `0x1cdd8` |

> `wrapper.node` 相关：`/opt/QQ/resources/app/wrapper.node` 与本规格无关（属于进程枚举/`getAllMainProcessAsync` 那条线），其 ADRP+ADD 在 `0x32xxx`（`0x032250`）等。`failed to inspect wrapper.node` @ `0x0441d8`。

---

## 6. 原版 attach 算法 —— 精确伪代码（syscall 参数级）

```c
/* ===== 常量 ===== */
#define PTRACE_CONT       0x7
#define PTRACE_ATTACH     0x10
#define PTRACE_DETACH     0x11
#define PTRACE_SYSCALL    0x18
#define PTRACE_GETREGSET  0x4204
#define PTRACE_SETREGSET  0x4205
#define PTRACE_SEIZE      0x4206
#define PTRACE_INTERRUPT  0x4207
#define NT_PRSTATUS       1
#define TID_SIZE          272          /* 0x110 */
#define LOAD_TIMEOUT_NS   20000000000LL  /* 0x4a817c800 = 20 s  */
#define PROOT_TIMEOUT_NS  2000000000LL   /* 0x77359400  = 2 s   */
#define WAIT_FLAGS        (__WALL | WNOHANG)  /* 0x40000000 | 1 */

/* ===== 主流程 ===== */
bool load_module_manual(pid_t pid, const char* dylib, Out* out, string* err) {
    auto t0    = steady_clock::now();
    auto deadline = t0 + LOAD_TIMEOUT_NS;

    Session s{};
    s.pid        = pid;                       /* +0  */
    s.isTraced   = tracer_pid_of_self() != 0; /* +4, 0x14e84 */
    s.savedRegs  = calloc(1, 512);            /* +8, 0x26dec */
    s.deadline   = deadline;                  /* +56 */
    /* 0x21748 */

    /* --- 1. 选 trampoline --- */
    if (!select_trampoline(&s, err)) return false;      /* 0x21814 */

    /* --- 2. 远程分配 --- */
    uint64_t img  = remote_mmap(&s, /*len=*/imgLen, PROT_RW(3), MAP_PRIVATE|MAP_ANON(0x22), -1, 0);
    uint64_t b1   = remote_mmap(&s, 0x1000, 3, 0x22, -1, 0);
    uint64_t b2   = remote_mmap(&s, 0x10000, 3, 0x22, -1, 0);
    if (!img || !b1 || !b2) { *err = "remote mmap failed"; return false; }

    /* --- 3. 手动映射 .so 镜像并跑重定位 --- */
    if (!manual_map(&s, dylib, img, &handle, err)) return false;   /* 0x1cdd8 */

    /* --- 4. 解析载荷入口 --- */
    uint64_t start_fn = remote_dlsym(&s, img, "snowluma_linux_hook_start_dynamic", err);
    uint64_t stop_fn  = remote_dlsym(&s, img, "snowluma_linux_hook_stop_dynamic",  err);
    /* 顺带解析 __register_frame / __deregister_frame */

    /* --- 5. 先跑 init_array 里每一个 init --- */
    for (size_t i = 0; i < n_pairs; ++i) {
        remote_call(&s, p[i].init + img_base, /*args*/(void*)0, 0, err);
    }

    /* --- 6. 再调 start_dynamic --- */
    uint64_t rv = 0;
    if (!remote_call(&s, start_fn, /*args*/nullptr, 0, &rv, err)) return false;
    if (rv == 0) { *err = "remote hook start returned 0"; return false; }

    out->base = img; out->entry = start_fn; out->fini = stop_fn;
    return true;
}

/* ===== 线程枚举 0x16bc4 ===== */
void enumerate_threads(pid_t pid, vector<int>* out) {
    DIR* d = opendir("/proc/<pid>/task" /* 0x429da */);
    if (!d) { *err = "failed to read /proc/" + pid; return; }
    while ((e = readdir(d))) {
        if (!is_all_digits(e->d_name)) continue;   /* 0x16e5c..0x16e7c */
        errno = 0;
        long v = strtol(e->d_name, &end, 10);      /* 0x16ea0 */
        if (errno || *end) continue;
        if (v > 0) out->push_back((int)v);         /* 0x16ecc..0x16ee0 */
    }
    closedir(d);
}

/* ===== 线程打分 0x16a14 ===== */
int thread_score(int tid) {
    string w = read_wchan(tid);                    /* 0x16330: /proc/<tid>/task/<tid>/wchan */
    if (w.empty())        return 0;                /* 0x16a30/0x16a94 */
    if (w == "0")         return 0;                /* 0x16a38..0x16a48 compare("0") */
    if (w.find("syscall")           != npos) return 100;  /* 0x16a4c */
    if (w.find("do_epoll")          != npos ||
        w.find("poll_schedule")     != npos ||
        w.find("do_sys_poll")       != npos ||
        w.find("do_select")         != npos) return  90;  /* 0x16a6c..0x16b20 */
    if (w.find("hrtimer_nanosleep") != npos ||
        w.find("nanosleep")         != npos) return  80;  /* 0x16b28..0x16b68 */
    if (w.find("futex_wait")        != npos) return  70;  /* 0x16b70..0x16b94 */
    if (w.find("schedule_timeout")  != npos) return  60;  /* 0x16b9c..0x16bbc */
    return 0;
}
/* read_wchan: open(路径, O_CLOEXEC /*0x80000*/); read(fd, buf, 127); close(fd) */
/*   0x016854 w1=0x80000 ; 0x016880 w2=0x7f ; 0x016890 close */

/* ===== 单线程 attach 0x23a3c ===== */
bool attach_one_thread(Session* s, int tid, string* err) {
    /* ---- SEIZE 优先，payload addr=data=0 ---- */
    if (ptrace(PTRACE_SEIZE, tid, 0, 0) == 0) goto attached;

    /* SEIZE 失败 */
    if (s->isTraced) {
        int e = errno;
        if (e == EPERM /*1*/ || e == ESRCH /*3*/) {
            /* ---- PRoot 回退：用本进程 libc 的 syscall 做远程 syscall 执行器 ---- */
            uint64_t sc;
            if (!proot_resolve_symbol(s, "syscall", &sc, err))
                return false;                      /* 0x23afc → 0x158c8 */
            if (ptrace(PTRACE_ATTACH, tid, 0, 0) != 0) {
                *err = "PRoot PTRACE_ATTACH failed";  /* 0x23b24 */
                return false;
            }
            goto attached;
        }
        /* errno >= 95 等其它情形 */
    }
    *err = "PTRACE_SEIZE failed";                  /* 0x23aa0 */
    return false;

attached:
    s->tids.push_back(tid);                        /* 0x23b58 */
    s->curTid        = tid;                        /* 0x23c00 */
    s->stoppedByCont = false;                      /* 0x23c04 */
    if (!s->regsSaved) {
        if (ptrace(PTRACE_INTERRUPT, tid, 0, 0) != 0) {   /* 0x23c60 */
            *err = "PTRACE_INTERRUPT failed";      /* 0x23c80 */
            detach_all(s, nullptr);                /* 0x23cc0 → 0x220bc */
            return false;
        }
    }
    s->seized = true;                              /* 0x23c20 */
    if (!wait_stop(s, tid, /*timeout*/deadline, err)) {   /* 0x23018 */
        rollback(s);                               /* 清 tids/curTid/seized/hasStopped */
        return false;
    }
    return true;
}

/* ===== 等 stop 0x23018 / 0x17504 ===== */
bool wait_stop(Session* s, int tid, tp deadline, string* err) {
retry:
    if (!wait_one(&s->status, WAIT_FLAGS, deadline, err))       /* 0x17504 */
        return false;
    if (s->regsSaved == 0) return true;
    if (WSTOPSIG == SIGSTOP(0x13))  return true;                /* 0x23064 */
    if (WSTOPSIG != SIGTRAP+0x80)   goto resume;                 /* 0x2306c/0x23070 */
    if (!s->hasStopped)             goto resume;
    /* SIGTRAP|0x80 = syscall-stop：读 x8 判断是否 < 0x1000 */
    GETREGSET(s->curTid, &regs);                                 /* 0x230cc */
    if (regs[8 /*x8, syscall nr*/] < 0x1000) { s->status = 0; }
resume:
    if (ptrace(PTRACE_CONT, s->curTid, 0, WSTOPSIG) != 0) {      /* 0x230f8 w0=7 */
        *err = "PRoot resume while awaiting SIGSTOP failed";     /* 0x2313c */
        return false;
    }
    s->stoppedByCont = false;
    goto retry;
}

/* ===== 远程调用 0x2034c ===== */
bool remote_call(Session* s, uint64_t fn, const uint64_t* args, size_t nargs,
                 uint64_t* out, string* err)
{
    if (steady_clock::now() >= s->deadline) { s->timedOut = 1; *err = <timeout>; return false; }
    if (!s->hasStopped)                     { *err = "trace session has no saved registers"; return false; }
    if (fn == 0)                            { *err = "remote function address is 0"; return false; }

    if (!s->savedRegs) s->savedRegs = calloc(1, 512);            /* 0x26dec */
    XRegs blk;
    prepare_call(&blk, args, fn);            /* 0x26fd4 */
    /*   blk.x[0..3] = args[0..3]
         blk.pc      = fn            (+256 = pc 槽)   ← 注意：写的是 pc，不是 x30
         blk.x[30]   = 0             (+240 = LR 槽)   ← LR = 0，靠 ret 跳 0 自陷
         blk.sp      = (saved_sp - 0x80) & ~0xF   (+248)          */

    if (!remote_read(s, fn, &tmp, 8, err)) return false;         /* process_vm_readv 0x203fc */
    if (!remote_write(s, &blk, sizeof(blk), s->curTid, err)) {   /* process_vm_writev 0x20448 */
        if (!ptrace_write(s, fn, &blk, 8, err)) {                /* PTRACE_POKEDATA 回退 */
            *err = "PTRACE_PEEKDATA failed"; return false;
        }
    }
    if (ptrace(PTRACE_SETREGSET, s->curTid, NT_PRSTATUS(1), &blk) != 0) {
        *err = "PTRACE_SETREGSET failed"; return false;
    }
    if (ptrace(PTRACE_CONT, s->curTid, 0, 0) != 0) {             /* 0x20484 */
        *err = "PTRACE_CONT failed";  recover(s); return false;  /* 0x20498 */
    }
    s->stoppedByCont = true;                                     /* 0x208ac */

    /* ---- 轮询 ---- */
    XRegs stopped;
    for (;;) {
        int r = wait_one(&st, WAIT_FLAGS, s->deadline, err);      /* 0x208e8 → 0x17504 */
        if (r < 0) { *err = "target wait failed"; return false; }
        if (r == 2) { s->timedOut = 1; *err = <"component recovery timed out">; return false; }
        if (WIFEXITED(st) || WIFSIGNALED(st)) {                   /* 0x208fc/0x20908 */
            *err = "target process ended";                        /* 0x209f0 */
            recover(s); return false;
        }
        if (WSTOPSIG(st) != SIGSTOP) {
            if ((st >> 8 & 0xff) == SIGTRAP+0x80) { /* syscall-stop，放过去 */
                if (x8 >= 0x1000) goto resume;
            }
            if ((st & 0xff) != 0x7f) { resume: ; ptrace(PTRACE_CONT, tid, 0, WSTOPSIG); continue; }
        }
        /* 到了我们制造/预期的 stop */
        if (!GETREGSET(s->curTid, &stopped)) {                    /* 0x2092c → 0x26e58 */
            *err = "failed to read registers after remote call";  /* 0x20a50 */
            recover(s); return false;
        }
        if (regs[8] == SIGTRAP+0x80 && (regs[8] >> 8 & 0xff) == 0xb) {  /* 0x20948/0x20950 */
            /* pc<0x1000 已在上面的 SIGSEGV 判定里通过 */
            if (out) *out = stopped.x[0];                      /* 0x20a68/0x20a6c/0x20a70 */
            remote_write(...); recover(s); return true;
        }
        if (!s->seized || sig == 0x17 /*SIGCHLD? 0x17=23*/) {
            if ((st & 0xfd00) == 0x1100) goto resume;
            *err = "remote call stopped with signal " + sig;  /* 0x20ac0 */
            recover(s); return false;
        }
        goto resume;
    }
}

/* ===== 恢复 0x22a1c / 0x22cb4 ===== */
void recover(Session* s) {
    if (s->stoppedByCont) {
        /* 残余栈指针写回 */
        if (!remote_write(s, saved_sp_addr, &s->savedSp, 8, nullptr))
            if (!ptrace_write(...)) append(s->err, "; stack restore: " + detail);
    }
    if (s->savedRegs && s->savedRegs->x0 == 0)
        append(s->err, "; recovery: " + detail);                  /* 0x22bc8 */
    if (!setregs(s->curTid, s->savedRegs))                        /* 0x22d70 */
        append(s->err, "ptrace register restore failed");
    /* 把被改写的指令字节写回，然后逐个 DETACH */
    detach_all(s, err);                                           /* 0x220bc */
}

/* ===== DETACH 0x220bc ===== */
void detach_all(Session* s, string* err) {
    for (tid in reverse(s->tids)) {                 /* 0x22120..0x22138 */
        if (ptrace(PTRACE_DETACH /*0x11*/, tid, 0, 0) != 0       /* 0x2213c..0x22148 */
            && errno != ESRCH /*3*/) {                           /* 0x22158 */
            *err = "PTRACE_DETACH failed";                       /* 0x22168 */
            return;
        }
    }
}
```

---

## 7. 「未证实」清单（诚实交代）

| # | 结论 | 我做了什么 / 卡在哪 |
|---|---|---|
| 1 | ~~返回值在 `pc` 槽里~~ | **已解决**（见 §3.3）：初读把 `0x26fc0`（`ldr x0,[x0,#256]` = 读 **pc**）当成了取返回值，实际它只用于**判定** `pc < 0x1000`；**返回值来自 `0x26fc8`（`ldr x0,[x0]` = 读 x0）**。机制 = `pc=fn` + `x30=0` → 函数 `ret` 跳 0 → SIGSEGV → 判 `sig==11 && pc<0x1000` → 取 `x0`。【确认】 |
| 2 | ~~排序比较器用的是 tid 而非 score~~ | **已推翻**：初读看错字段偏移。实际 `(tid@+0, score@+4)`，比较器全部读 **`+4`（score）**，插入排序内层 `cmp pivot.score, prev.score; b.gt` → **降序（分高优先）**。`tid` 只在 score 相同时按 `std::sort` 的不稳定性决定，**没有保证**。见 §2.4 第 4 点。 |
| 3 | ~~`0x21814` 成功后立刻 DETACH~~ | **已推翻**：初读把 `0x21af0 bl 0x220bc` 当成成功路径，实际它是 `GETREGSET` 失败后的清理。成功路径 `0x21ae4 tbnz → 0x21c68`（置 `hasStopped`）→ `0x21d48 return true`，**不 detach**。【确认】 |
| 4 | 远程 scratch buffer 是否泄漏 | 【未证实】只看到镜像 base 被 `munmap`（`0x1f2d8`），没找到 `0x1000`/`0x10000` 那两块的 `munmap`。 |
| 5 | `ep_poll`（`0x42977`）如何被用到 | 它没有 ADRP+ADD xref。推测是 `do_epoll` 的 `find` 覆盖到，或者是个未被引用的死字符串。 |
| 6 | `0x1e1bc` 清零的那个 `{init,fini}` 数组具体是谁的 | 【确认】它是「8 个地址对的数组，位于 `x8+216`，stride 0x10」，`0x1e1bc` 只做 `memset(ptr, 0, min(...))`。**没弄清是 `DT_INIT_ARRAY` 还是它自己的调用表**。 |
| 7 | 三次远程 `mmap` 第一次的 len | `0x1e494 ldr x2,[sp,#1120]` —— 具体是什么我没回溯清（大概率是 ELF 镜像总大小，但未证）。 |

---

## 8. 与我们 `remote.cc` 的差距（结论性建议）

父 agent 说我们的现状：`PTRACE_ATTACH`/`PTRACE_SEIZE` 都 EPERM（后来定位到僵尸 tracer），以及我们的实现是「mmap scratch，前 64 B 放 `brk` sled 作返回地址，后 128 KB 作栈，用完泄漏不释放」。

### 8.1 必须改的（能直接决定成败）

1. **不要 attach `pid`，要 attach 单个 `tid`；且必须 `PTRACE_SEIZE` 优先。**
   ```c
   ptrace(PTRACE_SEIZE, tid, 0, 0)   // ← addr=0, data=0，与原版 0x23a60..0x23a70 完全一致
   ```
   **这是父 agent 那个 EPERM 的正解，而且有实证支撑**：`TracerPid` 是 **per-thread** 的。
   我在自建 4 线程目标上实测（§2.6）：
   - t2 被 SEIZE 后，`/proc/t2/status` 的 `TracerPid` 变成 tracer pid，**但 t3/t4/主线程仍是 0**；
   - 对已 seize 的 t2 再 SEIZE → `EPERM(1)`；对 t3、对主线程 SEIZE → **成功**。
   → 所以「僵尸 tracer 钉住某个线程」只会让**那个 tid** 不可用。**逐个 tid 试 + 换人重试 = 天然免疫**。
   → 反之，用 `PTRACE_ATTACH` 打「进程」语义（内核按线程组处理、且对已被 trace 的目标恒 EPERM、不会自动换人），就是死路。

   - SEIZE 成功后必须先 `PTRACE_INTERRUPT`（`0x4207`）把线程停下来，再 `waitpid(tid, __WALL|WNOHANG)`，**不要假设 SEIZE 后线程已停**（SEIZE 本身不产生 stop 事件）。

2. **自己做线程枚举 + 逐个重试，别指望「一次 attach 整进程」。**
   - `opendir("/proc/<pid>/task")` → `readdir` → 纯数字名 → `strtol` → `>0`。
   - **跳过 `tid == pid`**（原版 `0x21974` 明确这么做）。
   - **按 score 降序**顺序试（epoll/poll 线程优先，§2.4 第 4 点），**失败就试下一个**，受 20 s 总 deadline 约束；全失败才报错。
     > 但注意：**「打分」是可选的**。我们自己实现时如果懒得读 `/wchan`，退化成「随便挑一个非主线程 tid、失败就换下一个」也能工作 —— 打分只是提高首次命中率，不影响正确性。
   - 这套流程的唯一价值就是容错：bad 线程跳过、换下一个。
   > 反过来说：如果你们确认 QQ 上现在已经没有僵尸 tracer，**「直接 SEIZE 一个固定 tid」也能work**；但这不具备鲁棒性，换个环境（别的调试器/上一次崩溃残留）就又 EPERM。**建议照原版做，成本很低。**

3. **超时/退避策略**：原版 `waitpid(…, __WALL|WNOHANG)` + `nanosleep` 轮询（`0x17564` 的 flags = `1|0x40000000`，`0x1758c` `nanosleep`），deadline 20 s 总、PRoot 2 s。我们如果用**阻塞式 `waitpid`**，一旦目标没停就会永久卡住 —— 这也是原版绝不用阻塞 wait 的原因。**这条比看起来重要**：我自己写 demo 时 `p.wait()` 就挂死过一次（SEIZE 了但没 continue/detach）。

4. **`brk` sled 可以删掉 —— 原版用的是「`LR=0` 自陷」，而且我已经把它完整证实了**（§3.3）：
   原版【确认】全库 `brk`=0、`hlt`=0。它把 **`pc = fn`**、**`x30 (LR) = 0`**，函数 `ret` 就跳到地址 `0`，内核自然地送一个 `SIGSEGV`。
   ```c
   // 原版（0x26fd4）
   blk.pc    = fn;                        // +256
   blk.x[30] = 0;                         // +240   ← 关键
   blk.sp    = (saved_sp - 0x80) & ~0xF;  // +248
   blk.x[0..3] = args[0..3];              // +0..+24
   ```
   判定：
   ```c
   // 0x20934..0x20954
   if (stop_sig == SIGSEGV /*11*/ && regs.pc /*via 0x26fc0 = ldr x0,[x0,#256]*/ < 0x1000)
       result = regs.x[0] /*via 0x26fc8 = ldr x0,[x0]*/;   // 0x20a68..0x20a70
   ```
   **好处**：不用在目标里放任何自造指令，不用 `mprotect` 可执行，不用找 RWX 页，也不用 mmap 任何栈 —— 你们的 `brk` sled + 128 KB 栈 + 泄漏可以一并省掉。
   **要补的**：原版只看 `pc < 0x1000`，**建议你们再加 `si_addr < 0x1000`**（用 `PTRACE_GETSIGINFO`），否则目标自己的低地址 `SIGSEGV` 会被误判成「调用返回」，静默返回垃圾值（§3.3 末段）。

### 8.2 建议改的（语义对齐，降低真机翻车率）

5. **栈不要 mmap 128 KB，用「目标线程原栈向下让 128 B、16 对齐」**（`0x2701c`–`0x27020`）：
   ```c
   blk.sp = (saved_sp - 0x80) & ~0xF;      // +248
   blk.x[30] = fn;                          // +256（同时也是结果槽）
   ```
   - 优点：不占目标地址空间、不需要恢复 mmap、不会留下 128 KB 垃圾。
   - 风险：`start_dynamic` 若用栈较深（它起 `pthread_create` + `bind`，实测栈用量可能超过 128 B）会踩坏目标线程栈。**原版用 128 B 说明它赌 `start_dynamic` 第一层不深**。
   - **实测数据**：我验证用的测试函数栈用量 < 128 B，`sp=(saved-0x80)&~0xF` 完全够。但 `start_dynamic` 会 `pthread_create` + `bind`，第一层帧如果是 `sub sp,sp,#0x200` 那种就会踩到目标线程自己的栈数据 —— **原版赌的是它第一层不深**。
   - **折中建议**：保留 mmap 栈（安全），但把 `pc`/`x30` 改成原版语义（`pc=fn, x30=0`），并在调用后 `munmap`（或至少记录在手柄里，让 `unload` 释放）。不要把 128 KB 泄漏当特性。

6. **加 `PTRACE_O_EXITKILL`（`0x100000`）**：原版**没有**（我确认 `x3=0` 且全库搜索 `0x100000` 在 ptrace 上下文中不存在）。这是原版的一个**缺陷**：如果注入器崩了，目标线程会永久停在断点。建议我们加上，用 `PTRACE_SEIZE(tid, 0, PTRACE_O_EXITKILL)` 或在 SEIZE 后补一次 `PTRACE_SETOPTIONS`。
   > 但注意：**如果目标是 QQ，`EXITKILL` 意味着注入器退出 = QQ 线程被杀。** 要么别加，要么只在调试构建里加。原版不设它可能是有意的。

7. **`waitpid` 的 `__WALL` 必须带**（`0x17570` 的 `movk w2,#0x4000,lsl#16`）：非 `__WALL` 时对 SEIZE 的线程可能拿不到 stop 事件。

8. **错误信息别学原版**：它的 `; stack restore: ` / `; recovery: ` / `; register restore: ` 全是**恢复阶段的失败追加串**（拼接进 `+64` 的 error string），不是方法论标记。我们的错误串可以更直白，但**语义上要保留「恢复也失败了」这个区分** —— 因为「远程调用失败」和「远程调用失败且恢复也失败（目标可能已损坏）」是完全不同严重度。

### 8.3 关于 `PRoot` 那套

9. **不需要实现**。触发条件（`s->isTraced`）要求**注入器自己正被 ptrace**（即我们跑在 PRoot/qemu-user 下）。我们是原生 aarch64 上跑 node，`TracerPid == 0`，这个分支永远不进。
   - 唯一值得借鉴的：它用 `PTRACE_SYSCALL`(0x18) + `getcwd` 当 liveness 探针（`0x2486c` `PRoot detach did not observe getcwd exit`）。如果我们将来需要「确认目标真的执行了某个 syscall」，这是一个干净的做法。

---

## 9. 一页速查（贴到 `remote.cc` 旁边）

```
attach:   ptrace(PTRACE_SEIZE=0x4206, tid, 0, 0)        // 单 tid！不传 options
          fail EPERM/ESRCH & self-is-traced → PRoot 回退（我们不需要）
          fail 其它 → "PTRACE_SEIZE failed"
          ok → ptrace(PTRACE_INTERRUPT=0x4207, tid, 0, 0)
             → waitpid(tid, &st, __WALL|WNOHANG) 轮询 + nanosleep
选择:     opendir("/proc/<pid>/task") → 纯数字 → strtol → >0
          跳过 tid==pid；打分只看 /proc/<tid>/task/<tid>/wchan
          排序键 = score（高32位），**降序**（100 分的 epoll 线程先试）  ← 推断·强
          逐个试，20s deadline，全失败 → "no thread could be attached as trampoline"
             （一个线程都没有 → "target process has no task threads"）
调用:     GETREGSET(0x4204, tid, NT_PRSTATUS=1, &regs272)
          备份 regs272 → calloc(512)
          blk = regs272 的副本
          blk.x[0..3] = args[0..3]                 (+0..24)
          blk.pc      = fn                          (+256)
          blk.x[30]   = 0                           (+240)  ← LR=0，ret 跳到 0 触发 SIGSEGV
          blk.sp      = (saved_sp - 0x80) & ~0xF    (+248)
          remote_write(blk)      // process_vm_writev → PTRACE_POKEDATA 回退
          SETREGSET(0x4205, tid, NT_PRSTATUS, &blk)
          ptrace(PTRACE_CONT=0x7, tid, 0, 0)
          轮询 waitpid(__WALL|WNOHANG)：
            WIFEXITED/WIFSIGNALED → "target process ended"
            sig==SIGTRAP|0x80     → 是 syscall-stop，CONT(WSTOPSIG) 放过去
            其余 stop             → 跳出
          GETREGSET → 判定 sig==SIGSEGV && regs.pc < 0x1000
                      *result = regs.x[0]
          ★ 这条已在 aarch64 实测通过（§3.3）：
            sig=11, si_addr=nil, pc=nil, x0=返回值 —— 完全吻合
          建议加强：再查 si_addr < 0x1000（PTRACE_GETSIGINFO），防误判
恢复:     remote_write 写回 saved_sp；SETREGSET 写回整块 regs272；
          写回被改的指令字节；对每个 tid：ptrace(PTRACE_DETACH=0x11, tid, 0, 0)
          任何一步失败 → 往 error 串里追加 "; stack restore: " / "; recovery: " /
                                        "; register restore: "
内存:     remote_mmap = 远程 libc.mmap(addr=0, len, prot=3, flags=0x22, fd=-1, off=0)
          载荷镜像 由 remote_mmap 分配；unload 时 remote_munmap
          scratch/栈：原版不 mmap 栈（用 128B 原栈），是否有 mmap scratch 未证实
```

---

## 附：复现所需的本地产物

| 文件 | 内容 |
|---|---|
| `~/probe.node` | 原版副本（md5 `8786a929…`） |
| `~/probe.dis` | `aarch64-linux-gnu-objdump -d` 全量反汇编（63,916 行） |
| `~/rev/annot.dis` | **带 `.rodata` 字符串内联注释 + 函数边界**的反汇编（63,341 行）—— 本文所有地址可在此核对 |
| `~/rev/elf.py` | 分析库（读 ELF、`func_of()`、`xrefs()`） |
| `~/rev/pairs.json` | 762 个 ADRP+ADD 对 |
| `~/rev/fstarts4.json` | 427 个函数起始地址 |
| `~/funcs.json` | 436 个 `.eh_frame` FDE 起点（原始，未去碎片） |

复现命令：
```bash
aarch64-linux-gnu-objdump -d --no-show-raw-insn ~/probe.node > ~/probe.dis
cd ~/rev && python3 -c "import elf; print(elf.fname(0x21814), elf.strat(0x43809))"
grep -n -A40 '## FUNC 0x21814' ~/rev/annot.dis | head -60
```