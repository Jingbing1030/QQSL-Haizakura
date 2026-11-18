# Building from source

> [!WARNING]
> This content was written entirely by AI; review it with care.

> **Audience**: developers who want to modify Haizakura's (formerly SnowLuma's) business logic and rebuild the artifact.
> **The key insight**: this project's "build" is **not** a conventional bundler package —
> it **stitches 467 code slices back into a single file at the line numbers recorded in `manifest.json`**.
> Once you understand that, every constraint below follows naturally.

---

## 1. Environment requirements

### 1.1 Required

| Item | Requirement | Notes |
|---|---|---|
| **Node.js** | **`^24.22.1 \|\| >=26.12.1`** | ⚠️ **Node 25 is unsupported** (it falls outside both ranges) |
| **Memory** | ≥ 1 GB free | The build only concatenates strings; it is very light |
| **Disk** | ~100 MB | Restored project 26 MB + artifact 12 MB |
| **pnpm** | **Not needed** | ⚠️ See below |
| **Network** | **Not needed** (for the build alone) | It builds even with an empty `node_modules` |

> ✅ **The build needs no pnpm and no npm install.**
> `merge.mjs` is a **zero-dependency pure Node script**.
> Dependencies are only needed for the rolldown path (§4) or type checking (§7).

### 1.2 Measured environment

```
构建成功验证于：
  Node.js   v22.23.2        ← ⚠️ 低于 engines 声明，但纯 JS 无 24 特有语法，可跑通
  平台      linux x86_64
  产物      dist/index.mjs  12,338,442 字节
  MD5       bebdc7586f6e6586be80a85cc744ae5c
            ↑ 与线上正在运行的 bundle 逐字节完全一致
```

> **About the Node version**: the artifact's `engines` requires `^24.22.1 || >=26.12.1`,
> but the **build** (assembly + syntax check) also works on v22 —
> because the bundle is plain JS and uses no Node 24-specific syntax.
>
> **But keep the distinction clear**: the **runtime** must satisfy the gate
> (`check-node-version.cjs`), or `launch.sh` refuses to start. Building successfully is not the same as being deployable.

### 1.3 Registry configuration (recommended: intranet mirrors are dozens of times faster)

```bash
# npm（只有需要装依赖时才用）
npm config set registry https://mirrors.tencentyun.com/npm
```

---

## 2. How the build works

### 2.1 First, why it is "assembly" rather than "bundling"

**The production artifact `dist/index.mjs` is a 12 MB single-file ESM bundle** produced by **rolldown**
(not Vite, not Rollup), with these characteristics:

| Characteristic | Observed value |
|---|---|
| `//#region <path>` / `//#endregion` marker pairs | **467 pairs, no nesting** |
| `export` statements | **0** (fully flattened, single module scope) |
| Module initialization | `init_xxx()` thunks (rolldown's `__esmMin` helper) |
| Import placement | **All hoisted to the very top of the file** (a 47-line Node builtin import preamble) |
| Code minification | **None** (variable names and comments all preserved) |
| Build-time cwd | **`packages/core`** |

> **The key problem**: the original bundle **does not preserve module boundaries** — 0 `export`s, all imports hoisted to the top.
> To re-bundle with rolldown you would first have to **manually reconstruct the import/export edges between 367 files**,
> and the bundle **does not record** that information (it is the most information-dense and least recoverable part of the reverse engineering).

**So this project has two build paths**:

| Path | Command | Effect |
|---|---|---|
| **A. Byte-level rebuild (default, verified)** | `npm run build` | Stitches the 467 region slices back into a single file, **byte-for-byte equal to the original artifact** |
| B. Real rolldown bundling (scaffolding in place, needs import/export filled in) | `npm run build:rolldown` | Requires first turning the fragments back into real modules |

> **Path A is currently the only way to guarantee consistency with the production artifact**, and it is the recommended flow for fixing bugs.

### 2.2 What `merge.mjs` does

The core logic of `scripts/merge.mjs`:

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

**Three key points**:

1. **Line numbers are the sole authority** — `start_line` / `end_line` in `manifest.json` determine where each piece of code goes.
2. **`loose-lines.txt` holds the 47 lines outside any region** — the `import "node:*"` preamble at the top of the file, each line carrying its original line number.
3. **Decoration added during restoration is stripped automatically** — the `// @ts-nocheck` comment header and the trailing `export {};`.

### 2.3 The structure of `manifest.json`

Measured statistics:

```
region 总数   467
  ├─ runtime-internal    1    （rolldown 的运行时互操作 helper）
  ├─ workspace         367    （自有源码）
  └─ vendor             99    （第三方包切片）
最大 end_line  367,423
```

**A single record looks like this**:

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

| Field | Meaning |
|---|---|
| `region` | The original region path (the part after `//#region`) |
| `kind` | `runtime-internal` / `workspace` / `vendor` / `other` |
| `out` | Slice file path (relative to the project root) |
| `start_line` / `end_line` | ★ **Line numbers in the artifact** (the basis for assembly) |
| `body_lines` / `body_bytes` | Body line count / byte count (for verification) |

**Slice paths are dispatched by `kind`** (`slicePath()` in `merge.mjs`):

```js
if (e.kind === 'vendor') return join('vendor-regions', 'node_modules/.pnpm', /* … */);
if (e.kind === 'other')  return join('vendor-regions', '__other__', /* … */);
return e.out;   // workspace / runtime-internal
```

### 2.4 ⚠️ ★ The most important constraint: never add or remove lines

```
✅ 改 region【内部】的代码  → 重建后就是你的改动
⚠️ 不要新增/删除 region，也不要动 manifest.json 的行号 —— 否则重建会错位
```

**Why**: `merge.mjs` places content **by absolute line number**.
If you add or remove a line in the middle of a region, **everything after that region shifts by one**,
and the artifact becomes a syntax error or misbehaves.

**So what if you need to add a new file?**

| Situation | Approach |
|---|---|
| Add a small feature | Write it **inside an existing region** (pick a file with similar semantics) |
| You really do need a new file | **Extend `manifest.json`**: add a record, and **adjust the `start_line` / `end_line` of every subsequent region in step** |
| Line counts changed | Update the `body_lines` field accordingly (it is used for verification) |

> ⚠️ **Manual renumbering is error-prone.** If you genuinely need a new file,
> write a script that shifts every region after the insertion point by N lines and updates `manifest.json` in bulk
> rather than editing it by hand.

---

## 3. Build steps

### 3.1 Standard build

```bash
cd <工程根>            # 例如 /sdcard/snowluma-dev/restored

# 一步到位：拼装 + 语法检查
npm run build
```

As defined in `package.json`:

```json
"build": "node scripts/merge.mjs && node --check dist/index.mjs"
```

**Measured output**:

```
[merge] wrote /…/dist/index.mjs (12338442 bytes, 367423 lines)
[merge] original 12338350 bytes -> delta 92
```

> **What is `delta 92`?** The artifact is 92 bytes larger than the original bundle —
> the length difference introduced by the **rename** (`SnowLuma` → `Haizakura` and similar branding strings),
> and **expected**. See the interpretation rules in §3.4.

### 3.2 Full verification (recommended)

```bash
# 含：region 齐全性 + 逐字节比对 + 语法检查
npm run check
```

which is equivalent to:

```bash
node scripts/check.mjs [参考产物路径]
```

`check.mjs` does three things:

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

**The default reference path is `/tmp/sl/index.mjs`** (a temporary location from the original analysis);
it usually does not exist now, so the comparison is skipped:

```
[check] reference /tmp/sl/index.mjs not present - skipped byte comparison
```

**To do a real byte-for-byte comparison, pass the reference artifact explicitly**:

```bash
node scripts/check.mjs /path/to/reference/index.mjs
```

### 3.3 ★ Verifying build correctness (the practical method)

**The only trustworthy criterion: compare md5 against the bundle actually running in production.**

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

**Measured result (at the time this document was written)**:

```
线上 bundle   bebdc7586f6e6586be80a85cc744ae5c
本地重建      bebdc7586f6e6586be80a85cc744ae5c   ✅ 完全一致
```

> **Matching md5 = byte-for-byte identical = the build pipeline is reliable.**
> This is far stronger evidence than "the file sizes match" —
> **files with the same size but different content do occur in practice** (see troubleshooting.md T10).

### 3.4 Interpreting build results

| Observation | Meaning | Action |
|---|---|---|
| md5 **matches the reference** | ✅ The build pipeline is fully faithful | Safe to deploy |
| md5 differs, but **only in the lines you changed** | ✅ That is your change, as expected | Proceed to §5 deployment |
| `delta` is a **small value** (tens to hundreds of bytes) | ✅ Usually the length difference from string renames | Double-check what changed |
| `delta` is **very large** (KB scale) | ⚠️ You may have modified the wrong region or dropped content | Inspect a `git diff`-style comparison |
| `node --check` **reports a syntax error** | ❌ A region was damaged (truncated/misplaced) | See §8 |
| `[check] MISSING …` | ❌ A slice file is gone | Restore from backup |
| `[check] MISMATCH at byte N` | ❌ The content really did change | See which region byte N falls in |

---

## 4. Alternative path: real rolldown bundling

**The scaffolding is in place, but it is not currently usable for production artifacts.**

```bash
npm run build:rolldown
# = rolldown -c rolldown.config.ts
```

`rolldown.config.ts` (already generated, faithfully reproducing the original shape):

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

### 4.1 ⚠️ Why it cannot be used yet

```
原 bundle 没有保留模块边界：
  · 0 个 export
  · 所有 import 被提升到文件顶部
  · 模块间依赖关系【不可恢复】

→ 直接跑 rolldown 只会打出一个空壳/报错，不会产出可运行的 12 MB bundle
```

**To make it usable you must first complete the modularization migration in §6.**

### 4.2 ⚠️ The rolldown version must be ≤ 1.1.8

**This is a hard constraint** — the region comment format changed between versions:

| rolldown | Output comment format | Usable |
|---|---|---|
| `1.0.0` | `//#region <path>` | ✅ |
| `1.1.0` / `1.1.4` / `1.1.8` | `//#region <path>` | ✅ **1.1.8 recommended** |
| `1.2.16` | `// <path>` (**no `#region`**) | ❌ Format changed |
| `1.3.2` | `// <path>` | ❌ And `inlineDynamicImports` is deprecated |

**Measured comparison**:

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

> **The rolldown version used by the original project cannot be pinned down exactly** (the bundle carries no version stamp),
> so we can only narrow it to **`≤1.1.8`**.
>
> ⚠️ The restored project's `package.json` says `"rolldown": "^1.3.2"` —
> **that range installs 1.3.x, which produces no `#region`**. This is a known outstanding item; see §9.

---

## 5. Deploying to a container

### 5.1 ★★ Read before deploying: it loses the login session

```
⚠️ 重启 QQ 进程  →  loginList 被清空  →  必须重新扫码
⚠️ 重启容器      →  同样重启 QQ       →  同样丢登录态
```

**The critical distinction**:

| Operation | Affects the QQ process | Loses the login session |
|---|---|---|
| **Restart the runtime process only** | ❌ No | ✅ **No** |
| Restart the container | ✅ Yes | ❌ **Yes** |
| Restart the QQ process | ✅ Yes | ❌ **Yes** |

> **Correct approach: make only the runtime reload the bundle; do not touch the QQ process.**
> For the full explanation and recovery flow, see [troubleshooting.md T2](../advanced/troubleshooting.md).

### 5.2 Deployment method: bind mount (recommended)

This is what the production instance uses:

```bash
# 宿主机的文件直接映射进容器
docker inspect <容器> --format '{{json .HostConfig.Binds}}'
# → { "…/index-hz.mjs": "/app/runtime/index.mjs" }
```

**Deployment flow**:

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

### 5.3 The right way to restart the runtime

**supervisord manages two programs**:

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

> ⚠️ If `supervisorctl` is unavailable (socket permissions),
> you can fall back to killing the runtime process and letting supervisord's `autorestart=true` bring it back.
> **Still do not touch the QQ process.**

### 5.4 Post-deployment verification

```bash
# ① runtime 起来了
docker exec <容器> sh -c 'supervisorctl status'
curl -s -o /dev/null -w 'webui=%{http_code}\n' http://127.0.0.1:5199/

# ② hook 健康（0 = 健康）
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'

# ③ ★ 端到端：真的发一条消息、真的收一条消息
```

> **Do not stop at "the process is up".** You must verify a real send and receive —
> for why, see [compatibility.md §7.5](../advanced/compatibility.md).

### 5.5 Rollback

```bash
# 用 §5.2 第 ① 步的备份
base64 -w0 <宿主路径>/index-hz.mjs.bak-<时间戳> | ssh <服务器> 'base64 -d > <宿主路径>/index-hz.mjs'
ssh <服务器> 'md5sum <宿主路径>/index-hz.mjs'   # 确认回到已知good值
docker exec <容器> supervisorctl restart snowluma
```

### 5.6 The full shape of a release artifact

A release artifact is **a directory**, and `native/` must be **distributed together with** `index.mjs`:

```
dist/
├── index.mjs          ← 本 bundle
├── launcher.sh        ← 启动脚本（优先用同目录 ./node，否则回落 $PATH）
├── check-node-version.cjs
├── package.json       ← @snowluma/runtime 清单（version: 0.2.4.2）
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

> ⚠️ **Consequence of a missing `native/`**: the WebUI still starts, but
> **Hook / SQLite / WebSocket / ffmpeg degrade or error out**.
> Measured log (running on a machine without native artifacts):
> ```
> WARN  [Hook] process enumeration failed: No hook native addon found for linux-x64
> ```

---

## 6. Advanced: restoring a real multi-file project

Today `packages/*/src/*.ts` are **flattened fragments** —
each file passes a syntax check on its own, but they **cannot see each other** (they do not compile).

**To turn this into a real modular project, work in this order**:

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

**Migrate package by package** (from fewest dependencies to most):

```
common (20 文件, 1,806 行)  →  sqlite (3)  →  websocket (5)  →  bridge (17)
   →  onebot (77)  →  protocol (180)  →  core (64)
```

> **After each package, run the §3 rebuild as a regression check** — it guarantees behavior is unchanged.

---

## 7. Type checking and tests

```bash
# 类型检查（需要装 typescript）
npm run typecheck
# = tsc -p tsconfig.json

# 测试
npm run test
# = node --test scripts/*.test.cjs
```

**⚠️ `typecheck` has limited practical value**:

```jsonc
// tsconfig.json 的关键设置
{
  "strict": false,
  "noImplicitAny": false,
  "noEmit": true,
  "allowJs": true
}
```

Why: **the type annotations were erased from the restored `.ts` files** (types are all lost after TS → JS compilation),
and every file header carries `// @ts-nocheck`. They **are exact JS, not the original TS**.

**Preserved**: variable and function names, class structure, comments, strings, logic.
**Lost**: `interface` / `type` / generic parameters, parameter and return types, modifiers such as `private`, enums.

---

## 8. Build troubleshooting

### 8.1 `node --check` reports a syntax error

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

**Recovery**: take the slice from a backup or archive again; **do not patch it by hand** (it is easy to misalign more).

### 8.2 `[check] MISSING <path>`

```
根因：某个 region 切片文件不存在或为空
```

```bash
# 从归档重新解出
ls /sdcard/snowluma-takeover-20261112.tgz
# 或从 takeover 包里的 restored/ 复制对应文件
```

### 8.3 The artifact builds but fails to start

```bash
# 先做最小化冒烟测试（隔离 HOME，不碰生产）
cd dist
SNOWLUMA_DEV_NO_NATIVE=1 SNOWLUMA_DEV_MODE=1 node index.mjs
```

**Expected log** (indicating the main flow is healthy):

```
INFO  [App] SnowLuma starting
INFO  [WebUI] listening http://127.0.0.1:5399
WARN  [Hook] process enumeration failed: No hook native addon found for linux-x64
        ↑ 预期：本机是 x64，只有 arm64 的 native 产物
```

**Expected HTTP behavior**:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5399/
# → 404   （前端 client/ 未构建，是设计行为）

curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5399/api/state
# → 401   （鉴权正常拦截，是设计行为）
```

> **Both 404 and 401 are "by design", not build failures.**
> The criterion: as long as the WebUI listens, `ss -ltnp` shows the port, and it shuts down gracefully (SIGTERM),
> then **the whole main flow — libuv / networking / logging / HTTP routing / negotiated shutdown — is working**.

### 8.4 Configuration or source changed but has no effect

**Check in this order**:

```
① 改了源码 region？          → 需要 npm run build 重建 + 部署
② 改的是 package.json？       → 只影响依赖，不影响产物（产物是自包含的）
③ 改的是容器里的配置文件？     → ★ 运行时不热加载！见 troubleshooting T1
④ 改对了容器吗？             → 确认不是改到了已停止的旧容器（T9）
```

### 8.5 Memory and long-running tasks

```bash
# 构建本身很轻（纯字符串拼接，几秒），但如果跑 rolldown 或 tsc：
#   · 长任务必须后台跑 + 轮询日志（SSH 空闲会断连）
setsid nohup npm run build:rolldown > ~/build.log 2>&1 < /dev/null &
tail -c 800 ~/build.log | tr '\r' '\n' | tail -10
#                          ↑ 进度条是回车不换行，必须转换
```

> ⚠️ **Do not put large files in `/tmp`** (if it is tmpfs, that consumes memory).
> This project is only 26 MB, but archive and extract under `~/` or the project directory.

---

## 9. Version pinning requirements

### 9.1 ★ Dependencies must use exact versions, not `^`

**The rule**: write `"hono": "4.13.13"`, **not** `"hono": "^4.13.13"`.

**The reason is a real pitfall we hit**: installing once with caret ranges produced versions that
**did not match** those inside the bundle — **6 packages drifted**:

| Package | In the bundle | What `^` installs | Verdict |
|---|---|---|---|
| `hono` | `4.13.13` | **`4.13.18`** | ❌ Drift |
| `@hono/node-server` | `2.1.5` | **`2.1.8`** | ❌ Drift |
| `otpauth` | `9.5.1` | **`9.6.0`** | ❌ Drift |
| `tar` | `7.5.22` | **`7.5.23`** | ❌ Drift |
| `@zxcvbn-ts/core` | `4.1.2` | **`4.2.0`** | ❌ Drift |
| `semver` | `7.7.4` | **`7.8.6`** | ❌ Drift |
| `htmlparser2` | `10.0.0` | **`10.1.0`** | ❌ Drift |

> **The exact version list is in [compatibility.md §4.1](../advanced/compatibility.md).**

### 9.2 ⚠️ Known outstanding items: the `^` ranges and the rolldown range in the restored project

**The following two conflict with the rule above and are known outstanding items:**

| Location | Current value | Should be | Impact |
|---|---|---|---|
| `dependencies` in `packages/*/package.json` | `^4.13.13` etc. | `4.13.13` (drop the `^`) | 6 packages drift when installing dependencies |
| `devDependencies.rolldown` in the root `package.json` | `^1.3.2` | `1.1.8` (exact) | The rolldown path produces no `//#region` |

> **Note**: neither of these **affects the default `npm run build`** —
> `merge.mjs` has zero dependencies and does not read `node_modules`.
> They only matter on the `build:rolldown` path or when dependencies must be installed.

### 9.3 Node version

**Build side**: lenient (v22 works in practice).
**Runtime side**: strict (`^24.22.1 || >=26.12.1`; Node 25 is a gap).

---

## 10. Complete build checklist

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

## 11. Related documentation

| To learn about | Go to |
|---|---|
| How it actually works | [architecture.md](../advanced/architecture.md) |
| Supported versions / dependencies | [compatibility.md](../advanced/compatibility.md) |
| How to troubleshoot problems | [troubleshooting.md](../advanced/troubleshooting.md) |
| How to contribute | [contributing.md](contributing.md) |

---

*The build flow has been verified in practice: the artifact `dist/index.mjs` is 12,338,442 bytes,
MD5 `bebdc7586f6e6586be80a85cc744ae5c` — byte-for-byte identical to the bundle running in production.*
