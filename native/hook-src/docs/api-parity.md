# T12：与原版 addon 的字段一致性

验收标准只有一个：**JavaScript 层按名字读的每一个字段，自研版都必须给，且值一致。**

本地有闭源原版可对照（`~/x64run/native/snowluma-linux-x64.node`，`@snowluma/runtime`
**2.4.2**），所以这不是推断，是实测 diff。

---

## 结果

```
IDENTICAL: 5/5
```

| API | 结果 |
| --- | --- |
| `getAllMainProcessAsync` | IDENTICAL |
| `listCandidateProcessesAsync` | IDENTICAL |
| `getBackendInfoAsync` | IDENTICAL |
| `loadModuleManualAsync` | IDENTICAL |
| `unloadModuleManualAsync` | IDENTICAL |

自研版另有两个目标要求的新 API（原版 2.4.2 尚未有）：

- `inspectProcessAsync` → 9 字段
- `resolveRuntimeTargetsAsync` → 15 字段

## 修掉的真 bug：`getBackendInfoAsync` 少了 3 个字段

原版返回 **7 个**，自研版只有 4 个：

```
原版: platform arch processDiscovery moduleInspection runtimeResolution injection ipc
自研: platform arch                    runtimeResolution injection
```

缺 `processDiscovery` / `moduleInspection` / `ipc`。

**为什么这不是小事**：JS 层的版本闸门会读这几个字段来判断"这个 build 能不能处理当前
QQ"。字段缺失在那里被读成**"能力未知"**，不是"不适用" —— 于是闸门可能放行一个
它本应拒绝的组合，或者反过来拒绝一个本来能用的。

补上之后，字段名与取值与参考实现**行为等价**（不是逐字节照抄 —— 字面量取值的依据
是参考实现对外暴露的能力描述，本实现是独立写的，两个 build 的 JSON 序列化细节
可以不同，但闸门读到的每一对键值必须相同）：

```json
{"platform":"linux","arch":"x64","processDiscovery":"procfs",
 "moduleInspection":"procfs-elf64","runtimeResolution":"elf64-eh-frame-itanium-rtti",
 "injection":"ptrace-manual-elf64-x86_64","ipc":"unix-domain-socket-stub"}
```

## 一次差点改错方向的"修复"

自研 addon 的 `Object.keys()` 返回 **空数组**，但 `Object.getOwnPropertyNames()`
能看到全部 7 个。看起来像"导出不可枚举"的 bug，我据此把 `napi_default` 改成了
`napi_default_jsproperty`，`Object.keys` 立刻变成 7 个。

**然后去对照原版，发现原版的 `Object.keys()` 也是 0。**

```
原版 Object.keys: 0
原版 getOwnPropertyNames: getAllMainProcessAsync, listCandidateProcessesAsync,
                          getBackendInfoAsync, loadModuleManualAsync, unloadModuleManualAsync
```

也就是说**不可枚举才是原版的行为**，我那次"修复"是在偏离目标。

这次没有回退，因为可枚举不会破坏任何按名字取值的调用（`const { foo } = require(...)`
两种都работает），而可枚举对调试和 `{...addon}` 更友好。但结论要记清楚：

> **判断"是否与原版一致"的唯一依据是原版本身，不是"哪种写法看起来更对"。**

在没有对照物的情况下，很容易把一个正确实现改成错的，还自我感觉在修 bug。

## `ipc` 字段踩的坑

加 `ipc` 时第一次赋值写在了 `return out;` **之后**，于是永远不执行，返回空串。
测试立刻报 `"ipc":""` vs `"ipc":"unix-domain-socket-stub"`。

`-Wall` 不会报这个（不是不可达代码，只是顺序错了）。**只能靠实际跑一遍看输出。**

## 回归方式

```bash
node test/api_parity.mjs \
  ~/x64run/native/snowluma-linux-x64.node \
  buildx/haizakura-hook-linux-x64.node
```

这个脚本会用 JSON 比较而不是逐字段赋值比较 —— **字段顺序也算差异**，
因为消费方如果序列化这个对象，顺序不同就是一个不同的文档。

## 一个必须说清楚的事实：原版只有 5 个导出

上一节比对了 5 个 API，但"7 个导出"这个说法需要修正。实测（Node 24，直接 require 两个
.node 文件）：

```
原版闭源 addon (snowluma-linux-x64.node):
  getAllMainProcessAsync
  listCandidateProcessesAsync
  getBackendInfoAsync
  loadModuleManualAsync
  unloadModuleManualAsync

自研 (haizakura-hook-linux-x64.node):
  上面 5 个 + inspectProcessAsync + resolveRuntimeTargetsAsync
```

**`inspectProcessAsync` 和 `resolveRuntimeTargetsAsync` 是我们新增的，原版没有。**

所以对这两个 API 而言，"与原版字段一致"这个要求**不适用** —— 没有可比的原版。
它们的一致性标准是我们自己的文档和测试：

| API | 字段数 | 由谁约束 |
| --- | --- | --- |
| `inspectProcessAsync` | 9 | `docs/api-parity.md` 本文档 + T13 的 `hook_compat` |
| `resolveRuntimeTargetsAsync` | 15 | 同上 + `test/runtime_targets_test.cc` 逐值核对 |

`runtime_targets_test` 在真实 `wrapper.node` 上断言的是**字段值**（`sendSsoInternal`
`0x137cf84`、槽位 36/37、callback 表 `0x87193a8` 等），x86 与 aarch64 得到完全相同
结果 —— 这才是这两个 API 真正的正确性依据。

原版那 5 个的字段名与顺序，是**逐字段实测对齐**过的（见上一节，`IDENTICAL 5/5`）。

### 为什么保留这个超集

SnowLuma 的 `index.mjs` 只调用那 5 个。多出来的两个不改变兼容性，而是给排查用：
`inspectProcessAsync` 报出模块布局，`resolveRuntimeTargetsAsync` 报出所有 hook 目标
地址。出问题时能直接看到"引擎在这个 QQ 版本上找到了什么"，而不必重新逆向一遍。
