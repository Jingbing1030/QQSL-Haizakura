# 從原始碼建置

> [!WARNING]
> 本內容完全由 AI 撰寫，請謹慎檢視。

> **面向讀者**：要修改 Haizakura（原名 SnowLuma）業務邏輯並重新建置產物的開發者。
> **核心認知**：本工程的「建置」**不是**常規的 bundler 打包 ——
> 它是**按 `manifest.json` 的行號把 467 個程式碼切片拼回單一檔案**。
> 理解這一點，後面所有限制就都順理成章了。

---

## 1. 環境需求

### 1.1 必需

| 項目 | 要求 | 說明 |
|---|---|---|
| **Node.js** | **`^24.22.1 \|\| >=26.12.1`** | ⚠️ **Node 25 不支援**（落在兩個區間之外） |
| **記憶體** | ≥ 1 GB 閒置 | 建置只做字串拼接，很輕 |
| **磁碟** | ~100 MB | 還原工程 26 MB + 產物 12 MB |
| **pnpm** | **不需要** | ⚠️ 見下 |
| **網路** | **不需要**（僅建置而言） | `node_modules` 是空的也能建置 |

> ✅ **建置環節不需要 pnpm、不需要 npm install。**
> `merge.mjs` 是**零相依的純 Node 指令碼**。
> 只有走 rolldown 路線（§4）或做型別檢查（§7）時才需要裝相依。

### 1.2 實測環境

```
构建成功验证于：
  Node.js   v22.23.2        ← ⚠️ 低于 engines 声明，但纯 JS 无 24 特有语法，可跑通
  平台      linux x86_64
  产物      dist/index.mjs  12,338,442 字节
  MD5       bebdc7586f6e6586be80a85cc744ae5c
            ↑ 与线上正在运行的 bundle 逐字节完全一致
```

> **關於 Node 版本**：產物 `engines` 要求 `^24.22.1 || >=26.12.1`，
> 但**建置**（拼裝 + 語法檢查）用 v22 也能跑通 ——
> 因為 bundle 是純 JS，沒用到 Node 24 的特有語法。
>
> **但注意區分**：**執行環境**必須滿足閘門要求（`check-node-version.cjs`），
> 否則 `launch.sh` 會拒絕啟動。建置能跑 ≠ 能部署上去跑。

### 1.3 映像來源設定（推薦：內網來源快幾十倍）

```bash
# npm（只有需要装依赖时才用）
npm config set registry https://mirrors.tencentyun.com/npm
```

---

## 2. 建置原理

### 2.1 先理解為什麼是「拼裝」而不是「打包」

**線上產物 `dist/index.mjs` 是一個 12 MB 的單檔 ESM bundle**，由 **rolldown**
（不是 Vite、不是 Rollup）產出，特徵：

| 特徵 | 觀測值 |
|---|---|
| `//#region <路径>` / `//#endregion` 標記對 | **467 對，無巢狀** |
| `export` 陳述式 | **0 個**（完全扁平化，單模組作用域） |
| 模組初始化 | `init_xxx()` thunk（rolldown 的 `__esmMin` helper） |
| import 位置 | **全部提升到檔案最頂部**（47 行 Node 內建 import 序言） |
| 程式碼壓縮 | **無**（變數名、註解全保留） |
| 建置時 cwd | **`packages/core`** |

> **關鍵問題**：原 bundle **沒有保留模組邊界** —— 0 個 `export`，所有 import 被提升到頂部。
> 要重新用 rolldown 打包，必須先**逐個人工重建 367 個檔案之間的 import/export 邊**，
> 而 bundle 裡**沒有記錄**這些資訊（這是逆向工程中資訊量最大、也最不可回復的部分）。

**所以本工程採用兩條建置路徑**：

| 路徑 | 指令 | 效果 |
|---|---|---|
| **A. 位元組級重建（預設，已驗證）** | `npm run build` | 從 467 個 region 切片拼回單檔，**逐位元組等於原產物** |
| B. 真 rolldown 打包（框架就位，需補 import/export） | `npm run build:rolldown` | 需要先把 fragment 還原成真正的模組 |

> **路徑 A 是目前唯一能保證與線上產物一致的方式**，也是改 bug 的推薦流程。

### 2.2 `merge.mjs` 做什麼

原始碼 `scripts/merge.mjs` 的核心邏輯：

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

**三個要點**：

1. **行號是唯一權威** —— `manifest.json` 裡的 `start_line` / `end_line` 決定每段程式碼的位置
2. **`loose-lines.txt` 是 region 外的 47 行** —— 檔案頂部的 `import "node:*"` 序言，逐行帶原始行號
3. **會自動剝離還原時加的裝飾** —— `// @ts-nocheck` 註解頭、末尾的 `export {};`

### 2.3 `manifest.json` 的結構

實測統計：

```
region 总数   467
  ├─ runtime-internal    1    （rolldown 的运行时互操作 helper）
  ├─ workspace         367    （自有源码）
  └─ vendor             99    （第三方包切片）
最大 end_line  367,423
```

**單條記錄的樣子**：

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

| 欄位 | 含義 |
|---|---|
| `region` | 原始 region 路徑（`//#region` 後面那段） |
| `kind` | `runtime-internal` / `workspace` / `vendor` / `other` |
| `out` | 切片檔案路徑（相對工程根） |
| `start_line` / `end_line` | ★ **在產物中的行號**（拼裝依據） |
| `body_lines` / `body_bytes` | 正文行數 / 位元組數（校驗用） |

**按 `kind` 分派切片路徑**（`merge.mjs` 的 `slicePath()`）：

```js
if (e.kind === 'vendor') return join('vendor-regions', 'node_modules/.pnpm', /* … */);
if (e.kind === 'other')  return join('vendor-regions', '__other__', /* … */);
return e.out;   // workspace / runtime-internal
```

### 2.4 ⚠️ ★ 最重要的限制：不能增刪行

```
✅ 改 region【内部】的代码  → 重建后就是你的改动
⚠️ 不要新增/删除 region，也不要动 manifest.json 的行号 —— 否则重建会错位
```

**為什麼**：`merge.mjs` 是**按絕對行號**放置內容的。
你在某個 region 中間加一行、或刪一行，那個 region 後面的**所有內容都會錯位一位**，
產物會變成語法錯誤或行為錯亂。

**那要加新檔案怎麼辦？**

| 情況 | 做法 |
|---|---|
| 加一個小功能 | 把它寫進**現有 region 內部**（選一個語意相近的檔案） |
| 真的要加新檔案 | **擴充 `manifest.json`**：新增一條記錄，並**同步調整所有後續 region 的 `start_line` / `end_line`** |
| 行數變化 | `body_lines` 欄位要同步更新（用於校驗） |

> ⚠️ **手工調號容易錯。** 如果確實需要新增檔案，
> 建議寫一個指令碼按「插入點之後的 region 全部平移 N 行」來批量更新 `manifest.json`，
> 而不是手改。

---

## 3. 建置步驟

### 3.1 標準建置

```bash
cd <工程根>            # 例如 /sdcard/snowluma-dev/restored

# 一步到位：拼装 + 语法检查
npm run build
```

`package.json` 裡的定義：

```json
"build": "node scripts/merge.mjs && node --check dist/index.mjs"
```

**實測輸出**：

```
[merge] wrote /…/dist/index.mjs (12338442 bytes, 367423 lines)
[merge] original 12338350 bytes -> delta 92
```

> **`delta 92` 是什麼？** 產物比原始 bundle 大 92 位元組 ——
> 這是**改名**（`SnowLuma` → `Haizakura` 等品牌字串）帶來的長度差，
> **屬於預期**。見 §3.4 的判讀規則。

### 3.2 完整校驗（推薦）

```bash
# 含：region 齐全性 + 逐字节比对 + 语法检查
npm run check
```

等價於：

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

**預設參考路徑是 `/tmp/sl/index.mjs`**（原分析時的暫存位置），
現在通常不存在 → 會跳過比對：

```
[check] reference /tmp/sl/index.mjs not present - skipped byte comparison
```

**要真正做逐位元組比對，請明確指定參考產物**：

```bash
node scripts/check.mjs /path/to/reference/index.mjs
```

### 3.3 ★ 驗證建置正確性（實戰方法）

**唯一可信的判據：與線上正在執行的 bundle 做 md5 比對。**

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

**實測驗證結果（本文件撰寫時）**：

```
线上 bundle   bebdc7586f6e6586be80a85cc744ae5c
本地重建      bebdc7586f6e6586be80a85cc744ae5c   ✅ 完全一致
```

> **md5 一致 = 逐位元組一致 = 建置管線可靠。**
> 這是比「檔案大小相同」強得多的證據 ——
> **大小相同內容不同的情況是真實存在的**（見 troubleshooting.md T10）。

### 3.4 怎麼判讀建置結果

| 現象 | 含義 | 處理 |
|---|---|---|
| md5 **與參考一致** | ✅ 建置管線完全保真 | 可以部署 |
| md5 不同，但**只差你改的那幾行** | ✅ 這是你的改動，符合預期 | 走 §5 部署 |
| `delta` 是**小數值**（幾十~幾百位元組） | ✅ 通常是字串改名帶來的長度差 | 核對一下改了什麼 |
| `delta` **很大**（KB 級） | ⚠️ 可能改錯了 region 或誤刪了內容 | 檢查 `git diff` 類的差異 |
| `node --check` **報語法錯** | ❌ region 被破壞（截斷/錯位） | 見 §8 |
| `[check] MISSING …` | ❌ 切片檔案丟了 | 從備份還原 |
| `[check] MISMATCH at byte N` | ❌ 內容確實變了 | 看 byte N 落在哪個 region |

---

## 4. 備選路徑：真 rolldown 打包

**框架已就位，但目前不可用於生產產物。**

```bash
npm run build:rolldown
# = rolldown -c rolldown.config.ts
```

`rolldown.config.ts`（已產生，忠實重現原形態）：

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

### 4.1 ⚠️ 為什麼現在不能用

```
原 bundle 没有保留模块边界：
  · 0 个 export
  · 所有 import 被提升到文件顶部
  · 模块间依赖关系【不可恢复】

→ 直接跑 rolldown 只会打出一个空壳/报错，不会产出可运行的 12 MB bundle
```

**要讓它可用，必須先做完 §6 的模組化遷移。**

### 4.2 ⚠️ rolldown 版本必須 ≤ 1.1.8

**這是硬限制** —— region 註解格式在不同版本之間變了：

| rolldown | 輸出註解格式 | 能否用 |
|---|---|---|
| `1.0.0` | `//#region <path>` | ✅ |
| `1.1.0` / `1.1.4` / `1.1.8` | `//#region <path>` | ✅ **推薦 1.1.8** |
| `1.2.16` | `// <path>`（**無 `#region`**） | ❌ 格式已變 |
| `1.3.2` | `// <path>` | ❌ 且 `inlineDynamicImports` 已棄用 |

**實測對比**：

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

> **原工程用的 rolldown 版本無法精確確定**（bundle 裡沒有版本戳），
> 只能收斂到 **`≤1.1.8`** 這個區間。
>
> ⚠️ 還原工程的 `package.json` 裡寫的是 `"rolldown": "^1.3.2"` ——
> **這個範圍會裝到 1.3.x，拿不到 `#region`**。這是已知待修項，見 §9。

---

## 5. 部署到容器

### 5.1 ★★ 部署前必讀：會丟登入狀態

```
⚠️ 重启 QQ 进程  →  loginList 被清空  →  必须重新扫码
⚠️ 重启容器      →  同样重启 QQ       →  同样丢登录态
```

**關鍵區分**：

| 操作 | 影響 QQ 行程嗎 | 丟登入狀態嗎 |
|---|---|---|
| **只重新啟動 runtime 行程** | ❌ 不影響 | ✅ **不丟** |
| 重新啟動容器 | ✅ 會 | ❌ **丟** |
| 重新啟動 QQ 行程 | ✅ 會 | ❌ **丟** |

> **正確做法：只讓 runtime 重新載入 bundle，不要碰 QQ 行程。**
> 詳細原理與恢復流程見 [troubleshooting.md T2](../advanced/troubleshooting.md)。

### 5.2 部署方式：bind mount（推薦）

生產實例用的就是這個方式：

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

### 5.3 重新啟動 runtime 的正確姿勢

**supervisord 管理著兩個 program**：

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

> ⚠️ 若 `supervisorctl` 不可用（socket 權限），
> 可退而求其次：kill runtime 行程，讓 supervisord 的 `autorestart=true` 拉起來。
> **依然不要動 QQ 行程。**

### 5.4 部署後驗證

```bash
# ① runtime 起来了
docker exec <容器> sh -c 'supervisorctl status'
curl -s -o /dev/null -w 'webui=%{http_code}\n' http://127.0.0.1:5199/

# ② hook 健康（0 = 健康）
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'

# ③ ★ 端到端：真的发一条消息、真的收一条消息
```

> **不能只看「行程起來了」。** 必須做真實收發驗證 ——
> 原因見 [compatibility.md §7.5](../advanced/compatibility.md)。

### 5.5 回復

```bash
# 用 §5.2 第 ① 步的备份
base64 -w0 <宿主路径>/index-hz.mjs.bak-<时间戳> | ssh <服务器> 'base64 -d > <宿主路径>/index-hz.mjs'
ssh <服务器> 'md5sum <宿主路径>/index-hz.mjs'   # 确认回到已知good值
docker exec <容器> supervisorctl restart snowluma
```

### 5.6 發布產物的完整形態

發布產物是**一個目錄**，`native/` 必須與 `index.mjs` **一起分發**：

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

> ⚠️ **`native/` 缺失的後果**：WebUI 能起來，但
> **Hook / SQLite / WebSocket / ffmpeg 會降級或報錯**。
> 實測日誌（在沒有 native 的機器上跑）：
> ```
> WARN  [Hook] process enumeration failed: No hook native addon found for linux-x64
> ```

---

## 6. 進階：還原成真正的多檔案工程

目前 `packages/*/src/*.ts` 是**扁平化的 fragment** ——
每個檔案能單獨通過語法檢查，但**互相看不見**（編譯不了）。

**要變成真正的模組化工程，按這個順序做**：

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

**建議按套件逐步遷移**（相依從少到多）：

```
common (20 文件, 1,806 行)  →  sqlite (3)  →  websocket (5)  →  bridge (17)
   →  onebot (77)  →  protocol (180)  →  core (64)
```

> **每遷完一個套件就跑一次 §3 的重建做回歸** —— 保證行為不變。

---

## 7. 型別檢查與測試

```bash
# 类型检查（需要装 typescript）
npm run typecheck
# = tsc -p tsconfig.json

# 测试
npm run test
# = node --test scripts/*.test.cjs
```

**⚠️ `typecheck` 的實際價值有限**：

```jsonc
// tsconfig.json 的关键设置
{
  "strict": false,
  "noImplicitAny": false,
  "noEmit": true,
  "allowJs": true
}
```

原因：**還原出的 `.ts` 檔案裡型別標註已被抹除**（TS → JS 編譯後型別全失），
每個檔案頭都加了 `// @ts-nocheck`。它們**是精確的 JS，不是原版 TS**。

**保留的**：變數/函式名、類別結構、註解、字串、邏輯。
**丟失的**：`interface` / `type` / 泛型參數、參數與回傳型別、`private` 等修飾詞、列舉。

---

## 8. 建置故障排查

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

**回復**：從備份/封存檔重新取該切片，**不要手工修補**（容易錯位更多）。

### 8.2 `[check] MISSING <path>`

```
根因：某个 region 切片文件不存在或为空
```

```bash
# 从归档重新解出
ls /sdcard/snowluma-takeover-20261112.tgz
# 或从 takeover 包里的 restored/ 复制对应文件
```

### 8.3 產物能建置但啟動失敗

```bash
# 先做最小化冒烟测试（隔离 HOME，不碰生产）
cd dist
SNOWLUMA_DEV_NO_NATIVE=1 SNOWLUMA_DEV_MODE=1 node index.mjs
```

**預期的日誌**（說明主流程正常）：

```
INFO  [App] SnowLuma starting
INFO  [WebUI] listening http://127.0.0.1:5399
WARN  [Hook] process enumeration failed: No hook native addon found for linux-x64
        ↑ 预期：本机是 x64，只有 arm64 的 native 产物
```

**HTTP 層的預期行為**：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5399/
# → 404   （前端 client/ 未构建，是设计行为）

curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5399/api/state
# → 401   （鉴权正常拦截，是设计行为）
```

> **404 和 401 都是「設計行為」，不是建置失敗。**
> 判據：只要 WebUI 能監聽、`ss -ltnp` 能看到連接埠、能優雅退出（SIGTERM），
> 就說明 **libuv / 網路 / 日誌 / HTTP 路由 / 協商關閉這一整套主流程完全正常**。

### 8.4 改了設定/原始碼但不生效

**排查順序**：

```
① 改了源码 region？          → 需要 npm run build 重建 + 部署
② 改的是 package.json？       → 只影响依赖，不影响产物（产物是自包含的）
③ 改的是容器里的配置文件？     → ★ 运行时不热加载！见 troubleshooting T1
④ 改对了容器吗？             → 确认不是改到了已停止的旧容器（T9）
```

### 8.5 記憶體/長任務相關

```bash
# 构建本身很轻（纯字符串拼接，几秒），但如果跑 rolldown 或 tsc：
#   · 长任务必须后台跑 + 轮询日志（SSH 空闲会断连）
setsid nohup npm run build:rolldown > ~/build.log 2>&1 < /dev/null &
tail -c 800 ~/build.log | tr '\r' '\n' | tail -10
#                          ↑ 进度条是回车不换行，必须转换
```

> ⚠️ **不要用 `/tmp` 放大檔案**（若是 tmpfs，會吃記憶體）。
> 本工程 26 MB 不大，但封存/解壓縮請用 `~/` 或工程目錄。

---

## 9. 版本鎖定要求

### 9.1 ★ 相依必須用精確版本，不要用 `^`

**規則**：寫 `"hono": "4.13.13"`，**不要**寫 `"hono": "^4.13.13"`。

**原因是一次真實的踩雷**：用 caret 範圍裝了一遍，
npm 解析出的版本與 bundle 內的**不一致 —— 6 個套件發生漂移**：

| 套件 | bundle 內 | `^` 會裝到 | 判定 |
|---|---|---|---|
| `hono` | `4.13.13` | **`4.13.18`** | ❌ 漂移 |
| `@hono/node-server` | `2.1.5` | **`2.1.8`** | ❌ 漂移 |
| `otpauth` | `9.5.1` | **`9.6.0`** | ❌ 漂移 |
| `tar` | `7.5.22` | **`7.5.23`** | ❌ 漂移 |
| `@zxcvbn-ts/core` | `4.1.2` | **`4.2.0`** | ❌ 漂移 |
| `semver` | `7.7.4` | **`7.8.6`** | ❌ 漂移 |
| `htmlparser2` | `10.0.0` | **`10.1.0`** | ❌ 漂移 |

> **精確版本清單見 [compatibility.md §4.1](../advanced/compatibility.md)。**

### 9.2 ⚠️ 已知待修項：還原工程裡的 `^` 與 rolldown 範圍

**以下兩處與上面的規則衝突，屬於已知待修項：**

| 位置 | 目前值 | 應該是 | 影響 |
|---|---|---|---|
| `packages/*/package.json` 的 `dependencies` | `^4.13.13` 等 | `4.13.13`（去掉 `^`） | 裝相依時會漂移 6 個套件 |
| 根 `package.json` 的 `devDependencies.rolldown` | `^1.3.2` | `1.1.8`（精確） | 走 rolldown 路線時拿不到 `//#region` |

> **注意**：這兩項**不影響預設的 `npm run build`** ——
> `merge.mjs` 零相依，不讀 `node_modules`。
> 只有走 `build:rolldown` 路線或需要裝相依時才會被影響。

### 9.3 Node 版本

**建置側**：寬鬆（v22 實測可跑通）。
**執行側**：嚴格（`^24.22.1 || >=26.12.1`，Node 25 是空洞）。

---

## 10. 完整建置清單

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

## 11. 相關文件

| 想了解 | 去看 |
|---|---|
| 它到底怎麼工作的 | [architecture.md](../advanced/architecture.md) |
| 支援哪些版本 / 相依什麼 | [compatibility.md](../advanced/compatibility.md) |
| 出問題怎麼排查 | [troubleshooting.md](../advanced/troubleshooting.md) |
| 怎麼參與開發 | [contributing.md](contributing.md) |

---

*建置流程已實測：產物 `dist/index.mjs` 12,338,442 位元組，
MD5 `bebdc7586f6e6586be80a85cc744ae5c` —— 與線上正在執行的 bundle 逐位元組一致。*
