# 闭源载荷的 hook 写入机制（实证）

## 结论：它和我们做的是同一件事

闭源载荷**在进程内直接改 vtable 槽位**，不跨进程写。证据是 `0xd9d7` 处的这一小段：

```asm
d9bb: or     $0x2,%edx              ; prot |= PROT_WRITE
d9be: mov    %rbp,%rdi              ; rdi = 页对齐起始
d9c1: mov    %r14,%rsi              ; rsi = 长度
d9c4: call   mprotect               ; ① 放开写权限
d9c9: test   %eax,%eax
d9cb: jne    da05                  ; 失败 → 错误分支
d9cd: mov    0x68478(%rip),%rcx     ; rcx = 目标槽地址（全局指针）
d9d4: mov    %rbx,%rax              ; rax = 期望值
d9d7: lock cmpxchg %r15,(%rcx)      ; ② 原子替换
d9dc: mov    0x68490(%rip),%edx     ; 原 prot
d9e2: mov    %rbp,%rdi
d9e5: mov    %r14,%rsi
d9e8: call   mprotect               ; ③ 恢复只读
```

三步：**放开权限 → 原子写 → 恢复权限**。

这正是 `src/vtable_hook.cc` 的 `hook_vtable_slot_in_process()` 做的事，
只是我们用普通 `memcpy`，它用 `lock cmpxchg`。

## 它比我们多做的一件事：cmpxchg 而非 memcpy

| | 我们 | 闭源 |
|---|---|---|
| 写入 | `memcpy` | `lock cmpxchg` |
| 并发安全 | 无 | 有（期望值不匹配则放弃） |
| 失败语义 | 覆盖未知值 | 检测到变化，走错误分支 |

`cmpxchg` 的价值：如果槽位在我们读取和写入之间被改了（另一处代码也在 hook，
或 QQ 自己重载了 vtable），`cmpxchg` 会失败而不是覆盖掉别人的修改。
我们目前的做法是「写前读一次，写后再读回来比对」，能检测但不能原子地避免。

**这是一个真实的、可借鉴的改进点**，不是理论洁癖：QQ 会在更新时重载 wrapper.node，
重载期间两个 hook 可能竞争同一个槽。

## 提交的权限是 `or $0x2`，不是直接设 R/W

`or $0x2,%edx` —— 它保留原有的 PROT_READ/EXEC 位，只加上 PROT_WRITE。
这样即使目标页原本是可执行的（有些 vtable 在含代码的段里），也不会因为
「设成 R/W」而丢掉执行权限。

我们的实现是 `mprotect(page, PROT_READ|PROT_WRITE)`，**会清掉 PROT_EXEC**。
对 `.data.rel.ro` 里的 vtable 无影响（本来就不是可执行的），
但如果将来要 hook 放在代码段里的函数指针表，这会是个 bug。

## 没有 process_vm_writev 是因为它根本不需要

导入表里只有 `process_vm_readv`（只读）。原因现在清楚了：

- **写**：它已经在目标进程里，直接 `mprotect`+`cmpxchg`，用不着跨进程写；
- **读**：`process_vm_readv` 用来自读（`pid=0` 或 `getpid()`），
  在不能直接解引用时安全地读一段内存 —— 等价于 `memcpy`，但能在
  不可读的地址上返回错误而不是 SIGSEGV。

这解释了日志里那一整套读错误分类：

```
QQ runtime cannot read process memory
: kernel support is unavailable or the system call is blocked   (ENOSYS)
: access was denied by system policy                            (EPERM)
: the read did not complete                                     (短读)
 (errno=...)
) [RUNTIME_MEMORY_UNAVAILABLE]
```

**`process_vm_readv` 在这里是「安全的 memcpy」，不是跨进程通道。**

## fork/prctl 是孤儿守护，不是提权

```asm
d567: call fork
d56e: jne  d5b3                    ; 父 → return
d570: mov $1,%edi                  ; 子: prctl(PR_SET_PDEATHSIG=1, SIGTERM=15)
d5c8: call getppid
d5cd: cmp  %ebp,%eax               ; getppid() == 原始父 pid?
d5cf: jne  d5fc                    ; 不等 → 退出
d5e0: call nanosleep               ; 等 → 睡再查
```

两层：`PDEATHSIG`（父死即时 SIGTERM）+ `getppid` 轮询（兜住 fork 到 prctl 之间的窗口）。

载荷不做注入（它是被注入方），fork 只是为了在 QQ 死后自我清理、不留孤儿。
「通过 fork 获得特权写内存」的假设被否定。

## 待确认

- `0x68478` 这个全局指针槽由谁赋值（在哪一步把目标 vtable 地址填进去）
- `__cxa_demangle` 的具体调用点（按类名找 vtable 的入口）
- 它读 `.data`/`.got`/`.text` 这三个节名（见 .rodata）是为了做什么定位
