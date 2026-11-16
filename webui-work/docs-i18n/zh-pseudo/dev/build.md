# 自源碼構築

> [!WARNING]
> 本内容完全由 AI 編写、請慎重閲覧。

> **対象読者**：欲改 Haizakura（原名 SnowLuma）業務邏輯而再構築産物之開発者。
> **核心認知**：本工程之「構築」**非**常規 bundler 打包 ——
> 其者**按 `manifest.json` 之行号将 467 個代码切片拼回単文件**也。
> 解此一点、則後述所有約束皆順理成章。

---

## 1. 環境要求

### 1.1 必須

| 項目 | 要求 | 説明 |
|---|---|---|
| **Node.js** | **`^24.22.1 \|\| >=26.12.1`** | ⚠️ **Node 25 不支援**（落於二区間之外） |
| **記憶体** | ≥ 1 GB 空閑 | 構築只作文字列拼接、甚軽 |
| **磁盤** | ~100 MB | 還原工程 26 MB + 産物 12 MB |
| **pnpm** | **不需要** | ⚠️ 見下 |
| **網絡** | **不需要**（僅構築而言） | `node_modules` 為空亦能構築 |

> ✅ **構築環節不需 pnpm、不需 npm install。**
> `merge.mjs` 者**零依存之純 Node 脚本**也。
> 唯走 rolldown 路（§4）或作類型検査（§7）時方需装依存。

### 1.2 実測環境

```
構築成功験証於：
  Node.js   v22.23.2        ← ⚠️ 低於 engines 宣言、然純 JS 無 24 特有語法、可跑通
  平台      linux x86_64
  産物      dist/index.mjs  12,338,442 字节
  MD5       bebdc7586f6e6586be80a85cc744ae5c
            ↑ 与線上正在運行之 bundle 逐字节完全一致
```

> **関於 Node 版本**：産物 `engines` 要求 `^24.22.1 || >=26.12.1`、
> 然**構築**（拼装 + 語法検査）用 v22 亦能跑通 ——
> 因 bundle 者純 JS、未用 Node 24 之特有語法。
>
> **然須区別**：**運行時**必須滿足閘門要求（`check-node-version.cjs`）、
> 否則 `launch.sh` 会拒絶起動。構築能跑 ≠ 能部署上去跑。

### 1.3 鏡像設定（推薦：内網源快数十倍）

```bash
# npm（只有需要装依赖时才用）
npm config set registry https://mirrors.tencentyun.com/npm
```

---

## 2. 構築原理

### 2.1 先解為何為「拼装」而非「打包」

**線上産物 `dist/index.mjs` 者 12 MB 之単文件 ESM bundle 也**、由 **rolldown**
（非 Vite、非 Rollup）産出、特徴：

| 特徴 | 観測値 |
|---|---|
| `//#region <路徑>` / `//#endregion` 標記対 | **467 対、無嵌套** |
| `export` 語句 | **0 個**（完全扁平化、単模組作用域） |
| 模組初期化 | `init_xxx()` thunk（rolldown 之 `__esmMin` helper） |
| import 位置 | **全部提升至文件最頂**（47 行 Node 内建 import 序言） |
| 代码圧縮 | **無**（変数名、註釋全保留） |
| 構築時 cwd | **`packages/core`** |

> **関鍵問題**：原 bundle **未保留模組辺界** —— 0 個 `export`、所有 import 被提升至頂。
> 欲再用 rolldown 打包、必須先**逐個人工重建 367 個文件間之 import/export 辺**、
> 而 bundle 里**未記録**此等信息（此者逆向工程中信息量最大、亦最不可復原之部分）。

**故此工程採用二条構築路**：

| 路 | 命令 | 効果 |
|---|---|---|
| **A. 字節級重建（既定、已験証）** | `npm run build` | 自 467 個 region 切片拼回単文件、**逐字節等於原産物** |
| B. 真 rolldown 打包（框架已就位、需補 import/export） | `npm run build:rolldown` | 需先将 fragment 還原為真正之模組 |

> **路 A 者当前唯一能保証与線上産物一致之方式也**、亦為改 bug 之推薦流程。

### 2.2 `merge.mjs` 作何事

源碼 `scripts/merge.mjs` 之核心邏輯：

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

**三要点**：

1. **行号者唯一権威也** —— `manifest.json` 里之 `start_line` / `end_line` 決定毎段代码之位置
2. **`loose-lines.txt` 者 region 外之 47 行也** —— 文件頂部之 `import "node:*"` 序言、逐行帯原始行号
3. **会自動剥離還原時所加之装飾** —— `// @ts-nocheck` 註釋頭、末尾之 `export {};`

### 2.3 `manifest.json` 之結構

実測統計：

```
region 総数   467
  ├─ runtime-internal    1    （rolldown 之運行時互操作 helper）
  ├─ workspace         367    （自有源碼）
  └─ vendor             99    （第三方程包切片）
最大 end_line  367,423
```

**単条記録之貌**：

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
| `region` | 原始 region 路徑（`//#region` 後面那段） |
| `kind` | `runtime-internal` / `workspace` / `vendor` / `other` |
| `out` | 切片文件路徑（相対工程根） |
| `start_line` / `end_line` | ★ **在産物中之行号**（拼装依拠） |
| `body_lines` / `body_bytes` | 正文行数 / 字節数（校験用） |

**按 `kind` 分派切片路徑**（`merge.mjs` 之 `slicePath()`）：

```js
if (e.kind === 'vendor') return join('vendor-regions', 'node_modules/.pnpm', /* … */);
if (e.kind === 'other')  return join('vendor-regions', '__other__', /* … */);
return e.out;   // workspace / runtime-internal
```

### 2.4 ⚠️ ★ 最重要之約束：不能増刪行

```
✅ 改 region【内部】之代码  → 重建後即為汝之改動
⚠️ 勿新增/刪除 region、亦勿動 manifest.json 之行号 —— 否則重建会錯位
```

**為何**：`merge.mjs` 者**按絶対行号**放置内容也。
汝在某 region 中間加一行、或刪一行、該 region 後之**所有内容皆会錯位一位**、
産物会変為語法錯誤或行為錯乱。

**然欲加新文件奈何？**

| 情況 | 做法 |
|---|---|
| 加一小機能 | 将其写入**現有 region 内部**（択一語義相近之文件） |
| 真要加新文件 | **拡張 `manifest.json`**：新增一条記録、並**同步調整所有後続 region 之 `start_line` / `end_line`** |
| 行数変化 | `body_lines` 字段須同步更新（用於校験） |

> ⚠️ **手工調号易錯。** 若確需新增文件、
> 建議写一脚本按「插入点之後之 region 全部平移 N 行」批量更新 `manifest.json`、
> 而非手改。

---

## 3. 構築步驟

### 3.1 標準構築

```bash
cd <工程根>            # 例如 /sdcard/snowluma-dev/restored

# 一步到位：拼装 + 语法检查
npm run build
```

`package.json` 里之定義：

```json
"build": "node scripts/merge.mjs && node --check dist/index.mjs"
```

**実測輸出**：

```
[merge] wrote /…/dist/index.mjs (12338442 bytes, 367423 lines)
[merge] original 12338350 bytes -> delta 92
```

> **`delta 92` 者何也？** 産物比原始 bundle 大 92 字節 ——
> 此者**改名**（`SnowLuma` → `Haizakura` 等品牌文字列）所致之長度差、
> **属於預期**。見 §3.4 之判読規則。

### 3.2 完全校験（推薦）

```bash
# 含：region 齐全性 + 逐字节比对 + 语法检查
npm run check
```

等価於：

```bash
node scripts/check.mjs [参考产物路径]
```

`check.mjs` 作三事：

```
① 遍历 manifest、確認毎個 region 切片文件存在且非空
     → 輸出 "[check] regions: 467  missing: 0"
② 呼 merge.mjs 重建
③ node --check 語法検査
     → 輸出 "[check] dist/index.mjs: syntax OK"
④ 若給了参考産物：逐字节比対
     → "[check] BYTE-EXACT match with reference (…) OK"
       或 "[check] MISMATCH at byte N (rebuilt X vs ref Y)"
```

**既定参考路徑者 `/tmp/sl/index.mjs`**（原分析時之臨時位置）、
今通常不存在 → 会跳過比対：

```
[check] reference /tmp/sl/index.mjs not present - skipped byte comparison
```

**欲真作逐字節比対、請明示指定参考産物**：

```bash
node scripts/check.mjs /path/to/reference/index.mjs
```

### 3.3 ★ 験証構築之正確性（実戦方法）

**唯一可信之判拠：与線上正在運行之 bundle 作 md5 比対。**

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

**実測験証結果（本文档編写時）**：

```
線上 bundle   bebdc7586f6e6586be80a85cc744ae5c
本地重建      bebdc7586f6e6586be80a85cc744ae5c   ✅ 完全一致
```

> **md5 一致 = 逐字節一致 = 構築管線可靠也。**
> 此者比「文件大小相同」強甚多之証拠 ——
> **大小相同而内容不同之情況実在也**（見 troubleshooting.md T10）。

### 3.4 如何判読構築結果

| 現象 | 含义 | 処理 |
|---|---|---|
| md5 **与参考一致** | ✅ 構築管線完全保真 | 可部署 |
| md5 不同、然**只差汝改之数行** | ✅ 此者汝之改動、符合預期 | 経 §5 部署 |
| `delta` 為**小値**（数十~数百字節） | ✅ 通常為文字列改名所致之長度差 | 核対改了何物 |
| `delta` **甚大**（KB 級） | ⚠️ 可能改錯 region 或誤刪内容 | 検査 `git diff` 類之差異 |
| `node --check` **報語法錯** | ❌ region 被破壊（截断 / 錯位） | 見 §8 |
| `[check] MISSING …` | ❌ 切片文件已失 | 自備份復原 |
| `[check] MISMATCH at byte N` | ❌ 内容確已変 | 看 byte N 落於何 region |

---

## 4. 代替路：真 rolldown 打包

**框架已就位、然当前不可用於生産産物也。**

```bash
npm run build:rolldown
# = rolldown -c rolldown.config.ts
```

`rolldown.config.ts`（已生成、忠実復現原形態）：

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

### 4.1 ⚠️ 為何今不能用

```
原 bundle 未保留模組边界：
  · 0 個 export
  · 所有 import 被提升至文件頂部
  · 模組間依存関係【不可復原】

→ 直接跑 rolldown 只打出空殻/報錯、不産出可運行之 12 MB bundle
```

**欲使其可用、必須先完 §6 之模組化遷移。**

### 4.2 ⚠️ rolldown 版本必須 ≤ 1.1.8

**此者硬約束也** —— region 註釋格式在不同版本間已変：

| rolldown | 輸出註釋格式 | 能否用 |
|---|---|---|
| `1.0.0` | `//#region <path>` | ✅ |
| `1.1.0` / `1.1.4` / `1.1.8` | `//#region <path>` | ✅ **推薦 1.1.8** |
| `1.2.16` | `// <path>`（**無 `#region`**） | ❌ 格式已変 |
| `1.3.2` | `// <path>` | ❌ 且 `inlineDynamicImports` 已弃用 |

**実測比対**：

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

> **原工程所用之 rolldown 版本無法精確確定**（bundle 里無版本戳）、
> 只能収斂至 **`≤1.1.8`** 此区間。
>
> ⚠️ 還原工程之 `package.json` 里所写者 `"rolldown": "^1.3.2"` ——
> **此範囲会装到 1.3.x、不能得 `#region`**。此者已知待修項、見 §9。

---

## 5. 部署至容器

### 5.1 ★★ 部署前必読：会失登録態

```
⚠️ 再起動 QQ 工程  →  loginList 被清空  →  必須再掃碼
⚠️ 再起動容器      →  同様再起動 QQ   →  同様失登録態
```

**関鍵区別**：

| 操作 | 影響 QQ 工程乎 | 失登録態乎 |
|---|---|---|
| **只再起動 runtime 工程** | ❌ 不影響 | ✅ **不失** |
| 再起動容器 | ✅ 会 | ❌ **失** |
| 再起動 QQ 工程 | ✅ 会 | ❌ **失** |

> **正確做法：只令 runtime 再載入 bundle、勿觸 QQ 工程。**
> 詳細原理与復旧流程見 [troubleshooting.md T2](../advanced/troubleshooting.md)。

### 5.2 部署方式：bind mount（推薦）

生産実例所用者即此法：

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

### 5.3 再起動 runtime 之正確姿勢

**supervisord 管理二個 program**：

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

> ⚠️ 若 `supervisorctl` 不可用（socket 権限）、
> 可退而求其次：kill runtime 工程、令 supervisord 之 `autorestart=true` 拉起。
> **依然勿動 QQ 工程。**

### 5.4 部署後検証

```bash
# ① runtime 起来了
docker exec <容器> sh -c 'supervisorctl status'
curl -s -o /dev/null -w 'webui=%{http_code}\n' http://127.0.0.1:5199/

# ② hook 健康（0 = 健康）
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'

# ③ ★ 端到端：真的发一条消息、真的收一条消息
```

> **不能只看「工程已起」。** 必須作真実収発検証 ——
> 原因見 [compatibility.md §7.5](../advanced/compatibility.md)。

### 5.5 回滚

```bash
# 用 §5.2 第 ① 步的备份
base64 -w0 <宿主路径>/index-hz.mjs.bak-<时间戳> | ssh <服务器> 'base64 -d > <宿主路径>/index-hz.mjs'
ssh <服务器> 'md5sum <宿主路径>/index-hz.mjs'   # 确认回到已知good值
docker exec <容器> supervisorctl restart snowluma
```

### 5.6 発布産物之完整形態

発布産物者**一目録**也、`native/` 必須与 `index.mjs` **同行分発**：

```
dist/
├── index.mjs          ← 本 bundle
├── launcher.sh        ← 起動脚本（優先同目録 ./node、否則回落 $PATH）
├── check-node-version.cjs
├── package.json       ← @snowluma/runtime 清単（version: 2.4.0）
├── release.json       ← { version, target: "linux-arm64", entries: [...] }
├── EULA.md / PRIVACY.md
├── client/            ← WebUI 前端静態産物（★ 源碼未還原）
└── native/            ← ★ 必須同行分発
    ├── snowluma-linux-arm64.node        注入器
    ├── snowluma-linux-arm64.so          hook 後端
    ├── websocket-linux-arm64.node
    ├── ffmpeg/ffmpegAddon.linux.arm64.node
    └── sqlite/prebuilds/linux-arm64/@appthreat+sqlite3.{glibc,musl}.node
```

> ⚠️ **`native/` 缺失之後果**：WebUI 能起、然
> **Hook / SQLite / WebSocket / ffmpeg 会降級或報錯**。
> 実測記録（在無 native 之機上跑）：
> ```
> WARN  [Hook] process enumeration failed: No hook native addon found for linux-x64
> ```

---

## 6. 進階：復原為真正之多文件工程

当前 `packages/*/src/*.ts` 者**扁平化之 fragment** 也 ——
毎文件能単独通過語法検査、然**互相不能見**（不能編譯）。

**欲変為真正之模組化工程、按此順序行**：

```
① 重建 import 図
   · 自 init_xxx() 呼出序反推初期化依存
     （已験証：15 個 init_* 定義与 15 個呼出完全配対、無懸空参照）
   · 自標識符命名規律反推
     （rolldown 会給重名符号加 $1 / $2 後綴、如 fs$1、logger$2）

② 給毎文件補 export
   将被他処参照之頂層 var / function / class 輸出

③ 替換 init_xxx() 為真正之 import 副作用

④ 用 npm run build:rolldown 試打包、比対 dist/index.mjs 行為
```

**建議按包逐歩遷移**（依存自少至多）：

```
common (20 文件, 1,806 行)  →  sqlite (3)  →  websocket (5)  →  bridge (17)
   →  onebot (77)  →  protocol (180)  →  core (64)
```

> **毎遷完一包即跑一次 §3 之重建作回帰** —— 保証行為不変。

---

## 7. 類型検査与測試

```bash
# 类型检查（需要装 typescript）
npm run typecheck
# = tsc -p tsconfig.json

# 测试
npm run test
# = node --test scripts/*.test.cjs
```

**⚠️ `typecheck` 之実際価値有限**：

```jsonc
// tsconfig.json 的关键设置
{
  "strict": false,
  "noImplicitAny": false,
  "noEmit": true,
  "allowJs": true
}
```

原因：**還原出之 `.ts` 文件里類型標注已被擦除**（TS → JS 編譯後類型全失）、
毎文件頭皆加了 `// @ts-nocheck`。其等**者精確之 JS、非原版 TS 也**。

**保留者**：変数 / 関数名、類結構、註釋、文字列、邏輯。
**丢失者**：`interface` / `type` / 泛型参數、参數与返却類型、`private` 等修飾符、列挙。

---

## 8. 構築故障排查

### 8.1 `node --check` 報語法錯

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

**復原**：自備份 / 帰档重新取該切片、**勿手工修補**（易錯位更多）。

### 8.2 `[check] MISSING <path>`

```
根因：某个 region 切片文件不存在或为空
```

```bash
# 从归档重新解出
ls /sdcard/snowluma-takeover-20261112.tgz
# 或从 takeover 包里的 restored/ 复制对应文件
```

### 8.3 産物能構築然起動失敗

```bash
# 先做最小化冒烟测试（隔离 HOME，不碰生产）
cd dist
SNOWLUMA_DEV_NO_NATIVE=1 SNOWLUMA_DEV_MODE=1 node index.mjs
```

**預期之記録**（説明主流程正常）：

```
INFO  [App] SnowLuma starting
INFO  [WebUI] listening http://127.0.0.1:5399
WARN  [Hook] process enumeration failed: No hook native addon found for linux-x64
        ↑ 預期：本機為 x64、唯 arm64 之 native 産物
```

**HTTP 層之預期行為**：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5399/
# → 404   （前端 client/ 未构建，是设计行为）

curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5399/api/state
# → 401   （鉴权正常拦截，是设计行为）
```

> **404 与 401 皆為「設計行為」、非構築失敗也。**
> 判拠：只要 WebUI 能監聽、`ss -ltnp` 能見端口、能優雅退出（SIGTERM）、
> 即説明 **libuv / 網絡 / 記録 / HTTP 路徑 / 協商關閉此一整套主流程完全正常**。

### 8.4 改了設定 / 源碼然不有効

**排查順序**：

```
① 改了源碼 region？          → 需 npm run build 重建 + 部署
② 改的是 package.json？       → 只影響依存、不影響産物（産物者自含也）
③ 改的是容器里的配置文件？     → ★ 運行時不熱載！見 troubleshooting T1
④ 改对了容器吗？             → 確認非改至已停止之旧容器（T9）
```

### 8.5 記憶体 / 長任務関連

```bash
# 构建本身很轻（纯字符串拼接，几秒），但如果跑 rolldown 或 tsc：
#   · 长任务必须后台跑 + 轮询日志（SSH 空闲会断连）
setsid nohup npm run build:rolldown > ~/build.log 2>&1 < /dev/null &
tail -c 800 ~/build.log | tr '\r' '\n' | tail -10
#                          ↑ 进度条是回车不换行，必须转换
```

> ⚠️ **勿用 `/tmp` 放大文件**（若為 tmpfs、会吃記憶体）。
> 本工程 26 MB 不大、然帰档 / 解包請用 `~/` 或工程目録。

---

## 9. 版本鎖定要求

### 9.1 ★ 依存必須用精確版本、勿用 `^`

**規則**：写 `"hono": "4.13.13"`、**勿**写 `"hono": "^4.13.13"`。

**原因者一次真実之踩坑也**：用 caret 範囲装了一度、
npm 解析出之版本与 bundle 内之**不一致 —— 6 個包発生漂移**：

| 包 | bundle 内 | `^` 会装到 | 判定 |
|---|---|---|---|
| `hono` | `4.13.13` | **`4.13.18`** | ❌ 漂移 |
| `@hono/node-server` | `2.1.5` | **`2.1.8`** | ❌ 漂移 |
| `otpauth` | `9.5.1` | **`9.6.0`** | ❌ 漂移 |
| `tar` | `7.5.22` | **`7.5.23`** | ❌ 漂移 |
| `@zxcvbn-ts/core` | `4.1.2` | **`4.2.0`** | ❌ 漂移 |
| `semver` | `7.7.4` | **`7.8.6`** | ❌ 漂移 |
| `htmlparser2` | `10.0.0` | **`10.1.0`** | ❌ 漂移 |

> **精確版本清単見 [compatibility.md §4.1](../advanced/compatibility.md)。**

### 9.2 ⚠️ 已知待修項：還原工程里之 `^` 与 rolldown 範囲

**以下二処与上述規則衝突、属於已知待修項：**

| 位置 | 当前値 | 応為 | 影響 |
|---|---|---|---|
| `packages/*/package.json` 之 `dependencies` | `^4.13.13` 等 | `4.13.13`（去掉 `^`） | 装依存時会漂移 6 個包 |
| 根 `package.json` 之 `devDependencies.rolldown` | `^1.3.2` | `1.1.8`（精確） | 走 rolldown 路時不能得 `//#region` |

> **注意**：此二項**不影響既定之 `npm run build`** ——
> `merge.mjs` 零依存、不読 `node_modules`。
> 唯走 `build:rolldown` 路或需装依存時方受影響。

### 9.3 Node 版本

**構築側**：寬鬆（v22 実測可跑通）。
**運行側**：嚴格（`^24.22.1 || >=26.12.1`、Node 25 者空洞）。

---

## 10. 完全構築清単

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

## 11. 関連文書

| 欲知 | 去看 |
|---|---|
| 其究竟如何動作 | [architecture.md](../advanced/architecture.md) |
| 支援何版本 / 依存何物 | [compatibility.md](../advanced/compatibility.md) |
| 出問題如何排查 | [troubleshooting.md](../advanced/troubleshooting.md) |
| 如何参与開発 | [contributing.md](contributing.md) |

---

*構築流程已実測：産物 `dist/index.mjs` 12,338,442 字節、
MD5 `bebdc7586f6e6586be80a85cc744ae5c` —— 与線上正在運行之 bundle 逐字節一致。*
