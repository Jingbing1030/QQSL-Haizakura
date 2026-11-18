# ソースからのビルド

> [!WARNING]
> 本内容はすべて AI が作成したものです。慎重に確認してください。

> **対象読者**：Haizakura（旧称 SnowLuma）のビジネスロジックを変更し、成果物を再ビルドする開発者。
> **中心となる認識**：本プロジェクトの「ビルド」は**通常の bundler によるパッケージングではありません** ——
> **`manifest.json` の行番号に従って 467 個のコードスライスを単一ファイルへ組み戻す**処理です。
> この点を理解すれば、以降のすべての制約が自然に納得できます。

---

## 1. 環境要件

### 1.1 必須

| 項目 | 要件 | 説明 |
|---|---|---|
| **Node.js** | **`^24.22.1 \|\| >=26.12.1`** | ⚠️ **Node 25 は非対応**（2 つの範囲の外に落ちる） |
| **メモリ** | 1 GB 以上の空き | ビルドは文字列連結のみで非常に軽い |
| **ディスク** | 約 100 MB | 復元プロジェクト 26 MB + 成果物 12 MB |
| **pnpm** | **不要** | ⚠️ 下記参照 |
| **ネットワーク** | **不要**（ビルドに限る） | `node_modules` が空でもビルドできる |

> ✅ **ビルド工程に pnpm も npm install も不要です。**
> `merge.mjs` は**依存ゼロの純粋な Node スクリプト**です。
> 依存のインストールが必要になるのは、rolldown のルート（§4）を通る場合や型チェック（§7）を行う場合だけです。

### 1.2 実測環境

```
ビルド成功の検証条件：
  Node.js   v22.23.2        ← ⚠️ engines の宣言より低いが、純 JS で 24 固有の構文が無いため動作する
  プラットフォーム  linux x86_64
  成果物    dist/index.mjs  12,338,442 バイト
  MD5       bebdc7586f6e6586be80a85cc744ae5c
            ↑ オンラインで稼働中の bundle とバイト単位で完全一致
```

> **Node のバージョンについて**：成果物の `engines` は `^24.22.1 || >=26.12.1` を要求しますが、
> **ビルド**（組み立て + 構文チェック）は v22 でも通ります ——
> bundle が純 JS であり、Node 24 固有の構文を使っていないためです。
>
> **ただし区別してください**：**実行時**はゲートの要件（`check-node-version.cjs`）を満たす必要があり、
> そうでなければ `launch.sh` は起動を拒否します。ビルドが通る ≠ デプロイして動く、です。

### 1.3 ミラー設定（推奨：イントラネット源は数十倍速い）

```bash
# npm（只有需要装依赖时才用）
npm config set registry https://mirrors.tencentyun.com/npm
```

---

## 2. ビルドの原理

### 2.1 まず「なぜパッケージングではなく組み立てなのか」を理解する

**オンライン成果物 `dist/index.mjs` は 12 MB の単一ファイル ESM bundle** であり、**rolldown**
（Vite でも Rollup でもない）が出力したもので、特徴は次のとおりです：

| 特徴 | 観測値 |
|---|---|
| `//#region <パス>` / `//#endregion` のマーカー対 | **467 対、ネストなし** |
| `export` 文 | **0 個**（完全にフラット化され、単一モジュールスコープ） |
| モジュール初期化 | `init_xxx()` thunk（rolldown の `__esmMin` helper） |
| import の位置 | **すべてファイル先頭へ巻き上げ**（47 行の Node 組み込み import 序文） |
| コード圧縮 | **なし**（変数名・コメントとも保持） |
| ビルド時の cwd | **`packages/core`** |

> **重要な問題**：元の bundle は**モジュール境界を保持していません** —— `export` は 0 個で、すべての import が先頭へ巻き上げられています。
> あらためて rolldown でパッケージングするには、まず**367 個のファイル間の import/export の辺を 1 本ずつ手作業で再構築**する必要があり、
> しかも bundle にはその情報が**記録されていません**（これはリバースエンジニアリングで最も情報量が多く、最も復元困難な部分です）。

**そこで本プロジェクトは 2 本のビルド経路を採用しています**：

| 経路 | コマンド | 効果 |
|---|---|---|
| **A. バイト単位の再構築（既定・検証済み）** | `npm run build` | 467 個の region スライスから単一ファイルへ組み戻し、**バイト単位で元の成果物と一致** |
| B. 真の rolldown パッケージング（枠組みは用意済み、import/export の補完が必要） | `npm run build:rolldown` | まず fragment を本来のモジュールへ復元する必要がある |

> **経路 A が、現在オンライン成果物との一致を保証できる唯一の方法**であり、バグ修正の推奨フローでもあります。

### 2.2 `merge.mjs` が行うこと

ソース `scripts/merge.mjs` の中核ロジック：

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

**3 つの要点**：

1. **行番号が唯一の権威** —— `manifest.json` の `start_line` / `end_line` が各コード断片の位置を決める
2. **`loose-lines.txt` は region 外の 47 行** —— ファイル先頭の `import "node:*"` 序文で、1 行ごとに元の行番号を持つ
3. **復元時に付けた装飾を自動的に剥がす** —— `// @ts-nocheck` のコメントヘッダ、末尾の `export {};`

### 2.3 `manifest.json` の構造

実測統計：

```
region 総数   467
  ├─ runtime-internal    1    （rolldown のランタイム相互運用 helper）
  ├─ workspace         367    （自前のソース）
  └─ vendor             99    （サードパーティパッケージのスライス）
最大 end_line  367,423
```

**1 レコードの姿**：

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

| フィールド | 意味 |
|---|---|
| `region` | 元の region パス（`//#region` の後ろの部分） |
| `kind` | `runtime-internal` / `workspace` / `vendor` / `other` |
| `out` | スライスファイルのパス（プロジェクトルートからの相対） |
| `start_line` / `end_line` | ★ **成果物内での行番号**（組み立ての根拠） |
| `body_lines` / `body_bytes` | 本文の行数 / バイト数（検証用） |

**`kind` によるスライスパスの振り分け**（`merge.mjs` の `slicePath()`）：

```js
if (e.kind === 'vendor') return join('vendor-regions', 'node_modules/.pnpm', /* … */);
if (e.kind === 'other')  return join('vendor-regions', '__other__', /* … */);
return e.out;   // workspace / runtime-internal
```

### 2.4 ⚠️ ★ 最も重要な制約：行を増減できない

```
✅ region【内部】のコードを変更する  → 再ビルド後それがそのまま変更になる
⚠️ region を追加/削除しない。manifest.json の行番号も動かさない —— そうしないと再ビルドがずれる
```

**なぜか**：`merge.mjs` は**絶対行番号**に従って内容を配置します。
ある region の途中で 1 行追加したり削除したりすると、その region 以降の**すべての内容が 1 行ずつずれ**、
成果物は構文エラーや挙動の破綻を起こします。

**では新しいファイルを追加したいときは？**

| 状況 | 方法 |
|---|---|
| 小さな機能を追加する | **既存 region の内部**に書き込む（意味の近いファイルを選ぶ） |
| 本当に新しいファイルを追加する | **`manifest.json` を拡張する**：レコードを 1 件追加し、**後続するすべての region の `start_line` / `end_line` を同期的に調整する** |
| 行数が変わる | `body_lines` フィールドも同期して更新する（検証に使う） |

> ⚠️ **手作業での番号調整は間違えやすい。** どうしてもファイルを追加する必要がある場合は、
> 「挿入点より後ろの region をすべて N 行平行移動する」スクリプトを書いて `manifest.json` を一括更新することを
> 推奨します。手で書き換えるのではなく。

---

## 3. ビルド手順

### 3.1 標準ビルド

```bash
cd <工程根>            # 例如 /sdcard/snowluma-dev/restored

# 一步到位：拼装 + 语法检查
npm run build
```

`package.json` での定義：

```json
"build": "node scripts/merge.mjs && node --check dist/index.mjs"
```

**実測出力**：

```
[merge] wrote /…/dist/index.mjs (12338442 bytes, 367423 lines)
[merge] original 12338350 bytes -> delta 92
```

> **`delta 92` とは何か？** 成果物が元の bundle より 92 バイト大きい ——
> これは**名称変更**（`SnowLuma` → `Haizakura` などのブランド文字列）による長さの差であり、
> **想定どおり**です。§3.4 の読み取り規則を参照してください。

### 3.2 完全な検証（推奨）

```bash
# 含：region 齐全性 + 逐字节比对 + 语法检查
npm run check
```

次と等価です：

```bash
node scripts/check.mjs [参考产物路径]
```

`check.mjs` は 3 つのことを行います：

```
① manifest を走査し、各 region スライスファイルが存在し空でないことを確認
     → "[check] regions: 467  missing: 0" を出力
② merge.mjs を呼び出して再構築
③ node --check で構文チェック
     → "[check] dist/index.mjs: syntax OK" を出力
④ 参照成果物が指定されていればバイト単位で比較
     → "[check] BYTE-EXACT match with reference (…) OK"
        または "[check] MISMATCH at byte N (rebuilt X vs ref Y)"
```

**既定の参照パスは `/tmp/sl/index.mjs`**（元の解析時の一時的な場所）で、
現在は通常存在しないため → 比較はスキップされます：

```
[check] reference /tmp/sl/index.mjs not present - skipped byte comparison
```

**本当にバイト単位の比較を行う場合は、参照成果物を明示的に指定してください**：

```bash
node scripts/check.mjs /path/to/reference/index.mjs
```

### 3.3 ★ ビルドの正しさを検証する（実践的な方法）

**唯一信頼できる判断基準：オンラインで稼働中の bundle と md5 を比較すること。**

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

**実測による検証結果（本書の執筆時点）**：

```
オンライン bundle   bebdc7586f6e6586be80a85cc744ae5c
ローカル再構築      bebdc7586f6e6586be80a85cc744ae5c   ✅ 完全一致
```

> **md5 一致 = バイト単位で一致 = ビルドパイプラインは信頼できる。**
> これは「ファイルサイズが同じ」よりはるかに強い証拠です ——
> **サイズが同じで内容が異なる場合は実在します**（troubleshooting.md T10 参照）。

### 3.4 ビルド結果の読み方

| 現象 | 意味 | 対処 |
|---|---|---|
| md5 が**参照と一致** | ✅ ビルドパイプラインは完全に忠実 | デプロイ可能 |
| md5 が異なるが、**変更した数行だけの差** | ✅ それはあなたの変更であり想定どおり | §5 のデプロイへ |
| `delta` が**小さな値**（数十〜数百バイト） | ✅ 通常は文字列の名称変更による長さの差 | 何を変更したか確認する |
| `delta` が**非常に大きい**（KB 級） | ⚠️ region を間違えたか、内容を誤って削除した可能性 | `git diff` 系の差分を確認する |
| `node --check` が**構文エラーを報告** | ❌ region が破壊された（切断 / ずれ） | §8 参照 |
| `[check] MISSING …` | ❌ スライスファイルが失われた | バックアップから復元する |
| `[check] MISMATCH at byte N` | ❌ 内容が実際に変わっている | byte N がどの region に落ちるかを見る |

---

## 4. 代替経路：真の rolldown パッケージング

**枠組みは用意済みですが、現在は本番成果物には使えません。**

```bash
npm run build:rolldown
# = rolldown -c rolldown.config.ts
```

`rolldown.config.ts`（生成済み。元の形態を忠実に再現）：

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

### 4.1 ⚠️ なぜ今は使えないのか

```
元の bundle はモジュール境界を保持していない：
  · export は 0 個
  · すべての import がファイル先頭へ巻き上げられている
  · モジュール間の依存関係は【復元不可能】

→ rolldown を直接実行しても空の殻が出るかエラーになるだけで、動作する 12 MB の bundle は出力されない
```

**使えるようにするには、まず §6 のモジュール化移行を完了させる必要があります。**

### 4.2 ⚠️ rolldown のバージョンは ≤ 1.1.8 でなければならない

**これは厳格な制約です** —— region コメントの形式がバージョン間で変わっています：

| rolldown | 出力されるコメント形式 | 使えるか |
|---|---|---|
| `1.0.0` | `//#region <path>` | ✅ |
| `1.1.0` / `1.1.4` / `1.1.8` | `//#region <path>` | ✅ **1.1.8 を推奨** |
| `1.2.16` | `// <path>`（**`#region` なし**） | ❌ 形式が変更済み |
| `1.3.2` | `// <path>` | ❌ かつ `inlineDynamicImports` は非推奨 |

**実測比較**：

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

> **元のプロジェクトが使った rolldown のバージョンは正確には特定できません**（bundle にバージョンの刻印が無いため）、
> **`≤1.1.8`** という範囲までしか絞り込めません。
>
> ⚠️ 復元プロジェクトの `package.json` には `"rolldown": "^1.3.2"` と書かれています ——
> **この範囲では 1.3.x がインストールされ、`#region` は得られません**。これは既知の要修正項目です。§9 参照。

---

## 5. コンテナへのデプロイ

### 5.1 ★★ デプロイ前に必読：ログイン状態を失う

```
⚠️ QQ プロセスを再起動  →  loginList がクリアされる  →  QR コードの読み取り直しが必須
⚠️ コンテナを再起動      →  同様に QQ も再起動       →  同様にログイン状態を失う
```

**重要な区別**：

| 操作 | QQ プロセスに影響するか | ログイン状態を失うか |
|---|---|---|
| **runtime プロセスのみ再起動** | ❌ 影響しない | ✅ **失わない** |
| コンテナを再起動 | ✅ する | ❌ **失う** |
| QQ プロセスを再起動 | ✅ する | ❌ **失う** |

> **正しい方法：runtime に bundle を再読み込みさせるだけで、QQ プロセスには触れないこと。**
> 詳しい原理と復旧手順は [troubleshooting.md T2](../advanced/troubleshooting.md) を参照してください。

### 5.2 デプロイ方式：bind mount（推奨）

本番インスタンスはこの方式を使っています：

```bash
# 宿主机的文件直接映射进容器
docker inspect <容器> --format '{{json .HostConfig.Binds}}'
# → { "…/index-hz.mjs": "/app/runtime/index.mjs" }
```

**デプロイ手順**：

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

### 5.3 runtime を再起動する正しい方法

**supervisord は 2 つの program を管理しています**：

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

> ⚠️ `supervisorctl` が使えない場合（socket の権限）、
> 次善の策として runtime プロセスを kill し、supervisord の `autorestart=true` に立ち上げさせます。
> **それでも QQ プロセスには触れないでください。**

### 5.4 デプロイ後の検証

```bash
# ① runtime 起来了
docker exec <容器> sh -c 'supervisorctl status'
curl -s -o /dev/null -w 'webui=%{http_code}\n' http://127.0.0.1:5199/

# ② hook 健康（0 = 健康）
docker exec <容器> sh -c 'grep -c unresolved /app/data/logs/*.log'

# ③ ★ 端到端：真的发一条消息、真的收一条消息
```

> **「プロセスが起動した」だけで判断してはいけません。** 実際の送受信検証が必須です ——
> 理由は [compatibility.md §7.5](../advanced/compatibility.md) を参照してください。

### 5.5 ロールバック

```bash
# 用 §5.2 第 ① 步的备份
base64 -w0 <宿主路径>/index-hz.mjs.bak-<时间戳> | ssh <服务器> 'base64 -d > <宿主路径>/index-hz.mjs'
ssh <服务器> 'md5sum <宿主路径>/index-hz.mjs'   # 确认回到已知good值
docker exec <容器> supervisorctl restart snowluma
```

### 5.6 リリース成果物の完全な形

リリース成果物は**1 つのディレクトリ**であり、`native/` は `index.mjs` と**一緒に配布する必要があります**：

```
dist/
├── index.mjs          ← 本 bundle
├── launcher.sh        ← 起動スクリプト（同ディレクトリの ./node を優先し、無ければ $PATH にフォールバック）
├── check-node-version.cjs
├── package.json       ← @snowluma/runtime のマニフェスト（version: 0.2.4.2）
├── release.json       ← { version, target: "linux-arm64", entries: [...] }
├── EULA.md / PRIVACY.md
├── client/            ← WebUI フロントエンドの静的成果物（★ ソースは未復元）
└── native/            ← ★ 必ず同行して配布する
    ├── snowluma-linux-arm64.node        注入器
    ├── snowluma-linux-arm64.so          hook バックエンド
    ├── websocket-linux-arm64.node
    ├── ffmpeg/ffmpegAddon.linux.arm64.node
    └── sqlite/prebuilds/linux-arm64/@appthreat+sqlite3.{glibc,musl}.node
```

> ⚠️ **`native/` が欠落した場合の結果**：WebUI は起動できますが、
> **Hook / SQLite / WebSocket / ffmpeg が縮退するかエラーになります**。
> 実測ログ（native の無いマシンで実行）：
> ```
> WARN  [Hook] process enumeration failed: No hook native addon found for linux-x64
> ```

---

## 6. 発展：本来の複数ファイル構成へ復元する

現在の `packages/*/src/*.ts` は**フラット化された fragment** です ——
各ファイルは単独で構文チェックを通りますが、**互いが見えません**（コンパイルできない）。

**本当のモジュラー構成にするには、この順序で進めます**：

```
① import グラフを再構築する
   · init_xxx() の呼び出し順から初期化依存を逆算する
     （検証済み：15 個の init_* 定義と 15 個の呼び出しが完全に対応し、宙に浮いた参照は無い）
   · 識別子の命名規則から逆算する
     （rolldown は同名シンボルに $1 / $2 の接尾辞を付ける。例：fs$1、logger$2）

② 各ファイルに export を補う
   他所から参照されているトップレベルの var / function / class をエクスポートする

③ init_xxx() を本来の import 副作用へ置き換える

④ npm run build:rolldown で試しにパッケージングし、dist/index.mjs の挙動を比較する
```

**パッケージ単位で段階的に移行することを推奨します**（依存の少ない順に）：

```
common (20 ファイル, 1,806 行)  →  sqlite (3)  →  websocket (5)  →  bridge (17)
   →  onebot (77)  →  protocol (180)  →  core (64)
```

> **1 つのパッケージを移行し終えるたびに §3 の再構築を実行してリグレッションを確認してください** —— 挙動が変わらないことを保証するためです。

---

## 7. 型チェックとテスト

```bash
# 类型检查（需要装 typescript）
npm run typecheck
# = tsc -p tsconfig.json

# 测试
npm run test
# = node --test scripts/*.test.cjs
```

**⚠️ `typecheck` の実際の価値は限定的です**：

```jsonc
// tsconfig.json 的关键设置
{
  "strict": false,
  "noImplicitAny": false,
  "noEmit": true,
  "allowJs": true
}
```

理由：**復元された `.ts` ファイルでは型注釈がすでに消去されています**（TS → JS のコンパイル後に型はすべて失われる）。
各ファイルの先頭には `// @ts-nocheck` が付けられています。それらは**正確な JS であり、元の TS ではありません**。

**保持されているもの**：変数名 / 関数名、クラス構造、コメント、文字列、ロジック。
**失われているもの**：`interface` / `type` / ジェネリック引数、引数と戻り値の型、`private` などの修飾子、enum。

---

## 8. ビルドのトラブルシューティング

### 8.1 `node --check` が構文エラーを報告する

```
症状：npm run build が 2 番目のステップで失敗する
根本原因：region が破壊された（切断、ずれ、行の過不足）
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

**復旧**：バックアップ / アーカイブからそのスライスを取り直してください。**手作業で修復しないでください**（さらにずれが広がりやすくなります）。

### 8.2 `[check] MISSING <path>`

```
根本原因：ある region のスライスファイルが存在しない、または空である
```

```bash
# 从归档重新解出
ls /sdcard/snowluma-takeover-20261112.tgz
# 或从 takeover 包里的 restored/ 复制对应文件
```

### 8.3 成果物はビルドできるが起動に失敗する

```bash
# 先做最小化冒烟测试（隔离 HOME，不碰生产）
cd dist
SNOWLUMA_DEV_NO_NATIVE=1 SNOWLUMA_DEV_MODE=1 node index.mjs
```

**期待されるログ**（主フローが正常であることを示す）：

```
INFO  [App] SnowLuma starting
INFO  [WebUI] listening http://127.0.0.1:5399
WARN  [Hook] process enumeration failed: No hook native addon found for linux-x64
        ↑ 想定どおり：本機は x64 で、native 成果物は arm64 しか無い
```

**HTTP 層で期待される挙動**：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5399/
# → 404   （前端 client/ 未构建，是设计行为）

curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5399/api/state
# → 401   （鉴权正常拦截，是设计行为）
```

> **404 と 401 はどちらも「設計上の挙動」であり、ビルド失敗ではありません。**
> 判断基準：WebUI が待ち受けでき、`ss -ltnp` でポートが見え、優雅に終了できる（SIGTERM）なら、
> **libuv / ネットワーク / ログ / HTTP ルーティング / ネゴシエーション付きクローズという主フロー一式は完全に正常**です。

### 8.4 設定やソースを変更したのに反映されない

**切り分けの順序**：

```
① ソースの region を変更した？      → npm run build での再構築 + デプロイが必要
② package.json を変更した？        → 依存にのみ影響し、成果物には影響しない（成果物は自己完結している）
③ コンテナ内の設定ファイルを変更した？ → ★ 実行時はホットリロードしない！ troubleshooting T1 参照
④ 正しいコンテナを変更したか？      → 停止済みの旧コンテナを変更していないか確認する（T9）
```

### 8.5 メモリ / 長い処理との関係

```bash
# 构建本身很轻（纯字符串拼接，几秒），但如果跑 rolldown 或 tsc：
#   · 长任务必须后台跑 + 轮询日志（SSH 空闲会断连）
setsid nohup npm run build:rolldown > ~/build.log 2>&1 < /dev/null &
tail -c 800 ~/build.log | tr '\r' '\n' | tail -10
#                          ↑ 进度条是回车不换行，必须转换
```

> ⚠️ **`/tmp` に大きなファイルを置かないでください**（tmpfs の場合、メモリを消費します）。
> 本プロジェクトは 26 MB で大きくありませんが、アーカイブ / 展開には `~/` かプロジェクトディレクトリを使ってください。

---

## 9. バージョン固定の要件

### 9.1 ★ 依存は正確なバージョンを使い、`^` を使わない

**規則**：`"hono": "4.13.13"` と書き、`"hono": "^4.13.13"` とは**書かない**。

**理由は実際に踏んだ落とし穴です**：caret 範囲で一度インストールしたところ、
npm が解決したバージョンが bundle 内と**不一致になり —— 6 個のパッケージがドリフト**しました：

| パッケージ | bundle 内 | `^` で入るもの | 判定 |
|---|---|---|---|
| `hono` | `4.13.13` | **`4.13.18`** | ❌ ドリフト |
| `@hono/node-server` | `2.1.5` | **`2.1.8`** | ❌ ドリフト |
| `otpauth` | `9.5.1` | **`9.6.0`** | ❌ ドリフト |
| `tar` | `7.5.22` | **`7.5.23`** | ❌ ドリフト |
| `@zxcvbn-ts/core` | `4.1.2` | **`4.2.0`** | ❌ ドリフト |
| `semver` | `7.7.4` | **`7.8.6`** | ❌ ドリフト |
| `htmlparser2` | `10.0.0` | **`10.1.0`** | ❌ ドリフト |

> **正確なバージョンの一覧は [compatibility.md §4.1](../advanced/compatibility.md) を参照してください。**

### 9.2 ⚠️ 既知の要修正項目：復元プロジェクト内の `^` と rolldown の範囲

**次の 2 点は上記の規則と衝突しており、既知の要修正項目です：**

| 位置 | 現在値 | あるべき値 | 影響 |
|---|---|---|---|
| `packages/*/package.json` の `dependencies` | `^4.13.13` など | `4.13.13`（`^` を外す） | 依存インストール時に 6 個のパッケージがドリフトする |
| ルートの `package.json` の `devDependencies.rolldown` | `^1.3.2` | `1.1.8`（正確固定） | rolldown のルートで `//#region` が得られない |

> **注意**：この 2 点は**既定の `npm run build` には影響しません** ——
> `merge.mjs` は依存ゼロで、`node_modules` を読みません。
> 影響を受けるのは `build:rolldown` のルートを通る場合や、依存のインストールが必要な場合だけです。

### 9.3 Node のバージョン

**ビルド側**：緩い（v22 で実測しても通る）。
**実行側**：厳格（`^24.22.1 || >=26.12.1`、Node 25 は空白域）。

---

## 10. ビルドの完全なチェックリスト

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

## 11. 関連ドキュメント

| 知りたいこと | 参照先 |
|---|---|
| 実際にどう動いているのか | [architecture.md](../advanced/architecture.md) |
| どのバージョンをサポートし / 何に依存するか | [compatibility.md](../advanced/compatibility.md) |
| 問題が起きたときの調べ方 | [troubleshooting.md](../advanced/troubleshooting.md) |
| 開発に参加する方法 | [contributing.md](contributing.md) |

---

*ビルドフローは実測済みです：成果物 `dist/index.mjs` は 12,338,442 バイト、
MD5 は `bebdc7586f6e6586be80a85cc744ae5c` —— オンラインで稼働中の bundle とバイト単位で一致しています。*
