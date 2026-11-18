# `haizakura-hook` — 进程注入插件

QQNT 的 MSF 会话寄生需要把一段代码塞进已运行的 QQ 主进程。这个目录就是那个注入器，
用 C++ 从零重写，替代上游只发布二进制、无源码的 `snowluma-linux-*.node`。

## 为什么重写

| | 上游二进制 | 这里 |
|---|---|---|
| 源码 | 无，GitHub 仓库已 404 | 2850 行 C++，全部可读 |
| 符号 | `strip` 过，只剩 2 个导出 | 完整符号表 + 可读错误信息 |
| 架构 | 只能重新逆向 | `#if` 分支，x86_64 / aarch64 同源 |
| 体积 | 210 KB | 531 KB（x64）/ 495 KB（arm64） |

## 目录

```
hook-src/     C++ 源码、CMakeLists、测试件
hook-dist/    预编译产物，clone 即用
```

## 支持的架构

`haizakura-hook-linux-x64.node` 和 `haizakura-hook-linux-arm64.node`。

arm64 产物是**在 Debian bookworm 容器里编译的**（glibc 2.36），因为 Node 宿主
通常是 bookworm 系镜像。在更新的发行版上编译会引入 `GLIBC_2.38` 依赖，导致
目标容器 `ERR_DLOPEN_FAILED`。

## 自己构建

原生：

```bash
cd hook-src && mkdir -p build && cd build
cmake -DNODE_INCLUDE_DIR=/path/to/node/headers -DARCH_TAG=linux-x64 ..
make haizakura_hook
```

交叉编译 arm64（在 x86 主机上）：

```bash
apt install g++-aarch64-linux-gnu
cd hook-src && mkdir -p build-arm64 && cd build-arm64
cmake -DCMAKE_CXX_COMPILER=aarch64-linux-gnu-g++ \
      -DNODE_INCLUDE_DIR=/path/to/node/headers -DARCH_TAG=linux-arm64 ..
make haizakura_hook
```

这样能编出可以 `require()` 的产物，但**在 bookworm 之前的宿主要慎用**——见上。

## 对外接口

```js
const hook = require('./hook-dist/haizakura-hook-linux-x64.node');

await hook.getBackendInfoAsync();
// { platform: 'linux', arch: 'x64',
//   runtimeResolution: 'elf64-eh-frame-itanium-rtti',
//   injection: 'ptrace-manual-elf64-x86_64' }

await hook.getAllMainProcessAsync();          // 映射了 wrapper.node 的进程
await hook.listCandidateProcessesAsync('qq'); // 按名字过滤
await hook.loadModuleManualAsync(pid, '/path/to/payload.so');
await hook.unloadModuleManualAsync(pid, handle);
```

`loadModuleManualAsync` 返回 `{ base, entry, size, exceptionTable }`，四个字段都是
**BigInt**（地址可能超过 2^53）。

## 工作原理

1. `PTRACE_ATTACH` 接管目标，读出寄存器
2. 在目标里 `mmap` 一块 `rwx` 内存，作为暂存区和返回跳板
3. 解析 `.so`：`PT_LOAD` 段映射、`RELA` 重定位（含 `.rela.plt` 的 `JUMP_SLOT`）
4. 把段数据写进目标，逐条应用重定位
5. 在目标里执行 `DT_INIT_ARRAY` 里的构造函数

`DT_INIT` 故意不执行：它指向 `_init`，那段代码假定自己在 `ld.so` 的引导上下文里
运行（读 `__gmon_start__`、然后掉进 `frame_dummy → register_tm_clones`），手工
映射的镜像满足不了这个前提。载荷真正需要的构造函数都在 `DT_INIT_ARRAY`。

## 两个必须知道的坑

**`orig_rax` 不复位会就地崩**。目标如果停在一个系统调用里（`pause()`、`clock_nanosleep`
之类），内核认为它还在 syscall 中，恢复执行时会为了重启 syscall 把 `rip` 减掉指令
长度——x86-64 上 `syscall` 正好 2 字节。于是执行流跳到上一条指令的尾巴，`SIGSEGV`，
而且 `PTRACE_SETREGS` 后读回的寄存器完全正常，只有 resume 之后才暴露。修法是在
设置寄存器时把 `orig_rax` 写成 `-1`。

**系统调用号不通用**。`mmap` 在 x86-64 上是 9、aarch64 上是 222；`munmap` 是 11 / 215。
用错不会干净地失败，而是让内核拿你的参数去跑另一个 syscall。

## 已验证

真机上的 arm64 QQ（`pid=79`，Debian bookworm，glibc 2.36）：

```
INJECT OK: {"base":"0xdeed9c36a000","size":"0x21000"}
[payload] aarch64 constructor ran in pid=79      ← 构造函数真的在 QQ 里跑了
UNLOAD: true                                     ← 映射已释放
```

注入前后 QQ 进程未崩溃、容器未重启。


## 诊断工具

QQ 一升级、hook 失效，"为什么"往往只有一行报错可看。这两个工具把过程拆开，
让原因可以直接读出来。两者都**只读文件、不碰进程**，可以在 QQ 正常运行、
正常登录时跑，不需要停服、不需要 attach。

### `hook_target_probe <wrapper.node>`

报出 QQ 目标模块的体检数据：build ID、PT_LOAD 布局、关键节位置、
导出的动态符号。判断"这次升级到底改了什么"从这里开始。

```bash
./hook_target_probe /opt/QQ/resources/app/wrapper.node
```

关注 build ID —— 载荷先校验它，对不上就整个拒绝加载。多数情况下
"把新 ID 记进去"就是全部修复工作。

### `hook_compat <wrapper.node> [payload.so]`

回答一个具体问题：**当前这份载荷，还能在这个 QQ 上找到它的目标吗？**

载荷不写死偏移，它在运行时去目标里按名字找这些东西：

| 锚点 | 影响的功能 |
|---|---|
| `msf::IMSFService` | MSFService 发送 / SessionInit |
| `nt::MSFCoreService` | MSFCoreService 发送 / 包状态回调 |
| `msf::internal::TaskManager` | 接收锚点链 |
| `nt::MSFService` | 已登录服务实例查找 |
| `nt::wrapper::IKernelMSFService` | kernel 侧服务句柄 |
| `msf::MSFSession` | 被包装的会话对象 |

工具逐个到 `wrapper.node` 的 `.rodata` 里找，报 `MISSING` 的那个就指明了
坏掉的是哪一部分。全部存在时退出码 0，有缺失时 1，可直接进 CI。

```bash
./hook_compat /opt/QQ/resources/app/wrapper.node \
              /app/runtime/native/snowluma-linux-arm64.so
```

带宽高时把载荷路径省略也行，那就只查内置锚点表。

**一处实现细节值得知道**：Itanium ABI 把类名写成 `<长度><名字>`，所以
`nt::MSFService` 是 `N2nt10MSFServiceE` —— 中间的 `10` 是字符串长度，不是
命名空间层级。手写这个数字极易出错（最初就写成了 `11`，于是把一个明明存在的
类报成 `MISSING`）。工具因此**只匹配标识符，再回头校验前缀的长度是否自洽**，
名字长度变了也不会误判。

### 已验证的行为

拿真实的 QQ 3.2.32（aarch64）和它配套的载荷跑：

```
build ID: 89c36b520f97c88081a9453bd6abb70c3452f156
All 6 anchors present.      ← 退出码 0，与"注入确实成功"一致
```

再把 `.rodata` 里两个类名抹成 `XXXX` 模拟重构：

```
nt::MSFCoreService   MISSING
IKernelMSFService    MISSING
2 of 6 anchors missing.     ← 退出码 1
```

精确指出了被破坏的两处，其余四项不受影响——这正是排查时需要的信息。


### `hook_vtable_list <wrapper.node> [--slots|--internal]`

列出目标模块里的 vtable 和它们所属的类。

默认只看 `.dynsym` 里导出的 `_ZTV`——在 QQ 3.2.32 上只有 16 个，全是
tinyxml2 / boost / std 的东西，MSF 一个都不在里面。**因为 QQ 不导出内部类。**

`--internal` 换一条路：扫 `.data.rel.ro`，找所有「某个槽位的值等于一个合法
type_info 地址」的位置。vtable 的布局是

```
[-2] offset-to-top
[-1] pointer to type_info      ← 扫的就是这个
[ 0] first virtual function
```

所以命中位置的下一个字才是 vtable 起点。这条路在同一个 QQ 上找出
**22292** 个 vtable，载荷要找的目标全部在内：

```
nt::MSFService                 0x87173e8   type_info 0x87177e0   45 槽
nt::MSFCoreService             0x8718f60   type_info 0x87193f8   53 槽
msf::internal::TaskManager     0x88b4aa0   type_info 0x88b4ad0    8 槽
msf::MSFSessionImpl            0x88b4368   type_info 0x88b4498   31 槽
```

一个类出现多条记录是正常的——每个基类子对象有自己的虚表。
这也正是 hook 不能写死单一地址、必须按「类名 + 槽位语义」定位的原因。

`--slots` 把每个槽位解析到它指向的函数名（能解析的话）。

**QQ 升级后的用法**：升级前存一份，升级后再存一份，`diff` 两份清单。
哪些类消失了、哪些槽数变了，一眼就能看出来，比读一行
`RTTI chain unresolved` 有用得多。


### `--slots [class-filter]`

把每个槽位解析成它指向的函数地址。QQ 的内部函数没有符号名，所以显示
`(unknown)` 是正常的——能不能命名并不重要，**槽位数和排列**才是。

```
nt::MSFService  (vtable 0x87173e8, 44 slots)
  [ 0] 0x138f56c      (unknown)
  [ 1] 0x138f7e4      (unknown)
  ...
```

完整的槽位统计（QQ 3.2.32 aarch64）：

| 类 | vtable 数量与槽数 |
|---|---|
| `nt::MSFService` | 44 / 61 主表，另有 9、1、4 |
| `nt::MSFCoreService` | 52 / 61 主表，另有 9、1、4、10 |
| `msf::internal::TaskManager` | 6 |
| `msf::MSFSessionImpl` | 30 / 6 |

`9 / 1 / 4` 这组在两个类里一模一样，是虚继承基类子对象的固定排布。
写 hook 时要改主表里的槽，不是这些基类子表。

**边界判定有个坑**：vtable 之后紧跟的常常是 type_info 对象，而它头两个字
是一个共享的 vtable 指针和名字指针——纯按字数数下去会把它算成虚表的一部分。
所以扫描在**第一个非可执行槽**处停下。


### 符号索引必须与 ELF 原始编号对齐（2026-11 修）

注入一个引用了多个外部函数的 `.so` 时报：

```
relocation references symbol index 3 out of range (1 symbols)
```

两个独立缺陷叠在一起：

**① `symbols_` 不能跳过无名条目。** 重定位按**编号**引用符号，原来的实现
只把有名字的符号塞进数组，于是第 n 项不再是第 n 号符号。改成
`symbols_.assign(symcount, ...)` 后按原索引写入，有没有名字都占位。

**② 符号总数不能只看 GNU hash 的 `max_bucket`。** 原来的逻辑是
`max_bucket < symoffset` 就直接取 `symoffset`，理由是"桶全空"。但
**桶全空 ≠ 没有符号** —— 符号仍然躺在 chain 数组里。一个 10 个符号的 `.so`
因为唯一的桶恰好为空，被算成 1 个符号。

可靠的做法是量 `SYMTAB` 和 `STRTAB` 之间的空隙：
`(strtab - symtab) / syment`。链接器把两者紧挨着放，这个除法是精确的
（实测 12 个符号，readelf 也是 12）。

**两个 bug 在 x86_64 上一样存在**，只是此前没拿"引用多个外部函数"的 `.so`
测过。修完后 arm64 真机（QQ 3.2.32，pid 78）注入验证通过：

```
INJECT: {"base":"0xfbed8ee9f000","size":"0x21000"}
证据:   aarch64 constructor ran in pid=78
UNLOAD: true
```

## 未实现

- TLS 重定位（`TLS_DTPMOD` / `TLS_TPOFF` / `TPREL`）
- IFUNC 符号解析
- 替目标挑选一个空闲线程做跳板（当前是自己暂停一个线程）

载荷若依赖这三者中的任何一个，会明确报错而不是静默失败。
