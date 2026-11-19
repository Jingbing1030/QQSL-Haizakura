# 载荷 → Node 收包路径与 QQ 消息结构

> 任务 T5 / 逆向对象：SnowLuma 的 **hook 管道收包侧**（payload pipe → Node bridge → OneBot 事件）
>
> 参考实现（**只读**）：
> - 主参考 `~/x64run/index.mjs`（12,446,348 B / 370,505 行，runtime 2.4.2）
> - 交叉验证 `~/sl-ref/index.mjs`（12,338,350 B / 367,423 行）
> - 交叉验证 `~/sl-hz/dist/index.mjs`（12,339,442 B / 367,445 行）
> - **未打包 TS 还原源** `~/sl-hz/packages/{bridge,protocol,core,onebot}/src/*.ts`（最有价值的证据源）
> - oracle `<host>:~/qqsl-hz/restored/dist/index.mjs`（13,910,041 B / 374,166 行，0.2.4.2）
>
> 标注约定：**[实证]** = 有代码字面量直接支撑；**[推断]** = 由代码行为反推、无正向字面量；
> **[未验证]** = 本机无运行中的 QQ，无法用真包核对。

---

## 0. 先说三个结论（避免踩坑）

| 项 | 值 |
| --- | --- |
| 帧魔数 | `827344977` = **`0x31504851`**（小端在线字节 `51 48 50 31` = ASCII `QHP1`） |
| ~~`0x3157D141`~~ | **任务书给的十六进制值是错的**。`0x3157D141` = 827,838,785 ≠ 827,344,977。代码只比对十进制 `827344977` |
| `CLIENT_MESSAGE_RECEIPT_CMD` | **`"ClientMessageReceipt"`**（纯字面量，无协议号） |

> **[实证]** `~/x64run/index.mjs:1778` `var PIPE_MAGIC = 827344977;`；
> `:2013` `if (magic !== 827344977 || version !== 1) throw new Error(...)`。
> 纠正十六进制：`python3 -c "print(hex(827344977))"` → `0x31504851`。
> 这个 ASCII `QHP1` 是自洽的（QQ Hook Pipe v1），而 `0x3157D141` 只是接近但不等于。

---

## 1. 完整帧布局（40 字节固定头 + 变长 payload）

```
偏移  大小  字段          类型             说明
────  ────  ────────────  ───────────────  ─────────────────────────────────────────
 0     4    magic         uint32 LE        固定 827344977 (0x31504851)；不匹配直接抛错
 4     2    version       uint16 LE        固定 1；不匹配直接抛错
 6     2    op            uint16 LE        操作码，见 §2 / §3
 8     4    requestId     uint32 LE        control 通道的请求关联 ID；recv 通道恒 0
12     4    status        int32  LE        有符号！语义随 op 变（错误码 / loggedIn 布尔 / 22 的可用性）
16     4    flags         uint32 LE        bit0 = WantReply，bit2 = LoggedIn（仅 op 7 有意义）
20     4    cmd_len       uint32 LE        ≤ 4096      (MAX_PIPE_CMD_BYTES)
24     4    msg_len       uint32 LE        ≤ 65536     (MAX_PIPE_MSG_BYTES)
28     4    body_len      uint32 LE        ≤ 16777216  (MAX_PIPE_BODY_BYTES = 16 MiB)
32     8    value0        uint64 LE        op 相关（seq / pid / uin / 原因码）
────  ────  ────────────  ───────────────  ─────────────────────────────────────────
40     cmd_len    cmd       utf8 串         不保证 NUL 结尾；长度由 cmd_len 独立裁切
40+cmd_len  msg_len  msg      utf8 串        同上
...    body_len   body     raw bytes       protobuf 或自定义小端结构，见 §6
```

**总长** = `40 + cmd_len + msg_len + body_len`。

### 1.1 解析器行为（`FrameReader`，`~/x64run/index.mjs:1993-2060`）

```js
// 伪代码，逐行对应 index.mjs:1993..2060
push(chunk):
  while chunkOffset < chunk.length:
    if 无 pending:
      把 chunk 剩余字节拷进 40B header 缓冲，凑够 40 字节才继续
      magic  = header.readUInt32LE(0)   // 必须 == 827344977
      version= header.readUInt16LE(4)   // 必须 == 1
      cmdLen / msgLen / bodyLen = readUInt32LE(20/24/28)
      validatePipeFrameLengths(...)     // 超限抛 Error（不是跳过！）
      payloadLength = cmdLen + msgLen + bodyLen
      分配 payload 缓冲（0 长度时复用 Buffer.alloc(0)）
    继续把字节灌进 pending.payload，直到收满
    收满后一次性回调 onFrame：
      frame.cmd  = payload[0 .. cmdLen].toString("utf8")
      frame.msg  = payload[cmdLen .. cmdLen+msgLen].toString("utf8")
      frame.body = Buffer.from(payload[cmdLen+msgLen ..])
```

**关键实现细节 [实证]**：

1. **粘包/半包都支持**。`headerBytes` 与 `pending.received` 两个游标分离，
   一次 `push()` 里可以连续解出多帧（`while` 循环不 return）。
2. **UTF-8 解码是宽松的**。用 `Buffer.toString("utf8")`（非 `fatal`），
   非法字节会变成 U+FFFD 而不是抛错。
3. **长度越界是致命错误**，不是"丢掉这帧继续"。`validatePipeFrameLengths` 抛 `Error`，
   直接冒到 socket `'data'` 事件 → `socket.on("error")` → 会话进入 error 状态。
   也就是说：**接收方对长度字段零容忍，写载荷时算错长度一定会断连接。**
4. **没有 CRC、没有 NUL 终止、没有对齐填充**。纯长度前缀。

### 1.2 双通道拓扑

```
                    QQ 进程（Linux: QQ NT）
   ┌──────────────────────────────────────────────────────┐
   │  snowluma-linux-x64.so  （hook 载荷，注入到 QQ 内）  │
   │                                                      │
   │   mojo.<pid>.control.sock  ── Node 主动 connect ──┐  │
   │   mojo.<pid>.recv.sock     ── Node 主动 connect ──┤  │
   └───────────────────────────────────────────────────┼──┘
                                                       │
                          $XDG_RUNTIME_DIR/mojo.<pid>.{control,recv}.sock
                          （或 $SNOWLUMA_RUNTIME_DIR，见 hook-runtime-dir.ts）
                                                       │
   ┌───────────────────────────────────────────────────▼──┐
   │  Node 侧  QqHookClient（~/x64run/index.mjs:2061）     │
   │    controlSocket → handleControlFrame()  :2563        │
   │    recvSocket    → handleRecvFrame()     :2617        │
   └──────────────────────────────────────────────────────┘
```

**[实证]** socket 命名：`mojoPipeName()` at `:1827`
```js
if (process.platform === "win32") return `\\\\.\\pipe\\mojo.${pid}.${suffix}`;
return path.join(runtimeDir, `mojo.${pid}.${suffix}.sock`);
// suffix ∈ {"control", "recv"}
```
**[实证]** 连接方向是 **Node → 载荷**：`connectPipe()` at `:2426` 用 `net.createConnection(pipeName)`，
所以载荷侧是 **listen/accept** 方（Linux 上由 `.so` 在 QQ 进程内 `bind()` + `listen()`）。

**两条通道的分工 [实证]**：

| 通道 | 方向 | 承载 |
| --- | --- | --- |
| `control` | **双向** | Node→载荷请求(op 2)、载荷→Node ACK(3)/应答(4)/错误(5)；也承载 hello(1) 和 login(7) |
| `recv` | **单向 载荷→Node** | 业务数据包(op 6)、登录状态(7)、客户端私聊回执(21)、私聊上报可用性(22) |

`recv` 上没有 Node 的写路径 —— **[实证]** `writeControl()` (`:2377`) 只读 `this.controlSocket`，
全代码库没有 `writeRecv`。`send()`/`sendAckOnly()` 都走 control。

---

## 2. recv 通道 op 一览（本文重点）

| op | 方向 | 含义 | cmd | msg | status | flags | value0 | body |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 载荷→Node | hello | `""` | **pipe 名** | 0 | 0 | **pid** | 空 |
| 6 | 载荷→Node | **业务数据包** | `serviceCmd` | `uin`（十进制串） | 错误码 | 0 | **seq** | QQ 包体 |
| 7 | 载荷→Node | 登录状态变化 | `""` | `uin`（十进制串）或空 | **`!=0` 即已登录** | bit2=LoggedIn | **uin 数值** | 空（见 §4） |
| 21 | 载荷→Node | 客户端私聊回执 | **必须 `""`** | `uin`（必须 == 当前账号） | 错误码 | **必须 0** | **seq**（>0） | 自定义封装（见 §5） |
| 22 | 载荷→Node | 私聊上报可用性 | — | — | **`==1` 可用** | — | 原因码 | — |

> 注意：**op 21 的 `cmd` 在线上是空串**，不是 `CLIENT_MESSAGE_RECEIPT_CMD`。
> `CLIENT_MESSAGE_RECEIPT_CMD` 是 **Node 侧合成出来的常量**，只在 `emit("packet")` 时填入 `cmd` 字段。
> **[实证]** `:2633` 校验 `frame.cmd !== ""` 就报 "Invalid client message receipt"，
> 然后 `:2640` 才写 `cmd: CLIENT_MESSAGE_RECEIPT_CMD`。

---

## 3. control 通道 op 一览（对照用）

| op | 方向 | 含义 | 字段填法 |
| --- | --- | --- | --- |
| 1 | 载荷→Node | hello | 同 recv 的 op 1 |
| 2 | **Node→载荷** | 请求 | `requestId != 0`；`flags` bit0=WantReply；`cmd`=serviceCmd；`body`=请求体 |
| 3 | 载荷→Node | ACK | 回填 `requestId`；无 body。Node 收到即 `pending.resolve()` |
| 4 | 载荷→Node | 应答 | 回填 `requestId`；`status`=错误码；`msg`=错误消息；`body`=应答数据 |
| 5 | 载荷→Node | 错误 | `requestId != 0` → 拒绝该 pending；**`requestId==0 && cmd=="runtime"` → 致命故障** |
| 7 | 载荷→Node | 登录状态 | 同 recv 的 op 7 |
| 17 | **Node→载荷** | 登录身份提示 | `value0` = uin；`requestId != 0`；无 body。载荷回 op 3 ACK |

**op 5 的两种语义 [实证]** `:2595-2615`：
```js
if (frame.op === 5) {
  const error = new HookPipeRequestError(frame.msg || `pipe error ${frame.status}`, frame.status, frame.requestId);
  if (frame.requestId === 0 && frame.cmd === "runtime") {
    this.runtimeFailure = error;          // 粘滞标志，之后所有帧一律 return
    this.rejectControlPending(error);
    this.rejectRecvPending(error);
    this.rejectLoginWaiters(error);
    this.emit("runtimeError", error);     // → 上层标记整条 hook 链路死亡
    return;
  }
  // 否则按 requestId 精确拒绝
}
```
→ **载荷一旦发生不可恢复的运行时故障，会发 `op=5, requestId=0, cmd="runtime"`，
Node 进入 `runtimeFailure` 粘滞状态，此后 `handleControlFrame` / `handleRecvFrame`
第一行就 `return`，任何后续帧全部丢弃。** 这是唯一的"全局熔断"信号。

**op 17 [实证]** `:2115`：`await this.sendAckOnly(17, BigInt(uin), "login identity hint")`。
用于"Node 从 QQ 本地数据库探到 uin，但载荷还没确认登录"的场景 ——
载荷拿这个 hint 去**核对**自己的登录态，仍要自己发 op 7 才算权威。
注意 `sendAckOnly` 会分配非零 `requestId` 并**等 op 3 ACK**（`:2403-2422`）。

---

## 4. op 7 —— 登录状态（问题重点 ①）

### 4.1 结论：**`loggedIn` 与 `uin` 都不在 body 里**，body 恒为空

```js
// ~/x64run/index.mjs:2535-2544  （★ 就是 applyLoginStateFrame，三个副本逐字节相同）
applyLoginStateFrame(frame) {
    const flaggedLoggedIn = (frame.flags & PipeFlagLoggedIn) !== 0;   // PipeFlagLoggedIn = 4
    const statusLoggedIn  = frame.status !== 0;
    const loggedIn        = flaggedLoggedIn || statusLoggedIn;       // 两者是 OR
    const uinNumber       = BigInt(frame.value0);
    const uin             = frame.msg || uinNumber.toString();       // msg 优先
    this.applyLoginState({ loggedIn, uin, uinNumber });
}
```

**字段映射表 [实证]**：

| 逻辑字段 | 物理位置 | 类型 | 说明 |
| --- | --- | --- | --- |
| `loggedIn` | `header.status` **或** `header.flags` bit2 | int32 / bit | **OR 关系**：`status != 0` 或 `flags & 4`，任一为真即已登录 |
| `uin`（字符串） | `header.msg` | utf8 串 | 十进制 UIN；**空串时回落到 `value0` 的十进制表示** |
| `uinNumber` | `header.value0` | uint64 | UIN 的数值形式 |
| `body` | — | — | **完全不被读取**。`applyLoginStateFrame` 只碰 flags/status/value0/msg |
| `cmd` | — | — | 不被读取 |
| `requestId` | — | — | 不被读取；op 7 不参与请求关联 |

**不是 JSON，不是二进制结构，就是 header 里三个字段。** 问题书里"在 body 或 msg 里"的疑问：
**msg 里只有 uin 一个串，没有 `loggedIn`**；`loggedIn` 只在 `status`/`flags`。

### 4.2 为什么同时看 status 和 flags？

**[推断]**（有行为证据，无正向注释）：这是对载荷版本差异的**双写兼容**。
老版本载荷可能只填 `status`（0/1 当布尔），新版本加了 `PipeFlagLoggedIn=4` 这个位
以便和其他 flag（WantReply=1）共存而不互相覆盖。Node 用 `||` 让两种都成立。

> 反向证据：`PipeFlagWantReply = 1` 与 `PipeFlagLoggedIn = 4` 是仅有的两个 flag，
> 说明 flags 是个"位集合"，把登录状态塞进 status 会浪费 flags 的位 ——
> 所以更可能是**先有 status，后加 flag**。

### 4.3 后续链路（login state 如何变成"可以收发"）

```
载荷发 op7
  → applyLoginStateFrame        (:2535)
  → applyLoginState             (:2547)  去重：loggedIn 和 uin 都没变则只 emit 不重跑
  → emit("loginState")
  → HookSession.handleLoginState (:4290)
        uin 必须过 isRealUin   ← 关键闸门
        this.loggedIn = state.loggedIn && isRealUin(uin)
        _uin = 合法 ? uin : "0"
        ├─ 合法 && loggedIn → emit("login", uin, sender)，日志 "login detected"
        └─ 不合法 / 未登录 → startLoginReconcile()，每 3s 重试身份探测
```

**[实证]** `:4295` 附近：
```js
const validIdentity = isRealUin(uin);
const invalidLoginState = state.loggedIn && !validIdentity;
if (invalidLoginState && !this.invalidLoginStateReported)
    this.log.warn("Login readiness rejected: PID=%d reason=invalid_account_identity", this.pid);
this._uin = validIdentity ? uin : "0";
this.loggedIn = state.loggedIn && validIdentity;
```

**含义**：载荷说"已登录"**不等于** Node 认账。Node 还要求 uin 像真的。
不合法时进 `startLoginReconcile()`（每 3 s 一次 `detectLoginOnce()`），
从 QQ 的本地账号数据库探 uin，探到就发 **op 17** 让载荷核对。

### 4.4 `isRealUin` 判定规则（问题重点 ④）

```js
// ~/sl-hz/packages/common/src/uin.ts  (整文件仅 4 行有效代码)
// 对应 ~/x64run/index.mjs:1663
function isRealUin(uin) {
    return /^\d{5,10}$/.test(uin);
}
```

**[实证] 规则**：字符串形式、**纯 ASCII 十进制数字**、**长度 5..10**。
即 00000–9999999999（数值上 0..9999999999），但注意：

- **必须是字符串**。传 `undefined`/`number` 时 JS 会转成 `"undefined"`/`"123"`，
  `"123"`（3 位）不通过、`undefined` 不通过。
- **不接受前导 `+`、空白、全角数字、科学计数**。
- 上界 10 位 → 最大 9,999,999,999（略超 uint32，但 QQ UIN 实际 ≤ 10 位）。
- **长度 5 是这个规则里最"意外"的一环**：短号（1–4 位 UIN）会被判非法。
  代码里没有对短号的例外，所以 SnowLuma **在语义上不支持 5 位以下 QQ 号**。
  **[推断]** 这是刻意的防误判：`"0"`、`"1"`、`"123"` 常作为"未登录/占位/测试"出现。

另有注释 `~/x64run/index.mjs:5623`：
> *those failing isRealUin (i.e. 11+ digits) are deleted — legitimate accounts*

说明 11 位以上一律当脏数据清理，与正则一致。

**`isRealUin` 的调用点（≥12 处）全都在做"信任闸门"**：
op7 的 uin、op6/op21 的 uin、账号目录名扫描、在线账号列表、存储管理 API 入参。

---

## 5. op 6 与 op 21

### 5.1 op 6 —— 业务数据包（**收包主干**）

```js
// ~/x64run/index.mjs:2647-2655
if (frame.op !== 6) return;
this.emit("packet", {
    seq:   Number(frame.value0),   // ← header.value0
    error: frame.status,           // ← header.status（int32，QQ 返回码）
    cmd:   frame.cmd,              // ← cmd 段（serviceCmd 字符串）
    uin:   frame.msg,              // ← msg 段（十进制 UIN 字符串）
    body:  Buffer.from(frame.body) // ← body 段（原始 QQ 包体）
});
// 注意：没有 source 字段 → 下游视为普通 push（fromClient: false）
```

**与 op 21 的铁证对比 —— 唯一的差别是 `source` 与校验严格度**：

| | op 6 | op 21 |
| --- | --- | --- |
| `cmd` 段 | 由载荷填 serviceCmd | **必须空串**，否则丢弃 |
| `uin` 段 | 由载荷填 | **必须过 `isRealUin`**，否则丢弃 |
| `requestId` | 不检查 | **必须 0** |
| `flags` | 不检查 | **必须 0** |
| `value0` (seq) | 不检查（可为 0） | **必须 `>0` 且 `≤ Number.MAX_SAFE_INTEGER`** |
| `status` | 直接当 `error` 传下去 | 同 |
| `source` | **不设** | **`"client-message"`** |
| 解析器 | `pipeline.process(pkt)` → `cmdHandlers_` 查表 | **`processClientMessage()`**（另走一条路，见 §5.3） |

**[实证]** `:2633` 那行超长 if：
```js
if (frame.cmd !== "" || frame.requestId !== 0 || frame.flags !== 0 ||
    frame.value0 <= 0n || frame.value0 > BigInt(Number.MAX_SAFE_INTEGER) ||
    !isRealUin(frame.msg)) {
    runtimeLog.warn("Invalid client message receipt: PID=%d", this.pid);
    return;
}
```

### 5.2 `CLIENT_MESSAGE_RECEIPT_CMD` 的值（问题重点 ③）

```js
// ~/sl-hz/packages/common/src/protocol-types.ts  (整个文件就这一行有效代码)
// 对应 ~/x64run/index.mjs:1700
var CLIENT_MESSAGE_RECEIPT_CMD = "ClientMessageReceipt";
```

**就是字符串 `"ClientMessageReceipt"`（23 字符）**。它：

- **不是** QQ 的 trpc service 名（对比：`"trpc.msg.olpush.OlPushService.MsgPush"`）。
  没有 `.` 分隔、没有 trpc 前缀、没有 `Sso`/`Oidb` 命名 —— 一眼能看出是 SnowLuma 自造的。
- **不出现在 wire 上**。op 21 帧的 `cmd` 段是空串（§5.1 校验要求 `cmd === ""`）。
- 作用：在 Node 内部的 packet 对象上给 op 21 一个**伪 serviceCmd**，让它能复用
  `packet` 事件总线和 `seqId`/`retCode` 日志格式。
- 下游 `decodeClientMessageReceipt` 立刻用它做入口断言：
  `pkt.serviceCmd !== "ClientMessageReceipt"` → 抛 "invalid source or account"。

> 所以它的行为更像一个**内部 tag**，而非协议常量。若你重写载荷，
> **绝不要**在 op 21 的 `cmd` 段里写这个字符串 —— 会被判非法丢弃。

### 5.3 op 21 为什么不走 op 6，而要多这一条路（问题重点 ⑤）

这是全篇最需要理解的**设计动机**。看 `processClientMessage`（`:348814`）：

```js
async processClientMessage(pkt, connection) {
    const receipt = decodeClientMessageReceipt(pkt, this.identity.uin);
    const key = JSON.stringify([pkt.pid, receipt.peerUid, receipt.sequence,
                                receipt.clientSequence, receipt.timestamp]);
    const pending = this.clientMessageTasks_.get(key);
    if (pending?.connection === current) return pending.work;   // 幂等去重
    if (this.clientMessageTasks_.size >= 256) throw new Error("Too many pending client message lookups");
    const work = (async () => {
        // ★ 关键：Node 反手发一个 SsoGetC2cMsg 去拉历史
        const event = await fetchClientMessage(
            { sendPacket: (cmd, body, timeout) => requireConnection().client.sendPacket(cmd, body, timeout) },
            this.identity, receipt);
        requireConnection();
        await this.pipeline.processEvents(pkt, [event]);   // 复用同一套 msg-push 解码器
    })();
    ...
}
```

**原因链 [实证 + 推断]**：

1. **`body` 里根本没有消息内容**。op 21 的 body 只有 `peerUid` + `clientSequence` +
   一个 `SendMessageResponse` protobuf（服务器对**自己发出的那条消息**的确认回执）。
   —— **[实证]**，见 §6.4 的字段布局：`envelope` 只含 uid/seq，`ack` 只含
   `privateSequence`/`timestamp1`/`result`/`serverResult`。**没有 elements、没有文本。**

2. 因此 Node **必须二次请求**：用回执里的 `(peerUid, privateSequence)` 作为
   `SsoGetC2cMsg(friendUid, startSequence=seq, endSequence=seq)` 的键，
   去 QQ 服务器把这**一条**消息的完整 `PushMsgBody` 拉回来。
   —— **[实证]** `:171629-171667` `fetchClientMessage`，`SSO_GET_C2C_MSG_CMD = "trpc.msg.register_proxy.RegisterProxy.SsoGetC2cMsg"`。

3. 拉回后做**逐字段严格比对**，防止竞态/错位：
   ```js
   if (!head || !route || route.fromUin !== selfUin || route.toUid !== receipt.peerUid ||
       !route.toUin || route.grp != null || head.ntMsgSeq !== receipt.sequence ||
       head.sequence !== receipt.clientSequence || head.timestamp !== receipt.timestamp)
       throw new Error("Client message lookup did not match the confirmed message");
   ```
   —— **[实证]** `:171654`（同一函数内的校验块）。

4. 再**复用** `decodeFriendMessage(context)` 生成标准 `friend_message` 事件，
   并追加生存性检查（`classifyMessageSurvival(...) === "keep"`）。
   —— **[实证]** `:171663-171665`。

5. **为什么需要这条路？** —— **[推断]**：QQ NT 在多端场景下，**本账号从别的客户端
   （手机/另一台电脑）发出的私聊消息**，QQ 内核不会为它走 OlPush 推送给自己；
   只在发送端拿到服务器 ACK 时给 hook 一个"回执"回调。若不补这条路径，
   bot 就**完全看不见自己账号在别处发的私聊**（OneBot 的 `message_sent` 事件会缺失）。
   这与 `to-message.ts` 里 `postType = isSelf ? "message_sent" : "message"` 的设计吻合。

6. **代价**：op 21 是**异步 + 可能重试**的。`fetchClientMessage` 对
   `result === 100000301 && !messages.length`（"历史还没落盘"）做 5 次指数退避重试
   （100/250/500/1000/2000 ms），**最长阻塞约 3.85 s**。所以它不能和 op 6 走同一个
   同步 `handler(pkt)` 接口 —— 必须是 `async` 独立分支。

**一句话**：**op 6 是"消息推送，body 自带内容"；op 21 是"发送回执，body 只有键，内容要再拉一次"。**

### 5.4 op 22 —— 客户端私聊上报可用性

```js
// ~/x64run/index.mjs:2627-2631
if (frame.op === 22) {
    if (frame.status === 1) runtimeLog.debug("Client private-message reporting is available: PID=%d", this.pid);
    else runtimeLog.warn("Client private-message reporting is unavailable: PID=%d status=%d%s",
                         this.pid, frame.status,
                         frame.value0 === 0n ? "" : ` reason=${frame.value0}`);
    return;
}
```

**[实证]** 只读 `status` 和 `value0`，**没有 body、没有 cmd、没有 msg**。

- `status == 1` → op 21 那条路可用。
- 否则 → 不可用，载荷**不会**发 op 21；`value0` 是原因码（0 = 无原因/未给出）。
- **Node 侧只打日志，不做任何降级动作**。也就是说：即便收到"不可用"，
  Node 也不会去订阅别的补丁路径 —— 只是从此看不到自发私聊。

**[推断]** `status` 用 `1` 而非 `0` 表示"可用"，与 op 7 的 `status != 0` 是同一种
"非零即真"风格；但这里**偏偏写死 `=== 1`**，说明载荷只会发 0/1，
且 Node 想把"未知非零值"也当不可用（保守策略）。

---

## 6. `body` 里的 QQ 消息结构

### 6.0 三层同心结构总览

```
Frame.body  (op 6, serviceCmd = "trpc.msg.olpush.OlPushService.MsgPush")
│
└─ PushMsg                          ← 最外层信封（protobuf）
   ├─ f1 message : PushMsgBody
   └─ f3 status  : varint           （推送级状态）
      │
      └─ PushMsgBody                ← 一条消息
         ├─ f1 responseHead : ResponseHead    （发信人/群/转发元数据）
         ├─ f2 contentHead  : ContentHead     （msgType/subType/seq/时间戳）
         └─ f3 body         : MessageBody     （真正的内容）
            ├─ f1 richText   : RichText
            └─ f2 msgContent : bytes          （备用/降级内容）
               │
               └─ RichText
                  ├─ f2 elems[]       : Elem   ← 消息元素数组（文本/图片/@/卡片…）
                  ├─ f3 notOnlineFile : NotOnlineFile
                  └─ f4 ptt           : Ptt
```

### 6.1 `PushMsg`（`~/x64run/index.mjs:144186`，`buildContext` 的入口）

| 字段号 | wire | 名称 | 类型 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | 2 | `message` | `PushMsgBody` | **只解这一个**；为 null 则 `buildContext` 返回 null → 整包丢弃 |
| 3 | 0 | `status` | int32 | 收下但 `buildContext` 不看 |

**[实证]** `buildContext`（`:144293`）：
```js
function buildContext(pkt, identity) {
    if (pkt.body.length === 0) return null;
    const push = protobuf_decode_PushMsg(pkt.body);
    if (!push?.message) return null;                 // ← f1 缺失 = 不是消息推送
    let selfUin = 0;
    if (pkt.uin) { const n = parseInt(pkt.uin, 10); if (!isNaN(n)) selfUin = n; }
    return buildContextFromMessage(push.message, selfUin, identity, false);
}
```
注意 `selfUin` **来自帧的 `msg` 段（uin 串），不是 protobuf 里**。

### 6.2 `PushMsgBody`（`:137244`）

| 字段号 | wire | 名称 | 类型 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | 2 | `responseHead` | `ResponseHead` | 缺失时 `fromUin=0, fromUid=""` |
| 2 | 2 | `contentHead` | `ContentHead` | **为 null 则 `buildContext` 直接返回 null（丢弃）** |
| 3 | 2 | `body` | `MessageBody` | 缺失时 `content` 退化为空 `Uint8Array(0)` |

### 6.3 `ResponseHead` / `ContentHead`（`:137375` / `:138185`）

**ResponseHead**

| 字段号 | wire | 名称 | 类型 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | 0 | `fromUin` | uint64 | 发信人 UIN（群聊时是成员） |
| 2 | 2 | `fromUid` | string | `u_xxx` 形式；C2C 的 peerUid 来源 |
| 3 | 0 | `type` | uint32 | |
| 4 | 0 | `sigMap` | uint64 | |
| 5 | 0 | `toUin` | uint64 | 收信人（自发回显时用于定位 peer） |
| 6 | 2 | `toUid` | string | |
| 7 | 2 | `forward` | `ResponseForward` | → `f5 tempGroupUin`、`f6 friendName`（**`senderNick` 来源**） |
| 8 | 2 | `ResponseGrp` | `ResponseGrp` | → `f1 groupUin`、`f2 memberName`、`f4 memberCard`、`f5 memberCardType`、`f7 groupName`、`f8 messageKey` |

**ContentHead**

| 字段号 | wire | 名称 | 类型 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | 0 | `msgType` | uint32 | **决定走哪个 decoder**（见 §6.6 PkgType） |
| 2 | 0 | `subType` | uint32 | 二级分类（notice 全靠它） |
| 3 | 0 | `c2cCmd` | uint32 | C2C 控制信令；非 0 常被 `classifyMessageSurvival` 判 `drop-control` |
| 4 | 0 | `msgId` | uint32 | 随机消息 ID；`msgId & 0x7FFFFFFF` 后作为去重元组的 `random` |
| 5 | 0 | `sequence` | uint32 | **msgSeq / clientSeq** → OneBot `message_seq` |
| 6 | 0 | `timestamp` | uint32 | Unix 秒 → OneBot `time` |
| 7 | 0 | *(无名字段)* | uint64 | 代码里 `_f6` 未进 result map（生成器漏标） |
| 10 | 0 | `autoReply` | bool | |
| 11 | 0 | `ntMsgSeq` | uint32 | **权威 NT 序列** → 优先作为 OneBot `message_id` |
| 12 | 0 | `newId` | uint64 | |

> **`sequence` 与 `ntMsgSeq` 的双序列是私聊解码的一个坑 [实证]**：
> `friend-message.ts` 里 `sequenceAuthoritative = ctx.head.ntMsgSeq > 0`；
> `to-message.ts` 里
> `messageIdSequence = hasCanonicalNtSequence ? ntMsgSeq : event.msgSeq`，
> 且 `clientSequence: event.clientSeq ?? event.msgSeq`。
> c2c 有时**不带 ntMsgSeq**，此时降级用 `sequence` 并
> `warnMissingC2cSequence(...)` 打一条 warn。

### 6.4 op 21 的 body —— 自定义小端封装（**非 protobuf 的外层**）

**这是唯一一处"手写二进制"而非 protobuf 的地方 [实证]**，代码在
`~/sl-hz/packages/protocol/src/msg-push/client-message-receipt.ts`（对应 `~/x64run/index.mjs:171606`）：

```
偏移  大小      字段                类型        说明
────  ────────  ──────────────────  ──────────  ──────────────────────────────
 0     1        version             uint8       必须 == 1
 1     1        peerLength          uint8       peerUid 的字节长度（3..128）
 2     2        reserved            uint16 LE   必须 == 0
 4     4        clientSequence      uint32 LE   客户端本地序号，必须 != 0
 8     peerLen   peerUid             utf8 串     必须匹配 /^u_[A-Za-z0-9_-]+$/
 8+peerLen  ...  ack                 protobuf    SendMessageResponse（剩余全部字节）
```

**长度约束 [实证]**：`body.length ∈ [12, 65672]`；
`ackOffset = 8 + peerLength < body.length`；`body.length - ackOffset ≤ 65536`。

**`SendMessageResponse`（`ack` 部分，decoder 在 `:170971`）**

| 字段号 | wire | 名称 | 类型 | 用途 |
| --- | --- | --- | --- | --- |
| 1 | 0 | `result` | int32 | 必须 `== 0`（否则 "Client message was not accepted"） |
| 2 | 2 | `errMsg` | string | |
| 3 | 0 | `timestamp1` | uint32 | **必须存在**；后续与 `head.timestamp` 比对 |
| 4 | 0 | `reviewResult` | int32 | 必须 `== 0` |
| 5 | 2 | `serverResult` | `SendMessageServerResult` | `{type, code, message}`；`code` 必须 `== 0` |
| 10 | 0 | `field10` | uint64 | |
| 11 | 0 | `groupSequence` | uint64 | **必须 `== 0`**（私聊才走这条路） |
| 12 | 0 | `timestamp2` | uint64 | |
| **14** | 0 | **`privateSequence`** | uint64 | **核心键**：私聊消息的服务器 ntMsgSeq |

**校验清单（任何一条不过就抛错 → `processClientMessage` 失败 → 无事件）[实证]**：

```js
body.length  ∈ [12, 65672]
body[0]      === 1
body[1]      = peerLength ∈ [3, 128]
body.readUInt16LE(2) === 0
ackOffset    = 8 + peerLength < body.length
body.length - ackOffset <= 65536
peerUid      ~ /^u_[A-Za-z0-9_-]+$/
clientSequence !== 0
ack.result === 0 && ack.reviewResult === 0 && ack.serverResult?.code === 0
ack.privateSequence 存在 && ack.timestamp1 存在 && ack.groupSequence === 0
```

### 6.5 `MessageBody` → `RichText` → `Elem`（`:138446` / `:138555` / `:138686`）

**MessageBody**

| 字段号 | wire | 名称 | 类型 |
| --- | --- | --- | --- |
| 1 | 2 | `richText` | `RichText` |
| 2 | 2 | `msgContent` | bytes |

**RichText**

| 字段号 | wire | 名称 | 类型 |
| --- | --- | --- | --- |
| 2 | 2 (repeated) | `elems` | `Elem` |
| 3 | 2 | `notOnlineFile` | `NotOnlineFile` |
| 4 | 2 | `ptt` | `Ptt` |

**Elem —— 15 个 oneof 槽位（同一时刻通常只有一个非空）**

| 字段号 | 名称 | 类型 | 用途 |
| --- | --- | --- | --- |
| 1 | `text` | `TextElem` | 纯文本 |
| 2 | `face` | `FaceElem` | 系统表情（小黄脸） |
| 3 | `onlineImage` | `OnlineImage` | 在线图片 |
| 4 | `notOnlineImage` | `NotOnlineImage` | 离线图片 |
| 5 | `transElem` | `TransElem` | 内嵌透传（`elemType`/`elemValue`，**XML 卡片常藏这里**） |
| 6 | `marketFace` | `MarketFace` | 商城表情 |
| 8 | `customFace` | `CustomFace` | 自定义表情 |
| 12 | `richMsg` | `RichMsg` | 富文本 XML |
| 13 | `groupFile` | `GroupFileElem` | 群文件 |
| 16 | `extraInfo` | `ExtraInfo` | |
| 19 | `videoFile` | `VideoFile` | 视频 |
| 37 | `generalFlags` | `GeneralFlags` | `{bubbleDiyTextId, groupFlagNew, uin, longTextFlag, longTextResId}` |
| 45 | `srcMsg` | `SrcMsg` | 引用/回复源消息 |
| 51 | `lightApp` | `LightAppElem` | 小程序/JSON 卡片（`data` + `msgResid`） |
| 53 | `commonElem` | `CommonElem` | **通用透传槽**：`{serviceType, pbElem, businessType}` |

**`TextElem`**：`f1 str`（utf8）、`f2 link`（utf8 URL）、`f3 attr6Buf`、`f4 attr7Buf`、`f11 buf`、`f12 pbReserve`（均 raw bytes）

**`CommonElem` 是扩展性的关键 [实证]**：`serviceType`/`businessType` 是数字，
`pbElem` 是**再嵌套一层的 protobuf**（不透明）。群 @、群公告、骰子、回应、
以及很多新玩法都在这里，SnowLuma 按 `serviceType` 分支解（`rich-body-decoder.ts`）。

### 6.6 `serviceCmd` 的实际字面量（问题重点 ②）

**`serviceCmd` 就是 `cmd` 段的字符串，等于 QQ 的 trpc/Sso 服务名。**
Node 侧只注册了两个 handler（`:348719-348720`）：

```js
this.pipeline.registerCmd(MSG_PUSH_CMD, (pkt, identity) => parseMsgPushOrThrow(pkt, identity, this.sysMsgDedup_));
this.pipeline.registerCmd(KICK_NT_CMD, parseKickNT);
```

| serviceCmd 字面量 | 常量名 | 位置 | 说明 |
| --- | --- | --- | --- |
| `"trpc.msg.olpush.OlPushService.MsgPush"` | `MSG_PUSH_CMD` | `:179455` | **绝大多数消息**（私聊/群/临时/各类 notice 都在这一个 service 下，靠 `msgType`/`subType` 分流） |
| `"trpc.qq_new_tech.status_svc.StatusService.KickNT"` | `KICK_NT_CMD` | `:348109` | 被踢下线 → `bot_offline` 事件 |
| `"trpc.qq_new_tech.status_svc.StatusService.SsoHeartBeat"` | `QQ_RECV_HEARTBEAT_CMD` | `:3745` | **心跳**，不是事件 —— 只用来给收包看门狗"上弦" |
| `"ClientMessageReceipt"` | `CLIENT_MESSAGE_RECEIPT_CMD` | `:1700` | **Node 自造**，op 21 专用伪 cmd（不在 wire 上） |

> **重要**：`cmdHandlers_` 是 `Map<string, parser[]>`，**没注册的 cmd 会被静默丢弃**，
> 只留一条 trace 日志 `branch=parser_unregistered`。[实证] `:348174-348187`。
> 所以"一条消息能不能变成 OneBot 事件"的第一道闸就是 **`serviceCmd` 是否在白名单里**。
>
> 观察到的**其他** trpc 名（都在 Node→载荷方向，是请求不是收包）：
> `OidbSvcTrpcTcp.0x11ea_100`、`0x11e9_100`、`0x11c4_100`、`0x11c5_100`、`0x126e_100`、`0x126d_100`、
> `"MessageSvc.PbSendMsg"`、`"trpc.msg.msg_svc.MsgService.SsoReadedReport"`、
> `"trpc.msg.register_proxy.RegisterProxy.SsoGetC2cMsg"`、`"trpc.msg.register_proxy.RegisterProxy.SsoGetRoamMsg"`、
> `"HttpConn.0x6ff_501"`、`"trpc.basic.corp.Datacard.SsoCorpInfo"`、
> `"QunAlbum.trpc.qzone.webapp_qun_media.QunMedia.GetAlbumList"` 等。

**心跳的实际作用 [实证]** `noteReceiveActivity`（`:4455`）：
```js
if (!this.receiveWatchArmed) {
    if (cmd !== QQ_RECV_HEARTBEAT_CMD) return;   // 没见过心跳 = 不武装
    this.receiveWatchArmed = true;               // 上弦
}
// 之后任何包都刷新 lastReceiveAt，恢复 receiveHealthy
```
配合 `RECEIVE_STALE_AFTER_MS = 90000` / `RECEIVE_STALE_CONFIRM_MS = 15000`：
**心跳只为"沉默即健康未知"这个场景提供基线**，不产生任何事件。

> **[未验证]** 本机无运行中 QQ，以上 serviceCmd 集合取自代码字面量，
> 未用真实抓包确认 QQ 是否还会发未注册的 service（如 `trpc.msg.olpush.*` 之外的变体）。

### 6.7 `msgType` → decoder 路由（`PkgType`，`~/sl-hz/packages/protocol/src/msg-push/enums.ts`）

| `msgType` | 枚举名 | 处理 |
| --- | --- | --- |
| **166** | `PrivateMessage` | `decodeFriendMessage` → `friend_message` |
| 9 | `ForwardFakePrivateMessage` | 同 166 |
| 208 | `PrivateRecordMessage` | 同 166 |
| 529 | `PrivateFileMessage` | 同 166 |
| **82** | `GroupMessage` | `decodeGroupMessage` → `group_message` |
| **141** | `TempMessage` | `decodeTempMessage` → `temp_message` |
| 528 | `Event0x210` | `decodeEvent0x210`（好友请求、戳一戳、输入状态、资料赞…按 `subType`） |
| 732 | `Event0x2DC` | `decodeEvent0x2DC`（群禁言/表情回应/撤回/灰条/精华…按 `subType`） |
| 33 | `GroupMemberIncreaseNotice` | `decodeGroupMemberJoin` |
| 34 | `GroupMemberDecreaseNotice` | `decodeGroupMemberLeave` |
| 85 | `GroupSelfJoinedNotice` | `decodeGroupSelfJoined` |
| 44 | `GroupAdminChangedNotice` | `decodeGroupAdmin` |
| 84 | `GroupRequestJoinNotice` | `decodeGroupJoinRequest` |
| 525 | `GroupRequestInvitationNotice` | `decodeGroupInvitation` |
| 87 | `GroupInviteNotice` | `decodeGroupInvite` |

**生存性过滤 [实证]** `classifyMessageSurvival`（`blank-filter.ts:47`）：
```js
if (isC2cControlPush(head))    return "drop-control";   // c2cCmd != 0 的信令包
if (isOfflineFileReceipt(body)) return "drop-receipt";   // 离线文件回执
if (elements.length !== 0)      return "keep";
if (hasDecodableContent(body))  return "keep-undecoded"; // 留着但 warn
return "drop-blank";
```

### 6.8 `seq`（`value0`）的作用（问题重点 ⑦）

**结论：`seq` 是载荷侧对"收包流"的单调编号，Node 侧只用于日志/追踪，不用于去重。**

**[实证]** 全代码库对 `seqId` 的 48 处引用，**除日志外没有一处参与逻辑**：

| 位置 | 用途 |
| --- | --- |
| `hook-session.ts:712` `seqId: packet.seq` | 原样搬运 |
| `manager.ts:125,137,166` | 只在 `trace()` 的参数里 |
| `packet-pipeline.ts:68..243`（20+ 处） | 全部在 trace 日志 |
| `msg-push/index.ts:52..80` | 全部在 trace 日志 |
| `bridge.ts:157,162` | `client_message_lookup_start/complete ... seqId=` —— 日志 |

**去重实际靠什么 [实证]**：

1. **op 21**：`key = JSON.stringify([pid, peerUid, sequence, clientSequence, timestamp])`
   —— 用**业务字段**去重（`core/src/bridge/bridge.ts:147`），与帧的 `value0` 无关。
2. **系统消息**：`deriveSysMsgDedupIdentity(ctx)` 用
   `{peerUid, chatType, sequence: head.sequence, random: head.msgId}`（`sysmsg-dedup.ts`）
   —— 完整复刻 QQ NT `sys_msg_mgr.cc::ProcessRecvSysMsg` 的
   `global_key = {peerUid}_{chatType}_{msg_seq}_{random}`。
   注释明确写了这是为了"避免重复上报 QQ 内核本来会丢弃的系统事件"。

**那 `seq` 到底是什么？ [推断]**（依据：语义 + 校验规则）

- 它是载荷内**每个 recv 连接**的递增计数器，op 6 与 op 21 **共享同一序列空间**
  （否则 op 21 里"`value0 > 0` 必须成立"这条就没有意义 —— 共享才能保证回执也有号）。
- 用途是**人肉排障 + 定位丢包**：`seq` 出现跳号 → 载荷侧漏发；
  日志里 `seqId=` 让一条消息从 `packet_push` → `packet_branch` → `packet_terminal`
  能串起来（同一次 `packet_push`/`packet_terminal` 的 seqId 一定相同）。
- **不是一个可信赖的"消息序号"**：它不是 QQ 的 msgSeq，跨连接会重置，
  也不能和 `sequence`/`ntMsgSeq` 混用。
- **不校验连续性**：Node 从不检查 `seq` 是否 `prev+1`，所以载荷即使发错号也不会被发现。

> **[未验证]** "递增/每连接重置"是从 `value0 > 0` 的校验和语义反推的；
> `.so` 是二进制，本机无运行中 QQ，无法 grep 到计数器实现。

---

## 7. 一条 QQ 消息的完整生命周期

### 7.1 ASCII 数据流图

```
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ ①  QQ 服务器                                                            │
 │    trpc.msg.olpush.OlPushService.MsgPush  (protobuf PushMsg)                 │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     │ TLS / MSF 长连接
 ┌───────────────────────────────────▼──────────────────────────────────────────┐
 │ ②  QQ NT 进程（Linux x64）                                                   │
 │    MSF 收包线程 → QQ 内核的 msg-push 分发                                    │
 │         ├── 内核自己的 listener（写 DB、UI 气泡）                             │
 │         └── 【hook 载荷】snowluma-linux-x64.so 注册的 callback  ★插桩点       │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     │ 载荷拿到 (serviceCmd, uin, retCode, body)
                                     │ body = 原始 PushMsg bytes（未改写的 protobuf）
 ┌───────────────────────────────────▼──────────────────────────────────────────┐
 │ ③  载荷侧：组帧                                                              │
 │    op       = 6                                                              │
 │    cmd      = "trpc.msg.olpush.OlPushService.MsgPush"                        │
 │    msg      = "10001"（十进制 UIN 串）                                       │
 │    status   = retCode（0 = 成功）                                            │
 │    value0   = seq（本连接递增）                                              │
 │    flags    = 0                                                              │
 │    body     = 原样 PushMsg bytes                                             │
 │    → 40B header + cmd + msg + body                                           │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     │ write() 到已 accept 的
                                     │   $XDG_RUNTIME_DIR/mojo.<pid>.recv.sock
                                     │   （单向：载荷→Node；Node 侧从不写）
 ┌───────────────────────────────────▼──────────────────────────────────────────┐
 │ ④  Node: FrameReader.push(chunk)            index.mjs:1993                   │
 │    半包缓冲 → 校验 magic(827344977)/version(1) → 校验 3 个长度上限           │
 │    → 按 cmdLen/msgLen/bodyLen 切三段 → onFrame({op,requestId,status,flags,   │
 │                                              value0,cmd,msg,body})           │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼──────────────────────────────────────────┐
 │ ⑤  Node: QqHookClient.handleRecvFrame(frame)   index.mjs:2617                │
 │    op 1  → resolveHello（记 pipe 名 + pid）                                  │
 │    op 7  → applyLoginStateFrame（见 §4）                                     │
 │    op 22 → 只打日志                                                          │
 │    op 21 → 严格校验 → emit packet{source:"client-message"}                   │
 │    op 6  → emit packet{seq,error,cmd,uin,body}          ★ 本流程走这里       │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     │ 'packet' 事件
 ┌───────────────────────────────────▼──────────────────────────────────────────┐
 │ ⑥  HookSession.handlePacket(packet)            index.mjs:4427               │
 │    if (!this.loggedIn) return;              ← 未登录全丢                     │
 │    if (source==="client-message" && uin !== this._uin) return;  ← 账号不符丢 │
 │    if (!isRealUin(uin)) return;             ← uin 不合法全丢                 │
 │    noteReceiveActivity(cmd, uin)            ← 收包看门狗/健康度              │
 │    onPacket({pid, uin, serviceCmd: cmd, seqId: seq,                         │
 │              retCode: error, fromClient: false, body})                      │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼──────────────────────────────────────────┐
 │ ⑦  BridgeManager.onPacket → onPacketInContext  manager.ts:117               │
 │    if (!isRealUin(pkt.uin)) return;         ← 第二次 uin 闸门                │
 │    bindPid(pid, uin) → ensureSession(uin)   ← 按 UIN 找/建 Bridge           │
 │    session.onPacket(pkt) → pkt.source==="client-message"                    │
 │                              ? processClientMessage（§5.3 二次拉取）         │
 │                              : pipeline.process(pkt)                        │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼──────────────────────────────────────────┐
 │ ⑧  IncomingPacketPipeline.processWithHandlers  packet-pipeline.ts:60        │
 │    handlers = cmdHandlers_.get(pkt.serviceCmd)                              │
 │    handlers 不存在 → trace "parser_unregistered" → 静默丢弃  ★静默丢弃点     │
 │    for handler: events = handler(pkt, identity)                             │
 │      handler = parseMsgPushOrThrow（MsgPush）| parseKickNT（KickNT）          │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼──────────────────────────────────────────┐
 │ ⑨  parseMsgPushInternal                        index.mjs:179487             │
 │    ctx = buildContext(pkt, identity)                                        │
 │      └─ protobuf_decode_PushMsg(body) → .message : PushMsgBody              │
 │      └─ buildContextFromMessage → {head, fromUin, fromUid, selfUin,         │
 │                                    content, body, responseHead, identity}   │
 │    dedup(deriveSysMsgDedupIdentity) → 重复则 return []                      │
 │    events = registry.decode(ctx)     ← 按 head.msgType/subType 路由          │
 │    filter(classifyMessageSurvival)   ← drop-control/receipt/blank           │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     │ Event[] {kind:"friend_message", elements, ...}
 ┌───────────────────────────────────▼──────────────────────────────────────────┐
 │ ⑩  pipeline.dispatchEvent → EventBus                                        │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     │
 ┌───────────────────────────────────▼──────────────────────────────────────────┐
 │ ⑪  OneBot event-converter: convertFriendMessage → convertPrivateMessage      │
 │      message_type: "private", sub_type: "friend"                            │
 │      message_id    = ntMsgSeq > 0 ? ntMsgSeq : msgSeq                       │
 │      message_seq   = head.sequence                                          │
 │      user_id       = senderUin                                              │
 │      message       = elementsToOneBotSegments(...)                          │
 │      post_type     = isSelf ? "message_sent" : "message"                    │
 │    → WebSocket / HTTP 推给 OneBot 客户端                                     │
 └──────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 op 21（自发私聊）的额外分支

```
⑨'  BridgeManager.processClientMessage            index.mjs:348814
      receipt = decodeClientMessageReceipt(pkt, selfUin)   ← §6.4 手写封装
      key = JSON.stringify([pid, peerUid, sequence, clientSequence, timestamp])
      幂等：同 key 已有 in-flight → 直接 return 它的 promise
      ↓
      fetchClientMessage(sender, identity, receipt)        index.mjs:171629
        request = SsoGetC2cMsg{friendUid: peerUid,
                               startSequence: seq, endSequence: seq}
        sender.sendPacket("trpc.msg.register_proxy.RegisterProxy.SsoGetC2cMsg",
                          request, 5000ms)
            ↑ 注意：这里回到 control 通道发 op 2（Node→载荷）
        循环：result==100000301 && 无 messages → 退避重试 100/250/500/1000/2000ms
        ↓
        严格比对：fromUin/selfUin、toUid/peerUid、grp==null、
                  ntMsgSeq==receipt.sequence、sequence==receipt.clientSequence、
                  timestamp==receipt.timestamp
        ↓
        decodeFriendMessage(buildContextFromMessage(msg,...))
        classifyMessageSurvival === "keep"
      ↓
      pipeline.processEvents(pkt, [event])    ← 复用 ⑩⑪ 的下游，零分叉
```

### 7.3 会在哪一步"悄悄消失"（排障清单）

| 步骤 | 丢弃原因 | 日志特征 |
| --- | --- | --- |
| ④ FrameReader | magic/version 不符，或长度超限 | 抛 Error（**断连接**，不只是丢帧） |
| ⑥ HookSession | `!loggedIn` | 无日志（静默） |
| ⑥ | op 21 的 uin ≠ 当前账号 | `Client message receipt belongs to an inactive account` |
| ⑥ | `!isRealUin(uin)` | 无日志（静默） |
| ⑧ pipeline | `serviceCmd` 未注册 | `packet_branch ... branch=parser_unregistered`（trace 级） |
| ⑨ buildContext | body 空 / 不是合法 PushMsg / 无 contentHead | `branch=push_context_invalid` |
| ⑨ dedup | 系统消息重复 | `branch=duplicate_system_push` |
| ⑨ survival | c2c 控制包 | `branch=c2c_control_push` |
| ⑨ | 离线文件回执 | `branch=offline_file_receipt` |
| ⑨ | 空消息 | `branch=empty_message` |
| ⑨ | decoder 抛错 | `branch=parser_exception` + `handler error for %s` |
| ⑨' | op 21 任一校验失败 | `Client message receipt has an invalid ...` |
| ⑨' | 拉历史超时（5×退避 ≈3.85s） | `Client message history is still unavailable after N attempts` |

> **注意 trace 级日志默认看不到**。`SNOWLUMA_LOG_LEVEL=trace` 才展开
> `packet_branch` / `packet_terminal`；否则只能看到 `warn`/`error`。
> 排障时"消息没出现"的最常见真相是 ⑧ 的 `parser_unregistered`，
> 而它**在默认级别下完全无声**。

---

## 8. 实证 / 推断 一览

| # | 结论 | 级别 | 证据 |
| --- | --- | --- | --- |
| 1 | 帧头 40 B，字段序同任务书 | **实证** | `index.mjs:1950-1975` `encodeFrame`；`:1993` `FrameReader` |
| 2 | `magic = 827344977`，**hex 是 `0x31504851` 不是 `0x3157D141`** | **实证** | `:1778`、`:2003` + `hex(827344977)` |
| 3 | 长度上限 4096 / 65536 / 16 MiB，超限**抛错**而非丢帧 | **实证** | `:1779-1781`、`:1973-1992` |
| 4 | 支持粘包/半包；UTF-8 宽松解码 | **实证** | `FrameReader.push` 双游标结构 |
| 5 | recv 通道 Node 侧**只读不写** | **实证** | 无 `writeRecv`；`writeControl` 只取 `controlSocket` |
| 6 | Node 是 connect 方，载荷是 listen 方 | **实证** | `net.createConnection(pipeName)` `:2426` |
| 7 | **op 7 的 `loggedIn` 在 `status!=0` 或 `flags&4`，body 不读** | **实证** | `applyLoginStateFrame` `:2535-2544` |
| 8 | op 7 的 `uin` 在 `msg`，空则回落 `value0` 十进制 | **实证** | 同上 `frame.msg \|\| uinNumber.toString()` |
| 9 | `status`/`flags` 双写是版本兼容 | **推断** | flag 只有 WantReply=1 与 LoggedIn=4 两个位 |
| 10 | `isRealUin = /^\d{5,10}$/` | **实证** | `uin.ts` 全文 / `:1663` |
| 11 | 载荷说"已登录"不等于 Node 认账，还要过 `isRealUin` | **实证** | `handleLoginState` `:4290-4300` |
| 12 | `CLIENT_MESSAGE_RECEIPT_CMD = "ClientMessageReceipt"` | **实证** | `protocol-types.ts` 全文 / `:1700` |
| 13 | **op 21 线上 `cmd` 为空串**，该常量在 emit 时才填入 | **实证** | `:2633` 校验 + `:2640` 赋值 |
| 14 | op 21 要求 `requestId==0`、`flags==0`、`value0>0`、`uin` 过 `isRealUin` | **实证** | `:2633` |
| 15 | op 21 的 body 是 8 B 手写小端头 + peerUid + `SendMessageResponse` | **实证** | `client-message-receipt.ts:7760-7782` |
| 16 | op 21 必须二次 `SsoGetC2cMsg` 拉内容，body 不含消息内容 | **实证** | `fetchClientMessage` `:171629`；§6.4 字段表 |
| 17 | op 21 存在的原因 = 补"本账号在别处发的私聊" | **推断** | 结合 `post_type:"message_sent"`；无正向注释 |
| 18 | `SsoGetC2cMsg` 重试 5 次（100/250/500/1000/2000 ms），`result==100000301` 触发 | **实证** | `historyRetryDelays` |
| 19 | 二次拉取后逐字段比对 6 个字段防错位 | **实证** | `fetchClientMessage` 校验块 |
| 20 | op 22 只看 `status==1` 与 `value0`，只打日志不降级 | **实证** | `:2627-2631` |
| 21 | op 5 `requestId==0 && cmd=="runtime"` = 全局熔断，粘滞生效 | **实证** | `:2595-2605` |
| 22 | op 17 = Node→载荷 登录身份 hint，等 op 3 ACK | **实证** | `:2115` `sendAckOnly(17, ...)` |
| 23 | `PushMsg` = `{f1 message: PushMsgBody, f3 status}` | **实证** | decoder `:144186` 字段表 |
| 24 | `PushMsgBody` = `{f1 responseHead, f2 contentHead, f3 body}` | **实证** | decoder `:137244` |
| 25 | `ContentHead.f11 ntMsgSeq` 优先作 `message_id`，缺失降级 `sequence` | **实证** | `to-message.ts` |
| 26 | `RichText.elems[]` 是 15 槽 oneof；`commonElem{f53}` 是通用透传 | **实证** | decoder `:138686` |
| 27 | `serviceCmd` 白名单只有 MsgPush + KickNT，其余静默丢 | **实证** | `:348719-348720`、`:348174-348187` |
| 28 | `SsoHeartBeat` 只武装看门狗，不产生事件 | **实证** | `noteReceiveActivity` `:4455` |
| 29 | `msgType` → decoder 的映射表 | **实证** | `enums.ts` + `registry.register` |
| 30 | **`seq`(value0) 不参与去重，只进日志** | **实证** | 48 处 `seqId` 引用全在 trace |
| 31 | 去重实际用 `{pid,peerUid,seq,clientSeq,ts}`（op21）与 `{peerUid,chatType,seq,random}`（sysmsg） | **实证** | `bridge.ts:147`、`sysmsg-dedup.ts` |
| 32 | `seq` 是每连接递增、op6/op21 共享序列空间 | **推断** | 由 `value0>0` 校验反推；`.so` 是二进制无法 grep |
| 33 | Node 不校验 `seq` 连续性 | **实证** | 无任何 `prev+1` 比较 |
| 34 | oracle `qqsl-hz` 0.2.4.2 的 recv 协议与 2.4.2 **完全一致** | **实证** | oracle `:2610-2662` 与 `x64run:2617-2671` 逐字节 diff 为空 |
| 35 | `~/qqsl-hz` 本机不存在 | **实证** | `ls` ENOENT；只在 oracle 上有 |

### 8.1 版本交叉验证

| 副本 | 行数 | 字节 | `PipeFlagLoggedIn` | `applyLoginStateFrame` | recv op 集合 |
| --- | --- | --- | --- | --- | --- |
| `~/x64run/index.mjs` | 370,505 | 12,446,348 | 4 | 同 | 1/6/7/21/22 |
| `~/sl-ref/index.mjs` | 367,423 | 12,338,350 | 4 | **逐字节相同** | 同 |
| `~/sl-work/dist/index.mjs` | 367,423 | 12,338,350 | 4 | 同 | 同 |
| `~/sl-hz/dist/index.mjs` | 367,445 | 12,339,442 | 4 | 同 | 同 |
| oracle `qqsl-hz/restored` 0.2.4.2 | 374,166 | 13,910,041 | 4 | **逐字节相同** | 同 |

**结论：从 2.4.2 到 0.2.4.2，收包路径的线上协议零变化。**
5 个副本的 `handleRecvFrame` 都是同一组 op（1/6/7/21/22），
`applyLoginStateFrame` 逻辑完全一致，常量值全部相同。
oracle 那个更新的构建只多了 6,721 行（约 +1.8%），增量不在收包协议层。

---

## 9. 给重写者的检查清单

写载荷时，能过掉 Node 侧所有闸门的最小要求：

1. **listen** 在 `$XDG_RUNTIME_DIR/mojo.<pid>.control.sock` 与 `...recv.sock`
   （或 `$SNOWLUMA_RUNTIME_DIR` 下），**accept 后立刻发 op 1 hello**
   （`msg` = pipe 名，`value0` = pid）—— 否则 Node 的 `waitForHello` 卡 60 s 后
   `Connection handshake timed out`。
2. **魔数写 `827344977`**（小端 `51 48 50 31`），不要写 `0x3157D141`。
3. **version 写 1**。
4. **三个长度字段必须精确等于实际字节数** —— 差一个字节就会让 Node 的
   `FrameReader` 抛错并**断掉整条连接**，不是丢一帧。
5. 登录时发 **op 7**：`status=1`（或 `flags|=4`）+ `msg="<uin>"` + `value0=uin`。
   **uin 必须是 5–10 位纯数字**，否则 Node 会一直 `startLoginReconcile()` 轮询。
6. 业务包发 **op 6**：`cmd` = 真实 trpc service 名，`msg` = uin 十进制串，
   `value0` = 严格递增的 `seq`（>0），`flags=0`，`body` = 原始 protobuf。
7. 私聊回执发 **op 21**：**`cmd` 留空**、`flags=0`、`requestId=0`、
   `value0` = seq（>0）、`msg` = 当前账号 uin、`status` = 0、`body` 按 §6.4 封装。
8. 收到 op 17 后**回 op 3 ACK**（回填 `requestId`），否则 Node 会 3 次重试后放弃。
9. 不可恢复故障时发 **op 5**：`requestId=0, cmd="runtime", msg=<原因>`。
   注意这是**单向不可逆**的熔断。
10. **不要**在 op 21 的 `cmd` 里写 `"ClientMessageReceipt"` —— 会被判非法丢弃。

---

*本文所有行号基于 `~/x64run/index.mjs`（12,446,348 B / 370,505 行，runtime 2.4.2）。
未打包 TS 源的行号基于 `~/sl-hz/packages/*/src/`。
本机无运行中 QQ 进程，一切"线上行为"结论均来自代码，未用真实抓包核对。*