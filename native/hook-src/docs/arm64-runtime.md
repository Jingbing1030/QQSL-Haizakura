# arm64 的**真实执行**验证（不是只编译）

之前所有 arm64 结论都只到"交叉编译零警告"，运行从未验证过——本机是 x86，
读 `wrapper.node` 可以，执行 aarch64 代码不行。这一轮解决了。

## 怎么做到的

qemu-user **不需要装**，docker 里就有：

```bash
sudo docker run --rm --privileged multiarch/qemu-user-static --reset -p yes
```

它把 `qemu-aarch64-static` 注册进 binfmt_misc，之后内核遇到 aarch64
ELF 会自动转给 qemu。**没有下载任何包到本机**。

还缺动态链接器，从 cross 工具链里拿：

```bash
sudo apt-get install -y libc6-arm64-cross
# /usr/aarch64-linux-gnu/lib/ld-linux-aarch64.so.1
```

不建议注册 binfmt 直跑（`/lib/ld-linux-aarch64.so.1` 不存在），
显式指定解释器更可控：

```bash
/usr/aarch64-linux-gnu/lib/ld-linux-aarch64.so.1 \
  --library-path /usr/aarch64-linux-gnu/lib ./buildx-arm/slot_relay_test
```

## 真实执行通过了什么

| 测试 | 结果 | 意义 |
| --- | --- | --- |
| `hook_compat` | PASS | 6 anchors + 槽位布局，在 aarch64 上真的读出来了 |
| `slot_relay_test` | PASS（22 项） | trampoline 在真实 aarch64 执行下转发正确 |
| `vtable_hook_test` | PASS | 19 项槽位断言在 aarch64 上成立 |
| `vtable_inproc_test` | PASS | 进程内 hook 在 aarch64 上工作 |

`slot_relay_test` 这一项最有价值：它覆盖 6 个整型、8 个 double、混排、
变参（x86 的 `rax` 场景在 aarch64 是 `q0..q7` 计数）、传值结构体、
多 relay 并存、空 observer。**这是 x86 和 aarch64 调用约定差异最大的地方**，
之前只有"编译通过"，现在是"跑通了"。

## 跑不了的：ptrace 注入

```
no thread of pid ... could be seized (tid ...: Function not implemented)
```

`PTRACE_SEIZE` 在 qemu-user 下返回 `ENOSYS`。这是 qemu 用户态模拟的固有限制
——它不实现 ptrace，因为模拟层无法把一个"guest 线程"交给宿主 ptrace。
qemu-system（全系统模拟）才行，但那要一个完整的 aarch64 rootfs。

所以 arm64 的注入验证仍然只能在真机（oracle）上做。这一轮把**不依赖 ptrace
的部分全部验证完了**：hook 引擎、槽位定位、relay 转发、帧生成 —— 也就是
载荷本体的全部逻辑。

## 结论

arm64 上"能编译"升级为"能执行且逻辑正确"。剩下的唯一空白是 ptrace 注入，
它需要真机，与代码正确性无关。
