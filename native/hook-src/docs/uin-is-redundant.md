# 载荷不必提供 uin —— Node 侧本来就知道

## 结论

我原本把「载荷读不到真实 uin」记为一处缺陷。核实后发现这个判断是错的：
**账号是 Node 侧的既有事实，不需要载荷告知。**

证据（oracle 上 `/home/ubuntu/qqsl-hz`）：

```ts
// archive/status-cmd-20261119/instance.ts:79
constructor(uin, bridge, config, globalSettings) {
  this.uin = uin;
  const uinNum = Number.parseInt(uin, 10);
```

```ts
// archive/status-cmd-20261119/status-command.ts:61
if (info.uin) lines.push(`账号: ${info.uin}`);
```

`uin` 是 `Instance` 的**构造参数**，来源于 SnowLuma 自己的登录配置。
`#hz` 里的「账号: 3083456343」是它打出来的，**没有经过载荷**。

闭源实现里 `account.uin` 出现 2113 次、`selfId` 79 次、`self_id` 22 次 ——
整个 Node 侧到处都在用这个已有的值。

## 那 op 7 的 uin 字段有什么用

用来**校验**，不是用来**提供**：

- Node 侧有 `account.uin`（配置文件里的）；
- 载荷的 op 7 带着它从 QQ 那边读到的 uin；
- 两者不一致 → 说明 hook 连到了别的 QQ 账号，或者配置文件错了。

这才是那个字段的价值。而如果载荷读不到，**回「已登录、号码未知」是正确的**：
Node 侧知道自己是谁，缺的只是交叉验证，不应该因此卡住登录流程。

## 这条纠正意味着什么

之前我在 `hz_hook_login_uin()` 里返回 0 并写了长注释解释「为什么不敢编数」。
那个决定本身是对的（不编数），但**理由记错了**：我写的是
「否则 Node 侧会把消息归到不存在的账号」，而实际上 Node 侧有自己的 `this.uin`，
根本不会用载荷的值去归属。

正确的理由是：**放弃一次交叉验证的机会，比提供一个可能错的校验值要好**。
一个错的 uin 会让一致性检查得出「账号变了」的结论，而实际上没变 ——
这才是真正的危害，而且比「未知」难排查得多。

## 可行的下一步（低优先级）

真要拿到 uin，最直接的路径不是登录槽 11（它无调用者、原型未知、拿不到参数），
而是 **`MSFService` 槽 22 `SetDefaultUin`**：uin 是它的显式参数。

代价：需要先定位 `MSFService` 的**活实例**（vtable 只给类型，不给对象）。
这比 hook 一个静态 vtable 槽难一档，且与「拿到登录信号」这个真正目标无关。

所以优先级应当低于：
1. 验证 hook 在真实 QQ 上确实触发（目前只在 fake_target 上验过 vtable 定位）
2. op 17 语义
3. helper 模块解密

## 不改的东西

`hz_hook_login_uin()` 继续返回 0，`do_announce_login_unknown()` 继续发「已登录、号码未知」。
只是注释里的理由要改对 —— 这是本次核实唯一的代码改动。
