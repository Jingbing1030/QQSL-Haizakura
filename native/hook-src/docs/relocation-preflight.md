# 重定位预检：注入前就能知道载荷会不会死

manual loader 的重定位支持是**固定集合**，遇到集合外的类型就 `fail()`。这意味着
一个载荷可能：映射成功 → 重定位到一半 → 在**目标机器上**失败，而且只在注入时
才发生。

`test/reloc_check.cc` 把同一个问题变成静态检查：不需要 ptrace，不需要目标架构，
在任意主机上对任意架构的载荷都能跑。

## 它查什么

1. **类型支持** —— 每个重定位类型是否在 loader 的实现集合内。
2. **目标落位** —— 每个重定位目标是否在镜像范围内（loader 自己会断言这一条）。
3. **符号索引** —— 每个重定位引用的符号下标是否存在。

未定义符号单独计数，不算失败：那些由 `need_external()` 在注入时对目标进程的库
解析。所以 PASS 的含义是"loader 走到这里不会失败"，不是"载荷一定能跑"。

## 实测结果

```
自研 x86 载荷   (37 个重定位)  applied=6  external=31   PASS
自研 arm64 载荷 (43 个重定位)  applied=7  external=36   PASS
闭源 x86 载荷   (217 个重定位) applied=57 external=160  PASS
```

**闭源那个最有说服力**：它有 217 个重定位、4 种类型（含 `R_X86_64_64`），
全部落在 loader 的实现集合里。也就是说我们的 loader 能处理**和原版同等复杂度**
的载荷，不是只能跑自己那个小桩。

## 顺带发现的真实风险：TLS

真的 arm64 `wrapper.node` 里有 **27 个 `R_AARCH64_TLS_TPREL64`**。

那不是缺陷 —— `wrapper.node` 由 QQ 自己的 loader 装载，不经过我们。但它标明
一件事：**载荷一旦引入 `thread_local`，注入就会失败**，而失败点在重定位阶段，
错误信息原本只有一句 "does not implement TLS relocations"。

两处改进：

1. 加 `kRaarch64TlsDesc = 1032`。`-mtls-dialect=desc`（某些发行版默认）产生的
   是 TLSDESC 而不是 TPREL；只把 TPREL 当 TLS，会让 TLSDESC 载荷落到
   `default` 分支，报"unsupported type"，把"这是 TLS 问题"这个关键提示丢掉。
2. 错误信息写清楚原因和修法：手工映射的镜像**没有 TLS 块**，重定位无处可指；
   去掉 `thread_local` 是解法。并注明 `wrapper.node` 自身有 TLS 是正常的。

验证（故意造的 TLS 载荷）：

```
arm64: FAIL 1031 x 1 R_AARCH64_TLS_TPREL64 (unsupported)  -> FAIL (1)
x86:   FAIL 17   x 1 R_X86_64_DTPOFF64 (unsupported)      -> FAIL (2)
```

两个架构都准确拦下。这种载荷在真机上会注入到一半就死，现在编译期就看得见。

## 一个自己犯的错

第一版打印 `FAIL` 之后仍然 `printf("PASS")` 并 `return 0` —— `unsupported` 累加
了但从没加到 `failures`。

一个"打印 FAIL 却退出 0"的预检**比没有预检更糟**：CI 认为通过，于是带 TLS 的
载荷照样上行，然后在目标机器上死。改完之后：载荷 exit=0，含 TLS 的
`wrapper.node` exit=1。
