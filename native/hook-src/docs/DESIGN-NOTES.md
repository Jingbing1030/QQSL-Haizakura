# 关键设计决策

每条都回答「为什么这样，而不是那样」。凡是有实测结果的，写明是怎么测的。

---

## 1. 为什么用 `PTRACE_SEIZE` 而不是 `PTRACE_ATTACH`

```cpp
// src/remote.cc:71-89
void RemoteProcess::seize() {
  // PTRACE_SEIZE does not stop the tracee and is preferred; PTRACE_ATTACH is the
  // fallback for kernels or sandboxes that reject SEIZE (some container runtimes
  // do, which is why the original binary has PRoot-specific error paths).
  if (::ptrace(PTRACE_SEIZE, pid_, nullptr, nullptr) == 0) {
    // Ask for a stop only when we actually need to touch registers.
    return;
  }
  const int seize_errno = errno;

  if (::ptrace(PTRACE_ATTACH, pid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_SEIZE and PTRACE_ATTACH both failed for pid %d: %s", pid_,
                std::strerror(seize_errno)));
  }
  int status = 0;
  if (::waitpid(pid_, &status, __WALL) < 0) {
    fail(format("target wait failed for pid %d: %s", pid_, std::strerror(errno)));
  }
}
```

### 为什么 SEIZE

`PTRACE_ATTACH` 会**立即向目标发送 SIGSTOP**。对一个正在跑 MSF 心跳的 QQ 进程来说，这有两个后果：

1. **目标在网络层面掉线**。attach 之后到我们 `PTRACE_DETACH` 之前，目标整体不执行任何指令。
   整个映射 + 重定位 + init 链路，实测在本机是几十毫秒量级；但如果目标当时在等某个
   futex，SIGSTOP 的注入时机会被拉长。心跳超时就是掉线。
2. **SIGSTOP 是可观察的**。观察者（其他监控、目标自己的信号处理）能看到一次真实的
   SIGSTOP/SIGCONT 往返。SEIZE 不产生信号。

`PTRACE_SEIZE` 的关键差别是**附加但不停止**：目标继续跑，直到我们主动
`PTRACE_INTERRUPT`。所以整个流程变成「附加（目标无感）→ 需要碰寄存器时才中断 → 做完还原 → 解除」。

这也是 `stop_target()` 里那段状态判断存在的原因：

```cpp
// src/remote.cc:289-306
void RemoteProcess::stop_target() {
  if (!attached_) attach();

  if (saved_ == nullptr) saved_ = new SavedRegs();
  if (saved_->valid) return;  // already stopped by us

  // SEIZE leaves the tracee running; INTERRUPT then asks it to stop and we block
  // until the stop notification arrives.
  if (::ptrace(PTRACE_INTERRUPT, pid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_INTERRUPT failed for pid %d: %s", pid_, std::strerror(errno)));
  }
  wait_for_stop();

  if (::ptrace(PTRACE_GETREGS, pid_, nullptr, &saved_->regs) != 0) {
    fail(format("PTRACE_GETREGS failed for pid %d: %s", pid_, std::strerror(errno)));
  }
  saved_->valid = true;
}
```

`saved_->valid` 让「已停住」成为一个显式状态：`remote_mmap` 和 `remote_call` 会连续调用
`stop_target()`，只有第一次真正发 `PTRACE_INTERRUPT` 并 `GETREGS`。后续调用直接复用，
避免对已停止的进程重复 INTERRUPT（那会等一个永远不来的 stop 通知）。

### 为什么必须有回退路径

`PTRACE_SEIZE` 不是所有环境都接受：

- 内核 < 3.4 没有这个请求（现在的 QQ 环境不会是这种，但容器镜像可能很旧）。
- **seccomp 过滤器**可能只放行 `PTRACE_ATTACH`（一些 sandbox profile 按请求号白名单）。
- **容器运行时**的 `ptrace` 中介层。

回退到 `PTRACE_ATTACH` 后必须补一次 `waitpid`——ATTACH 会把目标停下并投递 SIGSTOP，
不消费这个 stop 通知，后续所有 ptrace 调用都会错位。

### PRoot 的意义

上游二进制的错误串里有 `PRoot PTRACE_ATTACH failed`。PRoot 用 ptrace 实现用户态
`chroot`，而一个 tracee 只能有一个 tracer。QQ 若跑在 PRoot 里，我们的
`PTRACE_SEIZE`/`ATTACH` 会直接被外层 PRoot 挡掉。

上游为这条路径专门写了错误分支，说明这不是理论情况。我们保留了同样的回退结构，
但**没有**实现「穿透 PRoot」的能力——如果外层 PRoot 占着 ptrace，我们无法注入。
当前行为是报出一个明确的错误而不是静默失败。

---

## 2. 为什么 syscall 跳板要扫描**可执行区域**

```cpp
// src/remote.cc:327-354
void RemoteProcess::ensure_syscall_site() {
  if (syscall_site_valid_) return;

  // The trampoline must live in a mapping that is actually executable, otherwise
  // the target faults the moment we redirect its instruction pointer there.  Walk
  // /proc/<pid>/maps and scan only executable file-backed regions containing libc.
  const auto regions = executable_regions_of("libc");
  if (regions.empty()) fail("cannot locate an executable libc mapping in the target");

  uint8_t buf[4096];
  for (const auto& [start, end] : regions) {
    for (uint64_t addr = start; addr + sizeof(buf) <= end; addr += sizeof(buf) - 1) {
      const size_t n = read(addr, buf, std::min<size_t>(sizeof(buf), end - addr));
      if (n < 2) break;
      for (size_t i = 0; i + 1 < n; ++i) {
        if (buf[i] == kSyscallOpcode[0] && buf[i + 1] == kSyscallOpcode[1]) {
          syscall_site_ = addr + i;
          syscall_site_valid_ = true;
          return;
        }
      }
      if (n < sizeof(buf)) break;
    }
  }
  fail("failed to locate a syscall instruction in the target's libc");
}
```

### 踩过的坑（实测）

最初的写法是「拿 libc 的基址，从基址往后扫一段，找 `0f 05`」。这在 `libc.so.6` 上
**会扫到数据段里的假 `0f 05`**：

- `0f 05` 只有两个字节，在任何足够大的二进制数据里出现是必然的，不是小概率事件。
  浮点常量、UTF-8 文本、压缩过的字符串、跳转表偏移，都可能拼出 `0f 05`。
- libc 的数据段（`.rodata`、`.data.rel.ro`）里就有这样的字节序列。
- 扫到之后我们把目标 `rip` 指过去，`PTRACE_SINGLESTEP`。如果那块页**不可执行**，
  CPU 在取指阶段就 `SIGSEGV`，而且是在目标的上下文里——表现为目标莫名崩溃，
  而我们的调用栈上什么也看不到。
- 即使那页可执行（`.rodata` 在有些映射下与代码同页），执行到的也不是 `syscall`，
  而是半条指令，行为完全不可预测。

### 正确做法

两个约束**同时**满足：

1. 只扫 `/proc/<pid>/maps` 里 `perms[2] == 'x'` 的区域。
2. 只扫路径包含 `libc` 的那些行。

```cpp
// src/remote.cc:640-666（executable_regions_of 的关键判断）
    const std::string perms = line.substr(space + 1, 4);
    if (perms.size() < 3 || perms[2] != 'x') continue;  // need --x

    const size_t slash = line.find('/');
    if (slash == std::string::npos) continue;
    if (line.find(soname, slash) == std::string::npos) continue;
```

`perms[2]` 是 `rwx` 三元组的第三位，即执行位。`perms.size() < 3` 的检查是必要的：
`maps` 里存在没有权限串的畸形行。

扫描窗口按 4096 字节、步进 `sizeof(buf) - 1`，是为了**跨块边界**不漏掉
正好落在块末尾的 `0f 05`。这个 `-1` 很容易漏写。

实测确认：本机 `libc.so.6` 上第一个命中在 `libc_base + 0x28902`，位于
`__libc_do_syscall`/`syscall` 附近的可执行段内：

```
[hz] syscall gadget at 0x7f8f20428902
[hz] after syscall rax=0x7f8f20ad1000 rip=0x7f8f20428904 (expected rip 0x7f8f20428904)
```

`rip` 停在 `site + 2`，正是 `syscall` 指令之后，符合预期。

### 同样的坑存在于 aarch64 分支

aarch64 版本（`src/remote.cc:414-432`）仍然只做了「找 libc 基址 + 从基址扫 1MB」，
**没有**用 `executable_regions_of()`：

```cpp
// src/remote.cc:414-432（aarch64，未修复）
void RemoteProcess::ensure_syscall_site() {
  if (syscall_site_valid_) return;
  const auto base = find_loaded_module("libc");
  if (!base) fail("cannot locate libc in target for syscall trampoline");

  std::vector<uint8_t> buf(4096);
  for (uint64_t off = 0; off < (1u << 20); off += buf.size()) {
    const size_t n = read(*base + off, buf.data(), buf.size());
    ...
```

`svc #0`（`0x01 0x00 0x00 0xd4`）是 4 字节、且要 4 字节对齐才扫，误命中率比 x86 的
`0f 05` 低得多，但「扫进不可执行区域」这个结构性问题一样存在。**这是已知未修复项**，
见 `REWRITE-STATUS.md`。

---

## 3. 为什么 `remote_call` 要用**私有栈**

```cpp
// src/remote.cc:524-529
  // Private stack: rsp % 16 == 0 at the call site so the callee sees rsp % 16 == 8
  // after its implicit return-address push.
  const uint64_t stack_top =
      (region + kScratchSize + kStackSize) & ~static_cast<uint64_t>(0xf);
  regs.rsp = stack_top - 8;
  write_value<uint64_t>(regs.rsp, region);
```

### 借用目标栈会撞上活跃帧

`PTRACE_INTERRUPT` 让目标停在某个**任意**指令边界。此刻 `rsp` 指向的是目标真实调用栈
的当前位置，上面还有若干活跃栈帧（返回地址、保存的 callee-saved 寄存器、局部变量）。

如果直接在 `rsp` 上做「压返回地址 + 跳过去执行」，会出现：

1. **覆盖活跃帧**。callee 的序言（`push rbp; sub rsp, N`）会往低地址写，而那正是
   目标当前帧的局部变量区。目标恢复执行后读到被我们改过的数据——静默的数据损坏，
   比崩溃更难查。
2. **红区（red zone）**。SysV ABI 允许叶子函数用 `[rsp-128, rsp)` 这段不调整 `rsp` 的
   空间。目标可能正用着它。我们压返回地址就是踩红区。
3. **栈溢出余量**。载荷的构造函数可能有较深的调用链。目标栈剩余多少不可知，
   我们借它就把自己的深度算进了目标的预算。
4. **目标自己也在 `malloc`/`pthread_create` 里**。这类函数对 `rsp` 对齐和栈边界有额外假设。

### 私有栈的具体布局

```
region + 0                     : int3 sled（callee 的 ret 落点）
region + 64                    : 私有栈区起点
region + 64 + 128K             : 栈顶（向下增长）
```

`rsp = stack_top - 8`，且 `stack_top` 按 16 字节对齐。于是**调用点** `rsp % 16 == 8`？

看代码：`stack_top` 对齐到 16,`rsp = stack_top - 8`，所以 `rsp % 16 == 8`。
而 SysV ABI 要求**被调用函数入口处** `rsp % 16 == 8`（因为 `call` 压了 8 字节返回地址，
进入函数时 `rsp` 是 `16n+8`）。

这里的做法是：我们不执行 `call` 指令，而是手工把返回地址写到 `rsp` 指向的位置再跳过去。
效果等价于「`call` 刚压完返回地址」。所以 `rsp % 16 == 8` 正是 callee 期望的状态。

> 注意：当前注释写的是「rsp % 16 == 0 at the call site」，与代码实际产生的
> `stack_top - 8`（即 `% 16 == 8`）措辞不一致。以代码行为为准，结论是正确的。

### 返回地址 = int3 sled

```cpp
// src/remote.cc:492-504
  // One allocation serves both purposes:
  //   +0     the instruction the callee returns to (an int3 followed by a nop
  //          sled, so a return to +1 does not fault)
  //   +64    private stack, growing down from the end of the region
  constexpr size_t kScratchSize = 64;
  constexpr size_t kStackSize = 128 * 1024;
  const uint64_t region = scratch_buffer(kScratchSize + kStackSize);

  // A run of int3 so any return address inside the sled traps rather than decodes.
  std::vector<uint8_t> sled(kScratchSize, 0xcc);
  write_exact(region, sled.data(), sled.size());
```

整块 64 字节都填 `0xcc`（不是只填 1 字节），理由是容错：callee 可能因为尾调用优化、
或者我们算错 `argc` 而返回到 sled 内的任意偏移，填满 `int3` 保证任何落点都触发
`SIGTRAP` 而不是把数据当指令解码。

### 先备资源再动寄存器

```cpp
// src/remote.cc:490-500
  // Prepare every memory resource BEFORE touching registers.  scratch_buffer() and
  // write_value() can issue syscalls through the trampoline, which itself stops and
  // resumes the tracee; doing that after we have built a call frame would discard
  // it.
```

这条顺序很关键：`scratch_buffer()` 内部可能调 `remote_mmap` → `remote_syscall6` →
`stop_target()` + `SETREGS` + `SINGLESTEP` + 还原。如果我们在**已经设好** `regs.rip/rsp`
之后才去分配栈，那些 syscall 的寄存器往返会把我们刚建的调用帧冲掉。

### ⚠️ 曾经缺陷（已修）：这块内存原本不可执行

`scratch_buffer()` 早期用 `PROT_READ|PROT_WRITE` 映射，**没有 `PROT_EXEC`**。
而 sled 就在这块内存的首字节，callee 返回时 `rip` 落在这里 → 取指阶段 `SIGSEGV`。

实测（本机 x86_64，地址算术完全吻合）：

```
[hz] remote_call fn=0x7250081f0180 rsp=0x7250081b8038
threw: raised signal 11 at rip 0x725008198000
计算: stack_top - 64 - 128*1024 = 0x7250081b8040 - 0x20040 = 0x725008198000  ← 相等
```

已修：`scratch_buffer()` 现在带 `kProtExec`（`src/remote.cc:248-250`），
`/proc/<pid>/maps` 确认该页是 `rwxp`。

---

## 3.5 最难查的一节：`orig_rax` 不清零会让内核回退 `rip`

这一节单独列出来，因为它是整次重写里**表象最具误导性**的 bug，
并且它是「所有注入调用都在 `fn - 2` 处 SIGSEGV」的唯一根因。

### 现象

```cpp
// 设好寄存器后立刻读回——完全正确
regs.rip = fn;
ptrace(PTRACE_SETREGS, pid_, nullptr, &regs);
// GETREGS 读回: delta from fn = 0     ← 内核接受了
// 但 resume 之后再 GETREGS: rip = fn - 2   ← 偏移了 2 字节
```

故障现场长这样：

```
[hz] applied rip=0x756b1e430180 rsp=0x756b1e1ff038 (wanted 0x756b1e430180/0x756b1e1ff038)
[hz] stop sig=11 rip=0x756b1e43017e (sled 0x756b1e1df000..0x756b1e1df040)
[hz] fault detail: signo=11 code=1 addr=0xdb
[hz] bytes at faulting rip: 00 00 f3 0f 1e fa e9 77 ff ff ff 0f 1f 80 00 00
```

注意 `rip = 0x...180 - 2 = 0x...17e`，而该处字节 `00 00 f3 0f 1e fa` 说明
`f3 0f 1e fa`（`endbr64`）正好从 `fn+0` 开始——**`rip` 落在了函数入口前 2 字节**。

这个偏移量恒为 2，且只体现在「resume 之后」，`GETREGS` 永远读不出来。
极易误判成「`PTRACE_SETREGS` 没生效」「地址算错」「页不可执行」。

### 根因

目标被 `PTRACE_INTERRUPT` 停住时，它可能正卡在一个系统调用上。此刻
`user_regs_struct::orig_rax` **保留着那个系统调用的编号**（`orig_rax` 的语义是
「进入 syscall 时 rax 的原值」，内核用它区分 syscall 的进入/退出）。

实测该值：

```
stopped in pause(): orig_rax=34 (0x22)   rip=0x75fee16a06c6
=> orig_rax == -1 ? NO (dirty)
```

`34` 在 x86_64 上就是 `pause`。**这个残留值取决于目标停在哪里**，不是固定值
（在别的环境里停于 `clock_nanosleep` 时会是 230）。

当我们把 `rip` 改成一个普通函数地址、但 `orig_rax` 仍是非 -1 的残留值时，
内核在恢复执行时认为「这个线程仍在 syscall 中，需要重启该系统调用」，
于是按 ABI 规则执行 **`rip -= 指令长度`**。x86_64 的 `syscall` 指令正好是
**2 字节**（`0f 05`），所以 `rip` 被减 2，落进前一条指令的中间，取指即 `SIGSEGV`。

### 修法

```cpp
// src/remote.cc（remote_call 内）
  regs.rip = fn;
  regs.rsp = new_rsp;
  // Clearing orig_rax marks the tracee as "not inside a syscall".  Without it the
  // kernel still believes a system call is in flight and, on resume, rewinds rip by
  // the length of the `syscall` instruction (2 bytes on x86-64) to restart it --
  // which lands in the middle of the previous instruction and dies with SIGSEGV.
  // This is the single reason every injected call faulted at fn - 2.
  regs.orig_rax = static_cast<uint64_t>(-1);
```

同一处理在 `remote_syscall6` 里也有（那里是相反的需求：它**要**内核把它当 syscall）：

```cpp
// src/remote.cc（remote_syscall6 内）
  regs.rip = syscall_site_;
  // Resume on the instruction after `syscall` so we stop again right away.
  regs.orig_rax = static_cast<uint64_t>(-1);
```

### A/B 验证

同一份源码，只删掉 `regs.orig_rax = -1;` 一行，其余完全不动：

```
=== WITH fix (current source) ===
RESULT=42 (PASS)

=== WITHOUT fix (orig_rax line removed) ===
THREW: call to 0x7b7b95e13000 raised signal 11 at rip 0x7b7b95e12ffe   ← 正好 fn-2
```

这是双向确认：加了就对，去掉就错，且错误形态与线上现象一致。

### 教训

1. **`GETREGS` 读回正确不代表 resume 后正确**。内核在 resume 路径上会基于
   `orig_rax`/`rip` 做修复动作，这部分只发生在 `PTRACE_CONT` 里。
2. **`orig_rax` 是状态，不是输出**。任何手工构造寄存器上下文的地方都必须显式
   设定它，不能指望它「无关」。
3. **偏移量恒为 2 是强线索**。它直接指向 `syscall` 指令长度，而不是指针算错
   （那会给出随机偏移）。
4. 这个 bug 在「直接调 libc 函数」时**不一定**暴露——如果目标恰好不在 syscall 里，
   `orig_rax` 可能是干净的。它高度依赖目标的停点，属于间歇性故障，
   全靠 `HZ_DEBUG` 的 `applied rip` / `stop sig=11 rip=` 两行日志才定位得了。

> aarch64 上等价风险存在但机制不同：aarch64 没有 `orig_rax`，`svc` 是 4 字节。
> 设置 `PTRACE_SETREGSET` 前若 `pc` 处于未完成的 syscall 状态，同样可能被回退 4 字节。
> **当前 aarch64 分支已无实现**（见 `REWRITE-STATUS.md`），此处仅作记录。

---

## 4. 为什么弱符号未解析时按 0 处理

```cpp
// src/manual_loader.cc:147-158
  auto need_external = [&](const DynSymbol& sym) -> uint64_t {
    const auto resolved = resolve_remote_symbol(sym.name);
    if (resolved) return *resolved;

    // A weak undefined symbol is allowed to resolve to zero: that is how
    // _ITM_deregisterTMCloneTable, __gmon_start__ and __cxa_finalize appear in
    // every normal DSO.  Treating them as fatal would reject valid payloads.
    if (sym.bind == 2 /* STB_WEAK */) return 0;

    throw UnresolvedSymbol(
        sym.name, format("failed to resolve remote symbol %s", sym.name.c_str()));
  };
```

### 这不是特例处理，是 ELF 语义

`STB_WEAK` 且 `st_shndx == SHN_UNDEF` 的符号，按 ELF 规范：**找不到定义时值为 0**，
且不构成错误。`ld.so` 就是这么做的。

实测确认这些符号在正常 DSO 里确实是「弱 + 未定义」：

```
$ readelf -sW build/payload.so | grep -E "gmon_start|_ITM|cxa_finalize"
     1: 0000000000000000     0 NOTYPE  WEAK   DEFAULT  UND _ITM_deregisterTMCloneTable
     4: 0000000000000000     0 NOTYPE  WEAK   DEFAULT  UND __gmon_start__
     8: 0000000000000000     0 NOTYPE  WEAK   DEFAULT  UND _ITM_registerTMCloneTable
     9: 0000000000000000     0 FUNC    WEAK   DEFAULT  UND __cxa_finalize@GLIBC_2.2.5
```

（gcc 在这台机器上没装 libitm，所以 `_ITM_*` 无定义；装了的话就能在目标里解析到。）

### 如果当成错误处理会怎样

把弱符号缺失当致命错误，会导致**任何正常编译出来的 `.so` 都无法加载**，因为
`gcc`/`clang` 默认的 CRT 对象（`crtbeginS.o`）总会引用 `_ITM_*` 和 `__gmon_start__`。

换句话说：这不是「宽容一点更好」，而是「严格就是错的」。误杀率不是 1%，是 100%。

### 为什么 0 是安全的值

这三个符号的**使用方式**决定了 0 是安全的：

```asm
; _init 里对 __gmon_start__ 的用法（payload.so 实测反汇编）
1008: mov    0x2fb9(%rip),%rax        # 3fc8 <__gmon_start__>
100f: test   %rax,%rax
1012: je     1016 <_init+0x16>
1014: call   *%rax                    ← 只有非 0 才调用
1016: add    $0x8,%rsp
101a: ret
```

编译器生成的是「非 0 才调用」的保护写法。`register_tm_clones` 对
`_ITM_registerTMCloneTable` 同样是 `test` + `je`（`payload.so:1124-1130`）。
所以填 0 → 分支不跳 → 安全跳过。

反例：把 `__cxa_finalize` 填 0 是否安全，取决于调用点有没有先判空。
`__do_global_dtors_aux` 里是 `cmpq $0x0, ...; je` 保护过的（`payload.so:114e-1159`），
所以安全。**但这不是普适保证**——一个不做判空就直接 `call` 弱符号的载荷，
填 0 会让它跳到地址 0。这是弱符号语义本身的后果，`ld.so` 也一样。

---

## 5. 为什么 N-API 层全部走 `napi_async_work`

```cpp
// src/addon.cc:196-221
template <typename Result, typename Fn, typename ToJs>
napi_value schedule(napi_env env, const char* name, Fn fn, ToJs to_js) {
  auto* w = new Work<Result, Fn, ToJs>(std::move(fn), std::move(to_js));

  napi_value promise = nullptr;
  if (napi_create_promise(env, &w->deferred, &promise) != napi_ok) {
    delete w;
    napi_throw_error(env, nullptr, "failed to create native work promise");
    return nullptr;
  }

  napi_value resource_name = make_string(env, name);
  if (napi_create_async_work(env, nullptr, resource_name, execute_cb, complete_cb, w,
                             &w->work) != napi_ok) {
    delete w;
    napi_throw_error(env, nullptr, "failed to create native work");
    return nullptr;
  }
  if (napi_queue_async_work(env, w->work) != napi_ok) {
    napi_delete_async_work(env, w->work);
    delete w;
    napi_throw_error(env, nullptr, "failed to schedule native work");
    return nullptr;
  }
  return promise;
}
```

### 阻塞事件循环的代价

Node 是单线程事件循环。同步实现里那几十到几百毫秒会**冻结整个 QQ 的 JS 层**：

- QQNT 主进程的 JS 层不只跑我们。Electron 的 IPC、窗口消息、其他 addon 都在这个循环上。
- 冻结期间所有 `setTimeout`/`setInterval` 漂移，`fetch` 回调堆积。
- `PTRACE_INTERRUPT` 后等目标到达安全点的时间**不可控**——目标可能正在一个长循环里，
  或者卡在不可中断的 `read()` 上。这不是「几十毫秒」，可能是秒级。
- 最坏情况：目标正等一个只有 JS 层才能喂的锁，而我们冻着 JS 层 → **死锁**。

### 为什么不用 `napi_sync_work` 或线程

- 纯 `napi_sync_work` 是给 GC 回调用的，不是给用户 API 的。
- 自己起 `std::thread` 也行，但要自己管线程池、生命周期、和 Node 关闭的时序。
  `napi_async_work` 直接复用 libuv 的线程池（默认 4 个），且 `complete_cb` 保证
  在 JS 线程上跑，返回值的构造是安全的（N-API 的 handle 不是线程安全的）。

### 模板化的理由

5 个入口的「建 Promise → 排队 → 跑 → 返回值或拒绝」流程完全相同，只有
（a）返回值类型、（b）工作函数、（c）转成 JS 值的函数不同。模板 `Work<Result, Fn, ToJs>`
把这三者参数化，5 个入口各自只剩几行。

注意 `Work` 的构造函数把 `fn`/`to_js` 注入而不是构造后赋值——捕获了 lambda 的
`std::function` 没有默认构造函数（`src/addon.cc:146-148`）。

### 异常穿过 C ABI 是未定义行为

`execute_cb` 是 C 回调，异常绝不能逃出去：

```cpp
// src/addon.cc:154-165
  void run() override {
    try {
      value = fn();
    } catch (const std::exception& e) {
      error = e.what();
    } catch (...) {
      error = "native work failed with an unknown exception";
    }
  }
```

错误被存进 `WorkBase::error`（`std::string`），在 `complete_cb` 里由 JS 线程
构造成 `Error` 对象并 `napi_reject_deferred`。`hz::Error` 的消息因此能原样传到 JS，
这也是 `DESIGN-NOTES` 里所有 `format(...)` 具体消息的价值所在。

---

## 6. 为什么 `ManualMapHandle.base` 用 bigint

```cpp
// src/addon.cc:36-40
napi_value make_uint64(napi_env env, uint64_t v) {
  napi_value out = nullptr;
  napi_create_bigint_uint64(env, v, &out);
  return out;
}
```

### 地址确实可能超 2^53

JS 的 `Number` 是 IEEE-754 双精度，**整数精确范围是 ±2^53**（约 9.007e15）。
64 位地址空间的上界是 2^64 ≈ 1.8e19，远超这个范围。

本机实测的映射地址还在 2^47 附近（x86_64 用户态典型值）：

```
[hz] init_array runtime contents (2 entries):
[hz]   [0] at 0x7ad3c05efdc8 = 0x7ad3c05ed180  (base+0x1180)
```

`0x7ad3c05ed180` ≈ 1.35e14，**小于 2^53，Number 存得下**。所以「今天不炸」不代表设计对。

会出问题的情况是真实存在的：

- **aarch64 + 48 位 VA 以上**：`0x0000_ffff_ffff_f000` 这类地址，以及
  LAM/57 位 VA 的机器（`0x00ff_ffff_ffff_f000` ≈ 7.2e16 > 2^53）。
- **`MAP_FIXED` 到高位**、或内核把映射放在 `vsyscall`/高半区。
- 一旦超过 2^53，`Number` 会**静默舍入到最近的偶数**——`base` 变成另一个地址，
  `unloadModuleManualAsync` 就会 `munmap` 错误的范围。这是会毁掉目标进程的错误。

### 为什么不用字符串

字符串当然精确，但每次用都要 `BigInt(str)` 或手写解析，且 JS 侧做任何算术
（`base + offset`）都要先转换。`bigint` 是 JS 原生的 64 位整数类型，`+`/`-` 直接可用，
且 `napi_create_bigint_uint64` / `napi_get_value_bigint_uint64` 是对称的。

### 卸载时兼容 Number

```cpp
// src/addon.cc:85-97
  uint64_t out = 0;
  bool lossless = false;
  if (napi_get_value_bigint_uint64(env, prop, &out, &lossless) == napi_ok) {
    return out;
  }
  // Accept a plain number too, so a handle can round-trip through JSON.
  double d = 0;
  if (napi_get_value_double(env, prop, &d) == napi_ok) {
    if (d < 0) hz::fail(hz::format("%s must not be negative", name));
    return static_cast<uint64_t>(d);
  }
  hz::fail(hz::format("%s must be a bigint or number", name));
```

接受 `number` 是为了让 handle 能过 `JSON.stringify`（`BigInt` 不能直接序列化，
`JSON.stringify({b:1n})` 抛 `TypeError`）。代价是走这条路径时**不检查精度损失**——
`lossless` 只在 bigint 分支检查，number 分支的 `double → uint64_t` 转换对
> 2^53 的值仍然是错的。这是已知的取舍。

---

## 7. 已知限制：`DT_INIT` 不执行

### 现状与旧说法不一致

任务背景里说「`DT_INIT` 执行会崩」。**当前代码不走这条路**——它根本不执行 `DT_INIT`：

```cpp
// src/elf_image.cc:284-291（当前实现）
void ElfImage::parse_init_fini() {
  // DT_INIT is deliberately kept apart from DT_INIT_ARRAY.  The `_init` stub that
  // DT_INIT points at assumes it is running inside ld.so's bootstrap: it reads
  // __gmon_start__ and calls it if non-null, then falls through into
  // frame_dummy/register_tm_clones, which touch __TMC_END__ and other symbols the
  // real loader would have fixed up.  Calling it from a manually mapped image
  // faults.  The constructors a payload actually needs live in .init_array.
  if (const auto init = dynamic_value(elf::kDtInit)) legacy_init_ = *init;
```

它被存进单独的 `legacy_init_` 字段（`include/elf_image.h:216`），
只有诊断日志会打印：

```
[hz] image_base=0x0 init_count=2 legacy_init=0x1000
```

`run_init()` 只遍历 `init_fns_`，而 `init_fns_` 现在**只**包含 `DT_INIT_ARRAY`
的条目。所以这是「绕开」，不是「崩」。

### `_init` 到底为什么危险

我把 `payload.so` 的 `_init` 反汇编出来核对过：

```asm
0000000000001000 <_init>:
    1000: endbr64
    1004: sub    $0x8,%rsp
    1008: mov    0x2fb9(%rip),%rax        # 3fc8 <__gmon_start__>
    100f: test   %rax,%rax
    1012: je     1016 <_init+0x16>
    1014: call   *%rax
    1016: add    $0x8,%rsp
    101a: ret
```

**准确地说**：`_init` 本身对 `__gmon_start__` 做了判空，而 `__gmon_start__` 是
`WEAK UND` → 按第 4 节规则填 0 → `test` 失败 → 不调用 → `_init` **其实能安全返回**。

真正的风险在它**后面**被 `DT_INIT` 串起来的东西。`ld.so` 的调用链是
「`_init` → `.init_array` 各项」，而 glibc 的 CRT 把 `frame_dummy` 放在
`.init_array[0]`，`frame_dummy` 又跳进 `register_tm_clones`：

```asm
0000000000001100 <register_tm_clones>:
    1100: lea    0x2f29(%rip),%rdi        # 4030 <completed.0>
    1107: lea    0x2f22(%rip),%rsi        # 4030 <completed.0>
    110e: sub    %rdi,%rsi
    ...
    1124: mov    0x2ead(%rip),%rax        # 3fd8 <_ITM_registerTMCloneTable>
    112b: test   %rax,%rax
    112e: je     1138 <register_tm_clones+0x38>
    1130: jmp    *%rax
```

`register_tm_clones` 计算 `__TMC_END__ - __TMC_LIST__` 的差值来决定要不要注册事务内存
回调。这个差值是**链接期常量**，在手工映射下仍然成立，所以这段也是安全的
（`_ITM_registerTMCloneTable` 为 0 → 直接 `ret`）。

也就是说：**当前这份 payload 上，`DT_INIT` 并不像最初判断的那样会崩。**
更准确的风险描述是：

> `_init`/`frame_dummy`/`register_tm_clones` 这一族 CRT 桩依赖「`ld.so` 已经完成了
> 符号修复」这个前提。它们在**多数** gcc 产物上靠弱符号判空自保，但这是编译器的
> 善意，不是 ABI 保证。一旦遇到不做判空的 CRT 变体（不同 libc、`-fno-weak`、
> 静态 TLS 模型、或 LTO 重排过的桩），`DT_INIT` 就会跳到未修复的地址。

所以「不执行 `DT_INIT`」是一个**基于保守假设的正确决策**，但把它描述成
「执行必崩」是不准确的。这也是为什么它现在被归为「限制」而不是「bug」。

### 待定方案

三个选项，都还没做：

1. **维持现状**（推荐）。载荷的构造函数本就该放 `.init_array`，这是 ELF 规范里
   「给动态库用的」那个入口。`DT_INIT` 主要服务于老式链接器，现代工具链都在
   `.init_array` 里。
2. **有条件执行**：只在该 DSO 没有 `.init_array` 时才调 `DT_INIT`。能覆盖古董载荷，
   但要给 `_init` 提供「像 ld.so」的上下文，仍然有风险。
3. **模拟 ld.so 上下文**：在调用 `_init` 前把 `__gmon_start__` 等弱符号显式写 0
   （已经这样了），并保证 `rdx` 是 atexit 钩子（glibc 约定 `_init` 不一定用）。
   复杂度高、收益低。

### 附带影响

`DT_FINI` **是**会被执行的（`src/manual_loader.cc:305`），且在 `fini_fns_` 里排在
`.fini_array` 各项之后（逆序执行时先跑）。

实测这份 payload 的 `_fini` 是个空桩，**并不**读 `__gmon_start__`：

```asm
00000000000011fc <_fini>:
    11fc: endbr64
    1200: sub    $0x8,%rsp
    1204: add    $0x8,%rsp
    1208: ret
```

也就是说在当前工具链产物上 `_fini` 与 `_init` **并不对称**——只有 `_init` 带
`__gmon_start__` 调用。但 `unload()` 仍为每个 `fini` 调用包了 `try/catch`，
因为换一个 CRT 变体就不保证了：

```cpp
// src/manual_loader.cc:305-311
    try {
      remote_.remote_call(target, {}, 0);
    } catch (const Error&) {
      // A destructor that fails must not prevent the unmap below.
    }
```

所以 `_fini` 崩了不会阻止 `munmap`——但**目标进程已经被那个 SIGSEGV 打过了**，
`catch` 只是让我们继续往下走。这是个待处理的隐患：`unload` 路径上应该也跳过
`DT_FINI`，理由与 `DT_INIT` 相同。

---

## 8. 其它值得记录的取舍

### 8.1 `process_vm_readv` 优先，`PEEKDATA` 兜底

```cpp
// src/remote.cc:125-143（节选）
  const ssize_t n = ::process_vm_readv(pid_, &local, 1, &remote, 1, 0);
  if (n >= 0) return static_cast<size_t>(n);

  if (errno != EPERM && errno != ENOSYS) {
    // EFAULT is expected when the range crosses into unmapped memory; report a
    // partial result rather than failing so callers can walk maps.
    if (errno == EFAULT) return 0;
  }
```

`process_vm_*` 一次 syscall 搬整段，`PEEKDATA` 是每字一次。但 `process_vm_*` 需要
`PTRACE_MODE_ATTACH` 权限，在 hardened 内核/沙箱里会 `EPERM`。两条路都实现，
运行时选。

`EFAULT` 返回 0 而不是抛错，是为了让调用方能「部分读」——扫 `maps` 的尾部、
以及读一个跨到未映射页的段时会用到。

### 8.2 从磁盘重新解析目标库，而不是遍历远程动态段

```cpp
// src/manual_loader.cc:91-100
    // Parse the library from disk rather than walking its remote dynamic section:
    // the file is already in the page cache in practice, and reading a hash table
    // element by element over ptrace would be orders of magnitude slower.
    const std::string path = resolve_module_path(soname);
    if (path.empty()) continue;

    try {
      ElfImage lib(MappedFile::open(path));
      if (const DynSymbol* sym = lib.find_symbol(name)) {
        if (sym->defined) return *base + (sym->value - lib.image_base());
```

在目标进程里走 GNU hash 查找需要：读 `DT_GNU_HASH` 头 → 算 bloom 掩码 → 读 bloom 字
→ 读 bucket → 逐条读 chain。每一步都是一次跨进程读，**几十到上百次 syscall**。
而从磁盘 mmap 后在本进程内查是纯内存操作。

前提假设：目标和我们在**同一个 mount namespace 能看到同一个文件**。这正是
`resolve_in_process()` 用 `/proc/<pid>/root` 的原因。如果库已经被 `(deleted)`（升级后
未重启的进程），`resolve_module_path` 会拿到带 `" (deleted)"` 的路径，`open` 会失败，
该 soname 被跳过——这条降级路径是隐式的、没有专门处理。

### 8.3 `find_loaded_module` 取最低地址作为 base

```cpp
// src/remote.cc:695-699
    if (best == 0 || start < best) best = start;
```

一个 `.so` 在 `maps` 里有多行（每个段一行）。最低的那行是它的加载基址，
对应 ELF 的 `p_vaddr=0` 那一侧。用 `sym.value - lib.image_base()` 做偏移换算
（而不是直接用 `sym.value`），就是为了对齐「基址 + 段内偏移」这个模型。

### 8.4 `seize` 与 `attach` 分离

`attach()` 只附加（不停止），`stop_target()` 才停止。这个分离让「附加但什么也不做」
成为可能（比如只读 `/proc` 的场景），也让 `stop`/`resume` 可以成对嵌套调用而不会
对已停止的目标重复 INTERRUPT。

`RemoteProcess` 的析构函数对两个清理动作都做了 `try/catch`：

```cpp
// src/remote.cc:52-62
RemoteProcess::~RemoteProcess() {
  try {
    release_scratch();
  } catch (...) {
  }
  try {
    if (attached_) detach();
  } catch (...) {
  }
  delete saved_;
}
```

析构函数不能抛异常（`noexcept` 默认），所以吞掉。但这也意味着**析构阶段的失败是静默的**
——如果 `detach()` 失败，目标可能仍处于 ptrace 控制下。实际上这种情况很少见，
因为内核会在 tracer 退出时自动 detach。
