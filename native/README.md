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

## 未实现

- TLS 重定位（`TLS_DTPMOD` / `TLS_TPOFF` / `TPREL`）
- IFUNC 符号解析
- 替目标挑选一个空闲线程做跳板（当前是自己暂停一个线程）

载荷若依赖这三者中的任何一个，会明确报错而不是静默失败。
