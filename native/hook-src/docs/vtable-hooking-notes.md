# 虚表 hook 的三个必踩坑

这三个都是「代码看起来对、地址也正确、但就是不工作」的类型，
排查时最贵的不是修，是**认出自己在踩哪个坑**。

---

## 一、`.data.rel.ro` 是只读的，写槽必须先 mprotect

`hook_vtable_slot` 第一版直接用 `process_vm_writev` 写槽位：

```
cannot write vtable slot 2 at 0x71ec19632dc0
```

地址是对的（读同一个地址完全成功），写入却 EFAULT。原因在
`/proc/<pid>/maps`：

```
71ec19631000-71ec19632000 r--p 00002000  /tmp/vtlib.so   ← .data.rel.ro
```

RELRO 生效后这段是 `r--p`。`process_vm_writev` 走的是目标进程的页表，
所以**只读页一律 EFAULT**，`/proc/pid/mem` 同样被拒。
先 `mprotect(PROT_READ|PROT_WRITE)`、写完再恢复 `PROT_READ`：

```cpp
const uint64_t page = at & ~(kPageSize - 1);
remote.remote_call(mprotect_addr, {page, kPageSize, 3}, 3);  // RW
remote.write(at, &new_target, sizeof(new_target));
remote.remote_call(mprotect_addr, {page, kPageSize, 1}, 3);  // R
```

**恢复那步不能省。** 留着可写会让后续重定位在该 fault 的地方静默成功，
把真正的 bug 藏起来。

`restore_vtable_slot` 有**完全一样**的问题。第一版只在 hook 里加了 mprotect，
还原时就又 EFAULT 了 —— 现象是「hook 成功、restore 失败」，
而这个组合意味着目标被永久改坏，只在下次 reload 时才暴露。

---

## 二、槽 0 可以是 NULL，扫描不能在那里停

`find_slot_by_target` 用「读到一个 0 就结束」来判断表尾。实测：

```
slot 0 = 0x0        ← NULL
slot 1 = 0x...df0
slot 2 = 0x...250   ← alpha
slot 3 = 0x...220   ← beta
```

槽 0 为 NULL 是因为该类的首虚函数是纯虚/继承而来，vptr 从基类拿。
一遇 0 就 break，搜索对**所有这种表**都答「找不到」——
而这些恰恰是 hook 最想改的表。只有**读不到**（页不可读）才该结束遍历。

---

## 三、文件里的 vtable 内容可能是零，槽值只能从内存读

对 PIE 动态库，`.data.rel.ro` 在**文件里全零**，内容靠加载时的
`R_*_RELATIVE` 重定位填：

```
但真实 wrapper.node 的类型不同：它用 DT_RELR 压缩相对重定位，
文件里存的就是链接期算好的偏移量，所以能直接读出内容。
```

| 模块 | 文件里的 `.data.rel.ro` | `list_vtables` 能否工作 |
|---|---|---|
| `wrapper.node`（DT_RELR） | 非零，存链接期偏移 | ✅ 能 |
| 普通 PIE `.so`（RELA） | 全零 | ❌ 找不到任何 vtable |

所以 `list_vtables(image)` 读文件这条路**只对 wrapper.node 这种构建成立**。
要在通用 `.so` 上工作，必须从**活进程内存**取槽值
（`test/vtable_slot_live_test.cc` 走的就是这条：符号表给表地址，内存给槽值）。

这个限制已写进 `src/vtable_hook.cc` 的注释，因为静默失败比报错难查得多。

---

## 四、附带：class 必须被实例化，否则 vtable 根本不存在

写测试样本时第一版 `demo::Base` 只声明不用，`nm` 里连 `_ZTVN4demo4BaseE`
都没有 —— 编译器把整个类和它的 vtable、RTTI 一起删了。
加一个 `new demo::Base()` 就有了。这类库做测试样本时要先确认
`nm | grep _ZTV` 有输出，否则会误以为是扫描器坏了。
