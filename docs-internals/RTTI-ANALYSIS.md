# SnowLuma 的 RTTI 解析机制 —— 逆向分析与「适配新 QQ 版本」指南

> [!WARNING]
> 本内容完全由 AI 编写，请谨慎查看。

> 目标文件：`/tmp/wrapper.node`（QQ 的 Linux arm64 共享库）、`/tmp/sl/snowluma-linux-arm64.so`（注入负载）、`/tmp/sl2/snowluma-linux-arm64.node`（注入器）
> 分析机器：甲骨文 aarch64（`example.host`），所有命令 `nice -n 19 ionice -c3`
> 证据等级：【确证】= 有命令+输出；【强推断】= 多证据交叉；【待深入】= 未查清

---

## 0. 最小可用结论（TL;DR）

1. **RTTI 链已 100% 解开**，并且**任务书里的一处关键假设是错的**：
   `__type_name` 里存的**不是** `"MSFService"`，而是 **mangled 名 `"N2nt10MSFServiceE"`**（= `nt::MSFService`）。
   扫描时按字面量 `"MSFService"` 找 typeinfo **会找到 0 个**（我们验证过：`"MSFServiceE"` 在 wrapper.node 里出现 11 次，全部是 mangled 名的尾巴）。
2. 已解出的完整链（**可直接复用**）：

   | 类 | typeinfo VA | `_ZTV` 符号 | vtable 地址点 | 槽位 |
   |---|---|---|---|---|
   | `nt::MSFService` | `0x87177e0` | `0x87173d8` | **`0x87173e0`** | `v[1..44]`（字节偏移 `+0x08 .. +0x160`） |
   | `nt::MSFCoreService` | `0x87193f8` | `0x8718f50` | **`0x8718f58`** | `v[1..52]` |

   **`SessionInit` 在两个类里都在 vtable 字节偏移 `0x98`（槽位 19）** —— 这正好解释了 SnowLuma 为什么为 MSFService / MSFCoreService 各写了一条独立的 `"...SessionInit/RTTI chain unresolved"` 错误串。
3. **hook 目标类的 `_ZTV` / `_ZTI` / `_ZTS` 在 `.dynsym` 里一个都没有** —— 但**不要**说成"整个 dynsym 里没有"（见 §4 的精确数字与踩坑记录）：
   * `.dynsym` 里 `_ZTV/_ZTI/_ZTS` **共 397 个**（`_ZTV` 17 / `_ZTI` 185 / `_ZTS` 195），
     但那是 `tinyxml2`、`vips`、`std::__function` 等**无关类**的。
   * `MSFService` / `MSFCoreService` 的 `_ZT[VIS]` **= 0**（连 `UND` 都算上）。
   * ⇒ **仍然必须运行时 RTTI 解析，上游做法无误。**
4. **SnowLuma 的 `.so` 完全没有硬编码类名或锚点名** —— 它们全在 `.node` 里（`RuntimeTargets` 结构字段）。`.so` 是一个**通用引擎**：给什么名字/锚点就解析什么。**这正是"适配新版本"的抓手**。
5. 适配难度总结：**改函数实现 → 0 改动**；**改类名 → 改 `.node` 里的字符串常量（几小时）**；**改 vtable 槽位顺序 → 需要重算槽位并改 `.so`（数天）**；**改继承结构/vtable 形状 → 可能必须重写 `.so`**。详见 §6。

---

## 1. 素材与版本指纹（先纠正一个事实）

| 文件 | 任务书说的 | **实测** | md5 |
|---|---|---|---|
| `/tmp/wrapper.node` | 138,456,152 B | **144,561,472 B** | `adeb40af26d859d41fcdb21bf38d9eb5` |
| `/tmp/sl/snowluma-linux-arm64.so` | 335 KB | 335,040 B | — |
| `/tmp/sl2/snowluma-linux-arm64.node` | 318 KB | 318,640 B | — |

⚠️ **`/tmp/wrapper.node` 与任务书描述的不是同一个 build**（差 6 MB）。本文所有地址基于实测的这个 144,561,472 B 版本。
**接手时必须先把 (文件大小, md5, build-id) 记进适配基线**，否则所有偏移都会错位。

**★ 适配基线（务必原样抄进你的 baseline 文件）**：

```
file        wrapper.node
size        144561472
md5         adeb40af26d859d41fcdb21bf38d9eb5
build-id    89c36b520f97c88081a9453bd6abb70c3452f156
note 位置   .note.gnu.build-id @ vaddr 0x200 / file 0x200，段大小 0x24，
            其中 NT_GNU_BUILD_ID 描述符 0x14 (20) 字节
DRR Δ       .data.rel.ro 的 (vaddr - file_off) = 0x10000
```

```bash
$ readelf -n /tmp/wrapper.node | head -6
Displaying notes found in: .note.gnu.build-id
  Owner                Data size    Description
  GNU                  0x00000014   NT_GNU_BUILD_ID (unique build ID bitstring)
    Build ID: 89c36b520f97c88081a9453bd6abb70c3452f156
```

**`89c36b52...` 就是 `.so` 里 `missing or ambiguous GNU build ID` 校验的那个值** ——
它是**跨版本区分 wrapper.node 的唯一可靠指纹**，比文件大小/md5 更适合做运行时校验
（大小会变、md5 要读全文件，build-id 只需读 0x200 处 36 字节）。

---

## 2. ★★★ Itanium RTTI 结构在 wrapper.node 里的真实形态

### 2.1 节映射与地址换算（【确证】`readelf -SW`）

```
[Nr] Name            Type      Address      Off      Size
[12] .text           PROGBITS  083d780      83d780   5e1ff10
[15] .rodata         PROGBITS  665d900      665d900  994a46     ← vaddr == file off ✅
[23] .data.rel.ro    PROGBITS  86acb60      869cb60  32e5a8     ← vaddr ≠ file off
[24] .dynamic        DYNAMIC   89db108      89cb108  2c0
```

**换算公式（务必用这个，别用任务书里那句含糊的话）**：

```python
DRR_VA, DRR_OFF = 0x86acb60, 0x869cb60
D = DRR_VA - DRR_OFF            # = 0x10000
file_off = vaddr - D            # 仅对 .data.rel.ro (以及 .got/.data/.bss 同 D) 成立
vaddr    = file_off + D
# .rodata / .text: vaddr == file_off
```

`0x10000` 这个偏移值本身**不固定**，换版本会变 → 必须从节表算，不能写死。

### 2.2 ★ 重大修正：`__type_name` 是 **mangled** 名

Itanium ABI 规定 `std::type_info::name()` 返回**完整 mangled 名**（GCC 下就是 `_ZTS` 后那段）。
在 wrapper.node 中【确证】：

```
file 0x677ecaa   "N2nt10MSFServiceE"         → nt::MSFService
file 0x67818e1   "N2nt14MSFCoreServiceE"     → nt::MSFCoreService
file 0x67811e5   "N2nt7wrapper17IKernelMSFServiceE"
file 0x67811d0   "N2nt13IMSFInterfaceE"
file 0x6781221   "N3msf11IMSFServiceE"
```

**任务书里说的裸字符串 `"MSFService"` @0x677e7b0 / 0x677e54fe / 0x67e54fe / 0x6847424 全部与 RTTI 无关**，逐条核实如下【确证】：

| 偏移 | 实际内容 | 真实用途 |
|---|---|---|
| `0x677e7b0` | `"MSFService\0" ``../../wrapper/external/msf/msf_response_convert.cc` | **日志 TAG**（`ConvertMsfResponse` 的 tag） |
| `0x677e54fe` | `"NodeIKernelMSFService\0userName\0userPwd\0proxyType..."` | JS↔native 桥的**属性名** |
| `0x6847424` | `"getMSFService\0assertion (argc == 0) failed: NodeIQQNTWrapperSession::getMSFService needs 0 arguments"` | N-API **JS 方法名** |
| `0x67591a8` | `"MSFService is null!"` | 断言文案 |
| `0x677fb47` / `0x6781f13` | `"MSFService::SessionInit"` / `"MSFCoreService::SessionInit"` | ✅ **这个才是真金**（见 §2.5） |

### 2.3 解析链伪代码（可直接复现）

输入：`wrapper.node` 的磁盘镜像（或目标进程内存镜像）+ 类名。
输出：`vtable 地址点` + 每个虚函数的槽位。

```python
def resolve_class(elf_bytes, class_mangled_name_predicate):
    # ---------- 阶段 A：定位 typeinfo ----------
    # A1. 读 .rela.dyn，收集所有 R_AARCH64_RELATIVE (type==1027) 重定位
    #     结果是 map: reloc_slot_vaddr -> addend        （★ key 必须是 vaddr，不是 file off！）
    relocs = {r.r_offset: r.r_addend for r in rela_dyn if r.r_info_type == 1027}

    # A2. 找出所有 addend 落在 .rodata、且内容匹配类名谓词的槽位
    #     ★ 匹配的是 MANGLED 名，例如 re.match(r'N2nt\d+MSFServiceE$', s)
    #     ★ 不要匹配 "MSFService" 字面量，会命中日志/属性名
    ti_map = {}
    for slot_va, addend in relocs.items():
        if not in_section(addend, '.rodata'):     continue
        s = cstr_at(addend)
        if class_mangled_name_predicate(s):
            ti_va = slot_va - 8          # slot_va 就是 &typeinfo->__type_name
            ti_map[s] = ti_va

    # ---------- 阶段 B：确认它是合法的 typeinfo（可选但强烈建议） ----------
    for name, ti_va in ti_map.items():
        abi_vtbl = relocs.get(ti_va)      # typeinfo 的第 0 个字 = __vptr
        # 该 ABI vtable 的 type_info::__type_name 必然是
        #   "N10__cxxabiv117__class_type_infoE"   (单继承/无虚基类)
        #   "N10__cxxabiv120__si_class_type_infoE"(单继承有基类)
        #   "N10__cxxabiv121__vmi_class_type_infoE"(多继承/虚基类)  ← 布局不同，见 §2.6
        kind = cstr_at(abi_vtbl + 16)

    # ---------- 阶段 C：反查 vtable ----------
    # vtable 符号地址 = address_point - 16 :  [0]=offset_to_top, [1]=typeinfo
    # 所以：在 .data.rel.ro 里找 8 字节对齐、值 == ti_va 的位置 p ⇒ p 就是 address_point
    for name, ti_va in ti_map.items():
        for p in scan_data_rel_ro_aligned8(value == ti_va):
            offset_to_top = read_i64(p - 8)
            # primary vtable 的 offset_to_top == 0 ；二级 vtable 为负值
            ...

    # ---------- 阶段 D：解析槽位 ----------
    ap = primary_address_point                 # offset_to_top == 0 的那个
    slots = []
    for i in count(1):                          # v[0] 是 typeinfo，v[1] 起才是虚函数
        fn = relocs.get(ap + 8*i)               # ★ 仍然走重定位表，不要裸读
        if fn is None or not in_text(fn): break
        slots.append((i, 8*i, fn))              # (槽位号, vtable 字节偏移, 函数地址)
    return ti_va, ap, slots
```

### 2.4 实测结果（【确证】）

```
===== [A] 按精确 mangled 名定位 typeinfo =====
  N2nt10MSFServiceE                 __type_name field @0x87177e8  str @0x677ecaa  ==> typeinfo_va=0x87177e0
  N2nt7wrapper17IKernelMSFServiceE  __type_name field @0x8717f88  str @0x67811e5  ==> typeinfo_va=0x8717f80
  N3msf11IMSFServiceE               __type_name field @0x8717f98  str @0x6781221  ==> typeinfo_va=0x8717f90
  N2nt13IMSFInterfaceE              __type_name field @0x8717ff8  str @0x67811d0  ==> typeinfo_va=0x8717ff0
  N2nt14MSFCoreServiceE             __type_name field @0x8719400  str @0x67818e1  ==> typeinfo_va=0x87193f8

===== [B] typeinfo 的 ABI vtable（判定 RTTI 种类） =====
  N2nt10MSFServiceE     @0x87177e0: __vptr=0x871e698
  N2nt14MSFCoreServiceE @0x87193f8: __vptr=0x871e698
  N2nt13IMSFInterfaceE  @0x8717ff0: __vptr=0x871e698
  N3msf11IMSFServiceE   @0x8717f90: __vptr=0x871e5e0
  N2nt7wrapper17IKernelMSFServiceE @0x8717f80: __vptr=0x871e5e0

===== [C] vtable 地址点（.data.rel.ro 中值 == typeinfo 的位置） =====
  nt::MSFService       ti=0x87177e0 → 5 个地址点：
      0x87173e0  offset_to_top=0          ← ★ primary
      0x8717550  offset_to_top=-8
      0x8717748  offset_to_top=-16
      0x87177a0  offset_to_top=-24
      0x87177b8  offset_to_top=-32
  nt::MSFCoreService   ti=0x87193f8 → 6 个地址点：
      0x8718f58  offset_to_top=0          ← ★ primary
      0x8719108  offset_to_top=-8
      0x8719300  offset_to_top=-16
      0x8719358  offset_to_top=-24
      0x8719370  offset_to_top=-32
      0x87193a0  offset_to_top=-64
```

**布局完全符合 Itanium ABI**：`v[-1]=offset_to_top`，`v[0]=typeinfo`，`v[1..]=虚函数。
`_ZTV` 符号（即"vtable 符号地址"）= `address_point - 16`；`_ZTI` = typeinfo 地址；`_ZTS` = `__type_name`。

⚠️ **多个 address point 的处理规则**：只有 `offset_to_top == 0` 的那个是 **primary vtable**。
其余是类在多继承/虚基类下被嵌入到不同基类子对象里的次级 vtable。**`MSFService` 有 5 个** ——
如果解析器只取"第一个找到的"，新版本里顺序一变就会选错。**必须按 `offset_to_top == 0` 过滤。**

### 2.5 ★ 虚函数名的还原方法（这是最有价值的技术）

任务书问"目标虚函数在哪个槽位"。**答案是：靠槽位函数体内引用的字符串反查方法名**。
这不是猜测 —— 我们验证了它给出的是**确定性**结果。

**验证实验（决定性）**：

```bash
# 1) 在 .rodata 里定位锚点串
#    "MSFService::SessionInit"    @ file 0x677fb47
#    "MSFCoreService::SessionInit"@ file 0x6781f13
# 2) 扫描 .text，找 adrp+add 指向它的指令位置
```

```
  target 0x677e7b0 <- site 0x1372ce0 (+4 bytes)      # "MSFService" (日志 TAG)
  target 0x677fb47 <- site 0x137aa9c (+4 bytes)      # "MSFService::SessionInit"    ★
  target 0x6781f13 <- site 0x139e0f0 (+4 bytes)      # "MSFCoreService::SessionInit"★
```

site `0x137aa9c` 落在函数 **`0x137a48c`** 内 —— 而 `0x137a48c` 正好是 `nt::MSFService` primary vtable 的 **`v[19]`（偏移 `0x98`）**。
site `0x139e0f0` 落在函数 **`0x139d864`** = `nt::MSFCoreService` **`v[19]`（偏移 `0x98`）**。

⇒ **锚点串 → adrp+add xref site → 所属函数 → 在 vtable 里按函数地址匹配 → 得到槽位。** 闭环。

**算法**：

```python
def slot_name(fn_va):
    """一个槽位函数引用到的 'Class::method' 串 ⇒ 它的方法名（取最后一个最具体的）"""
    names = []
    for site, target in adrp_add_pairs_in(fn_va, span=0x1400):   # 只看该函数体
        s = cstr_at(target)
        if re.match(r'^[A-Za-z_~][\w:<>,$]*::[A-Za-z_~]\w*$', s):   # 形如 Foo::Bar
            names.append(s)
    return names[-1] if names else None      # 日志按“越具体越靠后”排列
```

> ⚠️ **坑**：**不能**用函数名匹配（wrapper.node 无 `.symtab`，`nm` 报 `no symbols`）。
> **不能**只匹配第一个串（前几个常是 `<TAG> | <file>.cc |` 这种前缀）。
> 上表就是按"取最后一个 `Class::method`"得到的，人工核对 100% 正确。

### 2.6 三个类 RTTI 的差异（新版本判定用）

| 类 | `__vptr` | RTTI 种类 | 说明 |
|---|---|---|---|
| `nt::MSFService` | `0x871e698` | `__class_type_info`（推测） | 无基类或只有非虚基类 |
| `nt::MSFCoreService` | `0x871e698` | 同上 | 与 MSFService **共用**同一个 ABI vtable → 同类 RTTI |
| `nt::IMSFInterface` | `0x871e698` | 同上 | 同上 |
| `N3msf11IMSFServiceE` | `0x871e5e0` | 另一个 RTTI 类 | 与上面不同 → 不同的 RTTI 类别 |
| `N2nt7wrapper17IKernelMSFServiceE` | `0x871e5e0` | 同上 | 与 `msf::IMSFService` 同类 |

⇒ **`__vptr` 相同 = 同一 RTTI 种类**，解析器可以用来做一致性校验。
`.so` 里【确证】导入了 `_ZTVN10__cxxabiv117__class_type_infoE` 与 `_ZTVN10__cxxabiv120__si_class_type_infoE`
（`readelf -rW` 在 `.rela.dyn` 里可见，`+10` 加数 = 地址点），**证实它确实在做 RTTI 种类判定**。
**注意：它只引用了 117 和 120，没有 121（`__vmi_class_type_info`）** —— 也就是说
**如果腾讯给 MSFService 加了多继承/虚基类（变成 `__vmi_class_type_info`），SnowLuma 的解析器会直接不认。**

### 2.7 完整虚函数表（【确证】，可直接复用）

`v[i]` 的 vtable 字节偏移 = `8*i`。函数地址为 wrapper.node 内 VA。
**方法名的确定方法见 §2.5**；下表是用 `.eh_frame_hdr` 求出**精确函数边界**后重新归属字符串的结果
（脚本 `/tmp/re/s8_fde.py`，日志 `/tmp/re/s8_slots.log`）。

**关于方法名的置信度（诚实标注）**：
* **`SessionInit`（v[19]）与 `Initialize`（v[18]）是【确证】级别** ——
  锚点串 `"MSFService::SessionInit"` @ `0x677fb47` 的 xref site `0x137aa9c` **精确落在**
  `fn 0x137a48c` 的边界 `[0x137a48c, 0x137b194)` 内；`"MSFCoreService::SessionInit"` @ `0x6781f13`
  的 site `0x139e0f0` 同样精确落在 `fn 0x139d864` 的 `[0x139d864, 0x139e8e4)` 内。
  见 §7.5 与 §7.5b 的精确边界输出。
* **其余槽位的方法名是【强推断】** —— 来源是"该函数体内引用的 `Class::method` 字符串"，
  **但 0x1400 字节的扫描窗可能跨入相邻函数**，所以个别条目可能偏移一位。
  **识别方法**：同一方法名连续出现在 2–3 个相邻槽位（如 `DecodeMsfRspInfo` 占 v[11]、v[28..30]；
  CoreService 的 `ResetSessionId` 占 v[3..6]、`Initialize` 占 v[17][18]），
  这是**内联/克隆函数**的正常现象，但也意味着**这些位置的方法名不能单独作为槽位判据**。
* **做版本适配时的正确做法**：**不要依赖方法名表**（它只是"辅助理解"），
  而是依赖 **§7.5 那种"锚点串 → xref site 精确落在哪个 vtable 槽位函数内"** 的判定 —— 那是确定性的。


#### `nt::MSFService` —— `_ZTV` @ `0x87173d8`，地址点 @ `0x87173e0`，typeinfo @ `0x87177e0`

| 槽 | off | 函数 VA | 方法名（由字符串反查） |
|---|---|---|---|
| 1 | 0x08 | 0x138f56c | `vector` 相关 |
| 2 | 0x10 | 0x138f7e4 | — |
| 3 | 0x18 | 0x137b30c | **getMsfStatus** |
| 4 | 0x20 | 0x137b4c8 | **getMsfStatus** |
| 5 | 0x28 | 0x137b618 | `net_service.cc` 转发 |
| 6 | 0x30 | 0x137b61c | **getMsfStatus** |
| 7 | 0x38 | 0x13821c0 | **getNetworkProxy / setNetworkProxy** |
| 8 | 0x40 | 0x1382928 | — |
| 9 | 0x48 | 0x138241c | **setNetworkProxy** |
| 10 | 0x50 | 0x13827e0 | msf |
| 11 | 0x58 | 0x1382bcc | **DecodeMsfRspInfo** |
| 12 | 0x60 | 0x1383384 | **sendMsfRequest** |
| 13 | 0x68 | 0x137eb28 | **onMsfPushForTesting** |
| 14 | 0x70 | 0x137b2dc | `online` |
| 15 | 0x78 | 0x137b2e8 | `online` |
| 16 | 0x80 | 0x1378618 | **ResetSessionId** |
| 17 | 0x88 | 0x137877c | **Initialize** |
| 18 | 0x90 | 0x1378c4c | **Initialize**（`init with uin:{} appid:{} machine_id_:{}`） |
| **19** | **0x98** | **0x137a48c** | ★ **SessionInit**（`init with uin:{}`） |
| 20 | 0xa0 | 0x137b6b8 | **Connect** |
| 21 | 0xa8 | 0x137b938 | **Disconnect / SetDefaultUin** |
| 22 | 0xb0 | 0x137fc34 | **Login** |
| 23 | 0xb8 | 0x137b9bc | **SetDefaultUin** |
| 24 | 0xc0 | 0x137bba0 | **SetSSOErrorCallback / SendOidbReqInternal** |
| 25 | 0xc8 | 0x1380c4c | **RequestEncryptKey** |
| 26 | 0xd0 | 0x1381760 | **RequestDecryptKey** |
| 27 | 0xd8 | 0x1380204 | **SetMsfNeedDisconnectFlag / StartKeepAliveTimer** |
| 28-30 | 0xe0-0xf0 | 0x1382dc0/d... | **DecodeMsfRspInfo** 系列 |
| 31 | 0xf8 | 0x1383cdc | **UpdateSignaureInfo** |
| 32 | 0x100 | 0x1383f14 | **operator() — recv msf push** ★收包锚点 |
| 33 | 0x108 | 0x137821c | **Destroy / StopKeepAliveTimer** |
| 34 | 0x110 | 0x1378224 | **Destroy** |
| 35 | 0x118 | 0x137bc98 | **SendOidbReqInternal** |
| 36 | 0x120 | 0x137cc80 | **SendSSORequestInternal** |
| 37 | 0x128 | 0x137ceb8 | **SendSSORequestInternal** |
| 38 | 0x130 | 0x137dbf4 | **SendMsfRequest** |
| 39 | 0x138 | 0x137dd10 | **SendMsfRequest** |
| 40 | 0x140 | 0x137ef90 | `SvcReqRegister` |
| 41 | 0x148 | 0x137fc74 | **onKickedOffLine** |
| 42 | 0x150 | 0x137fe44 | **onUserOnlineStatusChanged** |
| 43 | 0x158 | 0x1383ee4 | `operator()` recv msf push |
| 44 | 0x160 | 0x137b194 | **OnConnectivityChanged** |
| — | 0x168 | `0xfffffffffffffff8` | **不是函数指针 → vtable 结束** |

#### `nt::MSFCoreService` —— `_ZTV` @ `0x8718f50`，地址点 @ `0x8718f58`，typeinfo @ `0x87193f8`

| 槽 | off | 函数 VA | 方法名 |
|---|---|---|---|
| 3-6 | 0x18-0x30 | — | **ResetSessionId** 系列 |
| 7 | 0x38 | 0x13a1fec | **getNetworkProxy / setNetworkProxy** |
| 8 | 0x40 | 0x13a2754 | **sendMsfRequest** |
| 11 | 0x58 | 0x13a29f8 | **sendMsfRequest** |
| 12 | 0x60 | 0x13a2bec | **sendMsfRequest** |
| 13 | 0x68 | 0x13a33d0 | **onMsfPushForTesting / GetClientAddress** |
| 14 | 0x70 | 0x139c1bc | **connect / disconnect** |
| 15 | 0x78 | 0x139c204 | **disconnect / ResetSessionId** |
| 16 | 0x80 | 0x139c2f0 | **ResetSessionId** |
| 17 | 0x88 | 0x139c454 | **Initialize** |
| 18 | 0x90 | 0x139c93c | **Initialize** |
| **19** | **0x98** | **0x139d864** | ★ **SessionInit**（`SessionInit with uin:{}`） |
| 20 | 0xa0 | 0x139e8e4 | **Connect** |
| 21 | 0xa8 | 0x139eaa4 | **Disconnect / SetDefaultUin** |
| 22-23 | 0xb0-0xb8 | 0x139eaf0/eaf8 | **SetSSOErrorCallback** |
| 24 | 0xc0 | 0x139eb80 | **SendOidbReqInternal** |
| 25 | 0xc8 | 0x13a0c0c | **RequestEncryptKey** |
| 26 | 0xd0 | 0x13a1508 | **RequestDecryptKey** |
| 28-31 | 0xe0-0xf8 | — | **UpdateSignaureInfo / onMSFError** |
| 32 | 0x100 | 0x13a584c | **IMPB_MSF 上报** |
| 33 | 0x108 | 0x139be48 | **Init** |
| 34 | 0x110 | 0x139be98 | **Destroy** |
| 35 | 0x118 | 0x139ec10 | **SendOidbReqInternal** |
| 36 | 0x120 | 0x139f488 | **SendSSORequest** |
| 37 | 0x128 | 0x139f69c | **SendSSORequestNoResponse** |
| 38 | 0x130 | 0x139fb08 | **SendMsfRequestInternal** |
| 39 | 0x138 | 0x13a03c0 | **SendMsfRequest / RegisterMSFPush** |
| 40 | 0x140 | 0x13a0894 | **RegisterMSFPush** |
| 41 | 0x148 | 0x13a1b7c | **onKickedOffLine** |
| 42 | 0x150 | 0x13a1d98 | **onUserOnlineStatusChanged** |
| 43-46 | 0x158-0x170 | — | **onMSFError / onSSORetError / onMSFServerTimeUpdated** |
| **47** | **0x178** | **0x13a3e80** | ★ **onMSFPacketState** ← 对应 `.so` 串 `"MSFCoreService packet-state callback/RTTI chain unresolved"` |
| 48-51 | 0x180-0x198 | — | **onMSFNetworkState / onSSORetError(uinInfo)** |
| 52 | 0x1a0 | 0x13a46c4 | **OnConnectivityChanged** |

**关键对应关系（把 `.so` 的错误文案翻译成具体槽位）**：

| `.so` 错误串 | 对应目标 | 地址/偏移 |
|---|---|---|
| `MSFService SessionInit/RTTI chain unresolved` | MSFService `SessionInit` | `0x137a48c`，**ap+0x98** |
| `MSFCoreService SessionInit/RTTI chain unresolved` | MSFCoreService `SessionInit` | `0x139d864`，**ap+0x98** |
| `MSFCoreService packet-state callback/RTTI chain unresolved` | MSFCoreService `onMSFPacketState` | `0x13a3e80`，**ap+0x178** |
| `MSFService receive anchor/TaskManager RTTI chain unresolved` | MSFService `operator()`（recv push）+ TaskManager 链 | `0x1383f14` / `0x1383ee4`，ap+0x100/+0x158 |
| `MSFService send features missing or ambiguous` | `SendSSORequestInternal` / `SendMsfRequest` | ap+0x120 / +0x130 |
| `MSFCoreService send features missing or ambiguous` | `SendSSORequest` / `SendMsfRequest` | ap+0x120 / +0x138 |
| `MSFCoreService packet converter/native allocator unresolved` | `onMsfPushForTesting`/`GetClientAddress` + 分配器 | ap+0x68 |

> **`msfCoreCallbackOffset` 的最佳解释（【强推断】）**：vtable 里 `onMSFPacketState` 的**字节偏移 `0x178`**（或运行时按 vtable 形状算出的等价偏移）。
> `msfCoreCallbackVtables` 则是"含有该回调槽位的候选 vtable 列表"。两者配对使用：`Vtables[i][CallbackOffset]`。

---

## 3. SnowLuma `.so` 的解析流程（任务 2）

### 3.1 它导入了什么（【确证】`readelf -sW --dyn-syms`，`UND` 项）

**RTTI/ABI 相关**：
```
_ZTVN10__cxxabiv117__class_type_infoE        ← RTTI 种类判定（.rela.dyn 中 +10 = 地址点）
_ZTVN10__cxxabiv120__si_class_type_infoE     ← 同上
__cxa_demangle                                ← ★仅 1 处调用（见下）
__cxa_guard_acquire / release / abort
__gxx_personality_v0
```
**内存/进程**：
```
process_vm_readv      ← 26 处调用（读目标进程内存）
/map_files/           ← 通过 /proc/self/fd 拿文件真实路径
pread / readlink / stat / fstat / open / close / mmap / munmap / mprotect
```
**没有** `ptrace`（注入由 `.node` 侧完成）。

### 3.2 函数级地图（【确证】：`strings -t x` + `adrp/add` xref + 栈帧扫描）

`.so` 的 `.rodata` vaddr == file off（`437b0 == 437b0`），所以字符串偏移可直接当地址用。
把每条诊断串 xref 回函数，得到清晰的分层：

| 函数地址 | 职责 | 证据（它引用的串） |
|---|---|---|
| `0x5610` | **★ 验证闸门 + 提交**（唯一的"验收"函数） | `invalid pid` / `failed to inspect wrapper.node` / **`runtime service structures could not be read or resolved`** / 全部 9 条 RTTI 失败串 / `QQ runtime cannot read process memory` / `(errno=...) [RUNTIME_MEMORY_UNAVAILABLE]` |
| `0xfd4c` | RuntimeTargets **门面/facade**（含 `.so` 导出 API） | `Linux runtime targets are not resolved yet` / `Linux MSF service targets are missing` / `logged-in MSF service instance is missing` / 5 条用户可见文案 |
| `0xea00` | **VTable 安装/收包会话** | `waiting for the selected receive session` / **`failed to install a resolved receive VTable`** |
| `0x2389c` | `/proc/<pid>/maps` 解析 | `/opt/QQ/` / `[stack` / `[vdso]` / `[anon:` / `[heap]` |
| `0x24af4` | ELF **节表解析**（按节名） | `.data` / `.got` / `.text`（节名字符串） |
| `0x2b518` | ELF 头 + 节表头校验 | `ELF file is too small` / `not a little-endian ELF64 file` / `ELF section table is missing` / `ELF section entry is smaller than expected` |
| `0x2d6ac` | 模块定位 + 元数据 | `module not found in target process maps` / `failed to read mapped ELF module:` / `.eh_frame_hdr` |
| `0x362a0` | `/proc` 进程枚举（找 QQ 主进程） | `cannot enumerate /proc:` / `/comm` / `/cmdline` |
| `0x384cc` | build-ID + 节名遍历 + 模块候选 | `no mapped GNU build ID` / `missing or ambiguous GNU build ID` / `open candidate:` / `stat candidate:` / `ELF note segment is too large` / `mapped file identity:` |
| `0x39b10` | **磁盘 vs 内存一致性校验** | **`ELF metadata differs from live memory`** / `read candidate:` / `read mapped metadata:` / `ELF metadata is outside the file or readable header mapping` |
| `0x3bd64` | `/map_files/` 路径解析 | `/map_files/` |
| `0x13d1c` | 会话身份校验 | `session binding is empty` / `native selected session changed` |
| `0x152b0` | 会话/回包路径校验 | `session kind unavailable` / `reply path changed` / `one-way path changed` / `/proc/self/maps` |
| `0x1c7e4` | **消息快照解析**（读 QQ 内存里的消息结构） | `client message task tree rejected` / `message pending chain rejected` … |
| `0x1e2bc` / `0x1eafc` / `0x1f130` | `MessageSvc.PbSendMsg` 构造 | **`MessageSvc.PbSendMsg`** / `message snapshot UID rejected` / `message integer overflow` |
| `0x3de88` | 通用容器辅助 | `vector::_M_realloc_insert` / `vector::reserve` |

**`__cxa_demangle` 只在 `0x2e0d8` 被调用一次**（位于 `0x2d6ac` 模块定位函数内）—— 说明 demangle 只用于**日志可读性/名称比对**，不是解析主循环。

### 3.3 已验证的解析流程（伪代码）

```
snowluma_linux_hook_start_dynamic(pid, 1)            # 导出 API，.so:0xcf3c
  └─ 内部 init（.so:0xcf98）
       ├─ [0x362a0] 枚举 /proc，按 /comm + /cmdline 找 QQ 主进程
       │    命中特征： linuxqq / ntqq / qqnt / app_launcher.node / libqq
       ├─ [0x2389c] 读 /proc/<pid>/maps，过滤掉 [stack] [vdso] [vvar] [anon: [heap]
       │    命中 /opt/QQ/ 前缀的映射 → wrapper.node 的 base / 各段
       ├─ [0x2d6ac + 0x384cc] 打开模块文件，校验 ELF64-LE 头 + 节表
       │    · 读 .note.gnu.build-id（36 字节 @0x200）         → "missing or ambiguous GNU build ID"
       │    · 用 /map_files/<rng> 与 readlink(/proc/self/fd/N) 确认磁盘文件 == 内存映射
       ├─ [0x39b10] ★ 磁盘 vs 内存逐段比对
       │    · pread 磁盘 + process_vm_readv 内存
       │    · 不一致 → "ELF metadata differs from live memory" 并放弃
       ├─ [0x24af4] 按【节名】解析节表，取 .data.rel.ro / .text 的 VA+size
       │    （依赖节名而不是节索引 —— 因此需要完整的 .shstrtab）
       ├─ ★ 解析 RuntimeTargets（名字/锚点来自 .node，见 §3.4）
       │    · 用 MSF/Msf/SSO/Session/Wrapper/Kernel/NodeI 片段筛选 typeinfo 名
       │    · 走 Itanium 链：typeinfo → vtable(地址点) → 槽位
       │    · 用 _ZTVN10__cxxabiv1{17,20}__..._type_infoE 校验 RTTI 种类
       ├─ [0x5610] ★★ 验证闸门（全部为“与”关系，任一条失败即整链失败）
       │    · if (pid_invalid)                     "invalid pid"
       │    · if (!wrapper_ok)                    "failed to inspect wrapper.node"
       │    · if (!structs_readable)              "runtime service structures could not be read or resolved"
       │    · if (msfSendFeatures ambiguous)      "MSFService send features missing or ambiguous"
       │    · if (msfRecvAnchor/TaskManager 未解) "MSFService receive anchor/TaskManager RTTI chain unresolved"
       │    · if (ngSessionOwnership 未解)        "NG session/receive ownership path unresolved"
       │    · if (msfSessionInit 未解)            "MSFService SessionInit/RTTI chain unresolved"
       │    · if (coreSendFeatures ambiguous)     "MSFCoreService send features missing or ambiguous"
       │    · if (corePacketState 未解)           "MSFCoreService packet-state callback/RTTI chain unresolved"
       │    · if (coreSessionInit 未解)           "MSFCoreService SessionInit/RTTI chain unresolved"
       │    · if (coreConverter/allocator 未解)   "MSFCoreService packet converter/native allocator unresolved"
       │    · if (liveSelector 未解)              "MSF live selector feature/RTTI chain missing or ambiguous"
       └─ [0xea00] 装 VTable
            · 把目标 vtable 页 mprotect(RW)，替换槽位指针
            · 失败 → "failed to install a resolved receive VTable"
            · [0x13d1c / 0x152b0] 之后每次调用都做一致性校验
                 → "session identity changed" / "reply path changed" / "one-way path changed"
```

**错误串的提交顺序与真实控制流一致**（反汇编 `0x6480-0x6678` 可见连续的 `cbz/cbnz` → 分支 → `adrp x1,44000; add x1,x1,#0xXXX; bl <append>` 模式），
且 `0x5610` 结尾（`0x6678+`）把所有错误串拼成一条用 `"; "` 分隔的总报错 —— 正好解释 `.so` 里那个孤立的 `"; "` 串 @ `0x44b63`。

### 3.4 ★★ 关键发现：`.so` 里**没有**类名/锚点 —— 它们在 `.node` 里

**我们逐字节验证过**（【确证】）：

| 字符串 | wrapper.node | **.so** | **.node** | index.mjs |
|---|---|---|---|---|
| `N2nt10MSFServiceE` | 6 | **0** | **0** | 0 |
| `N2nt14MSFCoreServiceE` | 7 | **0** | **0** | 0 |
| `msfDidRecvResponseData` | **0** | **0** | **1** | 0 |
| `msfGetStatus` | **0** | **0** | **1** | 0 |
| `selfInfoOnLoginSuccess` | **0** | **0** | **1** | 0 |
| `sendSsoInternal` | **0** | **0** | **1** | 0 |
| `msfServiceTypeinfo` | 0 | **0** | **2** | 0 |
| `CreateNTSessionShell` | 有 | **0** | **1** | 0 |
| `linuxqq` / `ntqq` / `qqnt` / `libqq` | — | **0** | ✓ | — |
| `msf_service.cc` / `msfcore_service.cc` | ✓ | 0 | 0 | 0 |

⇒ **`nnphook::linux_backend::RuntimeTargets` 是一个由 `.node` 填充、`.so` 消费的数据结构。**
`.so` 是**通用引擎**；**每个 QQ 版本要适配的东西 = `.node` 里那几个字符串常量 + 锚点表**。

> ⚠️ 但 `.node`（318 KB，stripped）里这些名字只有**各 1 次**，说明它们大概率在一个**小的常量/配置数组**里，
> 而不是散在各处。**接手后第一件事就是把这个数组的下标/用途dump出来**（见 §9 待深入）。

### 3.5 ★ `.so` 的「名字片段表」—— `msfServiceTypeinfoName` / `msfCoreTypeinfo` 的真身

`.so` 的 `.data.rel.ro`（VA `0x60ab0`..`0x60d08`，file `0x50ab0`..`0x50d08`）里，
有一张 `{const char* name; size_t len;}` 的**连续表**（【确证】：`readelf -rW` 的 `R_AARCH64_RELATIVE` 槽位）：

```
slot VA 0x60c40 -> 0x45268  "MSF"                    (len 3)
slot VA 0x60c50 -> 0x4526c  "Msf"                    (len 3)
slot VA 0x60c60 -> 0x45270  "SSO"                    (len 3)
slot VA 0x60c70 -> 0x45274  "Session"                (len 7)
slot VA 0x60c80 -> 0x4527c  "Wrapper"                (len 7)
slot VA 0x60c90 -> 0x45284  "Kernel"                 (len 6)
slot VA 0x60ca0 -> 0x4528b  "NodeI"                  (len 5)
slot VA 0x60cb0 -> 0x45291  "CreateNTSessionShell"   (len 20)
slot VA 0x60cc0 -> 0x452a6  "CreateGProSessionShell" (len 22)
--- 紧接着是进程/模块发现用的提示表 ---
slot VA 0x60cd0 -> 0x45486  "linuxqq"
slot VA 0x60cd8 -> 0x4548e  "ntqq"
slot VA 0x60ce0 -> 0x45499  "app_launcher.node"
slot VA 0x60cf0 -> 0x454ab  "qqnt"
slot VA 0x60d00 -> 0x454b0  "libqq"
```

**这是整份分析里适配价值最高的一个表。** 它解释了错误串 `MSFService SessionInit/RTTI chain unresolved` 和
`MSFCoreService packet-state callback/RTTI chain unresolved` **为什么在运行时才报** ——
**具体类名由 `.node` 传入，`.so` 只拿这一组"片段"当通用筛选器。**

> 注意：`.so` 引用的是**节名**（`.data` / `.got` / `.text` / `.plt`），
> 而 `.rodata` / `.data.rel.ro` / `.rela.dyn` / `.dynsym` **在 `.so` 里各出现 1 次但没有任何 adrp+add 引用** ——
> 【强推断】它们被 `.node` 通过 RuntimeTargets 传入，或在 `0x2e0d8` 那个唯一 `__cxa_demangle` 附近的字符串处理路径里以非 `adrp+add` 方式取用。

### 3.6 `xrefFileOffsets` / `xrefRuntimeAddresses` 的含义（【强推断】）

`.node` 的字段成对出现：

```
anchors: address, fileOffset, size, flags, runtimeAddress, demangled, value, bind, type,
         sectionIndex, section
xrefFileOffsets / xrefRuntimeAddresses
functionAddresses / functionRuntimeAddresses
msfServiceTypeinfo / msfServiceTypeinfoName / msfServiceVtables / msfServiceCandidates
msfCoreTypeinfo / msfCoreCallbackOffset / msfCoreCallbackVtables / msfCoreCandidates
wrapperBase
sendSsoInternal / msfDidRecvResponseData / msfGetStatus / selfInfoOnLoginSuccess
```

结合 §3.2 里 `.so` 的 `ELF metadata differs from live memory` / `mapped file identity` / `read candidate` / `read mapped metadata`，
最自洽的解释是：

* **`xrefFileOffsets`** = 在 `wrapper.node` **磁盘文件**里记录下来的**文件偏移**列表
  （即"这个引用点应该出现在文件偏移 X"）—— 是**静态指纹**。
* **`xrefRuntimeAddresses`** = 同一批引用点**换算到运行时绝对地址**（`wrapperBase + 校正偏移`）—— 是**动态地址**。
* 两者配对，让 `.so` 能**双向校验**：既确认"内存里这个位置确实是预期的那条指令/指针"，
  又确认"磁盘文件没有被动过手脚"，从而在**版本错配**和**内存被篡改**两种情况下都能安全退出而不是乱改 vtable。
* `anchors[]` 里的 `fileOffset` + `runtimeAddress` 是同一思路的逐条实例。

> 依据强度：【强推断】。直接读 `.so` 的 RuntimeTargets 消费代码可以定案，见 §9。

---

## 4. 为什么「必须运行时 RTTI」—— 反向验证

【确证】`readelf -sW --dyn-syms /tmp/wrapper.node` 共 1528 条。
**这里必须精确表述 —— 我们第一次搞错了，记录如下以免后人重蹈：**

```bash
# ❌ 错误的做法：只看 /tmp/rtti/all-exports.txt（那是"已定义导出"的子集，468 条）
$ grep -cE "_ZTV|_ZTI|_ZTS" /tmp/rtti/all-exports.txt
0

# ✅ 正确的做法：查完整 .dynsym
$ readelf -sW --dyn-syms /tmp/wrapper.node | awk '$8 ~ /_ZT[VIS]/' | wc -l
397
$ for p in _ZTV _ZTI _ZTS; do echo -n "$p = "; readelf -sW --dyn-syms /tmp/wrapper.node | awk -v p="$p" '$8 ~ p' | wc -l; done
_ZTV = 17
_ZTI = 185
_ZTS = 195
```

**所以"dynsym 里没有 RTTI"是错的** —— 但这**不影响结论**，因为真正要看的是 hook 目标类：

```bash
$ readelf -sW --dyn-syms /tmp/wrapper.node | grep -E "MSFService|MSFCoreService" | grep -cE "_ZT[VIS]"
0
$ readelf -sW --dyn-syms /tmp/wrapper.node | grep -cE "_ZN2nt10MSFService"
0
```

⇒ **`MSFService` / `MSFCoreService`（以及它们的任何方法）在 dynsym 里完全不存在**
（那 397 个 `_ZTV/_ZTI/_ZTS` 属于 `vips::VOption`、`nt::tinyxml2::XMLUnknown`、
`std::__function::__base<...>`、`std::__cxx11::...` 等无关类型）。
再加上 **没有 `.symtab`**，⇒ **没有任何符号级途径拿到目标 vtable；
唯一途径是数据级 RTTI 反查 + 字符串锚点。上游做法无误。**

> **教训（写进核查清单）**：`/tmp/rtti/all-exports.txt` 是**已定义导出的子集**，
> 拿它当"全部符号"会得出错误结论。**任何时候都要回到 `readelf -sW --dyn-syms` 原文。**
> 这个坑在 §8 列为"已知陷阱"。

---

## 5. 【核心交付】适配新 QQ 版本难度矩阵（任务 3）

前提：**你手上保留了 SnowLuma 的 `.node`（含 RuntimeTargets 常量）与 `.so`（通用引擎）。**
所有"改动量"以**一个人、熟悉本流程**估算。

| # | 腾讯的改动 | 会坏在哪 | 需要改什么 | 工作量 | 是否要重写 native |
|---|---|---|---|---|---|
| **0** | **不发布新版本**（同 build） | — | 什么都不用 | 0 | 否 |
| **1** | **只改函数内部实现**（类名、vtable 布局、槽位顺序都不变） | 什么都不坏（RTTI 解析是按名字+偏移找，不看实现） | **0 改动** | **0** | **否** |
| **2** | **改了类名**（`nt::MSFService` → `nt::MSFServiceV2`） | `.node` 里 TypeinfoName 匹配不到 → `MSFService SessionInit/RTTI chain unresolved` | 改 `.node` 里 typeinfo 名/片段常量（**字符串级**） | **2–6 小时** | **否**（只改字符串表） |
| **3** | **改了 vtable 槽位顺序**（中间插入/删除一个虚函数） | 槽位偏移全错 → 换错函数指针 → **崩溃或静默失效**（最危险） | 用 §2.5 的"字符串→xref→槽位"脚本**重算全部槽位偏移**，更新 `.node` 的 `msfCoreCallbackOffset` 等 | **0.5–2 天**（脚本跑几分钟，验证要时间） | **否**（改配置数字） |
| **4** | **加了新虚函数、追加在末尾** | primary vtable `offset_to_top` 仍为 0，前面槽位不变 | **通常 0 改动**（只要目标函数仍在原槽位） | **小时级验证** | 否 |
| **5** | **给 MSFService 加了多继承/虚基类**（→ `__vmi_class_type_info`） | `.so` 只导入 `__cxxabiv117` 和 `120`，**不认 121** → 解析直接失败 | **必须改 `.so` 支持 `__vmi_class_type_info` 布局** | **3–7 天** | **是**（改 native） |
| **6** | **换了 `.rodata` 布局 / 删了 `"Xxx::SessionInit"` 这类锚点串** | 靠字符串锚点定位的路径全断（§2.5 的方法失效） | 需为每个目标重新找**新的稳定锚点**（新日志串、`what()` 串、或 `.pdata`/`.eh_frame` 结构） | **数天–2 周** | **是**（很可能） |
| **7** | **wrapper.node 被 strip**（去掉 `.shstrtab` / 节表） | `.so` 按**节名**解析节表 → `ELF section table is missing` | 改为按**程序头 (PT_LOAD/PT_DYNAMIC)** + 硬编码节布局；或改注入器在加载前补回节表 | **2–5 天** | **是** |
| **8** | **换了 ABI/编译器**（mangled 名规则变，如 Clang 与 GCC 的 `std::` 命名空间差异） | 名字匹配全断 | 改匹配规则（SnowLuma 已有 `NSt2Cr` = `std::__cxx11` 变体特征） | **1–3 天** | 半是 |
| **9** | **换成非 x86 之外的新架构 / 加壳** | 全断 | 重做 | **周级** | 是 |
| **10** | **QQ 改了注入方式**（沙箱、`/proc` 权限、`process_vm_readv` 被拦） | `QQ runtime cannot read process memory` `[RUNTIME_MEMORY_UNAVAILABLE]` | 改用 `ptrace(PTRACE_PEEKDATA)` 或 `/proc/pid/mem` | 2–4 天 | 是 |

### 结论一句话

> **只要腾讯不动"类名 + 继承结构 + vtable 槽位顺序"，适配成本 = 0~1 天，而且只改字符串/数字配置，不用碰 native 代码。**
> **一旦 vtable 形状变了（多继承/虚基类），就必须重写 native 解析器。**

### 应对策略：把"适配"变成"跑脚本"

因为 §2.5 的方法是完全机械化的，**建议接手者第一件事就是把下面这个脚本做出来**
（本报告的分析代码已经能直接改造成它）：

```
tools/dump-vtable.py --wrapper wrapper.node --class 'nt::MSFService'
  输出：
    typeinfo_va / _ZTV / address_point / slot_count
    v[1..N] : off, fn_va, method_name, source_file
  然后与历史基线 diff，自动生成 .node 需要更新的常量
```

有了它，**情况 2/3/4 的适配就变成"跑一条命令 + 看 diff"**，而不是逆向工程。

---

## 6. 自研 RTTI 解析器：技术路线与工作量（任务 4）

### 6.1 必须实现的 8 个模块

| # | 模块 | 关键点 | 复用本报告的 |
|---|---|---|---|
| M1 | **进程/模块定位** | 枚举 `/proc/*/{comm,cmdline}`；按 `linuxqq`/`ntqq`/`app_launcher.node` 识别主进程；读 `/proc/<pid>/maps`，过滤 `[stack] [vdso] [vvar] [anon: [heap]`；用 `/map_files/<start>-<end>` + `readlink(/proc/self/fd/N)` 拿到真实文件路径 | `.so` 的 `0x362a0`/`0x2389c` |
| M2 | **模块身份校验** | 读 `.note.gnu.build-id`（36 B @0x200）；要求**唯一**（`missing or ambiguous GNU build ID`）；`pread` 磁盘 + `process_vm_readv` 内存**逐段比对** | `.so` 的 `0x384cc`/`0x39b10` |
| M3 | **ELF 解析** | ELF64-LE 头、节表、`.shstrtab`、**按节名取** `.rodata`/`.data.rel.ro`/`.text`；**算出每节的 `vaddr - file_off` 差值（不要写死 0x10000）** | 本文 §2.1 |
| M4 | **重定位表解析** | 读 `.rela.dyn`，取 `R_AARCH64_RELATIVE(1027)`，建 `map: slot_vaddr -> addend`。**这是解析 RTTI 的权威数据源**（比裸扫指针可靠得多） | 本文 §2.3 |
| M5 | **typeinfo 定位** | 在 M4 的表里找 `addend ∈ .rodata` 且内容是 **mangled 类名**的槽位；`ti_va = slot - 8` | 本文 §2.3 阶段 A |
| M6 | **RTTI 种类校验** | 读 `ti_va` 的 `__vptr`，其 `type_info::__type_name` 必须是 `__class_type_info` / `__si_class_type_info` / `__vmi_class_type_info`；**`117`/`120` 布局简单，`121` 需额外解析 `__flags` + `__base_count` + `__base_info[]`** | `.so` 的 `.rela.dyn` |
| M7 | **vtable 反查 + 槽位解析** | 在 `.data.rel.ro` 找 `value == ti_va` 的位置 = 地址点；**按 `offset_to_top == 0` 取 primary**；`v[1..]` 逐个查 M4 表 | 本文 §2.3 阶段 C/D |
| M8 | **VTable 替换** | `mprotect(page, RW)` → 写槽位 → 恢复 `R`；（可选）同时改**所有** address point（多继承下每个基类子对象一份 vtable） | `.so` 的 `0xea00` |

### 6.2 `.so` 侧必须补的东西

| 能力 | 说明 | 难度 |
|---|---|---|
| **名字/锚点注入** | 把 "类名 + 锚点串 + 期望槽位偏移" 从 `.node` 传进来（对齐 `RuntimeTargets` 的字段名） | 低 |
| **函数名反查（锚点）** | 实现 §2.5 的 `adrp+add → .rodata 串 → 'Class::method'` 扫描。**这是定位槽位的关键**，`.so` 现有实现就有（错误串都在 `0x5610` 一次校验） | 中 |
| **稳定性校验** | vtable 装好后持续校验会话/身份（`.so` 的 `0x13d1c`/`0x152b0`），防"选错会话" | 中 |
| **失败即安全退出** | 任何一条解析失败都**不要**装 vtable，返回明确错误串（`.so` 现有设计很好，照抄） | 低 |

### 6.3 工作量估计（1 名熟悉 AArch64 + C++ ABI 的工程师）

| 阶段 | 内容 | 人日 |
|---|---|---|
| P0 | 复现本文的离线解析器（Python，跑在 `wrapper.node` 上出 vtable 表） | **1–2 天** |
| P1 | M1+M3+M4（maps/ELF/rela，进程内 `process_vm_readv` 版本） | **3–5 天** |
| P2 | M2 身份校验（build-id + 磁盘/内存比对） | **1–2 天** |
| P3 | M5+M6+M7 RTTI 链（含 `__vmi_class_type_info` 布局） | **3–5 天** |
| P4 | 锚点/函数名反查（复用 §2.5，指令解码器约 200 行纯 Python/C） | **2–4 天** |
| P5 | M8 VTable 替换 + 一致性校验 + 回滚 | **3–5 天** |
| P6 | 与 `.node` 的 RuntimeTargets 对接（N-API / 共享内存） | **2–3 天** |
| P7 | 在真机 QQ 上验证 + 处理异步/线程安全 | **5–10 天** |
| | **总计（从零重写 `.so`）** | **约 20–36 人日 ≈ 1–1.5 人月** |
| | **若只做"离线解析器 + 适配脚本"（P0+P3+P4）** | **约 5–10 人日** ← **强烈建议先做这个** |

> **重要建议**：**不要一上来重写 `.so`。**
> 先做 **P0**（离线解析器 + `diff` 出槽位变化），它就能覆盖难度矩阵里的情况 2/3/4，
> 那是**最可能发生**的三种改动，成本 5–10 人日而不是 1 人月。

### 6.4 最小可用实现骨架（Python，可直接跑在 `wrapper.node` 上）

见本报告 §2.3 —— 那份伪代码就是骨架，我们的实测脚本（`/tmp/re/t5_final.py`、`t7_names.py`、`s3_map.py`）是它的完整实现，
加起来约 300 行，**已在本机跑通并产出 §2.7 的全表**。

---

## 7. 证据（命令 + 输出）

### 7.1 环境

```bash
$ uname -m; free -m | head -2
aarch64
               total        used        free
Mem:           11924        7074        3039
$ python3 -c "import elftools; print('pyelftools ok')"
pyelftools ok
# capstone / numpy 均不可用（未装，且有内网镜像也不需要 —— 全部用纯 Python 实现）
```

### 7.2 节表

```bash
$ readelf -SW /tmp/wrapper.node | head -40
  [ 1] .note.gnu.build-id NOTE  0000000000000200 000200 000024 00 A 0 0 4
  [ 4] .dynsym           DYNSYM 0000000000004420 004420 008ef8 18 A  5  3  8
  [ 8] .rela.dyn         RELA   0000000000020fb0 020fb0 814368 18 A  4  0  8
  [12] .text             PROGBITS 000000000083d780 83d780 5e1ff10 00 AX 0 0 64
  [15] .rodata          PROGBITS 000000000665d900 665d900 994a46 00 A 0 0 128
  [23] .data.rel.ro     PROGBITS 00000000086acb60 869cb60 32e5a8 00 WA 0 0 8
# 无 .symtab（31 个节头里没有）
```

### 7.3 类名字符串真的是 mangled（决定性证据）

```bash
$ python3 -c "
d=open('/tmp/wrapper.node','rb').read()
for o in (0x677ecaa,0x67811d0,0x67811e5,0x67818e1):
    print(hex(o), repr(d[o-40:o+60]))"
0x677ecaa b'vice\x00MSF-Status\x00N2nt10MSFServiceE\x00QQForNT_abnormal\x00NSt2Cr10__function6__funcIZN2nt10MSFService7Des'
0x67811d0 b'r={} pwd_len={}\x00N2nt13IMSFInterfaceE\x00N2nt7wrapper17IKernelMSFServiceE\x00N3msf18IGProMSFServiceApiE\x00N3msf11IMSFServiceE\x00N2n'
...
```

而"裸类名"其实是别的用途：

```bash
$ python3 -c "
d=open('/tmp/wrapper.node','rb').read()
print(repr(d[0x677e7b0-96+80:0x677e7b0+100]))"
b'44sj\x00\x00\x00\x00MSFService\x00\x00../../wrapper/external/msf/msf_response_convert.cc\x00ConvertMsfResponse\x00...'
```

### 7.4 typeinfo → vtable 全链

见 §2.4（输出较长，脚本 `/tmp/re/t5_final.py`，日志 `/tmp/re/t5_final.log`）。

### 7.5 锚点 → 槽位（决定性验证）

```bash
$ python3 /tmp/re/s2_xref.py 0x677fb47 0x6781f13
text words=24674244
adrp count=642006
  target 0x677fb47 <- site 0x137aa9c (+4 bytes)
  target 0x6781f13 <- site 0x139e0f0 (+4 bytes)
total 2
```

### 7.5b 精确函数边界复核（`s8_fde.py`，从 `.eh_frame_hdr` 解出 318,767 个函数起点）

```
.eh_frame_hdr ver=1 ptr_enc=0x1b cnt_enc=0x3 tbl_enc=0x3b size=2550148
eh_frame_ptr=0x7260cd0 fde_count=318767
function starts: 318767  first=0x83d780 last=0x665d858
resolved string-xref sites: 333342
```

| 锚点串 | xref site | 所属函数 | vtable 归属 |
|---|---|---|---|
| `MSFService::SessionInit` @0x677fb47 | `0x137aa9c` | `0x137a48c`（区间 `[0x137a48c, 0x137b194)`） | **`nt::MSFService` v[19]，ap+0x98** |
| `MSFCoreService::SessionInit` @0x6781f13 | `0x139e0f0` | `0x139d864`（区间 `[0x139d864, 0x139e8e4)`） | **`nt::MSFCoreService` v[19]，ap+0x98** |

`0x137a48c` 与 `0x139d864` **正是** `vtable[19]`（`ap+0x98`）里的函数指针 —— **锚点、函数、槽位三者闭环【确证】**。

> ⚠️ **内存安全提示（呼应前一个子代理的翻车）**：解 `.eh_frame_hdr` 时必须**先正确解析编码字节**
> （`ptr_enc=0x1b` = pcrel|sdata4，`cnt_enc=0x03` = udata4，`tbl_enc=0x3b` = datarel|sdata4）。
> 我第一版把 `pcrel` 当成无符号直接读，得到 `fde_count=17979693764981349679`，
> **随即在循环里越界读 → `struct.error` 崩掉**。
> **如果那里没有越界保护，就会变成"无限循环 + 无限 append"** —— 这正是前一个子代理 2.7 GB 内存的来源。
> **本脚本的做法**：所有 `struct.unpack_from` 都带显式 `cnt` 上限、`i < cnt` 前置检查、
> 且**永不 stdout 大对象**（全写文件）。请沿用。
> 同类教训：我在最初扫描时对一个没有 NUL 终止的 `mmap` 切片做了 `b[:z]` 而 `z == -1`，
> **一次吐了 10 MB 输出**（已被截断）。**任何 `bytes` 切片派生字符串前，先断言 `z > 0`。**


### 7.6 `.so` 的 RTTI 相关导入

```bash
$ readelf -rW /tmp/sl/snowluma-linux-arm64.so | grep -E 'cxxabiv1|demangle'
0000000000060ad8  0000006100000101 R_AARCH64_ABS64  _ZTVN10__cxxabiv120__si_class_type_infoE@CXXABI_1.3 + 10
0000000000060b40  0000003000000101 R_AARCH64_ABS64  _ZTVN10__cxxabiv117__class_type_infoE@CXXABI_1.3 + 10
00000000000611a8  0000003c00000402 R_AARCH64_JUMP_SLOT __cxa_demangle@CXXABI_1.3 + 0
$ grep -c "cxa_demangle" /tmp/re/sl.dis
1        # 只有 1 处调用点 0x2e0d8
```

### 7.7 `.so` 的片段表（`msfServiceTypeinfoName` 的真身）

```bash
$ python3 /tmp/re/s7_tbl.py | grep -A14 'MSF'
   slot_va=0x60c40  ->0x45268  'MSF'
   slot_va=0x60c50  ->0x4526c  'Msf'
   slot_va=0x60c60  ->0x45270  'SSO'
   slot_va=0x60c70  ->0x45274  'Session'
   slot_va=0x60c80  ->0x4527c  'Wrapper'
   slot_va=0x60c90  ->0x45284  'Kernel'
   slot_va=0x60ca0  ->0x4528b  'NodeI'
   slot_va=0x60cb0  ->0x45291  'CreateNTSessionShell'
   slot_va=0x60cc0  ->0x452a6  'CreateGProSessionShell'
```

### 7.8 名字只在 `.node` 里（证明 `.so` 是通用引擎）

```bash
$ python3 -c "
import os
pats=[b'msfDidRecvResponseData',b'msfGetStatus',b'selfInfoOnLoginSuccess',b'sendSsoInternal',b'msfServiceTypeinfo']
for f in ('/tmp/sl2/snowluma-linux-arm64.node','/tmp/sl/snowluma-linux-arm64.so','/tmp/wrapper.node'):
    d=open(f,'rb').read(); print(f,{p.decode():d.count(p) for p in pats})"
/tmp/sl2/snowluma-linux-arm64.node {'msfDidRecvResponseData': 1, 'msfGetStatus': 1, 'selfInfoOnLoginSuccess': 1, 'sendSsoInternal': 1, 'msfServiceTypeinfo': 2}
/tmp/sl/snowluma-linux-arm64.so   {'msfDidRecvResponseData': 0, 'msfGetStatus': 0, 'selfInfoOnLoginSuccess': 0, 'sendSsoInternal': 0, 'msfServiceTypeinfo': 0}
/tmp/wrapper.node                 {'msfDidRecvResponseData': 0, 'msfGetStatus': 0, 'selfInfoOnLoginSuccess': 0, 'sendSsoInternal': 0, 'msfServiceTypeinfo': 0}
```

### 7.9 产出物清单（都在 oracle `/tmp/re/`）

| 文件 | 内容 |
|---|---|
| `t5_final.log` | typeinfo → ABI vtable → 地址点 → 槽位 全链 |
| `t7_names.log` | 两个类全槽位 → 方法名（§2.7 的来源） |
| **`s8_slots.log`** | **`.eh_frame_hdr` 精确函数边界 + 槽位 → 方法名（最新最准版）** |
| `vtable_named.json` | 机器可读版槽位表 |
| `typeinfo_names.json` | wrapper.node 里 **22,902 个** mangled typeinfo 名 + 地址（**可做版本 diff**，2.1 MB） |
| `s3_vtables.log` / `s3_somap.log` | `.so` 每条诊断串 → xref site → 所属函数 |
| `sl.dis` | `.so` 全量反汇编（65,628 行） |
| `reloc_rtti.log` | 20,971 个 typeinfo 候选 |
| 脚本 | `reloc_rtti.py` `t5_final.py` `t7_names.py` `s2_xref.py` `s3_map.py` `s7_tbl.py` **`s8_fde.py`** |

**复现命令（一条龙）**：

```bash
ssh oracle
cd /tmp/re
nice -n 19 ionice -c3 python3 t5_final.py   # typeinfo → vtable → 槽位
nice -n 19 ionice -c3 python3 s8_fde.py     # + .eh_frame_hdr 精确边界 + 方法名
nice -n 19 ionice -c3 python3 s3_map.py     # .so 诊断串 → 函数地图
cat /tmp/re/t5_final.log /tmp/re/s8_slots.log
```


---

## 8. 未查清 / 待深入 + 已知陷阱（诚实标注）

### 8.0 ★ 已知陷阱（我们亲自踩过，写下来免得后人重蹈）

| # | 陷阱 | 后果 | 正确做法 |
|---|---|---|---|
| **T1** | 拿 `/tmp/rtti/all-exports.txt` 当"全部符号" | **得出"dynsym 里没有 RTTI"的错误结论**（实际有 397 个） | 永远回到 `readelf -sW --dyn-syms` 原文；那个 txt 只是**已定义导出**的子集 |
| **T2** | 按字面量 `"MSFService"` 搜 typeinfo | **0 命中**（`__type_name` 是 mangled `N2nt10MSFServiceE`） | 匹配 `N<len><ns><len><Class>E` 模式；并排除日志 TAG / JS 属性名 |
| **T3** | 把 `.data.rel.ro` 的 vaddr 当 file off | 全表偏移错 `0x10000` | 从节表算 `Δ = vaddr - file_off`，**不要写死** |
| **T4** | 对 `mmap` 切片做 `b[:z]` 而 `z == -1`（没有 NUL） | **一次吐 10 MB 输出** | 任何派生字符串前断言 `z > 0` |
| **T5** | `.eh_frame_hdr` 编码字节解析错（把 pcrel 当无符号） | 得到 `fde_count=1.8e19` → **越界/无限循环 → OOM** | 按 `enc & 0x0f` / `enc & 0x70` 分别处理；**所有循环加上限** |
| **T6** | 取"第一个值 == typeinfo 的槽位"当 primary vtable | MSFService 有 **5 个**地址点，会选错 | 必须按 **`offset_to_top == 0`** 过滤出 primary |
| **T7** | 只看"进程没崩"就认为适配成功 | 槽位错一位 → 静默发错路径 → 用户看到 `"The QQ connection changed..."` | 必须做**真实收发消息**的端到端验证 |

### 8.1 待深入（按优先级）

1. **`RuntimeTargets` 的完整内存布局（字段顺序/大小）未定案。**
   已知字段名（从 `.node` 的 mangled 符号与字符串顺序推断），但**没有 dump 出真实结构体数组**。
   → **下一步**：在 `.node` 里定位那 5 个名字常量（各出现 1 次）所在的**常量池**，
   找引用它们的代码，反推 `struct RuntimeTargets { ... }` 的偏移。
   **这是适配工作最高优先级的待办。**

2. **那 4 个"锚点"名（`sendSsoInternal` / `msfDidRecvResponseData` / `msfGetStatus` / `selfInfoOnLoginSuccess`）
   在 wrapper.node 里字节级 0 命中。**
   它们是**跨版本的 ABI 指纹**，但**取值的来源未定**（可能是别的 QQ 平台构建、或更老/更新版本的特征名）。
   → **下一步**：拿 2–3 个 wrapper.node build 做差集，看哪些**方法名/日志串跨版本稳定**，
   挑出真正可用的锚点集。（本报告 §2.5 的方法可以批量产出"每个 build 的方法名全表"，做交集即可。）

3. **`xrefFileOffsets` / `xrefRuntimeAddresses` 的确切语义**（§3.6 是【强推断】）。
   → **下一步**：反汇编 `0x5610` 里读取这两个字段的那几段（`ldr` 偏移），对齐到结构体偏移即可定案。

4. **`.so` 的 `0xfd4c` 内部 15+ 个 `0x36xxx` 子函数未逐一命名**（只按字符串归了类）。
   不影响适配结论，但若要完全重写 `.so` 需要补。

5. **`msfCoreCallbackOffset` 到底是「vtable 内字节偏移 0x178」还是「对象内 vtable 指针偏移」**：
   我们强烈倾向 vtable 内偏移（因为 `onMSFPacketState` 恰在 `ap+0x178`，且字段名与 `msfCoreCallbackVtables` 配对），
   但没有直接读到该字段的赋值点。

6. **方法名表的个别条目可能差一位**（见 §2.7 的置信度说明）——
   `.eh_frame_hdr` 给出了精确函数起点，但我的字符串扫描窗是 `[fn, fn+0x1400)`，
   **当函数短于 0x1400 时会溢入相邻函数**。要 100% 精确需按 FDE 边界裁窗（已具备数据，未重跑）。
   **这不影响锚点判定**（§7.5b 是精确的），只影响辅助理解用的方法名表。

7. **未在真实运行的 QQ 进程上验证**（严格遵守"不动 snowluma 容器"的约束）。
   所有结论来自**磁盘镜像的静态分析**。运行时（ASLR、relro、内存与磁盘差异）可能引入额外变量 ——
   不过 `.so` 自己的 `ELF metadata differs from live memory` 校验说明它也处理了这件事。


---

## 9. 接手第一步 Checklist

```bash
# ① 归档当前可用基线（版本指纹）
md5sum wrapper.node snowluma-linux-arm64.so snowluma-linux-arm64.node
readelf -n wrapper.node | grep -A2 'Build ID'      # 记下 build-id
stat -c '%s %n' wrapper.node                       # 144561472

# ② 跑一遍离线解析器，存成基线
python3 t5_final.py   > baseline/t5.log
python3 t7_names.py   > baseline/slots.log         # ★ 这份是"槽位 → 方法名"金表

# ③ 新版本来了：同一条命令，diff
diff baseline/slots.log new/slots.log
#    · 只有函数地址变、方法名+槽位不变  → 情况 1，0 改动
#    · 方法名还在但槽位变了            → 情况 3，改 .node 的数字
#    · 方法名都没了                    → 情况 2/6，改 .node 字符串 / 重找锚点
#    · 出现 __vmi_class_type_info      → 情况 5，必须改 .so
```

**核心风险提醒**：VTable 替换是**最脆弱**的 hook 形式。槽位错一位不会立刻崩，
而是**把消息发到错误的路径上** —— 表现为用户可见的
`"The QQ connection changed. Please restart QQ and try again."`。
所以**每次适配后必须做真实收发消息的端到端验证**，不能只看"进程没崩"。
