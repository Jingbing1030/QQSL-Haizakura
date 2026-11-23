# op 2 就是发送通道（推翻此前两轮结论）

## 三次修正的完整历史

这个问题我判断错了两轮，两次错在不同地方，都值得记录。

| 轮次 | 当时的结论 | 依据 | 错在哪 |
| --- | --- | --- | --- |
| 第一轮 | op 2 发送路径是 P0 主功能缺口，必须实现 | 4 条白名单命令名（`hb_pc_grab`、`OidbSvcTrpcTcp.0x7c2_5`）看着像发送 | 没走到 `send` 就下结论 |
| 第二轮 | op 2 白名单是空操作，旧版从不发送任何消息 | 2.4.2 里接受分支只有 2 个 call；`send@plt` 全库 2 处都在自有 socket | **拿错了分析对象**（2.4.2 ≠ 生产 2.4.0） |
| 第三轮（本次） | **op 2 就是唯一的发送通道，且 2.4.0 无白名单** | 见下 | — |

## 决定性证据

### 1. JS 侧 `client.send()` 构造的就是 op 2

生产 `index.mjs`（12.8MB）里 `QQHookClient.send` 的实现：

```js
async send(cmd, body, { wantReply = true, ackTimeoutMs, replyTimeoutMs } = {}) {
  await this.connect();
  const requestId = this.allocateRequestId();
  const bodyBytes = toBuffer(body);
  const payload = encodeFrame({
    op: 2,
    requestId,
    flags: wantReply ? PipeFlagWantReply : 0,
    cmd,
    body: bodyBytes
  });
  ...
}
```

`op: 2`、`flags: wantReply ? 1 : 0`、`cmd` = 服务命令名、`body` = 原始字节。
**和我们的 `op 2` 完全对得上**，`flags` 的 bit0 就是 wantReply（与我们实现的 `kFlagWantReply = 1` 一致）。

### 2. 发送消息的完整链路

```
send_msg action
  → sendGroupMessage(ref, groupId, message)
  → parseMessage(...)            构造消息元素
  → sendPacket(serviceCmd, body)  ← serviceCmd = "MessageSvc.PbSendMsg"
  → this.client.send(serviceCmd, body, { wantReply: true })
  → op 2 帧（40 字节头 + cmd + body）
  → 载荷
  → RTTI 链解析 MSFService send features
  → 调用 QQ 真正的发送函数
```

### 3. 生产 JS 里出现的 29 个服务命令

从 `index.mjs` 里提取的全部服务命令字符串：

```
HttpConn.0x6ff_501                                ← highway/上传
MessageSvc.PbSendMsg                              ← ★ 发消息
OidbSvcTrpcTcp.0x11c4_100  0x11c5_100             ← 群相关
OidbSvcTrpcTcp.0x11e9_100  0x11ea_100
OidbSvcTrpcTcp.0x126d_100  0x126e_100
OidbSvcTrpcTcp.0xEB7_1
trpc.basic.corp.Datacard.SsoCorpInfo
trpc.group.long_msg_interface.MsgService.SsoRecvLongMsg
trpc.group.long_msg_interface.MsgService.SsoSendLongMsg
trpc.msg.msg_svc.MsgService.SsoC2CRecallMsg       ← 私聊撤回
trpc.msg.msg_svc.MsgService.SsoGroupRecallMsg    ← 群撤回
trpc.msg.msg_svc.MsgService.SsoReadedReport      ← 已读上报
trpc.msg.olpush.OlPushService.MsgPush            ← ★ 收消息推送
trpc.msg.register_proxy.RegisterProxy.SsoGetC2cMsg    ← 查私聊消息
trpc.msg.register_proxy.RegisterProxy.SsoGetGroupMsg  ← ★ 查群消息
trpc.msg.register_proxy.RegisterProxy.SsoGetRoamMsg   ← 查漫游
trpc.public_qzone.entrance_ctrl.EntranceCtrl
trpc.public_qzone.interaction.UFOComment
...（其余为群管理/资料类）
```

### 4. 2.4.2 的白名单在生产版本里不存在

- 2.4.0（生产，335,040 B）里 `hb_pc_grab`、`OidbSvcTrpcTcp` 字符串出现 **0 次**
- 2.4.2（425,216 B）里有 `sub_27820` 的 4 条白名单
- `MessageSvc.PbSendMsg`、`SsoGetGroupMsg` **都不在那 4 条里**

**所以：2.4.2 的白名单只是 4 条兼容命令，不是发送通道的准入限制。生产版本对 op 2 的任意 cmd 都放行。**

## 对我们实现的意义

**我们不需要"实现发送功能"——我们需要让 op 2 真正把请求交给 QQ。**
这是同一件事，但性质完全不同：

- 不是「发明一套 QQ 协议客户端」（那是巨量工作，且容易做错）
- 而是「**按服务命令名 + 原始 body 字节，转交给 QQ 自己的 MSF 发送入口**」

QQ 自己会做 protobuf 编码（body 就是已经编好的 pb）。载荷只负责转交。

**待解决的核心问题**：2.4.0 怎么找到那个入口（`MSFService send features`）?
它的错误字符串说得很清楚——靠 **RTTI 链解析**。这是目前唯一挡在实现路上的技术问题。

---

## 2.4.0 如何找到 QQ 的发送入口：已完成逆向

### 核心机制：按名字定位 `wrapper.node`，然后在其中解析运行时服务结构

2.4.0 里 `"wrapper.node"` 字符串的引用点有 **4 处**：

```
0x5828   解析入口（主路径）
0x13754
0x243c8
0x3773c
```

### 主解析函数：`0x5610`

栈帧 `0x6f0 + 96` 字节。它的结构是：

**① 混淆初始化（`0x5634`–`0x56d0`）**

```asm
5634  mov  w8, #0xfc2e ; movk w8, #0x7810, lsl #16     ; 0x7810fc2e
5644  mov  w25, #0x79b9 ; movk w25, #0x9e37, lsl #16   ; 0x9e3779b9  ← murmurhash 常量
5648  mov  w24, #0xca6b ; movk w24, #0x85eb, lsl #16   ; 0x85ebca6b  ← murmurhash 常量
5680  mov  w23, #0xeb2d ; movk w23, #0x27d4, lsl #16   ; 0x27d4eb2d  ← murmurhash 常量
```

标准的 `x ^= x>>16; x *= 0x85ebca6b; x ^= x>>13; x *= 0xc2b2ae35; ...` 混合序列。
作用是把一个**32 位输入**（`w0` 参数）散列成后续用的种子。

**② 按输入位切换算术路径（`0x56f0` / `0x570c`）**

```asm
56f0  tbnz w21, #10, 570c    ; 看输入的 bit10
56fc  bic  x10, x9, x8       ; 路径 A：先清位再减
5700  sub  x8, x8, x9
5704  add  x8, x8, x10, lsl #1
...
570c  orr  x9, x9, #0x1      ; 路径 B：先置位再加
5718  and  x10, x9, x8
571c  add  x8, x9, x8
5720  sub  x8, x8, x10, lsl #1
```

两条路径在数学上等价于同一个运算（`a+b-2*(a&b) == a^b` 的变形），
**按输入位分支纯粹是为了让静态分析难以还原**。这是刻意设计的反分析手法。

**③ 反篡改校验（`0x5740`–`0x57d8`）**

```asm
5740  mov  x25, #0xdef0 ; movk #0x9abc ; movk #0x5678 ; movk #0x1234
                          → 0x123456789abcdef0        ; ★ 魔数
5758  bl   __errno_location
5764  bl   getpid                                     ; ★ 读自己的 pid
57c0  bl   process_vm_readv                           ; ★ 读自己内存 8 字节
57c8  cmp  x0, #0x8          ; 必须恰好读到 8 字节，否则失败
57d0  ldr  x8, [sp, #672]
57d4  cmp  x8, x25           ; 读到的值必须 == 0x123456789abcdef0
57d8  b.ne 5b54              ; 不等 → 失败
```

**这是自完整性校验**：往自己进程的某个地址读 8 字节，必须等于固定魔数
`0x123456789abcdef0`。若被 patch 或内存被改，校验失败，解析不进行。
（同时也起到反调试作用：`process_vm_readv` 在多数调试器下会失败或返回异常。）

**④ 定位 `wrapper.node`（`0x5828`–`0x5844`）**

```asm
5828  adrp x2, 0x44000
5830  add  x2, x2, #0x94e     ; x2 = "wrapper.node"
583c  mov  w1, #0xc           ; w1 = 12（字符串长度）
5840  mov  w4, wzr
5844  bl   0x2d6ac            ; ★ 按名字查模块
```

**`0x2d6ac` 就是"按名字找已加载模块"的函数**，参数是 `(名字指针, 名字长度, ...)`。
拿到 `wrapper.node` 的基址后，后续代码在它里面按**硬编码偏移**取服务结构。

### 为什么二进制里搜不到 QQ 的类名

因为 **2.4.0 根本不按类名匹配**。它：

1. 用 `wrapper.node` 基址 + **硬编码偏移**直接取对象
2. 用魔数校验读到的内容对不对（`0x123456789abcdef0` 这类）
3. 拿不到就往错误字符串里报 `RTTI chain unresolved`

所谓 `RTTI chain` 是**误导性的措辞**——它暗示遍历 type_info 继承链，
但实际是从 `wrapper.node` 里按偏移抓取、再用魔数/虚表指针做**形状校验**。
这也解释了为什么 `strings` 里一个 QQ 内部类名都没有。

### 验收检查（`0x6530`–`0x65f8`）

解析完成后逐项检查结果字段是否为零，为零就写对应错误消息：

```asm
6540  adrp/add → "runtime service structures could not be read or resolved"
6558  ldr  x9, [sp, #976]
655c  cbnz x9, 6574              ; 非零 → 这项 OK
6560  adrp/add → "MSFService send features missing or ambiguous"
...
6574  ldr  x9, [sp, #808]
6578  cbz  x8, 6594
657c  cbnz x9, 6594
6580  adrp/add → "MSFService receive anchor/TaskManager RTTI chain unresolved"
...
65f8  adrp/add → "MSFCoreService send features missing or ambiguous"
```

栈槽对应关系：

| 栈槽 | 含义 | 缺失时报 |
| --- | --- | --- |
| `sp+880` | 服务结构主体 | `runtime service structures could not be read or resolved` |
| `sp+976` | MSFService 发送能力 | `MSFService send features missing or ambiguous` |
| `sp+808` | MSFService 接收 anchor | `MSFService receive anchor/TaskManager RTTI chain unresolved` |
| `sp+824..840` | 接收回调三件套 | `MSFCoreService packet-state callback/... unresolved` |
| `sp+1160/1168` | SessionInit | `MSFService SessionInit/RTTI chain unresolved` |
| `sp+1128` | MSFCore 发送 | `MSFCoreService send features missing or ambiguous` |
| `sp+1208` | 包转换器/分配器 | `MSFCoreService packet converter/native allocator unresolved` |

### 对我们实现的意义（重要）

**这条路我们无法照抄，也不该照抄。** 理由：

1. 它依赖 `wrapper.node` 里的**硬编码偏移**，QQ 一升级就失效——这正是那些
   `... unresolved` 错误消息存在的原因（旧版自己也会随版本失效）
2. 它带**反篡改校验**和**混淆**，是为了对抗分析，不是技术必需

**但这也告诉我们一个可行得多的方向**：既然 QQ 的 `wrapper.node` 导出了
大量符号（我们之前已经在它上面装了 200 个 hook 并成功调用），
那么我们**不需要**去猜偏移，可以直接用 `dlsym`/符号遍历找到服务入口。

也就是说：**旧版用偏移猜测（脆弱），我们可以用符号查找（稳健）。**
这是在"行为等价"前提下的合理实现差异，且比旧版更好维护。

---

## `wrapper.node` 的导出符号：收发 API 全都在

`wrapper.node`（144,561,472 字节，aarch64，`/opt/QQ/resources/app/wrapper.node`）
有 `.dynsym`（36,600 字节，**1,522 个动态符号**），**没有 `.symtab`**（已剥离）。

### MSF::MSFSDK 的 79 个导出符号（摘关键）

```
0x412a85c  MSFSDK::sharedInstance()                                   ← 拿单例
0x412a8e8  MSFSDK::init(int, const Cr::string&, const Cr::string&,
                        const MSFGeneralConfigure&, IMSFCallback*)    ← 初始化
0x412b1a4  MSFSDK::init(int, const Cr::string&, const Cr::string&,
                        IMSFCallback*)
0x412b328  MSFSDK::sendPacket(Cr::unique_ptr<MSFRequest>)             ← ★ 发送
0x412b7f8  MSFSDK::pack(Cr::unique_ptr<MSFRequest>)                   ← ★ 打包
0x412ba58  MSFSDK::unpack(Cr::unique_ptr<Cr::string>, const Cr::string&) ← ★ 解包
0x412b578  MSFSDK::cancelPacket(int)
0x412b4b8  MSFSDK::getNextPacketSeq()
0x412b650  MSFSDK::connect()
0x412bac8  MSFSDK::notifyLoginSuccess(const Cr::string&, _EMSFUinType, ...)
0x412c2e0  MSFSDK::notifyLogout()
0x412d7c0  MSFSDK::isConnected()
0x412e094  MSFSDK::sendQueueSize()
0x412e0c0  MSFSDK::recvQueueSize()
0x412e064  MSFSDK::currentRtt()
0x412da34  MSFSDK::getClientIP()
```

**这就是旧版在找的那张表。** 它的错误消息 `MSFService send features missing or ambiguous`
指的就是 `sendPacket` / `pack` 这一组函数拿不到。

### ★ 但有一个硬障碍：`Cr` 不是 `std`

符号里的 `NSt2Cr` = **`std::Cr`** —— 这不是标准库，是 QQ 自己的一套 `Cr`
（很可能是 libc++/Chromium 风格的内部 STL，带 `basic_string`/`unique_ptr`/`vector` 的重新实现）。

后果：

1. `sendPacket(Cr::unique_ptr<MSFRequest>)` **不能**从外部用标准库类型直接调用——
   `Cr::unique_ptr` 的二进制布局和 `std::unique_ptr` 可能不同（deleter 是有状态还是无状态、
   指针位置、ABI 都可能不一样）
2. **`MSFRequest` 的构造函数没有导出**（`.dynsym` 里只有 `sendPacket`/`pack` 接受它，
   以及 `_ZTSNSt2Cr14default_deleteIN3MSF10MSFRequestEEE` 这个 typeinfo 字符串）
   → 我们无法用符号方式构造一个 `MSFRequest`

### 因此可行的路径只有三条

| 路径 | 做法 | 风险 |
| --- | --- | --- |
| **A. hook 高点** | 不碰 `MSFRequest`，在 QQ 已经构造好请求的地方拦截（比如 `sendPacket` 的入口，拿到 `unique_ptr` 后**读**它指向的对象，不改不建） | 需要知道 `MSFRequest` 布局；但**只读**比构造安全得多 |
| **B. 逆向 `MSFRequest` 布局** | 反汇编 `sendPacket`/`pack` 看它读哪些偏移，据此手工构造一个 | 布局随 QQ 版本变；且要伪造 `Cr::unique_ptr` |
| **C. 用 `pack`/`unpack` 做纯字节层** | 如果能只调用 `pack`（它接受 request 指针），仍需构造 request —— 同 B | 同上 |

**路径 A 最有希望**：我们已经在 `wrapper.node` 上成功装了 200 个 hook，
`sendPacket` 在 `.dynsym` 里，可以直接按符号地址 hook 它。
在 hook 里**读取** `unique_ptr` 指向的 `MSFRequest` 内容（cmd 名、body 字节），
就能实现**观测**；要实现**主动发送**，则需要在 QQ 自己发请求的时刻，
把我们的请求"搭车"进去——或者在更高的层次找到 QQ 的 SSO 封装。

### 下一步的具体动作

1. 反汇编 `0x412b328 sendPacket` 和 `0x412b7f8 pack`，确定 `MSFRequest` 的字段偏移
2. 在真实进程里 hook `sendPacket`，打一个请求时 dump `MSFRequest` 的内容（只读，安全）
3. 从 dump 出的内容反推 `MSFRequest` 布局，再决定 A 还是 B
4. 同时找 QQ 更高层的发送封装（`MessageSvc.PbSendMsg` 这类命令是怎么被组装成 `MSFRequest` 的）
