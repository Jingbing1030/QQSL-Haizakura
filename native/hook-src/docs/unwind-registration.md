# 手动加载模块的 C++ 异常：必须注册 .eh_frame

## 结论

手写 ELF 加载器映射的模块**不在** `link_map` 里。libgcc 的 unwinder 只会通过动态加载器
的 link_map 找 unwind 表，找不到时它**不会**「保守展开」，而是直接终止。
所以载荷里任何一次 `throw` 都会变成 `std::terminate` → `abort()` → SIGABRT。

修复：映射并重定位完成后，在目标进程里调用 `__register_frame(<.eh_frame 地址>)`；
卸载前调用 `__deregister_frame`。

## 两个坑

### 坑 1：注册 `.eh_frame_hdr` 而不是 `.eh_frame`

两者都是 unwind 元数据，极易混淆：

| 节 | 用途 | 谁用 |
|---|---|---|
| `.eh_frame_hdr` | 二分查找表（加速） | 动态加载器 |
| `.eh_frame` | CIE/FDE 记录流 | `__register_frame` |

`__register_frame` 期待的是**以零长度记录结尾的 CIE/FDE 流**。
喂给它 hdr（一个查找表头）后，它会把表的「条目数」「二分查找字段」当成记录长度解析，
走出映射区，最终崩在 `_Unwind_Backtrace` 内部。

**症状极具误导性**：
```
FAIL: call to 0x...5b60 raised signal 11 at rip 0x...4f48
```
`0x...5b60` 其实就是 `__register_frame` 自己（libgcc_s 的 `0x25b60`），
而 RIP 在 libgcc 内部。整个栈里**没有一帧属于载荷**，
看起来像「C++ 在这里根本不能用」，实际只是「传错了节」。

### 坑 2：`MappedFile` 不能用在 procfs 上

`MappedFile::open()` 用 `mmap` 映射整个文件。procfs 文件的 `st_size` 是 **0**，
`mmap(len=0)` 返回 `MAP_FAILED`，`fail()` 抛出异常。

在**没有注册 unwind 表**时，这个异常直接要了进程的命；注册后它会正常传播，
但如果它逃出 `hz_hook_install_login_observer` 这样没有 catch 的函数，
依然会 `std::terminate`。

所以读 `/proc/self/maps` 必须用 `read()` 循环，不能用 `MappedFile`。

## 实测证据

修复后注入一个逐步打标记的测试载荷（标记用裸 `write()`，因为要观察的正是「进程在
被标记的那次调用里死掉」）：

```
00 start
01 string ctor (SSO)
02 string concat (heap)
03 vector push_back
04 string growth
05 snprintf
06 before throw
07 caught int              ← C++ 异常开始可用
08 before std::string throw
09 caught std::string      ← 带对象的异常也能展开
10 return
```

修复前一行都不打，直接 SIGABRT。

## 代码位置

- `src/manual_loader.cc` — `register_unwind_tables()`（在 `run_init()` 之前调用）、
  `unload()` 里的 `__deregister_frame`
- `include/manual_loader.h` — `locate_eh_frame()` / `last_unwind_registration()`
- `src/payload_hook.cc` — `find_wrapper_base()` 用 `read()` 读 `/proc/self/maps`

## 为什么之前没被发现

载荷此前是**纯 C + `-fno-exceptions`**，一次异常都不抛，所以这套机制从来没被触发过。
把 vtable hook 引擎接进载荷（引擎用 STL 且靠异常报错）才把问题翻出来。

`handle.exception_table` 这个字段一直存在、一直被填、一直被上报给 Node 侧，
但**从未注册给 unwinder** —— 名字叫 exception_table，实际只是个诊断数字。
