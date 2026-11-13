# `scripts/build.mjs` — 支持「新增源文件」的构建方式

> **方案 C**：保留 `merge.mjs`（字节保真），新增 `build.mjs`（开发模式，支持新增文件）。
> **不改动** `merge.mjs` / `check.mjs` / `manifest.json` / 任何现有 slice。

---

## ⚠️ 三条硬性规则（先读这个）

### 1. 禁止手改现有 slice 的行数
`merge.mjs` 按 **manifest 的绝对行号**落位，所以：

| 操作 | `merge.mjs` 输出 | `node --check` | 真实后果 |
| --- | --- | --- | --- |
| slice **加** 1 行 | **`delta 0`** | ✅ 通过 | 多出的行**被静默丢弃** |
| slice **减** 1 行 | `delta -55` | ✅ 通过 | 该 region **尾部被下一 region 覆盖** |

**两种情况现有工具链都察觉不到。** `build.mjs` 每次构建都用 `body_lines` 复查并硬报错。
若确实要增删行，**必须同步更新 `manifest.json` 的 `body_lines` / `end_line`**（并接受产物不再字节一致）。

### 2. 新增文件不要写自己的 `import` / 真 `export`
bundle 是**一个扁平作用域**、**零 export**（`inlineDynamicImports` 的必然结果）。
- 需要 `node:fs` 等直接用 —— 文件顶部 46 行已 hoist 好 `fs`、`path`、`crypto$1` 等标识符。
- 结尾写 `export { };` **仅供编辑器识别**，构建时会被剥掉；写真正的 `export function` 会被硬报错拦下。

### 3. 新文件的顶层名字不能与 bundle 重名
现有 467 个 region 贡献 **8392 个**顶层名。重名 = **静默互相覆盖**。
`build.mjs` 会逐个检查并报错（实测零误报）。

---

## 1. 用法速查

```bash
cd restored/

# ① 只校验基线（不写文件）——最常用
node scripts/build.mjs --verify-base

# ② 完整开发构建：467 region 原样 + manifest-extra.json 里的新模块
node scripts/build.mjs

# ③ 字节保真重建（忽略新增，等价 merge.mjs）
node scripts/build.mjs --base-only

# ④ 给新文件推荐插入点（写配置前先跑这个）
node scripts/build.mjs --suggest-insert packages/xxx/src/my-new-file.ts

# ⑤ 老流程仍然可用，行为不变
node scripts/merge.mjs      # -> delta 0 / delta 92
node scripts/check.mjs

# ⑥ 用示例配置跑一遍（不动 manifest-extra.json）
node scripts/build.mjs --extra manifest-extra.example.json

# ⑦ 跑起来
node dist/index.mjs
```

### 仓库里的文件

| 路径 | 作用 |
| --- | --- |
| `scripts/build.mjs` | 构建脚本（本文件描述的对象） |
| `manifest-extra.json` | **你要维护的**新增模块清单；初始为空 `{"modules": []}` |
| `manifest-extra.example.json` | 填好的示例（含 run / lazy / after_inits 三种写法），**不要直接改它** |
| `examples/*.ts` | 示例新模块：`build-demo-probe.ts`（依赖已有代码）、`dev-authored-example.ts`（run）、`dev-lib-example.ts`（lazy） |
| `reference/pristine-index.mjs` | 原始 SnowLuma 产物（sha256 `9875467b…`），字节基准 |
| `reference/haizakura-index.mjs` | 当前 Haizakura 产物（sha256 `d86359ed…`），字节基准 |

> `reference/` 里两份基准都在：`build.mjs` 会自动挑与当前树**逐字节相同**的那份来比，
> 所以两种树都能得到 `BYTE-EXACT`。若 `reference/` 为空，则退化为 `--expect-base` 尺寸检查。

| 参数 | 作用 |
| --- | --- |
| `--verify-base` | 只校验基线一致性，**不写任何文件** |
| `--suggest-insert <file>` | 扫描新文件引用的 bundle 名字，**推荐 `insert` 值**，然后退出 |
| `--base-profile pristine\|haizakura` | 断言重建基线等于已知版本（**比 delta 更严格**） |
| `--base-only` | 忽略新增配置，只做字节保真重建 |
| `--extra <file>` | 换一个新增模块清单（默认 `manifest-extra.json`） |
| `--ref <bundle>` | 显式指定参照产物 |
| `--out <file>` | 输出路径，默认 `dist/index.mjs` |
| `--no-check` / `--no-strict` / `--banner` | 跳过语法检查 / 不因基线异常失败 / 首行加生成注释 |

### `--verify-base` 的两种通过方式

```
① 自动挑选匹配的参照 → base reproduction: BYTE-EXACT
   本仓库 reference/ 下同时放了 pristine 与 haizakura 两份，
   build.mjs 会挑与当前树**逐字节相同**的那份来比，所以两种树都能得到 BYTE-EXACT。
② 用已知版本哈希断言  → --base-profile pristine | haizakura
   哈希本身就是「身份证明」：证明当前树逐字节等于某个已知产物。
```

> 从 pristine 树切到 Haizakura 树时，**必须**指定 `--base-profile haizakura`
> （或让 `reference/` 里有对应产物），否则会被判为「slice 被改动」而失败。

---

## 2. 新增一个文件：完整流程

**第 1 步** 写文件（行数完全自由）：

```ts
// packages/onebot/src/network/satori-server-adapter.ts
// 类型标注可写，build.mjs 用 stripTypeScriptTypes 剥掉。
function satoriServerAdapterStart(port: number): string {
  const log = createLogger("Satori");        // 来自 bundle，直接可用
  log.info("satori adapter on %d", port);
  return `satori:${port}`;
}
process.stdout.write(`[satori] ${satoriServerAdapterStart(5600)}\n`);
export { };
```

**第 2 步** 问构建系统该插到哪：

```bash
node scripts/build.mjs --suggest-insert packages/onebot/src/network/satori-server-adapter.ts
```
```
  bundle names referenced (2):
    createLogger             function/class (hoisted) ../common/src/logger.ts  ends 1651  [init_logger]
    UIN_SLOT_WIDTH           value binding            ../common/src/logger.ts  ends 1651  [init_logger]

  suggested: "insert": "after:../common/src/logger.ts"   (bundle line 1652)
  suggested: "after_inits": ["logger"]
```

**第 3 步** 写进 `manifest-extra.json`：

```json
{
  "modules": [
    {
      "out":    "packages/onebot/src/network/satori-server-adapter.ts",
      "region": "src/satori-server-adapter.ts",
      "insert": "after:../common/src/logger.ts",
      "after_inits": ["logger"],
      "mode":   "run"
    }
  ]
}
```

**第 4 步** 构建 + 验证：

```bash
node scripts/build.mjs                    # node --check 自动跑
node dist/index.mjs                       # 实跑
node scripts/merge.mjs && node scripts/check.mjs   # 老流程仍然 OK
```

### 配置字段

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `id` / `out` / `file` | 路径 | 三者任选一：`id` 是逻辑名；`out`/`file` 是仓库内相对路径（推荐 `out`） |
| `region` | 字符串 | 仅用于 `//#region` 注释和自动生成的 `init_*` 名字 |
| `insert` | `end`(默认) / `before:<region>` / `after:<region>` / `line:<N>` | 插入点，见下 |
| `mode` | `run`(默认) / `lazy` / `inline` | 见下 |
| `deps` | `["<新模块 id>"]` 或 `["<已有 region>"]` | 已有的 region 会**跳过**（顺序由 `insert` 保证）；新模块会先生成调用 `init_*()` |
| `after_inits` | `["logger"]` / `["init_logger"]` | 显式调用**已有 region** 的 `init_*()` thunk |
| `enabled` | `false` | 临时停用，不删配置 |
| `label` | 字符串 | 覆盖 `//#region` 显示名 |

### 插入点怎么选（关键）

`<region>` 就是 `manifest.json` 的 `region` 字段，例如 `src/index.ts`、`../common/src/logger.ts`。

| 目标 | `insert` |
| --- | --- |
| 只定义、被回调调用 | `end`（最安全） |
| 模块顶端用到 `createLogger` 等 | `--suggest-insert` 给的 `after:<region>` |
| 要在启动主流程**之前**跑 | `before:src/index.ts` |
| 定义要早、执行要晚 | `mode: "lazy"`，之后在别处调 `init_<id>()` |

> ⚠️ **插入点是唯一会静默出错的地方**：放早了，`node --check` 照样通过，
> 只有**运行时**才 `TypeError`（实测：`before:../common/src/logger.ts` → `Cannot convert undefined or null to object`）。
> 所以务必用 `--suggest-insert`，并且**实跑一次**。
>
> ⚠️ `manifest.json` **末条就是 `src/index.ts`**（`end_line` 367423 = bundle 总行数），
> 即**入口是最后一个 region**。所以纯 `end` 追加 = 在主程序启动**之后**才初始化。

### 三种 mode

- **`run`**（默认）：`var init_x = __esmMin((() => {...}));` + 插入点**立刻** `init_x();`
  （幂等、只跑一次，与 rolldown 模块语义一致）。
- **`lazy`**：只定义 thunk，不自动调用。之后在**任何已有 region 的源码里**写一行
  `init_x();`（同一作用域），由 entry 决定初始化时机。
- **`inline`**：正文原样贴入，不包 thunk。只有需要真正的 ESM `export` 时才用。

> 💡 `__esmMin` 定义在 `\0rolldown/runtime.js` region（bundle 第 54 行），
> 所以 **`end` 位置也能安全使用**。

---

## 3. 为什么不做“真模块化”（方案 D）

实测数据（不是估计）：

| 观测 | 数值 |
| --- | --- |
| 367 个 workspace slice 中的 `import` 语句 | **0** |
| 303 个 `export` | **全部是裸 `export {}`** |
| 全文件 `export` 语句 | **0** |
| `init_*` thunk 定义 | **15** |
| slice 里的 TS 语法（interface/type/`: string`） | **0**（已是纯 JS） |

→ 这 368 个 `.ts` **不是模块，而是 368 段按顺序拼接的普通 JavaScript**。
依赖图必须从零手工重建，且**没有权威依据可校验**。
`rolldown.config.ts` 也跑不起来（`UNRESOLVED_ENTRY: Cannot resolve entry module src/index.ts`）。
**`pnpm run build:rolldown` 一直是不可用状态，不是“未验证”。**

rolldown 版本线索（实地装两个版本验证过）：

| 版本 | region 注释 | 尾部 |
| --- | --- | --- |
| 1.1.8 | `//#region src/a.ts` ✅ 与产物一致 | `export {  };` |
| 1.2.16 | `// src/a.ts` ❌ | `export {  };` |

产物用 `//#region` 且**没有**尾部 `export {}` → 应是更早版本或配了后处理。
**结论：不要试图用 rolldown 复刻该产物。**

（LLBot 参考：`/tmp/llex/llbot.js.map` 是 **webpack** 产物，547 source 全带
`sourcesContent`，304/321 保留 `import` —— **与 SnowLuma 形态相反**，无法借鉴。）

---

## 4. 常见坑速查

| 症状 | 原因 | 解决 |
| --- | --- | --- |
| `delta 0` 但改动没生效 | 给 slice 加行 → 多出的行被丢弃 | 不要改行数；把新代码放进**新文件** |
| 运行时报 `Cannot convert undefined or null to object` | 插入点太早，值绑定还没初始化 | 用 `--suggest-insert` |
| `top-level name "xxx" is already declared` | 与 8392 个已有顶层名撞车 | 改名（加前缀） |
| `real ESM exports are impossible here` | 写了真正的 `export` | 去掉；同一作用域直接互相调用 |
| `a new module cannot have its own imports` | 写了 `import` | 去掉，用已 hoist 的标识符 |
| `line-count drift in ...` | 某 slice 被改了行数 | 恢复该 slice；或同步改 `manifest.json` |
| `base identity not proven` | 换了品牌/树但没声明 | `--base-profile haizakura` |
| `Cannot find module '.../index.mjs'` | 产物不在 `dist/` 或没叫 `index.mjs` | 产物名/位置**不可改**（它用 `import.meta.url` 推安装根目录找 `native/`、`dist/client/`） |

## 5. 运行环境

```bash
SNOWLUMA_DEV_MODE=1 SNOWLUMA_DEV_WEBUI=1 \
SNOWLUMA_ACCEPT_EULA=1 SNOWLUMA_ACCEPT_PRIVACY=1 \
SNOWLUMA_LOG_DIR=$PWD/_logs \
node dist/index.mjs        # -> [App] Haizakura starting / [WebUI] listening http://127.0.0.1:5099
```
- 本机 linux-x64 **无 hook native addon**（产物是 linux-arm64）→ 刷
  `No hook native addon found for linux-x64`，非致命，但完整功能需 arm64。
- bundle **会自我 re-exec 一次**（worker），stdout 重复两遍属正常。

## 6. 验证状态（本机实测）

```
① --verify-base（Haizakura 树）  → BYTE-EXACT 12338442 / sha256 d86359ed63b8
② --verify-base（pristine 树）   → BYTE-EXACT 12338350 / sha256 9875467bcbeb
③ merge.mjs 未改动               → delta 0 / delta 92
④ check.mjs                      → 467 regions / missing 0 / syntax OK
⑤ 新增模块构建 + 实跑             → [satori-like] width=12 labelCount=6
                                   + [App] Haizakura starting + [WebUI] listening
⑥ 错误插入点                     → 运行时 TypeError（证明顺序是真实生效的）
⑦ 行数漂移/名字撞车/真 export/自建 import/非法 insert → 全部硬报错拦下
```
