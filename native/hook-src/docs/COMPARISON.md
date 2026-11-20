# 与上游二进制的对比

对比对象：上游 `snowluma-linux-{x64,arm64}.node`（210 KB，已 404，仅有 strip 后的二进制）
与本次重写的 `haizakura-hook`。

**上游的所有数据来自对二进制的静态分析**（`objdump -T`、`strings`），
**本次重写的所有数据来自源码与本机实测**。两者的可信度性质不同，引用时请注意。

---

## 1. 符号与结构证据

### 1.1 上游二进制的可见面

| 项 | 值 |
| --- | --- |
| 体积 | 210 KB |
| strip | 是 |
| 动态符号 | 仅 2 个：`napi_register_module_v1`、`node_api_module_get_api_version_v1` |
| 导出函数 | 5 个（见 1.3） |

210 KB 且只剩 2 个动态符号，意味着**内部结构完全不可见**：没有本地符号、没有
section 名以外的线索，所有函数边界只能靠 `objdump -d` 反汇编重推。这是重写的直接动因。

### 1.2 上游导入的函数

`objdump -T | grep UND` 得到：

| 分组 | 导入 |
| --- | --- |
| ptrace | `ptrace`、`waitpid` |
| 跨进程内存 | `process_vm_readv`、`process_vm_writev` |
| 动态加载 | `dlopen`、`dlsym` |
| 内存映射 | `mmap`、`munmap` |
| syscall | `syscall` |
| N-API | `napi_*` 系列 |

这些导入本身就是一份设计说明书，逐条对应：

- `ptrace` + `waitpid` → 确实用 ptrace 状态机
- `process_vm_readv/writev` → 走的是和我们一样的快路径（不是纯 `PEEKDATA`）
- **`syscall`** → 它用 libc 的 `syscall()` 包装器发起远程调用。
  这是一个关键差异：**它依赖在目标进程里能调到 `syscall` 这个 libc 函数**，
  而我们的做法是直接在 libc 的代码段里找一个 `0f 05` 字节序列跳过去，
  不依赖任何可调用符号。见 `DESIGN-NOTES.md` 第 2 节。
- **`dlopen`/`dlsym` 出现在导入表里**，说明上游**同时**用了两条路径。
  最合理的解释是：`dlopen` 用来加载它自己的辅助库（或者用来在目标里探测符号），
  而手工 ELF 加载器用于 `loadModuleManualAsync` 那条路径。
  **我们没有 `dlopen`/`dlsym` 依赖**。
- `mmap`/`munmap` → 和我们的 `remote_mmap`/`remote_munmap` 对应，但注意它是
  **本进程**的 `mmap`；目标进程里的映射要靠远程 syscall。我们的实现里
  `remote_mmap` 是通过 `remote_syscall6(9, ...)` 在目标里做的。

### 1.3 上游的 5 个导出函数

`getAllMainProcessAsync`、`listCandidateProcessesAsync`、`getBackendInfoAsync`、
`loadModuleManualAsync`、`unloadModuleManualAsync`

**我们保持了完全相同的 5 个函数名和参数形态**：

```javascript
// 上游的错误串给出的签名
loadModuleManualAsync(pid, dylibPath) requires 2 arguments
unloadModuleManualAsync(pid, handle) requires 2 arguments
handle must be {base, entry, size, exceptionTable}
```

我们的实现逐条对应（`src/addon.cc`）：

```cpp
// src/addon.cc:307-311
  if (argc < 2) {
    napi_throw_error(env, nullptr,
                     "loadModuleManualAsync(pid, dylibPath) requires 2 arguments");
    return nullptr;
  }
```

```cpp
// src/addon.cc:344-348
  if (argc < 2) {
    napi_throw_error(env, nullptr,
                     "unloadModuleManualAsync(pid, handle) requires 2 arguments");
    return nullptr;
  }
```

```cpp
// src/addon.cc:358-360
    if (handle.base == 0) {
      hz::fail("handle must be {base, entry, size, exceptionTable}");
    }
```

这三条错误消息是**照抄上游措辞**的。目的很明确：让上层 JS 代码（以及任何已经
按上游行为写了 `try/catch` 的调用方）能在不改一行的前提下换用我们的实现。
这是接口兼容，不是巧合。

`handle` 的四个字段也一致：`{base, entry, size, exceptionTable}`，且都用 bigint
（见 `DESIGN-NOTES.md` 第 6 节）。

### 1.4 上游错误串揭示的内部结构

这是最有价值的情报来源。逐组分析：

**ELF 加载器组**

```
manual ELF loader supports only ELF64 little-endian images
DT_GNU_HASH chain entry is outside mapped image
cannot resolve IFUNC symbol
ELF REL relocations are unsupported on x86_64; expected RELA
manual ELF loader does not implement TLS relocations
```

| 串 | 含义 | 我们的对应 |
| --- | --- | --- |
| `only ELF64 little-endian images` | 拒绝 ELF32/BE | 拆成两条：`only ELF64 images` + `only little-endian images`（`src/elf_image.cc:35-37`） |
| `DT_GNU_HASH chain entry is outside mapped image` | 校验 hash chain 边界 | 我们解析 `DT_GNU_HASH` 只用来**推断符号数量**，不做链式查找，所以没有对应串 |
| `cannot resolve IFUNC symbol` | **实现了 IFUNC 解析** | ❌ 我们没实现（见第 6 节） |
| `REL relocations are unsupported on x86_64; expected RELA` | 区分 REL/RELA | 我们只处理 RELA，缺 `DT_RELA` 时静默返回（`if (!rela \|\| !relasz) return;`） |
| `does not implement TLS relocations` | 明确拒绝 TLS | ✅ 同样拒绝，措辞一致（`src/manual_loader.cc:221`） |

注意 `REL relocations are unsupported on x86_64` 这条：它说明上游**在 x86_64 上
显式检查了 `DT_REL` 是否存在并拒绝**。我们没做这个检查——如果一个畸形映像提供了
`DT_REL` 而非 `DT_RELA`，我们会走 `parse_relocations()` 的 `return` 分支，
**静默地不应用任何重定位**，然后在 `run_init` 里崩。这是个诊断质量上的退步。

**ptrace 组**

```
PTRACE_SEIZE failed
PRoot PTRACE_ATTACH failed
no thread could be attached as trampoline
PTRACE_INTERRUPT failed
```

| 串 | 含义 | 我们的对应 |
| --- | --- | --- |
| `PTRACE_SEIZE failed` | 用 SEIZE，与我们的选择一致 | ✅ `src/remote.cc:75` |
| `PRoot PTRACE_ATTACH failed` | **专门处理 PRoot 环境** | ⚠️ 我们只在注释里提到，无专门分支 |
| `no thread could be attached as trampoline` | **有多线程 trampoline 查找** | ❌ 我们只用主线程（见第 6 节） |
| `PTRACE_INTERRUPT failed` | 用 INTERRUPT | ✅ 措辞一致（`src/remote.cc:93`） |

`PTRACE_SEIZE failed` **和** `PRoot PTRACE_ATTACH failed` 同时存在，是上游
「SEIZE 失败 → 回退 ATTACH，且回退在 PRoot 下会失败」这条路径的直接证据。
我们的 `seize()` 结构相同，但错误消息合并成了一条：

```cpp
// src/remote.cc:81-84
  if (::ptrace(PTRACE_ATTACH, pid_, nullptr, nullptr) != 0) {
    fail(format("PTRACE_SEIZE and PTRACE_ATTACH both failed for pid %d: %s", pid_,
                std::strerror(seize_errno)));
  }
```

**远程内存组**

```
remote mmap failed
remote scratch buffer is too small for string
failed to resolve remote symbol
```

| 串 | 含义 | 我们的对应 |
| --- | --- | --- |
| `remote mmap failed` | 目标里 mmap 失败 | ✅ 措辞接近（`remote mmap failed reserving 0x... bytes`） |
| `remote scratch buffer is too small for string` | **有按需扩容的 scratch 缓冲** | ⚠️ 我们有 `scratch_buffer(size)` 会扩容，但**没有**「字符串太长」的检查 |
| `failed to resolve remote symbol` | 符号解析失败 | ✅ 措辞一致（`src/manual_loader.cc:157`） |

`remote scratch buffer is too small for string` 这条特别有意思：它说明上游有一个
「往目标里写字符串」的路径（大概是模块路径、或者传给载荷的参数），并且它会检查
scratch 是否够大。我们的 `scratch_buffer(size)` 在不够时会 `release_scratch()` +
重新 mmap（`src/remote.cc:232-243`），是自动扩容而不是报错，所以不需要这条串。
但这也意味着**我们没有对应的上限保护**——一个超长路径会让我们去 mmap 一个巨大的区域。

---

## 2. 六个维度的对比

### 2.1 代码量

| 项 | 上游 | 本次重写 |
| --- | --- | --- |
| 二进制 | 210 KB | 192 KB（`haizakura-hook-linux-x64.node`） |
| 源码 | **无** | 14,764 行（`include/` + `src/` + `test/` + `ts/src/`） |
| 其中实现 | — | ~2200 行（去掉注释与头文件声明） |
| 测试代码 | 未知（二进制里无测试痕迹） | 232 行（`test/`） |

二进制体积接近（192 vs 210 KB）是巧合而非目标——两者都链了 C++ 运行时和异常处理。
真正的差别不在体积，在于**我们的 192 KB 可以从源码重建**。

源码行数分布（文档编写时）：

```
include/common.h             84
include/elf_image.h         225→235
include/manual_loader.h      93
include/process_enumerate.h  44
include/remote.h            134
src/common.cc               148
src/elf_image.cc            308→334
src/manual_loader.cc        318→368
src/process_enumerate.cc    146
src/remote.cc               719→862 (并行修改中)
src/addon.cc                399
src/injector.cc               0  ← 空文件
test/*.cc                   232
```

> `src/injector.cc` 是 **0 行空文件**，但仍被 `CMakeLists.txt:34` 和 `:74` 列入
> 编译源列表。它是历史残留，应该删掉或填上内容。

### 2.2 可维护性

这是重写的**首要理由**，也是最实质的差距。

| 维度 | 上游 | 本次重写 |
| --- | --- | --- |
| 能否改 bug | 不能（无源码） | 能 |
| 能否换架构 | 不能（需重新逆向） | 能（改 `#if defined(__aarch64__)` 分支） |
| 能否审计 | 只能反汇编 | `readelf`/`objdump` + 源码对照 |
| 上游能否修 | 仓库 404，无法提 PR | 自主 |
| 新人上手 | 反汇编 210 KB | 读 14,764 行带注释的 C++ / TypeScript |

具体一点：上游要改一个重定位类型，得先在一堆 `test`/`jne` 里认出那个 `switch`。
我们的对应代码是：

```cpp
// src/manual_loader.cc:183-224
    if (image_.is_x86_64()) {
      switch (type) {
        case elf::kRx86_64None:
          writes = false;
          break;
        case elf::kRx86_64Relative:
          value = base + static_cast<uint64_t>(rel.addend);
          break;
        ...
        case elf::kRx86_64Tpoff64:
        case elf::kRx86_64DtpMod64:
        case elf::kRx86_64DtpOff64:
        case elf::kRx86_64TlsGotpcrel:
        case elf::kRx86_64Tprel64:
        case elf::kRx86_64TprelDyn:
          fail("manual ELF loader does not implement TLS relocations");
```

再加一条类型就是加一个 `case`。

### 2.3 架构支持

| 项 | 上游 | 本次重写 |
| --- | --- | --- |
| x86_64 | ✅ 有二进制 | ✅ 已实现（唯一被测过的） |
| aarch64 | ✅ 有二进制 | ⚠️ 代码写了，**从未编译或运行** |
| 统一实现 | 未知（两套二进制，可能共用源码） | ✅ 同一份源码 + `#if` 分支 |

我们有 `#if defined(__x86_64__)` / `#elif defined(__aarch64__)` 两套
`remote_syscall6`、`remote_call`、`ensure_syscall_site`，重定位分派也按
`image_.is_x86_64()` / `is_aarch64()` 走两棵 `switch`。

**但必须强调**：aarch64 分支从未编译通过（无 arm64 环境），更没运行。
它的寄存器约定（`x8` 放 syscall 号、`x0..x5` 放参数、`svc #0`）和 `PTRACE_SETREGSET`
用法是照着 ABI 写的，没有任何实测支撑。详见 `REWRITE-STATUS.md`。

### 2.4 错误信息质量

| 维度 | 上游 | 本次重写 |
| --- | --- | --- |
| 格式 | 固定字符串 | `format()` 带具体值 + `strerror(errno)` |
| 定位能力 | 「失败了」 | 「在哪个地址、哪个 pid、期望什么」 |
| 带 errno | 部分 | 全部 ptrace/syscall 路径 |
| 符号缺失 | `failed to resolve remote symbol` | 同上 + `UnresolvedSymbol` 携带符号名 |

示例对比。

上游大概是：

```
remote mmap failed
```

我们是：

```cpp
// src/manual_loader.cc:116-119
    fail(format("remote mmap failed reserving 0x%llx bytes for the payload",
                static_cast<unsigned long long>(image_.image_size())));
```

```
remote mmap failed reserving 0x5000 bytes for the payload
```

再比如 ptrace 失败，我们带上 `strerror`：

```cpp
// src/remote.cc:303-304
    fail(format("PTRACE_GETREGS failed for pid %d: %s", pid_, std::strerror(errno)));
```

```
PTRACE_GETREGS failed for pid 2532583: No such process
```

这条比 `PTRACE_SEIZE failed` 多出的信息（哪个 pid、内核怎么说）在排查
「目标中途退出」「权限不足」「被别的 tracer 占用」时是决定性的。

**一个额外的诊断设施**：`HZ_DEBUG=1` 打开后每次 stop 都打印信号和 event：

```cpp
// src/remote.cc:106-110
    if (WIFSTOPPED(status)) {
      const int sig = WSTOPSIG(status);
      const int event = static_cast<int>(status >> 16);
      dbg("[hz] stopped pid=%d sig=%d (%s) event=%d\n", pid_, sig, ::strsignal(sig), event);
```

上游有没有等价物未知（字符串表里没有对应项，倾向于没有）。

**但也要承认退步**：如 1.4 所述，我们没有
`ELF REL relocations are unsupported on x86_64; expected RELA` 这条——
缺 `DT_RELA` 时静默跳过，诊断质量不如上游。

### 2.5 测试覆盖

| 项 | 上游 | 本次重写 |
| --- | --- | --- |
| 源码里的测试 | 未知，二进制中无证据 | `test/` 232 行 |
| 自测可执行 | 无 | `hook_selftest`（ELF + 进程枚举） |
| 假目标 | 无 | `fake_target` + `fake-wrapper.node` + `payload.so` |
| CI | 无（仓库已 404） | 无（`enable_testing()` 但无 `add_test()`） |
| 实测通过 | 未知 | 单元层通过；**集成层当前不通过** |

这是**唯一一个我们能明确声称领先的维度**，但领先得很有限：
测试件齐了，自动化没接，而且集成测试现在是红的（见 `TESTING.md` 第 6 节）。

上游完全看不到测试痕迹——210 KB 的二进制里没有任何测试相关的字符串。
这可能意味着它从未被自动化测试过，也可能意味着测试代码在别处。**无法判断**。

### 2.6 已知差距（上游有、我们没有）

这一节是本文最重要的部分。以下功能**上游明确实现了，我们没有**：

#### ① trampoline 线程查找

上游错误串：`no thread could be attached as trampoline`

这条串说明上游会**在目标的多个线程里挑一个作为 trampoline**。它的价值在于：

- 目标的某个线程可能正卡在不可中断的系统调用里（`read()`、`futex()`），
  对它 `PTRACE_INTERRUPT` 要等到系统调用返回，可能很久。
- 另一些线程可能正好在用户态的空闲循环里，能立刻停下。
- 挑「最容易停的那个线程」能显著降低 attach 延迟，也降低对目标的影响。

我们**直接对主线程（`pid_`）操作**，没有选线程的逻辑。后果：

- 如果主线程卡在 `read()` 上，`PTRACE_INTERRUPT` 会等它返回。
- 对 QQ 这种有网络线程、UI 线程的多线程进程，这个延迟不可控。

实现难度不低：需要枚举 `/proc/<pid>/task/`、对每个 tid 尝试 attach、维护
「哪个 tid 被我们停住」的状态、并且 `remote_call` 用的是**那个线程**的寄存器
（而不是主线程的）。我们的 `RemoteProcess` 整个类都是围绕单个 pid 写的，
要支持这个得改状态模型。

#### ② IFUNC 解析

上游错误串：`cannot resolve IFUNC symbol`

`STT_GNU_IFUNC`（`type == 10`）符号的「值」不是地址，而是一个**解析函数的地址**，
调用它才返回真正的地址。典型例子：`memcpy`、`strlen` 在 glibc 里是 IFUNC，
按 CPU 特性在运行时选 AVX2/SSE 版本。

我们的处理：

```cpp
// src/elf_image.cc:230
    sym.is_ifunc = sym.type == 10;  // STT_GNU_IFUNC
```

**只标记，不处理**。`is_ifunc` 字段从头到尾没有被任何逻辑读过
（`grep` 确认：只有定义和赋值，没有消费者）。所以：

- 如果载荷引用了一个 IFUNC 符号，我们会把**解析函数的地址**当成目标地址写进 GOT。
- 载荷调到它时，实际执行的是 IFUNC resolver，不是被解析出来的实现。
- 行为取决于具体 resolver——`memcpy` 的 resolver 会返回一个地址，但我们把它
  当返回值丢了，GOT 里仍是 resolver 地址 → 载荷调用时参数含义全错。

要看是否踩到：如果载荷只用 `malloc`/`free`/`write` 这类非 IFUNC 符号，没事。
用了 `memcpy`/`strlen`/`strcmp` 就危险。**这是当前最可能在生产里咬人的差距。**

#### ③ TLS 重定位

上游错误串：`manual ELF loader does not implement TLS relocations`

**注意：上游和我们用的是同一句话**，说明上游也不实现 TLS。这条**不是差距**，
是正确的并列。但值得说明理由：

x86_64 的 TLS 重定位有 6 种（`TPOFF64`、`DTPMOD64`、`DTPOFF64`、`TLS_GOTPCREL`、
`TPREL64`、`TPREL_DYN`），正确处理需要：

1. 在目标里为该模块分配 `TLS` 块（调整目标所有线程的 `thread pointer` 偏移）
2. 修改目标已有的 `DTV`（dynamic thread vector）
3. 处理 `__tls_get_addr` 的调用约定

这实际上要求接管目标 `ld.so` 的 TLS 分配器。我们的载荷是「注入一个 hook 库」，
不需要线程局部存储，所以**明确拒绝**比「半实现」安全——半实现会让载荷在
特定线程上读到别人的 TLS 数据。

zmm 那类 `TLS_GOTDESC`（TLSDESC，`R_X86_64_TLSDESC = 36`）我们连常量都没定义。

#### ④ `dlopen`/`dlsym` 路径

上游导入表里有这两个。我们没有。这意味着如果某个场景下「让目标的 `ld.so`
自己去加载」比手工映射更合适（比如需要正确处理 `DT_NEEDED` 递归依赖），
上游有这条路，我们只有手工映射。

#### ⑤ PRoot 适配

上游有 `PRoot PTRACE_ATTACH failed` 专门分支。我们没有专门处理，
只会在 attach 失败时报一条通用错误。

---

## 3. 我们有、上游未必有的

为了平衡，也列出反向的差距（**注意：这些是基于上游二进制证据的推断，
不是确证**）：

| 项 | 我们的做法 | 上游 |
| --- | --- | --- |
| syscall 跳板定位 | 扫**可执行**段里的 `0f 05` | 用 libc 的 `syscall()` 符号（导入表有 `syscall`） |
| JMPREL 处理 | 显式合并 `.rela.plt` | 未知（错误串里没提，但它有 `REL`/`RELA` 检查，倾向于有） |
| 段拷贝校验 | 回读前 16 字节比对 | 未知 |
| 源码可得 | ✅ | ❌ |

关于第一条：上游用 `syscall` 符号是**更简单也更正确**的做法——`dlsym` 到 libc 的
`syscall` 函数，直接远程调用它，不用自己找 gadget、不用担心 `0f 05` 落在数据段。
我们因为要避免 `dlsym` 依赖才自己扫，代价是多了「扫错区域」的风险
（见 `DESIGN-NOTES.md` 第 2 节）。

**这可能不是优势，而是取舍。** 诚实地说：如果只考虑 x86_64 + 单一 libc，
上游的方案更省事。我们选扫描是为了不依赖「目标里 `dlsym` 一定可用」。

---

## 4. 总结

| 维度 | 结论 |
| --- | --- |
| 代码量 | 二进制体积接近；我们从 0 行到 14,764 行可读源码 |
| 可维护性 | **明确胜出**，这是重写的全部理由 |
| 架构支持 | 名义上平手（都支持双架构），实质上我们 aarch64 **未验证** |
| 错误信息 | 多数维度更好（带地址/pid/errno），但**丢了 REL/RELA 诊断** |
| 测试覆盖 | 唯一明确领先项，但集成测试当前**不通过**、无 CI |
| 功能完整度 | **明确落后**：无 trampoline 线程、无 IFUNC、无 `dlopen` 路径、无 PRoot 适配 |

一句话：**这次重写换来了可维护性和可测试性，代价是功能完整度和成熟度。**
上游是一个在真实环境里跑过的、功能更全的二进制；我们是一个结构清晰、
但还没跑通的实现。两者的定位不同，不该简单说谁「更好」。
