# `[Hook] pipe connected` —— 实测通过

目标要求的三件事之一：SnowLuma 日志里出现 `[Hook] pipe connected`。
**本轮实测达成**，用的是真正的 SnowLuma 主程序 + 我们的 addon + 我们的载荷。

## 怎么跑的

```
/home/ubuntu/x64run-hz/            SnowLuma 完整运行环境（TS 层 + WebUI + OneBot）
  native/snowluma-linux-x64.node  ← 换成我们的 haizakura-hook-linux-x64.node
  native/snowluma-linux-x64.so    ← 换成我们的 payload.so
  node                            ← 24.22.3（SnowLuma 要求 ^24.22.1 || >=26.12.1）
  config/runtime.json             ← hookAutoLoad: false → true
```

目标进程：`fake_target --name qq`，映射假的 `wrapper.node`。改名是必要的 ——
addon 的 `getAllMainProcessAsync` 只找名为 `qq` 的进程（**原版也一样**，实测两个
addon 都返回空数组），这是 harness 的事，不是缺陷。

## 实测日志

```
17:04:09 INFO [App] SnowLuma starting
17:04:09 INFO [App] hook auto-load enabled: every discovered QQ process will be injected
17:04:09 INFO [WebUI] listening http://127.0.0.1:5099
17:04:11 WARN [QQHook.Runtime] Client private-message reporting is unavailable: PID=3018964 status=-1 reason=1
17:04:11 INFO [Hook] awaiting login: PID=3018964
17:04:11 INFO [Hook] pipe connected: PID=3018964
        ↑ 这一行
```

`status=-1 reason=1` 表示"还没登录" —— 目标不是真 QQ，登录回调不会触发，
这是预期结果，不是失败。

注意 `awaits login` 与 `pipe connected` **同时**出现：载荷一开始就处于未登录状态，
并在连接后主动推送了 op 7（`logged_in=0`），所以 SnowLuma 能立刻进入"等待登录"，
而不是等一个永远不会来的状态变化。这条路径是 `do_announce_login` 在 accept 时
发现 `g_logged_in != 0` 才发；未登录时不发，由 SnowLuma 按默认状态处理。

## 之前为什么不出现

一句话：**socket 名字不对**。（详见 `docs/socket-naming.md`）

载荷写死 `/tmp/hz-control.sock`，SnowLuma 连
`<runtimeDir>/mojo.<pid>.control.sock`。两者从未相遇，且没有任何错误日志 ——
载荷监听得很成功，Node 侧只是连不上，最后超时。唯一症状就是那行日志不出现。

修完之后 `[Hook] pipe connected` 立刻出现。

## 这一轮的陷阱清单

跑通之前踩了六个，全部记在这里，因为每个都值得单独避免：

| 现象 | 原因 |
| --- | --- |
| `error: requires Node.js ^24.22.1` | 本机 PATH 是 22.23.2；`x64run/node` 放 24.22.3 |
| 发现进程返回 `[]` | `fake_target` 的 comm 不是 `qq`（原版也返回空，行为一致） |
| `sudo -E` 无效 | 本机不支持，必须 `sudo sh -c "VAR=... cmd"` |
| 注入器 `READY` 后立刻退出 | `await new Promise(()=>{})` 触发 unsettled top-level await 警告并退出，改成 `setInterval` |
| `node -e` 位置参数错位 | 改用环境变量传参 |
| 相对路径在 `sudo sh -c` 里失效 | 脚本里全部转成绝对路径 |

## 复现

```bash
cd /home/ubuntu/hook-rewrite/buildx
./fake_target --orphan /tmp/qq.pid --heartbeat /tmp/qq.hb --threads 8 --name qq &
cd /home/ubuntu/x64run-hz && sudo ./launcher.sh 2>&1 | grep "pipe connected"
```
