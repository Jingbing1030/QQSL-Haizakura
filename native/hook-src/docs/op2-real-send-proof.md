# op2 真实发送：端到端证据（SnowLuma 2.4.0 / hz-test）

**日期**：2026-11-22 14:45:42（Asia/Shanghai）
**环境**：甲骨文服务器 `hz-test` 容器，`@snowluma/runtime 2.4.0`，
QQ 3.2.32-52194，UIN 10001（TestBot），`SNOWLUMA_LOG_LEVEL=trace`。
**未触碰**：生产容器 `snowluma-hz`。

## 1. 触发

```
POST http://127.0.0.1:3000/send_group_msg?access_token=<token>
{"group_id":1234567890,"message":[{"type":"text","data":{"text":"hz-op2-proof-r5-1447"}}]}
```

响应：

```json
{"status":"ok","retcode":0,"data":{"message_id":-843467800}}
```

## 2. 参考实现自己打的四条 trace（同一 requestId=9）

```
14:45:42 TRACE [QQHook.Packet] [req#168] packet_send
  serviceCmd="MessageSvc.PbSendMsg" requestId=9 length=50
  body=0a0812060896ccf0c803120208011a1c0a1a12180a160a14687a2d6f70322d70726f6f662d72352d313434372888ff948102

14:45:42 TRACE [Bridge.Packet] [req#171] packet_push
  serviceCmd="MessageSvc.PbSendMsg" seqId=9385932 retCode=0 fromClient=false
  pid=80 uin="10001" length=39
  body=080018969f8ad806500058932f60969f8ad806700078f32182010c08012208d8cc688de21aa1b2

14:45:42 TRACE [QQHook.Packet] [req#168] packet_recv
  serviceCmd="MessageSvc.PbSendMsg" requestId=9 error=0 message="" length=39
  body=080018969f8ad806500058932f60969f8ad806700078f32182010c08012208d8cc688de21aa1b2

14:45:42 TRACE [QQHook.Packet] [req#168] packet_terminal
  serviceCmd="MessageSvc.PbSendMsg" requestId=9 outcome=ok reason=reply_received error=0 elapsedMs=322
```

**这就是 op2 发送成功的完整证据链**：request 写出 → 服务端 op4 回包 →
`outcome=ok reason=reply_received error=0`。之前 PROGRESS 里
「op2 真实发送尚未证实」这一条，现在**对参考实现已经证实**。

## 3. op2 请求体逐字段解码（50 字节）

| 字段 | 值 | 含义 |
|---|---|---|
| 1 (bytes, 8B) | `12060896ccf0c803` | routingHead；sub2 = varint `539312008`… 实为 `grp.groupCode` 的 varint 片段 |
| 2 (bytes, 2B) | `0801` | contentHead；**type = 1** |
| 3 (bytes, 28B) | `0a1a12180a160a14` + `hz-op2-proof-r5-1447` | messageBody.richText.elems，**文本逐字节可见** |
| 5 (varint) | **539312008** | **random（本地随机数）** |

注：字段 4（clientSequence）发的是 0，protobuf 省略，因此线上不存在。

## 4. op4 回包逐字段解码（39 字节）

| 字段 | 值 |
|---|---|
| 1 | 0（result，接受） |
| 3 | 1795329942 |
| 10 | 0 |
| **11** | **6035（groupSequence）** |
| 12 | 1795329942 |
| 14 | 0 |
| 15 | 4339 |
| 16 (bytes) | `08012208d8cc688de21aa1b2`；sub1=1，sub4=8 字节 `d8cc688de21aa1b2` |

**回包里没有任何字段等于返回的 `message_id`（-843467800）**。这一点我最初判错了，
以为 `field16.sub4` 是 id，实测 LE/BE 解出来都对不上。

## 5. 关键结论：`message_id` 是本地哈希，不是 QQ 回的

参考实现 `sendGroup` 里写的是：

```js
messageId: random & 2147483647 || seq
```

而 OneBot 层返回给客户端的 id 又是另一层——`hashMessageIdInt32`：

```js
sha1(`${sequence}:${sessionId}:${eventName}`).digest().readInt32BE(0)
```

**实测验证**：

```
sha1("6035:1234567890:group_message") 的前 4 字节 int32BE = -843467800   ← 与返回值完全一致
```

Haizakura 的 `ts/src/onebot/actions/message-id.ts:75` 里的
`hashMessageIdInt32` 与上述公式相同，`extended.ts:2284` 在 `send_group_msg`
上用的正是它。**已用真实字节写成回归测试**：
`ts/test/message-id-real-capture.test.ts`（4/4 通过），它断言：

- 请求 field 3 里确实逐字节含 `hz-op2-proof-r5-1447`，field 5 = 539312008；
- 回包 field 11 = 6035，且**回包中不存在**等于返回 id 的 varint；
- `hashMessageIdInt32(6035, 1234567890, GROUP_MESSAGE_EVENT) === -843467800`；
- 该推导对三个输入都敏感（换任一个都会变），`NaN` 退化为 0 而非 `"NaN"`。

## 6. 这份证据**不能**证明什么

1. **不能证明 Haizakura 自己能发送。** 上面每个字节都出自参考实现。
   Haizakura 侧仍然是 `MessageApi.sendGroup` → `sendRawPacket`，
   需要绑定 PID 与 listener，尚未在真机上验证。
2. **不能证明 op3 ACK 等于发送成功。** 本实验的分辨力来自
   `packet_terminal outcome=ok reason=reply_received`，
   即**收到了关联的 op4 回包**，而不是 ACK。
3. **不能证明 message_id 能反查消息。** 它是哈希，`recallGroup` 用的是
   `groupSequence`（6035），两者不能互相替代。

## 7. 复现命令

```bash
# 1) trace 级别（必须在容器环境变量里，文件日志拿不到 trace）
docker run ... -e SNOWLUMA_LOG_LEVEL=trace ...
# 2) 发送
curl -s -X POST "http://127.0.0.1:3000/send_group_msg?access_token=<TOKEN>" \
  -H 'Content-Type: application/json' \
  --data-binary '{"group_id":1234567890,"message":[{"type":"text","data":{"text":"hz-op2-proof-..."}}]}'
# 3) 取证（文件日志永远没有 trace，只能 docker logs）
docker logs --since 3m hz-test 2>&1 | grep -E 'PbSendMsg'
```

> ⚠️ **token 必须字面写在命令里**。在本机经 `oracle_sh` 执行时，
> `T=<token>; curl ... -H "Authorization: Bearer $T"` 的变量展开会被吞掉，
> 导致莫名其妙的 401。用 `?access_token=<字面值>` 最稳。
---

## 8. 补充（同日）：我方编码器与参考请求**逐字节相同**

把参考实现真实发出的那 50 字节作为金标准，用**我方** `encodeSendMessageRequestRichText`
喂同样逻辑参数（群 1234567890、random 539312008、文本 `hz-op2-proof-r5-1447`）：

```
ours  : 0a0812060896ccf0c803120208011a1c0a1a12180a160a14687a2d6f70322d70726f6f662d72352d313434372888ff948102
target: 0a0812060896ccf0c803120208011a1c0a1a12180a160a14687a2d6f70322d70726f6f662d72352d313434372888ff948102
len   : 50 vs 50
MATCH : true
```

这比「字段看着对」强得多：它同时钉住了**字段号、嵌套层级、varint 编码**，
以及最关键的 **`random` 落在 field 5**（接收方正是靠它做关联）。

已固化为 `ts/test/op2-encode-real-capture.test.ts`（3/3 通过），其中还包括：
- 文本必须逐字节出现在请求里；
- 请求必须以 `2888ff948102` 结尾（field 5 = random）；
- 换一个 random 时，**只有 field 5 及其后变化**，前面整个信封前缀保持不变。

### 这里仍**不**证明的事

编码一致 ≠ 能发出去。传输层（绑定 PID、arm injector、等待关联 op4）
仍未在真机验证。`sendGroup` 在 `groupSequence<=0` 时抛 "delivery unconfirmed"
是正确行为，但它只是防止把未送达当成功，不能替代真实发送。
