# T10 收包 hook：落地时踩到的四个坑

T5 已经把协议逆向清楚了（`docs/payload-recv-format.md` 961 行）。这一份只记
**把它装进真实进程时**才会出现的问题 —— 每一条都是先失败、再定位出来的。

---

## 一、进程内和进程外是两套机制，不能混用

`hook_vtable_slot_relayed(RemoteProcess&, ...)` 走 ptrace：
`process_vm_writev` 写槽、`mprotect` 解 RELRO。

**但载荷自己就在目标进程里，它没法 ptrace 自己。** 这是集成时才会暴露的
设计错误：测试驱动里一切正常，载荷一装 hook 就发现没有可用的入口。

已补 in-process 变体（`hook_vtable_slot_relayed_in_process`）：直接 `memcpy` 写槽，
`mprotect` 直接调用。两条路径语义一致，测试各自覆盖：

```
vtable_inproc  通过（进程内，本进程自己的类）
vtable_hook_e2e 通过（进程外，ptrace 打另一个进程）
```

## 二、recv 通道的目标是 **accepted peer**，不是 listen fd

第一版把帧写给监听 socket：

```cpp
send_frame(g_recv_fd, ...)   // g_recv_fd 是 listen 出来的
```

`write()` 到监听 socket 返回 `ENOTCONN`。而 emitter 的设计是**丢帧而不阻塞**
（这是对的，见第四节），于是症状是"一个包都没到"，日志里什么都没有。

recv 必须有自己的 accept 线程：接受一次 Node 侧连接，把那个 fd 记下来当发送目标。
控制通道不能兼这个活 —— 它正在服务 request/ack/reply，一个 recv connect 会排在后面。

## 三、帧头按结构体读会错，必须按字节偏移解

测试里第一版：

```cpp
struct Frame { uint32_t magic, request_id; uint16_t version, op; ... };
```

`uint16` 紧跟 `uint32` 会被 C 结构体对齐规则填充，`version` 和 `op` 读出来是 **0**。
现象是"载荷生成的帧 version=0 op=0"，看起来像载荷 bug，实际是测试读错了自己的帧。

改成逐字段 `memcpy` 到固定偏移，并 `static_assert(sizeof == 40)`。

实测正确的帧：

```
magic=0x31504851 version=1 op=6 status=7 value0=42
cmd_len=0 msg_len=0 body_len=0 request_id=0
```

## 四、emit 在无人接收时**必须丢帧，不能阻塞**

这条决定生死。hook 的回调跑在 QQ 自己的收包线程里；如果 Node 侧没连上而
emitter 阻塞等 socket buffer，**QQ 整个收包链路就停了**。

```cpp
if (g_recv_peer < 0) return false;   // 没 peer，直接返回失败
// send_frame 里面的 write 也不会阻塞到天荒地老：socket buffer 满时丢帧
```

测试专门验证了这一条：

```
ok   emit with no peer reports failure, not a hang
ok   no peer is attached
```

丢一帧可以恢复，冻住 QQ 不行。这个取舍写进了 `emit_packet` 的注释里。

## 五、`int` 返回值的符号

`remote_call` 返回 `uint64_t`。一个 `extern "C" int` 导出返回 `-1` 时，
低 32 位是 `0xFFFFFFFF`，按 64 位比较就是 **4294967295**。

测试里 `check(fd < 0)` 因此失败，而实际值确实是 -1。必须按 `int32_t` 截断再比。
这类错误在"验证句柄已释放"时特别容易误判成真 bug。

---

## 双通道生命周期实测

```
start -> 1
control socket appeared / recv socket appeared
control fd = 7 / recv fd = 8
stop  -> 两个 socket 都移除，recv fd = -1
（同进程内两轮，目标全程存活）
PASS
```

6 个导出与闭源载荷 ABI 完全一致：

```
snowluma_linux_hook_backend_version
snowluma_linux_hook_is_loaded
snowluma_linux_hook_start_dynamic
snowluma_linux_hook_stop_dynamic
snowluma_linux_hook_control_socket
snowluma_linux_hook_recv_socket
```
