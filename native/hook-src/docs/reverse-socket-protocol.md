# 逆向报告：`snowluma-linux-x64.so` 的 socket 路径推导与 40 字节帧协议

目标文件：`/home/ubuntu/x64run/native/snowluma-linux-x64.so`
（ELF64 DYN，x86-64，stripped，425,216 字节）

分析手段与边界：

- 只用 `objdump` / `readelf` / `nm` / `strings` / 手写 Python。
- 本机没有 gdb、radare2、Ghidra，**目标 `.so` 未被加载、未被执行**。
- `/home/ubuntu/x64run/native/` 下所有文件**只读**，没有改动。
- 全部脚本在 `/home/ubuntu/hook-rewrite/re/` 下，文档在本文件。
- 函数边界来自 `.eh_frame_hdr` 的 435 个 FDE（脚本 `re/fdes.py`），
  产物 `re/funcs.txt`（`起始地址 长度`，均为十六进制）。这是本文引用
  "某函数从 X 到 Y" 的唯一依据。
- 反汇编全文在 `re/dis/full.asm`（`objdump -d -M intel --no-show-raw-insn`）。
  下文所有 `0xADDR` 都能在这份文件里按行检索到。

标注约定：

- 无标记 = 从指令直接读出、可复现的事实。
- **【推测】** = 有证据支持但存在未排除的替代解释。
- **【未确定】** = 证据不足，本文不给结论。这类结论**不允许**被下游当成已知条件。

---

## 0. 结论摘要

1. **socket 路径不是扫出来的，也不是 `readlink` 出来的。** 三段环境变量/回退链，
   加一个十进制 pid，拼成固定模板。全二进制里只有一处 `readlink`、一处
   `opendir`，都服务于别的事（`/proc/self/maps` 解析），与 socket 无关。
2. 所有敏感字面量（`SNOWLUMA_HOOK_RUNTIME_DIR`、`XDG_RUNTIME_DIR`、
   `/tmp/snowluma-`、`/mojo.`、`.sock`）都是**混淆存放**的：`.rodata` 里是随机
   字节，运行时由**一段一函数的专用解码器**解开。所以 `strings` 抓不到 ——
   这不是"字符串不存在"，而是"字符串不以明文存在"。
   `control` / `recv` 两个通道名**是明文**（`0x570b6` / `0x570be`）。
3. **40 字节帧头布局与 `docs/payload-protocol.md` 的声明完全一致，逐字段对上**，
   包括 `flags@16` 是 `u32`（不是 `u16`）、`value0@32` 是 `u64`。
   长度上限 `cmd<=4096` / `msg<=65536` / `body<=16MiB` 也在接收侧逐条校验。
4. 出站 op 码实测到 **1、3、4、5、6、7、21、22**，与 `payload-protocol.md` 的
   表一致。入站（Node→载荷）只接受 **op 2** 和 **op 17**，其余在接收循环里
   直接丢弃并回收帧 —— **这是本文新给出的、之前文档里没有的一条约束**。
5. **载荷对每个新连接主动发一次 op 1（hello）**，在 accept 之后、进入主接收
   循环之前就发，不等对端先发。两个通道（control / recv）都如此。
   hello 的 `msg`=本通道 socket 路径、`value0`=目标 pid、`status`=通道标识
   （control=0，recv=2）。

---

## 1. socket 路径推导

### 1.1 基目录：`0xe8f0`（长度 0x3a2，止于 0xec92）

这是唯一的"运行时目录"决策点，只被 `0xeca0` 的 `0xecd3` 调用一次。

| 步 | 指令地址 | 动作 | 解码出的字面量 |
|---|---|---|---|
| 1 | `0xe90d` `call 1d820` → `0xe91a` `call getenv@plt` | 取 `SNOWLUMA_HOOK_RUNTIME_DIR` | `SNOWLUMA_HOOK_RUNTIME_DIR` |
| 2 | `0xe9a7` `call 1df50` → `0xe9b4` `call getenv@plt` | 取 `XDG_RUNTIME_DIR` | `XDG_RUNTIME_DIR` |
| 3 | `0xea4a` `call 1e560` → `0xea4f` `call getuid@plt` | 回退前缀 + 十进制 uid | `/tmp/snowluma-` |

非 NULL 且非空即采用，否则落到下一级。第三级把 `getuid()` 的十进制结果
接在 `/tmp/snowluma-` 后面，即 `/tmp/snowluma-<uid>`。

### 1.2 五个混淆字符串的解码证据

解码器有**两种签名**，必须分清，否则解出来是垃圾：

| 类型 | 签名 | 本文涉及的函数 |
|---|---|---|
| **A** | `decode(std::string* out /*rdi*/, const char* src /*rsi*/)` | `0x1d820` `0x1df50` `0x1e560` `0x1cc40` `0x1d3f0` |
| **B** | `decode(const char* src /*rdi*/, std::string* out /*rsi*/, uint64_t* state /*rdx*/)` | `0x1eb10` `0x1ed60` |

A 类开头是 `mov esi,<len>` + `call _M_constructEmc` 给 `out` 定长，然后逐字节
`out->ptr[i] = cl`，滚动状态内联在 `movabs` 常量里。B 类第一条指令就是
`mov r8b,BYTE PTR [rdi+N]`（直接从 `src` 取字节），滚动状态存在 `*rdx` 那个槽里，
所以**每次调用都必须重新写种子** —— 这就是为什么不能把 B 类当常量表。

我用 `re/dec5.py`（自写 x86-64 迷你解释器，会递归跟进嵌套 `call`）在
**不执行 .so** 的前提下逐条重现，得到：

| 解码器 | 区间 | 源地址 | 长度 | 解出 |
|---|---|---|---|---|
| `0x1d820` | `0x1d820`–`0x1df44` | `0x57bd9` | `0x19`=25 | `SNOWLUMA_HOOK_RUNTIME_DIR` |
| `0x1df50` | `0x1df50`–`0x1e29b` | `0x57bf2` | `0xf`=15 | `XDG_RUNTIME_DIR` |
| `0x1e560` | `0x1e560`–`0x1e8b0` | `0x57c01` | `0xe`=14 | `/tmp/snowluma-` |
| `0x1eb10` | `0x1eb10`–`0x1ed52` | `0x57c0f` | 6 | `/mojo.` |
| `0x1ed60` | `0x1ed60`–`0x1ef82` | `0x57c16` | 5 | `.sock` |

`0x1eb10` / `0x1ed60` 的种子分别是 `0xb0ff16b3120d4999`（`0xecfc`/`0xed06` 写
`[rsp+0x48]`）与 `0x078057181ff3e666`（`0xf1b6` 同址）。

全部 7 个字符串的机器可验版本：

```bash
cd /home/ubuntu/hook-rewrite/re && python3 dec5.py
# PASS SNOWLUMA_HOOK_RUNTIME_DIR / XDG_RUNTIME_DIR / /tmp/snowluma- /
#      SNOWLUMA_HOOK_SERVICE_MODE / in-process / /mojo. / .sock   → ALL PASS
```

最小复现（A 类，`0x1d820`）：

```python
import sys, struct; sys.path.insert(0,'/home/ubuntu/hook-rewrite/re')
import emu
D = open('/home/ubuntu/x64run/native/snowluma-linux-x64.so','rb').read()
mem = {0x57bd9+i: D[0x57bd9+i] for i in range(25+96)}
for i,b in enumerate(struct.pack('<Q',0x1010)):   # <<< 必须写满 8 字节
    mem[0x1000+i] = b
out,_ = emu.decode_custom(0x1d820, 0x1df44,
                          {'rdi':0x1000, 'rsi':0x57bd9},
                          mem, outbuf=0x1010, outlen=25)
print(bytes(out))   # b'SNOWLUMA_HOOK_RUNTIME_DIR'
```

> `0x1df50` 与 `0x1e560` 的尾部会 `call` 续接函数（`0x1e271` → `0x1e2a0` 等）
> 继续吐后面的字节。`emu.decode_custom` **不跟进 `call`**，所以对这两个只能
> 解出前 8 个字符（`XDG_RUNT`）。完整解码要用 `dec5.py`。
> 详见 §5.1 / §5.2。

另外两个混淆串（不属于路径，但同属该机制，顺带记录）：

| 解码器 | 区间 | 源地址 | 长度 | 解出 | 用途 |
|---|---|---|---|---|---|
| `0x1cc40` | `0x1cc40`–`0x1d3e5` | `0x57bb5` | `0x1a`=26 | `SNOWLUMA_HOOK_SERVICE_MODE` | 环境变量名 |
| `0x1d3f0` | `0x1d3f0`–`0x1d6b3` | `0x57bcf` | `0xa`=10 | `in-process` | 该变量的取值 |

这两个在 `0xd4c0`（一个 `fork` 出来的看守线程本体）里被使用：`0xd504` 解码变量名
→ `0xd510` `getenv` → `0xd539` 解码期望值 → `0xd548` `strcmp`。相等时走
`0xd5a2` 分支，用 `getpid()` + `start_dynamic(pid, 1)`（`0xd5ae`）；
不等时 `fork`（`0xd567`）、子进程 `prctl(PR_SET_PDEATHSIG=1, SIGTERM=0xf)`
（`0xd57c`）、校验 `getppid()==原pid` 后调 `start_dynamic(pid, 0)`（`0xd58e`）。
**这是"in-process vs 子进程"两种运行模式的开关**，与 socket 路径无关，但它解释了
为什么 `start_dynamic` 的第一个参数是 pid、第二个是模式。

### 1.3 路径拼接：`0xeca0`（长度 0x845，止于 0xf4e5）

调用点只有两个，都在 `0xe1d0`（即导出符号 `snowluma_linux_hook_start_dynamic`
的真实实现，长度 0x715）内：

- `0xe41e` `lea rsi,[rip+0x48c91]` → `0x570b6` = `"control"`（明文）
  → `0xe42a` `call eca0`
- `0xe507` `lea rsi,[rip+0x48bb0]` → `0x570be` = `"recv"`（明文）
  → `0xe513` `call eca0`

`0xeca0` 内部顺序：

| 顺序 | 位置 | 动作 | 字面量/来源 |
|---|---|---|---|
| 1 | `0xecb7`–`0xecc8` | 取 pid：全局 `[0x68c0c]`，若 `<=0` 则 `call getpid@plt` | — |
| 2 | `0xecd3` | `call e8f0` 取基目录 | §1.1 |
| 3 | `0xed1f` | `call 1eb10` 解码前缀，随后 `_M_appendEPKcm`（`0xedac`） | `/mojo.` |
| 4 | `0xee91` 起 | 十进制 pid：除 10 取余，数字表 `0x57d10`（`"0001020304..."`，双字节一组） | pid |
| 5 | `0xf011` | 单字节内联解码：`[0x57c15]` = `0xf0` → 见下 | `"."` |
| 6 | `0xf08f` `_M_appendEPKcm` | 追加传入的通道名 | `control` / `recv` |
| 7 | `0xf1df` `call 1ed60`，随后 `0xf24f` `_M_appendEPKcm` | 追加后缀 | `.sock` |

`0xf011` 那个分隔符是就地算的，不进 `std::string`：
`mov al,[0x57c15]` → `add al,0x4b` → `rol al,3` → `xor al,0xf7`，
`0xf0+0x4b=0x3b`，`rol8(0x3b,3)=0xd9`，`0xd9^0xf7=0x2e` = `'.'`。
（这条**不是**共享字符串表的成员，是唯一一处针对单个字符的独立编码。）

最终结构（高置信，因为每段的追加顺序在指令流里是线性的）：

```
<base>/mojo.<pid>.<channel>.sock
```

`<channel>` ∈ {`control`, `recv`}，两个名字**独立完整构造**，不是"control 改后缀
得到 recv"的派生关系。

以本机 `XDG_RUNTIME_DIR=/run/user/1000`、pid=3012065 为例：

```
/run/user/1000/mojo.3012065.control.sock
/run/user/1000/mojo.3012065.recv.sock
```

### 1.4 结果存放与导出

| 全局 | 内容 |
|---|---|
| `[0x684c8]` / `[0x684d0]` | control 路径指针 / 长度 |
| `[0x684e8]` / `[0x684f0]` | recv 路径指针 / 长度 |

写入点是 `0xe42f`–`0xe4de`（control，`std::string` 移动+`memcpy`+补 `\0`）和
`0xe518`–`0xe5c2`（recv，同构）。

导出符号（`0xe1b0` / `0xe1c0`）分别返回 `[0x684c8]` 与 `[0x684e8]` —— 这是给
注入器读回路径用的，所以**路径本身是可信的外部接口**。

### 1.5 "有目录扫描吗？" —— 明确的否定结论

用户列的嫌疑函数，全库逐一核对调用点与上下文：

| 函数 | 调用点 | 实际用途 |
|---|---|---|
| `readlink` | 仅 `0x4c255` | `resize(0x1000)` 后读链接，属于 `0x4bxxx`–`0x4cxxx` 的 `/proc` 相关解析，与 socket 无关 |
| `opendir` / `readdir` / `closedir` | `0x4805b` / `0x480c5` / 见 `0x49ff8` | 硬编码打开 `"/proc"`（`0x58ff0`），遍历进程目录 |
| `sscanf` | `0x4aa6a`、`0x4ae1a` | 两处格式串都是 `0x5900f` = `"%x:%x"` —— 解析 `/proc/self/maps` 的行 |
| `snprintf` | 仅 `0x48ed` | 在 `/proc` 枚举里拼错误消息，与路径无关 |

同一区域的 `.rodata` 佐证：`/proc/self/maps` @`0x5785e`、`/opt/QQ/` @`0x578b9`、
`cannot enumerate /proc: ` @`0x59005`。

> **结论：socket 路径只有 §1.1 那一条链。没有扫目录、没有读进程 `/proc/<pid>/environ`、
> 没有 `readlink` 兜底。** 这一点很重要：意味着路径完全由**载荷自己进程**的环境
> 决定，注入器给不了、也不需要给。

**【推测】** 载荷不读 `/proc/<pid>/environ` 是设计使然 —— 它本身就在目标进程里跑，
`getenv` 是直接的；而 Node 侧（`resolveHookRuntimeDir`，见
`docs/socket-naming.md`）需要跨进程读 environ 才能拿到同一组变量。这条
与 `docs/socket-naming.md` 的描述一致，可以作为交叉印证。

### 1.6 目录创建与清理

- `0xe3f8` `call e8f0` → `0xe402` `mkdir(path, 0x1c0)` = `mkdir(..., 0700)`。
  `0xe40c` 失败时 `0xe415` 比较 `errno` 与 `0x11`（`EEXIST`），相等则视为成功继续。
  **即：载荷自己创建 runtime 目录，权限 0700。**
- 清理：`0xe7f7`/`0xe801` 与 `0xe80d`/`0xe817` 在长度非 0 时分别
  `unlink(control)`、`unlink(recv)`；随后 `0xe823`/`0xe82a` 复位两个状态字节
  `[0x68c08]=0`、`[0x68c09]=1`。这一段是 `start_dynamic` 的失败回滚路径。

---

## 2. 40 字节帧协议

### 2.1 序列化端：`0x1f180`（止于 `0x1f2ae`）

唯一构造帧头的地方。帧头就地建在 `[rsp+0x8]`，然后交给
`0x1f2d0`（`std::vector` 的 append-range）整体拷出去：

| 指令 | 写入 | 相对帧头偏移 | 宽度 | 值 |
|---|---|---|---|---|
| `0x1f198` | `[rsp+0x8]` | **0** | u32 | `0x31504851`（`"QHP1"` 小端） |
| `0x1f1a0` | `[rsp+0xc]` | **4** | u16 | `0x1` |
| `0x1f1a7` | `[rsp+0xe]` | **6** | u16 | `si`（第 2 参数 → op） |
| `0x1f1ac` | `[rsp+0x10]` | **8** | u32 | `edx`（第 3 参数 → requestId） |
| `0x1f1b0` | `[rsp+0x14]` | **12** | u32 | `ecx`（第 4 参数 → status） |
| `0x1f1b4` | `[rsp+0x18]` | **16** | u32 | `r8d`（第 5 参数 → flags） |
| `0x1f1b9` | `[rsp+0x28]` | **32** | u64 | `r9`（第 6 参数 → value0） |
| `0x1f1c3` | `[rsp+0x1c]` | **20** | u32 | `r13d`（栈参数 1 → cmd 长度） |
| `0x1f1cd` | `[rsp+0x20]` | **24** | u32 | `r15d`（栈参数 2 → msg 长度） |
| `0x1f1d2` | `[rsp+0x24]` | **28** | u32 | `r14d`（栈参数 3 → body 长度） |

总分配量：`0x1f1e5`–`0x1f1ec`
`rbx = r14 + r13 + r15 + 0x28`，`js` 溢出检查，随后 `_Znwm(rbx)`。
**`0x28` = 40，即"头 40 字节 + 三段紧排、无填充、无对齐"。**

三段追加顺序（`0x1f22a` / `0x1f24b` / `0x1f26c`，各自先判长度非 0）：

1. `[rsp+0x60]` = `cmd`  → `+40`
2. `[rsp+0x70]` = `msg`  → `+40+cmd_len`
3. `[rsp+0x80]` = `body` → `+40+cmd_len+msg_len`

即 `cmd → msg → body`，与 `payload-protocol.md` 一致。

**帧头字段核对结论：与 `docs/payload-protocol.md` §1 的结构体逐字段一致。**
值得单独点出的是 `flags@16` 是 **`u32`**（`mov DWORD PTR [rsp+0x18],r8d`），
不是某些实现里误用的 `u16`；`value0@32` 紧跟在 `body_len@28` 之后，
**中间没有 4 字节空洞**（`0x1f1b9` 写的 `0x28` 就是 `+32`）。

### 2.2 接收端：`0x11090`（长度 0x2776，每个连接一个线程）

线程入口由 `0xf5d0` 的 `0xfb2c` `lea rdx,[rip+0x155d]` → `0x11090` 指定，
经 `pthread_create`（`0xfb33`）拉起。每个 accept 到的连接一个线程。

**收头（`0x11644`–`0x11673`）**：循环 `recv(fd, buf+rbx, 40-rbx, 0)`，
直到 `rbx >= 0x28`。`ECONNRESET` 之外，`recv` 返回 0 直接跳到 `0x13321`
（连接收尾并关闭）。

**校验（`0x11675`–`0x116c5`）**：

| 指令 | 检查 | 失败去向 |
|---|---|---|
| `0x11675` `cmp DWORD [rsp+0x140],0x31504851` | magic @0 | `0x13321` |
| `0x11686` `cmp WORD [rsp+0x144],0x1` | version @4 | `0x13321` |
| `0x1169c` `cmp rsi,0x1000` / `ja` | cmdLen @20 <= 4096 | `0x13321` |
| `0x116a9` `cmp DWORD [rsp+0x158],0x10000` / `ja` | msgLen @24 <= 65536 | `0x13321` |
| `0x116ba` `cmp DWORD [rsp+0x15c],0x1000000` / `ja` | bodyLen @28 <= 16 MiB | `0x13321` |

帧基址是 `[rsp+0x140]`，所以 `[rsp+0x154]`=`+20`、`[rsp+0x158]`=`+24`、
`[rsp+0x15c]`=`+28`、`[rsp+0x146]`=`+6`(op)、`[rsp+0x148]`=`+8`(requestId)、
`[rsp+0x150]`=`+16`(flags)、`[rsp+0x160]`=`+32`(value0)。
**偏移与 §2.1 的写入侧完全自洽** —— 两侧独立印证，这是布局可信的核心依据。

**收三段正文**：`0x116d5` / `0x116eb` 先 `std::string::resize` 到
`cmdLen`(@`[rsp+0x168]`) 与 `msgLen`(@`[rsp+0x188]`)；
`0x116f0` 起对 body 直接 `resize` 到 `bodyLen`(@`[rsp+0x1a8]`/`[rsp+0x1b0]`)。
三个独立 `recv` 循环：`0x11771`（cmd）、`0x117c4`（msg）、`0x1181c`（body）。
每个都是"读数 `< 目标` 就继续，`EINTR` 重试，返回 0 即断链"。长度 0 的段直接跳过。

> 注意：**校验发生在收正文之前**，所以超长帧不会先吃掉 16MB 才被拒。

### 2.3 入站 op 码：只接受 2 和 17

`0x11834`–`0x1184a`：

```
0x11834  movzx eax, WORD PTR [rsp+0x146]    ; op
0x1183c  cmp   ax, 0x11                      ; 17
0x11840  jge   0x11a11
0x11846  cmp   ax, 0x2                       ; 2
0x1184a  jne   0x113a0                       ; ← 其它一律退出并回收
```

- `0x11a11` 处的 `jne 0x113a0` 是 `jge` 的补齐判定：**`op != 17` 就丢弃**。
  即 `op >= 17` 且 `op != 17` 同样被拒。
- 所以接收侧的白名单是 **{2, 17}**，其余全部丢帧。

**op 2（请求）**：`0x11850` `mov eax,[rsp+0x150]`（flags@16）存到
`[rsp+0xfc]`，然后 `0x1185e` 起构造一个 `std::string`（`0x2a` = 42 字节，
内容来自 `0x578e5`/`0x578f5`/`0x578ff` 三段拼接：
`"Linux runtime targets are not resolved yet"`），加锁 `[0x68c60]`
后从全局 `[0x68508]` 拷一份状态，最后在 `0x11939`–`0x11c69` 回一个
**op = 3 的 ACK**（`0x11c57` `mov esi,0x3`），`flags` 回填 `[rsp+0xfc]`，
`requestId` 回填 `[rsp+0x148]`。

> **【推测】** 这段"Linux runtime targets are not resolved yet"是 op 2 请求处理
> 时的一个固定错误消息（`0x11949` 长度 `0x2a`=42）。它出现在请求分支里且是
> 常量，最合理的解释是"该平台/该版本不支持处理这类请求，直接回 ACK 并把这条
> 消息作为 msg 回给 Node"。我**没有**在二进制里找到"runtime targets 被解析成功"
> 的反向分支，所以**无法确定**是否还有成功路径。下游不要假设 op 2 会被真正执行。

**op 17**：`0x11a17` `mov rax,[rsp+0x160]`（value0@32），随后
`0x11a1f`–`0x11a34` 做一次范围检查：

```
movabs rdx, 0xffffffff00000000
lea    rcx, [rax+rdx]        ; rcx = value0 - 2^32
add    rdx, 0x2710           ; rdx = 0xffffffff00002710
cmp    rcx, rdx
jae    0x11ab4               ; 合法 → 走正常分支
```

`0xffffffff00002710 - 0xffffffff00000000 = 0x2710 = 10000`，所以
**要求 `value0 - 2^32 < 10000`**，即 `value0 ∈ [2^32, 2^32+10000)`。
不满足（`0x11a41` 分支）就用 `ECX = 0xffffffea` = **-22（`EINVAL`）**、
op=5 回一个错误帧，`msg` 是 `0x571a7` 的 27 字节 `"invalid login identity hint"`。

满足时（`0x11ab4`）用 `xchg` 更新全局 `[0x68d48]`，值变了就清
`[0x68c28]`/`[0x68c29]` 并重算一个 `steady_clock` 超时（`+0xea60`=60000ms，
即 60 秒），然后 `0x11afe` 起构造一个 `0x298` 字节的对象（`memset` 清空 +
字段初始化）继续处理。

> **【推测】** op 17 是"登录身份提示"（login identity hint）—— 依据是失败时
> 用的错误消息字面量 `"invalid login identity hint"` 和 `value0` 被约束在
> `2^32..2^32+10000` 这个窄窗口（很像一个"句柄/序号"而不是指针或 UIN）。
> 但 Go 侧（`payload-protocol.md`）的 op 表里**没有 op 17**，所以这很可能是
> **Node→载荷方向的一个内部扩展**，不在公开协议内。**具体语义未确定。**
> 可以确定的是：载荷会**校验它的 `value0` 落点**，落在窗口外就是 `EINVAL`。

### 2.4 出站 op 码（实测表）

从指令流里把每个"写 `esi,<op>` 后紧跟 `call 14110`（高层发送）或
`call 14760`（直接发送）"的站点全部抓出来：

| op | 站点 | 所在函数 | 语境 |
|---|---|---|---|
| **1** | `0x13ab6` | `0x13a30` | **hello 回复**：`esi=1`，`ecx`(status)=`[obj+4]*2`，`r9`→`value0`=pid，msg=本通道路径 |
| **3** | `0x11c64` | `0x11090` | op 2 请求的 ACK |
| **3** | `0x1212f` | `0x11090` | ACK（带 `flags`=`[rsp+0xfc]`） |
| **3** | `0x13235` | `0x11090` | ACK（带 `flags`） |
| **4** | `0x121a6` | `0x11090` | 应答 |
| **4** | `0x1bc10` | `0x1ba60` | 应答（`requestId`=`[rsp+0x28]`，status=`[rsp+0x2c]`） |
| **5** | `0x11aaa` | `0x11090` | 错误，`ecx=0xffffffea`(EINVAL) |
| **5** | `0x132fc` | `0x11090` | 错误（4 种候选消息，见下） |
| **5** | `0x1bc89` | `0x1ba60` | 错误，`ecx=0xffffffda`(=-38, `ENOSYS`) |
| **5** | `0xfeda` | `0xfcd0` | 错误 |
| **5** | `0x13b86` | `0x13a30` | 错误，status=`-ebx`（把内部错误码取负转成 errno 风格） |
| **6** | `0x1a72c` | `0x1a590` | **QQ 数据包**：`esi=0x6`，`requestId=r14d`，`status=0`，`flags=r13`，value0=`rbp` |
| **7** | `0x1470c` | `0x14560` | **登录状态**：`esi=0x7`，`ecx=4`（`PipeFlagLoggedIn`，**常量**），`r8=r15`，msg=uin 文本 |
| **21** | `0x1a341` | `0x19f90` | **客户端私聊回执**：`esi=0x15`，`requestId=r15d`，`status=0`，`flags=r12`，value0=`r14` |
| **22** | `0x17316` | `0x17130` | **私聊能力探测结果**：`esi=0x16`，`requestId=r12d`，`status=0`，`flags=r14`，value0=`r15` |
| **22** | `0x13c08` | `0x13a30` | 条件分支：`[r14]` 的 `value0` 非零时先发 op 22，再发 op 5 错误 |

`0x132fc` 那条 op 5 前面有一小段状态分派（`0x1323f`–`0x1329c`），按
`[rsp+0x68]` 的取值（0/1/2/3）选不同消息字符串，长度分别是
`0x39`/`0x38`/`0x3b`/`0x4e`：

| 状态 | 地址 | 消息 |
|---|---|---|
| 0 | `0x579f6` | `This request is not valid. Please check it and try again.` |
| 1 | `0x57a30` | `QQ is not ready. Please finish signing in and try again.` |
| 2 | `0x57a69` | `The QQ connection changed. Please restart QQ and try again.` |
| 3 | `0x57aa5` | `SnowLuma could not prepare the request. Please restart SnowLuma and try again.` |
| 其它 | `0x57af4` | `SnowLuma could not send the request. Please try again.` |

并且 `0x1324a`–`0x1324f` 先算出 `ecx`：`0xffffffda`(-38) 或 `0xffffffd9`(-39)，
取决于状态是否等于 2。

> **对 `payload-protocol.md` 的补充**：op 表的 1/3/4/5/6/7/21/22 **全部实测存在**，
> 语义也一一对应。新增的事实是：
> ① 入站只白名单 {2, 17}（§2.3）；
> ② op 21 与 op 22 的构造点分别在 `0x19f90` 与 `0x17130`/`0x13a30`；
> ③ op 5 有 5 种不同的固定消息，可按 `status` 反查故障原因。

### 2.5 hello 帧（op 1）：accept 后**主动发**，不等对端

关键点在 `0x13a30`（长度到 `0x13c77`）的入口：

```
0x13a41  mov rax,[rdi]
0x13a44  movzx ebp,BYTE PTR [rax+0x4]   ; ebp = 该连接的"通道种类"字节
0x13a48  add  ebp,ebp                    ; *2
0x13a4a  mov  eax,[0x68c0c]              ; pid 缓存
0x13a50  test eax,eax
0x13a52  jg   0x13a59
0x13a54  call getpid@plt                 ; 缓存<=0 时取真实 pid
0x13a59  movsxd r8,eax                   ; r8 = pid  → value0
```

然后 `0x13a67`/`0x13a6e` 把 `rsi` 指向的 `std::string`（`[rbx]`/`[rbx+8]`，
即本通道的 socket 路径）搬进 `[rsp+0x80]`/`[rsp+0x88]`，
`0x13aa5` 把 `[rsp+0x20]` 的首地址放进 `r9`（body，长度 0），
最后 `0x13ab6` `call 14110`，`esi=0x1`。

所以 hello 帧是：

| 字段 | 值 |
|---|---|
| op | 1 |
| status(@12) | `通道种类字节 * 2`（control=0 → 0；recv=1 → 2） |
| value0(@32) | 目标 pid |
| msg | **本通道的 socket 路径全串** |
| cmd / body | 空 |

这里 `status` 被复用成"通道标识"：`[conn+4]==0` 是 control，`==1` 是 recv，
乘以 2 之后 `status` 就是 0 或 2。**Node 侧如果只读 `msg` 和 `value0`，
这个字段是多余的；但它确实被填了，说明接收方能区分同一份 hello 来自哪个通道。**

触发点（`0x11090` 内）：**两个通道都在 accept 之后、进主接收循环之前就发 hello。**

`0x110af` 按 `[conn+4]`（通道种类）分两支，两支最终都汇到 `0x13a30`：

| 通道 | 路径 |
|---|---|
| **recv**（`[conn+4] != 0`，`0x110af` 不跳） | `0x110b5`–`0x11156` 记 fd 与引用计数 → `0x1115b` |
| **control**（`[conn+4] == 0`，`0x110af` `je 0x11102`） | `0x11120`–`0x11154` 记 fd 与引用计数 → `0x1115b` |

`0x1115b` 是两支的汇合点：

```
0x1115b  lea rdi,[rsp+0x290]        ; 连接状态对象（0x298 字节）
0x11163  lea rsi,[rsp+0x140]        ; 帧头/正文缓冲
0x1116b  call 13810                 ; accept 到的 fd 接管进对象
0x11170  mov  rbx,[rsp+0x148]
0x11178  test rbx,rbx
0x1117b  je   11259                 ; ← 无 fd 也要发 hello
          ... 有 fd 时先做完引用计数收尾（0x1118f–0x11253）...
0x11259  mov rdi,r13
0x1125c  mov rsi,rbp
0x1125f  call 13a30                 ; ← 发 hello
```

所以 **hello 是"accept 完成后立即发"，与是否收到对端 hello 无关。**
`0x13a30` 的两个调用点 `0x1125f`（第一次）和 `0x1130d`（`0x11259` 的另一条
入口，`0x112e7` 失败跳转后经 `0x11307`）都在**主接收循环 `0x113a0` 之前**。

`0x11295` 起还有一段 `poll`（`0x112d2`，超时 `0x1f4`=500ms）等待"连接可写"
才继续，`0x112a5` `test BYTE [conn+5],1` 判存活。

> 这一点**与 `docs/socket-naming.md` 的结论一致**，并且现在有了二进制证据：
> 该文档说 recv 通道"只 accept 不回 hello 会卡在 `phase=hello`"，
> 而二进制里两个通道**都**在 accept 后立刻发 —— 不是基于收到的 hello 才回。
>
> **修正此前的一个错误表述**：早先若把 hello 描述成"载荷只回复、不主动发"，
> 那是错的。准确说法是：**载荷对每个新连接主动发一次 op 1**，
> 不等对端先发。`0x11b95` 那三个比较（`[rsp+0x360]`/`[rsp+0x368]` 与
> `[rsp+0x458]`/`[rsp+0x460]` 两对指针）是 op 2 分支里的
> `std::string` 相等判断，**不是** hello 的前置条件。

### 2.6 发送路径与线程模型

两个发送原语：

- **`0x14110`（高层，止于 `0x14510` 之后）**：入参 `rdi`=连接对象、`esi`=op、
  `edx`=requestId、`ecx`=status、`r8`=flags、`r9`=body 指针、栈上三段长度/指针。
  先在 `0x14146`/`0x14153`/`0x1416d` 做**送前自检**：
  `cmd<=0x1000`、`msg<=0x10000`、`body<=0x1000000` —— **与接收侧完全同一组上限**。
  超限直接跳 `0x144f1`（不发）。然后 `0x141ab` `call 1f180` 序列化，
  `0x141b0` 加锁 `[0x68db0]`，`0x141ce` 检查 `[obj+5]&1`（连接存活），
  再调底层发送。
- **`0x14760`（底层，止于 `0x148d0` 前后）**：入参同上，`0x14760` 内含
  `send` @`0x14851`，`flags=0x4000` = **`MSG_NOSIGNAL`**（避免对端关闭时
  `SIGPIPE` 打死进程），加锁 `[0x68e30]`（`0x14803`）解锁在 `0x1486a` 之后。
  **它也做同一组上限自检**（`0x1476f` `cmp [rsp+0x80],0x1000`、
  `0x14781` `cmp [rsp+0x90],0x10000`、`0x147ab` `cmp rax,0x1000000`），
  所以**无论走高层还是底层，三组上限都被强制执行两次**。
  `send` 是**循环直到发完**（`0x1483f`–`0x14863`，`EINTR` 重试 `0x14838`，
  返回 0 视为失败 `0x14867`）。

**写线程**：`0x10800` 是独立的写泵线程（`std::thread`，由 `0xe671`
`_M_start_thread` 启动，`0xe655` 传入 `0x10800`）。名字来自
`.rodata` `0x5710a` = `"snowluma-pipe-w"`。

**两级发送的真实关系**（这一点很关键，之前容易误解）：

`0x14110` **不直接 `send`**。它 `call 1f180` 序列化之后，把整帧作为
一个元素**入队**到一个 `std::vector`（`0x1427d` 读 `[0x68be0]` 队尾、
`0x14294`–`0x142b1` 写入五元组 `{conn.ptr, conn.refcount, ptr, len, capacity}`、
每个元素 **0x28 字节**、`0x142b5` 跳 `0x144c3`），然后
`0x144c3` 存回 `[0x68be0]`、`0x144d1` 解 `[0x68db0]` 锁、
`0x144dd` `condition_variable::notify_one` 唤醒写泵。

真正 `send` 的是写泵线程 **`0x10c94`**：

```
0x10c71  mov rax,[rsp+0x10]        ; 连接对象
0x10c76  movzx eax,BYTE [rax+5]
0x10c7a  test al,0x1                ; 连接存活?
0x10c94  call send@plt   ecx=0x4040 ; MSG_NOSIGNAL|MSG_DONTWAIT
```

`0x4040` = `MSG_NOSIGNAL(0x4000) | MSG_DONTWAIT(0x40)`。`EAGAIN`(`0xb`) 时
`0x10cc5` 检查从 `[rsp+0x48]` 起算的已耗时是否超过 `0xdf8569a40` ns
（= 60 秒），未超则 `0x10cfd` `poll(可写, 0x1f4=500ms)` 重试。

所以存在**两条发送路径**，各自有独立的 `send` 和独立的上限自检：

| 路径 | 序列化 | 加锁 | `send` | 标志 |
|---|---|---|---|---|
| 队列异步（`0x14110` → 写泵） | `0x141ab` | `[0x68db0]` | **`0x10c94`** | `0x4040` |
| 同步直发（`0x14760`） | `0x147f7` | `[0x68e30]` | **`0x14851`** | `0x4000` |

> **【推断】** 需要"可靠送达"的场景走 `0x14760` 直发（hello、ACK、错误），
> 高频数据（op 6 QQ 包）走队列由写泵合并。依据是调用点分布：`0x14760`
> 的 9 个调用点全部在 `0x11090`（收帧线程，回 ack/err）与 `0x1ba60`；
> 而 `op 6/7/21/22` 全部走 `0x14110`。**但这是按调用点归纳的，不是读到的
> 设计注释，标为推断。**

**收线程**：每个 accept 的连接一个 `0x11090` 线程（§2.2）。

**监听线程**：`0xf5d0`（止于 `0xfc00` 附近）是"accept 循环 + 就绪队列"。
`0xe6ae` / `0xe6ff` 两处 `lea rsi,[rip+...] → 0xf5d0` 分别把
**control**（`0xe6bc` 用 `[0x684c8]`、fd 存 `[0x68470]`）和
**recv**（`0xe70d` 用 `[0x684e8]`、fd 存 `[0x68474]`）的监听交给它。

### 2.7 监听 socket 的建立：`0xf4f0`（长度 0xd2）

```
0xf4fa  edi=1 (AF_UNIX), esi=0x80001 (SOCK_STREAM|SOCK_CLOEXEC), edx=0
0xf506  call socket@plt
0xf513  esi=3 (F_GETFD), F_SETFD → 0xf525 or eax,0x800 → F_SETFL 设 O_NONBLOCK
0xf53d  call unlink@plt             ; 先删旧文件
0xf549  WORD [rsp+0x8]=1            ; sun_family = AF_UNIX
0xf550  cmp QWORD [r14+8], 0x6c     ; 路径长度 < 108 ?
0xf55c  strncpy([rsp+0xa], path, 0x6b)   ; sun_path，最多 107 字节
0xf570  bind(fd, sockaddr, 0x6e)    ; 0x6e = 110 = sizeof(sockaddr_un)
0xf597  chmod(path, 0x180)          ; **0600**，仅属主可读写
0xf5a8  listen(fd, 8)               ; backlog = 8
```

失败路径都会 `close` + `unlink`（`0xf5b8`–`0xf5bb`）。

> 两个细节值得对齐：`chmod` 是 **0600**（不是 0666），`backlog` 是 **8**。
> 路径长度上限 `108`（含 `\0`），超过直接失败。

### 2.8 完整状态机

```
start_dynamic(pid, mode)                       [0xe1d0]
  ├─ 读/清全局状态 (0xe3a5-0xe3e9)
  ├─ base = resolve_runtime_dir()              [0xe8f0]
  ├─ mkdir(base, 0700)，EEXIST 视为成功         [0xe402]
  ├─ control_path = build(base, pid, "control") [0xeca0]
  ├─ recv_path    = build(base, pid, "recv")    [0xeca0]
  ├─ control_fd = listen_unix(control_path)     [0xf4f0] → [0x68470]
  ├─ recv_fd    = listen_unix(recv_path)        [0xf4f0] → [0x68474]
  ├─ 任一失败 → 回滚 close/unlink                [0xe7c9-0xe823]
  ├─ 启动写泵线程 0x10800                        [0xe671]
  ├─ 两个 accept 线程（0xf5d0），分别绑两个 fd   [0xe6d2]/[0xe723]
  └─ 注册 3 个 ctor 状态（0xd230/0xd3d0/0xcdd0）

accept_loop(fd, kind)                          [0xf5d0]
  ├─ lock [0x68dd8]，reap 死线程 (pthread_tryjoin_np) [0xf68d]
  ├─ accept4(fd, NULL, NULL, SOCK_CLOEXEC=0x80000) [0xf6ff]
  ├─ new 0x18 连接对象；[+0x10]=fd, [+0x14]=kind, [+0x15]=1  [0xf734-0xf73b]
  ├─ 拷贝 socket 路径字符串进对象
  └─ pthread_create(0x11090, conn)              [0xfb33]

conn_thread(conn)                              [0x11090]
  ├─ 记 fd + 引用计数（按 kind==recv 分两支，0x110af）
  ├─ 汇合到 0x1115b → call 13810（接管 fd 进状态对象）
  ├─ poll(sock, 可写, 500ms)                    [0x112d2]
  ├─ call 13a30  ** 主动发 op1 hello **          [0x1125f]
  └─ 主循环 0x113a0:
       ├─ 收 40 字节头（循环到满 0x28）          [0x11644]
       ├─ 校验 magic / version / 三个长度上限    [0x11675-0x116c5]
       ├─ resize cmd/msg/body                    [0x116d5-0x116f0]
       ├─ 收 cmd → msg → body（三个循环）         [0x11771/0x117c4/0x1181c]
       ├─ op = u16@6
       ├─ op==2  → 回 op3 ACK（含固定 msg）       [0x11850 → 0x11c57]
       ├─ op==17 → 校验 value0 落在 [2^32, 2^32+10000)
       │            ├─ 是 → 更新 [0x68d48]，60s 超时，继续   [0x11ab4]
       │            └─ 否 → op5 + EINVAL + "invalid login identity hint" [0x11a41]
       └─ 其它 op → 丢弃、回收、continue          [0x113a0]
```

---

## 3. 与我们现有实现的差异核对

对照 `docs/payload-protocol.md` 与 `test/payload.cc`：

| 项 | 二进制实测 | 我们文档/实现 | 结论 |
|---|---|---|---|
| 头长 | `0x28`=40 | 40 | ✅ |
| magic | `0x31504851` | 同 | ✅ |
| version | `1`，`u16@4` | 同 | ✅ |
| op 位置/宽度 | `u16@6` | 同 | ✅ |
| requestId | `u32@8` | 同 | ✅ |
| status | `u32@12`（作 `i32` 用，有负值 `0xffffffea`） | `int32_t@12` | ✅ |
| **flags** | **`u32@16`** | `u32@16` | ✅ |
| cmd/msg/body 长度 | `u32@20/24/28` | 同 | ✅ |
| value0 | `u64@32`，无填充 | 同 | ✅ |
| 段顺序 | cmd→msg→body 紧排 | 同 | ✅ |
| 上限 | 4096 / 65536 / 16 MiB，收、发两侧都查 | 同 | ✅ |
| 入站白名单 | **只有 {2, 17}** | 未记载 | ⚠️ 新约束 |
| hello 方向 | **accept 后主动发，不等对端** | 记为"双向" | ⚠️ 需澄清 |
| hello 的 status | 被复用作通道标识（0 或 2） | 未记载 | ⚠️ 新事实 |
| socket 路径 | `<base>/mojo.<pid>.<channel>.sock`，两通道独立构造 | 同 | ✅ |
| 目录权限 | `mkdir 0700`，socket `chmod 0600` | `ensure_parent_dir` | ✅ |
| 目录扫描 | **无** | 无 | ✅ |
| `SNOWLUMA_UID` | **全库无此字面量**（5 个路径相关解码串已穷举，见表 §1.2） | 未使用 | ✅ |

---

## 4. 仍未确定的部分（不要当成已知）

1. **op 2 是否存在真正的处理路径。** 我现在只看到"回 ACK + 一条固定消息"
   （§2.3）。若 Node 侧真的依赖载荷处理 `serviceCmd`，那这条路径要么在别处，
   要么这个构建版本根本没实现。**必须在真实环境里实测确认。**
2. **op 17 的语义。** 消息字面量暗示是"login identity hint"，`value0` 被约束在
   `[2^32, 2^32+10000)`。但 Go 侧协议表里没有 17。**未确定。**
3. ~~control 通道 hello 的触发条件~~ —— **已确证**：两支在 `0x1115b` 汇合后
   经 `0x1125f` 调 `0x13a30`，都在主循环 `0x113a0` 之前，与是否收到对端
   hello 无关（见 §2.5）。剩下的唯一不确定项是 `0x11295` 那段
   `poll(可写,500ms)` 超时后是否仍发 hello（`0x112d9` `jg` 到 `0x11280`
   只检查 `revents`，超时走 `0x112db`→`0x1128a`→`0x11295` 循环，
   **看不出会放弃**，但也**没有专门的分支证明它一定发**）。
4. **`0x1f4e0` 到底拷贝的是什么。** 它是个"整块 0x2b8 字节结构体复制"
   （`movups` 大段 + 一个 `std::string` assign），被 `0x100ff`/`0x103c6`/
   `0x11912`/`0x11be7`/`0x1630f`/`0x1fb50` 调用。看起来是"连接状态快照"，
   但**具体字段语义未确定**，本文不依赖它。
5. **`0x11090` 里那 3 个 `[rsp+0x2d8]`/`[rsp+0x2e0]` 字段**（`0x118c4`
   写 `2`、`0x11b41` 写 `2`）在 `0x1c030` 里当析构用（`+0x2d8` 是
   `_ZdlPv` 的目标）。这是请求上下文对象的生命周期管理，**不是协议字段**。

6. **两条发送路径的分工判据。** §2.6 里"可靠送达走 `0x14760`、高频数据走
   队列"是**按调用点归纳的推断**，不是读到的设计意图。可以确定的事实只有：
   `0x14760` 的 9 个调用点全在 `0x11090` 与 `0x1ba60`；`op 6/7/21/22`
   全走 `0x14110`。**下游实现只需知道"两条路都在、上限都查"，不必照搬分工。**

---

## 5. 复现清单

所有解码结论用 `re/dec5.py` 一条命令即可复验（脚本自带断言，不碰目标 `.so`）：

```bash
cd /home/ubuntu/hook-rewrite/re
python3 dec5.py
```

当前输出（本机实跑）：

```
PASS SNOWLUMA_HOOK_RUNTIME_DIR    b'SNOWLUMA_HOOK_RUNTIME_DIR'
PASS XDG_RUNTIME_DIR              b'XDG_RUNTIME_DIR'
PASS /tmp/snowluma-               b'/tmp/snowluma-'
PASS SNOWLUMA_HOOK_SERVICE_MODE   b'SNOWLUMA_HOOK_SERVICE_MODE'
PASS in-process                   b'in-process'
PASS /mojo.                       b'/mojo.'
PASS .sock                        b'.sock'
ALL PASS
```

其它工具：

```bash
# 反汇编（若 dis/full.asm 不在）
objdump -d -M intel --no-show-raw-insn \
  /home/ubuntu/x64run/native/snowluma-linux-x64.so > dis/full.asm

python3 fdes.py            # → funcs.txt（435 个 起始 长度）
python3 range.py 11675 116d0   # 任意地址窗口
python3 calls.py 4520          # 某 PLT 符号的所有调用点（4520 = getenv）
python3 fnof.py 0x11aaa        # 某地址属于哪个函数
```

### 5.1 解码器的两类签名（这是本文最容易踩错的地方）

`dec5.py` 里 `reads_src_from_rdi()` 自动识别：

| 类型 | 签名 | 例子 | 识别特征 |
|---|---|---|---|
| **A** | `decode(std::string* out /*rdi*/, const char* src /*rsi*/)` | `0x1d820` `0x1df50` `0x1e560` `0x1cc40` `0x1d3f0` | 首条取字节是 `mov al,BYTE PTR [r14+N]`，而 `r14=rsi` |
| **B** | `decode(const char* src /*rdi*/, std::string* out /*rsi*/, uint64_t* state /*rdx*/)` | `0x1eb10` `0x1ed60` | 首条就是 `mov r8b,BYTE PTR [rdi+N]` |

B 类还必须喂 64 位 state：`0x1eb10` 的种子 `0xb0ff16b3120d4999` 由
`0xecfc`/`0xed06` 写进 `[rsp+0x48]`，`0x1ed60` 的 `0x078057181ff3e666`
由 `0xf1b6` 同址写入。**种子每次调用都要重写**，因为解码器把滚动状态存在
那个槽里（A 类里同样的状态是内联 `movabs` 的，所以 A 类不需要外部种子）。

### 5.2 三个必须注意的模拟器细节

1. **`std::string` 的 `_M_p` 是 8 字节指针，必须写满 8 字节。**
   `mem[0x1000] = 0x1010` 只写了一个字节，解码器 `mov rax,[rsi]` 读到的是
   `0x10`，于是往 `0x10` 那个地址写，输出全 `\x00`。正确写法
   `struct.pack('<Q', 0x1010)`。**这个坑踩了两次，症状都一样。**
2. **嵌套 `call` 的 `end` 是 `起始 + 长度`，不是长度本身。**
   `0x1df50` 的尾部会 `call 1e2a0` 继续吐后 7 个字节；把 `FUNC[0x1e2a0]`
   （=`0x2b1`）当 end 传进去，就只解出前 8 个字符
   `XDG_RUNT`。这是本文最后修正的一个错误。
3. **解码长度要按 `_M_constructEmc` 的 `mov esi,<len>` 取，不要按"解出多少算多少"。**
   `0x1ed60` 写 6 个字节是因为最后那个是 `\0` 终止符，实际字符串长 5。

### 5.3 单个解码器的最小复现（不用 dec5.py）

```python
import sys, struct
sys.path.insert(0, '/home/ubuntu/hook-rewrite/re')
import emu

D = open('/home/ubuntu/x64run/native/snowluma-linux-x64.so', 'rb').read()
OBJ, BUF = 0x1000, 0x1010

def dec_a(src, fn, end, n):                       # 类型 A
    mem = {src + i: D[src + i] for i in range(n + 96)}
    for i, b in enumerate(struct.pack('<Q', BUF)):
        mem[OBJ + i] = b                          # <<< 必须 8 字节
    out, _ = emu.decode_custom(fn, end, {'rdi': OBJ, 'rsi': src},
                               mem, outbuf=BUF, outlen=n)
    return bytes(out)

# 这三个解码器没有尾部续接调用，decode_custom 足够
print(dec_a(0x57bd9, 0x1d820, 0x1df44, 25))       # b'SNOWLUMA_HOOK_RUNTIME_DIR'
print(dec_a(0x57bb5, 0x1cc40, 0x1d3e5, 26))       # b'SNOWLUMA_HOOK_SERVICE_MODE'
print(dec_a(0x57bcf, 0x1d3f0, 0x1d6b3, 10))       # b'in-process'
```

**反例（务必注意）**：`0x1df50`（`XDG_RUNTIME_DIR`）和 `0x1e560`
（`/tmp/snowluma-`）的尾部都 `call` 一个续接函数继续吐后面的字节，
而 `emu.decode_custom` **不跟进 `call`**：

```python
print(dec_a(0x57bf2, 0x1df50, 0x1e29b, 15))       # b'XDG_RUNT\x00\x00\x00\x00\x00\x00\x00'
```

原因是 `0x1e271` `call 1e2a0`，续接函数负责写 `+0x8`…`+0xe` 这 7 个字节。
**要完整解出这两个必须用 `dec5.py`（它的 `exec_fn` 会递归跟进 `call`）。**
`dec5.py` 的 `end_of()` 也会自动按 `起始+长度` 算区间，避免 §5.2 第 2 条那个错。

---

## 附录 A：本文引用的关键地址速查

| 地址 | 内容 |
|---|---|
| `0xe1b0` / `0xe1c0` | 导出 `control_socket` / `recv_socket`（读 `[0x684c8]`/`[0x684e8]`） |
| `0xe1d0` | `start_dynamic` 真实实现（长度 0x715） |
| `0xe8f0` | 运行时目录解析（长度 0x3a2） |
| `0xeca0` | 路径拼接（长度 0x845） |
| `0xf4f0` | unix socket 建立（长度 0xd2） |
| `0xf5d0` | accept 循环（长度到 `0xfc00`） |
| `0x10800` | 写泵线程 |
| `0x11090` | 每连接收帧线程（长度 0x2776） |
| `0x13810` | recv 通道 accept 接管 |
| `0x13a30` | hello 帧构造/发送 |
| `0x14110` | 高层发送：三段自检 → `1f180` 序列化 → 入队 `[0x68be0]` → `notify_one`（止于 `0x14510`） |
| `0x10c94` | 写泵线程真正的 `send`（`0x4040`） |
| `0x14760` | 同步直发：**再次自检** → `1f180` → 锁 `[0x68e30]` → `send` 循环（`0x4000`） |
| `0x14560` | op 7 登录状态构造 |
| `0x19f90` | op 21 回执构造 |
| `0x17130` | op 22 能力探测构造 |
| `0x1a590` | op 6 QQ 数据包构造 |
| `0x1f180` | 帧序列化（40 字节头） |
| `0x1f2d0` | vector append-range |
| `0x1c030` | 收帧上下文对象析构 |
| `0xd4c0` | fork 看守线程（`SNOWLUMA_HOOK_SERVICE_MODE` 判定） |
| `0x1d820` | 解码器：`SNOWLUMA_HOOK_RUNTIME_DIR` |
| `0x1df50` | 解码器：`XDG_RUNTIME_DIR` |
| `0x1e560` | 解码器：`/tmp/snowluma-` |
| `0x1eb10` | 解码器：`/mojo.`（需种子） |
| `0x1ed60` | 解码器：`.sock`（需种子） |
| `0x1cc40` | 解码器：`SNOWLUMA_HOOK_SERVICE_MODE` |
| `0x1d3f0` | 解码器：`in-process` |
| `0x570b6` / `0x570be` | 明文 `control` / `recv` |
| `0x57090` | `snowluma-linux-hook-stub/0.2.0` |
| `0x5710a` | 线程名 `snowluma-pipe-w` |
| `0x57d10` | 十进制数字表（双字节一组） |
| `0x58ff0` | `/proc`（`opendir` 目标） |
| `0x5900f` | `"%x:%x"`（两处 `sscanf`） |
| `0x57bb5`–`0x57c1c` | 混淆字符串区（`SNOWLUMA_HOOK_SERVICE_MODE` … `.sock`） |