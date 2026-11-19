# 测试策略

本文写三件事：测什么、怎么手工跑、以及**哪些验证过、哪些没验证过**。

最后一部分最重要，请优先看第 6 节。

---

## 1. 三层测试

| 层 | 覆盖对象 | 需要特权 | 当前状态 |
| --- | --- | --- | --- |
| 单元 | `ElfImage` 解析、`ProcessEnumerator` | 否 | ✅ 通过 |
| 集成 | 假目标 + 真注入（`ptrace`/`process_vm_*`） | 是（同 uid 或 CAP_SYS_PTRACE） | ❌ **不通过** |
| 端到端 | 真 QQ 进程 | 是 + 真 QQ | ❌ 未执行 |

### 为什么这么分层

单元层完全不碰别的进程，所以能在 CI、在容器、在任何机器上跑，出问题也容易定位。
集成层用假目标代替 QQ——**崩溃的代价从「QQ 掉线」降到「测试进程消失」**，
而它能验证的链路和真目标几乎一样长（attach → mmap → copy → relocate → init）。
端到端只在最后做，用来确认「对真实的 wrapper.node 也能成立」。

这个分层顺序是有意的：先用最便宜的层把 bug 挡掉，再往上走。

---

## 2. 三个测试件的作用

### `test/fake_target.cc` — 假目标进程

```cpp
// test/fake_target.cc:30-32
int main(int argc, char** argv) {
  const char* wrapper = argc > 1 ? argv[1] : "/tmp/fake-wrapper.node";
  const int seconds = argc > 2 ? std::atoi(argv[2]) : 120;
```

做两件**都必须做**的事：

```cpp
// test/fake_target.cc:34-38
  // Map the file so /proc/<pid>/maps contains "wrapper.node", which is how the
  // addon identifies the QQ browser process.
```

1. **`mmap` 一个名字叫 `wrapper.node` 的文件** —— 让 `find_main_processes()` 认出它。
   注意：这里故意不 `dlopen`。
2. **再 `dlopen` 同一个文件**：

```cpp
// test/fake_target.cc:54-57
  // Also load it for real: the injector resolves the payload's undefined symbols
  // against this process's dynamic symbol table, and only a dlopen'd library
  // appears there.
  void* handle = ::dlopen(wrapper_resolved, RTLD_NOW | RTLD_GLOBAL);
```

两步缺一不可。`mmap` 只让它出现在 `maps` 里（进程识别用），符号解析走的是
`/proc/<pid>/maps` + 磁盘 ELF，所以理论上 `mmap` 就够——但 `dlopen` 保证它真的
在目标里被正常加载，更接近 QQ 的真实情况。

然后 `sleep`，给注入留窗口。

### `test/fake_wrapper.cc` — 提供符号的假 `wrapper.node`

只有 20 行，扮演 `wrapper.node`。提供：

```cpp
// test/fake_wrapper.cc:7-16
extern "C" volatile std::uint64_t hz_payload_marker = 0;
extern "C" volatile std::uint64_t g_target_counter = 0;

extern "C" std::uint64_t hz_target_side_effect(std::uint64_t delta) {
  g_target_counter += delta;
  std::printf("[target] side effect called, counter=%llu\n",
              static_cast<unsigned long long>(g_target_counter));
  std::fflush(stdout);
  return g_target_counter;
}
```

- `hz_target_side_effect` —— 载荷要调用的函数，验证**跨模块符号解析**。
- `hz_read_counter` / `hz_read_marker` —— 让测试可以从外部读回结果，验证副作用真发生了。

它是 `.node` 后缀但**不是** Node addon，没有任何 N-API 代码，只是借用后缀让文件名
匹配 `wrapper.node`。

### `test/payload.cc` — 被注入的载荷

```cpp
// test/payload.cc:22-32
extern "C" void hz_payload_constructor() {
  g_local_state += 1;
  const std::uint64_t observed = hz_target_side_effect(1);
  hz_payload_marker = 0x48415a41ull;  // "HAZA"
  std::printf("[payload] constructor ran: target counter now %llu, local=%llx\n",
              static_cast<unsigned long long>(observed),
              static_cast<unsigned long long>(g_local_state));
  std::fflush(stdout);
}

__attribute__((constructor)) static void hz_register_constructor() {
  hz_payload_constructor();
}
```

一个构造函数就验证了整条链：

| 载荷里的动作 | 验证了什么 |
| --- | --- |
| `g_local_state += 1` | 读写自己的 `.data`（需要 `R_X86_64_RELATIVE` 已修复） |
| 调 `hz_target_side_effect()` | 跨模块符号解析 + `JUMP_SLOT` 已填 + PLT 能跳 |
| `hz_payload_marker = ...` | 写目标侧 `GLOB_DAT` 指向的变量 |
| 构造函数被执行 | `.init_array` 的地址换算与 `remote_call` 都对 |

`g_local_state` 的初值 `0x1122334455667788` 不是随便选的：它强制生成
`R_X86_64_RELATIVE`（非零初值 → 必须重定位），而全零的 `.bss` 不会。

---

## 3. 手工跑注入测试

### 3.1 构建

```bash
cd /home/ubuntu/hook-rewrite
mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release -DARCH_TAG=linux-x64
make -j2
```

产物：

| 文件 | 说明 |
| --- | --- |
| `haizakura-hook-linux-x64.node` | addon |
| `fake_target` | 假目标 |
| `fake-wrapper.node` | 假 `wrapper.node` |
| `payload.so` | 载荷 |

`ARCH_TAG` 决定 `OUTPUT_NAME`（`CMakeLists.txt:53`）。不传会得到
`haizakura-hook-.node`（空标签）。

### 3.2 跑单元自测

```bash
./hook_selftest ./payload.so qq
```

输出形如：

```
ELF: ./payload.so
  machine=62 type=3 entry=0x0 base=0x0 size=0x5000
  ok   is ET_DYN
  ok   image window is non-empty
  ok   has program headers
  ok   has a dynamic section
  ok   has dynamic symbols
  ok   has relocations
  ok   all PT_LOAD segments fit the image window
  note: napi_register_module_v1 not exported by this image
  init fns=2 fini fns=2 needed=1 relocs=15
  symbol count: 13

Processes matching 'qq':
  candidates: 0
  ok   enumerate_processes completed

PASS (0 failures)
```

注意 `napi_register_module_v1` 那两行对 `payload.so` 会走 `note:` 分支
（载荷不导出这个符号），对 addon 自己的 `.node` 才会进 `check`。两种都是通过。

`main()` 的退出码就是失败数（`test/selftest.cc:103`），可以直接接 CI。

### 3.3 跑集成测试（关键：要先处理 `ptrace_scope`）

⚠️ **这一步有个必踩的坑**：现代发行版默认
`/proc/sys/kernel/yama/ptrace_scope = 1`，含义是「只能 ptrace 自己的后代」。
如果先起 `fake_target` 再另起一个 node 去注入，**不是后代关系**，会直接失败：

```
LOAD FAILED: PTRACE_SEIZE and PTRACE_ATTACH both failed for pid 12345: Operation not permitted
```

这不是代码 bug。三个正确做法（选一个）：

**做法 A（推荐，无需特权）**：让 node 用 `child_process.spawn` 起 `fake_target`，
这样 fake_target 是 node 的后代，`ptrace_scope=1` 允许。

```bash
cat > /tmp/inject-test.js <<'EOF'
const { spawn } = require('child_process');
const addon = require('/home/ubuntu/hook-rewrite/build/haizakura-hook-linux-x64.node');

// fake_target 必须是本进程的子进程，否则 ptrace_scope=1 会拒绝
const child = spawn('/home/ubuntu/hook-rewrite/build/fake_target',
                    ['/home/ubuntu/hook-rewrite/build/fake-wrapper.node', '20'],
                    { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', d => process.stdout.write('[target] ' + d));

setTimeout(async () => {
  try {
    const h = await addon.loadModuleManualAsync(
        child.pid, '/home/ubuntu/hook-rewrite/build/payload.so');
    console.log('handle:', h);
  } catch (e) {
    console.log('LOAD FAILED:', e.message);
  }
  setTimeout(() => { child.kill('SIGKILL'); process.exit(0); }, 2000);
}, 700);   // 等它 map + dlopen 完
EOF

node /tmp/inject-test.js
```

**做法 B**：`sudo sysctl -w kernel.yama.ptrace_scope=0`（临时放宽，重启失效）。

**做法 C**：`sudo -E node /tmp/inject-test.js`（root 有 CAP_SYS_PTRACE，绕过 yama）。

### 3.4 打开调试日志

代码里所有 ptrace 状态迁移都由环境变量控制：

```cpp
// src/remote.cc:19-22
bool debug_enabled() {
  static const bool on = ::getenv("HZ_DEBUG") != nullptr;
  return on;
}
```

```bash
HZ_DEBUG=1 node /tmp/inject-test.js
```

这是**唯一**能看见 stop/event/信号细节的手段。注入 bug 基本都是 stop 状态问题，
不开这个基本查不出来。

### 3.5 一次成功注入应该看到什么

期望的（理想）输出：

```
[target] pid=12345 wrapper mapped at 0x... and dlopen'd, sleeping 20 s
[hz] syscall gadget at 0x...
[hz] verify X segment vaddr=0x1000 dest=0x... got=16 same=1
[hz] init_array runtime contents (2 entries):
[hz] call returned rax=0x...            ← mmap 返回的 base
[hz] call returned rax=0x1 / [payload] constructor ran: target counter now 1, local=1122334455667789
handle: { base: ..., entry: ..., size: ..., exceptionTable: 0n }
```

`[payload] constructor ran` 这一行是**整条链成功的唯一确凿证据**：它是被注入的代码
在目标进程里、通过解析到的目标符号、打印出来的。

### 3.6 卸载

```javascript
const h = await addon.loadModuleManualAsync(pid, path);
await addon.unloadModuleManualAsync(pid, h);
```

注意当前 `unloadModuleManualAsync` **不走** `ManualLoader::unload()`，它直接
`remote_munmap`：

```cpp
// src/addon.cc:366-379
      [pid, handle]() {
        hz::RemoteProcess remote(pid);
        remote.attach();
        const bool ok = remote.remote_munmap(handle.base, handle.size);
        remote.detach();
```

也就是说**析构函数不会执行**。`ManualLoader::unload()` 里的 `fini_fns_` 循环
在 N-API 路径上根本到不了。这是一个行为差异，见 `REWRITE-STATUS.md`。

---

## 4. 假目标与真 QQ 的差异

必须清楚这个 gap，否则集成通过不等于端到端通过：

| 维度 | `fake_target` | 真 QQ |
| --- | --- | --- |
| 进程名 | `fake_target` | `qq` |
| `wrapper.node` | 20 行的假库 | 真实、巨大、依赖复杂 |
| 线程数 | 1 | 几十个 |
| 子进程 | 无 | zygote / renderer / GPU |
| 目标繁忙度 | `sleep()` 中，随时可停 | 持续跑事件循环，停点不确定 |
| 符号依赖 | 1 个函数 | 大量 MSF 内部符号 |
| 崩溃代价 | 测试进程消失 | QQ 掉线 |
| `ptrace_scope` | 同 A 做法 | 生产环境通常需 root/适当权限 |

**最容易被忽略的差异**：真 QQ 是多线程的，而 `PTRACE_INTERRUPT` 只作用于**主线程**
（`pid_` 那条）。`remote_syscall6`/`remote_call` 改的是主线程的寄存器，但目标的其他线程
**仍在并发运行**。如果那些线程在我们映射的窗口里读写（不太可能），或者在我们替换
`GOT` 项时正好在读同一项，就会有竞争。假目标单线程，这个风险完全测不出来。

---

## 5. 测试里没有的东西

- **没有测试框架**。`test/selftest.cc` 手写 `check()` 计数，不是 gtest/catch2。
  目的是零依赖、能直接 `make` 出可执行文件。
- **没有 CTest 用例注册**。`CMakeLists.txt:68` 有 `enable_testing()`，但没有
  `add_test()`，所以 `ctest` 是空的。要跑得手工执行 `./hook_selftest`。
- **没有自动化集成测试**。第 3.3 节那段 JS 是手工脚本，没进仓库、没进 CI。
- **没有 aarch64 测试**。当前机器是 x86_64，aarch64 分支从未编译过——
  更没有运行过。见 `REWRITE-STATUS.md`。

---

## 6. 已验证 / 未验证（诚实清单）

### ✅ 实际验证过

以下均为本机 x86_64、实测命令见括号：

| 项 | 证据 |
| --- | --- |
| ELF 头/段表/动态段解析 | `hook_selftest payload.so` 全项 ok |
| PT_LOAD 窗口计算 | `all PT_LOAD segments fit the image window` ok |
| 符号表 + GNU hash 定位 | `symbol count: 26`，能按名字查到符号 |
| RELA 解析（含 `.rela.plt`） | `relocs=15`，`JUMP_SLOT=4`，与 `readelf -r` 一致 |
| 进程枚举不抛异常 | `enumerate_processes completed` ok，0 命中也不崩 |
| `wrapper.node` 识别 | 假目标 `maps` 中 6 行匹配，`find_main_processes` 能选出它 |
| `PTRACE_SEIZE` 附加 | 真实注入中成功 |
| `PTRACE_INTERRUPT` + `waitpid` | `stopped pid=... sig=5 event=128` |
| syscall 跳板定位 | `syscall gadget at 0x7f8f20428902`（libc 可执行段内） |
| 远程 `mmap` | `rax=0x7f8f20ad1000`，`rip` 停在 `site+2` |
| 远程 `munmap` | 返回 `rax=0x0` |
| 远程寄存器保存/还原 | `detach` 后目标仍存活 |
| 段拷贝 | `verify X segment ... same=1` |
| `R_X86_64_RELATIVE` 重定位 | `init_array` 运行时值 = `base+0x1180` / `base+0x10c0` |
| `remote_call` 调真实映射里的函数 | 见下方说明 |
| 失败路径回收映射 | `catch` 分支 `remote_munmap` 已执行（日志可见 munmap 调用） |

关于 `remote_call`：**它对 libc 的 `getpid` 是成功的**，实测返回了正确的 pid：

```
remote_call fn=0x7f8f204ffa00 argc=0 region=0x7f8f20ad1000
[hz] after single step: sig=5 rip=0x7f8f204ffa01
[hz] call returned rax=0x26a415
remote_call returned 2532373  (expect 2532373) -> OK
```

（`0x26a415` = 2532373，与子进程 pid 完全一致。）

所以「`remote_call` 的返回值传递」是通的。**但它对注入载荷的调用是失败的**，
原因见下。

### ❌ 未通过 / 未验证

| 项 | 状态 | 原因 |
| --- | --- | --- |
| **`remote_call` 到手工映射的映像** | ❌ 失败 | `scratch_buffer` 缺 `PROT_EXEC`，返回跳板不可执行 |
| **`.init_array` 构造函数执行** | ❌ 失败 | 同上，`load()` 在 `run_init` 抛错 |
| **端到端 `loadModuleManualAsync`** | ❌ 失败 | 汇总为 `LOAD FAILED` |
| 跨模块符号解析（真跑通） | ⚠️ 代码路径已执行，未得到成功结果 | 卡在上一条 |
| `unload` 的析构函数 | ❌ 未验证 | N-API 层直接 `munmap`，不调 `unload()` |
| aarch64 任何功能 | ❌ 未编译、未运行 | 无 arm64 环境 |
| 真 QQ 进程 | ❌ 未执行 | 本机无 QQ |
| 多线程目标下的竞争 | ❌ 未测 | 假目标单线程 |

### 一次失败运行的实际输出

为免「不通过」被含糊带过，这里贴当前的真实失败输出：

```
[hz] verify X segment vaddr=0x1000 dest=0x7ad3c05ed000 got=16 same=1
[hz] image_base=0x0 init_count=2 legacy_init=0x1000
[hz] init_array runtime contents (2 entries):
[hz]   [0] at 0x7ad3c05efdc8 = 0x7ad3c05ed180  (base+0x1180)
[hz]   [1] at 0x7ad3c05efdd0 = 0x7ad3c05ed0c0  (base+0x10c0)
[hz] remote_call fn=0x7ad3c05ed180 rsp=0x7ad3c05eb038 (baseline rip=0x7ad3c02a060e)
[hz] applied rip=0x7ad3c05ed180 rsp=0x7ad3c05eb038 (wanted 0x7ad3c05ed180/0x7ad3c05eb038)
[hz] stop sig=11 rip=0x7ad3c05ed17e (sled 0x7ad3c05cb000..0x7ad3c05cb040)
[hz] fault detail: signo=11 code=1 addr=0xdb
LOAD FAILED: call to 0x7ad3c05ed180 raised signal 11 at rip 0x7ad3c05ed17e
```

前四行说明**前面所有步骤都是对的**（段拷贝 `same=1`，两个 `RELATIVE` 重定位值精确
落在 `base+0x1180` / `base+0x10c0`）。失败从 `remote_call` 开始，故障 `rip`
落在 sled 区域 `0x7ad3c05cb000..0x7ad3c05cb040` 之内。

`addr=0xdb` 这个 `si_addr` 是 `si_code=1`（`SEGV_MAPERR`）下的访问地址，
指向一个很小的地址（`0xdb`），说明代码解引用了未初始化/被清零的指针——
与「跳板所在页不可执行」和「GOT 项为 0」两类原因都吻合。

---

## 7. 想复现/扩展测试时注意

1. **别用 `pgrep -f`** 取 pid。`pgrep -f "fake_target /tmp/wrapper.node"` 会匹配到
   启动它的 shell 或 node 进程；用 `pgrep -x fake_target`。
2. **`fake_target` 的第一个参数是 `wrapper.node` 的路径**，必须让文件名以
   `wrapper.node` 结尾，否则进程识别找不到。
3. **测试窗口**：`fake_target` 默认 `sleep 120` 秒。注入必须在窗口内完成，
   否则会得到 `target process <pid> does not exist`。
4. **清场**：上一次的 `fake_target` 没杀掉会占着 `wrapper.node` 映射，
   多实例存在时 `find_single_main_process` 会拒绝猜。跑前 `pkill -x fake_target`。
