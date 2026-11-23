# 请求 → 操作 全链路分段实测

**日期**：2026-11-22 15:45
**方法**：每一段都用实际跑起来的模块或真实抓包验证，不用「文档写了」当证据。
**结论**：链路**不是**一个百分比，而是 9 段各有不同状态。

## 总览

```
QQ ──op6──> C++ hook ──> recv.sock ──> RecvClient ──> IncomingPacketPipeline
                                                              │
                                                     ┌────────┴────────┐
                                                     ▼                 ▼
                                            MsgPush 解码器        (其它 parser)
                                                     │
                                                     ▼
                                            BridgeEventBus ──> OneBot 事件上报
                                                              │
HTTP 请求 ──> OneBotApi ──> actionRegistry(222/230) ──> ActionContext ──> apis
                                                              │
                                                              ▼
                                                    encode op2 ──> sendRawPacket
                                                              │
                                                    C++ hook 安装 ──> QQ
```

## 逐段状态

| # | 段 | 状态 | 证据 / 缺口 |
|---|---|---|---|
| 1 | **op6 报文格式** | ✅ 已完成 | 40 字节 LE 头，字段偏移已定；`docs/payload-recv-format.md` |
| 2 | **C++ 接收槽定位** | ✅ 已完成 | `TaskManager` 槽 5 = `0x407b840` = `msfDidRecvResponseData`；参数布局见 `docs/vtable-slots.md` §7.3.1 |
| 3 | **C++ recv.sock 帧编码** | ✅ 已完成 | `emit_packet` 实现完整；`test/recv_channel_test.cc` 覆盖 |
| 4 | **C++ 接收槽安装** | ✅ **已接（2026-11-22 16:50 实拍）** | `which == 41` → `hz_hook_function_offset(0x407b840, hz_recv_response_observer)`。真实 QQ 上 13 次调用，`uin`/`cmd` 全部解成真实服务命令（含 `trpc.msg.olpush.OlPushService.MsgPush`），**0 次被 guard 拒绝**；`op6` 帧已在 recv.sock 上解出。详见 `docs/vtable-slots.md` §7.3.1 与 MEMORY 2026-11-22 16:50 |
| 5 | **TS 收包客户端** | ✅ 已完成 | `RecvClient`（Unix socket）、`IncomingPacketPipeline` |
| 6 | **Bridge 注册 MsgPush** | ✅ 已完成 | 本轮修复：此前**根本没注册**，`handlesCmd(MSG_PUSH_CMD)` 曾为 false，现为 true |
| 7 | **MsgPush 解码 → 事件** | ✅ 已完成 | 真实 402B 报文经 `Bridge.onPacket` 产出 `group_message`（group=123456, sender=10002）；`bridge-real-op6-e2e` 5 测 |
| 8 | **HTTP 入口 + action 分发** | ✅ 已完成 | `createOneBotApi` + `actionRegistry`（222 定义 / 230 名称 / 12 类）；`OneBotNetworkManager` 驱动适配器 |
| 9 | **ActionContext 宿主** | 🔄 **进行中** | 精确统计：`ActionContext` 有 **39 个成员、9 个必填**（此前的 53/20 把注释也算进去了）。`createActionMessageProviders` 已覆盖消息子集，宿主类由子代理实现中 |
| 10 | **op2 编码** | ✅ 已完成 | 我方输出与参考真实 50 字节**逐字节相同**；`op2-encode-real-capture` 3 测 |
| 11 | **op2 传输接缝** | ✅ 已完成 | `bindPid`→`sendGroup`→`PacketClient`；无 `groupSequence` 时**拒绝假成功**；`op2-transport-seam` 4 测 |
| 12 | **op2 真实投递** | ❌ **未验证** | 需要第 4 段（C++ hook 安装）先打通 |

## 两个阻塞点（其一已解除）

### ~~阻塞 1：接收槽 observer 未写~~ ✅ 已解除（2026-11-22 16:50）

原先缺的是接收槽 `0x407b840` 的 observer：用 `std::Cr` 规则解 uin/cmd、
读 seq 与 body 范围、调 `emit_packet` 发到 recv.sock、再转回原函数。

**现已实现并实拍验证**（`hz_recv_response_observer`，`which == 41`）：

- 真实 QQ 上 13 次调用，`uin` 解成 `"10001"`、`cmd` 解成
  `"OidbSvcTrpcTcp.0xfd4_1"` / `"trpc.msg.olpush.OlPushService.MsgPush"` 等；
- 短格式（SSO=22 边界）与长格式（`{cap,size,ptr}`）**都在同一次运行里出现并解对**；
- **0 次**被任何 guard 拒绝；
- `op6` 帧带正确 `cmd`/`uin`/`seq`/`body` 到达 recv.sock。

顺带修掉两个真实 bug（详见 MEMORY 2026-11-22 16:50）：`resp+0x38` 是**指针**而非
`{begin,end}` 本身；以及 `hz_safe_read` 自诞生起**永远返回 false**（曾让所有 observer
诊断看起来像"没被调用"）。

> 我曾错误地写成「`addon.cc` 没有 hook 入口」——那是个错判。
> hook 必须在注入 QQ 的 `payload.so` 里安装；`addon.cc` 跑在 Node 进程，
> 本来就不该有 hook 入口。已更正。

**仍未验证**：body 内容与 TS 侧 `MsgPush` 解码结果未做逐字节对照；
`resp+0x40` 语义仍未定。第 12 段（op2 真实投递）还需一次完整端到端发送验证。

### 阻塞 2：ActionContext 没有实现类（挡住 9）

`context.ts` 声明了 53 个成员（20 个必填），`createActionMessageProviders`
只实现了消息相关的子集。缺的是把 `Bridge` + `providers` + `MessageStore`
**组装成** `ActionContext` 的宿主类。

**已知类型摩擦**：`deleteMessage` 返回 `Promise<boolean>`、
`refreshMessageMedia` 返回 `RefreshMediaResult`，而 `ActionContext` 声明
`Promise<void>`。必须显式 `async` 包装并丢弃返回值，**不能** `as unknown as`。

## ✅ 新增：总装入口已落地，发送链路已端到端验证

`ts/src/main.ts` + `ts/test/main.test.ts`（23 测）+ `ts/test/send-seam.test.ts`（5 测）。

**这不是「文档写了」，是真实跑出来的字节。** 用 `HaizakuraRuntime` 走
`sendGroup(958146070, "测试")`，抓到的真实 op2 请求体：

```
0a08 1206 0896ccf0c803 1202 0801   1a0e 0a0c 120a 0a08 0a06 e6b58be8af95   28 a7d9ad8402
     └── field1 varint = 958146070 ──┘                                      └─ field5 random ─┘
                                                          └─ UTF-8「测试」─┘
```

群号、文本、`random` 全部正确。这条路径是：
`HaizakuraRuntime` → `Bridge` → `message.sendGroup` → op2 编码器 → `PacketClient`。

### 两个由此发现的真实缺陷（已修）

1. **`SelfProfile` 是 13 字段的完整记录**，不是 `{uin, uid, nickname}` 三元组。
   少写字段会 type-check 成 `any`，然后在 `get_login_info` / profile 动作里
   悄悄返回 null。
2. **`stop()` 原本只 detach `this.hook`**，但调用方可能用
   `getBridge().bindPid(...)` 直接绑定。那样的 PID 在 `stop()` 后仍被绑定，
   于是「已停止」的 runtime 会继续往死进程发包 —— 正是本项目一直在对抗的
   静默失败。已新增 `bindSender(pid, client)`，`stop()` 会 detach **所有**
   已绑定的 PID。

### 诚实边界

`PacketClient` 是记录型测试替身，**没有真实 QQ 接收**。测试断言的恰恰是
「没有回执时必须诚实失败」（`/no response/`），而不是伪造一个 `message_id`。

## 为什么不用一个百分比

「完成了 80%」这种说法会掩盖：**任何一段断了，整条链路就跑不通**。
诚实的说法是：

- **TS 侧（第 5–11 段）**：除第 9 段外全部打通，且有真实字节测试保护。
- **C++ 侧（第 1–4 段）**：**全部完成**。第 4 段（安装）已于 2026-11-22 16:50
  在真实 QQ 上实拍打通（`which == 41`，13 次调用、0 次拒绝、op6 帧到达 recv.sock）。
- **端到端（QQ → 事件）**：C++ 段已通，TS 段除第 9 段外已通。
- **端到端（请求 → QQ）**：第 9 段（ActionContext 宿主）与第 12 段（op2 真实投递）
  仍缺，未跑通。

## 下一步（按依赖顺序）

1. ~~**C++ 接收槽安装**~~ ✅ **已完成**（`hz_recv_response_observer` / `which == 41`）。
   接线前的只读实拍已做：短格式 byte0=`0x14`（len 10）、长格式
   `{cap=0x31, size=0x21, ptr=…}`，确认长串指针在 **+16**、SSO 边界 **22**。
2. **ActionContext 宿主**（已派子代理）。
3. 两者都通后，才能声称「端到端」。