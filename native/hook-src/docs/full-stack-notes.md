# 全链路测试：Node → addon → 载荷 → 客户端

单层测试各自通过，接缝仍然可能是错的。这个项目里**每一个真缺陷都出在接缝上**，
所以补了 `test/full_stack_test.mjs`：走真实 Node、真实 addon、真实 N-API，
只把目标进程换成 fake_target。

驱动方式：

```bash
sh test/run_full_stack.sh        # 起目标 + 注入 + 双周期
```

## 链路

```
Node.js
  └─ addon.loadModuleManualAsync(pid, payload.so)
       └─ ManualLoader::load()
            ├─ mmap / 重定位 / run_init
            └─ remote_call(handle.entry)   ← start_dynamic 在这里被调
                 └─ 创建 control.sock + recv.sock，起两个线程
  └─ 客户端 connect → op1 hello → op1 hello 回包
  └─ addon.unloadModuleManualAsync(pid, handle)
```

实测：

```
handle: base=0x7e24512f8000 entry=0x7e24512f9e50 size=0x6000
hello reply: magic=0x31504851 op=1 version=1
```

## 缺陷 5：unload 绕过了 ManualLoader

`unloadModuleManualAsync` 直接 `remote_munmap`：

```cpp
const bool ok = remote.remote_munmap(handle.base, handle.size);   // 旧代码
```

后果两件：
1. `DT_FINI_ARRAY` 不跑，析构函数看不到正常关闭。
2. **`stop_dynamic` 不被调用** → control/recv 两个 socket 永远不 unlink。

第二次注入时 bind 失败 `EADDRINUSE`。现象是"第二次注入坏了"，
把人引向注入器，而真正原因是"没人告诉载荷停下"。

修：走 `ManualLoader::unload`，并在里面显式调 stop 入口。
handle 需要带 `path`（unload 时只有 handle，没有文件路径就找不到
`DT_FINI_ARRAY` 和 stop 符号）。

## 缺陷 6：stop_dynamic 不 join，unmap 把线程脚下的代码抽走

`stop_dynamic` 原来只置标志然后立刻返回：

```cpp
g_stop_listener = 1;
...
g_thread_live = false;   // ← 只是记账，线程还在跑
return 0;                // ← 调用方立刻 munmap
```

两个线程（listener、recv accept）还在 `accept()` / `usleep()` 里。
镜像一被 unmap，线程恢复执行就跳进已释放的页 → SIGSEGV →
**整个线程组死亡**（不只是 hook）。

现象：第二次注入时 `target thread ... exited while attaching`，
目标进程**直接死掉**。

### 为什么当初写了"不要 join"

T7 的注释说：

> Joining from inside the hook runs on the ptrace call path, and waiting for a
> thread that is blocked in accept() would hang the caller.

这个担心是对的，但结论错了。**不能 join 的是"没先唤醒 accept 的 join"。**
`stop_dynamic` 在 join 之前已经 `shutdown(g_listen_fd, SHUT_RDWR)`，
阻塞的 accept 会立刻返回，循环看到标志就退出 —— join 不会挂。

修：
- listener 和 recv 线程都改成 **joinable**（去掉 `pthread_detach`），句柄保存下来。
- `stop_dynamic` 先 shutdown 唤醒，再 `pthread_join` 两个线程，**然后**才返回。
- recv 线程的内层 peer 等待循环也要看 `g_stop_listener`，否则 join 会等对端断开。

还顺手发现 `ListenerArgs` 曾是栈变量（线程读它时函数已返回）——
已被前人改成 `static`，这次确认它确实是 static。

## 双周期验收

```
first  cycle: map → sockets → hello → unload → sockets gone
second cycle: map → sockets → hello → unload → sockets gone
target: state=S, 99 threads, 全程存活
```

**第二个周期是关键**：它同时覆盖缺陷 5（不 unlink 会 EADDRINUSE）和
缺陷 6（不 join 会杀进程）。只测一次注入的话，这两个都不会暴露。

## 为什么不做成 ctest

它需要两个 ctest 管不了的东西：
- 一个带 `wrapper.node` 映射的活目标进程
- sudo（yama ptrace_scope）

做成 ctest 要么在没有这些的机器上静默跳过，要么因为和代码无关的原因失败。
所以是脚本，`test/run_full_stack.sh`。
