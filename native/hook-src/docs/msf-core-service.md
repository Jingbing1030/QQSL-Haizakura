# `nt::MSFCoreService` —— vtable 定位与 RTTI 编码校准

> 目标：QQ 3.2.32 aarch64，`/opt/QQ/resources/app/wrapper.node`，**144,561,472 字节**
> 本机副本：`/home/ubuntu/hzwork/wrapper-arm64.node`
> **已核对与目标逐字节相同**（【实测】）：
> ```
> 容器 /opt/QQ/resources/app/wrapper.node
>    c302361f52494de257044e912e43ed244bb29ee59f59345d25a8959327828337
> 本机 /home/ubuntu/hzwork/wrapper-arm64.node
>    c302361f52494de257044e912e43ed244bb29ee59f59345d25a8959327828337   ✔ 一致
> ```
> （另：`/home/ubuntu/wrapper-arm64.node` 是**另一份 7,050,240 B 的截断文件**，哈希不同，
> 别拿它做分析。）
> 分析方式：纯 Python 解析 ELF 程序头 + **解析并应用 `.rela.dyn`**，零第三方依赖
> 结论一句话：**RTTI 名字符串用的是普通的 8 字节绝对指针，不是任何相对编码。
> 之前扫不到，是因为用的偏移 `0x67818e7` 是错的 —— 真实串首在 `0x67818e1`。**

---

## 0. 结论摘要

| 项 | 值 |
|---|---|
| **`nt::MSFCoreService` 主 vtable（vaddr）** | **`0x8718f60`** |
| 主 vtable（文件偏移） | `0x8708f60` （`vaddr - 0x10000`） |
| **槽数** | **52** |
| offset-to-top | `0` |
| typeinfo（vaddr / 文件偏移） | `0x87193f8` / `0x87093f8` |
| RTTI 名 | `N2nt14MSFCoreServiceE` @ `0x67818e1`（`.rodata`，`vaddr == file off`） |
| 捕获槽 | vtable `[-1]` = typeinfo，**普通 8 字节绝对指针** |
| 基类数 | 3（`__vmi_class_type_info`） |
| 真函数槽 / 空 `ret` 桩 | 49 / 3（槽 26、48、49） |

**同一类共 6 张表**（与 `docs/vtable-slots.md` §0.2 完全一致，本次独立复现）：

| vtable | 槽数 | offset-to-top | 对象内偏移 | 角色 |
|---|---:|---:|---:|---|
| `0x8718f60` | **52** | `0` | `+0x00` | **主对象（primary）** |
| `0x8719110` | 61 | `-0x08` | `+0x08` | 虚基类视图（57 个 `ret` 桩） |
| `0x8719308` | 9 | `-0x10` | `+0x10` | **发送接口视图** |
| `0x8719360` | 1 | `-0x18` | `+0x18` | `OnConnectivityChanged` |
| `0x8719378` | 4 | `-0x20` | `+0x20` | 次子对象 |
| `0x87193a8` | 10 | `-0x40` | `+0x40` | 回调子对象 |

---

## 1. 先钉死一个前提：文件偏移 ≠ 加载地址

这份二进制有**两个** `PT_LOAD`。第一段 `off == vaddr`（差 0），
第二段差 **`0x10000`**：

```
LOAD0  off=0x00000000  vaddr=0x00000000  filesz=0x086992f8   delta=0x0
LOAD1  off=0x0869c2c0  vaddr=0x086ac2c0  filesz=0x003408a0   delta=0x10000
```

`.data.rel.ro` 在 **LOAD1** 里（`vaddr 0x86acb60..`），所以：

| 名字 | vaddr | file off |
|---|---|---|
| `nt::MSFService` vtable | `0x87173e8` | `0x87073e8` |
| `nt::MSFCoreService` vtable | `0x8718f60` | `0x8708f60` |
| `nt::MSFCoreService` typeinfo | `0x87193f8` | `0x87093f8` |
| RTTI 名字串（`.rodata`，LOAD0） | `0x67818e1` | `0x67818e1`（delta 0） |

> ⚠️ **这一条已经害过人一次。** `docs/vtable-slots.md` 末尾记着：
> 「文件偏移 `0x8704280` 处确实是 `0x1323a20`，但 `at()` 读出来是 `0`」——
> 那不是 bug，是把它当 vaddr 用了。**`.data.rel.ro` 里必须换算。**
> 本文所有地址**默认是 vaddr**，凡用文件偏移处会显式标注。

---

## 2. ★ 校准：typeinfo 名字指针到底怎么编码

**指令：先拿一张已知正确的表校准，再推广。以下是校准全过程。**

### 2.1 已知正确的表：`nt::MSFService` @ `0x87173e8`

Itanium ABI 里 vtable 的布局是：

```
vtable[-2]  offset-to-top
vtable[-1]  typeinfo pointer      <-- 就是它
vtable[ 0]  第一个虚函数
```

读这张表的前两字（**已应用 `.rela.dyn`**，见 §2.4）：

```
0x87173d8  (= [-2], offset-to-top)  -> 0x0
0x87173e0  (= [-1], typeinfo)       -> 0x87177e0
```

追到 `0x87177e0`，它的 4 个字是：

```
0x87177e0  +0x00  0x000000000871e698      ; type_info 类的 vptr
0x87177e8  +0x08  0x000000000677ecaa      ; <-- name 指针
0x87177f0  +0x10  0x0000000200000000      ; flags=0 | base_count=2
0x87177f8  +0x18  0x0000000008717ff0      ; base[0] typeinfo
```

**name 指针 = `0x677ecaa`，读出来的字符串就是：**

```
0x677ecaa  'N2nt10MSFServiceE'          <-- 与类名 nt::MSFService 完全对应 ✔
```

### 2.2 结论：**就是普通 8 字节绝对绝对地址**

- `name` 字段的值 **就是** 字符串的链接地址（vaddr）。
- **没有** GOT 中转、**没有** RVA/段相对、**没有** 加常数偏移、**没有** "nonzero delta"。
- 一个容易误判的现象：对整个文件做绝对 8 字节扫描时，这个值会命中 **2 处** ——
  一处是真正的 `typeinfo+8`，另一处落在 **`.rela.dyn`** 里（那是重定位记录体的
  `r_addend` 字段，不是数据引用）。判据见 §7.2。

### 2.3 把同一套规则套到 `MSFCoreService`

```
0x8718f58  (= [-1], typeinfo, 已应用重定位) -> 0x87193f8
```

```
0x87193f8  +0x00  0x000000000871e698      ; 与 MSFService 的 type_info vptr 相同
0x8719400  +0x08  0x00000000067818e1      ; <-- name 指针
0x8719408  +0x10  0x0000000300000000      ; flags=0 | base_count=3
0x8719410  +0x18  0x0000000008717ff0      ; base[0]
```

```
0x67818e1  'N2nt14MSFCoreServiceE'      <-- 命中 ✔
```

**编码与校准结果 100% 一致：普通的绝对 8 字节指针。**

### 2.4 ⚠️ 唯一的技术陷阱：重定位没应用

`.rela.dyn` 里 `R_AARCH64_RELATIVE` 有 **346,539 条**。`0x8718f58` 这一格在
**文件原始字节**里读出来是 `0x87193f8`（因为 `addend == 目标`，纯属巧合地相等）。
但 `0x87173e0` 也一样恰好相等。**这两次是运气，不是规律**：
别的地方 addend 常常是 `0`（指向别处），或者指针在 `.bss`/未初始化区根本没字节。

**正确做法**：建一个 `site -> addend` 的字典，查表优先，缺了才落回原始字节：

```python
def q(self, vaddr):
    if vaddr in self.rel:        # R_AARCH64_RELATIVE 优先
        return self.rel[vaddr]
    return raw_uint64_at(vaddr)
```

**用了这一步之后，绝对指针扫描立刻能用了** —— 见 §4。

---

## 3. 证据一：结构化扫描（vtable[-1] → typeinfo → name）

扫描口径（严格按 Itanium ABI）：

1. 在 `.data.rel.ro` / `.data` 里找**连续 ≥2 个 8 字节字，且每个字都落在 `.text` 内**；
2. 取该串**前一个 8 字节字**（即 `[-1]`）当 typeinfo 候选；
3. 读 `typeinfo+8` 当 name 候选，要求落在 `.rodata` 且以 `N`（mangled）开头；
4. 匹配 `N2nt14MSFCoreServiceE`。

**更稳的实现方式**（本次实际采用，比逐字扫描快得多）：直接遍历
`.rela.dyn` 的 addend 反向索引 —— 所有「某处指向 typeinfo」的站点天然就是
`R_AARCH64_RELATIVE` 记录。（总重定位 353,830 条：`R_AARCH64_RELATIVE` **346,539** +
其它 **7,291**。）**一次性建反查字典，秒级扫完、不占额外内存。**

对 `nt::MSFCoreService` typeinfo `0x87193f8`，反查得到 **6 个站点**，全部是 vtable：

```
$ python3 scan.py
=== every site whose R_AARCH64_RELATIVE addend is a given typeinfo ===

nt::MSFCoreService  typeinfo=0x87193f8  referenced by 6 sites
   vtable=0x8718f60  slots=52  offset-to-top=0    first=0x13abb00 last=0x13a46c4
   vtable=0x8719110  slots=61  offset-to-top=-8   first=0x13abd88 last=0x99a3dc
   vtable=0x8719308  slots=9   offset-to-top=-16  first=0x13abdb8 last=0x13a3ac8
   vtable=0x8719360  slots=1   offset-to-top=-24  first=0x13a48a0 last=0x13a48a0
   vtable=0x8719378  slots=4   offset-to-top=-32  first=0x13abde8 last=0x139c1b4
   vtable=0x87193a8  slots=10  offset-to-top=-64  first=0x13abe18 last=0x13a46bc
```

**对照组（同样方法跑 `nt::MSFService`）得到 5 张表，与已有的
`docs/vtable-slots.md` §1/§3 的数字逐项吻合** —— 这是方法正确性的交叉验证：

```
nt::MSFService  typeinfo=0x87177e0  referenced by 5 sites
   vtable=0x87173e8  slots=44  offset-to-top=0    first=0x138f56c last=0x137b194
   vtable=0x8717558  slots=61  offset-to-top=-8   first=0x138f808 last=0x99a3dc
   vtable=0x8717750  slots=9   offset-to-top=-16  first=0x138f838 last=0x1383efc
   vtable=0x87177a8  slots=1   offset-to-top=-24  first=0x137b238 last=0x137b238
   vtable=0x87177c0  slots=4   offset-to-top=-32  first=0x138f868 last=0x1378610
```

（`MSFService` 44 槽 = `MEMORY.md` §2.3i 里 hook 的那张，地址 `0x87173e8` 一字不差。
说明两个类在这份二进制里**共用同一个 type_info vptr `0x871e698`**、布局完全同构。）

### 3.1 主 vtable `0x8718f60` 的十六进制证据

```
                       raw bytes in file            applied reloc
0x8718f58  (= [-1])    f8 93 71 08 00 00 00 00  -> 0x87193f8     <-- typeinfo
0x8718f60  (= [ 0])    00 bb 3a 01 00 00 00 00  -> 0x13abb00     <-- 构造/析构
0x8718f68  (= [ 1])    64 bd 3a 01 00 00 00 00  -> 0x13abd64     <-- deleting dtor
0x8718f70  (= [ 2])    64 c2 39 01 00 00 00 00  -> 0x139c264
0x8718f78  (= [ 3])    6c c2 39 01 00 00 00 00  -> 0x139c26c
```

槽 34–38（`SendSSORequest` 家族）：

```
0x8719070  slot 34 (+0x110)  -> 0x139ec10
0x8719078  slot 35 (+0x118)  -> 0x139f488
0x8719080  slot 36 (+0x120)  -> 0x139f69c      <-- SendSSORequest
0x8719088  slot 37 (+0x128)  -> 0x139fb08      <-- SendSSORequestNoResponse
0x8719090  slot 38 (+0x130)  -> 0x13a03c0      <-- SendMsfRequest
```

### 3.2 边界自证：为什么正好是 52 槽

```
0x87190f8  slot 51 (+0x198)  -> 0x13a46c4     <-- 最后一个（OnConnectivityChanged）
0x8719100  = 0xfffffffffffffff8               <-- 下一张表的 offset-to-top (-8)
0x8719108  = 0x87193f8                        <-- 下一张表的 typeinfo
0x8719110  = 0x13abd88                        <-- 下一张表的 slot 0
```

**槽 52 那个位置不是函数指针，是下一张表的 `offset-to-top`。**
所以 52 是硬边界，不是"扫到不连续为止"的经验值。

### 3.3 完整 52 槽清单

| 槽 | 偏移 | 函数 | 备注 |
|---:|---:|---|---|
| 0 | `+0x00` | `0x13abb00` | 构造 + 析构 |
| 1 | `+0x08` | `0x13abd64` | deleting destructor |
| 2 | `+0x10` | `0x139c264` | |
| 3 | `+0x18` | `0x139c26c` | |
| 4 | `+0x20` | `0x139c274` | |
| 5 | `+0x28` | `0x139c2c4` | |
| 6 | `+0x30` | `0x13a1fec` | `getNetworkProxy` |
| 7 | `+0x38` | `0x13a2754` | |
| 8 | `+0x40` | `0x13a2248` | `setNetworkProxy` |
| 9 | `+0x48` | `0x13a260c` | |
| 10 | `+0x50` | `0x13a29f8` | |
| 11 | `+0x58` | `0x13a2bec` | `sendMsfRequest`（应用层） |
| 12 | `+0x60` | `0x13a33d0` | `onMsfPushForTesting` |
| 13 | `+0x68` | `0x139c1bc` | |
| 14 | `+0x70` | `0x139c204` | `disconnect()` |
| 15 | `+0x78` | `0x139c2f0` | `ResetSessionId` |
| 16 | `+0x80` | `0x139c454` | |
| 17 | `+0x88` | `0x139c93c` | **`MSFCoreService::Initialize`** ★见 §4 |
| 18 | `+0x90` | `0x139d864` | **`MSFCoreService::SessionInit`** ★见 §4 |
| 19 | `+0x98` | `0x139e8e4` | `Connect` |
| 20 | `+0xa0` | `0x139eaa4` | `Disconnect(reason)` |
| 21 | `+0xa8` | `0x139eaf0` | |
| 22 | `+0xb0` | `0x139eaf8` | `SetDefaultUin` |
| 23 | `+0xb8` | `0x139eb80` | `SetSSOErrorCallback` |
| 24 | `+0xc0` | `0x13a0c0c` | `SendOidbReqInternal` A |
| 25 | `+0xc8` | `0x13a1508` | `SendOidbReqInternal` B |
| 26 | `+0xd0` | `0x13a1fe8` | **`ret` 空桩** |
| 27 | `+0xd8` | `0x13a3460` | `GetClientAddress` |
| 28 | `+0xe0` | `0x13a35e4` | |
| 29 | `+0xe8` | `0x13a3600` | |
| 30 | `+0xf0` | `0x13a3668` | `UpdateSignaureInfo` |
| 31 | `+0xf8` | `0x13a584c` | accessor `this+0x2e8` |
| 32 | `+0x100` | `0x139be48` | 日志小函数 |
| 33 | `+0x108` | `0x139be98` | `Destroy` |
| 34 | `+0x110` | `0x139ec10` | `SendSSORequest` 包装 A |
| 35 | `+0x118` | `0x139f488` | `SendSSORequest` 包装 B |
| **36** | **`+0x120`** | **`0x139f69c`** | **`SendSSORequest`（"SendSSORequest cmd={} req_size={}"）** |
| **37** | **`+0x128`** | **`0x139fb08`** | **`SendSSORequestNoResponse`** |
| **38** | **`+0x130`** | **`0x13a03c0`** | **`SendMsfRequest`（"SendMsfRequest seq={} cmd={} req_size={}"）** |
| 39 | `+0x138` | `0x13a0894` | `RegisterMSFPush` |
| 40 | `+0x140` | `0x13a1b7c` | `onKickedOffLine` |
| 41 | `+0x148` | `0x13a1d98` | `onUserOnlineStatusChanged` |
| 42 | `+0x150` | `0x13a3ac0` | |
| 43 | `+0x158` | `0x13a3ad0` | `onMSFError` |
| 44 | `+0x160` | `0x13a3c7c` | `onSSORetError` |
| 45 | `+0x168` | `0x13a3dd0` | `onMSFServerTimeUpdated` |
| 46 | `+0x170` | `0x13a3e80` | `onMSFPacketState` |
| 47 | `+0x178` | `0x13a4048` | `onMSFNetworkState` |
| 48 | `+0x180` | `0x13a41f0` | **`ret` 空桩** |
| 49 | `+0x188` | `0x13a41f8` | **`ret` 空桩** |
| 50 | `+0x190` | `0x13a4200` | `onSSORetError(uinInfo)` |
| 51 | `+0x198` | `0x13a46c4` | `OnConnectivityChanged` |

**3 个 `ret` 桩（26/48/49），49 个真函数。**

---

## 4. 证据二（独立）：构造器写入

**不依赖 RTTI**，直接看构造器把哪些 vptr 写进了 `this`。
`MSFCoreService` 构造器 = 槽 0 = `0x13abb00`：

```asm
13abb0c:  adrp x8, 0x8718000
13abb10:  add  x8, x8, #0xf60        ; x8 = 0x8718f60  <-- ★ 主 vtable
13abb14:  add  x9, x8, #0x1b0        ; x9 = 0x8719110
13abb18:  add  x10, x8, #0x3a8       ; x10 = 0x8719308
13abb1c:  add  x11, x8, #0x400       ; x11 = 0x8719360
13abb24:  stp  x8, x9, [x0]          ; this+0x00 = 0x8718f60 , this+0x08 = 0x8719110
13abb28:  add  x9, x8, #0x418        ; x9 = 0x8719378
13abb2c:  add  x8, x8, #0x448        ; x8 = 0x87193a8
13abb30:  stp  x10, x11, [x0, #16]   ; this+0x10 = 0x8719308 , this+0x18 = 0x8719360
13abb38:  str  x9, [x19, #32]        ; this+0x20 = 0x8719378
13abb3c:  str  x8, [x19, #64]        ; this+0x40 = 0x87193a8
```

**6 个 vptr，6 张表，偏移 `0x00/0x08/0x10/0x18/0x20/0x40` —— 与 §3 的结构化扫描
一字不差地对上。** 这是一条与 RTTI 完全独立的证据链。

---

## 5. 证据三（独立）：字符串 xref 反查

`MSFCoreService::Initialize` / `SessionInit` 的**可读**串在 `.rodata`：

```
0x6781ea7  'MSFCoreService::Initialize'
0x6781f13  'MSFCoreService::SessionInit'
```

解码 `.text` 里全部 `adrp + add` 对（601,340 对），找引用这两个地址的指令：

```
target 0x6781ea7 -> ['0x139d030']     落在函数 0x139c93c 内
target 0x6781f13 -> ['0x139e0f0']     落在函数 0x139d864 内
```

```asm
13 9d030:  adrp x9, 0x6781000
13 9d034:  add  x9, x9, #0xea7        ; "MSFCoreService::Initialize"
13 9e0f0:  adrp x9, 0x6781000
13 9e0f4:  add  x9, x9, #0xf13        ; "MSFCoreService::SessionInit"
```

而 `0x139c93c` 与 `0x139d864` 在 `0x8718f60` 里正好是**槽 17** 和**槽 18**。
与 `docs/vtable-slots.md` §2 的 `Initialize`/`SessionInit` 定位一致。

**附带发现**：`N2nt14MSFCoreServiceE` 本身（`0x67818e1`）**没有任何 `adrp+add` 引用**
（0 命中）。合理 —— typeinfo 名字只由 **typeinfo 的 name 字段**引用，不会被代码直接取址。
这也说明"代码里找不到该串的引用"不能用来否定一个类存在。

---

## 6. 关于发送：本次分析明确不主张的事

`0x8718f60` 的槽 36/37/38 确实是 `SendSSORequest` / `SendSSORequestNoResponse` /
`SendMsfRequest`（字符串铁证：`SendSSORequest cmd={} req_size={}`、
`msfcore_service.cc`）。**但"MSFCoreService 参与真正的消息发送"这件事，本文没有证明，也不主张。**

必须一起记住的既有实测事实：

- **`nt::MSFService` @ `0x87173e8` 全部 44 槽零命中**（`MEMORY.md` §2.3i，本次独立复现了该表及其 44 槽）。
- `MSFCoreService` 槽 36 的 `BL` 目标里**没有** `0x137cf84`（`sendSsoInternal`）。
  全 `.text` 只有 **4** 个 `BL` 指向它：`0x137cf30`、`0x137db84`、`0x137dc24`、`0x137dca8`，
  全部是 `nt::MSFService` 主表槽 36/37 与其 `-0x10` 子表视图。
  ⇒ **`MSFService` 与 `MSFCoreService` 是两条不同的发送实现，不是同一条。**

所以本文的产出是一个**可执行的下一步**，不是结论：

1. 有了 `0x8718f60` / 52 槽，可以照 §2.3i 的方法**全槽 hook**，触发一次真实发送看命中。
   **Hooking 改的是表项本身**，第 `n` 槽的**槽位地址**（不是函数地址）是：

   ```
   vaddr      0x8718f60 + 8*n
   文件偏移   0x8708f60 + 8*n        （.data.rel.ro，LOAD1 差 0x10000）
   n = 0 .. 51
   ```

   表里存的 52 个**目标函数**全部落在 `.text`（`0x83d780 .. 0x665d690`）内。
   槽 26 / 48 / 49 是裸 `ret`（`0xd65f03c0`），装了也拦不到东西，可跳过。
2. 若仍零命中，**不要把 `MSF` 层当地图继续挖**了 —— 那意味着发送不走 MSF 虚表，
   应转向 `MEMORY.md` §2.3i「修正后的 P0」指的 **trpc/oidb 层**。
3. `0x8719308`（9 槽的发送接口视图）比主表更聚焦：
   槽 4/5/6/7 = 主表 36/37/38/39 的 `-0x10` 调整器版本。

---

## 7. 全部试过并排除的编码（给下一个人省时间）

| # | 编码假设 | 结果 | 数字 |
|---|---|---|---|
| 1 | name 指针 = **绝对 vaddr**（普通 8 字节） | **✔ 成立** | `0x8719400 → 0x67818e1` |
| 2 | 绝对扫描，目标取 `0x67818e7` | ✘ 0 命中 | 该偏移是**串内第 6 字节**，指向 `'MSFCoreServiceE'` |
| 3 | 绝对扫描，目标取 `0x67818e1`（真串首） | **✔ 2 命中** | `0x149288`（`.rela.dyn` 记录体）、`0x8709400`（typeinfo+8） |
| 4 | 重定位 addend 反查 `0x67818e1` | **✔ 1 命中** | `0x8719400` = `0x87193f8+8` |
| 5 | name 指针存成**文件相对偏移** | ✘ 不需要 | 若成立，第 1 条不会命中 |
| 6 | name 指针存成**段相对偏移** | ✘ 不需要 | 同上 |
| 7 | name 指针带**非零 delta**（`name` 在 `+0x10`/`+0x18`） | ✘ 不需要 | `+0x08` 就是 name，`+0x10` 是 flags\|base_count |
| 8 | typeinfo 被 `GOT`/`PLT` 中转 | ✘ 不存在 | `.dynsym` 无 `MSFCoreService` 任何符号（hidden） |
| 9 | vtable 在 `.text` 或 `.rodata` | ✘ 不在 | 在 `.data.rel.ro`（LOAD1） |
| 10 | 逐字扫描 `.data.rel.ro` 找「连续 `.text` 指针」 | △ 可行但慢 | `.data.rel.ro` = 416,949 word，其中 **216,140** 个指向 `.text`；纯 Python 逐字扫会 OOM/超时（实测被 OOM kill 两次）；**改用 reloc 反查索引即秒出** |

### 7.1 为什么 `0x67818e7` 必然 0 命中 —— 根因

```
0x67818e1  'N2nt14MSFCoreServiceE\0'
0x67818e7  'MSFCoreServiceE\0'          <-- 少了 'N2nt14' 这 6 字节前缀
```

`0x67818e7 - 0x67818e1 = 6`。用 `_ZTS` 串的**中间位置**当目标去扫指针，
**无论编码是什么都不可能命中**。这与"相对编码"毫无关系。

> **教训**：扫字符串引用前，必须用 `d.find(b'那个串')` 拿到**真串首**，
> 不能拿"读起来像"的手抄偏移。`N2nt14` 前缀是 Itanium mangling 的长度前缀
> （`14` = `MSFCoreService` 的长度），丢了它偏移就错 6 字节。

### 7.2 另一个坑：`.rela.dyn` 里的 8 字节不是指针

对 `0x67818e1` 的绝对扫描有 2 个命中，其中 `0x149288` 落在 **`.rela.dyn`**
（R_AARCH64_RELATIVE 记录的 8 字节 `r_addend` 字段），**不是数据引用**。
判据：命中点若在 `.rela.dyn`/`.rela.plt` 区间内，一律丢弃。

---

## 8. 怎么复现

**脚本已入库**：`docs/scripts/msf-core-service/`（`elf.py` / `reloc.py` / `scan.py` /
`hexdump.py` / `ti.py` / `slot36.py`）。纯标准库，Python 3.14，零第三方依赖。

```bash
cd docs/scripts/msf-core-service
python3 scan.py       # 6 张表 + 槽数（本文 §3 的输出）
python3 hexdump.py    # vtable 前几槽 + typeinfo 的原始字节（§3.1）
python3 ti.py         # 完整 VMI typeinfo + 3 个基类（§2.3）
python3 slot36.py     # 槽 36/37/38 引用的字符串（§6）
```

脚本里硬编码了 `/home/ubuntu/hzwork/wrapper-arm64.node`，换机器改那一行即可。

### 8.1 `elf.py` —— 程序头 / 段 / vaddr↔file off

```python
import struct

class ELF:
    def __init__(self, path):
        self.data = d = open(path, 'rb').read()
        assert d[:4] == b'\x7fELF'
        e_shoff, = struct.unpack_from('<Q', d, 0x28)
        e_shentsize, e_shnum, e_shstrndx = struct.unpack_from('<HHH', d, 0x3a)
        self.secs = []
        for i in range(e_shnum):
            off = e_shoff + i * e_shentsize
            name, typ, flags, addr, offset, size = struct.unpack_from('<IIQQQQ', d, off)
            self.secs.append(dict(nameoff=name, typ=typ, flags=flags,
                                  addr=addr, off=offset, size=size))
        stroff = self.secs[e_shstrndx]['off']
        for s in self.secs:
            e = d.find(b'\0', stroff + s['nameoff'])
            s['name'] = d[stroff + s['nameoff']:e].decode()
        e_phoff, = struct.unpack_from('<Q', d, 0x20)
        e_phentsize, e_phnum = struct.unpack_from('<HH', d, 0x36)
        self.loads = []
        for i in range(e_phnum):
            off = e_phoff + i * e_phentsize
            (p_type, p_flags, p_offset, p_vaddr, p_paddr,
             p_filesz, p_memsz, p_align) = struct.unpack_from('<IIQQQQQQ', d, off)
            if p_type == 1:
                self.loads.append(dict(off=p_offset, vaddr=p_vaddr,
                                       filesz=p_filesz, memsz=p_memsz))
        self.text = next(s for s in self.secs if s['name'] == '.text')

    def v2o(self, v, n=1):
        for L in self.loads:
            if L['vaddr'] <= v and v + n <= L['vaddr'] + L['filesz']:
                return L['off'] + (v - L['vaddr'])
        return None

    def sec_of(self, v):
        for s in self.secs:
            if s['typ'] != 8 and s['addr'] and s['addr'] <= v < s['addr'] + s['size']:
                return s['name']
        return '?'

    def cstr(self, v, limit=256):
        o = self.v2o(v)
        if o is None: return None
        e = self.data.find(b'\0', o, o + limit)
        return self.data[o:e].decode('latin1')
```

### 8.2 `reloc.py` —— 应用 `.rela.dyn`（**关键一步**）

```python
import struct
from elf import ELF
R_AARCH64_RELATIVE = 1027

class Image:
    def __init__(self, path):
        self.e = ELF(path)
        self.rel = {}
        for sec in self.e.secs:
            if sec['name'] not in ('.rela.dyn', '.rela.plt'): continue
            for i in range(sec['size'] // 24):
                off, info, add = struct.unpack_from('<QQq', self.e.data, sec['off'] + i*24)
                if (info & 0xffffffff) == R_AARCH64_RELATIVE:
                    self.rel[off] = add
    def q(self, v):
        if v in self.rel: return self.rel[v]     # 重定位优先
        return self.e.q(v)
```

### 8.3 校准（先跑这个，永远先跑这个）

```python
from reloc import Image
im = Image('/home/ubuntu/hzwork/wrapper-arm64.node'); e = im.e
VT = 0x87173e8                                   # 已知正确的 MSFService 主表
ti = im.q(VT - 8)
print(hex(ti), e.sec_of(ti))                     # 0x87177e0 .data.rel.ro
print(hex(im.q(ti + 8)), e.cstr(im.q(ti + 8)))   # 0x677ecaa  N2nt10MSFServiceE
```

### 8.4 定位 `MSFCoreService` 的 6 张表

```python
def vtables_for(im, ti):
    rev = {}
    for s, a in im.rel.items(): rev.setdefault(a, []).append(s)
    LO = im.e.text['addr']; HI = LO + im.e.text['size']
    for site in sorted(rev.get(ti, [])):
        first = im.q(site + 8)
        if first is None or not (LO <= first < HI): continue
        n = 0; v = site + 8
        while True:
            x = im.q(v)
            if x is None or not (LO <= x < HI): break
            n += 1; v += 8
        print('vtable=%#x slots=%d' % (site + 8, n))

vtables_for(im, 0x87193f8)      # -> 0x8718f60 52 slots   (+5 more)
```

### 8.5 已知锚点（换版本时用来重锚）

| 目标 | 锚点 | 本版本值 |
|---|---|---|
| `MSFCoreService` vtable | RTTI 名 `N2nt14MSFCoreServiceE` | `0x8718f60`（52 槽） |
| 同一类的编辑 | typeinfo `__base_count == 3`，含 `N3MSF12IMSFCallbackE` | `0x87193f8` |
| 发送接口视图 | 9 槽、`ott = -0x10`、槽 4 是主表 36 的调整器 | `0x8719308` |
| `Initialize` | 串 `MSFCoreService::Initialize` 的 `adrp+add` 引用者 | 槽 17 |
| `SessionInit` | 串 `MSFCoreService::SessionInit` 的 `adrp+add` 引用者 | 槽 18 |

---

## 9. 对 `docs/vtable-slots.md` 的两处勘误

该文档的**结论（vtable 地址、槽数、槽语义）经本次独立复现全部正确**，但有两处细节要修：

1. **地址口径**：文中 `0x8718f60` / `0x87173e8` 都是 **vaddr**。
   `.data.rel.ro` 的文件偏移要 **减 `0x10000`**（`0x8708f60` / `0x87073e8`）。
   用它做 `pread`/`seek` 会读到垃圾。
2. **RTTI 串偏移**：`MEMORY.md` §2.3i 记的 `0x67818e7` 是错的，应为 **`0x67818e1`**。
   （`0x67818e7` 指向串内 `MSFCoreServiceE`，**丢了 `N2nt14` 长度前缀**。）

---

## 10. 一句话交接

**`nt::MSFCoreService` 主 vtable = `0x8718f60`，52 槽，文件偏移 `0x8708f60`。**
**RTTI 用的是普通绝对指针 —— 之前扫不到纯粹是串首偏移错了 6 字节。**
下一步：全 52 槽 hook 后触发一次真实发送。**如果还是零命中，立刻离开 MSF 层，
去 trpc/oidb 找**，别在这三条先天性零命中的链上继续投入。
---

## 11. 槽 36 的参数布局（2026-11-24 00:10，【指令级】）

§6 说「槽 36 参与真正发送这件事没有证明」。本节只补**参数布局**，
仍然**不主张**它会被真实发送调用——那要靠全槽 hook 实拍。

### 11.1 入口寄存器（`0x139f69c` 序言后）

```
  139f6bc:  mov  x21, x0        ; this（MSFCoreService 对象）
  139f6c0:  add  x0, sp, #0x88  ; 下一句 bl 的 sret 输出（返回对象）
  139f6c4:  mov  x23, x3        ; x3 = 第 4 参数（语义未定）
  139f6c8:  mov  x19, x2        ; x2 = 第 3 参数
  139f6cc:  mov  x20, x1        ; x1 = 第 2 参数
  139f6d0:  bl   13efc7c        ; 某构造/初始化
  139f6d4:  ldp  x9, x8, [x19]  ; ★ x19 = x2 被当作 {begin, end} 两个指针读
  139f6d8:  sub  x7, x8, x9     ; x7 = end - begin = 长度
```

⇒ **`x2` 是一个 `{begin, end}` 的 span 指针**（与 `MSFService` 侧
「`x2` = body range」一致）。`x7` 算出的长度随后作为日志的 `req_size=` 参数。

### 11.2 日志串定位（可作 hook 命中判据）

```
  139f6dc:  adrp x0, 6781000
  139f6e0:  add  x0, x0, #0x8be      ; → 0x67818be
  139f6e4:  adrp x2, 6781000
  139f6e8:  add  x2, x2, #0xe87      ; → 0x6781e87
  139f6ec:  adrp x4, 6780000
  139f6f0:  add  x4, x4, #0x37       ; → 0x6780037
  139f6f4:  adrp x5, 6782000
  139f6f8:  add  x5, x5, #0x54       ; → 0x6782054
  139f700:  mov  w1, #2
  139f704:  mov  w3, #0x285           ; 285
  139f708:  bl   906f50
```

四个串偏移已**实测读出**（`dd if=wrapper.node bs=1 skip=<off> count=60`，2026-11-24 00:20）：

| 偏移 | 内容（前 60 字节） |
| --- | --- |
| `0x6782054` | **`SendSSORequest cmd={} req_size={}`** ← 日志格式串，**坐实槽 36 = `SendSSORequest`** |
| `0x6780037` | `SendSSORequest` |
| `0x6781e87` | `msfcore_service.cc` `disconnect()` `MSFCoreService::Initialize` |
| `0x67818be` | `MSFCore_Service_Log` `MSFCore` … `N2nt14MSFCoreServiceENSt` |

这不再是「文档说它是」，而是**直接从字节里读出来的**。

### 11.3 返回路径是「对象 + 回调」，不是返回值

```
  139f900:  ldr  x8, [x19]        ; ★ x19 是对象指针
  139f904:  mov  x0, x19
  139f908:  ldr  x8, [x8, #16]    ; vtable 槽 +0x10
  139f90c:  blr  x8               ; 调回调
  139f910:  mov  x0, x19
  139f914:  bl   13ee934          ; 析构/释放
```

**和 `MSFService` 槽 36 是同一模式**：响应通过「某对象 vtable 的 `+0x10` 槽」
回调推出，**不是** `x0` 返回值。

> ⚠️ **未确认**：`x19` 在这里被 `bl 13ee934` 释放，说明它是**局部**对象，
> 回调是在它被释放前调用的。`x19` 到底是 `x2` 还是 `139f6c8` 之后的重新赋值，
> 需要看 `139f6bc`–`139f900` 之间的完整数据流。**本节只钉住「有回调 + 偏移是 +0x10」，
> 不钉住「回调在哪个对象上」。**

### 11.4 对 op2 的意义

如果全槽 hook 能证明槽 36 被 `MessageSvc.PbSendMsg` 调用，那么**发送形态**是：
- 把 `{begin, end}` 指向我方 body
- 让回调把响应推出
**不需要伪造 `Cr::unique_ptr<MSFRequest>`，也不需要构造 `MSFRequest`。**

这与 §6 的「可执行的下一步」是同一件事，只是把「需要知道什么」补全了。
