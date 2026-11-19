# socket 命名：为什么 `pipe connected` 一直不出现

这是本轮最重要的发现，也是整个目标里那个"日志始终不出现"的直接原因。

## 症状

载荷注入成功、`start_dynamic` 跑完、进程里有监听 socket —— 但 SnowLuma 的
`[HookSession] pipe connected` 永远不打印，Node 侧一直超时。

## 根因

Node 侧不连固定路径。它构造：

```
<runtimeDir>/mojo.<pid>.control.sock
<runtimeDir>/mojo.<pid>.recv.sock
```

`runtimeDir` 的推导顺序（`resolveHookRuntimeDir`，index.mjs:1744）：
读**目标进程**的 `/proc/<pid>/environ`，取

1. `SNOWLUMA_HOOK_RUNTIME_DIR`
2. `XDG_RUNTIME_DIR`
3. 回落 `/tmp/snowluma-<uid>`

我们的载荷原来写死 `/tmp/hz-control.sock`。两者**完全对不上**，所以：

- 载荷在自己那个路径上监听得很开心，没有任何错误；
- Node 侧在另一个路径上连，`ENOENT`，最后 timeout；
- 唯一可见的症状就是那行日志不出现。

这不是"再调一下"的问题，而是**名字不对**。

## 修法

载荷在目标进程内部运行，可以直接 `getenv` —— 而注入器看不到目标的环境变量，
所以这件事只能由载荷自己做。新增：

```c
const char* resolve_runtime_dir();            // SNOWLUMA_HOOK_RUNTIME_DIR → XDG_RUNTIME_DIR → NULL
bool mojo_socket_path(char* out, size_t cap, const char* suffix);   // mojo.<pid>.<suffix>.sock
bool ensure_parent_dir(const char* path);     // Node 侧只读，所以目录由载荷创建
```

回落分支用 `geteuid()`，与 Node 侧的 `/tmp/snowluma-<uid>` 对齐。

`HZ_CONTROL_SOCK` 保留为**测试专用**覆盖。

## 第二个错误：recv 不是 control 加后缀

原来是"把 control 的 `.sock` 换成 `.recv.sock`"，得到：

```
mojo.<pid>.control.recv.sock      ← 错
mojo.<pid>.recv.sock              ← 对（Node 侧 mojoPipeName(pid, "recv")）
```

两个通道的名字是**各自独立构造**的，不是派生关系。改成独立推导。

## 第三个错误：recv 不回 hello

recv 通道的数据是单向的（Node 只读），容易误以为握手也不需要。
但 `connectPipe` 对**两种通道**都调用 `waitForHello()`：

```js
const hello = await this.waitForHello(kind === "recv");   // index.mjs:2442
```

只 accept 不回复 → Node 卡在 `phase=hello` 直到超时 → 症状是"recv 管道连不上"，
实际上连上了，是握手没完成。

修：recv accept 之后**先发 hello**，`msg` 带 pipe 名、`value0` 带 pid —— 因为
`resolveHello()`（index.mjs:2512）只读这两个字段：

```js
resolver.resolve({ pipeName: frame.msg, pid: Number(frame.value0), recvPipe });
```

## 验证

`test/ts_handshake_test.mjs` 用的是**从 index.mjs 抄出来**的帧布局、socket 命名
和 hello 语义（`encodeFrame`:1950、`mojoPipeName`:1827、`resolveHello`:2512），
不是自己另写一套 —— 自洽的测试无法证明与真实客户端互通。

```
control pipe connected
ok  hello magic is PIPE_MAGIC
ok  hello version is 1
ok  hello value0 is the pid  got 3012065
ok  hello msg is the control pipe name  got /run/user/1000/mojo.3012065.control.sock
recv pipe connected
ok  recv hello magic is PIPE_MAGIC
ok  recv hello msg is the recv pipe name  got /run/user/1000/mojo.3012065.recv.sock
PASS
```

## 一个测试脚手架的坑

`op 7`（登录推送）**不在**这里断言。它是 QQ 登录回调触发时发出的，而本测试的目标
是 fake_target，不是登录中的 QQ —— 断言它只会产生一个和载荷无关的永久 FAIL。
它由 `login_state_test.cc` 覆盖（直接驱动 `do_announce_login()`，也就是真实回调
调用的同一个函数）。

另：`sudo -E` 在本机被忽略（"preserving the entire environment is not supported"），
所以所有需要环境变量的注入路径都走 `sudo sh -c "VAR=... node ..."`。
