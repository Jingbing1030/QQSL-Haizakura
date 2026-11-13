# 从源码构建

> [!WARNING]
> 本内容完全由 AI 编写，请谨慎查看。

> **面向读者**：要修改 Haizakura（原名 SnowLuma）业务逻辑并重新构建产物的开发者。
> **核心认知**：本工程的"构建"**不是**常规的 bundler 打包 ——
> 它是**按 `manifest.json` 的行号把 467 个代码切片拼回单文件**。
> 理解这一点，后面所有约束就都顺理成章了。

---

## 1. 环境要求

### 1.1 必需

| 项目 | 要求 | 说明 |
|---|---|---|
| **Node.js** | **`^24.22.1 \|\| >=26.12.1`** | ⚠️ **Node 25 不支持**（落在两个区间之外） |
| **内存** | ≥ 1 GB 空闲 | 构建只做字符串拼接，很轻 |
| **磁盘** | ~100 MB | 还原工程 26 MB + 产物 12 MB |
| **pnpm** | **不需要** | ⚠️ 见下 |
| **网络** | **不需要**（仅构建而言） | `node_modules` 是空的也能构建 |

> ✅ **构建环节不需要 pnpm、不需要 npm install。**
> `merge.mjs` 是**零依赖的纯 Node 脚本**。
> 只有走 rolldown 路线（§4）或做类型检查（§7）时才需要装依赖。

### 1.2 实测环境

```
构建成功验证于：
  Node.js   v22.23.2        ← ⚠️ 低于 engines 声明，但纯 JS 无 24 特有语法，可跑通
  平台      linux x86_64
  产物      dist/index.mjs  12,338,442 字节
  MD5       bebdc7586f6e6586be80a85cc744ae5c
            ↑ 与线上正在运行的 bundle 逐字节完全一致
```

> **关于 Node 版本**：产物 `engines` 要求 `^24.22.1 || >=26.12.1`，
> 但**构建**（拼装 + 语法检查）用 v22 也能跑通 ——
> 因为 bundle 是纯 JS，没用到 Node 24 的特有语法。
>
> **但注意区分**：**运行时**必须满足闸门要求（`check-node-version.cjs`），
> 否则 `launch.sh` 会拒绝启动。构建能跑 ≠ 能部署上去跑。

### 1.3 镜像配置（推荐：内网源快几十倍）

```bash
# npm（只有需要装依赖时才用）
npm config set registry https://mirrors.tencentyun.com/npm
```

---

## 2. 构建原理

### 2.1 先理解为什么是"拼装"而不是"打包"

**线上产物 `dist/index.mjs` 是一个 12 MB 的单文件 ESM bundle**，由 **rolldown**
（不是 Vite、不是 Rollup）产出，特征：

| 特征 | 观测值 |
|---|---|
| `//#region <路径>` / `//#endregion` 标记对 | **467 对，无嵌套** |
| `export` 语句 | **0 个**（完全扁平化，单模块作用域） |
| 模块初始化 | `init_xxx()` thunk（rolldown 的 `__esmMin` helper） |
| import 位置 | **全部提升到文件最顶部**（47 行 Node 内建 import 序言） |
| 代码压缩 | **无**（变量名、注释全保留） |
| 构建时 cwd | **`packages/core`** |

> **关键问题**：原 bundle **没有保留模块边界** —— 0 个 `export`，所有 import 被提升到顶部。
> 要重新用 rolldown 打包，必须先**逐个人工重建 367 个文件之间的 import/export 边**，
> 而 bundle 里**没有记录**这些信息（这是逆向工程中信息量最大、也最不可恢复的部分）。

**所以本工程采用两条构建路径**：

| 路径 | 命令 | 效果 |
|---|---|---|
| **A. 字节级重建（默认，已验证）** | `npm run build` | 从 467 个 region 切片拼回单文件，**逐字节等于原产物** |
| B. 真 rolldown 打包（框架就位，需补 import/export） | `npm run build:rolldown` | 需要先把 fragment 还原成真正的模块 |

> **路径 A 是当前唯一能保证与线上产物一致的方式**，也是改 bug 的推荐流程。

### 2.2 `merge.mjs` 做什么

源码 `scripts/merge.mjs` 的核心逻辑：

```js
// 1. 松散行（提升到顶部的 import 序言）保留原始行号，原样放回
const lines = new Map();
for (const raw of readFileSync('_unassigned/loose-lines.txt', 'utf8').split('\n')) {
  const tab = raw.indexOf('\t');
  lines.set(Number(raw.slice(0, tab)), raw.slice(tab + 1));
}

// 2. 按 manifest 记录的行号，把每个 region 切片铺回原位
for (const e of manifest) {
  let body = readFileSync(slicePath(e), 'utf8');
  body = body.slice(body.indexOf('// @ts-nocheck\n') + 19);  // 剥掉还原时加的注释头
  body = body.replace(/\nexport \{\};\n$/, '\n');            // 剥掉还原时加的 export {}
  const rows = body.split('\n');
  lines.set(e.start_line, `//#region ${e.region}`);
  rows.forEach((r, i) => lines.set(e.start_line + 1 + i, r));
  lines.set(e.end_line, '//#endregion');
  max = Math.max(max, e.end_line);
}

// 3. 按行号顺序输出
for (let i = 1; i <= max; i++) out.push(lines.get(i) ?? '');
```

**三个要点**：

1. **行号是唯一权威** —— `manifest.json` 里的 `start_line` / `end_line` 决定每段代码的位置
2. **`loose-lines.txt` 是 region 外的 47 行** —— 文件顶部的 `import "node:*"` 序言，逐行带原始行号
3. **会自动剥离还原时加的装饰** —— `// @ts-nocheck` 注释头、末尾的 `export {};`

### 2.3 `manifest.json` 的结构

实测统计：

```
region 总数   467
  ├─ runtime-internal    1    （rolldown 的运行时互操作 helper）
  ├─ workspace         367    （自有源码）
  └─ vendor             99    （第三方包切片）
最大 end_line  367,423
```

**单条记录的样子**：

```json
{
  "region": "\\0rolldown/runtime.js",
  "kind": "runtime-internal",
  "out": "packages/core/src/_rolldown-runtime.ts",
  "start_line": 47,
  "end_line": 86,
  "body_lines": 38,
  "body_bytes": 1454
}
```

| 字段 | 含义 |
|---|---|
| `region` | 原始 region 路径（`//#region` 后面那段） |
| `kind` | `runtime-internal` / `workspace` / `vendor` / `other` |
| `out` | 切片文件路径（相对工程根） |
| `start_line` / `end_line` | ★ **在产物中的行号**（拼装依据） |
| `body_lines` / `body_bytes` | 正文行数 / 字节数（校验用） |

**按 `kind` 分派切片路径**（`merge.mjs` 的 `slicePath()`）：

```js
if (e.kind === 'vendor') return join('vendor-regions', 'node_modules/.pnpm', /* … */);
if (e.kind === 'other')  return join('vendor-regions', '__other__', /* … */);
return e.out;   // workspace / runtime-internal
```

### 2.4 ⚠️ ★ 最重要的约束：不能增删行

```
✅ 改 region【内部】的代码  → 重建后就是你的改动
⚠️ 不要新增/删除 region，也不要动 manifest.json 的行号 —— 否则重建会错位
```

**为什么**：`merge.mjs` 是**按绝对行号**放置内容的。
你在某个 region 中间加一行、或删一行，那个 region 后面的**所有内容都会错位一位**，
产物会变成语法错误或行为错乱。

**那要加新文件怎么办？**

| 情况 | 做法 |
|---|---|
| 加一个小功能 | 把它写进**现有 region 内部**（选一个语义相近的文件） |
| 真的要加新文件 | **扩展 `manifest.json`**：新增一条记录，并**同步调整所有后续 region 的 `start_line` / `end_line`** |
| 行数变化 | `body_lines` 字段要同步更新（用于校验） |

> ⚠️ **手工调号容易错。** 如果确实需要新增文件，
> 建议写一个脚本按"插入点之后的 region 全部平移 N 行"来批量更新 `manifest.json`，
> 而不是手改。

---

## 3. 构建步骤

### 3.1 标准构建

```bash
cd <工程根>            # 例如 /sdcard/snowluma-dev/restored

# 一步到位：拼装 + 语法检查
npm run build
```

`package.json` 里的定义：

```json
"build": "node scripts/merge.mjs && node --check dist/index.mjs"
```

**实测输出**：

```
[merge] wrote /…/dist/index.mjs (12338442 bytes, 367423 lines)
[merge] original 12338350 bytes -> delta 92
```

> **`delta 92` 是什么？** 产物比原始 bundle 大 92 字节 ——
> 这是**改名**（`SnowLuma` → `Haizakura` 等品牌字符串）带来的长度差，
> **属于预期**。见 §3.4 的判读规则。

### 3.2 完整校验（推荐）

```bash
# 含：region 齐全性 + 逐字节比对 + 语法检查
npm run check
```

等价于：

```bash
node scripts/check.mjs [参考产物路径]
```

`check.mjs` 做三件事：

```
① 遍历 manifest，确认每个 region 切片文件存在且非空
     → 输出 "[check] regions: 467  missing: 0"
② 调 merge.mjs 重建
③ node --check 语法检查
     → 输出 "[check] dist/index.mjs: syntax OK"
④ 若给了参考产物：逐字节比对
     → "[check] BYTE-EXACT match with reference (…) OK"
       或 "[check] MISMATCH at byte N (rebuilt X vs ref Y)"
```

**默认参考路径是 `/tmp/sl/index.mjs`**（原分析时的临时位置），
现在通常不存在 → 会跳过比对：

```
[check] reference /tmp/sl/index.mjs not present - skipped byte comparison
```

**要真正做逐字节比对，请显式指定参考产物**：

```bash
node scripts/check.mjs /path/to/reference/index.mjs
```

### 3.3 ★ 验证构建正确性（实战方法）

**唯一可信的判据：与线上正在运行的 bundle 做 md5 比对。**

```bash
# ① 从运行中的容器/服务器取当前 bundle
ssh <服务器> 'md5sum /home/ubuntu/qqsl-new/index-hz.mjs'
# 或
docker cp <容器>:/app/runtime/index.mjs ./ref.mjs && md5sum ref.mjs

# ② 本地重建
cd <工程根> && npm run build

# ③ 比对 md5（★ 必须完全一致）
md5sum dist/index.mjs
```

**实测验证结果（本文档编写时）**：

```
线上 bundle   bebdc7586f6e6586be80a85cc744ae5c
本地重建      bebdc7586f6e6586be80a85cc744ae5c   ✅ 完全一致
```

> **md5 一致 = 逐字节一致 = 构建管线可靠。**
> 这是比"文件大小相同"强得多的证据 ——
> **大小相同内容不同的情况是真实存在的**（见 troubleshooting.md T10）。

### 3.4 怎么判读构建结果

| 现象 | 含义 | 处理 |
|---|---|---|
| md5 **与参考一致** | ✅ 构建管线完全保真 | 可以部署 |
| md5 不同，但**只差你改的那几行** | ✅ 这是你的改动，符合预期 | 走 §5 部署 |
| `delta` 是**小数值**（几十~几百字节） | ✅ 通常是字符串改名带来的长度差 | 核对一下改了什么 |
| `delta` **很大**（KB 级） | ⚠️ 可能改错了 region 或误删了内容 | 检查 `git diff` 类的差异 |
| `node --check` **报语法错** | ❌ region 被破坏（截断/错位） | 见 §8 |
| `[check] MISSING …` | ❌ 切片文件丢了 | 从备份恢复 |
| `[check] MISMATCH at byte N` | ❌ 内容确实变了 | 看 byte N 落在哪个 region |

---

## 4. 备选路径：真 rolldown 打包

**框架已就位，但当前不可用于生产产物。**

```bash
npm run build:rolldown
# = rolldown -c rolldown.config.ts
```

`rolldown.config.ts`（已生成，忠实复现原形态）：

```ts
export default defineConfig({
  input: 'packages/core/src/index.ts',
  platform: 'node',
  output: {
    dir: 'dist',
    format: 'esm',
    entryFileNames: 'index.mjs',
    inlineDynamicImports: true,   // ← 单文件形态的关键
    minify: false,                // 原产物保留可读名
    sourcemap: false,
  },
  external: [/^node:/, /^(fs|path|os|util|…)$/],
  // 其余全部内联：hono / otpauth / tar / fflate / zxcvbn / htmlparser2 ...
});
```

### 4.1 ⚠️ 为什么现在不能用

```
原 bundle 没有保留模块边界：
  · 0 个 export
  · 所有 import 被提升到文件顶部
  · 模块间依赖关系【不可恢复】

→ 直接跑 rolldown 只会打出一个空壳/报错，不会产出可运行的 12 MB bundle
```

**要让它可用，必须先做完 §6 的模块化迁移。**

### 4.2 ⚠️ rolldown 版本必须 ≤ 1.1.8

**这是硬约束** —— region 注释格式在不同版本间变了：

| rolldown | 输出注释格式 | 能否用 |
|---|---|---|
| `1.0.0` | `//#region <path>` | ✅ |
| `1.1.0` / `1.1.4` / `1.1.8` | `//#region <path>` | ✅ **推荐 1.1.8** |
| `1.2.16` | `// <path>`（**无 `#region`**） | ❌ 格式已变 |
| `1.3.2` | `// <path>` | ❌ 且 `inlineDynamicImports` 已弃用 |

**实测对比**：

```bash
# rolldown@1.3.2
$ npx rolldown -c rolldown.config.mjs
 WARN  inlineDynamicImports option is deprecated, please use codeSplitting: false instead.
✔ rolldown v1.3.2 Finished in 49.98 ms
$ grep -c '#region' out/index.mjs
0                                    # ← 1.3.2 不再输出 #region

# rolldown@1.1.8
$ npx rolldown -c rolldown.config.mjs
✔ rolldown v1.1.8 Finished in 8.55 ms
$ head -3 out/index.mjs
//#region node_modules/hono/i.js
var Hono = class {};
//#endregion                       # ← 与 bundle 一致 ✅
```

> **原工程用的 rolldown 版本无法精确确定**（bundle 里没有版本戳），
> 只能收敛到 **`≤1.1.8`** 这个区间。
>
> ⚠️ 还原工程的 `package.json` 里写的是 `"rolldown": "^1.3.2"` ——
> **这个范围会装到 1.3.x，拿不到 `#region`**。这是已知待修项，见 §9。

---

## 5. 部署到容器

### 5.1 ★★ 部署前必读：会丢登录态

```
⚠️ 重启 QQ 进程  →  loginList 被清空  →  必须重新扫码
⚠️ 重启容器      →  同样重启 QQ       →  同样丢登录态
```

**关键区分**：

| 操作 | 影响 QQ 进程吗 | 丢登录态吗 |
|---|---|---|
| **只重启 runtime 进程** | ❌ 不影响 | ✅ **不丢** |
| 重启容器 | ✅ 会 | ❌ **丢** |
| 重启 QQ 进程 | ✅ 会 | ❌ **丢** |

> **正确做法：只让 runtime 重新加载 bundle，不要碰 QQ 进程。**
> 详细原理与恢复流程见 [troubleshooting.md T2](../advanced/troubleshooting.md)。

### 5.2 部署方式：bind mount（推荐）

生产实例用的就是这个方式：

```bash
# 宿主机的文件直接映射进容器
docker inspect <容器> --format '{{json .HostConfig.Binds}}'
# → { "…/index-hz.mjs": "/app/runtime/index.mjs" }
```

**部署流程**：

```bash
# ① 备份当前线上产物（★ 必做）
cp <宿主路径>/index-hz.mjs <宿主路径>/index-hz.mjs.bak-$(date +%F-%H%M%S)

# ② 构建
cd <工程根> && npm run build

# ③ ★ 校验（传输前后都要）
md5sum dist/index.mjs
sha256sum dist/index.mjs

# ④ 传输（★ 用 base64 管道，避免二进制被改写 —— 见 troubleshooting T10）
base64 -w0 dist/index.mjs | ssh <服务器> 'base64 -d > <宿主路径>/index-hz.mjs'

# ⑤ 远程校验（★ 必须与本地一致）
ssh <服务器> 'md5sum <宿主路径>/index-hz.mjs'

# ⑥ 只重启 runtime 进程（★ 不要重启容器！）
```

### 5.3 重启 runtime 的正确姿势

**supervisord 管理着两个 program**：

```ini
[program:qq]        priority=10     ← ★ 不要碰这个
[program:snowluma]  priority=20     ← 只重启这个
```

```bash
# ✅ 只重启 runtime（保住 QQ 登录态）
docker exec <容器> supervisorctl restart snowluma

# 看状态
docker exec <容器> supervisorctl status

# ❌ 不要这样（会丢登录态）
docker restart <容器>
docker exec <容器> supervisorctl restart qq
```

> ⚠️ 若 `supervisorctl` 不可用（socket 权限），
> 可退而求其次：kill runtime 进程，让 supervisord 的 `autorestart=true` 拉起来。
> **依然不要动 QQ 进程。**

### 5.4 部署后验证

```bash
# ① runtime 起来了
docker exec <容器> sh -c 'supervisorctl status'
curl -s -o /dev/null -w 'webui=%{http_code}\n' http://127.0.0.1:5199/

# ② hook 健康（0 = 健康）
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'

# ③ ★ 端到端：真的发一条消息、真的收一条消息
```

> **不能只看"进程起来了"。** 必须做真实收发验证 ——
> 原因见 [compatibility.md §7.5](../advanced/compatibility.md)。

### 5.5 回滚

```bash
# 用 §5.2 第 ① 步的备份
base64 -w0 <宿主路径>/index-hz.mjs.bak-<时间戳> | ssh <服务器> 'base64 -d > <宿主路径>/index-hz.mjs'
ssh <服务器> 'md5sum <宿主路径>/index-hz.mjs'   # 确认回到已知good值
docker exec <容器> supervisorctl restart snowluma
```

### 5.6 发布产物的完整形态

发布产物是**一个目录**，`native/` 必须与 `index.mjs` **一起分发**：

```
dist/
├── index.mjs          ← 本 bundle
├── launcher.sh        ← 启动脚本（优先用同目录 ./node，否则回落 $PATH）
├── check-node-version.cjs
├── package.json       ← @snowluma/runtime 清单（version: 2.4.0）
├── release.json       ← { version, target: "linux-arm64", entries: [...] }
├── EULA.md / PRIVACY.md
├── client/            ← WebUI 前端静态产物（★ 源码未还原）
└── native/            ← ★ 必须同行分发
    ├── snowluma-linux-arm64.node        注入器
    ├── snowluma-linux-arm64.so          hook 后端
    ├── websocket-linux-arm64.node
    ├── ffmpeg/ffmpegAddon.linux.arm64.node
    └── sqlite/prebuilds/linux-arm64/@appthreat+sqlite3.{glibc,musl}.node
```

> ⚠️ **`native/` 缺失的后果**：WebUI 能起来，但
> **Hook / SQLite / WebSocket / ffmpeg 会降级或报错**。
> 实测日志（在没有 native 的机器上跑）：
> ```
> WARN  [Hook] process enumeration failed: No hook native addon found for linux-x64
> ```

---

## 6. 进阶：恢复成真正的多文件工程

当前 `packages/*/src/*.ts` 是**扁平化的 fragment** ——
每个文件能单独通过语法检查，但**互相看不见**（编译不了）。

**要变成真正的模块化工程，按这个顺序做**：

```
① 重建 import 图
   · 从 init_xxx() 调用序反推初始化依赖
     （已验证：15 个 init_* 定义与 15 个调用完全配对，无悬空引用）
   · 从标识符命名规律反推
     （rolldown 会给重名符号加 $1 / $2 后缀，如 fs$1、logger$2）

② 给每个文件补 export
   把被别处引用的顶层 var / function / class 导出

③ 替换 init_xxx() 为真正的 import 副作用

④ 用 npm run build:rolldown 试打包，比对 dist/index.mjs 行为
```

**建议按包逐步迁移**（依赖从少到多）：

```
common (20 文件, 1,806 行)  →  sqlite (3)  →  websocket (5)  →  bridge (17)
   →  onebot (77)  →  protocol (180)  →  core (64)
```

> **每迁完一个包就跑一次 §3 的重建做回归** —— 保证行为不变。

---

## 7. 类型检查与测试

```bash
# 类型检查（需要装 typescript）
npm run typecheck
# = tsc -p tsconfig.json

# 测试
npm run test
# = node --test scripts/*.test.cjs
```

**⚠️ `typecheck` 的实际价值有限**：

```jsonc
// tsconfig.json 的关键设置
{
  "strict": false,
  "noImplicitAny": false,
  "noEmit": true,
  "allowJs": true
}
```

原因：**还原出的 `.ts` 文件里类型标注已被擦除**（TS → JS 编译后类型全丢），
每个文件头都加了 `// @ts-nocheck`。它们**是精确的 JS，不是原版 TS**。

**保留的**：变量/函数名、类结构、注释、字符串、逻辑。
**丢失的**：`interface` / `type` / 泛型参数、参数与返回类型、`private` 等修饰符、枚举。

---

## 8. 构建故障排查

### 8.1 `node --check` 报语法错

```
症状：npm run build 在第二步失败
根因：region 被破坏（截断、错位、多/少了一行）
```

```bash
# ① 定位是哪个 region
#    看报错行号，对照 manifest.json 找覆盖该行号的 region
python3 -c "
import json
m = json.load(open('manifest.json'))
n = <报错行号>
for e in m:
    if e['start_line'] <= n <= e['end_line']:
        print(e['out'], e['region'], e['start_line'], e['end_line'])
"

# ② 检查该切片文件的完整行数
wc -l <切片文件>

# ③ 与 manifest 的 body_lines 比对
#    manifest 说 body_lines=N，切片应含 N 行正文（+ 还原头 + export {};）
```

**恢复**：从备份/归档重新取该切片，**不要手工修补**（容易错位更多）。

### 8.2 `[check] MISSING <path>`

```
根因：某个 region 切片文件不存在或为空
```

```bash
# 从归档重新解出
ls /sdcard/snowluma-takeover-20261112.tgz
# 或从 takeover 包里的 restored/ 复制对应文件
```

### 8.3 产物能构建但启动失败

```bash
# 先做最小化冒烟测试（隔离 HOME，不碰生产）
cd dist
SNOWLUMA_DEV_NO_NATIVE=1 SNOWLUMA_DEV_MODE=1 node index.mjs
```

**预期的日志**（说明主流程正常）：

```
INFO  [App] SnowLuma starting
INFO  [WebUI] listening http://127.0.0.1:5399
WARN  [Hook] process enumeration failed: No hook native addon found for linux-x64
        ↑ 预期：本机是 x64，只有 arm64 的 native 产物
```

**HTTP 层的预期行为**：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5399/
# → 404   （前端 client/ 未构建，是设计行为）

curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5399/api/state
# → 401   （鉴权正常拦截，是设计行为）
```

> **404 和 401 都是"设计行为"，不是构建失败。**
> 判据：只要 WebUI 能监听、`ss -ltnp` 能看到端口、能优雅退出（SIGTERM），
> 就说明 **libuv / 网络 / 日志 / HTTP 路由 / 协商关闭这一整套主流程完全正常**。

### 8.4 改了配置/源码但不生效

**排查顺序**：

```
① 改了源码 region？          → 需要 npm run build 重建 + 部署
② 改的是 package.json？       → 只影响依赖，不影响产物（产物是自包含的）
③ 改的是容器里的配置文件？     → ★ 运行时不热加载！见 troubleshooting T1
④ 改对了容器吗？             → 确认不是改到了已停止的旧容器（T9）
```

### 8.5 内存/长任务相关

```bash
# 构建本身很轻（纯字符串拼接，几秒），但如果跑 rolldown 或 tsc：
#   · 长任务必须后台跑 + 轮询日志（SSH 空闲会断连）
setsid nohup npm run build:rolldown > ~/build.log 2>&1 < /dev/null &
tail -c 800 ~/build.log | tr '\r' '\n' | tail -10
#                          ↑ 进度条是回车不换行，必须转换
```

> ⚠️ **不要用 `/tmp` 放大文件**（若是 tmpfs，会吃内存）。
> 本工程 26 MB 不大，但归档/解包请用 `~/` 或工程目录。

---

## 9. 版本锁定要求

### 9.1 ★ 依赖必须用精确版本，不要用 `^`

**规则**：写 `"hono": "4.13.13"`，**不要**写 `"hono": "^4.13.13"`。

**原因是一次真实的踩坑**：用 caret 范围装了一遍，
npm 解析出的版本与 bundle 内的**不一致 —— 6 个包发生漂移**：

| 包 | bundle 内 | `^` 会装到 | 判定 |
|---|---|---|---|
| `hono` | `4.13.13` | **`4.13.18`** | ❌ 漂移 |
| `@hono/node-server` | `2.1.5` | **`2.1.8`** | ❌ 漂移 |
| `otpauth` | `9.5.1` | **`9.6.0`** | ❌ 漂移 |
| `tar` | `7.5.22` | **`7.5.23`** | ❌ 漂移 |
| `@zxcvbn-ts/core` | `4.1.2` | **`4.2.0`** | ❌ 漂移 |
| `semver` | `7.7.4` | **`7.8.6`** | ❌ 漂移 |
| `htmlparser2` | `10.0.0` | **`10.1.0`** | ❌ 漂移 |

> **精确版本清单见 [compatibility.md §4.1](../advanced/compatibility.md)。**

### 9.2 ⚠️ 已知待修项：还原工程里的 `^` 与 rolldown 范围

**以下两处与上面的规则冲突，属于已知待修项：**

| 位置 | 当前值 | 应该是 | 影响 |
|---|---|---|---|
| `packages/*/package.json` 的 `dependencies` | `^4.13.13` 等 | `4.13.13`（去掉 `^`） | 装依赖时会漂移 6 个包 |
| 根 `package.json` 的 `devDependencies.rolldown` | `^1.3.2` | `1.1.8`（精确） | 走 rolldown 路线时拿不到 `//#region` |

> **注意**：这两项**不影响默认的 `npm run build`** ——
> `merge.mjs` 零依赖，不读 `node_modules`。
> 只有走 `build:rolldown` 路线或需要装依赖时才会被影响。

### 9.3 Node 版本

**构建侧**：宽松（v22 实测可跑通）。
**运行侧**：严格（`^24.22.1 || >=26.12.1`，Node 25 是空洞）。

---

## 10. 完整构建清单

```bash
# ═══ 准备 ═══
cd <工程根>                        # 例如 /sdcard/snowluma-dev/restored
node -v                            # 建议 ≥ 22（构建侧宽松）

# ═══ 改代码 ═══
# ★ 只改 region【内部】的代码
# ★ 不要增删 region，不要动 manifest.json 的行号
# 文件头有 // @ts-nocheck 和说明注释，merge.mjs 会自动剥离，不用管

# ═══ 构建 ═══
npm run build                      # 拼装 + 语法检查

# ═══ 校验 ═══
node scripts/check.mjs /path/to/reference/index.mjs   # 齐全性 + 逐字节 + 语法
md5sum dist/index.mjs                                 # 与线上对比

# ═══ 冒烟（可选，隔离环境）═══
cd dist && SNOWLUMA_DEV_NO_NATIVE=1 SNOWLUMA_DEV_MODE=1 node index.mjs

# ═══ 部署（★ 注意登录态）═══
cp <宿主路径>/index-hz.mjs <宿主路径>/index-hz.mjs.bak-$(date +%F-%H%M%S)
base64 -w0 dist/index.mjs | ssh <服务器> 'base64 -d > <宿主路径>/index-hz.mjs'
ssh <服务器> 'md5sum <宿主路径>/index-hz.mjs'          # 校验传输
docker exec <容器> supervisorctl restart snowluma     # ★ 只重启 runtime

# ═══ 验证 ═══
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'   # 0 = 健康
# ★ 端到端：真的发一条消息、真的收一条消息
```

---

## 11. 相关文档

| 想了解 | 去看 |
|---|---|
| 它到底怎么工作的 | [architecture.md](../advanced/architecture.md) |
| 支持哪些版本 / 依赖什么 | [compatibility.md](../advanced/compatibility.md) |
| 出问题怎么排查 | [troubleshooting.md](../advanced/troubleshooting.md) |
| 怎么参与开发 | [contributing.md](contributing.md) |

---

*构建流程已实测：产物 `dist/index.mjs` 12,338,442 字节，
MD5 `bebdc7586f6e6586be80a85cc744ae5c` —— 与线上正在运行的 bundle 逐字节一致。*
