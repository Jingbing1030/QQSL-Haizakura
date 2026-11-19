# 载荷通信协议（任务 T4）

本文是**代码实证**还原，来源是 SnowLuma 打包产物
`~/x64run/index.mjs` 里的 `FrameReader` / `encodeFrame` / `QqHookClient`。
所有常量、字段偏移、op 编号都直接读自该文件，不是猜测。

载荷（闭源 `.so`）开两个 Unix socket：

```
<runtimeDir>/mojo.<pid>.control.sock    控制通道
<runtimeDir>/mojo.<pid>.recv.sock       收包通道
```

`runtimeDir` 在 Linux 上是 `$XDG_RUNTIME_DIR` 或 `/tmp/runtime-<uid>`。

---

## 1. 帧格式

**固定 40 字节头 + 三段变长载荷。全部小端。**

```c
struct FrameHeader {          /* 40 bytes */
  uint32_t magic;             /* +0   0x31504851 (827344977)  */
  uint16_t version;           /* +4   必须为 1               */
  uint16_t op;                /* +6   操作码，见下表          */
  uint32_t request_id;        /* +8   请求关联号（0 = 非请求） */
  int32_t  status;            /* +12  错误码 / 状态          */
  uint32_t flags;             /* +16  位标志                 */
  uint32_t cmd_len;           /* +20  <= 4096               */
  uint32_t msg_len;           /* +24  <= 65536              */
  uint32_t body_len;          /* +28  <= 16 * 1024 * 1024   */
  uint64_t value0;            /* +32  通用 64 位槽           */
};
```

紧跟头部的载荷，**按此顺序紧密排列，无填充、无对齐**：

```
+40                    cmd   (cmd_len  字节, UTF-8)
+40+cmd_len            msg   (msg_len  字节, UTF-8)
+40+cmd_len+msg_len    body  (body_len 字节, 任意二进制)
```

总帧长 = `40 + cmd_len + msg_len + body_len`。

### 长度上限（源码常量）

| 字段 | 上限 | 常量名 |
|---|---|---|
| cmd | 4096 | `MAX_PIPE_CMD_BYTES` |
| msg | 65536 | `MAX_PIPE_MSG_BYTES` |
| body | 16 MiB | `MAX_PIPE_BODY_BYTES` |

超限时 Node 侧直接抛 `pipe frame <field> length N exceeds limit M`，
**不解码**。载荷侧必须遵守同样的上限，否则整条通道报废。

### flags 位

| 值 | 名字 | 含义 |
|---|---|---|
| `0x1` | `PipeFlagWantReply` | 请求方希望收到 op=4 应答 |
| `0x4` | `PipeFlagLoggedIn` | 登录状态帧里表示"已登录" |

---

## 2. op 码表

### 控制通道（control.sock）

| op | 方向 | 语义 | 关键字段 |
|---|---|---|---|
| **1** | 载荷 → Node | **hello**（双向：Node 发一次，载荷回一次） | `msg` = pipe 路径, `value0` = pid |
| **2** | Node → 载荷 | **请求** | `request_id` != 0, `cmd` = serviceCmd, `body` = 请求数据, `flags` = 是否要应答 |
| **3** | 载荷 → Node | **ACK**（已收到，未处理完） | `request_id` 回填 |
| **4** | 载荷 → Node | **应答**（处理完成） | `request_id`, `status` = 错误码, `msg` = 错误消息, `body` = 应答数据 |
| **5** | 载荷 → Node | **错误** | `request_id`, `status`, `msg` |
| **7** | 载荷 → Node | **登录状态变化** | 见 §3 |

> **op 5 的特例**：`request_id == 0 && cmd == "runtime"` 表示**致命运行时故障**。
> Node 侧收到后标记 `runtimeFailure`，拒绝所有待处理的 ack/reply、
> 拒绝所有等待登录的 waiter，并 emit `runtimeError`。这是载荷无法继续工作时的
> 最后一句话。

### 收包通道（recv.sock）

| op | 方向 | 语义 | 关键字段 |
|---|---|---|---|
| **1** | 载荷 → Node | hello | 同上 |
| **6** | 载荷 → Node | **QQ 数据包**（核心） | `cmd` = serviceCmd, `msg` = uin, `status` = error, `value0` = seq, `body` = 包体 |
| **7** | 载荷 → Node | 登录状态变化 | 见 §3 |
| **21** | 载荷 → Node | **客户端私聊消息回执** | `value0` = seq, `status` = error, `msg` = uin, `body` = 包体, `cmd` 必须为空 |
| **22** | 载荷 → Node | 私聊上报能力探测结果 | `status == 1` 可用；否则不可用，`value0` = 原因码 |

**op 21 的严格校验**（Node 侧，不满足就丢弃并 warn
`Invalid client message receipt`）：

```
cmd == ""  &&  request_id == 0  &&  flags == 0
&&  value0 > 0  &&  value0 <= Number.MAX_SAFE_INTEGER
&&  msg 匹配 /^\d{5,10}$/          (isRealUin)
```

`cmd` 由 Node 侧填成常量 **`"ClientMessageReceipt"`**（`CLIENT_MESSAGE_RECEIPT_CMD`），
不是载荷给的 —— 载荷这一格必须是空串。

---

## 3. op 7：登录状态帧

**不是 JSON，结构全在头部字段里**：

```c
logged_in = (flags & 0x4) != 0        /* PipeFlagLoggedIn */
         || (status != 0);            /* 两个条件任一成立即为已登录 */

uin_number = value0;                  /* 64 位 UIN */
uin        = (msg 非空) ? msg : uin_number 的十进制字符串;
```

Node 侧 `applyLoginStateFrame()` 就是这么算的。之后：

- 若 `loggedIn`/`uin` 与上次**都没变** → 只 emit `loginState`，不触发等待者
- 若变了 → emit `loginState`，且 `loggedIn` 为真时唤醒**所有**登录 waiter

**典型时序**：载荷发现 QQ 登录成功后，在 **control 和 recv 两个通道各发一次** op 7
（两个 `handle*Frame` 都处理 op 7），因为两个通道都要知道登录状态。

---

## 4. 握手流程

```
载荷                                 Node
 |                                    |
 |  (bind control.sock, listen)       |
 |  (bind recv.sock, listen)          |
 |                                    |
 |<------------- connect -------------|   连 control.sock
 |------ op=1 hello (msg=pipe, value0=pid) -->|
 |                                    |   controlHello resolved
 |                                    |
 |<------------- connect -------------|   连 recv.sock
 |------ op=1 hello ----------------> |
 |                                    |   recvHello resolved
 |                                    |
 |------ op=7 登录状态 -------------> |   (登录后才发)
 |                                    |
```

Node 侧 `connect()` 拿到 control hello 后认为控制通道就绪；
`startRecv()` 拿到 recv hello 后认为收包通道就绪。
**两个 hello 都收到**才算 `connectAll()` 完成。

`resolveHello()` 用 `msg` 当 pipe 名、`value0` 当 pid 回报给上层。

### 实测确认（真机 QQ，2026-11-19）

对运行中的载荷（pid 85885）手工发一个 hello 帧后，载荷回了一个合法帧：

```
发送: 40 字节 header, op=1, msg="mojo.85885.control", value0=85885
收到: op=1  magic=0x31504851  version=1  status=0  flags=0x0
      cmdLen=0  msgLen=41  bodyLen=0  value0=85885
      msg = "/tmp/runtime-1000/mojo.85885.control.sock"
```

三点值得注意：

1. **hello 是双向的**。Node 连上后先发一个 hello，载荷**回**一个 hello。
   不是"载荷主动打招呼"，而是回显式的。
2. 载荷回的 `msg` 是**完整绝对路径**（`/tmp/runtime-1000/mojo.85885.control.sock`），
   不是 Node 发过去的那种短名（`mojo.85885.control`）。所以
   `resolveHello()` 把它当 pipe 名用时，拿到的是全路径。
3. `value0` 原样回填 pid，`status`/`flags` 都是 0。

---

## 5. 一次请求的完整往返

```
Node                                    载荷
 |                                       |
 | op=2 request_id=N                     |
 |   cmd="<serviceCmd>"                  |
 |   flags = PipeFlagWantReply ? 1 : 0   |
 |   body=<请求数据>                      |
 |-------------------------------------->|
 |                                       |  载荷处理...
 |<--------- op=3 ACK (request_id=N) ----|  立刻回 ACK
 |                                       |
 |<--------- op=4 reply (request_id=N) --|  处理完成后回应答
 |            status=<错误码>             |
 |            msg=<错误消息>              |
 |            body=<应答数据>             |
```

Node 侧有两级超时：

1. **ack 超时**（`ackTimeoutMs`）—— 等 op=3
2. **reply 超时**（`replyTimeoutMs`）—— 等 op=4，**只在 `wantReply` 时**

若载荷中途出错，可以在任何时候发 **op=5**（带同一个 `request_id`），
Node 会把对应的 ack 和 reply 两个 deferred 都 reject。

**`request_id` 分配**：Node 侧 `allocateRequestId()`，单调递增，
载荷只需原样回填，不需要校验唯一性。

---

## 6. 载荷侧实现要点（给重写用）

1. **必须是顺序阻塞读写** —— 帧是流式的，`FrameReader` 靠 `headerBytes`
   累积 40 字节、再按三条长度拼载荷。载荷侧同理，不能假设一次 `read()`
   拿到完整帧。

2. **hello 必须连上就发**，否则 Node 侧 60s 超时
   （`INITIAL_CONNECTION_TIMEOUT_MS`，日志里就是
   `[Hook] initial connection timed out: ... phase=waiting_channel`）。

3. **两个 socket 各自独立**，各自发 hello、各自发 op 7。
   不要指望在一个通道上发的 hello 能让另一个通道就绪。

4. **op 3 ACK 要早发** —— 先 ACK 再处理，能避免 Node 侧 ack 超时。
   处理慢的请求必须这么做。

5. **`cmd` 长度受 4096 限制**，serviceCmd 一般很短，但要注意 body 有 16MB 上限。
   超大包要么分片（协议本身没定义分片，得看载荷原本怎么做），要么在载荷侧截断。

6. **`value0` 是 64 位**，UIN/session id 都可能超 32 位，别用 `uint32_t` 存。

---

## 7. 未确认项

- **op 21 的触发条件**：什么时候载荷决定走 op 21（client-message）而不是 op 6？
  与 op 22 的能力探测结果应当相关，但具体映射未从代码读出。
- **`body` 的 QQ 层结构**：帧层只是容器，body 里是 QQ 自己的序列化格式。
  这部分见 T5（`docs/payload-recv-format.md`）。
- **`status` 的具体错误码枚举**：Node 侧只透传，没有集中定义，待实测归纳。

---

## 8. 验证方法（T6 用）

手工构造一个合法 hello 帧：

```python
import struct, socket

MAGIC = 0x31504851
def frame(op, request_id=0, status=0, flags=0, value0=0, cmd=b"", msg=b"", body=b""):
    h = struct.pack("<IHH iIII Q".replace(" ", ""),
                    MAGIC, 1, op, request_id, status, flags,
                    len(cmd), len(msg), len(body), value0)
    return h + cmd + msg + body

s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect("/tmp/runtime-1000/mojo.<pid>.control.sock")
s.sendall(frame(1, msg=b"mojo.<pid>.control", value0=<pid>))
# 期望：能继续收到 op=7 等后续帧，不被断开
```

`.replace(" ", "")` 是为了让格式串紧凑；实际用
`"<IHHiIIIQ"` 即可（`i` 是 int32 有符号，对应 `status`）。
