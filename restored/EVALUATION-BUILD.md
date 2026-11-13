# SnowLuma bundle 构建系统改造评估报告

**日期**：2026-11-13 · **环境**：腾讯云 x86_64 · Node v22.23.2
**对象**：SnowLuma（第三方 QQ 客户端运行时）还原后的 monorepo 构建方式
**结论**：**推荐方案 C**（`merge.mjs` 字节保真 + 新增 `build.mjs` 开发模式）。
已给出**实测可运行的原型**（见 `scripts/build.mjs`），未改动任何交付树。

---

## 0. 先说三个必须先纠正的前提

调研发现任务描述里的部分环境事实与实际不符，这些直接影响方案选择：

| 任务描述 | 实际情况 |
| --- | --- |
| 工作目录 `/sdcard/snowluma-dev/restored/` | **不存在**。`/sdcard/snowluma-dev/` 下只有 `reference/satori/`（48 个文件） |
| 有 `git` | 两份还原工程**都不是 git 仓库**，`git status` 报 *not a repository* |
| `dist/index.mjs` 原产物 12,338,350 字节 | 确实如此，但**唯一权威副本在** `snowluma-takeover/archive/snowluma-archive-core.tgz` 里（`check.mjs` 默认找的 `/tmp/sl/index.mjs` 在 tmpfs 上已丢失，其字节校验实际**空转**） |
| — | 实际有两份工程：`snowluma-restore/restored/`（**干净**，dist sha256 `9875467b…`）与 `snowluma-takeover/restored/`（**另一 agent 正在改**：SnowLuma→Haizakura，23 个 slice 改了文本但行数不变） |

---

## 1. 现状：`merge.mjs` 到底能做什么、不能做什么

`merge.mjs` 维护一张 `行号 → 内容` 的 Map，把 467 个 slice 按 manifest 的**绝对行号**落位。

| 操作 | 能否支持 | 实测结果 |
| --- | --- | --- |
| 改 slice 内容（行数不变） | ✅ | `delta 9`，内容确实生效 |
| **改 slice 行数** | ❌ **静默损坏** | 见下 |
| **新增文件** | ❌ | manifest 里没有它的行号区间 |

### ⚠️ 最危险的发现：行数漂移是**静默**损坏

实测（在隔离副本里）：

| 操作 | `merge.mjs` 输出 | `node --check` | 实际后果 |
| --- | --- | --- | --- |
| 某 slice **加 1 行** | **`delta 0`** | ✅ 通过 | 多出的行**被静默丢弃**（`grep` 找不到） |
| 某 slice **减 1 行** | `delta -55` | ✅ 通过 | 该 region **尾部被下一 region 的开头覆盖** |

两种情况下 `merge.mjs`/`check.mjs` 都**不会报错**。也就是说：
**只要有人改了一个 slice 的行数，产物就是坏的，而现有工具链察觉不到。**
这本身就是需要修的缺陷（方案 C 用 `body_lines` 复查 + 字节比对双闸解决）。

---

## 2. 决定方案选择的结构性事实（实测硬数据）

这一节是全部结论的基础。对 bundle 逐字节分析后：

| 观测 | 数值 | 含义 |
| --- | --- | --- |
| workspace region / vendor / runtime | 367 / 99 / 1 = **467** | 与任务描述一致 |
| 367 个 workspace slice 中的 **`import` 语句** | **0** | 依赖边**完全没被保留** |
| 303 个 `export` | **全部是裸 `export {}`** | **零具名导出** |
| 全文件 `export` 语句 | **0** | 确为 `inlineDynamicImports` 单文件产物 |
| `init_*` thunk 定义 / `__esmMin` 调用 | **15 / 15** | `init_xxx()` 模式**只在顶层少数模块**用 |
| `__esmMin` / `__commonJSMin` / `__toESM` | 16 / 8 / 2 | 用到 bundler helper 的模块很少 |
| 顶层声明名总数 | **8392** | 新代码重名会**静默互相覆盖** |
| slice 里的 TS 语法（interface/type/`: string`） | **0** | **slice 已经是纯 JavaScript**（类型早被原构建擦掉） |

**结论**：这 368 个 `.ts` **不是模块，而是 368 段按顺序拼接的普通 JavaScript**，
共享一个扁平作用域（文件顶部 46 行把全部 `import` hoist 上去）。
`node --check` 能通过就是它俩都是合法 JS 的直接证据。

### rolldown 版本线索（已实地验证）

| 版本 | 输出的 region 注释 | 尾部 |
| --- | --- | --- |
| **1.1.8** | `//#region src/a.ts` ✅ **与产物一致** | `export {  };` |
| **1.2.16** | `// src/a.ts` ❌ | `export {  };` |

产物用的是 `//#region` 格式，且**没有尾部 `export {  };`**
→ 原产物应是更早的 rolldown 或配了额外后处理。**不要试图用 rolldown 复刻该产物。**

### LLBot 参考（甲骨文 `/tmp/llex/llbot.js.map`）

webpack 产物，547 个 source **全部带 `sourcesContent`**；321 个 `src` 里 **304 个保留 `import`、320 个保留 `export`**。
**它与 SnowLuma 是相反的形态** —— LLBot 保留了完整模块图，所以能重新打包；
SnowLuma 已被 rolldown 拍平成零 import。**LLBot 的路子在此无法借鉴**，
它恰好反证了「只有存在真实模块边界时才谈得上方案 D」。

---

## 3. 四方案评估

### A. 追加区（append section）
- **可行性**：可行。
- **工作量**：小。
- **风险**：**低**，但**表达力不足**。
- **致命限制**：新模块只能定义在 bundle **末尾**。而 `src/index.ts`（最后一个 region）
  里已经执行了 `init_log_file_transport(); init_logger(); init_runtime();` 和整个启动流程——
  追加在后面意味着**只能被事件回调调用，无法参与初始化顺序**。
- **实测**：作为方案 C 的一部分已验证可用（`insert: "end"`）。

### B. 行号重排（动态重算）
- **可行性**：可行。
- **工作量**：中。
- **风险**：**高，且收益为零**。
- **否决理由**：要改 `merge.mjs`，直接摧毁「字节级保真」这条**唯一可验证的生命线**；
  而它想解决的问题（新增文件）方案 C 已经解决，且不需要放弃保真。
  另外 `init_xxx()` 顺序依赖区域的相对次序，一旦从「原序」变成「重算序」就失去了权威依据。

### C. 双模式（`merge.mjs` 保真 + 新增 `build.mjs`）✅ **推荐**
- **可行性**：**已实测通过**（原型在工作区内跑通）。
- **工作量**：**小**（约 1 天，原型已完成）。
- **风险**：**低**（不动现有文件，纯新增）。
- **做法**：`build.mjs` 一次构建出两个东西：
  1. 467 个 region 仍**按绝对行号原样落位** → 基线**逐字节一致**；
  2. `manifest-extra.json` 里的新模块按 **region 相对插入点**
     （`before:<region>` / `after:<region>` / `end`）拼进去，
     包成 rolldown 风格 `__esmMin` thunk，支持 `run`/`lazy`/`inline` + `deps` 排序。
- **关键收益**：新文件的行数**完全自由**（不占 manifest 的行号空间），
  因此**根本不需要方案 B 的重排行号**。
- **顺序控制**：三种插入点 + `lazy` 模式，足以覆盖
  「定义要早、执行要晚」和「必须等某 region 的 `init_` 跑完」两类需求。

### D. 真实模块化 + rolldown 重打包
- **可行性**：**结构性不可行**（不是工作量大，是缺信息）。
- **工作量**：极大。
- **否决理由**：
  1. 367 个 slice **零 `import`**、零具名导出 → 依赖图**必须从零手工重建**，
     而重建结果**没有任何权威依据可以校验**（不像字节比对那样有唯一正确答案）。
  2. `rolldown.config.ts` 现有配置**跑不起来**：入口 `packages/core/src/index.ts`
     里有 `init_log_file_transport();` 这类调用，rolldown 报
     `UNRESOLVED_ENTRY: Cannot resolve entry module src/index.ts`。
     实测 rolldown 1.1.8 / 1.2.16 均失败。
  3. 即便勉强还原，产物与原始 12MB bundle 的差异将**不可验证** ——
     等于用「可验证的保真」换「不可验证的正确」。
- **何时才值得做**：如果将来打算**彻底脱离上游产物**、用自研入口取代
  `src/index.ts`，那 D 才有意义；那时也应新建独立入口，而不是改造现有 slice。

---

## 4. 推荐与实施步骤

**推荐 C。** 理由一句话：它是唯一**同时**保住「现有重建仍逐字节一致」和
「新增文件可被正确拼装且顺序可控」的方案，且已验证、工作量最小。

实施步骤（**每步都不改现有 slice**；`merge.mjs`/`check.mjs` 保持原样）：

1. `cp scripts/build.mjs` 到 `restored/scripts/`（新文件）。
2. `cp modern 的 pristine 产物` 到 `restored/pristine-index.mjs`（作为 `--ref` 基准）。
3. 新建 `restored/manifest-extra.json`（`{"regions": []}` 起步）。
4. 跑 `node scripts/build.mjs --verify-base --ref pristine-index.mjs` → 期望 **BYTE-EXACT**。
5. 跑 `node scripts/merge.mjs`（→ `delta 0`）与 `node scripts/check.mjs` → 确认**向后兼容**。
6. 加示例新模块 + `manifest-extra.json` 条目 → 构建 → `node --check` → 实跑验证。
7. （可选）`package.json` 加 `"build:dev": "node scripts/build.mjs"`，**不改** 现有 `build`。

---

## 5. 意外约束清单

1. **`merge.mjs` 行数漂移静默损坏**（§1）—— 现有工具链无法察觉，建议尽快用 `build.mjs` 的检查补上。
2. **产物必须叫 `dist/index.mjs`**：bundle 用 `path.dirname(fileURLToPath(import.meta.url))`
   推安装根目录去找 `native/`、`dist/client/`；改名/换目录会 `Cannot find module`。
3. **新模块不能有自己的 `import`**（顶层 import 在单作用域里是 SyntaxError）；
   需要 `node:fs` 等直接用 —— 文件顶部已 hoist 好 `fs`、`path`、`crypto$1` 等标识符。
4. **新模块不能写真正的 `export`**（产物零 export）。尾部 `export {}` 仅供编辑器识别，构建时被剥掉。
5. **8392 个已有顶层名**，重名会静默覆盖 → 必须做名字校验。
6. **`__esmMin` 可用性**：它定义在 `\0rolldown/runtime.js` region（第 54 行），
   所以连 `end` 位置也能安全使用。
7. **运行需要环境变量**，否则可能联网/失败：
   `SNOWLUMA_DEV_MODE=1 SNOWLUMA_DEV_WEBUI=1 SNOWLUMA_ACCEPT_EULA=1 SNOWLUMA_ACCEPT_PRIVACY=1`。
   本机 linux-x64 **无 hook native addon**（产物是 linux-arm64），会刷
   `No hook native addon found for linux-x64` —— 非致命，但完整功能需 arm64。
8. **bundle 会自我 re-exec 一次**（worker），所以 stdout 会重复打印两遍，属正常。
9. **Node 版本**：用 Node 22.23.2 跑通；`package.json` 里写 `engines: ^24.22.1 || >=26.12.1`，
   与实际验证环境不符（未阻塞）。

---

## 6. 验证记录（全部实测）

| # | 验证项 | 结果 |
| --- | --- | --- |
| 1 | `build.mjs --verify-base` | **BYTE-EXACT 12,338,350 bytes, sha256=9875467bcbebb9e1** |
| 2 | `node scripts/merge.mjs`（未改动） | `delta 0` |
| 3 | `node scripts/check.mjs` | 467 regions / missing 0 / syntax OK |
| 4 | 新增模块构建 | `node --check` OK，`delta 450` |
| 5 | **实跑新增模块** | `[my-new-feature] hello reviewer from a brand-new module` |
| 6 | **实跑应用本体** | `[App] SnowLuma starting` + `[WebUI] listening http://127.0.0.1:5099` |
| 7 | 插入点 `after:<region>` / `before:<region>` | 分别落到 1652 行 / 367280 行，正确 |
| 8 | `lazy` + `deps` 顺序 | 定义在 1652、调用在 367291，顺序正确 |
| 9 | 故障注入：行数漂移 | ✅ 硬报错拦下 |
| 10 | 故障注入：顶层名撞车 | ✅ 硬报错拦下（零误报，实测 8392 名中仅 1 个自重复） |
| 11 | 故障注入：真 `export` | ✅ 硬报错拦下 |
| 12 | 故障注入：非法 `insert` 目标 | ✅ 清晰报错，不抛栈 |

---

## 7. 附带发现（供接手参考）

`snowluma-takeover/restored/` 那份的改品牌**是可复现的**：
23 个 slice 改了文本、467 个 slice 行数**全部未变**，`merge.mjs` 能从它自己的 slice
重建出 12,338,442 字节（`delta 92`）并与它的 `dist` 一致。
但 **`check.mjs` 的参考路径 `/tmp/sl/index.mjs` 已丢失**，所以它的字节校验是空转的 ——
换名后应把 `--ref` 指向真正的原始产物（交付包 archive 里那份）。
