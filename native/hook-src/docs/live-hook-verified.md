# 在真实 QQ 上验证了闭源 hook 的协议

## 环境

- 容器 `hz-scan`（Debian 12，glibc **2.36**，aarch64）
- QQ PID **85885**，`/opt/QQ/qq`，wrapper.node 144,561,472 B，已运行 9h59m
- `SNOWLUMA_HOOK_RUNTIME_DIR=/tmp/runtime-1000`
- socket 从 12:59 就存在：
  `/tmp/runtime-1000/mojo.85885.{control,recv}.sock`

## 结果：TS 编解码器读通了

```
sockets: ["mojo.85885.control.sock","mojo.85885.recv.sock"]
first bytes: 51485031 01000100 00000000 00000000
  magic: 827344977 (expect 827344977)

decoded 2 frame(s):
  op=1 (hello) status=0 flags=0x0 81B
      msg: "/tmp/runtime-1000/mojo.85885.control.sock"
  op=7 (login) status=1 flags=0x4 50B
      msg: "3083456343"

login: status=1 flags=0x4
  state: {"loggedIn":true,"uin":"3083456343"}
```

## 这验证了什么（逐条对应之前的推断）

| 推断 | 验证结果 |
|---|---|
| 魔数 `0x31504851` = 827344977 | ✅ 帧首 4 字节 `51485031` |
| 版本 1 | ✅ `0100` |
| 40 字节帧头，字段顺序 | ✅ 全部字段正确解码，无错位 |
| hello 的 `msg` = 本通道路径全串 | ✅ 正是 control 的完整路径（81 字节） |
| op 7 = 登录态，`status` 非 0，`flags` bit2 | ✅ `status=1`、`flags=0x4` |
| `logged_in = (flags & 0x4) \|\| status !== 0` | ✅ 两者都为真 |
| `uin = msg \|\| value0` | ✅ `msg="3083456343"` |
| **`flags` 是 u32 不是 u16** | ✅ `0x4` 正确解出（若按 u16+reserved 会读成 `0x0004` 且 reserved 非零被拒） |

## 顺带纠正一处我自己的判断

`docs/uin-is-redundant.md` 里我把「载荷读不到 uin」定性为**不算差距**。
这次实测证明**闭源载荷能读到真实 uin**（3083456343），所以：

- 「Node 侧本来就知道账号」这条**没错**（`Instance` 构造参数）；
- 但「载荷不提供 uin 也没损失」这条**说过了头** —— 参考实现提供了这个值，
  我们没提供，**交叉验证能力确实缺失**。

`hz_hook_login_uin()` 返回 0 仍然是对的（宁可没有，不要编一个可能错的），
但这应当记为**已知能力缺口**，而不是「本来就不需要」。

## 遗留的一个发现

QQ 地址空间里有 `/memfd:nnp-resident-dispatch (deleted)` 的 4 段映射，
fd 287 由 node 用户持有。这是闭源 payload 的 **helper 模块**——
`.rodata` 尾部那 0x3960 字节加密 ELF 被 `memfd_create` + `dlopen` 后的产物。

**这是该加密 ELF 已在真实进程中运行的直接证据**，也说明我此前把它标为
「内部实现未解」是准确的：它在跑，但我们没有它的源码。

## 复验

```bash
sudo docker exec hz-scan sh -c \
  'HZ_RUNTIME_DIR=/tmp/runtime-1000 HZ_PID=85885 node /tmp/read-live.mjs'
```

脚本与 TS 构建产物需在容器内（`/tmp/read-live.mjs`、`/tmp/tsbuild/src/*.js`）。
