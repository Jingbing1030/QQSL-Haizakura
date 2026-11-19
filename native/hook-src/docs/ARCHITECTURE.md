# 架构总览

本文描述 `haizakura-hook` 的分层结构、为什么不用 `dlopen`、手写加载器的五个步骤，以及一次
成功注入的完整时序。

所有代码引用均来自当前仓库实现（`include/` 与 `src/`）。

---

## 1. 整体分层

四层，自下而上。除最顶层的 N-API 入口外全部同步，任何一层失败都以 `hz::Error` 抛出。

```
┌──────────────────────────────────────────────────────────────────┐
│ N-API 层  src/addon.cc                                           │
│   5 个导出，全部 napi_async_work → Promise                       │
│   getAllMainProcessAsync / listCandidateProcessesAsync           │
│   getBackendInfoAsync / loadModuleManualAsync                    │
│   unloadModuleManualAsync                                        │
└───────────────────────────┬──────────────────────────────────────┘
                            │ 都在 libuv 线程池里跑
┌───────────────────────────▼──────────────────────────────────────┐
│ ManualLoader  src/manual_loader.cc                               │
│   reserve_image → copy_segments → apply_relocations → run_init   │
│   符号解析 resolve_remote_symbol()（回落到目标已映射的库）        │
└───────────────────────────┬──────────────────────────────────────┘
┌───────────────────────────▼──────────────────────────────────────┐
│ ElfImage  src/elf_image.cc                                       │
│   纯用户态解析，不碰目标进程。段表/动态段/符号/GNU hash/RELA     │
│   每个偏移都做边界校验，绝不返回脏数据                            │
└───────────────────────────┬──────────────────────────────────────┘
┌───────────────────────────▼──────────────────────────────────────┐
│ RemoteProcess  src/remote.cc                                     │
│   ptrace 状态机 + process_vm_readv/writev + 远程 syscall 跳板    │
│   提供 read/write/remote_mmap/remote_munmap/remote_call          │
└───────────────────────────┬──────────────────────────────────────┘
┌───────────────────────────▼──────────────────────────────────────┐
│ ProcessEnumerator  src/process_enumerate.cc                      │
│   扫 /proc，用「谁映射了 wrapper.node」识别 QQ 主进程             │
└──────────────────────────────────────────────────────────────────┘
```

### 各层职责与关键约束

| 层 | 文件 | 职责 | 关键约束 |
| --- | --- | --- | --- |
| ProcessEnumerator | `src/process_enumerate.cc` (146 行) | 找到 QQ 浏览器进程 | 不信任进程名，只认 `wrapper.node` |
| RemoteProcess | `src/remote.cc` (719 行, 原版) | 跨进程读写、远程 syscall、远程调用 | 所有寄存器改动必须还原 |
| ElfImage | `src/elf_image.cc` (308 行, 原版) | 解析 ELF64 | 任何越界偏移立即抛错 |
| ManualLoader | `src/manual_loader.cc` (318 行, 原版) | 映射 + 重定位 + init | 失败必须回收已映射区域 |

> 行数为本次文档编写时读取到的版本。`src/remote.cc` 与 `src/manual_loader.cc`
> 在编写期间正被并行修改，最新行数见 `REWRITE-STATUS.md`。

`include/common.h` 提供跨层共享的基础设施：`hz::Error`、`format()`（printf 风格）、
`read_file*()`，以及 `MappedFile`。

`MappedFile` 的存在理由（`include/common.h:45-58`）：ELF 解析要反复读同一个文件的不同偏移，
每次 `pread()` 既慢又要处理 short read；一次 `mmap(PROT_READ, MAP_PRIVATE)` 之后所有访问都是
指针运算。同时 `open()` 先走 `realpath()`：

```cpp
// src/common.cc:71-78
MappedFile MappedFile::open(const std::string& path, bool require_regular) {
  // realpath() first: /proc/<pid>/root/... and /proc/<pid>/cwd/... are symlinks,
  // and some container runtimes expose them only through the resolved path.
  char resolved[PATH_MAX];
  const char* target = path.c_str();
  if (::realpath(path.c_str(), resolved) != nullptr) {
    target = resolved;
  }
```

这一点是必须的：注入路径要经过 `/proc/<pid>/root/...`（目标进程的 mount namespace），
那是个符号链接。

---

## 2. 为什么不用 `dlopen`

目标进程里跑 `dlopen` 在理论上最省事，实际上不行。三个独立原因：

### 2.1 我们控制不了目标的 loader 环境

`dlopen` 的行为由目标进程里 `ld.so` 的状态决定，而这个状态不归我们管：

- **搜索路径**。`LD_LIBRARY_PATH` 在进程启动时就固化了，我们无法从外部改。`dlopen` 传绝对路径
  虽然能绕过搜索，但载荷通常放在运行目录（`SNOWLUMA_HOOK_RUNTIME_DIR`）里，该路径从未被告知
  目标的 loader。
- **`DT_RPATH`/`DT_RUNPATH`/`ld.so.cache`** 同理，都是目标侧状态。
- **`RTLD_LOCAL`/`RTLD_GLOBAL` 语义**不由我们选，而载荷需要能被目标后续 `dlsym` 到。

### 2.2 调用 `dlopen` 本身需要一个能跑的线程

`dlopen` 是普通 libc 函数，要在目标进程里执行它，我们就得先有一次「在目标里调用函数」的能力
——也就是 `remote_call`。而 `remote_call` 的实现（私有栈 + 返回断点）正是手写加载器已经需要的
基础设施。换句话说：**要用 `dlopen` 得先有 `remote_call`，有了 `remote_call` 就不需要 `dlopen`**。

同时 `dlopen` 会持有目标 loader 的锁（`_dl_load_lock`）。如果目标当时正在自己的
`dlopen`/`dlclose` 里，我们从外部强行跳进去就是死锁。手写加载器完全不碰那把锁。

### 2.3 原版二进制踩过这个坑

上游 `snowluma-linux-*.node` 的错误字符串里有一条 **`PRoot PTRACE_ATTACH failed`**。

PRoot 是一个用 `ptrace` 实现用户态 `chroot`/`mount --bind` 的工具。QQ 在
PRoot 或类似沙箱下运行时，`ptrace` 会被外层 PRoot 抢占——一个 tracee 只能有一个 tracer。
上游为这条路径专门写了错误分支，说明作者确实在「受管控的运行时」里失败过。

这条字符串对本项目的意义在于：它证明了目标环境的 `ptrace`/loader 状态不可假定，
必须在设计上假定「环境可能不配合」。手写加载器把控制权收回自己手里，是这个前提下
唯一稳妥的选择。我们的对应处理见 `DESIGN-NOTES.md` 中 `PTRACE_SEIZE` 一节。

### 2.4 代价

手写加载器不实现符号介入（`symbol interposition`）、不实现 `DT_NEEDED` 的递归加载、
不实现 TLS 重定位、不实现 IFUNC 解析。这些差距在 `COMPARISON.md` 与
`REWRITE-STATUS.md` 中逐条列出。

---

## 3. 手写加载器的五个步骤

`include/manual_loader.h:9-15` 的注释概括了这五步。`load()` 的实际结构比注释更细，
中途插入了两段诊断校验（当前实现的 `load()` 已从最初的 318 行版本扩到含这些校验的版本）：

```cpp
// src/manual_loader.cc（load() 主干，诊断块已省略）
ManualMapHandle ManualLoader::load() {
  ManualMapHandle handle;
  handle.base = reserve_image();
  handle.size = image_.image_size();
  handle.entry =
      image_.entry() == 0 ? 0 : handle.base + (image_.entry() - image_.image_base());

  try {
    copy_segments(handle.base);
    apply_relocations(handle.base);

    // Verify the mapping before running anything in it: read the first bytes back
    // out of the target and compare with the file.  A silent copy bug otherwise
    // surfaces as an unexplainable SIGSEGV inside injected code.
    // ... 逐段回读前 16 字节并与文件比对（见下）...

    // Confirm the reserved window really is executable in the target.
    // ... 从 /proc/<pid>/maps 打印该窗口的实际权限 ...

    // Dump the relocated .init_array so an off-by-N in address math is visible
    // before we jump into it.
    // ... 打印每一项的运行时值 ...

    run_init(handle.base);
  } catch (const UnresolvedSymbol&) {
    // A missing symbol is fatal but recoverable-by-the-caller: release the window
    // so the target does not carry an unreachable executable region.
    remote_.remote_munmap(handle.base, handle.size);
    throw;
  } catch (...) {
    remote_.remote_munmap(handle.base, handle.size);
    throw;
  }

  return handle;
}
```

这几段校验的存在本身说明了调试这段代码的难度：手工加载器的 bug 表现是「目标里一个
SIGSEGV」，如果没有中间观测点，完全无法区分「段没拷对」「重定位算错」「页不可执行」
「地址算错」。三段校验分别对应后三种。实测输出形如：

```
[hz] verify X segment vaddr=0x1000 dest=0x7ad3c05ed000 got=16 same=1
[hz] image_base=0x0 init_count=2 legacy_init=0x1000
[hz] init_array runtime contents (2 entries):
[hz]   [0] at 0x7ad3c05efdc8 = 0x7ad3c05ed180  (base+0x1180)
[hz]   [1] at 0x7ad3c05efdd0 = 0x7ad3c05ed0c0  (base+0x10c0)
```

### 步骤 1 — reserve（保留地址窗口）

一次 `mmap` 覆盖**所有** `PT_LOAD` 段，而不是逐段映射。

```cpp
// src/manual_loader.cc:109-121
uint64_t ManualLoader::reserve_image() {
  // One mmap for the whole window keeps the segments contiguous, which all
  // relative addressing inside the payload depends on.  Protection is granted
  // up front rather than per-segment because relocation writes into the image.
  const uint64_t addr = remote_.remote_mmap(image_.image_size(),
                                            kProtRead | kProtWrite | kProtExec,
                                            kMapPrivate | kMapAnonymous);
  if (addr == 0) {
    fail(format("remote mmap failed reserving 0x%llx bytes for the payload",
                static_cast<unsigned long long>(image_.image_size())));
  }
  return addr;
}
```

为什么一次映射：

- 段与段之间的相对距离必须和文件里的 `p_vaddr` 差值一致。分开映射会被内核放到不相邻的位置。
- `PROT_EXEC` 一次性给足。重定位要往段里写数据，逐段设权限需要在写入前
  `mprotect` 再改回来，多两次远程 syscall，且中间窗口容易出错。

窗口大小由 `ElfImage` 算好：取所有 `PT_LOAD` 的 `[vaddr, vaddr+memsz)` 并集，再向下/向上
按 4096 对齐（`src/elf_image.cc:86-91`）。

### 步骤 2 — copy（拷贝段内容）

```cpp
// src/manual_loader.cc:123-136
void ManualLoader::copy_segments(uint64_t base) {
  for (const auto& h : image_.program_headers()) {
    if (h.type != elf::kPtLoad) continue;
    if (h.filesz == 0) continue;

    // The target window starts at `base` and corresponds to image_base() in the
    // file's address space, so the destination shifts by that difference.
    const uint64_t dest = base + (h.vaddr - image_.image_base());
    const uint8_t* src = image_.at(h.vaddr, static_cast<size_t>(h.filesz));
    remote_.write_exact(dest, src, static_cast<size_t>(h.filesz));
    // The zero-fill tail needs no work: the anonymous mapping starts zeroed and
    // only filesz bytes were written.
  }
}
```

关键点：**目标地址是 `base + (p_vaddr - image_base)`，不是 `base + p_vaddr`**。
因为窗口起点对齐到了 `image_base`（页对齐后的最小 `p_vaddr`），两者可能不相等。
`sym.value` 的换算同理（`define_value`，`src/manual_loader.cc:143-145`）。

`.bss` 不需要写：匿名映射本身是零页，且只写了 `filesz` 字节，`memsz > filesz` 的尾部天然为 0。

### 步骤 3 — relocate（重定位）

遍历 `DT_RELA`，对每种类型求值后写回 `base + (r_offset - image_base)`。

```cpp
// src/manual_loader.cc:143-158（节选）
  auto define_value = [&](const DynSymbol& sym) -> uint64_t {
    return base + (sym.value - image_.image_base());
  };

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

支持的 x86_64 类型（`switch` 在 `src/manual_loader.cc:183-224`）：

| 类型 | 值 | 处理 |
| --- | --- | --- |
| `R_X86_64_NONE` | 0 | 跳过 |
| `R_X86_64_RELATIVE` | 8 | `base + addend` |
| `R_X86_64_IRELATIVE` | 37 | `where + addend`（IFUNC 解析器地址，**不调用**） |
| `R_X86_64_64` | 1 | `S + addend` |
| `R_X86_64_GLOB_DAT` | 6 | `S + addend` |
| `R_X86_64_JUMP_SLOT` | 7 | `S + addend` |
| `R_X86_64_PC32` | 2 | `S + addend - P`，截断到 32 位 |
| `R_X86_64_COPY` | 5 | 直接报错（DSO 里不该出现） |
| TLS 系列 | 18/16/17/20/22/23 | `does not implement TLS relocations` |

aarch64 分支在 `src/manual_loader.cc:225-249`，支持 `ABS64(257)`、`GLOB_DAT(1025)`、
`JUMP_SLOT(1026)`、`RELATIVE(1027)`，拒绝 `COPY(1024)` 和 TLS 系列。

> **曾经缺陷（已修）**：早期版本 `parse_relocations()` 只读 `DT_RELA`/`DT_RELASZ`，
> **不读 `DT_JMPREL`/`DT_PLTRELSZ`**，导致 `.rela.plt` 里的 `JUMP_SLOT` 条目被静默丢弃。
> 手工映射的映像没有懒绑定解析器，`GOT` 槽会保持链接期的 PLT 桩地址，其自身的 GOT 项
> 仍为 0 → 第一次 `call` 进 PLT 就跳 0 崩。现已补上（`src/elf_image.cc:272-289`）：
>
> ```cpp
> // .rela.plt holds the JUMP_SLOT entries.  A normal DSO resolves these lazily
> // through its PLT; a manually mapped image has no resolver, so they must be
> // applied up front.  Skipping this leaves every imported function's GOT slot
> // pointing at a PLT stub whose own GOT entry is still zero.
> const auto jmprel = dynamic_value(elf::kDtJmprel);
> const auto pltsz = dynamic_value(elf::kDtPltRelSz);
> ```
>
> 实测验证：`payload.so` 现在解析出 `relocations=15`（`.rela.dyn` 11 + `.rela.plt` 4），
> 其中 `JUMP_SLOT(type 7)` 4 条，与 `readelf -r` 完全一致。

### 步骤 4 — init（执行构造函数）

```cpp
// src/manual_loader.cc:263-271
void ManualLoader::run_init(uint64_t base) {
  // DT_INIT_ARRAY is what registers a payload's static constructors.  Each entry
  // is a virtual address relative to image_base().
  for (const uint64_t fn : image_.init_functions()) {
    if (fn == 0) continue;
    const uint64_t target = base + (fn - image_.image_base());
    remote_.remote_call(target, {}, 0);
  }
}
```

`DT_INIT` 被**刻意排除**在 `init_fns_` 之外，只记进 `legacy_init_`。原因见
`DESIGN-NOTES.md` 最后一节（这是当前实现与「DT_INIT 会崩」旧说法不一致的地方）。

### 步骤 5 — handle（返回句柄）

```cpp
// include/manual_loader.h:27-32
struct ManualMapHandle {
  uint64_t base = 0;
  uint64_t entry = 0;
  uint64_t size = 0;
  uint64_t exception_table = 0;  // .eh_frame_hdr address, 0 when absent
};
```

句柄回传给 JS，卸载时再由 `unloadModuleManualAsync` 送回。
`exception_table`（`.eh_frame_hdr`）**目前恒为 0**，没有任何代码给它赋值——它是为
C++ 异常跨模块展开预留的字段，尚未实现。

卸载走 `unload()`：逆序执行 `fini_fns_`，然后 `munmap`。析构函数抛错也不阻止 unmap
（`src/manual_loader.cc:297-316`）。

---

## 4. 一次注入的完整时序

以 `loadModuleManualAsync(pid, path)` 为例。时间自上而下。

```
JS 主线程                      libuv 工作线程                       目标进程
     │                               │                                  │
     │ loadModuleManualAsync(pid,p)  │                                  │
     ├──────────────────────────────►│                                  │
     │  schedule<>() 建 Work +       │                                  │
     │  napi_create_promise          │                                  │
     │  返回 Promise（不阻塞）        │                                  │
     │                               │                                  │
     │                          ┌────┴─────────────────────────┐        │
     │                          │ Worker::run()                │        │
     │                          │  RemoteProcess remote(pid)   │        │
     │                          │  resolve_in_process(pid,p)   │        │
     │                          │   → /proc/<pid>/root + p     │        │
     │                          │  MappedFile::open() + realpath        │
     │                          │  ElfImage image(file)        │        │
     │                          │   ├ parse_headers            │        │
     │                          │   ├ parse_dynamic            │        │
     │                          │   ├ parse_symbols            │        │
     │                          │   ├ parse_relocations        │        │
     │                          │   └ parse_init_fini          │        │
     │                          └────┬─────────────────────────┘        │
     │                               │                                  │
     │                          remote.attach()                         │
     │                               ├── PTRACE_SEIZE ─────────────────►│ 继续运行
     │                               │   (失败则 PTRACE_ATTACH + wait)  │
     │                               │                                  │
     │                          loader.load()                           │
     │                               │                                  │
     │                          reserve_image()                         │
     │                               ├── PTRACE_INTERRUPT ────────────►│ 停住
     │                               │   waitpid(__WALL)                │
     │                               │   PTRACE_GETREGS → saved_        │
     │                               │   ensure_syscall_site()          │
     │                               │    扫 libc 可执行段找 0f 05      │
     │                               ├── SETREGS(rax=9 mmap) ─────────►│
     │                               │   PTRACE_SINGLESTEP             │
     │                               │   waitpid → GETREGS.rax = 地址   │
     │                               │   SETREGS(还原)                  │
     │                               │◄────────── mmap 窗口 ────────────┤
     │                               │                                  │
     │                          copy_segments(base)                     │
     │                               ├── process_vm_writev ────────────►│ 段内容落地
     │                               │   (EPERM 则 PTRACE_POKEDATA)     │
     │                               │                                  │
     │                          apply_relocations(base)                 │
     │                               ├── 逐条算值 → write_exact ───────►│ GOT 填好
     │                               │   (外部符号先 parse 目标侧的   │
     │                               │    libc/wrapper.node 的 ELF)    │
     │                               │                                  │
     │                          run_init(base)                          │
     │                               ├── 为每个 init fn 调 remote_call  │
     │                               │   ├ map 私有栈 + int3 跳板       │
     │                               │   ├ PTRACE_SETREGS(rip=fn,rsp=栈)│
     │                               │   ├ PTRACE_CONT ────────────────►│ 执行构造函数
     │                               │   ├ waitpid → 断点命中           │
     │                               │   └ SETREGS(还原 rip/rsp)        │
     │                               │                                  │
     │                          remote.detach()                         │
     │                               ├── release_scratch (munmap) ─────►│
     │                               ├── SETREGS(最终还原) ────────────►│
     │                               └── PTRACE_DETACH ───────────────►│ 继续运行
     │                               │                                  │
     │                          return ManualMapHandle                  │
     │◄── complete_cb: resolve(handle)                                  │
     │    （异常则 reject，error.what() 原样传给 JS）                    │
```

### 失败路径

`load()` 内任何异常都会 `remote_munmap` 已保留的窗口后再抛出
（`src/manual_loader.cc:284-292`），所以**失败不会在目标里留下不可达的可执行区域**。
`RemoteProcess` 的析构函数兜底 `release_scratch()` 和 `detach()`
（`src/remote.cc:52-62`），即使中途抛错也会解除 ptrace 并还原寄存器。

---

## 5. 进程识别

QQ 是 Electron 多进程应用：browser / zygote / renderer / GPU / network utility。
`wrapper.node` 只有 browser 进程加载，而 MSF 会话属于它。

```cpp
// src/process_enumerate.cc:32-44
// True when the process has wrapper.node mapped.  QQ's browser process is the
// only one that does: the zygotes and renderers inherit everything else.
bool maps_wrapper_node(int pid) {
  std::string maps;
  try {
    maps = read_file_text(format("/proc/%d/maps", pid), 16u << 20);
  } catch (const Error&) {
    return false;
  }
  // Match the basename so both /opt/QQ/resources/app/wrapper.node and a
  // relocated copy are recognised.
  return maps.find("wrapper.node") != std::string::npos;
}
```

名字只用作粗筛（`qq` 大小写不敏感 + 子串匹配，`src/process_enumerate.cc:62-68`），
真正的判据是 `maps` 里有没有 `wrapper.node`。名字相同的子进程会被这个判据排掉。

`find_single_main_process()` 在命中多于一个时**拒绝猜测**并列出所有 pid
（`src/process_enumerate.cc:119-127`）——宁可报错也不要注错进程。

---

## 6. 线程模型

| 层 | 线程 |
| --- | --- |
| N-API 入口 | JS 主线程（只做参数转换 + 建 Promise） |
| Worker::run() | libuv 线程池 |
| ProcessEnumerator / ElfImage / RemoteProcess / ManualLoader | 同上，全部同步实现 |

因为 attach 目标可能要几百毫秒（`PTRACE_INTERRUPT` 要等目标到达安全点），
这一层绝不能跑在事件循环上。理由与实现细节见 `DESIGN-NOTES.md`。

`RemoteProcess` 不是线程安全的，也没有加锁：一个 `loadModuleManualAsync` 调用
创建一个 `RemoteProcess` 实例，生命周期完全在单个 worker 内。并发注入不同 pid 是安全的
（各自独立实例），并发注入同一个 pid 会因 ptrace 独占而失败。
