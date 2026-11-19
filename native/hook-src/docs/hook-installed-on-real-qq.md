# hook 已在真实 QQ 上装上了

> **2026-11-20 更正**：本文标题里的"装上了"只指**写入成功**，不指**能观察到登录**。
> 后续在干净进程上做了完整实验（QQ 未登录时注入、两个槽都改写、实例确认共用静态表），
> QQ 登录成功但 **observer 零次调用**。详见 `docs/observer-not-firing.md`。
> 下面关于"槽被改写为我们的 relay"的证据依然成立；"能上报真实登录"**不成立**。


## 环境

容器 `hz-scan`（Debian 12，glibc **2.36**，aarch64），QQ PID **85885**，
`SNOWLUMA_HOOK_RUNTIME_DIR=/tmp/runtime-1000`。

## 决定性证据：槽 11 被改写

登录类 `nt::login::QRCodeLoginRequestImpl` 的主 vtable（静态偏移 `0x8714228`），
运行时 `0xf9ce9f994228`，槽 11 在 `0xf9ce9f994280`。

直接读 `/proc/85885/mem`：

```
slot value  : 0xf9cf40e71018     ← 现在
expected    : 0xf9ce985a3a20     ← 原始的 selfInfoOnLoginSuccess
改写了吗    : True
```

`0xf9cf40e71018` 落在：

```
f9cf40e71000-f9cf40e72000 r-xp 00000000 00:00 0     ← 匿名可执行页，无文件名
```

即**手动映射的载荷代码页**。读出该地址的字节：

```
89 00 00 58 aa 00 00 58 40 01 1f d6 ...
```

`ldr x9, ...` / `ldr x9, ...` / `br x9` —— 是我们的 aarch64 relay 入口，
不是 QQ 自己的代码。

## 同时验证的其它事实

| 项目 | 结果 |
|---|---|
| 载荷注入 | ✅ `.eh_frame` 注册成功，无符号解析错误 |
| socket 重建 | ✅ mtime 从 12:59 变为 **23:09:57** |
| 载荷 listen | ✅ `ss -xlp` 显示 `qq pid=85885 fd=469` |
| TS 解码真实帧 | ✅ `magic=827344977`、`op=7 status=1 flags=0x4 msg="3083456343"` |
| 静态偏移正确 | ✅ `selfInfoOnLoginSuccess` = base + `0x1323a20`，实测吻合 |

## 为了走到这一步修掉的两个真实问题

这两个都是**只有在真实容器里才会暴露**的，本机测试永远发现不了。

### 1. GLIBC 2.38 —— 编译链比目标新

```
/lib/aarch64-linux-gnu/libc.so.6: version `GLIBC_2.38' not found
```

gcc 15 + C23 glibc 把 `strtol`/`strtoul`/`stoull`/`sscanf`/`atoi` 全部改写成
`__isoc23_*`。容器是 2.36。改法：**所有数字解析改用 `std::from_chars` 或手写**，
涉及 `addon.cc`、`remote.cc`、`vtable_hook.cc`、`process_enumerate.cc`。

另加 `src/compat_isoc23.cc`：静态 libstdc++ 的 `eh_alloc.o`/`debug.o` 内部仍引用
`__isoc23_strtoul`，我们代码改不到，只能自己提供该符号（转调 `strtoul`，
差异仅在 `0b` 前缀，本模块不涉及）。

### 2. GLIBCXX_3.4.31 —— 载荷不能用新版 libstdc++

```
failed to resolve remote symbol ...basic_string..._M_replace_cold...
```

载荷**故意不链接 libstdc++**（它要用 QQ 自带的那份），QQ 提供 6.0.30 即
GLIBCXX_3.4.30，而 `_M_replace_cold` 是 3.4.31。

触发点是两处看着无害的 `std::string` 赋值：

- `set_error()` 里 `g_last_error = text`；
- `find_wrapper_base()` 里 `text.append(chunk, n)`。

改法：错误信息改**定长 `char[512]`**；`/proc/self/maps` 解析改**定长缓冲区 +
`string_view`**，全程零分配。改完最高需求降到 **GLIBCXX_3.4.21**，安全裕度 9 个版本。

> 这个失败特别容易看错方向：报错来自**注入器**，指向一个 libstdc++ 内部符号，
> 而真正的原因是我们自己那行字符串赋值。诊断路径是先看"载荷有没有跑"，
> 而载荷根本没被加载——因为符号没解析完。

## 明确**没有**验证的

- **observer 会不会在真实登录事件时触发**。QQ 在 12:59 就已经登录，装 hook 时没有
  新的登录事件发生。要看到它真触发，需要一次登出再登入——那会影响账号会话，
  没有在未经确认的情况下做。
- 槽写的是**我们的 relay**（地址属性和代码字节都指向它），但 relay 之后跳到 observer
  这条链只在 `fake_target` 上验过完整执行。
- 闭源 hook 也在同一进程里跑（`fd=231`），两者**监听同一路径**。共存能跑，
  但这是一个必须在正式部署里解决的冲突（不同 runtime dir，或先停掉闭源版）。

---

## 追加：observer 链路与 socket 抢占（同日）

### 我们的载荷确实在服务请求

连 12 次 control socket、每次发一个 op 2 请求，**12/12 都收到**：

```
"SnowLuma could not prepare the request. Please restart SnowLuma and try again."
```

这是 `test/payload.cc` 里我们自己的 `op 2 → op 5` 文案。闭源版对 op 2 回的是
`"Linux runtime targets are not resolved yet"`。**能读到这条消息，就说明应答的是我们的
载荷，而不是闭源那份。**

同时载荷的 4 个 listener（fd 469/474 及 recv）在注入器进程退出后**仍在监听**，
证明载荷的线程独立于注入器存活——这是 manual loader 那条"返回后线程继续跑"的设计
第一次在真实进程上得到确认。

### 但这暴露了一个必须在部署前解决的冲突

`snowluma_linux_hook_start_dynamic` 会 `unlink(control)` 再 `bind`。闭源 hook 已经在
同一个路径上监听（fd 231），我们的载荷把那个 socket 文件**删掉重建**了：

| | 之前 | 之后 |
|---|---|---|
| 权限 | `srw-------` | `srwxr-xr-x` |
| mtime | 12:59 | 23:09:57 |
| listener | fd 231（闭源） | fd 231（闭源，已失效路径）+ fd 469（我们） |

闭源那条 fd 还开着但已**不再可达**（文件被替换）。这等于我们在真实容器里**把生产
hook 顶掉了**——`hz-scan` 是测试容器，可以接受；`snowluma-hz` 上如果这么做，
正在用的账号会瞬间失去 hook。

### 所以正式部署必须三选一

1. **不同 runtime dir**：给我们的载荷设独立的 `SNOWLUMA_HOOK_RUNTIME_DIR`。
   但载荷读的是**目标进程**的环境变量，QQ 已经在跑，改不了——只能在 QQ 启动前设好。
2. **先停闭源 hook**（`supervisorctl stop snowluma`），再注入我们。
3. **先 unload 闭源 payload**（如果它有 stop 入口且能拿到 handle）。

推荐 **2**：这是唯一不需要重启 QQ、也不会出现两条 hook 同时存在的方式。

### 仍未验证

**observer 在真实登录事件时是否被调用。** 现在缺的不是 hook 装没装上（已证明装上了，
槽被改写、relay 在跑），而是**登录事件本身没有发生**——QQ 在 12:59 就登录完了。
要看到 observer 真触发，需要一次登出再登入，那会影响账号会话，**未在未经确认的情况下做**。
