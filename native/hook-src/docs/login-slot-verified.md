# 登录槽位：在真实 wrapper.node 上验证

## 结论

载荷的接线（`src/payload_hook.cc`）依赖三个运行时事实，全部在**真实的 144 MB
arm64 wrapper.node** 上验证过，不是对着测试替身猜的：

| 事实 | 验证结果 |
|---|---|
| 按 RTTI 类名能找到登录类 | `QRCodeLoginRequestImpl` → **3 个 vtable** |
| 主 vtable 存在且足够长 | primary `0x8714228`，**24 槽**（≥ 12） |
| 槽位 11 是登录回调 | `0x1323a20`，**与逆向出的 `selfInfoOnLoginSuccess` 地址完全一致** |

`0x1323a20` 处首字节 `fd 7b ba a9` = `stp x29, x30, [sp, #-0x60]!`，
aarch64 标准函数序言，确认是真实代码而非数据。

工具：`/tmp/findcls`、`/tmp/slot11`（源码思路见下），跑在
`/home/ubuntu/hzwork/wrapper-arm64.node` 上，13261 个 vtable 全部解析成功。

## 为什么槽位号能当稳定句柄

`selfInfoOnLoginSuccess` 在整个 wrapper.node 里**没有任何 `bl` 调用者** —— 它只通过
vtable 被调。这就是为什么：

- **按调用图找**（`find_slots_calling`）→ 失败，零个调用者；
- **按类名 + 槽位找** → 成功。

类名是跨版本稳定的：mangled name 存在 `.rodata` 里，RTTI 和异常表都引用它，
relink 不会改。槽位号理论上可能变（换 ABI、增删虚函数），所以安装时
**必须校验槽位当前值非空**（`read_vtable_slot_live`），不能盲写。

## 三个 vtable 怎么选

同一类有 3 个：

| 地址 | 槽数 |
|---|---|
| `0x8714228` | 24 |
| `0x87142f8` | 6 |
| `0x8714338` | 11 |

后两个是基类子对象的 vtable（槽数少，容纳不下槽位 11）。
`primary_vtable()` 选**槽位最多的那个**，这是正确判据：主 vtable 包含派生类的全部
虚函数，基类子对象的只包含它自己那部分。

注意：`0x8714338` 有 11 槽，索引 0..10，**没有**槽位 11。如果选错这个，
安装会以「vtable too short」失败 —— 这正是 `payload_hook.cc` 里
`slots <= kLoginSlot` 那道检查在防的事。

## 载荷侧的降级路径（已验证）

对着 `fake-wrapper.node`（测试替身，没有任何 C++ 类）注入时，输出：

```
[payload] hook: wrapper.node at 0x7ddb2410f000 (/tmp/fake-wrapper.node)
[payload] hook: 0 vtables in wrapper.node, looking for nt::login::QRCodeLoginRequestImpl
[payload] hook: no vtables found in wrapper.node
[payload] login hook unavailable (-4): no vtables found in wrapper.node
[payload] start_dynamic returning, listener thread=138380056676032
[payload] listener thread up, socket /run/user/1000/mojo.3121898.control.sock
```

**载荷照常启动、照常服务协议**，只是没有登录信号。这是设计意图：
QQ 换版导致类名变了，应该丢掉登录信号，而不是丢掉整个 hook。

## 尚未解决

`uin` 仍然读不出来（`hz_hook_login_uin()` 返回 0）。

`SetDefaultUin` 是槽位 22（`+0xb0`）接收 uin 作为参数，是最直接的来源，
但调用约定和对象布局要先在真实客户端上确认。在此之前观察者上报
「已登录、号码未知」，而不是编一个数 —— 编出来的 uin 是 socket 另一端
唯一无法察觉的错误。
