# 实测：hook 装上了，QQ 登录了，observer 一次都没被调用

## 最终实验（可复现，已排除所有已知干扰）

容器 `hz-scan`，`supervisorctl stop snowluma` 阻止闭源实现重新注入。

| 时刻 | 事件 |
|---|---|
| — | `supervisorctl restart qq`，得到全新进程 |
| +8s | 注入载荷；诊断文件记录**两个 hook 都装上了** |
| +8s | `op 7 status=0` → **未登录**（确认 hook 早于登录） |
| +125s | 期间轮询 12 次，`loggedIn` 始终 false（QQ 停在登录界面等点击） |
| +130s | 用 XTest 点击"登 录" |
| +133s | QQ 登录成功（聊天列表出现） |
| +133s 起 | `/tmp/hz-observer.log` **不存在**（observer 零次调用） |

### hook 状态（登录之后复核）

```
base 0xe8cfe6f70000
slot36: 0xea1a90bf3018  orig 0xe8cfe82eceb8  HOOKED True   ← MSFService 发包槽
slot11: 0xea1a909eb018  orig 0xe8cfe8293a20  HOOKED True   ← QRCode 登录回调槽
```

两个槽都指向载荷映射区（`0xea1a...`），原始值都对得上。

### 载荷本身健康

- `op 1` hello 正常、`op 7` 如实报告未登录、`op 2` 返回我们自己的拒绝文案；
- 85+ 线程存活，socket 在 `srwxr-xr-x`（我们的权限）；
- 载荷线程独立于注入器存活已多次确认。

**所以：机制全部正常，唯独 observer 没有被 QQ 调用过。**

## 排查过程中修掉的两个真实缺陷

这两个都是**只有做真实实验才会暴露**的，而且都直接导致"看起来 hook 没装上"。

### 1. 诊断写到 QQ 的 stdout，注入器永远看不到

载荷运行在 **QQ 进程**里，`fd 1` 是 QQ 的 stdout（客户端日志或 `/dev/null`），
**不是**注入器的终端。所以 `printf` 全部成功、但去向是 QQ 那边，注入器这边一片空白。

我先用 `write(2)` 以为能绕过缓冲 —— 同样无效，因为 `fd 2` 也是 QQ 的。
最终改成**写文件**（`/tmp/hz-payload.log`、`/tmp/hz-observer.log`）。

这个失败模式特别误导：**载荷装得好好的，日志却像什么都没发生**，
我因此有一段时间误判为"relay 安装失败"。

### 2. `str.replace` 静默未匹配，日志文案没被替换

我用 Python 批量把 `std::printf(...)` 换成 `note(...)`，缩进不一致导致替换**没匹配上**，
而 Python 的 `str.replace` 不报错。结果二进制里仍是旧文案，我以为新诊断代码没执行。

教训：批量改代码后必须 `strings` 核对产物，不能只看源码。

## 为什么 hook 装了却没人调用

两个候选槽都装了，但都没触发。可能的原因（**尚未区分**）：

1. **槽 36 不是唯一的发包入口**。文档记为"发包槽 #1"，槽 37 是"#2（无响应版）"，
   而 `SendSSORequestInternal` 包装 A/B 在槽 35 附近 —— 登录可能从别的槽出去。
2. **登录流程走的是另一个 `MSFService` 实例**。vtable 只给类型不给对象；
   我们改的是**静态 vtable**，如果 QQ 用的是另一份拷贝，改了也没用。
3. **回调走的是非虚函数直调**。`selfInfoOnLoginSuccess` 无 `bl` 调用者这一条，
   只证明了"静态代码里没有直接调用"，不排除运行期 JIT 或别的间接方式。

我倾向于 **2**：闭源实现（`docs/reverse-hook-mechanism.md`）记的是
`ctx+0x70` 存槽号、运行期**先定位活实例**再写 —— 它写的是实例的 vtable 指针所指的表，
而不是静态表。我们写静态表，如果实例用的是别的表，写入就落空了。

## 诚实结论

- **hook 机制**：已完全验证（定位、原子写入、relay、载荷存活、双槽同时安装）。
- **hook 生效**：**从未成功过一次**。QQ 登录了，两个槽都是我们的 relay，observer 零调用。
- 因此 `hz_hook_login_uin()` 返回 0、`op 7` 恒报 `loggedIn:false` 是**已知未完成项**，
  不是"设计如此"。

下一步应当先验证假设 2：读取 `MSFService` **活实例**的 vtable 指针，确认它是否
等于 `base+0x87173e8`。若不等，则必须 hook 实例表而非静态表 —— 这也解释了
闭源实现为什么要先拿实例。

---

## 追加验证：实例确实用静态表，槽确实被改写，仍然零调用

按"可能原因 2（实例用另一份表）"去查，结论是**该假设不成立**：

```
持有静态主表指针的位置: 0x4401c94b40, 0xe8cfd39dd660, 0xe8cfd3a0f958
```

进程里有 **2 个活实例**（heap 上），二者 offset 0 都等于静态主表运行时地址
`0xe8cfef6873e8`：

```
实例 A 0xe8cfd39dd660:  +0 = 0xe8cfef6873e8  <== 静态主表
实例 B 0xe8cfd3a0f958:  +0 = 0xe8cfef6873e8  <== 静态主表
```

而那张表的槽 36 已经是我们的 relay：

```
静态主表 slot36 = 0xea1a90bf3018  == relay  ✓
```

实例 B 里还能读到我们的 hook 上下文（槽号 36、原函数、relay 三件套）：

```
+8:  0x24            = 36
+16: 0xe8cfe82eceb8  = 原始 slot36
+24: 0xea1a90bf3018  = relay
```

**结论：链路完全通，唯一解释是 QQ 这次登录没有走这两个槽。**

## 这意味着什么

我们证明了 hook **基础设施**完全可用：定位、写入、实例共用静态表、relay 被正确登记。
但它**没有观察到一次登录**，因为选址不对 —— 至少对"已保存账号的快速登录"这条路径不对。

闭源实现之所以能工作，除了选址（`MSFService` 发包槽），还很可能**同时 hook 了多个槽**
（`docs/vtable-slots.md` 里槽 35/36/37 都是发包相关），覆盖不同出口。
我们只挂 2 个，恰好都是本次登录不经过的。

## 下一步（按优先级）

1. **多槽覆盖**：把 `MSFService` 槽 35/36/37 全部挂上（都是发包路径），
   再挂 `SendSSORequestInternal`（`0x137bd6c`）相关槽。
2. **挂 `nt::login::LoginService` / `BaseLoginMgr`** 这类登录主干，
   而不是 QR 分支末端。
3. **验证方式先做好**：在 relay 里加"被调用即计数并落盘"，这样能区分
   "槽没被调用"和"observer 逻辑出错"—— 本次排查最大的时间损失就来自分不清这两者。

## 一句话结论

**hook 能装、装得对、实例也认得；但它挂的位置 QQ 登录时不经过，
所以"能上报真实登录"这件事，到这个时间点为止一次都没成功过。**

---

## 决定性测量：hits 计数器

加了入口计数器（aarch64 `ldr/add/str` 于 state+32，x86 `incq 32(%r11)`），
由载荷内一个心跳线程每秒写 `/tmp/hz-hits.log`。

实验（全新 QQ，登录前注入，hook 双槽装好）：

```
hook 安装:
  trunk hook on nt::MSFService slot 36 vtable=0xf2cc0cf073e8 original=0xf2cc05b6ceb8
  qr hook on nt::login::QRCodeLoginRequestImpl slot 11 vtable=0xf2cc0cf04228

未登录时:      hits 0 0
点击"登录"后:  hits 0 0   （每 2 秒采样 10 次，全部 0）
最终:          hits 0 0
心跳确认:      first='hits 0 0'  second='hits 0 0'   ← 文件在更新，线程活着
hook 复核:     slot36=0xf2ccb1472020 orig=0xf2cc05b6ceb8 HOOKED=True
QQ 界面:       聊天列表已出现（登录成功）
```

**`hits 0 0` 是硬证据：QQ 从头到尾没有调用过槽 36 或槽 11。**
这不再是推断 —— 计数器就写在 relay 入口第一条指令里。

同时这也解释了为什么 `op 7` 一直报 `loggedIn:false`：不是载荷撒谎，是它**确实没收到信号**。

## 修正后的结论

| 事项 | 状态 |
|---|---|
| hook 定位（RTTI → vtable → slot） | ✅ 已验证，偏移精确 |
| 原子写入 / RELRO / 对齐校验 | ✅ 已验证 |
| relay 安装与跳转 | ✅ 已验证（hits 机制本身依赖它工作） |
| 实例共用静态表 | ✅ 已验证（2 个 heap 实例都指向改写后的表） |
| **QQ 登录时调用这些槽** | ❌ **实测从未发生（hits = 0）** |
| 能上报真实 uin | ❌ 从未成功 |

**hook 基础设施可用；选址不可用。**

下一步必须先解决"哪个槽在登录时真的被调用"，而不是继续加 hook。
最省事的办法：把 `nt::login` 下那 42 个类的主表**各挂 2~3 个槽**批量试，
用 hits 计数器筛出哪个非零 —— 这一次实验就能定位，不用再猜。

---

## 第五个目标，仍然是零：导出 `notifyLoginSuccess`

### 为什么转向导出函数

vtable 路径失败后查了 wrapper.node 的导出表，**385 个导出符号**，其中
`MSF::MSFSDK` 一族共 **75 个方法**，包含：

```
_ZN3MSF6MSFSDK18notifyLoginSuccessERK...  @ 0x412bac8
```

关键佐证：这个符号在整个 144MB 二进制里**只出现在 `.dynsym`**（出现次数 = 1），
没有任何 `bl` 调用者 —— 它纯粹是给外部（QQ 的 JS / 主程序）解析调用的。
这解释了为什么 vtable 扫描无论扫多少槽都是 0：登录事件根本不走内部虚分派。

### 实现

函数入口比 vtable 槽难挂：没有表可以写，只能改写函数自己的前几条指令。

```
ldr x16, #8    ; 0x58000050
br  x16        ; 0xD61F0200
.quad relay
```

16 字节，因为 `b/bl` 只有 ±128MB 而 wrapper.node 是 144MB，够不着。
x16 是 AArch64 ABI 专门留给链接器 veneer 的 IP0，函数不能依赖它传值。

relay 尾部跳到**重放桩**而不是函数本身：桩执行被覆盖的 4 条指令，再跳到
`target+16`。第一版漏了这个桩，于是 relay 尾跳回 `target`，而 `target` 第一条
指令就是 `br relay` —— 无限循环，QQ 几秒内就崩。症状先是"注入后 QQ 开始反复重启"，
不做对照（不注入也能稳跑 52 秒）根本分不清是容器不稳还是我的代码。

### 两个真实崩溃原因

**① 漏了重放桩**（上面说的死循环）。

**② 覆盖了太短的函数**。批量 hook `MSFSDK` 家族时，`currentConnSeq`、
`isConnected` 这类 getter 只有 8 字节，补丁固定写 16 字节，
**把下一个函数的开头覆盖了** —— 崩溃点与 hook 毫无关系的代码里。
加了 `sym.size < 16` 就跳过之后，单挂 `notifyLoginSuccess` 不再崩溃，
QQ 在 hook 生效后持续存活。

### 结果

```
export: notifyLoginSuccess at 0xf59d9b70bac8 (offset 0x412bac8)
export hook installed on notifyLoginSuccess, relay=0xf6e8478d9020
QQ 存活: 是          ← 不崩了
```

然后点击登录，QQ 成功登录（聊天列表出现），而

```
hits 0 0 0        ← 第五个目标，仍然零调用
```

## 现在的清单

| 目标 | 装上了 | 登录时被调用 |
|---|---|---|
| `nt::login::QRCodeLoginRequestImpl` slot 11 | ✅ | ❌ hits 0 |
| `nt::MSFService` slot 36（发包槽 #1） | ✅ | ❌ hits 0 |
| `nt::login` 家族 62 个槽（扫描） | ✅ | ❌ 全 0 |
| 导出 `MSF::MSFSDK::notifyLoginSuccess` | ✅ | ❌ hits 0 |

四次独立实验、四个不同层次的观测点，全部零调用。这不是"机制还没修好"，
而是**这四处都不是登录发生时走的路径**。

## 为什么这次不敢再猜

前四次的共同错误是：先假定某个函数是登录入口，装上去看它有没有被调用。
每一次都能装成功、每一次都是 0，然后我再找下一个候选。

继续这样下去只是在猜。真正需要的是一次**不看名字**的观测：
把 wrapper.node 的 `.text` 段整体做入口计数，看登录那一刻**哪些偏移被进入**，
再回头查那些偏移属于谁。这需要按页批量打桩，工作量比现在大一个量级，
但它是唯一不依赖"我认为登录会走这里"的方法。

在此之前，`op 7` 恒报 `loggedIn:false` 是**已知未完成项**，不是设计。

---

## 最终处置：不再 hook，改读磁盘（2026-11-20）

五次尝试全部零调用之后，发现 QQ 把账号明文写在目录名里、并在登录时重写
`auth/login.enc`。改用文件信号判定登录态，实测 `op 7` 能正确报出
`uin=3XXXXXXXXX`，两轮完整周期可复现。

详细判据、三个假阳性陷阱、以及为什么这不算"hook 成功"，
见 `docs/login-state-from-disk.md`。

一句话：**hook 机制验证通过但选址始终没找对；产品目标换路径达成。**
