# 真正的发送入口：`nt::MSFService` 虚表槽 36

## 怎么找到的

不是靠静态逆向猜出来的，而是**旧版载荷自己的日志说出来的**。
在 `hz-test` 里让旧版 2.4.0 正常接管 QQ 后，载荷日志里出现：

```
trunk: nt::MSFService primary vtable off=0x87173e8 slots=44
trunk: slot 36 currently 0xf50a481fceb8 (offset 0x137ceb8)
trunk hook on nt::MSFService slot 36 vtable=0xf50a4f5973e8 original=0xf50a481fceb8
qr hook on nt::login::QRCodeLoginRequestImpl slot 11 vtable=0xf50a4f594228
```

三行信息解出了三件事：

| 信息 | 含义 |
| --- | --- |
| `primary vtable off=0x87173e8 slots=44` | `nt::MSFService` 的虚表在 `wrapper.node` 偏移 `0x87173e8`，共 44 个槽 |
| `slot 36 currently 0x...ceb8 (offset 0x137ceb8)` | 槽 36 的函数在 `wrapper.node` 偏移 **`0x137ceb8`** |
| `qr hook ... slot 11` | 顺带 hook 了 `nt::login::QRCodeLoginRequestImpl` 槽 11 |

## 验证

`wrapper.node` 有两个 LOAD 段：

```
LOAD off=0x0        vaddr=0x0        filesz=0x86992f8
LOAD off=0x869c2c0  vaddr=0x86ac2c0  filesz=0x3408a0
```

`0x137ceb8 < 0x86992f8`，落在第一段，**文件偏移等于 vaddr**，可以直接按偏移查。

虚表本身在文件里全为 0（`0x87173e8` 处前 4 个槽都是 `0x0`）——
因为 `wrapper.node` 是共享库，槽值由 `R_AARCH64_RELATIVE` 在装载时填充。
运行时读出来是 `0xf50a481fceb8`，基址 `0xf50a3a540000`，差值正好 `0x137ceb8`，**自洽**。

`0x137ceb8` 处的字节：

```
ff8301d1  fd7b02a9  f71b00f9  f65704a9  f44f05a9  fd830091  e8030091  f40303aa
```

解码前三条：

```asm
0xd10183ff  sub  sp, sp, #0x60
0xa9027bfd  stp  x29, x30, [sp, #0x20]
0xf9001bf7  str  x23, [sp, #0x30]
```

**标准的 aarch64 函数序言。** 这是一个真实函数，不是数据。

## 为什么这个发现重要

前面几轮我在两个方向上花了很多时间，都是错的：

1. **`npp_resident_dispatch` 的 7 槽表** —— 那是记账外壳，槽 `+0x30` 只登记回调，不发送
2. **`0x5610` 返回的 11 槽 RTTI 表** —— 另一份逆向确认它在返回前就被清零，是死代码

而真正在用的入口，**旧版的日志直接写着**。这说明一个方法论问题：
我一直在静态逆向主 .so，却没去读**旧版自己在运行时打印的诊断**。
它把自己的 hook 目标、vtable 偏移、槽号全打印出来了。

## 与 `[state+0xa0]` 的关系

另一个逆向方向（25 处 `blr [state+0xa0]`）是 **resident 跳板**——
那是载荷与"被注入的辅助代码"之间的调用约定，用于 fd 级的读写。

两者层次不同：

| 层 | 机制 | 用途 |
| --- | --- | --- |
| 虚表槽 | `nt::MSFService` 槽 36 @ `0x137ceb8` | **业务层**：把服务命令交给 QQ |
| resident 跳板 | `[state+0xa0]`，25 处 `blr` | **fd 层**：读写 socket、MSG_PEEK |

要发一条消息，走的是**上层**（虚表槽 36），不是下层。

## 下一步

1. 反汇编 `0x137ceb8`，确认它的参数：是不是 `(this, cmd, body, ...)` 形式
2. 看旧版 hook 之后在那槽里放了什么（它自己实现了一个替代函数）
3. 新版按同样思路：**hook 槽 36 + 在替代函数里构造请求**，或者**直接调用槽 36 的原函数**

第 3 条比之前所有方案都直接：不需要构造 `MSFRequest`，不需要伪造 `Cr::unique_ptr`，
只需要知道槽 36 原函数的签名。
