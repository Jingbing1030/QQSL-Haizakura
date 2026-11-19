# `wrapper.node` 虚表槽位语义（T3b）

> 目标：QQ 3.2.32 aarch64，`/opt/QQ/resources/app/wrapper.node`，144,561,472 字节
> 方法：纯 Python 解析 ELF + `.eh_frame_hdr` 得到 318,767 个函数边界，再逐条解码 aarch64 指令
> 口径：**【确认】** 反汇编里看到明确字符串 / 明确 `bl` / 构造器写入；**【推断】** 结构或邻近性相似；**【未知】** 定不出来，宁可留空。

---

## 0. 结论摘要

### 0.1 send 在第几槽 —— 有把握

`sendSsoInternal`（`0x137cf84`，T9 运行时目标）在**整个 `.text` 只有 4 个 `bl` 调用点**，
而这 4 个全部落在 `nt::MSFService` 的虚表槽函数内：

| 调用点 | 所在函数 | 对应槽 |
|---|---|---|
| `0x137cf30` | `0x137ceb8` | **主表 `0x87173e8` 槽 36** |
| `0x137dc24` | `0x137dbf4` | **主表 `0x87173e8` 槽 37** |
| `0x137db84` | `0x137db0c` | 子表 `0x8717750` 槽 4 |
| `0x137dca8` | `0x137dc70` | 子表 `0x8717750` 槽 5 |

后两者是前两者的 `-0x10` 调整器版本（`sub x0, x0, #0x10` 后转调），只是同一功能的另一个子对象视图。

> **结论：`nt::MSFService` 的发包槽 = 主表 `0x87173e8` 的槽 36**（`this + 0x120`）。
> 槽 37（`this + 0x128`）是它的「不等待响应」兄弟版（`w3 = 0`）。
> ⚠️ 主表**没有任何其他代码 `bl` 进 `0x137ceb8`**（静态调用者为 0），所以这些槽只能经虚表调用——
> 这正是「必须 hook 虚表而不是 hook 函数体」的理由。

### 0.2 `msfCoreCallbackVtables`（`0x87193a8`）是什么

它**不是** `MSFCoreService` 主对象 vtable，而是对象内 **`+0x40` 处回调子对象**的 vtable。三条硬证据：

**① 构造器写入。** `MSFCoreService` 构造器 `0x13abb00` 把 6 个 vptr 依次写进 `this`：

```
  0x13abb10  add x8,  x8, #0xf60   -> 0x8718f60
  0x13abb24  stp x8,  x9, [x0, #0x00]  ; +0x00 = 0x8718f60   主对象 vptr
  0x13abb14  add x9,  x8, #0x1b0  -> 0x8719110
  0x13abb30  stp x10, x11,[x0, #0x10]  ; +0x10 = 0x8719308   +0x18 = 0x8719360
  0x13abb38  str x9,  [x19, #0x20]     ; +0x20 = 0x8719378
  0x13abb3c  str x8,  [x19, #0x40]     ; +0x40 = 0x87193a8   <== 就是它
```

`+0x40` 与载荷里的 `msfCoreCallbackOffset = 0x40` **数值完全一致**：那个常量指的是
「回调子对象在 service 对象内的**字节偏移**」，不是虚表槽偏移。

**② offset-to-top 自证。** 各表 `[-2]` 构成标准布局：

| vtable | offset-to-top | 对应对象偏移 |
|---|---:|---|
| `0x8718f60` | `0` | 主对象 |
| `0x8719110` | `-0x08` | `+0x08` |
| `0x8719308` | `-0x10` | `+0x10` |
| `0x8719360` | `-0x18` | `+0x18` |
| `0x8719378` | `-0x20` | `+0x20` |
| `0x87193a8` | **`-0x40`** | **`+0x40` 回调子对象** |

**③ 槽位签名。** 该表 10 个槽里 6 个是 `sub x0, x0, #0x40` + `b <主表函数>` 的调整器，
把 `this` 从子对象换算回主对象——多重/虚拟继承下子对象 vtable 的教科书形态。

**载荷的用法是对的**：用 `+0x40` 处的 vptr 认对象，比用主 vptr 更抗干扰。

### 0.3 `msfCoreCallbackVtables + 0x40` 那个槽干什么

**先拆清楚：这里有两个不同的 0x40。**

- `msfCoreCallbackOffset = 0x40` → **对象内字节偏移**，指向回调子对象本体（§0.2）。
- 若真按「vtable 内第 8 槽」读（`0x40/8 = 8`），`0x87193a8` 的**槽 8 = `0x13a41fc`**：

```
  0x13a41fc:  ret        <-- 单条 ret，空实现
```

> **结论：槽 8 是空桩，什么都不做。** 槽 7（`0x13a41f4`）同样只是 `ret`。
> 所以「hook `+0x40` 那个槽来拦回调」若按第 8 槽去挂，是**打空**的。
> 正确姿势：按 §0.2 用 `+0x40` 定位子对象，再从下表挑真正有行为的槽。

`0x87193a8` 里真正有内容的是槽 2/3/4/5/6/9：

| 槽 | 函数 | 干什么 |
|---:|---|---|
| 2 | `0x13a3c78` | `b 0x13a3ad0` → `onMSFError` |
| 3 | `0x13a3dcc` | `b 0x13a3c7c` → `onSSORetError` |
| 4 | `0x13a3e28` | `onMSFServerTimeUpdated`（有日志，完整实现）|
| 5 | `0x13a4040` | `sub x0,#0x40; b 0x13a3e80` → `onMSFPacketState` |
| 6 | `0x13a41e8` | `sub x0,#0x40; b 0x13a4048` → `onMSFNetworkState` |
| 9 | `0x13a46bc` | `sub x0,#0x40; b 0x13a4200` → `onSSORetError(uinInfo)` |

### 0.4 定出了多少

| vtable | 槽数 | 【确认】 | 【推断】 | 【未知】 |
|---|---:|---:|---:|---:|
| `nt::MSFService @0x87173e8` | 44 | 33 | 5 | 6 |
| `nt::MSFCoreService @0x8718f60` | 52 | 40 | 4 | 8 |
| `nt::MSFCoreService @0x87193a8 回调子对象` | 10 | 10 | 0 | 0 |
| `msf::MSFSessionImpl @0x88b4368` | 30 | 9 | 16 | 5 |
| `msf::MSFSessionImpl @0x88b4468` | 6 | 3 | 0 | 3 |
| `msf::internal::TaskManager @0x88b4aa0` | 6 | 5 | 1 | 0 |

另外 5 张「61 / 9 / 1 / 4 槽」表**基本是 `ret` 桩填充物**（§3.4、§6），
不承载业务语义，只承载「子对象视图的形状」。

---

## 1. `nt::MSFService` 主表 @ `0x87173e8`（44 槽，offset-to-top `0`）

载荷 `msfServiceVtables` 里 5 个地址的第一个，也是唯一承载完整语义的一张。

| 槽 | 偏移 | 函数地址 | 形态 | 推断语义 | 证据 |
|---:|---:|---|---|---|---|
| 0 | `+0x00` | `0x138f56c` | func | 构造函数 + 完整对象销毁（`Destroy`） | 【确认】 |
| 1 | `+0x08` | `0x138f7e4` | func | deleting destructor（`Destroy` 后 delete this） | 【确认】 |
| 2 | `+0x10` | `0x137b30c` | func | `online()` — 建立连接（"online session_ is empty."） | 【确认】 |
| 3 | `+0x18` | `0x137b4c8` | func | `offline()` — 断开连接 | 【推断】 |
| 4 | `+0x20` | `0x137b618` | func | 跳板：`b 0x4064d1c`（转发到 session 层） | 【推断】 |
| 5 | `+0x28` | `0x137b61c` | func | `msfGetStatus` — T9 运行时目标；"getMsfStatus error status." | 【确认】 |
| 6 | `+0x30` | `0x13821c0` | func | `getNetworkProxy` | 【确认】 |
| 7 | `+0x38` | `0x1382928` | func | 与 6 相邻、结构相似的代理配置访问器（未定名） | 【未知】 |
| 8 | `+0x40` | `0x138241c` | func | `setNetworkProxy` | 【确认】 |
| 9 | `+0x48` | `0x13827e0` | func | 代理/浏览器配置设置（未定名） | 【未知】 |
| 10 | `+0x50` | `0x1382bcc` | func | 成员访问器（未定名） | 【未知】 |
| 11 | `+0x58` | `0x1383384` | func | `sendMsfRequest`（应用层请求入口，"sendMsfRequest requestId:{} cmd:{}"） | 【确认】 |
| 12 | `+0x60` | `0x137eb28` | func | `onMsfPushForTesting`（测试用推包注入） | 【确认】 |
| 13 | `+0x68` | `0x137b2dc` | func | 跳板：`ldr x8,[x0,#0]` → `ldr x1,[x8,#0x98]` → `br x1`（转发到成员 vtable+0x98） | 【确认】 |
| 14 | `+0x70` | `0x137b2e8` | func | 转发跳板：`ldr x8,[x0,#0]` → `ldr x2,[x8,#0xa0]` 后转调 | 【确认】 |
| 15 | `+0x78` | `0x1378618` | func | `ResetSessionId` | 【确认】 |
| 16 | `+0x80` | `0x137877c` | func | 转调 `0x1374190`，语义未定 | 【未知】 |
| 17 | `+0x88` | `0x1378c4c` | func | `MSFService::Initialize` | 【确认】 |
| 18 | `+0x90` | `0x137a48c` | func | `MSFService::SessionInit`（"notify login success with uin:{}"） | 【确认】 |
| 19 | `+0x98` | `0x137b6b8` | func | `Connect`（"msf.Connect"） | 【确认】 |
| 20 | `+0xa0` | `0x137b938` | func | `Disconnect`（"msf.Disconnect"） | 【确认】 |
| 21 | `+0xa8` | `0x137fc34` | func | `Login` 桩（"Login should not call in NTQQ!!!"） | 【确认】 |
| 22 | `+0xb0` | `0x137b9bc` | func | `SetDefaultUin` | 【确认】 |
| 23 | `+0xb8` | `0x137bba0` | func | `SetSSOErrorCallback` | 【确认】 |
| 24 | `+0xc0` | `0x1380c4c` | func | `SendOidbReqInternal` 重载 A（"OidbSvcTrpcTcp.0x%x_%d"） | 【确认】 |
| 25 | `+0xc8` | `0x1381760` | func | `SendOidbReqInternal` 重载 B | 【确认】 |
| 26 | `+0xd0` | `0x1380204` | func | `SetMsfNeedDisconnectFlag` | 【确认】 |
| 27 | `+0xd8` | `0x1382dc0` | func | 转发器：`x0=[x0,#0x50]` → `br [x0->vptr + 0x60]`（未定名） | 【未知】 |
| 28 | `+0xe0` | `0x1382de0` | func | 转发器：`x0=[x0,#0x50]` → `br [x0->vptr + 0xb0]`（未定名） | 【未知】 |
| 29 | `+0xe8` | `0x1382df8` | func | 取 `[x0,#0x2f0]` 的 vtable，`blr` 两次（`0x10` / `0x130`）并转发 `+0x2e0`/`+0x2f0` | 【推断】 |
| 30 | `+0xf0` | `0x1383cdc` | func | `UpdateSignaureInfo` | 【确认】 |
| 31 | `+0xf8` | `0x1383f14` | func | accessor：`add x0,x0,#0x278; ret`（返回成员地址 `this+0x278`） | 【确认】 |
| 32 | `+0x100` | `0x137821c` | ret 桩 | 空析构桩 `ret` | 【确认】 |
| 33 | `+0x108` | `0x1378224` | func | `Destroy` 主体（"MSFService Destroy here"、"StopKeepAliveTimer"） | 【确认】 |
| 34 | `+0x110` | `0x137bc98` | func | `SendSSORequestInternal` 包装 A（4 参 → 转发 `137bd6c`） | 【确认】 |
| 35 | `+0x118` | `0x137cc80` | func | `SendSSORequestInternal` 包装 B（5 参 → 转发 `137bd6c`） | 【确认】 |
| 36 | `+0x120` | `0x137ceb8` | func | **发包槽 #1**：调 `sendSsoInternal`(0x137cf84)，w3=1 | 【确认】 |
| 37 | `+0x128` | `0x137dbf4` | func | **发包槽 #2**：调 `sendSsoInternal`(0x137cf84)，w3=0（无响应版） | 【确认】 |
| 38 | `+0x130` | `0x137dd10` | func | `sendMsfRequest` 完整实现（"msf.SendMsfRequest"） | 【确认】 |
| 39 | `+0x138` | `0x137ef90` | func | 分发到 `0x1391b1c`/`0x1391cb4`/`0x139317c` 的注册流程（与 `MSFCoreService` 槽 39 `RegisterMSFPush` 对位，未完全确证） | 【推断】 |
| 40 | `+0x140` | `0x137fc74` | func | `onKickedOffLine`（被踢下线） | 【确认】 |
| 41 | `+0x148` | `0x137fe44` | func | `onUserOnlineStatusChanged` | 【确认】 |
| 42 | `+0x150` | `0x1383ee4` | func | 转发器：读 `[x0,#0x50]`，非空则 `add x0,x0,#0x278` 后 `b 0x1372134` | 【推断】 |
| 43 | `+0x158` | `0x137b194` | func | `OnConnectivityChanged` | 【确认】 |

### 1.1 槽 36 反汇编（发包）

```
  0x137ceb8: sub  sp, sp, #0x60
  0x137ced4: mov  x20, x3           ; x3 = 回调/上下文对象
  0x137cedc: mov  x21, x2           ; x2 = buffer (vector<uint8>)
  0x137cee0: mov  x22, x1           ; x1 = serviceCmd (string)
  0x137cee4: mov  x23, x0           ; x0 = this
  0x137cee8: ldr  x8, [x3, #0x10]   ; 取 std::function 的 vtable
  0x137cf30: bl   0x137cf84         ; ==> sendSsoInternal(this, cmd, buf, 1, ctx)
  0x137cf84: <738 条指令>
```

`0x137cf84` 的字符串证据（`【确认】`）：`SendSSORequestInternal`、`msf.SendSSORequest`、
`messenger_ is nullptr, do no-op and return.`、`cmd={} trace={}`。

### 1.2 槽 37（同族的无响应版）

```
  0x137dc20: mov  w3, wzr           ; w3 = 0  (不等待响应)
  0x137dc24: bl   0x137cf84         ; ==> sendSsoInternal
```

### 1.3 收包回调是怎么进去的

`msfDidRecvResponseData` = **`0x407b840`**。它在全 `.text` 里**没有任何 `bl` 调用者**——
它是 `msf::internal::TaskManager` vtable 的**槽 5**（`0x88b4aa0 + 0x28`），只经虚表调用。
槽函数字符串（`【确认】`）：

```
  DidRecvResponseData
  MSF recv seq:{} cmd:{} data_size:{}, error_code:{}
  Response data should belong to task(seq:{} cmd:{} uin:{}), but not found.
  recv data error: {}
```

> **收包路径**：网络层 → `TaskManager` 槽 5（`0x407b840`）→ 按 `seq/cmd` 找 task →
> 回调该 task 登记的回调（内部 `blr` 到 slot `0x10` / `0x30` / `0x38`）。
> 想拦收包，钩 `TaskManager` 槽 5 比钩任何 `MSFService` 槽都直接。

---

## 2. `nt::MSFCoreService` 主表 @ `0x8718f60`（52 槽，offset-to-top `0`）

| 槽 | 偏移 | 函数地址 | 形态 | 推断语义 | 证据 |
|---:|---:|---|---|---|---|
| 0 | `+0x00` | `0x13abb00` | func | 构造函数 + 完整对象销毁 | 【确认】 |
| 1 | `+0x08` | `0x13abd64` | func | deleting destructor | 【确认】 |
| 2 | `+0x10` | `0x139c264` | func | `isConnected` 之类布尔查询（`mov w0,#1; ret`） | 【推断】 |
| 3 | `+0x18` | `0x139c26c` | func | `isDisconnected`（`mov w0,wzr; ret`） | 【推断】 |
| 4 | `+0x20` | `0x139c274` | func | 简单成员访问器（未定名） | 【未知】 |
| 5 | `+0x28` | `0x139c2c4` | func | 简单成员访问器（未定名） | 【未知】 |
| 6 | `+0x30` | `0x13a1fec` | func | `getNetworkProxy` | 【确认】 |
| 7 | `+0x38` | `0x13a2754` | func | 代理配置访问器（与 6 相邻、结构相似，未定名） | 【未知】 |
| 8 | `+0x40` | `0x13a2248` | func | `setNetworkProxy` | 【确认】 |
| 9 | `+0x48` | `0x13a260c` | func | 代理设置（未定名） | 【未知】 |
| 10 | `+0x50` | `0x13a29f8` | func | 成员访问器（未定名） | 【未知】 |
| 11 | `+0x58` | `0x13a2bec` | func | `sendMsfRequest`（"need add to cmd list call ulinzeng."） | 【确认】 |
| 12 | `+0x60` | `0x13a33d0` | func | `onMsfPushForTesting` | 【确认】 |
| 13 | `+0x68` | `0x139c1bc` | func | `disconnect()` 轻量版 | 【确认】 |
| 14 | `+0x70` | `0x139c204` | func | `disconnect()`（"disconnect()"） | 【确认】 |
| 15 | `+0x78` | `0x139c2f0` | func | `ResetSessionId` | 【确认】 |
| 16 | `+0x80` | `0x139c454` | func | 转调 `0x1374190`，语义未定 | 【未知】 |
| 17 | `+0x88` | `0x139c93c` | func | `MSFCoreService::Initialize` | 【确认】 |
| 18 | `+0x90` | `0x139d864` | func | `MSFCoreService::SessionInit` | 【确认】 |
| 19 | `+0x98` | `0x139e8e4` | func | `Connect`（canary/prod/test 环境分支） | 【确认】 |
| 20 | `+0xa0` | `0x139eaa4` | func | `Disconnect(reason)`（"Disconnect, reason={}"） | 【确认】 |
| 21 | `+0xa8` | `0x139eaf0` | func | `mov w0,wzr; ret` 桩 | 【确认】 |
| 22 | `+0xb0` | `0x139eaf8` | func | `SetDefaultUin` | 【确认】 |
| 23 | `+0xb8` | `0x139eb80` | func | `SetSSOErrorCallback` | 【确认】 |
| 24 | `+0xc0` | `0x13a0c0c` | func | `SendOidbReqInternal` 重载 A | 【确认】 |
| 25 | `+0xc8` | `0x13a1508` | func | `SendOidbReqInternal` 重载 B | 【确认】 |
| 26 | `+0xd0` | `0x13a1fe8` | ret 桩 | 空析构桩 `ret` | 【确认】 |
| 27 | `+0xd8` | `0x13a3460` | func | `GetClientAddress` | 【确认】 |
| 28 | `+0xe0` | `0x13a35e4` | func | 成员访问器（未定名） | 【未知】 |
| 29 | `+0xe8` | `0x13a3600` | func | 取 `[x0,#0x360]` 的 vtable，`blr` 转发（`+0x350`/`+0x360`），与 `MSFService` 槽 29 同构 | 【推断】 |
| 30 | `+0xf0` | `0x13a3668` | func | `UpdateSignaureInfo` | 【确认】 |
| 31 | `+0xf8` | `0x13a584c` | func | accessor：`add x0,x0,#0x2e8; ret`（返回成员地址 `this+0x2e8`） | 【确认】 |
| 32 | `+0x100` | `0x139be48` | func | 日志小函数（未定名） | 【未知】 |
| 33 | `+0x108` | `0x139be98` | func | `Destroy` 主体（析构清理） | 【确认】 |
| 34 | `+0x110` | `0x139ec10` | func | `SendSSORequest` 包装 A | 【确认】 |
| 35 | `+0x118` | `0x139f488` | func | `SendSSORequest` 包装 B | 【确认】 |
| 36 | `+0x120` | `0x139f69c` | func | `SendSSORequest`（"SendSSORequest cmd={} req_size={}"） | 【确认】 |
| 37 | `+0x128` | `0x139fb08` | func | `SendSSORequestNoResponse` | 【确认】 |
| 38 | `+0x130` | `0x13a03c0` | func | `SendMsfRequest`（"SendMsfRequest seq={}"） | 【确认】 |
| 39 | `+0x138` | `0x13a0894` | func | `RegisterMSFPush`（"RegisterMSFPush new cmd={}"） | 【确认】 |
| 40 | `+0x140` | `0x13a1b7c` | func | `onKickedOffLine`（"schedule disconnect after 5s"） | 【确认】 |
| 41 | `+0x148` | `0x13a1d98` | func | `onUserOnlineStatusChanged` | 【确认】 |
| 42 | `+0x150` | `0x13a3ac0` | func | accessor：`add x0,x0,#0x2e8; b 0x1372134` | 【推断】 |
| 43 | `+0x158` | `0x13a3ad0` | func | `onMSFError` | 【确认】 |
| 44 | `+0x160` | `0x13a3c7c` | func | `onSSORetError` | 【确认】 |
| 45 | `+0x168` | `0x13a3dd0` | func | `onMSFServerTimeUpdated` | 【确认】 |
| 46 | `+0x170` | `0x13a3e80` | func | `onMSFPacketState` | 【确认】 |
| 47 | `+0x178` | `0x13a4048` | func | `onMSFNetworkState` | 【确认】 |
| 48 | `+0x180` | `0x13a41f0` | ret 桩 | 空桩 `ret` | 【确认】 |
| 49 | `+0x188` | `0x13a41f8` | ret 桩 | 空桩 `ret` | 【确认】 |
| 50 | `+0x190` | `0x13a4200` | func | `onSSORetError(uinInfo)` | 【确认】 |
| 51 | `+0x198` | `0x13a46c4` | func | `OnConnectivityChanged` | 【确认】 |

与 `MSFService` 的对应非常整齐：两者是同一份 `IMSFService` 接口的两个实现
（`msf_service.cc` vs `msfcore_service.cc`），所以槽号一路对齐，语义可直接互推——
这也是本文大量 `【确认】` 的来源。

### 2.1 `MSFCoreService` 是「厚核」，`MSFService` 是「薄壳」

`0x8718f60` 的槽 36/37/38 是 `SendSSORequest` / `SendSSORequestNoResponse` / `SendMsfRequest` 的
**完整实现**（有日志、有序列化），而 `MSFService` 的槽 36/37 只是整理参数后 `bl sendSsoInternal`。

---

## 3. `nt::MSFService` 的其余 4 张子表

### 3.1 @ `0x8717750`（9 槽，offset-to-top `-0x10` → 对象 `+0x10`）

**这张表里也有发包槽** —— 它是主表 36/37 的 `-0x10` 调整器视图：

| 槽 | 偏移 | 函数地址 | 形态 | 推断语义 | 证据 |
|---:|---:|---|---|---|---|
| 0 | `+0x00` | `0x138f838` | adj-0x10 | 析构（`sub x0,#0x10` → 主表[0]） ＝ 主表[0] | 【确认】 |
| 1 | `+0x08` | `0x138f840` | func | deleting destructor | 【确认】 |
| 2 | `+0x10` | `0x137cb90` | func | `SendSSORequestInternal` 包装（`sub x24,x0,#0x10` → 0x137bd6c） | 【确认】 |
| 3 | `+0x18` | `0x137cd54` | func | `SendSSORequestInternal` 包装（同上） | 【确认】 |
| 4 | `+0x20` | `0x137db0c` | func | **发包**：调 `sendSsoInternal`，`sub x23,x0,#0x10`，w3=1 | 【确认】 |
| 5 | `+0x28` | `0x137dc70` | func | **发包**：调 `sendSsoInternal`，`sub x0,x0,#0x10`，w3=0 | 【确认】 |
| 6 | `+0x30` | `0x137eb20` | adj-0x10 | `sendMsfRequest` 转发（`sub x0,#0x10` → 主表[38]） ＝ 主表[38] | 【确认】 |
| 7 | `+0x38` | `0x137f22c` | adj-0x10 | `RegisterMSFPush` 转发（`sub x0,#0x10` → 主表[39]） ＝ 主表[39] | 【确认】 |
| 8 | `+0x40` | `0x1383efc` | func | 转发器：读 `[x0,#0x50]`，非空则 `add x0,x0,#0x278` 后 `b 0x1372130` | 【推断】 |

槽 4 反汇编（注意先 `sub x23, x0, #0x10` 换算 this 再转发）：

```
  0x137db38: sub  x23, x0, #0x10      ; this = 子对象 - 0x10
  0x137db84: bl   0x137cf84           ; ==> sendSsoInternal
```

槽 8 读 `[x0, #0x40]` 后 `b 0x1372130`——说明 `MSFService` 对象 `+0x40` 也有成员，
但它与 `MSFCoreService` 的 `+0x40` 回调子对象**不是同一个东西**（不同类、不同布局）。

### 3.2 @ `0x87177a8`（1 槽，offset-to-top `-0x18` → 对象 `+0x18`）

| 槽 | 偏移 | 函数地址 | 形态 | 推断语义 | 证据 |
|---:|---:|---|---|---|---|
| 0 | `+0x00` | `0x137b238` | func | `OnConnectivityChanged`（完整实现） | 【确认】 |

### 3.3 @ `0x87177c0`（4 槽，offset-to-top `-0x20` → 对象 `+0x20`）

| 槽 | 偏移 | 函数地址 | 形态 | 推断语义 | 证据 |
|---:|---:|---|---|---|---|
| 0 | `+0x00` | `0x138f868` | adj-0x20 | 析构（`sub x0,#0x20` → 主表[0]） ＝ 主表[0] | 【确认】 |
| 1 | `+0x08` | `0x138f870` | func | deleting destructor | 【确认】 |
| 2 | `+0x10` | `0x1378220` | ret 桩 | 空析构桩 `ret` | 【确认】 |
| 3 | `+0x18` | `0x1378610` | adj-0x20 | `Destroy`（`sub x0,#0x20` → 主表[33]） ＝ 主表[33] | 【确认】 |

### 3.4 @ `0x8717558`（61 槽，offset-to-top `-0x08`）—— 绝大多数是填充

61 槽里**只有 4 个是真的**，其余 57 个都指向 `0x99a2fc..0x99a3dc` 的 `ret` 桩：

| 槽 | 偏移 | 函数地址 | 形态 | 推断语义 | 证据 |
|---:|---:|---|---|---|---|
| 0 | `+0x00` | `0x138f808` | adj-0x8 | 析构（`sub x0,#8` → 主表[0]） ＝ 主表[0] | 【确认】 |
| 1 | `+0x08` | `0x138f810` | func | deleting destructor（`b 0x138f7e4`） | 【确认】 |
| 2 | `+0x10` | `0x99a2fc` | ret 桩 | — | 【未知】 |
| 3 | `+0x18` | `0x99a300` | ret 桩 | — | 【未知】 |
| 4 | `+0x20` | `0x99a304` | ret 桩 | — | 【未知】 |
| 5 | `+0x28` | `0x99a308` | ret 桩 | — | 【未知】 |
| 6 | `+0x30` | `0xc3f5ec` | ret 桩 | — | 【未知】 |
| 7 | `+0x38` | `0xc3f5f0` | ret 桩 | — | 【未知】 |
| 8 | `+0x40` | `0x99a30c` | ret 桩 | — | 【未知】 |
| 9 | `+0x48` | `0x99a310` | ret 桩 | — | 【未知】 |
| 10 | `+0x50` | `0x137fe3c` | adj-0x8 | `onKickedOffLine`（`sub x0,#8` → 主表[40]） ＝ 主表[40] | 【确认】 |
| 11 | `+0x58` | `0x99a318` | ret 桩 | — | 【未知】 |
| 12 | `+0x60` | `0x99a31c` | ret 桩 | — | 【未知】 |
| 13 | `+0x68` | `0x99a320` | ret 桩 | — | 【未知】 |
| 14 | `+0x70` | `0x99a324` | ret 桩 | — | 【未知】 |
| 15 | `+0x78` | `0x99a328` | ret 桩 | — | 【未知】 |
| 16 | `+0x80` | `0x99a32c` | ret 桩 | — | 【未知】 |
| 17 | `+0x88` | `0x99a330` | ret 桩 | — | 【未知】 |
| 18 | `+0x90` | `0x99a334` | ret 桩 | — | 【未知】 |
| 19 | `+0x98` | `0x99a338` | ret 桩 | — | 【未知】 |
| 20 | `+0xa0` | `0x99a33c` | ret 桩 | — | 【未知】 |
| 21 | `+0xa8` | `0x99a340` | ret 桩 | — | 【未知】 |
| 22 | `+0xb0` | `0x99a344` | ret 桩 | — | 【未知】 |
| 23 | `+0xb8` | `0x99a348` | ret 桩 | — | 【未知】 |
| 24 | `+0xc0` | `0x99a34c` | ret 桩 | — | 【未知】 |
| 25 | `+0xc8` | `0x99a350` | ret 桩 | — | 【未知】 |
| 26 | `+0xd0` | `0x99a354` | ret 桩 | — | 【未知】 |
| 27 | `+0xd8` | `0x99a358` | ret 桩 | — | 【未知】 |
| 28 | `+0xe0` | `0x99a35c` | ret 桩 | — | 【未知】 |
| 29 | `+0xe8` | `0x99a360` | ret 桩 | — | 【未知】 |
| 30 | `+0xf0` | `0x99a364` | ret 桩 | — | 【未知】 |
| 31 | `+0xf8` | `0x99a368` | ret 桩 | — | 【未知】 |
| 32 | `+0x100` | `0x99a36c` | ret 桩 | — | 【未知】 |
| 33 | `+0x108` | `0x99a370` | ret 桩 | — | 【未知】 |
| 34 | `+0x110` | `0x99a374` | ret 桩 | — | 【未知】 |
| 35 | `+0x118` | `0x99a378` | ret 桩 | — | 【未知】 |
| 36 | `+0x120` | `0x99a37c` | ret 桩 | — | 【未知】 |
| 37 | `+0x128` | `0x99a380` | ret 桩 | — | 【未知】 |
| 38 | `+0x130` | `0x99a384` | ret 桩 | — | 【未知】 |
| 39 | `+0x138` | `0x99a388` | ret 桩 | — | 【未知】 |
| 40 | `+0x140` | `0x99a38c` | ret 桩 | — | 【未知】 |
| 41 | `+0x148` | `0x99a390` | ret 桩 | — | 【未知】 |
| 42 | `+0x150` | `0x99a394` | ret 桩 | — | 【未知】 |
| 43 | `+0x158` | `0x99a398` | ret 桩 | — | 【未知】 |
| 44 | `+0x160` | `0x137ff0c` | func | `onUserOnlineStatusChanged`（完整实现） | 【确认】 |
| 45 | `+0x168` | `0x99a3a0` | ret 桩 | — | 【未知】 |
| 46 | `+0x170` | `0x99a3a4` | ret 桩 | — | 【未知】 |
| 47 | `+0x178` | `0x99a3a8` | ret 桩 | — | 【未知】 |
| 48 | `+0x180` | `0x99a3ac` | ret 桩 | — | 【未知】 |
| 49 | `+0x188` | `0x99a3b0` | ret 桩 | — | 【未知】 |
| 50 | `+0x190` | `0x99a3b4` | ret 桩 | — | 【未知】 |
| 51 | `+0x198` | `0x99a3b8` | ret 桩 | — | 【未知】 |
| 52 | `+0x1a0` | `0x99a3bc` | ret 桩 | — | 【未知】 |
| 53 | `+0x1a8` | `0x99a3c0` | ret 桩 | — | 【未知】 |
| 54 | `+0x1b0` | `0x99a3c4` | ret 桩 | — | 【未知】 |
| 55 | `+0x1b8` | `0x99a3c8` | ret 桩 | — | 【未知】 |
| 56 | `+0x1c0` | `0x99a3cc` | ret 桩 | — | 【未知】 |
| 57 | `+0x1c8` | `0x99a3d0` | ret 桩 | — | 【未知】 |
| 58 | `+0x1d0` | `0x99a3d4` | ret 桩 | — | 【未知】 |
| 59 | `+0x1d8` | `0x99a3d8` | ret 桩 | — | 【未知】 |
| 60 | `+0x1e0` | `0x99a3dc` | ret 桩 | — | 【未知】 |

> 这些 `ret` 桩是一段**连续的 ret 滑梯**（`0x99a2fc` 起，每条 `ret` 占 4 字节），
> 编译器用它给「未覆盖的虚基类槽位」占位。**它们没有行为**，hook 了也命中不到有意义的东西。

---

## 4. 子表 → 主表 映射（反推真实槽号的可靠办法）

子表槽函数常常是「调整器 + 主表函数」。逐个 `follow()` 后比对指针，得到：

- `MSFService` 子表 `0x8717750`：`0`→`0`, `6`→`38`, `7`→`39`
- `MSFService` 子表 `0x87177c0`：`0`→`0`, `3`→`33`
- `MSFService` 子表 `0x8717558`：`0`→`0`, `10`→`40`
- `MSFCoreService` 子表 `0x8719308`：`0`→`0`, `4`→`36`, `5`→`37`, `6`→`38`, `7`→`39`
- `MSFCoreService` 子表 `0x8719378`：`0`→`0`, `3`→`33`
- `MSFCoreService` 子表 `0x8719110`：`0`→`0`, `10`→`40`, `44`→`41`

读法：`0x8717558` 槽 10 是主表 40（`onKickedOffLine`）的调整器版本，
`0x8719110` 槽 44 是主表 44（`onSSORetError`）的调整器版本。

---

## 5. `nt::MSFCoreService` 回调子对象 @ `0x87193a8`（10 槽，offset-to-top `-0x40`）

**这是 `msfCoreCallbackOffset = 0x40` 真正指向的东西。**

| 槽 | 偏移 | 函数地址 | 形态 | 推断语义 | 证据 |
|---:|---:|---|---|---|---|
| 0 | `+0x00` | `0x13abe18` | adj-0x40 | 析构（`sub x0,#0x40; b 13abb00`） | 【确认】 |
| 1 | `+0x08` | `0x13abe20` | func | deleting destructor | 【确认】 |
| 2 | `+0x10` | `0x13a3c78` | func | `onMSFError` 转发（`b 0x13a3ad0`） | 【确认】 |
| 3 | `+0x18` | `0x13a3dcc` | func | `onSSORetError` 转发（`b 0x13a3c7c`） | 【确认】 |
| 4 | `+0x20` | `0x13a3e28` | func | `onMSFServerTimeUpdated`（完整实现，含日志） | 【确认】 |
| 5 | `+0x28` | `0x13a4040` | adj-0x40 | `sub x0,#0x40; b 0x13a3e80` → `onMSFPacketState` | 【确认】 |
| 6 | `+0x30` | `0x13a41e8` | adj-0x40 | `sub x0,#0x40; b 0x13a4048` → `onMSFNetworkState` | 【确认】 |
| 7 | `+0x38` | `0x13a41f4` | ret 桩 | 空桩 `ret` | 【确认】 |
| 8 | `+0x40` | `0x13a41fc` | ret 桩 | **空桩 `ret`** — 不做事，见下文分析 | 【确认】 |
| 9 | `+0x48` | `0x13a46bc` | adj-0x40 | `sub x0,#0x40; b 0x13a4200` → `onSSORetError(uinInfo)` | 【确认】 |

槽 0/1 的析构链 `sub x0, x0, #0x40; b 0x13abb00` 就是「从 `+0x40` 子对象回到主对象」的铁证。

---

## 6. `nt::MSFCoreService` 的其余子表

### 6.1 @ `0x8719308`（9 槽，offset-to-top `-0x10`）—— **发送接口视图**

| 槽 | 偏移 | 函数地址 | 形态 | 推断语义 | 证据 |
|---:|---:|---|---|---|---|
| 0 | `+0x00` | `0x13abdb8` | adj-0x10 | 析构（`sub x0,#0x10` → 主表[0]） ＝ 主表[0] | 【确认】 |
| 1 | `+0x08` | `0x13abdc0` | func | deleting destructor | 【确认】 |
| 2 | `+0x10` | `0x139f398` | func | `SendSSORequest` 包装（→ 0x139f69c） | 【确认】 |
| 3 | `+0x18` | `0x139f55c` | func | `SendSSORequest` 包装（→ 0x139f69c） | 【确认】 |
| 4 | `+0x20` | `0x139fb00` | adj-0x10 | `SendSSORequest`（主表[36] 转发） ＝ 主表[36] | 【确认】 |
| 5 | `+0x28` | `0x13a03b8` | adj-0x10 | `SendSSORequestNoResponse`（主表[37]） ＝ 主表[37] | 【确认】 |
| 6 | `+0x30` | `0x13a07e8` | adj-0x10 | `SendMsfRequest`（主表[38]） ＝ 主表[38] | 【确认】 |
| 7 | `+0x38` | `0x13a0c04` | adj-0x10 | `RegisterMSFPush`（主表[39]） ＝ 主表[39] | 【确认】 |
| 8 | `+0x40` | `0x13a3ac8` | func | 转发器：读 `[x0,#0x40]`，非空则 `add x0,x0,#0x268` 后 `b 0x1372134`（`-0x10` 视图） | 【推断】 |

槽 2/3 是 `SendSSORequest` 包装，槽 4/5/6/7 覆盖 SSO / NoResponse / MsfRequest / RegisterMSFPush。
若要从 `MSFCoreService` 侧拦「发 SSO」，这里比主表更聚焦。

### 6.2 @ `0x8719360`（1 槽）

| 槽 | 偏移 | 函数地址 | 形态 | 推断语义 | 证据 |
|---:|---:|---|---|---|---|
| 0 | `+0x00` | `0x13a48a0` | func | `OnConnectivityChanged`（完整实现） | 【确认】 |

### 6.3 @ `0x8719378`（4 槽，offset-to-top `-0x20`）

| 槽 | 偏移 | 函数地址 | 形态 | 推断语义 | 证据 |
|---:|---:|---|---|---|---|
| 0 | `+0x00` | `0x13abde8` | adj-0x20 | 析构（`sub x0,#0x20` → 主表[0]） ＝ 主表[0] | 【确认】 |
| 1 | `+0x08` | `0x13abdf0` | func | deleting destructor | 【确认】 |
| 2 | `+0x10` | `0x139be70` | func | 日志小函数 | 【推断】 |
| 3 | `+0x18` | `0x139c1b4` | adj-0x20 | 清理函数 ＝ 主表[33] | 【推断】 |

### 6.4 @ `0x8719110`（61 槽，offset-to-top `-0x08`）

与 `MSFService` 的 `0x8717558` 同构，同样绝大多数是 `ret` 桩：

| 槽 | 偏移 | 函数地址 | 形态 | 推断语义 | 证据 |
|---:|---:|---|---|---|---|
| 0 | `+0x00` | `0x13abd88` | adj-0x8 | 析构（`sub x0,#8` → 主表[0]） ＝ 主表[0] | 【确认】 |
| 1 | `+0x08` | `0x13abd90` | func | deleting destructor（`b 0x13abd90`） | 【确认】 |
| 2 | `+0x10` | `0x99a2fc` | ret 桩 | — | 【未知】 |
| 3 | `+0x18` | `0x99a300` | ret 桩 | — | 【未知】 |
| 4 | `+0x20` | `0x99a304` | ret 桩 | — | 【未知】 |
| 5 | `+0x28` | `0x99a308` | ret 桩 | — | 【未知】 |
| 6 | `+0x30` | `0xc3f5ec` | ret 桩 | — | 【未知】 |
| 7 | `+0x38` | `0xc3f5f0` | ret 桩 | — | 【未知】 |
| 8 | `+0x40` | `0x99a30c` | ret 桩 | — | 【未知】 |
| 9 | `+0x48` | `0x99a310` | ret 桩 | — | 【未知】 |
| 10 | `+0x50` | `0x13a1d90` | adj-0x8 | `onKickedOffLine`（`sub x0,#8` → 主表[40]） ＝ 主表[40] | 【确认】 |
| 11 | `+0x58` | `0x99a318` | ret 桩 | — | 【未知】 |
| 12 | `+0x60` | `0x99a31c` | ret 桩 | — | 【未知】 |
| 13 | `+0x68` | `0x99a320` | ret 桩 | — | 【未知】 |
| 14 | `+0x70` | `0x99a324` | ret 桩 | — | 【未知】 |
| 15 | `+0x78` | `0x99a328` | ret 桩 | — | 【未知】 |
| 16 | `+0x80` | `0x99a32c` | ret 桩 | — | 【未知】 |
| 17 | `+0x88` | `0x99a330` | ret 桩 | — | 【未知】 |
| 18 | `+0x90` | `0x99a334` | ret 桩 | — | 【未知】 |
| 19 | `+0x98` | `0x99a338` | ret 桩 | — | 【未知】 |
| 20 | `+0xa0` | `0x99a33c` | ret 桩 | — | 【未知】 |
| 21 | `+0xa8` | `0x99a340` | ret 桩 | — | 【未知】 |
| 22 | `+0xb0` | `0x99a344` | ret 桩 | — | 【未知】 |
| 23 | `+0xb8` | `0x99a348` | ret 桩 | — | 【未知】 |
| 24 | `+0xc0` | `0x99a34c` | ret 桩 | — | 【未知】 |
| 25 | `+0xc8` | `0x99a350` | ret 桩 | — | 【未知】 |
| 26 | `+0xd0` | `0x99a354` | ret 桩 | — | 【未知】 |
| 27 | `+0xd8` | `0x99a358` | ret 桩 | — | 【未知】 |
| 28 | `+0xe0` | `0x99a35c` | ret 桩 | — | 【未知】 |
| 29 | `+0xe8` | `0x99a360` | ret 桩 | — | 【未知】 |
| 30 | `+0xf0` | `0x99a364` | ret 桩 | — | 【未知】 |
| 31 | `+0xf8` | `0x99a368` | ret 桩 | — | 【未知】 |
| 32 | `+0x100` | `0x99a36c` | ret 桩 | — | 【未知】 |
| 33 | `+0x108` | `0x99a370` | ret 桩 | — | 【未知】 |
| 34 | `+0x110` | `0x99a374` | ret 桩 | — | 【未知】 |
| 35 | `+0x118` | `0x99a378` | ret 桩 | — | 【未知】 |
| 36 | `+0x120` | `0x99a37c` | ret 桩 | — | 【未知】 |
| 37 | `+0x128` | `0x99a380` | ret 桩 | — | 【未知】 |
| 38 | `+0x130` | `0x99a384` | ret 桩 | — | 【未知】 |
| 39 | `+0x138` | `0x99a388` | ret 桩 | — | 【未知】 |
| 40 | `+0x140` | `0x99a38c` | ret 桩 | — | 【未知】 |
| 41 | `+0x148` | `0x99a390` | ret 桩 | — | 【未知】 |
| 42 | `+0x150` | `0x99a394` | ret 桩 | — | 【未知】 |
| 43 | `+0x158` | `0x99a398` | ret 桩 | — | 【未知】 |
| 44 | `+0x160` | `0x13a1fe0` | adj-0x8 | `onUserOnlineStatusChanged`（`sub x0,#8` → 主表[41]） ＝ 主表[41] | 【确认】 |
| 45 | `+0x168` | `0x99a3a0` | ret 桩 | — | 【未知】 |
| 46 | `+0x170` | `0x99a3a4` | ret 桩 | — | 【未知】 |
| 47 | `+0x178` | `0x99a3a8` | ret 桩 | — | 【未知】 |
| 48 | `+0x180` | `0x99a3ac` | ret 桩 | — | 【未知】 |
| 49 | `+0x188` | `0x99a3b0` | ret 桩 | — | 【未知】 |
| 50 | `+0x190` | `0x99a3b4` | ret 桩 | — | 【未知】 |
| 51 | `+0x198` | `0x99a3b8` | ret 桩 | — | 【未知】 |
| 52 | `+0x1a0` | `0x99a3bc` | ret 桩 | — | 【未知】 |
| 53 | `+0x1a8` | `0x99a3c0` | ret 桩 | — | 【未知】 |
| 54 | `+0x1b0` | `0x99a3c4` | ret 桩 | — | 【未知】 |
| 55 | `+0x1b8` | `0x99a3c8` | ret 桩 | — | 【未知】 |
| 56 | `+0x1c0` | `0x99a3cc` | ret 桩 | — | 【未知】 |
| 57 | `+0x1c8` | `0x99a3d0` | ret 桩 | — | 【未知】 |
| 58 | `+0x1d0` | `0x99a3d4` | ret 桩 | — | 【未知】 |
| 59 | `+0x1d8` | `0x99a3d8` | ret 桩 | — | 【未知】 |
| 60 | `+0x1e0` | `0x99a3dc` | ret 桩 | — | 【未知】 |

---

## 7. `msf::MSFSessionImpl` 与 `msf::internal::TaskManager`

### 7.1 `MSFSessionImpl` 主表 @ `0x88b4368`（30 槽）

网络会话层。**T9 的 `msfDidRecvResponseData` 不在这里**（在 TaskManager）。
槽 26/27/28 是连接生命周期回调，对「连接状态」类需求有用。

| 槽 | 偏移 | 函数地址 | 形态 | 推断语义 | 证据 |
|---:|---:|---|---|---|---|
| 0 | `+0x00` | `0x4067d04` | func | 构造函数 + 析构 | 【确认】 |
| 1 | `+0x08` | `0x4068060` | func | deleting destructor | 【确认】 |
| 2 | `+0x10` | `0x40680c8` | func | 初始化/配置装载 | 【推断】 |
| 3 | `+0x18` | `0x40682c4` | func | 清理 | 【推断】 |
| 4 | `+0x20` | `0x406834c` | func | `ConnectToTestServer` | 【确认】 |
| 5 | `+0x28` | `0x4069ef4` | func | 连接建立（含 proxy 解析） | 【推断】 |
| 6 | `+0x30` | `0x406acf0` | func | 连接参数设置 | 【推断】 |
| 7 | `+0x38` | `0x406b7cc` | func | 轻量 getter（未定名） | 【未知】 |
| 8 | `+0x40` | `0x406b7d8` | func | 轻量 getter（未定名） | 【未知】 |
| 9 | `+0x48` | `0x406b7e4` | func | socket/发送路径（+0x190 成员） | 【推断】 |
| 10 | `+0x50` | `0x406b8d0` | func | 发送队列/任务提交（`str [x0,#0x20]`） | 【推断】 |
| 11 | `+0x58` | `0x406bae0` | func | 网络层调用 A | 【推断】 |
| 12 | `+0x60` | `0x406bb6c` | func | 网络层调用 B | 【推断】 |
| 13 | `+0x68` | `0x406bbf8` | func | 网络层调用 C | 【推断】 |
| 14 | `+0x70` | `0x406bcac` | func | 网络层调用 D | 【推断】 |
| 15 | `+0x78` | `0x406bd10` | func | 读 +0x140 成员 | 【推断】 |
| 16 | `+0x80` | `0x406bdc0` | func | 读 +0x140 成员（getter） | 【推断】 |
| 17 | `+0x88` | `0x406bdc8` | func | 读 +0x158 成员 | 【推断】 |
| 18 | `+0x90` | `0x406be78` | func | 读 +0x158 成员（getter） | 【推断】 |
| 19 | `+0x98` | `0x406be80` | func | 读 +0x9c 成员 | 【推断】 |
| 20 | `+0xa0` | `0x406be94` | func | 读写 +0x1a0/+0x1a8 | 【推断】 |
| 21 | `+0xa8` | `0x406bef0` | func | `SetDefaultUid` | 【确认】 |
| 22 | `+0xb0` | `0x406c1a8` | func | 轻量 getter（未定名） | 【未知】 |
| 23 | `+0xb8` | `0x406d06c` | func | `UpdateConfig` | 【确认】 |
| 24 | `+0xc0` | `0x406d3bc` | func | 写 +0xf0（未定名） | 【未知】 |
| 25 | `+0xc8` | `0x406d3c8` | func | 写 +0xf0（未定名） | 【未知】 |
| 26 | `+0xd0` | `0x406b16c` | func | `MSFSession OnConnecting` | 【确认】 |
| 27 | `+0xd8` | `0x406b254` | func | `MSFSession OnConnected` | 【确认】 |
| 28 | `+0xe0` | `0x406b588` | func | `MSFSession OnDisconnected` | 【确认】 |
| 29 | `+0xe8` | `0x406b68c` | func | `OnResolveProxy` | 【确认】 |

### 7.2 `MSFSessionImpl` 子表 @ `0x88b4468`（6 槽，offset-to-top `-0x08`）

| 槽 | 偏移 | 函数地址 | 形态 | 推断语义 | 证据 |
|---:|---:|---|---|---|---|
| 0 | `+0x00` | `0x4068058` | adj-0x8 | 析构 | 【确认】 |
| 1 | `+0x08` | `0x4068084` | func | deleting destructor | 【确认】 |
| 2 | `+0x10` | `0x406b7c4` | adj-0x8 | 成员 getter（未定名） | 【未知】 |
| 3 | `+0x18` | `0x406b1e0` | func | `MSFSession OnConnecting`（转发） | 【确认】 |
| 4 | `+0x20` | `0x406b580` | adj-0x8 | 成员 getter（未定名） | 【未知】 |
| 5 | `+0x28` | `0x406b684` | adj-0x8 | 成员 getter（未定名） | 【未知】 |

### 7.3 `msf::internal::TaskManager` @ `0x88b4aa0`（6 槽）—— **收包/发包的真正枢纽**

| 槽 | 偏移 | 函数地址 | 形态 | 推断语义 | 证据 |
|---:|---:|---|---|---|---|
| 0 | `+0x00` | `0x4078300` | func | 构造函数 + 析构（含任务表清理） | 【确认】 |
| 1 | `+0x08` | `0x407853c` | func | deleting destructor | 【确认】 |
| 2 | `+0x10` | `0x407a71c` | func | 任务表查找/清理辅助 | 【推断】 |
| 3 | `+0x18` | `0x407a8ac` | func | `DidStartSendingTask`（"Did Start sending task {}"） — **发包开始回调** | 【确认】 |
| 4 | `+0x20` | `0x407a928` | func | `DidFinishSendingTask`（"Did Finish sending task {} error {}"） — **发包结束回调** | 【确认】 |
| 5 | `+0x28` | `0x407b840` | func | `DidRecvResponseData` — **T9 运行时目标 `msfDidRecvResponseData`** | 【确认】 |

**这张表最关键**：

- **槽 5 = `0x407b840` = 载荷的 `msfDidRecvResponseData`**（`【确认】`，字符串齐全）
- **槽 3 = 发包开始回调**（`DidStartSendingTask`）
- **槽 4 = 发包结束回调**（`DidFinishSendingTask`）

所以「发送前拦一刀」还有一个更省事的位置：`TaskManager` 槽 3（`0x407a8ac`）——
它在 task 真正下到 socket 前被调用。

---

## 8. 怎么验证的（QQ 升级后如何重做）

全部脚本在 `/home/ubuntu/t3b/`，**只读**，未改动 `hook-rewrite/src/` 下任何代码。

### 8.1 环境

```bash
cd /home/ubuntu/t3b
# wrapper.node 副本本机已有，无需上网：
#   /home/ubuntu/hzwork/wrapper-arm64.node   (144,561,472 B)
python3 -V     # 3.14，纯标准库，零第三方依赖
```

### 8.2 脚本一览

| 脚本 | 作用 |
|---|---|
| `vt.py` | 极简 ELF 解析（程序头 / VMA→文件偏移 / 读指针 / 读 C 串） |
| `analyze.py` | 核心：解析 `.eh_frame_hdr` 得 **318,767** 个函数边界；解码 aarch64，抽字符串引用、`bl` 调用、`this` 相对偏移、`blr` 虚调用槽位 |
| `facts_table.py` → `facts.json` | 14 张表 × 全部槽位的结构化事实（机器可读） |
| `classify.py` | 判定每槽是 `func` / `adjustor` / `ret 桩` |
| `submap.py` | 子表 → 主表槽号映射 |
| `mktables.py` / `gen_doc.py` | 生成本文档所有表格（地址一律从二进制现算，不手抄） |

### 8.3 复现命令

```bash
cd /home/ubuntu/t3b
python3 -c "import sys; sys.path.insert(0,'.'); import analyze; \
  an=analyze.Analyzer('/home/ubuntu/hzwork/wrapper-arm64.node'); print(len(an.starts))"
#   -> 318767      （函数边界表出来了就说明 .eh_frame_hdr 解析正常）

python3 facts_table.py   # 重算全部槽位事实 -> facts.json
python3 classify.py      # 每槽形态
python3 submap.py        # 子表映射
python3 gen_doc.py       # 重新生成本文档
```

### 8.4 升级后第一件要做的事：**别硬编码地址**

按「锚点」重新定位：

| 目标 | 锚点（`.rodata` 字符串） | 做法 |
|---|---|---|
| `sendSsoInternal` | `SendSSORequestInternal` | 找串 → 找引用它的函数 |
| `msfDidRecvResponseData` | `MSF recv seq:` 或 `DidRecvResponseData` | 同上 |
| `msfGetStatus` | `getMsfStatus error status.` | 同上 |
| `MSFService` 类 | RTTI 串 `N2nt10MSFServiceE` | 反查 type_info |
| `MSFCoreService` 类 | `N2nt14MSFCoreServiceE` | 同上 |
| 回调子对象 | 构造器里 `str x?, [x19, #0x40]` 写入的那张表 | 见 §0.2，**比硬编码 `-0x40` 更稳** |

**最稳的一条链**：

1. 用 RTTI 找到类 → 2. 用构造器找出它写给 `this` 的所有 vptr → 3. 得到「哪张表对应哪个对象偏移」
→ 4. 用字符串锚点确认真实函数 → 5. 在表里反查该函数落在**哪一槽**。

§0.2 的构造器扫描就是这条链的完整示范，换版本只需重跑它。**不要**把「槽 36」当常量用——
版本一变槽号就会漂，但「构造器写入顺序」和「字符串锚点」通常稳定。

---

## 9. 老实说：没定出来的

以下槽位只看到「读某偏移 / 转调某函数」，**证据不足以命名**，一律标【未知】：

| vtable | 槽 | 看到了什么 | 为什么定不出来 |
|---|---|---|---|
| `MSFService @0x87173e8` | 7 | 与槽 6（`getNetworkProxy`）相邻、结构几乎一致 | 编译器把重载内联成同形，字符串被合并 |
| 同上 | 9 / 10 | 成员访问 + 代理相关调用 | 无日志串，从调用图看不出层级 |
| 同上 | 16 | `bl 0x1374190` | 被调函数无字符串、无导出名 |
| 同上 | 27 / 28 | 取 `[x0,#0x50]` 后 `br [vptr+0x60]` / `[vptr+0xb0]` | 纯转发器，语义取决于被转调方 |
| `MSFCoreService @0x8718f60` | 4 / 5 | `mov w0,#1` / `mov w0,wzr` | 只确认是布尔判定，谓词不明 |
| 同上 | 7 / 9 / 10 | 同 `MSFService` 的 7/9/10 | 同上 |
| 同上 | 16 | `bl 0x1374190` | 同上 |
| 同上 | 28 | 成员访问 | 无串 |
| 同上 | 32 | 只引用 `MSFCore_Service_Log` | 是日志包装，具体打什么看不出 |
| `MSFSessionImpl @0x88b4368` | 7 / 8 / 22 / 24 / 25 | 单成员读写 | 纯 getter/setter，无串 |

**「哪个槽是 send」是确定的**（§0.1）——它来自「谁 `bl` 到 `sendSsoInternal`」，不依赖猜测。
上面的【未知】只影响「这个槽叫什么」，不影响发包定位。

---

## 10. 给 T9 的三条结论

1. **发包** → `nt::MSFService` 主表 `0x87173e8` 槽 **36**（`+0x120`）。子对象视图 `0x8717750` 槽 **4** 等价。
2. **`+0x40` 是对象内偏移，不是槽号**；按槽 8 去 hook 会命中空 `ret`（`0x13a41fc`）。
3. **收包** → `msf::internal::TaskManager` 表 `0x88b4aa0` 槽 **5**（`0x407b840`），载荷里叫
   `msfDidRecvResponseData`，**没有静态调用者**，只走虚表——必须改 vptr 或改表项才拦得住。


---

## 补充：按调用图定位槽（T9 落地用）

T3b 的核心结论"send 在主表槽 36"来自调用图，不是来自槽号猜测。这一条已在
`src/vtable_hook.cc` 里做成可复用能力，并有测试独立复现：

```
locating slots that call sendSsoInternal (0x137cf84)
  found in slots: 36 37
  ok   slot 36 is among them (the main send entry)
  ok   slot 37 is among them (the no-response sibling)
  ok   exactly two slots, got 2
```

### 三个必须记住的约束

**1. 选错表是这个任务里最容易犯的错。**
`nt::MSFService` 有 5 张表，**61 槽那张比 44 槽那张宽**，而且 61 个指针各不相同
—— 按"槽最多"或"指针最不重复"去选，都会选中它。但它的 61 个槽里 57 个是
`ret` 空桩（T3b 早已指出）。按它挂 hook 会**静默成功、什么都不做**。

判据必须是"有多少槽指向比一条 `ret` 更长的东西"：

```
vtable 0x87173e8 slots=44 real=43   ← 真正的主表
vtable 0x8717558 slots=61 real=4    ← 57 个 ret 桩
```

`real=4` 与 T3b 的"61 槽表里只有 4 个真函数"独立吻合。已抽成
`primary_vtable(image, all, class_name)`。

**2. 解码器要按 *目标文件* 的架构选，不是按主机。**
在 x86 工作站上分析 aarch64 的 `wrapper.node` 是常态。第一版用
`#if defined(__x86_64__)` 选解码器，结果在 arm64 文件上一个 callsite 都找不到
——现象是"这个槽不发包"，而槽其实完全正确。改为 `image.is_aarch64()` 判断后
立刻命中 36/37。

步长同理：aarch64 定长 4 字节可以直接步进 4，x86 变长必须逐字节走。

**3. 扫描必须有上界，且上界来自同一张表的其它槽。**
不加上界时每个槽都会"调用"它后面那个槽调用的东西；加上界但跨表取，子表
（9/1/4 槽）的窄区间会互相截断，产生不存在的槽号（曾出现 113、114）。

正确做法：取同一张表里比当前函数大的最小槽地址作为上界。

### 端到端证明（不只是改了指针）

改指针只能证明写进去了。relay 的意义是**调用仍然成立**：

```
alpha(41) before hook   = 42      ← 原函数
relay=0x7fdd28f08018
alpha(41) through hook  = 42      ← 经 relay 转发，结果不变
槽恢复后调用            = 42
无 relay 泄漏                     PASS
```

目标进程自己通过虚调用走进 relay、转发回原函数、返回正确值。
relay 的寄存器保存/恢复另有 22 项测试覆盖：6 整型参数、8 个 double、
int/double 混排、变参（int 与 double 两版，即 x86 的 rax 场景）、传值结构体、
多 relay 并存、空 observer。

---

## 补充：登录态不在 MSF 层（T11）

找 `selfInfoOnLoginSuccess`（`0x1323a20`）时，先按直觉在 MSF 三张主表里搜调用图：

```
nt::MSFService:        (none)
nt::MSFCoreService:    (none)
msf::MSFSessionImpl:   (none)
```

再扫**整个 8.8 MB 的 `.text`** 找 `bl`：

```
bl calls to 0x1323a20: 0
```

**零个直接调用点。** 所以它既不能 hook 函数体，也不能 hook 调用点。

把它当 64 位数据字去找，命中两处：文件偏移 `0x13c238`（`.text` 内，是数据）和
`0x8704280`（vaddr `0x8714280`，在 `.data.rel.ro`）。后者周围是一串连续的
`0x132xxxx` 指针，是一张表。往回走找表的起点：

```
table range vaddr 0x8714228 .. 0x87142e8  (24 entries)
selfInfoOnLoginSuccess at index 11
```

`[-1]` 是 type_info `0x8714390`，`list_vtables` 报出它的类名：

```
nt::login::QRCodeLoginRequestImpl   (24 slots)
```

**结论：登录信号是 `nt::login::QRCodeLoginRequestImpl` 的槽 11，不在 MSF 里。**

### 一个差点误判成 bug 的地方

`ElfImage::at(0x8704280)` 读出来是 `0`，而文件偏移 `0x8704280` 处确实是
`0x1323a20`。看着像 `at()` 的 vaddr→offset 换算坏了。

实际上**没坏**。两个 PT_LOAD：

```
LOAD off=0x0        vaddr=0x0         filesz=0x86992f8
LOAD off=0x869c2c0  vaddr=0x86ac2c0   filesz=0x3408a0
```

第二段 vaddr 与 offset 差 `0x10000`。文件偏移 `0x8704280` 对应 vaddr
**`0x8714280`**，不是 `0x8704280`。是**我自己算错了偏移**，`at()` 一直是对的。

教训：在 `.data.rel.ro` 里，`addr == offset` 是**常见但不成立**的假设。
每次都要用 PT_LOAD 换算，别用心算。

### 登录态帧的两个指示位都置位

```
control: status=1 flags=0x4 value0=1000000002 msg=1000000002
recv:    status=1 flags=0x4 value0=1000000002 msg=1000000002
```

Node 侧 `logged_in = (flags & 0x4) || status != 0`，两路都成立，不存在
"只对一半"的兼容风险。

**必须是主动推送，不能等请求。** op 7 是 push 帧：Node 侧用它来唤醒登录
waiter。如果只在请求时回复，那么**登录前就连上的客户端永远等不到状态变化**，
而它的收包路径又是"未登录就不处理"—— 表现就是客户端一个包都收不到，
且没有任何报错。测试专门先连两条通道、再触发登录来覆盖这个顺序。
