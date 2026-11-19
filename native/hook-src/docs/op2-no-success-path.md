# op 2（请求）在闭源载荷里没有成功路径

## 结论

逆向 425 KB 载荷，op 2 的处理分支（`0x11850`–`0x11c69`）**只有一个出口**：

1. `0x11850` 把 `flags@16` 存到 `[rsp+0xfc]`
2. `0x1185e` 构造一个 42 字节的 `std::string`，内容来自 `0x578e5`/`0x578f5`/`0x578ff` 三段拼接
3. `0x11939` 起构造回复
4. `0x11c57` `mov esi,0x3` → **op = 3（ACK）**，`flags` 回填、`requestId` 回填

那 42 字节的字符串是：

```
Linux runtime targets are not resolved yet
```

**没有找到任何「运行时目标已解析成功」的分支。** 也就是说，这个载荷收到 op 2 时，
无论请求什么，都回一个 ACK 加这条固定消息。

## 这意味着什么

**载荷自己不执行 QQ 的发送操作。**

真正发消息的实现必须在别处。已知的候选：

| 候选 | 证据 |
|---|---|
| 嵌入式 helper 模块 | `.rodata` 尾部 0x3960 字节加密 ELF，`dlopen` 后取 0x38 字节函数表（7 个指针）。**内部实现未解** |
| Node 侧 | 闭源 addon 只导出 5 个函数，都不发消息 |

按现有证据，**helper 模块最可能**：它是唯一能提供可执行代码、且被 hook 用作「新值」来源的组件。
`0x16a6b` 处 `call [helper+8](0, [ctx+0x180], matcher)` 正是从 helper 取函数指针填进 vtable 槽。

## 对我们实现的影响

我们当前的 op 2 处理（`test/payload.cc:432`）：

```cpp
if (h.op == kOpRequest) {
  // ACK first, then reply
  const FrameHeader ack = make_header(kOpAck, h.request_id, 0, 0, 0, 0, 0, 0);
  send_frame(fd, ack, ...);
  const FrameHeader done = make_header(kOpReply, h.request_id, 0, 0, 0, 0, 0, 0);
  send_frame(fd, done, ...);
  continue;
}
```

**行为等价**：都是回 ACK 而不执行请求。差别只是闭源版把错误消息放在 msg 里，
我们用空的 reply。

### 建议

不要假装能处理 op 2。要么：

1. **回和闭源一模一样的固定消息** —— 这样 Node 侧的报错文案与真实产品一致，
   用户看到的是设计好的提示而不是空白；
2. **或者保持空 reply**，但明确记录「本版本不解构 op 2」。

倾向方案 1：Node 侧如果有针对这条消息的特殊处理（比如提示用户升级），
发个空 reply 会走到另一条分支，可能触发不友好的错误。

## 未确定（不要当已知）

- helper 模块内部实现完全未解（密文未展开）
- 因此**不知道**真正的发送路径是否在 helper 里
- op 2 是否在**其它构型**（不同 QQ 版本 / Windows 版）下有成功路径，未知

## 复验

`re/dec5.py` 能解出那三段字符串（已包含在 7 条断言里），确认第 2 步的拼接内容。
